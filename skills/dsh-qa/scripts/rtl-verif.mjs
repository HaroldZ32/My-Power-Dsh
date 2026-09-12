#!/usr/bin/env node
// Case rtl-verif: verify the RTL verification deliverable end-to-end in an
// isolated DSH_HOME — now against the @mpd-dsh/silicon bundle, which owns the
// mpd_verif_* plugin, the RTL corpus and the rtl-ip profile data. Repointed in
// t19: it previously probed the mpd-side plugin, skill and patch layout, which
// the strip removed from this repository.
//
// TWO PHASE, deterministic, no LLM session (runs on credential-less QA boxes):
//   PHASE 1 (isolated install + composed boot) — `dsh plugin add <silicon>` into
//     a throwaway DSH_HOME; `--dump-config` must compose all four silicon rows
//     with no duplicate loader id, and the strip's own row must be gone
//     (mpd-verif no longer exists on the mpd side).
//   PHASE 2 (real tool flow) — drive the shipped silicon dist with a REAL
//     open-source backend on a golden adder (3+4=7): backends probe, venv
//     iron-rule status, lint with zero diagnostics and — when a project venv
//     carrying cocotb exists — the cocotb Makefile flow (seed 4242,
//     traceFst:false; VCD is the machine standard) plus a 1-case regression,
//     asserted on disk via results.xml / VCD / results.json.
//   iron rule — the SYSTEM python must still fail `import cocotb`.
//
// Skip semantics (printed, never silent; exit 0): silicon checkout absent,
// `dsh` absent, no project venv (cocotb segment only), or the HDL LSP assets
// not landed yet (task t16 → registry assertions become an evidenced skip).
// --self-test is offline (no network, no real tooling, no model).
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir, homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
const SILICON = process.env.MPD_SILICON_ROOT || join(dirname(repoRoot), "my-power-dsh-silicon")
const VERIF_DIST = join(SILICON, "packages/mpd-verif-plugin/dist/index.js")
const PATCH = join(SILICON, "packages/mpd-bundle/cordis.patch.yml")
const SKILLS = join(SILICON, "skills")
const PRESET = join(SILICON, "presets/rtl-ip.profile.json")
const LSP_CLI = join(SILICON, "packages/mpd-mcp-lsp/dist/cli.js")
const VENV_CANDIDATES = [process.env.MPD_DSH_VERIF_VENV, join(SILICON, ".venv-rtl"), join(repoRoot, ".venv-rtl")].filter(Boolean)
const EIGHT_TOOLS = ["mpd_verif_venv", "mpd_verif_backends", "mpd_verif_compile", "mpd_verif_lint", "mpd_verif_sim", "mpd_verif_coverage", "mpd_verif_uvm", "mpd_verif_regress"]
const SILICON_ROWS = ["silicon-dsh-adapter", "silicon-bootstrap", "silicon-verif", "silicon-mcp-lsp"]
const TREES = { "rtl-ip-flow": 9, "rtl-codestyle": 6, "rtl-verif": 20 }
const LSP_REGISTRY = [
  'verible: { command: ["verible-verilog-ls"], extensions: [".v", ".vh"] }',
  '"slang-server": { command: ["slang-server"], extensions: [".sv", ".svh"] }',
  '".v": "verilog"',
  '".sv": "systemverilog"',
]

// Golden fixture: 8-bit adder, 3+4=7; the cocotb TB asserts o_sum==7.
const GOLDEN_ADDER_V = `module adder (
  input  logic [7:0] i_a,
  input  logic [7:0] i_b,
  output logic [8:0] o_sum
);
  assign o_sum = i_a + i_b;
endmodule
`
const GOLDEN_ADDER_TB = `import cocotb
from cocotb.triggers import Timer

@cocotb.test()
async def smoke_add(dut):
    dut.i_a.value = 3
    dut.i_b.value = 4
    await Timer(10, units="ns")
    assert dut.o_sum.value == 7, f"got {dut.o_sum.value}"
`

const skipped = []
function skip(reason) {
  skipped.push(reason)
  console.log("[rtl-verif] SKIP: " + reason)
}
function fail(msg) {
  console.error("[rtl-verif] FAIL: " + msg)
  process.exit(1)
}
function siliconPresent() {
  return existsSync(join(SILICON, "package.json"))
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
    const m = raw.match(/^ {4}- id: ['\"]?([A-Za-z0-9_.-]+)['\"]?\s*$/)
    if (m) ids.push(m[1])
  }
  return ids
}

function selfTest() {
  // golden fixture semantics: 3+4 must equal 7 (the asserted value)
  if (!GOLDEN_ADDER_V.includes("i_a + i_b") || !GOLDEN_ADDER_TB.includes("dut.o_sum.value == 7") || !GOLDEN_ADDER_TB.includes("i_b.value = 4")) {
    fail("golden fixture semantics")
  }
  if (!siliconPresent()) {
    skip(`silicon bundle not present at ${SILICON} (set MPD_SILICON_ROOT) — bundle-side groups skipped`)
  } else {
    // patch shape: four additive rows, zero id-targets, no checkout-absolute path
    const patch = readFileSync(PATCH, "utf8")
    const ids = insertIds(patch)
    if (ids.length !== SILICON_ROWS.length) fail(`silicon patch declares ${ids.length} row ids, expected ${SILICON_ROWS.length}`)
    for (const row of SILICON_ROWS) {
      if (!ids.includes(row)) fail("silicon patch is missing row id: " + row)
    }
    if (/^- id:/m.test(patch)) fail("silicon patch carries an id-target (must be additive-only)")
    if (patch.includes("/root/")) fail("checkout-absolute path in the silicon patch")
    // plugin dist surface: the eight-tool owner surface + iron-rule strings
    if (!existsSync(VERIF_DIST)) fail("silicon plugin dist missing (bun build first): " + VERIF_DIST)
    const dist = readFileSync(VERIF_DIST, "utf8")
    for (const tool of EIGHT_TOOLS) {
      if (!dist.includes('name: "' + tool + '"')) fail("dist missing tool surface " + tool)
    }
    for (const iron of ["MPD_DSH_VERIF_VENV", ".venv-rtl", "cocotb>=2.0", "VERIF_E_NO_VENV"]) {
      if (!dist.includes(iron)) fail("dist missing iron-rule string " + iron)
    }
    // corpus shape: EXACTLY the three trees, with their pinned file counts
    const trees = readdirSync(SKILLS, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort()
    if (JSON.stringify(trees) !== JSON.stringify(Object.keys(TREES).sort())) fail("skills/ trees = [" + trees.join(", ") + "] but expected [" + Object.keys(TREES).sort().join(", ") + "]")
    for (const [tree, count] of Object.entries(TREES)) {
      const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]))
      const files = walk(join(SKILLS, tree))
      if (files.length !== count) fail(`${tree}: ${files.length} files, expected ${count}`)
    }
    // profile data: the definition this bundle owns (mpd's carrier injects it)
    const data = JSON.parse(readFileSync(PRESET, "utf8"))
    const profile = data["rtl-ip"] ?? data
    if ((profile.members ?? []).length !== 7) fail("preset profile does not declare 7 members")
    const protocol = String(profile.protocol ?? "")
    for (const marker of ["STAGE 0", "IP01", "STAGE 4"]) {
      if (!protocol.includes(marker)) fail("preset profile missing marker: " + marker)
    }
    // HDL LSP registry: assets are t16's; assert them when present, else skip loudly
    if (!existsSync(LSP_CLI)) {
      skip("HDL LSP registry not asserted: " + LSP_CLI + " not present yet (task t16; the row ships disabled:true by design)")
    } else {
      const cli = readFileSync(LSP_CLI, "utf8")
      for (const reg of LSP_REGISTRY) {
        if (!cli.includes(reg)) fail("lsp registry entry missing: " + reg.slice(0, 80))
      }
    }
  }
  console.log("[rtl-verif self-test] ok: golden fixture + silicon patch (4 additive rows, no id-target, no absolute path) + eight-tool dist surface + iron-rule strings + three corpus trees + preset profile" + (skipped.length > 0 ? ` (${skipped.length} group(s) skipped — see SKIP lines)` : ""))
}

function venvPreflight() {
  const reasons = []
  for (const venv of VENV_CANDIDATES) {
    const python = join(venv, "bin", "python")
    if (!existsSync(python)) { reasons.push(venv + ": no bin/python"); continue }
    const p = spawnSync(python, ["-c", "import cocotb; print(cocotb.__version__)"], { encoding: "utf8", timeout: 60000 })
    if (p.status !== 0) { reasons.push(venv + ": cocotb not importable"); continue }
    return { ok: true, venv, cocotb: (p.stdout || "").trim() }
  }
  return { ok: false, venv: null, reason: reasons.join("; ") || "no candidate venv path" }
}

function findOne(dir, name) {
  let hit = null
  const walk = (d) => {
    if (hit || !existsSync(d)) return
    let entries
    try { entries = readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (hit) return
      const p = join(d, e.name)
      if (e.isDirectory()) { if (e.name !== "sim_build") walk(p) }
      else if (e.name === name) hit = p
    }
  }
  walk(dir)
  return hit
}

async function runReal() {
  if (!siliconPresent()) {
    skip(`silicon bundle not present at ${SILICON} — the case needs the checkout to install (set MPD_SILICON_ROOT)`)
    console.log("[rtl-verif] PASS (nothing to probe: bundle absent)")
    return
  }
  const version = spawnSync("dsh", ["--version"], { encoding: "utf8", timeout: 60000 })
  if (version.error || version.status !== 0) {
    skip("dsh CLI not available on PATH — PHASE 1 (install + composed boot) cannot run")
    console.log("[rtl-verif] PASS (install/boot phase skipped)")
    return
  }
  const venv = venvPreflight()
  if (!venv.ok) {
    skip("cocotb segment skipped: " + venv.reason + " — bootstrap once with: python3 -m venv .venv-rtl && .venv-rtl/bin/pip install \"cocotb>=2.0\" (or mpd_verif_venv action=create)")
  }

  const sandbox = mkdtempSync(join(tmpdir(), "mpd-dsh-qa-"))
  const proj = join(sandbox, "golden")
  mkdirSync(join(proj, "rtl"), { recursive: true })
  writeFileSync(join(proj, "rtl", "adder.v"), GOLDEN_ADDER_V)
  writeFileSync(join(proj, "rtl", "adder_tb.py"), GOLDEN_ADDER_TB)
  Object.assign(process.env, {
    DSH_HOME: sandbox,
    HOME: sandbox,
    DSH_WORKSPACE_ROOT: proj,
    ...(venv.ok ? { MPD_DSH_VERIF_VENV: venv.venv } : {}),
  })
  const env = { ...process.env }

  // PHASE 1: isolated install + composed boot (no model; dump-config only)
  const add = spawnSync("dsh", ["plugin", "--profile", "rtl-verif-qa", "add", SILICON], { env, cwd: proj, encoding: "utf8", timeout: 600000 })
  if (add.status !== 0) fail("dsh plugin add failed: " + (add.stderr || add.stdout || "").slice(-400))
  const dumpRun = spawnSync("dsh", ["--profile", "rtl-verif-qa", "--dump-config"], { env, cwd: proj, encoding: "utf8", timeout: 180000 })
  const dump = (dumpRun.stdout || "") + (dumpRun.stderr || "")
  const rowsMissing = SILICON_ROWS.filter((row) => !new RegExp(`^- id: ${row}$`, "m").test(dump))
  const duplicateId = dump.includes("duplicate loader entry id")
  const staleMpdVerif = /^- id: mpd-verif$/m.test(dump)
  const mountOk = dumpRun.status === 0 && rowsMissing.length === 0 && !duplicateId && !staleMpdVerif
  const realHome = join(homedir(), ".dsh")
  const realHomeLeak = !dump.includes(sandbox) && dump.includes(realHome)

  // The HDL LSP registry is asserted in the self-test (t16 owns the assets).
  let flow = { ok: false, detail: "not-run" }
  let lintOk = false
  let simOk = null
  let regressOk = null
  let vcdHit = ""
  let noFstAssert = false
  let makefileOk = false
  let simXml = ""
  let regressPassed = null
  try {
    const mod = await import(pathToFileURL(VERIF_DIST).href + "?qa=" + Date.now())
    const probes = mod.probeAll()
    const venvSt = mod.venvStatus()
    const backend = ["verilator", "iverilog"].find((name) => probes.some((b) => b.backend === name && b.present))
    if (!backend) {
      skip("no open-source backend on PATH — lint/sim/regress skipped (set MPD_DSH_VERIF_IVERILOG or MPD_DSH_VERIF_VERILATOR)")
      flow = { ok: false, detail: "no-backend" }
    } else {
      const lint = mod.verifCompile({ backend, sources: [join(proj, "rtl", "adder.v")], target: "lint" })
      lintOk = Boolean(lint.ok)
      if (venv.ok) {
        const sim = await mod.verifSim({ backend, top: "adder", sources: [join(proj, "rtl", "adder.v")], tbModules: ["adder_tb"], seed: 4242, waves: true, traceFst: false, timeoutSec: 300 }, {})
        const regress = await mod.verifRegress({ backend, cases: ["smoke_add"], seedBase: 20260831, waveHook: false, stopOnError: true, sim: { top: "adder", sources: [join(proj, "rtl", "adder.v")], tbModules: ["adder_tb"], traceFst: false, waves: true } }, {})
        simOk = Boolean(sim.ok)
        regressOk = Boolean(regress.ok)
        flow = { ok: lint.ok && sim.ok && regress.ok, detail: `${backend} lint=${lint.ok} sim=${sim.ok} regress=${regress.ok} venv=${venvSt.verdict}` }
      } else {
        simOk = null
        regressOk = null
        flow = { ok: lint.ok, detail: `${backend} lint=${lint.ok} sim=skipped regress=skipped venv=${venvSt.verdict}` }
      }
    }
  } catch (e) {
    flow = { ok: false, detail: String(e) }
  }

  if (venv.ok) {
    const xmlPath = findOne(join(proj, ".mpd", "verif", "sim"), "results.xml")
    simXml = xmlPath ? readFileSync(xmlPath, "utf8") : ""
    vcdHit = findOne(join(proj, ".mpd", "verif", "sim"), "dump.vcd") ?? ""
    noFstAssert = !findOne(join(proj, ".mpd", "verif", "sim"), "dump.fst")
    const makefileHit = findOne(join(proj, ".mpd", "verif", "sim"), "Makefile")
    makefileOk = makefileHit ? readFileSync(makefileHit, "utf8").includes("COCOTB_TOPLEVEL := adder") : false
    const regressJsonPath = findOne(join(proj, ".mpd", "verif", "regress"), "results.json")
    const regressJson = regressJsonPath ? JSON.parse(readFileSync(regressJsonPath, "utf8")) : null
    regressPassed = regressJson ? Number(regressJson.passed) : null
    simOk = simXml.includes("smoke_add") && simXml.includes("<testcase") && !simXml.includes("<failure")
    regressOk = regressJson !== null && Number(regressJson.passed) >= 1
  }
  const sysPython = spawnSync("python3", ["-c", "import cocotb"], { encoding: "utf8", timeout: 30000 })
  const sysPythonFree = sysPython.status !== 0
  const cocotbOk = !venv.ok || (simOk === true && vcdHit.length > 0 && noFstAssert && makefileOk && regressOk === true)
  const ok = mountOk && !realHomeLeak && sysPythonFree && cocotbOk && (flow.detail.startsWith("no-backend") || lintOk)

  const outDir = join(repoRoot, "evidence", "dsh-qa", "rtl-verif", new Date().toISOString().replaceAll(":", "-"))
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, "result.json"), JSON.stringify({
    ok,
    siliconRoot: SILICON,
    dumpExit: dumpRun.status,
    rowsComposed: rowsMissing.length === 0,
    rowsMissing,
    duplicateLoaderId: duplicateId,
    staleMpdVerifRow: staleMpdVerif,
    mountOk,
    realHomeUntouched: !realHomeLeak,
    venvCocotb: venv.ok ? venv.cocotb : null,
    venvSkips: venv.ok ? [] : [venv.reason],
    lintOk,
    simOk,
    regressPassed,
    resultsXml: Boolean(simXml.length),
    vcd: Boolean(vcdHit),
    noFst: noFstAssert,
    makefileFlow: makefileOk,
    systemPythonCocotbFree: sysPythonFree,
    flow: flow.detail,
    skips: skipped,
  }, null, 2) + "\n")
  writeFileSync(join(outDir, "output.log"), dump + "\n=== PHASE 2 ===\n" + flow.detail + "\n")
  console.log("[rtl-verif] ok=" + ok + " -> " + outDir)
  if (!ok) {
    console.error("[rtl-verif] FAIL hints: mountOk=" + mountOk + " rowsMissing=" + JSON.stringify(rowsMissing) + " duplicateId=" + duplicateId + " staleMpdVerif=" + staleMpdVerif + " flow=" + flow.detail + " cocotb=" + cocotbOk + " pyFree=" + sysPythonFree + " simXml=" + simXml.slice(0, 200))
    console.error("[rtl-verif] dump excerpt (last 1200 chars):\n" + dump.slice(-1200))
    process.exit(1)
  }
  console.log("[rtl-verif] PASS")
}

const argv = process.argv.slice(2)
if (argv.includes("--self-test")) selfTest()
else runReal()