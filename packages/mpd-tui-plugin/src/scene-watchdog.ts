// THE WATCHDOG SCENE — the watchdog body at FULL SCREEN (frozen clause 3 / contract §5.A3).
//
// WHY IT EXISTS: the sidebar page had no surface to enlarge into, so its `⤢` control did nothing and
// `/mpd watchdog` reported an absence on a host without the panel seam. This scene registers
// `mpd-tui-watchdog` and draws the SAME rich body the page draws — through the ONE shared builder
// (`watchdogBodyRows`, `watchdogAckPress`), so the two surfaces cannot describe one incident differently.
//
// DATA SOURCE — THE FRONT DOOR, never the store: this file takes the SAME `WatchdogPanelDeps` the page
// receives, so it introduces no read contact of its own. `available()` / `read()` / `acknowledge()` are
// the row's single service-facing read side.
//
// THE SCENE RED LINE: the RENDER PATH does no synchronous I/O. The view (and the team head the phase
// half needs) is read in an EFFECT and on the page's own 2 s timer; the render draws the last read. A
// scene is mounted for as long as it is open, so a throwing read degrades to the explicit absent state
// rather than taking the surface down.
//
// THIS FILE NAMES NO `ctx.tui*` SERVICE: registration and the open request go through the `TuiAdapter`
// (`packages/mpd-tui-adapter-plugin`), the ONE place a DSH-TUI service may be named (AGENTS.md §6).
import type { PluginContextLike, SceneRegistrationHandle, SeamOutcome, TuiAdapter, TuiScenePropsLike } from "./types.ts"
import type { DagTone } from "./dag-theme.ts"
import { clampCells } from "./sanitize.ts"
import { normalizeWheelDelta, panelKit, panelSurfaceWidth, swallowWheelEvent, usePanelViewport, viewportTrack, wheelInvertOn } from "./panel-core.ts"
// THE SCENE KIT'S SHARED BUILDERS, never a second implementation of them: `surfaceText`,
// `surfaceFrame`, `surfaceHints`, `surfaceRule`, `chromeTitle` and `stateMarker` are what every MPD
// scene draws with, so this surface cannot pick up a different-looking frame or row grammar.
import {
  chromeTitle,
  stateMarker,
  surfaceFrame,
  surfaceHints,
  surfaceRule,
  surfaceText,
  type SurfaceKit,
} from "./subagent-scene.ts"
import {
  watchdogAckPress,
  watchdogBodyRows,
  watchdogTeamRows,
  WATCHDOG_PANEL_REFRESH_MS,
  WATCHDOG_PANEL_TITLE,
  type WatchdogPanelDeps,
  type WatchdogTeamHead,
} from "./panel-watchdog.ts"
import type { WatchdogView } from "./watchdog.ts"

/** The scene id the host opens by, and the id every `openScene` call names. */
export const WATCHDOG_SCENE_ID = "mpd-tui-watchdog"

/** The view an unavailable or unreadable service produces: the explicit empty state, never a throw. */
const WATCHDOG_SCENE_EMPTY_VIEW: WatchdogView = { holds: [], unread: [] }

/**
 * The frame rows a scene draws OUTSIDE its scrolling window.
 *
 * TWO for the frame's border rows, TWO for the pinned head (the title row and the rule beneath it) and
 * ONE for the key-hint footer. The window is the terminal minus this budget, and the arithmetic is
 * spelled here rather than sprinkled through the render so a later header row cannot silently clip the
 * footer (the off-by-one the sidebar pages were repaired for).
 */
const WATCHDOG_SCENE_CHROME_ROWS = 5

/** What one deferred read produced, so the render path draws it without touching the service again. */
interface WatchdogSceneRead {
  /** The durable view; the empty view when the service is unavailable or unreadable. */
  readonly view: WatchdogView
  /** Whether the service answered at all. */
  readonly available: boolean
  /** The team head the phase half needs, read in the SAME deferred read as the view. */
  readonly team?: WatchdogTeamHead
}

/** The host's React surface this component touches; every hook and element goes through it. */
interface SceneReact {
  /** Builds one host element. */
  createElement(type: unknown, props: Record<string, unknown> | null, ...children: unknown[]): unknown
  /** One state cell plus its setter. */
  useState(initial: unknown): [unknown, (next: unknown) => void]
  /** Registers an effect; the returns are called on unmount. */
  useEffect(effect: () => unknown, deps?: unknown): void
  /** One mutable cell that survives re-renders. */
  useRef(initial: unknown): { current: unknown }
}

/** The host's ui kit this component touches. */
interface SceneUi {
  /** The column/row primitive. */
  Box: unknown
  /** The text primitive. */
  Text: unknown
  /** The key listener, absent on a kit that delivers no input. */
  useInput?: (handler: (input: string, key: Record<string, unknown> | undefined) => void) => void
  /** The measured terminal, absent on a kit that cannot measure. */
  useTerminalSize?: () => { columns: number; rows: number }
}

/**
 * Project one watchdog incident list into the scene's own reading of it.
 * @param deps - the page deps the scene was built with.
 * @returns the read the render draws.
 */
function watchdogSceneRead(deps: WatchdogPanelDeps): WatchdogSceneRead {
  try {
    /** Whether the service answered this read. */
    const available = deps.available()
    /** The durable view, or the explicit empty one while the service is absent. */
    const view = available ? deps.read() : WATCHDOG_SCENE_EMPTY_VIEW
    /** The team head, contained separately: a phase failure must not cost the incidents. */
    let team: WatchdogTeamHead | undefined
    try {
      team = deps.readTeam?.()
    } catch {
      team = undefined
    }
    return { view, available, ...(team === undefined ? {} : { team }) }
  } catch {
    return { view: WATCHDOG_SCENE_EMPTY_VIEW, available: false }
  }
}

/**
 * Build the watchdog scene's component.
 * @param deps - the same front-door reads the sidebar page receives.
 * @returns a component matching the host's `TuiSceneProps` contract.
 */
export function createWatchdogSceneComponent(deps: WatchdogPanelDeps): unknown {
  return function MpdTuiWatchdogScene(props: TuiScenePropsLike): unknown {
    /** The host's own React; every hook and element must use it (the single-React rule). */
    const React = props?.React as SceneReact | undefined
    /** The host's ui kit. */
    const ui = props?.ui as SceneUi | undefined
    /** Leaves the scene; a host without the callback gets a no-op, so a key never throws. */
    const close = typeof props?.close === "function" ? props.close : (): void => {}
    // THE PANEL KIT IS PART OF THE GUARD: `panelKit` proves `React.createElement` and `ui.Box`/`ui.Text`
    // callable, and the checks below add the hooks this component and the shared viewport call —
    // `useRef` included, the member whose absence used to surface as a `TypeError` inside the viewport.
    /** The host kit in the panel builders' shape; `undefined` means this host cannot render the scene. */
    const panel = panelKit(React, ui)
    if (
      panel === undefined ||
      React === undefined ||
      ui === undefined ||
      typeof React.useState !== "function" ||
      typeof React.useEffect !== "function" ||
      typeof React.useRef !== "function"
    ) {
      // THE KIT IS THE HARD CONTRACT: render nothing rather than crash the reconciler.
      return null
    }
    // THE TWO KIT TYPES MEET HERE, exactly as `scenes.ts` does it: the shared builders read only
    // `React.createElement` and `ui.Box`/`ui.Text`, which this host object carries.
    /** The host kit in the shared builders' shape; taken once per render, never per call. */
    const surface = { React, ui } as unknown as SurfaceKit

    /** The last deferred read; the render draws THIS, never a fresh service call. */
    const readState = React.useState({ view: WATCHDOG_SCENE_EMPTY_VIEW, available: false } as WatchdogSceneRead)
    /** The current read. */
    const read = readState[0] as WatchdogSceneRead
    /** Replaces the read. */
    const setRead = readState[1] as (next: unknown) => void
    /** The acknowledgement's outcome line, re-set on every press. */
    const flashState = React.useState(undefined)
    /** The flash text, when a press produced one. */
    const flashText = typeof flashState[0] === "string" ? (flashState[0] as string) : undefined
    /** Writes the flash line. */
    const setFlash = flashState[1] as (next: unknown) => void
    // THE WINDOW'S POSITION IS THE SHARED VIEWPORT HANDLE, created below once this render has measured
    // its terminal (frozen criterion I5): the keys, the wheel and the rail all drive ONE number, so the
    // scrollbar can never describe a different position than the rows beside it.
    /** The newest incident stamp this scene has already acknowledged. */
    const lastAck = React.useRef(0)
    /** The explicit refresh trigger (`r`): its UPDATE re-runs the read effect. */
    const refreshState = React.useState(0)
    /** The current refresh token. */
    const refreshToken = typeof refreshState[0] === "number" ? (refreshState[0] as number) : 0
    /** Requests one fresh read. */
    const setRefresh = refreshState[1] as (next: unknown) => void

    // THE READ LIVES IN AN EFFECT: a scene is mounted for as long as it is open, and a service read on the
    // render path would run on every repaint (the scene red line). `refreshToken` re-arms it on `r`.
    React.useEffect(() => {
      setRead(watchdogSceneRead(deps))
      /** The 2 s reload, absent when the host refused to schedule timers. */
      let timer: ReturnType<typeof setInterval> | undefined
      try {
        timer = setInterval(() => setRead(watchdogSceneRead(deps)), WATCHDOG_PANEL_REFRESH_MS)
      } catch {
        timer = undefined
      }
      return (): void => {
        if (timer !== undefined) clearInterval(timer)
      }
    }, refreshToken)

    /** The measured terminal; a kit that cannot measure gets the scene's own conservative floor. */
    const measured = typeof ui.useTerminalSize === "function" ? ui.useTerminalSize() : { columns: 80, rows: 24 }
    // THE FRAME'S INTERIOR IS THIS SCENE'S ONE CONTENT WIDTH (frozen criteria W1/W3): the terminal's width
    // minus the border and padding `surfaceFrame` spends inside it. The old `columns - 6` was this same
    // budget with the chrome number re-spelled at every call site; it now comes from ONE helper.
    /** How many cells the frame's interior offers this render. */
    const contentCols = panelSurfaceWidth(measured.columns)
    // The kit is this render's own object, so recording the budget on it clamps every row built below.
    surface.maxCells = contentCols
    /** How many body rows the window can show; never below one. */
    const viewportRows = Math.max(1, measured.rows - WATCHDOG_SCENE_CHROME_ROWS)
    /** The per-team rows, with the phase half the deferred read captured. */
    const teams = watchdogTeamRows(read.view, () => read.team)
    /** The body rows, from the ONE builder the sidebar page also draws. */
    const rows = watchdogBodyRows({
      view: read.view,
      available: read.available,
      teams,
      ...(flashText === undefined ? {} : { flash: flashText }),
      now: Date.now(),
    })
    /** The sizes the viewport hook and every later closure read; written before anything reads them. */
    const sizes: { contentRows: number; viewportRows: number } = { contentRows: Math.max(1, rows.length), viewportRows }
    /** The body window's ONE scroll position: the keys, the wheel and the rail all drive this handle. */
    const viewport = usePanelViewport(panel, () => sizes)
    /** The furthest offset that still fills the window. */
    const scrollMax = viewport.max
    /** The offset for THIS render, clamped — the one value the window and the rail both read. */
    const scrollAt = viewport.offset
    /** The body rows this window shows. */
    const visible = rows.slice(scrollAt, scrollAt + viewportRows)

    /** Runs one acknowledgement press through the SHARED rule the sidebar page also uses. */
    const acknowledgeShown = (): void => {
      if (!read.available) return
      /** What the shared press produced. */
      const outcome = watchdogAckPress({ unread: read.view.unread, lastAck: lastAck.current as number, acknowledge: (upTo: number) => deps.acknowledge(upTo) })
      lastAck.current = outcome.lastAck
      setFlash(outcome.flash)
    }

    if (typeof ui.useInput === "function") {
      ui.useInput((input: string, key: Record<string, unknown> | undefined) => {
        if (key?.escape === true || input === "q") {
          close()
          return
        }
        if (input === "a") {
          acknowledgeShown()
          return
        }
        if (input === "r") {
          setFlash(undefined)
          setRefresh(Date.now())
          return
        }
        // THE WINDOW'S KEYS: the same gestures every MPD scene answers, so a reader learns ONE scroll
        // vocabulary across the surfaces (`⇧↑↓` by a row, `PgUp`/`PgDn` by a window, `Home`/`End` the
        // ends; `j`/`k` stay as the sidebar page spells them).
        // EVERY GESTURE MEANS EXACTLY WHAT IT MEANT (one row, one window, the two ends) and now drives
        // the shared handle, so the far edge is a real stop.
        if (key?.upArrow === true && key?.shift === true) viewport.scrollBy(-1)
        else if (key?.downArrow === true && key?.shift === true) viewport.scrollBy(1)
        else if (key?.pageUp === true) viewport.scrollBy(-viewportRows)
        else if (key?.pageDown === true) viewport.scrollBy(viewportRows)
        else if (key?.home === true) viewport.scrollTo(0)
        else if (key?.end === true) viewport.scrollTo(Number.MAX_SAFE_INTEGER)
        else if (input === "j") viewport.scrollBy(1)
        else if (input === "k") viewport.scrollBy(-1)
      })
    }

    // THE SURFACE'S DOMINANT TONE, in the one vocabulary every MPD surface reports: a held team warns,
    // unread incidents are the surface's work, and a quiet watchdog stays dim.
    const tone: DagTone = read.view.holds.length > 0 ? "blocked" : read.view.unread.length > 0 ? "chain" : "dim"
    /** The cells one body row may occupy inside the frame, its padding and the rail's column. */
    const rowCells = Math.max(8, contentCols - 2)
    /** The pinned head: the title row and the rule beneath it. */
    const head: unknown[] = [
      surfaceText(surface, "title", chromeTitle([`${stateMarker(tone, 0)} ${WATCHDOG_PANEL_TITLE}`, `${String(rows.length)} row(s)`]), { bold: true, tone }),
      surfaceRule(surface, "rule", undefined, tone),
    ]
    /** The window's rows, clamped so none can wrap the frame. */
    const drawn = visible.map((row) =>
      surfaceText(surface, row.key, clampCells(row.text, rowCells), {
        ...(row.tone === undefined ? {} : { tone: row.tone }),
        ...(row.bold === true ? { bold: true } : {}),
        ...(row.dim === true ? { dim: true } : {}),
      }),
    )
    // THE RAIL IS A 1-CELL SIBLING OF THE ROWS (never a cell painted into each row): the reserved column
    // is what keeps a row from becoming one cell wider than the frame's interior and being REWRAPPED.
    // IT IS THE SHARED BUILDER (frozen criteria I1/I5): `viewportTrack` draws `panel-core.ts`'s own gutter
    // cells inside a `Box` carrying the host's three drag phases — the DELTA drag the sidebar uses — plus
    // the click-to-jump a bare track click asks for. Absent when the body fits.
    /** The draggable rail for this render, absent when the body fits its window. */
    const rail = viewportTrack(panel, viewport, "row")
    // THE WHEEL OVER THE BODY, through the ONE normalisation helper every surface uses, so a machine
    // whose wheel arrives inverted does not scroll this scene the wrong way.
    /** The window's rows in one column, carrying the wheel and (with the rail) the gutter. */
    const window = React.createElement(
      ui.Box,
      { key: "body-window", flexDirection: "row", flexGrow: 1 },
      React.createElement(
        ui.Box,
        {
          key: "body-rows",
          flexDirection: "column",
          flexGrow: 1,
          onWheel: (event: unknown): void => {
            // SWALLOWED FIRST (frozen criterion I4): the gesture belongs to this scene.
            swallowWheelEvent(event)
            /** The event's vertical delta, narrowed from the host's own shape. */
            const raw = (event as { deltaY?: unknown } | undefined)?.deltaY
            // THE USER'S WHEEL DIRECTION IS HONOURED (frozen criterion I4): this handler used to pass a
            // hard-coded `false`, so a machine the terminal reports inverted scrolled this scene the
            // wrong way while every other surface obeyed the setting.
            const deltaY = normalizeWheelDelta(Number(raw ?? 0), wheelInvertOn())
            if (deltaY === 0) return
            viewport.scrollBy(deltaY > 0 ? 1 : -1)
          },
        },
        ...drawn,
      ),
      ...(rail === undefined ? [] : [rail]),
    )
    /** The pinned footer: the keys this scene handles and where the window sits. */
    const footer = [
      surfaceHints(surface, "footer", [
        "esc/q close",
        "⇧↑↓ scroll",
        "PgUp/PgDn page",
        "a ack",
        "r refresh",
        ...(scrollMax > 0 ? [`${String(scrollAt + 1)}/${String(scrollMax + 1)}`] : []),
      ]),
    ]
    /** The border title, clamped to the frame's INTERIOR so it can never shear the frame. */
    const borderTitle = clampCells(chromeTitle([stateMarker(tone, 0), WATCHDOG_PANEL_TITLE]), Math.max(8, contentCols - 2))
    return surfaceFrame(surface, "frame", borderTitle, [...head, window, ...footer], tone)
  }
}

/** The watchdog scene's own seam: its registration handle and the open request. */
export interface WatchdogSceneSeam {
  /** The registration handle; `undefined` when the scene seam is absent or the knob disabled it. */
  readonly scene: SceneRegistrationHandle | undefined
  /** Whether the scene was requested of the host right now (the seam bound and the call accepted). */
  registered(): boolean
  /** Opens the scene; false when the seam never bound or the host does not know the id. */
  open(): boolean
  /** The registration outcome, as the row's own boot diagnostic reports it. */
  outcome(): SeamOutcome
}

/**
 * Register the watchdog scene.
 * @param tui - the DSH-TUI seam adapter (this file names no seam id of its own).
 * @param ctx - the plugin context the host records as the registration's identity.
 * @param deps - the front-door reads, the acknowledgement route and the log.
 * @returns the scene's seam; `scene` is undefined when this row's `scene` knob is off.
 */
export function registerWatchdogScene(tui: TuiAdapter, ctx: PluginContextLike, deps: WatchdogPanelDeps): WatchdogSceneSeam {
  // ONE registration, at apply: the adapter queues it until the scene seam binds and settles it as
  // `absent` on a host that never offers one, so this call is safe on every dsh-tui build.
  const scene: SceneRegistrationHandle | undefined = deps.enabled
    ? tui.registerScene({ id: WATCHDOG_SCENE_ID, title: WATCHDOG_PANEL_TITLE, component: createWatchdogSceneComponent(deps) }, ctx)
    : undefined
  return {
    scene,
    // `requested` is the strongest claim this seam can carry: the host exposes no scene read-back, so a
    // `confirmed` state would be a claim nobody measured (see the adapter's own `SeamState`).
    registered: (): boolean => scene !== undefined && scene.outcome().state === "requested",
    open: (): boolean => (scene === undefined ? false : scene.openScene(WATCHDOG_SCENE_ID)),
    outcome: (): SeamOutcome => {
      if (scene !== undefined) return scene.outcome()
      // A surface this row deliberately did not activate: the adapter's own skipped vocabulary, so the
      // aggregate line names the reason instead of an invented state.
      return tui.skipped("scenes", "the watchdog scene is disabled by the mpd-tui row config (scene: false)").outcome()
    },
  }
}
