// T14 RE-REVIEW PROBES (F3 closure, packages/mpd-mail-protocol). Black-box: drives the validators with
// the exact shape T12's P10 used, plus positive controls and a whole-problem-list arm. Reads only; never
// edits the package.

import {
  foldMail,
  validateEnvelope,
  validateReferences,
} from "../../../../packages/mpd-mail-protocol/src/index.ts"

/** A valid single-select question payload. */
const question = {
  questionId: "Q1",
  question: "Which store?",
  options: [{ label: "A. one" }, { label: "B. two" }],
}

/** One folded question message WITH its payload (the positive control). */
const withPayload = {
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
  question,
}

/** The SAME folded row with its payload absent — exactly what the fold keeps after reporting it. */
const payloadless = { ...withPayload, question: undefined }

/** Print one probe's label and observed JSON value. */
function show(label: string, value: unknown): void {
  console.log("[probe] " + label + " => " + JSON.stringify(value))
}

/** Codes and messages of a refusal (or the word ok). */
function detail(result: { ok: true } | { ok: false; problems: Array<{ code: string; message: string }> }): unknown {
  return result.ok ? "ok" : result.problems.map((problem) => ({ code: problem.code, message: problem.message }))
}

// ── T12's P10 shape: empty questionId + unoffered label against a PAYLOAD-LESS question row ────────
const p10Answer = { kind: "answer" as const, answer: { questionId: "", answerTo: "M1", selected: ["Z. Something else"] } }
show("T14-P10 payload-less target (empty key + unoffered label)", detail(validateReferences(p10Answer, [payloadless])))

// ── P10b CONTROL: same answer against the SAME row WITH its payload ────────────────────────────────
show("T14-P10b control (payload present)", detail(validateReferences(p10Answer, [withPayload])))

// ── Whole problem list on the payload-less path: empty key + empty selection + no custom ───────────
const multiDefect = { kind: "answer" as const, answer: { questionId: "", answerTo: "M1", selected: [] } }
show("T14-WHOLE list (payload-less; empty key + empty selection)", detail(validateReferences(multiDefect, [payloadless])))

// ── Positive controls: a VALID answer ─────────────────────────────────────────────────────────────
const valid = { kind: "answer" as const, answer: { questionId: "Q1", answerTo: "M1", selected: ["B. two"] } }
show("T14-OK with payload", detail(validateReferences(valid, [withPayload])))
show("T14-FAIL-CLOSED valid answer vs payload-less target", detail(validateReferences(valid, [payloadless])))

// ── The target must still be a QUESTION row: a payload-less PLAIN message is a different refusal ───
const plain = { ...withPayload, kind: "message" as const, question: undefined }
show("T14-not-a-question target", detail(validateReferences(p10Answer, [plain])))

// ── I8 regression on the fold: a payload-less question row is kept AND reported ────────────────────
const folded = foldMail([
  { t: "send", id: "M1", kind: "question", fromId: "S1", fromName: "a", toId: "S2", toName: "b", subject: "s", body: "b", at: "t1" },
  { t: "send", id: "M2", kind: "answer", replyTo: "M1", fromId: "S2", fromName: "b", toId: "S1", toName: "a", subject: "a", body: "a", at: "t2", answer: { questionId: "Q1", answerTo: "M1", selected: ["A. one"] } },
])
show("T14-fold keeps payload-less row + reports it", {
  kinds: folded.messages.map((message) => message.kind),
  questionPayload: folded.messages[0]?.question,
  problems: folded.problems,
})

// ── Envelope pre-flight still refuses the empty key before any mailbox is involved ─────────────────
show("T14-envelope pre-flight empty key", detail(validateEnvelope({ kind: "answer", answer: { questionId: "", answerTo: "M1", selected: ["A. one"] } })))
