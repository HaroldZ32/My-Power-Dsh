// Isolate the missing right border: does a SHORT CJK subject keep it, and does a LONG ASCII one lose it?
import { layoutGraph, type GraphTask } from "../../../../../packages/mpd-tui-plugin/src/graph.ts"
import { cellWidth } from "../../../../../packages/mpd-tui-plugin/src/sanitize.ts"

/** One task alone in its only rank, so nodeWidth is the view width and nothing else can interfere. */
function solo(subject: string): GraphTask[] {
  return [{ id: "T1", subject, visual: "completed", depth: 0, dependencies: [], kind: "work" }]
}

const cases: Array<[string, string]> = [
  ["ascii-short", "Port it"],
  ["ascii-33", "x".repeat(28)],
  ["ascii-34", "x".repeat(34)],
  ["cjk-1", "冻"],
  ["cjk-3", "冻结验"],
  ["cjk-6", "冻结验收契约"],
  ["cjk-20", "冻".repeat(20)],
]

for (const [name, subject] of cases) {
  const view = layoutGraph(solo(subject), 120)
  const row = view.lines[1] ?? []
  const text = row.map((s) => s.text).join("")
  const cps = [...text]
  const subjectCells = cellWidth(subject)
  console.log(
    `${name.padEnd(12)} subjectCells=${String(subjectCells).padStart(3)} viewWidth=${view.width} ` +
    `contentCodepoints=${String(cps.length).padStart(3)} contentCells=${String(cellWidth(text)).padStart(3)} ` +
    `endsWith│=${cps[cps.length - 1] === "│"} spans=${row.length}`,
  )
  console.log(`   ${JSON.stringify(text)}`)
}
