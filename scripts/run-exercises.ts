#!/usr/bin/env bun
/** Execute every published step both alone and through persistent book workspaces. */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { exercisePath } from "../src/filenames";
import { loadFromDirectory } from "../src/loader";
import type { Example, Step } from "../src/types";
import { JUNIT_JAR, JUNIT_URL, junitAvailable, verify } from "./lib/verify";

const ROOT = join(import.meta.dir, "..");
const BOOKS_DIR = join(ROOT, "books");
const argv = process.argv.slice(2);
const args = new Set(argv);
const value = (flag: string): string | undefined => {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
};
const selected = args.has("--isolated") || args.has("--sequential");
const runIsolated = !selected || args.has("--isolated");
const runSequential = !selected || args.has("--sequential");
const jsonOutput = args.has("--json");
const keepWorkspace = args.has("--keep-workspace");
const reportPath = value("--report");
const content = loadFromDirectory(BOOKS_DIR);

const responseOf = (id: string): string | undefined =>
  content.steps.find((step) => step.id === id)?.response;

interface Result {
  pass: "isolated" | "sequential";
  book: string;
  id: string;
  status: "passed" | "failed" | "delegated";
  command?: string;
  output?: string;
  durationMs: number;
  workspace?: string;
}

const results: Result[] = [];

function check(pass: Result["pass"], book: string, example: Example, step: Step, directory?: string): Result {
  const started = performance.now();
  if (step.execution.launch?.surface === "external") {
    return {
      pass,
      book,
      id: step.id,
      status: "delegated",
      output: "External launch delegated to the compiled CLI book walk.",
      durationMs: Math.round(performance.now() - started),
      ...(directory ? { workspace: directory } : {}),
    };
  }
  const verified = verify(example, step, step.scaffold, step.stdin, {
    responseOf,
    expectsUncaughtException: step.expectsException,
    ...(directory ? { directory } : {}),
  });
  return {
    pass,
    book,
    id: step.id,
    status: verified.skipped ? "delegated" : verified.ok ? "passed" : "failed",
    command: verified.command,
    output: verified.skipped ?? verified.output,
    durationMs: Math.round(performance.now() - started),
    ...(directory ? { workspace: directory } : {}),
  };
}

function desiredProjectFiles(bookRoot: string, step: Step): Set<string> {
  const scaffold = step.scaffold!;
  const projectRoot = resolve(bookRoot, scaffold.projectRoot!);
  return new Set([
    resolve(projectRoot, scaffold.responsePath!),
    ...scaffold.files.map((file) => resolve(projectRoot, file.path)),
  ]);
}

function runSequentialBook(book: typeof content.books[number], campaignRoot: string): void {
  const bookRoot = join(campaignRoot, book.tag);
  const managedProjects = new Map<string, Set<string>>();
  mkdirSync(bookRoot, { recursive: true });

  for (const example of book.sections.flatMap((section) => section.chapters).flatMap((chapter) => chapter.examples)) {
    for (const step of example.steps) {
      let directory: string;
      if (step.scaffold?.projectRoot && step.scaffold.responsePath) {
        const projectRoot = resolve(bookRoot, step.scaffold.projectRoot);
        const desired = desiredProjectFiles(bookRoot, step);
        for (const previous of managedProjects.get(projectRoot) ?? []) {
          if (!desired.has(previous)) rmSync(previous, { force: true });
        }
        for (const clean of step.scaffold.clean ?? []) rmSync(resolve(projectRoot, clean), { force: true });
        managedProjects.set(projectRoot, desired);
        directory = bookRoot;
      } else {
        directory = dirname(resolve(bookRoot, exercisePath(example, step)));
      }
      mkdirSync(directory, { recursive: true });
      const result = check("sequential", book.tag, example, step, directory);
      results.push(result);
      if (result.status === "failed") return;
    }
  }
}

if (!junitAvailable()) {
  console.log("! JUnit launcher missing, so standalone Java tests may be delegated.");
  console.log(`  mkdir -p ${JUNIT_JAR.replace(/\/[^/]+$/, "")} && curl -sSLo ${JUNIT_JAR} ${JUNIT_URL}\n`);
}

if (runIsolated) {
  for (const book of content.books) {
    for (const example of book.sections.flatMap((section) => section.chapters).flatMap((chapter) => chapter.examples)) {
      for (const step of example.steps) results.push(check("isolated", book.tag, example, step));
    }
  }
}

let campaignRoot: string | undefined;
if (runSequential) {
  campaignRoot = mkdtempSync(join(tmpdir(), "aifirst-book-walk-content-"));
  for (const book of content.books) runSequentialBook(book, campaignRoot);
}

const failures = results.filter((result) => result.status === "failed");
const summary = {
  steps: content.steps.length,
  isolated: results.filter((result) => result.pass === "isolated" && result.status === "passed").length,
  sequential: results.filter((result) => result.pass === "sequential" && result.status === "passed").length,
  delegated: results.filter((result) => result.status === "delegated").length,
  failures: failures.length,
  ...(campaignRoot ? { workspace: campaignRoot } : {}),
};
const report = { summary, results };

if (reportPath) {
  const destination = resolve(reportPath);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, `${JSON.stringify(report, null, 2)}\n`);
}

if (jsonOutput) {
  console.log(JSON.stringify(report, null, 2));
} else {
  for (const failure of failures) {
    console.error(`✗ ${failure.pass} ${failure.id} — ${failure.command ?? "no command"}`);
    for (const line of (failure.output ?? "").split("\n").slice(-12)) console.error(`    ${line}`);
  }
  console.log(
    `${failures.length ? "✗" : "✓"} ${summary.isolated} isolated and ${summary.sequential} sequential step checks passed; ` +
      `${summary.delegated} external checks delegated to the CLI book walk.`,
  );
  if (failures.length && campaignRoot) console.error(`  Failed workspace: ${campaignRoot}`);
}

if (campaignRoot && !keepWorkspace && failures.length === 0) rmSync(campaignRoot, { recursive: true, force: true });
if (failures.length > 0) process.exitCode = 1;
