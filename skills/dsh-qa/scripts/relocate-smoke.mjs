#!/usr/bin/env node
// Case relocate-smoke (Plan D / P5): prove the STAGED bundle package installs and
// runs with ZERO references to any fixed checkout path (fully relocatable):
//   1) pack -> copy the staged package to an unrelated location;
//   2) npm-install it into an isolated profile (file: dependency, bundle reconcile);
//   3) dump-config: no dev-path leak, @mpd-dsh/mpd rows present;
//   4) real headless boot: mpd-bootstrap auto-copies presets, tools answer.
// Evidence -> evidence/plan-d/relocate/<ts>/. --self-test is offline.
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
const DEV = process.env.MPD_DEV_ROOT || "/home/haroldzhao/dshProj/oh-my-openagent/.omo/port/mpd-dsh"

function selfTest() {
  if (!existsSync(join(repoRoot, "dist", "mpd-package", "package.json"))) { console.error("[relocate-smoke self-test] FAIL: run node scripts/pack-mpd.mjs first"); process.exit(1) }
  const patch = readFileSync(join(repoRoot, "dist", "mpd-package", "cordis.patch.yml"), "utf8")
  if (patch.includes(DEV) || patch.includes("oh-my-openagent")) { console.error("[relocate-smoke self-test] FAIL: dev path leak in staged patch"); process.exit(1) }
  console.log("[relocate-smoke self-test] ok: staged patch is path-clean")
}

async function runReal() {
  const creds = join(homedir(), ".dsh", ".credentials.yaml")
  if (!existsSync(creds)) { console.error("[relocate-smoke] missing credentials"); process.exit(1) }
  const ts = new Date().toISOString().replaceAll(":", "-")
  const outDir = join(repoRoot, "evidence", "plan-d", "relocate", ts)
  mkdirSync(outDir, { recursive: true })
  const reloc = join(repoRoot, ".qa-reloc")
  mkdirSync(reloc, { recursive: true })
  const staged = join(reloc, "mpd-pkg-relocated")
  cpSync(join(repoRoot, "dist", "mpd-package"), staged, { recursive: true })
  const home = join(reloc, "home")
  const profile = join(home, "profiles", "t")
  mkdirSync(profile, { recursive: true })
  cpSync(creds, join(home, ".credentials.yaml"))
  mkdirSync(join(reloc, "ws"), { recursive: true })
  writeFileSync(join(profile, "package.json"), JSON.stringify({ name: "dsh-profile-t", private: true, dependencies: { ["@mpd-dsh/mpd"]: "file:" + staged, "@nanmicoder/dsh-agent-teams": "^0.1.13" }, dsh: { profile: { bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-headless"] } } }, null, 2) + "\n")
  const env = { ...process.env, DSH_HOME: home }
  const steps = {}
  console.log("[relocate-smoke] npm install (agent-teams + ast-grep + codegraph)...")
  const inst = spawnSync("npm", ["install", "--prefix", profile, "--no-audit", "--no-fund", "--cache", join(reloc, ".npm-cache")], { env, encoding: "utf8", timeout: 600000, maxBuffer: 32 * 1024 * 1024 })
  steps.install = { ok: inst.status === 0, exit: inst.status }
  const manifest = JSON.parse(readFileSync(join(profile, "package.json"), "utf8"))
  manifest.dsh.profile.bundles.push("@mpd-dsh/mpd")
  writeFileSync(join(profile, "package.json"), JSON.stringify(manifest, null, 2) + "\n")
  const dump = spawnSync("dsh", ["--profile", "t", "--dump-config"], { env, encoding: "utf8", timeout: 120000, maxBuffer: 32 * 1024 * 1024 })
  const dumpOut = (dump.stdout || "") + (dump.stderr || "")
  steps.dump = { ok: dump.status === 0 && dumpOut.includes("@mpd-dsh/mpd") && !dumpOut.includes(DEV), exit: dump.status, leaked: dumpOut.includes(DEV) }
  const live = spawnSync("dsh", ["--profile", "t", "Use mpd_config_get with key 'memory.vcs' then mpd_memory_status; report both values in one line."], { env, cwd: join(reloc, "ws"), encoding: "utf8", timeout: 600000, maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] })
  const out = (live.stdout || "") + (live.stderr || "")
  steps.live = { ok: live.status === 0, exit: live.status }
  const presets = join(home, ".agent-presets")
  const presetIds = existsSync(presets) ? readdirSync(presets).filter((d) => d.startsWith("mpd-")) : []
  steps.presets = { ok: presetIds.length === 11, count: presetIds.length }
  steps.bootstrap = { ok: out.includes("mpd-bootstrap") }
  const allOk = Object.values(steps).every((s) => s.ok)
  writeFileSync(join(outDir, "result.json"), JSON.stringify({ ok: allOk, steps }, null, 2))
  writeFileSync(join(outDir, "output.log"), out.slice(0, 40000) + "\n\n--- dump ---\n" + dumpOut.slice(0, 20000))
  console.log("[relocate-smoke] ok=" + allOk + " -> " + outDir)
  for (const [k, v] of Object.entries(steps)) console.log("  " + k + ": " + JSON.stringify(v).slice(0, 200))
  if (!allOk) process.exit(1)
  console.log("[relocate-smoke] PASS")
}

const argv = process.argv.slice(2)
if (argv.includes("--self-test")) selfTest()
else runReal()