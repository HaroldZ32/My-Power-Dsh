#!/usr/bin/env node
// Case rtl-ip-profile (RTL-IP workflow): the rtl-ip agent-teams roster profile
// ships with the four-stage flow contract, its members, the rtl-ip-flow skill
// and the four document templates; a composed boot must expose the profile in
// the agent-teams row config. --self-test is offline. Never touches ~/.dsh.
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
const PATCH = join(repoRoot, "packages", "mpd-bundle", "cordis.patch.yml")
const SKILL = join(repoRoot, "skills", "rtl-ip-flow")
const MEMBERS = [
  "Requirement Analyst",
  "Spec Designer",
  "RTL Code Engineer — Verilog/SV",
  "RTL Code Engineer — SpinalHDL",
  "Verification Engineer",
  "Reviewer",
  "Plan Reviewer",
]
const TEMPLATES = [
  "req-spec.md", "user-manual.md", "detail-design.md", "verification-plan.md",
  "dfmea.md", "validation-report.md", "validation-manual.md", "defect-report.md",
]

function fail(msg) { console.error("[rtl-ip-profile] FAIL: " + msg); process.exit(1) }

function selfTest() {
  const patch = readFileSync(PATCH, "utf8")
  if (!patch.includes("rtl-ip:")) fail("rtl-ip profile missing in bundle patch")
  for (const m of MEMBERS) if (!patch.includes("- name: " + m)) fail("member missing: " + m)
  if (!patch.includes("STAGE 0") || !patch.includes("IP01") || !patch.includes("STAGE 4"))
    fail("flow protocol markers missing")
  if (!existsSync(join(SKILL, "SKILL.md"))) fail("rtl-ip-flow SKILL.md missing")
  for (const t of TEMPLATES) if (!existsSync(join(SKILL, "templates", t))) fail("template missing: " + t)
  const sk = readFileSync(join(SKILL, "SKILL.md"), "utf8")
  if (!sk.includes("rtl-ip-flow") || !sk.toLowerCase().includes("consistency checklist") || !sk.includes("Swimlanes"))
    fail("skill contract markers missing")
  const guide = join(repoRoot, "docs")
  for (const f of ["rtl-ip-flow-guide.md", "rtl-ip-flow-guide.zh-CN.md"])
    if (!existsSync(join(guide, f))) fail("bilingual guide missing: " + f)
  console.log("[rtl-ip-profile self-test] ok: profile + 7 members + swimlane/flow markers + skill + 8 templates + bilingual guide verified")
}

function runReal() {
  const creds = join(homedir(), ".dsh", ".credentials.yaml")
  if (!existsSync(creds)) fail("missing credentials")
  const sandbox = mkdtempSync(join(tmpdir(), "mpd-rtlip-"))
  cpSync(creds, join(sandbox, ".credentials.yaml"))
  const settings = join(homedir(), ".dsh", "settings.yaml")
  if (existsSync(settings)) cpSync(settings, join(sandbox, "settings.yaml"))
  const ws = join(sandbox, "ws")
  mkdirSync(ws, { recursive: true })
  const env = { ...process.env, DSH_HOME: sandbox, HOME: sandbox }
  const inst = spawnSync(process.execPath, [join(repoRoot, "scripts", "install-profile.mjs"), "--yes", "--dsh-home", sandbox, "--profile", "mpd-headless", "--skip-toolchain"], { env, encoding: "utf8", timeout: 600000 })
  if (inst.status !== 0) fail("install-profile failed: " + (inst.stderr || "").slice(-500))
  const dump = spawnSync("dsh", ["--profile", "mpd-headless", "--dump-config"], { env, encoding: "utf8", timeout: 120000 })
  const out = (dump.stdout || "") + (dump.stderr || "")
  const ok = dump.status === 0 && out.includes("rtl-ip") && out.includes("Spec Designer") && out.includes("RTL Code Engineer — Verilog/SV")
  console.log("[rtl-ip-profile] composed config has rtl-ip profile: " + ok)
  if (!ok) fail("rtl-ip profile not visible in composed config")
  console.log("[rtl-ip-profile] PASS")
}

if (process.argv.includes("--self-test")) selfTest()
else runReal()
