#!/usr/bin/env python3
"""Compose the README hero: the Web GUI's team view and the DSH-TUI's team scene, side by side.

WHY A SCRIPT. The hero is the only documentation image that is COMPOSED rather than captured, so
without a recipe it is the one asset no lane could reproduce. It reads the two refreshed tiles the
capture lane just wrote and writes the hero beside them.

WHAT IT PAIRS, and the rule the CALLER has to keep: BOTH tiles must show the SAME fixture team. The
v0.12.0 hero paired a CJK board with a `Dual Surface Demo` TUI, i.e. two different fixtures in one
picture, which is how a reader ends up believing the two surfaces rendered the same run when they did
not. This script cannot read a team name out of pixels, so the pairing is checked BEFORE the run from
the two lanes' own manifests — the Web report's team-panel text and the TUI manifest's `matchedLine`
both carry the fixture's name — and the checked pair is recorded in the release evidence.

Usage: compose-hero.py <web-team-board.png> <tui-team-dag.png> <out.png>
"""
import sys

from PIL import Image

# The TUI's own page background, so the two surfaces sit on one field instead of on two white boxes.
BACKGROUND = (0x22, 0x26, 0x2E)
# The margin around the pair and the gutter between the two surfaces, in output pixels.
MARGIN = 40
GUTTER = 48
# The height both tiles are scaled to: tall enough to keep the terminal glyphs legible, short enough
# that the pair stays a banner rather than a poster.
TARGET_HEIGHT = 1000


def trim_light_margin(image):
    """Crop a light tile to its non-background bounding box.

    The Web crop is a viewport rectangle, and this build renders the panel shorter than the rectangle,
    so the bottom of the tile is empty white. Left in, it becomes a white slab under the hero's left
    half. The bounding box is computed against the tile's own corner colour, which handles a white page
    and a themed one with the same code.
    """
    rgb = image.convert("RGB")
    width, height = rgb.size
    background = rgb.getpixel((0, 0))
    pixels = rgb.load()
    right, bottom = 0, 0
    for y in range(height):
        for x in range(width):
            if pixels[x, y] != background:
                if x > right:
                    right = x
                bottom = y
    return image.crop((0, 0, min(width, right + 1), min(height, bottom + 1)))


def scaled(image, height):
    """Scale an image to `height`, preserving its aspect ratio."""
    width = max(1, round(image.width * height / image.height))
    return image.resize((width, height), Image.LANCZOS)


def main(argv):
    """Compose the hero from the two tile paths and the output path."""
    if len(argv) != 4:
        raise SystemExit("usage: compose-hero.py <web-team-board.png> <tui-team-dag.png> <out.png>")
    web_path, tui_path, out_path = argv[1], argv[2], argv[3]
    web = scaled(trim_light_margin(Image.open(web_path)), TARGET_HEIGHT)
    tui = scaled(trim_light_margin(Image.open(tui_path)), TARGET_HEIGHT)
    canvas = Image.new(
        "RGB",
        (MARGIN * 2 + web.width + GUTTER + tui.width, MARGIN * 2 + TARGET_HEIGHT),
        BACKGROUND,
    )
    canvas.paste(web, (MARGIN, MARGIN))
    canvas.paste(tui, (MARGIN + web.width + GUTTER, MARGIN))
    canvas.save(out_path, optimize=True)
    print(f"{out_path} {canvas.size[0]}x{canvas.size[1]} web={web.size[0]}x{web.size[1]} tui={tui.size[0]}x{tui.size[1]}")


if __name__ == "__main__":
    main(sys.argv)
