#!/usr/bin/env node
// Case memory-smoke (Plan C / C6): real headless run of the git-backed memory
// engine - mpd_memory_write -> commit -> mpd_memory_read -> reflection hint.
// Isolated DSH_HOME; evidence -> evidence/plan-c/c6-memory/<ts>/.
// --self-test is the offline self-test (unit suite + row assertions).
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs"
import { tmpdir, homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
const TASK = "Use mpd_memory_write to save one note titled 'qa-note' with content 'alpha beta gamma' and kind 'note'. Then use mpd_memory_read with query 'alpha' and report how many entries match. Then report mpd_memory_status."

function selfTest() {
  const bundle = readFileSync(join(repoRoot, "packages", "mpd-bundle", "cordis.patch.yml"), "utf8")
  if (!bundle.includes("mpd-memory")) { console.error("[memory-smoke self-test] FAIL: bundle row"); process.exit(1) }
  const dist = readFileSync(join(repoRoot, "packages", "mpd-memory-plugin", "dist", "index.js"), "utf8")
  for (const s of ["mpd_memory_write", "mpd_memory_read", "mpd_memory_reflect", "svnadmin"]) {
    if (!dist.includes(s)) { console.error("[memory-smoke self-test] FAIL: missing " + s); process.exit(1) }
  }
  const r = spawnSync("bun", ["test"], { cwd: join(repoRoot, "packages", "mpd-memory-plugin"), encoding: "utf8", timeout: 120000 })
  if (r.status !== 0) { console.error("[memory-smoke self-test] FAIL: unit suite"); process.exit(1) }
  console.log("[memory-smoke self-test] ok: bundle row + dist symbols + unit suite verified")
}

async function runReal() {
  const creds = join(homedir(), ".dsh", ".credentials.yaml")
  if (!existsSync(creds)) { console.error("[memory-smoke] missing credentials"); process.exit(1) }
  const ts = new Date().toISOString().replaceAll(":", "-")
  const outDir = join(repoRoot, "evidence", "plan-c", "c6-memory", ts)
  mkdirSync(outDir, { recursive: true })
  const sandbox = mkdtempSync(join(tmpdir(), "mpd-c6-"))
  cpSync(creds, join(sandbox, ".credentials.yaml"))
  const ws = join(sandbox, "ws")
  mkdirSync(ws, { recursive: true })
  const env = { ...process.env, DSH_HOME: sandbox }
  const steps = {}
  const inst = spawnSync(process.execPath, [join(repoRoot, "scripts", "install-profile.mjs"), "--yes", "--dsh-home", sandbox, "--profile", "omo-headless", "--skip-toolchain"], { env, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 600000 })
  steps.installer = { ok: inst.status === 0, exit: inst.status }
  const run = spawnSync("dsh", ["--profile", "omo-headless", TASK], { env, cwd: ws, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 600000, stdio: ["ignore", "pipe", "pipe"] })
  const out = (run.stdout || "") + (run.stderr || "")
  steps.live = { ok: run.status === 0, exit: run.status }
  const memRoot = join(ws, ".mpd", "memory", "agents")
  let entries = 0, repoOk = false, dueSeen = false
  if (existsSync(memRoot)) {
    for (const agent of readdirSync(memRoot)) {
      const memDir = join(memRoot, agent, "repo", "memory")
      if (existsSync(memDir)) entries += readdirSync(memDir).filter((f) => f.endsWith(".md")).length
      repoOk = repoOk || existsSync(join(memRoot, agent, "repo", ".git"))
      if (existsSync(join(memRoot, agent, "runtime", "reflection.json"))) {
        try { const r = JSON.parse(readFileSync(join(memRoot, agent, "runtime", "reflection.json"), "utf8")); dueSeen = dueSeen || r.steps >= 1 } catch { }
      }
    }
  }
  steps.memory = { ok: entries >= 1 && repoOk && dueSeen, entries, repoOk, dueSeen }
  const allOk = Object.values(steps).every((s) => s.ok)
  writeFileSync(join(outDir, "result.json"), JSON.stringify({ ok: allOk, sandbox, steps }, null, 2))
  writeFileSync(join(outDir, "output.log"), out)
  console.log("[memory-smoke] ok=" + allOk + " -> " + outDir)
  for (const [k, v] of Object.entries(steps)) console.log("  " + k + ": " + JSON.stringify(v).slice(0, 220))
  if (!allOk) process.exit(1)
  console.log("[memory-smoke] PASS")
}

const argv = process.argv.slice(2)
if (argv.includes("--self-test")) selfTest()
else runReal()
