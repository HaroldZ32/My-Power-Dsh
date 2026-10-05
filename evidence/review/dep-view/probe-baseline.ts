// Reviewer's BASELINE control: the same structural measurements the current probe takes, run against
// the HEAD copy of graph.ts materialized under evidence/review/dep-view/baseline/ (read-only `git
// show`, copied with its one relative dependency). Purpose: classify each current finding as
// PRE-EXISTING or a REGRESSION introduced by the wave — a property that never held cannot be a
// regression, and a property that held at HEAD but not now is one.
import { layoutGraph, layoutBoxes, hitTest, type GraphTask } from "./baseline/graph"
import { cellWidth } from "./baseline/sanitize"

/** One task with sane defaults, mirroring the lane's fixture helper. */
function task(id: string, depth: number, dependencies: string[] = [], extra: Partial<GraphTask> = {}): GraphTask {
  return { id, subject: "subject of " + id, kind: "work", visual: "open", dependencies, depth, ...extra }
}

/** The visible text of one row. */
function text(view: { lines: readonly { readonly text: string }[][] }): string[] {
  return view.lines.map((row) => row.map((span) => span.text).join(""))
}

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

console.log("HEAD baseline (git show HEAD:packages/mpd-tui-plugin/src/graph.ts) — same measurements")
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

/** The first row whose spans repeat a tone, with the offsets, so a failure is locatable. */
for (const cols of [24, 40]) {
  const view = layoutGraph(BOARD, cols)
  view.lines.forEach((row, index) => {
    row.forEach((span, i) => {
      if (i > 0 && span.tone === row[i - 1].tone) {
        console.log(`  repeated tone at cols=${cols} row=${index} spanIndex=${i} tone=${span.tone} ` +
          `prev="${row[i - 1].text}" cur="${span.text}"`)
      }
    })
  })
}

/** The trailing-blank rows, so the offending layout row is named rather than inferred. */
for (const cols of [24, 40]) {
  const view = layoutGraph(BOARD, cols)
  text(view).forEach((row, index) => {
    if (row.length > 0 && row.endsWith(" ")) console.log(`  trailing blank at cols=${cols} row=${index} "${row}" (len=${row.length})`)
  })
}

console.log("baseline box geometry: one edge")
const one = layoutBoxes([task("P", 0), task("C", 1, ["P"])], 60)
if (one === undefined) throw new Error("baseline boxes did not fit")
console.log(text(one).map((r, i) => String(i).padStart(2) + "|" + r + "|").join("\n"))
const hitCount = one.hits.length
let mismatches = 0
for (const hit of one.hits) for (let row = hit.row; row <= hit.rowEnd; row++) if (hitTest(one, row, hit.col + 1) !== hit.taskId) mismatches++
console.log(`baseline hits=${hitCount} hitTest mismatches=${mismatches}`)
