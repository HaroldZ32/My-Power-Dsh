// I1–I5's load-bearing arms: the no-index proof, unique labels, the verbatim echo, single vs multi
// selection, and the mailbox references. A refusal arm also asserts the CODE (and the valid label
// list where I4 carries one), so a green suite means the rule discriminates instead of merely running.

import { describe, expect, test } from "bun:test"

import {
  MAIL_PAYLOADS_CARRY_NO_INDEX,
  fanOutTargets,
  findIndexFields,
  labelsOf,
  ordinalPrefix,
  validateAnswer,
  validateEnvelope,
  validateQuestion,
  validateReferences,
  withOrdinal,
} from "../src/index.ts"
import type {
  MailAddress,
  MailAnswer,
  MailCheck,
  MailEnvelope,
  MailMessage,
  MailProblem,
  MailQuestion,
} from "../src/index.ts"

/** Assert a validator refused, and hand back its problems so an arm can inspect codes and labels. */
function failures(result: MailCheck): MailProblem[] {
  if (result.ok) throw new Error("expected the validator to refuse, but it returned ok")
  return result.problems
}

/** A valid single-select question: two unique, ordinal-prefixed labels. */
function singleQuestion(): MailQuestion {
  return {
    questionId: "Q1",
    header: "Storage",
    question: "Which approach should the cell take?",
    options: [{ label: "A. Unify the stores" }, { label: "B. Keep both stores" }],
  }
}

/** The same question as a MULTI-select one, still with the two labels. */
function multiQuestion(): MailQuestion {
  return { ...singleQuestion(), multiSelect: true }
}

/** One folded `question` message, as the mailbox fold would produce it. */
function questionMessage(): MailMessage {
  return {
    id: "M1",
    kind: "question",
    fromId: "S1",
    fromName: "cell-planner",
    toId: "S2",
    toName: "deep-worker",
    subject: "Storage choice",
    body: "question body",
    sentAt: "2026-10-31T00:00:00.000Z",
    threadId: "M1",
    question: singleQuestion(),
  }
}

/** One folded plain `message`, i.e. a row that is not a question. */
function plainMessage(): MailMessage {
  return {
    id: "M0",
    kind: "message",
    fromId: "S1",
    fromName: "cell-planner",
    toId: "S2",
    toName: "deep-worker",
    subject: "hello",
    body: "body",
    sentAt: "2026-10-31T00:00:00.000Z",
    threadId: "M0",
  }
}

/** The answer envelope that echoes the base question's first label and answers the question message. */
function validAnswer(): MailEnvelope {
  return {
    kind: "answer",
    replyTo: "M1",
    answer: { questionId: "Q1", answerTo: "M1", selected: ["A. Unify the stores"] },
  }
}

describe("I1 — no index field anywhere", () => {
  test("the compile-time proof and the runtime scan agree", () => {
    expect(MAIL_PAYLOADS_CARRY_NO_INDEX).toBe(true)
    expect(findIndexFields({ answer: { selectedIndices: [0] } })).toEqual(["$.answer.selectedIndices"])
    expect(findIndexFields({ selected: ["A. One"] })).toEqual([])
  })

  test("an envelope carrying a smuggled index field is refused, naming where it sits", () => {
    /** A loose answer row that kept a POSITION beside the label echo. */
    const smuggled = {
      kind: "answer",
      answer: { questionId: "Q1", answerTo: "M1", selected: ["A. Unify the stores"], selectedIndices: [0] },
    } as unknown as MailEnvelope
    /** The refusal, which must name the forbidden field. */
    const problems = failures(validateEnvelope(smuggled))
    expect(problems.some((entry) => entry.code === "index-field" && entry.message.includes("selectedIndices"))).toBe(true)
  })
})

describe("I2 — at least one option, non-empty and unique labels", () => {
  test("the base question is valid, and labelsOf lists its labels in order", () => {
    expect(validateQuestion(singleQuestion()).ok).toBe(true)
    expect(labelsOf(singleQuestion())).toEqual(["A. Unify the stores", "B. Keep both stores"])
  })

  test("a duplicated label is refused: no answer could disambiguate it", () => {
    /** The same label offered twice. */
    const question: MailQuestion = { ...singleQuestion(), options: [{ label: "A. Same" }, { label: "A. Same" }] }
    expect(failures(validateQuestion(question)).some((entry) => entry.code === "option-label")).toBe(true)
  })

  test("an empty label is refused", () => {
    /** A question whose second option has no text. */
    const question: MailQuestion = { ...singleQuestion(), options: [{ label: "A. Unify" }, { label: "   " }] }
    expect(failures(validateQuestion(question)).some((entry) => entry.code === "option-label")).toBe(true)
  })

  test("a question without options is refused", () => {
    /** A question with nothing to choose from. */
    const question: MailQuestion = { ...singleQuestion(), options: [] }
    expect(failures(validateQuestion(question)).some((entry) => entry.code === "question-empty")).toBe(true)
  })

  test("a question with an empty questionId is refused (F1: the correlation key)", () => {
    /** A question whose key no answer could copy. */
    const question: MailQuestion = { ...singleQuestion(), questionId: "" }
    expect(failures(validateQuestion(question)).some((entry) => entry.code === "question-id")).toBe(true)
  })
})

describe("I3 — single-select versus multi-select cardinality", () => {
  test("a single-select answer with two labels is refused", () => {
    /** Two selections offered to a one-choice question. */
    const answer: MailAnswer = { questionId: "Q1", answerTo: "M1", selected: ["A. Unify the stores", "B. Keep both stores"] }
    expect(failures(validateAnswer(answer, singleQuestion())).some((entry) => entry.code === "answer-selection")).toBe(true)
  })

  test("a single-select answer with exactly one label is accepted", () => {
    /** One exact echo. */
    const answer: MailAnswer = { questionId: "Q1", answerTo: "M1", selected: ["B. Keep both stores"] }
    expect(validateAnswer(answer, singleQuestion()).ok).toBe(true)
  })

  test("a single-select answer may be custom-only, but not empty", () => {
    /** Free text instead of an offered label. */
    const custom: MailAnswer = { questionId: "Q1", answerTo: "M1", selected: [], custom: "Neither: a third path" }
    expect(validateAnswer(custom, singleQuestion()).ok).toBe(true)
    /** Nothing selected and nothing custom. */
    const empty: MailAnswer = { questionId: "Q1", answerTo: "M1", selected: [] }
    expect(failures(validateAnswer(empty, singleQuestion())).some((entry) => entry.code === "answer-selection")).toBe(true)
  })

  test("a single-select answer refuses a selected label PLUS custom (N5 / amended I3)", () => {
    /** Both a label and free text on a one-choice question, which the amended contract refuses. */
    const mixed: MailAnswer = { questionId: "Q1", answerTo: "M1", selected: ["A. Unify the stores"], custom: "but only partly" }
    expect(failures(validateAnswer(mixed, singleQuestion())).some((entry) => entry.code === "answer-selection")).toBe(true)
  })

  test("a multi-select answer needs at least one label", () => {
    /** One selection on a question that allows several. */
    const one: MailAnswer = { questionId: "Q1", answerTo: "M1", selected: ["A. Unify the stores"] }
    expect(validateAnswer(one, multiQuestion()).ok).toBe(true)
    /** No selection at all: contract §4 keeps the multi-select minimum at one label. */
    const none: MailAnswer = { questionId: "Q1", answerTo: "M1", selected: [], custom: "Maybe" }
    expect(failures(validateAnswer(none, multiQuestion())).some((entry) => entry.code === "answer-selection")).toBe(true)
  })
})

describe("I4 — the verbatim echo", () => {
  test("an unknown label is refused WITH the full valid label list", () => {
    /** An answer that selected a label the question never offered. */
    const answer: MailAnswer = { questionId: "Q1", answerTo: "M1", selected: ["C. Neither"] }
    /** The refusal. */
    const problems = failures(validateAnswer(answer, singleQuestion()))
    /** The echo problem, which must carry every valid label. */
    const echo = problems.find((entry) => entry.code === "answer-unknown-label")
    expect(echo).toBeDefined()
    expect(echo?.labels).toEqual(["A. Unify the stores", "B. Keep both stores"])
    expect(echo?.message).toContain("C. Neither")
  })

  test("the match is EXACT: case and whitespace differences are refused", () => {
    for (const label of ["a. unify the stores", "A. Unify the stores ", "A. Unify the store"]) {
      /** The near-miss answer. */
      const answer: MailAnswer = { questionId: "Q1", answerTo: "M1", selected: [label] }
      expect(failures(validateAnswer(answer, singleQuestion())).some((entry) => entry.code === "answer-unknown-label")).toBe(true)
    }
  })

  test("a non-string selection is refused instead of coerced", () => {
    /** A loose JSON row that selected a number. */
    const answer = { questionId: "Q1", answerTo: "M1", selected: [0] } as unknown as MailAnswer
    expect(failures(validateAnswer(answer, singleQuestion())).some((entry) => entry.code === "answer-selection")).toBe(true)
  })

  test("a question built with withOrdinal accepts its own labels verbatim", () => {
    /** A question whose labels carry the canonical ordinals. */
    const question: MailQuestion = {
      questionId: "Q2",
      question: "Proceed?",
      options: [{ label: withOrdinal(0, "Yes") }, { label: withOrdinal(1, "No") }],
    }
    /** The answer echoing the second label. */
    const answer: MailAnswer = { questionId: "Q2", answerTo: "M2", selected: [withOrdinal(1, "No")] }
    expect(validateAnswer(answer, question).ok).toBe(true)
  })

  test("without the question, only structure is checked", () => {
    /** An unknown label that cannot be judged until the question row is resolved. */
    const answer: MailAnswer = { questionId: "Q1", answerTo: "M1", selected: ["C. Neither"] }
    expect(validateAnswer(answer).ok).toBe(true)
  })
})

describe("I5 — references against the folded mailbox", () => {
  test("a well-formed answer referencing the question message is accepted", () => {
    expect(validateReferences(validAnswer(), [questionMessage()]).ok).toBe(true)
  })

  test("an unknown answerTo is refused", () => {
    /** An answer aimed at an id no folded message carries. */
    const answer: MailEnvelope = {
      kind: "answer",
      answer: { questionId: "Q1", answerTo: "M9", selected: ["A. Unify the stores"] },
    }
    expect(failures(validateReferences(answer, [questionMessage()])).some((entry) => entry.code === "reference-unknown")).toBe(true)
  })

  test("an answer must reference a question row, not a plain message", () => {
    /** An answer aimed at a plain message's id. */
    const answer: MailEnvelope = {
      kind: "answer",
      answer: { questionId: "Q1", answerTo: "M0", selected: ["A. Unify the stores"] },
    }
    expect(failures(validateReferences(answer, [plainMessage(), questionMessage()])).some((entry) => entry.code === "reference-not-question")).toBe(true)
  })

  test("an unknown replyTo is refused", () => {
    /** A plain reply to a message the mailbox does not carry. */
    const envelope: MailEnvelope = { kind: "message", replyTo: "M9" }
    expect(failures(validateReferences(envelope, [questionMessage()])).some((entry) => entry.code === "reference-unknown")).toBe(true)
  })

  test("the resolved question's labels drive the echo check through the mailbox path", () => {
    /** An answer whose label the referenced question never offered. */
    const answer: MailEnvelope = {
      kind: "answer",
      answer: { questionId: "Q1", answerTo: "M1", selected: ["Z. Something else"] },
    }
    /** The echo problem found by the in-context check. */
    const echo = failures(validateReferences(answer, [questionMessage()])).find((entry) => entry.code === "answer-unknown-label")
    expect(echo?.labels).toEqual(["A. Unify the stores", "B. Keep both stores"])
  })
})

describe("F1 — the correlation key (amended I5)", () => {
  test("an empty answer questionId is refused before any question is resolved", () => {
    /** A loose answer row whose key was left blank. */
    const answer = { questionId: "", answerTo: "M1", selected: ["A. Unify the stores"] } as unknown as MailAnswer
    expect(failures(validateEnvelope({ kind: "answer", answer })).some((entry) => entry.code === "answer-question-id")).toBe(true)
  })

  test("a questionId that differs from the referenced question is refused", () => {
    /** An answer that names a different question than the row it answers. */
    const answer: MailEnvelope = {
      kind: "answer",
      answer: { questionId: "Q-OTHER", answerTo: "M1", selected: ["A. Unify the stores"] },
    }
    expect(failures(validateReferences(answer, [questionMessage()])).some((entry) => entry.code === "answer-question-id")).toBe(true)
  })

  test("a matching questionId is accepted through the mailbox path", () => {
    expect(validateReferences(validAnswer(), [questionMessage()]).ok).toBe(true)
  })
})

describe("F3 — the payload-less question target (T12's probe P10)", () => {
  test("P10 — a `question` row with no payload REFUSES the answer and names the missing payload", () => {
    // The fold KEEPS a `question` row whose payload is absent and reports the anomaly (I8), so the I5
    // gate can be handed one. The row below is exactly that shape.
    /** The folded question row with its payload missing, as the fold leaves it. */
    const payloadless = { ...questionMessage(), question: undefined }
    /** The probe's answer: an EMPTY correlation key and a label the question never offered. */
    const answer: MailEnvelope = { kind: "answer", answer: { questionId: "", answerTo: "M1", selected: ["Z. Something else"] } }
    /** The complete refusal, which must carry BOTH the context problem and the answer's own defect. */
    const problems = failures(validateReferences(answer, [payloadless]))
    expect(problems.map((entry) => entry.code)).toEqual(["question-payload-missing", "answer-question-id"])
    // The payload-less TARGET is named, so a sender learns why the labels could not be checked.
    expect(problems[0].message).toContain("M1")
  })

  test("P10b — CONTROL: the same answer still meets the in-context echo once the payload is there", () => {
    /** The same answer shape against the SAME row WITH its payload. */
    const answer: MailEnvelope = { kind: "answer", answer: { questionId: "", answerTo: "M1", selected: ["Z. Something else"] } }
    /** The in-context refusals: the unoffered label (I4) plus the empty key (I5). */
    const codes = failures(validateReferences(answer, [questionMessage()])).map((entry) => entry.code)
    expect(codes).toContain("answer-unknown-label")
    expect(codes).toContain("answer-question-id")
    // …and the payload-missing problem is ABSENT, so the two branches are distinguishable.
    expect(codes).not.toContain("question-payload-missing")
  })
})

describe("N3/N4/I8 — the whole problem list in one refusal", () => {
  test("a zero-label, zero-custom answer is refused without the question (N3)", () => {
    /** An answer that selected nothing and offered no free text. */
    const answer: MailAnswer = { questionId: "Q1", answerTo: "M1", selected: [] }
    expect(failures(validateEnvelope({ kind: "answer", answer })).some((entry) => entry.code === "answer-selection")).toBe(true)
  })

  test("independent failures are ALL reported, not only the first (N4)", () => {
    /** A loose answer wrong in three independent ways at once. */
    const answer = { questionId: "", answerTo: "", selected: "not-an-array" } as unknown as MailAnswer
    /** The codes the single refusal carries. */
    const codes = failures(validateAnswer(answer)).map((entry) => entry.code)
    expect(codes).toContain("answer-selection")
    expect(codes).toContain("reference-unknown")
    expect(codes).toContain("answer-question-id")
  })

  test("a malformed question reports its option, text and key failures together (N4)", () => {
    /** A loose question whose options, text and key are all wrong. */
    const question = { questionId: "", question: "", options: "not-an-array" } as unknown as MailQuestion
    /** The codes the single refusal carries. */
    const codes = failures(validateQuestion(question)).map((entry) => entry.code)
    expect(codes.filter((code) => code === "question-empty")).toHaveLength(2)
    expect(codes).toContain("question-id")
  })
})

describe("envelope structure", () => {
  test("a message row carrying a question payload is refused", () => {
    /** A row that tries to be a question without saying so. */
    const envelope: MailEnvelope = { kind: "message", question: singleQuestion() }
    expect(failures(validateEnvelope(envelope)).some((entry) => entry.code === "kind-payload")).toBe(true)
  })

  test("question and answer rows must carry their payload", () => {
    /** A question row with no question. */
    const question: MailEnvelope = { kind: "question" }
    expect(failures(validateEnvelope(question)).some((entry) => entry.code === "kind-payload")).toBe(true)
    /** An answer row with no answer. */
    const answer: MailEnvelope = { kind: "answer" }
    expect(failures(validateEnvelope(answer)).some((entry) => entry.code === "kind-payload")).toBe(true)
  })

  test("an unknown kind is refused", () => {
    /** A loose row whose kind is none of the three. */
    const envelope = { kind: "note" } as unknown as MailEnvelope
    expect(failures(validateEnvelope(envelope)).some((entry) => entry.code === "kind-payload")).toBe(true)
  })
})

describe("I6 — fan-out planning", () => {
  test("the sender is excluded, duplicates collapse, and first-seen order is kept", () => {
    /** The sender among the candidates, a duplicate recipient, and an unusable empty id. */
    const targets: MailAddress[] = [
      { id: "S1", name: "sender" },
      { id: "S2", name: "answerer" },
      { id: "S2", name: "answerer again" },
      { id: "S3", name: "observer" },
      { id: "", name: "nobody" },
    ]
    expect(fanOutTargets("S1", targets)).toEqual([
      { id: "S2", name: "answerer" },
      { id: "S3", name: "observer" },
    ])
    expect(fanOutTargets("S1", targets)).toHaveLength(2)
  })
})

describe("ordinal convention", () => {
  test("the prefix is stable per index and never repeats at the Z/A boundary", () => {
    expect(ordinalPrefix(0)).toBe("A.")
    expect(ordinalPrefix(25)).toBe("Z.")
    expect(ordinalPrefix(26)).toBe("27)")
    expect(withOrdinal(1, "Keep both stores")).toBe("B. Keep both stores")
  })
})
