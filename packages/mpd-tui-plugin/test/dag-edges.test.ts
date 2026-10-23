// THE EDGE-FIDELITY ARMS of the frozen contract `.mpd/plans/dag-edges-contract.md` (2026-10-23).
//
// SEVEN ARMS: the contract's FIVE, each RED on the pre-fix tree and GREEN after it, plus TWO repair
// arms added after the Reviewer's finding (2026-10-23) and named so the close-out can cite them:
//   1. a GAP-2 edge — a blocker and its dependent TWO OR MORE ranks apart — is DRAWN, and the run can
//      be followed cell by cell from the blocker's bottom border to the dependent's `▼`;
//   2. an EMPTY rank bucket consumes NO rows and breaks no edge (served ranks {0,2} and {0,2,4});
//   3. the 5-task team record `team-20261022071732867-z811-004.json` draws EVERY link when its served
//      ranks arrive with holes in them;
//   4. the width policy: a drawing wider than the panel is still `boxes` while two node columns fit,
//      the window pans and the footer names the column, and a genuinely too-narrow panel falls back;
//   5. a PINNED board keeps its off-chain connectors in the visible `edge` tone, never `dim`;
//   5b. a pinned board's off-chain LONG edge still ends in a visible `edge` arrowhead (the LANE path's
//      own terminus, which ARM 5's adjacent-rank fixture never reaches);
//   6. an unresolved blocker id is REPORTED in the page's `unresolved` list and contributes NO drawn
//      run or edge — the silent-filter defect one layer up from the drawing.
//
// WHY A WALK AND NOT A ROW PROBE. The pre-existing arm asserted that SOME row carried a `┬`, which any
// other box's border also satisfies — so the drawing could lose an edge and still pass. Every arm here
// instead decodes each connector glyph's direction mask and WALKS the run: a missing stub, a dropped
// horizontal bus, or a line that stops at an intermediate rank is a failure, not a pass.
//
// THE BOX-GEOMETRY FACTS THESE ARMS READ come from the drawing itself (`hits`), never from a constant:
// a rank's row, a box's centre column and the arrow row (`hit.row - 1`) are all reported by `GraphView`,
// so a future box form cannot make an assertion silently read the wrong row.

import { describe, expect, test } from "bun:test"

import { DAG_CHARS } from "../src/dag-theme"
import { dagFooterText, dagPanelLayout, type DagPanelTask } from "../src/panel-dag"
import { layoutBoxes, layoutBoxesNatural, type GraphHit, type GraphSpan, type GraphTask, type GraphView } from "../src/graph"
import { cellWidth } from "../src/sanitize"

// ── fixtures ────────────────────────────────────────────────────────────────

/** One task with the fields a drawing cares about; every other field keeps its default. */
function task(id: string, dependencies: readonly string[] = [], extra: Partial<GraphTask> = {}): GraphTask {
  return { id, subject: `subject of ${id}`, kind: "work", visual: "open", dependencies, depth: 0, ...extra }
}

/**
 * The board the captain transcribed from the MEASURED broken record (the same fixture the rank arms
 * use): `T7 ← {T2,T3,T4,T6}` at rank 2 and `T10 ← {T7,T8,T9}` at rank 4, so `T7 → T10` and `T9 → T10`
 * span TWO ranks with `T8` (rank 3) between them — the exact shape the drawing used to drop.
 */
const DERIVED_BOARD: GraphTask[] = [
  task("T1", [], { kind: "requirement" }),
  task("T2", [], { kind: "requirement" }),
  task("T3"),
  task("T4"),
  task("T5"),
  task("T6", ["T2"]),
  task("T7", ["T2", "T3", "T4", "T6"]),
  task("T8", ["T7"]),
  task("T9", ["T2", "T3", "T4", "T5", "T6"]),
  task("T10", ["T7", "T8", "T9"]),
  task("T11"),
  task("T12"),
]

/** The 5-task record: `T1 → {T2,T3} → T4 → T5`, in the order `/plugins/mpd-team` serves it. */
const RECORD_BOARD: GraphTask[] = [
  task("T1", [], { kind: "requirement", visual: "completed", subject: "Requirement: team-plane settlement contract (frozen)" }),
  task("T2", ["T1"], { visual: "completed" }),
  task("T3", ["T1"], { visual: "completed" }),
  task("T4", ["T2", "T3"], { visual: "completed" }),
  task("T5", ["T4"], { kind: "review", visual: "completed" }),
]

/**
 * The ranks a plan-ordinal host serves for that record: `depth` is the plan ORDINAL, not the graph
 * rank, so the ladder arrives with holes in it (`1`, `3` and `5` hold no task). The drawing must
 * compact them, and every link must survive.
 */
const RECORD_SERVED = new Map([["T1", 0], ["T2", 2], ["T3", 2], ["T4", 4], ["T5", 6]])

/** The same five links with the served map COMPACTED, which is what the drawing must produce. */
const RECORD_SERVED_COMPACT = new Map([["T1", 0], ["T2", 1], ["T3", 1], ["T4", 2], ["T5", 3]])

/** Every link of the record board, as `[blocker, dependent]` pairs. */
const RECORD_LINKS: ReadonlyArray<readonly [string, string]> = [
  ["T1", "T2"], ["T1", "T3"], ["T2", "T4"], ["T3", "T4"], ["T4", "T5"],
]

/** One panel task: the drawing's own fields plus the detail verdict the record carries. */
function panelTask(id: string, dependencies: readonly string[] = [], extra: Partial<DagPanelTask> = {}): DagPanelTask {
  return { id, subject: `task ${id}`, kind: "work", visual: "open", dependencies, failedDependencies: [], depth: 0, ...extra }
}

/** A board whose first rank is EIGHT boxes wide, so its natural drawing is far wider than a panel. */
const WIDE_BOARD: DagPanelTask[] = [
  ...Array.from({ length: 8 }, (_, index) => panelTask(`W${index + 1}`)),
  panelTask("W9", ["W1", "W2", "W3", "W4", "W5", "W6", "W7", "W8"]),
]

/** The panel width the width-policy arm uses: wider than the drawing is drawn at, narrower than it. */
const PANEL_COLS = 60

// The panel width BELOW the contract's two-column floor for this fixture: a ten-cell node column
// (`NATURAL_MIN_NODE_WIDTH`) needs `2 * 10 + 3` = 23 cells for two of them, so 22 cannot show two.
/** The panel width below the contract's two-column floor (`2 * nodeWidth + NODE_GAP`). */
const NARROW_COLS = 22

// ── reading the drawing ─────────────────────────────────────────────────────

/** One drawn cell: the character at a column, and the tone the drawing gave it. */
interface Cell {
  /** The glyph; empty for the cell a wide glyph covers. */
  char: string
  /** The tone the span carrying the glyph was drawn in. */
  tone: GraphToneName
}

/** A tone name as the drawing spells it; the arms only compare them, never map them to a colour. */
type GraphToneName = string

// The direction masks, taken from the CONTRACT's own glyph table so a corner change cannot leave this
// reader behind. `▼` accepts an arrival from ABOVE only: it is the arrowhead the run ends in.
/** The four directions a connector cell can be entered from, as bits. */
const UP = 1, DOWN = 2, LEFT = 4, RIGHT = 8

/** Each connector glyph and the directions it connects, keyed by the contract's own characters. */
const CONNECTS: Readonly<Record<string, number>> = Object.freeze({
  [DAG_CHARS.horizontal]: LEFT | RIGHT,
  [DAG_CHARS.vertical]: UP | DOWN,
  [DAG_CHARS.cornerDownRight]: DOWN | RIGHT,
  [DAG_CHARS.cornerDownLeft]: DOWN | LEFT,
  [DAG_CHARS.cornerUpRight]: UP | RIGHT,
  [DAG_CHARS.cornerUpLeft]: UP | LEFT,
  [DAG_CHARS.teeRight]: UP | DOWN | RIGHT,
  [DAG_CHARS.teeLeft]: UP | DOWN | LEFT,
  [DAG_CHARS.teeUp]: UP | LEFT | RIGHT,
  [DAG_CHARS.teeDown]: DOWN | LEFT | RIGHT,
  [DAG_CHARS.cross]: UP | DOWN | LEFT | RIGHT,
  [DAG_CHARS.arrowDown]: UP,
})

/** The whole drawing, row by row, with every glyph plain text (the form the tone arms walk). */
function linesOf(view: GraphView): string[] {
  return view.lines.map((spans: readonly GraphSpan[]) => spans.map((span) => span.text).join(""))
}

/** The drawing as a cell grid: wide glyphs occupy the cells they cover, so columns stay honest. */
function gridOf(view: GraphView): Cell[][] {
  return view.lines.map((row: readonly GraphSpan[]) => {
    /** The row's cells, in column order. */
    const cells: Cell[] = []
    for (const span of row) {
      for (const char of span.text) {
        cells.push({ char, tone: span.tone })
        // A wide glyph owns the cell after it; pushing an empty placeholder keeps every later column
        // aligned with the drawing's own grid, which is what makes a walking failure readable.
        if (cellWidth(char) > 1) cells.push({ char: "", tone: span.tone })
      }
    }
    return cells
  })
}

/** The rectangle one drawn task occupies; a task on the board has exactly one. */
function boxOf(view: GraphView, id: string): GraphHit {
  /** The task's own rectangle, or a failure that names the task. */
  const hit = view.hits.find((entry) => entry.taskId === id)
  expect(`${id}=${hit === undefined ? "absent" : "drawn"}`).toBe(`${id}=drawn`)
  return hit as GraphHit
}

/** A task's box MID-LINE column — the cell the drawing enters and writes its `▼` on. */
function centreOf(view: GraphView, id: string): number {
  /** The task's rectangle. */
  const hit = boxOf(view, id)
  return Math.floor((hit.col + hit.colEnd) / 2)
}

/** Whether a cell belongs to a drawn box, borders included: a run may not use a box as a right of way. */
function insideBox(view: GraphView, row: number, col: number): boolean {
  return view.hits.some((hit) => row >= hit.row && row <= hit.rowEnd && col >= hit.col && col <= hit.colEnd)
}

/**
 * Whether the drawing carries a CONTINUOUS run from the blocker's bottom border to the dependent's
 * arrowhead.
 *
 * THE WHOLE POINT OF THE ARM: it starts at the blocker's own bottom-border centre cell (which must
 * carry a downward exit) and follows direction masks cell by cell, refusing to pass through any box.
 * A dropped long edge, a stub that never leaves the border, or a line that stops at an intermediate
 * rank all fail here, and no OTHER box's border can satisfy the walk.
 * @param view - the drawing to walk.
 * @param blocker - the task the edge leaves.
 * @param blocked - the task the edge arrives at.
 * @returns true when the run is connected end to end.
 */
function runsFromTo(view: GraphView, blocker: string, blocked: string): boolean {
  /** The drawing, decoded. */
  const grid = gridOf(view)
  /** The blocker's rectangle, which fixes where the run starts. */
  const from = boxOf(view, blocker)
  /** The dependent's rectangle, which fixes where the run must end. */
  const to = boxOf(view, blocked)
  /** The row the run starts on: the blocker's bottom border. */
  const startRow = from.rowEnd
  /** The column the run starts on: that border's centre. */
  const startCol = centreOf(view, blocker)
  /** The row the arrowhead sits on: one above the dependent's top border. */
  const goalRow = to.row - 1
  /** The column the arrowhead must sit on. */
  const goalCol = centreOf(view, blocked)
  if (grid[goalRow]?.[goalCol]?.char !== DAG_CHARS.arrowDown) return false
  /** The start cell must EXIT downward, or the blocker's border draws no edge at all. */
  if (((CONNECTS[grid[startRow]?.[startCol]?.char ?? ""] ?? 0) & DOWN) === 0) return false
  /** The cells already visited, so a crossing cannot loop the walk. */
  const seen = new Set<string>([`${startRow}:${startCol}`])
  /** The cells still to expand. */
  const stack: Array<readonly [number, number]> = [[startRow, startCol]]
  // Each step carries the bit the CURRENT cell must have and the bit the NEXT cell must accept, so a
  // run cannot turn where the drawing draws no corner.
  /** The four one-cell moves, with their outbound and inbound bits. */
  const steps: ReadonlyArray<readonly [number, number, number, number]> = [
    [-1, 0, UP, DOWN],
    [1, 0, DOWN, UP],
    [0, -1, LEFT, RIGHT],
    [0, 1, RIGHT, LEFT],
  ]
  while (stack.length > 0) {
    /** The cell being expanded. */
    const [row, col] = stack.pop() as readonly [number, number]
    /** The directions this cell connects. */
    const mask = CONNECTS[grid[row]?.[col]?.char ?? ""] ?? 0
    for (const [dRow, dCol, out, into] of steps) {
      if ((mask & out) === 0) continue
      /** The neighbour this step reaches. */
      const nextRow = row + dRow
      /** …and its column. */
      const nextCol = col + dCol
      /** The neighbour's own cell. */
      const next = grid[nextRow]?.[nextCol]
      if (next === undefined) continue
      if (((CONNECTS[next.char] ?? 0) & into) === 0) continue
      if (nextRow === goalRow && nextCol === goalCol) return true
      // A box is never a right of way: a run that crosses one is a line drawn through a picture.
      if (insideBox(view, nextRow, nextCol)) continue
      /** The neighbour's identity in the visited set. */
      const key = `${nextRow}:${nextCol}`
      if (seen.has(key)) continue
      seen.add(key)
      stack.push([nextRow, nextCol])
    }
  }
  return false
}

/** How many arrowheads one row of the drawing carries. */
function arrowsIn(view: GraphView, row: number): number {
  /** The row's text. */
  const text = linesOf(view)[row] ?? ""
  return [...text].filter((char) => char === DAG_CHARS.arrowDown).length
}

/** How many arrowheads the WHOLE drawing carries, which must be one per dependent task. */
function arrowCount(view: GraphView): number {
  return view.lines.reduce((total: number, _row: readonly GraphSpan[], index: number) => total + arrowsIn(view, index), 0)
}

/** One cell of the drawing, addressed by row and column. */
function cellAt(view: GraphView, row: number, col: number): Cell {
  /** The decoded cell, or a blank when the drawing stops short of it. */
  const cell = gridOf(view)[row]?.[col]
  return cell ?? { char: "", tone: "blank" }
}

/** The label a task draws under the contract's `<marker> <id>` rule, read off the drawing itself. */
function labelToneOf(view: GraphView, id: string): GraphToneName {
  for (const row of view.lines) for (const span of row) if (span.text.trimEnd().endsWith(` ${id}`)) return span.tone
  return "absent"
}

// ── 1. every edge, at ANY rank distance ────────────────────────────────────

describe("ARM 1 — every on-board blocker → dependent edge is drawn, at any rank distance", () => {
  test("a GAP-2 edge (T7 → T10, T9 → T10) has a connected run and ONE ▼ at T10", () => {
    /** The derived board at a width that affords boxes. */
    const view = layoutBoxes(DERIVED_BOARD, 200) as GraphView
    /** The dependent, which is two ranks below T7/T9 and one below T8. */
    const dependent = boxOf(view, "T10")
    for (const blocker of ["T7", "T9"]) {
      /** The blocker's own rectangle. */
      const parent = boxOf(view, blocker)
      // THE DISTANCE IS THE FIXTURE'S OWN: at least one whole rank sits between the two, so an
      // adjacent-only connector cannot satisfy this arm.
      expect(parent.rowEnd).toBeLessThan(dependent.row - 1)
      // THE RUN, followed cell by cell — this is the assertion the defect fails.
      expect(`${blocker}->T10 run=${runsFromTo(view, blocker, "T10")}`).toBe(`${blocker}->T10 run=true`)
    }
    // ONE ARROWHEAD PER DEPENDENT, fan-in included: T7, T8 and T9 all converge on T10.
    expect(arrowsIn(view, dependent.row - 1)).toBe(1)
    expect(cellAt(view, dependent.row - 1, centreOf(view, "T10")).char).toBe(DAG_CHARS.arrowDown)
    // The ADJACENT edge on the same drawing still arrives in its own one-cell stub, so the long-edge
    // route did not replace the shape that already worked.
    expect(runsFromTo(view, "T8", "T10")).toBe(true)
  })

  test("a long edge over a FULL intermediate rank keeps its lane, and a ONE-COLUMN board grows one", () => {
    // THE TWO LANE CASES, both of which used to lose the edge.
    // (a) THE MIDDLE RANK IS AS WIDE AS THE DRAWING GETS: the lane fits in a NODE_GAP column, so the
    //     picture keeps its width and the run still arrives.
    /** Three roots, three dependents filling the middle rank, and a leaf that ALSO rests on the first root. */
    const full: GraphTask[] = [
      task("A1"), task("A2"), task("A3"),
      task("B1", ["A1"]), task("B2", ["A2"]), task("B3", ["A3"]),
      task("C1", ["A1", "B1"]),
    ]
    /** The drawing of that board at its natural width. */
    const fullView = layoutBoxesNatural(full) as GraphView
    // THE PREMISE, MEASURED: three ten-cell boxes make 36 cells, and the middle rank holds all three.
    expect(boxOf(fullView, "B2").row).toBe(boxOf(fullView, "B1").row)
    expect(fullView.width).toBe(36)
    expect(`A1->C1 run=${runsFromTo(fullView, "A1", "C1")}`).toBe("A1->C1 run=true")
    // (b) A ONE-COLUMN BOARD HAS NO FREE COLUMN INSIDE ITSELF, so the lane is appended: the drawing is
    //     one column wider than its boxes and the edge is drawn THROUGH that column — the case where a
    //     lane chosen outside the canvas would have been silently dropped by the cell writer.
    /** A chain of three ranks whose last task also rests on the first. */
    const chain: GraphTask[] = [task("A1"), task("B1", ["A1"]), task("C1", ["A1", "B1"])]
    /** The one-column drawing, with its lane. */
    const chainView = layoutBoxesNatural(chain) as GraphView
    expect(chainView.width).toBeGreaterThan(10)
    expect(`A1->C1 run=${runsFromTo(chainView, "A1", "C1")}`).toBe("A1->C1 run=true")
    expect(cellAt(chainView, boxOf(chainView, "C1").row - 1, centreOf(chainView, "C1")).char).toBe(DAG_CHARS.arrowDown)
    // No row is wider than the drawing claims, whatever the lane arithmetic did.
    for (const view of [fullView, chainView]) for (const line of linesOf(view)) expect(cellWidth(line)).toBeLessThanOrEqual(view.width)
  })

  test("adjacent-rank output is BYTE-IDENTICAL to the shape that already worked", () => {
    // THE BOARD WHOSE EVERY EDGE IS ONE RANK LONG — the geometry the contract freezes. The drawing is
    // asserted as TEXT so a routing change that also moved an adjacent edge would redden here rather
    // than hide inside a tone or a hit rectangle.
    /** Two roots, one merge, one leaf: three ranks, four adjacent edges. */
    const adjacent: GraphTask[] = [task("A1"), task("A2"), task("B1", ["A1", "A2"]), task("C1", ["B1"])]
    /** The drawing at a width that affords boxes. */
    const view = layoutBoxes(adjacent, 120) as GraphView
    expect(linesOf(view).join("\n")).toContain(DAG_CHARS.teeDown)
    for (const [blocker, blocked] of [["A1", "B1"], ["A2", "B1"], ["B1", "C1"]] as const) {
      expect(`${blocker}->${blocked} run=${runsFromTo(view, blocker, blocked)}`).toBe(`${blocker}->${blocked} run=true`)
    }
    // ONE `▼` per dependent, and the shared arrow sits on the fan-in's own centre.
    expect(arrowsIn(view, boxOf(view, "B1").row - 1)).toBe(1)
    expect(arrowsIn(view, boxOf(view, "C1").row - 1)).toBe(1)
  })
})

// ── 2. an empty rank bucket consumes nothing ───────────────────────────────

describe("ARM 2 — an empty rank bucket consumes no rows and breaks no edge", () => {
  test("served ranks {0,2}: the dependent sits ONE connector band below its blocker", () => {
    /** A two-task chain. */
    const board: GraphTask[] = [task("H1"), task("H2", ["H1"])]
    /** The same board with the served rank the host would send: 0 and 2, so rank 1 is EMPTY. */
    const holed = layoutBoxes(board, 120, undefined, new Map([["H1", 0], ["H2", 2]])) as GraphView
    // THE 6-ROW HOLE IS THE DEFECT: an empty bucket used to consume a whole rank stride (six rows), so
    // these two boxes stood TEN rows apart — the multi-rank blank gap in the user's screenshot. One
    // connector band is four rows apart: the bottom border, three connector rows, the next top border.
    expect(boxOf(holed, "H2").row - boxOf(holed, "H1").rowEnd).toBe(4)
    expect(runsFromTo(holed, "H1", "H2")).toBe(true)
    expect(cellAt(holed, boxOf(holed, "H2").row - 1, centreOf(holed, "H2")).char).toBe(DAG_CHARS.arrowDown)
    // COMPACTION IS PROVEN, NOT ASSUMED: the same board with an already-compact served map draws the
    // identical picture, so the empty bucket cannot leave a trace in the geometry.
    /** The same board with no hole in its served ranks. */
    const compact = layoutBoxes(board, 120, undefined, new Map([["H1", 0], ["H2", 1]])) as GraphView
    expect(linesOf(holed)).toEqual(linesOf(compact))
  })

  test("served ranks {0,2,4}: every link is drawn and the drawing is exactly as tall as its ranks", () => {
    /** A three-task chain. */
    const board: GraphTask[] = [task("H1"), task("H2", ["H1"]), task("H3", ["H2"])]
    /** Three ranks served as 0, 2 and 4, so TWO buckets in between are empty. */
    const holed = layoutBoxes(board, 120, undefined, new Map([["H1", 0], ["H2", 2], ["H3", 4]])) as GraphView
    for (const [blocker, blocked] of [["H1", "H2"], ["H2", "H3"]] as const) {
      expect(`${blocker}->${blocked} run=${runsFromTo(holed, blocker, blocked)}`).toBe(`${blocker}->${blocked} run=true`)
      // ONE BAND, NOT TWO STRIDES: the bottom border, the three connector rows, the next top border.
      expect(boxOf(holed, blocked).row - boxOf(holed, blocker).rowEnd).toBe(4)
    }
    // THREE RANKS DRAW EXACTLY THREE RANK STRIDES MINUS THE UNUSED CONNECTOR BAND AFTER THE LAST ONE.
    expect(holed.lines.length).toBe(3 * 6 - 3)
    // And the compact served map — the same board with no holes — is the same picture.
    /** The same board with the ranks compacted. */
    const compact = layoutBoxes(board, 120, undefined, new Map([["H1", 0], ["H2", 1], ["H3", 2]])) as GraphView
    expect(linesOf(holed)).toEqual(linesOf(compact))
  })
})

// ── 3. the record board, exactly as the host serves it ─────────────────────

describe("ARM 3 — the 5-task record board draws every link", () => {
  test("served ranks 0,2,4,6 (holes at 1,3,5): T1→{T2,T3}→T4→T5 all arrive", () => {
    /** The record board under the ranks a plan-ordinal host serves. */
    const view = layoutBoxes(RECORD_BOARD, 160, undefined, RECORD_SERVED) as GraphView
    // FIVE TASKS, FIVE LINKS, and not one of them may be dropped.
    expect(view.hits.length).toBe(5)
    for (const [blocker, blocked] of RECORD_LINKS) {
      expect(`${blocker}->${blocked} run=${runsFromTo(view, blocker, blocked)}`).toBe(`${blocker}->${blocked} run=true`)
      // The arrowhead names the dependent, at its own centre, one cell above its top border.
      expect(cellAt(view, boxOf(view, blocked).row - 1, centreOf(view, blocked)).char).toBe(DAG_CHARS.arrowDown)
    }
    // ONE ARROWHEAD PER DEPENDENT, fan-in included: four dependents, four `▼`, and T4's two blockers
    // still converge on ONE of them.
    expect(arrowCount(view)).toBe(4)
    // EVERY TASK IS ON THE BOARD and named: a drawing that lost an edge usually lost a box with it.
    for (const entry of RECORD_BOARD) expect(labelToneOf(view, entry.id)).not.toBe("absent")
    // THE DRAWING IS THE COMPACTED ONE: the same record with the ranks tightened is the same picture,
    // which is what proves the holes did not consume rows.
    /** The record board under an already-compact served map. */
    const compact = layoutBoxes(RECORD_BOARD, 160, undefined, RECORD_SERVED_COMPACT) as GraphView
    expect(linesOf(view)).toEqual(linesOf(compact))
  })

  test("the DERIVED ranks of the same record draw the same five links", () => {
    // NO SERVED MAP AT ALL: this is the standalone path, where the drawing derives the ranks itself.
    // The record's `blockedBy` references all resolve, so the derivation is the honest one.
    /** The record board, ranked by the drawing. */
    const derived = layoutBoxes(RECORD_BOARD, 160) as GraphView
    expect(derived.ranksDerived).toBe(true)
    expect(derived.hits.length).toBe(5)
    for (const [blocker, blocked] of RECORD_LINKS) {
      expect(`${blocker}->${blocked} run=${runsFromTo(derived, blocker, blocked)}`).toBe(`${blocker}->${blocked} run=true`)
    }
  })
})

// ── 4. the width policy ────────────────────────────────────────────────────

describe("ARM 4 — a wide drawing is BOXES while two node columns fit, and the page pans", () => {
  test("a drawing wider than the panel is still boxes, and the window pans across it", () => {
    /** The layout a 60-cell panel gets for an 8-column board. */
    const layout = dagPanelLayout(WIDE_BOARD, PANEL_COLS)
    // THE DEFECT IN ONE ASSERTION: the whole-fit rule downgraded this board to the rail, which has no
    // lines at all. Two node columns fit this panel, so the boxed drawing is the honest choice.
    expect(`mode=${layout.mode}`).toBe("mode=boxes")
    expect(layout.view.width).toBeGreaterThan(PANEL_COLS)
    // THE WINDOW PANS: the first and the furthest column windows show DIFFERENT cells, each exactly
    // the panel's width — the horizontal reach the footer names.
    /** The window at the drawing's left edge. */
    const left = linesOf(layout.view)
    /** The furthest offset the page can pan to for this drawing. */
    const maxOffset = layout.view.width - PANEL_COLS
    /** The row both windows are read on: the first rank's top border. */
    const probeRow = 0
    /** The drawing cut to the panel at offset 0. */
    const windowAtZero = left[probeRow].slice(0, PANEL_COLS)
    /** …and cut at the far edge, in cells (the fixtures are ASCII, so a slice is a cell slice). */
    const windowAtEnd = left[probeRow].slice(maxOffset, maxOffset + PANEL_COLS)
    expect(windowAtZero.length).toBe(PANEL_COLS)
    expect(windowAtEnd.length).toBe(PANEL_COLS)
    expect(windowAtZero).not.toBe(windowAtEnd)
    // The last box's left corner is reachable through the window — the pan is not clamped short.
    expect(windowAtEnd).toContain(DAG_CHARS.cornerDownRight)
  })

  test("the footer names the COLUMN position, and the row position, while the page overflows", () => {
    /** The footer for a page that overflows on both axes. */
    const footer = dagFooterText({ vertical: { offset: 2, max: 20 }, horizontal: { offset: 41, max: 41 } })
    // ROW FIRST, THEN COLUMN — the order the reader scans, and the two tokens stay distinguishable
    // because the horizontal one names its axis.
    expect(footer.startsWith("3/21 col 42/42")).toBe(true)
    // A page that fits names no position at all, so the token cannot appear when there is nothing to pan.
    expect(dagFooterText({}).includes("col ")).toBe(false)
  })

  test("a panel narrower than two node columns falls back, and the busy board still reaches the list", () => {
    /** The layout a genuinely too-narrow panel gets. */
    const narrow = dagPanelLayout(WIDE_BOARD, NARROW_COLS)
    // THE REFUSAL SURVIVES ONLY HERE (clause A3): below `2 * nodeWidth + NODE_GAP` the panel cannot
    // show two node columns of this drawing at all, so the rail is the honest picture.
    expect(`mode=${narrow.mode}`).toBe("mode=rail")
    // …and the existing `> LIST_ROWS` rule still picks the dense table for a BUSY board below that
    // floor, where neither the drawing nor two of its columns fit.
    /** A busy board: a 30-task chain plus two more roots, so its widest rank is three boxes wide. */
    const busy: DagPanelTask[] = [...Array.from({ length: 30 }, (_, index) => panelTask(`B${index + 1}`, index === 0 ? [] : [`B${index}`])), panelTask("Z1"), panelTask("Z2")]
    expect(`mode=${dagPanelLayout(busy, NARROW_COLS).mode}`).toBe("mode=list")
    // AT THE FLOOR ITSELF the same board is BOXED, which is the half the defect removed — and it is
    // boxed however TALL the drawing is: 32 ranks used to be refused by the removed rank cap.
    expect(`mode=${dagPanelLayout(busy, 23).mode}`).toBe("mode=boxes")
    // A NARROW PANEL SHOWING A DRAWING THAT ALREADY FITS keeps its boxes: refusing a whole picture is
    // the over-wide rule again, wearing a smaller constant.
    /** A two-rank chain whose drawing is ten cells wide. */
    const small: DagPanelTask[] = [panelTask("S1"), panelTask("S2", ["S1"])]
    expect(`mode=${dagPanelLayout(small, NARROW_COLS).mode}`).toBe("mode=boxes")
  })
})

// ── 5. the pinned board keeps its connectors visible ───────────────────────

describe("ARM 5 — a pinned board draws off-chain connectors in the visible edge tone", () => {
  test("an off-chain connector carries `edge`, the chain keeps `chain`, and the boxes may stay dim", () => {
    /** Two roots and their two dependents, so one edge is IN the pinned chain and one is not. */
    const board: GraphTask[] = [
      task("P1", [], { kind: "requirement", visual: "completed" }),
      task("P2", [], { kind: "requirement" }),
      task("C1", ["P1"], { visual: "completed" }),
      task("C2", ["P2"]),
    ]
    /** The drawing with C1 pinned: its own chain is {P1}. */
    const view = layoutBoxes(board, 120, "C1") as GraphView
    // AN IN-CHAIN CONNECTOR STAYS THE LOUD ONE — the highlight the pin exists for is untouched.
    expect(cellAt(view, boxOf(view, "P1").rowEnd + 1, centreOf(view, "P1")).tone).toBe("chain")
    // AN OFF-CHAIN CONNECTOR IS STILL DRAWN: `dim` resolves to the host's `inactive` grey over a
    // `dimColor` flag, which reads as the same grey as the background — the second invisibility path.
    expect(cellAt(view, boxOf(view, "P2").rowEnd + 1, centreOf(view, "P2")).tone).toBe("edge")
    // …AND ITS ARROWHEAD TOO, or the line ends in nothing.
    expect(cellAt(view, boxOf(view, "C2").row - 1, centreOf(view, "C2"))).toMatchObject({ char: DAG_CHARS.arrowDown, tone: "edge" })
    // THE BOXES AND LABELS MAY STAY DIM, and they do: the pin still narrows the picture.
    expect(labelToneOf(view, "C2")).toBe("dim")
    expect(labelToneOf(view, "P2")).toBe("dim")
  })

  test("ARM 5b — an off-chain LONG edge's arrowhead carries `edge`, and the pin's own does not", () => {
    // WHY A SECOND PINNED ARM: ARM 5's off-chain edge is ONE rank long, so its arrowhead comes from the
    // adjacent-band writer. A GAP-2 edge renders through the LANE pass, which calls `arrowToneOf` on
    // its own path — the terminus a reader sees at the end of the longest line is this arm's subject.
    /** Two roots, a middle rank, and two dependents: the pinned chain is P1 → M1 → C1. */
    const board: GraphTask[] = [
      task("P1", [], { kind: "requirement", visual: "completed" }),
      task("P2", [], { kind: "requirement" }),
      task("M1", ["P1"]),
      task("C1", ["M1"], { visual: "completed" }),
      task("C2", ["P2", "M1"]),
    ]
    /** The drawing with C1 pinned, so P2 → C2 (rank 0 → rank 2) is the off-chain LONG edge. */
    const view = layoutBoxes(board, 120, "C1") as GraphView
    // THE PREMISE, MEASURED: the dependents sit one FULL middle rank below the roots, so this is the
    // lane path and not ARM 5's adjacent band wearing the same assertion.
    expect(boxOf(view, "C2").row - boxOf(view, "P2").rowEnd).toBe(10)
    // THE LONG EDGE IS REALLY DRAWN: the walk reaches the dependent, so the tone below is its terminus.
    expect(`P2->C2 run=${runsFromTo(view, "P2", "C2")}`).toBe("P2->C2 run=true")
    // THE OFF-CHAIN ARROWHEAD IS VISIBLE: `edge`, the tone the pin never dims.
    expect(cellAt(view, boxOf(view, "C2").row - 1, centreOf(view, "C2"))).toMatchObject({ char: DAG_CHARS.arrowDown, tone: "edge" })
    // THE PIN'S OWN TERMINUS KEEPS ITS LIGHT (the focus tone), so `edge` above is the off-chain case
    // and not a blanket repaint of every arrowhead on the board.
    expect(cellAt(view, boxOf(view, "C1").row - 1, centreOf(view, "C1"))).toMatchObject({ char: DAG_CHARS.arrowDown, tone: "focus" })
  })
})

// ── 6. an unresolved blocker reference is reported, never drawn ────────────

describe("ARM 6 — an unresolved blocker id is reported and contributes no drawn edge", () => {
  test("the page names the missing ids, draws the resolvable edge, and skips the ghosts", () => {
    // THE SILENT-FILTER DEFECT, ONE LAYER UP: `rankPlan` reports the references no task carries and
    // the PAGE must surface that list, while the DRAWING must not invent an edge for them.
    /** Two real links (U1 → U2) plus two blocker ids that name no task on the board. */
    const board: DagPanelTask[] = [
      panelTask("U1"),
      panelTask("U2", ["U1", "GHOST1"]),
      panelTask("U3", ["GHOST2"]),
    ]
    /** The page's own layout at a width that affords boxes. */
    const layout = dagPanelLayout(board, 120)
    // 1. THE PAGE REPORTS THEM, in the core's sorted order, through its own `unresolved` field.
    expect(layout.mode).toBe("boxes")
    expect(layout.unresolved).toEqual(["GHOST1", "GHOST2"])
    // 2. NO GHOST IS DRAWN: every hit rectangle belongs to a task the board really carries.
    expect(layout.view.hits.map((hit) => hit.taskId).sort()).toEqual(["U1", "U2", "U3"])
    // 3. THE RESOLVABLE EDGE SURVIVES — exactly ONE arrowhead, above U2 — so the ghosts add none.
    expect(arrowCount(layout.view)).toBe(1)
    expect(runsFromTo(layout.view, "U1", "U2")).toBe(true)
    expect(cellAt(layout.view, boxOf(layout.view, "U2").row - 1, centreOf(layout.view, "U2")).char).toBe(DAG_CHARS.arrowDown)
    // 4. THE GHOSTS CONTRIBUTE NOTHING TO THE PICTURE: the same board without them draws identical
    //    lines, which is what makes "reported but never drawn" a byte-level fact rather than a promise.
    /** The control board: the same three tasks once the unresolvable references are gone. */
    const control = dagPanelLayout([panelTask("U1"), panelTask("U2", ["U1"]), panelTask("U3")], 120)
    expect(control.unresolved).toEqual([])
    expect(linesOf(layout.view)).toEqual(linesOf(control.view))
  })
})
