// Ctrl+A TAKEOVER — MPD's merged panel instead of the host's own subagent dashboard, CONDITIONALLY.
//
// THE USER'S CLAUSE, in full: pressing Ctrl+A opens MPD's merged panel (the host's real subagent rows
// plus the dependency graph) when the MPD team projection has a team with at least one task; in every
// other case the key must behave exactly as it does today and the HOST dashboard must open.
//
// WHY A HOOK AT ALL. The host's `dashboard` action owns Ctrl+A inside the Chat screen's own
// `useInput`, and no contribution kind can reach that component (measured on dsh-tui 0.12.0: the
// dashboard is a Chat-local early-return component with fixed props). The one thing a plugin CAN do
// is sit EARLIER on the same input bus: every listener reads the per-App emitter
// (`internal_eventEmitter` of the host's `StdinContext`), Node's `prependListener` puts a listener
// at the FRONT of `rawListeners` regardless of registration order, and the host's emitter loop stops
// at the first listener that called `stopImmediatePropagation()` on the host's own event object.
//
// WHERE THE COMPONENT COMES FROM. Only a component the host renders can read that context, so this
// module registers a status VIEW and renders an EMPTY `ui.Box`: the host mounts every registered view
// whenever no image preview is open, the empty Box costs zero rendered rows, and the component exists
// purely to attach (and later remove) the listener. Its row budget is 1 because the host requires an
// integer in 1..3 and REJECTS 0 — "zero visible rows" is achieved by rendering nothing, not by asking
// for a zero-row slot.
//
// THE HOST CONTACT IS NOT THIS FILE'S BUSINESS. `useStdin` comes from the adapter's `hostInput()`
// (the ONE place that may load a host internal), this file never names a `tui*` service, and every
// absence — no contact, no emitter, a foreign shape — degrades to "the key is simply not intercepted".
//
// WHEN THE TAKE-OVER ARMS (measured, dsh-tui 0.12.0 — read this before reporting "it does nothing"):
// the adapter prefers the host kit a SCENE render hands it, because the module it can import by file
// URL is NOT the instance the running host renders with. So the take-over ARMS once such a kit has
// been remembered — i.e. after any MPD scene or panel has rendered in the session — and before that
// the contact falls back to the imported module, which this host answers with nothing. Ctrl+A keeps
// its current behaviour until then, and `capabilities().hostInput.kit` names the source in force
// ("remembered" or "probed").
import type { Log } from "./log.js"
import type { PluginContextLike, SeamOutcome, TuiAdapter } from "./types.js"
import { SUBAGENT_SCENE_ID } from "./subagent-scene.js"
import type { DshTeamView } from "../../mpd-dsh-adapter-plugin/src/index.js"
import type { HostInputEmitterLike, HostStdinValue } from "../../mpd-tui-adapter-plugin/src/index.js"
import { readHostStdinValue } from "../../mpd-tui-adapter-plugin/src/index.js"
import { mpdTeamRecords, readScopedWorkflow, type MpdTeamsLike, type TeamWorkflow } from "./team-state.js"

/**
 * One mpd-owned team record, typed from THIS package's own reader.
 *
 * The record type is NOT imported from `mpd-team-core-plugin` here: `team-state.ts` already carries
 * that cross-package coupling (it is the team plane's reader), and the inventory gate that counts
 * those imports can only shrink — a second specifier for one type would grow it for nothing.
 */
type TeamRecordRow = ReturnType<typeof mpdTeamRecords>[number]

/** The status-view key the hook registers under (the host key grammar, `mpd-tui` namespace). */
export const DASHBOARD_KEY_VIEW = "mpd-tui-keyhook"

/**
 * The rows the host reserves for the hook's view.
 *
 * The host validates `maxRows` as an integer 1..3 and refuses 0, so the minimum admissible value is
 * used and the ZERO comes from the component: an empty `ui.Box` renders no rows at all.
 */
export const DASHBOARD_KEY_MAX_ROWS = 1

/**
 * The host's per-App input bus, as this hook uses it.
 *
 * The SHAPE belongs to the adapter (it is a host object reached through the host's React context);
 * this alias exists so the hook's own signatures read in this module's vocabulary.
 */
export type HostInputEmitter = HostInputEmitterLike

/** The input event subset this hook reads (the host's own event object carries more). */
export interface HostInputEvent {
  /** The character the keypress produced; the takeover only ever acts on `"a"`. */
  input?: unknown
  /** The modifier flags the host parsed for this keypress. */
  key?: { ctrl?: unknown; meta?: unknown }
  /** The host's immediate-propagation switch; the emitter honours it only on its OWN event type. */
  stopImmediatePropagation?: () => void
}

/**
 * Everything the hook needs, injected rather than resolved here.
 *
 * The injection is what makes the three conditions — the toggle, the team projection and the scene's
 * availability — testable without a terminal, a React renderer or a live host.
 */
export interface DashboardKeyDeps {
  /** Whether the takeover is enabled right now (the settings knob first, the row config as floor). */
  enabled(): boolean
  /** Whether MPD's merged panel is registered in this composition (else the key must pass through). */
  mergedSceneAvailable(): boolean
  /** Reads the MPD team projection exactly as the scenes read it; undefined means unreadable. */
  readWorkflow(): TeamWorkflow | undefined
  /** Opens MPD's merged panel; false when the scene seam refused the open. */
  openMergedScene(): boolean
  /** Diagnostics: the file sink, never a terminal. */
  log: Log
}

/** The hook's handle: the measured outcome of the view registration that carries it. */
export interface DashboardKeySeam {
  /** The registration's outcome, reported in the row's own outcome list. */
  outcome(): SeamOutcome
}

/**
 * The hook subset of the host's React instance.
 *
 * `useState` is the re-render trigger for a contact that binds AFTER the first render, `useEffect`
 * owns the listener's lifetime, and `createElement` builds the empty Box. Nothing else is used, so a
 * host React that carries these three is enough.
 */
interface ReactHooksLike {
  /** The host's `useState`, used only as a re-render counter. */
  useState<T>(initial: T): [T, (next: T | ((previous: T) => T)) => void]
  /** The host's `useEffect`; the cleanup removes the listener. */
  useEffect(effect: () => (() => void) | undefined, deps?: readonly unknown[]): void
  /** The host's `createElement`, used for the empty Box. */
  createElement(type: unknown, props: Record<string, unknown>, ...children: unknown[]): unknown
}

/** Props the host passes to a rich status view: its React instance and the pointer-only ui kit. */
export interface StatusViewPropsLike {
  /** The TUI's own React instance — every hook and element must use it. */
  React?: unknown
  /** The TUI's ui kit (`Box`, `Text`, `useTerminalSize`); it exposes NO input hook, by design. */
  ui?: unknown
}

/**
 * Narrow the host's React instance to the hook subset this view uses.
 * @param value - the `React` prop the host passed.
 * @returns the hooks, or undefined when this host did not pass a usable instance.
 */
function reactHooksOf(value: unknown): ReactHooksLike | undefined {
  if (value === undefined || value === null) return undefined
  /** The candidate viewed structurally; each member is proved before it is called. */
  const candidate = value as Partial<ReactHooksLike>
  if (typeof candidate.useState !== "function") return undefined
  if (typeof candidate.useEffect !== "function") return undefined
  if (typeof candidate.createElement !== "function") return undefined
  // The cast is sound because the three members above were proved callable; the host's own type is
  // not importable from this package (a host internal never is).
  return candidate as ReactHooksLike
}

/**
 * Read the host's input bus: the adapter's host contact plus its LIVE-context check.
 *
 * The hook is called during a RENDER, which is the only place a React context may be read; the
 * contact itself is a cached module, so this costs one context read and no I/O. The returned value
 * carries EITHER the bus or one sentence saying why there is none — the shape check that tells a live
 * provider apart from the context DEFAULT (a foreign module instance, where a listener would attach
 * to an emitter nothing feeds) lives in the adapter, with the rest of the host contact.
 * @param tui - the DSH-TUI seam adapter.
 * @returns the bus, or the one reason it cannot be used.
 */
export function readHostInputBus(tui: TuiAdapter): HostStdinValue {
  try {
    return readHostStdinValue(tui.hostInput()?.useStdin())
  } catch (error) {
    // A hook that throws is a normal absence (a foreign context, a host without the contact): the
    // takeover stays absent instead of taking the render — and the session — down with it.
    return { detail: `the host stdin hook threw: ${String((error as Error)?.message ?? error)}` }
  }
}

/**
 * Decide ONE input event: intercept it (true) or leave it entirely to the host (false).
 *
 * The pass-through arms are the load-bearing half. The event is touched ONLY on the intercept path —
 * no `stopImmediatePropagation` without a team to show, no scene open, no mutation of a foreign
 * object — so a workspace without a team keeps the host's dashboard exactly as it is today.
 * @param event - the event the host emitted on its input bus.
 * @param deps - the toggle, the team reader, the scene opener and the log.
 * @returns true when the event was consumed by the takeover.
 */
export function interceptDashboardKey(event: unknown, deps: DashboardKeyDeps): boolean {
  /** The event read structurally; a nullish or foreign value is a pass-through. */
  const candidate = event as HostInputEvent | undefined
  if (candidate === undefined || candidate === null) return false
  if (candidate.input !== "a") return false
  /** The modifier flags; the takeover owns Ctrl+A and never a meta/alt combination. */
  const key = candidate.key
  if (key === undefined || key === null) return false
  if (key.ctrl !== true || key.meta === true) return false
  if (!deps.enabled()) return false
  if (!deps.mergedSceneAvailable()) return false
  /** The team projection, read at KEYPRESS time (never per render, and never cached). */
  const workflow = deps.readWorkflow()
  // A team exists only when the projection carries a head; the task count is the user's own
  // precondition ("the MPD team projection has a team AND at least one task").
  if (workflow === undefined || workflow.team === undefined || workflow.tasks.length === 0) return false
  /** The host's immediate-propagation switch, absent on a foreign event object. */
  const stop = candidate.stopImmediatePropagation
  // WITHOUT the stop the host's own handler runs on the same bus and opens its dashboard UNDER ours.
  if (typeof stop !== "function") return false
  stop.call(event)
  /** Whether the scene seam served the open; a refusal is reported, never swallowed. */
  const opened = deps.openMergedScene()
  deps.log.debug(`Ctrl+A takeover: ${opened ? "opened" : "FAILED to open"} ${SUBAGENT_SCENE_ID} (${workflow.tasks.length} task(s))`)
  return true
}

/**
 * Read the MPD team projection with the SAME rule and the SAME primitives the scenes use.
 *
 * The scenes' own reader is private to `scenes.ts` (another lane's file, and not exported), so both go
 * through the ONE session-scoped reader in `team-state.ts`: this function's only job is to resolve the
 * four sources per call and hand them over. Both surfaces therefore describe one team identically
 * instead of drifting into two answers.
 *
 * THE SESSION ID IS WHAT MAKES IT SESSION-SCOPED. The sidebar panel reads its own session id off the
 * host snapshot and passes it here; the Ctrl+A contact cannot (a status view carries no `host`), so it
 * calls this with no id and gets the MARKED workspace-level fallback — never another session's board
 * presented as the caller's own.
 * @param workspaceRoot - resolves the calling session's workspace, per call.
 * @param holds - the team ids the watchdog currently holds.
 * @param teamViews - the official team readout for that workspace, resolved per call.
 * @param teamRecords - the mpd-owned team records for that workspace, resolved per call.
 * @param teams - the `mpdTeams` face, resolved per call; undefined when this composition has no team row.
 * @param sessionId - the calling session's id, or undefined when this surface cannot read one.
 * @returns the projection, or undefined when nothing could be read; never throws.
 */
export function readDashboardWorkflow(
  workspaceRoot: () => string,
  holds: () => readonly string[],
  teamViews?: () => readonly DshTeamView[],
  teamRecords?: () => readonly TeamRecordRow[],
  teams?: () => MpdTeamsLike | undefined,
  sessionId?: string,
): TeamWorkflow | undefined {
  try {
    /** The watchdog's held team ids; empty when that read fails. */
    let holdIds: readonly string[] = []
    try {
      holdIds = holds() ?? []
    } catch {
      holdIds = []
    }
    /** The mpd-owned records for this workspace; empty when that read fails. */
    let records: readonly TeamRecordRow[] = []
    try {
      records = teamRecords?.() ?? []
    } catch {
      records = []
    }
    /** The live official views for this workspace; empty when that read fails. */
    let views: readonly DshTeamView[] = []
    try {
      views = teamViews?.() ?? []
    } catch {
      views = []
    }
    /** The `mpdTeams` face, resolved per call; undefined when the team row is not mounted. */
    let service: MpdTeamsLike | undefined
    try {
      service = teams?.()
    } catch {
      service = undefined
    }
    return readScopedWorkflow({
      workspace: workspaceRoot(),
      ...(sessionId === undefined || sessionId === "" ? {} : { sessionId }),
      holds: holdIds,
      ...(service === undefined ? {} : { teams: service }),
      records,
      views,
    })
  } catch {
    // A projection that cannot be read is "no team" for this decision, never a broken keypress.
    return undefined
  }
}

/**
 * Build the zero-row status view that attaches the takeover listener.
 *
 * The work lives in an EFFECT, never in the render path: the render calls the host's `useStdin`
 * (which is what a React context read is) and returns an empty Box, while the effect prepends the
 * listener and removes it on cleanup. The view is therefore reversible — an unload or a remount
 * leaves the host's keyboard exactly as it found it.
 * @param tui - the DSH-TUI seam adapter (the host contact).
 * @param deps - the toggle, the team reader, the scene opener and the log.
 * @returns a component matching the host's rich-status-view props.
 */
export function createDashboardKeyComponent(tui: TuiAdapter, deps: DashboardKeyDeps): unknown {
  return function MpdTuiDashboardKey(props: StatusViewPropsLike): unknown {
    /** The host's React instance; without it there is nothing to hook with. */
    const React = reactHooksOf(props?.React)
    if (React === undefined) {
      // The host kit is the hard contract; without it render nothing rather than crash the
      // reconciler. (No hook has run at this point, so the hook order is never at risk.)
      return null
    }
    /** The host's pointer-only kit; only `Box` is used, and only to render nothing. */
    const ui = props?.ui as { Box?: unknown } | undefined
    /** A re-render counter: the host contact may bind AFTER this first render. */
    const armed = React.useState(0)
    /** The counter's setter. */
    const setArmed = armed[1]
    React.useEffect(() => tui.whenHostInput(() => setArmed((previous: number) => previous + 1)), [])
    /** The host's input bus (or the ONE reason there is none), read per render: a cached module plus
     *  one context read, no I/O, and no team read — the projection is read at KEYPRESS time only. */
    const bus = readHostInputBus(tui)
    /** The bus to attach to, undefined when the read produced none. */
    const emitter = bus.emitter
    /** Why no bus is available; logged from the effect (never from the render path). */
    const unavailable = bus.detail
    React.useEffect(() => {
      if (emitter === undefined) {
        // ONE line, from the effect: a missing bus is otherwise invisible (the key simply keeps its
        // host behaviour), and a log per RENDER would flood the sink.
        if (unavailable !== undefined) deps.log.debug(`Ctrl+A takeover: ${unavailable}`)
        return undefined
      }
      /** The listener the host bus holds while this view is mounted. */
      const listener = (event: unknown): void => {
        // A THROWING handler must never reach the emitter's loop: the host dispatches input
        // synchronously, so an exception here would break the keyboard for the whole session.
        try {
          interceptDashboardKey(event, deps)
        } catch (error) {
          deps.log.debug(`Ctrl+A takeover handler failed: ${String((error as Error)?.message ?? error)}`)
        }
      }
      try {
        emitter.prependListener("input", listener)
      } catch {
        // A bus that refuses the registration leaves the key to the host, which is the safe half.
        return undefined
      }
      return () => {
        try {
          emitter.removeListener("input", listener)
        } catch {
          // Best effort: the host's own disposal may already have dropped the listener.
        }
      }
    }, [emitter, unavailable])
    if (typeof ui?.Box !== "function") return null
    // ZERO visible rows: an empty Box renders nothing, while the component stays MOUNTED — which is
    // the only thing this view is for.
    return React.createElement(ui.Box, {}, null)
  }
}

/**
 * Register the takeover through the plugin's existing status wiring.
 *
 * The seam (and the host shape behind it) belongs to the adapter: this call states WHAT is mounted
 * and the adapter performs the host registration, so this module names no service id at all.
 * @param ctx - the plugin context, handed to the host as the registration's identity.
 * @param tui - the DSH-TUI seam adapter.
 * @param deps - the toggle, the team reader, the scene opener and the log.
 * @returns the hook's handle.
 */
export function registerDashboardKey(ctx: PluginContextLike, tui: TuiAdapter, deps: DashboardKeyDeps): DashboardKeySeam {
  /** The view registration that mounts the hook inside the host's Chat screen. */
  const view = tui.registerStatusComponent({
    key: DASHBOARD_KEY_VIEW,
    component: createDashboardKeyComponent(tui, deps),
    maxRows: DASHBOARD_KEY_MAX_ROWS,
    identity: ctx,
    label: "mpd-tui Ctrl+A keyhook",
  })
  return { outcome: (): SeamOutcome => view.outcome() }
}
