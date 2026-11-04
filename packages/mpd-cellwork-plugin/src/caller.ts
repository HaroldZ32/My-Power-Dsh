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
import { cellDir, listCellIds, readCell, recordTransition, type CellMemberMode, type CellMemberRecord, type CellReadFailure, type CellState } from "./state"

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
  /**
   * One member's context occupancy, read from the TEAM plane's own wrap of the harness meter.
   *
   * Optional because a composition may mount an older `mpd-team-core`: the answer is parsed at the
   * boundary (`protocol.ts#planePressureOf`), and an absent member reads as "this plane cannot answer".
   */
  memberContext?: (workspace: string, teamId: string, memberName: string) => unknown
  /**
   * One team's nesting depth and the bound the depth knob leaves it.
   *
   * The SAME knob cellwork reads (`cellwork.depthMax`), read through the plane so a team and a cell can
   * never disagree about how deep the project may nest. Absent means the plane cannot answer, and
   * `cellwork_subteam` falls back to the cell record's own depth.
   */
  depthBudget?: (workspace: string, teamId: string) => unknown
}

/**
 * The slice of `mpdTeamActions` this module (and the protocol tools) read, declared STRUCTURALLY.
 *
 * Declared here for the same reason as {@link TeamsServiceView}: the cross-package coupling inventory is
 * frozen and may only shrink, and the two rows talk through a SERVICE at runtime. The replies are typed
 * `unknown` because every tool PARSES them at its own boundary; the authoritative declarations live in
 * `packages/mpd-team-core-plugin/src/team-actions.ts`.
 */
export interface TeamActionsServiceView {
  /** One dispatch pass, owner-only by default; `reassign` is validated by the PLANE. */
  dispatch?: (input: { sessionId: string; limit?: number; dryRun?: boolean; mode?: string; reassign?: unknown }) => Promise<unknown>
  /** Fence one seat (Lead-only on the plane). */
  fence?: (input: { sessionId: string; member: string; reason?: string }) => Promise<unknown>
  /** Clear one seat's fence and its checkpoint window (Lead-only on the plane). */
  unfence?: (input: { sessionId: string; member: string }) => Promise<unknown>
  /** Record a member's hand-off and close its seat. */
  handoff?: (input: { sessionId: string; content: string }) => Promise<unknown>
  /** Cancel named board rows, so no pass can pair them. */
  cancelTasks?: (input: { workspace: string; teamId: string; taskIds: readonly string[]; note?: string }) => Promise<unknown>
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
  /**
   * Whether this resolution may ADOPT a live team seat into the cell record (contract B1).
   *
   * Defaults to `true`, because the cellwork VERBS are the adoption path. The tool guard passes `false`:
   * it runs on EVERY dispatch — including the ones it then refuses — and a permission predicate must
   * never write, so its seat lookup is READ-ONLY and the row is mirrored by the verb that follows.
   */
  adopt?: boolean
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
  /** Every live cell of the workspace, with its nesting depth — or the refusal that replaced the scan. */
  const scan = liveTree(workspace)
  if (scan.refusal !== null) return { workspace, sessionId, member: "", seat: undefined, cell: null, refusal: scan.refusal }
  if (scan.cells.length === 0) return { workspace, sessionId, member: "", seat: undefined, cell: null, refusal: null }
  // THE SEAT IS RESOLVED ACROSS THE WHOLE CELL TREE, DEEPEST FIRST (R1). A promoted subcaptain is the
  // CAPTAIN of its own sub-cell AND a member of the parent, and both rows are real; resolving only the
  // oldest active cell would hand it the parent's seat, where every handler's captain check refuses it.
  // The deepest match is the seat the caller actually holds; ties break on the newest id so two roots
  // never make the answer depend on directory order.
  /** The live cells, deepest first, then newest first. */
  const ordered = [...scan.cells].sort((left, right) => right.depth - left.depth || compareIds(right.state.cellId, left.state.cellId))
  for (const candidate of ordered) {
    /** The seat this session holds in that cell, when it holds one. */
    const held = seatIn(candidate.state, workspace, sessionId, deps)
    if (held !== undefined) {
      // ADOPTION IS OFF THE GUARD'S PATH (contract B1, repair 2): a READ-ONLY resolution (`adopt: false`)
      // resolves exactly the same seat but writes nothing, so the guard can run it on every dispatch.
      /** The record the verb reads: the stored one, with the adopted row when this resolution adopted one. */
      const state = held.adopt === undefined || deps.adopt === false ? candidate.state : adoptSeat(workspace, candidate.state, held.adopt)
      return { workspace, sessionId, member: held.member, seat: held.seat, cell: state, refusal: null }
    }
  }
  // NO SEAT ANYWHERE: the workspace still has a cell (the OLDEST live one, as the mode has always
  // reported), but this session holds no seat in it, so the guard has nothing to enforce.
  /** The oldest live cell, which is the one the mode reports when the caller belongs to none. */
  const oldest = [...scan.cells].sort((left, right) => compareIds(left.state.cellId, right.state.cellId))[0]
  return { workspace, sessionId, member: "", seat: undefined, cell: oldest.state, refusal: null }
}

/**
 * One live cell of the workspace, and how deep it sits in the cell tree.
 *
 * The depth is counted over the cells THIS scan can read: a parent that has already stopped is not a
 * level any more, which keeps the ordering total and deterministic even for an orphaned sub-cell.
 */
interface TreeCell {
  /** The cell's record. */
  state: CellState
  /** How many live ancestors it has: 0 for a top-level cell. */
  depth: number
}

/**
 * Every cell the workspace is currently running, with its depth.
 *
 * A cell directory whose record cannot be read is a REFUSAL rather than a shorter list: the mode may be
 * running, and reporting it absent would silently reset the guard. That is the same precedent
 * {@link readActiveCell} states, kept here so the tree scan cannot quietly drop a cell.
 *
 * @param workspace - the workspace root the adapter resolved for THIS call.
 * @returns the live cells and their depths, or the refusal naming the unreadable record.
 */
function liveTree(workspace: string): { cells: TreeCell[]; refusal: CellReadFailure | null } {
  /** The live cells, in directory order. */
  const live: CellState[] = []
  for (const cellId of listCellIds(workspace)) {
    /** That cell's record. */
    const read = readCell(workspace, cellId)
    if (!read.ok) return { cells: [], refusal: read }
    if (read.state.phase !== "stopped") live.push(read.state)
  }
  /** The live cells by id, so a depth walk never leaves the set it measured. */
  const byId = new Map(live.map((cell) => [cell.cellId, cell]))
  return { cells: live.map((cell) => ({ state: cell, depth: depthOf(cell, byId) })), refusal: null }
}

/**
 * How many live ancestors one cell has.
 * @param cell - the cell to measure.
 * @param live - the cells of this scan, by id.
 * @returns the ancestor count; 0 when its parent is stopped, unreadable or absent.
 */
function depthOf(cell: CellState, live: ReadonlyMap<string, CellState>): number {
  /** The levels walked so far. */
  let depth = 0
  /** The parent id being followed. */
  let cursor = cell.parentCellId
  /** The ids already walked, so a hand-edited cycle terminates. */
  const seen = new Set<string>([cell.cellId])
  while (cursor !== null && cursor !== "" && !seen.has(cursor)) {
    seen.add(cursor)
    /** That ancestor. */
    const parent = live.get(cursor)
    if (parent === undefined) break
    depth += 1
    cursor = parent.parentCellId
  }
  return depth
}

/**
 * The id order the tree scan breaks ties with: plain code-unit order, so it never depends on a locale.
 * @param left - one cell id.
 * @param right - the other cell id.
 * @returns -1 when `left` sorts first, 1 when `right` does, 0 when they are equal.
 */
function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

/**
 * One resolved seat, plus the row the resolution must MIRROR into the cell record when it adopted one.
 */
interface SeatResolution {
  /** The caller's name inside the cell. */
  member: string
  /** The enforced seat. */
  seat: CellworkSeat
  /**
   * The member row to ADOPT, present only when the LIVE TEAM RECORD resolved this session and the cell
   * record holds no row under that name (contract B1). Absent means the cell already knew the seat, so
   * this resolution writes nothing.
   */
  adopt?: CellMemberRecord
}

/**
 * The seat one session holds in ONE cell, or undefined when it holds none.
 *
 * THE LIVE RECORD IS THE SECOND CHANCE: a member's session id is the executor's handle, which the
 * approval answer also puts on the cell record — but a re-raised or reseeded member may only be
 * resolvable through the team record. Matching there keeps the guard correct without a second store.
 * @param cell - the cell to resolve against.
 * @param workspace - the caller's workspace root.
 * @param sessionId - the caller's session id, `""` when the handle carried none.
 * @param deps - the team-service resolver.
 * @returns the member name, the seat and (when the cell never learned it) the row to adopt; undefined
 *   when this session holds no seat.
 */
function seatIn(cell: CellState, workspace: string, sessionId: string, deps: CallerDeps): SeatResolution | undefined {
  if (sessionId === "") return undefined
  if (sessionId === cell.captainSessionId) return { member: "captain", seat: { cellId: cell.cellId, name: "captain", mode: "captain" } }
  // THE LIVE TEAM RECORD IS READ FIRST, because it is the AUTHORITY for a closed seat (wave W2-E): the
  // cell row's `mode` is a mirror written after a plane write, so a plane-side fence must reach the guard
  // even when the cell row has not caught up. Both loops below consult it and prefer its answer.
  /** The live team record for this cell, when the team row is mounted and the id is known. */
  const rawRecord = cell.teamId === "" ? undefined : deps.teams?.()?.get?.(workspace, cell.teamId)
  /** The same value read as a record, because the service's answer is typed `unknown`. */
  const record = typeof rawRecord === "object" && rawRecord !== null ? rawRecord as Record<string, unknown> : undefined
  /** The roster rows this build can read; anything else is skipped rather than trusted. */
  const rows = record !== undefined && Array.isArray(record.members) ? record.members.filter((row) => typeof row === "object" && row !== null) as Array<Record<string, unknown>> : []
  /**
   * The PLANE's reading of one seat, or undefined when the record does not name it.
   * @param name - the member's display name.
   * @returns `checkpoint` when the record fences the seat, else undefined.
   */
  const planeFence = (name: string): CellMemberMode | undefined => {
    /** The roster row this name names, when the record holds one. */
    const row = rows.find((candidate) => candidate.name === name || (typeof candidate.id === "string" && candidate.id === name))
    if (row === undefined) return undefined
    return row.mode === "checkpoint" || row.fenced === true ? "checkpoint" : undefined
  }
  for (const member of Object.values(cell.members)) {
    if (member.sessionId === sessionId) return { member: member.name, seat: { cellId: cell.cellId, name: member.name, mode: memberMode(planeFence(member.name) ?? member.mode) } }
  }
  if (record === undefined) return undefined
  for (const row of rows) {
    if (row.executorRef !== sessionId) continue
    /** The board name, which the cell record normally also holds. */
    const name = typeof row.name === "string" && row.name !== "" ? row.name : "member"
    /** The cell row that name already owns, when it owns one. */
    const known = cell.members[name]
    return {
      member: name,
      seat: { cellId: cell.cellId, name, mode: memberMode(planeFence(name) ?? known?.mode) },
      // ADOPTED ONLY WHEN THE CELL HAS NO ROW (B1). An existing row — fenced, checkpoint-mode, or simply
      // carrying an older handle — is the record's truth and is never overwritten by a mirror.
      ...(known === undefined ? { adopt: adoptedSeat(name, row, sessionId) } : {}),
    }
  }
  return undefined
}

/**
 * The cell row that MIRRORS one live team seat (contract B1).
 *
 * FIELD BY FIELD, NEVER BY SPREADING A ROW: a spread would carry `fenced`/`handoffReady` forward and
 * livelock a healthy member (`protocol-core.ts` states that warning). The row is born OPEN — mode
 * `member`, `handoffReady: false`, no `fenced` key — so an adopted member gets exactly the checkpoint
 * channel a staged member has.
 *
 * @param name - the name the seat resolves to.
 * @param row - the live team member row the session matched.
 * @param sessionId - the caller's session id, which IS the matched `executorRef`.
 * @returns the member record to adopt.
 */
function adoptedSeat(name: string, row: Record<string, unknown>, sessionId: string): CellMemberRecord {
  return {
    name,
    role: typeof row.role === "string" ? row.role : "",
    sessionId,
    executorRef: sessionId,
    mode: "member",
    handoffReady: false,
    handoffs: 0,
    joinedAt: new Date().toISOString(),
    adopted: true,
  }
}

/**
 * ADOPT one live team seat into the cell record, idempotently (contract B1).
 *
 * THE WRITE IS MERGED INTO A FRESH READ, never into the snapshot the seat was resolved against: that
 * snapshot is taken at the START of the caller resolution, so a captain write landing in between would be
 * clobbered by a `{...cell, members}` built from it. The record is therefore re-read HERE, the row is
 * merged into THAT record, and the two travel through one transition.
 *
 * It NEVER overwrites: the fresh record's own `members` table decides, so a fenced or checkpoint-mode row
 * written since the scan stays exactly as it is. A record this call cannot read is never rewritten either
 * (`state.ts`'s rule) — the mirror is returned without a write, and the next readable transition persists it.
 *
 * A write the workspace refuses must not break the caller — {@link callerContext} is documented total —
 * so the augmented record is returned either way: the verb behaves as if the row had always existed.
 *
 * @param workspace - the workspace root the adapter resolved for THIS call.
 * @param cell - the record the seat was resolved against, used only to name the cell.
 * @param row - the mirror row to record.
 * @returns the record the verb must read.
 */
function adoptSeat(workspace: string, cell: CellState, row: CellMemberRecord): CellState {
  /** The record on disk at THIS instant, which is what the merge must start from. */
  const fresh = readCell(workspace, cell.cellId)
  // AN UNREADABLE RECORD IS NOT REWRITTEN: the mirror answers this call and a later transition persists it.
  if (!fresh.ok) return withMember(cell, row)
  if (fresh.state.members[row.name] !== undefined) return fresh.state
  /** The FRESH record carrying the adopted row. */
  const next: CellState = withMember(fresh.state, row)
  try {
    return recordTransition(workspace, next, { event: "member-adopted", member: row.name, role: row.role, sessionId: row.sessionId }, new Date())
  } catch {
    return next
  }
}

/**
 * The same cell record with one member row set, and every other row untouched.
 *
 * @param cell - the record to copy.
 * @param row - the member row to set, keyed by its own name.
 * @returns the augmented record.
 */
function withMember(cell: CellState, row: CellMemberRecord): CellState {
  return { ...cell, members: { ...cell.members, [row.name]: row } }
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
