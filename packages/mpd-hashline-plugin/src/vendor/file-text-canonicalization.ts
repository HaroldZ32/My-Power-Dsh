/** The canonical form of one file's text plus the two facts needed to restore its BOM and line ending. */
export interface FileTextEnvelope {
  /** File text with a leading BOM removed and every line ending normalized to `\n`. */
  content: string
  /** Whether a leading `U+FEFF` was stripped, so the write-back can put it back. */
  hadBom: boolean
  /**
   * Line ending of the file's first line break, reapplied to every line on write-back; a file with
   * mixed endings therefore comes back uniformly ended.
   */
  lineEnding: "\n" | "\r\n"
}

/** Line ending of the first break in `content`; `\n` when the text has no break or breaks with a lone LF. */
function detectLineEnding(content: string): "\n" | "\r\n" {
  /** Offset of the first CRLF pair, or -1 when the text carries none. */
  const crlfIndex = content.indexOf("\r\n")
  /** Offset of the first LF, which is also -1 when the text has no line break at all. */
  const lfIndex = content.indexOf("\n")
  if (lfIndex === -1) return "\n"
  if (crlfIndex === -1) return "\n"
  return crlfIndex < lfIndex ? "\r\n" : "\n"
}

/** Remove one leading `U+FEFF` and report whether it was there; the text comes back unchanged otherwise. */
function stripBom(content: string): { content: string; hadBom: boolean } {
  if (!content.startsWith("\uFEFF")) {
    return { content, hadBom: false }
  }
  return { content: content.slice(1), hadBom: true }
}

/** Replace CRLF and lone CR with `\n`, in that order, so one CRLF is never turned into two line feeds. */
function normalizeToLf(content: string): string {
  return content.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
}

/** Expand every `\n` to CRLF when the file used CRLF; a no-op for an LF file. */
function restoreLineEndings(content: string, lineEnding: "\n" | "\r\n"): string {
  if (lineEnding === "\n") return content
  return content.replace(/\n/g, "\r\n")
}

/** Split `content` into the envelope's canonical text plus the BOM and line-ending facts that restore it. */
export function canonicalizeFileText(content: string): FileTextEnvelope {
  /** BOM-stripped text plus the flag recording that a BOM was removed. */
  const stripped = stripBom(content)
  return {
    content: normalizeToLf(stripped.content),
    hadBom: stripped.hadBom,
    lineEnding: detectLineEnding(stripped.content),
  }
}

/** Write `content` back in the envelope's shape: its line ending first, then its leading BOM. */
export function restoreFileText(content: string, envelope: FileTextEnvelope): string {
  /** Normalized content carrying the envelope's line ending but not yet its BOM. */
  const withLineEnding = restoreLineEndings(content, envelope.lineEnding)
  if (!envelope.hadBom) return withLineEnding
  return `\uFEFF${withLineEnding}`
}
