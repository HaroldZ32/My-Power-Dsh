// The DISPATCH decision, kept pure so the whole pairing rule is unit-testable without a harness, a
// team or a model.
//
// WHY IT EXISTS. The retired vendored body carried a scheduler that assigned ready work to idle
// members by itself. The official plugin has no such thing: its board records tasks and its roster
// records members, and NOTHING connects the two — a captain either pairs them by hand or the team
// sits still while tasks go ready. This is that pairing, with the two rules the retired scheduler's
// post-mortems demanded:
//
//   1. ONE pass pairs each ready task with ONE idle member and records the pairing, so a second pass
//      cannot hand the same task to a second teammate (the measured failure of the retired
//      auto-claim path: two members started the same task because the assignment lived only in the
//      message, and messages are not a ledger).
//   2. A HALT stops dispatch and nothing else — no member is interrupted, no task is rewritten.
//
// A teammate that finishes its task reports it; the ledger entry is what says a task is in flight, so
// `releaseTask` is the one call that frees a pairing again.

/** One shared task, as the board reports it. */
export interface DispatchTask {
  id: string
  subject: string
  status: string
  ready: boolean
  blockedBy?: readonly string[]
  ownerName?: string
}

/** One team member, as the roster reports it. */
export interface DispatchMember {
  id: string
  name: string
  status: string
}

/** One recorded pairing: which member is working which task, since when. */
export interface DispatchAssignment {
  taskId: string
  memberId: string
  memberName: string
  assignedAt: string
}

/** The dispatch ledger: the sidecar that makes "in flight" knowable. */
export type DispatchLedger = Record<string, DispatchAssignment>

/** What one pass decided, and why it decided nothing for the rest. */
export interface DispatchPlan {
  pairs: Array<{ taskId: string; subject: string; memberId: string; memberName: string }>
  /** One line per task that was NOT paired, naming the task and the reason. */
  skipped: Array<{ taskId: string; subject: string; reason: string }>
  /** The whole pass refused because the team is halted. */
  halted?: string
}

/** The message a dispatched member receives: the task, its acceptance text, and how to report back. */
export function dispatchMessage(task: DispatchTask, description: string): string {
  return [
    `You have been assigned shared task ${task.id}: ${task.subject}`,
    "",
    description,
    "",
    "Work it on your own; do not wait for another member to start it.",
    `When it is done, report the result to the Lead and mark task ${task.id} completed with team_task_update.`,
  ].join("\n")
}

/**
 * Decide one dispatch pass.
 *
 * @param input - the board, the roster, the ledger and the hold.
 * @returns the pairs to dispatch and, for every other considered task, why it was skipped.
 */
export function planDispatch(input: {
  tasks: readonly DispatchTask[]
  members: readonly DispatchMember[]
  ledger: DispatchLedger
  /** The halt reason when the team is held; a non-empty string refuses the whole pass. */
  hold?: string
  /** Cap on pairs per pass; `0` means no cap. */
  limit?: number
}): DispatchPlan {
  if (input.hold !== undefined && input.hold !== "") {
    return { pairs: [], skipped: [], halted: input.hold }
  }
  const busy = new Set(
    Object.values(input.ledger)
      .filter((entry) => entry.taskId !== "" && entry.memberId !== "")
      .map((entry) => entry.memberId),
  )
  const claimed = new Set(Object.keys(input.ledger))
  const candidates = input.members.filter((member) => member.status === "inactive" && !busy.has(member.id))
  const plan: DispatchPlan = { pairs: [], skipped: [] }
  let available = [...candidates]
  const cap = input.limit === undefined || input.limit <= 0 ? Number.POSITIVE_INFINITY : input.limit

  for (const task of input.tasks) {
    if (plan.pairs.length >= cap) {
      plan.skipped.push({ taskId: task.id, subject: task.subject, reason: "the pass reached its limit" })
      continue
    }
    if (task.status === "completed") {
      plan.skipped.push({ taskId: task.id, subject: task.subject, reason: "already completed" })
      continue
    }
    if (claimed.has(task.id)) {
      plan.skipped.push({ taskId: task.id, subject: task.subject, reason: `already dispatched to ${input.ledger[task.id]?.memberName ?? "a member"}` })
      continue
    }
    if (task.ready !== true) {
      // Not a refusal: a blocked task becomes dispatchable on a later pass, once its blockers close.
      plan.skipped.push({ taskId: task.id, subject: task.subject, reason: `not ready${Array.isArray(task.blockedBy) && task.blockedBy.length > 0 ? " (blocked by " + task.blockedBy.join(", ") + ")" : ""}` })
      continue
    }
    if (available.length === 0) {
      plan.skipped.push({ taskId: task.id, subject: task.subject, reason: "no idle member is free" })
      continue
    }
    const member = available[0]
    available = available.slice(1)
    plan.pairs.push({ taskId: task.id, subject: task.subject, memberId: member.id, memberName: member.name })
  }
  return plan
}

/** Record one pairing. Returns a NEW ledger; the caller owns persisting it. */
export function assign(ledger: DispatchLedger, pair: { taskId: string; memberId: string; memberName: string }, now: Date): DispatchLedger {
  return {
    ...ledger,
    [pair.taskId]: { taskId: pair.taskId, memberId: pair.memberId, memberName: pair.memberName, assignedAt: now.toISOString() },
  }
}

/**
 * Free one pairing, so the task can be dispatched again.
 *
 * @returns the new ledger and whether an entry was actually there.
 */
export function release(ledger: DispatchLedger, taskId: string): { ledger: DispatchLedger; released: boolean } {
  if (ledger[taskId] === undefined) return { ledger, released: false }
  const next = { ...ledger }
  delete next[taskId]
  return { ledger: next, released: true }
}

/**
 * Drop ledger entries for tasks that no longer exist, or that are terminal.
 *
 * A board is edited by people: a task can be deleted or completed out of band. Without this the
 * ledger would keep its member "busy" forever and the team would drain to a standstill — the failure
 * the retired scheduler hit and never recovered from.
 *
 * @returns the pruned ledger and the ids it forgot.
 */
export function reconcile(ledger: DispatchLedger, tasks: readonly DispatchTask[]): { ledger: DispatchLedger; forgotten: string[] } {
  const byId = new Map(tasks.map((task) => [task.id, task]))
  const next: DispatchLedger = {}
  const forgotten: string[] = []
  for (const [taskId, entry] of Object.entries(ledger)) {
    const task = byId.get(taskId)
    if (task === undefined || task.status === "completed") {
      forgotten.push(taskId)
      continue
    }
    next[taskId] = entry
  }
  return { ledger: next, forgotten }
}
