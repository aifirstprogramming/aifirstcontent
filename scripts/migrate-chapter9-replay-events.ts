#!/usr/bin/env bun

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RawBook, ReplayEvent, ReplayOperation, RawExample } from "../src/types";

const bookPath = join(import.meta.dir, "..", "books", "ai-first-python-programming.json");
const book = JSON.parse(readFileSync(bookPath, "utf8")) as RawBook;

function example(id: string): RawExample {
  for (const section of book.sections) {
    for (const chapter of section.chapters) {
      const found = chapter.examples.find((candidate) => candidate.id === id);
      if (found) return found;
    }
  }
  throw new Error(`Missing ${id}`);
}

function fileContent(item: RawExample, path: string): string {
  const content = item.scaffold?.files.find((file) => file.path === path)?.content;
  if (content === undefined) throw new Error(`${item.id} has no scaffold content for ${path}`);
  return content;
}

const text = (value: string): ReplayEvent => ({ type: "text", text: value });
const status = (value: string): ReplayEvent => ({ type: "status", text: value });
const operation = (value: ReplayOperation): ReplayEvent => ({ type: "operation", operation: value });
const read = (path: string): ReplayEvent => operation({ type: "read", path });
const edit = (path: string, oldText: string, newText: string, replaceAll?: boolean): ReplayEvent =>
  operation({ type: "edit", path, oldText, newText, ...(replaceAll === undefined ? {} : { replaceAll }) });

function section(value: string, start: string, end: string): string {
  const from = value.indexOf(start);
  const to = value.indexOf(end, from);
  if (from < 0 || to < 0) throw new Error(`Could not find section ${start} ... ${end}`);
  return value.slice(from, to);
}

function editState(
  state: Record<string, string>,
  path: string,
  oldText: string,
  newText: string,
  replaceAll = false,
): ReplayEvent {
  const current = state[path];
  if (!current.includes(oldText)) throw new Error(`${path} does not contain captured edit text: ${oldText.slice(0, 80)}`);
  if (!replaceAll && current.indexOf(oldText) !== current.lastIndexOf(oldText)) throw new Error(`${path} edit is ambiguous`);
  state[path] = replaceAll ? current.split(oldText).join(newText) : current.replace(oldText, newText);
  return edit(path, oldText, newText, replaceAll || undefined);
}

function assertState(state: Record<string, string>, item: RawExample): void {
  for (const [path, content] of Object.entries(state)) {
    if (content !== fileContent(item, path)) throw new Error(`${item.id} event edits do not produce ${path}`);
  }
}

const duckling = example("py-9-01");
const fox = example("py-9-02");
const levels = example("py-9-03");
if (!duckling.replay || !fox.replay || !levels.replay) throw new Error("Chapter 9 replay data is missing");

for (const question of duckling.replay.workflow?.questions ?? []) {
  if (["gameplay", "challenge", "visual_style"].includes(question.id)) question.group = "game_design";
  if (question.id === "gameplay") question.question = "What style of gameplay should the duckling's search take?";
  if (question.id === "challenge") question.question = "What should make the search challenging (beyond just walking to the goal)?";
  if (question.id === "visual_style") question.question = "What visual style for the duckling, mother, and world?";
  if (question.id === "asset_source") {
    question.question = "There are no existing image assets in the project folder. How should the duckling/mother/sibling/background sprites be sourced?";
  }
}
for (const question of levels.replay.workflow?.questions ?? []) {
  question.group = "level_design";
  if (question.id === "transition") question.question = "How should the game transition between levels?";
  if (question.id === "difficulty") question.question = "How should difficulty ramp up across the 3 levels, beyond just more obstacles/foxes?";
  if (question.id === "siblings") question.question = "Should the number of siblings to collect also increase in later levels?";
}

const duckOps = duckling.replay.operations;
duckling.replay.prePlanEvents = [
  operation({ type: "command", command: ["ls", "-la"], readOnly: true }),
  operation({
    type: "command",
    command: ["bash", "-lc", "unset PYGAME_HIDE_SUPPORT_PROMPT; python3 --version; python3 -c 'import pygame; print(pygame.ver)'"],
    readOnly: true,
  }),
  text("Good — Python 3.11.9 and pygame 2.6.1 are already installed, and the project folder is empty, so this is a greenfield build. Let me pin down the game design before planning."),
];
if (duckling.replay.workflow) {
  duckling.replay.workflow.interludes = [{
    afterQuestion: "asset_source",
    events: [
      operation({ type: "command", command: ["python3", "-c", "import PIL; print(PIL.__version__)"], readOnly: true }),
      text("Pillow is available too. Now let me get a design plan drafted."),
      status("Plan(Design pygame duckling game architecture)"),
      text("I've kicked off the design planning agent — it's working in the background. I'll let you know once it's back with a concrete implementation plan."),
      status('Agent "Design pygame duckling game architecture" finished'),
      status("Updated plan"),
    ],
  }];
}
duckling.replay.events = [
  text("Now I'll implement the plan, starting with constants and the asset generator."),
  operation(duckOps[1]),
  operation(duckOps[2]),
  operation(duckOps[3]),
  operation(duckOps[4]),
  operation(duckOps[5]),
  text("Now let's generate the assets and verify everything runs correctly."),
  operation({ type: "command", command: ["bash", "-lc", "python3 assets_gen.py && ls assets"] }),
  text("All 9 assets generated. Let me sanity-check a couple of them visually and then confirm there are no runtime errors."),
  read("assets/duckling.png"),
  read("assets/mother_duck.png"),
  read("assets/bush.png"),
  text("Sprites look good — cute little ducks and a bush. Now let's smoke-test the game headlessly (run a few frames) to make sure everything wires together without runtime errors."),
  operation(duckOps[7]),
  text("Found a bug — the obstacle kind strings don't match the image dictionary keys: water is stored as water_tile. Let me fix the mapping in level.py."),
  edit("level.py", (duckOps[4] as Extract<ReplayOperation, { type: "write" }>).content, (duckOps[8] as Extract<ReplayOperation, { type: "write" }>).content),
  operation(duckOps[9]),
  text("The core logic (movement, collision, collecting siblings, win condition) checks out. Let me also capture a real render frame as a screenshot to visually confirm the level looks right."),
  operation(duckOps[10]),
  read("screenshot.png"),
  text("This looks great — the level is readable, mother duck by the pond, six sibling ducklings scattered around, rocks and bushes forming a loose maze, and the player duckling starting top-left. Let me clean up the test screenshot file and do a final check that the real main.py launches cleanly on the actual display."),
  operation({ type: "command", command: ["rm", "screenshot.png"] }),
  operation({ type: "command", command: ["timeout", "3", "python3", "main.py"], env: { SDL_VIDEODRIVER: "dummy", PYGAME_HIDE_SUPPORT_PROMPT: "1" }, expectedExitCode: 124 }),
];
duckling.replay.completionText = duckling.replay.commentary?.[12];

const foxOps = fox.replay.operations;
const projectFiles = ["constants.py", "assets_gen.py", "entities.py", "level.py", "main.py"];
const foxState = Object.fromEntries(projectFiles.map((path) => [path, fileContent(duckling, path)]));
const foxAssets = fileContent(fox, "assets_gen.py");
const foxEntities = fileContent(fox, "entities.py");
fox.replay.events = [
  ...projectFiles.map(read),
  editState(foxState, "constants.py", fileContent(duckling, "constants.py"), fileContent(fox, "constants.py")),
  editState(foxState, "assets_gen.py", '    "bush.png",\n]', '    "bush.png",\n    "fox.png",\n]'),
  editState(foxState, "assets_gen.py", "def ensure_assets", `\n${section(foxAssets, "def _draw_fox", "def ensure_assets")}def ensure_assets`),
  editState(foxState, "assets_gen.py", '    _draw_bush(40).save(ASSET_DIR / "bush.png")', '    _draw_bush(40).save(ASSET_DIR / "bush.png")\n    _draw_fox(44, 32).save(ASSET_DIR / "fox.png")'),
  text("Now let's regenerate and preview the fox sprite before wiring it into the game logic."),
  operation(foxOps[2]),
  read("assets/fox.png"),
  text("That reads clearly as a fox — bushy tail, pointy ears, snout. Now let's add the `Fox` entity with patrol movement."),
  editState(foxState, "entities.py", "from constants import SCREEN_WIDTH, SCREEN_HEIGHT, PLAYER_SPEED", "from constants import SCREEN_WIDTH, SCREEN_HEIGHT, PLAYER_SPEED, FOX_SPEED"),
  editState(foxState, "entities.py", "class Player", `${section(foxEntities, "class Fox", "class Player")}class Player`),
  text("Now let's wire foxes into the level layout."),
  editState(foxState, "level.py", "from entities import Player, Sibling, Mother, Obstacle", "from entities import Player, Sibling, Mother, Obstacle, Fox"),
  editState(foxState, "level.py", "TOTAL_SIBLINGS = len(SIBLING_SPAWNS)", `${section(fileContent(fox, "level.py"), "# (row, min_col", "TOTAL_SIBLINGS")}TOTAL_SIBLINGS = len(SIBLING_SPAWNS)`),
  editState(foxState, "level.py", "_grid_to_px", "grid_to_px", true),
  text("Now update `main.py` to unpack, update, draw, and handle collision with foxes."),
  editState(foxState, "main.py", "    HUD_COLOR, WIN_TEXT_COLOR, WIN_OVERLAY_COLOR,\n", "    HUD_COLOR, WIN_TEXT_COLOR, WIN_OVERLAY_COLOR,\n    CAUGHT_TEXT_COLOR, CAUGHT_MESSAGE_DURATION,\n"),
  editState(foxState, "main.py", "    player, obstacles, siblings, mother = level.build_level(images)", "    player, obstacles, siblings, mother, foxes = level.build_level(images)"),
  editState(foxState, "main.py", "    collected = 0\n", "    collected = 0\n    caught_flash = 0.0\n    player_start_px = level.grid_to_px(*level.PLAYER_START)\n"),
  editState(foxState, "level.py", "    return player, obstacles, siblings, mother", `${section(fileContent(fox, "level.py"), "    foxes = pygame.sprite.Group()", "    return player, obstacles, siblings, mother, foxes")}    return player, obstacles, siblings, mother, foxes`),
  text("Now add a `reset_to` helper on `Player` and wire the fox-collision handling into the game loop."),
  editState(foxState, "entities.py", "    def handle_input", `${section(foxEntities, "    def reset_to", "    def handle_input")}    def handle_input`),
  text("Now update `main.py`'s loop logic and drawing/HUD."),
  editState(
    foxState,
    "main.py",
    section(fileContent(duckling, "main.py"), "        if state == GameState.PLAYING:", "        hud_text ="),
    section(fileContent(fox, "main.py"), "        if state == GameState.PLAYING:", "        hud_text ="),
  ),
  editState(foxState, "main.py", "        if state == GameState.WIN:", `${section(fileContent(fox, "main.py"), "        if caught_flash > 0:\n            caught_text", "        if state == GameState.WIN:")}        if state == GameState.WIN:`),
  text("Now let's re-run the headless smoke test and a full render screenshot to confirm the fox works correctly."),
  operation(foxOps[6]),
  text("Fox patrol and catch logic work correctly. Let's grab a visual screenshot to confirm the fox renders correctly in context on the map."),
  operation(foxOps[7]),
  read("screenshot.png"),
  text("Two foxes are visible on the map — one patrolling near the middle-top row, one on the lower-left row — clearly distinct from the ducklings. Let's clean up the test screenshot and do a final live launch check."),
  operation({ type: "command", command: ["bash", "-lc", "rm screenshot.png && timeout 3 python3 main.py; code=$?; echo \"exit code: $code\"; exit $code"], env: { SDL_VIDEODRIVER: "dummy", PYGAME_HIDE_SUPPORT_PROMPT: "1" }, expectedExitCode: 124 }),
];
assertState(foxState, fox);
fox.replay.completionText = fox.replay.commentary?.[9];

const levelOps = levels.replay.operations;
levels.replay.prePlanEvents = [
  read("main.py"),
  read("level.py"),
  read("entities.py"),
  read("constants.py"),
  read("assets_gen.py"),
];
if (levels.replay.workflow) {
  levels.replay.workflow.interludes = [{
    afterQuestion: "siblings",
    events: [
      status("Plan(Design multi-level progression for duckling game)"),
      text("The design agent is working on the multi-level plan in the background — I'll follow up once it's done."),
      status('Agent "Design multi-level progression for duckling game" finished'),
      text("Let me verify the proposed level 2/3 layouts are actually free of overlaps and that patrol lanes are clear, before locking this into the plan."),
      operation({
        type: "command",
        command: ["python3", "-c", "print('=== LEVEL_2 ===\\nobstacles: 34 siblings: 8 foxes: 3\\n\\n=== LEVEL_3 ===\\nobstacles: 43 siblings: 10 foxes: 5')"],
        readOnly: true,
        expectedStdout: "=== LEVEL_2 ===\nobstacles: 34 siblings: 8 foxes: 3\n\n=== LEVEL_3 ===\nobstacles: 43 siblings: 10 foxes: 5\n",
      }),
      text("Good — no overlaps or blocked patrol lanes. Let me also verify the maps are actually navigable (no obstacle walls accidentally sealing off mother or siblings from the player start)."),
      operation({
        type: "command",
        command: ["python3", "-c", "print('--- LEVEL_2 --- reachable tiles: 350 / 350 open tiles\\nall targets REACHABLE\\n--- LEVEL_3 --- reachable tiles: 341 / 341 open tiles\\nall targets REACHABLE')"],
        readOnly: true,
        expectedStdout: "--- LEVEL_2 --- reachable tiles: 350 / 350 open tiles\nall targets REACHABLE\n--- LEVEL_3 --- reachable tiles: 341 / 341 open tiles\nall targets REACHABLE\n",
      }),
      text("Both maps are fully connected — every sibling and the mother are reachable from the player's start, and no obstacle tiles overlap or block any patrol lane. The design is sound. Let me write the final plan."),
      status("Updated plan"),
    ],
  }];
}
const levelState = Object.fromEntries(projectFiles.map((path) => [path, fileContent(fox, path)]));
levels.replay.events = [
  text("Now implementing. Starting with `constants.py` and `entities.py`."),
  editState(levelState, "constants.py", fileContent(fox, "constants.py"), fileContent(levels, "constants.py")),
  editState(levelState, "entities.py", section(fileContent(fox, "entities.py"), "class Fox", "class Player"), section(fileContent(levels, "entities.py"), "class Fox", "class Player")),
  text("Now rewrite `level.py` with the multi-level structure."),
  operation({ type: "write", path: "level.py", content: fileContent(levels, "level.py") }),
  text("Now update `main.py` for the level progression state machine."),
  editState(levelState, "main.py", section(fileContent(fox, "main.py"), "from constants", "def load_images"), section(fileContent(levels, "main.py"), "from constants", "def load_images")),
  editState(levelState, "main.py", section(fileContent(fox, "main.py"), "    images = load_images()", "    overlay ="), section(fileContent(levels, "main.py"), "    images = load_images()", "    overlay =")),
  editState(levelState, "main.py", section(fileContent(fox, "main.py"), "        if state == GameState.PLAYING:", "        if caught_flash > 0:"), section(fileContent(levels, "main.py"), "        if state == GameState.PLAYING:", "        if caught_flash > 0:")),
  text("Now the HUD text and the LEVEL_COMPLETE overlay drawing."),
  editState(levelState, "main.py", section(fileContent(fox, "main.py"), "        hud_text =", "        if caught_flash > 0:\n            caught_text"), section(fileContent(levels, "main.py"), "        hud_text =", "        if caught_flash > 0:\n            caught_text")),
  editState(levelState, "main.py", "        if state == GameState.WIN:", `${section(fileContent(levels, "main.py"), "        if state == GameState.LEVEL_COMPLETE:", "        if state == GameState.WIN:")}        if state == GameState.WIN:`),
  text("Let me review the full `main.py` to confirm the flow is correct end-to-end."),
  read("main.py"),
  text("Now let's run the headless smoke test across all three levels."),
  operation(levelOps[6]),
  operation(levelOps[7]),
  text("The full progression works exactly as designed: level 1 → level 2 (8 siblings) → level 3 (10 siblings) → final WIN. Now let's grab visual screenshots of all three levels."),
  operation(levelOps[8]),
  read("screenshot_level1.png"),
  read("screenshot_level2.png"),
  read("screenshot_level3.png"),
  text("All three levels look great — clear visual escalation from sparse (level 1) to a denser pond-cluster maze (level 2) to a symmetric corridor maze with visible vertical patrol lanes (level 3). Let's clean up test files and do a final live launch check."),
  operation({ type: "command", command: ["rm", "screenshot_level1.png", "screenshot_level2.png", "screenshot_level3.png"] }),
  operation({ type: "command", command: ["timeout", "3", "python3", "main.py"], env: { SDL_VIDEODRIVER: "dummy", PYGAME_HIDE_SUPPORT_PROMPT: "1" }, expectedExitCode: 124 }),
];
levelState["level.py"] = fileContent(levels, "level.py");
assertState(levelState, levels);
levels.replay.completionText = levels.replay.commentary?.[10];

writeFileSync(bookPath, `${JSON.stringify(book, null, 2)}\n`);
