// RE-REVIEW PROBES (R1 re-review — T12 / T11). Falsify the repair's claims against the AMENDED
// contract §4 (I1–I8). Black-box: imports the package under review; never edits it.

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

/** The same question as multi-select. */
const multiQuestion = { ...singleQuestion, multiSelect: true }

/** One folded question message. */
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

/** A folded question row whose payload was lost (the fold reports it, then carries the row). */
const payloadlessQuestionMessage = {
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

/** Codes of a validator refusal, or the word ok. */
function codes(result: { ok: true } | { ok: false; problems: { code: string }[] }): unknown {
  return result.ok ? "ok" : result.problems.map((entry) => entry.code)
}

// F1 / amended I5 — the correlation key.
show("P1 answer.questionId mismatch", codes(validateReferences({ kind: "answer", answer: { questionId: "Q-OTHER", answerTo: "M1", selected: ["A. Unify the stores"] } }, [questionMessage])))
show("P1b answer.questionId empty", codes(validateReferences({ kind: "answer", answer: { questionId: "", answerTo: "M1", selected: ["A. Unify the stores"] } }, [questionMessage])))
show("P1c question.questionId empty", codes(validateQuestion({ ...singleQuestion, questionId: "" })))
show("P1d answer.questionId matches", codes(validateReferences({ kind: "answer", answer: { questionId: "Q1", answerTo: "M1", selected: ["A. Unify the stores"] } }, [questionMessage])))
show("P1e empty answer questionId at envelope pre-flight", codes(validateEnvelope({ kind: "answer", answer: { questionId: "", answerTo: "M1", selected: ["A. Unify the stores"] } })))

// F2 / amended I7 + I8 — thread identity and reporting.
const t9 = foldMail([sendRow("M1", { threadId: "T9" })])
show("P2 explicit threadId naming no message", { threadId: t9.messages[0]?.threadId, problems: t9.problems })
const own = foldMail([sendRow("M1", { threadId: "M1" })])
show("P2a explicit threadId = own id", { threadId: own.messages[0]?.threadId, problems: own.problems })
const ghost = foldMail([sendRow("M1"), sendRow("M2", { replyTo: "M-ghost" })])
show("P2b replyTo naming no message", { threads: ghost.messages.map((m) => m.threadId), problems: ghost.problems })
const root = foldMail([sendRow("M1"), sendRow("M2", { threadId: "M1" })])
show("P2c explicit threadId = folded root", { threads: root.messages.map((m) => m.threadId), problems: root.problems })

// N5 / amended I3 — single vs multi with custom.
show("P3 single-select label + custom", codes(validateAnswer({ questionId: "Q1", answerTo: "M1", selected: ["A. Unify the stores"], custom: "but only partly" }, singleQuestion)))
show("P3b multi-select label + custom", codes(validateAnswer({ questionId: "Q1", answerTo: "M1", selected: ["A. Unify the stores", "B. Keep both stores"], custom: "mostly A" }, multiQuestion)))
show("P3c single-select custom only", codes(validateAnswer({ questionId: "Q1", answerTo: "M1", selected: [], custom: "Neither" }, singleQuestion)))

// N3 / N4 / I8 — context-free refusals and the whole problem list.
show("P4 envelope: empty selected, no custom", codes(validateEnvelope({ kind: "answer", answer: { questionId: "Q1", answerTo: "M1", selected: [] } })))
show("P8 non-array selected + empty answerTo + empty key", codes(validateAnswer({ questionId: "", answerTo: "", selected: "A. One" } as unknown as Parameters<typeof validateAnswer>[0])))
show("P8b malformed question (options non-array, empty text, empty key)", codes(validateQuestion({ questionId: "", question: "", options: "not-an-array" } as unknown as Parameters<typeof validateQuestion>[0])))

// I1 bound — the declared residual is still a residual (amended I1 declares it, expects no detection).
show("P6 findIndexFields(position/choice/idx)", findIndexFields({ position: 0, choice: 1, idx: 2 }))

// N2 / amended I8 — duplicate send id: first write wins AND is reported.
const dup = foldMail([sendRow("M1", { body: "first" }), sendRow("M1", { body: "second" })])
show("P7 duplicate send id", { body: dup.messages[0]?.body, problems: dup.problems })

// I5 edge — an answer to a folded question row whose payload is missing: is the answer still checked?
show(
  "P10 answer to a payload-less question row (empty key + unknown label)",
  codes(validateReferences({ kind: "answer", answer: { questionId: "", answerTo: "M1", selected: ["Z. Never offered"] } }, [payloadlessQuestionMessage])),
)
