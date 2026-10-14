// ---------------------------------------------------------------------------------------------
// MIT NOTICE — this file is a TypeScript port of the DESIGN of `crates/pi-edit` from the project
// `can1357/oh-my-pi` (https://github.com/can1357/oh-my-pi), reached at commit
// 602b6c812fa9ef774f359f1e399a09d30ee2eaca. That crate is licensed MIT at the workspace manifest's
// `[workspace.package] license = "MIT"`; the upstream `LICENSE` carries the text reproduced below.
//
// MIT License
//
// Copyright (c) 2025 Mario Zechner
// Copyright (c) 2025-2026 Can Bölük
// Copyright (c) 2026 Stencil Labs, Inc.
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
// ---------------------------------------------------------------------------------------------
// Hashline core: the read-side view and the unified diff an edit reports.
//
// Design ported from the hashline mode of `crates/pi-edit`: the read view renders one addressable
// anchor line per source line (pi-edit's `split_addressable_file_lines` pops the trailing empty
// element a terminated file would otherwise contribute), and the diff is the conventional unified
// form with three context lines, which is the default pi-edit's `unified` uses.

import { computeLineHash } from "./hash"

/** Context lines printed around each change; the conventional unified-diff value, and pi-edit's default. */
const DIFF_CONTEXT = 3

/** One step of the diff script; `a` and `b` are 0-based line indices into the two sides. */
type DiffOp = {
  /** Step kind: an unchanged line, a deletion from the old side, or an insertion from the new side. */
  t: "eq" | "del" | "ins"
  /** 0-based index into the OLD line array. */
  a: number
  /** 0-based index into the NEW line array. */
  b: number
  /** The line's text, as one entry. */
  lines: string[]
}

/**
 * Render `content` as one `LINE#HASH|content` anchor line per source line.
 *
 * @param content - the file's canonical, LF-only text.
 * @returns the view; an empty file renders empty, and a terminated file stays terminated so its
 *   final newline is a TERMINATOR rather than an extra, anchor-less line.
 */
export function toHashlineContent(content: string): string {
  if (!content) return content
  /** Source lines; a trailing "" is the file's final newline, not a line of its own. */
  const lines = content.split("\n")
  /** Last element, which is "" exactly when the file ends with a newline. */
  const lastLine = lines[lines.length - 1]
  /** Whether the view must re-append "\n" so a terminated file stays terminated. */
  const hasTrailingNewline = lastLine === ""
  /** The addressable content lines, with that trailing empty element dropped. */
  const contentLines = hasTrailingNewline ? lines.slice(0, -1) : lines
  /** Anchor view lines, numbered from 1 to match the anchors an edit cites. */
  const hashlined = contentLines.map((line, index) => {
    /** 1-based source line number this anchor carries, and the key its digest covers. */
    const lineNumber = index + 1
    /** Per-line digest; it changes whenever this line's text changes. */
    const hash = computeLineHash(lineNumber, line)
    return `${lineNumber}#${hash}|${line}`
  })
  return hasTrailingNewline ? hashlined.join("\n") + "\n" : hashlined.join("\n")
}

/**
 * Longest-common-subsequence edit script between two line arrays, one op per line.
 *
 * @param oldLines - the old side's lines.
 * @param newLines - the new side's lines.
 * @returns the script, in file order; ties prefer a deletion, so a replace reads as `-old` then `+new`.
 */
function lcsOp(oldLines: string[], newLines: string[]): DiffOp[] {
  /** Line count of the old side; the table is `(n + 1) x (m + 1)`. */
  const n = oldLines.length
  /** Line count of the new side. */
  const m = newLines.length
  // The table is O(n*m); file-sized inputs are what this helper is used for, so that is acceptable.
  /** Dynamic-programming table of LCS lengths, read back to front. */
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = oldLines[i] === newLines[j] ? (dp[i + 1]![j + 1] ?? 0) + 1 : Math.max(dp[i + 1]![j] ?? 0, dp[i]![j + 1] ?? 0)
    }
  }
  /** Edit script built by walking the table from the front, one op per consumed line. */
  const ops: DiffOp[] = []
  /** Read cursor into `oldLines`; advanced by an equal or deleted line. */
  let i = 0
  /** Read cursor into `newLines`; advanced by an equal or inserted line. */
  let j = 0
  while (i < n && j < m) {
    if (oldLines[i] === newLines[j]) {
      ops.push({ t: "eq", a: i, b: j, lines: [oldLines[i] ?? ""] })
      i++
      j++
    } else if ((dp[i + 1]![j] ?? 0) >= (dp[i]![j + 1] ?? 0)) {
      ops.push({ t: "del", a: i, b: j, lines: [oldLines[i] ?? ""] })
      i++
    } else {
      ops.push({ t: "ins", a: i, b: j, lines: [newLines[j] ?? ""] })
      j++
    }
  }
  while (i < n) {
    ops.push({ t: "del", a: i, b: j, lines: [oldLines[i] ?? ""] })
    i++
  }
  while (j < m) {
    ops.push({ t: "ins", a: i, b: j, lines: [newLines[j] ?? ""] })
    j++
  }
  return ops
}

/**
 * Group the script into hunks, so changes close enough to share context land in ONE hunk.
 *
 * @param ops - the edit script.
 * @param context - context lines printed on either side of a change.
 * @returns half-open `[start, end)` op ranges, in file order.
 */
function groupHunks(ops: DiffOp[], context: number): { start: number; end: number }[] {
  /** Indices of every op that is not an unchanged line. */
  const changes: number[] = []
  for (let index = 0; index < ops.length; index++) {
    if (ops[index]?.t !== "eq") changes.push(index)
  }
  if (changes.length === 0) return []

  /** Hunks under construction. */
  const hunks: { start: number; end: number }[] = []
  /** First change index of the hunk being built. */
  let first = changes[0] ?? 0
  /** Last change index of the hunk being built. */
  let last = first
  for (const index of changes.slice(1)) {
    // Two changes share a hunk when their context windows would touch or overlap.
    if (index - last <= context * 2 + 1) {
      last = index
      continue
    }
    hunks.push({ start: Math.max(0, first - context), end: Math.min(ops.length, last + context + 1) })
    first = index
    last = index
  }
  hunks.push({ start: Math.max(0, first - context), end: Math.min(ops.length, last + context + 1) })
  return hunks
}

/**
 * Unified diff between two file contents, with `---`/`+++` headers and `@@` hunks.
 *
 * @param oldContent - the file's text before the edit.
 * @param newContent - the file's text after the edit.
 * @param filePath - the label printed on both header lines.
 * @returns the diff text, newline-terminated; an unchanged pair yields just the two headers.
 */
export function generateUnifiedDiff(oldContent: string, newContent: string, filePath: string): string {
  /** Old file split into lines; a trailing element is kept, so a terminated file has one more entry. */
  const oldLines = oldContent.split("\n")
  /** New file split the same way, so both sides index identically. */
  const newLines = newContent.split("\n")
  /** The LCS edit script, the only input the hunk grouping consumes. */
  const ops = lcsOp(oldLines, newLines)
  /** Diff text under construction: the two headers first, then one block per hunk. */
  const out: string[] = []
  out.push("--- " + filePath)
  out.push("+++ " + filePath)

  for (const hunk of groupHunks(ops, DIFF_CONTEXT)) {
    // `-1` rather than `0` as the "unset" marker, because line index 0 is LEGAL: a hunk at the head of
    // the file would otherwise be re-anchored by the second op it contains.
    /** 0-based first old-file line this hunk prints, or -1 before the first op is seen. */
    let aStart = -1
    /** Old-file lines this hunk prints. */
    let aCount = 0
    /** 0-based first new-file line this hunk prints, or -1 before the first op is seen. */
    let bStart = -1
    /** New-file lines this hunk prints. */
    let bCount = 0
    /** Hunk body lines, each prefixed with ` `, `-` or `+`. */
    const body: string[] = []

    for (const op of ops.slice(hunk.start, hunk.end)) {
      if (aStart === -1) aStart = op.a
      if (bStart === -1) bStart = op.b
      if (op.t === "eq") {
        aCount++
        bCount++
        body.push(" " + (op.lines[0] ?? ""))
      } else if (op.t === "del") {
        aCount++
        body.push("-" + (op.lines[0] ?? ""))
      } else {
        bCount++
        body.push("+" + (op.lines[0] ?? ""))
      }
    }

    // Unified-diff positions are 1-based; a side with no lines at all is spelled `0,0`.
    /** 1-based first old-file line of this hunk. */
    const aPos = aCount ? aStart + 1 : 0
    /** 1-based first new-file line of this hunk. */
    const bPos = bCount ? bStart + 1 : 0
    out.push("@@ -" + aPos + "," + aCount + " +" + bPos + "," + bCount + " @@")
    out.push(...body)
  }

  return out.join("\n") + "\n"
}
