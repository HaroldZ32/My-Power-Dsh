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
import type { PluginContextLike, SeamOutcome, TuiDialogsLike } from "./types.js"
import type { Log } from "./log.js"
import { onService } from "./host.js"

/** The dialog seam facade. */
export interface DialogSeam {
  /** True once the service is composed (activation is deferred). */
  available(): boolean
  outcome(): SeamOutcome
  /** Pick one option id; undefined on cancel/timeout/absent service. */
  select(title: string, options: readonly { id: string; label: string; description?: string }[], timeoutMs?: number): Promise<string | undefined>
  /** Yes/no; undefined on cancel/timeout/absent service. Labels stay the host's. */
  confirm(title: string, message?: string): Promise<boolean | undefined>
}

/**
 * Activate the dialog facade.
 * @param ctx - the plugin context.
 * @param log - diagnostics.
 * @param defaultTimeoutMs - fuse for a composition that has the service but no
 *   UI consumer (headless embedder) so the caller's `await` always settles.
 * @returns the facade.
 */
export function createDialogs(ctx: PluginContextLike, log: Log, defaultTimeoutMs = 30_000): DialogSeam {
  let dialogs: TuiDialogsLike | undefined
  let outcome: SeamOutcome = { state: "absent", detail: "tuiDialogs was not injected" }

  onService(ctx, "tuiDialogs", (_scoped, service) => {
    const runtime = service as TuiDialogsLike
    const usable =
      runtime !== undefined &&
      runtime !== null &&
      typeof runtime.select === "function" &&
      typeof runtime.confirm === "function" &&
      typeof runtime.input === "function"
    if (!usable) {
      outcome = { state: "refused", detail: "tuiDialogs is missing select/confirm/input" }
      return
    }
    dialogs = runtime
    outcome = { state: "available", detail: "request-based seam; nothing to register" }
  })

  const available = (): boolean => dialogs !== undefined

  const select: DialogSeam["select"] = async (title, options, timeoutMs = defaultTimeoutMs) => {
    if (dialogs === undefined) return undefined
    try {
      return await dialogs.select({ title, options, timeoutMs })
    } catch (error) {
      log.debug(`dialog select failed: ${String((error as Error)?.message ?? error)}`)
      return undefined
    }
  }

  const confirm: DialogSeam["confirm"] = async (title, message, timeoutMs = defaultTimeoutMs) => {
    if (dialogs === undefined) return undefined
    try {
      return await dialogs.confirm({ title, message, timeoutMs })
    } catch (error) {
      log.debug(`dialog confirm failed: ${String((error as Error)?.message ?? error)}`)
      return undefined
    }
  }

  return { available, outcome: () => outcome, select, confirm }
}
