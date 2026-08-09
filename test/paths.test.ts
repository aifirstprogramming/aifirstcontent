import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { exercisePath, suggestFilename } from "../src/filenames";
import { loadFromDirectory } from "../src/loader";

/**
 * Two exercises must never want the same file.
 *
 * Whole chapters evolve one file — Python 7 builds a single test file across five
 * exercises, and java-6-01/05/07/09 all declare `public class Thermostat`. Writing
 * them all to one name means each exercise destroys the last, which is a poor
 * experience however carefully the tool handles it.
 *
 * Numbering the filename is not available in Java: javac requires the public class
 * and the file to share a name, and renaming the class would break the promise that
 * the code matches the printed page. A clashing exercise gets its own directory.
 */

const content = loadFromDirectory(join(import.meta.dir, "..", "books"));

describe("where an exercise is written", () => {
  it("gives no two exercises the same path", () => {
    const seen = new Map<string, string>();
    for (const e of content.examples) {
      const key = `${e.bookTag}/${exercisePath(e)}`;
      expect(seen.has(key), `${e.id} and ${seen.get(key)} both want ${key}`).toBe(false);
      seen.set(key, e.id);
    }
  });

  it("leaves an unshared name at the top of the folder", () => {
    const hello = content.examples.find((e) => e.id === "py-1-01")!;
    expect(exercisePath(hello)).toBe("hello_world.py");
    expect(hello.dir).toBeUndefined();
  });

  it("gives a shared name its own directory, named for the exercise", () => {
    const first = content.examples.find((e) => e.id === "py-7-01")!;
    const second = content.examples.find((e) => e.id === "py-7-02")!;
    expect(exercisePath(first)).toBe("py-7-01/assert.py");
    expect(exercisePath(second)).toBe("py-7-02/assert.py");
  });

  it("keeps the filename javac demands, even when relocated", () => {
    // The class name is not ours to change; only the directory is.
    for (const id of ["java-6-01", "java-6-05"]) {
      const e = content.examples.find((x) => x.id === id)!;
      expect(exercisePath(e).endsWith("/Thermostat.java")).toBe(true);
      expect(suggestFilename(e)).toBe("Thermostat.java");
    }
  });

  it("never escapes the learner's folder", () => {
    for (const e of content.examples) {
      const p = exercisePath(e);
      expect(p.startsWith("/")).toBe(false);
      expect(p.includes("..")).toBe(false);
    }
  });
});
