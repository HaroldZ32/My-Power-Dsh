// The session-start complexity gate — the PURE half (AGENTS.md §1). The WIRING half (per-agent
// listener registration, the staging call) lives in `session-gate.ts`.
//
// WHY THE SPLIT (P3, measured): `node skills/dsh-qa/scripts/session-start-team.ts --self-test`
// imports the gate's SOURCE under plain `node`, and the wiring module imports the harness ADAPTER,
// whose own chain uses extensionless relative specifiers that `node` refuses. This module is
// therefore node-resolvable by construction: `node:fs/promises` + `node:path` ONLY, no adapter
// import at all, so the QA case and the unit tests can drive the frozen predicate and the two
// notice builders without a boot.
//
// The frozen predicate is `trigger = explicit flag OR (matchedSignals >= 1)` with four signals,
// reproduced from the retired implementation (`packages/mpd-agent-teams-plugin/lib/session-start.ts`,
// read as the SPEC — never mounted or imported):
//   A (hard) a `team:` prefix or a token-boundary `!team`; the marker is CONSUMED from the goal text;
//   B (soft) >= 4 distinct deliverable verbs;
//   C (soft) ONE signal that fires when >= 2 of its three sub-signals hold (>= 3 enumerated
//            lines, >= 3 distinct action verbs, >= 3 action clauses);
//   D (soft) an ACTIVE boulder work exists for the session workspace. REPAIRED 2026-10-07: D used
//            to mean "some `.mpd/plans/*.md` exists", which MEASURABLY fired in EVERY session of
//            this workspace — its one plan file outlives the work that produced it.
//
// What a TRIGGER does is resolved per call by the wiring: `team.gate` selects `mechanical` (the
// default: stage an APPROVABLE SHELL through the `agent_teams_plan` tool), `advisory` (one notice,
// stage nothing) or `off`.
import { readFile as readFileFs } from "node:fs/promises"
import { join } from "node:path"

/** The notice marker (frozen; AGENTS.md §1 and the retired implementation both carry it). */
export const STARTUP_NOTICE_MARKER = "[AgentTeams] Session-start team rule"

/** The three `team.gate` modes; the default is {@link GATE_MODE_MECHANICAL}. */
export type GateMode = "mechanical" | "advisory" | "off"
/** The `team.gate` mode that stages a plan shell through the `agent_teams_plan` tool. */
export const GATE_MODE_MECHANICAL: GateMode = "mechanical"
/** The `team.gate` mode that only injects the advisory notice and stages nothing. */
export const GATE_MODE_ADVISORY: GateMode = "advisory"
/** The `team.gate` mode that makes the listener return immediately. */
export const GATE_MODE_OFF: GateMode = "off"
/** The mpd.jsonc / row-config key selecting the mode, resolved PER CALL and never cached. */
export const GATE_CONFIG_KEY = "team.gate"
/** The mpd.jsonc key overriding the boulder state root (`mpd-boulder` honours the same one). */
export const BOULDER_DIR_CONFIG_KEY = "boulder.dir"

/**
 * The conventional state-directory spellings a `boulder.dir` value may carry, which ALL mean "the
 * session workspace" rather than "a directory literally named `.mpd` under the root".
 *
 * WHY THE CONSUMERS NORMALIZE AT ALL, when an unset knob resolves to `undefined`: `.mpd` is what this
 * knob's RETIRED SCHEMA DEFAULT was (`z.string().default(".mpd")`), so it can still reach a consumer
 * from a layer this repository does not write — a settings form whose stored section carries the
 * materialized default, or a project file a user wrote to match what the form showed. The knob is a
 * STATE ROOT whose ledger is read at `<root>/.mpd/boulder.json`, so accepting the literal `.mpd` as a
 * root is exactly what DOUBLE-NESTED the path (`<ws>/.mpd/.mpd/boulder.json`) — MEASURED 2026-10-06,
 * where the contract path read `active:false` while the same bytes at the doubled path fired the
 * gate. ONE reading of this knob governs every consumer, so the rule lives here.
 */
export const WORKSPACE_ROOT_SPELLINGS: readonly string[] = [".", "./", ".mpd", ".mpd/", "./.mpd", "./.mpd/"]

/**
 * Resolve the state-root OVERRIDE one consumer should use, or `undefined` when the session workspace
 * is the right root.
 *
 * TOTAL and side-effect free: a non-string, an empty or whitespace-only value, and every
 * {@link WORKSPACE_ROOT_SPELLINGS} entry answer `undefined`, so a caller keeps its own
 * `?? workspace` fallback as the ONE place the workspace gets chosen. Any OTHER string is returned
 * TRIMMED and otherwise verbatim, so a path a user actually means still overrides.
 * @param value - the raw `boulder.dir` value from the config layer, of unknown type.
 * @returns the override root to use, or `undefined` for "the session workspace".
 */
export function resolveBoulderDir(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  /** The trimmed value, which is what the comparisons below and the caller both use. */
  const trimmed = value.trim()
  if (trimmed === "" || WORKSPACE_ROOT_SPELLINGS.includes(trimmed)) return undefined
  return trimmed
}
/** The tool the mechanical gate calls to stage the plan (the single writer of the staging store). */
export const STAGING_TOOL_NAME = "agent_teams_plan"
/** The plan-extension actions the mechanical notice names, in the order it names them. */
export const PLAN_EXTEND_ACTIONS: readonly string[] = ["add_member", "create_task"]
/** The mechanical notice's phrase for a plan THIS fire staged. */
export const STAGED_PLAN_PHRASE = "a team PLAN was STAGED"
/** The mechanical notice's phrase when a plan was already staged (the gate skipped staging). */
export const ALREADY_STAGED_PLAN_PHRASE = "a team PLAN is ALREADY STAGED"
/** The mechanical notice's inertness sentence: staging is not spawning. */
export const INERT_PLAN_PHRASE = "NOTHING has been spawned; the plan is INERT until approved"
/** The advisory notice's staging disclaimer (the advisory route must never claim a staged plan). */
export const NO_TEAM_STAGED_PHRASE = "NO team was staged"
/** The permission to continue solo, which BOTH notices state so an unapproved shell is never a trap. */
export const SOLO_PERMISSION_SENTENCE = "- If the work does not warrant a team (a short or single-threaded task), continue solo"
/** The sentence the shipped preset must NOT carry any more: an explicit flag is no longer merely advised. */
export const DRIFTED_ADVISORY_SENTENCE = "routed to team mode"
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
/** The plan NAME cap: the staged shell's name is the goal's first line, clipped to this many chars. */
export const GATE_PLAN_NAME_MAX = 60
/** How much of the goal the staged shell's DESCRIPTION inlines, in chars. */
export const GATE_PLAN_EXCERPT_MAX = 500
/** The shell name used when the goal's first line collapses to nothing (a whitespace-only turn). */
export const GATE_PLAN_NAME_FALLBACK = "session-start complexity gate team"
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
 * `team:` is only an activation prefix when it opens the trimmed text; a `!team` activates when it
 * stands on a TOKEN BOUNDARY (start of text or after whitespace). Frozen from the retired
 * implementation with ONE repair (P8, 2026-10-07): the retired code stripped EVERY `!team` with a
 * global replace, so a quoted or code-span `!team` in the goal body was silently deleted. Only
 * the EARLIEST boundary occurrence is consumed now, and a merely QUOTED occurrence (preceded by a
 * non-space character such as `"` or a backtick) is neither an activation nor stripped.
 */
export function consumeExplicitFlag(text: string): { flagged: boolean; text: string } {
  /** The message text as given, before any marker is consumed. */
  const source = String(text ?? "")
  /** The text with leading whitespace removed, which is where a `team:` prefix may open. */
  const trimmed = source.trimStart()
  /** The `team:` prefix match, or null when the flag is not spelled that way. */
  const prefix = /^team:\s*/iu.exec(trimmed)
  if (prefix !== null) return { flagged: true, text: trimmed.slice(prefix[0].length) }
  /** The EARLIEST token-boundary `!team`; a quoted occurrence never matches. */
  const marker = /(^|\s)!team\b/iu.exec(source)
  if (marker !== null) return { flagged: true, text: source.replace(/(^|\s)!team\b\s*/iu, "$1") }
  return { flagged: false, text: source }
}

/**
 * Evaluate the frozen gate. `trigger = explicitFlag OR (matchedSignals >= 1)`.
 *
 * C is ONE signal: its own 2-of-3 majority is established FIRST, and C1/C2/C3 are never
 * counted as separate top-level signals. A satisfied C is therefore sufficient on its own —
 * the ratified Option A predicate, with the multi-clause false positive as its accepted,
 * ledgered cost (the frozen complex prompts #1/#3 carry C as their only signal).
 *
 * D reads `activeBoulder` — the caller's `readBoulderGate` verdict, NOT a plan-file probe.
 */
export function evaluateComplexityGate(
  text: string,
  input: { explicitFlag?: boolean; activeBoulder?: boolean } = {},
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
  if (input.activeBoulder === true) signals.push("D")
  return { trigger: input.explicitFlag === true || signals.length >= 1, signals }
}

/** What ONE workspace's boulder ledger says about an active work — signal D's only input. */
export interface BoulderGateRead {
  /** Whether an ACTIVE boulder work exists. A work with no `status` reads `false`, deliberately. */
  active: boolean
  /** The work's own `status`, when the state carried a string one. */
  status?: string
  /** The work's `active_plan` path, echoed into the staged shell when D fired. */
  planPath?: string
}

/** The seams {@link readBoulderGate} accepts: the reader (tests/QA) and the state-root override. */
export interface BoulderGateOptions {
  /** The file reader; defaults to `node:fs/promises`' `readFile` in utf8 mode. */
  readFile?: (path: string) => Promise<string>
  /** The state root override (`mpd.jsonc` `boulder.dir`); defaults to the session workspace. */
  boulderDir?: string
}

/**
 * Whether an ACTIVE boulder work exists for one workspace — signal D, repaired 2026-10-07.
 *
 * NON-THROWING BY CONTRACT: a missing file, a permission error, malformed JSON or a non-object
 * payload all read `{active:false}`. The predicate mirrors the vendor's fallback shape
 * (`active_work_id` into `works`, else the top-level state) with ONE deliberate divergence: a work
 * that carries NO `status` reads INACTIVE here (`getActiveWorks` treats a missing status as active,
 * which would re-open the false positive this repair closes).
 *
 * @param workspace - the session workspace the state root resolves from.
 * @param opts - the injectable reader and the `boulder.dir` override, both optional.
 * @returns the verdict, never a throw.
 */
export async function readBoulderGate(workspace: string, opts: BoulderGateOptions = {}): Promise<BoulderGateRead> {
  try {
    /** The reader: the injected seam in a test, `node:fs/promises` in a boot. */
    const read = opts.readFile ?? ((path: string) => readFileFs(path, "utf8"))
    /** The state root: the explicit override when it names a REAL root, else the session workspace. */
    const root = resolveBoulderDir(opts.boulderDir) ?? String(workspace ?? "")
    /** The raw ledger text; a missing file throws into the catch below. */
    const raw = await read(join(root, ".mpd", "boulder.json"))
    /** The decoded ledger, accepted only when it is a plain object. */
    const state: unknown = JSON.parse(raw)
    if (state === null || typeof state !== "object" || Array.isArray(state)) return { active: false }
    /** The state as a record, which the two lookups below read defensively. */
    const record = state as Record<string, unknown>
    /** Every work the ledger holds, or an empty map when the field is not an object. */
    const works = record.works !== null && typeof record.works === "object" && !Array.isArray(record.works)
      ? record.works as Record<string, unknown>
      : {}
    /** The id the ledger names as active, as a string (the vendor stores it as text). */
    const activeId = String(record.active_work_id ?? "")
    /** The work the id points at, or the top-level state when the id resolves to nothing. */
    const pointed = activeId === "" ? undefined : works[activeId]
    /** The work record this read judges: the pointed work, else the top-level state itself. */
    const work = pointed !== null && typeof pointed === "object" && !Array.isArray(pointed)
      ? pointed as Record<string, unknown>
      : record
    /** The judged work's `status`; absent means INACTIVE (the ratified conservative reading). */
    const status = typeof work.status === "string" ? work.status : undefined
    /** The plan path the work records, when it carries a non-empty one. */
    const planPath = typeof work.active_plan === "string" && work.active_plan !== "" ? work.active_plan : undefined
    return {
      active: status === "active",
      ...(status === undefined ? {} : { status }),
      ...(planPath === undefined ? {} : { planPath }),
    }
  } catch {
    return { active: false }
  }
}

/**
 * Resolve the `team.gate` mode from one raw config value, PER CALL.
 *
 * `mechanical` is the DEFAULT and the FAIL-SAFE: an unknown string, a number, an object — anything
 * that is not the `advisory`/`off` vocabulary — reads `mechanical`, so a typo can never silently
 * disable the gate. Booleans are tolerated as the pre-#26 spelling (`true` -> mechanical,
 * `false` -> off) and `undefined` (the key is simply absent) takes the default.
 *
 * @param value - the raw value the config layer answered, of any type.
 * @returns the mode the gate must run in.
 */
export function resolveGateMode(value: unknown): GateMode {
  if (value === GATE_MODE_ADVISORY) return GATE_MODE_ADVISORY
  if (value === GATE_MODE_OFF || value === false) return GATE_MODE_OFF
  return GATE_MODE_MECHANICAL
}

/** Every whitespace run collapsed to one space, with the ends trimmed. */
function collapseWhitespace(text: string): string {
  return String(text ?? "").replace(/\s+/gu, " ").trim()
}

/** The staged SHELL's three gate-filled fields; the tool and the store fill everything else. */
export interface GatePlanShell {
  /** The plan name: the goal's first line, whitespace-collapsed, clipped to {@link GATE_PLAN_NAME_MAX}. */
  name: string
  /** What the plan is for: the fired signals, the goal excerpt, how to extend/approve, the D plan path. */
  description: string
  /** Always `required`: the gate cannot decompose the goal, so it never auto-approves its own shell. */
  approval: "required"
}

/**
 * Build the plan SHELL the mechanical gate stages — the HONEST half of the trigger->stage contract.
 *
 * The gate can fill `name`, `description` and `approval` and NOTHING else: at the first pre-step
 * there is no decomposition and no DAG, so `members[]`, `tasks[]`, prompts, blockers and owners
 * stay empty and the description says so outright. Keyword->specialist selection would be the
 * "invent a team" defect the manual forbids, so this builder never guesses one.
 *
 * @param input - the fired signals, the (flag-consumed) goal text, and the D plan path when it fired.
 * @returns the three fields the staging call's `create` action receives.
 */
export function gatePlanShell(input: { signals: readonly string[]; goal: string; planPath?: string }): GatePlanShell {
  /** The goal text as given, coerced so a non-string can never throw here. */
  const goal = String(input.goal ?? "")
  /** The goal's FIRST line, whitespace-collapsed — a plan name is one line by construction. */
  const firstLine = collapseWhitespace(goal.split(/\r?\n/u)[0] ?? "")
  /** The excerpt the description inlines, whitespace-collapsed and clipped. */
  const excerpt = collapseWhitespace(goal).slice(0, GATE_PLAN_EXCERPT_MAX)
  /** The fired signals as a readable list, or the generic wording when none is named. */
  const matched = input.signals.length === 0 ? "complexity signals" : "complexity signals " + input.signals.join("/")
  return {
    name: firstLine === "" ? GATE_PLAN_NAME_FALLBACK : firstLine.slice(0, GATE_PLAN_NAME_MAX),
    description: "Staged mechanically by the mpd session-start complexity gate on " + matched + "."
      + "\nThis is a SHELL: 0 members and 0 tasks, because at the first pre-step there is no decomposition yet."
      + "\nGoal excerpt: " + (excerpt === "" ? "(empty)" : excerpt)
      + "\nExtend it with `" + STAGING_TOOL_NAME + " {action:\"" + PLAN_EXTEND_ACTIONS[0] + "\"}` (each member's prompt comes from `mpd_role_persona`)"
      + " and `" + STAGING_TOOL_NAME + " {action:\"" + PLAN_EXTEND_ACTIONS[1] + "\"}`,"
      + " then approve it with `" + STAGING_TOOL_NAME + " {action:\"approve\"}` — approval is what spawns the members."
      + "\n" + INERT_PLAN_PHRASE + "."
      + (input.planPath === undefined ? "" : "\nActive plan artifact (signal D): " + input.planPath),
    approval: "required",
  }
}

/**
 * The ADVISORY notice: what fired, that NOTHING was staged, and what to do instead.
 *
 * Used by the `advisory` mode and by EVERY degradation of the mechanical route, so the notice
 * taxonomy stays two-valued: either a plan WAS staged and the mechanical notice names the id the
 * call returned, or nothing was staged and this text says so.
 *
 * @param signals - the fired signal letters, in A–D order.
 * @param explicit - whether an explicit `team:` / `!team` marker was consumed from the goal.
 * @returns the notice text, always carrying {@link STARTUP_NOTICE_MARKER}.
 */
export function advisoryNoticeText(signals: readonly string[], explicit: boolean): string {
  /** The fired signals as a readable list, or the generic wording when none is named. */
  const matched = signals.length === 0 ? "complexity signals" : "complexity signals " + signals.join("/")
  return STARTUP_NOTICE_MARKER + ": this session shows " + matched + ", and " + NO_TEAM_STAGED_PHRASE + " — the gate is ADVISORY "
    + "and stages nothing while complexity is merely being judged."
    + (explicit ? "\n- The explicit `team:` / `!team` marker was CONSUMED from the goal text: the request is a reason to stage, not a staged team." : "")
    + "\n- Stage a team yourself at the moment the work actually warrants one: `spawn_teammate` creates each roster teammate"
    + " (its prompt text comes from `mpd_role_persona`) and `team_task_create` opens its lane on the shared board; then tell"
    + " the user the Web plan is ready for review."
    + "\n" + SOLO_PERMISSION_SENTENCE + " — and say so in one line."
    + "\n- A team is NOT a precondition of this session, and you may not create a second team while leading one."
}

/**
 * The MECHANICAL notice: a plan SHELL was staged (or already was), and NOTHING was spawned.
 *
 * The id is the one the staging call RETURNED, never a claimed or reconstructed one; an empty id is
 * reported as "plan id not reported" rather than invented. The notice states outright that the plan
 * is INERT until approved, because "a team was created" is the exact false claim this gate must not
 * invite.
 *
 * @param input - the returned plan id, the fired signals, the explicit-flag fact, and whether the
 *   gate SKIPPED staging because this session already had a plan staged.
 * @returns the notice text, always carrying {@link STARTUP_NOTICE_MARKER}.
 */
export function mechanicalNoticeText(input: {
  /** The plan id the `agent_teams_plan` call returned; may be empty when the call reported none. */
  planId: string
  /** The fired signal letters, in A–D order. */
  signals: readonly string[]
  /** Whether an explicit `team:` / `!team` marker was consumed from the goal text. */
  explicit: boolean
  /** Whether a plan was ALREADY staged for this session, so this fire did not stage one. */
  alreadyStaged: boolean
}): string {
  /** The fired signals as a readable list, or the generic wording when none is named. */
  const matched = input.signals.length === 0 ? "complexity signals" : "complexity signals " + input.signals.join("/")
  /** The id sentence: the returned id, or an explicit statement that the call reported none. */
  const id = input.planId === "" ? "(plan id not reported by the call)" : input.planId
  return STARTUP_NOTICE_MARKER + ": this session shows " + matched + ", and "
    + (input.alreadyStaged ? ALREADY_STAGED_PLAN_PHRASE : STAGED_PLAN_PHRASE) + " — " + id
    + " (0 members, 0 tasks: a SHELL, not a team)."
    + (input.alreadyStaged ? "\n- The gate did NOT stage again: a second staging would ARCHIVE your in-progress plan." : "")
    + (input.explicit ? "\n- The explicit `team:` / `!team` marker was CONSUMED from the goal text: the request is why this is your session to lead." : "")
    + "\n- Extend it with `" + STAGING_TOOL_NAME + " {action:\"" + PLAN_EXTEND_ACTIONS[0] + "\"}` (each member's prompt comes from `mpd_role_persona`)"
    + " and `" + STAGING_TOOL_NAME + " {action:\"" + PLAN_EXTEND_ACTIONS[1] + "\"}`, then approve it with `"
    + STAGING_TOOL_NAME + " {action:\"approve\"}` — approval is what spawns the members and posts the tasks."
    + "\n- " + INERT_PLAN_PHRASE + " — never tell the user a team was created."
    + "\n" + SOLO_PERMISSION_SENTENCE + " — and say so in one line: an unapproved plan is inert."
    + "\n- A team is NOT a precondition of this session, and you may not create a second team while leading one."
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
 *
 * @param candidates - the messages to inspect, oldest to newest.
 * @returns the chosen message with its joined text, or `undefined` when none carries text.
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

/**
 * Rewrite a claimed user message with the explicit marker CONSUMED (text blocks only).
 *
 * @param message - the claimed message, returned unchanged when no marker was consumed.
 * @param source - the message's joined text, used to decide whether a marker is present at all.
 * @returns the message, or a copy whose text blocks lost the marker.
 */
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
 *
 * @param agent - the live agent handle whose session header decides the scope.
 * @param presets - the covered preset names; defaults to {@link DEFAULT_GATE_PRESETS}.
 * @returns whether this agent's session carries a gate.
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
