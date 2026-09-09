#!/usr/bin/env node
// Case rtl-verif: verify the RTL dev phase-1 deliverable end-to-end in an
// isolated DSH_HOME. TWO-PHASE (deterministic; no LLM session needed, so the
// case stays runnable on credential-less QA boxes):
//   PHASE 1 (isolated boot mount) — dev-flavor checkout boot of the REAL
//     bundle patch (t9 wired the mpd-verif row into cordis.patch.yml; the
//     mcp-wave-mcp/mcp-traceweave rows are OPTIONAL and stay COMMENTED by
//     default — boot-safety: an uninstalled/mismatched external Python MCP
//     server crashed the client at boot).
//     `dsh --profile headless --dump-config` must show the mpd-verif and
//     mcp-lsp rows mounted (wave rows absent is the expected default); the
//     segment-B LSP rebuild is asserted on the shipped cli.js (BOTH builtin
//     definitions present: verible-verilog-ls + slang-server).
//   PHASE 2 (real tool flow, same isolated env) — drive the mpd_verif_* core
//     directly (same plugin dist, DSH_HOME/DSH_WORKSPACE_ROOT sandboxed) with
//     REAL verilator on a golden adder fixture (3+4=7): backends probe, venv
//     iron-rule status, lint with zero diagnostics, cocotb Makefile-flow sim
//     (seed 4242, traceFst:false — VCD is the machine standard; never assert
//     .fst), 1-case regression; results.xml/VCD/results.json asserted on disk.
//   iron rule  — after everything, the SYSTEM python must still fail
//     `import cocotb` (zero global pollution), asserted script-side.
// Note: a model-driven mcp__lsp__status call was dropped because headless LLM
// sessions fail with MISSING_CREDENTIAL on this box before any tool call; t7's
// sweep can complement with model-driven calls once credentials are hostable.
// --self-test is the offline self-test (no network, no real tooling, no model).
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, writeFileSync, closeSync, statSync } from "node:fs"
import { tmpdir, homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
const VERIF_DIST = join(repoRoot, "packages/mpd-verif-plugin/dist/index.js")
const DEFAULT_VENV = join(repoRoot, ".venv-rtl")
const EIGHT_TOOLS = ["mpd_verif_venv", "mpd_verif_backends", "mpd_verif_compile", "mpd_verif_lint", "mpd_verif_sim", "mpd_verif_coverage", "mpd_verif_uvm", "mpd_verif_regress"]

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

// Bundle-patch wiring guard: the mpd-verif row now ships in cordis.patch.yml
// (t9 wiring), so the case boots the REAL patch (dev-flavor) — no overlay.
// A second row with the same id would fail the loader with "duplicate loader
// entry id: mpd-verif".
const WIRED_ID_PATTERN = /^\s*- id: mpd-verif$/m

// Dev-flavor rewrite of the bundle patch (mirrors preset-register.mjs): the
// committed patch uses packed `@mpd-dsh/mpd/...` names; QA boots the checkout,
// so rows resolve to checkout-absolute paths and MCP binaries pin via env. The
// preset root expression is rewritten FIRST: the generic rule would otherwise
// splice the checkout path under /node_modules and the roster root would miss.
const PACKED_PRESETS_EXPR = '"/node_modules/@mpd-dsh/mpd/presets"'
function devPatch() {
  const t = readFileSync(join(repoRoot, "packages/mpd-bundle/cordis.patch.yml"), "utf8")
  return t
    .split(PACKED_PRESETS_EXPR).join(JSON.stringify(join(repoRoot, "packages", "mpd-bootstrap-plugin", "presets")))
    .split("name: '@mpd-dsh/mpd'").join("name: '" + join(repoRoot, "packages/mpd-bundle-plugin/dist/index.js") + "'")
    .split("@mpd-dsh/mpd/").join(repoRoot + "/")
}

function mcpEnv() {
  return {
    MPD_DSH_LSP_CLI: join(repoRoot, "packages/mpd-mcp-lsp/dist/cli.js"),
    MPD_DSH_ASTGREP_CLI: join(repoRoot, "packages/mpd-mcp-astgrep/dist/cli.js"),
    MPD_DSH_GITBASH_CLI: join(repoRoot, "packages/mpd-mcp-gitbash/dist/cli.js"),
    MPD_DSH_CODEGRAPH_CLI: join(repoRoot, "packages/mpd-mcp-codegraph/dist/serve.js"),
  }
}

function selfTest() {
  // bundle patch wiring (t9): exactly one ACTIVE mpd-verif row; the waveform-read
  // rows must stay COMMENTED by default (boot-safety vs missing/mismatched
  // external Python MCP SDK) — only their example text must be in the patch;
  // no checkout-absolute paths anywhere
  const bundleSrc = readFileSync(join(repoRoot, "packages/mpd-bundle/cordis.patch.yml"), "utf8")
  if ((bundleSrc.match(WIRED_ID_PATTERN) ?? []).length !== 1) { console.error("[rtl-verif self-test] FAIL: cordis.patch.yml must ship exactly one ACTIVE mpd-verif row"); process.exit(1) }
  if (bundleSrc.match(/^\s*- id: mcp-(wave-mcp|traceweave)$/m) !== null) { console.error("[rtl-verif self-test] FAIL: mcp-wave-mcp/mcp-traceweave must stay commented (boot-safety; enable per guide §4)"); process.exit(1) }
  for (const row of ["mcp-wave-mcp", "mcp-traceweave"]) {
    if (!bundleSrc.includes("- id: " + row)) { console.error("[rtl-verif self-test] FAIL: cordis.patch.yml must carry the commented " + row + " example rows"); process.exit(1) }
  }
  if (bundleSrc.includes("/root/")) { console.error("[rtl-verif self-test] FAIL: checkout-absolute path in cordis.patch.yml"); process.exit(1) }
  // golden fixture semantics: 3+4 must equal 7 (the asserted value)
  if (!GOLDEN_ADDER_V.includes("i_a + i_b") || !GOLDEN_ADDER_TB.includes("dut.o_sum.value == 7") || !GOLDEN_ADDER_TB.includes("i_b.value = 4")) { console.error("[rtl-verif self-test] FAIL: golden fixture semantics"); process.exit(1) }
  // plugin dist surface: the eight-tool owner surface + iron-rule strings
  if (!existsSync(VERIF_DIST)) { console.error("[rtl-verif self-test] FAIL: plugin dist missing (bun build first)"); process.exit(1) }
  const dist = readFileSync(VERIF_DIST, "utf8")
  for (const t of EIGHT_TOOLS) {
    if (!dist.includes('name: "' + t + '"')) { console.error("[rtl-verif self-test] FAIL: dist missing tool surface " + t); process.exit(1) }
  }
  for (const iron of ["MPD_DSH_VERIF_VENV", ".venv-rtl", "cocotb>=2.0", "VERIF_E_NO_VENV"]) {
    if (!dist.includes(iron)) { console.error("[rtl-verif self-test] FAIL: dist missing iron-rule string " + iron); process.exit(1) }
  }
  // LSP dual-server REGISTRATION (captain rule — t3 segment B done → full assert):
  // the shipped lsp cli embeds the builtin registry; assert entries, commands,
  // extensions and EXT_TO_LANG mappings, not just the bare names.
  const lspCli = readFileSync(join(repoRoot, "packages/mpd-mcp-lsp/dist/cli.js"), "utf8")
  const registryChecks = [
    'verible: { command: ["verible-verilog-ls"], extensions: [".v", ".vh"] }',
    '"slang-server": { command: ["slang-server"], extensions: [".sv", ".svh"] }',
    '"download prebuilt binaries: https://github.com/chipsalliance/verible/releases"',
    '"per-platform static binaries: https://github.com/hudson-trading/slang-server/releases"',
    '".v": "verilog"',
    '".sv": "systemverilog"',
  ]
  for (const reg of registryChecks) {
    if (!lspCli.includes(reg)) { console.error("[rtl-verif self-test] FAIL: lsp registry entry missing: " + reg.slice(0, 80)); process.exit(1) }
  }
  // devPatch normalization (web-compat bare self-row must become checkout path)
  const dev = devPatch()
  if (dev.includes("name: '@mpd-dsh/mpd'")) { console.error("[rtl-verif self-test] FAIL: devPatch left a bare '@mpd-dsh/mpd' row"); process.exit(1) }
  console.log("[rtl-verif self-test] ok: bundle wiring (mpd-verif active + wave rows commented) + golden fixture + eight-tool dist surface + iron-rule strings + devPatch guard")
}

function venvPreflight() {
  const venv = process.env.MPD_DSH_VERIF_VENV ?? DEFAULT_VENV
  if (!existsSync(join(venv, "bin", "python"))) return { ok: false, venv, reason: "venv python missing" }
  const p = spawnSync(join(venv, "bin", "python"), ["-c", "import cocotb; print(cocotb.__version__)"], { encoding: "utf8", timeout: 60000 })
  if (p.status !== 0) return { ok: false, venv, reason: "cocotb not importable in venv: " + (p.stderr || "").slice(0, 200) }
  return { ok: true, venv, cocotb: (p.stdout || "").trim() }
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
  const venv = venvPreflight()
  if (!venv.ok) {
    console.error("[rtl-verif] venv preflight failed (" + venv.venv + "): " + venv.reason)
    console.error("[rtl-verif] bootstrap once (iron-rule legal): python3 -m venv .venv-rtl && .venv-rtl/bin/pip install \"cocotb>=2.0\" — or call mpd_verif_venv(action:'create')")
    process.exit(1)
  }
  const sandbox = mkdtempSync(join(tmpdir(), "mpd-dsh-qa-"))
  const proj = join(sandbox, "golden")
  mkdirSync(join(proj, "rtl"), { recursive: true })
  writeFileSync(join(proj, "rtl", "adder.v"), GOLDEN_ADDER_V)
  writeFileSync(join(proj, "rtl", "adder_tb.py"), GOLDEN_ADDER_TB)
  const bundlePatch = join(sandbox, "bundle.dev.patch.yml")
  writeFileSync(bundlePatch, devPatch())
  // apply the isolation to process.env as well: the phase-2 plugin functions
  // read process.env directly at call time (same values phase 1 receives)
  Object.assign(process.env, {
    DSH_HOME: sandbox,
    HOME: sandbox,
    DSH_WORKSPACE_ROOT: proj,
    MPD_DSH_VERIF_VENV: venv.venv,
    ...mcpEnv(),
  })
  const env = { ...process.env }
  // PHASE 1: isolated boot mount (no model; dump-config must succeed and list rows)
  const dumpLog = join(sandbox, "dump.log")
  const fd1 = openSync(dumpLog, "w")
  const boot = spawnSync("dsh", ["--profile", "headless", "--patch", bundlePatch, "--dump-config"], { env, encoding: "utf8", timeout: 180000, stdio: ["ignore", fd1, fd1], maxBuffer: 64 * 1024 * 1024 })
  closeSync(fd1)
  const dump = readFileSync(dumpLog, "utf8")
  const mountOk = boot.status === 0 && /- id: mpd-verif\b/.test(dump) && /- id: mcp-lsp\b/.test(dump) && !dump.includes("MISSING_CREDENTIAL")
  // segment-B LSP rebuild: both builtin server definitions baked into the shipped cli.js
  const lspCli = readFileSync(join(repoRoot, "packages/mpd-mcp-lsp/dist/cli.js"), "utf8")
  const lspRegistry = [
    'verible: { command: ["verible-verilog-ls"], extensions: [".v", ".vh"] }',
    '"slang-server": { command: ["slang-server"], extensions: [".sv", ".svh"] }',
    '".v": "verilog"',
    '".sv": "systemverilog"',
  ]
  const lspDual = lspRegistry.every((reg) => lspCli.includes(reg))

  // PHASE 2: real verilator flow through the exact shipped plugin code
  const mod = await import(pathToFileURL(VERIF_DIST).href + "?qa=" + Date.now())
  let flow = { ok: false, detail: "not-run" }
  try {
    const probes = mod.probeAll()
    const verilator = probes.find((b) => b.backend === "verilator")
    const venvSt = mod.venvStatus()
    const lint = mod.verifCompile({ backend: "verilator", sources: [join(proj, "rtl", "adder.v")], target: "lint" })
    const sim = await mod.verifSim({ backend: "verilator", top: "adder", sources: [join(proj, "rtl", "adder.v")], tbModules: ["adder_tb"], seed: 4242, waves: true, traceFst: false, timeoutSec: 300 }, {})
    const regress = await mod.verifRegress({ backend: "verilator", cases: ["smoke_add"], seedBase: 20260831, waveHook: false, stopOnError: true, sim: { top: "adder", sources: [join(proj, "rtl", "adder.v")], tbModules: ["adder_tb"], traceFst: false, waves: true } }, {})
    flow = { ok: true, detail: "verilator=" + (verilator?.present ?? false) + " lint=" + lint.ok + " sim=" + sim.ok + " regress=" + regress.ok, regress }
  } catch (e) {
    flow = { ok: false, detail: String(e) }
  }

  // provable artifacts on disk
  const simXml = (() => {
    const f = findOne(join(proj, ".mpd", "verif", "sim"), "results.xml")
    return f ? readFileSync(f, "utf8") : ""
  })()
  const vcdHit = findOne(join(proj, ".mpd", "verif", "sim"), "dump.vcd") ?? ""
  const regressJson = (() => {
    const f = findOne(join(proj, ".mpd", "verif", "regress"), "results.json")
    if (!f) return null
    try { return JSON.parse(readFileSync(f, "utf8")) } catch { return null }
  })()
  const noFstAssert = !findOne(join(proj, ".mpd", "verif", "sim"), "dump.fst")
  const makefileHit = findOne(join(proj, ".mpd", "verif", "sim"), "Makefile")
  const makefileOk = makefileHit ? (() => {
    const mk = readFileSync(makefileHit, "utf8")
    return mk.includes("SIM := verilator") && mk.includes("COCOTB_TOPLEVEL := adder") && mk.includes("Makefile.sim")
  })() : false
  const sysPython = spawnSync("python3", ["-c", "import cocotb"], { encoding: "utf8", timeout: 30000 })
  const realHome = join(homedir(), ".dsh")

  const simOk = simXml.includes("smoke_add") && simXml.includes("<testcase") && !simXml.includes("<failure")
  const regressOk = regressJson !== null && Number(regressJson.passed) >= 1
  const flowOk = flow.ok && simOk && vcdHit.length > 0 && noFstAssert && makefileOk && regressOk
  const ok = mountOk && lspDual && flowOk && sysPython.status !== 0 && !dump.includes(realHome)

  const outDir = join(repoRoot, "evidence", "dsh-qa", "rtl-verif", new Date().toISOString().replaceAll(":", "-"))
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, "result.json"), JSON.stringify({ ok, bootExit: boot.status, dshHomeSandbox: env.DSH_HOME === sandbox, mountMpdVerifRow: /- id: mpd-verif\b/.test(dump), mountWaveMcpRow: /- id: mcp-wave-mcp\b/.test(dump), mountTraceweaveRow: /- id: mcp-traceweave\b/.test(dump), mountMcpLspRow: /- id: mcp-lsp\b/.test(dump), lspBuiltinDual: lspDual, venvCocotb: venv.cocotb, backend: "verilator", flow: flow.detail, resultsXml: Boolean(simXml.length), vcd: Boolean(vcdHit), makefileFlow: makefileOk, regressPassed: regressJson ? regressJson.passed : null, noFst: noFstAssert, systemPythonCocotbFree: sysPython.status !== 0, realHomeUntouched: !dump.includes(realHome) }, null, 2))
  writeFileSync(join(outDir, "output.log"), dump + "\n=== PHASE2 detail ===\n" + flow.detail + "\n")
  console.log("[rtl-verif] ok=" + ok + " -> " + outDir)
  if (!ok) {
    console.error("[rtl-verif] FAIL hints: mountOk=" + mountOk + " lspDual=" + lspDual + " flow=" + flow.detail + " simXml=" + simXml.slice(0, 300) + " vcd=" + vcdHit + " makefile=" + makefileOk + " regressPassed=" + (regressJson ? regressJson.passed : null) + " pyFree=" + (sysPython.status !== 0))
    console.error("[rtl-verif] dump.log excerpt (last 1200 chars):\n" + dump.slice(-1200))
    process.exit(1)
  }
  console.log("[rtl-verif] PASS")
}

const argv = process.argv.slice(2)
if (argv.includes("--self-test")) selfTest()
else runReal()