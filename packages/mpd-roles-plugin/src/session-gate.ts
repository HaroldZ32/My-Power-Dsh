// The session-start complexity gate — the WIRING half (AGENTS.md §1).
//
// The PURE half (patterns, thresholds, predicate, the boulder read, both notice builders, the mode
// resolver) lives in `./complexity-gate.ts`, which resolves under plain `node` and is what the QA
// case and the unit tests import. THIS file owns the three things that need a live harness:
//   1. ONE `agent/pre-step` listener PER QUALIFYING AGENT, registered in that agent's own scope;
//   2. the per-call config read (`team.gate`, `team.sensitivity`, `boulder.dir`) and the
//      workspace/session resolution, including signal F's bounded root listing;
//   3. the STAGING call: a triggered session stages an APPROVABLE PLAN SHELL through the
//      `agent_teams_plan` tool (mpd-team-core) — never through a hand-built `{session:{id}}` stand-in
//      for a live agent, which is exactly why the TUI's approval hop used to be broken.
//
// WHAT A TRIGGER DOES (the mode, resolved PER CALL from `team.gate`):
//   mechanical (DEFAULT) — stage the shell, then inject the MECHANICAL notice naming the id the
//                          call returned; every degradation of this route falls back to ADVISORY;
//   advisory             — today's notice, stages nothing;
//   off                  — the listener returns immediately.
//
// THE HONEST BOUND (stated so no reader over-reads the log): the gate can fill the plan's `name`,
// `description` and `approval`; the store fills `planId`/`stagedAt`/`version` and the tool fills
// `sessionId`/`workspace`. It can NOT fill `members[]`, `tasks[]`, prompts, blockers or owners — at
// the first pre-step there is no decomposition and no DAG, and keyword->specialist selection is the
// "invent a team" defect this bundle forbids. So it stages a NAMED, SIGNALLED, APPROVABLE SHELL of
// 0 members and 0 tasks, and the notice says so outright. NEVER claim a team was created.
//
// Scope: TOP-LEVEL sessions (`sessionRank === "captain"`, which includes a seeded fork the harness
// records with a parent link but delegation depth 0) whose preset is `mpd` OR absent/null. A child
// session (a recorded `origin: "subagent"` or a `delegationDepth >= 1`) never gets its own gate, and a
// session that NAMES another preset is not gated.
import type { DshAdapter, DshAgentPreStep, DshPostResult, DshPreStepDecision, DshToolExec } from "../../mpd-dsh-adapter-plugin/src/index"
import { rowLogLine } from "../../mpd-dsh-adapter-plugin/src/index"
import {
  advisoryNoticeText,
  BOULDER_DIR_CONFIG_KEY,
  consumeExplicitFlag,
  consumeFlagFromMessage,
  CONTROL_TOOL_NAME,
  DEFAULT_GATE_PRESETS,
  emptyReTeamState,
  evaluateComplexityGate,
  GATE_CONFIG_KEY,
  GATE_MODE_MECHANICAL,
  GATE_MODE_OFF,
  gatePlanShell,
  isConsultToolName,
  latestUserMessage,
  mechanicalNoticeText,
  MISSING_PLAN_ID_PHRASE,
  readBoulderGate,
  readLeadingTeam,
  readReTeamState,
  readWorkspaceScale,
  RETEAM_AFTER_CONSULTS_CONFIG_KEY,
  RETEAM_AUTO_END_REASON,
  RETEAM_ENABLED_CONFIG_KEY,
  reTeamNoticeText,
  reTeamRepairNoticeText,
  resolveBoulderDir,
  resolveGateMode,
  resolveReTeamAfterConsults,
  resolveReTeamEnabled,
  resolveSensitivity,
  SENSITIVITY_CONFIG_KEY,
  SENSITIVITY_THRESHOLDS,
  sessionQualifies,
  STAGING_TOOL_NAME,
  writeReTeamState,
  type GateMode,
  type GateSensitivity,
  type ReTeamState,
} from "./complexity-gate.ts"

/** How long ONE staging call may take before the mechanical route degrades, in milliseconds. */
const STAGING_TIMEOUT_MS = 5000

/** One-line diagnostics for a live boot, enabled with `MPD_ROLES_GATE_TRACE=1`. */
function gateTrace(line: string): void {
  try {
    if (process.env.MPD_ROLES_GATE_TRACE === "1") rowLogLine("mpd-roles", "[mpd-roles] gate trace: " + line)
  } catch { /* tracing must never take the gate down */ }
}

/**
 * The session key the STAGING STORE files one session's plan under — MIRRORED from the writer.
 *
 * `mpd-team-core-plugin`'s own `sessionIdOf(exec)` (resolved by its `where()` and used by the
 * `agent_teams_plan` tool's `create`) is the authority for this key, and this function reproduces
 * it EXACTLY: the FIRST non-nullish of `agent.session.id ?? agent.sessionId ?? agent.id`, and the
 * literal `"workspace"` when that candidate is not a non-empty string. Both quirks are load-bearing
 * — `??` stops at the first non-nullish candidate, so a NON-STRING session id falls through to
 * `"workspace"` rather than continuing down the chain, and a handle with no ids at all is filed
 * under `workspace.json`. The probe asking any other spelling (the empty string, or a continued
 * chain) reads a slot the write never touches: it answers "nothing staged" for a DIFFERENT file
 * while the write lands in this one, and the idempotence guard is structurally blind — the measured
 * class where a captain's un-approved plan is silently ARCHIVED. Mirrored, not imported, because
 * the store is another package's scope; if its chain ever moves, this is the line to move with it.
 */
function sessionIdOf(agent: unknown): string {
  /** The agent handle, narrowed to the three shapes a session id is spelled in. */
  const handle = agent as { session?: { id?: unknown }; sessionId?: unknown; id?: unknown } | undefined
  /** The FIRST non-nullish candidate — the `??` order is part of the mirrored contract. */
  const id = handle?.session?.id ?? handle?.sessionId ?? handle?.id
  return typeof id === "string" && id !== "" ? id : "workspace"
}

/** The session workspace of one agent, or `undefined` when it declares none. */
function sessionCwdOf(agent: unknown): string | undefined {
  /** The session's declared workspace, when it declares a non-empty one. */
  const cwd = (agent as { session?: { header?: { cwd?: unknown } } } | undefined)?.session?.header?.cwd
  return typeof cwd === "string" && cwd.length > 0 ? cwd : undefined
}

/**
 * The plan id inside one plan-shaped payload, read defensively; empty when unreadable.
 *
 * TWO SHAPES reach this reader and both are documented: the TOOL RESULT wraps the plan
 * (`{plan:{planId}}`, the `create` action's return) while the STAGED-PLAN PROBE returns the plan
 * itself (`{planId}`, `mpdTeams.planFor(...).plan`). Neither is ever invented here — an unreadable
 * payload reads as the empty string, which the notice renders as {@link MISSING_PLAN_ID_PHRASE} plus
 * the explicit statement that the staged shell cannot be approved.
 */
function planIdOf(value: unknown): string {
  /** The id on the payload itself, which is what the staged-plan probe answers. */
  const direct = (value as { planId?: unknown } | undefined)?.planId
  if (typeof direct === "string" && direct !== "") return direct
  /** The plan record the `create` action wrapped, when the payload carries one. */
  const plan = (value as { plan?: { planId?: unknown } } | undefined)?.plan
  return typeof plan?.planId === "string" ? plan.planId : ""
}

/** A thrown value reduced to printable text: its `message` when it carries one, else the value. */
function errorText(error: unknown): string {
  /** The thrown value's own message, read through a one-property view because it is `unknown`. */
  const message = (error as { message?: unknown } | undefined)?.message
  return message === undefined ? String(error) : String(message)
}

/** What installing the gate needs: the covered presets, the reporters and the per-call seams. */
export interface SessionGateOptions {
  /** Presets whose top-level sessions are covered (default: `["mpd"]`). */
  presets?: readonly string[]
  /** One-line reporter for a contained failure. */
  warn: (line: string) => void
  /**
   * One line when a listener is REGISTERED and one when the gate FIRES — the boot signature a
   * mount lane asserts. Both exist because "mounted but silent" is otherwise indistinguishable
   * from "never registered": the trace hook alone is env-gated and therefore absent from a
   * normal boot's evidence.
   */
  log?: (line: string) => void
  /**
   * ONE config value for one key, resolved PER CALL and never cached (T-18: a `.mpd/mpd.jsonc`
   * edit is picked up live). The caller owns the precedence — the mounted `mpdConfig` service
   * first, this row's own config second; `undefined` here means "declared nowhere", so the
   * mode default applies.
   */
  configValue?: (key: string) => unknown
  /** The boulder-state READER seam (`node:fs/promises` by default), for tests and the QA case. */
  readFile?: (path: string) => Promise<string>
  /**
   * The DIRECTORY-LIST seam (`node:fs/promises` by default), for tests and the QA case. It serves
   * TWO probes on the eager row: the team-record directory (C7) and signal F's bounded workspace
   * ROOT listing; a call answers ONE path, so an injected lister must answer by path.
   */
  readDir?: (path: string) => Promise<readonly string[]>
  /**
   * Whether a plan is ALREADY staged for one session — `mpdTeams.planFor(...).plan` in a boot.
   *
   * THREE-VALUED BY CONTRACT (see {@link probeStagedPlan}): `null` or `undefined` is the POSITIVE
   * "nothing is staged" answer; a non-null plan means one IS staged and the gate SKIPS staging (the
   * tool's `create` ARCHIVES an existing un-approved plan, so a second staging moves the captain's
   * in-progress plan out of its slot); a THROW — or leaving this seam unset — means the probe CANNOT
   * answer, and the gate then stages anyway and reports that in ONE warning. Never answer `null` to
   * mean "I could not read it": that is the silent path this contract exists to close.
   */
  stagedPlan?: (workspace: string, sessionId: string) => unknown
  /** The staging call's timeout in milliseconds (default {@link STAGING_TIMEOUT_MS}). */
  stageTimeoutMs?: number
  /**
   * The RE-TEAM state reader (`<ws>/.mpd/session-gate/<sessionId>.json`, `node:fs/promises` by
   * default), for tests and the QA case. A double that does not inject it reads the real file, so a
   * unit test should pass a workspace of its own (or an in-memory reader) to stay isolated.
   */
  stateReadFile?: (path: string) => Promise<string>
  /**
   * The RE-TEAM state writer (`node:fs/promises` plus `mkdir` by default). A partial double that
   * omits it keeps the counter IN MEMORY: the gate degrades, it never throws, and a restart then
   * starts the count again.
   */
  stateWriteFile?: (path: string, content: string) => Promise<void>
}

/** The gate's install outcome, exposed so a mount lane can assert it. */
export interface SessionGateInstall {
  /** Always true: the gate degrades per agent rather than failing as a whole. */
  installed: boolean
  /**
   * Agent ids whose re-team settlement is ARMED (a fire happened since the last re-arm). An id is
   * written IMMEDIATELY BEFORE the async staging call, so a re-entrant step can never stage a second
   * plan, and it is DELETED when the led team ends or its plan was seen approved — the D1 re-arming
   * that replaced the permanent settlement. A session that has not fired is absent and judged again.
   */
  acted: Set<string>
  /** One disposer per agent whose scope carries a gate listener. */
  disposers: Map<unknown, () => void>
  /**
   * The `team.gate` mode resolved at INSTALL time — the BOOT LINE's snapshot, never a cached mode.
   *
   * It is a snapshot and can be WRONG for the live behaviour in ONE case, named so a reader is not
   * misled: the loader applies sibling rows CONCURRENTLY and cordis answers `undefined` for a
   * provider whose fiber is not ACTIVE yet (the same transient miss T-50 documents), so a
   * `mpdConfig` that has not activated by this row's apply reads as ABSENT and the default
   * (`mechanical`, restored 2026-10-20) is reported. The AUTHORITATIVE mode is the one the FIRING line
   * prints, because every fire re-resolves it per call.
   */
  mode: GateMode
  /**
   * The `team.sensitivity` row resolved at INSTALL time — the boot line's snapshot, with the same
   * transient-miss bound as {@link SessionGateInstall.mode}. The AUTHORITATIVE row is the one the
   * FIRING line prints, because every fire re-resolves `team.sensitivity` per call.
   */
  sensitivity: GateSensitivity
}

/** The outcome of ONE mechanical staging attempt. */
interface StageOutcome {
  /** Whether a plan is staged in the session as a result (this fire staged one, or one was there). */
  ok: boolean
  /** The plan id the CALL returned, or the empty string when it reported none. */
  planId: string
  /** Whether the gate SKIPPED staging because this session already had a plan. */
  alreadyStaged: boolean
  /** Why the attempt degraded to the advisory notice, when it did. */
  error?: string
}

/**
 * Install the gate: ONE `agent/pre-step` listener PER QUALIFYING AGENT, registered in that
 * agent's OWN scope through the adapter.
 *
 * WHY PER AGENT AND NOT ONE HOST LISTENER — this is the defect the first version shipped,
 * measured 2026-09-27: the harness dispatches `agent/pre-step` through the agent's SCOPE
 * CARRIER (`dsh-agent` `agentEvents(…).waterfall` -> `ctx.waterfall(carrier, …)`), and a
 * scope-filtered dispatch reaches a listener only when the listener's scope IS the dispatch
 * scope or an ancestor of it. A listener registered on a row's ctx was therefore installed,
 * visible in the boot log (`sessionGate=advisory`), and NEVER INVOKED on six live boots.
 * Registering on `agent.ctx` makes the listener's scope the agent itself, which the filter
 * admits by construction — the same site the harness's own pre-step subscribers use.
 *
 * The handler then reads the agent from the REGISTRATION rather than from the payload, so it
 * cannot be misled by a payload that omits `agent`; the payload's own `agent` stays a
 * fallback. A fire is settled ONCE per session until the team it produced ends (D1 rule 4), and
 * the in-flight guard is taken BEFORE the async staging call so a re-entrant step can never stage
 * twice. ONE per-tool hook is subscribed beside the listeners: the COMPLETED consult counter that
 * feeds the mid-session volume trigger (D1 rule 5).
 *
 * @param dsh - the adapter slice this row uses: the agent-scoped listener, the live agents, the
 *   event bus, the notice factory, the workspace resolver, the per-tool observation hook and the two
 *   tool seams the staging call needs (`hasTool` / `executeTool`).
 * @param options - the covered presets, the reporters and the per-call seams (see the interface).
 * @returns the install outcome: the settled registry, the disposers and the resolved mode.
 */
export function installSessionGate(
  dsh: Pick<DshAdapter, "registerAgentPreStep" | "liveAgents" | "onEvent" | "userMessage" | "workspaceRoot" | "hasTool" | "executeTool" | "onPostToolExecute">,
  options: SessionGateOptions,
): SessionGateInstall {
  /** The presets whose top-level sessions are covered. */
  const presets = options.presets ?? DEFAULT_GATE_PRESETS
  /** Agent ids whose re-team settlement is ARMED (a fire happened since the last re-arm). */
  const acted = new Set<string>()
  /** One disposer per agent whose scope carries a gate listener. */
  const disposers = new Map<unknown, () => void>()
  /** Emit a boot-log line without letting a throwing logger take the gate down. */
  const report = (line: string): void => {
    try {
      options.log?.(line)
    } catch { /* logging must never take the gate down */ }
  }
  /** Report one contained failure without letting a throwing reporter take the gate down. */
  const warn = (line: string): void => {
    try {
      options.warn(line)
    } catch { /* warning must never take the gate down */ }
  }

  // ── THE RE-TEAM GATE'S STATE (D1) ──────────────────────────────────────────
  /**
   * One session's re-team record per process, mirrored to its state file.
   *
   * The value is the SHARED LOAD PROMISE (CR r1 [7]), not the record: two concurrent callers — the
   * pre-step and a completed consult's counter — must resolve to the SAME mutable record, so an
   * increment is never lost to a second, rival load whose `set` would replace it.
   */
  const reTeamStates = new Map<string, Promise<ReTeamState>>()
  /** Sessions whose staging call is IN FLIGHT — the synchronous guard against a second stage. */
  const firing = new Set<string>()
  /** Team ids whose failed-task notice was already injected (ONE notice per team per process). */
  const repairNoticed = new Set<string>()
  /** Team ids whose auto-end was already attempted (ONE attempt per team per process). */
  const autoEndAttempted = new Set<string>()

  /**
   * The in-memory key of one session's state: the workspace AND the session id.
   * @param workspace - the session workspace the state file resolves under.
   * @param sessionId - the session key inside that workspace.
   * @returns a key no two distinct state files can share.
   */
  function reTeamKeyOf(workspace: string, sessionId: string): string {
    return workspace + "\u0000" + sessionId
  }

  /**
   * One session's re-team record, loaded ONCE per process and thereafter served from memory.
   *
   * The file is read lazily so a boot that never needs the counter pays nothing; an unreadable file
   * (a fresh workspace, a read-only mount) reads as {@link emptyReTeamState}, never a throw.
   * @param workspace - the session workspace the state file resolves under.
   * @param sessionId - the session key inside that workspace.
   * @returns the live record object; the caller may mutate it and persist with {@link saveReTeamState}.
   */
  async function loadReTeamState(workspace: string, sessionId: string): Promise<ReTeamState> {
    /** The key this session's record is cached under. */
    const key = reTeamKeyOf(workspace, sessionId)
    /** The already-cached load — settled or still IN FLIGHT — or undefined on the first touch. */
    const cached = reTeamStates.get(key)
    if (cached !== undefined) return cached
    // THE IN-FLIGHT LOAD IS THE CACHE ENTRY (CR r1 [7]): it is stored BEFORE the first await, so a
    // concurrent caller awaits THIS record instead of missing the cache and building a rival one.
    /** The ONE shared load every caller of this key awaits. */
    const pending = readReTeamState(workspace, sessionId, {
      ...(options.stateReadFile === undefined ? {} : { readFile: options.stateReadFile }),
    }).then((loaded) => loaded ?? emptyReTeamState())
    reTeamStates.set(key, pending)
    return pending
  }

  /**
   * Persist one session's record; the IN-MEMORY copy is authoritative for the process.
   * @param workspace - the session workspace the state file resolves under.
   * @param sessionId - the session key inside that workspace.
   * @param state - the record to store.
   * @returns nothing; a failed write leaves the in-memory count in force (never a throw).
   */
  async function saveReTeamState(workspace: string, sessionId: string, state: ReTeamState): Promise<void> {
    // The cache stores LOADS only (CR r1 [7]): persisting the live record wraps it in the SAME
    // representation, so a later load answers exactly this record instead of bypassing the share.
    reTeamStates.set(reTeamKeyOf(workspace, sessionId), Promise.resolve(state))
    await writeReTeamState(workspace, sessionId, state, {
      ...(options.stateWriteFile === undefined ? {} : { writeFile: options.stateWriteFile }),
    })
  }

  /**
   * ONE config value for ONE key: the live layer (the mounted `mpdConfig` service) first, this
   * row's own config second, `undefined` last so the caller's default applies. Resolved PER CALL.
   * @param key - the dot-path key, e.g. `team.gate`.
   * @returns the raw value, or `undefined` when neither layer declares it.
   */
  function configValue(key: string): unknown {
    try {
      return options.configValue?.(key)
    } catch {
      // A throwing config layer reads as ABSENT, which keeps the gate's own default in force.
      return undefined
    }
  }

  /**
   * Whether the staging tool is registered IN THE CALLING AGENT'S OWN VIEW — the exact view its
   * call will execute against.
   *
   * WHY THE AGENT IS PASSED (2026-10-07): the ONE-ARG form reads the host-plane GLOBAL view and
   * answers correctly today only because `agent_teams_plan` happens to be a host-plane row
   * (`cordis.patch.yml` id `mpd-team-core`). The moment that row moves plane — the preset plane is
   * the agent scope's PARENT, invisible to an unscoped read — the one-arg probe would silently
   * answer `false` and this ladder would degrade to advisory with NO error anywhere. With the agent
   * the adapter resolves through that agent's own view (host globals + preset plane + the agent's
   * own registrations), i.e. the SAME resolution execution uses, so a probe and the call it
   * promises can never come from different planes.
   *
   * A missing `hasTool` seam (a partial adapter double) reads FALSE — the ladder's advisory step,
   * never a throw. Nothing here is cached: the probe runs per fire.
   * @param agent - the LIVE bound agent whose view is probed.
   * @returns true only when the adapter answered positively for that agent's view.
   */
  function hasStagingTool(agent: unknown): boolean {
    if (typeof dsh.hasTool !== "function") return false
    try {
      return dsh.hasTool(STAGING_TOOL_NAME, agent) === true
    } catch {
      return false
    }
  }

  /**
   * Ask the caller's idempotence probe about ONE session, THREE-VALUED and never throwing.
   *
   *   "none"    — the probe POSITIVELY answered "nothing is staged": staging is safe.
   *   "staged"  — a plan IS staged; the caller skips staging and names it.
   *   "unknown" — the probe could not answer AT ALL: no closure was supplied (the `mpdTeams` service
   *               is not mounted in this composition) or the read threw. Staging proceeds — that is
   *               the mission — but the caller says so in ONE warning, because staging can ARCHIVE
   *               an existing un-approved plan for the session, and silence there would make the
   *               "never re-stage" claim dishonest.
   *
   * The absent-closure arm is the one that used to be indistinguishable from "none": an `undefined`
   * answer and an unavailable service both read as "nothing staged" and staged SILENTLY.
   * @param workspace - the session workspace the probe reads.
   * @param sessionId - the key {@link sessionIdOf} mirrors from the staging store's own writer.
   * @returns the verdict, the plan when one is staged, and why when the probe could not answer.
   */
  function probeStagedPlan(
    workspace: string,
    sessionId: string,
  ): { verdict: "none" | "staged" | "unknown"; plan?: unknown; reason?: string } {
    if (typeof options.stagedPlan !== "function") {
      return { verdict: "unknown", reason: "no staged-plan probe is available in this composition (mpdTeams is not mounted)" }
    }
    try {
      /** The probe's answer: a plan object, or `null`/`undefined` for the positive "none" verdict. */
      const existing = options.stagedPlan(workspace, sessionId)
      return existing === undefined || existing === null ? { verdict: "none" } : { verdict: "staged", plan: existing }
    } catch (error) {
      return { verdict: "unknown", reason: errorText(error) }
    }
  }

  /**
   * Run the lazy stage ladder at FIRE time — nothing is resolved at apply time, so the row order
   * (`mpd-roles` composing before `mpd-team-core`) stays irrelevant.
   * @param input - the bound live agent, its workspace/session, the consumed goal and the verdict.
   * @returns what happened, never a throw: every failure is a degraded {@link StageOutcome}.
   */
  async function stagePlan(input: {
    /** The LIVE agent the listener is bound to; the tool resolves workspace and session from it. */
    agent: unknown
    /** The session workspace, used for the idempotence probe. */
    workspace: string
    /** The session the staging call is attributed to. */
    sessionId: string
    /** The goal text with the explicit marker already consumed. */
    goal: string
    /** The fired signal letters, inlined into the shell's description. */
    signals: readonly string[]
    /** The active work's plan path, echoed into the description when signal D fired. */
    planPath?: string
    /** The mid-session trigger's volume, when the RE-TEAM gate (not the session-start row) stages. */
    reteam?: { count: number; threshold: number }
  }): Promise<StageOutcome> {
    // (b) A plan is ALREADY staged for this session: the tool's `create` ARCHIVES it — the plan is
    // copied to `.mpd/team/archive/<planId>/plan.json` BEFORE the staging slot is cleared — so the
    // gate skips staging and names the plan that is already there.
    //
    // THE BOUND, stated instead of an absolute: the gate never DESTROYS a plan (an archived plan is
    // recoverable, and an APPROVED plan is refused by the tool without `replace:true`), and it
    // re-stages ONLY when this probe POSITIVELY answered "none staged" — or when the probe could not
    // answer at all, in which case it says so in ONE warning (below). A silent "cannot answer" is
    // what would make a claim of "never re-stage" dishonest.
    /** The probe's three-valued answer, whose "unknown" arm is the one that must be loud. */
    const probe = probeStagedPlan(input.workspace, input.sessionId)
    if (probe.verdict === "staged") return { ok: true, planId: planIdOf(probe.plan), alreadyStaged: true }
    if (probe.verdict === "unknown") {
      // STAGING IS THE MISSION, so an unanswerable probe does NOT block it — it is REPORTED. The
      // consequence is named exactly: staging MOVES an existing un-approved plan for this session
      // out of its slot into the archive, where it stays readable.
      warn("session-start gate: the staged-plan probe could not answer for session \"" + input.sessionId + "\" (" + String(probe.reason) + ") — staging anyway, so an existing UN-APPROVED plan for this session may have been ARCHIVED into .mpd/team/archive/ (an APPROVED plan is never replaced without replace:true)")
    }
    // (a) The tool is not registered in this composition (another preset, a boot without
    //     mpd-team-core): the mechanical route is impossible, so the advisory notice is the honest one.
    // Probed in the SAME agent view the call below executes against, so the two cannot disagree.
    if (!hasStagingTool(input.agent)) return { ok: false, planId: "", alreadyStaged: false, error: "tool " + STAGING_TOOL_NAME + " is not registered in this agent's view" }
    try {
      /** The three fields the gate can fill — a SHELL, never a decomposed team. */
      const shell = gatePlanShell({
        signals: input.signals,
        goal: input.goal,
        ...(input.planPath === undefined ? {} : { planPath: input.planPath }),
        ...(input.reteam === undefined ? {} : { reteam: input.reteam }),
      })
      /** The tool result, normalized by the adapter (`{ok, isError, value, error}`). */
      const result = await dsh.executeTool({
        name: STAGING_TOOL_NAME,
        arguments: { action: "create", name: shell.name, description: shell.description, approval: shell.approval },
        // THE LIVE AGENT, never a fabricated `{session:{id}}` stand-in: the tool resolves the
        // workspace and the session FROM this handle, and a stand-in is what broke the approval hop.
        agent: input.agent,
        timeoutMs: options.stageTimeoutMs ?? STAGING_TIMEOUT_MS,
      })
      if (result?.ok !== true || result.isError === true) {
        return { ok: false, planId: "", alreadyStaged: false, error: result?.error === undefined ? "the staging call did not report ok" : String(result.error) }
      }
      return { ok: true, planId: planIdOf(result.value), alreadyStaged: false }
    } catch (error) {
      return { ok: false, planId: "", alreadyStaged: false, error: errorText(error) }
    }
  }

  /**
   * Count ONE COMPLETED consult this session's agent executed (D1 rule 5).
   *
   * The hook is the adapter's EXISTING `onPostToolExecute`; this function only reads it. "Completed"
   * means the call returned WITHOUT an error verdict (`AGENT_UNCONFIGURED` and every other failed
   * spawn are skipped), and the counter only moves for a session that would qualify for the gate at
   * all, so a child's consults never inflate its parent's volume.
   * @param exec - the observed tool execution, of any shape.
   * @param result - the harness's post-execute result, whose `isError` is the verdict this reads.
   * @returns nothing; every failure is contained so a tool call is never broken by accounting.
   */
  async function countCompletedConsult(exec: DshToolExec | undefined, result: DshPostResult | undefined): Promise<void> {
    try {
      if (exec === undefined || exec === null || !isConsultToolName(exec.name)) return
      if (result?.isError === true) return
      /** The agent the call ran as; a call with no agent cannot be attributed to a session. */
      const agent = exec.agent
      if (agent === undefined || agent === null) return
      if (!sessionQualifies(agent, presets)) return
      /** The session workspace the counter file resolves under. */
      const workspace = dsh.workspaceRoot({ agent } as never)
      /** The session key the counter is filed under. */
      const sessionId = sessionIdOf(agent)
      /** The session's record, incremented in place and then persisted. */
      const state = await loadReTeamState(workspace, sessionId)
      state.consultCount += 1
      await saveReTeamState(workspace, sessionId, state)
      gateTrace("consult counted session=" + sessionId + " count=" + String(state.consultCount) + " tool=" + String(exec.name))
    } catch { /* accounting must never break a tool call */ }
  }

  /**
   * Subscribe the ONE per-tool hook the consult count rides (D1 rule 5).
   *
   * `onPostToolExecute` is the adapter's existing observation seam; the contract forbids a second
   * observation path (the `session/event` stream belongs to the watchdog). A composition whose
   * adapter exposes no such seam leaves the count at zero, which makes the volume trigger unable to
   * fire rather than taking the boot down.
   * @returns nothing; a failed subscription is swallowed because a gate is an assistant.
   */
  function subscribeConsultCounter(): void {
    if (typeof dsh.onPostToolExecute !== "function") return
    try {
      dsh.onPostToolExecute(async (exec: DshToolExec, result: DshPostResult): Promise<undefined> => {
        await countCompletedConsult(exec, result)
        return undefined
      })
    } catch { /* a missing bus leaves the volume trigger unable to fire, never a boot failure */ }
  }

  /**
   * Close ONE clean-terminal team through the Lead-authority CONTROL tool (D1 rule 3).
   *
   * The roles plugin never writes a team record itself: the `end` action does, idempotently and with
   * a journal row. The call runs as the SESSION'S OWN agent, which is what grants it Lead authority
   * over the record it led. Failure is NON-FATAL — one warning and the gate continues.
   * @param agent - the LIVE agent the listener is bound to.
   * @param teamId - the team the record named as clean-terminal.
   * @returns whether the team was really closed.
   */
  async function autoEndCleanTerminal(agent: unknown, teamId: string): Promise<boolean> {
    try {
      /** The control call's normalized answer: `{ok, isError, value, error}`. */
      const result = await dsh.executeTool({
        name: CONTROL_TOOL_NAME,
        arguments: { action: "end", team_id: teamId, reason: RETEAM_AUTO_END_REASON },
        agent,
        timeoutMs: options.stageTimeoutMs ?? STAGING_TIMEOUT_MS,
      })
      if (result?.ok !== true || result.isError === true) {
        warn("re-team gate: the clean-terminal team \"" + teamId + "\" was NOT auto-ended ("
          + (result?.error === undefined ? "the control call did not report ok" : String(result.error)) + ") — the gate continues")
        return false
      }
      report('re-team gate: auto-ended clean-terminal team "' + teamId + '" through ' + CONTROL_TOOL_NAME)
      return true
    } catch (error) {
      warn("re-team gate: the clean-terminal team \"" + teamId + "\" was NOT auto-ended (" + errorText(error) + ") — the gate continues")
      return false
    }
  }

  /**
   * Splice ONE notice into the step's decision, right after the LAST still-claimed message.
   *
   * `toSpliced`/`findLastIndex` semantics without the ES2023 lib: the notice lands where the retired
   * implementation placed it. The optional `rewrite` runs over every decision message first, which is
   * how the session-start route consumes the explicit `team:` marker from the user's own turn.
   * @param decision - the downstream decision the step will run with.
   * @param decisionMessages - the decision's current message list.
   * @param rawClaimed - the messages the step still claims, used to find the splice point.
   * @param notice - the injected user-role message.
   * @param rewrite - an optional per-message transform applied before splicing.
   * @returns the amended decision.
   */
  function spliceNotice(
    decision: DshPreStepDecision,
    decisionMessages: readonly unknown[],
    rawClaimed: readonly unknown[],
    notice: unknown,
    rewrite?: (message: unknown) => unknown,
  ): DshPreStepDecision {
    /** The decision's messages, rewritten only when the caller asked for it. */
    const messages = [...(decisionMessages.length > 0 ? decisionMessages : rawClaimed)].map((message) => (rewrite === undefined ? message : rewrite(message)))
    /** Index of the LAST message the step still claims, or -1 when none is left. */
    let lastClaimed = -1
    for (let at = 0; at < messages.length; at += 1) if (rawClaimed.includes(messages[at])) lastClaimed = at
    /** Index the notice is spliced at: right after the last still-claimed message. */
    const at = lastClaimed < 0 ? messages.length : lastClaimed + 1
    /** The amended message list the step continues with. */
    const amended = [...messages.slice(0, at), notice, ...messages.slice(at)]
    return { ...decision, kind: decision?.kind ?? "enter", messages: amended }
  }

  /**
   * Stamp ONE fire into a session's record (D1 rule 4): reset the counter, remember what was staged.
   * @param workspace - the session workspace the state file resolves under.
   * @param sessionId - the session key inside that workspace.
   * @param state - the session's live record, mutated in place.
   * @param planId - the plan the fire staged, or the empty string when nothing was staged.
   * @returns nothing; a failed write leaves the in-memory settlement in force.
   */
  async function recordFire(workspace: string, sessionId: string, state: ReTeamState, planId: string): Promise<void> {
    state.consultCount = 0
    state.lastFiredAt = Date.now()
    state.planId = planId
    state.teamIdAtFire = ""
    await saveReTeamState(workspace, sessionId, state)
  }

  /**
   * Run ONE mid-session RE-TEAM fire (D1 rules 5–6): stage the shell, settle, return the notice text.
   *
   * The shell goes through the SAME {@link stagePlan} ladder the session-start route uses, so the
   * idempotence probe, the timeout and the degradation ladder are shared, and the only difference is
   * the shell's name/description (built by `gatePlanShell` from the volume, not from a goal). Nothing
   * else is written: no member, no task, no approval.
   * @param input - the bound agent, the resolved session, the mode and the counted volume.
   * @returns the notice text to inject, or `undefined` when a concurrent step already owned the
   * staging call (that step injects its own notice); never a throw.
   */
  async function fireReTeam(input: {
    /** The LIVE agent the listener is bound to. */
    agent: unknown
    /** The bound agent's id, quoted by the report/warning lines. */
    agentId: string
    /** The session workspace the staging call writes under. */
    workspace: string
    /** The session the staging call is attributed to. */
    sessionId: string
    /** The resolved `team.gate` mode; `advisory` never stages. */
    mode: GateMode
    /** The COMPLETED consults the trigger counted. */
    count: number
    /** The threshold those consults crossed. */
    threshold: number
  }): Promise<string | undefined> {
    /** The in-memory key the synchronous in-flight guard uses. */
    const key = reTeamKeyOf(input.workspace, input.sessionId)
    // THE RE-ENTRY GUARD IS ACQUIRED BEFORE THE FIRST AWAIT (CR r1 [9]): a concurrent pre-step that
    // already owns this session's staging call returns WITHOUT staging, so its `create` cannot ARCHIVE
    // the plan the winner just staged. Synchronous up to the `add`, so exactly one caller wins.
    if (firing.has(key)) { gateTrace("re-team fire in flight agent=" + input.agentId); return undefined }
    firing.add(key)
    try {
      /** The session's record, mutated by the fire below. */
      const state = await loadReTeamState(input.workspace, input.sessionId)
      /** What the staging ladder did; the advisory route leaves the degraded default. */
      let outcome: StageOutcome = { ok: false, planId: "", alreadyStaged: false }
      if (input.mode === GATE_MODE_MECHANICAL) {
        outcome = await stagePlan({
          agent: input.agent,
          workspace: input.workspace,
          sessionId: input.sessionId,
          goal: "",
          signals: [],
          reteam: { count: input.count, threshold: input.threshold },
        })
        if (!outcome.ok) {
          warn("re-team gate: staging degraded for agent \"" + input.agentId + "\" (" + String(outcome.error) + ")")
        }
      }
      /** Whether THIS fire staged a shell (an already-staged plan is NOT a new shell). */
      const staged = input.mode === GATE_MODE_MECHANICAL && outcome.ok && !outcome.alreadyStaged
      /** Whether the ladder found a plan already staged for this session. */
      const alreadyStaged = input.mode === GATE_MODE_MECHANICAL && outcome.ok && outcome.alreadyStaged
      await recordFire(input.workspace, input.sessionId, state, outcome.ok && input.mode === GATE_MODE_MECHANICAL ? outcome.planId : "")
      if (input.agentId !== "") acted.add(input.agentId)
      report('re-team gate fired for agent "' + input.agentId + '" consults=' + String(input.count) + "/" + String(input.threshold)
        + " mode=" + input.mode + " staged=" + (staged ? "1" : "0") + (outcome.planId === "" ? "" : " plan=" + outcome.planId))
      if (staged && outcome.planId === "") {
        warn("re-team gate: " + MISSING_PLAN_ID_PHRASE + " for agent \"" + input.agentId + "\" — the shell is staged but cannot be approved")
      }
      gateTrace("RE-TEAM FIRING agent=" + input.agentId + " consults=" + String(input.count) + " staged=" + String(staged))
      return reTeamNoticeText({
        count: input.count,
        threshold: input.threshold,
        staged,
        alreadyStaged,
        planId: staged || alreadyStaged ? outcome.planId : "",
        ...(outcome.ok || outcome.error === undefined ? {} : { error: String(outcome.error) }),
      })
    } finally {
      // The guard covers the WHOLE fire (stage, settlement and notice): a concurrent step waits for
      // the settled state rather than reading a half-applied one.
      firing.delete(key)
    }
  }

  /** One step handler, bound to the agent whose scope registered it. */
  const stepHandler = (bound: unknown): (payload: DshAgentPreStep, decision: DshPreStepDecision) => Promise<DshPreStepDecision | undefined> => async (payload: DshAgentPreStep, decision: DshPreStepDecision) => {
    try {
      gateTrace("step entered bound=" + String((bound as { id?: unknown } | undefined)?.id ?? "none")
        + " payloadAgent=" + String((payload as { agent?: { id?: unknown } } | undefined)?.agent?.id ?? "none")
        + " kind=" + String(decision?.kind)
        + " payloadMessages=" + String(Array.isArray(payload?.messages) ? payload.messages.length : -1)
        + " decisionMessages=" + String(Array.isArray(decision?.messages) ? decision.messages.length : -1))
      if (decision?.kind === "reject") return undefined
      // BOUND FIRST: the harness dispatch fuses `agent` into the payload, but the real
      // payload shape is not guaranteed to carry it, and the registration IS the authority.
      const agent = bound ?? payload?.agent
      if (agent === undefined || agent === null) return undefined
      if (!sessionQualifies(agent, presets)) { gateTrace("not qualified agent=" + String((agent as { id?: unknown }).id ?? "?")); return undefined }
      /** The bound agent's id; an empty one cannot be marked acted and is judged on every step. */
      const agentId = String((agent as { id?: unknown }).id ?? "")
      // THE MODE IS RESOLVED PER CALL (never cached): a `.mpd/mpd.jsonc` edit takes effect on the
      // next step, and `off` returns BEFORE any record is read.
      const mode: GateMode = resolveGateMode(configValue(GATE_CONFIG_KEY))
      if (mode === GATE_MODE_OFF) { gateTrace("mode off agent=" + agentId); return undefined }
      // THE GOAL COMES FROM THE RAW CLAIMED LIST (the payload), never from the decision:
      // the decision also carries the harness's injected runtime-context turn (measured), and
      // judging that snapshot made the predicate false on every triggered prompt.
      const decisionMessages = Array.isArray(decision?.messages) ? decision.messages : []
      /** The step's raw claimed messages, or the decision's list when the payload carries none. */
      const rawClaimed = Array.isArray(payload?.messages) && payload.messages.length > 0 ? payload.messages : decisionMessages
      /** The workspace every probe below reads and every staged plan is written under. */
      const workspace = dsh.workspaceRoot({ agent } as never)
      /** The session key the team records are read by, the sticky probe mirrors and the counter files under. */
      const sessionId = sessionIdOf(agent)
      /** The in-memory key of this session's re-team record. */
      const stateKey = reTeamKeyOf(workspace, sessionId)
      // A staging call IN FLIGHT already owns this session: the harness may dispatch the next
      // pre-step before it resolves, and a second stage would ARCHIVE the plan the first one staged.
      if (firing.has(stateKey)) { gateTrace("fire in flight agent=" + agentId); return undefined }
      // C7 + D1 RULE 1 — A SESSION THAT LEADS A LIVE TEAM IS NEVER SENT TO STAGE ONE, and a team is
      // live only while its record says so: an `endedAt` record, or a board that is CLEAN-TERMINAL
      // (every task completed/cancelled, none failed, at least one task), is FINISHED. Decided from
      // the team RECORD — positive structural evidence — never from a "did the gate fire before"
      // flag: MEASURED 2026-10-07, an inbound teammate report fired the gate on a session already
      // leading a team and staged a spurious 0-member shell (plan-20261007102357, archived).
      /** What THIS session's own team records say, read fresh on every step. */
      const leading = await readLeadingTeam(workspace, sessionId, {
        ...(options.readFile === undefined ? {} : { readFile: options.readFile }),
        ...(options.readDir === undefined ? {} : { readDir: options.readDir }),
      })
      /** This session's re-team record, loaded once per process and mutated in place (rules 4–5). */
      const state = await loadReTeamState(workspace, sessionId)
      if (leading.leading) {
        // RULE 4, THE PLAN-APPROVED HALF: a live team whose record this session leads means the plan
        // the last fire staged WAS approved, so the settlement is cleared and BOUND to that team.
        // The consult count keeps accruing while the team works; the team's END is what re-arms.
        if (state.lastFiredAt !== 0 || state.planId !== "" || state.teamIdAtFire !== (leading.teamId ?? "")) {
          state.lastFiredAt = 0
          state.planId = ""
          state.teamIdAtFire = leading.teamId ?? ""
          await saveReTeamState(workspace, sessionId, state)
          if (agentId !== "") acted.delete(agentId)
        }
        // RULE 2 — A FAILED TASK BLOCKS AUTO-END **AND** RE-TEAM. The one notice names the team and
        // the failed row; nothing is ended, staged or retried. ONE notice per team per process, so a
        // long session is not nagged on every turn.
        if (leading.failedTaskId !== undefined && leading.failedTeamId !== undefined && !repairNoticed.has(leading.failedTeamId)) {
          repairNoticed.add(leading.failedTeamId)
          report('re-team gate: team "' + leading.failedTeamId + '" has an unrepaired failed task; no auto-end and no re-stage')
          return spliceNotice(decision, decisionMessages, rawClaimed, dsh.userMessage({
            text: reTeamRepairNoticeText(leading.failedTeamId, leading.failedTaskId),
            source: { kind: "mpd-roles", reason: "re-team-repair" },
          }))
        }
        gateTrace("already leading team=" + String(leading.teamId ?? "(id not read)") + " members=" + String(leading.members) + " agent=" + agentId)
        return undefined
      }
      // D1 RULE 1, THE FINISHED-TEAM HALF — an ENDED or CLEAN-TERMINAL record is NOT a live team.
      if (leading.ended === true || leading.cleanTerminal === true) {
        // RULE 3: close every clean-terminal board this session led, through the CONTROL tool, as the
        // session's OWN agent. ONE attempt per team per process: the tool is idempotent, but a failed
        // call must not turn every following pre-step into a retry loop.
        for (const target of leading.autoEndTeamIds ?? []) {
          if (target === "" || autoEndAttempted.has(target)) continue
          autoEndAttempted.add(target)
          await autoEndCleanTerminal(agent, target)
        }
        // RULE 4, THE TEAM-ENDED HALF: the settlement is CLEARED, so a later volume trigger can fire
        // again. Cleared ONLY when a terminal record is one this settlement OWNS (CR r1 [8]) — by team
        // identity when the fire named that team, or by that record's `endedAt` falling AFTER the
        // fire's instant (the plan was approved and its team finished between two pre-steps). An
        // unrelated stale record ending must NOT re-arm a settlement it never produced: that let a
        // session re-nag on every complex turn, which is the nagging the settlement exists to stop.
        /** Whether this session carried ANY settlement worth clearing. */
        const settled = state.lastFiredAt !== 0 || state.planId !== "" || state.teamIdAtFire !== ""
        /** Whether the settlement is bound to a team this read just classified as terminal. */
        const bound = (state.teamIdAtFire !== "" && (leading.terminalTeamIds ?? []).includes(state.teamIdAtFire))
          || (state.lastFiredAt !== 0 && (leading.terminalEndedAt ?? []).some((endedAt) => endedAt > state.lastFiredAt))
        if (settled && bound) {
          state.lastFiredAt = 0
          state.planId = ""
          state.teamIdAtFire = ""
          await saveReTeamState(workspace, sessionId, state)
          if (agentId !== "") acted.delete(agentId)
          report('re-team gate: re-armed after team "' + String(leading.teamId ?? "(id not read)") + '" ended')
        }
      }
      // RULE 4, THE SETTLEMENT: a fire happened since the last re-arm, and nothing fires until the
      // team it produced ends (or its plan is seen approved above). The counter keeps accruing.
      if (state.lastFiredAt !== 0 || state.planId !== "") {
        gateTrace("re-team settled agent=" + agentId + " plan=" + String(state.planId))
        return undefined
      }
      // RULES 5/6 — THE MID-SESSION VOLUME TRIGGER, evaluated on EVERY pre-step (no user turn is
      // needed: the subject is the session's own consult volume). `team.reteam.enabled` gates ONLY
      // this trigger; the ended-aware leading check and the auto-end above stay in force regardless.
      if (resolveReTeamEnabled(configValue(RETEAM_ENABLED_CONFIG_KEY))) {
        /** The completed-consult volume this trigger needs, resolved PER CALL from the config layer. */
        const afterConsults = resolveReTeamAfterConsults(configValue(RETEAM_AFTER_CONSULTS_CONFIG_KEY))
        if (state.consultCount >= afterConsults) {
          /** The notice text the fire produced; `undefined` means a concurrent step already owned the staging call. */
          const noticeText = await fireReTeam({ agent, agentId, workspace, sessionId, mode, count: state.consultCount, threshold: afterConsults })
          if (noticeText === undefined) return undefined
          return spliceNotice(decision, decisionMessages, rawClaimed, dsh.userMessage({
            text: noticeText,
            source: { kind: "mpd-roles", reason: "re-team-trigger" },
          }))
        }
      }
      // THE SESSION-START COMPLEXITY TRIGGER (unchanged below): it judges the user's own turn, so it
      // needs one, and a step with no user text leaves the session judged again next turn.
      /** The user's own turn, preferring the payload's raw list over the spliced decision. */
      const user = latestUserMessage(rawClaimed) ?? latestUserMessage(decisionMessages)
      // NOTHING TO JUDGE YET: the session stays unregistered, so the first REAL user turn is still
      // evaluated instead of a pre-step with no user text spending the one evaluation.
      if (user === undefined) { gateTrace("no user text yet agent=" + agentId); return undefined }
      /** The goal text with the explicit marker removed, plus whether it was there. */
      const consumed = consumeExplicitFlag(user.text)
      // Signal D's state root, resolved PER CALL from `boulder.dir` (never cached) and normalized by
      // the ONE rule both consumers share: a `.mpd` spelling (this knob's retired schema default)
      // means "the session workspace", never a directory literally named `.mpd` under the workspace —
      // that reading is what double-nested the ledger path and left signal D unable to fire.
      /** The state-root override, or undefined when the session workspace is the right root. */
      const boulderDir = resolveBoulderDir(configValue(BOULDER_DIR_CONFIG_KEY))
      /** What the workspace's boulder ledger says about an ACTIVE work (never throws). */
      const boulder = await readBoulderGate(workspace, {
        ...(options.readFile === undefined ? {} : { readFile: options.readFile }),
        ...(boulderDir === undefined ? {} : { boulderDir }),
      })
      // THE THRESHOLD ROW, resolved PER CALL from `team.sensitivity` (an absent or unknown value
      // reads `easy`, the eager default). Signal F is probed ONLY on a row that evaluates it, so
      // `normal`/`strict` never pay for the listing and never gain a sixth signal.
      /** The threshold row this fire reads. */
      const sensitivity = resolveSensitivity(configValue(SENSITIVITY_CONFIG_KEY))
      /** Whether this row evaluates signal F at all (only `easy` does). */
      const wantsWorkspaceScale = SENSITIVITY_THRESHOLDS[sensitivity].workspaceScale
      /** Whether the workspace looks like a large project — signal F's input, bounded and non-throwing. */
      const workspaceScale = wantsWorkspaceScale
        ? await readWorkspaceScale(workspace, {
          ...(options.readDir === undefined ? {} : { readDir: options.readDir }),
        })
        : false
      /** The frozen predicate's answer: whether it triggered, and which signals fired. */
      const verdict = evaluateComplexityGate(consumed.text, {
        explicitFlag: consumed.flagged,
        activeBoulder: boulder.active,
        sensitivity,
        workspaceScale,
      })
      // NO TRIGGER = NO SETTLEMENT: the session is judged again on its next user turn, so a trivial
      // first turn can never spend the one evaluation on the complex turn that follows it.
      if (verdict.trigger !== true) { gateTrace("predicate false agent=" + agentId + " text=" + JSON.stringify(user.text.slice(0, 60))); return undefined }
      // THE RE-ENTRY GUARD, taken IMMEDIATELY BEFORE the async stage: the harness may dispatch the
      // next pre-step while the staging call is still in flight, and a second stage would ARCHIVE the
      // plan the first one just staged. RE-CHECKED HERE (CR r1 [9]) because several awaits ran since
      // the entry check above; the winner is decided SYNCHRONOUSLY at this `add`, so exactly one step
      // stages. The guard is released in `finally`; the SETTLEMENT written below (`acted` +
      // `state.lastFiredAt`) is what keeps the session quiet afterwards (rule 4).
      if (firing.has(stateKey)) { gateTrace("fire in flight agent=" + agentId); return undefined }
      firing.add(stateKey)
      /** What the mechanical route did; the advisory route leaves it at this degraded default. */
      let outcome: StageOutcome = { ok: false, planId: "", alreadyStaged: false }
      try {
        if (mode === GATE_MODE_MECHANICAL) {
          outcome = await stagePlan({
            agent,
            workspace,
            sessionId,
            goal: consumed.text,
            signals: verdict.signals,
            ...(boulder.planPath === undefined ? {} : { planPath: boulder.planPath }),
          })
          if (!outcome.ok) {
            // Ladder step (d): the call failed, threw or timed out — ONE warning carrying the error,
            // and the step continues with the ADVISORY notice (never a claimed staged plan).
            warn("session-start gate: staging degraded to the advisory notice for agent \"" + agentId + "\" (" + String(outcome.error) + ")")
          }
        }
      } finally {
        firing.delete(stateKey)
      }
      /** Whether a plan is staged in this session as a result of this fire. */
      const staged = mode === GATE_MODE_MECHANICAL && outcome.ok
      report('session gate fired for agent "' + agentId + '" signals=' + verdict.signals.join("/")
        + " mode=" + mode + " staged=" + (staged ? "1" : "0") + (outcome.planId === "" ? "" : " plan=" + outcome.planId)
        + " sensitivity=" + sensitivity)
      // A staged shell whose id the call did not report is STILL staged, but nobody can approve it. The
      // notice carries the failure sentence; this warning makes the same failure visible in the row log,
      // so an operator cannot read `staged=1` (with no `plan=`) as a healthy fire.
      if (staged && outcome.planId === "") {
        warn("session-start gate: " + MISSING_PLAN_ID_PHRASE + " for agent \"" + agentId + "\" — the shell is staged but cannot be approved")
      }
      gateTrace("FIRING agent=" + agentId + " signals=" + verdict.signals.join("/") + " mode=" + mode + " staged=" + String(staged) + " sensitivity=" + sensitivity)
      // THE SETTLEMENT (rule 4): the counter resets, the instant is stamped and a really staged plan
      // is remembered, so a restart neither re-nags nor loses the volume. `acted` is the settled VIEW
      // the install outcome exposes; `state.lastFiredAt` is what the gate itself reads.
      await recordFire(workspace, sessionId, state, staged ? outcome.planId : "")
      if (agentId !== "") acted.add(agentId)
      /** The ONE notice: the mechanical text only when a plan is really staged, else the advisory one. */
      const notice = dsh.userMessage({
        text: staged
          ? mechanicalNoticeText({ planId: outcome.planId, signals: verdict.signals, explicit: consumed.flagged, alreadyStaged: outcome.alreadyStaged, strength: verdict.strength })
          // THE RUNG TRAVELS WITH THE NOTICE (contract §10 A4): one short clause, no new line, so the
          // reader learns WHO admitted the work beside the signals that fired.
          : advisoryNoticeText(verdict.signals, consumed.flagged, verdict.strength),
        // A PRODUCER-OWNED source kind, never the retired `{kind:"plugin"}` wrapper: the
        // 0.1.7 session format (v4) REJECTS that kind at append time —
        // `dsh-session-format-v3-to-v4` `source()` throws "format v4 message requires a
        // producer-owned source kind" — and MEASURED 2026-09-27 that took the whole boot down
        // (exit 1, 7 session records) the moment the notice was injected. The vocabulary is a
        // merge-extensible sum type with no shared `plugin` member: every producer names
        // itself, exactly like `agent-instructions` and `goal` do.
        // ONE reason string for BOTH notices on purpose: this is the source shape a live boot has
        // already accepted, and the notice TEXT is what distinguishes the two routes.
        source: { kind: "mpd-roles", reason: "session-start-advisory" },
      })
      // The explicit `team:` marker is CONSUMED from the user's own turn on the way through.
      return spliceNotice(decision, decisionMessages, rawClaimed, notice, (message) => (message === user.message ? consumeFlagFromMessage(message, user.text) : message))
    } catch (error) {
      // A gate failure never breaks a step: the harness's own decision stands.
      warn("session-start gate failed (" + errorText(error) + ") — the step runs unchanged")
      return undefined
    }
  }

  /** Tear the gate down for ONE disposed agent scope. */
  const release = (agent: unknown): void => {
    /** This agent's disposer, or undefined when it never carried a listener. */
    const dispose = disposers.get(agent)
    if (dispose === undefined) return
    disposers.delete(agent)
    try {
      dispose()
    } catch { /* a failed teardown must not break agent disposal */ }
  }

  /** Register the gate for ONE newly discovered agent, at most once per agent handle. */
  const register = (agent: unknown): void => {
    // A duplicate registration would be a second listener on the same scope, i.e. a second notice
    // per step: the agent HANDLE itself is the key, exactly as the roster section's name is.
    if (agent === undefined || agent === null || disposers.has(agent)) return
    try {
      // Scope first: another preset's session and a subagent/member session never get a gate.
      if (!sessionQualifies(agent, presets)) return
      /** The scope's own disposer, or a no-op when it returned none. */
      const dispose = dsh.registerAgentPreStep(agent, stepHandler(agent))
      disposers.set(agent, typeof dispose === "function" ? dispose : () => { /* no-op */ })
      /** The preset this agent's session was created under, quoted in the registration line. */
      const preset = (agent as { session?: { header?: { agentPreset?: unknown } } } | undefined)?.session?.header?.agentPreset
      report('session gate listener registered for agent "' + String((agent as { id?: unknown }).id ?? "?")
        + '" agentPreset=' + (preset === undefined ? "none" : String(preset)))
      gateTrace("registered agent=" + String((agent as { id?: unknown }).id ?? "?"))
    } catch (error) {
      // A scope that refuses the listener degrades with ONE warning per agent; the boot and
      // every other session stay untouched.
      warn("session-start gate not registered for agent \""
        + String((agent as { id?: unknown } | undefined)?.id ?? "?")
        + "\" (" + errorText(error) + ")")
    }
  }

  // THE CONSULT COUNTER FIRST: the volume trigger must see a consult that completes before the
  // session's first counted pre-step, so the ONE per-tool subscription is armed before any listener.
  subscribeConsultCounter()
  for (const agent of dsh.liveAgents()) register(agent)
  /** Subscribe to an agent lifecycle event, degrading silently when the bus is absent. */
  const subscribe = (event: string, handler: (payload: unknown) => void): void => {
    try {
      dsh.onEvent(event, handler)
    } catch { /* a missing event bus leaves the LIVE registrations above in place */ }
  }
  subscribe("agent/created", (payload: unknown) => register((payload as { agent?: unknown } | undefined)?.agent ?? payload))
  subscribe("agent/disposed", (payload: unknown) => release((payload as { agent?: unknown } | undefined)?.agent ?? payload))
  // The MODE and the SENSITIVITY are resolved ONCE here, for the boot line ONLY: `installSessionGate`
  // is a synchronous installer, and every fire re-resolves both through `configValue` (never cached).
  return {
    installed: true,
    acted,
    disposers,
    mode: resolveGateMode(configValue(GATE_CONFIG_KEY)),
    sensitivity: resolveSensitivity(configValue(SENSITIVITY_CONFIG_KEY)),
  }
}

/** The cwd used for the boulder probe (documented for callers that pass an agent). */
export function gateWorkspaceOf(agent: unknown): string | undefined {
  return sessionCwdOf(agent)
}
