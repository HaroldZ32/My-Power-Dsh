// t49 — R1 is WIRED, not just a library. The tool boundary must show the delivery
// idempotency the primitives promise: two identical sends inside the window produce ONE
// surviving durable record, so the scheduler can deliver it at most once.
import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { CAPTAIN_KEY, INTERJECTION_QUEUE, appendMailbox, clearMailboxToWatermark, readMailbox, readUnreadMailbox } from "../lib/state.js"
import { installTeamScheduler } from "../lib/scheduler.js"
import { registerAgentTeamsTools } from "../lib/tools.js"

const STATE_DIR = join(".mpd", "team")
const CAPTAIN = "session-t49-captain"
const MEMBER = "session-t49-member"

function fixture(options = {}) {
  const workspace = mkdtempSync(join(tmpdir(), "mpd-t49-"))
  const teamId = "t49-team"
  const stateRoot = join(workspace, STATE_DIR)
  mkdirSync(join(stateRoot, teamId, "inbox"), { recursive: true })
  const now = Date.now()
  // `options.task` seeds ONE dispatchable task so the same kick path that delivers
  // mailbox work can also be observed performing the assignment (task call count).
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
  const captain = { id: CAPTAIN, status: "idle", options: { provider: "deepseek-official", model: "deepseek-v4-flash" }, session: { header: { cwd: workspace }, requestHeader: () => ({ config: { provider: "deepseek-official", model: "deepseek-v4-flash" } }) } }
  const member = { id: MEMBER, status: "idle", options: { provider: "deepseek-official", model: "deepseek-v4-flash" }, session: { header: { cwd: workspace }, requestHeader: () => ({ config: { provider: "deepseek-official", model: "deepseek-v4-flash" } }) } }
  const tools = new Map()
  // Every delivery goes through the Harness continuable seam. Counting THESE calls is
  // the delivery evidence: one accepted queue == one wake-up.
  const deliveries = []
  const deliveryPolicy = { failLiveSends: 0 }
  const subagents = {
    prompt: async (request) => {
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
  const ctx = {
    tools: { register: (d) => tools.set(d.name, d) },
    agents: { get: (id) => (id === CAPTAIN ? captain : id === MEMBER ? member : undefined), list: () => [captain, member] },
    subagents,
    effect: () => {}, on: () => {},
    logger: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} },
    get: () => undefined,
    llm: { resolveCallConfig: async (r) => ({ provider: r.provider, model: r.model }), listModels: async () => [] },
  }
  registerAgentTeamsTools(ctx, { stateDir: STATE_DIR })
  const runtime = installTeamScheduler(ctx, { stateDir: STATE_DIR })
  return { workspace, teamId, stateRoot, tools, captain, member, deliveries, deliveryPolicy, runtime, cleanup: () => rmSync(workspace, { recursive: true, force: true }) }
}

test("R1 WIRING: two identical agent_teams_send_message calls -> ONE durable record (at-most-once)", async () => {
  const { stateRoot, teamId, tools, captain, cleanup } = fixture()
  try {
    const send = tools.get("agent_teams_send_message")
    const args = { to: "Senior Engineer", content: "identical payload" }
    const first = await send.execute(args, { agent: captain })
    const second = await send.execute(args, { agent: captain })
    expect(first.message_id).toBeDefined()
    // the durable mailbox holds ONE record for the two sends, folded to dupCount=2
    const records = await readMailbox(stateRoot, teamId, "Senior Engineer")
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
  const { stateRoot, teamId, tools, captain, cleanup } = fixture()
  try {
    const send = tools.get("agent_teams_send_message")
    await send.execute({ to: "Senior Engineer", content: "payload A" }, { agent: captain })
    await send.execute({ to: "Senior Engineer", content: "payload B" }, { agent: captain })
    expect((await readMailbox(stateRoot, teamId, "Senior Engineer")).length).toBe(2)
  } finally { cleanup() }
})

test("R1 WIRING: the captain path dedups too (both append sites are wired)", async () => {
  const { stateRoot, teamId, tools, member, cleanup } = fixture()
  try {
    const send = tools.get("agent_teams_send_message")
    await send.execute({ to: "captain", content: "same report" }, { agent: member })
    await send.execute({ to: "captain", content: "same report" }, { agent: member })
    const records = await readMailbox(stateRoot, teamId, CAPTAIN_KEY)
    expect(records.length).toBe(1)
    expect(records[0].dupCount).toBe(2)
  } finally { cleanup() }
})

test("R1 WIRING: two identical sends with live delivery DOWN -> the scheduler delivers exactly ONCE", async () => {
  const { workspace, teamId, stateRoot, tools, captain, deliveries, deliveryPolicy, runtime, cleanup } = fixture()
  try {
    deliveryPolicy.failLiveSends = 1 // the first send cannot wake the member live
    const send = tools.get("agent_teams_send_message")
    const args = { to: "Senior Engineer", content: "identical payload" }
    const first = await send.execute(args, { agent: captain })
    const second = await send.execute(args, { agent: captain })
    expect(first.delivered).toBe("mailbox")
    expect(second.delivered).toBe("duplicate") // folded, and it must NOT retry the wake
    expect(deliveries.length).toBe(0)
    // the record stayed UNclaimed/UNread, so the scheduler's idle edge is still owed one wake
    let records = await readMailbox(stateRoot, teamId, "Senior Engineer")
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
  const { workspace, teamId, stateRoot, tools, captain, deliveries, runtime, cleanup } = fixture()
  try {
    const send = tools.get("agent_teams_send_message")
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
    await clearMailboxToWatermark(stateRoot, teamId, "Senior Engineer", 1, { now: 1_000 })
    const cleared = (await readMailbox(stateRoot, teamId, "Senior Engineer")).find((record) => record.id === "cleared-1")
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
  const { workspace, teamId, stateRoot, tools, captain, deliveries, runtime, cleanup } = fixture({ task: {} })
  try {
    const send = tools.get("agent_teams_send_message")
    const args = { to: "Senior Engineer", content: "identical payload" }
    // Count MAILBOX deliveries separately from task-assignment prompts: only the mailbox
    // lane is what two identical sends can duplicate.
    const mailboxPrompts = () => deliveries.map((request) => JSON.stringify(request)).filter((text) => text.includes("identical payload"))
    // SHIPPED PATH: the real agent_teams_send_message tool, called exactly as the captain calls it
    await send.execute(args, { agent: captain })
    await send.execute(args, { agent: captain })
    // CALL COUNT: two identical sends -> exactly ONE mailbox delivery
    expect(mailboxPrompts().length).toBe(1)
    // the assignment is still owed (the one record was already consumed live), and this
    // is the SAME scheduler function the agent/status idle listener calls
    await runtime.kickMember(workspace, teamId, "Senior Engineer")
    const team = JSON.parse(readFileSync(join(stateRoot, teamId, "team.json"), "utf8"))
    const task = team.tasks.find((candidate) => candidate.id === "t49-task")
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
  const { workspace, teamId, stateRoot, tools, captain, deliveries, runtime, cleanup } = fixture()
  try {
    const send = tools.get("agent_teams_send_message")
    const args = { to: "Senior Engineer", content: "identical payload" }
    await send.execute(args, { agent: captain })
    expect(deliveries.length).toBe(1)
    // the fold now runs against an ALREADY ACKNOWLEDGED row: it must not resurrect it
    const duplicate = await send.execute(args, { agent: captain })
    expect(duplicate.delivered).toBe("duplicate")
    expect(deliveries.length).toBe(1)
    const records = await readMailbox(stateRoot, teamId, "Senior Engineer")
    expect(records.length).toBe(1)
    expect(records[0].readAt).toBeDefined()
    expect(records[0].dupCount).toBe(2)
    await runtime.kickMember(workspace, teamId, "Senior Engineer")
    expect(deliveries.length).toBe(1)
  } finally { cleanup() }
})
