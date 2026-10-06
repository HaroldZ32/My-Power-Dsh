// Print the RAW spans the boxes layout emits for one CJK row vs one ASCII row.
import { layoutGraph, type GraphTask } from "../../../../../packages/mpd-tui-plugin/src/graph.ts"
import { cellWidth } from "../../../../../packages/mpd-tui-plugin/src/sanitize.ts"

const cjk: GraphTask[] = [
  { id: "T1", subject: "冻结验收契约", visual: "completed", depth: 0, dependencies: [], kind: "work" },
  { id: "T2", subject: "移植布局几何", visual: "running", depth: 1, dependencies: ["T1"], kind: "work" },
]
const ascii: GraphTask[] = [
  { id: "T1", subject: "Freeze the acceptance contract", visual: "completed", depth: 0, dependencies: [], kind: "work" },
  { id: "T2", subject: "Port the layout", visual: "running", depth: 1, dependencies: ["T1"], kind: "work" },
]

for (const [label, tasks] of [["CJK", cjk], ["ASCII", ascii]] as const) {
  const view = layoutGraph(tasks as GraphTask[], 120)
  console.log(`\n### ${label} @120 -> width=${view.width} mode=${view.mode} hits=${JSON.stringify(view.hits)}`)
  for (const rowIndex of [0, 1, 2]) {
    const spans = view.lines[rowIndex] ?? []
    const text = spans.map((s) => s.text).join("")
    console.log(`row ${rowIndex}: spans=${spans.length} codepoints=${[...text].length} cellWidth=${cellWidth(text)} text=${JSON.stringify(text)}`)
    console.log(`   span texts: ${spans.map((s) => JSON.stringify(s.text)).join(" | ")}`)
    console.log(`   span tones: ${spans.map((s) => s.tone).join(" | ")}`)
  }
}
