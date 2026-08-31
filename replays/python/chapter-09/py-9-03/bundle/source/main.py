from enum import Enum

import pygame

from assets_gen import ensure_assets, EXPECTED_FILES
from constants import (
    ASSET_DIR, SCREEN_WIDTH, SCREEN_HEIGHT, FPS,
    HUD_COLOR, WIN_TEXT_COLOR, WIN_OVERLAY_COLOR,
    CAUGHT_TEXT_COLOR, CAUGHT_MESSAGE_DURATION, LEVEL_COMPLETE_DURATION,
)
import level


class GameState(Enum):
    PLAYING = 1
    LEVEL_COMPLETE = 3
    WIN = 2


def load_level(images, level_index):
    player, obstacles, siblings, mother, foxes = level.build_level(images, level_index)
    player_start_px = level.grid_to_px(*level.LEVELS[level_index].player_start)
    total_siblings = len(siblings)
    return player, obstacles, siblings, mother, foxes, player_start_px, total_siblings


def load_images():
    images = {}
    for filename in EXPECTED_FILES:
        name = filename[:-4]  # strip ".png"
        images[name] = pygame.image.load(ASSET_DIR / filename).convert_alpha()
    return images


def main():
    ensure_assets()

    pygame.init()
    screen = pygame.display.set_mode((SCREEN_WIDTH, SCREEN_HEIGHT))
    pygame.display.set_caption("Save the Duckling")
    clock = pygame.time.Clock()

    images = load_images()
    background = level.build_background(images)

    current_level = 0
    (player, obstacles, siblings, mother, foxes,
     player_start_px, total_siblings) = load_level(images, current_level)

    font_hud = pygame.font.SysFont(None, 28)
    font_win = pygame.font.SysFont(None, 56)
    font_win_sub = pygame.font.SysFont(None, 28)

    state = GameState.PLAYING
    collected = 0
    caught_flash = 0.0
    level_complete_timer = 0.0

    overlay = pygame.Surface((SCREEN_WIDTH, SCREEN_HEIGHT), pygame.SRCALPHA)
    overlay.fill(WIN_OVERLAY_COLOR)

    running = True
    while running:
        dt = clock.tick(FPS) / 1000

        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                running = False
            elif event.type == pygame.KEYDOWN and event.key == pygame.K_ESCAPE:
                running = False

        if state == GameState.PLAYING:
            keys = pygame.key.get_pressed()
            player.handle_input(keys)
            player.update(dt, obstacles)
            foxes.update(dt)

            newly_collected = pygame.sprite.spritecollide(player, siblings, dokill=True)
            collected += len(newly_collected)

            if pygame.sprite.spritecollideany(player, foxes):
                player.reset_to(*player_start_px)
                caught_flash = CAUGHT_MESSAGE_DURATION

            if player.rect.colliderect(mother.rect) and collected >= total_siblings:
                if current_level + 1 < len(level.LEVELS):
                    state = GameState.LEVEL_COMPLETE
                    level_complete_timer = LEVEL_COMPLETE_DURATION
                else:
                    state = GameState.WIN

        elif state == GameState.LEVEL_COMPLETE:
            level_complete_timer -= dt
            if level_complete_timer <= 0:
                current_level += 1
                (player, obstacles, siblings, mother, foxes,
                 player_start_px, total_siblings) = load_level(images, current_level)
                collected = 0
                caught_flash = 0.0
                state = GameState.PLAYING

        if caught_flash > 0:
            caught_flash = max(0.0, caught_flash - dt)

        screen.blit(background, (0, 0))
        obstacles.draw(screen)
        screen.blit(mother.image, mother.rect)
        siblings.draw(screen)
        foxes.draw(screen)
        screen.blit(player.image, player.rect)

        hud_text = font_hud.render(
            f"Level {current_level + 1}/{len(level.LEVELS)}   "
            f"Siblings found: {collected}/{total_siblings}",
            True, HUD_COLOR,
        )
        screen.blit(hud_text, (10, 10))
        hint_text = font_hud.render("Arrows / WASD to move", True, HUD_COLOR)
        screen.blit(hint_text, (10, SCREEN_HEIGHT - 30))

        if caught_flash > 0:
            caught_text = font_hud.render("The fox caught you! Back to start.", True, CAUGHT_TEXT_COLOR)
            caught_rect = caught_text.get_rect(center=(SCREEN_WIDTH // 2, 20))
            screen.blit(caught_text, caught_rect)

        if state == GameState.LEVEL_COMPLETE:
            screen.blit(overlay, (0, 0))
            complete_text = font_win.render(
                f"Level {current_level + 1} Complete!", True, WIN_TEXT_COLOR
            )
            complete_rect = complete_text.get_rect(center=(SCREEN_WIDTH // 2, SCREEN_HEIGHT // 2 - 20))
            screen.blit(complete_text, complete_rect)
            sub_text = font_win_sub.render("Get ready...", True, WIN_TEXT_COLOR)
            sub_rect = sub_text.get_rect(center=(SCREEN_WIDTH // 2, SCREEN_HEIGHT // 2 + 30))
            screen.blit(sub_text, sub_rect)

        if state == GameState.WIN:
            screen.blit(overlay, (0, 0))
            win_text = font_win.render("You found your family!", True, WIN_TEXT_COLOR)
            win_rect = win_text.get_rect(center=(SCREEN_WIDTH // 2, SCREEN_HEIGHT // 2 - 20))
            screen.blit(win_text, win_rect)
            sub_text = font_win_sub.render("Press ESC to quit", True, WIN_TEXT_COLOR)
            sub_rect = sub_text.get_rect(center=(SCREEN_WIDTH // 2, SCREEN_HEIGHT // 2 + 30))
            screen.blit(sub_text, sub_rect)

        pygame.display.flip()

    pygame.quit()


if __name__ == "__main__":
    main()
