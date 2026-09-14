// t14 (review round 2) — independent reproduction of the t13 F1 repair:
// does the cocotb IRON GATE now follow the CALLING SESSION, and is the fix falsifiable?
//
// Session workspace = <repo>/.t14-repro-ws (fake but faithful venv at .venv-rtl).
// process.chdir("/root/dshProj") so the HOST cwd is neither the session workspace nor venv-bearing —
// the exact B1 scenario. DSH_WORKSPACE_ROOT is asserted unset (harness never defines it).
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs"
import { join } from "node:path"
import { venvStatus, requireCocotbVenv } from "../../../packages/mpd-verif-plugin/src/venv"
import { verifSim } from "../../../packages/mpd-verif-plugin/src/sim"
import { verifRegress } from "../../../packages/mpd-verif-plugin/src/regress"

const REPO = "/root/dshProj/my-power-dsh"
const WS = join(REPO, ".t14-repro-ws")
const FAKE = join(WS, ".venv-rtl", "bin", "python")
const say = (k: string, v: unknown) => console.log("[t14-repro] " + k + "=" + String(v))

process.chdir("/root/dshProj")
rmSync(WS, { recursive: true, force: true })
mkdirSync(join(WS, ".venv-rtl", "bin"), { recursive: true })
writeFileSync(
  FAKE,
  `#!/bin/sh
if [ "$1" = "--version" ]; then echo "Python 3.11.0"; exit 0; fi
if [ "$1" = "-c" ]; then echo '{"v": "2.0.1", "ok": true}'; exit 0; fi
exit 0
`,
  { mode: 0o755 },
)
writeFileSync(join(WS, "dut.v"), "module dut; endmodule\n")

const exec = { agent: { session: { header: { cwd: WS } } } }
say("host_cwd", process.cwd())
say("session_ws", WS)
say("DSH_WORKSPACE_ROOT", JSON.stringify(process.env.DSH_WORKSPACE_ROOT ?? null))

const st = venvStatus(undefined, exec)
say("A1_venvStatus_exec.ok", st.ok)
say("A1_venvStatus_exec.venv", st.venv)

let gate: any = null
try { gate = requireCocotbVenv(undefined, exec) } catch (e: any) { gate = e }
say("A2_requireCocotbVenv_exec", gate?.venv ? "PASSED venv=" + gate.venv : "THREW " + gate?.code + " " + String(gate?.message).slice(0, 120))

let simErr: any = null
try {
  await verifSim({ backend: "iverilog", top: "dut", sources: [join(WS, "dut.v")] } as any, {}, exec)
  simErr = { code: "(no throw)" }
} catch (e: any) { simErr = e }
say("A3_verifSim_exec.code", simErr?.code)
say("A3_verifSim_exec.passed_the_gate", simErr?.code === "VERIF_E_NO_VENV" ? "NO (still blocked by the gate)" : "YES (gate passed; stopped later)")

let regErr: any = null
try {
  await verifRegress({ backend: "iverilog", cases: ["all"] } as any, undefined, exec)
  regErr = { code: "(no throw)" }
} catch (e: any) { regErr = e }
say("A4_verifRegress_exec.passed_the_gate", regErr?.code === "VERIF_E_NO_VENV" ? "NO" : "YES (code=" + regErr?.code + ")")

// Negative control: no exec ⇒ the documented host fallback still applies (agentless / unit-test path)
let noExec: any = null
try { noExec = requireCocotbVenv() } catch (e: any) { noExec = e }
say("A5_requireCocotbVenv_noExec", noExec?.code ? "THREW " + noExec.code + " :: " + String(noExec.message).slice(0, 140) : "PASSED venv=" + noExec.venv)

say("cleanup", (rmSync(WS, { recursive: true, force: true }), existsSync(WS) ? "STILL_PRESENT" : "removed"))
