// REVIEW PROBES (R1 — T5). Black-box exercises of the frozen contract's §4 rules that the shipped
// suites do NOT assert. Each probe prints the observed value so the verdict cites behaviour, not a
// reading of the source. Read-only: imports the package under review and never edits it.

import {
  findIndexFields,
  foldMail,
  validateAnswer,
  validateEnvelope,
  validateQuestion,
  validateReferences,
} from "../../../../packages/mpd-mail-protocol/src/index.ts"

/** A valid single-select question. */
const singleQuestion = {
  questionId: "Q1",
  question: "Which approach?",
  options: [{ label: "A. Unify the stores" }, { label: "B. Keep both stores" }],
}

/** One folded question message as the mailbox would carry it. */
const questionMessage = {
  id: "M1",
  kind: "question" as const,
  fromId: "S1",
  fromName: "asker",
  toId: "S2",
  toName: "answerer",
  subject: "s",
  body: "b",
  sentAt: "2026-10-31T00:00:00.000Z",
  threadId: "M1",
  question: singleQuestion,
}

/** A minimal legacy send row. */
function sendRow(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    t: "send",
    id,
    fromId: "S1",
    fromName: "asker",
    toId: "S2",
    toName: "answerer",
    subject: "s",
    body: "b",
    at: "2026-10-31T00:00:00.000Z",
    ...extra,
  }
}

/** Print one probe's label and observed JSON value. */
function show(label: string, value: unknown): void {
  console.log("[probe] " + label + " => " + JSON.stringify(value))
}

// P1 — I5 corollary: does an answer whose stated questionId disagrees with the referenced question pass?
show(
  "P1 answer.questionId mismatch vs referenced question",
  validateReferences(
    { kind: "answer", answer: { questionId: "Q-OTHER", answerTo: "M1", selected: ["A. Unify the stores"] } },
    [questionMessage],
  ),
)

// P1b — the same answer with an EMPTY questionId.
show(
  "P1b answer.questionId empty string",
  validateReferences(
    { kind: "answer", answer: { questionId: "", answerTo: "M1", selected: ["A. Unify the stores"] } },
    [questionMessage],
  ),
)

// P2 — I7: an explicit threadId that names no message, and an unresolvable replyTo.
const t9 = foldMail([sendRow("M1", { threadId: "T9" })])
show("P2 explicit threadId naming no message", { threadId: t9.messages[0]?.threadId, problems: t9.problems })
const ghost = foldMail([sendRow("M1"), sendRow("M2", { replyTo: "M-ghost" })])
show("P2b replyTo naming no message", {
  threads: ghost.messages.map((m) => m.threadId),
  problems: ghost.problems,
})

// P3 — I3: a single-select answer carrying one label AND custom text.
show(
  "P3 single-select label + custom",
  validateAnswer(
    { questionId: "Q1", answerTo: "M1", selected: ["A. Unify the stores"], custom: "but only partly" },
    singleQuestion,
  ),
)

// P4 — an answer with no selection at all, validated without the question (the envelope pre-flight path).
show("P4 envelope: empty selected, no question resolved", validateEnvelope({ kind: "answer", answer: { questionId: "Q1", answerTo: "M1", selected: [] } }))

// P5 — I2: a question whose questionId / question text are empty.
show(
  "P5 questionId empty accepted?",
  validateQuestion({ questionId: "", question: "Which?", options: [{ label: "A. One" }] }),
)

// P6 — I1: positional field names outside the enumerated list.
const positional = { kind: "answer", answer: { questionId: "Q1", answerTo: "M1", selected: ["A. One"], position: 0, choice: 1, optionPosition: 2, idx: 3 } }
show("P6 findIndexFields(position/choice/optionPosition/idx)", findIndexFields(positional))

// P7 — a duplicated send id: which content wins, and is it reported?
const dup = foldMail([sendRow("M1", { body: "first" }), sendRow("M1", { body: "second" })])
show("P7 duplicate send id", { body: dup.messages[0]?.body, problems: dup.problems })

// P8 — the early return in validateAnswer when `selected` is not an array.
show(
  "P8 non-array selected with empty answerTo",
  validateAnswer({ questionId: "Q1", answerTo: "", selected: "A. One" } as unknown as Parameters<typeof validateAnswer>[0], singleQuestion),
)
