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
//    sanctioned reader (`lib/session-evidence.mjs`), never from the model's prose
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
import { credentialEnv, seedSandboxCredentials } from "./lib/credentials.mjs"
import { readSessionEvents } from "./lib/session-evidence.mjs"
import { assertSessionsSandboxed, sandboxWorkspace } from "./lib/workspace-isolation.mjs"
import { DSH_MISSING, dshCommand } from "./lib/dsh-launcher.mjs"
import { readMpdPresetSource } from "./lib/preset-source.mjs"

const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
const NOTICE_MARKER = "[AgentTeams] Session-start team rule"
/** The advisory sentence the gate must state (clause 4: it stages nothing). */
const ADVISORY_PHRASE = "NO team was staged"
/** The retired PROVISIONING sentence: it must not come back through this gate. */
const RETIRED_PROVISIONED_PHRASE = "is staged in this workspace"
/** The OFFICIAL staging vocabulary the notice must name. */
const OFFICIAL_TOOLS = ["spawn_teammate", "team_task_create"]
/** The retired tool vocabulary the notice must NOT name. */
const RETIRED_TOOL_PATTERN = /agent_teams_/
const GATE_SOURCE = join(repoRoot, "packages", "mpd-roles-plugin", "src", "session-gate.ts")
const ROLES_DIST = join(repoRoot, "packages", "mpd-roles-plugin", "dist", "index.js")
const REBUILD_COMMAND = "bun build packages/mpd-roles-plugin/src/index.ts --target node --format esm --outfile packages/mpd-roles-plugin/dist/index.js"
const SETTLE_MS = 50000
const LOG = []

// ── the frozen prompt sets (ONE source of truth: the live sides boot these verbatim) ──
export const SIMPLE_PROMPTS = [
  "Reply with exactly: hello-ok",
  "What does the git-master skill do? Answer in one sentence.",
  "Rename the variable `foo` to `bar` in src/util.ts and run its test.",
]
export const SOFT_COMPLEX_PROMPTS = [
  "Align the bundle with upstream: audit the orchestration surface, then implement the routing change.",
  "1. Read the patch file\n2. Audit the gates\n3. Implement the change\n4. Verify the boot",
]
export const EXPLICIT_PROMPTS = [
  "team: fix the flaky test",
]

function fail(msg) { console.error("[session-start-team] FAIL: " + msg); process.exit(1) }

/** The shipped gate module. A load failure is fatal: never silently skip the subject. */
async function loadGate() {
  if (!existsSync(GATE_SOURCE)) fail("the gate source is missing: " + GATE_SOURCE)
  try {
    return await import(pathToFileURL(GATE_SOURCE).href)
  } catch (error) {
    fail("cannot import the shipped gate source " + GATE_SOURCE + ": " + String(error?.message ?? error)
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
 * @returns {Promise<string[]>} contract violations (empty = the implementation conforms)
 */
export async function contractProblems(gate) {
  const problems = []
  const at = (label) => label + ": "

  if (gate.STARTUP_NOTICE_MARKER !== NOTICE_MARKER) {
    problems.push(at("marker") + "the notice marker must be " + JSON.stringify(NOTICE_MARKER) + ", got " + JSON.stringify(gate.STARTUP_NOTICE_MARKER))
  }

  // Direction 1: a SIMPLE prompt must NOT trigger and must match NO signal.
  for (const prompt of SIMPLE_PROMPTS) {
    const verdict = gate.evaluateComplexityGate(prompt)
    if (verdict.trigger !== false || verdict.signals.length !== 0) {
      problems.push(at("simple") + JSON.stringify(prompt.slice(0, 44)) + " must stay untriggered with no signal, got " + JSON.stringify(verdict))
    }
  }

  // Direction 2: a SOFT-complex prompt must trigger and name at least one signal.
  for (const prompt of SOFT_COMPLEX_PROMPTS) {
    const verdict = gate.evaluateComplexityGate(prompt)
    if (verdict.trigger !== true || verdict.signals.length === 0) {
      problems.push(at("soft-complex") + JSON.stringify(prompt.slice(0, 44)) + " must trigger with a named signal, got " + JSON.stringify(verdict))
    }
  }

  // Direction 3: the EXPLICIT flag is CONSUMED and counts as signal A.
  for (const prompt of EXPLICIT_PROMPTS) {
    const consumed = gate.consumeExplicitFlag(prompt)
    if (consumed.flagged !== true) problems.push(at("explicit") + "the explicit marker must be detected in " + JSON.stringify(prompt))
    if (/(^|\s)!team|^team:/iu.test(consumed.text.trim())) problems.push(at("explicit") + "the marker must be CONSUMED from the goal text, got " + JSON.stringify(consumed.text))
    const verdict = gate.evaluateComplexityGate(consumed.text, { explicitFlag: consumed.flagged })
    if (verdict.trigger !== true || !verdict.signals.includes("A")) {
      problems.push(at("explicit") + "an explicit request must trigger with signal A, got " + JSON.stringify(verdict))
    }
  }

  // Signal D: a `.mpd/plans/*.md` artifact for the workspace.
  const withPlan = gate.evaluateComplexityGate("hello", { planArtifact: true })
  if (!withPlan.signals.includes("D")) problems.push(at("signal D") + "a plan artifact must contribute signal D, got " + JSON.stringify(withPlan))

  // The notice: marker + advisory + official tools, and NONE of the retired vocabulary.
  const notices = [
    ["advisory", gate.advisoryNoticeText(["C"], false)],
    ["explicit-advisory", gate.advisoryNoticeText(["A"], true)],
  ]
  for (const [label, text] of notices) {
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

async function selfTest() {
  const gate = await loadGate()
  const problems = await contractProblems(gate)
  if (problems.length > 0) {
    for (const problem of problems) console.error("  - " + problem)
    fail("the shipped gate violates its frozen contract (" + problems.length + " problem(s))")
  }

  // ── NEGATIVE CONTROLS: the SAME contract must REDDEN for a broken implementation ──
  // Both directions are covered, so neither "always fires" nor "never fires" can pass.
  const alwaysTrigger = {
    ...gate,
    evaluateComplexityGate: () => ({ trigger: true, signals: ["C"] }),
  }
  const alwaysSilent = {
    ...gate,
    evaluateComplexityGate: () => ({ trigger: false, signals: [] }),
    advisoryNoticeText: () => "nothing to see here",
  }
  const triggerProblems = await contractProblems(alwaysTrigger)
  if (triggerProblems.length === 0) fail("negative control: a gate that triggers on EVERYTHING passed the contract")
  const silentProblems = await contractProblems(alwaysSilent)
  if (silentProblems.length === 0) fail("negative control: a gate that triggers on NOTHING passed the contract")

  // ── the wiring the live boot depends on ──
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

/** The user-role messages the HARNESS recorded for one workspace (sanctioned reader). */
function recordedUserTexts(home, ws) {
  try {
    const store = readSessionEvents(home, { workspace: ws })
    const texts = []
    for (const record of store.records) {
      if (record?.type !== "user/message") continue
      const content = Array.isArray(record?.data?.content) ? record.data.content : []
      const text = content.filter((block) => block?.type === "text").map((block) => String(block.text ?? "")).join("\n")
      if (text.length > 0) texts.push(text)
    }
    return { ok: true, texts, records: store.records.length, frames: store.frames, file: store.file }
  } catch (error) {
    return { ok: false, texts: [], records: 0, frames: 0, file: null, error: String(error?.message ?? error) }
  }
}

/** The notices the session log carries: marker, advisory, and the fired signals. */
function classifyNotices(texts) {
  const marked = texts.filter((text) => text.includes(NOTICE_MARKER))
  const advisory = marked.filter((text) => text.includes(ADVISORY_PHRASE))
  const retiredProvisioned = marked.filter((text) => text.includes(RETIRED_PROVISIONED_PHRASE))
  const officialTools = marked.filter((text) => OFFICIAL_TOOLS.every((tool) => text.includes(tool)))
  const retiredVocabulary = marked.filter((text) => RETIRED_TOOL_PATTERN.test(text))
  const signals = advisory.map((text) => /complexity signals ([A-D](?:\/[A-D])*)/.exec(text)?.[1]).filter((value) => value !== undefined)
  return { any: marked.length, advisory: advisory.length, retiredProvisioned: retiredProvisioned.length, officialTools: officialTools.length, retiredVocabulary: retiredVocabulary.length, signals }
}

/** Every team record in a workspace (the retired `.mpd/team` root: any of them is a stage). */
function teamRecords(ws) {
  const root = join(ws, ".mpd", "team")
  if (!existsSync(root)) return { active: 0, archived: 0, ids: [] }
  const ids = readdirSync(root).filter((name) => name !== "archive" && existsSync(join(root, name, "team.json")))
  const archiveRoot = join(root, "archive")
  const archived = existsSync(archiveRoot) ? readdirSync(archiveRoot).filter((name) => existsSync(join(archiveRoot, name, "team.json"))) : []
  return { active: ids.length, archived: archived.length, ids: [...ids, ...archived] }
}

function sha256(path) {
  const r = spawnSync("sha256sum", [path], { encoding: "utf8" })
  return (r.stdout || "").trim().split(/\s+/)[0]
}

/** The verdict of ONE live side. Pure, so `--self-test` fixtures could drive it too. */
export function evaluateSide({ expect, notice, teams, markerConsumed }) {
  const problems = []
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

async function runReal() {
  const creds = join(homedir(), ".dsh", ".credentials.yaml")
  if (!existsSync(creds)) fail("missing credentials at " + creds)
  const ts = new Date().toISOString().replaceAll(":", "-")
  const outDir = process.env.MPD_QA_EVIDENCE_DIR
    ? join(process.env.MPD_QA_EVIDENCE_DIR, "session-start-team-" + ts)
    : join(repoRoot, "evidence", "dsh-qa", "session-start-team", ts)
  mkdirSync(outDir, { recursive: true })

  // The live lane boots an INSTALLED profile: the row that runs is the built dist, so a
  // dist that does not carry the gate would make this whole lane prove NOTHING while
  // looking green-free. Assert the artifact really carries the contract, and name the
  // rebuild command instead of reporting a mysterious "no notice".
  const distText = readFileSync(ROLES_DIST, "utf8")
  const distCarriesGate = ["installSessionGate", "STARTUP_NOTICE_MARKER", ADVISORY_PHRASE, "spawn_teammate"].every((needle) => distText.includes(needle))
  if (!distCarriesGate) {
    fail("the built row " + ROLES_DIST + " does not carry the session-start gate, so a boot would prove nothing — rebuild it: " + REBUILD_COMMAND)
  }

  const rev0 = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).stdout.trim()
  const gateHash0 = sha256(GATE_SOURCE)
  LOG.push("settleWait: " + SETTLE_MS + " ms (revision " + rev0 + ", session-gate.ts " + gateHash0.slice(0, 16) + ")")
  await new Promise((resolve) => setTimeout(resolve, SETTLE_MS))
  const rev1 = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).stdout.trim()
  const gateHash1 = sha256(GATE_SOURCE)
  const settled = rev0 === rev1 && gateHash0 === gateHash1
  const steps = { settled: { ok: settled, rev: rev1, gateHash: gateHash1 } }
  if (!settled) fail("revision did not settle (HEAD or session-gate.ts changed during the window)")

  const sandbox = mkdtempSync(join(tmpdir(), "mpd-sst-"))
  const sandboxHome = join(sandbox, "home")
  mkdirSync(sandboxHome, { recursive: true })
  seedSandboxCredentials(sandbox, { credentialsFile: creds })
  const settings = join(homedir(), ".dsh", "settings.yaml")
  if (existsSync(settings)) writeFileSync(join(sandbox, "settings.yaml"), readFileSync(settings))
  // AGENTS.md §7: HOME is sandboxed too, and the workspace is passed explicitly on every
  // spawn (env alone cannot isolate it).
  const env = credentialEnv({ ...process.env, DSH_HOME: sandbox, HOME: sandboxHome })
  if (env.DSH_HOME !== sandbox || env.HOME !== sandboxHome) fail("isolation assertion failed")

  function runSync(cmd, args, opts = {}) {
    const spec = cmd === "dsh" ? dshCommand(args, env) : { command: cmd, args }
    const r = spec === null ? { status: null, stdout: "", stderr: DSH_MISSING } : spawnSync(spec.command, spec.args, { env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: opts.timeout ?? 900000, cwd: opts.cwd ?? repoRoot, stdio: ["ignore", "pipe", "pipe"] })
    const out = (r.stdout || "") + (r.stderr || "")
    LOG.push("$ " + cmd + " " + args.join(" ") + "\n[[exit=" + r.status + "]]\n" + out.slice(0, 20000))
    return { status: r.status, out, stdout: r.stdout || "" }
  }

  const inst = runSync(process.execPath, [join(repoRoot, "scripts", "install-profile.mjs"), "--yes", "--dsh-home", sandbox, "--profile", "mpd-headless", "--skip-toolchain"], { timeout: 600000 })
  steps.installer = { ok: inst.status === 0, exit: inst.status }
  const homePatch = readFileSync(join(sandbox, "cordis.patch.yml"), "utf8")
  steps.patchRow = {
    ok: /id:\s*mpd-roles/.test(homePatch) && !/id:\s*agent-teams\s*$/m.test(homePatch) && !homePatch.includes("sessionTeamPolicy"),
    mountsRoles: /id:\s*mpd-roles/.test(homePatch),
    retiredAgentTeamsRow: /id:\s*agent-teams\s*$/m.test(homePatch),
  }
  assertSessionsSandboxed(sandbox, sandbox, { label: "session-start-team-main" })

  /** One boot per prompt, in its own sandbox workspace (never the checkout). */
  function runSide(label, prompts, expect) {
    const results = []
    for (let index = 0; index < prompts.length; index += 1) {
      const sideWs = sandboxWorkspace(sandbox, join("side", label, String(index), "ws"))
      mkdirSync(sideWs, { recursive: true })
      const spec = dshCommand(["--profile", "mpd-headless", prompts[index]], env)
      const live = spec === null ? { status: null, stdout: "", stderr: DSH_MISSING } : spawnSync(spec.command, spec.args, { env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 600000, cwd: sideWs, stdio: ["ignore", "pipe", "pipe"] })
      LOG.push("[" + label + " " + index + "] $ dsh --profile mpd-headless " + JSON.stringify(prompts[index]) + "\n[[exit=" + live.status + "]]\n" + ((live.stdout || "") + (live.stderr || "")).slice(0, 20000))
      const recorded = recordedUserTexts(sandbox, sideWs)
      const notice = classifyNotices(recorded.texts)
      const teams = teamRecords(sideWs)
      // The explicit marker must have been CONSUMED: the recorded goal must no longer open with it.
      const goal = recorded.texts.find((text) => !text.includes(NOTICE_MARKER) && !text.startsWith("<")) ?? ""
      const markerConsumed = expect !== "explicit" ? undefined : !/(^|\s)!team|^team:/iu.test(goal.trim())
      const isolation = (() => {
        try { return { ok: true, ...assertSessionsSandboxed(sandbox, sideWs, { label: "session-start-team-" + label + "-" + index }) } } catch (error) { return { ok: false, error: String(error?.message ?? error) } }
      })()
      const verdict = evaluateSide({ expect, notice, teams, markerConsumed })
      const problems = [...verdict.problems]
      if (!recorded.ok) problems.push("session log unreadable: " + recorded.error)
      if (!isolation.ok) problems.push("workspace isolation violated: " + isolation.error)
      try {
        const keep = join(outDir, "sides", label, String(index))
        mkdirSync(keep, { recursive: true })
        writeFileSync(join(keep, "prompt.txt"), prompts[index])
        writeFileSync(join(keep, "notices.json"), JSON.stringify({ notice, teams, goal: goal.slice(0, 400), problems }, null, 2))
      } catch { /* evidence copy is best-effort; the assertions are the gate */ }
      results.push({
        prompt: prompts[index], expect, exited: live.status,
        notices: notice.any, advisory: notice.advisory, officialTools: notice.officialTools,
        retiredVocabulary: notice.retiredVocabulary, retiredProvisioned: notice.retiredProvisioned,
        signals: notice.signals, teams: teams.active + teams.archived, markerConsumed,
        sessionRecords: recorded.records, sessionFrames: recorded.frames,
        isolation: isolation.ok, problems, ok: problems.length === 0,
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
const argv = process.argv.slice(2)
const isEntry = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]
if (isEntry) {
  if (argv.includes("--self-test")) await selfTest()
  else await runReal()
}
