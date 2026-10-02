// THE MERGED PANEL — the HOST's own subagent rows ABOVE the MPD team panel.
//
// WHY A SCENE, AND NOT A ROW INSIDE dsh-tui's SubagentDashboard (measured on dsh-tui 0.12.0): the
// host's `TuiSceneDescriptor` is `{id, title, component}` and has NO slot/section/panel field;
// `SubagentDashboard` is a Chat-LOCAL early return (Chat.js swaps the whole screen for it) and is
// not a contribution target; the plugin surface has no panel/section contribution kind at all. The
// literal merge therefore needs an upstream seam (this wave drafts the request). This scene is the
// best LEGAL approximation of it.
//
// WHAT IT RENDERS, top to bottom:
//   (a) the HOST's subagent rows, read from `props.channel.subagents` — the very array `Ctrl+A`
//       renders its dashboard from, because the scene outlet hands a plugin scene the SAME channel
//       object (`dsh-adapter/channel-scene-outlet.js` does
//       `createElement(scene.component, {React, ui, channel, close})`). The DATA-level merge is
//       therefore not something this file invents: MPD teammates are ordinary continuable
//       subagents, so the host's own array already holds them;
//   (b) the MPD team panel BELOW it, from the same `teamWorkflowLines` projection the team scene
//       renders (team-state.ts), plus the DAG box `graph.ts` draws for that scene;
//   (c) a footer hint line.
//
// DEFENSIVE RULES (a plugin scene renders inside the host's own error boundary — a throw is
// contained, but the surface is lost, and with it the screen the user asked for):
//   · `channel.subagents` may be absent, frozen, or hold anything: every field is read as
//     `unknown` and narrowed, and an unrecognized status renders as `unknown` — never guessed
//     into "completed";
//   · `channel.subagentControl` is declared on the channel, but a composition without native
//     control returns false, so it is feature-detected before EVERY interrupt call;
//   · no duration is ever computed for a row the host did not report: only the host's own
//     `startedAt`/`endedAt` instants are printed, as ISO-8601 UTC, and an unreadable instant is
//     omitted rather than invented;
//   · every external string crosses sanitize.ts (`stripControl` + `clampCells`) before `ui.Text`.
//
// This file never imports React: it uses `props.React.createElement` (the documented always-safe
// form), so it cannot drag a second React copy under the host's reconciler.
import type { TuiScenePropsLike } from "./types.js"
import { clampCells, stripControl } from "./sanitize.js"
import { GRAPH_THEME, layoutGraph, type GraphTask, type GraphView } from "./graph.js"
import { teamWorkflowLines, type TeamWorkflow } from "./team-state.js"

/** The scene id this component is registered under (unique, kebab-case, MPD-owned). */
export const SUBAGENT_SCENE_ID = "mpd-tui-subagents"

/** The scene title the host's registry shows for it. */
export const SUBAGENT_SCENE_TITLE = "MPD subagents + team"

/** The cell budget of ONE rendered row — the same bound the other scenes apply to their rows. */
export const MERGED_ROW_MAX_CELLS = 4000

/** The column count the DAG is laid out for before the host has measured one. */
const FALLBACK_COLS = 100

/** The team projection's refresh cadence, shared with the board and team surfaces. */
const REFRESH_MS = 2000

/** Every status the host's own `SubagentStatus` union can carry, as data (never guessed). */
const KNOWN_STATUSES: readonly string[] = ["starting", "running", "completed", "failed", "cancelled", "unknown"]

/** Every durable mode the host's own `SubagentState['mode']` can carry, as data. */
const KNOWN_MODES: readonly string[] = ["one-shot", "continuable", "unknown"]

/**
 * The host's own `SubagentCard` glyphs, reused verbatim so the two surfaces read the same way.
 *
 * `unknown` is the HISTORICAL row: the host discovers an idle child it did not witness settle, and
 * the parent log alone cannot prove how its last epoch ended — so it is drawn as unknown, never as
 * a completed run.
 */
const SUBAGENT_GLYPHS = {
  /** A live run (`running`/`starting`). */
  live: "🟡",
  /** A row whose outcome the host cannot prove. */
  unknown: "⚪",
  /** A run that failed or was cancelled. */
  failed: "🔴",
  /** A run the host reports as completed. */
  completed: "🟢",
} as const

/** One subagent row as this scene renders it, projected without a single assumption. */
export interface SubagentRowView {
  /** The host's agent id, kept ONLY so the interrupt path has a target; absent when unreadable. */
  agentId?: string
  /** The sanitized description, or `(no description)` when the host reported none. */
  description: string
  /** `one-shot`, `continuable` or `unknown` — the host's own vocabulary, never invented. */
  mode: string
  /** The host's own status when it is one this file knows, otherwise `unknown`. */
  status: string
  /** The real start instant as ISO-8601 UTC; undefined when the host reported none. */
  startedAt?: string
  /** The real end instant as ISO-8601 UTC; undefined for a row the host has not ended. */
  endedAt?: string
  /** True only for a live run (`running`/`starting`) — the host's own liveness test. */
  live: boolean
  /** True only for a terminal failure (`failed`/`cancelled`). */
  failed: boolean
}

/** One drawn row of the subagent section, with the emphasis it must carry. */
export interface SubagentSectionRow {
  /** The row text, already sanitized at this boundary. */
  text: string
  /** True for the section's own header row. */
  header?: boolean
  /** True for the host's empty-state rows, which it draws dimmed. */
  dim?: boolean
  /** The index into {@link SubagentRowView} list when this row IS a subagent, else absent. */
  rowIndex?: number
}

/** The React instance surface this scene uses, as the host's own React must expose it. */
interface ReactLike {
  /** Creates one element; the scene never imports React itself. */
  createElement(type: unknown, props?: Record<string, unknown> | null, ...children: unknown[]): unknown
  /** One state cell (the host React's own `useState`). */
  useState(initial: unknown): [unknown, (next: unknown) => void]
  /** One effect (the host React's own `useEffect`). */
  useEffect(effect: () => unknown, deps?: readonly unknown[]): void
  /** The host React's own `useSyncExternalStore`, when this build exposes it. */
  useSyncExternalStore?(
    subscribe: (listener: () => void) => () => void,
    getSnapshot: () => unknown,
    getServerSnapshot?: () => unknown,
  ): unknown
}

/** The key flags the host passes to a `useInput` handler, as this scene reads them. */
interface SceneKey {
  /** Esc — leaves the scene. */
  escape?: boolean
  /** Up arrow — moves the selection up. */
  upArrow?: boolean
  /** Down arrow — moves the selection down. */
  downArrow?: boolean
  /** Ctrl, read only to keep a plain `i`/`r` distinguishable from a modified one. */
  ctrl?: boolean
}

/** The ui-kit surface this scene uses, as the host's own kit must expose it. */
interface UiLike {
  /** The host's column box. */
  Box: unknown
  /** The host's text row. */
  Text: unknown
  /** The host's key hook, when this build exposes it. */
  useInput?(handler: (input: string, key: SceneKey | undefined) => void): void
  /** The host's terminal-size hook, when this build exposes it. */
  useTerminalSize?(): { columns?: unknown; rows?: unknown }
}

/** The host kit, once the guard has proved both halves usable. */
interface HostKit {
  /** The host's React instance. */
  React: ReactLike
  /** The host's ui kit. */
  ui: UiLike
}

/** The host's measured geometry, with the documented fallbacks applied. */
interface Measured {
  /** The `<columns>x<rows>` label, empty when the host cannot measure. */
  size: string
  /** The column count the DAG lays itself out for. */
  cols: number
}

/** A no-op store subscription, so the hook order stays stable without a channel. */
function noopSubscribe(): () => void {
  return () => {}
}

/**
 * One external value as a renderable row fragment — THE render boundary of this file.
 *
 * `stripControl` + `clampCells` (never `scalarText`) for the same reason `scenes.ts` chooses it:
 * collapsing whitespace would eat the team body's indentation. A non-scalar is DROPPED rather than
 * stringified, so a hostile payload can never reach `ui.Text` as `[object Object]`.
 * @param value - the candidate, of unknown shape.
 * @returns the sanitized, clamped text; empty for a nullish or non-scalar value.
 */
function safeRow(value: unknown): string {
  /** The candidate's runtime type, the only narrowing this boundary trusts. */
  const type = typeof value
  if (type !== "string" && type !== "number" && type !== "boolean") return ""
  if (type === "number" && !Number.isFinite(value as number)) return ""
  /** The candidate as text: a string as-is, any other scalar through `String`. */
  const raw = type === "string" ? (value as string) : String(value)
  return clampCells(stripControl(raw), MERGED_ROW_MAX_CELLS)
}

/**
 * An epoch-millisecond instant as ISO-8601 UTC.
 * @param value - the candidate field; only a finite number inside the ECMAScript time range is used.
 * @returns the ISO instant, or undefined when the host reported no usable one.
 */
function isoInstant(value: unknown): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined
  // ±8.64e15 ms is the exact ECMAScript time-value range: outside it `toISOString()` throws, and a
  // range check keeps that throw out of the render path entirely.
  if (Math.abs(value) > 8.64e15) return undefined
  return new Date(value).toISOString()
}

/**
 * Prove the host handed a usable React instance and ui kit.
 * @param React - the props' React field.
 * @param ui - the props' ui field.
 * @returns the two, typed, or undefined when the host kit is unusable.
 */
function hostKit(React: unknown, ui: unknown): HostKit | undefined {
  if (React === null || React === undefined || ui === null || ui === undefined) return undefined
  if (typeof (React as { createElement?: unknown }).createElement !== "function") return undefined
  /** The ui kit's own two required components, before anything is drawn with it. */
  const kit = ui as { Box?: unknown; Text?: unknown }
  if (typeof kit.Box !== "function" || typeof kit.Text !== "function") return undefined
  // These two casts are the only narrowing available: the host hands its own React and ui kit
  // across a JS boundary with no shared type. Every ADDITIONAL field read off them (`useInput`,
  // `useTerminalSize`, `useSyncExternalStore`) is feature-detected at its own use site, so an older
  // or leaner host build degrades instead of throwing.
  return { React: React as ReactLike, ui: ui as UiLike }
}

/**
 * Measure the host's terminal through its own hook — ONCE per render, so the hook order never moves.
 * @param ui - the host ui kit.
 * @returns the size label and the column count, each with a documented fallback.
 */
function measureTerminal(ui: UiLike): Measured {
  if (typeof ui.useTerminalSize !== "function") return { size: "", cols: FALLBACK_COLS }
  /** The measured column count, `?` until the host hook answers. */
  let columns: unknown = "?"
  /** The measured row count, `?` until the host hook answers. */
  let rows: unknown = "?"
  /** The host hook's own measurement object, when it returned one. */
  const measured = ui.useTerminalSize()
  if (measured !== null && measured !== undefined) {
    columns = measured.columns ?? "?"
    rows = measured.rows ?? "?"
  }
  /** The column count as a number; NaN when the host measured none. */
  const cols = Number(columns)
  return {
    size: `${String(columns)}x${String(rows)}`,
    cols: Number.isFinite(cols) && cols > 20 ? cols : FALLBACK_COLS,
  }
}

/**
 * Project ONE host subagent entry into a row view.
 * @param entry - one element of `channel.subagents`, of unknown shape.
 * @returns the row view, or undefined when the entry is not an object at all.
 */
export function subagentRowView(entry: unknown): SubagentRowView | undefined {
  if (entry === null || typeof entry !== "object") return undefined
  /** The entry as a record; every field stays `unknown` and is narrowed below. */
  const row = entry as Record<string, unknown>
  /** The status, kept only when it is one of the host's own six. */
  const status = typeof row.status === "string" && KNOWN_STATUSES.includes(row.status) ? row.status : "unknown"
  /** The durable mode, kept only when it is one of the host's own three. */
  const mode = typeof row.mode === "string" && KNOWN_MODES.includes(row.mode) ? row.mode : "unknown"
  /** The agent id, kept only when it is a usable non-empty string (it is an interrupt target). */
  const agentId = typeof row.agentId === "string" && row.agentId !== "" ? row.agentId : undefined
  /** The start instant, or undefined when the host reported none. */
  const startedAt = isoInstant(row.startedAt)
  // `endedAt` is the host's settled end; `completedAt` is the older projection of the same fact.
  /** The end instant, or undefined for a row the host has not ended. */
  const endedAt = isoInstant(row.endedAt ?? row.completedAt)
  return {
    ...(agentId === undefined ? {} : { agentId }),
    description: safeRow(row.description) || "(no description)",
    mode,
    status,
    ...(startedAt === undefined ? {} : { startedAt }),
    ...(endedAt === undefined ? {} : { endedAt }),
    live: status === "running" || status === "starting",
    failed: status === "failed" || status === "cancelled",
  }
}

/**
 * The host's own subagent rows for this render.
 * @param channel - the scene's channel (`props.channel`), of unknown shape.
 * @returns one view per readable row, in the host's own order; [] when the field is absent,
 *   hostile or not an array — this function never throws and never re-orders.
 */
export function subagentRows(channel: unknown): SubagentRowView[] {
  try {
    /** The host's own array, when this composition projects one at all. */
    const raw = (channel as { subagents?: unknown } | undefined)?.subagents
    if (!Array.isArray(raw)) return []
    // NO CAP: the host's own dashboard maps its whole array through a ScrollBox, so capping here
    // would make this panel show less than the screen it mirrors — and a silently dropped row
    // would make every count below it a lie.
    /** The projected rows, in the host's own order. */
    const rows: SubagentRowView[] = []
    for (const entry of raw) {
      /** This entry's projection, skipped when it is not a readable object. */
      const view = subagentRowView(entry)
      if (view !== undefined) rows.push(view)
    }
    return rows
  } catch {
    // A hostile channel (a throwing getter, a proxy) degrades to "no rows" rather than to a crash.
    return []
  }
}

/**
 * The glyph the host's own card draws for one row.
 * @param row - the projected row.
 * @returns the host's glyph for that state.
 */
export function glyphOf(row: SubagentRowView): string {
  if (row.live) return SUBAGENT_GLYPHS.live
  if (row.failed) return SUBAGENT_GLYPHS.failed
  if (row.status === "unknown") return SUBAGENT_GLYPHS.unknown
  return SUBAGENT_GLYPHS.completed
}

/**
 * One subagent row, in the order this surface promises: description, mode, status, instant.
 * @param row - the projected row.
 * @returns the sanitized row line.
 */
export function subagentRowLine(row: SubagentRowView): string {
  /** The row's fields, in render order. */
  const parts: string[] = [row.description, row.mode, row.status]
  if (row.startedAt !== undefined) parts.push(`started ${row.startedAt}`)
  if (row.endedAt !== undefined) parts.push(`ended ${row.endedAt}`)
  return safeRow(`${glyphOf(row)} ${parts.join(" · ")}`)
}

/**
 * The subagent section: its header, then the host's rows — or the host's own empty state.
 *
 * The empty-state wording is the host's own English text (`SubagentDashboard` renders the i18n keys
 * `subagent-none` and `subagent-empty-hint` under its dim `○`). A plugin scene receives only the ui
 * kit, and the host's i18n module is NOT part of the scene props contract, so the strings are
 * carried here instead of being unreachable.
 * @param channel - the scene's channel.
 * @returns the section's rows in render order; the header is always present.
 */
export function subagentSectionRows(channel: unknown): SubagentSectionRow[] {
  /** The projected rows. */
  const rows = subagentRows(channel)
  /** The tallies the host's own dashboard header shows: one counter per state it names. */
  let live = 0
  /** Rows the host reports as completed. */
  let completed = 0
  /** Rows the host reports as failed or cancelled. */
  let failed = 0
  for (const row of rows) {
    if (row.live) live += 1
    if (row.status === "completed") completed += 1
    if (row.failed) failed += 1
  }
  /** The section's rows, in render order. */
  const section: SubagentSectionRow[] = [
    { text: `subagents  ${rows.length} total · ${live} running · ${completed} completed · ${failed} failed`, header: true },
  ]
  if (rows.length === 0) {
    section.push({ text: `${SUBAGENT_GLYPHS.unknown} No subagents in the current session`, dim: true })
    section.push({ text: "  Subagents appear here once the main agent starts Task delegations", dim: true })
    return section
  }
  for (let index = 0; index < rows.length; index += 1) section.push({ text: subagentRowLine(rows[index]), rowIndex: index })
  return section
}

/**
 * The team's tasks in the DAG's own vocabulary, mapped exactly as the team scene maps them.
 * @param workflow - the team projection.
 * @returns one `GraphTask` per task row.
 */
function graphTasksOf(workflow: TeamWorkflow): GraphTask[] {
  return workflow.tasks.map((task) => ({
    id: task.id,
    subject: task.subject,
    ...(task.kind === undefined ? {} : { kind: task.kind }),
    visual: task.visual,
    ...(task.assignee === undefined ? {} : { assignee: task.assignee }),
    dependencies: task.dependencies,
    depth: task.depth,
    ...(task.attempt === undefined ? {} : { attempt: task.attempt }),
  }))
}

/**
 * The DAG box for one render.
 * @param workflow - the team projection, when it is readable.
 * @param cols - the measured terminal width.
 * @returns the laid-out graph, or undefined when there is no team or no task to draw.
 */
export function teamGraphView(workflow: TeamWorkflow | undefined, cols: number): GraphView | undefined {
  if (workflow === undefined || workflow.tasks.length === 0) return undefined
  try {
    return layoutGraph(graphTasksOf(workflow), cols)
  } catch {
    // A pathological record must cost the DAG, not the surface.
    return undefined
  }
}

/**
 * Interrupt one subagent through the host's own control seam, when this composition exposes one.
 *
 * The host calls `channel.subagentControl.interrupt` unguarded (Chat.js does it for its detail
 * scene) because the field is part of its own contract. A plugin scene must not: the field is
 * DECLARED on the channel but a provider without native control answers false, and a scene that
 * assumed it would lose the surface to a TypeError. Hence the feature detection before every call.
 * @param channel - the scene's channel.
 * @param agentId - the target agent id, already narrowed to a non-empty string.
 * @returns true only when the host answered true; false for every refusal or failure.
 */
export function interruptSubagent(channel: unknown, agentId: string): boolean {
  try {
    /** The host's native control facade, when this composition projects one. */
    const control = (channel as { subagentControl?: { interrupt?: unknown } } | undefined)?.subagentControl
    if (control === null || control === undefined || typeof control.interrupt !== "function") return false
    // Called AS A METHOD on the host's own object: a detached function would lose the receiver its
    // implementation may rely on. The cast is sound because the `typeof` check above proved it.
    return (control as { interrupt: (id: string) => unknown }).interrupt(agentId) === true
  } catch {
    return false
  }
}

/**
 * Build the merged scene component.
 * @param readWorkflow - reads the MPD team projection for this session's workspace; the wiring in
 *   `scenes.ts` passes the same reader the team scene uses, so the two cannot drift. It is injected
 *   (rather than imported) so this file stays free of the scene-registration module.
 * @returns a component matching the host's `TuiSceneProps` contract.
 */
export function createSubagentSceneComponent(readWorkflow: () => TeamWorkflow | undefined): unknown {
  // The props type is the ADAPTER's `TuiScenePropsLike` — the TUI plane's single declaration of the
  // host's scene contract — even though every field is still re-checked at runtime below: the type
  // says what a well-formed host passes, and a scene must survive a host that does not.
  return function MpdTuiSubagents(props: TuiScenePropsLike): unknown {
    /** The host's React instance and ui kit, proved usable before a single hook is called. */
    const kit = hostKit(props?.React, props?.ui)
    if (kit === undefined) {
      // The host kit is the hard contract; without it, render nothing rather than crash the
      // reconciler. (No hook has run at this point, so the hook order is never at risk.)
      return null
    }
    /** The host's React instance. */
    const React = kit.React
    /** The host's ui kit. */
    const ui = kit.ui
    /** Leaves the scene; a host without the callback gets a no-op, so a key never throws. */
    const close = typeof props.close === "function" ? props.close : () => {}
    /** The live session channel — the SAME object the host's own dashboard renders from. */
    const channel = props?.channel

    /** The team projection this render draws; undefined before the first read. */
    const workflowState = React.useState(undefined as TeamWorkflow | undefined)
    /** The team projection this render draws. */
    const workflow = workflowState[0] as TeamWorkflow | undefined
    /** Publishes a freshly read projection. */
    const setWorkflow = workflowState[1]
    /** The selection index the `i` key targets. */
    const focusState = React.useState(0)
    /** The selection index the `i` key targets. */
    const focus = focusState[0] as number
    /** Moves the selection; every write is clamped to the drawn range. */
    const setFocus = focusState[1]
    /** The last action's outcome line. */
    const noticeState = React.useState("")
    /** The last action's outcome line, empty when there is nothing to report. */
    const notice = noticeState[0] as string
    /** Publishes an action outcome. */
    const setNotice = noticeState[1]

    /** Re-read the team projection; the render path itself stays free of I/O. */
    const refresh = (): void => {
      /** The freshly read projection; undefined means unreadable. */
      let next: TeamWorkflow | undefined
      try {
        next = readWorkflow()
      } catch {
        next = undefined
      }
      setWorkflow(next)
    }

    React.useEffect(() => {
      refresh()
      /** The refresh timer, absent when the host refused to schedule one. */
      let timer: ReturnType<typeof setInterval> | undefined
      try {
        timer = setInterval(() => refresh(), REFRESH_MS)
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

    // The channel subscription — the SAME two stable fallbacks `scenes.ts` installs, so the hook is
    // always called and the rows are re-read whenever the host bumps its version (a subagent
    // spawning, settling or being discovered arrives through this subscription, not through a timer).
    /** Subscribes to the channel's changes, or a no-op when there is no channel. */
    const subscribe =
      typeof (channel as { subscribe?: unknown } | undefined)?.subscribe === "function"
        ? (listener: () => void): (() => void) => (channel as { subscribe: (l: () => void) => () => void }).subscribe(listener)
        : noopSubscribe
    /** Reads the channel's version so any channel change re-renders; 0 without one. */
    const getSnapshot =
      typeof (channel as { version?: unknown } | undefined)?.version === "number"
        ? (): number => (channel as { version: number }).version
        : (): number => 0
    if (typeof React.useSyncExternalStore === "function") {
      try {
        React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
      } catch {
        // The scene still renders: the subscription is the refresh path, not the data source.
      }
    }

    /** The host's measured geometry, through its own hook (unconditional, once per render). */
    const measured = measureTerminal(ui)
    /** The host's own rows for this render. */
    const rows = subagentRows(channel)
    /** The selected row's index, clamped into the drawn range; -1 when there is no row. */
    const selectedIndex = rows.length === 0 ? -1 : Math.min(Math.max(focus, 0), rows.length - 1)
    /** The selected row, when there is one. */
    const selected = selectedIndex === -1 ? undefined : rows[selectedIndex]

    if (typeof ui.useInput === "function") {
      ui.useInput((input: string, key: SceneKey | undefined) => {
        if (key?.escape === true || input === "q") {
          close()
          return
        }
        if (key?.upArrow === true) {
          setFocus(Math.max(0, selectedIndex - 1))
          return
        }
        if (key?.downArrow === true) {
          setFocus(Math.max(0, Math.min(selectedIndex, rows.length - 1) + 1))
          return
        }
        if (input === "r" && key?.ctrl !== true) {
          refresh()
          return
        }
        if (input === "i" && key?.ctrl !== true) {
          if (selected === undefined || selected.agentId === undefined) {
            setNotice("interrupt: no subagent row is selected")
            return
          }
          if (!selected.live) {
            setNotice(`interrupt: ${selected.description} is ${selected.status}, not running`)
            return
          }
          setNotice(
            interruptSubagent(channel, selected.agentId)
              ? `interrupt requested for ${selected.description}`
              : "interrupt: this composition exposes no subagent control",
          )
        }
      })
    }

    /** The elements handed to the host's Box, in render order. */
    const children: unknown[] = []
    children.push(
      React.createElement(
        ui.Text,
        { key: "title", bold: true },
        safeRow(`${SUBAGENT_SCENE_TITLE}${measured.size === "" ? "" : ` · ${measured.size}`}`),
      ),
    )
    // (a) THE HOST'S OWN SUBAGENT ROWS — the top section, and the reason this scene exists.
    /** The subagent section, decided in one place. */
    const section = subagentSectionRows(channel)
    for (let index = 0; index < section.length; index += 1) {
      /** This row's own draw instructions. */
      const row = section[index]
      children.push(
        React.createElement(
          ui.Text,
          {
            key: `sub-${index}`,
            ...(row.header === true ? { bold: true } : {}),
            ...(row.dim === true ? { dimColor: true } : {}),
            ...(row.rowIndex !== undefined && row.rowIndex === selectedIndex ? { bold: true } : {}),
          },
          safeRow(row.text),
        ),
      )
    }
    // (b) THE MPD TEAM PANEL BELOW IT — the SAME row builder and the SAME projection the team scene
    // uses, so the two surfaces cannot describe the team differently.
    children.push(React.createElement(ui.Text, { key: "sep" }, safeRow("")))
    /** The team body's rows, or the team scene's own unreadable line. */
    let teamLines: string[]
    try {
      teamLines = workflow === undefined ? ["team state unreadable"] : teamWorkflowLines(workflow)
    } catch {
      teamLines = ["team state unreadable"]
    }
    for (let index = 0; index < teamLines.length; index += 1) {
      children.push(React.createElement(ui.Text, { key: `team-${index}` }, safeRow(teamLines[index])))
    }
    /** The DAG box, absent when the team has no task to draw. */
    const view = teamGraphView(workflow, measured.cols)
    if (view !== undefined) {
      children.push(React.createElement(ui.Text, { key: "graphhead", dimColor: true }, safeRow(`task dependency graph${view.mode === "rail" ? " (rail)" : ""}`)))
      for (let index = 0; index < view.lines.length; index += 1) {
        // The spans go through WITHOUT `safeRow`, exactly as the team scene draws them: `graph.ts`
        // already applies `clampCells(stripControl(...))` at layout time, and re-clamping here would
        // cut the row's own multi-span geometry twice.
        /** The spans of this row, each drawn in its own theme colour. */
        const spans = view.lines[index].map((span, at) => React.createElement(ui.Text, { key: `s${at}`, color: GRAPH_THEME[span.tone] }, span.text))
        children.push(React.createElement(ui.Text, { key: `graph-${index}` }, ...spans))
      }
    }
    if (notice !== "") children.push(React.createElement(ui.Text, { key: "notice", color: "yellow" }, safeRow(notice)))
    // (c) The footer hint: what this surface answers to, and which MPD key opens the neighbours.
    children.push(
      React.createElement(
        ui.Text,
        { key: "footer", dimColor: true },
        safeRow("esc/q close · ↑↓ select · i interrupt the selected run · r refresh · alt+a this panel · alt+t team · alt+m board"),
      ),
    )
    return React.createElement(ui.Box, { flexDirection: "column", width: "100%", flexGrow: 1, paddingX: 1 }, children)
  }
}
