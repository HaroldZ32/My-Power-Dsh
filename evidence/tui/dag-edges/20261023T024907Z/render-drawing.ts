// EVIDENCE RENDERER for the frozen contract `.mpd/plans/dag-edges-contract.md` (clauses A1–A4).
//
// Prints the ACTUAL drawing `dagPanelLayout` chooses for the 5-task team record
// (`.mpd/team/teams/team-20261022071732867-z811-004.json`) under the served ranks a plan-ordinal host
// sends, the same drawing cut to a 40-cell window, and one 12-task board carrying GAP-2 edges.
//
// RUN (from the repository root):  bun evidence/tui/dag-edges/20261023T024907Z/render-drawing.ts
// It reads the plugin's SOURCE (not `dist/`), so the output is the drawing the source produces.
import { dagFooterText, dagPanelLayout, type DagPanelTask } from "../../../../packages/mpd-tui-plugin/src/panel-dag"

/** The 5-task team record, verbatim (id, kind, visual, blockedBy), with the optional fields defaulted. */
const RECORD: DagPanelTask[] = [
  { id: "T1", subject: "Requirement: team-plane settlement contract (frozen)", kind: "work", visual: "completed", dependencies: [], failedDependencies: [], depth: 0 },
  { id: "T2", subject: "R1-R3: team-scoped dispatch, member settlement, task release reset", kind: "work", visual: "completed", dependencies: ["T1"], failedDependencies: [], depth: 0 },
  { id: "T3", subject: "R4: F-6 stale docs (design + feature-audit, EN/zh)", kind: "work", visual: "completed", dependencies: ["T1"], failedDependencies: [], depth: 0 },
  { id: "T4", subject: "Integration: rebuild dist, run gates, live settlement observation", kind: "work", visual: "completed", dependencies: ["T2", "T3"], failedDependencies: [], depth: 0 },
  { id: "T5", subject: "Independent verdict on the settlement fix", kind: "review", visual: "completed", dependencies: ["T4"], failedDependencies: [], depth: 0 },
]

/** The ranks a plan-ordinal host serves for that record: holes at 1, 3 and 5. */
const SERVED = new Map([["T1", 0], ["T2", 2], ["T3", 2], ["T4", 4], ["T5", 6]])

/** The panel content width the record is rendered at (a sidebar interior). */
const COLS = 40

/** One panel task with the fields the drawing reads. */
function task(id: string, dependencies: readonly string[]): DagPanelTask {
  return { id, subject: id, kind: "work", visual: "open", dependencies, failedDependencies: [], depth: 0 }
}

/** The 12-task board the rank arms use: `T7`/`T9` sit two ranks above `T10`. */
const DERIVED: DagPanelTask[] = [
  task("T1", []), task("T2", []), task("T3", []), task("T4", []), task("T5", []),
  task("T6", ["T2"]),
  task("T7", ["T2", "T3", "T4", "T6"]),
  task("T8", ["T7"]),
  task("T9", ["T2", "T3", "T4", "T5", "T6"]),
  task("T10", ["T7", "T8", "T9"]),
]

/** The record's layout at a 40-cell sidebar, under the served ranks. */
const layout = dagPanelLayout(RECORD, COLS, undefined, 30, SERVED)
process.stdout.write("# the 5-task team record, SERVED ranks {T1:0,T2:2,T3:2,T4:4,T5:6} (holes at 1,3,5)\n")
process.stdout.write(`# panel content width: ${COLS}   mode: ${layout.mode}   drawing width: ${layout.view.width}   rows: ${layout.view.lines.length}\n`)
process.stdout.write(`# footer facts: ${dagFooterText({ vertical: { offset: 0, max: Math.max(0, layout.view.lines.length - 1) }, horizontal: { offset: 0, max: Math.max(0, layout.view.width - COLS) } })}\n\n`)
layout.view.lines.forEach((row, index) => process.stdout.write(`${String(index).padStart(2, "0")}|${row.map((span) => span.text).join("")}|\n`))
process.stdout.write("\n# box rows (a task's own rectangle, read off the drawing's hits):\n")
for (const hit of layout.view.hits) process.stdout.write(`#   ${hit.taskId}: rows ${hit.row}..${hit.rowEnd}, cols ${hit.col}..${hit.colEnd}\n`)
process.stdout.write("\n# the SAME drawing through a 40-cell window (the page cuts every row with sliceSpans):\n")
for (const row of layout.view.lines) process.stdout.write(`#   |${row.map((span) => span.text).join("").slice(0, COLS)}\n`)
process.stdout.write("\n# one wide board with GAP-2 edges (T7/T9 -> T10, with T8 sitting between them):\n")
/** The wide board's layout at its natural width. */
const wide = dagPanelLayout(DERIVED, 200)
process.stdout.write(`# mode: ${wide.mode}   drawing width: ${wide.view.width}   rows: ${wide.view.lines.length}\n`)
wide.view.lines.forEach((row, index) => process.stdout.write(`${String(index).padStart(2, "0")}|${row.map((span) => span.text).join("")}|\n`))
process.stdout.write(`\n# ranks of the wide board, read off the hits: ${wide.view.hits.map((hit) => `${hit.taskId}@${hit.row}`).join(" ")}\n`)
