// The harness's inbox arithmetic. The arms are the ones a wrong count would come from: a message
// taken twice, a discarded one still counted as waiting, and a counter attached mid-life.
import { describe, expect, test } from "bun:test"
import { applyInboxEvent, emptyCounts, INBOX_EVENTS, unreadOf } from "../src/mailbox"

describe("the inbox counters", () => {
  test("a message that entered and was not taken is WAITING", () => {
    const counts = applyInboxEvent(emptyCounts(), "agent/inbox/inserted")
    expect(unreadOf(counts)).toBe(1)
  })

  test("taking it clears the count", () => {
    let counts = applyInboxEvent(emptyCounts(), "agent/inbox/inserted")
    counts = applyInboxEvent(counts, "agent/inbox/claimed")
    expect(unreadOf(counts)).toBe(0)
    expect(counts.claimed).toBe(1)
  })

  test("discarding it clears the count too — a dropped message is not waiting", () => {
    let counts = applyInboxEvent(emptyCounts(), "agent/inbox/inserted")
    counts = applyInboxEvent(counts, "agent/inbox/discarded")
    expect(unreadOf(counts)).toBe(0)
    expect(counts.discarded).toBe(1)
  })

  test("several messages accumulate and clear independently", () => {
    let counts = emptyCounts()
    for (const _ of [1, 2, 3]) counts = applyInboxEvent(counts, "agent/inbox/inserted")
    counts = applyInboxEvent(counts, "agent/inbox/claimed")
    expect(unreadOf(counts)).toBe(2)
  })

  test("an unknown event changes NOTHING (a broad subscription is safe)", () => {
    const before = { inserted: 2, claimed: 0, discarded: 0 }
    expect(applyInboxEvent(before, "agent/inbox/spliced")).toBe(before)
    expect(unreadOf(applyInboxEvent(before, "something/else"))).toBe(2)
  })

  test("the counters are IMMUTABLE: a fold never mutates what it was given", () => {
    const before = emptyCounts()
    const after = applyInboxEvent(before, "agent/inbox/inserted")
    expect(before.inserted).toBe(0)
    expect(after.inserted).toBe(1)
  })

  test("a counter attached MID-LIFE never goes negative", () => {
    // The session may already have taken messages before this row attached, so `claimed` can exceed
    // `inserted` in the window we can see. A negative "unread" would be a worse lie than a low one.
    const counts = applyInboxEvent(applyInboxEvent(emptyCounts(), "agent/inbox/claimed"), "agent/inbox/claimed")
    expect(unreadOf(counts)).toBe(0)
  })

  test("the subscribed set is exactly the three documented events", () => {
    expect([...INBOX_EVENTS]).toEqual(["agent/inbox/inserted", "agent/inbox/claimed", "agent/inbox/discarded"])
  })
})
