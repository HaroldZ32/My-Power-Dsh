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
// The vendored module now resolves to its .ts source, so this surface is typed from that file.
import { CAPTAIN_KEY, INTERJECTION_QUEUE, readInterjections, readMailbox, readUnreadMailbox } from "../lib/state.ts"
// The vendored module now resolves to its .ts source, so this surface is typed from that file.
import { installTeamScheduler } from "../lib/scheduler.ts"
// The vendored module now resolves to its .ts source, so this surface is typed from that file.
import { registerAgentTeamsTools } from "../lib/tools.ts"

/** State root every fixture team lives under, relative to the session workspace cwd. */
const STATE_DIR = join(".mpd", "team")
/** Session id the fixture registers as the team's captain (the only decision authority). */
const CAPTAIN = "session-t52-captain"
/** Session id the fixture registers as the senior engineer that raises the request. */
const MEMBER = "session-t52-member"
/** A second member session, used to prove the decision lane never broadcasts. */
const OTHER = "session-t52-other"

/** One interjection request row, naming only the fields these arms assert on. */
type InterjectionRow = {
  /** Request id the approval must address. */
  readonly id: string
  /** Row kind; an ordinary delivery must leave this unset. */
  readonly kind?: string
  /** Lifecycle status: `pending`, `approved`, `rejected` or `expired`. */
  readonly status?: string
  /** Display name of the session that raised the request. */
  readonly from?: string
  /** Free-form location the requester pointed at. */
  readonly location?: string
}

/** The answer to a SUCCESSFUL interjection request, naming only the fields these arms assert on. */
type InterjectionAnswer = {
  /** Request id the decision and the derived delivery record are keyed by; every accepted request has one. */
  readonly request_id: string
  /** Lifecycle status; a fresh request answers `pending`. */
  readonly status?: string
  /** Display name of the session that raised the request. */
  readonly from?: string
  /** False while the request still sits unanswered in its own lane. */
  readonly delivered_to_anyone?: boolean
}

/** One mailbox row, naming only the fields these arms assert on. */
type MailboxRecord = {
  /** Row id, derived from the request id for an interjection delivery. */
  readonly id?: string
  /** Row kind; an ordinary record must leave this unset. */
  readonly kind?: string
  /** Message body; emptied when the row is cleared into a tombstone. */
  readonly content?: string
  /** Epoch ms the member read the row; absent while it is still owed a delivery. */
  readonly readAt?: number
  /** Set on a CLEARED row, which must never wake anyone again. */
  readonly tombstone?: boolean
}

/** One wake-up the continuable seam accepted, named by the addresses it carries. */
type DeliveryRequest = {
  /** Session the delivery is addressed to (the requester for an approval). */
  readonly childSessionId?: string
  /** Session the delivery was made on behalf of. */
  readonly parentSessionId?: string
  /** Delivery mode the scheduler chose. */
  readonly mode?: string
  /** How the delivery landed (`queue` when it went through the mailbox). */
  readonly delivery?: string
}

/** One tool the vendored surface registered, naming only the members these arms use. */
type RegisteredTool = {
  /** Tool name, the key the model calls it by. */
  readonly name: string
  /** Object-rooted JSON Schema for the arguments, inspected for the send-path pin. */
  readonly parameters: {
    /** Always `object` for a tool argument schema. */
    readonly type: string
    /** One schema per named argument. */
    readonly properties: Record<string, {
      /** Declared JSON type of the argument. */
      readonly type?: string
      /** Closed value set, when the argument has one. */
      readonly enum?: readonly string[]
      /** Nested schema, when the argument is itself an object. */
      readonly properties?: Record<string, unknown>
    }>
    /** Arguments the validator refuses to default. */
    readonly required?: readonly string[]
    /** Any further schema keyword, read positionally by one boundary arm. */
    readonly [key: string]: unknown
  }
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
function fixture(): {
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
  /** The requester session, registered as registry-live. */
  member: FixtureAgent
  /** The second engineer session, registered as registry-live. */
  other: FixtureAgent
  /** Wake-ups the continuable seam accepted, in acceptance order. */
  deliveries: DeliveryRequest[]
  /** The installed scheduler, whose `kickMember` the arms drive as the idle edge would. */
  runtime: { kickMember: (workspace: string, teamId: string, memberName: string) => Promise<unknown> }
  /** Removes the temporary workspace tree. */
  cleanup: () => void
} {
  /** Temporary workspace every stub session reports as its cwd. */
  const workspace = mkdtempSync(join(tmpdir(), "mpd-t52-"))
  /** Team id the fixture writes its single team record under. */
  const teamId = "t52-team"
  /** The state root under that workspace, where the record and mailboxes live. */
  const stateRoot = join(workspace, STATE_DIR)
  mkdirSync(join(stateRoot, teamId, "inbox"), { recursive: true })
  /** The fixture clock, shared by the team record and its members. */
  const now = Date.now()
  writeFileSync(join(stateRoot, teamId, "team.json"), JSON.stringify({
    id: teamId, name: "t52", captainSessionId: CAPTAIN, createdAt: now, updatedAt: now, taskSeq: 0, phase: "running",
    members: [
      { id: MEMBER, name: "Senior Engineer", role: "engineer", status: "idle", joinedAt: now },
      { id: OTHER, name: "Junior Engineer", role: "engineer", status: "idle", joinedAt: now },
    ],
    tasks: [],
  }, null, 2))
  /** One registry-live session under the pinned route, built per session id. */
  const agent = (id: string): FixtureAgent => ({ id, status: "idle", options: { provider: "deepseek-official", model: "deepseek-v4-flash" }, session: { header: { cwd: workspace }, requestHeader: () => ({ config: { provider: "deepseek-official", model: "deepseek-v4-flash" } }) } })
  /** The captain session: the only identity the decision tool accepts. */
  const captain = agent(CAPTAIN)
  /** The requester session, whose own lane receives the approval record. */
  const member = agent(MEMBER)
  /** The uninvolved second member, which the decision lane must never address. */
  const other = agent(OTHER)
  /** Wake-ups the seam accepted, in acceptance order. */
  const deliveries: DeliveryRequest[] = []
  /** Tools the vendored surface registered, keyed by the name the model calls. */
  const tools = new Map<string, RegisteredTool>()
  /** The stub composition root the shipped surface and the scheduler are installed on. */
  const ctx = {
    tools: { register: (d: RegisteredTool) => tools.set(d.name, d) },
    agents: { get: (id: string) => [captain, member, other].find((a) => a.id === id), list: () => [captain, member, other] },
    subagents: { prompt: async (request: DeliveryRequest) => { deliveries.push(request); return { messageId: `d-${deliveries.length}` } }, followup: () => {}, sendMessage: () => {} },
    effect: () => {}, on: () => {},
    logger: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} },
    get: () => undefined,
    llm: { resolveCallConfig: async (r: { provider: string; model: string }) => ({ provider: r.provider, model: r.model }), listModels: async () => [] },
  }
  registerAgentTeamsTools(ctx, { stateDir: STATE_DIR })
  /** The installed scheduler, whose kick path the arms drive directly. */
  const runtime = installTeamScheduler(ctx, { stateDir: STATE_DIR })
  return { workspace, teamId, stateRoot, tools, captain, member, other, deliveries, runtime, cleanup: () => rmSync(workspace, { recursive: true, force: true }) }
}

/** One registered tool's `execute` bound to its own definition, so an arm can call it by name. */
const call = (tools: Map<string, RegisteredTool>, name: string): RegisteredTool["execute"] => tools.get(name)!.execute.bind(tools.get(name)!)
/** Run a tool call and return either its value or the thrown message. */
async function attempt(tools: Map<string, RegisteredTool>, name: string, args: Record<string, unknown>, exec: { agent: unknown }): Promise<{ ok: boolean; value?: Record<string, unknown>; message?: string }> {
  try {
    return { ok: true, value: await tools.get(name)!.execute(args, exec) }
  } catch (error) {
    // A thrown value is `unknown` under strict mode, and only its `message` is read here; the
    // tools refuse by throwing an Error, which is exactly the text the AUTHZ arms assert on.
    return { ok: false, message: String((error as { message?: unknown })?.message ?? error) }
  }
}

test("t52: the three lane tools are REGISTERED on the shipped surface", () => {
  // The fixture's registered surface and temp-dir remover.
  const { tools, cleanup } = fixture()
  try {
    for (const name of ["agent_teams_interject_request", "agent_teams_interject_decide", "agent_teams_mailbox_clear"]) {
      expect(tools.has(name)).toBe(true)
    }
    // the untouched send path must NOT have grown the lane (the deliberate design choice):
    // no interjection concepts may appear on its schema
    /** The shipped send tool, which the surface always registers under this name. */
    const send = tools.get("agent_teams_send_message")!
    /** The send path's declared argument names, sorted for a stable comparison. */
    const sendProps = Object.keys(send.parameters.properties ?? send.parameters).sort()
    // t48 (P1d): the pre-send gate adds the explicit, non-defaultable escape parameter.
    expect(sendProps).toEqual(["confirm_duplicate", "content", "from", "to"])
  } finally { cleanup() }
})

test("t52 CHAIN: member requests -> captain sees pending -> approves -> ordinary record for the requester", async () => {
  // The fixture's state root, team id, surface, captain and requester sessions.
  const { stateRoot, teamId, tools, captain, member, cleanup } = fixture()
  try {
    // 1) the MEMBER asks, under its own identity
    /** The member's request as the tool answered it; the untyped surface cannot be narrowed, so its shape is written down here. */
    const asked = await call(tools, "agent_teams_interject_request")(
      { summary: "the producer is wrong", reason: "downstream will diverge", location: "state.js:662" },
      { agent: member },
    ) as InterjectionAnswer
    expect(asked.status).toBe("pending")
    expect(asked.from).toBe("Senior Engineer")
    expect(asked.delivered_to_anyone).toBe(false)
    // 2) it sits in its OWN lane and is invisible to the ordinary delivery path
    /** The request lane rows: exactly the one request, still in its own queue. */
    const rows: InterjectionRow[] = await readInterjections(stateRoot, teamId)
    expect(rows.length).toBe(1)
    expect(rows[0].kind).toBe("interjection-request")
    expect(await readMailbox(stateRoot, teamId, INTERJECTION_QUEUE)).toEqual(rows)
    // 3) the CAPTAIN observes it through the tool
    // The pending list is a nested field of an untyped tool answer, so the shape it must have is
    // written down here rather than recovered by narrowing.
    /** The captain's pending queue as the decide tool lists it. */
    const listed = await call(tools, "agent_teams_interject_decide")({ action: "list" }, { agent: captain }) as { pending: Array<{ id?: string; from?: string; location?: string }> }
    expect(listed.pending.length).toBe(1)
    expect(listed.pending[0].id).toBe(asked.request_id)
    expect(listed.pending[0].from).toBe("Senior Engineer")
    expect(listed.pending[0].location).toBe("state.js:662")
    // 4) the CAPTAIN approves
    /** The approval's answer, naming the requester to prove the address. */
    const decided = await call(tools, "agent_teams_interject_decide")(
      { request_id: asked.request_id, decision: "approved" }, { agent: captain },
    )
    expect(decided.status).toBe("approved")
    expect(decided.requester).toBe("Senior Engineer")
    // 5) the approval is recorded as decided, and the requester got an ORDINARY record
    /** The request lane after the decision, whose row must now read approved. */
    const after: InterjectionRow[] = await readInterjections(stateRoot, teamId)
    expect(after[0].status).toBe("approved")
    /** The requester's mailbox: one ORDINARY delivery derived from the request id. */
    const inbox: MailboxRecord[] = await readMailbox(stateRoot, teamId, "Senior Engineer")
    expect(inbox.length).toBe(1)
    expect(inbox[0].id).toBe(`${asked.request_id}-delivery`)
    expect(inbox[0].kind).toBeUndefined()
    expect(inbox[0].content).toContain("Approved interjection")
    // The list is a nested field of an untyped tool answer, so its shape is written down here; a
    // second listing must have drained back to zero.
    expect(((await call(tools, "agent_teams_interject_decide")({ action: "list" }, { agent: captain })) as { pending: unknown[] }).pending.length).toBe(0)
  } finally { cleanup() }
})

test("t52 CHAIN: the approval reaches the REQUESTER's own session at the next idle edge — addressed, once, and nowhere else", async () => {
  // The full fixture: both member sessions, the wake-up log, the scheduler and the workspace.
  const { stateRoot, teamId, tools, captain, member, other, deliveries, runtime, workspace, cleanup } = fixture()
  try {
    // The fixture's two sessions must be distinct, or "we delivered to the requester" and
    // "we delivered to some member" would be indistinguishable assertions.
    expect(member.id).not.toBe(captain.id)
    expect(member.id).not.toBe(other.id)
    expect(member.id).not.toBe("")

    /** The member's request as the tool answered it; the untyped surface cannot be narrowed, so its shape is written down here. */
    const asked = await call(tools, "agent_teams_interject_request")(
      { summary: "producer wrong", reason: "downstream diverges", location: "state.js:662" }, { agent: member },
    ) as InterjectionAnswer
    await call(tools, "agent_teams_interject_decide")({ request_id: asked.request_id, decision: "approved" }, { agent: captain })

    // NOTHING may be delivered before the idle edge: the approval records a decision, it is
    // not itself a delivery.
    expect(deliveries.length).toBe(0)
    await runtime.kickMember(workspace, teamId, "Senior Engineer")
    expect(deliveries.length).toBe(1)

    // ADDRESS: the queue seam must carry BOTH addresses, and the child must be the requester.
    /** The one accepted wake-up, whose addresses the assertions below pin. */
    const receipt = deliveries[0]
    expect(receipt.childSessionId).toBe(member.id)
    expect(receipt.childSessionId).not.toBe(captain.id)
    expect(receipt.parentSessionId).toBe(captain.id)
    expect(receipt.mode).toBe("continuable")
    expect(receipt.delivery).toBe("queue")
    // PAYLOAD: the approved body, in an ordinary delivery
    /** The delivered request serialized, so the payload can be searched as text. */
    const payload = JSON.stringify(receipt)
    expect(payload).toContain("Approved interjection")
    expect(payload).toContain(asked.request_id)
    // SILENCE: the OTHER member was never addressed — the decision lane does not broadcast
    expect(deliveries.every((entry) => entry.childSessionId !== other.id)).toBe(true)

    // the acknowledgement follows the accepted delivery, so a second edge re-delivers nothing
    expect((await readMailbox(stateRoot, teamId, "Senior Engineer"))[0].readAt).toBeDefined()
    await runtime.kickMember(workspace, teamId, "Senior Engineer")
    expect(deliveries.length).toBe(1)
    expect((await readUnreadMailbox(stateRoot, teamId, "Senior Engineer")).length).toBe(0)
  } finally { cleanup() }
})

test("t52 CHAIN: the requester's own lane then records the approval once it is collected", async () => {
  // The fixture's state root, team id, surface, requester, wake-up log and scheduler.
  const { stateRoot, teamId, tools, captain, member, deliveries, runtime, workspace, cleanup } = fixture()
  try {
    /** The member's request as the tool answered it; the untyped surface cannot be narrowed, so its shape is written down here. */
    const asked = await call(tools, "agent_teams_interject_request")(
      { summary: "s", reason: "r", location: "l" }, { agent: member },
    ) as InterjectionAnswer
    await call(tools, "agent_teams_interject_decide")({ request_id: asked.request_id, decision: "approved" }, { agent: captain })
    // the ordinary record rides the EXISTING member-queue seam: the scheduler's idle edge
    // delivers it and acknowledges it, which is what the requester actually observes.
    await runtime.kickMember(workspace, teamId, "Senior Engineer")
    expect(deliveries.length).toBeGreaterThan(0)
    /** The requester's mailbox row, which the accepted delivery must have acknowledged. */
    const record = (await readMailbox(stateRoot, teamId, "Senior Engineer"))[0]
    expect(record.readAt).toBeDefined()
  } finally { cleanup() }
})

test("t52 AUTHZ: a MEMBER cannot decide — refused loudly, with a reason", async () => {
  // The fixture's registered surface, the member session and the temp-dir remover.
  const { tools, member, cleanup } = fixture()
  try {
    /** The member's refusal: the decision path is captain-only. */
    const result = await attempt(tools, "agent_teams_interject_decide", { request_id: "x", decision: "approved" }, { agent: member })
    expect(result.ok).toBe(false)
    expect(result.message).toContain("only the captain")
  } finally { cleanup() }
})

test("t52 AUTHZ: the decision vocabulary is closed AT THE TOOL BOUNDARY", async () => {
  // The fixture's registered surface, both sessions and the temp-dir remover.
  const { tools, captain, member, cleanup } = fixture()
  try {
    /** The member's request, whose id the refused decision addresses; the untyped surface cannot be narrowed, so its shape is written down here. */
    const asked = await call(tools, "agent_teams_interject_request")({ summary: "s", reason: "r", location: "l" }, { agent: member }) as InterjectionAnswer
    /** The out-of-vocabulary decision, which the boundary must refuse. */
    const bad = await attempt(tools, "agent_teams_interject_decide", { request_id: asked.request_id, decision: "maybe" }, { agent: captain })
    expect(bad.ok).toBe(false)
    expect(bad.message).toContain("approved, rejected")
    // the row is untouched: a refused decision must not resolve the request
    // The pending list is a nested field of an untyped tool answer, so its shape is written here.
    /** The still-pending queue after the refusal. */
    const listed = await call(tools, "agent_teams_interject_decide")({ action: "list" }, { agent: captain }) as { pending: unknown[] }
    expect(listed.pending.length).toBe(1)
  } finally { cleanup() }
})

test("t52 AUTHZ: a member may clear ONLY its own mailbox", async () => {
  // The fixture's registered surface, the member session and the temp-dir remover.
  const { tools, member, cleanup } = fixture()
  try {
    // its own: allowed (default target is the caller)
    // The clear answer's own shape is written here, because the cleared-elsewhere shape carries
    // fields this arm reads; the value comes from an untyped tool surface either way.
    /** The member's own clear: accepted, and it reports the caller's name. */
    const own = await attempt(tools, "agent_teams_mailbox_clear", { watermark: 1 }, { agent: member }) as { ok: boolean; value: { agent?: string } }
    expect(own.ok).toBe(true)
    expect(own.value.agent).toBe("Senior Engineer")
    // another member: refused
    /** A clear aimed at a peer member, which must be refused. */
    const foreign = await attempt(tools, "agent_teams_mailbox_clear", { watermark: 1, agent: "Junior Engineer" }, { agent: member })
    expect(foreign.ok).toBe(false)
    expect(foreign.message).toContain("only the captain")
    // the captain mailbox: refused
    /** A clear aimed at the captain's mailbox, which must be refused too. */
    const captainBox = await attempt(tools, "agent_teams_mailbox_clear", { watermark: 1, agent: CAPTAIN_KEY }, { agent: member })
    expect(captainBox.ok).toBe(false)
    expect(captainBox.message).toContain("only the captain")
  } finally { cleanup() }
})

test("t52 AUTHZ+F3: the captain may clear ANY mailbox, and a cleared record is not unread after", async () => {
  // The fixture's state root, team id, surface, captain and member sessions.
  const { stateRoot, teamId, tools, captain, member, cleanup } = fixture()
  try {
    // seed an ordinary unread record in the member's mailbox through the send path
    await tools.get("agent_teams_send_message")!.execute({ to: "Senior Engineer", content: "payload" }, { agent: captain })
    expect((await readMailbox(stateRoot, teamId, "Senior Engineer")).length).toBe(1)
    // The clear answer is a nested shape off an untyped tool surface, so it is written down here
    // instead of being narrowed; the arm asserts the F-3 seam and the archive destination.
    /** The captain's clear of the member's mailbox, with its F-3 counts. */
    const cleared = await call(tools, "agent_teams_mailbox_clear")(
      { watermark: Date.now() + 1_000, agent: "Senior Engineer" }, { agent: captain },
    ) as { cleared: unknown[]; unread_after: number; archived_to: string }
    expect(cleared.cleared.length).toBe(1)
    expect(cleared.unread_after).toBe(0) // the F-3 seam, asserted on the REAL path
    expect(cleared.archived_to).toContain("archive")
    // tombstone, not a hard delete
    /** The member's mailbox rows after the clear: one tombstone, emptied of content. */
    const rows: MailboxRecord[] = await readMailbox(stateRoot, teamId, "Senior Engineer")
    expect(rows[0].tombstone).toBe(true)
    expect(rows[0].content).toBe("")
  } finally { cleanup() }
})

test("t52 AUTHZ: the captain cannot clear a mailbox that does not exist", async () => {
  // The fixture's registered surface, the captain session and the temp-dir remover.
  const { tools, captain, cleanup } = fixture()
  try {
    /** The refusal for an unknown member name, which must name the lookup failure. */
    const bad = await attempt(tools, "agent_teams_mailbox_clear", { watermark: 1, agent: "Nobody At All" }, { agent: captain })
    expect(bad.ok).toBe(false)
    expect(bad.message).toContain("no active member named")
  } finally { cleanup() }
})

test("t52 BOUNDARY: the request carries identity from the CALLER, never from an argument", async () => {
  // The fixture's state root, team id, surface and both member sessions.
  const { stateRoot, teamId, tools, member, other, cleanup } = fixture()
  try {
    // the tool has no `from` parameter at all
    /** The request tool's argument schema, which must not offer a caller-chosen identity. */
    const params = tools.get("agent_teams_interject_request")!.parameters
    expect(params.from).toBeUndefined()
    await call(tools, "agent_teams_interject_request")({ summary: "s", reason: "r", location: "l" }, { agent: other })
    /** The lane rows: the request must be attributed to the CALLER, not to an argument. */
    const rows: InterjectionRow[] = await readInterjections(stateRoot, teamId)
    expect(rows[0].from).toBe("Junior Engineer")
    // a member cannot name someone else, so two members produce two distinct identities
    await call(tools, "agent_teams_interject_request")({ summary: "s2", reason: "r2", location: "l2" }, { agent: member })
    /** Both requests, in write order, each carrying its own caller's name. */
    const all: InterjectionRow[] = await readInterjections(stateRoot, teamId)
    expect(all.map((row) => row.from)).toEqual(["Junior Engineer", "Senior Engineer"])
  } finally { cleanup() }
})
