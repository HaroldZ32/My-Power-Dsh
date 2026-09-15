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
import type { Disposer, PluginContextLike, SeamOutcome, TuiShortcutsLike } from "./types.js"
import type { Log } from "./log.js"
import { effectOn, onService } from "./host.js"

/** What a shortcut handler needs from the rest of the plugin. */
export interface ShortcutActions {
  openBoard(via: "shortcut"): boolean
  refreshStatus(): void
  pickWorkmate(): void
}

/** The bindings this plugin requests, in registration order. */
export const SHORTCUT_BINDINGS: readonly { combo: string; description: string; action: keyof ShortcutActions }[] = [
  { combo: "alt+m", description: "mpd: open the board", action: "openBoard" },
  { combo: "alt+w", description: "mpd: pick a workmate", action: "pickWorkmate" },
  { combo: "alt+r", description: "mpd: refresh the status line", action: "refreshStatus" },
]

/**
 * Activate the shortcut bindings.
 * @param ctx - the plugin context.
 * @param log - diagnostics.
 * @param actions - the handlers.
 * @returns the seam handle.
 */
export function registerShortcuts(ctx: PluginContextLike, log: Log, actions: ShortcutActions): { outcome(): SeamOutcome } {
  let outcome: SeamOutcome = { state: "absent", detail: "tuiShortcuts was not injected" }

  onService(ctx, "tuiShortcuts", (scoped, service) => {
    const shortcuts = service as TuiShortcutsLike
    if (typeof shortcuts?.register !== "function") {
      outcome = { state: "refused", detail: "tuiShortcuts.register is missing" }
      return
    }
    const disposers: Disposer[] = []
    for (const binding of SHORTCUT_BINDINGS) {
      try {
        const disposer = shortcuts.register(
          binding.combo,
          {
            description: binding.description,
            handler: () => {
              try {
                if (binding.action === "openBoard") actions.openBoard("shortcut")
                else if (binding.action === "refreshStatus") actions.refreshStatus()
                else actions.pickWorkmate()
              } catch (error) {
                // A handler must never break another plugin's keyboard.
                log.debug(`shortcut ${binding.combo} handler failed: ${String((error as Error)?.message ?? error)}`)
              }
            },
          },
          scoped,
        )
        // Owned for cleanup only; NOT proof of registration.
        if (typeof disposer === "function") {
          const release = disposer
          disposers.push(release)
          effectOn(scoped, () => release(), `mpd-tui shortcut ${binding.combo}`)
        }
      } catch (error) {
        log.debug(`shortcut ${binding.combo} refused: ${String((error as Error)?.message ?? error)}`)
      }
    }

    // Read-back: the honest confirmation source (a refusal never appears here).
    let listed: readonly { combo: string; description: string }[] | undefined
    if (typeof shortcuts.list === "function") {
      try {
        listed = shortcuts.list() ?? []
      } catch {
        listed = undefined
      }
    }
    if (listed === undefined) {
      outcome = { state: "requested", detail: `${disposers.length} binding(s) requested; the host exposes no list() read-back` }
      return
    }
    const confirmed = SHORTCUT_BINDINGS.filter((binding) => listed?.some((entry) => entry.description === binding.description)).map(
      (binding) => binding.combo,
    )
    outcome =
      confirmed.length === 0
        ? { state: "refused", detail: `list() shows none of our bindings — every combo was refused (reserved or duplicate): ${disposers.length} no-op disposer(s)` }
        : confirmed.length === SHORTCUT_BINDINGS.length
          ? { state: "confirmed", detail: `${confirmed.join(", ")} confirmed via tuiShortcuts.list()` }
          : { state: "requested", detail: `${confirmed.join(", ")} confirmed; ${SHORTCUT_BINDINGS.length - confirmed.length} not visible in list()` }
  })

  return { outcome: () => outcome }
}
