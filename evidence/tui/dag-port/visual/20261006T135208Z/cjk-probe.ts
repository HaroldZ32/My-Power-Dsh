// Precise measurement of the CJK content rows: the cell-width bug must be stated in exact columns.
import { layoutGraph, type GraphTask } from "../../../../../packages/mpd-tui-plugin/src/graph.ts"
import { cellWidth } from "../../../../../packages/mpd-tui-plugin/src/sanitize.ts"

/** The CJK fixture, identical to the one the baseline render used. */
const cjk: GraphTask[] = [
  { id: "T1", subject: "冻结验收契约", visual: "completed", depth: 0, dependencies: [], kind: "work" },
  { id: "T2", subject: "移植布局几何", visual: "running", depth: 1, dependencies: ["T1"], kind: "work" },
  { id: "T3", subject: "真机 PTY 验证", visual: "blocked", depth: 2, dependencies: ["T2"], kind: "work" },
]

/** An ASCII control, same shape, so the two can be compared row for row. */
const ascii: GraphTask[] = [
  { id: "T1", subject: "Freeze the acceptance contract", visual: "completed", depth: 0, dependencies: [], kind: "work" },
  { id: "T2", subject: "Port the layout", visual: "running", depth: 1, dependencies: ["T1"], kind: "work" },
  { id: "T3", subject: "Verify on a real PTY", visual: "blocked", depth: 2, dependencies: ["T2"], kind: "work" },
]

for (const cols of [120, 48]) {
  for (const [label, tasks] of [["CJK", cjk], ["ASCII", ascii]] as const) {
    console.log("")
    console.log(`### ${label} @ ${cols} cols`)
    const view = layoutGraph(tasks as GraphTask[], cols)
    view.lines.forEach((spans, row) => {
      const text = spans.map((s) => s.text).join("")
      // CHAR CLOSED: only the box CONTENT rows (they start with │ and are not borders).
      if (!text.startsWith("│")) return
      const cps = [...text]
      const last = cps[cps.length - 1]
      console.log(`row ${row}: codepoints=${cps.length} cellWidth=${cellWidth(text)} startsWith│=${text.startsWith("│")} endsWith│=${last === "│"} lastChar=${JSON.stringify(last)}`)
      // Show the codepoint table around the subject, so a padding space is visible as U+0020.
      console.log(`   codePoints: ${cps.map((c) => c.codePointAt(0)!.toString(16).padStart(4, "0")).join(" ")}`)
      // The runs: how many U+0020 follow a wide character, which is the suspected padding.
      const wide = cps.filter((c) => cellWidth(c) === 2).length
      const spaces = cps.filter((c) => c === " ").length
      console.log(`   wideChars=${wide} spaces=${spaces} (a pure pad would be ${wide} spaces interleaved)`)
    })
  }
}
