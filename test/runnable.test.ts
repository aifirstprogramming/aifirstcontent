import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { loadFromDirectory } from "../src/loader";

/**
 * Invariants about how an exercise is run.
 *
 * These exist because a local pass proved nothing once: `java Foo.java` pulls in
 * sibling source files only on JDK 22 and later (JEP 458), so 37 exercises passed on
 * a JDK 26 laptop and failed on CI's JDK 21. A learner on an LTS release would have
 * hit exactly the same wall, which is the case that actually matters.
 */

const content = loadFromDirectory(join(import.meta.dir, "..", "books"));

describe("how exercises are run", () => {
  it("has no setup-only exercises and classifies every project as a runnable application", () => {
    const counts = new Map<string, number>();
    for (const example of content.examples) {
      const mode = example.steps.at(-1)!.execution.mode;
      counts.set(mode, (counts.get(mode) ?? 0) + 1);
    }
    expect(content.examples.length).toBe(154);
    expect(Object.fromEntries(counts)).toEqual({ run: 140, compile: 6, test: 8 });
    expect(content.examples.some((example) => example.id === "java-6-00")).toBe(false);
    for (const step of content.steps) {
      expect(step.scaffold && "commands" in step.scaffold, step.id).toBeFalsy();
      expect(step.scaffold && "outcome" in step.scaffold, step.id).toBeFalsy();
      expect(step.scaffold && "entrypoint" in step.scaffold, step.id).toBeFalsy();
    }
    for (const example of content.examples.filter((candidate) => candidate.kind === "project")) {
      expect(example.steps.at(-1)!.execution).toMatchObject({
        mode: "run",
        launch: { surface: "external" },
      });
    }
  });

  it("never depends on multi-file source launching", () => {
    for (const step of content.steps) {
      const extraJava = (step.scaffold?.files ?? []).some((f) => f.path.endsWith(".java"));
      if (!extraJava) continue;
      expect(
        step.explanation?.run,
        `${step.id} runs with the single-file launcher but needs other sources; compile first`,
      ).not.toMatch(/^java \S+\.java$/);
    }
  });

  it("tells the reader a command that names only available tools", () => {
    for (const step of content.steps) {
      const run = step.explanation?.run;
      if (!run) continue;
      expect(run, `${step.id} names an unsupported build tool`).not.toMatch(/\b(gradle|pip)\b/);
      if (/\bmvn\b/.test(run)) {
        expect(step.dependencies, `${step.id} uses Maven without declaring it`).toContainEqual({
          kind: "system-command",
          package: "Maven",
          command: "mvn",
        });
        expect(step.execution.commands?.[0]?.[0], `${step.id} has no Maven execution plan`).toBe("mvn");
      }
    }
  });

  it("gives every published step a run line", () => {
    for (const step of content.steps) {
      expect(step.explanation?.run, `${step.id} has no run line`).toBeTruthy();
    }
  });
});
