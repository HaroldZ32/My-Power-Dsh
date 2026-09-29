// t49 — R1 is WIRED, not just a library. The tool boundary must show the delivery
// idempotency the primitives promise: two identical sends inside the window produce ONE
// surviving durable record, so the scheduler can deliver it at most once.
import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
// The vendored module now resolves to its .ts source, so this surface is typed from that file.
import { CAPTAIN_KEY, INTERJECTION_QUEUE, appendMailbox, clearMailboxToWatermark, readMailbox, readUnreadMailbox } from "../lib/state.ts"
// The vendored module now resolves to its .ts source, so this surface is typed from that file.
import { installTeamScheduler } from "../lib/scheduler.ts"
// The vendored module now resolves to its .ts source, so this surface is typed from that file.
import { registerAgentTeamsTools } from "../lib/tools.ts"

/** State root every fixture team lives under, relative to the session workspace cwd. */
const STATE_DIR = join(".mpd", "team")
/** Session id the fixture registers as the team's captain. */
const CAPTAIN = "session-t49-captain"
/** Session id the fixture registers as the single engineer member. */
const MEMBER = "session-t49-member"

/** One durable mailbox row, naming only the fields these arms assert on. */
type MailboxRecord = {
  /** Row id the fold keeps once a repeat was folded into it. */
  readonly id: string
  /** How many identical sends this row now stands for. */
  readonly dupCount: number
  /** Epoch ms the member read the row; absent while it is still owed a delivery. */
  readonly readAt?: number
  /** Epoch ms a delivery lease was taken; absent while the row is still claimable. */
  readonly deliveryClaimedAt?: number
  /** Set on a CLEARED row, which must never wake anyone again. */
  readonly tombstone?: boolean
}

/** One tool the vendored surface registered, naming only the members these arms use. */
type RegisteredTool = {
  /** Tool name, the key the model calls it by. */
  readonly name: string
  /** The tool body; `exec.agent` is the calling session. */
  readonly execute: (args: Record<string, unknown>, exec: { agent: unknown }) => Promise<Record<string, unknown>>
}

/** One registry-live session the fixture registers, with the route the scheduler resolves. */
type FixtureAgent = {
  /** Session id the scheduler addresses deliveries to. */
  readonly id: string
  /** Liveness status the scheduler's idle edge reads. */
  readonly status: string
  /** The route the fixture pins, as a real spawn would. */
  readonly options: { readonly provider: string; readonly model: string }
  /** The session header carrying the workspace cwd, plus the request-header stub. */
  readonly session: {
    /** The session's working directory, which roots every `.mpd` state read. */
    readonly header: { readonly cwd: string }
    /** The per-request route the tool resolves before a live delivery. */
    readonly requestHeader: () => { readonly config: { readonly provider: string; readonly model: string } }
  }
}

/** One wired fixture: a real team record on disk, the SHIPPED tools and the real scheduler. */
function fixture(options: { task?: Record<string, unknown> } = {}): {
  /** Absolute workspace every stub session reports as its cwd. */
  workspace: string
  /** Team id the scheduler resolves under the state root. */
  teamId: string
  /** The `<workspace>/.mpd/team` root the fixture team record lives under. */
  stateRoot: string
  /** Tools the vendored surface registered, keyed by the name the model calls. */
  tools: Map<string, RegisteredTool>
  /** The captain session, registered as registry-live. */
  captain: FixtureAgent
  /** The engineer session, registered as registry-live. */
  member: FixtureAgent
  /** Wake-ups the continuable seam accepted, in acceptance order. */
  deliveries: Array<Record<string, unknown>>
  /** The knob that makes the next live send fail, so the mailbox path is exercised. */
  deliveryPolicy: { failLiveSends: number }
  /** The installed scheduler, whose `kickMember` the arms drive as the idle edge would. */
  runtime: { kickMember: (workspace: string, teamId: string, memberName: string) => Promise<unknown> }
  /** Removes the temporary workspace tree. */
  cleanup: () => void
} {
  /** Temporary workspace every stub session reports as its cwd. */
  const workspace = mkdtempSync(join(tmpdir(), "mpd-t49-"))
  /** Team id the fixture writes its single team record under. */
  const teamId = "t49-team"
  /** The state root under that workspace, where the record and mailboxes live. */
  const stateRoot = join(workspace, STATE_DIR)
  mkdirSync(join(stateRoot, teamId, "inbox"), { recursive: true })
  /** The fixture clock, shared by the team record and the seeded task. */
  const now = Date.now()
  // `options.task` seeds ONE dispatchable task so the same kick path that delivers
  // mailbox work can also be observed performing the assignment (task call count).
  /** The seeded task list: empty by default, one dispatchable task when requested. */
  const tasks = options.task === undefined ? [] : [{
    id: "t49-task", subject: "wired task", description: "seeded for the dispatch count",
    assignee: "Senior Engineer", status: "pending", attempt: 0, dependencies: [], createdAt: now, updatedAt: now,
    ...options.task,
  }]
  writeFileSync(join(stateRoot, teamId, "team.json"), JSON.stringify({
    id: teamId, name: "t49", captainSessionId: CAPTAIN, createdAt: now, updatedAt: now, taskSeq: 0, phase: "running",
    members: [{ id: MEMBER, name: "Senior Engineer", role: "engineer", status: "idle", joinedAt: now }],
    tasks,
  }, null, 2))
  /** The captain session the registry answers with, routed through the pinned model. */
  const captain = { id: CAPTAIN, status: "idle", options: { provider: "deepseek-official", model: "deepseek-v4-flash" }, session: { header: { cwd: workspace }, requestHeader: () => ({ config: { provider: "deepseek-official", model: "deepseek-v4-flash" } }) } }
  /** The engineer session the registry answers with, under the same pinned route. */
  const member = { id: MEMBER, status: "idle", options: { provider: "deepseek-official", model: "deepseek-v4-flash" }, session: { header: { cwd: workspace }, requestHeader: () => ({ config: { provider: "deepseek-official", model: "deepseek-v4-flash" } }) } }
  /** Tools the vendored surface registered, keyed by the name the model calls. */
  const tools = new Map<string, RegisteredTool>()
  // Every delivery goes through the Harness continuable seam. Counting THESE calls is
  // the delivery evidence: one accepted queue == one wake-up.
  /** Wake-ups the seam accepted, in acceptance order. */
  const deliveries: Array<Record<string, unknown>> = []
  /** The knob the live-delivery arm flips, so the first send cannot wake the member live. */
  const deliveryPolicy = { failLiveSends: 0 }
  /** The continuable seam as the scheduler sees it: one `prompt`, plus the unused legacy members. */
  const subagents = {
    prompt: async (request: Record<string, unknown>) => {
      if (deliveryPolicy.failLiveSends > 0) {
        deliveryPolicy.failLiveSends -= 1
        throw new Error("t49 fixture: live delivery unavailable")
      }
      deliveries.push(request)
      return { messageId: `delivery-${deliveries.length}` }
    },
    followup: () => {},
    sendMessage: () => {},
  }
  /** The stub composition root the shipped surface and the scheduler are installed on. */
  const ctx = {
    tools: { register: (d: RegisteredTool) => tools.set(d.name, d) },
    agents: { get: (id: string) => (id === CAPTAIN ? captain : id === MEMBER ? member : undefined), list: () => [captain, member] },
    subagents,
    effect: () => {}, on: () => {},
    logger: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} },
    get: () => undefined,
    llm: { resolveCallConfig: async (r: { provider: string; model: string }) => ({ provider: r.provider, model: r.model }), listModels: async () => [] },
  }
  registerAgentTeamsTools(ctx, { stateDir: STATE_DIR })
  /** The installed scheduler, whose kick path the arms drive directly. */
  const runtime = installTeamScheduler(ctx, { stateDir: STATE_DIR })
  return { workspace, teamId, stateRoot, tools, captain, member, deliveries, deliveryPolicy, runtime, cleanup: () => rmSync(workspace, { recursive: true, force: true }) }
}

test("R1 WIRING: two identical agent_teams_send_message calls -> ONE durable record (at-most-once)", async () => {
  // The fixture's state root, team id, registered surface, captain and temp-dir remover.
  const { stateRoot, teamId, tools, captain, cleanup } = fixture()
  try {
    /** The shipped send tool, which the surface always registers under this name. */
    const send = tools.get("agent_teams_send_message")!
    /** The identical payload both sends carry, the fold's only input. */
    const args = { to: "Senior Engineer", content: "identical payload" }
    /** The first send's answer; its message id names the surviving durable record. */
    const first = await send.execute(args, { agent: captain })
    // t48 (P1d): a deliberate repeat must say so — the gate refuses an unconfirmed duplicate.
    /** The confirmed repeat, which must fold onto the first record instead of adding one. */
    const second = await send.execute({ ...args, confirm_duplicate: true }, { agent: captain })
    expect(first.message_id).toBeDefined()
    // the durable mailbox holds ONE record for the two sends, folded to dupCount=2
    /** The mailbox as persisted: exactly one row for the two identical sends. */
    const records: MailboxRecord[] = await readMailbox(stateRoot, teamId, "Senior Engineer")
    expect(records.length).toBe(1)
    expect(records[0].dupCount).toBe(2)
    // The send tool only APPENDS; the delivery lease is taken later by the scheduler
    // (claimMailboxDelivery) and released by acknowledgeMailbox. So the tool boundary
    // must leave the record UNCLAIMED and thus readable — that is exactly what makes
    // the one surviving record claimable once, downstream.
    expect(records[0].deliveryClaimedAt).toBeUndefined()
    expect((await readUnreadMailbox(stateRoot, teamId, "Senior Engineer")).length).toBe(0)
    // the second call still returned a real id (the surviving record's), i.e. no error
    expect(second.message_id).toBe(records[0].id)
  } finally { cleanup() }
})

test("R1 WIRING NEGATIVE CONTROL: different content is NOT folded", async () => {
  // The fixture's state root, team id, registered surface, captain and temp-dir remover.
  const { stateRoot, teamId, tools, captain, cleanup } = fixture()
  try {
    /** The shipped send tool, which the surface always registers under this name. */
    const send = tools.get("agent_teams_send_message")!
    await send.execute({ to: "Senior Engineer", content: "payload A" }, { agent: captain })
    await send.execute({ to: "Senior Engineer", content: "payload B" }, { agent: captain })
    expect((await readMailbox(stateRoot, teamId, "Senior Engineer")).length).toBe(2)
  } finally { cleanup() }
})

test("R1 WIRING: the captain path dedups too (both append sites are wired)", async () => {
  // The fixture's state root, team id, registered surface, member and temp-dir remover.
  const { stateRoot, teamId, tools, member, cleanup } = fixture()
  try {
    /** The shipped send tool, which the surface always registers under this name. */
    const send = tools.get("agent_teams_send_message")!
    await send.execute({ to: "captain", content: "same report" }, { agent: member })
    await send.execute({ to: "captain", content: "same report", confirm_duplicate: true }, { agent: member })
    /** The captain's mailbox: the two reports must fold into one row. */
    const records: MailboxRecord[] = await readMailbox(stateRoot, teamId, CAPTAIN_KEY)
    expect(records.length).toBe(1)
    expect(records[0].dupCount).toBe(2)
  } finally { cleanup() }
})

test("R1 WIRING: two identical sends with live delivery DOWN -> the scheduler delivers exactly ONCE", async () => {
  // The fixture's workspace, team id, state root, surface, captain, seam and scheduler.
  const { workspace, teamId, stateRoot, tools, captain, deliveries, deliveryPolicy, runtime, cleanup } = fixture()
  try {
    deliveryPolicy.failLiveSends = 1 // the first send cannot wake the member live
    /** The shipped send tool, which the surface always registers under this name. */
    const send = tools.get("agent_teams_send_message")!
    /** The identical payload both sends carry, the fold's only input. */
    const args = { to: "Senior Engineer", content: "identical payload" }
    /** The first send's answer: a live failure must degrade to the mailbox. */
    const first = await send.execute(args, { agent: captain })
    /** The confirmed repeat, which must fold without retrying the wake. */
    const second = await send.execute({ ...args, confirm_duplicate: true }, { agent: captain })
    expect(first.delivered).toBe("mailbox")
    expect(second.delivered).toBe("duplicate") // folded, and it must NOT retry the wake
    expect(deliveries.length).toBe(0)
    // the record stayed UNclaimed/UNread, so the scheduler's idle edge is still owed one wake
    /** The mailbox rows, re-read after the kick moves the record to acknowledged. */
    let records: MailboxRecord[] = await readMailbox(stateRoot, teamId, "Senior Engineer")
    expect(records.length).toBe(1)
    expect(records[0].readAt).toBeUndefined()
    expect((await readUnreadMailbox(stateRoot, teamId, "Senior Engineer")).length).toBe(1)
    await runtime.kickMember(workspace, teamId, "Senior Engineer")
    expect(deliveries.length).toBe(1) // CALL COUNT: two sends -> exactly one delivery
    records = await readMailbox(stateRoot, teamId, "Senior Engineer")
    expect(records[0].readAt).toBeDefined() // acknowledged after the accepted delivery
    expect(records[0].dupCount).toBe(2)
    // a second kick has nothing left to deliver, so the count stays at exactly one
    await runtime.kickMember(workspace, teamId, "Senior Engineer")
    expect(deliveries.length).toBe(1)
    expect((await readUnreadMailbox(stateRoot, teamId, "Senior Engineer")).length).toBe(0)
  } finally { cleanup() }
})

test("R1 SEAM: the scheduler's last delivery gate drops CLEARED tombstones", async () => {
  // The fixture's workspace, team id, state root, surface, captain, seam and scheduler.
  const { workspace, teamId, stateRoot, tools, captain, deliveries, runtime, cleanup } = fixture()
  try {
    /** The shipped send tool, which the surface always registers under this name. */
    const send = tools.get("agent_teams_send_message")!
    // NEGATIVE CONTROL first: an ordinary record DOES wake the member through this path
    await send.execute({ to: "Senior Engineer", content: "ordinary wake" }, { agent: captain })
    await runtime.kickMember(workspace, teamId, "Senior Engineer")
    expect(deliveries.length).toBe(1)
    // A record that was CLEARED (tombstone) must never wake anyone. Write the old
    // record FIRST with an explicit past ts, so the clear watermark cannot collide
    // with the newest record's millisecond.
    await appendMailbox(stateRoot, teamId, "Senior Engineer", {
      id: "cleared-1", from: CAPTAIN_KEY, to: "Senior Engineer", content: "cleared payload", ts: 1,
    })
    await clearMailboxToWatermark(stateRoot, teamId, "Senior Engineer", 1, { force: true, now: 1_000 })
    /** The row the clear must have turned into a tombstone, found by its seeded id. */
    const cleared = (await readMailbox(stateRoot, teamId, "Senior Engineer")).find((record: MailboxRecord) => record.id === "cleared-1")
    expect(cleared?.tombstone).toBe(true)
    await runtime.kickMember(workspace, teamId, "Senior Engineer")
    expect(deliveries.length).toBe(1) // unchanged: the tombstone was never deliverable
    // positive control on the SAME kick path: a fresh record still wakes the member,
    // so the assertion above cannot pass by the scheduler simply being dead
    await send.execute({ to: "Senior Engineer", content: "fresh wake" }, { agent: captain })
    await runtime.kickMember(workspace, teamId, "Senior Engineer")
    expect(deliveries.length).toBe(2)
    expect((await readUnreadMailbox(stateRoot, teamId, "Senior Engineer")).length).toBe(0)
  } finally { cleanup() }
})

test("R1 WIRING: two identical sends -> exactly ONE delivery and exactly ONE task assignment", async () => {
  // The fixture's workspace, state root, surface, captain, seam and scheduler, with one task seeded.
  const { workspace, teamId, stateRoot, tools, captain, deliveries, runtime, cleanup } = fixture({ task: {} })
  try {
    /** The shipped send tool, which the surface always registers under this name. */
    const send = tools.get("agent_teams_send_message")!
    /** The identical payload both sends carry, the fold's only input. */
    const args = { to: "Senior Engineer", content: "identical payload" }
    // Count MAILBOX deliveries separately from task-assignment prompts: only the mailbox
    // lane is what two identical sends can duplicate.
    /** The delivered prompts carrying the mailbox payload, counted as the mailbox lane. */
    const mailboxPrompts = (): string[] => deliveries.map((request) => JSON.stringify(request)).filter((text) => text.includes("identical payload"))
    // SHIPPED PATH: the real agent_teams_send_message tool, called exactly as the captain calls it
    await send.execute(args, { agent: captain })
    await send.execute({ ...args, confirm_duplicate: true }, { agent: captain })
    // CALL COUNT: two identical sends -> exactly ONE mailbox delivery
    expect(mailboxPrompts().length).toBe(1)
    // the assignment is still owed (the one record was already consumed live), and this
    // is the SAME scheduler function the agent/status idle listener calls
    await runtime.kickMember(workspace, teamId, "Senior Engineer")
    /** The persisted team record as JSON, read back to inspect the claim it just wrote. */
    const team: {
      /** The seeded task row, whose claim generation the arms assert on. */
      tasks: Array<{ id: string; status?: string; attempt?: number; attemptId?: string; assignee?: string }>
      /** The member rows, whose status the claim must have moved to `working`. */
      members: Array<{ status?: string }>
    } = JSON.parse(readFileSync(join(stateRoot, teamId, "team.json"), "utf8"))
    /** The seeded task, found by the id the fixture wrote; it is the only row there. */
    const task = team.tasks.find((candidate) => candidate.id === "t49-task")!
    // CALL COUNT: the task was claimed exactly ONCE — one attempt generation, one attemptId
    expect(task.status).toBe("claimed")
    expect(task.attempt).toBe(1)
    expect(task.attemptId).toBeDefined()
    expect(task.assignee).toBe("Senior Engineer")
    expect(team.members[0].status).toBe("working")
    expect(mailboxPrompts().length).toBe(1)
    // A second kick cannot duplicate the MAILBOX payload either: the record is consumed.
    // (The fixture leaves the member object 'idle' forever, so the scheduler takes its
    // documented UNOBSERVED-capability recovery path and re-posts the ASSIGNMENT — which
    // is a task-lane behaviour of its own, not an R1 mailbox duplication.)
    await runtime.kickMember(workspace, teamId, "Senior Engineer")
    expect(mailboxPrompts().length).toBe(1)
    expect((await readUnreadMailbox(stateRoot, teamId, "Senior Engineer")).length).toBe(0)
  } finally { cleanup() }
})

test("R1 WIRING: a duplicate send AFTER an acknowledged delivery cannot re-open it", async () => {
  // The fixture's workspace, state root, surface, captain, seam and scheduler.
  const { workspace, teamId, stateRoot, tools, captain, deliveries, runtime, cleanup } = fixture()
  try {
    /** The shipped send tool, which the surface always registers under this name. */
    const send = tools.get("agent_teams_send_message")!
    /** The identical payload both sends carry, the fold's only input. */
    const args = { to: "Senior Engineer", content: "identical payload" }
    await send.execute(args, { agent: captain })
    expect(deliveries.length).toBe(1)
    // the fold now runs against an ALREADY ACKNOWLEDGED row: it must not resurrect it
    /** The confirmed repeat against the acknowledged row, which must not re-open it. */
    const duplicate = await send.execute({ ...args, confirm_duplicate: true }, { agent: captain })
    expect(duplicate.delivered).toBe("duplicate")
    expect(deliveries.length).toBe(1)
    /** The mailbox row, which must still carry the single acknowledged record. */
    const records: MailboxRecord[] = await readMailbox(stateRoot, teamId, "Senior Engineer")
    expect(records.length).toBe(1)
    expect(records[0].readAt).toBeDefined()
    expect(records[0].dupCount).toBe(2)
    await runtime.kickMember(workspace, teamId, "Senior Engineer")
    expect(deliveries.length).toBe(1)
  } finally { cleanup() }
})

