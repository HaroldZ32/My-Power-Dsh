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
