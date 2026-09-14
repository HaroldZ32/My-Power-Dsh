// t52 — the interjection lane as a CAPABILITY, not a library.
//
// Every assertion here goes through the SHIPPED tool surface (registerAgentTeamsTools),
// never through a state.js primitive: the round-2 review's root cause was that a
// primitive-level green says nothing about the path a user actually walks.
//
// Authorization is asserted in BOTH directions for every tool: one positive act by the
// authorized role and one REFUSAL with a readable reason for the unauthorized role.
import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { CAPTAIN_KEY, INTERJECTION_QUEUE, readInterjections, readMailbox } from "../lib/state.js"
import { installTeamScheduler } from "../lib/scheduler.js"
import { registerAgentTeamsTools } from "../lib/tools.js"

const STATE_DIR = join(".mpd", "team")
const CAPTAIN = "session-t52-captain"
const MEMBER = "session-t52-member"
const OTHER = "session-t52-other"

function fixture() {
  const workspace = mkdtempSync(join(tmpdir(), "mpd-t52-"))
  const teamId = "t52-team"
  const stateRoot = join(workspace, STATE_DIR)
  mkdirSync(join(stateRoot, teamId, "inbox"), { recursive: true })
  const now = Date.now()
  writeFileSync(join(stateRoot, teamId, "team.json"), JSON.stringify({
    id: teamId, name: "t52", captainSessionId: CAPTAIN, createdAt: now, updatedAt: now, taskSeq: 0, phase: "running",
    members: [
      { id: MEMBER, name: "Senior Engineer", role: "engineer", status: "idle", joinedAt: now },
      { id: OTHER, name: "Junior Engineer", role: "engineer", status: "idle", joinedAt: now },
    ],
    tasks: [],
  }, null, 2))
  const agent = (id) => ({ id, status: "idle", options: { provider: "deepseek-official", model: "deepseek-v4-flash" }, session: { header: { cwd: workspace }, requestHeader: () => ({ config: { provider: "deepseek-official", model: "deepseek-v4-flash" } }) } })
  const captain = agent(CAPTAIN)
  const member = agent(MEMBER)
  const other = agent(OTHER)
  const deliveries = []
  const tools = new Map()
  const ctx = {
    tools: { register: (d) => tools.set(d.name, d) },
    agents: { get: (id) => [captain, member, other].find((a) => a.id === id), list: () => [captain, member, other] },
    subagents: { prompt: async (request) => { deliveries.push(request); return { messageId: `d-${deliveries.length}` } }, followup: () => {}, sendMessage: () => {} },
    effect: () => {}, on: () => {},
    logger: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} },
    get: () => undefined,
    llm: { resolveCallConfig: async (r) => ({ provider: r.provider, model: r.model }), listModels: async () => [] },
  }
  registerAgentTeamsTools(ctx, { stateDir: STATE_DIR })
  const runtime = installTeamScheduler(ctx, { stateDir: STATE_DIR })
  return { workspace, teamId, stateRoot, tools, captain, member, other, deliveries, runtime, cleanup: () => rmSync(workspace, { recursive: true, force: true }) }
}

const call = (tools, name) => tools.get(name).execute.bind(tools.get(name))
/** Run a tool call and return either its value or the thrown message. */
async function attempt(tools, name, args, exec) {
  try {
    return { ok: true, value: await tools.get(name).execute(args, exec) }
  } catch (error) {
    return { ok: false, message: String(error?.message ?? error) }
  }
}

test("t52: the three lane tools are REGISTERED on the shipped surface", () => {
  const { tools, cleanup } = fixture()
  try {
    for (const name of ["agent_teams_interject_request", "agent_teams_interject_decide", "agent_teams_mailbox_clear"]) {
      expect(tools.has(name)).toBe(true)
    }
    // the untouched send path must NOT have grown the lane (the deliberate design choice):
    // no interjection concepts may appear on its schema
    const send = tools.get("agent_teams_send_message")
    const sendProps = Object.keys(send.parameters.properties ?? send.parameters).sort()
    expect(sendProps).toEqual(["content", "from", "to"])
  } finally { cleanup() }
})

test("t52 CHAIN: member requests -> captain sees pending -> approves -> ordinary record for the requester", async () => {
  const { stateRoot, teamId, tools, captain, member, cleanup } = fixture()
  try {
    // 1) the MEMBER asks, under its own identity
    const asked = await call(tools, "agent_teams_interject_request")(
      { summary: "the producer is wrong", reason: "downstream will diverge", location: "state.js:662" },
      { agent: member },
    )
    expect(asked.status).toBe("pending")
    expect(asked.from).toBe("Senior Engineer")
    expect(asked.delivered_to_anyone).toBe(false)
    // 2) it sits in its OWN lane and is invisible to the ordinary delivery path
    const rows = await readInterjections(stateRoot, teamId)
    expect(rows.length).toBe(1)
    expect(rows[0].kind).toBe("interjection-request")
    expect(await readMailbox(stateRoot, teamId, INTERJECTION_QUEUE)).toEqual(rows)
    // 3) the CAPTAIN observes it through the tool
    const listed = await call(tools, "agent_teams_interject_decide")({ action: "list" }, { agent: captain })
    expect(listed.pending.length).toBe(1)
    expect(listed.pending[0].id).toBe(asked.request_id)
    expect(listed.pending[0].from).toBe("Senior Engineer")
    expect(listed.pending[0].location).toBe("state.js:662")
    // 4) the CAPTAIN approves
    const decided = await call(tools, "agent_teams_interject_decide")(
      { request_id: asked.request_id, decision: "approved" }, { agent: captain },
    )
    expect(decided.status).toBe("approved")
    expect(decided.requester).toBe("Senior Engineer")
    // 5) the approval is recorded as decided, and the requester got an ORDINARY record
    const after = await readInterjections(stateRoot, teamId)
    expect(after[0].status).toBe("approved")
    const inbox = await readMailbox(stateRoot, teamId, "Senior Engineer")
    expect(inbox.length).toBe(1)
    expect(inbox[0].id).toBe(`${asked.request_id}-delivery`)
    expect(inbox[0].kind).toBeUndefined()
    expect(inbox[0].content).toContain("Approved interjection")
    expect((await call(tools, "agent_teams_interject_decide")({ action: "list" }, { agent: captain })).pending.length).toBe(0)
  } finally { cleanup() }
})

test("t52 CHAIN: the requester's own lane then records the approval once it is collected", async () => {
  const { stateRoot, teamId, tools, captain, member, deliveries, runtime, workspace, cleanup } = fixture()
  try {
    const asked = await call(tools, "agent_teams_interject_request")(
      { summary: "s", reason: "r", location: "l" }, { agent: member },
    )
    await call(tools, "agent_teams_interject_decide")({ request_id: asked.request_id, decision: "approved" }, { agent: captain })
    // the ordinary record rides the EXISTING member-queue seam: the scheduler's idle edge
    // delivers it and acknowledges it, which is what the requester actually observes.
    await runtime.kickMember(workspace, teamId, "Senior Engineer")
    expect(deliveries.length).toBeGreaterThan(0)
    const record = (await readMailbox(stateRoot, teamId, "Senior Engineer"))[0]
    expect(record.readAt).toBeDefined()
  } finally { cleanup() }
})

test("t52 AUTHZ: a MEMBER cannot decide — refused loudly, with a reason", async () => {
  const { tools, member, cleanup } = fixture()
  try {
    const result = await attempt(tools, "agent_teams_interject_decide", { request_id: "x", decision: "approved" }, { agent: member })
    expect(result.ok).toBe(false)
    expect(result.message).toContain("only the captain")
  } finally { cleanup() }
})

test("t52 AUTHZ: the decision vocabulary is closed AT THE TOOL BOUNDARY", async () => {
  const { tools, captain, member, cleanup } = fixture()
  try {
    const asked = await call(tools, "agent_teams_interject_request")({ summary: "s", reason: "r", location: "l" }, { agent: member })
    const bad = await attempt(tools, "agent_teams_interject_decide", { request_id: asked.request_id, decision: "maybe" }, { agent: captain })
    expect(bad.ok).toBe(false)
    expect(bad.message).toContain("approved, rejected")
    // the row is untouched: a refused decision must not resolve the request
    const listed = await call(tools, "agent_teams_interject_decide")({ action: "list" }, { agent: captain })
    expect(listed.pending.length).toBe(1)
  } finally { cleanup() }
})

test("t52 AUTHZ: a member may clear ONLY its own mailbox", async () => {
  const { tools, member, cleanup } = fixture()
  try {
    // its own: allowed (default target is the caller)
    const own = await attempt(tools, "agent_teams_mailbox_clear", { watermark: 1 }, { agent: member })
    expect(own.ok).toBe(true)
    expect(own.value.agent).toBe("Senior Engineer")
    // another member: refused
    const foreign = await attempt(tools, "agent_teams_mailbox_clear", { watermark: 1, agent: "Junior Engineer" }, { agent: member })
    expect(foreign.ok).toBe(false)
    expect(foreign.message).toContain("only the captain")
    // the captain mailbox: refused
    const captainBox = await attempt(tools, "agent_teams_mailbox_clear", { watermark: 1, agent: CAPTAIN_KEY }, { agent: member })
    expect(captainBox.ok).toBe(false)
    expect(captainBox.message).toContain("only the captain")
  } finally { cleanup() }
})

test("t52 AUTHZ+F3: the captain may clear ANY mailbox, and a cleared record is not unread after", async () => {
  const { stateRoot, teamId, tools, captain, member, cleanup } = fixture()
  try {
    // seed an ordinary unread record in the member's mailbox through the send path
    await tools.get("agent_teams_send_message").execute({ to: "Senior Engineer", content: "payload" }, { agent: captain })
    expect((await readMailbox(stateRoot, teamId, "Senior Engineer")).length).toBe(1)
    const cleared = await call(tools, "agent_teams_mailbox_clear")(
      { watermark: Date.now() + 1_000, agent: "Senior Engineer" }, { agent: captain },
    )
    expect(cleared.cleared.length).toBe(1)
    expect(cleared.unread_after).toBe(0) // the F-3 seam, asserted on the REAL path
    expect(cleared.archived_to).toContain("archive")
    // tombstone, not a hard delete
    const rows = await readMailbox(stateRoot, teamId, "Senior Engineer")
    expect(rows[0].tombstone).toBe(true)
    expect(rows[0].content).toBe("")
  } finally { cleanup() }
})

test("t52 AUTHZ: the captain cannot clear a mailbox that does not exist", async () => {
  const { tools, captain, cleanup } = fixture()
  try {
    const bad = await attempt(tools, "agent_teams_mailbox_clear", { watermark: 1, agent: "Nobody At All" }, { agent: captain })
    expect(bad.ok).toBe(false)
    expect(bad.message).toContain("no active member named")
  } finally { cleanup() }
})

test("t52 BOUNDARY: the request carries identity from the CALLER, never from an argument", async () => {
  const { stateRoot, teamId, tools, member, other, cleanup } = fixture()
  try {
    // the tool has no `from` parameter at all
    const params = tools.get("agent_teams_interject_request").parameters
    expect(params.from).toBeUndefined()
    await call(tools, "agent_teams_interject_request")({ summary: "s", reason: "r", location: "l" }, { agent: other })
    const rows = await readInterjections(stateRoot, teamId)
    expect(rows[0].from).toBe("Junior Engineer")
    // a member cannot name someone else, so two members produce two distinct identities
    await call(tools, "agent_teams_interject_request")({ summary: "s2", reason: "r2", location: "l2" }, { agent: member })
    const all = await readInterjections(stateRoot, teamId)
    expect(all.map((row) => row.from)).toEqual(["Junior Engineer", "Senior Engineer"])
  } finally { cleanup() }
})
