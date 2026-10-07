# Design freeze — wave `dag-edges-scroll` (both lanes)

Author: **Architect** (read-only seat; no file written by the seat, no git command run). Transcribed to
disk by the captain so the lanes anchor on an ARTEFACT rather than on a mailbox id (T-90).
Input: `evidence/dag/dag-edges-scroll/requirements.md` (clauses C1-C5, W1-W7, T1-T9).

**BOTTOM LINE.** The WEB lane is arithmetic once one decision is frozen: build the curve from the SAME
waypoint list the rect chain is built from, so the flattened polyline provably describes what is
painted — that is the only thing keeping W3 non-vacuous. The TUI lane's hard part is NOT the 5-row box
(mechanical) but the cell-aware slicer plus two axes sharing ONE offset. Two existing invariants break
by construction and must be re-pointed rather than deleted: `team-view.test.ts`'s "no SVG" arm and
`panel.test.ts`'s "box rows ≤ panel width" arm.

---

## (a) WEB LANE — the curve object, `d`, and the marks

### A1. `EdgeCurve`

`interface EdgeCurve { d: string; points: {x,y}[]; tip: {x,y}; radius: number }`, added to `DrawnEdge`
as `curve: EdgeCurve`.

- `points` IS W3's flattened polyline — the SAMPLED curve, not the waypoints. Published from the LAYOUT
  in closed form; never re-derived in the renderer.
- `segments` stays **BYTE-IDENTICAL** — W4 keeps `data-mpd-route` as the routing truth. Do not reshape
  it into the curve.
- `tip` = the arrival point `{x: toX, y: toY}` ALWAYS (`toX` is already the arrival border x for all
  three cases forward/level/back). That makes W5 a pure equality.
- `radius` echoes the declared constant per edge, so W6's control is observable in the LAYOUT output,
  not only in the DOM.

### A2. How `d` is derived — the freeze that matters

**Do NOT derive `d` from the rects.** The rects are lossy in exactly one place: `run`/`runV` use
`width: Math.max(|Δ|, 1)` / `height: Math.max(|Δ|, 1)`, so a degenerate leg becomes a 1×1 stub and its
centreline is unrecoverable. `reach` also adds `+1` to cover the box's border pixel — an end
CONVENTION, not geometry.

Instead: the routing loop ALREADY maintains a pen position (`let x = fromX` / `let y = fromY`, updated
at each leg). Freeze:

- emit a WAYPOINT LIST `[{x: fromX, y: fromY}, …turns…, {x: toX, y: toY}]` inside the same loop (a
  `push` at each pen update plus the initial point);
- build the RECTS from that list, keeping today's `run`/`reach`/`runV` conventions verbatim;
- build `d` from the same list.

One loop, two outputs — they cannot disagree. This is also what keeps the two layout arms that read
`segments` off the LAYOUT green untouched.

### A3. SVG path grammar

New constants beside `MARK_W`/`MARK_H`: `EDGE_RADIUS = 6` (px), `EDGE_SWEEP_MIN = 2`.

- `M x0 y0` — the start, on the blocker's border.
- Every INTERIOR vertex `Pi`: shorten both adjacent legs by `r_i = Math.min(EDGE_RADIUS, legIn/2,
  legOut/2)` and join with a QUADRATIC: `L (Pi.x ∓ r_i·dx) (Pi.y ∓ r_i·dy)` then
  `Q Pi.x Pi.y (Pi.x ± r_i·dx) (Pi.y ± r_i·dy)`.
  WHY `Q` and not `A`: for a right angle the quadratic control point IS the corner, so `Q` is the exact
  circular-arc approximation with none of `A`'s sweep-flag bookkeeping across mixed directions. The
  per-vertex half-leg clamp is what makes a 6px radius SAFE — two lanes in a crowded gutter sit ~3px
  apart (`LANE_STEP = 3`), so an unclamped 6px radius would overshoot. Only `EDGE_RADIUS` is declared;
  the clamp is derived.
- The FINAL APPROACH is the CUBIC (the user's pick): the elbow at the last pre-approach vertex
  `W_{k-1}` is replaced by
  `C (W_{k-1}.x) (W_{k-1}.y + s·r) , (W_{k-1}.x + r) (W_k.y) , W_k.x W_k.y`
  where `s` is the travel sign and `r = min(EDGE_RADIUS, legIn/2, |W_k.x − W_{k-1}.x|/2)`.
  WHY the second control point shares `W_k.y`: the tip tangent stays HORIZONTAL, so the arrowhead points
  into the border instead of arriving at an angle. This is the one place a cubic is genuinely worth it.

### A4. Why `radius = 0` reproduces the straight orthogonal path (W6's control)

The emitted COMMAND is chosen by the shortened length:

- `r_i === 0` → emit `L Pi` (no `Q`);
- final `r === 0` → emit `L W_{k-1} L W_k` (no `C`).

So `radius = 0` yields a `d` that is a pure `M`/`L` orthogonal polyline and `curve.points` EQUALS the
waypoint list exactly — not merely "renders the same". That is a byte-comparable, falsifiable control
rather than a visual claim. With `r > 0` the `points` are the dense flatten of the `Q`/`C` arcs
(step ≤ 1px), so the same containment instrument runs on both.

REQUIRED signature change to make the control reachable:
`layout: (tasks: TeamTask[], radius?: number) => GraphGeometry` (default `EDGE_RADIUS`).

### A5. The marks (W4) — exact serialization

UNCHANGED, verbatim:

- `data-mpd-edge` = `edge.witness` = `child + "<-" + parent` (`docker/ui/capture.mts` counts these).
- `data-mpd-route` = `segments.map(rectText).join(";") + "|" + (pointsLeft ? "L" : "R") + rectText(marker)`,
  `rectText(rect) = left + "," + top + "," + width + "," + height`. Keep as-is.
- `data-mpd-graph` = `"ranks=" + rankCount + " edges=" + edges.length`. `data-mpd-box`,
  `data-mpd-node`, `data-mpd-rank`, `data-mpd-detail`, `data-mpd-head` all keep their names — **NO
  published mark is removed**.
- The edge-layer container div becomes the ONE `<svg data-edges="1" width height viewBox
  style={...CSS.edgeLayer}>`. `data-edges="1"` is preserved.

NEW:

- `data-mpd-curve` — ON THE `<path>`; value = the `d` attribute VERBATIM. Serialization rule (freeze):
  absolute coordinates, numbers rounded to ≤2 decimals, `-0` normalized to `0`, no exponent notation,
  single spaces, commands `M`/`L`/`Q`/`C`. WHY: an arm compares it to `curve.d` by exact string
  equality, so float formatting must not be left to the renderer.
- Structure per W1: the ROUTE is one `<path data-mpd-curve>`; the ARROWHEAD is one
  `<polygon data-mpd-head="1" data-mpd-tip=…>` — a polygon NOT a path, so "one `<path>` per drawn edge"
  stays COUNTABLE (`querySelectorAll("path").length === edges`). Wrap both in
  `<g data-mpd-edge data-mpd-route>`.
- `data-mpd-tip` — ON the head polygon; the SAME `left,top,width,height` grammar, with the TIP as its
  left edge and `width = 0`: `toX + "," + (toY - floor(MARK_H/2)) + ",0," + MARK_H`.
  WHY zero-width: today the tip x is NOT directly readable from any mark — the CSS triangle's apex is
  `marker.left + MARK_W` for `pointsLeft === false` and `marker.left` for `true`, and `MARK_W` is
  published NOWHERE. A zero-width tip rect makes W5 a DOM-only equality with no knowledge of `MARK_W`.
- `edge.marker` and its `headMax` clamp stay as the head's BOUNDING BOX. NOTE: `headMax` never binds
  today because `inset ≤ MAX_INSET = 24 < GEO.column = 168`. Its intent (never open a horizontal
  scrollbar) is now carried by the canvas being exactly `graph.width` wide with SVG's default clipping —
  re-express that intent as W5's arithmetic assertion rather than deleting the guard silently.

---

## (b) `team-view.test.ts` — every affected arm and its replacement

| # | arm | why it breaks | replacement |
|---|---|---|---|
| 1 | "stays a single factory body … no SVG" | `expect(SOURCE).not.toContain("createElement(" + "svg")` is FALSE by construction | DROP that line and the words "no SVG" from the title; REWRITE the comment to the AMENDED text (measurement is what is forbidden). KEEP the four negative assertions; ADD `not.toContain("getComputedStyle")` and `not.toContain("offsetWidth")` so the measurement ban is at least as sharp as before |
| 2 | "and exposes the pure layout" | the signature gains the W6 control parameter | re-point to `"layout: (tasks: TeamTask[], radius?: number) => GraphGeometry"`. Keep the rest verbatim |
| 3 | "draws one absolutely-positioned three-segment edge …" | children are no longer four styled divs; `styleOf(segment,"left"/"top"/"width")` has nothing to read | KEEP the witness-set / `edges=` / node-order half UNCHANGED — that is W4. Replace the geometry half: call `view.layout(TASKS)`, assert `segments.map(s=>s.key)` is still `["out","riser","in","head"]` ON THE LAYOUT, and re-express the RELATION block (`out.left === borders(0).right`, `riser.left` strictly inside the gutter, `into.left + into.width === borders(1).left + 1`) over the layout's `segments[].rect` — identical numbers, new accessor. ADD: `data-mpd-curve` on the rendered `<path>` === `layout().edges[0].curve.d` |
| 4 | "draws a riser that spans the two rows …" | same `styleOf` dependency | same treatment: read `segments[].rect` off the LAYOUT |
| 5 | "a cycle's back-edge keeps a non-negative width instead of drawing NaN" | iterates children reading `styleOf(segment,"width")` | KEEP the witness-set assertion. Replace the loop with: for every `graph.edges[].segments[].rect`, `Number.isFinite(rect.width) && rect.width >= 0`; PLUS a NEW curve guard — every number token in `curve.d` is finite and `curve.d` contains no `NaN`/`undefined` |
| 6 | **"NO drawn run enters any node box …"** | **THE W3 ARM. It parses `data-mpd-route` RECTS and runs `entersInterior`. A curve makes those rects the elbow skeleton, so the arm keeps passing while the curve crosses boxes — a VACUOUS GREEN, exactly the failure W3 names** | see the six-step replacement below |
| 7 | "a rank-skipping edge is routed as a CHAIN of adjacent-rank hops" | reads `segments` off the LAYOUT | DOES NOT BREAK — KEEP UNCHANGED. Optional strengthen: assert that edge's `curve.points` also crosses at `crossing.top` |
| 8 | "every gutter lane gets its OWN column" | reads `segments[].rect.left` off the LAYOUT | DOES NOT BREAK — KEEP UNCHANGED |
| 9 | "every drawn run reaches both of the boxes it names" | `data-mpd-route` keeps its meaning, so it still works, but it now proves the ROUTE not the PAINT | KEEP as-is, and ADD the curve twin: `curve.tip.x` equals the border the marker's `R`/`L` names, and `curve.points[points.length-1]` equals `curve.tip`. Move the `head.height === 8` assertion onto `data-mpd-tip`'s height |
| 10 | "hover tints the transitive chain and dims every other node" | W7 turns the tint from `background` to `stroke` | re-point the read from `styleOf(edge,"background")` to the SVG `stroke`, keeping the both-ends-in-halo rule unchanged. VERIFY THE BODY before editing — flagged as NOT READ by the Architect |
| 11 | all remaining arms | unaffected (geometry, panels, localization, unresolved-reference reader) | no change |

### The W3 replacement, six steps (arm 6 — must not go vacuous)

1. Keep reading BOXES from the DOM (`data-mpd-box`), so the proof is about the RENDERED boxes.
2. Read the SAMPLES from the PURE layout: `view.layout(TASKS).edges[].curve.points`.
3. ADD a BRIDGE assertion: for every drawn edge, the rendered `<path>`'s `data-mpd-curve` === that
   layout edge's `curve.d`. Without it, samples and paint can drift and the proof is about a drawing
   nobody rendered.
4. Replace `entersInterior(rect, box)` with a SEGMENT-vs-box-interior test over consecutive sample
   pairs. A point-only test can thread a 1px line through a box BETWEEN two samples; a segment test is
   exact and needs no sampling-density assumption. Keep the 1-px shrink tolerance and its rationale (a
   curve may ABUT the border it attaches to, never enter the interior).
5. KEEP the existing positive control AND ADD one that fails ONLY in the curve domain.
   **AMENDED 2026-10-06 by the reviewer's measurement (finding 5).** The control this step originally
   named — *"the same route emitted with a deliberately huge radius that bulges a sweep into a
   neighbouring box"* — **CANNOT FIRE**: measured, 0 invasions at radius 6, 20, 60 AND 200, because
   `curveOf`'s per-vertex clamp `min(EDGE_RADIUS, legIn/2, legOut/2)` bounds every fillet by its own
   legs, so a curve produced by that function can never leave its corridor. The containment property is
   therefore **STRUCTURAL, not merely tested** — which is worth knowing and worth saying in the arm's
   comment, because a reader who thinks the arm is a live proof would trust it further than it goes.
   The controls that DO fire, and which replace the impossible one: (a) a THREADING segment whose two
   samples both sit outside the box while the segment between them crosses it — this is what proves the
   segment test is strictly stronger than a point test; (b) an ARC-SAMPLE displacement that moves a
   flattened sample into a box interior — this is what proves the flattener is being measured rather
   than assumed. Both were built and both redden.
6. ASSERT NON-VACUITY explicitly: a sample-count floor, and a non-zero count of edges whose
   `points.length > segments.length + 1`. An instrument that cannot fail is not evidence, and one fed
   nothing is not either.

---

## (c) TUI LANE — natural width, fit-width preservation, the slicer

### C1. The natural-width entry point (T1)

```ts
/** How much room a natural-width layout has VERTICALLY, which is what selects the box form. */
export interface GraphBudget {
  /** The rows the surface can show; omitted = the roomy 5-row box form. */
  rows?: number
}
export function layoutBoxesNatural(tasks: readonly GraphTask[], focus?: string, budget?: GraphBudget): GraphView | undefined
export function layoutGraphNatural(tasks: readonly GraphTask[], focus?: string, budget?: GraphBudget): GraphView
```

- `nodeWidth = clamp(widestLabelCells(tasks) + 2, MIN_NODE_WIDTH, MAX_NODE_WIDTH)` — 2 for the border
  cells. Not a guess: the interior is `nodeWidth − 2` and the box writes `" " + body` through
  `clampCells(…, nodeWidth - 2)`, and `panel-dag.ts`'s gate already uses `nodeWidth - 2 >= label`.
- `width = widestRank * (nodeWidth + NODE_GAP) - NODE_GAP` — the IDENTICAL formula as today, so the
  internal arithmetic is untouched.
- REFUSAL (T9): with a content-derived width the old `nodeWidth < MIN_NODE_WIDTH` cause is unreachable,
  so the ONE remaining refusal is `ranks.length > MAX_BOX_RANKS` → `undefined`. Still "refuses rather
  than squeezing", with a cause that can actually fire.
- NEW REPORTED FACT on `GraphView`: `labelOverflow?: boolean`, true when the `MAX_NODE_WIDTH` cap
  forced an interior narrower than the widest label. The `dag` PANEL reads it to fall back to
  rail/list, preserving its "never truncate" guarantee; the SCENE ignores it and truncates as today.
- The slicer never enters the layout — the layout's own `clampSpans` already clamps to its OWN width.

### C2. What `GraphView.width` means, before and after

- BEFORE: `width ≤ cols` — a hard fit guarantee, pinned by `graph-rank.test.ts` and `dag-fidelity.test.ts`.
- AFTER, on the NATURAL path only: `width` still means "the cells the drawing occupies", but it is
  derived from CONTENT and MAY EXCEED the viewport. The invariant MOVES to
  `cellWidth(slice(row, offset, cols)) === cols` — T3's statement. That is why the slicer must be
  asserted independently.

### C3. Who keeps fit-width — named

The FOUR LEGACY LAYOUT FUNCTIONS keep their exact signatures and semantics, and their direct arms stay
green: `layoutBoxes`, `layoutRail`, `layoutList`, `layoutGraph`.

Callers that DO NOT opt in: `test/graph-rank.test.ts` (the CJK shear arm, the `wide.width ===
narrow.width` arm, the monotonic fit-width sweep), `test/dag-fidelity.test.ts` (the
`widestLine ≤ cols` arm and the CJK fixture — its corner assertions DO break, see (e)),
`test/graph.test.ts` (every direct layout arm). `hitTest` keeps its fit-width, column-agnostic
signature — but its CALLERS must pass a viewport-space column: `hitTest(drawn, localRow + scroll,
localCol + scrollX)`.

WHICH IN-SCENE CALLERS SWITCH — **ALL THREE switch; NONE stays fit-width**:

- `scenes.ts` team scene → `layoutGraphNatural(graphTasks, focus, { rows: measured.window })`, then
  slice every row.
- `subagent-scene.ts` `teamGraphView` — switches. THIS IS THE SHARED ENTRY.
- `panel.ts` merged panel — switches BY VIRTUE of calling `teamGraphView` (no separate edit).
- `panel-dag.ts` `dagPanelLayout` — switches too, because T2 names the `dag` sidebar panel explicitly.
  Its `boxGrid`/`widestLabel`/`MIN_BOX_LABEL_CELLS` gate is REPLACED by `layoutBoxesNatural` + reading
  `labelOverflow`. **DELETE `boxGrid`** — it exists only to PREDICT `layoutBoxes`' internal formula and
  carries a SECOND rank derivation that duplicates `deriveRanks`/`rankPlan`; the natural entry point
  reports the same fact and removes a real drift source. `widestLabel` is replaced by the shared
  `widestLabelCells` from `graph.ts`.

### C4. The cell-aware horizontal slicer (T3)

Two functions, split by dependency direction (no import cycle):

```ts
/** sanitize.ts — cut one row to a COLUMN window, never splitting a wide glyph; exactly `cols` cells. */
export function sliceCells(text: string, offset: number, cols: number): string

/** graph.ts — the same cut, preserving each span's tone. */
export function sliceSpans(spans: readonly GraphSpan[], offset: number, cols: number): GraphSpan[]
```

Frozen semantics (this is where a naive `Array.from(text).slice(offset, offset+cols)` dies):

- Walk characters, accumulating `cellWidth(char)`.
- A character whose cells fall entirely BEFORE `offset` is dropped.
- A WIDE glyph STRADDLING the left edge is NOT half-emitted: emit ONE SPACE in its place, so the window
  keeps its cell count and shows a gap rather than a sheared glyph.
- A WIDE glyph STRADDLING the right edge is DROPPED, and the row is SPACE-PADDED to exactly `cols`.
- POSTCONDITION, asserted: `cellWidth(sliceCells(row, offset, cols)) === cols` for EVERY offset,
  including past the row's end (all-space) and `cols === 0` (empty string).
- `sliceSpans` returns spans summing to exactly `cols`, with trailing padding as its own `blank` span.
- `clampCells` already refuses to split a character but takes a LENGTH from the start — it must NOT be
  reused as the slicer.

### C5. Key binding, and the one place the surfaces legitimately differ

SCENE:

- `↑↓←→` / `hjkl` → FOCUS. `←/→` are NOT handled today, so ADD them: `←`/`h` = `moveFocus(-1)`,
  `→`/`l` = `moveFocus(1)` — the SAME 1-D drawing order `↑/↓` already walks. DECLARED DECISION: a true
  2-D spatial neighbour walk would need a new geometry contract nobody asked for.
- `⇧←→` → NEW `scrollX`; `⇧↑↓` → existing `scroll` (UNCHANGED).
- `PgUp/PgDn` vertical page; `⇧PgUp/PgDn` horizontal page. `Home/End` vertical top/bottom.
- Wheel: `deltaY` vertical (exists; its inline type must widen to include `deltaX`); `deltaX`
  horizontal (NEW).
- CLAMPING: reuse `clampScroll(offset, contentRows, viewportRows)` for the horizontal axis as-is — it is
  axis-agnostic 3-number arithmetic, and reusing it keeps ONE band definition.
  `max = max(0, view.width − graphWidth)`.
- The footer hint becomes `"⇧↑↓/⇧←→ scroll"`.

SIDEBAR `dag` PANEL — THE DELIBERATE DIVERGENCE: `←/→` there are the HOST's panel navigation, and
`dagPanelKeyAction` returns `consumed: false` for them ON PURPOSE. So the panel takes `⇧←→` for
horizontal scroll and MUST NOT consume bare `←/→`; `↑↓/jk` keep moving focus. State it so the reviewer
does not file it as a miss.

T4 — TWO GUTTERS, ONE OFFSET: extend `PanelViewport` with the second axis ON THE SAME HANDLE —
`colOffset`, `colMax`, `colOverflow`, `scrollToCol`, `scrollColBy`, `onWheelX` — driven through the
SAME `commit`/`band` closures, and widen the hook's `read()` to
`{ contentRows, viewportRows, contentCols?, viewportCols? }`. A SECOND `usePanelViewport` for columns is
exactly the "second scroller whose position the page cannot see" T4 forbids. The horizontal rail is the
transposed `gutterCells` arithmetic drawn as ONE row under the window.

---

## (d) The label composer — both surfaces, matching C4 exactly

THE RULE (identical on both sides):

`subject.match(/[\x20-\x7E]+/g) ?? []` → if EMPTY, `"#" + ordinal`; else `runs.join(" ")` with whitespace
collapsed and trimmed. Pure, deterministic, locale-free, no I/O. `\x20-\x7E` excludes every C1-banned
codepoint BY CONSTRUCTION — the composer IS the C1 guarantee, which is why C5's instrument can assert
C1 on the RENDERED drawing. The composed string replaces the SUBJECT SLOT ONLY, which is what makes
`<glyph> <id> <KIND> #<ordinal>` come out right on both surfaces with no layout change.

WEB — `graphLabelOf(subject, ordinal)` inside the factory:

- WRITE SITE (the only one): the node's `key:"subject"` div — `task.subject` →
  `graphLabelOf(node.task.subject, node.ordinal)`.
- EXEMPT by C3, DO NOT CHANGE: the `title` tooltip; the detail section's subject; the member-card
  `current` line (panel chrome, outside the drawing).
- ORDINAL SOURCE (exact): the 1-based index of the task in the `tasks: TeamTask[]` array handed to
  `layout` — the board order the STORE served, NOT the column-major draw order and NOT rank order.
  Implement as a new `ordinal: number` field on `GraphNode`, filled once in `layout`.

TUI — `graph.ts`:

```ts
export function graphLabel(subject: string, ordinal: number): string
function labelOf(task: GraphTask, focus: string | undefined, ordinal: number): string
export function widestLabelCells(tasks: readonly GraphTask[], focus?: string): number
```

- `labelOf` becomes `[marker, id, kind, graphLabel(task.subject, ordinal)].join(" ")`. ALL THREE call
  sites change: the box, the rail, the list — those three are precisely the C2 violation.
- `widestLabelCells` calls the SAME `labelOf`, and `panel-dag.ts`'s `widestLabel` is DELETED. Today that
  function RE-COMPOSES the label by hand — that duplicate is the exact drift C2 forbids.
- ORDINAL SOURCE (exact): the 1-based index in the `tasks` array handed to the LAYOUT function — the
  same board array the scene/panel project from `workflow.tasks`. Each layout builds
  `const ordinalOf = new Map<string, number>()` once. NOTE: the boxes layout REORDERS within a rank by
  barycentre and `rankPlan` buckets — the ordinal must come from the ORIGINAL array, never from the
  drawn order.
- EXEMPT: `panel-dag.ts`'s `pinnedDetailLines` and the scenes' `detail` rows keep the raw subject.

---

## (e) The termaid-parity glyph table (T7)

HOME: `packages/mpd-tui-plugin/src/dag-theme.ts`, a NEW frozen `DAG_CHARS` sibling of `DAG_CHROME`, as
DECLARED DATA. Dependency direction is clean (`dag-theme.ts` imports nothing; `graph.ts` imports only
`sanitize.ts`), so `graph.ts → dag-theme.ts` is a one-way edge with no cycle. `graph.ts`'s private
`JUNCTION` is BUILT FROM `DAG_CHARS`.

| mask | glyph | cells it may occupy |
|---|---|---|
| `DOWN\|RIGHT` | `╭` | node TOP-LEFT corner; any edge turning from a downward run into a rightward run — 1 cell |
| `DOWN\|LEFT` | `╮` | node TOP-RIGHT corner — 1 cell |
| `UP\|RIGHT` | `╰` | node BOTTOM-LEFT corner — 1 cell |
| `UP\|LEFT` | `╯` | node BOTTOM-RIGHT corner — 1 cell |
| `UP\|DOWN` | `│` | vertical run — 1 cell/row, one column |
| `LEFT\|RIGHT` | `─` | horizontal run — 1 cell/column, one row |
| `UP\|DOWN\|RIGHT` | `├` | vertical run branching right — 1 cell |
| `UP\|DOWN\|LEFT` | `┤` | vertical run branching left — 1 cell |
| `UP\|LEFT\|RIGHT` | `┴` | the cell DIRECTLY BELOW a `▼`, on the dependent's top border — 1 cell |
| `DOWN\|LEFT\|RIGHT` | `┬` | a box's bottom border where an edge LEAVES — 1 cell |
| all four | `┼` | a genuine crossing — 1 cell |
| (a LABEL, not a mask) | `▼` | row `childTop − 1`, column = the dependent's CENTRE; written ONCE per child even under fan-in; its 1-cell tip touches the dependent's TOP border row |

Rules that make the table mechanical:

1. ONE TABLE, BOTH KINDS OF CORNER. Replace only the FOUR corner entries of `JUNCTION`. Two-way corners
   in the boxed drawing occur only at node borders today (the bus cells merge into `┬`/`┴` tees), so this
   single change satisfies both of T7's sentences without a second table.
2. PRECEDENCE: `text` beats `JUNCTION[mask]`. A junction cell is never a label cell and vice versa.
3. EVERY GLYPH IS EXACTLY ONE CELL. Assert `[...glyph].length === 1` AND `cellWidth(glyph) === 1`.
4. NO GLYPH IS IN A C1-BANNED RANGE: box drawing U+2500–U+257F and `▼` U+25BC are explicitly allowed.
5. DE-DUPLICATE `graph.ts`'s private tables: its `GLYPH` and `KIND_ABBREV` are BYTE-IDENTICAL to
   `DAG_TONE_GLYPH` and `DAG_KIND_ABBREV`. Replace them with imports: zero behaviour change, and it
   removes exactly the "scattered literals" the requirements name. ONE arm breaks: `dag-fidelity.test.ts`
   regex-matches `const ARROW_DOWN = "([^"]+)"` in `graph.ts`'s SOURCE — re-point it to read
   `DAG_CHARS.arrowDown` (or keep a `const ARROW_DOWN = DAG_CHARS.arrowDown` line so the source anchor
   survives).

THE COMPRESSED 3-ROW FALLBACK RULE — frozen:

- The box form is chosen ONCE per layout call from `.rows`:
  — ROOMY when `rows ≥ ranks * 8 + 2`: FIVE box rows (`╭─…─╮` / `│`+padding / `│`+label / `│`+padding /
  `╰─…─╯`) and `RANK_STRIDE = 8` (replacing today's 6);
  — otherwise COMPRESSED: today's THREE box rows and `RANK_STRIDE = 6`, unchanged.
- The CORNERS are `╭╮╰╯` in BOTH forms — the vertical budget buys the PADDING ROWS only.
- `▼` sits at `childTop − 1` in BOTH forms, so T7's "tip touches the dependent's TOP border" is
  form-independent.
- The layout REPORTS which form it drew: add `boxRows: 3 | 5` to `GraphView`. Without it the 5-row claim
  is unfalsifiable from outside the module.
- THE RAIL/LIST KEEP THEIR SHARP `├─`/`└─` ELBOWS. DECLARED NON-CHANGE: T7's rounded-corner sentence is
  about the BOXED drawing, and the rail/list are T9's narrow fallbacks. Rounding them is an OPTIONAL
  amendment, not the default.

TUI ARMS THAT BREAK ON (e) — named:

- `dag-fidelity.test.ts` — the `startsWith("┌")` / `endsWith("┐")` corner arms → read
  `DAG_CHARS.cornerDownRight`/`cornerDownLeft` instead of literals.
- `team-surface.test.ts` — `startsWith("┌")`, `toContain("┌")` → the rounded corner; the
  `not.toContain("┌")` and `startsWith("│")` arms stay valid.
- `panel.test.ts` — the row filters `/^[┌│└]/` must gain `╭`/`╰`.
- `scene-visuals.test.ts` — `/^[┌└│]/` and `["┐","┘"]` must gain the rounded set.
- `graph.test.ts` — the connector-tone regex `/^[│─┌┐└┘├┤┬┴┼ ]+$/` must gain `╭╮╰╯`.
- **`panel.test.ts`** — `expect(row.length).toBeLessThanOrEqual(34)`, the "narrow panel draws a narrower
  box" arm and `toBeLessThanOrEqual(20)`. THIS IS THE T1/T2 ARM: under natural width the drawing is NO
  LONGER bounded by the panel, so the assertion must move from the LAYOUT's width to the SLICED
  window's width (`=== the panel's measured width`), and "narrow panel draws a narrower box" becomes "a
  narrow panel draws the SAME box, windowed". Second-most consequential re-point after W3.
- `graph-rank.test.ts` and `dag-fidelity.test.ts` hard-code the 3-row box body (`+1`) → read the body
  row through `hit.row` + `boxRows` instead of a literal.

---

## (f) Top 5 risks + the hardest thing per lane

1. **THE CONTAINMENT PROOF GOES VACUOUS (WEB).** MITIGATION: (b)'s six-step replacement — samples from
   the layout, a DOM↔layout `data-mpd-curve` bridge, segment-vs-interior testing, a curve-domain
   positive control, and an explicit non-vacuity floor.
2. **THE PANEL'S "NEVER TRUNCATE" GUARANTEE DIES SILENTLY (TUI).** MITIGATION: `GraphView.labelOverflow`
   is REPORTED by the layout and the panel falls back to rail/list on it; an arm asserts a board whose
   widest label exceeds `MAX_NODE_WIDTH − 2 = 32` still renders a rail in the sidebar.
3. **C1 IS ASSERTED OVER THE WRONG SCOPE (BOTH).** The drawing must be CJK-free, but the roster line,
   the detail rows and the pinned facts legitimately draw raw subjects. MITIGATION: freeze the C1
   boundary by LIST — node box text, rail/list node text, edge glyphs, legend lines — and have the
   instrument assert over EXACTLY `view.lines` (TUI) / the node+edge+legend subtree (WEB), never the
   whole panel.
4. **TWO AXES, ONE OFFSET, HALF-DONE (TUI).** MITIGATION: one handle, one `commit` path, `read()`
   widened to both axes, plus an arm that drives the horizontal axis and asserts the drawn horizontal
   rail's thumb equals the page's `colOffset`.
5. **THE 5-ROW FORM RIPPLES THROUGH EVERY LITERAL ROW INDEX (TUI).** MITIGATION: the layout REPORTS
   `boxRows`; every affected arm reads rows through `hit.row`/`boxRows` and corners through `DAG_CHARS`,
   never a literal `+1` or a literal `┌`.

**HARDEST THING, WEB:** keeping W3 non-vacuous — deriving the flattened polyline from the SAME waypoint
list that produces the rects, then proving the check can FAIL in the curve domain.

**HARDEST THING, TUI:** the cell-aware slicer and the two-axis viewport AGREEING ON ONE OFFSET. Both
failure modes are invisible to a naive unit test.

**BONUS, W4 COMPATIBILITY:** `docker/ui/capture.mts` reads ONLY `data-mpd-edge` and `data-mpd-graph`'s
`edges=` count, both preserved verbatim, so the Docker lane's assertions do not move.

---

## Honest bounds of this note

NOT READ by the Architect, therefore to be verified by the lane before editing: the bodies of
`team-view.test.ts` arms at :665 (drawn riser), :715 (hover tint) and :345-:583 (geometry/panel arms);
the rest of `docker/ui/capture.mts` beyond :228/:471; `panel-dag.ts` between :505 and :871;
`graph.ts` between :740 and :910; `scenes.ts` beyond :800.
