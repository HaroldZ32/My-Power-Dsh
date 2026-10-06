// THE CJK CELL DEFECT, MEASURED: the removed write loop beside the shipped one.
//
// The defect was a one-slot-per-character write with a two-cell cursor advance, which left the cell a
// wide glyph covers rendering a background space — one cell wider than the grid it was built for, so
// the box's closing `│` was pushed off the row. This script draws the SAME box row both ways, in a
// local reproduction of each loop, and measures codepoints, cells and the closing border.
//
// Run: bun evidence/tui/dag-port/graph-rank/<ts>/cjk.mts
import { layoutBoxes } from "../../../../../packages/mpd-tui-plugin/src/graph.ts"
import { cellWidth, clampCells } from "../../../../../packages/mpd-tui-plugin/src/sanitize.ts"

/** The width the row is drawn at, which is what the reviewer's `cjk @120` case used. */
const COLS = 120
/** The subject under test: seven wide glyphs, each taking two cells. */
const SUBJECT = "冻结验收契约"
/** The board: one box, so the row under test is unambiguous. */
const BOARD = [{ id: "T1", subject: SUBJECT, kind: "work", visual: "open", dependencies: [], depth: 0 }]

/** The shipped drawing of that board. */
const view = layoutBoxes(BOARD, COLS)
if (view === undefined) throw new Error("the box did not fit at " + COLS)
/** The box's own rectangle. */
const box = view.hits[0]
/** The body row, which is the row the wide glyphs sit on. */
const body = view.lines[box.row + 1].map((span) => span.text).join("")

/** One row of the OLD canvas: `-` is untouched, a string is a label character, a wide glyph spans two cells. */
const OLD_WIDTH = box.colEnd - box.col + 1
/** The old cell array, one SLOT per array index, exactly as the removed code built it. */
const oldSlots: Array<string | null> = new Array<string | null>(OLD_WIDTH).fill(null)
/** The old label text, prefixed the way the old code prefixed it. */
const oldLabel = " ✓ T1 WRK " + SUBJECT
/** The old cursor: ONE array slot per character while advancing cellWidth — the defect itself. */
let slot = 1
for (const char of oldLabel) {
  if (slot >= OLD_WIDTH - 1) break
  oldSlots[slot] = char
  slot += cellWidth(char)
}
for (let at = 0; at < OLD_WIDTH; at += 1) if (oldSlots[at] === null) oldSlots[at] = " "
/** The old row, borders included: the left border, the interior, the right border. */
const oldRow = "│" + oldSlots.slice(1, OLD_WIDTH - 1).join("") + "│"

console.log("subject          : " + SUBJECT + " (codepoints " + [...SUBJECT].length + ", cells " + cellWidth(SUBJECT) + ")")
console.log("BEFORE raw       codepoints=" + oldRow.length + " cellWidth=" + cellWidth(oldRow) + " (the grid is " + OLD_WIDTH + " cells, so the row IS " + (cellWidth(oldRow) - OLD_WIDTH) + " cells too wide)")
// THE CLAMP IS WHERE THE BORDER IS LOST: the renderer clamped the row to the grid's own cells, so the
// characters that fell past that budget were cut — and the last one is the box's closing border.
console.log("BEFORE clamped   codepoints=" + clampCells(oldRow, OLD_WIDTH).length + " cellWidth=" + cellWidth(clampCells(oldRow, OLD_WIDTH)) + " endsWith│=" + clampCells(oldRow, OLD_WIDTH).endsWith("│"))
console.log("AFTER  clamped   codepoints=" + clampCells(body, view.width).length + " cellWidth=" + cellWidth(clampCells(body, view.width)) + " endsWith│=" + clampCells(body, view.width).endsWith("│"))
console.log("box right border column = " + box.colEnd + "; AFTER row cells = " + cellWidth(body) + " (equal means the row ends ON its border)")
