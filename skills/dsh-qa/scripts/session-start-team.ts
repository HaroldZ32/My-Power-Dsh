#!/usr/bin/env node
// Case session-start-team (the session-start TEAM GATE), rewritten for the MECHANICAL-era
// implementation: the PURE half lives in `packages/mpd-roles-plugin/src/complexity-gate.ts`, the
// WIRING half (the per-agent listener + the staging call) in
// `packages/mpd-roles-plugin/src/session-gate.ts`.
//
// WHY THE PURE MODULE IS THE IMPORT SUBJECT (measured 2026-10-07): the wiring module imports the
// adapter, whose own chain uses extensionless relative specifiers that plain `node` REFUSES, so
// `node skills/dsh-qa/scripts/session-start-team.ts --self-test` died on the import chain while the
// gate itself was fine. The pure module imports ONLY `node:fs/promises` + `node:path` by
// construction, so it is the module this case imports under `node`; the WIRING is asserted against
// the BUILT dist the live boot really runs.
//
// THE CONTRACT THIS CASE ASSERTS (the shipped implementation is read as the source of truth):
//   * the frozen predicate `trigger = explicit flag OR (matchedSignals >= 1)`, four signals A-D, and
//     the marker `[AgentTeams] Session-start team rule`;
//   * signal D means "an ACTIVE boulder work exists" (`.mpd/boulder.json` with `status:"active"`),
//     read through `readBoulderGate`. The RETIRED plan-file probe is asserted ABSENT: a workspace
//     holding a `.mpd/plans/*.md` artifact but NO active work must read `active:false` — the retired
//     predicate fired in EVERY session of this workspace, which is the defect this case now pins;
//   * `team.gate` selects mechanical (the default) | advisory | off, and an UNKNOWN value fails SAFE
//     to mechanical, so a typo in `mpd.jsonc` can never silently disable the gate;
//   * a trigger stages a 0-member / 0-task PLAN SHELL through `agent_teams_plan` and injects ONE
//     MECHANICAL notice naming the id the call RETURNED, stating `a team PLAN was STAGED` and that the
//     plan is INERT until approved. STAGING IS NOT SPAWNING, and the notice must never claim a team;
//   * the ADVISORY notice (mode `advisory`, or EVERY degradation of the mechanical route) is the ONLY
//     text that says `NO team was staged`, and the only one that must name the OFFICIAL staging tools
//     (`spawn_teammate`, `team_task_create`). The retired `agent_teams_*` vocabulary is scoped PER
//     TEXT: the advisory text may name NONE of it, while the mechanical text may name exactly ONE
//     member of the family — `agent_teams_plan`, our own staging tool;
//   * an untriggered (simple) session gets NO notice at all — the falsifiability arm;
//   * the explicit marker is CONSUMED from the goal text and counts as signal A;
//   * scope: a top-level session of a configured preset only, never a child session.
//
// 1) `--self-test` (offline, no boot): imports the SHIPPED pure module and drives the frozen predicate
//    over four frozen prompt sets in BOTH directions, plus the boulder-reader matrix, the mode
//    resolver, the shell builder, both notice builders, and THREE negative controls that must redden
//    (an always-trigger gate, an always-silent one, and a mechanical notice that only advises) through
//    the SAME `contractProblems()` the real gate is judged by — so a green self-test cannot be
//    vacuous. It also asserts the wiring (the bundle mounts `mpd-roles`, the retired rows are gone,
//    the preset carries the SESSION STARTUP RULE).
// 2) real run: isolated DSH_HOME + sandboxed HOME + SEEDED sandbox workspace, one headless boot per
//    prompt side; the notices, the staged plan slot and the absence of team records are read from the
//    side's own workspace and from the HARNESS session log through the sanctioned reader
//    (`lib/session-evidence.ts`), never from the model's prose (AGENTS.md §7).
//
// THE TWO MEASURED BLIND SPOTS THIS REWRITE CLOSES, named so they cannot come back:
//   (P6) the retired `teamRecords()` scanned `.mpd/team/<id>/team.json`, a layout mpd-team-core does
//        NOT write, so its "nothing was staged" assertion read ZERO BY CONSTRUCTION. The live verdict
//        now reads the REAL layout: exactly ONE `.mpd/team/staging/<sessionId>.json` whose `planId`
//        equals the id named in the notice, and ZERO `.mpd/team/teams/*.json` — "staged, NOT spawned"
//        is provable instead of assumed;
//   (P7) the live arm booted a FRESH EMPTY sandbox per side, so signal D's real-workspace behaviour
//        could never be exercised. Four sides are SEEDED now: an ACTIVE boulder + a simple prompt (D
//        fires and the gate stages), the SAME ledger with `status:"completed"` (the gate stays SILENT
//        — the falsifiability twin, differing by one field), a project `mpd.jsonc` carrying
//        `team.gate:"off"` + a soft-complex prompt (NO notice, NO staging, `sessionGate=off` in the
//        boot line), and one carrying `team.gate:"advisory"` + a soft-complex prompt (ONE advisory
//        notice, nothing staged, `sessionGate=advisory`).
//
// NOTE ON `node` AND `.ts`: this case imports a TypeScript SOURCE module. Node >= 22.18 strips types
// by default (measured: v24.21.0 imports the pure module directly); the import is NOT wrapped in a
// skip, because a case that silently stops asserting its subject is worse than one that fails loudly.
//
// Never touches the real ~/.dsh (credentials/settings are COPIED into a sandbox).
// Evidence root: evidence/dsh-qa/session-start-team/<ts>, or MPD_QA_EVIDENCE_DIR when set.
import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir, homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { credentialEnv, seedSandboxCredentials } from "./lib/credentials.ts"
import { readSessionEvents } from "./lib/session-evidence.ts"
import { assertSessionsSandboxed, projectKey, sandboxWorkspace } from "./lib/workspace-isolation.ts"
import { DSH_MISSING, dshCommand } from "./lib/dsh-launcher.ts"
import { readMpdPresetSource } from "./lib/preset-source.ts"

// .../skills/dsh-qa/scripts/session-start-team.ts -> the repository root.
const repoRoot: string = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
/** The frozen notice marker AGENTS.md §1 pins and every notice must carry verbatim. */
const NOTICE_MARKER: string = "[AgentTeams] Session-start team rule"
/** The ADVISORY notice's staging disclaimer — a phrase the MECHANICAL notice must NEVER carry. */
const ADVISORY_PHRASE: string = "NO team was staged"
/** The MECHANICAL notice's phrase for a plan SHELL this very fire staged (restated, not imported). */
const STAGED_PLAN_PHRASE: string = "a team PLAN was STAGED"
/** The MECHANICAL notice's phrase for a fire that found a plan ALREADY staged (it does not re-stage). */
const ALREADY_STAGED_PLAN_PHRASE: string = "a team PLAN is ALREADY STAGED"
/** The MECHANICAL notice's inertness sentence: staging is not spawning. */
const INERT_PLAN_PHRASE: string = "NOTHING has been spawned; the plan is INERT until approved"
/** The SHELL shape as the NOTICE spells it (comma), which is the word order that text uses. */
const NOTICE_SHELL_PHRASE: string = "0 members, 0 tasks"
/** The SHELL shape as the staged plan's DESCRIPTION spells it, in that builder's own word order. */
const DESCRIPTION_SHELL_PHRASE: string = "0 members and 0 tasks"
/** The retired PROVISIONING sentence: it must not come back through this gate on ANY route. */
const RETIRED_PROVISIONED_PHRASE: string = "is staged in this workspace"
/** The staged shell's name when the goal's first line collapses to nothing (the builder's fallback). */
const PLAN_NAME_FALLBACK: string = "session-start complexity gate team"
/** The plan-name cap: a long goal first line must be CLIPPED to this many characters. */
const PLAN_NAME_MAX: number = 60
/** The OFFICIAL staging tools the ADVISORY notice must name (the mechanical one names our tool). */
const OFFICIAL_TOOLS: readonly string[] = ["spawn_teammate", "team_task_create"]
/** Our OWN staging tool — the ONE `agent_teams_*` token any notice of this gate may name. */
const STAGING_TOOL: string = "agent_teams_plan"
/** Every `agent_teams_*` token in a text, matched as whole tokens (never `/g` + `.test`, stateful). */
const AGENT_TEAMS_TOKEN_PATTERN: RegExp = /agent_teams_[a-z_]*/gu
/** The plan ids a notice names, as `newPlanId` spells them: `plan-<14 digits>`. */
const PLAN_ID_PATTERN: RegExp = /\bplan-\d{14}\b/gu
/** The `team.gate` mode that stages the shell — the DEFAULT, restated here so a rename reddens. */
const GATE_MODE_MECHANICAL: string = "mechanical"
/** The `team.gate` mode that only advises and stages nothing. */
const GATE_MODE_ADVISORY: string = "advisory"
/** The `team.gate` mode that makes the listener return immediately. */
const GATE_MODE_OFF: string = "off"
/** The project-config body selecting the ADVISORY route (seeded as a side's `.mpd/mpd.jsonc`). */
const GATE_MODE_JSONC_ADVISORY: string = '{ "team": { "gate": "advisory" } }\n'
/** The project-config body selecting the OFF route (the seeded counterpart of the one above). */
const GATE_MODE_JSONC_OFF: string = '{ "team": { "gate": "off" } }\n'
/** The `status` the seeded boulder work carries when signal D MUST fire. */
const ACTIVE_STATUS: string = "active"
/** The `status` the SAME seeded ledger carries on the falsifiability side, where D must stay silent. */
const COMPLETED_STATUS: string = "completed"
/** The plan path the seeded work records, which the shell echoes as the active artifact when D fires. */
const SEEDED_PLAN_PATH: string = ".mpd/plans/x.md"
/** The plan id this case's own notice probe carries — never an id claimed from the product. */
const PROBE_PLAN_ID: string = "plan-20260101000000"
/** The shipped PURE gate source, imported directly so the case reads the implementation itself. */
const GATE_SOURCE: string = join(repoRoot, "packages", "mpd-roles-plugin", "src", "complexity-gate.ts")
/** The shipped WIRING module: never imported (it pulls the adapter), only hashed into the settle window. */
const GATE_WIRING: string = join(repoRoot, "packages", "mpd-roles-plugin", "src", "session-gate.ts")
/** The BUILT row the live boot actually runs, asserted to carry the gate before any boot. */
const ROLES_DIST: string = join(repoRoot, "packages", "mpd-roles-plugin", "dist", "index.js")
/**
 * The row's OWN log file, workspace-relative. R5 forbids a row to print — `rowLogLine` appends the
 * team-plane boot signature and every FIRING line to `<workspace>/.mpd/logs/<row>.log`, so this FILE
 * (never the child's stdout) is where a live side's gate evidence is written.
 */
const ROW_LOG_REL: string = join(".mpd", "logs", "mpd-roles.log")
/** The canonical rebuild command the failure banner names when the dist is stale. */
const REBUILD_COMMAND: string = "bun build packages/mpd-roles-plugin/src/index.ts --target node --format esm --outfile packages/mpd-roles-plugin/dist/index.js"
/** How long the live arm waits for HEAD and both gate sources to settle, in milliseconds. */
const SETTLE_MS: number = 50000
/** The human-readable run log, written to the evidence directory at the end of the live arm. */
const LOG: string[] = []

// ── the frozen prompt sets (ONE source of truth: the live sides boot these verbatim) ──
/** Simple prompts: the falsifiability arm — none of them may fire the gate on an EMPTY workspace. */
export const SIMPLE_PROMPTS: readonly string[] = [
  "Reply with exactly: hello-ok",
  "What does the git-master skill do? Answer in one sentence.",
  "Rename the variable `foo` to `bar` in src/util.ts and run its test.",
]
/** Soft-complex prompts: each must fire the gate and name at least one signal. */
export const SOFT_COMPLEX_PROMPTS: readonly string[] = [
  "Align the bundle with upstream: audit the orchestration surface, then implement the routing change.",
  "1. Read the patch file\n2. Audit the gates\n3. Implement the change\n4. Verify the boot",
]
/** Explicit-flag prompts: the marker is CONSUMED and counts as signal A. */
export const EXPLICIT_PROMPTS: readonly string[] = [
  "team: fix the flaky test",
]
/**
 * The signal-D probe prompt: a turn whose ONLY possible signal is D. It is booted twice with the
 * SAME bytes, once over an ACTIVE boulder ledger and once over a COMPLETED one, so the pair isolates D
 * from every other signal — the exact discrimination the retired case could not make.
 */
export const BOULDER_PROBE_PROMPT: string = "Reply with exactly: boulder-ok"

/** Report one failed case assertion and end the run with exit 1; never returns. */
function fail(msg: string): never { console.error("[session-start-team] FAIL: " + msg); process.exit(1) }

/**
 * A thrown value reduced to printable text: its own `message` when it carries one, else the value
 * stringified — the same reporting this case's failure banners always used.
 * @param error The value a `catch` clause received, which TypeScript types as `unknown`.
 * @returns The text to put in a failure banner or an evidence field.
 */
function errorDetail(error: unknown): string {
  // A thrown value is `unknown`, so its optional `message` is read through a one-property view that
  // no narrowing can reach from `unknown`; anything else falls through to `String(value)` as before.
  const detail = (error as { readonly message?: unknown } | undefined)?.message ?? error
  return String(detail)
}

/**
 * The value of one own property of a decoded record, as `unknown`.
 * @param value Any decoded JSON value.
 * @param key Property name to read.
 * @returns The property value, or `undefined` when `value` is not a non-null object.
 */
function fieldOf(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) return undefined
  // Narrowing above proves a non-null object; a dynamic key needs the record view.
  return (value as Record<string, unknown>)[key]
}

/**
 * The array at `key` of a decoded record, as `readonly unknown[]`.
 * @param value Any decoded JSON value.
 * @param key Property name to read.
 * @returns The property value when it is an array, else an empty array.
 */
function arrayFieldOf(value: unknown, key: string): readonly unknown[] {
  // The raw property value, before the array test decides whether it is usable.
  const raw = fieldOf(value, key)
  return Array.isArray(raw) ? raw : []
}

/**
 * The boulder ledger JSON the D arms seed — ONE builder, so the two arms differ in ONE value only.
 *
 * The shape mirrors what `mpd_boulder_start` writes: a top-level `active_work_id` pointing into
 * `works`, whose entry carries `active_plan` and `status`. `status` is the single variable the pair
 * moves: `active` must fire signal D, `completed` must leave the gate silent.
 * @param status The judged work's `status`, the pair's only difference.
 * @returns The `.mpd/boulder.json` text a side seeds before its boot.
 */
function boulderStateJson(status: string): string {
  // The ledger object, structurally identical on both sides but for `status`.
  const state = { active_work_id: "w1", works: { w1: { active_plan: SEEDED_PLAN_PATH, status } } }
  return JSON.stringify(state, null, 2) + "\n"
}

/**
 * Write one seeded file under a sandbox workspace, creating its parent directory.
 * @param ws The side's sandbox workspace, which the seeded path resolves against.
 * @param rel The workspace-relative path to write.
 * @param content The bytes to write.
 * @returns Nothing: a seed that cannot be written must fail loudly rather than boot a lie.
 */
function seedFile(ws: string, rel: string, content: string): void {
  // The absolute target, whose parent may not exist yet in a fresh sandbox workspace.
  const target = join(ws, rel)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, content)
}

/**
 * Every `agent_teams_*` token in one text that is NOT our own staging tool.
 * @param text The notice (or any text) whose retired vocabulary is judged.
 * @returns The offending tokens; empty means only `agent_teams_plan` (or nothing) was named.
 */
function retiredToolTokens(text: string): string[] {
  return (text.match(AGENT_TEAMS_TOKEN_PATTERN) ?? []).filter((token) => token !== STAGING_TOOL)
}

/**
 * Every plan id one text names.
 * @param text The notice whose plan id is extracted.
 * @returns The `plan-<14 digits>` ids, in text order.
 */
function planIdsIn(text: string): string[] {
  return text.match(PLAN_ID_PATTERN) ?? []
}

/**
 * A notice classification fixture for one MECHANICAL side that satisfied every clause.
 * @returns The counts a passing mechanical side produces, with `PROBE_PLAN_ID` as its one plan id.
 */
function mechanicalNoticeFixture(): NoticeClassification {
  return {
    any: 1, advisory: 0, mechanical: 1, signalsNamed: 1, shellShaped: 1, inert: 1,
    retiredProvisioned: 0, officialTools: 0, mechanicalTool: 1, retiredVocabulary: 0,
    signals: ["D"], planIds: [PROBE_PLAN_ID],
  }
}

/**
 * A stage-scan fixture for one MECHANICAL side: ONE staged shell of 0 members / 0 tasks, no record.
 * @param over The fields a fixture arm overrides — the ONE variable each verdict control moves.
 * @returns The scan a passing mechanical side produces, spread with the caller's overrides.
 */
function stageScanFixture(over: Partial<TeamStageScan> = {}): TeamStageScan {
  return { staged: 1, planIds: [PROBE_PLAN_ID], stagedMembers: 0, stagedTasks: 0, records: 0, recordIds: [], ...over }
}

/** The verdict of one complexity-gate evaluation: the frozen predicate's outcome. */
interface ComplexityVerdict {
  /** `true` when the gate fires (`explicitFlag OR matchedSignals >= 1`). */
  readonly trigger: boolean
  /** The fired top-level signal letters, e.g. `["A"]` or `["B", "C"]`. */
  readonly signals: string[]
}

/** The goal text with the explicit marker removed, plus whether one was found at all. */
interface ConsumedFlag {
  /** Whether an explicit `team:` / `!team` marker was present. */
  readonly flagged: boolean
  /** The goal text with the marker CONSUMED. */
  readonly text: string
}

/** The optional inputs one complexity-gate evaluation accepts. */
interface GateInputs {
  /** Whether the caller already consumed an explicit `team:` / `!team` marker. */
  readonly explicitFlag?: boolean
  /** Whether the caller's `readBoulderGate` read an ACTIVE work — signal D's only input. */
  readonly activeBoulder?: boolean
}

/** What one workspace's boulder ledger says about an active work, as the pure module reports it. */
interface BoulderRead {
  /** Whether an ACTIVE boulder work exists; a work with no `status` reads `false`. */
  readonly active: boolean
  /** The judged work's own `status`, when the state carried a string one. */
  readonly status?: string
  /** The judged work's `active_plan` path, echoed into the staged shell when D fired. */
  readonly planPath?: string
}

/** The seams `readBoulderGate` accepts: the reader (this case drives it) and the state-root override. */
interface BoulderReadOptions {
  /** The injected file reader, which is how the offline arm drives every malformed-ledger arm. */
  readonly readFile?: (path: string) => Promise<string>
  /** The state-root override (`mpd.jsonc` `boulder.dir`), unused by this case but part of the shape. */
  readonly boulderDir?: string
}

/** The frozen mechanical notice builder's input, restated as this case calls it. */
interface MechanicalNoticeInput {
  /** The plan id the staging call returned; the empty string is the "call reported none" arm. */
  readonly planId: string
  /** The fired signal letters, in A-D order. */
  readonly signals: readonly string[]
  /** Whether an explicit `team:` / `!team` marker was consumed from the goal text. */
  readonly explicit: boolean
  /** Whether a plan was ALREADY staged, so this fire did NOT stage one. */
  readonly alreadyStaged: boolean
}

/** The plan SHELL one trigger stages: three fields the gate can fill and NOTHING else. */
interface GatePlanShell {
  /** The plan name: the goal's first line, whitespace-collapsed and clipped. */
  readonly name: string
  /** What the plan is for, including the goal excerpt and the honest shell disclaimer. */
  readonly description: string
  /** Always `required`: the gate can never auto-approve a plan it could not decompose. */
  readonly approval: string
}

/** The shipped gate module's surface, as this case drives it. */
interface GateModule {
  /** The frozen notice marker the gate and this case must agree on. */
  readonly STARTUP_NOTICE_MARKER: string
  /** The presets whose top-level sessions the gate covers. */
  readonly DEFAULT_GATE_PRESETS: readonly string[]
  /** The `team.gate` mode that stages the shell (the default and the fail-safe). */
  readonly GATE_MODE_MECHANICAL: string
  /** The `team.gate` mode that only advises. */
  readonly GATE_MODE_ADVISORY: string
  /** The `team.gate` mode that does nothing. */
  readonly GATE_MODE_OFF: string
  /** The config key selecting the mode (`team.gate`). */
  readonly GATE_CONFIG_KEY: string
  /** The mechanical notice's phrase for a plan staged by this fire. */
  readonly STAGED_PLAN_PHRASE: string
  /** The mechanical notice's phrase for a plan that was already staged. */
  readonly ALREADY_STAGED_PLAN_PHRASE: string
  /** The mechanical notice's inertness sentence. */
  readonly INERT_PLAN_PHRASE: string
  /** The advisory notice's staging disclaimer. */
  readonly NO_TEAM_STAGED_PHRASE: string
  /** The tool a mechanical fire calls to stage the shell. */
  readonly STAGING_TOOL_NAME: string
  /** Evaluate the frozen predicate over one goal text. */
  readonly evaluateComplexityGate: (text: string, input?: GateInputs) => ComplexityVerdict
  /** Detect and CONSUME the explicit marker from one goal text. */
  readonly consumeExplicitFlag: (text: string) => ConsumedFlag
  /** Resolve the `team.gate` mode from one raw config value (fail-safe to mechanical). */
  readonly resolveGateMode: (value: unknown) => string
  /** Whether an ACTIVE boulder work exists for one workspace (never throws). */
  readonly readBoulderGate: (workspace: string, opts?: BoulderReadOptions) => Promise<BoulderRead>
  /** Build the 0-member / 0-task plan shell a trigger stages. */
  readonly gatePlanShell: (input: { readonly signals: readonly string[]; readonly goal: string; readonly planPath?: string }) => GatePlanShell
  /** The advisory notice text for one fired signal set. */
  readonly advisoryNoticeText: (signals: readonly string[], explicit: boolean) => string
  /** The mechanical notice text for one staging outcome. */
  readonly mechanicalNoticeText: (input: MechanicalNoticeInput) => string
  /** Whether one agent's session is covered by the gate at all. */
  readonly sessionQualifies: (agent: unknown, presets?: readonly string[]) => boolean
}

/** What the sanctioned session-log reader found for one workspace, or why it failed. */
interface RecordedUserTexts {
  /** Whether the store could be read at all. */
  readonly ok: boolean
  /** The user-role message texts the log recorded, in record order. */
  readonly texts: string[]
  /** How many records the store decoded. */
  readonly records: number
  /** How many zstd frames the store decoded. */
  readonly frames: number
  /** The selected log path, or `null` when the store could not be read. */
  readonly file: string | null
  /** The reader's failure text, present only on the `ok: false` arm. */
  readonly error?: string
}

/** What the session log carried about the gate's ONE notice, classified per assertion. */
interface NoticeClassification {
  /** How many recorded texts carried the frozen marker. */
  readonly any: number
  /** How many marked texts state that NO team was staged (the ADVISORY taxonomy). */
  readonly advisory: number
  /** How many marked texts claim a staged plan, fresh or already there (the MECHANICAL taxonomy). */
  readonly mechanical: number
  /** How many marked texts name the fired signals. */
  readonly signalsNamed: number
  /** How many marked texts state the shell's shape (0 members / 0 tasks). */
  readonly shellShaped: number
  /** How many marked texts state the plan is INERT until approved. */
  readonly inert: number
  /** How many marked texts still carry the retired PROVISIONING sentence. */
  readonly retiredProvisioned: number
  /** How many marked ADVISORY texts name every official staging tool. */
  readonly officialTools: number
  /** How many marked MECHANICAL texts name our staging tool `agent_teams_plan`. */
  readonly mechanicalTool: number
  /** How many marked texts name any `agent_teams_*` token OTHER than the staging tool. */
  readonly retiredVocabulary: number
  /** The fired-signal runs the notices named, in record order (e.g. `["D"]`). */
  readonly signals: string[]
  /** Every plan id the notices named, in record order. */
  readonly planIds: string[]
}

/** What one side's workspace holds under the mpd-team-core sidecar root (`.mpd/team`). */
interface TeamStageScan {
  /** How many staged plan slots `.mpd/team/staging/` holds — the STAGE a mechanical fire leaves. */
  readonly staged: number
  /** The `planId` each staged slot records (an unreadable slot contributes no id, never a throw). */
  readonly planIds: string[]
  /** How many members the staged slots list: a gate-staged SHELL must hold ZERO. */
  readonly stagedMembers: number
  /** How many tasks the staged slots list: a gate-staged SHELL must hold ZERO. */
  readonly stagedTasks: number
  /** How many team RECORDS `.mpd/team/teams/` holds: materialised at APPROVAL only, so zero. */
  readonly records: number
  /** The record ids seen, so a failure names WHAT was spawned instead of only how much. */
  readonly recordIds: string[]
}

/** Which expectation judges one live side. */
type SideExpectation = "none" | "stage" | "advisory" | "off"

/** What one live side seeds into its sandbox workspace BEFORE the boot, if anything. */
interface SideSeed {
  /** The seeded boulder work's `status`; `undefined` seeds no ledger at all. */
  readonly boulderStatus?: string
  /** The project `.mpd/mpd.jsonc` body to seed; `undefined` seeds no project config. */
  readonly mpdJsonc?: string
}

/** The whole expectation of one live side: how it is judged and what the boot must report. */
interface SideSpec {
  /** Which expectation judges this side's notice/staging facts. */
  readonly expect: SideExpectation
  /** The `team.gate` mode the boot's `[mpd-roles] team plane:` line must report. */
  readonly expectedMode: string
  /** Whether this side's recorded goal must show a CONSUMED explicit marker. */
  readonly explicit?: boolean
  /** A signal letter this side is BUILT to prove, when it is built to prove exactly one. */
  readonly signal?: string
  /** What the side seeds into its workspace before the boot. */
  readonly seed?: SideSeed
}

/** The measurements ONE live side hands to the pure verdict function. */
interface LiveSideInput {
  /** Which side this is: untriggered, mechanically staged, advisory, or gate-off. */
  readonly expect: SideExpectation
  /** What the session log recorded about the gate's notice. */
  readonly notice: NoticeClassification
  /** What the side's workspace holds under the REAL `.mpd/team` layout. */
  readonly teams: TeamStageScan
  /** Whether the explicit marker was consumed; `undefined` on the non-explicit sides. */
  readonly markerConsumed: boolean | undefined
  /** The signal letter this side must see named, when it is built to prove one. */
  readonly expectedSignal: string | undefined
}

/** The pure verdict of one live side: whether it held, and every violation found. */
interface SideVerdict {
  /** `true` when no violation was recorded. */
  readonly ok: boolean
  /** The violation sentences, empty on a passing side. */
  readonly problems: string[]
}

/** One live-lane step's verdict: the folded `ok` flag plus whatever that step records. */
interface LiveStep {
  /** Whether this step held; the run's `allOk` folds every member. */
  readonly ok: boolean
  /** Every other field the step records for the evidence JSON. */
  readonly [field: string]: unknown
}

/** The isolation verdict of one live side, recorded beside that side's other evidence. */
interface IsolationVerdict {
  /** Whether the side's session-store keys all stayed inside the sandbox. */
  readonly ok: boolean
  /** The assertion's failure text, present only when `ok` is false. */
  readonly error?: string
  /** Every further field the assertion's own verdict carries on success. */
  readonly [field: string]: unknown
}

/** The optional knobs of the live arm's own `spawnSync` wrapper. */
interface RunSyncOptions {
  /** Per-child timeout in milliseconds, defaulted to the long live bound. */
  readonly timeout?: number
  /** The child's working directory, defaulted to the repository root. */
  readonly cwd?: string
}

/** What the live arm's `spawnSync` wrapper reports: the child's status and both output views. */
interface ChildRun {
  /** The child's exit status, or `null` when nothing ran (no `dsh` launcher resolved). */
  readonly status: number | null
  /** Stdout and stderr concatenated, for the marker assertions. */
  readonly out: string
  /** Stdout alone, which the installer assertions read. */
  readonly stdout: string
}

/** The shipped PURE gate module. A load failure is fatal: never silently skip the subject. */
async function loadGate(): Promise<GateModule> {
  if (!existsSync(GATE_SOURCE)) fail("the gate source is missing: " + GATE_SOURCE)
  try {
    // `import()` of a runtime-computed URL is untyped, so the module namespace is asserted to the
    // surface this case drives; the arm below reports a module that cannot be loaded at all.
    return (await import(pathToFileURL(GATE_SOURCE).href)) as GateModule
  } catch (error) {
    fail("cannot import the shipped PURE gate source " + GATE_SOURCE + ": " + errorDetail(error)
      + " — this case needs the pure module (node strips TypeScript types >= 22.18; measured on v24.21.0) and must never fall back to the wiring module, which imports the adapter extensionlessly. Do not skip this arm.")
  }
}

/**
 * The whole frozen contract, evaluated against ONE gate implementation.
 *
 * Parameterized on the gate object on purpose: `--self-test` drives the real module AND three
 * deliberately broken stubs through this SAME function, so "the contract holds" and "the contract can
 * fail" are proven by one code path rather than two claims.
 *
 * @param gate The gate module (or a stub) whose behaviour is judged.
 * @returns The contract violations; empty means the implementation conforms.
 */
export async function contractProblems(gate: GateModule): Promise<string[]> {
  // Every violation found, in the order the contract clauses are checked.
  const problems: string[] = []
  // Prefixes one violation with the clause it belongs to.
  const at = (label: string): string => label + ": "

  // ── the frozen marker, the restated constants and the mode vocabulary ──
  if (gate.STARTUP_NOTICE_MARKER !== NOTICE_MARKER) {
    problems.push(at("marker") + "the notice marker must be " + JSON.stringify(NOTICE_MARKER) + ", got " + JSON.stringify(gate.STARTUP_NOTICE_MARKER))
  }
  // Every string this case restates independently, so a rename of one reddens HERE rather than
  // silently re-aiming an assertion at a phrase the product no longer emits.
  const constants: Array<[string, string, string]> = [
    ["STAGED_PLAN_PHRASE", gate.STAGED_PLAN_PHRASE, STAGED_PLAN_PHRASE],
    ["ALREADY_STAGED_PLAN_PHRASE", gate.ALREADY_STAGED_PLAN_PHRASE, ALREADY_STAGED_PLAN_PHRASE],
    ["INERT_PLAN_PHRASE", gate.INERT_PLAN_PHRASE, INERT_PLAN_PHRASE],
    ["NO_TEAM_STAGED_PHRASE", gate.NO_TEAM_STAGED_PHRASE, ADVISORY_PHRASE],
    ["STAGING_TOOL_NAME", gate.STAGING_TOOL_NAME, STAGING_TOOL],
    ["GATE_CONFIG_KEY", gate.GATE_CONFIG_KEY, "team.gate"],
    ["GATE_MODE_MECHANICAL", gate.GATE_MODE_MECHANICAL, GATE_MODE_MECHANICAL],
    ["GATE_MODE_ADVISORY", gate.GATE_MODE_ADVISORY, GATE_MODE_ADVISORY],
    ["GATE_MODE_OFF", gate.GATE_MODE_OFF, GATE_MODE_OFF],
  ]
  for (const [label, actual, expected] of constants) {
    if (actual !== expected) problems.push(at("constants") + label + " must be " + JSON.stringify(expected) + ", got " + JSON.stringify(actual))
  }

  // The mode resolver: `mechanical` is the DEFAULT and the FAIL-SAFE, so no typo can disable the gate.
  const modeCases: Array<[unknown, string]> = [
    ["advisory", GATE_MODE_ADVISORY],
    ["off", GATE_MODE_OFF],
    ["mechanical", GATE_MODE_MECHANICAL],
    [false, GATE_MODE_OFF],
    [true, GATE_MODE_MECHANICAL],
    [undefined, GATE_MODE_MECHANICAL],
    ["bogus", GATE_MODE_MECHANICAL],
    [0, GATE_MODE_MECHANICAL],
    [{ gate: "off" }, GATE_MODE_MECHANICAL],
  ]
  for (const [input, expected] of modeCases) {
    // The mode the shipped resolver answered for this raw value.
    const got = String(gate.resolveGateMode(input))
    if (got !== expected) problems.push(at("resolveGateMode") + JSON.stringify(input) + " must read " + expected + ", got " + got)
  }

  // ── the frozen predicate, both directions, per prompt set ──
  // Direction 1: a SIMPLE prompt must NOT trigger and must match NO signal.
  for (const prompt of SIMPLE_PROMPTS) {
    // The frozen predicate's verdict for this prompt.
    const verdict = gate.evaluateComplexityGate(prompt)
    if (verdict.trigger !== false || verdict.signals.length !== 0) {
      problems.push(at("simple") + JSON.stringify(prompt.slice(0, 44)) + " must stay untriggered with no signal, got " + JSON.stringify(verdict))
    }
  }

  // Direction 2: a SOFT-complex prompt must trigger and name at least one signal.
  for (const prompt of SOFT_COMPLEX_PROMPTS) {
    // The frozen predicate's verdict for this prompt.
    const verdict = gate.evaluateComplexityGate(prompt)
    if (verdict.trigger !== true || verdict.signals.length === 0) {
      problems.push(at("soft-complex") + JSON.stringify(prompt.slice(0, 44)) + " must trigger with a named signal, got " + JSON.stringify(verdict))
    }
  }

  // Direction 3: the EXPLICIT flag is CONSUMED and counts as signal A.
  for (const prompt of EXPLICIT_PROMPTS) {
    // This prompt's text with the explicit marker consumed, plus whether one was found.
    const consumed = gate.consumeExplicitFlag(prompt)
    if (consumed.flagged !== true) problems.push(at("explicit") + "the explicit marker must be detected in " + JSON.stringify(prompt))
    if (/(^|\s)!team|^team:/iu.test(consumed.text.trim())) problems.push(at("explicit") + "the marker must be CONSUMED from the goal text, got " + JSON.stringify(consumed.text))
    // The verdict of the CONSUMED text, driven with the flag the consumption reported.
    const verdict = gate.evaluateComplexityGate(consumed.text, { explicitFlag: consumed.flagged })
    if (verdict.trigger !== true || !verdict.signals.includes("A")) {
      problems.push(at("explicit") + "an explicit request must trigger with signal A, got " + JSON.stringify(verdict))
    }
  }

  // Direction 4 — SIGNAL D, REPAIRED. D is an ACTIVE boulder work, never a plan-file probe, so this
  // arm drives `readBoulderGate` through its INJECTED reader: every malformed state is exercised
  // offline, including the one that made the retired predicate fire in every session.
  const readerArms: Array<[string, () => Promise<string>, boolean]> = [
    ["an ACTIVE work must read active", async (): Promise<string> => boulderStateJson(ACTIVE_STATUS), true],
    ["a COMPLETED work must read INACTIVE", async (): Promise<string> => boulderStateJson(COMPLETED_STATUS), false],
    ["a work with NO status must read INACTIVE (the ratified conservative reading)", async (): Promise<string> => JSON.stringify({ active_work_id: "w1", works: { w1: { active_plan: SEEDED_PLAN_PATH } } }), false],
    ["a top-level ACTIVE state with no active_work_id must read active (the vendor fallback shape)", async (): Promise<string> => JSON.stringify({ status: ACTIVE_STATUS }), true],
    ["a non-object payload must read INACTIVE", async (): Promise<string> => JSON.stringify(["active"]), false],
    ["malformed JSON must read INACTIVE", async (): Promise<string> => "{ not json", false],
    ["a reader that throws (a missing file) must read INACTIVE", async (): Promise<string> => { throw new Error("ENOENT: no such file") }, false],
  ]
  for (const [label, readFile, expected] of readerArms) {
    // The verdict the shipped reader produced from this injected state.
    const read = await gate.readBoulderGate("/nonexistent-workspace", { readFile })
    if (read.active !== expected) problems.push(at("signal D") + label + ", got " + JSON.stringify(read))
  }
  // The ACTIVE arm also has to REPORT what it read, because the shell echoes the plan path when D fires.
  const activeRead = await gate.readBoulderGate("/nonexistent-workspace", { readFile: async (): Promise<string> => boulderStateJson(ACTIVE_STATUS) })
  if (activeRead.status !== ACTIVE_STATUS) problems.push(at("signal D") + "an active read must report status " + JSON.stringify(ACTIVE_STATUS) + ", got " + JSON.stringify(activeRead.status))
  if (activeRead.planPath !== SEEDED_PLAN_PATH) problems.push(at("signal D") + "an active read must report planPath " + JSON.stringify(SEEDED_PLAN_PATH) + ", got " + JSON.stringify(activeRead.planPath))

  // The predicate's D input: an active boulder contributes D and triggers ON ITS OWN, and an inactive
  // one contributes nothing — driven over a goal that carries no other signal.
  const dFired = gate.evaluateComplexityGate("hello", { activeBoulder: true })
  if (dFired.trigger !== true || !dFired.signals.includes("D")) problems.push(at("signal D") + "an ACTIVE boulder must trigger the gate with signal D, got " + JSON.stringify(dFired))
  // The falsifiability twin of the arm above: the SAME goal with D's input switched off.
  const dSilent = gate.evaluateComplexityGate("hello", { activeBoulder: false })
  if (dSilent.trigger !== false || dSilent.signals.length !== 0) problems.push(at("signal D") + "a COMPLETED/absent boulder must leave the gate silent, got " + JSON.stringify(dSilent))

  // …and the SAME read, through the DEFAULT reader (`node:fs/promises`), over a REAL file: the
  // repair's core claim is that a plan FILE alone is no longer a signal.
  const probe = mkdtempSync(join(tmpdir(), "mpd-gate-contract-"))
  try {
    // The retired predicate's whole subject: a plan artifact with no work behind it.
    mkdirSync(join(probe, ".mpd", "plans"), { recursive: true })
    writeFileSync(join(probe, ".mpd", "plans", "p.md"), "# plan\n")
    // What the shipped reader answers for that workspace, which holds a plan and NO ledger.
    const planOnly = await gate.readBoulderGate(probe)
    if (planOnly.active !== false) problems.push(at("signal D") + "a `.mpd/plans/*.md` artifact ALONE must not read as an active boulder — the retired plan-file probe fired in EVERY session of this workspace; got " + JSON.stringify(planOnly))
    // The same workspace WITH an active ledger, read through the same real reader.
    writeFileSync(join(probe, ".mpd", "boulder.json"), boulderStateJson(ACTIVE_STATUS))
    // The real-file read that must now fire.
    const active = await gate.readBoulderGate(probe)
    if (active.active !== true || active.status !== ACTIVE_STATUS || active.planPath !== SEEDED_PLAN_PATH) {
      problems.push(at("signal D") + "an active `.mpd/boulder.json` must read " + JSON.stringify({ active: true, status: ACTIVE_STATUS, planPath: SEEDED_PLAN_PATH }) + ", got " + JSON.stringify(active))
    }
    // The falsifiability twin: ONE field changes and the same read must go quiet.
    writeFileSync(join(probe, ".mpd", "boulder.json"), boulderStateJson(COMPLETED_STATUS))
    // The real-file read that must now stay silent.
    const completed = await gate.readBoulderGate(probe)
    if (completed.active !== false || completed.status !== COMPLETED_STATUS) {
      problems.push(at("signal D") + "a completed work must read INACTIVE while still reporting its status, got " + JSON.stringify(completed))
    }
  } finally {
    rmSync(probe, { recursive: true, force: true })
  }

  // ── the ADVISORY notice: the ONLY text that may say "NO team was staged" ──
  const advisories: Array<[string, string]> = [
    ["advisory", gate.advisoryNoticeText(["C"], false)],
    ["explicit-advisory", gate.advisoryNoticeText(["A"], true)],
  ]
  for (const [label, text] of advisories) {
    // The notice's text as a string, which is what every clause below searches.
    const body = String(text ?? "")
    if (!body.includes(NOTICE_MARKER)) problems.push(at("notice/" + label) + "the frozen marker is missing")
    if (!body.includes(ADVISORY_PHRASE)) problems.push(at("notice/" + label) + "the notice must state " + JSON.stringify(ADVISORY_PHRASE))
    if (body.includes(STAGED_PLAN_PHRASE) || body.includes(ALREADY_STAGED_PLAN_PHRASE)) {
      problems.push(at("notice/" + label) + "the ADVISORY notice must NEVER claim a staged plan (the two-taxonomy rule)")
    }
    for (const tool of OFFICIAL_TOOLS) if (!body.includes(tool)) problems.push(at("notice/" + label) + "the notice must name the official tool `" + tool + "`")
    // The retired family is judged PER TEXT: on the advisory text NONE of it may appear.
    const retired = retiredToolTokens(body)
    if (retired.length > 0) problems.push(at("notice/" + label) + "the ADVISORY notice must not name the RETIRED agent_teams_* vocabulary, got " + JSON.stringify(retired))
    if (body.includes(RETIRED_PROVISIONED_PHRASE)) problems.push(at("notice/" + label) + "the retired PROVISIONING sentence must be gone (the gate stages no team)")
  }

  // ── the MECHANICAL notice: the marker, the STAGED sentence, the RETURNED id, the inert bound ──
  // The shipped builder, driven with an id this case chose — so the notice cannot pass by echoing a
  // phrase the case itself supplied.
  const mechanical = String(gate.mechanicalNoticeText({ planId: PROBE_PLAN_ID, signals: ["A"], explicit: true, alreadyStaged: false }) ?? "")
  if (!mechanical.includes(NOTICE_MARKER)) problems.push(at("notice/mechanical") + "the frozen marker is missing")
  if (!mechanical.includes(STAGED_PLAN_PHRASE)) problems.push(at("notice/mechanical") + "the notice must state " + JSON.stringify(STAGED_PLAN_PHRASE))
  if (!mechanical.includes(PROBE_PLAN_ID)) problems.push(at("notice/mechanical") + "the notice must name the plan id the staging call RETURNED (" + PROBE_PLAN_ID + ")")
  if (!mechanical.includes(INERT_PLAN_PHRASE)) problems.push(at("notice/mechanical") + "the notice must state " + JSON.stringify(INERT_PLAN_PHRASE))
  if (!mechanical.includes(NOTICE_SHELL_PHRASE)) problems.push(at("notice/mechanical") + "the notice must state the SHELL shape " + JSON.stringify(NOTICE_SHELL_PHRASE))
  if (!mechanical.includes(STAGING_TOOL)) problems.push(at("notice/mechanical") + "the notice must name the tool it calls (`" + STAGING_TOOL + "`)")
  if (mechanical.includes(ADVISORY_PHRASE)) problems.push(at("notice/mechanical") + "the MECHANICAL notice must not ALSO state " + JSON.stringify(ADVISORY_PHRASE) + " — the two-taxonomy rule")
  // The mechanical text names our OWN plane, so the retired family is scoped to every token EXCEPT
  // `agent_teams_plan`: the assertion stays alive (a retired `agent_teams_spawn` still reddens) instead
  // of being weakened into nothing by the one legitimate token.
  const mechanicalRetired = retiredToolTokens(mechanical)
  if (mechanicalRetired.length > 0) problems.push(at("notice/mechanical") + "the MECHANICAL notice may name ONLY `" + STAGING_TOOL + "`, got " + JSON.stringify(mechanicalRetired))
  if (mechanical.includes(RETIRED_PROVISIONED_PHRASE)) problems.push(at("notice/mechanical") + "the retired PROVISIONING sentence must be gone on the mechanical route too")
  // The skipped-staging twin: an already-staged plan is NAMED, and the notice says no second stage ran.
  const already = String(gate.mechanicalNoticeText({ planId: PROBE_PLAN_ID, signals: ["C"], explicit: false, alreadyStaged: true }) ?? "")
  if (!already.includes(ALREADY_STAGED_PLAN_PHRASE)) problems.push(at("notice/mechanical-already") + "the notice must state " + JSON.stringify(ALREADY_STAGED_PLAN_PHRASE))
  if (!already.includes(PROBE_PLAN_ID)) problems.push(at("notice/mechanical-already") + "the notice must name the plan id already staged")
  if (!already.includes(INERT_PLAN_PHRASE)) problems.push(at("notice/mechanical-already") + "the inert bound must hold on the skipped-staging route too")
  if (already.includes(STAGED_PLAN_PHRASE)) problems.push(at("notice/mechanical-already") + "a fire that did NOT stage must not claim " + JSON.stringify(STAGED_PLAN_PHRASE))
  // The call that reported NO id: the notice says so rather than inventing one.
  const noId = String(gate.mechanicalNoticeText({ planId: "", signals: ["B"], explicit: false, alreadyStaged: false }) ?? "")
  if (!noId.includes("plan id not reported")) problems.push(at("notice/mechanical-no-id") + "an empty id must be reported as unreported, never invented")

  // ── the staged SHELL: 0 members and 0 tasks by construction, never a guessed team ──
  const shell = gate.gatePlanShell({ signals: ["C"], goal: "Align the bundle\nwith upstream.", planPath: SEEDED_PLAN_PATH })
  if (shell.approval !== "required") problems.push(at("shell") + "approval must be `required`: the gate can never auto-approve a plan it could not decompose, got " + JSON.stringify(shell.approval))
  if (shell.name !== "Align the bundle") problems.push(at("shell") + "the name must be the goal's FIRST line, whitespace-collapsed, got " + JSON.stringify(shell.name))
  if (!shell.description.includes(DESCRIPTION_SHELL_PHRASE)) problems.push(at("shell") + "the description must state " + JSON.stringify(DESCRIPTION_SHELL_PHRASE))
  if (!shell.description.includes(SEEDED_PLAN_PATH)) problems.push(at("shell") + "the description must echo the active plan artifact when signal D fired")
  if (!shell.description.includes(STAGING_TOOL)) problems.push(at("shell") + "the description must name the tool that extends and approves it")
  // The shell's OWN key set: a `members` or `tasks` list here would be the "invent a team" defect.
  const shellKeys: string[] = Object.keys(shell)
  for (const forbidden of ["members", "tasks"]) {
    if (shellKeys.includes(forbidden)) problems.push(at("shell") + "the gate cannot decompose the goal, so the shell must carry NO `" + forbidden + "` field")
  }
  if (!shellKeys.includes("name") || !shellKeys.includes("description") || !shellKeys.includes("approval")) {
    problems.push(at("shell") + "the shell must carry exactly the three gate-filled fields (name/description/approval), got " + JSON.stringify(shellKeys))
  }
  // A long first line is CLIPPED; an empty goal takes the builder's own fallback name.
  const clipped = gate.gatePlanShell({ signals: [], goal: "A".repeat(200) })
  if (clipped.name.length !== PLAN_NAME_MAX) problems.push(at("shell") + "a long first line must be clipped to " + PLAN_NAME_MAX + " chars, got " + clipped.name.length)
  // The shell built from a goal with NO usable first line, which must take the fallback name.
  const empty = gate.gatePlanShell({ signals: [], goal: "   \n  " })
  if (empty.name !== PLAN_NAME_FALLBACK) problems.push(at("shell") + "a whitespace-only goal must take the fallback name " + JSON.stringify(PLAN_NAME_FALLBACK) + ", got " + JSON.stringify(empty.name))
  // With NO plan path the description must not carry the D sentence at all.
  const noPlan = gate.gatePlanShell({ signals: ["B"], goal: "Align the bundle" })
  if (noPlan.description.includes("Active plan artifact")) problems.push(at("shell") + "a shell built WITHOUT a plan path must not claim one")

  // ── scope: configured presets, top-level sessions only ──
  if (!Array.isArray(gate.DEFAULT_GATE_PRESETS) || !gate.DEFAULT_GATE_PRESETS.includes("mpd")) {
    problems.push(at("scope") + "the default gate presets must include `mpd`, got " + JSON.stringify(gate.DEFAULT_GATE_PRESETS))
  }
  if (gate.sessionQualifies({ session: { header: { parentSession: "parent-1", agentPreset: "mpd" } } }) !== false) {
    problems.push(at("scope") + "a CHILD session must never get a gate of its own")
  }
  if (gate.sessionQualifies({ session: { header: { agentPreset: "standard" } } }) !== false) {
    problems.push(at("scope") + "another preset's session must not be gated")
  }
  return problems
}

/** The offline arm: the shipped contract plus the negative controls and the wiring pins. */
async function selfTest(): Promise<void> {
  // The shipped PURE gate module, imported from its SOURCE so the case never asserts a built copy.
  const gate = await loadGate()
  // Every contract violation the shipped implementation produced.
  const problems = await contractProblems(gate)
  if (problems.length > 0) {
    for (const problem of problems) console.error("  - " + problem)
    fail("the shipped gate violates its frozen contract (" + problems.length + " problem(s))")
  }

  // ── NEGATIVE CONTROLS: the SAME contract must REDDEN for a broken implementation ──
  // Both directions are covered, so neither "always fires" nor "never fires" can pass.
  // A gate that fires on every prompt, which must fail the simple direction.
  const alwaysTrigger = {
    ...gate,
    evaluateComplexityGate: (): ComplexityVerdict => ({ trigger: true, signals: ["C"] }),
  }
  // A gate that fires on nothing, which must fail the triggered directions.
  const alwaysSilent = {
    ...gate,
    evaluateComplexityGate: (): ComplexityVerdict => ({ trigger: false, signals: [] }),
    advisoryNoticeText: (): string => "nothing to see here",
  }
  // A gate whose MECHANICAL notice is really the advisory text: the two-taxonomy clauses must bite.
  const confusedNotice = {
    ...gate,
    mechanicalNoticeText: (): string => gate.advisoryNoticeText(["A"], true),
  }
  // The violations the always-triggering stub produced, proving the simple arm is falsifiable.
  const triggerProblems = await contractProblems(alwaysTrigger)
  if (triggerProblems.length === 0) fail("negative control: a gate that triggers on EVERYTHING passed the contract")
  // The violations the always-silent stub produced, proving the triggered arms are falsifiable.
  const silentProblems = await contractProblems(alwaysSilent)
  if (silentProblems.length === 0) fail("negative control: a gate that triggers on NOTHING passed the contract")
  // The violations the notice-confused stub produced, proving the taxonomy clauses are falsifiable.
  const confusedProblems = await contractProblems(confusedNotice)
  if (confusedProblems.length === 0) fail("negative control: a mechanical notice that only ADVISES passed the contract")

  // ── the LIVE verdict's own falsifiability, driven offline through the SAME `evaluateSide()` ──
  // A mechanical side that staged ONE matching shell and spawned nobody must PASS…
  const passingSide = evaluateSide({ expect: "stage", notice: mechanicalNoticeFixture(), teams: stageScanFixture(), markerConsumed: undefined, expectedSignal: "D" })
  if (!passingSide.ok) fail("the live verdict must PASS a mechanical side that staged one matching shell: " + JSON.stringify(passingSide.problems))
  // …and the EXACT class the retired helper could not see must REDDEN: one spawned team record.
  const spawnedSide = evaluateSide({ expect: "stage", notice: mechanicalNoticeFixture(), teams: stageScanFixture({ records: 1, recordIds: ["team-1"] }), markerConsumed: undefined, expectedSignal: "D" })
  if (spawnedSide.ok) fail("the live verdict must REDDEN when a team RECORD exists — the retired helper scanned a layout mpd-team-core never writes, so it read 0 by construction (P6)")
  // A notice whose plan id disagrees with the staged slot must redden too: the id is the RETURNED one.
  const mismatchedSide = evaluateSide({ expect: "stage", notice: mechanicalNoticeFixture(), teams: stageScanFixture({ planIds: ["plan-20250101000000"] }), markerConsumed: undefined, expectedSignal: "D" })
  if (mismatchedSide.ok) fail("the live verdict must REDDEN when the notice's plan id differs from the staged slot's")
  // …and an untriggered side that recorded a notice is the falsifiability arm, which must also redden.
  const leakedSide = evaluateSide({ expect: "none", notice: mechanicalNoticeFixture(), teams: stageScanFixture(), markerConsumed: undefined, expectedSignal: undefined })
  if (leakedSide.ok) fail("the live verdict must REDDEN when an untriggered side recorded a notice")

  // ── the STAGE SCAN itself, offline: the (P6) repair provable WITHOUT a boot ──
  // A fixture workspace holding the REAL layout, the RETIRED decoy, and one spawned team record.
  const stageProbe = mkdtempSync(join(tmpdir(), "mpd-gate-stage-"))
  try {
    mkdirSync(join(stageProbe, ".mpd", "team", "staging"), { recursive: true })
    writeFileSync(join(stageProbe, ".mpd", "team", "staging", "sess-1.json"), JSON.stringify({ version: 1, planId: PROBE_PLAN_ID, sessionId: "sess-1", members: [], tasks: [] }))
    mkdirSync(join(stageProbe, ".mpd", "team", "teams"), { recursive: true })
    writeFileSync(join(stageProbe, ".mpd", "team", "teams", "team-1.json"), JSON.stringify({ id: "team-1", members: [{ name: "spawned" }] }))
    // The RETIRED layout a helper could regress to: its presence must change NOTHING at all.
    mkdirSync(join(stageProbe, ".mpd", "team", "mpd-default-9"), { recursive: true })
    writeFileSync(join(stageProbe, ".mpd", "team", "mpd-default-9", "team.json"), JSON.stringify({ id: "mpd-default-9" }))
    // The scan over that fixture, which must read the REAL layout only.
    const scan = teamStageScan(stageProbe)
    if (scan.staged !== 1) fail("the stage scan must read EXACTLY ONE `.mpd/team/staging` slot, got " + scan.staged)
    if (scan.planIds[0] !== PROBE_PLAN_ID) fail("the stage scan must report the staged plan's planId, got " + JSON.stringify(scan.planIds))
    if (scan.records !== 1 || scan.recordIds[0] !== "team-1") fail("the stage scan must count the REAL record layout `.mpd/team/teams/*.json` and IGNORE the retired `.mpd/team/<id>/team.json` decoy, got " + JSON.stringify(scan.recordIds))
    if (scan.stagedMembers !== 0 || scan.stagedTasks !== 0) fail("a gate-staged SHELL must read 0 members / 0 tasks, got " + scan.stagedMembers + "/" + scan.stagedTasks)
    // The falsifiability twin: a staged plan WITH a member and a task must be reported as such, so
    // the "the staged plan must be a SHELL" clause can fail rather than being unprovable.
    writeFileSync(join(stageProbe, ".mpd", "team", "staging", "sess-1.json"), JSON.stringify({ version: 1, planId: PROBE_PLAN_ID, sessionId: "sess-1", members: [{ name: "spawned" }], tasks: [{ subject: "t" }] }))
    // The same scan over the NON-shell twin, whose counts must move.
    const withMember = teamStageScan(stageProbe)
    if (withMember.stagedMembers !== 1 || withMember.stagedTasks !== 1) fail("the stage scan must count staged members/tasks, got " + withMember.stagedMembers + "/" + withMember.stagedTasks)
  } finally {
    rmSync(stageProbe, { recursive: true, force: true })
  }

  // ── the wiring the live boot depends on ──
  // The bundle patch, which must mount the row that hosts the gate.
  const patch = readFileSync(join(repoRoot, "cordis.patch.yml"), "utf8")
  if (!/id: mpd-roles\b/.test(patch)) fail("the bundle patch no longer mounts the `mpd-roles` row — the gate has no home")
  if (/^\s*name: '@deepseek-ai\/dsh-agent-presets'\s*$/m.test(patch)) fail("the retired @deepseek-ai/dsh-agent-presets row came back")
  if (/id:\s*agent-teams\s*$/m.test(patch)) fail("the RETIRED vendored `agent-teams` row came back into the bundle patch")
  if (patch.includes("sessionTeamPolicy")) fail("the retired `sessionTeamPolicy` row config came back into the bundle patch")
  // The preset carries the convention the gate serves, in the OFFICIAL vocabulary. The preset's
  // MECHANICAL wording is pinned by `packages/mpd-roles-plugin/test/team-plane.test.ts` (which reads
  // the same shipped file) and is deliberately NOT duplicated here: this case must stay green on ITS
  // OWN subject rather than on another lane's in-flight preset edit.
  const preset = readMpdPresetSource(repoRoot)
  if (preset === "") fail("no declared bundle patch declares the `preset-mpd` row — the preset audit has no subject")
  if (!preset.includes("SESSION STARTUP RULE")) fail("the mpd preset no longer states the SESSION STARTUP RULE")
  if (!preset.includes("spawn_teammate")) fail("the mpd preset must name the OFFICIAL staging tool `spawn_teammate`")
  if (/MUST start inside a team|MUST begin inside a team/.test(preset)) fail("the mpd preset still carries the retired mandatory-team invariant")

  console.log("[session-start-team self-test] ok: the shipped PURE gate module conforms to the MECHANICAL contract ("
    + SIMPLE_PROMPTS.length + " simple / " + SOFT_COMPLEX_PROMPTS.length + " soft-complex / " + EXPLICIT_PROMPTS.length + " explicit / 1 boulder-probe prompt, both ways; "
    + "signal D through the INJECTED reader AND the real filesystem, the mode FAIL-SAFE, the shell builder's honest bounds, "
    + "both notices with the retired vocabulary scoped per text, and the session scope)"
    + "; THREE negative controls reddened (always-trigger " + triggerProblems.length + ", always-silent " + silentProblems.length
    + ", advisory-only-mechanical " + confusedProblems.length + " problem(s))"
    + "; the LIVE verdict and the REAL `.mpd/team` stage scan were each driven offline BOTH ways (a matching shell passes; a spawned record, a plan-id mismatch, a leaked notice and a non-shell staged plan all redden)"
    + "; bundle mounts mpd-roles with the retired rows gone; preset carries the SESSION STARTUP RULE")
}

// ── live lane ────────────────────────────────────────────────────────────────

/**
 * The user-role messages the HARNESS recorded for one workspace (sanctioned reader).
 * @param home The isolated `DSH_HOME` whose session store is read.
 * @param ws The sandbox workspace whose project-keyed store is read.
 * @returns The recorded texts plus the reader's own counts, or its failure text.
 */
function recordedUserTexts(home: string, ws: string): RecordedUserTexts {
  try {
    // The harness's own session-log view of this workspace.
    const store = readSessionEvents(home, { workspace: ws })
    // Every user-role text the log recorded, in record order.
    const texts: string[] = []
    for (const record of store.records) {
      if (record?.type !== "user/message") continue
      // The record's `data.content` blocks, empty when the harness recorded none.
      const content = arrayFieldOf(fieldOf(record, "data"), "content")
      // The record's text blocks joined, which is what the notice classification reads.
      const text = content.filter((block) => fieldOf(block, "type") === "text").map((block) => String(fieldOf(block, "text") ?? "")).join("\n")
      if (text.length > 0) texts.push(text)
    }
    return { ok: true, texts, records: store.records.length, frames: store.frames, file: store.file }
  } catch (error) {
    return { ok: false, texts: [], records: 0, frames: 0, file: null, error: errorDetail(error) }
  }
}

/**
 * The notices the session log carries: the marker, BOTH taxonomies, the plan ids and the fired signals.
 * @param texts Every user-role text the session log recorded.
 * @returns The counts each notice assertion reads, plus the named plan ids and signal runs.
 */
function classifyNotices(texts: readonly string[]): NoticeClassification {
  // Every recorded text that carries the frozen marker.
  const marked = texts.filter((text) => text.includes(NOTICE_MARKER))
  // The marked texts that state that no team was staged (the ADVISORY taxonomy).
  const advisory = marked.filter((text) => text.includes(ADVISORY_PHRASE))
  // The marked texts that claim a staged plan, fresh or already there (the MECHANICAL taxonomy).
  const mechanical = marked.filter((text) => text.includes(STAGED_PLAN_PHRASE) || text.includes(ALREADY_STAGED_PLAN_PHRASE))
  // The marked texts that still carry the retired PROVISIONING sentence.
  const retiredProvisioned = marked.filter((text) => text.includes(RETIRED_PROVISIONED_PHRASE))
  // The marked ADVISORY texts that name every official staging tool.
  const officialTools = advisory.filter((text) => OFFICIAL_TOOLS.every((tool) => text.includes(tool)))
  // The marked MECHANICAL texts that name OUR staging tool.
  const mechanicalTool = mechanical.filter((text) => text.includes(STAGING_TOOL))
  // The marked texts that name any `agent_teams_*` token but the staging tool.
  const retiredVocabulary = marked.filter((text) => retiredToolTokens(text).length > 0)
  // The fired-signal runs every marked notice named, in record order (both taxonomies share the prefix).
  const signals = marked.map((text) => /complexity signals ([A-D](?:\/[A-D])*)/.exec(text)?.[1]).filter((value): value is string => value !== undefined)
  // Every plan id any marked notice named, in record order.
  const planIds = marked.flatMap((text) => planIdsIn(text))
  return {
    any: marked.length,
    advisory: advisory.length,
    mechanical: mechanical.length,
    signalsNamed: signals.length,
    shellShaped: marked.filter((text) => text.includes(NOTICE_SHELL_PHRASE)).length,
    inert: marked.filter((text) => text.includes(INERT_PLAN_PHRASE)).length,
    retiredProvisioned: retiredProvisioned.length,
    officialTools: officialTools.length,
    mechanicalTool: mechanicalTool.length,
    retiredVocabulary: retiredVocabulary.length,
    signals,
    planIds,
  }
}

/**
 * What one side's workspace holds under the mpd-team-core sidecar root — the REAL layout.
 *
 * THIS IS THE (P6) REPAIR. The retired helper scanned `.mpd/team/<id>/team.json`, a layout
 * mpd-team-core never writes, so "staged nothing" was true BY CONSTRUCTION and the assertion could
 * not fail. mpd-team-core stages at `.mpd/team/staging/<sessionId>.json` and materialises a record at
 * `.mpd/team/teams/<teamId>.json` only at APPROVAL, so the pair below is what makes
 * "a plan was STAGED, no team was SPAWNED" provable.
 * @param ws The side's sandbox workspace.
 * @returns The staged-slot facts plus the team-record count, never a throw.
 */
export function teamStageScan(ws: string): TeamStageScan {
  // The sidecar root the bundle's team plane owns under this workspace.
  const root = join(ws, ".mpd", "team")
  // The staging directory: one JSON slot per session that has a staged plan.
  const stagingRoot = join(root, "staging")
  // Every staged slot's decoded payload, skipping a slot that cannot be read or decoded.
  const plans: Array<Record<string, unknown>> = []
  if (existsSync(stagingRoot)) {
    for (const name of readdirSync(stagingRoot)) {
      if (!name.endsWith(".json")) continue
      try {
        // This slot's decoded payload, accepted only when it is a plain object.
        const parsed: unknown = JSON.parse(readFileSync(join(stagingRoot, name), "utf8"))
        if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) plans.push(parsed as Record<string, unknown>)
      } catch { /* an unreadable slot is counted nowhere: the scan itself must never throw */ }
    }
  }
  // The plan ids the staged slots record, with an absent id contributing nothing.
  const planIds = plans.map((plan) => String(plan.planId ?? "")).filter((id) => id !== "")
  // The team RECORDS, which exist only after an approval really spawned someone.
  const teamsRoot = join(root, "teams")
  // Every record file name, empty while no team has been approved.
  const recordFiles = existsSync(teamsRoot) ? readdirSync(teamsRoot).filter((name) => name.endsWith(".json")) : []
  return {
    staged: plans.length,
    planIds,
    stagedMembers: plans.reduce((total, plan) => total + (Array.isArray(plan.members) ? plan.members.length : 0), 0),
    stagedTasks: plans.reduce((total, plan) => total + (Array.isArray(plan.tasks) ? plan.tasks.length : 0), 0),
    records: recordFiles.length,
    recordIds: recordFiles.map((name) => name.replace(/\.json$/u, "")),
  }
}

/**
 * The sha256 of one file, read through the system tool the run's evidence already uses.
 * @param path Absolute path of the file to fingerprint.
 * @returns The lowercase hex digest, or `""` when the tool printed nothing.
 */
function sha256(path: string): string {
  // The `sha256sum` child's result, whose first whitespace-separated field is the digest.
  const r = spawnSync("sha256sum", [path], { encoding: "utf8" })
  return (r.stdout || "").trim().split(/\s+/)[0]
}

/**
 * The `mpd-roles` row's OWN log text for one side's workspace — the boot signature and the fire lines.
 *
 * MEASURED 2026-10-06, on the first live run of this rewrite: scanning the child's stdout/stderr for
 * `sessionGate=` found NOTHING on every side while the row had written the line. The cause is the R5
 * rule — `rowLogLine` appends to `<workspace>/.mpd/logs/<row>.log` so a TUI session's alternate screen
 * is never polluted — and the workspace is the SIDE's cwd, so this file (not the boot output) is where
 * a live assertion must read.
 * @param ws The side's sandbox workspace.
 * @returns The file's text, or `""` when it is absent or unreadable.
 */
function rowLogText(ws: string): string {
  // The row's log file under this side's own workspace.
  const file = join(ws, ROW_LOG_REL)
  try {
    return existsSync(file) ? readFileSync(file, "utf8") : ""
  } catch {
    return ""
  }
}

/**
 * The verdict of ONE live side. Pure, so `--self-test` fixtures could drive it too.
 * @param input The side's expectation and the measurements the session log + workspace produced.
 * @returns Whether the side held, plus every violation it recorded.
 */
export function evaluateSide({ expect, notice, teams, markerConsumed, expectedSignal }: LiveSideInput): SideVerdict {
  // Every violation this side recorded, in the order the clauses are checked.
  const problems: string[] = []
  if (expect === "none" || expect === "off") {
    // THE FALSIFIABILITY ARMS: a gate that fires on everything reddens HERE (and a `team.gate:"off"`
    // that still staged would redden here too).
    if (notice.any !== 0) problems.push((expect === "off" ? "team.gate=off" : "an untriggered prompt") + " must leave NO notice, got " + notice.any)
    if (teams.staged !== 0) problems.push("nothing may be staged here, got " + teams.staged + " staged plan slot(s)")
    if (teams.records !== 0) problems.push("nothing may be spawned here, got " + teams.records + " team record(s)")
    return { ok: problems.length === 0, problems }
  }
  // Both triggered routes record EXACTLY ONE notice; the retired family is judged on EVERY side.
  if (notice.any !== 1) problems.push("a triggered prompt must record EXACTLY ONE notice, got " + notice.any)
  if (notice.retiredVocabulary !== 0) problems.push("the notice must not name the RETIRED agent_teams_* vocabulary (only `" + STAGING_TOOL + "` is ours)")
  if (notice.retiredProvisioned !== 0) problems.push("the retired PROVISIONING notice must not come back")
  if (notice.signalsNamed !== 1) problems.push("the notice must name the fired complexity signals, got " + notice.signalsNamed)
  if (expectedSignal !== undefined && !notice.signals.some((run) => run.split("/").includes(expectedSignal))) {
    problems.push("the notice must name signal " + expectedSignal + " (this side is built to prove it), got " + JSON.stringify(notice.signals))
  }
  if (expect === "advisory") {
    if (notice.advisory !== 1) problems.push("the ADVISORY notice must state " + JSON.stringify(ADVISORY_PHRASE) + ", got " + notice.advisory)
    if (notice.mechanical !== 0) problems.push("the ADVISORY route must never claim a staged plan, got " + notice.mechanical)
    if (notice.officialTools !== 1) problems.push("the ADVISORY notice must name BOTH official tools (" + OFFICIAL_TOOLS.join(", ") + "), got " + notice.officialTools)
    if (teams.staged !== 0) problems.push("the gate is ADVISORY: it must stage NO plan, got " + teams.staged)
    if (teams.records !== 0) problems.push("the gate stages nothing, so it spawns no team record, got " + teams.records)
    return { ok: problems.length === 0, problems }
  }
  // expect === "stage": THE MECHANICAL CONTRACT — a plan was STAGED and NOTHING was spawned.
  if (notice.mechanical !== 1) problems.push("the MECHANICAL notice must state " + JSON.stringify(STAGED_PLAN_PHRASE) + ", got " + notice.mechanical)
  if (notice.advisory !== 0) problems.push("the MECHANICAL notice must not ALSO state " + JSON.stringify(ADVISORY_PHRASE) + " — the two-taxonomy rule")
  if (notice.inert !== 1) problems.push("the notice must state " + JSON.stringify(INERT_PLAN_PHRASE) + ", got " + notice.inert)
  if (notice.shellShaped !== 1) problems.push("the notice must state the SHELL shape " + JSON.stringify(NOTICE_SHELL_PHRASE) + ", got " + notice.shellShaped)
  if (notice.mechanicalTool !== 1) problems.push("the notice must name the staging tool `" + STAGING_TOOL + "`, got " + notice.mechanicalTool)
  if (teams.staged !== 1) problems.push("a triggered mechanical side must stage EXACTLY ONE plan slot, got " + teams.staged)
  if (teams.records !== 0) problems.push("a STAGED plan is NOT a spawned team: `.mpd/team/teams/` must hold ZERO records, got " + teams.records + " " + JSON.stringify(teams.recordIds))
  if (notice.planIds.length !== 1) problems.push("the notice must name EXACTLY ONE plan id, got " + JSON.stringify(notice.planIds))
  if (notice.planIds.length === 1 && teams.planIds.length === 1 && notice.planIds[0] !== teams.planIds[0]) {
    problems.push("the notice names " + notice.planIds[0] + " while the staged slot holds " + teams.planIds[0] + " — the notice must name the id the staging call RETURNED")
  }
  if (teams.stagedMembers !== 0 || teams.stagedTasks !== 0) {
    problems.push("the staged plan must be a SHELL: 0 members and 0 tasks, got " + teams.stagedMembers + "/" + teams.stagedTasks)
  }
  if (markerConsumed !== undefined && markerConsumed !== true) problems.push("the explicit `team:` marker must be CONSUMED from the recorded goal text")
  return { ok: problems.length === 0, problems }
}

/** The live arm: an isolated profile boot per prompt side, judged from the harness session log. */
async function runReal(): Promise<void> {
  // The declared credential store, copied ONCE into the sandbox (never read from the real home).
  const creds = join(homedir(), ".dsh", ".credentials.yaml")
  if (!existsSync(creds)) fail("missing credentials at " + creds)
  // The run's timestamp, which names the evidence directory and holds no path separator.
  const ts = new Date().toISOString().replaceAll(":", "-")
  // The evidence directory this run writes its verdict and log into.
  const outDir = process.env.MPD_QA_EVIDENCE_DIR
    ? join(process.env.MPD_QA_EVIDENCE_DIR, "session-start-team-" + ts)
    : join(repoRoot, "evidence", "dsh-qa", "session-start-team", ts)
  mkdirSync(outDir, { recursive: true })

  // The live lane boots an INSTALLED profile: the row that runs is the built dist, so a dist that
  // does not carry the MECHANICAL gate would make this whole lane prove NOTHING while looking
  // green-free. Assert the artifact really carries the contract, and name the rebuild command
  // instead of reporting a mysterious "no notice".
  // The built row's bytes, which must already carry the mechanical route this case asserts.
  const distText = readFileSync(ROLES_DIST, "utf8")
  // The mechanical-era needles the built row must carry (a stale advisory-era dist fails them all).
  const distNeedles: readonly string[] = ["installSessionGate", STAGED_PLAN_PHRASE, INERT_PLAN_PHRASE, STAGING_TOOL]
  // Every needle the dist is missing, so the banner names the gap instead of only the file.
  const distMissing = distNeedles.filter((needle) => !distText.includes(needle))
  if (distMissing.length > 0) {
    fail("the built row " + ROLES_DIST + " does not carry the MECHANICAL session-start gate (missing " + JSON.stringify(distMissing)
      + "), so a boot would prove nothing — rebuild it: " + REBUILD_COMMAND)
  }

  // The repository revision BEFORE the settle window.
  const rev0 = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).stdout.trim()
  // The PURE gate source's fingerprint BEFORE the settle window.
  const gateHash0 = sha256(GATE_SOURCE)
  // The WIRING module's fingerprint BEFORE the settle window (its bytes decide the live behaviour).
  const wiringHash0 = sha256(GATE_WIRING)
  LOG.push("settleWait: " + SETTLE_MS + " ms (revision " + rev0 + ", complexity-gate.ts " + gateHash0.slice(0, 16) + ", session-gate.ts " + wiringHash0.slice(0, 16) + ")")
  // The settle window: HEAD and BOTH gate sources must be identical on both sides of it.
  await new Promise<void>((resolve): void => { setTimeout(resolve, SETTLE_MS) })
  // The repository revision AFTER the settle window.
  const rev1 = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).stdout.trim()
  // The PURE gate source's fingerprint AFTER the settle window.
  const gateHash1 = sha256(GATE_SOURCE)
  // The WIRING module's fingerprint AFTER the settle window.
  const wiringHash1 = sha256(GATE_WIRING)
  // Whether the revision and BOTH gate sources were byte-identical across the window.
  const settled = rev0 === rev1 && gateHash0 === gateHash1 && wiringHash0 === wiringHash1
  // The run's verdict ledger, one entry per step this case asserts.
  const steps: Record<string, LiveStep | LiveStep[]> = {
    settled: { ok: settled, rev: rev1, gateHash: gateHash1, wiringHash: wiringHash1, measuredAt: new Date().toISOString() },
  }
  if (!settled) fail("revision did not settle (HEAD, complexity-gate.ts or session-gate.ts changed during the window)")

  // The sandbox `DSH_HOME` the isolated profile is installed into.
  const sandbox = mkdtempSync(join(tmpdir(), "mpd-sst-"))
  // The sandbox `HOME`, which is what keeps skill roots out of the real home.
  const sandboxHome = join(sandbox, "home")
  mkdirSync(sandboxHome, { recursive: true })
  seedSandboxCredentials(sandbox, { credentialsFile: creds })
  // The declared settings file, copied when present so the live model chain resolves.
  const settings = join(homedir(), ".dsh", "settings.yaml")
  if (existsSync(settings)) writeFileSync(join(sandbox, "settings.yaml"), readFileSync(settings))
  // AGENTS.md §7: HOME is sandboxed too, and the workspace is passed explicitly on every
  // spawn (env alone cannot isolate it).
  // The child environment: the sandbox home pair plus the resolved provider credential.
  const env = credentialEnv({ ...process.env, DSH_HOME: sandbox, HOME: sandboxHome })
  if (env.DSH_HOME !== sandbox || env.HOME !== sandboxHome) fail("isolation assertion failed")

  /**
   * Run one child with the sandbox environment and log its output for the evidence file.
   * @param cmd The command name, or `dsh` to go through the PATH-resolved launcher.
   * @param args The argument vector.
   * @param opts Optional timeout and working directory.
   * @returns The child's status and both output views.
   */
  function runSync(cmd: string, args: string[], opts: RunSyncOptions = {}): ChildRun {
    // The launcher spec: `dsh` is PATH-resolved (win32 needs its shim), any other name is verbatim.
    const spec = cmd === "dsh" ? dshCommand(args, env) : { command: cmd, args }
    // The child's result, or a synthetic miss when no `dsh` launcher resolves at all.
    const r = spec === null ? { status: null, stdout: "", stderr: DSH_MISSING } : spawnSync(spec.command, spec.args, { env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: opts.timeout ?? 900000, cwd: opts.cwd ?? repoRoot, stdio: ["ignore", "pipe", "pipe"] })
    // The child's stdout and stderr concatenated, which both the log and the markers read.
    const out = (r.stdout || "") + (r.stderr || "")
    LOG.push("$ " + cmd + " " + args.join(" ") + "\n[[exit=" + r.status + "]]\n" + out.slice(0, 20000))
    return { status: r.status, out, stdout: r.stdout || "" }
  }

  // The isolated install, which is what materializes the profile the boots read.
  const inst = runSync(process.execPath, [join(repoRoot, "scripts", "install-profile.ts"), "--yes", "--dsh-home", sandbox, "--profile", "mpd-headless", "--skip-toolchain"], { timeout: 600000 })
  steps.installer = { ok: inst.status === 0, exit: inst.status }
  // The installed home patch, which must mount `mpd-roles` and no retired row.
  const homePatch = readFileSync(join(sandbox, "cordis.patch.yml"), "utf8")
  steps.patchRow = {
    ok: /id:\s*mpd-roles/.test(homePatch) && !/id:\s*agent-teams\s*$/m.test(homePatch) && !homePatch.includes("sessionTeamPolicy"),
    mountsRoles: /id:\s*mpd-roles/.test(homePatch),
    retiredAgentTeamsRow: /id:\s*agent-teams\s*$/m.test(homePatch),
  }
  assertSessionsSandboxed(sandbox, sandbox, { label: "session-start-team-main" })

  /**
   * One boot per prompt, in its own SEEDED sandbox workspace (never the checkout).
   * @param label The side's name, which also names its evidence subdirectory.
   * @param prompts The frozen prompts to boot, verbatim.
   * @param side The side's whole expectation: the verdict, the boot-line mode and what it seeds.
   * @returns One verdict object per prompt, exactly the shape the evidence JSON records.
   */
  function runSide(label: string, prompts: readonly string[], side: SideSpec): LiveStep[] {
    // One verdict per prompt of this side, in prompt order.
    const results: LiveStep[] = []
    for (let index = 0; index < prompts.length; index += 1) {
      // This prompt's own sandbox workspace, which its session store is keyed by.
      const sideWs = sandboxWorkspace(sandbox, join("side", label, String(index), "ws"))
      mkdirSync(sideWs, { recursive: true })
      // The seeded boulder ledger, when this side exists to move signal D and nothing else.
      if (side.seed?.boulderStatus !== undefined) seedFile(sideWs, join(".mpd", "boulder.json"), boulderStateJson(side.seed.boulderStatus))
      // The seeded project config, when this side selects its `team.gate` mode that way.
      if (side.seed?.mpdJsonc !== undefined) seedFile(sideWs, join(".mpd", "mpd.jsonc"), side.seed.mpdJsonc)
      // The launcher spec for this boot, or `null` when no `dsh` launcher resolves.
      const spec = dshCommand(["--profile", "mpd-headless", prompts[index]], env)
      // The boot's result, or a synthetic miss when nothing could be spawned.
      const live = spec === null ? { status: null, stdout: "", stderr: DSH_MISSING } : spawnSync(spec.command, spec.args, { env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 600000, cwd: sideWs, stdio: ["ignore", "pipe", "pipe"] })
      // `spawnSync` answers `.stdout`/`.stderr` — NOT `.out` (measured 2026-09-27: reading a
      // non-existent `.out` made `gateInstalled` false on EVERY side while the evidence log
      // carried the line, i.e. the instrumentation itself lied).
      const sideOut = (live.stdout || "") + (live.stderr || "")
      LOG.push("[" + label + " " + index + "] $ dsh --profile mpd-headless " + JSON.stringify(prompts[index]) + "\n[[exit=" + live.status + "]]\n" + sideOut.slice(0, 20000))
      // What the harness recorded for this side's own workspace.
      const recorded = recordedUserTexts(sandbox, sideWs)
      // The notice counts the side's verdict is computed from.
      const notice = classifyNotices(recorded.texts)
      // What this side's workspace holds under the REAL `.mpd/team` layout.
      const teams = teamStageScan(sideWs)
      // The explicit marker must have been CONSUMED: the recorded goal must no longer open with it.
      const goal = recorded.texts.find((text) => !text.includes(NOTICE_MARKER) && !text.startsWith("<")) ?? ""
      // Whether the marker was consumed, or `undefined` on the non-explicit sides.
      const markerConsumed = side.explicit !== true ? undefined : !/(^|\s)!team|^team:/iu.test(goal.trim())
      // The side's workspace-isolation verdict.
      const isolation = ((): IsolationVerdict => {
        // The sandbox ROOT is the bound, not the side's own workspace: every side shares this
        // DSH_HOME, so the store legitimately holds one key per side and passing the side key as
        // the bound would flag its SIBLINGS as escapees (measured 2026-09-27: `isolation:false`
        // on 3 of 6 sides for exactly that reason). What isolation means here is "no key belongs
        // to the real checkout / the process cwd / the real home".
        // The assertion's verdict already carries `ok: true` (it is the only arm that returns), so the
        // spread supplies it: spelling it out before the spread would be overwritten — reported as a
        // duplicate key — while the object produced at runtime is unchanged, key order included.
        try { return { ...assertSessionsSandboxed(sandbox, sandbox, { label: "session-start-team-" + label + "-" + index }) } } catch (error) { return { ok: false, error: errorDetail(error) } }
      })()
      // Registration instrumentation: the side's OWN store key must exist, which proves this
      // boot really wrote into the sandbox rather than reusing a neighbour's run.
      const ownKeyWritten = ((): boolean => {
        try { return readdirSync(join(sandbox, "sessions")).includes(projectKey(sideWs)) } catch { return false }
      })()
      // The row's OWN log for this side: R5 sends the boot signature and every FIRING line there, and
      // reading the child's stdout instead is the instrumentation defect this arm measured.
      const rowLog = rowLogText(sideWs)
      LOG.push("[" + label + " " + index + "] row log (.mpd/logs/mpd-roles.log)\n" + rowLog.slice(0, 20000))
      // The row's team-plane boot line, QUOTED into the evidence so a mode mismatch is diagnosable
      // (the reported mode is an INSTALL-time snapshot; the live mode is re-resolved per fire). The
      // ROW LOG is the primary source; the child's own output stays a fallback for a surface that
      // prints, so this arm cannot go blind again if the sink changes back.
      const bootLine = (/\[mpd-roles\] team plane:[^\n]*/.exec(rowLog)?.[0] ?? /\[mpd-roles\] team plane:[^\n]*/.exec(sideOut)?.[0] ?? "")
      // The FIRING line the row wrote for THIS side, or `""` when the predicate never fired. It is the
      // ROW's own record of the mode, the signals, the staged flag and the plan id — independent of the
      // notice text the model reads.
      const firedLine = (/\[mpd-roles\] session gate fired[^\n]*/.exec(rowLog) ?? [""])[0]
      // …and whether it reports the mode this side declares. Without this the case cannot tell
      // "the gate was never mounted" from "the gate is mounted and did not fire", which are
      // different defects with different owners (measured 2026-09-27: `sessionGate=advisory`
      // was present while ZERO notices fired, and the single opaque failure hid that split).
      const gateInstalled = bootLine.includes("sessionGate=" + side.expectedMode)
      // The pure side verdict, computed from the measurements above.
      const verdict = evaluateSide({ expect: side.expect, notice, teams, markerConsumed, expectedSignal: side.signal })
      // The side's violations: the pure verdict's, plus this boot's own instrumentation failures.
      const problems = [...verdict.problems]
      if (!recorded.ok) problems.push("session log unreadable: " + recorded.error)
      if (!isolation.ok) problems.push("workspace isolation violated: " + isolation.error)
      if (!ownKeyWritten) problems.push("this side's own session-store key was not written — the boot did not run in its sandbox workspace")
      if (!gateInstalled) problems.push("the row did not report `sessionGate=" + side.expectedMode + "` — the gate was NOT mounted for this mode on this boot (a different defect from a mounted-but-silent gate); boot line: " + JSON.stringify(bootLine.slice(0, 240)))
      // The ROW's own fire line, judged per expectation: a mechanical side must report `staged=1` AND
      // the SAME plan id the injected notice names — a three-source agreement (row log + notice + the
      // staged slot) that no single text can fake; an advisory fire must report `staged=0`; a side that
      // must not fire at all must have written no fire line.
      if (side.expect === "stage") {
        if (!firedLine.includes("staged=1")) problems.push("the row's own fire line must report staged=1, got " + JSON.stringify(firedLine.slice(0, 200)))
        // The plan id the ROW recorded for this fire, or `""` when its line named none.
        const firedPlanId = /plan=(plan-\d{14})/.exec(firedLine)?.[1] ?? ""
        if (firedPlanId === "" || firedPlanId !== notice.planIds[0]) {
          problems.push("the row log names " + JSON.stringify(firedPlanId === "" ? "(no plan)" : firedPlanId) + " while the injected notice names " + JSON.stringify(notice.planIds[0] ?? "(no plan)") + " — the row log and the notice must agree")
        }
      } else if (side.expect === "advisory") {
        if (!firedLine.includes("staged=0")) problems.push("an ADVISORY fire must report staged=0 (it stages NOTHING), got " + JSON.stringify(firedLine.slice(0, 200)))
      } else if (firedLine !== "") {
        problems.push("a side that must NOT fire recorded a fire line: " + JSON.stringify(firedLine.slice(0, 200)))
      }
      // A side built to prove ONE signal must see it in the ROW's own record too, not only in the notice.
      if (side.signal !== undefined && !firedLine.includes("signals=" + side.signal)) {
        problems.push("the row's fire line must name signals=" + side.signal + ", got " + JSON.stringify(firedLine.slice(0, 200)))
      }
      try {
        // The prompt's own evidence subdirectory, written best-effort.
        const keep = join(outDir, "sides", label, String(index))
        mkdirSync(keep, { recursive: true })
        writeFileSync(join(keep, "prompt.txt"), prompts[index])
        // The ROW's own log is copied verbatim: it is the primary evidence (boot signature + fire).
        writeFileSync(join(keep, "row-log.txt"), rowLog)
        writeFileSync(join(keep, "notices.json"), JSON.stringify({ notice, teams, goal: goal.slice(0, 400), bootLine: bootLine.slice(0, 400), firedLine: firedLine.slice(0, 400), gateInstalled, ownKeyWritten, problems }, null, 2))
      } catch { /* evidence copy is best-effort; the assertions are the gate */ }
      results.push({
        prompt: prompts[index], expect: side.expect, expectedMode: side.expectedMode, exited: live.status,
        notices: notice.any, advisory: notice.advisory, mechanical: notice.mechanical,
        officialTools: notice.officialTools, mechanicalTool: notice.mechanicalTool,
        retiredVocabulary: notice.retiredVocabulary, retiredProvisioned: notice.retiredProvisioned,
        signals: notice.signals, planIds: notice.planIds, markerConsumed,
        stagedPlans: teams.staged, stagedPlanIds: teams.planIds, stagedMembers: teams.stagedMembers, stagedTasks: teams.stagedTasks,
        teamRecords: teams.records, teamRecordIds: teams.recordIds,
        sessionRecords: recorded.records, sessionFrames: recorded.frames,
        isolation: isolation.ok, ownKeyWritten, gateInstalled, bootLine: bootLine.slice(0, 240), firedLine: firedLine.slice(0, 240), problems, ok: problems.length === 0,
      })
    }
    return results
  }

  // The four sides the retired case already had: the negative control, the soft-complex trigger, and
  // the explicit request (whose marker must be consumed) — all mechanical now, since the FAIL-SAFE
  // default is what a workspace with no `mpd.jsonc` gets.
  steps.simpleSide = runSide("simple", SIMPLE_PROMPTS, { expect: "none", expectedMode: GATE_MODE_MECHANICAL })
  steps.softComplexSide = runSide("soft-complex", SOFT_COMPLEX_PROMPTS, { expect: "stage", expectedMode: GATE_MODE_MECHANICAL })
  steps.explicitSide = runSide("explicit", EXPLICIT_PROMPTS, { expect: "stage", expectedMode: GATE_MODE_MECHANICAL, explicit: true })
  // (P7) Signal D over a REAL workspace: the SAME prompt and the SAME ledger bytes, moved by ONE
  // status field — the pair is what proves D reads ACTIVE work rather than "a plan file exists".
  // MEASURED 2026-10-06 (live): the ACTIVE arm is RED, because the config layer answers
  // `boulder.dir = ".mpd"` (mpd-config's SettingsSchema default) and `readBoulderGate` joins
  // `.mpd/boulder.json` onto that root, so the read lands on `<ws>/.mpd/.mpd/boulder.json` while the
  // contract places the ledger at `<ws>/.mpd/boulder.json` (AGENTS.md §1). Four boots pin it: the
  // contract path stays silent, the DOUBLED path fires `signals=D mode=mechanical staged=1`, an
  // `.mpd/mpd.jsonc` `boulder.dir` override does NOT change it (the row-knob layer outranks the
  // project file), and `mpd_config_get boulder.dir` answers `.mpd`. The pair below therefore reads:
  // ACTIVE -> silent (a true RED for the contract) and COMPLETED -> silent (green, but today for the
  // SAME wrong reason, since neither arm's file is reached). The red arm is the finding; do not
  // "fix" it by seeding the doubled path.
  steps.boulderActiveSide = runSide("boulder-active", [BOULDER_PROBE_PROMPT], { expect: "stage", expectedMode: GATE_MODE_MECHANICAL, signal: "D", seed: { boulderStatus: ACTIVE_STATUS } })
  steps.boulderCompletedSide = runSide("boulder-completed", [BOULDER_PROBE_PROMPT], { expect: "none", expectedMode: GATE_MODE_MECHANICAL, seed: { boulderStatus: COMPLETED_STATUS } })
  // The two non-default modes, selected the way a USER selects them: a project `.mpd/mpd.jsonc`.
  steps.advisorySide = runSide("advisory-mode", [SOFT_COMPLEX_PROMPTS[0]], { expect: "advisory", expectedMode: GATE_MODE_ADVISORY, seed: { mpdJsonc: GATE_MODE_JSONC_ADVISORY } })
  steps.offSide = runSide("off-mode", [SOFT_COMPLEX_PROMPTS[0]], { expect: "off", expectedMode: GATE_MODE_OFF, seed: { mpdJsonc: GATE_MODE_JSONC_OFF } })

  // The folded verdict: EVERY side's `ok` must hold, which is what the run's exit code reports.
  const sides: LiveStep[] = [
    ...steps.simpleSide, ...steps.softComplexSide, ...steps.explicitSide,
    ...steps.boulderActiveSide, ...steps.boulderCompletedSide,
    ...steps.advisorySide, ...steps.offSide,
  ]
  steps.verdicts = {
    ok: sides.every((r) => r.ok),
    sides: sides.length,
    failed: sides.filter((r) => !r.ok).map((r) => r.prompt),
    simpleNotices: steps.simpleSide.map((r) => r.notices),
    softNotices: steps.softComplexSide.map((r) => r.notices),
    softPlanIds: steps.softComplexSide.map((r) => r.planIds),
    explicitMarkerConsumed: steps.explicitSide.map((r) => r.markerConsumed),
    boulderActive: steps.boulderActiveSide.map((r) => ({ notices: r.notices, signals: r.signals, stagedPlans: r.stagedPlans, teamRecords: r.teamRecords, planIds: r.planIds })),
    boulderCompleted: steps.boulderCompletedSide.map((r) => ({ notices: r.notices, stagedPlans: r.stagedPlans, teamRecords: r.teamRecords })),
    advisory: steps.advisorySide.map((r) => ({ notices: r.notices, advisory: r.advisory, stagedPlans: r.stagedPlans, teamRecords: r.teamRecords })),
    off: steps.offSide.map((r) => ({ notices: r.notices, stagedPlans: r.stagedPlans, teamRecords: r.teamRecords, modeLine: r.bootLine })),
  }

  // The run's single verdict: every ledger entry that carries an `ok` must have held.
  const allOk = Object.values(steps).every((s) => (typeof s === "object" && "ok" in s) ? s.ok : true)
  writeFileSync(join(outDir, "result.json"), JSON.stringify({ ok: allOk, sandbox, steps, totalSteps: Object.keys(steps).length }, null, 2))
  writeFileSync(join(outDir, "output.log"), LOG.join("\n\n---\n\n"))
  try { rmSync(sandbox, { recursive: true, force: true }) } catch { /* best-effort scratch cleanup */ }
  console.log("[session-start-team] ok=" + allOk + " -> " + outDir)
  for (const [k, v] of Object.entries(steps)) console.log("  " + k + ": " + JSON.stringify(v).slice(0, 400))
  if (!allOk) process.exit(1)
  console.log("[session-start-team] PASS")
}

// Guarded on being the ENTRY module: an evidence replay may import `contractProblems` /
// `evaluateSide` without triggering this case's own run.
// The argv the case dispatches on: `--self-test` runs the offline arm, anything else the live one.
const argv = process.argv.slice(2)
// Whether this module is the process entry point, which alone may run the case.
const isEntry = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]
if (isEntry) {
  if (argv.includes("--self-test")) await selfTest()
  else await runReal()
}
