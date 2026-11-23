import type { WorkerPressureDeps } from "./worker-pressure"

/** Exact current ownership of one runnable write task. */
export interface WorkerTask {
  /** Stable identities and board revision against which asynchronous work is checked. */
  readonly key: string
  /** Board attempt identity, independent of harmless row revision changes. */
  readonly attemptKey: string
  /** Shared Cellwork state workspace. */
  readonly workspace: string
  /** The cell owning the journal. */
  readonly cellId: string
  /** The authenticated board. */
  readonly teamId: string
  /** The writer's durable project seat. */
  readonly memberId: string
  /** The current native session. */
  readonly sessionId: string
  /** The task receiving the maintenance. */
  readonly taskId: string
  /** Board attempt number. */
  readonly attempt: number
  /** Board revision tracked across asynchronous maintenance. */
  readonly revision: number
}

/** Current exact writer identity and board rows, across terminal or waiting task states. */
interface WriterBinding {
  /** Durable project identity. */
  readonly projectId: string
  /** Project state workspace. */
  readonly workspace: string
  /** Resolved cell owning the maintenance policy. */
  readonly cellId: string
  /** Execution board tied to the original session. */
  readonly teamId: string
  /** Authenticated durable writer id. */
  readonly memberId: string
  /** Native activation's exact session id. */
  readonly sessionId: string
  /** Live tasks for readiness and authority checks. */
  readonly tasks: readonly Record<string, unknown>[]
}

/** Narrow unknown values from the board, project identity, and host event services. */
export function recordOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

/** Project each member and task row using the same structural boundary. */
function recordsOf(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(recordOf).filter((row): row is Record<string, unknown> => row !== undefined) : []
}

/** An authenticated project writer, with a real open work item and no independent fence. */
export function writerBinding(deps: Pick<WorkerPressureDeps, "inspect" | "ctx" | "dsh">, agent: object): WriterBinding | undefined {
  /** Current cell seat and board, never cached across an event. */
  const { caller, board: raw } = deps.inspect(agent)
  /** Only ordinary member authority applies; explicit handoff and verifier modes remain closed. */
  const member = caller.cell?.members[caller.member]
  if (caller.cell === null || caller.seat?.mode !== "member" || member?.mode !== "member" || member.fenced === true || member.handoffReady || member.sessionId !== caller.sessionId) return undefined
  /** Authoritative live board and exact executor handle. */
  const board = recordOf(raw)
  if (typeof board?.teamId !== "string" || board.phase === "ended" || board.endedAt !== undefined) return undefined
  /** The durable roster row must still own this native activation. */
  const row = recordsOf(board.members).find((candidate) => candidate.executorRef === caller.sessionId && candidate.name === caller.member)
  if (typeof row?.projectMemberId !== "string" || row.status === "failed" || row.fenced === true || row.mode === "checkpoint") return undefined
  /** A declared read-only role cannot qualify merely by receiving a write scope. */
  const roles = recordOf(deps.ctx.get?.("mpdRoles", false))
  if (typeof row.role === "string" && typeof roles?.get === "function" && recordOf(roles.get(row.role))?.readonly === true) return undefined
  /** Authenticate the project seat again instead of leasing authority from a caller's name. */
  const service = recordOf(deps.ctx.get?.("mpdProjectIdentity", false))
  if (typeof service?.resolveSeat !== "function") return undefined
  /** The projection binds actual checkout and exact host session to this board and fixed seat. */
  const identity = recordOf(service.resolveSeat({ checkoutRoot: deps.dsh.workspaceRoot({ agent }), sessionId: caller.sessionId }))
  if (identity?.kind !== "member" || typeof identity.projectId !== "string" || identity.seat !== "member" || identity.teamId !== board.teamId || identity.memberId !== row.projectMemberId || identity.projectRoot !== caller.workspace) return undefined
  return { projectId: identity.projectId, workspace: caller.workspace, cellId: caller.cell.cellId, teamId: board.teamId, memberId: row.projectMemberId, sessionId: caller.sessionId, tasks: recordsOf(board.tasks) }
}

/** A writable assignment must be exact, active, and dependency-ready. */
export function writerTask(binding: WriterBinding): WorkerTask | undefined {
  /** All dependency status reads are from this same fresh board snapshot. */
  const { tasks, projectId, workspace, cellId, teamId, memberId, sessionId } = binding
  /** The sole runnable assignment eligible for pressure maintenance on this activation. */
  const eligible = tasks.filter((task) => (task.status === "claimed" || task.status === "in_progress") && task.owner === sessionId && (task.kind === "work" || task.kind === "repair" || task.kind === "integration") && Array.isArray(task.writeScopes) && task.writeScopes.length > 0 && Array.isArray(task.blockedBy) && task.blockedBy.every((id: unknown) => tasks.some((blocker) => blocker.id === id && (blocker.status === "completed" || blocker.status === "failed" || blocker.status === "cancelled"))))
  /** Do not guess which of several assignments this turn is advancing. */
  const task = eligible.length === 1 ? eligible[0] : undefined
  if (typeof task?.id !== "string" || typeof task.attempt !== "number" || typeof task.revision !== "number") return undefined
  /** Token scopes never carry authority across a reassign, rebind, or new attempt. */
  const attemptKey = JSON.stringify([projectId, cellId, teamId, memberId, sessionId, task.id, task.attempt])
  return { key: `${attemptKey}:${task.revision}`, attemptKey, workspace, cellId, teamId, memberId, sessionId, taskId: task.id, attempt: task.attempt, revision: task.revision }
}
