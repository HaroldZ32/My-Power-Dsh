// THE AUTOPROJECT ENGINE — an automated MPD session, not a parallel one.
//
// Wave W1-B2 cut the engine's INDEPENDENCE in four places, and this file is where all four live:
//
//   1. ROSTER ROUTING. Every child is raised through `mpd_role_spawn` (one `dsh.executeTool` call), so
//      the roster's own persona, `agentRoutes` routing and read-only deny list apply. There is no
//      `PERSONAS` map, no `provider`/`model`/`reviewerModel` override and no direct `dsh.spawnAgent`
//      call in this package any more: the engine names a ROLE and the roster decides the rest.
//   2. VERIFY PLANE. Verification is the `mpd_verify_*` plane's PASS, read back from the on-disk record
//      (`<workspace>/.mpd/verify/records/*.json`) — never a second ledger of our own. The run ledger
//      (`ledger.jsonl`) is a JOURNAL of rounds; it is never a verdict.
//   3. BOULDER LEDGER. A plan run drives `mpd_boulder_start` / `mpd_boulder_task_timer` /
//      `mpd_boulder_complete`, so `.mpd/boulder.json` is the in-flight truth the TUI and complexity
//      signal D already read. The run's `state.json` stays the ROUND journal.
//   4. ESCALATION. The one decision the engine still takes alone: the deterministic over-limit predicate
//      in `./escalation.ts`, evaluated at round boundaries, handed to cellwork (or to a human) instead
//      of silently pushing on.
//
// BOUNDED, NOT AUTONOMOUS: the activation prompt (`./directive.ts`) names exactly three decision points,
// and the engine itself never asks the user anything — asking is the SESSION's job, and the prompt says
// where.
//
// Every harness seam goes through the adapter interface below, which the row passes in; the engine never
// imports another package's source (the cross-package coupling inventory may only shrink).
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { join, relative } from "node:path"
import { randomUUID } from "node:crypto"
import { ADVERSARIAL_CATEGORIES, DIRECTIVE } from "./directive.ts"
import {
  criterionLabel,
  emitPlanMarkdown,
  escalationReader,
  evaluateEscalation,
  evidenceAttribution,
  recommendationStatus,
  recommendationVerdict,
  resolveEscalationConfig,
  reviewRequired,
  topLevelScope,
  type EscalationConfig,
  type EscalationSignal,
  type PlanCriterionSeed,
  type RunCriterion,
} from "./escalation.ts"

/** The roster's ONE-SHOT consult tool: the only route a child of this engine is raised through. */
export const ROLE_SPAWN_TOOL = "mpd_role_spawn"
/** The verify plane's loop opener. */
export const VERIFY_OPEN_TOOL = "mpd_verify_open"
/** The cellwork entry the escalation hand-off prefers when wave W2 has registered it. */
export const CELLWORK_OPEN_TOOL = "cellwork_open"
/** The merged boulder tools this engine drives for a plan run. */
export const BOULDER_START_TOOL = "mpd_boulder_start"
/** The per-criterion timer of the merged boulder machine. */
export const BOULDER_TIMER_TOOL = "mpd_boulder_task_timer"
/** The merged boulder completion verb. */
export const BOULDER_COMPLETE_TOOL = "mpd_boulder_complete"

/** The role a HEAVY tier's execution round is raised as. */
const ROLE_DEEP_WORKER = "Deep Worker"
/** The role a bounded LIGHT round (one that carries a plan) is raised as. */
const ROLE_SENIOR_ENGINEER = "Senior Engineer"
/** The role a mechanical LIGHT round (no plan) is raised as. */
const ROLE_JUNIOR_ENGINEER = "Junior Engineer"
/** The role the plan gate is raised as. */
const ROLE_PLANNER = "Planner"
/** The role the read-only plan review is raised as. */
const ROLE_PLAN_REVIEWER = "Plan Reviewer"
/** The role every verification consult is raised as. */
const ROLE_REVIEWER = "Reviewer"
/** The role the adversarial hyperplan angles are raised as; the ANGLE text rides `context`. */
const ROLE_ARCHITECT = "Architect"

/** The three quality-gate lanes, judged by one Reviewer consult each. */
const QUALITY_LANES = ["code quality", "hands-on QA", "goal verification"] as const

/** The row-log id every line from this package uses. */
const ROW_LOG = "mpd-autoproject"

/** The live config key naming how many children one autoproject run may hold in flight at once. */
export const SLOTS_CONFIG_KEY = "autoproject.slots"

/** The live config key naming the hard time bound on ONE child, in milliseconds. */
export const SLOT_BOUND_CONFIG_KEY = "autoproject.slotBoundMs"

/** How many children may be in flight when neither the live layer nor the row config speaks. */
export const SLOTS_DEFAULT = 3

/** The hard bound on one child when neither the live layer nor the row config speaks: 15 minutes — the SAME bound the consult deadman uses (§D0.2, one ledger not two timers). */
export const SLOT_BOUND_DEFAULT_MS = 900_000

/** The slice of the host context the engine reads: services only, resolved per call. */
export interface EngineCtx {
  /** Service lookup; a composition without a service answers `undefined`. */
  get?: (name: string, strict?: boolean) => any
  /** Any further host member a row config may carry. */
  [k: string]: any
}

/** The row config the engine reads; every key is optional because the resolver defaults each one. */
export interface AutoprojectConfig {
  /** The default round cap (`autoproject.maxRounds`). */
  maxRounds?: number
  /** The plan directory (`autoproject.planDir`). */
  planDir?: string
  /** The run-state directory (`autoproject.stateDir`). */
  stateDir?: string
  /** How many times a rejected plan or verification may be re-reviewed (`autoproject.maxReReviews`). */
  maxReReviews?: number
  /** The row-level escalation block; the live `mpd.jsonc` layer still wins per key. */
  escalate?: Record<string, unknown>
  /**
   * Row-level fallback for `autoproject.slots`; the LIVE `mpd.jsonc` layer wins when it speaks.
   * NOT a settings knob: `SETTINGS_KNOBS` stays at 47, and the engine reads the live value per run.
   */
  slots?: number
  /** Row-level fallback for `autoproject.slotBoundMs`; the live layer wins when it speaks. */
  slotBoundMs?: number
}

/** The `mpd_autoproject` arguments, as the declared schema sends them. */
export interface AutoprojectArgs {
  /** The objective this run must complete; the only required argument. */
  objective?: unknown
  /** The requested tier, which decides the execution role. */
  tier?: unknown
  /** Whether this run must write a plan file. */
  plan?: unknown
  /** Whether the adversarial hyperplan wave runs before planning. */
  hyperplan?: unknown
  /**
   * Kept for argument compatibility ONLY: since wave W1-B2 verification is not optional, so this flag no
   * longer switches anything on — every run that would report `complete` must hold a recorded verify PASS.
   */
  strictReview?: unknown
  /**
   * The caller's DECLARED write scope (workspace-relative paths). When present it replaces the
   * evidence-derived guess for S6, for the verify loop's `scope` and for the escalation hand-off; when
   * absent the derivation stays exactly as before and the artifact says so (`scopeSource`).
   */
  scope?: unknown
  /** The round cap for this run, clamped to 1..8. */
  maxRounds?: unknown
}

/** The `mpd_autoproject` result, matching the row's DECLARED output schema. */
export interface AutoprojectRunResult {
  /** The final outcome: `complete`, `blocked`, `max-rounds` or `escalated`. */
  status: string
  /** How many rounds actually ran. */
  rounds: number
  /** The plan file, present only when this run wrote one. */
  planFile?: string
  /** The verification outcome, or `n/a` when verification never ran. */
  verdict: string
  /** The quality gate's per-lane rows. */
  ledger: QualityLedgerRow[]
  /** The final human/model-facing report text. */
  finalReport: string
  /** The run's durable state document. */
  stateFile: string
}

/** One ledger row as the state document's `ledger` array carries it. */
export interface QualityLedgerRow {
  /** The judged lane. */
  lane: string
  /** The lane's verdict. */
  verdict: string
  /** The lane's evidence. */
  evidence: string
}

/** The adapter slice the engine needs, declared structurally so a unit double needs no boot. */
export interface AutoprojectEngineAdapter {
  /** Call one registered tool in-process; the adapter normalizes the answer to `{ok,isError,value,error}`. */
  executeTool(input: { name: string; arguments?: unknown; agent?: unknown; signal?: unknown }): Promise<{ ok?: unknown; isError?: unknown; value?: unknown; error?: unknown }>
  /** Whether a tool is registered in this agent's own view. */
  hasTool(name: string, agent?: unknown): boolean
  /** The calling session's workspace root, resolved PER CALL. */
  workspaceRoot(exec?: unknown): string
  /** One-line diagnostics sink, absent in a partial double. */
  rowLog?(name: string, line: string): void
}

/** Everything one run needs from the row that mounted it. */
export interface EngineDeps {
  /** The adapter slice. */
  dsh: AutoprojectEngineAdapter
  /** The host context, for the `mpdConfig` and `mpdGoal` services. */
  ctx: EngineCtx
  /** The row config. */
  config: AutoprojectConfig
}

/** One normalized child report: exactly the roster's fixed report fields, never a second schema. */
interface RoleReport {
  /** The role the roster answered as. */
  role: string
  /** The child's own status word, echoed as the roster reported it. */
  status: string
  /** The one-line summary. */
  summary: string
  /** The first-line protocol carrier (`STATUS:` / `VERDICT:` / `REVIEW:`). */
  recommendation: string
  /** The free-form detail, which is where a planner puts its plan markdown. */
  details: string
  /** The evidence entries, one per proof. */
  evidence: string[]
}

/** The slice of the `mpdGoal` service this engine consumes, declared structurally on purpose. */
interface GoalBridge {
  /** Whether long runs anchor a goal by themselves (`goal.autoAnchor` in mpd.jsonc). */
  autoAnchor(): boolean
  /** Put a durable goal in place, keeping any unfinished goal already current. */
  anchor(exec: unknown, input: { objective: string; source: string; maxRounds?: number }): Promise<{ ok: boolean; created: boolean; goal?: { id?: string } | null; error?: string; note?: string }>
  /** Finish a goal this row anchored; a goal it did not anchor is left to the model and the user. */
  finish(exec: unknown, input: { outcome: "complete" | "blocked"; source: string; reason?: string }): Promise<{ ok: boolean; outcome: string; error?: string }>
}

/** ONE child the hard bound killed, as `state.json` records it. */
export interface SlotKill {
  /** The roster role the killed child was raised as. */
  role: string
  /** ISO instant the kill was decided. */
  at: string
  /** How long the child had been running when the bound fired. */
  elapsedMs: number
  /** The bound that applied to it, so a later reader knows which number was in force. */
  boundMs: number
  /** The round the child belonged to, so a later reader can place the kill on the run's timeline. */
  round: number
}

/**
 * The run's DURABLE JOURNAL: `<stateDir>/<runId>/state.json`, rewritten (never appended) after every
 * mutation, so a reader always sees a complete document.
 *
 * IT IS NOT THE AUTHORITY ON ANYTHING. The recorded verdict of a run is the verify plane's record
 * (`<workspace>/.mpd/verify/records/`) and the in-flight ledger is `.mpd/boulder.json`; this document is
 * the ROUND journal beside them, and no field here may be read as a second verdict.
 *
 * Three fields are easy to misread: `wave` is the number of the last round that RAN (not the cap, which
 * is `rounds`); `status` exists only once the run reached a terminal state, so its absence means "still
 * running"; and `verdict` mirrors the verify plane's answer rather than deciding it. The optional
 * `slots*`/`kills` block is written only when the run applied the hard child bound, so its absence is
 * "the bound never fired", never "zero slots".
 */
interface RunState {
  /** The run id, which names the state directory. */
  id: string
  /** The objective, verbatim. */
  objective: string
  /** The requested tier. */
  tier: string
  /** Whether a plan file is required. */
  plan: boolean
  /** Whether the hyperplan wave ran. */
  hyperplan: boolean
  /** Whether the verification gate is forced. */
  strictReview: boolean
  /** The effective round cap. */
  rounds: number
  /** The plan file path, or null for a plan-less run. */
  planFile: string | null
  /** The final verdict, or null while the run is in flight. */
  verdict: string | null
  /** The accumulated criteria. */
  criteria: RunCriterion[]
  /** The round number reached. */
  wave: number
  /** Consecutive rounds that produced neither evidence nor progress. */
  fruitlessWaves: number
  /** The terminal status, once decided. */
  status?: string
  /** The goal this run anchored, when one is in place. */
  goalId?: string
  /** The boulder work this run started, when it started one. */
  boulderWorkId?: string
  /** The verify-plane loop this run opened, when it opened one. */
  verifyLoopId?: string
  /** How many children this run may hold in flight at once (`autoproject.slots`). */
  slots?: number
  /** The hard bound on ONE child (`autoproject.slotBoundMs`), in milliseconds. */
  slotBoundMs?: number
  /** The high-water mark of children in flight, so a reader can see the cap in force. */
  slotsPeak?: number
  /** Every child the bound killed, one timestamped row per kill. */
  kills?: SlotKill[]
}

/**
 * The plan directory for one call: the explicit `autoproject.planDir`, else `<workspace>/.mpd/plans`.
 *
 * @param config - the row config.
 * @param dsh - the adapter slice.
 * @param exec - the tool exec carrying the calling agent.
 * @returns the absolute plan directory.
 */
function planRoot(config: AutoprojectConfig, dsh: AutoprojectEngineAdapter, exec?: unknown): string {
  return config.planDir ?? join(dsh.workspaceRoot(exec), ".mpd", "plans")
}

/**
 * The run-state directory for one call: the explicit `autoproject.stateDir`, else `<workspace>/.mpd/autoproject`.
 *
 * @param config - the row config.
 * @param dsh - the adapter slice.
 * @param exec - the tool exec carrying the calling agent.
 * @returns the absolute state directory.
 */
function stateRoot(config: AutoprojectConfig, dsh: AutoprojectEngineAdapter, exec?: unknown): string {
  return config.stateDir ?? join(dsh.workspaceRoot(exec), ".mpd", "autoproject")
}

/**
 * Write one JSON document pretty-printed.
 *
 * @param path - the target path.
 * @param value - the value to serialize.
 */
function writeJson(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value, null, 2))
}

/**
 * A thrown or returned failure reduced to printable one-line text.
 *
 * @param error - a thrown value, a tool result's `error`, or a string.
 * @returns the printable text.
 */
function errorTextOf(error: unknown): string {
  if (typeof error === "string") return error
  /** The value's own `message`, when it carries one. */
  const message = (error as { message?: unknown } | undefined)?.message
  if (message !== undefined) return String(message)
  try {
    return JSON.stringify(error) ?? String(error)
  } catch {
    return String(error)
  }
}

/**
 * The caller's DECLARED write scope, normalized; null when nothing was declared.
 *
 * Only non-empty strings survive, trimmed and de-duplicated in first-appearance order. An absent, empty
 * or non-array value answers NULL on purpose: an empty declaration is not a scope (the verify plane reads
 * `[]` as "the whole workspace"), so it must fall back to the evidence derivation rather than silently
 * claiming the run may touch everything.
 *
 * @param value - the raw `scope` argument.
 * @returns the declared paths, or null when the caller declared nothing usable.
 */
function declaredScopeOf(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  /** The declared paths, trimmed and de-duplicated, in first-appearance order. */
  const declared: string[] = []
  for (const entry of value) {
    /** One entry as text; a non-string is not a declared path. */
    const path = typeof entry === "string" ? entry.trim() : ""
    if (path === "" || declared.includes(path)) continue
    declared.push(path)
  }
  return declared.length === 0 ? null : declared
}

/**
 * Whether a tool failure means the roster could not configure the ROLE.
 *
 * The distinction matters to the ledger: only this class is recorded as `route-unconfigured:<Role>`
 * (the team plane's own rule, and the contract's), while any other failure keeps its own lane name.
 *
 * @param text - the failure text.
 * @returns true for the unconfigured-route class.
 */
function isRouteUnconfigured(text: string): boolean {
  return /AGENT_UNCONFIGURED|no configured route|UNCONFIGURED/.test(text)
}

/**
 * The `mpdGoal` bridge, resolved PER CALL.
 *
 * @param ctx - the host context; a composition without the goal row answers `undefined`.
 * @returns the bridge, or undefined.
 */
function goalBridgeOf(ctx: EngineCtx): GoalBridge | undefined {
  return ctx.get?.("mpdGoal") as GoalBridge | undefined
}

/**
 * Anchor a persisted goal for a long run, so the DURABLE GOAL — not the tool call — carries the objective.
 *
 * @param deps - the adapter, context and config.
 * @param exec - the tool exec carrying the calling agent.
 * @param objective - the run's objective.
 * @returns the goal id when a goal is in place, else null; a refusal is logged, never thrown.
 */
async function anchorGoal(deps: EngineDeps, exec: unknown, objective: string): Promise<string | null> {
  try {
    /** The goal bridge, absent in a composition without the goal row. */
    const bridge = goalBridgeOf(deps.ctx)
    if (bridge === undefined || bridge.autoAnchor?.() !== true) return null
    /** The anchor outcome; an unfinished goal already current is KEPT by the service. */
    const outcome = await bridge.anchor(exec, { objective, source: "autoproject" })
    if (outcome?.goal != null && typeof outcome.goal.id === "string") return outcome.goal.id
    if (outcome?.ok === false) deps.dsh.rowLog?.(ROW_LOG, "goal anchor refused: " + String(outcome.error ?? "unknown"))
    return null
  } catch (error) {
    deps.dsh.rowLog?.(ROW_LOG, "goal anchor failed: " + errorTextOf(error))
    return null
  }
}

/**
 * Close the durable goal this run anchored, matching the run's own outcome.
 *
 * ONLY `complete` and `blocked` are transitions this function is allowed to attempt: `max-rounds` and
 * `escalated` deliberately LEAVE THE GOAL ARMED — for `max-rounds` the round driver carries the
 * objective on, and for `escalated` the work has been handed to cellwork, whose own goal must not be
 * closed by the engine that gave up on it.
 *
 * @param deps - the adapter, context and config.
 * @param exec - the tool exec carrying the calling agent.
 * @param status - the run's final status.
 * @param reason - the blocker text, for a blocked attempt.
 */
async function finishGoal(deps: EngineDeps, exec: unknown, status: string, reason: string): Promise<void> {
  if (status !== "complete" && status !== "blocked") return
  /** The goal bridge, absent in a composition without the goal row. */
  const bridge = goalBridgeOf(deps.ctx)
  if (bridge === undefined) return
  try {
    /** The finish outcome, reported in the row log when the harness refused the transition. */
    const outcome = await bridge.finish(exec, { outcome: status === "blocked" ? "blocked" : "complete", source: "autoproject", ...(status === "blocked" ? { reason } : {}) })
    if (outcome?.ok === false) deps.dsh.rowLog?.(ROW_LOG, "goal finish (" + status + ") refused: " + String(outcome.error ?? "unknown"))
  } catch (error) {
    deps.dsh.rowLog?.(ROW_LOG, "goal finish failed: " + errorTextOf(error))
  }
}

/**
 * Start one boulder work bound to this run's plan file.
 *
 * @param dsh - the adapter slice.
 * @param exec - the tool exec the call is attributed to.
 * @param planPath - the plan file the work is bound to.
 * @returns the work id, or null when the ledger refused (a degraded ledger never kills the run).
 */
async function boulderStart(dsh: AutoprojectEngineAdapter, exec: unknown, planPath: string): Promise<string | null> {
  /** The tool result, normalized by the adapter. */
  const result = await dsh.executeTool({ name: BOULDER_START_TOOL, arguments: { planPath }, agent: (exec as { agent?: unknown } | undefined)?.agent })
  if (result?.ok !== true || result.isError === true) {
    dsh.rowLog?.(ROW_LOG, "boulder start degraded: " + errorTextOf(result?.error ?? "the call did not report ok"))
    return null
  }
  /** The work id the ledger minted. */
  const workId = (result.value as { workId?: unknown } | undefined)?.workId
  return typeof workId === "string" && workId !== "" ? workId : null
}

/**
 * Start or end the per-criterion timer inside one boulder work.
 *
 * @param dsh - the adapter slice.
 * @param exec - the tool exec the call is attributed to.
 * @param workId - the work the timer belongs to.
 * @param taskKey - the criterion key, which is also the plan TODO number.
 * @param action - `start` or `end`.
 * @param label - the criterion label a `start` records on the timer.
 */
async function boulderTimer(dsh: AutoprojectEngineAdapter, exec: unknown, workId: string, taskKey: string, action: "start" | "end", label: string): Promise<void> {
  /** The tool result, normalized by the adapter. */
  const result = await dsh.executeTool({
    name: BOULDER_TIMER_TOOL,
    arguments: { workId, taskKey, action, ...(action === "start" ? { taskLabel: label, taskTitle: label } : {}) },
    agent: (exec as { agent?: unknown } | undefined)?.agent,
  })
  if (result?.ok !== true || result.isError === true) dsh.rowLog?.(ROW_LOG, "boulder timer " + action + " degraded for " + taskKey + ": " + errorTextOf(result?.error ?? "the call did not report ok"))
}

/**
 * Complete one boulder work.
 *
 * @param dsh - the adapter slice.
 * @param exec - the tool exec the call is attributed to.
 * @param workId - the work to complete.
 */
async function boulderComplete(dsh: AutoprojectEngineAdapter, exec: unknown, workId: string): Promise<void> {
  /** The tool result, normalized by the adapter. */
  const result = await dsh.executeTool({ name: BOULDER_COMPLETE_TOOL, arguments: { workId }, agent: (exec as { agent?: unknown } | undefined)?.agent })
  if (result?.ok !== true || result.isError === true) dsh.rowLog?.(ROW_LOG, "boulder complete degraded: " + errorTextOf(result?.error ?? "the call did not report ok"))
}

/**
 * Whether the verify plane holds a RECORDED PASS for one loop, read from its on-disk record directory.
 *
 * This is the engine's only source of truth for "verified". The on-disk layout is the verify plane's
 * declared state root (`<workspace>/.mpd/verify/records/<recordId>.json`); the engine reads those files
 * DIRECTLY rather than importing that package's source, because the cross-package coupling inventory
 * may only shrink. A missing, unreadable or empty directory reads FALSE — the conservative answer, since
 * an unverified run must never be reported complete.
 *
 * @param workspace - the session workspace root.
 * @param loopId - the loop this run opened.
 * @returns true only when a record names this loop with the verdict `PASS`.
 */
function verifyPassRecorded(workspace: string, loopId: string): boolean {
  /** The verify plane's record directory. */
  const dir = join(workspace, ".mpd", "verify", "records")
  try {
    if (!existsSync(dir)) return false
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".json")) continue
      try {
        /** One record, narrowed to the three fields this read needs. */
        const record = JSON.parse(readFileSync(join(dir, name), "utf8")) as { loopId?: unknown; verdict?: unknown }
        if (record?.loopId === loopId && record?.verdict === "PASS") return true
      } catch {
        // A malformed record is not a PASS; keep scanning the rest.
      }
    }
    return false
  } catch {
    return false
  }
}

/**
 * The workspace-relative spelling of a plan file, or undefined when it does not live inside the workspace.
 *
 * `mpd_verify_open`'s `contract` is workspace-relative by contract, and a plan directory outside the
 * workspace (a QA sandbox, an explicit `autoproject.planDir`) cannot be spelled that way — the loop then
 * keeps the tool's declared default contract instead of a `..`-escaping path.
 *
 * @param workspace - the session workspace root.
 * @param planFile - the absolute plan file, or null.
 * @returns the relative path, or undefined.
 */
function relativeContract(workspace: string, planFile: string | null): string | undefined {
  if (planFile === null) return undefined
  try {
    /** The relative spelling. */
    const rel = relative(workspace, planFile)
    return rel === "" || rel.startsWith("..") ? undefined : rel
  } catch {
    return undefined
  }
}

/**
 * The task text one verification consult receives, naming the exact three calls that produce a PASS.
 *
 * @param loopId - the loop the consult must bind itself to.
 * @param objective - the run's objective, quoted for the reviewer.
 * @returns the task text.
 */
function verifyTask(loopId: string, objective: string): string {
  return [
    "Verify this autoproject run READ-ONLY. You may not modify any file.",
    "1. Bind yourself as the loop's verifier: `mpd_verify_seat {loop_id: \"" + loopId + "\", role: \"verifier\"}`.",
    "2. Produce REAL gate evidence: `mpd_verify_evidence {kind: \"gate\", gate: \"<gate id>\", loop_id: \"" + loopId + "\"}` for each gate you actually ran (the project's own gate table).",
    "3. Record the verdict: `mpd_verify_record {loop_id: \"" + loopId + "\", verdict: \"PASS\" or \"FAIL\", sources: [<the plan file and the docs you worked from>], evidence_ids: [<the ids step 2 RETURNED>]}`. A record without real sources and real evidence ids is REFUSED, and this run then cannot complete — do NOT report PASS unless the record was accepted.",
    "Attribute each finding to its criterion by opening the evidence entry with `<criterionKey>:: `.",
    "The FIRST line of your `recommendation` MUST be `VERDICT: PASS` or `VERDICT: FAIL`.",
    "Objective: " + objective,
  ].join("\n")
}

/**
 * Run ONE autoproject activation end to end and return the tool result.
 *
 * The phase order is the contract: goal anchor → hyperplan → plan gate → execution rounds → verify
 * plane → quality gate → boulder completion → finalize. Escalation is evaluated at round boundaries and
 * once after verification, and it PRE-EMPTS everything after the boundary it fires on.
 *
 * @param args - the tool arguments.
 * @param exec - the tool exec, carrying the calling agent and its signal.
 * @param deps - the adapter slice, the host context and the row config.
 * @returns the run's result, matching the row's declared output schema.
 */
export async function runAutoproject(args: AutoprojectArgs, exec: any, deps: EngineDeps): Promise<AutoprojectRunResult> {
  /** The adapter slice. */
  const { dsh, ctx, config } = deps
  // Both roots are resolved PER CALL: one host serves many sessions with different workspaces.
  /** The plan directory for this invocation. */
  const planDir = planRoot(config, dsh, exec)
  /** The run-state directory for this invocation. */
  const stateDir = stateRoot(config, dsh, exec)
  /** The session workspace, which the verify records and the loop contract resolve against. */
  const workspace = dsh.workspaceRoot(exec)
  /** The objective, trimmed; an empty one is refused. */
  const objective = String(args?.objective ?? "").trim()
  if (objective === "") throw new Error("mpd_autoproject: objective required")
  // The cut is only real if the roster tool is: without it there is no legal way to raise a child.
  if (!dsh.hasTool(ROLE_SPAWN_TOOL, exec?.agent)) {
    throw new Error("mpd_autoproject: " + ROLE_SPAWN_TOOL + " is not registered in this composition — every child of an autoproject run is a roster consult, so mount the mpd-roles row")
  }
  /** The requested tier, defaulting to `light`. */
  const tier = args?.tier === "heavy" ? "heavy" : "light"
  /** Whether a plan file must be written, forced or implied by the heavy tier. */
  const plan = args?.plan === true || tier === "heavy"
  /** Whether the five-angle adversarial wave runs before planning. */
  const hyperplan = args?.hyperplan === true
  /** Whether the verification gate is forced even for a light tier. */
  const strictReview = args?.strictReview === true
  /** The effective round cap, clamped to the documented 1..8 range. */
  const rounds = Math.min(Math.max(Number(args?.maxRounds ?? config.maxRounds ?? 6) || 1, 1), 8)
  /** How many times a rejected plan or verification may be re-reviewed. */
  const maxReReviews = Math.max(0, Math.trunc(Number(config.maxReReviews ?? 2) || 0))
  /** The escalation knobs, resolved PER CALL so a `.mpd/mpd.jsonc` edit applies on the next run. */
  const escalation: EscalationConfig = resolveEscalationConfig(escalationReader((key: string) => liveConfigValue(ctx, key), config.escalate))
  /** The execution role, chosen by tier (and by whether this round carries a plan). */
  const roundRole = tier === "heavy" ? ROLE_DEEP_WORKER : plan ? ROLE_SENIOR_ENGINEER : ROLE_JUNIOR_ENGINEER
  // THE DECLARED WRITE SCOPE (R-W1B2 B2), resolved once: `null` means the caller declared none and the
  // evidence derivation stays in force, and the artifact records which of the two answered.
  /** The caller's declared write scope, or null when it declared none. */
  const declaredScope = declaredScopeOf(args?.scope)
  /** The run id, which names the state directory and every child label. */
  const id = "autoproject-" + randomUUID().slice(0, 8)
  /** The run's own state directory. */
  const dir = join(stateDir, id)
  mkdirSync(dir, { recursive: true })
  mkdirSync(planDir, { recursive: true })
  /** The durable state document for this run. */
  const stateFile = join(dir, "state.json")
  /** The append-only JOURNAL of rounds; never a second verdict. */
  const ledgerFile = join(dir, "ledger.jsonl")
  /** The escalation artifact, written only when the predicate fires. */
  const escalationFile = join(dir, "escalation.json")

  /**
   * Append one journal line, never throwing.
   *
   * @param lane - the row's lane name (`hyperplan`, `verification`, `route-unconfigured:<Role>`, …).
   * @param verdict - the outcome word for that lane.
   * @param detail - the one-line detail.
   */
  function stamp(lane: string, verdict: string, detail: string): void {
    try {
      appendFileSync(ledgerFile, JSON.stringify({ lane, verdict, detail, at: new Date().toISOString() }) + "\n")
    } catch {
      // A ledger that cannot be written must not take the run down: the state document still records it.
    }
  }

  /** The durable run state, rewritten after every mutation. */
  const state: RunState = { id, objective, tier, plan, hyperplan, strictReview, rounds, planFile: null, verdict: null, criteria: [], wave: 0, fruitlessWaves: 0 }
  writeJson(stateFile, state)

  /** The criteria accumulator, keyed by criterion key. */
  const criteria = new Map<string, RunCriterion>()
  /** Every evidence entry the run collected, in arrival order. */
  const evidence: string[] = []
  /** Per-criterion verify-FAIL counters, fed by the verification consults' attributed findings. */
  const verifyFails = new Map<string, number>()
  /** Criterion keys whose boulder timer is currently running. */
  const timersRunning = new Set<string>()

  // ── THE SLOT LEDGER AND THE HARD BOUND (W4-A2, adopted from the superagent prototype) ──────────
  // A run must never be able to IMPLY "still working" while a child has actually hung. Every child is
  // held by a SLOT from launch to report, slots are capped (`autoproject.slots`, default 3, read from
  // the LIVE config layer per run so a `.mpd/mpd.jsonc` edit applies to the next run), and a slot has a
  // hard time bound (`autoproject.slotBoundMs`, default 1_800_000 ms = 30 min). A child past the bound
  // is aborted through its AbortSignal, the kill is journaled and recorded in `state.json`, its slot is
  // released, and the run ends `blocked` — never `complete`, never "still running".
  /** How many children may be in flight at once, resolved per run (live layer, then row, then 3). */
  const slotCount = Math.max(1, Math.trunc(Number(liveConfigValue(ctx, SLOTS_CONFIG_KEY) ?? config.slots ?? SLOTS_DEFAULT) || SLOTS_DEFAULT))
  /** The hard bound on one child, in milliseconds, resolved per run (live layer, row, then 30 min). */
  const slotBoundMs = Math.max(1, Math.trunc(Number(liveConfigValue(ctx, SLOT_BOUND_CONFIG_KEY) ?? config.slotBoundMs ?? SLOT_BOUND_DEFAULT_MS) || SLOT_BOUND_DEFAULT_MS))
  /** Children currently holding a slot. */
  let slotsHeld = 0
  /** The high-water mark of concurrent children, which is what the honest report quotes. */
  let slotsPeak = 0
  /** Queued callers, FIFO: a child that finds every slot busy WAITS instead of over-subscribing. */
  const slotWaiters: Array<() => void> = []
  /** Every child the bound killed, in kill order. */
  const killed: SlotKill[] = []
  // The numbers in force are part of the run's own record: a later reader must be able to say WHICH cap
  // and WHICH bound a run ran under, not just that it had "some" bound.
  state.slots = slotCount
  state.slotBoundMs = slotBoundMs
  state.slotsPeak = 0
  state.kills = killed
  writeJson(stateFile, state)

  /**
   * Take ONE slot, waiting (FIFO) while every slot is busy.
   * @returns nothing; the caller MUST release in a `finally`.
   */
  async function acquireSlot(): Promise<void> {
    if (slotsHeld < slotCount) {
      slotsHeld += 1
      if (slotsHeld > slotsPeak) { slotsPeak = slotsHeld; state.slotsPeak = slotsPeak }
      return
    }
    await new Promise<void>((resolve) => { slotWaiters.push(resolve) })
    // The releasing caller already decremented `slotsHeld` before waking us, so this is the handover.
    slotsHeld += 1
    if (slotsHeld > slotsPeak) { slotsPeak = slotsHeld; state.slotsPeak = slotsPeak }
  }

  /** Release ONE slot, waking the next waiter when one is queued. */
  function releaseSlot(): void {
    slotsHeld = Math.max(0, slotsHeld - 1)
    /** The next waiter, if any. */
    const next = slotWaiters.shift()
    if (next !== undefined) next()
  }

  /**
   * Compose the caller's cancellation with this child's own bound, so EITHER can abort the call.
   * @param outer - the tool exec's signal, when the turn carries one.
   * @param own - the controller this run aborts at the bound.
   * @returns the signal handed to the tool call.
   */
  function composedSignalOf(outer: unknown, own: AbortController): AbortSignal {
    if (outer === undefined || outer === null) return own.signal
    /** The caller's signal, typed only as far as this composition needs. */
    const outerSignal = outer as AbortSignal
    if (outerSignal.aborted === true) { own.abort(); return own.signal }
    try { outerSignal.addEventListener("abort", () => own.abort(), { once: true }) } catch { /* a foreign signal shape is ignored */ }
    return own.signal
  }

  /**
   * Raise ONE roster consult under the slot ledger and the hard bound.
   *
   * A SLOT IS HELD FROM LAUNCH TO REPORT and released in a `finally`, so a throwing or refusing child
   * cannot leak it. A child past `autoproject.slotBoundMs` is aborted, recorded as `late/killed:<role>`,
   * and answered as `null` — the run's status is forced to `blocked` at the end.
   *
   * @param role - the roster role name.
   * @param task - the task text handed to the consult.
   * @param context - optional context block (the hyperplan ANGLE text rides here).
   * @returns the normalized report, or null when the consult could not be raised OR was killed.
   */
  async function consult(role: string, task: string, context?: string): Promise<RoleReport | null> {
    await acquireSlot()
    /** When this child was launched, which is what `elapsedMs` is measured from. */
    const startedAt = Date.now()
    /** The controller this run aborts at the bound (and when the turn is cancelled). */
    const controller = new AbortController()
    /** The signal the tool call receives. */
    const signal = composedSignalOf(exec?.signal, controller)
    /** The bound's timer, cleared on every exit path. */
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      /** A promise that settles ONLY when the bound fires. */
      const expired = new Promise<"timeout">((resolve) => {
        timer = setTimeout(() => { try { controller.abort() } catch { /* already aborted */ } resolve("timeout") }, slotBoundMs)
      })
      /** Whichever finishes first: the child's report or the bound. */
      const raced = await Promise.race([consultOnce(role, task, context, signal), expired])
      if (raced !== "timeout") return raced
      /** How long the killed child had been running. */
      const elapsedMs = Date.now() - startedAt
      /** The durable row this kill writes. */
      const kill: SlotKill = { role, at: new Date().toISOString(), elapsedMs, boundMs: slotBoundMs, round: state.wave }
      killed.push(kill)
      state.kills = killed
      state.slots = slotCount
      state.slotBoundMs = slotBoundMs
      writeJson(stateFile, state)
      stamp("late/killed:" + role, "killed", "elapsed=" + elapsedMs + "ms bound=" + slotBoundMs + "ms round=" + state.wave)
      dsh.rowLog?.(ROW_LOG, "killed " + role + " at the " + slotBoundMs + " ms slot bound (elapsed " + elapsedMs + " ms)")
      return null
    } finally {
      if (timer !== undefined) clearTimeout(timer)
      releaseSlot()
    }
  }

  /**
   * Raise ONE roster consult and normalize its report (the unbounded half; `consult` owns the slot).
   *
   * A role the roster cannot configure is NOT a hard failure: it is journaled as
   * `route-unconfigured:<Role>` and the run continues, which is the team plane's own rule.
   *
   * @param role - the roster role name.
   * @param task - the task text handed to the consult.
   * @param context - optional context block (the hyperplan ANGLE text rides here).
   * @returns the normalized report, or null when the consult could not be raised.
   */
  async function consultOnce(role: string, task: string, context: string | undefined, signal: AbortSignal): Promise<RoleReport | null> {
    /** The tool result, normalized by the adapter. */
    const result = await dsh.executeTool({ name: ROLE_SPAWN_TOOL, arguments: { role, task, ...(context === undefined || context === "" ? {} : { context }) }, agent: exec?.agent, signal })
    if (result?.ok !== true || result.isError === true) {
      /** The failure text this call reported. */
      const text = errorTextOf(result?.error ?? "the role-spawn call did not report ok")
      stamp(isRouteUnconfigured(text) ? "route-unconfigured:" + role : "child-degraded:" + role, "skipped", text)
      dsh.rowLog?.(ROW_LOG, "consult " + role + " degraded: " + text)
      return null
    }
    /** The roster's report, read field by field because a tool value is untyped. */
    const value = (result.value ?? {}) as Record<string, unknown>
    // AN INTERRUPTED CONSULT IS A KILLED SLOT, NEVER A SILENT NULL (§D0.2): the roster already wrote
    // the handoff before it interrupted the child, so this records the durable SlotKill row and the
    // ledger stamp, then answers null exactly like a bound kill — the run's status is forced to
    // `blocked` at the end by the existing `kills` accounting, which stays the ONLY accounting.
    if (value.status === "interrupted") {
      /** The handoff path the roster wrote, when it reported one. */
      const handoff = typeof value.handoff === "string" ? value.handoff : ""
      /** The child's runtime the roster measured, when it reported one. */
      const elapsedMs = typeof value.elapsedMs === "number" ? value.elapsedMs : 0
      /** The durable row this interruption writes. */
      const kill: SlotKill = { role, at: new Date().toISOString(), elapsedMs, boundMs: slotBoundMs, round: state.wave }
      killed.push(kill)
      state.kills = killed
      state.slotBoundMs = slotBoundMs
      writeJson(stateFile, state)
      stamp("late/interrupted:" + role, "killed", "elapsed=" + elapsedMs + "ms handoff=" + (handoff === "" ? "<none>" : handoff))
      dsh.rowLog?.(ROW_LOG, "consult " + role + " was interrupted by its deadman (elapsed " + elapsedMs + " ms)" + (handoff === "" ? "" : " — handoff " + handoff))
      return null
    }
    return {
      role: typeof value.role === "string" && value.role !== "" ? value.role : role,
      status: typeof value.status === "string" ? value.status : "",
      summary: typeof value.summary === "string" ? value.summary : "",
      recommendation: typeof value.recommendation === "string" ? value.recommendation : "",
      details: typeof value.details === "string" ? value.details : "",
      evidence: Array.isArray(value.evidence) ? value.evidence.map((entry) => String(entry)) : [],
    }
  }

  /**
   * Fold one report's evidence into the run: every entry is kept, and an attributed entry marks its
   * criterion clean.
   *
   * @param report - the normalized consult report, or null when nothing came back.
   * @returns the criterion keys this report advanced to `clean`.
   */
  function absorb(report: RoleReport | null): string[] {
    if (report === null) return []
    /** The keys this report moved to `clean`. */
    const advanced: string[] = []
    for (const entry of report.evidence) {
      evidence.push(entry)
      /** The criterion this entry attributes to, when it attributes at all. */
      const attribution = evidenceAttribution(entry)
      if (attribution === undefined) continue
      /** The criterion that entry belongs to. */
      const criterion = criteria.get(attribution.key)
      if (criterion === undefined) continue
      criteria.set(attribution.key, { ...criterion, state: "clean", evidence: [...criterion.evidence, attribution.text] })
      if (!advanced.includes(attribution.key)) advanced.push(attribution.key)
    }
    return advanced
  }

  /** The current ledger size in bytes, which S4 reads. */
  const ledgerBytes = (): number => (existsSync(ledgerFile) ? statSync(ledgerFile).size : 0)
  /** The highest per-criterion verify-FAIL count, which S7 reads. */
  const highestVerifyFails = (): number => {
    /** The highest per-criterion count seen so far. */
    let max = 0
    for (const count of verifyFails.values()) if (count > max) max = count
    return max
  }

  /** The run's final report text. */
  let finalReport = ""
  /** The run's outcome, finalized after the phases. */
  let status = "continue"
  /** How many rounds actually ran. */
  let used = 0
  /** The written plan file, or null for a plan-less run. */
  let planFile: string | null = null
  /** The boulder work this run drives, or null when none was started. */
  let boulderWorkId: string | null = null
  /** The verify-plane loop this run opened, or null. */
  let verifyLoopId: string | null = null
  /** The verification outcome, `n/a` until that phase runs. */
  let verdict = "n/a"
  /** The quality gate's per-lane rows. */
  let gateLedger: QualityLedgerRow[] = []
  /** Whether this run has already escalated (the artifact is written at most ONCE). */
  let escalated = false
  /** Whether the scope provenance has been journaled yet (it is recorded ONCE per run). */
  let scopeStamped = false

  /**
   * Evaluate the frozen predicate at ONE boundary and, when it fires, take the one decision this engine
   * owns.
   *
   * The artifact is written at most once. `mode:"off"` records the firing in the journal and takes NO
   * consequence: the mode decides what happens NEXT, never whether a signal fired. `mode:"ask"` and
   * `mode:"auto"` both end the run `escalated` and LEAVE THE ANCHORED GOAL ARMED; `auto` additionally
   * calls `cellwork_open` when that tool is registered, and otherwise returns the `/cellwork` instruction.
   *
   * @param boundaryStatus - the status observed at this boundary.
   * @returns whether the run must stop here.
   */
  async function considerEscalation(boundaryStatus: string): Promise<boolean> {
    if (escalated) return false
    /** The scope this run may touch: the caller's DECLARED one, else the evidence-derived fallback. */
    const scope = declaredScope ?? topLevelScope(evidence)
    /** Which of the two answered, recorded on the artifact AND once in the ledger. */
    const scopeSource = declaredScope === null ? "evidence" : "declared"
    // The scope's provenance is journaled ONCE per run, at the first boundary, so a run that never
    // escalates can still be audited for what it believed its write scope was.
    if (!scopeStamped) {
      scopeStamped = true
      stamp("scope", scopeSource, scope.join(",") || "(none declared and no path evidence)")
    }
    /** The predicate's answer for this boundary. */
    const decision = evaluateEscalation({
      criteria: criteria.size,
      status: boundaryStatus,
      fruitlessWaves: state.fruitlessWaves,
      ledgerBytes: ledgerBytes(),
      // A DECLARED scope counts as declared; the derived fallback is already the tree list itself.
      scopeTrees: declaredScope === null ? scope.length : topLevelScope(declaredScope).length,
      sameCriterionVerifyFails: highestVerifyFails(),
      config: escalation,
    })
    if (!decision.escalate) return false
    /** The fired signals, rendered once for the journal and the artifact. */
    const fired: EscalationSignal[] = decision.signals
    stamp("escalation", escalation.mode === "off" ? "suppressed" : "fired", fired.map((signal) => signal.id + "=" + signal.value + "/" + signal.threshold).join(",") + " mode=" + escalation.mode)
    if (escalation.mode === "off") return false
    escalated = true
    /** The hand-off path this run took, recorded in the journal AND in the artifact. */
    let handoff = "instruction"
    if (escalation.mode === "auto" && dsh.hasTool(CELLWORK_OPEN_TOOL, exec?.agent)) {
      /** The programmatic hand-off into cellwork. */
      const opened = await dsh.executeTool({ name: CELLWORK_OPEN_TOOL, arguments: { objective, mandate: { source: "autoproject", runId: id, planFile }, planFile, scope }, agent: exec?.agent })
      if (opened?.ok === true && opened.isError !== true) handoff = CELLWORK_OPEN_TOOL
      else dsh.rowLog?.(ROW_LOG, "cellwork hand-off degraded: " + errorTextOf(opened?.error ?? "the call did not report ok"))
    }
    /** The escalation artifact: the deterministic decision, its evidence and the hand-off, on disk. */
    const artifact = {
      version: 1,
      at: new Date().toISOString(),
      mode: escalation.mode,
      signals: fired,
      objective,
      planFile,
      criteria: [...criteria.values()],
      evidence: [...evidence],
      // THE SCOPE AND ITS PROVENANCE (R-W1B2 B2): `declared` means the caller said it, `evidence` means
      // the engine inferred it from the paths its children cited. A reader never has to guess which.
      scope,
      scopeSource,
      // THE WRITER'S IDENTITY BOUND (R-W1B2 B3): `id` is a LABEL, not an agent key — see the comment on
      // the `mpd_verify_open` call for why the roster cannot supply one.
      writer: { id: roundRole + " · " + id, role: roundRole, runId: id, bound: "label-not-agent-key" },
      roundsUsed: used,
      mandate: { source: "autoproject", runId: id, planFile },
      handoff: { path: handoff },
    }
    state.status = "escalated"
    writeJson(stateFile, state)
    writeJson(escalationFile, artifact)
    stamp("handoff", handoff, handoff === CELLWORK_OPEN_TOOL ? "cellwork opened" : "run `/cellwork " + objective + "`")
    finalReport += (finalReport === "" ? "" : "\n") + "escalated [" + fired.map((signal) => signal.id).join("/") + "] mode=" + escalation.mode + ": " + (handoff === CELLWORK_OPEN_TOOL ? "handed off to cellwork" : "run `/cellwork " + objective + "` to continue the project there")
    return true
  }

  // ── PHASE 0: the durable goal ──────────────────────────────────────────────
  // A PLAN-BOUND RUN OUTLIVES ITS TURN, so it anchors a persisted goal: from here the durable goal —
  // not this tool call — is the basis of continuous execution.
  if (plan) {
    /** The goal this run anchored, when one is in place. */
    const goalId = await anchorGoal(deps, exec, objective)
    if (goalId !== null) { state.goalId = goalId; writeJson(stateFile, state) }
  }

  // ── PHASE 1: the adversarial hyperplan wave ────────────────────────────────
  /** The distilled hyperplan insights, capped below. */
  let insights: string[] = []
  if (hyperplan) {
    // One Architect consult per ANGLE, all raised together; the angle text is the consult's CONTEXT.
    const reports = await Promise.all(ADVERSARIAL_CATEGORIES.map((angle) => consult(ROLE_ARCHITECT, "Run ONE adversarial angle over the objective. Report only defensible insights, no code changes.", "Angle " + angle.angleId + ": " + angle.angle + "\nObjective: " + objective)))
    for (const report of reports) {
      if (report === null) continue
      insights.push(report.summary, ...report.evidence)
    }
    insights = insights.map((line) => line.trim()).filter((line) => line !== "").slice(0, 20)
    stamp("hyperplan", "done", insights.length + " insights distilled")
  }

  // ── PHASE 2: the plan gate ─────────────────────────────────────────────────
  /** Whether the plan gate approved; true when no review was required. */
  let planReviewOk = false
  if (plan) {
    /** The objective folded into a file-name-safe slug. */
    const slug = objective.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "plan"
    /** The planner consult's report. */
    const planner = await consult(ROLE_PLANNER, [
      "Write a decision-complete, step-ordered plan for the objective below.",
      "Put the plan MARKDOWN in `details`.",
      "Put the plan's success criteria in `evidence`, ONE criterion per entry, each a one-line success measure (include the edge, regression and adversarial criteria for a HEAVY change set). No numbering.",
      "The FIRST line of `recommendation` MUST be `REVIEW: required` or `REVIEW: optional`.",
      "Objective: " + objective,
      ...(insights.length === 0 ? [] : ["Adversarial insights to fold in:", ...insights.map((line) => "- " + line)]),
    ].join("\n"))
    /** The planner's criteria, normalized; a planner that returned none falls back to the objective. */
    const seeds: PlanCriterionSeed[] = (planner?.evidence ?? [])
      .map((entry) => criterionLabel(entry))
      .filter((label) => label !== "")
      .map((label, index) => ({ key: String(index + 1), label }))
    if (seeds.length === 0) {
      seeds.push({ key: "1", label: criterionLabel(objective) })
      stamp("plan", "criteria-fallback", "the planner reported no criteria; the objective is the one criterion")
    }
    // THE CHECKLIST IS EMITTED, NEVER TRUSTED TO PROSE: the `## TODOs` section is generated from the
    // criteria alone, so boulder's structural reader counts exactly as many items as this run has.
    /** This run's plan file. */
    const planPath = join(planDir, slug + "-" + id.slice(-4) + ".md")
    writeFileSync(planPath, emitPlanMarkdown(planner?.details ?? planner?.summary ?? "", seeds))
    planFile = planPath
    state.planFile = planPath
    for (const seed of seeds) criteria.set(seed.key, { key: seed.key, label: seed.label, state: "pin", evidence: [] })
    stamp("plan", "written", planPath + " (" + seeds.length + " criteria)")
    // THE DURABLE LEDGER: `.mpd/boulder.json` becomes the in-flight truth for this plan.
    boulderWorkId = await boulderStart(dsh, exec, planPath)
    if (boulderWorkId !== null) { state.boulderWorkId = boulderWorkId; writeJson(stateFile, state) }
    // The read-only plan review: forced by the HEAVY tier, optional otherwise.
    if (tier === "heavy" || reviewRequired(planner?.recommendation ?? "")) {
      for (let attempt = 0; attempt <= maxReReviews; attempt++) {
        /** The plan reviewer's report. */
        const review = await consult(ROLE_PLAN_REVIEWER, [
          "Review this plan READ-ONLY; reject only true blockers. Concerns must be concrete and actionable.",
          "The FIRST line of `recommendation` MUST be `VERDICT: PASS` or `VERDICT: FAIL`.",
          "The plan is quoted below.",
          String(planner?.details ?? ""),
          "Objective: " + objective,
        ].join("\n"))
        /** The verdict this review declared. */
        const declared = recommendationVerdict(review?.recommendation ?? "")
        if (declared === "PASS") { planReviewOk = true; break }
        stamp("plan-review", "fail", review?.summary || review?.details || "no report")
      }
      stamp("plan-review", planReviewOk ? "approve" : "reject", planReviewOk ? "the plan gate approved" : "the plan gate rejected after " + (maxReReviews + 1) + " attempt(s)")
    } else {
      planReviewOk = true
      stamp("plan-review", "skipped", "the planner asked for no review and the tier is not heavy")
    }
  } else {
    // A plan-less run still needs one criterion to work against; the objective IS that criterion.
    criteria.set("1", { key: "1", label: criterionLabel(objective), state: "pin", evidence: [] })
    // No plan means no plan gate: the review is not applicable, which is an APPROVED gate, not a failing one.
    planReviewOk = true
  }

  // ── PHASE 3: the execution rounds ──────────────────────────────────────────
  /** One handoff line per round, newest last. */
  const recap: string[] = []
  for (let round = 1; round <= rounds; round++) {
    used = round
    // The per-criterion timers open at the round boundary, so a criterion's work is charged to a round.
    if (boulderWorkId !== null) {
      for (const criterion of criteria.values()) {
        if (criterion.state === "clean" || timersRunning.has(criterion.key)) continue
        await boulderTimer(dsh, exec, boulderWorkId, criterion.key, "start", criterion.label)
        timersRunning.add(criterion.key)
      }
    }
    /** The criteria rendered into this round's prompt. */
    const critNow = [...criteria.values()].map((criterion) => "- [" + criterion.key + "] " + criterion.label + " -> " + criterion.state)
    // DeepSeek V4 prefix-cache discipline: DIRECTIVE stays the byte-stable prompt head, and the handoff
    // is the last three round summaries rather than the whole recap.
    /** The last three handoff lines. */
    const recent = recap.slice(-3)
    /** This round's task text: stable policy head, mutable state tail. */
    const task = DIRECTIVE + "\n\n" + "autoproject round " + round + "/" + rounds + "\n" + "Objective: " + objective + "\n"
      + (planFile === null ? "" : "Plan file: " + planFile + "\n")
      + "Durable state: " + stateFile + " (ledger: " + ledgerFile + " — read them for the full history)\n"
      + "Criteria:\n" + (critNow.join("\n") || "(discover and pin criteria in this round)\n")
      + "Recent handoff:\n" + (recent.join("\n") || "(none - first round)")
    /** This round's consult report. */
    const report = await consult(roundRole, task)
    /** The criteria this round drove clean. */
    const advanced = absorb(report)
    // The timers of the criteria this round finished close here.
    if (boulderWorkId !== null) {
      for (const key of advanced) {
        if (!timersRunning.delete(key)) continue
        await boulderTimer(dsh, exec, boulderWorkId, key, "end", criteria.get(key)?.label ?? key)
      }
    }
    // A round is FRUITLESS when it produced no evidence AND moved no criterion.
    if (advanced.length === 0 && (report === null || report.evidence.length === 0)) state.fruitlessWaves++
    state.wave = round
    state.criteria = [...criteria.values()]
    writeJson(stateFile, state)
    recap.push("round " + round + ": " + (report?.summary ?? "no report"))
    finalReport = "round " + round + ": " + (report?.summary ?? "no report")
    /** What this round declared its status to be; an unreadable answer keeps working. */
    const declared = recommendationStatus(report?.recommendation ?? "") ?? "continue"
    // THE PLAN GATE IS A GATE: a run whose plan review never approved cannot be reported done, even when
    // its rounds claim completion — the conservative direction, because "done" is the claim that costs.
    if (declared === "complete" && allClean(criteria) && planReviewOk) { status = "complete"; break }
    if (declared === "blocked") { status = "blocked"; finalReport += "\nblocked: " + (report?.summary ?? ""); break }
    if (state.fruitlessWaves >= 2) { status = "max-rounds"; finalReport += "\nstopped: 2 fruitless discovery waves"; break }
    if (round === rounds) status = "max-rounds"
    // THE ROUND BOUNDARY: the engine — not the model — decides whether this project is over-limit.
    if (await considerEscalation(status)) { status = "escalated"; break }
  }
  if (status === "continue") status = "max-rounds"
  // The boundary AFTER the round phase, which is where the round-cap signal (S2) becomes observable.
  if (status !== "escalated" && await considerEscalation(status)) status = "escalated"

  // ── PHASE 4: the verify plane ──────────────────────────────────────────────
  if (status === "complete") {
    // The loop is opened BEFORE the consult: the verifier needs the id, and the engine needs the record.
    /** The workspace-relative plan spelling the loop freezes as its contract, when one exists. */
    const contract = relativeContract(workspace, planFile)
    // THE WRITER-ID BOUND (R-W1B2 B3), STATED RATHER THAN HIDDEN: `mpd_verify_open` documents
    // `writer_id` as the member's AGENT KEY (a session id), which is what its same-agent refusal compares.
    // This engine cannot know one — `mpd_role_spawn` answers the fixed REPORT_SCHEMA (C6) and exposes no
    // child session id, and the child's session is disposed when its one-shot report settles. The value
    // below is therefore a LABEL: it identifies the SEAT CLASS (the role + the run that raised it), never
    // the agent instance. The consequence is explicit: the loop's same-agent arm is INERT for an
    // autoproject loop, and the independence of the verification rests ONLY on the verifier being a
    // different seat (it is a `Reviewer` consult, so it holds). The label, the role and the run id all
    // ride `escalation.json` (`writer`) and one ledger line, so a reader can see what kind of identity it
    // is holding instead of assuming a session id.
    /** The label recorded as the loop's writer identity; a seat CLASS, never an agent key. */
    const writerId = roundRole + " · " + id
    stamp("verify-writer", roundRole, "writer_id=" + writerId + " runId=" + id + " bound=label-not-agent-key (mpd_role_spawn exposes no agent key, C6)")
    /** The loop, as the tool reported it. */
    const opened = await dsh.executeTool({
      name: VERIFY_OPEN_TOOL,
      arguments: {
        writer: "delegate",
        writer_id: writerId,
        writer_reason: "member: " + roundRole,
        // THE DECLARED SCOPE WINS here too: the loop authorises writes, so it must carry the scope the
        // caller declared rather than the paths its children happened to cite.
        scope: declaredScope ?? topLevelScope(evidence),
        ...(contract === undefined ? {} : { contract }),
      },
      agent: exec?.agent,
      signal: exec?.signal,
    })
    if (opened?.ok !== true || opened.isError === true) {
      /** The refusal the loop opener reported. */
      const refusal = errorTextOf(opened?.error ?? "the verify loop could not be opened")
      stamp("verify-loop", "refused", refusal)
      status = "blocked"
      finalReport += "\nverify: " + refusal + " — a run may not report complete without a recorded PASS"
    } else {
      /** The loop id the verify plane minted. */
      const loopId = String((opened.value as { loopId?: unknown } | undefined)?.loopId ?? "")
      verifyLoopId = loopId === "" ? null : loopId
      if (verifyLoopId === null) {
        stamp("verify-loop", "refused", "the loop opener reported no loop id")
        status = "blocked"
        finalReport += "\nverify: the verify loop reported no id — a run may not report complete without a recorded PASS"
      } else {
        state.verifyLoopId = verifyLoopId
        writeJson(stateFile, state)
        /** Whether the plane recorded a PASS for this loop. */
        let approved = false
        /** The last refusal text the consult produced. */
        let refusal = "the verifier recorded no PASS"
        for (let attempt = 0; attempt <= maxReReviews; attempt++) {
          /** The verification consult's report. */
          const report = await consult(ROLE_REVIEWER, verifyTask(verifyLoopId, objective))
          // The verdict comes from the RECORD, never from the child's word: a claimed PASS with no record
          // is exactly the second ledger this wave deletes.
          if (report !== null && recommendationVerdict(report.recommendation) === "PASS" && verifyPassRecorded(workspace, verifyLoopId)) { approved = true; break }
          refusal = report?.summary || report?.details || refusal
          for (const entry of report?.evidence ?? []) {
            evidence.push(entry)
            /** The criterion this finding attributes to. */
            const attribution = evidenceAttribution(entry)
            if (attribution === undefined || !criteria.has(attribution.key)) continue
            verifyFails.set(attribution.key, (verifyFails.get(attribution.key) ?? 0) + 1)
          }
          stamp("verification", "fail", refusal)
        }
        verdict = approved ? "approve" : "reject"
        if (approved) {
          stamp("verification", "approve", "a PASS record exists for " + verifyLoopId)
        } else {
          status = "blocked"
          finalReport += "\nverify: " + refusal + " — no PASS record exists for " + verifyLoopId + ", so this run is NOT done"
        }
      }
    }
    // The boundary AFTER verification: S7 (repeated per-criterion FAILs) becomes observable here.
    if (status !== "escalated" && await considerEscalation(status)) status = "escalated"
  } else {
    stamp("verification", "skipped", "the round phase did not reach a complete state")
  }

  // ── PHASE 5: the final quality gate ────────────────────────────────────────
  if (status === "complete") {
    // Three INDEPENDENT lane reviews, one Reviewer consult each; a FAIL lane blocks the run.
    const reviews = await Promise.all(QUALITY_LANES.map((lane) => consult(ROLE_REVIEWER, [
      "Judge ONE quality-gate lane of this autoproject run: " + lane + ".",
      "Work hands-on where the lane allows it; do not modify the implementation.",
      "Put the FIRST line of `recommendation` as `VERDICT: PASS` or `VERDICT: FAIL`, and the evidence in `summary`.",
      "Objective: " + objective,
      ...(planFile === null ? [] : ["Plan file: " + planFile]),
      "Rounds:",
      recap.join("\n"),
    ].join("\n"))))
    gateLedger = QUALITY_LANES.map((lane, index) => {
      /** This lane's consult report. */
      const report = reviews[index] ?? null
      // An unreadable or failed lane answers FAIL: the gate may never pass on a missing opinion.
      return { lane, verdict: recommendationVerdict(report?.recommendation ?? "") === "PASS" ? "PASS" : "FAIL", evidence: report?.summary || report?.details || "no report" }
    })
    for (const row of gateLedger) stamp("quality-" + row.lane, row.verdict, row.evidence)
    if (gateLedger.some((row) => row.verdict === "FAIL")) { status = "blocked"; finalReport += "\nquality gate: a lane FAILED" }
  }

  // ── PHASE 6: close the durable ledger and the goal ─────────────────────────
  // Only a COMPLETED run closes its boulder work: an escalated or blocked run's work is still open work.
  if (boulderWorkId !== null && status === "complete") await boulderComplete(dsh, exec, boulderWorkId)
  // A KILLED CHILD IS A BLOCKED RUN: the run may never report `complete` — or leave a reader thinking
  // something is still running — when a child was cut off at its bound. An ESCALATED run keeps its
  // hand-off word (a hand-off is not a claim that the work finished) and the artifact still carries the
  // killed list; every other status becomes `blocked`.
  if (killed.length > 0) {
    finalReport += "\nslots: " + String(killed.length) + " child(ren) killed at the " + String(slotBoundMs) + " ms bound (" + killed.map((kill) => kill.role + "@" + String(kill.elapsedMs) + "ms round " + String(kill.round)).join(", ") + ")"
    if (status !== "escalated") status = "blocked"
  }
  state.status = status
  state.verdict = verdict
  state.criteria = [...criteria.values()]
  writeJson(stateFile, state)
  if (finalReport === "") finalReport = status
  // The goal's fate follows the run's: `max-rounds` and `escalated` deliberately leave it ARMED.
  await finishGoal(deps, exec, status, finalReport.trim().slice(-400))
  return { status, rounds: used, ...(planFile === null ? {} : { planFile }), verdict, ledger: gateLedger, finalReport, stateFile }
}

/**
 * Whether every accumulated criterion is satisfied.
 *
 * @param criteria - the run's criteria accumulator.
 * @returns true only when at least one criterion exists and all of them are `clean`.
 */
function allClean(criteria: Map<string, RunCriterion>): boolean {
  if (criteria.size === 0) return false
  for (const criterion of criteria.values()) if (criterion.state !== "clean") return false
  return true
}

/**
 * ONE value from the live `mpd.jsonc` layer, read PER CALL.
 *
 * @param ctx - the host context; `mpdConfig` is absent in a composition without the config row.
 * @param key - the dotted key, e.g. `autoproject.escalate.mode`.
 * @returns the live value, or undefined so the row layer (then the default) applies.
 */
function liveConfigValue(ctx: EngineCtx, key: string): unknown {
  try {
    /** The live config service. */
    const service = ctx.get?.("mpdConfig", false) as { get?: (k: string) => unknown } | undefined
    return service?.get?.(key)
  } catch {
    return undefined
  }
}
