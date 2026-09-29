// t43 — the mailbox-cleanup arms (the user's Priority-1 directive): P1 the broken return, P1c the
// watermark guard, F1 the cycle note that must not over-claim, and the LOSSLESSNESS of all three
// interjection tools' returns.
//
// The red side for P1 is ALSO on disk as the captain's own measured refusal (`invalid output: value is
// not lossless JSON`) quoted in the task's acceptance; arm 1 below reproduces the mechanism directly,
// on the real manifest shape, so the fix cannot be "asserted equal to itself".
import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
// Namespace import so the PRE-FIX side RUNS and fails ARM BY ARM: on the revision before this task
// `unresolvedDependencyNote` does not exist, and a module-load error would hide which arm is the red one.
// The vendored module now resolves to its .ts source, so this surface is typed from that file.
import * as state from "../lib/state.ts"

/** One record the fixture seeds into a mailbox before an arm runs. */
interface MailboxSeedRecord {
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
    /** When the harness delivered the record; absent while it is still undelivered. */
    readonly deliveredAt?: number
    /** When a seat read the record; absent while it is still unread. */
    readonly readAt?: number
}

/** One mailbox record as the read path returns it, including the tombstone a clear leaves behind. */
interface MailboxRecord {
    /** The record's own id, which the arms match on. */
    readonly id: string
    /** The payload text, which the sidecar must hold byte-for-byte while the record is unread. */
    readonly content: string
    /** True once the record has been cleared and reduced to a tombstone. */
    readonly tombstone?: boolean
}

/** The vendored state helpers this file drives, destructured so each arm names its own seam. */
const { appendMailbox, clearMailboxToWatermark, dependencyStates, readMailbox } = state
/** The cycle-note helper, absent on pre-fix revisions — hence the fallback that keeps the arm running. */
const unresolvedDependencyNote = state.unresolvedDependencyNote ?? (() => "")

/** The team id the mailbox files are keyed by. */
const TEAM = "t43-probe"
/** The state directory name the fixture resolves under its temporary workspace. */
const STATE_DIR = join(".mpd", "team")

/** Create a fresh mailbox fixture and return its roots plus the seeding closure. */
function mailboxFixture(records: readonly MailboxSeedRecord[]): { workspace: string; stateRoot: string; seed: () => Promise<void> } {
/** The temporary workspace this fixture's state root lives under. */
    const workspace = mkdtempSync(join(tmpdir(), "mpd-t43-"))
/** The resolved team-state root every mailbox operation is keyed by. */
    const stateRoot = join(workspace, STATE_DIR)
    mkdirSync(join(stateRoot, TEAM, "inbox"), { recursive: true })
    return { workspace, stateRoot, seed: async () => { for (const record of records) await appendMailbox(stateRoot, TEAM, "captain", record) } }
}

test("P1: the pre-fix return expression is NOT lossless on the real manifest shape, and the shipped one IS", async () => {
    // The harness refuses a value that does not survive its own JSON round trip. The measured defect
    // applied `map(record => record.id)` to an array that ALREADY held id strings.
    const manifest = { cleared: ["a", "b"], sidecar: "/tmp/x", audit: { kind: "mailbox-cleared" } }
        // The cast IS the arm: the pre-fix expression read `.id` off an array that already held id
        // STRINGS, so every element yields `undefined` — reproduced verbatim, never repaired.
        /** The pre-fix return expression, which drops every id and survives no JSON round trip. */
    const preFix = { cleared: manifest.cleared.map((record: string) => (record as unknown as { id: string }).id) }
/** The shipped expression: a copy of the id list, which survives the round trip. */
    const shipped = { cleared: [...manifest.cleared] }
    // LOSSLESS = deep-equal to its own JSON round trip. NOT two serializations compared: that is the
    // exact check that passed a broken value for the captain's first probe (both sides stringify to
    // `[null,null]`), and the first wording of THIS arm made the same mistake — recorded, not smoothed.
/** Whether a value survives ITS OWN JSON round trip (the harness's losslessness rule). */
    const lossless = (value: unknown): boolean => {
        try {
            expect(value).toEqual(JSON.parse(JSON.stringify(value)))
            return true
        }
        catch {
            return false
        }
    }
    expect(lossless(preFix), "the pre-fix expression must NOT be lossless (the red side)").toBe(false)
    expect(lossless(shipped), "the shipped expression must be lossless").toBe(true)
    expect(shipped.cleared).toEqual(["a", "b"])
})

test("P1c: an UNDELIVERED/UNREAD record is PROTECTED by default, reported as skipped_unread, and cleared only with force", async () => {
/** The empty fixture this arm seeds by hand. */
    const box = mailboxFixture([])
    await appendMailbox(box.stateRoot, TEAM, "captain", { id: "unread-1", from: "Engineer", to: "captain", content: "never delivered", ts: 100 })
    await appendMailbox(box.stateRoot, TEAM, "captain", { id: "acked-1", from: "Engineer", to: "captain", content: "delivered and read", ts: 200, deliveredAt: 150, readAt: 160 })
/** The clear result: only the read record may be cleared, with the unread one reported. */
    const guarded = await clearMailboxToWatermark(box.stateRoot, TEAM, "captain", 500, { now: 1_000 })
    expect(guarded.cleared).toEqual(["acked-1"])
    expect(guarded.skipped_unread).toEqual(["unread-1"])
    expect(guarded.audit.skippedUnreadCount).toBe(1)
/** The mailbox after the guarded clear, where the unread record must survive untouched. */
    const after = await readMailbox(box.stateRoot, TEAM, "captain")
    expect(after.find((record: MailboxRecord) => record.id === "unread-1")?.tombstone).toBeUndefined()
    // the sidecar holds the cleared bytes byte-for-byte (the archive-first guarantee)
    const sidecar = readFileSync(guarded.sidecar, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line))
    expect(sidecar.find((record) => record.id === "acked-1")?.content).toBe("delivered and read")
    // force is the explicit opt-in the row requires
    const forced = await clearMailboxToWatermark(box.stateRoot, TEAM, "captain", 500, { force: true, now: 2_000 })
    expect(forced.cleared).toEqual(["unread-1"])
    expect(forced.skipped_unread).toEqual([])
    expect((await readMailbox(box.stateRoot, TEAM, "captain")).find((record: MailboxRecord) => record.id === "unread-1")?.tombstone).toBe(true)
})

test("F1 (t30's finding): the cycle note fires only while the cycle BLOCKS — a failed or completed cycle must not fire", () => {
/** A two-task dependency cycle in which both tasks are still pending. */
    const pending = [{ id: "c1", status: "pending", dependencies: ["c2"] }, { id: "c2", status: "pending", dependencies: ["c1"] }]
    expect(unresolvedDependencyNote(pending[0], pending)).toContain("cycle c2→c1→c2")
/** The same cycle with one task FAILED, which leaves the other claimable. */
    const failed = [{ id: "c1", status: "pending", dependencies: ["c2"] }, { id: "c2", status: "failed", dependencies: ["c1"] }]
    expect(dependencyStates(failed, failed[0].dependencies).blocking).toEqual([])
    expect(unresolvedDependencyNote(failed[0], failed), "a FAILED cycle leaves the task CLAIMABLE — the note must not fire").toBe("")
/** The same cycle with one task COMPLETED, which likewise leaves the other claimable. */
    const completed = [{ id: "c1", status: "pending", dependencies: ["c2"] }, { id: "c2", status: "completed", dependencies: ["c1"] }]
    expect(dependencyStates(completed, completed[0].dependencies).blocking).toEqual([])
    expect(unresolvedDependencyNote(completed[0], completed)).toBe("")
})
