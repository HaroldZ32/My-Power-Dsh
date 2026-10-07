// THE INDEPENDENT DAG PAGE — the team dependency DAG as its OWN sidebar panel (frozen clause R1).
//
// DIFFERENT FROM `panel.ts`, ON PURPOSE. `panel.ts` is the MERGED view: the host's curated subagent
// rows and then the DAG, in one column. This page is the DAG ALONE, and that difference is what buys
// it the surface the merged panel could not afford: a bordered frame, a header naming the team and its
// progress, a LEGEND, a footer of key hints, a badge, keyboard focus movement and a pinned detail
// body. The two share the shared disciplines in `panel-core.ts` and the drawing in `graph.ts`, so they
// cannot describe one edge or one state differently.
//
// WHAT IT DRAWS (frozen clauses R2–R11)
//   · the drawing itself comes from `graph.ts` and is REUSED, never re-implemented: `layoutBoxes`
//     (a layered DAG, one box per task, rank as the vertical axis), `layoutRail` (an indented forest)
//     and `layoutList` (a rank-grouped table) are the three views, and this page is the module that
//     finally gives `layoutList` a caller.
//   · the width is the MEASURED panel width and nothing else — a panel is handed exactly one geometry
//     source (`ui.useTerminalSize`) and every size derives from it, so there is no constant here that
//     decides how wide anything is.
//   · the legend is `panel-core.ts`'s `legendLinesFor`, which forwards `graph.ts`'s own arrow sentence
//     and adds the STATE KEY read out of `dag-theme.ts`. That key is what disambiguates `blocked ○`
//     from `open ○`, which share a glyph by design.
//   · click-to-pin and keyboard move/pin/unpin (R11). NO HOVER: the user's decision was explicit, so
//     there is no pointer-move surface to keep in step with the drawing.
//   · the running node breathes through `ui.useAnimationTime` and falls back to the STATIC frame when
//     the host offers no timer (R8) — see `panel-core.ts` `useRunningPhase`.
//
// THE PAGE MUST REFRESH. A sidebar panel is passive: nothing re-renders it on its own, so this page
// re-reads its source PER RENDER and owns a tick (`usePanelTick`) for the re-render itself. An
// unreachable or frozen panel is exactly the defect R13 exists for.
//
// THIS FILE NAMES NO `ctx.tui*` SERVICE: registration goes through the `TuiAdapter`, which is the ONE
// place a DSH-TUI service may be named (AGENTS.md §6).
import type { PanelRegistrationHandle, SeamOutcome, TuiAdapter } from "./types.js"
import type { Log } from "./log.js"
import { cellWidth } from "./sanitize.js"
import { DAG_CHROME, DAG_KIND_ABBREV, DAG_PANEL_MIN_COLUMNS, DAG_PANEL_SLUG, DAG_TONE_GLYPH } from "./dag-theme.js"
// THE CHROME COMES FROM THE MERGED PAGE, not a second implementation of it: the `⤢` control, its hover
// treatment and the title row it sits in are ONE definition, so the three MPD pages cannot drift into
// three different-looking affordances (and the host cannot draw one for any of them).
import { PANEL_FULLSCREEN_GLYPH, PANEL_TITLE_ROW_ROWS, usePanelTitleRow } from "./panel.js"
import { hitTest, layoutBoxesNatural, layoutList, layoutRail, legendLines, sliceSpans, type GraphTask, type GraphView } from "./graph.js"
import type { TeamWorkflow } from "./team-state.js"
import {
  clampScroll,
  graphRow,
  gutterCellsX,
  panelScrollGesture,
  panelViewportBody,
  legendLinesFor,
  panelContentWidth,
  panelField,
  panelFloorColumns,
  panelFrame,
  panelKeyEvent,
  panelKeysArmed,
  PANEL_CHROME_ROWS,
  panelKit,
  panelSnapshot,
  panelText,
  publishBadge,
  runningGlyph,
  textRow,
  usePanelKeys,
  usePanelSize,
  usePanelTick,
  usePanelViewport,
  useRunningPhase,
  type PanelBadge,
  type PanelKit,
  type PanelPropsLike,
} from "./panel-core.js"
// THE CORE LANE'S NAMESPACE, for the ONE frozen cross-lane export this page must CALL but does not own:
// `viewportRail(kit, viewport, cols)` (plan §3). It is reached by PROPERTY rather than by a named import
// because the two lanes land in either order, and a named import of an export that has not landed yet is
// a LINK-TIME failure in Bun (measured: `SyntaxError: Export named 'x' not found`) — it would take down
// every importer of this file, the package's whole suite and the row's own boot until Core lands. A
// property read costs one lookup per render and degrades to this page's own rail row in the meantime.
import * as core from "./panel-core.js"

/** The slug this page registers under; the HOST prefixes it with this activation's plugin id. */
export const DAG_PANEL_ID = DAG_PANEL_SLUG

/** The title the host stores and draws in the sidebar's own panel bar. */
export const DAG_PANEL_TITLE = "MPD DAG"

/**
 * The descriptor's icon: EXACTLY ONE display cell, which is the host's own hard requirement.
 *
 * `◈` (U+25C8) is one cell under the plugin's own measure (`sanitize.cellWidth`) and under the host's
 * East-Asian-width rule, and it is the shape the DAG itself draws with — a diamond outline, one node
 * per task.
 */
export const DAG_PANEL_ICON = "◈"

/** The ordering hint inside the host's panel bar: right after the merged panel's own 10. */
export const DAG_PANEL_ORDER = 11

/** The tick this page re-reads its source on. A sidebar is passive, so the page owns its own clock. */
export const DAG_PANEL_REFRESH_MS = 1000

/**
 * The panel descriptor, frozen at module scope.
 *
 * `apiVersion` is exactly 1 because the host refuses every other value, `id` is the single lowercase
 * slug the host requires, and `component` is filled per registration by {@link registerDagPanel}
 * (it closes over this row's own workflow reader, which no module-scope constant could).
 */
export const DAG_PANEL_DESCRIPTOR_FROZEN = {
  /** The host's panel API version (0.13.0 accepts exactly 1). */
  apiVersion: 1,
  /** The single lowercase slug the host prefixes with this activation's plugin id. */
  id: DAG_PANEL_ID,
  /** The title the host stores and draws (non-empty, at most 80 cells). */
  title: DAG_PANEL_TITLE,
  /** The one-cell icon the host draws in its panel bar. */
  icon: DAG_PANEL_ICON,
  /** The sidebar width floor: an integer in the host's own 12..64 range. */
  minColumns: DAG_PANEL_MIN_COLUMNS,
  /** The ordering hint inside the host's panel bar. */
  order: DAG_PANEL_ORDER,
} as const

/**
 * One task as this page draws and details it: the drawing's own shape plus the facts a pinned detail
 * body carries.
 *
 * `failedDependencies` and the review fields are NOT part of `GraphTask` (the drawing does not need
 * them), so this page's own task type carries both halves and projects once.
 */
export interface DagPanelTask extends GraphTask {
  /**
   * The task's acceptance text, when the record carried one — the ORIGINAL, never the graph-safe label.
   *
   * Clause C3 draws the line this field lives on: the DRAWING is CJK-free, the DETAIL is not. The pinned
   * body is text rather than a drawing, so it shows the record's own words.
   */
  description?: string
  /** The dependency ids that FAILED, i.e. that no later state can unblock (reported BESIDE the state). */
  failedDependencies: readonly string[]
  /** Review round, when the record carries one. */
  round?: number
  /** Review verdict, when the record carries one. */
  verdict?: string
}

/** The projection one render draws from: the tasks, the counts, the roster size and the problems. */
export interface DagPage {
  /** The tasks, in board order. */
  tasks: DagPanelTask[]
  /** The workspace this projection was scoped to. */
  workspace: string
  /** The team's display name, or an explicit placeholder when the record carries none. */
  teamName: string
  /** The team phase, or an explicit placeholder. */
  phase: string
  /** Tasks completed, as the host's own counts report them. */
  completed: number
  /** Tasks in any state, as the host's own counts report them. */
  total: number
  /** The roster size. */
  members: number
  /** Bounded notes about what could not be read or had to be cut. */
  problems: readonly string[]
}

/**
 * Project a `TeamWorkflow` onto this page's own shape.
 *
 * ONE projection, so the drawing, the header, the badge and the detail body cannot disagree about a
 * task. Every field is read defensively through the sanitizers: the workflow came from a FILE, and a
 * hand-edited record must cost a field, never the page.
 * @param workflow - the team projection, when it is readable.
 * @returns the page's projection, or undefined when there is no team to draw.
 */
export function dagPageOf(workflow: TeamWorkflow | undefined): DagPage | undefined {
  // The projection is the ONE place the page touches the record, so the arrays are proved here rather
  // than trusted: `team-state.ts` always builds them, but this function is also called from tests and
  // from any future reader, and a non-array must cost the drawing instead of a `TypeError`.
  if (workflow === undefined || !Array.isArray(workflow.tasks) || workflow.tasks.length === 0) return undefined
  /** The tasks, projected once. */
  const tasks: DagPanelTask[] = []
  for (const task of workflow.tasks) {
    /** The task's sanitized id; a row with no readable id cannot be focused or clicked. */
    const id = panelField(task.id, 40)
    if (id === undefined || id === "") continue
    tasks.push({
      id,
      subject: panelField(task.subject, 200) ?? "",
      ...(task.description === undefined ? {} : { description: panelField(task.description, 400) ?? "" }),
      ...(task.kind === undefined ? {} : { kind: panelField(task.kind, 20) ?? "" }),
      visual: panelField(task.visual, 20) ?? "open",
      ...(task.assignee === undefined ? {} : { assignee: panelField(task.assignee, 60) ?? "" }),
      dependencies: (Array.isArray(task.dependencies) ? task.dependencies : []).map((dep) => panelField(dep, 40) ?? "").filter((dep) => dep !== ""),
      depth: typeof task.depth === "number" && Number.isFinite(task.depth) ? Math.max(0, Math.floor(task.depth)) : 0,
      ...(typeof task.attempt === "number" && Number.isFinite(task.attempt) ? { attempt: Math.floor(task.attempt) } : {}),
      failedDependencies: (Array.isArray(task.failedDependencies) ? task.failedDependencies : []).map((dep) => panelField(dep, 40) ?? "").filter((dep) => dep !== ""),
      ...(typeof task.round === "number" && Number.isFinite(task.round) ? { round: Math.floor(task.round) } : {}),
      ...(task.verdict === undefined ? {} : { verdict: panelField(task.verdict, 60) ?? "" }),
    })
  }
  if (tasks.length === 0) return undefined
  return {
    tasks,
    workspace: panelField(workflow.workspace, 200) ?? "",
    teamName: panelField(workflow.team?.name, 60) ?? "(unnamed team)",
    phase: panelField(workflow.team?.phase, 20) ?? "unknown",
    completed: typeof workflow.counts?.completed === "number" ? workflow.counts.completed : 0,
    total: typeof workflow.counts?.total === "number" ? workflow.counts.total : tasks.length,
    members: Array.isArray(workflow.members) ? workflow.members.length : 0,
    problems: (Array.isArray(workflow.problems) ? workflow.problems : []).map((problem) => panelField(problem, 120) ?? "").filter((problem) => problem !== ""),
  }
}

/** One laid-out page: the drawing, the mode it chose, and whether every row fits the budget. */
export interface DagPanelLayout {
  /** The drawing, in the graph module's own vocabulary. */
  view: GraphView
  /** Which view was drawn, and therefore why it looks the way it does. */
  mode: "boxes" | "rail" | "list"
  /** Whether the drawing was chosen from `layoutList` — the dense fallback. */
  list: boolean
  /** Whether the drawing's ranks were DERIVED from `dependencies` rather than taken from the record's
   * served `depth` (frozen clause R18). Reported so a flat-looking rank order is never silent. */
  ranksDerived: boolean
  /** Blocker references that name no task on the board, sorted — the silent data loss R18 is about. */
  unresolved: string[]
}

/**
 * The two derived facts the layout carries, read DEFENSIVELY (frozen clause R18).
 *
 * `ranksDerived`/`unresolved` were added to the drawing's own `GraphView` after this page was written,
 * and the drawing module is another lane's file while these lines are written. Reading them through
 * one guarded helper means a page can never throw on a `GraphView` that predates them: an ABSENT field
 * reads as "nothing to report", which draws no line rather than a wrong one.
 * @param view - the drawing.
 * @returns the facts, both defaulted.
 */
function viewFacts(view: { ranksDerived?: unknown; unresolved?: unknown }): { ranksDerived: boolean; unresolved: string[] } {
  return {
    ranksDerived: view.ranksDerived === true,
    unresolved: Array.isArray(view.unresolved) ? view.unresolved.filter((id): id is string => typeof id === "string") : [],
  }
}

/** The row budget below which a rail stops being readable and the dense list takes over. */
const LIST_ROWS = 24


/**
 * Lay the board out for the measured panel.
 *
 * THE MODE IS A FACT ABOUT THE GEOMETRY, never a guess about the terminal — but the geometry it is a
 * fact about is now the CONTENT (frozen clause T1). This page used to predict the drawing module's
 * fit-width formula (`boxGrid`, a second rank derivation) and to gate on a hand-rolled `widestLabel`
 * that recomposed the label itself. Both are GONE: natural width means the box is sized by the labels
 * it must carry, so the panel no longer has to guess whether they fit, and a second label composer is
 * exactly the drift clause C2 forbids.
 *
 * THE LADDER, in order:
 *   1. `layoutBoxesNatural` — the DRAWING at its own width, which may be wider than this panel. The
 *      page windows it and pans (R8: the horizontal axis belongs to the drawing), so narrowness is no
 *      longer a reason to refuse a box;
 *   2. `layoutList` — the rank-grouped table with progress bars — takes over a BUSY board, the case it
 *      was written for;
 *   3. `layoutRail` — the forest, for everything else.
 *
 * `labelOverflow` is what still refuses a box, and it is the ONLY refusal left: the drawing reports
 * when the natural width cap held a box below the widest label, and this page then falls back rather
 * than break its own promise that a boxed label is never cut. It is a REPORTED fact from the layout instead
 * of a prediction, which is why the fallback cannot disagree with what was drawn.
 * @param tasks - the board to draw.
 * @param cols - the cells the panel measured; the VIEWPORT, never the drawing's width.
 * @param focus - the task to light, with its dependency chain.
 * @param rows - the rows the panel can show, which buys the roomy box form when there is room.
 * @returns the drawing and the mode that produced it.
 */
export function dagPanelLayout(tasks: readonly DagPanelTask[], cols: number, focus?: string, rows?: number): DagPanelLayout {
  /** The usable viewport width; a nonsense width still has to produce something drawable. */
  const width = Math.max(8, Math.floor(Number.isFinite(cols) ? cols : 8))
  /** The boxed DAG at its natural width, absent when the board refuses to be drawn as boxes. */
  const boxes = layoutBoxesNatural(tasks, focus, rows === undefined ? undefined : { rows })
  if (boxes !== undefined && boxes.labelOverflow !== true) return { view: boxes, mode: "boxes", list: false, ...viewFacts(boxes) }
  if (tasks.length > LIST_ROWS) {
    /** The dense table, for a board with more rows than a rail can show legibly. */
    const dense = layoutList(tasks, width, focus)
    return { view: dense, mode: "list", list: true, ...viewFacts(dense) }
  }
  /** The forest, for a board a box cannot hold. */
  const rail = layoutRail(tasks, width, focus)
  return { view: rail, mode: "rail", list: false, ...viewFacts(rail) }
}

/**
 * The badge this page derives from its own projection (frozen clause R9).
 *
 * The ladder is the drawing's own vocabulary: a FAILED task is `error` (work stopped and needs a
 * person), a task waiting on an unfinished blocker is `warning`, and a running board is `info` so the
 * panel is findable. A board with nothing to report returns `null`, which CLEARS the badge — a stale
 * badge is worse than no badge.
 * @param tasks - the projected board.
 * @returns the badge, or null when there is nothing to report.
 */
export function dagBadge(tasks: readonly DagPanelTask[]): PanelBadge | null {
  /** How many tasks the badge counts. */
  let unread = 0
  /** Whether a failed task was seen, which outranks every other level. */
  let failed = false
  /** Whether a blocked task was seen. */
  let blocked = false
  /** Whether a task is running, which is worth a quiet badge. */
  let running = false
  for (const task of tasks) {
    if (task.visual === "failed") {
      failed = true
      unread += 1
      continue
    }
    if (task.visual === "blocked") {
      blocked = true
      unread += 1
      continue
    }
    if (task.visual === "running") running = true
  }
  if (failed) return { level: "error", unread }
  if (blocked) return { level: "warning", unread }
  if (running) return { level: "info", unread: 0 }
  return null
}

/**
 * The pinned detail body's rows (frozen clause R11).
 *
 * EVERY one of the ten facts is printed, and a fact the record does not carry prints as `—` rather
 * than disappearing: a detail body that omitted a line would read as "this task has no verdict"
 * when the truth is that the RECORD's reader never had one, and the difference matters to whoever is
 * looking at a stuck board.
 * @param task - the pinned task.
 * @param tasks - the whole board, so `dependents` can be resolved.
 * @param cols - the cells available.
 * @returns the rows, in print order, each inside `cols`.
 */
export function pinnedDetailLines(task: DagPanelTask, tasks: readonly DagPanelTask[], cols: number): string[] {
  /** The tasks that depend on this one, i.e. what pinning it would unblock. */
  const dependents = tasks.filter((other) => other.dependencies.includes(task.id)).map((other) => other.id)
  /** The facts, in a fixed order so the body does not reshuffle between renders. */
  const facts: Array<[string, string]> = [
    // THE ORIGINAL TEXT COMES FIRST, AND IT IS THE POINT OF THE BODY (frozen clause C3): the drawing is
    // CJK-free, this is not, and a reader who pinned a task wants the task's own words before its
    // bookkeeping. `subject` and `description` are passed through VERBATIM — `panelText` sanitizes
    // control characters and clamps CELLS, and touches no language.
    //
    // WITHOUT THESE TWO LINES THE CLAUSE COULD NOT BE WITNESSED AT ALL: the body used to print ten
    // metadata facts and neither original field, so a real-PTY pin walk read `detailKept=0` on a board
    // whose detail body was in fact correct — an evidence failure hiding a satisfied clause, and worse,
    // hiding an UNSATISFIED half of it, since the description had nowhere to appear.
    ["subject", task.subject === "" ? "—" : task.subject],
    ...(task.description === undefined || task.description === "" ? [] : [["description", task.description] as [string, string]]),
    ["id", task.id],
    ["kind", task.kind ?? "—"],
    ["visual", task.visual],
    ["verdict", task.verdict ?? "—"],
    ["failedBy", task.failedDependencies.length === 0 ? "—" : task.failedDependencies.join(",")],
    ["owner", task.assignee ?? "—"],
    ["attempt", task.attempt === undefined ? "—" : String(task.attempt)],
    ["round", task.round === undefined ? "—" : String(task.round)],
    ["blockedBy", task.dependencies.length === 0 ? "—" : task.dependencies.join(",")],
    ["dependents", dependents.length === 0 ? "—" : dependents.join(",")],
  ]
  return facts.map(([label, value]) => panelText(`${label} ${value}`, cols))
}

/** What a key press asked this page to do. */
export interface DagPanelKeyAction {
  /** The task to focus next, or undefined when this page does not move the focus. */
  focus?: string
  /** Whether the press pinned a task (`true`), unpinned it (`false`) or left the pin alone. */
  pin?: boolean
  /** Whether the page consumed the press (the host's own fallback must then stand down). */
  consumed: boolean
}

/**
 * The keymap, as a pure function of the event and the drawing.
 *
 * Pure so the whole interaction contract is assertable without a host or a reconciler: `↑`/`k` and
 * `↓`/`j` move the focus through the tasks IN DRAWING ORDER (which is the order the rows are on
 * screen, so a press moves one row), `Enter`/space pins the focused task, and `Esc` unpins. An
 * unhandled key returns `consumed: false`, which is what leaves the host's own `←`/`→`/`Esc` panel
 * navigation working.
 * @param event - the narrowed host key event, or undefined for a value that was not a key event.
 * @param order - the task ids in DRAWING order.
 * @param focus - the task focused right now, when there is one.
 * @returns the action the page must apply.
 */
export function dagPanelKeyAction(event: ReturnType<typeof panelKeyEvent>, order: readonly string[], focus: string | undefined): DagPanelKeyAction {
  if (event === undefined) return { consumed: false }
  /** The host's key flags, when this event carried any. */
  const flags = event.key ?? {}
  /** The user's own key, with the host's two Enter spellings normalised to one. */
  const input = event.input
  /** Whether this press moves the focus one task LATER in drawing order. */
  const forward = flags.downArrow === true || input === "j" || input === "J"
  /** Whether this press moves the focus one task EARLIER in drawing order. */
  const backward = flags.upArrow === true || input === "k" || input === "K"
  if (!forward && !backward) {
    /** Whether this press is Enter, in either of the host's two spellings. */
    const enter = flags.return_ === true || flags.return === true || input === "\r" || input === "\n"
    // SPACE IS THE OTHER PIN KEY the host's contract names (its own panels accept `input === " "`).
    if (enter || input === " ") return { consumed: true, ...(focus === undefined ? {} : { pin: true }) }
    if (flags.escape === true || input === "\u001b") return { consumed: true, pin: false }
    return { consumed: false }
  }
  if (order.length === 0) return { consumed: true }
  /** Where the focus sits now, or -1 when nothing is focused. */
  const at = focus === undefined ? -1 : order.indexOf(focus)
  // NOTHING FOCUSED: the first press enters the drawing from the end it is travelling towards, so a
  // `↓` focuses the first task and a `↑` the last — the same rule the full-screen scene's own arrow
  // handling applies, and the one a user expects from a list.
  // WRAPPING: a focus that cannot move past the ends would make the last task unreachable from above.
  const next = at < 0 ? (forward ? 0 : order.length - 1) : (at + (forward ? 1 : -1) + order.length) % order.length
  return { consumed: true, focus: order[next] }
}

/** The row budget a page assumes when the host reports no height at all. */
const DAG_FALLBACK_ROWS = 24

/**
 * Scroll the viewport the least amount that puts one row inside it.
 *
 * The focus invariant, expressed as arithmetic rather than as a heuristic: a row above the window moves
 * the offset UP to it, a row below moves the offset DOWN until the row is its last visible line, and a
 * row already inside changes nothing (scrolling a page that already shows the focus would be motion the
 * user did not ask for).
 * @param viewport - this render's viewport (its `scrollTo` clamps).
 * @param row - the row to bring into view.
 */
function scrollRowIntoView(viewport: { offset: number; viewportRows: number; max: number; scrollTo: (next: number) => void }, row: number): void {
  if (row < viewport.offset) {
    viewport.scrollTo(row)
    return
  }
  if (row >= viewport.offset + viewport.viewportRows) {
    // THE PUSH IS CLAMPED TO THE BAND, and that clamp is the whole point: `row - viewportRows + 1` is
    // the largest offset that still shows the row, but it is only reachable while the content has a
    // full page below it. On the LAST page of a board it asks for an offset the page cannot honour, and
    // the reader is left one window short of the very row the walk just focused — measured on this
    // suite: a 40-task walk focused `B40` at the last row and asked for exactly that offset, which
    // showed every row EXCEPT `B40`. `max` is the band's own furthest offset, so the correction comes
    // from the one place that defines it rather than from arithmetic re-derived here.
    viewport.scrollTo(Math.min(row - viewport.viewportRows + 1, viewport.max))
  }
}

/** One rendered fact about the board: the label, the value and how the value is drawn. */
interface HeaderFact {
  /** The label drawn before the value. */
  label: string
  /** The value itself. */
  value: string
  /** The tone the value draws in. */
  tone: string
}

/**
 * The header row's own facts: what team this is, how far it got, and how big it is.
 *
 * A bar is drawn from `DAG_CHROME`'s two cells so progress reads at a glance without counting, and the
 * bar is measured in CELLS: it is built for the width the row has left after its labels.
 * @param page - the projection.
 * @param cols - the cells the header row may use.
 * @returns the header's facts and its progress bar, each already clamped.
 */
function headerFacts(page: DagPage, cols: number): { facts: HeaderFact[]; bar: string } {
  /** The total the bar is measured against; a record with no counts falls back to the task list. */
  const total = Math.max(1, page.total)
  /** How many cells the bar may occupy; small on a narrow panel, never zero when there is room. */
  const barCells = Math.max(0, Math.min(16, cols - 44))
  /** The filled cells, rounded so the bar moves once per whole cell rather than per fraction. */
  const filled = Math.min(barCells, Math.round((Math.max(0, page.completed) / total) * barCells))
  return {
    facts: [
      { label: "team", value: page.teamName, tone: "chain" },
      { label: "phase", value: page.phase, tone: "dim" },
      { label: "tasks", value: `${page.completed}/${page.total}`, tone: "completed" },
      { label: "members", value: String(page.members), tone: "chain" },
    ],
    bar: DAG_CHROME.barFull.repeat(filled) + DAG_CHROME.barEmpty.repeat(Math.max(0, barCells - filled)),
  }
}

/** The task one pointer event on a drawing row resolved to, and the rule that resolved it. */
export interface DagRowClick {
  /** The task under the pointer, or absent when the pointer resolved to no task at all. */
  taskId?: string
  /**
   * True when the COLUMN-aware rectangle decided this, false when the row band did.
   *
   * The distinction is the caller's, and it is the whole of AC4: a column-aware miss means the pointer
   * was over blank space and the pin must be CLEARED, while a band miss means the host delivered no
   * position to be sure about. Both carry no `taskId`; only one of them is a decision.
   */
  byColumn: boolean
}

/**
 * Resolve a pointer event on one drawing row to a task (frozen clause AC4).
 *
 * THE ROW BAND IS NOT ENOUGH, and that defect is the wave's own: every box of a rank shares one row
 * band, so a row-only predicate always lands on the LEFTMOST box of that rank — which the natural
 * width routinely pans out of view. `graph.ts` already computes one rectangle per box and exports
 * `hitTest` for exactly this lookup, so the fix is a call and not a second layout.
 * @param view - the drawing the row belongs to.
 * @param row - the ROW'S OWN drawing index (the loop variable of the drawing), never a page row and
 *   never arithmetic on the event.
 * @param colOffset - the page's horizontal pan in cells, added to the pointer's own column.
 * @param event - the host's pointer event, when the host delivered one.
 * @returns the task under the pointer and which rule found it; `taskId` is absent when this row
 *   resolved to no task.
 */
export function dagRowClick(view: GraphView, row: number, colOffset: number, event: unknown): DagRowClick {
  /** The pointer's own column inside this row, when the host delivered a usable one. */
  const localCol = pointerCol(event)
  if (localCol !== undefined) {
    /** The pointer's column in the DRAWING's own coordinates: the same pan the rows were cut with. */
    const col = (Number.isFinite(colOffset) ? Math.max(0, Math.floor(colOffset)) : 0) + localCol
    /** The task whose rectangle holds the pointer. */
    const taskId = hitTest(view, row, col)
    return { ...(taskId === undefined ? {} : { taskId }), byColumn: true }
  }
  // NO USABLE COORDINATES: the row-band resolution this page used before the column existed, kept so a
  // host that delivers a click without a position still pins rather than doing nothing at all.
  /** The rectangle whose row band holds this row, in the drawing's own order. */
  const band = view.hits.find((candidate) => row >= candidate.row && row <= candidate.rowEnd)
  return { ...(band === undefined ? {} : { taskId: band.taskId }), byColumn: false }
}

/**
 * The pointer's column inside the row it landed on.
 *
 * The host recomputes `localCol` per handler from the row element's own rect, so this is a position
 * INSIDE the row that was clicked rather than a screen coordinate — which is why the page never has to
 * know where the panel is on screen.
 * @param event - the host's pointer event, when the host delivered one.
 * @returns the column in cells, or undefined when this event carries none this page can trust.
 */
function pointerCol(event: unknown): number | undefined {
  if (event === null || typeof event !== "object") return undefined
  /** The event's own `localCol`, before it is trusted. */
  const col = (event as { localCol?: unknown }).localCol
  if (typeof col !== "number" || !Number.isFinite(col) || col < 0) return undefined
  return Math.floor(col)
}

/** The characters that make a name part of a LONGER word, so a whole-name match cannot be a substring. */
const NAME_CHAR = /[a-z0-9_]/u

/**
 * Fold a name for comparison: lower-case, whitespace runs collapsed, both ends trimmed.
 * @param value - the raw name, when the record carried one.
 * @returns the folded name, or "" when there is nothing to compare.
 */
function foldName(value: string | undefined): string {
  return typeof value === "string" ? value.toLowerCase().replace(/\s+/gu, " ").trim() : ""
}

/**
 * Whether one folded name appears in a folded description as a WHOLE name.
 *
 * The boundary test keeps a name from matching in the MIDDLE of a longer word, which is the accident a
 * plain `includes` would make routine. **Honest bound**: a name that is a whole WORD of a longer name
 * still matches (`Engineer` inside `Panel Engineer`), which is the tolerance a caller wants when a
 * record names a role rather than a member; {@link agentIdForOwner} prefers an EXACT match over this one.
 * @param description - the folded description to search.
 * @param name - the folded name to find.
 * @returns true when the name appears delimited by non-name characters.
 */
function nameInside(description: string, name: string): boolean {
  /** Where the next search starts, so every occurrence is tried rather than only the first. */
  let from = 0
  for (;;) {
    /** This occurrence's index, or -1 when none is left. */
    const at = description.indexOf(name, from)
    if (at < 0) return false
    /** The character before it, "" at the start of the description. */
    const before = description.slice(Math.max(0, at - 1), at)
    /** The character after it, "" at the end. */
    const after = description.slice(at + name.length, at + name.length + 1)
    if (!NAME_CHAR.test(before) && !NAME_CHAR.test(after)) return true
    from = at + 1
  }
}

/**
 * The live subagent id behind a task's owner name (frozen clause AC6).
 *
 * THE HOST'S OWN CURATED ROWS ARE THE ONLY SOURCE: `snapshot().subagents` lists the subagents this
 * session really started, each carrying an `agentId` and a `description`, and a team record's owner is
 * the NAME the captain addressed that member by — which is the name the description carries. Nothing
 * here invents an id and nothing reads a second source, so a task whose owner the host does not report
 * resolves to undefined and the caller SAYS SO rather than opening an unrelated page.
 * @param snapshot - the host's snapshot (`host.snapshot()`), of unknown shape.
 * @param owner - the task's owner name, when the record carried one.
 * @returns the matching row's `agentId`, or undefined when no row matches.
 */
export function agentIdForOwner(snapshot: unknown, owner: string | undefined): string | undefined {
  /** The owner name, folded for a comparison that ignores case and runs of whitespace. */
  const wanted = foldName(owner)
  if (wanted === "") return undefined
  try {
    /** The host's own subagent rows, when this composition projects them at all. */
    const raw = (snapshot as { subagents?: unknown } | undefined)?.subagents
    if (!Array.isArray(raw)) return undefined
    /** The first row that matched by CONTAINMENT, kept in case no row matches by equality. */
    let contained: string | undefined
    for (const entry of raw) {
      if (entry === null || typeof entry !== "object") continue
      /** This entry as a record; both fields stay unknown until they are narrowed. */
      const row = entry as { agentId?: unknown; description?: unknown }
      /** The id this row can be opened by; a row without one is not a target. */
      const agentId = typeof row.agentId === "string" && row.agentId !== "" ? row.agentId : undefined
      if (agentId === undefined) continue
      /** The row's own description, folded the same way as the name. */
      const description = foldName(typeof row.description === "string" ? row.description : undefined)
      if (description === "") continue
      if (description === wanted) return agentId
      if (contained === undefined && nameInside(description, wanted)) contained = agentId
    }
    return contained
  } catch {
    // A hostile snapshot (a throwing getter, a proxy) resolves to NO id, and the caller reports that
    // through the host's toast: the alternative is a click that throws inside the host's reconciler.
    return undefined
  }
}

/**
 * Show one transient line through the host's own chrome — AC6's "never a silent no-op".
 * @param host - the host API, when the page was handed one.
 * @param message - the line to show; a host that exposes no `toast` simply does not show it.
 */
function hostToast(host: unknown, message: string): void {
  if (host === null || host === undefined) return
  /** The host API, before its `toast` member is trusted. */
  const api = host as { toast?: unknown }
  if (typeof api.toast !== "function") return
  try {
    // Called AS A METHOD on the host's own object, the documented form and the one that cannot lose a
    // receiver the implementation may rely on (the same rule `panelSnapshot` follows).
    ;(api as { toast: (text: string) => unknown }).toast(message)
  } catch {
    // A host that refuses the line costs the HINT, never the click: the page still did the one thing it
    // could do, and a throw here would land inside the host's reconciler.
  }
}

/**
 * Open one task's owner work page, and say so through the host when no page can be reached (AC6).
 *
 * The order is the contract's own: the pin is held (the user has already seen the detail body), the
 * owner resolves through {@link agentIdForOwner} against a snapshot read AT CLICK TIME — a render may
 * be many seconds old by now — and a refusal from the row's opener is as loud as a missing one.
 * @param host - the host API, for its `toast`.
 * @param task - the task whose owner the second click asked for.
 * @param options - the page's own deps.
 */
function openAgentWorkPage(host: unknown, task: DagPanelTask | undefined, options: DagPageOptions | undefined): void {
  /** The owner name the task carries; a task without one has no page to open. */
  const owner = task?.assignee
  /** The live subagent id the owner name resolves to, when the host reports one. */
  const agentId = agentIdForOwner(panelSnapshot(host), owner)
  if (agentId === undefined) {
    hostToast(host, owner === undefined || owner === "" ? `no owner on ${task?.id ?? "that task"} — no agent page` : `no subagent page matches ${owner}`)
    return
  }
  /** Whether the row's opener reached a page; an absent opener is a refusal, never a silent success. */
  const reached = options?.openAgentPage?.(agentId) === true
  if (!reached) hostToast(host, `no agent page for ${agentId}`)
}

/** What the DAG page needs from the plugin row, beyond its reader. */
export interface DagPageOptions {
  /** Opens the agent work page for a live subagent id; false when no page was reached. */
  openAgentPage?: (agentId: string) => boolean
  /**
   * Opens this page's full-screen scene; absent when the row has no such surface to offer.
   *
   * The `⤢` control in the page's title row calls THIS, exactly as the merged page's and the workmate
   * page's controls call their own row's opener: the button and the page's declared fallback must name
   * one surface, never two.
   */
  openFullscreen?: () => boolean
}

/**
 * Build the DAG page component.
 * @param readWorkflow - reads the MPD team projection for this session's workspace; the wiring passes
 *   the same reader the merged panel and the scenes use, so no two surfaces can describe one team
 *   differently. It is injected (rather than imported) so this file stays free of the row module.
 * @param options - the row's own deps for this page; omitted by every caller that has no agent page to
 *   open, which is why the parameter is optional and why the second click then says so through a toast.
 * @returns a component matching the host's panel props contract.
 */
export function createDagPanelComponent(readWorkflow: () => TeamWorkflow | undefined, options?: DagPageOptions): unknown {
  return function MpdTuiDagPanel(props: PanelPropsLike): unknown {
    /** The host's React instance and ui kit, proved usable before a single hook is called. */
    const kit = panelKit(props?.React, props?.ui)
    if (kit === undefined) {
      // THE ONE EARLY EXIT, and it happens BEFORE any hook: a host that hands no usable React or ui kit
      // renders nothing rather than crash the reconciler. Because the kit is proved first, the number
      // of hook calls below is invariant across renders on a given host — the hook order cannot move.
      return null
    }
    /** The panel's measured geometry; the single geometry hook call of this component. */
    const measured = usePanelSize(kit.ui, panelFloorColumns("dag"))
    /** The cells this page may DRAW IN: the reported width minus the frame's own two border cells. */
    const contentCols = panelContentWidth(measured.cols)
    /** The page's projection for this workspace, read PER RENDER (the panel must never freeze). */
    let page: DagPage | undefined
    try {
      page = dagPageOf(readWorkflow())
    } catch {
      // An unreadable record costs the drawing, never the page: the empty state says why below.
      page = undefined
    }
    /** The host's curated snapshot, read for the same reachability proof every page performs: an
     * unreadable host state must cost nothing here, and the read is contained by `panelSnapshot`. */
    panelSnapshot(props?.host)
    /** Whether the panel may receive keys right now. */
    const keysArmed = panelKeysArmed(props?.focused, props?.visible, props?.host)
    /** The pin, as one state cell: the task id the user pinned, or undefined. */
    const focused = kit.React.useState(undefined)
    /** The task the keyboard has reached, which is a DIFFERENT thing from the click pin. */
    const cursor = kit.React.useState(undefined)
    /** The pinned task id, when the state cell holds one. */
    const pinned = typeof focused[0] === "string" ? (focused[0] as string) : undefined
    /** Moves the click pin. */
    const setPinned = focused[1] as (next: unknown) => void
    // THE PIN NEEDS THE SAME LIVE AUTHORITY THE CURSOR HAS, and for AC6 specifically: "clicking the
    // ALREADY-pinned task opens its owner's page" is decided AGAINST the pin, and a handler born in an
    // earlier render reads the pin of THAT render — so a second click arriving before the host
    // re-rendered would re-pin the same task instead of opening the page it asked for. The ref is what
    // the next click reads; the state cell stays the host's reason to re-render.
    const pinLive = kit.React.useRef(undefined)
    /** The pinned task id as the NEXT click must see it: what this turn has already pinned. */
    const pinnedNow = (): string | undefined => (typeof pinLive?.current === "string" ? (pinLive.current as string) : pinned)
    /** Record the click pin in BOTH places, in the order the two authorities need. */
    const movePin = (next: string | undefined): void => {
      if (pinLive !== null && pinLive !== undefined) pinLive.current = next
      setPinned(next)
    }
    /** The focused task id, when the state cell holds one. */
    const cursorId = typeof cursor[0] === "string" ? (cursor[0] as string) : undefined
    /** Moves the keyboard cursor. */
    const setCursor = cursor[1] as (next: unknown) => void
    // THE CURSOR NEEDS A LIVE AUTHORITY, exactly as the scroll offset does. A state cell alone is read
    // from the RENDER a handler was born in, so a run of `↓` presses delivered in one event-loop turn
    // each starts from the same unfocused value: the walk focuses the FIRST task forty times and never
    // reaches the last one — measured as the frozen suite's own FOCUS AUTO-SCROLL defect, where the
    // window never moved because the focus it followed never moved. The ref is the authority the next
    // press reads from; the state cell stays the host's reason to re-render.
    const cursorLive = kit.React.useRef(undefined)
    /** The focused task id as the NEXT press must see it: what this turn has already asked for. */
    const cursorNow = (): string | undefined => (typeof cursorLive?.current === "string" ? (cursorLive.current as string) : cursorId)
    /** Record the keyboard cursor in BOTH places, in the order the two authorities need. */
    const moveCursor = (next: string | undefined): void => {
      if (cursorLive !== null && cursorLive !== undefined) cursorLive.current = next
      setCursor(next)
    }
    /** The task the drawing lights: the CLICK PIN outranks the keyboard cursor while it exists. */
    const focus = pinnedNow() ?? cursorNow()
    /** The window height this panel affords, from the height the host reported (its title row and footer
     * are drawn OUTSIDE the window, which is why they are subtracted here). */
    const windowRows = Math.max(1, (measured.rows ?? DAG_FALLBACK_ROWS) - PANEL_CHROME_ROWS - PANEL_TITLE_ROW_ROWS)
    // THE LAYOUT IS TOLD THE ROWS, so the drawing can choose the roomy five-row box when the panel has
    // the room for it and the compressed three-row one when it does not — one decision per drawing, made
    // before any box is placed, which is what keeps two boxes in one rank from having different heights.
    // THE SIZES OBJECT IS THE PAGE'S ONE LIVE MUTABLE FACT SET, and it must EXIST before the layout
    // because the layout's decisions (mode, box form, `labelOverflow`) are it. The row counts are filled
    // in after the rows are built, exactly as before; the DRAWING's column count is known right here.
    /** The sizes the hook and every later closure read; written by this render, before anything reads it. */
    const sizes: { contentRows: number; viewportRows: number; contentCols?: number; viewportCols?: number } = { contentRows: 1, viewportRows: 1, contentCols: contentCols, viewportCols: contentCols }
    /** The drawing for this render, at the natural width and for the height THIS panel measured. */
    const layout = page === undefined ? undefined : dagPanelLayout(page.tasks, contentCols, focus, windowRows)
    // THE DRAWING'S OWN WIDTH, once it has been laid out: what the window may pan across. It is the
    // DRAWING's width and not the panel's (captain's ruling R8) — the purpose, said once: the pan exists
    // so the WHOLE DAG can be seen, and it is not a page-level scrolling mode. Every other row of the page
    // stays at the panel's full width and never moves sideways.
    sizes.contentCols = layout?.view.width ?? contentCols
    // THE PAGE OWNS A TICK. Nothing else re-renders a sidebar panel, so a page that reads its state per
    // render would otherwise show whatever was true when the user opened it.
    usePanelTick(kit, DAG_PANEL_REFRESH_MS, true)
    // THE ANIMATION IS THE HOST'S, NEVER OURS (R8): the phase comes from the panel's only legal timer
    // and degrades to the static frame when the host offers none.
    const animate = layout !== undefined && layout.view.lines.some((row) => row.some((span) => span.tone === "running"))
    /** The breathing frame for this render: the host's timer quantised, or the static frame when absent. */
    const phase = useRunningPhase(kit.ui, animate)
    /** The badge this render derived; published below through the host's own API (R9). */
    const badge = page === undefined ? null : dagBadge(page.tasks)
    /** The last badge published, so the host's badge listener fires on a CHANGE rather than per render. */
    const published = kit.React.useRef(null)
    kit.React.useEffect(() => {
      publishBadge(props?.host, badge, published as { current: PanelBadge | null })
    }, [badge === null ? "none" : `${badge.level}:${badge.unread}`, props?.host])

    /** The task ids in DRAWING order, which is the order the keyboard walks. */
    const order: string[] = layout === undefined ? [] : layout.view.hits.map((hit) => hit.taskId)
    /** The row each drawn TODO is added at, so focus auto-scroll can find it without re-deriving it. */
    const rowIndex = new Map<string, number>()
    /** Register the keymap; the handler closes over the CURRENT drawing, so it cannot act on a stale one. */
    usePanelKeys(kit, props?.host, keysArmed, (event: unknown): void => {
      /** The press, narrowed. */
      const bare = panelKeyEvent(event)
      // THE VIEWPORT KEYS FIRST. They are the ones with no other meaning in a panel, so they can never
      // steal a key the task focus needs — and a page that scrolled instead of moving focus on `↑` would
      // be a worse bug than no scrolling at all.
      /** The scroll gesture this press asked for, if any, on EITHER axis. */
      const gesture = panelScrollGesture(bare)
      if (gesture !== undefined) {
        if (bare?.preventDefault !== undefined) bare.preventDefault()
        if (gesture === "top") viewport.scrollTo(0)
        else if (gesture === "bottom") viewport.scrollTo(Number.MAX_SAFE_INTEGER)
        else if (gesture === "pageUp" || gesture === "pageDown") viewport.scrollBy((gesture === "pageUp" ? -1 : 1) * viewport.viewportRows)
        // THE HORIZONTAL AXIS (clause T5). `⇧←→` and `⇧PgUp/PgDn` move the DRAWING's window; the bare
        // arrows stay UNCONSUMED on purpose, because `←/→` are the host's own panel navigation and this
        // page must not steal them (`dagPanelKeyAction` returns `consumed: false` for exactly that reason).
        else if (gesture === "colLeft" || gesture === "colUp") viewport.scrollColBy(-1)
        else if (gesture === "colRight" || gesture === "colDown") viewport.scrollColBy(1)
        else viewport.scrollColBy((gesture === "colPageUp" ? -1 : 1) * contentCols)
        // THE SCROLL POSITION IS PUBLISHED BEFORE THE HANDLER RETURNS, so a run of page-keys in one
        // event-loop turn accumulates against the position the previous press ASKED for. Without this the
        // handler re-reads the same stale render on every press and the page never moves — the measured
        // shape of the defect (a 1000-press walk that left the window where it started).
        return
      }
      /** What the focus keymap decided, walked from the position the LAST press left rather than from
       * this render's — the same one-generation rule the scroll keys above follow. */
      const action = dagPanelKeyAction(bare, order, cursorNow())
      if (!action.consumed) return
      if (bare?.preventDefault !== undefined) bare.preventDefault()
      if (action.focus !== undefined) {
        moveCursor(action.focus)
        // FOCUS MOVEMENT AUTO-SCROLLS (frozen requirement): the invariant is that the focused node can
        // never be outside the rendered window, so the two features cooperate instead of competing.
        /** The row the newly focused task draws on, when this drawing has one. */
        const at = rowIndex.get(action.focus)
        if (at !== undefined) scrollRowIntoView(viewport, at)
      }
      // A PIN OUTRANKS THE CURSOR while it exists, so pinning takes the same live value the walk just
      // moved to — pinning the RENDERED focus would pin the previous task on a fast walk.
      if (action.pin === true) movePin(cursorNow())
      if (action.pin === false) movePin(undefined)
    })

    /** The rows, in draw order. */
    const children: unknown[] = []
    // THE VIEWPORT IS CREATED AFTER THE ROWS ARE KNOWN, and it is created with the REAL content height.
    // The hook's declaration ORDER is the reason: a page that hands it a placeholder would make every
    // band, every gutter cell and every "is the focus in view?" test depend on a number that arrives one
    // render late — which is how a scroller ends up disagreeing with its own scrollbar.
    /** The page's self-windowed viewport: ONE offset, clamped, that every gesture and key drives. */
    // THE PAGE'S LIVE SIZES, in one ref: the row count and the window height this render measured. The
    // hook's getters read them through `read()`, so a gesture arriving from an EARLIER render's closure is
    // clamped against the CURRENT page — one generation, never two.
    /** The sizes the hook and every later closure read; written by this render, before anything reads it. */
    /** The page's ONE scroll position: every key, wheel and click drives this handle, never a copy. */
    const viewport = usePanelViewport(kit, () => sizes)
    /** The header facts and the bar this width affords. */
    const header = page === undefined ? undefined : headerFacts(page, contentCols)
    if (header !== undefined) {
      /** The label/value spans of the header row, each in its own tone. */
      const spans: Array<{ text: string; tone: string }> = []
      for (const fact of header.facts) spans.push({ text: `${fact.label} `, tone: "dim" }, { text: `${fact.value}  `, tone: fact.tone })
      if (header.bar !== "") spans.push({ text: header.bar, tone: "completed" })
      children.push(graphRow(kit, spans.map((span) => ({ text: panelText(span.text, contentCols), tone: span.tone })), { key: "header", cols: contentCols }))
    } else {
      // THE EMPTY STATE NAMES THE CALL THAT FILLS IT (frozen clause R10): a panel that only said "no
      // data" would leave the reader with no idea which surface the DAG is fed from.
      children.push(textRow(kit, "no team in this workspace — `agent_teams_plan` stages one", { key: "empty", dim: true, maxCells: contentCols }))
    }
    if (layout !== undefined) {
      /** The contract's own running glyph, which the breath orbit starts from. */
      const baseGlyph = DAG_TONE_GLYPH.running ?? "◐"
      /** The animated glyph for this frame, or the base one when nothing is running. */
      const breathe = runningGlyph(phase)
      /** Whether the breath changes the glyph this render (it is static at the orbit's head). */
      const breathing = breathe !== baseGlyph
      for (let index = 0; index < layout.view.lines.length; index += 1) {
        // THE ROW IS RECORDED IN THE PAGE'S OWN COLUMN COORDINATES, not in the drawing's: the header and
        // the other chrome rows were pushed BEFORE this loop, so the drawing's line `index` sits at
        // `children.length` in the column the viewport windows. Storing the drawing's index instead put
        // every auto-scroll one row short of the node it was following — measured on the frozen suite as
        // a walk that focused the last task and then showed every row except it.
        /** The task this row belongs to, when the pointer could land on one. */
        for (const candidate of layout.view.hits) {
          if (index >= candidate.row && index <= candidate.rowEnd && !rowIndex.has(candidate.taskId)) rowIndex.set(candidate.taskId, children.length)
        }
        /** This row's spans. */
        const row = layout.view.lines[index]
        /** Whether the drawing marks this row as RUNNING, which is what animates. */
        const running = row.some((span) => span.tone === "running")
        // THE BREATH IS THE HOST'S TIMER APPLIED TO THE CONTRACT'S OWN GLYPH (R8). Only a row the
        // drawing marked `running` is touched, and only its FIRST occurrence of that glyph is
        // substituted, so the drawing's geometry and its other marks cannot move. With no timer (or
        // outside the orbit's head frame) the row is drawn exactly as `graph.ts` laid it out.
        /** The row's spans, with the running glyph advanced by the phase. */
        const phased = running && breathing
          ? row.map((span) => (span.text.includes(baseGlyph) ? { text: span.text.replace(baseGlyph, breathe), tone: span.tone } : span))
          : row
        // THE WINDOW (frozen clause T3): the drawing is at its NATURAL width and may be wider than this
        // panel, so every DAG row is cut to the columns the page's ONE viewport says are on screen. Only
        // the DAG's rows — see R8, which is why the legend, the detail body and the footer below are
        // pushed unwindowed.
        const spans = sliceSpans(phased, viewport.colOffset, contentCols)
        // THE TASK THIS ROW BELONGS TO IS NO LONGER RESOLVED HERE, and that is the fix: the row band
        // cannot tell two boxes of one rank apart. The handler below resolves the pointer THROUGH THE
        // DRAWING at click time, with this row's own index and the pointer's own column.
        //
        // EVERY DRAWING ROW CARRIES THE HANDLER, blank rows included: a pointer on blank space is what
        // CLEARS the pin (AC4), and a row with no handler could only ever be a silent no-op. The chrome
        // rows — header, mode line, detail body, legend, footer — are NOT drawing rows and carry none.
        children.push(
          graphRow(kit, spans, {
            key: `row-${index}`,
            cols: contentCols,
            onClick: (event: unknown): void => {
              /** The task this pointer resolved to, and which rule resolved it. */
              const resolved = dagRowClick(layout.view, index, viewport.colOffset, event)
              if (resolved.taskId === undefined) {
                // NOTHING UNDER THE POINTER: a column-aware miss on blank space, or a band miss on a row
                // that belongs to no box. Either way the pin is CLEARED rather than kept — the drawing
                // the user pointed at has nothing to pin.
                movePin(undefined)
                return
              }
              // THE PIN THE USER SEES IS THE PIN THIS DECIDES AGAINST (`focus` reads the same live value),
              // so a second click on the task that is ALREADY pinned opens its owner's work page instead
              // of re-pinning it (AC6). The pin itself is left alone: the chain stays lit behind the page.
              if (resolved.taskId === pinnedNow()) {
                openAgentWorkPage(props?.host, page?.tasks.find((task) => task.id === resolved.taskId), options)
                return
              }
              movePin(resolved.taskId)
              moveCursor(resolved.taskId)
            },
          }),
        )
      }
      // THE HORIZONTAL RAIL, DIRECTLY BENEATH THE DRAWING (R8) and driven by the SAME `colOffset` the
      // rows above were cut with — one position, one scroller, two views of it (clause T4). It is drawn
      // only while the drawing is wider than the panel, so a sidebar that fits keeps its rows.
      if (viewport.colOverflow) {
        // THE ELEMENT BELONGS TO THE CORE LANE (frozen cross-lane export `viewportRail`, plan §3 — the
        // draggable rail is its, not this page's). The call is written here as the contract freezes it;
        // the property read is the landing-order bridge and the page's own row is its ONE-LINE fallback,
        // drawn only while that export is missing (see the namespace import at the top of this file).
        /** The Core lane's rail builder, on a build of `panel-core.ts` that exports it. */
        const coreRail = core.viewportRail
        // DELETE THIS ONE ARM once Core's export is integrated for good: the replacement is
        // `coreRail(kit, viewport, contentCols)` and nothing else in this file changes with it.
        /** The rail to draw: Core's element when the export exists, this page's own row while it does not. */
        const rail = typeof coreRail === "function" ? coreRail(kit, viewport, contentCols) : textRow(kit, gutterCellsX(viewport.colOffset, sizes.contentCols ?? contentCols, contentCols), { key: "hrail", tone: "edge", maxCells: contentCols })
        if (rail !== undefined) children.push(rail)
      }
      // THE MODE LINE: which view was drawn AND WHERE ITS RANKS CAME FROM, said out loud — the view is
      // a fact about the width and the reader is the one who can change the width, while the rank
      // source is the fact that decides whether the vertical order can be trusted at all (R18).
      children.push(textRow(kit, `view ${layout.mode}${layout.list ? " (dense)" : ""} · ${order.length} tasks · ranks ${layout.ranksDerived ? "derived" : "served"}`, { key: "mode", dim: true, maxCells: contentCols }))
      // THE UNRESOLVED BLOCKERS ARE SURFACED, NEVER SWALLOWED (R18). A blocker reference naming no task
      // on the board is the exact shape of the user's own defect — the record says `blockedBy: ["3"]`
      // while its ids are `T3` — and a page that dropped it silently would make a broken board look
      // like a healthy one. The list is REPORTED beside the drawing, which is what the drawing cannot do.
      if (layout.unresolved.length > 0) {
        children.push(textRow(kit, `unresolved blockers: ${layout.unresolved.join(", ")}`, { key: "unresolved", tone: "warning", maxCells: contentCols }))
      }
      // THE CYCLE IS REPORTED, NEVER HIDDEN (R10): a drawing of a cyclic board silently loses an edge,
      // so the page says so in words the drawing cannot carry.
      if (layout.view.cycles.length > 0) {
        children.push(textRow(kit, `dependency cycle: ${layout.view.cycles.join(", ")}`, { key: "cycle", tone: "failed", maxCells: contentCols }))
      }
    }
    // THE PINNED DETAIL BODY (R11) sits under the drawing so the reader keeps the picture while reading
    // the facts. It carries all ten fields, `—` for the ones the record does not have.
    /** The pinned task, when the pin still names one of THIS drawing's tasks. */
    const pinnedTask = pinned === undefined ? undefined : page?.tasks.find((task) => task.id === pinned)
    if (pinnedTask !== undefined) {
      children.push(textRow(kit, `${DAG_CHROME.pinMarker} ${pinnedTask.id}`, { key: "pin-head", tone: "focus", bold: true, maxCells: contentCols }))
      for (const line of pinnedDetailLines(pinnedTask, page?.tasks ?? [], contentCols)) {
        children.push(textRow(kit, line, { key: `pin-${line.slice(0, 24)}`, dim: true, maxCells: contentCols }))
      }
    }
    // THE LEGEND (R6): the drawing's own arrow sentences, then the state key read out of the contract.
    /** The drawing module's own arrow/focus lines, for the width this panel measured. */
    let arrow: string[] = []
    try {
      arrow = legendLines(contentCols)
    } catch {
      arrow = []
    }
    for (const line of legendLinesFor(contentCols, arrow)) {
      children.push(textRow(kit, line, { key: `legend-${line.slice(0, 24)}`, dim: true, maxCells: contentCols }))
    }
    // ── THE SELF-WINDOWED BODY ──────────────────────────────────────────────
    // THE PAGE OWNS ITS WINDOW, and the host's `ScrollBox` is deliberately NOT used: its `ref` is
    // stripped from the panel kit, so a page can neither read its position nor command it — and a
    // truthful scrollbar cannot be drawn from a position the page cannot read (two scrollers whose
    // positions disagree is worse than one). So the header is pinned, the CONTENT scrolls through this
    // page's own single `offset`, and the footer is pinned; the gutter is reserved by
    // `panelViewportBody` from that same number.
    /** The page's content height, chrome included: the one number the offset is clamped against. */
    const contentRows = Math.max(children.length, 1)
    // THE BAND IS AREAD FROM THE HANDLE, not copied into a second object: the host installs a key listener
    // ONCE, so a handler closing over an earlier render's copy would scroll against that render's numbers.
    // One object, live getters, whichever closure is asking.
    // Publish this render's measurements, which is what every getter and every later closure clamps against.
    sizes.contentRows = contentRows
    sizes.viewportRows = windowRows
    /** The same handle, named for what it does here: the window this render draws. */
    const scroller = viewport
    // THE WHEEL IS BOUND TO THE WINDOW, not to each row: the host hit-tests the deepest node under the
    // pointer, so binding it once around the VISIBLE slice keeps ONE handler in the dispatch path. The
    // slice itself belongs to `panelViewportBody`, which is why the wrapper is passed TO it rather than
    // built here — wrapping the whole column and handing that back in made this page window TWICE (the
    // body then cut a one-element array at the row offset) and rendered an EMPTY panel whose footer still
    // read `6/82`. Measured exactly that way; one slice, one place.
    /** The wheel binding, applied by the body to the rows it is about to draw. */
    const wheelBound = (boundKit: PanelKit, rows: readonly unknown[]): unknown =>
      boundKit.React.createElement(boundKit.ui.Box, { key: "scroll", flexDirection: "column", onWheel: (event: unknown): void => scroller.onWheel(event) }, ...rows)
    // THE FOOTER HINTS (R6/R11): the keys this page handles, and the panel's own `⤢` full-screen control
    // — named here because this hint row is the only place a reader learns that control exists.
    //
    // THE `⤢` HINT LEADS THE ROW (AC8b, measured): the host clamps a row from its END, and at the
    // 28-column floor this page has 26 content cells while the key hints alone run past 40 — so a hint
    // that trailed them was the first thing cut, and the control was invisible exactly at the width
    // where a reader is most likely to want the full-screen escape. Leading with it costs the tail of
    // the key hints at the narrowest widths and nothing at all at every width where they fit.
    /** The pinned footer, carrying the scroll position so the reader can see where they are. */
    const footer = textRow(kit, `${PANEL_FULLSCREEN_GLYPH} fullscreen · ↑↓/jk move · Enter pin · Esc unpin · ⇧↑↓/⇧←→ scroll${scroller.overflow ? ` ${scroller.offset + 1}/${scroller.max + 1}` : ""}`, { key: "keys", dim: true, maxCells: contentCols })
    /** The visible slice plus its reserved gutter column. */
    const body = panelViewportBody(kit, children, scroller, true, wheelBound)
    // THE TITLE ROW IS OUTSIDE THE WINDOW, immediately under the frame's top border: the page's own
    // name and MPD's `⤢`, both pinned, so the control sits at the same cell however far the drawing
    // scrolls. It is the SAME implementation the merged and workmate pages use — one definition of the
    // chrome, so the three pages cannot drift into three different-looking affordances.
    //
    // WHY THE PAGE DRAWS IT AND THE HOST CANNOT: measured on dsh-tui 0.13.0, `dsh-adapter/panels.js`
    // freezes a plugin descriptor WITHOUT `capabilities`, while `SidePanelColumn.js`'s `canExpand` reads
    // `definition.capabilities?.fullscreen === true` — so no plugin panel ever gets the host's own `⤢`.
    /** This page's chrome row: its title and the full-screen control. */
    const titleRow = usePanelTitleRow(kit, { key: "title", title: DAG_PANEL_TITLE, cols: contentCols, ...(options?.openFullscreen === undefined ? {} : { open: options.openFullscreen }) })
    return panelFrame(kit, DAG_PANEL_TITLE, [titleRow, ...body, footer])
  }
}

/** What the DAG page needs from the rest of the plugin. */
export interface DagPanelDeps {
  /** Whether the row config contributes this surface at all (the `panel` knob, default true). */
  enabled: boolean
  /** Reads the MPD team projection for the calling session's workspace, per call. */
  readWorkflow(): TeamWorkflow | undefined
  /** The existing full-screen scene, opened when the host cannot serve a panel at all. */
  openScene(): boolean
  /**
   * Opens the agent work page for a live subagent id (AC6); false when no page was reached.
   *
   * Optional because the row's wiring may have no such surface; a page without it still SAYS SO through
   * the host's toast rather than ignoring the second click.
   */
  openAgentPage?: (agentId: string) => boolean
  /**
   * Opens this page's full-screen scene (AC8b); false when no page was reached.
   *
   * It is the page's own `openScene` surface, reached from the `⤢` control the page draws in its title
   * row — the host cannot draw one for a plugin panel. Optional for the same reason as the dep above:
   * a page given no opener still draws the control row, but its glyph carries no click handler.
   */
  openFullscreen?: () => boolean
  /** Diagnostics: the file sink, never a terminal. */
  log: Log
}

/** The DAG page's seam: the registration plus the facts the boot diagnostic reports. */
export interface DagPanelSeam {
  /** The registration; `undefined` when the row config disabled this surface. */
  readonly panel: PanelRegistrationHandle | undefined
  /** Whether the page is registered right now (the seam is bound AND the registration confirmed). */
  registered(): boolean
  /** The FINAL host panel id, or undefined while it is unbound, refused or unread. */
  id(): string | undefined
  /** The registration outcome, as the row's own boot diagnostic reports it. */
  outcome(): SeamOutcome
  /** Opens the full-screen DAG/merged scene; the surface a host without the panel seam keeps. */
  openScene(): boolean
}

/**
 * Register the DAG page and expose the route a host without the panel seam keeps.
 * @param tui - the DSH-TUI seam adapter (this file names no seam id of its own).
 * @param deps - the workflow reader, the scene opener and the log.
 * @returns the page's seam; `panel` is undefined only when the row config disabled the surface.
 */
export function registerDagPanel(tui: TuiAdapter, deps: DagPanelDeps): DagPanelSeam {
  // ONE registration, at apply: the adapter queues it until the seam binds and settles it as `absent`
  // on a host that never offers the panel seam, so this call is safe on every dsh-tui build.
  const panel: PanelRegistrationHandle | undefined = deps.enabled
    ? tui.registerPanel({
        ...DAG_PANEL_DESCRIPTOR_FROZEN,
        // THE AGENT-PAGE DEP IS FORWARDED HERE and nowhere else: the component is built by this row, so a
        // dep the row received but did not pass would leave the second click (AC6) silently dead — the
        // exact no-op the criterion forbids. THE FULL-SCREEN OPENER RIDES THE SAME RULE (AC8b): the
        // `⤢` control is drawn by the page, so a dep that stopped here would leave a visible button that
        // does nothing.
        component: createDagPanelComponent(deps.readWorkflow, { openAgentPage: deps.openAgentPage, openFullscreen: deps.openFullscreen }),
      })
    : undefined
  return {
    panel,
    registered: (): boolean => panel !== undefined && panel.id() !== undefined,
    id: (): string | undefined => panel?.id(),
    outcome: (): SeamOutcome => {
      if (panel !== undefined) return panel.outcome()
      // A surface this row deliberately did not activate: the adapter's own skipped vocabulary, so the
      // aggregate line names the reason instead of an invented state.
      return tui.skipped("panels", "the DAG sidebar page is disabled by the mpd-tui row config (panel: false)").outcome()
    },
    openScene: (): boolean => deps.openScene(),
  }
}

/**
 * The footer's running-node hint, used by the pages that draw the breathing glyph.
 * @param phase - the frame index from the host's timer.
 * @returns the glyph, read through the shared core so no page re-implements the orbit.
 */
export function dagRunningGlyph(phase: number): string {
  return runningGlyph(phase)
}
