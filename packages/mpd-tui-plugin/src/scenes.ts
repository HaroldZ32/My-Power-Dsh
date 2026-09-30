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
import type { PluginContextLike, SeamOutcome, TuiScenePropsLike, TuiScenesLike } from "./types.js"
import type { Log } from "./log.js"
import { onService } from "./host.js"
import { boardLines, readBoardState, statusLine } from "./state.js"
import { cellWidth, clampCells, stripControl } from "./sanitize.js"
import type { TeamWorkflow } from "./team-state.js"
import { approvalPhrase, planProjectionLines, readRecordWorkflow, readTeamWorkflow, teamWorkflowLines, type MpdPlanView } from "./team-state.js"
import { GRAPH_THEME, hitTest, layoutGraph, type GraphTask } from "./graph.js"
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
  /** Approves a staged plan once the user typed the exact phrase; never fabricates success. */
  approve(input: { teamId: string; confirmation: string; captainSessionId?: string }): Promise<PlanActionOutcome>
  /** Archives a staged plan; the scene arms it with a second Ctrl+D inside the frozen window. */
  discard(input: { captainSessionId?: string }): Promise<PlanActionOutcome>
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

/** Read one workflow, never throwing: on top of `readTeamWorkflow`'s own guard this is the last net. */
function readWorkflow(workspaceRoot: () => string, holds: () => readonly string[], teamViews?: () => readonly DshTeamView[], teamRecords?: () => readonly TeamRecord[]): TeamWorkflow | undefined {
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
    // THE PRIMARY SOURCE FIRST: the mpd record, whose review fields and lifecycle are real data.
    // The official readout answers only when this workspace holds no record at all.
    /** The principal record, which is the newest that has not ended. */
    const principal = records.find((record) => record.endedAt === undefined) ?? records[0]
    if (principal !== undefined) return readRecordWorkflow(workspaceRoot(), holdIds, principal)
    return readTeamWorkflow(workspaceRoot(), holdIds, views)
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
 * @returns the size label, the column count the graph sizes itself from, and the body row budget.
 */
function measureTerminal(ui: any): { size: string; cols: number; window: number } {
  if (typeof ui?.useTerminalSize !== "function") return { size: "", cols: FALLBACK_COLS, window: 20 }
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
  return {
    size,
    cols: Number.isFinite(terminalCols) && terminalCols > 20 ? terminalCols : FALLBACK_COLS,
    window: Number.isFinite(terminalRows) && terminalRows > 8 ? terminalRows - 6 : 20,
  }
}

/**
 * Build the board component.
 * @param workspaceRoot - resolves the workspace root per call.
 * @param home - resolves the home directory per call.
 * @param holds - the watchdog's held team ids for the workspace.
 * @param nav - the shared surface navigation.
 * @param openScene - opens a scene by id.
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

    /** Reads the board rows, degrading to one explicit line when the read fails. */
    const read = (): string[] => {
      try {
        return boardLines(readBoardState(workspaceRoot(), home(), teamViews?.() ?? [], teamRecords?.() ?? []), holds())
      } catch {
        return ["board state unreadable"]
      }
    }

    /** The board rows as host state; the initial read happens in the effect below. */
    const state = React.useState([] as string[])
    /** The current rows, the value this render draws. */
    const rows = state[0] as string[]
    /** Replaces the rows: the initial read, the refresh key and the timer all use it. */
    const setRows = state[1] as (next: string[]) => void

    React.useEffect(() => {
      // Initial read is deferred to the effect: the render path stays free of
      // synchronous I/O (scene red line).
      setRows(read())
      /** The refresh timer, absent when the host refused to schedule one. */
      let timer: ReturnType<typeof setInterval> | undefined
      try {
        timer = setInterval(() => setRows(read()), BOARD_REFRESH_MS)
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

    if (typeof ui.useInput === "function") {
      ui.useInput((input: string, key: { escape?: boolean; ctrl?: boolean } | undefined) => {
        if (key?.escape === true || input === "q") close()
        else if (input === "r") setRows(read())
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

    // Host terminal-size hook (conventions §b): the scene adapts instead of
    // assuming a geometry. Always called, with a safe fallback shape.
    const measured = measureTerminal(ui)
    /** The measured terminal size label, empty when the host could not measure. */
    const size = measured.size

    /** The title row: the line count plus the measured size. */
    const header = `MPD board — ${rows.length} line(s)${size === "" ? "" : ` · ${size}`}`
    /** The elements handed to the host's Box, in render order. */
    const children: unknown[] = [
      // Title/counts chrome (the host draws NO chrome for a scene).
      React.createElement(ui.Text, { key: "title", bold: true }, safeLine(header)),
      React.createElement(ui.Text, { key: "meta", dimColor: true }, safeLine(`${sessionRows} transcript row(s)`)),
    ]
    for (let index = 0; index < rows.length; index += 1) {
      children.push(React.createElement(ui.Text, { key: `line-${index}` }, safeLine(rows[index])))
    }
    // Key-hint footer, always the last row.
    children.push(React.createElement(ui.Text, { key: "footer", dimColor: true }, safeLine("esc/q close · r refresh · a team workflow")))

    // flexGrow: the scene fills the terminal it was handed.
    return React.createElement(ui.Box, { flexDirection: "column", width: "100%", flexGrow: 1, paddingX: 1 }, children)
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
 * @returns a component matching the host's `TuiSceneProps` contract.
 */
function createTeamComponent(
  workspaceRoot: () => string,
  holds: () => readonly string[],
  nav: SceneNav,
  openScene: (id: string) => boolean,
  teamViews?: () => readonly DshTeamView[],
  teamRecords?: () => readonly TeamRecord[],
): unknown {
  return function MpdTuiTeam(props: TuiScenePropsLike): unknown {
    /** The host's own React instance; every hook and element must use it. */
    const React = props?.React
    /** The host's ui kit (Box, Text, useInput, useTerminalSize). */
    const ui = props?.ui
    /** Leaves the scene; a host without the callback gets a no-op, so a key never throws. */
    const close = typeof props?.close === "function" ? props.close : () => {}
    if (!usableKit(React, ui)) return null

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
    /** The scroll offset, in rows. */
    const scrollState = React.useState(0)
    /** The scroll offset, in rows. */
    const scroll = scrollState[0] as number
    /** Moves the offset; `r` resets it to 0. */
    const setScroll = scrollState[1] as (next: number) => void
    // The last read's facts, so a key handler answers "is this team staged?" without a second read
    // and without reading state from a stale render closure.
    const latestRef = React.useRef?.(undefined as { staged: boolean; teamId?: string } | undefined)
    // The drawn geometry, kept for the POINTER handlers: a click arrives with coordinates and the
    // handler must resolve them against the very layout that produced the pixels on screen. Reading
    // it from a ref rather than from the closure is what keeps a pointer event answered against the
    // CURRENT drawing after a refresh moved the rows.
    const viewRef = React.useRef?.(undefined as ReturnType<typeof layoutGraph> | undefined)

    /** Re-read the workflow and publish it. The render path stays free of I/O. */
    const refresh = (): void => {
      /** The freshly read projection; undefined means unreadable. */
      let next: TeamWorkflow | undefined
      try {
        next = readWorkflow(workspaceRoot, holds, teamViews, teamRecords)
      } catch {
        next = undefined
      }
      setWorkflow(next)
      if (latestRef !== undefined && latestRef !== null) {
        latestRef.current = { staged: next?.team?.staged === true, ...(next?.team?.id === undefined ? {} : { teamId: next.team.id }) }
      }
    }

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

    /** The board in the graph's own vocabulary. */
    const graphTasks: GraphTask[] = (workflow?.tasks ?? []).map((task) => ({
      id: task.id,
      subject: task.subject,
      ...(task.kind === undefined ? {} : { kind: task.kind }),
      visual: task.visual,
      ...(task.assignee === undefined ? {} : { assignee: task.assignee }),
      dependencies: task.dependencies,
      depth: task.depth,
      ...(task.attempt === undefined ? {} : { attempt: task.attempt }),
    }))
    /** HOVER OUTRANKS THE PIN while it lasts: the pointer is the more recent intent. */
    const focus = hover ?? pinned
    // The window is computed from the host's own terminal size (never assumed).
    const measured = measureTerminal(ui)
    /** The graph's own viewport, inside the scene's one-cell padding. */
    const graphWidth = Math.max(20, measured.cols - 4)
    /** The drawing for this render. */
    const view = layoutGraph(graphTasks, graphWidth, focus)
    if (viewRef !== undefined && viewRef !== null) viewRef.current = view
    /** The tasks the focus would move through, in DRAWING order, which is what the arrow keys walk. */
    const ordered = view.hits.map((hit) => hit.taskId)

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
      ui.useInput((input: string, key: { escape?: boolean; upArrow?: boolean; downArrow?: boolean; shift?: boolean } | undefined) => {
        // `esc` UNPINS rather than closing while something is pinned: the pin is a mode, and a user
        // who clicked a task must be able to leave that mode without leaving the scene.
        if (key?.escape === true && pinned !== undefined) { setPinned(undefined); setHover(undefined); return }
        if (key?.escape === true || input === "q") close()
        else if (input === "r") { setScroll(0); refresh() }
        else if (key?.upArrow === true || input === "k") (key?.shift === true ? setScroll(Math.max(0, scroll - 1)) : moveFocus(-1))
        else if (key?.downArrow === true || input === "j") (key?.shift === true ? setScroll(scroll + 1) : moveFocus(1))
        else if (input === "g") { setScroll(0) }
        else if (input === "p") { nav.planFromTeam = false; openScene(BOARD_SCENE_ID) }
        else if (input === "a") {
          /** Whether the last read saw a staged team, which is what the `a` key needs. */
          const staged = latestRef?.current?.staged === true
          if (!staged) { setNotice("plan approval needs a staged team"); return }
          setNotice("")
          nav.planFromTeam = true
          nav.planTeamId = latestRef?.current?.teamId
          if (!openScene(PLAN_SCENE_ID)) setNotice("the plan approval surface is not available in this composition")
        }
      })
    }

    /** The elements handed to the host's Box, in render order. */
    const children: unknown[] = []
    /** The team head, when there is one. */
    const head = workflow?.team
    // THE TEAM ID IS DRAWN, and it is not decoration: `approve <teamId>` is the exact phrase the
    // plan surface demands, and the id is what tells two waves apart. Two existing arms caught its
    // absence the moment this header was rewritten — the second of them through the CONTROL
    // CHARACTER it carries, which is why the id is the string the render boundary is tested with.
    children.push(React.createElement(ui.Text, { key: "title", bold: true },
      safeLine(`MPD team${head === undefined ? " — (none)" : ` — ${head.name} (${head.id})`}${measured.size === "" ? "" : ` · ${measured.size}`}`)))
    if (workflow === undefined) {
      children.push(React.createElement(ui.Text, { key: "unreadable" }, safeLine("team state unreadable")))
    } else if (head === undefined) {
      // The honest empty state: the workspace really holds no team, and the row says which tool
      // fills it rather than showing an empty frame.
      children.push(React.createElement(ui.Text, { key: "none", dimColor: true },
        safeLine("no team in this workspace — stage one with agent_teams_plan, then approve it")))
    } else {
      /** The tally row, in the vocabulary the record uses. */
      const counts = workflow.counts
      children.push(React.createElement(ui.Text, { key: "phase" },
        safeLine(`${head.phase} · ${counts.total} task(s) · ${counts.completed} done · ${counts.inProgress} running · ${counts.pending} pending · ${counts.failed} failed · ${head.links} link(s)`)))
      /** The roster, one wrapped line, so the graph gets the room. */
      const roster = workflow.members.length === 0
        ? "roster  (no members)"
        : "roster  " + workflow.members.map((member) => `${member.status === "running" ? "◐" : "○"}${member.name} ${member.done}/${member.total}`).join(" · ")
      for (const chunk of wrapCells(roster, graphWidth)) children.push(React.createElement(ui.Text, { key: `roster-${chunk}`, dimColor: true }, safeLine(chunk)))
      if (workflow.holds.includes(head.id)) children.push(React.createElement(ui.Text, { key: "hold", color: "warning" }, safeLine(`watchdog   HELD (${workflow.holds.join(", ")})`)))
      /** The graph's own header, which names the focus so the highlight is explainable. */
      const focusLabel = focus === undefined ? "" : ` · focus ${focus}${view.chain.length === 0 ? "" : ` ⇠ ${view.chain.join(",")}`}`
      children.push(React.createElement(ui.Text, { key: "graphhead", dimColor: true }, safeLine(`task dependency graph${view.mode === "rail" ? " (rail)" : ""}${focusLabel}`)))
      // THE GRAPH BOX OWNS THE POINTER. Its children are exactly the drawn rows, in order, so a
      // `localRow`/`localCol` from the host's event resolves against the SAME geometry that was
      // drawn — `hitTest` is a rectangle lookup on the layout, never a second one.
      /** The rows of the graph that fit the window. */
      const graphWindow = Math.max(3, measured.window - 4)
      /** One host element per drawn graph row, each carrying its coloured spans. */
      const graphRows: unknown[] = []
      for (let index = scroll; index < Math.min(view.lines.length, scroll + graphWindow); index += 1) {
        /** The spans of this row, each drawn in its own theme colour. */
        const spans = view.lines[index].map((span, at) => React.createElement(ui.Text, { key: `s${at}`, color: GRAPH_THEME[span.tone] }, span.text))
        graphRows.push(React.createElement(ui.Text, { key: `g${index}` }, ...spans))
      }
      children.push(React.createElement(ui.Box, {
        key: "graph",
        flexDirection: "column",
        // Pointer handlers: present on every host, INERT on one without mouse tracking, so the
        // keyboard path is untouched and nothing has to feature-detect.
        onMouseEnter: (event: { localRow?: number; localCol?: number } | undefined) => {
          /** The view this render drew, read back so the handler cannot answer a stale layout. */
          const drawn = viewRef?.current
          if (drawn === undefined) return
          /** The task under the pointer, or none. */
          const under = hitTest(drawn, Number(event?.localRow ?? -1) + scroll, Number(event?.localCol ?? -1))
          setHover(under)
        },
        onMouseLeave: () => setHover(undefined),
        onClick: (event: { localRow?: number; localCol?: number } | undefined) => {
          /** The view this render drew. */
          const drawn = viewRef?.current
          if (drawn === undefined) return
          /** The task that was clicked, or none for blank space. */
          const under = hitTest(drawn, Number(event?.localRow ?? -1) + scroll, Number(event?.localCol ?? -1))
          // Clicking the pinned task again, or blank space, UNPINS — the same gesture that pinned it.
          setPinned(under === undefined || under === pinned ? undefined : under)
          setHover(under)
        },
        onWheel: (event: { deltaY?: number } | undefined) => {
          /** The wheel's direction; a positive delta scrolls down, as every terminal reports it. */
          const delta = Number(event?.deltaY ?? 0)
          if (delta !== 0) setScroll(Math.max(0, scroll + (delta > 0 ? 1 : -1)))
        },
      }, graphRows))
      // The detail pane: the focused task's contract, which is what a reader needs after finding it.
      /** The focused task's row, when there is one. */
      const detail = focus === undefined ? undefined : workflow.tasks.find((task) => task.id === focus)
      if (detail !== undefined) {
        children.push(React.createElement(ui.Text, { key: "detail", bold: true },
          safeLine(`${detail.id} · ${detail.kind ?? "?"} · ${detail.subject}`)))
        children.push(React.createElement(ui.Text, { key: "detail-meta", dimColor: true },
          safeLine(`${detail.visual}${detail.attempt === undefined ? "" : ` · attempt ${detail.attempt}`}${detail.round === undefined ? "" : ` · round ${detail.round}`}${detail.verdict === undefined ? "" : ` · ${detail.verdict}`}${detail.assignee === undefined ? "" : ` · @${detail.assignee}`}${detail.dependencies.length === 0 ? "" : ` · ⇠ ${detail.dependencies.join(",")}`}`)))
      }
      for (const problem of workflow.problems) children.push(React.createElement(ui.Text, { key: `problem-${problem}`, color: "warning" }, safeLine(`note       ${problem}`)))
    }
    if (notice !== "") children.push(React.createElement(ui.Text, { key: "notice", color: "yellow" }, safeLine(notice)))
    children.push(React.createElement(ui.Text, { key: "footer", dimColor: true },
      safeLine("esc/q close · ↑↓ focus · click pins · hover previews · ⇧↑↓ scroll · r refresh · a plan · p board")))
    return React.createElement(ui.Box, { flexDirection: "column", width: "100%", flexGrow: 1, paddingX: 1 }, children)
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
  teamRecords?: () => readonly TeamRecord[],): unknown {
  return function MpdTuiPlan(props: TuiScenePropsLike): unknown {
    /** The host's own React instance; every hook and element must use it. */
    const React = props?.React
    /** The host's ui kit (Box, Text, useInput, useTerminalSize). */
    const ui = props?.ui
    /** Leaves the scene; a host without the callback gets a no-op, so a key never throws. */
    const close = typeof props?.close === "function" ? props.close : () => {}
    if (!usableKit(React, ui)) return null

    // ── THE SESSION ID COMES FROM THE LIVE CHANNEL ────────────────────────────
    // A staged plan is SESSION-scoped (`.mpd/team/staging/<sessionId>.json`) while every other read
    // this row makes is workspace-scoped — the row has no session of its own. A SCENE does: the host
    // hands it the live channel, and `sessionId` is one of that channel's published properties. That
    // is the whole reason the plan is reachable here, and it is why nothing needs caching: the id is
    // read per render off the props the host just passed.
    /** The live channel's session id, or undefined before the channel has bound one. */
    const channelSession = (): string | undefined => {
      /** The channel, narrowed to the one property this surface reads. */
      const live = (props as { channel?: { sessionId?: unknown } } | undefined)?.channel
      /** The id as a string, or undefined when the host has not bound one yet. */
      const id = typeof live?.sessionId === "string" ? live.sessionId : undefined
      return id === undefined || id === "" ? undefined : id
    }

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
    /** The scroll offset as host state. */
    const scrollState = React.useState(0)
    /** The current offset, in rows. */
    const scroll = scrollState[0] as number
    /** Moves the offset; refresh resets it to 0. */
    const setScroll = scrollState[1] as (next: number) => void

    /** Re-reads the record and resets the consent echo, the arm and the scroll. */
    const refresh = (): void => {
      setView(readWorkflow(workspaceRoot, holds, teamViews, teamRecords))
      // Barrier 3: the echo is EMPTY on every entry and on every explicit refresh.
      setEcho("")
      setArmedAt(0)
      setScroll(0)
    }

    React.useEffect(() => {
      // Initial read in the effect (never in the render path).
      refresh()
      /** The periodic re-read timer, absent when the host refused to schedule one. */
      let timer: ReturnType<typeof setInterval> | undefined
      try {
        timer = setInterval(() => {
          // The automatic re-read refreshes the FACTS only: the consent echo and the 10 s
          // discard arm are cleared by the explicit `r` key (frozen §4.2 barrier 3 / §4.3).
          setView(readWorkflow(workspaceRoot, holds, teamViews, teamRecords))
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
      setScroll(0)
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
          teamId: team.id,
          confirmation: echo,
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
        setView(readWorkflow(workspaceRoot, holds, teamViews, teamRecords))
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
        const result = await actions.discard(team?.captainSessionId === undefined ? {} : { captainSessionId: team.captainSessionId })
        setMessage(result.ok ? "discarded: team archived" : `discard failed: ${result.error ?? "the tool refused the call"}`)
        // Same rule as approve (§4.5): only a SUCCESSFUL call consumes the consent echo.
        if (result.ok) setEcho("")
      } catch (error) {
        setMessage(`discard failed: ${String((error as Error)?.message ?? error)}`)
      } finally {
        setBusy(false)
        setView(readWorkflow(workspaceRoot, holds, teamViews, teamRecords))
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
          if (key?.upArrow === true || input === "k") {
            setScroll(scroll > 0 ? scroll - 1 : 0)
            return
          }
          if (key?.downArrow === true || input === "j") {
            setScroll(scroll + 1)
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

    /** The terminal measurement, taken once per render. */
    const measured = measureTerminal(ui)
    /** The body rows inside the window. */
    const visible = body.slice(scroll, scroll + measured.window)
    /** The measured terminal size label. */
    const size = measured.size

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
    const children: unknown[] = [React.createElement(ui.Text, { key: "title", bold: true }, safeLine(`${title}${size === "" ? "" : ` · ${size}`}`))]
    if (!usable) {
      if (verdict) {
        // Frozen §4.5 row 1 / barrier 5: the verdict the runtime produced, rendered FIRST
        // so a committed approval can never read as "nothing to approve".
        children.push(React.createElement(ui.Text, { key: "verdict", bold: true }, safeLine(message)))
        children.push(
          React.createElement(
            ui.Text,
            { key: "context", dimColor: true },
            safeLine(team === undefined ? "the staged plan is no longer current" : `team ${team.id} · phase ${team.phase}`),
          ),
        )
      } else {
        // The precondition failure accepts ONLY Esc: no confirmation echo, no chord.
        const detail = team === undefined ? "no staged plan for team (none)" : `no staged plan for team ${team.id} (phase ${team.phase})`
        children.push(React.createElement(ui.Text, { key: "empty" }, safeLine(detail)))
      }
      children.push(React.createElement(ui.Text, { key: "footer", dimColor: true }, safeLine("esc back")))
      return React.createElement(ui.Box, { flexDirection: "column", width: "100%", flexGrow: 1, paddingX: 1 }, children)
    }
    for (let index = 0; index < visible.length; index += 1) {
      children.push(React.createElement(ui.Text, { key: `line-${index}` }, safeLine(visible[index])))
    }
    if (busy) children.push(React.createElement(ui.Text, { key: "busy", dimColor: true }, safeLine("working…")))
    return React.createElement(ui.Box, { flexDirection: "column", width: "100%", flexGrow: 1, paddingX: 1 }, children)
  }
}

/**
 * Activate the full-screen scenes.
 * @param ctx - the plugin context.
 * @param log - diagnostics.
 * @param workspaceRoot - resolves the workspace root per call.
 * @param home - resolves the home directory per call.
 * @param holds - the watchdog's held team ids; the hold row is simply omitted when unknown.
 * @param planActions - the adapter-backed approval executor.
 * @returns the seam handle.
 */
export function registerScene(
  ctx: PluginContextLike,
  log: Log,
  workspaceRoot: () => string,
  home: () => string,
  holds: () => readonly string[] = () => [],
  planActions: PlanActions = UNAVAILABLE_PLAN_ACTIONS,
  planReader?: (sessionId: string) => MpdPlanView["plan"] | undefined,
  teamViews?: () => readonly DshTeamView[],
  teamRecords?: () => readonly TeamRecord[],
): SceneSeam {
  /** The seam result, rewritten when the three scenes are registered. */
  let outcome: SeamOutcome = { state: "absent", detail: "tuiScenes was not injected" }
  /** The registered scene service, undefined until the deferred activation runs. */
  let scenes: TuiScenesLike | undefined
  /** Navigation shared by the three components, mutated only by their own handlers. */
  const nav: SceneNav = { planFromTeam: false }

  /** Opens a registered scene by id, reporting a refusal instead of throwing. */
  const openScene = (id: string): boolean => {
    if (scenes === undefined) {
      log.debug(`scene open(${id}) skipped: tuiScenes was not injected`)
      return false
    }
    try {
      /** The host's answer; anything but `true` is reported as a refusal. */
      const opened = scenes.open(id)
      if (opened !== true) log.debug(`scene open(${id}) returned ${String(opened)}`)
      return opened === true
    } catch (error) {
      log.debug(`scene open(${id}) failed: ${String((error as Error)?.message ?? error)}`)
      return false
    }
  }

  onService(ctx, "tuiScenes", (scoped, service) => {
    /** The probed service as the scene registry, before `register` is trusted. */
    const runtime = service as TuiScenesLike
    if (typeof runtime?.register !== "function") {
      outcome = { state: "refused", detail: "tuiScenes.register is missing" }
      return
    }
    scenes = runtime
    try {
      runtime.register({ id: BOARD_SCENE_ID, title: "MPD board", component: createBoardComponent(workspaceRoot, home, holds, nav, openScene, teamViews, teamRecords) }, scoped)
      runtime.register({ id: TEAM_SCENE_ID, title: "MPD team", component: createTeamComponent(workspaceRoot, holds, nav, openScene, teamViews, teamRecords) }, scoped)
      runtime.register({ id: PLAN_SCENE_ID, title: "MPD plan approval", component: createPlanComponent(workspaceRoot, holds, nav, openScene, planActions, planReader, teamViews, teamRecords) }, scoped)
      // `open(unknownId)` is how the host reports an unregistered scene; calling
      // it here would OPEN a scene, so it is never used as a probe. The host
      // exposes no scene read-back, hence `requested`.
      outcome = { state: "requested", detail: `${BOARD_SCENE_ID}, ${TEAM_SCENE_ID}, ${PLAN_SCENE_ID} requested (no host read-back)` }
    } catch (error) {
      outcome = { state: "refused", detail: String((error as Error)?.message ?? error) }
      log.debug(`scene registration refused: ${outcome.detail ?? ""}`)
    }
  })

  /** Opens the board scene; the shortcut and command paths both land here. */
  const open = (): boolean => openScene(BOARD_SCENE_ID)

  return {
    outcome: () => outcome,
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
  }
}

/** The status line the `/mpd status` action prints. */
export function boardSummary(workspaceRoot: () => string, home: () => string, teamViews?: () => readonly DshTeamView[], teamRecords?: () => readonly TeamRecord[]): string {
  try {
    return statusLine(readBoardState(workspaceRoot(), home(), teamViews?.() ?? [], teamRecords?.() ?? []))
  } catch {
    return "mpd: state unreadable"
  }
}
