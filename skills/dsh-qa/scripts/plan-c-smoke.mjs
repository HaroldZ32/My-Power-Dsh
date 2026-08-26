#!/usr/bin/env node
// Case plan-c-smoke (Plan C Wave A live proof): one real headless session
// exercising the C3/C5/C7 surfaces together —
//   mpd_config_get (mpd.jsonc layer), mpd_boulder_start/task_timer/complete
//   (boulder ledger), mpd_hashline_read/edit (anchored edit discipline).
// Isolated DSH_HOME; evidence -> evidence/plan-c/plan-c-smoke/<ts>/.
// --self-test is the offline self-test (rows + unit suites).
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir, homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
const PROMPT = [""].join("")

function selfTest() {
  const bundle = readFileSync(join(repoRoot, "packages", "mpd-bundle", "cordis.patch.yml"), "utf8")
  const installer = readFileSync(join(repoRoot, "scripts", "install-profile.mjs"), "utf8")
  for (const id of ["mpd-hashline", "mpd-boulder", "mpd-config"]) {
    if (!bundle.includes("id: " + id) || !installer.includes(id)) { console.error("[plan-c-smoke self-test] FAIL: missing row " + id); process.exit(1) }
  }
  const suites = [
    ["packages/mpd-hashline-plugin", "hashline"],
    ["packages/mpd-boulder-plugin", "boulder"],
    ["packages/mpd-config-plugin", "config"]
  ]
  for (const [pkg, label] of suites) {
    const r = spawnSync("bun", ["test"], { cwd: join(repoRoot, pkg), encoding: "utf8", timeout: 120000 })
    if (r.status !== 0 || !/\d+ pass/.test(r.stdout + r.stderr)) { console.error("[plan-c-smoke self-test] FAIL: unit suite " + label); process.exit(1) }
  }
  console.log("[plan-c-smoke self-test] ok: rows + unit suites verified")
}

async function runReal() {
  const creds = join(homedir(), ".dsh", ".credentials.yaml")
  if (!existsSync(creds)) { console.error("[plan-c-smoke] missing credentials"); process.exit(1) }
  const ts = new Date().toISOString().replaceAll(":", "-")
  const outDir = join(repoRoot, "evidence", "plan-c", "plan-c-smoke", ts)
  mkdirSync(outDir, { recursive: true })
  const sandbox = mkdtempSync(join(tmpdir(), "mpd-wa-"))
  cpSync(creds, join(sandbox, ".credentials.yaml"))
  const ws = join(sandbox, "ws")
  mkdirSync(ws, { recursive: true })
  const env = { ...process.env, DSH_HOME: sandbox }
  const steps = {}

  const inst = spawnSync(process.execPath, [join(repoRoot, "scripts", "install-profile.mjs"), "--yes", "--dsh-home", sandbox, "--profile", "mpd-headless", "--skip-toolchain"], { env, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 600000 })
  steps.installer = { ok: inst.status === 0, exit: inst.status }
  const patch = readFileSync(join(sandbox, "cordis.patch.yml"), "utf8")
  steps.rows = { ok: ["mpd-hashline", "mpd-boulder", "mpd-config"].every((id) => patch.includes(id)), patch: patch.includes("mpd-config") }

  const task = [
    "Plan C Wave A self-test:",
    "1) write .mpd/mpd.jsonc with { ulw: { maxRounds: 4 }, memory: { vcs: 'git' } } then call mpd_config_get with key 'memory.vcs' and report the value;",
    "2) create .mpd/plans/qa.md containing '# QA' and '## TODOs' with '- [ ] 1. First' and '- [x] 2. Second', call mpd_boulder_start on it, mpd_boulder_task_timer start/end for task '1', then mpd_boulder_complete;",
    "3) create note.txt with three lines 'first' 'second' 'third', call mpd_hashline_read, then mpd_hashline_edit to replace line 2 with 'second2', then read note.txt",
    "Report: the config value, the workId and status, and the final note.txt content."
  ].join(" ")

  const live = spawnSync("dsh", ["--profile", "mpd-headless", task], { env, cwd: ws, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 900000, stdio: ["ignore", "pipe", "pipe"] })
  const out = (live.stdout || "") + (live.stderr || "")
  steps.live = { ok: live.status === 0, exit: live.status }

  const boulderFile = join(ws, ".mpd", "boulder.json")
  let boulderOk = false, boulderWork = null
  if (existsSync(boulderFile)) {
    try {
      const b = JSON.parse(readFileSync(boulderFile, "utf8"))
      const work = b.works?.[b.active_work_id] ?? Object.values(b.works ?? {})[0]
      boulderOk = !!work && work.status === "completed"
      boulderWork = work ? { work_id: work.work_id, status: work.status, tasks: Object.keys(work.task_sessions ?? {}).length } : null
    } catch { /* keep false */ }
  }
  steps.boulder = { ok: boulderOk, boulderWork }

  const note = join(ws, "note.txt")
  const noteOk = existsSync(note) && readFileSync(note, "utf8").includes("second2")
  steps.hashline = { ok: noteOk, note: existsSync(note) ? readFileSync(note, "utf8") : null }

  const configOk = /(git|both|svn)/.test(out) && out.includes("memory.vcs")
  steps.config = { ok: configOk, sawConfig: /vcs/.test(out) }

  const allOk = Object.values(steps).every((s) => s.ok)
  writeFileSync(join(outDir, "result.json"), JSON.stringify({ ok: allOk, sandbox, steps }, null, 2))
  writeFileSync(join(outDir, "output.log"), out)
  console.log("[plan-c-smoke] ok=" + allOk + " -> " + outDir)
  for (const [k, v] of Object.entries(steps)) console.log("  " + k + ": " + JSON.stringify(v).slice(0, 250))
  if (!allOk) process.exit(1)
  console.log("[plan-c-smoke] PASS")
}

const argv = process.argv.slice(2)
if (argv.includes("--self-test")) selfTest()
else runReal()
