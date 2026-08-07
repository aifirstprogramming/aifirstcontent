#!/usr/bin/env bun
/**
 * One-time authoring pass: assign stable explicit `id` fields to every example
 * and every multi-prompt sub-step in books/*.json.
 *
 * Kept in the repo for reproducibility and re-runnability. Re-running is safe:
 * existing ids are preserved, and only examples/steps lacking an id get one.
 * That is what makes this script safe to run again after authors add new
 * content -- it never renumbers an id a learner's log might already reference.
 *
 * Usage:  bun scripts/add-ids.ts [--check]
 *   --check  exit non-zero if any example/step is missing an id (for CI)
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BOOKS_DIR = join(import.meta.dir, "..", "books");

/**
 * Short, stable, printable tag per book, e.g. "py" in py-2-06.
 *
 * Read from the book itself rather than guessed from the filename, so adding a
 * book to the series is a content change and never a code change here.
 */
function bookTag(book: { tag?: string }, filename: string): string {
  if (book.tag) return book.tag;
  throw new Error(
    `Book "${filename}" has no "tag" field. Add one (e.g. "tag": "py") — it is the prefix for this book's exercise ids.`,
  );
}

/** "Chapter 12: Project: Mobile Voice Journal" -> 12 */
function chapterNumber(title: string): number {
  const m = title.match(/chapter\s+(\d+)/i);
  if (!m) throw new Error(`Cannot parse a chapter number from "${title}"`);
  return Number(m[1]);
}

const checkOnly = process.argv.includes("--check");
let assigned = 0;
let missing = 0;

for (const filename of readdirSync(BOOKS_DIR).filter((f) => f.endsWith(".json")).sort()) {
  const path = join(BOOKS_DIR, filename);
  const book = JSON.parse(readFileSync(path, "utf8"));
  const tag = bookTag(book, filename);

  for (const section of book.sections ?? []) {
    for (const chapter of section.chapters ?? []) {
      const ch = chapterNumber(chapter.title);
      let seq = 0;

      // Seed the counter past any ids already assigned in this chapter so new
      // examples appended later never collide with existing ones.
      for (const ex of chapter.examples ?? []) {
        const m = typeof ex.id === "string" ? ex.id.match(/-(\d+)$/) : null;
        if (m) seq = Math.max(seq, Number(m[1]));
      }

      for (const ex of chapter.examples ?? []) {
        if (!ex.id) {
          if (checkOnly) {
            console.error(`missing id: ${filename} / ${chapter.title} / "${ex.title}"`);
            missing++;
          } else {
            seq++;
            reorderWithId(ex, `${tag}-${ch}-${String(seq).padStart(2, "0")}`);
            assigned++;
          }
        }

        // Sub-steps of a multi-prompt example: <exercise-id>.<n>, 1-based.
        if (Array.isArray(ex.prompts)) {
          ex.prompts.forEach((step: Record<string, unknown>, i: number) => {
            if (!step.id) {
              if (checkOnly) {
                console.error(
                  `missing id: ${filename} / ${chapter.title} / "${ex.title}" step ${i + 1}`,
                );
                missing++;
              } else {
                reorderWithId(step, `${ex.id}.${i + 1}`);
                assigned++;
              }
            }
          });
        }
      }
    }
  }

  if (!checkOnly) {
    writeFileSync(path, JSON.stringify(book, null, 2) + "\n");
  }
}

/**
 * Insert `id` as the first key. JSON.stringify follows insertion order, so
 * rebuilding the object in place keeps the authored files readable with the id
 * on top rather than buried after the response.
 */
function reorderWithId(obj: Record<string, unknown>, id: string): void {
  const rest = { ...obj };
  for (const k of Object.keys(obj)) delete obj[k];
  obj.id = id;
  Object.assign(obj, rest);
}

if (checkOnly) {
  if (missing > 0) {
    console.error(`\n${missing} example(s)/step(s) missing an id.`);
    process.exit(1);
  }
  console.log("All examples and steps have ids.");
} else {
  console.log(`Assigned ${assigned} id(s).`);
}
