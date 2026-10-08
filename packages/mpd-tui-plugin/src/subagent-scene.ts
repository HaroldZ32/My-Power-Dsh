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
import { layoutGraphNatural, legendLines, sliceSpans, type GraphTask, type GraphView } from "./graph.js"
import { NO_SESSION_TEAM_MARKER, sessionIdOf, teamWorkflowLines, WORKSPACE_SCOPE_MARKER, type TeamFeedAccessor, type TeamWorkflow } from "./team-state.js"
import { t } from "./i18n.js"
import { gutterCellsX, legendLinesFor, panelKit, textRow, toneColor, useTeamFeed, visualGlyph, type PanelKit } from "./panel-core.js"
import { DAG_ANIM, DAG_CHROME, DAG_TONE_GLYPH, type DagTone } from "./dag-theme.js"

// ── THE SHARED SURFACE VISUAL SYSTEM ────────────────────────────────────────
//
// ONE vocabulary for every MPD terminal surface: the two scene modules (this one and `scenes.ts`), the
// sidebar pages, the status row and the transcript rows. Nothing here invents a colour, a glyph, a
// marker or a legend: the TONE table, the GLYPHS and the legend come from `dag-theme.ts` (frozen,
// captain-owned) through `panel-core.ts` (the shared page core), so the DAG page, the merged panel and
// the status line cannot drift apart in what a state LOOKS like. A surface composes these helpers; it
// never names a theme key of its own.
//
// WHAT IS HERE AND WHAT IS NOT. `panel-core.ts` owns everything that is the same on a page and in a
// scene: the tone→theme-key resolution, the glyphs, the toned text row and the composed legend — this
// module IMPORTS those rather than re-deriving them. What is added here is only what a full-screen
// SCENE has and a sidebar page does not: its own clock (the scene kit exposes `useAnimationFrame`,
// whose time value the panel kit's `useAnimationTime` already is), a frame whose border title and
// colour carry the surface's state, a section rule, the body-row label vocabulary, the progress bar and
// the aggregate tone a status marker reports. A page that needs one of those may import it from here:
// this module sits BELOW both scene consumers and above the core, so no import cycle can form.

/** One tone a surface draws with: the frozen DAG union, re-exported so a consumer names ONE type. */
export type SurfaceTone = DagTone

/** The host kit a surface draws with: the React instance plus the element constructors it calls. */
export interface SurfaceKit {
  /** The host's React instance; every element goes through it (the single-React rule). */
  React: ReactLike
  /** The host's ui kit (`Box`, `Text`, `useInput`, `useTerminalSize`, the timers). */
  ui: UiLike
}

/** The draw instructions one surface row carries. */
export interface SurfaceRowStyle {
  /** The tone the row draws in; omitted leaves the row in the host's plain text colour. */
  tone?: DagTone
  /** True for a row that must read as a heading. */
  bold?: boolean
  /** True for a row the surface draws dimmed (its legend, its key hints, its nested detail). */
  dim?: boolean
}

/** The body-row vocabulary: the tone each LABEL draws in, keyed by the label a row opens with. */
const ROW_LABEL_TONE: Readonly<Record<string, DagTone>> = Object.freeze({
  workspace: "dim",
  team: "focus",
  phase: "chain",
  plan: "chain",
  "team-plan": "chain",
  captain: "dim",
  staged: "blocked",
  watchdog: "blocked",
  "team-hold": "blocked",
  members: "dim",
  roster: "focus",
  tasks: "running",
  boulder: "chain",
  plans: "dim",
  workmates: "dim",
  mail: "dim",
  note: "blocked",
  confirm: "focus",
  required: "chain",
  runnable: "chain",
})

/**
 * A body row's own shape: a lowercase label, its padding run, then the value.
 *
 * This is the vocabulary every MPD body row is written in (`boardLines`, `teamWorkflowLines`,
 * `planProjectionLines`), and matching it is what lets a surface tone the LABEL column without
 * re-parsing the sentence that follows it. A row that does not match is prose, and prose is never
 * toned by position.
 */
const LABEL_ROW = /^([a-z][a-z0-9-]*)( {2,})([\s\S]*)$/u

/**
 * How one body row splits into its label column and the value that follows it.
 * @param line - the row exactly as the body builder produced it.
 * @returns the label (padding INCLUDED, so its tone paints a run of cells) and the remainder, whose
 *   concatenation is byte-identical to `line`; undefined when this row is not a label row.
 */
export function labelSplit(line: string): { label: string; rest: string } | undefined {
  /** The row's own label/padding/value triple, when it has one. */
  const matched = LABEL_ROW.exec(line)
  if (matched === null) return undefined
  return { label: `${matched[1]}${matched[2]}`, rest: matched[3] }
}

/**
 * The label one body row opens with, when it opens with one.
 * @param line - the row exactly as the body builder produced it.
 * @returns the bare label (no padding), or undefined for a prose or nested row.
 */
export function rowLabel(line: string): string | undefined {
  /** The row's own split, when it is a label row at all. */
  const split = labelSplit(line)
  return split === undefined ? undefined : split.label.trimEnd()
}

/**
 * The tone one host subagent row maps onto, in the same six-state vocabulary the DAG uses.
 * @param row - the projected host row.
 * @returns `running` for a live run, `failed` for a failed or cancelled one, `completed` only for the
 *   status the host itself reports as completed, and `dim` for anything it does not recognize.
 */
export function toneOfStatus(row: SubagentRowView): DagTone {
  if (row.live) return "running"
  if (row.failed) return "failed"
  return row.status === "completed" ? "completed" : "dim"
}

/**
 * The team's dominant state — what the frame colour and the state marker report.
 *
 * The order of the tests IS the precedence: a failure outranks a live run, a live run outranks a
 * finished board, and `blocked` is only reached when every task the tally has not resolved is drawn
 * blocked. Nothing here re-derives a state the record already computed (the OPT-1 rule in `graph.ts`):
 * `blocked` is read off the DRAWN states, never recomputed from the dependency graph.
 * @param counts - the record's own task tally.
 * @param states - the DRAWN state of every task, for the `blocked` reading.
 * @returns the tone the surface's frame, marker and summary rows draw in.
 */
export function toneOfTally(
  counts: { total: number; completed: number; inProgress: number; failed: number },
  states: readonly unknown[] = [],
): DagTone {
  if (counts.failed > 0) return "failed"
  if (counts.inProgress > 0) return "running"
  if (counts.total > 0 && counts.completed >= counts.total) return "completed"
  /** The tasks the tally has not resolved: neither finished nor cancelled. */
  const unfinished = states.filter((state) => state !== "completed" && state !== "cancelled")
  if (counts.total > 0 && unfinished.length > 0 && unfinished.every((state) => state === "blocked")) return "blocked"
  return "open"
}

/**
 * The order a surface reports its own state in: the loudest state present wins.
 *
 * `failed` first and `running` before `blocked` is the whole content of this table — a board with one
 * broken task IS a broken board whatever else it is doing, and a board that is still moving is not
 * "waiting". The drawing's own tones (`focus`, `chain`, `edge`, `blank`) sit below the six states so a
 * decorative tone can never mask one that means something.
 */
const TONE_PRECEDENCE: readonly DagTone[] = Object.freeze([
  "failed", "running", "blocked", "completed", "cancelled", "open", "focus", "chain", "edge", "dim", "blank",
])

/**
 * The one tone a surface reports for a whole set of things.
 * @param tones - the tones present on the surface, in any order.
 * @returns the highest-precedence tone, or `dim` when the set is empty (nothing to report).
 */
export function dominantTone(tones: readonly DagTone[]): DagTone {
  for (const tone of TONE_PRECEDENCE) if (tones.includes(tone)) return tone
  return "dim"
}

/**
 * One progress bar, over the frozen bar cells.
 * @param filled - how many units are done; clamped into `0..total`.
 * @param total - the tally's size; a non-finite or non-positive size draws an EMPTY bar.
 * @param cells - the bar's width in cells; a non-positive or unmeasurable width draws nothing.
 * @returns `cells` characters, never wider than the width asked for.
 */
export function barCells(filled: number, total: number, cells: number): string {
  /** The bar's width in cells; a width that is not a finite number draws nothing at all. */
  const width = Number.isFinite(cells) ? Math.max(0, Math.floor(cells)) : 0
  if (width === 0) return ""
  /** The tally, clamped to a finite and coherent pair. */
  const whole = Number.isFinite(total) ? Math.max(0, Math.floor(total)) : 0
  /** How much of that tally is done, never more than the whole and never below zero. */
  const part = Number.isFinite(filled) ? Math.min(whole, Math.max(0, Math.floor(filled))) : 0
  // ZERO OF ZERO DRAWS EMPTY, not full: rounding `0/0` up would paint a finished bar over a board the
  // record has said nothing about. A non-zero part always lights at least one cell, so a bar that has
  // started never reads as untouched.
  const lit = whole === 0 ? 0 : Math.min(width, Math.max(part > 0 ? 1 : 0, Math.round((part / whole) * width)))
  return DAG_CHROME.barFull.repeat(lit) + DAG_CHROME.barEmpty.repeat(width - lit)
}

/**
 * The frames a running marker breathes through.
 *
 * Frame {@link DAG_ANIM.staticPhase} IS the published `running` state glyph, so a host with no timer
 * draws exactly the character the legend says means `running` — the degraded frame is the static one,
 * never a stalled intermediate. The table is the CONTRACT's own (`DAG_ANIM.runningFrames`) because the
 * DAG page's node label breathes through the same marks: a second copy here would be two animations of
 * one state, and the first edit to either would leave the two surfaces breathing differently.
 */
export const RUNNING_FRAMES: readonly string[] = DAG_ANIM.runningFrames

/**
 * The running marker at one phase, wrapping rather than going out of range.
 * @param phase - the phase index, from {@link animPhase} or from a caller's own clock.
 * @returns one of {@link RUNNING_FRAMES}.
 */
export function runningMarker(phase: number): string {
  /** The phase actually drawn; a non-finite phase is the static one. */
  const index = Number.isFinite(phase) ? ((Math.floor(phase) % RUNNING_FRAMES.length) + RUNNING_FRAMES.length) % RUNNING_FRAMES.length : DAG_ANIM.staticPhase
  return RUNNING_FRAMES[index] ?? DAG_TONE_GLYPH.running ?? "◐"
}

/**
 * The tick a running marker is drawn at, from the frozen animation budget.
 * @param timeMs - the host clock in milliseconds; a non-finite or non-positive clock is the static frame.
 * @returns the phase index in `0..DAG_ANIM.frames`.
 */
export function animPhase(timeMs: number): number {
  if (!Number.isFinite(timeMs) || timeMs <= 0) return DAG_ANIM.staticPhase
  return Math.floor(timeMs / DAG_ANIM.intervalMs) % DAG_ANIM.frames
}

/**
 * The marker a surface draws for its dominant state.
 * @param tone - the state's tone.
 * @param phase - the animation phase; only a `running` marker breathes.
 * @returns the breathing marker for a live state, the contract's own state glyph for every other one
 *   (read through `panel-core.ts`, so a scene and a page spell a state identically).
 */
export function stateMarker(tone: DagTone, phase: number): string {
  return tone === "running" ? runningMarker(phase) : visualGlyph(tone)
}

/**
 * Join the parts of one chrome title, dropping the ones that are not there.
 * @param parts - the parts, in print order; an empty or absent part contributes nothing.
 * @returns the parts joined with the surface separator, or "" when none of them exists.
 */
export function chromeTitle(parts: readonly (string | undefined)[]): string {
  return parts.filter((part): part is string => part !== undefined && part !== "").join(" · ")
}

/**
 * The one animation source a full-screen SCENE reads.
 *
 * The host's SCENE kit exposes `useAnimationFrame(ms)`, returning a `[ref, time]` pair whose ref must
 * be attached to the animated element or the shared clock never starts; its PANEL kit exposes the time
 * alone as `useAnimationTime(ms)` (which is why `panel-core.ts`'s `useRunningPhase` cannot drive a
 * scene: the member it reads is absent from this kit). A kit with NEITHER is a host with no timer at
 * all, and the surface then draws the frozen static frame — the honest degradation, never a
 * half-animation that looks running while nothing ticks.
 * @param ui - the host ui kit.
 * @returns the clock in milliseconds (0 when the host has no timer) plus the ref to attach.
 */
export function useSurfaceClock(ui: UiLike): { time: number; ref: unknown } {
  if (typeof ui.useAnimationFrame === "function") {
    /** The host's own pair: the viewport ref that keeps the clock alive, and the current time. */
    const pair = ui.useAnimationFrame(DAG_ANIM.intervalMs)
    /** The ref (first) and the time (second), whatever shape the host returned. */
    const ref = Array.isArray(pair) ? pair[0] : undefined
    /** The clock, narrowed to a finite number. */
    const time = Number(Array.isArray(pair) ? pair[1] : 0)
    return { time: Number.isFinite(time) ? time : 0, ref }
  }
  if (typeof ui.useAnimationTime === "function") {
    /** The panel kit's clock, narrowed to a finite number. */
    const time = Number(ui.useAnimationTime(DAG_ANIM.intervalMs))
    return { time: Number.isFinite(time) ? time : 0, ref: undefined }
  }
  return { time: 0, ref: undefined }
}

/**
 * One drawn row, in the tone that carries its meaning.
 *
 * This is a thin SCENE-SHAPED ADAPTER over `panel-core.ts`'s {@link textRow}, not a second row builder:
 * the element, the sanitizer and the tone→theme-key resolution are the core's, and what this adapter
 * adds is the ONE precedence rule this file's surfaces obey.
 * @param kit - the host kit.
 * @param key - the React key (every row carries one, so a diff is stable and a test can address it).
 * @param text - the row's text; sanitized by the core, so a caller may pass a raw record field.
 * @param style - the tone, the emphasis and the dimming this row draws with.
 * @returns the host element.
 */
export function surfaceText(kit: SurfaceKit, key: string, text: string, style: SurfaceRowStyle = {}): unknown {
  // A TONED ROW IS NOT ALSO DIMMED. `dimColor` and a tone are two different signals, and the host's own
  // `ThemedText` resolves an explicit colour OVER `dimColor`, so asking for both would silently drop one
  // of them — the dim is reserved for the rows that have no tone of their own.
  //
  // THE CAST IS THE TWO LANE-OWNED KIT TYPES MEETING, and it is sound where it is used: the scene kit
  // and the panel kit are different host objects that both carry `Box`/`Text` (the only members
  // `textRow` reads), while the two structural declarations list different React members (the scene kit
  // has no `useRef` contract here, the panel kit has no `useInput`), so neither type is assignable to
  // the other even though every member `textRow` calls is present.
  return textRow(kit as unknown as PanelKit, text, {
    key,
    ...(style.tone === undefined ? {} : { tone: style.tone }),
    ...(style.bold === true ? { bold: true } : {}),
    ...(style.dim === true && style.tone === undefined ? { dim: true } : {}),
  })
}

/**
 * One body row: its LABEL column in the row's own tone, its value in the surface's plain text.
 *
 * A row that does not open with a known label (a task line, a member line, a localized sentence, a
 * blank) is drawn whole. The concatenation of the two spans is byte-identical to the input, so a
 * surface may restyle a body without re-rendering it — the projection stays the body builder's.
 * @param kit - the host kit.
 * @param key - the React key.
 * @param line - the row exactly as the body builder produced it.
 * @param overrides - per-label tones for the rows whose tone depends on a VALUE (`tasks` is toned by
 *   the tally, `runnable` by whether the plan can run), applied over the shared table.
 * @returns the host element.
 */
export function surfaceBodyRow(kit: SurfaceKit, key: string, line: string, overrides?: Readonly<Record<string, DagTone>>): unknown {
  if (line === "") return surfaceText(kit, key, line)
  /** How this row splits into a label column and its value, when it is a label row. */
  const split = labelSplit(line)
  if (split === undefined) {
    // A NESTED ROW IS DIMMED, and that is the whole hierarchy rule: an indented member or task line is
    // detail under a heading the surface already toned, and the drawing below states its own colours.
    return surfaceText(kit, key, line, line.startsWith("  ") ? { dim: true } : {})
  }
  /** The label this row opens with, without its padding. */
  const label = split.label.trimEnd()
  /** The tone this row draws: its override first, then the shared table, then the row's own fallback. */
  const tone = overrides?.[label] ?? ROW_LABEL_TONE[label] ?? "dim"
  return kit.React.createElement(
    kit.ui.Text,
    { key },
    kit.React.createElement(kit.ui.Text, { key: "label", color: toneColor(tone) }, split.label),
    kit.React.createElement(kit.ui.Text, { key: "value" }, split.rest),
  )
}

/**
 * A horizontal rule, in the host's own divider craft: a one-row box carrying ONLY its top border, with
 * an optional section title embedded in it (the host's `SidePanelColumn` draws its separator the same
 * way, and its frame titles go through `borderText`).
 * @param kit - the host kit.
 * @param key - the React key.
 * @param title - the section title; omitted draws a bare rule.
 * @param tone - the tone the rule and its title draw in.
 * @returns the host element.
 */
export function surfaceRule(kit: SurfaceKit, key: string, title?: string, tone: DagTone = "dim"): unknown {
  return kit.React.createElement(kit.ui.Box, {
    key,
    height: 1,
    flexShrink: 0,
    borderStyle: DAG_CHROME.frameBorder,
    borderTop: true,
    borderBottom: false,
    borderLeft: false,
    borderRight: false,
    borderColor: toneColor(tone),
    ...(title === undefined || title === "" ? {} : { borderText: { content: safeRow(title), position: "top", align: "start" } }),
  })
}

/**
 * The surface's own frame: the outer box a scene body sits in, its title embedded in the border and its
 * border colour carrying the surface's dominant state.
 * @param kit - the host kit.
 * @param key - the React key.
 * @param title - the border title, ALREADY clamped by the caller to the measured width.
 * @param children - the drawn rows, in render order.
 * @param tone - the surface's dominant tone (the same one its marker and summary rows use).
 * @param ref - the animated element ref the host's clock wants, when this host has a timer.
 * @returns the host element.
 */
export function surfaceFrame(
  kit: SurfaceKit,
  key: string,
  title: string,
  children: readonly unknown[],
  tone: DagTone = "dim",
  ref?: unknown,
): unknown {
  return kit.React.createElement(
    kit.ui.Box,
    {
      key,
      flexDirection: "column",
      width: "100%",
      flexGrow: 1,
      paddingX: 1,
      borderStyle: DAG_CHROME.frameBorder,
      borderColor: toneColor(tone),
      ...(ref === undefined ? {} : { ref }),
      ...(title === "" ? {} : { borderText: { content: safeRow(title), position: "top", align: "start" } }),
    },
    children,
  )
}

/**
 * The key-hint footer every surface ends with.
 * @param kit - the host kit.
 * @param key - the React key.
 * @param hints - the hints, in the order the reader should try them.
 * @returns the host element.
 */
export function surfaceHints(kit: SurfaceKit, key: string, hints: readonly string[]): unknown {
  return surfaceText(kit, key, chromeTitle(hints), { dim: true })
}

/** The scene id this component is registered under (unique, kebab-case, MPD-owned). */
export const SUBAGENT_SCENE_ID = "mpd-tui-subagents"

/** The scene title the host's registry shows for it. */
export const SUBAGENT_SCENE_TITLE = "MPD subagents + team"

/** The cell budget of ONE rendered row — the same bound the other scenes apply to their rows. */
export const MERGED_ROW_MAX_CELLS = 4000

/** The column count the DAG is laid out for before the host has measured one. */
const FALLBACK_COLS = 100

/** The rows a scene assumes when the host cannot measure its terminal; the DAG's own vertical page step. */
const FALLBACK_ROWS = 24

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
  /** Left arrow — the horizontal pan's own key when Shift is held, a focus walk otherwise. */
  leftArrow?: boolean
  /** Right arrow — the same, in the other direction. */
  rightArrow?: boolean
  /** Page up — pages the DAG vertically, and horizontally with Shift. */
  pageUp?: boolean
  /** Page down — the same, downwards. */
  pageDown?: boolean
  /** Home — the top of the DAG. */
  home?: boolean
  /** End — the bottom of the DAG. */
  end?: boolean
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
  /**
   * The host's shared-clock hook, when this build exposes it: the SCENE kit's timer, returning a
   * `[ref, time]` pair. A host without it (and without {@link UiLike.useAnimationTime}) has no timer at
   * all, and a surface then draws its static frame rather than pretending to animate.
   */
  useAnimationFrame?(intervalMs: number | null): unknown
  /** The PANEL kit's timer, when the same surface is handed a panel kit instead: the time alone. */
  useAnimationTime?(intervalMs: number | null): number
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
  /** The row count, which is the DAG's vertical page step; the fallback when the host measured none. */
  rows: number
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
 *
 * The VERDICT is `panel-core.ts`'s own guard, so a page and a scene refuse exactly the same hosts; the
 * casts below are the two kit declarations meeting (the scene kit carries `useInput` and
 * `useAnimationFrame` where the panel kit carries `useAnimationTime`, so neither structural type is
 * assignable to the other even though every member proved here is the same). Each ADDITIONAL field is
 * feature-detected at its own use site, so a leaner host build degrades instead of throwing.
 * @param React - the props' React field.
 * @param ui - the props' ui field.
 * @returns the two, typed, or undefined when the host kit is unusable.
 */
function hostKit(React: unknown, ui: unknown): HostKit | undefined {
  if (panelKit(React, ui) === undefined) return undefined
  return { React: React as ReactLike, ui: ui as UiLike }
}

/**
 * Measure the host's terminal through its own hook — ONCE per render, so the hook order never moves.
 * @param ui - the host ui kit.
 * @returns the size label and the column count, each with a documented fallback.
 */
function measureTerminal(ui: UiLike): Measured {
  if (typeof ui.useTerminalSize !== "function") return { size: "", cols: FALLBACK_COLS, rows: FALLBACK_ROWS }
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
  /** The row count as a number; NaN when the host measured none. */
  const height = Number(rows)
  return {
    size: `${String(columns)}x${String(rows)}`,
    cols: Number.isFinite(cols) && cols > 20 ? cols : FALLBACK_COLS,
    rows: Number.isFinite(height) && height > 5 ? Math.floor(height) : FALLBACK_ROWS,
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
 * The DAG box for one render, at its NATURAL width (frozen clauses T1/T2).
 *
 * THE SIGNATURE IS UNCHANGED ON PURPOSE and its second argument has CHANGED MEANING: `cols` is now the
 * VIEWPORT the drawing will be windowed to, not the width the drawing is squeezed into. Every caller
 * keeps working, and the difference is that `GraphView.width` may now exceed `cols` — the caller cuts
 * the rows with `sliceSpans` and pans. This is the SHARED entry point: the merged panel and the
 * full-screen subagent scene both come through here, so they cannot describe one team differently.
 * @param workflow - the team projection, when it is readable.
 * @param cols - the measured terminal width, which is the VIEWPORT rather than the drawing's width.
 * @param rows - the rows the surface can show, which buys the roomy box form when there is room.
 * @returns the laid-out graph, or undefined when there is no team or no task to draw.
 */
export function teamGraphView(workflow: TeamWorkflow | undefined, cols: number, rows?: number): GraphView | undefined {
  if (workflow === undefined || workflow.tasks.length === 0) return undefined
  try {
    return layoutGraphNatural(graphTasksOf(workflow), undefined, rows === undefined ? {} : { rows })
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
 * How long a pending detail request stays usable, in milliseconds.
 *
 * The window this covers is the one between the DAG page deciding to open a member's page and the
 * scene's FIRST render — two calls inside one synchronous route, so five seconds is already generous.
 * The bound exists for the OTHER case: the scene is already mounted (the request cannot seed a state
 * that has already been initialised), and an unbounded request would then ambush some unrelated LATER
 * open with a stale agent id. A request older than this is DROPPED, never replayed.
 */
export const SUBAGENT_DETAIL_REQUEST_TTL_MS = 5000

/**
 * The ONE pending request, module-scoped on purpose.
 *
 * WHY NOT A PARAMETER: the scene component is constructed by `scenes.ts` at apply time, while the
 * request is produced later by a CLICK in a sidebar panel, and the host's scene seam opens a scene by
 * id alone (`tui.openScene(id)`) — there is no per-open argument to carry. The request is therefore a
 * one-slot handoff between the two, with three properties that keep it honest: it is TRANSIENT (a UI
 * gesture, never persisted state), it is DESTRUCTIVE (taking it clears it), and it EXPIRES (see
 * {@link SUBAGENT_DETAIL_REQUEST_TTL_MS}). The slot holds the LAST request only — two clicks inside
 * one mount window resolve to the page the user last pointed at, which is what a click means.
 */
let pendingDetailRequest: { agentId: string; at: number } | undefined

/**
 * Ask the merged scene to open on one subagent's DETAIL view the next time it mounts.
 *
 * The caller is expected to open the scene immediately afterwards; a request that no mount ever takes
 * simply expires. Nothing here reads the host — it records an intent, it does not verify one.
 * @param agentId - the HOST's own subagent id (the key the detail view re-reads its entry by).
 * @param atMs - the instant the request was made; a test injects it to age a request deliberately.
 */
export function requestSubagentDetail(agentId: string, atMs: number = Date.now()): void {
  pendingDetailRequest = { agentId, at: atMs }
}

/**
 * Take the pending request, if one is still fresh: a DESTRUCTIVE read.
 *
 * Destructive by contract, for two reasons that are the same reason: a second scene open must not
 * re-enter a detail the user has already left, and a reader that returned the same id twice would make
 * "opened on the member you clicked" indistinguishable from "opened on whatever is still lying
 * around". A stale or nonsensical request is cleared and reported as absent — the caller then lands on
 * the scene's list, which is the honest surface for "nobody told me which member".
 * @param nowMs - the current instant; defaults to the wall clock, and a test passes its own.
 * @returns the agent id to open the detail on, or undefined when there is nothing fresh to open.
 */
export function takeSubagentDetailRequest(nowMs: number = Date.now()): string | undefined {
  /** The request as it stood; the slot is cleared BEFORE it is judged, so a rejection cannot linger. */
  const request = pendingDetailRequest
  pendingDetailRequest = undefined
  if (request === undefined) return undefined
  if (request.agentId === "") return undefined
  if (!Number.isFinite(nowMs)) return undefined
  /** How long the request has been waiting, in milliseconds; a clock that ran BACKWARDS is not fresh. */
  const age = nowMs - request.at
  if (age < 0 || age > SUBAGENT_DETAIL_REQUEST_TTL_MS) return undefined
  return request.agentId
}

/**
 * Build the merged scene component.
 * @param readWorkflow - reads the MPD team projection for this session's workspace; the wiring in
 *   `scenes.ts` passes the same reader the team scene uses, so the two cannot drift. It takes the
 *   CALLING session's id — read off this scene's own live channel — because the team is session-scoped:
 *   with an id it can only answer with THIS session's board, and with none it runs the marked
 *   workspace-level fallback. It is injected (rather than imported) so this file stays free of the
 *   scene-registration module.
 * @param onHostKit - receives the host's own `ui` kit on every render; the adapter keeps it because a
 *   SCENE is the only surface the host hands that object to, and its `useStdin` is the one that
 *   resolves the LIVE input context (measured, dsh-tui 0.12.0). Optional: the panel still renders
 *   without it, and a caller that omits it simply reports nothing.
 * @param takePendingDetail - reads (and consumes) a request to open ON one member's detail view; the
 *   reader is consulted EXACTLY ONCE, on the mount that opens the scene. Defaults to this module's own
 *   {@link takeSubagentDetailRequest}, which is how the DAG page's `openAgentPage` reaches a scene an
 *   earlier `scenes.ts` already constructed.
 * @param subscribeTeams - resolves the LIVE team-state feed for the calling session's workspace, per
 *   render; undefined keeps this scene on its 2000 ms tick alone.
 * @returns a component matching the host's `TuiSceneProps` contract.
 */
export function createSubagentSceneComponent(
  readWorkflow: (sessionId?: string) => TeamWorkflow | undefined,
  onHostKit?: (ui: unknown) => unknown,
  takePendingDetail: () => string | undefined = takeSubagentDetailRequest,
  subscribeTeams?: TeamFeedAccessor,
): unknown {
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
    // THE ONE TIMER this surface reads, taken BEFORE any other hook so its position never depends on a
    // branch: a host with no timer answers `{time: 0}` and every animated cell below then draws the
    // frozen static frame (see `useSurfaceClock`).
    /** The host clock and the ref the animated element must carry to keep it running. */
    const clock = useSurfaceClock(ui)
    /** The phase the running marker breathes at, from the frozen animation budget. */
    const phase = animPhase(clock.time)

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
    /**
     * The agent id the DETAIL view is open on; undefined means the list owns the scene body.
     *
     * ITS INITIAL VALUE IS THE PENDING REQUEST, read through a lazy initializer so the reader runs
     * EXACTLY ONCE per mount (React evaluates a function argument only on the mount, and this module's
     * own reader is destructive): a scene the DAG page asked to open on a member comes up ON that
     * member's detail, while a scene opened any other way comes up on its list.
     */
    const detailState = React.useState(() => takePendingDetail())
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
    // THE DAG'S OWN HORIZONTAL WINDOW (frozen clauses T2/T5, captain's ruling R8). It is the DRAWING's
    // offset and nothing else: the team rows, the legend, the detail pane and the hints all stay at the
    // terminal's width. The purpose, said once: the pan exists so the WHOLE DAG can be seen.
    /** The DAG's horizontal scroll offset, in cells. */
    const graphXState = React.useState(0)
    /** The DAG's horizontal scroll offset, in cells. */
    const graphX = graphXState[0] as number
    /** Moves the DAG's horizontal offset. */
    const setGraphX = graphXState[1] as (next: number) => void
    /** The DAG's vertical scroll offset, in rows — this scene windows the drawing on both axes. */
    const graphYState = React.useState(0)
    /** The DAG's vertical scroll offset. */
    const graphY = graphYState[0] as number
    /** Moves the DAG's vertical offset. */
    const setGraphY = graphYState[1] as (next: number) => void

    /** Re-read the team projection; the render path itself stays free of I/O. */
    const refresh = (): void => {
      /** The freshly read projection; undefined means unreadable. */
      let next: TeamWorkflow | undefined
      try {
        // THE SESSION ID IS READ AT CALL TIME off the live channel: the timer and the feed
        // notification both reach this closure long after the render that defined it, and the channel
        // publishes its id later. This is the read that makes the merged panel draw ITS OWN session's
        // team, which is the defect the user reported (a new session showing the old session's DAG).
        next = readWorkflow(sessionIdOf(channel))
      } catch {
        next = undefined
      }
      setWorkflow(next)
    }

    // THE PUSH (PART P): this scene keeps its projection in a state cell, so a notification re-READS
    // it through `refresh` rather than merely re-rendering. The 2000 ms tick below stays as the
    // fallback for a composition without the feed or without `mpd-team-core`.
    useTeamFeed(React, subscribeTeams, refresh)

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
    // THE DAG'S OWN WINDOW, computed ONCE per render and ABOVE the key handler, because the handler must
    // answer `⇧←→`/`⇧PgUp`/`⇧PgDn` against the same bounds the rows are cut with (clause T4: one offset,
    // one band). `undefined` when the team has no task to draw, which is also the key handler's "no DAG
    // on screen" signal.
    /** The DAG box for this render, at its natural width. */
    const dagView = teamGraphView(workflow, measured.cols)
    /** The furthest horizontal offset that still fills the viewport; zero when the drawing fits. */
    const dagXMax = dagView === undefined ? 0 : Math.max(0, dagView.width - measured.cols)
    /** The furthest vertical offset; zero when the drawing fits the terminal. */
    const dagYMax = dagView === undefined ? 0 : Math.max(0, dagView.lines.length - 1)
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
        // THE DAG'S OWN PAN KEYS GO FIRST (frozen clause T5) — and they MUST, because `↑/↓` are this
        // scene's SELECTION keys: a `⇧↑` that fell through to the branch below would move the selection
        // instead of the drawing, which is the opposite of what the user asked for. `⇧←→`/`⇧↑↓` pan the
        // DRAWING one cell, `⇧PgUp/PgDn` one page, `PgUp/PgDn` page it vertically and `Home`/`End` go to
        // its vertical ends — each clamped to the bounds the rows above were actually cut with, so a key
        // can never ask for a window that does not exist. Every direction is its own branch: an `a || b`
        // condition narrows BOTH flags and the second read then fails to typecheck.
        // THE DAG'S OWN PAN KEYS (frozen clause T5), answered before the plain keys and only when a DAG
        // is on screen. `⇧←→` scroll the DRAWING horizontally, `⇧↑↓` vertically, `⇧PgUp/PgDn` page it
        // horizontally and `Home`/`End` go to its vertical ends — all of them clamped to the bounds the
        // rows above were actually cut with, so a key can never ask for a window that does not exist.
        // EACH DIRECTION IS ITS OWN BRANCH, never an `a || b` with a ternary inside: TypeScript narrows
        // BOTH flags to `false | undefined` inside such a condition, so re-reading either one is a
        // comparison the type checker rejects (and a reader has to work out which leg is reachable).
        if (dagView !== undefined && key?.shift === true && key?.leftArrow === true) {
          setGraphX(Math.max(0, Math.min(dagXMax, graphX - 1)))
          return
        }
        if (dagView !== undefined && key?.shift === true && key?.rightArrow === true) {
          setGraphX(Math.max(0, Math.min(dagXMax, graphX + 1)))
          return
        }
        if (dagView !== undefined && key?.shift === true && key?.upArrow === true) {
          setGraphY(Math.max(0, Math.min(dagYMax, graphY - 1)))
          return
        }
        if (dagView !== undefined && key?.shift === true && key?.downArrow === true) {
          setGraphY(Math.max(0, Math.min(dagYMax, graphY + 1)))
          return
        }
        if (dagView !== undefined && key?.shift === true && key?.pageUp === true) {
          setGraphX(Math.max(0, Math.min(dagXMax, graphX - measured.cols)))
          return
        }
        if (dagView !== undefined && key?.shift === true && key?.pageDown === true) {
          setGraphX(Math.max(0, Math.min(dagXMax, graphX + measured.cols)))
          return
        }
        if (dagView !== undefined && key?.pageUp === true) {
          setGraphY(Math.max(0, Math.min(dagYMax, graphY - measured.rows)))
          return
        }
        if (dagView !== undefined && key?.pageDown === true) {
          setGraphY(Math.max(0, Math.min(dagYMax, graphY + measured.rows)))
          return
        }
        if (dagView !== undefined && key?.home === true) {
          setGraphY(0)
          return
        }
        if (dagView !== undefined && key?.end === true) {
          setGraphY(dagYMax)
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

    // THE SURFACE'S DOMINANT STATE. Every surface reports ONE state in its frame colour and its
    // marker, and this one has two bodies to report: the host's subagents on top, the MPD team below.
    // The section tone is the host's own row states; the team tone is the record's tally. Neither is
    // invented here — both come from the frozen six-state vocabulary.
    /** The host section's dominant tone, from the rows actually drawn. */
    const sectionTone: DagTone = dominantTone(rows.map((row) => toneOfStatus(row)))
    /** The team's dominant tone, or `dim` when this workspace holds no readable team. */
    const teamTone: DagTone = workflow === undefined ? "dim" : toneOfTally(workflow.counts, workflow.tasks.map((task) => task.visual))
    /** The tone the whole surface draws in, before the detail mode overrides it with its own row. */
    const surfaceTone: DagTone = dominantTone([sectionTone, teamTone])
    /** The tone this render's frame, marker and summary rows all read. */
    const frameTone: DagTone = detailOpen && detailRow !== undefined ? toneOfStatus(detailRow) : surfaceTone

    /** The elements handed to the host's Box, in render order. */
    const children: unknown[] = []
    children.push(
      surfaceText(
        kit,
        "title",
        // Resolved per render through MPD's own dictionary: the descriptor's title is fixed at
        // registration, so the body must not read a stale constant either (see `i18n.ts`). The state
        // mark opens the row here as it does on every other scene, and it is NOT a title part: joining
        // it with the separator would read `◐ · MPD …`, a mark followed by a dangling separator.
        chromeTitle([`${stateMarker(frameTone, phase)} ${t("scene.subagents")}`, measured.size === "" ? undefined : measured.size]),
        { bold: true, tone: frameTone },
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
        // THE DETAIL CARRIES ITS OWN TONES: its title takes the row's state tone (it is the row the
        // user opened), its labelled facts are body rows like every other surface's.
        children.push(
          row.title === true
            ? surfaceText(kit, `detail-${index}`, row.text, { bold: true, tone: frameTone })
            : surfaceBodyRow(kit, `detail-${index}`, row.text, row.dim === true ? undefined : { output: "dim" }),
        )
        if (row.dim === true) {
          // `subagentDetailRows` marks its paging hint dim rather than toned, and the hint is prose —
          // it is redrawn here through the one row builder so it keeps the dim signal the projection
          // asked for. The key is REUSED deliberately: the element replaces the one pushed above.
          children[children.length - 1] = surfaceText(kit, `detail-${index}`, row.text, { dim: true })
        }
      }
    } else {
      // (a) THE HOST'S OWN SUBAGENT ROWS — the top section, and the reason this scene exists.
      /** The subagent section, decided in one place. */
      const section = subagentSectionRows(channel)
      for (let index = 0; index < section.length; index += 1) {
        /** This row's own draw instructions. */
        const row = section[index]
        // A SUBAGENT ROW DRAWS IN ITS OWN STATE TONE, and the tone is derived from the row's own
        // projection rather than from its text: the header and the counts row summarise the section and
        // take its dominant tone, an empty state keeps the host's dim, and a run row takes the tone of
        // the status the host reported for it (`running`/`completed`/`failed`, `dim` when unknown).
        /** The row view this section row projects, when it is a subagent row. */
        const view = row.rowIndex === undefined ? undefined : rows[row.rowIndex]
        /** The tone this row draws in. */
        const tone: DagTone | undefined = view !== undefined ? toneOfStatus(view) : row.dim === true ? undefined : sectionTone
        /** The emphasis this row draws with, in the file's own row vocabulary. */
        const emphasis = {
          ...(tone === undefined ? {} : { tone }),
          bold: row.header === true || (view !== undefined && row.rowIndex === selectedIndex),
          ...(row.dim === true ? { dim: true } : {}),
        }
        if (row.rowIndex === undefined) {
          children.push(surfaceText(kit, `sub-${index}`, row.text, emphasis))
          continue
        }
        // A SUBAGENT ROW IS WRAPPED IN A BOX because the kit's `Box` is the component that carries a
        // pointer handler (`Text` does not): the whole drawn row becomes the click target, and a
        // click selects exactly what `↑`/`↓` would have selected. The row's own index is captured,
        // so the handler answers the row it was drawn for.
        /** The row index this Box selects when it is clicked. */
        const clicked = row.rowIndex
        children.push(React.createElement(ui.Box, { key: `sub-${index}`, onClick: () => setFocus(clicked) }, surfaceText(kit, "row", row.text, emphasis)))
      }
      // (b) THE MPD TEAM PANEL BELOW IT — the SAME row builder and the SAME projection the team scene
      // uses, so the two surfaces cannot describe the team differently. The rule the section ends with
      // is the host's own divider craft, and it carries the section's tone.
      children.push(surfaceRule(kit, "sep", undefined, surfaceTone))
      /** The team body's rows, or the team scene's own unreadable line. */
      let teamLines: string[]
      try {
        teamLines = workflow === undefined ? ["team state unreadable"] : teamWorkflowLines(workflow)
      } catch {
        teamLines = ["team state unreadable"]
      }
      for (let index = 0; index < teamLines.length; index += 1) {
        /** The one row whose tone depends on a VALUE rather than on its label. */
        const overrides: Readonly<Record<string, DagTone>> = { tasks: teamTone }
        children.push(surfaceBodyRow(kit, `team-${index}`, teamLines[index], overrides))
      }
      // THE DAG BOX, at its NATURAL width and WINDOWED (clauses T1/T2). `view.width` may exceed the
      // terminal; the two offsets below are the DRAWING's own window and are read by the header, the
      // rows, the rail and the wheel alike, so the four cannot disagree (clause T4).
      /** The DAG box, absent when the team has no task to draw. */
      const view = dagView
      if (view !== undefined) {
        /** The horizontal offset for THIS render, clamped — the one value every row and the rail read. */
        const graphXAt = Math.min(Math.max(0, graphX), dagXMax)
        /** The VERTICAL offset for this render, clamped to the drawing — the other axis of the same window. */
        const graphYAt = Math.min(Math.max(0, graphY), dagYMax)
        children.push(React.createElement(ui.Text, { key: "graphhead", dimColor: true }, safeRow(`task dependency graph${view.mode === "rail" ? " (rail)" : ""}${dagXMax > 0 ? ` ⇠${graphXAt}/${view.width}→` : ""}`)))
        for (let index = graphYAt; index < view.lines.length; index += 1) {
          // The spans go through WITHOUT `safeRow`, exactly as the team scene draws them: `graph.ts`
          // already applies `clampCells(stripControl(...))` at layout time, and re-clamping here would
          // cut the row's own multi-span geometry twice. The COLOUR is resolved through the frozen
          // contract's table, which is the table `graph.ts`'s own `GRAPH_THEME` mirrors — the drawing
          // and the panels therefore cannot drift apart (asserted in `test/scene-visuals.test.ts`).
          // THE HORIZONTAL WINDOW IS APPLIED HERE AND NOWHERE ELSE: this is the DAG's own row list, so
          // every other row this scene draws keeps the terminal's full width (R8).
          /** The spans of this row, cut to the viewport and each drawn in its own theme colour. */
          const spans = sliceSpans(view.lines[index], graphXAt, measured.cols).map((span, at) => React.createElement(ui.Text, { key: `s${at}`, color: toneColor(span.tone) }, span.text))
          children.push(React.createElement(ui.Text, { key: `graph-${index}` }, ...spans))
        }
        // THE HORIZONTAL RAIL, DIRECTLY BENEATH THE DRAWING (R8), from the SAME offset the rows were cut
        // with — one position, two views of it (clause T4). Drawn only while the drawing is wider.
        if (dagXMax > 0) {
          /** The rail's cells, from `panel-core.ts`'s ONE horizontal-gutter function. */
          const rail = gutterCellsX(graphXAt, view.width, measured.cols)
          if (rail !== "") children.push(surfaceText(kit, "hrail", rail, { dim: true }))
        }
        // THE LEGEND sits directly under the DAG, in the SAME width budget the graph was laid out
        // for, so a line can never claim more cells than the drawing above it used. It is COMPOSED, not
        // private: `graph.ts` owns the drawing's own arrow/focus sentence, and `panel-core.ts`'s
        // `legendLinesFor` appends the CONTRACT's ONE state key — the six-state key that tells
        // `○ blocked` from `○ open`, which the drawing module's DELETED five-state key could not.
        // Handing the drawing's line to that helper is what keeps this scene's legend identical to the
        // DAG page's, and it is why this scene prints the state key exactly once.
        // A drawing module that refuses costs the legend, never the surface (hence the contained call).
        /** The drawing module's own line: its arrow/focus sentence; the state key belongs to the composer. */
        let arrow: string[] = []
        try {
          arrow = legendLines(measured.cols)
        } catch {
          arrow = []
        }
        // THE TWO GROUPS KEEP THEIR OWNER'S KEY: the drawing's lines stay `legend-<i>` (the interface
        // this package's own suite pins), and the contract's appended key rows are `state-key-<i>`, so
        // a reader — and a test — can tell which owner said what. Both are drawn DIMMED: a legend
        // explains the drawing and never competes with it.
        for (let index = 0; index < arrow.length; index += 1) {
          children.push(surfaceText(kit, `legend-${index}`, arrow[index], { dim: true }))
        }
        /** The composed legend: the drawing's lines followed by the contract's six-state key. */
        let legend: string[] = []
        try {
          legend = legendLinesFor(measured.cols, arrow)
        } catch {
          legend = []
        }
        for (let index = arrow.length; index < legend.length; index += 1) {
          children.push(surfaceText(kit, `state-key-${index - arrow.length}`, legend[index], { dim: true }))
        }
      }
    }
    if (noticeLine !== "") {
      // A SUCCESS AND A REFUSAL ARE NOT THE SAME COLOUR: the notice vocabulary is this file's own
      // (`interrupt requested …` / `interrupt: …`), and it is the only thing that tells them apart.
      children.push(surfaceText(kit, "notice", noticeLine, { tone: noticeLine.startsWith("interrupt requested") ? "completed" : "blocked" }))
    }
    // (c) The footer hint: what THIS mode answers to, and which MPD key opens the neighbours. The
    // detail advertises its own keys, because the list's esc/q mean something else there.
    children.push(
      surfaceHints(
        kit,
        "footer",
        detailOpen
          ? ["esc/backspace/q back to the list", "↑↓ scroll the output", "i interrupt the selected run", "r refresh"]
          : ["esc/q close", "↑↓ select", "enter detail", "i interrupt the selected run", "r refresh", "alt+a this panel", "alt+t team", "alt+m board"],
      ),
    )
    // THE FRAME: the surface's own border, its title in the border line and its colour carrying the
    // dominant state — the same signal the marker in the title row draws. The host's animation ref goes
    // HERE, because the frame is always on screen while a time-based cell is drawn inside it.
    /** The border title, clamped to the measured width so it can never shear the frame. */
    const borderTitle = clampCells(chromeTitle([`${stateMarker(frameTone, phase)} ${t("scene.subagents")}`, measured.size === "" ? undefined : measured.size]), Math.max(8, measured.cols - 6))
    return surfaceFrame(kit, "frame", borderTitle, children, frameTone, clock.ref)
  }
}
