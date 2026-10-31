// THE PERMIT-BOUNDED WAIT (frozen contract `.mpd/plans/mail-unify.md` §7; AC-4 in §8).
//
// WHY THESE ARMS. A blocking wait is the only mail operation that can park an agent behind another
// agent's turn, so every rule that bounds it is proved here rather than assumed: a permit is required,
// it expires, it belongs to ONE member, it must have been issued by the caller's own captain, and the
// polling loop is finite in a way the arithmetic guarantees — the last arm freezes the clock and shows
// the loop still terminates, which is what "no unbounded busy loop" means mechanically.
//
// THE FIRST HALF drives the pure store (`mail-permit.ts`) with injected clocks, so a three-second wait
// costs no wall time. THE SECOND HALF drives the REAL `agent_teams_mail` tool in a sandboxed workspace
// with an approved team record, because AC-4's sentences ("refused, naming the captain") are properties
// of the TOOL, not of the helper it calls.
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { apply } from "../src/index"
import type { TeamRecord } from "../src/team-store"
import type { MailKind } from "../../mpd-mail-protocol/src/index"
import type { MailMessage } from "../src/mailbox-store"
import {
  PERMIT_DEFAULT_TTL_MS,
  PERMIT_MAX_TTL_MS,
  WAIT_DEFAULT_TIMEOUT_MS,
  WAIT_MAX_TIMEOUT_MS,
  appendPermit,
  buildPermit,
  checkPermit,
  checkWaitTarget,
  foldPermits,
  issuePermit,
  permitsPath,
  readPermits,
  repliesTo,
  waitForReply,
  type PermitRecord,
} from "../src/mail-permit"

/** The frozen instant every store-level fixture is stamped with. */
const NOW = new Date("2026-10-31T10:00:00.000Z")

/** The workspace one store-level arm writes into; recreated by the hooks below. */
let box = ""

/** Every sandbox the TOOL-level arms created, removed even when an arm fails. */
const sandboxes: string[] = []

beforeEach(() => { box = mkdtempSync(join(tmpdir(), "mpd-permit-")) })
afterEach(() => {
  rmSync(box, { recursive: true, force: true })
  for (const dir of sandboxes.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** A permit shaped by the store's own builder, so an arm never hand-copies the record layout. */
function permit(overrides: Partial<PermitRecord> = {}): PermitRecord {
  return { ...buildPermit({ issuerId: "sess-lead", issuerName: "captain", holderId: "M1", holderName: "Senior Engineer", scope: "answer", ttlMs: 60_000, permitId: "permit-issued" }, NOW), ...overrides }
}

/** The caller identity a permit is checked against; one arm overrides the fields it exercises. */
function caller(overrides: Partial<Parameters<typeof checkPermit>[1]> = {}): Parameters<typeof checkPermit>[1] {
  return { holderId: "M1", holderName: "Senior Engineer", sessionId: "child-Senior-Engineer", leadIds: ["sess-lead"], ...overrides }
}

/** A folded mailbox row used as a wait target; only the fields the correlation rules read are needed. */
function targetRow(kind: MailKind, questionId?: string): MailMessage {
  return {
    id: "mail-question",
    kind,
    threadId: "mail-question",
    fromId: "child-Senior-Engineer",
    fromName: "Senior Engineer",
    toId: "sess-lead",
    toName: "captain",
    subject: "which?",
    body: "which?",
    sentAt: NOW.toISOString(),
    ...(questionId === undefined ? {} : { question: { questionId, question: "which?", options: [{ label: "A. red" }, { label: "B. blue" }] } }),
  }
}

/** A controllable clock: `sleep` advances the same instant `now` reports, so a wait costs no wall time. */
function clock(start: Date): { now: () => Date; sleep: (ms: number) => Promise<void> } {
  /** The current instant, in epoch milliseconds. */
  let instant = start.getTime()
  return {
    now: (): Date => new Date(instant),
    sleep: async (ms: number): Promise<void> => { instant += Math.max(0, ms) },
  }
}

describe("the permit log is append-only and torn-line tolerant", () => {
  test("two issued permits fold back, and a torn last line plus a foreign line are TOLERATED and REPORTED", () => {
    /** The first grant. */
    const first = issuePermit(box, { issuerId: "sess-lead", issuerName: "captain", holderId: "M1", holderName: "Senior Engineer", scope: "answer", ttlMs: 60_000 }, NOW)
    /** The second grant, a plain message scope with a longer TTL. */
    const second = issuePermit(box, { issuerId: "sess-lead", issuerName: "captain", holderId: "M2", holderName: "Reviewer", scope: "message", ttlMs: 120_000 }, NOW)
    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    // The two fixtures must exist before the damaged lines are appended, or the arm would test an empty
    // log; a thrown failure is clearer than a misleading pass on an untyped fallback.
    if (!first.ok || !second.ok) throw new Error("the fixture grants were refused")
    // A half-written line is what a crash leaves — the SAME tolerance the mailbox store keeps, so it is
    // skipped without costing the file. A FOREIGN record is what another writer leaves, and that one is
    // SKIPPED AND REPORTED: tolerance that reads as silence is not tolerance.
    writeFileSync(permitsPath(box), "{not json\n{\"t\":\"something-else\"}\n", { flag: "a" })
    /** The folded log after the two damaged lines. */
    const folded = readPermits(box)
    expect(folded.permits.length).toBe(2)
    expect(folded.problems.length).toBe(1)
    expect(folded.problems[0]).toContain("does not carry the permit shape")
    // The round-trip is lossless: the record a reader sees is the record the issuer wrote.
    expect(folded.permits[0]).toEqual(first.permit)
    expect(folded.permits[1].scope).toBe("message")
    expect(folded.permits[1].holderId).toBe("M2")
  })

  test("a duplicated permit id keeps the FIRST write and reports the duplicate, never shadowing it", () => {
    /** The grant the log admits first. */
    const original = permit({ permitId: "permit-fixed", scope: "answer" })
    appendPermit(box, original)
    // The second line claims the same id with a DIFFERENT scope: admitting it would silently widen the
    // authorization in place, which is exactly what append-only ordering must prevent.
    appendPermit(box, { ...original, scope: "message" })
    /** The folded log: one grant, one reported duplicate. */
    const folded = foldPermits([original, { ...original, scope: "message" }])
    expect(folded.permits).toEqual([original])
    expect(folded.problems).toEqual([`skipped a duplicate permit id "permit-fixed" (the FIRST write wins)`])
  })

  test("a MISSING log is an empty fold, not an error", () => {
    expect(readPermits(join(box, "nothing-here"))).toEqual({ permits: [], problems: [] })
  })
})

describe("issuing a permit validates before the first byte is written", () => {
  test("an unknown scope is refused and NOTHING is appended", () => {
    /** The refusal for a scope the wait rules could never interpret. */
    const refused = issuePermit(box, { issuerId: "sess-lead", issuerName: "captain", holderId: "M1", holderName: "Senior Engineer", scope: "anything", ttlMs: 60_000 }, NOW)
    expect(refused.ok).toBe(false)
    expect(refused.ok === false ? refused.detail : "").toContain("scope must be")
    expect(readPermits(box).permits).toEqual([])
  })

  test("a non-positive or non-numeric TTL is refused, and an omitted TTL takes the documented default", () => {
    /** The zero-TTL refusal: a grant with no lifetime could never authorize anything. */
    const zero = issuePermit(box, { issuerId: "sess-lead", issuerName: "captain", holderId: "M1", holderName: "Senior Engineer", ttlMs: 0 }, NOW)
    expect(zero.ok).toBe(false)
    /** The typo refusal: a string that is not a number must not become the default silently. */
    const typo = issuePermit(box, { issuerId: "sess-lead", issuerName: "captain", holderId: "M1", holderName: "Senior Engineer", ttlMs: "soon" }, NOW)
    expect(typo.ok).toBe(false)
    /** The defaulted grant, whose TTL the record itself spells. */
    const fallback = issuePermit(box, { issuerId: "sess-lead", issuerName: "captain", holderId: "M1", holderName: "Senior Engineer" }, NOW)
    expect(fallback.ok && fallback.permit.ttlMs).toBe(PERMIT_DEFAULT_TTL_MS)
    // The two refusals wrote nothing; the accepted default wrote exactly one line.
    expect(readPermits(box).permits.length).toBe(1)
  })

  test("a TTL above the hard bound is CLAMPED, and expiresAt is derived from the granted TTL", () => {
    /** The accepted grant, asked for far longer than a grant may live. */
    const granted = issuePermit(box, { issuerId: "sess-lead", issuerName: "captain", holderId: "M1", holderName: "Senior Engineer", ttlMs: PERMIT_MAX_TTL_MS * 10 }, NOW)
    expect(granted.ok).toBe(true)
    if (!granted.ok) return
    expect(granted.permit.ttlMs).toBe(PERMIT_MAX_TTL_MS)
    expect(granted.permit.expiresAt).toBe(new Date(NOW.getTime() + PERMIT_MAX_TTL_MS).toISOString())
    expect(granted.permit.at).toBe(NOW.toISOString())
  })
})

describe("checkPermit enforces expiry, ownership and the issuer's authority", () => {
  test("a missing permit is UNKNOWN", () => {
    expect(checkPermit(undefined, caller(), NOW)).toEqual({ ok: false, reason: "unknown", detail: "no such permit is recorded" })
  })

  test("at and after expiresAt the grant is EXPIRED, and one millisecond earlier it is valid", () => {
    /** A grant that began one minute ago. */
    const grant = permit({ expiresAt: new Date(NOW.getTime() + 1_000).toISOString() })
    /** The last instant the grant still covers. */
    const lastValid = new Date(NOW.getTime() + 999)
    expect(checkPermit(grant, caller(), lastValid).ok).toBe(true)
    /** The first instant it does not. */
    const lapsed = new Date(NOW.getTime() + 1_000)
    /** The refusal at the lapse instant. */
    const refused = checkPermit(grant, caller(), lapsed)
    expect(refused.ok === false ? refused.reason : "").toBe("expired")
    expect(refused.ok === false ? refused.detail : "").toContain(grant.expiresAt)
  })

  test("a permit issued to ANOTHER member is foreign, however it arrived in the log", () => {
    expect(checkPermit(permit({ holderId: "M2", holderName: "Reviewer" }), caller(), NOW)).toEqual({ ok: false, reason: "foreign-holder", detail: 'permit permit-issued was issued to "Reviewer" ("M2"), not to this caller' })
  })

  test("a permit from a session that is NOT this caller's captain is refused, even for the right holder", () => {
    // A member id (`M1`) is reused by every team, while a captain session is not — so this check is
    // what keeps a finished wave's grant from authorizing a wait in a new team.
    /** The refusal for a grant minted by a stranger. */
    const refused = checkPermit(permit({ issuerId: "sess-other" }), caller(), NOW)
    expect(refused.ok === false ? refused.reason : "").toBe("foreign-issuer")
    expect(refused.ok === false ? refused.detail : "").toContain("not this caller's captain")
    // A team that records no captain cannot validate any permit at all.
    expect(checkPermit(permit(), caller({ leadIds: [] }), NOW)).toEqual({ ok: false, reason: "foreign-issuer", detail: "permit permit-issued cannot be validated: this caller's team records no captain" })
  })

  test("the effective timeout is the SMALLEST of the request, the hard bound and the permit's remainder", () => {
    /** A grant with ten minutes left, asked for one minute: the request wins. */
    const longGrant = permit({ expiresAt: new Date(NOW.getTime() + 600_000).toISOString() })
    expect(checkPermit(longGrant, caller({ requestedTimeoutMs: 60_000 }), NOW)).toMatchObject({ ok: true, timeoutMs: 60_000 })
    // The HARD bound outranks a larger request…
    expect(checkPermit(longGrant, caller({ requestedTimeoutMs: WAIT_MAX_TIMEOUT_MS * 4 }), NOW)).toMatchObject({ ok: true, timeoutMs: WAIT_MAX_TIMEOUT_MS })
    // …and the permit's remainder outranks both.
    expect(checkPermit(longGrant, caller({ requestedTimeoutMs: WAIT_MAX_TIMEOUT_MS }), new Date(NOW.getTime() + 599_000))).toMatchObject({ ok: true, timeoutMs: 1_000 })
    // No request means the documented default, still clamped by the remainder.
    expect(checkPermit(longGrant, caller(), NOW)).toMatchObject({ ok: true, timeoutMs: WAIT_DEFAULT_TIMEOUT_MS })
  })
})

describe("the wait target must be what the permit's scope covers", () => {
  test("scope `answer` waits on a QUESTION, and on the one question when the grant names it", () => {
    /** A grant narrowed to one question id. */
    const narrowed = permit({ questionId: "q-colour" })
    expect(checkWaitTarget(narrowed, targetRow("question", "q-colour"))).toEqual({ ok: true })
    // A plain message is not a question, so an answer-scope grant cannot wait on it.
    expect(checkWaitTarget(narrowed, targetRow("message"))).toMatchObject({ ok: false, reason: "not-a-question" })
    // A DIFFERENT question is refused rather than silently waited on.
    expect(checkWaitTarget(narrowed, targetRow("question", "q-size"))).toMatchObject({ ok: false, reason: "wrong-question" })
  })

  test("scope `message` waits on any row, because any row can be replied to", () => {
    expect(checkWaitTarget(permit({ scope: "message" }), targetRow("message"))).toEqual({ ok: true })
    // A NARROWED grant is never inert: on a message-scope permit the target must still be the named
    // question, so a grant the captain scoped to one question cannot wait on anything else.
    expect(checkWaitTarget(permit({ scope: "message", questionId: "q-colour" }), targetRow("message"))).toMatchObject({ ok: false, reason: "wrong-question" })
    expect(checkWaitTarget(permit({ scope: "message", questionId: "q-colour" }), targetRow("question", "q-colour"))).toEqual({ ok: true })
  })
})

describe("repliesTo correlates a reply without trusting the replier's identity", () => {
  test("scope `answer` matches the answer's answerTo AND its questionId, and ASSEMBLES every answer", () => {
    /** The question being awaited. */
    const target = targetRow("question", "q-colour")
    /** The matching answer row. */
    const answer = { ...targetRow("answer"), id: "mail-answer", replyTo: target.id, answer: { questionId: "q-colour", answerTo: target.id, selected: ["A. red"] } }
    /** A SECOND answer to the same question — a broadcast question is answered per recipient, so the
     * wait must assemble both rather than returning whichever arrived first. */
    const second = { ...targetRow("answer"), id: "mail-second", replyTo: target.id, answer: { questionId: "q-colour", answerTo: target.id, selected: ["B. blue"] } }
    /** An answer to a DIFFERENT question, which must not satisfy this wait. */
    const other = { ...targetRow("answer"), id: "mail-other", replyTo: "mail-elsewhere", answer: { questionId: "q-colour", answerTo: "mail-elsewhere", selected: ["B. blue"] } }
    /** A plain reply that is not an answer, which answer scope also refuses. */
    const plain = { ...targetRow("message"), id: "mail-plain", replyTo: target.id }
    expect(repliesTo({ messages: [target, answer, other, second, plain] }, permit(), target).map((message) => message.id)).toEqual(["mail-answer", "mail-second"])
  })

  test("scope `message` accepts any reply to the target, and never the target itself", () => {
    /** The row being awaited. */
    const target = targetRow("message")
    /** A plain reply to it. */
    const reply = { ...targetRow("message"), id: "mail-reply", replyTo: target.id }
    expect(repliesTo({ messages: [target, reply] }, permit({ scope: "message" }), target).map((message) => message.id)).toEqual(["mail-reply"])
    // The target is excluded even if its own envelope names itself.
    expect(repliesTo({ messages: [{ ...target, replyTo: target.id }] }, permit({ scope: "message" }), target)).toEqual([])
  })
})

describe("waitForReply is finite by construction, not by hope", () => {
  test("an answer that ALREADY arrived is returned on the first of the polls", async () => {
    /** The question. */
    const target = targetRow("question", "q-colour")
    /** Its answer, already folded. */
    const answer = { ...targetRow("answer"), id: "mail-answer", answer: { questionId: "q-colour", answerTo: target.id, selected: ["A. red"] } }
    /** The clock the wait runs on; nothing advances because nothing needs to. */
    const time = clock(NOW)
    /** The outcome, which must not sleep at all. */
    const outcome = await waitForReply({ permit: permit(), target, timeoutMs: 5_000, read: () => ({ messages: [target, answer] }), ...time })
    expect(outcome).toEqual({ ok: true, messages: [answer], polls: 1, waitedMs: 0 })
  })

  test("an answer that arrives LATER is returned on the poll that sees it", async () => {
    /** The question. */
    const target = targetRow("question", "q-colour")
    /** Its answer, which the reader only exposes from the fourth read on. */
    const answer = { ...targetRow("answer"), id: "mail-answer", answer: { questionId: "q-colour", answerTo: target.id, selected: ["A. red"] } }
    /** How many times the mailbox has been read. */
    let reads = 0
    /** The clock the wait runs on. */
    const time = clock(NOW)
    /** The outcome after the answer becomes visible. */
    const outcome = await waitForReply({
      permit: permit(),
      target,
      timeoutMs: 5_000,
      read: () => { reads += 1; return { messages: reads >= 4 ? [target, answer] : [target] } },
      intervalMs: 10,
      ...time,
    })
    expect(outcome.ok).toBe(true)
    expect(outcome.polls).toBe(4)
    expect(outcome.ok ? outcome.messages.map((message) => message.id) : []).toEqual(["mail-answer"])
  })

  test("timeoutMs 0 means exactly ONE read and a timeout — a wait cannot be smuggled into a busy loop", async () => {
    /** The question. */
    const target = targetRow("question", "q-colour")
    /** The clock the wait runs on. */
    const time = clock(NOW)
    /** The outcome of a zero-length wait. */
    const outcome = await waitForReply({ permit: permit(), target, timeoutMs: 0, read: () => ({ messages: [target] }), ...time })
    expect(outcome).toEqual({ ok: false, reason: "timeout", polls: 1, waitedMs: 0 })
  })

  test("a FROZEN clock still terminates: the poll ceiling bounds the loop independently of time", async () => {
    /** The question. */
    const target = targetRow("question", "q-colour")
    /** A clock that never advances and a sleep that never moves it — the adversarial case. */
    const frozen = { now: (): Date => NOW, sleep: async (): Promise<void> => {} }
    /** The bounded outcome. */
    const outcome = await waitForReply({ permit: permit(), target, timeoutMs: 100, intervalMs: 10, read: () => ({ messages: [target] }), ...frozen })
    // ceil(100 / 10) + 1 = 11 reads, then the timeout — the arithmetic, not the clock, ended it.
    expect(outcome).toEqual({ ok: false, reason: "timeout", polls: 11, waitedMs: 0 })
  })

  test("an aborted call stops waiting instead of blocking to its deadline", async () => {
    /** The question. */
    const target = targetRow("question", "q-colour")
    /** The signal an arm aborts before the first sleep. */
    const controller = new AbortController()
    controller.abort()
    /** The clock the wait runs on. */
    const time = clock(NOW)
    /** The aborted outcome. */
    const outcome = await waitForReply({ permit: permit(), target, timeoutMs: 5_000, read: () => ({ messages: [target] }), signal: controller.signal, ...time })
    expect(outcome).toEqual({ ok: false, reason: "aborted", polls: 1, waitedMs: 0 })
  })
})

// ── the TOOL surface: AC-4's sentences and the round trip, over a real team record ────────────────

/** One registered tool, with `execute` kept so an arm can drive it. */
interface CapturedTool {
  /** The registered tool name. */
  name: string
  /** The registered tool's runner. */
  execute: (args: unknown, exec: unknown) => Promise<unknown>
}

/** The sandbox one tool-level arm drives. */
interface Harness {
  /** The sandbox workspace every call resolves to. */
  workspace: string
  /** Drive one registered tool AS a session. */
  call: (name: string, args: unknown, sessionId: string) => Promise<any>
}

/** Build the sandbox: the REAL plugin applied over a stub adapter and a stub executor. */
function harness(): Harness {
  /** A fresh workspace, so no arm sees another arm's records. */
  const workspace = mkdtempSync(join(tmpdir(), "mpd-permit-tool-"))
  sandboxes.push(workspace)
  /** The tools the plugin registered, by name. */
  const tools = new Map<string, CapturedTool>()
  /** The stub executor: raises every member under a name-derived handle and delivers nothing. */
  const executor = {
    kind: "native" as const,
    reason: "the arm's own executor",
    providers: (): string[] => ["spawn"],
    spawn: async (_caller: unknown, request: { name?: string }): Promise<{ handle: string; executor: string }> => ({
      handle: "child-" + String(request?.name ?? "").replace(/\s+/g, "-"),
      executor: "native",
    }),
    send: async (): Promise<void> => {},
    interrupt: async (): Promise<void> => {},
    membership: (): undefined => undefined,
    members: (): [] => [],
  }
  /** The stub adapter: the seams this row uses, and nothing else. */
  const dsh = {
    registerTool: (definition: CapturedTool): (() => void) => { tools.set(definition.name, definition); return () => {} },
    registerCommand: (): (() => void) => () => {},
    workspaceRoot: (): string => workspace,
    text: (value: unknown): unknown => value,
    teamExecutor: (): typeof executor => executor,
    teamMembership: (): undefined => undefined,
    teamListMembers: (): [] => [],
    teamListTasks: (): [] => [],
    capabilities: (): Record<string, never> => ({}),
  }
  /** The minimal cordis context `apply` needs. */
  const ctx = {
    get: (id: string) => (id === "mpdDsh" ? dsh : undefined),
    on: (): void => {},
    effect: (fn: () => unknown) => { try { return fn() ?? (() => {}) } catch { return () => {} } },
    provide: (): void => {},
    inject: (): void => {},
  }
  apply(ctx as never)
  return {
    workspace,
    call: async (name: string, args: unknown, sessionId: string): Promise<any> => {
      /** The registered tool, or a thrown error naming what was registered. */
      const tool = tools.get(name)
      if (tool === undefined) throw new Error(`no tool ${name} (have ${[...tools.keys()].join(", ")})`)
      return tool.execute(args, { agent: { session: { id: sessionId, header: { cwd: workspace } } }, signal: undefined })
    },
  }
}

/** The captain session every tool-level arm approves its team as. */
const LEAD = "sess-lead"

/** Stage and approve a two-member team AS the captain, and return the record it minted. */
async function approveTeam(h: Harness, members: readonly string[]): Promise<TeamRecord> {
  await h.call("agent_teams_plan", { action: "create", name: "mail-permit", description: "permit and wait" }, LEAD)
  for (const member of members) {
    await h.call("agent_teams_plan", { action: "add_member", member: { name: member, description: "a worker", prompt: `You are ${member}.` } }, LEAD)
  }
  await h.call("agent_teams_plan", { action: "create_task", task: { subject: "row", description: "one row", blocked_by: [] } }, LEAD)
  /** The approval's answer, read for the record it built. */
  const answer = await h.call("agent_teams_plan", { action: "approve" }, LEAD) as { team?: TeamRecord }
  if (answer.team === undefined) throw new Error("the approval answered no team")
  return answer.team
}

/**
 * A member's question to the captain, as the record's own session ids spell both sides.
 * @param h - the sandbox.
 * @param memberSession - the asking member's session id (its executor handle).
 * @returns the recorded question row's id.
 */
async function askCaptain(h: Harness, memberSession: string): Promise<string> {
  /** The send's answer, whose first message is the question row. */
  const sent = await h.call("agent_teams_mail", {
    action: "send",
    to: "captain",
    subject: "which colour?",
    body: "pick one label",
    question: { questionId: "q-colour", question: "Which colour?", options: [{ label: "A. red" }, { label: "B. blue" }] },
  }, memberSession)
  return String(sent.message.id)
}

/** How long a tool-level wait arm may block before the test itself considers it stuck. */
const ARM_TIMEOUT_MS = 5_000

describe("AC-4 over the real tool: refusal without a permit NAMES the captain", () => {
  test("a member asking for a permit is refused, and the refusal names the lead session", async () => {
    /** The sandbox under test. */
    const h = harness()
    await approveTeam(h, ["Senior Engineer"])
    /** The member's attempt to grant itself an exception. */
    const refused = await h.call("agent_teams_mail", { action: "permit", holder: "Senior Engineer", scope: "answer", ttlMs: 60_000 }, "child-Senior-Engineer")
    expect(refused.refused).toContain("only this team's captain")
    expect(refused.refused).toContain(LEAD)
    // Nothing was written: a refusal that still minted a grant would be worse than none.
    expect(readPermits(h.workspace).permits).toEqual([])
  })

  test("a wait with no permit is refused, and the refusal names the captain", async () => {
    /** The sandbox under test. */
    const h = harness()
    await approveTeam(h, ["Senior Engineer"])
    /** The member's question, which it will try to block on. */
    const messageId = await askCaptain(h, "child-Senior-Engineer")
    /** The refused wait. */
    const refused = await h.call("agent_teams_mail", { action: "wait", permitId: "permit-never-issued", messageId, timeoutMs: 100 }, "child-Senior-Engineer")
    expect(refused.refused).toContain("no permit")
    expect(refused.refused).toContain("your captain")
    expect(refused.refused).toContain(LEAD)
  })
})

describe("AC-4 over the real tool: a grant is bounded by TTL, holder and issuer", () => {
  test("an EXPIRED permit is refused even though its holder and issuer are right", async () => {
    /** The sandbox under test. */
    const h = harness()
    await approveTeam(h, ["Senior Engineer"])
    /** The member's question. */
    const messageId = await askCaptain(h, "child-Senior-Engineer")
    // A one-millisecond grant, minted through the REAL tool, then allowed to lapse — the store's own
    // writer proves the boundary rather than a hand-crafted expired record.
    /** The captain's short-lived grant. */
    const granted = await h.call("agent_teams_mail", { action: "permit", holder: "Senior Engineer", scope: "answer", ttlMs: 1 }, LEAD)
    expect(granted.ok).toBe(true)
    await new Promise<void>((resolve) => setTimeout(resolve, 5))
    /** The refused wait. */
    const refused = await h.call("agent_teams_mail", { action: "wait", permitId: granted.permit.permitId, messageId, timeoutMs: 100 }, "child-Senior-Engineer")
    expect(refused.refused).toContain("expired")
    expect(readPermits(h.workspace).permits.length).toBe(1)
  })

  test("a permit issued to ANOTHER member is foreign and refused", async () => {
    /** The sandbox under test, with two members so one can hold what the other needs. */
    const h = harness()
    await approveTeam(h, ["Senior Engineer", "Reviewer"])
    /** The Senior Engineer's question. */
    const messageId = await askCaptain(h, "child-Senior-Engineer")
    /** The captain's grant, made out to the Reviewer instead. */
    const granted = await h.call("agent_teams_mail", { action: "permit", holder: "Reviewer", scope: "answer", ttlMs: 60_000 }, LEAD)
    expect(granted.ok).toBe(true)
    /** The refused wait by the wrong holder. */
    const refused = await h.call("agent_teams_mail", { action: "wait", permitId: granted.permit.permitId, messageId, timeoutMs: 100 }, "child-Senior-Engineer")
    expect(refused.refused).toContain("not to this caller")
    expect(refused.refused).toContain("Reviewer")
  })
})

describe("AC-4 over the real tool: a valid wait returns the assembled answer or times out", () => {
  test("the answer arriving while the member waits is returned with its echoed LABELS", async () => {
    /** The sandbox under test. */
    const h = harness()
    await approveTeam(h, ["Senior Engineer"])
    /** The member's question to the captain. */
    const messageId = await askCaptain(h, "child-Senior-Engineer")
    /** The captain's grant to the member. */
    const granted = await h.call("agent_teams_mail", { action: "permit", holder: "Senior Engineer", scope: "answer", ttlMs: 60_000 }, LEAD)
    expect(granted.ok).toBe(true)
    // The wait starts BEFORE the answer exists: the block is real, and the answer it returns is written
    // by the OTHER side through the same tool surface a live session uses.
    /** The member's blocking wait, still pending when the captain answers. */
    const waiting = h.call("agent_teams_mail", { action: "wait", permitId: granted.permit.permitId, messageId, timeoutMs: ARM_TIMEOUT_MS }, "child-Senior-Engineer")
    await new Promise<void>((resolve) => setTimeout(resolve, 120))
    /** The captain's answer, echoing one offered label verbatim. */
    const answered = await h.call("agent_teams_mail", {
      action: "send",
      to: "Senior Engineer",
      subject: "answer: A. red",
      body: "A. red",
      answer: { questionId: "q-colour", answerTo: messageId, selected: ["A. red"] },
    }, LEAD)
    expect(answered.message).toBeDefined()
    /** The wait's assembled result. */
    const outcome = await waiting
    expect(outcome.ok).toBe(true)
    expect(outcome.permitId).toBe(granted.permit.permitId)
    expect(outcome.answers.length).toBe(1)
    // AC-4's payload: labels VERBATIM, and both correlation keys — never an index.
    expect(outcome.answers[0]).toMatchObject({ questionId: "q-colour", answerTo: messageId, selected: ["A. red"] })
    expect(outcome.answers[0].id).toBe(answered.message.id)
    expect(outcome.polls).toBeGreaterThan(1)
  })

  test("nothing arriving produces the documented TIMEOUT, and the wait really returned before its deadline", async () => {
    /** The sandbox under test. */
    const h = harness()
    await approveTeam(h, ["Senior Engineer"])
    /** The member's question. */
    const messageId = await askCaptain(h, "child-Senior-Engineer")
    /** The captain's grant. */
    const granted = await h.call("agent_teams_mail", { action: "permit", holder: "Senior Engineer", scope: "answer", ttlMs: 60_000 }, LEAD)
    expect(granted.ok).toBe(true)
    /** The instant the wait started, so the bound can be measured rather than assumed. */
    const startedAt = Date.now()
    /** The timing-out wait. */
    const outcome = await h.call("agent_teams_mail", { action: "wait", permitId: granted.permit.permitId, messageId, timeoutMs: 200 }, "child-Senior-Engineer")
    expect(outcome).toEqual({ ok: false, reason: "timeout", permitId: granted.permit.permitId, permitScope: "answer", polls: expect.any(Number), waitedMs: expect.any(Number) })
    // A BOUNDED block: it reported a timeout after at least its 200 ms budget and did not park the
    // caller beyond it (the 5 s allowance is the test's own stuck-guard, not the tool's bound).
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(200)
    expect(Date.now() - startedAt).toBeLessThan(ARM_TIMEOUT_MS)
    expect(outcome.polls).toBeGreaterThanOrEqual(4)
  })
})
