"""Generates simple sprite/tile PNGs used by the game into assets/.

Run standalone (`python assets_gen.py`) to (re)generate art, or let
main.py call ensure_assets() automatically before the game starts.
"""

from PIL import Image, ImageDraw

from constants import ASSET_DIR

EXPECTED_FILES = [
    "duckling.png",
    "mother_duck.png",
    "sibling_1.png",
    "sibling_2.png",
    "sibling_3.png",
    "grass_tile.png",
    "water_tile.png",
    "rock.png",
    "bush.png",
    "fox.png",
]


def assets_exist() -> bool:
    return ASSET_DIR.is_dir() and all((ASSET_DIR / name).exists() for name in EXPECTED_FILES)


def _draw_duck(size, body_color, beak_color=(255, 140, 0), eye_color=(20, 20, 20)):
    """Shared body/head/beak/eye recipe used for duckling, mother, and siblings."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    body_w = size * 0.8
    body_h = size * 0.6
    body_left = size * 0.15
    body_top = size * 0.35
    draw.ellipse(
        [body_left, body_top, body_left + body_w, body_top + body_h],
        fill=body_color,
    )

    # wing crease
    shade = tuple(max(0, c - 35) for c in body_color)
    draw.arc(
        [body_left + body_w * 0.15, body_top + body_h * 0.15,
         body_left + body_w * 0.75, body_top + body_h * 0.85],
        start=200, end=340, fill=shade, width=max(1, size // 16),
    )

    # head
    head_r = size * 0.28
    head_cx = size * 0.32
    head_cy = size * 0.32
    draw.ellipse(
        [head_cx - head_r, head_cy - head_r, head_cx + head_r, head_cy + head_r],
        fill=body_color,
    )

    # beak (triangle pointing left)
    beak_len = size * 0.22
    draw.polygon(
        [
            (head_cx - head_r * 0.9, head_cy - head_r * 0.15),
            (head_cx - head_r * 0.9, head_cy + head_r * 0.45),
            (head_cx - head_r * 0.9 - beak_len, head_cy + head_r * 0.15),
        ],
        fill=beak_color,
    )

    # eye
    eye_r = max(1, size * 0.045)
    eye_cx = head_cx + head_r * 0.1
    eye_cy = head_cy - head_r * 0.15
    draw.ellipse([eye_cx - eye_r, eye_cy - eye_r, eye_cx + eye_r, eye_cy + eye_r], fill=eye_color)

    return img


def _draw_mother(size=48):
    img = _draw_duck(size, body_color=(255, 247, 230))
    draw = ImageDraw.Draw(img)
    # folded wing overlay for extra silhouette detail
    wing_color = (225, 220, 205)
    draw.ellipse(
        [size * 0.38, size * 0.45, size * 0.78, size * 0.82],
        fill=wing_color,
    )
    return img


def _draw_grass_tile(size=40, seed_offsets=None):
    img = Image.new("RGBA", (size, size), (124, 187, 71, 255))
    draw = ImageDraw.Draw(img)
    dark = (95, 162, 58)
    blades = [
        (4, 6, 8, 14), (12, 20, 15, 28), (25, 5, 27, 13),
        (30, 24, 33, 32), (6, 30, 9, 37), (20, 12, 22, 19),
        (35, 10, 37, 17), (16, 33, 19, 39),
    ]
    for x1, y1, x2, y2 in blades:
        draw.line([(x1, y1), (x2, y2)], fill=dark, width=2)
    return img


def _draw_water_tile(size=40):
    img = Image.new("RGBA", (size, size), (79, 166, 216, 255))
    draw = ImageDraw.Draw(img)
    light = (127, 196, 232)
    for y in (10, 20, 30):
        draw.arc([2, y - 6, 18, y + 6], start=200, end=340, fill=light, width=2)
        draw.arc([20, y - 6, 36, y + 6], start=200, end=340, fill=light, width=2)
    return img


def _draw_rock(size=40):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    points = [
        (size * 0.5, size * 0.12),
        (size * 0.82, size * 0.28),
        (size * 0.88, size * 0.62),
        (size * 0.62, size * 0.88),
        (size * 0.32, size * 0.84),
        (size * 0.1, size * 0.55),
        (size * 0.18, size * 0.26),
    ]
    draw.polygon(points, fill=(140, 140, 140))
    draw.ellipse([size * 0.35, size * 0.45, size * 0.7, size * 0.75], fill=(110, 110, 110))
    return img


def _draw_bush(size=40):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    outline = (32, 66, 26)
    fill = (63, 125, 50)
    blobs = [
        (size * 0.08, size * 0.35, size * 0.55, size * 0.85),
        (size * 0.35, size * 0.15, size * 0.85, size * 0.7),
        (size * 0.5, size * 0.4, size * 0.95, size * 0.9),
    ]
    for x1, y1, x2, y2 in blobs:
        draw.ellipse([x1 - 2, y1 - 2, x2 + 2, y2 + 2], fill=outline)
    for x1, y1, x2, y2 in blobs:
        draw.ellipse([x1, y1, x2, y2], fill=fill)
    return img


def _draw_fox(w=44, h=32):
    """Fox facing right; Fox entity flips it horizontally when patrolling left."""
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    orange = (214, 111, 45)
    dark = (150, 70, 25)
    white = (250, 245, 235)
    black = (25, 20, 15)

    # bushy tail, left side
    draw.polygon(
        [(0, h * 0.55), (w * 0.24, h * 0.12), (w * 0.32, h * 0.5), (w * 0.14, h * 0.9)],
        fill=orange,
    )
    draw.ellipse([0, h * 0.58, w * 0.15, h * 0.88], fill=white)

    # body
    draw.ellipse([w * 0.18, h * 0.22, w * 0.86, h * 0.92], fill=orange)
    # belly
    draw.ellipse([w * 0.35, h * 0.55, w * 0.76, h * 0.95], fill=white)

    # ears
    draw.polygon([(w * 0.50, 0), (w * 0.64, h * 0.32), (w * 0.42, h * 0.32)], fill=orange)
    draw.polygon([(w * 0.70, 0), (w * 0.84, h * 0.32), (w * 0.62, h * 0.32)], fill=orange)
    draw.polygon([(w * 0.52, h * 0.10), (w * 0.60, h * 0.28), (w * 0.48, h * 0.28)], fill=dark)

    # snout, pointing right
    draw.polygon([(w * 0.76, h * 0.32), (w * 1.0, h * 0.44), (w * 0.76, h * 0.6)], fill=orange)
    draw.ellipse([w * 0.90, h * 0.40, w * 0.99, h * 0.49], fill=black)

    # eye
    draw.ellipse([w * 0.60, h * 0.28, w * 0.68, h * 0.36], fill=black)

    return img


def ensure_assets(force: bool = False) -> None:
    if not force and assets_exist():
        return

    ASSET_DIR.mkdir(exist_ok=True)

    _draw_duck(32, body_color=(255, 224, 102)).save(ASSET_DIR / "duckling.png")
    _draw_mother(48).save(ASSET_DIR / "mother_duck.png")

    sibling_hues = [(255, 224, 102), (255, 221, 68), (255, 204, 51)]
    for i, hue in enumerate(sibling_hues, start=1):
        _draw_duck(28, body_color=hue).save(ASSET_DIR / f"sibling_{i}.png")

    _draw_grass_tile(40).save(ASSET_DIR / "grass_tile.png")
    _draw_water_tile(40).save(ASSET_DIR / "water_tile.png")
    _draw_rock(40).save(ASSET_DIR / "rock.png")
    _draw_bush(40).save(ASSET_DIR / "bush.png")
    _draw_fox(44, 32).save(ASSET_DIR / "fox.png")


if __name__ == "__main__":
    ensure_assets(force=True)
    print(f"Assets written to {ASSET_DIR}")
