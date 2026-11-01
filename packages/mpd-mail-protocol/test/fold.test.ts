// The fold's contract (§4/§5/§7): legacy rows default to `message`, a reply inherits its `replyTo`'s
// thread, and NOTHING a torn or foreign log can contain is fatal. Every tolerance arm also asserts the
// observable result, so a green run means the fold kept the good rows instead of merely not throwing.

import { describe, expect, test } from "bun:test"

import { foldMail } from "../src/index.ts"
import type { MailQuestion } from "../src/index.ts"

/** One minimal legacy `send` row: no `kind`, no envelope fields, so the fold must default all of them. */
function sendRow(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    t: "send",
    id,
    fromId: "S1",
    fromName: "cell-planner",
    toId: "S2",
    toName: "deep-worker",
    subject: "subject " + id,
    body: "body " + id,
    at: "2026-10-31T00:00:00.000Z",
    ...extra,
  }
}

/** A valid question payload used by the payload arms. */
function question(): MailQuestion {
  return {
    questionId: "Q1",
    question: "Which approach should the cell take?",
    options: [{ label: "A. Unify the stores" }, { label: "B. Keep both stores" }],
  }
}

describe("legacy rows and the message default", () => {
  test("a row without `kind` folds as `message`, with itself as its thread", () => {
    /** The folded mailbox. */
    const folded = foldMail([sendRow("M1")])
    expect(folded.problems).toEqual([])
    expect(folded.messages).toHaveLength(1)
    /** The one folded message. */
    const message = folded.messages[0]
    expect(message.kind).toBe("message")
    expect(message.threadId).toBe("M1")
    expect(message.sentAt).toBe("2026-10-31T00:00:00.000Z")
    expect("replyTo" in message).toBe(false)
    expect("question" in message).toBe(false)
    expect("teamId" in message).toBe(false)
  })

  test("the team stamp and the addressing survive verbatim", () => {
    /** The folded row, stamped for a cell. */
    const folded = foldMail([sendRow("M1", { teamId: "cell-7" })])
    expect(folded.messages[0].teamId).toBe("cell-7")
    expect(folded.messages[0].fromName).toBe("cell-planner")
    expect(folded.messages[0].toName).toBe("deep-worker")
  })

  test("the field whitelist means an index field can never ride into a folded message", () => {
    /** A row carrying position-shaped fields beside the protocol fields. */
    const folded = foldMail([sendRow("M1", { index: 3, optionIndex: 1, extra: "ignored" })])
    expect("index" in folded.messages[0]).toBe(false)
    expect("optionIndex" in folded.messages[0]).toBe(false)
    expect("extra" in folded.messages[0]).toBe(false)
  })
})

describe("I7 — thread inheritance", () => {
  test("a reply inherits its replyTo's thread recursively, and an explicit ROOT id wins", () => {
    /** A question, its reply, the reply's reply, and one row naming the thread's folded root. */
    const folded = foldMail([
      sendRow("M1", { kind: "question", question: question() }),
      sendRow("M2", { replyTo: "M1" }),
      sendRow("M3", { replyTo: "M2" }),
      sendRow("M4", { threadId: "M1" }),
    ])
    expect(folded.problems).toEqual([])
    expect(folded.messages.map((message) => message.threadId)).toEqual(["M1", "M1", "M1", "M1"])
    expect(folded.messages[1].replyTo).toBe("M1")
  })

  test("an explicit threadId naming NO folded message is kept and REPORTED (F2 / amended I7)", () => {
    /** A row claiming a thread root that does not exist anywhere in the log. */
    const folded = foldMail([sendRow("M1", { threadId: "T9" })])
    expect(folded.messages[0].threadId).toBe("T9")
    expect(folded.problems).toHaveLength(1)
    expect(folded.problems[0]).toContain("threadId")
    expect(folded.problems[0]).toContain("names no folded message")
  })

  test("an explicit threadId equal to the row's own id is a legitimate thread root", () => {
    /** A first message declaring the thread it starts. */
    const folded = foldMail([sendRow("M1", { threadId: "M1" })])
    expect(folded.messages[0].threadId).toBe("M1")
    expect(folded.problems).toEqual([])
  })

  test("a replyTo naming no folded message re-roots on the reply's own id and is REPORTED (N1)", () => {
    /** A reply whose referenced message the log never carried. */
    const folded = foldMail([sendRow("M1"), sendRow("M2", { replyTo: "M-ghost" })])
    expect(folded.messages.map((message) => message.threadId)).toEqual(["M1", "M2"])
    expect(folded.problems).toHaveLength(1)
    expect(folded.problems[0]).toContain("replyTo")
    expect(folded.problems[0]).toContain("re-roots")
  })
})

describe("fold tolerance", () => {
  test("junk, torn rows, unknown record kinds and unknown state rows are skipped without a throw", () => {
    /** A log with every tolerated shape the unified file can meet. */
    const folded = foldMail([
      null,
      "not a record",
      42,
      { t: "wake", id: "W1", sent: false, reason: "no transport", at: "not-an-instant" },
      { t: "send" },
      sendRow("M1"),
      { t: "delivered", id: "M1", at: "2026-10-31T00:00:01.000Z" },
      { t: "read", id: "M1", by: "deep-worker", at: "2026-10-31T00:00:02.000Z" },
      { t: "read", id: "M9", by: "nobody", at: "2026-10-31T00:00:03.000Z" },
    ])
    expect(folded.messages.map((message) => message.id)).toEqual(["M1"])
    expect(folded.messages[0].deliveredAt).toBe("2026-10-31T00:00:01.000Z")
    expect(folded.messages[0].readAt).toBe("2026-10-31T00:00:02.000Z")
    expect(folded.messages[0].readBy).toBe("deep-worker")
    expect(folded.problems).toHaveLength(5)
  })

  test("an unknown kind folds as `message` and is reported", () => {
    /** One row whose kind is no protocol kind. */
    const folded = foldMail([sendRow("M1", { kind: "note" })])
    expect(folded.messages[0].kind).toBe("message")
    expect(folded.problems).toHaveLength(1)
    expect(folded.problems[0]).toContain("unknown kind")
  })

  test("matching payloads survive, and a payload of the wrong kind is dropped and reported", () => {
    /** A question, its answer, and a message row that wrongly carries a question payload. */
    const folded = foldMail([
      sendRow("M1", { kind: "question", question: question() }),
      sendRow("M2", {
        kind: "answer",
        replyTo: "M1",
        answer: { questionId: "Q1", answerTo: "M1", selected: ["A. Unify the stores"] },
      }),
      sendRow("M3", { question: question() }),
    ])
    expect(folded.messages[0].question?.options).toHaveLength(2)
    expect(folded.messages[1].answer?.selected).toEqual(["A. Unify the stores"])
    expect("question" in folded.messages[2]).toBe(false)
    expect(folded.problems).toHaveLength(1)
    expect(folded.problems[0]).toContain("question payload, dropped")
  })

  test("a duplicated message id keeps the FIRST write and reports the duplicate (N2 / amended I8)", () => {
    /** Two sends sharing an id, which an append-only writer should never emit. */
    const folded = foldMail([sendRow("M1"), sendRow("M2"), sendRow("M1", { body: "second write" })])
    expect(folded.messages.map((message) => message.id)).toEqual(["M1", "M2"])
    expect(folded.messages[0].body).toBe("body M1")
    expect(folded.problems).toHaveLength(1)
    expect(folded.problems[0]).toContain("duplicate `send` id")
    expect(folded.problems[0]).toContain("FIRST write wins")
  })
})
