// The session-start complexity gate (AGENTS.md §1), re-implemented on the OFFICIAL Agent
// Teams plugin's seams after the vendored body that used to own it was retired.
//
// The frozen predicate is `trigger = explicit flag OR (matchedSignals >= 1)` with four
// signals, reproduced VERBATIM from the retired implementation
// (`packages/mpd-agent-teams-plugin/lib/session-start.js`, read as the SPEC — never
// mounted or imported):
//   A (hard) `team:` prefix or `!team` anywhere; the marker is CONSUMED from the goal text;
//   B (soft) >= 4 distinct deliverable verbs;
//   C (soft) ONE signal that fires when >= 2 of its three sub-signals hold (>= 3 enumerated
//            lines, >= 3 distinct action verbs, >= 3 action clauses);
//   D (soft) a `.mpd/plans/*.md` artifact exists for the session workspace.
//
// The gate ADVISES and stages NOTHING — including for an explicit `team:` / `!team` request,
// which is only a stronger reason to advise. It injects ONE user-role notice carrying the
// marker `[AgentTeams] Session-start team rule`, naming the fired signals, and telling the
// captain to stage a team itself with the official tools (`spawn_teammate` +
// `team_task_create`) at the moment the work warrants one.
//
// Scope: the mpd preset's own top-level sessions only. A child session (subagent, teammate,
// workflow worker) never gets its own gate, and neither does another preset's session.
import { readdir as readdirFs } from "node:fs/promises"
import { join } from "node:path"
import type { DshAdapter, DshAgentPreStep, DshPreStepDecision } from "../../mpd-dsh-adapter-plugin/src/index"

/** The notice marker (frozen; AGENTS.md §1 and the retired implementation both carry it). */
export const STARTUP_NOTICE_MARKER = "[AgentTeams] Session-start team rule"

/** Signal B: deliverable verbs (English + CJK), counted by DISTINCT match. */
export const DELIVERABLE_VERB_PATTERN = /(align|migrate|refactor|audit|overhaul|port|rewrite|consolidate|对齐|重构|迁移|审计|移植|梳理|全量)/giu
/** Signal C2: action verbs (English + CJK), counted by DISTINCT match. */
export const ACTION_VERB_PATTERN = /\b(?:add|align|audit|build|change|check|consolidate|implement|migrate|overhaul|port|refactor|rewrite|verify)\b|设计|实现|验证|改造|补充|对齐|重构|迁移|审计|移植|梳理|全量/giu
/** Signal C1: numbered / bulleted / table rows that read as enumerated steps. */
export const ENUMERATED_LINE_PATTERN = /^\s*(?:\d+[.)]|[-*|])\s/u
/** Signal C: clause separators — a single-line plan enumerates steps through punctuation too. */
export const CLAUSE_SEPARATOR_PATTERN = /[\n\r;:,.]/u
/** Signal C3: a clause that OPENS (optionally after a conjunction) with an action verb. */
export const CLAUSE_ACTION_PATTERN = /^\s*(?:(?:and|then|also)\s+)?(?:\b(?:add|align|audit|build|change|check|consolidate|implement|migrate|overhaul|port|refactor|rewrite|verify)\b|设计|实现|验证|改造|补充|对齐|重构|迁移|审计|移植|梳理|全量)/iu
/** Signal B threshold: distinct deliverable-verb matches. */
export const DELIVERABLE_VERB_MIN = 4
/** Signal C1 and C3 threshold: enumerated lines / positional clauses. */
export const ENUMERATED_LINE_MIN = 3
/** Signal C2 threshold: distinct action-verb matches. */
export const ACTION_VERB_MIN = 3
/** Signal C: how many of its three sub-signals must hold (its own majority). */
export const C_SUBSIGNAL_MIN = 2
/** Signal D: the plan-artifact directory, relative to the session workspace. */
export const PLANS_DIR = [".mpd", "plans"] as const
/** The presets whose top-level sessions the gate covers. */
export const DEFAULT_GATE_PRESETS: readonly string[] = ["mpd"]

/** Distinct matches of one global pattern (`matchAll` needs the `g` flag). */
function distinctMatches(text: string, pattern: RegExp): number {
  /** The distinct spellings this pattern matched, lowercased so casing cannot inflate the count. */
  const seen = new Set<string>()
  for (const match of text.matchAll(pattern)) seen.add(match[0].toLowerCase())
  return seen.size
}

/** Lines that read as enumerated steps (numbered, bulleted, table rows). */
function enumeratedLineCount(text: string): number {
  /** Lines that read as enumerated steps so far. */
  let count = 0
  for (const line of text.split("\n")) if (ENUMERATED_LINE_PATTERN.test(line)) count += 1
  return count
}

/** Clauses that OPEN with an action verb. */
function clauseStepCount(text: string): number {
  /** Clauses that open with an action verb so far. */
  let count = 0
  for (const clause of text.split(CLAUSE_SEPARATOR_PATTERN)) if (CLAUSE_ACTION_PATTERN.test(clause)) count += 1
  return count
}

/**
 * The hard explicit flag and the text with its marker CONSUMED.
 *
 * `team:` is only an activation prefix when it opens the trimmed text; a bare `!team`
 * anywhere activates. Frozen from the retired implementation — the marker must not reach
 * the model as part of the goal.
 */
export function consumeExplicitFlag(text: string): { flagged: boolean; text: string } {
  /** The message text as given, before any marker is consumed. */
  const source = String(text ?? "")
  /** The text with leading whitespace removed, which is where a `team:` prefix may open. */
  const trimmed = source.trimStart()
  /** The `team:` prefix match, or null when the flag is not spelled that way. */
  const prefix = /^team:\s*/iu.exec(trimmed)
  if (prefix !== null) return { flagged: true, text: trimmed.slice(prefix[0].length) }
  if (/!team/iu.test(source)) return { flagged: true, text: source.replace(/!team\s*/giu, "") }
  return { flagged: false, text: source }
}

/**
 * Evaluate the frozen gate. `trigger = explicitFlag OR (matchedSignals >= 1)`.
 *
 * C is ONE signal: its own 2-of-3 majority is established FIRST, and C1/C2/C3 are never
 * counted as separate top-level signals. A satisfied C is therefore sufficient on its own —
 * the ratified Option A predicate, with the multi-clause false positive as its accepted,
 * ledgered cost (the frozen complex prompts #1/#3 carry C as their only signal).
 */
export function evaluateComplexityGate(
  text: string,
  input: { explicitFlag?: boolean; planArtifact?: boolean } = {},
): { trigger: boolean; signals: string[] } {
  /** The goal text as given; a non-string reads as empty rather than throwing. */
  const source = String(text ?? "")
  /** The fired signal letters, in A to D order, which is what the notice names. */
  const signals: string[] = []
  if (input.explicitFlag === true) signals.push("A")
  if (distinctMatches(source, DELIVERABLE_VERB_PATTERN) >= DELIVERABLE_VERB_MIN) signals.push("B")
  /** How many of signal C's three sub-signals hold (its own 2-of-3 majority). */
  const cSubSignals = [
    enumeratedLineCount(source) >= ENUMERATED_LINE_MIN,
    distinctMatches(source, ACTION_VERB_PATTERN) >= ACTION_VERB_MIN,
    clauseStepCount(source) >= ENUMERATED_LINE_MIN,
  ].filter(Boolean).length
  if (cSubSignals >= C_SUBSIGNAL_MIN) signals.push("C")
  if (input.planArtifact === true) signals.push("D")
  return { trigger: input.explicitFlag === true || signals.length >= 1, signals }
}

/** Whether a `.mpd/plans/*.md` artifact exists for one workspace (never throws). */
export async function hasPlanArtifact(workspace: string, readdirFn?: (path: string) => Promise<string[]>): Promise<boolean> {
  try {
    /** The directory reader: the injected seam in a test, `node:fs/promises` in a boot. */
    const read = readdirFn ?? readdirFs
    /** The plan directory's entries; a missing directory is caught below and reads as no artifact. */
    const entries = await read(join(String(workspace ?? ""), ...PLANS_DIR))
    return Array.isArray(entries) && entries.some((entry) => String(entry).endsWith(".md"))
  } catch {
    return false
  }
}

/** The text of one message's text blocks, joined; `undefined` when it has none. */
function messageText(message: unknown): string | undefined {
  /** The message's content blocks, when it carries an array of them. */
  const content = (message as { content?: unknown } | undefined)?.content
  if (!Array.isArray(content)) return undefined
  /** The text of every text block, in order; other block kinds are dropped. */
  const parts = content
    .filter((block): block is { type: string; text: string } => (block as { type?: unknown })?.type === "text" && typeof (block as { text?: unknown }).text === "string")
    .map((block) => block.text)
  return parts.length === 0 ? undefined : parts.join("\n")
}

/**
 * The user's OWN turn among the candidates — the goal text the gate judges.
 *
 * MEASURED 2026-09-27 (one instrumented live boot, the defect that made the gate silent):
 * the step's DECISION carries the claimed turn PLUS the user-role notice the harness itself
 * splices in — `{role:"user", source:{kind:"runtime-context"}, text:"Current runtime context.
 * This snapshot supersedes earlier ru…"}` — so "the last user-role message" is NOT the goal.
 * The gate judged that snapshot on every triggered prompt and the predicate was always false.
 *
 * The rule is therefore SOURCE-AWARE: a message whose `source.kind` is `user` is the caller's
 * own turn and wins (the LAST such message); only when a host tags no message that way does
 * this fall back to the last user-role message with text. Callers pass the PAYLOAD's raw
 * claimed list first (before the injected notices are spliced onto the decision).
 */
export function latestUserMessage(candidates: readonly unknown[]): { message: unknown; text: string } | undefined {
  /** The last user-role message with text, used only when no message is tagged as the caller's own. */
  let fallback: { message: unknown; text: string } | undefined
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    /** The candidate under inspection, walked from newest to oldest. */
    const message = candidates[index]
    if ((message as { role?: unknown } | undefined)?.role !== "user") continue
    /** The candidate's joined text, or undefined when it has no text blocks. */
    const text = messageText(message)
    if (text === undefined) continue
    /** The message's source kind, which is what separates the real turn from an injected notice. */
    const source = String((message as { source?: { kind?: unknown } } | undefined)?.source?.kind ?? "")
    if (source === "user") return { message, text }
    fallback ??= { message, text }
  }
  return fallback
}

/** Rewrite a claimed user message with the explicit marker CONSUMED (text blocks only). */
export function consumeFlagFromMessage(message: unknown, source: string): unknown {
  if (!consumeExplicitFlag(source).flagged) return message
  /** Whether any text block actually lost the marker. */
  let changed = false
  /** The rewritten content blocks, with the marker consumed from every block that carried it. */
  const content = ((message as { content?: unknown[] } | undefined)?.content ?? []).map((block) => {
    /** This block's text, when the block is a text block. */
    const text = (block as { text?: unknown } | undefined)?.text
    if ((block as { type?: unknown } | undefined)?.type !== "text" || typeof text !== "string") return block
    /** This block's text with the explicit flag consumed. */
    const next = consumeExplicitFlag(text)
    if (next.text === text) return block
    changed = true
    return { ...(block as object), text: next.text }
  })
  return changed ? { ...(message as object), content } : message
}

/**
 * Whether one agent's SESSION is covered by the gate: a top-level session of one of the
 * configured presets.
 *
 * A child session (subagent, teammate, workflow worker, ralph round) already belongs to a
 * parent's team — it must never be told to stage one of its own. A session that names a
 * preset must be on the list; a session with NO preset at all (the headless direct driver,
 * legacy installs) deploys the bundle itself and stays covered.
 */
export function sessionQualifies(agent: unknown, presets: readonly string[] = DEFAULT_GATE_PRESETS): boolean {
  /** The agent's session header, which carries the parent link and the preset. */
  const header = (agent as { session?: { header?: Record<string, unknown> } } | undefined)?.session?.header
  if (header === undefined || header === null) return false
  if (header.parentSession !== undefined) return false
  /** The session's preset name; absent means a preset-less session, which still qualifies. */
  const preset = header.agentPreset
  if (preset === undefined) return true
  return presets.includes(String(preset))
}

/** The session workspace of one agent, or `undefined` when it declares none. */
function sessionCwdOf(agent: unknown): string | undefined {
  /** The session's declared workspace, when it declares a non-empty one. */
  const cwd = (agent as { session?: { header?: { cwd?: unknown } } } | undefined)?.session?.header?.cwd
  return typeof cwd === "string" && cwd.length > 0 ? cwd : undefined
}

/**
 * The advisory notice text: what fired, that NOTHING was staged, and what to do instead.
 *
 * One model pays for this text once per session, so it stays short; the staging tools are
 * the OFFICIAL ones (`spawn_teammate`, `team_task_create`), never the retired
 * `agent_teams_*` vocabulary.
 */
export function advisoryNoticeText(signals: readonly string[], explicit: boolean): string {
  /** The fired signals as a readable list, or the generic wording when none is named. */
  const matched = signals.length === 0 ? "complexity signals" : "complexity signals " + signals.join("/")
  return STARTUP_NOTICE_MARKER + ": this session shows " + matched + ", and NO team was staged — the gate is ADVISORY "
    + "and stages nothing while complexity is merely being judged."
    + (explicit ? "\n- The explicit `team:` / `!team` marker was CONSUMED from the goal text: the request is a reason to stage, not a staged team." : "")
    + "\n- Stage a team yourself at the moment the work actually warrants one: `spawn_teammate` creates each roster teammate"
    + " (its prompt text comes from `mpd_role_persona`) and `team_task_create` opens its lane on the shared board; then tell"
    + " the user the Web plan is ready for review."
    + "\n- If the work does not warrant a team (a short or single-threaded task), continue solo — and say so in one line."
    + "\n- A team is NOT a precondition of this session, and you may not create a second team while leading one."
}

/**
 * One-line diagnostics for a live boot, enabled with `MPD_ROLES_GATE_TRACE=1`.
 *
 * WHY THIS EXISTS: the gate failed once as "mounted, silent, no error", and neither a unit
 * test nor the install line could say WHERE it stopped (never dispatched? wrong agent?
 * unqualified session? predicate false?). This hook answers that from the boot log itself.
 */
function gateTrace(line: string): void {
  try {
    if (process.env.MPD_ROLES_GATE_TRACE === "1") console.log("[mpd-roles] gate trace: " + line)
  } catch { /* tracing must never take the gate down */ }
}

/** What installing the gate needs: the covered presets, the two reporters and the probe seam. */
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
  /** `readdir` injection for the plan-artifact probe (tests); defaults to `node:fs/promises`. */
  readdir?: (path: string) => Promise<string[]>
}

/** The gate's install outcome, exposed so a mount lane can assert it. */
export interface SessionGateInstall {
  /** Always true: the gate degrades per agent rather than failing as a whole. */
  installed: boolean
  /** Per-agent settlement registry (exposed for tests and for a future reset seam). */
  settled: Set<string>
  /** One disposer per agent whose scope carries a gate listener. */
  disposers: Map<unknown, () => void>
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
 * fallback. Settlement is per agent id and the notice is injected ONCE: after it fires, that
 * agent's later steps return the downstream decision untouched.
 */
export function installSessionGate(
  dsh: Pick<DshAdapter, "registerAgentPreStep" | "liveAgents" | "onEvent" | "userMessage" | "workspaceRoot">,
  options: SessionGateOptions,
): SessionGateInstall {
  /** The presets whose top-level sessions are covered. */
  const presets = options.presets ?? DEFAULT_GATE_PRESETS
  /** Agent ids that have already spent their ONE evaluation. */
  const settled = new Set<string>()
  /** One disposer per agent whose scope carries a gate listener. */
  const disposers = new Map<unknown, () => void>()
  /** Emit a boot-log line without letting a throwing logger take the gate down. */
  const report = (line: string): void => {
    try {
      options.log?.(line)
    } catch { /* logging must never take the gate down */ }
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
      /** The bound agent's id; an empty one cannot be settled and is judged on every step. */
      const agentId = String((agent as { id?: unknown }).id ?? "")
      if (agentId !== "" && settled.has(agentId)) return undefined
      // THE GOAL COMES FROM THE RAW CLAIMED LIST (the payload), never from the decision:
      // the decision also carries the harness's injected runtime-context turn (measured), and
      // judging that snapshot made the predicate false on every triggered prompt.
      const decisionMessages = Array.isArray(decision?.messages) ? decision.messages : []
      /** The step's raw claimed messages, or the decision's list when the payload carries none. */
      const rawClaimed = Array.isArray(payload?.messages) && payload.messages.length > 0 ? payload.messages : decisionMessages
      /** The user's own turn, preferring the payload's raw list over the spliced decision. */
      const user = latestUserMessage(rawClaimed) ?? latestUserMessage(decisionMessages)
      // Nothing to judge yet: leave the session unsettled so the first REAL user turn is
      // still evaluated, instead of spending the one evaluation on an empty step.
      if (user === undefined) { gateTrace("no user text yet agent=" + agentId); return undefined }
      if (agentId !== "") settled.add(agentId)
      /** The workspace the plan-artifact probe reads, resolved from the bound agent. */
      const workspace = dsh.workspaceRoot({ agent } as never)
      /** The goal text with the explicit marker removed, plus whether it was there. */
      const consumed = consumeExplicitFlag(user.text)
      /** Signal D's input: whether a plan artifact exists for this workspace. */
      const planArtifact = await hasPlanArtifact(workspace, options.readdir)
      /** The frozen predicate's answer: whether it triggered, and which signals fired. */
      const verdict = evaluateComplexityGate(consumed.text, { explicitFlag: consumed.flagged, planArtifact })
      if (verdict.trigger !== true) { gateTrace("predicate false agent=" + agentId + " text=" + JSON.stringify(user.text.slice(0, 60))); return undefined }
      report('session gate fired for agent "' + agentId + '" signals=' + verdict.signals.join("/") + " advisory=1 staged=0")
      gateTrace("FIRING agent=" + agentId + " signals=" + verdict.signals.join("/"))
      /** The ONE advisory notice, built through the adapter so its source kind is producer-owned. */
      const notice = dsh.userMessage({
        text: advisoryNoticeText(verdict.signals, consumed.flagged),
        // A PRODUCER-OWNED source kind, never the retired `{kind:"plugin"}` wrapper: the
        // 0.1.7 session format (v4) REJECTS that kind at append time —
        // `dsh-session-format-v3-to-v4` `source()` throws "format v4 message requires a
        // producer-owned source kind" — and MEASURED 2026-09-27 that took the whole boot down
        // (exit 1, 7 session records) the moment the notice was injected. The vocabulary is a
        // merge-extensible sum type with no shared `plugin` member: every producer names
        // itself, exactly like `agent-instructions` and `goal` do.
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
      options.warn("session-start gate failed (" + (error instanceof Error ? error.message : String(error)) + ") — the step runs unchanged")
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

  /** Register the gate in ONE qualifying agent's own scope. */
  const register = (agent: unknown): void => {
    try {
      if (agent === undefined || agent === null || disposers.has(agent)) return
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
      options.warn("session-start gate not registered for agent \""
        + String((agent as { id?: unknown } | undefined)?.id ?? "?")
        + "\" (" + (error instanceof Error ? error.message : String(error)) + ")")
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
  return { installed: true, settled, disposers }
}


/** The cwd used for the plan-artifact probe (documented for callers that pass an agent). */
export function gateWorkspaceOf(agent: unknown): string | undefined {
  return sessionCwdOf(agent)
}
