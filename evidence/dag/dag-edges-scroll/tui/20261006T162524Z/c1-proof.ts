// THE CLAUSE INSTRUMENT (C1/C2/C4/C5 + T1/T3/T7): a PURE-CHINESE board drawn at three viewports, with the
// NEGATIVE CONTROL the requirements demand — the same assertion over a PRE-RULE drawing, which must FAIL.
import * as graph from "../../packages/mpd-tui-plugin/src/graph"
import { cellWidth } from "../../packages/mpd-tui-plugin/src/sanitize"
import { DAG_CHARS } from "../../packages/mpd-tui-plugin/src/dag-theme"

/** The C1 ranges, exactly as `requirements.md` states them, as [lo, hi] pairs. */
const BANNED: ReadonlyArray<readonly [number, number]> = [
  [0x2e80, 0x2fff], [0x3000, 0x303f], [0x3040, 0x9fff], [0xac00, 0xd7af], [0xf900, 0xfaff], [0xfe30, 0xfe4f], [0xff00, 0xffef],
]
/** True when a codepoint sits in a range clause C1 bans. */
function isBanned(code: number): boolean {
  return BANNED.some(([lo, hi]) => code >= lo && code <= hi)
}
/** The banned codepoints found anywhere in a set of drawn rows, one entry per hit. */
function bannedIn(lines: ReadonlyArray<ReadonlyArray<{ text: string }>>): string[] {
  const hits: string[] = []
  for (const row of lines) {
    for (const span of row) for (const character of span.text) {
      const code = character.codePointAt(0) ?? 0
      if (isBanned(code)) hits.push(`U+${code.toString(16).toUpperCase()} ${JSON.stringify(character)}`)
    }
  }
  return hits
}
/** A board whose subjects are PURE Chinese: no ASCII at all, so every label is the `#<ordinal>` fallback. */
const board = [
  { id: "T1", subject: "冻结验收契约", kind: "requirement", visual: "completed", dependencies: [] as string[], depth: 0 },
  { id: "T2", subject: "建立头部与进度条", kind: "work", visual: "running", dependencies: ["T1"], depth: 1 },
  { id: "T3", subject: "绘制依赖图的连线", kind: "work", visual: "open", dependencies: ["T2"], depth: 2 },
  { id: "T4", subject: "修复被截断的成员路由", kind: "repair", visual: "open", dependencies: ["T3"], depth: 3 },
]

/** One viewport's measurements. */
interface Row {
  /** The viewport this drawing was windowed to. */
  viewport: number
  /** Which layout was drawn. */
  mode: string
  /** The drawing's NATURAL width, which may exceed the viewport (clause T1). */
  naturalWidth: number
  /** How many rows one box carries: the roomy five or the compressed three (clause T7). */
  boxRows: number
  /** Clause C1 hits inside the DRAWING. Empty is the pass. */
  banned: string[]
  /** Every windowed row's cell count: exactly the viewport, for every row (clause T3). */
  windowWidths: number[]
  /** The first box's row count as drawn, read from the layout's own fact rather than a literal. */
  firstBoxRows: number
  /** The drawn rows, windowed — the artefact a reader can look at. */
  rows: string[]
}

/** Every viewport measured. */
const rows: Row[] = []
/** The viewport sizes, from roomy down to the host's own sidebar floor. */
const viewports = [120, 60, 28]
for (const viewport of viewports) {
  // A generous vertical budget first: the roomy form, then the compressed one, so T7's ladder is shown.
  const view = graph.layoutGraphNatural(board, undefined, { rows: 120 })
  const windows = view.lines.map((row) => graph.sliceSpans(row, 0, viewport).map((span) => span.text).join(""))
  rows.push({
    viewport,
    mode: view.mode,
    naturalWidth: view.width,
    boxRows: view.boxRows,
    banned: bannedIn(view.lines),
    windowWidths: windows.map((line) => cellWidth(line)),
    firstBoxRows: view.boxRows,
    rows: windows,
  })
}

// THE COMPRESSED FORM, from the vertical budget alone: one rank per row, so the ladder can be shown.
const tight = graph.layoutGraphNatural(board, undefined, { rows: 8 })
/** The composer's own five steps (clause C4), over the board's subjects. */
const labels = board.map((task, index) => ({ subject: task.subject, ordinal: index + 1, label: graph.graphSafeLabel(task.subject, index + 1) }))
/** The composer over the mixtures C4 names explicitly: runs joined, whitespace collapsed, fallback. */
const mixtures = ["T3 REV #2", "  a  b  ", "冻结验收契约", "修复被截断的成员路由 x", "a中b文c", ""]
  .map((subject, index) => ({ subject, ordinal: index + 1, label: graph.graphSafeLabel(subject, index + 1) }))

// THE SLICER'S POSTCONDITION (clause T3), every offset including past the end, and `cols === 0`.
const slicer: Array<{ cols: number; offset: number; cells: number; text: string }> = []
const sliceRow = [
  { text: "│ ◐ T2 WRK #2  │", tone: "open" as const },
  { text: "中文字", tone: "edge" as const },
]
for (const cols of [0, 1, 5, 12, 40]) {
  for (let offset = 0; offset <= 20; offset += 1) {
    const cut = graph.sliceSpans(sliceRow, offset, cols).map((span) => span.text).join("")
    slicer.push({ cols, offset, cells: cellWidth(cut), text: cut })
  }
}

// THE NEGATIVE CONTROL (C5). The PRE-RULE drawing is reproduced by writing `task.subject` into the
// subject slot, which is exactly what `labelOf` did before clause C4. The assertion above is then run
// over it and MUST find hits, or the instrument is not falsifiable.
const preRuleLines = rows[0].rows.map((line, index) => [{ text: index === 1 ? `│ ✓ T1 REQ ${board[0].subject} │` : line }])
const negativeHits = bannedIn(preRuleLines)

/** The whole report, as the evidence artefact. */
const report = {
  probe: "C1/C2/C4/C5 · a pure-Chinese board through the TUI drawing, at three viewports",
  composer: { mixtures: labels.concat(mixtures) },
  viewports: rows,
  tightBudget: { rows: 8, boxRows: tight.boxRows, mode: tight.mode, naturalWidth: tight.width },
  slicer: { rows: slicer, allExact: slicer.every((entry) => entry.cells === entry.cols) },
  negativeControl: { banned: negativeHits, falsifiable: negativeHits.length > 0 },
  glyphs: { arrowDown: DAG_CHARS.arrowDown, corners: [DAG_CHARS.cornerDownRight, DAG_CHARS.cornerDownLeft, DAG_CHARS.cornerUpRight, DAG_CHARS.cornerUpLeft] },
}
console.log(JSON.stringify(report, null, 2))
