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
// THE LEDGER IS TEAM-SCOPED (R1, 2026-10-22). A workspace holds ONE dispatch file and several teams,
// and teams mint their task ids from the same `T1..Tn` space — so a ledger keyed by the bare task id
// made a NEW team inherit the PREVIOUS one's pairings: `agent_teams_dispatch` answered "already
// dispatched to <a member of the old team>" and never recorded the new pairing. Every entry now
// CARRIES its team id and is keyed by `teamId + SEPARATOR + taskId`; the pure helpers below take the
// team as an argument, so one team's pass can neither read nor erase another team's rows.
//
// The two C7 guards (plan amendment 2026-10-14) live HERE, in the pure decision, because this is the
// ONE place a task×member pairing is decided: `agent_teams_dispatch` hands this function one team's
// board and roster, and every pairing it returns is what the pass then delivers and records.
//
// The read-only classification is NOT a local copy of the roster: {@link readonlyMemberKeys} indexes the
// rows mpd-roles-plugin's OWN service publishes (`mpdRoles.list()`, whose `readonly` flag is the same
// flag that decides whether a spawn passes `READONLY_DENY`), and the tool reads that service per call.

import type { TeamMemberMode } from "./team-store"

/** One shared task, as the board reports it. */
export interface DispatchTask {
  /** Board task id; the ledger key pairs it with the team id ({@link ledgerKey}). */
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

/**
 * The pairing rule one pass runs under.
 *
 * `owner-only` is the DEFAULT and the contract's rule: a row is paired with its DECLARED owner or with
 * nobody, and a busy / absent / fenced / failed owner is reported instead of substituted. `roster` keeps
 * the retired positional fallback reachable for the callers that explicitly ask for it — it is never
 * implicit, because a silent substitution is what put a review task on a writer (measured 2026-10-07).
 */
export type DispatchMode = "owner-only" | "roster"

/** One team member, as the roster reports it. */
export interface DispatchMember {
  /** The member's session id, which is what a pairing actually records. */
  id: string
  /** The member's display name, carried into the pairing so a reader recognises it. */
  name: string
  /** Roster status; only `inactive` makes a member a dispatch candidate. */
  status: string
  /**
   * The member's seat mode, when the record carries one (`member` | `checkpoint`).
   *
   * A `checkpoint` seat is the handoff window and is treated like a fence: it must not be messaged.
   * Typed by the STORE's own union (not `string`) so a new seat mode cannot reach this rule untyped.
   */
  mode?: TeamMemberMode
  /** True when the compaction barrier gave up on this member; a fenced seat is NEVER messaged. */
  fenced?: boolean
  /** Why the barrier fenced the member, carried into the report so the repair is actionable. */
  fencedReason?: string
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

/**
 * Why one member's seat must NOT be messaged, or `undefined` when it is a normal open seat.
 *
 * TWO spellings of the same closed state are read, because the team record writes both: the explicit
 * `fenced` marker (the barrier gave up) and `mode: checkpoint` (the member wrote its handoff and must
 * end its turn). MEASURED (D4/D5, carried from cellwork): waking a seat in either state burned the
 * retry budget on a claim its own guard refuses — four deliveries of one ticket, then three handoffs in
 * seven minutes — so the pass REPORTS the owner and leaves the row pending for a reassignment.
 * @param member - the roster row under consideration.
 * @returns the reason sentence, or `undefined` for an open seat.
 */
export function memberFenceReason(member: DispatchMember): string | undefined {
  if (member.fenced === true) {
    return "the compaction barrier gave up and fenced it" + (typeof member.fencedReason === "string" && member.fencedReason !== "" ? " (" + member.fencedReason + ")" : "")
  }
  if (member.mode === "checkpoint") return "its mode is `checkpoint` — the seat is fenced to the handoff tools until the barrier compacts it"
  return undefined
}

/**
 * One task's decision under the OWNER-ONLY rule: the member to pair, or the reason the row stays pending.
 *
 * THE RULE IS THE CONTRACT (D4): a row is paired with its declared owner or with nobody. Every way the
 * owner can be unavailable is a DIFFERENT sentence, because they need different repairs — an absent owner
 * is a roster problem, a busy one is a sequencing problem, and a fenced one is repaired by reassigning the
 * row. The retired engine substituted the next free member in all four cases, which is exactly what
 * handed a review task to a writer.
 * @param task - the ready task under consideration.
 * @param members - the team's whole roster, as the pass sees it.
 * @param available - the members still unpaired in this pass.
 * @param busy - the member ids already booked by the ledger.
 * @param paired - the name keys already paired in this pass.
 * @returns the owner to pair, or the sentence saying why the row was left pending.
 */
function ownerOnlyDecision(
  task: DispatchTask,
  members: readonly DispatchMember[],
  available: readonly DispatchMember[],
  busy: ReadonlySet<string>,
  paired: ReadonlySet<string>,
): { member?: DispatchMember; reason?: string } {
  /** The declared owner, normalised; the empty string means the board credited none. */
  const ownerKey = dispatchNameKey(task.ownerName ?? "")
  if (ownerKey === "") {
    return { reason: "the row declares no owner — owner-only dispatch never substitutes a member (declare `owner` on the row, or run the pass with mode:\"roster\")" }
  }
  /** The roster row the declared owner names. */
  const owner = members.find((candidate) => dispatchNameKey(candidate.name) === ownerKey)
  if (owner === undefined) {
    return { reason: "declared owner " + JSON.stringify(String(task.ownerName ?? "")) + " is not on this team's roster — the row stays pending" }
  }
  /** Why this owner's seat must not be messaged, when it must not. */
  const fence = memberFenceReason(owner)
  if (fence !== undefined) {
    return { reason: "declared owner " + JSON.stringify(owner.name) + " is FENCED (" + fence + ") — a fenced member is never messaged; reassign the row: agent_teams_dispatch {reassign:[{task_id:" + JSON.stringify(task.id) + ", owner:\"<another member>\"}]}" }
  }
  if (owner.status === "failed") return { reason: "declared owner " + JSON.stringify(owner.name) + " FAILED to start" }
  if (owner.status === "provisioning") return { reason: "declared owner " + JSON.stringify(owner.name) + " is still being raised" }
  // THE C7 GUARDS APPLY TO THE OWNER TOO: a read-only owner on a write task (or a cross-team row) is a
  // refusal, not a reason to hand the work to somebody the board never named.
  const refusal = pairingRefusal(task, owner)
  if (refusal !== undefined) return { reason: refusal }
  // Availability is checked LAST so the specific sentences above win over the generic one: a fenced
  // owner is also "not idle", and the fence is the fact the caller must see.
  if (!available.includes(owner)) {
    if (paired.has(ownerKey)) return { reason: "declared owner " + JSON.stringify(owner.name) + " was already paired in this pass (one task per member)" }
    if (busy.has(owner.id)) return { reason: "declared owner " + JSON.stringify(owner.name) + " is BUSY on another task — reported, never substituted" }
    return { reason: "declared owner " + JSON.stringify(owner.name) + " is not idle (status " + JSON.stringify(owner.status) + ")" }
  }
  return { member: owner }
}

/** One recorded pairing: which member is working which task, since when. */
export interface DispatchAssignment {
  /**
   * The team the pairing belongs to.
   *
   * PART OF THE ENTRY, not only of the key, so a reader can scope a row without parsing a string and
   * an entry written by an older build (no `teamId`) is recognisable as the LEGACY row it is.
   */
  teamId: string
  /** The dispatched task's id — also half of the ledger key that makes it claimed. */
  taskId: string
  /** Session id of the member that owns the task, which is what makes that member busy. */
  memberId: string
  /** The owning member's display name, so a later skip reason can name it. */
  memberName: string
  /** ISO instant the pairing was recorded; for ordering and diagnostics, never a timeout. */
  assignedAt: string
}

/** The dispatch ledger: the sidecar that makes "in flight" knowable, for every team in one workspace. */
export type DispatchLedger = Record<string, DispatchAssignment>

/**
 * The separator between the team id and the task id in a ledger key.
 *
 * A team id is `team-<stamp>-<suffix>` and a task id is `T<n>`, so neither side contains `::`. The
 * separator is never parsed back anyway: every entry carries its own `teamId`, and the key exists only
 * so two teams reusing one task id cannot collide.
 */
export const DISPATCH_KEY_SEPARATOR = "::"

/**
 * The ledger key one pairing is stored under: the team id, the separator and the task id.
 * @param teamId - the team the pairing belongs to.
 * @param taskId - the task the pairing records.
 * @returns the composite key.
 */
export function ledgerKey(teamId: string, taskId: string): string {
  return teamId + DISPATCH_KEY_SEPARATOR + taskId
}

/**
 * One team's view of a ledger: its own entries, keyed as stored.
 *
 * The dispatch engine must never see another team's rows: `busy` and `claimed` are computed from the
 * ledger, so a foreign row would book a member this team does not own (or claim a task id it has not
 * dispatched). The rows of other teams stay in the FILE untouched — pruning is their own pass's work.
 * @param ledger - the whole ledger as read from disk.
 * @param teamId - the team whose rows are wanted.
 * @returns a new ledger holding only that team's entries.
 */
export function ledgerOfTeam(ledger: DispatchLedger, teamId: string): DispatchLedger {
  /** The team-scoped view being built. */
  const view: DispatchLedger = {}
  for (const [key, entry] of Object.entries(ledger)) {
    if (entry?.teamId === teamId) view[key] = entry
  }
  return view
}

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
 * TWO MODES, one default. Under `owner-only` (the default, and the contract's rule) a task is paired with
 * its DECLARED OWNER when that member is idle, unbooked, unfenced and eligible; every other outcome is a
 * REPORTED skip and the row stays pending for a human or a reassignment. Under `roster` — reachable ONLY
 * by asking for it explicitly — the retired rule survives: the owner first, otherwise the first free
 * member in roster order, with the substitution carried on the pairing's `note`. One member is consumed
 * per pairing, so a pass never double-books; a fenced or checkpointed seat is NEVER messaged in either
 * mode.
 *
 * @param input - the board, the roster, the ledger, the hold, the cap and the pairing mode.
 * @returns the pairs to dispatch and, for every other considered task, why it was skipped.
 */
export function planDispatch(input: {
  tasks: readonly DispatchTask[]
  members: readonly DispatchMember[]
  /** The ledger as ONE team sees it ({@link ledgerOfTeam}): other teams' rows must not book this pass. */
  ledger: DispatchLedger
  /** The halt reason when the team is held; a non-empty string refuses the whole pass. */
  hold?: string
  /** Cap on pairs per pass; `0` means no cap. */
  limit?: number
  /** The pairing rule; absent means `owner-only`. */
  mode?: DispatchMode
}): DispatchPlan {
  if (input.hold !== undefined && input.hold !== "") {
    return { pairs: [], skipped: [], halted: input.hold }
  }
  /** The pairing rule this pass runs under: the explicit mode, or the owner-only default. */
  const mode: DispatchMode = input.mode ?? "owner-only"
  /** Member ids already holding a task, so one pass never double-books a member (this team's rows only). */
  const busy = new Set(
    Object.values(input.ledger)
      .filter((entry) => entry.taskId !== "" && entry.memberId !== "")
      .map((entry) => entry.memberId),
  )
  /** Task ids the ledger already records, so a second pass cannot re-dispatch a task (this team's view). */
  const claimed = new Set(Object.values(input.ledger).map((entry) => entry.taskId))
  // A FENCED SEAT IS NEVER A CANDIDATE, in either mode: the record says the barrier gave up or the member
  // is inside its handoff window, and a message to it could only be refused by that member's own guard.
  /** Roster members that are idle, unbooked and unmessaged — the pool this pass draws from. */
  const candidates = input.members.filter((member) => member.status === "inactive" && !busy.has(member.id) && memberFenceReason(member) === undefined)
  /** The decision being built; every considered task lands in one of its two lists. */
  const plan: DispatchPlan = { pairs: [], skipped: [] }
  /** The still-unpaired candidates, shrinking as the pass consumes them. */
  let available = [...candidates]
  /** The name keys this pass already paired, so one member takes at most one task per pass. */
  const paired = new Set<string>()
  /** Effective per-pass pair limit; absent or non-positive means unlimited. */
  const cap = input.limit === undefined || input.limit <= 0 ? Number.POSITIVE_INFINITY : input.limit

  for (const task of input.tasks) {
    if (plan.pairs.length >= cap) {
      plan.skipped.push({ taskId: task.id, subject: task.subject, reason: "the pass reached its limit" })
      continue
    }
    // A CANCELLED ROW NEVER DISPATCHES (wave W2 gap 2). It is TERMINAL by the caller's own decision, so it
    // must leave the ready set with its own reason — without this branch a cancelled row that is still
    // `pending`-shaped would be reported as "not ready", which reads like a blocking problem rather than
    // what it is. The reason is the ONE word the contract names, so a reader (and a skip-filter) can match
    // it exactly.
    if (task.status === "cancelled") {
      plan.skipped.push({ taskId: task.id, subject: task.subject, reason: "cancelled" })
      continue
    }
    if (task.status === "completed") {
      plan.skipped.push({ taskId: task.id, subject: task.subject, reason: "already completed" })
      continue
    }
    if (claimed.has(task.id)) {
      plan.skipped.push({ taskId: task.id, subject: task.subject, reason: `already dispatched to ${Object.values(input.ledger).find((entry) => entry.taskId === task.id)?.memberName ?? "a member"}` })
      continue
    }
    if (task.ready !== true) {
      // Not a refusal: a blocked task becomes dispatchable on a later pass, once its blockers close.
      plan.skipped.push({ taskId: task.id, subject: task.subject, reason: `not ready${Array.isArray(task.blockedBy) && task.blockedBy.length > 0 ? " (blocked by " + task.blockedBy.join(", ") + ")" : ""}` })
      continue
    }
    // ── THE DEFAULT RULE: OWNER-ONLY (D4) ──
    if (mode === "owner-only") {
      /** This task's owner-only decision: the member to pair, or why the row stays pending. */
      const decision = ownerOnlyDecision(task, input.members, available, busy, paired)
      if (decision.member === undefined) {
        plan.skipped.push({ taskId: task.id, subject: task.subject, reason: decision.reason ?? "no eligible declared owner" })
        continue
      }
      /** The declared owner this task is paired with. */
      const owner = decision.member
      available = available.filter((candidate) => candidate !== owner)
      paired.add(dispatchNameKey(owner.name))
      plan.pairs.push({ taskId: task.id, subject: task.subject, memberId: owner.id, memberName: owner.name })
      continue
    }
    // ── THE EXPLICIT FALLBACK: ROSTER ORDER (mode:"roster") ──
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
    // OWNER-FIRST, POSITIONAL AS THE EXPLICIT FALLBACK (captain ruling, 2026-10-07; demoted to
    // `mode:"roster"` by D4). A declared owner is PREFERRED: the board's `owner` is the captain's own
    // dispatch decision, and re-deciding it is what put a review task on a writer. The positional rule
    // survives only here, and its reason is REPORTED on the pairing, so a wrong pairing never reads as
    // a right one.
    /** The position this task takes in the eligible pool: the owner's when it is free and eligible, else the first. */
    const memberIndex = ownerIndex >= 0 ? ownerIndex : 0
    /** The member this task is paired with. */
    const member = eligible[memberIndex]
    available = available.filter((candidate) => candidate !== member)
    paired.add(dispatchNameKey(member.name))
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
 * One `reassign` pair: the row being handed over and the member it goes to.
 *
 * This is the REPAIR path the owner-only rule needs: a fenced, failed or departed owner leaves a ready
 * row that no pass may pair, and substituting silently is exactly what the rule forbids — so the captain
 * names the new owner instead.
 */
export interface ReassignPair {
  /** The board row being handed over. */
  taskId: string
  /** The member the row is claimed FOR and delivered to. */
  owner: string
}

/**
 * Read the `reassign` argument of a dispatch call without trusting its shape.
 *
 * The harness validates the tool schema, but the action is also reachable from the service and the HTTP
 * route, so every entry is checked here: a blank id, a blank owner, or the same row named twice is
 * REPORTED as one sentence (the readable entries still apply) rather than thrown.
 * @param value - the raw argument value.
 * @returns the readable pairs, and one sentence per entry this build refused.
 */
export function readReassign(value: unknown): { pairs: ReassignPair[]; invalid: string[] } {
  /** The readable pairs, in the caller's order. */
  const pairs: ReassignPair[] = []
  /** One sentence per entry that could not be read. */
  const invalid: string[] = []
  if (value === undefined) return { pairs, invalid }
  if (!Array.isArray(value)) return { pairs, invalid: ["`reassign` must be an array of {task_id, owner} objects"] }
  /** The task ids already asked for, so one row is never claimed twice in one call. */
  const seen = new Set<string>()
  for (const entry of value) {
    /** The entry read as a record, or undefined when it is not a plain object. */
    const row = typeof entry === "object" && entry !== null && !Array.isArray(entry) ? entry as Record<string, unknown> : undefined
    // TWO SPELLINGS, ONE READING: the TOOL's wire shape is `task_id` (snake, like every other tool
    // argument), while a TypeScript SERVICE caller writes `taskId` (the shape its own interface declares).
    // The validator is the ONE place both surfaces meet, so it accepts both rather than making a service
    // caller translate into the wire dialect it never sees.
    /** The board id this entry names, trimmed, from either spelling. */
    const taskId = typeof row?.task_id === "string" ? row.task_id.trim() : typeof row?.taskId === "string" ? row.taskId.trim() : ""
    /** The member name this entry names, trimmed. */
    const owner = typeof row?.owner === "string" ? row.owner.trim() : ""
    if (taskId === "" || owner === "") {
      invalid.push("every `reassign` entry needs a non-empty `task_id` and `owner` (got " + JSON.stringify(entry) + ")")
      continue
    }
    if (seen.has(taskId)) {
      invalid.push("task " + JSON.stringify(taskId) + " is named twice in `reassign` — one claim per row per call")
      continue
    }
    seen.add(taskId)
    pairs.push({ taskId, owner })
  }
  return { pairs, invalid }
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
export function assign(ledger: DispatchLedger, pair: { teamId: string; taskId: string; memberId: string; memberName: string }, now: Date): DispatchLedger {
  return {
    ...ledger,
    [ledgerKey(pair.teamId, pair.taskId)]: {
      teamId: pair.teamId,
      taskId: pair.taskId,
      memberId: pair.memberId,
      memberName: pair.memberName,
      assignedAt: now.toISOString(),
    },
  }
}

/**
 * Free one team's pairing, so the task can be dispatched again.
 *
 * ONLY that team's row is removed: a release is issued from one team's board and must never free a
 * same-named task of another team in the same workspace.
 * @param ledger - the whole ledger.
 * @param teamId - the team whose pairing is freed.
 * @param taskId - the task the pairing records.
 * @returns the new ledger and whether an entry was actually there.
 */
export function release(ledger: DispatchLedger, teamId: string, taskId: string): { ledger: DispatchLedger; released: boolean } {
  /** The composite key this release names; nothing else is touched. */
  const key = ledgerKey(teamId, taskId)
  if (ledger[key] === undefined) return { ledger, released: false }
  /** A copy, so releasing never mutates the caller's own ledger. */
  const next = { ...ledger }
  delete next[key]
  return { ledger: next, released: true }
}

/**
 * Drop every entry that belongs to a team whose record is TERMINAL.
 *
 * Anchored on the ONE terminal write path (`team-lifecycle.ts#reapReapedTeams`), which reports the
 * team ids it ended; this consumer prunes their rows, so a later team that reuses the ids cannot
 * inherit a dead pairing. LEGACY rows are NOT this function's business — they belong to no team and
 * are dropped (and reported) by {@link reconcile} on the first pass that touches the ledger.
 * @param ledger - the whole ledger.
 * @param teamId - the terminal team whose rows are forgotten.
 * @returns the new ledger and the task ids it forgot.
 */
export function forgetTeam(ledger: DispatchLedger, teamId: string): { ledger: DispatchLedger; forgotten: string[] } {
  /** The ledger with the ended team's rows left out. */
  const next: DispatchLedger = {}
  /** The task ids dropped, reported so the caller can log the loss. */
  const forgotten: string[] = []
  for (const [key, entry] of Object.entries(ledger)) {
    if (entry?.teamId !== teamId) {
      next[key] = entry
      continue
    }
    forgotten.push(typeof entry.taskId === "string" && entry.taskId !== "" ? entry.taskId : key)
  }
  return { ledger: next, forgotten }
}

/**
 * Prune ONE team's ledger rows against its own board, and drop the LEGACY rows no team owns.
 *
 * A board is edited by people: a task can be deleted or reach a terminal status out of band. Without
 * this the ledger would keep its member "busy" forever and the team would drain to a standstill — the
 * failure the retired scheduler hit and never recovered from.
 *
 * TWO SCOPES, stated because the difference is the fix:
 *   * THIS team's rows are pruned against THIS team's board;
 *   * every OTHER team's rows are COPIED THROUGH untouched (pruning them here would erase a live
 *     pairing of a team this pass knows nothing about);
 *   * a row with NO `teamId` is a LEGACY row from the pre-R1 bare-key ledger. It cannot be attributed
 *     to any team, so it is DROPPED and reported in `forgotten` — the whole migration, on the first
 *     pass, with no script to run.
 * @param ledger - the whole ledger as read from disk.
 * @param teamId - the team whose own rows are pruned.
 * @param tasks - that team's board, as the dispatch engine sees it.
 * @returns the pruned ledger and the task ids it forgot.
 */
export function reconcile(ledger: DispatchLedger, teamId: string, tasks: readonly DispatchTask[]): { ledger: DispatchLedger; forgotten: string[] } {
  /** The board indexed by task id, so the prune costs one lookup per ledger entry. */
  const byId = new Map(tasks.map((task) => [task.id, task]))
  /** The pruned ledger; live rows of every team survive. */
  const next: DispatchLedger = {}
  /** Task ids dropped from the ledger, reported so a caller can log the loss. */
  const forgotten: string[] = []
  for (const [key, entry] of Object.entries(ledger)) {
    // THE LEGACY DROP: no team id means the row was written before the ledger was team-scoped. It is
    // reported by TASK id (the key's only readable half) so the caller's `forgotten` list stays usable.
    if (typeof entry?.teamId !== "string" || entry.teamId === "") {
      forgotten.push(typeof entry?.taskId === "string" && entry.taskId !== "" ? entry.taskId : key)
      continue
    }
    if (entry.teamId !== teamId) {
      next[key] = entry
      continue
    }
    /** The board's current record for this entry; absent means the task no longer exists. */
    const task = byId.get(entry.taskId)
    // TERMINAL, not only `completed`: a failed or cancelled row has no work in flight either, and a
    // row that kept its pairing would hold the member out of the pool until the next release.
    if (task === undefined || task.status === "completed" || task.status === "failed" || task.status === "cancelled") {
      forgotten.push(entry.taskId)
      continue
    }
    next[key] = entry
  }
  return { ledger: next, forgotten }
}
