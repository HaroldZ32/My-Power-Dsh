#!/usr/bin/env node
// t7 gate sweep — phase 2: genuinely-passing cocotb sim + fake-vcs argv capture
// (defects found in phase 1 are reported precisely, NOT fixed — verification only).
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, "..", "..", "..", "..")
const mod = await import(join(repoRoot, "packages", "mpd-verif-plugin", "dist", "index.js"))
const { verifSim, verifUvm } = mod

const sandbox = mkdtempSync(join(tmpdir(), "rtl-t7b-"))
const ws = join(sandbox, "ws")
mkdirSync(join(ws, "rtl"), { recursive: true })
mkdirSync(join(sandbox, "work"), { recursive: true })
process.env.DSH_HOME = join(sandbox, "dsh-home")
process.env.DSH_WORKSPACE_ROOT = ws
process.env.MPD_DSH_VERIF_WORK = join(sandbox, "work")
process.env.MPD_DSH_VERIF_VENV = join(repoRoot, ".venv-rtl")

const results = { stamp: new Date().toISOString(), checks: [] }
const check = (name, pass, detail) => { results.checks.push({ name, pass: Boolean(pass), detail: String(detail).slice(0, 600) }); console.log(`${pass ? "PASS" : "FAIL"} ${name}`) }

// ---- genuinely-passing cocotb sim (simple adder; verilator lane, VCD) ----
const rtl = join(ws, "rtl", "adder.v")
writeFileSync(rtl, "module adder(input logic [7:0] i_a, input logic [7:0] i_b, output logic [8:0] o_sum); assign o_sum = i_a + i_b; endmodule\n")
const tb = join(ws, "rtl", "tb_adder.py")
writeFileSync(tb, `import cocotb
from cocotb.triggers import Timer

@cocotb.test()
async def smoke_add(dut):
    dut.i_a.value = 3
    dut.i_b.value = 4
    await Timer(10, units="ns")
    assert dut.o_sum.value == 7, f"got {dut.o_sum.value}"
`)
const sim = await verifSim({ backend: "verilator", top: "adder", sources: ["rtl/adder.v"], tbModules: ["tb_adder"], waves: true, traceFst: false, seed: 4242, timeoutSec: 180, waveHook: true }, {})
check("cocotb smoke (verilator) simple adder PASS", sim.ok && sim.cases.length === 1 && sim.cases[0].status === "pass", `cases=${JSON.stringify(sim.cases.map((c) => c.name + ":" + c.status))} exit=${sim.exitCode}`)
check("VCD waveform collected (captain note 1)", (sim.wavesfiles ?? []).some((w) => w.fmt === "vcd"), JSON.stringify(sim.wavesfiles ?? []))
check("wave-mcp graceful-degrade (unwired)", sim.waveHooks?.[0]?.status === "unavailable" && /wave-mcp/.test(sim.waveHooks?.[0]?.message ?? ""), sim.waveHooks?.[0]?.status)

// ---- fake-vcs argv capture ----
const ipTree = join(ws, "ip_adder")
for (const d of ["rtl", "script", "tb", "top", "test", "work"]) mkdirSync(join(ipTree, d), { recursive: true })
writeFileSync(join(ipTree, "tb", "tb_api_primitives.svh"), "// shared BFM source of truth\n")
writeFileSync(join(ipTree, "test", "sanity_test.sv"), "")
writeFileSync(join(ipTree, "test", "reg_access_test.sv"), "")
writeFileSync(join(ipTree, "script", "filelist.f"), "rtl/adder.v\ntb/tb_api_primitives.svh\n")
const capture = join(sandbox, "vcs-argv.log")
const fakeBin = join(sandbox, "fakebin")
mkdirSync(fakeBin, { recursive: true })
const fakeVcs = join(fakeBin, "vcs")
writeFileSync(fakeVcs, `#!/bin/sh
if [ "$1" = "-ID" ]; then echo "VCS 2024.06 fake"; exit 0; fi
echo "$0 $*" >> "${capture}"
exit 0
`)
chmodSync(fakeVcs, 0o755)
process.env.MPD_DSH_VERIF_VCS = fakeVcs
const uvm = await verifUvm({ action: "compile", top: ipTree, coverage: true })
delete process.env.MPD_DSH_VERIF_VCS
const argvLine = existsSync(capture) ? readFileSync(capture, "utf8").trim().split("\n")[0] ?? "" : ""
check("fake-vcs argv captured (uvm-1.2 + -cm line+cond+tgl + -f filelist + -o simv)",
  uvm.ok && argvLine.includes("uvm-1.2") && argvLine.includes("-cm line+cond+tgl") && argvLine.includes("-cm_dir") && argvLine.includes("-f ") && argvLine.includes("simv"),
  argvLine.slice(0, 320))

writeFileSync(join(here, "result-phase2.json"), JSON.stringify(results, null, 2) + "\n")
console.log("\nphase2 written:", join(here, "result-phase2.json"))
process.exit(results.checks.every((c) => c.pass) ? 0 : 1)
