// T5 guard evaluator v3: extract each six-row `disabled:` expression from a patch text and evaluate
// it with the SAME inputs the loader gives it — process.argv[1] realpath'd and ctx.baseUrl set from
// the environment — so the boolean printed is the one the loader would resolve. Read-only.
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
  return inner.replaceAll('\\"', '"').replaceAll("\\\\", "\\")
}

/** Evaluate one expression against the loader-shaped ctx, returning what the loader would get. */
function evalGuard(src) {
  const ctx = { baseUrl: process.env.T5_BASEURL ?? "file://" + process.cwd() + "/", loader: { entries: () => [] } }
  try {
    const fn = new Function("ctx", "return (" + src + ")")
    return String(fn(ctx))
  } catch (error) {
    return "THREW: " + String(error && error.message ? error.message : error)
  }
}

// The harness launcher the real loader would expose as argv[1]; overridden so the guard's walk reads
// the requested generation instead of this script's own path.
if (typeof process.env.T5_ARGV1 === "string" && process.env.T5_ARGV1 !== "") process.argv[1] = process.env.T5_ARGV1

for (const file of process.argv.slice(2)) {
  const lines = readFileSync(file, "utf8").split("\n")
  console.log("### " + file + "  argv1=" + process.argv[1] + "  baseUrl=" + (process.env.T5_BASEURL ?? "<cwd>"))
  for (const id of IDS) {
    const raw = disabledFor(lines, id)
    if (raw === undefined) {
      console.log("  " + id + " -> ROW ABSENT")
      continue
    }
    const expr = expressionOf(raw)
    const value = expr.startsWith("abs") || expr.startsWith("literal") || expr.startsWith("unquoted") ? expr : evalGuard(expr)
    console.log("  " + id + " disabled=" + value)
  }
}
