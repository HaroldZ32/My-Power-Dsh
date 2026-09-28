import { test, expect } from "bun:test"
import {
  toHashlineContent,
  applyHashlineEditsWithReport,
  generateUnifiedDiff,
  computeLineHash,
  HASHLINE_OUTPUT_PATTERN,
} from "../src/vendor/index.ts"

/** The `LINE#HASH` anchor for a 1-based line of `lines`, as the read view would print it. */
function anchorFor(lines: string[], line: number): string {
  return line + "#" + computeLineHash(line, lines[line - 1])
}

test("hashline view shows LINE#HASH|content", () => {
  // The view of a three-line file whose content ends with a newline.
  const view = toHashlineContent("alpha\nbeta\ngamma\n")
  // Non-empty view lines: the three source lines, since the trailing newline adds none.
  const lines = view.split("\n").filter((l) => l.length > 0)
  expect(lines[0]).toMatch(HASHLINE_OUTPUT_PATTERN)
  expect(lines[1]).toContain("|beta")
})

test("anchored replace on plain content", () => {
  // Fixture content: three plain lines with no trailing newline.
  const lines = ["line 1", "line 2", "line 3"]
  // Replace line 2 through its anchor; every other line must survive untouched.
  const report = applyHashlineEditsWithReport(lines.join("\n"), [{ op: "replace", pos: anchorFor(lines, 2), lines: "new line 2" }])
  expect(report.content).toBe("line 1\nnew line 2\nline 3")
  expect(report.noopEdits).toBe(0)
})

test("mismatched anchor throws", () => {
  expect(() => applyHashlineEditsWithReport("a\nb\nc\n", [{ op: "replace", pos: "2#ZZ", lines: "x" }])).toThrow()
})

test("append and prepend anchored", () => {
  // Two-line fixture with no trailing newline.
  const lines = ["one", "two"]
  // Append takes no anchor: it lands after the last line.
  const app = applyHashlineEditsWithReport(lines.join("\n"), [{ op: "append", lines: "three" }])
  expect(app.content.split("\n").filter(Boolean).length).toBe(3)
  // Prepend is anchored at line 1 here.
  const pre = applyHashlineEditsWithReport(lines.join("\n"), [{ op: "prepend", pos: anchorFor(lines, 1), lines: "zero" }])
  expect(pre.content).toBe("zero\none\ntwo")
})

test("replace range with end anchor", () => {
  // Four-line fixture, so the ranged replace leaves a line after it.
  const lines = ["a", "b", "c", "d"]
  // Replace the pos-to-end range (lines 2-3) with one line.
  const report = applyHashlineEditsWithReport(lines.join("\n"), [{ op: "replace", pos: anchorFor(lines, 2), end: anchorFor(lines, 3), lines: "X" }])
  expect(report.content).toBe("a\nX\nd")
})

test("unified diff shape", () => {
  // Diff of a one-line change, labelled with the file path.
  const d = generateUnifiedDiff("a\nb\nc", "a\nX\nc", "f.txt")
  expect(d).toContain("--- f.txt")
  expect(d).toContain("+++ f.txt")
  expect(d).toContain("@@")
  expect(d).toContain("-b")
  expect(d).toContain("+X")
})
