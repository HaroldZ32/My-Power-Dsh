// docker/probe.mjs — the MOUNTING-BOOT instrumentation plugin of the Docker client-install E2E.
//
// WHY THIS FILE EXISTS (§4/§7, "provability"): `dsh --profile web --dump-config` only COMPOSES
// rows and never executes plugin code, so it cannot witness a registered tool or an apply abort
// that takes the plugin tree down. The entrypoint therefore boots the installed profile with this
// plugin inserted through `--patch` and reads the lines below out of the boot log. This is a real
// MOUNT: the plugin's `apply` runs inside the booted process, next to the bundle's own rows, and
// it can only print a tool name after that name was actually registered.
//
// It is QA-only instrumentation and lives in the IMAGE (/opt/mpd-e2e/probe.mjs), not in the tree
// under test: the repository copy can never supply its own verdict. Like the repository's own
// `packages/mpd-qa-roles-probe`, it reads the tool registry through the harness seam directly,
// because that is the seam under observation.
//
// Output contract (one line per fact; the entrypoint greps these exact prefixes):
//   [docker-probe] APPLIED=ok
//   [docker-probe] CORE_TOOLS=<present>/<total>
//   [docker-probe] CORE_TOOLS_MISSING=<csv|empty>
//   [docker-probe] TEAM_TOOLS_ROOT=<present>/<total>          (observation: root plane is correctly empty)
//   [docker-probe] AGENTS_AT_APPLY=<n>
//   [docker-probe] AGENT_TEAM_TOOLS=<present>/<total> agent=<label> [MISSING=<csv>]
//   [docker-probe] RETIRED_TOOLS_PRESENT=<csv|empty>
//   [docker-probe] ADAPTER_SERVICE=present|absent
//   [docker-probe] ADAPTER_CAPS=<csv>
//   [docker-probe] ADAPTER_TOOL_CALL=ok|fail:<reason>
//   [docker-probe] AGENT_TEAMS=MOUNTED|ABSENT serviceName=<class>
//   [docker-probe] AGENT_TEAMS_METHODS=<csv>
//   [docker-probe] DONE=1
export const name = "mpd-docker-e2e-probe"
// An agent-scoped cordis ctx throws on any property not declared here, so `tools` must be injected
// to read the registry (measured lesson recorded in packages/mpd-qa-roles-probe/src/index.ts).
// `agents` is injected because the official team tools are AGENT-scoped: `agent/created` is where
// they become visible, and without this service the listener would not be mounted in time.
export const inject = ["tools", "agents"]

// The bundle's own host-plane tools. These rows live in the bundle patch (host composition), so
// they are visible to a root-level registry read regardless of the agent-preset plane; they are
// the working set every mpd session is expected to have.
const CORE_TOOLS = [
  "mpd_roles_list",
  "mpd_config_get",
  "mpd_workmate_list",
  "mpd_ultrawork",
  "mpd_hashline_read",
  "mpd_memory_status",
]

// The OFFICIAL agent-team tool surface (docs/plan-0.1.7-adaptation.md §2.2), mounted by the
// `mpd-tool-agent-team` row (§4 D3).
//
// MEASURED PLANE (2026-09-27, first Docker run): these names are registered in ONE EXACT AGENT
// SCOPE — `@deepseek-ai/dsh-experimental-tool-agent-team` calls `scoped.tools.register(...)` on
// `agent.ctx` inside `install(agent, ctx, config)`, which the plugin runs per agent (`ctx.agents.list()`
// plus the `agent/created` event). A ROOT-level `ctx.tools.get("spawn_teammate")` therefore answers
// undefined BY DESIGN, and asserting them there would report a passing tree as broken. The probe
// measures them where they live — in the agent scope — and reports the root read separately so the
// distinction is visible in the evidence instead of being silently dropped.
const TEAM_TOOLS = [
  "spawn_teammate",
  "send_message",
  "list_agents",
  "wait_agent",
  "interrupt_agent",
  "team_task_create",
  "team_task_list",
  "team_task_get",
  "team_task_update",
]

// The vendored agent-teams tool names retired by §4 D5. Recorded as an OBSERVATION, never as a
// gate: their absence is the migration's property, not this lane's acceptance.
const RETIRED_TOOLS = [
  "agent_teams_create",
  "agent_teams_send_message",
  "agent_teams_delete",
]

/** Tool-registry presence, using the adapter's own semantics (`tools.get(name) !== undefined`). */
function toolLookup(ctx) {
  const tools = ctx.tools
  if (tools === undefined || tools === null) return () => null
  if (typeof tools.get === "function") return (n) => { try { return tools.get(n) !== undefined } catch { return false } }
  if (typeof tools.has === "function") return (n) => { try { return tools.has(n) === true } catch { return false } }
  return () => null
}

/**
 * Poll for a tool set instead of racing the loader: rows apply concurrently, so a sibling plugin
 * may register its tools after this one runs. A single immediate read would make the
 * instrumentation flaky — and therefore worthless as evidence.
 */
async function settle(has, names, budgetMs) {
  const deadline = Date.now() + budgetMs
  while (Date.now() < deadline && !names.every((n) => has(n))) {
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  const missing = names.filter((n) => !has(n))
  return { present: names.length - missing.length, total: names.length, missing }
}

export async function apply(ctx) {
  try {
    console.log("[docker-probe] APPLIED=ok")
    const has = toolLookup(ctx)

    const core = await settle(has, CORE_TOOLS, 30000)
    console.log("[docker-probe] CORE_TOOLS=" + core.present + "/" + core.total)
    console.log("[docker-probe] CORE_TOOLS_MISSING=" + core.missing.join(","))

    // The ROOT-plane read of the team tools, reported as an OBSERVATION: the official plugin
    // registers them per agent, so 0/9 here is the documented shape, not a failure.
    const teamRoot = await settle(has, TEAM_TOOLS, 5000)
    console.log("[docker-probe] TEAM_TOOLS_ROOT=" + teamRoot.present + "/" + teamRoot.total)

    // The AGENT-plane read: where those tools actually appear. ONE line per agent (label + count),
    // emitted for every agent that already exists and for every one created afterwards — the
    // entrypoint creates one through POST /api/session/create, which is what makes this reachable
    // without a live model turn.
    //
    // THE SCOPE KEY IS THE AGENT, and this is the second measured trap of this instrumentation:
    // `tools.get(name)` reads the GLOBAL view (`view(undefined)`), so a scope-local registration is
    // invisible to it — the first agent-scoped attempt reported 0/9 for a healthy tree. The harness
    // resolves an agent's tools as `ctx.tools.get(name, agent)` (see `dsh-file-reference-local`'s
    // `agent.ctx.tools.get("read", agent)` and `dsh-tool-call-timeout-policy`'s
    // `ctx.tools.get(exec.name, exec.agent)`), so that is what is graded here; the scope-less read is
    // printed alongside it so the difference is visible in the evidence instead of being guessed at.
    const rootTools = ctx.tools
    const readScoped = (agent, label) => {
      if (agent === undefined || agent === null) {
        console.log(`[docker-probe] AGENT_TEAM_TOOLS=unreadable agent=${label}`)
        return
      }
      const viaScope = (name) => { try { return rootTools.get(name, agent) !== undefined } catch { return false } }
      const viaScopedCtx = (name) => { try { return agent.ctx?.tools?.get?.(name) !== undefined } catch { return false } }
      const missing = TEAM_TOOLS.filter((name) => !viaScope(name))
      const scopelessMissing = TEAM_TOOLS.filter((name) => !viaScopedCtx(name))
      let visible = -1
      try { visible = rootTools.schemas(agent).length } catch { visible = -1 }
      console.log(`[docker-probe] AGENT_TEAM_TOOLS=${TEAM_TOOLS.length - missing.length}/${TEAM_TOOLS.length} agent=${label}${missing.length > 0 ? " MISSING=" + missing.join(",") : ""} scopelessRead=${TEAM_TOOLS.length - scopelessMissing.length}/${TEAM_TOOLS.length}`)
      console.log(`[docker-probe] AGENT_VISIBLE_TOOLS=${visible} agent=${label}`)
    }
    const agentLabel = (agent) => String(agent?.id ?? agent?.label ?? agent?.name ?? "?").slice(0, 40)
    try {
      const existing = ctx.agents?.list?.() ?? []
      console.log("[docker-probe] AGENTS_AT_APPLY=" + existing.length)
      for (const agent of existing) readScoped(agent, agentLabel(agent))
    } catch (error) {
      console.log("[docker-probe] AGENTS_AT_APPLY=fail:" + String(error?.message ?? error))
    }
    try {
      ctx.on("agent/created", ({ agent }) => {
        try { readScoped(agent, agentLabel(agent)) } catch (error) {
          console.log("[docker-probe] AGENT_TEAM_TOOLS=fail:" + String(error?.message ?? error))
        }
      })
    } catch (error) {
      console.log("[docker-probe] AGENT_TEAM_TOOLS=trap-fail:" + String(error?.message ?? error))
    }

    console.log("[docker-probe] RETIRED_TOOLS_PRESENT=" + RETIRED_TOOLS.filter((n) => has(n) === true).join(","))

    // The adapter is the bundle's single contact surface with the harness seams (§6). A boot that
    // registered the bundle's rows but never mounted the adapter is a broken tree, so read the
    // mounted service and make ONE real internal tool call through it — the strongest
    // credential-free proof that the tool plane is live.
    const dsh = typeof ctx.get === "function" ? ctx.get("mpdDsh") : undefined
    console.log("[docker-probe] ADAPTER_SERVICE=" + (dsh === undefined || dsh === null ? "absent" : "present"))
    if (dsh !== undefined && dsh !== null) {
      let caps = {}
      try { caps = typeof dsh.capabilities === "function" ? dsh.capabilities() ?? {} : {} } catch { caps = {} }
      console.log("[docker-probe] ADAPTER_CAPS=" + Object.entries(caps).filter(([, v]) => v === true).map(([k]) => k).join(","))
      try {
        const call = await dsh.executeTool({ name: "mpd_config_get", arguments: {} })
        console.log("[docker-probe] ADAPTER_TOOL_CALL=" + (call?.ok === true ? "ok" : "fail:" + String(call?.error ?? "no-result")))
      } catch (error) {
        console.log("[docker-probe] ADAPTER_TOOL_CALL=fail:" + String(error?.message ?? error))
      }
    } else {
      console.log("[docker-probe] ADAPTER_CAPS=")
      console.log("[docker-probe] ADAPTER_TOOL_CALL=fail:adapter-service-absent")
    }

    // THE OFFICIAL AGENT-TEAMS SERVICE. `mpd-agent-team` mounts
    // @deepseek-ai/dsh-experimental-agent-team, whose plugin provides `ctx.agentTeams` (class
    // TeamService). A COMPOSED row proves nothing about a load — this read is taken inside the
    // running process, and the class name is the witness that the official service (not some stub)
    // is what answered.
    const agentTeams = typeof ctx.get === "function" ? ctx.get("agentTeams") : undefined
    const mounted = agentTeams !== undefined && agentTeams !== null
    const serviceName = mounted ? String(agentTeams.constructor?.name ?? typeof agentTeams) : ""
    console.log("[docker-probe] AGENT_TEAMS=" + (mounted ? "MOUNTED" : "ABSENT") + " serviceName=" + (serviceName || "unknown"))
    console.log("[docker-probe] AGENT_TEAMS_METHODS=" + (mounted
      ? ["listMembers", "spawnTeammate", "sendMessage", "createTask", "getTask", "listTasks", "updateTask", "waitForChange", "interrupt", "tryMembership"]
        .filter((method) => typeof agentTeams[method] === "function").join(",")
      : ""))
    console.log("[docker-probe] DONE=1")
  } catch (error) {
    // Never take the boot down: a probe that throws would turn an instrumentation failure into a
    // product failure and hide the real state of the tree under test.
    console.log("[docker-probe] ERROR=" + String(error?.message ?? error))
    console.log("[docker-probe] DONE=1")
  }
}
