import { computeLegacyLineHash, computeLineHash } from "./hash-computation"
import { HASHLINE_REF_PATTERN } from "./constants"

// A parsed anchor: the 1-based line it points at, plus the two-letter hash the reader saw for that line.
export interface LineRef {
  // 1-based line number as written by the caller.
  line: number
  // Two-letter hash the caller quoted for that line.
  hash: string
}

// One stale anchor: the line whose stored hash no longer matches its current content, and the hash that was quoted.
interface HashMismatch {
  // 1-based line number that drifted.
  line: number
  // Hash the caller quoted, kept so the error can map it onto the current one.
  expected: string
}

// Context window shown around each drifted line in the error body: this many unchanged lines on either side.
const MISMATCH_CONTEXT = 2

// Fallback scan for an anchor embedded in decorated text; capture 1 is the LAST hash-shaped pair in the string.
const LINE_REF_EXTRACT_PATTERN = /([0-9]+#[ZPMQVRWSNKTXJBYH]{2})/

// Whether the quoted hash is the current one for this line, or the legacy normalization's; either accepts the anchor.
function isCompatibleLineHash(line: number, content: string, hash: string): boolean {
  return computeLineHash(line, content) === hash || computeLegacyLineHash(line, content) === hash
}

// Canonical spelling of a user-supplied anchor: decoration, `#` spacing and trailing content are stripped; unrecognizable text is returned trimmed.
export function normalizeLineRef(ref: string): string {
  // Untrimmed input kept as the fallback result when no anchor can be recognized.
  const originalTrimmed = ref.trim()
  // Working copy of the text as it is progressively stripped down to the bare anchor.
  let trimmed = originalTrimmed
  trimmed = trimmed.replace(/^(?:>>>|[+-])\s*/, "")
  trimmed = trimmed.replace(/\s*#\s*/, "#")
  trimmed = trimmed.replace(/\|.*$/, "")
  trimmed = trimmed.trim()

  if (HASHLINE_REF_PATTERN.test(trimmed)) {
    return trimmed
  }

  // Hash-shaped pair embedded in longer text, when the string is not already a bare anchor.
  const extracted = trimmed.match(LINE_REF_EXTRACT_PATTERN)
  if (extracted) {
    return extracted[1]
  }

  return originalTrimmed
}

// Split an anchor into its line number and hash; throws when the text is not an anchor at all — or when a line-number/hash swap is detected, which gets its own message.
export function parseLineRef(ref: string): LineRef {
  // Canonical spelling of the caller's reference, which the patterns below expect.
  const normalized = normalizeLineRef(ref)
  // Strict anchor match; its absence leaves the malformed-reference diagnostic to the code below.
  const match = normalized.match(HASHLINE_REF_PATTERN)
  if (match) {
    return {
      line: Number.parseInt(match[1], 10),
      hash: match[2],
    }
  }
  // Offset of the `#`, or -1 when the reference carries none.
  const hashIdx = normalized.indexOf('#')
  if (hashIdx > 0) {
    // Text before the `#`, i.e. what the caller offered as the line number or pasted there instead.
    const prefix = normalized.slice(0, hashIdx)
    // Text after the `#`, expected to be the two-letter hash.
    const suffix = normalized.slice(hashIdx + 1)
    if (!/^\d+$/.test(prefix) && /^[ZPMQVRWSNKTXJBYH]{2}$/.test(suffix)) {
      throw new Error(
        `Invalid line reference: "${ref}". "${prefix}" is not a line number. ` +
          `Use the actual line number from the read output.`
      )
    }
  }
  throw new Error(
    `Invalid line reference format: "${ref}". Expected format: "{line_number}#{hash_id}"`
  )
}

// Validate ONE anchor against the current file text: parse it, bounds-check the line, then require a compatible hash; throws otherwise.
export function validateLineRef(lines: string[], ref: string): void {
  // Parsed anchor, with the "did you mean" hint appended when parsing alone cannot resolve it.
  const { line, hash } = parseLineRefWithHint(ref, lines)

  if (line < 1 || line > lines.length) {
    throw new Error(
      `Line number ${line} out of bounds. File has ${lines.length} lines.`
    )
  }

  // Current text of the referenced line, which the quoted hash must match.
  const content = lines[line - 1]
  if (!isCompatibleLineHash(line, content, hash)) {
    throw new HashlineMismatchError([{ line, expected: hash }], lines)
  }
}

// Thrown when one or more quoted anchors no longer match the file; carries the remap map so a caller can retry with fresh references.
export class HashlineMismatchError extends Error {
  // Stale anchor (`LINE#HASH`) → current anchor for the same line, for every drifted line.
  readonly remaps: ReadonlyMap<string, string>

  // Build the message and the remap table from the drifted lines and the file text they were checked against.
  constructor(
    private readonly mismatches: HashMismatch[],
    private readonly fileLines: string[]
  ) {
    super(HashlineMismatchError.formatMessage(mismatches, fileLines))
    this.name = "HashlineMismatchError"
    // Stale → current anchor pairs, filled one drifted line at a time.
    const remaps = new Map<string, string>()
    for (const mismatch of mismatches) {
      // Hash this line carries now; the quoted one is by definition the stale side of the pair.
      const actual = computeLineHash(mismatch.line, fileLines[mismatch.line - 1] ?? "")
      remaps.set(`${mismatch.line}#${mismatch.expected}`, `${mismatch.line}#${actual}`)
    }
    this.remaps = remaps
  }

  // Render the user-facing error body: a count line, then the drifted lines with their context, `>>>` marking each changed line.
  static formatMessage(mismatches: HashMismatch[], fileLines: string[]): string {
    // Drifted lines by number, so a line appearing in several mismatches is marked once.
    const mismatchByLine = new Map<number, HashMismatch>()
    for (const mismatch of mismatches) mismatchByLine.set(mismatch.line, mismatch)

    // Every line number to print: each drift plus its context window, in insertion order.
    const displayLines = new Set<number>()
    for (const mismatch of mismatches) {
      // First line of this drift's context window, clamped to line 1.
      const low = Math.max(1, mismatch.line - MISMATCH_CONTEXT)
      // Last line of this drift's context window, clamped to the file's final line.
      const high = Math.min(fileLines.length, mismatch.line + MISMATCH_CONTEXT)
      for (let line = low; line <= high; line++) displayLines.add(line)
    }

    // Display lines in ascending order, which is the order the message reads in.
    const sortedLines = [...displayLines].sort((a, b) => a - b)
    // Message lines; joined with newlines on return.
    const output: string[] = []
    output.push(
      `${mismatches.length} line${mismatches.length > 1 ? "s have" : " has"} changed since last read. ` +
        "Use updated {line_number}#{hash_id} references below (>>> marks changed lines)."
    )
    output.push("")

    // Previous printed line number, or -1 before the first, so a gap can be elided with `...`.
    let previousLine = -1
    for (const line of sortedLines) {
      if (previousLine !== -1 && line > previousLine + 1) {
        output.push("    ...")
      }
      previousLine = line

      // Text of this display line, empty when the file has no such line.
      const content = fileLines[line - 1] ?? ""
      // Current anchor hash for the display line, which is what the caller should quote next.
      const hash = computeLineHash(line, content)
      // Rendered `LINE#HASH|content` view line, before its `>>>` or blank marker.
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

// Build a "Did you mean" hint by finding the line whose hash matches the quoted one, or null when no line does.
function suggestLineForHash(ref: string, lines: string[]): string | null {
  // Trailing `#HH` of the reference, or null when it does not end in a hash at all.
  const hashMatch = ref.trim().match(/#([ZPMQVRWSNKTXJBYH]{2})$/)
  if (!hashMatch) return null
  // The quoted hash, searched for across the file's lines below.
  const hash = hashMatch[1]
  for (let i = 0; i < lines.length; i++) {
    if (isCompatibleLineHash(i + 1, lines[i], hash)) {
      return `Did you mean "${i + 1}#${computeLineHash(i + 1, lines[i])}"?`
    }
  }
  return null
}
// Parse one anchor, appending the "Did you mean" suggestion when parsing fails and a matching line exists; otherwise rethrows.
function parseLineRefWithHint(ref: string, lines: string[]): LineRef {
  try {
    return parseLineRef(ref)
  } catch (parseError) {
    // Suggested replacement anchor, or null when no line carries the quoted hash.
    const hint = suggestLineForHash(ref, lines)
    if (hint && parseError instanceof Error) {
      throw new Error(`${parseError.message} ${hint}`)
    }
    throw parseError
  }
}

// Validate a whole batch of anchors against the same file text: parses and bounds-checks all of them, then reports every hash drift at once.
export function validateLineRefs(lines: string[], refs: string[]): void {
  // Drifted anchors collected while scanning, reported together only after the loop finishes.
  const mismatches: HashMismatch[] = []

  for (const ref of refs) {
    // Parsed anchor for this entry of the batch, with the "did you mean" hint on failure.
    const { line, hash } = parseLineRefWithHint(ref, lines)

    if (line < 1 || line > lines.length) {
      throw new Error(`Line number ${line} out of bounds (file has ${lines.length} lines)`)
    }

    // Current text of the referenced line, which the quoted hash must match.
    const content = lines[line - 1]
    if (!isCompatibleLineHash(line, content, hash)) {
      mismatches.push({ line, expected: hash })
    }
  }

  if (mismatches.length > 0) {
    throw new HashlineMismatchError(mismatches, lines)
  }
}
