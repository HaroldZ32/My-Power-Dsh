// T5 guard evaluator: run each six-row `disabled:` expression the way the loader does — eval with a
// `ctx` carrying the profile baseUrl — and print the boolean the loader would see. Read-only.
import { readFileSync } from "node:fs"
import YAML from "yaml"

/** The six team-row ids the wave contract D4 defines. */
const IDS = ["mpd-agent-team", "mpd-tool-agent-team", "mpd-ui-agent-team", "mpd-agent-team-rc2", "mpd-tool-agent-team-rc2", "mpd-ui-agent-team-rc2"]

/** Collect every mapping node whose `id` is one of the six rows. */
function collect(node, rows) {
  if (Array.isArray(node)) {
    for (const entry of node) collect(entry, rows)
    return
  }
  if (node !== null && typeof node === "object") {
    if (typeof node.id === "string" && IDS.includes(node.id)) rows.push(node)
    for (const value of Object.values(node)) collect(value, rows)
  }
}

/** Evaluate one row's `disabled:` text against a stub ctx, returning what the loader would get. */
function evalGuard(row) {
  const src = row.disabled
  if (src === undefined) return "absent (enabled)"
  if (typeof src !== "string") return "non-string: " + JSON.stringify(src)
  if (!src.includes("!!js")) return "literal: " + src
  // The loader evals the payload inside `with (ctx)`; a Function with `ctx` bound covers the
  // `baseUrl` / `loader` reads these guards use.
  const body = src.replace(/^!!js\s*/, "")
  try {
    const fn = new Function("ctx", "return (" + body + ")")
    return String(fn({ baseUrl: "file://" + process.cwd() + "/", loader: { entries: () => [] } }))
  } catch (error) {
    return "THREW: " + String(error && error.message ? error.message : error)
  }
}

for (const file of process.argv.slice(2)) {
  const doc = YAML.parse(readFileSync(file, "utf8"))
  const rows = []
  collect(doc, rows)
  console.log("### " + file + " -> six-row rows found: " + rows.length)
  for (const row of rows) console.log("  " + row.id + " disabled=" + evalGuard(row))
}
