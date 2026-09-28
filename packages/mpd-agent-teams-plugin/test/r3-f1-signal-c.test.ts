// t24 repair r2 — F1: signal C is ONE signal that requires its own 2-of-3 majority.
//
// Measured before the fix: C1/C2/C3 were three independent TOP-LEVEL signals, so the
// reviewer's ordinary request "Check the test, build the package, verify the output."
// reached matchedSignals >= 2 and auto-provisioned a team.
//
// Measured property of the FROZEN prompt set (do not "fix" it here): that sentence and
// the frozen complex prompt #1 satisfy the SAME sub-signals (C2 + C3, no C1/B/D/flag),
// so under any C-only rule they are indistinguishable. The captain's Option A ruling
// therefore accepts that both route; the simple prompts (all sub-signals false) stay
// silent, which is the direction the two-sided case pins.
//
// ULW wave, clause 4 / D1 (t5 of the gate lane): "routes" no longer means "provisions". A SOFT
// trigger now returns `advise` and stages NOTHING; only an explicit `team:` / `!team` request
// (signal A) still provisions. The gate VERDICT asserted below is unchanged — the C aggregation
// fix this file guards is untouched.
import { expect, test } from "bun:test"
// The adopted agent-teams body is vendored JavaScript with no declaration file, so the gate
// module cannot be typed without re-authoring upstream; this import is expected to be untyped.
// @ts-expect-error vendored JavaScript has no declaration file
import { consumeExplicitFlag, evaluateComplexityGate, routeDecision } from "../lib/session-start.js"

/** The frozen silent prompts: every sub-signal is false, so no team may be staged for them. */
const SIMPLE = [
    "Reply with exactly: hello-ok",
    "What does the git-master skill do? Answer in one sentence.",
    "Rename the variable `foo` to `bar` in src/util.ts and run its test.",
]
/** The frozen triggered prompts: two carry a soft signal, one carries the explicit `team:` flag. */
const COMPLEX = [
    "Align the bundle with upstream: audit the orchestration surface, then implement the routing change.",
    "team: fix the flaky test",
    "1. Read the patch file\n2. Audit the gates\n3. Implement the change\n4. Verify the boot",
]

test("F1: C requires its own 2-of-3 majority, and never appears as C1/C2/C3 top-level signals", () => {
    // a single C sub-signal is not enough for C
    /** Verdict for one C sub-signal alone, which must not aggregate into the C signal. */
    const oneSub: { trigger: boolean; signals: string[] } = evaluateComplexityGate("check the test", {})
    expect(oneSub.signals).not.toContain("C")
    // the 2-of-3 majority yields exactly one "C" — never "C1"/"C2"/"C3" entries
    /** Verdict for the C2+C3 prompt, whose majority must yield exactly one aggregated C. */
    const twoOfThree: { trigger: boolean; signals: string[] } = evaluateComplexityGate("Align the bundle with upstream: audit the orchestration surface, then implement the routing change.", {})
    expect(twoOfThree.signals).toEqual(["C"])
    // a different majority path (C1 + C2, predicate C3) also yields exactly one C
    /** Verdict for the numbered C1+C2 prompt, the second majority path to the same single C. */
    const numbered: { trigger: boolean; signals: string[] } = evaluateComplexityGate("1. add\n2. build\n3. change", {})
    expect(numbered.signals).toEqual(["C"])
})

test("F1: no route from C1/C2/C3 as separate signals (the pre-fix false-positive shape)", () => {
    // The reviewer's sentence is a verb sequence; it must NOT be counted as two
    // top-level C signals. Under Option A it routes as a single-C case, so this
    // assertion pins the SIGNAL SHAPE (one "C"), which is what F1 was about.
    /** Verdict for the reviewer's verb-sequence sentence, the pre-fix false-positive shape. */
    const verdict: { trigger: boolean; signals: string[] } = evaluateComplexityGate("Check the test, build the package, verify the output.", {})
    expect(verdict.signals).toEqual(["C"])
    expect(verdict.signals.filter((signal) => signal.startsWith("C")).length).toBe(1)
})

test("F1: the frozen two-sided prompt set still behaves 3 silent / 3 complex", async () => {
    for (const prompt of SIMPLE) {
        /** Verdict for the silent prompt under test, which must trigger nothing. */
        const verdict: { trigger: boolean; signals: string[] } = evaluateComplexityGate(prompt, {})
        expect(verdict.trigger).toBe(false)
        expect((await routeDecision({ mode: "off", autoRoute: true }, prompt, "/nonexistent-ws")).action).toBe("none")
    }
    // The route ACTION is now split: an explicit flag provisions (R4), a soft trigger advises.
    /** The per-prompt action the ULW wave froze: the explicit flag provisions, a soft trigger advises. */
    const EXPECTED_ACTION = [
        { prompt: COMPLEX[0], action: "advise" },
        { prompt: COMPLEX[1], action: "provision" },
        { prompt: COMPLEX[2], action: "advise" },
    ]
    for (const { prompt, action } of EXPECTED_ACTION) {
        // mirror the real call: the explicit `team:` marker is consumed first
        /** The prompt with its `team:` marker consumed, mirroring the real call order. */
        const consumed: { flagged: boolean; text: string } = consumeExplicitFlag(prompt)
        /** Verdict for the flag-consumed prompt, which must trigger the gate. */
        const verdict: { trigger: boolean; signals: string[] } = evaluateComplexityGate(consumed.text, { explicitFlag: consumed.flagged, planArtifact: false })
        expect(verdict.trigger).toBe(true)
        /** The routing decision the plugin would take for this prompt and workspace. */
        const routed: { action: string; signals: string[] } = await routeDecision({ mode: "off", autoRoute: true }, prompt, "/nonexistent-ws")
        expect(routed.action).toBe(action)
        // the fired signals are still carried on BOTH actions — the advisory names them
        expect(routed.signals.length).toBeGreaterThanOrEqual(1)
    }
})

test("F1: a plan artifact is its own soft signal and reaches the gate", () => {
    expect(evaluateComplexityGate("do the thing", { planArtifact: true })).toEqual({ trigger: true, signals: ["D"] })
    // the plan-artifact signal alone does not manufacture a C
    expect(evaluateComplexityGate("do the thing", { planArtifact: true }).signals).not.toContain("C")
})
