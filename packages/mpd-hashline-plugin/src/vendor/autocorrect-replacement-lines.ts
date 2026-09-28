/** Whitespace-free matching key for a line or a joined span; interior spacing is removed too. */
function normalizeTokens(text: string): string {
  return text.replace(/\s+/g, "")
}

/** The callers' spelling of the same whitespace-free key, used to compare a line or a joined span. */
function stripAllWhitespace(text: string): string {
  return normalizeTokens(text)
}

/** Drop one dangling continuation token — `&&`, `||`, `??`, `?`, `:`, `=`, `,`, `+`, `-`, `*`, `/`, `.` or `(` — plus the whitespace after it. */
export function stripTrailingContinuationTokens(text: string): string {
  return text.replace(/(?:&&|\|\||\?\?|\?|:|=|,|\+|-|\*|\/|\.|\()\s*$/u, "")
}

/** Remove the merge-operator characters `|`, `&` and `?` anywhere in the text, for a fuzzy containment test. */
export function stripMergeOperatorChars(text: string): string {
  return text.replace(/[|&?]/g, "")
}

/** Leading whitespace run of `text`, or "" when the line is empty or starts unindented. */
function leadingWhitespace(text: string): string {
  if (!text) return ""
  // `/^\s*/` always matches, so the null branch only satisfies the type checker.
  const match = text.match(/^\s*/)
  return match ? match[0] : ""
}

/**
 * Re-join replacement lines that were wrapped apart back into the single original line they came
 * from. Only a 2..10 line window that reproduces an original line occurring EXACTLY once, and whose
 * canonical form no other candidate claims, is collapsed; splices run bottom-up so the spans still
 * ahead keep their indices.
 */
export function restoreOldWrappedLines(originalLines: string[], replacementLines: string[]): string[] {
  if (originalLines.length === 0 || replacementLines.length < 2) return replacementLines

  /** Whitespace-free original line → its text and how often it occurred; a count above 1 is ambiguous. */
  const canonicalToOriginal = new Map<string, { line: string; count: number }>()
  for (const line of originalLines) {
    /** Whitespace-free form of this original line, i.e. the lookup key. */
    const canonical = stripAllWhitespace(line)
    /** Entry already recorded for that key, whose count is incremented instead of overwritten. */
    const existing = canonicalToOriginal.get(canonical)
    if (existing) {
      existing.count += 1
    } else {
      canonicalToOriginal.set(canonical, { line, count: 1 })
    }
  }

  /** Every 2..10 line window of the replacement that reproduces one unique original line. */
  const candidates: { start: number; len: number; replacement: string; canonical: string }[] = []
  for (let start = 0; start < replacementLines.length; start += 1) {
    for (let len = 2; len <= 10 && start + len <= replacementLines.length; len += 1) {
      /** The replacement-line window under test, shortest span first. */
      const span = replacementLines.slice(start, start + len)
      if (span.some((line) => line.trim().length === 0)) continue
      /** Whitespace-free join of the window; a span shorter than 6 characters is too short to trust. */
      const canonicalSpan = stripAllWhitespace(span.join(""))
      /** The unique original line this window reproduces, or undefined when it reproduces none. */
      const original = canonicalToOriginal.get(canonicalSpan)
      if (original && original.count === 1 && canonicalSpan.length >= 6) {
        candidates.push({ start, len, replacement: original.line, canonical: canonicalSpan })
      }
    }
  }
  if (candidates.length === 0) return replacementLines

  /** How many candidates claim each canonical form; a form claimed twice cannot be back-mapped. */
  const canonicalCounts = new Map<string, number>()
  for (const candidate of candidates) {
    canonicalCounts.set(candidate.canonical, (canonicalCounts.get(candidate.canonical) ?? 0) + 1)
  }

  /** The candidates whose canonical form is claimed exactly once, in the order they were found. */
  const uniqueCandidates = candidates.filter((candidate) => (canonicalCounts.get(candidate.canonical) ?? 0) === 1)
  if (uniqueCandidates.length === 0) return replacementLines

  uniqueCandidates.sort((a, b) => b.start - a.start)
  /** Copy of the replacement lines that the bottom-up splices rewrite. */
  const correctedLines = [...replacementLines]
  for (const candidate of uniqueCandidates) {
    correctedLines.splice(candidate.start, candidate.len, candidate.replacement)
  }
  return correctedLines
}

/**
 * Re-split a single replacement line that a caller merged several original lines into: every original
 * line must be located inside it in order, and the split is abandoned — falling back to a `;` split
 * and then to the input — as soon as one part is missing or a slice comes out empty.
 */
export function maybeExpandSingleLineMerge(
  originalLines: string[],
  replacementLines: string[]
): string[] {
  if (replacementLines.length !== 1 || originalLines.length <= 1) {
    return replacementLines
  }

  /** The single replacement line, which may hold several of the original lines run together. */
  const merged = replacementLines[0]
  /** Original lines trimmed with blanks dropped, so the length check below aborts on a blank original line. */
  const parts = originalLines.map((line) => line.trim()).filter((line) => line.length > 0)
  if (parts.length !== originalLines.length) return replacementLines

  /** Start index of each part inside `merged`, filled in order as the parts are located. */
  const indices: number[] = []
  /** Search start for the next part: just past the previous match, which is what enforces the order. */
  let offset = 0
  /** Cleared as soon as a part cannot be located, which abandons the expansion. */
  let orderedMatch = true
  for (const part of parts) {
    /** Start of this part in `merged`, or -1 when it is not found. */
    let idx = merged.indexOf(part, offset)
    /** Length of the matched text, which advances the offset; the stripped-key branch shortens it. */
    let matchedLen = part.length
    if (idx === -1) {
      /** The part with a dangling continuation token removed, the second key tried for a wrap at an operator. */
      const stripped = stripTrailingContinuationTokens(part)
      if (stripped !== part) {
        idx = merged.indexOf(stripped, offset)
        if (idx !== -1) matchedLen = stripped.length
      }
    }
    if (idx === -1) {
      /** Remainder of `merged` from the current offset, searched when both plain keys failed. */
      const segment = merged.slice(offset)
      /** `segment` with the merge-operator characters removed. */
      const segmentStripped = stripMergeOperatorChars(segment)
      /** The part with the merge-operator characters removed. */
      const partStripped = stripMergeOperatorChars(part)
      /** Offset of `partStripped` in `segmentStripped`, or -1; it must be walked back to a real index. */
      const fuzzyIdx = segmentStripped.indexOf(partStripped)
      if (fuzzyIdx !== -1) {
        /** Non-operator characters of `segment` consumed so far. */
        let strippedPos = 0
        /** Index in `segment` reached at that stripped position. */
        let originalPos = 0
        while (strippedPos < fuzzyIdx && originalPos < segment.length) {
          if (!/[|&?]/.test(segment[originalPos])) strippedPos += 1
          originalPos += 1
        }
        idx = offset + originalPos
        matchedLen = part.length
      }
    }
    if (idx === -1) {
      orderedMatch = false
      break
    }
    indices.push(idx)
    offset = idx + matchedLen
  }

  /** The parts re-split out of `merged`, in original order; empty unless the whole split succeeded. */
  const expanded: string[] = []
  if (orderedMatch) {
    for (let i = 0; i < indices.length; i += 1) {
      /** Index of this part's first character in `merged`. */
      const start = indices[i]
      /** Index just past this part: the next part's start, or the end of `merged` for the last one. */
      const end = i + 1 < indices.length ? indices[i + 1] : merged.length
      /** This part's slice of `merged`, trimmed; an empty slice makes the split untrustworthy. */
      const candidate = merged.slice(start, end).trim()
      if (candidate.length === 0) {
        orderedMatch = false
        break
      }
      expanded.push(candidate)
    }
  }

  if (orderedMatch && expanded.length === originalLines.length) {
    return expanded
  }

  /** Fallback split on `;` boundaries, re-appending to each non-final piece the `;` the split removed. */
  const semicolonSplit = merged
    .split(/;\s+/)
    .map((line, idx, arr) => {
      if (idx < arr.length - 1 && !line.endsWith(";")) {
        return `${line};`
      }
      return line
    })
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  if (semicolonSplit.length === originalLines.length) {
    return semicolonSplit
  }

  return replacementLines
}

/**
 * Give a replacement line back the indent of the original line at the same index, for the case where a
 * replacement was paired line-by-line with a range. A line that already carries indent, an empty line,
 * an unindented original line and a pair whose trimmed text already agrees are all left untouched.
 */
export function restoreIndentForPairedReplacement(
  originalLines: string[],
  replacementLines: string[]
): string[] {
  if (originalLines.length !== replacementLines.length) {
    return replacementLines
  }

  return replacementLines.map((line, idx) => {
    if (line.length === 0) return line
    if (leadingWhitespace(line).length > 0) return line
    /** Indent of the original line at this index, reused when the replacement lost it. */
    const indent = leadingWhitespace(originalLines[idx])
    if (indent.length === 0) return line
    if (originalLines[idx].trim() === line.trim()) return line
    return `${indent}${line}`
  })
}

/**
 * The correction pipeline a replacement text goes through before it is spliced in: expand a merged
 * single line, collapse spans that reproduce an original line, then restore per-pair indentation.
 * Every stage returns a new array, so the caller's arrays are never mutated.
 */
export function autocorrectReplacementLines(
  originalLines: string[],
  replacementLines: string[]
): string[] {
  /** Replacement lines as the stages return them; each stage starts from the previous result. */
  let next = replacementLines
  next = maybeExpandSingleLineMerge(originalLines, next)
  next = restoreOldWrappedLines(originalLines, next)
  next = restoreIndentForPairedReplacement(originalLines, next)
  return next
}
