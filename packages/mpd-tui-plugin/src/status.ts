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
import type { PluginContextLike, SeamOutcome, TuiAdapter } from "./types.js"
import type { Log } from "./log.js"
import { readBoardState, statusLine } from "./state.js"
import type { DshTeamView } from "../../mpd-dsh-adapter-plugin/src/index.js"
import type { TeamRecord } from "../../mpd-team-core-plugin/src/team-store.js"

/** The status key (conventions: the plugin id, `mpd-tui`, or `mpd-tui:<sub>`). */
export const STATUS_KEY = "mpd-tui"

/** The status-line seam handle: the measured outcome plus the manual refresh path. */
export interface StatusSeam {
  /** The measured outcome of this seam (never "registered" without a read-back). */
  outcome(): SeamOutcome
  /** Recompute and publish the line now (used by the refresh shortcut). */
  refresh(): void
}

/**
 * Activate the keyed status contribution.
 * @param ctx - the plugin context; the host records it as the contribution's identity.
 * @param tui - the DSH-TUI seam adapter (this file names no seam id of its own).
 * @param log - diagnostics.
 * @param workspaceRoot - resolves the workspace root per call.
 * @param home - resolves the home directory per call.
 * @param intervalMs - refresh cadence; 0 keeps it manual.
 * @param bridgeNotice - the last settings-bridge outcome, when one is available; a save
 *   with no live session workspace surfaces its notice on the line (§D.2 row 2).
 * @param teamViews - the official team readout, resolved per call.
 * @param teamRecords - the mpd-owned team records, resolved per call.
 * @returns the seam handle.
 */
export function registerStatus(
  ctx: PluginContextLike,
  tui: TuiAdapter,
  log: Log,
  workspaceRoot: () => string,
  home: () => string,
  intervalMs: number,
  bridgeNotice?: () => string | undefined,
  teamViews?: () => readonly DshTeamView[],
  teamRecords?: () => readonly TeamRecord[],
): StatusSeam {
  // The whole contribution — the changed-line suppression, the cadence timer and the cleanup that
  // clears the key — is owned by the adapter, which also owns the seam's cleanup scope. This file
  // only says WHAT the line reads; it never touches the status service.
  /** The adapter's handle for this view: the measured outcome plus the refresh path. */
  const view = tui.registerStatusView({
    key: STATUS_KEY,
    intervalMs,
    identity: ctx,
    label: "mpd-tui status line",
    render: () => statusLine(readBoardState(workspaceRoot(), home(), teamViews?.() ?? [], teamRecords?.() ?? []), bridgeNotice?.()),
    onError: (error: unknown) => log.debug(`status refresh failed: ${String((error as Error)?.message ?? error)}`),
  })

  return { outcome: (): SeamOutcome => view.outcome(), refresh: (): void => view.refresh() }
}
