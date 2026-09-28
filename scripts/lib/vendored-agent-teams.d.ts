// Ambient type surface for the VENDORED agent-teams JavaScript that the scripts under
// `scripts/` consume.
//
// WHY THIS FILE EXISTS: `packages/mpd-agent-teams-plugin/lib/**` is adopted upstream code and
// stays plain JavaScript on purpose (it is re-materialized from the delta registry, so an
// adjacent `.d.ts` there would be a foreign file inside a vendored tree). Without a declaration
// the compiler reports TS7016 (`implicitly has an 'any' type`) for every import of it, and a
// lane that must typecheck at zero diagnostics cannot use `allowJs` (the Lead owns `tsconfig.json`).
// So the surface is declared ONCE here, restricted by a wildcard pattern to that vendored tree,
// and only for the symbols these scripts actually use. It is a declaration file: it is never
// executed and no runtime behaviour depends on it.
//
// KEEP IT MINIMAL AND HONEST: add a member only when a script imports it, with the signature the
// vendored implementation really has (read that implementation before you widen this file).

/**
 * The vendored team-state module (`lib/state.js`): the symbols `scripts/` imports from it.
 */
declare module "*mpd-agent-teams-plugin/lib/state.js" {
  /**
   * Archive one live team directory under `<stateRoot>/archive/<teamId>`.
   *
   * @param stateRoot - resolved absolute state root directory.
   * @param teamId - the team id (its directory name under `stateRoot`).
   * @returns a promise that settles when the directory has been moved and stamped.
   */
  export function archiveTeamDir(stateRoot: string, teamId: string): Promise<void>
}

/**
 * The vendored delta registry (`lib/mpd-deltas.js`): the marker factory and the entry list whose
 * bytes `scripts/patch-agent-teams-fixes.ts` re-applies to the adopted files.
 */
declare module "*mpd-agent-teams-plugin/lib/mpd-deltas.js" {
  /** One registered mpd delta region: its file, id, context pair and replacement block. */
  export interface MpdDeltaEntry {
    /** Repository-relative path of the adopted file the region lives in. */
    readonly file: string
    /** Region id, unique per file; the marker text interpolates it. */
    readonly id: string
    /** Shortest unique window of region-stripped lines ending at the seam. */
    readonly beforeContext: readonly string[]
    /** Shortest unique window of region-stripped lines starting after the seam. */
    readonly afterContext: readonly string[]
    /** Exact bytes the region must contain, including the marker lines. */
    readonly block: string
    /** Legacy line-keyed anchor kept for entries a wave-2 registry still carries. */
    readonly anchor?: string
    /** Legacy marker line the anchor was keyed by, when the entry still carries one. */
    readonly anchorMarker?: string
    /** Legacy occurrence index of `anchorMarker`, when the entry still carries one. */
    readonly anchorOccurrence?: number
    /** True for an entry whose region no longer exists in the adopted file. */
    readonly orphan?: boolean
  }

  /** Region markers that bracket every mpd delta in the adopted plugin. */
  export const MPD_DELTA_MARKERS: {
    /** Opening marker line for one region id. */
    begin(id: string): string
    /** Closing marker line for one region id. */
    end(id: string): string
  }

  /** Every mpd delta in file order, addressed by the context pair that brackets its seam. */
  export const MPD_DELTAS: readonly MpdDeltaEntry[]
}
