"""Standalone visual editor for Save the Duckling levels.

Run with `python level_editor.py`. Click on the grid to place obstacles,
sibling spawns, the mother duck, and the player start, then press S to
save the result as a JSON level file under levels/.

Fox patrols are not editable here -- saved levels always have an empty
fox_patrols list, which can be hand-edited into the JSON afterward.
"""

import pygame

from assets_gen import ensure_assets, load_images
from constants import TILE_SIZE, GRID_COLS, GRID_ROWS, SCREEN_WIDTH, SCREEN_HEIGHT
from level import LEVELS_DIR, LevelDef, save_level_def, build_background, OBSTACLE_IMAGE_KEYS

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


def draw_grid_lines(screen):
    for col in range(GRID_COLS + 1):
        x = col * TILE_SIZE
        pygame.draw.line(screen, GRID_LINE_COLOR, (x, 0), (x, SCREEN_HEIGHT))
    for row in range(GRID_ROWS + 1):
        y = row * TILE_SIZE
        pygame.draw.line(screen, GRID_LINE_COLOR, (0, y), (SCREEN_WIDTH, y))


def draw_toolbar(screen, font, tool_index, hover_cell):
    pygame.draw.rect(screen, (25, 25, 25), (0, SCREEN_HEIGHT, WINDOW_WIDTH, TOOLBAR_HEIGHT))
    parts = []
    for i, (key, label, _) in enumerate(TOOLS):
        marker = f"[{label}]" if i == tool_index else label
        parts.append(f"{key}:{marker}")
    text = "  ".join(parts) + "   N:new  S:save  Esc:quit"
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

    placements = {}
    tool_index = 0
    running = True

    while running:
        clock.tick(60)
        hover_cell = pixel_to_cell(pygame.mouse.get_pos())

        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                running = False
            elif event.type == pygame.KEYDOWN:
                if event.key == pygame.K_ESCAPE:
                    running = False
                elif event.key == pygame.K_n:
                    placements.clear()
                elif event.key == pygame.K_s:
                    save_level(placements)
                elif event.key in KEY_TO_TOOL:
                    tool_index = KEY_TO_TOOL[event.key]
            elif event.type == pygame.MOUSEBUTTONDOWN:
                cell = pixel_to_cell(event.pos)
                if cell is not None:
                    if event.button == 1:
                        apply_tool(placements, TOOLS[tool_index][2], cell)
                    elif event.button == 3:
                        apply_tool(placements, None, cell)

        screen.blit(background, (0, 0))
        draw_grid_lines(screen)

        for (col, row), entry in placements.items():
            image = images[entry_image_key(entry)]
            rect = image.get_rect(topleft=(col * TILE_SIZE, row * TILE_SIZE))
            screen.blit(image, rect)

        if hover_cell is not None:
            x, y = hover_cell[0] * TILE_SIZE, hover_cell[1] * TILE_SIZE
            pygame.draw.rect(screen, (255, 255, 255), (x, y, TILE_SIZE, TILE_SIZE), width=2)

        draw_toolbar(screen, font, tool_index, hover_cell)
        pygame.display.flip()

    pygame.quit()


if __name__ == "__main__":
    main()
