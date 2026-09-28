// t47 — P1e arms: the duplicate window is a CONFIGURED value with its own 30-minute default, not the
// borrowed 60 s delivery-lease constant, and 0 DISABLES the fold (proven here, not by a doc sentence).
import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
// The vendored `lib/*.js` modules this file drives are adopted upstream JavaScript: they ship no
// declaration file that describes the DELTA-PATCHED tree (the mpd deltas add exported functions and
// record fields the upstream `lib/types/*.d.ts` do not know about), and that tree is outside this
// lane's write scope. Each import below therefore carries `@ts-expect-error` with its reason, which
// is self-retiring: the day a declaration covers the module, the directive becomes a loud unused
// directive instead of a silent suppression. Every shape this file relies on is declared at its own
// use site.
// @ts-expect-error TS7016: the vendored JS module has no declaration file (see the note above).
import { appendMailboxDeduped, MAILBOX_DEDUP_WINDOW_DEFAULT_MS, readMailbox } from "../lib/state.js"

/** The overridable fields of one mailbox message fixture. */
interface MessageOverrides {
    /** Overrides the fixture's record id, so a folded and a fresh send stay distinguishable. */
    readonly id?: string
    /** Overrides the fixture's send instant in epoch ms, which is what the dedup window compares. */
    readonly ts?: number
    /** Overrides the fixture's payload text, so a genuinely different send can be built. */
    readonly content?: string
}

/** One mailbox message in the shape the dedup and read paths consume. */
interface ProbeMessage {
    /** The record's own id. */
    readonly id: string
    /** The sending seat's name. */
    readonly from: string
    /** The receiving seat's mailbox key. */
    readonly to: string
    /** The payload text the dedup window compares. */
    readonly content: string
    /** The send instant in epoch milliseconds. */
    readonly ts: number
}

/** The team id the mailbox files are keyed by. */
const TEAM = "t47-window"
/** Create a fresh state root whose inbox directory exists, and return it. */
const fixture = (): string => {
/** The temporary workspace the mailbox lives under. */
    const workspace = mkdtempSync(join(tmpdir(), "mpd-t47-"))
/** The resolved team-state root the mailbox operations are keyed by. */
    const stateRoot = join(workspace, ".mpd", "team")
    mkdirSync(join(stateRoot, TEAM, "inbox"), { recursive: true })
    return stateRoot
}
/** Build one send, with only the fields an arm needs to vary overridden. */
const message = (over: MessageOverrides = {}): ProbeMessage => ({ id: "m1", from: "Engineer", to: "captain", content: "same payload", ts: 1_000_000, ...over })

test("P1e: the default window is 30 min, and a repeat at ~10 min FOLDS", async () => {
/** This arm's own state root, so the three arms never share a mailbox. */
    const stateRoot = fixture()
    expect(MAILBOX_DEDUP_WINDOW_DEFAULT_MS).toBe(30 * 60 * 1000)
    await appendMailboxDeduped(stateRoot, TEAM, "captain", message({ id: "a", ts: 1_000_000 }))
/** The second send at +10 min, which the default 30-minute window must FOLD. */
    const ten = await appendMailboxDeduped(stateRoot, TEAM, "captain", message({ id: "b", ts: 1_000_000 + 600_000 }))
    expect(ten.folded).toBe(true)
    expect(ten.message.dupCount).toBe(2)
    expect((await readMailbox(stateRoot, TEAM, "captain")).length).toBe(1)
})

test("P1e: a configured window of 0 folds NOTHING — the disabled value, proven by an arm", async () => {
/** This arm's own state root, so the disabled-window arm starts empty. */
    const stateRoot = fixture()
    await appendMailboxDeduped(stateRoot, TEAM, "captain", message({ id: "a", ts: 1_000_000 }), { windowMs: 0 })
/** The repeat under a window of 0, which must be stored as its own record. */
    const same = await appendMailboxDeduped(stateRoot, TEAM, "captain", message({ id: "b", ts: 1_000_000 }), { windowMs: 0 })
    expect(same.folded).toBe(false)
    expect((await readMailbox(stateRoot, TEAM, "captain")).length).toBe(2)
})

test("P1e: genuinely different content NEVER folds, whatever the window", async () => {
/** This arm's own state root, so the differing-payload arm starts empty. */
    const stateRoot = fixture()
    await appendMailboxDeduped(stateRoot, TEAM, "captain", message({ id: "a", ts: 1_000_000 }))
/** The send whose payload differs, which no window may ever fold. */
    const other = await appendMailboxDeduped(stateRoot, TEAM, "captain", message({ id: "b", ts: 1_000_001, content: "a genuinely different payload" }))
    expect(other.folded).toBe(false)
    expect((await readMailbox(stateRoot, TEAM, "captain")).length).toBe(2)
})
