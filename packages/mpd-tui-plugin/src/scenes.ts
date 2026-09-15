// Seam 8 — `ctx.tuiScenes`: the full-screen mpd board.
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
// React contract: every hook and element uses the React instance and ui kit the
// host injects through the scene props; this file therefore never imports React
// (it uses `props.React.createElement`, the documented always-safe form).
import type { PluginContextLike, SeamOutcome, TuiScenePropsLike, TuiScenesLike } from "./types.js"
import type { Log } from "./log.js"
import { onService } from "./host.js"
import { boardLines, readBoardState, statusLine } from "./state.js"

/** Unique, kebab-case scene id. */
export const BOARD_SCENE_ID = "mpd-tui-board"

/** Refresh cadence of the board's own state snapshot. */
const BOARD_REFRESH_MS = 2000

export interface SceneSeam {
  outcome(): SeamOutcome
  /** Open the board; false when the seam is absent or the id is unknown to the host. */
  open(): boolean
}

function noopSubscribe(): () => void {
  return () => {}
}

/**
 * Build the board component.
 * @param workspaceRoot - resolves the workspace root per call.
 * @param home - resolves the home directory per call.
 * @returns a component matching the host's `TuiSceneProps` contract.
 */
function createBoardComponent(workspaceRoot: () => string, home: () => string): unknown {
  return function MpdTuiBoard(props: TuiScenePropsLike): unknown {
    const React = props?.React
    const ui = props?.ui
    const close = typeof props?.close === "function" ? props.close : () => {}
    if (React === undefined || ui === undefined || typeof ui.Box !== "function" || typeof ui.Text !== "function") {
      // The host kit is the hard contract; without it, render nothing rather
      // than crash the reconciler.
      return null
    }

    const read = (): string[] => {
      try {
        return boardLines(readBoardState(workspaceRoot(), home()))
      } catch {
        return ["board state unreadable"]
      }
    }

    const state = React.useState([] as string[])
    const rows = state[0] as string[]
    const setRows = state[1] as (next: string[]) => void

    React.useEffect(() => {
      // Initial read is deferred to the effect: the render path stays free of
      // synchronous I/O (scene red line).
      setRows(read())
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
      })
    }

    // Live session observer: the row count only. `useSyncExternalStore` is
    // always called with stable fallbacks so the hook order never changes.
    const channel = props?.channel
    const subscribe = typeof channel?.subscribe === "function" ? (listener: () => void) => channel.subscribe(listener) : noopSubscribe
    const getSnapshot = typeof channel?.version === "number" ? () => channel.version as number : () => 0
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
    let size = ""
    if (typeof ui.useTerminalSize === "function") {
      const measured = ui.useTerminalSize()
      if (measured !== undefined && measured !== null) size = `${String(measured.columns ?? "?")}x${String(measured.rows ?? "?")}`
    }

    const header = `MPD board — ${rows.length} line(s)${size === "" ? "" : ` · ${size}`}`
    const children: unknown[] = [
      // Title/counts chrome (the host draws NO chrome for a scene).
      React.createElement(ui.Text, { key: "title", bold: true }, header),
      React.createElement(ui.Text, { key: "meta", dimColor: true }, `${sessionRows} transcript row(s)`),
    ]
    for (let index = 0; index < rows.length; index += 1) {
      children.push(React.createElement(ui.Text, { key: `line-${index}` }, rows[index]))
    }
    // Key-hint footer, always the last row.
    children.push(React.createElement(ui.Text, { key: "footer", dimColor: true }, "esc/q close · r refresh"))

    // flexGrow: the scene fills the terminal it was handed.
    return React.createElement(ui.Box, { flexDirection: "column", width: "100%", flexGrow: 1, paddingX: 1 }, children)
  }
}

/**
 * Activate the full-screen board scene.
 * @param ctx - the plugin context.
 * @param log - diagnostics.
 * @param workspaceRoot - resolves the workspace root per call.
 * @param home - resolves the home directory per call.
 * @returns the seam handle.
 */
export function registerScene(
  ctx: PluginContextLike,
  log: Log,
  workspaceRoot: () => string,
  home: () => string,
): SceneSeam {
  let outcome: SeamOutcome = { state: "absent", detail: "tuiScenes was not injected" }
  let scenes: TuiScenesLike | undefined

  onService(ctx, "tuiScenes", (scoped, service) => {
    const runtime = service as TuiScenesLike
    if (typeof runtime?.register !== "function") {
      outcome = { state: "refused", detail: "tuiScenes.register is missing" }
      return
    }
    scenes = runtime
    try {
      runtime.register({ id: BOARD_SCENE_ID, title: "MPD board", component: createBoardComponent(workspaceRoot, home) }, scoped)
      // `open(unknownId)` is how the host reports an unregistered scene; calling
      // it here would OPEN the board, so it is never used as a probe. The host
      // exposes no scene read-back, hence `requested`.
      outcome = { state: "requested", detail: `scene ${BOARD_SCENE_ID} requested (no host read-back)` }
    } catch (error) {
      outcome = { state: "refused", detail: String((error as Error)?.message ?? error) }
      log.debug(`board scene registration refused: ${outcome.detail ?? ""}`)
    }
  })

  const open = (): boolean => {
    if (scenes === undefined) {
      log.debug("board scene open() skipped: tuiScenes was not injected")
      return false
    }
    try {
      const opened = scenes.open(BOARD_SCENE_ID)
      if (opened !== true) log.debug(`board scene open() returned ${String(opened)}`)
      return opened === true
    } catch (error) {
      log.debug(`board scene open failed: ${String((error as Error)?.message ?? error)}`)
      return false
    }
  }

  return { outcome: () => outcome, open }
}

/** The status line the `/mpd status` action prints. */
export function boardSummary(workspaceRoot: () => string, home: () => string): string {
  try {
    return statusLine(readBoardState(workspaceRoot(), home()))
  } catch {
    return "mpd: state unreadable"
  }
}
