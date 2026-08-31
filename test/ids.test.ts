import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { loadFromDirectory } from "../src/loader";
import {
  AmbiguousIdError,
  UnknownIdError,
  compareIds,
  isValidId,
  parseId,
  resolve,
} from "../src/ids";

const content = loadFromDirectory(join(import.meta.dir, "..", "books"));

describe("parseId", () => {
  it("parses an example id", () => {
    expect(parseId("py-2-06")).toEqual({ tag: "py", chapter: 2, seq: 6, step: undefined, exampleId: "py-2-06" });
  });

  it("parses a step id and reports its parent", () => {
    expect(parseId("java-3-05.4")).toEqual({
      tag: "java",
      chapter: 3,
      seq: 5,
      step: 4,
      exampleId: "java-3-05",
    });
  });

  it("rejects malformed ids", () => {
    for (const bad of ["", "py", "py-2", "py-2-", "2-2-2", "PY-2-06", "py-2-06.", "py-2-06.x"]) {
      expect(parseId(bad)).toBeNull();
      expect(isValidId(bad)).toBe(false);
    }
  });
});

describe("compareIds", () => {
  it("orders by book, then chapter, then sequence, then step", () => {
    const shuffled = ["py-3-01", "java-1-01", "py-2-06.2", "py-2-06", "py-2-06.1", "py-10-01", "py-2-07"];
    expect([...shuffled].sort(compareIds)).toEqual([
      "java-1-01",
      "py-2-06",
      "py-2-06.1",
      "py-2-06.2",
      "py-2-07",
      "py-3-01",
      "py-10-01",
    ]);
  });

  it("orders chapter 10 after chapter 9 rather than lexically", () => {
    expect(compareIds("py-10-01", "py-9-01")).toBeGreaterThan(0);
  });
});

describe("resolve", () => {
  it("resolves an exact example id", () => {
    const r = resolve("py-1-01", content);
    expect(r.kind).toBe("example");
    expect(r.example.id).toBe("py-1-01");
  });

  it("is case-insensitive", () => {
    expect(resolve("PY-1-01", content).example.id).toBe("py-1-01");
  });

  it("resolves a step id to that step", () => {
    const r = resolve("py-3-01.2", content);
    expect(r.kind).toBe("step");
    if (r.kind !== "step") throw new Error("expected a step");
    expect(r.step.index).toBe(2);
    expect(r.example.id).toBe("py-3-01");
  });

  it("prefers the example when a single-prompt example shares its step id", () => {
    const single = content.examples.find((e) => !e.multiStep)!;
    expect(resolve(single.id, content).kind).toBe("example");
  });

  it("treats a multi-step example's own id as the example, not its steps", () => {
    const multi = content.examples.find((e) => e.multiStep)!;
    const r = resolve(multi.id, content);
    expect(r.kind).toBe("example");
    expect(r.example.steps.length).toBeGreaterThan(1);
  });

  it("accepts an unambiguous prefix", () => {
    expect(resolve("py-1-0", content).example.id).toBe("py-1-01");
  });

  it("throws with candidates on an ambiguous prefix", () => {
    let err: unknown;
    try {
      resolve("py-2", content);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(AmbiguousIdError);
    expect((err as AmbiguousIdError).candidates.length).toBeGreaterThan(1);
  });

  it("throws on an unknown id", () => {
    expect(() => resolve("py-99-99", content)).toThrow(UnknownIdError);
    expect(() => resolve("   ", content)).toThrow(UnknownIdError);
  });
});
