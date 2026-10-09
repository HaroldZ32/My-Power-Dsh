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
// DELIBERATE REDUCTION, PARTLY RESTORED: the replaced core also carried a fuzzy "autocorrect" layer
// that tried to re-join replacement lines a model had wrapped and to repair indentation across paired
// lines. That layer was heuristic and undocumented in the tool contract, so it was dropped. What runs
// here instead is OUR OWN, narrower implementation (`repairReplacementBlock`): it absorbs exactly two
// manglings — a replacement line the caller's block split across two entries, and a replacement block
// that lost its block-level indentation — and it refuses everything it cannot decide from the file's
// own bytes: it never runs on a block that already equals the range it replaces, never runs on an
// append or a prepend, and applies ONLY when the block names exactly one place to repair, because two
// candidate sites are an ambiguous request and the caller's block is then left exactly as written.
// Every repair it does apply is named in `HashlineApplyReport.repairs`, so the tool result can report
// it. What was reproduced unchanged is the deterministic part every anchored edit depends on:
// pasted-prefix stripping, indent restoration, boundary-echo stripping and the no-op/dedupe accounting.

import { normalizeLineRef, parseLineRef, validateLineRefs } from "./anchors"
import type {
  AppendEdit,
  HashlineApplyReport,
  HashlineEdit,
  HashlineRepairReport,
  PrependEdit,
  ReplaceEdit,
} from "./types"

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

// ── The conservative repair pass ─────────────────────────────────────────────────────────────────
// A replacement block arrives as plain text from a caller, so it can come back MANGLED in two ways
// the file's own bytes can prove: one logical line split across two entries, or a whole block that
// lost its block-level indentation. This pass undoes exactly those two, and only when unambiguous.

/** Characters that need a right operand, so a wrap after one is rejoined with a space, not butted on. */
const WRAP_JOIN_SPACE_RE = /[,+\-*/%=<>&|?!:]$/

/** Running delimiter state of a line-by-line scan: the net bracket depth plus any quote left open. */
interface BalanceState {
  /** Net `(`/`[`/`{` depth; a closing bracket decrements it and never takes it below zero. */
  depth: number
  /** The quote character the scan ended inside, or null when every quote it saw was closed. */
  openQuote: string | null
}

/** The delimiter state of text that opened nothing and quoted nothing. */
const BALANCED: BalanceState = { depth: 0, openQuote: null }

/** One place a replacement line was split across two entries, with the text its two halves rejoin through. */
interface WrapSite {
  /** Zero-based index, within the block, of the entry the wrapped fragment landed in. */
  index: number
  /** Text joining the two entries: one space after a token needing a right operand, otherwise nothing. */
  separator: string
}

/** One repair attempt's conclusion about a replacement block. */
interface RepairOutcome {
  /** The block to splice: the repaired lines, or the caller's block when no repair applied. */
  lines: string[]
  /** The repair that produced `lines`, or null when the block was left exactly as the caller wrote it. */
  repair: HashlineRepairReport | null
}

/**
 * Advance a delimiter scan by one line of text.
 *
 * The scanner is language-agnostic on purpose: it tracks `()[]{}` depth plus the double-quote and
 * backtick quotes with backslash escapes, which is the subset every language this row edits agrees
 * on. A single quote is deliberately NOT tracked, because it delimits strings in some languages and
 * abbreviates prose in others; leaving it out can only make a line look LESS open, and an open line
 * is only ever a repair CANDIDATE whose application the uniqueness gate still has to allow.
 *
 * @param state - the state at the end of the previous line.
 * @param text - the line to scan.
 * @returns the state at the end of `text`; a fresh object, so `state` itself is never mutated.
 */
function scanDelimiters(state: BalanceState, text: string): BalanceState {
  /** Bracket depth after `text`; only a bracket outside every quote moves it. */
  let depth = state.depth
  /** The quote the scan ended inside, carried in from the previous line. */
  let openQuote = state.openQuote
  /** Whether a backslash inside a quote escaped the character that followed it. */
  let escaped = false

  for (const char of text) {
    if (openQuote !== null) {
      if (escaped) escaped = false
      else if (char === "\\") escaped = true
      else if (char === openQuote) openQuote = null
      continue
    }
    if (char === '"' || char === "`") {
      openQuote = char
      continue
    }
    if (char === "(" || char === "[" || char === "{") depth += 1
    else if (char === ")" || char === "]" || char === "}") depth = Math.max(0, depth - 1)
  }

  return { depth, openQuote }
}

/**
 * Delimiter state entering and leaving every line of a block, so a pair is judged from the state its
 * own wrapper line started from rather than from a fresh one.
 *
 * @param lines - the block to scan, in block order.
 * @returns `before[i]` is the state entering line `i` and `after[i]` the state leaving it; both carry
 *   one entry per line, so `after` is `before` displaced by exactly one line.
 */
function scanBlockStates(lines: string[]): { before: BalanceState[]; after: BalanceState[] } {
  /** State entering each line, in block order. */
  const before: BalanceState[] = []
  /** State leaving each line, in block order. */
  const after: BalanceState[] = []
  /** Running state, advanced once per line; never mutated, so the pushed states stay distinct. */
  let state = BALANCED
  for (const line of lines) {
    before.push(state)
    state = scanDelimiters(state, line)
    after.push(state)
  }
  return { before, after }
}

/**
 * Whether a line left something open that the state it entered with did not already hold.
 *
 * @param entry - the state entering the line.
 * @param exit - the state leaving it.
 * @returns true when the line opened a bracket or started a quote.
 */
function opensSomething(entry: BalanceState, exit: BalanceState): boolean {
  if (exit.depth > entry.depth) return true
  return entry.openQuote === null && exit.openQuote !== null
}

/**
 * Whether a line gave back something the state entering it held open.
 *
 * @param entry - the state entering the line.
 * @param exit - the state leaving it.
 * @returns true when the line closed a bracket or terminated a quote.
 */
function closesSomething(entry: BalanceState, exit: BalanceState): boolean {
  if (exit.depth < entry.depth) return true
  return entry.openQuote !== null && exit.openQuote === null
}

/**
 * Find every place a replacement block splits one logical line across two entries: entry `i` opens a
 * bracket or a quote, entry `i+1` closes exactly that and is itself a net closer, and entry `i+1`
 * carries NO indentation of its own — a fragment that lost the indentation its line had.
 *
 * The net-closer clause is what keeps a legitimately unindented line inside an open block out of the
 * candidate list: an entry that merely sits between an opening and a closing line closes nothing.
 *
 * @param lines - the replacement block, after prefix and boundary-echo stripping.
 * @returns every eligible split, in block order; empty when the block is not split this way.
 */
function findWrapSites(lines: string[]): WrapSite[] {
  /** State entering and leaving every entry, so each pair is judged from its own entry state. */
  const { before, after } = scanBlockStates(lines)
  /** Every pair that reads as one logical line split across two entries. */
  const sites: WrapSite[] = []

  for (let i = 0; i + 1 < lines.length; i++) {
    /** The entry that leaves a bracket or a quote open. */
    const wrapper = lines[i] ?? ""
    /** The entry that must close exactly that. */
    const fragment = lines[i + 1] ?? ""
    /** State entering the wrapper. */
    const entry = before[i] ?? BALANCED
    /** State leaving the wrapper, i.e. entering the fragment. */
    const middle = after[i] ?? BALANCED
    /** State leaving the fragment. */
    const exit = after[i + 1] ?? BALANCED

    if (wrapper.trim().length === 0 || fragment.trim().length === 0) continue
    if (leadingWhitespace(fragment).length > 0) continue
    if (!opensSomething(entry, middle)) continue
    if (!closesSomething(middle, exit)) continue
    if (exit.depth !== entry.depth || exit.openQuote !== entry.openQuote) continue

    sites.push({ index: i, separator: WRAP_JOIN_SPACE_RE.test(wrapper.replace(/\s+$/, "")) ? " " : "" })
  }

  return sites
}

/**
 * Whether a block is written flush left while the lines it replaces are indented — the signature of a
 * replacement whose block-level indentation was lost, rather than one the caller indented on purpose.
 *
 * @param block - the replacement block, after prefix and boundary-echo stripping.
 * @param range - the lines the block replaces, in file order.
 * @returns true when every entry is flush left, the block spans at least two entries, and the range
 *   carries at least one indent the block could be re-indented from.
 */
function isFlushLeftBlock(block: string[], range: string[]): boolean {
  if (block.length < 2) return false
  if (!block.some((line) => line.trim().length > 0)) return false
  if (!block.every((line) => leadingWhitespace(line).length === 0)) return false
  return range.some((line) => leadingWhitespace(line).length > 0)
}

/**
 * Give every block entry the indent of the replaced line it stands in for, so the k-th replacement
 * line is indented like the k-th replaced line. A block that grew past the range keeps the range's
 * LAST indent for its extra entries.
 *
 * @param block - the flush-left replacement block.
 * @param range - the lines the block replaces, in file order.
 * @returns the re-indented block; an empty entry stays empty rather than becoming whitespace.
 */
function pairIndent(block: string[], range: string[]): string[] {
  return block.map((line, index) => {
    if (line.length === 0) return line
    /** The replaced line this entry stands in for; the range's last line covers a block that grew. */
    const template = range[Math.min(index, range.length - 1)] ?? ""
    return `${leadingWhitespace(template)}${line}`
  })
}

/**
 * The conservative repair pass: undo the two manglings a replacement block can come back with, and
 * only when the block names exactly one place to repair.
 *
 * The refusals are the whole point. A block that already EQUALS the range it replaces is a successful
 * exact edit and is never touched, not even when it happens to carry a wrap-shaped pair. A block
 * naming two candidate splits is ambiguous — the pass cannot tell which one the caller meant, so it
 * repairs NEITHER and leaves the block exactly as written. Append and prepend never reach this
 * function, because neither has a replaced range to prove a mangling against.
 *
 * @param block - the replacement block, after prefix and boundary-echo stripping.
 * @param range - the lines the block replaces, in file order.
 * @param startLine - 1-based file line the block lands on, recorded in the report.
 * @returns the block to splice plus the repair that produced it, or the caller's block and null.
 */
function repairReplacementBlock(block: string[], range: string[], startLine: number): RepairOutcome {
  if (arraysEqual(block, range)) return { lines: block, repair: null }

  /** Every place the block splits one logical line across two entries. */
  const wrapSites = findWrapSites(block)
  if (wrapSites.length > 1) return { lines: block, repair: null }

  /** The single split, present only when the block names exactly one place to repair. */
  const site = wrapSites[0]
  if (site) {
    /** The one line the two entries spell once rejoined. */
    const joined = `${block[site.index] ?? ""}${site.separator}${block[site.index + 1] ?? ""}`
    return {
      lines: [...block.slice(0, site.index), joined, ...block.slice(site.index + 2)],
      repair: { kind: "wrapped-line", at: site.index, line: startLine, span: 2 },
    }
  }

  if (isFlushLeftBlock(block, range)) {
    return {
      lines: pairIndent(block, range),
      repair: { kind: "paired-indent", at: 0, line: startLine, span: block.length },
    }
  }

  return { lines: block, repair: null }
}

/**
 * Replace the single line at `anchor`, re-applying the replaced line's indent to the first new line.
 *
 * @param lines - the current file lines.
 * @param anchor - `LINE#HASH` anchor of the line to replace.
 * @param newText - the replacement, one line or a block.
 * @returns a NEW line array plus any repair the block needed; the caller's array is never mutated.
 */
function applySetLine(lines: string[], anchor: string, newText: string | string[]): RepairOutcome {
  /** Zero-based index parsed out of the anchor. */
  const { line } = parseLineRef(anchor)
  /** Copy of the caller's lines. */
  const result = [...lines]
  /** The replaced line, used as the indent template; "" when the parsed line is out of range. */
  const originalLine = lines[line - 1] ?? ""
  /** The replacement block, with a mangled wrap or a lost block indent undone when it names one. */
  const repaired = repairReplacementBlock(toNewLines(newText), [originalLine], line)
  /** Replacement lines; only index 0 still lacks the original indent. */
  const replacement = repaired.lines.map((entry, index) => {
    if (index !== 0) return entry
    return restoreLeadingIndent(originalLine, entry)
  })
  result.splice(line - 1, 1, ...replacement)
  return { lines: result, repair: repaired.repair }
}

/**
 * Replace the inclusive line range from `startAnchor` to `endAnchor` in one splice.
 *
 * @param lines - the current file lines.
 * @param startAnchor - `LINE#HASH` anchor of the first line of the range.
 * @param endAnchor - `LINE#HASH` anchor of the last line of the range.
 * @param newText - the replacement, one line or a block.
 * @returns a NEW line array plus any repair the block needed.
 * @throws Error when the start line is after the end line.
 */
function applyReplaceLines(lines: string[], startAnchor: string, endAnchor: string, newText: string | string[]): RepairOutcome {
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
  /** The replaced lines themselves, which are the repair pass's only ground truth. */
  const range = lines.slice(startLine - 1, endLine)
  /** The stripped block, with a mangled wrap or a lost block indent undone when it names one. */
  const repaired = repairReplacementBlock(stripped, range, startLine)
  /** Final replacement lines; only the first inherits the range's leading indent. */
  const restored = repaired.lines.map((entry, index) => {
    if (index !== 0) return entry
    return restoreLeadingIndent(lines[startLine - 1] ?? "", entry)
  })
  result.splice(startLine - 1, endLine - startLine + 1, ...restored)
  return { lines: result, repair: repaired.repair }
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
    return { content, noopEdits: 0, deduplicatedEdits: 0, repairs: [] }
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

  /** Repairs the conservative pass applied, in application order, for the tool result to report. */
  const repairs: HashlineRepairReport[] = []

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
        /** Lines after this replace, plus any repair the replacement block needed to produce them. */
        const outcome = edit.end
          ? applyReplaceLines(lines, edit.pos, edit.end, edit.lines)
          : applySetLine(lines, edit.pos, edit.lines)
        if (arraysEqual(outcome.lines, lines)) {
          noopEdits += 1
          break
        }
        lines = outcome.lines
        if (outcome.repair) repairs.push(outcome.repair)
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
    repairs,
  }
}
