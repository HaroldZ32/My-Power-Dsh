// NOTE (mpd adaptation): upstream imports createTwoFilesPatch from the npm
// `diff` package (BSD-3-Clause). To keep the vendored core dependency-free we
// bundle a minimal unified-diff generator below with the same call shape.
import { computeLineHash } from "./hash-computation"

/** Render `content` as one `LINE#HASH|content` anchor line per source line. */
// An empty file renders empty, and the trailing newline of a terminated file is preserved.
export function toHashlineContent(content: string): string {
	if (!content) return content
	// Source lines; a trailing "" is the file's final newline, not a line of its own.
	const lines = content.split("\n")
	// Last element of `lines`, which is "" exactly when the file ends with a newline.
	const lastLine = lines[lines.length - 1]
	// Whether the view must re-append "\n", so a terminated file stays terminated.
	const hasTrailingNewline = lastLine === ""
	// The real content lines, with that trailing empty element dropped.
	const contentLines = hasTrailingNewline ? lines.slice(0, -1) : lines
	// Anchor view lines, numbered from 1 to match the `LINE#HASH` anchors edits cite.
	const hashlined = contentLines.map((line, i) => {
		// 1-based source line number carried by this anchor, and the key the hash covers.
		const lineNum = i + 1
		// Per-line anchor hash; it changes whenever this line's text changes.
		const hash = computeLineHash(lineNum, line)
		return `${lineNum}#${hash}|${line}`
	})
	return hasTrailingNewline ? hashlined.join("\n") + "\n" : hashlined.join("\n")
}

// One run of the LCS walk: equal, deleted or inserted lines; `a`/`b` are 0-based source indices.
/** An LCS edit script step (equal / delete / insert) addressed by 0-based line index. */
type DiffOp = { t: "eq" | "del" | "ins"; a: number; b: number; lines: string[] }

/** Longest-common-subsequence edit script between two line arrays, as one op per line. */
function lcsOp(oldLines: string[], newLines: string[]): DiffOp[] {
  // Line count of the old side; the DP table is (n + 1) x (m + 1).
  const n = oldLines.length
  // Line count of the new side; indexed as dp[i][j] over the two line arrays.
  const m = newLines.length
  // Dynamic-programming LCS length table (O(n*m)); inputs are file-sized, so a
  // quadratic table is acceptable at the sizes this helper is used for.
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = oldLines[i] === newLines[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  // Edit script built by walking the table from the front, one op per consumed line.
  const ops: DiffOp[] = []
  // Read cursor into `oldLines`; advanced by an equal or deleted line.
  let i = 0
  // Read cursor into `newLines`; advanced by an equal or inserted line.
  let j = 0
  while (i < n && j < m) {
    if (oldLines[i] === newLines[j]) {
      ops.push({ t: "eq", a: i, b: j, lines: [oldLines[i]] })
      i++; j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ t: "del", a: i, b: j, lines: [oldLines[i]] })
      i++
    } else {
      ops.push({ t: "ins", a: i, b: j, lines: [newLines[j]] })
      j++
    }
  }
  while (i < n) { ops.push({ t: "del", a: i, b: j, lines: [oldLines[i]] }); i++ }
  while (j < m) { ops.push({ t: "ins", a: i, b: j, lines: [newLines[j]] }); j++ }
  return ops
}

/** Unified diff (git-style header + `@@` hunks with 3 context lines) between two file contents. */
export function generateUnifiedDiff(oldContent: string, newContent: string, filePath: string): string {
  // Old file split into lines; `split` keeps a trailing empty line, matching the diff output.
  const oldLines = oldContent.split("\n")
  // New file split into lines the same way, so both sides index identically.
  const newLines = newContent.split("\n")
  // The LCS edit script, the only input the hunk grouping below consumes.
  const ops = lcsOp(oldLines, newLines)
  // Context lines printed around each change; the conventional unified-diff value.
  const context = 3
  // Diff text under construction: `---`/`+++` headers first, then one block per hunk.
  const out: string[] = []
  out.push("--- " + filePath)
  out.push("+++ " + filePath)
  // Group ops into hunks with context; each hunk becomes one @@ header.
  // Op index where the next hunk scan starts; a hunk consumes everything it covered.
  let idx = 0
  while (idx < ops.length) {
    if (ops[idx].t === "eq") { idx++; continue }
    // First op of this hunk, walked back by at most `context` lines.
    const start = Math.max(0, idx - context)
    // Candidate end of this hunk's change region, widened below over equal runs.
    let end = idx + context
    while (end < ops.length && ops[end].t === "eq") end++
    end = Math.min(ops.length, end + context)
    // Running hunk counters and 0-based first-line markers for each side; the markers start at -1
    // because line index 0 is LEGAL, so 0 cannot double as the "unset" sentinel (a hunk whose first
    // op sits at the head of the file would otherwise be re-anchored by the next op).
    let aStart = -1, aCount = 0, bStart = -1, bCount = 0
    // Hunk body lines in diff order, each prefixed with ` `, `-` or `+`.
    const body: string[] = []
    for (const op of ops.slice(start, end)) {
      if (op.t === "eq") {
        aStart === -1 && (aStart = op.a); bStart === -1 && (bStart = op.b)
        aCount++; bCount++
        body.push(" " + op.lines[0])
      } else if (op.t === "del") {
        aStart === -1 && (aStart = op.a); bStart === -1 && (bStart = op.b)
        aCount++
        body.push("-" + op.lines[0])
      } else {
        aStart === -1 && (aStart = op.a); bStart === -1 && (bStart = op.b)
        bCount++
        body.push("+" + op.lines[0])
      }
    }
    // Unified-diff hunk positions are 1-based; empty old side uses bStart.
    const aPos = aCount ? aStart + 1 : 0
    // 1-based new-file position, or 0 for a hunk with no added lines.
    const bPos = bCount ? bStart + 1 : 0
    out.push("@@ -" + aPos + "," + aCount + " +" + bPos + "," + bCount + " @@")
    out.push(...body)
    idx = end
  }
  return out.join("\n") + "\n"
}

/** Counts of added and deleted lines, as a line-multiset delta rather than an LCS diff. */
export function countLineDiffs(oldContent: string, newContent: string): { additions: number; deletions: number } {
	// Old file's lines; the diff granularity is one whole line, never a character.
	const oldLines = oldContent.split("\n")
	// New file's lines, counted with the same granularity as the old side.
	const newLines = newContent.split("\n")

	// Occurrences of each old line, so a surplus over the new side reads as a deletion.
	const oldSet = new Map<string, number>()
	for (const line of oldLines) {
		oldSet.set(line, (oldSet.get(line) ?? 0) + 1)
	}

	// Occurrences of each new line, the mirror multiset the addition pass reads.
	const newSet = new Map<string, number>()
	for (const line of newLines) {
		newSet.set(line, (newSet.get(line) ?? 0) + 1)
	}

	// Deleted-line total: every occurrence the new file no longer has one for.
	let deletions = 0
	for (const [line, count] of oldSet) {
		// Occurrences of this line on the new side, 0 when the line disappeared entirely.
		const newCount = newSet.get(line) ?? 0
		if (count > newCount) {
			deletions += count - newCount
		}
	}

	// Added-line total: every occurrence the old file had no counterpart for.
	let additions = 0
	for (const [line, count] of newSet) {
		// Occurrences of this line on the old side, 0 when the line is entirely new.
		const oldCount = oldSet.get(line) ?? 0
		if (count > oldCount) {
			additions += count - oldCount
		}
	}

	return { additions, deletions }
}
