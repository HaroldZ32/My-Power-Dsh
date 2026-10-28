#!/usr/bin/env python3
"""Measure a tui-render.py PNG against the character grid the TUI drew, and print the numbers.

WHY THIS EXISTS BESIDE THE RENDERER'S OWN --self-test. The self-test asserts the rasterizer's rule on a
synthetic grid; this script measures the PIXELS OF THE SHIPPED FILE, which is what a reader sees. It
knows only two things: the cell size and where the crop starts in pane coordinates. The box rectangles
are transcribed from the archived pane text (evidence/cellwork/shots/2026-10-26T16-25-00Z/tui-pane-en.txt),
so a wrong renderer cannot make this script agree with it.

WHAT IT REPORTS, per box:
* the four corners, each measured as |x(corner's own vertical stroke) - x(adjacent side's stroke)|. This
  is the number the task bounds at <= 1px, and it is exactly the "floating vertical line beside the
  card's top-right corner" defect: when the top border drifts left of its side, the side's bar sticks
  out past the end of the border and reads as a stray tick.
* every side's pixel continuity: how many pixel rows (for the left/right sides) or pixel columns (for
  the top/bottom sides) between the corners carry NO ink. A closed frame reports 0 everywhere.

Usage:
  measure.py <png> --cell-w 20 --cell-h 38 --row-origin 2 --col-origin 0 [--json out.json] [--label X]
  measure.py --probe <png> <x-lo> <x-hi> <y-lo> <y-hi>   # grid-free probe of one card

`--probe` is for an image whose crop origin is UNKNOWN (the two assets that were shipped before this
fix): it finds a card's top border and that card's right side by shape, and prints the two x values.
"""

import json
import sys

from PIL import Image

# The page background the renderer paints; anything else is ink.
BG = (0x22, 0x26, 0x2E)

# The boxes in PANE CELL coordinates (left, top, right, bottom), transcribed from the archived pane:
#   row 28  '  │ ╔ subcell-auth ═…╧…╗'      row 46  '  │ ╚…╫…╝'
#   row  7  '  │ ╭───────────────────────╮' (card T1; the same rectangle on rows 14/21/51)
#   row 29  '  │ ║╭───────────────────────╮…║' (interior card C1, one column right of the frame)
BOXES = [
    # The group frame: its top side carries the frame's own TITLE at cells 6..17, so the continuity
    # check for that side is split around `top_gap` and the title itself is not read as a hole.
    {"name": "group-frame", "left": 4, "top": 28, "right": 58, "bottom": 46, "top_gap": (5, 18)},
    {"name": "card-T1", "left": 4, "top": 7, "right": 28, "bottom": 9},
    {"name": "card-T2", "left": 4, "top": 14, "right": 28, "bottom": 16},
    {"name": "card-T3", "left": 32, "top": 14, "right": 56, "bottom": 16},
    {"name": "card-T4", "left": 4, "top": 21, "right": 28, "bottom": 23},
    {"name": "card-C1", "left": 5, "top": 29, "right": 29, "bottom": 31},
    {"name": "card-C2", "left": 5, "top": 36, "right": 29, "bottom": 38},
    {"name": "card-C3", "left": 33, "top": 36, "right": 57, "bottom": 38},
    {"name": "card-C4", "left": 5, "top": 43, "right": 29, "bottom": 45},
    {"name": "card-T5", "left": 4, "top": 51, "right": 28, "bottom": 53},
]


def load(path):
    """Open the PNG as RGB and return `(image, pixel_access)`."""
    img = Image.open(path).convert("RGB")
    return img, img.load()


def ink_bbox(px, box):
    """Bounding box `(x0, y0, x1, y1)` of the ink inside `box` (inclusive coordinates), or None."""
    x0, y0, x1, y1 = box
    found = None
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            if px[x, y] != BG:
                if found is None:
                    found = [x, y, x, y]
                else:
                    found[0] = min(found[0], x)
                    found[1] = min(found[1], y)
                    found[2] = max(found[2], x)
                    found[3] = max(found[3], y)
    return None if found is None else tuple(found)


def stroke_x(px, box, away_from):
    """Centre x of a box glyph's VERTICAL stroke inside `box`.

    `away_from` is the glyph's own bar side: a corner's horizontal bar is the widest part of its ink, so
    the stroke is what remains in the 40% of the ink's bounding box farthest from that bar. Read inside
    the ink's own bbox, not the cell, so the number does not depend on the anchor the glyph was painted
    with -- which is what lets the same routine measure the pre-fix image.
    """
    ink = ink_bbox(px, box)
    if ink is None:
        return None
    height = ink[3] - ink[1] + 1
    cut = max(1, int(height * 0.4))
    if away_from == "top":
        # The bar is at the TOP of the ink, so the stroke is read from the BOTTOM of it (and vice versa).
        band = (ink[3] - cut + 1, ink[3])
    else:
        band = (ink[1], ink[1] + cut - 1)
    part = ink_bbox(px, (box[0], band[0], box[2], band[1]))
    return None if part is None else (part[0] + part[2]) / 2.0


def side_stroke_x(px, box):
    """Centre x of the ink in a side cell (a pure vertical glyph, no bar to exclude)."""
    ink = ink_bbox(px, box)
    return None if ink is None else (ink[0] + ink[2]) / 2.0


def gaps(px, points):
    """The longest run of consecutive points with no ink in that pixel, and how many such points exist.

    `points` is a list of the pixel box to test per step, so a caller walks a column (one box per pixel
    row) or a row (one box per pixel column).
    """
    missing = 0
    longest = 0
    run = 0
    for box in points:
        if ink_bbox(px, box) is None:
            missing += 1
            run += 1
            longest = max(longest, run)
        else:
            run = 0
    return missing, longest


def cell_box(col, row, cw, ch, row_origin, col_origin):
    """The pixel box of one CELL, from pane cell coordinates and the crop's pane origin."""
    x0 = (col - col_origin) * cw
    y0 = (row - row_origin) * ch
    return (x0, y0, x0 + cw - 1, y0 + ch - 1)


def measure(path, cw, ch, row_origin, col_origin, label):
    """Measure every box in `BOXES` and return the record (also printing a readable table)."""
    img, px = load(path)
    record = {"png": path, "label": label, "size": list(img.size), "cell": [cw, ch],
              "rowOrigin": row_origin, "colOrigin": col_origin, "boxes": [], "bounds": {}}
    print(f"== {label}: {path} {img.size[0]}x{img.size[1]} cell={cw}x{ch}px "
          f"origin=(col {col_origin}, row {row_origin})")
    max_delta = 0.0
    worst = ""
    total_missing = 0
    for box in BOXES:
        L, T, R, B = box["left"], box["top"], box["right"], box["bottom"]
        # `away_from` is the side the glyph's HORIZONTAL BAR sits on: a top corner's bar is at the top
        # of its cell, so its vertical stroke is read from the bottom of the ink and vice versa.
        corners = [
            ("top-left", "top"), ("top-right", "top"),
            ("bottom-left", "bottom"), ("bottom-right", "bottom"),
        ]
        cell_of = {"top-left": (L, T), "top-right": (R, T),
                   "bottom-left": (L, B), "bottom-right": (R, B)}
        side_of = {"top-left": (L, T + 1), "top-right": (R, T + 1),
                   "bottom-left": (L, B - 1), "bottom-right": (R, B - 1)}
        entry = {"name": box["name"], "rect": [L, T, R, B], "corners": {}, "sides": {}}
        for corner, bar_side in corners:
            corner_box = cell_box(*cell_of[corner], cw, ch, row_origin, col_origin)
            side_box = cell_box(*side_of[corner], cw, ch, row_origin, col_origin)
            cx = stroke_x(px, corner_box, bar_side)
            sx = side_stroke_x(px, side_box)
            delta = None if cx is None or sx is None else abs(cx - sx)
            entry["corners"][corner] = {"cornerX": cx, "sideX": sx, "delta": delta}
            if delta is not None and delta > max_delta:
                max_delta = delta
                worst = f"{box['name']}.{corner}"
        # Sides: walk the pixel rows/columns between the corners.
        left_col = cell_box(L, T, cw, ch, row_origin, col_origin)
        right_col = cell_box(R, T, cw, ch, row_origin, col_origin)
        top_row = cell_box(L, T, cw, ch, row_origin, col_origin)
        bottom_row = cell_box(L, B, cw, ch, row_origin, col_origin)
        # A corner cell carries its stroke only in the HALF that faces the box, so the walk starts and
        # ends at the border line rather than at the box's outer pixel edge.
        # 45% of a cell clears the corner's own bar, whose ink band starts ~40% into the cell, without
        # stepping past the border line itself.
        inset_y = int(ch * 0.45)
        inset_x = int(cw * 0.45)
        y_lo = left_col[1] + inset_y
        y_hi = bottom_row[3] - inset_y
        entry["sides"]["left"] = gaps(px, [
            (left_col[0], y, left_col[2], y) for y in range(y_lo, y_hi + 1)])
        entry["sides"]["right"] = gaps(px, [
            (right_col[0], y, right_col[2], y) for y in range(y_lo, y_hi + 1)])
        gap_from, gap_to = box.get("top_gap", (L, L - 1))
        segments = [(L, gap_from - 1), (gap_to + 1, R)]
        entry["sides"]["top"] = (0, 0)
        for seg_from, seg_to in segments:
            if seg_to < seg_from:
                continue
            x_start = cell_box(seg_from, T, cw, ch, row_origin, col_origin)[0] + inset_x
            x_end = cell_box(seg_to, T, cw, ch, row_origin, col_origin)[2] - inset_x
            entry["sides"]["top"] = tuple(
                a + b for a, b in zip(entry["sides"]["top"], gaps(px, [
                    (x, top_row[1], x, top_row[3]) for x in range(x_start, x_end + 1)])))
        x_start = cell_box(L, B, cw, ch, row_origin, col_origin)[0] + inset_x
        x_end = cell_box(R, B, cw, ch, row_origin, col_origin)[2] - inset_x
        entry["sides"]["bottom"] = gaps(px, [
            (x, bottom_row[1], x, bottom_row[3]) for x in range(x_start, x_end + 1)])
        missing_total = sum(v[0] for v in entry["sides"].values())
        total_missing += missing_total
        record["boxes"].append(entry)
        corner_txt = ", ".join(
            f"{c}={entry['corners'][c]['delta']}px" for c in
            ("top-left", "top-right", "bottom-left", "bottom-right"))
        side_txt = ", ".join(f"{k}:{v[0]}px missing/{v[1]}px longest"
                             for k, v in entry["sides"].items())
        print(f"  {box['name']:<12} corners |dx|: {corner_txt}")
        print(f"  {'':<12} sides: {side_txt}")
    record["bounds"] = {"maxCornerDeltaPx": max_delta, "worstCorner": worst,
                        "missingSidePixels": total_missing,
                        "cornerDeltaLimitPx": 1.0}
    print(f"  -> max corner |dx| = {max_delta}px (worst: {worst}); "
          f"missing side pixels = {total_missing}; limits: <= 1px and 0 missing")
    return record


def probe(path, x_lo, x_hi, y_lo, y_hi):
    """Grid-free reading of ONE card in an image whose crop origin is unknown.

    Finds the card's top border as the longest horizontal ink run inside the given window, then the two
    vertical bars that belong to that card in the row band just below the border, and reports where each
    of the three sits. On a correct render the border's left/right ink ends and the bars' outer ink
    edges agree; on the shipped (pre-fix) tiles the border ends short and the right bar sits past it,
    which is the "floating vertical line beside the card's top-right corner" defect as a number.
    """
    img, px = load(path)
    width, height = img.size
    best = (0, 0, 0)
    for y in range(max(0, y_lo), min(height, y_hi)):
        run = 0
        for x in range(max(0, x_lo), min(width, x_hi)):
            if px[x, y] != BG:
                run += 1
                if run > best[0]:
                    best = (run, x - run + 1, y)
            else:
                run = 0
    if best[0] == 0:
        return {"png": path, "error": "no horizontal ink run inside the window"}
    run_len, bx0, by = best
    bx1 = bx0 + run_len - 1
    # The bars live in the rows just below the border; collect ink columns there and cluster them.
    band_lo, band_hi = by + 12, min(height, by + 50)
    cols = []
    for x in range(max(0, bx0 - 8), min(width, bx1 + 60)):
        if any(px[x, y] != BG for y in range(band_lo, band_hi)):
            cols.append(x)
    clusters = []
    for x in cols:
        if clusters and x - clusters[-1][-1] <= 1:
            clusters[-1].append(x)
        else:
            clusters.append([x])
    bars = [(c[0], c[-1]) for c in clusters]
    # The OUTERMOST clusters are the card's two side bars; anything between them is the card's label.
    left = min(bars, key=lambda b: b[0]) if bars else None
    right = max(bars, key=lambda b: b[1]) if bars else None
    return {"png": path, "size": [width, height], "topBorderY": by,
            "borderX": [bx0, bx1], "barClusters": bars,
            "leftBarX": left, "rightBarX": right,
            "leftDeltaPx": None if left is None else left[0] - bx0,
            "rightDeltaPx": None if right is None else right[1] - bx1}


def main(argv):
    """Entry point: `--probe <png>` for a grid-free reading, otherwise a full grid measurement."""
    if len(argv) >= 6 and argv[0] == "--probe":
        out = probe(argv[1], int(argv[2]), int(argv[3]), int(argv[4]), int(argv[5]))
        print(json.dumps(out, indent=1))
        return 0
    path = argv[0]
    opts = {"cell-w": 10, "cell-h": 19, "row-origin": 0, "col-origin": 0,
            "label": path.split("/")[-1], "json": None}
    i = 1
    while i < len(argv):
        key = argv[i].lstrip("-")
        opts[key] = argv[i + 1]
        i += 2
    record = measure(path, int(opts["cell-w"]), int(opts["cell-h"]), int(opts["row-origin"]),
                     int(opts["col-origin"]), opts["label"])
    if opts["json"]:
        with open(opts["json"], "w", encoding="utf-8") as fh:
            json.dump(record, fh, indent=1)
            fh.write("\n")
    ok = record["bounds"]["maxCornerDeltaPx"] <= 1.0 and record["bounds"]["missingSidePixels"] == 0
    print("  -> PASS" if ok else "  -> FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
