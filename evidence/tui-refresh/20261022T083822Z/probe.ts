// Black-box probe for the `tui-refresh` wave: it reads the PACKAGE's own exports (never a test's
// internals) and prints the facts the contract's acceptance list names, so the report can quote a
// measurement rather than restate a claim. Run with the pinned toolchain from the REPO ROOT:
//   .toolchain/node_modules/.bin/bun evidence/tui-refresh/<stamp>/probe.ts
import { cellWidth } from "../../../packages/mpd-tui-plugin/src/sanitize.ts"
import { dagFooterText, dagPanelLayout, DAG_PANEL_REFRESH_MS, DAG_SECTION_DAG_TITLE } from "../../../packages/mpd-tui-plugin/src/panel-dag.ts"
import { PANEL_FRAME_BORDER_ROWS, PANEL_TITLE_ROW_ROWS } from "../../../packages/mpd-tui-plugin/src/panel-core.ts"

/** A three-sibling rank: T1, then T2/T3/T4 all blocked by T1 — the screenshot's lost-node shape. */
const three = [
  { id: "T1", subject: "req", visual: "completed", dependencies: [], failedDependencies: [], depth: 0 },
  { id: "T2", subject: "engine", visual: "running", dependencies: ["T1"], failedDependencies: [], depth: 1 },
  { id: "T3", subject: "surface", visual: "blocked", dependencies: ["T1"], failedDependencies: [], depth: 1 },
  { id: "T4", subject: "review", visual: "open", dependencies: ["T1"], failedDependencies: [], depth: 1 },
]

console.log(`cadence DAG_PANEL_REFRESH_MS=${DAG_PANEL_REFRESH_MS}`)
for (const cols of [26, 36]) {
  const layout = dagPanelLayout(three, cols, undefined, 40)
  const drawn = layout.view.lines.map((row) => row.map((span) => span.text).join("")).join("\n")
  const present = three.map((task) => `${task.id}=${drawn.includes(task.id)}`).join(" ")
  console.log(`cols=${cols} mode=${layout.mode} width=${layout.view.width} rows=${layout.view.lines.length} drawn: ${present}`)
}
console.log(`title section="${DAG_SECTION_DAG_TITLE}"`)
console.log(`height budget: frame=${PANEL_FRAME_BORDER_ROWS} title=${PANEL_TITLE_ROW_ROWS} footer=1 => window=rows-${PANEL_FRAME_BORDER_ROWS + PANEL_TITLE_ROW_ROWS + 1}`)

const footerBoth = dagFooterText({ vertical: { offset: 0, max: 30 }, horizontal: { offset: 0, max: 11 } })
console.log(`footer both windows (first 26 cells): "${footerBoth.slice(0, 26)}" cells=${cellWidth(footerBoth.slice(0, 26))}`)
console.log(`footer no window: "${dagFooterText({})}"`)
