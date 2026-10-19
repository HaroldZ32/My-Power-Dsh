// THE MERGE MODEL AGAINST THE FROZEN CONTRACT'S CASE TABLE.
//
// One arm per row of `.mpd/plans/living-graph.md` Amendment 1's table (board-only, plan-only GHOSTS,
// plan-only edge, board-only edge, agreeing edge, unreadable plan line), plus the two invariants the
// wave cannot lose: the SAME inputs produce the SAME model, and a completely flat board draws flat
// and says so instead of inventing structure.
import { describe, expect, test } from "bun:test"

import { buildModel, parsePlanMarkdown } from "../src/index.ts"
import type { BoardTask, PlanDocument, PlanTask } from "../src/types.ts"

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

describe("the six cases of the frozen case table", () => {
  test("id on the board, absent from the plan: drawn from the board and reported", () => {
    /** The model under test. */
    const model = buildModel({ board: [boardTask("T1", { status: "pending" })], plan: planOf([]) })
    expect(model.nodes.map((node) => node.id)).toEqual(["T1"])
    expect(model.nodes[0]?.planned).toBe(false)
    expect(model.nodes[0]?.subject).toBe("subject of T1")
    expect(model.report.boardOnly).toEqual(["T1"])
    expect(model.report.planOnly).toEqual([])
  })

  test("id in the plan, absent from the board: a GHOST node is drawn, never dropped", () => {
    /** The model under test. */
    const model = buildModel({ plan: planOf([planTask("T7", "a planned task")]) })
    /** The ghost node. */
    const ghost = model.nodes[0]
    expect(model.nodes.map((node) => node.id)).toEqual(["T7"])
    expect(ghost?.planned).toBe(true)
    expect(ghost?.visual).toBe("planned")
    expect(ghost?.title).toBe("a planned task")
    expect(ghost?.dependencies).toEqual([])
    expect(model.report.planOnly).toEqual(["T7"])
    expect(model.report.boardOnly).toEqual([])
  })

  test("edge in the plan, absent from the board: drawn with source 'plan' and reported", () => {
    /** A board that carries both rows but no edge. */
    const board = [boardTask("T1"), boardTask("T2")]
    /** A plan that declares T2 blocked by T1. */
    const plan = planOf([planTask("T1", "one"), planTask("T2", "two", ["T1"])])
    /** The model under test. */
    const model = buildModel({ board, plan })
    expect(model.edges).toEqual([{ from: "T1", to: "T2", source: "plan" }])
    expect(model.report.edgePlanOnly).toEqual([{ from: "T1", to: "T2", source: "plan" }])
    expect(model.report.edgeBoardOnly).toEqual([])
  })

  test("edge on the board, absent from the plan: drawn with source 'board' and reported", () => {
    /** A board whose second task names its blocker. */
    const board = [boardTask("T1"), boardTask("T2", { blockedBy: ["T1"] })]
    /** A plan that knows both ids but no edge. */
    const plan = planOf([planTask("T1", "one"), planTask("T2", "two")])
    /** The model under test. */
    const model = buildModel({ board, plan })
    expect(model.edges).toEqual([{ from: "T1", to: "T2", source: "board" }])
    expect(model.report.edgeBoardOnly).toEqual([{ from: "T1", to: "T2", source: "board" }])
    expect(model.report.edgePlanOnly).toEqual([])
  })

  test("both agreeing: an ordinary edge, named by neither report list", () => {
    /** A board whose second task names its blocker. */
    const board = [boardTask("T1"), boardTask("T2", { blockedBy: ["T1"] })]
    /** A plan that declares the same edge. */
    const plan = planOf([planTask("T1", "one"), planTask("T2", "two", ["T1"])])
    /** The model under test. */
    const model = buildModel({ board, plan })
    expect(model.edges).toEqual([{ from: "T1", to: "T2", source: "both" }])
    expect(model.report.edgePlanOnly).toEqual([])
    expect(model.report.edgeBoardOnly).toEqual([])
    expect(model.report.boardOnly).toEqual([])
    expect(model.report.planOnly).toEqual([])
  })

  test("a plan line that cannot be parsed is carried as a problem, never thrown on", () => {
    /** A plan whose TODO section holds one half-typed item. */
    const text = ["## TODOs", "", "1. A real task.", "- [ ] 2.", ""].join("\n")
    /** The parsed document, which must not throw. */
    const plan = parsePlanMarkdown(text)
    /** The model under test. */
    const model = buildModel({ board: [boardTask("T1")], plan })
    expect(model.report.planProblems.length).toBe(1)
    expect(model.report.planProblems[0]?.line).toBe(4)
    expect(model.nodes.map((node) => node.id)).toEqual(["T1"])
  })
})

describe("determinism", () => {
  test("same inputs in a different arrival order produce identical JSON", () => {
    /** The board, declared in reverse id order on purpose. */
    const reversed = [boardTask("T10", { blockedBy: ["T9"] }), boardTask("T9"), boardTask("T2")]
    /** The same board in forward order. */
    const forward = [boardTask("T2"), boardTask("T9"), boardTask("T10", { blockedBy: ["T9"] })]
    /** One build over each order. */
    const first = buildModel({ board: reversed, plan: planOf([planTask("T2", "two")]) })
    /** The second build over each order. */
    const second = buildModel({ board: forward, plan: planOf([planTask("T2", "two")]) })
    expect(JSON.stringify(first)).toBe(JSON.stringify(second))
  })

  test("nodes are ordered by the numeric id collator, so T2 precedes T10", () => {
    /** The model under test. */
    const model = buildModel({ board: [boardTask("T10"), boardTask("T2"), boardTask("T1")] })
    expect(model.nodes.map((node) => node.id)).toEqual(["T1", "T2", "T10"])
  })

  test("edges are sorted by (from, then to)", () => {
    /** A board whose edges arrive in a different order. */
    const board = [boardTask("T10", { blockedBy: ["T9", "T1"] }), boardTask("T1"), boardTask("T9")]
    /** The model under test. */
    const model = buildModel({ board })
    expect(model.edges.map((edge) => `${edge.from}->${edge.to}`)).toEqual(["T1->T10", "T9->T10"])
  })

  test("the model round-trips through JSON unchanged", () => {
    /** A model carrying every optional field a node can have. */
    const model = buildModel({
      board: [boardTask("T1", { kind: "work", owner: "Senior Engineer", status: "in_progress", visual: "running", depth: 3 })],
      plan: planOf([planTask("T1", "one"), planTask("F1", "verify")]),
    })
    expect(JSON.parse(JSON.stringify(model))).toEqual(model)
  })
})

describe("the flat board", () => {
  test("every blockedBy [] draws flat and honestly", () => {
    /** A board with no dependency at all, which is the wave-1 board's real shape. */
    const board = [boardTask("T1", { status: "completed" }), boardTask("T2", { status: "in_progress" }), boardTask("T3")]
    /** The model under test. */
    const model = buildModel({ board })
    expect(model.edges).toEqual([])
    expect(model.ranks).toEqual([["T1", "T2", "T3"]])
    expect(model.nodes.every((node) => node.depth === 0)).toBe(true)
    expect(model.report.ranksDerived).toBe(true)
    expect(model.report.unresolved).toEqual([])
  })
})

describe("the rank derivation inside the model", () => {
  test("a ghost chain is ranked from the plan's own edges", () => {
    /** A plan-only chain, with no board at all. */
    const plan = planOf([planTask("T2", "second", ["T1"]), planTask("T1", "first")])
    /** The model under test. */
    const model = buildModel({ plan })
    expect(model.ranks).toEqual([["T1"], ["T2"]])
    expect(model.nodes.map((node) => node.depth)).toEqual([0, 1])
  })

  test("a reference that resolves to nothing is reported and draws no edge", () => {
    /** The measured defect's shape: ordinals where ids were expected. */
    const board = [boardTask("T1"), boardTask("T2", { blockedBy: ["2"] })]
    /** The model under test. */
    const model = buildModel({ board })
    expect(model.edges).toEqual([])
    expect(model.report.unresolved).toEqual(["2"])
    expect(model.nodes[1]?.dependencies).toEqual(["2"])
  })

  test("a cycle keeps every rank finite and is reported", () => {
    /** Two tasks blocking each other. */
    const board = [boardTask("T1", { blockedBy: ["T2"] }), boardTask("T2", { blockedBy: ["T1"] })]
    /** The model under test. */
    const model = buildModel({ board })
    expect(model.cycles).toEqual(["T1", "T2"])
    expect(model.nodes.every((node) => Number.isFinite(node.depth))).toBe(true)
  })

  test("a board whose references all fail falls back to the served depth and says so", () => {
    /** A board with unusable references but a served depth that varies. */
    const board = [boardTask("T1", { depth: 0 }), boardTask("T2", { blockedBy: ["T9"], depth: 2 })]
    /** The model under test. */
    const model = buildModel({ board })
    expect(model.report.ranksDerived).toBe(false)
    expect(model.nodes.map((node) => node.depth)).toEqual([0, 2])
  })
})

describe("visual state", () => {
  test("a computed visual wins and an absent one is mapped from the durable status", () => {
    /** A board with one explicit visual and one status to map. */
    const board = [boardTask("T1", { visual: "blocked", status: "pending" }), boardTask("T2", { status: "in_progress" })]
    /** The model under test. */
    const model = buildModel({ board })
    expect(model.nodes.map((node) => node.visual)).toEqual(["blocked", "running"])
  })
})
