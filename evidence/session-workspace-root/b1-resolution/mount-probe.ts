// QA-only B1 MOUNT probe: proves the mpd plugin tree APPLIED in a real boot AND that every
// workspace/state root follows the CALLING SESSION's workspace instead of the dsh process cwd.
//
// Mounted by run-proof.mjs through an overlay patch row. The host imports this file directly, so it
// is plain JS and dependency-free. Tool calls go through the harness tool runtime carrying the LIVE
// agent of a real session (created over the gateway API with an explicit cwd), which is exactly what
// a model-initiated call carries — never a synthetic exec object.
//
// Markers are of the form `[ws-probe] CHECK <id>=<PASS|FAIL|...> <detail>`; run-proof.mjs parses them.
const REPO = process.env.MPD_QA_REPO
const W_BLOCKED = process.env.MPD_QA_W_BLOCKED
const W_CLEAN = process.env.MPD_QA_W_CLEAN

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export const name = "mpd-qa-workspace-probe"
export const inject = ["tools"]

export function apply(ctx) {
  setTimeout(async () => {
    try {
      const tools = (typeof ctx.get === "function" ? ctx.get("tools") : undefined) ?? ctx.tools
      const dsh = typeof ctx.get === "function" ? ctx.get("mpdDsh") : undefined
      const agentsSvc = typeof ctx.get === "function" ? ctx.get("agents") : undefined

      console.log("[ws-probe] HOST_CWD=" + process.cwd())
      console.log("[ws-probe] REPO=" + REPO + " W_BLOCKED=" + W_BLOCKED + " W_CLEAN=" + W_CLEAN)

      // ── wait for the three sessions run-proof.mjs creates over the gateway API ──
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
      console.log("[ws-probe] SESSION_CWDS=" + JSON.stringify(agents.map((a) => a?.session?.header?.cwd)))
      console.log("[ws-probe] AGENTS_FOUND=" + JSON.stringify({ repo: Boolean(agentRepo), blocked: Boolean(agentBlocked), clean: Boolean(agentClean) }))
      console.log("[ws-probe] ROOTS_ALL=" + JSON.stringify(dsh?.workspaceRootsAll?.() ?? null))

      const call = async (toolName, args, agent, tag) => {
        try {
          const raw = await tools.execute({
            name: toolName,
            arguments: args ?? {},
            callId: "ws-probe-" + tag,
            signal: new AbortController().signal,
            ...(agent === undefined ? {} : { agent }),
          })
          const isError = raw?.isError === true
          const error = isError ? String(raw?.error?.message ?? raw?.error ?? "tool error") : ""
          return { ok: !isError, value: isError ? undefined : raw?.value, error }
        } catch (e) {
          return { ok: false, value: undefined, error: String(e?.message ?? e) }
        }
      }
      const check = (id, pass, detail) => console.log("[ws-probe] CHECK " + id + "=" + (pass ? "PASS" : "FAIL") + " " + String(detail).slice(0, 400))
      const under = (p, root) => typeof p === "string" && (p === root || p.startsWith(root + "/"))

      // ── the four measured reproductions, each ONE session-scoped real tool call ──
      const read = await call("mpd_hashline_read", { path: "packages/mpd-hashline-plugin/package.json" }, agentRepo, "read-repo")
      check("R1_HASHLINE_RELATIVE_READ", read.ok && under(read.value?.path, REPO), "ok=" + read.ok + " path=" + String(read.value?.path ?? read.error))

      const verif = await call("mpd_verif_venv", { action: "info" }, agentRepo, "verif-repo")
      check("R2_VERIF_INFO_WORKSPACE", verif.ok && verif.value?.workspace === REPO && under(verif.value?.work, REPO), "workspace=" + String(verif.value?.workspace) + " venv=" + String(verif.value?.venv) + " work=" + String(verif.value?.work) + (verif.ok ? "" : " err=" + verif.error))

      const mem = await call("mpd_memory_status", {}, agentRepo, "memory-repo")
      check("R3_MEMORY_STATUS_ROOT", mem.ok && under(mem.value?.root, REPO + "/.mpd/memory"), "root=" + String(mem.value?.root ?? mem.error))

      const plans = await call("mpd_boulder_plans", {}, agentRepo, "plans-repo")
      const planList = Array.isArray(plans.value?.plans) ? plans.value.plans : []
      check("R4_BOULDER_PLANS_LISTS_REPO_PLAN", plans.ok && planList.includes(REPO + "/.mpd/plans/workmate-rename-delete-contract.md"), "count=" + planList.length + " plans=" + JSON.stringify(planList.slice(0, 3)))

      const bs = await call("mpd_boulder_status", {}, agentRepo, "boulder-repo")
      check("R5_BOULDER_STATUS_FILE", bs.ok && under(bs.value?.stateFile, REPO), "stateFile=" + String(bs.value?.stateFile ?? bs.error))

      // ── per-session discrimination INSIDE ONE PROCESS (the multi-session host argument) ──
      const memBlocked = await call("mpd_memory_status", {}, agentBlocked, "memory-blocked")
      const memClean = await call("mpd_memory_status", {}, agentClean, "memory-clean")
      check("S1_SESSION_ISOLATION_BLOCKED", memBlocked.ok && under(memBlocked.value?.root, W_BLOCKED + "/.mpd/memory"), "root=" + String(memBlocked.value?.root ?? memBlocked.error))
      check("S2_SESSION_ISOLATION_CLEAN", memClean.ok && under(memClean.value?.root, W_CLEAN + "/.mpd/memory"), "root=" + String(memClean.value?.root ?? memClean.error))
      const verifBlocked = await call("mpd_verif_venv", { action: "info" }, agentBlocked, "verif-blocked")
      check("S3_TWO_SESSIONS_DIFFER", verif.ok && verifBlocked.ok && verif.value?.workspace !== verifBlocked.value?.workspace, "repo=" + String(verif.value?.workspace) + " blocked=" + String(verifBlocked.value?.workspace))

      // ── negative control: NO agent ⇒ the env/cwd fallback (falsifiability) ──
      const verifNoAgent = await call("mpd_verif_venv", { action: "info" }, undefined, "verif-noagent")
      check("N1_NO_AGENT_FALLS_BACK_TO_HOST_CWD", verifNoAgent.ok && verifNoAgent.value?.workspace === process.cwd(), "workspace=" + String(verifNoAgent.value?.workspace ?? verifNoAgent.error) + " hostCwd=" + process.cwd())

      // ── the PRE-FIX behaviour, reproduced live: an exec-less call is exactly the old
      //    `process.env.DSH_WORKSPACE_ROOT ?? process.cwd()` path (env unset in this boot) ──
      const beforePlans = await call("mpd_boulder_plans", {}, undefined, "before-plans")
      const beforePlanList = Array.isArray(beforePlans.value?.plans) ? beforePlans.value.plans : []
      check("BEFORE1_BOULDER_PLANS_INVISIBLE_WITHOUT_SESSION", beforePlans.ok && !beforePlanList.some((p) => p.includes("workmate-rename-delete-contract.md")), "count=" + beforePlanList.length + " plans=" + JSON.stringify(beforePlanList.slice(0, 2)))
      const beforeRead = await call("mpd_hashline_read", { path: "packages/mpd-hashline-plugin/package.json" }, undefined, "before-read")
      check("BEFORE2_RELATIVE_READ_FAILS_WITHOUT_SESSION", beforeRead.ok === false && /file not found/.test(beforeRead.error), "ok=" + beforeRead.ok + " err=" + beforeRead.error)

      // ── the workmate in-use gate (B1b): refused exactly where the SESSION workspace has a
      //    non-archived team record, allowed where it does not ──
      const init = await call("mpd_workmate_init", { base: "oracle", name: "oracle-1" }, agentClean, "wm-init")
      check("W1_INIT", init.ok, "ok=" + init.ok + " err=" + init.error)

      const renameBlocked = await call("mpd_workmate_rename", { name: "oracle-1", new_name: "oracle-2" }, agentBlocked, "wm-rename-blocked")
      check("W2_RENAME_REFUSED_IN_BLOCKED_WS", renameBlocked.ok === false && /in use/.test(renameBlocked.error) && /blocking-team/.test(renameBlocked.error), "ok=" + renameBlocked.ok + " err=" + renameBlocked.error)

      const renameClean = await call("mpd_workmate_rename", { name: "oracle-1", new_name: "oracle-2" }, agentClean, "wm-rename-clean")
      check("W3_RENAME_ALLOWED_IN_CLEAN_WS", renameClean.ok && renameClean.value?.name === "oracle-2", "ok=" + renameClean.ok + " name=" + String(renameClean.value?.name ?? renameClean.error))

      const deleteBlocked = await call("mpd_workmate_delete", { name: "oracle-2" }, agentBlocked, "wm-delete-blocked")
      check("W4_DELETE_REFUSED_IN_BLOCKED_WS", deleteBlocked.ok === false && /in use/.test(deleteBlocked.error), "ok=" + deleteBlocked.ok + " err=" + deleteBlocked.error)

      const renameAgentless = await call("mpd_workmate_rename", { name: "oracle-2", new_name: "oracle-3" }, undefined, "wm-rename-agentless")
      check("W5_AGENTLESS_USES_HOST_ROOT", renameAgentless.ok && renameAgentless.value?.name === "oracle-3", "ok=" + renameAgentless.ok + " name=" + String(renameAgentless.value?.name ?? renameAgentless.error))

      const deleteClean = await call("mpd_workmate_delete", { name: "oracle-3" }, agentClean, "wm-delete-clean")
      check("W6_DELETE_ALLOWED_IN_CLEAN_WS", deleteClean.ok && /oracle-3/.test(String(deleteClean.value?.archived ?? "")), "ok=" + deleteClean.ok + " archived=" + String(deleteClean.value?.archived ?? deleteClean.error))

      console.log("[ws-probe] DONE")
    } catch (e) {
      console.log("[ws-probe] FAIL=" + String(e?.message ?? e))
    }
  }, 12000)
}
