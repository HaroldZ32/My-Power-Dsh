// THE ask_user_question BOUNDARY GUARD'S ARMS (contract `.mpd/plans/ask-user-question-guard.md`, D1).
//
// WHAT THESE LOCK OUT: a question call that is SCHEMA-LEGAL — the host requires only `id` and `question`
// per item, and leaves `options` optional — but semantically broken, which the dsh-tui panel renders as a
// card with neither text nor options (measured 2026-10-10). The rules are driven through the REAL
// exported validator (`askUserQuestionDenial`) and, for the name test and the install, through the
// callback the row really hands the adapter — so what is asserted is the shipped decision, never a
// re-implementation of it.
//
// BOTH DIRECTIONS ARE PINNED, because this guard's risk is over-denial: every DENY shape the contract
// lists has an arm, and the ALLOW shapes (a valid call, a valid call WITHOUT `options`, a non-target
// tool) have arms of their own — a free-text question is a designed use of the host tool and must never
// be refused by a boundary that only exists to protect the render layer.
import { describe, expect, test } from "bun:test"

import {
  ASK_USER_QUESTION_TOOL,
  askUserQuestionDenial,
  askUserQuestionGuardDecision,
  installAskUserQuestionGuard,
} from "../src/ask-user-guard.ts"
import type { DshAdapter } from "../../mpd-dsh-adapter-plugin/src/index"

/** One well-formed question with a choice list — the shape the contract's first deny rule protects. */
const VALID_WITH_OPTIONS: Record<string, unknown> = {
  questions: [
    {
      id: "scope",
      question: "Which scope should the wave cover?",
      options: [
        { id: "guard", label: "Boundary guard only" },
        { id: "guard-prompt", label: "Guard and prompt rule" },
      ],
    },
  ],
}

/** One well-formed FREE-TEXT question: no `options` at all, which the contract keeps legal. */
const VALID_WITHOUT_OPTIONS: Record<string, unknown> = {
  questions: [{ id: "notes", question: "Anything else the plan should carry?" }],
}

describe("D1 — allow: every shape the contract does NOT deny stays dispatchable", () => {
  test("a fully-formed call with options is allowed", () => {
    expect(askUserQuestionDenial(VALID_WITH_OPTIONS)).toBeUndefined()
  })

  test("a call whose question carries NO options is allowed — free text is a designed use", () => {
    expect(askUserQuestionDenial(VALID_WITHOUT_OPTIONS)).toBeUndefined()
  })

  test("an `options` entry may carry extra fields — only `label` is the rule's subject", () => {
    expect(askUserQuestionDenial({
      questions: [{ id: "q1", question: "Pick one", options: [{ id: "a", label: "A", description: "the first" }] }],
    })).toBeUndefined()
  })

  test("a mixed call is allowed: one question with options, one free-text question", () => {
    expect(askUserQuestionDenial({
      questions: [
        { id: "a", question: "Choose", options: [{ label: "one" }] },
        { id: "b", question: "Explain" },
      ],
    })).toBeUndefined()
  })

  test("the validator never mutates the call it was handed", () => {
    /** A deep copy of the valid call, compared after the validator has run over the original; the cast
     * is the one place the JSON round-trip's `any` has to be named, and the shape is the const above. */
    const snapshot = JSON.parse(JSON.stringify(VALID_WITH_OPTIONS)) as Record<string, unknown>
    expect(askUserQuestionDenial(VALID_WITH_OPTIONS)).toBeUndefined()
    expect(VALID_WITH_OPTIONS).toEqual(snapshot)
  })
})

describe("D1 — deny: `arguments` is not an object", () => {
  test("a non-object call is refused, naming the received shape", () => {
    /** The non-object shapes the harness could hand a guard for a malformed call. */
    const shapes: unknown[] = [undefined, null, "questions", 7, true, ["x"]]
    for (const args of shapes) {
      /** The denial for this shape. */
      const denial = askUserQuestionDenial(args)
      expect(typeof denial).toBe("string")
      expect(String(denial)).toContain("`arguments` must be a JSON object")
    }
  })
})

describe("D1 — deny: `questions` missing, not an array, or empty", () => {
  test("a missing `questions` field is refused", () => {
    expect(String(askUserQuestionDenial({}))).toContain("`questions` must be a non-empty array (received undefined)")
  })

  test("a non-array `questions` value is refused and names the shape", () => {
    expect(String(askUserQuestionDenial({ questions: "q1" }))).toContain("received a string")
    expect(String(askUserQuestionDenial({ questions: null }))).toContain("received null")
    expect(String(askUserQuestionDenial({ questions: { id: "q1" } }))).toContain("received an object")
  })

  test("an EMPTY `questions` array is refused — a call with no question renders nothing", () => {
    expect(String(askUserQuestionDenial({ questions: [] }))).toContain("`questions` must not be empty")
  })
})

describe("D1 — deny: a question item lacks a non-empty string `id` or `question`", () => {
  test("a non-object item is refused, naming its position", () => {
    expect(String(askUserQuestionDenial({ questions: ["scope"] }))).toContain("question item 1 must be an object")
    expect(String(askUserQuestionDenial({ questions: [null] }))).toContain("question item 1 must be an object")
  })

  test("a missing, empty or non-string `id` is refused", () => {
    /** The `id` spellings that fail the rule, paired with the phrase the denial must carry. */
    const badIds: [unknown, string][] = [
      [undefined, "received undefined"],
      ["", "received a string"],
      [7, "received a number"],
      [null, "received null"],
    ]
    for (const [id, phrase] of badIds) {
      /** The denial for this `id` spelling. */
      const denial = askUserQuestionDenial({ questions: [{ id, question: "Q?" }] })
      expect(String(denial)).toContain("question item 1 lacks a non-empty string `id`")
      expect(String(denial)).toContain(phrase)
    }
  })

  test("a missing or empty `question` is refused — THE measured defect (a card with no text)", () => {
    expect(String(askUserQuestionDenial({ questions: [{ id: "q1" }] })))
      .toContain("question item 1 lacks a non-empty string `question` (received undefined)")
    expect(String(askUserQuestionDenial({ questions: [{ id: "q1", question: "" }] })))
      .toContain("question item 1 lacks a non-empty string `question`")
  })

  test("the denial names the OFFENDING item, so a 4-item call points at item 4", () => {
    /** A call whose first three items are valid and whose fourth lost its `question` — the measured shape. */
    const denial = askUserQuestionDenial({
      questions: [
        { id: "q1", question: "One?" },
        { id: "q2", question: "Two?" },
        { id: "q3", question: "Three?" },
        { id: "q4", options: [{ label: "mis-keyed" }] },
      ],
    })
    expect(String(denial)).toContain("question item 4 lacks a non-empty string `question`")
  })
})

describe("D1 — deny: `options` present and malformed", () => {
  test("`options` that is not an array is refused", () => {
    expect(String(askUserQuestionDenial({ questions: [{ id: "q1", question: "Q?", options: "a" }] })))
      .toContain("carries `options` that is not an array (received a string)")
    expect(String(askUserQuestionDenial({ questions: [{ id: "q1", question: "Q?", options: null }] })))
      .toContain("carries `options` that is not an array (received null)")
  })

  test("an EMPTY `options` array is refused — a choice card with no option is the broken card", () => {
    expect(String(askUserQuestionDenial({ questions: [{ id: "q1", question: "Q?", options: [] }] })))
      .toContain("carries an empty `options` array")
  })

  test("an option without a non-empty string `label` is refused, naming its position", () => {
    /** The option spellings that fail the label rule. */
    const badOptions: unknown[] = [{ id: "a" }, { label: "" }, { label: 3 }, null, "A", []]
    for (const option of badOptions) {
      expect(String(askUserQuestionDenial({ questions: [{ id: "q1", question: "Q?", options: [option] }] })))
        .toContain("question item 1 option 1 lacks a non-empty string `label`")
    }
    // The SECOND option is the offending one in a longer list, and the sentence says which.
    expect(String(askUserQuestionDenial({
      questions: [{ id: "q1", question: "Q?", options: [{ label: "A" }, { id: "b" }] }],
    }))).toContain("question item 1 option 2 lacks a non-empty string `label`")
  })
})

describe("D1 — the name test: only `ask_user_question` is this guard's subject", () => {
  test("a non-target tool name passes untouched, whatever its arguments", () => {
    expect(askUserQuestionGuardDecision({ name: "read", arguments: { file_path: "x.ts" } })).toBeUndefined()
    // Even arguments this guard would refuse are NOT its business under another name.
    expect(askUserQuestionGuardDecision({ name: "write", arguments: { questions: [] } })).toBeUndefined()
  })

  test("the target name is decided by the validator, and the constant is the host's own spelling", () => {
    expect(ASK_USER_QUESTION_TOOL).toBe("ask_user_question")
    expect(askUserQuestionGuardDecision({ name: "ask_user_question", arguments: VALID_WITH_OPTIONS })).toBeUndefined()
    expect(String(askUserQuestionGuardDecision({ name: "ask_user_question", arguments: {} })))
      .toContain("`questions` must be a non-empty array")
  })

  test("a headless or unreadable execution is a pass-through — a guard never takes a tool call down", () => {
    expect(askUserQuestionGuardDecision(undefined)).toBeUndefined()
    expect(askUserQuestionGuardDecision({})).toBeUndefined()
    /** A proxy whose every property read throws, i.e. the unreadable execution shape. */
    const unreadable = new Proxy({}, { get: (): never => { throw new Error("unreadable") } }) as unknown as { name: string }
    expect(askUserQuestionGuardDecision(unreadable)).toBeUndefined()
    /** A call whose `arguments` is itself an unreadable proxy: the validator must not throw either. */
    const unreadableArgs = new Proxy({}, { get: (): never => { throw new Error("unreadable") } })
    expect(askUserQuestionDenial(unreadableArgs)).toBeUndefined()
  })
})

describe("D1 — the install reaches the seam and reports its outcome", () => {
  /**
   * One adapter double whose `guardTool` records the callback the row really installs.
   *
   * @param guardSeam - whether the harness reports the `tools.guard` capability.
   * @returns the adapter double plus the recorded callback and warnings.
   */
  function adapterDouble(guardSeam: boolean): {
    dsh: Pick<DshAdapter, "capabilities" | "guardTool">
    guards: ((exec: unknown) => string | undefined)[]
    warnings: string[]
  } {
    /** Every guard the row handed the fake registry. */
    const guards: ((exec: unknown) => string | undefined)[] = []
    /** Every warning the row reported. */
    const warnings: string[] = []
    return {
      // The double carries ONLY the two seams the install touches; the cast is the established pattern
      // for a partial adapter (delegation-gate.test.ts), because `capabilities()` is a wide record.
      dsh: {
        capabilities: () => ({ toolsGuard: guardSeam }),
        guardTool: (guard: (exec: unknown) => string | undefined): (() => void) => {
          guards.push(guard)
          return () => {}
        },
      } as unknown as Pick<DshAdapter, "capabilities" | "guardTool">,
      guards,
      warnings,
    }
  }

  test("with the seam present the row installs exactly one guard, and it decides both ways", () => {
    /** The adapter double and its recorded guards and warnings. */
    const { dsh, guards, warnings } = adapterDouble(true)
    /** The install outcome the boot line reports. */
    const install = installAskUserQuestionGuard(dsh, { warn: (line) => warnings.push(line) })
    expect(install.installed).toBe(true)
    expect(typeof install.dispose).toBe("function")
    expect(guards).toHaveLength(1)
    // The callback the ROW installed decides: a broken call is denied, a good call and a foreign tool pass.
    expect(String(guards[0]?.({ name: "ask_user_question", arguments: { questions: [] } }) ?? ""))
      .toContain("ask_user_question is refused")
    expect(guards[0]?.({ name: "ask_user_question", arguments: VALID_WITH_OPTIONS })).toBeUndefined()
    expect(guards[0]?.({ name: "read", arguments: {} })).toBeUndefined()
    expect(warnings).toEqual([])
  })

  test("a composition without the guard seam reports the absence instead of installing nothing silently", () => {
    /** The adapter double without the seam. */
    const { dsh, guards, warnings } = adapterDouble(false)
    /** The install outcome, which the boot line turns into `askUserQuestion=absent`. */
    const install = installAskUserQuestionGuard(dsh, { warn: (line) => warnings.push(line) })
    expect(install.installed).toBe(false)
    expect(install.reason).toBe("no-guard-seam")
    expect(guards).toHaveLength(0)
    expect(warnings.join("\n")).toContain("no tools.guard seam")
    // The warning names what stays unprotected, so the absence is legible in the boot log.
    expect(warnings.join("\n")).toContain("ask_user_question")
  })

  test("a throwing guard seam is reported as an install failure, not an abort", () => {
    /** An adapter whose `guardTool` rejects the registration. */
    const dsh = {
      capabilities: () => ({ toolsGuard: true }),
      guardTool: (): (() => void) => { throw new Error("registry closed") },
    } as unknown as Pick<DshAdapter, "capabilities" | "guardTool">
    /** The warnings the failed install reported. */
    const warnings: string[] = []
    /** The install outcome of a registry that refuses the registration. */
    const install = installAskUserQuestionGuard(dsh, { warn: (line: string): number => warnings.push(line) })
    expect(install.installed).toBe(false)
    expect(install.reason).toBe("install-failed")
    expect(warnings.join("\n")).toContain("registry closed")
  })
})
