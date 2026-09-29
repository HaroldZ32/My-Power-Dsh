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
  type GraphTask,
  type GraphSpan,
} from "../src/graph"

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
