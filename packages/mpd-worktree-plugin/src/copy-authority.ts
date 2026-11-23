import type { DshToolExec } from "../../mpd-dsh-adapter-plugin/src/index.ts"
import type { CopyRecord } from "./copy-store.ts"
import { directoryId } from "./copy-git.ts"
import { WorktreeError } from "./ops.ts"

/** One caller authorized by the native project identity service. */
export interface CopySeat {
  /** Authority comes from the project service, never from tool arguments. */
  readonly kind: "member"
  /** Captain authority is distinct from the ordinary participant seat. */
  readonly seat: "captain" | "member"
  /** Stable project identity shared by its authorized checkouts. */
  readonly projectId: string
  /** Canonical project root, where the board and copy state live. */
  readonly projectRoot: string
  /** Physical checkout used for this authenticated call. */
  readonly checkoutRoot: string
  /** Durable project member identity. */
  readonly memberId: string
  /** Board whose live assignment can authorize a request. */
  readonly teamId: string
  /** Board spelling used by the assignment's owner field. */
  readonly memberName: string
}

/** The common authority used by identity lookup and checkout registration. */
export interface CopyBinding {
  /** Canonical project owning the capability registry. */
  readonly projectRoot: string
  /** Independent checkout to bind or withdraw. */
  readonly checkoutRoot: string
  /** Durable member identity owning the capability. */
  readonly memberId: string
}

/** Optional native service supplied by project identity. */
export interface CopyIdentity {
  /** Resolve a live session at a host-derived checkout path. */
  resolveSeat(input: { checkoutRoot: string; sessionId: string }): CopySeat | { kind: "denied" | "unbound" }
  /** Register a durable checkout capability after the copy has independent Git storage. */
  bindCheckout(input: CopyBinding): void
  /** Withdraw the capability before safe physical cleanup. */
  unbindCheckout(input: CopyBinding): void
}

/** Authenticated call context, resolved fresh for every operation. */
export interface CopyAuthority {
  /** Canonical project seat and host identity. */
  readonly seat: CopySeat
  /** Exact harness session ID that authenticated as this seat. */
  readonly session: string
  /** Native service that grants and withdraws checkout capabilities. */
  readonly identity: CopyIdentity
  /** Native service providing fresh board assignment reads. */
  readonly teams: CopyBoard
}

/** The local `mpdTeams` read service projected onto the fields that authorize copy work. */
interface CopyBoard {
  /** Return the native board, or undefined when no such structured run exists. */
  get(workspace: string, teamId: string): {
    phase: string
    leadSessionId: string
    leadHistory?: readonly string[]
    parentTeamId?: string
    members: readonly { id: string; name: string; executorRef?: string; fenced?: boolean; mode?: string }[]
    tasks: readonly CopyTask[]
  } | undefined
}

/** Task identity and claim information read from the current native board. */
interface CopyTask {
  /** ID within the board owning this write assignment. */
  readonly id: string
  /** Board-local name, member id, or runtime executor handle. */
  readonly owner?: string
  /** Separate review and requirement rows never authorize allocation. */
  readonly kind: string
  /** Only a current claim can make an allocation or submission. */
  readonly status: string
  /** Increased when a previously authorized claim is replaced. */
  readonly attempt?: number
  /** Explicit edit scopes inherited from the declared task. */
  readonly writeScopes: readonly string[]
}

/** Resolve the host-minted identity in the team tool's precedence order. */
function callerSession(exec: DshToolExec): string | undefined {
  /** The adapter keeps the raw agent shape opaque. */
  const agent = exec.agent as { session?: { id?: unknown }; sessionId?: unknown; id?: unknown } | undefined
  /** The team and verification planes both key off these runtime values. */
  const id = agent?.session?.id ?? agent?.sessionId ?? agent?.id
  return typeof id === "string" && id !== "" ? id : undefined
}

/** Probe optional MPD services per call and authenticate native project membership. */
export function authorizeCopy(ctx: unknown, checkoutRoot: string, exec: DshToolExec): CopyAuthority {
  /** Cordis can omit services on legacy or standalone compositions. */
  const context = ctx as { get?: (name: string, strict: boolean) => unknown } | undefined
  /** The capability is optional, but no legacy fallback can authorize development copies. */
  const identity = context?.get?.("mpdProjectIdentity", false) as CopyIdentity | undefined
  /** The existing native board is the sole assignment authority. */
  const teams = context?.get?.("mpdTeams", false) as CopyBoard | undefined
  if (typeof identity?.resolveSeat !== "function" || typeof identity.bindCheckout !== "function" ||
      typeof identity.unbindCheckout !== "function" || typeof teams?.get !== "function") {
    throw new WorktreeError("copy-unavailable", "native project identity or the native board is unavailable; use a linked worktree")
  }
  /** Session-less routes and synthetic caller arguments cannot grant project access. */
  const session = callerSession(exec)
  if (session === undefined) throw new WorktreeError("copy-forbidden", "a live project session is required")
  /** The path is supplied by the host adapter and is independent of the request payload. */
  const seat = identity.resolveSeat({ checkoutRoot, sessionId: session })
  if (seat.kind !== "member") throw new WorktreeError("copy-forbidden", "this session has no authorized project seat")
  directoryId(seat.projectRoot)
  return { seat, session, identity, teams }
}

/** Read the original board's active writer attempt and match the exact live member activation. */
export function activeCopyTask(authority: CopyAuthority, teamId: string, taskId: string, memberName: string,
  writerSession: string): CopyTask {
  /** Board values may change while a request is awaiting its captain. */
  const team = authority.teams.get(authority.seat.projectRoot, teamId)
  /** Only the recorded executor is accepted, without a title or ancestry fallback. */
  const member = team?.members.find((row) => row.name === memberName && row.executorRef === writerSession)
  /** The assignment must be a currently claimed write task. */
  const task = team?.tasks.find((row) => row.id === taskId)
  if (team?.phase !== "active" || member === undefined || member.fenced || member.mode === "checkpoint" ||
      task === undefined || !["work", "repair", "integration"].includes(task.kind) ||
      (task.status !== "claimed" && task.status !== "in_progress") ||
      (task.owner !== member.name && task.owner !== member.id && task.owner !== writerSession)) {
    throw new WorktreeError("copy-stale-assignment", "the original writer must still own an active write assignment")
  }
  return task
}

/** Review alone cannot substitute for the captain's stable native authority. */
export function requireCaptain(authority: CopyAuthority): void {
  if (authority.seat.seat !== "captain" || authority.seat.checkoutRoot !== authority.seat.projectRoot) {
    throw new WorktreeError("copy-forbidden", "the authorized project captain must call from the project checkout")
  }
}

/** Require the current project captain also owns the live board at grant time. */
export function requireGrantCaptain(authority: CopyAuthority, record: CopyRecord): void {
  requireCaptain(authority)
  /** A nested execution board must have a live path back to the captain's project board. */
  const visited = new Set<string>()
  /** Begin at the assignment's original board. */
  let id: string | undefined = record.teamId
  while (id !== undefined && !visited.has(id)) {
    visited.add(id)
    /** Board reads are scoped to the authorized project on every hop. */
    const team: ReturnType<CopyBoard["get"]> = authority.teams.get(authority.seat.projectRoot, id)
    if (team === undefined || team.phase === "staged" || team.phase === "ended") break
    if (authority.seat.teamId === id && (team.leadSessionId === authority.session || team.leadHistory?.includes(authority.session))) return
    id = team.parentTeamId
  }
  throw new WorktreeError("copy-forbidden", "the project captain does not own this active board")
}

/** Protect a writer's request, draft and private checkout from another project's caller. */
export function ownCopy(authority: CopyAuthority, record: CopyRecord): boolean {
  return authority.seat.projectId === record.projectId && (authority.seat.seat === "captain" ||
    (authority.seat.memberId === record.memberId && authority.session === record.writerSession))
}

/** Recheck the assignment attempt and scope before any member-side copy mutation. */
export function checkCopyAssignment(authority: CopyAuthority, record: CopyRecord): void {
  /** Review and integration may take place after this assignment closes. */
  const task = activeCopyTask(authority, record.teamId, record.taskId, record.memberName, record.writerSession)
  if ((task.attempt ?? 0) !== record.attempt || !record.scope.every((scope) => task.writeScopes.includes(scope))) {
    throw new WorktreeError("copy-stale-assignment", "the task attempt or its write scope changed")
  }
}
