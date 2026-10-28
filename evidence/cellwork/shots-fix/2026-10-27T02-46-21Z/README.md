# The TUI figure re-rendered: per-glyph cell origins, a self-test, and the numbers

**What this wave was.** The README's `docs/assets/images/tui-team-dag-groups.png` showed a group
frame whose `╗` floated a column left of its own `║`, and every card's top-right corner had a stray
vertical tick beside it. The TUI grid was correct; the DOCUMENT RASTERIZER was not. This directory
holds the fix, the archive-based re-render, and the pixel readings taken on the shipped file.

**What it is not.** No TUI layout logic was touched (`packages/**` is byte-identical), no PTY was
re-shot, no gate or test was edited, and nothing was committed.

| | |
|---|---|
| Renderer fixed | `docker/ui/tui-render.py` — `render()`, plus a new `--self-test` |
| Renderer before | sha256 `81c968312f3c…` (byte copy: `renderer-before.py`) |
| Renderer after | sha256 `9ee69b3b14f75788…` (byte copy: `renderer-after.py`) |
| Asset re-rendered | `docs/assets/images/tui-team-dag-groups.png`: 3160×2107 `8511d26ddf5a…` → **2040×2280 `426a748799aa…`** |
| Source pane | `evidence/cellwork/shots/2026-10-26T16-25-00Z/tui-pane-en.txt` sha256 `e94ff9d89de1…` |
| Measured result | 40 corner readings and 40 side walks on 10 boxes: **max \|Δx(corner, side)\| = 0.0 px, 0 missing side pixels** |

---

## 1. What was wrong — measured, not eyeballed

`render()` buffered every same-style glyph of a row into one string and painted it with ONE
`draw.text` at the run's start column:

```python
draw.text((run_start * cell_w, y), "".join(pending), font=f, fill=run_style[0], anchor="lt")
```

DejaVuSansMono at 16 pt advances **9.640625 px** where the grid step is `int(round(...)) = 10 px`, so
every glyph after the first of a run landed **0.359375 px left of its own cell** (0.71875 px at
`--scale 2`). The drift is proportional to the run length, and the TUI emits one run per same-tone
span, so the drift differed BETWEEN structures in the same figure:

| Run | glyphs | drift at 100% | at `--scale 2` |
|---|---|---|---|
| a card's top border (`╭───…───╮`) | 25 | 8.625 px = 0.86 cell | 17.25 px |
| the group frame's top border (`╔ subcell-auth ═…╧…╗`) | 55 | 19.406 px = 1.94 cell | 38.8 px |
| a card's right side (its own 1-cell run) | 1 | 0 px | 0 px |

**A SECOND DEFECT, found while fixing the first.** The same call rode `anchor="lt"` — the text's INK
top — not the cell's baseline. A box-drawing corner's ink starts 8 px below its line box's top and its
vertical stroke only reaches the bottom half of the cell, so with the ink-top anchor every corner was
painted 8 px too high and every vertical border broke for 8 px under each corner row instead of
closing. Measured on the shipped PNG (`measure/shipped-vertical-gaps.log`): card T1's left side bar is
ink at rows **183–202 and 219–278**, i.e. a **16 px gap at `--scale 2` (8 px at 100%)** where the
border should run on: 8 px at 100 % is exactly the corner's own ink offset. The fix therefore paints on
the BASELINE (`anchor="ls"` at `y + ascent`), which is where a terminal puts a glyph in its cell.

**The defect in the shipped bytes, as two numbers** (`measure/probe-shipped-groups.log`): card T1's
top border runs x 88–553 and that card's own right side bar sits at x 568–571 — the bar is **18 px
past the end of the border it is supposed to close** (0.90 cell at 20 px/cell at `--scale 2`). That is
the "floating vertical line beside the card's top-right corner".

## 2. What changed in `docker/ui/tui-render.py`

1. `render()` paints **one `draw.text` per glyph at `col * cell_w`**, on the cell's baseline. A run of
   same-style cells now supplies only its **background rectangle** (unchanged behaviour, unchanged
   colour), and a combining mark rides the glyph it modifies rather than getting a cell of its own.
   Wide (CJK) glyphs were already drawn at their own cell origin and are untouched.
2. The module docstring's old "bound 1" (which described the one-string run as deliberate) is
   replaced by the corrected rule, with the measured numbers.
3. `--self-test` was added (below). No other file in the repository imports this script, so nothing
   else changes shape.

`cell_w = int(round(adv))` is UNCHANGED — the fix does not hide the 9.64 px advance behind a different
font size, it puts each glyph on the grid the advance was rounded to.

## 3. `--self-test`: two arms, each with a reverse control that must go RED

```
$ python3 docker/ui/tui-render.py --self-test
[selftest] grid: cell_w=10px cell_h=19px (DejaVuSansMono@16, advance 10px after rounding)
[selftest] arm 1: the last glyph of a row of 40 '═' is painted on cell 39's origin
[selftest]   reference: one '═' at cell 4 -> ink right edge x=49, cell origin x=40, glyph right inset 9px
[selftest]   fixed:     ink right edge x=399 -> cell origin x=390 (want 390) -> PASS
[selftest]   reverse:   the pre-fix one-run drawing of the same row -> ink right edge x=385 -> cell origin x=376, off by 14px = 1.40 cell(s) -> FAILS as required (needs >= 1.00 cell)
[selftest] arm 2: a frame's top-right corner and its right side share one x
[selftest]   fixed:     corner stroke x=244.0, side stroke x=244.0 -> |delta|=0.0px -> PASS (<= 1px)
[selftest]   reverse:   the pre-fix run drawing -> corner stroke x=235.0, side stroke x=244.0 -> |delta|=9.0px = 0.90 cell(s) -> FAILS as required (> 1px)
[selftest] PASS: 2 arms, both reverse controls went red
EXIT=0
```

* **Arm 1** is the required assertion: a synthetic row of **40 `═`**, and the last glyph's own cell
  origin — derived from its ink's right edge minus the glyph's right inset, measured once on a lone
  `═` — must be exactly `39 * cell_w`. 399 − 9 = **390 = 39 × 10**.
* **Arm 1's reverse control** runs the PRE-FIX algorithm (an independent copy inside the self-test,
  not a flag on `render`) on the same row: the same derivation gives **376**, i.e. **14 px = 1.40
  cell** short — it fails, by more than the required 1 cell, so the assertion is falsifiable.
* **Arm 2** is the defect the figure actually showed: a 25-cell double-line frame whose top border is
  ONE tone and whose right side is its OWN run (the structure `graph.ts` emits). The corner's vertical
  stroke and the side's stroke must share an x: **244.0 vs 244.0, Δ = 0.0 px**.
* **Arm 2's reverse control** gives **235.0 vs 244.0, Δ = 9.0 px (0.90 cell)** — red, as required.

The control is a copy rather than a switch on the fixed code on purpose: a future regression must not
be able to disable its own detector.

## 4. The re-render: which archive, which crop, and why

**Source** — `evidence/cellwork/shots/2026-10-26T16-25-00Z/tui-pane-en.txt`
(sha256 `e94ff9d89de121db2fa79936c8cd8744a7b60bf52c5fb936aecf96e99c3020`, 11 986 bytes, 62 lines,
0 ESC bytes). Its row 59 is `esc/q close · ↑↓ focus · click pins · hover previews · ⇧↑↓ scroll · r
refresh · a plan · p board`: `hover previews` is printed by `scenes.ts` `surfaceHints` and the DAG
page's footer (`panel-dag.ts` `dagFooterText`) prints `⤢ full · ↑↓/jk · ⏎ pin · esc · ⇧↑↓←→` instead —
so the archived pane is the **full-screen team SCENE**, not the DAG page (see §7).

**Command** (the shipped bytes are exactly this output):

```
python3 docker/ui/tui-render.py \
  evidence/cellwork/shots/2026-10-26T16-25-00Z/tui-pane-en.txt \
  docs/assets/images/tui-team-dag-groups.png \
  --rows 1:61 --cols 0:102 --scale 2
# docs/assets/images/tui-team-dag-groups.png (2040, 2280) rows=60 cols=(0, 102) scale=2
```

`--rows 1:61` is pane rows **2–61** in the file's 1-based numbering: the scene's own top border
(`┌◒ MPD team — nested-dag-demo · 156x60──…`) down to its own bottom border (`└──…──┘`), i.e. **60
cells**. The previous tile began at the page header and had lost that top border row.

`--cols 0:102` is the only crop: the scene's widest text line is the progress row (row 4), whose last
non-blank column is **100**, so 102 columns keep every chrome row whole (progress `… 6 link(s)`, the
legend, the key hints) and drop only the 56 padding columns and the panel's right border. That also
fixes legibility, which the full-width tile could not:

| tile | columns | px wide | px per cell at 880 px display | at 948 px |
|---|---|---|---|---|
| shipped before | 158 | 3160 | 5.57 | 6.00 |
| **shipped now** | **102** | **2040** | **8.63** | **9.29** |

(px/cell = display width ÷ columns; both readings clear the 8 px bound the crop was chosen for.)

**One bound, stated rather than hidden:** the archived capture is `tmux capture-pane -p -J` — **no
SGR** — so the renderer has no colour tones to paint and every glyph is drawn in the page foreground.
The GLYPH GRID (what this figure is about) is exact; the host's tones would need the ANSI stream, which
this archive does not carry. That is why the new tile is monochrome where the old one was coloured.

## 5. The verification: every corner and every side of the shipped PNG

`measure.py` knows only the cell size and where the crop starts in pane coordinates; its box
rectangles are transcribed from the archived pane rows, so it cannot agree with a wrong renderer by
construction. Bounds: `|Δx(corner, adjacent side)| ≤ 1 px` and `0` un-painted pixels per side.

**After — the shipped `docs/assets/images/tui-team-dag-groups.png`, measured on its own pixels (a
200 %-scale render read at 100 % zoom, 20 × 38 px cells** — `measure/after-s2.log`,
`measure/after-s2.json`), **and again on a `--scale 1` render, which is true 100 % scale**
(`measure/after-s1.log`): **identical numbers.**

| box | \|Δx\| top-left | top-right | bottom-left | bottom-right | missing px (left/right/top/bottom) |
|---|---|---|---|---|---|
| group-frame | 0.0 | 0.0 | 0.0 | 0.0 | 0 / 0 / 0 / 0 |
| card-T1 | 0.0 | 0.0 | 0.0 | 0.0 | 0 / 0 / 0 / 0 |
| card-T2 | 0.0 | 0.0 | 0.0 | 0.0 | 0 / 0 / 0 / 0 |
| card-T3 | 0.0 | 0.0 | 0.0 | 0.0 | 0 / 0 / 0 / 0 |
| card-T4 | 0.0 | 0.0 | 0.0 | 0.0 | 0 / 0 / 0 / 0 |
| card-C1 | 0.0 | 0.0 | 0.0 | 0.0 | 0 / 0 / 0 / 0 |
| card-C2 | 0.0 | 0.0 | 0.0 | 0.0 | 0 / 0 / 0 / 0 |
| card-C3 | 0.0 | 0.0 | 0.0 | 0.0 | 0 / 0 / 0 / 0 |
| card-C4 | 0.0 | 0.0 | 0.0 | 0.0 | 0 / 0 / 0 / 0 |
| card-T5 | 0.0 | 0.0 | 0.0 | 0.0 | 0 / 0 / 0 / 0 |

`max corner |dx| = 0.0 px; missing side pixels = 0` → PASS. The group frame's four sides are closed:
its top side is walked in two segments around its own title (`╔ subcell-auth …`), and the `╧` on the
top border and `╫` on the bottom one are part of the border, not holes.

**Before — the same measurement on the pre-fix renderer, same pane, same crop**
(`measure/before-s1.log`): `max corner |dx| = 4.0 px; missing side pixels = 1025` → FAIL, and the shape
of the failure is the drift itself — each card's whole right side column is empty (41 of 41 px) and the
frame's is (345 of 345 px), because a run-drawn glyph no longer falls inside its own cell.

**The shipped file, before vs after, by the grid-free probe** (`measure/probe-*.log`):

| file | card top border | that card's right side bar | bar past the border's end |
|---|---|---|---|
| shipped 2026-10-26 (`before/shipped-tui-team-dag-groups.png`) | x 88–553 | x 568–571 | **+18 px** (0.90 cell) |
| re-rendered 2026-10-27 (`after/tui-team-dag-groups.png`) | x 88–571 | x 568–571 | **0 px** |

`compare-card-corner.png` is the same corner from both files at 2× zoom (left: the border ends short and
the side bar floats beside it; right: a closed corner). Note what the probe reads on the CONTROLLED
pre-fix render of the plain-text archive (`measure/probe-before-groups.log`): **0 px** — a monochrome
archive is ONE style run per row, so the old algorithm squeezes each row uniformly instead of splitting
a corner from a side. The +18 px is measured on the bytes that were actually shipped, and the split
mechanism is reproduced by the self-test's reverse control, which models the real style-run structure.

**Vertical closure, shipped file, before vs after** (`measure/shipped-vertical-gaps.log`): card T1's
left side is ink at rows 183–202 and 219–278 before (**16 px gap** at `--scale 2`), and one continuous
run 206–287 after (**0 gaps**).

## 6. `docs/assets/images/tui-team-dag.png`: same defect, measured, NOT re-rendered

It carries the defect too: its card T1's top border runs x 88–265 and that card's right side bar sits
at x 268–271 — **+6 px** (`measure/probe-shipped-dag.log`), which is the same law over a 9-cell card
(8 × 0.71875 = 5.75 px at `--scale 2`).

**It is not re-rendered here, because there is no archived pane to re-render it from.** The file was
produced by the v0.15.0 capture lane: `evidence/release/v0.15.0/ui-capture/20261020T115739Z/` keeps the
manifest, which records `rows=0:35 cols=0:158 scale=2 lang=en geometry=158x45` for `tui-team-dag.png`,
and the image's own 3120 × 1330 = 156 × 35 cells at 20 × 38 px agrees — but that directory holds NO
pane text and no ANSI (`/data/tui-evidence` lived inside the container). A `grep` over `evidence/**`
for the fixture string `webui-tui-i18n` finds only gate logs naming `docs/plan-webui-tui-i18n.md`, never
a pane; the panes that do carry the marker `task dependency graph` are 2026-10-06 captures of other
fixtures. So the
alternative — rendering the nested-dag-demo archive into that file — would silently change WHICH team
and WHICH scene the tile depicts, and its caption in `docs/index.md` would become false.

Options for that file, in the order this wave recommends them: (a) re-shoot it with
`docker/ui/tui-capture.sh`, which now rasterizes through the fixed renderer and fixes it by
construction; or (b) withdraw it from `docs/index.md`, which is its only citation. Both are outside
this wave's scope (a PTY re-shoot and a removal of a documented asset are separate decisions).

## 7. The captions and the fact file, corrected (both languages)

The archived pane is the team **scene**; the README caption, the Chinese caption and
`docs/index.md`'s asset row all called it the DAG page, and `shot-facts.json` recorded
`tui.surface: "DSH-TUI 0.17.0 DAG page, full screen (the page's own fullscreen control), 160x62 PTY"`.
What the pane prints decides it: `hover previews` in row 59 belongs to `scenes.ts` `surfaceHints`
(`packages/mpd-tui-plugin/src/scenes.ts:1024`), while the DAG page's footer text is
`⤢ full · ↑↓/jk · ⏎ pin · esc · ⇧↑↓←→` (`packages/mpd-tui-plugin/src/panel-dag.ts`, `dagFooterText`).
The RUNBOOK's route is not wrong — the capture opens `/mpd dag` and clicks the page's `⤢`, and that
control's own binding is `openFullscreenScene: () => scene.openTeam()`
(`packages/mpd-tui-plugin/src/index.ts`) — but the SURFACE those pixels show is the scene the `⤢`
opens, so that is what the caption and the fact file must name.

| file | change |
|---|---|
| `README.md` | the tile's caption: full-screen team **scene** (not the DAG page), the frame/port/interior cards, and the framing (top border to bottom border, 102 of 158 columns, ≥ 8 px per cell) |
| `README.zh-CN.md` | the same caption in 简体中文, same claims and the same crop wording |
| `docs/index.md` | the asset row's "on the DSH-TUI's DAG page" → "in the DSH-TUI's full-screen team scene (not the DAG page)" |
| `evidence/cellwork/shots/2026-10-26T16-25-00Z/shot-facts.json` | `tui.surface` corrected; `tui.renderer` (new sha256 + crop), `tui.rendererBefore`, `tui.renderSource` (pane path + sha256 + the no-SGR bound), `tui.measured` (the readings above) added; the asset's dimensions updated; one bound that described the old capture route rewritten; two bounds added (monochrome archive, sides measured closed); a `corrections[]` array records every before/after pair with its reason |

## 8. Gates run

| command | observed result | exit |
|---|---|---|
| `bun run verify:docs` | `pairs=52 failed=0 violations=0 exempt=24 derived=3 links=471 dead=0 — PASS` | 0 |
| `node scripts/verify-vendor.ts` | `PASS - 7 shipped asset(s) fingerprinted, upstream identity not checked` (the fingerprints cover the vendored code, not `docs/assets/images`, so a re-rendered tile does not move the baseline) | 0 |
| `bun run verify:manifest` | `files-allowlist: 25 pattern(s); 0 required path(s) not admitted`; `evidence-excluded: the frozen evidence/ tree stays out of the published package`; `packed-content: npm pack --dry-run lists 1085 file(s); 0 required path(s) absent`; `VERDICT: PASS` | 0 |
| `node scripts/verify-pack-closure.ts` | ok, 25 dist rows + 4 mcp rows + 6 root assets; `content bytes: 625 file(s) compared, 623 identical, 0 drift, 2 expected-after-pack` — the two expected ones are `docs/assets/images/tui-team-dag-groups.png` and `docs/index.md`, both with a source mtime AFTER the artifact stamp, which the gate reports as `CONTENT-DRIFT-EXPECTED … NOT a closure violation` | 0 |

`docker/ui/tui-render.py --self-test` output and exit code are in §3 / `self-test.log`.

## 9. What this evidence does NOT prove

* **The packed artifact still carries the OLD image bytes.** `dist/mpd-package/docs/assets/images/
  tui-team-dag-groups.png` is the pre-fix file; `verify-pack-closure` names it as
  `expected-after-pack` (T-26's post-pack-writer discriminator) rather than a violation. The re-pack
  (`npm run pack`) is the integration step and was not run here: it rewrites the whole derived tree.
* **No PTY was re-shot.** Every number above is read off the archived pane and the PNG bytes; nothing
  here re-proves that the live TUI still draws the same grid (it does not need to — the grid was never
  in question, and `packages/**` is untouched).
* **Colour fidelity is not restored** (§4): the archive carries no SGR.
* **`docker/ui/tui-capture.sh` still re-shoots the OLD framing** (`TEAM_WIN_W_FRAC="1"`, 158 columns →
  5.6 px/cell at README width). A future run of that lane reproduces a wider, less legible tile than
  the one shipped here; whoever re-shoots must either accept that or move the fraction to
  102/158 = 0.6456. Left unchanged on purpose: it is a PTY lane, and its comment records a measured
  reason for the current value.
* **The crop is a judgement call, not a measurement.** 102 columns is "the scene's widest text line
  plus one"; a narrower tile that cuts the progress row mid-word was rejected, and a wider one loses
  the 8 px/cell bound.

## 10. Files here

| file | bytes | sha256 (16) |
|---|---|---|
| `renderer-before.py` (the pre-fix renderer, `git show HEAD:docker/ui/tui-render.py`) | 14984 | `81c968312f3c54bf` |
| `renderer-after.py` (byte copy of the fixed renderer) | 27783 | `9ee69b3b14f75788` |
| `self-test.log` | 946 | `133e5ad5df4697d5` |
| `before/shipped-tui-team-dag-groups.png` (the file that was shipped) | 81769 | `8511d26ddf5af43f` |
| `before/tui-team-dag-groups.png` (pre-fix renderer, same pane + crop) | 85446 | `5ebb6686159a507c` |
| `after/tui-team-dag-groups.png` (the shipped bytes now) | 83686 | `426a748799aa1cfc` |
| `compare-card-corner.png` (before/after corner, 2× zoom) | 12364 | `6f05b36ab667edd8` |
| `measure.py` (the measurement tool) | 14142 | `2eaaba8555286b03` |
| `measure/after-s1.{png,log,json}` / `measure/after-s2.{png,log,json}` | | |
| `measure/before-s1.{png,log,json}` | | |
| `measure/probe-{shipped-groups,shipped-dag,new-groups,before-groups}.log` | | |
| `measure/shipped-vertical-gaps.log` | 279 | `5659f6c042fd58f0` |
| `gate-verify-docs.log` | 5702 | `4228488bba3c7503` |
| `gate-verify-vendor.log` | 715 | `e7e717eee4b0753d` |
| `gate-verify-manifest.log` | 1203 | `6fe433e6720e705f` |
| `gate-pack-closure-final.log` | 1766 | `66aa292a866220cb` |
| `sha256-input.txt` (every input and every renderer copy, hashed) | 849 | `2b8ded6a8489bae3` |
