// Ambient type surface for the VENDORED agent-teams tree that the scripts under `scripts/` consume.
//
// WHAT CHANGED (this wave): the adopted body was converted to TypeScript — `lib/**` and `_deps/**`
// ESM sources are `.ts` and their genuine CommonJS sources are `.cts` — so these imports now RESOLVE
// TO REAL FILES. A resolvable file beats an ambient wildcard declaration, which means the blocks
// below no longer participate in resolution at all: they document the surface a reader should expect,
// and the compiler takes the surface from the module itself (each adopted file carries a first-line
// `@ts-nocheck`, so the module's own body contributes no diagnostics).
//
// That is also why `MpdDeltaEntry` is NOT declared here: the generated registry
// (`lib/mpd-deltas.ts`) is the single authority for its own entry shape and exports the interface,
// so a second copy in this file would be a structural clone that could drift from it.
//
// KEEP IT MINIMAL AND HONEST: a block belongs here only while it says something the resolved module
// does not, and it names only the symbols `scripts/` actually imports.

/**
 * The vendored team-state module (`lib/state.ts`): the symbols `scripts/` imports from it.
 */
declare module "*mpd-agent-teams-plugin/lib/state.ts" {
  /**
   * Archive one live team directory under `<stateRoot>/archive/<teamId>`.
   *
   * @param stateRoot - resolved absolute state root directory.
   * @param teamId - the team id (its directory name under `stateRoot`).
   * @returns a promise that settles when the directory has been moved and stamped.
   */
  export function archiveTeamDir(stateRoot: string, teamId: string): Promise<void>
}
