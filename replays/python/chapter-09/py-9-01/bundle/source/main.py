from enum import Enum

import pygame

from assets_gen import ensure_assets, EXPECTED_FILES
from constants import (
    ASSET_DIR, SCREEN_WIDTH, SCREEN_HEIGHT, FPS,
    HUD_COLOR, WIN_TEXT_COLOR, WIN_OVERLAY_COLOR,
)
import level


class GameState(Enum):
    PLAYING = 1
    WIN = 2


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
    player, obstacles, siblings, mother = level.build_level(images)

    font_hud = pygame.font.SysFont(None, 28)
    font_win = pygame.font.SysFont(None, 56)
    font_win_sub = pygame.font.SysFont(None, 28)

    state = GameState.PLAYING
    collected = 0

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

            newly_collected = pygame.sprite.spritecollide(player, siblings, dokill=True)
            collected += len(newly_collected)

            if player.rect.colliderect(mother.rect) and collected >= level.TOTAL_SIBLINGS:
                state = GameState.WIN

        screen.blit(background, (0, 0))
        obstacles.draw(screen)
        screen.blit(mother.image, mother.rect)
        siblings.draw(screen)
        screen.blit(player.image, player.rect)

        hud_text = font_hud.render(
            f"Siblings found: {collected}/{level.TOTAL_SIBLINGS}", True, HUD_COLOR
        )
        screen.blit(hud_text, (10, 10))
        hint_text = font_hud.render("Arrows / WASD to move", True, HUD_COLOR)
        screen.blit(hint_text, (10, SCREEN_HEIGHT - 30))

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
