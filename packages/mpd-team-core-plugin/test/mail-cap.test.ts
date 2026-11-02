// W4-A6b — the mailbox caps what it RENDERS and bounds what it STORES.
//
// WHY THESE ARMS EXIST: a mailbox answer is fed back into a model's context, so one 200 KB body or one
// 200-row inbox costs a whole window. The cap is applied at the WRITE (the body) and at the READ (the
// page), and neither is allowed to be silent: a cut body carries `truncated` + `originalLength`, and a
// paged answer carries `more` + `nextOffset`. The rows behind a page are NOT acknowledged by it.
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { MAIL_BODY_MAX, mailboxPath, pageOf, readMailbox, send, truncateMailBody, unreadOf, type SendInput } from "../src/mailbox-store"

/** Per-test workspace holding the mailbox log. */
let box = ""
/** The frozen clock every row is stamped with. */
const NOW = new Date("2026-11-02T10:00:00.000Z")
/** The live roster every send is validated against. */
const ROSTER = ["lead", "senior", "researcher"]

beforeEach(() => { box = mkdtempSync(join(tmpdir(), "mpd-mail-cap-")) })
afterEach(() => { rmSync(box, { recursive: true, force: true }) })

/** A well-formed send input; the backlog bound is DISABLED so an arm can seed as many rows as it needs. */
const msg = (over: Partial<SendInput> = {}): SendInput => ({
  fromId: "lead", fromName: "lead", toId: "senior", toName: "senior",
  subject: "s", body: "b", memberIds: ROSTER, maxUndelivered: 0, ...over,
})

describe("rendering cap (W4-A6b)", () => {
  test("a 25-row inbox pages 20 + more:5, and the next page carries the other 5", () => {
    for (let index = 0; index < 25; index += 1) expect(send(box, msg({ subject: "row " + index }), NOW).ok).toBe(true)
    /** Every unread row for this recipient, before paging. */
    const rows = unreadOf(readMailbox(box), "senior")
    expect(rows).toHaveLength(25)
    /** The first page: the default 20, with the receipt that says five remain. */
    const first = pageOf(rows)
    expect(first.page).toHaveLength(20)
    expect(first.more).toBe(5)
    expect(first.nextOffset).toBe(20)
    // The rows are still UNREAD: paging is a read view, never an acknowledgement.
    expect(unreadOf(readMailbox(box), "senior")).toHaveLength(25)
    /** The second page, fetched with the pointer the first answer carried. */
    const second = pageOf(rows, first.limit, first.nextOffset ?? 0)
    expect(second.page).toHaveLength(5)
    expect(second.more).toBe(0)
    expect(second.nextOffset).toBeNull()
    expect(second.page[0].subject).toBe("row 20")
  })

  test("the page bounds are clamped, and a non-numeric limit falls back to 20", () => {
    /** A row set large enough to see the clamp. */
    const rows = Array.from({ length: 150 }, (_value, index) => index)
    expect(pageOf(rows, 0).page).toHaveLength(1)
    expect(pageOf(rows, 1000).page).toHaveLength(100)
    expect(pageOf(rows, Number.NaN).page).toHaveLength(20)
    expect(pageOf(rows, 20, -5).offset).toBe(0)
  })
})

describe("input cap (W4-A6b)", () => {
  test("a 5,000-char body is stored truncated, flagged, with its original length", () => {
    /** The oversized body, one distinctive character so the stored text is checkable. */
    const body = "x".repeat(5000)
    /** The send verdict. */
    const result = send(box, msg({ body }), NOW)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.message.truncated).toBe(true)
    expect(result.message.originalLength).toBe(5000)
    expect(result.message.body).toHaveLength(MAIL_BODY_MAX)
    /** The row folded back from disk, which must carry the same two facts. */
    const stored = readMailbox(box).messages[0]
    expect(stored.truncated).toBe(true)
    expect(stored.originalLength).toBe(5000)
    expect(stored.body).toHaveLength(MAIL_BODY_MAX)
    // THE PRE-CUT TEXT IS NOT KEPT: the bound exists for the reader, so a side copy would defeat it.
    expect(readFileSync(mailboxPath(box), "utf8")).not.toContain("x".repeat(MAIL_BODY_MAX + 1))
  })

  test("the boundary is exact: 4,000 chars pass untouched, 4,001 are cut", () => {
    expect(truncateMailBody("y".repeat(MAIL_BODY_MAX))).toEqual({ body: "y".repeat(MAIL_BODY_MAX), truncated: false, originalLength: MAIL_BODY_MAX })
    /** One character past the bound. */
    const over = truncateMailBody("y".repeat(MAIL_BODY_MAX + 1))
    expect(over.truncated).toBe(true)
    expect(over.originalLength).toBe(MAIL_BODY_MAX + 1)
    expect(over.body).toHaveLength(MAIL_BODY_MAX)
    /** An ordinary body carries no flag at all, so a normal row is unchanged. */
    expect(send(box, msg({ body: "short" }), NOW)).toMatchObject({ ok: true, message: { body: "short" } })
  })
})
