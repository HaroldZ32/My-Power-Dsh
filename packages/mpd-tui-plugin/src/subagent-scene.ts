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
//       subagents, so the host's own array already holds them. Each row is a `Box`, which is what
//       makes it clickable — a click selects exactly the row `↑`/`↓` would have selected;
//   (b) the host's own COUNTS for those rows (running / completed / failed), drawn in the host's
//       own glyph vocabulary: when this panel opens instead of the dashboard, the summary the user
//       could see there must not disappear;
//   (c) the MPD team panel BELOW it, from the same `teamWorkflowLines` projection the team scene
//       renders (team-state.ts), plus the DAG box `graph.ts` draws for that scene and the
//       `legendLines(width)` legend that explains its marks — drawn in the width the DAG was laid
//       out for;
//   (d) a footer hint line.
//
// TWO MODES. The list above, and a DETAIL view for one selected row (`enter` opens it; esc,
// backspace and q step back to the list). The detail is a MODE, so esc must not close the scene
// while it owns the body — the same grammar the host's own dashboard/detail pair uses. It draws
// only what the channel actually reported for that entry (description, status, mode, model,
// provider, the two instants as ISO-8601 UTC, the token buckets it filled, the tool calls it
// recorded, and the tail of its output), and an entry that left the channel degrades to a notice
// on the list rather than to a throw.
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
import { GRAPH_THEME, layoutGraph, legendLines, type GraphTask, type GraphView } from "./graph.js"
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

/** How many output lines the detail view shows at once; `↑`/`↓` walk the rest. */
const DETAIL_TAIL_LINES = 12

/** The label column of the detail body, so every value starts at the same cell. */
const DETAIL_LABEL_WIDTH = 12

/** How many tool names the detail's tool row lists before it counts the remainder. */
const DETAIL_TOOL_NAMES = 8

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
  /** Esc — closes the scene from the list, and steps back from the detail. */
  escape?: boolean
  /** Up arrow — moves the selection, or walks the detail's output back in time. */
  upArrow?: boolean
  /** Down arrow — moves the selection, or walks the detail's output towards the newest line. */
  downArrow?: boolean
  /** Return/Enter — opens the detail view for the selected row. */
  return?: boolean
  /** Backspace — the detail's second "back" key, beside esc and q. */
  backspace?: boolean
  /** Ctrl, read only to keep a plain `i`/`r` distinguishable from a modified one. */
  ctrl?: boolean
  /** Meta/Alt, read by the bare-Enter test: a modified Enter must not open a mode by accident. */
  meta?: boolean
  /** Shift, read by the bare-Enter test for the same reason as `meta`. */
  shift?: boolean
  /** Super/Cmd, which extended-key terminals deliver and the host's own guard treats like ctrl. */
  super?: boolean
  /** True when this event is a bracketed PASTE: pasted line breaks are content, never a key press. */
  isPasted?: boolean
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
 * True when one key event is a BARE Enter press — the gesture that opens the detail view.
 *
 * This mirrors the HOST's own `isPlainReturnInput` (`utils/modifiers.js`) clause for clause, because
 * the mode it opens is a substitute for the host's dashboard/detail pair: a bracketed PASTE is
 * rejected FIRST (a paste chunk may be nothing but line breaks, and may even carry the return flag),
 * and both remaining spellings are accepted only while NO modifier is held — ctrl, meta, shift or
 * super. The flag spelling covers parsed key events; the raw one covers Windows ConPTY, whose CR/LF
 * fallback arrives as a chunk of line breaks with no `return` flag at all. `super` is Cmd on macOS,
 * delivered by kitty CSI-u and xterm modifyOtherKeys, so guarding it is what keeps Cmd+Enter inert
 * here exactly as it is on the host's own dashboard.
 * @param input - the printable input the host reported.
 * @param key - the flags the host reported, when it reported any.
 * @returns true for a modifier-free return key.
 */
function isReturn(input: string, key: SceneKey | undefined): boolean {
  if (key?.isPasted === true) return false
  /** True when any modifier is held — the host refuses every one of them for a bare Enter. */
  const modified = key?.ctrl === true || key?.meta === true || key?.shift === true || key?.super === true
  if (modified) return false
  return key?.return === true || /^[\r\n]+$/u.test(input)
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

/** One projected row together with the raw host entry it came from. */
export interface SubagentRowEntry {
  /** The row the list draws. */
  view: SubagentRowView
  /** The raw element of `channel.subagents`, kept so the detail view re-reads the SAME entry. */
  entry: unknown
}

/**
 * The host's own subagent rows for this render, each paired with its raw entry.
 *
 * This is the ONE reader of `channel.subagents`: {@link subagentRows} derives the drawn rows from it
 * and the detail view re-reads the entry it was opened on, so the list, the counts and the detail are
 * three views of one projection and cannot disagree about a subagent.
 * @param channel - the scene's channel (`props.channel`), of unknown shape.
 * @returns one pair per readable row, in the host's own order; [] when the field is absent, hostile
 *   or not an array — this function never throws and never re-orders.
 */
export function subagentRowEntries(channel: unknown): SubagentRowEntry[] {
  try {
    /** The host's own array, when this composition projects one at all. */
    const raw = (channel as { subagents?: unknown } | undefined)?.subagents
    if (!Array.isArray(raw)) return []
    // NO CAP: the host's own dashboard maps its whole array through a ScrollBox, so capping here
    // would make this panel show less than the screen it mirrors — and a silently dropped row
    // would make every count below it a lie.
    /** The projected pairs, in the host's own order. */
    const pairs: SubagentRowEntry[] = []
    for (const entry of raw) {
      /** This entry's projection, skipped when it is not a readable object. */
      const view = subagentRowView(entry)
      if (view !== undefined) pairs.push({ view, entry })
    }
    return pairs
  } catch {
    // A hostile channel (a throwing getter, a proxy) degrades to "no rows" rather than to a crash.
    return []
  }
}

/**
 * The host's own subagent rows for this render.
 * @param channel - the scene's channel (`props.channel`), of unknown shape.
 * @returns one view per readable row, in the host's own order; [] when the field is absent,
 *   hostile or not an array — this function never throws and never re-orders.
 */
export function subagentRows(channel: unknown): SubagentRowView[] {
  return subagentRowEntries(channel).map((pair) => pair.view)
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

/** One drawn row of the detail body: the text plus the emphasis it carries. */
export interface SubagentDetailRow {
  /** The row text, already sanitized at this boundary. */
  text: string
  /** True for the description title, which the scene draws bold. */
  title?: boolean
  /** True for a row the scene draws dimmed (the output paging hint). */
  dim?: boolean
}

/**
 * One subagent's REPORTED facts, as the detail view draws them.
 *
 * Every field below exists only because the host reported it: an absent instant, token bucket or
 * tool list stays `undefined` and the detail then draws NO row for it, rather than a zero or a
 * "—" that would read as a measurement. The list's own projection is NESTED here instead of being
 * re-derived, so the row the user selected and the row the detail describes are one projection.
 */
export interface SubagentDetailFacts {
  /** The list's own projection of this entry. */
  row: SubagentRowView
  /** The provider the host reported, sanitized; absent when it reported none. */
  provider?: string
  /** The model the host reported, sanitized; absent when it reported none. */
  model?: string
  /** The token counters the host reported — each present ONLY when it reported that number. */
  tokens: { input?: number; output?: number; total?: number }
  /** How many tool calls the host reported; absent when it reported no `toolCalls` array at all. */
  toolCallCount?: number
  /** The sanitized tool names, in the host's own order; a call with no readable name is not listed. */
  toolNames: string[]
  /** The sanitized output lines, oldest first; absent when the host reported no output array. */
  outputLines?: string[]
}

/**
 * One reported counter as an integer.
 * @param value - the candidate field.
 * @returns the counter, or undefined when the host reported no usable number (a negative, infinite
 *   or non-numeric value is refused rather than clamped into a measurement it never made).
 */
function counterOf(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return undefined
  return Math.floor(value)
}

/**
 * Project ONE host subagent entry into the facts the detail view may draw.
 *
 * The detail is the list's projection PLUS the fields only the detail shows, read off the same raw
 * entry the channel handed this render — so a field that settled since the list was drawn is drawn
 * settled here. Nothing is derived from anything the host did not report: no duration is computed
 * from the two instants, and a token bucket the host omitted is absent rather than zero.
 * @param entry - one element of `channel.subagents`, of unknown shape.
 * @returns the facts, or undefined when the entry is not a readable object (there is nothing to show).
 */
export function subagentDetailFacts(entry: unknown): SubagentDetailFacts | undefined {
  /** The list's own projection; undefined means the entry is not a readable object at all. */
  const row = subagentRowView(entry)
  if (row === undefined) return undefined
  /** The entry as a record; every extra field stays `unknown` and is narrowed below. */
  const raw = entry as Record<string, unknown>
  /** The provider, kept only when the host reported a readable scalar. */
  const provider = safeRow(raw.provider)
  /** The model, kept only when the host reported a readable scalar. */
  const model = safeRow(raw.model)
  /** The token object the host reported, when it reported one at all. */
  const usage = raw.tokens !== null && typeof raw.tokens === "object" ? (raw.tokens as Record<string, unknown>) : undefined
  /** The reported input-token count, or undefined when the host reported none. */
  const inputTokens = counterOf(usage?.input)
  /** The reported output-token count, or undefined when the host reported none. */
  const outputTokens = counterOf(usage?.output)
  /** The reported total-token count, or undefined when the host reported none. */
  const totalTokens = counterOf(usage?.total)
  /** The tool calls the host reported, when it reported the array at all. */
  const calls = Array.isArray(raw.toolCalls) ? raw.toolCalls : undefined
  /** The output entries the host reported: the richer event list first, the compat list after it. */
  const output = Array.isArray(raw.outputEvents) ? raw.outputEvents : Array.isArray(raw.output) ? raw.output : undefined
  /** The sanitized tool names, in the host's own order. */
  const toolNames: string[] = []
  if (calls !== undefined) {
    for (const call of calls) {
      if (call === null || typeof call !== "object") continue
      /** This call's reported name; empty when it reported none, and then it is not listed. */
      const name = safeRow((call as Record<string, unknown>).name)
      if (name !== "") toolNames.push(name)
    }
  }
  /** The sanitized output lines, or undefined when the host reported no output array. */
  let outputLines: string[] | undefined
  if (output !== undefined) {
    outputLines = []
    for (const line of output) {
      // An event line carries its text under `text`; the compat list carries the line itself.
      /** This line's reportable text; dropped when the host reported no readable scalar for it. */
      const text = line !== null && typeof line === "object" ? safeRow((line as Record<string, unknown>).text) : safeRow(line)
      if (text !== "") outputLines.push(text)
    }
  }
  return {
    row,
    ...(provider === "" ? {} : { provider }),
    ...(model === "" ? {} : { model }),
    tokens: {
      ...(inputTokens === undefined ? {} : { input: inputTokens }),
      ...(outputTokens === undefined ? {} : { output: outputTokens }),
      ...(totalTokens === undefined ? {} : { total: totalTokens }),
    },
    ...(calls === undefined ? {} : { toolCallCount: calls.length }),
    toolNames,
    ...(outputLines === undefined ? {} : { outputLines }),
  }
}

/**
 * The detail body for one subagent: every fact the host reported, then the tail of its output.
 *
 * The output is the BRITTLE part of a detail view: it grows without bound while the run is live, so
 * only a window of it is drawn and `scroll` walks that window back from the newest line. A line the
 * host never wrote is never synthesized — an omitted field has no row at all.
 * @param facts - the projection {@link subagentDetailFacts} built from the selected entry.
 * @param scroll - output lines scrolled UP from the newest; 0 shows the newest tail.
 * @returns the rows in draw order, each already sanitized through `safeRow`.
 */
export function subagentDetailRows(facts: SubagentDetailFacts, scroll: number): SubagentDetailRow[] {
  /** The detail body, in draw order; its title is the row's own sanitized description. */
  const rows: SubagentDetailRow[] = [{ text: facts.row.description, title: true }]
  /** One label/value row, aligned on the label column and sanitized at this boundary. */
  const pair = (label: string, value: string): SubagentDetailRow => ({ text: safeRow(`${label.padEnd(DETAIL_LABEL_WIDTH)}${value}`) })
  rows.push(pair("status", facts.row.status))
  rows.push(pair("mode", facts.row.mode))
  if (facts.model !== undefined) rows.push(pair("model", facts.model))
  if (facts.provider !== undefined) rows.push(pair("provider", facts.provider))
  if (facts.row.startedAt !== undefined) rows.push(pair("started", facts.row.startedAt))
  if (facts.row.endedAt !== undefined) rows.push(pair("ended", facts.row.endedAt))
  /** The token counters the host reported, each named by the host's own bucket name. */
  const tokenParts: string[] = []
  if (facts.tokens.input !== undefined) tokenParts.push(`in ${facts.tokens.input}`)
  if (facts.tokens.output !== undefined) tokenParts.push(`out ${facts.tokens.output}`)
  if (facts.tokens.total !== undefined) tokenParts.push(`total ${facts.tokens.total}`)
  if (tokenParts.length > 0) rows.push(pair("tokens", tokenParts.join(" · ")))
  if (facts.toolCallCount !== undefined) {
    /** The names drawn after the count, capped so one busy run cannot fill the screen. */
    const shown = facts.toolNames.slice(0, DETAIL_TOOL_NAMES)
    /** The names the cap left out; 0 adds nothing to the row. */
    const hidden = facts.toolNames.length - shown.length
    rows.push(pair("tool calls", `${facts.toolCallCount}${shown.length === 0 ? "" : ` · ${shown.join(", ")}${hidden > 0 ? `, +${hidden} more` : ""}`}`))
  }
  if (facts.outputLines !== undefined) {
    /** The reported lines, oldest first. */
    const lines = facts.outputLines
    rows.push(pair("output", `${lines.length} line(s)`))
    /** The requested offset, refused when it is not a finite number. */
    const wanted = Number.isFinite(scroll) ? Math.floor(scroll) : 0
    /** The offset actually applied, clamped to the lines a window can hide. */
    const at = Math.max(0, Math.min(wanted, Math.max(0, lines.length - DETAIL_TAIL_LINES)))
    /** The newest line index the window stops BEFORE. */
    const end = lines.length - at
    /** The oldest line index the window starts at. */
    const start = Math.max(0, end - DETAIL_TAIL_LINES)
    if (lines.length > DETAIL_TAIL_LINES) {
      rows.push({ text: safeRow(`showing ${start + 1}-${end} of ${lines.length} · ↑↓ scroll`), dim: true })
    }
    for (let index = start; index < end; index += 1) rows.push({ text: safeRow(`  ${lines[index]}`) })
  }
  return rows
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
  // THE COUNTS ROW the host's own dashboard carries on top, in THIS file's row vocabulary: the same
  // three tallies the header names above, drawn with the same glyphs the rows below use. It exists
  // because Ctrl+A may open this panel INSTEAD of that dashboard (dashboard-key.ts), and a summary
  // the user could see before must not disappear. The buckets are the host's own states — `live` is
  // the host's running/starting, `completed` its completed, `failed` its failed/cancelled — so a
  // status this file does not recognize lands in NONE of them (it is drawn as `unknown` below and
  // never folded into a completion the host never reported). It is drawn only when a row exists:
  // with an empty list the header's own zeroes are the whole truth.
  section.push({
    text: `${SUBAGENT_GLYPHS.live} ${live} running · ${SUBAGENT_GLYPHS.completed} ${completed} completed · ${SUBAGENT_GLYPHS.failed} ${failed} failed`,
    dim: true,
  })
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
 * @param onHostKit - receives the host's own `ui` kit on every render; the adapter keeps it because a
 *   SCENE is the only surface the host hands that object to, and its `useStdin` is the one that
 *   resolves the LIVE input context (measured, dsh-tui 0.12.0). Optional: the panel still renders
 *   without it, and a caller that omits it simply reports nothing.
 * @returns a component matching the host's `TuiSceneProps` contract.
 */
export function createSubagentSceneComponent(readWorkflow: () => TeamWorkflow | undefined, onHostKit?: (ui: unknown) => unknown): unknown {
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
    // The live host kit, reported per render: this panel is the surface most likely to be open in a
    // session that uses the dependency view, and its kit is what arms the Ctrl+A take-over. Placed
    // after the kit check and BEFORE the first read, so a reporting failure can never be mistaken
    // for an unusable host.
    onHostKit?.(props?.ui)
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
    /** The agent id the DETAIL view is open on; undefined means the list owns the scene body. */
    const detailState = React.useState(undefined as string | undefined)
    /** The agent id the DETAIL view is open on. */
    const detailAgentId = detailState[0] as string | undefined
    /** Opens the detail on an agent id, or returns to the list with `undefined`. */
    const setDetailAgentId = detailState[1]
    /** How many output lines the detail is scrolled BACK from the newest line. */
    const detailScrollState = React.useState(0)
    /** How many output lines the detail is scrolled back from the newest line. */
    const detailScroll = detailScrollState[0] as number
    /** Moves the detail's output window. */
    const setDetailScroll = detailScrollState[1] as (next: number) => void

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
    /** The host's own rows for this render, each with the raw entry the detail re-reads. */
    const pairs = subagentRowEntries(channel)
    /** The drawn row views, in the host's own order. */
    const rows = pairs.map((pair) => pair.view)
    /** The selected row's index, clamped into the drawn range; -1 when there is no row. */
    const selectedIndex = rows.length === 0 ? -1 : Math.min(Math.max(focus, 0), rows.length - 1)
    /** The selected row, when there is one. */
    const selected = selectedIndex === -1 ? undefined : rows[selectedIndex]
    // The detail is keyed by the host's own AGENT ID, never by a row index: a child that settles, or
    // a new one that appears above it, renumbers the rows without changing which run the user opened.
    /** The index of the row the DETAIL view re-read, or -1 when this render does not carry it. */
    const detailAt = detailAgentId === undefined ? -1 : pairs.findIndex((pair) => pair.view.agentId === detailAgentId)
    /** True while the detail owns the scene body. */
    const detailOpen = detailAt >= 0
    /** The detail's own row — the interrupt target while the detail is open. */
    const detailRow = detailOpen ? rows[detailAt] : undefined
    /** The detail's facts, re-read from the entry THIS render carries. */
    const detailFacts = detailOpen ? subagentDetailFacts(pairs[detailAt].entry) : undefined
    /** The output lines the detail could page through. */
    const detailLines = detailFacts?.outputLines?.length ?? 0
    /** The largest offset this render can page back from the newest line. */
    const detailMaxScroll = Math.max(0, detailLines - DETAIL_TAIL_LINES)
    /** True when the detail was open on an entry the channel no longer carries. */
    const detailGone = detailAgentId !== undefined && !detailOpen
    // A VANISHED DETAIL IS A NOTICE, NOT A THROW, and not a state write during the render either:
    // the list is drawn this pass, the line below says why, and the next key answers as a list key.
    /** The outcome line this render shows. */
    const noticeLine = detailGone ? "details: that subagent is no longer in the channel" : notice

    /** Interrupt one row through the host's control seam and publish the outcome. */
    const interrupt = (row: SubagentRowView | undefined): void => {
      if (row === undefined || row.agentId === undefined) {
        setNotice("interrupt: no subagent row is selected")
        return
      }
      if (!row.live) {
        setNotice(`interrupt: ${row.description} is ${row.status}, not running`)
        return
      }
      setNotice(
        interruptSubagent(channel, row.agentId)
          ? `interrupt requested for ${row.description}`
          : "interrupt: this composition exposes no subagent control",
      )
    }

    /** Open the detail on the selected row; a row with no agent id cannot be re-read, and says so. */
    const openDetail = (): void => {
      if (selected === undefined) {
        setNotice("details: no subagent row is selected")
        return
      }
      if (selected.agentId === undefined) {
        setNotice("details: this row carries no agent id to re-read")
        return
      }
      setNotice("")
      setDetailScroll(0)
      setDetailAgentId(selected.agentId)
    }

    if (typeof ui.useInput === "function") {
      ui.useInput((input: string, key: SceneKey | undefined) => {
        // THE DETAIL OWNS THE KEYS WHILE IT IS OPEN — esc included, which is why this branch runs
        // FIRST: in the detail, esc means "back to the list", exactly as the host's own
        // dashboard/detail pair behaves. Only the list's esc/q closes the scene.
        if (detailOpen) {
          if (key?.escape === true || key?.backspace === true || input === "q") {
            setDetailAgentId(undefined)
            setDetailScroll(0)
            setNotice("")
            return
          }
          if (key?.upArrow === true) {
            setDetailScroll(Math.min(detailMaxScroll, detailScroll + 1))
            return
          }
          if (key?.downArrow === true) {
            setDetailScroll(Math.max(0, detailScroll - 1))
            return
          }
          if (input === "r" && key?.ctrl !== true) {
            refresh()
            return
          }
          if (input === "i" && key?.ctrl !== true) interrupt(detailRow)
          return
        }
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
        if (isReturn(input, key)) {
          openDetail()
          return
        }
        if (input === "r" && key?.ctrl !== true) {
          refresh()
          return
        }
        if (input === "i" && key?.ctrl !== true) interrupt(selected)
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
    if (detailOpen) {
      // THE DETAIL TAKES OVER THE BODY: the two sections below are the LIST, and drawing them
      // together with a mode that answers its own keys would leave the reader guessing which half
      // the keyboard is talking to.
      /** The detail's rows, or the honest unreadable line when the entry lost its shape. */
      const detailRows: SubagentDetailRow[] =
        detailFacts === undefined ? [{ text: "details: this entry is unreadable", dim: true }] : subagentDetailRows(detailFacts, detailScroll)
      for (let index = 0; index < detailRows.length; index += 1) {
        /** This row's own draw instructions. */
        const row = detailRows[index]
        children.push(
          React.createElement(
            ui.Text,
            {
              key: `detail-${index}`,
              ...(row.title === true ? { bold: true } : {}),
              ...(row.dim === true ? { dimColor: true } : {}),
            },
            safeRow(row.text),
          ),
        )
      }
    } else {
      // (a) THE HOST'S OWN SUBAGENT ROWS — the top section, and the reason this scene exists.
      /** The subagent section, decided in one place. */
      const section = subagentSectionRows(channel)
      for (let index = 0; index < section.length; index += 1) {
        /** This row's own draw instructions. */
        const row = section[index]
        /** The emphasis this row draws with, in the file's own row vocabulary. */
        const emphasis = {
          ...(row.header === true ? { bold: true } : {}),
          ...(row.dim === true ? { dimColor: true } : {}),
          ...(row.rowIndex !== undefined && row.rowIndex === selectedIndex ? { bold: true } : {}),
        }
        if (row.rowIndex === undefined) {
          children.push(React.createElement(ui.Text, { key: `sub-${index}`, ...emphasis }, safeRow(row.text)))
          continue
        }
        // A SUBAGENT ROW IS WRAPPED IN A BOX because the kit's `Box` is the component that carries a
        // pointer handler (`Text` does not): the whole drawn row becomes the click target, and a
        // click selects exactly what `↑`/`↓` would have selected. The row's own index is captured,
        // so the handler answers the row it was drawn for.
        /** The row index this Box selects when it is clicked. */
        const clicked = row.rowIndex
        children.push(
          React.createElement(
            ui.Box,
            { key: `sub-${index}`, onClick: () => setFocus(clicked) },
            React.createElement(ui.Text, { key: "row", ...emphasis }, safeRow(row.text)),
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
        // THE LEGEND sits directly under the DAG, in the SAME width budget the graph was laid out
        // for, so a line can never claim more cells than the drawing above it used. `graph.ts` owns
        // the content (and clamps it); a drawing module that refuses costs the legend, never the
        // surface — hence the contained call.
        /** The legend lines the drawing module offers for this width. */
        let legend: string[] = []
        try {
          legend = legendLines(measured.cols)
        } catch {
          legend = []
        }
        for (let index = 0; index < legend.length; index += 1) {
          children.push(React.createElement(ui.Text, { key: `legend-${index}`, dimColor: true }, safeRow(legend[index])))
        }
      }
    }
    if (noticeLine !== "") children.push(React.createElement(ui.Text, { key: "notice", color: "yellow" }, safeRow(noticeLine)))
    // (c) The footer hint: what THIS mode answers to, and which MPD key opens the neighbours. The
    // detail advertises its own keys, because the list's esc/q mean something else there.
    children.push(
      React.createElement(
        ui.Text,
        { key: "footer", dimColor: true },
        safeRow(
          detailOpen
            ? "esc/backspace/q back to the list · ↑↓ scroll the output · i interrupt the selected run · r refresh"
            : "esc/q close · ↑↓ select · enter detail · i interrupt the selected run · r refresh · alt+a this panel · alt+t team · alt+m board",
        ),
      ),
    )
    return React.createElement(ui.Box, { flexDirection: "column", width: "100%", flexGrow: 1, paddingX: 1 }, children)
  }
}
