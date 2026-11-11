// CELLWORK PROTOCOL — dispatch, supervision, context, handoff, checkpoint/compaction/promotion,
// sub-teams and cell mail (contract B8/B9).
//
// THE ONE MECHANICAL RULE of this module: a member that reaches the context checkpoint cannot keep
// working. The `agent/pre-step` listener injects ONE advisory message and flips the seat to `checkpoint`
// mode, whose guard denies every tool except `cellwork_handoff`, `cellwork_context` and
// `cellwork_status`; the handoff is then compacted into the member's OWN engine and the member is promoted
// to subcaptain, or reseeded from the handoff when compaction cannot run. Prose alone would be advice —
// the guard is what makes it a fence.
//
// EVERY HARNESS TOUCH IS THE ADAPTER'S: `onPreStep`, `onEvent("agent/turn-stopping")`,
// `contextPressure`, `compactionEngineForAgent`, `injectAgentMessage`, `interruptAgent`,
// `startContinuableAgent`, `userMessage`, `teamExecutor` and `executeTool`. The tools register through
// `registerTool`. The two MPD services (`mpdTeams`, `mpdConfig`) are read structurally.
import { appendJournal, cellIdAt, handoffPath, newCellState, writeCell, type CellMemberRecord, type CellState } from "./state"
import { callerContext, type CallerContext, type TeamsServiceView } from "./caller"
import type { CellworkConfig } from "./config"
// The dispatch engine moved to the TEAM PLANE (wave W2-D): this module no longer pairs, sends or
// reasons about a pairing, so it imports nothing from cellwork's own dispatch module.

import { validateHandoffText, writeHandoff } from "./handoff"
import { appendCellMail, foldCellMail, mailId, readCellMail, unreadFor, wakeFailures, type CellMailMessage } from "./mail"
import type { DshAdapter, DshContextPressure, DshLiveAgent, DshToolExec } from "../../mpd-dsh-adapter-plugin/src/index"
import { readFileSync } from "node:fs"

/** The host context the protocol tools read (the adapter owns every harness seam). */
export interface ProtocolCtx {
  /** The service lookup a row uses; `false` means "absent is not an error". */
  get?: (serviceName: string, strict?: boolean) => unknown
}

/** What {@link installCellworkProtocol} needs from the row. */
export interface ProtocolDeps {
  /** The resolved adapter (the ONE harness contact surface). */
  dsh: DshAdapter
  /** The host context, read only for the MPD team service. */
  ctx: ProtocolCtx
  /** The resolved knobs. */
  config: CellworkConfig
  /** The row's log sink. */
  warn: (line: string) => void
}

/** One protocol tool's answer: a structured success (any documented fields) or the refusal sentence. */
type ProtocolResult = Record<string, unknown> | { ok: false; error: string; path?: string }

/** The refusals every protocol tool answers with — never a throw, so the model can act on the sentence. */
interface ProtocolFailure {
  /** Always false. */
  ok: false
  /** ONE sentence naming what was refused and what to do instead. */
  error: string
}

/**
 * Read one tool's arguments as a record.
 *
 * @param args - the harness-validated arguments.
 * @returns the arguments, or an empty record.
 */
function readArgs(args: unknown): Record<string, unknown> {
  if (typeof args !== "object" || args === null || Array.isArray(args)) return {}
  return args as Record<string, unknown>
}

/**
 * Read one string field from untrusted arguments.
 *
 * @param args - the argument record.
 * @param key - the field name.
 * @returns the string, or "".
 */
function argString(args: Record<string, unknown>, key: string): string {
  return typeof args[key] === "string" ? args[key] as string : ""
}

/**
 * One harness content block holding text.
 *
 * @param value - the text.
 * @returns the content blocks array.
 */
function renderText(value: string): Array<{ type: "text"; text: string }> {
  return [{ type: "text", text: value }]
}

/** One checkpoint decision, computed BEFORE any state is touched. */
export interface CheckpointPlan {
  /** Whether a checkpoint message should be injected at this step. */
  inject: boolean
  /** The member the checkpoint applies to. */
  memberName: string
  /** The observed occupied tokens, or null when the meter reported none. */
  usedTokens: number | null
  /** The observed window, or null when the meter reported none. */
  windowTokens: number | null
  /** The observed ratio, or null. */
  ratio: number | null
  /** The step's turn ordinal, or null when the payload carried none. */
  turn: number | null
  /** Why the decision is what it is (read in the journal and in `cellwork_context`). */
  reason: string
}

/**
 * Decide whether one member's step crosses the checkpoint threshold.
 *
 * NEVER GUESSES: before the meter has observed a window, nothing is triggered. Re-injection is suppressed
 * once the seat is already in `checkpoint` mode (a handoff is pending) and for the SAME turn (a step that
 * was already warned stays warned). The captain and a promoted subcaptain are never checkpointed — they
 * dispatch, so stripping their tools would stop the cell instead of saving it.
 *
 * @param cell - the active cell record.
 * @param memberName - the calling member's name.
 * @param pressure - the adapter's context-pressure reading for that session.
 * @param config - the resolved knobs.
 * @param turn - the step's turn ordinal, or null.
 * @returns the plan; `inject` is false with a reason when nothing should happen.
 */
export function planCheckpoint(cell: CellState, memberName: string, pressure: DshContextPressure, config: CellworkConfig, turn: number | null): CheckpointPlan {
  /** The member's record, when the cell knows it. */
  const member = cell.members[memberName]
  /** The neutral plan returned by every "do nothing" branch. */
  const base: CheckpointPlan = { inject: false, memberName, usedTokens: pressure?.usedTokens ?? null, windowTokens: pressure?.windowTokens ?? null, ratio: pressure?.ratio ?? null, turn, reason: "" }
  if (member === undefined) return { ...base, reason: "the session is not a recorded cell member" }
  if (member.mode === "subcaptain") return { ...base, reason: "a promoted subcaptain dispatches and is never checkpointed (declared bound)" }
  if (member.handoffReady) return { ...base, reason: "a handoff is already written and waiting for compaction" }
  if (member.mode === "checkpoint") return { ...base, reason: "a checkpoint is already pending for this member" }
  if (pressure?.provenance !== "observed" || pressure.windowTokens === null || pressure.ratio === null) {
    return { ...base, reason: "no observed context window yet — never guess a checkpoint" }
  }
  if (pressure.ratio < config.checkpointRatio) return { ...base, reason: "below the checkpoint ratio" }
  if (turn !== null && cell.checkpoints.some((entry) => entry.sessionId === member.sessionId && entry.turn === turn)) {
    return { ...base, reason: "this turn already received its checkpoint message" }
  }
  return { ...base, inject: true, reason: "the observed ratio reached the checkpoint threshold" }
}

/**
 * Record one injected checkpoint — the LOG entry only.
 *
 * THE SEAT MODE IS NOT WRITTEN HERE (wave W2-E). A closed seat is the TEAM record's fact
 * (`mode:"checkpoint"`, written by `mpdTeamActions.fence`/`handoff`), and the cell row is its MIRROR: a
 * module that flipped the cell mode on its own would be a second authority for the seat, which is exactly
 * the divergence the migration removes. The plane writes first; the mirror follows through the caller that
 * owns the write (the pre-step listener), never from a pure state function.
 * @param state - the cell record.
 * @param plan - the decision that was taken.
 * @param sessionId - the member's session id.
 * @param now - the instant of the injection.
 * @returns the record with the checkpoint logged.
 */
export function applyCheckpoint(state: CellState, plan: CheckpointPlan, sessionId: string, now: Date): CellState {
  return {
    ...state,
    checkpoints: [...state.checkpoints, { sessionId, at: now.toISOString(), usedTokens: plan.usedTokens, contextWindow: plan.windowTokens, turn: plan.turn ?? 0 }],
  }
}

/**
 * The ONE checkpoint message a member receives at the threshold.
 *
 * @param memberName - the member's board name.
 * @param plan - the decision, for the numbers it quotes.
 * @returns the advisory text.
 */
export function checkpointDirective(memberName: string, plan: CheckpointPlan): string {
  return [
    "[mpd-cellwork] CONTEXT CHECKPOINT — " + memberName + " reached " + String(plan.ratio === null ? "?" : Math.round(plan.ratio * 100)) + "% of its observed context window"
      + (plan.usedTokens === null || plan.windowTokens === null ? "" : " (" + String(plan.usedTokens) + " of " + String(plan.windowTokens) + " tokens)") + ".",
    "",
    "STOP WORK NOW. Your tool scope is fenced to `cellwork_handoff`, `cellwork_context` and `cellwork_status`.",
    "Call `cellwork_handoff` with a document carrying these sections (headings or `Key:` lines):",
    "  Task · State · Decisions (and why) · Artifacts · Verified facts · Open questions · Next step",
    "Then END YOUR TURN and do nothing else. The plugin compacts your context and promotes you (or reseeds",
    "you from that handoff); anything you did not write down is lost.",
  ].join("\n")
}

/**
 * The promotion message a successfully compacted member receives.
 *
 * @param cellId - the cell.
 * @param memberName - the promoted member.
 * @param depth - the member's depth in the cell tree.
 * @param nextStep - the handoff's next step, quoted back.
 * @returns the directive text.
 */
export function promotionDirective(cellId: string, memberName: string, depth: number, nextStep: string): string {
  return [
    "[mpd-cellwork] PROMOTED — " + memberName + " of cell " + cellId + " is now a SUBCAPTAIN at depth " + String(depth) + ".",
    "",
    "Your context was compacted and your handoff is the continuity. The next step from that handoff:",
    "  " + (nextStep === "" ? "(the handoff named none — read the document)" : nextStep),
    "",
    "A subcaptain DISPATCHES: stage your sub-team with `agent_teams_plan` and register the sub-cell with",
    "`cellwork_subteam {objective}` (the plugin refuses a depth beyond the cell cap). You may consult",
    "read-only children with `cellwork_recon` (1..8 questions in one blocking call), start BACKGROUND",
    "consults with `cellwork_delegate` and settle them with `cellwork_consult`, and you keep",
    "`cellwork_dispatch`/`cellwork_status`.",
  ].join("\n")
}

/**
 * The message that ends a handoff: the agent must stop and let the barrier run.
 *
 * @param path - the absolute handoff document path.
 * @returns the directive text.
 */
export function handoffWrittenDirective(path: string): string {
  return "[mpd-cellwork] handoff written to " + path + ". END YOUR TURN NOW — do not call another tool; the plugin compacts and promotes you from that document."
}

/**
 * The directive a freshly registered sub-cell's captain receives.
 *
 * IT NAMES THE NESTING, because nothing on this plane asks the subcaptain for it: the team plane derives
 * the sub-team's parent from the parent team's own roster (the subcaptain is a MEMBER of it), so the
 * directive states WHICH team the box will land inside instead of demanding an argument. When the parent
 * cell never approved a team there is no parent team id, and the sub-team is a root team like any other.
 * @param subcellId - the new sub-cell id.
 * @param depth - its depth.
 * @param parentCellId - the cell that registered it.
 * @param parentTeamId - the parent cell's live team id, or `""` when it had none.
 * @returns the directive text.
 */
export function subteamDirective(subcellId: string, depth: number, parentCellId: string, parentTeamId: string): string {
  return [
    "[mpd-cellwork] SUB-CELL " + subcellId + " registered (depth " + String(depth) + ", parent " + parentCellId + ").",
    "",
    parentTeamId === ""
      ? "This cell has no team of its own yet, so your sub-team will be a ROOT team in the DAG."
      : "Your sub-team NESTS AS A BOX inside team " + parentTeamId + ": the team plane derives the parent from that team's own roster, which records you as a member — you never pass a parent id.",
    "You are its captain now: stage the sub-team with `agent_teams_plan` (members + tasks, approve), then",
    "`cellwork_activate` with the accepted split. The same guard applies to you as to any captain: dispatch",
    "only. Your surface here is `cellwork_dispatch`, `cellwork_supervise`, `cellwork_activate` and",
    "`cellwork_subteam`, plus the two background-delegation verbs `cellwork_delegate` and",
    "`cellwork_consult` — start up to 16 supervised consults in one call and settle them later. Starting",
    "and ending a cell belong to the PARENT captain, and the guard refuses those verbs for you. To leave",
    "this sub-cell, `cellwork_send` a stop request to the parent cell — the parent archives it and your",
    "record is kept.",
  ].join("\n")
}

/**
 * Classify one `compactNow` result.
 *
 * @param result - the engine's answer.
 * @returns `compacted` for a real result, `no-safe-range` for null/undefined (a documented FACT, not a failure).
 */
export function classifyCompactionResult(result: unknown): "compacted" | "no-safe-range" {
  return result === null || result === undefined ? "no-safe-range" : "compacted"
}

/**
 * Classify one `compactNow` rejection.
 *
 * THREE families, because the barrier's journal row is what an operator reads afterwards: a CANCELLATION
 * (the drive was aborted, by the caller or by the engine's own `AbortError`) must never reach the record
 * as an unexplained failure; a BUSY engine — the engine's `ManualCompactionError` code, or the word in the
 * message, which is the only signal a composed engine may offer — is a RETRYABLE refusal; anything else is
 * a real failure. The busy reading mirrors `mpd-team-compact-plugin`'s classifier, which is where the code
 * vocabulary is defined.
 *
 * @param error - the thrown value (any value may be thrown).
 * @param signal - the signal the drive ran under.
 * @returns `aborted`, `busy` or `failed`.
 */
export function classifyCompactionError(error: unknown, signal: AbortSignal): "aborted" | "busy" | "failed" {
  if (signal.aborted) return "aborted"
  /** The thrown value, read defensively: any value may be thrown. */
  const shaped = typeof error === "object" && error !== null ? error as { name?: unknown; code?: unknown; message?: unknown } : {}
  if (shaped.name === "AbortError" || shaped.code === "ABORT_ERR") return "aborted"
  if (shaped.code === "busy") return "busy"
  /** The message text, which is where a composed engine's busy refusal usually surfaces. */
  const text = typeof shaped.message === "string" ? shaped.message : String(error)
  return /\bbusy\b/i.test(text) ? "busy" : "failed"
}

/**
 * A REAL abort signal for one compaction drive: its own controller, combined with an optional parent.
 *
 * @param parent - the caller's cancellation, when there is one.
 * @returns the controller (so tests can inspect `aborted`) and the signal to pass to the engine.
 */
export function compactionSignal(parent?: AbortSignal): { controller: AbortController; signal: AbortSignal } {
  /** This drive's own controller. */
  const controller = new AbortController()
  return { controller, signal: parent === undefined ? controller.signal : AbortSignal.any([parent, controller.signal]) }
}

/** The engine shape the barrier drives: the host's `BasicCompactionEngine`, read structurally. */
interface CompactionEngine {
  /** Compact this agent's history now, answering the host's own result object (or null for no range). */
  compactNow?: (agent: unknown, signal: AbortSignal) => Promise<unknown>
}

/** What {@link promoteAfterHandoff} needs: the seams, the member and the handoff text. */
export interface PromotionDeps {
  /** The adapter slices the barrier uses. */
  dsh: Pick<DshAdapter, "compactionEngineForAgent" | "compactionEngineForLiveAgent" | "liveAgentExact" | "startContinuableAgent" | "interruptAgent">
  /** The member's live agent handle. */
  agent: unknown
  /** The member's board name. */
  memberName: string
  /** The member's recorded session id (the registry fallback the engine is resolved by). */
  sessionId: string
  /**
   * The member's durable parent session id, read from the stopping agent's session header.
   *
   * Absent (or not live) means the barrier falls back to the CAPTAIN, and a missing captain too means
   * `reseed-parent-unavailable` — the reseed never uses the dead member as its parent (C2).
   */
  parentSessionId?: string
  /** The cell and its team. */
  cell: CellState
  /** The resolved knobs (`compactionRetries`, `idleBarrierDelayMs`, `depthMax`). */
  config: CellworkConfig
  /** The handoff text a reseed child is seeded with. */
  handoffText: string
  /** The handoff's next step, quoted in the promotion directive. */
  nextStep: string
  /** Inject the promotion directive into the SAME agent (the inbox seam). */
  injectDirective: (text: string) => void
  /**
   * Bind the fresh child to its seat on EVERY surface that names the old handle (R1).
   *
   * Supplied by the row, which owns the workspace, the board read and the plane write. Omitted only by a
   * composition/test that models NO team plane at all: the reseed then reports `bindPlane:"absent"`,
   * because a surface that does not exist is not a surface that refused.
   */
  bindSeat?: (input: { handle: string; previousSessionId: string }) => Promise<SeatBindResult>
  /**
   * Deliver the promotion directive to the FRESH child's handle (R2).
   *
   * The child is addressable by handle only (it has no live Agent in this process yet), so this goes
   * through the team executor's own delivery seam. Omitted when the composition exposes no executor: the
   * reseed then records `directiveDelivered:false` with the reason instead of pretending it landed.
   */
  deliverDirective?: (authority: unknown, handle: string, text: string) => Promise<void>
  /** The barrier's retry wait; injected so tests do not sleep. */
  sleep: (ms: number) => Promise<void>
  /** The event's cancellation, when it carried one. */
  signal?: AbortSignal
}

/**
 * What one seat BIND did (R1): the three surfaces either all name the fresh handle, or the reseed is
 * refused with the surface that failed.
 *
 * `plane:"absent"` is a vacuous success, never a refusal: a cell whose workspace holds NO team record has
 * no team row and no board to bind, and failing the reseed for a surface nothing created would strand a
 * healthy child. A record that EXISTS but cannot be read is the opposite case and is a REFUSAL
 * (`surface:"team-record-unreadable"`), never this vacuous success: an unreadable surface is not an
 * absent one, and reporting `reseeded` over it is the defect F1 repairs.
 */
export interface SeatBindResult {
  /** Whether every surface that EXISTS for this seat now names the fresh handle. */
  ok: boolean
  /** The surface that could not be written, when `ok` is false (`team-record`, `team-member`, …). */
  surface?: string
  /** The sentence behind that failure. */
  reason?: string
  /** How many board rows were re-pointed from the old handle. */
  tasks?: number
  /** Which plane answered: `bound` when a record was written, `absent` when this cell has none. */
  plane?: "bound" | "absent"
  /**
   * What the ROLLBACK did after the read-back refused a write that had already landed (CodeRabbit Major-7).
   *
   * `restored` the pre-bind TEAM row (handle AND mode) and board owners were put back;
   * `refused`  another writer committed after this bind, so the rollback left that document untouched;
   * `failed`   the rollback itself could not be written (the sentence in `rollbackReason` says why).
   *
   * Absent when the bind never wrote, or when its read-back confirmed the write.
   */
  rollback?: "restored" | "refused" | "failed"
  /** The sentence behind a rollback that did not restore; the journal row carries it (Major-7). */
  rollbackReason?: string
  /**
   * The `executorRef` the SURVIVING document carries after a rollback was refused (contract §3 A11).
   *
   * A refused rollback means another writer committed after this bind, and its document is now the
   * authority. This value is that document's seat row, read from the same bytes the rollback compared —
   * so a caller can tell whether the surviving record still names the child this run started. `undefined`
   * means the bytes did not parse or carried no seat row: the child is then UNPROVEN, never released.
   */
  survivingExecutorRef?: string
  /**
   * Whether the surviving document PARSED as a JSON record after a refused rollback (R4).
   *
   * The refusal sentence must not call a record "unreadable" when it was read fine and simply carries no
   * string `executorRef`: the first is a broken surface, the second is a readable document that does not
   * name a child. This flag is what lets the caller tell the operator WHICH of the two happened; it is
   * absent unless a rollback was refused.
   */
  survivingReadable?: boolean
  /**
   * The non-empty `executorRef` this bind OVERWROTE because the seat already named a DIFFERENT handle (R3).
   *
   * The re-entry guard is inert when the identity registry cannot prove the TEAM row's handle live, so a
   * bind may legitimately replace a handle nobody proved dead. Without this field that displaced handle
   * would vanish from every record. It travels into the `seat-rebound`/`member-reseeded`/`compaction`
   * journal rows so an orphaned child stays traceable.
   */
  displacedExecutorRef?: string
  /**
   * Whether the identity registry could NOT prove the displaced handle live (R3).
   *
   * `true` is the `unprovenPreviousHandle` marker: the handle that was overwritten may still be a live
   * child, which is exactly the orphan an operator has to be able to find. `false` means the registry
   * answered for it at bind time.
   */
  displacedUnproven?: boolean
}

/**
 * WHAT the host did with the ORIGINAL session's retirement on the reseed path (R5.1).
 *
 * The host's `SubagentRuntime#interrupt` answers `void` and treats an ABSENT target as an accepted no-op,
 * so a silent return is never proof of a retirement: the target's presence is proven through the
 * adapter's identity seam first. `accepted` is the ONLY value that may be reported as `retired: true`.
 *
 *   `accepted`          the target was proven live and the host took the interrupt without refusing it;
 *   `nothing-to-retire` the identity registry answers NOTHING for the recorded session — nothing was
 *                       live to retire, and that is never a retirement;
 *   `refused`           the host threw (a stale authority, a non-descendant target, …); the sentence is
 *                       `retirementReason`;
 *   `unavailable`       this composition exposes no `interruptAgent` or no identity seam, so neither the
 *                       call nor its reading exists and nothing is claimed.
 */
export type RetirementOutcome = "accepted" | "nothing-to-retire" | "refused" | "unavailable"

/** The barrier's outcome. */
export interface PromotionResult {
  /** `promoted` after a successful compaction, `reseeded` after the fresh-child fallback, `refused` otherwise. */
  outcome: "promoted" | "reseeded" | "refused"
  /** How many bounded attempts the barrier made. */
  attempts: number
  /** The last classified reason/outcome, for the journal. */
  reason: string
  /** The fresh child's handle, when the reseed path ran. */
  newHandle?: string
  /** The live session the reseed child was raised under, when the reseed path ran (C2 lineage). */
  parentSessionId?: string
  /** Which rule found that session: the member's durable parent, or the captain fallback. */
  parentSource?: "parent" | "captain"
  /**
   * Whether the ORIGINAL session's interrupt was ACCEPTED on the reseed path (R4.7, corrected by R5.1).
   *
   * ABSENT-NOT-FALSE: the key exists only on a `reseeded` outcome, and `false` says no retirement was
   * confirmed. `true` requires {@link PromotionResult.retirement} to be `accepted`: a session the identity
   * registry does not hold is `nothing-to-retire` and is NEVER recorded as retired (the R4 inversion this
   * repairs). A reseed that was ATTEMPTED and then REFUSED reports the same fact through `retirement` alone
   * (R6.2), so its absence here says nothing about the original.
   */
  retired?: boolean
  /**
   * WHAT the host did with the retirement (R5.1); absent when no retirement was ATTEMPTED.
   *
   * Carried on a `reseeded` outcome AND on a `refused` one whose spawn failed after a retirement was
   * attempted (R6.2): an accepted retirement is never lost to a spawn that then throws or mints no child id.
   */
  retirement?: RetirementOutcome
  /**
   * The sentence behind a retirement that was NOT accepted (R5.1): the host's own refusal, or why nothing
   * could be retired or verified; absent when `retirement` is `accepted` or was never attempted.
   */
  retirementReason?: string
  /**
   * The surface that refused to bind the fresh child (R1), on a `refused` outcome.
   *
   * Present means a child WAS started and could not be given its seat: the row is journaled
   * `checkpoint-unrecoverable` with this surface named, the seat is fenced, and the answer carries the
   * retry. Absent on every other refusal, which never reached a spawn.
   */
  failedSurface?: string
  /** Whether the promotion directive reached the FRESH child's handle on the reseed path (R2). */
  directiveDelivered?: boolean
  /** Why that delivery failed, when it did; the reseed still reports what it did. */
  directiveError?: string
  /** How many board rows were re-pointed to the fresh handle (R1). */
  boundTasks?: number
  /** Whether the seat was bound on a plane record or the plane was absent (R1). */
  bindPlane?: "bound" | "absent"
  /**
   * What the bind's ROLLBACK did, when its read-back refused a write that had already landed (Major-7):
   * `restored` | `refused` | `failed`. Present only on that refusal shape, beside `failedSurface`.
   */
  bindRollback?: "restored" | "refused" | "failed"
  /** Why the rollback did not restore the pre-bind record, when it did not (Major-7). */
  bindRollbackReason?: string
  /**
   * The fresh child this run started and deliberately did NOT release, on a refusal whose rollback was
   * `refused` (contract §3 A11).
   *
   * The rollback could not prove the child unbindable: a concurrent writer's surviving document may still
   * name it, and releasing it would leave that document pointing at a released child — the exact stranded
   * seat this contract repairs. The handle travels here so the answer and the journal can hand the
   * operator a repair that RE-POINTS `executorRef` (`unfence` alone never touches the handle).
   */
  orphanChild?: string
  /**
   * Whether the refused rollback needs an explicit reconcile: the child is alive and the two records may
   * disagree about its handle. Present only beside {@link PromotionResult.orphanChild}.
   */
  reconcileRequired?: boolean
  /**
   * The handle this reseed's bind OVERWROTE on the TEAM row, when the seat already named a different one (R3).
   *
   * Present only when the bind displaced a non-empty handle; the journal rows (`seat-rebound`,
   * `member-reseeded`, `compaction`) carry it so an orphaned child is traceable from the record trail.
   */
  displacedExecutorRef?: string
  /** Whether the identity registry could not prove that displaced handle live (R3, `unprovenPreviousHandle`). */
  displacedUnproven?: boolean
}

/**
 * The live session one id names, read through the adapter's IDENTITY seam.
 *
 * `liveAgentExact` and NOT `liveAgent` (root cause 2 of the VEdit fences): the host refuses a spawn
 * unless `agents.get(parent.id) === parent`, so the parent this returns has to be the registry's OWN
 * instance. `liveAgent`'s list-scan fallback can hand back an object the host's `get` never returns,
 * and the spawn then throws `UNAUTHORIZED: subagent creation requires the exact live parent agent`.
 *
 * Total on purpose: the seam is absent in an older composition or a test double, and that absence means
 * "this composition cannot tell", which the caller treats exactly like a dead session.
 *
 * @param deps - the barrier's seams.
 * @param sessionId - the session to resolve; "" names nothing.
 * @returns the live Agent, or undefined.
 */
function liveSessionOf(deps: PromotionDeps, sessionId: string): DshLiveAgent | undefined {
  /** The adapter's own identity lookup, probed rather than assumed (older compositions lack it). */
  const seam = deps.dsh.liveAgentExact
  if (typeof seam !== "function" || sessionId === "") return undefined
  try {
    return seam.call(deps.dsh, sessionId) ?? undefined
  } catch {
    return undefined
  }
}

/**
 * Whether the live registry STILL holds this exact Agent instance — the host's own spawn precondition.
 *
 * `@deepseek-ai/dsh-subagent` refuses a spawn unless `ctx.get("agents").get(request.parent.id) ===
 * request.parent`. The barrier proves the same thing through the adapter's identity seam immediately
 * before it calls the host, so an instance the registry has since dropped is refused with OUR reason
 * instead of the host's UNAUTHORIZED. An absent seam, an absent handle and a different instance all
 * answer false: an unproven parent is never forwarded.
 *
 * @param deps - the barrier's seams.
 * @param parent - the Agent the reseed would forward as `request.parent`.
 * @returns true only when the registry answers THAT object for its id.
 */
function parentHeldExactly(deps: PromotionDeps, parent: DshLiveAgent): boolean {
  /** The adapter's identity seam; without it no identity can be proven. */
  const seam = deps.dsh.liveAgentExact
  if (typeof seam !== "function") return false
  if (parent === undefined || parent === null || typeof parent !== "object") return false
  try {
    return seam.call(deps.dsh, parent.id) === parent
  } catch {
    return false
  }
}

/**
 * The engine the barrier should drive, resolved WITHOUT a preceding sleep (C1).
 *
 * ORDER IS THE FIX: the LIVE HANDLE the event carried is asked first, because the id-keyed lookup misses
 * a member the registry has already detached — the measured `no-engine` fence. The registry seam stays as
 * the fallback for an older composition (or a resumable pass) that only offers an id.
 *
 * @param deps - the barrier's seams.
 * @returns the engine, or undefined when neither seam can name one.
 */
function engineForBarrier(deps: PromotionDeps): CompactionEngine | undefined {
  /** The live-handle seam, probed rather than assumed. */
  const liveHandle = deps.dsh.compactionEngineForLiveAgent
  if (typeof liveHandle === "function") {
    /** The engine of the Agent this event handed us. */
    const fromHandle = liveHandle.call(deps.dsh, deps.agent)
    if (fromHandle !== undefined && fromHandle !== null) return fromHandle as CompactionEngine
  }
  /** The registry lookup, which is the only route a composition without the handle seam offers. */
  const fromRegistry = deps.dsh.compactionEngineForAgent(deps.sessionId)
  return fromRegistry === undefined || fromRegistry === null ? undefined : fromRegistry as CompactionEngine
}

/** The live session a reseed is raised under, and which rule found it. */
interface ReseedParent {
  /** The live Agent the child is raised under. */
  parent: DshLiveAgent
  /** Which rule found it, journaled so the lineage is observable rather than inferred. */
  source: "parent" | "captain"
  /** That session's id. */
  sessionId: string
}

/**
 * The LIVE session a reseed child is raised under: the member's durable parent, else the captain (C2).
 *
 * Both candidates are resolved through `liveAgentExact` (the registry's OWN `get`), because the host
 * compares `agents.get(parent.id) === parent` and a list-scan handle fails that comparison. The dead
 * member is NEVER a candidate either: the host's `startActivation` refuses a parent it no longer holds
 * (`UNAUTHORIZED: subagent creation requires the exact live parent agent`), which is what turned every
 * checkpoint into a fence.
 *
 * @param deps - the barrier's seams.
 * @returns the live parent and its rule, or undefined when neither session is held by the registry.
 */
function reseedParentOf(deps: PromotionDeps): ReseedParent | undefined {
  /** The member's own durable parent session, when the header carried one. */
  const originalParent = deps.parentSessionId ?? ""
  /** The original parent, when that session is still live. */
  const parent = liveSessionOf(deps, originalParent)
  if (parent !== undefined) return { parent, source: "parent", sessionId: originalParent }
  /** The captain's session, the documented last resort. */
  const captainSession = deps.cell.captainSessionId ?? ""
  /** The captain, when that session is still live. */
  const captain = liveSessionOf(deps, captainSession)
  if (captain !== undefined) return { parent: captain, source: "captain", sessionId: captainSession }
  return undefined
}

/**
 * The agent-nesting cap a RESEED child must be forwarded, derived from its LIVE parent.
 *
 * THE RESEED LANDS AT THE LIVE PARENT'S DEPTH + 1, so that — never the cell-tree knob — is the cap.
 * Forwarding `cellwork.depthMax` here repeated the R1.1 defect on the one path R1.1 did not touch: the
 * cell cap counts nested CELLS, so it named a level the child does not occupy. The host's hidden default
 * is not a substitute either, which is why an EXPLICIT cap is always written.
 *
 * THE READING IS DELIBERATELY IDENTICAL to `spawnMaxDepthOf` in `mpd-roles-plugin` (and its workmate
 * twin), so a reseed and a consult place a child under the same rule: a recorded depth of 1 or more
 * answers depth + 1; a session recorded as `origin: "subagent"` without a depth reads as depth 1 (a
 * child, not a top-level session); anything else is depth 0, whose child lands at depth 1.
 *
 * @param parent - the live Agent the reseed is raised under, whose session header carries the depth.
 * @returns the cap to forward, a positive integer.
 */
export function reseedMaxDepthOf(parent: DshLiveAgent): number {
  // The header is read STRUCTURALLY because the adapter types a live Agent's `session` as opaque: the
  // harness fuses the session record into the agent, and only the header fields below are consulted.
  /** That session, read as a record. */
  const session = (parent as { session?: unknown }).session
  if (typeof session !== "object" || session === null) return 1
  /** The session header, which carries the delegation facts. */
  const header = (session as { header?: unknown }).header
  if (typeof header !== "object" || header === null) return 1
  /** The header as a record, so every access below is checked. */
  const record = header as Record<string, unknown>
  /** The recorded depth; a non-numeric or negative value is not a depth and reads as `0` below. */
  const raw = Number(record.delegationDepth)
  if (Number.isFinite(raw) && raw >= 1) return Math.floor(raw) + 1
  return record.origin === "subagent" ? 2 : 1
}

/**
 * The journal row ONE barrier outcome writes (`agent/turn-stopping` → `runBarrier`).
 *
 * Extracted so the row is the same wherever it is written and so a test can assert the CLASSIFICATIONS the
 * record carries (`reason`: `compacted`, `no-safe-range`, `busy`, `aborted`, `failed`, `no-engine`).
 *
 * @param memberName - the member the barrier ran for.
 * @param result - the barrier's outcome.
 * @returns the journal entry (the caller appends the instant and the cell id).
 */
export function compactionJournalEntry(memberName: string, result: PromotionResult): Record<string, unknown> {
  return {
    event: "compaction",
    member: memberName,
    outcome: result.outcome,
    attempts: result.attempts,
    reason: result.reason,
    ...(result.newHandle === undefined ? {} : { newHandle: result.newHandle }),
    ...(result.parentSource === undefined ? {} : { parentSource: result.parentSource, parentSessionId: result.parentSessionId }),
    // THE HANDLE THIS RESEED DISPLACED IS A FACT OF ITS OWN (R3): the re-entry guard never fired because
    // nothing proved that handle dead, so the row names what the bind overwrote and whether it was proven.
    ...(result.displacedExecutorRef === undefined ? {} : { displacedExecutorRef: result.displacedExecutorRef, displacedUnproven: result.displacedUnproven === true }),
  }
}

/**
 * The identity seam the three-state liveness rule reads — a structural slice of the adapter.
 *
 * Declared here rather than imported so the rule can be unit-tested against a literal and so the SAME
 * implementation serves `cellwork_status` and `cellwork_supervise` (R3: one reading, two surfaces).
 */
export interface LivenessSeam {
  /** The exact-agent lookup the adapter forwards (`agents.get`), when the composition exposes it. */
  liveAgentExact?: (sessionId: string) => unknown
  /** The adapter's capability snapshot, consulted only to REFUSE a `dead` answer. */
  capabilities?: () => { agents?: boolean } | undefined
}

/** What the identity registry proves about one recorded session (R3). */
export type SeatLiveness = "live" | "dead" | "unknown"

/**
 * The liveness of one recorded session, through the adapter's identity seam.
 *
 * THE CAPABILITY FLAG NEVER LICENSES `dead` (R7.3). `capabilities().agents` only says a registry SERVICE
 * is present; it says nothing about whether a lookup can succeed. `dead` is therefore proved by an
 * ANCHOR: the registry must first resolve an identity known to be alive — the captain's own session —
 * and only then does an absent target count. Everything else is `unknown`, which licenses nothing and is
 * reported as unverified rather than as health (R3).
 *
 * @param seam - the identity seam (an absent one answers `unknown`).
 * @param sessionId - the session the seat records; "" names no session, so it is `unknown` up front.
 * @param anchorSessionId - the captain's session id, the identity the registry must resolve first.
 * @returns `live` when the registry answers for the recorded session, `dead` when the anchor resolved and
 *   a NON-EMPTY target did not, and `unknown` when nothing can be proven.
 */
export function seatLivenessOf(seam: LivenessSeam, sessionId: string, anchorSessionId: string): SeatLiveness {
  // AN EMPTY RECORDED SESSION IS UNPROVABLE, NOT DEAD (R9.1): "" names no session, so neither the anchor
  // nor the registry's silence may turn it into a proven-dead child.
  if (sessionId === "") return "unknown"
  if (typeof seam.liveAgentExact !== "function") return "unknown"
  try {
    if (seam.liveAgentExact(sessionId) !== undefined) return "live"
    /** The adapter's capability snapshot, when this composition offers one. */
    const capabilities = typeof seam.capabilities === "function" ? seam.capabilities() : undefined
    if (capabilities?.agents !== true) return "unknown"
    // THE ANCHOR IS THE PROOF THE LOOKUP IS TRUSTWORTHY: only a registry that resolves a session known to
    // be alive can be believed when it answers nothing for the target.
    if (anchorSessionId === "" || seam.liveAgentExact(anchorSessionId) === undefined) return "unknown"
    return "dead"
  } catch {
    return "unknown"
  }
}

/** The seat as the PLANE's record reads it, reduced to what a closure decision needs (R5.2). */
export interface PlaneSeatView {
  /** The plane's mode for the seat, when it states one. */
  mode?: string
  /** Whether the plane reports the seat CLOSED by its `checkpoint` spelling. */
  checkpoint?: boolean
  /** Whether the plane's row carries its EXPLICIT give-up marker. */
  fenced?: boolean
  /** Why the plane closed it, in the plane's own vocabulary. */
  fenceReason?: string
}

/**
 * Read one seat out of a team record, structurally (the plane's record is read, never imported).
 *
 * @param record - the team record, or undefined when this cell has no readable board.
 * @param name - the member's board name (or its row id).
 * @returns the seat view; `{}` when the record names no such row (the plane cannot answer).
 */
export function planeSeatOf(record: unknown, name: string): PlaneSeatView {
  if (typeof record !== "object" || record === null) return {}
  /** The roster rows this build can read. */
  const rows = Array.isArray((record as { members?: unknown }).members) ? ((record as { members: unknown[] }).members).filter((row) => typeof row === "object" && row !== null) as Array<Record<string, unknown>> : []
  /** The row this name names. */
  const row = rows.find((candidate) => candidate.name === name || candidate.id === name)
  if (row === undefined) return {}
  /** The plane's mode for the seat, when it states one. */
  const mode = typeof row.mode === "string" && row.mode !== "" ? row.mode : undefined
  /** Whether the plane's row carries its EXPLICIT give-up marker (never the `checkpoint` derivation). */
  const fenced = row.fenced === true
  /** Whether the plane reports the seat CLOSED, by either of its two spellings. */
  const closed = row.mode === "checkpoint" || fenced
  if (!closed) return mode === undefined ? {} : { mode }
  /** Why the plane closed it, in the plane's own vocabulary. */
  const reason = fenced
    ? "the plane fenced this seat" + (typeof row.fencedReason === "string" && row.fencedReason !== "" ? " (" + row.fencedReason + ")" : "")
    : "the plane recorded a checkpoint for this seat (mode `checkpoint`), so it is fenced until the barrier reopens it"
  return { mode: "checkpoint", checkpoint: true, fenced, fenceReason: reason }
}

/**
 * The instant one seat entered the checkpoint window, or undefined when nothing recorded it.
 *
 * The member row is the primary source (R4.3 writes it at the ONE ownerless close); a row written by an
 * older build falls back to the LAST `cell.checkpoints` entry for the SAME session, which is the
 * documented fallback and never a substitute for a missing fact.
 *
 * @param cell - the cell that holds both records.
 * @param member - the member row being measured.
 * @returns the ISO instant, or undefined when neither source names one.
 */
export function checkpointSinceOf(cell: CellState, member: CellMemberRecord): string | undefined {
  if (member.checkpointSince !== undefined) return member.checkpointSince
  for (let index = cell.checkpoints.length - 1; index >= 0; index -= 1) {
    /** The checkpoint entry at this position. */
    const entry = cell.checkpoints[index]
    if (entry.sessionId !== "" && entry.sessionId === member.sessionId) return entry.at
  }
  return undefined
}

/**
 * How long one seat has been in the checkpoint window, in milliseconds.
 *
 * @param since - the ISO instant the window opened, when one is recorded.
 * @param now - the instant the answer is measured at.
 * @returns the age, or undefined when no usable instant exists (an unparsable stamp is not a licence).
 */
export function pendingMsOf(since: string | undefined, now: Date): number | undefined {
  if (since === undefined || since === "") return undefined
  /** The parsed instant; an unparsable value is refused rather than read as zero. */
  const opened = Date.parse(since)
  return Number.isFinite(opened) ? Math.max(0, now.getTime() - opened) : undefined
}

/**
 * Which written bound authorises a FORCED clear of one barrier-owned seat, if any (R4.4).
 *
 * FAIL-CLOSED: a bare `force` is never a licence on its own, and a missing timestamp with zero recorded
 * failures reaches no bound at all.
 *
 * @param member - the member row the bound is measured on.
 * @param pendingMs - the measured window age, when one exists.
 * @param retryBound - the consecutive-run bound the seat's `barrierFailures` is measured against.
 * @param staleMs - how old the window must be before the staleness bound is reached.
 * @returns `retry-budget` when the budget is spent, `stale` when the window outlived the clock, and
 *   undefined when neither bound is reached.
 */
export function forceBoundOf(member: CellMemberRecord, pendingMs: number | undefined, retryBound: number, staleMs: number): "retry-budget" | "stale" | undefined {
  if ((member.barrierFailures ?? 0) >= retryBound) return "retry-budget"
  if (pendingMs !== undefined && pendingMs >= staleMs) return "stale"
  return undefined
}

/**
 * The WRITTEN licence a forced clear stands on (R4.4, extended by R5.2).
 *
 *   `retry-budget` the barrier already spent `compactionRetries` consecutive runs on the seat;
 *   `stale`        the checkpoint window outlived `checkpointPendingMaxMs`;
 *   `dead-session` the DEAD-RESEED licence: the recorded session is proven dead, so neither clock bound
 *                  can ever be reached by a seat no live agent can drive a turn in.
 */
export type SeatForceBound = "retry-budget" | "stale" | "dead-session"

/** The ONE reading of "is this seat held, and would the FORCED lever clear it" (R5.2). */
export interface SeatForceReading {
  /** Whether a checkpoint SPELLING on either record is what holds the seat. */
  barrierOwned: boolean
  /** The R4.2 OBSERVABILITY flag: a stamped window whose recorded session the registry proves dead. */
  suspect: boolean
  /** Whether the seat is the DEAD-RESEED closure shape (`suspect` without any checkpoint spelling). */
  deadReseed: boolean
  /** Whether the seat is held at all (`barrierOwned || deadReseed`). */
  closed: boolean
  /**
   * Whether NOTHING can prove this seat dead OR working (R3): a `subcaptain` that left the barrier's
   * window whose recorded session the identity seam cannot classify. It is reported as UNVERIFIED — never
   * as health and never silently dropped.
   */
  unverified: boolean
  /** The measured age of the window, when a stamp exists. */
  pendingMs?: number
  /** What the identity seam says about the session the row records. */
  liveness: SeatLiveness
  /** The written licence a FORCED clear stands on, when one is reached. */
  bound?: SeatForceBound
  /** Whether `unfence:[{member, force:true}]` would clear this seat RIGHT NOW. */
  forceEligible: boolean
  /** Why the lever is refused, when it is (a refusal is REPORTED, never an absent field). */
  refusal?: string
}

/**
 * Decide whether one seat is held and whether the FORCED lever may clear it — ONE implementation for
 * `cellwork_dispatch {unfence}`, `cellwork_supervise` and `cellwork_status` (R3/R5.2).
 *
 * TWO CLOSURE SHAPES, both held:
 *
 *   `barrierOwned` — a checkpoint SPELLING (CELL `mode:"checkpoint"` / `handoffReady:true`, or the
 *                    plane's `mode:"checkpoint"`). The barrier owes it a reopen, and the forced lever
 *                    stands on a WRITTEN bound: the retry budget or the staleness clock. Fail-closed:
 *                    a fresh window and a missing timestamp reach neither.
 *   `deadReseed`   — the DEAD-RESEED shape (R5.1/R4.2): the barrier replaced the session with a child
 *                    the registry PROVES dead while the row is still `subcaptain` and not handoff-ready.
 *                    No live agent is left to drive another turn, so the PROVEN-DEAD session is the
 *                    licence (`bound:"dead-session"`) — but only when the window carries a STAMP.
 *
 * AN `unknown` LIVENESS NEVER HIDES A SEAT (R3): an unverified `subcaptain` row (the dead-reseed shape
 * nobody can prove, or a healthy one nobody can verify) is reported with `closed:false`,
 * `forceEligible:false` and the explicit `refusal:"liveness-unknown"`, so the operator sees an
 * UNVERIFIED seat rather than health. An absent field would read as healthy, which is the incident.
 *
 * @param input - the member row, the plane's seat view, the recorded window stamp and the knobs.
 * @returns the reading; every field is always present except the measured/bound ones.
 */
export function seatForceReadingOf(input: {
  /** The member row the reading is about; undefined when the cell record has no such row. */
  member: CellMemberRecord | undefined
  /** The plane's own view of the seat. */
  seat: PlaneSeatView
  /** The recorded window instant, when either source carries one. */
  checkpointSince?: string
  /** What the identity seam proved about the recorded session. */
  liveness: SeatLiveness
  /** The instant the reading is measured at. */
  now: Date
  /** The barrier's `compactionRetries` bound. */
  retryBound: number
  /** The `checkpointPendingMaxMs` staleness bound. */
  staleMs: number
}): SeatForceReading {
  /** The member row, for the shorthand below. */
  const member = input.member
  /** The barrier's WINDOW, whichever record still carries it. */
  const barrierOwned = member?.mode === "checkpoint" || member?.handoffReady === true || input.seat.checkpoint === true
  /** The window's age, when it can be measured; a missing or unparsable stamp measures nothing. */
  const pendingMs = pendingMsOf(input.checkpointSince, input.now)
  // TWO DIFFERENT FACTS, ONE CLOCK (R5.2). `suspect` is the OBSERVABILITY flag R4.2 introduced: a seat
  // whose recorded session the registry proves dead, whatever else the row says. `deadReseed` is the
  // CLOSURE shape: the same proven-dead session on a row that LEFT the barrier's window (a reseed), so
  // no agent is left to drive the turn a barrier would fire on.
  /** Whether the recorded session is proven dead while a window stamp exists (R4.2's flag). */
  const suspect = input.checkpointSince !== undefined && input.liveness === "dead"
  /** Whether this is the DEAD-RESEED closure shape rather than the barrier's own window. */
  const deadReseed = !barrierOwned && input.liveness === "dead" && member !== undefined && member.mode === "subcaptain" && member.handoffReady !== true
  /** Whether the seat is held at all. */
  const closed = barrierOwned || deadReseed
  /** An UNVERIFIED subcaptain-shaped seat: nothing proves it dead, and nothing proves it works (R3). */
  const unverified = !barrierOwned && input.liveness === "unknown" && member !== undefined && member.mode === "subcaptain" && member.handoffReady !== true
  /** The measured fields every answer shares. */
  const measured = { barrierOwned, suspect, deadReseed, closed, unverified, liveness: input.liveness, ...(pendingMs === undefined ? {} : { pendingMs }) }
  // AN OPEN SEAT IS `not-fenced`, NEVER A FORCE VERDICT: the forced lever is about a HELD seat, and a
  // `force-not-eligible` answer here would claim a window the record does not have. An UNVERIFIED one
  // says WHY it cannot be judged, instead of vanishing from the answer (R3).
  if (!closed) return { ...measured, forceEligible: false, ...(unverified ? { refusal: "liveness-unknown" } : {}) }
  // A LIVE SESSION VETOES EVERY FORCED CLEAR: the seat is not dead, whatever its age or failed runs say.
  if (input.liveness === "live") return { ...measured, forceEligible: false, refusal: "live-session" }
  /** The written licence, if any: the dead-reseed shape stands on its proven-dead session. */
  const bound = deadReseed
    ? (input.checkpointSince === undefined ? (member === undefined ? undefined : forceBoundOf(member, pendingMs, input.retryBound, input.staleMs)) : "dead-session" as const)
    : (member === undefined ? undefined : forceBoundOf(member, pendingMs, input.retryBound, input.staleMs))
  if (bound === undefined) return { ...measured, forceEligible: false, refusal: "force-not-eligible" }
  return { ...measured, bound, forceEligible: true }
}

/**
 * The row a barrier leaves when it can no longer trust the record (R4).
 *
 * A re-read that FAILS (or a throw after the seat was handed over) must not leave a seat that looks
 * healthy: the row is FENCED with the branch's own sentence, its window clock survives (or is stamped
 * now, so the staleness bound exists), and `barrierFailures` is raised to at least the retry bound — the
 * written licence the forced lever reads. Without that, the seat was invisible AND unclearable.
 *
 * @param previous - the member row as the barrier knew it.
 * @param retryBound - the consecutive-run bound the forced lever measures.
 * @param reason - the branch's own sentence (what failed, and where).
 * @param now - the instant the row is stamped with.
 * @returns the row to persist.
 */
export function barrierFailedRow(previous: CellMemberRecord, retryBound: number, reason: string, now: Date): CellMemberRecord {
  /** The failures this row records: at least the bound, so the force lever's licence is WRITTEN. */
  const failures = Math.max((previous.barrierFailures ?? 0) + 1, retryBound)
  return {
    name: previous.name,
    role: previous.role,
    sessionId: previous.sessionId,
    executorRef: previous.executorRef,
    mode: "checkpoint",
    handoffReady: true,
    handoffs: previous.handoffs,
    joinedAt: previous.joinedAt,
    ...(previous.adopted === true ? { adopted: true } : {}),
    ...(previous.grown === true ? { grown: true } : {}),
    checkpointSince: previous.checkpointSince ?? now.toISOString(),
    barrierFailures: failures,
    fenced: true,
    fencedReason: reason,
  }
}

/**
 * The repair verb a REFUSED-ROLLBACK seat hands the operator (contract §3 A11).
 *
 * `unfence` reopens the seat but never touches `executorRef`, so a seat whose TEAM row and CELL row
 * disagree about the child can be reopened while still pointing at the wrong handle. `rebind` is the
 * verb that RE-POINTS it (it writes the TEAM row and mirrors the handle into the CELL row); `unfence`
 * clears the give-up fence. Both travel in ONE call so the operator gets one executable sentence.
 *
 * @param memberName - the seat's board name, spelled the way the records spell it.
 * @param handle - the handle the surviving record names; the verb reports whether the identity registry
 *   proves it live rather than calling it live.
 * @returns the exact repair sentence the journal and the refusal carry.
 */
function reconcileRepairOf(memberName: string, handle: string): string {
  return "cellwork_dispatch {rebind:[{member:" + JSON.stringify(memberName) + ", handle:" + JSON.stringify(handle) + "}], unfence:[" + JSON.stringify(memberName) + "]} re-points executorRef to the handle the surviving record names (its answer reports `liveness` live/unproven/unknown — the bind proves nothing by itself), mirrors it into the CELL row, hands over the NON-TERMINAL board rows the old handle owned (a `claimed`/`in_progress` row answers `tasksNeedingRelease` and must be freed first with agent_teams_task {action:\"release\"}), then clears the give-up fence — `unfence` alone never touches the handle"
}

/**
 * The journal row a GIVEN-UP compaction barrier writes (contract C7).
 *
 * Deliberately separate from {@link compactionJournalEntry}: that row reports one barrier OUTCOME, while
 * this one records the CONSEQUENCE — the member is now fenced, and the rows it owns must be reassigned.
 * D5 measured what its absence costs: a member fenced-but-owning wrote three handoffs in seven minutes
 * while ten tickets stayed owned by nobody who could claim them.
 *
 * A refusal that followed an ACCEPTED retirement carries `retirement`/`retirementReason` too (R6.2): this
 * is the only row a `refused` outcome writes, so it is where that fact must survive.
 *
 * @param memberName - the member the barrier gave up on.
 * @param result - the barrier's outcome (its attempts and classification are quoted).
 * @returns the journal row.
 */
export function checkpointUnrecoverableEntry(memberName: string, result: PromotionResult): Record<string, unknown> {
  return {
    event: "checkpoint-unrecoverable",
    member: memberName,
    attempts: result.attempts,
    reason: result.reason,
    // AN ACCEPTED RETIREMENT OUTLIVES THE FAILED SPAWN (R6.2): the reseed can throw or mint no child AFTER
    // the host accepted the original's retirement, and dropping the fact here would leave the record saying
    // the reseed failed while the original session WAS retired.
    ...(result.retirement === undefined ? {} : { retirement: result.retirement }),
    ...(result.retirementReason === undefined ? {} : { retirementReason: result.retirementReason }),
    // THE SURFACE THAT REFUSED IS NAMED (R1), and the retry is handed over: a reseed that spawned but
    // could not be BOUND is not a mystery the operator has to reconstruct from three records.
    ...(result.failedSurface === undefined ? {} : { surface: result.failedSurface, retry: 'cellwork_dispatch {unfence:[{member, force:true}]} reopens the seat, then agent_teams_dispatch {reassign:[{task_id, owner}]} hands the rows over' }),
    // A ROLLBACK IS A FACT, NOT A HOPE (CodeRabbit Major-7): a bind whose read-back refused it either put
    // the pre-bind TEAM row/owners back, refused to overwrite another writer, or could not write the
    // rollback at all. The row names which one — and why — so a half-bound seat is visible, not inferred.
    ...(result.bindRollback === undefined ? {} : { rollback: result.bindRollback }),
    ...(result.bindRollbackReason === undefined ? {} : { rollbackReason: result.bindRollbackReason }),
    // THE CHILD THE SURVIVING DOCUMENT MAY STILL NAME IS A FACT OF ITS OWN (contract §3 A11): the refused
    // rollback left the other writer's document in place, so the child this run started is deliberately
    // alive and the two records may disagree about its handle. The row carries the handle AND the repair
    // that re-points `executorRef`, overriding the generic retry above with the executable sentence.
    ...(result.orphanChild === undefined ? {} : { retry: reconcileRepairOf(memberName, result.orphanChild), orphanChild: result.orphanChild, ...(result.reconcileRequired === true ? { reconcileRequired: true } : {}) }),
    repair: result.orphanChild === undefined
      ? "reassign the rows this member owns: cellwork_dispatch {reassign:[{task_id, owner}]}"
      : reconcileRepairOf(memberName, result.orphanChild),
  }
}

/**
 * The member row a finished compaction barrier leaves behind (contract C7, bounded by R4.3).
 *
 * A GIVEN-UP barrier fences the member EXPLICITLY (`fenced` + `fencedReason`), so `cellwork_supervise` and
 * an operator can name the repair; a promoted or reseeded one carries NO fence marker at all. The row is
 * rebuilt field by field rather than spread, because a spread would carry a PREVIOUS `fenced: true`
 * through a later successful barrier and keep a healthy member out of dispatch — the exact livelock D5
 * cost, only in the other direction.
 *
 * THE ADDITIVE MARKERS ARE CARRIED EXPLICITLY, ON BOTH OUTCOMES: an adopted member's first handoff runs
 * exactly this barrier, so dropping `adopted` here would make the record stop saying the row appeared
 * after activation (contract B1); `checkpointSince`/`barrierFailures` are what the forced-unfence lever
 * reads, so a run that dropped them would silently reset a stuck seat's bound (the drop class a past R4
 * review recorded).
 *
 * WHAT COUNTS AS REOPENING (R4.3). Only `promoted` does: the SAME session was compacted and keeps
 * working, so both window keys are DELETED. A `reseeded` outcome raises a FRESH child, which is not
 * proof the seat works (R4.2) — `checkpointSince` therefore survives it and the failure count grows. The
 * bound fences the seat on the run where `failures` reaches `retryBound`, and any `refused` outcome
 * fences immediately (this run already gave up); a give-up names the count so the record says why.
 *
 * @param previous - the member row as the record held it before this outcome.
 * @param result - the barrier's outcome (its classification is the fence's cause).
 * @param retryBound - the consecutive non-reopening runs this seat may accumulate (the barrier's
 *   `compactionRetries` knob); a row is fenced on the run that reaches it.
 * @returns the row to persist.
 */
export function memberAfterBarrier(previous: CellMemberRecord, result: PromotionResult, retryBound: number): CellMemberRecord {
  /** The consecutive non-reopening barrier runs, THIS one included (absent reads as zero). */
  const failures = (previous.barrierFailures ?? 0) + 1
  /** Whether this outcome reopened the seat: only a successful compaction continues the SAME session. */
  const reopened = result.outcome === "promoted"
  /**
   * Whether the barrier gave up — a refusal now, or a run count that reached the bound.
   *
   * A `promoted` outcome NEVER gives up, whatever the count says: the compaction just reopened the seat,
   * and fencing it on the run that fixed it was a real defect the R4.3 arm caught (a later promotion
   * would otherwise be read as the fourth failure).
   */
  const givenUp = !reopened && (result.outcome === "refused" || failures >= retryBound)
  /** The fence's sentence: the barrier's own reason plus the run count the bound is measured in. */
  const fenceReason = result.reason + "; " + String(failures) + " of " + String(retryBound) + " consecutive barrier runs did not reopen the seat"
  return {
    name: previous.name,
    role: previous.role,
    sessionId: result.newHandle ?? previous.sessionId,
    executorRef: result.newHandle ?? previous.executorRef,
    mode: givenUp ? "checkpoint" : "subcaptain",
    handoffReady: givenUp,
    handoffs: previous.handoffs,
    joinedAt: previous.joinedAt,
    ...(previous.adopted === true ? { adopted: true } : {}),
    // BOTH WINDOW KEYS ON BOTH OUTCOMES (the field-by-field drop hazard): a reopening run deletes them
    // by omission, while a reseed/refusal carries the clock the force lever measures and records the
    // count this run added.
    ...(reopened ? {} : (previous.checkpointSince === undefined ? {} : { checkpointSince: previous.checkpointSince })),
    ...(reopened ? {} : { barrierFailures: failures }),
    ...(givenUp ? { fenced: true, fencedReason: fenceReason } : {}),
  }
}

/**
 * Retire the ORIGINAL session of a reseed, AUTHORISED BY A LIVE ANCESTOR (R5.1).
 *
 * THE AUTHORITY IS NEVER THE MEMBER'S OWN HANDLE. The host keys an Agent by its session id, so passing
 * `deps.agent` here made the caller and the target the SAME session: `@deepseek-ai/dsh-subagent` throws
 * `UNAUTHORIZED "cannot interrupt itself"` BEFORE its ancestry check, so the retirement never ran — and
 * the only silent path (a target the manager does not hold) is what recorded `retired: true`. The caller
 * now supplies the live session the reseed is raised under (the member's durable parent, else the cell
 * captain), which is exactly the `ancestor` authority the host validates, and `retired` reports only what
 * that call really did.
 *
 * THE TARGET'S PRESENCE IS PROVEN FIRST. The host documents an absent target as an ACCEPTED NO-OP, so a
 * silent return says nothing about a retirement; a session the identity registry does not hold is
 * `nothing-to-retire`. The reading is the same three-state rule the rest of this bundle uses: an absent
 * identity seam is UNKNOWN, never dead, and lands in `unavailable` instead of being read either way.
 *
 * DECLARED BOUND (stated in the docs): residency is proven through the agents registry, which is the
 * identity the host's own interrupt consults for its authority check. A live-but-NON-RESIDENT activation
 * (an external child whose session has no local Agent) would still answer silently and be recorded
 * `accepted`; the cellwork composition raises LOCAL children (`startContinuableAgent`), so this is a
 * residual of a composition this row does not build, not of the lever.
 *
 * @param deps - the barrier's seams, whose `sessionId` is the member's recorded session (the target).
 * @param authority - the EXACT live ancestor Agent the reseed is raised under.
 * @returns what the host did, plus its own sentence when it refused.
 */
function retireOriginal(deps: PromotionDeps, authority: DshLiveAgent): { retirement: RetirementOutcome; reason?: string } {
  /** The interrupt seam, probed rather than assumed (an older composition may not expose it). */
  const interrupt = deps.dsh.interruptAgent
  /** The identity seam, whose ABSENCE is "this composition cannot prove anything" — never "dead". */
  const identity = deps.dsh.liveAgentExact
  if (typeof interrupt !== "function" || typeof identity !== "function") {
    return { retirement: "unavailable", reason: "this composition exposes no " + (typeof interrupt !== "function" ? "interruptAgent" : "liveAgentExact") + " seam, so no retirement could be performed or verified" }
  }
  // NOTHING TO RETIRE: the registry proves the recorded session is already gone, so the host would answer
  // its documented no-op and there is nothing to claim. This is the DEAD-SEAT shape, not a retirement.
  if (liveSessionOf(deps, deps.sessionId) === undefined) {
    return { retirement: "nothing-to-retire", reason: "the identity registry holds no live agent for session " + JSON.stringify(deps.sessionId) + ", so there was nothing to retire" }
  }
  try {
    interrupt.call(deps.dsh, deps.sessionId, { kind: "ancestor", agent: authority })
    return { retirement: "accepted" }
  } catch (error) {
    // A REFUSAL IS REPORTED, never swallowed: the reseed still proceeds (an unretired original does not
    // block the fresh child), but the record and the journal name the host's own sentence.
    return { retirement: "refused", reason: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Compress one handoff into the member's own engine, and promote or reseed it.
 *
 * The barrier is BOUNDED: `compactionRetries` attempts, `idleBarrierDelayMs` apart. A `null` result means
 * "no safely compactable range" (a fact), and a busy/absent engine or a failure also lands here — after the
 * last attempt the activation is interrupted (best-effort) and a FRESH child is raised from the handoff.
 *
 * @param deps - the seams, the member, the handoff and the knobs.
 * @returns the outcome, journaled by the caller.
 */
export async function promoteAfterHandoff(deps: PromotionDeps): Promise<PromotionResult> {
  /** The last classification, journaled on every path. */
  let lastReason = "not attempted"
  /** Every attempt's classification, so a run that was `busy` THROUGHOUT is reported as the host fact it is. */
  const classifications: string[] = []
  for (let attempt = 1; attempt <= deps.config.compactionRetries; attempt += 1) {
    // NO SLEEP BEFORE THE FIRST ATTEMPT (C1). The member is live NOW; a delay before the first drive is
    // exactly the window in which the host's serial dispatch moves on and the handle stops mattering.
    if (attempt > 1) await deps.sleep(deps.config.idleBarrierDelayMs)
    /** The engine, resolved from the LIVE handle first and the registry only as a fallback. */
    const engine = engineForBarrier(deps)
    if (engine === undefined || typeof engine.compactNow !== "function") {
      lastReason = "no-engine"
      classifications.push(lastReason)
      continue
    }
    /** A real signal, never `undefined` (the engine's first statement aborts on it). */
    const { signal } = compactionSignal(deps.signal)
    try {
      /** The engine's answer. */
      const result = await engine.compactNow(deps.agent, signal)
      /** The classified answer. */
      const outcome = classifyCompactionResult(result)
      lastReason = outcome
      classifications.push(outcome)
      if (outcome === "compacted") {
        deps.injectDirective(promotionDirective(deps.cell.cellId, deps.memberName, deps.cell.depth + 1, deps.nextStep))
        return { outcome: "promoted", attempts: attempt, reason: outcome }
      }
    } catch (error) {
      lastReason = classifyCompactionError(error, signal)
      classifications.push(lastReason)
      if (lastReason === "aborted" && deps.signal?.aborted === true) return { outcome: "refused", attempts: attempt, reason: "the caller cancelled the barrier" }
    }
  }
  // `busy` ON EVERY ATTEMPT IS A HOST FACT, NOT A MYSTERY (R4.0 secondary). `BasicCompactionEngine
  // .compactNow` runs inside `agent.runMaintenance`, which REFUSES any phase but idle
  // (`dsh-agent-loop/lib/index.js#runMaintenance`), while `agent/turn-stopping` is dispatched INSIDE the
  // turn and its listeners are awaited (`:791`). So in-place compaction CANNOT run at this event on this
  // host — every retry burns the serial dispatch and fails identically. A wait cannot fix it: the host
  // awaits OUR promise before it can reach idle, so awaiting `whenIdle()` inside the listener deadlocks.
  // The sentence is appended here so the journal and the captain see the bound instead of "busy forever".
  /** Whether every attempt was `busy` — the shape all four VEdit journal rows had. */
  const busyThroughout = classifications.length > 0 && classifications.every((entry) => entry === "busy")
  /** The host-bound explanation, appended to the reseed outcome's reason when it applies. */
  const busyNote = busyThroughout
    ? "; the engine reported `busy` on every attempt: the host's compactNow needs an IDLE agent (runMaintenance refuses an open turn) while `agent/turn-stopping` fires inside the turn, so in-place compaction cannot run at this event — the reseed is the only path"
    : ""
  // The bounded attempts exhausted: reseed from the handoff.
  /** The LIVE session the fresh child is raised under, or undefined when neither candidate is live. */
  const parent = reseedParentOf(deps)
  if (parent === undefined) {
    // A DISTINCT reason, never the host's UNAUTHORIZED sentence: nothing tried to raise a child.
    return {
      outcome: "refused",
      attempts: deps.config.compactionRetries,
      reason: lastReason + busyNote + "; reseed-parent-unavailable (parent session " + JSON.stringify(deps.parentSessionId ?? "") + " and captain session " + JSON.stringify(deps.cell.captainSessionId) + " are neither one a live agent the registry holds)",
    }
  }
  // THE HOST'S OWN PRECONDITION, PROVEN BEFORE THE CALL (root cause 2): `@deepseek-ai/dsh-subagent`
  // refuses a spawn unless `agents.get(request.parent.id) === request.parent`. A parent the registry no
  // longer answers IDENTICALLY is refused HERE with our own reason, so a reseed can never surface as the
  // host's UNAUTHORIZED throw instead of a classification the journal and the captain can act on.
  if (!parentHeldExactly(deps, parent.parent)) {
    return {
      outcome: "refused",
      attempts: deps.config.compactionRetries,
      reason: lastReason + "; reseed-parent-unavailable (the live registry no longer holds session " + JSON.stringify(parent.sessionId) + " as the exact instance the reseed would forward)",
    }
  }
  // THE ORIGINAL IS RETIRED BY ITS LIVE ANCESTOR, AFTER THAT ANCESTOR IS PROVEN (R5.1): the SAME session
  // the child is raised under is the only `ancestor` authority the host accepts, and the member's own
  // handle is the target, never the caller. Retirement lands here — after the parent proof — so a refusal
  // that never reaches a spawn never kills the original either. BOTH REFUSAL RETURNS BELOW CARRY IT (R6.2):
  // once the host has accepted this retirement, a spawn that throws or mints no child id cannot un-retire
  // the original, so the fact travels with the `refused` outcome instead of being dropped with the reseed.
  /** What the host did with the original session's retirement. */
  const retirement = retireOriginal(deps, parent.parent)
  /** The directive the replacement is given — as its first prompt AND, on the reseed path, by delivery (R2). */
  const directive = promotionDirective(deps.cell.cellId, deps.memberName, deps.cell.depth + 1, deps.nextStep)
  /** The activation the reseed creates, kept so a failure AFTER the spawn can release it (R4/R5). */
  let activation: unknown
  try {
    activation = await deps.dsh.startContinuableAgent({
      provider: "spawn",
      label: deps.memberName + " · " + deps.cell.teamId,
      request: {
        // CONTENT BLOCKS, NEVER A STRING (R4.0, the primary root cause). `SubagentStartRequest.prompt` is
        // `ContentBlock[]`, and the host appends its return guidance with `[...prompt, block]` — so a
        // STRING prompt is spread into one single-character block per character (`dsh-subagent/lib/
        // index.js#withContinuableReturnGuidance`). The DeepSeek serializer then rejects the first bare
        // string block ("cannot represent user/tool-result content undefined", code UNSUPPORTED_CONTENT),
        // the child dies before its first turn, and because the poisoned message is permanent history
        // every later delivery re-fails identically. Measured on the VEdit incident's four reseeds.
        prompt: [{ type: "text", text: deps.handoffText + "\n\n" + directive }],
        // THE LIVE PARENT, never `deps.agent` (C2): the member's own handle is detached, and the host
        // refuses a parent it no longer holds.
        parent: parent.parent,
        // THE LIVE PARENT'S OWN DEPTH + 1 (R2.1): the child lands exactly one level below the session it
        // is raised under, so `cellwork.depthMax` — the nested-CELL bound, a different scale — must never
        // name this cap. Explicit, never omitted: the host's hidden default is what this cap replaces.
        maxDepth: reseedMaxDepthOf(parent.parent),
      },
      signal: compactionSignal().signal,
    })
  } catch (error) {
    return { outcome: "refused", attempts: deps.config.compactionRetries, reason: lastReason + busyNote + "; the reseed failed: " + (error instanceof Error ? error.message : String(error)), retirement: retirement.retirement, ...(retirement.reason === undefined ? {} : { retirementReason: retirement.reason }) }
  }
  /** The activation read structurally: the backend's child id, and the release seam it may expose. */
  const started = activation as { childId?: unknown; id?: unknown } | undefined
  /** The fresh handle the backend minted. */
  const handle = typeof started?.childId === "string" ? started.childId : typeof started?.id === "string" ? started.id : ""
  try {
    if (handle === "") {
      // R5: THE SLOT IS RELEASED. The harness counted the child the moment the activation started, so a
      // refusal that walked away would leak exactly one slot per attempt — the adapter's team path
      // disposes for this reason, and the reseed path owes the same.
      /** Whether the activation's own dispose seam ran. */
      const released = await releaseActivation(activation)
      return { outcome: "refused", attempts: deps.config.compactionRetries, reason: lastReason + busyNote + "; the reseed reported no child id" + (released ? " (the activation it created was RELEASED through its dispose seam, so no child slot is held)" : " (no dispose seam was exposed or the one that exists threw, so the activation could not be released)"), retirement: retirement.retirement, ...(retirement.reason === undefined ? {} : { retirementReason: retirement.reason }) }
    }
    // R1: THE THREE SURFACES ARE BOUND BEFORE ANYTHING IS CALLED A RESEED. A child nobody can address is
    // the incident this contract repairs: the seat keeps the dead handle, the board keeps the dead owner,
    // and the replacement has no identity. A surface that refuses makes this a REFUSAL, not a success.
    /** What the bind did. */
    const bind: SeatBindResult = deps.bindSeat === undefined
      ? { ok: true, plane: "absent", tasks: 0 }
      : await deps.bindSeat({ handle, previousSessionId: deps.sessionId })
    if (!bind.ok) {
      // THE SURVIVING DOCUMENT IS THE AUTHORITY (contract §3 A11, the Major-7 hole), AND A CONCURRENT
      // WRITER IS REASON ENOUGH TO KEEP THE CHILD (CodeRabbit round 2, Minor-1). A `refused` rollback
      // proves another writer committed after this bind; that writer's own read-modify-write — team-core's
      // `cancelTasks` included — may still commit a roster it read WHILE this bind was in flight, and that
      // roster can name THIS run's fresh handle. A `failed` rollback is the same unproven state from this
      // side: its write or its own re-read did not land, so no reader can say the record stopped naming the
      // child. So the CHILD IS KEPT FOR BOTH SHAPES; only a rollback that actually restored the pre-bind row
      // proves it unbindable. The absence of a pending concurrent write cannot be proven from here.
      /**
       * Whether the fresh child is KEPT instead of released.
       *
       * A `failed` rollback cannot prove the child unbindable (its own write/re-read did not land), and —
       * CodeRabbit round 2, Minor-1 — a `refused` rollback is KEPT AS WELL, whatever the surviving document
       * currently names. A refusal proves a concurrent writer committed after this bind, and that writer's
       * own read-modify-write (team-core's `cancelTasks` included) may still commit the roster it read WHILE
       * this bind was in flight — a document that names this fresh handle. Releasing on "the document I read
       * now names another handle" would leave that later roster pointing at a released child, the dangling
       * handle this contract removes; the absence of a pending write cannot be proven from here.
       */
      const keepChild = bind.rollback === "failed" || bind.rollback === "refused"
      /** Whether the surviving record PROVES it names the child this run started. */
      const namedBySurvivor = bind.survivingExecutorRef === handle
      // A READABLE DOCUMENT WITHOUT A HANDLE IS NOT AN UNREADABLE ONE (R4.2): the sentence the operator acts
      // on must say which of the two it met, because "could not be read" sends them to repair a file the
      // reader opened fine, while "carries no executorRef" sends them to reconcile the roster row.
      /** Whether the surviving document parsed but carried no string `executorRef` for this seat. */
      const survivingWithoutHandle = bind.survivingReadable === true && bind.survivingExecutorRef === undefined
      /** Whether the now-unbindable child was released; a kept child is never released. */
      const released = keepChild ? false : await releaseActivation(activation)
      return {
        outcome: "refused",
        attempts: deps.config.compactionRetries,
        reason: lastReason + busyNote + "; the fresh child was started but its seat could not be bound: " + (bind.surface ?? "unknown") + " could not be written (" + (bind.reason ?? "no reason was reported") + ")"
          + (keepChild
            ? "; BINDING KEPT: " + (bind.rollback === "failed"
              ? "the rollback itself could not be written (" + (bind.rollbackReason ?? "no reason was reported") + "), so the surviving record cannot prove the child unbindable"
              : namedBySurvivor
                ? "the rollback refused to overwrite a concurrent writer, and the surviving record names child " + JSON.stringify(handle)
                : survivingWithoutHandle
                  ? "the rollback refused to overwrite a concurrent writer, and the surviving record is READABLE but carries no string executorRef for " + JSON.stringify(deps.memberName)
                  : "the rollback refused to overwrite a concurrent writer, and the surviving record could not be read")
              + ", so the child was NOT released"
              + (bind.rollback === "refused" ? ": that writer may still commit a roster naming it (team-core's `cancelTasks` writes back the roster it read while this bind was in flight), and a released child behind such a roster is a dangling handle" : "")
              + "; repair with " + reconcileRepairOf(deps.memberName, handle) + "; THAT REPAIR WORKS EVEN WHEN BOTH CURRENT RECORDS STILL NAME THE OLD HANDLE: this row's `orphanChild` is the ownership evidence `rebind` accepts (it must stay the seat's latest hand-over; a later record that provably postdates it wins)"
            : released ? "; the fresh child's activation was RELEASED through its dispose seam (a best-effort attempt that resolved)" : "; the fresh child's activation could not be released: no dispose seam was exposed, or the one that exists threw"),
        failedSurface: bind.surface ?? "unknown",
        // THE ROLLBACK OUTCOME TRAVELS WITH THE REFUSAL (Major-7): the journal row that `failedSurface`
        // produces also carries whether the pre-bind TEAM row/owners were restored, refused or failed.
        ...(bind.rollback === undefined ? {} : { bindRollback: bind.rollback }),
        ...(bind.rollbackReason === undefined ? {} : { bindRollbackReason: bind.rollbackReason }),
        // A KEPT CHILD IS A RECORD-BEARING FACT, NOT A FOOTNOTE (A11): the handle travels so the journal row
        // and `cellwork_supervise` can name it, and `reconcileRequired` says the two records may disagree.
        ...(keepChild ? { orphanChild: handle, reconcileRequired: true } : {}),
        retirement: retirement.retirement,
        ...(retirement.reason === undefined ? {} : { retirementReason: retirement.reason }),
      }
    }
    // R2: THE REPLACEMENT IS TOLD WHAT TO DO. Its first prompt already carries the directive; the delivery
    // makes it reachable on a seat the host may not have resumed yet, and its outcome is REPORTED.
    /** Whether the directive reached the fresh handle. */
    let delivered = false
    /** Why it did not, when it did not. */
    let directiveError: string | undefined
    if (deps.deliverDirective === undefined) {
      directiveError = "this composition exposes no delivery seam, so the directive went only in the child's first prompt"
    } else {
      try {
        await deps.deliverDirective(parent.parent, handle, directive)
        delivered = true
      } catch (error) {
        directiveError = error instanceof Error ? error.message : String(error)
      }
    }
    return { outcome: "reseeded", attempts: deps.config.compactionRetries, reason: lastReason + busyNote, newHandle: handle, parentSessionId: parent.sessionId, parentSource: parent.source, retired: retirement.retirement === "accepted", retirement: retirement.retirement, ...(retirement.reason === undefined ? {} : { retirementReason: retirement.reason }), directiveDelivered: delivered, ...(directiveError === undefined ? {} : { directiveError }), boundTasks: bind.tasks ?? 0, ...(bind.plane === undefined ? {} : { bindPlane: bind.plane }), ...(bind.displacedExecutorRef === undefined ? {} : { displacedExecutorRef: bind.displacedExecutorRef, displacedUnproven: bind.displacedUnproven === true }) }
  } catch (error) {
    // R4: A THROW AFTER THE SPAWN RELEASES WHAT IT CREATED. Without this the child keeps a slot no verb
    // can clear AND the seat is left half-bound with no journal row naming the branch.
    /** Whether the activation was released on this throw. */
    const released = await releaseActivation(activation)
    return { outcome: "refused", attempts: deps.config.compactionRetries, reason: lastReason + busyNote + "; the reseed failed after the child started: " + (error instanceof Error ? error.message : String(error)) + (released ? "; its activation was RELEASED" : ""), retirement: retirement.retirement, ...(retirement.reason === undefined ? {} : { retirementReason: retirement.reason }) }
  }
}

/**
 * Run an activation's own dispose seam, best-effort, and report whether it ran (R5).
 *
 * The host counts a child the moment its activation starts, so the ONLY release this bundle has is the
 * activation's `dispose()`. A composition that exposes no such seam answers `false` — the caller then
 * says so instead of claiming a release that never happened.
 *
 * @param activation - the value the start seam resolved with.
 * @returns true when a callable `dispose` was found and ran without throwing.
 */
async function releaseActivation(activation: unknown): Promise<boolean> {
  /** The handle's own teardown member; only a callable may be invoked. */
  const dispose = (activation as { dispose?: unknown } | undefined)?.dispose
  if (typeof dispose !== "function") return false
  try {
    await (dispose as () => unknown).call(activation)
    return true
  } catch {
    // A teardown that throws did not release the slot, and saying otherwise would be a false claim.
    return false
  }
}

/**
 * The `next step` quoted out of a handoff document, best-effort.
 *
 * @param text - the handoff text.
 * @returns the next-step body, or "" when the section is absent.
 */
export function nextStepOf(text: string): string {
  /** The key-line or heading body after "Next step". */
  const match = /(?:^|\n)(?:#{1,4}\s*|-?\s*)next step\s*:?\s*([^\n]*)/i.exec(text)
  return match === null ? "" : match[1].trim()
}
