import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { loadFromDirectory } from "../src/loader";

const content = loadFromDirectory(join(import.meta.dir, "..", "books"));
const python = content.books.find((book) => book.tag === "py")!;
const chapters = python.sections.flatMap((section) => section.chapters);
const chapter = (number: number) => chapters.find((item) => item.number === number)!;

describe("Python manuscript audit for chapters 9 and 10", () => {
  test("publishes exactly the six guided prompts in manuscript order", () => {
    expect(chapter(9).examples.map((example) => [example.id, example.steps[0]?.prompt])).toEqual([
      ["py-9-01", "Make a game about a baby duckling who is trying to find its mother using pygame."],
      ["py-9-02", "The game currently has no enemies. Add a fox to the game."],
      ["py-9-03", "Make two more levels for the game. Each level should get harder with more obstacles and enemies."],
    ]);
    expect(chapter(10).examples.map((example) => [example.id, example.steps[0]?.prompt])).toEqual([
      ["py-10-01", "Design a level editor for the savetheduckling game."],
      ["py-10-02", "Implement undo/redo for the level editor."],
      ["py-10-03", "Create a path finding algorithm for the level editor to test if a level is beatable. Make it animated."],
    ]);
  });

  test("keeps the manuscript's canonical planning choices", () => {
    const step = (id: string) => content.steps.find((item) => item.id === id)!;
    expect(step("py-9-01").replay?.workflow?.canonicalAnswers).toEqual({
      game_style: "top_down_maze_exploration",
      challenge: "collect_siblings",
      art_style: "simple_sprite_images",
      sprite_source: "generate_simple_png_sprites_programmatically",
    });
    expect(step("py-9-03").replay?.workflow?.canonicalAnswers).toEqual({
      transition: "brief_level_complete_screen_then_auto_advance",
      difficulty_style: "add_patrol_variety",
      sibling_count: "increase_siblings_per_level_e_g_6_8_10",
    });
    expect(step("py-10-01").replay?.workflow?.canonicalAnswers).toEqual({
      level_format: "json_files",
      editor_ui: "standalone_script",
      feature_scope: "core_grid_placement",
    });
    expect(step("py-10-03").replay?.workflow?.canonicalAnswers).toEqual({
      fox_handling: "ignore_foxes_check_static_connectivity",
      animation_style: "frontier_expansion_final_path",
    });
  });

  test("hands each exercise the checkpoint produced by the preceding prompt", () => {
    const step = (id: string) => content.steps.find((item) => item.id === id)!;
    expect([
      step("py-9-01").replay?.initialState?.fromExercise,
      step("py-9-02").replay?.initialState?.fromExercise,
      step("py-9-03").replay?.initialState?.fromExercise,
      step("py-10-01").replay?.initialState?.fromExercise,
      step("py-10-02").replay?.initialState?.fromExercise,
      step("py-10-03").replay?.initialState?.fromExercise,
    ]).toEqual([undefined, "py-9-01", "py-9-02", "py-9-03", "py-10-01", "py-10-02"]);
    expect(step("py-10-01").scaffold?.files.find((file) => file.path === "level.py")?.content)
      .toContain("def save_level_def(level_def, path):");
  });

  test("maps launch instructions to the runnable game and editor entrypoints", () => {
    for (const example of chapter(9).examples)
      expect(example.steps[0]?.scaffold?.entrypoint).toBe("main.py");
    for (const example of chapter(10).examples)
      expect(example.steps[0]?.scaffold?.entrypoint).toBe("level_editor.py");
  });

  test("uses the wheel-backed pygame distribution while preserving the pygame import", () => {
    for (const example of [...chapter(9).examples, ...chapter(10).examples])
      expect(example.dependencies).toEqual([
        { kind: "python-package", package: "pygame-ce", module: "pygame" },
        { kind: "python-package", package: "Pillow", module: "PIL" },
      ]);
  });
});
