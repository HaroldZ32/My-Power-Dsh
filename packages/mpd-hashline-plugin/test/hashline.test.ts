import { test, expect } from "bun:test"
import {
  toHashlineContent,
  applyHashlineEditsWithReport,
  generateUnifiedDiff,
  computeLineHash,
  HASHLINE_OUTPUT_PATTERN,
} from "../src/vendor/index.ts"

function anchorFor(lines: string[], line: number): string {
  return line + "#" + computeLineHash(line, lines[line - 1])
}

test("hashline view shows LINE#HASH|content", () => {
  const view = toHashlineContent("alpha\nbeta\ngamma\n")
  const lines = view.split("\n").filter((l) => l.length > 0)
  expect(lines[0]).toMatch(HASHLINE_OUTPUT_PATTERN)
  expect(lines[1]).toContain("|beta")
})

test("anchored replace on plain content", () => {
  const lines = ["line 1", "line 2", "line 3"]
  const report = applyHashlineEditsWithReport(lines.join("\n"), [{ op: "replace", pos: anchorFor(lines, 2), lines: "new line 2" }])
  expect(report.content).toBe("line 1\nnew line 2\nline 3")
  expect(report.noopEdits).toBe(0)
})

test("mismatched anchor throws", () => {
  expect(() => applyHashlineEditsWithReport("a\nb\nc\n", [{ op: "replace", pos: "2#ZZ", lines: "x" }])).toThrow()
})

test("append and prepend anchored", () => {
  const lines = ["one", "two"]
  const app = applyHashlineEditsWithReport(lines.join("\n"), [{ op: "append", lines: "three" }])
  expect(app.content.split("\n").filter(Boolean).length).toBe(3)
  const pre = applyHashlineEditsWithReport(lines.join("\n"), [{ op: "prepend", pos: anchorFor(lines, 1), lines: "zero" }])
  expect(pre.content).toBe("zero\none\ntwo")
})

test("replace range with end anchor", () => {
  const lines = ["a", "b", "c", "d"]
  const report = applyHashlineEditsWithReport(lines.join("\n"), [{ op: "replace", pos: anchorFor(lines, 2), end: anchorFor(lines, 3), lines: "X" }])
  expect(report.content).toBe("a\nX\nd")
})

test("unified diff shape", () => {
  const d = generateUnifiedDiff("a\nb\nc", "a\nX\nc", "f.txt")
  expect(d).toContain("--- f.txt")
  expect(d).toContain("+++ f.txt")
  expect(d).toContain("@@")
  expect(d).toContain("-b")
  expect(d).toContain("+X")
})
