import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { loadFromDirectory } from "../src/loader";

const content = loadFromDirectory(join(import.meta.dir, "..", "books"));
const duckling = content.steps.find((step) => step.id === "py-9-01")!;
const fox = content.steps.find((step) => step.id === "py-9-02")!;
const levels = content.steps.find((step) => step.id === "py-9-03")!;

function operationCounts(events: NonNullable<typeof duckling.replay>["events"]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const event of events ?? []) {
    if (event.type !== "operation") continue;
    counts[event.operation.type] = (counts[event.operation.type] ?? 0) + 1;
  }
  return counts;
}

describe("interactive replay workflows", () => {
  test("places Save the Duckling first in Python chapter 9", () => {
    const python = content.books.find((book) => book.tag === "py")!;
    const chapters = python.sections.flatMap((section) => section.chapters);
    const chapter9 = chapters.find((candidate) => candidate.number === 9)!;
    const chapter10 = chapters.find((candidate) => candidate.number === 10)!;
    expect(chapter9.title).toBe("Chapter 9: Building a Game with Pygame");
    expect(chapter10.title).toBe("Chapter 10: Designing a Level Editor");
    expect(chapter9.examples.map((example) => example.id)).toEqual(["py-9-01", "py-9-02", "py-9-03"]);
    expect(chapter9.examples.map((example) => example.title)).toEqual([
      "Save the Duckling",
      "Add a Fox Enemy",
      "Add Two Harder Levels",
    ]);
  });

  test("stores the book path separately from option ordering", () => {
    const workflow = duckling.replay!.workflow!;
    expect(workflow.canonicalAnswers).toEqual({
      gameplay: "top_down",
      challenge: "collect_siblings",
      visual_style: "sprite_images",
      asset_source: "generate_png",
    });
    expect(workflow.questions.find((question) => question.id === "challenge")?.options[0].id).toBe("predators");
    expect(workflow.questions.slice(0, 3).map((question) => question.group)).toEqual([
      "game_design",
      "game_design",
      "game_design",
    ]);
  });

  test("asks the asset question only for sprite-image plans", () => {
    const assets = duckling.replay!.workflow!.questions.find((question) => question.id === "asset_source")!;
    expect(assets.when).toEqual({ visual_style: "sprite_images" });
    expect(duckling.replay!.workflow!.canonicalPlan).toContain("Save the Duckling");
  });

  test("stores the fox follow-up as a direct deterministic replay", () => {
    expect(fox.prompt).toBe("The game currently has no enemies. Add a fox to the game.");
    expect(fox.replay!.workflow).toBeUndefined();
    expect(fox.replay!.operations).toHaveLength(10);
    expect(operationCounts(fox.replay!.events)).toEqual({ read: 7, edit: 16, command: 4 });
    expect(fox.replay!.completionText).toContain("Added two foxes");
  });

  test("stores the harder-level choices and canonical path", () => {
    const workflow = levels.replay!.workflow!;
    expect(workflow.questions.map((question) => question.id)).toEqual([
      "transition",
      "difficulty",
      "siblings",
    ]);
    expect(workflow.canonicalAnswers).toEqual({
      transition: "brief_auto",
      difficulty: "patrol_variety",
      siblings: "increase",
    });
    expect(workflow.canonicalPlan).toContain("Level 3");
    expect(levels.replay!.operations).toHaveLength(11);
    expect(workflow.questions.every((question) => question.group === "level_design")).toBe(true);
    expect(workflow.interludes?.[0]?.afterQuestion).toBe("siblings");
    expect(operationCounts(workflow.interludes?.[0]?.events)).toEqual({ command: 2 });
    expect(levels.replay!.prePlanEvents?.filter((event) => event.type === "operation").every((event) =>
      event.operation.type === "read" || (event.operation.type === "command" && event.operation.readOnly))).toBe(true);
    expect(levels.replay!.completionText).toContain("three levels of increasing difficulty");
  });

  test("captures the base game's preflight, failure repair, image reads, and final response", () => {
    expect(duckling.replay!.prePlanEvents?.filter((event) => event.type === "operation").map((event) => event.operation.type)).toEqual([
      "command",
      "command",
    ]);
    expect(duckling.replay!.events?.filter((event) => event.type === "operation").map((event) => event.operation.type)).toContain("edit");
    expect(duckling.replay!.events?.filter((event) => event.type === "operation").map((event) => event.operation.type).filter((type) => type === "read")).toHaveLength(4);
    expect(duckling.replay!.completionText).toContain("The game is complete and working");
    expect(duckling.replay!.workflow!.interludes?.[0]?.afterQuestion).toBe("asset_source");
  });
});
