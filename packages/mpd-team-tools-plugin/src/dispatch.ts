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
  /** Board task id; the ledger is keyed by exactly this value. */
  id: string
  /** The task's one-line title, echoed into the dispatch message and every skip reason. */
  subject: string
  /** Official board status; `completed` is the only value this pass reads as done. */
  status: string
  /** Whether the board considers the task dispatchable; `false` or absent skips it, it never refuses the pass. */
  ready: boolean
  /** Ids of the tasks still blocking this one, listed in the skip reason. */
  blockedBy?: readonly string[]
  /** Display name the board credits, when it credits one — informational, never the pairing key. */
  ownerName?: string
}

/** One team member, as the roster reports it. */
export interface DispatchMember {
  /** The member's session id, which is what a pairing actually records. */
  id: string
  /** The member's display name, carried into the pairing so a reader recognises it. */
  name: string
  /** Roster status; only `inactive` makes a member a dispatch candidate. */
  status: string
}

/** One recorded pairing: which member is working which task, since when. */
export interface DispatchAssignment {
  /** The dispatched task's id — also the ledger key that makes it claimed. */
  taskId: string
  /** Session id of the member that owns the task, which is what makes that member busy. */
  memberId: string
  /** The owning member's display name, so a later skip reason can name it. */
  memberName: string
  /** ISO instant the pairing was recorded; for ordering and diagnostics, never a timeout. */
  assignedAt: string
}

/** The dispatch ledger: the sidecar that makes "in flight" knowable. */
export type DispatchLedger = Record<string, DispatchAssignment>

/** What one pass decided, and why it decided nothing for the rest. */
export interface DispatchPlan {
  /** The pairings this pass decided, in board order. */
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
  /** Member ids already holding a task, so one pass never double-books a member. */
  const busy = new Set(
    Object.values(input.ledger)
      .filter((entry) => entry.taskId !== "" && entry.memberId !== "")
      .map((entry) => entry.memberId),
  )
  /** Task ids the ledger already records, so a second pass cannot re-dispatch a task. */
  const claimed = new Set(Object.keys(input.ledger))
  /** Roster members that are idle and unbooked — the pool this pass draws from. */
  const candidates = input.members.filter((member) => member.status === "inactive" && !busy.has(member.id))
  /** The decision being built; every considered task lands in one of its two lists. */
  const plan: DispatchPlan = { pairs: [], skipped: [] }
  /** The still-unpaired candidates, shrinking as the pass consumes them. */
  let available = [...candidates]
  /** Effective per-pass pair limit; absent or non-positive means unlimited. */
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
    /** The next free candidate, taken in roster order so a pass is deterministic. */
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
  /** A copy, so releasing never mutates the caller's own ledger. */
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
  /** The board indexed by task id, so the prune costs one lookup per ledger entry. */
  const byId = new Map(tasks.map((task) => [task.id, task]))
  /** The pruned ledger; only live, non-terminal tasks survive. */
  const next: DispatchLedger = {}
  /** Task ids dropped from the ledger, reported so a caller can log the loss. */
  const forgotten: string[] = []
  for (const [taskId, entry] of Object.entries(ledger)) {
    /** The board's current record for this entry; absent means the task no longer exists. */
    const task = byId.get(taskId)
    if (task === undefined || task.status === "completed") {
      forgotten.push(taskId)
      continue
    }
    next[taskId] = entry
  }
  return { ledger: next, forgotten }
}
