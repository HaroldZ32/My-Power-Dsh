// THE DAG's RANK DERIVATION, ITS REPORTED REFERENCES AND ITS CJK CELL DISCIPLINE.
//
// Three defects live in one file (`src/graph.ts`) and each has arms here, because each was REPORTED
// rather than imagined:
//
//   * R17 — the drawing trusted `GraphTask.depth`. The served `depth` was MEASURED lying on our own
//     live board: `.mpd/team/teams/team-20261006135108.json` holds ids `T1..T10` while its `blockedBy`
//     values are plan ordinals (`["2"]`, `["2","3","4","6"]`, …), `team-store.ts` resolves a blocker by
//     exact id or exact subject and otherwise returns it unchanged, and its `taskDepths` then drops
//     the unresolvable ones — so every task became a root, every depth became 0, and the WEB view drew
//     ONE column with NO edges. The TUI must not repeat that, so the rank is DERIVED from the
//     dependency graph and `depth` is only a fallback for a board whose graph says nothing.
//   * R18 — a blocker reference that resolves to nothing used to vanish silently. That silence is what
//     produced the bug, so the references travel out of the layout in `unresolved`.
//   * the CJK cell bug — a wide glyph was written into ONE array slot while the cursor advanced TWO
//     cells, so the slot it covered kept rendering a background space. The row came out one cell wider
//     than its grid and the box's closing `│` was pushed off it: measured verbatim, `cjk @120` line 1
//     `│ ✓ T1 WRK 冻 结 验 收 契 约      ` with no closing border, while lines 0 and 2 closed at col 33.
//
// The arms are INVARIANT-shaped: ranks are compared by RELATIVE order and by containment in the
// published rectangles, never against a frozen grid.
import { describe, expect, test } from "bun:test"

import { hitTest, layoutBoxes, layoutGraph, layoutList, layoutRail, type GraphHit, type GraphTask, type GraphSpan } from "../src/graph"
import { cellWidth } from "../src/sanitize"

/** One task, with the fields an arm cares about and sane defaults for the rest. */
function task(id: string, depth: number, dependencies: string[] = [], extra: Partial<GraphTask> = {}): GraphTask {
  return { id, subject: "subject of " + id, kind: "work", visual: "open", dependencies, depth, ...extra }
}

/** The whole drawing as plain lines. */
const linesOf = (view: { lines: GraphSpan[][] }): string[] => view.lines.map((spans) => spans.map((span) => span.text).join(""))

/** The rectangle one drawn task occupies, which is also where its rank can be read off. */
function boxOf(view: { hits: GraphHit[] }, id: string): GraphHit {
  /** The task's own rectangle; a drawn task has exactly one. */
  const hit = view.hits.find((entry) => entry.taskId === id)
  expect(hit).toBeDefined()
  return hit as GraphHit
}

/**
 * The board the captain transcribed from the MEASURED broken record, with the ordinals resolved.
 *
 * Twelve tasks and FIVE derived ranks: `T6 ← T2` (1), `T7 ← {T2,T3,T4,T6}` (2), `T8 ← T7` (3),
 * `T9 ← {T2,T3,T4,T5,T6}` (2) and `T10 ← {T7,T8,T9}` (4). Every `depth` is 0 — the lie the store
 * served — so an arm proves the drawing ignores it.
 */
const DERIVED_BOARD: GraphTask[] = [
  task("T1", 0, [], { kind: "requirement" }),
  task("T2", 0, [], { kind: "requirement" }),
  task("T3", 0),
  task("T4", 0),
  task("T5", 0),
  task("T6", 0, ["T2"]),
  task("T7", 0, ["T2", "T3", "T4", "T6"]),
  task("T8", 0, ["T7"]),
  task("T9", 0, ["T2", "T3", "T4", "T5", "T6"]),
  task("T10", 0, ["T7", "T8", "T9"]),
  task("T11", 0),
  task("T12", 0),
]

/**
 * The record EXACTLY as it sits on disk: ids `T1..T10`, blocker references that are plan ordinals, and
 * every `depth` 0. Not one reference resolves, which is the user's reported defect.
 */
const BROKEN_RECORD: GraphTask[] = [
  task("T1", 0, [], { kind: "requirement" }),
  task("T2", 0),
  task("T3", 0),
  task("T4", 0),
  task("T5", 0),
  task("T6", 0, ["2"]),
  task("T7", 0, ["2", "3", "4", "6"]),
  task("T8", 0, ["7"]),
  task("T9", 0, ["2", "3", "4", "5", "6"]),
  task("T10", 0, ["7", "8", "9"]),
]

describe("the derived rank (R17)", () => {
  test("a flat all-zero served depth does NOT collapse the board to one rank", () => {
    /** The drawing of the derived board, whose every `depth` lies. */
    const view = layoutBoxes(DERIVED_BOARD, 200) as NonNullable<ReturnType<typeof layoutBoxes>>
    expect(view.ranksDerived).toBe(true)
    // THE DEFECT, in one assertion: with the served depth every box would share rank 0 and therefore
    // one row. The derivation puts five ranks below each other, and the order is read off the boxes'
    // own rectangles rather than from a constant.
    /** How many distinct rows the drawing actually places boxes on. */
    const rows = new Set(view.hits.map((hit) => hit.row))
    expect(rows.size).toBe(5)
    // The chain T2 → T6 → T7 → T8 → T10 runs strictly DOWNWARD, which is the relation the drawing is
    // supposed to show and the one the broken board lost entirely.
    for (const [upper, lower] of [["T2", "T6"], ["T6", "T7"], ["T7", "T8"], ["T8", "T10"]] as const) {
      expect(boxOf(view, upper).rowEnd).toBeLessThan(boxOf(view, lower).row)
    }
    // A rank holds exactly the tasks whose longest blocker chain is that long, so the five roots share
    // the top row and T10 — the deepest task — stands alone at the bottom.
    expect(boxOf(view, "T1").row).toBe(boxOf(view, "T12").row)
    expect(boxOf(view, "T10").row).toBeGreaterThan(boxOf(view, "T9").row)
  })

  test("the SERVED depth is ignored while the graph resolves — the drawing is the same either way", () => {
    /** The same board carrying the depths the store WOULD have computed, so the two can be compared. */
    const honest = DERIVED_BOARD.map((entry) => ({ ...entry }))
    for (const entry of honest) {
      // The honest depth of each task: the longest blocker chain under it.
      /** The blocker chain lengths already computed in this pass. */
      const depth = (id: string): number => {
        /** The task itself. */
        const self = honest.find((candidate) => candidate.id === id) as GraphTask
        if (self.dependencies.length === 0) return 0
        return self.dependencies.reduce((best, blocker) => Math.max(best, depth(blocker) + 1), 0)
      }
      entry.depth = depth(entry.id)
    }
    /** The drawing of the lying board. */
    const lying = layoutBoxes(DERIVED_BOARD, 200) as NonNullable<ReturnType<typeof layoutBoxes>>
    /** The drawing of the honest board. */
    const served = layoutBoxes(honest, 200) as NonNullable<ReturnType<typeof layoutBoxes>>
    for (const entry of DERIVED_BOARD) expect(boxOf(lying, entry.id).row).toBe(boxOf(served, entry.id).row)
    for (const entry of DERIVED_BOARD) expect(boxOf(lying, entry.id).col).toBe(boxOf(served, entry.id).col)
  })

  test("the SERVED depth draws ONLY when the graph resolves nothing at all and the depth varies", () => {
    // BOTH conditions are load-bearing, and the pair is what separates a correct fallback from the old
    // bug. A board whose references do not resolve while its depths DO vary is the one case where the
    // record knows something the references cannot say, so the served value draws and says so.
    /** A board of ghost references whose served depths claim two ranks. */
    const ghosts: GraphTask[] = [task("A", 0, ["Z"]), task("B", 1, ["Y"])]
    /** The rail, whose rows are one per task and whose order follows the rank. */
    const view = layoutRail(ghosts, 60)
    expect(view.ranksDerived).toBe(false)
    expect(view.unresolved).toEqual(["Y", "Z"])
    // A GENUINELY FLAT BOARD STAYS FLAT — and that is the other half of the pair: a board that resolves
    // nothing but is ALSO served flat has no structure anywhere, so nothing is invented for it.
    /** Two independent roots, served flat. */
    const flat = layoutRail([task("A", 0), task("B", 0)], 60)
    expect(flat.ranksDerived).toBe(true)
    expect(flat.unresolved).toEqual([])
  })
})

describe("the unresolved references (R18)", () => {
  test("the record's own plan ordinals are REPORTED, not silently dropped", () => {
    /** The drawing of the record verbatim. */
    const view = layoutGraph(BROKEN_RECORD, 120)
    // Every reference in the record is an ordinal, so nothing resolves and all of them are named.
    expect(view.unresolved).toEqual(["2", "3", "4", "5", "6", "7", "8", "9"])
    // NOTHING IS INVENTED EITHER: with no resolvable blocker the board is genuinely flat. At a width
    // where a box fits, all ten tasks therefore stand in ONE rank — the honest picture, now that it
    // also reports WHY — and no arrowhead is drawn anywhere.
    /** The boxed drawing at a width that can hold a ten-wide rank. */
    const boxed = layoutBoxes(BROKEN_RECORD, 400) as NonNullable<ReturnType<typeof layoutBoxes>>
    expect(new Set(boxed.hits.map((hit) => hit.row)).size).toBe(1)
    expect(boxed.ranksDerived).toBe(true)
    expect(linesOf(view).join("\n")).not.toContain("▼")
    // The same facts survive every view, so a page cannot lose them by choosing another mode.
    for (const other of [layoutRail(BROKEN_RECORD, 120), layoutList(BROKEN_RECORD, 120), layoutGraph(BROKEN_RECORD, 40)]) {
      expect(other.unresolved).toEqual(["2", "3", "4", "5", "6", "7", "8", "9"])
    }
  })

  test("a reference that DOES resolve draws its edge, and is not listed as unresolved", () => {
    /** A board with one drawable blocker and one ghost reference on the same task. */
    const board: GraphTask[] = [task("P", 0), task("C", 0, ["P", "GHOST"])]
    /** The drawing. */
    const view = layoutBoxes(board, 60) as NonNullable<ReturnType<typeof layoutBoxes>>
    expect(view.unresolved).toEqual(["GHOST"])
    expect(linesOf(view).join("\n")).toContain("▼")
  })

  test("an empty board reports nothing, rather than a phantom reference", () => {
    /** The empty drawing. */
    const view = layoutBoxes([], 80) as NonNullable<ReturnType<typeof layoutBoxes>>
    expect(view.unresolved).toEqual([])
    expect(view.ranksDerived).toBe(true)
  })
})

describe("the CJK cell discipline", () => {
  /** A board whose subjects are wide glyphs, which take two cells each. */
  const CJK_BOARD: GraphTask[] = [
    task("T1", 0, [], { subject: "冻结验收契约" }),
    task("T2", 0, ["T1"], { subject: "验证" }),
  ]

  test("a wide subject cannot shear the drawing: every line stays inside `cols`, and a box CLOSES", () => {
    for (const cols of [120, 80, 48, 34]) {
      /** The drawing at this width. */
      const view = layoutBoxes(CJK_BOARD, cols)
      if (view === undefined) continue
      // THE INVARIANT: no row is wider than the viewport it was drawn for, measured in CELLS — the
      // measurement that caught the defect, where a row of CJK text came out one cell too wide.
      for (const line of linesOf(view)) expect(cellWidth(line)).toBeLessThanOrEqual(cols)
      for (const line of linesOf(view)) expect(cellWidth(line)).toBeLessThanOrEqual(view.width)
      // AND THE BOX CLOSES ON ITS OWN COLUMN. The defect's signature was a body row missing its right
      // border while the rows above and below it kept theirs, so this is the assertion that pins it.
      /** The row of the first box, whose body row carries the wide subject. */
      const first = boxOf(view, "T1")
      /** That box's body row, which is the one the wide glyphs sit on. */
      const body = linesOf(view)[first.row + 1]
      expect(body.endsWith("│")).toBe(true)
      expect(cellWidth(body)).toBe(first.colEnd + 1)
    }
  })

  test("the ASCII control is byte-for-byte the same shape, so the fix is not a special case", () => {
    /** The same board with plain ASCII subjects. */
    const ascii: GraphTask[] = [task("T1", 0, [], { subject: "freeze the contract" }), task("T2", 0, ["T1"], { subject: "verify" })]
    /** The CJK drawing at the same width. */
    const wide = layoutBoxes(CJK_BOARD, 120) as NonNullable<ReturnType<typeof layoutBoxes>>
    /** The ASCII drawing at the same width. */
    const narrow = layoutBoxes(ascii, 120) as NonNullable<ReturnType<typeof layoutBoxes>>
    // The two boards differ only in their subjects, so their geometry must be identical — a wide glyph
    // consumes two cells, and the row still measures exactly the columns it was built for.
    expect(wide.width).toBe(narrow.width)
    expect(boxOf(wide, "T1").colEnd).toBe(boxOf(narrow, "T1").colEnd)
    for (const line of linesOf(wide)) expect(cellWidth(line)).toBeLessThanOrEqual(wide.width)
    for (const line of linesOf(narrow)) expect(cellWidth(line)).toBeLessThanOrEqual(narrow.width)
  })
})

describe("the invariants the geometry keeps, on a board that exercises every path", () => {
  test("halving the width never WIDENS the drawing, and a node sits in its own hit rectangle", () => {
    /** The width the previous step drew at, so monotonicity can be checked as it shrinks. */
    let previous = Number.MAX_SAFE_INTEGER
    for (let cols = 200; cols >= 20; cols = Math.floor(cols / 2)) {
      /** The view the preference picks at this width. */
      const view = layoutGraph(DERIVED_BOARD, cols)
      expect(view.width).toBeLessThanOrEqual(cols)
      expect(view.width).toBeLessThanOrEqual(previous)
      previous = view.width
      for (const hit of view.hits) {
        // A rectangle resolves to its OWN task at every one of its corners, which is the property the
        // pointer relies on and the one a drifted layout would break first.
        expect(hitTest(view, hit.row, hit.col)).toBe(hit.taskId)
        expect(hitTest(view, hit.rowEnd, hit.colEnd)).toBe(hit.taskId)
        expect(hit.rowEnd).toBeGreaterThanOrEqual(hit.row)
        expect(hit.colEnd).toBeGreaterThanOrEqual(hit.col)
      }
      // A drawing never exceeds the width it was given, in CELLS, at every width that draws at all.
      for (const line of linesOf(view)) expect(cellWidth(line)).toBeLessThanOrEqual(cols)
    }
  })

  test("an edge leaves the BLOCKER's border and arrives above the BLOCKED task, one arrowhead per task", () => {
    /** The drawing of the derived board. */
    const view = layoutBoxes(DERIVED_BOARD, 200) as NonNullable<ReturnType<typeof layoutBoxes>>
    /** The drawing as text, one string per row. */
    const lines = linesOf(view)
    /** The centre column of a task's box, in the module's OWN convention: the box's mid-line. */
    const centreOf = (id: string): number => {
      /** The task's rectangle. */
      const hit = boxOf(view, id)
      // THE BOX'S MID-LINE, which on an EVEN width is its LEFT-middle cell — the cell the drawing itself
      // enters from. This used to be `col + floor((colEnd - col + 1) / 2)`, which rounds the other way
      // and disagreed with the drawing by one column on every even-width box.
      return Math.floor((hit.col + hit.colEnd) / 2)
    }
    // THE ARROW SITS ON THE DEPENDENT'S CENTRE, in the cell directly above its box, and the blocker's
    // bottom border carries the `┬` the stub leaves from — the pair of facts that say a drawn edge
    // belongs to the two tasks it names.
    for (const [blocker, blocked] of [["T2", "T6"], ["T7", "T8"], ["T9", "T10"]] as const) {
      /** The blocked task's rectangle, which fixes where its entry cell is. */
      const child = boxOf(view, blocked)
      /** The cell the arrowhead is written at. */
      const arrowRow = lines[child.row - 1]
      /** The column the arrowhead occupies, counted in cells. */
      let at = 0
      /** The column the arrow was found at, or -1. */
      let found = -1
      for (const span of view.lines[child.row - 1]) {
        /** Where the arrow sits inside this span, or -1. */
        const index = span.text.indexOf("▼")
        if (index >= 0) found = at + cellWidth(span.text.slice(0, index))
        at += cellWidth(span.text)
      }
      expect(arrowRow).toBeDefined()
      expect(found).toBe(centreOf(blocked))
      expect(lines[boxOf(view, blocker).rowEnd]).toContain("┬")
    }
  })

  test("a cycle terminates, is REPORTED, and still draws every task", () => {
    /** Three tasks where the first two block each other. */
    const cyclic: GraphTask[] = [task("A", 0, ["B"]), task("B", 0, ["A"]), task("C", 0)]
    for (const view of [layoutBoxes(cyclic, 90), layoutRail(cyclic, 60), layoutList(cyclic, 60)]) {
      expect(view?.cycles).toEqual(["A", "B"])
      expect(view?.hits.length).toBe(3)
    }
  })
})

describe("the rail keeps every task at any depth", () => {
  test("a 40-deep chain still NAMES its tasks, at a narrow and a wide rail", () => {
    // MEASURED while probing a 40-task board: the rail's indent grows three cells per level, and by
    // level 27 the prefix alone filled an 80-cell row, so `clampSpans` cut the label away and the row
    // rendered blank — the drawing and its own hit rectangles disagreed about what was on screen. The
    // prefix is now bounded by the width, which is what this arm pins.
    /** A 40-task chain, one task per rank. */
    const chain: GraphTask[] = Array.from({ length: 40 }, (_, at) => task("B" + (at + 1), at, at === 0 ? [] : ["B" + at], { subject: "broad task " + (at + 1) }))
    for (const cols of [80, 40, 24]) {
      /** The rail at this width. */
      const view = layoutRail(chain, cols)
      expect(view.hits.length).toBe(40)
      for (const hit of view.hits) {
        /** The row the rectangle claims. */
        const row = linesOf(view)[hit.row]
        // THE INVARIANT: a rectangle is only useful if the task it names is ON the row it names.
        expect(row).toContain(hit.taskId)
        expect(cellWidth(row)).toBeLessThanOrEqual(cols)
      }
    }
  })
})
