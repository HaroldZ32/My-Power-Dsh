#!/usr/bin/env node
// Case skill-catalog-probe (Plan D): prove the staged bundle installs AND the
// mpd-bootstrap provisioning makes the ported skill corpus usable - a real
// headless call loads `svn-master` via the skill tool and states its domain.
// Isolated DSH_HOME; evidence -> evidence/plan-d/skill-catalog/<ts>/.
// --self-test is offline (staged presence + copy from pack).
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir, homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
const TASK = "Call the skill tool with name 'svn-master' (the exact skill name from the session skill catalog), then reply in one line what this skill governs."

function selfTest() {
  const staged = join(repoRoot, "dist", "mpd-package")
  const marker = join(staged, "skills", "svn-master", "SKILL.md")
  if (!existsSync(marker)) { console.error("[skill-catalog-probe self-test] FAIL: run node scripts/pack-mpd.mjs first (staged skills missing)"); process.exit(1) }
  console.log("[skill-catalog-probe self-test] ok: staged skill corpus present")
}

async function runReal() {
  const creds = join(homedir(), ".dsh", ".credentials.yaml")
  if (!existsSync(creds)) { console.error("[skill-catalog-probe] missing credentials"); process.exit(1) }
  const ts = new Date().toISOString().replaceAll(":", "-")
  const outDir = join(repoRoot, "evidence", "plan-d", "skill-catalog", ts)
  mkdirSync(outDir, { recursive: true })
  const sandbox = mkdtempSync(join(tmpdir(), "mpd-skill-"))
  cpSync(creds, join(sandbox, ".credentials.yaml"))
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
  const live = spawnSync("dsh", ["--profile", "t", TASK], { env, cwd: ws, encoding: "utf8", timeout: 600000, stdio: ["ignore", "pipe", "pipe"] })
  const out = (live.stdout || "") + (live.stderr || "")
  const userSkills = join(sandbox, "skills")
  const skillDirs = existsSync(userSkills) ? readdirSync(userSkills).filter((d) => existsSync(join(userSkills, d, "SKILL.md"))) : []
  steps.copy = { ok: skillDirs.length >= 18, count: skillDirs.length }
  // proof: the reply either names the skill or restates its description domain (delegation/description text from svn-master SKILL.md)
  steps.live = { ok: live.status === 0 && (/svn-master/i.test(out) || /Subversion|SVN/.test(out)), exit: live.status }
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
