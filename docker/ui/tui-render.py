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

1. EVERY GLYPH IS DRAWN AT ITS OWN CELL ORIGIN (`col * cell_w`, on the cell's baseline). This USED to
   draw a run of same-style glyphs as ONE `draw.text`, which inherited the font's own advance
   instead of the rounded grid step: DejaVuSansMono at 16pt advances 9.640625 px where the cell is a
   rounded 10 px, so every glyph of a run landed 0.359375 px left of its cell -- 8.6 px (0.86 cell) at
   the end of a 25-cell card border, 19.4 px (1.94 cell) at the end of a 55-cell group border. The run
   now supplies ONLY its background rectangle. MEASURED on the tile that was shipped: its card's top
   border ended 18 px short of that card's own right side (0.90 cell at `--scale 2`), which the eye
   reads as a stray vertical tick beside the corner.
   The glyphs also ride the cell BASELINE (`anchor="ls"` at `y + ascent`), not the text's ink top
   (`anchor="lt"`): with the ink-top anchor a box corner was painted 8 px too high, so a vertical
   border broke for 8 px under each corner row (measured: a 16 px gap at `--scale 2`) instead of
   closing.
2. WIDE GLYPHS COME FROM A SECOND FACE. DejaVuSansMono carries no CJK coverage, so drawing a Chinese
   label with it produced EMPTY BOXES -- tofu -- in the zh-CN status line the README shipped. A cell
   whose `east_asian_width` is W or F is therefore drawn with `CJK_FONT` at its own cell origin, which
   is what a terminal does with a full-width glyph.

`--self-test` asserts bound 1 on a synthetic grid and runs the pre-fix run drawing beside it as a
reverse control, so the assertion is proven able to go red. See `run_self_test` below.

Usage: tui-render.py <ansi-file> <out.png> [--rows A:B] [--cols C:D] [--scale N]
       tui-render.py --self-test

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
    """Paint the parsed grid and return the image, cropped to the widest drawn row.

    Each glyph is painted at ITS OWN cell origin (`col * cell_w`) and on the cell's baseline, which is
    what a terminal does; a run of same-style glyphs shares one background rectangle and nothing else.
    """
    # `--cols` is a CROP, so the band's left edge becomes the image's left edge.
    # WHY IT SLIDES TO ZERO (measured 2026-10-20): this used to keep the window's own x offset, which
    # produced a figure as wide as the whole pane with the content pushed to the right — the sidebar
    # tile came out mostly empty background, while the v0.12.0 tiles it replaces are tight crops. A
    # `--rows` band already behaves this way (the rows are the ones kept), so the two axes now agree.
    if cell_band is not None:
        c0, c1 = cell_band
        lines = [clip_cells(ln, c0, c1) for ln in lines]
    column_origin = 0

    # Metrics: cell width is measured from the font itself, so the grid cannot drift from the glyphs.
    font, font_bold, cjk_font = load_fonts()
    adv = font.getlength("M")
    cell_w = int(round(adv))
    ascent, descent = font.getmetrics()
    cell_h = ascent + descent

    # The widest KEPT row — the band is a crop, so the window's own left offset is gone (see above).
    width = max((sum(cell_width(c[0]) for c in ln) for ln in lines), default=1) + column_origin
    img = Image.new("RGB", (max(1, width * cell_w), max(1, len(lines) * cell_h)), PAGE_BG)
    draw = ImageDraw.Draw(img)

    for row, ln in enumerate(lines):
        y = row * cell_h
        baseline = y + ascent
        col = column_origin
        run_start = None
        run_style = None
        # One entry per glyph still to paint: (its OWN cell column, the text drawn there).
        pending = []

        def flush(end_col):
            """Paint the buffered run: its background rectangle, then every glyph at its own cell."""
            if not pending or run_start is None:
                return
            f = font_bold if run_style[2] else font
            if run_style[1] is not None:
                draw.rectangle([run_start * cell_w, y, end_col * cell_w - 1, y + cell_h - 1],
                               fill=run_style[1])
            for origin_col, text in pending:
                draw.text((origin_col * cell_w, baseline), text, font=f, fill=run_style[0],
                          anchor="ls")

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
                draw.text((col * cell_w, baseline), ch, font=f, fill=fg, anchor="ls")
                col += 2
                run_start, run_style = col, style
                continue
            if span == 0 and pending:
                # A combining mark has no cell of its own: it rides the glyph it modifies.
                pending[-1] = (pending[-1][0], pending[-1][1] + ch)
                continue
            pending.append((col, ch))
            col += span
        flush(col)

    img = img.crop((0, 0, max(1, width * cell_w), max(1, len(lines) * cell_h)))
    if scale != 1:
        img = img.resize((img.width * scale, img.height * scale), Image.NEAREST)
    return img


# ── self-test ────────────────────────────────────────────────────────────────────────────────────
# `--self-test` asserts the ONE thing the figure depends on — every glyph lands on its own cell — and
# then proves the assertion can go RED by running the PRE-FIX algorithm beside it. Deliberately not a
# test framework: this script's only dependency is Pillow and every gate in this repository is a plain
# command, so the check is a handful of asserts, printed numbers and an exit code.
#
# The numbers are printed rather than only asserted: a failing assertion on a rasterizer is nearly
# always an off-by-a-fraction, and the fraction is the evidence.

# The synthetic row arm 1 measures: 40 cells of U+2550 (the double line the group frame's own borders
# are drawn from), long enough that the pre-fix run drawing could not hide its drift inside a cell.
SELFTEST_CELLS = 40
# Blank cells before and after the lone reference glyph, so nothing clips its ink at the image edge.
SELFTEST_PAD = 4
# A distinct foreground for the synthetic side glyph: its own STYLE RUN is what makes it exact in the
# pre-fix algorithm, which is exactly the asymmetry that broke the shipped cards (their top border was
# one long run of one tone, their right side a separate one-cell run).
SELFTEST_SIDE_FG = (0x7D, 0xA1, 0xDE)


def _test_line(text: str, fg=PAGE_FG):
    """The parsed-cell list `parse_ansi` would build for `text` in one style, with no background."""
    return [(ch, fg, None, False) for ch in text]


def _test_side_row(cols: int, ch: str, fg=SELFTEST_SIDE_FG):
    """`cols` blank cells with `ch` in the LAST one, in its own colour (its own style run)."""
    row = _test_line(" " * cols)
    row[-1] = (ch, fg, None, False)
    return row


def _ink_bbox(img, box):
    """Bounding box `(x0, y0, x1, y1)` of the pixels in `box` that differ from PAGE_BG, or None."""
    x0, y0, x1, y1 = box
    px = img.load()
    found = None
    for yy in range(max(0, y0), min(img.height, y1)):
        for xx in range(max(0, x0), min(img.width, x1)):
            if px[xx, yy] != PAGE_BG:
                if found is None:
                    found = [xx, yy, xx, yy]
                else:
                    found[0] = min(found[0], xx)
                    found[1] = min(found[1], yy)
                    found[2] = max(found[2], xx)
                    found[3] = max(found[3], yy)
    return None if found is None else tuple(found)


def _stroke_centre_x(img, box):
    """Centre x of the vertical stroke of a box glyph whose HORIZONTAL BAR sits above it.

    That covers a box's top corners and its side glyphs, which is what the self-test reads. The stroke
    is taken from the lowest 40% of the glyph's OWN ink rather than from a fixed band of the cell, so
    the reading does not depend on the anchor the glyph was painted with: whether the ink was placed by
    its top or on the baseline, the bar is the widest part and the stroke is what remains under it.
    """
    ink = _ink_bbox(img, box)
    if ink is None:
        return None
    top = ink[1] + int((ink[3] - ink[1] + 1) * 0.6)
    stroke = _ink_bbox(img, (box[0], top, box[2], ink[3] + 1))
    return None if stroke is None else (stroke[0] + stroke[2]) / 2.0


def _metrics():
    """The grid the renderer paints on, read from the same font: `(cell_w, cell_h, ascent)`."""
    font, _, _ = load_fonts()
    ascent, descent = font.getmetrics()
    return int(round(font.getlength("M"))), ascent + descent, ascent


def _legacy_render_run(lines, scale: int = 1):
    """The PRE-FIX algorithm, kept ONLY as the self-test's reverse control.

    A faithful copy, not a flag on `render`: the control has to keep failing even if `render` is
    changed again, otherwise a regression could quietly disable its own detector. It paints a run of
    same-style glyphs as ONE `draw.text` at the run's start column and rides the text's ink top
    (`anchor="lt"`), which is what shipped the broken README tiles.
    """
    font, _, _ = load_fonts()
    cell_w = int(round(font.getlength("M")))
    ascent, descent = font.getmetrics()
    cell_h = ascent + descent
    width = max((sum(cell_width(c[0]) for c in ln) for ln in lines), default=1)
    img = Image.new("RGB", (max(1, width * cell_w), max(1, len(lines) * cell_h)), PAGE_BG)
    draw = ImageDraw.Draw(img)
    for row, ln in enumerate(lines):
        y = row * cell_h
        col = 0
        run_start = None
        run_style = None
        pending = []

        def flush(end_col):
            """Draw the buffered run as one string, exactly as the old line did."""
            if not pending or run_start is None:
                return
            if run_style[1] is not None:
                draw.rectangle([run_start * cell_w, y, end_col * cell_w - 1, y + cell_h - 1],
                               fill=run_style[1])
            draw.text((run_start * cell_w, y), "".join(pending), font=font, fill=run_style[0],
                      anchor="lt")

        for ch, fg, bg, bold in ln:
            style = (fg, bg, bold)
            span = cell_width(ch)
            if style != run_style:
                flush(col)
                pending, run_start, run_style = [], col, style
            if span == 2:
                flush(col)
                pending, run_start = [], None
                draw.text((col * cell_w, y), ch, font=font, fill=fg, anchor="lt")
                col += 2
                run_start, run_style = col, style
                continue
            pending.append(ch)
            col += span
        flush(col)
    if scale != 1:
        img = img.resize((img.width * scale, img.height * scale), Image.NEAREST)
    return img


def run_self_test() -> int:
    """Assert bound 1 on a synthetic grid, then prove the assertion can fail. 0 = PASS, 1 = FAIL."""
    cell_w, cell_h, _ = _metrics()
    failures = []
    print(f"[selftest] grid: cell_w={cell_w}px cell_h={cell_h}px "
          f"(DejaVuSansMono@{FONT_SIZE}, advance {cell_w}px after rounding)")

    # ── arm 1: the LAST glyph of a 40-cell run lands on cell 39's own origin ─────────────────────
    print(f"[selftest] arm 1: the last glyph of a row of {SELFTEST_CELLS} '═' is painted on cell "
          f"{SELFTEST_CELLS - 1}'s origin")
    want = (SELFTEST_CELLS - 1) * cell_w
    ref = render([_test_line(" " * SELFTEST_PAD + "═" + " " * SELFTEST_PAD)], scale=1)
    ref_ink = _ink_bbox(ref, (0, 0, ref.width, ref.height))
    # The glyph's own right inset inside a cell is a property of the FACE, so it is measured once on
    # the fixed renderer and then used to read a cell origin back out of either image.
    inset = ref_ink[2] - SELFTEST_PAD * cell_w
    print(f"[selftest]   reference: one '═' at cell {SELFTEST_PAD} -> ink right edge x={ref_ink[2]}, "
          f"cell origin x={SELFTEST_PAD * cell_w}, glyph right inset {inset}px")
    row = render([_test_line("═" * SELFTEST_CELLS)], scale=1)
    row_ink = _ink_bbox(row, (0, 0, row.width, row.height))
    origin = row_ink[2] - inset
    inside = (SELFTEST_CELLS - 1) * cell_w <= row_ink[2] < SELFTEST_CELLS * cell_w
    ok = origin == want and inside
    print(f"[selftest]   fixed:     ink right edge x={row_ink[2]} -> cell origin x={origin} "
          f"(want {want}) -> {'PASS' if ok else 'FAIL'}")
    if not ok:
        failures.append(f"arm 1: last glyph origin x={origin}, want {want} (inside last cell: {inside})")

    # ── reverse control: the SAME row drawn by the pre-fix one-run algorithm must FAIL ───────────
    legacy = _legacy_render_run([_test_line("═" * SELFTEST_CELLS)])
    legacy_ink = _ink_bbox(legacy, (0, 0, legacy.width, legacy.height))
    legacy_origin = legacy_ink[2] - inset
    offset = want - legacy_origin
    red = legacy_origin != want and offset >= cell_w
    print(f"[selftest]   reverse:   the pre-fix one-run drawing of the same row -> ink right edge "
          f"x={legacy_ink[2]} -> cell origin x={legacy_origin}, off by {offset}px = "
          f"{offset / cell_w:.2f} cell(s) -> {'FAILS as required' if red else 'UNEXPECTEDLY PASSED'} "
          f"(needs >= 1.00 cell)")
    if not red:
        failures.append(f"arm 1 reverse control did not go red: offset {offset}px ({offset / cell_w:.2f} cell)")

    # ── arm 2: a frame's top-right corner sits on the same x as the frame's right side ──────────
    # The group frame's own glyph family, drawn the way graph.ts emits it: the top border is one run
    # of one tone, the right side is its own one-cell run.
    side = 24
    frame = render([
        _test_line("╔" + "═" * (side - 1) + "╗"),
        _test_side_row(side + 1, "║"),
        _test_side_row(side + 1, "║"),
        _test_line("╚" + "═" * (side - 1) + "╝"),
    ], scale=1)
    # The corner is SEARCHED over the two cells before its own: the defect under test is precisely that
    # the glyph is not painted inside its cell, so a cell-sized window could not see it at all. The
    # helper reads the stroke out of the ink's own bounding box, which is why the neighbouring border
    # glyphs (whose ink sits higher) do not pollute the reading.
    corner_window = ((side - 2) * cell_w, 0, (side + 1) * cell_w, cell_h)
    corner_x = _stroke_centre_x(frame, corner_window)
    edge_x = _stroke_centre_x(frame, (side * cell_w, cell_h, (side + 1) * cell_w, 2 * cell_h))
    delta = None if corner_x is None or edge_x is None else abs(corner_x - edge_x)
    arm2 = delta is not None and delta <= 1.0
    print("[selftest] arm 2: a frame's top-right corner and its right side share one x")
    print(f"[selftest]   fixed:     corner stroke x={corner_x}, side stroke x={edge_x} -> "
          f"|delta|={delta}px -> {'PASS (<= 1px)' if arm2 else 'FAIL'}")
    if not arm2:
        failures.append(f"arm 2: corner x={corner_x}, side x={edge_x}, delta={delta}")
    legacy_frame = _legacy_render_run([
        _test_line("╔" + "═" * (side - 1) + "╗"),
        _test_side_row(side + 1, "║"),
    ])
    legacy_corner = _stroke_centre_x(legacy_frame, corner_window)
    legacy_edge = _stroke_centre_x(legacy_frame, (side * cell_w, cell_h, (side + 1) * cell_w,
                                              2 * cell_h))
    legacy_delta = None if legacy_corner is None or legacy_edge is None else abs(
        legacy_corner - legacy_edge)
    red2 = legacy_delta is not None and legacy_delta > 1.0
    legacy_cells = "n/a" if legacy_delta is None else f"{legacy_delta / cell_w:.2f}"
    print(f"[selftest]   reverse:   the pre-fix run drawing -> corner stroke x={legacy_corner}, side "
          f"stroke x={legacy_edge} -> |delta|={legacy_delta}px = {legacy_cells} cell(s) -> "
          f"{'FAILS as required (> 1px)' if red2 else 'UNEXPECTEDLY PASSED'}")
    if not red2:
        failures.append(f"arm 2 reverse control did not go red: delta {legacy_delta}px")

    if failures:
        for line in failures:
            print(f"[selftest] FAIL: {line}")
        print(f"[selftest] FAIL ({len(failures)} assertion(s))")
        return 1
    print("[selftest] PASS: 2 arms, both reverse controls went red")
    return 0


def parse_band(spec: str, flag: str):
    """Parse an `A:B` half-open band spec into a pair of ints, refusing anything else."""
    try:
        lo, hi = spec.split(":", 1)
        return int(lo), int(hi)
    except ValueError:
        raise SystemExit(f"tui-render: {flag} wants A:B, got {spec!r}")


def main(argv) -> int:
    """Entry point: run the self-test when asked, otherwise read the capture, render it, write the PNG."""
    if "--self-test" in argv:
        return run_self_test()
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
