#!/usr/bin/env bun
/**
 * Runs every exercise in the pack and asserts it exits cleanly.
 *
 * This is the check that matters most. `aifirst run` only records an exercise as
 * complete when the program actually runs, so an exercise that can't run is one a
 * learner can never finish. Asserting things about the *text* of the code would
 * not catch that; executing it does.
 *
 * Each step is written to a temp directory under the filename the CLI would
 * choose (shared via src/filenames.ts) and run with its authored sample stdin.
 *
 * Usage:
 *   bun scripts/run-exercises.ts                 every language available
 *   bun scripts/run-exercises.ts --language py   just one
 *   bun scripts/run-exercises.ts --skip-missing  skip languages with no runtime
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadFromDirectory } from "../src/loader";
import { runCommand, suggestFilename } from "../src/filenames";
import type { Example, Step } from "../src/types";

const BOOKS = join(import.meta.dir, "..", "books");
const TIMEOUT_MS = 30_000;

const argv = process.argv.slice(2);
const only = ((): string | undefined => {
  const i = argv.indexOf("--language");
  if (i < 0) return undefined;
  const v = argv[i + 1];
  return v === "py" ? "python" : v;
})();
const skipMissing = argv.includes("--skip-missing");

const content = loadFromDirectory(BOOKS);

/** Is there a runtime for this language on this machine? */
function runtimeAvailable(language: string): boolean {
  const cmd = runCommand(language, "x")?.[0];
  if (!cmd) return false;
  try {
    return Bun.which(cmd) !== null;
  } catch {
    return false;
  }
}

interface Failure {
  step: Step;
  reason: string;
  output: string;
}

const failures: Failure[] = [];
const skipped: string[] = [];
let ran = 0;

const languages = [...new Set(content.steps.map((s) => s.language))];
for (const language of languages) {
  if (only && language !== only) continue;
  if (!runtimeAvailable(language)) {
    const message = `no runtime for ${language} (need ${runCommand(language, "x")?.[0] ?? "?"})`;
    if (skipMissing) {
      skipped.push(message);
      continue;
    }
    console.error(`✗ ${message} — install it, or pass --skip-missing`);
    process.exit(1);
  }
}

for (const example of content.examples) {
  if (only && example.language !== only) continue;
  if (!runtimeAvailable(example.language)) continue;

  for (const step of example.steps) {
    const dir = mkdtempSync(join(tmpdir(), "aifirst-run-"));
    try {
      const result = await runStep(example, step, dir);
      ran++;
      if (result) failures.push(result);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

async function runStep(example: Example, step: Step, dir: string): Promise<Failure | null> {
  const path = join(dir, suggestFilename(example, step));
  writeFileSync(path, step.response.endsWith("\n") ? step.response : step.response + "\n");

  const cmd = runCommand(example.language, path);
  if (!cmd) return { step, reason: `no run command for ${example.language}`, output: "" };

  const proc = Bun.spawn(cmd, {
    cwd: dir,
    // An interactive exercise gets its authored sample; everything else gets a
    // closed stdin, so a program that unexpectedly reads input fails loudly here
    // rather than hanging on a learner's machine.
    stdin: step.stdin === undefined ? "ignore" : new TextEncoder().encode(step.stdin),
    stdout: "pipe",
    stderr: "pipe",
  });

  const timer = setTimeout(() => proc.kill(), TIMEOUT_MS);
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  await proc.exited;
  clearTimeout(timer);

  const output = `${stdout}${stderr}`.trim();
  if (proc.exitCode !== 0) {
    return {
      step,
      reason: proc.exitCode === null ? `timed out after ${TIMEOUT_MS / 1000}s` : `exited ${proc.exitCode}`,
      output,
    };
  }
  return null;
}

for (const s of skipped) console.log(`  skipped: ${s}`);

if (failures.length > 0) {
  console.error(`\n✗ ${failures.length} of ${ran} exercise(s) did not run cleanly:\n`);
  for (const f of failures) {
    console.error(`  ${f.step.id} — ${f.reason}`);
    for (const line of f.output.split("\n").slice(0, 12)) console.error(`      ${line}`);
    console.error("");
  }
  process.exit(1);
}

console.log(`✓ ${ran} exercise(s) ran cleanly.`);
