// One-shot probe: run the SAME session-scoped regression the unit test runs and
// print the per-case outcome + refusal, so the pre-fix and post-fix mechanism is
// legible side by side. Run with the pre-fix shape applied and again after restore.
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { verifRegress } from "../../../packages/mpd-verif-plugin/src/regress"
import { fakeMakeScript, guardEnv, makeSandbox, PASS_XML, writeBin, writeText } from "../../../packages/mpd-verif-plugin/test/helpers"

const s = makeSandbox()
const g = guardEnv()
try {
  const sessionWs = join(s, "ws")
  const sessionVenv = join(sessionWs, ".venv-rtl")
  const pyCapture = join(s, "session-py.log")
  writeBin(join(sessionVenv, "bin"), "python", `#!/bin/sh
echo "$0 $*" >> "${pyCapture}"
if [ "$1" = "--version" ]; then echo "Python 3.12.1 (fake)"; exit 0; fi
if [ "$1" = "-c" ]; then echo '{"v": "2.0.1", "ok": true}'; exit 0; fi
exit 0
`)
  process.env.DSH_WORKSPACE_ROOT = join(s, "other")
  process.env.MPD_DSH_VERIF_WORK = join(s, "work")
  delete process.env.MPD_DSH_VERIF_VENV
  process.env.MPD_DSH_VERIF_IVERILOG = writeBin(join(s, "fakebin"), "iverilog", `#!/bin/sh
if [ "$1" = "-V" ]; then echo "Icarus Verilog version 12.0"; exit 0; fi
exit 0
`)
  writeBin(join(s, "fakebin"), "make", fakeMakeScript({ capture: join(s, "fake-make.log") }))
  process.env.PATH = join(s, "fakebin") + ":" + (process.env.PATH ?? "")
  process.env.FAKE_COCOTB_VERSION = "2.0.1"
  process.env.FAKE_RESULTS_XML_FILE = writeText(join(s, "pass.xml"), PASS_XML)
  writeText(join(sessionWs, "adder.v"), "module adder; endmodule")

  const exec = { agent: { session: { header: { cwd: sessionWs } } } }
  const r = await verifRegress({ backend: "iverilog", cases: ["case_a"], sim: { top: "adder", sources: ["adder.v"], tbModules: ["adder_tb"] } }, undefined, exec)
  console.log(JSON.stringify({
    sessionWorkspace: sessionWs,
    dshWorkspaceRoot: process.env.DSH_WORKSPACE_ROOT,
    perCaseStatus: r.cases[0]?.status ?? null,
    perCaseFailure: r.cases[0]?.failureMsg ?? null,
    passed: r.passed,
    ok: r.ok,
    sessionPythonProbed: existsSync(pyCapture) ? readFileSync(pyCapture, "utf8").trim().split("\n") : [],
  }, null, 2))
} finally {
  g.restore()
}
