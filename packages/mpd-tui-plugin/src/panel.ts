// THE SIDEBAR PANEL — the merged view contributed through dsh-tui 0.13.0's panel seam.
//
// WHAT IT RENDERS, top to bottom (frozen clause R2/R3):
//   (a) the HOST's curated subagent rows, read from the panel props' own `host.snapshot().subagents`
//       — the array the host's dashboard renders. MPD teammates are ordinary continuable subagents,
//       so that array already holds them and no second data source is invented;
//   (b) the MPD dependency DAG for the current workspace's team, drawn by `graph.ts` for the width
//       the props' own `ui.useTerminalSize()` reports.
//
// REUSE, NOT A SECOND RENDERER. The host's rows go through `subagentSectionRows` and the DAG through
// `teamGraphView`/`legendLines` — the SAME projections the full-screen merged scene renders
// (`subagent-scene.ts`). This file owns the LAYOUT of the sidebar (a titled, scrolling column with a
// divider), never a re-implementation of a row or of a box glyph.
//
// WHY NO `compact` (frozen, and deliberate): dsh-tui 0.13.0 VALIDATES and STORES a descriptor's
// `compact` slot but does NOT mount its render slot (the host's own TODO §18.1). Declaring one would
// claim a surface that cannot render and would make the registration read as a promise this build
// cannot keep, so the descriptor below carries `component` only.
//
// THE SINGLE-REACT RULE. A panel component is rendered by the host with the host's OWN React and ui
// kit, exactly as a scene is, so this file imports neither React nor ink: every hook and element goes
// through `props.React` / `props.ui` (`ui.Box`, `ui.Text`, `ui.ScrollBox`, `ui.Divider`,
// `ui.useTerminalSize`). A second React copy under the host's reconciler is the failure this rule
// exists to prevent.
//
// DEFENSIVE RULES (the host renders a plugin panel inside its own error boundary — a throw is
// contained, but the surface is lost):
//   · the props are `unknown`-typed at the boundary and narrowed: a host build that hands no usable
//     React, no ui kit or no snapshot renders `null` instead of crashing the reconciler;
//   · `host.snapshot()` is called behind a guard and inside a contained try, so an unreadable host
//     state costs the subagent section, never the panel;
//   · `useTerminalSize` is called ONCE per render and only when the kit exposes it, so the hook order
//     never moves between renders;
//   · every string read from the host crosses `sanitize.ts` before it reaches a `ui.Text`.
//
// THIS FILE NAMES NO `ctx.tui*` SERVICE. The registration, the final id and the open request all go
// through the `TuiAdapter` (`packages/mpd-tui-adapter-plugin`), which is the ONE place a DSH-TUI
// service may be named (AGENTS.md §6; enforced by `test/no-direct-tui-access.test.ts`).
import type { Log } from "./log.js"
import type { PanelOpenResult, PanelRegistrationHandle, SeamOutcome, TuiAdapter } from "./types.js"
import { clampCells, stripControl } from "./sanitize.js"
import { GRAPH_THEME, legendLines, type GraphView } from "./graph.js"
import { subagentSectionRows, teamGraphView } from "./subagent-scene.js"
import type { TeamWorkflow } from "./team-state.js"
import { t } from "./i18n.js"

/** The slug the panel is registered under; the HOST prefixes it with this activation's plugin id. */
export const PANEL_SLUG = "team"

/** The panel's display title, drawn by the host in the sidebar's own panel bar. */
export const PANEL_TITLE = "MPD"

/** The sidebar width floor the descriptor asks for: wider than the host's own 28 default. */
export const PANEL_MIN_COLUMNS = 32

/** The descriptor's ordering hint inside the host's panel bar. */
export const PANEL_ORDER = 10

/** The column count the DAG is laid out for before the host has measured the panel. */
const FALLBACK_COLS = PANEL_MIN_COLUMNS

/** The cell budget of one drawn row — the same bound the full-screen scenes apply to their rows. */
const ROW_MAX_CELLS = 4000

/**
 * The panel descriptor, frozen at module scope.
 *
 * `apiVersion` is exactly 1 because the host refuses every other value, `id` is the single lowercase
 * slug the host requires, and `component` is filled per registration by {@link registerPanelSurface}
 * (it closes over this row's own workflow reader, which no module-scope constant could).
 */
export const PANEL_DESCRIPTOR_FROZEN = {
  /** The host's panel API version (0.13.0 accepts exactly 1). */
  apiVersion: 1,
  /** The single lowercase slug the host prefixes with this activation's plugin id. */
  id: PANEL_SLUG,
  /** The title the host stores and draws (non-empty, at most 80 cells). */
  title: PANEL_TITLE,
  /** The sidebar width floor: an integer in the host's own 12..64 range. */
  minColumns: PANEL_MIN_COLUMNS,
  /** The ordering hint inside the host's panel bar. */
  order: PANEL_ORDER,
} as const

/**
 * Whether the LEGACY Ctrl+A host-input contact may intercept a press.
 *
 * This is the ONE place the arming rule lives, so it can be read at apply time AND per press with the
 * same semantics (frozen clauses R4/R5). The SEAM WINS over every configuration: on a host that
 * offers the sidebar panel seam (dsh-tui 0.13.0+) the contact is never allowed to intercept, because
 * `alt+a` and `/mpd panel` are the entry points and Ctrl+A belongs to the host's own dashboard. Only
 * on a host WITHOUT the seam does the knob decide, and there the saved value (the `/settings` row)
 * outranks the row config's floor.
 *
 * THE PER-PRESS READ IS NOT REDUNDANT. The adapter binds the seam through a DEFERRED inject, so a
 * binding that lands after this row applied would leave an apply-time-only gate armed on a host that
 * does offer the seam; reading it per press makes the condition self-correcting. It is a pure
 * function for exactly that reason: both readings, and their precedence, are testable without a host.
 * @param seamBound - the adapter's arbiter: whether the sidebar panel seam is bound right now.
 * @param savedKnob - the live `tui.dashboardKey` value, when a config layer answered.
 * @param floor - the mpd-tui row config's own `dashboardKey` value.
 * @returns whether the contact may intercept the next Ctrl+A press.
 */
export function takeoverArmed(seamBound: boolean, savedKnob: boolean | undefined, floor: boolean): boolean {
  if (seamBound) return false
  return typeof savedKnob === "boolean" ? savedKnob : floor
}

/** The React surface a panel component uses, as the host's own React must expose it. */
interface PanelReactLike {
  /** Creates one element; the panel never imports React itself. */
  createElement(type: unknown, props?: Record<string, unknown> | null, ...children: unknown[]): unknown
  /** One state cell (the host React's own `useState`). */
  useState(initial: unknown): [unknown, (next: unknown) => void]
  /** One effect (the host React's own `useEffect`). */
  useEffect(effect: () => unknown, deps?: readonly unknown[]): void
  /** The host React's own `useRef`. */
  useRef(initial: unknown): { current: unknown }
}

/** The ui kit a panel component uses, as the host's own TuiPanelUi must expose it. */
interface PanelUiLike {
  /** The host's column box. */
  Box?: unknown
  /** The host's text row. */
  Text?: unknown
  /** The host's scrollable column, when this build exposes it. */
  ScrollBox?: unknown
  /** The host's horizontal rule, when this build exposes it. */
  Divider?: unknown
  /** The panel-size hook; the ONLY geometry source a panel has. */
  useTerminalSize?(): { columns?: unknown; rows?: unknown }
}

/** The narrow, structural panel props shape this file reads. */
interface PanelPropsLike {
  /** The host's own React instance. */
  React?: unknown
  /** The host's panel ui kit. */
  ui?: unknown
  /** The host's panel host API (the curated snapshot lives behind it). */
  host?: unknown
}

/** The host kit, once the guard has proved both halves usable. */
interface PanelKit {
  /** The host's React instance. */
  React: PanelReactLike
  /** The host's ui kit, with the two components the body requires already proved callable. */
  ui: PanelUiLike
}

/** The panel's measured geometry, with the documented fallback applied. */
interface PanelMeasured {
  /** The column count the DAG lays itself out for. */
  cols: number
}

/**
 * Prove the host handed a usable React instance and ui kit.
 * @param React - the props' React field.
 * @param ui - the props' ui field.
 * @returns the two, typed, or undefined when the host kit is unusable.
 */
function panelKit(React: unknown, ui: unknown): PanelKit | undefined {
  if (React === null || React === undefined || ui === null || ui === undefined) return undefined
  if (typeof (React as { createElement?: unknown }).createElement !== "function") return undefined
  /** The ui kit's own two required components, before anything is drawn with it. */
  const kit = ui as PanelUiLike
  if (typeof kit.Box !== "function" || typeof kit.Text !== "function") return undefined
  // The cast is sound because the members above were proved, and the host hands its own React and ui
  // kit across a JS boundary with no shared type. Every ADDITIONAL field read off them
  // (`ScrollBox`, `Divider`, `useTerminalSize`) is feature-detected at its own use site, so a leaner
  // host build degrades instead of throwing.
  return { React: React as PanelReactLike, ui: kit }
}

/**
 * Measure the panel through the host's own hook — ONCE per render, so the hook order never moves.
 * @param ui - the host ui kit.
 * @returns the measured geometry, with the documented fallback applied.
 */
function measurePanel(ui: PanelUiLike): PanelMeasured {
  if (typeof ui.useTerminalSize !== "function") return { cols: FALLBACK_COLS }
  try {
    /** The host's own measurement; a throwing hook degrades to the fallback. */
    const size = ui.useTerminalSize()
    /** The reported column count, kept only when it is a usable positive number. */
    const columns = size?.columns
    if (typeof columns !== "number" || !Number.isFinite(columns) || columns <= 0) return { cols: FALLBACK_COLS }
    return { cols: Math.floor(columns) }
  } catch {
    return { cols: FALLBACK_COLS }
  }
}

/**
 * One panel row as a renderable fragment — the render boundary of this file.
 *
 * `stripControl` + `clampCells` (never `scalarText`, which would collapse the DAG's indentation), the
 * same pair the full-screen scenes apply to every untrusted row.
 * @param value - the row text.
 * @returns the sanitized, clamped row; never throws.
 */
function safeRow(value: string): string {
  try {
    return clampCells(stripControl(value), ROW_MAX_CELLS)
  } catch {
    return ""
  }
}

/**
 * Read the host's curated snapshot through its own API.
 *
 * The whole read is contained: a host build without `snapshot`, or a snapshot that throws, is "no
 * host rows" rather than a lost panel. The returned value is handed to `subagentSectionRows`
 * UNCHANGED — that projection reads `subagents` defensively and is the ONE reader of those rows, so
 * the sidebar and the full-screen scene cannot describe one subagent differently.
 * @param host - the panel props' `host` field.
 * @returns the snapshot, or undefined when this host exposes none.
 */
function readSnapshot(host: unknown): unknown {
  if (host === null || host === undefined) return undefined
  /** The host API, before its `snapshot` member is trusted. */
  const api = host as { snapshot?: unknown }
  if (typeof api.snapshot !== "function") return undefined
  try {
    // Called AS A METHOD on the host's own object: the documented form, and the one that cannot lose
    // a receiver the implementation may rely on.
    return (api as { snapshot: () => unknown }).snapshot()
  } catch {
    return undefined
  }
}

/**
 * Build the merged sidebar-panel component.
 * @param readWorkflow - reads the MPD team projection for this session's workspace; the wiring in
 *   `index.ts` passes the same reader the team surfaces use, so the two cannot drift. It is injected
 *   rather than imported so this file stays free of the scene-registration module.
 * @returns a component matching the host's panel props contract.
 */
export function createPanelComponent(readWorkflow: () => TeamWorkflow | undefined): unknown {
  return function MpdTuiPanel(props: PanelPropsLike): unknown {
    /** The host's React instance and ui kit, proved usable before a single hook is called. */
    const kit = panelKit(props?.React, props?.ui)
    if (kit === undefined) {
      // The host kit is the hard contract; without it, render nothing rather than crash the
      // reconciler. (No hook has run at this point, so the hook order is never at risk.)
      return null
    }
    /** The host's React instance. */
    const React = kit.React
    /** The host's ui kit. */
    const ui = kit.ui
    /** The panel's measured geometry; the single hook call of this component. */
    const measured = measurePanel(ui)
    // THE ROWS ARE READ PER RENDER, not kept in state: `host.snapshot()` is the host's own curated,
    // already-immutable projection, and a copy here would be a second source of truth for it. The MPD
    // team projection is read the same way, through the injected reader.
    /** The host's curated snapshot, or undefined when this build exposes none. */
    const snapshot = readSnapshot(props?.host)
    /** The DAG's own projection for this workspace, undefined when there is no team to draw. */
    let workflow: TeamWorkflow | undefined
    try {
      workflow = readWorkflow()
    } catch {
      workflow = undefined
    }

    /** The elements handed to the host's ScrollBox, in render order. */
    const children: unknown[] = []
    // (a) THE HOST'S OWN SUBAGENT ROWS. `subagentSectionRows` takes the object carrying `subagents`,
    // which is why the whole snapshot is handed over rather than the array: the projection owns the
    // field read, the empty state and the counts, and this file must not re-derive any of them.
    /** The subagent section, decided in one place. */
    const section = subagentSectionRows(snapshot)
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
          },
          safeRow(row.text),
        ),
      )
    }
    // The divider separates the two sources, so the host's rows are never read as MPD's own.
    if (typeof ui.Divider === "function") children.push(React.createElement(ui.Divider, { key: "sep" }))
    else children.push(React.createElement(ui.Text, { key: "sep", dimColor: true }, safeRow("─")))
    // (b) THE MPD DEPENDENCY DAG — the same box `graph.ts` lays out for the full-screen scene, for the
    // width THIS panel measured.
    /** The DAG box, absent when the team has no task to draw. */
    const view: GraphView | undefined = teamGraphView(workflow, measured.cols)
    if (view === undefined) {
      children.push(React.createElement(ui.Text, { key: "graphhead", dimColor: true }, safeRow("task dependency graph: no team in this workspace")))
    } else {
      children.push(React.createElement(ui.Text, { key: "graphhead", dimColor: true }, safeRow(`task dependency graph${view.mode === "rail" ? " (rail)" : ""}`)))
      for (let index = 0; index < view.lines.length; index += 1) {
        // The spans go through WITHOUT `safeRow`, exactly as the full-screen scene draws them:
        // `graph.ts` already applies `clampCells(stripControl(...))` at layout time, and re-clamping
        // here would cut the row's own multi-span geometry twice.
        /** The spans of this row, each drawn in its own theme colour. */
        const spans = view.lines[index].map((span, at) => React.createElement(ui.Text, { key: `s${at}`, color: GRAPH_THEME[span.tone] }, span.text))
        children.push(React.createElement(ui.Text, { key: `graph-${index}` }, ...spans))
      }
      // THE LEGEND sits under the DAG in the SAME width budget the graph was laid out for, so a line
      // can never claim more cells than the drawing above it used. `graph.ts` owns the content (and
      // clamps it); a drawing module that refuses costs the legend, never the panel.
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
    /** The panel's scrollable column; a kit without `ScrollBox` draws the same children directly. */
    const body = typeof ui.ScrollBox === "function" ? React.createElement(ui.ScrollBox, { key: "body" }, children) : children
    return React.createElement(ui.Box, { flexDirection: "column", width: "100%", height: "100%", paddingX: 1 }, body)
  }
}

/** What the panel surface needs from the rest of the plugin. */
export interface PanelDeps {
  /** Whether the row config contributes this surface at all (the `panel` knob, default true). */
  enabled: boolean
  /** Reads the MPD team projection for the calling session's workspace, per call. */
  readWorkflow(): TeamWorkflow | undefined
  /** Opens the existing full-screen merged scene; the fallback this wave must never lose. */
  openMergedScene(): boolean
  /** Diagnostics: the file sink, never a terminal. */
  log: Log
}

/**
 * How one routed open ENDED — which of the four surfaces the user is looking at.
 *
 * The states are kept apart because they are four different facts, and the `/mpd panel`
 * sentence must not merge them: the panel opened; the panel declined the OPEN and the full-screen
 * scene opened instead; the host BOUND the seam and REFUSED the registration (S7 — a different
 * defect with a different fix from a missing seam); or this host exposes no panel seam at all and
 * the scene IS the surface.
 */
export type PanelOutcome = "opened" | "fallback" | "refused" | "unavailable"

/** The result of one routed open: which surface HANDLED the request, and the scene's own answer. */
export interface PanelOpenOutcome {
  /** The surface the request ended on. */
  readonly outcome: PanelOutcome
  /**
   * Whether the full-screen scene path opened a scene.
   *
   * It is meaningful on the two scene paths (`fallback`, `unavailable`) and always false on `opened`
   * — the panel, not the scene, is the surface then. A caller that only needs "did anything open"
   * reads `outcome === "opened" || sceneOpened`.
   */
  readonly sceneOpened: boolean
}

/** The panel surface this row exposes to its own wiring. */
export interface PanelSeam {
  /** Registers the panel; `undefined` when the row config disabled this surface. */
  readonly panel: PanelRegistrationHandle | undefined
  /** Whether the panel is registered right now (the seam is bound AND the registration confirmed). */
  registered(): boolean
  /** The FINAL host panel id, or undefined while it is unbound, refused or unread. */
  id(): string | undefined
  /** Opens the panel when it is the surface this host serves, else the full-screen scene. */
  openOrScene(): PanelOpenOutcome
  /** The registration outcome, as the row's own boot diagnostic reports it. */
  outcome(): SeamOutcome
}

/**
 * Register the sidebar panel and expose the ONE routed open both entry points use.
 *
 * The route is decided PER CALL, never at apply: the seam binds asynchronously, so a shortcut pressed
 * before the binding still has to find its surface.
 * @param tui - the DSH-TUI seam adapter (this file names no seam id of its own).
 * @param deps - the workflow reader, the full-screen scene opener and the log.
 * @returns the panel seam; `panel` is undefined only when the row config disabled the surface.
 */
export function registerPanelSurface(tui: TuiAdapter, deps: PanelDeps): PanelSeam {
  // ONE registration, at apply: the adapter queues it until the seam binds and settles it as `absent`
  // on a host that never offers the panel seam, so this call is safe on every dsh-tui build.
  /** The registration handle, undefined when the surface is not part of this composition. */
  const panel: PanelRegistrationHandle | undefined = deps.enabled
    ? tui.registerPanel({
        ...PANEL_DESCRIPTOR_FROZEN,
        component: createPanelComponent(deps.readWorkflow),
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
      return tui.skipped("panels", "the sidebar panel is disabled by the mpd-tui row config (panel: false)").outcome()
    },
    openOrScene: (): PanelOpenOutcome => {
      /** The final host id, read PER CALL: the seam may have bound since the last press. */
      const id = panel?.id()
      if (!tui.panelSeamBound() || id === undefined) {
        // No panel seam (a pre-0.13.0 host), OR no confirmed registration yet. A BOUND seam whose
        // handle reports a REFUSAL is its own fact (S7): the host has the seam and turned the
        // descriptor down, so reporting "this host exposes no panel seam" would name the wrong fix.
        const refused = panel !== undefined && tui.panelSeamBound() && panel.outcome().state === "refused"
        // Either way the full-screen scene is the surface, exactly as it was before this wave.
        return { outcome: refused ? "refused" : "unavailable", sceneOpened: deps.openMergedScene() }
      }
      if (typeof tui.panels()?.open !== "function") {
        // A BOUND SEAM WITH NO `open` MEMBER cannot satisfy this request at all — it is not a refusal
        // by the host and not a queued call, so it must not be reported as either (measured reading of
        // the 0.13.0 contract: `open` is optional). The scene opens and the line says the build cannot
        // open panels.
        deps.log.debug(`the bound panel seam exposes no open() member; using the full-screen merged scene`)
        return { outcome: "unavailable", sceneOpened: deps.openMergedScene() }
      }
      /** The host's answer; `opened()` is a boolean only because the seam was bound at call time. */
      const result: PanelOpenResult = tui.openPanel(id)
      if (result.opened() === true) return { outcome: "opened", sceneOpened: false }
      // A REFUSAL IS NOT A NO-OP (frozen clause R4): the host said false — a rate-limited open, an id
      // it no longer owns, or no live panel consumer — so the user gets the full-screen scene, and the
      // line says why. `undefined` (queued) is NOT a refusal and must not trigger this branch.
      deps.log.debug(`panel open(${id}) refused; falling back to the full-screen merged scene`)
      return { outcome: "fallback", sceneOpened: deps.openMergedScene() }
    },
  }
}

/**
 * The status sentence `/mpd panel` prints, in the active language.
 * @param outcome - how the routed open ended.
 * @param id - the final host panel id, when one was discovered.
 * @returns the user-visible line.
 */
export function panelStatusLine(outcome: PanelOutcome, id: string | undefined): string {
  if (outcome === "opened") return t("panel.opened", { id: id ?? "?" })
  if (outcome === "fallback") return t("panel.fallback", { id: id ?? "?" })
  // A refusal has no id to name (the host accepted nothing), and its sentence is NOT the
  // "no panel seam" one: it says the seam exists and the registration was turned down (S7).
  if (outcome === "refused") return t("panel.refused")
  return t("panel.unavailable")
}
