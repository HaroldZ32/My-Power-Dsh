#!/usr/bin/env node
// Case rtl-ip-profile (RTL-IP workflow): the rtl-ip agent-teams roster profile.
//
// Owner after the RTL extraction: the definition lives in the @mpd-dsh/silicon
// bundle as DATA (presets/rtl-ip.profile.json), while mpd keeps the single
// agent-teams row that injects it (the t15 carrier). This case probes the
// silicon side offline and, in the real pass, whether a composed boot exposes
// the profile. Repointed in t19: it previously read mpd's patch/skills/docs,
// which the strip removed.
//
// Silicon root resolution: $MPD_SILICON_ROOT, else the sibling checkout
// ../my-power-dsh-silicon. --self-test is offline. The real pass prints SKIP
// with a reason and still exits 0 when silicon is absent, `dsh` is unavailable,
// or the mpd-side carrier has not landed (rtl-ip then exists as data only).
// Never touches the real ~/.dsh.
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
const SILICON = process.env.MPD_SILICON_ROOT || join(dirname(repoRoot), "my-power-dsh-silicon")
const PRESET = join(SILICON, "presets", "rtl-ip.profile.json")
const PATCH = join(SILICON, "packages", "mpd-bundle", "cordis.patch.yml")
const SKILL = join(SILICON, "skills", "rtl-ip-flow")
const DOCS = join(SILICON, "docs")
const SILICON_ROWS = ["silicon-dsh-adapter", "silicon-bootstrap", "silicon-verif", "silicon-mcp-lsp"]
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

const skipped = []
function skip(reason) {
  skipped.push(reason)
  console.log("[rtl-ip-profile] SKIP: " + reason)
}
function fail(msg) {
  console.error("[rtl-ip-profile] FAIL: " + msg)
  process.exit(1)
}

/** Row ids declared by the patch's `- insert:` blocks (4-space `- id:` entries). */
function insertIds(patchText) {
  const ids = []
  let inInsert = false
  for (const raw of patchText.split(/\r?\n/)) {
    if (/^- insert:\s*$/.test(raw)) { inInsert = true; continue }
    if (!inInsert) continue
    if (raw.trim() === "") continue
    if (!raw.startsWith(" ")) { inInsert = false; continue }
    const m = raw.match(/^ {4}- id: ['"]?([A-Za-z0-9_.-]+)['"]?\s*$/)
    if (m) ids.push(m[1])
  }
  return ids
}

function selfTest() {
  if (!existsSync(join(SILICON, "package.json"))) {
    skip(`silicon bundle not present at ${SILICON} (set MPD_SILICON_ROOT) — nothing to assert`)
  } else {
    const data = JSON.parse(readFileSync(PRESET, "utf8"))
    const profile = data["rtl-ip"] ?? data
    const members = profile.members ?? []
    if (members.length !== MEMBERS.length) fail(`profile has ${members.length} members, expected ${MEMBERS.length}`)
    for (const member of MEMBERS) {
      if (!members.some((entry) => entry.name === member)) fail("member missing in presets/rtl-ip.profile.json: " + member)
    }
    if (profile.taskPlanning !== "captain") fail("taskPlanning is not captain")
    const protocol = String(profile.protocol ?? "")
    for (const marker of ["STAGE 0", "IP01", "STAGE 4"]) {
      if (!protocol.includes(marker)) fail("flow protocol marker missing: " + marker)
    }
    // The profile is DATA here: if the patch defined it too, the single
    // agent-teams row would end up with two sources of truth.
    const patch = readFileSync(PATCH, "utf8")
    if (/^\s*rtl-ip:/m.test(patch)) fail("bundle patch defines rtl-ip itself (it must stay data-only)")
    const ids = insertIds(patch)
    if (ids.length !== SILICON_ROWS.length) fail(`silicon patch declares ${ids.length} row ids, expected ${SILICON_ROWS.length}`)
    for (const row of SILICON_ROWS) {
      if (!ids.includes(row)) fail("silicon patch is missing row id: " + row)
    }
    if (/^- id:/m.test(patch)) fail("silicon patch carries an id-target (must be additive-only)")
    if (!existsSync(join(SKILL, "SKILL.md"))) fail("rtl-ip-flow SKILL.md missing")
    for (const template of TEMPLATES) {
      if (!existsSync(join(SKILL, "templates", template))) fail("template missing: " + template)
    }
    const sk = readFileSync(join(SKILL, "SKILL.md"), "utf8")
    if (!sk.includes("rtl-ip-flow") || !sk.toLowerCase().includes("consistency checklist") || !sk.includes("Swimlanes")) {
      fail("skill contract markers missing")
    }
    for (const file of ["rtl-ip-flow-guide.md", "rtl-ip-flow-guide.zh-CN.md"]) {
      if (!existsSync(join(DOCS, file))) fail("bilingual guide missing in the silicon bundle: " + file)
    }
  }
  console.log(
    "[rtl-ip-profile self-test] ok: silicon preset (7 members + taskPlanning + STAGE 0/IP01/STAGE 4) + "
      + "4 additive rows / id-target-free patch + skill + 8 templates + bilingual guide"
      + (skipped.length > 0 ? ` (${skipped.length} group(s) skipped — see SKIP lines)` : ""),
  )
}

function runReal() {
  if (!existsSync(join(SILICON, "package.json"))) {
    skip(`silicon bundle not present at ${SILICON} — the composed-boot probe needs the checkout (set MPD_SILICON_ROOT)`)
    console.log("[rtl-ip-profile] PASS (nothing to probe: bundle absent)")
    return
  }
  const version = spawnSync("dsh", ["--version"], { encoding: "utf8", timeout: 60000 })
  if (version.error || version.status !== 0) {
    skip("dsh CLI not available on PATH — the composed-boot probe needs a harness install")
    console.log("[rtl-ip-profile] PASS (composed-boot probe skipped)")
    return
  }

  const sandbox = mkdtempSync(join(tmpdir(), "mpd-rtlip-"))
  const ws = join(sandbox, "ws")
  mkdirSync(ws, { recursive: true })
  const env = { ...process.env, DSH_HOME: sandbox, HOME: sandbox, DSH_WORKSPACE_ROOT: ws }
  const add = spawnSync("dsh", ["plugin", "--profile", "rtl-ip-qa", "add", SILICON], { env, cwd: ws, encoding: "utf8", timeout: 600000 })
  if (add.status !== 0) fail("dsh plugin add failed: " + (add.stderr || add.stdout || "").slice(-400))
  const dumpRun = spawnSync("dsh", ["--profile", "rtl-ip-qa", "--dump-config"], { env, cwd: ws, encoding: "utf8", timeout: 180000 })
  const dump = (dumpRun.stdout || "") + (dumpRun.stderr || "")

  const rowsComposed = SILICON_ROWS.every((row) => new RegExp(`^- id: ${row}$`, "m").test(dump))
  const realHomeLeak = dump.includes(join(process.env.HOME || "", ".dsh", "profiles")) && !dump.includes(sandbox)
  // The profile key sits inside the agent-teams row's config at 6-space indent.
  const visible = /^ {6}rtl-ip:$/m.test(dump)
  let verdict = "ok"
  if (!visible) {
    skip("rtl-ip is not in the composed config: the mpd-side carrier (task t15) has not landed, and this bundle ships the profile as DATA only — the offline self-test covers the definition")
    verdict = "skipped-rtl-ip-carrier"
  } else {
    for (const member of MEMBERS) {
      if (!dump.includes("- name: " + member)) fail("composed profile is missing member: " + member)
    }
    for (const marker of ["STAGE 0", "IP01", "STAGE 4"]) {
      if (!dump.includes(marker)) fail("composed profile is missing marker: " + marker)
    }
  }
  if (!rowsComposed) fail("silicon rows not composed: " + SILICON_ROWS.filter((row) => !new RegExp(`^- id: ${row}$`, "m").test(dump)).join(", "))
  if (realHomeLeak) fail("composed config references the real ~/.dsh — isolation broken")

  const outDir = join(repoRoot, "evidence", "dsh-qa", "rtl-ip-profile", new Date().toISOString().replaceAll(":", "-"))
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, "result.json"), JSON.stringify({
    verdict,
    dumpExit: dumpRun.status,
    siliconRoot: SILICON,
    rowsComposed,
    rtlIpVisibleInComposedConfig: visible,
    skips: skipped,
    dshHomeSandbox: sandbox,
    workspaceSandbox: ws,
    realHomeUntouched: !realHomeLeak,
  }, null, 2) + "\n")
  writeFileSync(join(outDir, "output.log"), dump + "\n")
  console.log(`[rtl-ip-profile] ${verdict} -> ${outDir}`)
  console.log("[rtl-ip-profile] PASS")
}

if (process.argv.includes("--self-test")) selfTest()
else runReal()
