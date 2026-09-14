// QA-only repair probe (t13): proves the cocotb IRON GATE follows the CALLING SESSION and that the
// workmate in-use gate refuses through the SERVICE path (agentless union) with no explicit roots.
//
// Mounted by run-repair-proof.mjs through an overlay patch row. Plain JS; the host imports it
// directly. Tool calls go through the harness runtime carrying the LIVE agent of a real gateway
// session, which is exactly what a model-initiated call carries.
// Markers: `[repair-probe] CHECK <id>=<PASS|FAIL> <detail>`; the runner parses them.
const REPO = process.env.MPD_QA_REPO
const W_BLOCKED = process.env.MPD_QA_W_BLOCKED
const W_CLEAN = process.env.MPD_QA_W_CLEAN
const VERIF_DIST = REPO + "/packages/mpd-verif-plugin/dist/index.js"

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export const name = "mpd-qa-repair-probe"
export const inject = ["tools"]

export function apply(ctx) {
  setTimeout(async () => {
    try {
      const tools = (typeof ctx.get === "function" ? ctx.get("tools") : undefined) ?? ctx.tools
      const dsh = typeof ctx.get === "function" ? ctx.get("mpdDsh") : undefined
      const agentsSvc = typeof ctx.get === "function" ? ctx.get("agents") : undefined
      const workmateSvc = typeof ctx.get === "function" ? ctx.get("mpdWorkmate") : undefined
      const verif = await import("file://" + VERIF_DIST)

      console.log("[repair-probe] HOST_CWD=" + process.cwd())
      let agents = []
      const deadline = Date.now() + 120000
      while (Date.now() < deadline) {
        try { agents = (typeof agentsSvc?.list === "function" ? agentsSvc.list() : []) ?? [] } catch { agents = [] }
        const cwds = new Set(agents.map((a) => a?.session?.header?.cwd))
        if (cwds.has(REPO) && cwds.has(W_BLOCKED) && cwds.has(W_CLEAN)) break
        await sleep(1000)
      }
      const byCwd = (p) => agents.find((a) => a?.session?.header?.cwd === p)
      const agentRepo = byCwd(REPO)
      const agentBlocked = byCwd(W_BLOCKED)
      const agentClean = byCwd(W_CLEAN)
      console.log("[repair-probe] AGENTS_FOUND=" + JSON.stringify({ repo: Boolean(agentRepo), blocked: Boolean(agentBlocked), clean: Boolean(agentClean) }))
      console.log("[repair-probe] ROOTS_ALL=" + JSON.stringify(dsh?.workspaceRootsAll?.() ?? null))

      const call = async (toolName, args, agent, tag) => {
        try {
          const raw = await tools.execute({
            name: toolName, arguments: args ?? {}, callId: "repair-probe-" + tag,
            signal: new AbortController().signal,
            ...(agent === undefined ? {} : { agent }),
          })
          const isError = raw?.isError === true
          return { ok: !isError, value: isError ? undefined : raw?.value, error: isError ? String(raw?.error?.message ?? raw?.error ?? "tool error") : "" }
        } catch (e) {
          return { ok: false, value: undefined, error: String(e?.message ?? e) }
        }
      }
      const check = (id, pass, detail) => console.log("[repair-probe] CHECK " + id + "=" + (pass ? "PASS" : "FAIL") + " " + String(detail).slice(0, 400))
      const codeOf = (r) => String(r?.value?.error?.code ?? r?.value?.error?.code ?? "")

      // ── A1: the gate's own probe resolves the SESSION venv (direct call into the shipped dist) ──
      const sessionStatus = verif.venvStatus(undefined, { agent: agentClean })
      check("V1_VENVSTATUS_SESSION", sessionStatus.ok === true && sessionStatus.venv === W_CLEAN + "/.venv-rtl",
        "ok=" + sessionStatus.ok + " venv=" + sessionStatus.venv + " cocotb=" + String(sessionStatus.cocotbVersion))

      // pre-fix shape: no exec ⇒ the dsh process cwd, where no venv exists
      const hostStatus = verif.venvStatus()
      check("V2_VENVSTATUS_NO_EXEC_HOST_ROOT", hostStatus.ok === false && hostStatus.venv === process.cwd() + "/.venv-rtl",
        "ok=" + hostStatus.ok + " venv=" + hostStatus.venv + " hostCwd=" + process.cwd())

      // ── A1 through the REAL tool boundary: the lane gate must let the call through to the
      //    backend probe (forced absent via env) instead of refusing on the venv ──
      const simSession = await call("mpd_verif_sim", { backend: "iverilog", top: "t", sources: ["t.v"] }, agentClean, "sim-session")
      check("V3_SIM_GATE_PASSES_FOR_SESSION", codeOf(simSession) === "VERIF_E_NO_BACKEND",
        "code=" + codeOf(simSession) + " msg=" + String(simSession.value?.error?.message ?? simSession.error).slice(0, 160))

      const simHost = await call("mpd_verif_sim", { backend: "iverilog", top: "t", sources: ["t.v"] }, undefined, "sim-host")
      check("V4_SIM_GATE_REFUSES_WITHOUT_SESSION",
        codeOf(simHost) === "VERIF_E_NO_VENV" && String(simHost.value?.error?.message ?? "").includes(process.cwd() + "/.venv-rtl"),
        "code=" + codeOf(simHost) + " msg=" + String(simHost.value?.error?.message ?? simHost.error).slice(0, 160))

      const regressSession = await call("mpd_verif_regress", { backend: "iverilog", cases: ["all"] }, agentClean, "regress-session")
      check("V5_REGRESS_GATE_PASSES_FOR_SESSION", codeOf(regressSession) === "VERIF_E_NO_BACKEND",
        "code=" + codeOf(regressSession) + " msg=" + String(regressSession.value?.error?.message ?? regressSession.error).slice(0, 160))

      // No-session control for regress: the call must FAIL and must not fall back to any SESSION
      // workspace. (Note the observed ordering: regress.ts creates its work dir under the resolved
      // root BEFORE the iron gate, so without a session it surfaces the host-root work-dir error
      // first — recorded verbatim, and reported as a follow-up, not a t13 regression.)
      const regressHost = await call("mpd_verif_regress", { backend: "iverilog", cases: ["all"] }, undefined, "regress-host")
      const regressHostRaw = JSON.stringify(regressHost.value ?? {}) + regressHost.error
      check("V6_REGRESS_NO_SESSION_DOES_NOT_USE_A_SESSION_WS",
        regressHost.value?.ok !== true && !regressHostRaw.includes(W_CLEAN) && !regressHostRaw.includes(W_BLOCKED),
        "code=" + codeOf(regressHost) + " msg=" + String(regressHost.value?.error?.message ?? regressHost.error).slice(0, 160))

      const info = await call("mpd_verif_venv", { action: "info" }, agentClean, "venv-info")
      check("V7_VENV_INFO_REPORTS_SESSION", info.ok === true && info.value?.venv === W_CLEAN + "/.venv-rtl",
        "venv=" + String(info.value?.venv ?? info.error))

      // ── A5: the SERVICE path (no explicit roots ⇒ agentless union of live session roots) ──
      const initGui = await call("mpd_workmate_init", { base: "oracle", name: "gui-mate-1" }, agentClean, "gui-init")
      const guiRename = (() => { try { workmateSvc.rename("gui-mate-1", "gui-mate-2"); return { ok: true } } catch (e) { return { ok: false, code: String(e?.code ?? ""), message: String(e?.message ?? e) } } })()
      check("G1_SERVICE_RENAME_REFUSED_NO_ROOTS", initGui.ok === true && guiRename.ok === false && guiRename.code === "in-use" && /blocking-team/.test(guiRename.message),
        "init=" + initGui.ok + " code=" + String(guiRename.code) + " msg=" + String(guiRename.message).slice(0, 200))

      const guiDelete = (() => { try { workmateSvc.delete("gui-mate-1"); return { ok: true } } catch (e) { return { ok: false, code: String(e?.code ?? ""), message: String(e?.message ?? e) } } })()
      check("G2_SERVICE_DELETE_REFUSED_NO_ROOTS", guiDelete.ok === false && guiDelete.code === "in-use",
        "code=" + String(guiDelete.code) + " msg=" + String(guiDelete.message).slice(0, 200))

      await call("mpd_workmate_init", { base: "oracle", name: "free-mate-1" }, agentClean, "free-init")
      const freeRename = (() => { try { const r = workmateSvc.rename("free-mate-1", "free-mate-2"); return { ok: true, name: r?.name } } catch (e) { return { ok: false, code: String(e?.code ?? ""), message: String(e?.message ?? e) } } })()
      check("G3_SERVICE_RENAME_ALLOWED_FOR_UNREFERENCED_KEY", freeRename.ok === true && freeRename.name === "free-mate-2",
        "ok=" + freeRename.ok + " name=" + String(freeRename.name ?? "") + " err=" + String(freeRename.message ?? ""))

      const roots = dsh?.workspaceRootsAll?.() ?? []
      check("G4_AGENTLESS_UNION_HAS_BOTH_SESSIONS", roots.includes(W_BLOCKED) && roots.includes(W_CLEAN) && roots.length >= 2,
        "roots=" + JSON.stringify(roots))

      console.log("[repair-probe] DONE")
    } catch (e) {
      console.log("[repair-probe] FAIL=" + String(e?.message ?? e))
    }
  }, 12000)
}
