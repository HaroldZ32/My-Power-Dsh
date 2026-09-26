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
  const seen = new Set<string>()
  for (const match of text.matchAll(pattern)) seen.add(match[0].toLowerCase())
  return seen.size
}

/** Lines that read as enumerated steps (numbered, bulleted, table rows). */
function enumeratedLineCount(text: string): number {
  let count = 0
  for (const line of text.split("\n")) if (ENUMERATED_LINE_PATTERN.test(line)) count += 1
  return count
}

/** Clauses that OPEN with an action verb. */
function clauseStepCount(text: string): number {
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
  const source = String(text ?? "")
  const trimmed = source.trimStart()
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
  const source = String(text ?? "")
  const signals: string[] = []
  if (input.explicitFlag === true) signals.push("A")
  if (distinctMatches(source, DELIVERABLE_VERB_PATTERN) >= DELIVERABLE_VERB_MIN) signals.push("B")
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
    const read = readdirFn ?? readdirFs
    const entries = await read(join(String(workspace ?? ""), ...PLANS_DIR))
    return Array.isArray(entries) && entries.some((entry) => String(entry).endsWith(".md"))
  } catch {
    return false
  }
}

/** The text of one message's text blocks, joined; `undefined` when it has none. */
function messageText(message: unknown): string | undefined {
  const content = (message as { content?: unknown } | undefined)?.content
  if (!Array.isArray(content)) return undefined
  const parts = content
    .filter((block): block is { type: string; text: string } => (block as { type?: unknown })?.type === "text" && typeof (block as { text?: unknown }).text === "string")
    .map((block) => block.text)
  return parts.length === 0 ? undefined : parts.join("\n")
}

/** The LAST user-role message among the candidates that carries text. */
export function latestUserMessage(candidates: readonly unknown[]): { message: unknown; text: string } | undefined {
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const message = candidates[index]
    if ((message as { role?: unknown } | undefined)?.role !== "user") continue
    const text = messageText(message)
    if (text !== undefined) return { message, text }
  }
  return undefined
}

/** Rewrite a claimed user message with the explicit marker CONSUMED (text blocks only). */
export function consumeFlagFromMessage(message: unknown, source: string): unknown {
  if (!consumeExplicitFlag(source).flagged) return message
  let changed = false
  const content = ((message as { content?: unknown[] } | undefined)?.content ?? []).map((block) => {
    const text = (block as { text?: unknown } | undefined)?.text
    if ((block as { type?: unknown } | undefined)?.type !== "text" || typeof text !== "string") return block
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
  const header = (agent as { session?: { header?: Record<string, unknown> } } | undefined)?.session?.header
  if (header === undefined || header === null) return false
  if (header.parentSession !== undefined) return false
  const preset = header.agentPreset
  if (preset === undefined) return true
  return presets.includes(String(preset))
}

/** The session workspace of one agent, or `undefined` when it declares none. */
function sessionCwdOf(agent: unknown): string | undefined {
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

export interface SessionGateOptions {
  /** Presets whose top-level sessions are covered (default: `["mpd"]`). */
  presets?: readonly string[]
  /** One-line reporter for a contained failure. */
  warn: (line: string) => void
  /** `readdir` injection for the plan-artifact probe (tests); defaults to `node:fs/promises`. */
  readdir?: (path: string) => Promise<string[]>
}

export interface SessionGateInstall {
  installed: boolean
  /** Per-agent settlement registry (exposed for tests and for a future reset seam). */
  settled: Set<string>
}

/**
 * Install the gate on the `agent/pre-step` waterfall through the adapter.
 *
 * The listener runs AFTER the inner chain (the adapter owns `next()`), so it sees the
 * decision the step would really run with and returns an amended copy — never the raw
 * harness objects from its own re-construction. It settles ONCE per agent, and only after
 * it actually judged a user text: a first step that claims no user message leaves the
 * session unsettled rather than silently skipping the gate forever.
 */
export function installSessionGate(
  dsh: Pick<DshAdapter, "onAgentPreStep" | "userMessage" | "workspaceRoot">,
  options: SessionGateOptions,
): SessionGateInstall {
  const presets = options.presets ?? DEFAULT_GATE_PRESETS
  const settled = new Set<string>()
  const dispose = dsh.onAgentPreStep(async (payload: DshAgentPreStep, decision: DshPreStepDecision) => {
    try {
      if (decision?.kind === "reject") return undefined
      const agent = payload?.agent
      if (agent === undefined || agent === null) return undefined
      if (!sessionQualifies(agent, presets)) return undefined
      const agentId = String((agent as { id?: unknown }).id ?? "")
      if (agentId !== "" && settled.has(agentId)) return undefined
      const claimed = Array.isArray(decision?.messages) ? decision.messages : (payload?.messages ?? [])
      const user = latestUserMessage(claimed)
      // Nothing to judge yet: leave the session unsettled so the first REAL user turn is
      // still evaluated, instead of spending the one evaluation on an empty step.
      if (user === undefined) return undefined
      if (agentId !== "") settled.add(agentId)
      const workspace = dsh.workspaceRoot({ agent } as never)
      const consumed = consumeExplicitFlag(user.text)
      const planArtifact = await hasPlanArtifact(workspace, options.readdir)
      const verdict = evaluateComplexityGate(consumed.text, { explicitFlag: consumed.flagged, planArtifact })
      if (verdict.trigger !== true) return undefined
      const notice = dsh.userMessage({
        text: advisoryNoticeText(verdict.signals, consumed.flagged),
        source: { kind: "plugin", plugin: "mpd-roles", reason: "session-start-advisory" },
      })
      const messages = (Array.isArray(decision?.messages) ? [...decision.messages] : [...(payload?.messages ?? [])])
        .map((message) => (message === user.message ? consumeFlagFromMessage(message, user.text) : message))
      // `toSpliced`/`findLastIndex` semantics without the ES2023 lib: the notice lands
      // right after the LAST claimed message, exactly where the retired implementation
      // placed it (a step can claim more than one message).
      let lastClaimed = -1
      for (let at = 0; at < messages.length; at += 1) if (claimed.includes(messages[at])) lastClaimed = at
      const at = lastClaimed < 0 ? messages.length : lastClaimed + 1
      // `toSpliced` semantics: the notice lands right after the claimed user turn, exactly
      // where the retired implementation placed it.
      const amended = [...messages.slice(0, at), notice, ...messages.slice(at)]
      return { ...decision, kind: decision?.kind ?? "enter", messages: amended }
    } catch (error) {
      // A gate failure never breaks a step: the harness's own decision stands.
      options.warn("session-start gate failed (" + (error instanceof Error ? error.message : String(error)) + ") — the step runs unchanged")
      return undefined
    }
  })
  return { installed: typeof dispose === "function", settled }
}

/** The cwd used for the plan-artifact probe (documented for callers that pass an agent). */
export function gateWorkspaceOf(agent: unknown): string | undefined {
  return sessionCwdOf(agent)
}
