// docker/probe.ts — the MOUNTING-BOOT instrumentation plugin of the Docker client-install E2E.
//
// WHY THIS FILE EXISTS (§4/§7, "provability"): `dsh --profile web --dump-config` only COMPOSES
// rows and never executes plugin code, so it cannot witness a registered tool or an apply abort
// that takes the plugin tree down. The entrypoint therefore boots the installed profile with this
// plugin inserted through `--patch` and reads the lines below out of the boot log. This is a real
// MOUNT: the plugin's `apply` runs inside the booted process, next to the bundle's own rows, and
// it can only print a tool name after that name was actually registered.
//
// It is QA-only instrumentation and lives in the IMAGE (/opt/mpd-e2e/probe.ts), not in the tree
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

/** The cordis plugin name this instrumentation registers under inside the booted harness. */
export const name: string = "mpd-docker-e2e-probe"
// An agent-scoped cordis ctx throws on any property not declared here, so `tools` must be injected
// to read the registry (measured lesson recorded in packages/mpd-qa-roles-probe/src/index.ts).
// `agents` is injected because the official team tools are AGENT-scoped: `agent/created` is where
// they become visible, and without this service the listener would not be mounted in time.
export const inject: readonly string[] = ["tools", "agents"]

/** One tool-registry read: `true`/`false` when the registry answered, `null` when it cannot answer. */
type ToolAnswer = boolean | null

/**
 * The tool-registry seam this probe reads. Every member stays optional because a compatible host
 * may expose only one of the two lookup spellings; a missing member is a `null` answer, never a crash.
 */
interface ToolRegistry {
  /** Scope-aware presence read (`get(name, scope)`); the harness resolves an agent's tools this way. */
  get?: (name: string, scope?: unknown) => unknown
  /** Scope-less presence read kept as the fallback spelling (`tools.get(name) !== undefined`). */
  has?: (name: string) => unknown
  /** The tool list visible in a scope — the count printed as `AGENT_VISIBLE_TOOLS`. */
  schemas?: (scope?: unknown) => readonly unknown[]
}

/** An agent as observed at `apply` time and on `agent/created`; only identity fields are read. */
interface AgentLike {
  /** Stable agent id (preferred label source). */
  id?: unknown
  /** Human-facing label (second label source). */
  label?: unknown
  /** Name (last label source before the `?` placeholder). */
  name?: unknown
  /** The agent's OWN scoped ctx, where the official team tools are registered. */
  ctx?: { tools?: ToolRegistry }
}

/** The scoped ctx a cordis plugin's `apply` receives, narrowed to the seams this probe reads. */
interface ProbeContext {
  /** Root-plane tool registry; injected above, and allowed to be absent on an odd host. */
  tools?: ToolRegistry
  /** Live agent registry, used to enumerate the agents that already exist at apply time. */
  agents?: { list?: () => readonly AgentLike[] }
  /**
   * Event subscription. Declared REQUIRED on purpose: the probe calls it unguarded inside its own
   * try/catch, so a host without the seam must still throw into that catch exactly as before.
   */
  on: (event: string, listener: (payload: { agent: AgentLike }) => void) => unknown
  /** Cordis service lookup; guarded with `typeof === "function"` before every call. */
  get?: (name: string) => unknown
}

/** The outcome of waiting for a tool set: how many answered present, out of how many, and the rest. */
interface SettleResult {
  /** Number of names the registry answered present for. */
  present: number
  /** Number of names asked about. */
  total: number
  /** The names that were still missing when the budget expired. */
  missing: readonly string[]
}

// The bundle's own host-plane tools. These rows live in the bundle patch (host composition), so
// they are visible to a root-level registry read regardless of the agent-preset plane; they are
// the working set every mpd session is expected to have.
const CORE_TOOLS: readonly string[] = [
  "mpd_roles_list",
  "mpd_config_get",
  "mpd_workmate_list",
  "mpd_ultrawork",
  "mpd_hashline_read",
  "mpd_memory_status",
]

// The three ACTIVE `@deepseek-ai/dsh-mcp-client` rows this bundle mounts, named by the tool each
// server exposes. The row's `serverName` is the MIDDLE segment of its tool names
// (`mcp__<serverName>__<tool>`), so these three are the row→capability proof: a server whose child
// process fails to spawn leaves the session without the tool while every composition assertion stays
// green, which is the gap this arm closes. `mcp-git`/`mcp-shell` are deliberately absent: those rows
// ship `disabled: true`, so they register no tools.
const MCP_TOOLS: readonly string[] = [
  "mcp__ast_grep__search",
  "mcp__lsp__get_diagnostics",
  "mcp__codegraph__codegraph_explore",
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
const TEAM_TOOLS: readonly string[] = [
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
const RETIRED_TOOLS: readonly string[] = [
  "agent_teams_create",
  "agent_teams_send_message",
  "agent_teams_delete",
]

/**
 * The probe's message extractor, matching `String(error?.message ?? error)` exactly: an object
 * carrying a defined `message` is reported by that message, everything else by `String()`.
 *
 * @param error - The caught value (typed `unknown` because a `catch` binding has no static shape).
 * @returns The message text the probe prints after a `fail:` prefix.
 */
function messageOf(error: unknown): string {
  if (error !== null && typeof error === "object" && "message" in error) {
    // A cast is used because `in` narrows the KEY, not the property type: the read has no static shape.
    const message = (error as { message?: unknown }).message
    if (message !== undefined) return String(message)
  }
  return String(error)
}

/**
 * View an unknown service as a string-keyed bag, so dynamically probed members can be read at all.
 * Functions are accepted too, because `Object.entries` enumerates their own properties as well.
 *
 * @param value - The value read out of the service registry.
 * @returns The same value viewed as a bag, or `undefined` for a primitive.
 */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null) return undefined
  /** The value's own type tag, tested against the two kinds that can carry properties. */
  const kind = typeof value
  // A cast is unavoidable: the service arrives from the harness registry as `unknown`, and every
  // member read below stays optional rather than restating a harness type that does not exist here.
  return kind === "object" || kind === "function" ? (value as Record<string, unknown>) : undefined
}

/** Tool-registry presence, using the adapter's own semantics (`tools.get(name) !== undefined`). */
function toolLookup(ctx: ProbeContext): (n: string) => ToolAnswer {
  // The root-plane registry, read once: the closures below keep answering from the SAME registry.
  const tools = ctx.tools
  if (tools === undefined || tools === null) return () => null
  // Optional CALLS (`tools.get?.(…)`) rather than re-binding the method: the receiver is preserved,
  // so a `this`-sensitive registry behaves exactly as it did before this conversion.
  if (typeof tools.get === "function") return (n: string): ToolAnswer => { try { return tools.get?.(n) !== undefined } catch { return false } }
  if (typeof tools.has === "function") return (n: string): ToolAnswer => { try { return tools.has?.(n) === true } catch { return false } }
  return () => null
}

/**
 * Poll for a tool set instead of racing the loader: rows apply concurrently, so a sibling plugin
 * may register its tools after this one runs. A single immediate read would make the
 * instrumentation flaky — and therefore worthless as evidence.
 */
async function settle(has: (n: string) => ToolAnswer, names: readonly string[], budgetMs: number): Promise<SettleResult> {
  // The instant the poll gives up: ONE shared deadline, so the wall-clock cost stays the budget.
  const deadline = Date.now() + budgetMs
  while (Date.now() < deadline && !names.every((n) => has(n))) {
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  // The names still unanswered at the deadline — reported, never fatal.
  const missing = names.filter((n) => !has(n))
  return { present: names.length - missing.length, total: names.length, missing }
}

/**
 * The plugin entry point: read the live tool registry, the adapter service and the official
 * agent-teams service from inside the booted process, and print one line per fact.
 *
 * @param ctx - The booted profile's scoped ctx (only the seams declared on `ProbeContext` are read).
 * @returns A promise that settles after every line was printed; it never rejects.
 */
export async function apply(ctx: ProbeContext): Promise<void> {
  try {
    console.log("[docker-probe] APPLIED=ok")
    // The registry reader every presence question below goes through (or a `null`-answering stub).
    const has = toolLookup(ctx)

    // The bundle's host-plane tools, waited for so a concurrent row cannot make the read flaky.
    const core = await settle(has, CORE_TOOLS, 30000)
    console.log("[docker-probe] CORE_TOOLS=" + core.present + "/" + core.total)
    console.log("[docker-probe] CORE_TOOLS_MISSING=" + core.missing.join(","))

    // The MCP capability surface. Waited for longer than the core rows on purpose: each MCP tool
    // appears only after its stdio child has spawned AND completed the MCP handshake, so a short
    // budget would report a slow-but-healthy server as missing.
    const mcp = await settle(has, MCP_TOOLS, 60000)
    console.log("[docker-probe] MCP_TOOLS=" + mcp.present + "/" + mcp.total)
    console.log("[docker-probe] MCP_TOOLS_MISSING=" + mcp.missing.join(","))

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
    // Print one agent's team-tool line: scoped read, scope-less read, and the visible tool count.
    const readScoped = (agent: AgentLike | undefined, label: string): void => {
      if (agent === undefined || agent === null) {
        console.log(`[docker-probe] AGENT_TEAM_TOOLS=unreadable agent=${label}`)
        return
      }
      // The graded read: the harness's own scope-keyed lookup (`get(name, agent)`).
      const viaScope = (name: string): boolean => { try { return rootTools?.get?.(name, agent) !== undefined } catch { return false } }
      // The contrast read: the agent's OWN scoped ctx, whose global view is known to miss these names.
      const viaScopedCtx = (name: string): boolean => { try { return agent.ctx?.tools?.get?.(name) !== undefined } catch { return false } }
      // Team tools the scope-keyed lookup could not see.
      const missing = TEAM_TOOLS.filter((name) => !viaScope(name))
      // Team tools the scope-less lookup could not see (printed to make the plane difference explicit).
      const scopelessMissing = TEAM_TOOLS.filter((name) => !viaScopedCtx(name))
      // `schemas(scope)` length, or -1 when the list accessor itself is unavailable.
      let visible = -1
      try {
      /** The tool schemas the live registry exposes to this agent, or undefined when it exposes none. */
        const schemas = rootTools?.schemas?.(agent)
        visible = schemas === undefined ? -1 : schemas.length
      } catch { visible = -1 }
      console.log(`[docker-probe] AGENT_TEAM_TOOLS=${TEAM_TOOLS.length - missing.length}/${TEAM_TOOLS.length} agent=${label}${missing.length > 0 ? " MISSING=" + missing.join(",") : ""} scopelessRead=${TEAM_TOOLS.length - scopelessMissing.length}/${TEAM_TOOLS.length}`)
      console.log(`[docker-probe] AGENT_VISIBLE_TOOLS=${visible} agent=${label}`)
    }
    // The label printed beside every per-agent line: id, then label, then name, then `?`, capped at 40.
    const agentLabel = (agent: AgentLike | undefined): string => String(agent?.id ?? agent?.label ?? agent?.name ?? "?").slice(0, 40)
    try {
      // The agents that already exist when this plugin applies (usually none on a fresh boot).
      const existing = ctx.agents?.list?.() ?? []
      console.log("[docker-probe] AGENTS_AT_APPLY=" + existing.length)
      for (const agent of existing) readScoped(agent, agentLabel(agent))
    } catch (error) {
      console.log("[docker-probe] AGENTS_AT_APPLY=fail:" + messageOf(error))
    }
    try {
      ctx.on("agent/created", ({ agent }) => {
        try { readScoped(agent, agentLabel(agent)) } catch (error) {
          console.log("[docker-probe] AGENT_TEAM_TOOLS=fail:" + messageOf(error))
        }
      })
    } catch (error) {
      console.log("[docker-probe] AGENT_TEAM_TOOLS=trap-fail:" + messageOf(error))
    }

    console.log("[docker-probe] RETIRED_TOOLS_PRESENT=" + RETIRED_TOOLS.filter((n) => has(n) === true).join(","))

    // The adapter is the bundle's single contact surface with the harness seams (§6). A boot that
    // registered the bundle's rows but never mounted the adapter is a broken tree, so read the
    // mounted service and make ONE real internal tool call through it — the strongest
    // credential-free proof that the tool plane is live.
    // The RAW service, kept untyped: the presence line below reports on THIS value, and the two
    // member calls are made through it so their receivers are the service itself.
    const service: unknown = typeof ctx.get === "function" ? ctx.get("mpdDsh") : undefined
    console.log("[docker-probe] ADAPTER_SERVICE=" + (service === undefined || service === null ? "absent" : "present"))
    if (service !== undefined && service !== null) {
      // The capability accessor, narrowed by a cast to the one member being called (see the comment
      // on the call below for why the read is not optional-chained).
      const capabilityAccess = service as { capabilities?: () => unknown }
      // The capability bag, replaced by `{}` whenever the accessor is absent or throws.
      let caps: Record<string, unknown> = {}
      try { caps = typeof capabilityAccess.capabilities === "function" ? asRecord(capabilityAccess.capabilities()) ?? {} : {} } catch { caps = {} }
      console.log("[docker-probe] ADAPTER_CAPS=" + Object.entries(caps).filter(([, v]) => v === true).map(([k]) => k).join(","))
      try {
        // The internal tool call, UNGUARDED on purpose: a service without `executeTool` must throw
        // into the catch below exactly as the previous expression did. The cast is unavoidable —
        // the adapter service has no static type inside this image — and the call keeps the service
        // as its receiver, so `this`-dependent adapters are unaffected.
        const callable = service as { executeTool: (input: { name: string; arguments: Record<string, unknown> }) => Promise<unknown> }
        // The adapter's own `{ok, error}` envelope: only those two members are read below.
        const call = await callable.executeTool({ name: "mpd_config_get", arguments: {} })
        // The envelope viewed as a bag, or `undefined` when the call produced no object at all.
        const callRecord = asRecord(call)
        console.log("[docker-probe] ADAPTER_TOOL_CALL=" + (callRecord?.ok === true ? "ok" : "fail:" + String(callRecord?.error ?? "no-result")))
      } catch (error) {
        console.log("[docker-probe] ADAPTER_TOOL_CALL=fail:" + messageOf(error))
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
    const agentTeams: unknown = typeof ctx.get === "function" ? ctx.get("agentTeams") : undefined
    // Mountedness is decided on the RAW value, so a non-object service still reads as MOUNTED.
    const mounted = agentTeams !== undefined && agentTeams !== null
    // The service viewed as a bag, so the dynamically probed methods below can be read at all.
    const agentTeamsRecord = asRecord(agentTeams)
    /** The mounted team service's class name, which is how a reader tells the REAL service from a look-alike. */
    const serviceName = mounted ? String(agentTeamsRecord?.constructor?.name ?? typeof agentTeams) : ""
    console.log("[docker-probe] AGENT_TEAMS=" + (mounted ? "MOUNTED" : "ABSENT") + " serviceName=" + (serviceName || "unknown"))
    console.log("[docker-probe] AGENT_TEAMS_METHODS=" + (mounted
      ? ["listMembers", "spawnTeammate", "sendMessage", "createTask", "getTask", "listTasks", "updateTask", "waitForChange", "interrupt", "tryMembership"]
        .filter((method) => typeof agentTeamsRecord?.[method] === "function").join(",")
      : ""))
    console.log("[docker-probe] DONE=1")
  } catch (error) {
    // Never take the boot down: a probe that throws would turn an instrumentation failure into a
    // product failure and hide the real state of the tree under test.
    console.log("[docker-probe] ERROR=" + messageOf(error))
    console.log("[docker-probe] DONE=1")
  }
}
