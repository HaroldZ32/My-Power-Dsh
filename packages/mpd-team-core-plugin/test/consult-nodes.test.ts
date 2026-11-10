// CONSULTS ON THE TEAM RECORD (`.mpd/plans/cellwork-consult-dag-nodes.md` §3, §4, §8).
//
// WHY THESE ARMS EXIST. A background consult becomes a first-class DAG node WITHOUT becoming a task, so
// three properties have to be MEASURED rather than intended: the record's board is untouched by every
// consult write (no `T<n>`, no readiness, no tally), the mint/upsert/prune rules are the record's own
// (monotone ordinals, <= 50 rows, a running row never pruned), and the projection hands the shared core
// a `consults` array that a flat team simply does not have — the backward guarantee by ABSENCE.
import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { GraphModels } from "../src/graph-model"
import { clearConsults, upsertConsult, type TeamActionDeps } from "../src/team-actions"
import { addTeamTask, applyConsultUpsert, clearTeamConsults, createTeam, readTeam, readyTasks, writeTeam, type TeamRecord } from "../src/team-store"
import type { GraphModel } from "../../mpd-graph-core/src/index.ts"

/** The frozen instant every row in this file is stamped with. */
const NOW = new Date("2026-11-10T09:00:00.000Z")

/** The sandboxes this file created, removed after every arm. */
const sandboxes: string[] = []
afterEach(() => { for (const dir of sandboxes.splice(0)) rmSync(dir, { recursive: true, force: true }) })

/**
 * A fresh workspace holding one persisted team with two board rows.
 * @returns the workspace and the record it wrote.
 */
function workspaceWithTeam(): { workspace: string; team: TeamRecord } {
  /** A fresh sandbox, so no arm sees another arm's records. */
  const workspace = mkdtempSync(join(tmpdir(), "mpd-consult-nodes-"))
  sandboxes.push(workspace)
  /** The record, built through the store so the fixture cannot drift from the real shape. */
  let team = createTeam(workspace, { name: "wave-consults", description: "draw the consults", leadSessionId: "sess-1" }, NOW)
  team = addTeamTask(team, { subject: "Build the core", description: "own it", kind: "work" }, NOW)
  team = addTeamTask(team, { subject: "Review it", description: "judge it", kind: "review", blockedBy: ["T1"] }, NOW)
  writeTeam(workspace, team)
  return { workspace, team }
}

/**
 * One consult input, every field stated so an arm can single one out.
 * @param extra - the fields this arm overrides.
 * @returns the row, defaulted to a running root consult.
 */
function consult(extra: Record<string, unknown> = {}): { consultId: string; role: string; task: string; cellId: string; startedAt: number; state: "running" | "complete" | "interrupted" | "failed" | "cancelled" } {
  return { consultId: "consult-a", role: "Explorer", task: "map the parser", cellId: "cell-1", startedAt: NOW.getTime(), state: "running", ...extra } as ReturnType<typeof consult>
}

/**
 * The action deps the two verbs need: the frozen clock only.
 * @returns the deps object.
 */
function actionDeps(): TeamActionDeps {
  return { now: (): Date => NOW } as TeamActionDeps
}

/**
 * The graph cache over one workspace, with a revision counter the arms bump themselves.
 * @param workspace - the workspace to build for.
 * @returns the cache and a bump function.
 */
function modelsFor(workspace: string): { models: GraphModels; bump: () => void } {
  /** The revision the cache compares against. */
  let revision = 1
  /** The cache under test, with the plan watch disabled (these arms write no plan). */
  // The watcher is cast because these arms never write a plan: the cache only needs a handle it can
  // close, and the full GraphWatcher shape is another module's contract to prove.
  const models = new GraphModels({ revision: (): number => revision, notify: (): void => { revision += 1 }, watch: (() => ({ close: (): void => {}, ready: async (): Promise<void> => {} })) as never })
  return { models, bump: (): void => { revision += 1 } }
}

describe("the record's own mint / upsert / prune rules", () => {
  test("a NEW consultId is minted the next ordinal; the same id keeps it and updates in place", () => {
    /** The workspace and its record. */
    const { team } = workspaceWithTeam()
    /** The record after the first upsert. */
    const first = applyConsultUpsert(team, consult(), NOW)
    expect(first.consultNumber).toBe(1)
    expect(first.record.nextConsultNumber).toBe(2)
    /** The record after a SECOND id. */
    const second = applyConsultUpsert(first.record, consult({ consultId: "consult-b" }), NOW)
    expect(second.consultNumber).toBe(2)
    // THE SAME ID AGAIN: no re-mint, one row, the new state.
    /** The record after settling the FIRST consult. */
    const settled = applyConsultUpsert(second.record, consult({ state: "complete", elapsedMs: 900 }), NOW)
    expect(settled.consultNumber).toBe(1)
    expect(settled.record.consults?.length).toBe(2)
    expect(settled.record.consults?.[0].state).toBe("complete")
    expect(settled.record.nextConsultNumber).toBe(3)
  })

  test("a terminal row is never moved back to `running`, and a terminal row is stamped with finishedAt", () => {
    /** The workspace and its record. */
    const { team } = workspaceWithTeam()
    /** A settled row. */
    const settled = applyConsultUpsert(team, consult({ state: "complete" }), NOW).record
    // A STALE START REPORT arriving after the settlement must not resurrect the consult.
    /** The record after the late `running` report. */
    const late = applyConsultUpsert(settled, consult({ state: "running" }), NOW).record
    expect(late.consults?.[0].state).toBe("complete")
    expect(late.consults?.[0].finishedAt).toBe(NOW.getTime())
    // A RUNNING ROW NEVER CARRIES A FINISH STAMP.
    expect("finishedAt" in (applyConsultUpsert(team, consult(), NOW).record.consults?.[0] ?? {})).toBe(false)
  })

  test("a blank excerpt in a later upsert never erases the one the start path wrote", () => {
    /** The workspace and its record. */
    const { team } = workspaceWithTeam()
    /** A started row with its assignment text. */
    const started = applyConsultUpsert(team, consult({ task: "map the parser" }), NOW).record
    /** The settlement, which carries no assignment text. */
    const settled = applyConsultUpsert(started, consult({ task: "", state: "complete" }), NOW).record
    expect(settled.consults?.[0].task).toBe("map the parser")
  })

  test("retention keeps 50 rows, drops the OLDEST SETTLED first, and never prunes a running one", () => {
    /** The workspace and its record. */
    const { team } = workspaceWithTeam()
    /** The record after 55 settled rows. */
    let record = team
    for (let index = 1; index <= 55; index += 1) record = applyConsultUpsert(record, consult({ consultId: `consult-${String(index)}`, state: "complete" }), NOW).record
    expect(record.consults?.length).toBe(50)
    // The five oldest ordinals are the ones that went.
    expect(record.consults?.map((row) => row.consultNumber)).toEqual(Array.from({ length: 50 }, (_unused: unknown, index: number) => index + 6))
  })

  test("with every row still running the cap yields: a running row is never dropped", () => {
    /** The workspace and its record. */
    const { team } = workspaceWithTeam()
    /** The record after 55 RUNNING rows. */
    let record = team
    for (let index = 1; index <= 55; index += 1) record = applyConsultUpsert(record, consult({ consultId: `live-${String(index)}`, state: "running" }), NOW).record
    // The cap is exceeded ON PURPOSE: the honest picture is 55 live consults, not a silent deletion.
    expect(record.consults?.length).toBe(55)
    expect(record.consults?.every((row) => row.state === "running")).toBe(true)
  })
})

describe("the two plane verbs", () => {
  test("upsertConsult persists, and the board is untouched (no T<n>, no readiness change)", async () => {
    /** The workspace and its record. */
    const { workspace, team } = workspaceWithTeam()
    /** The verb's answer. */
    const answer = await upsertConsult(actionDeps(), { workspace, teamId: team.teamId, record: consult() })
    expect(answer.ok).toBe(true)
    /** The record as it landed on disk. */
    const stored = readTeam(workspace, team.teamId) as TeamRecord
    expect(stored.consults?.length).toBe(1)
    // THE BOARD IS NOT A CONSULT SURFACE: ids, counter and readiness are exactly what they were.
    expect(stored.tasks.map((row) => row.id)).toEqual(team.tasks.map((row) => row.id))
    expect(stored.nextTaskNumber).toBe(team.nextTaskNumber)
    expect(readyTasks(stored).map((row) => row.id)).toEqual(readyTasks(team).map((row) => row.id))
  })

  test("upsertConsult refuses an empty consultId and an unknown team", async () => {
    /** The workspace and its record. */
    const { workspace, team } = workspaceWithTeam()
    expect((await upsertConsult(actionDeps(), { workspace, teamId: team.teamId, record: consult({ consultId: "  " }) })).ok).toBe(false)
    expect((await upsertConsult(actionDeps(), { workspace, teamId: "team-nope", record: consult() })).ok).toBe(false)
  })

  test("clearConsults removes BOTH keys, so the record is the one it was before any consult", async () => {
    /** The workspace and its record. */
    const { workspace, team } = workspaceWithTeam()
    await upsertConsult(actionDeps(), { workspace, teamId: team.teamId, record: consult() })
    /** The cleared answer. */
    const cleared = await clearConsults(actionDeps(), { workspace, teamId: team.teamId })
    expect(cleared.ok).toBe(true)
    /** The record as it landed on disk. */
    const stored = readTeam(workspace, team.teamId) as TeamRecord
    expect(Object.prototype.hasOwnProperty.call(stored, "consults")).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(stored, "nextConsultNumber")).toBe(false)
    // ABSENCE, not an empty array: the cleared record serializes exactly like the pre-consult one.
    expect(clearTeamConsults(stored)).toBe(stored)
  })
})

describe("the projection: consults reach the model as a SIBLING array", () => {
  test("a flat team's consults land in `model.consults`, never in `nodes`, and a task byte does not move", () => {
    /** The workspace and its record. */
    const { workspace, team } = workspaceWithTeam()
    /** The cache under test. */
    const { models, bump } = modelsFor(workspace)
    /** The model BEFORE any consult, which is the backward reference. */
    const before = models.get(workspace, team) as GraphModel
    expect(Object.prototype.hasOwnProperty.call(before, "consults")).toBe(false)
    // One consult, then a revision bump: the SAME write -> revision path an SSE refresh rides.
    upsertConsult(actionDeps(), { workspace, teamId: team.teamId, record: consult() })
    bump()
    /** The record the cache is handed (the caller reads it, as both planes do). */
    const record = readTeam(workspace, team.teamId) as TeamRecord
    /** The model AFTER the consult. */
    const after = models.get(workspace, record) as GraphModel
    expect(after.consults?.map((row) => row.id)).toEqual(["C1"])
    expect(after.nodes.some((node) => node.id === "C1")).toBe(false)
    expect(after.nodes).toEqual(before.nodes)
    expect(after.edges).toEqual(before.edges)
    expect(after.ranks).toEqual(before.ranks)
    expect(after.report).toEqual(before.report)
  })

  test("a subcell's consults are drawn INSIDE its box: qualified id and `group` attribution", () => {
    /** A root team with one live child that recorded its own consult. */
    const workspace = mkdtempSync(join(tmpdir(), "mpd-consult-nested-"))
    sandboxes.push(workspace)
    /** The root team. */
    let root = createTeam(workspace, { name: "root", description: "the top", leadSessionId: "sess-root" }, NOW)
    root = addTeamTask(root, { subject: "Root row", description: "own it", kind: "work" }, NOW)
    writeTeam(workspace, root)
    /** The child team, nested under the root and LIVE. */
    let child = createTeam(workspace, { name: "child", description: "the box", leadSessionId: "sess-child", parentTeamId: root.teamId, teamId: "team-child" }, NOW)
    child = addTeamTask(child, { subject: "Child row", description: "own it", kind: "work" }, NOW)
    child = { ...child, phase: "active", approvedAt: NOW.toISOString() }
    child = applyConsultUpsert(child, consult({ consultId: "consult-child", cellId: "cell-child" }), NOW).record
    writeTeam(workspace, child)
    /** Root's own consult, so the two frames are distinguishable by their ordinal alone. */
    const withRoot = applyConsultUpsert(root, consult({ consultId: "consult-root", cellId: "cell-root" }), NOW).record
    writeTeam(workspace, withRoot)
    /** The cache under test. */
    const { models } = modelsFor(workspace)
    /** The nested model. */
    const model = models.get(workspace, withRoot) as GraphModel
    // FRAME PRE-ORDER: the root's row first, then the box's — each named by its OWN ordinal.
    expect(model.consults?.map((row) => row.id)).toEqual(["C1", "team-child::C1"])
    expect(model.consults?.[1].group).toBe("team-child")
    expect(model.consults?.[1].cellId).toBe("cell-child")
  })
})
