import { verifRegress } from "../../../packages/mpd-verif-plugin/src/regress"
process.chdir("/root/dshProj")
let e: any = null
try { await verifRegress({ backend: "iverilog", cases: ["all"] } as any) } catch (err: any) { e = err }
console.log("[t14-r1] no-session verifRegress code=" + (e?.code ?? "(no throw)"))
console.log("[t14-r1] message=" + String(e?.message ?? "").slice(0, 200))
console.log("[t14-r1] hint=" + String(e?.hint ?? "").slice(0, 160))
console.log("[t14-r1] is_VERIF_E_NO_VENV=" + (e?.code === "VERIF_E_NO_VENV"))
console.log("[t14-r1] mentions_host_workdir=" + /\/root\/dshProj\/\.mpd\/verif/.test(String(e?.message ?? "")))
