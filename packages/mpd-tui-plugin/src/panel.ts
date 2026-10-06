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
import { cellWidth } from "./sanitize.js"
import { legendLines } from "./graph.js"
import { subagentSectionRows, teamGraphView } from "./subagent-scene.js"
import type { TeamWorkflow } from "./team-state.js"
import {
  clampScroll,
  graphRow,
  legendLinesFor,
  PANEL_CHROME_ROWS,
  panelFrame,
  panelKit,
  panelKeysArmed,
  panelKeyEvent,
  panelContentWidth,
  panelFloorColumns,
  panelScrollKey,
  panelSnapshot,
  panelText,
  panelViewportBody,
  textRow,
  usePanelKeys,
  usePanelSize,
  usePanelTick,
  usePanelViewport,
  type PanelKit,
  type PanelPropsLike,
} from "./panel-core.js"
import { t } from "./i18n.js"

/** The slug the panel is registered under; the HOST prefixes it with this activation's plugin id. */
export const PANEL_SLUG = "team"

/** The panel's display title, drawn by the host in the sidebar's own panel bar. */
export const PANEL_TITLE = "MPD"

/**
 * The sidebar width floor the descriptor ASKS THE HOST FOR: the host's own minimum, never more.
 *
 * WHY 28 AND NOT 32 — the same measured trap `dag-theme.ts`'s `DAG_PANEL_MIN_COLUMNS` records, and the
 * two now agree BY CONSTRUCTION (this value is that contract's own floor for a merged page). The host's
 * `components/sidePanel/PanelHost.js` computes `tooNarrow = def.minColumns !== undefined && width <
 * def.minColumns` and, when true, renders a `panel-too-narrow` notice INSTEAD OF the page's body, while
 * `components/sidePanel/dimensions.js` puts the panel column at exactly 28 cells at the split
 * threshold. A descriptor asking for 32 therefore creates a BAND of terminal widths in which the
 * sidebar opens, the tab is present, and the user is shown a refusal notice instead of the team graph —
 * which is precisely the "I couldn't see it" defect this wave exists to root-cause. The host's
 * descriptor validator (`MIN_COLUMNS_FLOOR = 12` … `CEIL = 64`) accepts 32 happily, so nothing reddens
 * at registration: only a width-band test catches it.
 *
 * THE NARROW RENDERING IS OURS TO HANDLE: readability at 28 columns is a LAYOUT decision taken inside
 * the page from the width it is actually given (the DAG page's `MIN_BOX_LABEL_CELLS` gate is what makes
 * 28 usable), never a claim about how wide the host must make the column.
 */
export const PANEL_MIN_COLUMNS = 28

/** The descriptor's ordering hint inside the host's panel bar. */
export const PANEL_ORDER = 10

/**
 * How often the merged panel re-reads its two sources.
 *
 * A sidebar panel is a PASSIVE surface: the host re-renders it when it has a reason to, and the DAG
 * below reads the workspace's own record, which no host event is guaranteed to bump. The tick is the
 * same device `panel-dag.ts` uses, so one sidebar behaves like the other, and its cost is one integer
 * per tick.
 */
const PANEL_REFRESH_MS = 1000

/** The row budget this page assumes when the host reports no height at all. */
const MERGED_FALLBACK_ROWS = 24

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

/**
 * The host kit this page requires before it renders at all: the host's React and the two components a
 * row is built from. The whole narrowing (props -> kit), the containment of `host.snapshot()` and the
 * one-hook-per-render discipline live in `panel-core.ts`, because the DAG and workmate pages apply the
 * same three rules and a second copy of them is how two surfaces start to disagree.
 */
export type { PanelKit, PanelPropsLike }

/**
 * Wrap one panel sentence to the cells this panel actually has.
 *
 * The render boundary for TYPED text, as opposed to a drawing row: `graph.ts` lays its own rows out and
 * clamps them, while a sentence written here has no idea how narrow the sidebar is. Clamping it would
 * cut the sentence mid-word — and the empty state exists precisely to EXPLAIN something — so it wraps
 * on word boundaries instead, and a single word too long for the panel is the only thing ever cut.
 * @param text - the sentence.
 * @param cols - the cells available on a row.
 * @returns the rows, in print order; at least one, even for an empty sentence.
 */
function wrapPanelLines(text: string, cols: number): string[] {
  /** The usable width; a nonsense width still has to produce one row. */
  const width = Math.max(8, Math.floor(Number.isFinite(cols) ? cols : 8))
  /** The sentence, as one sanitized line. */
  const flat = panelText(text)
  if (flat === "") return [""]
  /** The rows, filled one word at a time. */
  const lines: string[] = []
  /** The row being filled. */
  let current = ""
  for (const word of flat.split(" ")) {
    if (word === "") continue
    /** The row this word would produce. */
    const candidate = current === "" ? word : `${current} ${word}`
    // ONE CELL IS RESERVED for the continuation space (see the core's `textRow`): a row that carries
    // the sentence on keeps its trailing space, so a row filled to the last cell would overflow by one.
    if (current !== "" && cellWidth(candidate) + 1 > width) {
      lines.push(current)
      current = word
      continue
    }
    current = candidate
  }
  if (current !== "") lines.push(current)
  return lines
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
    const kit: PanelKit | undefined = panelKit(props?.React, props?.ui)
    if (kit === undefined) {
      // THE ONE EARLY EXIT, BEFORE any hook: without the host kit there is nothing to draw with, and
      // rendering `null` is what keeps the host's reconciler alive. Because the kit is proved first,
      // the number of hook calls below is invariant across renders on a given host.
      return null
    }
    /** The host's React instance. */
    const React = kit.React
    /** The host's ui kit. */
    const ui = kit.ui
    /** The panel's measured geometry; the single geometry hook call of this component. */
    const measured = usePanelSize(ui, panelFloorColumns("merged"))
    /** The cells this page may DRAW IN: the reported width minus the frame's own two border cells. */
    const contentCols = panelContentWidth(measured.cols)
    /**
     * The row width. It is the MEASURED panel width and nothing else, which is the same budget the
     * pre-frame panel used: the host's border is drawn by the host, outside the content box it measures
     * with its own `useTerminalSize`, so subtracting a frame inset here would spend two of a narrow
     * sidebar's cells on nothing.
     */
    const width = Math.max(1, contentCols)
    // THE ROWS ARE READ PER RENDER, not kept in state: `host.snapshot()` is the host's own curated,
    // already-immutable projection, and a copy here would be a second source of truth for it. The MPD
    // team projection is read the same way, through the injected reader.
    /** The host's curated snapshot, or undefined when this build exposes none. */
    const snapshot = panelSnapshot(props?.host)
    /** The DAG's own projection for this workspace, undefined when there is no team to draw. */
    let workflow: TeamWorkflow | undefined
    try {
      workflow = readWorkflow()
    } catch {
      workflow = undefined
    }
    /** The pin: the task a click (or Enter) selected, whose facts are shown below the drawing. */
    const pinned = React.useState(undefined)
    /** The pinned task id, when the state cell holds one. */
    const pinnedId = typeof pinned[0] === "string" ? (pinned[0] as string) : undefined
    /** Moves the pin. */
    const setPinned = pinned[1] as (next: unknown) => void
    // THE PANEL OWNS A TICK. Nothing else re-renders a sidebar panel, so a page that reads its state per
    // render would otherwise show whatever was true when the user opened it (frozen clause R13).
    usePanelTick(kit, PANEL_REFRESH_MS, true)
    /** The DAG box for the width THIS panel measured, undefined when there is no team to draw. */
    const view = teamGraphView(workflow, width)
    /** The tasks that depend on each task, so the pinned body can name them. */
    const dependentsOf = (id: string): string[] => (workflow?.tasks ?? []).filter((task) => task.dependencies.includes(id)).map((task) => task.id)
    /** The task the pin names, when that task is still on the board. */
    const pinnedTask = pinnedId === undefined ? undefined : (workflow?.tasks ?? []).find((task) => task.id === pinnedId)
    /** Whether the page currently holds the keyboard. */
    const keysArmed = panelKeysArmed(props?.focused, props?.visible, props?.host)
    /** The page's self-windowed viewport (see the body's own note: the host's ScrollBox has no `ref`). */
    /** The sizes the hook and every later closure read; written by this render, before anything reads it. */
    const sizes = { contentRows: 1, viewportRows: 1 }
    /** The window height this page affords, from the height the host reported (its legend and footer are
     * drawn OUTSIDE the window, which is why they are subtracted here). */
    const windowRows = Math.max(1, (measured.rows ?? MERGED_FALLBACK_ROWS) - PANEL_CHROME_ROWS)
    /** The body's ONE scroll position: this page's keys and wheel both drive this handle. */
    const viewport = usePanelViewport(kit, () => sizes)
    /** The lines the page actually drew, which is what the keymap walks. */
    const drawnLines = view === undefined ? [] : view.lines
    // THE KEYMAP IS THE DAG PAGE'S OWN READING, applied to this surface too: the panel is the same
    // picture, so `Esc` must clear a pin here exactly as it does there. An unhandled key is left to the
    // host's own panel navigation.
    usePanelKeys(kit, props?.host, keysArmed, (event: unknown): void => {
      /** The press, narrowed once. */
      const bare = panelKeyEvent(event)
      if (bare === undefined) return
      /** The host's key flags. */
      const flags = bare.key ?? {}
      // THE VIEWPORT KEYS: this page binds NO focus keys (its pin is a click, and `Esc` clears it), so
      // the standard scroll keys AND `↑↓`/`jk` are free here — the merged page scrolls with the same
      // keys a reader would try first, and nothing else competes for them.
      /** The page-key gesture, which is the one with no competing meaning anywhere. */
      const gesture = panelScrollKey(bare)
      /** The typed characters, for the plain scroll keys this page can afford to answer. */
      const input = bare.input
      /** Whether this press moves the window DOWN by one row. */
      const down = flags.downArrow === true || input === "j" || input === "J"
      /** Whether this press moves the window UP by one row. */
      const up = flags.upArrow === true || input === "k" || input === "K"
      if (gesture !== undefined || down || up) {
        if (bare.preventDefault !== undefined) bare.preventDefault()
        if (gesture === "top") viewport.scrollTo(0)
        else if (gesture === "bottom") viewport.scrollTo(Number.MAX_SAFE_INTEGER)
        else if (gesture === "pageUp") viewport.scrollBy(-viewport.viewportRows)
        else if (gesture === "pageDown") viewport.scrollBy(viewport.viewportRows)
        else viewport.scrollBy(down ? 1 : -1)
        return
      }
      /** Whether this press asks for the pin to be cleared. */
      const escape = flags.escape === true || input === "\u001b"
      if (!escape) return
      if (pinnedId === undefined) return
      if (bare.preventDefault !== undefined) bare.preventDefault()
      setPinned(undefined)
    })

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
          panelText(row.text),
        ),
      )
    }
    // The divider separates the two sources, so the host's rows are never read as MPD's own.
    if (typeof ui.Divider === "function") children.push(React.createElement(ui.Divider, { key: "sep" }))
    else children.push(React.createElement(ui.Text, { key: "sep", dimColor: true }, panelText("─")))
    // (b) THE MPD DEPENDENCY DAG — the same box `graph.ts` lays out for the full-screen scene, for the
    // width THIS panel measured.
    if (view === undefined) {
      // THE EMPTY STATE NAMES THE CALL THAT FILLS IT (frozen clause R10). The sentence is WRAPPED to the
      // measured width rather than clamped: a sidebar is 28-40 cells, and a panel that cut this line to
      // `task dependency graph: no team i` would answer the question it was asked with half a word.
      /** The empty state's sentences, each wrapped to this panel's own width. */
      const empty = wrapPanelLines("task dependency graph: no team in this workspace — `agent_teams_plan` stages one", width)
      for (let index = 0; index < empty.length; index += 1) {
        children.push(textRow(kit, empty[index], { key: `graphhead-${index}`, dim: true, maxCells: width, joinNext: index < empty.length - 1 }))
      }
    } else {
      children.push(textRow(kit, `task dependency graph${view.mode === "rail" ? " (rail)" : ""}`, { key: "graphhead", dim: true, maxCells: width }))
      for (let index = 0; index < view.lines.length; index += 1) {
        // The spans go through WITHOUT a second cell clamp, exactly as the full-screen scene draws them:
        // `graph.ts` already applies `clampCells(stripControl(...))` at layout time, and re-clamping here
        // would cut the row's own multi-span geometry twice.
        /** The task this row belongs to, when the pointer could land on one. */
        const hit = view.hits.find((candidate) => index >= candidate.row && index <= candidate.rowEnd)
        children.push(
          hit === undefined
            ? graphRow(kit, view.lines[index], { key: `graph-${index}`, cols: width })
            : graphRow(kit, view.lines[index], {
                key: `graph-${index}`,
                cols: width,
                onClick: (): void => {
                  // THE CLICK RESOLVES THROUGH THE DRAWING'S OWN HIT RECTANGLE, never through arithmetic
                  // on the pointer: the closure already knows which task this row belongs to.
                  setPinned(hit.taskId)
                },
              }),
        )
      }
      // THE PINNED DETAIL BODY (frozen clause R11): the same ten facts the DAG page prints, in the same
      // fixed order, read from the board rather than from the drawing (the drawing carries no verdict).
      if (pinnedTask !== undefined) {
        children.push(textRow(kit, `◆ ${pinnedTask.id}`, { key: "pin-head", tone: "focus", bold: true, maxCells: width }))
        /** The pinned task's own facts, in the order the DAG page prints them. */
        const facts: Array<[string, string]> = [
          ["id", pinnedTask.id],
          ["kind", pinnedTask.kind ?? "—"],
          ["visual", pinnedTask.visual],
          ["verdict", pinnedTask.verdict ?? "—"],
          ["failedBy", pinnedTask.failedDependencies.length === 0 ? "—" : pinnedTask.failedDependencies.join(",")],
          ["owner", pinnedTask.assignee ?? "—"],
          ["attempt", pinnedTask.attempt === undefined ? "—" : String(pinnedTask.attempt)],
          ["round", pinnedTask.round === undefined ? "—" : String(pinnedTask.round)],
          ["blockedBy", pinnedTask.dependencies.length === 0 ? "—" : pinnedTask.dependencies.join(",")],
          ["dependents", dependentsOf(pinnedTask.id).join(",") === "" ? "—" : dependentsOf(pinnedTask.id).join(",")],
        ]
        for (const [label, value] of facts) children.push(textRow(kit, `${label} ${value}`, { key: `pin-${label}`, dim: true, maxCells: width }))
      }
    }
    // THE LEGEND (frozen clause R6) sits under the DAG in this panel's own width budget: `graph.ts`
    // owns the arrow sentence, the shared core adds the STATE KEY read out of `dag-theme.ts` — the line
    // that tells `blocked ○` apart from `open ○`, which share a glyph by design.
    /** The drawing module's own arrow/focus lines, for the width this panel measured. */
    let arrow: string[] = []
    try {
      arrow = legendLines(width)
    } catch {
      arrow = []
    }
    /** The legend lines for this width: the drawing's own sentences, then the state key. */
    const legend = legendLinesFor(width, arrow)
    for (let index = 0; index < legend.length; index += 1) {
      children.push(textRow(kit, legend[index], { key: `legend-${index}`, dim: true, maxCells: width }))
    }
    // THE FOOTER (frozen clause R6): the one hint this panel actually has. It does NOT claim keys the
    // merged page never handles — the "+"/"-" pair stays `/mpd`'s and the host's own.
    children.push(textRow(kit, "merged view · /mpd panel opens it full-screen", { key: "keys", dim: true, maxCells: width }))
    // ── THE SELF-WINDOWED BODY ──────────────────────────────────────────────
    // Same device as the other two pages, and here it is also what makes the SCROLLBAR possible at all:
    // the host strips `ref` from the panel's `ScrollBox`, so a panel can neither read a scroll position
    // nor command one. This page owns its own single `offset`, so the gutter beside it is drawn from a
    // number it actually knows.
    /** The page's content height, in rows. */
    const contentRows = Math.max(children.length, 1)
    /** The clamped band for this render. */
    const band = clampScroll(viewport.offset, contentRows, viewport.viewportRows)
    /** This render's viewport, with the band the REAL row count produces. */
    // Publish this render's measurements, which is what every getter and every later closure clamps against.
    sizes.contentRows = contentRows
    sizes.viewportRows = windowRows
    /** The same handle, named for what it does here: the window this render draws. */
    const scroller = viewport
    /** The visible slice of the body, inside this page's own wheel handler. */
    const scrolled = React.createElement(ui.Box, { key: "scroll", flexDirection: "column", onWheel: (event: unknown): void => scroller.onWheel(event) }, ...children.slice(viewport.offset, viewport.offset + viewport.viewportRows))
    /** The visible slice plus its reserved gutter column. */
    const body = panelViewportBody(kit, [scrolled], scroller)
    return panelFrame(kit, PANEL_TITLE, body as unknown[])
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
