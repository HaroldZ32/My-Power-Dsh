// THE RANK DERIVATION'S LOAD-BEARING PROPERTIES.
//
// These arms pin the behaviour the MOVED code brought with it — the derived longest path, the
// cycle-safe iterative walk, the "derived beats served" rule with its one documented fallback, the
// numeric id order and the unresolved-reference report — plus the one signature the host needs:
// `rankPlan(tasks, served)` applying ranks computed elsewhere without a second reconstruction.
import { describe, expect, test } from "bun:test"

import { ID_ORDER, bucketRanks, cycleIds, deriveRanks, rankPlan, servedRank } from "../src/rank.ts"
import type { GraphTask, RankTask } from "../src/types.ts"

/** One ranked task with the three fields the derivation reads, as the narrow input allows. */
function rankTask(id: string, dependencies: string[] = [], depth: number = 0): RankTask {
  return { id, dependencies, depth }
}

/** The same row in the renderer's wider shape, for the arms that check the classic form still works. */
function graphTask(id: string, dependencies: string[] = [], depth: number = 0): GraphTask {
  return { id, subject: "subject of " + id, visual: "open", dependencies, depth }
}

describe("deriveRanks", () => {
  test("ranks a chain by the longest blocker path", () => {
    /** A three-task chain. */
    const tasks = [rankTask("T3", ["T2"]), rankTask("T1"), rankTask("T2", ["T1"])]
    /** Lookup by id, as the walk takes it. */
    const byId = new Map(tasks.map((task) => [task.id, task]))
    /** The derived ranks. */
    const ranks = deriveRanks(tasks, byId)
    expect([ranks.get("T1"), ranks.get("T2"), ranks.get("T3")]).toEqual([0, 1, 2])
  })

  test("a task with two blockers sits one below its deepest one", () => {
    /** A diamond: T4 joins T2 and T3, which both follow T1. */
    const tasks = [rankTask("T1"), rankTask("T2", ["T1"]), rankTask("T3", ["T1"]), rankTask("T4", ["T2", "T3"])]
    /** Lookup by id. */
    const byId = new Map(tasks.map((task) => [task.id, task]))
    /** The derived ranks. */
    const ranks = deriveRanks(tasks, byId)
    expect([ranks.get("T1"), ranks.get("T2"), ranks.get("T3"), ranks.get("T4")]).toEqual([0, 1, 1, 2])
  })

  test("a cycle stays finite and is reported by cycleIds", () => {
    /** Two tasks blocking each other. */
    const tasks = [rankTask("T1", ["T2"]), rankTask("T2", ["T1"])]
    /** Lookup by id. */
    const byId = new Map(tasks.map((task) => [task.id, task]))
    /** The derived ranks, which must be finite even though the graph never settles. */
    const ranks = deriveRanks(tasks, byId)
    expect(Number.isFinite(ranks.get("T1") ?? Number.NaN)).toBe(true)
    expect(Number.isFinite(ranks.get("T2") ?? Number.NaN)).toBe(true)
    expect(cycleIds(tasks)).toEqual(["T1", "T2"])
  })

  test("a blocker reference that resolves to nothing is a root", () => {
    /** A task whose only blocker is not on the board. */
    const tasks = [rankTask("T1", ["T9"])]
    /** Lookup by id. */
    const byId = new Map(tasks.map((task) => [task.id, task]))
    expect(deriveRanks(tasks, byId).get("T1")).toBe(0)
  })
})

describe("servedRank", () => {
  test("a negative or non-finite served depth is a root, and a fraction floors", () => {
    expect(servedRank(rankTask("T1", [], -3))).toBe(0)
    expect(servedRank(rankTask("T1", [], Number.POSITIVE_INFINITY))).toBe(0)
    expect(servedRank(rankTask("T1", [], 2.7))).toBe(2)
  })
})

describe("ID_ORDER and bucketRanks", () => {
  test("the numeric collator sorts T9 before T10", () => {
    expect(["T10", "T2", "T9"].sort((left, right) => ID_ORDER.compare(left, right))).toEqual(["T2", "T9", "T10"])
  })

  test("every rank from 0 to the deepest exists, and a rank is sorted by id", () => {
    /** A board whose ranks are 0 and 2, with nothing at rank 1. */
    const tasks = [graphTask("T10", [], 0), graphTask("T2", [], 2)]
    /** The buckets. */
    const buckets = bucketRanks(tasks, (task) => task.depth)
    expect(buckets.length).toBe(3)
    expect(buckets[1]).toEqual([])
    expect(buckets[2]?.map((task) => task.id)).toEqual(["T2"])
    expect(buckets[0]?.map((task) => task.id)).toEqual(["T10"])
  })
})

describe("rankPlan", () => {
  test("derives the ranks when no served map is given", () => {
    /** A two-task chain. */
    const tasks = [graphTask("T1"), graphTask("T2", ["T1"])]
    /** The plan under test. */
    const plan = rankPlan(tasks)
    expect(plan.derived).toBe(true)
    expect(plan.ranks.map((rank) => rank.map((task) => task.id))).toEqual([["T1"], ["T2"]])
    expect(plan.rankOf.get("T2")).toBe(1)
  })

  test("reports unresolved references, sorted", () => {
    /** A board whose references name nothing on it. */
    const tasks = [graphTask("T1", ["T9", "2"]), graphTask("T2", ["T9"])]
    /** The plan under test. */
    const plan = rankPlan(tasks)
    expect(plan.unresolved).toEqual(["2", "T9"])
  })

  test("the served depth draws only when nothing resolves and the depths vary", () => {
    /** A board with unusable references and varying served depths. */
    const tasks = [graphTask("T1", ["T9"], 0), graphTask("T2", ["T8"], 3)]
    /** The plan under test. */
    const plan = rankPlan(tasks)
    expect(plan.derived).toBe(false)
    expect(plan.ranks.map((rank) => rank.map((task) => task.id))).toEqual([["T1"], [], [], ["T2"]])
    expect(plan.unresolved).toEqual(["T8", "T9"])
  })

  test("a served map wins even over a graph that resolves", () => {
    /** Two tasks the graph would rank 0 and 1. */
    const tasks = [graphTask("T1"), graphTask("T2", ["T1"])]
    /** The ranks a host already computed. */
    const served = new Map([["T1", 4], ["T2", 0]])
    /** The plan under test. */
    const plan = rankPlan(tasks, served)
    expect(plan.derived).toBe(false)
    expect(plan.rankOf).toBe(served)
    expect(plan.ranks.map((rank) => rank.map((task) => task.id))).toEqual([["T2"], [], [], [], ["T1"]])
  })

  test("a served map keeps the unresolved scan", () => {
    /** One task whose blocker names nothing. */
    const tasks = [graphTask("T1", ["T7"])]
    /** The plan under test. */
    const plan = rankPlan(tasks, new Map([["T1", 0]]))
    expect(plan.unresolved).toEqual(["T7"])
  })

  test("the narrow three-field shape is accepted without a subject or a visual", () => {
    /** A plan ranked over the derivation's minimum input. */
    const plan = rankPlan([rankTask("T1"), rankTask("T2", ["T1"])])
    expect(plan.ranks.map((rank) => rank.map((task) => task.id))).toEqual([["T1"], ["T2"]])
  })

  test("an empty board ranks to nothing", () => {
    /** The plan over no tasks. */
    const plan = rankPlan([])
    expect(plan.ranks).toEqual([])
    expect(plan.derived).toBe(true)
    expect(plan.rankOf.size).toBe(0)
  })
})
