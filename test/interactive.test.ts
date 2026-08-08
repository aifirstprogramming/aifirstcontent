import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { loadFromDirectory, loadFromRaw, readsStdin } from "../src/loader";
import type { RawBook } from "../src/types";

const content = loadFromDirectory(join(import.meta.dir, "..", "books"));

describe("readsStdin", () => {
  it("spots Python input()", () => {
    expect(readsStdin('name = input("Your name? ")')).toBe(true);
  });

  it("spots Java Scanner and System.in", () => {
    expect(readsStdin("Scanner scanner = new Scanner(System.in);")).toBe(true);
    expect(readsStdin("BufferedReader r = new BufferedReader(...);")).toBe(true);
  });

  it("does not fire on code that merely prints", () => {
    expect(readsStdin('print("Hello, World!")')).toBe(false);
    expect(readsStdin('System.out.println("Hello, World!");')).toBe(false);
  });

  it("does not fire on an unrelated identifier containing 'input'", () => {
    expect(readsStdin("user_input_count = 3")).toBe(false);
  });
});

describe("interactive exercises in the pack", () => {
  const interactive = content.steps.filter((s) => s.interactive);

  it("finds the input-reading steps", () => {
    // Published interactive steps; drafts are not yet required to carry samples.
    expect(interactive.length).toBe(11);
  });

  it("every one carries a sample stdin", () => {
    // Without this an assistant could never complete the exercise: it has no way
    // to type into a running program.
    for (const step of interactive) {
      expect(step.stdin, `${step.id} has no stdin sample`).toBeDefined();
      expect(step.stdin!.length).toBeGreaterThan(0);
    }
  });

  it("non-interactive steps carry no sample", () => {
    for (const step of content.steps.filter((s) => !s.interactive)) {
      expect(step.stdin).toBeUndefined();
    }
  });

  it("marks the parent example interactive when any step is", () => {
    const parent = content.examples.find((e) => e.id === "py-3-01")!;
    expect(parent.interactive).toBe(true);
    expect(content.examples.find((e) => e.id === "py-1-01")!.interactive).toBe(false);
  });
});

describe("book identity", () => {
  it("comes from the book's declared fields", () => {
    const python = content.books.find((b) => b.id === "ai-first-python-programming")!;
    expect(python.tag).toBe("py");
    expect(python.language).toBe("python");
    const java = content.books.find((b) => b.id === "ai-first-java-programming")!;
    expect(java.tag).toBe("java");
    expect(java.language).toBe("java");
  });

  it("tags every example with its book tag, for scoping to one book", () => {
    for (const ex of content.examples) {
      expect(ex.bookTag).toBe(ex.id.split("-")[0]);
    }
  });

  it("prefers the declared language over the filename", () => {
    // A book whose filename says python but which declares java must load as
    // java — the declaration is authoritative.
    const raw: RawBook = {
      title: "Mislabelled",
      tag: "kt",
      language: "kotlin",
      sections: [
        {
          title: "S",
          chapters: [
            {
              title: "Chapter 1: C",
              examples: [{ id: "kt-1-01", title: "T", prompt: "p", response: "r" }],
            },
          ],
        },
      ],
    };
    const loaded = loadFromRaw([{ filename: "ai-first-python-programming.json", book: raw }]);
    expect(loaded.books[0].language).toBe("kotlin");
    expect(loaded.books[0].tag).toBe("kt");
  });

  it("accepts a new book with no code change", () => {
    // The whole point of declaring tag and language: adding a book to the series
    // is a content change.
    const raw: RawBook = {
      title: "AI First Rust Programming",
      tag: "rs",
      language: "rust",
      sections: [
        {
          title: "S",
          chapters: [
            {
              title: "Chapter 1: C",
              examples: [{ id: "rs-1-01", title: "Hello", prompt: "p", response: "fn main() {}" }],
            },
          ],
        },
      ],
    };
    const loaded = loadFromRaw([{ filename: "ai-first-rust-programming.json", book: raw }]);
    expect(loaded.examples[0].language).toBe("rust");
    expect(loaded.examples[0].bookTag).toBe("rs");
  });

  it("falls back to the filename for a pack authored before the fields existed", () => {
    const legacy = {
      title: "Legacy",
      sections: [
        {
          title: "S",
          chapters: [
            { title: "Chapter 1: C", examples: [{ id: "py-1-01", title: "T", prompt: "p", response: "r" }] },
          ],
        },
      ],
    } as unknown as RawBook;
    const loaded = loadFromRaw([{ filename: "ai-first-python-programming.json", book: legacy }]);
    expect(loaded.books[0].language).toBe("python");
    expect(loaded.books[0].tag).toBe("py");
  });
});
