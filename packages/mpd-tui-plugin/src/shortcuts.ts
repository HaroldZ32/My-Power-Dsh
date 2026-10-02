// Seam 12 — `ctx.tuiShortcuts`: the global key bindings of the mpd surfaces.
//
// Conventions (t3 brief §e): every plugin combo must carry ctrl or alt, ANY
// escape combo is refused, the fixed reserved set PLUS the effective combo of
// every user-remappable action is refused, and matching is modifier-SUBSET (so a
// Shift superset of a reserved combo is refused too). A refusal is a WARNING,
// never a throw — the expected path, not an error.
//
// HONESTY (T10-F1 class): the host answers a refused combo with a NO-OP disposer,
// so a returned function proves nothing. `tuiShortcuts.list()` is the documented
// read-back ("combos and descriptions owned by the calling plugin activation"), so
// this seam confirms per binding through it and otherwise reports `requested`.
import { TUI_SEAMS } from "./types.js"
import type { PluginContextLike, SeamOutcome, TuiAdapter } from "./types.js"
import type { Log } from "./log.js"

/** What a shortcut handler needs from the rest of the plugin. */
export interface ShortcutActions {
  /** Opens the board; false when the scene seam is absent in this composition. */
  openBoard(via: "shortcut"): boolean
  /** Open the team-workflow surface (frozen §5.3: best-effort, the command is the guarantee). */
  openTeam(): boolean
  /** Open the merged panel (the host's own subagent rows above the MPD team body). */
  openSubagents(): boolean
  /** Republishes the status line now; a no-op before that seam is active. */
  refreshStatus(): void
  /** Opens the mediated workmate picker; a no-op without a dialog seam. */
  pickWorkmate(): void
}

/** The bindings this plugin requests, in registration order. */
export const SHORTCUT_BINDINGS: readonly { combo: string; description: string; action: keyof ShortcutActions }[] = [
  { combo: "alt+m", description: "mpd: open the board", action: "openBoard" },
  // `alt+a`, never `ctrl+a`: the host's own subagent dashboard owns Ctrl+A (and its editor owns it
  // as line-start), and a plugin that took it would be overriding the host — the one thing this
  // wave forbids. `alt+a` is measured FREE on dsh-tui 0.12.0 (not in FIXED_RESERVED_COMBOS, not a
  // default of any SHORTCUT_ACTIONS entry) while `alt+s` is the host's `star`.
  { combo: "alt+a", description: "mpd: open the subagents + team panel", action: "openSubagents" },
  { combo: "alt+t", description: "mpd: open the team workflow", action: "openTeam" },
  { combo: "alt+w", description: "mpd: pick a workmate", action: "pickWorkmate" },
  { combo: "alt+r", description: "mpd: refresh the status line", action: "refreshStatus" },
]

/**
 * Activate the shortcut bindings.
 * @param ctx - the plugin context; the host records it as each binding's identity.
 * @param tui - the DSH-TUI seam adapter (this file names no seam id of its own).
 * @param log - diagnostics.
 * @param actions - the handlers.
 * @returns the seam handle.
 */
export function registerShortcuts(ctx: PluginContextLike, tui: TuiAdapter, log: Log, actions: ShortcutActions): { outcome(): SeamOutcome } {
  /** The seam handle: the aggregate outcome is confirmed through the host's own read-back. */
  const seam = tui.whenBound("shortcuts", (_service, _scope, handle) => {
    /** The bound shortcut registry, before `register` is trusted. */
    const registry = tui.shortcuts()
    if (typeof registry?.register !== "function") {
      handle.record({ state: "refused", detail: `${TUI_SEAMS.shortcuts}.register is missing` })
      return
    }
    /** Handles for the combos the host did not throw on; owned for cleanup only. */
    let requested = 0
    for (const binding of SHORTCUT_BINDINGS) {
      /** The adapter's handle for this one combo; the admission call happened there. */
      const registration = tui.registerShortcut(
        binding.combo,
        {
          description: binding.description,
          handler: () => {
            try {
              if (binding.action === "openBoard") actions.openBoard("shortcut")
              else if (binding.action === "openSubagents") actions.openSubagents()
              else if (binding.action === "openTeam") actions.openTeam()
              else if (binding.action === "refreshStatus") actions.refreshStatus()
              else actions.pickWorkmate()
            } catch (error) {
              // A handler must never break another plugin's keyboard.
              log.debug(`shortcut ${binding.combo} handler failed: ${String((error as Error)?.message ?? error)}`)
            }
          },
        },
        ctx,
      )
      /** What that binding measured; a returned no-op disposer is NOT proof of registration. */
      const measured = registration.outcome()
      if (measured.state === "requested") requested += 1
      else if (measured.state === "refused") log.debug(`shortcut ${binding.combo} refused: ${measured.detail ?? "unknown"}`)
    }

    // Read-back: the honest confirmation source (a refusal never appears here).
    let listed: readonly { combo: string; description: string }[] | undefined
    if (typeof registry.list === "function") {
      try {
        listed = registry.list() ?? []
      } catch {
        listed = undefined
      }
    }
    if (listed === undefined) {
      handle.record({ state: "requested", detail: `${requested} binding(s) requested; the host exposes no list() read-back` })
      return
    }
    /** The combos the host's own `list()` read-back shows as ours. */
    const confirmed = SHORTCUT_BINDINGS.filter((binding) => listed?.some((entry) => entry.description === binding.description)).map(
      (binding) => binding.combo,
    )
    handle.record(
      confirmed.length === 0
        ? { state: "refused", detail: `list() shows none of our bindings — every combo was refused (reserved or duplicate): ${requested} no-op disposer(s)` }
        : confirmed.length === SHORTCUT_BINDINGS.length
          ? { state: "confirmed", detail: `${confirmed.join(", ")} confirmed via ${TUI_SEAMS.shortcuts}.list()` }
          : { state: "requested", detail: `${confirmed.join(", ")} confirmed; ${SHORTCUT_BINDINGS.length - confirmed.length} not visible in list()` },
    )
  })

  return { outcome: (): SeamOutcome => seam.outcome() }
}
