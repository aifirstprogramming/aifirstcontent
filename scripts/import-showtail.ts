#!/usr/bin/env bun
/** Import replay bundles after manuscript scraping has created the book examples. */

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join, relative } from "node:path";
import type { RawBook, RawExample, RawPromptStep, RawResponse, Scaffold } from "../src/types";
import { books, type BookConfig } from "./lib/mine";
import { deriveReplay, type ImportDiagnostic } from "./lib/import-showtail";
import { parseShowtailReport } from "./lib/showtail";
import { promptKey } from "./lib/docx";

const ROOT = join(import.meta.dir, "..");
const BOOKS_DIR = process.env.AIFIRST_BOOKS_DIR ?? join(ROOT, "books");
const args = process.argv.slice(2);
const write = args.includes("--write");
const force = args.includes("--force");
const jsonOutput = args.includes("--format") && args[args.indexOf("--format") + 1] === "json";
const bookFilter = args.includes("--book") ? args[args.indexOf("--book") + 1] : undefined;

interface RawTarget {
  parent: RawExample;
  step: RawExample | RawPromptStep;
  prompt: string;
  response: string;
  index: number;
  all: Array<{ parent: RawExample; step: RawExample | RawPromptStep }>;
}

interface BundleResult {
  book: string;
  bundle: string;
  exerciseId?: string;
  changed: boolean;
  diagnostics: ImportDiagnostic[];
}

function normalizeResponse(response: RawResponse | undefined): string {
  return Array.isArray(response) ? response.join("\n") : response ?? "";
}

function bookFile(tag: string): string {
  for (const name of readdirSync(BOOKS_DIR).filter((file) => file.endsWith(".json"))) {
    const book = JSON.parse(readFileSync(join(BOOKS_DIR, name), "utf8")) as RawBook;
    if (book.tag === tag) return name;
  }
  throw new Error(`No content book with tag ${tag}`);
}

function targets(book: RawBook): RawTarget[] {
  const flat: Array<{ parent: RawExample; step: RawExample | RawPromptStep }> = [];
  for (const section of book.sections ?? []) {
    for (const chapter of section.chapters ?? []) {
      for (const parent of chapter.examples ?? []) {
        for (const step of parent.prompts ?? [parent]) flat.push({ parent, step });
      }
    }
  }
  return flat.map(({ parent, step }, index) => ({
    parent,
    step,
    prompt: step.prompt ?? "",
    response: normalizeResponse(step.response),
    index,
    all: flat,
  }));
}

function scaffoldFiles(scaffold: Scaffold | undefined): Map<string, string> | undefined {
  if (!scaffold) return undefined;
  const files = scaffold.files.flatMap((file) => file.content === undefined ? [] : [[file.path, file.content] as const]);
  return files.length > 0 ? new Map(files) : undefined;
}

const EXCLUDED_DIRS = new Set([".git", ".venv", "venv", "node_modules", "__pycache__", "assets"]);
const EXCLUDED_FILES = /(^|\/)(screenshot[^/]*|\.DS_Store)$|\.(png|jpe?g|gif|webp|pyc|class)$/i;

function sourceFiles(root: string): Map<string, string> {
  const files = new Map<string, string>();
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && EXCLUDED_DIRS.has(entry.name)) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(path);
        continue;
      }
      const rel = relative(root, path).replace(/\\/g, "/");
      if (EXCLUDED_FILES.test(rel)) continue;
      const data = readFileSync(path);
      if (data.includes(0)) continue;
      files.set(rel, data.toString("utf8"));
    }
  };
  visit(root);
  return files;
}

function bundleDirs(root: string): string[] {
  if (!existsSync(root)) return [];
  if (existsSync(join(root, "report.json")) && existsSync(join(root, "source"))) return [root];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(root, entry.name))
    .filter((dir) => existsSync(join(dir, "report.json")) && existsSync(join(dir, "source")))
    .sort();
}

function error(field: string, message: string): ImportDiagnostic {
  return { category: "missing", severity: "error", field, message };
}

function processBundle(cfg: BookConfig, book: RawBook, bundle: string): BundleResult {
  const reportPath = join(bundle, "report.json");
  const reportText = readFileSync(reportPath, "utf8");
  const report = parseShowtailReport(JSON.parse(reportText));
  const allTargets = targets(book);
  const matches = report.turns.flatMap((turn, turnIndex) => allTargets
    .filter((target) => target.prompt && promptKey(target.prompt) === promptKey(turn.prompt.text))
    .map((target) => ({ target, turnIndex })));
  if (matches.length !== 1) {
    return {
      book: cfg.tag,
      bundle: basename(bundle),
      changed: false,
      diagnostics: [error("prompt", `Expected one manuscript prompt match; found ${matches.length}`)],
    };
  }
  const { target, turnIndex } = matches[0];
  const previous = target.index > 0 ? target.all[target.index - 1] : undefined;
  const derived = deriveReplay({
    report,
    reportText,
    turnIndex,
    sourceFiles: sourceFiles(join(bundle, "source")),
    response: target.response,
    initialFiles: scaffoldFiles(previous?.step.scaffold ?? previous?.parent.scaffold),
  });
  const exerciseId = target.step.id ?? target.parent.id;
  if (!derived.replay || !derived.scaffold) {
    return { book: cfg.tag, bundle: basename(bundle), exerciseId, changed: false, diagnostics: derived.diagnostics };
  }
  const currentReplay = target.step.replay;
  if (currentReplay && currentReplay.source?.kind !== "showtail" && !force) {
    return {
      book: cfg.tag,
      bundle: basename(bundle),
      exerciseId,
      changed: false,
      diagnostics: [...derived.diagnostics, error("replay", "Existing replay is not importer-owned; pass --force to replace it")],
    };
  }
  const before = JSON.stringify({ replay: target.step.replay, scaffold: target.step.scaffold });
  target.step.replay = derived.replay;
  target.step.scaffold = derived.scaffold;
  if (derived.scaffold.files.length > 1) target.parent.kind = "project";
  const after = JSON.stringify({ replay: target.step.replay, scaffold: target.step.scaffold });
  return { book: cfg.tag, bundle: basename(bundle), exerciseId, changed: before !== after, diagnostics: derived.diagnostics };
}

const results: BundleResult[] = [];
for (const cfg of books().filter((book) => !bookFilter || book.tag === bookFilter)) {
  if (!cfg.replays) continue;
  const filename = bookFile(cfg.tag);
  const path = join(BOOKS_DIR, filename);
  const book = JSON.parse(readFileSync(path, "utf8")) as RawBook;
  for (const bundle of bundleDirs(cfg.replays)) results.push(processBundle(cfg, book, bundle));
  const failures = results.some((result) => result.book === cfg.tag && result.diagnostics.some((item) => item.severity === "error"));
  if (write && !failures) writeFileSync(path, `${JSON.stringify(book, null, 2)}\n`);
}

if (jsonOutput) {
  console.log(JSON.stringify({ write, results }, null, 2));
} else {
  for (const result of results) {
    const errors = result.diagnostics.filter((item) => item.severity === "error");
    console.log(`${errors.length ? "FAIL" : result.changed ? write ? "WROTE" : "CHANGE" : "OK"} ${result.book}/${result.bundle}${result.exerciseId ? ` -> ${result.exerciseId}` : ""}`);
    for (const item of result.diagnostics) console.log(`  ${item.severity.padEnd(7)} ${item.category.padEnd(8)} ${item.field}: ${item.message}`);
  }
}

if (results.some((result) => result.diagnostics.some((item) => item.severity === "error"))) process.exitCode = 1;
