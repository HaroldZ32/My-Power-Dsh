// Visual-reviewer harness: render the EXISTING TUI DAG ancestor (`graph.ts`) to a real cell grid.
//
// WHAT THIS IS FOR. The wave ports the WEB dependency DAG to the MPD TUI. `graph.ts` is that port's
// DIRECT ANCESTOR (its `layoutGraph` -> the ported `layoutDag`), so rendering it establishes the
// FIDELITY FLOOR the port must not regress, and it lets the visual reviewer reason about the CELL
// GRID (columns, border alignment, arrowheads, CJK widths) without a PTY.
//
// WHAT IT IS NOT. This is NOT the port. `src/dag-layout.ts` does not exist yet. Every number below
// describes the ancestor, clearly labelled as such.
import { layoutGraph, legendLines, type GraphTask } from "../../../../../packages/mpd-tui-plugin/src/graph.ts"

/** One fixture: a named board plus the content note a reviewer needs to read the render. */
interface Fixture {
  name: string
  note: string
  tasks: GraphTask[]
}

/** Build a task, with the two fields no fixture ever varies defaulted. */
function t(id: string, subject: string, visual: string, depth: number, dependencies: string[], kind = "work"): GraphTask {
  return { id, subject, visual, depth, dependencies, kind }
}

const FIXTURES: Fixture[] = [
  {
    name: "chain",
    note: "A single chain T1 -> T2 -> T3: three ranks, one box each.",
    tasks: [
      t("T1", "Freeze the acceptance contract", "completed", 0, []),
      t("T2", "Port the layout", "running", 1, ["T1"]),
      t("T3", "Verify on a real PTY", "blocked", 2, ["T2"]),
    ],
  },
  {
    name: "fanin",
    note: "A fan-in: T3 rests on TWO blockers (T1, T2); T4 then fans in from T3 and T1.",
    tasks: [
      t("T1", "Freeze the theme table", "completed", 0, [], "requirement"),
      t("T2", "Port the geometry", "completed", 0, [], "work"),
      t("T3", "Join the two halves", "running", 1, ["T1", "T2"], "integration"),
      t("T4", "Verify fidelity", "open", 2, ["T3", "T1"], "review"),
    ],
  },
  {
    name: "six-states",
    note: "One task per state, so six distinct marks are on one board at the same rank.",
    tasks: [
      t("T1", "Completed task", "completed", 0, []),
      t("T2", "Running task", "running", 0, []),
      t("T3", "Failed task", "failed", 0, []),
      t("T4", "Blocked task", "blocked", 0, []),
      t("T5", "Cancelled task", "cancelled", 0, []),
      t("T6", "Open task", "open", 0, []),
    ],
  },
  {
    name: "cjk",
    note: "CJK subjects and ids, the fixture that reddens on a cell-width bug.",
    tasks: [
      t("T1", "冻结验收契约", "completed", 0, []),
      t("T2", "移植布局几何", "running", 1, ["T1"]),
      t("T3", "真机 PTY 验证", "blocked", 2, ["T2"]),
    ],
  },
  {
    name: "cycle",
    note: "A dependency cycle: T1 blockedBy T2 and T2 blockedBy T1.",
    tasks: [
      t("T1", "Cycle half A", "blocked", 0, ["T2"]),
      t("T2", "Cycle half B", "blocked", 0, ["T1"]),
    ],
  },
]

const WIDTHS = [120, 80, 48, 32]

/** Flatten one view's rows to plain text, which is what a terminal would actually show. */
function flatten(lines: Array<Array<{ text: string }>>): string[] {
  return lines.map((spans) => spans.map((s) => s.text).join(""))
}

/** A ruler so a reader can count the exact column a border lands on. */
function ruler(width: number): string {
  let tens = ""
  let ones = ""
  for (let i = 0; i < width; i += 1) {
    tens += i % 10 === 0 ? String(Math.floor(i / 10) % 10) : " "
    ones += String(i % 10)
  }
  return tens + "\n" + ones
}

/** The right-most column each box's border was actually drawn in, read from the drawn text. */
function borderColumns(rows: string[]): number[] {
  const cols: number[] = []
  for (const row of rows) {
    for (let i = row.length - 1; i >= 0; i -= 1) {
      const ch = row[i]
      if (ch === "┐" || ch === "┘" || ch === "┤" || ch === "│" || ch === "┌" || ch === "└") {
        cols.push(i)
        break
      }
    }
  }
  return cols
}

const report: string[] = []
const say = (line: string): void => { report.push(line) }

for (const fixture of FIXTURES) {
  say("")
  say("=".repeat(78))
  say(`FIXTURE ${fixture.name} — ${fixture.note}`)
  say("=".repeat(78))
  for (const cols of WIDTHS) {
    const view = layoutGraph(fixture.tasks, cols)
    say("")
    say(`-- ${fixture.name} @ ${cols} cols -> mode=${view.mode} width=${view.width} lines=${view.lines.length} cycles=[${view.cycles.join(",")}] hits=${view.hits.length}`)
    const rows = flatten(view.lines)
    // The ruler is 3 chars wide ("NN "), the same gutter the drawing itself uses.
    const gutter = "   "
    say(gutter + ruler(cols))
    rows.forEach((row, index) => {
      say(String(index).padStart(2, " ") + " " + row)
    })
    const legend = legendLines(cols)
    if (legend.length > 0) {
      say(`${gutter}LEGEND (${legend.length} line(s)):`)
      for (const line of legend) say(gutter + line)
    } else {
      say(`${gutter}LEGEND: DROPPED (cols < MIN_LEGEND_COLS)`)
    }
    // ARROWHEAD COUNT: the ▼ entry marker R4 must preserve.
    const arrows = rows.reduce((n, row) => n + (row.split("▼").length - 1), 0)
    say(`${gutter}ARROWHEAD ▼ count = ${arrows}`)
    // BORDER ALIGNMENT: the drawn right-border columns of the box rows.
    const borders = borderColumns(rows)
    say(`${gutter}box right-border columns = [${borders.join(", ")}]  distinct=${new Set(borders).size}`)
    // HIT RECTANGLES: the authoritative geometry the layout believes it drew.
    for (const hit of view.hits) {
      say(`${gutter}hit ${hit.taskId}: rows ${hit.row}..${hit.rowEnd} cols ${hit.col}..${hit.colEnd} (w=${hit.colEnd - hit.col + 1})`)
    }
    // WIDTH INVARIANT: no drawn row may exceed the viewport it was given.
    const over = rows.filter((row) => row.length > cols).length
    say(`${gutter}rows exceeding ${cols} cols = ${over}`)
  }
}

const text = report.join("\n")
console.log(text)
await Bun.write(new URL("./baseline-render.txt", import.meta.url), text + "\n")
