#!/usr/bin/env bun
/**
 * Execute every published exercise. This is the gate that makes "the book's code
 * works" a checked fact rather than a claim.
 *
 * It shares scripts/lib/verify.ts with the authoring script, so CI reaches the same
 * verdict the enrichment run did -- without an API key, and without a model. The
 * facts it needs are stored in the pack: the scaffold that makes an exercise
 * runnable, its sample stdin, and whether it throws on purpose.
 *
 * Requires python3 and a JDK. Java tests additionally need the JUnit console
 * launcher; without it they are reported as skipped rather than silently passing.
 */

import { join } from "node:path";
import { loadFromDirectory } from "../src/loader";
import { JUNIT_JAR, JUNIT_URL, junitAvailable, verify } from "./lib/verify";

const BOOKS_DIR = join(import.meta.dir, "..", "books");
const content = loadFromDirectory(BOOKS_DIR);

const responseOf = (id: string): string | undefined =>
  content.steps.find((s) => s.id === id)?.response;

interface Failure {
  id: string;
  command: string;
  output: string;
}

const failures: Failure[] = [];
const skipped: { id: string; why: string }[] = [];
let passed = 0;

if (!junitAvailable()) {
  console.log(`! JUnit launcher missing, so Java tests will be skipped.`);
  console.log(`  mkdir -p ${JUNIT_JAR.replace(/\/[^/]+$/, "")} && curl -sSLo ${JUNIT_JAR} ${JUNIT_URL}\n`);
}

for (const example of content.examples) {
  for (const step of example.steps) {
    const result = verify(example, step, step.scaffold, step.stdin, {
      responseOf,
      expectsUncaughtException: step.expectsException,
    });

    if (result.skipped) {
      skipped.push({ id: step.id, why: result.skipped });
    } else if (result.ok) {
      passed++;
    } else {
      failures.push({ id: step.id, command: result.command, output: result.output });
    }
  }
}

if (skipped.length > 0) {
  console.log(`- ${skipped.length} skipped:`);
  for (const s of skipped) console.log(`  ${s.id.padEnd(14)} ${s.why}`);
  console.log();
}

if (failures.length > 0) {
  console.error(`✗ ${failures.length} of ${passed + failures.length} exercise(s) did not run cleanly:\n`);
  for (const f of failures) {
    console.error(`  ${f.id} — ${f.command}`);
    for (const line of f.output.split("\n").slice(0, 8)) console.error(`      ${line}`);
    console.error();
  }
  process.exit(1);
}

console.log(`✓ ${passed} exercise step(s) ran cleanly.`);
