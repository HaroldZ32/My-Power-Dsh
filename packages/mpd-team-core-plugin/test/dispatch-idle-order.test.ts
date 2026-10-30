// D2 REGRESSION (CodeRabbit #81, Major): a member being dispatched must never be marked idle.
//
// THE DEFECT THIS PINS. `agent_teams_dispatch` sends the task message BEFORE it writes the owner onto
// the board. The native executor cold-resumes an absent child during `sendMessage`, so the child's first
// `agent/pre-step` can run while the assignment is not yet on the record: the idle guard would mark it,
// inject "End your turn now", and DENY the `agent_teams_task claim` the dispatch exists to hand over.
// The fix is the counted DISPATCH WINDOW the pass opens around the whole pairing (`beginDispatch`).
//
// HOW THE ARM MODELS IT: the executor double's `send` fires the member's captured pre-step AND asks the
// installed tool guards for their verdict BEFORE it returns — exactly the send-before-owner-write order
// the finding names. Without the window this arm reddens (the pre-step returns the idle directive and the
// guard denies); with it, both answer "not idle".
import { afterEach, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { apply } from "../src/index"
import { addTeamMember, addTeamTask, createTeam, readTeam, writeTeam, type TeamRecord } from "../src/team-store"

/** The frozen clock every seeded instant is derived from. */
const NOW = new Date("2026-10-30T12:00:00.000Z")

/** One fake live agent: the session id the harness resolves and its workspace header. */
interface FakeAgent {
  /** The agent id, which the adapter keeps equal to the session id. */
  id: string
  /** The session the guard resolves and the workspace header the adapter reads. */
  session: { id: string; header: { cwd: string } }
}

/** One captured tool registration, with the executor an arm drives. */
interface CapturedTool {
  /** The registered name. */
  name: string
  /** The runner the adapter wrapped. */
  execute: (args: unknown, exec: unknown) => Promise<unknown>
}

/** What the executor double observed at the moment of the send. */
interface Observations {
  /** The pre-step decision the cold-resumed child received (undefined when the guard did not intervene). */
  preStep: unknown
  /** Every non-empty denial a tool guard returned for the member's claim. */
  denied: string[]
}

/** The harness one arm drives. */
interface Fixture {
  /** The sandbox workspace the team record lives in. */
  workspace: string
  /** The observations the executor double recorded inside `send`. */
  observations: Observations
  /** Drive one registered tool AS one session. */
  call: (sessionId: string, name: string, args: unknown) => Promise<any>
  /** Re-read a team record from disk. */
  record: (teamId: string) => TeamRecord | undefined
  /** Fire the member's registered pre-step outside any dispatch window (the member's own next turn). */
  step: (turn?: number) => unknown
  /** Every denial a tool guard returns for the member's claim, outside any dispatch window. */
  toolDenied: () => string[]
}

/** The sandboxes this file created, removed after each arm. */
const sandboxes: string[] = []
afterEach(() => { for (const dir of sandboxes.splice(0)) rmSync(dir, { recursive: true, force: true }) })

/**
 * Build the harness: the plugin applied over a stub adapter that really installs the idle guard (a
 * per-agent pre-step seam + a tool guard) and an executor double whose `send` simulates the cold resume.
 * @returns the fixture an arm drives.
 */
function fixture(): Fixture {
  /** The sandbox workspace, which is what `workspaceRoot` answers. */
  const workspace = mkdtempSync(join(tmpdir(), "mpd-dispatch-idle-"))
  sandboxes.push(workspace)
  /** The registered tools, by name. */
  const tools = new Map<string, CapturedTool>()
  /** The pre-step listener the guard registered for the member agent. */
  const preSteps = new Map<unknown, (payload: unknown, decision: unknown) => unknown>()
  /** The tool guards the row installed. */
  const guards: Array<(exec: { agent?: unknown; name?: string }) => string | undefined> = []
  /** What `send` observed before it returned. */
  const observations: Observations = { preStep: undefined, denied: [] }
  /** The member agent the seeded roster names. */
  const member: FakeAgent = { id: "sess-worker", session: { id: "sess-worker", header: { cwd: workspace } } }
  /** The executor double: `send` cold-resumes the member and fires its first pre-step inside the call. */
  const executor = {
    kind: "native",
    reason: "test double",
    send: async (_caller: unknown, handle: string): Promise<void> => {
      if (handle !== member.id) return
      /** The guard's listener for this agent, when the guard was installed for it. */
      const listener = preSteps.get(member)
      if (listener !== undefined) observations.preStep = listener({ agent: member, turn: 1 }, { kind: "enter", messages: [] })
      observations.denied = guards.map((guard) => guard({ agent: member, name: "agent_teams_task" })).filter((answer): answer is string => typeof answer === "string")
    },
  }
  /** The stub adapter: every seam the row reads, with the idle guard's three installed for real. */
  const dsh = {
    registerTool: (definition: CapturedTool): (() => void) => { tools.set(definition.name, definition); return () => {} },
    registerCommand: (): (() => void) => () => {},
    workspaceRoot: (): string => workspace,
    onEvent: (): (() => void) => () => {},
    teamExecutor: () => executor,
    teamListMembers: (): unknown[] => [],
    teamListTasks: (): unknown[] => [],
    capabilities: () => ({}),
    liveAgents: (): FakeAgent[] => [member],
    registerAgentPreStep: (agent: unknown, listener: (payload: unknown, decision: unknown) => unknown): (() => void) => {
      preSteps.set(agent, listener)
      return (): void => { preSteps.delete(agent) }
    },
    guardTool: (guard: (exec: { agent?: unknown; name?: string }) => string | undefined): (() => void) => {
      guards.push(guard)
      return (): void => {}
    },
  }
  /** The minimal cordis context `apply` needs. */
  const ctx = {
    get: (id: string) => (id === "mpdDsh" ? dsh : undefined),
    on: () => {},
    effect: (fn: () => unknown) => { try { return fn() ?? (() => {}) } catch { return () => {} } },
    provide: () => {},
    inject: () => {},
  }
  apply(ctx as never)
  return {
    workspace,
    observations,
    call: async (sessionId: string, name: string, args: unknown) => {
      /** The registered tool, or a thrown error naming what WAS registered. */
      const tool = tools.get(name)
      if (tool === undefined) throw new Error("no tool " + name + " (have " + [...tools.keys()].join(", ") + ")")
      return tool.execute(args, { agent: { session: { id: sessionId, header: { cwd: workspace } } }, signal: undefined })
    },
    record: (teamId: string) => readTeam(workspace, teamId),
    step: (turn?: number) => {
      /** The guard's listener for this agent, when the guard was installed for it. */
      const listener = preSteps.get(member)
      if (listener === undefined) throw new Error("the guard registered no pre-step listener for the member")
      return listener({ agent: member, turn: turn ?? 2 }, { kind: "enter", messages: [] })
    },
    toolDenied: () => guards.map((guard) => guard({ agent: member, name: "agent_teams_task" })).filter((answer): answer is string => typeof answer === "string"),
  }
}

/**
 * Seed one approved team: a running member whose executor handle is the fake session, and one pending
 * task owned by it (the plan-time owner, never a claim).
 * @param workspace - the sandbox that receives the record.
 * @returns the record as written.
 */
function seed(workspace: string): TeamRecord {
  /** The freshly minted record, bound to its Lead. */
  let record = createTeam(workspace, { teamId: "team-d2", name: "team-d2", description: "D2 regression", leadSessionId: "sess-lead" }, NOW)
  record = addTeamMember(record, { name: "worker", description: "the dispatched member" }, NOW)
  // UNOWNED ON PURPOSE: the defect only bites when the assignment exists solely in the pass's
  // post-send compare-and-set. A plan-time owner would already make the task open at send time (the
  // §6.4 asymmetry), which is why a seeded owner would make this arm pass against the broken code.
  record = addTeamTask(record, { subject: "work", description: "the one task" }, NOW)
  /** The record as an approval leaves it: the member spawned and running under its fake handle. */
  const approved: TeamRecord = {
    ...record,
    approvedAt: NOW.toISOString(),
    phase: "active",
    members: record.members.map((entry) => ({ ...entry, status: "running" as const, executorRef: "sess-worker" })),
  }
  writeTeam(workspace, approved)
  return approved
}

test("D2: the cold-resumed member's first pre-step inside send is NOT marked idle, and its claim is allowed", async () => {
  /** The harness under test. */
  const h = fixture()
  seed(h.workspace)
  /** The dispatch pass's answer. */
  const answer = await h.call("sess-lead", "agent_teams_dispatch", { action: "run" })
  expect(answer.pairs.map((pair: { taskId: string }) => pair.taskId)).toEqual(["T1"])
  // THE ASSERTIONS THE DEFECT VIOLATED: inside `send` the child saw no directive and no denial.
  expect(h.observations.preStep).toBeUndefined()
  expect(h.observations.denied).toEqual([])
  // And the pass really recorded the assignment afterwards — the window is not a licence to skip the write.
  /** The record as the pass left it. */
  const record = h.record("team-d2")
  expect(record?.tasks[0]?.status).toBe("in_progress")
  expect(record?.tasks[0]?.owner).toBe("worker")
})

test("D2 negative control: a genuinely taskless member still gets the directive and the hard denial", async () => {
  /** The harness under test. */
  const h = fixture()
  // A team with a running member and NO task at all: the board authorises nothing, so no pairing (and
  // therefore no dispatch window) can exist for this member.
  /** The taskless record, written as an approval would leave it. */
  const seeded = createTeam(h.workspace, { teamId: "team-d2", name: "team-d2", description: "D2 negative", leadSessionId: "sess-lead" }, NOW)
  /** The same record with the member spawned. */
  const withMember = addTeamMember(seeded, { name: "worker", description: "the taskless member" }, NOW)
  writeTeam(h.workspace, {
    ...withMember,
    approvedAt: NOW.toISOString(),
    phase: "active",
    members: withMember.members.map((entry) => ({ ...entry, status: "running" as const, executorRef: "sess-worker" })),
  })
  // No pairing, so no window ever opens; the member's own next turn is what the guard sees.
  const answer = await h.call("sess-lead", "agent_teams_dispatch", { action: "run" })
  expect(answer.pairs).toEqual([])
  /** The pre-step outside any window. */
  const decision = h.step(2) as { messages?: readonly unknown[] } | undefined
  expect(Array.isArray(decision?.messages)).toBe(true)
  expect(decision?.messages?.length).toBe(1)
  expect(h.toolDenied().length).toBe(1)
})

test("D2 aftermath: once the pass has written the claim, the member's OWN next step is no longer marked", async () => {
  /** The harness under test. */
  const h = fixture()
  seed(h.workspace)
  await h.call("sess-lead", "agent_teams_dispatch", { action: "run" })
  // The window is closed by the pass's `finally`; the re-evaluation now sees the claimed task.
  expect(h.step(2)).toBeUndefined()
  expect(h.toolDenied()).toEqual([])
})
