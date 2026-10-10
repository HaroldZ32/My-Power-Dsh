// `restrictToolsTolerant` ARMS (contract `.mpd/plans/delegation-gate.md`, D3/R3).
//
// WHAT THESE LOCK OUT: one unregistered name killing EVERY read-only spawn. The harness's
// `tools.restrict()` rejects the WHOLE list when a single name is unknown
// (`tools.restrict() names unknown global tool[s] "…"; known global tools: …`) and offers no
// ignore-unknown option, so the helper's contract is: the harness's own rejection is the ONLY pruner,
// exactly ONE pruning round is allowed, and every other outcome is rethrown loudly.
//
// The doubles below throw the REAL message shape, copied from
// `@deepseek-ai/dsh-tools/lib/index.js` (the `restrict(filter)` method).
import { describe, expect, test } from "bun:test"

import { restrictToolsTolerant } from "../src/index.ts"
import type { RestrictAttempt } from "../src/index.ts"

/** The canonical eight-name deny list the roster and the workmate library both ship. */
const CANONICAL: readonly string[] = [
  "write",
  "edit",
  "mpd_hashline_edit",
  "bash",
  "mcp__ast_grep__rewrite",
  "mcp__ast_grep__scan",
  "mcp__lsp__rename_symbol",
  "mcp__lsp__rename_symbol_strict",
]

/** The two names a profile without `cclsp` does not register — the measured F2 rejection. */
const UNKNOWN: readonly string[] = ["mcp__lsp__rename_symbol", "mcp__lsp__rename_symbol_strict"]

/**
 * The harness's own rejection message, in the shape `dsh-tools` composes it.
 *
 * @param unknown - the names the harness reports as unknown.
 * @param known - the names it prints as the known set (never read as a verdict).
 * @returns the message one rejected `restrict` call throws.
 */
function unknownNamesMessage(unknown: readonly string[], known: readonly string[] = ["write", "edit", "bash"]): string {
  return "tools.restrict() names unknown global tool" + (unknown.length > 1 ? "s" : "")
    + " " + unknown.map((name) => `"${name}"`).join(", ")
    + "; known global tools: " + known.join(", ")
}

describe("D3 — restrictToolsTolerant: the harness's verdict is the only pruner", () => {
  test("a list the harness accepts is returned unchanged, and the probe restriction is released", () => {
    /** Every list the attempt was handed, in order. */
    const attempts: string[][] = []
    /** How many times the attempt's disposer ran. */
    let released = 0
    /** The attempt double: accept everything, return a disposer. */
    const attempt: RestrictAttempt = (names: readonly string[]): (() => void) | undefined => {
      attempts.push([...names])
      return () => { released += 1 }
    }
    /** The helper's verdict on the canonical list. */
    const outcome = restrictToolsTolerant(attempt, CANONICAL)
    expect([...outcome.applied]).toEqual([...CANONICAL])
    expect(outcome.pruned).toEqual([])
    expect(attempts).toHaveLength(1)
    // The restriction a probe applies must not linger on the caller's scope.
    expect(released).toBe(1)
    // The canonical input is never mutated.
    expect([...CANONICAL]).toEqual(["write", "edit", "mpd_hashline_edit", "bash", "mcp__ast_grep__rewrite", "mcp__ast_grep__scan", "mcp__lsp__rename_symbol", "mcp__lsp__rename_symbol_strict"])
  })

  test("the unknown names are pruned and retried ONCE, keeping the canonical order of the survivors", () => {
    /** Every list the attempt was handed, in order. */
    const attempts: string[][] = []
    /** The attempt double: reject the two `mcp__lsp__*` names until they are gone. */
    const attempt: RestrictAttempt = (names: readonly string[]): (() => void) | undefined => {
      attempts.push([...names])
      /** The names in THIS candidate that the fake harness does not know. */
      const rejected = names.filter((name) => UNKNOWN.includes(name))
      if (rejected.length > 0) throw new Error(unknownNamesMessage(rejected))
      return () => {}
    }
    /** The helper's verdict. */
    const outcome = restrictToolsTolerant(attempt, CANONICAL)
    expect(outcome.pruned).toEqual([...UNKNOWN])
    expect([...outcome.applied]).toEqual([
      "write",
      "edit",
      "mpd_hashline_edit",
      "bash",
      "mcp__ast_grep__rewrite",
      "mcp__ast_grep__scan",
    ])
    // TWO attempts: the canonical list, then the pruned one — the contract's exactly-one retry.
    expect(attempts).toHaveLength(2)
    expect(attempts[1]).toEqual([...outcome.applied])
  })

  test("a SINGLE unknown name is parsed too (the harness's singular message spelling)", () => {
    /** The attempt double, rejecting exactly one name. */
    const attempt: RestrictAttempt = (names: readonly string[]): (() => void) | undefined => {
      if (names.includes("mcp__lsp__rename_symbol")) throw new Error(unknownNamesMessage(["mcp__lsp__rename_symbol"]))
      return () => {}
    }
    /** The helper's verdict on the canonical list, with exactly one name pruned. */
    const outcome = restrictToolsTolerant(attempt, CANONICAL)
    expect(outcome.pruned).toEqual(["mcp__lsp__rename_symbol"])
    expect(outcome.applied).toHaveLength(7)
  })

  test("a SECOND failure is rethrown, whatever it is (the retry cap)", () => {
    /** How many attempts were made before the helper gave up. */
    let calls = 0
    /** The attempt double: always rejects, so the retry also fails. */
    const attempt: RestrictAttempt = (): (() => void) | undefined => {
      calls += 1
      throw new Error(unknownNamesMessage(UNKNOWN))
    }
    expect(() => restrictToolsTolerant(attempt, CANONICAL)).toThrow(/names unknown global tools/)
    // The cap is exact: canonical attempt + ONE retry, never a loop.
    expect(calls).toBe(2)
  })

  test("any OTHER failure is rethrown with no retry at all", () => {
    /** How many attempts were made. */
    let calls = 0
    /** The attempt double: a failure the helper must not treat as a prunable rejection. */
    const attempt: RestrictAttempt = (): (() => void) | undefined => {
      calls += 1
      throw new Error("tools.restrict() requires a scoped context (agent.ctx)")
    }
    expect(() => restrictToolsTolerant(attempt, CANONICAL)).toThrow(/requires a scoped context/)
    expect(calls).toBe(1)
  })

  test("a rejection that names nothing prunable is rethrown rather than retried blindly", () => {
    /** How many attempts were made. */
    let calls = 0
    /** The attempt double: names a tool that is not in the candidate list. */
    const attempt: RestrictAttempt = (): (() => void) | undefined => {
      calls += 1
      throw new Error(unknownNamesMessage(["some_other_tool"]))
    }
    expect(() => restrictToolsTolerant(attempt, CANONICAL)).toThrow(/some_other_tool/)
    expect(calls).toBe(1)
  })

  test("a non-Error rejection carrying the message text is parsed as well", () => {
    /** The attempt double: rejects with a bare string, the shape a host may throw. */
    const attempt: RestrictAttempt = (names: readonly string[]): (() => void) | undefined => {
      /** The names of THIS candidate the fake harness does not know. */
      const rejected = names.filter((name) => UNKNOWN.includes(name))
      if (rejected.length > 0) throw unknownNamesMessage(rejected)
      return undefined
    }
    /** The helper's verdict, which must prune even for a non-Error rejection. */
    const outcome = restrictToolsTolerant(attempt, CANONICAL)
    expect(outcome.pruned).toEqual([...UNKNOWN])
    expect(outcome.applied).toHaveLength(6)
  })

  test("an attempt that applies nothing and returns no disposer is still an acceptance", () => {
    /** The attempt double: a harness that applies silently. */
    const attempt: RestrictAttempt = (): (() => void) | undefined => undefined
    /** The helper's verdict on a one-name list. */
    const outcome = restrictToolsTolerant(attempt, ["write"])
    expect([...outcome.applied]).toEqual(["write"])
    expect(outcome.pruned).toEqual([])
  })
})
