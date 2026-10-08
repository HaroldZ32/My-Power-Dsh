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
// Hashline core: normalizing and applying an anchored edit batch.
//
// Design ported from the hashline mode of `crates/pi-edit`: a batch is validated as a WHOLE before any
// of it runs, edits are applied bottom-up so an earlier splice cannot shift a later anchor, and a
// replacement that merely restates the lines around it is recognized rather than duplicated.
//
// DELIBERATE REDUCTION: the replaced core also carried a fuzzy "autocorrect" layer that tried to
// re-join replacement lines a model had wrapped and to repair indentation across paired lines. That
// layer was heuristic, undocumented in the tool contract, and is NOT reproduced here. What IS
// reproduced is the deterministic part every anchored edit depends on: pasted-prefix stripping,
// indent restoration, boundary-echo stripping and the no-op/dedupe accounting.

import { normalizeLineRef, parseLineRef, validateLineRefs } from "./anchors"
import type { AppendEdit, HashlineApplyReport, HashlineEdit, PrependEdit, ReplaceEdit } from "./types"

/** Operation names the tool surface accepts; the pre-anchor legacy format is not one of them. */
type HashlineToolOp = "replace" | "append" | "prepend"

/** One edit exactly as it arrived in a tool call, before anchors and lines are validated. */
export interface RawHashlineEdit {
  /** Operation discriminator; an absent value is rejected, so no op is ever defaulted. */
  op?: HashlineToolOp
  /** Primary anchor (`LINE#HASH`); required for `replace`, optional for append/prepend. */
  pos?: string
  /** Inclusive range end for `replace`; also accepted as the fallback anchor for append/prepend. */
  end?: string
  /** Text to write; `null` means an empty line list while `undefined` is a missing-field error. */
  lines?: string | string[] | null
}

/** Matches a rendered anchor (`>>> 12#AB|`) at the start of a pasted line. */
const HASHLINE_PREFIX_RE = /^\s*(?:>>>|>>)?\s*\d+\s*#\s*[ZPMQVRWSNKTXJBYH]{2}\|/

/** Matches a diff `+` line marker, but not the `++` of a unified-diff file header. */
const DIFF_PLUS_RE = /^[+](?![+])/

/** Whether two lines are equal once all interior and surrounding whitespace is removed. */
function equalsIgnoringWhitespace(a: string, b: string): boolean {
  if (a === b) return true
  return a.replace(/\s+/g, "") === b.replace(/\s+/g, "")
}

/** Leading whitespace run of `text`, or "" when the line is empty or starts unindented. */
function leadingWhitespace(text: string): string {
  if (!text) return ""
  /** The leading-whitespace pattern always matches, so the null branch only satisfies the type checker. */
  const match = text.match(/^\s*/)
  return match ? match[0] : ""
}

/** Whether two line arrays hold the same lines in the same order; used to detect a no-op edit. */
function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

/**
 * Strip a pasted hashline or diff `+` prefix, but only when at least half the non-empty lines carry
 * one — so ordinary prose that happens to contain a rendered anchor is left intact.
 *
 * @param lines - the caller's replacement lines.
 * @returns the lines with their common prefix removed, or the input unchanged when no prefix dominates.
 */
function stripLinePrefixes(lines: string[]): string[] {
  /** Non-empty lines carrying a rendered `LINE#HASH|` anchor prefix. */
  let hashPrefixCount = 0
  /** Non-empty lines carrying a diff `+` prefix. */
  let diffPlusCount = 0
  /** Lines that are not empty; the stripping threshold is a fraction of this count. */
  let nonEmpty = 0

  for (const line of lines) {
    if (line.length === 0) continue
    nonEmpty += 1
    if (HASHLINE_PREFIX_RE.test(line)) hashPrefixCount += 1
    if (DIFF_PLUS_RE.test(line)) diffPlusCount += 1
  }

  if (nonEmpty === 0) {
    return lines
  }

  /** Whether anchors dominate; diff markers are considered only when anchors did not win. */
  const stripHash = hashPrefixCount > 0 && hashPrefixCount >= nonEmpty * 0.5
  /** Whether diff `+` markers dominate, evaluated only when anchors did not. */
  const stripPlus = !stripHash && diffPlusCount > 0 && diffPlusCount >= nonEmpty * 0.5

  if (!stripHash && !stripPlus) {
    return lines
  }

  return lines.map((line) => {
    if (stripHash) return line.replace(HASHLINE_PREFIX_RE, "")
    if (stripPlus) return line.replace(DIFF_PLUS_RE, "")
    return line
  })
}

/**
 * Normalize caller-supplied text into lines, stripping a pasted anchor or diff prefix.
 *
 * @param input - one line, or the full ordered block.
 * @returns the lines the appliers splice.
 */
function toNewLines(input: string | string[]): string[] {
  if (Array.isArray(input)) {
    return stripLinePrefixes(input)
  }
  return stripLinePrefixes(input.split("\n"))
}

/**
 * Give `line` the indent of `templateLine`, when it has none of its own and differs in content.
 *
 * @param templateLine - the line being replaced or inserted next to, which supplies the indent.
 * @param line - the replacement line, index 0 of a block.
 * @returns the line with the template's indent, or the line unchanged.
 */
function restoreLeadingIndent(templateLine: string, line: string): string {
  if (line.length === 0) return line
  /** Whitespace to copy onto `line`; an unindented template leaves nothing to restore. */
  const templateIndent = leadingWhitespace(templateLine)
  if (templateIndent.length === 0) return line
  if (leadingWhitespace(line).length > 0) return line
  if (templateLine.trim() === line.trim()) return line
  return `${templateIndent}${line}`
}

/**
 * Drop a leading fragment that merely restates the anchor line, i.e. an unchanged-content echo.
 *
 * @param anchorLine - the line the insertion is anchored on.
 * @param newLines - the lines about to be inserted.
 * @returns `newLines` without a leading echo.
 */
function stripInsertAnchorEcho(anchorLine: string, newLines: string[]): string[] {
  if (newLines.length === 0) return newLines
  if (equalsIgnoringWhitespace(newLines[0] ?? "", anchorLine)) {
    return newLines.slice(1)
  }
  return newLines
}

/**
 * Drop a trailing fragment that merely restates the anchor line.
 *
 * @param anchorLine - the line the insertion is anchored on.
 * @param newLines - the lines about to be inserted.
 * @returns `newLines` without a trailing echo; a single-line input is returned as it stands.
 */
function stripInsertBeforeEcho(anchorLine: string, newLines: string[]): string[] {
  if (newLines.length <= 1) return newLines
  if (equalsIgnoringWhitespace(newLines[newLines.length - 1] ?? "", anchorLine)) {
    return newLines.slice(0, -1)
  }
  return newLines
}

/**
 * Remove replacement lines that exactly echo the lines just OUTSIDE the replaced range.
 *
 * @param lines - the current file lines.
 * @param startLine - 1-based first line of the replaced range.
 * @param endLine - 1-based last line of the replaced range.
 * @param newLines - the replacement lines.
 * @returns `newLines` without a leading echo of the line before the range or a trailing echo of the line after it.
 */
function stripRangeBoundaryEcho(lines: string[], startLine: number, endLine: number, newLines: string[]): string[] {
  /** How many existing lines the range covers; a replacement no longer than this cannot echo them. */
  const replacedCount = endLine - startLine + 1
  if (newLines.length <= 1 || newLines.length <= replacedCount) {
    return newLines
  }

  /** Working list; boundary echoes are sliced off one end at a time, so each test re-reads `out`. */
  let out = newLines
  /** Zero-based index of the line just before the range, or -1 when the range starts at line 1. */
  const beforeIndex = startLine - 2
  if (beforeIndex >= 0 && out[0] === lines[beforeIndex]) {
    out = out.slice(1)
  }

  /** Zero-based index of the line just after the range, i.e. one past `endLine`. */
  const afterIndex = endLine
  if (afterIndex < lines.length && out.length > 0 && out[out.length - 1] === lines[afterIndex]) {
    out = out.slice(0, -1)
  }

  return out
}

/**
 * Replace the single line at `anchor`, re-applying the replaced line's indent to the first new line.
 *
 * @param lines - the current file lines.
 * @param anchor - `LINE#HASH` anchor of the line to replace.
 * @param newText - the replacement, one line or a block.
 * @returns a NEW line array; the caller's array is never mutated.
 */
function applySetLine(lines: string[], anchor: string, newText: string | string[]): string[] {
  /** Zero-based index parsed out of the anchor. */
  const { line } = parseLineRef(anchor)
  /** Copy of the caller's lines. */
  const result = [...lines]
  /** The replaced line, used as the indent template; "" when the parsed line is out of range. */
  const originalLine = lines[line - 1] ?? ""
  /** Replacement lines; only index 0 still lacks the original indent. */
  const replacement = toNewLines(newText).map((entry, index) => {
    if (index !== 0) return entry
    return restoreLeadingIndent(originalLine, entry)
  })
  result.splice(line - 1, 1, ...replacement)
  return result
}

/**
 * Replace the inclusive line range from `startAnchor` to `endAnchor` in one splice.
 *
 * @param lines - the current file lines.
 * @param startAnchor - `LINE#HASH` anchor of the first line of the range.
 * @param endAnchor - `LINE#HASH` anchor of the last line of the range.
 * @param newText - the replacement, one line or a block.
 * @returns a NEW line array.
 * @throws Error when the start line is after the end line.
 */
function applyReplaceLines(lines: string[], startAnchor: string, endAnchor: string, newText: string | string[]): string[] {
  /** 1-based first line of the range, parsed out of the start anchor. */
  const { line: startLine } = parseLineRef(startAnchor)
  /** 1-based last line of the range, parsed out of the end anchor. */
  const { line: endLine } = parseLineRef(endAnchor)

  if (startLine > endLine) {
    throw new Error(`Invalid range: start line ${startLine} cannot be greater than end line ${endLine}`)
  }

  /** Copy of the caller's lines. */
  const result = [...lines]
  /** Replacement lines with any echoed range boundaries removed, before the indent is restored. */
  const stripped = stripRangeBoundaryEcho(lines, startLine, endLine, toNewLines(newText))
  /** Final replacement lines; only the first inherits the range's leading indent. */
  const restored = stripped.map((entry, index) => {
    if (index !== 0) return entry
    return restoreLeadingIndent(lines[startLine - 1] ?? "", entry)
  })
  result.splice(startLine - 1, endLine - startLine + 1, ...restored)
  return result
}

/**
 * Insert text after the line at `anchor`, dropping a first line that only echoes the anchor.
 *
 * @param lines - the current file lines.
 * @param anchor - `LINE#HASH` anchor of the line to insert after.
 * @param text - the lines to insert.
 * @returns a NEW line array.
 * @throws Error when nothing is left to insert.
 */
function applyInsertAfter(lines: string[], anchor: string, text: string | string[]): string[] {
  /** Zero-based index of the anchor line; the insertion lands directly after it. */
  const { line } = parseLineRef(anchor)
  /** Copy of the caller's lines. */
  const result = [...lines]
  /** Text to insert, minus an echoed copy of the anchor line. */
  const newLines = stripInsertAnchorEcho(lines[line - 1] ?? "", toNewLines(text))
  if (newLines.length === 0) {
    throw new Error(`append (anchored) requires non-empty text for ${anchor}`)
  }
  result.splice(line, 0, ...newLines)
  return result
}

/**
 * Insert text before the line at `anchor`, dropping a last line that only echoes the anchor.
 *
 * @param lines - the current file lines.
 * @param anchor - `LINE#HASH` anchor of the line to insert before.
 * @param text - the lines to insert.
 * @returns a NEW line array.
 * @throws Error when nothing is left to insert.
 */
function applyInsertBefore(lines: string[], anchor: string, text: string | string[]): string[] {
  /** Zero-based index of the anchor line; the insertion lands directly before it. */
  const { line } = parseLineRef(anchor)
  /** Copy of the caller's lines. */
  const result = [...lines]
  /** Text to insert, minus a trailing echoed copy of the anchor line. */
  const newLines = stripInsertBeforeEcho(lines[line - 1] ?? "", toNewLines(text))
  if (newLines.length === 0) {
    throw new Error(`prepend (anchored) requires non-empty text for ${anchor}`)
  }
  result.splice(line - 1, 0, ...newLines)
  return result
}

/**
 * Append text past the last line, treating a lone empty line as an empty file.
 *
 * @param lines - the current file lines.
 * @param text - the lines to append.
 * @returns a NEW line array.
 * @throws Error when nothing is left to append.
 */
function applyAppend(lines: string[], text: string | string[]): string[] {
  /** Text to append, as lines. */
  const normalized = toNewLines(text)
  if (normalized.length === 0) {
    throw new Error("append requires non-empty text")
  }
  if (lines.length === 1 && lines[0] === "") {
    return [...normalized]
  }
  // A trailing "" element is the `split` artifact of a file's final newline, and it must stay OUT of
  // the middle of the joined result: "a\nb\n" plus "c" is "a\nb\nc", never "a\nb\n\nc".
  /** Existing lines without that trailing artifact. */
  const base = lines.length > 1 && lines[lines.length - 1] === "" ? lines.slice(0, -1) : lines
  return [...base, ...normalized]
}

/**
 * Prepend text above the first line, treating a lone empty line as an empty file.
 *
 * @param lines - the current file lines.
 * @param text - the lines to prepend.
 * @returns a NEW line array.
 * @throws Error when nothing is left to prepend.
 */
function applyPrepend(lines: string[], text: string | string[]): string[] {
  /** Text to prepend, as lines. */
  const normalized = toNewLines(text)
  if (normalized.length === 0) {
    throw new Error("prepend requires non-empty text")
  }
  if (lines.length === 1 && lines[0] === "") {
    return [...normalized]
  }
  return [...normalized, ...lines]
}

/**
 * Payload text in its canonical form, so two spellings of one edit share a dedupe key.
 *
 * @param payload - the edit's `lines`, as the caller supplied them.
 * @returns the prefix-stripped lines rejoined by `\n`.
 */
function normalizeEditPayload(payload: string | string[]): string {
  return toNewLines(payload).join("\n")
}

/**
 * Anchor in its canonical spelling.
 *
 * @param anchor - the anchor as supplied, or undefined for an unanchored insert.
 * @returns the canonical anchor, or the empty string when there is none.
 */
function canonicalAnchor(anchor: string | undefined): string {
  if (!anchor) return ""
  return normalizeLineRef(anchor)
}

/**
 * Identity of one edit for duplicate detection: op, canonical anchors and canonical payload — so
 * textually different but equivalent edits collide.
 *
 * @param edit - the edit to key.
 * @returns the dedupe key.
 */
function buildDedupeKey(edit: HashlineEdit): string {
  switch (edit.op) {
    case "replace":
      return `replace|${canonicalAnchor(edit.pos)}|${edit.end ? canonicalAnchor(edit.end) : ""}|${normalizeEditPayload(edit.lines)}`
    case "append":
      return `append|${canonicalAnchor(edit.pos)}|${normalizeEditPayload(edit.lines)}`
    case "prepend":
      return `prepend|${canonicalAnchor(edit.pos)}|${normalizeEditPayload(edit.lines)}`
    default:
      return JSON.stringify(edit)
  }
}

/**
 * Drop repeated edits, keeping the FIRST occurrence of each key in the caller's order.
 *
 * @param edits - the batch as supplied.
 * @returns the surviving edits plus how many repeats were dropped.
 */
function dedupeEdits(edits: HashlineEdit[]): { edits: HashlineEdit[]; deduplicatedEdits: number } {
  /** Keys already kept; the first edit with a given key wins and later ones are dropped. */
  const seen = new Set<string>()
  /** Survivors, in the order the caller supplied them. */
  const deduped: HashlineEdit[] = []
  /** How many repeats were dropped from the caller's list. */
  let deduplicatedEdits = 0

  for (const edit of edits) {
    /** Dedupe key of the edit currently under test. */
    const key = buildDedupeKey(edit)
    if (seen.has(key)) {
      deduplicatedEdits += 1
      continue
    }
    seen.add(key)
    deduped.push(edit)
  }

  return { edits: deduped, deduplicatedEdits }
}

/**
 * Sort key for the bottom-up application order: the line the edit is anchored on.
 *
 * @param edit - the edit to rank.
 * @returns a range replace's END line (where its splice reaches), `-Infinity` for an unanchored
 *   append/prepend so it is applied last, and `+Infinity` for an unknown op so it is applied first.
 */
function getEditLineNumber(edit: HashlineEdit): number {
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
 * Every anchor a batch references, so the whole batch can be validated before any edit is applied.
 *
 * @param edits - the batch.
 * @returns both ends of every range replace, the `pos` of a single-line replace, the anchor of an
 *   anchored append/prepend, and nothing for a file-end append or a file-start prepend.
 */
function collectLineRefs(edits: HashlineEdit[]): string[] {
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
 * Message naming the first pair of overlapping multi-line replace ranges.
 *
 * Only a replace carrying an explicit `end` is a range; two ranges that share a line overlap, while
 * merely abutting ones do not.
 *
 * @param edits - the batch, in its application order; edits are named by 1-based position.
 * @returns the message, or null when no two ranges overlap.
 */
function detectOverlappingRanges(edits: HashlineEdit[]): string | null {
  /** Inclusive line span of every range replace, with its index in `edits` for the message. */
  const ranges: { start: number; end: number; idx: number }[] = []
  for (let i = 0; i < edits.length; i++) {
    /** The edit under inspection; only a range replace contributes a span. */
    const edit = edits[i]
    if (!edit || edit.op !== "replace" || !edit.end) continue
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
    if (prev && curr && curr.start <= prev.end) {
      return (
        "Overlapping range edits detected: " +
        `edit ${prev.idx + 1} (lines ${prev.start}-${prev.end}) overlaps with ` +
        `edit ${curr.idx + 1} (lines ${curr.start}-${curr.end}). ` +
        "Use pos-only replace for single-line edits."
      )
    }
  }
  return null
}

/**
 * Trim an anchor and collapse a blank string to undefined, so whitespace can never act as an anchor.
 *
 * @param value - the caller's anchor field.
 * @returns the trimmed anchor, or undefined when it was absent or blank.
 */
function normalizeAnchor(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined
  /** The anchor as written; still blank when it held only whitespace. */
  const trimmed = value.trim()
  return trimmed === "" ? undefined : trimmed
}

/**
 * Read an edit's `lines`, treating `null` as an explicit empty list.
 *
 * @param edit - the raw edit.
 * @param index - 0-based position in the batch, used in the error message.
 * @returns the caller's lines, or an empty list for an explicit `null`.
 * @throws Error when the field is absent.
 */
function requireLines(edit: RawHashlineEdit, index: number): string | string[] {
  if (edit.lines === undefined) {
    throw new Error(`Edit ${index}: lines is required for ${edit.op ?? "unknown"}`)
  }
  if (edit.lines === null) {
    return []
  }
  return edit.lines
}

/**
 * Require an anchor for an op that cannot run without one.
 *
 * @param anchor - the normalized anchor, or undefined when neither slot was supplied.
 * @param index - 0-based position in the batch, used in the error message.
 * @param op - the operation name, used in the error message.
 * @returns the anchor.
 * @throws Error when it is missing.
 */
function requireLine(anchor: string | undefined, index: number, op: HashlineToolOp): string {
  if (!anchor) {
    throw new Error(`Edit ${index}: ${op} requires at least one anchor line reference (pos or end)`)
  }
  return anchor
}

/**
 * Convert one raw edit into a `ReplaceEdit`, attaching `end` only when the caller supplied it.
 *
 * @param edit - the raw edit.
 * @param index - 0-based position in the batch, used in error messages.
 * @returns the normalized replace edit.
 */
function normalizeReplaceEdit(edit: RawHashlineEdit, index: number): HashlineEdit {
  /** Normalized `pos` anchor; a blank or missing value falls back to `end`. */
  const pos = normalizeAnchor(edit.pos)
  /** Normalized `end` anchor; a blank or missing value means a single-line replace. */
  const end = normalizeAnchor(edit.end)
  /** The anchor this replace actually uses, so at least one of the two slots must be present. */
  const anchor = requireLine(pos ?? end, index, "replace")
  /** Replacement line list, already checked to be present. */
  const lines = requireLines(edit, index)

  /** The replace edit handed back; `end` is attached below only when supplied. */
  const normalized: ReplaceEdit = { op: "replace", pos: anchor, lines }
  if (end) normalized.end = end
  return normalized
}

/**
 * Convert one raw edit into an `AppendEdit`, attaching `pos` only when an anchor was given.
 *
 * @param edit - the raw edit.
 * @param index - 0-based position in the batch, used in error messages.
 * @returns the normalized append edit.
 */
function normalizeAppendEdit(edit: RawHashlineEdit, index: number): HashlineEdit {
  /** Normalized `pos` anchor, when the caller supplied one. */
  const pos = normalizeAnchor(edit.pos)
  /** Normalized `end` anchor, accepted as the fallback anchor for append. */
  const end = normalizeAnchor(edit.end)
  /** The anchor to insert after; undefined means append at end of file. */
  const anchor = pos ?? end
  /** Inserted line list, already checked to be present. */
  const lines = requireLines(edit, index)

  /** The append edit handed back; `pos` is attached below only when anchored. */
  const normalized: AppendEdit = { op: "append", lines }
  if (anchor) normalized.pos = anchor
  return normalized
}

/**
 * Convert one raw edit into a `PrependEdit`, attaching `pos` only when an anchor was given.
 *
 * @param edit - the raw edit.
 * @param index - 0-based position in the batch, used in error messages.
 * @returns the normalized prepend edit.
 */
function normalizePrependEdit(edit: RawHashlineEdit, index: number): HashlineEdit {
  /** Normalized `pos` anchor, when the caller supplied one. */
  const pos = normalizeAnchor(edit.pos)
  /** Normalized `end` anchor, accepted as the fallback anchor for prepend. */
  const end = normalizeAnchor(edit.end)
  /** The anchor to insert before; undefined means prepend at start of file. */
  const anchor = pos ?? end
  /** Inserted line list, already checked to be present. */
  const lines = requireLines(edit, index)

  /** The prepend edit handed back; `pos` is attached below only when anchored. */
  const normalized: PrependEdit = { op: "prepend", lines }
  if (anchor) normalized.pos = anchor
  return normalized
}

/**
 * Normalize every raw edit in tool-call order, rejecting any op the tool does not support.
 *
 * @param rawEdits - the batch exactly as the tool call carried it.
 * @returns the normalized edits, ready for `applyHashlineEditsWithReport`.
 * @throws Error naming the offending index for a missing op, a missing anchor or missing `lines`.
 */
export function normalizeHashlineEdits(rawEdits: RawHashlineEdit[]): HashlineEdit[] {
  return rawEdits.map((rawEdit, index) => {
    /** Defensive: a null array slot normalizes to an edit with no op, which the switch below rejects. */
    const edit = rawEdit ?? {}

    switch (edit.op) {
      case "replace":
        return normalizeReplaceEdit(edit, index)
      case "append":
        return normalizeAppendEdit(edit, index)
      case "prepend":
        return normalizePrependEdit(edit, index)
      default:
        throw new Error(
          `Edit ${index}: unsupported op "${String(edit.op)}". Legacy format was removed; use op/pos/end/lines.`,
        )
    }
  })
}

/**
 * Apply every edit of a batch to `content`.
 *
 * The batch is validated as a whole FIRST, so a stale anchor is reported before any line is spliced;
 * edits then run bottom-up so an earlier splice cannot shift a later anchor.
 *
 * @param content - the file's canonical, LF-only text.
 * @param edits - the normalized batch; an empty batch returns the content unchanged.
 * @returns the new content plus the no-op and deduplicated counters.
 * @throws HashlineMismatchError when a quoted anchor no longer matches, Error for an invalid range or overlap.
 */
export function applyHashlineEditsWithReport(content: string, edits: HashlineEdit[]): HashlineApplyReport {
  if (edits.length === 0) {
    return { content, noopEdits: 0, deduplicatedEdits: 0 }
  }

  /** Deduplicated edit list, plus the number of duplicates it dropped. */
  const dedupeResult = dedupeEdits(edits)
  /** Tie-break order for edits anchored on the same line: replace, then append, then prepend. */
  const EDIT_PRECEDENCE: Record<string, number> = { replace: 0, append: 1, prepend: 2 }
  /** Edits applied bottom-up (highest line first); an op missing from the table sinks to the end. */
  const sortedEdits = [...dedupeResult.edits].sort((a, b) => {
    /** Line number of the first edit under comparison. */
    const lineA = getEditLineNumber(a)
    /** Line number of the second edit under comparison. */
    const lineB = getEditLineNumber(b)
    if (lineB !== lineA) return lineB - lineA
    return (EDIT_PRECEDENCE[a.op] ?? 3) - (EDIT_PRECEDENCE[b.op] ?? 3)
  })

  /** Count of edits that left the line array unchanged. */
  let noopEdits = 0

  /** Working line buffer; an empty file is zero lines, so a lone "" is not invented for it. */
  let lines = content.length === 0 ? [] : content.split("\n")

  /** Every anchor the batch references, validated once before any edit is applied. */
  const refs = collectLineRefs(sortedEdits)
  validateLineRefs(lines, refs)

  /** Message naming the first pair of overlapping multi-line replace ranges, or null when none do. */
  const overlapError = detectOverlappingRanges(sortedEdits)
  if (overlapError) throw new Error(overlapError)

  for (const edit of sortedEdits) {
    switch (edit.op) {
      case "replace": {
        /** Lines after this replace, or an unchanged copy when the replacement changed nothing. */
        const next = edit.end
          ? applyReplaceLines(lines, edit.pos, edit.end, edit.lines)
          : applySetLine(lines, edit.pos, edit.lines)
        if (arraysEqual(next, lines)) {
          noopEdits += 1
          break
        }
        lines = next
        break
      }
      case "append": {
        /** Lines after this anchored insert or file-end append. */
        const next = edit.pos ? applyInsertAfter(lines, edit.pos, edit.lines) : applyAppend(lines, edit.lines)
        if (arraysEqual(next, lines)) {
          noopEdits += 1
          break
        }
        lines = next
        break
      }
      case "prepend": {
        /** Lines after this anchored insert or file-start prepend. */
        const next = edit.pos ? applyInsertBefore(lines, edit.pos, edit.lines) : applyPrepend(lines, edit.lines)
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
