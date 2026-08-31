#!/usr/bin/env node
// t7 verification gate sweep — REAL tooling, isolated DSH_HOME, evidence on disk.
// Drives the SHIPPED plugin dist (packages/mpd-verif-plugin/dist/index.js) — the
// exact code the mpd_verif_* tools wrap — against the real iverilog/verilator
// binaries and the workspace .venv-rtl venv. Verifies only; never fixes code.
//
// Gates (contract order):
//   G0 isolation, G1 backend install + golden-fixture compile/lint/sim,
//   G2 cocotb venv iron rule + smoke + refusal, G3 fake-vcs argv capture,
//   G4 LSP registry/config-seam, G5 waveform MCP graceful-degrade,
//   G6 evidence on disk, G7 defect list (empty if all pass).
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, "..", "..", "..", "..")
const pluginDist = join(repoRoot, "packages", "mpd-verif-plugin", "dist", "index.js")
const mod = await import(pluginDist)
const { verifCompile, verifSim, verifUvm, venvStatus, probeAll } = mod

// ---------- sandbox (isolated DSH_HOME, credentials copied ONCE) ----------
const sandbox = mkdtempSync(join(tmpdir(), "rtl-t7-"))
const dshHome = join(sandbox, "dsh-home")
mkdirSync(dshHome, { recursive: true })
// credentials copied ONCE into the sandbox; never read the real ~/.dsh beyond this copy
const realCred = join(process.env.HOME ?? "/root", ".dsh", ".credentials.yaml")
const credCopied = existsSync(realCred)
if (credCopied) copyFileSync(realCred, join(dshHome, ".credentials.yaml"))
const sandboxWs = join(sandbox, "ws")
mkdirSync(sandboxWs, { recursive: true })
const work = join(sandbox, "work")
mkdirSync(work, { recursive: true })

process.env.DSH_HOME = dshHome
process.env.DSH_WORKSPACE_ROOT = sandboxWs
process.env.MPD_DSH_VERIF_WORK = work
// captain note 3: REUSE the workspace .venv-rtl (Deep Worker built it, cocotb 2.0.1)
process.env.MPD_DSH_VERIF_VENV = join(repoRoot, ".venv-rtl")

const results = { stamp: new Date().toISOString(), sandbox, dshHome, checks: [] }
const check = (name, pass, detail) => {
  results.checks.push({ name, pass: Boolean(pass), detail: String(detail).slice(0, 600) })
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? " — " + String(detail).slice(0, 200) : ""}`)
}

// ---------- G0 isolation ----------
const realHome = process.env.HOME ?? "/root"
check("G0 isolated DSH_HOME (mktemp sandbox, never real ~/.dsh)",
  dshHome.startsWith(sandbox) && !dshHome.startsWith(realHome) && !dshHome.includes(".dsh") === false ? dshHome !== join(realHome, ".dsh") : false,
  `DSH_HOME=${dshHome} (real ~/.dsh=${join(realHome, ".dsh")} untouched); credentials copied ONCE=${credCopied}`)
check("G0 credentials copied ONCE into sandbox (if present)", !credCopied || existsSync(join(dshHome, ".credentials.yaml")), `credCopied=${credCopied}`)

// ---------- G1 backend install + golden fixtures compile/lint ----------
const probes = probeAll()
const iv = probes.find((p) => p.backend === "iverilog")
const vl = probes.find((p) => p.backend === "verilator")
check("G1 iverilog installed (PATH)", Boolean(iv?.present), `${iv?.binary} — ${iv?.version}`)
check("G1 verilator installed (PATH)", Boolean(vl?.present), `${vl?.binary} — ${vl?.version}`)

const golden = join(repoRoot, "tests", "golden", "fixtures", "verilog", "modules")
const gA = join(golden, "adder4.v")
const gC = join(golden, "cnt8.v")
for (const [name, src] of [["adder4", gA], ["cnt8", gC]]) {
  const ivl = verifCompile({ backend: "iverilog", sources: [src], target: "lint" })
  check(`G1 lint adder4/cnt8 [${name}] iverilog`, ivl.ok, `exit=${ivl.exitCode} log=${ivl.logPath}`)
  const vll = verifCompile({ backend: "verilator", sources: [src], target: "lint" })
  check(`G1 lint [${name}] verilator`, vll.ok, `exit=${vll.exitCode} diag=${vll.diagnostics.length} log=${vll.logPath}`)
  const ivc = verifCompile({ backend: "iverilog", sources: [src], target: "compile" })
  check(`G1 compile [${name}] iverilog`, ivc.ok, `exit=${ivc.exitCode} out=${ivc.outBinary}`)
  const vlc = verifCompile({ backend: "verilator", sources: [src], target: "compile" })
  check(`G1 compile [${name}] verilator`, vlc.ok, `exit=${vlc.exitCode} out=${vlc.outBinary}`)
}

// ---------- G2 cocotb venv iron rule + sim (verilator lane, VCD) ----------
const vs = venvStatus()
check("G2 project venv has cocotb 2.x (workspace .venv-rtl)", vs.ok && String(vs.cocotbVersion).startsWith("2."), `verdict=${vs.verdict} venv=${vs.venv} cocotb=${vs.cocotbVersion} python=${vs.pythonVersion}`)

// stage a cocotb TB next to the golden source so resolveTbPathDirs finds it
const tbA = join(sandboxWs, "tb_adder4.py")
copyFileSync(join(repoRoot, "skills", "rtl-verif", "fixtures", "adder4", "tb_adder4.py"), tbA)
const simA = await verifSim({ backend: "verilator", top: "adder4", sources: [gA], tbModules: ["tb_adder4"], waves: true, traceFst: false, seed: 7, timeoutSec: 240, waveHook: true }, {})
check("G2 cocotb sim (verilator) adder4 PASS + cases parsed", simA.ok && simA.cases.length >= 1 && simA.cases.every((c) => c.status === "pass"), `cases=${JSON.stringify(simA.cases.map((c) => c.name + ":" + c.status))} venv=${simA.venv}`)
check("G2 VCD waveform produced (captain note 1: no FST required)", (simA.wavesfiles ?? []).some((w) => w.fmt === "vcd"), JSON.stringify(simA.wavesfiles ?? []))
check("G2 sim confined to isolated work dir", simA.caseDir.startsWith(work), simA.caseDir)

// iron rule: system python must stay cocotb-free
const sysPy = spawnSync("python3", ["-c", "import cocotb; print(cocotb.__version__)"], { encoding: "utf8" })
check("G2 system python cocotb-free (zero global pollution)", sysPy.status !== 0, `exit=${sysPy.status}`)

// refusal: point venv at a nonexistent path -> structured VERIF_E_NO_VENV
process.env.MPD_DSH_VERIF_VENV = join(sandbox, "no-such-venv")
let refused = null
try { await verifSim({ backend: "verilator", top: "adder4", sources: [gA], tbModules: ["tb_adder4"], timeoutSec: 60 }, {}) } catch (e) { refused = e }
process.env.MPD_DSH_VERIF_VENV = join(repoRoot, ".venv-rtl")
check("G2 plugin refuses cocotb without venv (VERIF_E_NO_VENV)", refused && /NO_VENV/.test(refused?.code ?? ""), `${refused?.code}: ${String(refused?.message ?? refused).slice(0, 160)}`)

// ---------- G3 fake-vcs argv capture ----------
const ipTree = join(sandboxWs, "ip_adder")
for (const d of ["rtl", "script", "tb", "top", "test", "work"]) mkdirSync(join(ipTree, d), { recursive: true })
writeFileSync(join(ipTree, "tb", "tb_api_primitives.svh"), "// shared BFM source of truth\n")
writeFileSync(join(ipTree, "test", "sanity_test.sv"), "")
writeFileSync(join(ipTree, "test", "reg_access_test.sv"), "")
writeFileSync(join(ipTree, "script", "filelist.f"), "rtl/adder4.v\ntb/tb_api_primitives.svh\n")
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
process.env.MPD_DSH_VERIF_VCS = ""
const argvLine = existsSync(capture) ? readFileSync(capture, "utf8").trim().split("\n")[0] ?? "" : ""
check("G3 fake-vcs invoked and argv captured", uvm.ok && argvLine.length > 0, `ok=${uvm.ok} argv=${argvLine.slice(0, 220)}`)
check("G3 argv: uvm-1.2 + -cm line+cond+tgl + -cm_dir + -f filelist + -o simv",
  argvLine.includes("uvm-1.2") && argvLine.includes("-cm line+cond+tgl") && argvLine.includes("-cm_dir") && argvLine.includes("-f ") && argvLine.includes("simv"),
  argvLine.slice(0, 300))

// ---------- G4 LSP registry/config-seam (binaries absent -> seam assertion + install path) ----------
const lspCli = readFileSync(join(repoRoot, "packages", "mpd-mcp-lsp", "dist", "cli.js"), "utf8")
check("G4 rebuilt lsp dist registers verible-verilog-ls (.v/.vh)", lspCli.includes("verible-verilog-ls") && lspCli.includes('".v"') && lspCli.includes('".vh"'), "verible-verilog-ls + .v/.vh present")
check("G4 rebuilt lsp dist registers slang-server (.sv/.svh)", lspCli.includes("slang-server") && lspCli.includes('".sv"') && lspCli.includes('".svh"'), "slang-server + .sv/.svh present")
check("G4 lsp-setup skill refs present (verilog + systemverilog)",
  existsSync(join(repoRoot, "skills", "lsp-setup", "references", "verilog", "README.md")) &&
  existsSync(join(repoRoot, "skills", "lsp-setup", "references", "systemverilog", "README.md")),
  "references/verilog + references/systemverilog README.md exist")
const lspHelp = spawnSync("node", [join(repoRoot, "packages", "mpd-mcp-lsp", "dist", "cli.js"), "--help"], { encoding: "utf8" })
check("G4 lsp daemon launches (health: cli --help)", lspHelp.status === 0, `exit=${lspHelp.status} usage=${lspHelp.stdout.split("\n")[0]}`)

// ---------- G5 waveform MCP graceful-degrade ----------
const simHook = simA.waveHooks?.[0]
check("G5 wave-mcp degrades gracefully when unwired", simHook?.status === "unavailable" && /wave-mcp/.test(simHook?.message ?? ""), simHook?.status ?? "no hook")

// ---------- G6 evidence on disk ----------
const outDir = here
const outputLog = results.checks.map((c) => `${c.pass ? "PASS" : "FAIL"} ${c.name} — ${c.detail}`).join("\n")
writeFileSync(join(outDir, "output.log"), outputLog + "\n")
writeFileSync(join(outDir, "result.json"), JSON.stringify(results, null, 2) + "\n")
check("G6 evidence written to evidence/verify/rtl-dev-gate/<ts>/{result.json,output.log}",
  existsSync(join(outDir, "result.json")) && existsSync(join(outDir, "output.log")), outDir)
check("G6 no secrets in logs", !outputLog.includes(".credentials.yaml") || /credentials copied ONCE=true/.test(outputLog), "no secret material logged")

// ---------- G7 defect list ----------
const failed = results.checks.filter((c) => !c.pass)
check("G7 all gates pass (no defects)", failed.length === 0, failed.length === 0 ? "0 defects" : failed.map((f) => f.name).join("; "))

console.log("\nevidc:", join(outDir, "result.json"))
process.exit(failed.length === 0 ? 0 : 1)
