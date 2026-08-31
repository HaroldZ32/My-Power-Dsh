// Plugin-author smoke: REAL verilator + REAL cocotb venv roundtrips through the
// BUILT dist bundle (packages/mpd-verif-plugin/dist/index.js). Evidence writes
// to this directory (results.json + per-run logs under .mpd/verif of the smoke
// workspace). Run: bun evidence/rtl-verif/t4-author-smoke/smoke.mjs
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"
import { verifCompile, verifSim, venvStatus, probeAll, verifRegress, verifCoverage } from "../../dist/index.js"

const here = dirname(fileURLToPath(import.meta.url))
const ws = join(here, "workspace")
mkdirSync(join(ws, "rtl"), { recursive: true })
process.env.DSH_WORKSPACE_ROOT = ws
process.env.DSH_HOME = join(ws, "dsh-home") // isolated: never the real ~/.dsh
process.env.MPD_DSH_VERIF_WORK = join(ws, ".mpd", "verif")
process.env.MPD_DSH_VERIF_VENV = join(here, "..", "..", "..", "..", ".venv-rtl") // workspace-local sandbox venv (cocotb 2.0.1)

const results = { stamp: new Date().toISOString(), checks: [] }
const check = (name, pass, detail) => { results.checks.push({ name, pass: Boolean(pass), detail: String(detail).slice(0, 500) }); console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? " — " + String(detail).slice(0, 160) : ""}`) }

const good = join(ws, "rtl", "good.v")
writeFileSync(good, "module good(input wire clk); always @(posedge clk) ; endmodule\n")
const bad = join(ws, "rtl", "bad.v")
writeFileSync(bad, "module bad;\n  assign q_out = missing_signal_z_nope;\nendmodule\n")

// feature 1: lint target on the real verilator
const lintOk = verifCompile({ backend: "verilator", sources: [good], target: "lint" })
check("compile/lint verilator (clean file) passes", lintOk.ok, `exit ${lintOk.exitCode}, diag=${JSON.stringify(lintOk.diagnostics)}`)

// feature 2: compile errors with line refs (error taxonomy VERIF_E_COMPILE + diagnostics)
const lintBad = verifCompile({ backend: "verilator", sources: [bad], target: "lint" })
const hasLine = lintBad.diagnostics.some((d) => d.file.endsWith("bad.v") && typeof d.line === "number")
check("compile/lint verifier error taxonomy (line refs parsed)", !lintBad.ok && lintBad.error?.code === "VERIF_E_COMPILE" && hasLine, `diag=${JSON.stringify(lintBad.diagnostics.slice(0, 3))}`)

// feature 2b (D1 repair evidence): full COMPILE target on the real toolchains
// — the plugin must pre-create the build dir before spawning (iverilog exits
// 255 with ENOENT otherwise, the review D1 repro).
const ivCompile = verifCompile({ backend: "iverilog", sources: [good], top: "good", target: "compile" })
check("compile target iverilog (build dir pre-created, binary produced)", ivCompile.ok && existsSync(ivCompile.outBinary), `exit ${ivCompile.exitCode} out=${ivCompile.outBinary}`)
const vlCompile = verifCompile({ backend: "verilator", sources: [good], top: "good", target: "compile" })
check("compile target verilator (build dir pre-created, binary produced)", vlCompile.ok && existsSync(vlCompile.outBinary), `exit ${vlCompile.exitCode} out=${vlCompile.outBinary}`)

// feature 3a: iverilog lint on the real Icarus
const ivLint = verifCompile({ backend: "iverilog", sources: [good], target: "lint" })
check("compile/lint iverilog (clean file) passes", ivLint.ok, `exit ${ivLint.exitCode}`)

// feature 3: backends probe (real machine: iverilog + verilator present via PATH)
const probes = probeAll()
check("backends auto-detect via PATH", probes.filter((p) => p.present).length >= 2, probes.map((p) => `${p.backend}=${p.present ? (p.version ?? "?") : "absent"}`).join("; "))

// feature 4: venv iron rule — status sees cocotb in the sandbox venv
const st = venvStatus()
check("venv status: cocotb 2.x inside the project venv", st.ok && st.cocotbVersion?.startsWith("2."), `verdict=${st.verdict} cocotb=${st.cocotbVersion}`)

// feature 5: REAL cocotb simulation on REAL verilator (adder smoke)
writeFileSync(join(ws, "rtl", "adder.v"), `module adder (
  input  logic [7:0] i_a,
  input  logic [7:0] i_b,
  output logic [8:0] o_sum
);
  assign o_sum = i_a + i_b;
endmodule
`)
writeFileSync(join(ws, "rtl", "adder_tb.py"), `import cocotb
from cocotb.triggers import Timer

@cocotb.test()
async def smoke_add(dut):
    dut.i_a.value = 3
    dut.i_b.value = 4
    await Timer(10, units="ns")
    assert dut.o_sum.value == 7, f"got {dut.o_sum.value}"
`)
const sim = await verifSim({ backend: "verilator", top: "adder", sources: ["rtl/adder.v"], tbModules: ["adder_tb"], seed: 4242, waves: true, traceFst: false, timeoutSec: 180 }, {})
check("cocotb sim (verilator, DP-6 Makefile flow) PASS with results.xml + cases parsed", sim.ok && sim.cases.length === 1 && sim.cases[0].status === "pass", `cases=${JSON.stringify(sim.cases.map((c) => c.name + ":" + c.status))} exit=${sim.exitCode}`)
check("generated Makefile drives make (DP-6): Makefile on disk + make invoked via venv PATH", existsSync(join(sim.caseDir, "Makefile")) && readFileSync(sim.simLog, "utf8").includes("make -f"), `makefile=${join(sim.caseDir, "Makefile")}`)
check("sim waves collected (VCD; owner FST default needs liblz4 see README)", (sim.wavesfiles ?? []).length > 0, JSON.stringify(sim.wavesfiles ?? []))
check("sim state confined to work dir", sim.caseDir.startsWith(join(ws, ".mpd", "verif")), sim.caseDir)

// feature 6: iron rule proof — SYSTEM python must still be cocotb-free after all runs
const sys = spawnSync("python3", ["-c", "import cocotb; print(cocotb.__version__)"], { encoding: "utf8" })
check("system python still cocotb-free (zero global pollution)", sys.status !== 0, `exit=${sys.status}`)

// feature 7b (owner DP-4/DP-11): real verilator coverage pipeline —
// sim coverage:true → verilator_coverage merge → annotate report
const covSim = await verifSim({ backend: "verilator", top: "adder", sources: ["rtl/adder.v"], tbModules: ["adder_tb"], waves: false, traceFst: false, coverage: true, timeoutSec: 180 }, {})
const covMerge = (() => { try { return verifCoverage({ backend: "verilator", dir: join(ws, ".mpd", "verif"), reportDir: join(ws, ".mpd", "verif", "cov_report") }) } catch (e) { return { error: e } } })()
check("verilator coverage: sim coverage run + verilator_coverage merge", covSim.ok && !covMerge.error && covMerge.ok && covMerge.datFiles.length > 0, `simOk=${covSim.ok} merged=${covMerge.mergedDat ?? "?"}`)
const covReport = !covMerge.error && covMerge.ok ? (() => { try { return verifCoverage({ backend: "verilator", action: "report", mergedDat: covMerge.mergedDat, reportDir: join(ws, ".mpd", "verif", "cov_report") }) } catch (e) { return { error: e } } })() : { ok: false }
check("verilator coverage: annotate report generated", covReport.ok, `reportDir=${covReport.reportDir ?? "?"}`)

// feature 7a: real regression through the venv (per-case seed + results.json + report)
const reg = await verifRegress({ backend: "verilator", cases: ["smoke_add"], seedBase: 20260831, waveHook: false, sim: { top: "adder", sources: ["rtl/adder.v"], tbModules: ["adder_tb"], traceFst: false } })
check("regress (verilator/cocotb) 1 case PASS with results.json + report", reg.ok && reg.total === 1 && reg.passed === 1 && existsSync(reg.resultsJson) && existsSync(reg.reportPath), `total=${reg.total} passed=${reg.passed} seed=${reg.cases?.[0]?.seed}`)

// feature 7: graceful wave-hook degrade (no MCP rows wired yet)
const hook = sim.waveHooks?.[0]
check("wave hooks degrade gracefully when unwired", hook?.status === "unavailable" && /wave-mcp/.test(hook.message), hook?.status)

writeFileSync(join(here, "results.json"), JSON.stringify(results, null, 2))
console.log("\nevidc written:", join(here, "results.json"))
process.exit(results.checks.every((c) => c.pass) ? 0 : 1)
