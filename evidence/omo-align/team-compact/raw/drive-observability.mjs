// t48 — OBSERVABILITY + DRIVE-PATH probe, against a REAL session.
//
// Creates one session through the gateway so a live Agent actually exists, then an in-boot
// probe reports (a) whether the compaction engine resolved from the AGENT'S OWN scoped context
// answers, and (b) whether the observability entry points the design depends on
// (`session.log` / `eventsSnapshot`) are readable.
//
// EXPLICIT LIMIT, recorded rather than glossed: a NON-NULL compaction and the durable
// `compaction/start` + `compaction/end` pair are NOT reachable here — both need session
// CONTENT, which needs a provider key this environment does not have. That layer is owed to a
// credentialed slot.
import { spawn, spawnSync } from "node:child_process"
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = here.slice(0, here.indexOf("/evidence/"))
const outDir = join(here, "..", "drive")
mkdirSync(outDir, { recursive: true })
const PORT = 38505
const ts = new Date().toISOString().replace(/[:.]/g, "-")
const reportFile = join(outDir, `report-${ts}.json`)

// The probe writes its report to a FILE: a console line from a plugin can be lost to
// buffering when the process is torn down, and this evidence must not depend on flushing.
const probeSource = `
import { writeFileSync } from "node:fs"
export const name = "t48-drive-probe"
export const inject = ["agents", "tools"]
export async function apply(ctx) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const report = { phase: "started", liveAgents: 0, members: [] }
  const write = (extra = {}) => { try { writeFileSync(${JSON.stringify(reportFile)}, JSON.stringify({ ...report, ...extra }, null, 2)) } catch {} }
  write()
  for (let round = 0; round < 45; round += 1) {
    await sleep(1000)
    const list = typeof ctx.agents?.list === "function" ? ctx.agents.list() : []
    report.liveAgents = list.length
    const members = []
    for (const agent of list) {
      const entry = { id: agent.id, status: agent.status, hasSession: agent.session !== undefined, runMaintenance: typeof agent.runMaintenance }
      try {
        const scoped = agent.ctx?.get?.("compaction")
        entry.scopedEngineType = scoped === undefined ? "undefined" : typeof scoped
        entry.compactNowType = typeof scoped?.compactNow
        if (typeof scoped?.compactNow === "function") {
          const result = await scoped.compactNow(agent, undefined)
          entry.compactNowAnswer = result === null ? "null" : "object"
        }
      } catch (error) { entry.driveError = String(error?.message ?? error) }
      try {
        const session = agent.session
        entry.sessionKeys = Object.keys(session ?? {}).slice(0, 30)
        entry.logPresent = session?.log !== undefined
        entry.eventsSnapshotPresent = session?.eventsSnapshot !== undefined
        if (typeof session?.eventsSnapshot === "function") {
          const snap = await session.eventsSnapshot()
          entry.eventsSnapshotEntries = Array.isArray(snap) ? snap.length : typeof snap
        } else if (Array.isArray(session?.eventsSnapshot)) {
          entry.eventsSnapshotEntries = session.eventsSnapshot.length
        }
        if (typeof session?.log === "function") {
          const tail = await session.log({ limit: 5 })
          entry.logEntries = Array.isArray(tail) ? tail.length : typeof tail
        } else if (typeof session?.log?.read === "function") {
          const tail = await session.log.read({ limit: 5 })
          entry.logEntries = Array.isArray(tail) ? tail.length : typeof tail
        } else if (Array.isArray(session?.log)) {
          entry.logEntries = session.log.length
        }
      } catch (error) { entry.observabilityError = String(error?.message ?? error) }
      members.push(entry)
    }
    report.members = members
    write()
  }
}
`
const probeFile = join(outDir, `drive-probe-${ts}.mjs`)
writeFileSync(probeFile, probeSource)
const probePatch = join(outDir, `drive-probe-${ts}.yml`)
writeFileSync(probePatch, "- insert:\n    - id: t48-drive-probe\n      name: " + JSON.stringify(probeFile) + "\n")

const sandbox = mkdtempSync(join(tmpdir(), "mpd-t48-drive-"))
const home = join(sandbox, "home")
const userHome = join(sandbox, "userhome")
const workspace = join(sandbox, "ws")
const profile = join(home, "profiles", "w")
for (const dir of [profile, userHome, workspace]) mkdirSync(dir, { recursive: true })
writeFileSync(join(home, ".credentials.yaml"), readFileSync(join(homedir(), ".dsh", ".credentials.yaml")), { mode: 0o600 })
writeFileSync(join(profile, "package.json"), JSON.stringify({
  name: "dsh-profile-w", private: true, dependencies: {},
  dsh: { profile: { bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"] } },
}, null, 2) + "\n")
const env = { ...process.env, DSH_HOME: home, HOME: userHome }
const install = spawnSync("dsh", ["plugin", "--profile", "w", "add", "--store-dir", join(sandbox, "pnpm-store"), repoRoot], { env, cwd: sandbox, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 300_000 })
// NO extra bundle patch here: the INSTALLED bundle (dsh plugin add, above) already composes
// its own rows and resolves its baseUrl-relative paths. Mounting the raw
// packages/mpd-bundle/cordis.patch.yml as an overlay BREAKS those expressions (measured:
// "plugin tree failed to load" + "failed to apply loader entry"), which is why the QA scripts
// always drive the installed bundle instead.

const logFile = join(outDir, `boot-${ts}.log`)
const fd = openSync(logFile, "w")
const child = spawn("dsh", ["--profile", "w", "--patch", probePatch, "--port", String(PORT), "--no-open"], { env, cwd: workspace, detached: false, stdio: ["ignore", fd, fd] })

let served = false
for (let i = 0; i < 60 && !served; i += 1) {
  await new Promise((r) => setTimeout(r, 1000))
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/`, { signal: AbortSignal.timeout(3000) })
    if (res.status === 200 || res.status === 302 || res.status === 401) served = true
  } catch { /* not up yet */ }
}

let sessionResult = null
if (served) {
  const boot = readFileSync(logFile, "utf8")
  const token = (/token=([A-Za-z0-9]+)/.exec(boot) ?? [])[1] ?? ""
  let cookie = ""
  if (token !== "") {
    const auth = await fetch(`http://127.0.0.1:${PORT}/?token=${token}`, { redirect: "manual" })
    cookie = (auth.headers.getSetCookie?.() ?? []).map((v) => v.split(";")[0]).join("; ")
  }
  const response = await fetch(`http://127.0.0.1:${PORT}/api/session/create`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie === "" ? {} : { cookie }) },
    body: JSON.stringify({
      type: "client-request", rpcId: `t48-${Date.now()}`, method: "session/create",
      payload: { args: { request: { cwd: workspace, agentPreset: "mpd" } } },
    }),
    signal: AbortSignal.timeout(60_000),
  }).catch((error) => ({ status: 0, json: async () => ({ transport: String(error?.message ?? error) }) }))
  const envelope = await response.json().catch(() => ({}))
  sessionResult = { httpStatus: response.status, result: envelope?.result ?? null, error: envelope?.error ?? null, transport: envelope?.transport ?? null }
}
await new Promise((r) => setTimeout(r, 25_000))
child.kill("SIGTERM")
await new Promise((r) => setTimeout(r, 1500))
closeSync(fd)

const bootText = existsSync(logFile) ? readFileSync(logFile, "utf8") : ""
const tokenFound = /token=([A-Za-z0-9_-]+)/.exec(bootText) !== null
const report = existsSync(reportFile) ? JSON.parse(readFileSync(reportFile, "utf8")) : { phase: "absent" }
const payload = {
  task: "t48",
  probe: "compaction engine resolution from the agent's OWN scoped context + observability entry points, against a REAL session",
  whatThisProves: [
    "the drive path is reachable: the engine resolves from the agent's own scoped context and answers instead of throwing",
    "a null answer means 'no safely compactable range' — a recorded fact, not an error",
    "the observability entry points (session.log / eventsSnapshot) are readable on a live Agent",
  ],
  whatThisDoesNotProve: [
    "a NON-NULL compaction and the durable compaction/start + compaction/end event pair: both need session CONTENT, which needs a provider key this environment does not have",
  ],
  credentialBoundary: {
    deepseekApiKeySet: process.env.DEEPSEEK_API_KEY !== undefined && process.env.DEEPSEEK_API_KEY !== "",
    note: "recorded so the limit is auditable rather than asserted; the credentialed layer is owed to a later slot",
  },
  boot: {
    served,
    installExit: install.status,
    tokenFound,
    mpdPresetMounted: /PRESET_MPD=ok|preset "mpd"/.test(bootText) || bootText.includes("mpd"),
    crashSignatures: ["unsupported JSON schema", "JsonSchemaError", "plugin tree failed to load", "failed to apply loader entry"].filter((s) => bootText.includes(s)),
    mpdTeamCompactPending: bootText.includes("mpd-team-compact-plugin") && /mpd-team-compact-plugin.*pending/.test(bootText),
  },
  sessionCreate: sessionResult,
  report,
}
writeFileSync(join(outDir, `result-${ts}.json`), JSON.stringify(payload, null, 2) + "\n")
console.log(JSON.stringify(payload, null, 1).slice(0, 2600))
rmSync(sandbox, { recursive: true, force: true })
