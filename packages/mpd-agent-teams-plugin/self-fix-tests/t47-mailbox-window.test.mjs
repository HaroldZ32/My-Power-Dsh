// t47 — P1e arms: the duplicate window is a CONFIGURED value with its own 30-minute default, not the
// borrowed 60 s delivery-lease constant, and 0 DISABLES the fold (proven here, not by a doc sentence).
import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { appendMailboxDeduped, MAILBOX_DEDUP_WINDOW_DEFAULT_MS, readMailbox } from "../lib/state.js"

const TEAM = "t47-window"
const fixture = () => {
    const workspace = mkdtempSync(join(tmpdir(), "mpd-t47-"))
    const stateRoot = join(workspace, ".mpd", "team")
    mkdirSync(join(stateRoot, TEAM, "inbox"), { recursive: true })
    return stateRoot
}
const message = (over = {}) => ({ id: "m1", from: "Engineer", to: "captain", content: "same payload", ts: 1_000_000, ...over })

test("P1e: the default window is 30 min, and a repeat at ~10 min FOLDS", async () => {
    const stateRoot = fixture()
    expect(MAILBOX_DEDUP_WINDOW_DEFAULT_MS).toBe(30 * 60 * 1000)
    await appendMailboxDeduped(stateRoot, TEAM, "captain", message({ id: "a", ts: 1_000_000 }))
    const ten = await appendMailboxDeduped(stateRoot, TEAM, "captain", message({ id: "b", ts: 1_000_000 + 600_000 }))
    expect(ten.folded).toBe(true)
    expect(ten.message.dupCount).toBe(2)
    expect((await readMailbox(stateRoot, TEAM, "captain")).length).toBe(1)
})

test("P1e: a configured window of 0 folds NOTHING — the disabled value, proven by an arm", async () => {
    const stateRoot = fixture()
    await appendMailboxDeduped(stateRoot, TEAM, "captain", message({ id: "a", ts: 1_000_000 }), { windowMs: 0 })
    const same = await appendMailboxDeduped(stateRoot, TEAM, "captain", message({ id: "b", ts: 1_000_000 }), { windowMs: 0 })
    expect(same.folded).toBe(false)
    expect((await readMailbox(stateRoot, TEAM, "captain")).length).toBe(2)
})

test("P1e: genuinely different content NEVER folds, whatever the window", async () => {
    const stateRoot = fixture()
    await appendMailboxDeduped(stateRoot, TEAM, "captain", message({ id: "a", ts: 1_000_000 }))
    const other = await appendMailboxDeduped(stateRoot, TEAM, "captain", message({ id: "b", ts: 1_000_001, content: "a genuinely different payload" }))
    expect(other.folded).toBe(false)
    expect((await readMailbox(stateRoot, TEAM, "captain")).length).toBe(2)
})
