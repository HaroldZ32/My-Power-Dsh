// t49 — P1b arms: the AUTOMATIC, archive-first retention prune on the DELIVERY path. Each eligibility
// condition is armed independently, the sidecar and the markers are armed, and the EFFECT is measured
// on a seeded mailbox rather than argued.
import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
// The vendored `lib/*.js` modules this file drives are adopted upstream JavaScript: they ship no
// declaration file that describes the DELTA-PATCHED tree (the mpd deltas add exported functions and
// record fields the upstream `lib/types/*.d.ts` do not know about), and that tree is outside this
// lane's write scope. Each import below therefore carries `@ts-expect-error` with its reason, which
// is self-retiring: the day a declaration covers the module, the directive becomes a loud unused
// directive instead of a silent suppression. Every shape this file relies on is declared at its own
// use site.
import {
    acknowledgeMailbox, appendMailbox, clearMailboxToWatermark,
    MAILBOX_RETENTION_DEFAULT_MS, pruneMailboxRetention, readMailbox, readUnreadMailbox,
// @ts-expect-error TS7016: the vendored JS module has no declaration file (see the note above).
} from "../lib/state.js"

/** The overridable fields of one seeded record. */
interface MessageOverrides {
    /** Overrides the payload text. */
    readonly content?: string
    /** Overrides the delivery instant, which sets the record's retention age. */
    readonly deliveredAt?: number
    /** Overrides the read instant; an unread record is protected from the prune. */
    readonly readAt?: number
    /** Overrides the delivery-lease instant, which suspends pruning while it is held. */
    readonly deliveryClaimedAt?: number
    /** Overrides how many identical sends the record stands for. */
    readonly dupCount?: number
}

/** One seeded mailbox record, in the shape the delivery and prune paths read. */
interface ProbeMessage {
    /** The record's own id. */
    readonly id: string
    /** The sending seat's name. */
    readonly from: string
    /** The receiving mailbox key. */
    readonly to: string
    /** The payload text. */
    readonly content: string
    /** The send instant in epoch milliseconds. */
    readonly ts: number
    /** When the harness delivered the record; drives the retention age. */
    readonly deliveredAt?: number
    /** When a seat read the record; an unread record is protected from the prune. */
    readonly readAt?: number
    /** When the delivery lease was claimed, which suspends pruning while it is held. */
    readonly deliveryClaimedAt?: number
    /** How many identical sends the record stands for. */
    readonly dupCount?: number
}

/** One mailbox record as the read path returns it, including the tombstone a prune leaves behind. */
interface MailboxRecord {
    /** The record's own id. */
    readonly id: string
    /** True once the record has been pruned down to a marker. */
    readonly tombstone?: boolean
}

/** The team id the mailbox files are keyed by. */
const TEAM = "t49-retention"
/** The state directory name the fixture resolves under its temporary workspace. */
const STATE_DIR = join(".mpd", "team")
/** One day in milliseconds, the unit the retention windows are expressed in. */
const DAY = 24 * 60 * 60 * 1000

/** Create a fresh state root with an inbox directory and return it. */
function fixture(): string {
/** The temporary workspace this fixture's state root lives under. */
    const workspace = mkdtempSync(join(tmpdir(), "mpd-t49-"))
/** The resolved team-state root every mailbox operation is keyed by. */
    const stateRoot = join(workspace, STATE_DIR)
    mkdirSync(join(stateRoot, TEAM, "inbox"), { recursive: true })
    return stateRoot
}
/** Build one record over the fixture's defaults; only the fields an arm varies are overridden. */
const record = (id: string, over: MessageOverrides = {}): ProbeMessage => ({ id, from: "Engineer", to: "captain", content: `payload ${id}`, ts: 1_000_000, ...over })
/** Build a record that was delivered and READ at the base instant, so age is the only variable. */
const old = (id: string, over: MessageOverrides = {}): ProbeMessage => record(id, { deliveredAt: 1_000_000, readAt: 1_000_001, ...over })

test("P1b: the three eligibility conditions, each armed on its own", async () => {
/** This arm's own state root, so no arm shares a mailbox with another. */
    const stateRoot = fixture()
/** The retention instant, eight days after the records were sent. */
    const now = 1_000_000 + 8 * DAY
    await appendMailbox(stateRoot, TEAM, "captain", old("stale-acked"))
    await appendMailbox(stateRoot, TEAM, "captain", record("never-read", { deliveredAt: 1_000_000 }))
    await appendMailbox(stateRoot, TEAM, "captain", old("leased", { deliveryClaimedAt: now - 1_000 }))
    await appendMailbox(stateRoot, TEAM, "captain", old("fresh", { deliveredAt: now - 60_000, readAt: now - 59_000 }))
/** The prune's report, which must name only the stale, acknowledged record. */
    const result = await pruneMailboxRetention(stateRoot, TEAM, "captain", { retentionMs: MAILBOX_RETENTION_DEFAULT_MS, now })
    expect(result.pruned).toEqual(["stale-acked"])
/** The mailbox after the prune. */
    const after = await readMailbox(stateRoot, TEAM, "captain")
/** The ids of the records the prune reduced to tombstones. */
    const tombstoned = after.filter((entry: MailboxRecord) => entry.tombstone === true).map((entry: MailboxRecord) => entry.id)
    expect(tombstoned).toEqual(["stale-acked"])
    for (const id of ["never-read", "leased", "fresh"]) expect(after.find((entry: MailboxRecord) => entry.id === id)?.tombstone).toBeUndefined()
})

test("P1b: archive-first — the sidecar holds the bytes, and the tombstone keeps its markers", async () => {
/** This arm's own state root. */
    const stateRoot = fixture()
/** The retention instant, eight days after the record was sent. */
    const now = 1_000_000 + 8 * DAY
    await appendMailbox(stateRoot, TEAM, "captain", old("stale-acked", { dupCount: 3 }))
/** The prune's report, which carries the sidecar path holding the archived bytes. */
    const result = await pruneMailboxRetention(stateRoot, TEAM, "captain", { retentionMs: MAILBOX_RETENTION_DEFAULT_MS, now })
/** The archived records, decoded line by line out of the sidecar. */
    const sidecar = readFileSync(result.sidecar, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line))
    expect(sidecar).toHaveLength(1)
    expect(sidecar[0]).toEqual(old("stale-acked", { dupCount: 3 }))
/** The single tombstone the mailbox is reduced to. */
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
/** This arm's own state root. */
    const stateRoot = fixture()
/** The retention instant, eight days after the record was sent. */
    const now = 1_000_000 + 8 * DAY
    await appendMailbox(stateRoot, TEAM, "captain", old("disabled"))
/** The prune under a retention of 0, which must disable itself rather than prune. */
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
    expect((await readMailbox(stateRoot2, TEAM, "captain")).find((entry: MailboxRecord) => entry.id === "auto")?.tombstone).toBe(true)
})

test("P1b: MEASURED before/after on a SEEDED mailbox, and the t43 clear guard still holds", async () => {
/** This arm's own state root for the seeded measurement. */
    const stateRoot = fixture()
/** The retention instant, thirty days after the records were sent. */
    const now = 1_000_000 + 30 * DAY
/** The records seeded into the mailbox before the measurement. */
    const seeded: ProbeMessage[] = []
    for (let index = 0; index < 40; index += 1)
        seeded.push(old(`stale-${index}`, { content: `x`.repeat(1024) }))
    for (let index = 0; index < 5; index += 1)
        seeded.push(record(`unread-${index}`, { deliveredAt: 1_000_000 }))
    for (const entry of seeded) await appendMailbox(stateRoot, TEAM, "captain", entry)
/** How many records the mailbox held before the prune. */
    const before = (await readMailbox(stateRoot, TEAM, "captain")).length
/** The measurement instant, stamped so the log line names when it was read. */
    const moment = new Date(now).toISOString()
/** The prune's report over the seeded mailbox. */
    const result = await pruneMailboxRetention(stateRoot, TEAM, "captain", { retentionMs: MAILBOX_RETENTION_DEFAULT_MS, now, limit: 100 })
/** The mailbox after the prune, whose byte count must be unchanged. */
    const after = await readMailbox(stateRoot, TEAM, "captain")
    console.log(`[P1b] seeded ${before} records at ${moment} → pruned ${result.pruned.length}, tombstones ${after.filter((entry: MailboxRecord) => entry.tombstone === true).length}, live ${after.filter((entry: MailboxRecord) => entry.tombstone !== true).length}`)
    expect(result.pruned).toHaveLength(40)
    expect(after.length).toBe(before)
    expect(after.filter((entry: MailboxRecord) => entry.tombstone === true)).toHaveLength(40)
    expect(after.filter((entry: MailboxRecord) => entry.tombstone !== true).map((entry: MailboxRecord) => entry.id).sort()).toEqual(["unread-0", "unread-1", "unread-2", "unread-3", "unread-4"])
    // the captain's OWN tool keeps its t43 guard after the prune landed: unread records are protected
    const guarded = await clearMailboxToWatermark(stateRoot, TEAM, "captain", now, { now })
    expect(guarded.cleared).toEqual([])
    expect(guarded.skipped_unread.sort()).toEqual(["unread-0", "unread-1", "unread-2", "unread-3", "unread-4"])
})
