import math

import pygame

from constants import SCREEN_WIDTH, SCREEN_HEIGHT, PLAYER_SPEED


class Obstacle(pygame.sprite.Sprite):
    def __init__(self, x, y, image):
        super().__init__()
        self.image = image
        self.rect = self.image.get_rect(topleft=(x, y))


class Sibling(pygame.sprite.Sprite):
    def __init__(self, x, y, image):
        super().__init__()
        self.image = image
        self.rect = self.image.get_rect(topleft=(x, y))


class Mother(pygame.sprite.Sprite):
    def __init__(self, x, y, image):
        super().__init__()
        self.image = image
        self.rect = self.image.get_rect(topleft=(x, y))


class Player(pygame.sprite.Sprite):
    def __init__(self, x, y, image):
        super().__init__()
        self.image = image
        self.rect = self.image.get_rect(topleft=(x, y))
        self.x = float(self.rect.x)
        self.y = float(self.rect.y)
        self.dx = 0.0
        self.dy = 0.0

    def handle_input(self, keys):
        dx = 0
        dy = 0
        if keys[pygame.K_LEFT] or keys[pygame.K_a]:
            dx -= 1
        if keys[pygame.K_RIGHT] or keys[pygame.K_d]:
            dx += 1
        if keys[pygame.K_UP] or keys[pygame.K_w]:
            dy -= 1
        if keys[pygame.K_DOWN] or keys[pygame.K_s]:
            dy += 1

        if dx != 0 and dy != 0:
            norm = 1 / math.sqrt(2)
            dx *= norm
            dy *= norm

        self.dx = dx
        self.dy = dy

    def update(self, dt, obstacles):
        # move on X axis, clamp to screen, revert on obstacle collision
        prev_x = self.x
        self.x += self.dx * PLAYER_SPEED * dt
        self.rect.x = round(self.x)
        self.rect.x = max(0, min(self.rect.x, SCREEN_WIDTH - self.rect.width))
        self.x = self.rect.x
        if pygame.sprite.spritecollideany(self, obstacles):
            self.x = prev_x
            self.rect.x = round(self.x)

        # move on Y axis, clamp to screen, revert on obstacle collision
        prev_y = self.y
        self.y += self.dy * PLAYER_SPEED * dt
        self.rect.y = round(self.y)
        self.rect.y = max(0, min(self.rect.y, SCREEN_HEIGHT - self.rect.height))
        self.y = self.rect.y
        if pygame.sprite.spritecollideany(self, obstacles):
            self.y = prev_y
            self.rect.y = round(self.y)
