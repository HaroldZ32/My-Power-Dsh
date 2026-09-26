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
import { credentialEnv, seedSandboxCredentials } from "./lib/credentials.mjs"
import { DSH_MISSING, dshCommand } from "./lib/dsh-launcher.mjs"

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
  seedSandboxCredentials(home, { credentialsFile: creds })
  // AGENTS.md §7 — a live case must ALSO stage settings.yaml when present: this home's
// model chain is configured through gateway providers (llm-pi-ai), so without it the
// sandbox falls back to the base `deepseek-official` route and the boot dies with
// MISSING_CREDENTIAL (measured 2026-09-14: 8 live cases red for exactly this; their
// `--self-test` stayed green because it never boots). Same idiom as the cases that
// already passed.
  const qaSettings = join(homedir(), ".dsh", "settings.yaml")
  if (existsSync(qaSettings)) cpSync(qaSettings, join(home, "settings.yaml"))
  mkdirSync(join(reloc, "ws"), { recursive: true })
  // NO `@nanmicoder/dsh-agent-teams` dependency: that npm package belonged to the RETIRED
  // vendored body (D5). The packed bundle declares its own runtime deps (the three official
  // Agent Teams packages) and the profile installs the relocated pack by `file:`, so the
  // retired name would only add an unresolvable dependency to the install.
  writeFileSync(join(profile, "package.json"), JSON.stringify({ name: "dsh-profile-t", private: true, dependencies: { ["@mpd-dsh/mpd"]: "file:" + staged }, dsh: { profile: { bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-headless"] } } }, null, 2) + "\n")
  // AGENTS.md §7 — HOME is sandboxed too: the filesystem skill provider scans
  // `<agentsHome>/skills` with `agentsHome = $DSH_AGENTS_HOME ?? ~/.agents`, so DSH_HOME
  // alone still leaks the machine's own user skills into the boot (measured 2026-09-14:
  // SKILLS=24 BUNDLED=18 NON_BUNDLED=<6 machine skills> -> roles-probe FAIL).
  const userHome = join(reloc, "userhome")
  mkdirSync(userHome, { recursive: true })
  const env = credentialEnv({ ...process.env, DSH_HOME: home, HOME: userHome  })
  if (env.DSH_HOME !== home || env.HOME !== userHome) { console.error("[relocate-smoke] isolation assertion failed"); process.exit(1) }
  const steps = {}
  console.log("[relocate-smoke] npm install (relocated bundle + ast-grep + codegraph)...")
  const inst = spawnSync("npm", ["install", "--prefix", profile, "--no-audit", "--no-fund", "--cache", join(reloc, ".npm-cache")], { env, encoding: "utf8", timeout: 600000, maxBuffer: 32 * 1024 * 1024 })
  steps.install = { ok: inst.status === 0, exit: inst.status }
  const manifest = JSON.parse(readFileSync(join(profile, "package.json"), "utf8"))
  manifest.dsh.profile.bundles.push("@mpd-dsh/mpd")
  writeFileSync(join(profile, "package.json"), JSON.stringify(manifest, null, 2) + "\n")
  // T-69: the wrapper is the sanctioned composer; `--json` puts the banner on stderr, so the
  // child's composed tree is read from `.stdout` and the banner can be asserted separately.
  const dump = spawnSync(process.execPath, [join(repoRoot, "scripts", "dump-config.mjs"), "--profile", "t", "--json"], { env, encoding: "utf8", timeout: 120000, maxBuffer: 32 * 1024 * 1024 })
  const dumpOut = (() => { try { return JSON.parse(dump.stdout || "{}").stdout ?? "" } catch { return dump.stdout || "" } })()
  // The QA scratch root (.qa-reloc) legitimately appears in the composed tree —
  // the profile overlay roots the roster at the RELOCATED package — so the leak
  // check masks it and only fails on a real checkout path.
  const dumpOutClean = dumpOut.split(home).join("<QAHOME>").split(reloc).join("<QARELOC>")
    .split(join(repoRoot, "packages", "mpd-qa-roles-probe")).join("<QAPROBE>")
  steps.dump = { ok: dump.status === 0 && dumpOut.includes("@mpd-dsh/mpd") && !dumpOutClean.includes(DEV), exit: dump.status, leaked: dumpOutClean.includes(DEV) }
  // The RELOCATED pack's OWN patch array supplies the `agent-preset-registry` id-target and
  // the `preset-mpd` row (0.1.7-rc.2), so the only overlay this lane needs is the QA probe.
  // The retired `agent-presets` row + `roots:`/`trust: system` overlay is GONE: that package
  // no longer exists, so inserting it would take the whole boot down.
  writeFileSync(join(profile, "cordis.patch.yml"), "- insert:\n"
    + "    - id: roles-probe\n      name: " + JSON.stringify(join(repoRoot, "packages", "mpd-qa-roles-probe", "dist", "index.js")) + "\n")
  // Deterministic boot proof (no model call: the QA machine has no model key):
  // the probe reads the LIVE preset + skill catalog out of the relocated package.
  const liveSpec = dshCommand(["--profile", "t", "ok"], env)
  const live = liveSpec === null ? { status: null, stdout: "", stderr: DSH_MISSING, error: new Error(DSH_MISSING) } : spawnSync(liveSpec.command, liveSpec.args, { env, cwd: join(reloc, "ws"), encoding: "utf8", timeout: 600000, maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] })
  const out = (live.stdout || "") + (live.stderr || "")
  const presetPath = /PRESET_PATH=([^\s]+) trust=(\w+)/.exec(out)
  const fixture = /SKILL_FIXTURE=(\w+) name=(\S+) base=(\S+) bytes=(\d+)/.exec(out)
  // 0.1.7-rc.2 ROW MODEL: the probe reports the preset's declaring PATCH FILE and
  // `trust=bundle` (there is no `system`-trust directory root any more, and no directory to
  // resolve). The lane's claim is "the RELOCATED pack serves its own preset" — so assert the
  // relocated path AND the row model's own trust value EXPLICITLY. Deliberately NOT
  // `trust !== undefined`: accepting any trust would stop distinguishing a relocated pack
  // from a home copy, which is the one thing this lane exists to tell apart.
  const relocatedPresetPatch = join(staged, "presets", "mpd.patch.yml").split("\\").join("/")
  steps.live = {
    ok: /roles-probe\] PASS/.test(out) && /PRESET_MPD=ok/.test(out)
      && String(presetPath?.[1] ?? "").split("\\").join("/") === relocatedPresetPatch && presetPath?.[2] === "bundle"
      && fixture !== null && fixture[1] === "ok" && String(fixture[3]).startsWith(staged),
    exit: live.status, preset: presetPath?.[1] ?? null, trust: presetPath?.[2] ?? null,
    expectedPreset: relocatedPresetPatch, fixtureBase: fixture?.[3] ?? null,
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