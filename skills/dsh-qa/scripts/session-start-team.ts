#!/usr/bin/env node
// Case session-start-team (the session-start TEAM GATE), rebased onto the OFFICIAL-era
// implementation in `packages/mpd-roles-plugin/src/session-gate.ts`.
//
// WHAT MOVED (2026-09-27, D5): the vendored agent-teams body that used to own this gate is
// RETIRED from the composition (AGENTS.md §1) — its mount is gone, so nothing in a shipped
// session reached `lib/session-start.js` any more. The BINDING CONTRACT survived the
// retirement and is still stated in AGENTS.md §1: the marker
// `[AgentTeams] Session-start team rule` and the frozen predicate
// `trigger = explicit flag OR (matchedSignals >= 1)`. Its new home is
// `packages/mpd-roles-plugin/src/session-gate.ts`, reached only through the adapter.
//
// THE CONTRACT THIS CASE ASSERTS (lane F's implementation is read as the source of truth):
//   * the gate ADVISES and stages NOTHING — including for an explicit `team:` / `!team`
//     request, which is only a stronger reason to advise. The retired `provision` route is
//     GONE with the plugin that owned it, so this case can no longer assert a staged team;
//     dropping that arm is the retirement's cost, and it is NAMED here on purpose;
//   * ONE notice carrying the frozen marker, naming the fired signals, stating that NO team
//     was staged, and naming the OFFICIAL staging tools (`spawn_teammate`,
//     `team_task_create`) — never the retired `agent_teams_*` vocabulary;
//   * an untriggered (simple) session gets NO notice at all — the falsifiability arm;
//   * the explicit marker is CONSUMED from the goal text;
//   * scope: a top-level session of a configured preset only, never a child session.
//
// 1) `--self-test` (offline, no boot): imports the SHIPPED source module and drives the
//    frozen predicate over three frozen prompt sets, BOTH directions, plus TWO negative
//    controls that must redden (an always-trigger gate and an always-silent one) driven
//    through the SAME `contractProblems()` the real gate is judged by — so a green
//    self-test cannot be vacuous. It also asserts the wiring (the bundle mounts
//    `mpd-roles`, the retired row is gone, the preset carries the SESSION STARTUP RULE).
// 2) real run: isolated DSH_HOME + sandboxed HOME + sandbox workspace, one headless boot
//    per prompt side; the notices are read from the HARNESS session log through the
//    sanctioned reader (`lib/session-evidence.ts`), never from the model's prose
//    (AGENTS.md §7).
//
// NOTE ON `node` AND `.ts`: this case imports a TypeScript SOURCE module. Node >= 22.18
// strips types by default (measured: v24.19.0 imports it directly); the import is NOT
// wrapped in a skip, because a case that silently stops asserting its subject is worse
// than one that fails loudly.
//
// Never touches the real ~/.dsh (credentials/settings are COPIED into a sandbox).
// Evidence root: evidence/dsh-qa/session-start-team/<ts>, or MPD_QA_EVIDENCE_DIR when set.
import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
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
/** The advisory sentence the gate must state (clause 4: it stages nothing). */
const ADVISORY_PHRASE = "NO team was staged"
/** The retired PROVISIONING sentence: it must not come back through this gate. */
const RETIRED_PROVISIONED_PHRASE = "is staged in this workspace"
/** The OFFICIAL staging vocabulary the notice must name. */
const OFFICIAL_TOOLS: readonly string[] = ["spawn_teammate", "team_task_create"]
/** The retired tool vocabulary the notice must NOT name. */
const RETIRED_TOOL_PATTERN = /agent_teams_/
// The shipped gate SOURCE module, imported directly so the case reads the implementation.
const GATE_SOURCE: string = join(repoRoot, "packages", "mpd-roles-plugin", "src", "session-gate.ts")
// The BUILT row the live boot actually runs, asserted to carry the gate before any boot.
const ROLES_DIST: string = join(repoRoot, "packages", "mpd-roles-plugin", "dist", "index.js")
// The canonical rebuild command the failure banner names when the dist is stale.
const REBUILD_COMMAND: string = "bun build packages/mpd-roles-plugin/src/index.ts --target node --format esm --outfile packages/mpd-roles-plugin/dist/index.js"
/** How long the live arm waits for HEAD and the gate source to settle, in milliseconds. */
const SETTLE_MS: number = 50000
// The human-readable run log, written to the evidence directory at the end of the live arm.
const LOG: string[] = []

// ── the frozen prompt sets (ONE source of truth: the live sides boot these verbatim) ──
/** Simple prompts: the falsifiability arm — none of them may fire the gate. */
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
  /** Whether a `.mpd/plans/*.md` artifact exists for the session's workspace. */
  readonly planArtifact?: boolean
}

/** The shipped session-gate module's surface, as this case drives it. */
interface GateModule {
  /** The frozen notice marker the gate and this case must agree on. */
  readonly STARTUP_NOTICE_MARKER: string
  /** The presets whose top-level sessions the gate covers. */
  readonly DEFAULT_GATE_PRESETS: readonly string[]
  /** Evaluate the frozen predicate over one goal text. */
  readonly evaluateComplexityGate: (text: string, input?: GateInputs) => ComplexityVerdict
  /** Detect and CONSUME the explicit marker from one goal text. */
  readonly consumeExplicitFlag: (text: string) => ConsumedFlag
  /** The advisory notice text for one fired signal set. */
  readonly advisoryNoticeText: (signals: readonly string[], explicit: boolean) => string
  /** Whether one agent's session is covered by the gate at all. */
  readonly sessionQualifies: (agent: unknown, presets?: readonly string[]) => boolean
  /** Whether a `.mpd/plans/*.md` artifact exists for the workspace (never throws). */
  readonly hasPlanArtifact: (workspace: string) => Promise<boolean>
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

/** What the session log carried about the advisory notice, classified per assertion. */
interface NoticeClassification {
  /** How many recorded texts carried the frozen marker. */
  readonly any: number
  /** How many marked texts also state that no team was staged. */
  readonly advisory: number
  /** How many marked texts still carry the retired PROVISIONING sentence. */
  readonly retiredProvisioned: number
  /** How many marked texts name every official staging tool. */
  readonly officialTools: number
  /** How many marked texts still name the retired `agent_teams_*` vocabulary. */
  readonly retiredVocabulary: number
  /** The fired-signal runs the advisory notices named, in record order. */
  readonly signals: string[]
}

/** Every team record a workspace holds under the retired `.mpd/team` root. */
interface TeamRecordScan {
  /** How many ACTIVE team records the root holds. */
  readonly active: number
  /** How many archived team records the root's `archive/` holds. */
  readonly archived: number
  /** Every record id seen (active first, then archived). */
  readonly ids: string[]
}

/** Which live side a prompt set belongs to, which decides the expected notice count. */
type SideExpectation = "none" | "advise" | "explicit"

/** The measurements ONE live side hands to the pure verdict function. */
interface LiveSideInput {
  /** Which side this is: `none` (untriggered), `advise` (soft-complex) or `explicit`. */
  readonly expect: SideExpectation
  /** What the session log recorded about the advisory notice. */
  readonly notice: NoticeClassification
  /** Every team record the side's workspace holds (the retired `.mpd/team` root). */
  readonly teams: TeamRecordScan
  /** Whether the explicit marker was consumed; `undefined` on the two non-explicit sides. */
  readonly markerConsumed: boolean | undefined
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

/** The shipped gate module. A load failure is fatal: never silently skip the subject. */
async function loadGate(): Promise<GateModule> {
  if (!existsSync(GATE_SOURCE)) fail("the gate source is missing: " + GATE_SOURCE)
  try {
    // `import()` of a runtime-computed URL is untyped, so the module namespace is asserted to the
    // surface this case drives; the arm below reports a module that cannot be loaded at all.
    return (await import(pathToFileURL(GATE_SOURCE).href)) as GateModule
  } catch (error) {
    fail("cannot import the shipped gate source " + GATE_SOURCE + ": " + errorDetail(error)
      + " — this case needs a node that strips TypeScript types (>= 22.18; measured on v24.19.0). Do not skip this arm.")
  }
}

/**
 * The whole frozen contract, evaluated against ONE gate implementation.
 *
 * Parameterized on the gate object on purpose: `--self-test` drives the real module AND
 * two deliberately broken stubs through this SAME function, so "the contract holds" and
 * "the contract can fail" are proven by one code path rather than two claims.
 *
 * @param gate The gate module (or a stub) whose behaviour is judged.
 * @returns The contract violations; empty means the implementation conforms.
 */
export async function contractProblems(gate: GateModule): Promise<string[]> {
  // Every violation found, in the order the contract clauses are checked.
  const problems: string[] = []
  // Prefixes one violation with the clause it belongs to.
  const at = (label: string): string => label + ": "

  if (gate.STARTUP_NOTICE_MARKER !== NOTICE_MARKER) {
    problems.push(at("marker") + "the notice marker must be " + JSON.stringify(NOTICE_MARKER) + ", got " + JSON.stringify(gate.STARTUP_NOTICE_MARKER))
  }

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

  // Signal D: a `.mpd/plans/*.md` artifact for the workspace.
  const withPlan = gate.evaluateComplexityGate("hello", { planArtifact: true })
  if (!withPlan.signals.includes("D")) problems.push(at("signal D") + "a plan artifact must contribute signal D, got " + JSON.stringify(withPlan))

  // The notice: marker + advisory + official tools, and NONE of the retired vocabulary.
  const notices: Array<[string, string]> = [
    ["advisory", gate.advisoryNoticeText(["C"], false)],
    ["explicit-advisory", gate.advisoryNoticeText(["A"], true)],
  ]
  for (const [label, text] of notices) {
    // The notice's text as a string, which is what every clause below searches.
    const body = String(text ?? "")
    if (!body.includes(NOTICE_MARKER)) problems.push(at("notice/" + label) + "the frozen marker is missing")
    if (!body.includes(ADVISORY_PHRASE)) problems.push(at("notice/" + label) + "the notice must state " + JSON.stringify(ADVISORY_PHRASE))
    for (const tool of OFFICIAL_TOOLS) if (!body.includes(tool)) problems.push(at("notice/" + label) + "the notice must name the official tool `" + tool + "`")
    if (RETIRED_TOOL_PATTERN.test(body)) problems.push(at("notice/" + label) + "the notice must not name the RETIRED agent_teams_* vocabulary")
    if (body.includes(RETIRED_PROVISIONED_PHRASE)) problems.push(at("notice/" + label) + "the retired PROVISIONING sentence must be gone (the gate stages nothing)")
  }

  // Scope: configured presets, top-level sessions only.
  if (!Array.isArray(gate.DEFAULT_GATE_PRESETS) || !gate.DEFAULT_GATE_PRESETS.includes("mpd")) {
    problems.push(at("scope") + "the default gate presets must include `mpd`, got " + JSON.stringify(gate.DEFAULT_GATE_PRESETS))
  }
  if (gate.sessionQualifies({ session: { header: { parentSession: "parent-1", agentPreset: "mpd" } } }) !== false) {
    problems.push(at("scope") + "a CHILD session must never get a gate of its own")
  }
  if (gate.sessionQualifies({ session: { header: { agentPreset: "standard" } } }) !== false) {
    problems.push(at("scope") + "another preset's session must not be gated")
  }

  // The plan-artifact probe really reads the workspace.
  const probe = mkdtempSync(join(tmpdir(), "mpd-gate-contract-"))
  try {
    if (await gate.hasPlanArtifact(probe) !== false) problems.push(at("signal D") + "an empty workspace must report no plan artifact")
    mkdirSync(join(probe, ".mpd", "plans"), { recursive: true })
    writeFileSync(join(probe, ".mpd", "plans", "p.md"), "# plan\n")
    if (await gate.hasPlanArtifact(probe) !== true) problems.push(at("signal D") + "a `.mpd/plans/*.md` artifact must be detected")
  } finally {
    rmSync(probe, { recursive: true, force: true })
  }
  return problems
}

/** The offline arm: the shipped contract plus both negative controls and the wiring pins. */
async function selfTest(): Promise<void> {
  // The shipped gate module, imported from its SOURCE so the case never asserts a built copy.
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
    evaluateComplexityGate: () => ({ trigger: true, signals: ["C"] }),
  }
  // A gate that fires on nothing, which must fail the triggered directions.
  const alwaysSilent = {
    ...gate,
    evaluateComplexityGate: () => ({ trigger: false, signals: [] }),
    advisoryNoticeText: () => "nothing to see here",
  }
  // The violations the always-triggering stub produced, proving the simple arm is falsifiable.
  const triggerProblems = await contractProblems(alwaysTrigger)
  if (triggerProblems.length === 0) fail("negative control: a gate that triggers on EVERYTHING passed the contract")
  // The violations the always-silent stub produced, proving the triggered arms are falsifiable.
  const silentProblems = await contractProblems(alwaysSilent)
  if (silentProblems.length === 0) fail("negative control: a gate that triggers on NOTHING passed the contract")

  // ── the wiring the live boot depends on ──
  // The bundle patch, which must mount the row that hosts the gate.
  const patch = readFileSync(join(repoRoot, "packages", "mpd-bundle", "cordis.patch.yml"), "utf8")
  if (!/id: mpd-roles\b/.test(patch)) fail("the bundle patch no longer mounts the `mpd-roles` row — the gate has no home")
  if (/^\s*name: '@deepseek-ai\/dsh-agent-presets'\s*$/m.test(patch)) fail("the retired @deepseek-ai/dsh-agent-presets row came back")
  if (/id:\s*agent-teams\s*$/m.test(patch)) fail("the RETIRED vendored `agent-teams` row came back into the bundle patch")
  if (patch.includes("sessionTeamPolicy")) fail("the retired `sessionTeamPolicy` row config came back into the bundle patch")
  // The preset carries the convention the gate serves, in the OFFICIAL vocabulary.
  const preset = readMpdPresetSource(repoRoot)
  if (preset === "") fail("no declared bundle patch declares the `preset-mpd` row — the preset audit has no subject")
  if (!preset.includes("SESSION STARTUP RULE")) fail("the mpd preset no longer states the SESSION STARTUP RULE")
  if (!preset.includes("spawn_teammate")) fail("the mpd preset must name the OFFICIAL staging tool `spawn_teammate`")
  if (/MUST start inside a team|MUST begin inside a team/.test(preset)) fail("the mpd preset still carries the retired mandatory-team invariant")

  console.log("[session-start-team self-test] ok: shipped gate source conforms to the frozen contract ("
    + SIMPLE_PROMPTS.length + " simple / " + SOFT_COMPLEX_PROMPTS.length + " soft-complex / " + EXPLICIT_PROMPTS.length + " explicit prompts, marker + advisory + official tools + scope)"
    + "; negative controls reddened both ways (always-trigger " + triggerProblems.length + ", always-silent " + silentProblems.length + " problem(s))"
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
 * The notices the session log carries: marker, advisory, and the fired signals.
 * @param texts Every user-role text the session log recorded.
 * @returns The counts each notice assertion reads, plus the fired signal runs.
 */
function classifyNotices(texts: readonly string[]): NoticeClassification {
  // Every recorded text that carries the frozen marker.
  const marked = texts.filter((text) => text.includes(NOTICE_MARKER))
  // The marked texts that also state that no team was staged.
  const advisory = marked.filter((text) => text.includes(ADVISORY_PHRASE))
  // The marked texts that still carry the retired PROVISIONING sentence.
  const retiredProvisioned = marked.filter((text) => text.includes(RETIRED_PROVISIONED_PHRASE))
  // The marked texts that name every official staging tool.
  const officialTools = marked.filter((text) => OFFICIAL_TOOLS.every((tool) => text.includes(tool)))
  // The marked texts that still name the retired `agent_teams_*` vocabulary.
  const retiredVocabulary = marked.filter((text) => RETIRED_TOOL_PATTERN.test(text))
  // The fired-signal runs the advisory notices named, in record order.
  const signals = advisory.map((text) => /complexity signals ([A-D](?:\/[A-D])*)/.exec(text)?.[1]).filter((value): value is string => value !== undefined)
  return { any: marked.length, advisory: advisory.length, retiredProvisioned: retiredProvisioned.length, officialTools: officialTools.length, retiredVocabulary: retiredVocabulary.length, signals }
}

/**
 * Every team record in a workspace (the retired `.mpd/team` root: any of them is a stage).
 * @param ws The side's sandbox workspace.
 * @returns The active and archived record counts plus every id seen.
 */
function teamRecords(ws: string): TeamRecordScan {
  // The retired `.mpd/team` root the product used to write.
  const root = join(ws, ".mpd", "team")
  if (!existsSync(root)) return { active: 0, archived: 0, ids: [] }
  // The active record ids, which the `archive/` subdirectory never contributes to.
  const ids = readdirSync(root).filter((name) => name !== "archive" && existsSync(join(root, name, "team.json")))
  // The archives subdirectory, absent until a team is archived.
  const archiveRoot = join(root, "archive")
  // The archived record ids, empty when the archive root does not exist.
  const archived = existsSync(archiveRoot) ? readdirSync(archiveRoot).filter((name) => existsSync(join(archiveRoot, name, "team.json"))) : []
  return { active: ids.length, archived: archived.length, ids: [...ids, ...archived] }
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
 * The verdict of ONE live side. Pure, so `--self-test` fixtures could drive it too.
 * @param input The side's expectation and the measurements the session log produced.
 * @returns Whether the side held, plus every violation it recorded.
 */
export function evaluateSide({ expect, notice, teams, markerConsumed }: LiveSideInput): SideVerdict {
  // Every violation this side recorded, in the order the clauses are checked.
  const problems: string[] = []
  if (expect === "none") {
    // THE FALSIFIABILITY ARM: a gate that fires on everything reddens HERE.
    if (notice.any !== 0) problems.push("a simple prompt must leave NO notice, got " + notice.any)
    if (teams.active + teams.archived !== 0) problems.push("a simple prompt must stage NO team")
    return { ok: problems.length === 0, problems }
  }
  // Both triggered sides are ADVISORY — the explicit one included (the retired provision route is gone).
  if (notice.any !== 1) problems.push("a triggered prompt must record EXACTLY ONE advisory notice, got " + notice.any)
  if (notice.advisory !== 1) problems.push("the notice must state " + JSON.stringify(ADVISORY_PHRASE) + ", got " + notice.advisory)
  if (notice.officialTools !== 1) problems.push("the notice must name BOTH official tools (" + OFFICIAL_TOOLS.join(", ") + "), got " + notice.officialTools)
  if (notice.retiredVocabulary !== 0) problems.push("the notice must not name the RETIRED agent_teams_* vocabulary")
  if (notice.retiredProvisioned !== 0) problems.push("the retired PROVISIONING notice must not come back (the gate stages nothing)")
  if (notice.signals.length === 0) problems.push("the advisory notice must name the fired complexity signals")
  // The gate itself must not have staged anything, on ANY side.
  if (teams.active + teams.archived !== 0) problems.push("the advisory gate must stage NO team (active+archived=" + (teams.active + teams.archived) + ")")
  if (expect === "explicit" && markerConsumed !== true) problems.push("the explicit `team:` marker must be CONSUMED from the recorded goal text")
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

  // The live lane boots an INSTALLED profile: the row that runs is the built dist, so a
  // dist that does not carry the gate would make this whole lane prove NOTHING while
  // looking green-free. Assert the artifact really carries the contract, and name the
  // rebuild command instead of reporting a mysterious "no notice".
  // The built row's bytes, which must already carry the gate this case asserts.
  const distText = readFileSync(ROLES_DIST, "utf8")
  // Whether the built row really carries the gate's install hook, marker and advisory text.
  const distCarriesGate = ["installSessionGate", "STARTUP_NOTICE_MARKER", ADVISORY_PHRASE, "spawn_teammate"].every((needle) => distText.includes(needle))
  if (!distCarriesGate) {
    fail("the built row " + ROLES_DIST + " does not carry the session-start gate, so a boot would prove nothing — rebuild it: " + REBUILD_COMMAND)
  }

  // The repository revision BEFORE the settle window.
  const rev0 = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).stdout.trim()
  // The gate source's fingerprint BEFORE the settle window.
  const gateHash0 = sha256(GATE_SOURCE)
  LOG.push("settleWait: " + SETTLE_MS + " ms (revision " + rev0 + ", session-gate.ts " + gateHash0.slice(0, 16) + ")")
  // The settle window: HEAD and the gate source must be identical on both sides of it.
  await new Promise<void>((resolve): void => { setTimeout(resolve, SETTLE_MS) })
  // The repository revision AFTER the settle window.
  const rev1 = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).stdout.trim()
  // The gate source's fingerprint AFTER the settle window.
  const gateHash1 = sha256(GATE_SOURCE)
  // Whether both the revision and the gate source were byte-identical across the window.
  const settled = rev0 === rev1 && gateHash0 === gateHash1
  // The run's verdict ledger, one entry per step this case asserts.
  const steps: Record<string, LiveStep | LiveStep[]> = { settled: { ok: settled, rev: rev1, gateHash: gateHash1 } }
  if (!settled) fail("revision did not settle (HEAD or session-gate.ts changed during the window)")

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
   * One boot per prompt, in its own sandbox workspace (never the checkout).
   * @param label The side's name, which also names its evidence subdirectory.
   * @param prompts The frozen prompts to boot, verbatim.
   * @param expect Which side this is, which decides the expected notice count.
   * @returns One verdict object per prompt, exactly the shape the evidence JSON records.
   */
  function runSide(label: string, prompts: readonly string[], expect: SideExpectation): LiveStep[] {
    // One verdict per prompt of this side, in prompt order.
    const results: LiveStep[] = []
    for (let index = 0; index < prompts.length; index += 1) {
      // This prompt's own sandbox workspace, which its session store is keyed by.
      const sideWs = sandboxWorkspace(sandbox, join("side", label, String(index), "ws"))
      mkdirSync(sideWs, { recursive: true })
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
      // Every team record this side's workspace holds (any of them is a stage).
      const teams = teamRecords(sideWs)
      // The explicit marker must have been CONSUMED: the recorded goal must no longer open with it.
      const goal = recorded.texts.find((text) => !text.includes(NOTICE_MARKER) && !text.startsWith("<")) ?? ""
      // Whether the marker was consumed, or `undefined` on the non-explicit sides.
      const markerConsumed = expect !== "explicit" ? undefined : !/(^|\s)!team|^team:/iu.test(goal.trim())
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
      // …and the row must REPORT the gate as installed. Without this the case cannot tell
      // "the gate was never mounted" from "the gate is mounted and did not fire", which are
      // different defects with different owners (measured 2026-09-27: `sessionGate=advisory`
      // was present while ZERO notices fired, and the single opaque failure hid that split).
      const gateInstalled = /\[mpd-roles\] team plane:.*sessionGate=advisory/.test(sideOut)
      // The pure side verdict, computed from the measurements above.
      const verdict = evaluateSide({ expect, notice, teams, markerConsumed })
      // The side's violations: the pure verdict's, plus this boot's own instrumentation failures.
      const problems = [...verdict.problems]
      if (!recorded.ok) problems.push("session log unreadable: " + recorded.error)
      if (!isolation.ok) problems.push("workspace isolation violated: " + isolation.error)
      if (!ownKeyWritten) problems.push("this side's own session-store key was not written — the boot did not run in its sandbox workspace")
      if (!gateInstalled) problems.push("the row did not report `sessionGate=advisory` — the gate was NOT mounted on this boot (a different defect from a mounted-but-silent gate)")
      try {
        // The prompt's own evidence subdirectory, written best-effort.
        const keep = join(outDir, "sides", label, String(index))
        mkdirSync(keep, { recursive: true })
        writeFileSync(join(keep, "prompt.txt"), prompts[index])
        writeFileSync(join(keep, "notices.json"), JSON.stringify({ notice, teams, goal: goal.slice(0, 400), gateInstalled, ownKeyWritten, problems }, null, 2))
      } catch { /* evidence copy is best-effort; the assertions are the gate */ }
      results.push({
        prompt: prompts[index], expect, exited: live.status,
        notices: notice.any, advisory: notice.advisory, officialTools: notice.officialTools,
        retiredVocabulary: notice.retiredVocabulary, retiredProvisioned: notice.retiredProvisioned,
        signals: notice.signals, teams: teams.active + teams.archived, markerConsumed,
        sessionRecords: recorded.records, sessionFrames: recorded.frames,
        isolation: isolation.ok, ownKeyWritten, gateInstalled, problems, ok: problems.length === 0,
      })
    }
    return results
  }

  steps.simpleSide = runSide("simple", SIMPLE_PROMPTS, "none")
  steps.softComplexSide = runSide("soft-complex", SOFT_COMPLEX_PROMPTS, "advise")
  steps.explicitSide = runSide("explicit", EXPLICIT_PROMPTS, "explicit")
  steps.threeWay = {
    // The SIMPLE side is the negative control: an always-firing gate reddens it.
    ok: steps.simpleSide.every((r) => r.ok) && steps.softComplexSide.every((r) => r.ok) && steps.explicitSide.every((r) => r.ok),
    simpleNotices: steps.simpleSide.map((r) => r.notices),
    softNotices: steps.softComplexSide.map((r) => r.advisory),
    softSignals: steps.softComplexSide.map((r) => r.signals),
    softStaged: steps.softComplexSide.map((r) => r.teams),
    explicitNotices: steps.explicitSide.map((r) => r.advisory),
    explicitStaged: steps.explicitSide.map((r) => r.teams),
    explicitMarkerConsumed: steps.explicitSide.map((r) => r.markerConsumed),
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
