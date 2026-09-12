import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { loadFromDirectory } from "../src/loader";

const content = loadFromDirectory(join(import.meta.dir, "..", "books"));
const chapter = content.books
  .find((book) => book.tag === "java")!
  .sections.flatMap((section) => section.chapters)
  .find((candidate) => candidate.number === 6)!;

describe("AI First Java Chapter 6 Maven progression", () => {
  test("starts with the first authored class and contains no setup-only exercise", () => {
    expect(content.examples.some((example) => example.id === "java-6-00")).toBe(false);
    expect(chapter.examples.slice(0, 3).map((example) => example.id)).toEqual([
      "java-6-01",
      "java-6-02",
      "java-6-03",
    ]);
    expect(chapter.examples[0]?.steps[0]?.scaffold?.files.find((file) => file.path === "pom.xml")?.content)
      .toContain("junit-jupiter");
  });

  test("uses one Maven workspace with outcome-specific verification", () => {
    for (const example of chapter.examples) {
      const scaffold = example.steps[0]?.scaffold;
      expect(scaffold?.projectRoot, example.id).toBe("chapter-6-testing");
      expect(example.steps[0]?.execution.commands?.[0]?.[0], example.id).toBe("mvn");
      expect(example.steps[0]?.execution.mode, example.id).toBeDefined();
      expect(example.dependencies).toEqual([
        { kind: "system-command", package: "Maven", command: "mvn" },
      ]);
    }
  });

  test("compiles class-only prompts and uses the real pom for Mockito", () => {
    const thermostat = content.steps.find((step) => step.id === "java-6-01")!;
    expect(thermostat.execution.mode).toBe("compile");
    expect(thermostat.execution.commands).toEqual([["mvn", "-q", "-DskipTests", "compile"]]);
    expect(thermostat.execution.launch).toBeUndefined();
    expect(thermostat.explanation?.summary).toContain("rather than an application");

    const mockito = content.steps.find((step) => step.id === "java-6-14")!;
    const pom = mockito.scaffold?.files.find((file) => file.path === "pom.xml");
    expect(pom?.content).toContain("mockito-core");
    expect(mockito.scaffold?.files.some((file) => file.path.includes("MockitoDependencyNote"))).toBe(false);
  });
});
