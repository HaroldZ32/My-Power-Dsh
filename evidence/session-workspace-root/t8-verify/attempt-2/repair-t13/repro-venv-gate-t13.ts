// t13 repair proof for F1 — the captain's required raw check, built on the reviewer's harness
// (evidence/verification/t10-review/repro-venv-gate.ts) with the two additions the repair needs:
//   * `requireCocotbVenv(undefined, exec)` — the call the reviewer could NOT make before the fix,
//     because the function had no exec parameter at all;
//   * `verifSim(..., exec)` with the backend forced absent (env override), so "the gate passed" is
//     observable as VERIF_E_NO_BACKEND instead of a real simulation attempt.
// Setup mirrors the reviewer's: process.cwd() = /root/dshProj (the dsh launcher cwd), session
// workspace = WS, DSH_WORKSPACE_ROOT asserted UNSET (t1 F1: the installed harness never defines it).
//
// Run:  bun evidence/session-workspace-root/t8-verify/attempt-2/repair-t13/repro-venv-gate-t13.ts
// Falsifiability: with the pre-fix `requireCocotbVenv` body it reports VERIF_E_NO_VENV at the
// process root (see the companion log lines in the same file's recorded output).
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { requireCocotbVenv, venvStatus } from "../../../../../packages/mpd-verif-plugin/src/venv"
import { verifSim } from "../../../../../packages/mpd-verif-plugin/src/sim"

const REPO = "/root/dshProj/my-power-dsh"
process.chdir("/root/dshProj")
const WS = join(REPO, ".t13-repro-ws")
const FAKE = join(WS, ".venv-rtl", "bin", "python")

const say = (k: string, v: unknown) => console.log("[t13-repro] " + k + "=" + String(v))

rmSync(WS, { recursive: true, force: true })
mkdirSync(join(WS, ".venv-rtl", "bin"), { recursive: true })
writeFileSync(
  FAKE,
  `#!/bin/sh
if [ "$1" = "--version" ]; then echo "Python 3.11.0"; exit 0; fi
if [ "$1" = "-c" ]; then echo '{"v": "2.0.1", "ok": true}'; exit 0; fi
echo "fake python"; exit 0
`,
  { mode: 0o755 },
)
writeFileSync(join(WS, "dut.v"), "module dut; endmodule\n")
// Deterministic "gate passed, stopped at the backend" signal for the verifSim leg.
process.env.MPD_DSH_VERIF_IVERILOG = "/nonexistent/iverilog-fake"
process.env.MPD_DSH_VERIF_VERILATOR = "/nonexistent/verilator-fake"

const exec = { agent: { session: { header: { cwd: WS } } } }

say("process_cwd", process.cwd())
say("session_ws", WS)
say("DSH_WORKSPACE_ROOT", JSON.stringify(process.env.DSH_WORKSPACE_ROOT ?? null))

// 1) the tool-plane probe with exec (was already correct)
const stTool = venvStatus(undefined, exec)
say("venvStatus_WITH_exec.ok", stTool.ok)
say("venvStatus_WITH_exec.venv", stTool.venv)

// 2) THE FIXED CALL: the lane gate itself, with exec threaded through
let gate: any = null
let gateErr: any = null
try { gate = requireCocotbVenv(undefined, exec) } catch (e: any) { gateErr = e }
say("requireCocotbVenv_WITH_exec.error_code", gateErr?.code ?? "(no throw)")
say("requireCocotbVenv_WITH_exec.venv", gate?.venv ?? "(none)")
say("requireCocotbVenv_WITH_exec.cocotb", gate?.cocotbVersion ?? "(none)")
say("requireCocotbVenv_WITH_exec.message", String(gateErr?.message ?? "(no throw)").slice(0, 200))

// 3) the user-visible consequence: verifSim with the same session exec must get PAST the gate
let simErr: any = null
try {
  await verifSim({ backend: "iverilog", top: "dut", sources: [join(WS, "dut.v")] } as any, {}, exec)
} catch (e: any) { simErr = e }
say("verifSim_with_exec.error_code", simErr?.code ?? "(no throw)")
say("verifSim_with_exec.message", String(simErr?.message ?? "(no throw)").slice(0, 200))
say("verifSim_with_exec.is_venv_refusal", simErr?.code === "VERIF_E_NO_VENV")

// 4) NEGATIVE CONTROL (pre-fix shape): the same gate with NO exec collapses to the process root
let hostErr: any = null
try { requireCocotbVenv() } catch (e: any) { hostErr = e }
say("requireCocotbVenv_NO_exec.error_code", hostErr?.code ?? "(no throw)")
say("requireCocotbVenv_NO_exec.message", String(hostErr?.message ?? "").slice(0, 200))

// 5) sanity: the env override still wins for exec-less callers (unit-test / QA lane path)
process.env.DSH_WORKSPACE_ROOT = WS
let envGate = "passed"
try { const g = requireCocotbVenv(); envGate = "passed (" + g.venv + ")" } catch (e: any) { envGate = "threw: " + String(e?.message ?? e).slice(0, 160) }
say("requireCocotbVenv_with_env_override", envGate)
delete process.env.DSH_WORKSPACE_ROOT

say("fake_venv_exists_after", existsSync(FAKE))
rmSync(WS, { recursive: true, force: true })
say("cleanup", existsSync(WS) ? "STILL_PRESENT" : "removed")
