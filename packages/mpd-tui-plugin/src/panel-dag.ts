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
import { layoutBoxes, layoutList, layoutRail, legendLines, type GraphTask, type GraphView } from "./graph.js"
import type { TeamWorkflow } from "./team-state.js"
import {
  clampScroll,
  graphRow,
  panelScrollKey,
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
  type PanelPropsLike,
} from "./panel-core.js"

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
 * The FLOOR a boxed node must leave for its own label, in cells.
 *
 * The drawing module's own floor (`MIN_NODE_WIDTH = 16`) is the width below which a box cannot hold
 * `◐ T12 WRK …` at all. This page asks for more, because the sidebar is the surface where the choice
 * actually bites: a panel at the descriptor's own floor gets a narrow box, and while a short fixture
 * label happens to fit, a real subject does not — `◐ T7 Integration task: port the WEB DAG into the
 * TUI` is 55 cells, so the drawing would paint a cut-off prefix while the FULL-WIDTH rail draws it
 * whole on one row. This floor is a LAYOUT floor, deliberately SEPARATE from the descriptor's
 * `minColumns`: the descriptor asks the host for a column it is guaranteed (`dag-theme.ts`, the host's
 * own 28), while this decides what this page can READABLY draw inside the column it actually gets.
 *
 * WHY A FLOOR AND NOT AN ELLIPSIS. The WEB view ends an overflowing subject with `…`, and that is the
 * right answer for a surface that must draw a fixed box. This page has a better option — the SAME
 * drawing module offers a rail whose lines are the full panel width — so instead of decorating a
 * truncated label the page DECLINES the box whenever a label would not fit, and the gate below makes
 * that guarantee exact: boxes are drawn only when the widest label the board would write fits the box
 * interior entirely. A page that never truncates needs no truncation marker.
 */
const MIN_BOX_LABEL_CELLS = 32

/** The gap between two boxes in one rank; mirrors the drawing's own `NODE_GAP`. */
const NODE_GAP = 3

/**
 * The longest label any task in the board would draw, in cells.
 *
 * It mirrors the drawing's own label shape (`marker id kind subject`, `subject id subject` without a
 * kind) so the estimate measures what will actually be painted; an over-estimate here costs boxes mode
 * and buys a legible rail, which is the safe direction to be wrong in.
 * @param tasks - the board.
 * @returns the widest label, in cells.
 */
function widestLabel(tasks: readonly DagPanelTask[]): number {
  /** The running maximum. */
  let widest = 0
  for (const task of tasks) {
    /** The task's kind abbreviation, absent when the record carries no kind. */
    const abbrev = DAG_KIND_ABBREV[task.kind ?? ""] ?? ""
    /** The label the drawing will write inside the box, one leading space included. */
    const label = ` ${visualGlyphFor(task.visual)} ${task.id}${abbrev === "" ? "" : ` ${abbrev}`} ${task.subject}`
    widest = Math.max(widest, panelCellWidth(label))
  }
  return widest
}

/**
 * The grid the drawing's boxed mode would produce at this width.
 *
 * The two facts this page needs are both outputs of the SAME formula the drawing module uses, so it is
 * repeated here rather than guessed: the rank count (which decides whether boxes are even offered) and
 * the per-node width (which decides whether a box can hold a label).
 * @param tasks - the board.
 * @param cols - the cells the panel measured.
 * @returns the rank count and the per-node width, or undefined when the board is empty.
 */
function boxGrid(tasks: readonly DagPanelTask[], cols: number): { ranks: number; nodeWidth: number } | undefined {
  if (tasks.length === 0) return undefined
  /** Each task's own rank: one plus its deepest blocker's rank, computed from `dependencies`. */
  const rankOf = new Map<string, number>()
  for (const task of tasks) rankOf.set(task.id, 0)
  /** Whether any rank moved on this pass, which is the loop's termination signal. */
  for (let pass = 0; pass < tasks.length; pass += 1) {
    /** Whether this pass changed a rank. */
    let moved = false
    for (const task of tasks) {
      /** The deepest blocker's own rank, plus one; an unresolved blocker contributes nothing. */
      let deepest = -1
      for (const blocker of task.dependencies) {
        /** This blocker's rank, when it is on this board. */
        const at = rankOf.get(blocker)
        if (at !== undefined && at > deepest) deepest = at
      }
      if (deepest + 1 > (rankOf.get(task.id) ?? 0)) {
        rankOf.set(task.id, deepest + 1)
        moved = true
      }
    }
    if (!moved) break
  }
  /** How many ranks the drawing would stack, never fewer than one. */
  const ranks = Math.max(0, ...[...rankOf.values()].map((rank) => rank + 1))
  if (ranks === 0) return undefined
  /** The count of tasks in the busiest rank, which sets the box width. */
  let widestRank = 1
  /** The tasks per rank, so the busiest one can set the node width. */
  const perRank = new Map<number, number>()
  for (const rank of rankOf.values()) perRank.set(rank, (perRank.get(rank) ?? 0) + 1)
  for (const count of perRank.values()) widestRank = Math.max(widestRank, count)
  /** The node width the drawing would choose, capped by its own maximum. */
  const nodeWidth = Math.min(34, Math.floor((cols - NODE_GAP * (widestRank - 1)) / widestRank))
  return { ranks, nodeWidth }
}

/**
 * The cells a label occupies, measured with the page's own width rule.
 * @param value - the text to measure.
 * @returns its width in cells.
 */
function panelCellWidth(value: string): number {
  return cellWidth(panelText(value))
}

/**
 * The glyph a task's visual state draws, read from the frozen contract.
 * @param visual - the task's rendered visual state.
 * @returns the glyph, or `?` for a state the contract does not know.
 */
function visualGlyphFor(visual: string): string {
  return DAG_TONE_GLYPH[visual] ?? "?"
}

/**
 * Lay the board out for the measured panel.
 *
 * THE MODE IS A FACT ABOUT THE GEOMETRY, never a guess about the terminal, and there are three gates
 * before a box is drawn:
 *   1. `layoutBoxes` REFUSES rather than squeeze a node under its own floor (it returns undefined);
 *   2. the panel asks for MORE than that floor — {@link MIN_BOX_LABEL_CELLS} — because a box that
 *      cannot hold a whole label draws a cut-off subject while the rail below it would draw the same
 *      subject on one full-width row (this is the defect the visual review measured at 32 columns);
 *   3. `layoutList` — the rank-grouped table with progress bars — takes over a narrow, BUSY board,
 *      which is the case it was written for and, until this page, the case nothing reached.
 * @param tasks - the board to draw.
 * @param cols - the cells the panel measured.
 * @param focus - the task to light, with its dependency chain.
 * @returns the drawing and the mode that produced it.
 */
export function dagPanelLayout(tasks: readonly DagPanelTask[], cols: number, focus?: string): DagPanelLayout {
  /** The usable width; a nonsense width still has to produce something drawable. */
  const width = Math.max(8, Math.floor(Number.isFinite(cols) ? cols : 8))
  /** The grid the boxed mode would draw at this width, when there is a board at all. */
  const grid = boxGrid(tasks, width)
  /** The widest label the board would write, in cells. */
  const label = widestLabel(tasks)
  // THE GATE IS EXACT, NOT A HEURISTIC: a box is drawn only when its INTERIOR holds the widest label
  // the board would write (which is what guarantees no subject is ever cut) AND clears this page's own
  // floor (which is what keeps a box from being drawn so small that the rail would read better).
  if (grid !== undefined && grid.nodeWidth - 2 >= label && grid.nodeWidth - 2 >= MIN_BOX_LABEL_CELLS) {
    /** The boxed DAG, absent when the geometry cannot hold a legible node. */
    const boxes = layoutBoxes(tasks, width, focus)
    if (boxes !== undefined) return { view: boxes, mode: "boxes", list: false, ...viewFacts(boxes) }
  }
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
  /** The ten facts, in a fixed order so the body does not reshuffle between renders. */
  const facts: Array<[string, string]> = [
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
function scrollRowIntoView(viewport: { offset: number; viewportRows: number; scrollTo: (next: number) => void }, row: number): void {
  if (row < viewport.offset) {
    viewport.scrollTo(row)
    return
  }
  if (row >= viewport.offset + viewport.viewportRows) viewport.scrollTo(row - viewport.viewportRows + 1)
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

/**
 * Build the DAG page component.
 * @param readWorkflow - reads the MPD team projection for this session's workspace; the wiring passes
 *   the same reader the merged panel and the scenes use, so no two surfaces can describe one team
 *   differently. It is injected (rather than imported) so this file stays free of the row module.
 * @returns a component matching the host's panel props contract.
 */
export function createDagPanelComponent(readWorkflow: () => TeamWorkflow | undefined): unknown {
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
    /** The focused task id, when the state cell holds one. */
    const cursorId = typeof cursor[0] === "string" ? (cursor[0] as string) : undefined
    /** Moves the keyboard cursor. */
    const setCursor = cursor[1] as (next: unknown) => void
    /** The task the drawing lights: the CLICK PIN outranks the keyboard cursor while it exists. */
    const focus = pinned ?? cursorId
    /** The drawing for this render, for the width THIS panel measured. */
    const layout = page === undefined ? undefined : dagPanelLayout(page.tasks, contentCols, focus)
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
      /** The scroll gesture this press asked for, if any. */
      const gesture = panelScrollKey(bare)
      if (gesture !== undefined) {
        if (bare?.preventDefault !== undefined) bare.preventDefault()
        if (gesture === "top") viewport.scrollTo(0)
        else if (gesture === "bottom") viewport.scrollTo(Number.MAX_SAFE_INTEGER)
        else viewport.scrollBy((gesture === "pageUp" ? -1 : 1) * viewport.viewportRows)
        // THE SCROLL POSITION IS PUBLISHED BEFORE THE HANDLER RETURNS, so a run of page-keys in one
        // event-loop turn accumulates against the position the previous press ASKED for. Without this the
        // handler re-reads the same stale render on every press and the page never moves — the measured
        // shape of the defect (a 1000-press walk that left the window where it started).
        return
      }
      /** What the focus keymap decided. */
      const action = dagPanelKeyAction(bare, order, cursorId)
      if (!action.consumed) return
      if (bare?.preventDefault !== undefined) bare.preventDefault()
      if (action.focus !== undefined) {
        setCursor(action.focus)
        // FOCUS MOVEMENT AUTO-SCROLLS (frozen requirement): the invariant is that the focused node can
        // never be outside the rendered window, so the two features cooperate instead of competing.
        /** The row the newly focused task draws on, when this drawing has one. */
        const at = rowIndex.get(action.focus)
        if (at !== undefined) scrollRowIntoView(viewport, at)
      }
      if (action.pin === true) setPinned(focus)
      if (action.pin === false) setPinned(undefined)
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
    const sizes = { contentRows: 1, viewportRows: 1 }
    /** The window height this panel affords, from the height the host reported. */
    const windowRows = Math.max(1, (measured.rows ?? DAG_FALLBACK_ROWS) - PANEL_CHROME_ROWS)
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
        // The row every task DRAWS ON is recorded as the drawing is walked, which is what makes focus
        // auto-scroll exact: the page never re-derives a position the drawing already knows.
        /** The tasks whose hit rectangle covers this row. */
        for (const candidate of layout.view.hits) {
          if (index >= candidate.row && index <= candidate.rowEnd && !rowIndex.has(candidate.taskId)) rowIndex.set(candidate.taskId, index)
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
        const spans = running && breathing
          ? row.map((span) => (span.text.includes(baseGlyph) ? { text: span.text.replace(baseGlyph, breathe), tone: span.tone } : span))
          : row
        /** The task this row belongs to, when the pointer could land on one. */
        const hit = layout.view.hits.find((candidate) => index >= candidate.row && index <= candidate.rowEnd)
        children.push(
          hit === undefined
            ? graphRow(kit, spans, { key: `row-${index}`, cols: contentCols })
            : graphRow(kit, spans, {
                key: `row-${index}`,
                cols: contentCols,
                onClick: (): void => {
                  // THE CLICK RESOLVES THROUGH THE DRAWING'S OWN HIT RECTANGLE (never arithmetic on the
                  // event): the closure already knows which task this row belongs to, and the layout is
                  // the one that produced the row on screen.
                  setPinned(hit.taskId)
                  setCursor(hit.taskId)
                },
              }),
        )
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
    // pointer, so binding it once around the visible slice keeps ONE handler in the dispatch path. The
    // slice itself is taken HERE, on the page's own rows — `rowIndex`'s numbers are indices into exactly
    // this array, which is what makes the focus auto-scroll exact instead of approximate.
    /** The visible slice, inside the page's own wheel handler. */
    const scrolled = kit.React.createElement(kit.ui.Box, { key: "scroll", flexDirection: "column", onWheel: (event: unknown): void => scroller.onWheel(event) }, ...children.slice(viewport.offset, viewport.offset + viewport.viewportRows))
    // THE FOOTER KEY HINTS (R6/R11): the keys this page actually handles, and nothing else — a hint row
    // that named a key the page ignores is worse than no hint row.
    /** The pinned footer, carrying the scroll position so the reader can see where they are. */
    const footer = textRow(kit, `↑↓/jk move · Enter pin · Esc unpin · PgUp/PgDn scroll${scroller.overflow ? ` ${scroller.offset + 1}/${scroller.max + 1}` : ""}`, { key: "keys", dim: true, maxCells: contentCols })
    /** The visible slice plus its reserved gutter column. */
    const body = panelViewportBody(kit, [scrolled], scroller)
    return panelFrame(kit, DAG_PANEL_TITLE, [...body, footer])
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
        component: createDagPanelComponent(deps.readWorkflow),
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
