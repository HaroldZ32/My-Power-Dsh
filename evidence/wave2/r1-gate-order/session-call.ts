#!/usr/bin/env bun
// R1 real-call proof (session-scoped lane).
//
// Drives the SHIPPED dist tool `mpd_verif_regress` through its registered
// `execute(args, exec)` with a REAL session header cwd, while DSH_WORKSPACE_ROOT
// deliberately points at a DIFFERENT workspace. Proves:
//   1. the iron gate resolves the SESSION's .venv-rtl (gate passes),
//   2. a no-backend call then refuses with VERIF_E_NO_BACKEND — and creates NO
//      regress work dir in either workspace (the R1 ordering),
//   3. with a backend present the lane runs to completion and writes its
//      results.json/results.md under the SESSION workspace.
// Run: bun evidence/wave2/r1-gate-order/session-call.mjs
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { apply as applyVerif } from "../../../packages/mpd-verif-plugin/dist/index.js"

const here = dirname(fileURLToPath(import.meta.url))
const sandbox = mkdtempSync(join(tmpdir(), "mpd-r1-real-"))
const sessionWs = join(sandbox, "session-ws")
const otherWs = join(sandbox, "other-ws", "real-workspace")
mkdirSync(join(sessionWs, "rtl"), { recursive: true })
mkdirSync(otherWs, { recursive: true })
writeFileSync(join(sessionWs, "rtl", "adder.v"), "module adder; endmodule\n")

// Fake project venv at the SESSION-SCOPED default location (<session>/.venv-rtl).
const venvBin = join(sessionWs, ".venv-rtl", "bin")
mkdirSync(venvBin, { recursive: true })
const py = join(venvBin, "python")
writeFileSync(py, `#!/bin/sh
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
process.env.DSH_WORKSPACE_ROOT = otherWs
delete process.env.MPD_DSH_VERIF_WORK
delete process.env.MPD_DSH_VERIF_VENV
delete process.env.MPD_DSH_VERIF_IVERILOG
process.env.PATH = fakeBin + ":" + (process.env.PATH ?? "")
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

// Call 2: same session exec, backend now resolvable → the lane runs and writes.
process.env.PATH = fakeBin + ":" + (process.env.PATH ?? "")
const r2 = await regress.execute({ backend: "iverilog", cases: ["a"], seedBase: 20260911, waveHook: false, sim: { top: "adder", sources: ["rtl/adder.v"], waves: false, traceFst: false } }, exec)
check("call 2: the regress-level gate passed (work dir now legitimately created under the SESSION workspace)",
  typeof r2?.resultsJson === "string" && r2.resultsJson.startsWith(regressOf(sessionWs)) && existsSync(r2.resultsJson) && existsSync(r2.reportPath),
  `resultsJson=${r2?.resultsJson} reportPath=${r2?.reportPath}`)
check("call 2: the aggregated results.json/report live under the SESSION workspace, never the DSH_WORKSPACE_ROOT one",
  typeof r2?.resultsJson === "string" && r2.resultsJson.startsWith(sessionWs) && !existsSync(join(otherWs, ".mpd")),
  `${r2?.resultsJson}`)
check("call 2: report markdown aggregated the case",
  typeof r2?.reportMarkdown === "string" && r2.reportMarkdown.includes("| case | seed | status |") && r2.reportMarkdown.includes("| a |"),
  String(r2?.reportMarkdown).split("\n").slice(0, 6).join(" / "))

// Informational: a full per-case run reveals an ADJACENT, pre-existing defect
// (out of R1's objective): verifRegress calls verifSim(args, {}) without the
// `exec` it owns, so the per-case sim re-resolves the venv from
// DSH_WORKSPACE_ROOT/process.cwd() instead of the session workspace.
const simRefusal = r2?.cases?.[0]?.failureMsg ?? null
const findingF1 = {
  id: "F1-exec-not-forwarded-to-sim",
  severity: "medium",
  inR1Objective: false,
  observed: `regress-level gate passed (session venv), but the per-case sim refused: ${simRefusal}`,
  cause: "packages/mpd-verif-plugin/src/regress.ts calls `verifSim({...}, {})` — the third `exec` argument is omitted, so sim.ts resolves its gate + case dir from DSH_WORKSPACE_ROOT/process.cwd() instead of the calling session.",
  proposedFix: "forward the regress `exec`: `await verifSim({...}, {}, exec)` (one line; regression tests are exec-less and unaffected).",
}

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
  task: "t3 R1 real session-scoped call proof",
  stamp: new Date().toISOString(),
  sandbox,
  sessionWorkspace: sessionWs,
  dshWorkspaceRootOverride: otherWs,
  checks,
  call1: { error: r1?.error ?? null },
  call2: { ok: r2?.ok, total: r2?.total, passed: r2?.passed, resultsJson: r2?.resultsJson, reportPath: r2?.reportPath, perCaseFailure: simRefusal },
  findings: [findingF1],
  debug: debugDump,
  allPass: checks.every((c) => c.pass),
}
writeFileSync(join(here, "session-call.result.json"), JSON.stringify(result, null, 2))
console.log("\nwritten:", join(here, "session-call.result.json"))
process.exit(result.allPass ? 0 : 1)
