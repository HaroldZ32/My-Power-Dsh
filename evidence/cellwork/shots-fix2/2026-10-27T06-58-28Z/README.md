# shots-fix2 — the two remaining DAG figures, measured instead of eyeballed

**What this wave was.** Two README/docs figures were still wrong after the rasterizer fix in
`evidence/cellwork/shots-fix/2026-10-27T02-46-21Z/`:

1. `docs/assets/images/web-team-dag-groups.png` — the Team view was captured from a panel NARROWER
   than the graph it draws, so part of the drawing was outside the image (the shipped PNG shows T1
   absent and T2/T3 cut on their left side).
2. `docs/assets/images/tui-team-dag.png` — the same rasterizer defect the groups figure had: corner
   strokes up to 6 px off their own side bars, and 102 unpainted vertical-side pixels. Its producing
   round archived only a manifest (`evidence/release/v0.15.0/ui-capture/20261020T115739Z/`), so no pane
   text/ANSI existed to re-render from — it had to be RE-CAPTURED on a real PTY.

Both are fixed, and both fixes are gated by ONE new measurement tool whose self-test includes red
arms, so a future capture cannot silently ship the same class of defect.

| | |
|---|---|
| Web asset (EN) | 2068×1169 `072c7b0882eb…` → **2608×1094 `9f5826ee9be9…`** |
| Web asset (zh-CN) | 2068×1169 `3a927fdd7653…` → **2608×1094 `014a88566f8e…`** |
| TUI asset | 3120×1330 `e4c808036da0…` → **2180×1330 `29d2d6a26322…`** |
| Measurement tool | NEW `docker/ui/measure-shots.py` (`web` + `tui` modes, `--self-test`) |
| Web capture path | NEW `docker/ui/shoot-team-dag.mts` + `docker/ui/shoot-team-dag.sh` (capture **then** gate) |
| TUI capture path | `docker/ui/tui-capture.sh`: width fraction re-measured, band starts at the scene's own border, and scene 1 now runs the measurement itself |
| Docs | `docs/index.md` + `docs/index.zh-CN.md`: the capture paragraph states the measurable rule; the EN TUI row states the 109-of-158 window |
| Facts | `evidence/cellwork/shots/2026-10-26T16-25-00Z/shot-facts.json` — `web.capture` added (capturedWidth/Height, box origin, graph viewport, scroll origin), `web.viewport` re-written, the zh twin block added, `tuiTeamDag` added, before/after numbers in `corrections[]` |

**What it is not.** No `packages/**` file was touched (the container profile carries a COPY of the
checkout's `mpd-team-core-plugin/dist` + `mpd-bundle-plugin/{dist,client.js}`, sha256-compared to the
checkout before the capture), no TUI layout logic was changed, no gate or test was edited, nothing was
committed, and nothing was written to `~/.dsh` (the capture ran inside the UI-VIEW container's own
sandboxes `/data/dsh-web` / `/data/dsh-tui`).

---

## 1. Web: the WHOLE graph, not the reachable window

### What was wrong, measured

`shot-facts.json` recorded `web.boxes` spanning **0..1234 CSS px** and `web.viewport` "2300x1500 @
deviceScaleFactor 2, graph scrolled right", while the shipped asset was **2068×1169 px = 1034×584.5 CSS
px**. The old image's own pixels locate its view: the group frame's left border (content x=510) sits at
image x=298 CSS, so the window started ~**212 CSS px** into the drawing. T1's card (0..144) is entirely
outside; T2 (170..314) and T3 (340..484) lose their left parts; T6 ends 12 CSS px inside the right edge.
A 1034 px window cannot hold a 1234 px graph at any scroll offset.

The old facts also carried no captured rect, so nothing in it could have caught the loss. That is why
the new facts carry `web.capture`.

### What the re-shoot does

`docker/ui/shoot-team-dag.mts` opens the Team panel at **2900×1500 @ deviceScaleFactor 2** (the host
gives the right sidebar 45% of the window → 1304 px), binds the nested fixture
(`team-nested-parent` / `team-nested-sub`) to every web session, scrolls every scrollable ancestor to
origin, asserts the frame layer is on screen, and photographs the panel from its own top to the graph's
bottom + 14 px. `docker/ui/shoot-team-dag.sh` then runs the gate on the resulting facts + PNG.

Numbers (`evidence/cellwork/shots-fix2/<ts>/web-shipped.measure.json`):

```
captured 1304x547 CSS px (image 2608x1094 px @ 2x), box origin (12,419)
graph viewport 1280x114 CSS px; content 1234x104 CSS px; scroll=(0,0)
boxes: 10; rightmost content x = 1246 (capture 1304, headroom 58px); bottom = 523 (capture 547)
graph headroom: 46px horizontal, 10px vertical
-> PASS   (EN_EXIT=0, ZH_EXIT=0)
```

Every box satisfies `origin + x >= 0 && origin + x + w <= capturedWidth` and the same on y; content
width 1234 ≤ graph viewport 1280; scroll origin is (0,0). The zh-CN twin is its own run of the same
script (`--locale zh-CN`) and passes with the same numbers.

## 2. TUI: re-captured on a real PTY from the same fixture

**Fixture.** `team-2026-10-05T22-30-00.000Z` / `webui-tui-i18n` — the `normal` board written by
`docker/ui/team-fixture.mts`: **6 tasks, 5 members**, the same record the shipped 2026-10-20 tile was
made from. It was reproduced, not approximated: `docker/ui/tui-capture.sh` restarted the session at
158×45 (`restart-tui.sh`), materialized a session with `/mpd board`, seeded the fixture for that
session id, opened `/mpd team`, and read the pane with `tmux capture-pane -e -p -J`.

**Crop.** rows **1:36**, cols **0:109** of the pane (the scene's own top border row through six rows
below the hint row), rasterized by the FIXED `docker/ui/tui-render.py --scale 2` → 2180×1330 px.

**Why 109 columns and not 102.** The task suggested 102/158 ≈ 0.6456 to reproduce the published
readable crop. Measured on this scene, 102 is too narrow: the widest text row is the roster, which ends
at **cell 107** — a 102-column window drops its last five cells, `r 0/1`:

```
keeps up to cell 101: '  │ roster  ◐lead 0/0 · … · ○tui-model-i18n 1/1 · ○ui-reviewe'
drops:                'r 0/1'
```

That is the same mid-word cut the previous 0.614 reproduced (`4 lin`, `ui-re`, `p bo`). 109 columns
keep the roster plus two cells of margin, and 109×20 px = 2180 px is **8.1 px per character cell** at
the README's display width — the ≥ 8 px rule the 102-column groups figure documents. `TEAM_WIN_W_FRAC`
therefore moves from `1` to **0.6899 (109/158)**, with the three numbers written in the script's comment.

**Measurement** (`tui-shipped.measure.json`):

```
frames inside the crop: 6; cards cut by the crop: 0
frame   4, 6 .. 13, 8   corners |dx|: 0.0 / 0.0 / 0.0 / 0.0 px ; vertical sides 0 missing
frame  17, 6 .. 26, 8   … 0.0 px ; 0 missing
frame  30, 6 .. 39, 8   … 0.0 px ; 0 missing
frame   4,12 .. 13,14   … 0.0 px ; 0 missing
frame   4,18 .. 13,20   … 0.0 px ; 0 missing
frame   4,24 .. 13,26   … 0.0 px ; 0 missing
-> max corner |dx| = 0.0 px (limit 1.0); missing vertical-side pixels = 0; scenes frame cut = 1 (its right border is outside the documented window)
-> PASS   (TUI_EXIT=0)
```

**The same numbers on the OLD tile** (its six card rectangles transcribed from its own border grid —
T1's top border ran x 88..265 px per `shots-fix/…/probe-shipped-dag.log` = cells 4..13 on a 20 px grid):

```
-> max corner |dx| = 6.0 px (worst: 4,6-13,8.top-right); missing vertical-side pixels = 102
-> FAIL
```

**Reproduced by the WIRED path, byte for byte.** A full run of the updated `docker/ui/tui-capture.sh`
produced a PNG with the same sha256 as the installed asset (`29d2d6a26322…`), and its manifest note
carries `rows=1:36 cols=0:109 … measure=pass` (`tui/tui-manifest.json`, `tui/measure.log`).

## 3. Making it structural

- `docker/ui/measure-shots.py` — one tool, two modes:
  - `web --facts <facts.json> --png <png> [--facts-key web|webZh]`: refuses a box outside the captured
    rect, content wider than the graph viewport, a non-origin scroll, or a PNG whose pixel size does
    not match `capturedWidth/Height × deviceScaleFactor`.
  - `tui --pane <pane.txt> --png <png> --rows A:B --cols C:D --scale N`: detects closed frames in the
    pane text, measures the shipped pixels (`|Δx(corner stroke, side stroke)| ≤ 1 px`, 0 unpainted
    vertical-side pixels), refuses a CARD the crop cuts, and tolerates only the scene's own panel frame
    running off the window edge.
  - `--self-test`: **seven arms, five of them red** — TUI good/pass, corner drift +3 px/red, a punched
    side hole/red, a measurement band narrower than the picture/red; Web fits/pass, cut box/red,
    non-origin scroll/red. On real data, handing the tool a 30-column band for the 109-column tile is
    refused: *"the PNG is 2180x1330 px but the band … describes at most 600x1330 px"* (`exit 1`).
- `docker/ui/shoot-team-dag.sh` — the Web capture path: capture, then run the gate, and exit with the
  gate's status. A capture that does not fit cannot leave a PNG behind unnoticed.
- `docker/ui/tui-capture.sh` — scene 1 runs `measure_band()` after `render_band()`, logs to
  `<evidence>/measure.log`, records `measure=pass|fail` in the manifest, and DELETES the PNG on failure
  (`[ -s "$MEASURE" ]` guards the run, so a missing tool fails loudly instead of skipping silently).
- `docs/index.md` + `docs/index.zh-CN.md` — the capture paragraph now states the rule and names the
  tool: a capture is measured before it ships, and a figure that fails is not committed.

## 4. Gates (observed, with exit codes)

| Gate | Command | Result |
|---|---|---|
| Doc pairs | `bun run verify:docs` | **exit 0** — `pairs=52 failed=0 violations=0 links=473 dead=0 … PASS` |
| Manifest | `bun run verify:manifest` (`= node scripts/verify-plugin-manifest.ts --pack`) | **exit 0** — `VERDICT: PASS`, 1088 packed files, 0 required path absent |
| Pack closure | `node scripts/verify-pack-closure.ts` | **exit 0** — `618 identical, 0 drift, 7 expected-after-pack; 0 absent` |
| Comments | `bun run verify:comments` | **exit 0** — 479 files, `VERDICT: PASS` (the new `.mts` is in the source set) |
| Measurement self-test | `python3 docker/ui/measure-shots.py --self-test` | **exit 0** — 7 arms, 5 red as designed |
| Wrong-band refusal | `measure-shots.py tui … --cols 0:30` on the 109-column tile | **exit 1** — the band does not cover the picture |
| Old tile (before) | `measure-shots.py tui` on `before/tui-team-dag.png` | **exit 1** — 6.0 px corner, 102 missing side pixels |
| Shipped assets | `measure-shots.py web ×2` + `tui` | **exit 0 / 0 / 0** (numbers above) |

**The `expected-after-pack` readings, listed honestly** (the gate prints TEN
`CONTENT-DRIFT-EXPECTED` lines while its summary counts SEVEN; the difference is the gate's own
accounting, not a hidden failure — it prints content-half and completeness-half expected entries under
one label. Split by checking which paths exist in `dist/mpd-package/`):

| Path | Class | Whose writer |
|---|---|---|
| `docs/assets/images/web-team-dag-groups.png` | content: bytes differ, source newer than the stamp | this cell |
| `docs/assets/images/zh-CN/web-team-dag-groups.png` | content | this cell |
| `docs/assets/images/tui-team-dag.png` | content | this cell |
| `docs/index.md` | content | this cell |
| `docs/index.zh-CN.md` | content | this cell |
| `docs/assets/images/tui-team-dag-groups.png` | content | the previous wave (`shots-fix`) |
| `skills/dsh-qa/SKILL.md` | content | another writer in this working tree |
| `skills/dsh-qa/scripts/lib/user-surface-eval.ts` | completeness: ABSENT from the packed tree, excused only by its newer mtime | another writer (not this cell) |
| `skills/dsh-qa/scripts/lib/user-surface-probe.ts` | completeness, same | another writer |
| `skills/dsh-qa/scripts/user-surface-mount.ts` | completeness, same | another writer |

The three completeness entries are a real packaging gap that predates this cell (the packed artifact has
no counterpart for those three declared files); the gate classifies them EXPECTED because their source is
newer than the pack stamp. Re-packing closes them; the re-pack belongs to the captain's release step.

## 5. Bounds / what is not proven

- **The old Web image's exact scroll mechanics are not reconstructible.** What IS measured: the image is
  1034 CSS px wide against a 1234 CSS px graph, and its own pixels put the window ~212 CSS px into the
  drawing (group frame's left border at image x=298 CSS vs content x=510). Why the old run could scroll
  while the same bundle re-measured at 2300 px wide reports `scrollWidth == clientWidth` is not
  explained here; the fix removes the question by making the panel wider than the content at origin.
- **`docs/assets/images/zh-CN/tui-team-dag.png` was NOT re-shot.** It is the same pre-fix render at the
  zh geometry (4320×1520) and `docs/index.zh-CN.md` still cites it. Measured with the same tool on its
  own transcribed grid: `max corner |dx| = 6.0 px, missing side pixels = 102 → FAIL`. It is outside this
  cell's two-image scope; the two remedies are (a) re-shoot it at the zh geometry and window it the same
  way, or (b) withdraw it and cite the shared English-body capture, exactly as the zh groups row already
  does. Recommended: (b), because the scene body is English by design in both locales.
- **The Web figure's text is small at README display width** (2608 px displayed at ~880 px). That is the
  same class of compromise the previous 2068 px tile carried; fitting the graph requires a wider panel,
  and the alternative was cutting cards. Readers zoom.
- **The TUI measurement is a WINDOW test**: it measures the frames the crop contains, and it refuses a
  band narrower than the picture (so the window cannot be quietly shrunk). It still cannot see a card
  whose corners are BOTH outside the image; the 109-column choice is justified by the measured text
  width, not by the tool.
- **The width fraction is calibrated for the 158-column English geometry.** A 218-column 简体中文 run
  would window 150 columns (same ~69%), i.e. wider than the scene's 109 cells of text. No shipped asset
  is produced that way today (the zh TUI tile is not re-shot here); if one ever is, anchor the width on
  the measured text (`widest row + 2`) instead of the fraction.
- **The container state is not the deliverable.** The capture ran against `ui-ui-1`'s profile copy
  (`/data/dsh-web`), whose `mpd-team-core-plugin/dist` + `mpd-bundle-plugin/{dist,client.js}` sha256-match
  this checkout (recorded in `web-capture-en.log`'s predecessor probe). The checkout's `packages/**` was
  never edited.

## 6. Re-run

```bash
# the measurement tool, on its own
python3 docker/ui/measure-shots.py --self-test
python3 docker/ui/measure-shots.py web  --facts evidence/cellwork/shots/2026-10-26T16-25-00Z/shot-facts.json \
  --png docs/assets/images/web-team-dag-groups.png
python3 docker/ui/measure-shots.py tui --pane evidence/cellwork/shots-fix2/<ts>/tui/tui-team-dag.pane.txt \
  --png docs/assets/images/tui-team-dag.png --rows 1:36 --cols 0:109 --scale 2

# the Web capture + gate (needs the UI-VIEW container up and its tokenised URL)
MPD_UI_URL='http://127.0.0.1:3081/?token=…' docker/ui/shoot-team-dag.sh \
  --out evidence/<dir>/web-team-dag-groups.png --facts evidence/<dir>/shot-facts.json --locale en-US

# the TUI capture (inside the container; the entrypoint installs python3+tmux)
docker exec ui-ui-1 bash -lc 'bash /src/docker/ui/tui-capture.sh --lang en --out /data-out/readme --evidence /data/tui-evidence'
```

## 7. Files in this directory

| Path | What |
|---|---|
| `web-team-dag-groups.png` / `.zh-CN.png` | the re-shot assets (byte-identical to the installed files) |
| `shot-facts.json` | the merged facts — the same file installed at `evidence/cellwork/shots/2026-10-26T16-25-00Z/shot-facts.json` |
| `shot-facts.zh-CN.json`, `web-shipped*.measure.json` | the raw zh capture block and the shipped-asset measurements |
| `tui/` | the recaptured tile, the pane text + ANSI, `tui-manifest.json`, `tui/measure.log`, the measurement JSON |
| `before/` | the three replaced assets as committed (`git show HEAD:…`), their measurements, and the transcribed panes |
| `compare-*.png` | before/after stacks (visual aid only — the numbers above are the evidence) |
| `probe-*.{mts,log}` | how the Team panel is reached, the widths probed, and the two false starts (a stale token, a locale-specific session button) |
| `gate-*.log` | the gate outputs quoted in §4 |
| `shipped-measurements.log` | one transcript of the three shipped-asset measurements |
