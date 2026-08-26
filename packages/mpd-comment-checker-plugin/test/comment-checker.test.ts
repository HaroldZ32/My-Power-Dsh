import { test, expect } from "bun:test"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { resolveBinary, hookInputFor, runCheck } from "../src/index.ts"

const BINARY = resolveBinary({})
const SKIP = !BINARY || !existsSync(BINARY)

test.skipIf(SKIP)("binary resolves from toolchain", () => {
  expect(BINARY).toBeTruthy()
})

test.skipIf(SKIP)("comment file triggers detection (exit 2)", () => {
  const res = runCheck(BINARY, hookInputFor("/tmp/a.js", "// hello comment\nlet x = 1\n"), 30000)
  expect(res.hasComments).toBe(true)
  expect(res.message).toContain("COMMENT/DOCSTRING DETECTED")
})

test.skipIf(SKIP)("clean file passes (exit 0)", () => {
  const res = runCheck(BINARY, hookInputFor("/tmp/b.js", "let x = 1\nconst y = 2\n"), 30000)
  expect(res.hasComments).toBe(false)
})
