// ADMISSION STRENGTH — WHO may originate work on the team plane, in three rungs (contract §10 A4).
//
// WHY A SECOND AXIS. The complexity predicate answers "is this work big enough to deserve a team?". It
// does not answer "may the thing that produced this text start one?" — and those are different
// questions. The superagent prototype kept them apart with an admission ladder; this module is the
// cheapest honest form of that idea, because it adds a CLASSIFICATION: the staging predicate keeps its
// second half (`explicitFlag || signals >= 1`) unchanged, and for every caller that EXISTS (each of them
// a human turn) every verdict that staged still stages. The rung's one behavioural effect is on PRODUCER
// text, which no live caller passes yet: that verdict is `ignore` and no longer stages (R-W4A4 M1).
//
// THE THREE RUNGS:
//   * `explicit` — the user asked for the automation: an explicit `team:` / `!team` marker was consumed,
//     or a HUMAN turn NAMES the gesture (see {@link AUTOMATION_GESTURE_PATTERN});
//   * `inferred` — a human turn that matched at least one complexity signal: the work looks big, and a
//     person asked for it;
//   * `ignore` — nothing admits the work: model-authored text, a human turn that matched no signal, or an
//     unknown producer with no explicit request.
//
// THE ORDER OF THE CHECKS, and it is binding (captain's ruling after R-W4A4 M1):
//   1. the explicit marker the caller already consumed → `explicit`;
//   2. a non-human producer → `ignore` — this branch sits ABOVE the gesture on purpose, so a
//      model-authored brief that happens to contain "orchestrate" / "编排" stays producer text;
//   3. a human turn that names the automation gesture → `explicit`;
//   4. a human turn that matched ≥ 1 complexity signal → `inferred`;
//   5. otherwise `ignore`.
// THE MARKER OUTRANKS THE PRODUCER, the GESTURE does not: the marker is the USER's own request, consumed
// from the original text before the gate saw it (the gate is handed the marker-stripped text), so a
// caller reporting it reports the user; a gesture word is the PRODUCER's own wording.
//
// WHAT IT IS NOT. It is not a policy engine and it stores nothing: the gate reads it once per fire and
// reports it in the notice. `ignore` is deliberately reachable only for a caller that passes PRODUCER
// text — the live gate is fed `latestUserMessage`, which already filters to human turns.
import { consumeExplicitFlag, evaluateComplexityGate } from "./complexity-gate.ts"

/** How strongly one piece of text admits the work it describes, strongest first. */
export type AdmissionStrength = "explicit" | "inferred" | "ignore"

/**
 * Who PRODUCED the text.
 *
 * `human` is the user's own turn; `model` is text the agent wrote (a task description, an injected
 * instruction); `unknown` is a caller that cannot say.
 */
export type AdmissionSource = "human" | "model" | "unknown"

/**
 * The automation GESTURE vocabulary: naming the machinery is as explicit as typing its marker — on a
 * HUMAN turn.
 *
 * Deliberately short, and deliberately about the ACT, not about teams in general: a message that merely
 * discusses teams is not a request to start one, while "autoproject this" or "编排一下" is.
 *
 * THE PRODUCER FILTER IS EVALUATED FIRST (see {@link admissionOf}), so this test only ever runs for a
 * human turn and a false positive can only PROMOTE `inferred` → `explicit` — both of which stage. That
 * ordering is what stops a producer-authored brief from admitting itself by naming the automation: on
 * producer text the same word would flip `ignore` → `explicit`, i.e. turn a NON-STAGING verdict into a
 * staging one (measured in R-W4A4 M1, which is why the branch moved).
 */
export const AUTOMATION_GESTURE_PATTERN = /\b(?:autoproject|auto-project|orchestrate|orchestration)\b|自动化|编排/iu

/**
 * What the caller ALREADY knows about the gate's own reading of the text.
 *
 * Optional on purpose: the gate has both facts and passes them, while an independent caller (a test, a
 * future escalation path) may pass none and let this module derive them from the text itself.
 */
export interface AdmissionEvidence {
  /**
   * Whether an explicit `team:` / `!team` marker was consumed from the ORIGINAL text.
   *
   * The gate is handed the text with the marker already stripped, so it must say so; absent means this
   * module reads the flag itself and finds none.
   */
  explicitFlag?: boolean
  /**
   * How many complexity signals the gate matched for this text.
   *
   * Absent means this module evaluates the gate itself — the same pure predicate, never a copy of it.
   */
  matchedSignals?: number
}

/**
 * Classify one text's admission strength, in the ORDER the module header fixes.
 *
 * PURE AND TOTAL: it never throws, reads no clock and touches no file. A non-string text reads as EMPTY
 * — `typeof` narrowing rather than `String()`, so even an object with no prototype, or one whose
 * `toString` throws, cannot take the classifier down (the gate always hands a string, so this only makes
 * the claim true). An unknown source is treated as `unknown`, never as a human.
 * @param source - who produced the text.
 * @param text - the text as the gate sees it (the explicit marker may already be consumed).
 * @param evidence - the gate's own reading, when the caller already has it.
 * @returns the strongest rung that holds.
 */
export function admissionOf(source: AdmissionSource, text: string, evidence: AdmissionEvidence = {}): AdmissionStrength {
  /** The text as a plain string; anything that is not a string reads as EMPTY and can never be stringified. */
  const body = typeof text === "string" ? text : ""
  // THE FLAG IS READ THROUGH THE GATE'S OWN PARSER (contract §10 A4): a second spelling of `team:`/`!team`
  // here would be a second definition of the explicit request, free to disagree with the one that decides
  // whether the marker is consumed from the user's turn.
  /** Whether an explicit marker was consumed, by the caller's fact or by reading the text. */
  const explicit = evidence.explicitFlag ?? consumeExplicitFlag(body).flagged
  if (explicit) return "explicit"
  // THE PRODUCER FILTER OUTRANKS THE GESTURE (R-W4A4 M1, captain's ruling): model-authored text is the
  // exact case the rung exists to name, so a producer brief that says "orchestrate" / "编排" is still
  // producer text and must stage nothing. The MARKER above stays above this check deliberately — it is
  // the user's own marker, consumed from the original turn.
  if (source !== "human") return "ignore"
  if (AUTOMATION_GESTURE_PATTERN.test(body)) return "explicit"
  // THE SIGNAL COUNT COMES FROM THE ONE PREDICATE, never from a local scan of the lexicons.
  /** How many complexity signals this text matches. */
  const signals = evidence.matchedSignals ?? evaluateComplexityGate(body).signals.length
  return signals >= 1 ? "inferred" : "ignore"
}
