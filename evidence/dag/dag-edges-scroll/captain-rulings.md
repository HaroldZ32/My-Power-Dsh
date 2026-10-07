# Captain's rulings — wave `dag-edges-scroll`

Issued 2026-10-06, after the Planner's plan (`.mpd/plans/dag-edges-scroll.md`) and the Architect's design
freeze (`evidence/dag/dag-edges-scroll/design-freeze.md`) landed INDEPENDENTLY and disagreed on names.
Both are good work; the disagreement is the normal cost of running two read-only seats in parallel, and
resolving it is the captain's job so neither lane has to guess.

**THE ORDER OF AUTHORITY, stated once so no lane has to re-derive it:**

1. `evidence/dag/dag-edges-scroll/requirements.md` — the FROZEN contract (clauses C1-C5, W1-W7, T1-T9).
2. `evidence/dag/dag-edges-scroll/design-freeze.md` — **AUTHORITATIVE for interface names and shapes.**
3. `.mpd/plans/dag-edges-scroll.md` — the owner of SEQUENCING, file-ownership and proving commands.
4. Anything a lane invents on the spot, which must be reported.

Where 2 and 3 disagree about a NAME, 2 wins. Where they disagree about ORDER or OWNERSHIP, 3 wins.
A lane that believes the ruling below is wrong must say so with evidence rather than deviate silently.

---

## R1 · WEB lane interfaces (the freeze's names win)

`DrawnEdge` gains exactly ONE new field:

```ts
curve: { d: string; points: Array<{ x: number; y: number }>; tip: { x: number; y: number }; radius: number }
```

- There is NO separate `polyline` field. **`points` IS the flattened polyline** — the sampled curve,
  published from the pure layout. A second field for the same data is the drift the requirements forbid.
- `radius` is echoed per edge so W6's control is observable in the LAYOUT output, not only in the DOM.
- The layout signature gains the control parameter:
  `layout: (tasks: TeamTask[], radius?: number) => GraphGeometry`.
- Declared constants: **`EDGE_RADIUS = 6`** and **`EDGE_SWEEP_MIN = 2`**. The `EDGE_SWEEP = 6`,
  `SAMPLE_STEP = 2` and `SAMPLES_PER_CURVE = 16` in the plan's F2 are SUPERSEDED: the freeze's
  flattening rule is "step ≤ 1px, closed form", and a fixed sample COUNT cannot make that guarantee on
  a route whose legs vary in length.
- Path grammar, marks and serialization: exactly as `design-freeze.md` (a) A3/A5. In particular
  `data-mpd-tip` is a **zero-width** rect on a `<polygon>`, `data-mpd-route` stays byte-identical, and
  `data-edges="1"` moves onto the one `<svg>`.

## R2 · TUI lane interfaces (the freeze's names win)

- `layoutBoxesNatural(tasks, focus?, budget?: GraphBudget)` and
  `layoutGraphNatural(tasks, focus?, budget?: GraphBudget)`, beside the four legacy layouts, which keep
  their signatures and semantics.
- `GraphBudget { rows?: number }`; `GraphView` gains `labelOverflow?: boolean` and `boxRows: 3 | 5`.
- The slicer is TWO functions, split by dependency direction: **`sliceCells(text, offset, cols)`** in
  `sanitize.ts` and **`sliceSpans(spans, offset, cols)`** in `graph.ts`. The plan's `sliceRow` (and its
  `clampColumn`) is SUPERSEDED — one name, and the cell rule lives in the module that already owns
  `cellWidth`.
- The second axis lives ON THE SAME `PanelViewport` handle (`colOffset`, `colMax`, `colOverflow`,
  `scrollToCol`, `scrollColBy`, `onWheelX`), with the hook's `read()` widened to
  `{ contentRows, viewportRows, contentCols?, viewportCols? }`. The plan's separate `PanelSizes` /
  `panelColumnGutter` / `clampColumn` naming is SUPERSEDED; reusing `clampScroll` for the horizontal
  band is REQUIRED (it is axis-agnostic three-number arithmetic, and a second band definition is a
  second source of truth).
- `panelScrollKey` and `panelViewportBody` stay backwards-compatible, as the plan requires.
- The termaid glyphs are DECLARED DATA: **`DAG_CHARS` in `dag-theme.ts`**, with `graph.ts`'s `JUNCTION`
  BUILT FROM IT, and `graph.ts`'s private `GLYPH`/`KIND_ABBREV` replaced by imports of
  `DAG_TONE_GLYPH`/`DAG_KIND_ABBREV`. Keep a `const ARROW_DOWN = DAG_CHARS.arrowDown` line so the
  source anchor the fidelity instrument reads survives.

## R3 · The label composer is named `graphSafeLabel(subject, ordinal)` on BOTH surfaces

One concept, one name. On the TUI it is an exported function in `graph.ts`; on the WEB it is a
factory-scoped function in `team-view.ts`. The composer in the plan's F1 has the same five steps as
clause C4 and the freeze's (d) — the NAME is all this ruling settles.

## R4 · NO new file under `skills/**` — the vendor coupling is AVOIDED, not paid

The plan's TODO 8 puts a new QA case at `skills/dsh-qa/scripts/tui-dag-pan.ts`. That single addition
makes the TUI lane the wave's ONLY `skills/**` writer and drags in `VENDOR_LOCK.json`'s whole-corpus
`treeSha` re-pin (§9's single-skills-writer rule), plus a `SKILL.md` case-table row. That cost buys
nothing here.

**RULING: the PTY driver lives at `evidence/dag/dag-edges-scroll/tui/<timestamp>/pan-driver.ts`**, with
any helper it needs beside it in the same directory. Precedent: the previous wave's driver is at
`evidence/tui/dag-port/verification/pty/width-panel-capture.ts`. Consequences: no `skills/**` change, no
`SKILL.md` row, **no `repin-vendor.ts` run is owed by this wave**, and the plan's TODO 11 / F8 vendor
clause is VOID. Confirm the void by running `bun run verify:vendor` green at the end.

## R5 · The shared pure-Chinese fixture board belongs to the WEB lane

`docker/ui/team-fixture-records.mts`, `docker/ui/team-fixture.mts`, `docker/ui/seed-team-fixture.sh` and
`docker/ui/capture.mts` are ALL in the WEB lane's write scope. The planned P1 "third disjoint writer" is
collapsed into it — one writer, no coordination hop. The TUI lane and the verifier CONSUME the fixture
read-only; a lane that needs a variant asks the captain rather than editing it.

## R6 · T7 wins over the plan's "`dag-theme.ts` is deliberately not edited"

The plan text says `dag-fidelity.test.ts` must stay green UNCHANGED and `dag-theme.ts` is not edited.
That was written before the freeze and is STALE: clause T7 requires rounded-corner node boxes and
rounded edge turns, which is a `dag-theme.ts` + `graph.ts` change, and the arms that read corner
LITERALS (`┌ ┐ └ ┘`) will break.

**RULING: T7 is implemented.** The affected arms are RE-POINTED to read `DAG_CHARS` rather than the
literals — never disabled, never deleted. Ownership of those arms:

- `packages/mpd-tui-plugin/test/dag-fidelity.test.ts` — the REVIEWER's file; the reviewer re-points its
  corner arms and its `ARROW_DOWN` source regex.
- `graph.test.ts`, `graph-rank.test.ts`, `panel-dag.test.ts`, `panel.test.ts`, `scene-visuals.test.ts`,
  `subagent-scene.test.ts`, `team-surface.test.ts` — the TUI LANE's files.

The break list is enumerated in `design-freeze.md` (e), including the second-most consequential
re-point of the wave: `panel.test.ts`'s "box rows ≤ panel width" arms must move from the LAYOUT's width
to the SLICED window's width, because under natural width the panel no longer bounds the drawing.

## R8 · The horizontal window is scoped to the DAG DRAWING and nothing else (user's own clarification)

The user's words: 「刚刚说的滚轴，**只应用于DAG图**，剩下的地方、描述性文字，不要跟着滚，目的只是为了显示全DAG图」.

This NARROWS R2. The horizontal axis is NOT a property of the page body:

- The horizontal offset applies to the DAG DRAWING only. Only the DAG's own rows are cut by
  `sliceSpans(row, colOffset, cols)`.
- Everything else the surface draws — the panel header, the legend lines, the task-detail/pinned body,
  the member rows, the progress rows, the footer key hints, the scene's other sections — is rendered at
  the FULL surface width, with NO horizontal offset and NO horizontal clipping. It must neither move
  sideways with the DAG nor be truncated because the DAG is wider than the viewport.
- The horizontal gutter/rail is therefore drawn directly BENEATH the DAG drawing, not beneath the page.
- The DAG's own rows are the ONLY rows whose width may exceed the panel.
- VERTICAL scrolling keeps today's shape: the page may still window its whole body vertically
  (header pinned, footer pinned), because that is not what the user asked to change.

Consequences to honour literally:

- The TUI's `sizes`/viewport bookkeeping gains a THIRD number — the DAG block's own column count — and
  `contentCols`/`viewportCols` describe the DAG, never the body. A page that reserves the horizontal
  gutter across every row would be the defect this ruling exists to prevent.
- The freeze's T4 sentence ("a horizontal gutter is drawn wherever a vertical one is") is AMENDED by
  this ruling: the horizontal gutter belongs to the DAG block, and the vertical one to the page body.
- The WEB side already behaves this way (the DAG lives in its own `overflow:auto` container while the
  panel's text does not scroll with it) — that property is now BINDING and a change that drags the
  panel's text sideways with the graph is a defect.
- The purpose is stated once and is worth repeating in the code comments: the pan exists so the WHOLE
  DAG can be seen, not as a general page-level scrolling mode.

## R7 · Board transitions are the CAPTAIN's

Members were spawned through the MPD team executor and hold only the staging-plane tools: measured,
`agent_teams_task {action:"claim"}` answers `no team record in this workspace — approve a plan first`
from every member seat while the same call succeeds from the captain's. **A member therefore MUST NOT
try to write the board, and MUST NOT hand-edit `.mpd/team/teams/<id>.json`** — the record carries a
per-task `revision` (the compare-and-set counter) and is owned by `mpd-team-core-plugin`. Report
completion to the captain by message; the captain flips the status through the plugin's own store API.
