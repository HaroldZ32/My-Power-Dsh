// Seam 10 — `ctx.tuiDialogs`: the host-managed modal dialogs.
//
// The seam is REQUEST-based (there is nothing to register): `select/confirm/
// input` park a request and the TUI answers it. It is activated through the
// deferred inject form, so `available()` is true exactly when the service is
// composed, and every request is wrapped so a host without a dialog consumer (or
// one that refuses a malformed request) settles as a cancellation instead of
// hanging the caller.
//
// Conventions (t3 brief §c / §6): dialog copy stays minimal and labels are left
// EMPTY where the host should supply its localized defaults.
import { TUI_SEAMS } from "./types.js"
import type { SeamOutcome, TuiAdapter, TuiDialogsLike } from "./types.js"
import type { Log } from "./log.js"

/** The dialog seam facade. */
export interface DialogSeam {
  /** True once the service is composed (activation is deferred). */
  available(): boolean
  /** How activation went: `absent`, `available` or `refused`, as the aggregate diagnostic reports it. */
  outcome(): SeamOutcome
  /** Pick one option id; undefined on cancel/timeout/absent service. */
  select(title: string, options: readonly { id: string; label: string; description?: string }[], timeoutMs?: number): Promise<string | undefined>
  /** Yes/no; undefined on cancel/timeout/absent service. Labels stay the host's. */
  confirm(title: string, message?: string): Promise<boolean | undefined>
}

/**
 * Activate the dialog facade.
 * @param tui - the DSH-TUI seam adapter (this file names no seam id of its own).
 * @param log - diagnostics.
 * @param defaultTimeoutMs - fuse for a composition that has the service but no
 *   UI consumer (headless embedder) so the caller's `await` always settles.
 * @returns the facade.
 */
export function createDialogs(tui: TuiAdapter, log: Log, defaultTimeoutMs: number = 30_000): DialogSeam {
  /** The composed dialog service, undefined until the deferred binding runs. */
  let dialogs: TuiDialogsLike | undefined

  // The seam's own handle carries the outcome the boot line reports; the adapter records `absent`
  // until the service binds, which is exactly the honest default this facade always had.
  /** The seam handle, whose outcome the facade exposes. */
  const seam = tui.whenBound("dialogs", (service, _scope, handle) => {
    /** The bound service as the dialog surface, before any of its methods is trusted. */
    const runtime = service as TuiDialogsLike
    /** Whether the service carries all three request methods this facade forwards. */
    const usable =
      runtime !== undefined &&
      runtime !== null &&
      typeof runtime.select === "function" &&
      typeof runtime.confirm === "function" &&
      typeof runtime.input === "function"
    if (!usable) {
      handle.record({ state: "refused", detail: `${TUI_SEAMS.dialogs} is missing select/confirm/input` })
      return
    }
    dialogs = runtime
    handle.record({ state: "available", detail: "request-based seam; nothing to register" })
  })

  /** Whether the dialog service is composed, i.e. whether a picker can be offered at all. */
  const available = (): boolean => dialogs !== undefined

  /** Opens the host picker and settles as undefined on cancel, timeout or an absent service. */
  const select: DialogSeam["select"] = async (title: string, options: readonly { id: string; label: string; description?: string }[], timeoutMs: number = defaultTimeoutMs): Promise<string | undefined> => {
    if (dialogs === undefined) return undefined
    try {
      return await dialogs.select({ title, options, timeoutMs })
    } catch (error) {
      log.debug(`dialog select failed: ${String((error as Error)?.message ?? error)}`)
      return undefined
    }
  }

  /** Opens the host yes/no dialog and settles as undefined on cancel, timeout or an absent service. */
  const confirm: DialogSeam["confirm"] = async (title: string, message?: string, timeoutMs: number = defaultTimeoutMs): Promise<boolean | undefined> => {
    if (dialogs === undefined) return undefined
    try {
      return await dialogs.confirm({ title, message, timeoutMs })
    } catch (error) {
      log.debug(`dialog confirm failed: ${String((error as Error)?.message ?? error)}`)
      return undefined
    }
  }

  return { available, outcome: (): SeamOutcome => seam.outcome(), select, confirm }
}
