// THE DEPENDENCY GRAPH: the drawing behind the team scene (W3 of the team-plane split).
//
// WHAT THIS IS. `team-state.ts` answers WHAT the team is (a `TeamWorkflow`, read from the mpd-owned
// record); this module answers HOW to draw it in a terminal. The two are deliberately separate so
// the drawing is testable without a terminal, a React reconciler or a team — every function here is
// pure, takes its width as an argument, and returns text and tones.
//
// THREE VIEWS, ONE PREFERENCE:
//   `boxes` — a layered DAG, one box per task, edges drawn with box-drawing junctions. Rank (the
//             longest dependency path) is the vertical axis, so a chain reads top to bottom. This
//             is the view a wide terminal gets, and it is the reason the module exists: a flat list
//             with indentation cannot show a task with TWO blockers, which is the common shape.
//   `rail`  — an indented forest, one line per task, for a terminal too narrow for boxes. A task
//             with several blockers names the extra ones inline (`⇠ T4+T6`) rather than losing them.
//   `list`  — a rank-grouped table with progress bars, for a DAG too dense to lay out as boxes.
//
// CORRECTNESS COMES FROM A DIRECTION MASK, not from per-edge corner glyphs: every cell accumulates
// which of up/down/left/right the drawing enters it from, and the glyph is chosen once at the end.
// That is what makes a horizontal bus running under another column render `┼` instead of being
// overwritten by whichever edge was painted last.
//
// EDGES ARE ARROWED, NEVER MERELY JOINED. A junction can say a cell is connected but never WHICH WAY
// the dependency runs, so every drawn edge ENDS in a `▼` on the dependent's entry cell — the row
// directly above the child's top border, at the child's centre column. It is written as TEXT rather
// than as a mask direction because no direction bit can say "and this one points INTO the box"; and
// because every converging parent writes that ONE cell, a fan-in still shows exactly one arrowhead.
// The rail carries the same reading in its own geometry, as a `▸` on a non-root row's connector.
//
// OPT-1 (user decision, 2026-09-13) — DO NOT "FIX" THE BLOCKED RULE. A FAILED dependency does NOT
// block its dependents: they stay `open` and dispatchable, and the failure is reported beside the
// state (`failedDependencies`) rather than folded into it. `team-store.ts` and `team-state.ts` carry
// the same rule; this module only DRAWS the `visual` it is handed and never re-derives it, which is
// how the three stay in agreement.
//
// RANK IS DERIVED FROM THE GRAPH, NOT TRUSTED FROM `depth` (R17, user-reported defect). The served
// `depth` was MEASURED lying on our own live board: `.mpd/team/teams/team-20261006135108.json` holds
// task ids `T1..T10` while its `blockedBy` values are plan ordinals (`["2"]`, `["2","3","4","6"]`, …),
// `team-store.ts` resolves a blocker by exact task id or exact subject and otherwise returns the
// reference UNCHANGED, and its `taskDepths` then filters the unresolvable ones out — so every task
// became a root, every depth became 0, and the drawing collapsed to ONE rank with NO edges. That is
// the exact lie the user reported against the WEB view, and the TUI must not repeat it: `rankPlan`
// recomputes the longest blocker path over the blockers that RESOLVE, and uses the served `depth`
// only for a board whose graph says nothing at all. `ranksDerived` reports which source won.
//
// A BLOCKER REFERENCE THAT RESOLVES TO NOTHING IS REPORTED, NEVER DROPPED (R18). The silent filter in
// the store is what produced that bug, and a second silent filter one layer down would reproduce it,
// so the references no task on the board carries travel out of the layout in `unresolved` and can be
// counted, named and shown by the page.
//
// EVERY NODE READS `<marker> <id>` AND NOTHING ELSE (frozen clause AC1, this wave). The drawing used to
// append a three-letter kind and the graph-safe subject, which is what the user read as garbled output
// once a Chinese subject had been squeezed through `graphSafeLabel` — and which made one box wider than
// the 40-cell sidebar its rank lives in. The subject and the description are NOT lost: they are verbatim
// in the pinned detail body (clause C3), which is text rather than a drawing. `graphSafeLabel` stays
// exported and byte-identical for the WEB parity arm; this module simply stops calling it.
//
// THE BOX IS THE COMPACT THREE-ROW FORM IN EVERY DRAWING (frozen clause AC2): top border, content,
// bottom border, no padding rows, so a rank's stride is six rows (three box rows plus the three
// connector rows that carry its edges down). One form per drawing, because two boxes of different
// heights in one column would leave every edge between them pointing at rows nobody recomputed.
//
// A WIDE GLYPH OWNS THE CELL AFTER IT. `cellWidth` — never a character count — says how many cells a
// glyph takes, and the cell a wide glyph covers must render as NOTHING rather than as the background
// space it would otherwise fall back to. Writing one array slot per character while advancing two
// cells left that slot blank, which made a row of CJK text one cell WIDER than its grid and pushed a
// box's closing `│` off the edge — measured: `cjk-1 codepoints=33 cellWidth=34 endsWith│=false`
// against `ascii codepoints=34 cellWidth=34 endsWith│=true`. The `wide` array below is that fix, and
// it is why a CJK subject can no longer shear the drawing.
import { cellWidth, clampCells, sliceCells, stripControl } from "./sanitize.js"
import { DAG_CHARS, DAG_GHOST_MARKER, DAG_GROUP_CHARS, DAG_TONE_GLYPH } from "./dag-theme.js"
// THE GROUP TREE (wave `cellwork`, contract D3): the nested layout's geometry, kept in its own module so
// it can be measured and asserted WITHOUT a canvas. This file only paints what that module returns.
import {
  GROUP_BAND_ROWS,
  GROUP_BORDER,
  GROUP_COLUMN_GAP,
  buildFrameTree,
  drawnColumns,
  frameEdges,
  measureFrame,
  rankFrame,
  type ChildSize,
  type FrameChild,
  type FrameEdges,
  type FrameId,
  type FrameNode,
  type FrameRanks,
  type FrameSize,
  type GroupedGroup,
} from "./dag-groups.js"
// THE SHARED PLAN→GRAPH CORE (wave `living-graph`): the ONE rank derivation both planes use. The
// private copy that used to live here — `deriveRanks`, `servedRank`, `ID_ORDER`, `bucketRanks`,
// `rankPlan` and their `RankPlan` type — is DELETED, so a fix now reaches the web plane too. What is
// left is ONE call with an extra argument: when the host hands the layout a served rank map the core
// uses it AS-IS (`derived: false`); when it does not, the core derives exactly as this module did.
// `cycleIds` is re-exported because this module's public API already published it and
// `test/graph.test.ts` imports it from here; the FUNCTION is still the core's, never a copy.
import { cycleIds, rankPlan } from "../../mpd-graph-core/src/rank.ts"
import type { RankPlan } from "../../mpd-graph-core/src/types.ts"
export { cycleIds }

/** One task as the graph needs it; a structural subset of `TeamTaskRow` so a fixture is cheap. */
export interface GraphTask {
  /** The task id the drawing labels and the caller focuses by. */
  id: string
  /** The task title, truncated to whatever the geometry allows. */
  subject: string
  /** `requirement` | `work` | `review` | `repair` | `integration`, abbreviated for the label. */
  kind?: string
  /** The RENDERED state `team-state.ts` computed: completed|running|failed|blocked|open|cancelled. */
  visual: string
  /** Owner display name, absent when nobody holds it. */
  assignee?: string
  /** Ids this task is blocked by, in board order. */
  dependencies: readonly string[]
  /** Longest dependency path (0 = a root); the boxes view's RANK. */
  depth: number
  /** Attempt counter, when the record carries one. */
  attempt?: number
  /**
   * The INNERMOST group frame this task draws inside, absent for a task of the root frame.
   *
   * The group id, never the group's record: a drawing needs to know WHICH box holds a task, and the
   * boxes themselves arrive once in {@link layoutBoxesNatural}'s `groups` argument.
   */
  group?: string
}

/**
 * One GROUP FRAME's rectangle, in the drawing's own coordinates, so a pointer can resolve to a box.
 *
 * A group's box is not a task and cannot be a {@link GraphHit}: the page that pins a group would have
 * to invent a task id for it, and a group is a PLACE rather than a row of the board. The two arrays
 * therefore stay separate, and {@link hitTestGroup} answers for the frames.
 */
export interface GraphGroupHit {
  /** The group id the frame draws. */
  groupId: string
  /** The frame's title, drawn on its top border. */
  label: string
  /** Nesting depth: `1` for a box inside the root frame. */
  depth: number
  /** The frame's first row, relative to the graph's own top. */
  row: number
  /** The frame's last row, inclusive. */
  rowEnd: number
  /** The frame's first column, relative to the graph's own left. */
  col: number
  /** The frame's last column, inclusive. */
  colEnd: number
}

/**
 * What a span of a row MEANS, not what colour it is.
 *
 * The mapping to a theme key lives in {@link GRAPH_THEME} so the drawing never hard-codes a colour:
 * a theme change is one table, and a test can assert the semantics.
 */
export type GraphTone =
  | "completed" | "running" | "failed" | "blocked" | "cancelled" | "open"
  | "focus" | "dim" | "edge" | "chain" | "blank"

/** One rendered span: text plus the tone it is drawn in. */
export interface GraphSpan {
  /** The characters, already clamped to the viewport. */
  text: string
  /** What the characters mean. */
  tone: GraphTone
}

/** A task's box or row, in the view's own coordinates, so a pointer can be resolved to a task. */
export interface GraphHit {
  /** The task this rectangle belongs to. */
  taskId: string
  /** The first row of the rectangle, relative to the graph's own top. */
  row: number
  /** The last row of the rectangle, inclusive. */
  rowEnd: number
  /** The first column, relative to the graph's own left. */
  col: number
  /** The last column, inclusive. */
  colEnd: number
}

/** One rendered graph: the lines to draw, the hit rectangles, and what the layout decided. */
export interface GraphView {
  /** The rows, top to bottom; each row is a list of same-tone spans. */
  lines: GraphSpan[][]
  /** The rectangles a pointer can land in. */
  hits: GraphHit[]
  /** The width the drawing occupies, in cells. */
  width: number
  /** Which layout was drawn, and therefore why it looks the way it does. */
  mode: "boxes" | "rail" | "list"
  /** The task ids taking part in a dependency cycle, which the drawing reports rather than hides. */
  cycles: string[]
  /** The task the drawing lit; absent when nothing is focused. */
  focus?: string
  /** The tasks lit beside the focus: its transitive DEPENDENCIES. */
  chain: string[]
  /**
   * Where the ranks came from: `true` when they were DERIVED from the dependency graph, `false` when
   * the graph resolved no blocker at all and the served `depth` was the only signal left.
   *
   * Reported rather than implicit because the served `depth` has been measured lying (see the header),
   * so a reader of a flat-looking drawing needs to know which of the two sources drew it.
   */
  ranksDerived: boolean
  /**
   * Blocker references no task on this board carries, sorted and de-duplicated.
   *
   * NOT decorative: the served records really do carry them (the live board's `blockedBy` holds plan
   * ordinals while its ids are `T1..T10`) and the store silently filters them out, so a page can only
   * stop the data loss from being invisible if the layout hands the list on.
   */
  unresolved: readonly string[]
  /**
   * How many rows one box carries. The type keeps both forms so no existing caller's comparison stops
   * compiling; EVERY drawing this wave produces reports the COMPACT THREE (top border, label, bottom
   * border), because clause AC2 removed the padding rows from every entry point.
   *
   * REPORTED rather than implied, because every caller that resolves a pointer or a focus to a ROW
   * needs it and a hard-coded `+ 1` is exactly how a box form breaks an assumption made about it
   * silently. The rail and the list draw one row per task and report three, the form they resemble.
   */
  boxRows: 3 | 5
  /**
   * Whether the width cap forced a box interior narrower than the widest label the board would write.
   *
   * The one way a natural-width drawing can still be too small for its own text: the natural width cap
   * (`NATURAL_MAX_NODE_WIDTH`) bounds the box, so an over-long label is cut. The SCENE accepts that (it
   * has always truncated); the `dag` PANEL reads this and falls back to the rail, keeping its own
   * "never truncate" promise rather than losing it silently (frozen clause T1). Under clause AC1 the
   * label is `<marker> <id>`, so the cap does not bind for a realistic board and this stays `false`.
   *
   * IT IS THE CLAMP'S OWN CONDITION, not a second guess at it: the flag is true exactly when the label
   * the drawing would write does not fit the interior it drew. A reported fact derived any other way
   * drifts from the truncation it claims to describe — measured, an off-by-one budget cut the last
   * character of every mid-length label while this flag still answered `false`.
   */
  labelOverflow?: boolean
  /**
   * The GROUP FRAMES this drawing enclosed, in draw order; absent when the board has no groups.
   *
   * A frame's rectangle is where the group's box was drawn, so the page resolves a click on a box to
   * the group it names — the same geometry the border was painted from, never a second measurement.
   */
  groups?: readonly GraphGroupHit[]
  /**
   * The group ids this drawing could NOT frame, in id order.
   *
   * NEVER silently dropped: a group whose record is unusable (an unknown parent, a parent cycle, an id
   * that collides with a task) has no box to draw, and a page that showed it as though it had one would
   * be inventing a picture. The rail and the list name these groups COLLAPSED instead.
   */
  collapsedGroups?: readonly string[]
}

/**
 * The dsh-tui THEME KEY each tone draws in.
 *
 * Declared as data so a theme change is one edit, and so a test can assert the semantics rather than
 * a hex value. The keys are the host's own (`theme.d.ts`): `success`, `activity`, `warning`, `error`,
 * `subtle`, `inactive`, `accent`, `accentShimmer`, `promptBorder`.
 */
export const GRAPH_THEME: Readonly<Record<GraphTone, string>> = Object.freeze({
  completed: "success",
  running: "activity",
  failed: "error",
  blocked: "warning",
  cancelled: "inactive",
  open: "subtle",
  focus: "accentShimmer",
  dim: "inactive",
  edge: "promptBorder",
  chain: "accent",
  // UNTOUCHED CELLS ARE NOT `dim`. A drawing is mostly background, and labelling that background
  // "dimmed" would make the focus's own dimming signal unreadable — measured: the no-focus arm saw
  // `dim` in a drawing where nothing was dimmed at all.
  blank: "text",
})

// THE STATE GLYPHS ARE THE CONTRACT'S, not this module's. `DAG_TONE_GLYPH` in `dag-theme.ts` carried a
// byte-identical copy of the table that used to live here, and a duplicate table is precisely the drift
// clause C2 forbids: the panel and the scene read the contract while the drawing read its own copy, so a
// state mark could change in one place only. `DAG_KIND_ABBREV` is deliberately NOT read any more: clause
// AC1 takes the kind out of the drawing, so this module has no use for the abbreviation table.
const GLYPH = DAG_TONE_GLYPH

// The marks are read out of the visual contract (`dag-theme.ts`) rather than re-typed here: the legend,
// the drawing and the tests all name the same characters, and a glyph change is one edit. `ARROW_DOWN`
// keeps its own name because it is the drawing's most load-bearing mark and the fidelity instrument
// reads THIS line to prove the legend's sentence and the painted arrowhead cannot drift apart.
const ARROW_DOWN = DAG_CHARS.arrowDown
/** The rail's directional marker, the same "into this task" reading in the rail's own geometry. */
const ARROW_RIGHT = DAG_CHARS.arrowRight
/** The marker a FOCUSED task draws instead of its state glyph; the legend must name the same one. */
const FOCUS_MARKER = DAG_CHARS.focusMarker
/**
 * The marker a PLAN-ONLY ghost draws instead of a state glyph.
 *
 * It is a MARKER, not a tone: `toneOf` still reads `visual: "planned"` as `open`, so the box is
 * drawn in the same colour and the same form. Without this the ghost would be indistinguishable from
 * an open board task — the drawing would be technically complete and practically unreadable.
 */
const GHOST_MARKER = DAG_GHOST_MARKER

/**
 * THE LEGEND'S ARROW SENTENCE, roomiest wording first.
 *
 * A narrow scene DROPS DOWN this ladder rather than cutting a sentence in half — the same choice the
 * rail makes when it drops its tail — so a legend never reads as a truncated falsehood. EVERY rung
 * names BOTH directional marks, because which view is on screen is a fact about the WIDTH: a 24-cell
 * scene draws the rail's `▸`, and a legend that explained only `▼` would leave the mark in front of
 * the reader undescribed. Both are interpolated from the constants the drawing paints, so the legend
 * cannot drift from the marks.
 */
const LEGEND_ENTRY: readonly string[] = Object.freeze([
  `${ARROW_DOWN}/${ARROW_RIGHT} blocker above → dependent below · ${FOCUS_MARKER} focus lights its chain`,
  `${ARROW_DOWN}/${ARROW_RIGHT} blocker → dependent · ${FOCUS_MARKER} focus`,
  `${ARROW_DOWN}/${ARROW_RIGHT} arrow · ${FOCUS_MARKER} focus`,
  `${ARROW_DOWN}/${ARROW_RIGHT} arrow`,
])

/** The narrowest row that can still carry a legend; below it a lone `▼` would be a riddle, not a key. */
const MIN_LEGEND_COLS = 8

/**
 * THE LEGEND'S ARROW/FOCUS SENTENCE: what the drawing's own marks mean, rendered under the graph.
 *
 * ONE OWNER PER LINE, and this module owns exactly this line. The STATE KEY — what each state mark
 * means — belongs to `panel-core.ts`'s `legendLinesFor`, which composes it from the frozen six-state
 * contract (`DAG_STATE_TONES` + `DAG_TONE_GLYPH`). This module used to print a SECOND, five-state key
 * (`LEGEND_STATES` + `LEGEND_SHORT` + `LEGEND_KEY`, all three deleted with the redundant legend): it
 * omitted `blocked`, so it could not tell `○ blocked` from `○ open` — precisely the ambiguity the
 * contract's key exists to resolve — and printed under that key it was the same legend twice, which
 * is the user's report that the DAG legend carried two rows. The arrow sentence stays HERE because
 * only the drawing knows which marks it painted.
 *
 * The SIGNATURE is the contract: two callers (the team scene in `scenes.ts` and the merged subagent
 * panel in `subagent-scene.ts`) render these lines under the DAG they just laid out, so the shape is
 * `string[]`, the lines carry no tone of their own, and the width bound belongs to the CALLER's
 * viewport.
 * @param cols - the cells available on the scene row.
 * @returns 0..1 plain unstyled lines, each clamped to `cols` cells; empty when nothing honest fits.
 */
export function legendLines(cols: number): string[] {
  /** The cells available; a width that is not a finite number says nothing about the viewport. */
  const width = Number.isFinite(cols) ? Math.floor(cols) : 0
  if (width < MIN_LEGEND_COLS) return []
  /** The roomiest rung that fits this viewport; undefined when even the tersest one would not. */
  const wording = LEGEND_ENTRY.find((variant) => cellWidth(variant) <= width)
  // A sentence that cannot be said is DROPPED, never cut — the same choice the rail makes when it
  // drops its tail — so a width that cleared the floor may still return nothing at all.
  return wording === undefined ? [] : [clampCells(wording, width)]
}

/**
 * The width {@link layoutGraphNatural} draws its rail fallback at.
 *
 * A named constant rather than a literal because it is the one width in the natural path that is NOT
 * derived from the content: the rail is a text list, and this entry point is given no viewport. Its
 * value matches the conventional terminal width the rail's own arms use, so the fallback looks like
 * every other rail; a caller with a real viewport calls `layoutRail` itself.
 */
const NATURAL_RAIL_FALLBACK_COLS = 80

/**
 * The smallest box the FIT-WIDTH path (`layoutBoxes`) draws; below it that path REFUSES and
 * `layoutGraph` falls back to the rail.
 *
 * ITS VALUE IS UNCHANGED BY THIS WAVE ON PURPOSE (frozen clause AC2's second sentence): the wave
 * rebuilds the boxes at a width derived from the LABEL, and the fit-width path's geometry — including
 * the width at which it gives up — is what `layoutGraph`'s boxes-versus-rail choice is stated in, so
 * touching it would silently move that choice for every existing caller. The `◐ T12 …` reading it was
 * sized for is now the drawing's own label, `<marker> <id>`.
 */
const MIN_NODE_WIDTH = 16
/** The gap between two boxes in one rank. */
const NODE_GAP = 3
/**
 * The widest a box may grow ON THE FIT-WIDTH PATH, so one long subject cannot push a rank off screen.
 *
 * THIS CAP BELONGS TO `layoutBoxes` ALONE and it stays at 34: clause T1 freezes that path's geometry for
 * every caller that never opted into natural width, and widening its boxes would be a silent change to
 * a drawing its own arms assert. The natural path has its own cap, below.
 */
const MAX_NODE_WIDTH = 34
/**
 * The widest a box may grow ON THE NATURAL-WIDTH PATH — the upper bound clause AC3 names in
 * `clamp(naturalFloor, labelCells + 4, NATURAL_MAX_NODE_WIDTH)`.
 *
 * WHY IT WAS 64, and why the number survives the wave that made it unreachable. At the fit path's 34 the
 * cap was reached by any label past 32 cells, and a REAL board's labels measured 48-53 —
 * `W1 natural width and bidirectional panning` is 51 — so `labelOverflow` fired at every terminal width,
 * `dagPanelLayout` fell back to the rail, and the whole feature (natural width plus a horizontal window)
 * switched itself OFF on exactly the boards it exists for: the PTY capture read
 * `view rail · 5 tasks · ranks derived` at 140 AND 220 columns, with `pan1`/`pan2` identical to `open1`
 * because a rail has nothing to pan to.
 *
 * UNDER CLAUSE AC1 THE CAP CAN NO LONGER BIND, and that is the intended direction rather than a loose
 * end: a label is `<marker> <id>`, so `labelCells + 4` stays in the low tens for any realistic id and
 * the FLOOR (below) is what sizes an ordinary drawing. The bound is kept exactly as the clause spells
 * it, because it is also the safety net that keeps a pathological board from producing a
 * kilometre-wide drawing — the natural path's width is content-derived and this is the only ceiling on
 * that content.
 */
const NATURAL_MAX_NODE_WIDTH = 64
/**
 * The NATURAL path's width FLOOR — `naturalFloor` in the frozen clause AC3, and the number that makes
 * the drawing fit a sidebar.
 *
 * WHY TEN. `nodeWidth = clamp(naturalFloor, labelCells + 4, NATURAL_MAX_NODE_WIDTH)` and the label is
 * now `<marker> <id>` (clause AC1), so for ordinary boards the floor is what actually binds: ten cells
 * carry a five-cell label with a leading space and room to spare inside the borders. That is what makes
 * clause AC3's measurement true — a board whose widest rank holds THREE tasks draws at
 * `3 * 10 + 2 * NODE_GAP` = 36 cells, inside a 40-column sidebar with no horizontal pan, where the old
 * content-derived width (`label + 3`, floored at 16, capped at 64) drew 3 * 19 + 6 = 63 and forced the
 * user to pan to read their own graph.
 *
 * IT IS NOT A TRUNCATION FLOOR. A label longer than `floor - 4` cells still WIDENS its box (up to the
 * cap); the floor only stops a board of one-character ids from drawing boxes too cramped to read.
 */
const NATURAL_MIN_NODE_WIDTH = 10
/**
 * Whether a panel of `cols` cells can show TWO NODE COLUMNS of this drawing — the ONE width test left
 * in the boxes-versus-rail choice (frozen contract `dag-edges`, clause A3).
 *
 * WHY THE WHOLE-FIT REFUSALS ARE GONE. The page reaches a drawing WIDER than itself through its
 * existing horizontal pan (the footer names `col n/m`) and a TALLER one through its vertical scroll, so
 * neither axis is a reason to downgrade the picture: trading the graph away for a whole-fit rule is
 * what the user named 因噎废食, and it is why a 20-task board rendered `view rail` with no lines at
 * all, and a fifth of a 5-task board's edges went missing. What remains is the case the user's own
 * directive keeps — a panel so narrow that two node columns cannot be shown.
 *
 * THE TWO COLUMNS ARE MEASURED AT THE NODE WIDTH THIS DRAWING USES (`2 * nodeWidth + NODE_GAP`,
 * clause A3's own formula), read off its hit rectangles rather than assumed: the natural path sizes a
 * box by its label, so a panel of 26 content cells comfortably shows two ten-cell columns, and
 * refusing it would be the same over-wide rule wearing a smaller constant. `MIN_NODE_WIDTH` (16) is
 * the FIT-WIDTH path's own constant, while every panel and every scene draws the NATURAL path.
 *
 * AND A DRAWING THAT ALREADY FITS IS NEVER REFUSED. The two-column floor is there to stop the graph
 * being taken away from a panel that has the room; a narrower panel showing a small drawing WHOLE has
 * the room for that drawing, so the rail would be a worse picture bought for no reason.
 * @param view - the drawing that would be shown: its width and the one box width it uses.
 * @param cols - the panel's content width in cells; a nonsense value never earns boxes.
 * @returns true when the drawing fits, or when two of its own node columns do.
 */
export function boxesFitWidth(view: Pick<GraphView, "hits" | "width">, cols: number): boolean {
  /** The measured width, floored and guarded so a non-finite number cannot pass the comparison. */
  const cells = Number.isFinite(cols) ? Math.floor(cols) : 0
  // THE WHOLE DRAWING FITS: there is nothing to pan, so nothing to refuse.
  if (view.width <= cells) return true
  /** The one box width this drawing uses, or zero for a drawing that carries no box at all. */
  const nodeWidth = view.hits.length === 0 ? 0 : view.hits[0].colEnd - view.hits[0].col + 1
  return 2 * nodeWidth + NODE_GAP <= cells
}

/** The four directions a cell can be entered from, as bits. */
const UP = 1, DOWN = 2, LEFT = 4, RIGHT = 8

/**
 * The glyph for each direction mask. Anything absent is a space.
 *
 * BUILT FROM THE CONTRACT, not restated: the four corners are the ROUNDED twins the user asked for
 * (`╭ ╮ ╰ ╯`, termaid's own set) and they come out of `DAG_CHARS`, so the node borders, the edge turns
 * and the tests that read a box all name one table. The runs and tees are unchanged — `─ │ ├ ┤ ┬ ┴ ┼`
 * carry no corner, and rounding one would be a lie about the geometry.
 */
const JUNCTION: Readonly<Record<number, string>> = Object.freeze({
  0: " ",
  [UP]: DAG_CHARS.vertical, [DOWN]: DAG_CHARS.vertical, [UP | DOWN]: DAG_CHARS.vertical,
  [LEFT]: DAG_CHARS.horizontal, [RIGHT]: DAG_CHARS.horizontal, [LEFT | RIGHT]: DAG_CHARS.horizontal,
  [DOWN | RIGHT]: DAG_CHARS.cornerDownRight, [DOWN | LEFT]: DAG_CHARS.cornerDownLeft,
  [UP | RIGHT]: DAG_CHARS.cornerUpRight, [UP | LEFT]: DAG_CHARS.cornerUpLeft,
  [UP | DOWN | RIGHT]: DAG_CHARS.teeRight, [UP | DOWN | LEFT]: DAG_CHARS.teeLeft,
  [UP | LEFT | RIGHT]: DAG_CHARS.teeUp, [DOWN | LEFT | RIGHT]: DAG_CHARS.teeDown,
  [UP | DOWN | LEFT | RIGHT]: DAG_CHARS.cross,
})

/**
 * Trim a built row to a cell budget, dropping whole spans from the end.
 *
 * THE INVARIANT THIS ENFORCES: a drawing never exceeds the width it was given. The three layouts
 * each assemble rows from parts whose widths interact (a connector, a label, a right-hand tail), and
 * doing that arithmetic correctly in three places is how a renderer overflows a scene — measured:
 * the rail produced 31 cells for a 24-cell viewport because its label floor outranked the tail.
 * Clamping here makes the guarantee structural: whatever the arithmetic says, THIS is what prints.
 * @param spans - the row's spans, left to right.
 * @param cols - the cells available.
 * @returns the spans that fit, the last one truncated if it straddles the boundary.
 */
function clampSpans(spans: readonly GraphSpan[], cols: number): GraphSpan[] {
  /** The kept spans. */
  const kept: GraphSpan[] = []
  /** The cells used so far. */
  let used = 0
  for (const span of spans) {
    if (used >= cols) break
    /** The cells this span may occupy. */
    const room = cols - used
    if (cellWidth(span.text) <= room) { kept.push(span); used += cellWidth(span.text); continue }
    kept.push({ text: clampCells(span.text, room), tone: span.tone })
    used = cols
  }
  return kept
}

/**
 * THE GRAPH-SAFE LABEL — the ONE composer for this surface (frozen clause C4, ruling R3).
 *
 * WHAT IT EXISTS FOR. A terminal grid cannot align a CJK glyph: it takes two cells, the box border
 * that follows it lands on whichever column the character count says, and the row comes out sheared.
 * The user's own complaint was exactly this, and the answer is not to widen the grid but to stop
 * writing CJK into the DRAWING at all — the click-to-pin detail body still shows the original subject,
 * Chinese included (clause C3), because that is text, not a drawing.
 *
 * THE RULE, in five steps and with nothing else in it: take the maximal runs of PRINTABLE ASCII
 * (`\x20`–`\x7E`), join the runs with ONE space, collapse whitespace, trim; when nothing survives, the
 * label is `#<ordinal>`.
 *
 * WHY THIS IS THE C1 GUARANTEE rather than a decoration: every codepoint in `\x20`–`\x7E` is
 * single-cell and outside every CJK range the clause bans, so a label built here cannot contain one.
 * That is what lets the acceptance instrument assert C1 over the RENDERED drawing instead of over the
 * inputs.
 *
 * WHO CALLS IT. NOT this module's boxed drawing any more: clause AC1 limits a node label to
 * `<marker> <id>` (see {@link labelOf}), so the TUI drawing composes no subject at all and the CJK
 * question cannot come up. The function is FROZEN and kept exported because the WEB view's factory and
 * `dag-label-parity.test.ts` consume it by this name, and their contract is unchanged.
 * @param subject - the task's original subject, in whatever language the record carries.
 * @param ordinal - the task's 1-based position in the board order the surface was HANDED; it is what a
 *   subject with no ASCII left falls back to, and it must never be a drawn order (clause C4).
 * @returns the composed label: printable ASCII runs joined by spaces, or `#<ordinal>`.
 */
export function graphSafeLabel(subject: string, ordinal: number): string {
  /** The printable-ASCII runs, in the subject's own order; a pure-CJK subject yields none. */
  const runs = subject.match(/[\x20-\x7E]+/g)
  /** The one-space-joined runs, collapsed and trimmed; empty when nothing printable survived. */
  const joined = runs === null ? "" : runs.join(" ").replace(/\s+/g, " ").trim()
  return joined === "" ? `#${ordinal}` : joined
}

/**
 * Cut a row of spans to a COLUMN window, preserving each span's tone (frozen clause T3, ruling R2).
 *
 * This is the second axis's whole geometry: the layout draws at its NATURAL width, which may be wider
 * than the terminal, and the page shows the cells `[offset, offset + cols)`. The character-level cut
 * is {@link sliceCells} — the module that must never split a wide glyph — so that rule lives in exactly
 * one place and this function only has to decide WHICH SPANS survive.
 *
 * THE POSTCONDITION: the returned spans occupy EXACTLY `cols` cells, padded with a trailing `blank`
 * span when the content is shorter. A panned row that came back short would let the box's right border
 * slide left off its own column on every row that is not full, which is the same shear the CJK fix
 * exists to prevent, arriving by a different route.
 * @param spans - the row, left to right, in the drawing's own coordinates.
 * @param offset - the first column to show, in cells.
 * @param cols - how many cells the window shows.
 * @returns the visible spans; empty when `cols` is not positive.
 */
export function sliceSpans(spans: readonly GraphSpan[], offset: number, cols: number): GraphSpan[] {
  /** The window's width, floored; below one cell there is nothing to show. */
  const width = Math.floor(Number.isFinite(cols) ? cols : 0)
  if (width <= 0) return []
  /** The first visible column, floored; a window starting before the row is the row's own start. */
  const from = Math.max(0, Math.floor(Number.isFinite(offset) ? offset : 0))
  /** The window's characters per tone, in order. */
  const kept: GraphSpan[] = []
  /** The cells of the ORIGINAL row consumed so far, over its whole run. */
  let cursor = 0
  /** The cells received so far, padding included. */
  let used = 0
  for (const span of spans) {
    if (used >= width) break
    /** The cells this whole span occupies. */
    const celly = cellWidth(span.text)
    /** The first column of this span that is still to the RIGHT of the window's own start. */
    const enter = Math.max(from, cursor)
    /** Where that column sits INSIDE the span; a span entirely behind the window enters past its end. */
    const skip = enter - cursor
    // A SPAN THE WINDOW HAS ALREADY PASSED CONTRIBUTES NOTHING, padding included. Clamping the offset
    // into the span instead would make every span behind the window contribute a full run of spaces and
    // the window would fill up with gap before it reached the content it is meant to show.
    if (skip >= celly) {
      cursor += celly
      continue
    }
    /** This span's own cut, taken from `enter`; the padding is added once, at the end. */
    const cut = sliceCells(span.text, skip, Math.min(celly - skip, width - used))
    if (cut !== "") kept.push({ text: cut, tone: span.tone })
    used += cellWidth(cut)
    cursor += celly
  }
  // THE EXACT-WIDTH POSTCONDITION, applied structurally rather than trusted (frozen clause T3): the
  // row that leaves here occupies exactly `cols`, with the padding as its OWN blank span so a reader
  // can tell the drawing's edge from the viewport's.
  if (used < width) kept.push({ text: " ".repeat(width - used), tone: "blank" })
  return kept
}

/**
 * The label one task draws: its marker, ONE space, its id — and nothing else (frozen clause AC1).
 *
 * WHY SO TERSE. The drawing is a NAVIGATION surface in a 28-column sidebar, and the wave's user ruling
 * is a state marker plus the task number (`✓ T3`, `▶ T3`): the kind was a three-letter word the
 * neighbouring box already implies, and the subject was a real sentence squeezed into whatever interior
 * was left — a Chinese subject came out `#5`, which the user read as garbled text rather than as a
 * label. Removing BOTH removes the class: a marker is one cell, an id is short, and the box needs no
 * truncation to stay on its column.
 *
 * THE SUBJECT IS NOT LOST BY THIS. It lives verbatim in the pinned detail body (clause C3), and
 * {@link graphSafeLabel} — the composer this function no longer calls — stays exported and unchanged
 * for the WEB parity arm and for `dag-label-parity.test.ts`.
 *
 * ONE WRITE SITE, still: built here rather than inline in three renderers so an absent glyph cannot
 * leave a double space in one view and not the others, and so no renderer composes a label of its own.
 * @param task - the task to label.
 * @param focus - the focused task id, which draws the `▶` marker instead of the state glyph.
 * @returns the label text: `<marker> <id>`.
 */
function labelOf(task: GraphTask, focus: string | undefined): string {
  // THE MARKER PRECEDENCE, in one place for all three views: FOCUS outranks everything (where you ARE
  // beats what it is), then a GHOST's plan-only marker, then the contract's state glyph. The ghost is
  // keyed on the model's `visual: "planned"` value, so the tone (`toneOf`) still reads it as `open`.
  /** The marker this label draws. */
  const marker = task.id === focus ? FOCUS_MARKER : task.visual === "planned" ? GHOST_MARKER : (GLYPH[task.visual] ?? "?")
  return `${marker} ${task.id}`
}

/**
 * The widest label any task on the board would draw, in cells.
 *
 * The natural-width entry point's whole input: the node width comes from CONTENT, so it needs the one
 * number that content produces, measured with the SAME composer the drawing paints with. A second,
 * hand-rolled estimate here would be the drift clause C2 forbids — and the panel used to carry exactly
 * such a duplicate, which is why it is now computed in one place and read by both surfaces. Under clause
 * AC1 the composer writes `<marker> <id>`, so this is the widest of those and a board of two-character
 * ids measures four cells whatever its subjects say.
 * @param tasks - the board, in the order the surface was handed it.
 * @param focus - the focused task id, which swaps a state glyph for the focus marker.
 * @returns the widest label, in cells; zero for an empty board.
 */
export function widestLabelCells(tasks: readonly GraphTask[], focus?: string): number {
  /** The running maximum. */
  let widest = 0
  for (const task of tasks) widest = Math.max(widest, cellWidth(labelOf(task, focus)))
  return widest
}

/** The tone a task draws in, given the focus and its chain. */
function toneOf(task: GraphTask, focus: string | undefined, chain: ReadonlySet<string> | undefined): GraphTone {
  if (task.id === focus) return "focus"
  if (chain === undefined) {
    /** The task's own rendered state, or `open` for a state this drawing does not know. */
    const visual = task.visual
    return (visual === "completed" || visual === "running" || visual === "failed" || visual === "blocked" || visual === "cancelled") ? visual : "open"
  }
  return chain.has(task.id) ? toneOf(task, undefined, undefined) : "dim"
}

/**
 * The tone ONE connector carries (clause A4).
 *
 * THE PIN MUST NEVER HIDE THE GRAPH. With a task pinned the drawing used to paint every off-chain
 * connector `dim`, and `dim` resolves to the host's `inactive` grey UNDER a `dimColor` flag — the same
 * grey a reader sees as background, which is the second reason the user's lines "disappeared". The
 * chain brightness is unchanged (both ends lit ⇒ `chain`); everything else is now the visible `edge`
 * tone. The BOXES and LABELS may still go dim: narrowing the picture is what a pin is for, and losing
 * the graph is not.
 * @param from - the blocker's task id.
 * @param to - the dependent's task id.
 * @param focus - the pinned task, when there is one.
 * @param chain - the pinned task's dependency chain, when there is one.
 * @returns the connector's tone.
 */
function edgeToneOf(from: string, to: string, focus: string | undefined, chain: ReadonlySet<string> | undefined): GraphTone {
  if (focus === undefined) return "edge"
  /** Whether an id is lit by the pin: the focus itself, or a task it rests on. */
  const lit = (id: string): boolean => id === focus || chain?.has(id) === true
  return lit(from) && lit(to) ? "chain" : "edge"
}

/**
 * The tone the `▼` carries (clause A4, the arrowhead being the connector's own terminus).
 *
 * An off-chain arrowhead follows its connector to the visible tone, because an edge whose line is
 * drawn and whose terminus is invisible reads as a line stopping short of the box. Everything the pin
 * lights keeps the tone it always had — the dependent's own state colour, or `chain`/`focus`.
 * @param child - the dependent the arrow points into.
 * @param focus - the pinned task, when there is one.
 * @param chain - the pinned task's dependency chain, when there is one.
 * @param entryTone - the tone the dependent's own box carries.
 * @returns the arrowhead's tone.
 */
function arrowToneOf(child: GraphTask, focus: string | undefined, chain: ReadonlySet<string> | undefined, entryTone: GraphTone): GraphTone {
  if (focus === undefined) return entryTone
  return child.id === focus || chain?.has(child.id) === true ? entryTone : "edge"
}

/**
 * The transitive DEPENDENCIES of one task — what a focus lights up.
 *
 * Only the UPSTREAM direction: the question a focus asks is "what does this rest on", and a task
 * that this one UNBLOCKS is a different question, answered by the detail pane rather than by the
 * drawing. A cycle is walked once, so a malformed board cannot spin here.
 * @param tasks - the board.
 * @param id - the task to walk from.
 * @returns the ids depended on, directly or transitively; never including `id` itself.
 */
export function dependencyChain(tasks: readonly GraphTask[], id: string): Set<string> {
  /** Task lookup by id. */
  const byId = new Map(tasks.map((task) => [task.id, task]))
  /** The ids reached so far. */
  const seen = new Set<string>()
  /** The walk's frontier, seeded with the focus's own dependencies. */
  const stack = [...(byId.get(id)?.dependencies ?? [])]
  while (stack.length > 0) {
    /** The next id to visit. */
    const current = stack.pop() as string
    if (seen.has(current) || !byId.has(current)) continue
    seen.add(current)
    for (const next of byId.get(current)?.dependencies ?? []) if (!seen.has(next)) stack.push(next)
  }
  return seen
}

/**
 * THE LAYERED BOX DAG, at a width the CALLER chose.
 *
 * Rank is the vertical axis and the box width is derived from the WIDEST rank, so the drawing can
 * never exceed the viewport — the caller passes a width and gets a drawing that fits, which is what
 * makes this safe to run on every render. {@link layoutBoxesNatural} is the other way in: it derives
 * the width from the CONTENT and lets the caller window it, and both routes share this one body so the
 * rank order, the barycentre placement, the edge routing and the arrowhead cannot drift between them.
 * @param tasks - the board to draw.
 * @param cols - the cells available.
 * @param focus - the task to light, with its dependency chain.
 * @param servedRanks - the SERVED rank of each task id when the host published a model; omitted
 *   means the core derives them (the standalone-fixture path).
 * @returns the view, or `undefined` when the boxes do not fit `cols` — either below the minimum node
 *   width, or because the long-edge lane pass appended a column past `cols`.
 */
export function layoutBoxes(tasks: readonly GraphTask[], cols: number, focus?: string, servedRanks?: ReadonlyMap<string, number>): GraphView | undefined {
  /** What the board's references resolve to, and therefore how it is ranked. */
  const plan = rankPlan(tasks, servedRanks)
  // THE FIT-WIDTH FORM IS THE COMPACT THREE-ROW ONE, and since clause AC2 that is the ONLY form any
  // entry point draws — `layoutBoxesNatural` draws the same one rather than buying padding rows from a
  // vertical budget. Its callers pin `hit.row + 1` as the label row, and its contract is "the drawing
  // fits what you gave me"; the geometry itself is untouched by this wave.
  if (tasks.length === 0) {
    /** The empty view: a board with no tasks draws nothing rather than a bare frame. */
    const empty: GraphView = { lines: [], hits: [], width: 0, mode: "boxes", cycles: [], chain: [], ranksDerived: plan.derived, unresolved: plan.unresolved, boxRows: 3 }
    if (focus !== undefined) empty.focus = focus
    return empty
  }
  /** The ranks, in draw order. */
  const ranks = plan.ranks
  /**
   * The count of tasks in the busiest rank, which sets the box width.
   *
   * NO RANK COUNT REFUSES THIS DRAWING ANY MORE (clause A3): `MAX_BOX_RANKS` used to answer `undefined`
   * for a deep board at every width, which is precisely how a long DAG reached the rail. A drawing
   * taller than the panel is reached by the caller's own vertical scroll instead.
   */
  const widest = ranks.reduce((max, rank) => Math.max(max, rank.length), 1)
  /** The box width that fits `widest` boxes in `cols`; below the minimum there is no room. */
  const nodeWidth = Math.min(MAX_NODE_WIDTH, Math.floor((cols - NODE_GAP * (widest - 1)) / widest))
  if (nodeWidth < MIN_NODE_WIDTH) return undefined
  /** The finished drawing, whose long-edge lane pass may have appended columns on the right. */
  const view = drawBoxes(tasks, ranks, widest, nodeWidth, 3, focus, plan)
  // THE FIT-WIDTH CONTRACT: a skip edge with no free column between its ends appends a lane past the
  // drawing (measured: one task per rank at cols 16..34 came back `cols + 1`), which is exactly the
  // overflow this path promises never to return. Refusing keeps `layoutGraph`'s rail fallback; the
  // NATURAL path is untouched and keeps its wider drawing for the caller to pan.
  if (view.width > cols) return undefined
  return view
}

/**
 * How much room a natural-width layout has VERTICALLY.
 *
 * KEPT AS AN ACCEPTED ARGUMENT, NO LONGER A CHOICE (frozen clause AC2). The budget used to select the
 * box form — the roomy five-row box when every rank fitted its own five rows plus three connector rows,
 * the compressed three-row one otherwise. The wave draws ONE form, the compact three-row box, in every
 * drawing, so `rows` is accepted and ignored: the three entry points that pass `{ rows }`
 * (`panel-dag.ts`, `scenes.ts`, `subagent-scene.ts`) keep compiling and keep their own vertical window,
 * which is where that number was always really spent.
 */
export interface GraphBudget {
  /** The rows the surface can show; accepted for compatibility and no longer selects the box form. */
  rows?: number
}

/**
 * THE LAYERED BOX DAG AT ITS NATURAL WIDTH (frozen clause T1, ruling R2).
 *
 * WHAT CHANGED AND WHY IT MATTERS. `layoutBoxes` answered "how wide a box fits the terminal", so a
 * narrow panel shrank every box until `layoutBoxes` finally REFUSED and the page fell back to the
 * rail — the user could not see their own DAG in a sidebar and asked for a horizontal scroll instead.
 * Here the box width comes from the widest label the board would write, and the resulting
 * `GraphView.width` MAY EXCEED THE VIEWPORT: the caller windows it with {@link sliceSpans} and pans.
 *
 * THE REFUSAL (T9) is the same in kind and now has a cause that can actually fire. With a
 * content-derived width the old `nodeWidth < MIN_NODE_WIDTH` arm is unreachable — the width is floored
 * AT that minimum — so the one remaining refusal is a board with more ranks than a boxed drawing can
 * stay legible in.
 *
 * THE WIDTH AND THE FORM ARE BOTH FIXED BY THIS WAVE'S CLAUSES: `nodeWidth` is AC3's clamp (the label
 * plus four cells of chrome, floored at ten), and the box is AC2's compact three-row form in every
 * drawing. The `budget` argument the callers still pass is accepted and ignored — see
 * {@link GraphBudget} — and every caller's own vertical window is untouched.
 * @param tasks - the board to draw.
 * @param focus - the task to light, with its dependency chain.
 * @param budget - the surface's vertical budget, accepted for compatibility; it no longer selects the
 *   box form (the compact three-row form is the only one drawn).
 * @param servedRanks - the SERVED rank of each task id when the host published a model; omitted
 *   means the core derives them (the standalone-fixture path).
 * @returns the view, or `undefined` when the board refuses to be drawn as boxes.
 */
export function layoutBoxesNatural(tasks: readonly GraphTask[], focus?: string, budget?: GraphBudget, servedRanks?: ReadonlyMap<string, number>, groups?: readonly GroupedGroup[]): GraphView | undefined {
  /** What the board's references resolve to, and therefore how it is ranked. */
  const plan = rankPlan(tasks, servedRanks)
  /** The ranks, in draw order; an empty board still gets a view, so the page can say "nothing here". */
  const ranks = plan.ranks
  /**
   * The count of tasks in the busiest rank, which sets the drawing's total width.
   *
   * NO RANK COUNT REFUSES THIS DRAWING ANY MORE (clause A3): the scene and the panel both reach a
   * drawing taller than themselves through their own vertical scroll, so a rank cap could only ever
   * downgrade the picture to a rail — the user's `view rail` screenshot at full screen.
   */
  const widest = ranks.reduce((max, rank) => Math.max(max, rank.length), 1)
  /** The widest label the drawing would write, measured with the composer it paints with. */
  const label = widestLabelCells(tasks, focus)
  // THE NODE WIDTH IS THE LABEL PLUS ITS FOUR CELLS OF CHROME (frozen clause AC3, stated exactly as the
  // clause spells it): the leading space the drawing writes before the text, the two borders around it,
  // and one cell of slack — `nodeWidth = clamp(naturalFloor, labelCells + 4, NATURAL_MAX_NODE_WIDTH)`.
  // The FLOOR is what sizes an ordinary drawing, because clause AC1's label is `<marker> <id>`; the CAP
  // is the safety net a content-derived width needs. Getting this arithmetic wrong by ONE cell is what
  // used to cut the last character of any label that landed between the two bounds: measured,
  // `requirements contract` drew as `requirements contrac` while `labelOverflow` still answered `false`.
  const nodeWidth = Math.max(NATURAL_MIN_NODE_WIDTH, Math.min(NATURAL_MAX_NODE_WIDTH, label + 4))
  if (tasks.length === 0) {
    /** The empty view: a board with no tasks draws nothing rather than a bare frame. */
    const empty: GraphView = { lines: [], hits: [], width: 0, mode: "boxes", cycles: [], chain: [], ranksDerived: plan.derived, unresolved: plan.unresolved, boxRows: 3 }
    if (focus !== undefined) empty.focus = focus
    return empty
  }
  // ONE FORM, ALWAYS (frozen clause AC2): the compact three-row box, top border / content / bottom
  // border, at a rank stride of six rows. The vertical budget no longer buys padding rows — a single
  // form per drawing is the contract, and two boxes of different heights in one column would leave the
  // edges between them pointing at rows nobody recomputed.
  void budget
  // THE NESTED DRAWING COMES FIRST, and only when the board really carries groups: a board with none
  // takes the flat path below BYTE FOR BYTE, which is what keeps this wave additive. A group set that
  // places nothing (every record unusable) also falls through, rather than drawing an empty frame.
  if (groups !== undefined && groups.length > 0) {
    /** The nested drawing, when the group records place at least one box. */
    const nested = drawGroupedBoxes(tasks, groups, focus, nodeWidth, servedRanks, label, plan)
    if (nested !== undefined) return nested
  }
  /** The flat drawing: what a board without placeable frames gets. */
  const flat = drawBoxes(tasks, ranks, widest, nodeWidth, 3, focus, plan, label)
  // A GROUP SET THAT PLACES NOTHING IS STILL REPORTED. The flat picture is the honest drawing (there is no
  // box to enclose), but a caller that asked for groups deserves to be told which ones the tree refused —
  // otherwise an unusable record would vanish silently, which is the one thing this wave may not do.
  if (groups !== undefined && groups.length > 0) {
    /** The tree the records would have built, for its refusal list. */
    const refused = buildFrameTree(tasks, groups)
    if (refused.collapsed.length > 0) flat.collapsedGroups = [...refused.collapsed].sort()
  }
  return flat
}

/** The four grids one drawing writes into, plus the read that turns them into rows. */
interface CellCanvas {
  /**
   * OR one direction into a cell; edges MERGE, they never overwrite.
   * @param row - the cell's row.
   * @param col - the cell's column.
   * @param dir - the direction bits (see the `UP`/`DOWN`/`LEFT`/`RIGHT` masks).
   * @param at - the tone the cell is drawn in.
   */
  link(row: number, col: number, dir: number, at: GraphTone): void
  /**
   * Write a literal character over the mask: a label, or a group frame's border.
   * @param row - the cell's row.
   * @param col - the cell's column.
   * @param char - the character; a WIDE glyph claims the cells it covers.
   * @param at - the tone the cell is drawn in.
   */
  label(row: number, col: number, char: string, at: GraphTone): void
  /**
   * Draw one straight run between two waypoints.
   * @param fromRow - the run's first row.
   * @param fromCol - the run's first column.
   * @param toRow - the run's last row.
   * @param toCol - the run's last column.
   * @param at - the tone the run is drawn in.
   */
  run(fromRow: number, fromCol: number, toRow: number, toCol: number, at: GraphTone): void
  /**
   * The finished rows, top to bottom.
   * @returns one span list per row, trailing blanks trimmed and same-tone runs collapsed.
   */
  lines(): GraphSpan[][]
}

/**
 * Build one cell canvas at a FIXED width.
 *
 * WHY THIS IS A FACTORY AND NOT LOCAL STATE INSIDE ONE DRAWING: there are now TWO drawings — the flat
 * board, and the nested one that groups need — and they must paint by the SAME rules for a mask merge, a
 * label beating a junction, and the continuation cell of a wide glyph. A second copy of those rules is
 * exactly the drift this file's comments keep warning about, so they live here once and every drawing
 * asks for a canvas.
 *
 * The width is fixed at creation because the caller SIZES the picture before it paints: a canvas free to
 * grow sideways would let a long edge's lane widen a drawing whose placement was already decided.
 * @param width - the drawing's own width in cells.
 * @returns the canvas.
 */
function createCellCanvas(width: number): CellCanvas {
  /** The accumulated direction mask per cell. */
  const mask: number[][] = []
  /** The literal characters written over the mask (labels and frame borders). */
  const text: (string | null)[][] = []
  /** The tone per cell; a later, LOUDER write wins so a chain edge stays visible across a trunk. */
  const tone: (GraphTone | null)[][] = []
  /**
   * The cells a WIDE glyph already covers, which must render as NOTHING rather than as a space.
   *
   * THE CJK FIX (see the header): a wide glyph takes two cells, so the cell after it is part of the
   * glyph and cannot carry a space — a space there makes the row one cell wider than the grid it was
   * built for and pushes the box's closing border off its own column.
   */
  const wide: boolean[][] = []
  /** The tone precedence, so a merge never dims something the focus lit. `blank` is lowest. */
  const order: GraphTone[] = ["blank", "dim", "edge", "open", "cancelled", "blocked", "chain", "running", "completed", "failed", "focus"]
  /**
   * The tone currently in a cell.
   * @param row - the cell's row.
   * @param col - the cell's column.
   * @returns the tone, or undefined for a cell nothing has written.
   */
  const toneAt = (row: number, col: number): GraphTone | undefined => tone[row]?.[col] ?? undefined
  /**
   * Grow the canvas so a cell can be written.
   * @param row - the row that must exist.
   */
  const grow = (row: number): void => {
    while (mask.length <= row) { mask.push(new Array(width).fill(0)); text.push(new Array(width).fill(null)); tone.push(new Array(width).fill(null)); wide.push(new Array(width).fill(false)) }
  }
  /**
   * OR one direction into a cell; edges MERGE, they never overwrite.
   * @param row - the cell's row.
   * @param col - the cell's column.
   * @param dir - the direction bits.
   * @param at - the tone the cell is drawn in.
   */
  const link = (row: number, col: number, dir: number, at: GraphTone): void => {
    if (col < 0 || col >= width || row < 0) return
    grow(row)
    // A cell inside a wide glyph is not a cell this drawing may enter: the glyph already owns it.
    if (wide[row][col]) return
    mask[row][col] |= dir
    /** The tone already there, if any. */
    const current = toneAt(row, col)
    if (current === undefined || order.indexOf(at) > order.indexOf(current)) tone[row][col] = at
  }
  /**
   * Write a label character; it always beats a junction glyph.
   * @param row - the cell's row.
   * @param col - the cell's column.
   * @param char - the character.
   * @param at - the tone the cell is drawn in.
   */
  const label = (row: number, col: number, char: string, at: GraphTone): void => {
    if (col < 0 || col >= width) return
    grow(row)
    if (wide[row][col]) return
    text[row][col] = char
    tone[row][col] = at
    // EVERY CELL THE GLYPH COVERS IS MARKED, in CELLS and never in characters: the glyph's own tone is
    // carried onto its continuation cells so the two render as ONE span, and any junction or label a
    // previous write left there is cleared — the glyph has replaced that cell, not merely sat beside it.
    for (let step = 1; step < cellWidth(char); step++) {
      /** The cell this glyph's next column covers; past the edge there is nothing to mark. */
      const over = col + step
      if (over >= width) break
      text[row][over] = null
      mask[row][over] = 0
      tone[row][over] = at
      wide[row][over] = true
    }
  }
  /**
   * Draw one straight run between two waypoints of an edge.
   *
   * ONE ARITHMETIC FOR BOTH AXES: every cell gets the bit pointing at the NEXT cell and the bit pointing
   * back at the PREVIOUS one, so a vertical trunk, a horizontal jog and a one-cell stub are the same call
   * — and the mask can never disagree with the geometry it was derived from.
   * @param fromRow - the run's first row.
   * @param fromCol - the run's first column.
   * @param toRow - the run's last row.
   * @param toCol - the run's last column.
   * @param at - the tone the run is drawn in.
   */
  const run = (fromRow: number, fromCol: number, toRow: number, toCol: number, at: GraphTone): void => {
    /** How many steps the run takes: the longer of the two axes. */
    const steps = Math.max(Math.abs(toRow - fromRow), Math.abs(toCol - fromCol))
    /** The row a step moves by. */
    const stepRow = Math.sign(toRow - fromRow)
    /** The column a step moves by. */
    const stepCol = Math.sign(toCol - fromCol)
    for (let step = 0; step <= steps; step += 1) {
      /** The cell this step writes. */
      const row = fromRow + stepRow * step
      /** Its column. */
      const col = fromCol + stepCol * step
      /** The bit toward the NEXT cell, when there is one. */
      const ahead = step === steps ? 0 : stepRow < 0 ? UP : stepRow > 0 ? DOWN : stepCol < 0 ? LEFT : RIGHT
      /** The bit toward the PREVIOUS cell, when there is one. */
      const behind = step === 0 ? 0 : stepRow < 0 ? DOWN : stepRow > 0 ? UP : stepCol < 0 ? RIGHT : LEFT
      link(row, col, ahead | behind, at)
    }
  }
  /**
   * The finished rows: trailing blanks trimmed, runs of one tone collapsed into spans.
   * @returns one span list per row.
   */
  const lines = (): GraphSpan[][] => {
    /** The rendered rows. */
    const out: GraphSpan[][] = []
    for (let row = 0; row < mask.length; row++) {
      /** This row's cells, junction or label. */
      const cells: GraphSpan[] = []
      /** The run being accumulated. */
      let accumulated: GraphSpan | null = null
      for (let col = 0; col < width; col++) {
        /** The character at this cell: a label wins over the junction glyph for its mask. */
        // A cell a WIDE glyph covers renders as NOTHING, never as the background space it would
        // otherwise fall back to — that is what keeps the row exactly as wide as the grid it was built
        // for, and the box's closing border on its own column (the CJK defect, see the header).
        const char = wide[row][col] ? "" : (text[row][col] ?? JUNCTION[mask[row][col]] ?? " ")
        // An untouched cell is BACKGROUND, and consecutive background is ONE span rather than one per
        // cell: the host renders each span as its own element, so a 108-cell row of mostly gaps would
        // otherwise build ~100 elements per row on every render — and this scene re-renders on hover.
        /** The tone at this cell; an untouched cell is background. */
        const at: GraphTone = toneAt(row, col) ?? "blank"
        if (accumulated !== null && accumulated.tone === at) accumulated.text += char
        else { accumulated = { text: char, tone: at }; cells.push(accumulated) }
      }
      while (cells.length > 0 && (cells[cells.length - 1].text ?? "").trim() === "") cells.pop()
      out.push(clampSpans(cells, width))
    }
    while (out.length > 0 && out[out.length - 1].every((span) => span.text.trim() === "")) out.pop()
    return out
  }
  return { link, label, run, lines }
}

/**
 * Draw the boxed DAG at a node width the caller has ALREADY decided.
 *
 * The one body both entry points share: `layoutBoxes` arrives with a width that fits the terminal and
 * `layoutBoxesNatural` with one derived from the labels. Everything that makes the drawing legible —
 * the rank order, the barycentre placement, the mask-merge edge routing, the single `▼` per dependent
 * — lives here exactly once, so the two routes cannot disagree about the picture.
 * @param tasks - the board to draw.
 * @param ranks - the ranks in draw order, already computed by the caller's rank plan.
 * @param widest - the count of tasks in the busiest rank, which sets the drawing's total width.
 * @param nodeWidth - the box width, borders included, already clamped by the caller.
 * @param form - how many rows each box carries. BOTH branches are kept and only the COMPACT THREE is
 *   passed any more (clause AC2: one form per drawing); the five-row branch survives as the arithmetic
 *   the three-row branch is written against, so a future caller cannot silently reintroduce padding rows
 *   without the label, border and stride rows moving with it.
 * @param focus - the task to light, with its dependency chain.
 * @param plan - the rank plan, handed in rather than recomputed so the two cannot disagree.
 * @param widestLabel - the board's widest label, when the caller measured one and wants the overflow
 *   reported; omitted means "nobody asked", which reports no overflow.
 * @returns the finished view.
 */
function drawBoxes(
  tasks: readonly GraphTask[],
  ranks: readonly GraphTask[][],
  widest: number,
  nodeWidth: number,
  form: 3 | 5,
  focus: string | undefined,
  plan: RankPlan<GraphTask>,
  widestLabel?: number,
): GraphView {
  /** The focus's chain, or undefined when nothing is focused. */
  const chain = focus === undefined ? undefined : dependencyChain(tasks, focus)
  /** The row a box's padding sits on above its content, and the row its content sits on. */
  const padTop = form === 5 ? 1 : 0
  /**
   * How many cells of the label row the text may occupy: the box's OWN interior, and the same in both
   * forms.
   *
   * THE BUDGET IS THE BOX'S WIDTH, NEVER A GLOBAL CONSTANT, and that is not a style preference: a fixed
   * budget is correct only while the box is at the width that constant was derived from, and wrong — by
   * writing straight over the right border and into the next box — for every narrower box. The FIT-WIDTH
   * path produces exactly those (a 28-cell terminal gets a 28-cell box), so a fixed budget shears its
   * drawings; measured, a boxed row came out with NO closing border at all. A padding row (when a caller
   * ever draws the five-row form again) buys air and not text, so the interior is the budget in both
   * forms.
   */
  const labelCells = nodeWidth - 2
  /** The row a box's content (its label) sits on, relative to the box's top border. */
  const contentRow = padTop + 1
  /** The row a box's bottom border sits on. */
  const bottomRow = form === 5 ? 4 : 2
  /** How many rows one rank's box occupies plus the connector rows that carry its edges forward. */
  const RANK_STRIDE = bottomRow + 4

  /**
   * THE RANKS THE DRAWING USES, with every EMPTY bucket dropped (clause A2).
   *
   * WHY THE COMPACTION LIVES HERE AND NOT IN `rankPlan`. The plan's buckets are index-equal to the
   * SERVED rank (`bucketRanks` keeps one array per rank so the web plane's column index is the rank
   * itself), and that contract is shared with the web view — so the served map keeps its holes and the
   * DRAWING closes them. A bucket with no task therefore consumes no rows here, which is what removes
   * the six-row hole the user read as a broken graph, and no edge has to cross a rank that holds no box.
   */
  const drawn = ranks.filter((rank) => rank.length > 0)

  /** Each task's left column, laid out rank by rank. */
  const column = new Map<string, number>()
  for (const rank of drawn) {
    // Order within a rank by the BARYCENTRE of the parents already placed, which is what keeps a
    // chain roughly vertical instead of zig-zagging across the drawing.
    /** The rank in draw order, carrying the mean parent column as its sort key. */
    const ordered = rank.map((task, index) => {
      /** The left columns of this task's parents that are already placed. */
      const parents = task.dependencies.filter((id) => column.has(id)).map((id) => column.get(id) as number)
      return { task, index, key: parents.length === 0 ? Number.MAX_SAFE_INTEGER : parents.reduce((sum, at) => sum + at, 0) / parents.length }
    }).sort((left, right) => left.key - right.key || left.index - right.index)
    ordered.forEach((entry, index) => column.set(entry.task.id, index * (nodeWidth + NODE_GAP)))
  }

  /** The drawn rank of every placed task, so an edge's two endpoints can be located without a scan. */
  const rankOf = new Map<string, number>()
  drawn.forEach((rank, index) => { for (const task of rank) rankOf.set(task.id, index) })
  /** Task lookup by id, for the long edges' own tones and labels. */
  const byId = new Map(tasks.map((task) => [task.id, task]))
  /**
   * The centre column of one task's box.
   *
   * THE LEFT-MIDDLE CELL when the width is EVEN, and that is not a rounding detail: the `▼` and the
   * `┬`/`┴` beneath it must sit on the column a reader reads as the box's mid-line, and the hit
   * rectangle's own centre — `floor((left + right) / 2)` — is what a reviewer (and a pointer) measures
   * against. A `floor(width / 2)` that rounds the other way lands the arrowhead one column right of
   * the border's centre, which reads as an off-by-one in the drawing itself.
   */
  const centreOf = (id: string): number => (column.get(id) ?? 0) + Math.floor((nodeWidth - 1) / 2)
  /**
   * The columns each DRAWN rank's boxes occupy, derived ONCE from the placement above.
   *
   * The lane search below asks "is this column clear at every intermediate rank" for every candidate
   * column of every long edge, on every panel refresh — the page ticks every two seconds. Scanning a
   * rank's tasks for each of those questions repeats the same arithmetic; the set answers with one
   * `has`, and it is built from `column` and `nodeWidth` so it cannot drift from the boxes drawn.
   */
  const covered: Array<Set<number>> = drawn.map((rank) => {
    /** The columns this rank's boxes occupy, borders included. */
    const cells = new Set<number>()
    for (const task of rank) {
      /** The box's left column, which the placement above fixed. */
      const left = column.get(task.id) ?? 0
      for (let col = left; col < left + nodeWidth; col++) cells.add(col)
    }
    return cells
  })
  /** Whether one drawn rank's boxes cover a column — the test a long edge's LANE has to pass. */
  const boxCovers = (rank: number, col: number): boolean => covered[rank].has(col)
  /** Every blocker → dependent EDGE whose two ends are BOTH on the board, with their drawn ranks. */
  const edges: Array<{ from: string; to: string; fromRank: number; toRank: number }> = []
  for (const task of tasks) {
    /** The dependent's drawn rank; a task the placement did not reach has no edge to draw. */
    const toRank = rankOf.get(task.id)
    if (toRank === undefined) continue
    for (const id of task.dependencies) {
      /** The blocker's drawn rank; an id no drawn task carries stays in the unresolved report. */
      const fromRank = rankOf.get(id)
      if (fromRank === undefined || fromRank >= toRank) continue
      edges.push({ from: id, to: task.id, fromRank, toRank })
    }
  }
  /**
   * A LANE FOR EVERY LONG EDGE (clause A1): a column that no box of the ranks BETWEEN its two ends
   * occupies, so a run at ANY rank distance never has to cross a picture.
   *
   * The run keeps the band language the adjacent edges already use — one horizontal jog in the band
   * below the blocker, one in the band above the dependent — and adds the vertical lane between them.
   * A lane past the drawing's own width is appended on the right, which is the only case in which a
   * long edge widens the picture; the panel already pans, so nothing is lost off the edge.
   */
  const lanes: Array<{ from: string; to: string; fromRank: number; toRank: number; lane: number }> = []
  /** The rows each chosen lane already occupies, so two trunks share a column only when they must. */
  const laneRows = new Map<number, Set<number>>()
  /** The drawing's own width, before any lane had to be appended. */
  const baseWidth = widest * (nodeWidth + NODE_GAP) - NODE_GAP
  /** The lanes appended to the right of the drawing for long edges no free column could hold. */
  let extraLanes = 0
  for (const edge of edges) {
    // THE ADJACENT LINKS KEEP THEIR OWN BAND GEOMETRY, byte for byte: this pass adds nothing to them.
    if (edge.toRank === edge.fromRank + 1) continue
    /** The row the run leaves the blocker's bottom border on, then jogs horizontally. */
    const leaveRow = edge.fromRank * RANK_STRIDE + bottomRow + 2
    /** The row the run jogs back to the dependent's centre and drops its arrowhead from. */
    const enterRow = edge.toRank * RANK_STRIDE - 2
    /** The blocker's centre column, where its band stub starts. */
    const fromCentre = centreOf(edge.from)
    /** The dependent's centre column, where its `▼` must land. */
    const toCentre = centreOf(edge.to)
    /** The middle of the two centres: the lane reads best as near to a straight line as it can. */
    const middle = (fromCentre + toCentre) / 2
    /** The best lane found so far, or -1. */
    let best = -1
    /** Its distance from the middle, so a closer free column replaces it. */
    let bestCost = Number.POSITIVE_INFINITY
    for (let col = 0; col <= baseWidth + extraLanes; col += 1) {
      /** Whether every intermediate rank leaves this column to the run. */
      let clear = true
      for (let rank = edge.fromRank + 1; rank < edge.toRank && clear; rank += 1) clear = !boxCovers(rank, col)
      if (!clear) continue
      /** The rows already taken at this column by an earlier trunk. */
      const taken = laneRows.get(col)
      /** Whether this trunk's rows collide with them; a shared column would merge two edges into one. */
      let free = true
      for (let row = leaveRow; row <= enterRow && free; row += 1) free = taken?.has(row) !== true
      if (!free) continue
      /** How far this column sits from the middle of the two centres. */
      const cost = Math.abs(col - middle)
      if (cost < bestCost) { best = col; bestCost = cost }
    }
    if (best < 0) {
      // NO COLUMN WAS FREE AT ALL, so the run gets a fresh lane on the right edge rather than being
      // dropped: the drawing grows by one column per such edge.
      best = baseWidth + extraLanes
      extraLanes += 1
    } else if (best >= baseWidth + extraLanes) {
      // THE LANE SITS PAST THE DRAWING — a one-column board has no free column inside itself, so the
      // only lane it can offer is the one just outside. The canvas MUST grow to hold it, or `link`
      // would silently refuse every cell of the run and the edge would vanish exactly as before.
      extraLanes = best - baseWidth + 1
    }
    /** The rows this trunk claims, so a later long edge picks a different column when it can. */
    const claimed = laneRows.get(best) ?? new Set<number>()
    for (let row = leaveRow; row <= enterRow; row += 1) claimed.add(row)
    laneRows.set(best, claimed)
    lanes.push({ ...edge, lane: best })
  }
  /**
   * The drawn width: exactly what the widest rank occupies, plus the lanes a long edge had to add.
   * The FIT-WIDTH entry point refuses a view wider than its `cols`; the natural one keeps this width
   * and lets its caller pan.
   */
  const width = baseWidth + extraLanes

  /** The canvas this drawing paints into: the cells, the mask and the rules that merge them. */
  const canvas = createCellCanvas(width)
  /** The three writers this body uses; the finished rows are read once, at the end. */
  const { link, label, run } = canvas

  /** Every rectangle the pointer can land in. */
  /** One rectangle per box, so the pointer can resolve to a task. */
  const hits: GraphHit[] = []
  for (let rank = 0; rank < drawn.length; rank++) {
    /** The row this rank's top border sits on. */
    const top = rank * RANK_STRIDE
    for (const task of drawn[rank]) {
      /** The box's left column. */
      const left = column.get(task.id) ?? 0
      /** The box's right column, inclusive. */
      const right = left + nodeWidth - 1
      /** This task's tone: its state, or the chain/dim treatment when something is focused. */
      const at = toneOf(task, focus, chain)
      for (let col = left + 1; col < right; col++) link(top, col, LEFT | RIGHT, at)
      link(top, left, RIGHT | DOWN, at); link(top, right, LEFT | DOWN, at)
      // THE INTERIOR: every row between the two borders carries its two SIDES, padding and label rows
      // alike. Only the sides — a `─` across a padding row would close the box on top of its own title,
      // and the LABEL row's sides are the ones a naive "paint the padding, then paint the label" shape
      // forgets, which leaves the title floating outside its own box (measured while landing T7).
      for (let row = top + 1; row < top + bottomRow; row++) {
        link(row, left, UP | DOWN, at); link(row, right, UP | DOWN, at)
      }
      for (let col = left + 1; col < right; col++) link(top + bottomRow, col, LEFT | RIGHT, at)
      link(top + bottomRow, left, RIGHT | UP, at); link(top + bottomRow, right, LEFT | UP, at)
      /** The label: the marker and the id, one space apart and nothing else (clause AC1). */
      const body = labelOf(task, focus)
      /** The column the next label character goes to. */
      let cursor = left + 1
      for (const char of clampCells(stripControl(" " + body), labelCells)) { label(top + contentRow, cursor, char, at); cursor += cellWidth(char) }
      // An edge LEAVES from the middle of the bottom border, which is what makes the `┬` read as
      // "this box has children" without a separate stub row: `DOWN|LEFT|RIGHT` is exactly that tee.
      // THE EXIT IS TESTED AGAINST EVERY DEEPER RANK (clause A1), not only the one below: a board whose
      // only dependent sits two ranks down used to draw a plain `───` border and no line at all.
      if (edges.some((candidate) => candidate.from === task.id && candidate.fromRank === rank)) link(top + bottomRow, centreOf(task.id), DOWN, at)
      hits.push({ taskId: task.id, row: top, rowEnd: top + bottomRow, col: left, colEnd: right })
    }
    if (rank + 1 >= drawn.length) break
    /** The three connector rows between this rank and the next. */
    const stubTop = top + bottomRow + 1, bus = top + bottomRow + 2, stubBottom = top + bottomRow + 3
    /** The next rank's top border: the row the `▼`'s one-cell tip must touch. */
    const childTop = top + RANK_STRIDE
    for (const child of drawn[rank + 1]) {
      /** This child's blockers that live in the rank above. */
      const parents = child.dependencies.filter((id) => drawn[rank].some((parent) => parent.id === id))
      if (parents.length === 0) continue
      /** This child's centre column. */
      const centre = centreOf(child.id)
      /** This child's tone: its state, or the chain/dim treatment when something is focused. */
      const entryTone = toneOf(child, focus, chain)
      link(childTop, centre, UP, entryTone)
      // The edge ENDS here, in the arrowhead. Every converging parent writes this SAME cell, so a
      // fan-in still shows exactly ONE `▼`; it is text rather than a junction because a mask bit can
      // say "connected", never "…and the dependency points INTO this box".
      label(stubBottom, centre, ARROW_DOWN, arrowToneOf(child, focus, chain, entryTone))
      for (const id of parents) {
        /** The parent's centre column. */
        const from = centreOf(id)
        /** The tone this EDGE carries: bright while BOTH of its ends are inside the chain. */
        const edgeTone: GraphTone = edgeToneOf(id, child.id, focus, chain)
        link(stubTop, from, UP | DOWN, edgeTone)
        if (from === centre) { link(bus, from, UP | DOWN, edgeTone); continue }
        link(bus, from, UP, edgeTone); link(bus, centre, DOWN, edgeTone)
        for (let col = Math.min(from, centre) + 1; col < Math.max(from, centre); col++) link(bus, col, LEFT | RIGHT, edgeTone)
        link(bus, Math.min(from, centre), RIGHT, edgeTone); link(bus, Math.max(from, centre), LEFT, edgeTone)
      }
    }
  }
  // THE LONG EDGES, AT ANY RANK DISTANCE (clause A1). Drawn AFTER the bands above so an adjacent edge's
  // geometry — the shape that already worked — stays byte-identical; every write here only ADDS mask
  // bits, which is what lets a long run merge with a band it happens to cross.
  for (const edge of lanes) {
    /** The blocker's bottom border, where the run leaves its box. */
    const exitRow = edge.fromRank * RANK_STRIDE + bottomRow
    /** The band row the run jogs horizontally on, below the blocker. */
    const leaveRow = exitRow + 2
    /** The band row the run jogs horizontally on, above the dependent. */
    const enterRow = edge.toRank * RANK_STRIDE - 2
    /** The row the arrowhead sits on: one above the dependent's top border. */
    const arrowRow = edge.toRank * RANK_STRIDE - 1
    /** The dependent's top border, whose entry cell becomes a `┴`. */
    const childTop = edge.toRank * RANK_STRIDE
    /** The blocker's centre column. */
    const from = centreOf(edge.from)
    /** The dependent's centre column. */
    const to = centreOf(edge.to)
    /** The tone this edge carries: `chain` while the pin lights both ends, the visible `edge` otherwise. */
    const at = edgeToneOf(edge.from, edge.to, focus, chain)
    /** The dependent's own task, for its entry tone and its arrowhead. */
    const child = byId.get(edge.to) as GraphTask
    /** The dependent's own tone, or the chain/dim treatment when something is focused. */
    const entryTone = toneOf(child, focus, chain)
    /** The run's waypoints: out of the box, across to the lane, down, back, and into the arrowhead. */
    const points: ReadonlyArray<readonly [number, number]> = [
      [exitRow, from],
      [leaveRow, from],
      [leaveRow, edge.lane],
      [enterRow, edge.lane],
      [enterRow, to],
      [arrowRow, to],
    ]
    for (let index = 1; index < points.length; index += 1) {
      /** The waypoint the run comes from. */
      const [fromRow, fromPoint] = points[index - 1]
      /** The waypoint this step reaches. */
      const [toRow, toPoint] = points[index]
      run(fromRow, fromPoint, toRow, toPoint, at)
    }
    // The dependent's own border carries the entry, exactly as an adjacent edge writes it, and the run
    // ends in the same ONE `▼` — so a long edge cannot ship a second arrowhead through its lane.
    link(childTop, to, UP, entryTone)
    label(arrowRow, to, ARROW_DOWN, arrowToneOf(child, focus, chain, entryTone))
  }
  /** The finished rows, read off the canvas once: it owns the trimming and the span merge. */
  const lines = canvas.lines()

  /** The focus's chain as a list, for the header and the tests. */
  const chainList = chain === undefined ? [] : [...chain].sort()
  /** The finished view; `focus` is assigned only when there IS one, which exactOptionalPropertyTypes requires. */
  const view: GraphView = { lines, hits, width, mode: "boxes", cycles: cycleIds(tasks), chain: chainList, ranksDerived: plan.derived, unresolved: plan.unresolved, boxRows: form }
  if (focus !== undefined) view.focus = focus
  // THE OVERFLOW IS REPORTED, NEVER SILENT (T1). The width cap is the only way this drawing can end up
  // narrower than the label it wants to write, and a panel that cannot see that would keep its old
  // promise ("a box is drawn only when its interior holds the whole label") while quietly breaking it.
  // THE OVERFLOW IS THE CLAMP'S OWN CONDITION, stated once: the drawing writes `" " + body`, so it cuts
  // exactly when `1 + widestLabel > labelCells`. Deriving it from the box it actually drew keeps the
  // report and the truncation from disagreeing — which is how the off-by-one above stayed invisible.
  if (widestLabel !== undefined) view.labelOverflow = widestLabel > labelCells - 1
  // The empty board draws no text, so the overflow fact above is vacuous for it — and `labelOverflow`
  // defaults to `false` for every caller that did not measure a label, which is the honest answer.
  void tasks
  return view
}

/** The rows one TASK box occupies: top border, label, bottom border (frozen clause AC2, one form only). */
const TASK_BOX_ROWS = 3

/** One box's rectangle in the drawing's own cells. */
interface BoxRect {
  /** The first row. */
  row: number
  /** The last row, inclusive. */
  rowEnd: number
  /** The first column. */
  col: number
  /** The last column, inclusive. */
  colEnd: number
}

/**
 * The centre column of one box, which is the column its arrows and its ports sit on.
 *
 * THE LEFT-MIDDLE CELL when the width is even, for the reason the flat drawing records at its own
 * `centreOf`: the `▼` beneath it and the hit rectangle's own centre must land on ONE column, and a
 * rounding that went the other way would read as an off-by-one in the picture.
 * @param rect - the box.
 * @returns the column a run enters or leaves the box on.
 */
function boxCentre(rect: BoxRect): number {
  return rect.col + Math.floor((rect.colEnd - rect.col) / 2)
}

/**
 * THE NESTED DRAWING: a group is a BOX whose interior is that group's own DAG (contract D3).
 *
 * WHAT IS RECURSIVE HERE, exactly. Each frame lays its children out as its own little board — columns
 * top to bottom, boxes side by side inside a column, one band of rows between two columns — and a
 * GROUP child is laid out by the SAME code one level down, at the rectangle its parent gave it. That is
 * the whole of the recursion: there is no second layout engine, no per-depth special case, and no
 * absolute coordinate anywhere below the root, so an inner frame cannot disagree with the outer frame
 * that placed it.
 *
 * THE BORDER FAMILY IS A DIFFERENT ONE (`DAG_GROUP_CHARS`): double lines, one cell per glyph, so a box
 * that CONTAINS boxes can never be read as a task. Two roles are distinct by construction rather than
 * by wording (frozen contract D3):
 *   - an edge that TERMINATES on a frame side draws that side's PORT glyph (`╧` arriving from above on
 *     a top side, `╤` leaving downward from a bottom side) — the dependency attaches to the BOX;
 *   - an edge that PASSES THROUGH a frame side draws the CROSSING glyph (`╫`), which is a single line
 *     through a double one, so a run that continues inside is never drawn as an arrival.
 * The crossing role exists for an edge whose real endpoint is DEEPER than the box this frame draws
 * (a projection that joined a board to a model built before the group existed): the line enters the
 * box, and the box's own interior arrows take over — the drawing never invents the inner target,
 * because the anchored endpoint no longer names it.
 *
 * WHAT IT REFUSES: a group record the tree cannot place (an unknown parent, a parent cycle, an id that
 * collides with a task) gets no box and is reported in `collapsedGroups`; a frame set that places no
 * box at all refuses the whole drawing (`undefined`), leaving the caller its flat picture. A width
 * that cannot hold a frame is the PANEL's decision, not this function's: it draws what the content
 * needs and reports its width, exactly as the flat natural-width path does.
 * @param tasks - the board to draw.
 * @param groups - the group records, flat and in any order.
 * @param focus - the task to light, with its dependency chain.
 * @param nodeWidth - the width one TASK box uses, already clamped by the caller.
 * @param servedRanks - the SERVED column of each box inside its own frame, when a model published one.
 * @param widestLabel - the widest label the drawing would write, for the overflow report.
 * @param plan - the flat rank plan over the whole board, for its unresolved/derived report.
 * @returns the drawing, or undefined when the group records place nothing.
 */
function drawGroupedBoxes(
  tasks: readonly GraphTask[],
  groups: readonly GroupedGroup[],
  focus: string | undefined,
  nodeWidth: number,
  servedRanks: ReadonlyMap<string, number> | undefined,
  widestLabel: number,
  plan: RankPlan<GraphTask>,
): GraphView | undefined {
  /** The frame tree the group records place. */
  const tree = buildFrameTree(tasks, groups)
  // A tree with nothing but its root has nothing to frame, and the caller's flat drawing is then the
  // honest picture rather than a box drawn around the whole board.
  if (tree.frames.size <= 1) return undefined
  /** The edges each frame draws, already anchored to a box that frame can see. */
  const edges = frameEdges(tasks, tree, groups)
  /** The focus's chain, or undefined when nothing is focused. */
  const chain = focus === undefined ? undefined : dependencyChain(tasks, focus)
  /** Every task by id, for its tone and its label. */
  const byId = new Map(tasks.map((task) => [task.id, task]))
  /** Each frame's columns, measured once. */
  const rankCache = new Map<FrameId, FrameRanks>()
  /** Each frame's size, measured once, bottom-up. */
  const sizeCache = new Map<FrameId, FrameSize>()
  /** Each box's rectangle, by the box id (a task id, or a group id for its box). */
  const rects = new Map<string, BoxRect>()
  /** The group frames drawn, which is what the pointer resolves a box to. */
  const groupHits: GraphGroupHit[] = []
  /** The frames that contain the focus, so a frame on the focus's own path can stay lit. */
  const lit = new Set<FrameId>()
  /** The child each box id was placed as, per frame, so a drawer can tell a task from a group box. */
  const childOf = new Map<string, FrameChild>()

  /**
   * One frame's columns, measured once.
   * @param frame - the frame to rank.
   * @returns its columns and the column of every box.
   */
  const ranksOf = (frame: FrameNode): FrameRanks => {
    /** The columns already measured. */
    const held = rankCache.get(frame.id)
    if (held !== undefined) return held
    /** The measurement, over the edges this frame draws. */
    const measured = rankFrame(frame, edges.get(frame.id) ?? [], servedRanks)
    rankCache.set(frame.id, measured)
    return measured
  }

  /**
   * The size of one child box.
   * @param child - the child.
   * @returns its width and height in cells, borders included.
   */
  const sizeOfChild = (child: FrameChild): ChildSize => {
    if (child.kind === "task") return { width: nodeWidth, height: TASK_BOX_ROWS }
    /** The child frame's own size, which IS its box's size. */
    const inner = sizeOf(child.frame as FrameNode)
    return { width: inner.width, height: inner.height }
  }

  /**
   * One frame's size, measured once, bottom-up.
   * @param frame - the frame to measure.
   * @returns its size, borders included when it is a group.
   */
  function sizeOf(frame: FrameNode): FrameSize {
    /** The size already measured. */
    const held = sizeCache.get(frame.id)
    if (held !== undefined) return held
    /** This frame's columns. */
    const columns = ranksOf(frame).columns
    /** The measured size of every child box. */
    const childSizes = new Map<string, ChildSize>()
    for (const child of frame.children) childSizes.set(child.id, sizeOfChild(child))
    /** The column each box draws in. */
    const rankOfBox = ranksOf(frame).rankOf
    /** How many of this frame's edges skip a column, which is the lane budget its interior reserves. */
    const longEdges = (edges.get(frame.id) ?? []).filter((edge) => {
      /** The blocker's column. */
      const from = rankOfBox.get(edge.from)
      /** The dependent's column. */
      const to = rankOfBox.get(edge.to)
      return from !== undefined && to !== undefined && to > from + 1
    }).length
    /** The measurement. */
    const measured = measureFrame(columns, childSizes, longEdges, frame.id !== null)
    sizeCache.set(frame.id, measured)
    return measured
  }

  // The frames on the focus's path, walked from the focused task's own frame up to the root.
  if (focus !== undefined) {
    for (let cursor: FrameNode | null = tree.frames.get(tree.frameOfTask.get(focus) ?? null) ?? null; cursor !== null; cursor = cursor.parent) lit.add(cursor.id)
  }

  /** The drawing's own width: the root frame's interior, which has no border of its own. */
  const width = sizeOf(tree.root).width
  /** The canvas every frame paints into. */
  const canvas = createCellCanvas(width)
  /** The three writers this body uses; the finished rows are read once, at the end. */
  const { link, label, run } = canvas

  /**
   * The tone a group frame is drawn in.
   * @param frame - the frame.
   * @returns `chain` while the focus lives inside it, `dim` otherwise — the same reading the flat
   *   drawing gives a task outside the chain, one level up.
   */
  const frameTone = (frame: FrameNode): GraphTone => (lit.has(frame.id) ? "chain" : "dim")

  /**
   * Draw one TASK box.
   * @param task - the task.
   * @param rect - its rectangle.
   * @param exits - whether an edge leaves it, which is what the bottom border's stub says.
   */
  function drawTaskBox(task: GraphTask, rect: BoxRect, exits: boolean): void {
    /** The tone this box is drawn in. */
    const at = toneOf(task, focus, chain)
    // THE TOP AND BOTTOM BORDERS, then the sides: only the sides run through the label row, and a naive
    // "paint the padding, then the label" shape leaves the title floating outside its own box.
    for (let col = rect.col + 1; col < rect.colEnd; col++) link(rect.row, col, LEFT | RIGHT, at)
    link(rect.row, rect.col, RIGHT | DOWN, at)
    link(rect.row, rect.colEnd, LEFT | DOWN, at)
    for (let col = rect.col + 1; col < rect.colEnd; col++) link(rect.rowEnd, col, LEFT | RIGHT, at)
    link(rect.rowEnd, rect.col, RIGHT | UP, at)
    link(rect.rowEnd, rect.colEnd, LEFT | UP, at)
    for (let row = rect.row + 1; row < rect.rowEnd; row += 1) { link(row, rect.col, UP | DOWN, at); link(row, rect.colEnd, UP | DOWN, at) }
    /** The column the next label character goes to. */
    let cursor = rect.col + 1
    for (const char of clampCells(stripControl(" " + labelOf(task, focus)), rect.colEnd - rect.col - 1)) {
      label(rect.row + 1, cursor, char, at)
      cursor += cellWidth(char)
    }
    // An edge LEAVES from the middle of the bottom border, which is what makes the `┬` read as "this box
    // has children" without a separate stub row — the flat drawing's own decision, kept here.
    if (exits) link(rect.rowEnd, boxCentre(rect), DOWN, at)
  }

  /**
   * Draw one GROUP FRAME: its border in the second glyph family, and its title in the top side.
   * @param groupId - the group's id.
   * @param title - the frame's title.
   * @param rect - its rectangle.
   * @param frame - the frame's own node, for the tone.
   * @param exits - whether an edge leaves the box, which writes the port glyph on its bottom side.
   */
  function drawGroupFrame(groupId: string, title: string, rect: BoxRect, frame: FrameNode, exits: boolean): void {
    /** The tone the frame is drawn in. */
    const at = frameTone(frame)
    // THE FOUR SIDES: `═`/`║` between the corners, written as LITERAL GLYPHS rather than as mask bits,
    // because the mask's junction table belongs to the node family and a shared mask would let a node
    // corner and a frame corner merge into one cell.
    for (let col = rect.col + 1; col < rect.colEnd; col += 1) { label(rect.row, col, DAG_GROUP_CHARS.horizontal, at); label(rect.rowEnd, col, DAG_GROUP_CHARS.horizontal, at) }
    for (let row = rect.row + 1; row < rect.rowEnd; row += 1) { label(row, rect.col, DAG_GROUP_CHARS.vertical, at); label(row, rect.colEnd, DAG_GROUP_CHARS.vertical, at) }
    label(rect.row, rect.col, DAG_GROUP_CHARS.cornerDownRight, at)
    label(rect.row, rect.colEnd, DAG_GROUP_CHARS.cornerDownLeft, at)
    label(rect.rowEnd, rect.col, DAG_GROUP_CHARS.cornerUpRight, at)
    label(rect.rowEnd, rect.colEnd, DAG_GROUP_CHARS.cornerUpLeft, at)
    // THE TITLE SITS IN THE TOP SIDE, which is the box-drawing idiom and costs the interior no rows: the
    // label takes the border's own cells, clamped so it can never write over a corner.
    /** The column the next title character goes to. */
    let cursor = rect.col + 1
    for (const char of clampCells(stripControl(" " + title + " "), rect.colEnd - rect.col - 1)) {
      label(rect.row, cursor, char, at)
      cursor += cellWidth(char)
    }
    // AN EXIT LEAVING THE BOX IS A PORT on its bottom side, and it has to be WRITTEN here: the bottom
    // side is a literal glyph, so a mask bit added by the router would never be seen.
    if (exits) label(rect.rowEnd, boxCentre(rect), DAG_GROUP_CHARS.portDown, at)
    groupHits.push({ groupId, label: title, depth: frame.depth, row: rect.row, rowEnd: rect.rowEnd, col: rect.col, colEnd: rect.colEnd })
  }

  /**
   * Draw one frame: place its children, draw their boxes, then route its edges.
   * @param frame - the frame to draw.
   * @param originRow - the frame's first row, borders included.
   * @param originCol - the frame's first column, borders included.
   */
  function drawFrame(frame: FrameNode, originRow: number, originCol: number): void {
    /** This frame's measurement. */
    const size = sizeOf(frame)
    /** Whether this frame draws a border of its own (every frame except the root). */
    const bordered = frame.id !== null
    /** The interior's first row. */
    const innerRow = originRow + (bordered ? GROUP_BORDER : 0)
    /** The interior's first column. */
    const innerCol = originCol + (bordered ? GROUP_BORDER : 0)
    /** This frame's columns, with a served empty column closed (it would otherwise spend a band of rows). */
    const columns = drawnColumns(ranksOf(frame).columns)
    /** The top row of each drawn column. */
    const colTops: number[] = []
    /** The last row of each drawn column's boxes. */
    const colBottoms: number[] = []
    /** The box ids that have an edge leaving them, so a box with children shows its exit. */
    const exits = new Set((edges.get(frame.id) ?? []).map((edge) => edge.from))
    // PLACE, then draw: the rectangles have to exist before a border is painted, because an inner frame
    // is drawn at the rectangle its parent gave it and nothing below the root knows an absolute cell.
    /** The row the next column starts at. */
    let row = innerRow
    for (const column of columns) {
      colTops.push(row)
      /** The column's first free column. */
      let cursor = innerCol
      for (const child of column) {
        /** This child's own size. */
        const childSize = sizeOfChild(child)
        rects.set(child.id, { row, rowEnd: row + childSize.height - 1, col: cursor, colEnd: cursor + childSize.width - 1 })
        childOf.set(child.id, child)
        cursor += childSize.width + GROUP_COLUMN_GAP
      }
      /** The column's own height: its tallest box. */
      const tallest = column.reduce((max, child) => Math.max(max, sizeOfChild(child).height), 0)
      colBottoms.push(row + tallest - 1)
      row += tallest + GROUP_BAND_ROWS
    }
    for (const column of columns) {
      for (const child of column) {
        /** The rectangle placement gave this child. */
        const rect = rects.get(child.id) as BoxRect
        if (child.kind === "task") {
          drawTaskBox(byId.get(child.id) as GraphTask, rect, exits.has(child.id))
        } else {
          // A GROUP BOX: the border first, then its own interior at the rectangle the border encloses.
          drawGroupFrame(child.id, (child.group as GroupedGroup).label, rect, child.frame as FrameNode, exits.has(child.id))
          drawFrame(child.frame as FrameNode, rect.row, rect.col)
        }
      }
    }
    // THE EDGES, after every box of this frame exists: a run must be able to read both of its ends.
    drawFrameEdges(frame, columns, colBottoms, innerCol, innerCol + size.innerWidth - 1)
  }

  /**
   * Route one frame's edges: adjacent ones through the band below their column, long ones down a lane.
   * @param frame - the frame whose edges are drawn.
   * @param columns - its drawn columns.
   * @param colBottoms - the last row of each column.
   * @param innerLeft - the interior's first column.
   * @param innerRight - the interior's last column, the reserved lane region's edge included.
   */
  function drawFrameEdges(frame: FrameNode, columns: readonly FrameChild[][], colBottoms: readonly number[], innerLeft: number, innerRight: number): void {
    /** The edges this frame draws. */
    const list = edges.get(frame.id) ?? []
    if (list.length === 0) return
    /** The column each box draws in. */
    const rankOfBox = ranksOf(frame).rankOf
    /** The x-ranges each drawn column's boxes occupy, so a lane can be PROVED clear. */
    const covered = columns.map((column) => column.map((child) => rects.get(child.id) as BoxRect))
    /** The rows each lane already claims, so two trunks never merge into one line. */
    const laneRows = new Map<number, Set<number>>()
    for (const edge of list) {
      /** The blocker's rectangle. */
      const fromRect = rects.get(edge.from)
      /** The dependent's rectangle. */
      const toRect = rects.get(edge.to)
      if (fromRect === undefined || toRect === undefined) continue
      /** The blocker's column. */
      const fromRank = rankOfBox.get(edge.from)
      /** The dependent's column. */
      const toRank = rankOfBox.get(edge.to)
      // A SAME-COLUMN OR BACKWARD EDGE IS NOT DRAWN, exactly as the flat drawing declines it: the band
      // language has no route for one, and inventing one here would draw a line the flat picture cannot.
      if (fromRank === undefined || toRank === undefined || toRank <= fromRank) continue
      /** The column the run leaves the blocker on. */
      const fromCol = boxCentre(fromRect)
      /** The column the run enters the dependent on. */
      const toCol = boxCentre(toRect)
      /** The tone this run carries: `chain` while the pin lights both ends, the visible `edge` otherwise. */
      const at = edgeToneOf(edge.from, edge.to, focus, chain)
      /** The row the run leaves the blocker's box. */
      const exitRow = fromRect.rowEnd
      /** The dependent's top border, which is where an arrival lands. */
      const toTop = toRect.row
      /** The row the arrowhead sits on: one above the dependent. */
      const arrowRow = toTop - 1
      // A BOX WHOSE REAL ENDPOINT IS INSIDE IT CARRIES A CROSSING, not an arrival: the run has to pass
      // through the box's border, and the glyph says so.
      if (edge.fromDeeper) label(exitRow, fromCol, DAG_GROUP_CHARS.crossVertical, at)
      if (toRank === fromRank + 1) {
        /** The row the run jogs horizontally on: the band's second row, so the exit and the arrow clear it. */
        const busRow = (colBottoms[fromRank] as number) + 2
        run(exitRow, fromCol, busRow, fromCol, at)
        if (fromCol !== toCol) run(busRow, fromCol, busRow, toCol, at)
        run(busRow, toCol, arrowRow - 1, toCol, at)
        link(toTop, toCol, UP, at)
        label(arrowRow, toCol, ARROW_DOWN, at)
        // A DEPENDENT THAT IS A GROUP BOX takes the PORT glyph on its top side: its border is a literal
        // glyph, so the mask bit `link` just added would never be painted, and the arrow now points at a
        // PORT — which is the whole semantic of the attachment rule ("the dependency attaches to the box").
        attach(toRect, toCol, edge.to, at)
        continue
      }
      // THE LONG EDGE: down a lane no box of the columns between covers, then back to the dependent.
      /** The row the run jogs onto the lane. */
      const leaveRow = (colBottoms[fromRank] as number) + 1
      /** The row the run jogs back toward the dependent. */
      const enterRow = toTop - 2
      /** The best lane found so far, or -1. */
      let best = -1
      /** Its distance from the middle of the two centres, so a closer free column replaces it. */
      let bestCost = Number.POSITIVE_INFINITY
      for (let candidate = innerLeft; candidate <= innerRight; candidate += 1) {
        /** Whether every intermediate column leaves this lane to the run. */
        let clear = true
        for (let column = fromRank + 1; column < toRank && clear; column += 1) {
          for (const rect of covered[column] as BoxRect[]) {
            if (candidate >= rect.col && candidate <= rect.colEnd) { clear = false; break }
          }
        }
        if (!clear) continue
        /** The rows already taken at this column by an earlier trunk. */
        const taken = laneRows.get(candidate)
        /** Whether this trunk's rows collide with them. */
        let free = true
        for (let probe = leaveRow; probe <= enterRow && free; probe += 1) free = taken?.has(probe) !== true
        if (!free) continue
        /** How far this column sits from the middle of the two centres. */
        const cost = Math.abs(candidate - (fromCol + toCol) / 2)
        if (cost < bestCost) { best = candidate; bestCost = cost }
      }
      // THE RESERVED COLUMNS MAKE THIS UNREACHABLE, and it is kept as the arithmetic's own floor: a
      // frame reserves one interior column per long edge, so the region past the widest box is always
      // free; if a measurement ever regressed, the last interior column is still better than a lost edge.
      if (best < 0) best = innerRight
      /** The rows this trunk claims, so a later long edge picks a different column when it can. */
      const claimed = laneRows.get(best) ?? new Set<number>()
      for (let probe = leaveRow; probe <= enterRow; probe += 1) claimed.add(probe)
      laneRows.set(best, claimed)
      run(exitRow, fromCol, leaveRow, fromCol, at)
      run(leaveRow, fromCol, leaveRow, best, at)
      run(leaveRow, best, enterRow, best, at)
      run(enterRow, best, enterRow, toCol, at)
      run(enterRow, toCol, arrowRow - 1, toCol, at)
      link(toTop, toCol, UP, at)
      label(arrowRow, toCol, ARROW_DOWN, at)
      attach(toRect, toCol, edge.to, at)
    }
  }

  /**
   * Mark a run's arrival on a dependent's top border.
   *
   * A TASK's border is a mask cell, and the `link(…, UP)` the caller already wrote is the whole of the
   * arrival. A GROUP's top border is a LITERAL glyph, so the arrival has to be written as the port,
   * which is exactly the distinction the contract draws between crossing and terminating.
   * @param rect - the dependent's rectangle.
   * @param col - the column the run arrives on.
   * @param id - the dependent's box id.
   * @param at - the tone the port is drawn in.
   */
  function attach(rect: BoxRect, col: number, id: string, at: GraphTone): void {
    /** The child this box was placed as. */
    const child = childOf.get(id)
    if (child === undefined || child.kind !== "group") return
    label(rect.row, col, DAG_GROUP_CHARS.portUp, at)
  }

  // The whole picture, drawn: the root frame places the top-level boxes, and every group box draws its
  // own interior at the rectangle its parent gave it.
  drawFrame(tree.root, 0, 0)
  /** The finished rows. */
  const lines = canvas.lines()
  /** The focus's chain as a list, for the header and the tests. */
  const chainList = chain === undefined ? [] : [...chain].sort()
  /** Every task's rectangle, in draw order, as a pointer hit. */
  const hits: GraphHit[] = []
  for (const [id, rect] of rects) {
    /** The child this id was placed as. */
    const child = childOf.get(id)
    if (child === undefined || child.kind !== "task") continue
    // The task's own frame is reported beside its rectangle: a click inside a box is also a click
    // inside the group that box is drawn in, and a caller that wants to name the group reads it here.
    hits.push({ taskId: id, row: rect.row, rowEnd: rect.rowEnd, col: rect.col, colEnd: rect.colEnd })
  }
  /** The finished view. */
  const view: GraphView = {
    lines,
    hits,
    width,
    mode: "boxes",
    cycles: cycleIds(tasks),
    chain: chainList,
    // A grouped drawing takes its columns from the SERVED map when one arrived, and derives each
    // frame's own otherwise; the flat plan's flag answers "did the HOST derive", which is the same
    // question the footer asks, so it is handed on rather than re-derived here.
    ranksDerived: plan.derived,
    unresolved: plan.unresolved,
    boxRows: 3,
    groups: groupHits,
  }
  if (focus !== undefined) view.focus = focus
  if (tree.collapsed.length > 0) view.collapsedGroups = [...tree.collapsed].sort()
  // A label that does not fit its box is reported exactly as the flat path reports it, so the panel's
  // "never cut a label" refusal fires on a nested drawing too.
  if (widestLabel > nodeWidth - 2 - 1) view.labelOverflow = true
  return view
}

/**
 * THE RAIL: an indented forest, one line per task, for a terminal too narrow for boxes.
 *
 * A task with several blockers is drawn under ONE of them and names the rest inline (`⇠ T4+T6`),
 * which is the honest choice: the alternatives are to duplicate the row or to drop an edge.
 * @param tasks - the board to draw.
 * @param cols - the cells available.
 * @param focus - the task to light, with its dependency chain.
 * @param servedRanks - the SERVED rank of each task id when the host published a model; omitted
 *   means the core derives them (the standalone-fixture path).
 * @returns the view; never undefined, because a rail fits any width.
 */
export function layoutRail(tasks: readonly GraphTask[], cols: number, focus?: string, servedRanks?: ReadonlyMap<string, number>): GraphView {
  /** The focus's chain, or undefined when nothing is focused. */
  const chain = focus === undefined ? undefined : dependencyChain(tasks, focus)
  /** Task lookup by id. */
  const byId = new Map(tasks.map((task) => [task.id, task]))
  /** What the board's references resolve to; the forest hangs off the plan's rank, served or derived. */
  const plan = rankPlan(tasks, servedRanks)
  /** Each task's children, attached to the FIRST of its blockers in draw order. */
  const children = new Map<string, GraphTask[]>()
  for (const task of tasks) {
    /** The blocker this task hangs under: the deepest one, so the forest stays shallow. */
    const parent = task.dependencies.filter((id) => byId.has(id)).sort((left, right) => (plan.rankOf.get(right) ?? 0) - (plan.rankOf.get(left) ?? 0))[0]
    if (parent === undefined) continue
    if (!children.has(parent)) children.set(parent, [])
    ;(children.get(parent) as GraphTask[]).push(task)
  }
  /** The rows, accumulated depth-first. */
  const drawn: Array<{ task: GraphTask; prefix: string; leaf: boolean; depth: number }> = []
  // THE PREFIX IS BOUNDED BY THE WIDTH, or a deep forest silently loses every task near its bottom:
  // the indent grows three cells per level, and at ~26 levels it filled a 80-cell row on its own, so
  // the label was clamped away entirely and rows 27..40 of a 40-task chain rendered as blank lines —
  // measured while probing a 40-task board, and the reason `hits` and the drawn text disagreed. The
  // budget keeps the label its own floor by cutting whole three-cell levels off the FRONT, which are
  // the far ancestors a reader is not following anyway; the levels nearest the task are what carries
  // its place in the tree.
  /** The cells the label keeps for itself whatever the indent wants, tail or no tail. */
  const RAIL_LABEL_FLOOR = 16
  /** How many indent levels fit while that floor is kept. */
  const maxLevels = Math.max(0, Math.floor((Math.max(0, cols) - RAIL_LABEL_FLOOR) / 3))
  /** The cells the bounded prefix may occupy. */
  const prefixCells = maxLevels * 3
  // A task is drawn AT MOST ONCE. Without this the fallback pass below would re-enter a cycle and
  // recurse until the stack died — measured: a two-task cycle hung the render. The forest is a
  // DRAWING of a DAG, so a row per task is both the correct output and the termination proof.
  /** The ids already drawn. */
  const seen = new Set<string>()
  /**
   * Walk one task's subtree, recording the row it draws.
   * @param task - the task to draw.
   * @param prefix - the connector prefix inherited from the ancestors, already width-bounded.
   * @param leaf - whether this task is the last child of its parent.
   * @param depth - how deep the walk is, which decides whether a connector is drawn.
   */
  const walk = (task: GraphTask, prefix: string, leaf: boolean, depth: number): void => {
    if (seen.has(task.id)) return
    seen.add(task.id)
    drawn.push({ task, prefix, leaf, depth })
    /** This task's children, in board order. */
    const kids = children.get(task.id) ?? []
    /** The prefix this task's children inherit, cut to the width budget on a whole level boundary. */
    const grown = depth === 0 ? "" : prefix + (leaf ? "   " : "│  ")
    /** The bounded form: the innermost levels survive, so the near tree stays readable. */
    const next = grown.length <= prefixCells ? grown : grown.slice(grown.length - prefixCells)
    kids.forEach((child, index) => walk(child, next, index === kids.length - 1, depth + 1))
  }
  for (const root of tasks.filter((task) => task.dependencies.filter((id) => byId.has(id)).length === 0)) walk(root, "", true, 0)
  // A task reached by no root (a cycle) must still be drawn, or the board would silently lose a row.
  for (const task of tasks) walk(task, "", true, 0)

  /** The lines and the rectangles, built together so they cannot disagree. */
  const lines: GraphSpan[][] = []
  /** One rectangle per row, so the pointer can resolve to a task. */
  const hits: GraphHit[] = []
  drawn.forEach((entry, index) => {
    /** This task's tone: its state, or the chain/dim treatment when something is focused. */
    const at = toneOf(entry.task, focus, chain)
    /** The extra blockers this row names instead of drawing a second connector for. */
    const extra = entry.task.dependencies.length > 1 ? `  ⇠ ${entry.task.dependencies.join("+")}` : ""
    /** The right-hand facts, which are what the row is scanned for. */
    const tail = `${at === "dim" ? "" : entry.task.assignee ?? ""}${entry.task.attempt === undefined ? "" : ` a${entry.task.attempt}`}${extra}`
    /** The elbow this row hangs from: the last child gets `└`, the others `├`. */
    const elbow = entry.leaf ? "└─" : "├─"
    /** The connector, arrowed INTO this task so the rail states its direction without a bus. */
    const connector = entry.depth === 0 ? "" : `${entry.prefix}${elbow}${ARROW_RIGHT} `
    /** The label: the marker and the id, the same two fields every other view draws (clause AC1). */
    const label = labelOf(entry.task, focus)
    // THE LABEL OUTRANKS THE TAIL. A row with no id is unreadable, while a row without its
    // assignee is merely terse — so the tail is DROPPED on a narrow viewport rather than squeezing
    // the label below the width at which a task id is still legible.
    /** The cells the tail would need, gap included. */
    const tailWidth = tail === "" ? 0 : cellWidth(tail) + 2
    /** Whether the tail fits without pushing the label under its floor. */
    const useTail = tailWidth > 0 && cols - cellWidth(connector) - tailWidth >= 10
    /** The cells the label may occupy. */
    const labelRoom = Math.max(0, cols - cellWidth(connector) - (useTail ? tailWidth : 0))
    /** The visible label, truncated to that room; a cut mid-text must not leave a trailing blank. */
    const shown = clampCells(stripControl(label), labelRoom).trimEnd()
    /** The padding that puts the tail at the right edge, or nothing when the tail was dropped. */
    const gap = useTail ? " ".repeat(Math.max(0, labelRoom - cellWidth(shown))) : ""
    lines.push(clampSpans([
      { text: connector, tone: at },
      { text: shown + gap, tone: at },
      ...(useTail ? [{ text: "  " + tail, tone: at }] : []),
    ], cols))
    hits.push({ taskId: entry.task.id, row: index, rowEnd: index, col: 0, colEnd: Math.max(0, cols - 1) })
  })
  /** The focus's chain as a list, for the header and the tests. */
  const chainList = chain === undefined ? [] : [...chain].sort()
  /** The finished view; `focus` is assigned only when there IS one. */
  const view: GraphView = { lines, hits, width: cols, mode: "rail", cycles: cycleIds(tasks), chain: chainList, ranksDerived: plan.derived, unresolved: plan.unresolved, boxRows: 3 }
  if (focus !== undefined) view.focus = focus
  return view
}

/**
 * THE LIST: a rank-grouped table with progress bars, for a board too dense for boxes.
 * @param tasks - the board to draw.
 * @param cols - the cells available.
 * @param focus - the task to light, with its dependency chain.
 * @param servedRanks - the SERVED rank of each task id when the host published a model; omitted
 *   means the core derives them (the standalone-fixture path).
 * @returns the view; never undefined.
 */
export function layoutList(tasks: readonly GraphTask[], cols: number, focus?: string, servedRanks?: ReadonlyMap<string, number>): GraphView {
  /** The focus's chain, or undefined when nothing is focused. */
  const chain = focus === undefined ? undefined : dependencyChain(tasks, focus)
  /** The ranks, in draw order. */
  /** What the board's references resolve to, and therefore how it is ranked. */
  const plan = rankPlan(tasks, servedRanks)
  /** The ranks, in draw order. */
  const ranks = plan.ranks
  /** The lines and the rectangles, built together. */
  const lines: GraphSpan[][] = []
  /** One rectangle per row, so the pointer can resolve to a task. */
  const hits: GraphHit[] = []
  for (let rank = 0; rank < ranks.length; rank++) {
    /** The rank header's rule length, which never goes negative. */
    const rule = "─".repeat(Math.max(0, cols - 8))
    lines.push(clampSpans([{ text: `rank ${rank} `, tone: "edge" }, { text: rule, tone: "edge" }], cols))
    for (const task of ranks[rank]) {
      /** This task's tone. */
      const at = toneOf(task, focus, chain)
      /** The dependency suffix, so a multi-blocker row is readable at a glance. */
      const suffix = task.dependencies.length === 0 ? "" : ` ⇠${task.dependencies.join(",")}`
      /** The row's left half: the marker and the id (clause AC1), which is all the drawing carries. */
      const head = labelOf(task, focus)
      /** The row's right half: state, assignee, blocker list. */
      const tail = `${task.visual}${task.attempt === undefined ? "" : ` a${task.attempt}`}${task.assignee === undefined ? "" : `  @${task.assignee}`}${suffix}`
      /** The head, truncated to leave the tail its room. */
      const shown = clampCells(stripControl(head), Math.max(8, cols - cellWidth(tail) - 3))
      lines.push(clampSpans([{ text: "  " + shown + " ".repeat(Math.max(0, cols - 2 - cellWidth(shown) - cellWidth(tail) - 1)), tone: at }, { text: tail, tone: at }], cols))
      hits.push({ taskId: task.id, row: lines.length - 1, rowEnd: lines.length - 1, col: 0, colEnd: Math.max(0, cols - 1) })
    }
  }
  /** The focus's chain as a list, for the header and the tests. */
  const chainList = chain === undefined ? [] : [...chain].sort()
  /** The finished view; `focus` is assigned only when there IS one. */
  const view: GraphView = { lines, hits, width: cols, mode: "list", cycles: cycleIds(tasks), chain: chainList, ranksDerived: plan.derived, unresolved: plan.unresolved, boxRows: 3 }
  if (focus !== undefined) view.focus = focus
  return view
}

/**
 * Draw the board at one width, choosing the view that fits.
 *
 * The preference is BOXES, then RAIL: a rail is always legible, and boxes are the view that answers
 * the question the graph exists for. `layoutBoxes` returns undefined rather than a squeezed or
 * over-wide drawing (its long-edge lane pass can append a column past `cols`), so this decision is a
 * fact about the geometry instead of a guess about the terminal.
 * @param tasks - the board to draw.
 * @param cols - the cells available.
 * @param focus - the task to light, with its dependency chain.
 * @param servedRanks - the SERVED rank of each task id when the host published a model; omitted
 *   means the core derives them (the standalone-fixture path).
 * @returns the view to render.
 */
export function layoutGraph(tasks: readonly GraphTask[], cols: number, focus?: string, servedRanks?: ReadonlyMap<string, number>): GraphView {
  /** The widest drawing this call will produce; a negative or tiny width still yields a rail. */
  const width = Math.max(8, Math.floor(cols))
  return layoutBoxes(tasks, width, focus, servedRanks) ?? layoutRail(tasks, width, focus, servedRanks)
}

/**
 * Draw the board at its NATURAL width, choosing the view by what the CONTENT needs (clauses T1/T2).
 *
 * The same preference as {@link layoutGraph} — boxes, then the rail — decided on a different fact.
 * There the question was "do boxes fit the terminal", and the answer was often no, which is how a user
 * ends up unable to see their own DAG in a sidebar. Here the boxes are sized by the labels they must
 * carry, so they are drawn whenever the board is drawable as boxes at all; a narrow viewport is the
 * CALLER's problem, and its answer is to window and pan rather than to shrink the picture.
 *
 * The rail remains the fallback for the ONE case the boxes refuse (more ranks than a boxed drawing
 * stays legible in). It is drawn at {@link NATURAL_RAIL_FALLBACK_COLS} because a rail is a text list
 * rather than a drawing — it has no natural width to exceed, and this entry point is not given a
 * viewport. A CALLER that wants the rail at its own width asks `layoutRail` directly, which is what
 * the `dag` panel does when it declines a boxed drawing.
 * @param tasks - the board to draw.
 * @param focus - the task to light, with its dependency chain.
 * @param budget - the surface's vertical budget, forwarded to {@link layoutBoxesNatural}; under clause
 *   AC2 it no longer selects the box form, and this path's own vertical window does that work.
 * @param servedRanks - the SERVED rank of each task id when the host published a model; omitted
 *   means the core derives them (the standalone-fixture path).
 * @returns the view; its `width` may exceed `cols`.
 */
export function layoutGraphNatural(tasks: readonly GraphTask[], focus?: string, budget?: GraphBudget, servedRanks?: ReadonlyMap<string, number>, groups?: readonly GroupedGroup[]): GraphView {
  return layoutBoxesNatural(tasks, focus, budget, servedRanks, groups) ?? layoutRail(tasks, NATURAL_RAIL_FALLBACK_COLS, focus, servedRanks)
}

/**
 * Resolve a pointer position to a task.
 *
 * The graph computes its own geometry, so this is a rectangle lookup rather than a second layout —
 * there is nothing here that can drift from what was drawn.
 * @param view - the drawn view.
 * @param row - the pointer's row, relative to the graph's own top.
 * @param col - the pointer's column, relative to the graph's own left.
 * @returns the task id under the pointer, or undefined for blank space.
 */
export function hitTest(view: GraphView, row: number, col: number): string | undefined {
  for (const hit of view.hits) {
    if (row >= hit.row && row <= hit.rowEnd && col >= hit.col && col <= hit.colEnd) return hit.taskId
  }
  return undefined
}

/**
 * Resolve a pointer position to a GROUP FRAME.
 *
 * THE FRAMES ARE RESOLVED AFTER THE TASKS, and that order is the rendering's own: a box is painted over
 * the frame that encloses it, so a cell inside a task box belongs to the task even when the frame's
 * rectangle also contains it. A caller that wants "the group under this cell" asks this only when
 * {@link hitTest} answered nothing, which is what the panel does.
 * @param view - the drawn view.
 * @param row - the pointer's row, relative to the graph's own top.
 * @param col - the pointer's column, relative to the graph's own left.
 * @returns the innermost group whose frame holds the cell, or undefined outside every frame.
 */
export function hitTestGroup(view: GraphView, row: number, col: number): string | undefined {
  /** The innermost frame holding the cell, which is the deepest one whose rectangle contains it. */
  let found: GraphGroupHit | undefined
  for (const frame of view.groups ?? []) {
    if (row < frame.row || row > frame.rowEnd || col < frame.col || col > frame.colEnd) continue
    if (found === undefined || frame.depth > found.depth) found = frame
  }
  return found?.groupId
}
