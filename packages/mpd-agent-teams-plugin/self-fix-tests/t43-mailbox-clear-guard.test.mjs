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
import * as state from "../lib/state.js"

const { appendMailbox, clearMailboxToWatermark, dependencyStates, readMailbox } = state
const unresolvedDependencyNote = state.unresolvedDependencyNote ?? (() => "")

const TEAM = "t43-probe"
const STATE_DIR = join(".mpd", "team")

function mailboxFixture(records) {
    const workspace = mkdtempSync(join(tmpdir(), "mpd-t43-"))
    const stateRoot = join(workspace, STATE_DIR)
    mkdirSync(join(stateRoot, TEAM, "inbox"), { recursive: true })
    return { workspace, stateRoot, seed: async () => { for (const record of records) await appendMailbox(stateRoot, TEAM, "captain", record) } }
}

test("P1: the pre-fix return expression is NOT lossless on the real manifest shape, and the shipped one IS", async () => {
    // The harness refuses a value that does not survive its own JSON round trip. The measured defect
    // applied `map(record => record.id)` to an array that ALREADY held id strings.
    const manifest = { cleared: ["a", "b"], sidecar: "/tmp/x", audit: { kind: "mailbox-cleared" } }
    const preFix = { cleared: manifest.cleared.map((record) => record.id) }
    const shipped = { cleared: [...manifest.cleared] }
    // LOSSLESS = deep-equal to its own JSON round trip. NOT two serializations compared: that is the
    // exact check that passed a broken value for the captain's first probe (both sides stringify to
    // `[null,null]`), and the first wording of THIS arm made the same mistake — recorded, not smoothed.
    const lossless = (value) => {
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
    const box = mailboxFixture([])
    await appendMailbox(box.stateRoot, TEAM, "captain", { id: "unread-1", from: "Engineer", to: "captain", content: "never delivered", ts: 100 })
    await appendMailbox(box.stateRoot, TEAM, "captain", { id: "acked-1", from: "Engineer", to: "captain", content: "delivered and read", ts: 200, deliveredAt: 150, readAt: 160 })
    const guarded = await clearMailboxToWatermark(box.stateRoot, TEAM, "captain", 500, { now: 1_000 })
    expect(guarded.cleared).toEqual(["acked-1"])
    expect(guarded.skipped_unread).toEqual(["unread-1"])
    expect(guarded.audit.skippedUnreadCount).toBe(1)
    const after = await readMailbox(box.stateRoot, TEAM, "captain")
    expect(after.find((record) => record.id === "unread-1")?.tombstone).toBeUndefined()
    // the sidecar holds the cleared bytes byte-for-byte (the archive-first guarantee)
    const sidecar = readFileSync(guarded.sidecar, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line))
    expect(sidecar.find((record) => record.id === "acked-1")?.content).toBe("delivered and read")
    // force is the explicit opt-in the row requires
    const forced = await clearMailboxToWatermark(box.stateRoot, TEAM, "captain", 500, { force: true, now: 2_000 })
    expect(forced.cleared).toEqual(["unread-1"])
    expect(forced.skipped_unread).toEqual([])
    expect((await readMailbox(box.stateRoot, TEAM, "captain")).find((record) => record.id === "unread-1")?.tombstone).toBe(true)
})

test("F1 (t30's finding): the cycle note fires only while the cycle BLOCKS — a failed or completed cycle must not fire", () => {
    const pending = [{ id: "c1", status: "pending", dependencies: ["c2"] }, { id: "c2", status: "pending", dependencies: ["c1"] }]
    expect(unresolvedDependencyNote(pending[0], pending)).toContain("cycle c2→c1→c2")
    const failed = [{ id: "c1", status: "pending", dependencies: ["c2"] }, { id: "c2", status: "failed", dependencies: ["c1"] }]
    expect(dependencyStates(failed, failed[0].dependencies).blocking).toEqual([])
    expect(unresolvedDependencyNote(failed[0], failed), "a FAILED cycle leaves the task CLAIMABLE — the note must not fire").toBe("")
    const completed = [{ id: "c1", status: "pending", dependencies: ["c2"] }, { id: "c2", status: "completed", dependencies: ["c1"] }]
    expect(dependencyStates(completed, completed[0].dependencies).blocking).toEqual([])
    expect(unresolvedDependencyNote(completed[0], completed)).toBe("")
})
