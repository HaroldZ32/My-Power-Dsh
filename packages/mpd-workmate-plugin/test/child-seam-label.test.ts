// THE WORKMATE CHILD SEAM'S IDENTITY RULE: a label is a workmate ONLY as its exact sanitized key.
//
// THE DEFECT THIS LOCKS (review finding, authorization class): the seam fed the child's label straight
// into `wmDir(label)`, which SANITIZES. A ROSTER child labelled "Explorer" therefore sanitized to
// `explorer` and could resolve to a workmate of that name — inheriting that record, including its
// `readonly` flag — so one seam would answer for the other seam's child.
import { describe, expect, test } from "bun:test"

import { workmateKeyFromLabel } from "../src/index"

describe("a workmate child is identified by its EXACT sanitized key", () => {
  test("a canonical key resolves to itself", () => {
    expect(workmateKeyFromLabel("a3-readonly-probe")).toBe("a3-readonly-probe")
    expect(workmateKeyFromLabel("deep-worker")).toBe("deep-worker")
  })

  test("a ROSTER name never resolves to a sanitized twin", () => {
    // Each of these WOULD have matched a workmate under the old sanitizing lookup.
    expect(workmateKeyFromLabel("Explorer")).toBeNull()
    expect(workmateKeyFromLabel("explorer ")).toBeNull()
    expect(workmateKeyFromLabel("Junior Engineer")).toBeNull()
    expect(workmateKeyFromLabel("Deep Worker")).toBeNull()
  })

  test("an empty, non-string or punctuation-only label is not a key", () => {
    expect(workmateKeyFromLabel("")).toBeNull()
    expect(workmateKeyFromLabel(undefined)).toBeNull()
    expect(workmateKeyFromLabel(null)).toBeNull()
    expect(workmateKeyFromLabel(42)).toBeNull()
    // Punctuation sanitizes away to something else, so it cannot be a canonical key either.
    expect(workmateKeyFromLabel("---")).toBeNull()
  })
})
