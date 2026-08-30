import json
from dataclasses import asdict, dataclass, field
from itertools import cycle
from pathlib import Path

import pygame

from constants import TILE_SIZE, GRID_COLS, GRID_ROWS, SCREEN_WIDTH, SCREEN_HEIGHT, FOX_SPEED
from entities import Player, Sibling, Mother, Obstacle, Fox

OBSTACLE_IMAGE_KEYS = {"rock": "rock", "bush": "bush", "water": "water_tile"}

LEVELS_DIR = Path(__file__).parent / "levels"


@dataclass
class LevelDef:
    obstacle_layout: list       # [(col, row, kind), ...]
    sibling_spawns: list        # [(col, row), ...]
    mother_pos: tuple           # (col, row)
    player_start: tuple         # (col, row)
    # fox patrols: ("h", row, min_col, max_col) or ("v", col, min_row, max_row)
    fox_patrols: list = field(default_factory=list)
    fox_speed: float = FOX_SPEED


def load_level_def(path):
    with open(path) as f:
        data = json.load(f)
    return LevelDef(**data)


def save_level_def(level_def, path):
    with open(path, "w") as f:
        json.dump(asdict(level_def), f, indent=4)


def load_levels(levels_dir=LEVELS_DIR):
    return [load_level_def(p) for p in sorted(levels_dir.glob("*.json"))]


LEVELS = load_levels()


def grid_to_px(col, row):
    return col * TILE_SIZE, row * TILE_SIZE


def build_level(images, level_index=0):
    level_def = LEVELS[level_index]

    px, py = grid_to_px(*level_def.player_start)
    player = Player(px, py, images["duckling"])

    obstacles = pygame.sprite.Group()
    for col, row, kind in level_def.obstacle_layout:
        x, y = grid_to_px(col, row)
        obstacles.add(Obstacle(x, y, images[OBSTACLE_IMAGE_KEYS[kind]]))

    siblings = pygame.sprite.Group()
    sibling_images = cycle([images["sibling_1"], images["sibling_2"], images["sibling_3"]])
    for (col, row), image in zip(level_def.sibling_spawns, sibling_images):
        x, y = grid_to_px(col, row)
        siblings.add(Sibling(x, y, image))

    mx, my = grid_to_px(*level_def.mother_pos)
    mother = Mother(mx, my, images["mother_duck"])

    foxes = pygame.sprite.Group()
    for axis, fixed, lo, hi in level_def.fox_patrols:
        if axis == "h":
            row = fixed
            min_x, y = grid_to_px(lo, row)
            max_x, _ = grid_to_px(hi, row)
            foxes.add(Fox(min_x, y, images["fox"], min_x, max_x,
                          speed=level_def.fox_speed, vertical=False))
        else:  # "v"
            col = fixed
            x, min_y = grid_to_px(col, lo)
            _, max_y = grid_to_px(col, hi)
            foxes.add(Fox(x, min_y, images["fox"], min_y, max_y,
                          speed=level_def.fox_speed, vertical=True))

    return player, obstacles, siblings, mother, foxes


def build_background(images):
    surface = pygame.Surface((SCREEN_WIDTH, SCREEN_HEIGHT))
    grass = images["grass_tile"]
    for row in range(GRID_ROWS):
        for col in range(GRID_COLS):
            surface.blit(grass, (col * TILE_SIZE, row * TILE_SIZE))
    return surface
