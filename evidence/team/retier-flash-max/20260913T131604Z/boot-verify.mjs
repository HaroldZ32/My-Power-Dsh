// Isolated-boot lane (AGENTS.md §4 MOUNT gate): boot the REAL bundle in a sandbox
// that has the identical patch row set, reload the agent-teams row from the patch
// file, mount a probe row, and let the probe resolve the member routes through the
// real harness `llm` service. Nothing here touches the real ~/.dsh.
import { spawn } from "node:child_process"
import { cpSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, symlinkSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..")
const OUT = dirname(fileURLToPath(import.meta.url))
const PORT = 4443
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// The real row config, taken verbatim from the bundle patch (bun parses YAML).
const layers = Bun.YAML.parse(readFileSync(join(ROOT, "packages", "mpd-bundle", "cordis.patch.yml"), "utf8"))
const rows = (Array.isArray(layers) ? layers : [layers]).flatMap((l) => [...(l?.resolve ?? []), ...(l?.insert ?? [])])
const agentTeamsRow = rows.find((r) => r?.id === "agent-teams")
if (agentTeamsRow === undefined) throw new Error("agent-teams row missing from the patch")

const sandbox = mkdtempSync(join(tmpdir(), "mpd-retier-"))
const home = join(sandbox, "home")
const userHome = join(sandbox, "userhome")
const ws = join(sandbox, "ws")
const profile = join(home, "profiles", "w")
mkdirSync(join(profile, "node_modules", "@mpd-dsh"), { recursive: true })
mkdirSync(userHome, { recursive: true })
mkdirSync(ws, { recursive: true })
const creds = join(homedir(), ".dsh", ".credentials.yaml")
if (existsSync(creds)) cpSync(creds, join(home, ".credentials.yaml"))
const settings = join(homedir(), ".dsh", "settings.yaml")
if (existsSync(settings)) cpSync(settings, join(home, "settings.yaml"))
// A checkout install IS a link: node_modules/@mpd-dsh/mpd -> the repo.
symlinkSync(ROOT, join(profile, "node_modules", "@mpd-dsh", "mpd"), "dir")
writeFileSync(join(profile, "package.json"), JSON.stringify({
  name: "dsh-profile-w", private: true, dependencies: {},
  dsh: { profile: { bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "@mpd-dsh/mpd"] } },
}, null, 2))

// The overlay: the affected agent-teams row re-stated from the patch (id-target),
// plus the probe row. Everything else comes from the bundle's own patch layer.
const overlay = join(sandbox, "overlay.yml")
writeFileSync(overlay, [
  "- id: agent-teams",
  "  name: '@mpd-dsh/mpd/packages/mpd-agent-teams-plugin/lib/index.js'",
  "  config: " + JSON.stringify(agentTeamsRow.config),
  "- insert:",
  "    - id: retier-probe",
  "      name: " + JSON.stringify(join(OUT, "probe.mjs")),
  "",
].join("\n"))

if (join(home).startsWith(join(homedir(), ".dsh"))) throw new Error("isolation assertion: DSH_HOME points at the real home")

// The probe reads the row config from here (an env var, not ctx.config).
const rowConfigPath = join(sandbox, "agent-teams-row.json")
writeFileSync(rowConfigPath, JSON.stringify(agentTeamsRow.config))

const logPath = join(OUT, "boot.log")
const fd = openSync(logPath, "w")
const child = spawn("dsh", ["--profile", "w", "--patch", overlay, "--port", String(PORT), "--no-open"], {
  env: { ...process.env, DSH_HOME: home, HOME: userHome, MPD_RETIER_ROW_CONFIG: rowConfigPath },
  cwd: ws,
  stdio: ["ignore", fd, fd],
})
const readLog = () => { try { return readFileSync(logPath, "utf8") } catch { return "" } }
const deadline = Date.now() + 120000
let ready = false
while (Date.now() < deadline) {
  await sleep(2000)
  if (/\[retier-probe\] PROBE_DONE/.test(readLog()) || /\[retier-probe\] PROBE_ERROR/.test(readLog())) { ready = true; break }
}
await sleep(1500)
try { child.kill("SIGTERM") } catch { /* gone */ }
await sleep(1500)
try { child.kill("SIGKILL") } catch { /* gone */ }

const log = readLog()
const FAILURE_SIGNATURES = ["invalid config", "failed to apply loader entry", "agent-preset/invalid", "did not activate", "unsupported JSON schema"]
const crashes = FAILURE_SIGNATURES.filter((s) => log.includes(s))
const members = [...log.matchAll(/\[retier-probe\] MEMBER=(.+?) model=(\S+) effort=(\S+) fallback=(\S+)/g)]
  .map(([, name, model, effort, fallback]) => ({ name, model, effort, fallback }))
const resolved = [...log.matchAll(/\[retier-probe\] RESOLVE=(\S+) (ok|FAIL) (.*)/g)].map(([, label, status, rest]) => ({ label, status, rest: rest.trim() }))
const result = {
  at: new Date().toISOString(),
  sandbox: { home, ws, port: PORT, isolated: !home.startsWith(join(homedir(), ".dsh")) },
  boot: { probeDone: /PROBE_DONE/.test(log), probeError: (/PROBE_ERROR=(.*)/.exec(log)?.[1] ?? null), crashSignatures: crashes, logBytes: log.length },
  profileMembers: members,
  resolveLane: resolved,
  negativeControl: (/NEGATIVE_CONTROL=(.*)/.exec(log)?.[1] ?? null),
}
writeFileSync(join(OUT, "boot-result.json"), JSON.stringify(result, null, 2))

const fail = []
if (!result.boot.probeDone) fail.push("probe did not finish")
if (result.boot.probeError !== null) fail.push("probe error: " + result.boot.probeError)
if (crashes.length > 0) fail.push("crash signatures: " + crashes.join(","))
if (members.length !== 11) fail.push("profile members in boot: " + members.length)
for (const name of ["Architect", "Planner", "Reviewer", "Lead", "Senior Engineer"]) {
  const m = members.find((x) => x.name === name)
  if (m === undefined) { fail.push("member " + name + " missing"); continue }
  if (m.model !== "deepseek-v4-flash") fail.push(name + " model=" + m.model)
  if (m.effort !== "max") fail.push(name + " effort=" + m.effort)
}
for (const lane of resolved) if (lane.status !== "ok") fail.push("resolve " + lane.label + " failed: " + lane.rest)
if (!/^rejected/.test(String(result.negativeControl))) fail.push("negative control did not reject: " + String(result.negativeControl))
console.log("boot lane: members=" + members.length + " resolved=" + resolved.length + " crashes=" + crashes.length)
if (fail.length > 0) { console.error("FAIL:\n - " + fail.join("\n - ")); process.exit(1) }
console.log("OK: the real boot loaded the retiered row and resolved flash+max member routes")
