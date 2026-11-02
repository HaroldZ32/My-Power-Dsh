// mpd-autoproject-plugin: the ROW of the autoproject discipline — the automated MPD session — plus the
// MERGED boulder durable work-state machine (`src/boulder/**`, six `mpd_boulder_*` tools whose names,
// parameters, returns and `.mpd/boulder.json` ledger are unchanged by the merge).
//
// THE SPLIT (wave W1-B2): this entry registers the SURFACE — the ONE `/autoproject` command, the
// gesture listener and the `mpd_autoproject` tool — and the mechanical team gate that runs before the
// activation directive is injected. The RUN itself lives in `./engine.ts`, the two prompt texts in
// `./directive.ts` and the one independent decision (over-limit escalation) in `./escalation.ts`.
// The run routes EVERY child through `mpd_role_spawn`, verifies through the `mpd_verify_*` plane and
// drives the boulder ledger: this package no longer owns a persona table, a provider/model override or
// a second verdict ledger.
//
// The activation policy is BOUNDED, not blank: the head names exactly three decision points a human
// owns (an `ask`-mode escalation, a missing credential/external capability, a write that would leave
// the declared scope) and every blanket "ask nothing" clause is gone.
//
// Provenance: the discipline's SHAPE is upstream's — it is re-expressed from the documented upstream
// ultrawork discipline (base 8c57e46) — while the WORDING shipped here is OURS. No upstream prompt,
// policy or error text was found or copied. UN-DIFFED RESIDUAL, stated rather than smoothed over:
// four clauses could NOT be compared against any upstream text — the PIN -> RED -> GREEN -> SURFACE ->
// CLEAN ladder, the stop-after-2-fruitless-discovery-waves rule, the subagent barrier, and
// evidence-never-suppressed. They are ours in wording; that they are upstream's in intent is UNPROVEN.
import { applyBoulder } from "./boulder/index.ts"
// THE PROMPT TEXTS and THE ENGINE live in their own modules; this entry keeps the row's registration,
// the mechanical team gate, the command and the gesture, and re-exports the activation directive so
// every existing importer (and the QA probes) keep resolving it from the package entry.
import { AUTOPROJECT_ACTIVATION_DIRECTIVE } from "./directive.ts"
import { runAutoproject, type AutoprojectConfig } from "./engine.ts"
import { DSH_SEAM_SUBAGENTS, DSH_SEAM_TOOLS, dshSeamInject, type DshCommandInvocation, textBlock, resolveDshAdapter } from "../../mpd-dsh-adapter-plugin/src/index"
// THE ONE COMPLEXITY PREDICATE AND THE ONE PLAN VOCABULARY — imported, never re-derived. The module
// is PURE and node-resolvable by construction (`node:fs/promises` + `node:path` only, no adapter
// import), so the `/autoproject` gate and the session-start gate can never drift into two predicates, and a
// reader sees ONE set of thresholds. The plan phrases (`agent_teams_plan`, add_member / create_task /
// approve, "NO team was staged") come from here too, so the two gates speak one vocabulary.
import {
  ALREADY_STAGED_PLAN_PHRASE,
  BOULDER_DIR_CONFIG_KEY,
  consumeExplicitFlag,
  evaluateComplexityGate,
  GATE_CONFIG_KEY,
  GATE_MODE_MECHANICAL,
  GATE_MODE_OFF,
  gatePlanShell,
  INERT_PLAN_PHRASE,
  NO_TEAM_STAGED_PHRASE,
  PLAN_EXTEND_ACTIONS,
  readBoulderGate,
  readWorkspaceScale,
  resolveGateMode,
  resolveSensitivity,
  SENSITIVITY_CONFIG_KEY,
  SENSITIVITY_THRESHOLDS,
  STAGED_PLAN_PHRASE,
  STAGING_TOOL_NAME,
  type GateMode,
} from "../../mpd-roles-plugin/src/complexity-gate.ts"

/** The plugin name; the bundle patch row id is `mpd-autoproject`. */
export const name = "mpd-autoproject"
/**
 * Both declared seams, named by their adapter constants: the row registers tools on `DSH_SEAM_TOOLS`, and
 * `DSH_SEAM_SUBAGENTS` stays declared because the row's composition contract names it — nothing in the
 * package CALLS it any more: since wave W1-B2 every child is raised through `mpd_role_spawn`, and the
 * subagent seam is reached only by the adapter, on the roster row's behalf.
 */
export const inject = dshSeamInject(DSH_SEAM_TOOLS, DSH_SEAM_SUBAGENTS)

/** The host context this row reads; the adapter owns the real seam surface. */
type Ctx = { tools: any; subagents: any; get?: (k: string, strict?: boolean) => any; [k: string]: any }
/** The row config: the engine's own keys plus the two blocks the mechanical team gate resolves here. */
type Config = AutoprojectConfig & {
  /** The `team.gate` / `team.sensitivity` row layer, below the live `mpd.jsonc` layer. */
  team?: { gate?: unknown; sensitivity?: unknown }
  /** The `boulder.dir` row layer, below the live `mpd.jsonc` layer. */
  boulder?: { dir?: unknown }
}

/**
 * The durable-goal bridge is the `mpdGoal` SERVICE, consumed by the engine module through the same
 * structural description (`./engine.ts`, `GoalBridge`). This entry no longer touches the goal plane at
 * all: anchoring and finishing belong to the run, and the run lives in the engine.
 */

/** Merge the row config with the mpdConfig runtime layer (mpd.jsonc wins per key). */
function mergedConfig(ctx: Ctx, config: Config): Config {
  // The mpdConfig service, absent in a composition that does not mount it.
  const svc = ctx.get?.("mpdConfig") as { get: (k?: string) => any } | undefined
  if (!svc?.get) return config
  // Read one dotted config key from that service.
  const v = (k: string): ReturnType<NonNullable<typeof svc>["get"]> => svc.get(k)
  return {
    ...config,
    maxRounds: typeof v("autoproject.maxRounds") === "number" ? v("autoproject.maxRounds") : config.maxRounds,
    planDir: typeof v("autoproject.planDir") === "string" ? v("autoproject.planDir") : config.planDir,
    stateDir: typeof v("autoproject.stateDir") === "string" ? v("autoproject.stateDir") : config.stateDir,
    maxReReviews: typeof v("autoproject.maxReReviews") === "number" ? v("autoproject.maxReReviews") : config.maxReReviews,
  }
}

// THE PROMPT TEXTS AND THE ROLE TABLE ARE GONE FROM THIS FILE (wave W1-B2).
//
// The deleted constants — `REPORT_SCHEMA`, `CRITERIA_STATES`, `PERSONAS`, `ADVERSARIAL_CATEGORIES` and
// the standalone `DIRECTIVE` — were the engine's OWN parallel policy: a private report schema, a private
// set of role prompts and a private persona table. They are replaced by:
//   * `./directive.ts`, which carries the child DIRECTIVE (pointing at MPD's toolchain) and the
//     activation head, whose angles are `AdversarialAngle` entries (an ANGLE id, never a persona);
//   * the roster's fixed report (`mpd_role_spawn`'s own `REPORT_SCHEMA`), which the engine consumes
//     field by field in `./engine.ts` — this package no longer declares a second one.
export { AUTOPROJECT_ACTIVATION_DIRECTIVE } from "./directive.ts"

// THE ACTIVATION DIRECTIVE ITSELF LIVES IN `./directive.ts` (imported above and re-exported from
// the package entry), together with the child DIRECTIVE. Keeping the two texts in one place is what
// stops the autonomy clauses from being folded into the child policy: the session-start gate never
// qualifies a child session, so a team-autonomy clause in a child prompt would instruct a subagent to
// do what the platform forbids.

/**
 * The activation directive for one objective: stable policy head, then the two mutable parts.
 *
 * Byte-stability of the HEAD is the DeepSeek V4 prefix-cache property this file documents: the
 * returned text STARTS with {@link AUTOPROJECT_ACTIVATION_DIRECTIVE} byte-for-byte, whatever the objective
 * and whatever the gate did. The objective comes next (the callers pass the objective with the
 * explicit `team:` / `!team` marker already consumed) and the gate's verdict is a TRAILING block,
 * so a verdict can never invalidate the cached head.
 *
 * @param objective - the run's objective, echoed verbatim after `OBJECTIVE: `.
 * @param gate - what the autoproject team gate did for this activation; omitted, the directive is head +
 *   objective exactly as before the gate existed.
 * @returns the directive text injected as the invoking agent's own next user turn.
 */
export function activationDirective(objective: string, gate?: AutoprojectGateReport): string {
  /** The head plus the objective, which is the whole directive when no gate verdict is passed. */
  const base = AUTOPROJECT_ACTIVATION_DIRECTIVE + String.fromCharCode(10, 10) + "OBJECTIVE: " + String(objective ?? "").trim()
  return gate === undefined ? base : base + String.fromCharCode(10, 10) + gateTrailerText(gate)
}


// THE RUN'S ROOTS AND ITS STATE DOCUMENT MOVED TO `./engine.ts` WITH THE RUN ITSELF. Both roots stay
// resolved PER CALL there (never an apply-time const), because one host serves many sessions with
// different workspaces.

/** The concatenated text of one message's text blocks (undefined when it carries none). */
function messageText(message: any): string | undefined {
  if (!Array.isArray(message?.content)) return undefined
  // The message's text blocks, concatenated below.
  const parts = message.content.filter((block: any) => block?.type === "text" && typeof block.text === "string").map((block: any) => block.text)
  return parts.length === 0 ? undefined : parts.join(String.fromCharCode(10))
}

/** The autoproject gesture, anchored at the START of a message's text: `/autoproject …` or `/autoproject …`. */
const GESTURE_PATTERN = /^\/autoproject(?:[\t\n\r ]+|$)/u

/**
 * Claim the autoproject gesture from a pre-step batch. EVERY user-role message is scanned, never
 * just the last one: this bundle's composition appends user-role notices AFTER the user's
 * own prompt (the runtime-context notice and the `<system-reminder>` skill catalog), so
 * "the last user-role message" is a notice and an anchored gesture would never be seen —
 * the t15 defect, measured on a real boot whose session log held the raw `/autoproject …` prompt
 * and zero rewrites. A notice can only claim the gesture by literally opening with it.
 * @returns the claiming message, its text, and the anchored match, or undefined.
 */
function claimGesture(messages: any): { message: any; text: string; match: RegExpExecArray } | undefined {
  if (!Array.isArray(messages)) return undefined
  for (const message of messages) {
    if (message?.role !== "user") continue
    // The message's text, absent when it carries no text block.
    const text = messageText(message)
    if (text === undefined) continue
    // The anchored gesture match, or null for a message that does not open with one.
    const match = GESTURE_PATTERN.exec(text.trim())
    if (match !== null) return { message, text, match }
  }
  return undefined
}

/**
 * A copy of `message` whose FIRST text block carries `text`. The message identity
 * (id, role, source) is preserved, mirroring the adopted plugin's marker-consumption
 * rewrite (`consumeFlagFromMessage`: only text blocks change), and the objective
 * survives inside `text`.
 */
function rewriteMessageText(message: any, text: string): any {
  // The message's content blocks; a non-array reads as empty.
  const content = Array.isArray(message?.content) ? message.content : []
  // Index of the first text block, -1 when the message carries none.
  const at = content.findIndex((block: any) => block?.type === "text")
  if (at < 0) return message
  return { ...message, content: content.map((block: any, index: number) => (index === at ? { ...block, text } : block)) }
}

// ── THE autoproject TEAM GATE: the SAME predicate and the SAME modes, evaluated MECHANICALLY ────────
//
// WHY (user mandate, 2026-10-06): the activation directive used to ORDER THE MODEL to evaluate the
// session-start complexity predicate and to stage a team. Both were PROSE, so "the gate" was
// whatever the model decided. It is now mechanical, exactly like the session-start gate: THIS
// PLUGIN evaluates the frozen predicate (imported, never re-derived) over the OBJECTIVE, once per
// activation, and in `mechanical` mode stages the plan itself through OUR `agent_teams_plan` tool
// with the LIVE agent. The verdict is rendered into the directive's TRAILING block.
//
// THE HONEST BOUND: the gate fills the plan's `name`/`description` and NOTHING else — 0 members,
// 0 tasks. It never selects a roster (keyword->specialist guessing is the "invent a team" defect
// the manual forbids) and it never claims a team exists: a staged plan is INERT until approved.
//
// The mode (`team.gate`: mechanical default / advisory / off) is resolved PER CALL from the live
// `mpd.jsonc` layer and never cached, and EVERY degradation of the staging route is reported as
// such in the trailing block instead of being hidden.

/** The `mpd-config` service name: the live `mpd.jsonc` layer the gate reads its mode from. */
const CONFIG_SERVICE = "mpdConfig"
/** The `mpd-team-core` service name: the staged-plan probe reads `planFor` from it. */
const TEAMS_SERVICE = "mpdTeams"
/** How long ONE autoproject staging call may take before the mechanical route degrades, in milliseconds. */
const AUTOPROJECT_STAGING_TIMEOUT_MS = 5000

/** What ONE autoproject activation's gate did, in the shape the directive's trailing block renders. */
export interface AutoprojectGateReport {
  /** The `team.gate` mode resolved for THIS activation, never cached across activations. */
  mode: GateMode
  /** Whether the frozen predicate fired; always false for `off`, which never evaluates it. */
  trigger: boolean
  /** The fired signal letters, in A–D order, as the predicate reported them. */
  signals: readonly string[]
  /** Whether an explicit `team:` / `!team` marker was consumed from the objective. */
  explicit: boolean
  /** Whether a plan is staged in this session as a result of this activation. */
  staged: boolean
  /** The plan id the staging CALL returned — never an invented one; empty when it reported none. */
  planId: string
  /** Whether staging was SKIPPED because this session already had a plan. */
  alreadyStaged: boolean
  /** Why the gate could not stage (or could not run at all), when it could not. */
  error?: string
}

/** The outcome of ONE mechanical autoproject staging attempt. */
interface AutoprojectStageOutcome {
  /** Whether a plan is staged in this session as a result of the attempt. */
  staged: boolean
  /** The plan id the CALL returned, or the empty string when it reported none. */
  planId: string
  /** Whether staging was SKIPPED because this session already had a plan. */
  alreadyStaged: boolean
  /** Why the attempt degraded instead of staging, when it did. */
  error?: string
}

/**
 * The adapter slice the autoproject team gate uses, declared structurally.
 *
 * `hasTool` takes the agent on purpose: the adapter's read is SCOPE-AWARE, so a tool registered on
 * the agent's own plane (or its preset parent) is found for the agent that will call it. The
 * optional `rowLog` keeps a unit double without a log sink acceptable.
 */
interface AutoprojectGateAdapter {
  /** Whether a tool is registered in this agent's own view (host-plane global when agentless). */
  hasTool(name: string, agent?: unknown): boolean
  /** The internal tool call, normalized by the adapter to `{ok, isError, value, error}`. */
  executeTool(input: { name: string; arguments?: unknown; agent?: unknown; timeoutMs?: number }): Promise<{ ok?: unknown; isError?: unknown; value?: unknown; error?: unknown }>
  /** The calling session's workspace root, resolved PER CALL. */
  workspaceRoot(exec?: unknown): string
  /** One-line diagnostics sink, absent in a partial double. */
  rowLog?(name: string, line: string): void
}

/**
 * ONE team-plane config value for ONE key, resolved PER CALL and never cached.
 *
 * Precedence, identical to the session-start gate's: the mounted `mpdConfig` layer (a
 * `.mpd/mpd.jsonc` edit is therefore picked up LIVE, T-18) first, this row's own config second,
 * `undefined` last so the caller's default applies.
 *
 * @param ctx - the host context; its `get` may be absent in a unit double.
 * @param config - the row config handed to `apply`.
 * @param key - the dot-path key, e.g. `team.gate`, `team.sensitivity` or `boulder.dir`.
 * @returns the raw value, or `undefined` when neither layer declares it.
 */
function gateConfigValue(ctx: Ctx, config: Config, key: string): unknown {
  try {
    /** The live config service, absent until the `mpd-config` row has applied. */
    const live = ctx.get?.(CONFIG_SERVICE, false) as { get?: (k: string) => unknown } | undefined
    /** The live layer's answer, which wins whenever the key is really declared there. */
    const value = live?.get?.(key)
    if (value !== undefined) return value
  } catch {
    // A config layer that refuses the lookup reads as ABSENT, which keeps the gate's default in force.
  }
  if (key === GATE_CONFIG_KEY) return config.team?.gate
  if (key === SENSITIVITY_CONFIG_KEY) return config.team?.sensitivity
  if (key === BOULDER_DIR_CONFIG_KEY) return config.boulder?.dir
  return undefined
}

/**
 * The session id of one live agent, or the empty string when it carries none.
 *
 * @param agent - the agent handle, in any of the three shapes a session id is spelled in.
 * @returns the id, or `""` when the handle declares none.
 */
function sessionIdOf(agent: unknown): string {
  /** The agent handle, narrowed to the three shapes a session id is spelled in. */
  const handle = agent as { session?: { id?: unknown }; sessionId?: unknown; id?: unknown } | undefined
  /** The id candidates in precedence order: the session, the flat field, then the agent id. */
  const candidates: unknown[] = [handle?.session?.id, handle?.sessionId, handle?.id]
  for (const candidate of candidates) if (typeof candidate === "string" && candidate !== "") return candidate
  return ""
}

/**
 * The plan id inside one plan-shaped payload, read defensively; empty when unreadable.
 *
 * TWO SHAPES reach this reader and both are documented: the TOOL RESULT wraps the plan
 * (`{plan:{planId}}`, the `create` action's return) while the STAGED-PLAN PROBE returns the plan
 * itself (`{planId}`, `mpdTeams.planFor(...).plan`). Neither is ever invented here — an unreadable
 * payload reads as the empty string, which the trailing block renders as "not reported by the call".
 *
 * @param value - the payload to read.
 * @returns the plan id, or `""` when the payload carries none.
 */
function planIdOf(value: unknown): string {
  /** The id on the payload itself, which is what the staged-plan probe answers. */
  const direct = (value as { planId?: unknown } | undefined)?.planId
  if (typeof direct === "string" && direct !== "") return direct
  /** The plan record the `create` action wrapped, when the payload carries one. */
  const plan = (value as { plan?: { planId?: unknown } } | undefined)?.plan
  return typeof plan?.planId === "string" ? plan.planId : ""
}

/**
 * A thrown value reduced to printable text: its `message` when it carries one, else the value.
 *
 * @param error - the thrown value, of any type.
 * @returns the printable one-line text.
 */
function errorText(error: unknown): string {
  /** The thrown value's own message, read through a one-property view because it is `unknown`. */
  const message = (error as { message?: unknown } | undefined)?.message
  return message === undefined ? String(error) : String(message)
}

/**
 * The session workspace the boulder probe reads and the staging call writes under, resolved PER CALL.
 *
 * The adapter's resolver prefers the session header's `cwd`, then `DSH_WORKSPACE_ROOT`, then the
 * process cwd, so an agentless step (a gesture whose payload carries no agent) still resolves the
 * documented fallback instead of being guessed at here.
 *
 * @param dsh - the adapter slice.
 * @param agent - the live agent, when the caller holds one.
 * @returns the workspace, or `""` when the resolver itself is absent (the boulder read then answers
 *   `active:false`, the conservative reading).
 */
function autoprojectWorkspace(dsh: AutoprojectGateAdapter, agent: unknown): string {
  try {
    return typeof dsh.workspaceRoot === "function" ? dsh.workspaceRoot({ agent }) : ""
  } catch {
    return ""
  }
}

/**
 * Whether a plan is ALREADY staged for one session, read PER CALL through the team record service.
 *
 * A non-null answer SKIPS staging: the tool's `create` ARCHIVES an existing un-approved plan, so
 * staging twice would destroy the captain's in-progress plan. The lookup is lazy because the
 * `mpd-team-core` row may compose AFTER this one.
 *
 * @param ctx - the host context; the `mpdTeams` service is absent without that row.
 * @param workspace - the session workspace the plan belongs to.
 * @param sessionId - the session the plan belongs to.
 * @returns the staged plan (or `undefined`), never a throw.
 */
function stagedPlanOf(ctx: Ctx, workspace: string, sessionId: string): unknown {
  try {
    /** The team record service, absent in a composition without the `mpd-team-core` row. */
    const teams = ctx.get?.(TEAMS_SERVICE, false) as { planFor?: (w: string, s: string) => { plan?: unknown } } | undefined
    return teams?.planFor?.(workspace, sessionId)?.plan
  } catch {
    // A service that refuses the read reads as "nothing staged", which merely re-stages.
    return undefined
  }
}

/**
 * Whether the staging tool is registered in this agent's own view.
 *
 * A missing `hasTool` seam (a partial adapter double) reads FALSE — the ladder's degrade step,
 * never a throw. WITH an agent the read is scoped to that agent (which also resolves the PRESET
 * plane); an agentless step keeps the deliberate host-plane global read.
 *
 * @param dsh - the adapter slice.
 * @param agent - the live agent whose scope the read resolves through, when one is held.
 * @returns true only when the adapter answered positively.
 */
function hasStagingTool(dsh: AutoprojectGateAdapter, agent: unknown): boolean {
  if (typeof dsh.hasTool !== "function") return false
  try {
    return agent === undefined || agent === null ? dsh.hasTool(STAGING_TOOL_NAME) === true : dsh.hasTool(STAGING_TOOL_NAME, agent) === true
  } catch {
    return false
  }
}

/**
 * Run the lazy staging ladder for ONE autoproject activation — nothing is resolved at apply time, so the
 * row order (`mpd-autoproject` composing before `mpd-team-core`) stays irrelevant.
 *
 * Ladder, in order: an already-staged plan WINS (staging again would archive it); a tool absent
 * from the agent's view degrades; a refused, thrown or timed-out call degrades. Every degradation
 * is REPORTED by the caller, never silently swallowed.
 *
 * @param dsh - the adapter slice (`hasTool` / `executeTool` / `rowLog`).
 * @param ctx - the host context, for the already-staged probe.
 * @param input - the live agent, its workspace/session, the consumed objective and the verdict.
 * @returns what happened, never a throw.
 */
async function stageAutoprojectPlan(dsh: AutoprojectGateAdapter, ctx: Ctx, input: {
  /** The LIVE agent the call is attributed to; the tool resolves session and workspace from it. */
  agent: unknown
  /** The session workspace, used for the idempotence probe. */
  workspace: string
  /** The session the staging call is attributed to. */
  sessionId: string
  /** The objective with the explicit marker already consumed. */
  objective: string
  /** The fired signal letters, inlined into the staged shell's description. */
  signals: readonly string[]
  /** The active work's plan path, echoed into the description when signal D fired. */
  planPath?: string
}): Promise<AutoprojectStageOutcome> {
  // (1) A plan is ALREADY staged for this session: `create` ARCHIVES it, so this activation must not stage.
  /** The plan already staged for this session, as the team record reports it. */
  const existing = stagedPlanOf(ctx, input.workspace, input.sessionId)
  if (existing !== undefined && existing !== null) return { staged: true, planId: planIdOf(existing), alreadyStaged: true }
  // (2) The tool is not registered in this agent's view (another preset, a boot without
  //     mpd-team-core): the mechanical route is impossible, so the caller says so honestly.
  if (!hasStagingTool(dsh, input.agent)) return { staged: false, planId: "", alreadyStaged: false, error: "tool " + STAGING_TOOL_NAME + " is not registered" }
  try {
    /** The gate-filled fields — a SHELL, never a decomposed team. */
    const shell = gatePlanShell({
      signals: input.signals,
      goal: input.objective,
      ...(input.planPath === undefined ? {} : { planPath: input.planPath }),
    })
    /** The tool result, normalized by the adapter (`{ok, isError, value, error}`). */
    const result = await dsh.executeTool({
      name: STAGING_TOOL_NAME,
      // `approval:"automatic"` is a LABEL with no consumer in this codebase (verified: the plan store
      // records it and nothing reads it). A autoproject run asks the user nothing, so the RUN approves the
      // plan itself — that approval, not this label, is what spawns the members.
      arguments: { action: "create", name: shell.name, description: shell.description, approval: "automatic" },
      // THE LIVE AGENT, never a fabricated `{session:{id}}` stand-in: the tool resolves the workspace
      // and the session FROM this handle, and a stand-in is what breaks the approval hop.
      agent: input.agent,
      timeoutMs: AUTOPROJECT_STAGING_TIMEOUT_MS,
    })
    if (result?.ok !== true || result.isError === true) {
      return { staged: false, planId: "", alreadyStaged: false, error: result?.error === undefined ? "the staging call did not report ok" : String(result.error) }
    }
    return { staged: true, planId: planIdOf(result.value), alreadyStaged: false }
  } catch (error) {
    return { staged: false, planId: "", alreadyStaged: false, error: errorText(error) }
  }
}

/**
 * Evaluate the frozen complexity predicate ONCE for ONE activation and, in `mechanical` mode, stage
 * the plan. The objective's explicit `team:` / `!team` marker is CONSUMED here, so both the
 * directive and the staged shell carry the objective without it (the session gate consumes it the
 * same way from the goal).
 *
 * @param dsh - the adapter slice.
 * @param ctx - the host context, for the per-call config layer and the staged-plan probe.
 * @param config - the row config, the second config layer.
 * @param input - the activation's objective and the agent the command/step carries (may be absent
 *   on a gesture step, which then degrades honestly instead of staging through a stand-in).
 * @returns the flag-consumed objective plus what the gate did, never a throw.
 */
async function evaluateAutoprojectGate(dsh: AutoprojectGateAdapter, ctx: Ctx, config: Config, input: { objective: string; agent: unknown }): Promise<{ objective: string; report: AutoprojectGateReport }> {
  /** The objective with the explicit marker removed, plus whether it was there. */
  const consumed = consumeExplicitFlag(input.objective)
  /** The objective the directive and the staged shell carry, whitespace-trimmed. */
  const objective = consumed.text.trim()
  // THE MODE IS RESOLVED PER CALL (never cached): a `.mpd/mpd.jsonc` edit takes effect on the next
  // activation, and `off` returns BEFORE the predicate is even evaluated.
  const mode: GateMode = resolveGateMode(gateConfigValue(ctx, config, GATE_CONFIG_KEY))
  if (mode === GATE_MODE_OFF) {
    return { objective, report: { mode, trigger: false, signals: [], explicit: consumed.flagged, staged: false, planId: "", alreadyStaged: false } }
  }
  try {
    /** The workspace the boulder probe reads and the staging call writes under. */
    const workspace = autoprojectWorkspace(dsh, input.agent)
    /** Signal D's state root, resolved PER CALL from `boulder.dir` (never cached). */
    const boulderDir = gateConfigValue(ctx, config, BOULDER_DIR_CONFIG_KEY)
    // THE THRESHOLD ROW IS THE SESSION GATE'S (repair 2026-10-22): the SAME predicate must read the
    // SAME row, so `team.sensitivity` resolves PER CALL through this row's existing precedence — the
    // mounted `mpdConfig` layer first, the row config second, `easy` for an absent/unknown value.
    // Before this, the autoproject gate always ran the eager default while the session-start gate honoured
    // the configured row, so one session could judge the same objective two different ways.
    /** The threshold row this activation's predicate reads. */
    const sensitivity = resolveSensitivity(gateConfigValue(ctx, config, SENSITIVITY_CONFIG_KEY))
    /** What the workspace's boulder ledger says about an ACTIVE work (never throws). */
    const boulder = await readBoulderGate(workspace, typeof boulderDir === "string" && boulderDir !== "" ? { boulderDir } : {})
    // SIGNAL F IS THE SESSION GATE'S TOO (repair 2026-10-22): the SAME bounded root listing, paid for
    // ONLY on a row that evaluates F (`easy`), so `normal`/`strict` behaviour is byte-identical and
    // never touches the filesystem here. `readWorkspaceScale` is non-throwing by contract.
    /** Whether the workspace looks like a large project — signal F's input. */
    const workspaceScale = SENSITIVITY_THRESHOLDS[sensitivity].workspaceScale ? await readWorkspaceScale(workspace) : false
    /** The frozen predicate's answer: whether it triggered, and which signals fired. */
    const verdict = evaluateComplexityGate(objective, { explicitFlag: consumed.flagged, activeBoulder: boulder.active, sensitivity, workspaceScale })
    /** The report this activation renders before the mechanical route fills in its outcome. */
    const base: AutoprojectGateReport = { mode, trigger: verdict.trigger === true, signals: verdict.signals, explicit: consumed.flagged, staged: false, planId: "", alreadyStaged: false }
    // NOTHING FIRED, or the gate is ADVISORY: nothing is staged, and the trailing block says so.
    if (verdict.trigger !== true || mode !== GATE_MODE_MECHANICAL) return { objective, report: base }
    // AN AGENTLESS STEP cannot stage: the tool resolves the workspace and the session from a LIVE
    // agent, and a hand-built stand-in is exactly what breaks the approval hop.
    if (input.agent === undefined || input.agent === null) {
      dsh.rowLog?.("mpd-autoproject", "team gate: the predicate fired (" + verdict.signals.join("/") + ") but this step carries no live agent to stage for")
      return { objective, report: { ...base, error: "the step carries no live agent to stage the plan for" } }
    }
    /** What the mechanical route did. */
    const outcome = await stageAutoprojectPlan(dsh, ctx, {
      agent: input.agent,
      workspace,
      sessionId: sessionIdOf(input.agent),
      objective,
      signals: verdict.signals,
      ...(boulder.planPath === undefined ? {} : { planPath: boulder.planPath }),
    })
    if (!outcome.staged) dsh.rowLog?.("mpd-autoproject", "team gate: staging degraded for \"" + objective.slice(0, 60) + "\" (" + String(outcome.error) + ") — the directive reports it")
    else dsh.rowLog?.("mpd-autoproject", "team gate: plan staged signals=" + verdict.signals.join("/") + " plan=" + (outcome.planId === "" ? "(id not reported)" : outcome.planId))
    return { objective, report: { ...base, staged: outcome.staged, planId: outcome.planId, alreadyStaged: outcome.alreadyStaged, ...(outcome.error === undefined ? {} : { error: outcome.error }) } }
  } catch (error) {
    // A gate failure never breaks an activation: the directive is injected with an HONEST degraded
    // report instead of a claimed staged plan.
    dsh.rowLog?.("mpd-autoproject", "team gate failed (" + errorText(error) + ") — the directive reports an unevaluated gate")
    return { objective, report: { mode, trigger: false, signals: [], explicit: consumed.flagged, staged: false, planId: "", alreadyStaged: false, error: errorText(error) } }
  }
}

/**
 * The autoproject team gate's TRAILING block — what the gate did, rendered after the objective.
 *
 * Kept OUT of {@link AUTOPROJECT_ACTIVATION_DIRECTIVE} on purpose: the head must stay a byte-stable prefix
 * so the DeepSeek V4 prefix cache still holds, so every verdict-dependent byte lives here. Wording
 * rules the block obeys: a staged plan is never called a team, a degraded route says the gate FIRED
 * and nothing was staged, and the plan vocabulary (`agent_teams_plan`, add_member / create_task /
 * approve) comes from the SAME shared constants the session-start gate uses.
 *
 * @param report - what the gate did for this activation.
 * @returns the block's text, never empty, never claiming a team exists before approval.
 */
export function gateTrailerText(report: AutoprojectGateReport): string {
  /** The fired signals as a readable list, or the generic wording when none is named. */
  const matched = report.signals.length === 0 ? "complexity signals" : "complexity signals " + report.signals.join("/")
  /** The id sentence: the returned id, or an explicit statement that the call reported none. */
  const id = report.planId === "" ? "(plan id not reported by the call)" : report.planId
  /** How to extend a staged plan — the two actions, on OUR plane. */
  const extend = "`" + STAGING_TOOL_NAME + " {action:\"" + PLAN_EXTEND_ACTIONS[0] + "\"}` (each member's prompt comes from `mpd_role_persona`) and `" + STAGING_TOOL_NAME + " {action:\"" + PLAN_EXTEND_ACTIONS[1] + "\"}`"
  /** The self-approval, which is what actually spawns the members and posts the tasks. */
  const approve = "approve it YOURSELF with `" + STAGING_TOOL_NAME + " {action:\"approve\"}` ONLY when the write scope is inside the declared scope AND the gate verdict is mechanical; otherwise ask ONE `ask_user_question`"
  /** How to stage a plan from scratch, for the routes that could not stage one. */
  const create = "stage the plan with `" + STAGING_TOOL_NAME + " {action:\"create\"}`, extend it with " + extend + ", then " + approve
  if (report.mode === GATE_MODE_OFF) {
    return "TEAM GATE: OFF (" + GATE_CONFIG_KEY + "=off) — the predicate was not evaluated and " + NO_TEAM_STAGED_PHRASE + "."
  }
  if (report.staged && report.alreadyStaged) {
    return "TEAM GATE: MECHANICAL — this objective shows " + matched + ", and " + ALREADY_STAGED_PLAN_PHRASE + ": " + id + " (0 members, 0 tasks: a SHELL, not a team)."
      + "\n- The gate did NOT stage again: a second staging would ARCHIVE the in-progress plan."
      + "\n- Extend it with " + extend + ", then " + approve + "; approval is what spawns the members and posts the tasks."
      + "\n- " + INERT_PLAN_PHRASE + " — never tell the user a team was created."
  }
  if (report.staged) {
    return "TEAM GATE: MECHANICAL — this objective shows " + matched + ", and " + STAGED_PLAN_PHRASE + ": " + id + " (0 members, 0 tasks: a SHELL, not a team)."
      + "\n- Extend it with " + extend + ", then " + approve + "; approval is what spawns the members and posts the tasks."
      + "\n- " + INERT_PLAN_PHRASE + " — never tell the user a team was created."
  }
  if (report.trigger && report.mode === GATE_MODE_MECHANICAL) {
    return "TEAM GATE: MECHANICAL — this objective shows " + matched + ", so the gate FIRED, but staging did NOT happen (" + String(report.error ?? "unknown reason") + "): " + NO_TEAM_STAGED_PHRASE + " and no plan exists for this run."
      + "\n- Continue the run; if the work warrants a team, " + create + "."
  }
  if (report.trigger) {
    return "TEAM GATE: ADVISORY (" + GATE_CONFIG_KEY + "=advisory) — this objective shows " + matched + ", and " + NO_TEAM_STAGED_PHRASE + ": the gate is ADVISORY and stages nothing."
      + "\n- Continue solo; if the work genuinely warrants a team, " + create + "."
  }
  if (report.error !== undefined) {
    return "TEAM GATE: UNEVALUATED — the gate could not run (" + report.error + "), so " + NO_TEAM_STAGED_PHRASE + "; do not assume one and do not invent a second predicate."
  }
  if (report.mode === GATE_MODE_MECHANICAL) {
    return "TEAM GATE: MECHANICAL — no complexity signal fired for this objective, and " + NO_TEAM_STAGED_PHRASE + ". Do not invent a second predicate."
  }
  return "TEAM GATE: ADVISORY (" + GATE_CONFIG_KEY + "=advisory) — no complexity signal fired for this objective, and " + NO_TEAM_STAGED_PHRASE + "."
}

/** Apply the row: register the autoproject tool, the merged boulder tools, the ONE `/autoproject` command and the gesture listener. */
export function apply(ctx: Ctx, config: Config = {}): void {
  // Every harness seam goes through the shared adapter (see packages/mpd-dsh-adapter-plugin).
  const dsh: any = resolveDshAdapter(ctx)
  // The row config with the runtime `mpd.jsonc` layer merged over it.
  const cfg = mergedConfig(ctx, config)
  // The merged boulder half: same six tools, same `.mpd/boulder.json` ledger, same params and returns.
  // It reads its own `boulder.dir` override through the same `mpdConfig` service it always did.
  applyBoulder(ctx, {})

  dsh.registerTool({
    name: "mpd_autoproject",
    description: "Run the autoproject discipline — an automated MPD session, not a parallel engine: optional adversarial hyperplan wave (Architect angles), plan gate (Planner + Plan Reviewer), execution rounds (ONE roster consult per round: Deep Worker on a heavy tier, Senior Engineer on a planned light one, Junior Engineer otherwise; per-criterion PIN->RED->GREEN->SURFACE->CLEAN; discovery stops after 2 fruitless waves), verification through the mpd_verify_* plane (a RECORDED PASS is required to report complete), the final three-lane quality gate, and the boulder ledger for plan runs. Over-limit escalation is the ONE independent decision. State + ledger under .mpd/autoproject/<id>.",
    parameters: {
      type: "object",
      properties: {
        objective: { type: "string" },
        tier: { type: "string", enum: ["light", "heavy"] },
        plan: { type: "boolean", description: "Force a plan file even in light tier" },
        hyperplan: { type: "boolean", description: "Run the 5-category adversarial review wave before planning" },
        strictReview: { type: "boolean", description: "Accepted for compatibility; verification is always required to report complete" },
        maxRounds: { type: "integer", description: "1..8, default 6" },
        scope: { type: "array", items: { type: "string" }, description: "The caller's DECLARED write scope (workspace-relative paths). When present it drives the escalation scope signal, the verify loop's authorising scope and the cellwork hand-off; when absent the engine falls back to the paths its children evidenced, and escalation.json records which (scopeSource: declared | evidence)" }
      },
      required: ["objective"],
      additionalProperties: false
    },
    output: {
      schema: { type: "object", properties: { status: { type: "string" }, rounds: { type: "integer" }, planFile: { type: "string", description: "Present only when a plan file was written (plan=true or tier=heavy); absent otherwise" }, verdict: { type: "string" }, ledger: { type: "array", items: { type: "object" } }, finalReport: { type: "string" }, stateFile: { type: "string" } }, required: ["status", "rounds", "finalReport", "stateFile"] },
      render: (_a: unknown, v: any) => textBlock("autoproject status=" + v.status + " rounds=" + v.rounds + " verdict=" + (v.verdict ?? "-") + String.fromCharCode(10) + v.finalReport + String.fromCharCode(10) + "state: " + v.stateFile)
    },
    // THE ENGINE LIVES IN `./engine.ts`: this row registers the surface, and every rule of the run —
    // roster routing, the verify plane, the boulder ledger and the one escalation decision — belongs
    // to that module. The adapter slice, the host context and the row config are handed over as-is.
    execute: async (args: any, exec: any) => runAutoproject(args, exec, { dsh, ctx, config: cfg }),
  })

  // ── clause 2: the user-invocable command, registered through the adapter ────
  // The host parses `/autoproject` down to the bare name "autoproject" and THROWS on a duplicate
  // name, so this discipline has exactly ONE spelling and ONE definition. A handler runs
  // "without sending the command to the model", so returning {kind:'success'} alone
  // would start nothing: the handler SUBMITS the activation directive as the
  // invoking agent's own next user turn, through the adapter's turn seam. Both
  // seams come from the adapter (AGENTS.md §6) — this plugin never reaches for the
  // host's command service or its agent surface itself.
  /** The usage line `/autoproject` answers for an invocation with no objective. */
  const AUTOPROJECT_USAGE = "usage: /autoproject <objective> — starts an autoproject run for that objective"
  /** The single command definition's description, rendered by the live command registry. */
  const AUTOPROJECT_COMMAND_DESCRIPTION = "Run the autoproject discipline for an objective — autonomously, except at its three decision points"
  // The `/autoproject` command handler.
  //
  // ASYNC ON PURPOSE: the autoproject team gate is MECHANICAL, so this handler evaluates the frozen
  // predicate and may stage the plan BEFORE the directive is injected — the directive's TEAM GATE
  // block reports what the call returned, so staging could not be deferred past the injection. The
  // host awaits a command handler's result (`dsh-commands` normalizes `await Promise.resolve(output)`),
  // and the staging call is bounded by `AUTOPROJECT_STAGING_TIMEOUT_MS`.
  const runAutoprojectCommand = async (invocation: DshCommandInvocation): Promise<{ kind: "error" | "success"; text: string }> => {
    // The objective from the invocation, trimmed; empty asks for the usage line.
    const objective = String(invocation?.rawInput ?? "").trim()
    if (objective === "") return { kind: "error", text: AUTOPROJECT_USAGE }
    // The mechanical gate: evaluate the SAME predicate the session-start gate uses, over THIS
    // objective, and stage the plan when it fires in `mechanical` mode. The agent the command
    // arrived on is the one the staging call must use — the tool resolves session and workspace
    // from it — and the objective comes back with the explicit `team:` / `!team` marker consumed.
    const gate = await evaluateAutoprojectGate(dsh, ctx, config, { objective, agent: invocation?.agent })
    // Whether the activation directive reached the invoking agent's own next turn.
    const submitted = invocation.submit?.(dsh.userMessage({ text: activationDirective(gate.objective, gate.report), source: { kind: "mpd-autoproject", reason: "activation-directive" } })) === true
    if (!submitted) return { kind: "error", text: "autoproject could not start: no live agent turn surface to submit the activation directive for " + JSON.stringify(gate.objective) }
    return { kind: "success", text: "autoproject activated: " + gate.objective }
  }
  // ONE registration: `/autoproject` is the only spelling the discipline has (no aliases).
  const commandDisposers = ["autoproject"].map((name) => dsh.registerCommand({ name, description: AUTOPROJECT_COMMAND_DESCRIPTION, input: { hint: "objective" }, handler: runAutoprojectCommand }))

  // ── clause 2: the plain-text gesture (headless has no command surface) ──────
  // Recognised at the plugin's own `agent/pre-step` boundary through the adapter's
  // event seam. `agent/pre-step` is a cordis WATERFALL: a listener's return value
  // REPLACES the composed step decision, so this listener delegates to `next()`
  // FIRST and then returns the (possibly rewritten) decision — never a bare value
  // (the 2026-09-16 incident: a stamp with no `messages` became the step decision
  // and killed every turn of every session; see mpd-team-watchdog-plugin engine.ts).
  // The claim scans EVERY user-role message (t15): looking only at the last one was
  // green in the one-message unit test while red on a real boot, because the
  // composition appends its own user-role notices after the prompt.
  const gestureDispose = dsh.onEvent("agent/pre-step", async (payload: any, next: any) => {
    // The step decision composed by the rest of the chain.
    const decision = typeof next === "function" ? await next() : undefined
    try {
      if (decision === undefined || decision === null || decision.kind === "reject") return decision
      // The batch's messages, taken from the decision or the payload.
      const messages = Array.isArray(decision.messages) ? decision.messages : (Array.isArray(payload?.messages) ? payload.messages : undefined)
      if (messages === undefined) return decision
      // The message that claimed the gesture, when one does.
      const claimed = claimGesture(messages)
      if (claimed === undefined) return decision
      // The objective after the gesture token.
      const objective = claimed.text.trim().slice(claimed.match[0].length).trim()
      // A bare `/autoproject` carries no objective to run. The command path answers usage;
      // a gesture has no reply surface, so the step is left untouched.
      if (objective === "") return decision
      // THE SAME MECHANICAL GATE as the command path, over the same objective, with the agent the
      // harness fused into this step's payload (a surface that carries none degrades honestly: the
      // directive then says the gate fired and nothing was staged, never that a team exists).
      const gate = await evaluateAutoprojectGate(dsh, ctx, config, { objective, agent: payload?.agent ?? decision?.agent })
      return { ...decision, messages: messages.map((message: any) => (message === claimed.message ? rewriteMessageText(message, activationDirective(gate.objective, gate.report)) : message)) }
    } catch {
      // A gesture failure must never break the step: the decision composed by
      // `next()` is returned unchanged, never a veto by accident. The gate is INSIDE this try
      // (`evaluateAutoprojectGate` is itself non-throwing), so a staging refusal can never eat a turn.
      return decision
    }
  })

  // Cordis owns teardown: hand the host disposers to the plugin's own fiber when the
  // context offers `effect`, so a teardown unregisters both command names and the
  // gesture listener (guarded like mpd-team-watchdog-plugin's install()).
  const disposers = [...commandDisposers, ...(gestureDispose === undefined ? [] : [gestureDispose])]
  if (typeof ctx.effect === "function") ctx.effect(() => () => { for (const dispose of disposers) dispose() }, "mpd-autoproject.commands")
}
