// THE DEPENDENCY GRAPH (W3): the drawing behind the team scene.
//
// The module is pure — it takes a board and a width and returns text plus tones — so the whole
// drawing is asserted here without a terminal, a React reconciler or a team. The arms are the ones
// that would let a regression hide:
//   * the drawing FITS the width it is given, at every width, because a graph that overflows its
//     scene is worse than no graph;
//   * a MERGE is drawn, not lost — a task with two blockers is the shape a flat list cannot show,
//     and the junctions where two edges meet are what this module exists for;
//   * the focus lights the task, its transitive DEPENDENCIES and the edges between them, and dims
//     everything else — while a state the focus did not touch keeps its own colour;
//   * a pointer resolves to a task by RECTANGLE, because the module computes the geometry and a
//     second layout could drift from it.
import { describe, expect, test } from "bun:test"

import {
  GRAPH_THEME,
  cycleIds,
  dependencyChain,
  hitTest,
  layoutBoxes,
  layoutGraph,
  layoutList,
  layoutRail,
  legendLines,
  type GraphHit,
  type GraphTask,
  type GraphSpan,
} from "../src/graph"
import { cellWidth } from "../src/sanitize"

/** One task, with the fields a fixture cares about and sane defaults for the rest. */
function task(id: string, depth: number, dependencies: string[] = [], extra: Partial<GraphTask> = {}): GraphTask {
  return { id, subject: "subject of " + id, kind: "work", visual: "open", dependencies, depth, ...extra }
}

/**
 * The board the arms draw: two roots, a four-wide rank, a merge and a failure.
 *
 *   T1 REQ ─┬─► T3 WRK ─┬─► T7 REV ─┐
 *   T2 REQ ─┘           └─► T8 REV ─┴─► T9 INT
 *           └─► T4 WRK ──► T6 FIX (failed)
 *   T5 WRK (blocked by nothing, running)
 */
const BOARD: GraphTask[] = [
  task("T1", 0, [], { kind: "requirement", visual: "completed", assignee: "lead", subject: "split the team plane" }),
  task("T2", 0, [], { kind: "requirement", visual: "completed", assignee: "lead", subject: "web sidebar adapters" }),
  task("T3", 1, ["T1"], { visual: "running", assignee: "Senior Engineer", attempt: 2 }),
  task("T4", 1, ["T2"], { visual: "open" }),
  task("T5", 1, ["T1"], { visual: "blocked" }),
  task("T6", 2, ["T4"], { visual: "failed", kind: "repair" }),
  task("T7", 2, ["T3"], { visual: "open", kind: "review" }),
  task("T8", 2, ["T3"], { visual: "open", kind: "review" }),
  task("T9", 3, ["T7", "T8"], { visual: "open", kind: "integration" }),
]

/** The visible text of one row, joined — the form every assertion below reads. */
const flat = (spans: readonly GraphSpan[]): string => spans.map((span) => span.text).join("")

/** The whole drawing as plain lines. */
const linesOf = (view: { lines: GraphSpan[][] }): string[] => view.lines.map(flat)

/** Every tone used anywhere in a drawing. */
const tonesOf = (view: { lines: GraphSpan[][] }): Set<string> => new Set(view.lines.flat().map((span) => span.tone))

/** The CENTRE column of a task's box, derived from the rectangle the drawing itself recorded. */
function centreOf(view: { hits: GraphHit[] }, id: string): number {
  /** This task's rectangle; a drawn task has exactly one. */
  const hit = view.hits.find((entry) => entry.taskId === id) as GraphHit
  // THE BOX'S MID-LINE, which for an EVEN width is its LEFT-middle cell — the cell the drawing itself
  // enters from, and the one a `▼` above the border reads as centred. This an odd-width formula that
  // rounded the other way, and it disagreed with the drawing by one column on every even-width box.
  return Math.floor((hit.col + hit.colEnd) / 2)
}

/** The cell column of the first `glyph` in a row, or -1 when the row does not carry it. */
function colOf(spans: readonly GraphSpan[], glyph: string): number {
  /** Cells consumed by the spans already read. */
  let at = 0
  for (const span of spans) {
    /** Where the glyph sits inside this span, or -1 when it is in another one. */
    const index = span.text.indexOf(glyph)
    if (index >= 0) return at + cellWidth(span.text.slice(0, index))
    at += cellWidth(span.text)
  }
  return -1
}

describe("the dependency chain", () => {
  test("is TRANSITIVE and UPSTREAM only, and cannot spin on a cycle", () => {
    // T9 <- T7,T8 <- T3 <- T1. The T2 -> T4 -> T6 line is a DIFFERENT branch and is deliberately
    // absent: a chain that swept the whole board would light tasks the focus does not rest on.
    expect([...dependencyChain(BOARD, "T9")].sort()).toEqual(["T1", "T3", "T7", "T8"])
    // A ROOT depends on nothing, and a task never appears in its own chain.
    expect([...dependencyChain(BOARD, "T1")]).toEqual([])
    expect(dependencyChain(BOARD, "T3").has("T3")).toBe(false)
    // A cycle terminates instead of hanging, which is the property that makes this safe on a
    // malformed board rather than merely correct on a sound one.
    /** A two-task cycle. */
    const cyclic = [task("A", 0, ["B"]), task("B", 0, ["A"])]
    expect([...dependencyChain(cyclic, "A")].sort()).toEqual(["A", "B"])
    expect(cycleIds(cyclic)).toEqual(["A", "B"])
  })

  test("a cycle in the BOARD is named even when nothing is focused", () => {
    /** A board whose first two tasks block each other. */
    const cyclic = [task("A", 0, ["B"]), task("B", 0, ["A"]), task("C", 0)]
    for (const view of [layoutBoxes(cyclic, 90), layoutRail(cyclic, 60), layoutList(cyclic, 60)]) {
      expect(view?.cycles).toEqual(["A", "B"])
    }
  })
})

describe("the boxed layout", () => {
  test("draws a MERGE, which is the shape a flat list cannot express", () => {
    /** The drawing at a comfortable width. */
    const view = layoutBoxes(BOARD, 100)
    expect(view).toBeDefined()
    /** The whole drawing as text. */
    const text = linesOf(view as never).join("\n")
    // Every task is drawn exactly once.
    for (const entry of BOARD) expect(text).toContain(entry.id + " ")
    // T9 has TWO blockers, and both edges arrive on its top border — which is the `┴` the mask
    // produces when a horizontal bus meets a vertical stub. Two of them, not one.
    expect((text.match(/┴/g) ?? []).length).toBeGreaterThanOrEqual(2)
    // The two review tasks hang from ONE parent, whose bottom border therefore carries a `┬`.
    expect(text).toContain("┬")
  })

  test("NEVER exceeds the width it is given, at any width that draws at all", () => {
    for (let cols = 40; cols <= 200; cols += 7) {
      /** The drawing at this width, or undefined when boxes do not fit. */
      const view = layoutBoxes(BOARD, cols)
      if (view === undefined) continue
      expect(view.width).toBeLessThanOrEqual(cols)
      for (const line of linesOf(view)) expect(line.length).toBeLessThanOrEqual(view.width)
    }
  })

  test("a box width below the minimum is REFUSED rather than squeezed", () => {
    // The refusal is what lets `layoutGraph` choose the rail as a fact about the geometry rather
    // than a guess about the terminal.
    expect(layoutBoxes(BOARD, 30)).toBeUndefined()
    expect(layoutGraph(BOARD, 30).mode).toBe("rail")
    expect(layoutGraph(BOARD, 100).mode).toBe("boxes")
  })

  test("a task shows its marker, id, kind and subject, truncated rather than wrapped", () => {
    /** The drawing at a comfortable width. */
    const view = layoutBoxes(BOARD, 100)
    /** The whole drawing as text. */
    const text = linesOf(view as never).join("\n")
    // The state glyph, the id and the kind abbreviation are all present.
    expect(text).toContain("✓ T1 REQ")
    expect(text).toContain("◐ T3 WRK")
    expect(text).toContain("✗ T6 FIX")
    expect(text).toContain("○ T5 WRK")
  })

  test("an empty board draws nothing rather than a bare frame", () => {
    /** The empty drawing. */
    const view = layoutBoxes([], 80)
    expect(view?.lines).toEqual([])
    expect(view?.hits).toEqual([])
  })
})

describe("the arrowheads", () => {
  test("an edge ENDS in a ▼ on the dependent's centre, in the cell above its box", () => {
    /** One blocker and one dependent: the smallest board that draws an edge at all. */
    const board = [task("P", 0), task("C", 1, ["P"])]
    /** The drawing. */
    const view = layoutBoxes(board, 60) as NonNullable<ReturnType<typeof layoutBoxes>>
    /** The rows as plain text, the form the arrow is asserted in. */
    const lines = linesOf(view)
    /** The blocker's rectangle, whose bottom border the edge leaves from. */
    const parent = view.hits.find((hit) => hit.taskId === "P") as GraphHit
    /** The dependent's rectangle, which fixes where its entry cell is. */
    const child = view.hits.find((hit) => hit.taskId === "C") as GraphHit
    // The entry cell is the connector cell immediately above the child's top border, and it sits on
    // the child's CENTRE column: the arrow arrives where the box is entered, not beside it.
    expect(colOf(view.lines[child.row - 1], "▼")).toBe(centreOf(view, "C"))
    // Direction is top to bottom. The blocker is drawn ABOVE — its bottom border carries the `┬` the
    // stub leaves from — and the row under the arrow is the child's top border, whose `┴` receives it.
    expect(lines[parent.rowEnd]).toContain("┬")
    expect(lines[child.row]).toContain("┴")
    expect(parent.rowEnd).toBeLessThan(child.row)
  })

  test("a FAN-IN of three blockers still shows exactly ONE ▼", () => {
    /** Three roots converging on one dependent: the shape a second arrowhead would ruin. */
    const board = [task("P1", 0), task("P2", 0), task("P3", 0), task("C", 1, ["P1", "P2", "P3"])]
    /** The drawing. */
    const view = layoutBoxes(board, 90) as NonNullable<ReturnType<typeof layoutBoxes>>
    /** The drawing as text. */
    const text = linesOf(view).join("\n")
    expect((text.match(/▼/g) ?? []).length).toBe(1)
    /** The dependent's rectangle. */
    const child = view.hits.find((hit) => hit.taskId === "C") as GraphHit
    expect(colOf(view.lines[child.row - 1], "▼")).toBe(centreOf(view, "C"))
  })

  test("a rank that no edge reaches draws no arrowhead", () => {
    /** Two ranks and NO dependency between them: a board a flat list could draw just as well. */
    const board = [task("A", 0), task("B", 1)]
    expect(linesOf(layoutBoxes(board, 60) as never).join("\n")).not.toContain("▼")
  })

  test("every drawn row fits its width, keeps no trailing blank, and collapses same-tone runs", () => {
    for (const cols of [24, 40, 70, 100]) {
      /** The view the preference picks at this width: boxes when they fit, the rail otherwise. */
      const view = layoutGraph(BOARD, cols)
      for (const line of linesOf(view)) expect(cellWidth(line)).toBeLessThanOrEqual(cols)
      // A drawing's right edge is its last glyph: padding a row out to the viewport is what makes a
      // scene's copy/paste and its hover rectangles disagree with what is on screen.
      for (const line of linesOf(view)) expect(line === "" || /\s$/u.test(line)).toBe(false)
      // The run-collapse step is what keeps a mostly-background row from becoming ~100 host elements
      // on every re-render, so two ADJACENT spans of one tone mean the collapse stopped working.
      // Only the boxes view runs that step; the rail assembles its own three spans per row.
      if (view.mode !== "boxes") continue
      for (const line of view.lines) {
        for (let at = 1; at < line.length; at++) expect(line[at].tone).not.toBe(line[at - 1].tone)
      }
    }
  })
})

describe("the focus", () => {
  test("lights the task, its DEPENDENCIES and the edges between them; dims the rest", () => {
    /** The drawing with T9 focused. */
    const view = layoutBoxes(BOARD, 100, "T9") as ReturnType<typeof layoutBoxes> & object
    expect(view).toBeDefined()
    expect(view.focus).toBe("T9")
    expect([...view.chain].sort()).toEqual(["T1", "T3", "T7", "T8"])
    /** The tone of the span holding each task's id. */
    const toneOfTask = (id: string): string | undefined => {
      for (const line of view.lines) for (const span of line) if (span.text.includes(id + " ")) return span.tone
      return undefined
    }
    // The focus itself is the loudest tone there is.
    expect(toneOfTask("T9")).toBe("focus")
    // A dependency keeps its OWN state colour while it is lit — that is what makes the chain
    // readable as STATES rather than as one undifferentiated highlight.
    expect(toneOfTask("T1")).toBe("completed")
    expect(toneOfTask("T3")).toBe("running")
    expect(toneOfTask("T7")).toBe("open")
    // And a task OUTSIDE the chain is dimmed EVEN WHEN ITS OWN STATE IS LOUD: T6 has failed, and it
    // is dimmed here because it rests on nothing the focus rests on. Dimming has to outrank the
    // state or a focus would not narrow anything — the whole board would stay equally loud.
    expect(toneOfTask("T6")).toBe("dim")
    expect(tonesOf(view).has("dim")).toBe(true)
  })

  test("the edge between two chain members is BRIGHT, and an edge leaving the chain is not", () => {
    /** The drawing with T9 focused. */
    const view = layoutBoxes(BOARD, 100, "T9")
    /** The tones used by connector glyphs alone, which carry no label. */
    const connectorTones = new Set(view?.lines.flat().filter((span) => /^[│─┌┐└┘├┤┬┴┼ ]+$/.test(span.text) && span.text.trim() !== "").map((span) => span.tone))
    expect(connectorTones.has("chain")).toBe(true)
    expect(connectorTones.has("dim")).toBe(true)
  })

  test("with NO focus nothing is dimmed and nothing is a chain", () => {
    /** The drawing with nothing focused. */
    const view = layoutBoxes(BOARD, 100)
    /** Every tone the unfocused drawing uses. */
    const tones = tonesOf(view as never)
    expect(tones.has("dim")).toBe(false)
    expect(tones.has("chain")).toBe(false)
    expect(tones.has("focus")).toBe(false)
    // Every state present on the board is still drawn in its own colour.
    expect(tones.has("completed")).toBe(true)
    expect(tones.has("running")).toBe(true)
    expect(tones.has("failed")).toBe(true)
    expect(tones.has("blocked")).toBe(true)
  })

  test("the focus is marked with ▶ so it is findable without colour", () => {
    expect(linesOf(layoutBoxes(BOARD, 100, "T3") as never).join("\n")).toContain("▶ T3")
    expect(linesOf(layoutRail(BOARD, 80, "T3")).join("\n")).toContain("▶ T3")
    expect(linesOf(layoutList(BOARD, 80, "T3")).join("\n")).toContain("▶ T3")
  })
})

describe("the rail fallback", () => {
  test("fits any width and never loses a task", () => {
    for (const cols of [24, 40, 60, 80]) {
      /** The rail at this width. */
      const view = layoutRail(BOARD, cols)
      /** The drawing as text. */
      const text = linesOf(view).join("\n")
      for (const entry of BOARD) expect(text).toContain(entry.id)
      for (const line of linesOf(view)) expect(line.length).toBeLessThanOrEqual(cols)
    }
  })

  test("names the EXTRA blockers instead of drawing a second connector", () => {
    /** The rail, whose T9 has two blockers and therefore carries the inline suffix. */
    /** The rail as text. */
    const text = linesOf(layoutRail(BOARD, 90)).join("\n")
    expect(text).toContain("⇠ T7+T8")
  })

  test("the connector points INTO the task, and keeps naming the extra blockers", () => {
    /** One blocker with two dependents, so the rail draws both an elbow and a tee. */
    const board = [task("P", 0), task("A", 1, ["P"]), task("B", 1, ["P"])]
    /** The rail as text. */
    const text = linesOf(layoutRail(board, 60)).join("\n")
    expect(text).toContain("├─▸")
    expect(text).toContain("└─▸")
    // The arrow must not have displaced the inline extra-blocker marker: T9 has two blockers and the
    // rail names the one it does not hang under.
    /** The full board's rail, whose T9 has two blockers. */
    const wide = linesOf(layoutRail(BOARD, 90)).join("\n")
    expect(wide).toContain("└─▸")
    expect(wide).toContain("⇠ T7+T8")
  })

  test("draws a task reached by no root, so a cycle cannot silently lose a row", () => {
    /** A board whose only tasks block each other. */
    const cyclic = [task("A", 0, ["B"]), task("B", 0, ["A"])]
    /** The rail, which must still show both. */
    const text = linesOf(layoutRail(cyclic, 60)).join("\n")
    expect(text).toContain("A")
    expect(text).toContain("B")
  })
})

describe("the list view", () => {
  test("groups by rank and names every blocker", () => {
    /** The list at a comfortable width. */
    const text = linesOf(layoutList(BOARD, 90)).join("\n")
    expect(text).toContain("rank 0")
    expect(text).toContain("rank 3")
    expect(text).toContain("⇠T7,T8")
  })
})

describe("the legend", () => {
  test("names both directional marks, the five states and the focus marker, in two lines", () => {
    /** The legend at a width the team scene actually gets. */
    const lines = legendLines(100)
    expect(lines.length).toBe(2)
    // The arrow sentence, pinned: it names BOTH marks — the boxes `▼` and the rail `▸` — because
    // which view draws is a fact about the WIDTH, so a rail reader must not meet an undescribed
    // marker. The focus marker rides on the same line.
    expect(lines[0]).toBe("▼/▸ blocker above → dependent below · ▶ focus lights its chain")
    // The state key, read out of the GLYPH table — the drawing's own marks, not a second spelling.
    for (const pair of ["✓ completed", "◐ running", "○ open", "✗ failed", "⊘ cancelled"]) expect(lines[1]).toContain(pair)
  })

  test("shortens rather than cutting a sentence, naming BOTH marks on every rung", () => {
    for (const cols of [12, 20, 40, 60, 70, 100]) {
      /** The legend at this width. */
      const lines = legendLines(cols)
      expect(lines.length).toBeGreaterThan(0)
      expect(lines.length).toBeLessThanOrEqual(2)
      // Whichever rung this width selected, the arrow line still names the boxes arrow AND the rail
      // marker: the rail is the view a 24-cell scene actually draws.
      expect(lines[0]).toContain("▼")
      expect(lines[0]).toContain("▸")
      for (const line of lines) expect(cellWidth(line)).toBeLessThanOrEqual(cols)
    }
    // The ladder SHORTENS as the scene narrows: less is said, nothing is cut mid-sentence. At 60 the
    // full rung (62 cells) no longer fits, which is exactly what the next rung is for.
    expect(legendLines(100)[0]).toContain("focus lights its chain")
    expect(legendLines(20)[0]).toBe("▼/▸ arrow · ▶ focus")
    // The guard is 8 cells, but even the tersest rung needs 9 — below that there is no honest legend
    // at all, because a lone mark would be a riddle rather than a key.
    expect(legendLines(9)[0]).toBe("▼/▸ arrow")
    expect(legendLines(8)).toEqual([])
    expect(legendLines(4)).toEqual([])
    expect(legendLines(0)).toEqual([])
    expect(legendLines(Number.NaN)).toEqual([])
  })
})

describe("the pointer", () => {
  test("resolves to a task by RECTANGLE, and to nothing on blank space", () => {
    /** The drawing under test. */
    const view = layoutBoxes(BOARD, 100) as ReturnType<typeof layoutBoxes> & object
    /** One recorded rectangle. */
    const hit = view.hits[0]
    expect(hitTest(view, hit.row, hit.col)).toBe(hit.taskId)
    expect(hitTest(view, hit.rowEnd, hit.colEnd)).toBe(hit.taskId)
    // A row past the drawing, and a column past its right edge, are both misses.
    expect(hitTest(view, 999, 0)).toBeUndefined()
    expect(hitTest(view, hit.row, 9999)).toBeUndefined()
  })

  test("uses the SAME geometry the rail drew, so the two cannot drift", () => {
    /** The rail under test. */
    const view = layoutRail(BOARD, 80)
    // Every task has exactly one rectangle, and each resolves to itself.
    expect(view.hits.length).toBe(BOARD.length)
    for (const hit of view.hits) expect(hitTest(view, hit.row, 0)).toBe(hit.taskId)
  })
})

describe("the tone table", () => {
  test("every tone maps to a dsh-tui THEME KEY, never to a colour literal", () => {
    // The drawing must follow the terminal's palette, so a tone is a MEANING and the table is the
    // only place a host key is named.
    /** The keys the host's own theme declares for this purpose. */
    const allowed = new Set(["success", "activity", "error", "warning", "inactive", "subtle", "accentShimmer", "promptBorder", "accent", "text"])
    for (const [tone, key] of Object.entries(GRAPH_THEME)) {
      expect(allowed.has(key)).toBe(true)
      expect(key.startsWith("#")).toBe(false)
    }
    // The three states that must never be confused are three DIFFERENT keys.
    expect(new Set([GRAPH_THEME.completed, GRAPH_THEME.running, GRAPH_THEME.failed, GRAPH_THEME.blocked]).size).toBe(4)
    // A dimmed task and a cancelled one share the muted key on purpose: both mean "not in play".
    expect(GRAPH_THEME.dim).toBe(GRAPH_THEME.cancelled)
    // `blank` exists so an untouched cell is not labelled "dimmed": a drawing is mostly background,
    // and calling that dim would drown the signal the focus actually produces.
    expect(GRAPH_THEME.blank).toBe("text")
  })
})
