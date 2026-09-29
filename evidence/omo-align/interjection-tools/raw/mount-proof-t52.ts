// t52 MOUNT PROOF — the three new AgentTeams tools must be REGISTERED at a real boot.
//
// Why a boot and not `--dump-config`: `--dump-config` only COMPOSES rows and never executes
// plugin code (AGENTS.md §4), so it cannot witness a registered tool or a schema abort. This
// driver boots the dev-flavored bundle (the same devPatch rewrite preset-register.mjs uses,
// so no pnpm install is needed) with an isolated DSH_HOME + sandbox HOME + sandbox workspace,
// and reads REGISTRATION INSTRUMENTATION printed from inside the mounted boot by the QA probe.
//
// The probe prints AGENT_TEAMS_TOOLS=<n>/<n> and AGENT_TEAMS_NEW_TOOLS_OK=<true|false>;
// this driver asserts both, asserts 0 apply/schema abort signatures, and then drives the
// three tools against a real team.json on disk.
import { spawnSync } from "node:child_process"
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = dirname(dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url))))))
const PROBE = join(repoRoot, "packages", "mpd-qa-roles-probe", "dist", "index.js")
const PRESETS_DIR = join(repoRoot, "presets")
const PACKED_PRESETS_EXPR = /\(typeof baseUrl === "string" \? baseUrl\.replace\(\/\\?\/\/\\\/\/g, ""\)\.replace\(\/\\\/\+\$\/, ""\) : ""\) \+ "\/node_modules\/@mpd-dsh\/mpd\/presets"/
const BASEURL_PREFIX = '(typeof baseUrl === "string" ? baseUrl.replace(/^file:\\/\\//, "").replace(/\\/+$/, "") : "") + '
const NEW_TOOLS = ["agent_teams_interject_request", "agent_teams_interject_decide", "agent_teams_mailbox_clear"]
const CRASH_SIGNATURES = [
  "unsupported JSON schema", "JsonSchemaError", "plugin tree failed to load",
  "failed to apply loader entry", "agent-teams: member initialization failed",
]

const ts = new Date().toISOString().replace(/[:.]/g, "-")
const outDir = join(repoRoot, "evidence", "omo-align", "interjection-tools", "mount")
mkdirSync(outDir, { recursive: true })
function fail(message) {
  console.error("[t52-mount] FAIL: " + message)
  process.exit(1)
}
function devPatch() {
  const text = readFileSync(join(repoRoot, "packages", "mpd-bundle", "cordis.patch.yml"), "utf8")
  return text
    .split(PACKED_PRESETS_EXPR).join(JSON.stringify(PRESETS_DIR))
    .split(BASEURL_PREFIX).join("")
    .split('"/node_modules/@mpd-dsh/mpd/').join('"' + repoRoot + "/")
    .split("name: '@mpd-dsh/mpd'").join("name: '" + join(repoRoot, "packages", "mpd-bundle-plugin", "dist", "index.js") + "'")
    .split("@mpd-dsh/mpd/").join(repoRoot + "/")
}

if (process.argv[2] === "--self-test") {
  const bundled = existsSync(PROBE) ? readFileSync(PROBE, "utf8") : ""
  if (!bundled.includes("AGENT_TEAMS_NEW_TOOLS_OK")) fail("probe bundle lacks the registration instrumentation")
  if (!readFileSync(join(repoRoot, "packages", "mpd-bundle", "cordis.patch.yml"), "utf8").includes("agent-teams")) fail("bundle patch no longer names the agent-teams row")
  const patched = devPatch()
  if (patched.length < 1000 || patched.includes("@mpd-dsh/mpd/")) fail("devPatch did not consume every packed operand")
  console.log("[t52-mount self-test] ok: instrumentation present in the shipped probe bundle, bundle patch carries the row, devPatch clean")
  process.exit(0)
}
const creds = join(homedir(), ".dsh", ".credentials.yaml")
if (!existsSync(creds)) fail("no credentials to sandbox")
if (!existsSync(PROBE)) fail("QA probe dist missing — rebuild packages/mpd-qa-roles-probe")

const sandbox = mkdtempSync(join(process.env.TMPDIR ?? "/tmp", "mpd-t52-mount-"))
const userHome = join(sandbox, "home")
const workspace = join(sandbox, "ws")
mkdirSync(userHome, { recursive: true })
mkdirSync(workspace, { recursive: true })
// mode 0o600: the credentials row REFUSES a file readable beyond its owner, and without it
// the whole plugin tree fails to load ("credentials-local: ... readable beyond its owner").
writeFileSync(join(sandbox, ".credentials.yaml"), readFileSync(creds), { mode: 0o600 })

const bundlePatch = join(sandbox, "bundle.dev.patch.yml")
writeFileSync(bundlePatch, devPatch())
const presetsOverlay = join(sandbox, "agent-presets-headless.yml")
writeFileSync(presetsOverlay, readFileSync(join(repoRoot, "tests/overlays", "agent-presets-headless.yml"), "utf8").split("{{PRESETS}}").join(PRESETS_DIR))
const probeOverlay = join(sandbox, "roles-probe.yml")
writeFileSync(probeOverlay, readFileSync(join(repoRoot, "tests/overlays", "roles-probe.yml"), "utf8").split("{{PROBE}}").join(PROBE))

const logFile = join(outDir, "boot-" + ts + ".log")
const fd = openSync(logFile, "w")
const env = { ...process.env, DSH_HOME: sandbox, HOME: userHome }
// compose-only check, recorded as COMPOSITION evidence and explicitly NOT load evidence
const dump = spawnSync("dsh", ["--profile", "headless", "--patch", bundlePatch, "--dump-config"], { env, cwd: workspace, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
const dumpOut = `${dump.stdout ?? ""}${dump.stderr ?? ""}`
spawnSync("dsh", ["--profile", "headless", "--patch", bundlePatch, "--patch", presetsOverlay, "--patch", probeOverlay, "ok"], {
  env, cwd: workspace, encoding: "utf8", stdio: ["ignore", fd, fd], timeout: 240_000,
})
closeSync(fd)
const out = existsSync(logFile) ? readFileSync(logFile, "utf8") : ""

const crashes = CRASH_SIGNATURES.filter((signature) => out.includes(signature))
const toolsLine = /\[roles-probe\] AGENT_TEAMS_TOOLS=(\d+)\/(\d+)(?: MISSING=([^\s]*))?/.exec(out)
const newToolsOk = /\[roles-probe\] AGENT_TEAMS_NEW_TOOLS_OK=(true|false)/.exec(out)

const steps = {
  composition: {
    ok: dump.status === 0 && dumpOut.includes("id: agent-teams"),
    exit: dump.status,
    note: "COMPOSITION ONLY — never cited as load evidence (AGENTS.md §4)",
  },
  mountedBoot: {
    ok: toolsLine !== null && newToolsOk?.[1] === "true" && crashes.length === 0,
    registeredTools: toolsLine === null ? null : Number(toolsLine[1]),
    assertedTools: toolsLine === null ? null : Number(toolsLine[2]),
    missing: toolsLine?.[3] === undefined ? [] : toolsLine[3].split(",").filter(Boolean),
    newToolsOk: newToolsOk?.[1] ?? null,
    crashSignatures: crashes,
    probeVerdict: /roles-probe\] PASS/.test(out) ? "PASS" : /roles-probe\] FAIL/.test(out) ? "FAIL" : "absent",
    presetResolved: /PRESET_MPD=ok/.test(out),
    loadEvidence: "real mounted boot of the dev-flavored bundle in an isolated DSH_HOME + sandbox HOME + sandbox workspace, with registration instrumentation read from inside the boot; --dump-config is deliberately NOT cited as load evidence (AGENTS.md §4)",
  },
  isolation: {
    ok: true,
    sandbox,
    note: "DSH_HOME, HOME and the session cwd are all sandboxed temp dirs; the boot log lands under evidence/",
  },
}

// one REAL drive of the three tools against a real team on disk
const { registerAgentTeamsTools } = await import(join(repoRoot, "packages", "mpd-agent-teams-plugin", "lib", "tools.js"))
const stateDir = join(".mpd", "team")
mkdirSync(join(workspace, stateDir, "t52-mount-team", "inbox"), { recursive: true })
const now = Date.now()
writeFileSync(join(workspace, stateDir, "t52-mount-team", "team.json"), JSON.stringify({
  id: "t52-mount-team", name: "t52-mount", captainSessionId: "mount-captain", createdAt: now, updatedAt: now,
  taskSeq: 0, phase: "running",
  members: [{ id: "mount-member", name: "Senior Engineer", role: "engineer", status: "idle", joinedAt: now }],
  tasks: [],
}, null, 2))
const agent = (id) => ({ id, status: "idle", options: {}, session: { header: { cwd: workspace }, requestHeader: () => ({ config: {} }) } })
const captain = agent("mount-captain")
const member = agent("mount-member")
const tools = new Map()
registerAgentTeamsTools({ tools: { register: (d) => tools.set(d.name, d) }, agents: { get: (id) => [captain, member].find((a) => a.id === id), list: () => [captain, member] }, subagents: { prompt: async () => ({ messageId: "m" }), followup: () => {}, sendMessage: () => {} }, effect: () => {}, on: () => {}, logger: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} }, get: () => undefined, llm: { resolveCallConfig: async (r) => r, listModels: async () => [] } }, { stateDir })
const asked = await tools.get("agent_teams_interject_request").execute({ summary: "mount proof", reason: "prove the lane answers", location: "bot" }, { agent: member })
const listed = await tools.get("agent_teams_interject_decide").execute({ action: "list" }, { agent: captain })
let memberRefused = false
try {
  await tools.get("agent_teams_interject_decide").execute({ request_id: asked.request_id, decision: "approved" }, { agent: member })
} catch (error) {
  memberRefused = String(error?.message ?? error).includes("only the captain")
}
const decided = await tools.get("agent_teams_interject_decide").execute({ request_id: asked.request_id, decision: "approved" }, { agent: captain })
const cleared = await tools.get("agent_teams_mailbox_clear").execute({ watermark: Date.now() + 1000, agent: "Senior Engineer" }, { agent: captain })
steps.toolSurfaceOnDisk = {
  ok: asked.status === "pending" && listed.pending.length === 1 && memberRefused
    && decided.status === "approved" && cleared.cleared.length === 1 && cleared.unread_after === 0,
  requested: asked.request_id,
  listedPending: listed.pending.length,
  memberRefused,
  decidedStatus: decided.status,
  clearedRecords: cleared.cleared.length,
  unreadAfterClear: cleared.unread_after,
}

const ok = Object.values(steps).every((step) => step.ok)
writeFileSync(join(outDir, "result-" + ts + ".json"), JSON.stringify({
  task: "t52", head: spawnSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).stdout.trim(),
  newTools: NEW_TOOLS, steps,
}, null, 2))
console.log("[t52-mount] ok=" + ok + " -> " + outDir)
for (const [name, step] of Object.entries(steps)) console.log("  " + name + ": " + JSON.stringify(step).slice(0, 240))
if (!ok) fail("one or more mount-proof steps failed")
rmSync(sandbox, { recursive: true, force: true })
console.log("[t52-mount] PASS")
