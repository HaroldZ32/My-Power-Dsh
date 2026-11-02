// The team ACTIONS, exec-free so a button is enough: approve a staged plan and run a dispatch pass.
//
// WHY THEY MOVED OUT OF THE TOOL HANDLERS. Both actions used to live inline in
// `agent_teams_plan {action:"approve"}` and `agent_teams_dispatch {action:"run"}`, which meant the only
// surface that could drive a team was a model turn carrying a live tool-call context: an `exec` whose
// `agent` spawns and sends. A browser panel, a phone or a native DSH Go panel has no such context, and
// synthesising one would have made every caller re-invent the validation order. The bodies therefore
// moved HERE verbatim — same validation order, same store writes, same ordering of spawn/send/write/
// archive, same reply fields — and the caller is now an explicit value instead of a tool exec.
//
// THE ONE PERMITTED DIFFERENCE. When `caller.agent` is absent the action refuses with one sentence
// (`approve needs a live agent` / `dispatch needs a live agent`) BEFORE any store write. A tool caller
// always carries an agent, so its behaviour is unchanged; a route that has no live session must never
// spawn or send, and it must never half-write a team to discover that.
//
// AND TWO SURFACE-DRIVEN ADDITIONS (CodeRabbit review of PR #88, plan §4.2 amendments 1–2):
//   1. An IN-FLIGHT SLOT per action, keyed by workspace + session, refused before the first await.
//      Approval and dispatch used to be reachable only from a model turn, which made calls serial; they
//      are now reachable from a tool, the `mpdTeamActions` service, two POST routes and a panel tap, and
//      two overlapping approvals could mint TWO teams from ONE staged plan.
//   2. An UNEXPECTED throw is MARKED on the result so a route can answer the documented generic 500
//      instead of forwarding a message that may embed a filesystem path; the sentence is retained for
//      the row log and for the TOOL path, which keeps rethrowing it unchanged.
//
// NOTHING HERE READS A CORDIS CONTEXT OR AN `exec`. Everything the bodies need from the row —
// the clock, the executor, the approval effects, the team resolver, the watchdog reading, the service
// lookup, the row log, the idle guard's dispatch window and the two approval-time guards — arrives on
// {@link TeamActionDeps}. That is what lets the same functions back a tool handler, the `mpdTeamActions`
// service and an HTTP route without three copies of the approval sequence.
import type { DshTeamExecutor } from "../../mpd-dsh-adapter-plugin/src/index.ts"
import type { TeamResolution } from "./team-lifecycle"
import { reapReapedTeams } from "./team-lifecycle"
import type { TeamRecord } from "./team-store"
import {
  addTeamMember,
  addTeamTask,
  casClaimTask,
  createTeam,
  idleMembers,
  readTeam,
  readyTasks,
  removeTeamMember,
  updateTeamMember,
  updateTeamTask,
  withDerivedPhase,
  writeTeam,
} from "./team-store"
import { readHold, readPlan, writePlan, archivePlan, type StagedPlan } from "./plan-store"
import {
  assign,
  dispatchMessage,
  forgetTeam,
  isReadonlyMemberName,
  ledgerKey,
  ledgerOfTeam,
  planDispatch,
  readonlyMemberKeys,
  reconcile,
  type DispatchLedger,
  type RosterRow,
} from "./dispatch"
import { withIdlePreamble } from "./idle-guard"
import { readLedger, writeLedger } from "./dispatch-ledger"
// TYPE ONLY, deliberately: this module is imported BY `index.ts`, so a value import back would be a
// module cycle. A type import is erased at build time and leaves exactly one runtime edge.
import type { WatchdogHoldRead } from "./index"

/**
 * The service id this row publishes for the two team actions.
 *
 * Exported as a constant rather than spelled at each call site, so a consumer row and this row cannot
 * disagree about the live service name.
 */
export const TEAM_ACTIONS_SERVICE = "mpdTeamActions"

/**
 * One action's caller: WHO is acting, WHERE, and under which cancellation.
 *
 * `workspace`, `sessionId` and `lineage` are exactly what `where(exec)` resolves for a tool call, and
 * `agent` is `exec.agent` — the live Agent a spawn or a send is authorized by. A route has no agent of
 * its own, so it resolves the session's live one (or refuses); the action never guesses.
 */
export interface TeamActionCaller {
  /** The workspace root the stores read and write. */
  workspace: string
  /** The calling session, which owns the staged plan and the team binding. */
  sessionId: string
  /** The recorded ancestors a forked/resumed session may resolve its team through; empty when none. */
  lineage: string[]
  /** The live agent that owns the action; absent (a route) is a refusal, never a guess. */
  agent?: unknown
  /** Cancellation for the action, forwarded to every spawn and send exactly as a tool call's is. */
  signal?: AbortSignal
}

/**
 * What the two actions need from the row, injected explicitly.
 *
 * Every member is a seam the row already owns; none of them is read from a closure, so a test can drive
 * an action with a fake clock, a fake executor and no cordis context at all.
 */
export interface TeamActionDeps {
  /** The clock every store write is stamped with. */
  now: () => Date
  /** The active team executor, resolved PER CALL so a late-binding backend is honoured. */
  executor: () => DshTeamExecutor
  /**
   * The approval-time bundled effects (the durable goal and the todo checklist).
   *
   * The row wraps its own non-fatal implementation; a caller that has none passes a no-op. It receives
   * the plan and the caller, never a tool exec: the synthesized context it needs is the row's business.
   */
  bundleApprovalEffects: (plan: StagedPlan, caller: TeamActionCaller) => Promise<void>
  /** The team this approval nests under, derived from the records; undefined for a root team. */
  deriveParentTeam: (workspace: string, sessionId: string, lineage: readonly string[]) => TeamRecord | undefined
  /** The team bound to one session, with the refusal sentence when none (or more than one) resolves. */
  resolveTeam: (workspace: string, sessionId: string, lineage: readonly string[]) => TeamResolution
  /** The watchdog's per-team hold reading; a hold that cannot be read is reported, never guessed. */
  readWatchdogHold: (workspace: string, sessionId: string, lineage: readonly string[]) => WatchdogHoldRead
  /** A cordis service by id, or undefined; the row's only way to reach `mpdRoles`. */
  service: (id: string) => unknown
  /** The row's diagnostic sink; the caller prefixes the row name. */
  log: (line: string) => void
  /** Open the idle guard's dispatch window for one member; the returned release must always run. */
  beginDispatch: (memberId: string) => () => void
  /** The approval-time whole-graph guard (R11). */
  assertPlanGraph: (plan: StagedPlan) => void
  /** The approval-time write-scope ordering guard (R2). */
  assertScopesOrdered: (plan: StagedPlan) => void
}

/** What one approval produced, in the shape the tool reply and the route projection both read. */
export interface TeamApprovePayload {
  /** The plan as it was persisted after approval (marked approved, carrying what was created). */
  plan: StagedPlan
  /** The mpd record this approval built and wrote; absent ONLY on the `dryRun` preview path. */
  team?: TeamRecord
  /** What approval actually created, recorded onto the plan so a reader can reconcile plan with reality. */
  created: NonNullable<StagedPlan["created"]>
  /** The first failure's description; present means a spawn stopped the sequence and no task was posted. */
  stoppedAt?: string
}

/** What one dispatch pass produced, in the shape the tool reply and the route projection both read. */
export interface TeamDispatchPayload {
  /** The pairs the transport actually accepted, in board order. */
  pairs: Array<{ taskId: string; subject: string; memberId: string; memberName: string; note?: string }>
  /** Every task left out, with the reason it was left out. */
  skipped: Array<{ taskId: string; subject: string; reason: string }>
  /** Ledger rows this pass forgot: ended teams' rows plus the prune's own drops. */
  forgotten?: string[]
  /** Why the watchdog's hold could not be read, when it could not; the pass ran anyway. */
  holdRead?: string
  /** The team ids this pass marked terminal on disk. */
  reaped?: string[]
  /** The hold's reason when the pass was halted; no pairing is attempted. */
  halted?: string
  /** Why no team resolved for this caller; a refusal the tool reports rather than throwing. */
  refused?: string
}

/**
 * The outcome envelope every team action answers: a payload, or ONE refusal sentence.
 *
 * A result, never a rejection: the HTTP routes must answer instead of throwing into the host, and the
 * tool handlers turn a refusal back into the thrown error a tool caller has always observed.
 *
 * `unexpected` marks a caught THROW (a store failure, not a policy refusal). It exists for the ROUTE,
 * which answers the documented generic 500 for it instead of forwarding a message that may carry a
 * filesystem path; `error` still holds the real sentence for the row log and for the tool path, which
 * rethrows it unchanged.
 */
export type TeamActionResult<Payload = Record<string, unknown>> =
  | ({ ok: true } & Payload)
  | { ok: false; error: string; unexpected?: true }

/**
 * The `mpdTeamActions` service: the two actions, addressed by SESSION rather than by a tool exec.
 *
 * A session that cannot be resolved (an unknown id, a session with no live agent, an unattributable
 * workspace) answers `{ ok: false, error }`; neither member throws for a bad session id.
 */
export interface MpdTeamActionsService {
  /** Approve the plan staged by `sessionId`, as that session's live agent. */
  approve: (input: { sessionId: string }) => Promise<TeamActionResult<TeamApprovePayload>>
  /** Run one dispatch pass for `sessionId`'s team, as that session's live agent. */
  dispatch: (input: { sessionId: string; limit?: number; dryRun?: boolean }) => Promise<TeamActionResult<TeamDispatchPayload>>
}

/** The optional input of an approval; the tool's `dry_run` preview is the only member. */
export interface TeamApproveInput {
  /** Report what WOULD be created and write nothing (the tool's `dry_run: true`). */
  dryRun?: boolean
}

/** The input of one dispatch pass. */
export interface TeamDispatchInput {
  /** Cap the number of pairings; `0` or absent means no cap, exactly as the tool's `limit` does. */
  limit?: number
  /** Report the pairing decision and send nothing (the tool's `dry_run: true`). */
  dryRun?: boolean
}

/** One thrown value as the refusal sentence, so a non-Error is never dropped. */
function refusalOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Mark one caught THROW as unexpected, keeping its sentence for the row log and the tool path.
 *
 * The distinction is WHICH SURFACE decides: a validation/policy sentence is already returned by the
 * body and stays a 400; anything that reached this helper is a real failure (a store write, a broken
 * record) whose text may embed a filesystem path, so the route must not put it on the wire.
 * @param error - the caught value, converted with {@link refusalOf}.
 * @returns the refusal envelope the route reads as a 500.
 */
function unexpectedRefusalOf(error: unknown): { ok: false; error: string; unexpected: true } {
  return { ok: false, error: refusalOf(error), unexpected: true }
}

/**
 * The in-flight slots, ONE set per action, keyed by {@link actionSlotKey}.
 *
 * PROCESS-LOCAL BY DESIGN (plan §4.2 amendment 1). This is an in-process guard, NOT a lock: it stops
 * two callers in THIS dsh process — the tool, the service, a POST route, a panel tap — from running the
 * same approval or dispatch pass at once, and it does NOT coordinate two dsh processes. Two processes
 * sharing one workspace can still race, which is a stated bound rather than a property this repairs.
 */
const approvalsInFlight = new Set<string>()

/** The dispatch pass's in-flight slots; separate from approval's, so one never blocks the other. */
const dispatchesInFlight = new Set<string>()

/**
 * The slot key one caller occupies: its workspace plus its session, NUL-separated.
 *
 * NUL is the separator because neither half is a path or an id that can contain it, so two different
 * pairs cannot forge the same key.
 * @param caller - the action's caller.
 * @returns the in-flight key for that caller.
 */
function actionSlotKey(caller: TeamActionCaller): string {
  return `${caller.workspace}\u0000${caller.sessionId}`
}

/**
 * Approve the plan staged by one session: the `agent_teams_plan {action:"approve"}` body, exec-free.
 *
 * THE ORDER IS THE CONTRACT and is preserved exactly: the staged plan must exist and not be approved,
 * an empty shell is refused, the whole graph and the write-scope ordering are re-validated, the nesting
 * parent is derived, `dryRun` returns, the mpd record is materialised, members are spawned, tasks are
 * minted and their blockers resolved in a second pass, the record and plan are written, the plan is
 * archived only when nothing stopped, and the bundled effects run last. Every refusal is the same
 * sentence the tool produced; the caller turns it back into a throw.
 *
 * THE IN-FLIGHT SLOT IS TAKEN BEFORE THE FIRST AWAIT and released in `finally`, so two callers for one
 * workspace + session can never both see an unapproved plan and mint two teams. The second caller is
 * REFUSED, not queued: a queue would hide the duplicate from the operator.
 * @param deps - the row seams this action needs; see {@link TeamActionDeps}.
 * @param caller - who is approving, in which workspace and under which cancellation.
 * @param input - the optional `dryRun` preview.
 * @returns the approval's payload, or one refusal sentence.
 */
export async function approveTeam(
  deps: TeamActionDeps,
  caller: TeamActionCaller,
  input: TeamApproveInput = {},
): Promise<TeamActionResult<TeamApprovePayload>> {
  /** The one in-flight slot this approval occupies, keyed by workspace + session. */
  const slot = actionSlotKey(caller)
  if (approvalsInFlight.has(slot)) return { ok: false, error: "an approval for this session is already running" }
  approvalsInFlight.add(slot)
  try {
    return await approveTeamBody(deps, caller, input)
  } finally {
    // RELEASED ON EVERY EXIT — a policy refusal, an unexpected throw, a completed approval.
    approvalsInFlight.delete(slot)
  }
}

/**
 * The approval BODY, with no in-flight bookkeeping of its own.
 *
 * Never call this directly: {@link approveTeam} owns the slot, so a direct call would reintroduce the
 * duplicate-approval window the slot exists to close.
 * @param deps - the row seams this action needs; see {@link TeamActionDeps}.
 * @param caller - who is approving, in which workspace and under which cancellation.
 * @param input - the optional `dryRun` preview.
 * @returns the approval's payload, or one refusal sentence.
 */
async function approveTeamBody(
  deps: TeamActionDeps,
  caller: TeamActionCaller,
  input: TeamApproveInput,
): Promise<TeamActionResult<TeamApprovePayload>> {
  // THE ONE PERMITTED DIFFERENCE FROM THE TOOL PATH: no live agent means no spawn and no send, so the
  // action refuses BEFORE the first store write rather than leaving a half-built team on disk.
  if (caller.agent === undefined) return { ok: false, error: "approve needs a live agent" }
  /** The approving caller's workspace, session and recorded ancestors. */
  const { workspace, sessionId, lineage } = caller
  try {
    /** The plan being approved; it must exist and must not already be approved. */
    const plan = readPlan(workspace, sessionId)
    if (plan === undefined) return { ok: false, error: "no team is staged in this session — use action:\"create\" first" }
    if (plan.approvedAt !== undefined) return { ok: false, error: `plan ${plan.planId} is already approved` }
    // ── AN EMPTY SHELL IS NOT A TEAM (D4a) ────────────────────────────────
    // A plan can be staged mechanically — the session-start gate (D5) does exactly that, with
    // `approval:"required"` and nothing in it — and approving one used to MINT A TEAM RECORD with
    // no member and no task: a name in `.mpd/team/teams/`, a row in every panel, and no work
    // behind it. The refusal is a sentence that says what to do instead, so the caller is not left
    // guessing which of the two lists it must fill. Its trailing clause (R13, Amendment 2) names
    // the dependency answer too: obeying the sentence's own advice would otherwise stage a task
    // that `create_task` REFUSES for answering nothing, so the advice must be a working call.
    // THE CHECK SITS ABOVE `dry_run` DELIBERATELY: a preview of an empty plan would report "0
    // members, 0 tasks" for a CALL THAT CANNOT SUCCEED, which reads as a successful dry run and
    // invites the very approval this refuses. Both spellings answer with the same actionable
    // sentence instead, which is also what the /agent-teams command's own usage line promises.
    /** How many members and tasks the plan actually carries (zero on either side is fine). */
    const staged = plan.members.length + plan.tasks.length
    if (staged === 0) {
      return { ok: false, error: `plan ${plan.planId} is EMPTY — it has 0 members and 0 tasks, and approving it would create a team with nothing in it; add a member with agent_teams_plan {action:"add_member", member:{name, prompt}} and/or a task with {action:"create_task", task:{subject, description}} first — a task added there must also declare its dependency answer with blocked_by: [...] (possibly []) or independent: true` }
    }
    // ── THE WHOLE GRAPH IS RE-VALIDATED, WHICHEVER VERB STAGED IT (R11) ──
    // `create_task` reads its dependency answer at write time, but `edit` BULK-REPLACES the task
    // list and accepted a task with no answer at all — and neither verb re-checked the graph it
    // left behind. Approval is the one place every path meets, so it checks the WHOLE plan here:
    // every task must carry a `blockedBy` array (`[]` is a valid explicit root) and the graph must
    // carry no self-edge and no cycle. This sits BELOW the empty-plan sentence (which keeps its
    // precedence) and ABOVE `dry_run`, like the scope check: a preview of a call that cannot
    // succeed would read as a successful dry run.
    // THE TWO APPROVAL-TIME GUARDS ARE EXPECTED REFUSALS, so their throws are converted HERE and never
    // reach the outer catch: a policy sentence keeps its 400 and its text, while the outer catch marks
    // anything else as UNEXPECTED for the route to sanitize into the generic 500.
    try {
      deps.assertPlanGraph(plan)
      // ── TWO UNORDERED TASKS MAY NOT SHARE A WRITE SCOPE (R2) ──────────────
      // The plan can declare `write_scopes` on every task, and it could declare two tasks that may
      // write the SAME paths while neither runs after the other — the exact condition under which two
      // teammates edit one file concurrently. The refusal names the pair and the two remedies the
      // contract allows (an edge, or disjoint scopes); there is deliberately NO override flag.
      // THE CHECK SITS ABOVE `dry_run` for the same reason the empty-plan check does: a preview of a
      // call that CANNOT succeed reads as a successful dry run and invites exactly that approval.
      deps.assertScopesOrdered(plan)
    } catch (error) {
      return { ok: false, error: refusalOf(error) }
    }
    // ── THE NESTING SEAM, AT THE MOMENT THE RECORD IS BORN (cellwork wave 4) ──
    // The parent is DERIVED from the records (contract D2 option b): a promoted subcaptain is on
    // the parent team's roster, so approving its sub-team nests it without any argument. Derived
    // BEFORE `dry_run` like every other approval-time guard, because a preview of an approval that
    // cannot succeed reads as a successful dry run and invites it.
    /** The team this approval nests under, or undefined for a root team. */
    const parent = deps.deriveParentTeam(workspace, sessionId, lineage)
    if (input.dryRun === true) {
      return { ok: true, plan, created: { members: plan.members.map((m) => ({ name: m.name, id: "" })), tasks: plan.tasks.map((t) => ({ subject: t.subject, id: "" })) } }
    }
    // ── the separation, at the one moment it matters ──────────────────────
    // The mpd record is materialised BEFORE anything is spawned and carries its OWN ids, so
    // the team exists as mpd data from the first instant. Everything below only fills in
    // `executorRef` — the backend's handle — which is why a crash mid-approval leaves a record
    // naming exactly what was attempted instead of nothing at all, and why an executor swap
    // (W2) changes no id any surface has already shown.
    /** The mpd record this approval builds; persisted at the end, and on failure too. */
    let record = createTeam(workspace, {
      name: plan.name,
      description: plan.description,
      leadSessionId: sessionId,
      planId: plan.planId,
      // THE SEAM MADE DURABLE: the derived parent becomes the record's `parentTeamId`, and a root
      // team writes no key at all (so its record carries the exact field set it always had).
      ...(parent === undefined ? {} : { parentTeamId: parent.teamId }),
    }, deps.now())
    for (const member of plan.members) {
      record = addTeamMember(record, { name: member.name, description: member.description, ...(member.role === undefined ? {} : { role: member.role }) }, deps.now())
    }
    // THE ORDER IS THE FIX (defect 2026-10-06). Every staged task is minted FIRST and the blockers
    // are resolved afterwards, against the COMPLETE board: a plan may legitimately name a task that
    // comes LATER (a forward reference), and resolving per insert could only ever see the tasks
    // before it — which is how a plan written in its own POSITIONS (`["2"]`, `["7","8","9"]`) used to
    // reach the board as references no task answered, flattening the whole DAG to one column with no
    // warning anywhere. `blockedBy` is therefore added in a second pass, through `updateTeamTask`,
    // once the plan's own namespace can be mapped to real board ids.
    for (const task of plan.tasks) {
      record = addTeamTask(record, {
        subject: task.subject,
        description: task.description,
        // THE STAGED KIND IS THE BOARD KIND (PR #42 review F-J): `work` remains the default for a
        // plan that never named one, which is exactly what every staged task used to become.
        kind: task.kind ?? "work",
        ...(task.blockedBy === undefined ? {} : { blockedBy: task.blockedBy }),
        ...(task.writeScopes === undefined ? {} : { writeScopes: task.writeScopes }),
        ...(task.owner === undefined ? {} : { owner: task.owner }),
        ...(task.coverageOf === undefined ? {} : { coverageOf: task.coverageOf }),
        ...(task.sourceTaskId === undefined ? {} : { sourceTaskId: task.sourceTaskId }),
      }, deps.now())
    }
    /** The plan's own references → the board ids this approval minted, in plan order. */
    const planAlias = new Map<string, string>()
    plan.tasks.forEach((task, index) => {
      /** The board task the staged task at this position was minted as; absent for an empty subject. */
      const minted = record.tasks[index]
      if (minted === undefined) return
      // BOTH FORMS THE PLAN CAN MEAN are mapped, position first: `"2"` is the second staged task,
      // and the subject is what the plan-store's own documentation has always promised.
      planAlias.set(String(index + 1), minted.id)
      if (!planAlias.has(task.subject)) planAlias.set(task.subject, minted.id)
    })
    for (const [index, task] of plan.tasks.entries()) {
      /** The board task this staged task became. */
      const minted = record.tasks[index]
      if (minted === undefined || (task.blockedBy ?? []).length === 0) continue
      /** What this task's references resolve to now that the whole plan is on the board. */
      const mapped = (task.blockedBy ?? []).map((reference) => planAlias.get(reference) ?? reference)
      // UNCHANGED MEANS ALREADY RIGHT. A subject or a backward id was resolved when the task was
      // minted, so re-writing it would only move the task's own revision for nothing; only a
      // reference the first pass could NOT resolve (a plan position, a forward reference) is
      // rewritten — and a rewrite is what turns that dangling entry into a real edge.
      if (mapped.length === minted.blockedBy.length && mapped.every((id, at) => minted.blockedBy[at] === id)) continue
      record = updateTeamTask(record, minted.id, { blockedBy: mapped }, deps.now())
    }
    /** What approval actually created, recorded onto the plan so a reader can reconcile plan with reality. */
    const created: NonNullable<StagedPlan["created"]> = { members: [], tasks: [] }
    // THE REPORT A CAPTAIN SEES AT APPROVAL TIME, not three layers downstream: every staged blocker
    // that named no task is named HERE, with the board task it landed on. It travels in the
    // approval ANSWER (rendered by the tool) and into the archived plan's `created.unresolved`, and
    // the same list is on each board task as `unresolvedBlockers` for every later reader.
    /** The board tasks carrying a blocker nothing answered, in board order. */
    const unresolvedBlockers = record.tasks
      .filter((task) => (task.unresolvedBlockers ?? []).length > 0)
      .map((task) => ({ taskId: task.id, references: [...(task.unresolvedBlockers ?? [])] }))
    if (unresolvedBlockers.length > 0) created.unresolved = unresolvedBlockers
    /** The first failure's description; set means approval stopped rather than half-build the team. */
    let stoppedAt: string | undefined
    for (const member of record.members) {
      try {
        // THE EXECUTOR RAISES THE MEMBER. On the native backend the member's ROLE travels as an
        // ordinary argument and the executor turns it into the child's `agentOptions` — the two
        // things the official tool row cannot forward — so a roster slot route, a persona and the
        // read-only deny list reach a teammate directly, and nothing here needs the official
        // plugin mounted.
        /** The backend's answer, whose handle the record keeps BESIDE our own member id. */
        const spawned = await deps.executor().spawn(caller.agent, {
          teamId: record.teamId,
          memberId: member.id,
          name: member.name,
          description: member.description === "" ? member.name : member.description,
          // THE SPAWN PREAMBLE (§3.3), applied where the prompt is HANDED TO THE EXECUTOR (Amendment
          // A6), never where `add_member` stores the row: the member's first turn must carry it.
          prompt: withIdlePreamble(plan.members.find((staged) => staged.name === member.name)?.prompt ?? member.description),
          // THE ROLE IS THE ROUTE'S FIRST IDENTITY CHANNEL, not a decoration: the native executor
          // matches it against the roster before the description's head and the name, and an
          // unmatched member inherits the staging session's route. `TeamMemberRecord.route` is
          // written by NO production path (only the store's input type admits it), so this arm
          // forwards no `provider` — the route is the executor's to resolve.
          ...(member.role === undefined ? {} : { role: member.role }),
          ...(caller.signal === undefined ? {} : { signal: caller.signal }),
        })
        created.members.push({ name: member.name, id: spawned.handle })
        record = updateTeamMember(record, member.id, { executorRef: spawned.handle, status: "running" })
      } catch (error) {
        // THE SAME RULE AS THE LIVE APPEND (contract `.mpd/plans/agent-slot-hygiene.md`): a member
        // the harness never raised is DROPPED rather than kept as a `failed` row, because a partial
        // approval would otherwise hand the roster — and the capacity — a teammate that does not
        // exist, and a repaired approval could never reuse the name.
        record = removeTeamMember(record, member.id)
        stoppedAt = `member ${member.name}: ${String((error as Error)?.message ?? error)}`
        break
      }
    }
    // THE TASKS ARE NOT POSTED TO A BACKEND BOARD. The mpd record IS the board — the dependency
    // edges, the attempts, the review fields and the executor handles are all here, and a
    // second board would be a second source of truth for the same team. The official backend's
    // `executorRef` is filled in only where a backend actually minted something to point at.
    if (stoppedAt === undefined) for (const task of record.tasks) {
      created.tasks.push({ subject: task.subject, id: task.id })
    }
    /** The record stamped approved, its phase brought in line with what actually happened. */
    const approvedRecord = withDerivedPhase({ ...record, approvedAt: deps.now().toISOString() })
    writeTeam(workspace, approvedRecord)
    /** The plan marked approved, carrying what was created. */
    const approved: StagedPlan = { ...plan, approvedAt: deps.now().toISOString(), created }
    writePlan(workspace, approved)
    // The plan is archived so the STAGING slot is free for the next wave while the approved
    // plan stays readable; the record is what every surface reads from here on.
    if (stoppedAt === undefined) archivePlan(workspace, { ...approved })
    // ── WAVE REQUIREMENT 4: ONE APPROVAL, THREE MECHANISMS ────────────────
    // The team RECORD exists (it is written above even when a spawn stopped the sequence), so
    // this is the moment the wave's durable GOAL and its TODO checklist start too — bundled
    // here instead of left to the captain's next turn. The effects are deliberately AFTER the
    // persistence: `dry_run` returned earlier, `create`/`add_member`/`edit` never reach this
    // line, and an approval that throws (empty shell, already approved, executor refusal) does
    // not leak a goal or a checklist. NON-FATAL by contract: see the row's `bundleApprovalEffects`.
    await deps.bundleApprovalEffects(plan, caller)
    return { ok: true, plan: approved, team: approvedRecord, created, ...(stoppedAt === undefined ? {} : { stoppedAt }) }
  } catch (error) {
    // A THROW HERE IS UNEXPECTED — a store write, a broken record, a failed archive — because every
    // POLICY refusal above (the empty shell, the graph, the scopes) is returned or converted before it
    // can reach this catch. The sentence is kept for the row log and the tool path; `unexpected` tells
    // the route to answer the generic 500 instead of putting a possible filesystem path on the wire.
    return unexpectedRefusalOf(error)
  }
}

/**
 * Run ONE dispatch pass for a session's team: the `agent_teams_dispatch {action:"run"}` body, exec-free.
 *
 * THE ORDER IS THE CONTRACT and is preserved exactly, including the passes that run whatever
 * `dryRun` says: the workspace hold is read, the C7-3 consistency pass reaps non-live records and
 * prunes their ledger rows, the watchdog's per-team hold is composed into the same refusal, the
 * record is resolved (a missing team is a REFUSAL PAYLOAD, not a throw), the board and roster are
 * projected, the ledger is pruned, the pure engine decides, and only then are messages delivered and
 * pairings compare-and-set onto the record before the ledger is merged.
 *
 * THE IN-FLIGHT SLOT IS TAKEN BEFORE THE FIRST AWAIT and released in `finally`. Its key is the CALLER
 * (`workspace + sessionId`), never the team id: a pass may legitimately resolve NO team yet (nothing is
 * staged, the record is ambiguous), and the duplicate this closes — two passes computing the same pairs
 * and each delivering before the compare-and-set could reject the second — happens before any team
 * lookup would be meaningful.
 * @param deps - the row seams this action needs; see {@link TeamActionDeps}.
 * @param caller - who is dispatching, in which workspace and under which cancellation.
 * @param input - the optional cap and the `dryRun` preview.
 * @returns the pass's payload, or one refusal sentence.
 */
export async function runDispatch(
  deps: TeamActionDeps,
  caller: TeamActionCaller,
  input: TeamDispatchInput = {},
): Promise<TeamActionResult<TeamDispatchPayload>> {
  /** The one in-flight slot this pass occupies, keyed by workspace + session. */
  const slot = actionSlotKey(caller)
  if (dispatchesInFlight.has(slot)) return { ok: false, error: "a dispatch pass for this session is already running" }
  dispatchesInFlight.add(slot)
  try {
    return await runDispatchBody(deps, caller, input)
  } finally {
    // RELEASED ON EVERY EXIT — a refusal payload, an unexpected throw, a completed pass.
    dispatchesInFlight.delete(slot)
  }
}

/**
 * The dispatch BODY, with no in-flight bookkeeping of its own.
 *
 * Never call this directly: {@link runDispatch} owns the slot, so a direct call would reintroduce the
 * duplicate-delivery window the slot exists to close.
 * @param deps - the row seams this action needs; see {@link TeamActionDeps}.
 * @param caller - who is dispatching, in which workspace and under which cancellation.
 * @param input - the optional cap and the `dryRun` preview.
 * @returns the pass's payload, or one refusal sentence.
 */
async function runDispatchBody(
  deps: TeamActionDeps,
  caller: TeamActionCaller,
  input: TeamDispatchInput,
): Promise<TeamActionResult<TeamDispatchPayload>> {
  // Same rule as approval: a pass with no live agent can neither send nor be authorized, and it must
  // refuse before the consistency pass writes a ledger row.
  if (caller.agent === undefined) return { ok: false, error: "dispatch needs a live agent" }
  /** The dispatching caller's workspace, session and recorded ancestors. */
  const { workspace, sessionId, lineage } = caller
  try {
    /** The workspace hold, if any; its reason refuses the WHOLE pass inside `planDispatch`. */
    const hold = readHold(workspace)
    // THE C7-3 CONSISTENCY PASS runs on the ONE write path a team already has: a record that is not
    // live (the hand-patched `archived` phase included, or a plan archived without approval) is
    // rewritten to `ended` WITH a reason here, so a reaped ghost cannot survive on disk and
    // `derivePhase` agrees with it afterwards. Reported as `reaped` so the caller sees the repair.
    // It runs on the `run` action whatever `dryRun` says: the repair is not a dispatch, `dryRun`
    // scopes the PAIRING ("send nothing"), and a ghost left on disk is the defect itself.
    /** The team ids this pass marked terminal on disk. */
    const reaped = reapReapedTeams(workspace, deps.now())
    // A TERMINAL RECORD KEEPS NO DISPATCH ROWS (R1). The prune is anchored on the ONE terminal write
    // path above: the ids it reports are the teams that just ended, and their ledger rows are dropped
    // here so a later team reusing `T1..Tn` cannot inherit a dead pairing. Reported in `forgotten`.
    /** The ledger after dropping every ended team's rows. */
    let ledgerAfterReap = readLedger(workspace)
    /** The task ids the terminal prune forgot, across every team it ended. */
    const terminalForgotten: string[] = []
    for (const endedTeamId of reaped) {
      /** The ledger with this ended team's rows left out. */
      const dropped = forgetTeam(ledgerAfterReap, endedTeamId)
      ledgerAfterReap = dropped.ledger
      terminalForgotten.push(...dropped.forgotten)
    }
    if (terminalForgotten.length > 0) writeLedger(workspace, ledgerAfterReap)
    // The WATCHDOG's hold is a second, per-team pause. It is composed into the same refusal so a
    // caller reads one sentence whichever hold stopped the pass.
    /** This session's team, which names the team a watchdog hold would apply to. */
    const teamId = deps.resolveTeam(workspace, sessionId, lineage).record?.teamId
    // ONE AUTHORITATIVE SOURCE for the watchdog's hold: its own `mpdWatchdog` service, read through
    // the gate call the watchdog documents (`isHeld(teamId, workspace)?.held === true`). A hold that
    // cannot be read is NOT a hold — it is reported as `not-readable` and the pass continues.
    /** The watchdog's reading for this session's team. */
    const watchdog = teamId === undefined ? ({ state: "free" } as WatchdogHoldRead) : deps.readWatchdogHold(workspace, sessionId, lineage)
    /** The refusal reason, whichever of the two holds applies first. */
    const holdReason = hold?.reason ?? (watchdog.state === "held" ? watchdog.reason : undefined)
    /** The honest note a caller reads when the watchdog's hold could not be read at all. */
    const holdNote = watchdog.state === "not-readable" ? `not-readable: ${String(watchdog.reason ?? "the watchdog's hold could not be read")}` : undefined
    // THE RECORD IS THE BOARD (W2). Both loops below read mpd's own team, so a dispatch pass
    // works in a composition where the official service cannot mount — which is the whole point
    // of owning the record — and the readiness rule is the store's own OPT-1 rule rather than a
    // projection of somebody else's.
    /** The team this pass dispatches, or the sentence saying why none resolved. */
    const resolvedDispatch = deps.resolveTeam(workspace, sessionId, lineage)
    if (resolvedDispatch.record === undefined) return { ok: true, pairs: [], skipped: [], refused: resolvedDispatch.refusal ?? "no team record in this workspace — approve a plan first", ...(reaped.length === 0 ? {} : { reaped }) }
    /** The team this pass dispatches. */
    let record: TeamRecord = resolvedDispatch.record
    // Bound to a const because `record` is REASSIGNED as pairs are accepted, so a captured `let`
    // would change under the two closures below; the tip carries its own `TeamRecord` annotation.
    /** The team as this pass read it. */
    const opened: TeamRecord = record
    /** The tasks this pass may dispatch, by the store's own OPT-1 readiness rule. */
    const readyIds = new Set(readyTasks(opened).map((candidate) => candidate.id))
    /** The board, in the dispatch engine's shape. */
    const tasks = opened.tasks.map((task) => ({
      id: task.id,
      subject: task.subject,
      status: task.status,
      // OPT-1: a FAILED blocker does not hold a task back, and `readyTasks` is the ONE place
      // that rule lives, so the dispatch engine cannot drift from the store.
      ready: readyIds.has(task.id),
      blockedBy: task.blockedBy,
      // C7-1: the team this task belongs to, on the task side of the pairing guard.
      teamId: opened.teamId,
      // C7-2: a task with write scopes is a WRITE task, whatever its kind says.
      writeScopes: task.writeScopes,
      ...(task.owner === undefined ? {} : { ownerName: task.owner }),
    }))
    // The roster, in the dispatch engine's shape; the engine pairs only with `inactive` (idle).
    // `idleMembers` counts a SETTLED member (`inactive`) as free, which is what keeps the pool
    // non-empty once R2 writes settlement — the reason settlement and this projection ship together.
    /** The members free to take work right now, by the store's own rule. */
    const idle = new Set(idleMembers(opened).map((member) => member.name))
    // C7-2's SOURCE, read PER CALL and never copied: mpd-roles-plugin's OWN published service, whose
    // `readonly` flag is the same one that decides whether a spawn passes `READONLY_DENY`. The guard
    // FAILS OPEN when the row is absent (no read-only key, so the pairing is left as it was) and says
    // so ONCE, so a composition without the roster can never have its dispatch silently narrowed.
    /** The roster rows the `mpdRoles` service publishes, or none when that row is absent. */
    const rosterRows: readonly RosterRow[] = (() => {
      try {
        /** The mpd-owned roster service; absent in a composition that does not mount the roles row. */
        const roles = deps.service("mpdRoles") as { list?: () => RosterRow[] } | undefined
        return typeof roles?.list === "function" ? roles.list() : []
      } catch {
        return []
      }
    })()
    if (rosterRows.length === 0) deps.log("[mpd-team-core] the mpdRoles service is absent or empty — the C7-2 read-only dispatch guard has no roster to classify against and fails OPEN")
    /** The read-only member keys, indexed from that roster by the shared key rule. */
    const readonlyKeys = readonlyMemberKeys(rosterRows)
    /** The roster in the dispatch engine's shape: a member is `inactive` when it is free. */
    const members = opened.members.map((member) => ({
      id: member.executorRef ?? member.id,
      name: member.name,
      status: idle.has(member.name) ? "inactive" : "running",
      // C7-1: the SAME record's team id on the member side; the guard refuses any mismatch.
      teamId: opened.teamId,
      // C7-2: readonly when the record's role label OR its display name is a read-only roster member
      // (the two spellings of the same specialist); an unknown member is treated as write-capable.
      readonly: isReadonlyMemberName(member.name, readonlyKeys) || (member.role !== undefined && isReadonlyMemberName(member.role, readonlyKeys)),
    }))
    // PRUNE FIRST: a task deleted or completed out of band must not keep its member busy forever.
    // TEAM-SCOPED (R1): this team's rows are pruned against THIS board, other teams' rows pass
    // through untouched, and a LEGACY bare-key row is dropped and reported in `forgotten`.
    const pruned = reconcile(readLedger(workspace), opened.teamId, tasks)
    /** Everything this pass forgot: the ended teams' rows plus the prune's own drops, deduplicated. */
    const forgotten = [...new Set([...terminalForgotten, ...pruned.forgotten])]
    /** The pure decision for this pass: the pairs to dispatch and a reason for every task left out. */
    const plan = planDispatch({
      tasks,
      members,
      // ONLY this team's rows: another team's pairing must not book a member of this roster.
      ledger: ledgerOfTeam(pruned.ledger, opened.teamId),
      ...(holdReason === undefined ? {} : { hold: holdReason }),
      ...(typeof input.limit === "number" ? { limit: input.limit } : {}),
    })
    if (plan.halted !== undefined || input.dryRun === true || plan.pairs.length === 0) {
      if (pruned.forgotten.length > 0) writeLedger(workspace, pruned.ledger)
      return { ok: true, ...plan, forgotten, ...(holdNote === undefined ? {} : { holdRead: holdNote }), ...(reaped.length === 0 ? {} : { reaped }) }
    }
    // The pass's OWN view of the ledger: the pre-await prune, extended by each accepted pairing.
    // It is deliberately NOT what gets written — the merge before the write (T7) re-reads the file
    // and takes ONLY this pass's `sent` entries from here, so a concurrent release survives.
    /** The ledger this pass carries: the pre-await prune plus its own accepted pairings. */
    let ledger = pruned.ledger
    /** The pairs the transport actually accepted, which are the ones recorded. */
    const sent: typeof plan.pairs = []
    /** The plan's skips plus any pairing whose message failed, so nothing is dropped silently. */
    const skipped = [...plan.skipped]
    for (const pair of plan.pairs) {
      // THE DISPATCH WINDOW (CodeRabbit #81 D2): the send below cold-resumes an absent child, whose
      // first `agent/pre-step` runs BEFORE this pass writes the owner. The window is open around the
      // WHOLE pairing — send, re-read and compare-and-set — so that first step is neither marked idle
      // nor denied (the claim the dispatch exists to hand over would otherwise be lost). A genuinely
      // taskless member never enters a window and keeps the hard denial.
      const endDispatchWindow = deps.beginDispatch(pair.memberId)
      try {
        /** The board's own record for this pair, used for the acceptance text. */
        const task = tasks.find((candidate) => candidate.id === pair.taskId)
        try {
          // DELIVERED THROUGH THE EXECUTOR, which on the native backend cold-resumes a child that
          // is not currently live — the behaviour a dispatch pass depends on.
          await deps.executor().send(caller.agent, pair.memberId, dispatchMessage({ id: pair.taskId, subject: pair.subject, status: "pending", ready: true }, task === undefined ? "" : String((task as { description?: unknown }).description ?? "")), caller.signal)
          // COMPARE-AND-SET (T2), AFTER the await and never before it. `opened` was read before the
          // loop, and another caller — a member's own `agent_teams_task {action:"claim"}` — may have
          // written the record while this pass was suspended. Re-reading here and applying the patch
          // to the FRESH record is what keeps that write: a blind `writeTeam(record)` rewrote the
          // whole file from the stale snapshot and silently reverted it. The pairing is still
          // recorded in the RECORD as well as the ledger — the assignment is what makes the member
          // non-idle on the NEXT pass, and a ledger alone would leave the record claiming the task
          // is unowned.
          /** The record as it stands on disk right now. */
          const onDisk = readTeam(workspace, opened.teamId)
          if (onDisk === undefined) {
            skipped.push({ taskId: pair.taskId, subject: pair.subject, reason: "the team record disappeared while the pass was in flight" })
            continue
          }
          /** The revision this pass's decision was based on, from the record it has been carrying. */
          const expected = record.tasks.find((candidate) => candidate.id === pair.taskId)?.revision
          if (expected === undefined) {
            skipped.push({ taskId: pair.taskId, subject: pair.subject, reason: `task ${pair.taskId} is no longer on the pass's board` })
            continue
          }
          /** The compare-and-set outcome for this pairing. */
          const claimed = casClaimTask(onDisk, pair.taskId, pair.memberName, expected, deps.now())
          if (!claimed.applied) {
            // REPORTED, not silently dropped: the message was delivered, but the board's own record
            // refused the claim, so the caller must see why the task is not marked in flight.
            skipped.push({ taskId: pair.taskId, subject: pair.subject, reason: `the board refused the claim: ${claimed.reason}` })
            continue
          }
          // The FRESH record, carrying this one pairing and everything a concurrent writer added.
          record = claimed.record
          // THE PAIRED MEMBER IS `running` AGAIN (R2). Settlement writes `inactive` once a member owns
          // no open task, so a pass that pairs a settled member must flip the row back — otherwise the
          // record would report idle work and the next settlement pass could race the claim.
          // The phase is re-derived with the claim: pairing a SETTLED member takes the team out of
          // `idle`, and a stored phase that disagrees with the row is a ghost a reader would trust.
          record = withDerivedPhase(updateTeamMember(record, pair.memberName, { status: "running" }))
          writeTeam(workspace, record)
          ledger = assign(ledger, { teamId: opened.teamId, taskId: pair.taskId, memberId: pair.memberId, memberName: pair.memberName }, deps.now())
          sent.push(pair)
        } catch (error) {
          skipped.push({ taskId: pair.taskId, subject: pair.subject, reason: `the message to ${pair.memberName} failed: ${String((error as Error)?.message ?? error)}` })
        }
      } finally {
        endDispatchWindow()
      }
    }
    // MERGE (T7), never a blind overwrite. `pruned` was read BEFORE the first `await`, and the
    // ledger has a SECOND writer that runs across this pass's suspension — `agent_teams_task
    // {action:"release"}` reads the same file and writes it back with one entry removed. Writing
    // this pass's whole pre-await map back erased that release: the member stayed recorded as busy
    // and the freed task could never be dispatched again. So the map is re-read, re-pruned against
    // the SAME board this pass decided on, and only this pass's OWN accepted operations are applied.
    /** The ledger as it stands on disk right now, pruned by the rule `pruned` was built with. */
    const fresh = reconcile(readLedger(workspace), opened.teamId, tasks)
    /** The merged ledger: everything a concurrent writer left, plus this pass's own pairings. */
    const merged: DispatchLedger = { ...fresh.ledger }
    // DELIBERATE CONFLICT RULE: when the fresh read shows that a task THIS PASS ASSIGNED was
    // meanwhile released, the pass's assignment still wins — the send really went out, so recording
    // it is the honest outcome, and dropping it would leave a delivered task unowned on the board.
    // Only `sent` is re-applied; an entry this pass merely inherited is never resurrected.
    for (const pair of sent) merged[ledgerKey(opened.teamId, pair.taskId)] = ledger[ledgerKey(opened.teamId, pair.taskId)]
    writeLedger(workspace, merged)
    return { ok: true, pairs: sent, skipped, forgotten, ...(holdNote === undefined ? {} : { holdRead: holdNote }), ...(reaped.length === 0 ? {} : { reaped }) }
  } catch (error) {
    // UNEXPECTED, like approval's catch: a missing team is a `refused` PAYLOAD above, a per-pair send
    // failure is a `skipped` row, and the hold readings are contained — so anything that reaches here
    // is a real store failure whose sentence may embed a path. Marked for the route's generic 500; the
    // sentence survives for the row log and for the tool path, which rethrows it unchanged.
    return unexpectedRefusalOf(error)
  }
}


