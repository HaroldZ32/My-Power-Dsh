import { autocorrectReplacementLines } from "./autocorrect-replacement-lines"
import {
  restoreLeadingIndent,
  stripInsertAnchorEcho,
  stripInsertBeforeEcho,
  stripRangeBoundaryEcho,
  toNewLines,
} from "./edit-text-normalization"
import { parseLineRef, validateLineRef } from "./validation"

/** Per-call switches for the primitive appliers, which validate against the current file by default. */
interface EditApplyOptions {
  /** Set by a caller that already validated every anchor for the whole batch of edits. */
  skipValidation?: boolean
}

/** Whether this call must still validate anchors; only an explicit `true` skips validation. */
function shouldValidate(options?: EditApplyOptions): boolean {
  return options?.skipValidation !== true
}

/** Replace the single line at `anchor`, re-applying the replaced line's indent to the first new line. */
export function applySetLine(
  lines: string[],
  anchor: string,
  newText: string | string[],
  options?: EditApplyOptions
): string[] {
  if (shouldValidate(options)) validateLineRef(lines, anchor)
  // Zero-based line index parsed out of the `LINE#HASH` anchor.
  const { line } = parseLineRef(anchor)
  // Copy of the caller's lines; the appliers never mutate the array they are given.
  const result = [...lines]
  // The replaced line, used as the indent template; "" when the parsed line is out of range.
  const originalLine = lines[line - 1] ?? ""
  // Replacement lines after autocorrect; index 0 still lacks the original indent.
  const corrected = autocorrectReplacementLines([originalLine], toNewLines(newText))
  // Final replacement lines, among which only the first inherits the replaced line's indent.
  const replacement = corrected.map((entry, idx) => {
    if (idx !== 0) return entry
    return restoreLeadingIndent(originalLine, entry)
  })
  result.splice(line - 1, 1, ...replacement)
  return result
}

/** Replace the inclusive line range from `startAnchor` to `endAnchor` in one splice. */
export function applyReplaceLines(
  lines: string[],
  startAnchor: string,
  endAnchor: string,
  newText: string | string[],
  options?: EditApplyOptions
): string[] {
  if (shouldValidate(options)) {
    validateLineRef(lines, startAnchor)
    validateLineRef(lines, endAnchor)
  }

  // Zero-based start line parsed out of the start anchor.
  const { line: startLine } = parseLineRef(startAnchor)
  // Zero-based end line parsed out of the end anchor; must not precede the start.
  const { line: endLine } = parseLineRef(endAnchor)

  if (startLine > endLine) {
    throw new Error(
      `Invalid range: start line ${startLine} cannot be greater than end line ${endLine}`
    )
  }

  // Copy of the caller's lines; the appliers never mutate the array they are given.
  const result = [...lines]
  // The lines the range currently spans, used as autocorrect context.
  const originalRange = lines.slice(startLine - 1, endLine)
  // Replacement lines with any echoed range boundaries removed, before autocorrect runs.
  const stripped = stripRangeBoundaryEcho(lines, startLine, endLine, toNewLines(newText))
  // Stripped replacement lines after autocorrect; index 0 still lacks the original indent.
  const corrected = autocorrectReplacementLines(originalRange, stripped)
  // Final replacement lines, among which only the first inherits the range's leading indent.
  const restored = corrected.map((entry, idx) => {
    if (idx !== 0) return entry
    return restoreLeadingIndent(lines[startLine - 1] ?? "", entry)
  })
  result.splice(startLine - 1, endLine - startLine + 1, ...restored)
  return result
}

/** Insert `text` after the line at `anchor`, dropping a first line that only echoes the anchor. */
export function applyInsertAfter(
  lines: string[],
  anchor: string,
  text: string | string[],
  options?: EditApplyOptions
): string[] {
  if (shouldValidate(options)) validateLineRef(lines, anchor)
  // Zero-based index of the anchor line; the insertion lands directly after it.
  const { line } = parseLineRef(anchor)
  // Copy of the caller's lines; the appliers never mutate the array they are given.
  const result = [...lines]
  // Text to insert, minus an echoed copy of the anchor line; empty is rejected below.
  const newLines = stripInsertAnchorEcho(lines[line - 1], toNewLines(text))
  if (newLines.length === 0) {
    throw new Error(`append (anchored) requires non-empty text for ${anchor}`)
  }
  result.splice(line, 0, ...newLines)
  return result
}

/** Insert `text` before the line at `anchor`, dropping a last line that only echoes the anchor. */
export function applyInsertBefore(
  lines: string[],
  anchor: string,
  text: string | string[],
  options?: EditApplyOptions
): string[] {
  if (shouldValidate(options)) validateLineRef(lines, anchor)
  // Zero-based index of the anchor line; the insertion lands directly before it.
  const { line } = parseLineRef(anchor)
  // Copy of the caller's lines; the appliers never mutate the array they are given.
  const result = [...lines]
  // Text to insert, minus a trailing echoed copy of the anchor line; empty is rejected below.
  const newLines = stripInsertBeforeEcho(lines[line - 1], toNewLines(text))
  if (newLines.length === 0) {
    throw new Error(`prepend (anchored) requires non-empty text for ${anchor}`)
  }
  result.splice(line - 1, 0, ...newLines)
  return result
}

/** Append `text` at end of file, treating a lone empty line as an empty file. */
export function applyAppend(lines: string[], text: string | string[]): string[] {
  // Text to append as lines; empty input is rejected below.
  const normalized = toNewLines(text)
  if (normalized.length === 0) {
    throw new Error("append requires non-empty text")
  }
  if (lines.length === 1 && lines[0] === "") {
    return [...normalized]
  }
  // A trailing "" element is the split() artifact of a trailing newline;
  // keep it OUT of the middle of the joined output ("a\nb\n" + "c" must be
  // "a\nb\nc", not "a\nb\n\nc").
  const base = lines.length > 1 && lines[lines.length - 1] === "" ? lines.slice(0, -1) : lines
  return [...base, ...normalized]
}

/** Prepend `text` at start of file, treating a lone empty line as an empty file. */
export function applyPrepend(lines: string[], text: string | string[]): string[] {
  // Text to prepend as lines; empty input is rejected below.
  const normalized = toNewLines(text)
  if (normalized.length === 0) {
    throw new Error("prepend requires non-empty text")
  }
  if (lines.length === 1 && lines[0] === "") {
    return [...normalized]
  }
  return [...normalized, ...lines]
}
