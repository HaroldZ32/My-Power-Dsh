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
//
// The two C7 guards (plan amendment 2026-10-14) live HERE, in the pure decision, because this is the
// ONE place a task×member pairing is decided: `agent_teams_dispatch` hands this function one team's
// board and roster, and every pairing it returns is what the pass then delivers and records.
//
// The read-only classification is NOT a local copy of the roster: {@link readonlyMemberKeys} indexes the
// rows mpd-roles-plugin's OWN service publishes (`mpdRoles.list()`, whose `readonly` flag is the same
// flag that decides whether a spawn passes `READONLY_DENY`), and the tool reads that service per call.

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
  /**
   * The team this task belongs to, when the caller knows it.
   *
   * C7-1: a pairing may never cross teams. ABSENT means "not declared" and is treated as compatible
   * (fail-open), so a caller that does not tag its board keeps its previous behaviour exactly.
   */
  teamId?: string
  /**
   * The paths this task is expected to WRITE.
   *
   * C7-2: a task whose `writeScopes` is non-empty may not be paired with a read-only specialist — its
   * whole discipline denies `write`/`edit`/`bash`, so the attempt could only end in a failed row.
   */
  writeScopes?: readonly string[]
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

/** One roster row as the read-only classification needs it — the shape `mpdRoles.list()` publishes. */
export interface RosterRow {
  /** The roster's MODEL-FACING display name (the name a Lead addresses the member by). */
  name: string
  /** True for the members the read-only discipline protects (the flag that also gates `READONLY_DENY`). */
  readonly?: boolean
}

/**
 * Index the READ-ONLY rows of a roster into the key set {@link isReadonlyMemberName} matches.
 *
 * The rows come from mpd-roles-plugin's OWN published service (`mpdRoles.list()`), so the dispatch guard
 * reads the roster rather than copying its membership — the `readonly` flag is exactly the one that
 * decides whether a spawn passes `READONLY_DENY`, and the two surfaces therefore cannot drift.
 * @param rows - the roster rows, from whichever roster surface the caller reads.
 * @returns the normalised keys of every read-only row.
 */
export function readonlyMemberKeys(rows: readonly RosterRow[]): ReadonlySet<string> {
  /** The accumulated read-only keys. */
  const keys = new Set<string>()
  for (const row of rows) {
    if (row?.readonly !== true) continue
    /** This row's normalised key; an empty one addresses nothing and is skipped. */
    const key = dispatchNameKey(row.name)
    if (key !== "") keys.add(key)
  }
  return keys
}

/**
 * Whether a team-member spelling addresses a READ-ONLY member of the given roster key set.
 *
 * Two spellings address a member: the exact normalised name (`"Plan Reviewer"` / `"plan-reviewer"`), and
 * that name with ONE trailing numeric suffix (`"explorer-2"`), the spelling a Lead may use when it stages
 * the same member twice. Without the suffix clause the C7-2 guard would be bypassable by appending a
 * digit — the same defect class the team-path tool guard closes.
 * @param name - the member spelling to classify.
 * @param keys - the read-only key set ({@link readonlyMemberKeys}).
 * @returns true for a read-only member, false for a worker, an unknown name or an empty spelling.
 */
export function isReadonlyMemberName(name: string, keys: ReadonlySet<string>): boolean {
  /** The caller's normalised name. */
  const key = dispatchNameKey(name)
  if (key === "") return false
  if (keys.has(key)) return true
  /** The name with one trailing numeric suffix removed — the second accepted spelling. */
  const withoutSuffix = key.replace(/-\d+$/, "")
  return withoutSuffix !== key && withoutSuffix !== "" && keys.has(withoutSuffix)
}

/** One team member, as the roster reports it. */
export interface DispatchMember {
  /** The member's session id, which is what a pairing actually records. */
  id: string
  /** The member's display name, carried into the pairing so a reader recognises it. */
  name: string
  /** Roster status; only `inactive` makes a member a dispatch candidate. */
  status: string
  /**
   * The team this member belongs to, when the caller knows it.
   *
   * C7-1: compared against the task's own `teamId`; ABSENT means "not declared" and is compatible.
   */
  teamId?: string
  /**
   * True when this member is one of the roster's READ-ONLY specialists.
   *
   * C7-2: never paired with a task carrying write scopes. `undefined` means "not declared" and is
   * treated as write-capable (fail-open), so an untagged roster keeps its previous behaviour.
   */
  readonly?: boolean
}

/**
 * Refuse ONE task×member pairing, or return `undefined` when the pairing is allowed.
 *
 * Pure and total: it reads only the task and the member, never the ledger, and it never throws. The two
 * MEASURED defects it closes (plan amendment C7, 2026-10-14):
 *
 *   * C7-1 CROSS-TEAM — the workspace-wide idle pool carried stale members of OTHER, terminal teams, so
 *     a task was handed to a member that belonged to a different team. BOTH ids are named in the refusal
 *     so a reader can see which teams collided.
 *   * C7-2 READ-ONLY — a task with non-empty `writeScopes` was paired with a read-only specialist (Plan
 *     Reviewer), whose whole discipline denies `write`/`edit`/`bash`. A write task on a read-only member
 *     can only end in a failed attempt.
 *
 * FAIL-OPEN on missing evidence, deliberately: an absent `teamId` on either side or an absent `readonly`
 * flag is NOT a reason to refuse, so a caller that has not declared either keeps the pairing behaviour
 * it had before this guard existed — the gate may not over-block (the negative-control arm).
 *
 * @param task - the ready task under consideration.
 * @param member - the free member the pairing would record.
 * @returns the refusal sentence, or `undefined` when the pairing is allowed.
 */
export function pairingRefusal(task: DispatchTask, member: DispatchMember): string | undefined {
  if (task.teamId !== undefined && member.teamId !== undefined && task.teamId !== member.teamId) {
    return `refused a CROSS-TEAM pairing: task ${task.id} belongs to ${task.teamId} while member ${JSON.stringify(member.name)} belongs to ${member.teamId}`
  }
  if (task.writeScopes !== undefined && task.writeScopes.length > 0 && member.readonly === true) {
    return `refused a WRITE-TASK-ON-READ-ONLY pairing: task ${task.id} has write scopes (${task.writeScopes.join(", ")}) while member ${JSON.stringify(member.name)} is a read-only specialist`
  }
  return undefined
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
    // THE C7 GUARDS (plan amendment 2026-10-14). A member a guard refuses never enters THIS task's pool,
    // and when the guards refuse every free member the task is REPORTED with the reason — the fallback
    // must never "grab a wrong-but-free member".
    /** The free members this task may legally pair with: same team, and write-capable for a write task. */
    const eligible = available.filter((candidate) => pairingRefusal(task, candidate) === undefined)
    if (eligible.length === 0) {
      plan.skipped.push({ taskId: task.id, subject: task.subject, reason: refusalSummary(task, available) })
      continue
    }
    /** The task's declared owner, normalised; the empty string means the board credited none. */
    const ownerKey = dispatchNameKey(task.ownerName ?? "")
    /** Where the declared owner sits in the ELIGIBLE pool, or -1 when it is neither free nor eligible. */
    const ownerIndex = ownerKey === "" ? -1 : eligible.findIndex((candidate) => dispatchNameKey(candidate.name) === ownerKey)
    // OWNER-FIRST, POSITIONAL ONLY AS A FALLBACK (captain ruling, 2026-10-07). A declared owner is
    // PREFERRED: the board's `owner` is the captain's own dispatch decision, and re-deciding it here
    // is what put a review task on a writer. The fallback to roster order is kept because a busy,
    // absent or GUARD-REFUSED owner must never stall a ready task — but it is REPORTED on the pairing,
    // so a wrong pairing can never read as a right one.
    /** The position this task takes in the eligible pool: the owner's when it is free and eligible, else the first. */
    const memberIndex = ownerIndex >= 0 ? ownerIndex : 0
    /** The member this task is paired with. */
    const member = eligible[memberIndex]
    available = available.filter((candidate) => candidate !== member)
    /** The board's roster entry for the declared owner, used only to spell a fallback reason. */
    const declaredOwner = ownerKey === "" ? undefined : input.members.find((candidate) => dispatchNameKey(candidate.name) === ownerKey)
    /** Why the declared owner was passed over by a GUARD, when it was — reported distinctly from busy/absent. */
    const ownerRefusal = declaredOwner === undefined ? undefined : pairingRefusal(task, declaredOwner)
    plan.pairs.push({
      taskId: task.id,
      subject: task.subject,
      memberId: member.id,
      memberName: member.name,
      ...(ownerIndex >= 0 || ownerKey === "" ? {} : {
        note: "declared owner " + JSON.stringify(String(task.ownerName ?? "")) + " "
          + (ownerRefusal !== undefined
            ? "was passed over by a dispatch guard (" + ownerRefusal + ")"
            : declaredOwner === undefined
              ? "is not on this team's roster"
              : busy.has(declaredOwner.id)
                ? "is already working another task"
                : "is not idle (status " + JSON.stringify(declaredOwner.status) + ")")
          + "; paired the next eligible member " + JSON.stringify(member.name) + " instead",
      }),
    })
  }
  return plan
}

/**
 * The ONE skip sentence for a task whose every free member a guard refused.
 *
 * Only guard refusals can reach here: a non-empty pool with no refusal at all yields an eligible member
 * and never calls this. The sentence is the deduplicated union of those refusals, in roster order, so the
 * reason is REPORTED rather than a wrong-but-free member being grabbed.
 * @param task - the task that could not be paired.
 * @param members - the free members, every one of which a guard refused.
 * @returns the refusal sentence(s), deduplicated and joined with `"; "`.
 */
function refusalSummary(task: DispatchTask, members: readonly DispatchMember[]): string {
  /** The distinct refusals, in the order the roster listed them. */
  const reasons = new Set<string>()
  for (const member of members) {
    /** This member's refusal; every member here has one, but the guard is total and may answer `undefined`. */
    const refusal = pairingRefusal(task, member)
    if (refusal !== undefined) reasons.add(refusal)
  }
  return [...reasons].join("; ")
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
