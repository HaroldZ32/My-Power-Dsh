// THE CONSULT NODES AGAINST THE FROZEN CONTRACT (`.mpd/plans/cellwork-consult-dag-nodes.md`).
//
// Every arm here is one of the contract's own sentences made executable: a consult lives in the SIBLING
// `consults` array and never in `nodes` (§2.1), it carries no dependency and takes no part in the rank
// derivation so the task picture is byte-identical with and without it (§2.2), a model given none is the
// model this package always produced (§2.4), the id is frame-qualified inside a box and the tone maps
// `interrupted` to `cancelled` (§4), and the retention/ordering rules a renderer keys on.
import { describe, expect, test } from "bun:test"

import { buildModel } from "../src/index.ts"
import type { BoardTask, GraphConsultInput, GraphModel, PlanDocument, PlanTask } from "../src/types.ts"

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
 * One consult row, every field stated so an arm can single one out.
 * @param extra - the fields this arm overrides.
 * @returns the row, defaulted to a running root consult.
 */
function consult(extra: Partial<GraphConsultInput> = {}): GraphConsultInput {
  return { consultNumber: 1, consultId: "consult-1", role: "Explorer", task: "map the parser", state: "running", startedAt: 1000, cellId: "cell-root", ...extra }
}

/** The flat fixture every arm starts from: one completed task and one waiting on it. */
const BOARD: BoardTask[] = [boardTask("T1", { status: "completed" }), boardTask("T2", { status: "in_progress", blockedBy: ["T1"] })]
/** The plan that agrees with that board. */
const PLAN: PlanDocument = planOf([planTask("T1", "one"), planTask("T2", "two", ["T1"])])

/**
 * The blocks a consult must never disturb, as one comparable value.
 * @param model - the model to reduce.
 * @returns the task picture only.
 */
function taskPicture(model: GraphModel): unknown {
  return { nodes: model.nodes, edges: model.edges, ranks: model.ranks, cycles: model.cycles, report: model.report }
}

describe("hard rule 1: consults are a SIBLING array, never nodes", () => {
  test("a consult lands in `consults` and NOT in `nodes`", () => {
    /** The model under test. */
    const model = buildModel({ board: BOARD, plan: PLAN, consults: [consult()] })
    expect(model.consults?.length).toBe(1)
    expect(model.nodes.some((node) => node.id === "C1")).toBe(false)
    expect(model.nodes.some((node) => node.kind === "consult")).toBe(false)
  })

  test("no consult id reaches edges, ranks or the report", () => {
    /** The model under test, with two rows so the ordinal is exercised too. */
    const model = buildModel({ board: BOARD, plan: PLAN, consults: [consult(), consult({ consultNumber: 2, consultId: "consult-2", state: "complete" })] })
    /** The whole model minus the consult array, searched for a consult spelling. */
    const rest = JSON.stringify({ nodes: model.nodes, edges: model.edges, ranks: model.ranks, report: model.report })
    expect(rest.includes("\"C1\"")).toBe(false)
    expect(rest.includes("\"C2\"")).toBe(false)
    expect(rest.includes("consult-1")).toBe(false)
    expect(rest.includes("consult-2")).toBe(false)
  })

  test("a consult carries no dependency and sits in column 0", () => {
    /** The model under test. */
    const model = buildModel({ board: BOARD, plan: PLAN, consults: [consult()] })
    /** The consult node. */
    const node = model.consults?.[0]
    expect(node?.dependencies).toEqual([])
    expect(node?.depth).toBe(0)
    expect(node?.planned).toBe(false)
    expect(node?.kind).toBe("consult")
  })
})

describe("hard rule 2: no participation in the rank derivation", () => {
  test("nodes, edges, ranks and the report are byte-identical with and without consults", () => {
    /** The task picture without any consult. */
    const without = buildModel({ board: BOARD, plan: PLAN })
    /** The same input, consults added. */
    const withConsults = buildModel({ board: BOARD, plan: PLAN, consults: [consult(), consult({ consultNumber: 2, consultId: "consult-2", state: "failed" })] })
    expect(JSON.stringify(taskPicture(withConsults))).toBe(JSON.stringify(taskPicture(without)))
  })

  test("the served-depth fallback is not flipped: an all-zero-depth board still ranks from the served depth", () => {
    // THE MEASURED DEFECT THIS PREVENTS: an edge from a consult would raise `resolved` from 0 to 1 and
    // swap `rankPlan`'s served-depth fallback for a derived ranking, silently re-ranking a legacy board.
    /** A board whose ONLY structure is the served depth: no blockedBy anywhere. */
    const legacy: BoardTask[] = [boardTask("T1", { depth: 0 }), boardTask("T2", { depth: 3 })]
    /** The ranking with no consult at all. */
    const without = buildModel({ board: legacy, consults: [] })
    /** The same board, consults added. */
    const withConsults = buildModel({ board: legacy, consults: [consult()] })
    expect(withConsults.report.ranksDerived).toBe(without.report.ranksDerived)
    expect(withConsults.ranks).toEqual(without.ranks)
  })
})

describe("hard rule 4: backward compatibility by ABSENCE", () => {
  test("a build given no consults carries no `consults` key", () => {
    /** The model under test. */
    const model = buildModel({ board: BOARD, plan: PLAN })
    expect(Object.prototype.hasOwnProperty.call(model, "consults")).toBe(false)
  })

  test("an EMPTY consults array is the same model as no consults at all", () => {
    expect(JSON.stringify(buildModel({ board: BOARD, plan: PLAN, consults: [] }))).toBe(JSON.stringify(buildModel({ board: BOARD, plan: PLAN })))
  })
})

describe("the node's own fields and the lifetime tone", () => {
  test("assignee is the role, subject the task excerpt and status the recorded lifecycle word", () => {
    /** The model under test. */
    const model = buildModel({ board: BOARD, plan: PLAN, consults: [consult({ role: "Deep Worker", task: "draft the note", state: "running" })] })
    /** The consult node. */
    const node = model.consults?.[0]
    expect(node?.assignee).toBe("Deep Worker")
    expect(node?.subject).toBe("draft the note")
    expect(node?.status).toBe("running")
    expect(node?.consultId).toBe("consult-1")
    expect(node?.cellId).toBe("cell-root")
    expect(node?.startedAt).toBe(1000)
  })

  test("the six-state tone maps across the whole lifecycle, `interrupted` reading as `cancelled`", () => {
    /** One row per lifecycle word, each with its own ordinal. */
    const rows: GraphConsultInput[] = (["running", "complete", "interrupted", "failed", "cancelled", "something-else"] as const).map((state, index) =>
      consult({ consultNumber: index + 1, consultId: "consult-" + String(index + 1), state }))
    /** The model under test. */
    const model = buildModel({ board: BOARD, plan: PLAN, consults: rows })
    expect((model.consults ?? []).map((row) => row.visual)).toEqual(["running", "completed", "cancelled", "failed", "cancelled", "open"])
  })

  test("elapsedMs travels only when the record carries one", () => {
    /** The model under test: one settled row with a duration and one still running. */
    const model = buildModel({ board: BOARD, plan: PLAN, consults: [consult({ elapsedMs: 250 }), consult({ consultNumber: 2, consultId: "consult-2" })] })
    expect(model.consults?.[0].elapsedMs).toBe(250)
    expect("elapsedMs" in (model.consults?.[1] ?? {})).toBe(false)
  })
})

describe("ordering, ids and frame attribution", () => {
  test("a frame's rows are ordered by their minted ordinal, whatever order they arrive in", () => {
    /** The three root rows, declared in reverse ordinal order. */
    const rows = [consult({ consultNumber: 3, consultId: "c" }), consult({ consultNumber: 1, consultId: "a" }), consult({ consultNumber: 2, consultId: "b" })]
    /** The model under test. */
    const model = buildModel({ board: BOARD, plan: PLAN, consults: rows })
    expect((model.consults ?? []).map((row) => row.id)).toEqual(["C1", "C2", "C3"])
  })

  test("a subcell's consult is drawn INSIDE its box: qualified id, `group` set, and frame pre-order", () => {
    /** A root frame with one group whose own team started a consult at ordinal 1 (the SAME ordinal as the root's). */
    const model = buildModel({
      board: [boardTask("T1")],
      consults: [consult()],
      groups: [{ id: "teamB", label: "Subcell B", board: [boardTask("B1")], consults: [consult({ consultId: "consult-sub", cellId: "cell-sub", state: "interrupted" })] }],
    })
    expect((model.consults ?? []).map((row) => row.id)).toEqual(["C1", "teamB::C1"])
    /** The subcell's node. */
    const inner = (model.consults ?? [])[1]
    expect(inner.group).toBe("teamB")
    expect(inner.cellId).toBe("cell-sub")
    expect(inner.visual).toBe("cancelled")
  })

  test("the consults never enter a box's memberIds, so no renderer can file them as tasks", () => {
    /** The model under test. */
    const model = buildModel({
      board: [boardTask("T1")],
      consults: [consult()],
      groups: [{ id: "teamB", label: "Subcell B", board: [boardTask("B1")], consults: [consult()] }],
    })
    expect(model.groups?.find((group) => group.id === "teamB")?.memberIds).toEqual(["B1"])
  })

  test("a model with consults still round-trips through JSON unchanged", () => {
    /** The model under test. */
    const model = buildModel({ board: BOARD, plan: PLAN, consults: [consult({ elapsedMs: 5 })] })
    expect(JSON.parse(JSON.stringify(model))).toEqual(model)
  })
})
