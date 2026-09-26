// The OFFICIAL Agent Teams surface of mpd-dsh-adapter (adaptation plan D6).
//
// The plan retires the vendored `@nanmicoder/dsh-agent-teams` body and mounts the three
// official `@deepseek-ai/dsh-experimental-*` team packages instead. Their service
// (`ctx.agentTeams`) is therefore a NEW harness seam, and it goes through this adapter
// like every other one: no mpd plugin may read `ctx.agentTeams` or
// `ctx.subagents.startContinuable` directly (the companion gate
// `no-direct-team-access.test.mjs` enforces exactly that over `packages/mpd-*/src`).
//
// What is asserted here:
//   * every frozen method exists under its frozen name and arity, and one capability flag
//     faces each method FAMILY;
//   * each call forwards the caller Agent and the REQUEST OBJECT BY IDENTITY, is
//     receiver-bound (a lost `this` fails here, not in production) and projects only the
//     REPLY (so a consumer's declared mpd types are truthful);
//   * the degrade table — `undefined` / `[]` / a no-op disposer / a loud ACTIONABLE throw
//     naming what could not happen — is what an absent or half-present team service
//     produces, so a consumer's feature detection has a contract to rely on;
//   * `teamLiveTeams()` folds the LIVE agent registry and stays contained when one read
//     fails.
import { describe, expect, test } from "bun:test"

import { createDshAdapter, type DshTeamMemberView, type DshTeamTaskView } from "../src/index"

/**
 * The frozen team surface and its declared parameter counts.
 *
 * Arity is asserted because these methods are the contract consumers are written
 * against: a renamed or re-shaped method must redden HERE instead of surfacing as an
 * `undefined is not a function` inside a peer plugin at boot.
 */
const FROZEN_TEAM_SURFACE: ReadonlyArray<readonly [string, number]> = [
  ["teamService", 0],
  ["teamMembership", 1],
  ["teamListMembers", 1],
  ["teamListTasks", 1],
  ["teamCreateTask", 2],
  ["teamGetTask", 2],
  ["teamUpdateTask", 2],
  ["teamSendMessage", 2],
  ["teamSpawnTeammate", 2],
  ["teamInterrupt", 2],
  ["teamWaitForChange", 3],
  ["teamLiveTeams", 0],
  ["registerSubagentProvider", 1],
  ["subagentProvider", 1],
]

/** One capability flag per new seam of the team plane. */
const FROZEN_TEAM_FLAGS = ["team", "teamTasks", "teamMessages", "subagentsProviderRegister"] as const

type Call = { seam: string; receiver: unknown; args: unknown[] }

/**
 * A recording double of the official team service, the live-agent registry and the
 * subagent provider registry.
 *
 * Every method records the RECEIVER it was called on beside its arguments and answers
 * with a MARKER value, so an adapter that loses `this` or rewrites a request is caught by
 * identity rather than passing as an "it ran" test.
 */
function teamHarness(options: { membership?: unknown; liveAgents?: unknown[] } = {}) {
  const calls: Call[] = []
  const record = (seam: string, receiver: unknown, ...args: unknown[]): void => { calls.push({ seam, receiver, args }) }

  const leadAgent = { id: "session-lead", status: "running" }
  const otherAgent = { id: "session-other", status: "inactive" }
  // The rows are annotated with the ADAPTER's declared types, so the fixture itself is
  // checked against the contract it is used to test (a drift reddens under `tsc`).
  const memberRow: DshTeamMemberView = {
    id: "member-1",
    name: "researcher",
    role: "teammate",
    status: "running",
    description: "the researcher",
    provider: "spawn",
    context: "fresh",
    model: "deepseek-v4-flash",
    diagnostics: ["one"],
  }
  const leadRow: DshTeamMemberView = { id: "session-lead", name: "lead", role: "lead", status: "running", diagnostics: [] }
  const taskRow: DshTeamTaskView = {
    id: "task-1",
    revision: 3,
    subject: "lane work",
    description: "do the thing",
    status: "in_progress",
    blockedBy: ["task-0"],
    writeScopes: ["packages/x"],
    ownerName: "researcher",
    ready: false,
    writeScopeWarnings: ["overlaps task-0"],
  }
  const membership = options.membership === undefined
    ? { root: leadAgent, id: "team-1", role: "lead", name: "lead" }
    : options.membership
  const messageResult = { messageId: "message-1", status: "queued" }
  const spawnResult = { member: memberRow }
  const interruptResult = { previousStatus: "running" }
  const waitResult = { timedOut: true }

  const agentTeams = {
    marker: "agent-teams-service",
    tryMembership(this: unknown, agent: unknown) {
      record("tryMembership", this, agent)
      // A non-member answers undefined — the shape `tryMembership` has on the real host.
      return agent === otherAgent ? undefined : membership
    },
    listMembers(this: unknown, agent: unknown) {
      record("listMembers", this, agent)
      return [leadRow, memberRow]
    },
    listTasks(this: unknown, agent: unknown) {
      record("listTasks", this, agent)
      return [taskRow]
    },
    createTask(this: unknown, caller: unknown, request: unknown) {
      record("createTask", this, caller, request)
      return Promise.resolve(taskRow)
    },
    getTask(this: unknown, caller: unknown, id: unknown) {
      record("getTask", this, caller, id)
      return taskRow
    },
    updateTask(this: unknown, caller: unknown, request: unknown) {
      record("updateTask", this, caller, request)
      return Promise.resolve({ ...taskRow, revision: 4 })
    },
    sendMessage(this: unknown, caller: unknown, request: unknown) {
      record("sendMessage", this, caller, request)
      return Promise.resolve(messageResult)
    },
    spawnTeammate(this: unknown, caller: unknown, request: unknown) {
      record("spawnTeammate", this, caller, request)
      return Promise.resolve(spawnResult)
    },
    interrupt(this: unknown, caller: unknown, targetName: unknown) {
      record("interrupt", this, caller, targetName)
      return interruptResult
    },
    waitForChange(this: unknown, caller: unknown, timeoutMs: unknown, signal: unknown) {
      record("waitForChange", this, caller, timeoutMs, signal)
      return Promise.resolve(waitResult)
    },
  }

  const providerDispose = () => { /* the registry's own disposer */ }
  const subagents = {
    marker: "subagents-service",
    registerProvider(this: unknown, provider: unknown) {
      record("subagents.registerProvider", this, provider)
      return providerDispose
    },
  }
  const agents = { list: () => options.liveAgents ?? [leadAgent] }

  const ctx = {
    get: (serviceName: string) => ({ agentTeams, agents, subagents } as Record<string, unknown>)[serviceName],
  }
  return {
    ctx,
    calls,
    agentTeams,
    agents,
    subagents,
    leadAgent,
    otherAgent,
    memberRow,
    leadRow,
    taskRow,
    messageResult,
    spawnResult,
    providerDispose,
  }
}

/** A harness with NO team row at all (every probe must degrade). */
const absentHarness = { get: () => undefined }
/** A harness whose service lookup itself throws (the never-crash-at-construction contract). */
const hostileHarness = { get: () => { throw new Error("no services here") } }

describe("team surface: the frozen names, arity and capability flags", () => {
  test("every method exists under its frozen name with its declared arity", () => {
    const adapter = createDshAdapter(teamHarness().ctx) as unknown as Record<string, unknown>
    for (const [method, arity] of FROZEN_TEAM_SURFACE) {
      expect(typeof adapter[method]).toBe("function")
      expect((adapter[method] as (...args: unknown[]) => unknown).length).toBe(arity)
    }
  })

  test("the four new capability flags are truthful on a full harness and false on an absent one", () => {
    const caps = createDshAdapter(teamHarness().ctx).capabilities() as unknown as Record<string, unknown>
    for (const flag of FROZEN_TEAM_FLAGS) expect(caps[flag]).toBe(true)

    const absent = createDshAdapter(absentHarness).capabilities() as unknown as Record<string, unknown>
    for (const flag of FROZEN_TEAM_FLAGS) expect(absent[flag]).toBe(false)
  })

  test("team needs identity AND roster; a half-present service reads false", () => {
    const onlyMembership = { get: (name: string) => (name === "agentTeams" ? { tryMembership: () => undefined } : undefined) }
    const onlyRoster = { get: (name: string) => (name === "agentTeams" ? { listMembers: () => [] } : undefined) }
    expect(createDshAdapter(onlyMembership).capabilities().team).toBe(false)
    expect(createDshAdapter(onlyRoster).capabilities().team).toBe(false)
    expect(createDshAdapter(teamHarness().ctx).capabilities().team).toBe(true)
  })

  test("teamTasks needs ALL FOUR task seams, teamMessages BOTH message seams", () => {
    const withTaskMethods = (methods: string[]) => ({
      get: (name: string) => (name === "agentTeams" ? Object.fromEntries(methods.map((method) => [method, () => undefined])) : undefined),
    })
    expect(createDshAdapter(withTaskMethods(["createTask", "getTask", "listTasks"])).capabilities().teamTasks).toBe(false)
    expect(createDshAdapter(withTaskMethods(["createTask", "getTask", "listTasks", "updateTask"])).capabilities().teamTasks).toBe(true)

    expect(createDshAdapter(withTaskMethods([])).capabilities().teamMessages).toBe(false)
    expect(createDshAdapter(withTaskMethods(["sendMessage"])).capabilities().teamMessages).toBe(false)
    expect(createDshAdapter(withTaskMethods(["sendMessage", "waitForChange"])).capabilities().teamMessages).toBe(true)
  })

  test("subagentsProviderRegister tracks registerProvider alone (the READ half keeps its own flag)", () => {
    const writeOnly = { get: (name: string) => (name === "subagents" ? { registerProvider: () => () => {} } : undefined) }
    const readOnly = { get: (name: string) => (name === "subagents" ? { getProvider: () => ({}), list: () => [] } : undefined) }
    expect(createDshAdapter(writeOnly).capabilities().subagentsProviderRegister).toBe(true)
    expect(createDshAdapter(writeOnly).capabilities().subagentsProvider).toBe(false)
    expect(createDshAdapter(readOnly).capabilities().subagentsProviderRegister).toBe(false)
    expect(createDshAdapter(readOnly).capabilities().subagentsProvider).toBe(true)
  })
})

describe("teamService / teamMembership: the contained identity reads", () => {
  test("teamService hands back the SAME service object, receiver untouched", () => {
    const full = teamHarness()
    const adapter = createDshAdapter(full.ctx)
    expect(adapter.teamService()).toBe(full.agentTeams)
    expect(Object.is(adapter.teamService(), full.agentTeams)).toBe(true)
  })

  test("teamMembership forwards the Agent by identity and projects the three declared keys", () => {
    const full = teamHarness()
    const adapter = createDshAdapter(full.ctx)
    const membership = adapter.teamMembership(full.leadAgent)
    // The caller Agent reached the service unchanged, on the service as receiver.
    expect(full.calls).toHaveLength(1)
    expect(full.calls[0]).toMatchObject({ seam: "tryMembership", receiver: full.agentTeams })
    expect(full.calls[0].args).toHaveLength(1)
    expect(full.calls[0].args[0]).toBe(full.leadAgent)

    // Projected, not the raw host value: `root` is deliberately absent.
    expect(membership).toEqual({ teamId: "team-1", role: "lead", name: "lead" })
    expect(Object.keys(membership as object)).toEqual(["teamId", "role", "name"])
  })

  test("a non-member answers undefined, and an unknown role is a MISS rather than a fabricated one", () => {
    const full = teamHarness()
    const adapter = createDshAdapter(full.ctx)
    expect(adapter.teamMembership(full.otherAgent)).toBeUndefined()

    const odd = createDshAdapter(teamHarness({ membership: { id: "team-1", role: "observer", name: "x" } }).ctx)
    expect(odd.teamMembership({ id: "a" })).toBeUndefined()

    // A membership with NO role at all (a stub, or a reshaped host) is a miss too.
    const roleless = createDshAdapter(teamHarness({ membership: { id: "team-1", name: "x" } }).ctx)
    expect(roleless.teamMembership({ id: "a" })).toBeUndefined()
  })

  test("teamMembership NEVER throws — a hostile service is a miss, not a failure", () => {
    const thrower = {
      get: (name: string) => (name === "agentTeams" ? { tryMembership: () => { throw new Error("stale identity") } } : undefined),
    }
    expect(() => createDshAdapter(thrower).teamMembership({ id: "x" })).not.toThrow()
    expect(createDshAdapter(thrower).teamMembership({ id: "x" })).toBeUndefined()
    expect(createDshAdapter(absentHarness).teamMembership({ id: "x" })).toBeUndefined()
  })
})

describe("the roster and board reads: caller forwarded, rows projected", () => {
  test("teamListMembers forwards the Agent by identity and normalizes every row", () => {
    const full = teamHarness()
    const adapter = createDshAdapter(full.ctx)
    const members = adapter.teamListMembers(full.leadAgent)

    expect(full.calls[0]).toMatchObject({ seam: "listMembers", receiver: full.agentTeams })
    expect(full.calls[0].args[0]).toBe(full.leadAgent)
    expect(members).toHaveLength(2)
    // A full row keeps every optional field it declared...
    expect(members[1]).toEqual({
      id: "member-1",
      name: "researcher",
      role: "teammate",
      status: "running",
      description: "the researcher",
      provider: "spawn",
      context: "fresh",
      model: "deepseek-v4-flash",
      diagnostics: ["one"],
    })
    // ...and the declared array field is ALWAYS an array, even when the host omits it.
    expect(Array.isArray(members[0].diagnostics)).toBe(true)
  })

  test("a malformed row cannot leak an undeclared value", () => {
    const weird = {
      get: (name: string) => (name === "agentTeams"
        ? {
          listMembers: () => [{ id: 7, name: undefined, role: "observer", status: "zombie", context: "shared", diagnostics: ["ok", 3] }],
        }
        : undefined),
    }
    const [row] = createDshAdapter(weird).teamListMembers({ id: "a" })
    expect(row).toEqual({ id: "7", name: "", role: "teammate", status: "inactive", diagnostics: ["ok"] })
  })

  test("teamListTasks forwards the Agent by identity and projects the task row", () => {
    const full = teamHarness()
    const adapter = createDshAdapter(full.ctx)
    const tasks = adapter.teamListTasks(full.leadAgent)

    expect(full.calls[0]).toMatchObject({ seam: "listTasks", receiver: full.agentTeams })
    expect(full.calls[0].args[0]).toBe(full.leadAgent)
    expect(tasks).toEqual([{
      id: "task-1",
      revision: 3,
      subject: "lane work",
      description: "do the thing",
      status: "in_progress",
      blockedBy: ["task-0"],
      writeScopes: ["packages/x"],
      ownerName: "researcher",
      ready: false,
      writeScopeWarnings: ["overlaps task-0"],
    }])
  })

  test("an unknown task status degrades to the safe non-terminal value; a non-array answer is []", () => {
    const weird = {
      get: (name: string) => (name === "agentTeams"
        ? { listTasks: () => [{ id: "t", revision: "3", subject: "s", description: "d", status: "archived", blockedBy: [1, "b"], writeScopes: null, ready: "yes", writeScopeWarnings: undefined }] }
        : undefined),
    }
    const [row] = createDshAdapter(weird).teamListTasks({ id: "a" })
    expect(row).toEqual({
      id: "t",
      revision: 0,
      subject: "s",
      description: "d",
      status: "pending",
      blockedBy: ["b"],
      writeScopes: [],
      ready: false,
      writeScopeWarnings: [],
    })

    const notArray = { get: (name: string) => (name === "agentTeams" ? { listTasks: () => "nope" } : undefined) }
    expect(createDshAdapter(notArray).teamListTasks({ id: "a" })).toEqual([])
  })
})

describe("the mutation calls: caller AND request forwarded by identity", () => {
  test("teamCreateTask forwards both objects unchanged and projects the created row", async () => {
    const full = teamHarness()
    const adapter = createDshAdapter(full.ctx)
    const caller = { id: "lead-agent" }
    const request = { subject: "s", description: "d", blockedBy: ["task-0"], writeScopes: ["packages/x"], extraHostField: true }
    const created = await adapter.teamCreateTask(caller, request)

    expect(full.calls[0]).toMatchObject({ seam: "createTask", receiver: full.agentTeams })
    expect(full.calls[0].args).toHaveLength(2)
    expect(full.calls[0].args[0]).toBe(caller)
    // The EXACT request object: no copy, no key rewrite, so an unmodelled host field survives.
    expect(full.calls[0].args[1]).toBe(request)
    expect(created).toEqual({
      id: "task-1",
      revision: 3,
      subject: "lane work",
      description: "do the thing",
      status: "in_progress",
      blockedBy: ["task-0"],
      writeScopes: ["packages/x"],
      ownerName: "researcher",
      ready: false,
      writeScopeWarnings: ["overlaps task-0"],
    })
  })

  test("teamGetTask forwards caller and id verbatim, and its reply is projected", () => {
    const full = teamHarness()
    const adapter = createDshAdapter(full.ctx)
    const caller = { id: "lead-agent" }
    const task = adapter.teamGetTask(caller, "task-1")

    expect(full.calls[0]).toMatchObject({ seam: "getTask", receiver: full.agentTeams })
    expect(full.calls[0].args[0]).toBe(caller)
    expect(full.calls[0].args[1]).toBe("task-1")
    expect(task.id).toBe("task-1")
  })

  test("teamGetTask propagates the host's OWN rejection (it never invents a view)", () => {
    const throwing = {
      get: (name: string) => (name === "agentTeams" ? { getTask: () => { throw new Error("team task not found") } } : undefined),
    }
    expect(() => createDshAdapter(throwing).teamGetTask({ id: "a" }, "missing")).toThrow("team task not found")
  })

  test("teamUpdateTask forwards the request by identity and returns the committed revision", async () => {
    const full = teamHarness()
    const adapter = createDshAdapter(full.ctx)
    const caller = { id: "lead-agent" }
    const request = { taskId: "task-1", expectedRevision: 3, action: "complete" as const }
    const updated = await adapter.teamUpdateTask(caller, request)

    expect(full.calls[0]).toMatchObject({ seam: "updateTask", receiver: full.agentTeams })
    expect(full.calls[0].args[0]).toBe(caller)
    expect(full.calls[0].args[1]).toBe(request)
    expect(updated.revision).toBe(4)
  })

  test("teamSendMessage forwards the request by identity and normalizes the durable answer", async () => {
    const full = teamHarness()
    const adapter = createDshAdapter(full.ctx)
    const caller = { id: "lead-agent" }
    const request = { target: "researcher", content: [{ type: "text", text: "hi" }] }
    const sent = await adapter.teamSendMessage(caller, request)

    expect(full.calls[0]).toMatchObject({ seam: "sendMessage", receiver: full.agentTeams })
    expect(full.calls[0].args[0]).toBe(caller)
    expect(full.calls[0].args[1]).toBe(request)
    expect(sent).toEqual({ messageId: "message-1", status: "queued" })
  })

  test("a rejected message promise stays a rejection for the caller", async () => {
    const rejecting = {
      get: (name: string) => (name === "agentTeams" ? { sendMessage: () => Promise.reject(new Error("mailbox full")) } : undefined),
    }
    await expect(createDshAdapter(rejecting).teamSendMessage({ id: "a" }, { target: "t", content: [] }))
      .rejects.toThrow("mailbox full")
  })

  test("teamSpawnTeammate forwards the request by identity and projects the member row", async () => {
    const full = teamHarness()
    const adapter = createDshAdapter(full.ctx)
    const caller = { id: "lead-agent" }
    const request = { name: "researcher", description: "d", prompt: [{ type: "text", text: "go" }], context: "fresh" as const, provider: "spawn" }
    const spawned = await adapter.teamSpawnTeammate(caller, request)

    expect(full.calls[0]).toMatchObject({ seam: "spawnTeammate", receiver: full.agentTeams })
    expect(full.calls[0].args[0]).toBe(caller)
    expect(full.calls[0].args[1]).toBe(request)
    expect(spawned.member).toEqual(full.memberRow)
  })

  test("teamInterrupt forwards the caller and the target name, answering the sampled status", () => {
    const full = teamHarness()
    const adapter = createDshAdapter(full.ctx)
    const caller = { id: "lead-agent" }
    const result = adapter.teamInterrupt(caller, "researcher")

    expect(full.calls[0]).toMatchObject({ seam: "interrupt", receiver: full.agentTeams })
    expect(full.calls[0].args[0]).toBe(caller)
    expect(full.calls[0].args[1]).toBe("researcher")
    expect(result).toEqual({ previousStatus: "running" })
  })

  test("teamWaitForChange forwards caller, timeout AND signal verbatim", async () => {
    const full = teamHarness()
    const adapter = createDshAdapter(full.ctx)
    const caller = { id: "lead-agent" }
    const controller = new AbortController()
    const waited = await adapter.teamWaitForChange(caller, 30_000, controller.signal)

    expect(full.calls[0]).toMatchObject({ seam: "waitForChange", receiver: full.agentTeams })
    expect(full.calls[0].args).toHaveLength(3)
    expect(full.calls[0].args[0]).toBe(caller)
    expect(full.calls[0].args[1]).toBe(30_000)
    expect(full.calls[0].args[2]).toBe(controller.signal)
    expect(waited).toEqual({ timedOut: true })
  })
})

describe("registerSubagentProvider: the disposal-returning registration seam", () => {
  test("forwards the provider VERBATIM and passes the registry's disposer back", () => {
    const full = teamHarness()
    const adapter = createDshAdapter(full.ctx)
    const provider = { name: "mpd-provider", spawn: () => ({}) }
    const dispose = adapter.registerSubagentProvider(provider)

    expect(full.calls[0]).toMatchObject({ seam: "subagents.registerProvider", receiver: full.subagents })
    expect(full.calls[0].args).toHaveLength(1)
    expect(full.calls[0].args[0]).toBe(provider)
    expect(dispose).toBe(full.providerDispose)
  })

  test("a non-callable registry answer degrades to a no-op disposer, never a leak", () => {
    const stub = { get: (name: string) => (name === "subagents" ? { registerProvider: () => 42 } : undefined) }
    const dispose = createDshAdapter(stub).registerSubagentProvider({})
    expect(typeof dispose).toBe("function")
    expect(() => dispose()).not.toThrow()
  })
})

describe("teamLiveTeams: the contained fold over the live registry", () => {
  test("reports one entry per live LEAD agent, with its roster and board", () => {
    const full = teamHarness()
    const adapter = createDshAdapter(full.ctx)
    const teams = adapter.teamLiveTeams()

    expect(teams).toHaveLength(1)
    expect(teams[0].teamId).toBe("team-1")
    expect(teams[0].leadName).toBe("lead")
    expect(teams[0].leadSessionId).toBe("session-lead")
    expect(teams[0].members.map((row) => row.name)).toEqual(["lead", "researcher"])
    expect(teams[0].tasks.map((row) => row.id)).toEqual(["task-1"])
  })

  test("non-Lead agents are skipped and a membership read that throws is contained", () => {
    const mixed = {
      get: (name: string) => (name === "agentTeams"
        ? {
          tryMembership: (agent: { id: string }) => {
            if (agent.id === "session-boom") throw new Error("stale identity")
            if (agent.id === "session-bystander") return undefined
            return { id: "team-1", role: "lead", name: "lead" }
          },
          listMembers: () => [],
          listTasks: () => [],
        }
        : name === "agents"
          ? { list: () => [{ id: "session-boom" }, { id: "session-bystander" }, { id: "session-lead" }] }
          : undefined),
    }
    const teams = createDshAdapter(mixed).teamLiveTeams()
    expect(teams.map((team) => team.leadSessionId)).toEqual(["session-lead"])
  })

  test("a failing roster read yields [] for THAT entry instead of taking the fold down", () => {
    const partial = {
      get: (name: string) => (name === "agentTeams"
        ? {
          tryMembership: () => ({ id: "team-1", role: "lead", name: "lead" }),
          listMembers: () => { throw new Error("journal unavailable") },
          listTasks: () => "not an array",
        }
        : name === "agents"
          ? { list: () => [{ id: "session-lead" }] }
          : undefined),
    }
    const [team] = createDshAdapter(partial).teamLiveTeams()
    expect(team).toMatchObject({ teamId: "team-1", leadSessionId: "session-lead", members: [], tasks: [] })
  })

  test("[] when the service OR the agent registry is absent", () => {
    expect(createDshAdapter(absentHarness).teamLiveTeams()).toEqual([])
    const teamOnly = { get: (name: string) => (name === "agentTeams" ? { tryMembership: () => ({ id: "t", role: "lead" }) } : undefined) }
    expect(createDshAdapter(teamOnly).teamLiveTeams()).toEqual([])
  })
})

describe("the degrade table: an absent team service NEVER crashes and always says why", () => {
  test("nothing on this surface throws at construct or probe time", () => {
    for (const harness of [absentHarness, hostileHarness, {}, null]) {
      const adapter = createDshAdapter(harness)
      expect(adapter.capabilities().team).toBe(false)
      expect(adapter.capabilities().teamTasks).toBe(false)
      expect(adapter.capabilities().teamMessages).toBe(false)
      expect(adapter.capabilities().subagentsProviderRegister).toBe(false)
      expect(adapter.teamService()).toBeUndefined()
      expect(adapter.teamMembership({ id: "a" })).toBeUndefined()
      expect(adapter.teamLiveTeams()).toEqual([])
    }
  })

  test("each method degrades exactly as declared, naming what could not happen", async () => {
    const adapter = createDshAdapter(absentHarness)
    const caller = { id: "agent-1" }
    // The contained family: `undefined` / `[]`, never a throw.
    expect(adapter.teamService()).toBeUndefined()
    expect(adapter.teamMembership(caller)).toBeUndefined()
    expect(adapter.teamLiveTeams()).toEqual([])

    // The loud family: one ACTIONABLE message per method, naming the missing service and
    // the operation that could not happen.
    const cases: ReadonlyArray<readonly [string, () => unknown, RegExp]> = [
      ["teamListMembers", () => adapter.teamListMembers(caller), /harness service "agentTeams" is unavailable — cannot list the team roster of an agent$/],
      ["teamListTasks", () => adapter.teamListTasks(caller), /harness service "agentTeams" is unavailable — cannot list the shared task board of an agent$/],
      ["teamCreateTask", () => adapter.teamCreateTask(caller, { subject: "s" }), /harness service "agentTeams" is unavailable — cannot create team task "s"$/],
      ["teamGetTask", () => adapter.teamGetTask(caller, "task-1"), /harness service "agentTeams" is unavailable — cannot read team task "task-1"$/],
      ["teamUpdateTask", () => adapter.teamUpdateTask(caller, { taskId: "task-1", expectedRevision: 1, action: "claim" }), /harness service "agentTeams" is unavailable — cannot update team task "task-1"$/],
      ["teamSendMessage", () => adapter.teamSendMessage(caller, { target: "researcher", content: [] }), /harness service "agentTeams" is unavailable — cannot send a team message to "researcher"$/],
      ["teamSpawnTeammate", () => adapter.teamSpawnTeammate(caller, { name: "w", description: "d", prompt: [] }), /harness service "agentTeams" is unavailable — cannot spawn team member "w"$/],
      ["teamInterrupt", () => adapter.teamInterrupt(caller, "w"), /harness service "agentTeams" is unavailable — cannot interrupt team member "w"$/],
      ["teamWaitForChange", () => adapter.teamWaitForChange(caller, 1_000), /harness service "agentTeams" is unavailable — cannot wait for team activity$/],
      ["registerSubagentProvider", () => adapter.registerSubagentProvider({}), /harness service "subagents" is unavailable — cannot register a subagent provider$/],
    ]
    for (const [method, invoke, expected] of cases) {
      let thrown: unknown
      try {
        await invoke()
      } catch (error) {
        thrown = error
      }
      expect(thrown, method + " must throw rather than degrade silently").toBeInstanceOf(Error)
      const text = (thrown as Error).message
      expect(text.startsWith("mpd-dsh-adapter: "), method + " must carry the adapter's prefix").toBe(true)
      expect(text, method + " must name the failed operation").toMatch(expected)
      expect(text, method + " must name the adapter as the thrower").toContain(method.includes("register") ? '"subagents"' : '"agentTeams"')
    }
  })

  test("a service that is present but lacks ONE method names that method, not the service", async () => {
    const partial = { get: (name: string) => (name === "agentTeams" ? { tryMembership: () => undefined } : undefined) }
    const adapter = createDshAdapter(partial)
    expect(() => adapter.teamListMembers({ id: "a" })).toThrow(/the harness agentTeams service exposes no listMembers\(\)/)
    expect(() => adapter.teamListTasks({ id: "a" })).toThrow(/the harness agentTeams service exposes no listTasks\(\)/)
    await expect(adapter.teamCreateTask({ id: "a" }, { subject: "s" })).rejects.toThrow(/exposes no createTask\(\)/)
    await expect(adapter.teamSendMessage({ id: "a" }, { target: "t", content: [] })).rejects.toThrow(/exposes no sendMessage\(\)/)
    await expect(adapter.teamSpawnTeammate({ id: "a" }, { name: "n", description: "d", prompt: [] })).rejects.toThrow(/exposes no spawnTeammate\(\)/)
    await expect(adapter.teamWaitForChange({ id: "a" }, 1_000)).rejects.toThrow(/exposes no waitForChange\(\)/)
    expect(() => adapter.teamInterrupt({ id: "a" }, "n")).toThrow(/exposes no interrupt\(\)/)
    expect(() => adapter.teamGetTask({ id: "a" }, "task-1")).toThrow(/exposes no getTask\(\)/)
    await expect(adapter.teamUpdateTask({ id: "a" }, { taskId: "t", expectedRevision: 1, action: "claim" })).rejects.toThrow(/exposes no updateTask\(\)/)
  })
})
