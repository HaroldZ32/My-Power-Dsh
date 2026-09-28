import { dedupeEdits } from "./edit-deduplication"
import { collectLineRefs, detectOverlappingRanges, getEditLineNumber } from "./edit-ordering"
import type { HashlineEdit } from "./types"
import {
  applyAppend,
  applyInsertAfter,
  applyInsertBefore,
  applyPrepend,
  applyReplaceLines,
  applySetLine,
} from "./edit-operation-primitives"
import { validateLineRefs } from "./validation"

/** Whether two line arrays hold the same lines in the same order; used to detect a no-op edit. */
function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

/** Outcome of one batch: the resulting content plus the counters the tool reports back. */
export interface HashlineApplyReport {
  /** File content after every edit in the batch has been applied. */
  content: string
  /** Edits that changed nothing because the replacement equalled the existing lines. */
  noopEdits: number
  /** Duplicate edits removed before any edit ran. */
  deduplicatedEdits: number
}

/** Apply every edit to `content`, returning the new content together with the noop/dedupe counters. */
export function applyHashlineEditsWithReport(content: string, edits: HashlineEdit[]): HashlineApplyReport {
  if (edits.length === 0) {
    return {
      content,
      noopEdits: 0,
      deduplicatedEdits: 0,
    }
  }

  // Deduplicated edit list, plus the number of duplicates it dropped.
  const dedupeResult = dedupeEdits(edits)
  // Tie-break order for edits anchored on the same line: replace, then append, then prepend.
  const EDIT_PRECEDENCE: Record<string, number> = { replace: 0, append: 1, prepend: 2 }
  // Edits applied bottom-up (highest line first) so one splice cannot shift a later anchor;
  // same-line ties follow EDIT_PRECEDENCE and an op missing from it sinks to the end.
  const sortedEdits = [...dedupeResult.edits].sort((a, b) => {
    // Line number of the first edit under comparison.
    const lineA = getEditLineNumber(a)
    // Line number of the second edit under comparison.
    const lineB = getEditLineNumber(b)
    if (lineB !== lineA) return lineB - lineA
    return (EDIT_PRECEDENCE[a.op] ?? 3) - (EDIT_PRECEDENCE[b.op] ?? 3)
  })

  // Count of edits that left the line array unchanged.
  let noopEdits = 0

  // Working line buffer; an empty file is zero lines, so a lone "" is not invented for it.
  let lines = content.length === 0 ? [] : content.split("\n")

  // Every anchor the batch references, validated once before any edit is applied.
  const refs = collectLineRefs(sortedEdits)
  validateLineRefs(lines, refs)

  // Message naming the first pair of overlapping multi-line replace ranges, or null when none do.
  const overlapError = detectOverlappingRanges(sortedEdits)
  if (overlapError) throw new Error(overlapError)

  for (const edit of sortedEdits) {
    switch (edit.op) {
      case "replace": {
        // Lines after this replace, or an unchanged copy when the replacement changed nothing.
        const next = edit.end
          ? applyReplaceLines(lines, edit.pos, edit.end, edit.lines, { skipValidation: true })
          : applySetLine(lines, edit.pos, edit.lines, { skipValidation: true })
        if (arraysEqual(next, lines)) {
          noopEdits += 1
          break
        }
        lines = next
        break
      }
      case "append": {
        // Lines after this anchored insert or file-end append, or an unchanged copy when equal.
        const next = edit.pos
          ? applyInsertAfter(lines, edit.pos, edit.lines, { skipValidation: true })
          : applyAppend(lines, edit.lines)
        if (arraysEqual(next, lines)) {
          noopEdits += 1
          break
        }
        lines = next
        break
      }
      case "prepend": {
        // Lines after this anchored insert or file-start prepend, or an unchanged copy when equal.
        const next = edit.pos
          ? applyInsertBefore(lines, edit.pos, edit.lines, { skipValidation: true })
          : applyPrepend(lines, edit.lines)
        if (arraysEqual(next, lines)) {
          noopEdits += 1
          break
        }
        lines = next
        break
      }
    }
  }

  return {
    content: lines.join("\n"),
    noopEdits,
    deduplicatedEdits: dedupeResult.deduplicatedEdits,
  }
}

/** Content-only variant of the batch applier, discarding the counters the report carries. */
export function applyHashlineEdits(content: string, edits: HashlineEdit[]): string {
  return applyHashlineEditsWithReport(content, edits).content
}
