"""Standalone visual editor for Save the Duckling levels.

Run with `python level_editor.py`. Click on the grid to place obstacles,
sibling spawns, the mother duck, and the player start, then press S to
save the result as a JSON level file under levels/.

Press T to test whether the current level is beatable: an animated BFS
flood-fill searches for a path from the player through every sibling to
mother (ignoring fox patrols -- getting caught only resets you to the
start, it never permanently blocks a path). Press T again to dismiss.

Fox patrols are not editable here -- saved levels always have an empty
fox_patrols list, which can be hand-edited into the JSON afterward.
"""

import pygame

from assets_gen import ensure_assets, load_images
from constants import TILE_SIZE, GRID_COLS, GRID_ROWS, SCREEN_WIDTH, SCREEN_HEIGHT
from level import LEVELS_DIR, LevelDef, save_level_def, build_background, OBSTACLE_IMAGE_KEYS
from pathfinder import find_route

TOOLBAR_HEIGHT = 32
WINDOW_WIDTH = SCREEN_WIDTH
WINDOW_HEIGHT = SCREEN_HEIGHT + TOOLBAR_HEIGHT

GRID_LINE_COLOR = (60, 90, 40)

TOOLS = [
    ("1", "rock", ("obstacle", "rock")),
    ("2", "bush", ("obstacle", "bush")),
    ("3", "water", ("obstacle", "water")),
    ("4", "sibling", ("sibling",)),
    ("5", "mother", ("mother",)),
    ("6", "player", ("player",)),
    ("7", "eraser", None),
]
KEY_TO_TOOL = {
    pygame.K_1: 0, pygame.K_2: 1, pygame.K_3: 2,
    pygame.K_4: 3, pygame.K_5: 4, pygame.K_6: 5, pygame.K_7: 6,
}

ENTRY_IMAGE_KEYS = {
    "obstacle": OBSTACLE_IMAGE_KEYS,
    "sibling": {None: "sibling_1"},
    "mother": {None: "mother_duck"},
    "player": {None: "duckling"},
}

FLOOD_REVEAL_PER_FRAME = 25
PATH_REVEAL_PER_FRAME = 3
MARKER_SPEED_CELLS_PER_SEC = 6.0

FLOOD_COLOR = (90, 170, 255, 90)
FLOOD_FAIL_COLOR = (220, 70, 70, 110)
PATH_COLOR = (255, 210, 60)
MARKER_FILL_COLOR = (255, 255, 255)
MARKER_OUTLINE_COLOR = (0, 0, 0)
SUCCESS_TEXT_COLOR = (110, 230, 120)
FAIL_TEXT_COLOR = (240, 90, 90)


def entry_image_key(entry):
    kind = entry[0]
    sub = entry[1] if len(entry) > 1 else None
    return ENTRY_IMAGE_KEYS[kind][sub]


def pixel_to_cell(pos):
    x, y = pos
    if y >= SCREEN_HEIGHT:
        return None
    col, row = x // TILE_SIZE, y // TILE_SIZE
    if 0 <= col < GRID_COLS and 0 <= row < GRID_ROWS:
        return col, row
    return None


def next_default_filename():
    existing = {p.name for p in LEVELS_DIR.glob("level_*.json")}
    n = 1
    while f"level_{n}.json" in existing:
        n += 1
    return f"level_{n}.json"


def snapshot(placements):
    return dict(placements)


def commit_if_changed(undo_stack, redo_stack, before, placements):
    if placements != before:
        undo_stack.append(before)
        redo_stack.clear()


def apply_tool(placements, tool_entry, cell):
    if tool_entry is None:  # eraser
        placements.pop(cell, None)
        return

    kind = tool_entry[0]
    if kind in ("mother", "player"):
        stale = [c for c, e in placements.items() if e[0] == kind]
        for c in stale:
            del placements[c]

    placements[cell] = tool_entry


def save_level(placements):
    mother_cell = next((c for c, e in placements.items() if e[0] == "mother"), None)
    player_cell = next((c for c, e in placements.items() if e[0] == "player"), None)
    if mother_cell is None or player_cell is None:
        print("Cannot save: level needs both a mother and a player start placed.")
        return

    obstacle_layout = [
        [col, row, e[1]] for (col, row), e in placements.items() if e[0] == "obstacle"
    ]
    sibling_spawns = [
        [col, row] for (col, row), e in placements.items() if e[0] == "sibling"
    ]

    level_def = LevelDef(
        obstacle_layout=obstacle_layout,
        sibling_spawns=sibling_spawns,
        mother_pos=list(mother_cell),
        player_start=list(player_cell),
    )

    default_name = next_default_filename()
    filename = input(f"Save as [{default_name}]: ").strip() or default_name
    if not filename.endswith(".json"):
        filename += ".json"

    LEVELS_DIR.mkdir(exist_ok=True)
    out_path = LEVELS_DIR / filename
    save_level_def(level_def, out_path)
    print(f"Saved {out_path}")


# -- beatability test -------------------------------------------------------

def build_test_state(placements):
    """Returns (test_state, error_message). test_state is None if error_message is set."""
    mother_cell = next((c for c, e in placements.items() if e[0] == "mother"), None)
    player_cell = next((c for c, e in placements.items() if e[0] == "player"), None)
    if mother_cell is None or player_cell is None:
        return None, "Cannot test: level needs both a mother and a player start placed."

    blocked = {c for c, e in placements.items() if e[0] == "obstacle"}
    sibling_cells = {c for c, e in placements.items() if e[0] == "sibling"}

    sibling_legs, siblings_beatable, unreachable = find_route(
        player_cell, sibling_cells, blocked, GRID_COLS, GRID_ROWS
    )

    if siblings_beatable:
        last_cell = sibling_legs[-1]["goal"] if sibling_legs else player_cell
        mother_legs, beatable, mother_unreachable = find_route(
            last_cell, {mother_cell}, blocked, GRID_COLS, GRID_ROWS
        )
        legs = sibling_legs + mother_legs
        unreachable = mother_unreachable
        unreachable_kind = "mother" if not beatable else None
    else:
        legs = sibling_legs
        beatable = False
        unreachable_kind = "sibling"

    test_state = {
        "legs": legs,
        "leg_index": 0,
        "phase": "flood",
        "reveal_index": 0,
        "walk_progress": 0.0,
        "finalized_paths": [],
        "full_path": None,
        "beatable": beatable,
        "unreachable": unreachable,
        "unreachable_kind": unreachable_kind,
        "num_siblings": len(sibling_cells),
        "message": None,
    }
    return test_state, None


def advance_test_state(test_state, dt):
    if test_state is None or test_state["phase"] == "done":
        return

    legs = test_state["legs"]

    if test_state["phase"] == "flood":
        leg = legs[test_state["leg_index"]]
        test_state["reveal_index"] += FLOOD_REVEAL_PER_FRAME
        if test_state["reveal_index"] >= len(leg["visited_order"]):
            test_state["reveal_index"] = len(leg["visited_order"])
            if leg["path"] is None:
                kind = test_state["unreachable_kind"]
                test_state["message"] = f"Not beatable: {kind} at {test_state['unreachable']} is unreachable."
                test_state["phase"] = "done"
            else:
                test_state["phase"] = "path"
                test_state["reveal_index"] = 0

    elif test_state["phase"] == "path":
        leg = legs[test_state["leg_index"]]
        test_state["reveal_index"] += PATH_REVEAL_PER_FRAME
        if test_state["reveal_index"] >= len(leg["path"]):
            test_state["finalized_paths"].append(leg["path"])
            test_state["leg_index"] += 1
            test_state["reveal_index"] = 0
            if test_state["leg_index"] >= len(legs):
                full_path = []
                for path in test_state["finalized_paths"]:
                    if full_path and full_path[-1] == path[0]:
                        full_path.extend(path[1:])
                    else:
                        full_path.extend(path)
                test_state["full_path"] = full_path
                test_state["phase"] = "walk"
            else:
                test_state["phase"] = "flood"

    elif test_state["phase"] == "walk":
        full_path = test_state["full_path"]
        test_state["walk_progress"] += MARKER_SPEED_CELLS_PER_SEC * dt
        if test_state["walk_progress"] >= len(full_path) - 1:
            test_state["walk_progress"] = max(0, len(full_path) - 1)
            test_state["message"] = f"Beatable! Path found through {test_state['num_siblings']} sibling(s)."
            test_state["phase"] = "done"


def cell_center(cell):
    col, row = cell
    return col * TILE_SIZE + TILE_SIZE // 2, row * TILE_SIZE + TILE_SIZE // 2


def draw_path_line(screen, path, color):
    if not path:
        return
    if len(path) == 1:
        pygame.draw.circle(screen, color, cell_center(path[0]), 6)
        return
    pygame.draw.lines(screen, color, False, [cell_center(c) for c in path], width=4)


def draw_marker(screen, path, progress):
    if not path:
        return
    if len(path) == 1:
        cx, cy = cell_center(path[0])
    else:
        idx = min(int(progress), len(path) - 2)
        frac = progress - idx
        c0 = cell_center(path[idx])
        c1 = cell_center(path[idx + 1])
        cx = c0[0] + (c1[0] - c0[0]) * frac
        cy = c0[1] + (c1[1] - c0[1]) * frac
    pygame.draw.circle(screen, MARKER_FILL_COLOR, (int(cx), int(cy)), 8)
    pygame.draw.circle(screen, MARKER_OUTLINE_COLOR, (int(cx), int(cy)), 8, width=2)


def draw_test_overlay(screen, test_state, flood_tile, flood_fail_tile):
    if test_state is None:
        return

    for path in test_state["finalized_paths"]:
        draw_path_line(screen, path, PATH_COLOR)

    phase = test_state["phase"]
    legs = test_state["legs"]

    if phase == "walk" or (phase == "done" and test_state["beatable"]):
        draw_path_line(screen, test_state["full_path"], PATH_COLOR)
        draw_marker(screen, test_state["full_path"], test_state["walk_progress"])
        return

    # remaining cases (phase in "flood"/"path", or "done" after a failed leg)
    # all refer to the leg currently/last being animated, which is always in range here.
    leg = legs[test_state["leg_index"]]

    if phase == "done":
        for cell in leg["visited_order"]:
            screen.blit(flood_fail_tile, (cell[0] * TILE_SIZE, cell[1] * TILE_SIZE))
        return

    # phase in ("flood", "path")
    tile = flood_tile if leg["path"] is not None else flood_fail_tile
    shown = leg["visited_order"] if phase == "path" else leg["visited_order"][:test_state["reveal_index"]]
    for cell in shown:
        screen.blit(tile, (cell[0] * TILE_SIZE, cell[1] * TILE_SIZE))

    if phase == "path":
        draw_path_line(screen, leg["path"][:test_state["reveal_index"]], PATH_COLOR)


# -- drawing ------------------------------------------------------------

def draw_grid_lines(screen):
    for col in range(GRID_COLS + 1):
        x = col * TILE_SIZE
        pygame.draw.line(screen, GRID_LINE_COLOR, (x, 0), (x, SCREEN_HEIGHT))
    for row in range(GRID_ROWS + 1):
        y = row * TILE_SIZE
        pygame.draw.line(screen, GRID_LINE_COLOR, (0, y), (SCREEN_WIDTH, y))


def draw_toolbar(screen, font, tool_index, hover_cell, status_message, status_color):
    pygame.draw.rect(screen, (25, 25, 25), (0, SCREEN_HEIGHT, WINDOW_WIDTH, TOOLBAR_HEIGHT))

    if status_message:
        surf = font.render(status_message, True, status_color)
        screen.blit(surf, (8, SCREEN_HEIGHT + 8))
        return

    parts = []
    for i, (key, label, _) in enumerate(TOOLS):
        marker = f"[{label}]" if i == tool_index else label
        parts.append(f"{key}:{marker}")
    text = "  ".join(parts) + "   N:new  S:save  T:test  Ctrl+Z:Undo  Ctrl+Y:Redo  Esc:quit"
    if hover_cell:
        text += f"   ({hover_cell[0]},{hover_cell[1]})"
    surf = font.render(text, True, (230, 230, 230))
    screen.blit(surf, (8, SCREEN_HEIGHT + 8))


def main():
    ensure_assets()
    pygame.init()
    pygame.display.set_caption("Save the Duckling - Level Editor")
    screen = pygame.display.set_mode((WINDOW_WIDTH, WINDOW_HEIGHT))
    clock = pygame.time.Clock()
    font = pygame.font.SysFont(None, 20)

    images = load_images()
    background = build_background(images)

    flood_tile = pygame.Surface((TILE_SIZE, TILE_SIZE), pygame.SRCALPHA)
    flood_tile.fill(FLOOD_COLOR)
    flood_fail_tile = pygame.Surface((TILE_SIZE, TILE_SIZE), pygame.SRCALPHA)
    flood_fail_tile.fill(FLOOD_FAIL_COLOR)

    placements = {}
    tool_index = 0
    undo_stack = []
    redo_stack = []
    test_state = None
    status_message = ""
    status_color = (230, 230, 230)
    running = True

    while running:
        dt = clock.tick(60) / 1000
        hover_cell = pixel_to_cell(pygame.mouse.get_pos())

        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                running = False
            elif event.type == pygame.KEYDOWN:
                ctrl_held = pygame.key.get_mods() & pygame.KMOD_CTRL
                if event.key == pygame.K_ESCAPE:
                    running = False
                elif event.key == pygame.K_t:
                    if test_state is not None:
                        test_state = None
                        status_message = ""
                    else:
                        test_state, error = build_test_state(placements)
                        status_message = error or ""
                        status_color = FAIL_TEXT_COLOR
                elif test_state is not None:
                    pass  # ignore all other input while a test is running/showing
                elif event.key == pygame.K_z and ctrl_held:
                    if undo_stack:
                        redo_stack.append(snapshot(placements))
                        placements.clear()
                        placements.update(undo_stack.pop())
                elif event.key == pygame.K_y and ctrl_held:
                    if redo_stack:
                        undo_stack.append(snapshot(placements))
                        placements.clear()
                        placements.update(redo_stack.pop())
                elif event.key == pygame.K_n:
                    before = snapshot(placements)
                    placements.clear()
                    commit_if_changed(undo_stack, redo_stack, before, placements)
                    status_message = ""
                elif event.key == pygame.K_s:
                    save_level(placements)
                elif event.key in KEY_TO_TOOL:
                    tool_index = KEY_TO_TOOL[event.key]
            elif event.type == pygame.MOUSEBUTTONDOWN and test_state is None:
                cell = pixel_to_cell(event.pos)
                if cell is not None:
                    before = snapshot(placements)
                    if event.button == 1:
                        apply_tool(placements, TOOLS[tool_index][2], cell)
                    elif event.button == 3:
                        apply_tool(placements, None, cell)
                    commit_if_changed(undo_stack, redo_stack, before, placements)
                    status_message = ""

        if test_state is not None:
            advance_test_state(test_state, dt)
            if test_state["phase"] == "done" and test_state["message"]:
                status_message = test_state["message"]
                status_color = SUCCESS_TEXT_COLOR if test_state["beatable"] else FAIL_TEXT_COLOR

        screen.blit(background, (0, 0))
        draw_grid_lines(screen)

        for (col, row), entry in placements.items():
            image = images[entry_image_key(entry)]
            rect = image.get_rect(topleft=(col * TILE_SIZE, row * TILE_SIZE))
            screen.blit(image, rect)

        draw_test_overlay(screen, test_state, flood_tile, flood_fail_tile)

        if hover_cell is not None and test_state is None:
            x, y = hover_cell[0] * TILE_SIZE, hover_cell[1] * TILE_SIZE
            pygame.draw.rect(screen, (255, 255, 255), (x, y, TILE_SIZE, TILE_SIZE), width=2)

        draw_toolbar(screen, font, tool_index, hover_cell, status_message, status_color)
        pygame.display.flip()

    pygame.quit()


if __name__ == "__main__":
    main()
