// t49 — P1b arms: the AUTOMATIC, archive-first retention prune on the DELIVERY path. Each eligibility
// condition is armed independently, the sidecar and the markers are armed, and the EFFECT is measured
// on a seeded mailbox rather than argued.
import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
    acknowledgeMailbox, appendMailbox, clearMailboxToWatermark,
    MAILBOX_RETENTION_DEFAULT_MS, pruneMailboxRetention, readMailbox, readUnreadMailbox,
} from "../lib/state.js"

const TEAM = "t49-retention"
const STATE_DIR = join(".mpd", "team")
const DAY = 24 * 60 * 60 * 1000

function fixture() {
    const workspace = mkdtempSync(join(tmpdir(), "mpd-t49-"))
    const stateRoot = join(workspace, STATE_DIR)
    mkdirSync(join(stateRoot, TEAM, "inbox"), { recursive: true })
    return stateRoot
}
const record = (id, over = {}) => ({ id, from: "Engineer", to: "captain", content: `payload ${id}`, ts: 1_000_000, ...over })
const old = (id, over = {}) => record(id, { deliveredAt: 1_000_000, readAt: 1_000_001, ...over })

test("P1b: the three eligibility conditions, each armed on its own", async () => {
    const stateRoot = fixture()
    const now = 1_000_000 + 8 * DAY
    await appendMailbox(stateRoot, TEAM, "captain", old("stale-acked"))
    await appendMailbox(stateRoot, TEAM, "captain", record("never-read", { deliveredAt: 1_000_000 }))
    await appendMailbox(stateRoot, TEAM, "captain", old("leased", { deliveryClaimedAt: now - 1_000 }))
    await appendMailbox(stateRoot, TEAM, "captain", old("fresh", { deliveredAt: now - 60_000, readAt: now - 59_000 }))
    const result = await pruneMailboxRetention(stateRoot, TEAM, "captain", { retentionMs: MAILBOX_RETENTION_DEFAULT_MS, now })
    expect(result.pruned).toEqual(["stale-acked"])
    const after = await readMailbox(stateRoot, TEAM, "captain")
    const tombstoned = after.filter((entry) => entry.tombstone === true).map((entry) => entry.id)
    expect(tombstoned).toEqual(["stale-acked"])
    for (const id of ["never-read", "leased", "fresh"]) expect(after.find((entry) => entry.id === id)?.tombstone).toBeUndefined()
})

test("P1b: archive-first — the sidecar holds the bytes, and the tombstone keeps its markers", async () => {
    const stateRoot = fixture()
    const now = 1_000_000 + 8 * DAY
    await appendMailbox(stateRoot, TEAM, "captain", old("stale-acked", { dupCount: 3 }))
    const result = await pruneMailboxRetention(stateRoot, TEAM, "captain", { retentionMs: MAILBOX_RETENTION_DEFAULT_MS, now })
    const sidecar = readFileSync(result.sidecar, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line))
    expect(sidecar).toHaveLength(1)
    expect(sidecar[0]).toEqual(old("stale-acked", { dupCount: 3 }))
    const [tombstone] = await readMailbox(stateRoot, TEAM, "captain")
    expect(tombstone.id).toBe("stale-acked")
    expect(tombstone.ts).toBe(1_000_000)
    expect(tombstone.from).toBe("Engineer")
    expect(tombstone.to).toBe("captain")
    expect(tombstone.readAt).toBe(1_000_001)
    expect(tombstone.deliveredAt).toBe(1_000_000)
    expect(tombstone.dupCount).toBe(3)
    // it can never re-open as unread, and it is not deliverable again
    expect(await readUnreadMailbox(stateRoot, TEAM, "captain")).toHaveLength(0)
})

test("P1b: the knob — 0 disables the prune, a per-call window is honoured, and the ACK path runs it automatically", async () => {
    const stateRoot = fixture()
    const now = 1_000_000 + 8 * DAY
    await appendMailbox(stateRoot, TEAM, "captain", old("disabled"))
    const off = await pruneMailboxRetention(stateRoot, TEAM, "captain", { retentionMs: 0, now })
    expect(off.pruned).toEqual([])
    expect(off.disabled).toBe(true)
    expect((await readMailbox(stateRoot, TEAM, "captain")).length).toBe(1)
    // a quarter of a day of retention reclaims a record delivered 8 days ago
    const tight = await pruneMailboxRetention(stateRoot, TEAM, "captain", { retentionMs: DAY / 4, now })
    expect(tight.pruned).toEqual(["disabled"])
    // AUTOMATIC: the ack path itself prunes, with no explicit call
    const stateRoot2 = fixture()
    await appendMailbox(stateRoot2, TEAM, "captain", old("auto", { deliveredAt: Date.now() - 8 * DAY, readAt: Date.now() - 8 * DAY }))
    await acknowledgeMailbox(stateRoot2, TEAM, "captain", ["auto"], { retentionMs: MAILBOX_RETENTION_DEFAULT_MS })
    expect((await readMailbox(stateRoot2, TEAM, "captain")).find((entry) => entry.id === "auto")?.tombstone).toBe(true)
})

test("P1b: MEASURED before/after on a SEEDED mailbox, and the t43 clear guard still holds", async () => {
    const stateRoot = fixture()
    const now = 1_000_000 + 30 * DAY
    const seeded = []
    for (let index = 0; index < 40; index += 1)
        seeded.push(old(`stale-${index}`, { content: `x`.repeat(1024) }))
    for (let index = 0; index < 5; index += 1)
        seeded.push(record(`unread-${index}`, { deliveredAt: 1_000_000 }))
    for (const entry of seeded) await appendMailbox(stateRoot, TEAM, "captain", entry)
    const before = (await readMailbox(stateRoot, TEAM, "captain")).length
    const moment = new Date(now).toISOString()
    const result = await pruneMailboxRetention(stateRoot, TEAM, "captain", { retentionMs: MAILBOX_RETENTION_DEFAULT_MS, now, limit: 100 })
    const after = await readMailbox(stateRoot, TEAM, "captain")
    console.log(`[P1b] seeded ${before} records at ${moment} → pruned ${result.pruned.length}, tombstones ${after.filter((entry) => entry.tombstone === true).length}, live ${after.filter((entry) => entry.tombstone !== true).length}`)
    expect(result.pruned).toHaveLength(40)
    expect(after.length).toBe(before)
    expect(after.filter((entry) => entry.tombstone === true)).toHaveLength(40)
    expect(after.filter((entry) => entry.tombstone !== true).map((entry) => entry.id).sort()).toEqual(["unread-0", "unread-1", "unread-2", "unread-3", "unread-4"])
    // the captain's OWN tool keeps its t43 guard after the prune landed: unread records are protected
    const guarded = await clearMailboxToWatermark(stateRoot, TEAM, "captain", now, { now })
    expect(guarded.cleared).toEqual([])
    expect(guarded.skipped_unread.sort()).toEqual(["unread-0", "unread-1", "unread-2", "unread-3", "unread-4"])
})
