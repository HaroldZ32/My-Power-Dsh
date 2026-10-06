// The session-start complexity gate — the WIRING half (AGENTS.md §1).
//
// The PURE half (patterns, thresholds, predicate, the boulder read, both notice builders, the mode
// resolver) lives in `./complexity-gate.ts`, which resolves under plain `node` and is what the QA
// case and the unit tests import. THIS file owns the three things that need a live harness:
//   1. ONE `agent/pre-step` listener PER QUALIFYING AGENT, registered in that agent's own scope;
//   2. the per-call config read (`team.gate`, `boulder.dir`) and the workspace/session resolution;
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
// Scope: the mpd preset's own top-level sessions only. A child session (subagent, teammate,
// workflow worker) never gets its own gate, and neither does another preset's session.
import type { DshAdapter, DshAgentPreStep, DshPreStepDecision } from "../../mpd-dsh-adapter-plugin/src/index"
import { rowLogLine } from "../../mpd-dsh-adapter-plugin/src/index"
import {
  advisoryNoticeText,
  BOULDER_DIR_CONFIG_KEY,
  consumeExplicitFlag,
  consumeFlagFromMessage,
  DEFAULT_GATE_PRESETS,
  evaluateComplexityGate,
  GATE_CONFIG_KEY,
  GATE_MODE_MECHANICAL,
  GATE_MODE_OFF,
  gatePlanShell,
  latestUserMessage,
  mechanicalNoticeText,
  readBoulderGate,
  resolveBoulderDir,
  resolveGateMode,
  sessionQualifies,
  STAGING_TOOL_NAME,
  type GateMode,
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
 * payload reads as the empty string, which the notice renders as "plan id not reported".
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
}

/** The gate's install outcome, exposed so a mount lane can assert it. */
export interface SessionGateInstall {
  /** Always true: the gate degrades per agent rather than failing as a whole. */
  installed: boolean
  /**
   * Agent ids that have already FIRED their ONE notice. An id is written IMMEDIATELY BEFORE the
   * async staging call, so a re-entrant step can never stage a second plan; a step whose predicate
   * did NOT fire leaves the session unregistered and is judged again on the next user turn.
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
   * (`mechanical`) is reported. The AUTHORITATIVE mode is the one the FIRING line prints, because
   * every fire re-resolves it per call.
   */
  mode: GateMode
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
 * fallback. The notice is injected ONCE per agent, and the acted entry is recorded BEFORE the
 * async staging call so a re-entrant step can never stage twice.
 *
 * @param dsh - the adapter slice this row uses: the agent-scoped listener, the live agents, the
 *   event bus, the notice factory, the workspace resolver, and the two tool seams the staging call
 *   needs (`hasTool` / `executeTool`).
 * @param options - the covered presets, the reporters and the per-call seams (see the interface).
 * @returns the install outcome: the acted registry, the disposers and the resolved mode.
 */
export function installSessionGate(
  dsh: Pick<DshAdapter, "registerAgentPreStep" | "liveAgents" | "onEvent" | "userMessage" | "workspaceRoot" | "hasTool" | "executeTool">,
  options: SessionGateOptions,
): SessionGateInstall {
  /** The presets whose top-level sessions are covered. */
  const presets = options.presets ?? DEFAULT_GATE_PRESETS
  /** Agent ids that have already fired their ONE notice. */
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
      if (agentId !== "" && acted.has(agentId)) return undefined
      // THE MODE IS RESOLVED PER CALL (never cached): a `.mpd/mpd.jsonc` edit takes effect on the
      // next step, and `off` returns BEFORE the goal is even read.
      const mode: GateMode = resolveGateMode(configValue(GATE_CONFIG_KEY))
      if (mode === GATE_MODE_OFF) { gateTrace("mode off agent=" + agentId); return undefined }
      // THE GOAL COMES FROM THE RAW CLAIMED LIST (the payload), never from the decision:
      // the decision also carries the harness's injected runtime-context turn (measured), and
      // judging that snapshot made the predicate false on every triggered prompt.
      const decisionMessages = Array.isArray(decision?.messages) ? decision.messages : []
      /** The step's raw claimed messages, or the decision's list when the payload carries none. */
      const rawClaimed = Array.isArray(payload?.messages) && payload.messages.length > 0 ? payload.messages : decisionMessages
      /** The user's own turn, preferring the payload's raw list over the spliced decision. */
      const user = latestUserMessage(rawClaimed) ?? latestUserMessage(decisionMessages)
      // NOTHING TO JUDGE YET: the session stays unregistered, so the first REAL user turn is still
      // evaluated instead of a pre-step with no user text spending the one evaluation.
      if (user === undefined) { gateTrace("no user text yet agent=" + agentId); return undefined }
      /** The workspace the boulder probe reads and the staging call writes under. */
      const workspace = dsh.workspaceRoot({ agent } as never)
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
      /** The frozen predicate's answer: whether it triggered, and which signals fired. */
      const verdict = evaluateComplexityGate(consumed.text, { explicitFlag: consumed.flagged, activeBoulder: boulder.active })
      // NO TRIGGER = NO SETTLEMENT: the session is judged again on its next user turn, so a trivial
      // first turn can never spend the one evaluation on the complex turn that follows it.
      if (verdict.trigger !== true) { gateTrace("predicate false agent=" + agentId + " text=" + JSON.stringify(user.text.slice(0, 60))); return undefined }
      // THE RE-ENTRY GUARD, written IMMEDIATELY BEFORE the async stage: the harness may dispatch the
      // next pre-step while the staging call is still in flight, and a second stage would ARCHIVE the
      // plan the first one just staged. This agent is never judged again.
      if (agentId !== "") acted.add(agentId)
      /** What the mechanical route did; the advisory route leaves it at this degraded default. */
      let outcome: StageOutcome = { ok: false, planId: "", alreadyStaged: false }
      if (mode === GATE_MODE_MECHANICAL) {
        outcome = await stagePlan({
          agent,
          workspace,
          sessionId: sessionIdOf(agent),
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
      /** Whether a plan is staged in this session as a result of this fire. */
      const staged = mode === GATE_MODE_MECHANICAL && outcome.ok
      report('session gate fired for agent "' + agentId + '" signals=' + verdict.signals.join("/")
        + " mode=" + mode + " staged=" + (staged ? "1" : "0") + (outcome.planId === "" ? "" : " plan=" + outcome.planId))
      gateTrace("FIRING agent=" + agentId + " signals=" + verdict.signals.join("/") + " mode=" + mode + " staged=" + String(staged))
      /** The ONE notice: the mechanical text only when a plan is really staged, else the advisory one. */
      const notice = dsh.userMessage({
        text: staged
          ? mechanicalNoticeText({ planId: outcome.planId, signals: verdict.signals, explicit: consumed.flagged, alreadyStaged: outcome.alreadyStaged })
          : advisoryNoticeText(verdict.signals, consumed.flagged),
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
      /** The decision's messages with the explicit marker consumed from the user's own turn. */
      const messages = [...(decisionMessages.length > 0 ? decisionMessages : rawClaimed)]
        .map((message) => (message === user.message ? consumeFlagFromMessage(message, user.text) : message))
      // `toSpliced`/`findLastIndex` semantics without the ES2023 lib: the notice lands right
      // after the LAST claimed message, exactly where the retired implementation placed it.
      let lastClaimed = -1
      for (let at = 0; at < messages.length; at += 1) if (rawClaimed.includes(messages[at])) lastClaimed = at
      /** Index the notice is spliced at: right after the last still-claimed message. */
      const at = lastClaimed < 0 ? messages.length : lastClaimed + 1
      /** The amended message list the step continues with. */
      const amended = [...messages.slice(0, at), notice, ...messages.slice(at)]
      return { ...decision, kind: decision?.kind ?? "enter", messages: amended }
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

  for (const agent of dsh.liveAgents()) register(agent)
  /** Subscribe to an agent lifecycle event, degrading silently when the bus is absent. */
  const subscribe = (event: string, handler: (payload: unknown) => void): void => {
    try {
      dsh.onEvent(event, handler)
    } catch { /* a missing event bus leaves the LIVE registrations above in place */ }
  }
  subscribe("agent/created", (payload: unknown) => register((payload as { agent?: unknown } | undefined)?.agent ?? payload))
  subscribe("agent/disposed", (payload: unknown) => release((payload as { agent?: unknown } | undefined)?.agent ?? payload))
  // The MODE is resolved ONCE here, for the boot line ONLY: `installSessionGate` is a synchronous
  // installer, and every fire re-resolves it through `configValue` (never a cached mode).
  return { installed: true, acted, disposers, mode: resolveGateMode(configValue(GATE_CONFIG_KEY)) }
}

/** The cwd used for the boulder probe (documented for callers that pass an agent). */
export function gateWorkspaceOf(agent: unknown): string | undefined {
  return sessionCwdOf(agent)
}
