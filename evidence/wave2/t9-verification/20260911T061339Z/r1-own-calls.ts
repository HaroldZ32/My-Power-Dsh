#!/usr/bin/env bun
// t9 (Reviewer) OWN R1 behavioural proof — written from scratch for this
// verification task, independent of the implementer's session-call.mjs.
//
// Drives the SHIPPED dist tool `mpd_verif_regress` through its registered
// execute(args, exec) against the REAL 13ad3e3e dist revision, in a throwaway
// sandbox, with DSH_WORKSPACE_ROOT deliberately pointing at a DIFFERENT
// workspace than the calling session.
//
// A. no-session call  -> the iron gate must refuse VERIF_E_NO_VENV (not an
//    ENOTDIR/EROFS/ENOENT filesystem error from createRegressDir) and must
//    create NO work directory at all.
// B. session-scoped call, no backend -> gate passes on the SESSION venv, then
//    the next genuine refusal is VERIF_E_NO_BACKEND, still with NO work dir in
//    either workspace.
// C. session-scoped call, backend present -> the regress-level work dir may now
//    be created (the only point where mkdir is legitimate).
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { apply as applyVerif } from "/root/dshProj/my-power-dsh/packages/mpd-verif-plugin/dist/index.js"

const here = dirname(fileURLToPath(import.meta.url))
const distSha = process.env.T9_DIST_SHA ?? "(unset)"

const sandbox = mkdtempSync(join(tmpdir(), "t9-r1-own-"))
const sessionWs = join(sandbox, "session-ws")
const otherWs = join(sandbox, "other-ws", "unrelated-root")
process.chdir(sandbox)
mkdirSync(join(sessionWs, "rtl"), { recursive: true })
mkdirSync(otherWs, { recursive: true })
writeFileSync(join(sessionWs, "rtl", "adder.v"), "module adder; endmodule\n")

// Fake project venv at the SESSION-scoped default (<session>/.venv-rtl).
const venvBin = join(sessionWs, ".venv-rtl", "bin")
mkdirSync(venvBin, { recursive: true })
const py = join(venvBin, "python")
writeFileSync(py, `#!/bin/sh
if [ "$1" = "--version" ]; then echo "Python 3.12.1 (fake)"; exit 0; fi
if [ "$1" = "-c" ]; then echo '{"v": "2.0.1", "ok": true}'; exit 0; fi
exit 0
`)
chmodSync(py, 0o755)

// Fake backend toolchain, used only by case C.
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

// The process-wide root is deliberately NOT the session workspace.
process.env.DSH_WORKSPACE_ROOT = otherWs
delete process.env.MPD_DSH_VERIF_WORK
delete process.env.MPD_DSH_VERIF_VENV
delete process.env.MPD_DSH_VERIF_IVERILOG
process.env.FAKE_RESULTS_XML_FILE = join(sandbox, "pass.xml")
writeFileSync(join(sandbox, "pass.xml"), `<?xml version="1.0" encoding="utf-8"?>
<testsuites name="results">
  <testsuite name="all" package="all" tests="1" failures="0" errors="0" skipped="0">
    <testcase name="a" classname="adder_tb" time="0.001" />
  </testsuite>
</testsuites>
`)

const registered = new Map()
const ctx = {
  tools: { register: (def) => { registered.set(def.name, def); return () => {} } },
  get: () => undefined,
}
applyVerif(ctx)
const regress = registered.get("mpd_verif_regress")
if (!regress) throw new Error("mpd_verif_regress not registered by the shipped dist")

const checks = []
const check = (name, pass, detail) => {
  checks.push({ name, pass: Boolean(pass), detail: String(detail).slice(0, 500) })
  console.log(`${pass ? "PASS" : "FAIL"} ${name} — ${String(detail).slice(0, 220)}`)
}
const regressDirOf = (ws) => join(ws, ".mpd", "verif", "regress")

// ---- A. no-session call -----------------------------------------------------
process.env.PATH = join(sandbox, "empty-bin")
const rA = await regress.execute(
  { backend: "iverilog", cases: ["a"], sim: { top: "adder", sources: ["rtl/adder.v"], waves: false, traceFst: false } },
  {},
)
check("A: no-session call refuses VERIF_E_NO_VENV (not an mkdir filesystem error)",
  rA?.error?.code === "VERIF_E_NO_VENV", `code=${rA?.error?.code} message=${rA?.error?.message}`)
check("A: no work dir created by the refused call",
  !existsSync(regressDirOf(sandbox)) && !existsSync(join(sandbox, ".mpd", "verif")), regressDirOf(sandbox))

// ---- B. session-scoped call, no backend ------------------------------------
const exec = { agent: { session: { header: { cwd: sessionWs } } } }
const rB = await regress.execute(
  { backend: "iverilog", cases: ["a"], sim: { top: "adder", sources: ["rtl/adder.v"], waves: false, traceFst: false } },
  exec,
)
check("B: session-scoped call passes the venv gate then refuses VERIF_E_NO_BACKEND",
  rB?.error?.code === "VERIF_E_NO_BACKEND", `code=${rB?.error?.code} message=${rB?.error?.message}`)
check("B: NO regress dir in the session workspace (ordering held)",
  !existsSync(regressDirOf(sessionWs)), regressDirOf(sessionWs))
check("B: NO work tree in the unrelated DSH_WORKSPACE_ROOT workspace",
  !existsSync(join(otherWs, ".mpd")), join(otherWs, ".mpd"))

// ---- C. session-scoped call with a backend present -------------------------
process.env.PATH = fakeBin + ":" + (process.env.PATH ?? "")
const rC = await regress.execute(
  { backend: "iverilog", cases: ["a"], seedBase: 20260911, waveHook: false, sim: { top: "adder", sources: ["rtl/adder.v"], waves: false, traceFst: false } },
  exec,
)
const perCaseMsg = rC?.cases?.[0]?.failureMsg ?? null
check("C: regress-level gate passed and the work dir is created under the SESSION workspace",
  existsSync(regressDirOf(sessionWs)) && !existsSync(join(otherWs, ".mpd")),
  `sessionDir=${regressDirOf(sessionWs)} otherMpd=${existsSync(join(otherWs, ".mpd"))}`)
check("C: per-case sim resolves from the SESSION workspace (no venv/workspace-resolution refusal) — t12 exec forwarding",
  perCaseMsg === null || !/venv missing|unrelated-root|other-ws/.test(perCaseMsg),
  `perCaseFailure=${perCaseMsg}`)

const result = {
  task: "t9 own R1 behavioural proof",
  stamp: new Date().toISOString(),
  distRevision: distSha,
  sandbox,
  sessionWorkspace: sessionWs,
  dshWorkspaceRootOverride: otherWs,
  callA_noSession: { error: rA?.error ?? null },
  callB_sessionNoBackend: { error: rB?.error ?? null },
  callC_sessionWithBackend: {
    ok: rC?.ok, total: rC?.total, passed: rC?.passed, resultsJson: rC?.resultsJson,
    reportPath: rC?.reportPath, perCaseFailure: perCaseMsg,
  },
  carryForwardObservation: perCaseMsg
    ? "per-case sim still refuses (t12 open at this revision): " + perCaseMsg
    : "per-case sim completed",
  debug: { sandboxFiles: existsSync(sessionWs) ? readFileSync(join(sandbox, "pass.xml"), "utf8").length : 0 },
  allPass: checks.every((c) => c.pass),
}
writeFileSync(join(here, "r1-own-calls.result.json"), JSON.stringify(result, null, 2))
console.log("\nwritten: r1-own-calls.result.json  allPass=" + result.allPass)
process.exit(result.allPass ? 0 : 1)
