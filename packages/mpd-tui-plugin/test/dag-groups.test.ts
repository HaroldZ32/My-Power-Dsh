// THE GROUP FRAMES: the nested DAG's own obligations (cellwork wave 4, frozen contract D3).
//
// WHAT THIS FILE PROVES, arm by arm: the SECOND glyph family is one cell per glyph and shares nothing
// with the node family; a nested model really draws a frame around its interior (and an inner frame
// really stands INSIDE its parent's, not beside it); an edge that TERMINATES on a frame is a port and an
// edge that PASSES THROUGH one is a crossing; a pointer on a frame resolves to the group; a frame the
// window would cut is never painted half; and a panel too narrow for boxes reports every group COLLAPSED
// rather than drawing a side of one.
//
// THE FIXTURES ARE SYNTHETIC ON PURPOSE. A live team's board changes under the test, and every claim
// here is about the DRAWING's arithmetic, not about what a workspace happened to hold: the rows below
// are the smallest board that exercises each rule, with the served columns spelled out so the picture is
// a function of this file alone.
import { describe, expect, test } from "bun:test"

import { cellWidth } from "../src/sanitize"
import { DAG_CHARS, DAG_CHARS_ONE_CELL, DAG_GROUP_CHARS, DAG_GROUP_CHARS_ONE_CELL } from "../src/dag-theme"
import { hitTest, hitTestGroup, layoutBoxesNatural, type GraphTask, type GraphView } from "../src/graph"
import { dagPanelLayout, dagRowClick, halfGroupCells } from "../src/panel-dag"
import type { GraphGroup } from "../../mpd-graph-core/src/types.ts"

/** One row of a synthetic board: a task, its blockers and the group frame it draws inside. */
const task = (id: string, dependencies: string[], depth: number, group?: string): GraphTask =>
  ({ id, subject: id, visual: "open", dependencies, depth, ...(group === undefined ? {} : { group }) })

/**
 * The SHALLOW fixture: two root tasks and one subcell whose interior is a real chain.
 *
 * The edges are the model's own post-attachment shape — `T1 → T2` in the root frame, `T2 → B1` lifted to
 * the box (`T2 → teamB`), and `B1 → B2 → B3` inside it — which is why the drawing is asserted against
 * exactly that input rather than against a board's raw `blockedBy` lists.
 */
const SHALLOW_TASKS: readonly GraphTask[] = [
  task("T1", [], 0),
  task("T2", ["T1"], 1),
  task("B1", ["T2"], 0, "teamB"),
  task("B2", ["B1"], 1, "teamB"),
  task("B3", ["B2"], 2, "teamB"),
  task("T3", ["B3"], 3),
]

/**
 * The SAME board in the PANEL's row type, which adds the two fields the page reads beside the drawing.
 *
 * The page's projection is the only producer of these rows in a real session (`dagPanelOf`), and it
 * always fills `failedDependencies`; the fixture does the same so an arm can never pass merely because a
 * field the page reads happened to be missing.
 */
const PANEL_TASKS = SHALLOW_TASKS.map((row) => ({ ...row, failedDependencies: [] as string[] }))

/** The single top-level subcell of {@link SHALLOW_TASKS}. */
const SHALLOW_GROUPS: readonly GraphGroup[] = [
  { id: "teamB", label: "teamB", parentId: null, memberIds: ["B1", "B2", "B3"], depth: 0 },
]

/** The SERVED column of every box of {@link SHALLOW_TASKS}, exactly as a model publishes it. */
const SHALLOW_RANKS: ReadonlyMap<string, number> = new Map([
  ["T1", 0], ["T2", 1], ["teamB", 2], ["B1", 0], ["B2", 1], ["B3", 2], ["T3", 3],
])

/** The NESTED fixture: a subcell drawn inside another subcell, so the recursion has two levels. */
const NESTED_TASKS: readonly GraphTask[] = [
  task("T1", [], 0),
  task("B1", ["T1"], 0, "teamB"),
  task("C1", ["B1"], 0, "teamC"),
  task("C2", ["C1"], 1, "teamC"),
]

/** The two frames of {@link NESTED_TASKS}: `teamC` is drawn inside `teamB`'s box. */
const NESTED_GROUPS: readonly GraphGroup[] = [
  { id: "teamB", label: "teamB", parentId: null, memberIds: ["B1", "teamC"], depth: 0 },
  { id: "teamC", label: "teamC", parentId: "teamB", memberIds: ["C1", "C2"], depth: 1 },
]

/** The served columns of {@link NESTED_TASKS}. */
const NESTED_RANKS: ReadonlyMap<string, number> = new Map([
  ["T1", 0], ["teamB", 1], ["B1", 0], ["teamC", 1], ["C1", 0], ["C2", 1],
])

/**
 * One view's rows as plain strings.
 * @param view - the drawing.
 * @returns one string per drawn row.
 */
const rowsOf = (view: GraphView): string[] => view.lines.map((row) => row.map((span) => span.text).join(""))

/**
 * The drawing of the shallow fixture, which most arms below assert against.
 * @returns the view, which the fixture must be able to draw.
 */
const shallowView = (): GraphView => {
  /** The drawing under test. */
  const view = layoutBoxesNatural(SHALLOW_TASKS, undefined, undefined, SHALLOW_RANKS, SHALLOW_GROUPS)
  if (view === undefined) throw new Error("the shallow fixture must draw")
  return view
}

describe("D3 · the group frame's glyph family", () => {
  test("every glyph is exactly ONE CELL, and the family is DISJOINT from the node family", () => {
    /** The family's values with their own member names, for a readable failure. */
    const entries = Object.entries(DAG_GROUP_CHARS) as Array<[string, string]>
    expect(entries.length).toBeGreaterThan(10)
    for (const [name, glyph] of entries) {
      expect([...glyph].length).toBe(1)
      expect(`${name}:${cellWidth(glyph)}`).toBe(`${name}:1`)
    }
    // The two families must not share a glyph: "visually distinct" is a claim about this data too.
    /** The node family's values. */
    const nodeGlyphs = new Set(Object.values(DAG_CHARS) as string[])
    for (const [name, glyph] of entries) expect(`${name}:${nodeGlyphs.has(glyph)}`).toBe(`${name}:false`)
    expect(DAG_GROUP_CHARS_ONE_CELL).toBe(true)
    expect(DAG_CHARS_ONE_CELL).toBe(true)
  })

  test("the frame is DOUBLE-LINED while the node box stays the rounded single-line set", () => {
    // Spelled as code points so a table that quietly reverted to the node family reddens here.
    expect(DAG_GROUP_CHARS.cornerDownRight).toBe("╔")
    expect(DAG_GROUP_CHARS.cornerDownLeft).toBe("╗")
    expect(DAG_GROUP_CHARS.cornerUpRight).toBe("╚")
    expect(DAG_GROUP_CHARS.cornerUpLeft).toBe("╝")
    expect(DAG_GROUP_CHARS.horizontal).toBe("═")
    expect(DAG_GROUP_CHARS.vertical).toBe("║")
    expect(DAG_CHARS.cornerDownRight).toBe("╭")
  })

  test("the two edge roles are DIFFERENT glyphs, and each is the box-drawing character for its role", () => {
    // A crossing is a SINGLE line through a DOUBLE one; a port is a single stub meeting a double side.
    expect(DAG_GROUP_CHARS.crossVertical).toBe("╫")
    expect(DAG_GROUP_CHARS.crossHorizontal).toBe("╪")
    expect(DAG_GROUP_CHARS.portUp).toBe("╧")
    expect(DAG_GROUP_CHARS.portDown).toBe("╤")
    expect(DAG_GROUP_CHARS.crossVertical).not.toBe(DAG_GROUP_CHARS.portUp)
    expect(DAG_GROUP_CHARS.crossVertical).not.toBe(DAG_GROUP_CHARS.portDown)
  })
})

describe("D3 · a nested model draws its frame", () => {
  test("the frame is drawn around its interior, and it spans EVERY interior row", () => {
    /** The drawing under test. */
    const view = shallowView()
    /** The frame the drawing reported. */
    const frame = view.groups?.[0]
    expect(frame?.groupId).toBe("teamB")
    /** The rows. */
    const rows = rowsOf(view)
    // The frame's top side carries its title, between two double corners.
    expect(rows[frame?.row as number]).toContain("╔")
    expect(rows[frame?.row as number]).toContain("╗")
    // THE PORT OUTRANKS THE TITLE, WHICH IS THE DECLARED TRADE: a port carries a dependency and a title
    // carries a name, so where they collide the port takes the cell and the title's remaining characters
    // read on either side of it. This arm pins the SUBSEQUENCE, so a drawing that dropped the title
    // entirely (or moved it off the border) reddens here.
    /** The top side with the port's own cell removed. */
    const title = (rows[frame?.row as number] ?? "").split(DAG_GROUP_CHARS.portUp).join("")
    expect(title).toContain("tea")
    expect(title).toContain("B")
    expect(title.indexOf("tea")).toBeLessThan(title.lastIndexOf("B"))
    // The bottom side is a solid double rule, and the sides really run the whole way down.
    expect(rows[frame?.rowEnd as number]).toContain("╚")
    expect(rows[frame?.rowEnd as number]).toContain("╝")
    for (let row = (frame?.row as number) + 1; row < (frame?.rowEnd as number); row += 1) {
      expect(`${row}:${rows[row]?.[frame?.col as number]}`).toBe(`${row}:║`)
      expect(`${row}:${rows[row]?.[frame?.colEnd as number]}`).toBe(`${row}:║`)
    }
  })

  test("the frame's interior is the subcell's OWN DAG: its tasks and its arrows are inside the box", () => {
    /** The drawing under test. */ const view = shallowView()
    /** The frame. */ const frame = view.groups?.[0]
    /** The interior rows. */ const rows = rowsOf(view)
    /** The interior's text, which must hold the inner board and none of the outer one. */
    const inside = rows.slice((frame?.row as number) + 1, frame?.rowEnd as number).join("\n")
    expect(inside).toContain("B1")
    expect(inside).toContain("B2")
    expect(inside).toContain("B3")
    expect(inside).not.toContain("T1")
    expect(inside).not.toContain("T3")
  })

  test("a NESTED frame stands strictly INSIDE its parent, and the two never exchange a cell", () => {
    /** The nested drawing. */ const view = layoutBoxesNatural(NESTED_TASKS, undefined, undefined, NESTED_RANKS, NESTED_GROUPS)
    if (view === undefined) throw new Error("the nested fixture must draw")
    /** The outer frame. */ const outer = view.groups?.find((frame) => frame.groupId === "teamB")
    /** The inner frame. */ const inner = view.groups?.find((frame) => frame.groupId === "teamC")
    expect(outer === undefined || inner === undefined).toBe(false)
    expect((inner?.row as number) > (outer?.row as number)).toBe(true)
    expect((inner?.rowEnd as number) < (outer?.rowEnd as number)).toBe(true)
    expect((inner?.col as number) > (outer?.col as number)).toBe(true)
    expect((inner?.colEnd as number) < (outer?.colEnd as number)).toBe(true)
  })

  test("a group the tree cannot place is COLLAPSED and reported, never drawn as a half box", () => {
    /** A board whose only group names a parent nothing declares. */
    const orphans: readonly GraphGroup[] = [{ id: "teamX", label: "teamX", parentId: "missing", memberIds: [], depth: 3 }]
    /** The drawing: no placeable frame, so the flat picture is the honest one. */
    const view = layoutBoxesNatural([task("A", [], 0), task("B", ["A"], 1)], undefined, undefined, undefined, orphans)
    // The flat path drew it, so there is nothing to report and no frame was invented.
    expect(view?.groups === undefined || view?.groups.length === 0).toBe(true)
    expect(view?.collapsedGroups).toContain("teamX")
  })
})

describe("D3 · an edge CROSSES or TERMINATES, and the picture says which", () => {
  test("an outside dependency TERMINATES on the box: the port glyph, and the arrow above it", () => {
    /** The drawing under test. */ const view = shallowView()
    /** The rows. */ const rows = rowsOf(view)
    /** The frame. */ const frame = view.groups?.[0]
    /** The frame's top row. */ const top = rows[frame?.row as number] ?? ""
    // `T2` blocks the box, and its own inner endpoint is deeper than the box — the arrival is a PORT.
    expect(top).toContain(DAG_GROUP_CHARS.portUp)
    // The arrowhead that points at the port stands one row above the box's top side.
    expect(rows[(frame?.row as number) - 1] ?? "").toContain(DAG_CHARS.arrowDown)
  })

  test("a dependency LEAVING the box PASSES THROUGH its side: the crossing glyph, not a port", () => {
    /** The drawing under test. */ const view = shallowView()
    /** The rows. */ const rows = rowsOf(view)
    /** The frame. */ const frame = view.groups?.[0]
    // `B3` blocks the root task `T3`, so the line leaves the box: at the bottom side it is a crossing.
    expect(rows[frame?.rowEnd as number] ?? "").toContain(DAG_GROUP_CHARS.crossVertical)
  })

  test("a board with NO groups draws exactly the flat picture, byte for byte", () => {
    /** The flat drawing, asked for with no groups at all. */
    const bare = layoutBoxesNatural(SHALLOW_TASKS, undefined, undefined, SHALLOW_RANKS)
    /** The same drawing, asked for with an EMPTY group list. */
    const empty = layoutBoxesNatural(SHALLOW_TASKS, undefined, undefined, SHALLOW_RANKS, [])
    expect(rowsOf(bare as GraphView)).toEqual(rowsOf(empty as GraphView))
    // And neither of them painted a frame glyph.
    expect(rowsOf(bare as GraphView).join("\n")).not.toContain(DAG_GROUP_CHARS.cornerDownRight)
  })
})

describe("D3 · the group hit identity", () => {
  test("a cell on or inside a frame resolves to the INNERMOST group that holds it", () => {
    /** The nested drawing. */ const view = layoutBoxesNatural(NESTED_TASKS, undefined, undefined, NESTED_RANKS, NESTED_GROUPS) as GraphView
    /** The outer frame. */ const outer = view.groups?.find((frame) => frame.groupId === "teamB")
    /** The inner frame. */ const inner = view.groups?.find((frame) => frame.groupId === "teamC")
    // A corner of the outer box is the outer group; a corner of the inner box is the inner one.
    expect(hitTestGroup(view, outer?.row as number, outer?.col as number)).toBe("teamB")
    expect(hitTestGroup(view, inner?.row as number, inner?.col as number)).toBe("teamC")
    // A cell inside the inner box is still the INNER group, which is what "innermost" buys.
    expect(hitTestGroup(view, ((inner?.row as number) + 1), ((inner?.col as number) + 1))).toBe("teamC")
  })

  test("outside every frame it resolves to nothing, and a task still outranks its frame", () => {
    /** The drawing under test. */ const view = shallowView()
    expect(hitTestGroup(view, 0, 0)).toBeUndefined()
    // A task's own cell is the task, never the box drawn around it.
    /** A task hit to probe with. */ const hit = view.hits[0]
    expect(hitTest(view, hit.row + 1, hit.col + 1)).toBe(hit.taskId)
  })

  test("the panel's click handler names the group when the pointer lands on a frame", () => {
    /** The drawing under test. */ const view = shallowView()
    /** The frame. */ const frame = view.groups?.[0]
    // A click on the frame's top-left corner, with the pan at zero and the pointer's own local column.
    /** The resolved click. */ const resolved = dagRowClick(view, frame?.row as number, 0, { localCol: frame?.col })
    expect(resolved.groupId).toBe("teamB")
    expect(resolved.taskId).toBeUndefined()
    expect(resolved.byColumn).toBe(true)
  })
})

describe("D3 · never half a GROUP", () => {
  test("a frame the window would CUT loses its own cells and keeps the interior's text", () => {
    /** The drawing under test. */ const view = shallowView()
    /** The frame. */ const frame = view.groups?.[0]
    // A one-row window that shows only the frame's bottom side: the frame is cut, so its rule is blanked.
    /** The cells to blank for a window of one row at the frame's bottom. */ const blank = halfGroupCells(view, 0, frame?.rowEnd as number, 1)
    expect(blank.get(frame?.rowEnd as number)?.size).toBe((frame?.colEnd as number) - (frame?.col as number) + 1)
    // An INTERIOR row of a cut frame loses only its two sides.
    /** The cells to blank for a one-row window on an interior row. */ const sideRows = halfGroupCells(view, 0, (frame?.row as number) + 1, 1)
    expect([...(sideRows.get((frame?.row as number) + 1) ?? [])].sort((left, right) => left - right)).toEqual([frame?.col as number, frame?.colEnd as number])
  })

  test("a frame WHOLLY inside the window, or wholly outside it, is left alone", () => {
    /** The drawing under test. */ const view = shallowView()
    /** The frame. */ const frame = view.groups?.[0]
    /** The height the whole drawing needs. */ const whole = view.lines.length
    // The window shows every row: nothing is cut.
    expect(halfGroupCells(view, 0, 0, whole).size).toBe(0)
    // The window is far below the drawing: nothing is drawn, so nothing is blanked.
    expect(halfGroupCells(view, 0, whole + 10, 4).size).toBe(0)
    void frame
  })
})

describe("D3 · the width guard degrades by COLLAPSING the group", () => {
  test("a narrow panel falls back to the rail/list and NAMES every group collapsed", () => {
    // EIGHT COLUMNS is below the TWO-COLUMN floor the boxes need (2 * 14 + 3), so the ladder falls
    // through to the rail/list — the width guard the contract names.
    /** The narrow rendering. */ const narrow = dagPanelLayout(PANEL_TASKS, 8, undefined, 12, SHALLOW_RANKS, SHALLOW_GROUPS)
    expect(narrow.mode === "rail" || narrow.mode === "list").toBe(true)
    expect(narrow.view.collapsedGroups).toEqual(["teamB"])
    // The collapsed rendering contains none of the frame family: the box is named, not half-painted.
    expect(rowsOf(narrow.view).join("\n")).not.toContain(DAG_GROUP_CHARS.cornerDownRight)
    expect(narrow.view.groups === undefined || narrow.view.groups.length === 0).toBe(true)
  })

  test("a panel with room draws the BOXES, and reports no collapse", () => {
    /** The wide rendering. */ const wide = dagPanelLayout(PANEL_TASKS, 60, undefined, 40, SHALLOW_RANKS, SHALLOW_GROUPS)
    expect(wide.mode).toBe("boxes")
    expect(wide.view.collapsedGroups).toBeUndefined()
    expect(wide.view.groups?.[0]?.groupId).toBe("teamB")
  })

  test("a board with NO groups keeps the pre-group fallback exactly", () => {
    /** The narrow rendering of an ungrouped board. */ const narrow = dagPanelLayout(PANEL_TASKS, 8, undefined, 12, SHALLOW_RANKS)
    expect(narrow.view.collapsedGroups).toBeUndefined()
  })
})
