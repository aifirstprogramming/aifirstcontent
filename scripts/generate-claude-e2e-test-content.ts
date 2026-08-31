#!/usr/bin/env bun
/** Regenerate committed test-only books from Claude/Showtail fixture bundles. */

import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { generateClaudeE2EFixture } from "./lib/claude-e2e-fixture";

const fixtureRoot = join(
  import.meta.dir,
  "..",
  "test",
  "fixtures",
  "claude-showtail-e2e",
);
const requested = process.argv.slice(2).filter((value) => !value.startsWith("--"));
const fixtures = requested.length
  ? requested.map((value) => resolve(value))
  : existsSync(fixtureRoot)
    ? readdirSync(fixtureRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => join(fixtureRoot, entry.name))
        .sort()
    : [];

if (fixtures.length === 0) throw new Error("No Claude E2E fixtures found");

let failed = false;
for (const fixture of fixtures) {
  const result = generateClaudeE2EFixture(fixture);
  const errors = result.diagnostics.filter((item) => item.severity === "error");
  if (!result.book || !result.capture || errors.length > 0) {
    failed = true;
    for (const item of result.diagnostics)
      console.error(
        `${basename(fixture)} ${item.severity} ${item.field}: ${item.message}`,
      );
    continue;
  }
  const output = join(
    fixture,
    "generated",
    "books",
    `${result.capture.id}.json`,
  );
  mkdirSync(join(output, ".."), { recursive: true });
  writeFileSync(output, `${JSON.stringify(result.book, null, 2)}\n`);
  console.log(output);
}

if (failed) process.exitCode = 1;
