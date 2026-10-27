#!/usr/bin/env python3
"""Measure a shipped screenshot against the geometry it claims, and refuse the ones that are cut.

WHY THIS EXISTS. Two README figures were shipped by eye and were measurably wrong in ways the eye
forgives at page width: the Web Team figure was captured from a panel NARROWER than the graph it
draws (boxes span 0..1234 CSS px while the captured viewport was 1034), so both ends of the drawing
were clipped; the TUI team tile was rasterized by a renderer that painted same-style glyph runs as one
string, so every vertical border drifted off its own corners. This script turns both refusals into
numbers that a capture lane can gate on, and it ships a `--self-test` that proves each arm can go RED.

TWO MODES, one contract — "the picture must contain what it claims to contain":

  web  the facts file written by a capture carries `web.boxes` (the `data-mpd-box` values, in the
       graph's own CSS coordinate frame) and `web.capture` (the rect that was photographed). Every box,
       translated by the capture's box origin, must lie inside `capturedWidth` x `capturedHeight`; the
       graph's content width must fit the graph viewport it was drawn in; and the view must start at
       scrollX=0 / scrollY=0 — "scrolled right" is what made the old numbers look plausible while the
       picture was cut.

  tui  the boxes are DETECTED from the pane text inside the crop band (a matching corner quadruple:
       top-left, top-right, bottom-left, bottom-right in one glyph family), then measured on the PNG
       at the cell grid tmux laid out. Two numbers per figure: every corner's own vertical stroke must
       share its x with the adjacent side's stroke to <= 1 px, and no pixel row on a vertical side may
       be left unpainted. A box the crop cuts is reported as OUTSIDE and never measured — a half box
       cannot pass a closure test.

Usage:
  measure-shots.py web --facts <shot-facts.json> --png <png> [--json <out.json>]
  measure-shots.py tui --pane <pane.txt> --png <png> [--rows A:B] [--cols C:D] [--scale N]
                       [--cell-w W] [--cell-h H] [--json <out.json>] [--label NAME]
  measure-shots.py --self-test

Exit status: 0 the figure passes, 1 it fails, 2 the invocation or an input is unusable.
"""

import json
import os
import sys
import tempfile

from PIL import Image, ImageDraw, ImageFont

# The page background `docker/ui/tui-render.py` paints; anything else is ink.
PAGE_BG = (0x22, 0x26, 0x2E)
# The monospace face the TUI grid is measured from (the renderer's own face, so the self-test draws the
# same glyphs the lane draws).
FONT_PATH = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"
FONT_SIZE = 16
# The corner families a DSH surface draws with: the TUI's light square panel frame, the rounded card
# frame, and the heavy group frame (`╔ ╗ ╚ ╝`).
FAMILIES = [
    ("\u250c", "\u2510", "\u2514", "\u2518"),
    ("\u256d", "\u256e", "\u2570", "\u256f"),
    ("\u2554", "\u2557", "\u255a", "\u255d"),
]
# The corner limit the task fixes, in pixels.
CORNER_LIMIT_PX = 1.0


def parse_band(text, flag):
    """Parse an `A:B` half-open band, refusing anything malformed."""
    parts = text.split(":")
    if len(parts) != 2:
        raise SystemExit(f"{flag} wants A:B (half-open), got {text!r}")
    lo, hi = int(parts[0]), int(parts[1])
    if hi <= lo:
        raise SystemExit(f"{flag} wants hi > lo, got {text!r}")
    return lo, hi


def load(path):
    """Open the PNG as RGB and return `(image, pixel_access)`."""
    image = Image.open(path).convert("RGB")
    return image, image.load()


def ink_bbox(px, box):
    """Bounding box `(x0, y0, x1, y1)` of the ink inside `box` (inclusive), or None when it is empty."""
    x0, y0, x1, y1 = box
    found = None
    for y in range(max(0, y0), y1 + 1):
        for x in range(max(0, x0), x1 + 1):
            try:
                value = px[x, y]
            except IndexError:
                # A cell outside the image is UNPAINTED ink: it is reported as a miss, never a crash.
                continue
            if value != PAGE_BG:
                if found is None:
                    found = [x, y, x, y]
                else:
                    found[0] = min(found[0], x)
                    found[1] = min(found[1], y)
                    found[2] = max(found[2], x)
                    found[3] = max(found[3], y)
    return None if found is None else tuple(found)


def stroke_x(px, box, bar_side):
    """Centre x of a corner glyph's VERTICAL stroke inside `box`.

    `bar_side` is the side the glyph's horizontal bar sits on (`top` for a top corner, `bottom` for a
    bottom one): the bar is the widest run of the glyph's ink, so the stroke is read from the 40% of the
    ink's own bounding box farthest from it. Reading inside the ink bbox, not the cell, keeps the number
    independent of the anchor a renderer painted with — which is what lets the same routine measure a
    pre-fix image as evidence.
    """
    ink = ink_bbox(px, box)
    if ink is None:
        return None
    height = ink[3] - ink[1] + 1
    cut = max(1, int(height * 0.4))
    band = (ink[3] - cut + 1, ink[3]) if bar_side == "top" else (ink[1], ink[1] + cut - 1)
    part = ink_bbox(px, (box[0], band[0], box[2], band[1]))
    return None if part is None else (part[0] + part[2]) / 2.0


def side_stroke_x(px, box):
    """Centre x of the ink in a side cell (a pure vertical glyph, no bar to exclude)."""
    ink = ink_bbox(px, box)
    return None if ink is None else (ink[0] + ink[2]) / 2.0


def gaps(px, points):
    """The missing points and the longest consecutive miss, over a list of one-pixel test boxes."""
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
    """The pixel box of ONE cell, from pane cell coordinates and the crop's pane origin."""
    x0 = (col - col_origin) * cw
    y0 = (row - row_origin) * ch
    return (x0, y0, x0 + cw - 1, y0 + ch - 1)


def find_boxes(lines, rows_band, cols_band):
    """Detect CLOSED frames in the pane text inside the crop band.

    A frame is a corner quadruple of ONE family: a top-left glyph, the FIRST top-right glyph of that
    family on the same row, and the first row below that carries the family's bottom-left glyph in the
    same column AND its bottom-right glyph in the same right column. Frames the crop cuts are returned
    separately: a box with no right edge in the window cannot be measured, and silently measuring the
    three edges it does have would report a pass on half a figure.
    """
    r0, r1 = rows_band
    c0, c1 = cols_band
    inside, outside = [], []
    for row in range(r0, min(r1, len(lines))):
        line = lines[row]
        for tl, tr, bl, br in FAMILIES:
            col = c0
            while col < min(c1, len(line)):
                if line[col] != tl:
                    col += 1
                    continue
                right = line.find(tr, col + 1)
                left = col
                col += 1
                if right < 0:
                    outside.append({"reason": "no top-right corner in the row", "top": row, "left": left})
                    continue
                bottom = None
                for probe in range(row + 1, min(r1, len(lines))):
                    text = lines[probe]
                    if len(text) > right and text[left] == bl and text[right] == br:
                        bottom = probe
                        break
                if bottom is None:
                    # A frame whose bottom edge is outside the band is either the scene's own frame (it
                    # spans the whole pane and the window stops before its bottom) or a card the window
                    # cuts. Only a frame that starts on the crop's FIRST row, near its left edge, is the
                    # scene's; everything else is a cut card and fails the measurement.
                    outside.append({"reason": "no closed bottom edge in the band", "top": row, "left": left,
                                    "right": right, "sceneFrame": row == r0 and left <= c0 + 2})
                    continue
                entry = {"left": left, "top": row, "right": right, "bottom": bottom}
                if right >= c1 or left < c0 or bottom >= r1:
                    # THE SCENE'S OWN FRAME IS THE WINDOW'S EDGE. A terminal figure is a WINDOW into a
                    # full-pane scene, so the panel border that starts on the crop's very first row is
                    # expected to run off the right edge — that is what the published caption says the
                    # window does. Any OTHER frame cut by the crop is a card or a group frame with its
                    # edge outside the picture, which is the defect this tool exists to refuse.
                    entry["reason"] = "cut by the crop band"
                    entry["sceneFrame"] = row == r0 and left <= c0 + 2
                    outside.append(entry)
                else:
                    inside.append(entry)
    return inside, outside


def measure_tui(pane_path, png_path, rows_band, cols_band, scale, cell_w, cell_h, label):
    """Measure every closed frame the pane text declares, on the PNG, and return the record."""
    with open(pane_path, "r", encoding="utf-8") as handle:
        lines = handle.read().splitlines()
    image, px = load(png_path)
    cw = cell_w if cell_w > 0 else int(round(ImageFont.truetype(FONT_PATH, FONT_SIZE).getlength("M"))) * scale
    ch = cell_h if cell_h > 0 else sum(ImageFont.truetype(FONT_PATH, FONT_SIZE).getmetrics()) * scale
    # THE BAND MUST DESCRIBE THE IMAGE IT IS MEASURED AGAINST. The renderer paints every row of the band
    # and trims the width to the widest kept row, so the image is EXACTLY the band's height and AT MOST
    # the band's width; an image WIDER than the band means the caller handed a window narrower than the
    # picture, and every frame outside that window would silently escape the measurement.
    band_w = (cols_band[1] - cols_band[0]) * cw
    band_h = (rows_band[1] - rows_band[0]) * ch
    if image.size[1] != band_h or image.size[0] > band_w or image.size[0] <= 0:
        raise SystemExit(f"the PNG is {image.size[0]}x{image.size[1]} px but the band rows "
                         f"{rows_band[0]}:{rows_band[1]} cols {cols_band[0]}:{cols_band[1]} at {cw}x{ch} px "
                         f"describes at most {band_w}x{band_h} px — the window does not cover the picture")
    boxes, outside = find_boxes(lines, rows_band, cols_band)
    record = {
        "mode": "tui", "label": label, "pane": pane_path, "png": png_path, "size": list(image.size),
        "cell": [cw, ch], "rows": list(rows_band), "cols": list(cols_band), "scale": scale,
        "boxes": [], "outside": outside, "bounds": {},
    }
    print(f"== {label}: {png_path} {image.size[0]}x{image.size[1]} cell={cw}x{ch}px "
          f"crop=rows {rows_band[0]}:{rows_band[1]} cols {cols_band[0]}:{cols_band[1]}")
    print(f"   frames detected inside the crop: {len(boxes)}; cut by the crop: {len(outside)}")
    max_delta = 0.0
    worst = ""
    total_missing = 0
    for box in boxes:
        left, top, right, bottom = box["left"], box["top"], box["right"], box["bottom"]
        entry = {"rect": [left, top, right, bottom], "corners": {}, "sides": {}}
        cells = {
            "top-left": (left, top), "top-right": (right, top),
            "bottom-left": (left, bottom), "bottom-right": (right, bottom),
        }
        sides = {
            "top-left": (left, top + 1), "top-right": (right, top + 1),
            "bottom-left": (left, bottom - 1), "bottom-right": (right, bottom - 1),
        }
        for corner, bar_side in (("top-left", "top"), ("top-right", "top"),
                                 ("bottom-left", "bottom"), ("bottom-right", "bottom")):
            corner_box = cell_box(*cells[corner], cw, ch, rows_band[0], cols_band[0])
            side_box = cell_box(*sides[corner], cw, ch, rows_band[0], cols_band[0])
            cx = stroke_x(px, corner_box, bar_side)
            sx = side_stroke_x(px, side_box)
            delta = None if cx is None or sx is None else abs(cx - sx)
            entry["corners"][corner] = {"cornerX": cx, "sideX": sx, "delta": delta}
            if delta is None:
                delta = CORNER_LIMIT_PX + 1.0
                entry["corners"][corner]["delta"] = None
            if delta > max_delta:
                max_delta = delta
                worst = f"{left},{top}-{right},{bottom}.{corner}"
        # The vertical sides: walk the pixel rows between the corner rows, inside the very cell column
        # the border occupies, and count unpainted rows. The inset clears each corner's own bar without
        # stepping past the border line, so a side that is really there reports 0.
        inset_y = int(ch * 0.45)
        y_lo = cell_box(left, top, cw, ch, rows_band[0], cols_band[0])[1] + inset_y
        y_hi = cell_box(right, bottom, cw, ch, rows_band[0], cols_band[0])[3] - inset_y
        entry["sides"]["left"] = gaps(px, [
            (cell_box(left, top, cw, ch, rows_band[0], cols_band[0])[0], y,
             cell_box(left, top, cw, ch, rows_band[0], cols_band[0])[2], y)
            for y in range(y_lo, y_hi + 1)])
        entry["sides"]["right"] = gaps(px, [
            (cell_box(right, top, cw, ch, rows_band[0], cols_band[0])[0], y,
             cell_box(right, top, cw, ch, rows_band[0], cols_band[0])[2], y)
            for y in range(y_lo, y_hi + 1)])
        total_missing += sum(v[0] for v in entry["sides"].values())
        record["boxes"].append(entry)
        corner_text = ", ".join(f"{name}={entry['corners'][name]['delta']}px" for name in
                                ("top-left", "top-right", "bottom-left", "bottom-right"))
        print(f"   frame {left:>3},{top:>2} .. {right:>3},{bottom:>2}  corners |dx|: {corner_text}")
        print(f"        vertical sides: left {entry['sides']['left'][0]} missing / "
              f"{entry['sides']['left'][1]} px longest, right {entry['sides']['right'][0]} missing / "
              f"{entry['sides']['right'][1]} px longest")
    cut_boxes = [frame for frame in outside if not frame.get("sceneFrame")]
    record["sceneFrameCut"] = [frame for frame in outside if frame.get("sceneFrame")]
    record["bounds"] = {"maxCornerDeltaPx": max_delta, "worstCorner": worst,
                        "cornerDeltaLimitPx": CORNER_LIMIT_PX, "missingSidePixels": total_missing,
                        "framesCut": len(cut_boxes)}
    ok = len(boxes) > 0 and len(cut_boxes) == 0 and max_delta <= CORNER_LIMIT_PX and total_missing == 0
    print(f"   -> max corner |dx| = {max_delta}px (worst: {worst or 'n/a'}); "
          f"missing vertical-side pixels = {total_missing}; frames cut = {len(cut_boxes)}"
          f" (the scene's own frame running off the window edge: {len(record['sceneFrameCut'])})")
    record["ok"] = ok
    print("   -> PASS" if ok else "   -> FAIL")
    return record


def measure_web(facts, png_path, label, key="web"):
    """Check a Web capture's boxes against the rect that was photographed.

    `key` names the facts block: `web` for the English asset, `webZh` for the Chinese twin — a twin is
    its own run and carries its own capture rect, so measuring it against the other block would be a
    claim about the wrong file.
    """
    web = facts.get(key)
    if not isinstance(web, dict):
        raise SystemExit("the facts file carries no `web` object")
    capture = web.get("capture")
    if not isinstance(capture, dict):
        raise SystemExit("web.capture is missing — a capture that records no framing cannot be measured")
    boxes = []
    for raw in web.get("boxes", []):
        parts = [int(p) for p in str(raw).split(",")]
        if len(parts) != 4:
            raise SystemExit(f"web.boxes entry is not left,top,width,height: {raw!r}")
        boxes.append(parts)
    if not boxes:
        raise SystemExit("web.boxes is empty — nothing to measure")
    captured_w = int(capture["capturedWidth"])
    captured_h = int(capture["capturedHeight"])
    origin_x, origin_y = [int(v) for v in capture["boxOrigin"]]
    graph_w, graph_h = [int(v) for v in capture["graphViewport"]]
    content_w = max(x + w for x, _y, w, _h in boxes)
    content_h = max(y + h for _x, y, _w, h in boxes)
    image = Image.open(png_path)
    dsf = float(capture["deviceScaleFactor"])
    expected = [int(round(captured_w * dsf)), int(round(captured_h * dsf))]
    record = {
        "mode": "web", "label": label, "png": png_path, "imagePx": list(image.size),
        "deviceScaleFactor": dsf, "capturedWidth": captured_w, "capturedHeight": captured_h,
        "boxOrigin": [origin_x, origin_y], "graphViewport": [graph_w, graph_h],
        "scrollX": capture.get("scrollX"), "scrollY": capture.get("scrollY"),
        "contentWidth": content_w, "contentHeight": content_h, "boxes": [], "bounds": {},
    }
    print(f"== {label}: {png_path} {image.size[0]}x{image.size[1]}px @ {dsf}x "
          f"-> captured {captured_w}x{captured_h} CSS px; box origin ({origin_x},{origin_y})")
    print(f"   graph viewport {graph_w}x{graph_h} CSS px; content {content_w}x{content_h} CSS px; "
          f"scroll=({capture.get('scrollX')},{capture.get('scrollY')})")
    failures = []
    if list(image.size) != expected:
        failures.append(f"PNG is {list(image.size)}px but {captured_w}x{captured_h} CSS at {dsf}x "
                        f"is {expected}px")
    if content_w > graph_w:
        failures.append(f"content width {content_w} exceeds the graph viewport {graph_w}")
    if content_h > graph_h:
        failures.append(f"content height {content_h} exceeds the graph viewport {graph_h}")
    if capture.get("scrollX") != 0 or capture.get("scrollY") != 0:
        failures.append(f"the view is not at scroll origin: ({capture.get('scrollX')}, {capture.get('scrollY')})")
    for x, y, w, h in boxes:
        box = {"box": [x, y, w, h], "inCapture": [origin_x + x, origin_y + y, w, h]}
        inside = (origin_x + x >= 0 and origin_x + x + w <= captured_w
                  and origin_y + y >= 0 and origin_y + y + h <= captured_h)
        box["inside"] = inside
        record["boxes"].append(box)
        if not inside:
            failures.append(f"box {x},{y},{w},{h} is cut: its capture rect is "
                            f"{origin_x + x},{origin_y + y},{w},{h} against {captured_w}x{captured_h}")
    headroom = {"right": captured_w - (origin_x + content_w),
                "bottom": captured_h - (origin_y + content_h),
                "graphRight": graph_w - content_w, "graphBottom": graph_h - content_h}
    record["bounds"] = {"failures": failures, "headroom": headroom,
                        "captureLimit": [captured_w, captured_h]}
    record["ok"] = len(failures) == 0
    print(f"   boxes: {len(boxes)}; rightmost content x = {origin_x + content_w} "
          f"(capture {captured_w}, headroom {headroom['right']}px); bottom = {origin_y + content_h} "
          f"(capture {captured_h}, headroom {headroom['bottom']}px)")
    print(f"   graph headroom: {headroom['graphRight']}px horizontal, {headroom['graphBottom']}px vertical")
    for failure in failures:
        print(f"   !! {failure}")
    print("   -> PASS" if record["ok"] else "   -> FAIL")
    return record


def draw_boxes(path, boxes, glyphs, broken=None, rows=0, cols=0):
    """Draw `boxes` the way `tui-render.py` does: at the 1x cell grid, then NEAREST-scaled by 2.

    Drawing at 1x matters to the control's honesty: the box-drawing glyphs are designed to fill one
    1x cell (19 px of a 19 px cell), and painting them at the 2x cell would leave gaps the real
    renderer never produces. The scale factor is applied to the finished canvas, exactly as the lane's
    rasterizer does it.
    """
    tl, tr, bl, br = glyphs
    rows = rows or max(b["top"] for b in boxes) + 1
    cols = cols or max(b["right"] for b in boxes) + 1
    font = ImageFont.truetype(FONT_PATH, FONT_SIZE)
    ascent, _descent = font.getmetrics()
    cell_w = int(round(font.getlength("M")))
    cell_h = sum(font.getmetrics())
    image = Image.new("RGB", (cols * cell_w, rows * cell_h), PAGE_BG)
    draw = ImageDraw.Draw(image)
    for box in boxes:
        for col in range(box["left"] + 1, box["right"]):
            for row in (box["top"], box["bottom"]):
                draw.text((col * cell_w, row * cell_h + ascent), "\u2500", font=font, fill=(0xE8, 0xE6, 0xE0), anchor="ls")
        for row in range(box["top"] + 1, box["bottom"]):
            for col in (box["left"], box["right"]):
                draw.text((col * cell_w, row * cell_h + ascent), "\u2502", font=font, fill=(0xE8, 0xE6, 0xE0), anchor="ls")
        for col, row, glyph in ((box["left"], box["top"], tl), (box["right"], box["top"], tr),
                                (box["left"], box["bottom"], bl), (box["right"], box["bottom"], br)):
            offset = 0
            if broken is not None and broken.get("corner") == (col, row):
                offset = broken["dx"]
            # The broken arm paints one corner 3 px off its cell at 1x (6 px as shipped), which is the
            # pre-fix defect in one line: a corner that no longer shares its side's stroke x.
            draw.text((col * cell_w + offset, row * cell_h + ascent), glyph, font=font,
                      fill=(0xE8, 0xE6, 0xE0), anchor="ls")
    image = image.resize((image.width * 2, image.height * 2), Image.NEAREST)
    image.save(path)
    return path


def self_test():
    """Prove both arms can go RED: one synthetic pass and one synthetic failure per mode."""
    failures = []
    with tempfile.TemporaryDirectory() as tmp:
        cell_w, cell_h = 20, 38
        boxes = [{"left": 2, "top": 1, "right": 6, "bottom": 3}, {"left": 8, "top": 1, "right": 12, "bottom": 3}]
        pane = os.path.join(tmp, "pane.txt")
        rows = [" " * 16 for _ in range(6)]
        for box in boxes:
            line = list(rows[box["top"]])
            line[box["left"]], line[box["right"]] = "\u256d", "\u256e"
            rows[box["top"]] = "".join(line)
            line = list(rows[box["bottom"]])
            line[box["left"]], line[box["right"]] = "\u2570", "\u256f"
            rows[box["bottom"]] = "".join(line)
        with open(pane, "w", encoding="utf-8") as handle:
            handle.write("\n".join(rows) + "\n")
        good = draw_boxes(os.path.join(tmp, "good.png"), boxes, ("\u256d", "\u256e", "\u2570", "\u256f"), None, 6, 16)
        record = measure_tui(pane, good, (0, 6), (0, 16), 2, cell_w, cell_h, "self-test tui pass")
        if not record["ok"]:
            failures.append("the tui arm rejected a correctly rasterized frame")
        bad = draw_boxes(os.path.join(tmp, "bad.png"), boxes, ("\u256d", "\u256e", "\u2570", "\u256f"),
                         broken={"corner": (8, 1), "dx": 3}, rows=6, cols=16)
        record = measure_tui(pane, bad, (0, 6), (0, 16), 2, cell_w, cell_h, "self-test tui red")
        if record["ok"]:
            failures.append("the tui arm accepted a frame whose corner stroke is 3 px off its side")
        try:
            measure_tui(pane, good, (0, 6), (0, 10), 2, cell_w, cell_h, "self-test band red")
            failures.append("the tui arm accepted a measurement band narrower than the picture")
        except SystemExit:
            print("   [self-test band red] a band narrower than the picture was refused, as designed")
        holed = os.path.join(tmp, "holed.png")
        image = Image.open(good).convert("RGB")
        draw = ImageDraw.Draw(image)
        draw.rectangle([2 * cell_w, 2 * cell_h + 8, 2 * cell_w + cell_w - 1, 2 * cell_h + 18], fill=PAGE_BG)
        image.save(holed)
        record = measure_tui(pane, holed, (0, 6), (0, 16), 2, cell_w, cell_h, "self-test tui hole red")
        if record["ok"] or record["bounds"]["missingSidePixels"] == 0:
            failures.append("the tui arm counted no missing side pixels on a side with a punched hole")
        # The web arm: one facts file that fits, one that does not.
        def facts(boxes_list, captured, scroll=(0, 0)):
            return {"web": {"boxes": boxes_list, "capture": {
                "capturedWidth": captured[0], "capturedHeight": captured[1], "boxOrigin": [12, 40],
                "graphViewport": [captured[0] - 24, 120], "scrollX": scroll[0], "scrollY": scroll[1],
                "deviceScaleFactor": 1}}}
        png = os.path.join(tmp, "web.png")
        Image.new("RGB", (400, 200), PAGE_BG).save(png)
        ok_facts = facts(["0,0,144,42", "170,0,144,42"], (400, 200))
        record = measure_web(ok_facts, png, "self-test web pass")
        if not record["ok"]:
            failures.append("the web arm rejected boxes that fit the capture")
        cut_facts = facts(["0,0,144,42", "1000,0,144,42"], (400, 200))
        record = measure_web(cut_facts, png, "self-test web red")
        if record["ok"]:
            failures.append("the web arm accepted a box 1000 px wide in a 400 px capture")
        scrolled = facts(["0,0,144,42"], (400, 200), scroll=(200, 0))
        record = measure_web(scrolled, png, "self-test web scrolled red")
        if record["ok"]:
            failures.append("the web arm accepted a capture that is not at scroll origin")
    if failures:
        for failure in failures:
            print(f"  !! {failure}")
        print("--self-test FAIL")
        return 1
    print("--self-test PASS (tui arms: good/pass, corner-drift>=1px/red, side-hole/red, band-narrow/red; "
          "web arms: fits/pass, cut/red, scrolled/red)")
    return 0


def main(argv):
    """Entry point: dispatch on the first argument, always printing the numbers it judged."""
    if not argv:
        print(__doc__)
        return 2
    if argv[0] == "--self-test":
        return self_test()
    mode = argv[0]
    options = {"rows": "0:10", "cols": "0:10", "scale": "2", "cell-w": "0", "cell-h": "0",
               "label": "", "json": "", "facts": "", "facts-key": "web", "pane": "", "png": ""}
    i = 1
    while i < len(argv):
        key = argv[i].lstrip("-")
        if key not in options:
            raise SystemExit(f"unknown option {argv[i]!r}")
        options[key] = argv[i + 1]
        i += 2
    label = options["label"] or os.path.basename(options["png"] or options["facts"] or mode)
    record = None
    if mode == "web":
        with open(options["facts"], "r", encoding="utf-8") as handle:
            facts = json.load(handle)
        record = measure_web(facts, options["png"], label, options["facts-key"])
    elif mode == "tui":
        record = measure_tui(options["pane"], options["png"], parse_band(options["rows"], "--rows"),
                             parse_band(options["cols"], "--cols"), int(options["scale"]),
                             int(options["cell-w"]), int(options["cell-h"]), label)
    else:
        raise SystemExit(f"unknown mode {mode!r} (expected web | tui | --self-test)")
    if options["json"]:
        with open(options["json"], "w", encoding="utf-8") as handle:
            json.dump(record, handle, indent=1)
            handle.write("\n")
    return 0 if record["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
