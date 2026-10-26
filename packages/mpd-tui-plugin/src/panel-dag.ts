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
//   · the legend is `panel-core.ts`'s `legendLinesFor`, which forwards `graph.ts`'s own arrow/focus
//     sentence and appends the ONE state key read out of `dag-theme.ts`. That key is what disambiguates
//     `blocked ○` from `open ○`, which share a glyph by design; the drawing module's own five-state key
//     was DELETED with the redundant legend row the user reported.
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
import { DAG_CHROME, DAG_KIND_ABBREV, DAG_PANEL_MIN_COLUMNS, DAG_TONE_GLYPH } from "./dag-theme.js"
// THE CHROME COMES FROM THE SHARED CORE, not a second implementation of it: the `⤢` control, its hover
// treatment and the title row it sits in are ONE definition, so the two MPD pages this bundle ships
// (the MPD panel, which is THIS page, and the workmate page) cannot drift into two different-looking
// affordances (and the host cannot draw one for either of them).
import { PANEL_FRAME_BORDER_ROWS, PANEL_FULLSCREEN_GLYPH, PANEL_TITLE_ROW_ROWS, swallowWheelEvent, usePanelTitleRow } from "./panel-core.js"
// THE HOST'S CURATED SUBAGENT ROWS ARE READ THROUGH THE SCENE'S OWN PROJECTION, never re-derived here:
// `subagentSectionRows` owns the field reads, the empty state and the counts, and this page renders
// its answer inside its own frame (frozen clause C3). `surfaceRule` is the SAME titled rule the scene
// draws between ITS sections: one divider primitive, so this page cannot invent a second-looking one.
import { subagentSectionRows, surfaceRule, type SubagentSectionRow } from "./subagent-scene.js"
import { boxesFitWidth, hitTest, hitTestGroup, layoutBoxesNatural, layoutList, layoutRail, legendLines, sliceSpans, type GraphHit, type GraphSpan, type GraphTask, type GraphView } from "./graph.js"
// THE GROUP RECORD the served model publishes for each subcell box (`cellwork` wave 4): a frame's id, its
// title, its parent frame and the ids DIRECTLY inside it. Read as the STRUCTURAL type the drawing
// uses, so this page adds no cross-package edge beyond the ones the inventory already counts.
import type { GroupedGroup } from "./dag-groups.js"
import type { TeamWorkflow } from "./team-state.js"
import { modelRanks, modelRows, NO_SESSION_TEAM_MARKER, WORKSPACE_SCOPE_MARKER, type TeamFeedAccessor } from "./team-state.js"
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
  panelKit,
  panelSessionId,
  panelSnapshot,
  panelText,
  runningGlyph,
  textRow,
  usePanelKeys,
  usePanelSize,
  usePanelTick,
  useTeamFeed,
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

// ── THE PAGE'S OWN IDENTITY, AFTER THE MERGE (frozen clause C3) ────────────────────────────────────
// This page has NO descriptor, NO slug and NO ordered position of its own any more: the DAG page IS the
// MPD panel, so ONE descriptor (`panel.ts`'s `PANEL_DESCRIPTOR_FROZEN`, slug `team`, icon `❖`, order 10)
// and ONE registration survive, and the merged slot renders this module's component. What remains here
// is only what the page must know to DRAW itself.

/**
 * The title this page draws in its own title row, and the title the surviving descriptor declares.
 *
 * IT IS THE SURVIVOR'S TITLE, not a second one: 「DAG页作为MPD面板」 — the reader sees the MPD panel — and
 * the arm `panel-visibility.test.ts` carries asserts this constant equals `panel.ts`'s `PANEL_TITLE`, so
 * the two spellings cannot drift into a page whose chrome says one thing and whose descriptor another.
 */
export const DAG_PANEL_TITLE = "MPD"

/**
 * The English name of this page's HOST-SUBAGENT section, drawn in a titled rule above the host's rows.
 *
 * WHY THE PAGE NAMES IT AT ALL: the body carries two different facts — the host's curated subagents and
 * MPD's own team DAG — and before this rule they ran into each other with nothing between them, so a
 * reader could not tell where one ended and the other began (the reported defect). The host's own
 * section header (`subagents  N total · …`) STAYS as the count line under this rule, so the section is
 * named and counted rather than renamed. The label is ENGLISH, as the user approved for this page.
 */
export const DAG_SECTION_HOST_TITLE = "Host subagents"

/**
 * The English name of this page's MPD DRAWING section, drawn in the titled rule that separates it from
 * the host's rows above.
 *
 * THE NAME NO LONGER OPENS WITH `MPD`, and that is the point: the page already carries its title once
 * (the title row's `MPD`, the only occurrence a reader needs) and the frame's border title used to
 * repeat it, so a third `MPD` inside the body read as three headings for one page. The section is
 * still NAMED — `team DAG` says which section it is without re-announcing whose panel this is.
 *
 * IT IS DRAWN UNCONDITIONALLY, so the drawing below is always named even when the host's own section is
 * showing nothing but its empty state (the contract's empty-state clause) — which is why the two rules
 * are pushed at different points rather than as one pair.
 */
export const DAG_SECTION_DAG_TITLE = "team DAG"

/**
 * The tick this page re-reads its source on. A sidebar is passive, so the page owns its own clock.
 *
 * TWO SECONDS, THE SAME CADENCE AS EVERY OTHER MPD SURFACE (`WORKMATE_PANEL_REFRESH_MS`, the board and
 * team scenes, the subagents scene). The page used to tick at one second — the only MPD surface that
 * did — so the merged panel refreshed twice as often as the scenes it shares a vocabulary with, for a
 * local synchronous projection that has nothing new to say between two seconds and one. A partial
 * screen (a slow terminal repaint, a lost cell over SSH) still SELF-HEALS, one second later than
 * before; a test that waits ~2.2 s proves the tick is observable on a real timer.
 */
export const DAG_PANEL_REFRESH_MS = 2000

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
  /**
   * True for a GHOST row: the served model's plan-only node, drawn here but absent from the board.
   *
   * The projection copies it from {@link TeamTaskRow.planned}, so the page can tell a planned task
   * from a board task without comparing `visual` strings.
   */
  planned?: boolean
}

/**
 * WHERE the page's drawn ranks came from — the three facts the footer must never re-conflate.
 *
 * THE DEFECT THIS TYPE EXISTS FOR (wave `living-graph`, verifier finding): the core's
 * `rankPlan(tasks, served)` reports `derived: false` when it APPLIED the served map, which answers
 * "did this process derive?" — NOT "were these ranks derived at all?". Reading that flag as the second
 * question made the page print `ranks served` on the normal model path even though the model's own
 * report said the HOST derived them, i.e. it told the reader the picture rested on an untrusted
 * fallback. Naming the states makes the confusion a compile-time-visible choice, not a wording accident:
 *   · `derived-host` — a served model exists and its report says its ranks were derived → `derived (host)`;
 *   · `served-host`  — a served model exists and IT fell back to the served depth → `served depth (host fallback)`;
 *   · `local`        — no served model: this process ranks the board (today's split: `derived`, or
 *                      `served depth` on the documented served-depth fallback).
 */
export type DagRanksSource = "derived-host" | "served-host" | "local"

/** The projection one render draws from: the tasks, the counts, the roster size and the problems. */
export interface DagPage {
  /** The tasks, in board order — SERVED-MODEL order when a model was joined in (ghosts included). */
  tasks: DagPanelTask[]
  /**
   * The SERVED rank of every drawn task, when the host published a model (wave `living-graph`).
   *
   * OPTIONAL on purpose: absent means the drawing derives ranks through the shared core's `rankPlan`,
   * exactly as it always has; present means that map is handed to the layout as its optional ranks
   * input and no local derivation runs. A projection only — never serialized.
   */
  ranks?: ReadonlyMap<string, number>
  /**
   * WHERE those ranks came from, in the three states {@link DagRanksSource} names.
   *
   * `dagPageOf` derives it from the model's own `report.ranksDerived` (the host's answer), never from
   * the layout's `derived` flag — that one answers "did this process derive?" and is `false` by design
   * once a served map is applied.
   */
  ranksSource: DagRanksSource
  /**
   * The GROUP FRAMES the served model declares, when it declares any (`cellwork` wave 4).
   *
   * ABSENT means this board has no groups, which is also the reading a model without the field gets — and
   * then the drawing is the flat one, byte for byte. PRESENT means the page asks for a nested drawing and
   * the frames are drawn as boxes around their own interiors.
   */
  groups?: readonly GroupedGroup[]
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
  /**
   * The roster as ONE line, composed in the scene's own discipline (`scenes.ts`): the explicit
   * `(no members)` row, or every member as `glyph name done/total` joined with `·` — the running
   * glyph exactly as the scene draws it. Clause C6's 0-task render draws this line so a live
   * member-only team keeps a body beside its header facts.
   */
  roster: string
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
  if (workflow === undefined || !Array.isArray(workflow.tasks)) return undefined
  // C6: AN EMPTY BOARD PROJECTS ONLY WHEN A TEAM ACTUALLY RESOLVED. The record's own `team` head is
  // the signal — every reader that resolved one sets it, and `emptyWorkflow` (the honest no-team
  // projection, the `none` scope's carrier) omits it — so a live team with zero tasks keeps its page
  // while the no-team projection keeps yielding undefined for the render's marker row below.
  if (workflow.tasks.length === 0 && workflow.team === undefined) return undefined
  /** The rows to draw: the board joined with the served model, ghosts included (wave `living-graph`). */
  const rows = modelRows(workflow)
  /** The tasks, projected once. */
  const tasks: DagPanelTask[] = []
  for (const task of rows) {
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
      ...(task.planned === true ? { planned: true } : {}),
      ...(task.group === undefined ? {} : { group: panelField(task.group, 60) ?? "" }),
    })
  }
  // The SAME C6 rule, one guard later: a board whose every row failed to project is still a resolved
  // team when the head exists (it draws as the 0-task render), and still no team at all when it does
  // not — the shape without a head keeps the pre-C6 bail-out so no fixture changes meaning.
  if (tasks.length === 0 && workflow.team === undefined) return undefined
  // The roster, projected once in the SCENE'S OWN DISCIPLINE (`scenes.ts`): every member with its
  // status glyph and its done/total, sanitised here because the record came from a file. The page's
  // 0-task render draws it as one line (clause C6), so the projection — not the render — owns the
  // field reads, exactly as it does for the board above.
  /** The roster rows, sanitised; `done`/`total` default to 0 when the row carries no number. */
  const roster: Array<{ name: string; status: string; done: number; total: number }> = []
  if (Array.isArray(workflow.members)) {
    for (const member of workflow.members) {
      roster.push({
        name: panelField(member.name, 40) ?? "?",
        status: panelField(member.status, 20) ?? "unknown",
        done: typeof member.done === "number" ? member.done : 0,
        total: typeof member.total === "number" ? member.total : 0,
      })
    }
  }
  /** The served ranks, absent when this projection carries no accepted model. */
  const ranks = modelRanks(workflow)
  // THE THREE STATES, from the HOST's own report when a model was accepted: `local` is the only one
  // this process can answer without a model, and the layout's flag decides only its sub-word.
  /** Where the drawn ranks came from, named for the footer's word. */
  const ranksSource: DagRanksSource = workflow.model === undefined
    ? "local"
    : workflow.model.report.ranksDerived === true ? "derived-host" : "served-host"
  // THE FRAMES, sanitised like every other record field: a label is a display string that came from a file,
  // and its member lists are ids the drawing joins rows by.
  /** The group records this projection carries, or an empty list when the model has none. */
  const groups: GroupedGroup[] = []
  for (const group of workflow.model?.groups ?? []) {
    /** The group's id, sanitised; a record without one cannot be joined and is dropped. */
    const id = panelField(group.id, 60)
    if (id === undefined || id === "") continue
    /** The parent frame's id, which is `null` for a box drawn inside the root frame. */
    const parentId = group.parentId === null ? null : panelField(group.parentId, 60) ?? null
    groups.push({
      id,
      label: panelField(group.label, 60) ?? id,
      parentId,
      memberIds: (Array.isArray(group.memberIds) ? group.memberIds : []).map((member) => panelField(member, 60) ?? "").filter((member) => member !== ""),
      depth: typeof group.depth === "number" && Number.isFinite(group.depth) ? Math.max(0, Math.floor(group.depth)) : 0,
      ...(group.originTaskId === undefined ? {} : { originTaskId: panelField(group.originTaskId, 60) ?? "" }),
    })
  }
  return {
    tasks,
    ...(ranks === undefined ? {} : { ranks }),
    ...(groups.length === 0 ? {} : { groups }),
    ranksSource,
    workspace: panelField(workflow.workspace, 200) ?? "",
    teamName: panelField(workflow.team?.name, 60) ?? "(unnamed team)",
    phase: panelField(workflow.team?.phase, 20) ?? "unknown",
    completed: typeof workflow.counts?.completed === "number" ? workflow.counts.completed : 0,
    total: typeof workflow.counts?.total === "number" ? workflow.counts.total : tasks.length,
    members: roster.length,
    roster: roster.length === 0
      ? "roster  (no members)"
      : "roster  " + roster.map((member) => `${member.status === "running" ? "◐" : "○"}${member.name} ${member.done}/${member.total}`).join(" · "),
    problems: (Array.isArray(workflow.problems) ? workflow.problems : []).map((problem) => panelField(problem, 120) ?? "").filter((problem) => problem !== ""),
  }
}

/**
 * The footer's EXACT word for a rank source.
 *
 * `layoutDerived` is read ONLY for the `local` state. The core's `rankPlan(tasks, served)` reports
 * `derived: false` whenever it applied the map the host handed it — true, and correct for its own
 * question ("did this process derive?"), but it says nothing about whether the HOST derived the ranks
 * from the graph. The page must answer the reader's question, so the two host states come from
 * `model.report.ranksDerived`; only a composition with no model asks the layout at all.
 * @param source - the named rank source on the projection.
 * @param layoutDerived - the layout's own flag, meaningful only for `local`.
 * @returns the phrase after `ranks ` in the mode line.
 */
function ranksPhrase(source: DagRanksSource, layoutDerived: boolean): string {
  if (source === "derived-host") return "derived (host)"
  if (source === "served-host") return "served depth (host fallback)"
  return layoutDerived ? "derived" : "served depth"
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
 * Whether the boxed drawing is the honest choice for a panel this wide.
 *
 * THE WIDTH IS THE ONLY REFUSAL LEFT (frozen contract `dag-edges`, clause A3), and it is a floor on
 * the PANEL, never on the drawing: a panel that can show two node columns gets the DAG, and a drawing
 * wider than that panel is reached through the page's EXISTING horizontal pan — which the footer names
 * (`col n/m`) and the horizontal rail under the drawing scrubs.
 *
 * THE WHOLE-FIT RULE THIS REPLACES (commit `95c836b9`) refused any drawing that did not fit BOTH axes,
 * so a board with lines was downgraded to a rail with none — the user's 20-task board read `view rail`
 * on a panel with room for seven columns, and their 5-task board fell back too. The vertical half is
 * gone for the same reason: a drawing taller than the window is reached by the page's own scroll, and
 * `halfBoxRows` already blanks a box that would be cut rather than drawing half of one.
 * @param view - the drawing the layout produced, for the one box width it uses.
 * @param cols - the cells the panel may draw in.
 * @returns true when two node columns fit, i.e. when boxes are the honest choice.
 */
function boxesFitPanel(view: GraphView, cols: number): boolean {
  return boxesFitWidth(view, cols)
}

/** Where the page's window stands, as the pinned footer reports it. */
export interface DagFooterFacts {
  /** The vertical window, present only while the page overflows its window. */
  vertical?: { offset: number; max: number }
  /** The horizontal window, present only while the drawing is wider than the window. */
  horizontal?: { offset: number; max: number }
}

/**
 * The page's pinned footer, composed so the POSITION LEADS and the hints stay short.
 *
 * WHY THE ORDER IS THE CONTRACT (item 7): the host clamps a row from its END, so a hint list that picked
 * up where the position left off was the first thing cut — and at the 28-column floor this page has 26
 * content cells while the old hint list alone ran past 60. The one fact that tells a reader the drawing
 * continues (where they are) must therefore survive any width, so it comes first; the keys are compact
 * enough that 26 cells still show the control and the first two hints.
 *
 * The horizontal token names its own axis (`col n/m`): two bare `n/m` pairs on one row would read as one
 * position, and the whole point of the second token is that the DRAWING's window is a different axis
 * from the page's.
 * @param facts - the windows that are open; an absent window contributes no token at all.
 * @returns the footer's text, never wider than its caller's budget by construction (the caller clamps).
 */
export function dagFooterText(facts: DagFooterFacts): string {
  /** The tokens that say where the reader is, in the order they are read. */
  const tokens: string[] = []
  if (facts.vertical !== undefined && facts.vertical.max > 0) {
    tokens.push(`${Math.max(0, Math.floor(facts.vertical.offset)) + 1}/${Math.max(0, Math.floor(facts.vertical.max)) + 1}`)
  }
  if (facts.horizontal !== undefined && facts.horizontal.max > 0) {
    tokens.push(`col ${Math.max(0, Math.floor(facts.horizontal.offset)) + 1}/${Math.max(0, Math.floor(facts.horizontal.max)) + 1}`)
  }
  /** The position prefix, empty when neither window is open. */
  const place = tokens.length === 0 ? "" : `${tokens.join(" ")} · `
  return `${place}${PANEL_FULLSCREEN_GLYPH} full · ↑↓/jk · ⏎ pin · esc · ⇧↑↓←→`
}

/**
 * The drawing rows a render must NOT paint, because their box straddles the window's own edge.
 *
 * THE DEFECT THIS ENDS (the screenshot's "T5 half"): the body is a blind slice of the page's rows, so a
 * three-row box whose top border lands on the window's last visible row draws its top border and its
 * label and then stops — a box with no bottom, which a reader has to interpret rather than read. The
 * vertical window is therefore RANK-ALIGNED in the only sense this page can guarantee: a box is drawn
 * WHOLE or not at all. A box that only partly intersects the window keeps its row budget (the rows stay
 * in the page, blanked) so the scroll position, the gutter and every click row stay where they were.
 *
 * DECIDING IT HERE RATHER THAN IN THE LAYOUT is what makes the rule hold at every scroll position: the
 * window moves while the drawing does not, so the set is a fact about THIS render's offset. A drawing
 * that fits the window whole (the only kind the layout accepts as boxes) has nothing to blank until the
 * reader scrolls, which is exactly the case this exists for.
 * @param hits - the drawing's own rectangles, in its local rows.
 * @param dagStart - the page row the drawing's first line occupies.
 * @param windowStart - the first page row the window shows.
 * @param windowRows - how many page rows the window shows.
 * @returns the drawing-local row indices to blank; empty when every visible box is whole.
 */
export function halfBoxRows(hits: readonly GraphHit[], dagStart: number, windowStart: number, windowRows: number): Set<number> {
  /** The rows to blank, in the DRAWING's coordinates. */
  const blank = new Set<number>()
  if (!Array.isArray(hits) || hits.length === 0) return blank
  /** The first page row the window shows, floored. */
  const start = Math.max(0, Math.floor(Number.isFinite(windowStart) ? windowStart : 0))
  /** One past the last page row the window shows. */
  const end = start + Math.max(1, Math.floor(Number.isFinite(windowRows) ? windowRows : 1))
  for (const hit of hits) {
    /** The box's first page row. */
    const top = dagStart + hit.row
    /** The box's last page row, inclusive. */
    const bottom = dagStart + hit.rowEnd
    // ENTIRELY OUTSIDE: the slice does not draw it at all, so there is nothing to blank.
    if (bottom < start || top >= end) continue
    // WHOLE: every row of the box is inside the window, which is the half a reader can read.
    if (top >= start && bottom < end) continue
    for (let row = Math.max(top, start); row <= Math.min(bottom, end - 1); row += 1) blank.add(row - dagStart)
  }
  return blank
}

/**
 * The FRAME CELLS a render must not paint, because the window's own edge would cut their group's box.
 *
 * THE PER-NODE RULE, EXTENDED TO THE THING THAT CONTAINS NODES (frozen contract D3: "never draw half a
 * GROUP"). {@link halfBoxRows} blanks a whole ROW, which is right for a task box — a three-row box that
 * straddles the edge is a picture of nothing. A group frame is different in exactly one way: its border is
 * a CELL SET, not a row band, so blanking its rows would throw away the interior boxes that are perfectly
 * readable. This returns the frame's own cells instead (its two horizontal rules, or its two sides for an
 * interior row), and the caller blanks those and keeps the rest.
 *
 * A frame is CUT only when PART of it is inside the window: one entirely outside is never drawn (the
 * slice drops it), and one entirely inside is whole. That is the same predicate the per-node rule uses.
 * @param view - the drawing, for its frames.
 * @param dagStart - the page row the drawing's first line occupies.
 * @param windowStart - the first page row the window shows.
 * @param windowRows - how many page rows the window shows.
 * @returns the drawing-local row indices to blank cells on, each with the columns to blank.
 */
export function halfGroupCells(view: GraphView, dagStart: number, windowStart: number, windowRows: number): Map<number, Set<number>> {
  /** The cells to blank, keyed by DRAWING row. */
  const blank = new Map<number, Set<number>>()
  /** The first page row the window shows, floored. */
  const start = Math.max(0, Math.floor(Number.isFinite(windowStart) ? windowStart : 0))
  /** One past the last page row the window shows. */
  const end = start + Math.max(1, Math.floor(Number.isFinite(windowRows) ? windowRows : 1))
  for (const frame of view.groups ?? []) {
    /** The frame's first page row. */
    const top = dagStart + frame.row
    /** The frame's last page row, inclusive. */
    const bottom = dagStart + frame.rowEnd
    // ENTIRELY OUTSIDE: the slice does not draw it, so nothing needs blanking.
    if (bottom < start || top >= end) continue
    // WHOLE: every row of the frame is inside the window, which is the half a reader can read.
    if (top >= start && bottom < end) continue
    for (let row = Math.max(top, start); row <= Math.min(bottom, end - 1); row += 1) {
      /** The drawing row this page row belongs to. */
      const local = row - dagStart
      /** The columns to blank on it: the frame's whole width on a rule row, its two sides elsewhere. */
      const cols = new Set<number>()
      if (local === frame.row || local === frame.rowEnd) {
        for (let col = frame.col; col <= frame.colEnd; col += 1) cols.add(col)
      } else {
        cols.add(frame.col)
        cols.add(frame.colEnd)
      }
      /** The cells already chosen for this row, merged so two frames' cuts compose. */
      const held = blank.get(local) ?? new Set<number>()
      for (const col of cols) held.add(col)
      blank.set(local, held)
    }
  }
  return blank
}

/**
 * Replace one row's cells with blanks, keeping the row's own cell count and every other character.
 *
 * THE CELL COUNT IS THE CONTRACT, for the reason the CJK fix records in `graph.ts`: a row that grew or
 * shrank would move every border to its right. A WIDE glyph on a blanked cell therefore becomes TWO
 * spaces rather than one — the glyph is removed whole, and the row keeps its width.
 * @param spans - the drawing row's spans, in draw order.
 * @param cells - the columns to blank, in the drawing's own coordinates.
 * @returns the row's spans with those cells blanked.
 */
function blankCells(spans: readonly GraphSpan[], cells: ReadonlySet<number>): GraphSpan[] {
  /** The rebuilt spans. */
  const out: GraphSpan[] = []
  /** The run being accumulated. */
  let run: GraphSpan | null = null
  /** The drawing column of the next character. */
  let col = 0
  /**
   * Append one piece to the row, merging it with the run before it when the tones agree.
   * @param text - the piece.
   * @param tone - the tone it is drawn in.
   */
  const push = (text: string, tone: GraphSpan["tone"]): void => {
    if (run !== null && run.tone === tone) run.text += text
    else { run = { text, tone }; out.push(run) }
  }
  for (const span of spans) {
    for (const character of span.text) {
      /** The cells this character occupies. */
      const width = cellWidth(character)
      if (cells.has(col)) push(width > 1 ? "  " : " ", "blank")
      else push(character, span.tone)
      col += width
    }
  }
  return out
}

/**
 * Lay the board out for the measured panel.
 *
 * THE MODE IS A FACT ABOUT THE GEOMETRY, never a guess about the terminal — but the geometry it is a
 * fact about is now the CONTENT *and* the box the content must fit in (frozen clause T1, wave
 * `tui-refresh`). This page used to predict the drawing module's fit-width formula (`boxGrid`, a second
 * rank derivation) and to gate on a hand-rolled `widestLabel` that recomposed the label itself. Both are
 * GONE: natural width means the box is sized by the labels it must carry, and the panel no longer has to
 * guess whether they fit.
 *
 * THE LADDER, in order:
 *   1. `layoutBoxesNatural` — the DRAWING at its own width, whenever the panel can show TWO node
 *      columns (see {@link boxesFitPanel}). A drawing wider or taller than the panel is no longer a
 *      reason to refuse it: the page's horizontal pan and vertical scroll reach the rest of it, and the
 *      footer names where the reader is;
 *   2. `layoutList` — the rank-grouped table with progress bars — takes over a BUSY board below that
 *      floor, the case it was written for;
 *   3. `layoutRail` — the forest, for everything else.
 *
 * `labelOverflow` is the other refusal: the drawing reports when the natural width cap held a box below
 * the widest label, and this page then falls back rather than break its own promise that a boxed label is
 * never cut. It is a REPORTED fact from the layout instead of a prediction, which is why the fallback
 * cannot disagree with what was drawn.
 * @param tasks - the board to draw.
 * @param cols - the cells the panel measured; what the mode's width floor is measured against.
 * @param focus - the task to light, with its dependency chain.
 * @param rows - the rows the page's window can show; forwarded to the drawing's (now ignored) budget,
 *   because the WINDOW is what clips a tall drawing — the mode no longer tests it.
 * @param servedRanks - the SERVED rank of each task id when the host published a model; omitted
 *   means the drawing derives them through the core, exactly as it did before this wave.
 * @returns the drawing and the mode that produced it.
 */
export function dagPanelLayout(tasks: readonly DagPanelTask[], cols: number, focus?: string, rows?: number, servedRanks?: ReadonlyMap<string, number>, groups?: readonly GroupedGroup[]): DagPanelLayout {
  /** The usable viewport width; a nonsense width still has to produce something drawable. */
  const width = Math.max(8, Math.floor(Number.isFinite(cols) ? cols : 8))
  /** The boxed DAG at its natural width, absent when the board refuses to be drawn as boxes. */
  const boxes = layoutBoxesNatural(tasks, focus, rows === undefined ? undefined : { rows }, servedRanks, groups)
  if (boxes !== undefined && boxes.labelOverflow !== true && boxesFitPanel(boxes, width)) {
    return { view: boxes, mode: "boxes", list: false, ...viewFacts(boxes) }
  }
  // THE WIDTH GUARD'S COLLAPSE (frozen contract D3). The ladder below is the existing rail/list fallback,
  // unchanged; what this adds is the HONEST REPORT that a group's box could not be drawn at this width —
  // the groups are named COLLAPSED instead of being painted half a side. A board with no groups reports
  // nothing, so the flat degrade is byte-identical to the pre-group page.
  /** The group ids a non-boxed rendering shows collapsed, or undefined when it has none. */
  const collapsed = groups === undefined || groups.length === 0 ? undefined : groups.map((group) => group.id).sort()
  /** The view a fallback mode renders: the drawing's own, plus the collapse report when there is one. */
  const withCollapse = (view: GraphView): GraphView => (collapsed === undefined ? view : { ...view, collapsedGroups: collapsed })
  if (tasks.length > LIST_ROWS) {
    /** The dense table, for a board with more rows than a rail can show legibly. */
    const dense = withCollapse(layoutList(tasks, width, focus, servedRanks))
    return { view: dense, mode: "list", list: true, ...viewFacts(dense) }
  }
  /** The forest, for a board a box cannot hold. */
  const rail = withCollapse(layoutRail(tasks, width, focus, servedRanks))
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
export function dagBadge(tasks: readonly { readonly visual: string }[]): PanelBadge | null {
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
 * screen, so a press moves one row), `Enter`/space pins the focused task, and `Esc` unpins — but ONLY
 * while a task IS pinned, because with nothing to release the press belongs to the host's own
 * `setFocus('chat')` fallback. An unhandled key returns `consumed: false`, which is what leaves the
 * host's own `←`/`→`/`Esc` panel navigation working.
 *
 * THE CONSUMPTION RULE IS THE WHOLE CONTRACT OF A PANEL KEY: the host's plugin-panel dispatcher turns
 * `preventDefault()` into `consumed = true` (`pluginPanelAdapter.js`) and a consumed press never
 * reaches the host's own tail (`useSidePanel.js`), whose Escape branch is the only keyboard way back
 * from the panel to the chat. A key this page does not need must therefore be LEFT UNCONSUMED rather
 * than swallowed "just in case".
 * @param event - the narrowed host key event, or undefined for a value that was not a key event.
 * @param order - the task ids in DRAWING order.
 * @param focus - the task focused right now, when there is one.
 * @param pinned - the task the CLICK PIN holds right now, or undefined when nothing is pinned; it is
 *   a different fact from `focus`, and Escape is consumed only for the pin.
 * @returns the action the page must apply.
 */
export function dagPanelKeyAction(
  event: ReturnType<typeof panelKeyEvent>,
  order: readonly string[],
  focus: string | undefined,
  pinned: string | undefined = undefined,
): DagPanelKeyAction {
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
    // ESCAPE IS THE KEY THAT LEAVES THE PAGE, so it is consumed ONLY when this page has something to
    // RELEASE (frozen PART 1). With a pin it is consumed and unpins; with nothing pinned the press is
    // left UNCONSUMED and the host's own fallback (`useSidePanel.js`:
    // `if (key.escape === true) { setFocus('chat'); stop(); return true }`) returns the keyboard to the
    // chat. THE DEFECT THIS REPLACES: this branch returned `consumed: true` unconditionally, and a
    // consumed press never reaches that fallback — so after `/mpd panel` no typed command reached the
    // registry (measured on a real PTY, `evidence/tui/live-refresh/2026-10-08T07-32-09Z/`).
    if (flags.escape === true || input === "\u001b") {
      return pinned === undefined ? { consumed: false } : { consumed: true, pin: false }
    }
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
 * The rows this page's pinned footer costs, drawn OUTSIDE the scrolling window.
 *
 * Named rather than written as a `1` in the height budget, because that budget is an equation the reader
 * has to be able to check against the frame: two border rows plus the title row plus this footer must
 * add up to the host's measured height, or the last row is clipped (the "no footer" look this wave
 * repairs).
 */
const DAG_FOOTER_ROWS = 1

/**
 * Scroll the viewport the least amount that puts one ROW — or one whole BOX — inside it.
 *
 * The focus invariant, expressed as arithmetic rather than as a heuristic: a row above the window moves
 * the offset UP to it, a row below moves the offset DOWN until its LAST line is the window's last line,
 * and a row already inside changes nothing (scrolling a page that already shows the focus would be
 * motion the user did not ask for).
 *
 * THE UNIT IS THE BOX when the drawing draws boxes (clause A3): a tall drawing is now reached by this
 * scroll instead of being refused, and the page blanks a box the window would cut, so bringing only the
 * box's TOP row into view could land on a picture of nothing. Asking for the offset that shows the
 * box's LAST row is exactly right in both cases — `height` is 1 for a one-row drawing, where the
 * formula is the original `row - viewportRows + 1`.
 * @param viewport - this render's viewport (its `scrollTo` clamps).
 * @param row - the row (or the box's top row) to bring into view.
 * @param height - how many rows the unit occupies, top row included; 1 when it is a single row.
 */
function scrollRowIntoView(viewport: { offset: number; viewportRows: number; max: number; scrollTo: (next: number) => void }, row: number, height: number = 1): void {
  if (row < viewport.offset) {
    viewport.scrollTo(row)
    return
  }
  /** The unit's last row, which is the line that has to end up on screen. */
  const last = row + Math.max(1, Math.floor(height)) - 1
  if (last >= viewport.offset + viewport.viewportRows) {
    // THE PUSH IS CLAMPED TO THE BAND, and that clamp is the whole point: `last - viewportRows + 1` is
    // the smallest offset that still shows the unit, but it is only reachable while the content has a
    // full page below it. On the LAST page of a board it asks for an offset the page cannot honour, and
    // the reader is left one window short of the very row the walk just focused — measured on this
    // suite: a 40-task walk focused `B40` at the last row and asked for exactly that offset, which
    // showed every row EXCEPT `B40`. `max` is the band's own furthest offset, so the correction comes
    // from the one place that defines it rather than from arithmetic re-derived here.
    viewport.scrollTo(Math.min(last - viewport.viewportRows + 1, viewport.max))
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
   * The GROUP FRAME under the pointer, when the pointer landed on a box's border rather than a task.
   *
   * PRESENT ONLY WHEN `taskId` IS ABSENT: a cell inside a task box belongs to the task, because the box is
   * painted over the frame that encloses it — the drawing's own order, kept here so the two identities can
   * never both answer for one click.
   */
  groupId?: string
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
    if (taskId !== undefined) return { taskId, byColumn: true }
    // NOT A TASK: the cell may still be a group frame's own border, which is a box the reader can point at
    // (contract D3's group hit identity). Resolved through the drawing's own rectangles, never re-derived.
    /** The innermost group frame holding the pointer, when one does. */
    const groupId = hitTestGroup(view, row, col)
    return { ...(groupId === undefined ? {} : { groupId }), byColumn: true }
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
  /**
   * Resolves the LIVE team-state feed for the calling session's workspace, per render.
   *
   * Optional so a unit arm can build the page without one: an absent accessor simply means this page
   * keeps its 2 s tick and nothing else changes. The composition root supplies a function whose
   * returned subscribe has a STABLE identity while the service is bound — see `useTeamFeed`.
   */
  subscribeTeams?: TeamFeedAccessor
}

/**
 * Build the DAG page component.
 * @param readWorkflow - reads the MPD team projection for this session's workspace; the wiring passes
 *   the same reader the merged panel and the scenes use, so no two surfaces can describe one team
 *   differently. It takes the CALLING session's id (read off this panel's own host snapshot) because
 *   the team is session-scoped: a reader called with no id must fall back to the marked
 *   workspace-level rule, and one called with an id must never draw another session's board. It is
 *   injected (rather than imported) so this file stays free of the row module.
 * @param options - the row's own deps for this page; omitted by every caller that has no agent page to
 *   open, which is why the parameter is optional and why the second click then says so through a toast.
 * @returns a component matching the host's panel props contract.
 */
export function createDagPanelComponent(readWorkflow: (sessionId?: string) => TeamWorkflow | undefined, options?: DagPageOptions): unknown {
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
    /**
     * The measurements the PREVIOUS render published, used to seed this render's band before the rows exist.
     *
     * WHY A SEED IS NEEDED AT ALL: the whole-box rule below reads the page's own scroll OFFSET while the
     * rows are being built, and the offset is clamped against the page's sizes. A placeholder of "one
     * row" would clamp every render's window to zero and blank the wrong rows the moment the reader
     * scrolls. Seeding from the last render's numbers keeps one generation of geometry for every read in
     * this render; the current numbers are published at the end, for the next one.
     */
    const previousSizes = kit.React.useRef(undefined) as { current: { contentRows: number; viewportRows: number } | undefined }
    /**
     * The cells this page may DRAW IN: the reported width minus the frame's two border cells, minus ONE
     * more for the vertical bar's own cell.
     *
     * THE BAR'S CELL IS ALWAYS RESERVED (the measured gutter defect): when the bar is on screen it is a
     * 1-cell sibling of the content inside the frame, so content rows at the full interior width push it
     * past the frame's right border and it is clipped — the user's scrollbar simply missing. Reserving
     * it unconditionally rather than "only while the bar shows" is deliberate: whether the bar shows is a
     * fact about the page's HEIGHT, which is only known after the rows are built, and a width derived
     * from that fact would flip as the layout's own mode changed the row count — one cell of unused
     * width is the cheap, STABLE side of that trade.
     */
    const contentCols = Math.max(1, panelContentWidth(measured.cols) - 1)
    // THE SESSION ID IS READ, NOT DISCARDED (the defect's other half). The host's snapshot was already
    // read here on every render and thrown away; its `sessionId` is what makes this page able to ask
    // for ITS OWN session's team. The read is contained by `panelSnapshot`, and an unavailable id is a
    // legitimate state (it selects the marked workspace-level fallback), never an error.
    /** The calling session's id, or undefined when this host carries none. */
    const sessionId = panelSessionId(props?.host)
    /** The page's projection for this session, read PER RENDER (the panel must never freeze). */
    let workflow: TeamWorkflow | undefined
    try {
      workflow = readWorkflow(sessionId)
    } catch {
      // An unreadable record costs the drawing, never the page: the empty state says why below.
      workflow = undefined
    }
    /** The page's projection, or undefined when there is no team to draw. */
    let page: DagPage | undefined
    try {
      page = dagPageOf(workflow)
    } catch {
      // An unreadable record costs the drawing, never the page: the empty state says why below.
      page = undefined
    }
    // THE PUSH (PART P). The feed re-renders this page the instant the team state changes, and the
    // 1000 ms tick below STAYS as the fallback: a composition without the feed behaves exactly as it
    // did. The workspace is resolved inside the accessor, per call, so nothing is cached here.
    useTeamFeed(kit.React, options?.subscribeTeams)
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
    /**
     * The rows the window can show, from the height the host reported.
     *
     * THE CHROME IS COUNTED AS IT IS DRAWN, and that arithmetic is the whole of the "footer is cut"
     * defect: the frame's two border rows, the title row and the footer row sit OUTSIDE the scrolling
     * window, so the window is `measured.rows - 4`. The page used to subtract `PANEL_CHROME_ROWS` plus
     * the title row (3), which is one row more than the panel owns — the frame then drew `rows + 1`
     * rows, the host clipped the last one, and the reader lost the footer's position token. The frame
     * is `height: 100%`, so the page's TOTAL is exactly `measured.rows` when the window is full, and
     * that equality is asserted in `panel-dag.test.ts`.
     */
    const windowRows = Math.max(1, (measured.rows ?? DAG_FALLBACK_ROWS) - PANEL_FRAME_BORDER_ROWS - PANEL_TITLE_ROW_ROWS - DAG_FOOTER_ROWS)
    // THE LAYOUT IS TOLD THE ROWS, and it no longer refuses a drawing for exceeding them (clause A3):
    // this page's OWN window is what clips a tall drawing, and `halfBoxRows` blanks the box that would
    // be cut — so a DAG deeper than the sidebar is scrolled, not downgraded to a rail.
    // THE SIZES OBJECT IS THE PAGE'S ONE LIVE MUTABLE FACT SET, and it must EXIST before the layout
    // because the layout's decisions (mode, box form, `labelOverflow`) are it. It is SEEDED with the
    // previous render's counts, not with placeholders: the offset read below (the whole-box window) is a
    // fact about the page as it stands, and a placeholder would report a one-row page on every render.
    // The row counts are then overwritten with this render's OWN numbers after the rows are built; the
    // DRAWING's column count is known right here.
    /** The sizes the hook and every later closure read; written by this render, before anything reads it. */
    const sizes: { contentRows: number; viewportRows: number; contentCols?: number; viewportCols?: number } = { contentRows: previousSizes.current?.contentRows ?? 1, viewportRows: previousSizes.current?.viewportRows ?? windowRows, contentCols: contentCols, viewportCols: contentCols }
    /** The drawing for this render, at the natural width and for the height THIS panel measured. */
    const layout = page === undefined ? undefined : dagPanelLayout(page.tasks, contentCols, focus, windowRows, page.ranks, page.groups)
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
    // THE BADGE IS NO LONGER THIS PAGE'S TO PUBLISH (G2 of the stateless-deployment wave). A sidebar
    // panel is mounted only while it is the ACTIVE page (`mountPolicy: 'active'` in the host), so a
    // page-side publish could only ever badge a page the user is already looking at. `panel-attention.ts`
    // owns the host-side `tuiPanels.badge(id, …)` call from apply, driven by the team feed — which is
    // also the only place that can badge the panel while it is closed. `dagBadge` STAYS the one level
    // ladder: the attention surface calls it with the same task rows.

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
       * this render's — the same one-generation rule the scroll keys above follow. BOTH live cells are
       * passed: the cursor decides where `↑↓/jk` travel, the PIN decides whether Escape has anything to
       * release (frozen PART 1), and a press arriving in one event-loop turn must see what the previous
       * press asked for. */
      const action = dagPanelKeyAction(bare, order, cursorNow(), pinnedNow())
      if (!action.consumed) return
      if (bare?.preventDefault !== undefined) bare.preventDefault()
      if (action.focus !== undefined) {
        moveCursor(action.focus)
        // FOCUS MOVEMENT AUTO-SCROLLS (frozen requirement): the invariant is that the focused node can
        // never be outside the rendered window, so the two features cooperate instead of competing.
        /** The row the newly focused task draws on, when this drawing has one. */
        const at = rowIndex.get(action.focus)
        if (at !== undefined) scrollRowIntoView(viewport, at, layout?.mode === "boxes" ? layout.view.boxRows : 1)
      }
      // A PIN OUTRANKS THE CURSOR while it exists, so pinning takes the same live value the walk just
      // moved to — pinning the RENDERED focus would pin the previous task on a fast walk.
      if (action.pin === true) movePin(cursorNow())
      if (action.pin === false) movePin(undefined)
    })

    /** The rows, in draw order. */
    const children: unknown[] = []
    // (a) THE HOST'S OWN SUBAGENT ROWS, ABOVE THE DRAWING AND INSIDE THIS SAME RICH FRAME (frozen clause
    // C3). This page IS the MPD panel, so the rows the host curates for its sidebar belong here rather
    // than on a page of their own; `subagentSectionRows` owns the field reads, the empty state and the
    // counts, so this file re-derives none of them.
    //
    // THEY ARE PUSHED BEFORE ANY DRAWING ROW, and that is the whole of the row-index contract: the
    // drawing's own indexing below is built from `children.length` AT THE MOMENT each row is pushed, so
    // the pin, the focus auto-scroll and the viewport budget stay ONE hook set over whatever chrome
    // precedes the drawing. A page that computed its rows first and offset them afterwards would be the
    // silent drift the clause names.
    /** The host's curated section, or an EMPTY list on a host that exposes no snapshot. */
    let section: readonly SubagentSectionRow[] = []
    try {
      section = subagentSectionRows(panelSnapshot(props?.host))
    } catch {
      // An unreadable host snapshot costs the host's own rows, never the drawing this page exists for.
      section = []
    }
    // THE SECTION'S OWN TITLE RULE. It is drawn UNCONDITIONALLY, and the reason is that `section` is
    // never empty on a real host: `subagentSectionRows` answers its header plus the host's own EMPTY
    // STATE when there are no subagents, so "no rows to name" is not a state this page can reach — a
    // conditional rule here would be a branch no boot executes. The host's own empty state therefore
    // reads as a named, ruled section that says it has none, which is the sensible empty state.
    children.push(surfaceRule(kit, "section-host", DAG_SECTION_HOST_TITLE))
    for (let index = 0; index < section.length; index += 1) {
      /** This row's own draw instructions, as the host's projection decided them. */
      const row = section[index]
      if (row === undefined) continue
      children.push(textRow(kit, row.text, {
        key: `sub-${index}`,
        ...(row.header === true ? { bold: true } : {}),
        ...(row.dim === true ? { dim: true } : {}),
        maxCells: contentCols,
      }))
    }
    // THE DIVIDER THAT SEPARATES THE TWO SECTIONS (the reported defect: host rows and DAG rows ran into
    // each other with nothing between them). It is the LAST row of the host section and the FIRST thing
    // the drawing reads under, and it is the scene's own `surfaceRule` — never a second divider
    // implementation — so this page and the scene cannot drift into two different-looking rules.
    children.push(surfaceRule(kit, "section-dag", DAG_SECTION_DAG_TITLE))
    // (b) THE MPD DEPENDENCY DAG — the rich frame, the header, the legend, the pin body and the layouts
    // that are the reason this page is the MPD panel.
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
    // THE THREE-STATE HONESTY RULE, drawn. `source` is where THIS projection's team came from, and the
    // page says which of the three states it is in: a session's own board (nothing extra is drawn), the
    // session's honest empty state (`none`), or the marked workspace-level fallback (a visible marker).
    // AN UNLABELLED PROJECTION DRAWS TODAY'S BYTES: every reader in this package sets `source`, and a
    // hand-built fixture that does not is not a session-less READ, so it must not gain a marker row.
    /** Which of the three states this render draws; undefined when the projection is unlabelled. */
    const scope = workflow?.source?.scope
    if (header === undefined && scope === "none") {
      // STATE 2 — THIS SESSION HAS NO TEAM. The user's own defect was a surface drawing ANOTHER
      // session's DAG here; the honest answer is the marker and nothing else, plus the informational
      // count so a reader can tell an empty workspace from a board that belongs to somebody else.
      children.push(textRow(kit, `${NO_SESSION_TEAM_MARKER} — \`agent_teams_plan\` binds one here`, { key: "empty-session", dim: true, maxCells: contentCols }))
      /** How many teams the workspace holds, when the reader could count them. */
      const held = workflow?.source?.workspaceTeams
      if (typeof held === "number" && held > 0) {
        // THE COUNT ROW CARRIES NO SCOPE MARKER (orthogonalized after the blind verifier's finding):
        // `workspace-level` names the state in which NO session id was readable, and a frame scan keyed
        // on it must match that state ALONE. The count belongs to state 2 — this session HAS an id and
        // has no team of its own — so its own row states the workspace fact in words and leaves the
        // token to the state it names. The row's unique marker is `no team in this session`, above.
        children.push(textRow(kit, `this workspace holds ${held} team(s), none bound to this session`, { key: "empty-session-count", dim: true, maxCells: contentCols }))
      }
    } else if (header !== undefined) {
      /** The label/value spans of the header row, each in its own tone. */
      const spans: Array<{ text: string; tone: string }> = []
      for (const fact of header.facts) spans.push({ text: `${fact.label} `, tone: "dim" }, { text: `${fact.value}  `, tone: fact.tone })
      if (header.bar !== "") spans.push({ text: header.bar, tone: "completed" })
      children.push(graphRow(kit, spans.map((span) => ({ text: panelText(span.text, contentCols), tone: span.tone })), { key: "header", cols: contentCols }))
      // STATE 3 — THE MARKED FALLBACK. No session id was readable, so this drawing is the WORKSPACE's
      // principal team; the marker is VISIBLE (never a silent fallback) so a reader can tell that the
      // board is not necessarily their own session's.
      if (scope === "workspace") {
        children.push(textRow(kit, `${WORKSPACE_SCOPE_MARKER}: no session id on this surface, showing the workspace's newest team`, { key: "scope", dim: true, maxCells: contentCols }))
      }
      // C6 — A TEAM WITH AN EMPTY BOARD IS NOT "NO TEAM" (the live 0-task defect). The header above
      // already carries the identity the old projection discarded; these two rows give the page a
      // body: the roster in the scene's own one-line discipline, and the hint that names the call
      // which fills the board. The session arm keeps the sentence the mounted suite pins, and the
      // workspace arm — the one the ladder used to lose to the false "no team in this workspace" row
      // — states whose team it is. An unlabelled projection reads as the workspace fallback, exactly
      // as `TeamWorkflow.source`'s own contract spells it.
      if (page !== undefined && page.tasks.length === 0) {
        children.push(textRow(kit, page.roster, { key: "roster", dim: true, maxCells: contentCols }))
        children.push(textRow(kit, scope === "session" ? "this session's team has no tasks yet — `agent_teams_plan` posts them" : "the workspace's team has no tasks yet — `agent_teams_plan` posts them", { key: "empty-board", dim: true, maxCells: contentCols }))
      }
    } else if (scope === "session") {
      // A TEAM OF THIS SESSION WITH NO TASKS IS NOT "NO TEAM IN THIS WORKSPACE": the record resolved,
      // and the row says what is missing (the board) rather than denying the team that exists.
      children.push(textRow(kit, "this session's team has no tasks yet — `agent_teams_plan` posts them", { key: "empty-session-board", dim: true, maxCells: contentCols }))
    } else {
      // THE EMPTY STATE NAMES THE CALL THAT FILLS IT (frozen clause R10): a panel that only said "no
      // data" would leave the reader with no idea which surface the DAG is fed from.
      children.push(textRow(kit, "no team in this workspace — `agent_teams_plan` stages one", { key: "empty", dim: true, maxCells: contentCols }))
    }
    // `layout` is DEFINED only when `page` is (the ternary above), and both are named here so the
    // mode line can read the page's rank source without an assertion.
    if (layout !== undefined && page !== undefined) {
      /** The contract's own running glyph, which the breath orbit starts from. */
      const baseGlyph = DAG_TONE_GLYPH.running ?? "◐"
      /** The animated glyph for this frame, or the base one when nothing is running. */
      const breathe = runningGlyph(phase)
      /** Whether the breath changes the glyph this render (it is static at the orbit's head). */
      const breathing = breathe !== baseGlyph
      /**
       * The page row the DRAWING's first line occupies, in the column the viewport windows.
       *
       * Captured before the loop because the whole-box rule needs the drawing's pages rows, and the
       * loop is the only place they are known: every drawing line is exactly one child here.
       */
      const dagStart = children.length
      /**
       * The drawing rows this render must leave blank because their box straddles the window edge.
       *
       * BOXES ONLY: the rail and the list draw one line per task, so a line cut by the window's edge
       * loses nothing but the rest of the row — there is no box to break in half. In boxes mode the
       * set is what makes the window rank-aligned (see {@link halfBoxRows}).
       */
      const blankRows = layout.mode === "boxes" ? halfBoxRows(layout.view.hits, dagStart, viewport.offset, windowRows) : new Set<number>()
      /**
       * The FRAME CELLS this render must leave blank, drawing row by row.
       *
       * THE SAME RULE AS {@link halfBoxRows}, ONE LEVEL UP: a box is shown whole or not at all, and a
       * GROUP is a box that contains boxes — so a frame the window would cut loses its FRAME (its sides
       * and its two horizontal rules) rather than being painted as two stubs. Only the frame's own cells
       * go blank; the interior keeps drawing, because a task inside it is bound by its own rule.
       */
      const cutFrameCells = layout.mode === "boxes" ? halfGroupCells(layout.view, dagStart, viewport.offset, windowRows) : new Map<number, Set<number>>()
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
        //
        // A ROW WHOSE BOX THE WINDOW WOULD CUT IS DRAWN AS BLANK, at the window's own width so the column
        // cannot move: a half box is not a picture of anything, and the gutter already says the page
        // continues past the edge. This is the vertical half of the same rule the width guard applies —
        // a box is shown whole or not shown as a box (see {@link halfBoxRows}).
        /** The row's spans: the drawing's own, or a window-wide blank when its box would be cut. */
        /** The frame cells this drawing row must not paint, when a group's frame straddles the window edge. */
        const cutFrame = cutFrameCells.get(index)
        /** The row's spans: the drawing's own, minus a cut frame's cells, or a window-wide blank for a cut box. */
        const spans = blankRows.has(index)
          ? [{ text: " ".repeat(contentCols), tone: "blank" }]
          : sliceSpans(cutFrame === undefined ? phased : blankCells(phased, cutFrame), viewport.colOffset, contentCols)
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
      // THE WORD COMES FROM THE NAMED SOURCE, never from the layout's `derived` flag alone: that flag
      // is `false` by design once a served map is applied, so reading it as "the ranks were served"
      // mislabelled HOST-DERIVED ranks as an untrusted fallback (the verifier's finding).
      children.push(textRow(kit, `view ${layout.mode}${layout.list ? " (dense)" : ""} · ${order.length} tasks · ranks ${ranksPhrase(page.ranksSource, layout.ranksDerived)}`, { key: "mode", dim: true, maxCells: contentCols }))
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
      // THE SAME POSITION-KEY RULE AS THE LEGEND BELOW, for the same reason: this list is rebuilt every
      // render, so a key cut from a line's own text is a duplicate-key defect the moment two lines agree
      // for the key's length. The detail body's labels are distinct today, which is exactly why the
      // defect would arrive silently — the key must not depend on that staying true.
      /** The detail row being pushed, so the key is the position and cannot collide. */
      let detailRow = 0
      for (const line of pinnedDetailLines(pinnedTask, page?.tasks ?? [], contentCols)) {
        children.push(textRow(kit, line, { key: `pin-${detailRow}`, dim: true, maxCells: contentCols }))
        detailRow += 1
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
    // THE KEY IS THE ROW'S POSITION, NEVER ITS TEXT. A content-derived key is a duplicate-key defect
    // waiting on two lines that agree for the key's whole length. The defect this repaired: the drawing
    // module's own five-state key and this legend's first wrapped line both began
    // `✓ completed · ◐ running`, so both were keyed `legend-✓ completed · ◐ running ` — and React,
    // given two children under one key, renders the collided row once more on every re-render: one
    // extra legend row per click until the page overflows, measured at 4 rows after mount and 7 after
    // seven clicks. The drawing's key has since been DELETED (only the contract's six-state key is
    // printed now), but the rule stands on its own: a position key is unique by construction and stable
    // while the legend's line count is, which is what makes the row count invariant across a re-render.
    /** The legend row being pushed, so the key is the position and cannot collide. */
    let legendRow = 0
    for (const line of legendLinesFor(contentCols, arrow)) {
      children.push(textRow(kit, line, { key: `legend-${legendRow}`, dim: true, maxCells: contentCols }))
      legendRow += 1
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
    // THE NEXT RENDER'S WIDTH BUDGET READS THESE (the gutter cell), so they are published where the
    // page's equations are complete — after the rows exist and before anything draws them.
    previousSizes.current = { contentRows: contentRows, viewportRows: windowRows }
    /** The same handle, named for what it does here: the window this render draws. */
    const scroller = viewport
    // THE WHEEL IS BOUND IN TWO PLACES ON PURPOSE, and the pair is what contains the gesture.
    //
    // ON THE ROWS: the host hit-tests the deepest node under the pointer, so binding once around the
    // VISIBLE slice keeps ONE handler in the dispatch path for a wheel over content. The slice itself
    // belongs to `panelViewportBody`, which is why the wrapper is passed TO it rather than built here —
    // wrapping the whole column and handing that back in made this page window TWICE (the body then cut
    // a one-element array at the row offset) and rendered an EMPTY panel whose footer still read
    // `6/82`. Measured exactly that way; one slice, one place.
    //
    // ON THE FRAME: a wheel over the title row, the border, the footer or the gutter used to reach NO
    // MPD handler — the host fell through to the chat behind the panel and scrolled it while the pointer
    // was over the sidebar. The frame handler covers every cell the panel owns; `swallowWheelEvent` stops
    // the event there, so the same tick can never scroll the panel AND the chat.
    /** The wheel binding, applied by the body to the rows it is about to draw. */
    const wheelBound = (boundKit: PanelKit, rows: readonly unknown[]): unknown =>
      boundKit.React.createElement(boundKit.ui.Box, { key: "scroll", flexDirection: "column", onWheel: (event: unknown): void => { swallowWheelEvent(event); scroller.onWheel(event) } }, ...rows)
    // THE FOOTER HINTS (R6/R11): the keys this page handles, and the panel's own `⤢` full-screen control
    // — named here because this hint row is the only place a reader learns that control exists. The
    // composition itself lives in {@link dagFooterText}, which is what the arm asserts: the position
    // first, then the control, then the compact hints.
    /** The pinned footer, carrying the scroll position so the reader can see where they are. */
    const footer = textRow(kit, dagFooterText({
      ...(scroller.overflow ? { vertical: { offset: scroller.offset, max: scroller.max } } : {}),
      ...(scroller.colOverflow ? { horizontal: { offset: scroller.colOffset, max: scroller.colMax } } : {}),
    }), { key: "keys", dim: true, maxCells: contentCols })
    /** The visible slice plus its reserved gutter column. */
    const body = panelViewportBody(kit, children, scroller, true, wheelBound)
    // THE TITLE ROW IS OUTSIDE THE WINDOW, immediately under the frame's top border: the page's own
    // name and MPD's `⤢`, both pinned, so the control sits at the same cell however far the drawing
    // scrolls. It is the SAME implementation the workmate page uses — one definition of the chrome,
    // so the two pages cannot drift into two different-looking affordances.
    //
    // WHY THE PAGE DRAWS IT AND THE HOST CANNOT: measured on dsh-tui 0.13.0, `dsh-adapter/panels.js`
    // freezes a plugin descriptor WITHOUT `capabilities`, while `SidePanelColumn.js`'s `canExpand` reads
    // `definition.capabilities?.fullscreen === true` — so no plugin panel ever gets the host's own `⤢`.
    /** This page's chrome row: its title and the full-screen control. */
    const titleRow = usePanelTitleRow(kit, { key: "title", title: DAG_PANEL_TITLE, cols: contentCols, ...(options?.openFullscreen === undefined ? {} : { open: options.openFullscreen }) })
    // THE TITLE IS DRAWN ONCE (the duplicated-heading defect): the frame carries NO border title here,
    // because the title row below its top border already says `MPD` and the section rule says which
    // part of the page follows. Three headings for one panel — the host's panel-bar title, the frame's
    // border text, this row — is what the screenshot showed as a doubled `MPD`, and the row is the one
    // that must survive: it is the only one that also carries the `⤢` control.
    //
    // THE FRAME CARRIES THE WHEEL, so a gesture over the title, the border or the footer is still the
    // panel's (see `wheelBound` above) and can never fall through to the chat behind the panel.
    return panelFrame(kit, "", [titleRow, ...body, footer], { onWheel: (event: unknown): void => { swallowWheelEvent(event); scroller.onWheel(event) } })
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
