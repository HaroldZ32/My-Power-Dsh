// t35 (R1) — message channel: idempotent dedup, bounded archive-first clear, and a
// first-class interjection queue that the scheduler must NOT auto-deliver.
//
// Every acceptance criterion has its negative control in the same file, because a
// one-sided assertion here would be satisfied by a channel that simply drops or
// blocks everything.
import { expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  INTERJECTION_KIND,
  INTERJECTION_QUEUE,
  INTERJECTION_TTL_MS,
  MAILBOX_DEDUP_WINDOW_MS,
  acknowledgeMailbox,
  appendMailbox,
  appendMailboxDeduped,
  clearMailboxToWatermark,
  decideInterjection,
  enqueueInterjection,
  expireInterjections,
  readLiveMailbox,
  readMailbox,
  readPendingInterjections,
  readUnreadMailbox,
} from "../lib/state.js"

const STATE_DIR = join(".mpd", "team")
const TEAM = "r1-team"

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "mpd-r1-"))
  const stateRoot = join(dir, STATE_DIR)
  mkdirSync(join(stateRoot, TEAM, "inbox"), { recursive: true })
  return { dir, stateRoot, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}
const message = (over = {}) => ({
  id: `m-${Math.random().toString(16).slice(2)}`, from: "Senior Engineer", to: "captain",
  content: "same content", ts: 1_000_000, ...over,
})

test("R1 dedup: N identical sends in the window fold to ONE record with dupCount=N", async () => {
  const { stateRoot, cleanup } = fixture()
  try {
    const base = message({ ts: 5_000_000 })
    const first = await appendMailboxDeduped(stateRoot, TEAM, "captain", { ...base, id: "rec-1" })
    expect(first.folded).toBe(false)
    // two more, inside the window, same from+to+content
    const second = await appendMailboxDeduped(stateRoot, TEAM, "captain", { ...base, id: "rec-2", ts: base.ts + 1000 })
    const third = await appendMailboxDeduped(stateRoot, TEAM, "captain", { ...base, id: "rec-3", ts: base.ts + 2000 })
    expect(second.folded).toBe(true)
    expect(third.folded).toBe(true)
    const records = await readMailbox(stateRoot, TEAM, "captain")
    // the window must stop the ACTION, not shrink the file: exactly one record survives
    expect(records.length).toBe(1)
    expect(records[0].id).toBe("rec-1")
    expect(records[0].dupCount).toBe(3)
    // delivery path sees ONE message, so a recipient cannot act three times
    expect((await readUnreadMailbox(stateRoot, TEAM, "captain")).length).toBe(1)
  } finally { cleanup() }
})

test("R1 dedup NEGATIVE CONTROL: same content, different from/to is NOT folded", async () => {
  const { stateRoot, cleanup } = fixture()
  try {
    const ts = 6_000_000
    const a = await appendMailboxDeduped(stateRoot, TEAM, "captain", message({ id: "a", ts }))
    const b = await appendMailboxDeduped(stateRoot, TEAM, "captain", message({ id: "b", ts, from: "Lead" }))
    expect(a.folded).toBe(false)
    expect(b.folded).toBe(false)
    // same to + same content + same window, but a different sender => two records
    const records = await readMailbox(stateRoot, TEAM, "captain")
    expect(records.length).toBe(2)
    expect(records.every((record) => record.dupCount === 1)).toBe(true)
  } finally { cleanup() }
})

test("R1 dedup: a send OUTSIDE the 60 s window is a new record (window is real)", async () => {
  const { stateRoot, cleanup } = fixture()
  try {
    const ts = 7_000_000
    await appendMailboxDeduped(stateRoot, TEAM, "captain", message({ id: "w1", ts }))
    const late = await appendMailboxDeduped(stateRoot, TEAM, "captain", message({ id: "w2", ts: ts + MAILBOX_DEDUP_WINDOW_MS + 1 }))
    expect(late.folded).toBe(false)
    expect((await readMailbox(stateRoot, TEAM, "captain")).length).toBe(2)
  } finally { cleanup() }
})

test("R1 clear: archive-first tombstone + recoverable sidecar + audit event", async () => {
  const { stateRoot, cleanup } = fixture()
  try {
    await appendMailbox(stateRoot, TEAM, "captain", message({ id: "old-1", ts: 100, content: "SECRET-OLD-BYTES" }))
    await appendMailbox(stateRoot, TEAM, "captain", message({ id: "old-2", ts: 200, content: "older two" }))
    await appendMailbox(stateRoot, TEAM, "captain", message({ id: "new-1", ts: 900, content: "kept" }))
    const result = await clearMailboxToWatermark(stateRoot, TEAM, "captain", 500, { now: 1_000_000 })
    expect(result.cleared.sort()).toEqual(["old-1", "old-2"])
    expect(result.audit.kind).toBe("mailbox-cleared")
    expect(result.audit.clearedCount).toBe(2)
    // (b) the sidecar holds the cleared bytes verbatim and is recoverable
    expect(existsSync(result.sidecar)).toBe(true)
    expect(readFileSync(result.sidecar, "utf8")).toContain("SECRET-OLD-BYTES")
    // (a) the live file keeps tombstone rows
    const all = await readMailbox(stateRoot, TEAM, "captain")
    const tombstones = all.filter((record) => record.tombstone === true)
    expect(tombstones.map((record) => record.id).sort()).toEqual(["old-1", "old-2"])
    for (const tombstone of tombstones) {
      expect(tombstone.content).toBe("")
      expect(tombstone.archivedTo).toBe(result.sidecar)
    }
    // after clear the LIVE read returns only non-tombstoned records
    expect((await readLiveMailbox(stateRoot, TEAM, "captain")).map((record) => record.id)).toEqual(["new-1"])
  } finally { cleanup() }
})

test("R1 clear NEGATIVE CONTROL: no hard-delete path — cleared bytes survive on disk", async () => {
  const { stateRoot, cleanup } = fixture()
  try {
    await appendMailbox(stateRoot, TEAM, "captain", message({ id: "gone", ts: 100, content: "RECOVER-ME-42" }))
    const before = await readMailbox(stateRoot, TEAM, "captain")
    const result = await clearMailboxToWatermark(stateRoot, TEAM, "captain", 500, { now: 11 })
    // the record itself is still present (tombstone), so nothing was deleted
    expect((await readMailbox(stateRoot, TEAM, "captain")).length).toBe(before.length)
    // and the original bytes are recoverable from the archive sidecar
    const recovered = readFileSync(result.sidecar, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line))
    expect(recovered.find((record) => record.id === "gone").content).toBe("RECOVER-ME-42")
  } finally { cleanup() }
})

test("R1 interjection: pending requests are NOT deliverable unread (negative control on the read path)", async () => {
  const { stateRoot, cleanup } = fixture()
  try {
    const request = await enqueueInterjection(stateRoot, TEAM, {
      id: "ij-1", from: "Senior Engineer", content: "summary: gate bug", ts: 1_000,
      summary: "gate bug", reason: "wrong threshold", location: "lib/session-start.js:190",
    })
    expect(request.kind).toBe(INTERJECTION_KIND)
    expect(request.status).toBe("pending")
    expect(request.to).toBe(INTERJECTION_QUEUE)
    expect(request.expiresAt).toBe(1_000 + INTERJECTION_TTL_MS)
    // the queue holds it...
    const pending = await readPendingInterjections(stateRoot, TEAM)
    expect(pending.map((record) => record.id)).toEqual(["ij-1"])
    // ...and it is NOT in any member's ordinary unread inbox, which is the path the
    // scheduler packs verbatim and auto-delivers at the next idle edge.
    for (const key of ["Senior Engineer", "captain", "Lead"]) {
      const unread = await readUnreadMailbox(stateRoot, TEAM, key)
      expect(unread.filter((record) => record.kind === INTERJECTION_KIND).length).toBe(0)
    }
  } finally { cleanup() }
})

test("R1 interjection: TTL silence is a DENY (status expired)", async () => {
  const { stateRoot, cleanup } = fixture()
  try {
    const ts = 2_000
    await enqueueInterjection(stateRoot, TEAM, { id: "ij-ttl", from: "Junior Engineer", content: "s", ts, summary: "s", reason: "r", location: "t1" })
    // not yet expired
    expect(await expireInterjections(stateRoot, TEAM, { now: ts + 1000 })).toEqual([])
    expect((await readPendingInterjections(stateRoot, TEAM)).length).toBe(1)
    // one millisecond past the TTL it is expired, and no longer pending
    const expired = await expireInterjections(stateRoot, TEAM, { now: ts + INTERJECTION_TTL_MS })
    expect(expired).toEqual(["ij-ttl"])
    expect((await readPendingInterjections(stateRoot, TEAM)).length).toBe(0)
    const record = (await readMailbox(stateRoot, TEAM, INTERJECTION_QUEUE)).find((entry) => entry.id === "ij-ttl")
    expect(record.status).toBe("expired")
  } finally { cleanup() }
})

test("R1 interjection: approval is recorded and cannot be re-decided", async () => {
  const { stateRoot, cleanup } = fixture()
  try {
    await enqueueInterjection(stateRoot, TEAM, { id: "ij-ok", from: "Lead", content: "s", ts: 1, summary: "s", reason: "r", location: "t9" })
    const approved = await decideInterjection(stateRoot, TEAM, "ij-ok", "approved", { now: 500 })
    expect(approved.status).toBe("approved")
    expect((await readPendingInterjections(stateRoot, TEAM)).length).toBe(0)
    await expect(decideInterjection(stateRoot, TEAM, "ij-ok", "approved", { now: 600 })).rejects.toThrow(/already approved/)
  } finally { cleanup() }
})

test("REPAIR V1: a request WITHOUT content is NORMALIZED (never silently invisible)", async () => {
  const { stateRoot, cleanup } = fixture()
  try {
    // The exact t38 failure shape: no `content` at all. Before the repair this
    // returned status:'pending' while readPendingInterjections could not see it.
    const record = await enqueueInterjection(stateRoot, TEAM, {
      id: "ij-nc", from: "Junior Engineer", summary: "let me touch lib/x", reason: "blocked on scope", location: "lib/x", ts: 1_000,
    })
    expect(record.status).toBe("pending")
    // DECISION PINNED: normalization, with content derived from summary
    expect(record.content).toBe("let me touch lib/x")
    const pending = await readPendingInterjections(stateRoot, TEAM)
    expect(pending.map((entry) => entry.id)).toEqual(["ij-nc"])
    // and it is decidable (the captain can act on what they can see)
    const approved = await decideInterjection(stateRoot, TEAM, "ij-nc", "approved", { now: 2_000 })
    expect(approved.status).toBe("approved")
  } finally { cleanup() }
})

test("REPAIR V1: the content fallback priority is summary -> reason -> location", async () => {
  const { stateRoot, cleanup } = fixture()
  try {
    const fromSummary = await enqueueInterjection(stateRoot, TEAM, { id: "p1", from: "Lead", summary: "S", reason: "R", location: "L", ts: 1 })
    const fromReason = await enqueueInterjection(stateRoot, TEAM, { id: "p2", from: "Lead", reason: "R", location: "L", ts: 1 })
    const fromLocation = await enqueueInterjection(stateRoot, TEAM, { id: "p3", from: "Lead", location: "L", ts: 1 })
    expect(fromSummary.content).toBe("S")
    expect(fromReason.content).toBe("R")
    expect(fromLocation.content).toBe("L")
    // the caller's own content always wins
    const explicit = await enqueueInterjection(stateRoot, TEAM, { id: "p4", from: "Lead", content: "C", summary: "S", ts: 1 })
    expect(explicit.content).toBe("C")
  } finally { cleanup() }
})

test("REPAIR V1: identity is REQUIRED and rejected loudly, naming the field", async () => {
  const { stateRoot, cleanup } = fixture()
  try {
    await expect(enqueueInterjection(stateRoot, TEAM, { from: "Lead", ts: 1 })).rejects.toThrow(/missing required field "id"/)
    await expect(enqueueInterjection(stateRoot, TEAM, { id: "x", ts: 1 })).rejects.toThrow(/missing required field "from"/)
    await expect(enqueueInterjection(stateRoot, TEAM, { id: "x", from: "Lead" })).rejects.toThrow(/missing required field "ts"/)
    // no partially-written record is left behind by a rejected call
    expect((await readMailbox(stateRoot, TEAM, INTERJECTION_QUEUE)).length).toBe(0)
  } finally { cleanup() }
})

test("REPAIR V1: decide distinguishes MALFORMED-but-present from truly ABSENT", async () => {
  const { stateRoot, cleanup } = fixture()
  try {
    // absent: no such record anywhere
    await expect(decideInterjection(stateRoot, TEAM, "nope", "approved", { now: 1 })).rejects.toThrow(/does not exist/)
    // malformed-but-present: written straight to the queue file without content, so it
    // fails the mailbox shape check and the normal reader cannot see it
    const file = join(stateRoot, TEAM, "inbox", `${INTERJECTION_QUEUE}.jsonl`)
    writeFileSync(file, JSON.stringify({ id: "broken", from: "Lead", to: INTERJECTION_QUEUE, kind: INTERJECTION_KIND, status: "pending", ts: 1, expiresAt: 2 }) + "\n")
    expect((await readMailbox(stateRoot, TEAM, INTERJECTION_QUEUE)).length).toBe(0)
    await expect(decideInterjection(stateRoot, TEAM, "broken", "approved", { now: 3 })).rejects.toThrow(/MALFORMED/)
  } finally { cleanup() }
})

test("REPAIR V1: a normalized request still expires on captain silence (default DENY usable)", async () => {
  const { stateRoot, cleanup } = fixture()
  try {
    const ts = 5_000
    await enqueueInterjection(stateRoot, TEAM, { id: "ij-ttl-nc", from: "Junior Engineer", reason: "only a reason", ts })
    expect(await expireInterjections(stateRoot, TEAM, { now: ts + INTERJECTION_TTL_MS })).toEqual(["ij-ttl-nc"])
    const record = (await readMailbox(stateRoot, TEAM, INTERJECTION_QUEUE)).find((entry) => entry.id === "ij-ttl-nc")
    expect(record.status).toBe("expired")
    // `from` survives so the requesting member can be told
    expect(record.from).toBe("Junior Engineer")
  } finally { cleanup() }
})

test("R1 SEAM: after a clear -> 0 unread and 0 deliverable (tombstones never re-open)", async () => {
  const { stateRoot, cleanup } = fixture()
  try {
    await appendMailbox(stateRoot, TEAM, "captain", message({ id: "c1", ts: 100, content: "payload-1" }))
    await appendMailbox(stateRoot, TEAM, "captain", message({ id: "c2", ts: 200, content: "payload-2" }))
    // both are unread before the clear
    expect((await readUnreadMailbox(stateRoot, TEAM, "captain")).length).toBe(2)
    await clearMailboxToWatermark(stateRoot, TEAM, "captain", 500, { now: 1_000 })
    // the seam: a cleared record is not unread and not deliverable — it is a tombstone
    expect((await readUnreadMailbox(stateRoot, TEAM, "captain")).length).toBe(0)
    expect((await readLiveMailbox(stateRoot, TEAM, "captain")).length).toBe(0)
    // rows survive (no hard delete) and carry the markers
    const all = await readMailbox(stateRoot, TEAM, "captain")
    expect(all.filter((record) => record.tombstone === true).length).toBe(2)
  } finally { cleanup() }
})

test("R1 SEAM: a clear cannot RE-OPEN an acknowledged record", async () => {
  const { stateRoot, cleanup } = fixture()
  try {
    await appendMailbox(stateRoot, TEAM, "captain", message({ id: "ack-1", ts: 100, content: "already-read" }))
    // the recipient acknowledges it (delivered + read markers)
    await acknowledgeMailbox(stateRoot, TEAM, "captain", ["ack-1"])
    expect((await readUnreadMailbox(stateRoot, TEAM, "captain")).length).toBe(0)
    // clearing must PRESERVE those markers, otherwise the row would look unread again
    await clearMailboxToWatermark(stateRoot, TEAM, "captain", 500, { now: 1_000 })
    expect((await readUnreadMailbox(stateRoot, TEAM, "captain")).length).toBe(0)
    const record = (await readMailbox(stateRoot, TEAM, "captain")).find((entry) => entry.id === "ack-1")
    expect(record.tombstone).toBe(true)
    expect(typeof record.readAt).toBe("number")
    expect(typeof record.deliveredAt).toBe("number")
  } finally { cleanup() }
})

test("R1: the decision vocabulary is CLOSED — anything but approved|rejected is named loudly", async () => {
  const { stateRoot, cleanup } = fixture()
  try {
    await enqueueInterjection(stateRoot, TEAM, { id: "ij-v", from: "Lead", content: "c", ts: 1 })
    await expect(decideInterjection(stateRoot, TEAM, "ij-v", "maybe", { now: 2 })).rejects.toThrow(/invalid interjection decision "maybe"; allowed values are: approved, rejected/)
    // the refused decision did NOT mutate the record
    expect((await readPendingInterjections(stateRoot, TEAM)).map((r) => r.id)).toEqual(["ij-v"])
    // both allowed values work
    expect((await decideInterjection(stateRoot, TEAM, "ij-v", "rejected", { now: 3 })).status).toBe("rejected")
  } finally { cleanup() }
})

test("R1: an APPROVED interjection is re-posted as an ORDINARY message to the requester", async () => {
  const { stateRoot, cleanup } = fixture()
  try {
    await enqueueInterjection(stateRoot, TEAM, { id: "ij-ap", from: "Junior Engineer", content: "summary only", ts: 1 })
    await decideInterjection(stateRoot, TEAM, "ij-ap", "approved", { now: 2 })
    // the requester's own inbox now holds an ordinary (non-interjection) delivery, which
    // is what the existing member-prompt queue seam delivers at the next step boundary.
    const inbox = await readUnreadMailbox(stateRoot, TEAM, "Junior Engineer")
    expect(inbox.length).toBe(1)
    expect(inbox[0].kind).toBeUndefined()
    expect(inbox[0].content).toContain("Approved interjection")
    expect(inbox[0].content).toContain("summary only")
    // a REJECTED request posts nothing
    await enqueueInterjection(stateRoot, TEAM, { id: "ij-rj", from: "Lead", content: "no", ts: 1 })
    await decideInterjection(stateRoot, TEAM, "ij-rj", "rejected", { now: 3 })
    expect((await readUnreadMailbox(stateRoot, TEAM, "Lead")).length).toBe(0)
  } finally { cleanup() }
})

test("R1: expiry notifies the requesting member with an ordinary message", async () => {
  const { stateRoot, cleanup } = fixture()
  try {
    const ts = 9_000
    await enqueueInterjection(stateRoot, TEAM, { id: "ij-n", from: "Junior Engineer", content: "c", ts })
    await expireInterjections(stateRoot, TEAM, { now: ts + INTERJECTION_TTL_MS })
    const inbox = await readUnreadMailbox(stateRoot, TEAM, "Junior Engineer")
    expect(inbox.length).toBe(1)
    expect(inbox[0].kind).toBeUndefined()
    expect(inbox[0].content).toContain("EXPIRED")
    expect(inbox[0].content).toContain("denied by default")
  } finally { cleanup() }
})
