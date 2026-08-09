#!/usr/bin/env bun
/**
 * CI gate for books/*.json.
 *
 * Checks, in order:
 *   1. JSON Schema conformance (schema/content.schema.json)
 *   2. Global id uniqueness across every book
 *   3. Step ids agreeing with their parent example id and position
 *   4. The content loads cleanly through the shared strict loader
 *
 * Check 2 is the one that protects learner logs: a duplicated id would make two
 * different exercises share a progress entry.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv from "ajv";
import { loadFromRaw, type RawEntry } from "../src/loader";
import type { RawBook } from "../src/types";

const ROOT = join(import.meta.dir, "..");
const BOOKS_DIR = join(ROOT, "books");

const errors: string[] = [];
const fail = (msg: string) => errors.push(msg);

// --- 1. Schema -------------------------------------------------------------

const schema = JSON.parse(readFileSync(join(ROOT, "schema", "content.schema.json"), "utf8"));
const ajv = new Ajv({ allErrors: true, strict: false });
const validate = ajv.compile(schema);

const filenames = readdirSync(BOOKS_DIR)
  .filter((f) => f.toLowerCase().endsWith(".json"))
  .sort();

if (filenames.length === 0) fail("books/ contains no .json files");

const entries: RawEntry[] = [];

for (const filename of filenames) {
  const book = JSON.parse(readFileSync(join(BOOKS_DIR, filename), "utf8")) as RawBook;
  entries.push({ filename, book });

  if (!validate(book)) {
    for (const e of validate.errors ?? []) {
      fail(`${filename}: ${e.instancePath || "/"} ${e.message}`);
    }
  }
}

// --- 2 & 3. Ids ------------------------------------------------------------

const seen = new Map<string, string>(); // id -> where it was first seen

for (const { filename, book } of entries) {
  for (const section of book.sections ?? []) {
    for (const chapter of section.chapters ?? []) {
      for (const example of chapter.examples ?? []) {
        const where = `${filename} / ${chapter.title} / "${example.title}"`;

        if (seen.has(example.id)) {
          fail(`duplicate id "${example.id}": ${where} and ${seen.get(example.id)}`);
        } else {
          seen.set(example.id, where);
        }

        (example.prompts ?? []).forEach((step, i) => {
          if (seen.has(step.id)) {
            fail(`duplicate id "${step.id}": ${where} step ${i + 1} and ${seen.get(step.id)}`);
          } else {
            seen.set(step.id, `${where} step ${i + 1}`);
          }

          const expected = `${example.id}.${i + 1}`;
          if (step.id !== expected) {
            fail(`step id "${step.id}" should be "${expected}" (${where})`);
          }
        });
      }
    }
  }
}

// --- 4. Loads through the shared loader ------------------------------------

let exampleCount = 0;
let stepCount = 0;
let interactiveCount = 0;
let draftCount = 0;
let retiredCount = 0;
for (const { book } of entries) {
  for (const section of book.sections ?? []) {
    for (const chapter of section.chapters ?? []) {
      for (const ex of chapter.examples ?? []) {
        if (ex.status === "draft") draftCount++;
        if (ex.status === "retired") retiredCount++;
      }
    }
  }
}
try {
  // Published only: a draft has not been explained or proved to run yet, so the
  // requirements below deliberately do not apply to it.
  const content = loadFromRaw(entries, { strict: true });
  exampleCount = content.examples.length;
  stepCount = content.steps.length;

  // 5. Every published step must carry its pre-computed explanation.
  //
  // The VS Code extension has no model, so an explanation missing here is an
  // explanation no reader ever sees. Drafts are exempt: that is what draft means.
  for (const step of content.steps) {
    if (!step.explanation) {
      fail(`${step.id} is published but has no explanation. Run "bun run enrich".`);
      continue;
    }
    if (step.explanation.summary.trim() === "") fail(`${step.id} has an empty explanation summary`);
  }

  // 6. Every exercise that reads input must carry a sample.
  //
  // An assistant cannot type into a running program — Claude Code's `!` prefix
  // does not attach an interactive stdin — so an interactive exercise with no
  // sample input can never be completed through one. Catching that here keeps
  // new content from quietly reintroducing the problem.
  for (const step of content.steps) {
    if (!step.interactive) continue;
    interactiveCount++;
    if (step.stdin === undefined) {
      fail(
        `${step.id} reads input but has no "stdin" sample. ` +
          `Add one that lets the program run to completion.`,
      );
    }
  }
} catch (e) {
  fail(`strict load failed: ${(e as Error).message}`);
}

// --- Report ----------------------------------------------------------------

if (errors.length > 0) {
  console.error(`✗ ${errors.length} problem(s) in books/:\n`);
  for (const e of errors) console.error(`  ${e}`);
  process.exit(1);
}

const unpublished =
  draftCount || retiredCount ? `, ${draftCount} draft, ${retiredCount} retired (not served)` : "";
console.log(
  `✓ ${filenames.length} book(s), ${exampleCount} published examples, ${stepCount} steps ` +
    `(${interactiveCount} interactive, all with sample input)${unpublished}, ` +
    `${seen.size} unique ids, schema valid.`,
);
