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
    // No Maven, no Gradle: Java tests go through the JUnit console launcher, so the
    // books need no build file and neither does CI.
    for (const step of content.steps) {
      const run = step.explanation?.run;
      if (!run) continue;
      expect(run, `${step.id} names a build tool the project does not use`).not.toMatch(/\b(mvn|gradle|pip)\b/);
    }
  });

  it("gives every published step a run line", () => {
    for (const step of content.steps) {
      expect(step.explanation?.run, `${step.id} has no run line`).toBeTruthy();
    }
  });
});
