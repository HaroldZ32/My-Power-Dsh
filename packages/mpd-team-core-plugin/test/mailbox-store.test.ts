// The mpd mailbox: its durability, its bounds, and the one transition the harness cannot provide.
// Every arm here is a rule a captain relies on when it asks "did they get it, and did they read it".
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  fold,
  inboxOf,
  mailboxPath,
  markDelivered,
  markRead,
  readMailbox,
  scopeToTeam,
  send,
  summarise,
  undeliveredOf,
  unreadOf,
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
    expect(String((refused as Extract<SendResult, { ok: false }>).detail)).toBe('"senior" already has 8 undelivered message(s) (bound 8) — it is not keeping up')
    /** The oldest queued row, which the recipient ACKNOWLEDGES to free its slot. */
    const first = readMailbox(box).messages[0]
    expect(markRead(box, [first.id], later(10))).toEqual([first.id])
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
    markRead(box, [first.id], later(5))
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

    expect(markRead(box, [id], later(2))).toEqual([id])
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
    expect(markRead(box, [id], later(3))).toEqual([id])
    expect(markRead(box, [id], later(4))).toEqual([])
  })

  test("an unknown id is ignored, so a stale citation cannot corrupt the log", () => {
    expect(markDelivered(box, ["mail-nope"], NOW)).toEqual([])
    expect(markRead(box, ["mail-nope"], NOW)).toEqual([])
  })
})

describe("durability", () => {
  test("the log is APPEND-ONLY: a later transition never rewrites an earlier line", () => {
    send(box, msg(), NOW)
    /** The log as it stood after the send — the prefix every later state must preserve. */
    const afterSend = readFileSync(mailboxPath(box), "utf8")
    /** The message id the read transition targets. */
    const id = readMailbox(box).messages[0].id
    markRead(box, [id], later(1))
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
    markRead(box, [senior!.id], later(3))
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
    expect(readMailbox(join(box, "nowhere"))).toEqual({ messages: [] })
  })

  test("a file of only blank lines folds to empty", () => {
    mkdirSync(join(box, ".mpd", "team"), { recursive: true })
    writeFileSync(mailboxPath(box), "\n\n\n")
    expect(readMailbox(box)).toEqual({ messages: [] })
  })
})
