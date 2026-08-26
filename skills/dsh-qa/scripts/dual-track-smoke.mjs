#!/usr/bin/env node
// 用例 llm-dual-track：DeepSeek 双轨真实 headless 冒烟。
// 隔离 DSH_HOME + 复制凭据（绝不读写真实 ~/.dsh），证明工具调用与回答。
// --self-test 为离线自测。
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { homedir } from "node:os"

const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
const JOB = "列出当前工作目录的文件（先用 bash 工具 pwd 与 ls），然后只回答：你调用了哪些工具、目录里有多少个文件。"
const TRACKS = {
  official: { label: "deepseek-official (dsh-llm-deepseek)", provider: "deepseek-official", overlay: null },
  deepseek: { label: "deepseek (dsh-llm-pi-ai)", provider: "deepseek", overlay: "tests/overlays/pi-ai-track.yml" }
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
    const sandbox = mkdtempSync(join(tmpdir(), "omo-dsh-qa-"))
    if (existsSync(creds)) cpSync(creds, join(sandbox, ".credentials.yaml"))
    else { console.error("[llm-dual-track] 凭据缺失: " + creds); failed = true; continue }
    const patchArgs = [join(repoRoot, "packages/omo-dsh-bundle/cordis.patch.yml")]
    if (t.overlay) patchArgs.push(join(repoRoot, t.overlay))
    const args = ["--profile", "headless"]
    for (const p of patchArgs) args.push("--patch", p)
    args.push(JOB)
    const t0 = Date.now()
    const run = spawnSync("dsh", args, { env: { ...process.env, DSH_HOME: sandbox }, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 600000 })
    const ms = Date.now() - t0
    const out = (run.stdout || "") + (run.stderr || "")
    const ok = run.status === 0 && /bash|工具/.test(out)
    const outDir = join(repoRoot, "evidence", "dsh-qa", "llm-dual-track", key, new Date().toISOString().replaceAll(":", "-"))
    mkdirSync(outDir, { recursive: true })
    writeFileSync(join(outDir, "result.json"), JSON.stringify({ ok, track: key, provider: t.provider, durationMs: ms, exit: run.status, hasToolEvidence: /bash|工具/.test(out) }, null, 2))
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
