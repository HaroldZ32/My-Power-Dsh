// THE ADMISSION LADDER (contract §10 A4): WHO may originate work on the team plane.
//
// WHAT THESE ARMS PIN. The ladder adds a CLASSIFICATION beside the complexity predicate, and its order is
// the captain's ruling after R-W4A4 M1: consumed marker → producer filter → gesture → complexity signals.
// The predicate's second half stays `explicitFlag || signals >= 1`, so every caller that exists (none of
// which passes `source`) keeps its verdict; the rung only vetoes PRODUCER text. The arms below are the
// contract's own acceptance list, the precedence in BOTH directions, plus the notice delta measured
// exactly.
//
// They are falsifiable by construction: removing the `source` conjunct from the predicate makes (a) go
// red, moving the producer filter back below the gesture makes (c2)/(c3) go red, and removing the rung
// from the returned verdict makes (c)/(d) go red.
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  advisoryNoticeText,
  evaluateComplexityGate,
  mechanicalNoticeText,
} from "../src/complexity-gate.ts"
import { admissionOf, AUTOMATION_GESTURE_PATTERN } from "../src/admission.ts"

/**
 * A producer-written brief that matches FIVE signals at once.
 *
 * It is deliberately the worst case: two enumerated lines (C's enumerated-line sub-signal), four
 * deliverable verbs (B), Han characters plus action verbs (E), and the caller supplies D (an active
 * boulder) and F (a large workspace). If a rung is going to be ignored, this is the text that proves it.
 */
const FIVE_SIGNAL_TEXT = "1. 迁移 auth 模块的 token store 并重构它的单元测试与文档\n2. 审计 tests 目录并修复这三个 flaky 用例，补齐缺失的断言和说明"

/** A plain human first turn with no complexity signal, used by the equality arm. */
const USER_TURN_TEXT = "Reply with exactly: hello-ok"

describe("admissionOf", () => {
  test("(a) model-authored text matching five signals is `ignore` and does NOT stage", () => {
    /** The verdict for producer text: signals fire, the rung does not admit them. */
    const verdict = evaluateComplexityGate(FIVE_SIGNAL_TEXT, { source: "model", activeBoulder: true, workspaceScale: true })
    // THE PRECONDITION: this really is the five-signal case, so the arm cannot pass on a text that
    // simply had nothing to match.
    expect(verdict.signals.length).toBeGreaterThanOrEqual(5)
    expect(verdict.signals).toEqual(["B", "C", "D", "E", "F"])
    // THE LADDER SAYS WHO, and the predicate's FIRST conjunct is the only thing that changed.
    expect(verdict.strength).toBe("ignore")
    expect(verdict.trigger).toBe(false)
  })

  test("(b) a human turn with ONE signal is `inferred` and does stage", () => {
    /** One signal only: the boulder (D), on a text with no other complexity. */
    const verdict = evaluateComplexityGate("small task", { activeBoulder: true, source: "human" })
    expect(verdict.signals).toEqual(["D"])
    expect(verdict.strength).toBe("inferred")
    expect(verdict.trigger).toBe(true)
  })

  test("(c) the explicit flag yields `explicit` — through the gate AND through the ladder", () => {
    // THE GATE PATH: the caller consumed the flag and says so.
    expect(evaluateComplexityGate("tiny task", { explicitFlag: true })).toEqual({ trigger: true, signals: ["A"], strength: "explicit" })
    // THE LADDER PATH: it reads the marker through the gate's OWN parser (`consumeExplicitFlag`), not a
    // second spelling of `team:`/`!team`.
    expect(admissionOf("human", "team: ship it")).toBe("explicit")
    expect(admissionOf("human", "please !team take this on")).toBe("explicit")
    // A quoted marker is NOT an activation (the parser's own rule), so it admits nothing by itself.
    expect(admissionOf("human", 'the manual says "!team" activates a team')).toBe("ignore")
  })

  test("(c2) the producer filter OUTRANKS the gesture: model text naming it is `ignore`, human text `explicit`", () => {
    // The gesture vocabulary matches both spellings the ruling names.
    expect(AUTOMATION_GESTURE_PATTERN.test("autoproject this refactor")).toBe(true)
    expect(AUTOMATION_GESTURE_PATTERN.test("编排一下这轮重构")).toBe(true)
    // A HUMAN turn naming the automation is as explicit as typing its marker, and it stages.
    expect(admissionOf("human", "autoproject this refactor")).toBe("explicit")
    expect(admissionOf("human", "编排一下这轮重构")).toBe("explicit")
    // A MODEL (or unknown) turn producing the SAME words is producer text. R-W4A4 M1: before the
    // reorder these returned `explicit` and STAGED — the gesture branch rescued producer prose.
    expect(admissionOf("model", "autoproject this refactor")).toBe("ignore")
    expect(admissionOf("model", "编排一下这轮重构")).toBe("ignore")
    expect(admissionOf("unknown", "autoproject this refactor")).toBe("ignore")
    // THE MARKER STAYS ABOVE THE PRODUCER CHECK: it is the USER's marker, consumed from the original text
    // before the gate saw it, so a caller reporting it reports the user's own request (not the producer's).
    expect(admissionOf("model", "team: ship it")).toBe("explicit")
  })

  test("(c3) the same precedence holds THROUGH the gate, on the five-signal worst case", () => {
    // The five-signal brief of arm (a) with one gesture word appended, in both vocabularies: M1's exact
    // measured case. Signals are source-independent, so only the rung (and therefore `trigger`) may move.
    /** The five-signal brief with an English gesture word appended. */
    const english = FIVE_SIGNAL_TEXT + "\n3. orchestrate it"
    /** The five-signal brief with the Chinese gesture word appended. */
    const chinese = FIVE_SIGNAL_TEXT + "\n3. 编排一下"
    for (const text of [english, chinese]) {
      /** The MODEL-authored verdict: the signals still fire, and the rung vetoes them. */
      const model = evaluateComplexityGate(text, { source: "model", activeBoulder: true, workspaceScale: true })
      expect(model.signals.length).toBeGreaterThanOrEqual(5)
      expect(model.strength).toBe("ignore")
      expect(model.trigger).toBe(false)
      /** The HUMAN-authored verdict for the SAME text: the gesture admits it, so it stages. */
      const human = evaluateComplexityGate(text, { source: "human", activeBoulder: true, workspaceScale: true })
      expect(human.signals).toEqual(model.signals)
      expect(human.strength).toBe("explicit")
      expect(human.trigger).toBe(true)
    }
  })

  test("(d) an ABSENT source behaves exactly as a human turn — assert the equality, not the prose", () => {
    // THE BACKWARD-COMPATIBILITY CLAIM, as an equality over the WHOLE verdict: every caller that predates
    // the field is a human turn, so the two calls cannot differ.
    for (const text of [FIVE_SIGNAL_TEXT, "small task", "tiny task", "", USER_TURN_TEXT]) {
      expect(evaluateComplexityGate(text, { activeBoulder: true, workspaceScale: true }))
        .toEqual(evaluateComplexityGate(text, { source: "human", activeBoulder: true, workspaceScale: true }))
    }
    // And the same equality holds for the explicit-flag arm, which is the one that stages unconditionally.
    expect(evaluateComplexityGate("tiny task", { explicitFlag: true }))
      .toEqual(evaluateComplexityGate("tiny task", { explicitFlag: true, source: "human" }))
  })

  test("the ladder is TOTAL: non-string text, unknown source and no evidence never throw", () => {
    expect(admissionOf("unknown", "")).toBe("ignore")
    expect(admissionOf("unknown", "team: go")).toBe("explicit")
    // A non-string text is read as EMPTY, and `typeof` narrowing is what makes that true: `String()` would
    // stringify `123`/`{}` and THROW for a prototype-less object or one whose `toString` raises (R-W4A4 N1).
    expect(admissionOf("human", undefined as unknown as string)).toBe("ignore")
    expect(admissionOf("human", 123 as unknown as string)).toBe("ignore")
    expect(admissionOf("human", Object.create(null) as unknown as string)).toBe("ignore")
    /** An object whose `toString` raises, built with `defineProperty` so the fixture stays a plain value. */
    const hostile = Object.create(null)
    Object.defineProperty(hostile, "toString", { value: (): never => { throw new Error("unstringifiable") } })
    expect(admissionOf("human", hostile as unknown as string)).toBe("ignore")
    // Evidence the caller already has is honoured, and `matchedSignals: 0` is a real answer (not absent).
    expect(admissionOf("human", "anything", { matchedSignals: 0 })).toBe("ignore")
    expect(admissionOf("human", "anything", { matchedSignals: 1 })).toBe("inferred")
    expect(admissionOf("human", "anything", { explicitFlag: true })).toBe("explicit")
  })
})

describe("the notice delta", () => {
  test("the rung is ONE clause, and an old caller's notice is byte-identical", () => {
    /** The advisory notice with and without the rung. */
    const without = advisoryNoticeText(["B"], false)
    /** The same notice reporting the rung the live wiring passes. */
    const withRung = advisoryNoticeText(["B"], false, "inferred")
    // THE EXACT DELTA: ` (admission inferred)` — 21 characters, inside the first line, no new line.
    expect(withRung.length - without.length).toBe(21)
    expect(withRung).toContain("complexity signals B (admission inferred), and")
    expect(without).not.toContain("(admission")
    // The MECHANICAL notice carries the same clause, and the same byte-identity for an old caller.
    const mechanical = mechanicalNoticeText({ planId: "plan-a", signals: ["A"], explicit: true, alreadyStaged: false })
    /** The mechanical notice reporting the rung the live wiring passes. */
    const mechanicalWithRung = mechanicalNoticeText({ planId: "plan-a", signals: ["A"], explicit: true, alreadyStaged: false, strength: "explicit" })
    expect(mechanicalWithRung.length - mechanical.length).toBe(21)
    expect(mechanicalWithRung).toContain("complexity signals A (admission explicit), and")
    // The clause never becomes a LINE: both notices keep their bullet count.
    expect(withRung.split("\n").length).toBe(without.split("\n").length)
    expect(mechanicalWithRung.split("\n").length).toBe(mechanical.split("\n").length)
  })
})


describe("the live wiring", () => {
  test("session-gate passes the verdict's rung into BOTH notice builders", () => {
    // A SOURCE PIN, deliberately: the two call sites are the whole wiring, and an arm that booted a fake
    // adapter would prove the same two lines far more expensively. It asserts the TOKENS that carry the
    // contract rather than a whole expression (R-W4A4 N4), so a pure reformat cannot redden an arm that is
    // about the wiring; the advisory match tolerates whitespace and line breaks inside the call.
    /** The wiring module's source, as shipped. */
    const source = readFileSync(join(import.meta.dir, "../src/session-gate.ts"), "utf8")
    // The mechanical builder takes the rung under the parameter name it declares.
    expect(source).toContain("strength: verdict.strength")
    // The advisory builder takes it as its THIRD argument.
    expect(source).toMatch(/advisoryNoticeText\([^)]*verdict\.strength[^)]*\)/)
  })
})
