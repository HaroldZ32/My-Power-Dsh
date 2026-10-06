// THE UI FIXTURE'S OWN CONTRACT, pinned so the wave's central visual proof rests on a CHECKED board.
//
// WHY THIS FILE EXISTS. The Web Team tab and the TUI team scene are graded on screenshots taken
// against a seeded board (`docker/ui/seed-team-fixture.sh` → `docker/ui/team-fixture.mts`). Two of the
// properties that proof depends on are invisible in a screenshot of a well-behaved panel:
//
//   * the malformed board must REALLY carry a blocker id that names no task on the board, because the
//     captured assertion "every drawn edge resolves to two rendered nodes" is only meaningful while
//     such an edge is present to be refused; and
//   * it must REALLY carry a dependency cycle, because the review found that the store's `taskDepths`
//     resolves a revisited node to rank 0 — which is the thing that makes a back-edge run
//     right-to-left and a naive riser go negative.
//
// A fixture whose defects are only observed through a screenshot is a fixture nobody can check: if
// someone "tidies" the malformed board into a well-formed one, every downstream claim silently becomes
// a claim about a happy path. So the board shapes are asserted HERE, against the real projection the
// panel reads (`buildTeamState`), rather than being left to a PNG.
import { describe, expect, test } from "bun:test"
import { buildRecord } from "../../../docker/ui/team-fixture-records.mts"
import { buildTeamState } from "../src/team-web"
import type { TeamRecord } from "../src/team-store"

/** The session the fixture is bound to; the panel resolves a team through exactly this key. */
const SESSION = "session-fixture"

/** The workspace name a payload should attribute its read to. */
const WORKSPACE = "/data/ws"

/**
 * Project one fixture board through the shipping payload builder.
 * @param board - which board shape to build.
 * @returns the built record and the payload the panel would receive.
 */
function projectionOf(board: "normal" | "malformed"): { record: TeamRecord; state: ReturnType<typeof buildTeamState> } {
  // The fixture builds the RECORD shape the store declares; the cast is the seam between a fixture
  // that must not import the store's mutators and the store's own declared type.
  const record = buildRecord(board, SESSION) as unknown as TeamRecord
  return { record, state: buildTeamState(record, WORKSPACE, SESSION, { kind: "fixture", reason: "test" }) }
}

describe("docker/ui/team-fixture — the boards the UI proof is graded on", () => {
  test("the normal board is a connected chain with a fan-in and a failed prerequisite", () => {
    /** The normal board's payload. */
    const { state } = projectionOf("normal")
    // A task list, not a single node: the graph's columns and edges need more than one task to exist.
    expect(state.tasks.length).toBeGreaterThanOrEqual(4)
    // The fan-in: one task waits on TWO others, which is what makes a riser cross a rank boundary.
    const fanIn = state.tasks.find((task) => task.blockedBy.length === 2)
    expect(fanIn).toBeDefined()
    // Every blocker the normal board names is ON the board, so this board draws every edge it claims.
    /** Every task id the board carries. */
    const ids = new Set(state.tasks.map((task) => task.id))
    expect(state.tasks.every((task) => task.blockedBy.every((blocker) => ids.has(blocker)))).toBe(true)
    // A failed prerequisite: the OPT-1 case the member card and the node colouring must survive.
    expect(state.tasks.some((task) => task.status === "failed")).toBe(true)
    // The dependency edges the panel reports are the ones it can draw, and there are several.
    expect(state.team?.links).toBeGreaterThan(1)
    expect(state.cycles).toEqual([])
  })

  test("the normal board carries a member with no task at all, so 0/0 is rendered rather than assumed", () => {
    /** The normal board's payload. */
    const { state } = projectionOf("normal")
    // `lead` owns no task on the normal board. The card's fraction guard is only exercised by a member
    // that actually has `total: 0`, so the fixture must contain one.
    expect(state.members.some((member) => member.total === 0)).toBe(true)
  })

  test("the malformed board REALLY carries a blocker that names no task on the board", () => {
    /** The malformed board's payload. */
    const { state } = projectionOf("malformed")
    /** Every task id actually on this board. */
    const ids = new Set(state.tasks.map((task) => task.id))
    /** The blocker references that name nothing — the defect the renderer must refuse to draw. */
    const dangling = state.tasks.flatMap((task) => task.blockedBy.filter((blocker) => !ids.has(blocker)))
    expect(dangling).toContain("T9")
    // The task carrying it must still read BLOCKED: the store treats an unknown blocker as blocking
    // (`blockingDependencies`) even though `taskDepths` drops it from the ranking. Losing that pairing
    // would make the fixture test the wrong half of the rule.
    /** The task whose blocker is absent from the board. */
    const holder = state.tasks.find((task) => task.blockedBy.includes("T9"))
    expect(holder?.visual).toBe("blocked")
    // And the payload's own edge count EXCLUDES the dangling reference, which is the number the
    // renderer must agree with: `links` counts only blockers that are on the board.
    /** The blockers that name a task on this board, counted across the whole board. */
    const resolvable = state.tasks.reduce((total, task) => total + task.blockedBy.filter((blocker) => ids.has(blocker)).length, 0)
    expect(state.team?.links).toBe(resolvable)
  })

  test("the malformed board REALLY carries a cycle, and its depths make one edge run backwards", () => {
    /** The malformed board's payload. */
    const { state } = projectionOf("malformed")
    expect(state.cycles.length).toBeGreaterThanOrEqual(2)
    // The cycle is REPORTED, never swallowed: the panel renders `problems`, so it must be non-empty.
    expect(state.problems.length).toBeGreaterThan(0)
    /** The two nodes of the cycle. */
    const [first, second] = state.cycles
    expect(first).toBeDefined()
    expect(second).toBeDefined()
    /** The rank each cycle node was given. */
    const byId = new Map(state.tasks.map((task) => [task.id, task]))
    /** The first cycle node's rank. */
    const firstDepth = byId.get(first ?? "")?.depth ?? 0
    /** The second cycle node's rank. */
    const secondDepth = byId.get(second ?? "")?.depth ?? 0
    // NOT the same rank: a cycle whose nodes tie would not exercise the right-to-left case at all,
    // because the clamped riser only has to be computed when the blocker sits to the RIGHT.
    expect(firstDepth).not.toBe(secondDepth)
    /** The cycle edge pointing from the higher rank to the lower one. */
    const backwards = state.tasks.filter((task) => task.blockedBy.some((blocker) => (byId.get(blocker)?.depth ?? 0) < task.depth))
    expect(backwards.length).toBeGreaterThan(0)
  })

  test("both boards are bound to the session and the workspace the sidebar reads", () => {
    /** The normal board's payload. */
    const { record, state } = projectionOf("normal")
    // The panel's route resolves the record THROUGH the session id, so a fixture bound to another
    // session renders an empty tab — the failure that reads exactly like a broken panel.
    expect(record.leadSessionId).toBe(SESSION)
    expect(state.sessionId).toBe(SESSION)
    expect(state.workspace).toBe(WORKSPACE)
    // A record the store would refuse is useless to the panel: the version is part of the contract.
    expect(record.version).toBe(1)
    // The same team id for both boards, so re-seeding REPLACES the fixture instead of leaving two
    // teams on the workspace and making the tab depend on which one the index points at.
    expect(buildRecord("malformed", SESSION).teamId).toBe(record.teamId)
  })
})
