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
import { legendLines, sliceSpans } from "./graph.js"
// THE RICH PAGE THIS SLOT RENDERS. Imported here rather than the other way round: see the note in
// `createPanelComponent` — the shared chrome lives in `panel-core.ts`, so this direction is not a cycle.
import { createDagPanelComponent } from "./panel-dag.js"
import { teamGraphView } from "./subagent-scene.js"
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
  gutterCellsX,
  panelScrollGesture,
  panelScrollKey,
  panelSnapshot,
  panelText,
  panelViewportBody,
  textRow,
  toneColor,
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
 * The merged page's OWN panel icon: EXACTLY ONE display cell, which the host enforces at registration.
 *
 * WHY `❖` (U+2756), measured on the installed dsh-tui 0.13.0: the host's `dsh-adapter/panels.js`
 * REJECTS a descriptor whose icon is not exactly one display cell (`stringWidth(d.icon) !== 1`), and
 * its seven built-in tabs already own `≡`, `▸`, `◆`, `ⓘ`, `∿`, `⌗` and `♥`. Before this wave the
 * merged page declared NO icon at all, so the host fell back to the letter `M` and the MPD pages
 * (three of them before this wave's clause C3 merge) were not told apart at a glance. This glyph is one
 * cell under the plugin's own
 * `sanitize.cellWidth` AND under the host's own `stringWidth` — both were measured, because the two
 * measures disagree about some symbols and the host's answer is the one that decides a registration.
 *
 * AFTER THE CLAUSE C3 MERGE THIS IS THE ONLY PANEL ICON THE MERGED PAGE DECLARES — the DAG page's own
 * `◈` went with its descriptor — so the surviving pair is this `❖` and the workmate page's `⬢`.
 */
export const PANEL_ICON = "❖"

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
  /** The one-cell icon the host draws in its panel bar. */
  icon: PANEL_ICON,
  /** The sidebar width floor: an integer in the host's own 12..64 range. */
  minColumns: PANEL_MIN_COLUMNS,
  /** The ordering hint inside the host's panel bar. */
  order: PANEL_ORDER,
} as const

// THE PAGE CHROME MOVED TO `panel-core.ts` AND IS RE-EXPORTED HERE, so this module's public surface is
// unchanged for every page, arm and consumer that names these symbols on it. The DEFINITION lives in the
// core because `panel-dag.ts` draws it and this module needs `panel-dag.ts` — one definition, no cycle.
import { PANEL_FULLSCREEN_GLYPH, PANEL_FULLSCREEN_CELLS, PANEL_TITLE_ROW_ROWS, usePanelTitleRow } from "./panel-core.js"
import type { PanelTitleRowOptions } from "./panel-core.js"
export { PANEL_FULLSCREEN_GLYPH, PANEL_FULLSCREEN_CELLS, PANEL_TITLE_ROW_ROWS, usePanelTitleRow }
export type { PanelTitleRowOptions }

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
 * What a PAGE needs to draw its own chrome — the same contract on BOTH surviving MPD pages.
 *
 * It exists so the full-screen control is not a per-page invention: a page that receives no opener
 * still draws the row (the chrome stays identical everywhere) but the glyph carries no handler.
 */
export interface PanelPageOptions {
  /** Opens this page's full-screen scene; the same surface `/mpd panel` falls back to. */
  openFullscreen?: () => boolean
  /**
   * Opens the agent work page for a live subagent id; false when no page was reached.
   *
   * Forwarded to the DAG page this slot renders, which is where the second click on a pinned task lands:
   * a dep this slot received but did not pass would leave that gesture silently dead.
   */
  openAgentPage?: (agentId: string) => boolean
}

/**
 * Build the merged sidebar-panel component.
 * @param readWorkflow - reads the MPD team projection for this session's workspace; the wiring in
 *   `index.ts` passes the same reader the team surfaces use, so the two cannot drift. It is injected
 *   rather than imported so this file stays free of the scene-registration module.
 * @param options - this page's own chrome: the full-screen opener its `⤢` control calls. Optional so
 *   a caller that only wants the body (a unit arm) still gets a component; the registered page always
 *   passes one, so the control the user sees is always wired.
 * @returns a component matching the host's panel props contract.
 */
export function createPanelComponent(readWorkflow: () => TeamWorkflow | undefined, options?: PanelPageOptions): unknown {
  // THE MERGED PAGE IS THE DAG PAGE, and this is the whole of the merge (frozen clause C3): the user's
  // clause is 「DAG页作为MPD面板」 — the DAG page SERVES AS the MPD panel — so the surviving slot renders
  // `panel-dag.ts`'s rich page (frame, header + progress, legend, key-hint footer, click-to-pin detail
  // body, three layouts, badge) with the host's curated subagent rows drawn ABOVE the drawing inside that
  // same frame, and the standalone merged renderer is gone rather than kept beside it.
  //
  // WHY THE SLOT RATHER THAN THE DESCRIPTOR MOVED: `registerPanelSurface` owns the ONE routed open
  // (`openOrScene`, its four outcomes, the refusal path and the takeover arming), and every entry point —
  // `/mpd panel`, `/mpd subagents`, `/mpd dag`, `alt+a` and the Ctrl+A contact — already routes through
  // it. Keeping that route and replacing what it RENDERS is what leaves no entry point able to become a
  // dead end, which is the clause's own constraint.
  //
  // NO CYCLE: `panel-dag.ts` draws the shared chrome from `panel-core.ts`, which is where the title row
  // and the `⤢` control now live, so this module depends on that page and not the other way round.
  return createDagPanelComponent(readWorkflow, {
    ...(options?.openFullscreen === undefined ? {} : { openFullscreen: options.openFullscreen }),
    ...(options?.openAgentPage === undefined ? {} : { openAgentPage: options.openAgentPage }),
  })
}

/** What the panel surface needs from the rest of the plugin. */
export interface PanelDeps {
  /** Whether the row config contributes this surface at all (the `panel` knob, default true). */
  enabled: boolean
  /** Reads the MPD team projection for the calling session's workspace, per call. */
  readWorkflow(): TeamWorkflow | undefined
  /** Opens the existing full-screen merged scene; the fallback this wave must never lose. */
  openMergedScene(): boolean
  /**
   * Opens the agent work page for a live subagent id; false when no page was reached.
   *
   * Optional because the gesture belongs to the page this slot renders (`AC6`'s second click on a pinned
   * task), and a caller that only wants the body — a unit arm — passes none.
   */
  openAgentPage?(agentId: string): boolean
  /**
   * Opens the full-screen surface the rendered page's own `⤢` control calls.
   *
   * SEPARATE FROM {@link PanelDeps.openMergedScene} ON PURPOSE (frozen clause C5): the route's fallback
   * and the page's `⤢` are two different questions. The route asks "which full-screen view carries this
   * request when the panel cannot open?" — the merged subagents scene, as before. The `⤢` asks "which
   * full-screen view carries THIS PAGE's appearance?" — and the reader must not fall from a rich page
   * into a bare one, so a page whose central gesture is click-to-pin names a surface that draws the pin.
   * Absent means the route's own fallback is used, which is the honest degradation for a caller that has
   * only one surface to offer.
   */
  openFullscreenScene?(): boolean
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
        // The `⤢` control the page draws itself calls THIS opener — the same full-screen merged scene
        // every other routed open falls back to, so the button and the fallback cannot name two
        // different surfaces.
        component: createPanelComponent(deps.readWorkflow, {
          openFullscreen: deps.openFullscreenScene ?? ((): boolean => deps.openMergedScene()),
          ...(deps.openAgentPage === undefined ? {} : { openAgentPage: deps.openAgentPage }),
        }),
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
