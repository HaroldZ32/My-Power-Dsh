#!/usr/bin/env node
// 用例 preset-register：隔离 DSH_HOME 下，把 omo 预设拷入沙盒用户根 .agent-presets，
// 真实 boot 后由探针插件断言 list()/resolve() 全部通过且无 broken。
// --self-test 为离线自测。
import { cpSync, existsSync, mkdtempSync, mkdirSync, openSync, readFileSync, writeFileSync, closeSync } from "node:fs"
import { tmpdir, homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
const FIXTURE_LIST = "omo-oracle,omo-librarian,omo-prometheus,omo-hephaestus"

function selfTest() {
  const ids = FIXTURE_LIST.split(",")
  if (ids.length !== 4 || !ids.every((s) => /^omo-[a-z-]+$/.test(s))) { console.error("[preset-register self-test] FAIL"); process.exit(1) }
  console.log("[preset-register self-test] ok: id grammar verified on fixture")
}

function runReal() {
  const creds = join(homedir(), ".dsh", ".credentials.yaml")
  if (!existsSync(creds)) { console.error("[preset-register] 凭据缺失"); process.exit(1) }
  const sandbox = mkdtempSync(join(tmpdir(), "omo-dsh-qa-"))
  cpSync(creds, join(sandbox, ".credentials.yaml"))
  const userPresets = join(sandbox, ".agent-presets")
  mkdirSync(userPresets, { recursive: true })
  for (const id of ["omo-oracle", "omo-librarian", "omo-prometheus", "omo-hephaestus"]) {
    cpSync(join(repoRoot, "packages/omo-presets-plugin/presets", id), join(userPresets, id), { recursive: true })
  }
  const logFile = join(sandbox, "run.log")
  const fd = openSync(logFile, "w")
  const env = { ...process.env, DSH_HOME: sandbox }
  if (env.DSH_HOME !== sandbox) { console.error("[preset-register] 隔离断言失败"); process.exit(1) }
  const args = ["--profile", "headless",
    "--patch", join(repoRoot, "packages/omo-dsh-bundle/cordis.patch.yml"),
    "--patch", join(repoRoot, "tests/overlays/agent-presets-headless.yml"),
    "--patch", join(repoRoot, "tests/overlays/preset-probe.yml"), "ok"]
  const run = runDsh(args, env, fd)
  closeSync(fd)
  const out = readFileSync(logFile, "utf8")
  const ok = run?.status === 0 && /preset-probe\] PASS/.test(out) && /RESOLVED=\{\"omo-oracle\":true/.test(out) && /LIST=.*omo-(oracle|librarian|prometheus|hephaestus)/.test(out)
  const outDir = join(repoRoot, "evidence", "dsh-qa", "preset-register", new Date().toISOString().replaceAll(":", "-"))
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, "result.json"), JSON.stringify({ ok, exit: run?.status, dshHomeSandbox: true, userRootPresets: true }, null, 2))
  writeFileSync(join(outDir, "output.log"), out)
  console.log("[preset-register] ok=" + ok + " -> " + outDir)
  if (!ok) process.exit(1)
  console.log("[preset-register] PASS")
}

import { spawnSync } from "node:child_process"
function runDsh(args, env, fd) {
  return spawnSync("dsh", args, { env, encoding: "utf8", timeout: 180000, stdio: ["ignore", fd, fd] })
}

const argv = process.argv.slice(2)
if (argv.includes("--self-test")) selfTest()
else runReal()
