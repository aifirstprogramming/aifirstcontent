import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import {
  bookIdFromFilename,
  chapterNumberFromTitle,
  languageFromFilename,
  loadFromDirectory,
  loadFromRaw,
  normalizeResponse,
} from "../src/loader";
import type { RawBook } from "../src/types";

const BOOKS = join(import.meta.dir, "..", "books");
const content = loadFromDirectory(BOOKS);

describe("normalizeResponse", () => {
  it("joins arrays with newlines, matching the extension's behavior", () => {
    expect(normalizeResponse(["a", "b", "c"])).toBe("a\nb\nc");
  });

  it("passes strings through untouched", () => {
    expect(normalizeResponse('print("Hello, World!")')).toBe('print("Hello, World!")');
  });

  it("preserves blank lines inside an array", () => {
    expect(normalizeResponse(["a", "", "b"])).toBe("a\n\nb");
  });

  it("treats a missing response as empty rather than throwing", () => {
    expect(normalizeResponse(undefined)).toBe("");
  });
});

describe("filename derivation", () => {
  it("derives language from the filename", () => {
    expect(languageFromFilename("ai-first-python-programming.json")).toBe("python");
    expect(languageFromFilename("ai-first-java-programming.json")).toBe("java");
    expect(languageFromFilename("ai-first-rust-programming.json")).toBeUndefined();
  });

  it("derives a book id by stripping the extension", () => {
    expect(bookIdFromFilename("/x/y/ai-first-java-programming.json")).toBe("ai-first-java-programming");
  });
});

describe("chapterNumberFromTitle", () => {
  it("parses the leading chapter number", () => {
    expect(chapterNumberFromTitle("Chapter 12: Project: Mobile Voice Journal")).toBe(12);
    expect(chapterNumberFromTitle("Chapter 1: Getting Started with Python")).toBe(1);
  });
});

describe("loading the real books", () => {
  it("loads both books", () => {
    expect(content.books.map((b) => b.id).sort()).toEqual([
      "ai-first-java-programming",
      "ai-first-python-programming",
    ]);
  });

  it("loads every published example and step", () => {
    // Published only: drafts awaiting an explanation and a proving run, and
    // retired examples the books no longer contain, are filtered out.
    expect(content.examples).toHaveLength(137);
    expect(content.steps).toHaveLength(146);
  });

  it("hides drafts and retired examples unless asked", () => {
    const all = loadFromDirectory(BOOKS, { includeUnpublished: true });
    expect(all.examples.length).toBeGreaterThan(content.examples.length);
    // Nothing unpublished may leak into the default view, since a draft has not
    // been proved to run and a retired example is not in the book.
    expect(content.examples.every((e) => e.status === undefined)).toBe(true);
    expect(all.examples.some((e) => e.status !== undefined)).toBe(true);
    expect(all.examples.some((e) => e.status === "retired")).toBe(true);
  });

  it("gives single-prompt examples a step whose id equals the example id", () => {
    for (const ex of content.examples.filter((e) => !e.multiStep)) {
      expect(ex.steps).toHaveLength(1);
      expect(ex.steps[0].id).toBe(ex.id);
    }
  });

  it("numbers multi-step examples 1..n with matching sub-ids", () => {
    const multi = content.examples.filter((e) => e.multiStep);
    expect(multi.length).toBeGreaterThan(0);
    for (const ex of multi) {
      ex.steps.forEach((s, i) => {
        expect(s.index).toBe(i + 1);
        expect(s.total).toBe(ex.steps.length);
        expect(s.id).toBe(`${ex.id}.${i + 1}`);
        expect(s.exampleId).toBe(ex.id);
      });
    }
  });

  it("never yields an example with zero steps or an empty response", () => {
    for (const ex of content.examples) {
      expect(ex.steps.length).toBeGreaterThan(0);
      for (const s of ex.steps) {
        expect(s.prompt.trim()).not.toBe("");
        expect(s.response.trim()).not.toBe("");
      }
    }
  });

  it("keeps chapters with no authored examples, rather than dropping them", () => {
    // Both books have chapters authored ahead of their content; a listing must
    // still be able to show them.
    const chapters = content.books.flatMap((b) => b.sections.flatMap((s) => s.chapters));
    expect(chapters.filter((c) => c.examples.length === 0).length).toBeGreaterThan(0);
  });

  it("tags every example with its book, chapter and language", () => {
    for (const ex of content.examples) {
      expect(ex.bookId).toBeTruthy();
      expect(ex.chapterNumber).toBeGreaterThan(0);
      expect(["python", "java"]).toContain(ex.language);
    }
  });
});

describe("strict mode", () => {
  const bookWithNoId: RawBook = {
    title: "T",
    tag: "py",
    language: "python",
    sections: [
      {
        title: "S",
        chapters: [
          { title: "Chapter 1: C", examples: [{ id: "", title: "no id", prompt: "p", response: "r" }] },
        ],
      },
    ],
  };

  it("rejects an example with no id", () => {
    expect(() => loadFromRaw([{ filename: "ai-first-python-programming.json", book: bookWithNoId }])).toThrow(
      /has no id/,
    );
  });

  it("skips it when lenient", () => {
    const c = loadFromRaw([{ filename: "ai-first-python-programming.json", book: bookWithNoId }], {
      strict: false,
    });
    expect(c.examples).toHaveLength(0);
  });

  it("rejects a book that declares no language and whose filename reveals none", () => {
    const undeclared = { ...bookWithNoId, language: undefined } as unknown as RawBook;
    expect(() => loadFromRaw([{ filename: "mystery.json", book: undeclared }])).toThrow(/language/);
  });
});
