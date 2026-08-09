/**
 * Recompute every explanation's `run` line from verifyCommand.
 *
 * The line a reader sees must be the command that actually executes. It is derived,
 * not model output, so this needs no API call.
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { suggestFilename } from "../src/filenames";
import { loadFromDirectory } from "../src/loader";
import { displayCommand, verifyCommand } from "./lib/verify";

const BOOKS_DIR = join(import.meta.dir, "..", "books");
const content = loadFromDirectory(BOOKS_DIR, { includeUnpublished: true, strict: false });

const runById = new Map<string, string>();
for (const example of content.examples) {
  for (const step of example.steps) {
    const mainFile = suggestFilename(example, step);
    const { commands, skipped } = verifyCommand(example, step, mainFile, step.scaffold);
    if (skipped || commands.length === 0) continue;
    runById.set(step.id, displayCommand(commands, mainFile));
  }
}

let changed = 0;
for (const filename of readdirSync(BOOKS_DIR).filter((f) => f.endsWith(".json"))) {
  const path = join(BOOKS_DIR, filename);
  const book = JSON.parse(readFileSync(path, "utf8"));
  for (const section of book.sections ?? []) {
    for (const chapter of section.chapters ?? []) {
      for (const ex of chapter.examples ?? []) {
        for (const st of ex.prompts ?? [ex]) {
          const id = st.id ?? ex.id;
          const want = runById.get(id);
          if (!want || !st.explanation) continue;
          if (st.explanation.run !== want) {
            st.explanation.run = want;
            changed++;
          }
        }
      }
    }
  }
  writeFileSync(path, `${JSON.stringify(book, null, 2)}\n`);
}

console.log(`run lines refreshed: ${changed}`);
