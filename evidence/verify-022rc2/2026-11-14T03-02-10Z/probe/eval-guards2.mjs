// T5 guard evaluator: extract each six-row `disabled:` expression from a patch text and evaluate it
// the way the loader does — a `ctx` carrying the profile baseUrl — printing the boolean the loader
// would see. Read-only; no YAML library needed.
import { readFileSync } from "node:fs"

/** The six team-row ids the wave contract D4 defines. */
const IDS = ["mpd-agent-team", "mpd-tool-agent-team", "mpd-ui-agent-team", "mpd-agent-team-rc2", "mpd-tool-agent-team-rc2", "mpd-ui-agent-team-rc2"]

/**
 * Pull one row's `disabled:` scalar out of patch text by line scan.
 * @param lines The patch file split into lines.
 * @param id The row id to locate.
 * @returns The raw scalar text, `null` when no `disabled:` key follows, or `undefined` when the row is absent.
 */
function disabledFor(lines, id) {
  const start = lines.findIndex((line) => line.trim() === "- id: " + id)
  if (start < 0) return undefined
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^\s*-\s*id:/.test(lines[i]) || /^\s*-\s*(insert|target|patch):/.test(lines[i])) return null
    const match = /^\s*disabled:\s*(.*)$/.exec(lines[i])
    if (match !== null) return match[1]
  }
  return null
}

/**
 * Unwrap a YAML scalar into the expression text the loader evals.
 * @param scalar The text after `disabled:`.
 * @returns The expression text, or a marker describing a non-expression value.
 */
function expressionOf(scalar) {
  if (scalar === null) return "absent (enabled)"
  const trimmed = scalar.trim()
  if (!trimmed.startsWith("!!js")) return "literal: " + trimmed
  const quoted = trimmed.slice(4).trim()
  if (!quoted.startsWith('"')) return "unquoted: " + quoted
  const inner = quoted.slice(1, quoted.lastIndexOf('"'))
  // The payloads this repository ships carry no escaped double quote; unescape the two forms anyway.
  return inner.replaceAll('\\"', '"').replaceAll("\\\\", "\\")
}

/** Evaluate one expression against a stub ctx, returning what the loader would get. */
function evalGuard(src) {
  try {
    const fn = new Function("ctx", "return (" + src + ")")
    return String(fn({ baseUrl: "file://" + process.cwd() + "/", loader: { entries: () => [] } }))
  } catch (error) {
    return "THREW: " + String(error && error.message ? error.message : error)
  }
}

for (const file of process.argv.slice(2)) {
  const lines = readFileSync(file, "utf8").split("\n")
  console.log("### " + file)
  for (const id of IDS) {
    const raw = disabledFor(lines, id)
    if (raw === undefined) {
      console.log("  " + id + " -> ROW ABSENT")
      continue
    }
    const expr = expressionOf(raw)
    const value = expr.startsWith("abs") || expr.startsWith("literal") || expr.startsWith("unquoted") ? expr : evalGuard(expr)
    console.log("  " + id + " disabled=" + value + " (expr chars=" + expr.length + ")")
  }
}
