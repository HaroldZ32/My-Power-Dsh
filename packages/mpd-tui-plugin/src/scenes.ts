// Seam 8 — `ctx.tuiScenes`: the full-screen mpd surfaces.
//
// THREE scenes ride the ONE `tuiScenes` registration seam:
//   * `mpd-tui-board`  — the pre-existing mpd board (team/task ledger, boulder, plans, workmates);
//   * `mpd-tui-team`   — the team-workflow surface (frozen contract `.mpd/plans/tui-team-surface.md` §3.1);
//   * `mpd-tui-plan`   — the plan-approval surface (§3.2), the TUI counterpart of the Web plan panel.
//
// The board is the TUI-native equivalent of the web-only surfaces (AGENTS.md §6
// / plan W-3): team + task ledger, boulder work ledger, plans and the durable
// workmate library in one screen.
//
// Conventions (t3 brief §b, spec §接缝八): a scene owns ALL chrome — title bar,
// counts, key-hint footer — and the exit keys (Esc/q, layered: Esc returns to
// whatever screen was up before, and the host handles its own overlays first).
// Layout uses `flexGrow` plus the host's terminal-size hook instead of assuming a
// fixed geometry; ONE scene is on screen at a time (the host enforces that).
//
// Scene red lines honoured here: no stdout writes, no synchronous I/O in the
// render path (the snapshot is read in an effect and refreshed on a timer), and
// no session events appended by the scene itself.
//
// MUTATION BOUNDARY (frozen §6): the plan surface mutates ONLY by calling the
// adopted agent-teams tools through `mpd-dsh-adapter-plugin`. The executor is
// injected as {@link PlanActions} by `index.ts`, which owns the adapter; this file
// never touches a harness seam and never writes team state.
//
// React contract: every hook and element uses the React instance and ui kit the
// host injects through the scene props; this file therefore never imports React
// (it uses `props.React.createElement`, the documented always-safe form).
import { TUI_SEAMS } from "./types.js"
import { t } from "./i18n.js"
import type { PluginContextLike, SeamOutcome, TuiAdapter, TuiScenePropsLike } from "./types.js"
import type { Log } from "./log.js"
import { boardLines, readBoardState, statusLine, type BoardState } from "./state.js"
import { cellWidth, clampCells, stripControl } from "./sanitize.js"
import type { TeamTaskRow, TeamWorkflow } from "./team-state.js"
import {
  approvalPhrase,
  modelRanks,
  modelRows,
  NO_SESSION_TEAM_MARKER,
  planProjectionLines,
  readScopedWorkflow,
  sessionIdOf,
  sessionRecord,
  sessionViewsOf,
  teamWorkflowLines,
  WORKSPACE_SCOPE_MARKER,
  type MpdPlanView,
  type MpdTeamsLike,
  type TeamSourceDeps,
} from "./team-state.js"
import { boxesFitWidth, hitTest, layoutGraph, layoutGraphNatural, layoutRail, legendLines, sliceSpans } from "./graph.js"
import { DAG_ANIM, DAG_TONE_GLYPH } from "./dag-theme.js"
import { legendLinesFor, normalizeWheelDelta, panelKit, panelSurfaceWidth, runningGlyph, swallowWheelEvent, toneColor, usePanelViewport, useTeamFeed, viewportTrack, visualTone, wheelInvertOn, type PanelKit, type PanelViewport } from "./panel-core.ts"
import { statusMarker } from "./status.js"
import {
  SUBAGENT_SCENE_ID,
  SUBAGENT_SCENE_TITLE,
  animPhase,
  barCells,
  chromeTitle,
  createSubagentSceneComponent,
  runningMarker,
  stateMarker,
  surfaceBodyRow,
  surfaceFrame,
  surfaceHints,
  surfaceRule,
  surfaceText,
  toneOfTally,
  useSurfaceClock,
  type SurfaceKit,
  type SurfaceTone,
} from "./subagent-scene.js"
import type { TeamRecord } from "../../mpd-team-core-plugin/src/team-store.js"
import type { DshTeamView } from "../../mpd-dsh-adapter-plugin/src/index.js"

/** Unique, kebab-case scene id. */
export const BOARD_SCENE_ID = "mpd-tui-board"
/** The team-workflow scene id (frozen §3.1). */
export const TEAM_SCENE_ID = "mpd-tui-team"
/** The plan-approval scene id (frozen §3.2). */
export const PLAN_SCENE_ID = "mpd-tui-plan"

/**
 * The column count assumed before the host has measured one.
 *
 * 100 is a deliberate middle: wide enough that the boxed graph is drawn (so an unmeasured first
 * render already looks like the finished surface), narrow enough that nothing is laid out for a
 * terminal larger than the one it lands on. The host re-measures on the next render.
 */
const FALLBACK_COLS = 100

/** Refresh cadence of the board's own state snapshot. */
const BOARD_REFRESH_MS = 2000
/** The discard arm window (frozen §4.3): the second Ctrl+D must land inside it. */
export const DISCARD_WINDOW_MS = 10_000

/**
 * The cell budget of ONE rendered scene row (contract §9.4's "row budget large enough
 * not to truncate legitimate long DAG/deps rows").
 *
 * A worst-case DAG row is ~40 (id) + 40 (kind) + 160 (subject) + 40 (status) + 80
 * (assignee) + numbers + the dependency list; 4000 cells is roughly two orders of
 * magnitude above any row the adopted plugin can produce (teams are tens of tasks),
 * while still bounding a pathological record.
 */
export const SCENE_ROW_MAX_CELLS = 4000

/**
 * Why the plan surface cannot mutate anything on this harness (0.1.7).
 *
 * The two tools this surface used to call — the retired plugin's `agent_teams_approve` (approve a
 * STAGED plan) and `agent_teams_delete` (archive a team) — are GONE with the plugin that registered
 * them, and the OFFICIAL Agent Teams plane has NO equivalent: a team IS its Lead session (there is
 * nothing separate to approve or archive) and `teamListTasks` publishes no staged plan to approve.
 * Every refusal therefore states this instead of naming a tool that could be looked up.
 */
export const PLAN_MUTATION_UNAVAILABLE =
  "no plan approval exists on the official Agent Teams plane (0.1.7): a team is its Lead session and its board is live"

/**
 * One mutation outcome. `error` is the tool's OWN text (model-authored content can
 * reach it); {@link safeLine} is the render boundary that strips control characters
 * and clamps it before it reaches `ui.Text` (§9.4). The scene never reports success
 * from a failed call.
 */
export interface PlanActionOutcome {
  /** Whether the call succeeded; the scene never reports success from a failed call. */
  ok: boolean
  /** The tool's structured value when it returned one; its shape is not contractual. */
  value?: unknown
  /** The tool's own error text, which can be model-authored and is sanitized at the render boundary. */
  error?: string
}

/**
 * The approval seam: the two mutations the plan scene may perform. The executor
 * is built by the composition root, which owns the `mpdDsh` adapter — a scene
 * never resolves a harness service itself (§6.1).
 */
export interface PlanActions {
  /** Whether this composition can perform the mutations at all (never true on the 0.1.7 plane). */
  available(): boolean
  /**
   * Approves a staged plan once the user typed the exact phrase; never fabricates success.
   *
   * `sessionId` IS NOT OPTIONAL DECORATION. The tool this rides resolves its own context from the
   * caller it is invoked with — `where(exec)` = `{ workspace: dsh.workspaceRoot(exec), sessionId:
   * sessionIdOf(exec) }` — so a call made without one cannot find the right workspace or session. The
   * scene acts FOR the session it belongs to, and it reads that id off its own live channel.
   */
  approve(input: { teamId: string; confirmation: string; captainSessionId?: string; sessionId?: string }): Promise<PlanActionOutcome>
  /** Archives a staged plan; the scene arms it with a second Ctrl+D inside the frozen window. */
  discard(input: { captainSessionId?: string; sessionId?: string }): Promise<PlanActionOutcome>
}

/** The honest default: what a composition without the executor gets (never a fake success). */
export const UNAVAILABLE_PLAN_ACTIONS: PlanActions = {
  available: () => false,
  approve: async () => ({ ok: false, error: PLAN_MUTATION_UNAVAILABLE }),
  discard: async () => ({ ok: false, error: PLAN_MUTATION_UNAVAILABLE }),
}

/** Navigation shared by the surfaces (which team, and where Esc returns). */
interface SceneNav {
  /** The team the plan scene must act on; undefined = the newest record. */
  planTeamId?: string
  /** True when the plan scene was opened FROM the team scene. */
  planFromTeam: boolean
}

/** The scene seam handle: the measured outcome plus the three open paths. */
export interface SceneSeam {
  /** The registration result, as the boot diagnostic reports it. */
  outcome(): SeamOutcome
  /** Open the board; false when the seam is absent or the id is unknown to the host. */
  open(): boolean
  /** Open any registered scene by id. */
  openScene(id: string): boolean
  /** Open the team-workflow surface for the newest team. */
  openTeam(): boolean
  /** Open the plan-approval surface. */
  openPlan(options?: { teamId?: string; returnToTeam?: boolean }): boolean
  /** Open the merged panel: the host's own subagent rows above the MPD team body. */
  openSubagents(): boolean
}

/** A no-op store subscription, so the hook order stays stable without a channel. */
function noopSubscribe(): () => void {
  return () => {}
}

/**
 * THE render boundary for every string this package hands to the host's `ui.Text`
 * (contract §9.4): strip C0/C1 control characters and clamp by terminal cell.
 *
 * `stripControl` + `clampCells` is the correct pair here rather than `scalarText`:
 * `scalarText` also COLLAPSES whitespace, which would eat the DAG's depth indentation
 * (§3.1 item 4) and the roster's leading indent. Untrusted input reaches this boundary
 * from two directions — a tool error message (model-authored) and a record/directory
 * name from `.mpd/team/**` — so it is applied once, here, to every row.
 * @param value - the candidate row text.
 * @returns the sanitized, clamped row; never throws.
 */
export function safeLine(value: unknown): string {
  /** The candidate as text: a string as-is, anything else through `String`, nullish as empty. */
  const raw = typeof value === "string" ? value : String(value ?? "")
  return clampCells(stripControl(raw), SCENE_ROW_MAX_CELLS)
}

/**
 * Whether the host handed this scene a usable React instance and ui kit.
 *
 * Null is as hostile as undefined here: `props.ui.Box` on a null kit would throw
 * INSIDE the render path and take the surface — and the session — down. That is
 * the task's own last acceptance criterion, so every component checks it first.
 * @param React - the host React instance.
 * @param ui - the host ui kit.
 * @returns true when both are usable.
 */
function usableKit(React: unknown, ui: any): boolean {
  if (React === undefined || React === null) return false
  if (ui === undefined || ui === null) return false
  return typeof ui.Box === "function" && typeof ui.Text === "function"
}

/**
 * This file's React and ui kit, in the SHARED BUILDERS' own shape.
 *
 * `scenes.ts` and `subagent-scene.ts` each declare a structural shape for the host's kit, because each
 * narrows what it calls; this is where the two meet, ONCE per render, rather than a cast at every call
 * site. The caller has already proved the kit usable ({@link usableKit}), which is what makes the cast
 * sound: every member the builders read (`React.createElement`, `ui.Box`, `ui.Text`) is present.
 * THE KIT ALSO CARRIES THE FRAME'S INTERIOR WIDTH (frozen criterion W2), but NOT through this function:
 * the width only exists once the scene has measured its terminal, and every scene measures AFTER it has
 * taken this kit, so it records the budget on the returned object (`surface.maxCells = contentCols`) at
 * that point. Every row the scene builds afterwards is clamped to it by default, through
 * `surfaceText`/`surfaceBodyRow`; a kit that never receives one keeps the builder's own default, exactly
 * as before.
 * @param React - the host React instance.
 * @param ui - the host ui kit.
 * @returns the kit as the shared surface builders take it, without an interior width yet.
 */
function surfaceKit(React: unknown, ui: unknown): SurfaceKit {
  return { React, ui } as unknown as SurfaceKit
}

/**
 * The calling session's id, read off a scene's own live channel.
 *
 * ONE definition for all four scenes: the channel is the only piece of session identity a full-screen
 * surface has, and `sessionIdOf` is the same reader the sidebar panel uses on its host snapshot, so the
 * two planes cannot disagree about what counts as a usable id. It is read PER CALL, never cached: the
 * host hands the same channel OBJECT across renders but its `sessionId` is published later.
 * @param props - the scene props the host passed.
 * @returns the session id, or undefined when the channel carries none yet.
 */
function channelSessionOf(props: TuiScenePropsLike | undefined): string | undefined {
  return sessionIdOf(props?.channel)
}

/**
 * THIS session's own team records, as a one-element list — or none at all.
 *
 * It exists so the board surface can reuse `readBoardState`'s existing selection rule instead of
 * growing a second copy of it: that rule is "the newest not-ended record, else the newest, else the
 * official readout", and handing it only THIS session's record makes the whole rule session-scoped by
 * construction. Another session's record is never in the list, so it can never be drawn.
 * @param teamDeps - the session-scoped team reads (the `mpdTeams` face).
 * @param workspace - the workspace resolved for THIS read.
 * @param sessionId - the calling session's id.
 * @param records - this workspace's records, newest first.
 * @returns the records this session owns; `[]` when it has none.
 */
function scopedRecordsFor(teamDeps: TeamSourceDeps | undefined, workspace: string, sessionId: string, records: readonly TeamRecord[]): readonly TeamRecord[] {
  /** The service face for THIS call, or undefined when this composition has no team row. */
  let service: MpdTeamsLike | undefined
  try {
    service = teamDeps?.teams?.()
  } catch {
    service = undefined
  }
  /** The record that belongs to this session, through the one session resolver. */
  const mine = sessionRecord(service, workspace, sessionId, records)
  return mine === undefined ? [] : [mine]
}

/**
 * Read one scene's team projection, SESSION-SCOPED.
 *
 * The `sessionId` is the calling scene's own (its live channel's id). It is what makes the read
 * session-scoped rather than workspace-blind: with an id, another session's record is never consulted
 * and a session with no team gets the honest empty projection; without one (an older host, a channel
 * that has not bound) today's workspace-principal behaviour survives and is MARKED as such in the
 * projection's `source`. Every step is contained, and the whole body has one last net, because a scene
 * renders inside the host's own error boundary and a throw costs the user the screen.
 * @param workspaceRoot - resolves the workspace root per call; never cached.
 * @param holds - the watchdog's held team ids for the workspace.
 * @param teamViews - the official team readout for that workspace, resolved per call.
 * @param teamRecords - the mpd-owned team records for that workspace, resolved per call.
 * @param teams - the `mpdTeams` face, resolved per call; undefined when this composition has no team row.
 * @param sessionId - the calling session's id, or undefined when this surface cannot read one.
 * @returns the projection, or undefined when the read could not even be attempted; never throws.
 */
function readWorkflow(workspaceRoot: () => string, holds: () => readonly string[], teamViews?: () => readonly DshTeamView[], teamRecords?: () => readonly TeamRecord[], teams?: () => MpdTeamsLike | undefined, sessionId?: string): TeamWorkflow | undefined {
  try {
    /** The watchdog's held team ids; empty when that read fails. */
    let holdIds: readonly string[] = []
    try {
      holdIds = holds() ?? []
    } catch {
      holdIds = []
    }
    /** The live team views for this workspace; empty when that read fails. */
    let views: readonly DshTeamView[] = []
    try {
      views = teamViews?.() ?? []
    } catch {
      views = []
    }
    /** The mpd-owned team records for this workspace; empty when that read fails. */
    let records: readonly TeamRecord[] = []
    try {
      records = teamRecords?.() ?? []
    } catch {
      records = []
    }
    /** The `mpdTeams` face for THIS call, or undefined when this composition has no team row. */
    let service: MpdTeamsLike | undefined
    try {
      service = teams?.()
    } catch {
      service = undefined
    }
    // THE WORKSPACE IS RESOLVED PER CALL (§6), and the SESSION is what selects the team: with an id the
    // read can only ever answer with THIS session's board, and with none it runs the marked fallback.
    return readScopedWorkflow({
      workspace: workspaceRoot(),
      ...(sessionId === undefined || sessionId === "" ? {} : { sessionId }),
      holds: holdIds,
      ...(service === undefined ? {} : { teams: service }),
      records,
      views,
    })
  } catch {
    return undefined
  }
}

/**
 * Measure the terminal through the host's own hook (called ONCE per render, so the
 * hook order never changes) and derive the body window from it.
 * @param ui - the host ui kit.
 * @returns the size label and the number of body rows that fit.
 */
/**
 * Wrap a line on word boundaries to a cell budget.
 * @param value - the text to wrap.
 * @param cols - the cells available per line.
 * @returns the wrapped chunks; a single over-long word is left intact rather than split.
 */
function wrapCells(value: string, cols: number): string[] {
  /** The wrapped chunks. */
  const out: string[] = []
  /** The line being assembled. */
  let line = ""
  for (const word of value.split(" ")) {
    /** The line this word would produce. */
    const next = line === "" ? word : `${line} ${word}`
    if (cellWidth(next) > cols && line !== "") { out.push(line); line = word } else line = next
  }
  if (line !== "") out.push(line)
  return out
}

/**
 * Measure the host's terminal through its own hook, once per render.
 * @param ui - the host ui kit.
 * @returns the size label, the column count the graph sizes itself from, the body row budget and the FULL measured row count (which is what a windowed body budgets against).
 */
function measureTerminal(ui: any): { size: string; cols: number; window: number; rows: number } {
  if (typeof ui?.useTerminalSize !== "function") return { size: "", cols: FALLBACK_COLS, window: 20, rows: 26 }
  /** The measured column count, `?` until the host hook answers. */
  let columns: unknown = "?"
  /** The measured row count, `?` until the host hook answers. */
  let rows: unknown = "?"
  /** The host hook's own measurement object, when it returned one. */
  const measured = ui.useTerminalSize()
  if (measured !== undefined && measured !== null) {
    columns = measured.columns ?? "?"
    rows = measured.rows ?? "?"
  }
  /** The row count as a number; NaN when the host measured none. */
  const terminalRows = Number(rows)
  /** The `<columns>x<rows>` size label of the scene title; empty when unmeasured. */
  const size = `${String(columns)}x${String(rows)}`
  /** The column count as a number, for the graph's own geometry. */
  const terminalCols = Number(columns)
  // The scene owns its chrome (title, meta, notice, footer), so the body window is
  // what is left. A sensible minimum keeps it usable before the first measurement.
  /** Whether the host really measured a usable row count. */
  const usableRows = Number.isFinite(terminalRows) && terminalRows > 8
  return {
    size,
    // A MEASURED TERMINAL IS ALWAYS HONOURED (frozen criterion W5): the old `> 20` gate replaced a
    // perfectly good 24-column measurement with the 100-column fallback, and the first frame then drew
    // rows four or more cells wider than the terminal that was measured. The fallback now covers ONLY
    // the unmeasured case, which is the state it is documented for.
    cols: Number.isFinite(terminalCols) && terminalCols > 0 ? Math.floor(terminalCols) : FALLBACK_COLS,
    window: usableRows ? terminalRows - 6 : 20,
    // THE RAW ROW COUNT is what a WINDOWED body budgets against: the frame's two border rows and the
    // pinned header/footer are subtracted from the terminal itself, never from a guess at the chrome.
    rows: usableRows ? terminalRows : 26,
  }
}

/**
 * The rows one content width of the team scene produces, plus the drawing facts its gestures read.
 *
 * THE SPLIT IS WHAT MAKES THE BODY REACHABLE. `head` is the pinned header (identity, state, counts,
 * roster and the drawing's own title row), `tail` is every row BELOW the drawing (the horizontal rail,
 * the legend, the state key, the detail pane, the problems and the notice) and `graphLines` is how many
 * DRAWING rows the region carries — the drawing's rows are built one at a time through
 * {@link TeamDraw.graphRow}, so only the slice on screen is ever assembled. A body pushed
 * unconditionally is exactly what the host clips on a short terminal (contract §3's second missing
 * half), so the scene needs its rows as DATA before it can window them.
 */
interface TeamDraw {
  /** The pinned header rows, always drawn above the window. */
  head: unknown[]
  /** The non-drawing rows, in draw order, after the drawing inside the window. */
  tail: unknown[]
  /** How many rows the DRAWING contributes to the window's content. */
  graphLines: number
  /** One drawing row, animated and cut to this width's horizontal viewport. */
  graphRow: (index: number) => unknown
  /** The drawing this width produced, which the pointer handlers resolve against. */
  view: ReturnType<typeof layoutGraph>
  /** The cells the drawing was cut to. */
  graphWidth: number
  /** The horizontal offset this drawing renders at, clamped. */
  scrollXAt: number
  /** The furthest horizontal offset this drawing allows. */
  scrollXMax: number
}

/**
 * The scene's own clock, PAUSED while nothing runs.
 *
 * THIS IS `subagent-scene.ts`'s `useSurfaceClock` WITH THE ONE DIFFERENCE THIS WAVE REQUIRES: the
 * interval handed to the host's `useAnimationFrame` is `null` when no marker is running, and `null` is
 * the documented PAUSE of the one legal scene timer (the same pause `panel-core.ts`'s `useRunningPhase`
 * uses for a sidebar page). The helper is repeated here rather than edited there because that file
 * belongs to another lane this wave; a scene that could not pause would keep the host's frame loop
 * alive forever on a surface with nothing to animate (contract §5.A4c: the animation stops when
 * nothing runs).
 * @param ui - the host ui kit, whose SCENE timer is the `useAnimationFrame` pair.
 * @param live - whether any row on this surface is running; false pauses the host's loop.
 * @returns the clock in milliseconds (0 when nothing runs or the host has no timer) plus the ref the animated element must carry.
 */
function useSceneClock(ui: any, live: boolean): { time: number; ref: unknown } {
  if (typeof ui?.useAnimationFrame === "function") {
    /** The host's own pair: the ref that keeps the clock alive, and the current time. */
    const pair = ui.useAnimationFrame(live ? DAG_ANIM.intervalMs : null)
    /** The ref (first) and the time (second), whatever shape the host returned. */
    const ref = Array.isArray(pair) ? pair[0] : undefined
    /** The clock, narrowed to a finite number. */
    const time = Number(Array.isArray(pair) ? pair[1] : 0)
    return { time: Number.isFinite(time) ? time : 0, ref }
  }
  if (typeof ui?.useAnimationTime === "function") {
    /** The panel kit's clock, narrowed to a finite number, paused the same way. */
    const time = Number(ui.useAnimationTime(live ? DAG_ANIM.intervalMs : null))
    return { time: Number.isFinite(time) ? time : 0, ref: undefined }
  }
  return { time: 0, ref: undefined }
}

/**
 * The frame's children for a WINDOWED body: the pinned header, the window and the pinned footer.
 *
 * THE WINDOW IS TWO SIBLINGS IN A ROW BOX, not a column with a bar painted into each row's last cell.
 * The rail must reserve its ONE column for the whole body — a bar appended to a row's text would make
 * every row one cell wider than the frame's interior and the host would REWRAP it, which is the class
 * of defect this wave exists to remove. A short body (the builder answers no rail) keeps the exact
 * element order it always had.
 *
 * THE RAIL IS THE SHARED BUILDER (frozen criteria I1/I5): `viewportTrack` draws `panel-core.ts`'s own
 * gutter cells and wires the host's three drag phases through the viewport handle, so the scene's
 * scrollbar carries exactly the sidebar's semantics — a DELTA drag, plus a click that jumps the track.
 * @param surface - the host kit in the shared builders' shape.
 * @param panel - the same host in the PANEL kit's shape, which the rail builder takes.
 * @param viewport - this render's viewport: the ONE position the window and the rail both read.
 * @param head - the pinned header rows.
 * @param region - the rows the window shows, already sliced to the viewport's height.
 * @param footer - the pinned footer rows.
 * @returns the frame's children, in draw order.
 */
function windowedBody(
  surface: SurfaceKit,
  panel: PanelKit,
  viewport: PanelViewport,
  head: readonly unknown[],
  region: readonly unknown[],
  footer: readonly unknown[],
): unknown[] {
  /** The window's own rows, in one column so the host stacks them in draw order. */
  const rows = surface.React.createElement(surface.ui.Box, { key: "body-rows", flexDirection: "column", flexGrow: 1 }, ...region)
  /** The rail, absent when everything fits. */
  const gutter = viewportTrack(panel, viewport, "row")
  /** The window: the rows and the rail as siblings, so the rail owns exactly one column. */
  const window = gutter === undefined
    ? rows
    : surface.React.createElement(surface.ui.Box, { key: "body-window", flexDirection: "row", flexGrow: 1 }, rows, gutter)
  return [...head, window, ...footer]
}

/**
 * Build the board component.
 * @param workspaceRoot - resolves the workspace root per call.
 * @param home - resolves the home directory per call.
 * @param holds - the watchdog's held team ids for the workspace.
 * @param nav - the shared surface navigation.
 * @param openScene - opens a scene by id.
 * @param teamViews - the official team readout, resolved per call.
 * @param teamRecords - the mpd-owned team records, resolved per call.
 * @param onHostKit - receives the host's own `ui` kit on every render.
 * @param teamDeps - the session-scoped team reads: the `mpdTeams` face for the session resolver and
 *   the live feed that re-reads this page on a change. Optional, so a caller that has neither keeps
 *   the pre-existing workspace-level behaviour with its 2000 ms tick.
 * @returns a component matching the host's `TuiSceneProps` contract.
 */
function createBoardComponent(
  workspaceRoot: () => string,
  home: () => string,
  holds: () => readonly string[],
  nav: SceneNav,
  openScene: (id: string) => boolean,
  teamViews?: () => readonly DshTeamView[],
  teamRecords?: () => readonly TeamRecord[],
  onHostKit?: (ui: unknown) => unknown,
  teamDeps?: TeamSourceDeps,
): unknown {
  return function MpdTuiBoard(props: TuiScenePropsLike): unknown {
    /** The host's own React instance; every hook and element must use it. */
    const React = props?.React
    /** The host's ui kit (Box, Text, useInput, useTerminalSize). */
    const ui = props?.ui
    /** Leaves the scene; a host without the callback gets a no-op, so a key never throws. */
    const close = typeof props?.close === "function" ? props.close : () => {}
    if (!usableKit(React, ui)) {
      // The host kit is the hard contract; without it, render nothing rather
      // than crash the reconciler.
      return null
    }
    // THE KIT IS THE ONE LIVE HOST CONTACT. A scene is the only surface the host hands its own
    // `ui` namespace to, and that object's `useStdin` resolves the LIVE context value where an
    // imported module's does not (measured, dsh-tui 0.12.0) — so every scene reports it once per
    // render and the adapter keeps the newest one.
    onHostKit?.(ui)
    /** The host kit in the shared builders' shape; taken once per render, never per call. */
    const surface = surfaceKit(React, ui)

    /** Reads the board projection and the rows drawn from it, degrading to one explicit line. */
    const read = (): { rows: string[]; state?: BoardState } => {
      try {
        // THE TEAM HALF IS SESSION-SCOPED TOO, through the FILTERED ARRAYS rather than a second
        // selection rule: `readBoardState` picks the newest not-ended record and falls back to the
        // official readout on its own, so handing it only THIS session's record and only THIS
        // session's views makes its existing rule session-scoped without a second copy of it.
        /** The calling session's id, read off the live channel at call time. */
        const sessionId = channelSessionOf(props)
        /** This session's own record, or none: never another session's. */
        const scopedRecords = sessionId === undefined ? (teamRecords?.() ?? []) : scopedRecordsFor(teamDeps, workspaceRoot(), sessionId, teamRecords?.() ?? [])
        /** The official views this session owns; every view when no id is readable. */
        const scopedViews = teamViews?.() ?? []
        /** This read's projection, which carries the tally the surface's own tone reports. */
        const state = readBoardState(workspaceRoot(), home(), sessionId === undefined ? scopedViews : sessionViewsOf(scopedViews, sessionId), scopedRecords)
        return { rows: boardLines(state, holds()), state }
      } catch {
        return { rows: ["board state unreadable"] }
      }
    }

    /** The board projection and its rows as host state; the initial read happens in the effect below. */
    const state = React.useState({ rows: [] as string[] } as { rows: string[]; state?: BoardState })
    /** The current read, the value this render draws. */
    const board = state[0] as { rows: string[]; state?: BoardState }
    /** The rows drawn from it. */
    const rows = board.rows
    /** Replaces the read: the initial read, the refresh key and the timer all use it. */
    const setBoard = state[1] as (next: { rows: string[]; state?: BoardState }) => void
    // THE BOARD'S OWN WINDOW (contract §5.A4's audit item: this scene had NO scroll at all). The read is
    // one row per board line, and `boardLines` grows with the workspace's team, boulder, plans, workmates
    // and problems — on a short terminal the host used to CLIP the tail with no way to reach it. THE
    // POSITION IS THE SHARED VIEWPORT HANDLE below (frozen criterion I5), created once `measured` is known
    // because its band is this page's own heights; the keys, the wheel and the rail all drive that ONE
    // number, so no gesture can disagree with the scrollbar about where the window sits.

    // THE PUSH (PART P): a team-state change re-reads this page instead of waiting up to 2000 ms for
    // the tick below, which STAYS as the fallback for a composition with no feed.
    useTeamFeed(React, teamDeps?.subscribeTeams, () => setBoard(read()))

    React.useEffect(() => {
      // Initial read is deferred to the effect: the render path stays free of
      // synchronous I/O (scene red line).
      setBoard(read())
      /** The refresh timer, absent when the host refused to schedule one. */
      let timer: ReturnType<typeof setInterval> | undefined
      try {
        timer = setInterval(() => setBoard(read()), BOARD_REFRESH_MS)
      } catch {
        timer = undefined
      }
      return () => {
        if (timer !== undefined) {
          try {
            clearInterval(timer)
          } catch {
            // already cleared
          }
        }
      }
    }, [])

    // The shared clock, taken at a FIXED hook position (see `subagent-scene.ts`): a host with no timer
    // answers 0, and every animated cell then draws the frozen static frame.
    /** The host clock and the ref the animated element must carry. */
    const clock = useSurfaceClock(ui)
    /** The phase the state marker breathes at. */
    const phase = animPhase(clock.time)

    // Host terminal-size hook (conventions §b): the scene adapts instead of
    // assuming a geometry. Always called, with a safe fallback shape.
    const measured = measureTerminal(ui)
    // THE FRAME'S INTERIOR IS THIS SCENE'S ONE CONTENT WIDTH (frozen criterion W1): the terminal's width
    // minus the border and padding `surfaceFrame` spends inside it. Every row below is budgeted against
    // it, so no row can be wider than the room it is drawn in and be wrapped by the host.
    /** How many cells the frame's interior offers this render. */
    const contentCols = panelSurfaceWidth(measured.cols)
    // The kit is this render's own object, so recording the budget on it is what makes every later
    // `surfaceText`/`surfaceBodyRow` call clamped without threading a parameter through each one.
    surface.maxCells = contentCols
    /** The same host in the PANEL kit's shape, which the viewport and rail builders take. */
    // Sound because every scene proved this host usable through `usableKit` before a hook ran: the two
    // declarations differ in their React members alone, and the builders only call `createElement`.
    const panel = panelKit(React, ui) as PanelKit
    /**
     * The sizes the viewport hook and every later closure read.
     *
     * The row counts are written LATER in this render, once the board's own lines are known; the handle
     * reads through this object, so those writes are visible to it (one generation, never two).
     */
    const sizes: { contentRows: number; viewportRows: number } = { contentRows: 1, viewportRows: 1 }
    /** The board's ONE scroll position: the keys, the wheel and the rail all drive this handle. */
    const viewport = usePanelViewport(panel, () => sizes)
    /** The measured terminal size label, empty when the host could not measure. */
    const size = measured.size
    // THE WINDOW BUDGET of this page: the terminal minus the frame's two border rows, the three PINNED
    // header rows (title, meta, rule) and the pinned footer. The body lines are what is left — the same
    // arithmetic the team scene's window uses, so the two pages page alike.
    /** How many board lines the window can show at once; never below one. */
    const viewportRows = Math.max(1, measured.rows - 2 - 3 - 1)
    // THE HANDLE IS TOLD THIS RENDER'S SIZE BEFORE ANY GESTURE READS IT, so every read below is clamped
    // against the page as it stands rather than against the placeholder the hook was constructed with.
    sizes.contentRows = Math.max(1, rows.length)
    sizes.viewportRows = viewportRows
    /** The furthest offset that still fills the window; zero when the board fits. */
    const scrollMax = viewport.max
    /** The offset for THIS render, clamped — the one value the window and the rail both read. */
    const scrollAt = viewport.offset

    if (typeof ui.useInput === "function") {
      ui.useInput((input: string, key: { escape?: boolean; ctrl?: boolean; shift?: boolean; upArrow?: boolean; downArrow?: boolean; pageUp?: boolean; pageDown?: boolean; home?: boolean; end?: boolean } | undefined) => {
        if (key?.escape === true || input === "q") close()
        // THE WINDOW'S OWN KEYS: the same gestures the team scene and the `dag` page answer, so a reader
        // learns ONE scroll vocabulary across the surfaces (`⇧↑↓` by a row, `PgUp`/`PgDn` by a window,
        // `Home`/`End` the ends).
        else if (key?.upArrow === true && key?.shift === true) viewport.scrollBy(-1)
        else if (key?.downArrow === true && key?.shift === true) viewport.scrollBy(1)
        else if (key?.pageUp === true) viewport.scrollBy(-viewportRows)
        else if (key?.pageDown === true) viewport.scrollBy(viewportRows)
        else if (key?.home === true) viewport.scrollTo(0)
        else if (key?.end === true) viewport.scrollTo(Number.MAX_SAFE_INTEGER)
        else if (input === "r") {
          viewport.scrollTo(0)
          setBoard(read())
        }
        // One-key hop from the board to the team workflow (frozen §5.6).
        else if (input === "a") {
          nav.planFromTeam = false
          openScene(TEAM_SCENE_ID)
        }
      })
    }

    // Live session observer: the row count only. `useSyncExternalStore` is
    // always called with stable fallbacks so the hook order never changes.
    const channel = props?.channel
    /** Subscribes to the session channel's changes, or a no-op when there is no channel. */
    const subscribe = typeof channel?.subscribe === "function" ? (listener: () => void) => channel.subscribe(listener) : noopSubscribe
    /** Reads the channel's version so a transcript change re-renders; 0 without a channel. */
    const getSnapshot = typeof channel?.version === "number" ? () => channel.version as number : () => 0
    /** Transcript rows the channel reports; 0 when it cannot answer. */
    let sessionRows = 0
    if (typeof React.useSyncExternalStore === "function") {
      try {
        React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
        sessionRows = Array.isArray(channel?.rows) ? channel.rows.length : 0
      } catch {
        sessionRows = 0
      }
    }

    // THE BOARD'S OWN STATE, in the one tone vocabulary every surface reports: the team's tally when
    // this workspace holds a team, `dim` when it holds none. The matrix is the same one the DAG page
    // and the team scene draw, so a reader learns one signal for "this is fine / this is moving / this
    // is broken".
    /** The tally the surface reports, or undefined when there is no team to report. */
    const tally = board.state?.team?.tasks
    /** The tone the frame, the marker and the tally row all draw in. */
    const tone: SurfaceTone = tally === undefined ? "dim" : toneOfTally(tally, [])
    /** How many cells the progress bar may occupy on this width; never so wide that the row shears. */
    const barWidth = Math.max(4, Math.min(24, contentCols - 64))

    /** The pinned header: the page's identity, its counts and its rule — they never scroll away. */
    const head: unknown[] = []
    // Title/counts chrome (the host draws NO chrome for a scene). The marker is the surface's state
    // and the first thing the eye lands on; the size is last because it is reference, not news.
    head.push(surfaceText(surface, "title", chromeTitle([`${stateMarker(tone, phase)} MPD board — ${rows.length} line(s)`, size]), { bold: true, tone }))
    head.push(
      surfaceText(
        surface,
        "meta",
        chromeTitle([`${sessionRows} transcript row(s)`, tally === undefined ? undefined : `${barCells(tally.completed, tally.total, barWidth)} ${tally.completed}/${tally.total}`]),
        { dim: true },
      ),
    )
    head.push(surfaceRule(surface, "rule", undefined, tone))
    /** The board lines this window shows, in the read's own order. */
    const visible: unknown[] = []
    for (let index = scrollAt; index < Math.min(rows.length, scrollAt + viewportRows); index += 1) {
      // EVERY BODY ROW IS DRAWN BY THE SHARED BUILDER, so the board's own label vocabulary
      // (`workspace`, `team`, `tasks`, `boulder`, `note`, …) carries the same tones here as it does in
      // the merged panel. `tasks` is toned by the TALLY rather than by the label, because that row is
      // the one body row whose meaning is a state. THE KEY KEEPS THE LINE'S OWN INDEX, so a row's
      // identity does not change when the window moves over it.
      visible.push(surfaceBodyRow(surface, `line-${index}`, rows[index], { tasks: tone }))
    }
    // THE WHEEL OVER THE BODY, through the ONE normalisation helper every surface uses (contract D2),
    // so a machine whose wheel direction is inverted does not scroll this page the wrong way.
    /** The window's rows in one column, carrying the wheel the host delivers over them. */
    const body = React.createElement(ui.Box, {
      key: "board-window-rows",
      flexDirection: "column",
      flexGrow: 1,
      onWheel: (event: { deltaY?: number; deltaX?: number } | undefined) => {
        // SWALLOWED FIRST (frozen criterion I4): the gesture is this scene's, so it must not also scroll
        // the chat behind the frame. `swallowWheelEvent` is the core's one propagation stopper.
        swallowWheelEvent(event)
        /** The wheel's vertical delta in this plugin's own convention; positive scrolls down. */
        const deltaY = normalizeWheelDelta(Number(event?.deltaY ?? 0), wheelInvertOn())
        if (deltaY !== 0) viewport.scrollBy(deltaY > 0 ? 1 : -1)
      },
    }, ...visible)
    // Key-hint footer, PINNED: the keys that move this window must stay on screen while it moves.
    /** The frame's pinned footer rows. */
    const footer = [surfaceHints(surface, "footer", ["esc/q close", "⇧↑↓ scroll", "r refresh", "a team workflow"])]

    // THE FRAME: the surface's own border, its title in the border line, its colour carrying the state
    // the marker draws — the same grammar the DAG page and the merged panel use.
    /** The border title, clamped to the frame's INTERIOR so it can never shear the frame. */
    const borderTitle = clampCells(chromeTitle([stateMarker(tone, phase), "MPD board", size]), Math.max(8, contentCols - 2))
    return surfaceFrame(surface, "frame", borderTitle, windowedBody(surface, panel, viewport, head, [body], footer), tone, clock.ref)
  }
}

/**
 * Build the team-workflow component (frozen §3.1).
 *
 * Reads `.mpd/team/<teamId>/team.json` (read-only) and renders the team header,
 * the watchdog hold, the roster, the task DAG and the mailbox tail. `a` opens the
 * plan surface ONLY when the record says the team is staged: approval is a
 * separate, deliberate surface (frozen barrier 1).
 * @param workspaceRoot - resolves the workspace root per call.
 * @param holds - the watchdog's held team ids for the workspace.
 * @param nav - the shared surface navigation.
 * @param openScene - opens a scene by id.
 * @param teamViews - the official team readout, resolved per call.
 * @param teamRecords - the mpd-owned team records, resolved per call.
 * @param onHostKit - receives the host's own `ui` kit on every render.
 * @param teamDeps - the session-scoped team reads: the `mpdTeams` face and the live feed. Optional.
 * @returns a component matching the host's `TuiSceneProps` contract.
 */
function createTeamComponent(
  workspaceRoot: () => string,
  holds: () => readonly string[],
  nav: SceneNav,
  openScene: (id: string) => boolean,
  teamViews?: () => readonly DshTeamView[],
  teamRecords?: () => readonly TeamRecord[],
  onHostKit?: (ui: unknown) => unknown,
  teamDeps?: TeamSourceDeps,
): unknown {
  return function MpdTuiTeam(props: TuiScenePropsLike): unknown {
    /** The host's own React instance; every hook and element must use it. */
    const React = props?.React
    /** The host's ui kit (Box, Text, useInput, useTerminalSize). */
    const ui = props?.ui
    /** Leaves the scene; a host without the callback gets a no-op, so a key never throws. */
    const close = typeof props?.close === "function" ? props.close : () => {}
    if (!usableKit(React, ui)) return null
    // The live host kit, reported per render (see the board factory's note).
    onHostKit?.(ui)
    /** The host kit in the shared builders' shape; taken once per render, never per call. */
    const surface = surfaceKit(React, ui)

    /** The projection this render draws, or undefined before the first successful read. */
    const workflowState = React.useState(undefined as TeamWorkflow | undefined)
    /** The projection this render draws, or undefined before the first successful read. */
    const workflow = workflowState[0] as TeamWorkflow | undefined
    /** Publishes a freshly read projection. */
    const setWorkflow = workflowState[1] as (next: TeamWorkflow | undefined) => void
    /** The transient notice line. */
    const noticeState = React.useState("")
    /** The transient notice line, empty when there is nothing to say. */
    const notice = noticeState[0] as string
    /** Sets the notice, e.g. when the plan surface is unavailable. */
    const setNotice = noticeState[1] as (next: string) => void
    /** The PINNED task — what a click leaves behind when the pointer moves away. */
    const pinnedState = React.useState(undefined as string | undefined)
    /** The PINNED task — what a click leaves behind when the pointer moves away. */
    const pinned = pinnedState[0] as string | undefined
    /** Pins a task, or clears the pin with `undefined`. */
    const setPinned = pinnedState[1] as (next: string | undefined) => void
    /** The HOVERED task — transient, and it outranks the pin while the pointer is over a node. */
    const hoverState = React.useState(undefined as string | undefined)
    /** The HOVERED task — transient, and it outranks the pin while the pointer is over a node. */
    const hover = hoverState[0] as string | undefined
    /** Moves the hover, or clears it when the pointer leaves the graph. */
    const setHover = hoverState[1] as (next: string | undefined) => void
    // THE TWO AXES ARE ONE POSITION EACH, and both live on the SHARED VIEWPORT HANDLE created below
    // (frozen criterion I5): the vertical band is the scene body's own height and the column band is the
    // DRAWING's width against the interior. The purpose, said once (frozen clause T5): the pan exists so
    // the WHOLE DAG can be seen, because a natural-width drawing is allowed to be wider than the terminal
    // it is drawn in — while the scene's other rows stay at the interior's width and never move sideways.
    // The last read's facts, so a key handler answers "is this team staged?" without a second read
    // and without reading state from a stale render closure.
    const latestRef = React.useRef?.(undefined as { staged: boolean; teamId?: string } | undefined)
    // The drawn geometry, kept for the POINTER handlers: a click arrives with coordinates and the
    // handler must resolve them against the very layout that produced the pixels on screen. Reading
    // it from a ref rather than from the closure is what keeps a pointer event answered against the
    // CURRENT drawing after a refresh moved the rows.
    const viewRef = React.useRef?.(undefined as ReturnType<typeof layoutGraph> | undefined)
    // The shared clock, at a FIXED hook position (see `subagent-scene.ts`): a host with no timer
    // answers 0 and every animated cell draws the frozen static frame. THE INTERVAL IS `null` WHILE
    // NOTHING RUNS, which is the host's documented PAUSE — a surface with no live marker then costs the
    // host no frames at all (contract §5.A4c: the animation stops when nothing runs).
    // THE LIVE FACT COMES FROM THE PROJECTION, not from the drawing: a task the record calls running,
    // or a member the record calls running, is exactly the set of rows that breathe below.
    /** Whether any row this surface can draw is running, which is what the breath animates. */
    const animate = workflow !== undefined && (workflow.tasks.some((task) => task.visual === "running") || workflow.members.some((member) => member.status === "running"))
    /** The host clock, PAUSED when nothing runs, and the ref the animated element must carry. */
    const clock = useSceneClock(ui, animate)
    /** The phase the running markers breathe at. */
    const phase = animPhase(clock.time)

    /** Re-read the workflow and publish it. The render path stays free of I/O. */
    const refresh = (): void => {
      /** The freshly read projection; undefined means unreadable. */
      let next: TeamWorkflow | undefined
      try {
        // THE SESSION ID IS READ AT CALL TIME, never captured: the timer and the feed notification both
        // reach this closure long after the render that defined it, and the channel publishes its id
        // later. This is the read that makes the scene draw ITS OWN session's board.
        next = readWorkflow(workspaceRoot, holds, teamViews, teamRecords, teamDeps?.teams, channelSessionOf(props))
      } catch {
        next = undefined
      }
      setWorkflow(next)
      // The header's own facts travel with the projection so a key handler can answer without a second
      // read; the scope marker below is folded the same way so the frame and the rows agree.
      if (latestRef !== undefined && latestRef !== null) {
        latestRef.current = { staged: next?.team?.staged === true, ...(next?.team?.id === undefined ? {} : { teamId: next.team.id }) }
      }
    }

    // THE PUSH (PART P): this scene's projection lives in a state cell, so the notification re-READS
    // it through `refresh` rather than merely re-rendering. The 2000 ms tick below stays as the
    // fallback for a composition without the feed.
    useTeamFeed(React, teamDeps?.subscribeTeams, refresh)

    React.useEffect(() => {
      refresh()
      /** The refresh timer, absent when the host refused to schedule one. */
      let timer: ReturnType<typeof setInterval> | undefined
      try {
        timer = setInterval(() => refresh(), BOARD_REFRESH_MS)
      } catch {
        timer = undefined
      }
      return () => {
        if (timer !== undefined) {
          try {
            clearInterval(timer)
          } catch {
            // already cleared
          }
        }
      }
    }, [])

    // THE ROW TYPE IS THE JOINED ONE, not the drawing's narrower `GraphTask`: the detail pane below
    // reads `description`-class fields and the graph-derived `dependencies`, and a PLAN-ONLY ghost has
    // no board row to look up — typing this as `GraphTask[]` kept the ghost's details unreachable.
    /** The board in the graph's own vocabulary, joined with the SERVED model (ghosts included). */
    const graphTasks: TeamTaskRow[] = workflow === undefined ? [] : modelRows(workflow)
    /** HOVER OUTRANKS THE PIN while it lasts: the pointer is the more recent intent. */
    const focus = hover ?? pinned
    // The window is computed from the host's own terminal size (never assumed).
    const measured = measureTerminal(ui)
    // THE FRAME'S INTERIOR IS THIS SCENE'S ONE CONTENT WIDTH (frozen criterion W1): the terminal's width
    // minus the border and padding `surfaceFrame` spends inside it. Everything the scene builds — the
    // roster's wrap, the drawing's viewport, the legend, the rail and the title — is budgeted against it.
    /** How many cells the frame's interior offers this render. */
    const contentCols = panelSurfaceWidth(measured.cols)
    // The kit is this render's own object, so recording the budget on it is what makes every later
    // `surfaceText`/`surfaceBodyRow` call clamped without threading a parameter through each one.
    surface.maxCells = contentCols
    /** The same host in the PANEL kit's shape, which the viewport and rail builders take. */
    // Sound because `usableKit` proved this host before a hook ran: the two declarations differ in their
    // React members alone, and the builders only ever call `createElement`.
    const panel = panelKit(React, ui) as PanelKit
    /**
     * The sizes the viewport hook and every later closure read.
     *
     * Seeded from ONE ROW so a gesture that somehow arrives before the body is built cannot divide by
     * zero; `drawAt` writes the column band and the tail writes the row band, both before anything reads.
     */
    const sizes: { contentRows: number; viewportRows: number; contentCols?: number; viewportCols?: number } = { contentRows: 1, viewportRows: 1 }
    /** The team body's ONE scroll position, on BOTH axes: the keys, the wheel and the two rails drive it. */
    const viewport = usePanelViewport(panel, () => sizes)
    /** The team head, when there is one. */
    const team = workflow?.team
    // THE TEAM'S OWN STATE, in the one tone vocabulary every surface reports — the frame colour, the
    // marker and the tally row all read it, exactly as the board and the merged panel do.
    /** The tone this render reports. */
    const tone: SurfaceTone = workflow === undefined ? "dim" : toneOfTally(workflow.counts, workflow.tasks.map((task) => task.visual))
    /**
     * The rows ONE CONTENT WIDTH produces: the pinned header above the window, the scrollable region
     * (the drawing first, then every row below it) and the drawing facts the gestures read.
     *
     * IT IS A FUNCTION OF THE WIDTH BECAUSE THE RAIL OWNS A COLUMN WHEN THE BODY OVERFLOWS. With a
     * gutter the drawing, the roster's wrap and the legend all lose that cell; a render that kept the
     * wider rows would make every one of them one cell wider than the frame's interior and the host
     * would REWRAP it — the shear class this wave repairs. Whether the body overflows depends on how
     * many rows it produces, which depends on the width, so one pass cannot answer both: the scene
     * draws at its natural width and re-draws ONE COLUMN NARROWER only when that pass overflowed. A
     * short body therefore keeps its previous rendering byte for byte.
     * @param drawCols - the columns the frame's interior offers this pass, rail excluded.
     * @returns the pinned header, the window's content and the drawing facts.
     */
    const drawAt = (drawCols: number): TeamDraw => {
      // THE DRAWING'S VIEWPORT IS THE INTERIOR ITSELF (frozen criterion W1): the old `contentCols - 4`
      // re-spelled the frame's OWN chrome a second time, so the drawing — and every row wrapped to it —
      // came out four cells narrower than the room it had, and the numbers never matched the frame.
      /** The cells this pass's drawing and its wrapped rows may occupy, rail excluded. */
      const graphWidth = drawCols
      /** The ranks the host's model served, when it published one; the scene never re-derives its own. */
      const servedRanks = modelRanks(workflow)
      // THE GROUP FRAMES COME WITH THE MODEL (frozen contract D3). A served model's per-node column is the
      // column INSIDE its own frame, so a flat drawing of a grouped board would stack two frames' boxes in
      // one rank — the reason this call passes the frames through instead of drawing the board flat.
      /** The group frames the model declares, or undefined when this board has none. */
      const groups = workflow?.model?.groups
      // THE DRAWING IS LAID OUT AT ITS NATURAL WIDTH (frozen clauses T1/T2), so `view.width` may exceed
      // `graphWidth`; the rows below are WINDOWED to the viewport instead of the drawing being squeezed to
      // it. The layout's vertical budget is accepted and IGNORED by the geometry (`GraphBudget.rows`), so
      // the drawing is always its full natural height and the WINDOW is what makes it fit.
      /** The boxed drawing for this width, at its own width — the scene's picture unless it is too narrow. */
      const boxes = layoutGraphNatural(graphTasks, focus, { rows: measured.window }, servedRanks, groups)
      // THE DRAWING-OR-RAIL DECISION IS THE SIDEBAR'S OWN (frozen criterion W4, as AMENDED). `boxesFitWidth`
      // asks the one question that can take the picture away from the reader: do TWO of this drawing's own
      // node columns fit? A drawing merely WIDER than this pass's viewport keeps its boxes and is reached
      // by horizontal PAN — the rail drawn under it exists for exactly that, and a scene that switched to
      // the dense rail layout instead would draw at `graphWidth` by construction, leaving `colOverflow`
      // false forever and DELETING the horizontal scrollbar the user reported. The old
      // `boxes.width <= graphWidth` test did precisely that. So a wide drawing is windowed and panned
      // (the rows below are cut to `graphWidth` by `sliceSpans`), and only a viewport too narrow for two
      // node columns falls back to `layoutRail`, whose text list fits any width.
      /** The drawing: the boxed form whenever two node columns fit, the rail layout only when they cannot. */
      const view = boxesFitWidth(boxes, graphWidth) ? boxes : layoutRail(graphTasks, graphWidth, focus, servedRanks)
      // THE COLUMN BAND IS THE DRAWING'S WIDTH AGAINST THIS PASS'S VIEWPORT, recorded on the shared
      // handle so the rail, the key handler and the wheel all read the same two numbers.
      sizes.contentCols = view.width
      sizes.viewportCols = graphWidth
      /** The furthest horizontal offset that still fills the viewport; zero when the drawing fits. */
      const scrollXMax = viewport.colMax
      /** The horizontal offset for THIS render, clamped — the one value the rows and the rail both read. */
      const scrollXAt = viewport.colOffset
      /** The pinned header: identity, state, counts, roster and the drawing's own title row. */
      const head: unknown[] = []
      /** Every row BELOW the drawing, in draw order: they ride the same window as the drawing. */
      const tail: unknown[] = []
      /** How many cells the tally's bar may take on this width; a narrow terminal simply drops it. */
      const barWidth = Math.max(4, Math.min(16, graphWidth - 46))
      /** Whether this width has room for the bar beside the tally's own words. */
      const barFits = graphWidth >= 50
      // THE TEAM ID IS DRAWN, and it is not decoration: `approve <teamId>` is the exact phrase the
      // plan surface demands, and the id is what tells two waves apart. Two existing arms caught its
      // absence the moment this header was rewritten — the second of them through the CONTROL
      // CHARACTER it carries, which is why the id is the string the render boundary is tested with.
      head.push(
        surfaceText(surface, "title", chromeTitle([`${stateMarker(tone, phase)} MPD team${team === undefined ? " — (none)" : ` — ${team.name} (${team.id})`}`, measured.size]), {
          bold: true,
          tone,
        }),
      )
      // THE MARKED FALLBACK, third state (frozen PART D.2): a board drawn with NO session id readable is
      // the workspace's principal team, and the row says so BEFORE the DAG — never a silent fallback.
      // It is drawn only when the reader said so (`source.scope === "workspace"`); an unlabelled fixture
      // keeps today's rows exactly, so no existing arm's expected bytes move.
      if (workflow?.source?.scope === "workspace") {
        head.push(surfaceBodyRow(surface, "scope", `scope      ${WORKSPACE_SCOPE_MARKER} (no session id on this surface)`))
      }
      /** How many DRAWING rows this body contributes to the window; zero for every empty state. */
      let graphLines = 0
      if (workflow === undefined) {
        tail.push(surfaceText(surface, "unreadable", "team state unreadable", { tone: "failed" }))
      } else if (team === undefined) {
        // THE EMPTY STATE IS TWO DIFFERENT FACTS, and conflating them was the defect (PART D): a session
        // whose OWN team does not exist must be told exactly that — and never shown another session's
        // board — while a session-less surface (an older host) says its drawing is workspace-level.
        if (workflow.source?.scope === "none") {
          tail.push(surfaceText(surface, "none-session", `${NO_SESSION_TEAM_MARKER} — stage one with agent_teams_plan, then approve it`, { dim: true }))
          /** How many teams the workspace holds, when the reader could count them. */
          const held = workflow.source?.workspaceTeams
          if (typeof held === "number" && held > 0) {
            // NO SCOPE MARKER HERE (orthogonalized): `workspace-level` names the no-session-id state, so a
            // frame scan keyed on the token must match that state ALONE. This row belongs to state 2 —
            // this session HAS an id and holds no team of its own — and it states the workspace fact in
            // words, leaving the token to the state it names. State 2's unique marker is the row above.
            tail.push(surfaceText(surface, "none-session-count", `this workspace holds ${held} team(s), none bound to this session`, { dim: true }))
          }
        } else if (workflow.source?.scope === "workspace") {
          // No session id was readable, so this drawing is the WORKSPACE's principal team: the row
          // carries the visible marker, so a reader can tell it is not necessarily their own session's.
          tail.push(surfaceText(surface, "none", `${WORKSPACE_SCOPE_MARKER} (no session id on this surface) — no team in this workspace; stage one with agent_teams_plan, then approve it`, { dim: true }))
        } else {
          // The honest empty state: the workspace really holds no team, and the row says which tool
          // fills it rather than showing an empty frame.
          tail.push(surfaceText(surface, "none", "no team in this workspace — stage one with agent_teams_plan, then approve it", { dim: true }))
        }
      } else {
        /** The tally row, in the vocabulary the record uses. */
        const counts = workflow.counts
        // THE TALLY IS THE ONE ROW THAT IS A STATE, so it draws in the state's tone and carries the bar;
        // its words are unchanged, because the record's own vocabulary is what a reader already knows.
        head.push(
          surfaceText(
            surface,
            "phase",
            chromeTitle([
              barFits ? `${barCells(counts.completed, counts.total, barWidth)} ${counts.completed}/${counts.total}` : undefined,
              `${team.phase} · ${counts.total} task(s) · ${counts.completed} done · ${counts.inProgress} running · ${counts.pending} pending · ${counts.failed} failed · ${team.links} link(s)`,
            ]),
            { tone },
          ),
        )
        // THE ROSTER'S RUNNING MARKER BREATHES ON THE SAME CLOCK AND THE SAME FRAME TABLE as the drawing
        // below it (contract §5.A4c): the record's `running` status is drawn through `runningMarker`, so
        // the roster and a running task can never animate at two different speeds or through two frame
        // sets — and at the static phase it is the published `◐` it always was.
        /** The roster, one wrapped line, so the graph gets the room. */
        const roster = workflow.members.length === 0
          ? "roster  (no members)"
          : "roster  " + workflow.members.map((member) => `${member.status === "running" ? runningMarker(phase) : "○"}${member.name} ${member.done}/${member.total}`).join(" · ")
        /** The wrapped roster chunks; only the first carries the `roster` label the tone table keys on. */
        const rosterChunks = wrapCells(roster, graphWidth)
        for (let index = 0; index < rosterChunks.length; index += 1) {
          head.push(surfaceBodyRow(surface, `roster-${index}`, rosterChunks[index]))
        }
        if (workflow.holds.includes(team.id)) head.push(surfaceBodyRow(surface, "hold", `watchdog   HELD (${workflow.holds.join(", ")})`))
        /** The graph's own header, which names the focus so the highlight is explainable. */
        const focusLabel = focus === undefined ? "" : ` · focus ${focus}${view.chain.length === 0 ? "" : ` ⇠ ${view.chain.join(",")}`}`
        // THE HEADER MUST STAY EXACTLY `task dependency graph` WHEN NOTHING IS FOCUSED: the drawing
        // begins on the very next row (the pointer geometry and the scroll arms are measured from that
        // offset), so nothing may be inserted between this row and the first row of the drawing.
        head.push(surfaceText(surface, "graphhead", `task dependency graph${view.mode === "rail" ? " (rail)" : ""}${focusLabel}`, { dim: true }))
        /** How many drawing rows the window scrolls over: the drawing's own, at this width. */
        graphLines = view.lines.length
        // THE HORIZONTAL RAIL, DIRECTLY BENEATH THE DRAWING (R8) — not beneath the scene, and driven by
        // the SAME `scrollXAt` the rows above were cut with, so the thumb and the window can never
        // disagree (clause T4). Drawn only while the drawing is wider than the viewport.
        if (viewport.colOverflow) {
          // THE HORIZONTAL RAIL IS THE SHARED BUILDER (frozen criteria I1/I5): `viewportTrack` returns
          // `panel-core.ts`'s own `viewportRail` — a `Box` carrying `onDragStart`/`onDragMove`/`onDragEnd`
          // around its one text row — so the scene's scrollbar has EXACTLY the sidebar's drag semantics,
          // and its cells come from the same `gutterCellsX` the thumb above was drawn with (clause T4).
          /** The draggable rail for this pass, absent when the drawing fits its viewport. */
          const rail = viewportTrack(panel, viewport, "col", { cols: graphWidth })
          if (rail !== undefined) tail.push(rail)
        }
        // THE LEGEND sits directly under the DAG it explains, in the SAME width budget the graph was
        // laid out for (`graphWidth`) — the merged panel draws the same lines under its own DAG, so
        // one legend cannot claim more cells than the drawing above it used. It is COMPOSED, not
        // private: `graph.ts` owns the drawing's own arrow/focus sentence, and `panel-core.ts`'s
        // `legendLinesFor` appends the CONTRACT's ONE state key — the six-state key that tells
        // `○ blocked` from `○ open`, which the drawing module's DELETED five-state key could not.
        // Handing the drawing's line to that helper is what keeps this scene's legend identical to the
        // DAG page's, and it is why this scene prints the state key exactly once.
        /** The drawing module's own line: its arrow/focus sentence; the state key belongs to the composer. */
        let arrow: string[] = []
        try {
          arrow = legendLines(graphWidth)
        } catch {
          arrow = []
        }
        // THE TWO GROUPS KEEP THEIR OWNER'S KEY: the drawing's lines stay `legend-<i>` (the interface
        // this package's own suite pins), and the contract's appended key rows are `state-key-<i>`, so a
        // reader — and a test — can tell which owner said what. Both are DIMMED: a legend explains the
        // drawing, it never competes with it.
        for (let index = 0; index < arrow.length; index += 1) {
          tail.push(surfaceText(surface, `legend-${index}`, arrow[index], { dim: true }))
        }
        /** The composed legend: the drawing's lines followed by the contract's six-state key. */
        let legend: string[] = []
        try {
          legend = legendLinesFor(graphWidth, arrow)
        } catch {
          legend = []
        }
        for (let index = arrow.length; index < legend.length; index += 1) {
          tail.push(surfaceText(surface, `state-key-${index - arrow.length}`, legend[index], { dim: true }))
        }
        // The detail pane: the focused task's contract, which is what a reader needs after finding it.
        // THE LOOKUP IS THE DRAWN ROWS, not the board's: a plan-only ghost exists only in the joined
        // rows, so looking in `workflow.tasks` left a focused ghost with no detail at all.
        /** The focused task's joined row, when there is one. */
        const detail = focus === undefined ? undefined : graphTasks.find((task) => task.id === focus)
        if (detail !== undefined) {
          // The pane draws in the FOCUSED TASK'S OWN TONE: the reader asked about this task, so the pane
          // reports its state rather than repeating the surface's.
          tail.push(surfaceText(surface, "detail", `${detail.id} · ${detail.kind ?? "?"} · ${detail.subject}`, { bold: true, tone: visualTone(detail.visual) }))
          tail.push(surfaceText(surface, "detail-meta",
            `${detail.visual}${detail.attempt === undefined ? "" : ` · attempt ${detail.attempt}`}${detail.round === undefined ? "" : ` · round ${detail.round}`}${detail.verdict === undefined ? "" : ` · ${detail.verdict}`}${detail.assignee === undefined ? "" : ` · @${detail.assignee}`}${detail.dependencies.length === 0 ? "" : ` · ⇠ ${detail.dependencies.join(",")}`}`,
            { dim: true }))
        }
        for (const problem of workflow.problems) tail.push(surfaceBodyRow(surface, `problem-${problem}`, `note       ${problem}`))
      }
      if (notice !== "") tail.push(surfaceText(surface, "notice", notice, { tone: "blocked" }))
      /** The running marker's base cell, which is the contract's own `running` glyph. */
      const baseMarker = DAG_TONE_GLYPH.running ?? "◐"
      /** The animated glyph for this frame, or the base one when nothing is running. */
      const breathe = runningGlyph(phase)
      /** Whether the breath changes the glyph this render (it is static at the orbit's head). */
      const breathing = breathe !== baseMarker
      /** One drawing row: animated when it carries a running marker, then cut to the horizontal window. */
      const graphRow = (index: number): unknown => {
        /** This row's spans, as the drawing laid them out. */
        const row = view.lines[index] ?? []
        /** Whether the drawing marks this row as RUNNING, which is what animates. */
        const running = row.some((span) => span.tone === "running")
        // THE BREATH IS THE SCENE'S OWN CLOCK ON THE CONTRACT'S OWN GLYPH, applied exactly as the
        // sidebar's `dag` page applies it: only a running row is touched, and only its FIRST occurrence
        // of that glyph, so the drawing's geometry and its other marks cannot move. With no timer (or
        // outside the orbit's head frame) the row is drawn exactly as `graph.ts` laid it out.
        /** This row's spans, with the running glyph advanced by the phase. */
        const phased = running && breathing
          ? row.map((span) => (span.text.includes(baseMarker) ? { text: span.text.replace(baseMarker, breathe), tone: span.tone } : span))
          : row
        /** The spans of this row, cut to the viewport and each drawn in its own theme colour. */
        const spans = sliceSpans(phased, scrollXAt, graphWidth).map((span, at) => React.createElement(ui.Text, { key: `s${at}`, color: toneColor(span.tone) }, span.text))
        return React.createElement(ui.Text, { key: `g${index}` }, ...spans)
      }
      return { head, tail, graphLines, graphRow, view, graphWidth, scrollXAt, scrollXMax }
    }
    /** The body at the frame's own interior width — the pass a short scene keeps byte for byte. */
    const full = drawAt(contentCols)
    /** The rows the pinned header and the pinned footer leave for the window; never below one. */
    const capacityOf = (draw: TeamDraw): number => Math.max(1, measured.rows - 2 - draw.head.length - 1)
    /** The rows this body carries in its window: the drawing's own plus every row below it. */
    const contentOf = (draw: TeamDraw): number => draw.graphLines + draw.tail.length
    // THE VERTICAL AXIS IS NOW THE WHOLE BODY, and that is the fix for 「显示不全」: the offset used to
    // move the DRAWING alone, so every row below it (rail, legend, detail, problems, notice) was pushed
    // unconditionally and the host clipped whatever exceeded the terminal. The window now scrolls over
    // the drawing AND those rows, so the last row of the scene is reachable — while a body that fits
    // still draws exactly as before.
    /** Whether the body must be windowed at all, which is also when the gutter owns a column. */
    const scrolling = contentOf(full) > capacityOf(full)
    /** The body this render draws; an overflowing one is re-laid out one column narrower for its rail. */
    const body = scrolling ? drawAt(contentCols - 1) : full
    /** How many rows the window shows. */
    const viewportRows = capacityOf(body)
    /** How many rows the window scrolls over. */
    const contentRows = contentOf(body)
    // THE HANDLE IS TOLD THIS RENDER'S HEIGHTS before any gesture reads it, so a key press is clamped
    // against the body that is on screen rather than against the previous render's numbers.
    sizes.contentRows = contentRows
    sizes.viewportRows = viewportRows
    // THE FAR-EDGE DEFECT THIS WAVE INHERITS: the state used to be read raw by the render loop, so
    // `End` (which committed `Number.MAX_SAFE_INTEGER`) and a long wheel run pushed the window PAST the
    // last row — the slice then started beyond the content and the scene drew an EMPTY body, with no
    // way back except scrolling up one tick at a time. A clamped value derived per render, and used by
    // the window, both hit tests and every vertical gesture, makes the far edge a real stop.
    /** The furthest vertical offset that still fills the window; zero when the body fits. */
    const scrollMax = viewport.max
    /** The vertical offset for THIS render, clamped — the one value the window and both hit tests read. */
    const scrollAt = viewport.offset
    if (viewRef !== undefined && viewRef !== null) viewRef.current = body.view
    /** The tasks the focus would move through, in DRAWING order, which is what the arrow keys walk. */
    const ordered = body.view.hits.map((hit) => hit.taskId)

    /** Move the focus by one task in drawing order, wrapping at both ends. */
    const moveFocus = (delta: number): void => {
      if (ordered.length === 0) return
      /** The current position, or -1 when nothing is focused. */
      const at = focus === undefined ? -1 : ordered.indexOf(focus)
      /** The next position, wrapped so the ends are reachable from either direction. */
      const next = at < 0 ? (delta > 0 ? 0 : ordered.length - 1) : (at + delta + ordered.length) % ordered.length
      setHover(undefined)
      setPinned(ordered[next])
    }

    if (typeof ui.useInput === "function") {
      ui.useInput((input: string, key: { escape?: boolean; upArrow?: boolean; downArrow?: boolean; leftArrow?: boolean; rightArrow?: boolean; pageUp?: boolean; pageDown?: boolean; home?: boolean; end?: boolean; shift?: boolean } | undefined) => {
        // `esc` UNPINS rather than closing while something is pinned: the pin is a mode, and a user
        // who clicked a task must be able to leave that mode without leaving the scene.
        if (key?.escape === true && pinned !== undefined) { setPinned(undefined); setHover(undefined); return }
        if (key?.escape === true || input === "q") close()
        else if (input === "r") { viewport.scrollTo(0); viewport.scrollToCol(0); refresh() }
        // THE ARROWS MOVE THE FOCUS; SHIFT MAKES THEM SCROLL (the user's own decision, clause T5). `←/→`
        // are NEW: they walk the SAME one-dimensional drawing order `↑/↓` already walk, because a true
        // two-dimensional neighbour walk would need a geometry contract nobody asked for.
        else if (key?.upArrow === true || input === "k") (key?.shift === true ? viewport.scrollBy(-1) : moveFocus(-1))
        else if (key?.downArrow === true || input === "j") (key?.shift === true ? viewport.scrollBy(1) : moveFocus(1))
        else if (key?.leftArrow === true || input === "h") (key?.shift === true ? viewport.scrollColBy(-1) : moveFocus(-1))
        else if (key?.rightArrow === true || input === "l") (key?.shift === true ? viewport.scrollColBy(1) : moveFocus(1))
        // PAGING: `PgUp`/`PgDn` page vertically and their SHIFT forms horizontally, and `Home`/`End` are
        // the vertical ends — the same four keys the `dag` panel answers, so the two surfaces agree.
        // THE VERTICAL PAGE STEP IS THE WINDOW ITSELF (`viewportRows`), not the old drawing-only budget:
        // the window now carries the rows below the drawing too, so a page that moved by the drawing's
        // height would skip the very rows this wave makes reachable.
        // EVERY VERTICAL MOVE GOES THROUGH `scrollAt`/`scrollMax`, so the far edge is a stop and not a
        // value the next render has to recover from.
        else if (key?.pageUp === true) (key?.shift === true ? viewport.scrollColBy(-body.graphWidth) : viewport.scrollBy(-viewportRows))
        else if (key?.pageDown === true) (key?.shift === true ? viewport.scrollColBy(body.graphWidth) : viewport.scrollBy(viewportRows))
        else if (key?.home === true) viewport.scrollTo(0)
        else if (key?.end === true) viewport.scrollTo(Number.MAX_SAFE_INTEGER)
        else if (input === "g") { viewport.scrollTo(0); viewport.scrollToCol(0) }
        else if (input === "p") { nav.planFromTeam = false; openScene(BOARD_SCENE_ID) }
        else if (input === "a") {
          /** Whether the last read saw a staged team, which is what the `a` key needs. */
          const staged = latestRef?.current?.staged === true
          if (!staged) { setNotice(t("scene.planNeedsStaged")); return }
          setNotice("")
          nav.planFromTeam = true
          nav.planTeamId = latestRef?.current?.teamId
          if (!openScene(PLAN_SCENE_ID)) setNotice(t("scene.planMissing"))
        }
      })
    }

    /** The drawing line the window starts on, which is also what the pointer's local row adds to. */
    const graphFrom = Math.min(scrollAt, body.graphLines)
    /** The drawing line the window ends on (exclusive). */
    const graphTo = Math.min(body.graphLines, scrollAt + viewportRows)
    // THE GRAPH BOX OWNS THE POINTER. Its children are exactly the drawn rows, in order, so a
    // `localRow`/`localCol` from the host's event resolves against the SAME geometry that was drawn —
    // `hitTest` is a rectangle lookup on the layout, never a second one. The drawing is the FIRST row
    // of the window, so the pointer's local row plus the window's offset is the drawing's own row.
    /** The drawing's visible rows, which are the graph box's ONLY children. */
    const graphRows: unknown[] = []
    for (let index = graphFrom; index < graphTo; index += 1) graphRows.push(body.graphRow(index))
    /** How far into the tail the window starts, which stays zero while the drawing fills its bottom. */
    const tailStart = Math.max(0, scrollAt - body.graphLines)
    /** The rows the tail still has room for below the visible drawing. */
    const tailRoom = viewportRows - (graphTo - graphFrom)
    /** The tail rows this window reaches, in draw order. */
    const tailRows: unknown[] = []
    for (let index = 0; index < tailRoom && tailStart + index < body.tail.length; index += 1) tailRows.push(body.tail[tailStart + index])
    /** The window's rows: the drawing's own box (when this board has a drawing), then the tail rows. */
    const visible: unknown[] = []
    if (body.graphLines > 0) {
      visible.push(React.createElement(ui.Box, {
        key: "graph",
        flexDirection: "column",
        // Pointer handlers: present on every host, INERT on one without mouse tracking, so the
        // keyboard path is untouched and nothing has to feature-detect.
        onMouseEnter: (event: { localRow?: number; localCol?: number } | undefined) => {
          /** The view this render drew, read back so the handler cannot answer a stale layout. */
          const drawn = viewRef?.current
          if (drawn === undefined) return
          /** The task under the pointer, or none. */
          const under = hitTest(drawn, Number(event?.localRow ?? -1) + graphFrom, Number(event?.localCol ?? -1) + body.scrollXAt)
          setHover(under)
        },
        onMouseLeave: () => setHover(undefined),
        onClick: (event: { localRow?: number; localCol?: number } | undefined) => {
          /** The view this render drew. */
          const drawn = viewRef?.current
          if (drawn === undefined) return
          /** The task that was clicked, or none for blank space. */
          const under = hitTest(drawn, Number(event?.localRow ?? -1) + graphFrom, Number(event?.localCol ?? -1) + body.scrollXAt)
          // Clicking the pinned task again, or blank space, UNPINS — the same gesture that pinned it.
          setPinned(under === undefined || under === pinned ? undefined : under)
          setHover(under)
        },
        onWheel: (event: { deltaY?: number; deltaX?: number } | undefined) => {
          // EACH DELTA DRIVES ITS OWN AXIS (clause T5), and BOTH signs come from the ONE normalisation
          // helper (contract D2): the raw terminal delta is machine-dependent, so a scene reading it
          // directly scrolls the wrong way on exactly the installations the knob exists for. The vertical
          // one moves the WINDOW — the drawing AND every row below it, which is what makes the scene body
          // reachable — while the horizontal one moves the DRAWING's window, and only when there is
          // something to pan to.
          // SWALLOWED FIRST (frozen criterion I4): the gesture belongs to this scene, so it must not
          // also reach the chat behind the frame.
          swallowWheelEvent(event)
          /** The wheel's vertical delta in this plugin's own convention; positive scrolls down. */
          const deltaY = normalizeWheelDelta(Number(event?.deltaY ?? 0), wheelInvertOn())
          if (deltaY !== 0) viewport.scrollBy(deltaY > 0 ? 1 : -1)
          /** The wheel's horizontal delta in the same convention; positive scrolls right. */
          const deltaX = normalizeWheelDelta(Number(event?.deltaX ?? 0), wheelInvertOn())
          if (deltaX !== 0) viewport.scrollColBy(deltaX > 0 ? 1 : -1)
        },
      }, graphRows))
    }
    for (const row of tailRows) visible.push(row)
    // Key-hint footer, PINNED: the keys that move this window must stay on screen while it moves.
    /** The frame's pinned footer rows. */
    const footer = [surfaceHints(surface, "footer", ["esc/q close", "↑↓ focus", "click pins", "hover previews", "⇧↑↓ scroll", "r refresh", "a plan", "p board"])]
    // THE FRAME: the surface's own border, its title in the border line and its colour carrying the
    // state the marker draws — the grammar the DAG page and the merged panel share.
    /** The border title, clamped to the frame's INTERIOR so it can never shear the frame. */
    const borderTitle = clampCells(chromeTitle([`${stateMarker(tone, phase)} MPD team${team === undefined ? "" : ` — ${team.name}`}`, measured.size]), Math.max(8, contentCols - 2))
    return surfaceFrame(surface, "frame", borderTitle, windowedBody(surface, panel, viewport, body.head, visible, footer), tone, clock.ref)
  }
}

/**
 * The action block of the plan surface: the frozen confirmation echo, the
 * required phrase, the runnable gate and the discard arm.
 * @param workflow - the current projection.
 * @param echo - the confirmation echo line (starts EMPTY, clears on refresh).
 * @param armed - whether the discard arm is live.
 * @param message - the last tool result line (empty when there is none).
 * @param servedPhrase - the approval phrase the SHARED projection served, or "" when this
 *   composition exposes no plan face (the record-derived fallback then applies).
 * @returns the appended rows.
 */
export function planActionLines(workflow: TeamWorkflow | undefined, echo: string, armed: boolean, message: string, servedPhrase: string = ""): string[] {
  /** The team the action block addresses; undefined without a record. */
  const team = workflow?.team
  // THE PHRASE IS SERVED, NOT DERIVED. It arrives from the SAME projection the Web panel renders, so
  // the two surfaces demand the same string; a surface that computed its own would be a second
  // implementation of the gate, free to drift. The record-based fallback below exists only for a
  // composition that exposes no plan face at all, and it is named as such in the row it renders.
  /** The exact phrase the user must type, or the empty marker when there is nothing to approve. */
  const phrase = servedPhrase !== "" ? servedPhrase : (team === undefined ? "" : approvalPhrase(team.id))
  /** The action-block rows, in render order. */
  const rows: string[] = []
  rows.push("")
  rows.push(servedPhrase !== "" ? "approval needs the exact phrase typed below, then Ctrl+X" : "approval needs the exact team id typed below, then Ctrl+X")
  rows.push(`confirm    ${echo}`)
  rows.push(`required   ${phrase === "" ? "(no staged plan)" : phrase}`)
  rows.push(`runnable   ${team?.runnable === true ? "yes" : "no"}`)
  if (armed) rows.push("DISCARD ARMED — press Ctrl+D again within 10s to archive this staged plan")
  if (message !== "") rows.push(message)
  rows.push("")
  rows.push("to change this plan: press Esc and tell the captain what to change in the chat")
  rows.push("Ctrl+X approve · Ctrl+D discard ×2 · Ctrl+R re-read · esc back")
  return rows
}

/**
 * Build the plan-approval component (frozen §3.2 / §4).
 *
 * The five accidental-approval barriers live here: a separate surface, a typed
 * exact phrase, an echo that starts empty, chord-only mutations and single-flight
 * with a re-read. Every mutation goes through {@link PlanActions} (the adapter).
 * @param workspaceRoot - resolves the workspace root per call.
 * @param holds - the watchdog's held team ids for the workspace.
 * @param nav - the shared surface navigation, read once at mount.
 * @param openScene - opens a scene by id.
 * @param actions - the adapter-backed approval executor.
 * @param planFor - the shared staged-plan reader, per session.
 * @param teamViews - the official team readout, resolved per call.
 * @param teamRecords - the mpd-owned team records, resolved per call.
 * @param onHostKit - receives the host's own `ui` kit on every render.
 * @param teamDeps - the session-scoped team reads: the `mpdTeams` face and the live feed. Optional.
 * @returns a component matching the host's `TuiSceneProps` contract.
 */
function createPlanComponent(
  workspaceRoot: () => string,
  holds: () => readonly string[],
  nav: SceneNav,
  openScene: (id: string) => boolean,
  actions: PlanActions,
  planFor?: (sessionId: string) => MpdPlanView["plan"] | undefined,
  teamViews?: () => readonly DshTeamView[],
  teamRecords?: () => readonly TeamRecord[],
  onHostKit?: (ui: unknown) => unknown,
  teamDeps?: TeamSourceDeps,
): unknown {
  return function MpdTuiPlan(props: TuiScenePropsLike): unknown {
    /** The host's own React instance; every hook and element must use it. */
    const React = props?.React
    /** The host's ui kit (Box, Text, useInput, useTerminalSize). */
    const ui = props?.ui
    /** Leaves the scene; a host without the callback gets a no-op, so a key never throws. */
    const close = typeof props?.close === "function" ? props.close : () => {}
    if (!usableKit(React, ui)) return null
    // The live host kit, reported per render (see the board factory's note).
    onHostKit?.(ui)
    /** The host kit in the shared builders' shape; taken once per render, never per call. */
    const surface = surfaceKit(React, ui)
    // THE FRAME'S INTERIOR IS THIS SURFACE'S ONE CONTENT WIDTH (frozen criteria W1/W2/W3): a plan row is
    // sentence-shaped and can be long, so a row built at the terminal's width wraps inside a frame four
    // cells narrower and tears the box exactly as the user screenshotted. The measurement and the
    // viewport handle are taken FIRST, before any reader that resets the scroll position: `refresh` below
    // calls the handle, so the handle must exist before a host that runs its effects eagerly can call it.
    /** The terminal measurement, taken once per render. */
    const measured = measureTerminal(ui)
    /** How many cells the frame's interior offers this render. */
    const contentCols = panelSurfaceWidth(measured.cols)
    // The kit is this render's own object, so recording the budget on it clamps every row built below.
    surface.maxCells = contentCols
    /** The same host in the PANEL kit's shape, which the viewport and rail builders take. */
    // Sound because `usableKit` proved this host before a hook ran.
    const panel = panelKit(React, ui) as PanelKit
    /** How many body rows the window shows: the terminal minus the frame's chrome, as it always was. */
    const viewportRows = Math.max(1, measured.window)
    /** The sizes the viewport hook and every later closure read; the height is filled in once it is known. */
    const sizes: { contentRows: number; viewportRows: number } = { contentRows: 1, viewportRows }
    /** The plan body's ONE scroll position: the keys and the rail drive this handle. */
    const viewport = usePanelViewport(panel, () => sizes)
    // The shared clock, at a FIXED hook position (see `subagent-scene.ts`): a host with no timer
    // answers 0 and every animated cell draws the frozen static frame.
    /** The host clock and the ref the animated element must carry. */
    const clock = useSurfaceClock(ui)
    /** The phase the state marker breathes at. */
    const phase = animPhase(clock.time)

    // ── THE SESSION ID COMES FROM THE LIVE CHANNEL ────────────────────────────
    // A staged plan is SESSION-scoped (`.mpd/team/staging/<sessionId>.json`) while every other read
    // this row makes is workspace-scoped — the row has no session of its own. A SCENE does: the host
    // hands it the live channel, and `sessionId` is one of that channel's published properties. That
    // is the whole reason the plan is reachable here, and it is why nothing needs caching: the id is
    // read per render off the props the host just passed.
    // SINCE PART D IT ALSO SCOPES THE TEAM: the plan surface draws the workflow body, so a session-less
    // read here would draw another session's DAG beside this session's plan. The reader is the module's
    // ONE `channelSessionOf`, so all four scenes answer "which session?" identically.
    /** The live channel's session id, or undefined before the channel has bound one. */
    const channelSession = (): string | undefined => channelSessionOf(props)

    // The mount-time navigation target: plain in-memory state, no I/O in the render path.
    const targetState = React.useState(() => ({ teamId: nav.planTeamId, fromTeam: nav.planFromTeam }))
    /** The navigation target captured at mount: which team, and where Esc returns. */
    const target = targetState[0] as { teamId?: string; fromTeam: boolean }

    /** The workflow projection as host state. */
    const viewState = React.useState(undefined as TeamWorkflow | undefined)
    /** The current projection; undefined while the first read is pending. */
    const view = viewState[0] as TeamWorkflow | undefined
    /** Replaces the projection after every read, including the post-call re-read. */
    const setView = viewState[1] as (next: TeamWorkflow | undefined) => void
    /** The consent echo as host state; it starts empty on every entry. */
    const echoState = React.useState("")
    /** What the user has typed so far, compared against the required phrase. */
    const echo = echoState[0] as string
    /** Appends a keystroke, deletes one, or clears the echo after a settled call. */
    const setEcho = echoState[1] as (next: string) => void
    /** The single-flight flag as host state. */
    const busyState = React.useState(false)
    /** Whether a call is in flight; every key is ignored while it is true. */
    const busy = busyState[0] as boolean
    /** Sets the single-flight flag around a call. */
    const setBusy = busyState[1] as (next: boolean) => void
    /** The last settled tool-result line as host state. */
    const messageState = React.useState("")
    /** The current message; empty when no call has settled yet. */
    const message = messageState[0] as string
    /** Reports a refusal, a working state or a settled verdict. */
    const setMessage = messageState[1] as (next: string) => void
    /** The discard arm's timestamp as host state. */
    const armedState = React.useState(0)
    /** When the arm was set; 0 means disarmed. */
    const armedAt = armedState[0] as number
    /** Arms on the first Ctrl+D and disarms on expiry, any other key, or a discard. */
    const setArmedAt = armedState[1] as (next: number) => void
    // THE BODY'S SCROLL POSITION LIVES ON THE SHARED VIEWPORT HANDLE created below, together with the
    // frame's interior width (frozen criterion I5): the plan surface windows its body the same way the
    // board, team and watchdog surfaces do, so it gets the same clamped band, the same keys and — since
    // the windowing already implies one — the same draggable rail.

    /** Re-reads the record and resets the consent echo, the arm and the scroll. */
    const refresh = (): void => {
      setView(readWorkflow(workspaceRoot, holds, teamViews, teamRecords, teamDeps?.teams, channelSession()))
      // Barrier 3: the echo is EMPTY on every entry and on every explicit refresh.
      setEcho("")
      setArmedAt(0)
      viewport.scrollTo(0)
    }

    // THE PUSH (PART P): a team-state change re-reads the FACTS here, exactly as the periodic read
    // below does — the consent echo and the discard arm are NOT touched, because barrier 3 reserves
    // those for the explicit `r` key, and a remote change must never re-arm the approval gate.
    useTeamFeed(React, teamDeps?.subscribeTeams, () => setView(readWorkflow(workspaceRoot, holds, teamViews, teamRecords, teamDeps?.teams, channelSession())))

    React.useEffect(() => {
      // Initial read in the effect (never in the render path).
      refresh()
      /** The periodic re-read timer, absent when the host refused to schedule one. */
      let timer: ReturnType<typeof setInterval> | undefined
      try {
        timer = setInterval(() => {
          // The automatic re-read refreshes the FACTS only: the consent echo and the 10 s
          // discard arm are cleared by the explicit `r` key (frozen §4.2 barrier 3 / §4.3).
          setView(readWorkflow(workspaceRoot, holds, teamViews, teamRecords, teamDeps?.teams, channelSession()))
        }, BOARD_REFRESH_MS)
      } catch {
        timer = undefined
      }
      return () => {
        if (timer !== undefined) {
          try {
            clearInterval(timer)
          } catch {
            // already cleared
          }
        }
      }
    }, [])

    // The discard arm expires on its own after the frozen 10 s window.
    React.useEffect(() => {
      if (armedAt === 0) return undefined
      /** The arm-expiry timer, absent when the host refused to schedule one. */
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        timer = setTimeout(() => setArmedAt(0), DISCARD_WINDOW_MS)
      } catch {
        timer = undefined
      }
      return () => {
        if (timer !== undefined) {
          try {
            clearTimeout(timer)
          } catch {
            // already cleared
          }
        }
      }
    }, [armedAt])

    /** The team this render addresses; undefined without a record. */
    const team = view?.team
    // THE STAGED PLAN, THROUGH THE SHARED PROJECTION. Nothing here re-reads the staging file or
    // re-derives the gate: `planFor` is the same function the Web panel's route calls, so both
    // surfaces demand the same phrase. A composition with no plan face, or a session with nothing
    // staged, yields undefined and this surface falls back to the record-derived phrase.
    /** The plan this session has staged, or undefined when there is none to approve. */
    /** The plan this session has staged, or undefined when there is none to approve. */
    /** What the reader answered: the plan, or null when the session has none staged. */
    const rawPlan = planFor === undefined ? undefined : planFor(channelSession() ?? "")
    /** The plan to render, with the reader's own null normalised to undefined. */
    const stagedPlan = rawPlan ?? undefined
    /** The exact approval phrase: SERVED when there is a plan, else the record-derived fallback. */
    const phrase = stagedPlan === undefined ? (team === undefined ? "" : approvalPhrase(team.id)) : stagedPlan.phrase
    // The precondition the Web itself enforces before it renders the editor
    // (`client.js:2437`): a STAGED team with a plan. Outside it the scene is a
    // read-only statement that accepts ONLY Esc — no chord, no mutation.
    // A STAGED PLAN WITH NO RECORD IS THE NORMAL PRE-APPROVAL STATE: the record is materialised AT
    // approval, so requiring one here made the surface unusable in exactly the state it exists for —
    // the same fact that made the Web panel show "no team yet" over a plan awaiting a decision.
    const usable = (view !== undefined && team !== undefined && team.staged) || (stagedPlan !== undefined && stagedPlan !== null && stagedPlan.approved !== true)

    /** Leave the surface. Esc never mutates (frozen §3.2). */
    const leave = (): void => {
      setEcho("")
      viewport.scrollTo(0)
      if (target.fromTeam) {
        if (!openScene(TEAM_SCENE_ID)) close()
      } else {
        close()
      }
    }

    /** Runs the approval once the echo matched; single-flight, and re-reads the record after. */
    const runApprove = async (): Promise<void> => {
      if (team === undefined) return
      // Barrier 2: the chord is inert unless the echo is EXACTLY the required phrase.
      if (phrase === "" || echo !== phrase) {
        setMessage("confirmation does not match this team")
        return
      }
      if (!actions.available()) {
        setMessage(`approve failed: ${PLAN_MUTATION_UNAVAILABLE}`)
        return
      }
      setBusy(true)
      setMessage("working…")
      try {
        /** The executor's verdict for this approval. */
        const result = await actions.approve({
          teamId: stagedPlan?.planId ?? team.id,
          confirmation: echo,
          // THE SESSION THE SCENE ACTS FOR, off its own live channel. The tool resolves its workspace
          // and session from the caller it is given, so this is what makes the call land on the RIGHT
          // plan rather than on whatever the process cwd happens to name.
          ...(channelSession() === undefined ? {} : { sessionId: channelSession() as string }),
          ...(team.captainSessionId === undefined ? {} : { captainSessionId: team.captainSessionId }),
        })
        if (result.ok) {
          /** The tool's structured value, read field by field below. */
          const value = result.value as { status?: unknown; team_id?: unknown; members?: unknown; tasks?: unknown } | undefined
          /** The approved team's id, from the tool or from the projection. */
          const id = typeof value?.team_id === "string" ? value.team_id : team.id
          /** The team's status after approval; `running` when the tool did not say. */
          const status = typeof value?.status === "string" ? value.status : "running"
          /** Member count after approval, from the tool or from the projection. */
          const memberCount = typeof value?.members === "number" ? value.members : (view?.members.length ?? 0)
          /** Task count after approval, from the tool or from the projection. */
          const taskCount = typeof value?.tasks === "number" ? value.tasks : (view?.tasks.length ?? 0)
          setMessage(`approved: ${id} ${status} · members ${memberCount} · tasks ${taskCount}`)
          // Frozen §4.5: the echo is consumed by a SUCCESSFUL approval. A refusal keeps it
          // ("the echo stays, the scene stays open, nothing was written").
          setEcho("")
        } else {
          setMessage(`approve failed: ${result.error ?? "the tool refused the call"}`)
        }
      } catch (error) {
        setMessage(`approve failed: ${String((error as Error)?.message ?? error)}`)
      } finally {
        // Barrier 5: the record is re-read after the call settles, then keys are live again.
        // The echo is NOT cleared here: §4.5 keeps it on every refused outcome.
        setBusy(false)
        setView(readWorkflow(workspaceRoot, holds, teamViews, teamRecords, teamDeps?.teams, channelSession()))
      }
    }

    /** Arms on the first Ctrl+D and discards on a second press inside the frozen window. */
    const runDiscard = async (): Promise<void> => {
      /** The current time, compared against the arm's timestamp. */
      const now = Date.now()
      if (armedAt === 0 || now - armedAt > DISCARD_WINDOW_MS) {
        // First press only ARMS (frozen §4.3): nothing is sent.
        setArmedAt(now)
        setMessage("")
        return
      }
      setArmedAt(0)
      if (!actions.available()) {
        setMessage(`discard failed: ${PLAN_MUTATION_UNAVAILABLE}`)
        return
      }
      setBusy(true)
      setMessage("working…")
      try {
        /** The executor's verdict for this discard. */
        const result = await actions.discard({
          ...(team?.captainSessionId === undefined ? {} : { captainSessionId: team.captainSessionId }),
          ...(channelSession() === undefined ? {} : { sessionId: channelSession() as string }),
        })
        setMessage(result.ok ? "discarded: team archived" : `discard failed: ${result.error ?? "the tool refused the call"}`)
        // Same rule as approve (§4.5): only a SUCCESSFUL call consumes the consent echo.
        if (result.ok) setEcho("")
      } catch (error) {
        setMessage(`discard failed: ${String((error as Error)?.message ?? error)}`)
      } finally {
        setBusy(false)
        setView(readWorkflow(workspaceRoot, holds, teamViews, teamRecords, teamDeps?.teams, channelSession()))
      }
    }

    if (typeof ui.useInput === "function") {
      ui.useInput(
        (
          input: string,
          key:
            | { escape?: boolean; ctrl?: boolean; backspace?: boolean; return?: boolean; tab?: boolean; upArrow?: boolean; downArrow?: boolean; meta?: boolean }
            | undefined,
        ) => {
          // Barrier 5: single-flight — EVERY key is ignored while a call is in flight.
          if (busy) return
          if (!usable) {
            // The precondition failure accepts ONLY Esc: without a staged plan there is
            // nothing to approve, nothing to discard and nothing to type (frozen §3.2).
            if (key?.escape === true) leave()
            return
          }
          if (key?.ctrl === true && input === "x") {
            void runApprove()
            return
          }
          if (key?.ctrl === true && input === "d") {
            void runDiscard()
            return
          }
          // Any other key clears the discard arm (frozen §4.3).
          if (armedAt !== 0) setArmedAt(0)
          if (key?.escape === true) {
            // Esc NEVER mutates: it returns to the team surface when the user came from
            // there, and leaves the scene when the command was the entry point.
            leave()
            return
          }
          // Re-read. CONTRACT RECONCILIATION (reported loudly): §3.2 lists BOTH `r` =
          // refresh and "printable characters are appended to the echo", but the required
          // phrase is `approve <teamId>` — a word that itself contains `r`. Honouring `r`
          // as refresh at all times would make the phrase UNTYPEABLE. So `r` refreshes
          // while the echo is still EMPTY (the state in which §4.2 barrier 3 says the echo
          // is cleared anyway), and Ctrl+R refreshes unconditionally. Every safety barrier
          // is preserved: no prefill, no bare-key mutation, chords only.
          if (key?.ctrl === true && input === "r") {
            refresh()
            return
          }
          if (input === "r" && echo === "") {
            refresh()
            return
          }
          if (key?.backspace === true) {
            setEcho(echo === "" ? "" : [...echo].slice(0, -1).join(""))
            return
          }
          // THE SAME TWO GESTURES AS BEFORE (`j`/`k` and the arrows move by ONE row), now clamped by the
          // shared handle: pressing past the last row stops instead of blanking the body, which is the
          // far-edge defect the other three surfaces already had removed.
          if (key?.upArrow === true || input === "k") {
            viewport.scrollBy(-1)
            return
          }
          if (key?.downArrow === true || input === "j") {
            viewport.scrollBy(1)
            return
          }
          if (key?.return === true || key?.tab === true || key?.meta === true) return
          // Every bare printable key is CONSENT INPUT, never an action (barrier 4).
          if (typeof input === "string" && input.length >= 1 && input >= " " && key?.ctrl !== true) setEcho(echo + input)
        },
      )
    }

    // The preconditions the Web enforces before it even renders the editor
    // (`client.js:2437`): a staged team with a plan. Anything else is stated.
    const body: string[] = view === undefined ? ["reading the team record…"] : planProjectionLines(view)
    // The surface acts on the team it was opened for; when that id is not the newest
    // record the user is told which one is shown instead of silently drifting.
    if (usable && target.teamId !== undefined && team !== undefined && target.teamId !== team.id) {
      body.push(`note       team ${target.teamId} is not the newest record — showing ${team.id}`)
    }
    if (usable) for (const row of planActionLines(view, echo, armedAt !== 0, message, stagedPlan?.phrase ?? "")) body.push(row)

    // THE HANDLE'S SIZES ARE TOLD THIS RENDER'S BODY HEIGHT HERE, where the body is finally known.
    sizes.contentRows = Math.max(1, body.length)
    /** The offset for THIS render, clamped into the body's band — the far edge is a stop, not a blank. */
    const scrollAt = viewport.offset
    /** The body rows inside the window. */
    const visible = body.slice(scrollAt, scrollAt + viewportRows)
    /** The measured terminal size label. */
    const size = measured.size

    // THE SURFACE'S OWN STATE, in the one tone vocabulary every surface reports. It is read from THIS
    // file's own action vocabulary (`approved:`/`discarded:`/`… failed` are the exact prefixes the two
    // runners below set) plus the surface's own mode, so the frame, the marker and the verdict row can
    // never describe a different outcome than the words beside them.
    /** The tone this render reports. */
    const tone: SurfaceTone = busy
      ? "running"
      : message.startsWith("approve failed") || message.startsWith("discard failed")
        ? "failed"
        : message.startsWith("approved:")
          ? "completed"
          : message.startsWith("discarded:")
            ? "cancelled"
            : usable
              ? "focus"
              : "dim"

    // t3's F1: a COMMITTED mutation must be confirmed ON SCREEN even though the record
    // has already left the staged phase by the time the verdict renders. `message` is the
    // last SETTLED outcome of a call that was started while the plan was actionable
    // (`approved: …`, `discarded: …`, a tool refusal, or `working…`), so in the
    // non-usable branch it is the verdict. The emptiness of the branch is all that changes:
    // with NO settled outcome the precondition-failure rendering is byte-identical to
    // before (which is what the lane's malformed/non-staged/absent arms assert).
    const settled = message !== ""
    /** Whether this render must show a settled verdict instead of the precondition failure. */
    const verdict = !usable && settled

    /** The title row: the surface name, the team and the busy marker. */
    const title = !usable
      ? verdict
        ? `MPD plan approval — ${team?.name ?? "(none)"}`
        : `MPD plan approval — ${team === undefined ? "(none)" : `no staged plan for team ${team.id} (phase ${team.phase})`}`
      // A STAGED PLAN WITH NO RECORD still has a NAME — the plan's own — so the title addresses it
      // instead of falling back to "(none)" over the very plan the surface is asking about.
      : `MPD plan approval — ${team?.name ?? stagedPlan?.name ?? "(none)"}${busy ? " · working…" : ""}`
    /** The elements handed to the host's Box, in render order. */
    const children: unknown[] = [surfaceText(surface, "title", chromeTitle([`${stateMarker(tone, phase)} ${title}`, size]), { bold: true, tone })]
    if (!usable) {
      if (verdict) {
        // Frozen §4.5 row 1 / barrier 5: the verdict the runtime produced, rendered FIRST
        // so a committed approval can never read as "nothing to approve".
        children.push(surfaceText(surface, "verdict", message, { bold: true, tone }))
        children.push(
          surfaceText(surface, "context", team === undefined ? "the staged plan is no longer current" : `team ${team.id} · phase ${team.phase}`, { dim: true }),
        )
      } else {
        // The precondition failure accepts ONLY Esc: no confirmation echo, no chord.
        const detail = team === undefined ? "no staged plan for team (none)" : `no staged plan for team ${team.id} (phase ${team.phase})`
        children.push(surfaceText(surface, "empty", detail, { dim: true }))
      }
      children.push(surfaceHints(surface, "footer", ["esc back"]))
      return surfaceFrame(surface, "frame", clampCells(chromeTitle([`${stateMarker(tone, phase)} MPD plan approval`, size]), Math.max(8, contentCols - 2)), children, tone, clock.ref)
    }
    /** The body's drawn rows, in draw order — collected separately so the rail can sit BESIDE them. */
    const bodyRows: unknown[] = []
    for (let index = 0; index < visible.length; index += 1) {
      // EVERY BODY ROW GOES THROUGH THE SHARED BUILDER, so the plan surface's own labels (`confirm`,
      // `required`, `runnable`) carry the same tones here as the same labels do elsewhere. `runnable` is
      // the one row whose tone depends on a VALUE — whether the plan can actually run — so it is
      // overridden from the record rather than coloured by its label.
      bodyRows.push(surfaceBodyRow(surface, `line-${index}`, visible[index], { runnable: team?.runnable === true ? "completed" : "failed" }))
    }
    // THE RAIL IS THE SHARED BUILDER (frozen criteria I1/I5), drawn as a ONE-CELL SIBLING of the rows so
    // it reserves its column instead of widening a row. The plan scene had no rail at all; its window is
    // the same `slice(offset, offset + window)` shape the other three surfaces draw a rail for, so the
    // Non-goal's "only where the existing windowing already implies one" is satisfied — and no key
    // MEANING changes: `j`/`k` and `↑`/`↓` still move exactly one row.
    /** The draggable rail for this render, absent when the body fits its window. */
    const rail = viewportTrack(panel, viewport, "row")
    /** The rows column, which is the window's content half. */
    // THE WHEEL OVER THE BODY (frozen criterion I4): swallowed first so the gesture cannot also reach the
    // chat behind the frame, then applied through the ONE sign normalisation every surface uses — the raw
    // terminal delta is machine-dependent, so a plan that read it directly would scroll backwards on
    // exactly the installations the knob exists for.
    const rowsColumn = React.createElement(ui.Box, {
      key: "body-rows",
      flexDirection: "column",
      flexGrow: 1,
      onWheel: (event: { deltaY?: number } | undefined): void => {
        swallowWheelEvent(event)
        /** The wheel's vertical delta in this plugin's own convention; positive scrolls down. */
        const deltaY = normalizeWheelDelta(Number(event?.deltaY ?? 0), wheelInvertOn())
        if (deltaY !== 0) viewport.scrollBy(deltaY > 0 ? 1 : -1)
      },
    }, ...bodyRows)
    children.push(rail === undefined
      ? rowsColumn
      : React.createElement(ui.Box, { key: "body-window", flexDirection: "row", flexGrow: 1 }, rowsColumn, rail))
    if (busy) children.push(surfaceText(surface, "busy", "working…", { tone: "running" }))
    return surfaceFrame(surface, "frame", clampCells(chromeTitle([`${stateMarker(tone, phase)} MPD plan approval`, size]), Math.max(8, contentCols - 2)), children, tone, clock.ref)
  }
}

/**
 * Activate the full-screen scenes.
 * @param ctx - the plugin context; the host records it as each scene's registration identity.
 * @param tui - the DSH-TUI seam adapter (this file names no seam id of its own).
 * @param log - diagnostics.
 * @param workspaceRoot - resolves the workspace root per call.
 * @param home - resolves the home directory per call.
 * @param holds - the watchdog's held team ids; the hold row is simply omitted when unknown.
 * @param planActions - the adapter-backed approval executor.
 * @param planReader - the shared plan reader, per session.
 * @param teamViews - the official team readout, resolved per call.
 * @param teamRecords - the mpd-owned team records, resolved per call.
 * @param onHostKit - receives the host's own `ui` kit on every scene render, so the adapter can keep
 *   the one `useStdin` that resolves the LIVE input context (see `subagent-scene.ts`); optional, and
 *   a caller that omits it loses only the Ctrl+A take-over's ability to arm.
 * @param teamDeps - the session-scoped team reads every scene now needs: the `mpdTeams` face (for the
 *   session resolver) and the live feed (for the push). Optional, so a caller with neither keeps the
 *   pre-existing workspace-level, timer-only behaviour.
 * @returns the seam handle.
 */
export function registerScene(
  ctx: PluginContextLike,
  tui: TuiAdapter,
  log: Log,
  workspaceRoot: () => string,
  home: () => string,
  holds: () => readonly string[] = () => [],
  planActions: PlanActions = UNAVAILABLE_PLAN_ACTIONS,
  planReader?: (sessionId: string) => MpdPlanView["plan"] | undefined,
  teamViews?: () => readonly DshTeamView[],
  teamRecords?: () => readonly TeamRecord[],
  onHostKit?: (ui: unknown) => unknown,
  teamDeps?: TeamSourceDeps,
): SceneSeam {
  /** Navigation shared by the three components, mutated only by their own handlers. */
  const nav: SceneNav = { planFromTeam: false }

  /** Opens a registered scene by id, reporting a refusal instead of throwing. */
  const openScene = (id: string): boolean => {
    // The navigation call is the adapter's, resolved at CALL time: a scene opened before the seam
    // bound (or after it was composed late) takes the same path.
    if (!tui.openScene(id)) {
      log.debug(`scene open(${id}) skipped: this composition does not serve the scene seam or the id`)
      return false
    }
    return true
  }

  /** The seam handle: the aggregate outcome is recorded once all three scenes were requested. */
  const seam = tui.whenBound("scenes", (_service, _scope, handle) => {
    /** The bound scene registry, before `register` is trusted. */
    const runtime = tui.scenes()
    if (typeof runtime?.register !== "function") {
      handle.record({ state: "refused", detail: `${TUI_SEAMS.scenes}.register is missing` })
      return
    }
    try {
      // Scene TITLES have no localized contribution field on the installed host (measured: a
      // `TuiSceneDescriptor` carries one `title` string), so they are resolved through MPD's own
      // dictionary AT REGISTRATION. A `/lang` switch therefore reaches them at the NEXT plugin
      // apply (a restart), not mid-session — see the limits stated in `i18n.ts`.
      tui.registerScene({ id: BOARD_SCENE_ID, title: t("scene.board"), component: createBoardComponent(workspaceRoot, home, holds, nav, openScene, teamViews, teamRecords, onHostKit, teamDeps) }, ctx)
      tui.registerScene({ id: TEAM_SCENE_ID, title: t("scene.team"), component: createTeamComponent(workspaceRoot, holds, nav, openScene, teamViews, teamRecords, onHostKit, teamDeps) }, ctx)
      tui.registerScene({ id: PLAN_SCENE_ID, title: t("scene.plan"), component: createPlanComponent(workspaceRoot, holds, nav, openScene, planActions, planReader, teamViews, teamRecords, onHostKit, teamDeps) }, ctx)
      // The MERGED PANEL rides the SAME seam: the host's own subagent rows on top, the MPD team
      // body below them. It gets the SAME `readWorkflow` closure the team scene uses, so the two
      // surfaces cannot describe one team differently. MPD's own key opens it; `Ctrl+A` — the
      // host's subagent dashboard — is never bound anywhere in this package.
      tui.registerScene(
        {
          id: SUBAGENT_SCENE_ID,
          // The descriptor's title is localized at registration; inside the scene the component
          // renders its own body header from the same dictionary, so the two agree per render.
          title: t("scene.subagents"),
          component: createSubagentSceneComponent((sessionId?: string) => readWorkflow(workspaceRoot, holds, teamViews, teamRecords, teamDeps?.teams, sessionId), onHostKit, undefined, teamDeps?.subscribeTeams),
        },
        ctx,
      )
      // `open(unknownId)` is how the host reports an unregistered scene; calling
      // it here would OPEN a scene, so it is never used as a probe. The host
      // exposes no scene read-back, hence `requested`.
      handle.record({ state: "requested", detail: `${BOARD_SCENE_ID}, ${TEAM_SCENE_ID}, ${PLAN_SCENE_ID}, ${SUBAGENT_SCENE_ID} requested (no host read-back)` })
    } catch (error) {
      /** The refusal reason, reported and logged once. */
      const detail = String((error as Error)?.message ?? error)
      handle.record({ state: "refused", detail })
      log.debug(`scene registration refused: ${detail}`)
    }
  })

  /** Opens the board scene; the shortcut and command paths both land here. */
  const open = (): boolean => openScene(BOARD_SCENE_ID)

  return {
    outcome: (): SeamOutcome => seam.outcome(),
    open,
    openScene,
    openTeam: () => {
      nav.planFromTeam = false
      nav.planTeamId = undefined
      return openScene(TEAM_SCENE_ID)
    },
    openPlan: (options) => {
      nav.planFromTeam = options?.returnToTeam === true
      nav.planTeamId = options?.teamId
      return openScene(PLAN_SCENE_ID)
    },
    openSubagents: () => openScene(SUBAGENT_SCENE_ID),
  }
}

/**
 * The status line the `/mpd status` action prints.
 *
 * The SAME sentence the keyed status row publishes (`state.ts`'s projection), signed the same way: the
 * state mark trails the line. Nothing is inserted at the head, because the head is pinned — the command
 * contract requires this print to START with `mpd:` (`plugin.test.ts`, the `/mpd` grammar arm).
 * @param workspaceRoot - resolves the workspace root per call.
 * @param home - resolves the home directory per call.
 * @param teamViews - the official team readout, resolved per call.
 * @param teamRecords - the mpd-owned team records, resolved per call.
 * @returns the one-line summary, state mark last; never throws.
 */
export function boardSummary(workspaceRoot: () => string, home: () => string, teamViews?: () => readonly DshTeamView[], teamRecords?: () => readonly TeamRecord[]): string {
  try {
    /** This call's projection, read once: the sentence and the mark must describe the same board. */
    const state = readBoardState(workspaceRoot(), home(), teamViews?.() ?? [], teamRecords?.() ?? [])
    return `${statusLine(state)} ${statusMarker(state)}`
  } catch {
    return "mpd: state unreadable ?"
  }
}
