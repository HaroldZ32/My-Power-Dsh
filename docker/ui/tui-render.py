#!/usr/bin/env python3
"""Rasterize a tmux pane capture (ANSI/SGR) into a PNG, at the character grid tmux already computed.

WHY THIS EXISTS. The TUI is a terminal application, and the Docker UI lane's X path is dead in this
container (Xvfb accepts the socket and never answers `import`, `xdpyinfo` or `xwd`). A browser-hosted
emulator was the first fallback; this is the second, and it is the more conservative one: tmux is
ITSELF a terminal emulator and has already resolved every cell, so this script only has to paint the
grid it is handed. No layout is re-derived here, which is why the result cannot quietly disagree with
what the TUI drew.

WHAT IT DOES NOT INVENT. Every foreground colour, every attribute and every explicit background comes
from the SGR stream the TUI emitted. The one thing the TUI does NOT emit is the page background --
dsh-tui queries the terminal with OSC 11 and otherwise assumes `dark`, and it deliberately leaves the
terminal's own background showing. So PAGE_BG below is a CHOICE, and it is named here rather than
implied: it is the dark palette's own deep warm charcoal (`inverseText`, `#22262E` in
`lib/types/theme.js`), which keeps the render inside the theme's own colour family.

WHY IT RUNS ON THE HOST AND NOT IN THE CONTAINER. The UI-VIEW image ships no `python3` at all
(measured: `exec: "python3": executable file not found in $PATH`), so `tui-capture.sh` pipes the pane
bytes OUT of the container and rasterizes them here, where Pillow and the fonts live.

TWO HONEST BOUNDS, stated rather than implied:

1. A RUN OF NARROW GLYPHS IS DRAWN AS ONE STRING, so it inherits the font's own advance rather than
   this script's `cell_w`. DejaVuSansMono at 16pt advances 9.640625 px where the grid step is a
   rounded 10 px, so the tail of a very long run can sit a fraction of a cell left of where a real
   terminal would put it. Runs are kept whole ON PURPOSE: that is what makes this renderer reproduce
   the images the README already ships. A run is only split where the grid would otherwise break --
   at a wide (East-Asian) glyph, which cannot ride a monospace advance at all.
2. WIDE GLYPHS COME FROM A SECOND FACE. DejaVuSansMono carries no CJK coverage, so drawing a Chinese
   label with it produced EMPTY BOXES -- tofu -- in the zh-CN status line the README shipped. A cell
   whose `east_asian_width` is W or F is therefore drawn with `CJK_FONT` at its own cell origin, which
   is what a terminal does with a full-width glyph.

Usage: tui-render.py <ansi-file> <out.png> [--rows A:B] [--cols C:D] [--scale N]

`--rows` and `--cols` are half-open CELL bands (row A up to row B, column A up to column B); each is
a WINDOW onto the grid tmux already laid out, never a re-layout, and a wide glyph that would straddle
a band edge is dropped rather than half-drawn.
"""

import os
import re
import sys
import unicodedata

from PIL import Image, ImageDraw, ImageFont

# The dark palette's own deep warm charcoal, used as the page background. See the module docstring:
# the TUI never paints one, so this is a stated choice, not an observation.
PAGE_BG = (0x22, 0x26, 0x2E)
# The dark palette's body text colour, used until the stream says otherwise.
PAGE_FG = (0xE8, 0xE6, 0xE0)
# The monospace face the grid is measured from, and its bold twin for SGR 1.
FONT_PATH = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"
FONT_PATH_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf"
# The fallback face for wide glyphs. DejaVuSansMono has no CJK coverage, so without this the zh-CN
# renders show tofu boxes where the Chinese labels are. First existing path wins; absence degrades to
# the mono face (tofu, as before) rather than failing the render.
CJK_FONT_CANDIDATES = [
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK.ttc",
    "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
]
# The glyph size every face is instantiated at, in pixels of the UNSCALED grid.
FONT_SIZE = 16

# The 16 ANSI colours, Gentle-Mist-Blue-ish but standard enough that the mapping is not a claim.
ANSI16 = [
    (0x22, 0x26, 0x2E), (0xC7, 0x4E, 0x4E), (0x4E, 0x96, 0x75), (0xC9, 0xA9, 0x54),
    (0x5E, 0x88, 0xCC), (0xB3, 0xA0, 0xD4), (0x5E, 0x9E, 0xA8), (0xD8, 0xD4, 0xCC),
    (0x6B, 0x70, 0x7C), (0xE0, 0x7A, 0x7A), (0x74, 0xC0, 0x99), (0xE0, 0xC0, 0x70),
    (0x7D, 0xA1, 0xDE), (0xC8, 0xB8, 0xE8), (0x7C, 0xC0, 0xCC), (0xF2, 0xEF, 0xE8),
]

# One SGR parameter list, e.g. `38;2;125;161;222` or `1` or `0`.
SGR_RE = re.compile(r"\x1b\[([0-9;]*)m")
# Any OTHER escape sequence, matched so its bytes can be CONSUMED instead of becoming glyphs: a CSI
# (`\x1b[2K`, `\x1b[?25l`), an OSC (`\x1b]11;?\x07`) or a two-byte escape. `capture-pane -e` emits
# only SGR today, but a stray CSI that reached the glyph stream would be painted as a control picture
# -- a wrong pixel that nothing downstream could detect.
OTHER_ESCAPE_RE = re.compile(r"\x1b(?:\][^\x07\x1b]*(?:\x07|\x1b\\)|\[[0-?]*[ -/]*[@-~]|[@-Z\\-_])")


def cell_width(ch: str) -> int:
    """How many terminal cells `ch` occupies: 2 for East-Asian Wide/Fullwidth, 0 for a combining mark."""
    if unicodedata.east_asian_width(ch) in ("W", "F"):
        return 2
    if unicodedata.combining(ch):
        return 0
    return 1


def parse_ansi(text: str):
    """Yield `(char, fg, bg, bold)` cells in reading order, splitting on newlines.

    `fg`/`bg` are RGB triples; `bg` is None while the page background shows through, which is what
    lets `render` leave PAGE_BG in place. Non-SGR escapes are consumed and contribute NO cell.
    """
    fg, bg, bold = PAGE_FG, None, False
    lines = [[]]
    i = 0
    while i < len(text):
        sgr = SGR_RE.match(text, i)
        other = None if sgr else OTHER_ESCAPE_RE.match(text, i)
        if sgr or other:
            if sgr:
                params = [int(p) for p in sgr.group(1).split(";") if p != ""] or [0]
                j = 0
                while j < len(params):
                    p = params[j]
                    if p == 0:
                        fg, bg, bold = PAGE_FG, None, False
                    elif p == 1:
                        bold = True
                    elif p == 22:
                        bold = False
                    elif p == 39:
                        fg = PAGE_FG
                    elif p == 49:
                        bg = None
                    elif 30 <= p <= 37:
                        fg = ANSI16[p - 30]
                    elif 90 <= p <= 97:
                        fg = ANSI16[p - 90 + 8]
                    elif 40 <= p <= 47:
                        bg = ANSI16[p - 40]
                    elif 100 <= p <= 107:
                        bg = ANSI16[p - 100 + 8]
                    elif p in (38, 48) and j + 1 < len(params):
                        target = "fg" if p == 38 else "bg"
                        mode = params[j + 1]
                        if mode == 5 and j + 2 < len(params):
                            n = params[j + 2]
                            colour = ANSI16[n - 16] if 16 <= n < 32 else (
                                _xterm256(n) if n >= 32 else ANSI16[n % 16])
                            if target == "fg":
                                fg = colour
                            else:
                                bg = colour
                            j += 2
                        elif mode == 2 and j + 4 < len(params):
                            colour = (params[j + 2], params[j + 3], params[j + 4])
                            if target == "fg":
                                fg = colour
                            else:
                                bg = colour
                            j += 4
                    j += 1
            i = (sgr or other).end()
            continue
        ch = text[i]
        if ch == "\n":
            lines.append([])
        elif ch == "\r":
            pass
        else:
            lines[-1].append((ch, fg, bg, bold))
        i += 1
    return lines


def _xterm256(n: int):
    """The 6x6x6 colour cube plus the greyscale ramp of the xterm-256 palette.

    Index 0..15 are the ANSI-16 and are NOT this table's job: callers map those first, because the
    cube's own `0` means "black" while the palette's `0` means "the terminal's background".
    """
    if n < 232:
        n -= 16
        r, g, b = n // 36, (n // 6) % 6, n % 6
        # The cube's levels are 0 and 0x5F..0xFF in steps of 40 -- NOT `v * 40`, which would put
        # level 1 at 40 and shift every one of the 216 entries.
        conv = lambda v: 0 if v == 0 else 55 + v * 40
        return conv(r), conv(g), conv(b)
    # 232..255 is a 24-step grey ramp starting at 8 and stepping by 10.
    v = 8 + (n - 232) * 10
    return v, v, v


def clip_cells(line, c0: int, c1: int):
    """Keep the cells of `line` whose whole width falls inside the half-open column band [c0, c1).

    A wide glyph occupies two columns, so it is kept only when BOTH fit; otherwise it is dropped
    rather than drawn half-width, which would shift every glyph after it by one column.
    """
    out = []
    col = 0
    for cell in line:
        width = cell_width(cell[0])
        if col >= c0 and col + max(width, 1) <= c1:
            out.append(cell)
        col += width
    return out


def load_fonts():
    """Load the mono, mono-bold and CJK faces, degrading to the mono face when a file is absent."""
    font = ImageFont.truetype(FONT_PATH, FONT_SIZE)
    font_bold = ImageFont.truetype(FONT_PATH_BOLD, FONT_SIZE)
    cjk = None
    for path in CJK_FONT_CANDIDATES:
        if os.path.exists(path):
            cjk = ImageFont.truetype(path, FONT_SIZE)
            break
    return font, font_bold, cjk or font


def render(lines, scale: int = 2, cell_band=None):
    """Paint the parsed grid and return the image, cropped to the widest drawn row."""
    # `--cols` is applied here, on the cell list, so the band is a window onto the SAME grid: the
    # x position of a kept glyph is still its original column times `cell_w`.
    if cell_band is not None:
        c0, c1 = cell_band
        lines = [clip_cells(ln, c0, c1) for ln in lines]
        column_origin = c0
    else:
        column_origin = 0

    # Metrics: cell width is measured from the font itself, so the grid cannot drift from the glyphs.
    font, font_bold, cjk_font = load_fonts()
    adv = font.getlength("M")
    cell_w = int(round(adv))
    ascent, descent = font.getmetrics()
    cell_h = ascent + descent

    # The widest row, plus the window's own left offset, so a `--cols 100:158` band keeps its x
    # position instead of being slid back to column zero.
    width = max((sum(cell_width(c[0]) for c in ln) for ln in lines), default=1) + column_origin
    img = Image.new("RGB", (max(1, width * cell_w), max(1, len(lines) * cell_h)), PAGE_BG)
    draw = ImageDraw.Draw(img)

    for row, ln in enumerate(lines):
        y = row * cell_h
        col = column_origin
        run_start = None
        run_style = None
        pending = []

        def flush(end_col):
            """Draw the buffered narrow-glyph run, if any, and reset the buffer."""
            if not pending or run_start is None:
                return
            f = font_bold if run_style[2] else font
            if run_style[1] is not None:
                draw.rectangle([run_start * cell_w, y, end_col * cell_w - 1, y + cell_h - 1],
                               fill=run_style[1])
            draw.text((run_start * cell_w, y), "".join(pending), font=f,
                      fill=run_style[0], anchor="lt")

        for ch, fg, bg, bold in ln:
            style = (fg, bg, bold)
            span = cell_width(ch)
            if style != run_style:
                flush(col)
                pending, run_start, run_style = [], col, style
            if span == 2:
                # A wide glyph cannot ride a monospace advance: close the run, then draw the glyph
                # itself at its OWN cell origin with the CJK face (or the mono face if none is
                # installed, which yields the old tofu rather than a crash).
                flush(col)
                pending, run_start = [], None
                f = cjk_font
                if bg is not None:
                    draw.rectangle([col * cell_w, y, (col + 2) * cell_w - 1, y + cell_h - 1], fill=bg)
                draw.text((col * cell_w, y), ch, font=f, fill=fg, anchor="lt")
                col += 2
                run_start, run_style = col, style
                continue
            pending.append(ch)
            col += span
        flush(col)

    img = img.crop((0, 0, max(1, width * cell_w), max(1, len(lines) * cell_h)))
    if scale != 1:
        img = img.resize((img.width * scale, img.height * scale), Image.NEAREST)
    return img


def parse_band(spec: str, flag: str):
    """Parse an `A:B` half-open band spec into a pair of ints, refusing anything else."""
    try:
        lo, hi = spec.split(":", 1)
        return int(lo), int(hi)
    except ValueError:
        raise SystemExit(f"tui-render: {flag} wants A:B, got {spec!r}")


def main(argv) -> int:
    """Entry point: read the capture, render it, write the PNG."""
    positional = []
    scale = 2
    rows = None
    cols = None
    i = 0
    while i < len(argv):
        arg = argv[i]
        if arg.startswith("--scale"):
            value = arg.split("=", 1)[1] if "=" in arg else (argv[i + 1] if i + 1 < len(argv) else "2")
            scale = int(value)
            i += 0 if "=" in arg else 1
        elif arg.startswith("--rows"):
            value = arg.split("=", 1)[1] if "=" in arg else argv[i + 1]
            rows = parse_band(value, "--rows")
            i += 0 if "=" in arg else 1
        elif arg.startswith("--cols"):
            value = arg.split("=", 1)[1] if "=" in arg else argv[i + 1]
            cols = parse_band(value, "--cols")
            i += 0 if "=" in arg else 1
        elif arg.startswith("--"):
            raise SystemExit(f"tui-render: unknown flag {arg!r}")
        else:
            positional.append(arg)
        i += 1
    if len(positional) != 2:
        raise SystemExit("usage: tui-render.py <ansi-file> <out.png> "
                         "[--rows A:B] [--cols C:D] [--scale N]")
    src, out = positional
    if scale < 1:
        raise SystemExit("tui-render: --scale must be >= 1")
    text = open(src, encoding="utf-8", errors="replace").read()
    lines = parse_ansi(text)
    if rows is not None:
        lines = lines[rows[0]:rows[1]]
    img = render(lines, scale, cols)
    img.save(out)
    print(f"{out} {img.size} rows={len(lines)} cols={cols or 'all'} scale={scale}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
