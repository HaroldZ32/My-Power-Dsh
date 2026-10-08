# Writer's report — the DAG legend's tautology, and the animation that drags the frame

**Lane:** `packages/mpd-tui-plugin` only. **Contract:** `.mpd/plans/tui-legend-and-animation-fix.md` (frozen).
**Revision measured:** `panel-core.ts` sha256 `cc8bef85a881…`, `dag-theme.ts` `eee4848cc0b0…`,
`subagent-scene.ts` `5350459d3477…` — re-read 2026-10-08T12:08:07Z UTC, unchanged from the first read at
12:06:12Z. Full list: `settled-hashes.txt`. Dist: `45f00df2cefe…`, rebuilt with the PINNED toolchain.

---

## 1. What changed (four files, minimal diffs)

| File | Change |
|---|---|
| `src/dag-theme.ts` | `DAG_ANIM` gains `runningFrames` — the one-cell table every running animation reads; `frames` becomes `RUNNING_FRAMES.length` so the count and the orbit are ONE fact |
| `src/panel-core.ts` | `runningGlyph` reads that table instead of building an orbit by appending dots; `legendLinesFor` groups the states BY MARK instead of printing a `=twin` per state |
| `src/subagent-scene.ts` | `RUNNING_FRAMES` is now the contract's table rather than a second copy of it |
| three test files | the asserting arms re-pointed at the PROPERTY, plus one new width-measurement arm |

### A — the legend: `=twin` → one entry per mark

`legendLinesFor` built one entry per STATE and appended the first other state sharing its glyph after `=`.
The lookup ran independently per state, so both directions fired and the key printed one fact twice with a
false equivalence. It now groups `DAG_STATE_TONES` by the mark `DAG_TONE_GLYPH` gives them:

**drawn verbatim (`01-legend-and-frames-reading.txt`):**

```
"✓ completed · ◐ running · ○ open/blocked · ✗ failed · ⊘ cancelled"   cells=65
```

Satisfies the contract's six conditions: one `○` entry naming both (`open/blocked`); no `=`; the shared
`○` glyph unchanged (`DAG_TONE_GLYPH` untouched); the four distinct states one entry each; wrap-not-shrink
untouched (the same join/`push` path); every mark interpolated from the contract.

### B — the animation: 1/2/1/3 cells → exactly one cell, still breathing

The old orbit was `[base, base·, base, base··]`. The node label EMBEDS the frame and the page
substitutes it AFTER layout, so a wider frame spilled past the laid-out label. The orbit is now the
contract's table:

```
DAG_ANIM.runningFrames = ["◐","◓","◑","◒"]   (DAG_ANIM.frames = 4, derived)
phase 0 "◐" cells=1 · phase 1 "◓" cells=1 · phase 2 "◑" cells=1 · phase 3 "◒" cells=1
```

Four DISTINCT one-cell frames (the ruling keeps the animation; a static frame was rejected), none of them
a mark another state owns (`✓ ✗ ○ ⊘`), none a bare space or dot. The phase stays externally driven
(`useRunningPhase` untouched), and a timer-less host still lands on `staticPhase` = frame 0 = the
contract's own `running` glyph.

**Why the table moved into the contract rather than being written twice:** `subagent-scene.ts` already
breathed through `["◐","◓","◑","◒"]` and `scene-visuals.test.ts:732-734` already pins every frame of
that marker to one cell. Writing the same four glyphs a second time in `panel-core.ts` would have been
two animations of one state that drift on the first edit. One table, two readers.

---

## 2. The measurement (not an assertion)

`02-drawn-width-per-frame.txt` — the page rendered once per frame with a pinned host clock, reading the
DRAWN row that carries the running task:

```
frame 0 glyph ◐ cells 6 row "│ ◐ T2"
frame 1 glyph ◓ cells 6 row "│ ◓ T2"
frame 2 glyph ◑ cells 6 row "│ ◑ T2"
frame 3 glyph ◒ cells 6 row "│ ◒ T2"
frames 0 and 1: 1 of 145 drawn rows differ, all label rows, none by a cell
```

Two readings worth separating:

- The label row is **6 cells at every frame**, against the pre-fix mechanism which measured **6, 7, 6, 8**
  (the arm asserts that counterfactual from the same row, so a constant reading cannot be a blind
  instrument).
- **1 of 145 drawn rows differs** between the head frame and the next frame, and that row is the running
  node's label row at the same cell count. The other 144 rows — every border, corner, pad and
  box-drawing character of the whole page — are byte-identical between the two frames.

## 3. The two render surfaces (the reconnaissance's note, checked)

Recon named "two surfaces that write the same legend text". Measured: there is **one writer**
(`panel-core.ts` `legendLinesFor`) and **two render sites that call it** — `panel-dag.ts:1117` (the
sidebar DAG page) and `scenes.ts:976` (the full-screen merged scene) — so they cannot disagree. Treating
them as two writers would have meant editing two places; the actual defect was that either surface could
have printed the pair twice, which is now impossible from the composer. Each surface is proved from its
own DRAWN frame in `04-two-render-surfaces.txt` (mounted page frame at 156 columns; the merged scene's
own `state-key-*` rows).

## 4. Gates (all green on the settled revision — `03-gates.txt`)

| Gate | Observed |
|---|---|
| `bun test` (package) | **448 pass, 0 fail**, 12707 expect() calls, 20 files |
| `bun run typecheck` | `tsgo --noEmit`, exit 0 |
| `bun run verify:comments` | **PASS** — 367/367 files, 32439 declarations |
| `node scripts/verify-dist-fresh.ts` | **ok: 30/30 targets fresh** (each rebuilt twice, byte-identical) |

Test re-points (each pins a PROPERTY, none echoes the implementation):
`panel-dag.test.ts` — a state is named EXACTLY ONCE at seven widths; every frame one cell / frames differ /
no foreign mark; the new drawn-width measurement. `panel-legend-mount.test.ts` — the mounted key row
carries ONE shared-mark entry naming both. `scene-visuals.test.ts` — same property on the scene's key.
One neighbouring arm was repaired rather than left passing vacuously: the "host WITH the timer draws the
breathed glyph" control asserted the head glyph, which the legend prints, so it would have gone green on
the legend alone once the frames rotate; it now asserts a frame the legend never prints.

## 5. Honest bounds

- The width reading proves the **label row** and (by the full-frame comparison) every other drawn row of
  this page are unchanged in width across frames. It is a measurement of **this page's frame rows**, not
  a terminal capture: nothing here observes the real terminal cell grid.
- The legend names the `running` mark as the contract's head (`◐`); three of the four frames draw the
  rotating family (`◓ ◑ ◒`). That is deliberate and required — contract §2 acceptance 4 fixes the entry
  at `◐ running`, and the same precedent already holds in the subagent panel. A reader mapping every
  frame back to the legend gets the family's head, not each frame.
- `dist/index.js` was rebuilt by me with the pinned toolchain from the repo root (the write was
  permitted); the captain's integration step still owns the artifact.
- Not verified by me: the real-terminal rendering, and anything outside `packages/mpd-tui-plugin`.
