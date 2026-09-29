// THE SEPARATION ITSELF is what this file pins: that approving a staged plan creates an mpd-owned
// TEAM RECORD with ids of our own, that the executor is told about the team rather than defining
// it, and that the record — not the official readout — is what the mpd service answers with.
//
// The distinction matters because it is invisible when both halves agree. Every arm below therefore
// makes the two halves DISAGREE (the executor reports handles the record must keep but never adopt,
// and the readout is deliberately left stale) so a regression to "read the official plane" reddens
// instead of passing quietly.
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { apply, TEAMS_SERVICE, type MpdTeamsService } from "../src/index"
import { listTeams, readTeam, teamRoot } from "../src/team-store"

/** One captured tool registration, with `execute` kept so an arm can actually drive it. */
interface Tool {
  /** The registered tool name. */
  name: string
  /** The registered tool's executor. */
  execute: (args: unknown, exec: unknown) => Promise<unknown>
}

/** One recorded call the plugin made to the executor, so an arm can assert on the PAYLOAD. */
interface ExecutorCall {
  /** The adapter method that was called. */
  method: string
  /** The arguments it was called with, minus the caller. */
  args: Record<string, unknown>
}

/** The harness one arm drives: the sandbox, the registered tools, the executor log and the service. */
interface Harness {
  /** The sandbox workspace every call is scoped to. */
  workspace: string
  /** The tools the plugin registered, by name. */
  tools: Map<string, Tool>
  /** Every executor call, in order. */
  calls: ExecutorCall[]
  /** The `mpdTeams` service the plugin published, or undefined when it published none. */
  service: MpdTeamsService | undefined
  /** The tool exec payload a call carries (the workspace resolves from it). */
  exec: { agent: { session: { id: string } }; signal: undefined }
  /** Drive one registered tool by name. */
  call: (name: string, args: unknown) => Promise<unknown>
}

/** What the stub executor should answer, so an arm can make it fail on demand. */
interface StubOptions {
  /** The member whose spawn throws, by name, when an arm needs a half-built team. */
  failMember?: string
  /** The executor's own task handles, in creation order (defaults to `board-1`, `board-2`, …). */
  taskIds?: string[]
}

/**
 * Build the harness: a real plugin applied against a stub executor.
 * @param options - how the stub executor should behave.
 * @returns the harness an arm drives.
 */
function harness(options: StubOptions = {}): Harness {
  /** The sandbox workspace, which is also what `workspaceRoot` answers. */
  const workspace = mkdtempSync(join(tmpdir(), "mpd-team-record-"))
  /** The tools the plugin registered. */
  const tools = new Map<string, Tool>()
  /** Every executor call, in order. */
  const calls: ExecutorCall[] = []
  /** The service the plugin published. */
  let service: MpdTeamsService | undefined
  /** How many tasks the stub board has handed out so far. */
  let minted = 0
  /** The stub adapter: only the seams this path reaches, each one RECORDED. */
  const dsh = {
    registerTool: (definition: Tool) => { tools.set(definition.name, definition); return () => {} },
    registerCommand: () => () => {},
    workspaceRoot: () => workspace,
    text: (value: string) => value,
    teamListMembers: () => [],
    teamListTasks: () => [],
    teamSpawnTeammate: async (_caller: unknown, request: Record<string, unknown>) => {
      calls.push({ method: "spawnTeammate", args: request })
      if (options.failMember !== undefined && request.name === options.failMember) throw new Error("the executor refused " + String(request.name))
      return { id: "sess-" + String(request.name).replace(/\s+/g, "-") }
    },
    teamCreateTask: async (_caller: unknown, request: Record<string, unknown>) => {
      calls.push({ method: "createTask", args: request })
      minted += 1
      /** The handle this board mints, which the RECORD must keep but never adopt as its own id. */
      const id = options.taskIds?.[minted - 1] ?? "board-" + minted
      return { id, revision: 7, subject: request.subject }
    },
    teamUpdateTask: async (_caller: unknown, request: Record<string, unknown>) => {
      calls.push({ method: "updateTask", args: request })
      return { id: request.taskId, revision: 8 }
    },
    capabilities: () => ({}),
  }
  /** The minimal cordis context `apply` needs, with `provide` capturing the published service. */
  const ctx = {
    get: (id: string) => (id === "mpdDsh" ? dsh : undefined),
    on: () => {},
    effect: (fn: () => unknown) => { try { return fn() ?? (() => {}) } catch { return () => {} } },
    provide: (id: string, value: unknown) => { if (id === TEAMS_SERVICE) service = value as MpdTeamsService },
    inject: () => {},
  }
  apply(ctx as never)
  /** The exec payload every tool call carries; the session id is what binds the record. */
  const exec = { agent: { session: { id: "sess-1" } }, signal: undefined }
  return {
    workspace, tools, calls, exec,
    /** The `mpdTeams` service the plugin published; read through a getter because `apply` runs after this literal is built. */
    get service(): MpdTeamsService | undefined { return service },
    call: async (name: string, args: unknown) => {
      /** The registered tool, or a thrown error naming what WAS registered. */
      const tool = tools.get(name)
      if (tool === undefined) throw new Error(`no tool ${name} (have ${[...tools.keys()].join(", ")})`)
      return tool.execute(args, exec)
    },
  }
}

/** Stage a two-member, two-task plan through the real tools, ready for an approval arm. */
async function staged(h: Harness): Promise<void> {
  await h.call("agent_teams_plan", { action: "create", name: "wave-3", description: "split the plane" })
  await h.call("agent_teams_plan", { action: "add_member", member: { name: "Senior Engineer", description: "implements", prompt: "You implement.", role: "Senior Engineer" } })
  await h.call("agent_teams_plan", { action: "add_member", member: { name: "Reviewer", description: "judges", prompt: "You review.", role: "Reviewer" } })
  // The second task is blocked by the first task's SUBJECT, which is how a captain writes it.
  await h.call("agent_teams_plan", { action: "create_task", task: { subject: "core", description: "own the record", write_scopes: ["packages/**"], owner: "Senior Engineer" } })
  await h.call("agent_teams_plan", { action: "create_task", task: { subject: "review the core", description: "judge it", blocked_by: ["core"], owner: "Reviewer" } })
}

/** Every sandbox one arm created, removed even when the arm fails. */
const sandboxes: string[] = []
afterEach(() => { for (const dir of sandboxes.splice(0)) rmSync(dir, { recursive: true, force: true }) })

describe("approval builds an mpd-owned team record", () => {
  test("the record carries OUR ids, the review fields, and the resolved dependency edges", async () => {
    /** The harness under test. */
    const h = harness()
    sandboxes.push(h.workspace)
    await staged(h)
    expect(listTeams(h.workspace)).toEqual([])
    await h.call("agent_teams_plan", { action: "approve" })
    /** The team the workspace now holds. */
    const teams = listTeams(h.workspace)
    expect(teams.length).toBe(1)
    /** The record itself. */
    const record = teams[0]
    // Ids are OURS and short, because the graph draws them and a tool takes them.
    expect(record.members.map((member) => member.id)).toEqual(["M1", "M2"])
    expect(record.tasks.map((task) => task.id)).toEqual(["T1", "T2"])
    // The blocker was written as the SUBJECT "core" and resolves to our own T1.
    expect(record.tasks[1].blockedBy).toEqual(["T1"])
    // The plan's `write_scopes` survived into the record, where the graph and the gate read it.
    expect(record.tasks[0].writeScopes).toEqual(["packages/**"])
    expect(record.tasks[0].owner).toBe("Senior Engineer")
    expect(record.approvedAt).toBeDefined()
    expect(record.phase).toBe("active")
  })

  test("the executor's handles are KEPT BESIDE our ids, never adopted as them", async () => {
    /** The harness under test, whose stub board mints handles that look nothing like ours. */
    const h = harness({ taskIds: ["official-77", "official-88"] })
    sandboxes.push(h.workspace)
    await staged(h)
    await h.call("agent_teams_plan", { action: "approve" })
    /** The approved record. */
    const record = listTeams(h.workspace)[0]
    // Our ids are unchanged by whatever the executor answered...
    expect(record.tasks.map((task) => task.id)).toEqual(["T1", "T2"])
    // ...while the handles are recorded for the calls that must name them.
    expect(record.tasks.map((task) => task.executorRef)).toEqual(["official-77", "official-88"])
    expect(record.members.every((member) => member.status === "running")).toBe(true)
    expect(record.members[0].executorRef).toBe("sess-Senior-Engineer")
  })

  test("the executor is told OUR dependency in ITS vocabulary, and the owner in ITS handle", async () => {
    /** The harness under test. */
    const h = harness({ taskIds: ["official-77", "official-88"] })
    sandboxes.push(h.workspace)
    await staged(h)
    await h.call("agent_teams_plan", { action: "approve" })
    /** The two createTask payloads, in order. */
    const creates = h.calls.filter((call) => call.method === "createTask")
    expect(creates.length).toBe(2)
    // The blocker leaves as the EXECUTOR's id for our T1, not as our id and not as the subject.
    expect(creates[1].args.blockedBy).toEqual(["official-77"])
    expect(creates[0].args.blockedBy).toBeUndefined()
    /** The reassign calls, one per owned task. */
    const reassigns = h.calls.filter((call) => call.method === "updateTask")
    expect(reassigns.map((call) => call.args.owner)).toEqual(["sess-Senior-Engineer", "sess-Reviewer"])
    expect(reassigns.map((call) => call.args.taskId)).toEqual(["official-77", "official-88"])
    // The revision the executor reported is echoed back, so its own CAS is satisfied.
    expect(reassigns[0].args.expectedRevision).toBe(7)
  })

  test("a spawn that fails STOPS the approval but still leaves the team on record", async () => {
    /** The harness whose second member cannot be spawned. */
    const h = harness({ failMember: "Reviewer" })
    sandboxes.push(h.workspace)
    await staged(h)
    /** The approval result, which must report where it stopped. */
    const result = (await h.call("agent_teams_plan", { action: "approve" })) as { stoppedAt?: string }
    expect(result.stoppedAt).toContain("Reviewer")
    /** The record written despite the failure. */
    const record = listTeams(h.workspace)[0]
    // The member that failed says so; the one that spawned keeps its handle.
    expect(record.members.map((member) => member.status)).toEqual(["running", "failed"])
    // No board task was created, because a half-built roster must not be handed work.
    expect(h.calls.some((call) => call.method === "createTask")).toBe(false)
    expect(record.tasks.every((task) => task.executorRef === undefined)).toBe(true)
  })

  test("an approval with a dry run records NOTHING", async () => {
    /** The harness under test. */
    const h = harness()
    sandboxes.push(h.workspace)
    await staged(h)
    await h.call("agent_teams_plan", { action: "approve", dry_run: true })
    expect(listTeams(h.workspace)).toEqual([])
    expect(h.calls.length).toBe(0)
  })
})

describe("the published service is the read surface", () => {
  test("mpdTeams answers from the record, and reads nothing from the official plane", async () => {
    /** The harness under test, whose official readout is deliberately EMPTY. */
    const h = harness()
    sandboxes.push(h.workspace)
    await staged(h)
    await h.call("agent_teams_plan", { action: "approve" })
    /** The published service; a missing one is the failure this arm exists to catch. */
    const service = h.service
    expect(service).toBeDefined()
    if (service === undefined) return
    /** The team the service binds to this session. */
    const active = service.active(h.workspace, "sess-1")
    expect(active?.name).toBe("wave-3")
    // The roster comes from the RECORD: `teamListMembers` answers [] above, so a service that read
    // the official plane would report no members at all.
    expect(active?.members.map((member) => member.name)).toEqual(["Senior Engineer", "Reviewer"])
    expect(service.memberNames(h.workspace)).toEqual(["Senior Engineer", "Reviewer"])
    expect(service.teamIds(h.workspace)).toEqual([active?.teamId ?? ""])
    // The derived reads agree with the store's own maths.
    expect(service.visual(active as never, "T2")).toBe("blocked")
    expect(service.summary(active as never).links).toBe(1)
    expect(service.progress(active as never, "Senior Engineer")).toEqual({ done: 0, total: 1, current: "T1" })
    // A workspace with no team answers empty rather than throwing.
    expect(service.list("/nonexistent-workspace")).toEqual([])
    expect(service.active("/nonexistent-workspace", "sess-1")).toBeUndefined()
  })

  test("status reports the RECORD as the team, with the official readout beside it", async () => {
    /** The harness under test. */
    const h = harness()
    sandboxes.push(h.workspace)
    await staged(h)
    await h.call("agent_teams_plan", { action: "approve" })
    /** The status payload. */
    const status = (await h.call("agent_teams_plan", { action: "status" })) as { team: { tasks: unknown[] } | null; members: unknown[]; summary: { total: number } | null }
    expect(status.team).not.toBeNull()
    expect(status.summary?.total).toBe(2)
    // Members and tasks are the RECORD's rows, not the executor's empty readout.
    expect(status.members.length).toBe(2)
  })

  test("the record survives a lost index: the Lead session still finds its team", async () => {
    /** The harness under test. */
    const h = harness()
    sandboxes.push(h.workspace)
    await staged(h)
    await h.call("agent_teams_plan", { action: "approve" })
    /** The record before the index is destroyed. */
    const before = listTeams(h.workspace)[0]
    // Delete the index the way a copied workspace would lose it, and re-read through the SERVICE.
    rmSync(join(teamRoot(h.workspace), "teams.json"), { force: true })
    expect(readTeam(h.workspace, before.teamId)).toBeDefined()
    expect(h.service?.active(h.workspace, "sess-1")?.teamId).toBe(before.teamId)
    // A DIFFERENT session in the same workspace is not given someone else's team.
    expect(h.service?.active(h.workspace, "sess-other")).toBeUndefined()
  })
})
