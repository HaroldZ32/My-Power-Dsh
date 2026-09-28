import { computeLineHash } from "./hash-computation"

// Line-view diff of two file versions: `---`/`+++` headers, then one `-`/`+` row per changed line, each carrying its position and hash.
export function generateHashlineDiff(oldContent: string, newContent: string, filePath: string): string {
  // Old revision split into lines; the `---` header repeats the path, not the content.
  const oldLines = oldContent.split("\n")
  // New revision split into lines, compared position by position.
  const newLines = newContent.split("\n")

  // Emitted rows; the header carries a trailing newline because every row is pushed with its own.
  const parts: string[] = [`--- ${filePath}\n+++ ${filePath}\n`]
  // Rows to walk: the longer revision, so trailing additions or deletions still get a row.
  const maxLines = Math.max(oldLines.length, newLines.length)

  for (let i = 0; i < maxLines; i += 1) {
    // Old-side text at this zero-based position, empty when the old revision was shorter.
    const oldLine = oldLines[i] ?? ""
    // New-side text at the same position, empty when the new revision is shorter.
    const newLine = newLines[i] ?? ""
    // 1-based line number printed in the row.
    const lineNum = i + 1
    // Anchor hash of the new-side text; a deletion row prints blanks instead.
    const hash = computeLineHash(lineNum, newLine)

    if (i >= oldLines.length) {
      parts.push(`+ ${lineNum}#${hash}|${newLine}\n`)
      continue
    }
    if (i >= newLines.length) {
      parts.push(`- ${lineNum}#  |${oldLine}\n`)
      continue
    }
    if (oldLine !== newLine) {
      parts.push(`- ${lineNum}#  |${oldLine}\n`)
      parts.push(`+ ${lineNum}#${hash}|${newLine}\n`)
    }
  }

  return parts.join("")
}
