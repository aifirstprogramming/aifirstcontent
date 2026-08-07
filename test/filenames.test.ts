import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { runCommand, suggestFilename } from "../src/filenames";
import { loadFromDirectory } from "../src/loader";

const content = loadFromDirectory(join(import.meta.dir, "..", "books"));
const byId = (id: string) => content.examples.find((e) => e.id === id)!;

describe("suggestFilename", () => {
  it("names a Java file after its public class, not the exercise title", () => {
    // javac rejects a mismatch, so this has to come from the code.
    expect(suggestFilename(byId("java-1-01"))).toBe("HelloWorld.java");
    expect(suggestFilename(byId("java-3-06"))).toBe("PizzaOrder.java");
  });

  it("snake_cases a Python filename from the title", () => {
    expect(suggestFilename(byId("py-1-01"))).toBe("hello_world.py");
  });

  it("defaults a multi-step example to its final step", () => {
    // The steps are progressive, so the last one is the finished program.
    const example = byId("py-2-06");
    expect(suggestFilename(example)).toBe(suggestFilename(example, example.steps[example.steps.length - 1]));
  });

  it("produces a valid filename for every exercise in the pack", () => {
    for (const example of content.examples) {
      const name = suggestFilename(example);
      expect(name).toMatch(/^[A-Za-z0-9_]+\.(py|java)$/);
    }
  });

  it("every Java file matches the class declared inside it", () => {
    for (const example of content.examples.filter((e) => e.language === "java")) {
      for (const step of example.steps) {
        const declared = step.response.match(/class\s+([A-Za-z_$][\w$]*)/)?.[1];
        if (!declared) continue;
        expect(suggestFilename(example, step)).toBe(`${declared}.java`);
      }
    }
  });
});

describe("runCommand", () => {
  it("runs Python with python3", () => {
    expect(runCommand("python", "a.py")).toEqual(["python3", "a.py"]);
  });

  it("runs Java as a single source file, so no build tool is needed", () => {
    expect(runCommand("java", "A.java")).toEqual(["java", "A.java"]);
  });

  it("returns undefined for a language it cannot run", () => {
    expect(runCommand("rust", "a.rs")).toBeUndefined();
  });
});
