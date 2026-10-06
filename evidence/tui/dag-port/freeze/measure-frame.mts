// Cell-accurate border measurement, written AFTER a code-point slice produced a phantom defect.
// A code-point slice drifts LEFT by one cell per wide glyph, so a sidebar containing CJK anywhere in
// the same terminal row measures its own borders at the wrong offset. This measures in CELLS.
import { readFileSync } from "node:fs"
import { cellWidth } from "../../../../packages/mpd-tui-plugin/src/sanitize.ts"

/**
 * Report every line's cell width and the cell offsets of its `│` characters.
 * @param label - the artefact being measured.
 * @param path - the captured pane file.
 */
const measure = (label: string, path: string): void => {
  const lines = readFileSync(path, "utf8").split("\n")
  console.log("=== " + label + " ===")
  console.log("line | cells | │ cell offsets")
  for (const [i, line] of lines.entries()) {
    if (line.trim() === "") continue
    /** Every `│` on this row, at its true CELL offset. */
    const pipes: number[] = []
    let c = 0
    for (const ch of line) {
      if (ch === "│") pipes.push(c)
      c += cellWidth(ch)
    }
    if (pipes.length === 0) continue
    console.log(String(i + 1).padStart(4) + " | " + String(c).padStart(5) + " | " + JSON.stringify(pipes))
  }
}

measure("INTERIM 368005 tab1 (MPD DAG)", "evidence/tui/dag-port/verification/pty/interim-368005/w120/tab1.pane.txt")
