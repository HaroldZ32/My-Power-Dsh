// THE GROUP CONCEPT AGAINST THE FROZEN CONTRACT (`.mpd/plans/cellwork-w4-contract.md` D1).
//
// Every arm here is one of the contract's own sentences made executable: the model stays PLAIN JSON and
// byte-deterministic, the attachment rule holds in all three of its cases (one endpoint inside, both
// inside, one in each of two groups), the spawn edge from `originTaskId` is DERIVED rather than
// authored, each frame is ranked as its own model while the outer frame ranks the boxes, and a build
// with no group is BYTE-IDENTICAL to the flat model that predates groups.
import { describe, expect, test } from "bun:test"

import { buildModel } from "../src/index.ts"
import type { BoardTask, GraphModel, GraphNode, PlanDocument, PlanTask } from "../src/types.ts"

/** One board row with the fields the merge reads; the subject is derived so a fixture stays cheap. */
function boardTask(id: string, extra: Partial<BoardTask> = {}): BoardTask {
  return { id, subject: "subject of " + id, ...extra }
}

/** One plan task with the fields the merge reads; the section and line are fixed by the fixture. */
function planTask(id: string, title: string, blockedBy: string[] = []): PlanTask {
  return { id, title, section: "todo", line: 1, blockedBy }
}

/** A plan document built from hand-written tasks, with no lane table and no problems. */
function planOf(tasks: PlanTask[]): PlanDocument {
  return { tasks, lanes: [], problems: [] }
}

/**
 * The subcell every arm below nests: two own tasks, one of which the parent frame blocks.
 * @returns a group input with a board and a spawn origin, fresh per call.
 */
function subcell(): { id: string; label: string; originTaskId: string; board: BoardTask[] } {
  return {
    id: "teamB",
    label: "Subcell B",
    originTaskId: "T2",
    board: [boardTask("B1", { status: "in_progress", blockedBy: ["T1"] }), boardTask("B2", { blockedBy: ["B1"] })],
  }
}

/**
 * A two-level fixture: a root frame with two tasks plus a subcell blocked by both of them.
 * @returns the model the grouped arms inspect.
 */
function groupedModel(): GraphModel {
  return buildModel({
    board: [boardTask("T1", { status: "completed" }), boardTask("T2", { status: "in_progress", blockedBy: ["T1"] })],
    groups: [subcell()],
  })
}

/**
 * The node with one id, so an assertion names the field it reads instead of an index.
 * @param model - the model under test.
 * @param id - the node id.
 * @returns the node; the test fails here when it is missing.
 */
function nodeOf(model: GraphModel, id: string): GraphNode {
  /** The node the model carries under this id. */
  const node = model.nodes.find((candidate) => candidate.id === id)
  if (node === undefined) throw new Error(`the model carries no node "${id}"`)
  return node
}

describe("backward compatibility: no groups means the FLAT model, byte for byte", () => {
  // THE PINNED BYTES. This string was produced by the model before the group concept existed; a change
  // that adds a key, reorders a field or moves a rank reddens here instead of in a renderer.
  const PINNED_FLAT_MODEL = '{"nodes":[{"id":"T1","subject":"subject of T1","visual":"completed","dependencies":[],"depth":0,"planned":false,"title":"one","status":"completed"},{"id":"T2","subject":"subject of T2","visual":"running","dependencies":["T1"],"depth":1,"planned":false,"title":"two","status":"in_progress"}],"edges":[{"from":"T1","to":"T2","source":"both"}],"ranks":[["T1"],["T2"]],"cycles":[],"report":{"boardOnly":[],"planOnly":[],"edgePlanOnly":[],"edgeBoardOnly":[],"planProblems":[],"unresolved":[],"ranksDerived":true}}'

  /** The flat fixture the pin was measured on: agreeing edges, a completed row and a running one. */
  const board = [boardTask("T1", { status: "completed" }), boardTask("T2", { status: "in_progress", blockedBy: ["T1"] })]
  /** The plan that agrees with that board, so the report carries no disagreement. */
  const plan = planOf([planTask("T1", "one"), planTask("T2", "two", ["T1"])])

  test("the serialized model equals the bytes the pre-group model produced", () => {
    expect(JSON.stringify(buildModel({ board, plan }))).toBe(PINNED_FLAT_MODEL)
  })

  test("no group key leaks into the model or into any node", () => {
    /** The model under test. */
    const model = buildModel({ board, plan })
    expect(Object.prototype.hasOwnProperty.call(model, "groups")).toBe(false)
    expect(model.nodes.every((node) => !("group" in node))).toBe(true)
  })

  test("an EMPTY groups array is the same model as no groups at all", () => {
    expect(JSON.stringify(buildModel({ board, plan, groups: [] }))).toBe(JSON.stringify(buildModel({ board, plan })))
  })
})

describe("plain JSON and determinism", () => {
  test("a grouped model round-trips through JSON unchanged", () => {
    /** The model under test. */
    const model = groupedModel()
    expect(model.groups?.length).toBe(1)
    expect(JSON.parse(JSON.stringify(model))).toEqual(model)
  })

  test("the same grouped input builds the same model whatever order it arrives in", () => {
    /** A root frame whose rows and group arrive in the opposite order. */
    const reversed = buildModel({
      board: [boardTask("T2", { status: "in_progress", blockedBy: ["T1"] }), boardTask("T1", { status: "completed" })],
      groups: [{ ...subcell(), board: [boardTask("B2", { blockedBy: ["B1"] }), boardTask("B1", { status: "in_progress", blockedBy: ["T1"] })] }],
    })
    expect(JSON.stringify(reversed)).toBe(JSON.stringify(groupedModel()))
  })
})

describe("the attachment rule", () => {
  test("one endpoint inside a group and the other outside: the edge is re-anchored to the box", () => {
    /** The model under test. */
    const model = groupedModel()
    expect(model.edges).toContainEqual({ from: "T1", to: "teamB", source: "board" })
    // The inside endpoint keeps its OWN declared reference — the drawing reads the frame, not the line.
    expect(nodeOf(model, "B1").dependencies).toEqual(["T1"])
    expect(nodeOf(model, "teamB").dependencies).toEqual(["T1", "T2"])
  })

  test("an edge fully inside one group keeps its two inner tasks", () => {
    /** The model under test. */
    const model = groupedModel()
    expect(model.edges).toContainEqual({ from: "B1", to: "B2", source: "board" })
    expect(model.edges.some((edge) => edge.from === "B1" && edge.to === "teamB")).toBe(false)
  })

  test("an edge between two groups becomes group→group in the frame that draws both boxes", () => {
    /** A root frame with two sibling subcells, the second blocked by a task of the first. */
    const model = buildModel({
      board: [boardTask("T1", { status: "completed" })],
      groups: [
        { id: "teamA", label: "Subcell A", board: [boardTask("A1")] },
        { id: "teamB", label: "Subcell B", board: [boardTask("B1", { blockedBy: ["A1"] })] },
      ],
    })
    expect(model.edges).toContainEqual({ from: "teamA", to: "teamB", source: "board" })
    expect(model.edges.some((edge) => edge.from === "A1" || edge.to === "B1")).toBe(false)
  })

  test("two inner tasks blocked by the same outer task draw ONE box port, not two", () => {
    /** A subcell whose two tasks both wait on the parent's first task. */
    const model = buildModel({
      board: [boardTask("T1")],
      groups: [{ id: "teamB", label: "Subcell B", board: [boardTask("B1", { blockedBy: ["T1"] }), boardTask("B2", { blockedBy: ["T1", "B1"] })] }],
    })
    expect(model.edges.filter((edge) => edge.from === "T1" && edge.to === "teamB")).toEqual([{ from: "T1", to: "teamB", source: "board" }])
  })
})

describe("ranking and cycles follow the DRAWN edges, never the authored text", () => {
  test("an outer task blocked by a task INSIDE a subcell ranks behind the box, keeping the authored ref", () => {
    /** A root task that waits for a task inside the subcell the root also holds. */
    const model = buildModel({
      board: [boardTask("T1"), boardTask("T2", { blockedBy: ["G1"] })],
      groups: [{ id: "g", label: "G", board: [boardTask("G1", { blockedBy: ["T1"] })] }],
    })
    // The drawn line is box→task: that is the structure a renderer paints and a reader ranks by.
    expect(model.edges).toContainEqual({ from: "g", to: "T2", source: "board" })
    // THE ARM DISCRIMINATES: ranking from the authored ref (which resolves to no node in the root frame)
    // would put T2 at column 0 beside the box it waits for.
    expect(nodeOf(model, "g").depth).toBe(1)
    expect(nodeOf(model, "T2").depth).toBe(2)
    expect(nodeOf(model, "T2").dependencies).toEqual(["G1"])
  })

  test("two frames that block each other across their borders are reported as a CYCLE", () => {
    /** A root task and a subcell task that each wait for the other. */
    const model = buildModel({
      board: [boardTask("T1", { blockedBy: ["G1"] })],
      groups: [{ id: "g", label: "G", board: [boardTask("G1", { blockedBy: ["T1"] })] }],
    })
    expect(model.edges).toContainEqual({ from: "g", to: "T1", source: "board" })
    expect(model.edges).toContainEqual({ from: "T1", to: "g", source: "board" })
    // Neither reference resolves inside its OWN frame, so the authored-text view sees two roots; the
    // drawn view sees a real loop and reports both ends of it.
    expect(model.cycles).toEqual(["T1", "g"])
    expect(model.nodes.every((node) => Number.isFinite(node.depth))).toBe(true)
  })
})

describe("the derived spawn edge", () => {
  test("the origin task blocks the box with source 'derived', named by neither disagreement list", () => {
    /** A root frame whose second task spawned the subcell. */
    const model = groupedModel()
    expect(model.edges).toContainEqual({ from: "T2", to: "teamB", source: "derived" })
    expect(model.report.edgeBoardOnly.some((edge) => edge.source === "derived")).toBe(false)
    expect(model.report.edgePlanOnly.some((edge) => edge.source === "derived")).toBe(false)
  })

  test("an origin naming no node is reported as unresolved and derives no edge", () => {
    /** A subcell whose origin task is not on any board. */
    const model = buildModel({ board: [boardTask("T1")], groups: [{ id: "g", label: "G", originTaskId: "T99", board: [boardTask("G1")] }] })
    expect(model.report.unresolved).toEqual(["T99"])
    expect(model.edges.some((edge) => edge.source === "derived")).toBe(false)
  })

  test("an origin inside the subcell it spawned draws nothing at all", () => {
    /** A subcell whose origin names one of its OWN tasks. */
    const model = buildModel({ board: [boardTask("T1")], groups: [{ id: "g", label: "G", originTaskId: "G1", board: [boardTask("G1")] }] })
    expect(model.edges.some((edge) => edge.source === "derived")).toBe(false)
    expect(model.report.unresolved).toEqual([])
  })
})

describe("nesting", () => {
  /** A three-level tree: root → teamB → teamB1, each level blocked by the one above. */
  function nested(): GraphModel {
    return buildModel({
      board: [boardTask("T1")],
      groups: [
        {
          id: "teamB",
          label: "Subcell B",
          board: [boardTask("B1", { blockedBy: ["T1"] })],
          groups: [{ id: "teamB1", label: "Subcell B1", originTaskId: "B1", board: [boardTask("C1", { blockedBy: ["B1"] })] }],
        },
      ],
    })
  }

  test("the groups are flat, shallow-first, with parentId, depth and direct memberIds", () => {
    expect(nested().groups).toEqual([
      { id: "teamB", label: "Subcell B", parentId: null, memberIds: ["B1", "teamB1"], depth: 0 },
      { id: "teamB1", label: "Subcell B1", parentId: "teamB", memberIds: ["C1"], depth: 1, originTaskId: "B1" },
    ])
  })

  test("a nested edge is lifted to the frame that draws both of its ends", () => {
    // C1 (inside teamB1) waits on B1 (inside teamB), so the edge is drawn ONE frame up, box→box.
    expect(nested().edges).toContainEqual({ from: "B1", to: "teamB1", source: "board" })
    // B1 waits on the root's T1, so that edge is drawn at the ROOT frame, task→box.
    expect(nested().edges).toContainEqual({ from: "T1", to: "teamB", source: "board" })
  })

  test("each frame ranks its own interior, so depth is the column INSIDE that frame", () => {
    /** The nested model under test. */
    const model = nested()
    expect(nodeOf(model, "C1").depth).toBe(0)
    expect(nodeOf(model, "B1").depth).toBe(0)
    expect(nodeOf(model, "teamB1").depth).toBe(1)
    expect(nodeOf(model, "teamB1").group).toBe("teamB")
    expect(nodeOf(model, "teamB").group).toBeUndefined()
  })

  test("ranks bucket the ROOT frame only, with the top-level box ranked by its incoming edges", () => {
    expect(nested().ranks).toEqual([["T1"], ["teamB"]])
  })
})

describe("the box is a node", () => {
  test("the pseudo-node carries the label, the group visual and the column of its parent frame", () => {
    /** The model under test. */
    const box = nodeOf(groupedModel(), "teamB")
    expect(box.subject).toBe("Subcell B")
    expect(box.visual).toBe("group")
    expect(box.planned).toBe(false)
    expect(box.depth).toBe(2)
    expect(box.dependencies).toEqual(["T1", "T2"])
  })

  test("an interior ghost keeps the frame it was planned in", () => {
    /** A subcell whose plan declares one id its board does not carry. */
    const model = buildModel({
      board: [boardTask("T1")],
      groups: [{ id: "g", label: "G", board: [boardTask("G1")], plan: planOf([planTask("G2", "planned inside", ["G1"])]) }],
    })
    expect(nodeOf(model, "G2").planned).toBe(true)
    expect(nodeOf(model, "G2").group).toBe("g")
    expect(model.report.planOnly).toEqual(["G2"])
    expect(model.edges).toContainEqual({ from: "G1", to: "G2", source: "plan" })
  })
})

describe("the two refusals", () => {
  test("one id in two frames is refused, naming both frames", () => {
    expect(() =>
      buildModel({ board: [boardTask("T1")], groups: [{ id: "g", label: "G", board: [boardTask("T1")] }] }),
    ).toThrow(/id "T1" in the root frame and group "g"/)
  })

  test("a group id that collides with a task id is refused", () => {
    expect(() => buildModel({ board: [], groups: [{ id: "T1", label: "G", board: [boardTask("G1")] }, { id: "T1", label: "H", board: [boardTask("H1")] }] })).toThrow(/id "T1"/)
  })
})
