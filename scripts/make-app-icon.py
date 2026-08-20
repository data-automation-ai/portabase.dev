#!/usr/bin/env python3
"""
Render the Portabase app icon.

Reproduces the site's own logo mark (`.logo-mark` in src/styles.css) as raster
art: three stacked database-platter ellipses, the top one solid. Rendering it
from the same geometry as the CSS keeps the Google consent screen, the browser
tab, and the site header showing one identity instead of three.

Google's OAuth consent screen logo must be 120x120 and under 1MB.

Usage:  python scripts/make-app-icon.py
Output: public/icons/
"""

from pathlib import Path
from PIL import Image, ImageDraw

# Brand palette — must track :root in src/styles.css
BLACK = (9, 10, 12, 255)      # --black  #090a0c
ACID = (201, 255, 74, 255)    # --acid   #c9ff4a

# Geometry from .logo-mark in src/styles.css, expressed in its 28x28 box.
BOX = 28.0
PLATTER_W, PLATTER_H = 19.0, 9.0
PLATTER_LEFT = 4.0
PLATTER_TOPS = (2.0, 9.0, 16.0)
STROKE = 2.0

# Mark bounding box inside that 28x28 box.
MARK_W = PLATTER_W
MARK_H = (PLATTER_TOPS[-1] + PLATTER_H) - PLATTER_TOPS[0]

SS = 8  # supersample factor; ellipses need it to look clean


def render(size: int, rounded: bool = True, inset: float = 0.66) -> Image.Image:
    """Draw the mark centred on a dark rounded square at `size` px."""
    s = size * SS
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    if rounded:
        d.rounded_rectangle([0, 0, s - 1, s - 1], radius=int(s * 0.2), fill=BLACK)
    else:
        d.rectangle([0, 0, s - 1, s - 1], fill=BLACK)

    # Scale so the mark occupies `inset` of the canvas, height-limited.
    scale = (s * inset) / MARK_H
    mark_w = MARK_W * scale
    mark_h = MARK_H * scale
    ox = (s - mark_w) / 2.0 - PLATTER_LEFT * scale
    oy = (s - mark_h) / 2.0 - PLATTER_TOPS[0] * scale

    # The CSS mark is 28px on screen, where a 2px border reads as a fine ring.
    # Scaling that ratio straight up to icon size produces strokes so heavy the
    # three overlapping platters merge into one blob. Thin the ring and carve a
    # dark gap under each lower platter so the stack stays legible large.
    stroke = max(1, int(round(STROKE * scale * 0.62)))

    # Paint order matches the CSS: the solid top platter first, then the two
    # transparent rings over it, exactly as later siblings overpaint earlier
    # ones. Nothing is knocked out — carving gaps sliced the solid disc flat.
    for i, top in enumerate(PLATTER_TOPS):
        x0 = ox + PLATTER_LEFT * scale
        y0 = oy + top * scale
        x1 = x0 + PLATTER_W * scale
        y1 = y0 + PLATTER_H * scale

        # Top platter is solid, matching .logo-mark i:nth-child(1).
        if i == 0:
            d.ellipse([x0, y0, x1, y1], fill=ACID)
        else:
            d.ellipse([x0, y0, x1, y1], outline=ACID, width=stroke)

    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    out = Path(__file__).resolve().parent.parent / "public" / "icons"
    out.mkdir(parents=True, exist_ok=True)

    # 120x120 is the Google OAuth consent screen requirement.
    targets = {
        "portabase-consent-120.png": (120, True),
        "portabase-icon-512.png": (512, True),
        "portabase-icon-192.png": (192, True),
        "favicon-32.png": (32, False),
    }

    for name, (size, rounded) in targets.items():
        path = out / name
        render(size, rounded=rounded).save(path, "PNG", optimize=True)
        kb = path.stat().st_size / 1024
        print(f"{name:32s} {size:4d}px  {kb:7.1f} KB")

    print(f"\nwrote to {out}")


if __name__ == "__main__":
    main()
