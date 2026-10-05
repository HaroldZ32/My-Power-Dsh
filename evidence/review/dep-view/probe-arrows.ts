// Reviewer's independent render probe (T5, evidence/review/** scope; reads lane code, writes nothing
// outside this directory). It re-derives the arrow-drawing assertions from the REAL render output
// instead of trusting the lane's own test file, and it measures the legend against the drawing that
// is actually on screen.
import { layoutBoxes, layoutGraph, legendLines, hitTest, type GraphTask } from "../../../packages/mpd-tui-plugin/src/graph"
import { cellWidth } from "../../../packages/mpd-tui-plugin/src/sanitize"

/** One task with sane defaults, mirroring the lane's own fixture helper. */
function task(id: string, depth: number, dependencies: string[] = [], extra: Partial<GraphTask> = {}): GraphTask {
  return { id, subject: "subject of " + id, kind: "work", visual: "open", dependencies, depth, ...extra }
}

/** The visible text of one row. */
function text(view: { lines: readonly { readonly text: string }[][] }): string[] {
  return view.lines.map((row) => row.map((span) => span.text).join(""))
}

const line = "======================================================================"

console.log(line + "\nA. ONE EDGE: does the arrowhead exist, where, and what row is it on?\n" + line)
const one = layoutBoxes([task("P", 0), task("C", 1, ["P"])], 60)
if (one === undefined) throw new Error("boxes did not fit at 60 cols")
const oneLines = text(one)
oneLines.forEach((row, i) => console.log(String(i).padStart(2) + "|" + row + "|"))
const parent = one.hits.find((h) => h.taskId === "P")
const child = one.hits.find((h) => h.taskId === "C")
if (parent === undefined || child === undefined) throw new Error("hits missing")
const arrowCols = [...oneLines[child.row - 1]].flatMap((ch, i) => (ch === "▼" ? [i] : []))
console.log(`parent.row=${parent.row} rowEnd=${parent.rowEnd}  child.row=${child.row} rowEnd=${child.rowEnd}`)
console.log(`▼ columns on row child.row-1 = [${arrowCols.join(",")}]  (count=${arrowCols.length})`)
console.log(`row directly above child top border === child.row-1: ${oneLines[child.row - 1].includes("▼")}`)
console.log(`child top border row contains ┴ : ${oneLines[child.row].includes("┴")}`)
console.log(`parent bottom border row contains ┬ : ${oneLines[parent.rowEnd].includes("┬")}`)
console.log(`is the ▼ cell inside ANY hit rectangle (i.e. did the arrow move the click targets)? ` +
  `${one.hits.some((h) => child.row - 1 >= h.row && child.row - 1 <= h.rowEnd && arrowCols.some((c) => c >= h.col && c <= h.colEnd))}`)

console.log("\n" + line + "\nB. FAN-IN: how many arrowheads for two blockers converging on one dependent?\n" + line)
const fanin = layoutBoxes([task("P1", 0), task("P2", 0), task("C", 1, ["P1", "P2"])], 80)
if (fanin === undefined) throw new Error("fan-in did not fit at 80 cols")
const fanText = text(fanin).join("\n")
console.log(text(fanin).map((row, i) => String(i).padStart(2) + "|" + row + "|").join("\n"))
console.log(`total ▼ in the whole drawing = ${(fanText.match(/▼/g) ?? []).length}`)

console.log("\n" + line + "\nC. WIDTH BOUND + span collapse, at the same widths the lane asserts\n" + line)
const BOARD: GraphTask[] = [
  task("T1", 0, [], { kind: "requirement", visual: "completed", assignee: "lead" }),
  task("T2", 0, [], { kind: "requirement", visual: "completed", assignee: "lead" }),
  task("T3", 1, ["T1"], { visual: "running", assignee: "Senior Engineer", attempt: 2 }),
  task("T4", 1, ["T2"], { visual: "open" }),
  task("T5", 1, ["T1"], { visual: "blocked" }),
  task("T6", 2, ["T4"], { visual: "failed", kind: "repair" }),
  task("T7", 2, ["T3"], { visual: "open", kind: "review" }),
  task("T8", 2, ["T3"], { visual: "open", kind: "review" }),
  task("T9", 3, ["T7", "T8"], { visual: "open", kind: "integration" }),
]
for (const cols of [24, 40, 70, 100]) {
  const view = layoutGraph(BOARD, cols)
  const rows = text(view)
  const widest = Math.max(...rows.map((r) => cellWidth(r)))
  const collapsed = view.lines.every((row) => row.every((span, i) => i === 0 || span.tone !== row[i - 1].tone))
  const trailingBlank = rows.some((r) => r.length > 0 && r.endsWith(" "))
  console.log(`cols=${String(cols).padStart(3)} mode=${view.mode.padEnd(5)} rows=${rows.length} widestRow=${widest} ` +
    `<=cols:${widest <= cols} spansCollapsed:${collapsed} trailingBlankCell:${trailingBlank} ` +
    `▼count=${(rows.join("\n").match(/▼/g) ?? []).length} ▸count=${(rows.join("\n").match(/▸/g) ?? []).length}`)
}

console.log("\n" + line + "\nD. LEGEND HONESTY: what the legend claims vs what the drawing shows\n" + line)
for (const cols of [0, 3, 7, 8, 16, 24, 40, 70, 100, 200, Number.NaN]) {
  const legend = legendLines(cols)
  const view = layoutGraph(BOARD, Number.isFinite(cols) ? cols : 8)
  const drawn = text(view).join("\n")
  const over = legend.filter((l) => cellWidth(l) > cols).length
  console.log(`cols=${String(cols).padStart(4)} mode=${(view.mode ?? "?").padEnd(5)} legendLines=${legend.length} ` +
    `linesOverWidth=${over} legendMentions▼=${legend.some((l) => l.includes("▼"))} drawingHas▼=${drawn.includes("▼")} ` +
    `drawingHas▸=${drawn.includes("▸")} legendMentions▸=${legend.some((l) => l.includes("▸"))}`)
}
console.log("\nlegend at 100 cols:")
legendLines(100).forEach((l, i) => console.log(`  [${i}] "${l}"`))
console.log("legend at 24 cols:")
legendLines(24).forEach((l, i) => console.log(`  [${i}] "${l}"`))
console.log("legend at 16 cols:")
legendLines(16).forEach((l, i) => console.log(`  [${i}] "${l}"`))
console.log("legend at 8 cols:")
legendLines(8).forEach((l, i) => console.log(`  [${i}] "${l}"`))

console.log("\n" + line + "\nE. LEGEND GLYPH HONESTY: does every state the legend keys actually appear in the drawing?\n" + line)
const stateBoard: GraphTask[] = [
  task("S1", 0, [], { visual: "completed" }), task("S2", 0, [], { visual: "running" }),
  task("S3", 0, [], { visual: "blocked" }), task("S4", 0, [], { visual: "failed" }),
  task("S5", 0, [], { visual: "cancelled" }),
]
const stateText = text(layoutBoxes(stateBoard, 100) ?? layoutGraph(stateBoard, 100)).join("\n")
for (const glyph of ["✓", "◐", "✗", "○", "⊘", "▶", "▼"]) {
  console.log(`  drawing contains ${glyph}: ${stateText.includes(glyph)}`)
}

console.log("\n" + line + "\nF. POINTER GEOMETRY: does hitTest still cover every box row and nothing else?\n" + line)
const v = layoutBoxes(BOARD, 70)
if (v === undefined) throw new Error("board did not fit at 70 cols")
let mismatches = 0
for (const hit of v.hits) for (let row = hit.row; row <= hit.rowEnd; row++) if (hitTest(v, row, hit.col + 1) !== hit.taskId) mismatches++
console.log(`hit rectangles=${v.hits.length} mismatches over their own rows: ${mismatches}`)
console.log(`hitTest on the row ABOVE a box (an arrow row) returns: ${hitTest(v, (v.hits[0]?.row ?? 1) - 1, (v.hits[0]?.col ?? 0) + 1)}`)
