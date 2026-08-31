from itertools import cycle

import pygame

from constants import TILE_SIZE, GRID_COLS, GRID_ROWS, SCREEN_WIDTH, SCREEN_HEIGHT
from entities import Player, Sibling, Mother, Obstacle, Fox

# (col, row, kind) -- interior obstacles only; outer map bounds are handled
# by clamping in Player.update, not by border tiles.
OBSTACLE_LAYOUT = [
    (3, 2, "rock"), (3, 3, "rock"), (4, 3, "bush"),
    (7, 5, "bush"), (7, 6, "bush"), (8, 5, "rock"),
    (10, 1, "rock"), (10, 2, "rock"),
    (13, 8, "bush"), (14, 9, "bush"), (14, 10, "rock"),
    (5, 11, "rock"), (6, 11, "bush"),
    (17, 4, "bush"), (17, 5, "rock"),
    # small pond cluster near mother
    (18, 8, "water"), (19, 8, "water"), (20, 8, "water"),
    (18, 9, "water"), (19, 9, "water"), (20, 9, "water"),
]

SIBLING_SPAWNS = [(2, 10), (9, 3), (13, 12), (5, 7), (20, 2), (16, 12)]

MOTHER_POS = (21, 10)
PLAYER_START = (1, 1)

# (row, min_col, max_col) -- patrol rows chosen clear of obstacles, so foxes
# never need obstacle collision of their own.
FOX_PATROLS = [
    (6, 10, 16),
    (13, 2, 20),
]

TOTAL_SIBLINGS = len(SIBLING_SPAWNS)

OBSTACLE_IMAGE_KEYS = {"rock": "rock", "bush": "bush", "water": "water_tile"}


def grid_to_px(col, row):
    return col * TILE_SIZE, row * TILE_SIZE


def build_level(images):
    px, py = grid_to_px(*PLAYER_START)
    player = Player(px, py, images["duckling"])

    obstacles = pygame.sprite.Group()
    for col, row, kind in OBSTACLE_LAYOUT:
        x, y = grid_to_px(col, row)
        obstacles.add(Obstacle(x, y, images[OBSTACLE_IMAGE_KEYS[kind]]))

    siblings = pygame.sprite.Group()
    sibling_images = cycle([images["sibling_1"], images["sibling_2"], images["sibling_3"]])
    for (col, row), image in zip(SIBLING_SPAWNS, sibling_images):
        x, y = grid_to_px(col, row)
        siblings.add(Sibling(x, y, image))

    mx, my = grid_to_px(*MOTHER_POS)
    mother = Mother(mx, my, images["mother_duck"])

    foxes = pygame.sprite.Group()
    for row, min_col, max_col in FOX_PATROLS:
        min_x, y = grid_to_px(min_col, row)
        max_x, _ = grid_to_px(max_col, row)
        foxes.add(Fox(min_x, y, min_x, max_x, images["fox"]))

    return player, obstacles, siblings, mother, foxes


def build_background(images):
    surface = pygame.Surface((SCREEN_WIDTH, SCREEN_HEIGHT))
    grass = images["grass_tile"]
    for row in range(GRID_ROWS):
        for col in range(GRID_COLS):
            surface.blit(grass, (col * TILE_SIZE, row * TILE_SIZE))
    return surface
