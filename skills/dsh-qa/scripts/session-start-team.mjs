#!/usr/bin/env node
// Case session-start-team (the session-start TEAM GATE): prove all THREE directions of
// the frozen complexity gate on the SAME settled revision — a simple prompt must leave
// NO team and NO notice, a SOFT-complex prompt must leave NO PLUGIN-PROVISIONED team and
// exactly ONE ADVISORY notice ("no team was staged", user clause 4), and an EXPLICIT
// `team:` prompt must still stage EXACTLY ONE team plus the provisioning notice. A gate
// that cannot fail one side is not accepted.
//
// R1 REPAIR — the soft-complex arm asserts the PLUGIN-side property, never a
// model-dependent absolute: the notice INVITES the captain to stage a team at the moment
// the work warrants it, so a live model that follows the notice and stages one is the
// DESIGNED behaviour and must not fail the case. Every team record is therefore attributed
// to its author from the HARNESS's own evidence (`attributeOrigin`): the plugin's own
// auto-route description + the record's `captainSessionId` for a PLUGIN record, an
// `agent_teams_create` tool call in the captain session's own log for a MODEL record, and
// `unknown` — which always fails — when neither signal holds.
//
// 1) offline --self-test: the SAME prompt arrays the live sides boot are fed through
//    the shipped gate module (trigger + routeDecision action: none / advise / provision)
//    plus a policy-disabled control and an always-advise negative control; the installer
//    row and the bundle patch must carry mode off + autoRoute true; the advisory /
//    provisioning notice builders must carry their distinguishing phrases; and the
//    attribution + per-side evaluators are driven by fixtures, both ways.
// 2) real run: isolated DSH_HOME + sandboxed HOME + sandbox workspace; per prompt, an
//    isolated headless boot; asserts the team records (active + archived, with their
//    attributed origin) and the notice KIND read from the user-role messages of the
//    harness session log, then assertSessionsSandboxed() on the side home.
//
// Never touches the real ~/.dsh (credentials/settings are COPIED into a sandbox).
// Evidence root: evidence/dsh-qa/session-start-team/<ts> unless MPD_QA_EVIDENCE_DIR is
// set, which redirects it (a wave whose lane owns only its own evidence subtree uses it).
import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, cpSync, rmSync } from "node:fs"
import { tmpdir, homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { credentialEnv, seedSandboxCredentials } from "./lib/credentials.mjs"
import { EXPLICIT_PROMPTS, SIMPLE_PROMPTS, SOFT_COMPLEX_PROMPTS, loadAndProbe, probeAll } from "./lib/gate-probe.mjs"
import { decodeSessionLog, findToolCall, readSessionEvents } from "./lib/session-evidence.mjs"
import { assertSessionsSandboxed, projectKey, sandboxWorkspace } from "./lib/workspace-isolation.mjs"

const safeJson = (text) => { try { return JSON.parse(text) } catch { return null } }
const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
const NOTICE_MARKER = "[AgentTeams] Session-start team rule"
// The two notice KINDS share the marker; these phrases are what distinguishes them
// (see `advisoryNotice` / `provisionedNotice` in lib/session-start.js).
const ADVISORY_PHRASE = "NO team was staged"
const PROVISIONED_PHRASE = "is staged in this workspace"
const SETTLE_MS = 50000
const LOG = []

// The live sides boot the SAME verbatim prompts the offline probe evaluates
// (lib/gate-probe.mjs), so the offline predicate and the live runs cannot drift.
const SIMPLE = SIMPLE_PROMPTS
const SOFT_COMPLEX = SOFT_COMPLEX_PROMPTS
const EXPLICIT = EXPLICIT_PROMPTS

function fail(msg) { console.error("[session-start-team] FAIL: " + msg); process.exit(1) }

function teamRoot(ws) { return join(ws, ".mpd", "team") }

function loadTeam(path) { try { return JSON.parse(readFileSync(path, "utf8")) } catch { return null } }

/**
 * Every team record this workspace ever carried: ACTIVE (`<id>/team.json`) plus
 * ARCHIVED (`archive/<id>/team.json`). The distinction matters for the EXPLICIT
 * `team:` side: the gate stages the team, and the provisioning notice itself names
 * `agent_teams_delete` as an accepted outcome when the staged team does not fit the
 * session — a live model that archives it must not read as "the gate staged nothing".
 */
function teamRecords(ws) {
  const root = teamRoot(ws)
  if (!existsSync(root)) return { active: [], archived: [] }
  const ids = readdirSync(root).filter((d) => d !== "archive" && d !== "retired-members.json" && existsSync(join(root, d, "team.json")))
  const archiveRoot = join(root, "archive")
  const archivedIds = existsSync(archiveRoot) ? readdirSync(archiveRoot).filter((d) => existsSync(join(archiveRoot, d, "team.json"))) : []
  return {
    active: ids.map((id) => loadTeam(join(root, id, "team.json"))).filter(Boolean),
    archived: archivedIds.map((id) => loadTeam(join(archiveRoot, id, "team.json"))).filter(Boolean),
  }
}

/**
 * The user-role messages the HARNESS recorded for one workspace, decoded through the
 * sanctioned reader (concatenated-zstd-frame containers: one zstdDecompressSync would
 * see the header frame only). A missing store is reported, never silently empty.
 */
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
    return { ok: true, texts, events: store.records, records: store.records.length, frames: store.frames, file: store.file }
  } catch (error) {
    return { ok: false, texts: [], events: [], records: 0, frames: 0, file: null, error: String(error?.message ?? error) }
  }
}

/** Which notices (none / advisory / provisioned) the session log carries, and the signals. */
function classifyNotice(texts) {
  const marked = texts.filter((text) => text.includes(NOTICE_MARKER))
  const advisory = marked.filter((text) => text.includes(ADVISORY_PHRASE))
  const provisioned = marked.filter((text) => text.includes(PROVISIONED_PHRASE))
  const signals = advisory.map((text) => /complexity signals ([A-D](?:\/[A-D])*)/.exec(text)?.[1]).filter((value) => value !== undefined)
  return { any: marked.length > 0, advisory: advisory.length, provisioned: provisioned.length, signals }
}

/** sha256 of a file via coreutils (keeps the settle-window assertion dependency-free). */
function sha256(path) {
  const r = spawnSync("sha256sum", [path], { encoding: "utf8" })
  return (r.stdout || "").trim().split(/\s+/)[0]
}

// ── origin attribution: PLUGIN provisioning vs MODEL staging (R1 repair) ──────
//
// The soft-complex arm must assert the PLUGIN-side property (the gate advises and
// provisions nothing). It must NOT fail because the live MODEL followed the advisory
// notice and staged a team itself — that is the designed behaviour the notice invites
// ("stage one at the moment the work actually warrants one"). A team record is therefore
// attributed to its author from the HARNESS's own evidence, never from the answer text:
//   - `plugin`  — the record carries the plugin's own auto-route description and belongs
//                 to the session whose log we read (lib/session-start.js writes it);
//   - `model`   — the captain session's log carries an `agent_teams_create` tool call;
//   - `unknown` — neither signal holds; a record nobody can attribute is never excused.

/** The plugin's auto-route description prefix (`provisionSessionTeam`'s default description). */
export const PLUGIN_ROUTE_DESCRIPTION_PREFIX = "Auto-routed by the complexity gate"

/** Where ONE team record came from. Pure: fixtures drive it in `--self-test`. */
export function attributeOrigin({ record, createCall, sessionIdMatch }) {
  const pluginDescription = typeof record?.description === "string" && record.description.startsWith(PLUGIN_ROUTE_DESCRIPTION_PREFIX)
  const modelCalled = createCall?.called === true
  if (pluginDescription && sessionIdMatch === true) {
    return { origin: "plugin", reasons: ["the record carries the plugin's auto-route description and belongs to this session"], pluginDescription, modelCalled }
  }
  if (modelCalled) {
    return { origin: "model", reasons: ["the captain session log records an agent_teams_create tool call"], pluginDescription, modelCalled }
  }
  if (pluginDescription) {
    return { origin: "unknown", reasons: ["the plugin description does not match this session's captainSessionId"], pluginDescription, modelCalled }
  }
  return { origin: "unknown", reasons: ["no agent_teams_create call and no plugin auto-route description"], pluginDescription, modelCalled }
}

/**
 * The harness's session log for ONE session id under `<dshHome>/sessions/<projectKey(ws)>/`.
 * `resolution` records which log the attribution actually used, so a reader can see whether
 * the captain's OWN log was found (`session-id`) or the newest log was used as a fallback
 * (`newest`) — or that no log exists at all (`none`).
 */
export function captainSessionEvidence(dshHome, ws, sessionId) {
  const root = join(dshHome, "sessions", projectKey(ws))
  const ids = (() => {
    try { return readdirSync(root).filter((id) => statSync(join(root, id)).isDirectory()) } catch { return [] }
  })()
  const logFor = (id) => {
    try {
      for (const name of readdirSync(join(root, id))) if (/^session\..*jsonl(\.zstd)?$/.test(name)) return join(root, id, name)
    } catch { /* unreadable session */ }
    return null
  }
  let file = null
  let usedId = null
  let resolution = "none"
  if (typeof sessionId === "string" && ids.includes(sessionId)) {
    file = logFor(sessionId)
    usedId = sessionId
    if (file !== null) resolution = "session-id"
  }
  if (file === null && ids.length > 0) {
    const newest = ids.map((id) => ({ id, file: logFor(id) })).filter((entry) => entry.file !== null)
      .sort((a, b) => statSync(b.file).mtimeMs - statSync(a.file).mtimeMs)[0]
    if (newest !== undefined) {
      file = newest.file
      usedId = newest.id
      resolution = "newest"
    }
  }
  if (file === null) return { resolution: "none", sessionId: usedId, file: null, records: [], frames: 0 }
  const decoded = decodeSessionLog(file)
  const records = []
  for (const line of decoded.text.split("\n")) {
    const text = line.trim()
    if (text.length === 0) continue
    try { records.push(JSON.parse(text)) } catch { /* torn tail */ }
  }
  return { resolution, sessionId: usedId, file, records, frames: decoded.frames }
}

/**
 * The verdict of ONE side. Pure, so `--self-test` drives every branch with fixtures.
 * `entries` is `[{slot, record}]` in active-then-archived order; `attributions` is parallel.
 */
export function evaluateSide({ expect, entries = [], notice, attributions = [] }) {
  const problems = []
  const total = entries.length
  if (expect === "none") {
    if (total !== 0) problems.push("a simple prompt must leave NO team record (active or archived)")
    if (notice.any) problems.push("a simple prompt must leave NO notice")
    return { ok: problems.length === 0, problems }
  }
  if (expect === "advise") {
    // The PLUGIN-side property (clause 4): the gate ADVises and provisions NOTHING.
    if (notice.provisioned !== 0) problems.push("an advisory route must NOT record the provisioning notice (the plugin provisioned)")
    if (notice.advisory !== 1) problems.push("an advisory route must record EXACTLY ONE advisory notice, got " + notice.advisory)
    if (notice.signals.length === 0) problems.push("the advisory notice must name the fired complexity signals")
    // A record IS allowed here — the notice invites the captain to stage at the moment the
    // work warrants it — but it must be attributed to the MODEL. A record the model did not
    // ask for is exactly the clause-4 violation this arm exists to catch.
    for (let index = 0; index < entries.length; index += 1) {
      const attribution = attributions[index] ?? { origin: "unknown", reasons: ["no attribution recorded"] }
      if (attribution.origin !== "model") {
        problems.push("a team record on the advisory path is not attributed to the model (id=" + String(entries[index].record?.id ?? "?") + ", origin=" + attribution.origin + ": " + attribution.reasons.join("; ") + ")")
      }
    }
    return { ok: problems.length === 0, problems }
  }
  if (expect === "provision") {
    if (total !== 1) problems.push("an explicit team: prompt must stage EXACTLY ONE team (active+archived=" + total + ")")
    if (notice.provisioned === 0) problems.push("the explicit path must record the provisioning notice")
    if (notice.advisory !== 0) problems.push("the explicit path must NOT record the advisory notice")
    const record = entries[0]?.record
    if (record !== undefined) {
      if (record.phase !== "staged") problems.push("the staged team must be in phase 'staged', got " + JSON.stringify(record.phase))
      if ((record.profile?.name ?? null) !== "mpd") problems.push("the staged team must use the mpd profile, got " + JSON.stringify(record.profile?.name ?? null))
      const attribution = attributions[0]
      if (attribution !== undefined && attribution.origin !== "plugin") {
        problems.push("the explicit path's record must be the PLUGIN's provisioning, got origin=" + attribution.origin + ": " + attribution.reasons.join("; "))
      }
    }
    return { ok: problems.length === 0, problems }
  }
  problems.push("unknown expectation " + expect)
  return { ok: false, problems }
}

async function selfTest() {
  const plugin = join(repoRoot, "packages", "mpd-agent-teams-plugin", "lib", "session-start.js")
  if (!existsSync(plugin)) fail("lib/session-start.js missing")
  const src = readFileSync(plugin, "utf8")
  if (!src.includes("agent/pre-step") || !src.includes("provisionSessionTeam")) fail("session-start.js policy hooks missing")
  if (!src.includes("evaluateComplexityGate") || !src.includes("consumeExplicitFlag")) fail("session-start.js complexity gate missing")
  // The ADVISORY path must exist and must be the one a triggered soft auto-route takes:
  // action 'advise' + the advisory notice builder; the provisioning notice stays for
  // mode:'auto' / the explicit flag.
  if (!src.includes("advisoryNotice") || !src.includes("'advise'")) fail("session-start.js has no advisory route/notice (clause 4)")
  if (!src.includes(ADVISORY_PHRASE)) fail("advisoryNotice must state that NO team was staged")
  if (!src.includes(PROVISIONED_PHRASE)) fail("provisionedNotice must state that the team is staged")
  // §4.3 consistency: the ADVISORY text instructs approval="required" (normal mode) and
  // must not forbid automatic staging — the ULW path stages with approval="automatic".
  const advisoryBody = src.slice(src.indexOf("export function advisoryNotice"), src.indexOf("export function instructNotice"))
  if (advisoryBody.length === 0) fail("advisoryNotice body not found")
  if (!advisoryBody.includes('approval="required"')) fail("advisoryNotice must instruct approval=\"required\" for normal-mode staging")
  if (/automatic/u.test(advisoryBody)) fail("advisoryNotice must not mention automatic approval (the ULW path uses it)")
  const patch = readFileSync(join(repoRoot, "packages", "mpd-bundle", "cordis.patch.yml"), "utf8")
  if (!patch.includes("sessionTeamPolicy") || !patch.includes("mode: off") || !patch.includes("autoRoute: true")) fail("bundle patch sessionTeamPolicy must carry mode: off + autoRoute: true")
  const installer = readFileSync(join(repoRoot, "scripts", "install-profile.mjs"), "utf8")
  if (!installer.includes("sessionTeamPolicy") || !installer.includes('mode: "off"') || !installer.includes("autoRoute: true")) fail("installer row config must carry mode off + autoRoute true")
  const persona = readFileSync(join(repoRoot, "presets", "mpd", "agent.cordis.yml"), "utf8")
  if (!persona.includes("SESSION STARTUP RULE")) fail("preset persona missing SESSION STARTUP RULE")
  if (/MUST start inside a team|MUST begin inside a team/.test(persona)) fail("preset persona still carries the mandatory-team invariant")

  // The three-way offline predicate over the VERY prompt arrays the live sides boot.
  const probed = await loadAndProbe()
  const bad = [...probed.rows, ...probed.disabled].filter((row) => row.problems.length > 0)
  if (bad.length > 0) {
    for (const row of bad) console.error("  - " + row.label + " " + JSON.stringify(row.prompt.slice(0, 40)) + ": " + row.problems.join("; "))
    fail("offline three-way probe failed (" + bad.length + " row(s)); run node skills/dsh-qa/scripts/lib/gate-probe.mjs")
  }
  const byLabel = { simple: probed.rows.filter((r) => r.label === "simple"), soft: probed.rows.filter((r) => r.label === "soft"), explicit: probed.rows.filter((r) => r.label === "explicit") }
  if (byLabel.simple.length !== SIMPLE.length || byLabel.soft.length !== SOFT_COMPLEX.length || byLabel.explicit.length !== EXPLICIT.length) fail("probe did not evaluate every prompt of every set")

  // NEGATIVE CONTROL (offline): a gate that answers `advise` to EVERYTHING must FAIL the
  // same predicate. Without this an always-advise stub could pass the probe vacuously.
  const alwaysAdvise = {
    consumeExplicitFlag: (text) => ({ flagged: false, text }),
    evaluateComplexityGate: () => ({ trigger: true, signals: ["C"] }),
    hasPlanArtifact: async () => false,
    routeDecision: async () => ({ action: "advise", signals: ["C"] }),
  }
  const controlWorkspace = mkdtempSync(join(tmpdir(), "mpd-sst-control-"))
  const control = await probeAll(alwaysAdvise, controlWorkspace)
  rmSync(controlWorkspace, { recursive: true, force: true })
  if (control.failed === 0) fail("negative control: an always-advise gate passed the offline predicate")

  // The case's own prompt arrays must be bound to the probe's (no drift allowed).
  if (SIMPLE !== SIMPLE_PROMPTS || SOFT_COMPLEX !== SOFT_COMPLEX_PROMPTS || EXPLICIT !== EXPLICIT_PROMPTS) fail("live prompt sets must be the probe's arrays")

  // ── the R1-repair predicates, driven by fixtures BOTH ways ──────────────────
  const pluginRecord = { id: "mpd-default", phase: "staged", description: PLUGIN_ROUTE_DESCRIPTION_PREFIX + " (sessionTeamPolicy.autoRoute; …)", captainSessionId: "session-A", profile: { name: "mpd" }, members: [] }
  const modelRecord = { id: "mpd-default", phase: "staged", description: "Audit the orchestration surface and implement the routing change", captainSessionId: "session-A", profile: { name: "mpd" }, members: [] }
  const strangerRecord = { id: "mpd-default", phase: "staged", description: "something else", captainSessionId: "session-OTHER", profile: { name: "mpd" }, members: [] }
  const createCall = { called: true, callIds: ["call-1"] }
  const noCreateCall = { called: false, callIds: [] }
  const pluginOrigin = attributeOrigin({ record: pluginRecord, createCall: noCreateCall, sessionIdMatch: true })
  if (pluginOrigin.origin !== "plugin") fail("attribution: the plugin's own description + session match must read as 'plugin'")
  const modelOrigin = attributeOrigin({ record: modelRecord, createCall, sessionIdMatch: true })
  if (modelOrigin.origin !== "model") fail("attribution: an agent_teams_create call must read as 'model'")
  if (attributeOrigin({ record: modelRecord, createCall: noCreateCall, sessionIdMatch: true }).origin !== "unknown") fail("attribution negative control: a record with no call and no plugin description must be 'unknown'")
  if (attributeOrigin({ record: pluginRecord, createCall: noCreateCall, sessionIdMatch: false }).origin !== "unknown") fail("attribution negative control: a plugin description from ANOTHER session must be 'unknown'")
  if (attributeOrigin({ record: pluginRecord, createCall, sessionIdMatch: true }).origin !== "plugin") fail("attribution: the record's own description must outrank a stray create call")

  const advisoryNotice = { any: true, advisory: 1, provisioned: 0, signals: ["C"] }
  const provisionedNotice = { any: true, advisory: 0, provisioned: 1, signals: [] }
  const softClean = evaluateSide({ expect: "advise", entries: [], notice: advisoryNotice, attributions: [] })
  if (!softClean.ok) fail("evaluateSide: an advisory side with no record must pass")
  const softModelStaged = evaluateSide({ expect: "advise", entries: [{ slot: "active", record: modelRecord }], notice: advisoryNotice, attributions: [{ origin: "model", reasons: [] }] })
  if (!softModelStaged.ok) fail("evaluateSide: a MODEL-staged record after the advisory notice must PASS (designed behaviour)")
  const softPluginStaged = evaluateSide({ expect: "advise", entries: [{ slot: "active", record: pluginRecord }], notice: advisoryNotice, attributions: [{ origin: "plugin", reasons: [] }] })
  if (softPluginStaged.ok) fail("evaluateSide negative control: a PLUGIN-staged record on the advisory path must FAIL (clause 4)")
  if (evaluateSide({ expect: "advise", entries: [{ slot: "active", record: strangerRecord }], notice: advisoryNotice, attributions: [{ origin: "unknown", reasons: [] }] }).ok) fail("evaluateSide negative control: an unattributable record must FAIL")
  if (evaluateSide({ expect: "advise", entries: [], notice: { any: true, advisory: 0, provisioned: 1, signals: ["C"] }, attributions: [] }).ok) fail("evaluateSide negative control: a provisioning notice on the advisory path must FAIL")
  if (evaluateSide({ expect: "advise", entries: [], notice: { any: true, advisory: 2, provisioned: 0, signals: ["C"] }, attributions: [] }).ok) fail("evaluateSide negative control: TWO advisory notices must FAIL")
  if (evaluateSide({ expect: "advise", entries: [], notice: { any: true, advisory: 1, provisioned: 0, signals: [] }, attributions: [] }).ok) fail("evaluateSide negative control: an advisory notice without signals must FAIL")
  if (!evaluateSide({ expect: "none", entries: [], notice: { any: false, advisory: 0, provisioned: 0, signals: [] } }).ok) fail("evaluateSide: a clean simple side must pass")
  if (evaluateSide({ expect: "none", entries: [{ slot: "archived", record: modelRecord }], notice: { any: false, advisory: 0, provisioned: 0, signals: [] } }).ok) fail("evaluateSide negative control: any record on the simple side must FAIL")
  const explicitOk = evaluateSide({ expect: "provision", entries: [{ slot: "active", record: pluginRecord }], notice: provisionedNotice, attributions: [{ origin: "plugin", reasons: [] }] })
  if (!explicitOk.ok) fail("evaluateSide: the explicit side's plugin-staged record must pass")
  if (evaluateSide({ expect: "provision", entries: [{ slot: "active", record: modelRecord }], notice: provisionedNotice, attributions: [{ origin: "model", reasons: [] }] }).ok) fail("evaluateSide negative control: an explicit side staged by the MODEL must FAIL")
  if (evaluateSide({ expect: "provision", entries: [{ slot: "active", record: pluginRecord }, { slot: "archived", record: pluginRecord }], notice: provisionedNotice, attributions: [{ origin: "plugin", reasons: [] }, { origin: "plugin", reasons: [] }] }).ok) fail("evaluateSide negative control: TWO explicit records must FAIL")

  const probe = spawnSync(process.execPath, [join(repoRoot, "skills", "dsh-qa", "scripts", "lib", "gate-probe.mjs")], { encoding: "utf8", cwd: repoRoot })
  if (probe.status !== 0) {
    console.error(probe.stdout || "")
    console.error(probe.stderr || "")
    fail("gate probe failed (all three directions must hold on the frozen prompt sets)")
  }
  console.log("[session-start-team self-test] ok: gate module + advisory/provision notices + bundle patch + installer + persona + THREE-WAY prompt directions + always-advise control + attribution/evaluator fixtures (plugin vs model vs unattributable) verified")
}

async function runReal() {
  const creds = join(homedir(), ".dsh", ".credentials.yaml")
  if (!existsSync(creds)) fail("missing credentials at " + creds)
  const ts = new Date().toISOString().replaceAll(":", "-")
  const outDir = process.env.MPD_QA_EVIDENCE_DIR
    ? join(process.env.MPD_QA_EVIDENCE_DIR, "session-start-team-" + ts)
    : join(repoRoot, "evidence", "dsh-qa", "session-start-team", ts)
  mkdirSync(outDir, { recursive: true })

  const rev0 = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).stdout.trim()
  const gatePath = join(repoRoot, "packages", "mpd-agent-teams-plugin", "lib", "session-start.js")
  const gate0 = sha256(gatePath)
  LOG.push("settleWait: " + SETTLE_MS + " ms (revision " + rev0 + ", session-start.js " + gate0.slice(0, 16) + ")")
  await new Promise((resolve) => setTimeout(resolve, SETTLE_MS))
  const rev1 = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).stdout.trim()
  const gate1 = sha256(gatePath)
  const settled = rev0 === rev1 && gate0 === gate1
  const steps = { settled: { ok: settled, rev: rev1, gateHash: gate1 } }
  if (!settled) fail("revision did not settle (HEAD or gate file changed during the window)")

  const sandbox = mkdtempSync(join(tmpdir(), "mpd-sst-"))
  const sandboxHome = join(sandbox, "home")
  mkdirSync(sandboxHome, { recursive: true })
  seedSandboxCredentials(sandbox, { credentialsFile: creds })
  const settings = join(homedir(), ".dsh", "settings.yaml")
  if (existsSync(settings)) cpSync(settings, join(sandbox, "settings.yaml"))
  // AGENTS.md §7: HOME is sandboxed too (skill roots, workmate library), and the
  // workspace is passed explicitly on every spawn (env alone cannot isolate it).
  const env = credentialEnv({ ...process.env, DSH_HOME: sandbox, HOME: sandboxHome })
  if (env.DSH_HOME !== sandbox || env.HOME !== sandboxHome) fail("isolation assertion failed")

  function runSync(cmd, args, opts = {}) {
    const r = spawnSync(cmd, args, { env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: opts.timeout ?? 900000, cwd: opts.cwd ?? repoRoot, stdio: ["ignore", "pipe", "pipe"] })
    const out = (r.stdout || "") + (r.stderr || "")
    LOG.push("$ " + cmd + " " + args.join(" ") + "\n[[exit=" + r.status + "]]\n" + out.slice(0, 20000))
    return { status: r.status, out, stdout: r.stdout || "" }
  }

  const inst = runSync(process.execPath, [join(repoRoot, "scripts", "install-profile.mjs"), "--yes", "--dsh-home", sandbox, "--profile", "mpd-headless", "--skip-toolchain"], { timeout: 600000 })
  steps.installer = { ok: inst.status === 0, exit: inst.status }

  const homePatch = readFileSync(join(sandbox, "cordis.patch.yml"), "utf8")
  steps.patchRow = { ok: /id:\s*agent-teams/.test(homePatch) && homePatch.includes("sessionTeamPolicy") && homePatch.includes('"off"') && homePatch.includes("autoRoute") && homePatch.includes("MPD Default"), hasRow: homePatch.includes("agent-teams") }

  // T-69: the wrapper composes; `--json` keeps the child's output parseable (banner on stderr).
  const dump = runSync(process.execPath, [join(repoRoot, "scripts", "dump-config.mjs"), "--profile", "mpd-headless", "--json"], { timeout: 120000 })
  const dumpText = safeJson(dump.stdout)?.stdout ?? dump.stdout
  steps.compose = { ok: dump.status === 0 && dumpText.includes("agent-teams") && dumpText.includes("sessionTeamPolicy") && dumpText.includes("MPD Default"), exit: dump.status }
  assertSessionsSandboxed(sandbox, sandbox, { label: "session-start-team-main" })

  /**
   * One boot per prompt. `expect` is the routing action the frozen contract requires:
   * "none" (simple: no team, no notice), "advise" (soft complex: no team, ADVISORY
   * notice naming the signals) or "provision" (explicit `team:`: exactly one team).
   */
  async function runSide(label, prompts, expect) {
    const results = []
    for (let i = 0; i < prompts.length; i += 1) {
      const sideHome = join(sandbox, "side", label, String(i))
      const sideWs = sandboxWorkspace(sandbox, join("side", label, String(i), "ws"))
      const sideUserHome = join(sideHome, "home")
      mkdirSync(sideUserHome, { recursive: true })
      cpSync(join(sandbox, ".credentials.yaml"), join(sideHome, ".credentials.yaml"))
      if (existsSync(join(sandbox, "settings.yaml"))) cpSync(join(sandbox, "settings.yaml"), join(sideHome, "settings.yaml"))
      cpSync(join(sandbox, "profiles"), join(sideHome, "profiles"), { recursive: true })
      cpSync(join(sandbox, "cordis.patch.yml"), join(sideHome, "cordis.patch.yml"))
      const sideEnv = { ...process.env, DSH_HOME: sideHome, HOME: sideUserHome }
      const live = spawnSync("dsh", ["--profile", "mpd-headless", prompts[i]], { env: sideEnv, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 600000, cwd: sideWs, stdio: ["ignore", "pipe", "pipe"] })
      LOG.push("[" + label + " " + i + "] $ dsh --profile mpd-headless " + JSON.stringify(prompts[i]) + "\n[[exit=" + live.status + "]]\n" + ((live.stdout || "") + (live.stderr || "")).slice(0, 20000))
      const records = teamRecords(sideWs)
      // Preserve the side's state before the sandbox tmpdir is understood only through
      // the evidence dir: copy the workspace team records and the session logs so the
      // notice assertion stays auditable after the run.
      try {
        const keep = join(outDir, "sides", label, String(i))
        mkdirSync(keep, { recursive: true })
        if (existsSync(teamRoot(sideWs))) cpSync(teamRoot(sideWs), join(keep, "team"), { recursive: true })
        if (existsSync(join(sideHome, "sessions"))) cpSync(join(sideHome, "sessions"), join(keep, "sessions"), { recursive: true })
        writeFileSync(join(keep, "prompt.txt"), prompts[i])
      } catch { /* evidence copy is best-effort; the assertions below are the gate */ }
      const recorded = recordedUserTexts(sideHome, sideWs)
      const notice = classifyNotice(recorded.texts)
      const isolation = (() => {
        try { return { ok: true, ...assertSessionsSandboxed(sideHome, sideWs, { label: "session-start-team-" + label + "-" + i }) } } catch (error) { return { ok: false, error: String(error?.message ?? error) } }
      })()
      // The explicit side may have been ARCHIVED mid-session by the live model: the
      // provisioning notice itself names `agent_teams_delete` as an accepted outcome.
      // The harness's own tool record is the evidence for who did it.
      const archiveCall = findToolCall(recorded.events ?? [], "agent_teams_delete")
      // ── origin attribution of every record (R1 repair) ────────────────────────
      const entries = [
        ...records.active.map((record) => ({ slot: "active", record })),
        ...records.archived.map((record) => ({ slot: "archived", record })),
      ]
      const attributions = entries.map((entry) => {
        const evidence = captainSessionEvidence(sideHome, sideWs, entry.record?.captainSessionId)
        const createCall = findToolCall(evidence.records, "agent_teams_create")
        const attribution = attributeOrigin({
          record: entry.record,
          createCall,
          sessionIdMatch: typeof entry.record?.captainSessionId === "string" && entry.record.captainSessionId === evidence.sessionId,
        })
        return {
          slot: entry.slot,
          id: entry.record?.id ?? null,
          phase: entry.record?.phase ?? null,
          description: String(entry.record?.description ?? "").slice(0, 240),
          captainSessionId: entry.record?.captainSessionId ?? null,
          logResolution: evidence.resolution,
          logSessionId: evidence.sessionId,
          createCalls: createCall.callIds ?? [],
          archiveCalls: archiveCall.callIds ?? [],
          ...attribution,
        }
      })
      const verdict = evaluateSide({ expect, entries, notice, attributions })
      const stagedRecord = entries[0]?.record
      const spawned = stagedRecord ? (stagedRecord.members || []).filter((m) => m.status === "active" || m.spawned === true).length : 0
      const problems = [...verdict.problems]
      if (!recorded.ok) problems.push("session log unreadable: " + recorded.error)
      if (!isolation.ok) problems.push("workspace isolation violated: " + isolation.error)
      results.push({
        prompt: prompts[i], expect, exited: live.status, teams: records.active.length, stagedTotal: entries.length,
        staged: stagedRecord ? stagedRecord.phase : undefined,
        profile: stagedRecord && stagedRecord.profile ? stagedRecord.profile.name : undefined,
        members: stagedRecord ? (stagedRecord.members || []).length : 0, spawnedMembers: spawned,
        archivedRecords: records.archived.length,
        archivedByModel: archiveCall.called,
        modelStaged: attributions.filter((attribution) => attribution.origin === "model").length,
        pluginStaged: attributions.filter((attribution) => attribution.origin === "plugin").length,
        unattributed: attributions.filter((attribution) => attribution.origin === "unknown").length,
        attributions,
        notice: { any: notice.any, advisory: notice.advisory, provisioned: notice.provisioned, signals: notice.signals },
        isolation: isolation.ok, sessionRecords: recorded.records, sessionFrames: recorded.frames,
        problems, ok: problems.length === 0,
      })
      rmSync(teamRoot(sideWs), { recursive: true, force: true })
    }
    return results
  }

  // NEGATIVE CONTROL: with the gate explicitly DISABLED the same soft-complex prompt must
  // produce NO team AND NO notice. Without this, a notice written unconditionally (or a
  // gate that is accidentally always-true) could still "pass" the advisory side.
  function runNegativeControl() {
    const controlHome = join(sandbox, "negative-control")
    const controlWs = sandboxWorkspace(sandbox, "negative-control/ws")
    mkdirSync(join(controlHome, "home"), { recursive: true })
    cpSync(join(sandbox, ".credentials.yaml"), join(controlHome, ".credentials.yaml"))
    if (existsSync(join(sandbox, "settings.yaml"))) cpSync(join(sandbox, "settings.yaml"), join(controlHome, "settings.yaml"))
    cpSync(join(sandbox, "profiles"), join(controlHome, "profiles"), { recursive: true })
    const patchText = readFileSync(join(sandbox, "cordis.patch.yml"), "utf8")
    // the installed row renders autoRoute as JSON-ish YAML; flipping it to false must
    // disarm the gate. If the pattern is absent the control FAILS loudly instead of
    // passing vacuously.
    if (!patchText.includes("autoRoute")) return { ok: false, reason: "autoRoute not found in the installed row patch" }
    const disarmed = patchText.replace(/autoRoute:\s*true/g, "autoRoute: false")
    writeFileSync(join(controlHome, "cordis.patch.yml"), disarmed)
    const env = credentialEnv({ ...process.env, DSH_HOME: controlHome, HOME: join(controlHome, "home") })
    const live = spawnSync("dsh", ["--profile", "mpd-headless", SOFT_COMPLEX[0]], { env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 600000, cwd: controlWs, stdio: ["ignore", "pipe", "pipe"] })
    LOG.push("[negative-control] autoRoute=false + soft-complex prompt\n[[exit=" + live.status + "]]\n" + ((live.stdout || "") + (live.stderr || "")).slice(0, 4000))
    const controlRecords = teamRecords(controlWs)
    const controlStaged = controlRecords.active.length + controlRecords.archived.length
    const recorded = recordedUserTexts(controlHome, controlWs)
    const notice = classifyNotice(recorded.texts)
    const isolation = (() => {
      try { return { ok: true, ...assertSessionsSandboxed(controlHome, controlWs, { label: "session-start-team-control" }) } } catch (error) { return { ok: false, error: String(error?.message ?? error) } }
    })()
    const problems = []
    if (controlStaged !== 0) problems.push("a disarmed gate must stage no team (active or archived)")
    if (notice.any) problems.push("a disarmed gate must inject NO notice")
    if (!isolation.ok) problems.push("workspace isolation violated: " + isolation.error)
    return { ok: problems.length === 0, teams: controlRecords.active.length, stagedTotal: controlStaged, notice: { any: notice.any, advisory: notice.advisory, provisioned: notice.provisioned }, disarmed: disarmed !== patchText, isolation: isolation.ok, problems }
  }

  steps.simpleSide = await runSide("simple", SIMPLE, "none")
  steps.softComplexSide = await runSide("soft-complex", SOFT_COMPLEX, "advise")
  steps.explicitSide = await runSide("explicit", EXPLICIT, "provision")
  steps.negativeControl = runNegativeControl()
  steps.threeWay = {
    ok: steps.simpleSide.every((r) => r.ok) && steps.softComplexSide.every((r) => r.ok) && steps.explicitSide.every((r) => r.ok) && steps.negativeControl.ok,
    simpleTeams: steps.simpleSide.map((r) => r.stagedTotal),
    simpleNotices: steps.simpleSide.map((r) => r.notice.any),
    softTeams: steps.softComplexSide.map((r) => r.stagedTotal),
    softModelStaged: steps.softComplexSide.map((r) => r.modelStaged),
    softPluginStaged: steps.softComplexSide.map((r) => r.pluginStaged),
    softAdvisory: steps.softComplexSide.map((r) => r.notice.advisory),
    softSignals: steps.softComplexSide.map((r) => r.notice.signals),
    explicitTeams: steps.explicitSide.map((r) => r.stagedTotal),
    explicitActive: steps.explicitSide.map((r) => r.teams),
    explicitArchived: steps.explicitSide.map((r) => r.archivedRecords),
    explicitPluginStaged: steps.explicitSide.map((r) => r.pluginStaged),
    explicitProvisioned: steps.explicitSide.map((r) => r.notice.provisioned),
  }

  const allOk = Object.values(steps).every((s) => (typeof s === "object" && "ok" in s) ? s.ok : true)
  writeFileSync(join(outDir, "result.json"), JSON.stringify({ ok: allOk, sandbox, steps, totalSteps: Object.keys(steps).length }, null, 2))
  writeFileSync(join(outDir, "output.log"), LOG.join("\n\n---\n\n"))
  console.log("[session-start-team] ok=" + allOk + " -> " + outDir)
  for (const [k, v] of Object.entries(steps)) console.log("  " + k + ": " + JSON.stringify(v).slice(0, 400))
  if (!allOk) process.exit(1)
  console.log("[session-start-team] PASS")
}

// Guarded on being the ENTRY module: another artifact (e.g. the soft-origin replay in
// evidence/ulw/l5b-case-origin/) may import `attributeOrigin` / `evaluateSide` without
// triggering this case's own run.
const argv = process.argv.slice(2)
const isEntry = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]
if (isEntry) {
  if (argv.includes("--self-test")) await selfTest()
  else await runReal()
}
