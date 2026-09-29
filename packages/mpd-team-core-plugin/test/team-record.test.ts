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
import { createDshAdapter } from "../../mpd-dsh-adapter-plugin/src/index"
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
  /** The watchdog's verdict for any team id, when an arm needs a hold in force. */
  watchdogHolds?: boolean
  /** The member whose spawn throws, by name, when an arm needs a half-built team. */
  failMember?: string
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
  /** Every call the harness double observed, in order. */
  const calls: ExecutorCall[] = []
  /** The service the plugin published. */
  let service: MpdTeamsService | undefined
  // THE NATIVE BACKEND (W2). The double sits at the HARNESS boundary — `ctx.subagents` — and the
  // REAL adapter is built over it, so these arms exercise the executor implementation rather than a
  // stub of it. `spawnTeammate` is deliberately ABSENT: an approval that still reached for the
  // official service would fail here instead of passing quietly.
  /** The `ctx.subagents` double: the three seams the native executor uses. */
  const subagents = {
    providers: () => ["spawn", "mpd-roster"],
    /** Record the raise and answer with a handle derived from the member name. */
    startContinuable(this: unknown, spec: any): Promise<unknown> {
      calls.push({ method: "startContinuable", args: spec })
      /** The member name the executor put on the label, which is how a failure is aimed. */
      const label = String(spec?.label ?? "")
      if (options.failMember !== undefined && label.startsWith(options.failMember)) {
        throw new Error("the executor refused " + options.failMember)
      }
      // The handle is derived from the member name so an arm can predict it, exactly as the
      // official double's ids used to be.
      return Promise.resolve({ childId: "child-" + label.split(" \u00b7 ")[0].replace(/\s+/g, "-"), messageId: "m1" })
    },
    /** Record the delivery and answer with an inbox id. */
    sendMessage(this: unknown, sender: unknown, targetId: unknown, content: unknown, opts: unknown): Promise<unknown> {
      calls.push({ method: "sendMessage", args: { sender, targetId, content, opts } })
      return Promise.resolve("m2")
    },
    /** Record the interrupt. */
    interrupt(this: unknown, targetId: unknown, authority: unknown): void {
      calls.push({ method: "interrupt", args: { targetId, authority } })
    },
  }
  /** The stub watchdog service, when this arm staged one. */
  const watchdog = options.watchdogHolds === undefined
    ? undefined
    : { isHeld: () => options.watchdogHolds === true, holds: () => (options.watchdogHolds === true ? ["held"] : []) }
  /** The stub adapter: the plugin's own seams, plus the REAL executor over the harness double. */
  const dsh = {
    registerTool: (definition: Tool) => { tools.set(definition.name, definition); return () => {} },
    registerCommand: () => () => {},
    workspaceRoot: () => workspace,
    text: (value: string) => value,
    // NO `agentTeams` is mounted anywhere in this harness: `ctx.get("agentTeams")` answers
    // undefined, so the executor's choice must land on the native default. An arm asserting the
    // old official behaviour would fail here rather than pass against a half-migrated path.
    teamExecutor: () => createDshAdapter({ get: (name: string) => (name === "subagents" ? subagents : undefined) } as never).teamExecutor(),
    teamListMembers: () => [],
    teamListTasks: () => [],
    capabilities: () => ({}),
  }
  /** The minimal cordis context `apply` needs; `provide` captures the service it publishes. */
  const ctx = {
    get: (id: string) => (id === "mpdDsh" ? dsh : id === "mpdWatchdog" ? watchdog : id === "subagents" ? subagents : undefined),
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
    /** The harness under test, whose double mints handles that look nothing like ours. */
    const h = harness()
    sandboxes.push(h.workspace)
    await staged(h)
    await h.call("agent_teams_plan", { action: "approve" })
    /** The approved record. */
    const record = listTeams(h.workspace)[0]
    // Our ids are unchanged by whatever the backend answered...
    expect(record.tasks.map((task) => task.id)).toEqual(["T1", "T2"])
    expect(record.members.map((member) => member.id)).toEqual(["M1", "M2"])
    // ...while the backend's handle is recorded for the calls that must name it.
    expect(record.members.map((member) => member.executorRef)).toEqual(["child-Senior-Engineer", "child-Reviewer"])
    expect(record.members.every((member) => member.status === "running")).toBe(true)
  })

  test("NO BOARD IS MIRRORED: the mpd record IS the board, so a task keeps our id and only our id", async () => {
    // THE SEPARATION, ASSERTED NEGATIVELY. W1 still posted every task to the official board and
    // recorded the board's id beside ours, which left TWO sources of truth for one team and made
    // the official plugin a hard dependency of `approve`. The record now carries the dependency
    // edges, the review fields and the ownership itself, so nothing is posted anywhere.
    /** The harness under test. */
    const h = harness()
    sandboxes.push(h.workspace)
    await staged(h)
    await h.call("agent_teams_plan", { action: "approve" })
    /** The approved record. */
    const record = listTeams(h.workspace)[0]
    // The tasks carry NO backend handle, because no backend was asked to mint one.
    expect(record.tasks.every((task) => task.executorRef === undefined)).toBe(true)
    // The dependency edge, the ownership and the scopes are all mpd's own, and they are what a
    // dispatch pass reads — `readyTasks` and `idleMembers` resolve them against this board.
    expect(record.tasks[1].blockedBy).toEqual(["T1"])
    expect(record.tasks[0].owner).toBe("Senior Engineer")
    expect(record.tasks[0].writeScopes).toEqual(["packages/**"])
    // Not one call reached the official service: `spawnTeammate` is not even on the double, so a
    // regression to the old path would throw here rather than pass.
    expect(h.calls.map((call) => call.method)).toEqual(["startContinuable", "startContinuable"])
  })

  test("the member's ROUTE reaches the executor as an ordinary argument", async () => {
    // This is the whole reason the native default exists: the official tool row forwards only
    // `{ prompt, parent }`, so a per-member model route had to arrive through ROW CONFIG
    // (`freshProvider`) and a member's identity had to be encoded in its DESCRIPTION. Here the
    // route is a spawn argument, which is what lets a roster slot, a persona and the read-only
    // deny list apply to a teammate directly.
    /** The harness under test. */
    const h = harness()
    sandboxes.push(h.workspace)
    await staged(h)
    await h.call("agent_teams_plan", { action: "approve" })
    /** The two spawn specs the double recorded, in order. */
    const specs = h.calls.filter((call) => call.method === "startContinuable").map((call) => call.args as any)
    expect(specs.length).toBe(2)
    // The provider and the label are the executor's own; the parent is the calling Lead.
    expect(specs[0].provider).toBe("spawn")
    expect(specs[0].label).toBe("Senior Engineer · " + listTeams(h.workspace)[0].teamId)
    expect(specs[0].request.parent).toEqual({ session: { id: "sess-1" } })
    // The prompt travels as content blocks, which is what the continuation manager takes.
    expect(specs[0].request.prompt[0].text).toBe("You implement.")
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

describe("the watchdog hold stops a dispatch pass", () => {
  test("a team the watchdog holds is NOT dispatched, and the refusal names the team", async () => {
    // THE DEFECT THIS PINS: the watchdog's hold was carried by a service NO shipped gate consulted,
    // while `agent_teams_dispatch` read only its own workspace-wide `hold.json`. A parked team
    // therefore stayed dispatchable. With the record naming the team, the hold can be asked about.
    /** The harness whose watchdog holds every team. */
    const h = harness({ watchdogHolds: true })
    sandboxes.push(h.workspace)
    await staged(h)
    await h.call("agent_teams_plan", { action: "approve" })
    /** The dispatch result, which must refuse the whole pass. */
    const result = (await h.call("agent_teams_dispatch", { action: "run" })) as { halted?: string; pairs?: unknown[] }
    expect(result.halted).toContain("watchdog")
    expect(result.pairs).toHaveLength(0)
    // Nothing was paired, so nothing was sent to a member.
    expect(h.calls.some((call) => call.method === "sendMessage")).toBe(false)
  })

  test("with the watchdog's hold LIFTED the same pass dispatches", async () => {
    // The falsifier: without it, the arm above would pass even if dispatch were broken outright.
    /** The harness whose watchdog holds nothing. */
    const h = harness({ watchdogHolds: false })
    sandboxes.push(h.workspace)
    await staged(h)
    await h.call("agent_teams_plan", { action: "approve" })
    /** The dispatch result, which must pair the one ready task. */
    const result = (await h.call("agent_teams_dispatch", { action: "run" })) as { halted?: string }
    expect(result.halted).toBeUndefined()
    expect(h.calls.filter((call) => call.method === "sendMessage").length).toBe(1)
  })

  test("with NO watchdog service at all the pass dispatches — the read fails OPEN", async () => {
    /** The harness whose composition has no watchdog row. */
    const h = harness()
    sandboxes.push(h.workspace)
    await staged(h)
    await h.call("agent_teams_plan", { action: "approve" })
    /** The dispatch result under an absent service. */
    const result = (await h.call("agent_teams_dispatch", { action: "run" })) as { halted?: string }
    expect(result.halted).toBeUndefined()
  })
})
