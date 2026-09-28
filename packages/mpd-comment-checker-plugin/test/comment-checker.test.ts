import { test, expect } from "bun:test"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { resolveBinary, hookInputFor, runCheck } from "../src/index.ts"

/**
 * The detector binary this checkout resolves; null when it is not installed here.
 * Every arm below is skipped unless SKIP is false, which is exactly the case in which this is a
 * path — so the call sites read it with a non-null assertion rather than adding a runtime guard.
 */
const BINARY: string | null = resolveBinary({})
/** Whether the suite must skip: the detector is a ~51MB optionalDependency, absent in a bare checkout. */
const SKIP = !BINARY || !existsSync(BINARY)

test.skipIf(SKIP)("binary resolves from toolchain", () => {
  expect(BINARY).toBeTruthy()
})

test.skipIf(SKIP)("comment file triggers detection (exit 2)", () => {
  /** The detector's verdict for a file whose only content is a line comment. */
  const res = runCheck(BINARY!, hookInputFor("/tmp/a.js", "// hello comment\nlet x = 1\n"), 30000)
  expect(res.hasComments).toBe(true)
  expect(res.message).toContain("COMMENT/DOCSTRING DETECTED")
})

test.skipIf(SKIP)("clean file passes (exit 0)", () => {
  /** The detector's verdict for a file with no comments at all. */
  const res = runCheck(BINARY!, hookInputFor("/tmp/b.js", "let x = 1\nconst y = 2\n"), 30000)
  expect(res.hasComments).toBe(false)
})
