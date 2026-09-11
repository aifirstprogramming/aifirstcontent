import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { loadFromDirectory } from "../src/loader";

const content = loadFromDirectory(join(import.meta.dir, "..", "books"));
const chapter = content.books
  .find((book) => book.tag === "java")!
  .sections.flatMap((section) => section.chapters)
  .find((candidate) => candidate.number === 6)!;

describe("AI First Java Chapter 6 Maven progression", () => {
  test("starts with the Maven project without renumbering existing exercises", () => {
    expect(chapter.examples[0]?.id).toBe("java-6-00");
    expect(chapter.examples.slice(1, 4).map((example) => example.id)).toEqual([
      "java-6-01",
      "java-6-02",
      "java-6-03",
    ]);
    expect(chapter.examples[0]?.steps[0]?.response).toContain("junit-jupiter");
  });

  test("uses one Maven workspace with outcome-specific verification", () => {
    for (const example of chapter.examples) {
      const scaffold = example.steps[0]?.scaffold;
      expect(scaffold?.projectRoot, example.id).toBe("chapter-6-testing");
      expect(scaffold?.commands?.[0]?.[0], example.id).toBe("mvn");
      expect(scaffold?.outcome, example.id).toBeDefined();
      expect(example.dependencies).toEqual([
        { kind: "system-command", package: "Maven", command: "mvn" },
      ]);
    }
  });

  test("compiles class-only prompts and uses the real pom for Mockito", () => {
    const thermostat = content.steps.find((step) => step.id === "java-6-01")!;
    expect(thermostat.scaffold?.outcome).toBe("compile");
    expect(thermostat.scaffold?.commands).toEqual([["mvn", "-q", "-DskipTests", "compile"]]);
    expect(thermostat.explanation?.summary).toContain("rather than an application");

    const mockito = content.steps.find((step) => step.id === "java-6-14")!;
    const pom = mockito.scaffold?.files.find((file) => file.path === "pom.xml");
    expect(pom?.content).toContain("mockito-core");
    expect(mockito.scaffold?.files.some((file) => file.path.includes("MockitoDependencyNote"))).toBe(false);
  });
});
