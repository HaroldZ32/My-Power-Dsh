// t10 review reproduction: does the cocotb IRON GATE (requireCocotbVenv <- verifSim/verifRegress)
// follow the CALLING SESSION's workspace, like the mpd_verif_venv tool does?
//
// Setup: a fake session workspace WS with a fake (but faithful) venv at WS/.venv-rtl whose python
// answers the two probes venvStatus() runs. process.cwd() is the repo root (the B1 baseline: the
// dsh launcher cwd), the session workspace is WS — exactly the scenario B1 fixes.
// DSH_WORKSPACE_ROOT is asserted UNSET (t1 F1: the installed harness never defines it).
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs"
import { join } from "node:path"
import { venvStatus, requireCocotbVenv } from "../../../packages/mpd-verif-plugin/src/venv"
import { verifSim } from "../../../packages/mpd-verif-plugin/src/sim"

const REPO = "/root/dshProj/my-power-dsh"
process.chdir("/root/dshProj")
const WS = join(REPO, ".t10-repro-ws")
const FAKE = join(WS, ".venv-rtl", "bin", "python")

const say = (k: string, v: unknown) => console.log("[t10-repro] " + k + "=" + String(v))

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

const exec = { agent: { session: { header: { cwd: WS } } } }

say("process_cwd", REPO)
say("session_ws", WS)
say("DSH_WORKSPACE_ROOT", JSON.stringify(process.env.DSH_WORKSPACE_ROOT ?? null))

// 1) the TOOL path (exec threaded): must resolve the session workspace
const stTool = venvStatus(undefined, exec)
say("venvStatus_WITH_exec.ok", stTool.ok)
say("venvStatus_WITH_exec.venv", stTool.venv)

// 2) the LANE GATE (no exec parameter exists on requireCocotbVenv)
let gateErr: any = null
try { requireCocotbVenv() } catch (e: any) { gateErr = e }
say("requireCocotbVenv.error_code", gateErr?.code ?? "(no throw)")
say("requireCocotbVenv.message", String(gateErr?.message ?? "").slice(0, 220))

// 3) the user-visible consequence: verifSim with the same session exec
let simErr: any = null
try {
  await verifSim({ backend: "iverilog", top: "dut", sources: [join(WS, "dut.v")] } as any, {}, exec)
} catch (e: any) { simErr = e }
say("verifSim.error_code", simErr?.code ?? "(no throw)")
say("verifSim.message", String(simErr?.message ?? "").slice(0, 220))
say("verifSim.names_session_ws", String(simErr?.message ?? "").includes(WS))
say("verifSim.names_process_cwd", String(simErr?.message ?? "").includes(join(REPO, ".venv-rtl")))

// 4) sanity: with DSH_WORKSPACE_ROOT set to WS, the exec-less gate DOES pass (env fallback works)
process.env.DSH_WORKSPACE_ROOT = WS
let envGate = "passed"
try { const g = requireCocotbVenv(); envGate = "passed (" + g.venv + ")" } catch (e: any) { envGate = "threw: " + String(e?.message ?? e).slice(0, 160) }
say("requireCocotbVenv_with_env_override", envGate)
delete process.env.DSH_WORKSPACE_ROOT

say("fake_venv_exists_after", existsSync(FAKE))
rmSync(WS, { recursive: true, force: true })
say("cleanup", existsSync(WS) ? "STILL_PRESENT" : "removed")
