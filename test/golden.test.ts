import { describe, expect, it } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { loadFromDirectory, normalizeResponse } from "../src/loader";
import type { RawBook } from "../src/types";

/**
 * The book is printed. A response that changes by even a character between the
 * page and the tool is a defect, so this asserts the loader is byte-exact
 * against the authored JSON rather than merely "close enough".
 */

const BOOKS = join(import.meta.dir, "..", "books");
const content = loadFromDirectory(BOOKS);

describe("responses round-trip byte-identically from the authored JSON", () => {
  const raw = readdirSync(BOOKS)
    .filter((f) => f.endsWith(".json"))
    .map((filename) => JSON.parse(readFileSync(join(BOOKS, filename), "utf8")) as RawBook);

  /** Every published authored response, keyed by its authored id. */
  const authored = new Map<string, string>();
  for (const book of raw) {
    for (const section of book.sections ?? []) {
      for (const chapter of section.chapters ?? []) {
        for (const example of chapter.examples ?? []) {
          // Drafts and retired examples are not served, so they are not pinned.
          if (example.status) continue;
          if (example.prompts) {
            for (const step of example.prompts) authored.set(step.id, normalizeResponse(step.response));
          } else {
            authored.set(example.id, normalizeResponse(example.response));
          }
        }
      }
    }
  }

  it("covers every loaded step", () => {
    expect(authored.size).toBe(content.steps.length);
  });

  for (const step of content.steps) {
    it(`${step.id} is unchanged`, () => {
      const expected = authored.get(step.id);
      expect(expected).toBeDefined();
      expect(step.response).toBe(expected!);
    });
  }

  it("never introduces trailing whitespace or a trailing newline", () => {
    for (const step of content.steps) {
      expect(step.response).toBe(step.response.replace(/[ \t]+$/gm, "").replace(/\n+$/, ""));
    }
  });
});

describe("content inventory", () => {
  // A tripwire: if these move unexpectedly, content changed and the book text,
  // the CLI's progress denominators, and these tests should be revisited.
  it("has the expected shape", () => {
    const byBook = Object.fromEntries(
      content.books.map((b) => [b.id, b.sections.flatMap((s) => s.chapters).flatMap((c) => c.examples).length]),
    );
    expect(byBook).toEqual({
      "ai-first-java-programming": 87,
      "ai-first-python-programming": 55,
    });
  });
});
