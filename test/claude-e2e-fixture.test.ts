import { describe, expect, test } from "bun:test";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateClaudeE2EFixture } from "../scripts/lib/claude-e2e-fixture";

const rocket = join(import.meta.dir, "fixtures", "rocket-showtail");
const scenarioRoot = join(
  import.meta.dir,
  "fixtures",
  "claude-showtail-e2e",
);

describe("Claude E2E fixture generation", () => {
  for (const id of [
    "train-multiprompt",
    "sandwich-custom-plan",
    "habit-auto-plan",
  ]) {
    test(`exactly regenerates the committed ${id} book`, () => {
      const fixture = join(scenarioRoot, id);
      const capture = JSON.parse(
        readFileSync(join(fixture, "capture.json"), "utf8"),
      );
      const result = generateClaudeE2EFixture(fixture);
      expect(
        result.diagnostics.filter((item) => item.severity === "error"),
      ).toEqual([]);
      expect(`${JSON.stringify(result.book, null, 2)}\n`).toBe(
        readFileSync(
          join(fixture, "generated", "books", `${id}.json`),
          "utf8",
        ),
      );
      expect(capture.showtailVerifyKnownRawEventGap).toBe(true);
      expect(
        readFileSync(join(fixture, "oracle", "showtail-verify.log"), "utf8"),
      ).toContain("type: type must be one of:");
    });
  }

  test("promotes every captured sandwich answer to the book-recommended option", () => {
    const fixture = join(scenarioRoot, "sandwich-custom-plan");
    const result = generateClaudeE2EFixture(fixture);
    const workflow =
      result.book?.sections[0]?.chapters[0]?.examples[0]?.prompts?.[0]?.replay
        ?.workflow;
    expect(workflow?.questions).toHaveLength(3);
    for (const question of workflow?.questions ?? []) {
      const selected = workflow!.canonicalAnswers[question.id];
      expect(question.options.at(-1)?.id).toBe(selected);
      expect(question.options.at(-1)?.description).toBe(
        "Captured learner-authored choice.",
      );
    }
  });

  test("maps the habit plan prompt past the synthetic /plan report turn", () => {
    const fixture = join(scenarioRoot, "habit-auto-plan");
    const result = generateClaudeE2EFixture(fixture);
    const prompts =
      result.book?.sections[0]?.chapters[0]?.examples[0]?.prompts ?? [];
    expect(prompts).toHaveLength(2);
    expect(prompts[1]?.replay?.source?.turnIndex).toBe(2);
  });

  test("builds progressive test content from capture inputs only", () => {
    const root = mkdtempSync(join(tmpdir(), "claude-e2e-fixture-"));
    try {
      mkdirSync(join(root, "bundle", "turns", "01"), { recursive: true });
      cpSync(
        join(rocket, "bundle", "report.json"),
        join(root, "bundle", "report.json"),
      );
      cpSync(
        join(rocket, "bundle", "source"),
        join(root, "bundle", "turns", "01", "source"),
        { recursive: true },
      );
      const rocketCapture = JSON.parse(
        readFileSync(join(rocket, "capture.json"), "utf8"),
      );
      writeFileSync(
        join(root, "capture.json"),
        `${JSON.stringify({
          schemaVersion: 1,
          id: "rocket-e2e",
          exerciseId: "py-98-99",
          title: "Rocket Fixture",
          turns: [
            {
              prompt: rocketCapture.prompt,
              responsePath: "rocket_sim.py",
              source: "bundle/turns/01/source",
            },
          ],
        })}\n`,
      );

      const result = generateClaudeE2EFixture(root);
      expect(
        result.diagnostics.filter((item) => item.severity === "error"),
      ).toEqual([]);
      const example = result.book?.sections[0]?.chapters[0]?.examples[0];
      expect(example?.id).toBe("py-98-99");
      expect(example?.prompts).toHaveLength(1);
      expect(example?.prompts?.[0]?.id).toBe("py-98-99.1");
      expect(example?.prompts?.[0]?.replay?.workflow?.questions).toHaveLength(1);
      expect(example?.prompts?.[0]?.scaffold?.files).toHaveLength(2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
