#!/usr/bin/env bun
// R1-F1 real-call proof (session-scoped lane, SHIPPED dist).
//
// Adapted from t3's evidence/wave2/r1-gate-order/session-call.mjs: the regress
// tool is still driven through its registered execute() with a REAL session header
// cwd while DSH_WORKSPACE_ROOT points at a DIFFERENT workspace, but the per-case
// assertion is now the F1 fix. The fake session venv python records EVERY
// invocation, so "the per-case sim gated on the SESSION venv" is proven by the
// probe count (regress-level gate + per-case gate), not by a message.
// Run: bun evidence/wave2/r1-f1-exec-forward/session-call.mjs
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { apply as applyVerif } from "../../../packages/mpd-verif-plugin/dist/index.js"

const here = dirname(fileURLToPath(import.meta.url))
const sandbox = mkdtempSync(join(tmpdir(), "mpd-r1f1-real-"))
const sessionWs = join(sandbox, "session-ws")
const otherWs = join(sandbox, "other-ws", "real-workspace")
mkdirSync(join(sessionWs, "rtl"), { recursive: true })
mkdirSync(otherWs, { recursive: true })
writeFileSync(join(sessionWs, "rtl", "adder.v"), "module adder; endmodule\n")

// Fake project venv at the SESSION-SCOPED default location (<session>/.venv-rtl);
// it records EVERY invocation so the per-case probe is observable.
const venvBin = join(sessionWs, ".venv-rtl", "bin")
mkdirSync(venvBin, { recursive: true })
const pyCapture = join(sandbox, "session-py.log")
const py = join(venvBin, "python")
writeFileSync(py, `#!/bin/sh
echo "$0 $*" >> "${pyCapture}"
if [ "$1" = "--version" ]; then echo "Python 3.12.1 (fake)"; exit 0; fi
if [ "$1" = "-c" ]; then echo '{"v": "2.0.1", "ok": true}'; exit 0; fi
exit 0
`)
chmodSync(py, 0o755)

// Fake backend toolchain on PATH (no MPD_DSH_VERIF_* override on purpose).
const fakeBin = join(sandbox, "fakebin")
mkdirSync(fakeBin, { recursive: true })
writeFileSync(join(fakeBin, "iverilog"), `#!/bin/sh
if [ "$1" = "-V" ]; then echo "Icarus Verilog version 12.0"; exit 0; fi
echo "$0 $*" >> "${join(sandbox, "iverilog.log")}"
exit 0
`)
chmodSync(join(fakeBin, "iverilog"), 0o755)
writeFileSync(join(fakeBin, "make"), `#!/bin/sh
if [ -n "\${FAKE_RESULTS_XML_FILE:-}" ] && [ -f "\${FAKE_RESULTS_XML_FILE}" ]; then
  mkdir -p sim_build
  cp "\${FAKE_RESULTS_XML_FILE}" "\${COCOTB_RESULTS_FILE:-results.xml}"
fi
exit 0
`)
chmodSync(join(fakeBin, "make"), 0o755)

// Deliberately "wrong" process-wide workspace: a session-less call would land here.
const REAL_PATH = process.env.PATH ?? ""
process.env.DSH_WORKSPACE_ROOT = otherWs
delete process.env.MPD_DSH_VERIF_WORK
delete process.env.MPD_DSH_VERIF_VENV
delete process.env.MPD_DSH_VERIF_IVERILOG
process.env.PATH = fakeBin + ":" + REAL_PATH
process.env.FAKE_RESULTS_XML_FILE = join(sandbox, "pass.xml")
writeFileSync(join(sandbox, "pass.xml"), `<?xml version="1.0" encoding="utf-8"?>
<testsuites name="results">
  <testsuite name="all" package="all" tests="1" failures="0" errors="0" skipped="0">
    <testcase name="a" classname="adder_tb" time="0.001" />
  </testsuite>
</testsuites>
`)

// Register the shipped tools against a minimal harness-shaped tools service.
const registered = new Map()
const ctx = { tools: { register: (def) => { registered.set(def.name, def); return () => {} } }, get: () => undefined }
applyVerif(ctx)
const regress = registered.get("mpd_verif_regress")
if (!regress) throw new Error("mpd_verif_regress was not registered by the shipped dist")

const exec = { agent: { session: { header: { cwd: sessionWs } } } }
const checks = []
const check = (name, pass, detail) => { checks.push({ name, pass: Boolean(pass), detail: String(detail).slice(0, 400) }); console.log(`${pass ? "PASS" : "FAIL"} ${name} — ${String(detail).slice(0, 200)}`) }
const workOf = (ws) => join(ws, ".mpd", "verif")
const regressOf = (ws) => join(workOf(ws), "regress")

// Call 1: gate must pass on the SESSION venv, then refuse at backend resolution.
process.env.PATH = join(sandbox, "empty-bin")
const r1 = await regress.execute({ backend: "iverilog", cases: ["a"], sim: { top: "adder", sources: ["rtl/adder.v"], waves: false, traceFst: false } }, exec)
check("call 1 (no backend): refusal code is VERIF_E_NO_BACKEND (gate passed on the session venv; no filesystem error)",
  r1?.error?.code === "VERIF_E_NO_BACKEND", `code=${r1?.error?.code} message=${r1?.error?.message}`)
check("call 1: NO regress dir created in the session workspace (R1 ordering)",
  !existsSync(regressOf(sessionWs)), regressOf(sessionWs))
check("call 1: NO work tree created in the unrelated DSH_WORKSPACE_ROOT workspace",
  !existsSync(join(otherWs, ".mpd")), join(otherWs, ".mpd"))

// Call 2: same session exec, backend now resolvable → the lane runs and every
// per-case sim must gate on the SESSION venv (R1-F1).
process.env.PATH = fakeBin + ":" + REAL_PATH
const r2 = await regress.execute({ backend: "iverilog", cases: ["a"], seedBase: 20260911, waveHook: false, sim: { top: "adder", sources: ["rtl/adder.v"], waves: false, traceFst: false } }, exec)
check("call 2: the regression PASSES (every per-case sim got past its venv gate)",
  r2?.ok === true && r2?.passed === 1 && r2?.failed === 0 && (r2?.cases ?? []).every((c) => c.failureMsg === null) && (r2?.cases ?? []).every((c) => c.status === "pass"),
  `ok=${r2?.ok} passed=${r2?.passed} failed=${r2?.failed} cases=${JSON.stringify((r2?.cases ?? []).map((c) => `${c.test}:${c.status}:${c.failureMsg}`))}`)
check("call 2: the per-case sim gated on the SESSION venv (>=2 probe rounds: regress gate + per-case gate), never the DSH_WORKSPACE_ROOT one",
  (() => {
    const lines = existsSync(pyCapture) ? readFileSync(pyCapture, "utf8").trim().split("\n").filter(Boolean) : []
    return lines.length >= 4 && lines.every((l) => l.startsWith(py)) && lines.every((l) => !l.includes(otherWs))
  })(),
  (existsSync(pyCapture) ? readFileSync(pyCapture, "utf8").trim().split("\n").filter(Boolean) : ["<no capture>"]).join(" | ").slice(0, 380))
check("call 2: results live under the SESSION workspace, never the DSH_WORKSPACE_ROOT one",
  typeof r2?.resultsJson === "string" && r2.resultsJson.startsWith(sessionWs) && existsSync(r2.reportPath) && !existsSync(join(otherWs, ".mpd")),
  `${r2?.resultsJson}`)
check("call 2: report markdown aggregated the case as passed",
  typeof r2?.reportMarkdown === "string" && r2.reportMarkdown.includes("cases: 1, passed: 1, failed: 0"),
  String(r2?.reportMarkdown).split("\n").slice(0, 5).join(" / "))

const debugDump = (() => {
  const out = { workTree: [], simLog: null, resultsXml: null }
  const walk = (dir) => {
    if (!existsSync(dir)) return
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else out.workTree.push(p)
    }
  }
  walk(workOf(sessionWs))
  const simLog = out.workTree.find((f) => f.endsWith("sim.log"))
  if (simLog) out.simLog = readFileSync(simLog, "utf8").slice(0, 2000)
  const xml = out.workTree.find((f) => f.endsWith("results.xml"))
  if (xml) out.resultsXml = readFileSync(xml, "utf8").slice(0, 1000)
  return out
})()

const result = {
  task: "t12 R1-F1 real session-scoped call proof through the shipped dist",
  stamp: new Date().toISOString(),
  derivedFrom: "evidence/wave2/r1-gate-order/session-call.mjs (t3 harness, call-2 assertion upgraded from the F1 finding to the fix)",
  sandbox,
  sessionWorkspace: sessionWs,
  dshWorkspaceRootOverride: otherWs,
  checks,
  call1: { error: r1?.error ?? null },
  call2: { ok: r2?.ok, total: r2?.total, passed: r2?.passed, failed: r2?.failed, resultsJson: r2?.resultsJson, reportPath: r2?.reportPath, perCase: (r2?.cases ?? []).map((c) => ({ test: c.test, status: c.status, failureMsg: c.failureMsg })) },
  sessionPythonProbes: existsSync(pyCapture) ? readFileSync(pyCapture, "utf8").trim().split("\n").filter(Boolean).length : 0,
  debug: debugDump,
  allPass: checks.every((c) => c.pass),
}
writeFileSync(join(here, "session-call.result.json"), JSON.stringify(result, null, 2))
console.log("\nwritten:", join(here, "session-call.result.json"))
process.exit(result.allPass ? 0 : 1)
