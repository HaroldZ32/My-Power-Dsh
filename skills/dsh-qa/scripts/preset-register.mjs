#!/usr/bin/env node
// Case preset-register: under an isolated DSH_HOME, copy the omo presets into the sandbox user root .agent-presets,
// then after a real boot assert via the probe plugin that list()/resolve() all pass and nothing is broken.
// --self-test is the offline self-test.
import { cpSync, existsSync, mkdtempSync, mkdirSync, openSync, readFileSync, writeFileSync, closeSync } from "node:fs"
import { tmpdir, homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
const FIXTURE_LIST = "mpd-oracle,mpd-librarian,mpd-prometheus,mpd-hephaestus,mpd-sisyphus,mpd-atlas,mpd-explore,mpd-metis,mpd-momus,mpd-multimodal-looker,mpd-sisyphus-junior"

function selfTest() {
  const ids = FIXTURE_LIST.split(",")
  if (ids.length !== 11 || !ids.every((s) => /^mpd-[a-z-]+$/.test(s))) { console.error("[preset-register self-test] FAIL"); process.exit(1) }
  console.log("[preset-register self-test] ok: id grammar verified on fixture")
}

function runReal() {
  const creds = join(homedir(), ".dsh", ".credentials.yaml")
  if (!existsSync(creds)) { console.error("[preset-register] missing credentials"); process.exit(1) }
  const sandbox = mkdtempSync(join(tmpdir(), "mpd-dsh-qa-"))
  cpSync(creds, join(sandbox, ".credentials.yaml"))
  const userPresets = join(sandbox, ".agent-presets")
  mkdirSync(userPresets, { recursive: true })
  for (const id of FIXTURE_LIST.split(",")) {
    cpSync(join(repoRoot, "packages/mpd-presets-plugin/presets", id), join(userPresets, id), { recursive: true })
  }
  const logFile = join(sandbox, "run.log")
  const fd = openSync(logFile, "w")
  const env = { ...process.env, DSH_HOME: sandbox }
  if (env.DSH_HOME !== sandbox) { console.error("[preset-register] isolation assertion failed"); process.exit(1) }
  const args = ["--profile", "headless",
    "--patch", join(repoRoot, "packages/mpd-bundle/cordis.patch.yml"),
    "--patch", join(repoRoot, "tests/overlays/agent-presets-headless.yml"),
    "--patch", join(repoRoot, "tests/overlays/preset-probe.yml"), "ok"]
  const run = runDsh(args, env, fd)
  closeSync(fd)
  const out = readFileSync(logFile, "utf8")
  const ok = run?.status === 0 && /preset-probe\] PASS/.test(out) && /RESOLVED=\{\"mpd-oracle\":true/.test(out) && /LIST=.*mpd-(oracle|librarian|prometheus|hephaestus)/.test(out)
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
