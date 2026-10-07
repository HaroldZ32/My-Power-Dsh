// THE PAN INSTRUMENT (T1/T2/T3/T4): a wide board, drawn at natural width and WINDOWED, at several column
// offsets — the drawing is the same picture, the window moves, and the rail is read from the same offset.
import * as graph from "../../packages/mpd-tui-plugin/src/graph"
import { cellWidth } from "../../packages/mpd-tui-plugin/src/sanitize"
import { gutterCellsX } from "../../packages/mpd-tui-plugin/src/panel-core"

/** A WIDE board: four blockers in one rank, so the natural drawing is far wider than a sidebar. */
const board = [
  { id: "W1", subject: "port the WEB dependency DAG into the TUI surfaces", kind: "work", visual: "completed", dependencies: [] as string[], depth: 0 },
  { id: "W2", subject: "render the curved edge layer without a measuring pass", kind: "work", visual: "running", dependencies: [] as string[], depth: 0 },
  { id: "W3", subject: "keep the graph-safe label rule on every surface", kind: "requirement", visual: "open", dependencies: [] as string[], depth: 0 },
  { id: "W4", subject: "prove the tip touches the border by arithmetic", kind: "review", visual: "open", dependencies: ["W1", "W2", "W3"], depth: 1 },
]
/** The drawing at its natural width. */
const view = graph.layoutGraphNatural(board, undefined, { rows: 120 })
/** The viewport a sidebar has. */
const viewport = 34
/** The furthest offset the band allows. */
const max = Math.max(0, view.width - viewport)

/** One offset's measurement. */
interface At {
  /** The column offset. */
  offset: number
  /** Every windowed row's cell count; each must equal the viewport (clause T3). */
  widths: number[]
  /** The horizontal rail, drawn from the SAME offset (clause T4). */
  rail: string
  /** The drawing's first three windowed rows, so a reader can see the window move. */
  rows: string[]
}

/** Every offset measured: the top, one step in, and the far end. */
const at: At[] = [0, 4, max].map((offset) => ({
  offset,
  widths: view.lines.map((row) => cellWidth(graph.sliceSpans(row, offset, viewport).map((span) => span.text).join(""))),
  rail: gutterCellsX(offset, view.width, viewport),
  rows: view.lines.slice(0, 3).map((row) => graph.sliceSpans(row, offset, viewport).map((span) => span.text).join("")),
}))

console.log(JSON.stringify({
  probe: "T1/T2/T3/T4 · a wide board at natural width, windowed and panned",
  naturalWidth: view.width,
  viewport,
  maxOffset: max,
  boxRows: view.boxRows,
  exactWindows: at.every((entry) => entry.widths.every((width) => width === viewport)),
  railLengths: at.map((entry) => cellWidth(entry.rail)),
  offsets: at,
}, null, 2))
