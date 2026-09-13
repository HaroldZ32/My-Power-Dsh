#!/usr/bin/env node
// Case relocate-smoke (Plan D / P5): prove the STAGED bundle package installs and
// runs with ZERO references to any fixed checkout path (fully relocatable):
//   1) pack -> copy the staged package to an unrelated location;
//   2) npm-install it into an isolated profile (file: dependency, bundle reconcile);
//   3) dump-config: no dev-path leak, @mpd-dsh/mpd rows present;
//   4) real headless boot: the RELOCATED bundle serves its preset root + skill
//      corpus by reference, with ZERO writes into the harness home.
// Evidence -> evidence/plan-d/relocate/<ts>/. --self-test is offline.
// PREREQ: absent-staged-pack dist/mpd-package/package.json node scripts/pack-mpd.mjs
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
const DEV = process.env.MPD_DEV_ROOT || repoRoot

const SLUG = "relocate-smoke"
const PACK = join(repoRoot, "dist", "mpd-package", "package.json")
const PACK_PREREQ = { reason: "absent-staged-pack", prereq: "dist/mpd-package/package.json", remedy: "node scripts/pack-mpd.mjs" }
// Both strict spellings are normative (x2 v2 §6.5): the generic name and the case-specific name.
const STRICT = process.argv.includes("--no-skip") || process.argv.includes("--require-pack")

/** AM1 (x2 v2 §7): a positive probe of the exact prerequisite. The ONLY skippable prerequisite
 *  of this case is the staged pack (§3.3): credentials are NOT part of the skip set and keep
 *  their existing loud failure. */
function absentPrereq() {
  return existsSync(PACK) ? null : PACK_PREREQ
}

/** SKIP (exit 0) or, under either strict flag, FAIL (exit 1) — the same field values in both
 *  modes (AM2). The canonical marker is the FIRST stdout line (§4); human prose follows on
 *  stdout for a SKIP and on stderr for a FAIL. */
function gate(lane) {
  const p = absentPrereq()
  if (p === null) return
  console.log(`[mpd-qa] ${STRICT ? "FAIL" : "SKIP"} case=${SLUG} lane=${lane} reason=${p.reason} prereq=${p.prereq} remedy="${p.remedy}"`)
  const prose = `[${SLUG}] staged package absent at ${p.prereq}; ${STRICT ? "failing (strict flag)" : "skipping (not a failure)"}`
  if (STRICT) console.error(prose)
  else console.log(prose)
  process.exit(STRICT ? 1 : 0)
}

function selfTest() {
  gate("self-test")
  const patch = readFileSync(join(repoRoot, "dist", "mpd-package", "cordis.patch.yml"), "utf8")
  if (patch.includes(DEV) || patch.includes("the upstream project")) { console.error("[relocate-smoke self-test] FAIL: dev path leak in staged patch"); process.exit(1) }
  console.log("[relocate-smoke self-test] ok: staged patch is path-clean")
}

async function runReal() {
  gate("real")
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
  // The QA scratch root (.qa-reloc) legitimately appears in the composed tree —
  // the profile overlay roots the roster at the RELOCATED package — so the leak
  // check masks it and only fails on a real checkout path.
  const dumpOutClean = dumpOut.split(home).join("<QAHOME>").split(reloc).join("<QARELOC>")
    .split(join(repoRoot, "packages", "mpd-qa-roles-probe")).join("<QAPROBE>")
  steps.dump = { ok: dump.status === 0 && dumpOut.includes("@mpd-dsh/mpd") && !dumpOutClean.includes(DEV), exit: dump.status, leaked: dumpOutClean.includes(DEV) }
  // Repro: mount the RELOCATED bundle's own preset root as the default (the
  // headless profile has no stock agent-presets row) — a broken/absent root
  // would surface as agent-preset/not-found or a broken preset on agent switch.
  writeFileSync(join(profile, "cordis.patch.yml"), "- insert:\n    - id: agent-presets\n      name: '@deepseek-ai/dsh-agent-presets'\n      config:\n        default: mpd\n        roots:\n          - path: " + JSON.stringify(join(staged, "presets")) + "\n            trust: system\n"
    + "    - id: roles-probe\n      name: " + JSON.stringify(join(repoRoot, "packages", "mpd-qa-roles-probe", "dist", "index.js")) + "\n")
  // Deterministic boot proof (no model call: the QA machine has no model key):
  // the probe reads the LIVE preset + skill catalog out of the relocated package.
  const live = spawnSync("dsh", ["--profile", "t", "ok"], { env, cwd: join(reloc, "ws"), encoding: "utf8", timeout: 600000, maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] })
  const out = (live.stdout || "") + (live.stderr || "")
  const presetPath = /PRESET_PATH=([^\s]+) trust=(\w+)/.exec(out)
  const fixture = /SKILL_FIXTURE=(\w+) name=(\S+) base=(\S+) bytes=(\d+)/.exec(out)
  steps.live = {
    ok: /roles-probe\] PASS/.test(out) && /PRESET_MPD=ok/.test(out)
      && String(presetPath?.[1] ?? "").startsWith(staged) && presetPath?.[2] === "system"
      && fixture !== null && fixture[1] === "ok" && String(fixture[3]).startsWith(staged),
    exit: live.status, preset: presetPath?.[1] ?? null, fixtureBase: fixture?.[3] ?? null,
  }
  // bundle-served model: NOTHING is copied into the harness home …
  const presets = join(home, ".agent-presets")
  const presetCopies = existsSync(presets) ? readdirSync(presets) : []
  steps.noPresetCopy = { ok: presetCopies.length === 0, count: presetCopies.length }
  const userSkills = join(home, "skills")
  const skillDirs = existsSync(userSkills) ? readdirSync(userSkills).filter((d) => { try { return existsSync(join(userSkills, d, "SKILL.md")) } catch { return false } }) : []
  steps.noSkillCopy = { ok: skillDirs.length === 0, count: skillDirs.length }
  // … and both assets are served from the RELOCATED package.
  steps.servedFromRelocated = { ok: out.includes(join(staged, "skills")) && out.includes("provider mpd-bundle"), staged }
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