import math

import pygame

from constants import SCREEN_WIDTH, SCREEN_HEIGHT, PLAYER_SPEED, FOX_SPEED


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


class Fox(pygame.sprite.Sprite):
    """Patrols back and forth between min_pos and max_pos: along a fixed row
    (horizontal, default) or a fixed column (vertical)."""

    def __init__(self, x, y, image, min_pos, max_pos, speed=FOX_SPEED, vertical=False):
        super().__init__()
        self.vertical = vertical
        self.image_right = image
        self.image_left = pygame.transform.flip(image, True, False)
        self.image = self.image_right
        self.rect = self.image.get_rect(topleft=(x, y))
        self.pos = float(y) if vertical else float(x)
        self.min_pos = min_pos
        self.max_pos = max_pos
        self.speed = speed
        self.direction = 1

    def update(self, dt):
        self.pos += self.speed * self.direction * dt
        if self.pos <= self.min_pos:
            self.pos = self.min_pos
            self.direction = 1
        elif self.pos >= self.max_pos:
            self.pos = self.max_pos
            self.direction = -1

        if self.vertical:
            self.rect.y = round(self.pos)
        else:
            self.rect.x = round(self.pos)
            self.image = self.image_right if self.direction == 1 else self.image_left


class Player(pygame.sprite.Sprite):
    def __init__(self, x, y, image):
        super().__init__()
        self.image = image
        self.rect = self.image.get_rect(topleft=(x, y))
        self.x = float(self.rect.x)
        self.y = float(self.rect.y)
        self.dx = 0.0
        self.dy = 0.0

    def reset_to(self, x, y):
        self.x = float(x)
        self.y = float(y)
        self.rect.topleft = (round(self.x), round(self.y))

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
