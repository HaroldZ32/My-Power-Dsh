// EVIDENCE RENDERER for the REPAIR PASS of the frozen contract `.mpd/plans/dag-edges-contract.md`.
//
// Prints the ACTUAL drawing `dagPanelLayout` chooses for the 5-task team record's tasks under an
// AUTHORED served-rank fixture, the SAME drawing through a genuinely narrow 12-cell crop at BOTH ends
// of its pan (the block that used to be a no-op 40-cell window on a 23-cell drawing), and — because a
// 12-cell content width is BELOW the two-column floor and would draw the rail — a SECOND pan block at
// the narrowest LEGAL boxed panel (23 cells, `2 * 10 + 3`) over the 62-cell board.
//
// THE RANK MAP IS A FIXTURE, NOT A RECORD FIELD. The team record carries no `rank`/`depth` field; the
// served map below is authored here. Deviation D2 in the wave's `result.json` records why the 0/2/4/6
// ladder (and not the contract's literal 0/2/4) is what keeps every link drawable.
//
// RUN (from the repository root):  bun evidence/tui/dag-edges/20261023T031930Z-repair/render-drawing.ts
// It reads the plugin's SOURCE (not `dist/`), so the output is the drawing the source produces.
import { dagFooterText, dagPanelLayout, type DagPanelTask } from "../../../../packages/mpd-tui-plugin/src/panel-dag"
import { sliceSpans, type GraphSpan } from "../../../../packages/mpd-tui-plugin/src/graph"
import { cellWidth } from "../../../../packages/mpd-tui-plugin/src/sanitize"

/** The 5-task team record's tasks: id/kind/blockedBy verbatim, `visual` mapped from each task's status. */
const RECORD: DagPanelTask[] = [
  { id: "T1", subject: "Requirement: team-plane settlement contract (frozen)", kind: "work", visual: "completed", dependencies: [], failedDependencies: [], depth: 0 },
  { id: "T2", subject: "R1-R3: team-scoped dispatch, member settlement, task release reset", kind: "work", visual: "completed", dependencies: ["T1"], failedDependencies: [], depth: 0 },
  { id: "T3", subject: "R4: F-6 stale docs (design + feature-audit, EN/zh)", kind: "work", visual: "completed", dependencies: ["T1"], failedDependencies: [], depth: 0 },
  { id: "T4", subject: "Integration: rebuild dist, run gates, live settlement observation", kind: "work", visual: "completed", dependencies: ["T2", "T3"], failedDependencies: [], depth: 0 },
  { id: "T5", subject: "Independent verdict on the settlement fix", kind: "review", visual: "completed", dependencies: ["T4"], failedDependencies: [], depth: 0 },
]

/** The AUTHORED rank fixture: a plan-ordinal ladder with holes at 1, 3 and 5 (see D2). */
const SERVED = new Map([["T1", 0], ["T2", 2], ["T3", 2], ["T4", 4], ["T5", 6]])

/** The panel content width the record is rendered at (a sidebar interior). */
const COLS = 40

/** The crop width this pass uses to prove the window really cuts the drawing (the old block was a no-op). */
const CROP_COLS = 12

/** The narrowest content width at which the page still elects boxes for a ten-cell node column. */
const FLOOR_COLS = 23

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

/** The plain text of one drawing row. */
function textOf(row: readonly GraphSpan[]): string {
  return row.map((span) => span.text).join("")
}

/** The record's layout at the 40-cell sidebar, under the authored served ranks. */
const layout = dagPanelLayout(RECORD, COLS, undefined, 30, SERVED)
process.stdout.write("# the 5-task team record's TASKS (id/kind/blockedBy verbatim) under an AUTHORED served-rank\n")
process.stdout.write("# fixture {T1:0,T2:2,T3:2,T4:4,T5:6} (holes at 1,3,5). The record carries NO rank field; D2\n")
process.stdout.write("# in the wave's result.json records why this ladder keeps every link drawable.\n")
process.stdout.write(`# panel content width: ${COLS}   mode: ${layout.mode}   drawing width: ${layout.view.width}   rows: ${layout.view.lines.length}\n`)
process.stdout.write(`# footer facts: ${dagFooterText({ vertical: { offset: 0, max: Math.max(0, layout.view.lines.length - 1) }, horizontal: { offset: 0, max: Math.max(0, layout.view.width - COLS) } })}\n\n`)
layout.view.lines.forEach((row, index) => process.stdout.write(`${String(index).padStart(2, "0")}|${textOf(row)}|\n`))
process.stdout.write("\n# box rows (a task's own rectangle, read off the drawing's hits):\n")
for (const hit of layout.view.hits) process.stdout.write(`#   ${hit.taskId}: rows ${hit.row}..${hit.rowEnd}, cols ${hit.col}..${hit.colEnd}\n`)

// THE 12-CELL CROP replaces the old 40-cell "window", which was a no-op on a 23-cell drawing. It starts
// at BOTH ends of the pan, and every row is the page's own `sliceSpans` cut, measured to be exactly 12
// cells. HONEST BOUND: 12 content cells is below the two-column floor (23), so `dagPanelLayout` would
// choose the rail there — this block proves the CROP/pan arithmetic, not a legal boxed panel; the next
// block is the legal one.
process.stdout.write(`\n# ── a genuinely narrow ${CROP_COLS}-cell crop of the SAME drawing, at both ends of its pan ──\n`)
process.stdout.write(`# the page cuts every row with sliceSpans(row, colOffset, ${CROP_COLS}); the pan range is 0..${layout.view.width - CROP_COLS}.\n`)
for (const offset of [0, layout.view.width - CROP_COLS]) {
  /** The cropped rows at this offset. */
  const cropped = layout.view.lines.map((row) => sliceSpans(row, offset, CROP_COLS))
  /** The measured cell width of each cropped row, so the exact-width claim is checked, not assumed. */
  const widths = cropped.map((row) => cellWidth(textOf(row)))
  process.stdout.write(`# footer facts at offset ${offset}: ${dagFooterText({ horizontal: { offset, max: layout.view.width - CROP_COLS } })}\n`)
  process.stdout.write(`# measured crop widths: min=${Math.min(...widths)} max=${Math.max(...widths)} (all rows, ${CROP_COLS} requested)\n`)
  cropped.forEach((row, index) => process.stdout.write(`#   ${String(index).padStart(2, "0")}|${textOf(row)}|\n`))
}

// THE LEGAL NARROW PANEL: 23 content cells — the `2 * 10 + 3` floor for this board's ten-cell boxes — over
// a drawing 62 cells wide, so this is a state `dagPanelLayout` really produces (`mode: boxes`).
process.stdout.write(`\n# ── the NARROWEST LEGAL boxed panel (${FLOOR_COLS} cells) over a 62-cell drawing: the real pan ──\n`)
/** The wide board's layout at the narrowest panel that still earns boxes. */
const narrow = dagPanelLayout(DERIVED, FLOOR_COLS)
process.stdout.write(`# panel content width: ${FLOOR_COLS}   mode: ${narrow.mode}   drawing width: ${narrow.view.width}   rows: ${narrow.view.lines.length}\n`)
process.stdout.write(`# the window pans ${narrow.view.width} cells of drawing through ${FLOOR_COLS} cells of panel.\n`)
for (const offset of [0, narrow.view.width - FLOOR_COLS]) {
  /** The cropped rows at this offset. */
  const cropped = narrow.view.lines.map((row) => sliceSpans(row, offset, FLOOR_COLS))
  /** The measured cell width of each cropped row. */
  const widths = cropped.map((row) => cellWidth(textOf(row)))
  process.stdout.write(`# footer facts at offset ${offset}: ${dagFooterText({ vertical: { offset: 0, max: Math.max(0, narrow.view.lines.length - 1) }, horizontal: { offset, max: narrow.view.width - FLOOR_COLS } })}\n`)
  process.stdout.write(`# measured window widths: min=${Math.min(...widths)} max=${Math.max(...widths)} (${FLOOR_COLS} requested)\n`)
  cropped.forEach((row, index) => process.stdout.write(`#   ${String(index).padStart(2, "0")}|${textOf(row)}|\n`))
}

process.stdout.write("\n# one wide board with GAP-2 edges (T7/T9 -> T10, with T8 sitting between them):\n")
/** The wide board's layout at its natural width. */
const wide = dagPanelLayout(DERIVED, 200)
process.stdout.write(`# mode: ${wide.mode}   drawing width: ${wide.view.width}   rows: ${wide.view.lines.length}\n`)
wide.view.lines.forEach((row, index) => process.stdout.write(`${String(index).padStart(2, "0")}|${textOf(row)}|\n`))
process.stdout.write(`\n# ranks of the wide board, read off the hits: ${wide.view.hits.map((hit) => `${hit.taskId}@${hit.row}`).join(" ")}\n`)
