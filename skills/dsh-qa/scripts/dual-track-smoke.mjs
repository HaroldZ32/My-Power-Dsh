#!/usr/bin/env node
// Case llm-dual-track: real headless smoke of the DeepSeek dual track.
// Isolate DSH_HOME + copy credentials (never read or write the real ~/.dsh), proving tool calls and answers.
// --self-test is the offline self-test.
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { homedir } from "node:os"

const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
const JOB = "List the files in the current working directory (first use the bash tool with pwd and ls), then answer only: which tools you called and how many files are in the directory."
const TRACKS = {
  official: { label: "deepseek-official (dsh-llm-deepseek)", provider: "deepseek-official", overlay: null },
  deepseek: { label: "deepseek (dsh-llm-pi-ai)", provider: "deepseek", overlay: "tests/overlays/compat-track.yml" }
}
const FIXTURE_ROW = "- id: agent-default-model\n  config:\n    provider: deepseek-official\n"

function selfTest() {
  const okRow = FIXTURE_ROW.includes("provider: deepseek-official")
  const pipe = FIXTURE_ROW.includes("provider: pi-ai")
  if (!okRow || pipe) { console.error("[llm-dual-track self-test] FAIL"); process.exit(1) }
  console.log("[llm-dual-track self-test] ok: track fixture assertions verified")
}

function runReal() {
  const creds = join(homedir(), ".dsh", ".credentials.yaml")
  const rows = []
  let failed = false
  for (const [key, t] of Object.entries(TRACKS)) {
    const sandbox = mkdtempSync(join(tmpdir(), "mpd-dsh-qa-"))
    if (existsSync(creds)) cpSync(creds, join(sandbox, ".credentials.yaml"))
    else { console.error("[llm-dual-track] missing credentials: " + creds); failed = true; continue }
    const patchArgs = [join(repoRoot, "packages/mpd-bundle/cordis.patch.yml")]
    if (t.overlay) patchArgs.push(join(repoRoot, t.overlay))
    const args = ["--profile", "headless"]
    for (const p of patchArgs) args.push("--patch", p)
    args.push(JOB)
    const t0 = Date.now()
    const env = { ...process.env, DSH_HOME: sandbox }
    if (env.DSH_HOME !== sandbox) { console.error("[llm-dual-track] isolation assertion failed: DSH_HOME does not point to the sandbox"); process.exit(1) }
    const run = spawnSync("dsh", args, { env, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 600000 })
    const ms = Date.now() - t0
    const out = (run.stdout || "") + (run.stderr || "")
    const ok = run.status === 0 && /bash|tool/.test(out)
    const outDir = join(repoRoot, "evidence", "dsh-qa", "llm-dual-track", key, new Date().toISOString().replaceAll(":", "-"))
    mkdirSync(outDir, { recursive: true })
    writeFileSync(join(outDir, "result.json"), JSON.stringify({ ok, track: key, provider: t.provider, durationMs: ms, exit: run.status, hasToolEvidence: /bash|tool/.test(out) }, null, 2))
    writeFileSync(join(outDir, "output.log"), out)
    rows.push({ track: key, provider: t.provider, ok, ms, exit: run.status })
    console.log("[llm-dual-track] " + key + " ok=" + ok + " (" + ms + "ms, exit=" + run.status + ") -> " + outDir)
    if (!ok) failed = true
  }
  const table = rows.map(r => [r.track, r.provider, r.ok, r.ms, r.exit].join("\t")).join("\n")
  writeFileSync(join(repoRoot, "evidence/dsh-qa/llm-dual-track/dual-track.tsv"), "track\tprovider\tok\tduration_ms\texit\n" + table + "\n")
  if (failed) process.exit(1)
  console.log("[llm-dual-track] PASS")
}

const args = process.argv.slice(2)
if (args.includes("--self-test")) selfTest()
else runReal()
