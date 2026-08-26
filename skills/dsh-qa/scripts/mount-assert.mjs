#!/usr/bin/env node
// 用例 mount-assert：隔离 DSH_HOME 下用真实 dsh --dump-config 断言插件行已挂载。
// --self-test 为离线自测（fixture 文本，无网络、无真实 API）。
import { execFileSync, spawnSync } from "node:child_process"
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url))))) // scripts/<domain>/<slug>/<file> → 仓库根
const FIXTURE = `# == base
- id: llm
  name: '@deepseek-ai/dsh-llm'
- id: tool-bash
  name: '@deepseek-ai/dsh-tool-bash'
`

function assertExpectations(text, expectations) {
  const missing = expectations.filter((e) => !text.includes(e))
  return { ok: missing.length === 0, missing }
}

function selfTest() {
  const present = assertExpectations(FIXTURE, ["name: '@deepseek-ai/dsh-llm'"])
  const absent = assertExpectations(FIXTURE, ["name: '@deepseek-ai/dsh-llm-deepseek'"])
  if (!present.ok) { console.error("[mount-assert self-test] FAIL: presence detection broken:", present.missing); process.exit(1) }
  if (absent.ok) { console.error("[mount-assert self-test] FAIL: absence detection broken"); process.exit(1) }
  console.log("[mount-assert self-test] ok: presence/absence detection verified on fixture")
}

function main() {
  const args = process.argv.slice(2)
  if (args.includes("--self-test")) { selfTest(); return }
  const expect = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a.startsWith("--expect=")) expect.push(a.slice("--expect=".length))
    else if (a === "--expect" && i + 1 < args.length) expect.push(args[++i])
  }
  if (expect.length === 0) { console.error("usage: mount-assert.mjs --expect=<substring> [--expect=...] | --self-test"); process.exit(2) }

  const sandbox = mkdtempSync(join(tmpdir(), "omo-dsh-qa-"))
  const env = { ...process.env, DSH_HOME: sandbox }
  if (!env.DSH_HOME.startsWith(sandbox)) { console.error("[mount-assert] 隔离断言失败：DSH_HOME 未指向临时目录"); process.exit(1) }

  const run = spawnSync("dsh", ["--profile", "headless", "--dump-config"], { env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  if (run.status !== 0) {
    console.error("[mount-assert] dsh --dump-config failed:", run.stderr?.slice(0, 2000))
    process.exit(1)
  }
  const dump = run.stdout
  const result = assertExpectations(dump, expect)

  const outDir = join(repoRoot, "evidence", "dsh-qa", "mount-assert", new Date().toISOString().replaceAll(":", "-"))
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, "result.json"), JSON.stringify({ ok: result.ok, missing: result.missing, expectations: expect, dshHomeSandbox: true, dumpBytes: dump.length }, null, 2))
  writeFileSync(join(outDir, "dump.txt"), dump)
  console.log("[mount-assert] evidence ->", outDir)
  if (!result.ok) { console.error("[mount-assert] FAIL missing:", result.missing); process.exit(1) }
  console.log("[mount-assert] PASS:", expect.length, "expectation(s) satisfied")
  rmSync(sandbox, { recursive: true, force: true })
}

main()
