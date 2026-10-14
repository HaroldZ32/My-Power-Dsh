#!/usr/bin/env node
// f2-shell-backtick-scan.mjs — find backticks that are COMMAND SUBSTITUTION in a shell script, and nothing else.
//
// WHY A SCANNER AND NOT A GREP: a grep cannot tell a substitution site from inert text, so it reports
// false positives — a backtick inside a SINGLE-quoted `node -e` argument is literal, and that is where
// docker/tui-lane.sh keeps its whole JavaScript surface; a backtick inside a QUOTED heredoc body
// (`cat > f <<'EOF' … EOF`) is literal too — and a grep cannot see that `\`` is escaped. This walks the
// bytes once, tracking single quotes, double quotes, escapes, comments and heredocs, and reports a hit
// ONLY for a backtick the shell would EXECUTE: outside single quotes, outside a quoted heredoc, not
// escaped. Exit 0 when none is left, 1 when one is, 2 on usage.
//
// Usage: node evidence/tui/dsh-tui-015/docker-repair2/f2-shell-backtick-scan.mjs <file.sh> [...]
import { readFileSync } from "node:fs"

/** The scan's mutable state, kept across lines because a shell string may span them. */
const state = {
  /** `plain`, `single` or `double` — the quoting context the next character sits in. */
  quote: "plain",
  /** Whether the previous character was an unescaped backslash. */
  escaped: false,
  /** The heredoc body being skipped, or null: `{ delimiter, quoted }`. */
  heredoc: null,
  /** How many executed backticks this file holds. */
  hits: 0,
}

/** Report one executed backtick: where it is, and the line it sits on. */
function report(file, lines, lineIndex, label) {
  state.hits++
  console.log(`  ${label} ${file}:${lineIndex + 1}: ${lines[lineIndex].trim().slice(0, 140)}`)
}

/** Report every unescaped backtick of a heredoc body whose delimiter was NOT quoted. */
function scanExpandingBody(file, lines, lineIndex) {
  /** The body line, walked for unescaped backticks. */
  const line = lines[lineIndex]
  for (let index = 0; index < line.length; index++) {
    if (line[index] === "\\") { index++; continue }
    if (line[index] === "`") report(file, lines, lineIndex, "SUBSTITUTION-IN-HEREDOC")
  }
}

/** Scan one line in place, honouring the quote state carried in {@link state}. */
function scanLine(file, lines, lineIndex) {
  /** The line under inspection. */
  const line = lines[lineIndex]
  for (let index = 0; index < line.length; index++) {
    /** The character under inspection. */
    const ch = line[index]
    if (state.quote === "single") {
      if (ch === "'") state.quote = "plain"
      continue
    }
    if (state.escaped) { state.escaped = false; continue }
    if (ch === "\\") { state.escaped = true; continue }
    if (state.quote === "plain") {
      if (ch === "'") { state.quote = "single"; continue }
      if (ch === '"') { state.quote = "double"; continue }
      if (ch === "#" && (index === 0 || /[\s;&|(]/.test(line[index - 1]))) break
      if (ch === "<" && line[index + 1] === "<" && line[index + 2] !== "<") {
        /** Where the delimiter token starts. */
        let cursor = index + 2
        if (line[cursor] === "-") cursor++
        while (line[cursor] === " " || line[cursor] === "\t") cursor++
        /** Whether the delimiter was QUOTED, which is what makes the body literal. */
        let quoted = false
        /** The delimiter word the terminator line must equal. */
        let delimiter = ""
        if (line[cursor] === "'" || line[cursor] === '"') {
          quoted = true
          /** The quote character the delimiter opened with. */
          const quote = line[cursor]
          cursor++
          while (cursor < line.length && line[cursor] !== quote) delimiter += line[cursor++]
          cursor++
        } else {
          while (cursor < line.length && /[A-Za-z0-9_]/.test(line[cursor])) delimiter += line[cursor++]
        }
        if (delimiter !== "") state.heredoc = { delimiter, quoted }
        index = cursor - 1
        continue
      }
      if (ch === "`") report(file, lines, lineIndex, "SUBSTITUTION")
      continue
    }
    if (ch === '"') { state.quote = "plain"; continue }
    if (ch === "`") report(file, lines, lineIndex, "SUBSTITUTION")
  }
}

/** Scan one file's bytes and return its executed-backtick count. */
function scan(file, text) {
  state.quote = "plain"
  state.escaped = false
  state.heredoc = null
  state.hits = 0
  /** The file's lines. */
  const lines = text.split("\n")
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    if (state.heredoc !== null) {
      /** The heredoc terminator line, which may be indented with tabs under `<<-`. */
      const body = lines[lineIndex].replace(/^\t+/, "")
      if (body === state.heredoc.delimiter) { state.heredoc = null; continue }
      if (!state.heredoc.quoted) scanExpandingBody(file, lines, lineIndex)
      continue
    }
    state.escaped = false
    scanLine(file, lines, lineIndex)
  }
  return state.hits
}

/** Every path the caller named, or a usage line and exit 2. */
const files = process.argv.slice(2)
if (files.length === 0) {
  console.error("usage: node f2-shell-backtick-scan.mjs <file.sh> [...]")
  process.exit(2)
}
/** Total executed backticks across every file. */
let total = 0
for (const file of files) {
  console.log(`--- ${file}`)
  total += scan(file, readFileSync(file, "utf8"))
}
console.log(`TOTAL_SUBSTITUTION_SITES=${total}`)
process.exit(total === 0 ? 0 : 1)
