// THE PURE VALIDATORS for the mail protocol (frozen contract §4, I1–I7).
//
// Every function here is total: it reports problems instead of throwing, never touches the disk, and
// keeps going after one rule fails so a sender sees the WHOLE list in one refusal. I4 is the heart of
// the package — a selected label that the question never offered is refused WITH the full valid label
// list, which is the mechanical replacement for "the captain counted the options".

import type {
  MailAddress,
  MailAnswer,
  MailCheck,
  MailEnvelope,
  MailMessage,
  MailProblem,
  MailProblemCode,
  MailQuestion,
} from "./types.ts"
import { INDEX_FIELD_NAMES, isMailKind } from "./types.ts"

/**
 * Build one validation problem.
 * @param code - the rule that failed.
 * @param message - one sentence naming what was wrong, in the sender's terms.
 * @param labels - the full valid label list, when I4 can name it.
 * @returns the problem, with `labels` present only when one was supplied.
 */
function problem(code: MailProblemCode, message: string, labels?: readonly string[]): MailProblem {
  return labels === undefined ? { code, message } : { code, message, labels: [...labels] }
}

/**
 * Turn the accumulated problems into the validator's discriminated result.
 * @param problems - every rule failure found for the payload.
 * @returns `{ ok: true }` when none, otherwise the complete list.
 */
function check(problems: readonly MailProblem[]): MailCheck {
  return problems.length === 0 ? { ok: true } : { ok: false, problems: [...problems] }
}

/**
 * Merge a nested validator's problems into the accumulator.
 * @param target - the list being built for the outer payload.
 * @param nested - the result of the payload-level validator.
 */
function appendProblems(target: MailProblem[], nested: MailCheck): void {
  if (!nested.ok) target.push(...nested.problems)
}

/**
 * Whether a runtime value is a non-null, non-array object.
 * @param value - the value to classify.
 * @returns true for a plain object, whose keys can be read with `Object.entries`.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

/**
 * Find every index-shaped field in a payload (I1), at any depth.
 *
 * The walk is bounded and cycle-safe (a runtime value is not necessarily JSON), and it collects PATHS
 * so the refusal names where the forbidden field sits instead of only that one exists.
 * @param value - the payload (or any value inside it) to scan.
 * @returns the offending field paths, outermost first; empty means I1 holds.
 */
export function findIndexFields(value: unknown): string[] {
  /** The offending field paths found so far. */
  const found: string[] = []
  /** Objects already visited, so a cyclic runtime value cannot loop the scan. */
  const seen = new Set<object>()
  /**
   * Walk one value.
   * @param current - the value at this position.
   * @param path - the position's readable path, rooted at `$`.
   * @param depth - the walk's depth, capped so a pathological value stays bounded.
   */
  const walk = (current: unknown, path: string, depth: number): void => {
    if (depth > 16 || current === null || typeof current !== "object") return
    if (seen.has(current)) return
    seen.add(current)
    if (Array.isArray(current)) {
      current.forEach((entry: unknown, index: number) => walk(entry, path + "[" + String(index) + "]", depth + 1))
      return
    }
    for (const [key, entry] of Object.entries(current as Record<string, unknown>)) {
      /** The child's path, so a problem names exactly where the field sits. */
      const childPath = path + "." + key
      if (INDEX_FIELD_NAMES.includes(key)) found.push(childPath)
      walk(entry, childPath, depth + 1)
    }
  }
  walk(value, "$", 0)
  return found
}

/**
 * The labels a question offers, in option order.
 *
 * A loose JSON row can carry a non-array `options`; the read is therefore defensive and yields `[]`
 * rather than throwing, and the validator that needs the list reports the malformed question itself.
 * @param question - the question payload to read.
 * @returns the non-empty label strings, in the order they were offered.
 */
export function labelsOf(question: MailQuestion): string[] {
  /** The options read as a runtime value, because the declared type is not a guarantee for JSON. */
  const options: unknown = question.options
  if (!Array.isArray(options)) return []
  return options
    .map((option: unknown) => String((option as { label?: unknown } | null)?.label ?? ""))
    .filter((label: string) => label !== "")
}

/**
 * Validate a question payload against I2 (and I1 for the payload's own scope).
 *
 * The rules are: at least one option, every label non-empty, every label UNIQUE within the question.
 * The ordinal prefix (`"A. …"`) is the documented convention rather than a checked shape, so a cell
 * that prefers `"1) …"` is never refused for it; uniqueness is what makes the echo unambiguous.
 * @param question - the payload to validate.
 * @returns ok, or every rule failure found.
 */
export function validateQuestion(question: MailQuestion): MailCheck {
  if (!isPlainObject(question)) return check([problem("kind-payload", "a question payload must be an object")])
  /** The accumulated failures; every rule runs so a caller sees the complete list at once (I8). */
  const problems: MailProblem[] = []
  for (const path of findIndexFields(question)) {
    problems.push(problem("index-field", "an index-shaped field is forbidden in a mail payload: " + path))
  }
  // R1's F1: the questionId is the correlation key every answer copies, so an empty one is a defect
  // of the question, not a decorative field.
  if (typeof question.questionId !== "string" || question.questionId.trim() === "") {
    problems.push(problem("question-id", "a question must carry a non-empty `questionId`; every answer copies it"))
  }
  /** The options read as a runtime value, so a non-array is reported instead of throwing. */
  const options: unknown = question.options
  if (!Array.isArray(options) || options.length === 0) {
    problems.push(problem("question-empty", "a question must offer at least one option"))
  }
  /** The labels accepted so far, in option order, for duplicate detection. */
  const labels: string[] = []
  // R1's N4: the option failure does NOT end the walk — the question text and the id are still checked.
  if (Array.isArray(options)) {
    options.forEach((option: unknown, index: number) => {
      /** The option's label read defensively off a loose row. */
      const label: unknown = (option as { label?: unknown } | null)?.label
      if (typeof label !== "string" || label.trim() === "") {
        problems.push(problem("option-label", "option " + String(index + 1) + " has an empty label"))
        return
      }
      if (labels.includes(label)) {
        problems.push(problem("option-label", "duplicate option label: " + JSON.stringify(label) + " — labels must be unique within a question"))
        return
      }
      labels.push(label)
    })
  }
  if (typeof question.question !== "string" || question.question.trim() === "") {
    problems.push(problem("question-empty", "the question text is empty"))
  }
  return check(problems)
}

/**
 * Validate an answer payload against I1, I3, I4 and I5's correlation key.
 *
 * With the answered question supplied, TWO in-context rules run besides the echo: every `selected`
 * entry must be a label the question offered, matched EXACTLY (no trimming, no case folding, a
 * mismatch carries the full valid label list), and `answer.questionId` must equal the question's —
 * R1's F1, because a wrong correlation key would silently void an otherwise valid answer.
 *
 * WITHOUT the question, the rules that need no context still run: a non-empty `questionId` and
 * `answerTo`, a label list or `custom`, and the zero-labels-zero-custom refusal (R1's N3), which is
 * invalid for BOTH cardinalities. Only the single-versus-multi minimum, the label echo and the key
 * comparison wait for {@link validateReferences}. R1's N4: a failure never ends the walk early, so
 * one refusal names every problem.
 * @param answer - the answer payload to validate.
 * @param question - the answered question's payload, when it is already resolved.
 * @returns ok, or every rule failure found.
 */
export function validateAnswer(answer: MailAnswer, question?: MailQuestion): MailCheck {
  if (!isPlainObject(answer)) return check([problem("kind-payload", "an answer payload must be an object")])
  /** The accumulated failures; every rule runs so a caller sees the complete list at once (I8). */
  const problems: MailProblem[] = []
  for (const path of findIndexFields(answer)) {
    problems.push(problem("index-field", "an index-shaped field is forbidden in a mail payload: " + path))
  }
  // R1's F1: the answer's correlation key is required even before the question is resolved.
  if (typeof answer.questionId !== "string" || answer.questionId.trim() === "") {
    problems.push(problem("answer-question-id", "an answer must carry the question's non-empty `questionId`"))
  }
  /** The selected labels read as a runtime value, so a non-array is reported instead of throwing. */
  const selected: unknown = answer.selected
  /** Whether `selected` is usable as a label list; the picking loop is skipped when it is not. */
  const selectedIsArray = Array.isArray(selected)
  if (!selectedIsArray) {
    problems.push(problem("answer-selection", "`selected` must be an array of offered label strings"))
  }
  /** The selected entries that really are non-empty strings, in selection order. */
  const picked: string[] = []
  // R1's N4: the non-array failure does NOT end the walk — the remaining rules still report.
  if (selectedIsArray) {
    selected.forEach((entry: unknown, index: number) => {
      if (typeof entry !== "string" || entry.trim() === "") {
        problems.push(problem("answer-selection", "selected entry " + String(index + 1) + " is not a non-empty label string"))
        return
      }
      picked.push(entry)
    })
  }
  /** The optional free-form text, which a single-select answer may carry INSTEAD of a label. */
  const custom: unknown = answer.custom
  if (custom !== undefined && (typeof custom !== "string" || custom.trim() === "")) {
    problems.push(problem("answer-selection", "`custom`, when present, must be non-empty text"))
  }
  if (typeof answer.answerTo !== "string" || answer.answerTo.trim() === "") {
    problems.push(problem("reference-unknown", "an answer must name the question message it answers (`answerTo`)"))
  }
  /** Whether the answer carries usable free text, an alternative to the one label of a single-select. */
  const hasCustom = typeof custom === "string" && custom.trim() !== ""
  if (question === undefined) {
    // R1's N3: zero labels and zero custom is invalid for BOTH cardinalities, so it needs no question.
    if (selectedIsArray && picked.length === 0 && !hasCustom) {
      problems.push(problem("answer-selection", "an answer must select at least one offered label or give `custom`"))
    }
    return check(problems)
  }
  /** The labels the question actually offered; I4's mismatch reports exactly this list. */
  const offered = labelsOf(question)
  for (const label of picked) {
    if (!offered.includes(label)) {
      problems.push(problem("answer-unknown-label", "selected label is not offered by the question: " + JSON.stringify(label), offered))
    }
  }
  // R1's F1: the answer's key must EQUAL the resolved question's key; an empty question key makes the
  // question unusable as a correlation key, so it is reported as the question's defect.
  if (typeof question.questionId !== "string" || question.questionId.trim() === "") {
    problems.push(problem("question-id", "the referenced question has an empty `questionId`, so no answer can be correlated"))
  } else if (typeof answer.questionId === "string" && answer.questionId.trim() !== "" && answer.questionId !== question.questionId) {
    problems.push(problem("answer-question-id", "`questionId` " + JSON.stringify(answer.questionId) + " does not match the referenced question's `questionId` " + JSON.stringify(question.questionId)))
  }
  // R1's N5 / amended I3: a single-select answer is exactly one label OR custom alone; the two may not
  // be combined. A multi-select needs at least one label and MAY add custom.
  if (selectedIsArray) {
    if (question.multiSelect === true) {
      if (picked.length < 1) {
        problems.push(problem("answer-selection", "a multi-select answer must select at least one offered label"))
      }
    } else if (picked.length > 1) {
      problems.push(problem("answer-selection", "a single-select answer must select exactly one label; got " + String(picked.length)))
    } else if (picked.length === 1) {
      if (hasCustom) {
        problems.push(problem("answer-selection", "a single-select answer must not combine a selected label with `custom`; give exactly one or the other"))
      }
    } else if (!hasCustom) {
      problems.push(problem("answer-selection", "a single-select answer must select exactly one label or give `custom`"))
    }
  }
  return check(problems)
}

/**
 * Validate an envelope's structure: I1 everywhere, `kind` known, and the payload matching the kind.
 *
 * This is the answer-time check a sender can run before it folds anything. A `message` carries no
 * question and no answer; a `question` carries a valid question payload and no answer; an `answer`
 * carries a valid answer payload and no question.
 * @param envelope - the envelope to validate.
 * @returns ok, or every rule failure found.
 */
export function validateEnvelope(envelope: MailEnvelope): MailCheck {
  if (!isPlainObject(envelope)) return check([problem("envelope", "a mail envelope must be an object")])
  /** The accumulated failures; every rule runs so a caller sees the complete list at once. */
  const problems: MailProblem[] = []
  for (const path of findIndexFields(envelope)) {
    problems.push(problem("index-field", "an index-shaped field is forbidden in a mail payload: " + path))
  }
  if (!isMailKind(envelope.kind)) {
    problems.push(problem("kind-payload", "`kind` must be `message`, `question` or `answer`; got " + JSON.stringify(envelope.kind)))
    return check(problems)
  }
  if (envelope.kind === "message") {
    if (envelope.question !== undefined) problems.push(problem("kind-payload", "a `message` row must not carry a question payload"))
    if (envelope.answer !== undefined) problems.push(problem("kind-payload", "a `message` row must not carry an answer payload"))
  } else if (envelope.kind === "question") {
    if (envelope.question === undefined) problems.push(problem("kind-payload", "a `question` row must carry its question payload"))
    else appendProblems(problems, validateQuestion(envelope.question))
    if (envelope.answer !== undefined) problems.push(problem("kind-payload", "a `question` row must not carry an answer payload"))
  } else {
    if (envelope.answer === undefined) problems.push(problem("kind-payload", "an `answer` row must carry its answer payload"))
    else appendProblems(problems, validateAnswer(envelope.answer))
    if (envelope.question !== undefined) problems.push(problem("kind-payload", "an `answer` row must not carry a question payload"))
  }
  return check(problems)
}

/**
 * Validate an envelope against the mailbox it will join: I5's references and I4's echo in context.
 *
 * `replyTo` must name a message already in the folded mailbox, and an answer's `answerTo` must name a
 * `question` row — whose options are then used to echo-check the selected labels, because the answer
 * payload alone does not carry them. The resolved question is ALSO what makes R1's F1 enforceable:
 * {@link validateAnswer} is called with it, so `answer.questionId` must be non-empty and EQUAL to that
 * question's `questionId`. The mailbox is expected to be the SAME folded mailbox (the caller scopes
 * it); a cross-mailbox id simply reads as unknown.
 * @param envelope - the envelope about to be sent.
 * @param messages - the folded mailbox the envelope references.
 * @returns ok, or every rule failure found.
 */
export function validateReferences(envelope: MailEnvelope, messages: readonly MailMessage[]): MailCheck {
  /** The accumulated failures; every rule runs so a caller sees the complete list at once. */
  const problems: MailProblem[] = []
  /** Folded messages by id, built once so the lookup is not quadratic. */
  const byId = new Map(messages.map((message) => [message.id, message]))
  if (envelope.replyTo !== undefined) {
    if (typeof envelope.replyTo !== "string" || !byId.has(envelope.replyTo)) {
      problems.push(problem("reference-unknown", "`replyTo` names no message in this mailbox: " + JSON.stringify(envelope.replyTo)))
    }
  }
  if (envelope.kind === "answer" && envelope.answer !== undefined) {
    /** The folded message the answer claims to answer. */
    const target = byId.get(envelope.answer.answerTo)
    if (target === undefined) {
      problems.push(problem("reference-unknown", "`answerTo` names no message in this mailbox: " + JSON.stringify(envelope.answer.answerTo)))
    } else if (target.kind !== "question") {
      problems.push(problem("reference-not-question", "`answerTo` must name a `question` row; " + target.id + " is a `" + target.kind + "` row"))
    } else if (target.question !== undefined) {
      appendProblems(problems, validateAnswer(envelope.answer, target.question))
    } else {
      // F3 (R1's residual Nit): the target is a folded `question` row that carries NO payload — the
      // fold KEEPS such a row and reports the anomaly (I8), so this gate can still be handed one. The
      // branch must not short-circuit to `ok`: the CONTEXT-FREE answer rules (amended I5's required,
      // non-empty `questionId`; I3's label-or-custom) do not depend on the target at all, and the
      // missing payload is itself a problem the sender has to see. The echo check (I4) is the ONLY
      // rule that genuinely needs the target's option list, and it is impossible here — which is what
      // the added problem says, instead of silently accepting the answer.
      problems.push(problem("question-payload-missing", "the referenced `question` row " + target.id + " carries no question payload, so its offered labels cannot be checked"))
      appendProblems(problems, validateAnswer(envelope.answer))
    }
  }
  return check(problems)
}

/**
 * Resolve the thread id a reply contributes (I7).
 *
 * An explicit `threadId` wins; otherwise a reply inherits its `replyTo`'s thread. When neither is
 * available the caller mints the thread from the message's own id — which is why a thread's id is its
 * FIRST message id, and why the fold can resolve a thread in one pass over an append-only log.
 *
 * THIS HELPER DOES NOT VALIDATE AN EXPLICIT ID. R1's F2 / amended I7: an explicit `threadId` that
 * names no already-folded message (and is not the row's own id) is kept as declared and REPORTED by
 * {@link foldMail}, which is the only place the whole mailbox is visible; a pre-flight validator that
 * has not folded the row yet cannot tell a forged id from a new thread's own id.
 * @param envelope - the envelope whose thread is being resolved.
 * @param byId - the already-folded messages, keyed by id.
 * @returns the explicit or inherited thread id, or `undefined` when the caller must use its own id.
 */
export function inheritedThreadId(
  envelope: MailEnvelope,
  byId: ReadonlyMap<string, Pick<MailMessage, "id" | "threadId">>,
): string | undefined {
  if (typeof envelope.threadId === "string" && envelope.threadId !== "") return envelope.threadId
  if (typeof envelope.replyTo === "string" && envelope.replyTo !== "") return byId.get(envelope.replyTo)?.threadId
  return undefined
}

/**
 * Plan a broadcast's fan-out (I6): one row per recipient, the sender excluded.
 *
 * There is no multi-recipient row in this protocol. Deduplication is by id and the first-seen order is
 * kept, so a broadcast produces a deterministic row count — which is what keeps per-recipient ack, the
 * per-recipient undelivered bound and the mailbox summary honest.
 * @param senderId - the sender, never a recipient of its own broadcast.
 * @param targets - the candidate recipients, possibly containing the sender and duplicates.
 * @returns the recipients to mint one `send` row each for.
 */
export function fanOutTargets(senderId: string, targets: readonly MailAddress[]): MailAddress[] {
  /** The accepted recipients, in first-seen order. */
  const out: MailAddress[] = []
  /** Ids already accepted, so a duplicate target never becomes a second row. */
  const seen = new Set<string>()
  for (const target of targets) {
    if (target.id === "" || target.id === senderId || seen.has(target.id)) continue
    seen.add(target.id)
    out.push({ id: target.id, name: target.name })
  }
  return out
}

/**
 * The canonical ordinal prefix for a zero-based option index.
 *
 * `0` → `"A."` … `25` → `"Z."`; past `Z` the stable spelling switches to one-based numbering
 * (`26` → `"27)"`), so every index still has its OWN prefix and no label silently repeats. An invalid
 * index falls back to one-based numbering, which keeps the function total.
 * @param index - the option's zero-based position.
 * @returns the prefix, including its separator, ready to concatenate with the label text.
 */
export function ordinalPrefix(index: number): string {
  if (Number.isInteger(index) && index >= 0 && index < 26) return String.fromCharCode(65 + index) + "."
  return String(Number.isFinite(index) ? index + 1 : 1) + ")"
}

/**
 * Spell one option label with its own stable ordinal, the documented convention.
 * @param index - the option's zero-based position.
 * @param text - the option's text.
 * @returns `"<prefix> <text>"`, the spelling an answer must echo verbatim.
 */
export function withOrdinal(index: number, text: string): string {
  return ordinalPrefix(index) + " " + text
}
