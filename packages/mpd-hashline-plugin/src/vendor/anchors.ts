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
// Hashline core: parsing and validating a caller's `LINE#HASH` anchor, and the stale-anchor report.
//
// Design ported from the hashline mode of `crates/pi-edit`: a quoted tag is checked against the
// CURRENT text before anything is written, and a mismatch is reported as a diagnostic that (a) says
// what happened, (b) shows the drifted lines with their FRESH anchors, and (c) tells the caller how to
// recover — rather than as a bare "hash mismatch". The anchored-context body is the same idea as
// pi-edit's `format_anchored_context`, rendered in this repository's `LINE#HASH|content` shape.

import { HASHLINE_REF_PATTERN } from "./constants"
import { computeLineHash } from "./hash"
import type { LineRef } from "./types"

/** Unchanged lines printed on either side of a drifted one, so the caller can see what moved. */
const MISMATCH_CONTEXT = 2

/** Fallback scan for an anchor embedded in decorated text; capture 1 is the hash-shaped pair found. */
const LINE_REF_EXTRACT_PATTERN = /([0-9]+#[ZPMQVRWSNKTXJBYH]{2})/

/** One stale anchor: the drifted line plus the digest the caller quoted for it. */
interface HashMismatch {
  /** 1-based line number whose digest no longer matches. */
  line: number
  /** Digest the caller quoted, kept so the report can pair it with the current one. */
  expected: string
}

/**
 * Canonical spelling of a caller-supplied anchor: a leading `>>>`/`+`/`-` decoration, spacing around
 * the `#`, and any `|content` tail are stripped; text with no recognizable anchor is returned trimmed.
 *
 * @param ref - the anchor as the caller wrote it.
 * @returns the bare `LINE#HASH` spelling when one can be recognized, else the trimmed input.
 */
export function normalizeLineRef(ref: string): string {
  /** Untrimmed result kept as the fallback when no anchor can be recognized. */
  const originalTrimmed = ref.trim()
  /** Working copy, progressively stripped down towards a bare anchor. */
  let trimmed = originalTrimmed
  trimmed = trimmed.replace(/^(?:>>>|[+-])\s*/, "")
  trimmed = trimmed.replace(/\s*#\s*/, "#")
  trimmed = trimmed.replace(/\|.*$/, "")
  trimmed = trimmed.trim()

  if (HASHLINE_REF_PATTERN.test(trimmed)) {
    return trimmed
  }

  /** Hash-shaped pair embedded in longer text, used only when the string is not already a bare anchor. */
  const extracted = trimmed.match(LINE_REF_EXTRACT_PATTERN)
  if (extracted) {
    return extracted[1] ?? originalTrimmed
  }

  return originalTrimmed
}

/**
 * Split an anchor into its line number and digest.
 *
 * @param ref - the anchor, decorated or bare.
 * @returns the parsed line number and digest.
 * @throws Error when the text is not an anchor — including the swapped number/digest case, which gets its own message.
 */
export function parseLineRef(ref: string): LineRef {
  /** Canonical spelling of the caller's reference, which the pattern below expects. */
  const normalized = normalizeLineRef(ref)
  /** Strict anchor match; its absence leaves the malformed-reference diagnostic to the code below. */
  const match = normalized.match(HASHLINE_REF_PATTERN)
  if (match) {
    return {
      line: Number.parseInt(match[1] ?? "", 10),
      hash: match[2] ?? "",
    }
  }

  /** Offset of the `#`, or -1 when the reference carries none. */
  const hashIndex = normalized.indexOf("#")
  if (hashIndex > 0) {
    /** Text before the `#`, i.e. what the caller pasted in place of a line number. */
    const prefix = normalized.slice(0, hashIndex)
    /** Text after the `#`, expected to be the two-character digest. */
    const suffix = normalized.slice(hashIndex + 1)
    // A swapped pair is the common paste mistake, and "invalid format" alone never explains it.
    if (!/^\d+$/.test(prefix) && /^[ZPMQVRWSNKTXJBYH]{2}$/.test(suffix)) {
      throw new Error(
        `Invalid line reference: "${ref}". "${prefix}" is not a line number. ` +
          "Use the actual line number from the read output.",
      )
    }
  }
  throw new Error(`Invalid line reference format: "${ref}". Expected format: "{line_number}#{hash_id}"`)
}

/**
 * Suggest the anchor a caller probably meant, by finding the line carrying the quoted digest.
 *
 * @param ref - the reference that failed to parse.
 * @param lines - the current file lines, which the digest is searched across.
 * @returns a `Did you mean "LINE#HASH"?` sentence, or null when no line carries that digest.
 */
function suggestLineForHash(ref: string, lines: string[]): string | null {
  /** Trailing digest of the reference, or null when it does not end in one at all. */
  const hashMatch = ref.trim().match(/#([ZPMQVRWSNKTXJBYH]{2})$/)
  if (!hashMatch) return null
  /** The quoted digest, searched for across the file's lines below. */
  const hash = hashMatch[1]
  for (let i = 0; i < lines.length; i++) {
    if (computeLineHash(i + 1, lines[i] ?? "") === hash) {
      return `Did you mean "${i + 1}#${computeLineHash(i + 1, lines[i] ?? "")}"?`
    }
  }
  return null
}

/**
 * Parse one anchor, appending the "Did you mean" suggestion when parsing alone cannot place it.
 *
 * @param ref - the anchor as the caller wrote it.
 * @param lines - the current file lines, used only to build the suggestion.
 * @returns the parsed anchor.
 * @throws Error carrying the original parse failure, with the suggestion appended when one exists.
 */
function parseLineRefWithHint(ref: string, lines: string[]): LineRef {
  try {
    return parseLineRef(ref)
  } catch (parseError) {
    /** Suggested replacement anchor, or null when no line carries the quoted digest. */
    const hint = suggestLineForHash(ref, lines)
    if (hint && parseError instanceof Error) {
      throw new Error(`${parseError.message} ${hint}`)
    }
    throw parseError
  }
}

/**
 * Raised when one or more quoted anchors no longer match the file, i.e. the text drifted since the
 * caller read it. Carries a stale-to-current anchor map so a caller can retry without a full re-read.
 */
export class HashlineMismatchError extends Error {
  /** Stale anchor (`LINE#HASH`) to current anchor for the same line, for every drifted line. */
  readonly remaps: ReadonlyMap<string, string>

  /**
   * Build the report and the remap table.
   *
   * @param mismatches - the drifted lines with the digests the caller quoted.
   * @param fileLines - the current file lines the anchors were checked against.
   */
  constructor(mismatches: HashMismatch[], fileLines: string[]) {
    super(HashlineMismatchError.formatMessage(mismatches, fileLines))
    this.name = "HashlineMismatchError"
    /** Stale-to-current anchor pairs, filled one drifted line at a time. */
    const remaps = new Map<string, string>()
    for (const mismatch of mismatches) {
      /** Digest this line carries NOW; the quoted one is by definition the stale side of the pair. */
      const actual = computeLineHash(mismatch.line, fileLines[mismatch.line - 1] ?? "")
      remaps.set(`${mismatch.line}#${mismatch.expected}`, `${mismatch.line}#${actual}`)
    }
    this.remaps = remaps
  }

  /**
   * Render the caller-facing body: what happened, what to do about it, then the drifted lines with
   * their context, `>>>` marking every changed one.
   *
   * @param mismatches - the drifted lines with their quoted digests.
   * @param fileLines - the current file lines.
   * @returns the message body, newline-joined.
   */
  static formatMessage(mismatches: HashMismatch[], fileLines: string[]): string {
    /** Drifted lines by number, so a line appearing in several mismatches is marked once. */
    const mismatchByLine = new Map<number, HashMismatch>()
    for (const mismatch of mismatches) mismatchByLine.set(mismatch.line, mismatch)

    /** Every line number to print: each drift plus its context window, in insertion order. */
    const displayLines = new Set<number>()
    for (const mismatch of mismatches) {
      /** First line of this drift's context window, clamped to line 1. */
      const low = Math.max(1, mismatch.line - MISMATCH_CONTEXT)
      /** Last line of this drift's context window, clamped to the file's final line. */
      const high = Math.min(fileLines.length, mismatch.line + MISMATCH_CONTEXT)
      for (let line = low; line <= high; line++) displayLines.add(line)
    }

    /** Display lines in ascending order, which is the order the report reads in. */
    const sortedLines = [...displayLines].sort((a, b) => a - b)
    /** Report lines, joined with newlines on return. */
    const output: string[] = []
    output.push(
      `${mismatches.length} line${mismatches.length > 1 ? "s have" : " has"} changed since last read. ` +
        "Use updated {line_number}#{hash_id} references below (>>> marks changed lines).",
    )
    output.push(
      "The file changed between the read that issued these anchors and this edit. Re-read it with " +
        "mpd_hashline_read to refresh every anchor, and never reuse an anchor from an earlier session.",
    )
    output.push("")

    /** Previous printed line number, or -1 before the first, so a gap can be elided with `...`. */
    let previousLine = -1
    for (const line of sortedLines) {
      if (previousLine !== -1 && line > previousLine + 1) {
        output.push("    ...")
      }
      previousLine = line

      /** Text of this display line, empty when the file has no such line. */
      const content = fileLines[line - 1] ?? ""
      /** Current digest for the display line, which is what the caller should quote next. */
      const hash = computeLineHash(line, content)
      /** Rendered anchor line, before its `>>>` or blank marker. */
      const prefix = `${line}#${hash}|${content}`
      if (mismatchByLine.has(line)) {
        output.push(`>>> ${prefix}`)
      } else {
        output.push(`    ${prefix}`)
      }
    }

    return output.join("\n")
  }
}

/**
 * Validate ONE anchor against the current file text: parse it, bounds-check the line, then require the
 * quoted digest to be the one that line carries now.
 *
 * @param lines - the current file lines.
 * @param ref - the anchor the caller quoted.
 * @returns nothing.
 * @throws Error for a malformed or out-of-bounds anchor, and HashlineMismatchError for a stale digest.
 */
export function validateLineRef(lines: string[], ref: string): void {
  /** Parsed anchor, carrying the "did you mean" hint when parsing alone cannot resolve it. */
  const { line, hash } = parseLineRefWithHint(ref, lines)

  if (line < 1 || line > lines.length) {
    throw new Error(`Line number ${line} out of bounds. File has ${lines.length} lines.`)
  }

  /** Current text of the referenced line, which the quoted digest must match. */
  const content = lines[line - 1] ?? ""
  if (computeLineHash(line, content) !== hash) {
    throw new HashlineMismatchError([{ line, expected: hash }], lines)
  }
}

/**
 * Validate every anchor of a batch at once, so ONE report names all the drifted lines instead of the
 * caller discovering them one failed edit at a time.
 *
 * @param lines - the current file lines.
 * @param refs - every anchor the batch references.
 * @returns nothing.
 * @throws Error naming the first out-of-bounds line, or HashlineMismatchError carrying every drifted one.
 */
export function validateLineRefs(lines: string[], refs: string[]): void {
  /** Every drifted anchor, collected before the report is raised. */
  const mismatches: HashMismatch[] = []

  for (const ref of refs) {
    /** Parsed anchor, with the "did you mean" hint when parsing alone cannot resolve it. */
    const { line, hash } = parseLineRefWithHint(ref, lines)
    if (line < 1 || line > lines.length) {
      throw new Error(`Line number ${line} out of bounds (file has ${lines.length} lines)`)
    }
    if (computeLineHash(line, lines[line - 1] ?? "") !== hash) {
      mismatches.push({ line, expected: hash })
    }
  }

  if (mismatches.length > 0) {
    throw new HashlineMismatchError(mismatches, lines)
  }
}
