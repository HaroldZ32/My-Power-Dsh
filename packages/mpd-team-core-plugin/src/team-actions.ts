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
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { DshTeamExecutor } from "../../mpd-dsh-adapter-plugin/src/index.ts"
import type { TeamResolution } from "./team-lifecycle"
import { reapReapedTeams } from "./team-lifecycle"
import { send } from "./mailbox-store"
import type { TeamRecord } from "./team-store"
import {
  activeTeamId,
  addTeamMember,
  addTeamTask,
  blockingDependencies,
  casClaimTask,
  createTeam,
  endTeamRecord,
  idleMembers,
  memberIdentityOf,
  memberNamedBy,
  readTeam,
  readyTasks,
  recordNamesLead,
  removeTeamMember,
  sanitizeId,
  updateTeamMember,
  updateTeamTask,
  withDerivedPhase,
  writeTeam,
  type MemberIdentity,
  type TeamMemberMode,
} from "./team-store"
import { readHold, readPlan, writePlan, archivePlan, type StagedMember, type StagedPlan } from "./plan-store"
import {
  assign,
  dispatchMessage,
  forgetTeam,
  isReadonlyMemberName,
  ledgerKey,
  ledgerOfTeam,
  memberFenceReason,
  pairingRefusal,
  planDispatch,
  readReassign,
  readonlyMemberKeys,
  reconcile,
  type DispatchLedger,
  type DispatchMember,
  type DispatchMode,
  type ReassignPair,
  type RosterRow,
} from "./dispatch"
import { withIdlePreamble } from "./idle-guard"
import { readLedger, writeLedger } from "./dispatch-ledger"
import { appendTeamJournal } from "./team-journal"
import { handoffWrittenDirective, teamHandoffPath, validateHandoffText, writeHandoffDocument } from "./team-handoff"
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
 * The sender identity a force notification carries.
 *
 * NOT a team member and NOT the lead: the lead is the RECIPIENT, and the mailbox store refuses a
 * self-send. Naming the supervisor honestly is what lets the captain see who stopped the member.
 */
const FORCE_SENDER_ID = "mpd-force-supervisor"

/** The display name {@link FORCE_SENDER_ID} renders as in the captain's inbox. */
const FORCE_SENDER_NAME = "mpd force supervisor"

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
  /**
   * The session TITLE the harness stamped (the persona prompt prefix), or absent when it stamped none.
   *
   * WHY THE ACTIONS READ IT. The identity plane's member arm is the record's own narrowing
   * (`team-store.ts#memberIdentityOf`): a session the roster cannot name by id or by a recorded ancestor
   * may still be identified by the title its seat's ROLE (then its stored name) appears in — which is how a
   * RESUMED member stops being read as a forked Lead. The tool boundary and the service both pass it; a
   * caller that omits it degrades to the id/ancestor arms, never to a guess.
   */
  title?: string
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
  /** How every staged member was bound to the workmate library, in plan order (W3-C). */
  bindings?: TeamWorkmateBinding[]
}

/**
 * What one reassignment did — reported for EVERY pair, never thrown.
 *
 * A hand-over has three halves that can fail independently: the board claim, the journal row and the
 * delivery. Each is reported, so "the row moved but the member was never told" cannot read as success.
 */
export interface TeamReassignOutcome {
  /** The board row this outcome is about. */
  taskId: string
  /** The member the row was handed to (the roster's own spelling, once resolved). */
  owner: string
  /** Whether the board row is now claimed for that member. */
  claimed: boolean
  /** Whether the dispatch message reached that member's handle. */
  delivered: boolean
  /** Why the reassignment stopped short, when it did. */
  reason?: string
}

/** What one dispatch pass produced, in the shape the tool reply and the route projection both read. */
export interface TeamDispatchPayload {
  /** The pairs the transport actually accepted, in board order. */
  pairs: Array<{ taskId: string; subject: string; memberId: string; memberName: string; note?: string }>
  /** The hand-overs this call performed before the pairing pass, in the caller's order. */
  reassigned?: TeamReassignOutcome[]
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
  /**
   * `retryable` marks a refusal the SAME decision may retry (D3's handoff-write failure): the caller
   * (the watchdog) re-arms the task instead of treating the attempt as spent.
   */
  | { ok: false; error: string; unexpected?: true; retryable?: boolean }

/**
 * The `mpdTeamActions` service: every team MUTATION, addressed by SESSION rather than by a tool exec.
 *
 * A session that cannot be resolved (an unknown id, a session with no live agent, an unattributable
 * workspace) answers `{ ok: false, error }`; no member throws for a bad session id. This is the seam the
 * NEXT wave needs: a cellwork handler becomes a thin caller of `fence`/`unfence`/`handoff`/`dispatch`
 * instead of re-implementing the record rules itself (C1: a service read, never a cross-package import).
 */
export interface MpdTeamActionsService {
  /** Approve the plan staged by `sessionId`, as that session's live agent. */
  approve: (input: { sessionId: string }) => Promise<TeamActionResult<TeamApprovePayload>>
  /** Run one dispatch pass for `sessionId`'s team, as that session's live agent. */
  dispatch: (input: { sessionId: string; limit?: number; dryRun?: boolean; mode?: DispatchMode; reassign?: readonly ReassignPair[] }) => Promise<TeamActionResult<TeamDispatchPayload>>
  /** Fence one seat of `sessionId`'s team: a fenced member is never messaged until it is unfenced. */
  fence: (input: { sessionId: string; member: string; reason?: string }) => Promise<TeamActionResult<TeamFencePayload>>
  /** Clear one seat's fence, so a dispatch pass may message it again. */
  unfence: (input: { sessionId: string; member: string }) => Promise<TeamActionResult<TeamFencePayload>>
  /** Write the calling member's handoff document and put its seat in the handoff window. */
  handoff: (input: { sessionId: string; content: string }) => Promise<TeamActionResult<TeamHandoffPayload>>
  /**
   * Cancel named board rows, so the dispatcher can NEVER wake them.
   *
   * The transition a caller that abandons work needs (cellwork's activation drops keys the accepted split
   * no longer carries): the row stays ON the board — it is not deleted — but it becomes terminal with the
   * store's own `cancelled` status, and `runDispatch` reports it in its skip list instead of pairing it.
   */
  cancelTasks: (input: TeamCancelInput) => Promise<TeamActionResult<TeamCancelPayload>>
  /**
   * D3: FORCE one wedged seat — handoff, interrupt, requeue and split — as `sessionId`'s live agent.
   *
   * Addressed by the team's LEAD session, which is the only authority that may interrupt its members;
   * the watchdog calls this with `record.leadSessionId` and its own workspace, so the two planes never
   * have to agree on anything but the record's own ids. A session with no live agent refuses (nothing
   * is interrupted, nothing is written) and the watchdog records that.
   */
  force: (input: { sessionId: string; teamId: string; taskId: string; workspace?: string; evidence?: TeamForceEvidence }) => Promise<TeamActionResult<TeamForcePayload>>
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
  /**
   * The pairing rule AS REQUESTED.
   *
   * Raw on purpose: {@link runDispatch} validates it against the closed union, so a TOOL caller and a
   * SERVICE caller are refused with the SAME sentence (the tool used to validate and the service did not).
   */
  mode?: unknown
  /**
   * The hand-overs AS REQUESTED (the raw `reassign` argument).
   *
   * Raw for the same reason: one validator, one refusal, whichever surface asked.
   */
  reassign?: unknown
}

/** What one fence change produced. */
export interface TeamFencePayload {
  /** The team whose seat changed. */
  teamId: string
  /** The member the change is about (the roster's own spelling). */
  member: string
  /** Whether the seat is fenced AFTER the call. */
  fenced: boolean
  /** Why it was fenced, when the caller gave a reason. */
  reason?: string
}

/** What one handoff produced. */
export interface TeamHandoffPayload {
  /** The team the handoff belongs to. */
  teamId: string
  /** The member that wrote it. */
  member: string
  /** Absolute path of the document written. */
  path: string
  /** The 1-based ordinal of this handoff for that member. */
  ordinal: number
  /** The seat mode the member now carries (`checkpoint`, the handoff window). */
  mode: TeamMemberMode
  /** The directive the caller relays: the member must end its turn. */
  directive: string
}

/** What one cancellation pass produced, in the shape a service caller reads. */
export interface TeamCancelPayload {
  /** The team whose board was touched. */
  teamId: string
  /** The task ids this call actually cancelled, in the caller's order. */
  cancelled: string[]
  /** One entry per id this call did NOT cancel, with the reason it did not. */
  skipped: Array<{ taskId: string; reason: string }>
}

/**
 * The input of one cancellation pass.
 *
 * ADDRESSED BY WORKSPACE + TEAM, not by session: a caller abandoning rows already HOLDS the team it
 * abandoned them on (cellwork's activation is the first caller, and it knows both), so requiring it to
 * re-derive a session binding would be a second way to name the same record.
 */
export interface TeamCancelInput {
  /** The caller's workspace root. */
  workspace: string
  /** The team whose rows are cancelled. */
  teamId: string
  /** The board rows to cancel. */
  taskIds: readonly string[]
  /** One line recorded as each row's closing note, so a reader sees WHY it was abandoned. */
  note?: string
}

/** The input of one fence change. */
export interface TeamFenceInput {
  /** The member to fence or unfence, by board name or member id. */
  member: string
  /** Why the seat is being fenced; recorded on the row and in the journal. */
  reason?: string
}

/** What one team end produced, in the shape the tool reply and a service caller read. */
export interface TeamEndPayload {
  /** The team that was ended, or was already ended. */
  teamId: string
  /** ISO instant the team ended: this call's stamp, or the FIRST ending's for a repeat. */
  endedAt: string
  /** The stored audit sentence: this call's reason, or the FIRST ending's for a repeat. */
  reason: string
  /** Whether THIS call performed the ending; false for the idempotent repeat. */
  changed: boolean
}

/** The input of one team end. */
export interface TeamEndInput {
  /** The team to end; absent names the team the calling session resolves. */
  teamId?: string
  /** Why it ended; stored as the record's `archivedReason`. */
  reason?: string
}

/** The input of one handoff write. */
export interface TeamHandoffInput {
  /** The complete handoff document; it must carry the seven required sections. */
  content: string
}

/**
 * D3: the evidence the WATCHDOG supplies to a force, because team-core cannot read it for itself.
 *
 * The watchdog owns the heartbeat stamps (the tool history) and already measured the duration against
 * its own tick clock, so it hands those facts over rather than making the action re-derive them from a
 * clock reading of a different process.
 */
export interface TeamForceEvidence {
  /** The owner exactly as the board spelled it (a member NAME or a session id), when the caller knows. */
  member?: string
  /** The generation token the watchdog decided on, for the record. */
  attemptId?: string
  /** Epoch ms at which the task entered `in_progress`, when the watchdog read one. */
  startedAt?: number
  /** How long the task had been in progress at the deciding tick, in ms. */
  elapsedMs?: number
  /** The tool names the member's stamps recorded for this task, oldest first. */
  lastToolCalls?: readonly string[]
}

/** The input of one FORCE (D3): which team, which row, and the watchdog's evidence. */
export interface TeamForceInput {
  /** The team whose board row crossed the bound; absent resolves the CALLER's own team. */
  teamId?: string
  /** The board row that is wedged. */
  taskId: string
  /** What the watchdog measured; every field is optional so a manual force still works. */
  evidence?: TeamForceEvidence
}

/** What one force produced, in the shape the service caller (the watchdog) records. */
export interface TeamForcePayload {
  /** The team the row belongs to. */
  teamId: string
  /** The board row that was forced. */
  taskId: string
  /** The member whose seat was interrupted, by board name. */
  member: string
  /** The handoff document the action wrote (an absolute path). */
  handoff: string
  /** Whether the member's executor session was actually interrupted. */
  interrupted: boolean
  /** Why the interrupt did not land, when it did not (the requeue and split still happened). */
  interruptError?: string
  /** The row after the requeue: `pending`, owner cleared, attempt bumped. */
  requeued: { taskId: string; attempt: number }
  /** The `[split]` rows this force created, in creation order. */
  split: string[]
  /** The mailbox row's id, when the captain notification landed. */
  mail?: string
  /** Why the mailbox row did not land (best-effort; the journal remains the durable notice). */
  mailError?: string
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

// ── WORKMATE BINDING AT APPROVAL (W3-C, plan §4.6) ────────────────────────────────────────────────
// WHY THIS LIVES HERE AND NOT IN THE WORKMATE ROW: the decision has to happen while the plan is still
// the only truth about the team — BEFORE a member row exists — because a REUSE gives the seat the
// workmate's OWN name, and a member's name is seat identity on this board (tasks address their owner by
// it). The binds therefore rewrite the plan's member names (and the tasks naming them) once, and every
// later step of the approval reads the rewritten plan.
//
// THE SEAM IS A TOOL CALL, NEVER AN IMPORT (C1): `mpd_workmate_list|match|init` are reached through the
// mounted adapter's `executeTool`, resolved from the `mpdDsh` service per approval. The persona/note/
// memory head comes from the `mpdWorkmate` service's own `read`, because no tool projects file content.

/** The match threshold the contract names; used only when the match tool does not report its own. */
const WORKMATE_MATCH_THRESHOLD = 0.35

/** The smallest free ordinal a generated workmate name starts from. */
const WORKMATE_NAME_FIRST_ORDINAL = 1

/**
 * How ONE staged member ended up bound to the durable workmate library.
 *
 * `mode:"none"` is not a failure: it is the deliberate plain-seat answer, and `reason` says WHY (the
 * `workmates.mode:"none"` switch, a library at its cap, a member with no roster role to init from, or
 * a seam that is not mounted / threw).
 */
export interface TeamWorkmateBinding {
  /** The board member's FINAL name — the workmate's own name on a reuse or an init. */
  member: string
  /** `reuse` = an existing instance was bound; `init` = a new one was made; `none` = a plain seat. */
  mode: "reuse" | "init" | "none"
  /** The bound instance; absent for `mode:"none"`. */
  workmate?: string
  /** Why the seat was left plain, when it was. */
  reason?: string
}

/** The binding knobs, read from the `mpdConfig` service; every one has a documented default. */
interface WorkmateBindingConfig {
  /** `workmates.mode`: `"auto"` binds seats, `"none"` leaves every seat plain. */
  mode: "auto" | "none"
  /** `workmates.autoInit`: whether a weak match may initialize a NEW instance. */
  autoInit: boolean
  /** `workmates.max`: the per-workspace library ceiling for automatic initialization. */
  max: number
}

/** One tool call the binding makes, in the adapter's own input shape. */
type WorkmateToolCall = { name: string; arguments?: Record<string, unknown> }

/** The tool seam: one call in, the tool's structured value out (a refused call throws). */
type WorkmateToolSeam = (call: WorkmateToolCall, agent: unknown) => Promise<unknown>

/** What one binding pass decided, and the plan the approval must therefore build. */
interface WorkmateBindingOutcome {
  /** Set when an EXPLICIT workmate name does not exist — the approval is refused, never downgraded. */
  error?: string
  /** The plan's members with their final names and prompts. */
  members: StagedMember[]
  /** The plan's tasks, with any `owner` that named a renamed member following it. */
  tasks: StagedPlan["tasks"]
  /** One row per staged member, in plan order. */
  bindings: TeamWorkmateBinding[]
}

/**
 * Read the binding knobs off the `mpdConfig` service, with the contract's defaults.
 *
 * A composition without that row (or a service that throws) answers the DEFAULTS, which is the
 * behaviour every pre-W3-C approval had: bind automatically, initialize when the note does not match,
 * twelve instances per workspace.
 * @param deps - the action's seams; `service` is the only one this reads.
 * @returns the effective binding config.
 */
function workmateBindingConfigOf(deps: TeamActionDeps): WorkmateBindingConfig {
  try {
    /** The config service, absent in a composition that does not mount the config row. */
    const config = deps.service("mpdConfig") as { get?: (key?: string) => unknown } | undefined
    if (config === undefined || config === null || typeof config.get !== "function") {
      return { mode: "auto", autoInit: true, max: 12 }
    }
    /** One config leaf, read through the service's dotted path. */
    const leaf = (key: string): unknown => {
      try { return config.get!(key) } catch { return undefined }
    }
    /** The raw mode; only the exact string `"none"` disables binding. */
    const rawMode = leaf("workmates.mode")
    /** The raw cap; only a positive integer is a cap, anything else keeps the default. */
    const rawMax = leaf("workmates.max")
    /** The raw auto-init switch; only an explicit boolean counts. */
    const rawAutoInit = leaf("workmates.autoInit")
    return {
      mode: rawMode === "none" ? "none" : "auto",
      autoInit: rawAutoInit === false ? false : true,
      max: typeof rawMax === "number" && Number.isInteger(rawMax) && rawMax > 0 ? rawMax : 12
    }
  } catch {
    return { mode: "auto", autoInit: true, max: 12 }
  }
}

/**
 * Resolve the workmate tool seam for ONE approval: the mounted adapter's `executeTool`.
 *
 * The adapter is read from the `mpdDsh` service — a service read, which C1 allows — and the call is
 * made with the approving agent so the tool resolves through THAT agent's own view. A composition
 * without the adapter (or an adapter that throws) answers `undefined`, which the binding pass treats as
 * "bind nothing" rather than as an error: the seat is simply plain.
 * @param deps - the action's seams.
 * @returns the callable seam, or undefined when no adapter serves this composition.
 */
function workmateToolSeamOf(deps: TeamActionDeps): WorkmateToolSeam | undefined {
  try {
    /** The mounted adapter, or undefined when no row provides it. */
    const adapter = deps.service("mpdDsh") as { executeTool?: (input: { name: string; arguments?: unknown; agent?: unknown }) => Promise<{ ok?: unknown; isError?: unknown; value?: unknown; error?: unknown }> } | undefined
    if (adapter === undefined || adapter === null || typeof adapter.executeTool !== "function") return undefined
    /** The seam: one tool call, its structured value, and a THROW for a refused call. */
    return async (call: WorkmateToolCall, agent: unknown): Promise<unknown> => {
      /** The harness's answer for this call. */
      const result = await adapter.executeTool!({
        name: call.name,
        arguments: call.arguments ?? {},
        ...(agent === undefined ? {} : { agent })
      })
      if (result === undefined || result === null) throw new Error(call.name + " answered nothing")
      if (result.isError === true || result.ok === false) throw new Error(call.name + " refused: " + String(result.error ?? "unknown"))
      return result.value
    }
  } catch {
    return undefined
  }
}

/** One library row, as far as the binding reads it. */
type WorkmateRow = {
  /** The instance's library key. */
  name: string
  /** The roster base's functional name. */
  baseName: string
  /**
   * The workspaces this instance has served (R-W3C B2), most recent first — what makes the auto-init
   * cap a PER-WORKSPACE budget rather than a HOME-wide one. Empty for a legacy instance that has never
   * been reused, which is why such an instance counts nowhere until it is used.
   */
  workspaces: string[]
}

/**
 * Normalize a candidate workmate name to the library's key spelling.
 * @param raw - the name as a caller spelled it.
 * @returns the lowercase `[a-z0-9_-]` key, or `""` when nothing usable remains.
 */
function workmateKeyOf(raw: unknown): string {
  return String(raw ?? "").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/-{2,}/g, "-").replace(/^-+|-+$/g, "")
}

/**
 * The EXPLICIT workmate a staged member names, if any.
 *
 * The spelling is ONE line — `workmate: <name>` or `[workmate: <name>]` — in the member's prompt first,
 * then its description. A line form is used rather than a new staged-field because the staged plan's
 * member shape is the public schema of `agent_teams_plan`; a marker line is visible to the captain in
 * the plan text and needs no schema change.
 * @param member - the staged member to read.
 * @returns the key it names, or undefined when it names none.
 */
function explicitWorkmateOf(member: StagedMember): string | undefined {
  /** The marker, anchored to a whole line so prose that merely mentions "workmate:" cannot match. */
  const marker = /^[ \t]*\[?workmate[ \t]*:[ \t]*([A-Za-z0-9_-]+)\]?[ \t]*$/m
  for (const text of [member.prompt, member.description]) {
    /** The marker's capture on this text, when it carries one. */
    const hit = marker.exec(String(text ?? ""))
    if (hit !== null) {
      /** The normalized key the marker names. */
      const key = workmateKeyOf(hit[1])
      if (key !== "") return key
    }
  }
  return undefined
}

/** The library listing, as the binding reads it. */
type WorkmateListing = { rows: WorkmateRow[]; ok: boolean }

/**
 * List the workmate library through the tool seam.
 * @param seam - the tool seam.
 * @param agent - the approving agent.
 * @returns the rows and whether the read succeeded; a failed read answers `ok:false` with no throw.
 */
async function listWorkmates(seam: WorkmateToolSeam, agent: unknown): Promise<WorkmateListing> {
  try {
    /** The list tool's structured answer. */
    const value = await seam({ name: "mpd_workmate_list" }, agent) as { workmates?: unknown } | undefined
    /** The rows, kept only when the tool answered an array. */
    const raw = Array.isArray(value?.workmates) ? value!.workmates as Array<Record<string, unknown>> : []
    return {
      rows: raw
        .map((row) => ({ name: workmateKeyOf(row?.name), baseName: String(row?.baseName ?? ""), workspaces: Array.isArray(row?.workspaces) ? row.workspaces.map(String).filter((workspace: string) => workspace !== "") : [] }))
        .filter((row) => row.name !== ""),
      ok: true
    }
  } catch {
    return { rows: [], ok: false }
  }
}

/**
 * The prompt head a REUSED workmate brings to its seat: its persona, then its note, then the newest
 * slice of its independent memory.
 *
 * Read through the `mpdWorkmate` service's own `read`, because no tool projects file content. An absent
 * service degrades to the empty head — the member keeps the prompt it was staged with.
 * @param deps - the action's seams.
 * @param key - the workmate's library key.
 * @returns the head text, or `""` when nothing could be read.
 */
function workmateHeadOf(deps: TeamActionDeps, key: string): string {
  try {
    /** The library service, absent in a composition without the workmate row. */
    const library = deps.service("mpdWorkmate") as { read?: (name: string) => { persona?: unknown; memory?: unknown; note?: unknown } | null } | undefined
    if (library === undefined || library === null || typeof library.read !== "function") return ""
    /** The instance's full read model, or null when it cannot be read. */
    const record = library.read(key)
    if (record === null || record === undefined) return ""
    /** The persona body. */
    const persona = String(record.persona ?? "").trim()
    /** The note card. */
    const note = String(record.note ?? "").trim()
    /** The bounded memory. */
    const memory = String(record.memory ?? "").trim()
    return [
      persona,
      note === "" ? "" : "Workmate note:\n" + note,
      memory === "" ? "" : "Your independent memory (bounded, latest first):\n" + memory
    ].filter((part) => part !== "").join("\n\n")
  } catch {
    return ""
  }
}

/**
 * Bind every staged member to the durable workmate library, deterministically, in plan order.
 *
 * THE DECISION TABLE (contract §4.6), per member:
 *   0. `workmates.mode:"none"` → plain seat (no binding at all);
 *   1. the member names an explicit workmate → bind it, or REFUSE the whole approval when it does not
 *      exist (never a silent downgrade to a plain seat);
 *   2. `mpd_workmate_match` over `<description> <role>`;
 *   3. the best match at or above the threshold whose name is FREE ON THIS TEAM → REUSE: the seat takes
 *      the workmate's name and its persona/note/memory head;
 *   4. else `workmates.autoInit` and the library below `workmates.max` → INIT `<role>-<smallest n>`;
 *   5. else a plain seat with the reason recorded.
 *
 * NON-FATAL BY CONSTRUCTION: an unexpected throw inside the pass leaves every member plain with ONE log
 * line, exactly like the approval's other bundled effects — a workmate library that cannot answer must
 * never take an approval down.
 * @param deps - the action's seams.
 * @param plan - the staged plan being approved.
 * @param agent - the approving live agent, forwarded to every tool call.
 * @returns the plan to build and one binding row per staged member.
 */
async function bindStagedWorkmates(deps: TeamActionDeps, plan: StagedPlan, agent: unknown, workspace: string): Promise<WorkmateBindingOutcome> {
  /** The plain answer this pass falls back to: the plan untouched, every seat unbound. */
  const plain = (reason: string): WorkmateBindingOutcome => ({
    members: plan.members.map((member) => ({ ...member })),
    tasks: plan.tasks,
    bindings: plan.members.map((member) => ({ member: member.name, mode: "none" as const, reason }))
  })
  /** The knobs; `mode:"none"` short-circuits before any seam is resolved. */
  const config = workmateBindingConfigOf(deps)
  if (config.mode === "none") return plain("config")
  /** The tool seam; an absent adapter leaves every seat plain rather than failing the approval. */
  const seam = workmateToolSeamOf(deps)
  if (seam === undefined) {
    deps.log("workmate binding skipped: no mpdDsh tool seam in this composition — every seat stays plain")
    return plain("no-seam")
  }
  try {
    /** The members as they will be staged, mutated member by member. */
    const members: StagedMember[] = plan.members.map((member) => ({ ...member }))
    /** One binding row per member, in plan order. */
    const bindings: TeamWorkmateBinding[] = []
    /** Names already taken ON THIS TEAM: a name is seat identity, so a bind must never merge two seats. */
    const taken = new Set(members.map((member) => member.name))
    /** The library, read once per approval. */
    let listing = await listWorkmates(seam, agent)
    // THE CAP IS A PER-WORKSPACE BUDGET (R-W3C Medium 1): the library is HOME-scoped, so counting its rows
    // let another project's instances consume this workspace's budget and refuse a fresh project's
    // auto-init. Only the rows attributed to THIS workspace count; an unattributed legacy instance counts
    // nowhere until it is reused here (which is when `mpd_workmate_spawn`/`reflect` attribute it).
    /** How many library instances this workspace already owns. */
    const ownedHere = (): number => listing.rows.filter((row) => row.workspaces.includes(workspace)).length
    // A LIBRARY THAT CANNOT BE READ IS A NORMAL COMPOSITION, not a degradation: the workmate row is
    // optional, and a workspace that never mounted it must approve exactly as it always did. No log
    // line, because nothing went wrong — the seats are simply plain.
    if (!listing.ok) return plain("no-library")
    for (const [index, member] of members.entries()) {
      /** This member's original staged name, which tasks may address as their owner. */
      const original = member.name
      /** The names taken by the OTHER seats, which this member may not take. */
      const takenByOthers = new Set([...taken].filter((name) => name !== original))
      // 1. AN EXPLICIT NAME IS A CONTRACT: bind it or refuse the approval.
      /** The workmate this member explicitly names, if any. */
      const explicit = explicitWorkmateOf(member)
      if (explicit !== undefined) {
        if (!listing.rows.some((row) => row.name === explicit)) {
          return { error: `staged member "${original}" explicitly names workmate "${explicit}", which does not exist in the library — the approval is refused rather than downgrading the seat to a plain member; initialize it with mpd_workmate_init or remove the workmate: line`, members, tasks: plan.tasks, bindings }
        }
        if (takenByOthers.has(explicit)) {
          return { error: `staged member "${original}" explicitly names workmate "${explicit}", which another member of this team already takes — a member NAME is seat identity, so two seats may not share one workmate`, members, tasks: plan.tasks, bindings }
        }
        members[index] = { ...member, name: explicit, prompt: joinWorkmatePrompt(workmateHeadOf(deps, explicit), member.prompt) }
        taken.delete(original)
        taken.add(explicit)
        bindings.push({ member: explicit, mode: "reuse", workmate: explicit })
        continue
      }
      // 2/3. MATCH, and reuse the best FREE instance at or above the threshold.
      /** The text the library is matched against. */
      const task = [member.description, member.role ?? ""].join(" ").trim()
      /** The match tool's structured answer, or undefined when it refused. */
      let matched: { matches?: unknown; threshold?: unknown } | undefined
      try { matched = await seam({ name: "mpd_workmate_match", arguments: { task } }, agent) as typeof matched } catch { matched = undefined }
      /** The reported threshold, or the contract's own when the tool does not report one. */
      const threshold = typeof matched?.threshold === "number" ? matched.threshold : WORKMATE_MATCH_THRESHOLD
      /** The ranked matches, best first, filtered to usable rows. */
      const ranked = (Array.isArray(matched?.matches) ? matched!.matches as Array<Record<string, unknown>> : [])
        .map((row) => ({ name: workmateKeyOf(row?.name), score: Number(row?.score ?? 0) }))
        .filter((row) => row.name !== "")
        .sort((a, b) => b.score - a.score)
      /** The best match that clears the threshold and is free on this team. */
      const reusable = ranked.find((row) => row.score >= threshold && !takenByOthers.has(row.name))
      if (reusable !== undefined) {
        members[index] = { ...member, name: reusable.name, prompt: joinWorkmatePrompt(workmateHeadOf(deps, reusable.name), member.prompt) }
        taken.delete(original)
        taken.add(reusable.name)
        bindings.push({ member: reusable.name, mode: "reuse", workmate: reusable.name })
        continue
      }
      // 4. INITIALIZE a new instance when the contract allows it.
      /** The roster role the new instance is copied from; absent means there is nothing to initialize. */
      const base = String(member.role ?? "").trim()
      if (!config.autoInit || base === "") {
        bindings.push({ member: original, mode: "none", reason: config.autoInit ? "no-role" : "auto-init-off" })
        continue
      }
      if (ownedHere() >= config.max) {
        bindings.push({ member: original, mode: "none", reason: "cap" })
        continue
      }
      /** The generated name's prefix, derived from the roster role. */
      const slug = workmateKeyOf(base) || "workmate"
      /** The smallest ordinal whose generated name is free in the library AND on this team. */
      let ordinal = WORKMATE_NAME_FIRST_ORDINAL
      while (listing.rows.some((row) => row.name === `${slug}-${ordinal}`) || takenByOthers.has(`${slug}-${ordinal}`)) ordinal += 1
      /** The name the new instance takes. */
      const name = `${slug}-${ordinal}`
      try {
        await seam({ name: "mpd_workmate_init", arguments: { base, name } }, agent)
      } catch {
        // A refused init is a PLAIN SEAT with the reason recorded — never a failed approval.
        bindings.push({ member: original, mode: "none", reason: "init-refused" })
        continue
      }
      // The library grew by one, so the cap check above must see it on the next member.
      listing = { rows: [...listing.rows, { name, baseName: base, workspaces: [workspace] }], ok: true }
      members[index] = { ...member, name, prompt: joinWorkmatePrompt(workmateHeadOf(deps, name), member.prompt) }
      taken.delete(original)
      taken.add(name)
      bindings.push({ member: name, mode: "init", workmate: name })
    }
    // A RENAMED MEMBER MUST TAKE ITS BOARD REFERENCES WITH IT: a staged task addresses its owner by the
    // member's name, and a rename that left `owner` behind would mint a row nobody owns.
    /** The original member name → the final name, for every member this pass renamed. */
    const renames = new Map<string, string>()
    plan.members.forEach((member, index) => { if (members[index].name !== member.name) renames.set(member.name, members[index].name) })
    /** The plan's tasks with every owner that named a renamed member following it. */
    const tasks = renames.size === 0 ? plan.tasks : plan.tasks.map((task) => (task.owner !== undefined && renames.has(task.owner) ? { ...task, owner: renames.get(task.owner)! } : task))
    return { members, tasks, bindings }
  } catch (error) {
    deps.log("workmate binding failed (" + String((error as Error)?.message ?? error) + ") — every seat stays plain")
    return plain("binding-failed")
  }
}

/**
 * Join a workmate's context head to the prompt the member was staged with.
 * @param head - the persona/note/memory head, or the empty string.
 * @param prompt - the staged prompt, used verbatim when there is no head.
 * @returns the prompt the executor receives, before the idle preamble.
 */
function joinWorkmatePrompt(head: string, prompt: string): string {
  return head === "" ? prompt : head + "\n\n" + prompt
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
    // ── WORKMATE BINDING, BEFORE THE FIRST RECORD WRITE (W3-C, plan §4.6) ──
    // A REUSE gives the seat the workmate's OWN name, and a member name is seat identity here, so the
    // decision must be made while the plan is still the only truth about the team. A dry run never
    // binds: the pass may INITIALIZE an instance, and a preview must write nothing.
    /** Everything the binding pass decided, plus the plan the approval therefore builds. */
    const bound = await bindStagedWorkmates(deps, plan, caller.agent, workspace)
    if (bound.error !== undefined) return { ok: false, error: bound.error }
    /** The plan this approval BUILDS: the staged plan with each seat's final name and prompt. */
    const buildPlan: StagedPlan = { ...plan, members: bound.members, tasks: bound.tasks }
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
    for (const member of buildPlan.members) {
      record = addTeamMember(record, { name: member.name, description: member.description, ...(member.role === undefined ? {} : { role: member.role }) }, deps.now())
    }
    // THE BINDING IS DURABLE, not just reported: the record names the instance each seat took AND how
    // that decision was reached, so a later reader (the merge gate, the panels, `status`) can tell a
    // reused seat from an initialized one from a plain one, and can quote WHY a seat is plain.
    for (const binding of bound.bindings) {
      record = updateTeamMember(record, binding.member, {
        workmateMode: binding.mode,
        ...(binding.workmate === undefined ? {} : { workmate: binding.workmate }),
        ...(binding.reason === undefined ? {} : { workmateReason: binding.reason })
      })
    }
    // THE ORDER IS THE FIX (defect 2026-10-06). Every staged task is minted FIRST and the blockers
    // are resolved afterwards, against the COMPLETE board: a plan may legitimately name a task that
    // comes LATER (a forward reference), and resolving per insert could only ever see the tasks
    // before it — which is how a plan written in its own POSITIONS (`["2"]`, `["7","8","9"]`) used to
    // reach the board as references no task answered, flattening the whole DAG to one column with no
    // warning anywhere. `blockedBy` is therefore added in a second pass, through `updateTeamTask`,
    // once the plan's own namespace can be mapped to real board ids.
    for (const task of buildPlan.tasks) {
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
    buildPlan.tasks.forEach((task, index) => {
      /** The board task the staged task at this position was minted as; absent for an empty subject. */
      const minted = record.tasks[index]
      if (minted === undefined) return
      // BOTH FORMS THE PLAN CAN MEAN are mapped, position first: `"2"` is the second staged task,
      // and the subject is what the plan-store's own documentation has always promised.
      planAlias.set(String(index + 1), minted.id)
      if (!planAlias.has(task.subject)) planAlias.set(task.subject, minted.id)
    })
    for (const [index, task] of buildPlan.tasks.entries()) {
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
          prompt: withIdlePreamble(buildPlan.members.find((staged) => staged.name === member.name)?.prompt ?? member.description),
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
    return { ok: true, plan: approved, team: approvedRecord, created, bindings: bound.bindings, ...(stoppedAt === undefined ? {} : { stoppedAt }) }
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
  // ── THE ONE VALIDATION, ON THE ONE PATH BOTH SURFACES TAKE (R-W1A review / W2 gap 1) ──
  // The tool used to validate `reassign` and `mode` at its own boundary while this action accepted
  // anything a service caller handed it, so the two surfaces could disagree about what a legal request
  // was. The reading now happens HERE, before the first store read, and both callers receive the same
  // sentence; the sentences themselves are unchanged, which is what keeps the tool's contract stable.
  /** The readable `reassign` pairs, and one sentence per entry this build refused. */
  const handover = readReassign(input.reassign)
  if (handover.invalid.length > 0) return { ok: false, error: `agent_teams_dispatch: ${handover.invalid.join("; ")}` }
  /** The pairing rule the caller asked for, still untyped because it came off the wire. */
  const requestedMode: unknown = input.mode
  if (requestedMode !== undefined && requestedMode !== "owner-only" && requestedMode !== "roster") {
    return { ok: false, error: `agent_teams_dispatch: unknown mode "${String(requestedMode)}" (owner-only | roster)` }
  }
  /** The rule to run; undefined leaves the engine's own owner-only default in charge. */
  const mode: DispatchMode | undefined = requestedMode
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
    // C7-2's SOURCE, read PER CALL and never copied: mpd-roles-plugin's OWN published service, whose
    // `readonly` flag is the same one that decides whether a spawn passes `READONLY_DENY`. The guard
    // FAILS OPEN when the row is absent (no read-only key, so the pairing is left as it was) and says
    // so ONCE, so a composition without the roster can never have its dispatch silently narrowed.
    // READ BEFORE THE HAND-OVER because the reassignment path needs the SAME keys: a hand-over is a
    // pairing, and a pairing the pass would refuse must be refused by the repair too.
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
    // ── THE REASSIGNMENT PHASE (D4), BEFORE the pairing decision ─────────────────
    // A hand-over is the repair the owner-only rule needs, and it must land BEFORE the pass reads the
    // board: the pass derives "ready" and "idle" from the record, so a claim written afterwards would be
    // invisible to it and the same row could be paired a second time in the same call.
    /** The hand-overs this call performed, in the caller's order. */
    const reassigned: TeamReassignOutcome[] = []
    // A HALT REFUSES DELIVERIES, and a hand-over delivers one — so the phase is SKIPPED, never early-
    // returned: the pass below still runs its own halted path, which prunes the ledger and reports
    // `forgotten`/`holdRead`, and an early return here would answer a DIFFERENT payload for the same hold.
    /** Whether a hold makes this call refuse every delivery, the hand-overs included. */
    const reassignHalted = handover.pairs.length > 0 && holdReason !== undefined
    if (handover.pairs.length > 0 && !reassignHalted) {
      // THE TARGET IS CHECKED BEFORE THE CLAIM (carried from cellwork's reassign): claiming a row for a
      // member that cannot be woken would hide it from the next pass. Each pair is reported on its own,
      // never thrown, so one bad entry does not erase the rest of the repair.
      /** What this call's hand-overs did. */
      const outcomes = await applyReassignments({
        workspace,
        team: record,
        pairs: handover.pairs,
        dryRun: input.dryRun === true,
        now: deps.now(),
        readonlyKeys,
        send: async (handle: string, content: string): Promise<void> => {
          await deps.executor().send(caller.agent, handle, content, caller.signal)
        },
      })
      reassigned.push(...outcomes)
      // The pass below must see the board as the hand-overs left it: the claimed rows carry a new owner
      // and the target members are busy, and pairing against the stale snapshot could double-book them.
      if (input.dryRun !== true) record = readTeam(workspace, record.teamId) ?? record
    }
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
      // THE SEAT STATE IS CARRIED, not filtered here: the engine owns the "never message a fenced seat"
      // rule (and the sentence naming the repair), so both the default pass and the roster fallback
      // obey ONE definition of a closed seat.
      ...(member.mode === undefined ? {} : { mode: member.mode }),
      ...(member.fenced === true ? { fenced: true } : {}),
      ...(member.fencedReason === undefined ? {} : { fencedReason: member.fencedReason }),
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
      // D4: the pairing rule is the CALLER's choice, and the engine's own default is owner-only.
      ...(mode === undefined ? {} : { mode }),
    })
    if (plan.halted !== undefined || input.dryRun === true || plan.pairs.length === 0) {
      if (pruned.forgotten.length > 0) writeLedger(workspace, pruned.ledger)
      return { ok: true, ...plan, forgotten, ...(holdNote === undefined ? {} : { holdRead: holdNote }), ...(reaped.length === 0 ? {} : { reaped }), ...(reassigned.length === 0 ? {} : { reassigned }) }
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
        // THE ACCEPTANCE TEXT COMES FROM THE RECORD, not from the dispatch projection: the projection is
        // the ENGINE's view (id/subject/status/ready/scopes) and deliberately carries no description, so
        // reading it there delivered an EMPTY body where the task's description belonged (measured: the
        // message showed four newlines and no acceptance text). A caller that puts a pointer in the
        // description — a frozen-contract path — needs it to reach the member verbatim.
        /** The board's own RECORD row for this pair, used for the acceptance text. */
        const task = opened.tasks.find((candidate) => candidate.id === pair.taskId)
        try {
          // DELIVERED THROUGH THE EXECUTOR, which on the native backend cold-resumes a child that
          // is not currently live — the behaviour a dispatch pass depends on.
          await deps.executor().send(caller.agent, pair.memberId, dispatchMessage({ id: pair.taskId, subject: pair.subject, status: "pending", ready: true }, task === undefined ? "" : String(task.description ?? "")), caller.signal)
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
    return { ok: true, pairs: sent, skipped, forgotten, ...(holdNote === undefined ? {} : { holdRead: holdNote }), ...(reaped.length === 0 ? {} : { reaped }), ...(reassigned.length === 0 ? {} : { reassigned }) }
  } catch (error) {
    // UNEXPECTED, like approval's catch: a missing team is a `refused` PAYLOAD above, a per-pair send
    // failure is a `skipped` row, and the hold readings are contained — so anything that reaches here
    // is a real store failure whose sentence may embed a path. Marked for the route's generic 500; the
    // sentence survives for the row log and for the tool path, which rethrows it unchanged.
    return unexpectedRefusalOf(error)
  }
}


/**
 * The seams one reassignment needs.
 *
 * A separate deps record (rather than the whole {@link TeamActionDeps}) so the hand-over path names
 * exactly what it touches: the board, the record write, the journal, the ledger and ONE delivery.
 */
interface ReassignDeps {
  /** The workspace root the caller resolved through the adapter. */
  workspace: string
  /** The team the rows belong to, as the pass read it. */
  team: TeamRecord
  /** The readable pairs to apply, in the caller's order. */
  pairs: readonly ReassignPair[]
  /** Report the hand-overs and write nothing (the tool's `dry_run: true`). */
  dryRun: boolean
  /** The instant to stamp the journal rows and the ledger entries with. */
  now: Date
  /**
   * The roster's READ-ONLY member keys ({@link readonlyMemberKeys}), read once for the pass.
   *
   * THE SAME KEYS `planDispatch` pairs against, passed in rather than re-read: a hand-over must be refused
   * by the IDENTICAL C7-2 guard the pairing path applies, or the repair becomes the bypass of a rule the
   * pass enforces one line earlier (measured: a write task reassigned to `Plan Reviewer` was claimed and
   * delivered).
   */
  readonlyKeys: ReadonlySet<string>
  /** Deliver one dispatch message to one member handle; the caller binds the Lead agent. */
  send: (handle: string, content: string) => Promise<void>
}

/**
 * Claim each named row for its new member, journal the hand-over, record the pairing, then deliver.
 *
 * THE ORDER IS THE CONTRACT (carried from cellwork's reassign): the board write lands BEFORE the message,
 * so a member never receives work it cannot see on the board; the journal row is written between them so
 * the hand-over survives a crash of either half; and the ledger entry is written before the send so a
 * concurrent pass cannot pair the same row again while the message is in flight.
 *
 * THE TARGET IS CHECKED BEFORE THE CLAIM: a member this team never raised has no executor handle, and
 * claiming a row for someone who cannot be woken would hide the row from the next pass. A fenced target
 * is refused for the same reason (a message to it could only be refused by that member's own guard).
 *
 * BOUND, stated rather than papered over: this path admits a `pending` row, which is the state the
 * owner-only rule leaves a fenced owner's work in, because the board's claim rule
 * (`team-store.ts#casClaimTask`) is pending-only. An `in_progress` row is refused with the repair — its
 * owner must release it first — so the hand-over can never reopen a row somebody may still be working.
 * @param deps - the board, the record write, the journal, the ledger and the delivery.
 * @returns one outcome per pair, in the caller's order; never thrown.
 */
async function applyReassignments(deps: ReassignDeps): Promise<TeamReassignOutcome[]> {
  /** One outcome per pair, in the caller's order. */
  const outcomes: TeamReassignOutcome[] = []
  for (const pair of deps.pairs) {
    /** The board row the pair names, read from the record this pass opened. */
    const task = deps.team.tasks.find((row) => row.id === pair.taskId)
    if (task === undefined) {
      outcomes.push({ taskId: pair.taskId, owner: pair.owner, claimed: false, delivered: false, reason: `no board row is named ${JSON.stringify(pair.taskId)} — nothing was reassigned` })
      continue
    }
    if (task.status === "completed" || task.status === "failed" || task.status === "cancelled") {
      outcomes.push({ taskId: pair.taskId, owner: pair.owner, claimed: false, delivered: false, reason: `row ${pair.taskId} is already ${task.status} — a terminal row is never reopened` })
      continue
    }
    if (task.status !== "pending") {
      outcomes.push({ taskId: pair.taskId, owner: pair.owner, claimed: false, delivered: false, reason: `row ${pair.taskId} is ${task.status}; release it first (agent_teams_task {action:"release", task_id:${JSON.stringify(pair.taskId)}}) and reassign the pending row` })
      continue
    }
    /** The roster row the requested owner names. */
    const member = deps.team.members.find((row) => row.id === pair.owner || row.name === pair.owner)
    if (member === undefined) {
      outcomes.push({ taskId: pair.taskId, owner: pair.owner, claimed: false, delivered: false, reason: `no member ${JSON.stringify(pair.owner)} is on the roster of team ${deps.team.teamId}` })
      continue
    }
    // THE TARGET IN THE DISPATCH ENGINE'S OWN MEMBER SHAPE, so every rule that judges a PAIRING judges a
    // hand-over too. `readonly` is the role-OR-name spelling the pairing roster builds, from the SAME key
    // set, so a seat cannot be read-only for a pairing and writable for a reassignment.
    /** The target seat, as the pairing engine sees it. */
    const target: DispatchMember = {
      id: member.executorRef ?? member.id,
      name: member.name,
      status: member.status,
      ...(member.mode === undefined ? {} : { mode: member.mode }),
      ...(member.fenced === true ? { fenced: true } : {}),
      ...(member.fencedReason === undefined ? {} : { fencedReason: member.fencedReason }),
      readonly: isReadonlyMemberName(member.name, deps.readonlyKeys) || (member.role !== undefined && isReadonlyMemberName(member.role, deps.readonlyKeys)),
    }
    /** The target's own fence reading: a fenced or checkpointed seat is never messaged. */
    const fence = memberFenceReason(target)
    if (fence !== undefined) {
      outcomes.push({ taskId: pair.taskId, owner: member.name, claimed: false, delivered: false, reason: `the target member ${JSON.stringify(member.name)} is FENCED (${fence}) — a fenced member is never messaged` })
      continue
    }
    // A DEAD SEAT IS REFUSED BY NAME (cellwork repair R-A1, carried here): a FAILED raise can still carry
    // an `executorRef`, and a seat still being raised has one that resolves to nothing yet — delivering a
    // row to either leaves it `in_progress` with nobody working it, which is worse than a pending row.
    if (member.status === "failed") {
      outcomes.push({ taskId: pair.taskId, owner: member.name, claimed: false, delivered: false, reason: `the target member ${JSON.stringify(member.name)} FAILED to start, so it cannot take the row — pick a live member, and raise this seat again first` })
      continue
    }
    if (member.status === "provisioning") {
      outcomes.push({ taskId: pair.taskId, owner: member.name, claimed: false, delivered: false, reason: `the target member ${JSON.stringify(member.name)} is still being raised, so it cannot take the row yet — wait for its handle, then reassign` })
      continue
    }
    // THE PAIRING GUARD, VERBATIM (C7-1/C7-2). This is the SAME predicate the pass applies to every pair it
    // decides, so a read-only specialist (or a cross-team row) is refused with the SAME sentence — the
    // repair path may never be the way around a rule the pass enforces.
    /** Why this pairing is illegal, or undefined when it is allowed. */
    const pairing = pairingRefusal({
      id: task.id,
      subject: task.subject,
      status: task.status,
      ready: true,
      teamId: deps.team.teamId,
      writeScopes: task.writeScopes,
    }, target)
    if (pairing !== undefined) {
      outcomes.push({ taskId: pair.taskId, owner: member.name, claimed: false, delivered: false, reason: pairing })
      continue
    }
    /** The executor handle the message must address; a member never raised has none. */
    const handle = member.executorRef ?? ""
    if (handle === "") {
      outcomes.push({ taskId: pair.taskId, owner: member.name, claimed: false, delivered: false, reason: `the target member ${JSON.stringify(member.name)} has no executor handle (never raised) — claiming the row for it would hide the row from the next pass` })
      continue
    }
    // THE CLAIM, on the FRESH record and CAS'd against the row's own revision: another writer may have
    // moved the row while this call was resolving its team, and a blind write would revert that change.
    /** The record as it stands on disk right now. */
    const fresh = readTeam(deps.workspace, deps.team.teamId)
    /** The row as the fresh record carries it, so the claim's revision is the live one. */
    const current = fresh?.tasks.find((row) => row.id === pair.taskId)
    if (fresh === undefined || current === undefined) {
      outcomes.push({ taskId: pair.taskId, owner: member.name, claimed: false, delivered: false, reason: `row ${pair.taskId} disappeared while the reassignment was in flight` })
      continue
    }
    // ── THE READINESS PREDICATE, BEFORE THE CAS (wave W2-C, gap 1) ──
    // A row whose declared blockers are unsatisfied is NOT reassignable: a hand-over would wake a member
    // for work it cannot start, which is exactly the refusal `agent_teams_task {action:"claim"}` already
    // gives. `blockingDependencies` is the ONE predicate `readyTasks`, `taskVisual` and the claim path all
    // call, so this is the same rule asked once more — not a second one. The sentence names the blocking
    // ids (and the subject when the board holds it) so the repair is actionable, and the row is left
    // exactly as it was: no claim, no journal row, no delivery.
    /** The blockers that still block, through the readiness predicate every reader shares. */
    const unmet = blockingDependencies(fresh.tasks, current.blockedBy).blocking
    if (unmet.length > 0) {
      /** The blocking ids with their subjects, as the claim refusal spells them. */
      const named = unmet.map((id: string) => {
        /** The blocker's own row, when the board has one. */
        const row = fresh.tasks.find((candidate) => candidate.id === id)
        return row === undefined ? id : id + " " + JSON.stringify(row.subject)
      })
      outcomes.push({ taskId: pair.taskId, owner: member.name, claimed: false, delivered: false, reason: `task ${current.id} ${JSON.stringify(current.subject)} is BLOCKED by ${named.join(", ")}: the declared ${unmet.length === 1 ? "blocker is" : "blockers are"} not satisfied — close ${unmet[0]} first (agent_teams_task {action:"complete", task_id:"${unmet[0]}"}) or fail it, which releases its dependents, then reassign ${pair.taskId}` })
      continue
    }
    // THE DRY RUN STOPS HERE, AFTER the readiness decision: a preview must report the SAME refusal a real
    // call would, and only then say that nothing was written. Reporting "dry run" instead would hide a
    // blocked row from the operator who asked the question.
    if (deps.dryRun) {
      outcomes.push({ taskId: pair.taskId, owner: member.name, claimed: false, delivered: false, reason: "dry run — nothing was claimed, journaled or sent" })
      continue
    }
    /** The owner the row is being taken from, for the journal row. */
    const previous = String(current.owner ?? "")
    /** The board's answer to the claim. */
    const claimed = casClaimTask(fresh, pair.taskId, member.name, current.revision, deps.now)
    if (!claimed.applied) {
      outcomes.push({ taskId: pair.taskId, owner: member.name, claimed: false, delivered: false, reason: `the board refused the claim: ${claimed.reason}` })
      continue
    }
    writeTeam(deps.workspace, claimed.record)
    appendTeamJournal(deps.workspace, { event: "task-reassigned", teamId: deps.team.teamId, at: deps.now.toISOString(), taskId: pair.taskId, member: member.name, ...(previous === "" ? {} : { from: previous }) })
    // MERGE, never a blind overwrite: the ledger has a second writer (a release, a concurrent pass), so
    // this entry is added to whatever the file holds right now.
    writeLedger(deps.workspace, assign(readLedger(deps.workspace), { teamId: deps.team.teamId, taskId: pair.taskId, memberId: handle, memberName: member.name }, deps.now))
    try {
      await deps.send(handle, dispatchMessage({ id: pair.taskId, subject: task.subject, status: "pending", ready: true }, String(task.description ?? "")))
      outcomes.push({ taskId: pair.taskId, owner: member.name, claimed: true, delivered: true })
    } catch (error) {
      outcomes.push({ taskId: pair.taskId, owner: member.name, claimed: true, delivered: false, reason: `the row IS claimed for ${JSON.stringify(member.name)} but the message failed: ${String((error as Error)?.message ?? error)}` })
    }
  }
  return outcomes
}

/**
 * The shared body of `fence` and `unfence`: one seat, one record write, one journal row.
 *
 * ONLY THE LEAD may close or reopen a seat. A fence takes a member out of the dispatch pool — the same
 * class of change as assigning ownership — and the live-roster arm of `agent_teams_plan` already
 * refuses a non-Lead writer for that reason, so a member must not park a teammate either.
 *
 * UNFENCE REOPENS BOTH SPELLINGS of a closed seat: the explicit fence AND the `checkpoint` window a
 * handoff leaves behind. Without that, a member that wrote its handoff could never be woken by any verb.
 * @param deps - the row seams this action needs; see {@link TeamActionDeps}.
 * @param caller - who is acting, in which workspace and under which cancellation.
 * @param input - the member and the optional reason.
 * @param fenced - `true` fences, `false` clears the fence.
 * @returns the seat's new state, or one refusal sentence.
 */
async function setMemberFence(
  deps: TeamActionDeps,
  caller: TeamActionCaller,
  input: TeamFenceInput,
  fenced: boolean,
): Promise<TeamActionResult<TeamFencePayload>> {
  try {
    /** The team this call works on, or the sentence saying why none resolved. */
    const resolved = deps.resolveTeam(caller.workspace, caller.sessionId, caller.lineage)
    if (resolved.record === undefined) return { ok: false, error: resolved.refusal ?? "no team record in this workspace — approve a plan first" }
    if (!recordNamesLead(resolved.record, [caller.sessionId])) {
      return { ok: false, error: `only the Lead of team ${resolved.record.teamId} may ${fenced ? "fence" : "unfence"} a seat` }
    }
    /** The seat this call names, by member id or by display name. */
    const target = input.member.trim()
    /** The roster row the target names. */
    const member = resolved.record.members.find((row) => row.id === target || row.name === target)
    if (member === undefined) return { ok: false, error: `no member ${JSON.stringify(input.member)} is on the roster of team ${resolved.record.teamId}` }
    /** The reason recorded beside the fence; empty for a bare fence and for an unfence. */
    const reason = fenced ? (input.reason ?? "").trim() : ""
    // UNFENCE REOPENS BOTH CLOSED SPELLINGS. `mode: checkpoint` is the handoff window, and it closes a
    // seat exactly as a fence does — so the ONE operator repair must clear both, or a member that wrote
    // its handoff would stay unmessageable with no verb able to reopen it.
    /** The record with the seat's closed state changed; `fenced: false` DELETES the fence keys. */
    const next = updateTeamMember(resolved.record, member.name, fenced
      ? { fenced: true, ...(reason === "" ? {} : { fencedReason: reason }) }
      : { fenced: false, ...(member.mode === "checkpoint" ? { mode: "member" as const } : {}) })
    writeTeam(caller.workspace, next)
    appendTeamJournal(caller.workspace, { event: fenced ? "member-fenced" : "member-unfenced", teamId: resolved.record.teamId, at: deps.now().toISOString(), member: member.name, ...(reason === "" ? {} : { reason }) })
    return { ok: true, teamId: resolved.record.teamId, member: member.name, fenced, ...(reason === "" ? {} : { reason }) }
  } catch (error) {
    return unexpectedRefusalOf(error)
  }
}

/**
 * Fence one seat: a fenced member is NEVER messaged by a dispatch pass until it is unfenced.
 * @param deps - the row seams this action needs; see {@link TeamActionDeps}.
 * @param caller - who is acting, in which workspace and under which cancellation.
 * @param input - the member and why it is being fenced.
 * @returns the seat's new state, or one refusal sentence.
 */
export async function fenceMember(deps: TeamActionDeps, caller: TeamActionCaller, input: TeamFenceInput): Promise<TeamActionResult<TeamFencePayload>> {
  return setMemberFence(deps, caller, input, true)
}

/**
 * Clear one seat's fence, so a dispatch pass may message it again.
 * @param deps - the row seams this action needs; see {@link TeamActionDeps}.
 * @param caller - who is acting, in which workspace and under which cancellation.
 * @param input - the member whose fence is cleared.
 * @returns the seat's new state, or one refusal sentence.
 */
export async function unfenceMember(deps: TeamActionDeps, caller: TeamActionCaller, input: TeamFenceInput): Promise<TeamActionResult<TeamFencePayload>> {
  return setMemberFence(deps, caller, input, false)
}

/**
 * The Lead authority one caller may claim on ONE record, narrowed by the repository's F-B rule.
 *
 * WHY THE NARROWING (PR #42 review F-B/CWE-863; plane-level since T12). `lineage` exists so a forked or
 * resumed Lead keeps captaincy after its session id changes (C7-4 F5). But a SPAWNED MEMBER's session
 * also names the Lead as its `parentSession`, and a RESUMED member's id is neither its `executorRef` nor
 * any Lead id — so an id-only guard read the seat as a forked Lead and this irreversible verb ended the
 * team. The decision is the record's: {@link memberIdentityOf} in `team-store.ts` (own id → recorded
 * ancestor → persona title over the seat's ROLE, then its stored name) is the SAME narrowing `index.ts#callerIdentity`
 * calls, so the two surfaces cannot disagree.
 *
 * A caller the roster NAMES — even only ambiguously — is matched by its OWN id alone and borrows no
 * ancestry; only a caller the roster does not name (the ordinary Lead, the genuine fork) keeps C7-4.
 * @param record - the record the authority is claimed on.
 * @param caller - who is acting, with its session id, title and recorded ancestry.
 * @returns the shared identity (the row when unambiguous) and whether it holds Lead authority.
 */
function leadAuthorityOf(record: TeamRecord, caller: TeamActionCaller): { identity: MemberIdentity; lead: boolean } {
  /** The roster identity the plane's ONE narrowing grants this session. */
  const identity = memberIdentityOf(record, caller.sessionId, caller.title ?? "", caller.lineage)
  /** A roster-named caller borrows no ancestry; only a session the record cannot name keeps the lineage. */
  const spellings = identity.named ? [caller.sessionId] : [caller.sessionId, ...caller.lineage].filter((id) => id !== "")
  return { identity, lead: recordNamesLead(record, spellings) }
}

/**
 * The ENDED team this session's index binding still names — the default-target repeat's target (T8 M1).
 *
 * An ended record is filtered out of every LIVE resolution arm, so a second
 * `agent_teams_control {action:"end"}` with no `team_id` would otherwise answer "no team record in this
 * workspace" — misleading (the team WAS ended) and not the reported no-op the contract promises. The
 * index entry is read DIRECTLY here, and only an already-ended record is returned; the Lead check then
 * runs on it exactly as it does for a live target, so this path can report a no-op but never end or
 * reveal a team the caller does not lead.
 * @param caller - who is acting.
 * @returns the ended record bound to the caller (own id first, then recorded ancestry), or undefined.
 */
function boundEndedTeamOf(caller: TeamActionCaller): TeamRecord | undefined {
  /** Every session spelling the index may have bound this caller under, own id first. */
  const spellings = [caller.sessionId, ...caller.lineage].filter((id) => id !== "")
  for (const spelling of spellings) {
    /** The team the index still names for this spelling. */
    const teamId = activeTeamId(caller.workspace, spelling)
    if (teamId === undefined) continue
    /** The record read directly: an ended team never resolves through the live arms. */
    const record = readTeam(caller.workspace, teamId)
    if (record !== undefined && record.endedAt !== undefined) return record
  }
  return undefined
}

/**
 * End one team: the terminal transition that closes a whole wave.
 *
 * WHY IT IS A VERB OF ITS OWN. Before it existed no supported call could close a live team: the plan
 * `delete` action archives a STAGED plan, `halt` writes a workspace-wide hold (a pause, explicitly not
 * an ending), the reaper only touches records that are already non-live, and the store's `deleteTeam`
 * has no caller — so the only real close was a hand edit of `phase` + `endedAt`. This body performs
 * that edit through the store ({@link endTeamRecord}), which is what makes the record, the change feed
 * and every resolver agree afterwards.
 *
 * ONLY THE LEAD MAY END, and it ends ONE team. A declared `team_id` is read directly so an explicit
 * repair target works from any session; the Lead check is then what refuses a stranger, and the
 * sentence distinguishes "not on the roster" from "a member, not the Lead". The Lead check itself is
 * {@link leadAuthorityOf}'s F-B narrowing: a session the RECORD NAMES — by its own id, by a recorded
 * ancestor, or by the persona title matching a seat's ROLE, then its stored name — cannot borrow captaincy. A
 * session the record cannot name at all is still read as a Lead fork (the plane's stated bound).
 *
 * AN ALREADY-ENDED TEAM IS A REPORTED NO-OP (`changed: false`) that returns the FIRST ending's instant
 * and reason — for a declared id AND for the default target, where {@link boundEndedTeamOf} recovers
 * the ended team the session's index still names. A retry is therefore safe, and the audit trail is
 * never restamped.
 *
 * IT DOES NOT LIFT A WORKSPACE HALT. The hold `halt` writes is WORKSPACE-WIDE, not team-scoped: it
 * pauses every team of the workspace, so clearing it from one team's ending would silently resume a
 * sibling's dispatch. `resume` stays the only verb that lifts it, and a halt placed before an end
 * therefore survives the end (pinned by `test/team-end.test.ts`, "N2").
 * @param deps - the row seams this action needs; see {@link TeamActionDeps}.
 * @param caller - who is acting, in which workspace and with which recorded ancestry.
 * @param input - the team to end (absent: the caller's own) and why.
 * @returns what the ending stamped, or one refusal sentence.
 */
export async function endTeam(deps: TeamActionDeps, caller: TeamActionCaller, input: TeamEndInput): Promise<TeamActionResult<TeamEndPayload>> {
  try {
    /** The team the call names, trimmed; empty means "the team this session works on". */
    const declared = String(input.teamId ?? "").trim()
    /** The caller's own resolution, read only when the call names no team. */
    const resolved = declared === "" ? deps.resolveTeam(caller.workspace, caller.sessionId, caller.lineage) : undefined
    /** The record to end: a declared id read directly, otherwise the session's own live team. */
    const live = declared === "" ? resolved?.record : readTeam(caller.workspace, declared)
    // THE DEFAULT-TARGET REPEAT: an ended record never resolves through the live arms, so the bound
    // index entry is the only remaining way to find it — and only a caller who LEADS it gets a no-op.
    /** The ended team this session is still bound to, used only when the live resolution found none. */
    const endedRepeat = declared === "" && live === undefined ? boundEndedTeamOf(caller) : undefined
    /** The ending target, or the already-ended team a repeated default call reports. */
    const record = live ?? endedRepeat
    if (record === undefined) {
      return {
        ok: false,
        error: declared === ""
          ? (resolved?.refusal ?? "no team record in this workspace — approve a plan first")
          : `no team record is named ${JSON.stringify(declared)} in this workspace`,
      }
    }
    /** The caller's Lead authority on THIS record, narrowed by the F-B rule. */
    const authority = leadAuthorityOf(record, caller)
    if (!authority.lead) {
      /** The identified roster row, when the plane could pick exactly one. */
      const member = authority.identity.member
      return {
        ok: false,
        error: `only the Lead of team ${record.teamId} may end it (${member !== undefined
          ? `${member.name} is a member, not the Lead`
          : authority.identity.named ? "this session is on the team's roster, not its Lead" : "this session is not on the team's roster"})`,
      }
    }
    /** The ONE clock reading this call stamps: the record's `endedAt` and the journal row share it. */
    const now = deps.now()
    /** The store's idempotent stamp: the FIRST ending owns the instant and the reason. */
    const outcome = endTeamRecord(caller.workspace, record.teamId, String(input.reason ?? ""), now)
    // A record that vanished between the read above and the write is a real race, not a validation
    // failure — report it as the same "no such team" sentence rather than claiming an ending.
    if (outcome === undefined) return { ok: false, error: `no team record is named ${JSON.stringify(record.teamId)} in this workspace` }
    // ONE JOURNAL ROW PER ACTUAL ENDING (T8 N1): the terminal transition is history the same way a
    // fence or a handoff is, and the idempotent repeat is a no-op that must not append a second row.
    if (outcome.changed) {
      // THE ENDING ALREADY LANDED, so a JOURNAL failure must never fail it (CodeRabbit CR1): the record
      // is terminal on disk before this line runs, and a thrown refusal would report a failed end whose
      // retry answers `changed:false` — the missing `team-ended` row could then never be written. The
      // failure is reported on the row's diagnostic sink instead, and the reply still says what happened.
      try {
        appendTeamJournal(caller.workspace, { event: "team-ended", teamId: outcome.record.teamId, at: now.toISOString(), reason: String(outcome.record.archivedReason ?? "") })
      } catch (error) {
        deps.log(`team ${outcome.record.teamId} ended but its journal row was not written: ${refusalOf(error)}`)
      }
    }
    return {
      ok: true,
      teamId: outcome.record.teamId,
      endedAt: String(outcome.record.endedAt),
      reason: String(outcome.record.archivedReason ?? ""),
      changed: outcome.changed,
    }
  } catch (error) {
    return unexpectedRefusalOf(error)
  }
}

/**
 * Write the CALLING member's handoff document and move its seat into the handoff window.
 *
 * WHY THE CALLER MUST BE ON THE ROSTER. A handoff is the member's own checkpoint duty — the document it
 * leaves for the NEXT agent — so an operator writing one on somebody's behalf would fabricate continuity
 * that nobody witnessed. The session is matched through the record's own roster lookup
 * (`team-store.ts#memberNamedBy`, which reads the durable `executorRef` and the display name).
 *
 * THE ORDINAL NEVER COLLIDES: it starts at the previous ordinal + 1 and advances while the target file
 * exists, so a crash between the write and the record update cannot make the next handoff overwrite the
 * previous document.
 * @param deps - the row seams this action needs; see {@link TeamActionDeps}.
 * @param caller - who is acting; its own session id is what the roster is matched against.
 * @param input - the complete handoff document.
 * @returns where the document landed and the directive to relay, or one refusal sentence.
 */
export async function writeMemberHandoff(deps: TeamActionDeps, caller: TeamActionCaller, input: TeamHandoffInput): Promise<TeamActionResult<TeamHandoffPayload>> {
  try {
    /** The team this call works on, or the sentence saying why none resolved. */
    const resolved = deps.resolveTeam(caller.workspace, caller.sessionId, caller.lineage)
    if (resolved.record === undefined) return { ok: false, error: resolved.refusal ?? "no team record in this workspace — approve a plan first" }
    /** The roster row this session IS (the SHARED narrowing, so a resumed member still writes its own handoff); a seat-less caller writes none. */
    const member = memberIdentityOf(resolved.record, caller.sessionId, caller.title ?? "", caller.lineage).member
    if (member === undefined) return { ok: false, error: `session ${caller.sessionId} is on no roster of team ${resolved.record.teamId} — only a member writes its own handoff` }
    /** The section contract this document is judged against. */
    const validation = validateHandoffText(input.content)
    if (!validation.ok) return { ok: false, error: `the handoff is missing these sections: ${validation.missing.join(", ")} — write them into the document and call again` }
    /** The 1-based ordinal of THIS handoff, advanced past any document already on disk. */
    let ordinal = (member.handoff?.ordinal ?? 0) + 1
    while (existsSync(teamHandoffPath(caller.workspace, resolved.record.teamId, member.name, ordinal))) ordinal += 1
    /** The absolute path the document was written to. */
    const path = writeHandoffDocument(caller.workspace, resolved.record.teamId, member.name, ordinal, input.content)
    // The seat enters the handoff window: `mode: checkpoint` is what the next dispatch pass reads as
    // "never message this member" without a second state field to keep in sync.
    writeTeam(caller.workspace, updateTeamMember(resolved.record, member.name, { handoff: { path, ordinal }, mode: "checkpoint" }))
    appendTeamJournal(caller.workspace, { event: "handoff-written", teamId: resolved.record.teamId, at: deps.now().toISOString(), member: member.name, path })
    return { ok: true, teamId: resolved.record.teamId, member: member.name, path, ordinal, mode: "checkpoint", directive: handoffWrittenDirective(path) }
  } catch (error) {
    return unexpectedRefusalOf(error)
  }
}

/**
 * The workspace's force-handoff directory: `<ws>/.mpd/handoff`.
 *
 * DELIBERATELY NOT `teamRoot()`'s `handoff/` subdirectory: that one holds a MEMBER's own seven-section
 * document (`<teamId>/<member>-<ordinal>.md`), while this one holds the SUPERVISOR's account of one
 * interrupted attempt. Two readers, two lifetimes, so two directories — and the path the contract
 * names is `<ws>/.mpd/handoff/<member>-<task>-<UTC instant>.md`.
 *
 * @param workspace - the workspace root.
 * @returns the absolute directory a force handoff lands in.
 */
function forceHandoffDir(workspace: string): string {
  return join(workspace, ".mpd", "handoff")
}

/**
 * Render ONE force handoff document.
 *
 * The sections are the contract's list (§D3.4a): task, attempt, member, started, elapsed, last tool
 * calls, current review state — plus the two lines a next owner actually needs: WHO stopped the member
 * and what to do next. Pure, so the shape is testable without a file.
 *
 * @param input - every field the document states, already resolved by the caller.
 * @returns the markdown document.
 */
function renderForceHandoff(input: {
  teamId: string
  taskId: string
  subject: string
  attempt: number
  attemptId: string
  member: string
  memberSession: string
  startedAt: number | null
  elapsedMs: number
  lastToolCalls: readonly string[]
  taskStatus: string
  round: number
  verdict: string
}): string {
  // The start instant as both a raw clock reading and an ISO instant, or `unknown` when the board had none.
  const startedIso = input.startedAt === null ? "unknown" : new Date(input.startedAt).toISOString()
  // The tool history, one bullet per name, or the honest "nothing recorded".
  const tools = input.lastToolCalls.length === 0 ? "- (none recorded)" : input.lastToolCalls.map((name) => "- `" + name + "`").join("\n")
  return [
    "# Force handoff — " + input.member + " / " + input.taskId,
    "",
    "## Task",
    "- Task: " + input.taskId + " — " + input.subject,
    "- Team: " + input.teamId,
    "- Attempt: " + input.attempt + " (generation " + (input.attemptId === "" ? "unrecorded" : input.attemptId) + ")",
    "",
    "## Member",
    "- Member: " + input.member,
    "- Session: " + (input.memberSession === "" ? "(no executor handle)" : input.memberSession),
    "",
    "## Timing",
    "- Started: " + startedIso + (input.startedAt === null ? "" : " (" + input.startedAt + ")"),
    "- Elapsed: " + input.elapsedMs + " ms",
    "",
    "## Last tool calls",
    tools,
    "",
    "## Review state",
    "- Board status at the interrupt: " + input.taskStatus,
    "- Review round: " + input.round,
    "- Verdict: " + (input.verdict === "" ? "(none recorded)" : input.verdict),
    "",
    "## Why this document exists",
    "The watchdog's force supervisor found this task `in_progress` past its force bound and interrupted",
    "the owning member. The row was requeued (`pending`, attempt bumped) and the work was split into",
    "continuation rows; this document is the account the next owner continues from.",
    "",
    "## Next step",
    "Read the task description and the rows named by the system message, narrow the scope if the",
    "subject carries no declared scope, then claim the row and continue from the last tool call above.",
    "",
  ].join("\n")
}

/**
 * Write ONE force handoff and answer its absolute path.
 *
 * A write failure must abort the force for this attempt (the contract's failure semantics), so this
 * helper THROWS and the caller turns that into a retryable refusal — never into a half-done interrupt.
 *
 * @param workspace - the workspace root the document lands in.
 * @param member - the member's board name.
 * @param taskId - the board row the member was stopped on.
 * @param at - the instant the force ran (part of the file name).
 * @param text - the rendered document.
 * @returns the absolute path written.
 */
function writeForceHandoff(workspace: string, member: string, taskId: string, at: Date, text: string): string {
  // The directory the document lands in, created on demand.
  const dir = forceHandoffDir(workspace)
  mkdirSync(dir, { recursive: true })
  // The UTC instant, sanitised for a file name (`:` and `.` are legal on Linux but not everywhere).
  const instant = at.toISOString().replace(/[:.]/g, "-")
  // The absolute path: `<member>-<task>-<UTC instant>.md`, each segment reduced by the store's own rule.
  const path = join(dir, sanitizeId(member) + "-" + sanitizeId(taskId) + "-" + instant + ".md")
  writeFileSync(path, text.endsWith("\n") ? text : text + "\n")
  return path
}

/**
 * FORCE one wedged seat (D3): handoff, interrupt, requeue and split — in that order.
 *
 * WHY IT LIVES ON THE TEAM PLANE. The watchdog decides (it reads the record and holds no caller
 * agent), but pausing a MEMBER needs the adapter's interrupt seam, the board is this row's, and the
 * captain is reached through this workspace's mailbox. `runDispatchBody` is the other body that acts
 * on a team with a live caller agent, so this sits beside it with the same caller contract.
 *
 * ONE RECORD IS WRITTEN ELSEWHERE, deliberately: the durable `wedged-force` INCIDENT belongs to the
 * watchdog's own incident log (it decides, it holds that store, and the two packages may not gain a
 * compile-time edge), so this action journals and the decider records. Nothing here writes the CELL
 * record: a cell seat is a team member by IDENTITY (§D0.4), so the same path serves it and the seat
 * repairs itself through `cellwork_dispatch`/`cellwork_split` afterwards.
 *
 * THE FAILURE SEMANTICS ARE THE CONTRACT'S (§D3.4), and each is deliberate:
 *   * a HANDOFF WRITE failure aborts the force for this attempt and is marked `retryable`, so the
 *     watchdog decides again on the next tick — nothing was interrupted, so the wedge is still there;
 *   * an INTERRUPT refusal is recorded and the action STILL requeues and splits, because a stale
 *     handle must not leave a wedged row `in_progress` forever;
 *   * a MAILBOX refusal is non-fatal: the journal row below is the durable notification.
 *
 * THE CAPTAIN IS NEVER A FORCE TARGET (rule 5): a row owned by the record's lead is refused here, and
 * the watchdog refuses it again before it ever asks.
 *
 * @param deps - the row seams this action needs; see {@link TeamActionDeps}.
 * @param caller - the authorising caller (the team's lead session, with a live agent).
 * @param input - the team, the row and the watchdog's evidence.
 * @returns the handoff path, the requeue, the split rows and the mailbox outcome.
 */
export async function forceWedgedTask(
  deps: TeamActionDeps,
  caller: TeamActionCaller,
  input: TeamForceInput,
): Promise<TeamActionResult<TeamForcePayload>> {
  // A force interrupts somebody and writes a document; both need the caller's authority.
  if (caller.agent === undefined) return { ok: false, error: "force needs a live agent" }
  try {
    // ── THE TEAM ────────────────────────────────────────────────────────────────────────────
    /** The team the row belongs to: the named id, else the caller's own resolved team. */
    const record = input.teamId === undefined ? deps.resolveTeam(caller.workspace, caller.sessionId, caller.lineage).record : readTeam(caller.workspace, input.teamId)
    if (record === undefined) return { ok: false, error: `no team record is named ${JSON.stringify(input.teamId ?? "")} in this workspace` }
    // ── THE ROW ─────────────────────────────────────────────────────────────────────────────
    /** The board row this force is about. */
    const task = record.tasks.find((candidate) => candidate.id === input.taskId)
    if (task === undefined) return { ok: false, error: `no board row is named ${JSON.stringify(input.taskId)} on team ${record.teamId}` }
    if (task.status !== "in_progress") return { ok: false, error: `task ${task.id} is "${task.status}" — only an in_progress row can be forced` }
    /** The owner as the board spells it (a name OR a session id), falling back to the watchdog's reading. */
    const owner = task.owner !== undefined && task.owner !== "" ? task.owner : input.evidence?.member ?? ""
    if (owner === "") return { ok: false, error: `task ${task.id} has no owner — there is no member to interrupt` }
    // THE CAPTAIN GUARD, twice: a lead-owned row is refused with a sentence that says why.
    if (recordNamesLead(record, [owner])) return { ok: false, error: `task ${task.id} is owned by the team's lead — the captain is never a force target` }
    /** The roster row this owner names (by name OR by executor handle). */
    const member = memberNamedBy(record, [owner])
    if (member === undefined) return { ok: false, error: `owner ${JSON.stringify(owner)} names no member on team ${record.teamId}` }
    if (recordNamesLead(record, [member.name, member.executorRef ?? ""])) {
      return { ok: false, error: `member ${member.name} is the team's lead — the captain is never a force target` }
    }
    /** The member's executor handle: the ONE session this force may interrupt. */
    const handle = member.executorRef ?? ""
    // The clock every write below is stamped with (the row's own clock, never a second reading).
    const now = deps.now()
    /** When the row entered `in_progress`, from the record first and the watchdog's evidence second. */
    const startedAtIso = task.startedAt
    /** That instant as epoch ms, or null when neither source names one. */
    const startedAt = typeof startedAtIso === "string" && Number.isFinite(Date.parse(startedAtIso))
      ? Date.parse(startedAtIso)
      : typeof input.evidence?.startedAt === "number"
        ? input.evidence.startedAt
        : null
    /** How long the row had been in progress: the watchdog's measurement, else this call's own clock. */
    const elapsedMs = typeof input.evidence?.elapsedMs === "number" && Number.isFinite(input.evidence.elapsedMs)
      ? input.evidence.elapsedMs
      : startedAt === null
        ? 0
        : Math.max(0, now.getTime() - startedAt)
    // ── (a) THE HANDOFF — its failure aborts this attempt and is retryable ────────────────
    /** The absolute handoff path, or the retryable refusal the write produced. */
    let handoff: string
    try {
      handoff = writeForceHandoff(
        caller.workspace,
        member.name,
        task.id,
        now,
        renderForceHandoff({
          teamId: record.teamId,
          taskId: task.id,
          subject: task.subject,
          attempt: (task.attempt ?? 0) + 1,
          attemptId: input.evidence?.attemptId ?? "",
          member: member.name,
          memberSession: handle,
          startedAt,
          elapsedMs,
          lastToolCalls: input.evidence?.lastToolCalls ?? [],
          taskStatus: task.status,
          round: task.round ?? 0,
          verdict: task.verdict ?? "",
        }),
      )
    } catch (error) {
      return { ok: false, error: `handoff write failed for task ${task.id}: ${refusalOf(error)}`, retryable: true }
    }
    // ── (b) THE INTERRUPT — a refusal is recorded, never fatal ────────────────────────────
    /** Whether the executor actually stopped the member's session. */
    let interrupted = false
    /** Why the interrupt did not land, when it did not. */
    let interruptError: string | undefined
    if (handle === "") {
      interruptError = `member ${member.name} has no executor handle — nothing to interrupt`
    } else {
      try {
        await deps.executor().interrupt(caller.agent, handle)
        interrupted = true
      } catch (error) {
        interruptError = refusalOf(error)
      }
    }
    // ── (c) THE REQUEUE — pending, owner cleared, attempt bumped, note naming the handoff ──
    /** The attempt counter the requeued row carries (monotonic, never reset). */
    const attempt = (task.attempt ?? 0) + 1
    /** The record with the row requeued. */
    let next: TeamRecord = updateTeamTask(
      record,
      task.id,
      { status: "pending", owner: "", attempt, note: `forced (wedged): handoff ${handoff}`, resetStartedAt: true },
      now,
    )
    // ── (d) THE SPLIT — one row per declared scope, or ONE continuation row ───────────────
    /** The `[split]` rows this force created, in creation order. */
    const split: string[] = []
    /** The scopes the original row declared (the rows a next owner must narrow). */
    const scopes = task.writeScopes
    /** The continuation description every split row carries, so the handoff is never lost. */
    const continuation = `Continuation of ${task.id} (${task.subject}) after the force supervisor interrupted ${member.name}. Handoff: ${handoff}.`
    if (scopes.length >= 2) {
      for (const scope of scopes) {
        // The scope-specific subject: the original title plus the ONE path this row may touch.
        const subject = `[split] ${task.subject} — ${scope}`
        next = addTeamTask(next, { subject, description: `${continuation} This row owns exactly one write scope: ${scope}.`, writeScopes: [scope], ...(task.coverageOf === undefined ? {} : { coverageOf: task.coverageOf }) }, now)
        split.push(next.tasks[next.tasks.length - 1]?.id ?? "")
      }
    } else {
      // No declared scope (or only one): ONE continuation row that must narrow the scope first.
      const subject = `[split] ${task.subject}`
      next = addTeamTask(next, { subject, description: `${continuation} The original row declared no split-able write scope, so NARROW THE SCOPE FIRST (name the files this row touches) before editing anything.`, writeScopes: [], ...(task.coverageOf === undefined ? {} : { coverageOf: task.coverageOf }) }, now)
      split.push(next.tasks[next.tasks.length - 1]?.id ?? "")
    }
    // ONE write for the requeue AND the split rows, so two ids can never race each other's snapshot.
    writeTeam(caller.workspace, next)
    // ── (e) THE CAPTAIN — ONE mailbox row, best effort ────────────────────────────────────
    /** The mailbox row's id, when the send landed. */
    let mail: string | undefined
    /** Why the mailbox row did not land, when it did not. */
    let mailError: string | undefined
    /** The lead session the row is addressed to. */
    const leadSession = record.leadSessionId
    if (leadSession === undefined || leadSession === "") {
      mailError = "the team record names no lead session to notify"
    } else {
      try {
        /** The message the captain reads: team, task, handoff and the split rows, in one line each. */
        const result = send(
          caller.workspace,
          {
            fromId: FORCE_SENDER_ID,
            fromName: FORCE_SENDER_NAME,
            toId: leadSession,
            toName: "captain",
            subject: `force: ${member.name} interrupted on ${task.id} (${record.teamId})`,
            body: [
              `team ${record.teamId} task ${task.id} (${task.subject}) was in_progress for ${elapsedMs} ms and the watchdog's force supervisor stopped member ${member.name}.`,
              `handoff: ${handoff}`,
              `requeued: ${task.id} as pending, attempt ${attempt}`,
              `split: ${split.length === 0 ? "(none)" : split.join(", ")}`,
              `interrupt: ${interrupted ? "applied" : "not applied — " + (interruptError ?? "unknown")}`,
            ].join("\n"),
            memberIds: record.members.map((entry) => entry.executorRef ?? "").filter((value) => value !== ""),
            teamId: record.teamId,
            leadIds: [leadSession],
          },
          now,
        )
        if (result.ok) mail = result.message.id
        else mailError = `mailbox refused the row (${result.reason}): ${result.detail}`
      } catch (error) {
        mailError = refusalOf(error)
      }
    }
    // ── (f) THE JOURNAL — the durable notification, written whatever the mailbox did ──────
    appendTeamJournal(caller.workspace, {
      event: "wedged-force",
      teamId: record.teamId,
      at: now.toISOString(),
      taskId: task.id,
      member: member.name,
      path: handoff,
      reason: `elapsed=${elapsedMs}ms interrupted=${interrupted}${interruptError === undefined ? "" : " (" + interruptError + ")"} split=${split.join(",") || "none"}`,
    })
    return {
      ok: true,
      teamId: record.teamId,
      taskId: task.id,
      member: member.name,
      handoff,
      interrupted,
      ...(interruptError === undefined ? {} : { interruptError }),
      requeued: { taskId: task.id, attempt },
      split,
      ...(mail === undefined ? {} : { mail }),
      ...(mailError === undefined ? {} : { mailError }),
    }
  } catch (error) {
    return unexpectedRefusalOf(error)
  }
}

/**
 * Cancel named board rows, so no later dispatch pass can pair them.
 *
 * WHY A TERMINAL STATUS AND NOT A FILTER LIST: the board row is the ONLY thing the dispatcher reads, so a
 * row that must never be woken has to say so ON THE ROW. The store already carries `cancelled` as a
 * terminal status, `readyTasks` excludes it (non-pending), and `blockingDependencies` already RELEASES a
 * dependent whose blocker was cancelled — so this transition needs no new state and changes no rule.
 * Reusing it (rather than inventing a second terminal spelling) is what keeps every existing reader — the
 * DAG, the prune, the projections — correct without an edit.
 *
 * A row that is ALREADY terminal is reported, never re-cancelled: a cancelled row and a completed row are
 * different facts, and overwriting one with the other would rewrite history.
 * @param deps - the row seams this action needs; see {@link TeamActionDeps}.
 * @param input - the team, the rows and the closing note.
 * @returns the ids cancelled and one reason per id that was not.
 */
export async function cancelTasks(deps: TeamActionDeps, input: TeamCancelInput): Promise<TeamActionResult<TeamCancelPayload>> {
  try {
    /** The team the rows belong to, as the record says. */
    const record = readTeam(input.workspace, input.teamId)
    if (record === undefined) return { ok: false, error: `no team record is named ${JSON.stringify(input.teamId)} in this workspace` }
    /** The ids this call cancelled. */
    const cancelled: string[] = []
    /** One entry per id this call refused. */
    const skipped: Array<{ taskId: string; reason: string }> = []
    // THE PATCHES ARE APPLIED TO ONE RUNNING RECORD and written ONCE: a per-row write would rewrite the
    // whole team document for every id, and two ids in one call would race each other's snapshot.
    /** The record as this call mutates it. */
    let next: TeamRecord = record
    for (const taskId of input.taskIds) {
      /** The row this id names on the record as it stands. */
      const row = next.tasks.find((task) => task.id === taskId)
      if (row === undefined) {
        skipped.push({ taskId, reason: `no board row is named ${JSON.stringify(taskId)}` })
        continue
      }
      if (row.status === "completed" || row.status === "failed" || row.status === "cancelled") {
        skipped.push({ taskId, reason: `row ${taskId} is already ${row.status} — a terminal row is never re-cancelled` })
        continue
      }
      next = updateTeamTask(next, taskId, { status: "cancelled", ...(input.note === undefined ? {} : { note: input.note }) }, deps.now())
      cancelled.push(taskId)
    }
    if (cancelled.length === 0) return { ok: true, teamId: record.teamId, cancelled, skipped }
    writeTeam(input.workspace, next)
    for (const taskId of cancelled) {
      appendTeamJournal(input.workspace, { event: "task-cancelled", teamId: record.teamId, at: deps.now().toISOString(), taskId, ...(input.note === undefined ? {} : { reason: input.note }) })
    }
    return { ok: true, teamId: record.teamId, cancelled, skipped }
  } catch (error) {
    return unexpectedRefusalOf(error)
  }
}
