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
// The frozen predicate is `trigger = explicit flag OR (matchedSignals >= 1)` with five signals,
// reproduced from the retired implementation (`packages/mpd-agent-teams-plugin/lib/session-start.ts`,
// read as the SPEC — never mounted or imported):
//   A (hard) a `team:` prefix or a token-boundary `!team`; the marker is CONSUMED from the goal text;
//   B (soft) >= 4 distinct deliverable verbs;
//   C (soft) ONE signal that fires when >= 2 of its three sub-signals hold (>= 3 enumerated
//            lines, >= 3 distinct action verbs, >= 3 action clauses);
//   D (soft) an ACTIVE boulder work exists for the session workspace. REPAIRED 2026-10-07: D used
//            to mean "some `.mpd/plans/*.md` exists", which MEASURABLY fired in EVERY session of
//            this workspace — its one plan file outlives the work that produced it.
//   E (soft) a CJK-SCALE instruction. ADDED 2026-10-07: A–D are English-centric by construction —
//            B/C count clauses and verbs, and a Chinese one-liner enumerates with `、，。；：` and
//            carries scale in CHARACTERS, so the user's own 159-Han-character instruction measured
//            B=0, C=0, D=absent and staged nothing whatever the workload. E reads scale
//            ({@link CJK_CHAR_MIN} Han characters) AND intent (>= {@link CJK_ACTION_VERB_MIN}
//            distinct action verbs), both calibrated over the frozen corpus.
//
// What a TRIGGER does is resolved per call by the wiring: `team.gate` selects `mechanical` (the
// default: stage an APPROVABLE SHELL through the `agent_teams_plan` tool), `advisory` (one notice,
// stage nothing) or `off`.
import { readFile as readFileFs, readdir as readDirFs } from "node:fs/promises"
import { join } from "node:path"

/** The notice marker (frozen; AGENTS.md §1 and the retired implementation both carry it). */
export const STARTUP_NOTICE_MARKER = "[AgentTeams] Session-start team rule"

/**
 * The ONE source kind the harness tags a HUMAN turn with: the CLI/ACP path writes
 * `{kind:"user"}`, and the web/RPC path's `user-rpc` variant carries the same `kind` field
 * (`MessageSourceMap` in the installed harness). Every other kind in that map — and every kind a
 * plugin adds — is producer-owned and therefore never a human turn.
 */
export const HUMAN_SOURCE_KIND = "user"

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
export const DELIVERABLE_VERB_PATTERN = /(align|migrate|refactor|audit|overhaul|port|rewrite|consolidate|脱去|移除|剥离|删除|新建|搬迁|修复|校准|重建|验证|对齐|重构|迁移|审计|移植|梳理|全量|独立|强制|回归|设计|实现|改造|补充)/giu
/** Signal C2: action verbs (English + CJK), counted by DISTINCT match. */
export const ACTION_VERB_PATTERN = /\b(?:add|align|audit|build|change|check|consolidate|implement|migrate|overhaul|port|refactor|rewrite|verify)\b|脱去|移除|剥离|删除|新建|搬迁|修复|校准|重建|验证|对齐|重构|迁移|审计|移植|梳理|全量|独立|强制|回归|设计|实现|改造|补充/giu
/** Signal C1: numbered / bulleted / table rows that read as enumerated steps. */
export const ENUMERATED_LINE_PATTERN = /^\s*(?:\d+[.)]|[-*|])\s/u
/**
 * Signal C: clause separators — a single-line plan enumerates steps through punctuation too.
 *
 * FULL-WIDTH SET ADDED 2026-10-07: the ASCII set alone never split a Chinese one-liner, so C3
 * counted ONE clause for a `、`-enumerated instruction. The set now carries the named CJK clause
 * separators (`、，。；：`), the bracketing/quoting pairs a CJK instruction quotes with, and the two
 * full-width sentence terminators `！？` — the same sentence-boundary class as `。；` for this count.
 */
export const CLAUSE_SEPARATOR_PATTERN = /[\n\r;:,.、，。；：！？（）「」『』“”‘’【】]/u
/** Signal C3: a clause that OPENS (optionally after a conjunction) with an action verb. */
export const CLAUSE_ACTION_PATTERN = /^\s*(?:(?:and|then|also)\s+)?(?:\b(?:add|align|audit|build|change|check|consolidate|implement|migrate|overhaul|port|refactor|rewrite|verify)\b|脱去|移除|剥离|删除|新建|搬迁|修复|校准|重建|验证|对齐|重构|迁移|审计|移植|梳理|全量|独立|强制|回归|设计|实现|改造|补充)/iu
/** Signal B threshold: distinct deliverable-verb matches. */
export const DELIVERABLE_VERB_MIN = 4
/** Signal C1 and C3 threshold: enumerated lines / positional clauses. */
export const ENUMERATED_LINE_MIN = 3
/** Signal C2 threshold: distinct action-verb matches. */
export const ACTION_VERB_MIN = 3
/** Signal C: how many of its three sub-signals must hold (its own majority). */
export const C_SUBSIGNAL_MIN = 2
/** Signal E: ONE Han character, so this pattern's occurrence COUNT is a text's CJK scale. */
export const CJK_CHAR_PATTERN = /\p{Script=Han}/gu
/**
 * Signal E threshold: Han characters. A CJK instruction states its scale in CHARACTERS where an
 * English one states it in clauses, so scale has to be read on its own axis. CALIBRATED over the
 * frozen corpus (measured margins in the evidence dir): the positive — the user's verbatim
 * instruction — carries 159 Han characters, and every frozen negative carries at most 22, so 60 is
 * the midpoint with 99 above and 38 below it.
 */
export const CJK_CHAR_MIN = 60
/**
 * Signal E threshold: distinct action-verb matches. Scale ALONE never fires E — a long Chinese
 * question that asks for no work must stay silent — which is what this second conjunct holds down.
 */
export const CJK_ACTION_VERB_MIN = 2
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

/** Han characters in a text (signal E's scale measure), counted by OCCURRENCE and not by distinct spelling. */
function cjkCharCount(text: string): number {
  /** Every Han-character occurrence, or null when the text carries none. */
  const matches = text.match(CJK_CHAR_PATTERN)
  return matches === null ? 0 : matches.length
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
 *
 * E is the CJK-SCALE signal: {@link CJK_CHAR_MIN} Han characters AND {@link CJK_ACTION_VERB_MIN}
 * distinct action verbs. It is English-immune by construction (an ASCII text carries zero Han
 * characters), so adding it cannot move any frozen English verdict.
 */
export function evaluateComplexityGate(
  text: string,
  input: { explicitFlag?: boolean; activeBoulder?: boolean } = {},
): { trigger: boolean; signals: string[] } {
  /** The goal text as given; a non-string reads as empty rather than throwing. */
  const source = String(text ?? "")
  /** The fired signal letters, in A to E order, which is what the notice names. */
  const signals: string[] = []
  if (input.explicitFlag === true) signals.push("A")
  if (distinctMatches(source, DELIVERABLE_VERB_PATTERN) >= DELIVERABLE_VERB_MIN) signals.push("B")
  /** Distinct action-verb matches, which BOTH signal C2 and signal E read. */
  const actionVerbs = distinctMatches(source, ACTION_VERB_PATTERN)
  /** How many of signal C's three sub-signals hold (its own 2-of-3 majority). */
  const cSubSignals = [
    enumeratedLineCount(source) >= ENUMERATED_LINE_MIN,
    actionVerbs >= ACTION_VERB_MIN,
    clauseStepCount(source) >= ENUMERATED_LINE_MIN,
  ].filter(Boolean).length
  if (cSubSignals >= C_SUBSIGNAL_MIN) signals.push("C")
  if (input.activeBoulder === true) signals.push("D")
  if (cjkCharCount(source) >= CJK_CHAR_MIN && actionVerbs >= CJK_ACTION_VERB_MIN) signals.push("E")
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

/** Where a workspace's live team records live, relative to the workspace root (C7's only subject). */
export const TEAM_RECORDS_DIR = join(".mpd", "team", "teams")

/** What one workspace's team records say about a session ALREADY LEADING a team (C7's only input). */
export interface LeadingTeamRead {
  /** Whether THIS session's own team record names at least one member. */
  leading: boolean
  /** The team id of the record that decided the verdict, when one was found. */
  teamId?: string
  /** How many members that record named; `0` when no record for this session was found. */
  members: number
}

/** The seams {@link readLeadingTeam} accepts: the two readers (tests and the QA case only). */
export interface LeadingTeamOptions {
  /** The file reader; defaults to `node:fs/promises`' `readFile` in utf8 mode. */
  readFile?: (path: string) => Promise<string>
  /** The directory lister; defaults to `node:fs/promises`' `readdir` in utf8 mode. */
  readDir?: (path: string) => Promise<readonly string[]>
}

/**
 * Whether THIS session already LEADS a team — C7's guard, decided from positive structural evidence.
 *
 * The subject is the team record itself (`<workspace>/.mpd/team/teams/<id>.json`, written by
 * `mpd-team-core`): a record whose `leadSessionId` equals this session's id AND that names at least
 * one member is a team this session is leading. A record with ZERO members is NOT one — that is a
 * staged 0-member plan shell, exactly the thing this guard must still allow to be staged.
 *
 * WHY NOT the `acted` set, a "did we fire before" flag, or a notice scan (C7's rejection of
 * heuristics): each of those answers a question about the GATE, not about the session, so a session
 * that acquired a team by another route (an approved plan, a hand-spawned teammate, another wave's
 * live team) would still stage a second shell — MEASURED 2026-10-07, `plan-20261007102357` staged
 * while this very session was leading team-20261007102205.
 *
 * NON-THROWING BY CONTRACT: a missing directory, a permission error, malformed JSON, a non-object
 * payload or an empty session id all read `{leading:false, members:0}` — the gate is an ASSISTANT,
 * and a reader that cannot answer must never block the session.
 *
 * @param workspace - the session workspace the team-record directory resolves from.
 * @param sessionId - the session id {@link readLeadingTeam} matches against `leadSessionId`.
 * @param opts - the injectable readers, both optional.
 * @returns the verdict, never a throw.
 */
export async function readLeadingTeam(
  workspace: string,
  sessionId: string,
  opts: LeadingTeamOptions = {},
): Promise<LeadingTeamRead> {
  /** The verdict every failure path answers. */
  const nothing: LeadingTeamRead = { leading: false, members: 0 }
  if (typeof sessionId !== "string" || sessionId === "") return nothing
  try {
    /** The file reader: the injected seam in a test, `node:fs/promises` in a boot. */
    const read = opts.readFile ?? ((path: string) => readFileFs(path, "utf8"))
    /** The directory lister: the injected seam in a test, `node:fs/promises` in a boot. */
    const list = opts.readDir ?? ((path: string): Promise<readonly string[]> => readDirFs(path, { encoding: "utf8", withFileTypes: false }))
    /** The record file names this workspace holds; a missing directory throws into the catch below. */
    const entries = await list(join(String(workspace ?? ""), TEAM_RECORDS_DIR))
    for (const entry of entries) {
      if (!String(entry).endsWith(".json")) continue
      try {
        /** The decoded record, accepted only when it is a plain object. */
        const record: unknown = JSON.parse(await read(join(String(workspace ?? ""), TEAM_RECORDS_DIR, String(entry))))
        if (record === null || typeof record !== "object" || Array.isArray(record)) continue
        /** The record as a bag of fields, which every lookup below reads defensively. */
        const fields = record as Record<string, unknown>
        // The LEAD is the session id this gate is bound to, and members[] is what makes it a TEAM
        // rather than a staged shell — both facts read from the record, never inferred.
        if (String(fields.leadSessionId ?? "") !== String(sessionId)) continue
        /** How many members the record names; a non-array reads as none. */
        const members = Array.isArray(fields.members) ? fields.members.length : 0
        if (members === 0) continue
        return { leading: true, teamId: String(fields.teamId ?? ""), members }
      } catch {
        // ONE unreadable record never hides the others: keep scanning.
      }
    }
  } catch {
    return nothing
  }
  return nothing
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
 * @param signals - the fired signal letters, in A–E order.
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
  /** The fired signal letters, in A–E order. */
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
 * The rule is therefore SOURCE-AWARE, in BOTH directions. A message whose `source.kind` is `user`
 * is the caller's own turn and wins (the LAST such message); a message carrying any OTHER
 * producer-owned kind is never the goal; and a message with NO source kind at all stays eligible,
 * which is the fallback for a host that tags nothing.
 *
 * WHY THE SECOND DIRECTION WAS ADDED (C8, MEASURED 2026-10-07): an INBOUND AGENT MESSAGE is a
 * user-role message too. The official team plugin delivers a teammate's report as
 * `createUserMessage({ content, source: { kind: "team-message", teamId, messageId, senderId,
 * senderName } })` (`dsh-experimental-agent-team/lib/index.js`, `dispatchOnce`), and the harness
 * relays a subagent's as `{kind:"agent-message", form:"relay", senderSessionId}` (the installed
 * `MessageSourceMap`). Judging one MEASURABLY staged a spurious 0-member/0-task shell
 * (`plan-20261007102357`, archived to `.mpd/team/archive/plan-20261007102357`) while that session
 * was already LEADING a team — the report it judged was a plain numbered verdict with action verbs,
 * so signal C fired on a message no human wrote.
 *
 * @param candidates - the messages to inspect, oldest to newest.
 * @returns the chosen message with its joined text, or `undefined` when none carries text.
 */
export function latestUserMessage(candidates: readonly unknown[]): { message: unknown; text: string } | undefined {
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    /** The candidate under inspection, walked from newest to oldest. */
    const message = candidates[index]
    if ((message as { role?: unknown } | undefined)?.role !== "user") continue
    /** The candidate's joined text, or undefined when it has no text blocks. */
    const text = messageText(message)
    if (text === undefined) continue
    /** The message's source, which is what separates the caller's turn from an injected notice. */
    const source = (message as { source?: { kind?: unknown } } | undefined)?.source
    /** The producer-owned source kind, or `undefined` when this host tags the message with none. */
    const kind = source === undefined || source === null ? undefined : source.kind
    // An UNTAGGED message stays eligible (the no-tag host fallback); anything tagged with a kind
    // other than `user` is producer-owned — a runtime snapshot, a teammate report, a relayed
    // subagent message — and is NEVER the human turn the gate judges.
    if (kind !== undefined && String(kind) !== HUMAN_SOURCE_KIND) continue
    return { message, text }
  }
  return undefined
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
