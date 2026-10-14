// THE ask_user_question BOUNDARY GUARD — a structurally broken question call never reaches the user.
//
// WHY THIS EXISTS (wave contract `.mpd/plans/ask-user-question-guard.md`, D1; measured 2026-10-10): the
// dsh-tui question panel rendered broken cards (missing options, once missing the question text) because
// the HOST tool's schema marks `options` OPTIONAL per question — only `id` and `question` are required —
// so a shape that is SCHEMA-LEGAL but semantically broken is accepted by the harness and rendered as an
// empty card. The RENDER path is host-owned end to end (the host's ask-user tool, the user-questions
// service and the TUI's own adapter): zero bundle code participates, and a same-name wrapper is
// mechanically impossible because the host registry refuses duplicate ids. The ONE point this bundle can
// act on is therefore PRE-DISPATCH, through the `tools.guard` seam it already uses four times (the
// captain's write rule and the verifier's envelope in `verify-guard.ts`, the captain's investigation
// rule in `captain-investigation.ts`, the delegation gate in `delegation-gate.ts`).
//
// WHAT IT DENIES — deny-only, and ONLY for the call named {@link ASK_USER_QUESTION_TOOL}:
//   * `arguments` that is not a plain object;
//   * `questions` that is missing, not an array, or empty;
//   * any question item lacking a non-empty string `id` or a non-empty string `question`;
//   * `options` that is MISSING from a question item, OR (not an array, OR empty, OR carrying an entry
//     without a non-empty string `label`).
// Everything else is ALLOWED. `options` is MANDATORY on every item (D5 of
// `.mpd/plans/fix-sidebar-defects.md`, the user mandate that a question must always carry options): a
// question WITHOUT `options` is denied EXACTLY like `options: []`, because the 2026-10-11 occurrence was
// a call that simply omitted the field — schema-legal, and rendered as a card with no choices. The rule
// set is DELIBERATELY shallow — it re-states only what the host schema leaves optional, and never
// re-litigates a constraint the schema already enforces.
//
// MONOTONIC, NON-THROWING, READ-ONLY: it never mutates its input, and an unexpected shape is a
// pass-through rather than an outage, because a guard that throws takes the whole tool tree down. The
// install degrades with ONE warning when the harness exposes no `tools.guard` seam (the
// `installVerifyGuard` pattern), and the row's boot line then says `askUserQuestion=absent` rather than
// implying an enforcement that is not there.
//
// HONEST BOUNDS, stated rather than implied:
//   * "non-empty" is read LITERALLY here (`typeof value === "string" && value.length > 0`): a
//     WHITESPACE-ONLY `question` or `label` is accepted, because the frozen contract allows everything
//     the four rules above do not deny and a trimming rule would deviate from that semantics;
//   * the guard cannot fix the host's RENDER layer — it only stops the shapes it names from dispatching;
//   * the guard is the BACKSTOP, not the rule: the construction rule in the `mpd` preset is what the
//     model reads, and a pre-dispatch denial does NOT guarantee that the denial sentence reaches the
//     model (measured 2026-10-07, `skills/dsh-qa/scripts/verify-law.ts`);
//   * denying an omission makes EVERY ask_user_question call a multiple-choice call: a model that wants
//     free-text input must offer a labelled option instead.
import type { DshAdapter, DshToolExec } from "../../mpd-dsh-adapter-plugin/src/index"

/** The host tool this guard covers — matched by EXACT name, and the only name it ever inspects. */
export const ASK_USER_QUESTION_TOOL = "ask_user_question"

/**
 * Whether one value is a usable non-empty string, as the rule set reads it.
 *
 * The test is LITERAL (a whitespace-only string is non-empty), which is the frozen semantics: the guard
 * denies only what the contract names, so it cannot silently widen into a whitespace policy.
 *
 * @param value - the value read from a question item or one of its options.
 * @returns true when the value is a string with at least one character.
 */
function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0
}

/**
 * Name one received value's JSON shape for a denial sentence.
 *
 * @param value - the value that failed a rule.
 * @returns a short noun phrase (`"null"`, `"an array"`, `"undefined"`, `"a string"`, `"an object"`, …).
 */
function describeShape(value: unknown): string {
  if (value === null) return "null"
  if (value === undefined) return "undefined"
  if (Array.isArray(value)) return "an array"
  // `typeof` spells the remaining primitive kinds directly; only the object case needs an article fix.
  return typeof value === "object" ? "an object" : "a " + typeof value
}

/**
 * Whether one value is a plain JSON object — the shape a question item, an option and the call's own
 * `arguments` must have. Arrays and `null` are refused: `typeof` calls both objects, and neither can
 * carry the named fields the rules read.
 *
 * @param value - the value to classify.
 * @returns true when the value is a non-null, non-array object.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * The sentence a denied call carries: the DEFECT that was found, the ROUTE OUT, and the promise that the
 * broken call never reached the user.
 *
 * @param defect - the one rule the call broke, already naming the offending item.
 * @returns the denial sentence the harness turns into a refusal result.
 */
function askUserQuestionRefusal(defect: string): string {
  return "ask_user_question is refused: " + defect + ". Re-issue the call with every question item carrying a"
    + " non-empty string `id`, the question text under `question`, and a non-empty `options` array whose"
    + " entries each carry a non-empty string `label`, in exactly the JSON structure the tool schema defines."
    + " Every question item must offer at least one option — a question without options is refused exactly"
    + " like an empty list. A structurally broken call would render as an empty card, so it is denied before"
    + " dispatch and never reaches the user."
}

/**
 * The PURE validator: the denial for one `ask_user_question` argument object, or `undefined` to allow it.
 *
 * Harness-free by construction — the installer below hands this function (wrapped in the name test) to the
 * adapter's `guardTool` seam, so the shipped hook and these rules are the SAME code. Non-throwing: an
 * unreadable argument shape (a throwing proxy, a getter that raises) is a pass-through, never an outage.
 *
 * @param args - the call's `arguments` value, exactly as the harness produced it.
 * @returns the denial sentence, or `undefined` when the call satisfies every rule.
 */
export function askUserQuestionDenial(args: unknown): string | undefined {
  try {
    // RULE 1 — the call must be object-rooted: everything below reads named fields off it.
    if (!isPlainObject(args)) {
      return askUserQuestionRefusal("`arguments` must be a JSON object (received " + describeShape(args) + ")")
    }
    /** The call's own fields, read only through these rules; the input is never mutated. */
    const call = args
    /** The question list under test. */
    const questions = call.questions
    // RULE 2 — a call with no questions (or a non-list) renders nothing at all.
    if (!Array.isArray(questions)) {
      return askUserQuestionRefusal("`questions` must be a non-empty array (received " + describeShape(questions) + ")")
    }
    if (questions.length === 0) {
      return askUserQuestionRefusal("`questions` must not be empty — a call carrying no question renders nothing")
    }
    /** Walk every item, so the sentence names the FIRST defect a reader has to fix. */
    for (let index = 0; index < questions.length; index += 1) {
      /** The item under test, and the 1-based spelling the denial sentence uses for it. */
      const item = questions[index]
      /** How this item is named in a denial: one-based, matching how a reader counts questions. */
      const at = "question item " + String(index + 1)
      // RULE 3a — an item that is not an object cannot carry the two required fields.
      if (!isPlainObject(item)) {
        return askUserQuestionRefusal(at + " must be an object carrying `id` and `question` (received " + describeShape(item) + ")")
      }
      // RULE 3b — the two fields the host schema REQUIRES, checked with the host's own reading.
      if (!nonEmptyString(item.id)) {
        return askUserQuestionRefusal(at + " lacks a non-empty string `id` (received " + describeShape(item.id) + ")")
      }
      if (!nonEmptyString(item.question)) {
        return askUserQuestionRefusal(at + " lacks a non-empty string `question` (received " + describeShape(item.question) + ")")
      }
      /** The item's choice list, MANDATORY since D5; `undefined` means the field was omitted. */
      const options = item.options
      // RULE 4a — `options` MISSING is denied exactly like `options: []`: the user mandate makes a
      // question without options a broken card, and the 2026-10-11 occurrence was precisely this shape.
      if (options === undefined) {
        return askUserQuestionRefusal(at + " carries no `options` array — every question item must offer at least one option")
      }
      // RULE 4b — present but malformed: a non-array, an empty array, or an entry without a label.
      if (!Array.isArray(options)) {
        return askUserQuestionRefusal(at + " carries `options` that is not an array (received " + describeShape(options) + ")")
      }
      if (options.length === 0) {
        return askUserQuestionRefusal(at + " carries an empty `options` array — a choice needs at least one option")
      }
      for (let optionIndex = 0; optionIndex < options.length; optionIndex += 1) {
        /** The option under test, read defensively because the harness does not validate it either. */
        const option = options[optionIndex]
        if (!isPlainObject(option) || !nonEmptyString(option.label)) {
          return askUserQuestionRefusal(at + " option " + String(optionIndex + 1) + " lacks a non-empty string `label`")
        }
      }
    }
    return undefined
  } catch {
    // A guard must never throw: an unreadable shape is a PASS-THROUGH (the host schema still applies),
    // never an outage that would take the whole tool tree down.
    return undefined
  }
}

/**
 * The decision one DISPATCHED call gets: the name test, then {@link askUserQuestionDenial} on its arguments.
 *
 * Every other tool's call is untouched — this guard owns exactly one name, so the four guard installs of
 * this row stay independent of each other. Non-throwing on an unreadable `exec`.
 *
 * @param exec - the harness's execution object for the dispatched call.
 * @returns the denial sentence, or `undefined` when the call is not this guard's subject or is well-formed.
 */
export function askUserQuestionGuardDecision(exec: DshToolExec | undefined): string | undefined {
  try {
    if (String(exec?.name ?? "") !== ASK_USER_QUESTION_TOOL) return undefined
    return askUserQuestionDenial(exec?.arguments)
  } catch {
    return undefined
  }
}

/** What installing the guard needs: ONE degradation reporter, because the rule has no knob to read. */
export interface AskUserGuardOptions {
  /** One-line reporter for an install-time degradation (the guard itself is silent). */
  warn: (line: string) => void
}

/** The install outcome, REPORTED rather than thrown so a missing seam never aborts the row. */
export interface AskUserGuardInstall {
  /** True when the guard reached the harness tool registry. */
  installed: boolean
  /** Why it did not, when `installed` is false (already reported through `warn`). */
  reason?: string
  /** The registry's disposer, when installed. */
  dispose?: () => void
}

/**
 * Install the guard through the adapter (`dsh.guardTool`).
 *
 * Degrades with a warning instead of aborting the plugin tree: without the `tools.guard` seam the rule is
 * a stated absence rather than an enforcement, and the row's boot line says `askUserQuestion=absent`.
 *
 * There is NO config knob on purpose: a structurally broken question card is never a desired outcome, so
 * the rule is deny-only and always on wherever this row is mounted.
 *
 * @param dsh - the adapter's capability probe and its `guardTool` seam.
 * @param options - the degradation reporter.
 * @returns the install outcome.
 */
export function installAskUserQuestionGuard(
  dsh: Pick<DshAdapter, "capabilities" | "guardTool">,
  options: AskUserGuardOptions,
): AskUserGuardInstall {
  try {
    if (dsh.capabilities().toolsGuard !== true) {
      options.warn("the harness exposes no tools.guard seam — the ask_user_question boundary guard is NOT installed "
        + "(a structurally broken question call would reach the user's panel unchanged; the construction rule in the "
        + "preset prompt is then the only protection)")
      return { installed: false, reason: "no-guard-seam" }
    }
    /** The registry's disposer, returned so the row can release the guard. */
    const dispose = dsh.guardTool((exec) => askUserQuestionGuardDecision(exec))
    return { installed: true, ...(typeof dispose === "function" ? { dispose } : {}) }
  } catch (error) {
    options.warn("installing the ask_user_question boundary guard failed ("
      + (error instanceof Error ? error.message : String(error)) + ")")
    return { installed: false, reason: "install-failed" }
  }
}
