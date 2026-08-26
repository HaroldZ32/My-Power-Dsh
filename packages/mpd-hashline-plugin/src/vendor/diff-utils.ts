// NOTE (mpd adaptation): upstream imports createTwoFilesPatch from the npm
// `diff` package (BSD-3-Clause). To keep the vendored core dependency-free we
// bundle a minimal unified-diff generator below with the same call shape.
import { computeLineHash } from "./hash-computation"

export function toHashlineContent(content: string): string {
	if (!content) return content
	const lines = content.split("\n")
	const lastLine = lines[lines.length - 1]
	const hasTrailingNewline = lastLine === ""
	const contentLines = hasTrailingNewline ? lines.slice(0, -1) : lines
	const hashlined = contentLines.map((line, i) => {
		const lineNum = i + 1
		const hash = computeLineHash(lineNum, line)
		return `${lineNum}#${hash}|${line}`
	})
	return hasTrailingNewline ? hashlined.join("\n") + "\n" : hashlined.join("\n")
}

type DiffOp = { t: "eq" | "del" | "ins"; a: number; b: number; lines: string[] }

function lcsOp(oldLines: string[], newLines: string[]): DiffOp[] {
  const n = oldLines.length
  const m = newLines.length
  // Dynamic-programming LCS length table (O(n*m)); inputs are file-sized, so a
  // quadratic table is acceptable at the sizes this helper is used for.
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = oldLines[i] === newLines[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const ops: DiffOp[] = []
  let i = 0
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

export function generateUnifiedDiff(oldContent: string, newContent: string, filePath: string): string {
  const oldLines = oldContent.split("\n")
  const newLines = newContent.split("\n")
  const ops = lcsOp(oldLines, newLines)
  const context = 3
  const out: string[] = []
  out.push("--- " + filePath)
  out.push("+++ " + filePath)
  // Group ops into hunks with context; each hunk becomes one @@ header.
  let idx = 0
  while (idx < ops.length) {
    if (ops[idx].t === "eq") { idx++; continue }
    const start = Math.max(0, idx - context)
    let end = idx + context
    while (end < ops.length && ops[end].t === "eq") end++
    end = Math.min(ops.length, end + context)
    let aStart = 0, aCount = 0, bStart = 0, bCount = 0
    const body: string[] = []
    for (const op of ops.slice(start, end)) {
      if (op.t === "eq") {
        aStart === 0 && (aStart = op.a); bStart === 0 && (bStart = op.b)
        aCount++; bCount++
        body.push(" " + op.lines[0])
      } else if (op.t === "del") {
        aStart === 0 && (aStart = op.a); bStart === 0 && (bStart = op.b)
        aCount++
        body.push("-" + op.lines[0])
      } else {
        aStart === 0 && (aStart = op.a); bStart === 0 && (bStart = op.b)
        bCount++
        body.push("+" + op.lines[0])
      }
    }
    // Unified-diff hunk positions are 1-based; empty old side uses bStart.
    const aPos = aCount ? aStart + 1 : 0
    const bPos = bCount ? bStart + 1 : 0
    out.push("@@ -" + aPos + "," + aCount + " +" + bPos + "," + bCount + " @@")
    out.push(...body)
    idx = end
  }
  return out.join("\n") + "\n"
}

export function countLineDiffs(oldContent: string, newContent: string): { additions: number; deletions: number } {
	const oldLines = oldContent.split("\n")
	const newLines = newContent.split("\n")

	const oldSet = new Map<string, number>()
	for (const line of oldLines) {
		oldSet.set(line, (oldSet.get(line) ?? 0) + 1)
	}

	const newSet = new Map<string, number>()
	for (const line of newLines) {
		newSet.set(line, (newSet.get(line) ?? 0) + 1)
	}

	let deletions = 0
	for (const [line, count] of oldSet) {
		const newCount = newSet.get(line) ?? 0
		if (count > newCount) {
			deletions += count - newCount
		}
	}

	let additions = 0
	for (const [line, count] of newSet) {
		const oldCount = oldSet.get(line) ?? 0
		if (count > oldCount) {
			additions += count - oldCount
		}
	}

	return { additions, deletions }
}
