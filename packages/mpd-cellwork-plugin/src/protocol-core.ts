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
import { dispatchOwnerOnly, sendThroughExecutor, type DispatchRecordView, type DispatchReport } from "./dispatch"
import { validateHandoffText, writeHandoff } from "./handoff"
import { appendCellMail, foldCellMail, mailId, readCellMail, unreadFor, wakeFailures, type CellMailMessage } from "./mail"
import type { DshAdapter, DshContextPressure, DshToolExec } from "../../mpd-dsh-adapter-plugin/src/index"
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
 * Record one injected checkpoint and flip the member's seat to `checkpoint`.
 *
 * @param state - the cell record.
 * @param plan - the decision that was taken.
 * @param sessionId - the member's session id.
 * @param now - the instant of the injection.
 * @returns the record after the checkpoint.
 */
export function applyCheckpoint(state: CellState, plan: CheckpointPlan, sessionId: string, now: Date): CellState {
  /** The member row after the mode flip, when the cell still knows it. */
  const member = state.members[plan.memberName]
  /** The members map after the flip. */
  const members = member === undefined ? state.members : { ...state.members, [plan.memberName]: { ...member, mode: "checkpoint" as const } }
  return {
    ...state,
    members,
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
    "read-only children with `cellwork_recon`, and you keep `cellwork_dispatch`/`cellwork_status`.",
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
    "only. To leave your sub-cell call `cellwork_stop`; the parent cell keeps its record.",
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

/** What {@link promoteAfterHandoff} needs: the seams, the member and the handoff text. */
export interface PromotionDeps {
  /** The adapter slices the barrier uses. */
  dsh: Pick<DshAdapter, "compactionEngineForAgent" | "startContinuableAgent" | "interruptAgent">
  /** The member's live agent handle. */
  agent: unknown
  /** The member's board name. */
  memberName: string
  /** The member's recorded session id (the compaction engine is resolved by it). */
  sessionId: string
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
  /** The barrier's idle wait; injected so tests do not sleep. */
  sleep: (ms: number) => Promise<void>
  /** The event's cancellation, when it carried one. */
  signal?: AbortSignal
}

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
  for (let attempt = 1; attempt <= deps.config.compactionRetries; attempt += 1) {
    await deps.sleep(deps.config.idleBarrierDelayMs)
    /** The member's own engine, resolved by its session id. */
    const engine = deps.dsh.compactionEngineForAgent(deps.sessionId) as { compactNow?: (agent: unknown, signal: AbortSignal) => Promise<unknown> } | undefined
    if (engine === undefined || typeof engine.compactNow !== "function") {
      lastReason = "no-engine"
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
      if (outcome === "compacted") {
        deps.injectDirective(promotionDirective(deps.cell.cellId, deps.memberName, deps.cell.depth + 1, deps.nextStep))
        return { outcome: "promoted", attempts: attempt, reason: outcome }
      }
    } catch (error) {
      lastReason = classifyCompactionError(error, signal)
      if (lastReason === "aborted" && deps.signal?.aborted === true) return { outcome: "refused", attempts: attempt, reason: "the caller cancelled the barrier" }
    }
  }
  // The bounded attempts exhausted: reseed from the handoff.
  try {
    deps.dsh.interruptAgent(deps.sessionId, { kind: "ancestor", agent: deps.agent })
  } catch {
    // An absent interrupt seam does not block the reseed; the stale child is simply left idle.
  }
  try {
    /** The fresh durable child's activation. */
    const activation = await deps.dsh.startContinuableAgent({
      provider: "spawn",
      label: deps.memberName + " · " + deps.cell.teamId,
      request: {
        prompt: deps.handoffText + "\n\n" + promotionDirective(deps.cell.cellId, deps.memberName, deps.cell.depth + 1, deps.nextStep),
        parent: deps.agent,
        maxDepth: deps.config.depthMax,
      },
      signal: compactionSignal().signal,
    }) as { childId?: unknown; id?: unknown } | undefined
    /** The fresh handle the backend minted. */
    const handle = typeof activation?.childId === "string" ? activation.childId : typeof activation?.id === "string" ? activation.id : ""
    if (handle === "") return { outcome: "refused", attempts: deps.config.compactionRetries, reason: lastReason + "; the reseed reported no child id" }
    return { outcome: "reseeded", attempts: deps.config.compactionRetries, reason: lastReason, newHandle: handle }
  } catch (error) {
    return { outcome: "refused", attempts: deps.config.compactionRetries, reason: lastReason + "; the reseed failed: " + (error instanceof Error ? error.message : String(error)) }
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
