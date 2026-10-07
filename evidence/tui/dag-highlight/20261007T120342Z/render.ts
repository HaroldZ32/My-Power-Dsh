// Recon only: render the DAG drawing for a fixture board, current tree.
import { layoutBoxesNatural, layoutList, layoutRail, legendLines } from "../../../../packages/mpd-tui-plugin/src/graph.ts"
const board = JSON.parse(await Bun.file(process.argv[2]).text()) as { tasks: Array<Record<string, unknown>> }
const tasks = board.tasks.map((t) => ({
  id: String(t.id),
  subject: String(t.subject ?? ""),
  kind: typeof t.kind === "string" ? t.kind : undefined,
  visual: t.status === "completed" ? "completed" : (Array.isArray(t.blockedBy) && t.blockedBy.length > 0 ? "blocked" : "open"),
  dependencies: (Array.isArray(t.blockedBy) ? t.blockedBy : []).map(String),
  failedDependencies: [],
}))
const focus = process.argv[3] === "-" ? undefined : process.argv[3]
const rows = Number(process.argv[4] ?? 40)
const view = layoutBoxesNatural(tasks, focus, { rows })
if (view === undefined) { console.log("(boxes refused)"); process.exit(0) }
console.log(`mode=${view.mode} boxRows=${view.boxRows} width=${view.width} chain=${view.chain.join(",")}`)
for (const line of view.lines) console.log(line.map((s) => s.text).join("").replace(/\s+$/, ""))
console.log("--- legend ---")
for (const l of legendLines(view.width)) console.log(l)
