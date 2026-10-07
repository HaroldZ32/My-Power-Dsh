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
  /**
   * Display name the board credits as this task's DECLARED OWNER.
   *
   * It is a PREFERENCE, never a hard key (see {@link planDispatch}): a task whose owner is free is
   * paired with that owner; one whose owner is busy, absent or unnamed falls back to the positional
   * rule, and the fallback is reported on the pairing itself. MEASURED 2026-10-07 on a live board:
   * pairing purely positionally sent T1 (declared owner Plan Reviewer) to Architect and T2
   * (declared owner Architect) to Plan Reviewer — a review task landing on a writer, which is
   * exactly the independence the verification law rests on.
   */
  ownerName?: string
}

/**
 * The name key two member spellings must agree on: lowercase, every run of non-alphanumerics
 * collapsed to one `-`, leading and trailing separators trimmed (`"Plan Reviewer"` →
 * `"plan-reviewer"`).
 *
 * Deliberately the SAME rule as the roster's own `normalizeTeamMemberKey` (mpd-roles-plugin): the
 * board stores a member's DISPLAY name while a caller may spell it any way, and the two spellings
 * must collapse to one key. `dispatch.test.ts` pins the agreement by asserting both functions on the
 * same corpus, so a future edit to either one reddens instead of drifting.
 */
export function dispatchNameKey(name: string): string {
  return String(name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
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
  pairs: Array<{
    /** The dispatched task's id. */
    taskId: string
    /** The task's one-line title, echoed into the dispatch message. */
    subject: string
    /** Session id of the member the pairing records. */
    memberId: string
    /** The paired member's display name. */
    memberName: string
    /**
     * Why this pairing did NOT go to the task's declared owner, when it did not.
     *
     * ABSENT means the pairing is exactly what the board declared (owner honoured, or no owner
     * declared at all). Present means the owner was busy, absent from the roster or unnamed, and the
     * positional rule chose instead — reported here rather than in `skipped`, because the task WAS
     * dispatched; dropping the reason would make a wrong pairing indistinguishable from a right one.
     */
    note?: string
  }>
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
    // MEASURED DEFECT, closed with the terminal verbs: this line used to tell a member to close its
    // row with `team_task_update`, a verb NO member of this composition carries (the official team
    // tool row is disabled in a dsh-tui boot, so the mpd-native plane is the only one — and it had no
    // terminal action at all). A dispatch message that names a tool the recipient does not have is a
    // message that guarantees a stranded row.
    `When it is done, close the row with agent_teams_task {action:"complete", task_id:"${task.id}"} — `
      + `or {action:"fail", task_id:"${task.id}", note:"…"} if you could not finish it — and report the result to the Lead.`,
  ].join("\n")
}

/**
 * Decide one dispatch pass.
 *
 * The pairing rule, in order: a task's DECLARED OWNER when that member is idle and unbooked;
 * otherwise the first free member in roster order, with the fallback and its reason carried on the
 * pairing's `note`. One member is consumed per pairing, so a pass never double-books.
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
    /** The task's declared owner, normalised; the empty string means the board credited none. */
    const ownerKey = dispatchNameKey(task.ownerName ?? "")
    /** Where the declared owner sits in the free pool, or -1 when it is not free. */
    const ownerIndex = ownerKey === "" ? -1 : available.findIndex((candidate) => dispatchNameKey(candidate.name) === ownerKey)
    // OWNER-FIRST, POSITIONAL ONLY AS A FALLBACK (captain ruling, 2026-10-07). A declared owner is
    // PREFERRED: the board's `owner` is the captain's own dispatch decision, and re-deciding it here
    // is what put a review task on a writer. The fallback to roster order is kept because a busy or
    // absent owner must never stall a ready task — but it is REPORTED on the pairing, so a wrong
    // pairing can never read as a right one.
    /** The position this task takes in the free pool: the owner's when it is free, else the first. */
    const memberIndex = ownerIndex >= 0 ? ownerIndex : 0
    /** The member this task is paired with. */
    const member = available[memberIndex]
    available = available.filter((_candidate, index) => index !== memberIndex)
    /** The board's roster entry for the declared owner, used only to spell a fallback reason. */
    const declaredOwner = ownerKey === "" ? undefined : input.members.find((candidate) => dispatchNameKey(candidate.name) === ownerKey)
    plan.pairs.push({
      taskId: task.id,
      subject: task.subject,
      memberId: member.id,
      memberName: member.name,
      ...(ownerIndex >= 0 || ownerKey === "" ? {} : {
        note: "declared owner " + JSON.stringify(String(task.ownerName ?? "")) + " "
          + (declaredOwner === undefined
            ? "is not on this team's roster"
            : busy.has(declaredOwner.id)
              ? "is already working another task"
              : "is not idle (status " + JSON.stringify(declaredOwner.status) + ")")
          + "; paired the next free member " + JSON.stringify(member.name) + " instead",
      }),
    })
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
