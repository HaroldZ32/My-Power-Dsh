// Seam 11 — `ctx.tuiStatus`: the keyed live status line above the prompt.
//
// Conventions (t3 brief §a): ONE line above the prompt, contributions joined by
// " · " in first-set order; key grammar `^[a-z][a-z0-9_-]*(:[a-z][a-z0-9_-]*)*$`;
// <= 200 terminal CELLS of scalar text. The host's 3-row footer BELOW the input
// has no plugin seam, and this row never draws into it.
//
// WHAT THIS SEAM CAN AND CANNOT CARRY — measured against the installed host, because it decides how
// much of the shared visual system can reach this row. `TuiStatusRuntime.set`/`registerView` publish a
// SCALAR, and the host's own Chat renders every text contribution as ONE dim, truncated `Text` row
// (`<Text dimColor wrap="truncate">{entries.map(e => e.text).join(' · ')}</Text>`). There is therefore
// no colour, no span and no component slot on THIS path: what a surface can contribute to the row's
// LOOK is its MARKER vocabulary (the contract's state glyph), its cell discipline, and nothing else.
// The rich component form (`registerStatusComponent`) is a different seam with a different behaviour —
// it reserves up to 3 EXTRA rows above the prompt — so switching to it is a behaviour change and not
// this restyle's to make; it is reported to the captain instead.
//
// The contribution is activated through the deferred inject form (T4-INERT-1):
// `ctx.inject(['tuiStatus'], scoped => …)`. Lifecycle is the caller's — the
// disposer returned by `set()` is handed to `scoped.effect`, so an unload or
// hot reload cannot leave a stale line behind.
import type { PluginContextLike, SeamOutcome, TuiAdapter } from "./types.js"
import type { Log } from "./log.js"
import { readBoardState, statusLine, type BoardState } from "./state.js"
import { clampCells, stripControl } from "./sanitize.js"
import { visualGlyph } from "./panel-core.js"
import { toneOfTally } from "./subagent-scene.js"
import type { DshTeamView } from "../../mpd-dsh-adapter-plugin/src/index.js"
import type { TeamRecord } from "../../mpd-team-core-plugin/src/team-store.js"

/** The status key (conventions: the plugin id, `mpd-tui`, or `mpd-tui:<sub>`). */
export const STATUS_KEY = "mpd-tui"

/**
 * The documented cell budget of ONE status contribution, from the host's own contract.
 *
 * It is enforced HERE as well as host-side because the host truncates at the ROW's width, which is a
 * different bound: a long localized line plus a settings notice can exceed 200 cells, and the cell
 * clamp is what keeps a CJK line from being cut inside a wide glyph.
 */
export const STATUS_MAX_CELLS = 200

/**
 * The state mark of a status line, in the same six-state vocabulary the DAG, the panels and the scenes
 * draw — the ONE status surface that can carry it is the `/mpd status` print (`boardSummary`), because
 * the keyed row's own text is pinned from every side (see {@link statusVisualLine}).
 * @param state - the board projection the line summarises.
 * @returns the contract's glyph for the workspace's dominant state, or `?` when nothing can be reported.
 */
export function statusMarker(state: BoardState): string {
  /** The tally the line summarises, when this workspace holds a team. */
  const tally = state.team?.tasks
  // NO TEAM IS NOT A STATE — it is the ABSENCE of one, and the shared vocabulary says so: `dim`. That is
  // the same reading the board scene's own frame draws, so an empty workspace looks empty everywhere.
  return tally === undefined ? visualGlyph("dim") : visualGlyph(toneOfTally(tally, []))
}

/**
 * The published status text.
 *
 * THE FACTS ARE `state.ts`'S, NOT A SECOND RENDERER: the sentence is `statusLine(state, notice)`.
 * Control characters are stripped FIRST (a hostile team name out of a record must never reach the
 * host's renderer) and the documented {@link STATUS_MAX_CELLS} budget is applied LAST, so the clamp
 * measures the text that is actually drawn and a CJK line can never be cut inside a wide glyph.
 *
 * WHY THIS LINE CARRIES NO STATE MARK — measured, not assumed. Three arms pin this row's TEXT, and they
 * pin it from every side: it must START with `mpd:` (`plugin.test.ts` full composition), it must contain
 * `"mpd: " + t("status.teamNone")` as a CONTIGUOUS substring (`watchdog-frontdoor.test.ts` notice arm),
 * and the bare line must be a PREFIX of the held line, so the notice is appended and never substituted
 * (same file, `first.startsWith(third)`). A mark in front breaks the first, a mark after the prefix
 * breaks the second, and a mark at the END breaks the third. The row therefore contributes the one
 * thing its contract leaves free — cell discipline — and the state mark lands on the surface that has
 * room for it: the `/mpd status` print ({@link statusMarker} is consumed there).
 * @param state - the board projection to publish.
 * @param notice - the settings-bridge notice, when one applies; `statusLine` places it last.
 * @returns one line of at most {@link STATUS_MAX_CELLS} cells.
 */
export function statusVisualLine(state: BoardState, notice?: string): string {
  return clampCells(stripControl(statusLine(state, notice)), STATUS_MAX_CELLS)
}

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
    render: () => statusVisualLine(readBoardState(workspaceRoot(), home(), teamViews?.() ?? [], teamRecords?.() ?? []), bridgeNotice?.()),
    onError: (error: unknown) => log.debug(`status refresh failed: ${String((error as Error)?.message ?? error)}`),
  })

  return { outcome: (): SeamOutcome => view.outcome(), refresh: (): void => view.refresh() }
}
