/** Matches a rendered hashline anchor (`>>> 12#AB|`) at the start of a pasted line. */
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
  // `/^\s*/` always matches, so the null branch only satisfies the type checker.
  const match = text.match(/^\s*/)
  return match ? match[0] : ""
}

/** Strip a pasted hashline or diff `+` prefix when at least half the non-empty lines carry one. */
export function stripLinePrefixes(lines: string[]): string[] {
  // Non-empty lines carrying a rendered `LINE#HASH|` anchor prefix.
  let hashPrefixCount = 0
  // Non-empty lines carrying a diff `+` prefix.
  let diffPlusCount = 0
  // Lines that are not empty; the stripping threshold is a fraction of this count.
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

  // Strip anchors only when they cover at least half the non-empty lines, so ordinary prose
  // that happens to contain one rendered anchor is left intact.
  const stripHash = hashPrefixCount > 0 && hashPrefixCount >= nonEmpty * 0.5
  // Diff markers are considered only when anchors did not win, so a line is never stripped twice.
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

/** Normalize caller-supplied text into lines, stripping pasted anchors or diff markers. */
export function toNewLines(input: string | string[]): string[] {
  if (Array.isArray(input)) {
    return stripLinePrefixes(input)
  }
  return stripLinePrefixes(input.split("\n"))
}

/** Give `line` the indent of `templateLine` when `line` has none and differs in content. */
export function restoreLeadingIndent(templateLine: string, line: string): string {
  if (line.length === 0) return line
  // Whitespace to copy onto `line`; an unindented template leaves nothing to restore.
  const templateIndent = leadingWhitespace(templateLine)
  if (templateIndent.length === 0) return line
  if (leadingWhitespace(line).length > 0) return line
  if (templateLine.trim() === line.trim()) return line
  return `${templateIndent}${line}`
}

/** Drop a leading fragment that merely re-states the anchor line, i.e. an unchanged-content echo. */
export function stripInsertAnchorEcho(anchorLine: string, newLines: string[]): string[] {
  if (newLines.length === 0) return newLines
  if (equalsIgnoringWhitespace(newLines[0], anchorLine)) {
    return newLines.slice(1)
  }
  return newLines
}

/** Drop a trailing fragment that merely re-states the anchor line, i.e. an unchanged-content echo. */
export function stripInsertBeforeEcho(anchorLine: string, newLines: string[]): string[] {
  if (newLines.length <= 1) return newLines
  if (equalsIgnoringWhitespace(newLines[newLines.length - 1], anchorLine)) {
    return newLines.slice(0, -1)
  }
  return newLines
}

/** Drop a leading echo of the line after the insertion point and a trailing echo of the line before it. */
export function stripInsertBoundaryEcho(afterLine: string, beforeLine: string, newLines: string[]): string[] {
  // Working list; boundary echoes are sliced off one end at a time, so each test re-reads `out`.
  let out = newLines
  if (out.length > 0 && equalsIgnoringWhitespace(out[0], afterLine)) {
    out = out.slice(1)
  }
  if (out.length > 0 && equalsIgnoringWhitespace(out[out.length - 1], beforeLine)) {
    out = out.slice(0, -1)
  }
  return out
}

/** Remove replacement lines that exactly echo the lines just outside the replaced range. */
export function stripRangeBoundaryEcho(
  lines: string[],
  startLine: number,
  endLine: number,
  newLines: string[]
): string[] {
  // Number of existing lines the range covers; a replacement no longer than this cannot echo them.
  const replacedCount = endLine - startLine + 1
  if (newLines.length <= 1 || newLines.length <= replacedCount) {
    return newLines
  }

  // Working list; boundary echoes are sliced off one end at a time, so each test re-reads `out`.
  let out = newLines
  // Zero-based index of the line just before the range, or -1 when the range starts at line 1.
  const beforeIdx = startLine - 2
  if (beforeIdx >= 0 && out[0] === lines[beforeIdx]) {
    out = out.slice(1)
  }

  // Zero-based index of the line just after the range, i.e. one past `endLine`.
  const afterIdx = endLine
  if (afterIdx < lines.length && out.length > 0 && out[out.length - 1] === lines[afterIdx]) {
    out = out.slice(0, -1)
  }

  return out
}
