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
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import { tmpdir, homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
const TASK = "Call the skill tool with name 'svn-master' (the exact skill name from the session skill catalog), then reply in one line what this skill governs."

function selfTest() {
  const staged = join(repoRoot, "dist", "mpd-package")
  const marker = join(staged, "skills", "svn-master", "SKILL.md")
  if (!existsSync(marker)) { console.error("[skill-catalog-probe self-test] FAIL: run node scripts/pack-mpd.mjs first (staged skills missing)"); process.exit(1) }
  // bundle-served model: the built provisioning plugin registers a skill provider
  // and no longer copies the corpus into the harness home.
  const dist = readFileSync(join(repoRoot, "packages", "mpd-bootstrap-plugin", "dist", "index.js"), "utf8")
  if (!dist.includes("registerProvider") || !dist.includes("skill corpus served from")) { console.error("[skill-catalog-probe self-test] FAIL: mpd-bootstrap dist does not register the corpus provider"); process.exit(1) }
  if (dist.includes("syncTree") || /cpSync\([^)]*skills/.test(dist)) { console.error("[skill-catalog-probe self-test] FAIL: mpd-bootstrap dist still copies the corpus (syncTree/cpSync)"); process.exit(1) }
  console.log("[skill-catalog-probe self-test] ok: staged skill corpus present + provider wiring verified")
}

async function runReal() {
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
  const env = { ...process.env, DSH_HOME: sandbox }
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
  steps.catalog = {
    ok: /roles-probe\] PASS/.test(out)
      && catalog !== null && Number(catalog[1]) >= 20 && Number(catalog[2]) >= 20
      && fixture !== null && fixture[1] === "ok" && fixture[2] === "svn-master"
      && String(fixture[3]).startsWith(installedReal) && Number(fixture[4]) > 100,
    total: catalog ? Number(catalog[1]) : null,
    bundled: catalog ? Number(catalog[2]) : null,
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
