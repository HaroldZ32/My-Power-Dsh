// The mpd mailbox: its durability, its bounds, and the one transition the harness cannot provide.
// Every arm here is a rule a captain relies on when it asks "did they get it, and did they read it".
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  acknowledge,
  appendRecord,
  fold,
  inboxOf,
  mailboxPath,
  markDelivered,
  markRead,
  readMailbox,
  readRecords,
  recordWake,
  resolveRecipients,
  scopeToTeam,
  send,
  sendMany,
  summarise,
  undeliveredOf,
  unreadOf,
  type MailAck,
  type MailTargets,
  type SendInput,
  type SendResult,
} from "../src/mailbox-store"

/** Per-test workspace holding the mailbox log; recreated by the hooks below. */
let box = ""
/** The frozen clock every `sentAt`/`readAt` assertion is derived from. */
const NOW = new Date("2026-09-27T10:00:00.000Z")
/** A clock offset from NOW, in minutes, so a log's order is readable in the assertions. */
const later = (minutes: number): Date => new Date(NOW.getTime() + minutes * 60_000)
/** The live roster every send is validated against: three member ids. */
const ROSTER = ["lead", "senior", "researcher"]
/** The identity every acknowledgement here is made under: `senior` owns the default inbox. */
const ACK: MailAck = { byId: "senior", byName: "senior" }

beforeEach(() => { box = mkdtempSync(join(tmpdir(), "mpd-mailbox-")) })
afterEach(() => { rmSync(box, { recursive: true, force: true }) })

/** A well-formed send input, overridable per arm; the workspace comes from `box`. */
const msg = (over: Record<string, unknown> = {}): SendInput => ({
  fromId: "lead", fromName: "lead", toId: "senior", toName: "senior",
  subject: "task t4", body: "wire the gate", memberIds: ROSTER, ...over,
})

describe("sending", () => {
  test("a message to a live member is recorded and starts UNDELIVERED and UNREAD", () => {
    /** The recorded message, which must start undelivered AND unread. */
    const result = send(box, msg(), NOW)
    expect(result.ok).toBe(true)
    /** The mailbox folded back from the log, which is what the counters read. */
    const state = readMailbox(box)
    expect(state.messages).toHaveLength(1)
    expect(state.messages[0].subject).toBe("task t4")
    expect(undeliveredOf(state, "senior")).toHaveLength(1)
    expect(unreadOf(state, "senior")).toHaveLength(1)
  })

  test("a member cannot message ITSELF — the official rule, kept", () => {
    /** The refusal for a message addressed to the sender itself. */
    const result = send(box, msg({ toId: "lead", toName: "lead" }), NOW)
    expect(result.ok).toBe(false)
    // `expect` cannot narrow the result union and this pass adds no guard statement, so the refusal
    // arm of `SendResult` is named by a cast instead of by a runtime check.
    expect((result as Extract<SendResult, { ok: false }>).reason).toBe("self")
  })

  test("a message to somebody who is NOT a member is refused, naming them", () => {
    /** The refusal for a recipient the roster does not know. */
    const result = send(box, msg({ toId: "ghost", toName: "ghost" }), NOW)
    expect(result.ok).toBe(false)
    // `expect` cannot narrow the result union, so the refusal arm is named by a cast; `reason` is a
    // closed vocabulary, which is what makes it worth asserting exactly.
    expect((result as Extract<SendResult, { ok: false }>).reason).toBe("unknown-recipient")
    // The same cast, for the `detail` text, which must name the rejected recipient.
    expect(String((result as Extract<SendResult, { ok: false }>).detail)).toContain("ghost")
    expect(readMailbox(box).messages).toHaveLength(0)
  })

  test("a member's UNDELIVERED backlog is bounded — a stalled member cannot silently accumulate", () => {
    for (let i = 0; i < 3; i += 1) expect(send(box, msg({ subject: "m" + i, maxUndelivered: 3 }), later(i)).ok).toBe(true)
    /** The send that exceeds the bound, which must be refused rather than queued. */
    const refused = send(box, msg({ subject: "m3", maxUndelivered: 3 }), later(4))
    expect(refused.ok).toBe(false)
    // The union cannot be narrowed by `expect`, so the refusal arm is named by a cast; the bound is
    // refused with the same reason the official service uses.
    expect((refused as Extract<SendResult, { ok: false }>).reason).toBe("backlog-full")
    // The same cast, for the `detail` text, which must say the member is behind.
    expect(String((refused as Extract<SendResult, { ok: false }>).detail)).toContain("not keeping up")
  })

  test("the bound is PER TEAM — a finished team's backlog cannot refuse a new team's same-named member", () => {
    // Two sends for the OLD team exhaust THAT team's bound of two; `M1` is a per-team id every team
    // reuses, which is exactly why an unscoped count would carry the old wave's queue into the new one.
    for (let i = 0; i < 2; i += 1) expect(send(box, msg({ subject: "old" + i, teamId: "team-old", maxUndelivered: 2 }), later(i)).ok).toBe(true)
    expect(send(box, msg({ subject: "new0", teamId: "team-new", maxUndelivered: 2 }), later(3)).ok).toBe(true)
    expect(send(box, msg({ subject: "new1", teamId: "team-new", maxUndelivered: 2 }), later(4)).ok).toBe(true)
    /** The send that exceeds the NEW team's OWN bound, which must still be refused. */
    const refused = send(box, msg({ subject: "new2", teamId: "team-new", maxUndelivered: 2 }), later(5))
    expect(refused.ok).toBe(false)
    // `expect` cannot narrow the union, so the refusal arm is named by a cast; the bound still fires
    // WITHIN one team, which is what proves scoping did not merely disable it.
    expect((refused as Extract<SendResult, { ok: false }>).reason).toBe("backlog-full")
  })

  test("an UNSTAMPED row predates the team field, so a stamped team does not count it", () => {
    // A row written before team stamping existed: no team can prove it owns it, so it blocks nobody.
    expect(send(box, msg({ subject: "legacy", maxUndelivered: 1 }), NOW).ok).toBe(true)
    expect(send(box, msg({ subject: "first", teamId: "team-a", maxUndelivered: 1 }), later(1)).ok).toBe(true)
    // The team's OWN row still fills its bound, so the legacy exclusion is not a disabled bound.
    expect(send(box, msg({ subject: "second", teamId: "team-a", maxUndelivered: 1 }), later(2)).ok).toBe(false)
  })

  test("DELIVERING frees the backlog: the bound is on what is not yet accepted", () => {
    send(box, msg({ maxUndelivered: 1 }), NOW)
    expect(send(box, msg({ subject: "second", maxUndelivered: 1 }), later(1)).ok).toBe(false)
    /** The already-recorded message whose delivery frees the backlog. */
    const first = readMailbox(box).messages[0]
    markDelivered(box, [first.id], later(2))
    expect(send(box, msg({ subject: "second", maxUndelivered: 1 }), later(3)).ok).toBe(true)
  })

  test("the LIVE shape: bound 8, and an ACK frees exactly one slot — the operator's release valve", () => {
    /** The production bound the store applies when the caller names none. */
    const BOUND = 8
    // Fill the bound with rows the transport has NOT accepted and the member has NOT acknowledged.
    for (let i = 0; i < BOUND; i += 1) expect(send(box, msg({ subject: "waiting" + i, teamId: "team-live" }), later(i)).ok).toBe(true)
    /** The send that exceeds the DEFAULT bound, which must be refused. */
    const refused = send(box, msg({ subject: "ninth", teamId: "team-live" }), later(9))
    expect(refused.ok).toBe(false)
    // The EXACT sentence an operator reads, count and bound spelled out (no `maxUndelivered` was named).
    // CHANGED BY VEDIT-P0 C3/D2 (R2: named here, and the reviewer checks both sides): the old sentence
    // stopped at "— it is not keeping up", which named the recipient, the count and the bound but gave
    // the caller NO WAY OUT. The replacement keeps those three facts, names the knob behind the number,
    // and adds the two recovery paths the contract requires (ack the inbox, or reassign the rows).
    expect(String((refused as Extract<SendResult, { ok: false }>).detail)).toBe(
      '"senior" already has 8 undelivered message(s) and the bound (mail.maxUndelivered) is 8 — it is not keeping up.'
      + " Two recovery paths: acknowledge its inbox (cellwork_inbox for a cell seat, or agent_teams_mail {action:\"read\"} for a team member),"
      + " or reassign the rows behind it (cellwork_dispatch {reassign:[{task_id, owner}]}). Nothing was written.",
    )
    /** The oldest queued row, which the recipient ACKNOWLEDGES to free its slot. */
    const first = readMailbox(box).messages[0]
    expect(markRead(box, [first.id], ACK, later(10))).toEqual([first.id])
    // THE RELEASE VALVE: an acknowledgement — not a delivery — frees exactly one slot.
    expect(send(box, msg({ subject: "after-ack", teamId: "team-live" }), later(11)).ok).toBe(true)
    // …and the bound is FULL again, so the next send is refused: exactly ONE slot moved, never two.
    expect(send(box, msg({ subject: "after-ack-2", teamId: "team-live" }), later(12)).ok).toBe(false)
  })

  test("the summary's `undelivered` counts the SAME set the bound does — one ack drops both by one", () => {
    // Three queued rows for one member of one team: neither delivered nor acknowledged.
    for (let i = 0; i < 3; i += 1) send(box, msg({ subject: "queued" + i, teamId: "team-agree" }), later(i))
    /** The bound's own measurement, taken exactly the way `send` takes it. */
    const backlog = undeliveredOf(scopeToTeam(readMailbox(box), "team-agree"), "senior").length
    /** The summary row for that same member, over the same team scope. */
    const row = summarise(scopeToTeam(readMailbox(box), "team-agree")).find((entry) => entry.memberId === "senior")!
    expect(row.undelivered).toBe(backlog)
    /** The oldest queued row, whose acknowledgement must move BOTH counts. */
    const first = readMailbox(box).messages[0]
    markRead(box, [first.id], ACK, later(5))
    // ONE acknowledgement: the bound and the summary drop by exactly ONE each, still agreeing.
    expect(undeliveredOf(scopeToTeam(readMailbox(box), "team-agree"), "senior").length).toBe(backlog - 1)
    expect(summarise(scopeToTeam(readMailbox(box), "team-agree")).find((entry) => entry.memberId === "senior")!.undelivered).toBe(backlog - 1)
  })

  test("ids are unique and ordered, so a mailbox can be cited", () => {
    /** The first message, sent now. */
    const a = send(box, msg({ subject: "a" }), NOW)
    /** The second message, sent a minute later to a DIFFERENT member. */
    const b = send(box, msg({ subject: "b", toId: "researcher", toName: "researcher" }), later(1))
    // Both casts name the success arm of `SendResult`: `expect` cannot narrow the union, and the
    // arm is exactly what proves two sends never share an id.
    expect((a as Extract<SendResult, { ok: true }>).message.id).not.toBe((b as Extract<SendResult, { ok: true }>).message.id)
    expect(readMailbox(box).messages.map((m) => m.subject)).toEqual(["a", "b"])
  })
})

describe("the state transitions", () => {
  test("delivered and read are SEPARATE facts, and read is the one only this mailbox has", () => {
    send(box, msg(), NOW)
    /** The recorded message's id, which every later transition cites. */
    const id = readMailbox(box).messages[0].id
    expect(markDelivered(box, [id], later(1))).toEqual([id])
    /** The mailbox after delivery; the read state must still be unset. */
    let state = readMailbox(box)
    expect(state.messages[0].deliveredAt).toBe(later(1).toISOString())
    expect(state.messages[0].readAt).toBeUndefined()
    // delivered is not read: the captain's question is still unanswered
    expect(unreadOf(state, "senior")).toHaveLength(1)

    expect(markRead(box, [id], ACK, later(2))).toEqual([id])
    state = readMailbox(box)
    expect(state.messages[0].readAt).toBe(later(2).toISOString())
    expect(unreadOf(state, "senior")).toHaveLength(0)
  })

  test("a REPEAT moves nothing and is not an error", () => {
    send(box, msg(), NOW)
    /** The recorded message's id, cited by both repeat transitions below. */
    const id = readMailbox(box).messages[0].id
    expect(markDelivered(box, [id], later(1))).toEqual([id])
    expect(markDelivered(box, [id], later(2))).toEqual([])
    expect(markRead(box, [id], ACK, later(3))).toEqual([id])
    expect(markRead(box, [id], ACK, later(4))).toEqual([])
  })

  test("an unknown id is ignored, so a stale citation cannot corrupt the log", () => {
    expect(markDelivered(box, ["mail-nope"], NOW)).toEqual([])
    expect(markRead(box, ["mail-nope"], ACK, NOW)).toEqual([])
  })
})

describe("durability", () => {
  test("the log is APPEND-ONLY: a later transition never rewrites an earlier line", () => {
    send(box, msg(), NOW)
    /** The log as it stood after the send — the prefix every later state must preserve. */
    const afterSend = readFileSync(mailboxPath(box), "utf8")
    /** The message id the read transition targets. */
    const id = readMailbox(box).messages[0].id
    markRead(box, [id], ACK, later(1))
    /** The log after the read, which must still START with the bytes above. */
    const afterRead = readFileSync(mailboxPath(box), "utf8")
    expect(afterRead.startsWith(afterSend)).toBe(true)
    expect(afterRead.trim().split("\n")).toHaveLength(2)
  })

  test("a HALF-WRITTEN last line costs that line and nothing else", () => {
    send(box, msg({ subject: "kept" }), NOW)
    appendFileSync(mailboxPath(box), '{"t":"send","id":"mail-truncated","toId":"sen')
    /** The mailbox folded from a log whose last line is a partial write. */
    const state = readMailbox(box)
    expect(state.messages.map((m) => m.subject)).toEqual(["kept"])
  })

  test("a fold is order-independent for the transitions: read-then-delivered still ends both-set", () => {
    /** A hand-written log in which `read` precedes `delivered`, to prove fold order-independence. */
    const records = [
      { t: "send", id: "m1", fromId: "lead", fromName: "lead", toId: "senior", toName: "senior", subject: "s", body: "b", at: "t1" },
      { t: "read", id: "m1", at: "t3" },
      { t: "delivered", id: "m1", at: "t2" },
    ]
    /** The folded mailbox; both timestamps must be set whatever the line order. */
    const state = fold(records)
    expect(state.messages[0].readAt).toBe("t3")
    expect(state.messages[0].deliveredAt).toBe("t2")
  })

  test("malformed records are SKIPPED, never fatal", () => {
    expect(fold([null, 42, "nope", { t: "send" }, { t: "unknown" }]).messages).toHaveLength(0)
  })
})

describe("the summary a status view renders", () => {
  test("it counts total / unread / undelivered per member, and names what is oldest-unread", () => {
    send(box, msg({ subject: "first" }), NOW)
    send(box, msg({ subject: "second", toId: "researcher", toName: "researcher" }), later(1))
    send(box, msg({ subject: "third" }), later(2))
    /** The message addressed to `senior` with subject "first", to be acknowledged. */
    const senior = readMailbox(box).messages.find((m) => m.subject === "first")
    markRead(box, [senior!.id], ACK, later(3))
    /** The per-member summary, in first-appearance order. */
    const rows = summarise(readMailbox(box))
    /** senior's row, which must count both messages but only the still-unread one. */
    const seniorRow = rows.find((row) => row.memberId === "senior")!
    expect(seniorRow.total).toBe(2)
    expect(seniorRow.unread).toBe(1)
    expect(seniorRow.oldestUnread).toBe("third")
    expect(rows.map((row) => row.memberId)).toEqual(["senior", "researcher"])
  })

  test("an empty mailbox summarises to nothing at all", () => {
    expect(summarise(readMailbox(box))).toEqual([])
  })

  test("inboxOf keeps insertion order", () => {
    send(box, msg({ subject: "a" }), NOW)
    send(box, msg({ subject: "b" }), later(1))
    expect(inboxOf(readMailbox(box), "senior").map((m) => m.subject)).toEqual(["a", "b"])
  })
})

describe("the legacy read path", () => {
  test("a workspace with no mailbox yet reads as empty rather than throwing", () => {
    expect(readMailbox(join(box, "nowhere"))).toEqual({ messages: [], problems: [] })
  })

  test("a file of only blank lines folds to empty", () => {
    mkdirSync(join(box, ".mpd", "team"), { recursive: true })
    writeFileSync(mailboxPath(box), "\n\n\n")
    // THE FOLD ALWAYS CARRIES ITS PROBLEM LIST (R2's N2): an empty log is `problems: []`, never absent,
    // so a reader can tell "nothing was skipped" from "this producer does not report".
    expect(readMailbox(box)).toEqual({ messages: [], problems: [] })
  })
})

describe("the mail envelope (kind / replyTo / threadId / question / answer)", () => {
  test("a QUESTION round-trips: its options and its own thread survive the fold", () => {
    /** The question payload the row carries: two labels, each with its own ordinal. */
    const question = { questionId: "q1", question: "which store?", options: [{ label: "A. one" }, { label: "B. two" }] }
    /** The recorded question row. */
    const sent = send(box, msg({ kind: "question", question }), NOW)
    expect(sent.ok).toBe(true)
    /** The mailbox folded back from the log. */
    const state = readMailbox(box)
    expect(state.messages[0].kind).toBe("question")
    expect(state.messages[0].question?.options.map((option) => option.label)).toEqual(["A. one", "B. two"])
    // I7: a first message with no explicit thread IS its own thread.
    expect(state.messages[0].threadId).toBe(state.messages[0].id)
  })

  test("a LEGACY row with no `kind` folds as a `message`, so old logs stay readable", () => {
    mkdirSync(join(box, ".mpd", "team"), { recursive: true })
    writeFileSync(mailboxPath(box), JSON.stringify({ t: "send", id: "m-legacy", fromId: "lead", fromName: "lead", toId: "senior", toName: "senior", subject: "s", body: "b", at: "t1" }) + "\n")
    /** The folded row, written before the protocol existed. */
    const legacy = readMailbox(box).messages[0]
    expect(legacy.kind).toBe("message")
    // The thread is minted from the row's own id, so even a pre-protocol row can be replied to.
    expect(legacy.threadId).toBe("m-legacy")
    expect(legacy.question).toBeUndefined()
    expect(legacy.answer).toBeUndefined()
  })

  test("a reply inherits its `replyTo`'s thread; an explicit `threadId` wins", () => {
    /** The thread's first message. */
    const first = send(box, msg({ subject: "first" }), NOW)
    /** The first message's id, which every reply below cites. */
    const firstId = (first as Extract<SendResult, { ok: true }>).message.id
    /** A reply that names no thread, which must inherit the first message's thread (I7). */
    const reply = send(box, msg({ subject: "reply", replyTo: firstId }), later(1))
    expect((reply as Extract<SendResult, { ok: true }>).message.threadId).toBe(firstId)
    /** A reply that names a thread explicitly, which must WIN over inheritance. */
    const explicit = send(box, msg({ subject: "explicit", replyTo: firstId, threadId: "thread-x" }), later(2))
    expect((explicit as Extract<SendResult, { ok: true }>).message.threadId).toBe("thread-x")
  })

  test("an ANSWER echoes the offered labels VERBATIM and inherits its question's thread", () => {
    /** The question `senior` must answer, asked by `lead`. */
    const question = { questionId: "q1", question: "which store?", options: [{ label: "A. one" }, { label: "B. two" }] }
    /** The recorded question row. */
    const asked = send(box, msg({ kind: "question", question }), NOW)
    /** The question row's id, which the answer cites as `answerTo`. */
    const questionRowId = (asked as Extract<SendResult, { ok: true }>).message.id
    /** The answer, sent back by the addressed recipient. */
    const answered = send(box, msg({ kind: "answer", fromId: "senior", fromName: "senior", toId: "lead", toName: "lead", answer: { questionId: "q1", answerTo: questionRowId, selected: ["B. two"] } }), later(1))
    expect(answered.ok).toBe(true)
    /** The mailbox folded back from the log. */
    const state = readMailbox(box)
    expect(state.messages[1].kind).toBe("answer")
    expect(state.messages[1].answer?.selected).toEqual(["B. two"])
    // I7 through the answer: no explicit thread, no `replyTo` — so it inherits through `answerTo`'s row.
    expect(state.messages[1].threadId).toBe(state.messages[0].threadId)
  })

  test("an answer that is not an offered label is REFUSED with the valid label list", () => {
    /** The question whose labels the bad answer must fail to echo. */
    const question = { questionId: "q1", question: "which store?", options: [{ label: "A. one" }, { label: "B. two" }] }
    /** The recorded question row. */
    const asked = send(box, msg({ kind: "question", question }), NOW)
    /** The question row's id. */
    const questionRowId = (asked as Extract<SendResult, { ok: true }>).message.id
    /** An answer carrying a label the question never offered. */
    const refused = send(box, msg({ kind: "answer", fromId: "senior", fromName: "senior", toId: "lead", toName: "lead", answer: { questionId: "q1", answerTo: questionRowId, selected: ["C. three"] } }), later(1))
    expect(refused.ok).toBe(false)
    // The refusal arm of the union, named by a cast because `expect` cannot narrow it.
    const refusal = refused as Extract<SendResult, { ok: false }>
    expect(refusal.reason).toBe("invalid-envelope")
    expect(refusal.detail).toContain("C. three")
    // I4's whole point: the VALID labels come back with the refusal, so no counting is needed.
    expect(refusal.detail).toContain("A. one")
    expect(refusal.detail).toContain("B. two")
  })
})

describe("addressing: member id, member name, `captain`, and a broadcast", () => {
  test("a member is addressable by ID and by NAME", () => {
    /** The directory a call resolves against: one member, no lead. */
    const directory = { members: [{ id: "M1", name: "Senior Engineer" }], selfId: "cap" }
    expect(resolveRecipients(directory, "M1")).toEqual({ ok: true, targets: [{ id: "M1", name: "Senior Engineer" }], broadcast: false })
    expect(resolveRecipients(directory, "Senior Engineer")).toEqual({ ok: true, targets: [{ id: "M1", name: "Senior Engineer" }], broadcast: false })
  })

  test("`captain` and `lead` both resolve to the lead, recorded with toName `captain`", () => {
    /** The directory a lead-addressing call resolves against. */
    const directory = { members: [{ id: "M1", name: "Senior Engineer" }], lead: { id: "s-lead", name: "the lead" }, selfId: "M1" }
    // The RECORDED name is the role, whatever alias the caller spelled (contract §5).
    expect(resolveRecipients(directory, "captain")).toEqual({ ok: true, targets: [{ id: "s-lead", name: "captain" }], broadcast: false })
    expect(resolveRecipients(directory, "LEAD")).toEqual({ ok: true, targets: [{ id: "s-lead", name: "captain" }], broadcast: false })
  })

  test("a team that records no lead REFUSES `captain` and names what it does offer", () => {
    /** The same directory without a lead, which is what a team with no recorded lead looks like. */
    const directory = { members: [{ id: "M1", name: "Senior Engineer" }], selfId: "M1" }
    /** The refusal, which must spell the roster out. */
    const refused = resolveRecipients(directory, "captain")
    expect(refused.ok).toBe(false)
    // The refusal arm of the union, named by a cast because `expect` cannot narrow it.
    const refusal = refused as Extract<MailTargets, { ok: false }>
    expect(refusal.reason).toBe("unknown-recipient")
    expect(refusal.detail).toContain("Senior Engineer")
  })

  test("`*` is a FAN-OUT: one row per recipient, the sender excluded, one shared thread", () => {
    /** The directory a broadcast resolves against, with the sender itself among the members. */
    const directory = { members: [{ id: "lead", name: "lead" }, { id: "senior", name: "senior" }, { id: "researcher", name: "researcher" }], selfId: "lead" }
    /** The resolved broadcast, whose targets must exclude the sender. */
    const resolved = resolveRecipients(directory, "*")
    expect(resolved.ok).toBe(true)
    // The success arm of the union, named by a cast because `expect` cannot narrow it.
    const broadcast = resolved as Extract<MailTargets, { ok: true }>
    expect(broadcast.broadcast).toBe(true)
    expect(broadcast.targets.map((target) => target.id)).toEqual(["senior", "researcher"])
    /** The question every fan-out row carries. */
    const question = { questionId: "q1", question: "which store?", options: [{ label: "A. one" }] }
    /** The recorded fan-out. */
    const result = sendMany(box, msg({ kind: "question", question, fromId: "lead", fromName: "lead" }), broadcast.targets, NOW)
    expect(result.ok).toBe(true)
    /** The mailbox folded back from the log. */
    const state = readMailbox(box)
    expect(state.messages.map((message) => message.toId)).toEqual(["senior", "researcher"])
    // I6: ONE question, two rows, and every row carries the SAME thread — the fan-out is not a thread.
    expect(new Set(state.messages.map((message) => message.threadId)).size).toBe(1)
    expect(state.messages.map((message) => message.question?.questionId)).toEqual(["q1", "q1"])
  })

  test("the backlog bound is PER FAN-OUT ROW: one full recipient refuses the whole broadcast", () => {
    // Eight undelivered rows fill `researcher`'s bound of eight; `senior` is untouched.
    for (let i = 0; i < 8; i += 1) expect(send(box, msg({ subject: "queued" + i, toId: "researcher", toName: "researcher" }), later(i)).ok).toBe(true)
    /** The fan-out the broadcast resolves to: one recipient with room, one at its bound. */
    const targets = [{ id: "senior", name: "senior" }, { id: "researcher", name: "researcher" }]
    /** The broadcast, refused because ONE recipient cannot take another row. */
    const refused = sendMany(box, msg({ subject: "broadcast", fromId: "lead", fromName: "lead" }), targets, later(9))
    expect(refused.ok).toBe(false)
    // The refusal arm, named by a cast because `expect` cannot narrow the union.
    const refusal = refused as Extract<SendResult, { ok: false }>
    expect(refusal.reason).toBe("backlog-full")
    expect(refusal.detail).toContain("researcher")
    // ATOMIC: not even the row for the recipient that had room was written.
    expect(readMailbox(box).messages.filter((message) => message.subject === "broadcast")).toHaveLength(0)
  })
})

describe("ownership: who may answer, and who may acknowledge", () => {
  test("only a RECIPIENT of a question may answer it — a bystander is refused", () => {
    /** The question, addressed to `senior`. */
    const asked = send(box, msg({ kind: "question", question: { questionId: "q1", question: "which store?", options: [{ label: "A. one" }] } }), NOW)
    /** The question row's id. */
    const questionRowId = (asked as Extract<SendResult, { ok: true }>).message.id
    /** An answer from `researcher`, who was never addressed by the question. */
    const refused = send(box, msg({ kind: "answer", fromId: "researcher", fromName: "researcher", answer: { questionId: "q1", answerTo: questionRowId, selected: ["A. one"] } }), later(1))
    expect(refused.ok).toBe(false)
    // The refusal arm, named by a cast because `expect` cannot narrow the union.
    const refusal = refused as Extract<SendResult, { ok: false }>
    expect(refusal.reason).toBe("not-recipient")
    // T23: the refusal echoes the id the caller supplied and NEVER names the addressee or whether the
    // row exists, so this same sentence answers an absent id and a foreign question.
    expect(refusal.detail).toContain(questionRowId)
    expect(refusal.detail).not.toContain("senior")
  })

  test("an answer goes back to the ASKER — a third party is refused", () => {
    /** The question, asked by `lead` and addressed to `senior`. */
    const asked = send(box, msg({ kind: "question", question: { questionId: "q2", question: "which store?", options: [{ label: "A. one" }] } }), NOW)
    /** The question row's id. */
    const questionRowId = (asked as Extract<SendResult, { ok: true }>).message.id
    /** A REAL recipient answers, but addresses a third member instead of the asker. */
    const refused = send(box, msg({ kind: "answer", fromId: "senior", fromName: "senior", toId: "researcher", toName: "researcher", answer: { questionId: "q2", answerTo: questionRowId, selected: ["A. one"] } }), later(1))
    expect(refused.ok).toBe(false)
    // The refusal arm, named by a cast because `expect` cannot narrow the union.
    const refusal = refused as Extract<SendResult, { ok: false }>
    expect(refusal.reason).toBe("not-recipient")
    expect(refusal.detail).toContain("asker")
  })

  test("only the ADDRESSEE may acknowledge: a stranger's ack moves nothing and leaves the row unread", () => {
    send(box, msg(), NOW)
    /** The message id a stranger tries to acknowledge. */
    const id = readMailbox(box).messages[0].id
    /** The stranger's acknowledgement, which must be refused with the addressee named. */
    const outcome = acknowledge(box, [id], { byId: "researcher", byName: "researcher" }, later(1))
    expect(outcome.moved).toEqual([])
    expect(outcome.refused.map((entry) => entry.id)).toEqual([id])
    expect(outcome.refused[0].reason).toContain("senior")
    // AND THE ROW IS STILL UNREAD: a refused acknowledgement moves nothing at all.
    expect(unreadOf(readMailbox(box), "senior")).toHaveLength(1)
  })

  test("a member-to-member answer matches by ROSTER id, not by session id (the D16c class)", () => {
    // M1 asks M2. Both sides carry a ROSTER id (`M1`/`M2`) and a DIFFERENT session id, which is the
    // shape a real team has: a row is addressed to the roster id, while a session answers as its own.
    /** The roster the two members belong to. */
    const roster = ["M1", "M2"]
    /** The question M1 asks M2. */
    const asked = send(box, msg({ kind: "question", memberIds: roster, fromId: "s-M1", fromName: "M1", fromMemberId: "M1", toId: "M2", toName: "M2", question: { questionId: "q9", question: "ok?", options: [{ label: "A. yes" }] } }), NOW)
    expect(asked.ok).toBe(true)
    /** The question row's id, cited by the answer below. */
    const questionRowId = (asked as Extract<SendResult, { ok: true }>).message.id
    // M2 answers, addressed back to the asker's ROSTER id — the spelling a member actually uses.
    const answered = send(box, msg({ kind: "answer", memberIds: roster, fromId: "s-M2", fromName: "M2", fromMemberId: "M2", toId: "M1", toName: "M1", answer: { questionId: "q9", answerTo: questionRowId, selected: ["A. yes"] } }), later(1))
    expect(answered.ok).toBe(true)
    // BOTH spellings survive the fold, which is what makes a later ownership check resolvable.
    const state = readMailbox(box)
    expect(state.messages[0].fromMemberId).toBe("M1")
    expect(state.messages[1].fromMemberId).toBe("M2")
    expect(state.messages[1].kind).toBe("answer")
  })

  test("the ack records `by` — WHO acknowledged, on the read row", () => {
    send(box, msg(), NOW)
    /** The message id the addressee acknowledges. */
    const id = readMailbox(box).messages[0].id
    expect(markRead(box, [id], ACK, later(1))).toEqual([id])
    // The read row names the member, which is what the answer/ack ownership rules cite.
    expect(readMailbox(box).messages[0].readBy).toBe("senior")
  })
})

describe("R2 repairs — duplicate ids, the durable wake line, the two spellings of self", () => {
  test("a DUPLICATE id is REPORTED, the first write wins, and its stamps win with it (R2's N2)", () => {
    // Two `send` rows share `d1`. The protocol fold reports the duplicate and keeps the FIRST write;
    // the wrapper must surface that report instead of swallowing it.
    mkdirSync(join(box, ".mpd", "team"), { recursive: true })
    appendRecord(box, { t: "send", id: "d1", fromId: "lead", fromName: "lead", toId: "senior", toName: "senior", subject: "FIRST", body: "b", at: "t1", cellId: "cell-FIRST" })
    appendRecord(box, { t: "send", id: "d1", fromId: "lead", fromName: "lead", toId: "senior", toName: "senior", subject: "SECOND", body: "b", at: "t2", cellId: "cell-SECOND" })
    /** The folded state: ONE message, plus the anomaly the protocol fold reported (I8). */
    const state = readMailbox(box)
    expect(state.messages).toHaveLength(1)
    expect(state.messages[0].subject).toBe("FIRST")
    // THE STAMPS FOLLOW THE SAME POLICY: a later duplicate must not decorate the row that was kept.
    expect(state.messages[0].cellId).toBe("cell-FIRST")
    expect((state.problems ?? []).join(" ")).toContain("duplicate")
    // …and a TEAM-SCOPED view keeps the LOG-level diagnostics instead of dropping them.
    expect(scopeToTeam(state, "team-a").problems).toEqual(state.problems)
  })

  test("a MEMBER cannot message its own ROSTER id — self in its second spelling (R2's F1)", () => {
    // The sender's session id differs from its roster id, which is exactly the shape a real member
    // has: comparing the session id alone let it mail its own roster row.
    const refused = send(box, msg({ memberIds: ["M1", "M2"], fromId: "session-M1", fromName: "M1", fromMemberId: "M1", toId: "M1", toName: "M1" }), NOW)
    expect(refused.ok).toBe(false)
    // The refusal arm, named by a cast because `expect` cannot narrow the union.
    expect((refused as Extract<SendResult, { ok: false }>).reason).toBe("self")
    expect(readMailbox(box).messages).toHaveLength(0)
  })

  test("a wake outcome is a DURABLE line carrying its reason, and the fold ignores it (R2's N1)", () => {
    send(box, msg(), NOW)
    /** The row whose wake-up failed. */
    const id = readMailbox(box).messages[0].id
    /** The durable record the failed attempt must leave — the cellwork `CellMailWake` shape verbatim. */
    const line = recordWake(box, id, { sent: false, reason: "no executor handle" }, later(1))
    expect(line).toEqual({ t: "wake", id, sent: false, reason: "no executor handle", at: later(1).toISOString() })
    // It is APPENDED (not rewritten into the row) and it is the LAST line of the log.
    const records = readRecords(box)
    expect(records[records.length - 1]).toEqual(line)
    // …and a foreign kind costs the mail fold NOTHING: one message, no problem.
    const state = readMailbox(box)
    expect(state.messages).toHaveLength(1)
    expect(state.problems).toEqual([])
    // A SUCCESSFUL wake carries no reason at all, which is the `sent:true` half of the contract.
    expect(recordWake(box, id, { sent: true }, later(2))).toEqual({ t: "wake", id, sent: true, at: later(2).toISOString() })
  })
})

describe("the cellwork pass-through stamps", () => {
  test("`cellId`/`fromCell` survive the fold and change NO team rule", () => {
    send(box, msg({ cellId: "cell-1", fromCell: "cell-0", teamId: "team-a" }), NOW)
    /** The folded row, which must keep both pass-through stamps. */
    const state = readMailbox(box)
    expect(state.messages[0].cellId).toBe("cell-1")
    expect(state.messages[0].fromCell).toBe("cell-0")
    // The stamps are INERT on this plane: the team scope still answers by `teamId` alone, so a `cellId`
    // can never widen or narrow what a team may claim.
    expect(scopeToTeam(state, "team-a").messages).toHaveLength(1)
    expect(scopeToTeam(state, "cell-1").messages).toHaveLength(0)
  })
})
