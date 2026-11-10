// CONSULT NODES ON THE TUI DAG (`.mpd/plans/cellwork-consult-dag-nodes.md` §6, acceptance 5 and 7).
//
// WHAT THESE ARMS PROVE, one contract sentence each: a consult reaches the page as a DRAWING row but
// never as a board row, so `modelRows` (and with it the counts, the legend and the roster credit) is
// untouched; the row carries `group`, so a subcell's consult is drawn INSIDE that subcell's box; the
// painted label is the consult marker plus the node id; and the pinned detail body prints the consult's
// own facts — role, state, started, elapsed and the consultId — instead of ten blank task fields.
//
// THE FIXTURES ARE SYNTHETIC, for the reason `dag-groups.test.ts` states: a live board changes under a
// test, and every claim here is about the projection and the drawing, not about a workspace's contents.
import { describe, expect, test } from "bun:test"

import { DAG_CONSULT_MARKER, DAG_GHOST_MARKER } from "../src/dag-theme"
import { layoutBoxesNatural, type GraphTask, type GraphView } from "../src/graph"
import { buildFrameTree } from "../src/dag-groups"
import { dagPageOf, dagPanelLayout, pinnedDetailLines } from "../src/panel-dag"
import { modelConsults, modelRows, type TeamWorkflow } from "../src/team-state"
import type { GraphModel } from "../../mpd-graph-core/src/types.ts"

/** The instant every consult fixture starts at. */
const STARTED = Date.UTC(2026, 10, 10, 9, 0, 0)

/** One consult node as the served model carries it. */
function consultNode(id: string, extra: Partial<GraphModel["consults"] extends (infer T)[] | undefined ? T : never> = {}): NonNullable<GraphModel["consults"]>[number] {
  return {
    id,
    subject: "map the parser",
    visual: "running",
    dependencies: [],
    depth: 0,
    planned: false,
    kind: "consult",
    consultId: "consult-" + id,
    cellId: "cell-1",
    startedAt: STARTED,
    status: "running",
    assignee: "Explorer",
    ...extra,
  } as NonNullable<GraphModel["consults"]>[number]
}

/**
 * One projection carrying a served model and a two-row board.
 * @param consults - the consult nodes the model carries; omitted means this model has none.
 * @returns the workflow the page reads.
 */
function workflowOf(consults?: NonNullable<GraphModel["consults"]>): TeamWorkflow {
  /** The board rows, which the model also carries so a join is possible. */
  const board = [
    { id: "T1", subject: "Build the core", status: "completed", visual: "completed", dependencies: [], failedDependencies: [], depth: 0 },
    { id: "T2", subject: "Review it", status: "in_progress", visual: "running", dependencies: ["T1"], failedDependencies: [], depth: 1 },
  ]
  /** The served model over that board. */
  const model: GraphModel = {
    nodes: board.map((row) => ({ id: row.id, subject: row.subject, visual: row.visual, dependencies: row.dependencies, depth: row.depth, planned: false, status: row.status })),
    edges: [{ from: "T1", to: "T2", source: "board" }],
    ranks: [["T1"], ["T2"]],
    cycles: [],
    report: { boardOnly: [], planOnly: [], edgePlanOnly: [], edgeBoardOnly: [], planProblems: [], unresolved: [], ranksDerived: true },
    ...(consults === undefined ? {} : { consults }),
  }
  return {
    workspace: "/tmp/consults",
    team: { id: "team-1", name: "wave", phase: "active", staged: false, runnable: true, links: 0 },
    members: [],
    tasks: board,
    counts: { total: 2, completed: 1, inProgress: 1, pending: 0, claimed: 0, failed: 0, cancelled: 0, other: 0 },
    problems: [],
    mail: { unread: null, captainInbox: [] },
    holds: [],
    model,
  }
}

/**
 * One drawing's rows as plain strings.
 * @param view - the drawing.
 * @returns one string per drawn row.
 */
function rowsOf(view: GraphView): string[] {
  return view.lines.map((row) => row.map((span) => span.text).join(""))
}

describe("the projection: consults are DRAWING rows, never board rows", () => {
  test("`modelRows` is unchanged by a consults array, and `modelConsults` yields the consult rows", () => {
    /** A projection with one consult. */
    const workflow = workflowOf([consultNode("C1")])
    // THE TALLY SURFACE IS UNTOUCHED: the same two board rows, no consult among them.
    expect(modelRows(workflow).map((row) => row.id)).toEqual(["T1", "T2"])
    /** The consult rows. */
    const consults = modelConsults(workflow)
    expect(consults.map((row) => row.id)).toEqual(["C1"])
    expect(consults[0].consult?.consultId).toBe("consult-C1")
    expect(consults[0].consult?.state).toBe("running")
    expect(consults[0].assignee).toBe("Explorer")
    expect(consults[0].visual).toBe("running")
    // No edge and no column, by contract: a consult never participates in the derivation.
    expect(consults[0].dependencies).toEqual([])
    expect(consults[0].depth).toBe(0)
    expect(consults[0].planned).toBe(false)
  })

  test("a model with no consults yields NO consult row", () => {
    expect(modelConsults(workflowOf())).toEqual([])
  })
})

describe("the page: appended rows, unchanged tallies", () => {
  test("`dagPageOf` draws the consult beside the tasks and its total still counts the BOARD", () => {
    /** The page of a projection with one consult. */
    const page = dagPageOf(workflowOf([consultNode("C1")]))
    expect(page?.tasks.map((row) => row.id)).toEqual(["T1", "T2", "C1"])
    // THE COUNT IS THE BOARD's: two rows, not three. This is the acceptance-7 half that must not slip.
    expect(page?.total).toBe(2)
    expect(page?.completed).toBe(1)
    // A composition WITHOUT counts falls back to the BOARD too, never to the drawing's row count.
    /** The same projection WITHOUT the counts field, which is the older-host shape. */
    const bare: TeamWorkflow = { ...workflowOf([consultNode("C1")]) }
    delete (bare as { counts?: unknown }).counts
    expect(dagPageOf(bare)?.total).toBe(2)
  })

  test("the TUI's OWN frame tree files a subcell's consult into that box", () => {
    // THE FILING RULE ITSELF, not an inference from the field: `buildFrameTree` is what the boxes view
    // calls, so this arm proves the consult lands INSIDE `teamB` rather than merely beside the tasks.
    /** The frame tree of a board whose two tasks are root rows and whose consult belongs to `teamB`. */
    const tree = buildFrameTree(
      [
        { id: "T1", dependencies: [], depth: 0 },
        { id: "T2", dependencies: ["T1"], depth: 1 },
        { id: "teamB::C1", dependencies: [], depth: 0, group: "teamB" },
      ],
      [{ id: "teamB", label: "Subcell B", parentId: null, memberIds: ["teamB::C1"], depth: 0 }],
    )
    expect(tree.frameOfTask.get("teamB::C1")).toBe("teamB")
    expect(tree.frameOfTask.get("T1")).toBe(null)
    expect(tree.collapsed).toEqual([])
  })

  test("a subcell's consult carries its frame, so the page files it into the right box", () => {
    /** A page whose model holds a root consult and one inside the `teamB` box. */
    const page = dagPageOf(workflowOf([consultNode("C1"), consultNode("teamB::C1", { consultId: "consult-inner", cellId: "cell-inner", group: "teamB" })]))
    expect(page?.tasks.find((row) => row.id === "teamB::C1")?.group).toBe("teamB")
    expect(page?.tasks.find((row) => row.id === "C1")?.group).toBeUndefined()
  })
})

/** One consult row as the DRAWING takes it, with no board behind it. */
const CONSULT_TASK: GraphTask = { id: "C1", subject: "map the parser", visual: "running", dependencies: [], depth: 0, consult: { consultId: "consult-C1", state: "running", cellId: "cell-1", startedAt: STARTED } }
/** A board task of the SAME visual, so the marker is the only difference an arm can see. */
const BOARD_TASK: GraphTask = { id: "T1", subject: "Build the core", visual: "running", dependencies: [], depth: 0 }

describe("the drawing: the marker, and nothing that looks like a task", () => {

  test("a consult's label is the CONSULT marker, distinct from a ghost's and from a state glyph", () => {
    /** The drawing of both nodes. */
    const view = layoutBoxesNatural([BOARD_TASK, CONSULT_TASK])
    if (view === undefined) throw new Error("the fixture must draw")
    /** The drawn text. */
    const text = rowsOf(view).join("\n")
    expect(text).toContain(`${DAG_CONSULT_MARKER} C1`)
    // The board task keeps its STATE mark, so the marker is not simply the shape every node draws.
    expect(text).not.toContain(`${DAG_CONSULT_MARKER} T1`)
    // And the consult is not a ghost: the plan-only marker belongs to a different node family.
    expect(DAG_CONSULT_MARKER).not.toBe(DAG_GHOST_MARKER)
  })

  test("the page prefers the boxes view for a consult-bearing board, and the node is drawn", () => {
    /** The page layout at a width that affords boxes; the page's row type adds `failedDependencies`. */
    const layout = dagPanelLayout([{ ...BOARD_TASK, failedDependencies: [] }, { ...CONSULT_TASK, failedDependencies: [] }], 80)
    expect(layout.mode).toBe("boxes")
    expect(layout.view.lines.length).toBeGreaterThan(0)
  })
})

describe("the pinned detail body: a consult's own facts", () => {
  /** The panel row of one settled consult, as the page would build it. */
  const SETTLED = { ...CONSULT_TASK, failedDependencies: [], status: "complete", visual: "completed", assignee: "Explorer", consult: { consultId: "consult-C1", state: "complete", cellId: "cell-1", startedAt: STARTED, elapsedMs: 72_000 } }

  test("role, state, started, elapsed and the consultId are printed", () => {
    /** The body's rows. */
    const lines = pinnedDetailLines(SETTLED, [SETTLED], 120)
    /** The same rows as one string, which is how a reader compares them. */
    const text = lines.join("\n")
    expect(text).toContain("consult consult-C1")
    expect(text).toContain("role Explorer")
    expect(text).toContain("state complete")
    expect(text).toContain("started " + new Date(STARTED).toISOString())
    expect(text).toContain("elapsed 72s")
    expect(text).toContain("cell cell-1")
  })

  test("the TEN task facts are absent — a consult has no verdict, attempt, round or blockers", () => {
    /** The body's rows. */
    const text = pinnedDetailLines(SETTLED, [SETTLED], 120).join("\n")
    for (const label of ["verdict", "failedBy", "attempt", "round", "blockedBy", "dependents", "kind"]) expect(text).not.toContain(label)
  })

  test("R7.7: a malformed instant or span degrades to a dash, never a RangeError", () => {
    // The value comes from a PERSISTED team record: 8.7e15 is finite and outside the ECMAScript date
    // range, so `Number.isFinite` alone let `toISOString()` throw and broke the whole pinned body.
    /** The settled fixture with an out-of-range start and a non-finite span. */
    const malformed = { ...SETTLED, consult: { ...SETTLED.consult, startedAt: 8.7e15, elapsedMs: Number.POSITIVE_INFINITY } }
    /** The body's text; a throw here fails the arm with the RangeError itself. */
    const text = pinnedDetailLines(malformed, [malformed], 120).join("\n")
    expect(text).toContain("started —")
    expect(text).toContain("elapsed —")
  })

  test("a running consult prints no elapsed time rather than a fabricated one", () => {
    /** The body of the running fixture. */
    const text = pinnedDetailLines({ ...CONSULT_TASK, failedDependencies: [] }, [], 120).join("\n")
    expect(text).toContain("elapsed —")
  })
})
