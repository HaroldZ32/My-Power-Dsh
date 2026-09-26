// Seam 11 — `ctx.tuiStatus`: the keyed live status line above the prompt.
//
// Conventions (t3 brief §a): ONE line above the prompt, contributions joined by
// " · " in first-set order; key grammar `^[a-z][a-z0-9_-]*(:[a-z][a-z0-9_-]*)*$`;
// <= 200 terminal CELLS of scalar text. The host's 3-row footer BELOW the input
// has no plugin seam, and this row never draws into it.
//
// The contribution is activated through the deferred inject form (T4-INERT-1):
// `ctx.inject(['tuiStatus'], scoped => …)`. Lifecycle is the caller's — the
// disposer returned by `set()` is handed to `scoped.effect`, so an unload or
// hot reload cannot leave a stale line behind.
import type { Disposer, PluginContextLike, SeamOutcome, TuiStatusLike } from "./types.js"
import type { Log } from "./log.js"
import { effectOn, onService } from "./host.js"
import { readBoardState, statusLine } from "./state.js"
import type { DshTeamView } from "../../mpd-dsh-adapter-plugin/src/index.js"

/** The status key (conventions: the plugin id, `mpd-tui`, or `mpd-tui:<sub>`). */
export const STATUS_KEY = "mpd-tui"

export interface StatusSeam {
  /** The measured outcome of this seam (never "registered" without a read-back). */
  outcome(): SeamOutcome
  /** Recompute and publish the line now (used by the refresh shortcut). */
  refresh(): void
}

/**
 * Activate the keyed status contribution.
 * @param ctx - the plugin context.
 * @param log - diagnostics.
 * @param workspaceRoot - resolves the workspace root per call.
 * @param home - resolves the home directory per call.
 * @param intervalMs - refresh cadence; 0 keeps it manual.
 * @param bridgeNotice - the last settings-bridge outcome, when one is available; a save
 *   with no live session workspace surfaces its notice on the line (§D.2 row 2).
 * @returns the seam handle.
 */
export function registerStatus(
  ctx: PluginContextLike,
  log: Log,
  workspaceRoot: () => string,
  home: () => string,
  intervalMs: number,
  bridgeNotice?: () => string | undefined,
  teamViews?: () => readonly DshTeamView[],
): StatusSeam {
  let outcome: SeamOutcome = { state: "absent", detail: "tuiStatus was not injected" }
  let refresh: () => void = () => {}

  onService(ctx, "tuiStatus", (scoped, service) => {
    const status = service as TuiStatusLike
    if (typeof status?.set !== "function") {
      outcome = { state: "refused", detail: "tuiStatus.set is missing" }
      return
    }
    let disposer: Disposer | undefined
    let timer: ReturnType<typeof setInterval> | undefined
    let published: string | undefined
    const publish = (): void => {
      try {
        const text = statusLine(readBoardState(workspaceRoot(), home(), teamViews?.() ?? []), bridgeNotice?.())
        // Only publish a CHANGED line: the host records every set() as a
        // `replace status` ledger effect, so a fixed-cadence republish would
        // churn the ledger (~20 records/minute) for an identical string.
        if (text === published) return
        published = text
        // The scoped context is passed as the contribution's identity so the
        // effect ledger attributes it to this activation instead of `undeclared`.
        disposer = status.set(STATUS_KEY, text, scoped)
      } catch (error) {
        log.debug(`status refresh failed: ${String((error as Error)?.message ?? error)}`)
      }
    }
    publish()
    if (intervalMs > 0) {
      try {
        timer = setInterval(publish, intervalMs)
        // Never keep the host process alive for a status line.
        ;(timer as unknown as { unref?: () => void }).unref?.()
      } catch {
        timer = undefined
      }
    }
    effectOn(
      scoped,
      () => {
        if (timer !== undefined) {
          try {
            clearInterval(timer)
          } catch {
            // already cleared
          }
          timer = undefined
        }
        try {
          disposer?.()
        } catch {
          // best effort
        }
        try {
          status.set(STATUS_KEY, undefined, scoped)
        } catch {
          // best effort
        }
      },
      "mpd-tui status line",
    )
    refresh = publish
    outcome = { state: "requested", detail: "set() has no read-back; key grammar and the 200-cell budget are host-validated" }
  })

  return { outcome: () => outcome, refresh: () => refresh() }
}
