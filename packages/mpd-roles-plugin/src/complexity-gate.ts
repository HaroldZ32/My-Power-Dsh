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
// The frozen predicate is `trigger = explicit flag OR (matchedSignals >= 1)` with six signals A–F,
// reproduced from the retired implementation (`packages/mpd-agent-teams-plugin/lib/session-start.ts`,
// read as the SPEC — never mounted or imported) and extended by wave `team-gate-wave` (2026-10-22):
//   A (hard) a `team:` prefix or a token-boundary `!team`; the marker is CONSUMED from the goal text;
//   B (soft) distinct deliverable verbs — the bound is per {@link SENSITIVITY_THRESHOLDS} row;
//   C (soft) ONE signal that fires when enough of its three sub-signals hold (enumerated lines,
//            distinct action verbs, action clauses — 2-of-3 on easy/normal, 3-of-3 on strict);
//   D (soft) an ACTIVE boulder work exists for the session workspace. REPAIRED 2026-10-07: D used
//            to mean "some `.mpd/plans/*.md` exists", which MEASURABLY fired in EVERY session of
//            this workspace — its one plan file outlives the work that produced it.
//   E (soft) a CJK-SCALE instruction. ADDED 2026-10-07: A–D are English-centric by construction —
//            B/C count clauses and verbs, and a Chinese one-liner enumerates with `、，。；：` and
//            carries scale in CHARACTERS, so the user's own 159-Han-character instruction measured
//            B=0, C=0, D=absent and staged nothing whatever the workload. E reads scale
//            ({@link CJK_CHAR_MIN} Han characters at NORMAL) AND intent (>= {@link CJK_ACTION_VERB_MIN}
//            distinct action verbs), both calibrated over the frozen corpus.
//   F (soft) WORKSPACE SCALE. ADDED 2026-10-22: one bounded root listing shows a project manifest,
//            a project directory AND >= 8 visible entries. Evaluated on the `easy` row ONLY, so an
//            eager default can fire on the SHAPE of a large repository without moving `normal`.
//
// `team.sensitivity` (`easy` DEFAULT | `normal` | `strict`) selects the row: EVERY bound the predicate
// reads lives in {@link SENSITIVITY_THRESHOLDS}, and `normal` is the pre-2026-10-22 behaviour verbatim.
//
// What a TRIGGER does is resolved per call by the wiring: `team.gate` selects `mechanical` (the DEFAULT
// again since 2026-10-20: stage an APPROVABLE SHELL through the `agent_teams_plan` tool), `advisory`
// (one notice, stage nothing) or `off` (the gate does nothing at all).
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

/**
 * The three `team.gate` modes; the default is {@link GATE_MODE_MECHANICAL} again since the 2026-10-20
 * ruling (it was opt-in from 2026-10-17 to 2026-10-20: the session-start rule ships ON, and `off` is a
 * deliberate configuration rather than an omission).
 */
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
 * The three `team.sensitivity` profiles. They select the THRESHOLD ROW the predicate reads, so the
 * gate's eagerness is configuration rather than four constants edited by taste.
 *
 * EASY is the DEFAULT (wave `team-gate-wave`, 2026-10-22): the user's measured complaint was that a
 * large multi-package repository never staged a team, and a 77-Han-character work instruction
 * (verbatim in the tests) fired ZERO signals because its verbs (降低/触发/创建/规范) were outside the
 * lexicon. Eager by default is the requested direction; `normal` reproduces the pre-wave numbers
 * EXACTLY, so a session that wants the old behaviour says so in one key.
 */
export type GateSensitivity = "easy" | "normal" | "strict"
/** The default sensitivity: the eager row (see {@link GateSensitivity}). */
export const GATE_SENSITIVITY_EASY: GateSensitivity = "easy"
/** The historical row: the pre-2026-10-22 thresholds, unchanged. */
export const GATE_SENSITIVITY_NORMAL: GateSensitivity = "normal"
/** The most conservative row: 3-of-3 for signal C and the highest scale bounds. */
export const GATE_SENSITIVITY_STRICT: GateSensitivity = "strict"
/** The mpd.jsonc / row-config key selecting the sensitivity row, resolved PER CALL and never cached. */
export const SENSITIVITY_CONFIG_KEY = "team.sensitivity"

/**
 * The `team.sensitivity` resolver: TOTAL and fail-safe in the EAGER direction.
 *
 * Any value that is not the exact string `normal` or `strict` reads {@link GATE_SENSITIVITY_EASY} —
 * an absent key, a typo, a number, an object and the boolean `false` alike. The gate never throws on
 * configuration. Eager is the fail-safe direction for this knob because the family's default is
 * "stage an APPROVABLE shell that spawns nothing": the cost of an over-eager fire is one inert plan,
 * while the cost of a silent gate is the very defect this wave measured.
 * @param value - the raw `team.sensitivity` value from the config layer, of unknown type.
 * @returns the threshold row the predicate must read.
 */
export function resolveSensitivity(value: unknown): GateSensitivity {
  if (value === GATE_SENSITIVITY_NORMAL) return GATE_SENSITIVITY_NORMAL
  if (value === GATE_SENSITIVITY_STRICT) return GATE_SENSITIVITY_STRICT
  return GATE_SENSITIVITY_EASY
}

/**
 * Which VERB LEXICON a sensitivity row reads.
 *
 * `pre-wave` is the predicate's exact pre-2026-10-22 vocabulary (8 English + the original 24 CJK
 * deliverable verbs; 14 English + the same 24 CJK action verbs), so the `normal` row reproduces the
 * old verdicts and not merely the old numbers. `expanded` is the wave's vocabulary (29 English
 * deliverable additions + 46 CJK additions), which `easy` and `strict` read.
 */
export type GateLexiconName = "pre-wave" | "expanded"

/**
 * One sensitivity row: every threshold the predicate reads, in ONE object so a profile cannot be
 * half-applied (the single-source-of-truth rule the wave contract states).
 *
 * The unnamed fields mirror signal C's sub-signals one-for-one: {@link SensitivityThresholds.enumeratedLines}
 * is C1, {@link SensitivityThresholds.actionVerbs} is C2 (and signal E's verb conjunct),
 * {@link SensitivityThresholds.clauseSteps} is C3, and {@link SensitivityThresholds.cSubSignals} is how
 * many of the three must hold.
 */
export interface SensitivityThresholds {
  /** Signal B: distinct deliverable-verb matches. */
  readonly deliverableVerbs: number
  /** Signal C1: enumerated (numbered / bulleted / table) lines. */
  readonly enumeratedLines: number
  /** Signal C2: distinct action-verb matches (signal E reads the same count). */
  readonly actionVerbs: number
  /** Signal C3: clauses that OPEN with an action verb. */
  readonly clauseSteps: number
  /** How many of C's three sub-signals must hold. */
  readonly cSubSignals: number
  /** Signal E: Han characters. */
  readonly cjkChars: number
  /** Signal E: distinct action-verb matches. */
  readonly cjkVerbs: number
  /** Whether signal F (workspace scale) is evaluated at all on this row. */
  readonly workspaceScale: boolean
  /** Which verb lexicon this row reads ({@link GateLexiconName}). */
  readonly lexicon: GateLexiconName
}

/**
 * THE THRESHOLD TABLE — the one source of truth for every sensitivity row.
 *
 * `normal` is BYTE-FOR-BYTE the pre-2026-10-22 behaviour (B=4, C1/C3=3, C2=3, C 2-of-3, E=60 chars /
 * 2 verbs, F off), and the exported historical constants below are DERIVED from it rather than
 * restated, so a future edit cannot leave the table and the constants disagreeing.
 */
export const SENSITIVITY_THRESHOLDS: Readonly<Record<GateSensitivity, SensitivityThresholds>> = {
  easy: {
    deliverableVerbs: 2,
    enumeratedLines: 2,
    actionVerbs: 2,
    clauseSteps: 2,
    cSubSignals: 2,
    cjkChars: 24,
    cjkVerbs: 2,
    workspaceScale: true,
    lexicon: "expanded",
  },
  normal: {
    deliverableVerbs: 4,
    enumeratedLines: 3,
    actionVerbs: 3,
    clauseSteps: 3,
    cSubSignals: 2,
    cjkChars: 60,
    cjkVerbs: 2,
    workspaceScale: false,
    lexicon: "pre-wave",
  },
  strict: {
    deliverableVerbs: 6,
    enumeratedLines: 4,
    actionVerbs: 4,
    clauseSteps: 4,
    cSubSignals: 3,
    cjkChars: 80,
    cjkVerbs: 3,
    workspaceScale: false,
    lexicon: "expanded",
  },
}

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
/** The board tool the advisory notice names for a task's lifecycle (claim/complete/fail): the mpd record is the board. */
export const BOARD_TOOL_NAME = "agent_teams_task"
/** The tool the advisory notice names for pairing a ready task with an idle member. */
export const DISPATCH_TOOL_NAME = "agent_teams_dispatch"
/** The mechanical notice's phrase for a plan THIS fire staged. */
export const STAGED_PLAN_PHRASE = "a team PLAN was STAGED"
/** The mechanical notice's phrase when a plan was already staged (the gate skipped staging). */
export const ALREADY_STAGED_PLAN_PHRASE = "a team PLAN is ALREADY STAGED"
/** The mechanical notice's inertness sentence: staging is not spawning. */
export const INERT_PLAN_PHRASE = "NOTHING has been spawned; the plan is INERT until approved"
/**
 * The mechanical notice's failure sentence when the staging call reports OK but returns NO plan id.
 * The shell WAS staged, so the notice must not fall back to the advisory taxonomy; it must say the
 * staged plan cannot be approved and that the failure is to be reported.
 */
export const MISSING_PLAN_ID_PHRASE = "STAGING FAILED TO RETURN A PLAN ID"
/** The advisory notice's staging disclaimer (the advisory route must never claim a staged plan). */
export const NO_TEAM_STAGED_PHRASE = "NO team was staged"
/** The permission to continue solo, which BOTH notices state so an unapproved shell is never a trap. */
export const SOLO_PERMISSION_SENTENCE = "- If the work does not warrant a team (a short or single-threaded task), continue solo"
/** The sentence the shipped preset must NOT carry any more: an explicit flag is no longer merely advised. */
export const DRIFTED_ADVISORY_SENTENCE = "routed to team mode"
/**
 * THE PRE-WAVE LEXICONS — signal B's and signal C2/C3's verb sets EXACTLY as the predicate shipped
 * them before wave `team-gate-wave` (2026-10-22).
 *
 * The `normal` row reads these, so `normal` reproduces the pre-wave PREDICATE byte-for-byte and not
 * merely its thresholds: a text whose only deliverable verbs are wave additions (`implement`, `fix`,
 * `test` matching inside `latest`, …) must not move a `normal` verdict. The sets are FROZEN here
 * rather than derived from the expanded patterns, because "the original 8 English deliverable verbs"
 * is a historical fact, not a formula.
 */
export const PRE_WAVE_DELIVERABLE_VERB_PATTERN = /(align|migrate|refactor|audit|overhaul|port|rewrite|consolidate|脱去|移除|剥离|删除|新建|搬迁|修复|校准|重建|验证|对齐|重构|迁移|审计|移植|梳理|全量|独立|强制|回归|设计|实现|改造|补充)/giu
/** The pre-wave action-verb set (C2 and signal E's intent conjunct): the original 14 English + 24 CJK verbs. */
export const PRE_WAVE_ACTION_VERB_PATTERN = /\b(?:add|align|audit|build|change|check|consolidate|implement|migrate|overhaul|port|refactor|rewrite|verify)\b|脱去|移除|剥离|删除|新建|搬迁|修复|校准|重建|验证|对齐|重构|迁移|审计|移植|梳理|全量|独立|强制|回归|设计|实现|改造|补充/giu
/** The pre-wave clause-opener set (C3), the regex twin of {@link PRE_WAVE_ACTION_VERB_PATTERN}. */
export const PRE_WAVE_CLAUSE_ACTION_PATTERN = /^\s*(?:(?:and|then|also)\s+)?(?:\b(?:add|align|audit|build|change|check|consolidate|implement|migrate|overhaul|port|refactor|rewrite|verify)\b|脱去|移除|剥离|删除|新建|搬迁|修复|校准|重建|验证|对齐|重构|迁移|审计|移植|梳理|全量|独立|强制|回归|设计|实现|改造|补充)/iu

/**
 * Signal B: THE EXPANDED deliverable-verb set (English + CJK), read by `easy` and `strict`.
 *
 * WAVE `team-gate-wave` (2026-10-22) EXPANDED the English half with the common asks the measured
 * sessions actually used, and the CJK half with the verbs a Chinese work instruction uses to state
 * DELIVERY (`降低` the threshold, `触发` the flow, `创建` the project, `规范` the behaviour): the
 * user's own 77-Han-character first message fired ZERO signals because every one of its verbs was
 * outside the lexicon. Matching stays SUBSTRING-based exactly as before (no `\b`), because the
 * existing vocabulary relies on it to count inflections (`refactoring`, `migrations`), and distinct
 * spellings — not occurrences — are what the threshold reads. The `normal` row does NOT read this
 * pattern: it reads {@link PRE_WAVE_DELIVERABLE_VERB_PATTERN}, the frozen pre-wave set.
 */
export const DELIVERABLE_VERB_PATTERN = /(align|migrate|refactor|audit|overhaul|port|rewrite|consolidate|implement|add|build|change|check|verify|fix|create|update|remove|delete|move|rename|test|document|wire|integrate|deploy|release|review|investigate|diagnose|reproduce|benchmark|optimize|harden|validate|split|restructure|脱去|移除|剥离|删除|新建|搬迁|修复|校准|重建|验证|对齐|重构|迁移|审计|移植|梳理|全量|独立|强制|回归|设计|实现|改造|补充|降低|提高|提升|触发|创建|添加|增加|修改|调整|优化|统一|清理|简化|拆分|补全|支持|接入|升级|覆盖|整合|编排|打包|发布|部署|审查|评审|排查|定位|复现|编写|撰写|补写|重写|运行|执行|检查|核查|扩展|完善|精简|合并|替换|加固|校验|测量|记录|规范|抽取)/giu
/**
 * Signal C2: THE EXPANDED action-verb set (English + CJK), read by `easy` and `strict`.
 *
 * Its English half keeps the pre-wave 14-verb shape and gains NO deliverable asks — the expansion is
 * vocabulary, not an action-classifier change. Only the CJK half grows (46 additions), because signal
 * E's intent conjunct reads this same count, so a Chinese delivery verb absent here would keep E
 * blind. The `normal` row reads {@link PRE_WAVE_ACTION_VERB_PATTERN} instead.
 */
export const ACTION_VERB_PATTERN = /\b(?:add|align|audit|build|change|check|consolidate|implement|migrate|overhaul|port|refactor|rewrite|verify)\b|脱去|移除|剥离|删除|新建|搬迁|修复|校准|重建|验证|对齐|重构|迁移|审计|移植|梳理|全量|独立|强制|回归|设计|实现|改造|补充|降低|提高|提升|触发|创建|添加|增加|修改|调整|优化|统一|清理|简化|拆分|补全|支持|接入|升级|覆盖|整合|编排|打包|发布|部署|审查|评审|排查|定位|复现|编写|撰写|补写|重写|运行|执行|检查|核查|扩展|完善|精简|合并|替换|加固|校验|测量|记录|规范|抽取/giu
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
/**
 * Signal C3: a clause that OPENS (optionally after a conjunction) with an action verb, over the
 * EXPANDED lexicon ({@link ACTION_VERB_PATTERN}'s CJK additions included) — so a clause that opens
 * with `降低` or `创建` counts exactly like one that opens with `align`. The `normal` row reads
 * {@link PRE_WAVE_CLAUSE_ACTION_PATTERN}.
 */
export const CLAUSE_ACTION_PATTERN = /^\s*(?:(?:and|then|also)\s+)?(?:\b(?:add|align|audit|build|change|check|consolidate|implement|migrate|overhaul|port|refactor|rewrite|verify)\b|脱去|移除|剥离|删除|新建|搬迁|修复|校准|重建|验证|对齐|重构|迁移|审计|移植|梳理|全量|独立|强制|回归|设计|实现|改造|补充|降低|提高|提升|触发|创建|添加|增加|修改|调整|优化|统一|清理|简化|拆分|补全|支持|接入|升级|覆盖|整合|编排|打包|发布|部署|审查|评审|排查|定位|复现|编写|撰写|补写|重写|运行|执行|检查|核查|扩展|完善|精简|合并|替换|加固|校验|测量|记录|规范|抽取)/iu
/** One row's three verb lexicons, selected together so a row cannot mix vocabularies. */
export interface GateLexicon {
  /** Signal B's deliverable-verb pattern. */
  readonly deliverable: RegExp
  /** Signal C2 / signal E's action-verb pattern. */
  readonly action: RegExp
  /** Signal C3's clause-opener pattern. */
  readonly clause: RegExp
}
/** The pre-wave lexicon: the `normal` row's exact historical vocabulary. */
export const PRE_WAVE_LEXICON: GateLexicon = {
  deliverable: PRE_WAVE_DELIVERABLE_VERB_PATTERN,
  action: PRE_WAVE_ACTION_VERB_PATTERN,
  clause: PRE_WAVE_CLAUSE_ACTION_PATTERN,
}
/** The expanded lexicon: the `easy` and `strict` rows' vocabulary. */
export const EXPANDED_LEXICON: GateLexicon = {
  deliverable: DELIVERABLE_VERB_PATTERN,
  action: ACTION_VERB_PATTERN,
  clause: CLAUSE_ACTION_PATTERN,
}
/** The lexicon a {@link SensitivityThresholds.lexicon} selector resolves through. */
export const GATE_LEXICONS: Readonly<Record<GateLexiconName, GateLexicon>> = {
  "pre-wave": PRE_WAVE_LEXICON,
  expanded: EXPANDED_LEXICON,
}
/** Signal B threshold at NORMAL sensitivity, derived from the one table ({@link SENSITIVITY_THRESHOLDS}). */
export const DELIVERABLE_VERB_MIN = SENSITIVITY_THRESHOLDS.normal.deliverableVerbs
/** Signal C1 and C3 threshold at NORMAL sensitivity, derived from the one table. */
export const ENUMERATED_LINE_MIN = SENSITIVITY_THRESHOLDS.normal.enumeratedLines
/** Signal C2 threshold at NORMAL sensitivity, derived from the one table. */
export const ACTION_VERB_MIN = SENSITIVITY_THRESHOLDS.normal.actionVerbs
/** Signal C's majority width at NORMAL sensitivity, derived from the one table. */
export const C_SUBSIGNAL_MIN = SENSITIVITY_THRESHOLDS.normal.cSubSignals
/** Signal E: ONE Han character, so this pattern's occurrence COUNT is a text's CJK scale. */
export const CJK_CHAR_PATTERN = /\p{Script=Han}/gu
/**
 * Signal E threshold at NORMAL sensitivity: Han characters, derived from the one table.
 *
 * A CJK instruction states its scale in CHARACTERS where an English one states it in clauses, so
 * scale has to be read on its own axis. The NORMAL row is the calibration the 2026-10-07 wave
 * measured: the 159-Han-character positive cleared it and every frozen negative stayed under it.
 */
export const CJK_CHAR_MIN = SENSITIVITY_THRESHOLDS.normal.cjkChars
/**
 * Signal E threshold at NORMAL sensitivity: distinct action verbs, derived from the one table.
 * Scale ALONE never fires E — a long Chinese question that asks for no work must stay silent —
 * which is what this second conjunct holds down.
 */
export const CJK_ACTION_VERB_MIN = SENSITIVITY_THRESHOLDS.normal.cjkVerbs
/** The plan NAME cap: the staged shell's name is the goal's first line, clipped to this many chars. */
export const GATE_PLAN_NAME_MAX = 60
/** How much of the goal the staged shell's DESCRIPTION inlines, in chars. */
export const GATE_PLAN_EXCERPT_MAX = 500
/** The shell name used when the goal's first line collapses to nothing (a whitespace-only turn). */
export const GATE_PLAN_NAME_FALLBACK = "session-start complexity gate team"
/**
 * The presets whose top-level sessions the SESSION-START GATE covers — this gate's scope, nothing else.
 *
 * It is NOT the captain test: §5's captain is the workspace's TOP-LEVEL session — not a delegated
 * child (`origin: "subagent"` or a recorded depth of `1`+) and never a preset name — whatever preset
 * it carries; {@link sessionIsTopLevel} decides that, and a preset-keyed substitute is the T-92 defect.
 */
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

/**
 * Clauses that OPEN with an action verb.
 * @param text - the goal text, split on {@link CLAUSE_SEPARATOR_PATTERN}.
 * @param pattern - the row's clause-opener lexicon ({@link GateLexicon.clause}).
 * @returns how many clauses open with a verb of that lexicon.
 */
function clauseStepCount(text: string, pattern: RegExp): number {
  /** Clauses that open with an action verb so far. */
  let count = 0
  for (const clause of text.split(CLAUSE_SEPARATOR_PATTERN)) if (pattern.test(clause)) count += 1
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
 * Everything the predicate may be told beyond the goal text.
 *
 * `sensitivity` selects the threshold row ({@link resolveSensitivity}; absent reads `easy`).
 * `workspaceScale` is signal F's INPUT — the caller's bounded root-listing verdict from
 * {@link readWorkspaceScale} — and it is read ONLY on a row whose `workspaceScale` is `true`
 * (`easy` today), so `normal`/`strict` keep exactly the five signals they had.
 */
export interface ComplexityGateInput {
  /** Whether an explicit `team:` / `!team` marker was consumed (signal A). */
  explicitFlag?: boolean
  /** Whether an ACTIVE boulder work exists (signal D). */
  activeBoulder?: boolean
  /** The threshold row to read; any unknown or absent value resolves to `easy`. */
  sensitivity?: GateSensitivity
  /** Whether the workspace looks like a large project (signal F; evaluated on `easy` only). */
  workspaceScale?: boolean
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
 *
 * F is the WORKSPACE-SCALE signal (2026-10-22): a bounded root listing shows at least one project
 * manifest, at least one project directory AND at least eight visible entries. It is evaluated on
 * the `easy` row ONLY, because eager triggering is the row's whole purpose: in a large project even
 * a short greeting then stages the inert shell, which is exactly what the user asked for.
 *
 * EVERY row selects its thresholds AND its VERB LEXICON ({@link SensitivityThresholds.lexicon}):
 * `normal` reads the pre-wave sets, so it reproduces the pre-2026-10-22 predicate exactly, while
 * `easy`/`strict` read the expanded vocabulary.
 *
 * @param text - the goal text, with any explicit marker already consumed by the caller.
 * @param input - the explicit-flag fact, the boulder verdict, the sensitivity row and F's input.
 * @returns whether the gate triggered, and the fired signal letters in A–F order.
 */
export function evaluateComplexityGate(
  text: string,
  input: ComplexityGateInput = {},
): { trigger: boolean; signals: string[] } {
  /** The goal text as given; a non-string reads as empty rather than throwing. */
  const source = String(text ?? "")
  /** The threshold row this call reads; an absent or unknown sensitivity reads `easy`. */
  const thresholds = SENSITIVITY_THRESHOLDS[resolveSensitivity(input.sensitivity)]
  /** This row's verb lexicons: `normal` keeps the PRE-WAVE sets, `easy`/`strict` read the expanded ones. */
  const lexicon = GATE_LEXICONS[thresholds.lexicon]
  /** The fired signal letters, in A to F order, which is what the notice names. */
  const signals: string[] = []
  if (input.explicitFlag === true) signals.push("A")
  if (distinctMatches(source, lexicon.deliverable) >= thresholds.deliverableVerbs) signals.push("B")
  /** Distinct action-verb matches, which BOTH signal C2 and signal E read. */
  const actionVerbs = distinctMatches(source, lexicon.action)
  /** How many of signal C's three sub-signals hold (its own majority, per the row). */
  const cSubSignals = [
    enumeratedLineCount(source) >= thresholds.enumeratedLines,
    actionVerbs >= thresholds.actionVerbs,
    clauseStepCount(source, lexicon.clause) >= thresholds.clauseSteps,
  ].filter(Boolean).length
  if (cSubSignals >= thresholds.cSubSignals) signals.push("C")
  if (input.activeBoulder === true) signals.push("D")
  if (cjkCharCount(source) >= thresholds.cjkChars && actionVerbs >= thresholds.cjkVerbs) signals.push("E")
  if (thresholds.workspaceScale && input.workspaceScale === true) signals.push("F")
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
 * The manifest FILENAMES that make a workspace root read as a project (signal F's first conjunct).
 * Every entry is an exact basename the root listing must carry; the list spans the ecosystems this
 * bundle's users work in without probing any of them (no recursion, no content read).
 */
export const WORKSPACE_MANIFESTS: readonly string[] = [
  "package.json",
  "pyproject.toml",
  "Cargo.toml",
  "go.mod",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "composer.json",
  "Gemfile",
  "mix.exs",
  "pubspec.yaml",
  "CMakeLists.txt",
]

/**
 * The DIRECTORY names that make a workspace root read as a multi-unit project (signal F's second
 * conjunct). These are conventional top-level source roots — one is enough — and they are matched by
 * NAME from the same single listing, never by recursing into them.
 */
export const WORKSPACE_PROJECT_DIRS: readonly string[] = [
  "packages",
  "src",
  "apps",
  "lib",
  "services",
  "plugins",
  "crates",
  "cmd",
  "internal",
  "modules",
]

/** Signal F: how many VISIBLE root entries (names not starting with `.`) a large workspace carries. */
export const WORKSPACE_VISIBLE_ENTRIES_MIN = 8

/** The seam {@link readWorkspaceScale} accepts: the directory lister, for tests and the QA case. */
export interface WorkspaceScaleOptions {
  /** The directory lister; defaults to `node:fs/promises`' `readdir` in name-only utf8 mode. */
  readDir?: (path: string) => Promise<readonly string[]>
}

/**
 * Whether a workspace root looks like a LARGE project — signal F, added by wave `team-gate-wave`.
 *
 * The probe is ONE bounded `readdir` of the root: no recursion, no file read, no `stat`. It answers
 * `true` when the visible entries carry at least one {@link WORKSPACE_MANIFESTS} name, at least one
 * {@link WORKSPACE_PROJECT_DIRS} name AND at least {@link WORKSPACE_VISIBLE_ENTRIES_MIN} entries in
 * total. Dotfiles are excluded from every count, so a freshly initialized directory with `.git` and
 * `.mpd` alone reads `false`.
 *
 * NON-THROWING BY CONTRACT: a missing directory, a permission error, a non-string and a non-array
 * answer all read `false`. The gate must not break a step because a listing failed.
 * @param workspace - the session workspace whose ROOT is listed.
 * @param opts - the injectable lister, optional.
 * @returns whether the workspace carries the project-manifest + project-dir + size shape.
 */
export async function readWorkspaceScale(workspace: string, opts: WorkspaceScaleOptions = {}): Promise<boolean> {
  try {
    /** The lister: the injected seam in a test, `node:fs/promises` in a boot. */
    const list = opts.readDir ?? ((path: string): Promise<readonly string[]> => readDirFs(path, { encoding: "utf8", withFileTypes: false }))
    /** Every root entry's basename, coerced to a string so a hostile lister cannot throw below. */
    const entries = (await list(String(workspace ?? ""))).map((entry) => String(entry))
    /** The entries a person would SEE in a file manager: dotfiles never count toward scale. */
    const visible = entries.filter((name) => !name.startsWith("."))
    /** How many project manifests sit at the root. */
    const manifests = visible.filter((name) => WORKSPACE_MANIFESTS.includes(name)).length
    /** How many conventional project directories sit at the root. */
    const projectDirs = visible.filter((name) => WORKSPACE_PROJECT_DIRS.includes(name)).length
    return manifests >= 1 && projectDirs >= 1 && visible.length >= WORKSPACE_VISIBLE_ENTRIES_MIN
  } catch {
    return false
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
 * `mechanical` is the DEFAULT again (2026-10-20 ruling, `.mpd/plans/restore-guard-discipline.md`) and the
 * FAIL-SAFE: an absent key and every UNKNOWN value (`"bogus"`, `0`, an object) read `mechanical`, so a
 * typo can never silently disable the session-start rule. This was the pre-2026-10-17 behaviour; the
 * rollback made it opt-in for three days and the top-level agent then did every piece of work itself,
 * which is exactly what the restored rule prevents. `"advisory"` and both spellings of off (`"off"`,
 * `false`) are honoured as themselves, so a session that does not want the shell says so explicitly.
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
 * The staging sentence names the ONE surviving door — `agent_teams_plan` — and the board tools that
 * drive it. It must NOT offer `spawn_teammate` / `team_task_create`: the team-door guard REFUSES
 * them at the tool boundary and the mpd record is the board.
 *
 * @param signals - the fired signal letters, in A–F order.
 * @param explicit - whether an explicit `team:` / `!team` marker was consumed from the goal.
 * @returns the notice text, always carrying {@link STARTUP_NOTICE_MARKER}.
 */
export function advisoryNoticeText(signals: readonly string[], explicit: boolean): string {
  /** The fired signals as a readable list, or the generic wording when none is named. */
  const matched = signals.length === 0 ? "complexity signals" : "complexity signals " + signals.join("/")
  return STARTUP_NOTICE_MARKER + ": this session shows " + matched + ", and " + NO_TEAM_STAGED_PHRASE + " — the gate is ADVISORY "
    + "and stages nothing while complexity is merely being judged."
    + (explicit ? "\n- The explicit `team:` / `!team` marker was CONSUMED from the goal text: the request is a reason to stage, not a staged team." : "")
    + "\n- Stage a team yourself when the work warrants one: `" + STAGING_TOOL_NAME + "` {action:\"" + PLAN_EXTEND_ACTIONS[0]
    + "\"} → {action:\"" + PLAN_EXTEND_ACTIONS[1] + "\"} (each task carrying its dependency answer: `blocked_by` or `independent: true`)"
    + " → {action:\"approve\"}; drive the team with `" + BOARD_TOOL_NAME + "` and `" + DISPATCH_TOOL_NAME + "`."
    + "\n" + SOLO_PERMISSION_SENTENCE + " — and say so in one line."
    + "\n- A team is NOT a precondition of this session, and you may not create a second team while leading one."
}

/**
 * The MECHANICAL notice: a plan SHELL was staged (or already was), and NOTHING was spawned.
 *
 * The id is the one the staging call RETURNED, never a claimed or reconstructed one; an empty id is
 * reported as {@link MISSING_PLAN_ID_PHRASE} plus the explicit statement that the staged shell cannot
 * be approved, rather than invented. The notice states outright that the plan
 * is INERT until approved, because "a team was created" is the exact false claim this gate must not
 * invite. Its extension sentence also states the dependency answer every `create_task` must carry
 * (`blocked_by` or `independent: true`), the one field `approve` refuses to infer.
 *
 * @param input - the returned plan id, the fired signals, the explicit-flag fact, and whether the
 *   gate SKIPPED staging because this session already had a plan staged.
 * @returns the notice text, always carrying {@link STARTUP_NOTICE_MARKER}.
 */
export function mechanicalNoticeText(input: {
  /** The plan id the `agent_teams_plan` call returned; may be empty when the call reported none. */
  planId: string
  /** The fired signal letters, in A–F order. */
  signals: readonly string[]
  /** Whether an explicit `team:` / `!team` marker was consumed from the goal text. */
  explicit: boolean
  /** Whether a plan was ALREADY staged for this session, so this fire did not stage one. */
  alreadyStaged: boolean
}): string {
  /** The fired signals as a readable list, or the generic wording when none is named. */
  const matched = input.signals.length === 0 ? "complexity signals" : "complexity signals " + input.signals.join("/")
  /** Whether the plan id could not be read (the staging call reported none, or an already-staged plan carried none). */
  const missingId = input.planId === ""
  /**
   * The id sentence: the returned id, or a LOUD failure because a staged shell without an id cannot be
   * approved. The ALREADY-STAGED branch must not claim a staging call ran — the gate skipped it — so it
   * says the returned shell's id could not be read instead.
   */
  const id = !missingId
    ? input.planId
    : MISSING_PLAN_ID_PHRASE + (input.alreadyStaged
      ? " — the returned shell's id could not be read, so it CANNOT be approved; report this failure"
      : " — the shell was staged but CANNOT be approved, so report this failure")
  /**
   * The next-step sentence. ONLY a shell whose id was read can be extended and approved; with no id the
   * notice must NOT instruct the captain to do either (the contradiction this branch removes) and must
   * send them to report the failure instead. The ALREADY-STAGED branch also forbids a re-stage: the gate
   * skipped staging precisely because a second staging would ARCHIVE the in-progress plan.
   */
  const nextStep = !missingId
    ? "\n- Extend it with `" + STAGING_TOOL_NAME + " {action:\"" + PLAN_EXTEND_ACTIONS[0] + "\"}` (each member's prompt comes from `mpd_role_persona`)"
      + " and `" + STAGING_TOOL_NAME + " {action:\"" + PLAN_EXTEND_ACTIONS[1] + "\"} (each task carrying its dependency answer: `blocked_by` or `independent: true`), then approve it with `"
      + STAGING_TOOL_NAME + " {action:\"approve\"}` — approval is what spawns the members and posts the tasks."
    : input.alreadyStaged
      ? "\n- Do NOT attempt to extend or approve it, and do NOT stage again: the returned shell's id could not be read, so report this failure instead."
      : "\n- Do NOT attempt to extend or approve it: the staging call returned no id, so report this failure and re-stage before continuing."
  return STARTUP_NOTICE_MARKER + ": this session shows " + matched + ", and "
    + (input.alreadyStaged ? ALREADY_STAGED_PLAN_PHRASE : STAGED_PLAN_PHRASE) + " — " + id
    + " (0 members, 0 tasks: a SHELL, not a team)."
    + (input.alreadyStaged ? "\n- The gate did NOT stage again: a second staging would ARCHIVE your in-progress plan." : "")
    + (input.explicit ? "\n- The explicit `team:` / `!team` marker was CONSUMED from the goal text: the request is why this is your session to lead." : "")
    + nextStep
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
 * Whether one agent's SESSION is covered by the SESSION-START GATE: a TOP-LEVEL session (the
 * {@link sessionRank} `captain` — never an `origin: "subagent"` child or a `delegationDepth >= 1`
 * member; a seeded fork that carries a parent LINK with `isSeeded: true` and depth 0 still counts as
 * top-level) whose `agentPreset` is on the covered list, or one with NO preset at all (`undefined`
 * or `null`).
 *
 * THE CHILD HALF IS COMPOSED, NOT RE-DERIVED: this calls {@link sessionRank}, so the gate and §5's
 * captain classification can never disagree about who is a child. A parent LINK alone is NOT
 * childhood — the seeded-fork repair of 2026-10-10 — and this predicate must never become the
 * captain test itself.
 *
 * WHAT IT IS NOT — read this before reusing it: this is NOT the captain test. It answers "does the
 * complexity gate apply to this session", and its preset conjunct is deliberate gate scoping
 * (whether a `cordis`-preset top-level session should ALSO get the gate is a separate question).
 * The workspace's captain — the ONE git writer of §5 and the only session rule 4 gates — is
 * {@link sessionIsTopLevel}, a PRESET-FREE classification; the two must never be swapped for one
 * another, which is exactly the defect T-92 records.
 *
 * A child session (subagent, teammate, workflow worker, ralph round) already belongs to a
 * parent's team — it must never be told to stage one of its own. A session that NAMES a preset must
 * be on the list; one with NO preset at all (the headless direct driver, legacy installs) deploys
 * the bundle itself and stays covered.
 *
 * @param agent - the live agent handle whose session header decides the scope.
 * @param presets - the covered preset names; defaults to {@link DEFAULT_GATE_PRESETS}.
 * @returns whether this agent's session carries a gate.
 */
export function sessionQualifies(agent: unknown, presets: readonly string[] = DEFAULT_GATE_PRESETS): boolean {
  // THE CAPTAIN/CHILD HALF COMPOSES THE ONE CLASSIFICATION: `headerless` fails closed, a child is a
  // recorded subagent origin or a delegation depth of 1+, and everything else (a seeded fork included)
  // is the top-level session the gate is meant to arm on.
  if (sessionRank(agent) !== "captain") return false
  /** The agent's session header, which carries the preset. */
  const header = (agent as { session?: { header?: Record<string, unknown> } } | undefined)?.session?.header
  if (header === undefined || header === null) return false
  /** The session's preset name; absent OR explicitly null means a preset-less session, which still qualifies. */
  const preset = header.agentPreset
  if (preset === undefined || preset === null) return true
  return presets.includes(String(preset))
}

/**
 * How one agent's session sits in the delegation tree, as §5's captain rule classifies it:
 * `captain` is the workspace's TOP-LEVEL session (anything that is not provably a delegated child);
 * `child` is a member/child session (a subagent origin, or a delegation depth of `1` or more);
 * `headerless` is an agent whose session header is missing, which is never read as the captain —
 * the classification fails CLOSED.
 *
 * PRESET-FREE BY CONSTRUCTION; see {@link sessionIsTopLevel}.
 */
export type SessionRank = "captain" | "child" | "headerless"

/**
 * Classify one agent's session for §5: the captain is the workspace's TOP-LEVEL session — NOT a
 * delegated child and NOT a preset name.
 *
 * WHY `agentPreset` IS NEVER READ: every top-level session on this deployment records
 * `agentPreset: "cordis"`, so a preset-keyed test made the captain branch UNREACHABLE and refused
 * the user's own session its git writes while claiming a fact it never tested (T-92). The manual's
 * definition is the session's position in the delegation tree; this implements exactly that.
 *
 * WHY A PARENT LINK ALONE IS NOT CHILDHOOD (the seeded-fork repair, 2026-10-10): the user's real
 * working session is a SEEDED FORK — its header carries `parentSession`, `isSeeded: true` and
 * `delegationDepth: 0`, with NO `origin: "subagent"` — so the old "any parent session is a child"
 * test classified the CAPTAIN as a child and every captain-scoped rule silently stopped applying to
 * it. A session is a child IFF the harness RECORDED one of the two delegation facts:
 * `origin === "subagent"` or `delegationDepth >= 1`. Everything else — including a fork whose depth
 * the harness never recorded — is the captain, which is the CONSERVATIVE direction: a captain-scoped
 * rule applies. (The two mechanical captain rules this classification feeds — the reconnaissance guard
 * and the delegation gate — were restored on 2026-10-20; the write rule itself stays withdrawn, and the
 * classification is also what the roster's own scoping needs.)
 *
 * A header that is absent still fails closed (`headerless`, never the captain), and a
 * `delegationDepth` that is not a number is not ">= 1", so an unreadable depth reads as the captain
 * — the same conservative direction as the fork case.
 *
 * @param agent - the live agent handle whose session header is classified.
 * @returns the session's class.
 */
export function sessionRank(agent: unknown): SessionRank {
  /** The agent's session header, which carries the origin, the parent link and the delegation depth. */
  const header = (agent as { session?: { header?: Record<string, unknown> } } | undefined)?.session?.header
  if (header === undefined || header === null) return "headerless"
  if (header.origin === "subagent") return "child"
  /** The session's delegation depth; absent on a session the harness never recorded a depth for. */
  const depth = Number(header.delegationDepth)
  return depth >= 1 ? "child" : "captain"
}

/**
 * Whether one agent's session IS this workspace's top-level session — the captain of §5's
 * ONE-GIT-WRITER rule, and the only session rule 4 gates.
 *
 * The ONE predicate both rules read, so they can never disagree about who is the captain. It does
 * NOT consult `agentPreset`, and it is NOT {@link sessionQualifies}: that one answers the
 * session-start GATE's preset-scoped question and must never be substituted here.
 *
 * @param agent - the live agent handle whose session header is classified.
 * @returns whether this session is the workspace's top-level session.
 */
export function sessionIsTopLevel(agent: unknown): boolean {
  return sessionRank(agent) === "captain"
}

/** The ONE preset whose top-level session carries the CAPTAIN's behavioural rules. */
export const MPD_CAPTAIN_PRESET = "mpd"

/**
 * Whether one agent's session is the CAPTAIN OF THE `mpd` PRESET — the top-level session (§5), AND a
 * session whose `agentPreset` really is {@link MPD_CAPTAIN_PRESET}.
 *
 * WHY THIS EXISTS, and why it is not {@link sessionIsTopLevel}. The captain's PRESET-SCOPED rules — the
 * reconnaissance ban (`./captain-investigation.ts`) and the delegation gate (`./delegation-gate.ts`) —
 * are part of what the `mpd` preset MEANS. Both install through the ONE process-wide `tools.guard` seam,
 * so a bare {@link sessionIsTopLevel} test made them bite EVERY top-level session of the deployment,
 * whatever preset it was running: a user working in the DEFAULT preset (`cordis`) was refused its own
 * reconnaissance and its own delegation habits by a captain contract that preset never asked for. This
 * predicate scoped those two rules back to the preset that owns them.
 *
 * INSTALLED AGAIN SINCE 2026-10-20: the user's 2026-10-17 ruling (`.mpd/plans/harness-021-rollback.md` R1)
 * withdrew the reconnaissance ban and the spawn-tool ban with the persona restoration, and the 2026-10-20
 * ruling (`.mpd/plans/restore-guard-discipline.md`) restored BOTH — so the two guards read this predicate
 * again and the boot line reports their modes. The verification law's write rule (`./verify-guard.ts`)
 * stays WITHDRAWN: the captain writes code directly, and the boot line reports
 * `verifyGate=absent reason=withdrawn:2026-10-17-user-ruling(verify.mode)`.
 *
 * DIRECTION OF THE PRESET TEST: the gate opens ONLY on the exact preset name. A session with no
 * `agentPreset` at all is therefore NOT gated. That is deliberate and is the OPPOSITE of
 * {@link sessionQualifies}, which reads a preset-less session as covered: there the conservative
 * direction protects a bundle-less deployment, while here it would re-impose the very rule this
 * predicate exists to scope. `mpd` sessions always record the preset — the bundle's own integration
 * boots assert `agentPreset=mpd` on the row's boot line.
 *
 * NOT FOR §5's ONE-GIT-WRITER RULE: that rule protects the single `.git/HEAD` of a shared checkout, so
 * while it was mechanical it was keyed on {@link sessionIsTopLevel} alone and followed whichever preset
 * the user ran. It is prose now — the withdrawal removed its hook together with the write rule.
 *
 * @param agent - the live agent handle whose session header is classified.
 * @returns whether this session is the top-level session of the `mpd` preset.
 */
export function sessionIsMpdCaptain(agent: unknown): boolean {
  if (!sessionIsTopLevel(agent)) return false
  /** The agent's session header, which carries the preset this rule is scoped to. */
  const header = (agent as { session?: { header?: Record<string, unknown> } } | undefined)?.session?.header
  return header?.agentPreset === MPD_CAPTAIN_PRESET
}
