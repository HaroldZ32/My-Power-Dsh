#!/usr/bin/env node
// Case tool-output-validation (C5/C7 defects): prove mpd_config_get and
// mpd_boulder_status return HOST-VALIDATED tool results in a real headless run.
// Defect 1: mpd_config_get(key) returned `value: undefined`, which the host
// rejected with "value is not lossless JSON".
// Defect 2: mpd_boulder_status returned `planProgress: null` against schema
// `type: object`, which the host rejected with '"value.planProgress" must be an object'.
// This case asserts neither error string appears and the tool's render text does.
// Isolated DSH_HOME; evidence -> evidence/fix/<slug>/<ts>/.
// --self-test is offline (bundle rows + dist symbols + unit suites).
// --tool config|boulder selects one probe (default: both, sequentially).
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir, homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))

const PROBES = {
  config: {
    slug: "config-get-lossless",
    task: "Call mpd_config_get with key 'memory.vcs' and paste the exact tool result lines. Then call mpd_config_get with no arguments and paste the exact tool result lines.",
    expect: ["memory.vcs"],
    forbid: ["not lossless JSON", "invalid output"],
  },
  boulder: {
    slug: "boulder-status-planprogress",
    task: "Call mpd_boulder_status with no arguments and paste the exact tool result lines.",
    expect: [".mpd/boulder.json"],
    forbid: ["must be an object", "invalid output"],
  },
}

function selfTest() {
  const bundle = readFileSync(join(repoRoot, "packages", "mpd-bundle", "cordis.patch.yml"), "utf8")
  for (const id of ["mpd-config", "mpd-boulder"]) {
    if (!bundle.includes(id)) { console.error("[tool-output-validation self-test] FAIL: bundle row " + id); process.exit(1) }
  }
  const cfgDist = readFileSync(join(repoRoot, "packages", "mpd-config-plugin", "dist", "index.js"), "utf8")
  const blDist = readFileSync(join(repoRoot, "packages", "mpd-boulder-plugin", "dist", "index.js"), "utf8")
  for (const s of ["mpd_config_get", "mpd_config_reload"]) {
    if (!cfgDist.includes(s)) { console.error("[tool-output-validation self-test] FAIL: dist symbol " + s); process.exit(1) }
  }
  for (const s of ["mpd_boulder_status", "mpd_boulder_start"]) {
    if (!blDist.includes(s)) { console.error("[tool-output-validation self-test] FAIL: dist symbol " + s); process.exit(1) }
  }
  for (const pkg of ["mpd-config-plugin", "mpd-boulder-plugin"]) {
    const r = spawnSync("bun", ["test"], { cwd: join(repoRoot, "packages", pkg), encoding: "utf8", timeout: 120000 })
    if (r.status !== 0) { console.error("[tool-output-validation self-test] FAIL: unit suite " + pkg + "\n" + r.stdout + r.stderr); process.exit(1) }
  }
  console.log("[tool-output-validation self-test] ok: bundle rows + dist symbols + unit suites verified")
}

function runProbe(probe, sandbox, ws, env) {
  const outDir = join(repoRoot, "evidence", "fix", probe.slug, new Date().toISOString().replaceAll(":", "-"))
  mkdirSync(outDir, { recursive: true })
  const run = spawnSync("dsh", ["--profile", "mpd-headless", probe.task], { env, cwd: ws, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 600000, stdio: ["ignore", "pipe", "pipe"] })
  const out = (run.stdout || "") + (run.stderr || "")
  const steps = {
    live: { ok: run.status === 0, exit: run.status },
    expect: { ok: probe.expect.every((s) => out.includes(s)), hits: probe.expect.filter((s) => out.includes(s)) },
    forbid: { ok: !probe.forbid.some((s) => out.includes(s)), hits: probe.forbid.filter((s) => out.includes(s)) },
  }
  const ok = Object.values(steps).every((s) => s.ok)
  writeFileSync(join(outDir, "result.json"), JSON.stringify({ ok, sandbox, steps }, null, 2))
  writeFileSync(join(outDir, "output.log"), out.slice(0, 40000))
  console.log("[tool-output-validation] " + probe.slug + ": ok=" + ok + " -> " + outDir)
  for (const [k, v] of Object.entries(steps)) console.log("  " + k + ": " + JSON.stringify(v).slice(0, 200))
  return ok
}

async function runReal() {
  const creds = join(homedir(), ".dsh", ".credentials.yaml")
  if (!existsSync(creds)) { console.error("[tool-output-validation] missing credentials"); process.exit(1) }
  const sandbox = mkdtempSync(join(tmpdir(), "mpd-tov-"))
  cpSync(creds, join(sandbox, ".credentials.yaml"))
  // AGENTS.md §7 — a live case must ALSO stage settings.yaml when present: this home's
// model chain is configured through gateway providers (llm-pi-ai), so without it the
// sandbox falls back to the base `deepseek-official` route and the boot dies with
// MISSING_CREDENTIAL (measured 2026-09-14: 8 live cases red for exactly this; their
// `--self-test` stayed green because it never boots). Same idiom as the cases that
// already passed.
  const qaSettings = join(homedir(), ".dsh", "settings.yaml")
  if (existsSync(qaSettings)) cpSync(qaSettings, join(sandbox, "settings.yaml"))
  const ws = join(sandbox, "ws")
  mkdirSync(ws, { recursive: true })
  const env = { ...process.env, DSH_HOME: sandbox }
  const inst = spawnSync(process.execPath, [join(repoRoot, "scripts", "install-profile.mjs"), "--yes", "--dsh-home", sandbox, "--profile", "mpd-headless", "--skip-toolchain"], { env, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 600000 })
  if (inst.status !== 0) { console.error("[tool-output-validation] FAIL: install-profile\n" + (inst.stdout || "") + (inst.stderr || "")); process.exit(1) }
  const argv = process.argv.slice(2)
  const idx = argv.indexOf("--tool")
  const tool = idx >= 0 ? argv[idx + 1] : "all"
  const probes = tool === "all" ? Object.values(PROBES) : [PROBES[tool]]
  let allOk = true
  for (const p of probes) allOk = runProbe(p, sandbox, ws, env) && allOk
  if (!allOk) process.exit(1)
  console.log("[tool-output-validation] PASS")
}

if (process.argv.includes("--self-test")) selfTest()
else runReal()
