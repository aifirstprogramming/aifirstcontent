from dataclasses import dataclass, field
from itertools import cycle

import pygame

from constants import TILE_SIZE, GRID_COLS, GRID_ROWS, SCREEN_WIDTH, SCREEN_HEIGHT, FOX_SPEED
from entities import Player, Sibling, Mother, Obstacle, Fox

OBSTACLE_IMAGE_KEYS = {"rock": "rock", "bush": "bush", "water": "water_tile"}


@dataclass
class LevelDef:
    obstacle_layout: list       # [(col, row, kind), ...]
    sibling_spawns: list        # [(col, row), ...]
    mother_pos: tuple           # (col, row)
    player_start: tuple         # (col, row)
    # fox patrols: ("h", row, min_col, max_col) or ("v", col, min_row, max_row)
    fox_patrols: list = field(default_factory=list)
    fox_speed: float = FOX_SPEED


LEVEL_1 = LevelDef(
    obstacle_layout=[
        (3, 2, "rock"), (3, 3, "rock"), (4, 3, "bush"),
        (7, 5, "bush"), (7, 6, "bush"), (8, 5, "rock"),
        (10, 1, "rock"), (10, 2, "rock"),
        (13, 8, "bush"), (14, 9, "bush"), (14, 10, "rock"),
        (5, 11, "rock"), (6, 11, "bush"),
        (17, 4, "bush"), (17, 5, "rock"),
        # small pond cluster near mother
        (18, 8, "water"), (19, 8, "water"), (20, 8, "water"),
        (18, 9, "water"), (19, 9, "water"), (20, 9, "water"),
    ],
    sibling_spawns=[(2, 10), (9, 3), (13, 12), (5, 7), (20, 2), (16, 12)],
    mother_pos=(21, 10),
    player_start=(1, 1),
    fox_patrols=[
        ("h", 6, 10, 16),
        ("h", 13, 2, 20),
    ],
    fox_speed=FOX_SPEED,
)

LEVEL_2 = LevelDef(
    obstacle_layout=[
        (3, 2, "rock"), (4, 2, "rock"), (3, 3, "bush"), (7, 2, "bush"),
        (8, 3, "rock"), (9, 3, "rock"), (2, 4, "bush"),
        (15, 2, "rock"), (16, 2, "bush"), (19, 3, "bush"), (20, 4, "rock"),
        (10, 3, "water"), (10, 4, "water"), (11, 4, "water"),
        (2, 6, "rock"), (3, 7, "bush"), (4, 6, "bush"), (5, 7, "rock"),
        (17, 6, "water"), (18, 6, "water"),
        (6, 8, "rock"), (7, 9, "bush"), (7, 8, "rock"),
        (14, 8, "bush"), (15, 9, "rock"), (15, 8, "bush"),
        (3, 12, "bush"), (4, 13, "rock"), (9, 13, "bush"),
        (10, 12, "rock"), (17, 12, "rock"),
        (8, 14, "rock"), (20, 14, "water"), (21, 14, "water"),
    ],
    sibling_spawns=[(2, 2), (13, 3), (22, 4), (2, 9), (13, 9), (22, 9), (2, 13), (13, 14)],
    mother_pos=(22, 1),
    player_start=(1, 14),
    fox_patrols=[
        ("h", 5, 2, 21),
        ("h", 11, 3, 20),
        ("v", 12, 2, 13),
    ],
    fox_speed=105.0,
)

LEVEL_3 = LevelDef(
    obstacle_layout=[
        (2, 2, "rock"), (3, 2, "rock"), (4, 3, "bush"), (9, 2, "bush"),
        (10, 3, "rock"), (14, 2, "rock"), (15, 3, "bush"), (20, 2, "bush"), (21, 3, "rock"),
        (2, 1, "bush"), (9, 1, "rock"), (15, 1, "rock"), (21, 1, "bush"),
        (2, 6, "bush"), (3, 6, "rock"), (9, 5, "rock"), (9, 6, "bush"),
        (15, 6, "rock"), (15, 7, "bush"), (21, 6, "bush"), (21, 7, "rock"),
        (11, 7, "water"), (12, 7, "water"), (13, 7, "water"),
        (2, 10, "rock"), (3, 10, "bush"), (9, 10, "rock"), (9, 11, "bush"),
        (15, 10, "bush"), (15, 11, "rock"), (21, 10, "rock"), (21, 11, "bush"),
        (11, 9, "water"), (12, 9, "water"), (13, 9, "water"),
        (2, 14, "bush"), (3, 13, "rock"), (9, 13, "bush"), (9, 14, "rock"),
        (15, 13, "rock"), (15, 14, "bush"), (21, 13, "bush"), (21, 14, "rock"),
    ],
    sibling_spawns=[
        (4, 2), (17, 2), (2, 5), (17, 6), (4, 9),
        (17, 10), (2, 13), (17, 14), (4, 11), (20, 7),
    ],
    mother_pos=(12, 0),
    player_start=(12, 15),
    fox_patrols=[
        ("h", 4, 2, 21),
        ("h", 8, 3, 20),
        ("h", 12, 2, 21),
        ("v", 6, 2, 13),
        ("v", 18, 2, 13),
    ],
    fox_speed=120.0,
)

LEVELS = [LEVEL_1, LEVEL_2, LEVEL_3]


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
