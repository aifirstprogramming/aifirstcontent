import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { loadFromDirectory } from "../src/loader";
import { findMatch, findMatchingStep, searchEntries, unwrapPromptTag } from "../src/matcher";
import type { Matchable } from "../src/matcher";

const content = loadFromDirectory(join(import.meta.dir, "..", "books"));
const steps = content.steps;

const norm = (s: string) => s.toLowerCase().trim();

describe("unwrapPromptTag", () => {
  it("extracts the inner text inline chat wraps the query in", () => {
    expect(unwrapPromptTag("junk <prompt>Write a Hello World app</prompt> more")).toBe(
      "Write a Hello World app",
    );
  });

  it("leaves untagged text alone", () => {
    expect(unwrapPromptTag("Write a Hello World app")).toBe("Write a Hello World app");
  });
});

describe("every authored prompt resolves to itself", () => {
  // The core guarantee: a learner typing a prompt from the printed page gets
  // that prompt's canonical response, in every language scope.
  for (const step of steps) {
    it(`${step.id} matches its own prompt`, () => {
      const hit = findMatch(step.prompt, steps, step.language);
      expect(hit).not.toBeNull();
      expect(norm(hit!.prompt)).toBe(norm(step.prompt));
    });
  }

  it("returns a byte-identical response for every prompt that is unique in its language", () => {
    const counts = new Map<string, number>();
    for (const s of steps) {
      const key = `${s.language}::${norm(s.prompt)}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    let checked = 0;
    for (const s of steps) {
      if (counts.get(`${s.language}::${norm(s.prompt)}`) !== 1) continue;
      expect(findMatch(s.prompt, steps, s.language)!.response).toBe(s.response);
      checked++;
    }
    expect(checked).toBeGreaterThan(30);
  });
});

describe("language scoping", () => {
  it("never returns another language's code when a language is given", () => {
    for (const step of steps) {
      const other = step.language === "python" ? "java" : "python";
      const hit = findMatch(step.prompt, steps, other);
      if (hit) expect(hit.language).toBe(other);
    }
  });

  it("returns null rather than falling back when the scoped group is empty", () => {
    const onlyPython = steps.filter((s) => s.language === "python");
    expect(findMatch(onlyPython[0].prompt, onlyPython, "java")).toBeNull();
  });

  it("exhausts python before java for an unknown language", () => {
    // A prompt present in both books must resolve to python first when the
    // editor language is unknown, so a Java entry cannot win on a stray word.
    const entries: Matchable[] = [
      { prompt: "Write a Hello World app", language: "java" },
      { prompt: "Write a Hello World app", language: "python" },
    ];
    expect(findMatch("Write a Hello World app", entries)!.language).toBe("python");
    expect(findMatch("Write a Hello World app", entries, "plaintext")!.language).toBe("python");
  });
});

describe("tiers", () => {
  const entries: Matchable[] = [
    { prompt: "Write a Hello World app", language: "python" },
    { prompt: "Print the price of a specified item using an f string", language: "python" },
  ];

  it("matches exactly, ignoring case and surrounding whitespace", () => {
    expect(searchEntries("  WRITE A HELLO WORLD APP  ", entries)!.prompt).toBe("Write a Hello World app");
  });

  it("matches partially in both directions", () => {
    expect(searchEntries("Please write a Hello World app for me", entries)!.prompt).toBe(
      "Write a Hello World app",
    );
    expect(searchEntries("Print the price", entries)!.prompt).toBe(
      "Print the price of a specified item using an f string",
    );
  });

  it("falls back to fuzzy word overlap above 50%", () => {
    expect(searchEntries("specified using string price item the", entries)!.prompt).toBe(
      "Print the price of a specified item using an f string",
    );
  });

  it("returns null when nothing clears the fuzzy threshold", () => {
    expect(searchEntries("configure kubernetes ingress controllers", entries)).toBeNull();
  });

  it("ignores words of two characters or fewer when scoring", () => {
    // "an" and "f" are dropped, so this is 8/8 of the significant words.
    expect(searchEntries("print the price of a specified item using", entries)).not.toBeNull();
  });

  it("returns null for an empty entry list", () => {
    expect(findMatch("anything", [])).toBeNull();
  });
});

describe("findMatchingStep", () => {
  it("unwraps a prompt tag before matching", () => {
    const step = steps[0];
    const hit = findMatchingStep(`<prompt>${step.prompt}</prompt>`, steps, step.language);
    expect(hit!.response).toBe(step.response);
  });
});
