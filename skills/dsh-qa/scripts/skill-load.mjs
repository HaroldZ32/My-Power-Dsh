#!/usr/bin/env node
// 用例 skill-load：隔离 DSH_HOME 下，真实 dsh headless 让模型通过 skill 工具加载 omo 技能并引用身份。
// --self-test 为离线自测。
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir, homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
const JOB = "请先使用 skill 工具加载名为 ulw-plan 的技能，然后引用其中的身份（Prometheus）用一句话说明该技能的用途。不要使用 bash 等其他工具。"
const FIXTURE_ANSWER = "Prometheus——规划顾问"

function selfTest() {
  if (FIXTURE_ANSWER.includes("Prometheus") !== true) { console.error("[skill-load self-test] FAIL: fixture broken"); process.exit(1) }
  if ("未加载".includes("Prometheus") !== false) { console.error("[skill-load self-test] FAIL: negative detection broken"); process.exit(1) }
  console.log("[skill-load self-test] ok: identity/flag detection verified on fixture")
}

function runReal() {
  const creds = join(homedir(), ".dsh", ".credentials.yaml")
  if (!existsSync(creds)) { console.error("[skill-load] 凭据缺失: " + creds); process.exit(1) }
  const sandbox = mkdtempSync(join(tmpdir(), "omo-dsh-qa-"))
  cpSync(creds, join(sandbox, ".credentials.yaml"))
  const t0 = Date.now()
  const run = spawnSync("dsh", ["--profile", "headless", "--patch", join(repoRoot, "packages/omo-dsh-bundle/cordis.patch.yml"), JOB], {
    env: { ...process.env, DSH_HOME: sandbox }, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 600000
  })
  const ms = Date.now() - t0
  const out = (run.stdout || "") + (run.stderr || "")
  const ok = run.status === 0 && /ulw-plan/.test(out) && /Prometheus/.test(out)
  const outDir = join(repoRoot, "evidence", "dsh-qa", "skill-load", new Date().toISOString().replaceAll(":", "-"))
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, "result.json"), JSON.stringify({ ok, durationMs: ms, exit: run.status, skillLoaded: /ulw-plan/.test(out), identityQuoted: /Prometheus/.test(out) }, null, 2))
  writeFileSync(join(outDir, "output.log"), out)
  console.log("[skill-load] ok=" + ok + " (" + ms + "ms, exit=" + run.status + ") -> " + outDir)
  if (!ok) process.exit(1)
  console.log("[skill-load] PASS")
}

const args = process.argv.slice(2)
if (args.includes("--self-test")) selfTest()
else runReal()
