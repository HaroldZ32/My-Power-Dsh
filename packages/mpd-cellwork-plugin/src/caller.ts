// CALLER RESOLUTION — who is calling, in which workspace, and which CELL seat they occupy.
//
// WHY ONE MODULE: the guard, the tools and the command all need the same three facts (workspace,
// session id, cell seat), and two derivations of "who is the captain" would eventually disagree. Every
// reader resolves here, so the captain's identity has exactly one definition.
//
// THE WORKSPACE COMES FROM THE ADAPTER, per call — never `process.cwd()` and never a cached constant —
// so one host serving several sessions cannot answer with the wrong tree.
//
// A SEAT HAS TWO IDENTITY SOURCES ON PURPOSE. The cell record knows the captain by session id and a
// member once its session id was learned; the LIVE TEAM RECORD additionally carries the executor's own
// handle for each member (`executorRef`), which is what the native executor mints and what a child
// session actually runs under. A member is matched by either, so the guard covers it from the moment
// the approval answer exists.
import type { DshAdapter, DshToolExec } from "../../mpd-dsh-adapter-plugin/src/index"
import type { CellworkSeat, CellSeatMode } from "./guard"
import { cellDir, readActiveCell, type CellMemberMode, type CellReadFailure, type CellState } from "./state"

/**
 * The slice of the `mpdTeams` service this module reads, declared STRUCTURALLY.
 *
 * Declared here rather than imported from `mpd-team-core-plugin/src` on purpose: the repository's
 * cross-package coupling inventory is frozen and may only shrink, and the two rows talk through a
 * SERVICE at runtime anyway. The `get` answer is typed `unknown` because this module reads exactly one
 * field of a member row (`executorRef`) and treats every other shape as absent; the authoritative
 * declaration is `TeamRecord` in `packages/mpd-team-core-plugin/src/team-store.ts`.
 */
export interface TeamsServiceView {
  /** One team by id; undefined for an unknown id or an unreadable record. */
  get?: (workspace: string, teamId: string) => unknown
}

/** What one dispatch's caller is, as far as the cell is concerned. */
export interface CallerContext {
  /** The absolute workspace root the adapter resolved for THIS call. */
  workspace: string
  /** The caller's session id, or `""` when the agent handle carried none. */
  sessionId: string
  /** The caller's name inside the cell (`captain` or a member name), or `""` when it is in no cell. */
  member: string
  /** The enforced seat, or undefined when this session belongs to no active cell. */
  seat: CellworkSeat | undefined
  /** The active cell's record, when one was read. */
  cell: CellState | null
  /** The refusal that stopped the cell scan (a corrupt record), so a tool can name its path. */
  refusal: CellReadFailure | null
}

/** What {@link callerContext} needs beyond the adapter: the team-service resolver. */
export interface CallerDeps {
  /**
   * Resolve the `mpdTeams` service lazily, per call.
   *
   * Lazy on purpose: the team row may activate after this row does, and a service captured at apply
   * time would then be a permanent absence. Returning undefined is the documented degradation.
   */
  teams?: () => TeamsServiceView | undefined
}

/**
 * The session id an agent handle carries, read structurally.
 *
 * The harness fuses a live `Agent` into a dispatch, whose session id sits at `session.id`; a test
 * double or an older handle shape carries `sessionId` or `id` instead. The three spellings are tried in
 * that order and an unreadable handle answers `""` — never a fabricated id, because a wrong id could
 * match another session's seat.
 *
 * @param agent - the opaque agent handle from a dispatch or a command invocation.
 * @returns the session id, or `""`.
 */
export function sessionIdOf(agent: unknown): string {
  /** The handle, read as a record immediately so every access below is checked. */
  const handle = typeof agent === "object" && agent !== null ? agent as Record<string, unknown> : undefined
  if (handle === undefined) return ""
  /** The nested `session` member, when the handle carries one. */
  const session = typeof handle.session === "object" && handle.session !== null ? handle.session as Record<string, unknown> : undefined
  for (const candidate of [session?.id, handle.sessionId, handle.id]) {
    if (typeof candidate === "string" && candidate !== "") return candidate
  }
  return ""
}

/**
 * Resolve one dispatch's caller: workspace, session id, cell seat and the active cell record.
 *
 * NEVER throws. A workspace the adapter cannot answer for is `""`, and a cell scan that hit an
 * unreadable record reports `refusal` with no seat — which releases the caller (the guard cannot
 * enforce a mode it cannot read) while every cell tool can still name the broken path.
 *
 * @param dsh - the adapter, used only for its workspace-root seam.
 * @param exec - the dispatch (or a `{ agent }` wrapper for a command invocation).
 * @param deps - the team-service resolver; omitted means the cell record is the only source.
 * @returns the caller context.
 */
export function callerContext(
  dsh: Pick<DshAdapter, "workspaceRoot">,
  exec: DshToolExec | undefined,
  deps: CallerDeps = {},
): CallerContext {
  /** The workspace root, resolved per call and total on failure. */
  let workspace = ""
  try {
    workspace = dsh.workspaceRoot(exec)
  } catch {
    workspace = ""
  }
  /** The caller's session id, from the fused agent handle. */
  const sessionId = sessionIdOf(exec?.agent)
  if (workspace === "") return { workspace, sessionId, member: "", seat: undefined, cell: null, refusal: null }
  /** The active cell, or the refusal that replaced it. */
  const active = readActiveCell(workspace)
  if (!active.ok) return { workspace, sessionId, member: "", seat: undefined, cell: null, refusal: active }
  if (active.cell === null) return { workspace, sessionId, member: "", seat: undefined, cell: null, refusal: null }
  /** The active cell's record. */
  const cell = active.cell.state
  if (sessionId !== "" && sessionId === cell.captainSessionId) {
    return { workspace, sessionId, member: "captain", seat: { cellId: cell.cellId, name: "captain", mode: "captain" }, cell, refusal: null }
  }
  for (const member of Object.values(cell.members)) {
    if (sessionId !== "" && member.sessionId === sessionId) {
      return { workspace, sessionId, member: member.name, seat: { cellId: cell.cellId, name: member.name, mode: memberMode(member.mode) }, cell, refusal: null }
    }
  }
  // THE LIVE RECORD'S SECOND CHANCE: a member's session id is the executor's handle, which the
  // approval answer also puts on the cell record — but a re-raised or reseeded member may only be
  // resolvable through the team record. Matching there keeps the guard correct without a second store.
  /** The live team record for this cell, when the team row is mounted and the id is known. */
  const rawRecord = cell.teamId === "" ? undefined : deps.teams?.()?.get?.(workspace, cell.teamId)
  /** The same value read as a record, because the service's answer is typed `unknown`. */
  const record = typeof rawRecord === "object" && rawRecord !== null ? rawRecord as Record<string, unknown> : undefined
  if (record !== undefined && sessionId !== "") {
    /** The roster rows this build can read; anything else is skipped rather than trusted. */
    const rows = Array.isArray(record.members) ? record.members.filter((row) => typeof row === "object" && row !== null) as Array<Record<string, unknown>> : []
    for (const row of rows) {
      if (row.executorRef !== sessionId) continue
      /** The board name, which the cell record normally also holds. */
      const name = typeof row.name === "string" && row.name !== "" ? row.name : "member"
      /** The mode the cell recorded for that name, defaulted to the ordinary work surface. */
      const mode = memberMode(cell.members[name]?.mode)
      return { workspace, sessionId, member: name, seat: { cellId: cell.cellId, name, mode }, cell, refusal: null }
    }
  }
  return { workspace, sessionId, member: "", seat: undefined, cell, refusal: null }
}

/**
 * The cell directory a caller should hand a teammate, resolved from the same scan the tools use.
 *
 * Exists so the summary and the directive name ONE path derivation (`state.cellDir`) rather than
 * rebuilding `join(workspace, ".mpd/cellwork", id)` at each call site.
 *
 * @param context - a resolved caller context.
 * @returns the cell directory, or `""` when the caller is in no cell.
 */
export function contextCellDir(context: CallerContext): string {
  if (context.cell === null || context.workspace === "") return ""
  return cellDir(context.workspace, context.cell.cellId)
}

/**
 * Map a stored member mode onto the guard's seat vocabulary.
 *
 * The two vocabularies differ on purpose: the cell records what a member IS (`member`, `verifier`,
 * `checkpoint`, `subcaptain`) and the guard decides what it may DO, where the captain is a mode of its
 * own and a plain member has no rule at all.
 *
 * @param mode - the stored mode, or undefined when the name is not on the cell record.
 * @returns the guard mode.
 */
function memberMode(mode: CellMemberMode | undefined): CellSeatMode {
  return mode ?? "member"
}
