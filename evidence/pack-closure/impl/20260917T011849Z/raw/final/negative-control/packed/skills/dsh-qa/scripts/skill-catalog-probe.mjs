#!/usr/bin/env node
// Case skill-catalog-probe (Plan D, bundle-served since 0.3.0): prove the staged
// bundle installs AND its skill corpus is usable WITHOUT copying anything into
// the harness home. A real headless boot mounts the QA probe, which reads the
// live skill catalog through ctx.skills and loads `svn-master` (name, body,
// resource base) from <bundle>/skills — $DSH_HOME/skills stays absent.
// The proof is deterministic (no model call): the QA machine has no model
// credential, and delivery — not model behavior — is what this case asserts.
// Isolated DSH_HOME; evidence -> evidence/plan-d/skill-catalog/<ts>/.
// --self-test is offline (staged presence + provider wiring in the built dist).
// PREREQ: absent-staged-pack dist/mpd-package/package.json node scripts/pack-mpd.mjs
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import { tmpdir, homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
const TASK = "Call the skill tool with name 'svn-master' (the exact skill name from the session skill catalog), then reply in one line what this skill governs."

const SLUG = "skill-catalog-probe"
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
 *  stdout for a SKIP and on stderr for a FAIL. Called AFTER the prerequisite-independent
 *  offline checks (AM3b) and BEFORE the non-skippable credentials check. */
function gate(lane) {
  const p = absentPrereq()
  if (p === null) return
  console.log(`[mpd-qa] ${STRICT ? "FAIL" : "SKIP"} case=${SLUG} lane=${lane} reason=${p.reason} prereq=${p.prereq} remedy="${p.remedy}"`)
  const prose = `[${SLUG}] staged package absent at ${p.prereq}; ${STRICT ? "failing (strict flag)" : "skipping (not a failure)"}`
  if (STRICT) console.error(prose)
  else console.log(prose)
  process.exit(STRICT ? 1 : 0)
}

/** The names the harness's BUNDLED skill root discovers: a top-level directory bundle
 *  `<name>/SKILL.md` or a top-level flat `<name>.md` (dsh-skill-filesystem, nested
 *  `**&#47;SKILL.md` deliberately not discovered). Derived from the staged corpus on disk so
 *  no case pins a magic corpus size that rots when the corpus legitimately changes. */
function corpusSkillNames(root) {
  return readdirSync(root, { withFileTypes: true })
    .filter((e) => (e.isDirectory() && existsSync(join(root, e.name, "SKILL.md"))) || (e.isFile() && e.name.endsWith(".md")))
    .map((e) => (e.isDirectory() ? e.name : e.name.slice(0, -3)))
    .sort()
}

function selfTest() {
  const staged = join(repoRoot, "dist", "mpd-package")
  const marker = join(staged, "skills", "svn-master", "SKILL.md")
  // Prerequisite-independent checks first (AM3b): the built provisioning dist is tracked,
  // so a defect there is a FAIL in every mode — never a skip.
  // bundle-served model: the built provisioning plugin registers a skill provider
  // and no longer copies the corpus into the harness home.
  const dist = readFileSync(join(repoRoot, "packages", "mpd-bootstrap-plugin", "dist", "index.js"), "utf8")
  if (!dist.includes("registerProvider") || !dist.includes("skill corpus served from")) { console.error("[skill-catalog-probe self-test] FAIL: mpd-bootstrap dist does not register the corpus provider"); process.exit(1) }
  if (dist.includes("syncTree") || /cpSync\([^)]*skills/.test(dist)) { console.error("[skill-catalog-probe self-test] FAIL: mpd-bootstrap dist still copies the corpus (syncTree/cpSync)"); process.exit(1) }
  gate("self-test")
  // Present-but-broken pack (AM3): the prerequisite exists but the staged corpus is incomplete.
  if (!existsSync(marker)) { console.error("[skill-catalog-probe self-test] FAIL: staged skill corpus incomplete (missing skills/svn-master/SKILL.md; run node scripts/pack-mpd.mjs)"); process.exit(1) }
  // The derived corpus list is the case's expected-catalog operand: prove it is NOT
  // vacuous (it must see the staged corpus and the loaded fixture) without pinning a size.
  const corpusNames = corpusSkillNames(join(staged, "skills"))
  if (corpusNames.length < 2 || !corpusNames.includes("svn-master") || !corpusNames.includes("dsh-qa")) { console.error("[skill-catalog-probe self-test] FAIL: corpus derivation does not see the staged corpus (expected svn-master + dsh-qa among " + corpusNames.length + ")"); process.exit(1) }
  console.log("[skill-catalog-probe self-test] ok: staged skill corpus present + provider wiring verified")
}

async function runReal() {
  gate("real")
  const creds = join(homedir(), ".dsh", ".credentials.yaml")
  if (!existsSync(creds)) { console.error("[skill-catalog-probe] missing credentials"); process.exit(1) }
  const ts = new Date().toISOString().replaceAll(":", "-")
  const outDir = join(repoRoot, "evidence", "plan-d", "skill-catalog", ts)
  mkdirSync(outDir, { recursive: true })
  const sandbox = mkdtempSync(join(tmpdir(), "mpd-skill-"))
  cpSync(creds, join(sandbox, ".credentials.yaml"))
  // The live provider chain lives in settings.yaml (llm-pi-ai gateway providers);
  // without it the headless boot falls back to the base deepseek-official route
  // and fails with MISSING_CREDENTIAL (AGENTS.md §7).
  const settings = join(homedir(), ".dsh", "settings.yaml")
  if (existsSync(settings)) cpSync(settings, join(sandbox, "settings.yaml"))
  const ws = join(sandbox, "ws")
  mkdirSync(ws, { recursive: true })
  // AGENTS.md §7 — HOME is sandboxed too: the filesystem skill provider scans
  // `<agentsHome>/skills` with `agentsHome = $DSH_AGENTS_HOME ?? ~/.agents`, so DSH_HOME
  // alone still leaks the machine's own user skills into the boot (measured 2026-09-14:
  // SKILLS=24 BUNDLED=18 NON_BUNDLED=<6 machine skills> -> roles-probe FAIL).
  const userHome = join(sandbox, "userhome")
  mkdirSync(userHome, { recursive: true })
  const env = { ...process.env, DSH_HOME: sandbox, HOME: userHome }
  const staged = join(repoRoot, "dist", "mpd-package")
  const profileDir = join(sandbox, "profiles", "t")
  mkdirSync(profileDir, { recursive: true })
  writeFileSync(join(profileDir, "package.json"), JSON.stringify({ name: "dsh-profile-t", private: true, dependencies: { ["@mpd-dsh/mpd"]: "file:" + staged }, dsh: { profile: { bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-headless"] } } }, null, 2) + "\n")
  const steps = {}
  const inst = spawnSync("npm", ["install", "--prefix", profileDir, "--no-audit", "--no-fund", "--cache", join(sandbox, ".npm-cache")], { env, encoding: "utf8", timeout: 600000, maxBuffer: 32 * 1024 * 1024 })
  steps.install = { ok: inst.status === 0, exit: inst.status }
  // mount the bundle patch rows (mpd-bootstrap included), like a real install
  const manifest = JSON.parse(readFileSync(join(profileDir, "package.json"), "utf8"))
  manifest.dsh.profile.bundles.push("@mpd-dsh/mpd")
  writeFileSync(join(profileDir, "package.json"), JSON.stringify(manifest, null, 2) + "\n")
  // Boot overlay: insert the headless profile's agent-presets row rooted at the
  // INSTALLED bundle (headless has no stock roster row) and mount the QA probe
  // that reads the live catalog. The bundle's own rows all stay enabled.
  const overlay = join(sandbox, "qa-probe.yml")
  const installedBundle = join(profileDir, "node_modules", "@mpd-dsh", "mpd")
  writeFileSync(overlay, "- insert:\n"
    + "    - id: agent-presets\n      name: '@deepseek-ai/dsh-agent-presets'\n      config:\n        default: mpd\n        roots:\n          - path: " + JSON.stringify(join(installedBundle, "presets")) + "\n            trust: system\n"
    + "    - id: roles-probe\n      name: " + JSON.stringify(join(repoRoot, "packages", "mpd-qa-roles-probe", "dist", "index.js")) + "\n")
  const live = spawnSync("dsh", ["--profile", "t", "--patch", overlay, "ok"], { env, cwd: ws, encoding: "utf8", timeout: 600000, stdio: ["ignore", "pipe", "pipe"] })
  const out = (live.stdout || "") + (live.stderr || "")
  // bundle-served model: the corpus is NOT copied into the harness home …
  const userSkills = join(sandbox, "skills")
  const skillDirs = existsSync(userSkills) ? readdirSync(userSkills).filter((d) => existsSync(join(userSkills, d, "SKILL.md"))) : []
  steps.noHomeCopy = { ok: skillDirs.length === 0, count: skillDirs.length, path: userSkills }
  const userPresets = join(sandbox, ".agent-presets")
  steps.noPresetCopy = { ok: !existsSync(userPresets) || readdirSync(userPresets).length === 0, path: userPresets }
  // … and it IS served from the installed bundle. The npm file: install links the
  // package, so the plugin's own location resolves to the real staged package dir
  // while a copied tree would have been under $DSH_HOME — accept either the
  // node_modules path or the package's realpath, never the harness home.
  const served = /\[mpd-bootstrap\] skill corpus served from ([^\s]+) \(provider mpd-bundle/.exec(out)
  const servedPath = String(served?.[1] ?? "")
  const stagedReal = join(staged, "skills")
  steps.servedFromBundle = {
    ok: served !== null && servedPath.endsWith("skills")
      && (servedPath.includes(join("node_modules", "@mpd-dsh", "mpd", "skills")) || servedPath === stagedReal)
      && !servedPath.startsWith(sandbox),
    path: servedPath || null,
  }
  // proof: the probe read the LIVE catalog and loaded the fixture skill body.
  const catalog = /\[roles-probe\] SKILLS=(\d+) BUNDLED=(\d+)/.exec(out)
  const fixture = /\[roles-probe\] SKILL_FIXTURE=(\w+) name=(\S+) base=(\S+) bytes=(\d+)/.exec(out)
  const installedReal = realpathSync(installedBundle)
  // The expected count is DERIVED from the corpus this staged pack ships, never a
  // magic number: the old hard-coded floor (`>= 20`) rotted silently while the corpus
  // legitimately shrank (RTL trees extracted, then the cross-agent session-finder skill
  // pruned by the DSH-only cleanup: 21 -> 19 -> 18).
  const corpusRoot = join(staged, "skills")
  const expectedSkills = corpusSkillNames(corpusRoot).length
  steps.catalog = {
    ok: /roles-probe\] PASS/.test(out)
      && catalog !== null && Number(catalog[1]) === expectedSkills && Number(catalog[2]) === expectedSkills
      && fixture !== null && fixture[1] === "ok" && fixture[2] === "svn-master"
      && String(fixture[3]).startsWith(installedReal) && Number(fixture[4]) > 100,
    total: catalog ? Number(catalog[1]) : null,
    bundled: catalog ? Number(catalog[2]) : null,
    expected: expectedSkills,
    fixture: fixture ? { state: fixture[1], name: fixture[2], base: fixture[3], bytes: Number(fixture[4]) } : null,
    exit: live.status,
  }
  const allOk = Object.values(steps).every((s) => s.ok)
  writeFileSync(join(outDir, "result.json"), JSON.stringify({ ok: allOk, steps }, null, 2))
  writeFileSync(join(outDir, "output.log"), out.slice(0, 40000))
  console.log("[skill-catalog-probe] ok=" + allOk + " -> " + outDir)
  for (const [k, v] of Object.entries(steps)) console.log("  " + k + ": " + JSON.stringify(v).slice(0, 200))
  if (!allOk) process.exit(1)
  console.log("[skill-catalog-probe] PASS")
}

if (process.argv.includes("--self-test")) selfTest()
else runReal()
