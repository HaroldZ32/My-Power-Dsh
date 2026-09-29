// t8 (Lead) INDEPENDENT mount probe row: proves the mpd plugin tree APPLIES in a real boot AND that
// every workspace/state root follows the CALLING SESSION's workspace instead of the dsh process cwd.
//
// Mounted by run-toolcall-proof.mjs through an overlay patch row, from a COPY outside the checkout
// (the web profile's client-modules registry refuses a row whose file also resolves @mpd-dsh/mpd from
// the checkout). Tool calls go through the harness tool runtime (`tools.execute`) carrying the LIVE
// agent of a real session created over the gateway API with an explicit cwd — the same runtime path a
// model-initiated call takes; the probe asserts and prints each agent's session header cwd, so the
// exec identity is never synthetic.
//
// Markers: `[t8-probe] CHECK <id>=<PASS|FAIL> <detail>`; the driver parses them.
const REPO = process.env.MPD_T8_REPO
const W_BLOCKED = process.env.MPD_T8_W_BLOCKED
const W_CLEAN = process.env.MPD_T8_W_CLEAN

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export const name = "mpd-t8-workspace-probe"
export const inject = ["tools"]

export function apply(ctx) {
  setTimeout(async () => {
    try {
      const tools = (typeof ctx.get === "function" ? ctx.get("tools") : undefined) ?? ctx.tools
      const dsh = typeof ctx.get === "function" ? ctx.get("mpdDsh") : undefined
      const agentsSvc = typeof ctx.get === "function" ? ctx.get("agents") : undefined

      console.log("[t8-probe] HOST_CWD=" + process.cwd())
      console.log("[t8-probe] REPO=" + REPO + " W_BLOCKED=" + W_BLOCKED + " W_CLEAN=" + W_CLEAN)

      let agents = []
      const deadline = Date.now() + 120000
      while (Date.now() < deadline) {
        try { agents = (typeof agentsSvc?.list === "function" ? agentsSvc.list() : []) ?? [] } catch { agents = [] }
        const cwds = new Set(agents.map((agent) => agent?.session?.header?.cwd))
        if (cwds.has(REPO) && cwds.has(W_BLOCKED) && cwds.has(W_CLEAN)) break
        await sleep(1000)
      }
      const byCwd = (path) => agents.find((agent) => agent?.session?.header?.cwd === path)
      const agentRepo = byCwd(REPO)
      const agentBlocked = byCwd(W_BLOCKED)
      const agentClean = byCwd(W_CLEAN)
      console.log("[t8-probe] SESSION_CWDS=" + JSON.stringify(agents.map((agent) => agent?.session?.header?.cwd)))
      console.log("[t8-probe] REPO_AGENT_HEADER_CWD=" + String(agentRepo?.session?.header?.cwd))
      console.log("[t8-probe] AGENTS_FOUND=" + JSON.stringify({ repo: Boolean(agentRepo), blocked: Boolean(agentBlocked), clean: Boolean(agentClean) }))
      console.log("[t8-probe] ROOTS_ALL=" + JSON.stringify(dsh?.workspaceRootsAll?.() ?? null))
      console.log("[t8-probe] ADAPTER_SEAMS=" + JSON.stringify(dsh?.capabilities?.() ?? null))

      const call = async (toolName, args, agent, tag) => {
        try {
          const raw = await tools.execute({
            name: toolName,
            arguments: args ?? {},
            callId: "t8-probe-" + tag,
            signal: new AbortController().signal,
            ...(agent === undefined ? {} : { agent }),
          })
          const isError = raw?.isError === true
          const error = isError ? String(raw?.error?.message ?? raw?.error ?? "tool error") : ""
          return { ok: !isError, value: isError ? undefined : raw?.value, error }
        } catch (error) {
          return { ok: false, value: undefined, error: String(error?.message ?? error) }
        }
      }
      const check = (id, pass, detail) => console.log("[t8-probe] CHECK " + id + "=" + (pass ? "PASS" : "FAIL") + " " + String(detail).slice(0, 500))
      const under = (path, root) => typeof path === "string" && (path === root || path.startsWith(root + "/"))

      // ── the four captain reproductions, each ONE session-scoped call through the harness runtime ──
      const read = await call("mpd_hashline_read", { path: ".mpd/hashline-files.json" }, agentRepo, "read-repo")
      check("R1_HASHLINE_RELATIVE_READ", read.ok && under(read.value?.path, REPO), "ok=" + read.ok + " path=" + String(read.value?.path ?? read.error))

      const verif = await call("mpd_verif_venv", { action: "info" }, agentRepo, "verif-repo")
      check("R2_VERIF_INFO_RESOLVES_REPO", verif.ok && verif.value?.workspace === REPO && under(verif.value?.work, REPO) && under(verif.value?.venv, REPO), "workspace=" + String(verif.value?.workspace) + " venv=" + String(verif.value?.venv) + " work=" + String(verif.value?.work) + (verif.ok ? "" : " err=" + verif.error))

      const mem = await call("mpd_memory_status", {}, agentRepo, "memory-repo")
      check("R3_MEMORY_STATUS_RESOLVES_REPO", mem.ok && under(mem.value?.root, REPO + "/.mpd/memory"), "root=" + String(mem.value?.root ?? mem.error))

      const plans = await call("mpd_boulder_plans", {}, agentRepo, "plans-repo")
      const planList = Array.isArray(plans.value?.plans) ? plans.value.plans : []
      check("R4_BOULDER_PLANS_LISTS_REPO_PLAN", plans.ok && planList.includes(REPO + "/.mpd/plans/workmate-rename-delete-contract.md"), "count=" + planList.length + " plans=" + JSON.stringify(planList.slice(0, 3)))

      const status = await call("mpd_boulder_status", {}, agentRepo, "boulder-repo")
      check("R5_BOULDER_STATUS_FILE", status.ok && under(status.value?.stateFile, REPO), "stateFile=" + String(status.value?.stateFile ?? status.error))

      // ── per-session discrimination inside ONE process (the multi-session host argument) ─────────
      const memBlocked = await call("mpd_memory_status", {}, agentBlocked, "memory-blocked")
      const memClean = await call("mpd_memory_status", {}, agentClean, "memory-clean")
      check("S1_TWO_SESSIONS_RESOLVE_DIFFERENTLY", memBlocked.ok && under(memBlocked.value?.root, W_BLOCKED + "/.mpd/memory") && memClean.ok && under(memClean.value?.root, W_CLEAN + "/.mpd/memory") && memBlocked.value.root !== memClean.value.root, "blocked=" + String(memBlocked.value?.root ?? memBlocked.error) + " clean=" + String(memClean.value?.root ?? memClean.error))
      const plansBlocked = await call("mpd_boulder_plans", {}, agentBlocked, "plans-blocked")
      check("S2_OTHER_SESSION_DOES_NOT_SEE_REPO_PLAN", plansBlocked.ok && (plansBlocked.value?.plans ?? []).length === 0, "count=" + JSON.stringify((plansBlocked.value?.plans ?? []).length ?? plansBlocked.error))

      // ── falsifiability: with NO agent the same call collapses to the host cwd (pre-fix shape) ───
      const noAgent = await call("mpd_verif_venv", { action: "info" }, undefined, "no-agent")
      check("N1_NO_AGENT_FALLS_BACK_TO_HOST_CWD", noAgent.ok && noAgent.value?.workspace === process.cwd(), "workspace=" + String(noAgent.value?.workspace ?? noAgent.error) + " hostCwd=" + process.cwd())
      const beforePlans = await call("mpd_boulder_plans", {}, undefined, "no-agent-plans")
      check("N2_WITHOUT_SESSION_REPO_PLAN_INVISIBLE", beforePlans.ok && (beforePlans.value?.plans ?? []).length === 0, "count=" + JSON.stringify((beforePlans.value?.plans ?? []).length ?? beforePlans.error))
      const beforeRead = await call("mpd_hashline_read", { path: ".mpd/hashline-files.json" }, undefined, "no-agent-read")
      check("N3_WITHOUT_SESSION_RELATIVE_READ_FAILS_AT_HOST_CWD", beforeRead.ok === false && beforeRead.error.includes(process.cwd() + "/.mpd/hashline-files.json"), "ok=" + beforeRead.ok + " err=" + beforeRead.error)

      // ── workmate in-use gate: controlled workspace + the LIVE repo team record ───────────────────
      const initBlockedName = await call("mpd_workmate_init", { base: "oracle", name: "t8wm1" }, agentBlocked, "wm-init-blocked")
      check("W1_INIT_CONTROLLED_FIXTURE", initBlockedName.ok, "ok=" + initBlockedName.ok + " err=" + initBlockedName.error)
      const renameBlocked = await call("mpd_workmate_rename", { name: "t8wm1", new_name: "t8wm2" }, agentBlocked, "wm-rename-blocked")
      check("W2_CONTROLLED_BLOCKED_WS_REFUSES", renameBlocked.ok === false && /in use/.test(renameBlocked.error) && /blocking-team\/t8wm1/.test(renameBlocked.error), "ok=" + renameBlocked.ok + " err=" + renameBlocked.error)

      const initClean = await call("mpd_workmate_init", { base: "oracle", name: "t8wm3" }, agentClean, "wm-init-clean")
      const renameClean = await call("mpd_workmate_rename", { name: "t8wm3", new_name: "t8wm4" }, agentClean, "wm-rename-clean")
      check("W3_CLEAN_WS_ALLOWS", initClean.ok && renameClean.ok && renameClean.value?.name === "t8wm4", "init=" + initClean.ok + " rename=" + renameClean.ok + " name=" + String(renameClean.value?.name ?? renameClean.error))
      const deleteUnrelated = await call("mpd_workmate_delete", { name: "t8wm4" }, agentBlocked, "wm-delete-unrelated-blocked-ws")
      check("W4_UNRELATED_KEY_ALLOWED_IN_BLOCKED_WS", deleteUnrelated.ok === true, "ok=" + deleteUnrelated.ok + " err=" + deleteUnrelated.error)

      // The REAL live team record: a member named `Lead` (key `lead`) must block a rename whose
      // SOURCE key matches, in a session whose workspace is the repo — and the TARGET key must be
      // blocked too (the documented §E consequence), while the controlled blocked workspace stays
      // scoped to its OWN record.
      const initLead = await call("mpd_workmate_init", { base: "oracle", name: "lead" }, agentClean, "wm-init-lead")
      check("W5_INIT_LIVE_TEAM_KEY", initLead.ok, "ok=" + initLead.ok + " err=" + initLead.error)
      const renameLead = await call("mpd_workmate_rename", { name: "lead", new_name: "lead-x" }, agentRepo, "wm-rename-live-team")
      check("W6_LIVE_REPO_TEAM_RECORD_BLOCKS_SOURCE_KEY", renameLead.ok === false && /in use/.test(renameLead.error) && /mpd-default-7332aba4\/Lead/.test(renameLead.error), "ok=" + renameLead.ok + " err=" + renameLead.error)
      const initFive = await call("mpd_workmate_init", { base: "oracle", name: "t8wm5" }, agentClean, "wm-init-five")
      const renameToLead = await call("mpd_workmate_rename", { name: "t8wm5", new_name: "architect" }, agentRepo, "wm-rename-to-live-team")
      check("W7_LIVE_REPO_TEAM_RECORD_BLOCKS_TARGET_KEY", initFive.ok && renameToLead.ok === false && /in use/.test(renameToLead.error) && /mpd-default-7332aba4\/Architect/.test(renameToLead.error), "initFive=" + initFive.ok + " ok=" + renameToLead.ok + " err=" + renameToLead.error)
      const deleteLeadInBlocked = await call("mpd_workmate_delete", { name: "lead" }, agentBlocked, "wm-delete-lead-blocked")
      check("W8_OTHER_WS_DOES_NOT_SEE_REPO_TEAM", deleteLeadInBlocked.ok === true, "ok=" + deleteLeadInBlocked.ok + " err=" + deleteLeadInBlocked.error)

      console.log("[t8-probe] DONE")
    } catch (error) {
      console.log("[t8-probe] FAIL=" + String(error?.message ?? error))
    }
  }, 12000)
}
