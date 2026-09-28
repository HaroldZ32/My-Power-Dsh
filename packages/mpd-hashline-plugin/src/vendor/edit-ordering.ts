import { parseLineRef } from "./validation"
import type { HashlineEdit } from "./types"

/**
 * Sort key for the bottom-up application order: the line the edit is anchored on. A range replace
 * reports its END line because that is where its splice reaches, an unanchored append/prepend reports
 * -Infinity so it is applied last, and an unknown op reports +Infinity so it is applied first.
 */
export function getEditLineNumber(edit: HashlineEdit): number {
  switch (edit.op) {
    case "replace":
      return parseLineRef(edit.end ?? edit.pos).line
    case "append":
      return edit.pos ? parseLineRef(edit.pos).line : Number.NEGATIVE_INFINITY
    case "prepend":
      return edit.pos ? parseLineRef(edit.pos).line : Number.NEGATIVE_INFINITY
    default:
      return Number.POSITIVE_INFINITY
  }
}

/**
 * Every anchor the batch references — both ends of a range replace, the `pos` of a single-line
 * replace, the anchor of an anchored append/prepend and nothing at all for a file-end append or a
 * file-start prepend — so the whole batch can be validated once before any edit is applied.
 */
export function collectLineRefs(edits: HashlineEdit[]): string[] {
  return edits.flatMap((edit) => {
    switch (edit.op) {
      case "replace":
        return edit.end ? [edit.pos, edit.end] : [edit.pos]
      case "append":
      case "prepend":
        return edit.pos ? [edit.pos] : []
      default:
        return []
    }
  })
}

/**
 * Message naming the first pair of overlapping multi-line replace ranges, or null when none overlap.
 * Only a replace carrying an explicit `end` is a range; two ranges that share a line overlap while
 * merely abutting ones do not. Edits are named by their 1-based position in `edits`, which is why
 * each span carries its original index.
 */
export function detectOverlappingRanges(edits: HashlineEdit[]): string | null {
  /** Inclusive line span of every range replace, with its index in `edits` for the message. */
  const ranges: { start: number; end: number; idx: number }[] = []
  for (let i = 0; i < edits.length; i++) {
    /** The edit under inspection; only a range replace contributes a span. */
    const edit = edits[i]
    if (edit.op !== "replace" || !edit.end) continue
    /** First line of the range, parsed out of the `pos` anchor. */
    const start = parseLineRef(edit.pos).line
    /** Last line of the range, parsed out of the `end` anchor. */
    const end = parseLineRef(edit.end).line
    ranges.push({ start, end, idx: i })
  }
  if (ranges.length < 2) return null

  ranges.sort((a, b) => a.start - b.start || a.end - b.end)
  for (let i = 1; i < ranges.length; i++) {
    /** The earlier-starting range of the pair being compared. */
    const prev = ranges[i - 1]
    /** The later-starting range, which overlaps when it begins at or before `prev` ends. */
    const curr = ranges[i]
    if (curr.start <= prev.end) {
      return (
        `Overlapping range edits detected: ` +
        `edit ${prev.idx + 1} (lines ${prev.start}-${prev.end}) overlaps with ` +
        `edit ${curr.idx + 1} (lines ${curr.start}-${curr.end}). ` +
        `Use pos-only replace for single-line edits.`
      )
    }
  }
  return null
}
