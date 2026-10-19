// LANE E — targeted re-derivation of the CodeRabbit round's five moved claims.
//
// 1. THE MAJOR (cross-team model attachment): a FOREIGN model whose ids COLLIDE with a real board
//    (`T1..T4` plus its own `T5`) must be REJECTED by the TUI join — and the two official-view arms
//    must never ask the service at all.
// 2. THREE EVENT DEFECTS, each observed from this probe's own filesystem mutations:
//    (a) a plan CREATED where none existed must change what the model serves;
//    (b) a directory REPLACED at the same path must be re-armed (a later write must still arrive);
//    (c) a plan path that RESOLVES DIFFERENTLY with NO revision bump must rebuild the model.
// 3. A moved parser claim: a leading lane marker is stripped only for a lane the plan DECLARES.
//
// Run: bun evidence/living-graph/coderabbit-recheck/<ts>/verify-major-and-events.ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { buildModel, parsePlanMarkdown, plansDirectory, watchGraph } from "../../../../packages/mpd-graph-core/src/index.ts"
import type { BoardTask, GraphChangeEvent, GraphModel } from "../../../../packages/mpd-graph-core/src/index.ts"
import { GraphModels } from "../../../../packages/mpd-team-core-plugin/src/graph-model.ts"
import { readTeam } from "../../../../packages/mpd-team-core-plugin/src/team-store.ts"
import type { TeamRecord } from "../../../../packages/mpd-team-core-plugin/src/team-store.ts"
import { dagPageOf } from "../../../../packages/mpd-tui-plugin/src/panel-dag.ts"
import { readScopedWorkflow } from "../../../../packages/mpd-tui-plugin/src/team-state.ts"

/** This run's own directory. */
const HERE = import.meta.dirname
/** Build a scratch workspace root. */
const scratch = (): string => mkdtempSync(join(HERE, "ws-"))

/**
 * One team record with the given task ids, all as roots.
 * @param teamId - the record's id.
 * @param ids - the task ids it carries.
 * @param sessionId - the Lead session the record names.
 * @returns the record.
 */
function recordOf(teamId: string, ids: readonly string[], sessionId: string): TeamRecord {
  return {
    version: 1,
    teamId,
    name: teamId,
    description: "lane E fixture",
    leadSessionId: sessionId,
    phase: "active",
    createdAt: "2026-10-19T00:00:00.000Z",
    members: [{ id: "M1", name: "Lead", description: "member", status: "running", spawnedAt: "2026-10-19T00:00:00.000Z" }],
    nextMemberNumber: 2,
    nextTaskNumber: 20,
    approvedAt: "2026-10-19T00:00:00.000Z",
    tasks: ids.map((id) => ({ id, subject: `${teamId} ${id}`, kind: "work", status: "pending", blockedBy: [], createdAt: "2026-10-19T00:00:00.000Z", updatedAt: "2026-10-19T00:00:00.000Z", revision: 1 })),
  } as TeamRecord
}

/** The board rows a host would merge for one record's ids. */
const boardOf = (ids: readonly string[]): BoardTask[] => ids.map((id) => ({ id, subject: `task ${id}`, status: "pending", blockedBy: [], depth: 0 }))

// ── 1. THE MAJOR: cross-team attachment ───────────────────────────────────────────────────────────
/** The real team's ids. */
const REAL_IDS = ["T1", "T2", "T3", "T4"]
/** The session that owns the real team. */
const SESSION = "sess-lane-e-major"
/** The real record the session resolves. */
const realRecord = recordOf("team-real", REAL_IDS, SESSION)
/** The foreign team's record: the SAME ids plus its own T5 — the realistic collision. */
const foreignRecord = recordOf("team-foreign", [...REAL_IDS, "T5"], SESSION)
/** The foreign model: five NON-GHOST nodes, so an intersection on `T1` is satisfied and a bijection is not. */
const foreignModel: GraphModel = buildModel({ board: boardOf([...REAL_IDS, "T5"]) })
/** The matching model: exactly the real team's board. */
const matchingModel: GraphModel = buildModel({ board: boardOf(REAL_IDS) })
/** A same-id-set foreign model whose CONTENT differs (the residual the guard cannot see). */
const sameShapeForeign: GraphModel = buildModel({ board: [
  { id: "T1", subject: "other", status: "pending", blockedBy: [], depth: 0 },
  { id: "T2", subject: "other", status: "pending", blockedBy: ["T1"], depth: 0 },
  { id: "T3", subject: "other", status: "pending", blockedBy: [], depth: 0 },
  { id: "T4", subject: "other", status: "pending", blockedBy: ["T3"], depth: 0 },
] })
/** The service calls the join made, with the team id each asked for. */
const graphCalls: Array<string | undefined> = []
/**
 * A HOSTILE service that ignores the team id and always answers the given model — the exact
 * misbehaviour the Major was about.
 * @param model - the model every call returns.
 * @returns the service face the reader accepts.
 */
function hostileService(model: GraphModel, active: TeamRecord | undefined): unknown {
  return {
    active: (): TeamRecord | undefined => active,
    graph: (_workspace: string, teamId?: string): GraphModel => {
      graphCalls.push(teamId)
      return model
    },
  }
}
/** The projection the session draws with the hostile service. */
const hostileWorkflow = readScopedWorkflow({
  workspace: scratch(), sessionId: SESSION, holds: [],
  teams: hostileService(foreignModel, realRecord) as never,
  records: [realRecord, foreignRecord], views: [],
})
/** The same read with a matching model, the positive control. */
graphCalls.length = 0
const controlWorkflow = readScopedWorkflow({
  workspace: scratch(), sessionId: SESSION, holds: [],
  teams: hostileService(matchingModel, realRecord) as never,
  records: [realRecord], views: [],
})
/** The residual: a same-id-set foreign model. */
graphCalls.length = 0
const residualWorkflow = readScopedWorkflow({
  workspace: scratch(), sessionId: SESSION, holds: [],
  teams: hostileService(sameShapeForeign, realRecord) as never,
  records: [realRecord], views: [],
})
/** One minimal official view this session owns, enough for the reader's task projection. */
const officialView = { leadSessionId: SESSION, tasks: [{ id: "T1", subject: "official", status: "pending" }], members: [] }
// THE TWO OFFICIAL-VIEW ARMS MUST NOT CALL THE SERVICE AT ALL.
graphCalls.length = 0
const officialSessionWorkflow = readScopedWorkflow({
  workspace: scratch(), sessionId: SESSION, holds: [],
  teams: { graph: (_workspace: string, teamId?: string): GraphModel => { graphCalls.push(teamId); return matchingModel } } as never,
  records: [], views: [officialView as never],
})
/** The calls the session-view arm made (expected: none). */
const officialSessionCalls = graphCalls.length
graphCalls.length = 0
const officialWorkspaceWorkflow = readScopedWorkflow({
  workspace: scratch(), sessionId: undefined, holds: [],
  teams: { graph: (_workspace: string, teamId?: string): GraphModel => { graphCalls.push(teamId); return matchingModel } } as never,
  records: [], views: [{ ...officialView, leadSessionId: "another-session" } as never],
})
/** The calls the workspace-view arm made (expected: none). */
const officialWorkspaceCalls = graphCalls.length
// THE RECORD ARM MUST NAME ITS TEAM.
graphCalls.length = 0
readScopedWorkflow({
  workspace: scratch(), sessionId: SESSION, holds: [],
  teams: hostileService(matchingModel, realRecord) as never,
  records: [realRecord], views: [],
})
/** The team id the record arm asked for. */
const recordArmTeamId = graphCalls[0]

// ── 2a. A PLAN CREATED WHERE NONE EXISTED ─────────────────────────────────────────────────────────
/** The event workspace. */
const createdWs = scratch()
mkdirSync(join(createdWs, ".mpd", "team", "teams"), { recursive: true })
const createdRecord = recordOf("team-created", ["T1", "T2"], "sess-created")
writeFileSync(join(createdWs, ".mpd", "team", "teams", "team-created.json"), JSON.stringify(createdRecord, null, 1))
/** Plan notifications the host cache published. */
const createdNotifies: number[] = []
const createdModels = new GraphModels({
  revision: (): number => 0,
  notify: (): void => { createdNotifies.push(Date.now()) },
  warn: (): void => {},
})
/** The model before any plan exists. */
const beforePlan = createdModels.get(createdWs, readTeam(createdWs, "team-created") as TeamRecord)
/** The moment the plan file was created. */
const createAt = Date.now()
mkdirSync(plansDirectory(createdWs), { recursive: true })
writeFileSync(join(plansDirectory(createdWs), "task-plan.md"), "## TODOs\n\n- [ ] 1. Alpha\n- [ ] 9. Late ghost\n")
/**
 * Wait for a notify, or record the timeout.
 * @param count - how many notifies to wait for.
 * @param ms - the wait budget.
 * @returns the wait's outcome.
 */
async function waitNotify(count: number, ms = 5000): Promise<{ ok: boolean; latencyMs: number }> {
  const start = Date.now()
  while (Date.now() - start < ms) {
    if (createdNotifies.length >= count) return { ok: true, latencyMs: createdNotifies[count - 1] - createAt }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  return { ok: false, latencyMs: Date.now() - start }
}
/** The creation event's outcome. */
const creation = await waitNotify(1)
/** The model after the creation event. */
const afterPlan = createdModels.get(createdWs, readTeam(createdWs, "team-created") as TeamRecord)
createdModels.dispose()

// ── 2b. A DIRECTORY REPLACED AT THE SAME PATH ─────────────────────────────────────────────────────
/** The replace workspace. */
const replaceWs = scratch()
const boardDir = join(replaceWs, "boards")
mkdirSync(boardDir, { recursive: true })
writeFileSync(join(boardDir, "a.json"), JSON.stringify([{ id: "T1" }]))
/** Batches the raw watcher delivered. */
const replaceBatches: GraphChangeEvent[] = []
const replaceWatcher = watchGraph({ boardDir }, { debounceMs: 150, onChange: (event) => { replaceBatches.push(event) } })
/**
 * Wait for the next batch.
 * @param count - how many batches to wait for.
 * @param ms - the wait budget.
 * @returns whether it arrived.
 */
async function waitBatch(count: number, ms = 5000): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < ms) {
    if (replaceBatches.length >= count) return true
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  return false
}
await new Promise((resolve) => setTimeout(resolve, 50))
// REPLACE the directory in place: remove it and recreate it with NEW files inside one window.
rmSync(boardDir, { recursive: true, force: true })
mkdirSync(boardDir, { recursive: true })
writeFileSync(join(boardDir, "a.json"), JSON.stringify([{ id: "T2" }]))
writeFileSync(join(boardDir, "b.json"), JSON.stringify([{ id: "T3" }]))
/** Whether the replacement produced a batch. */
const replacedBatch = await waitBatch(1)
// AFTER re-arm, a LATER write must still arrive — this is what proves the watch moved to the new inode.
await new Promise((resolve) => setTimeout(resolve, 250))
writeFileSync(join(boardDir, "c.json"), JSON.stringify([{ id: "T4" }]))
/** Whether the post-re-arm write produced a second batch. */
const postReplaceBatch = await waitBatch(2)
replaceWatcher.close()

// ── 2c. A PLAN PATH THAT RESOLVES DIFFERENTLY WITH NO REVISION BUMP ──────────────────────────────
/** The swap workspace. */
const swapWs = scratch()
mkdirSync(join(swapWs, ".mpd", "team", "teams"), { recursive: true })
mkdirSync(plansDirectory(swapWs), { recursive: true })
const swapRecord = recordOf("team-swap", ["T1", "T2"], "sess-swap")
writeFileSync(join(swapWs, ".mpd", "team", "teams", "team-swap.json"), JSON.stringify(swapRecord, null, 1))
writeFileSync(join(plansDirectory(swapWs), "alpha.md"), "## TODOs\n\n- [ ] 8. Ghost A\n")
const swapModels = new GraphModels({ revision: (): number => 0, notify: (): void => {}, warn: (): void => {} })
const swapFirst = swapModels.get(swapWs, readTeam(swapWs, "team-swap") as TeamRecord)
await new Promise((resolve) => setTimeout(resolve, 20))
writeFileSync(join(plansDirectory(swapWs), "gamma.md"), "## TODOs\n\n- [ ] 9. Ghost B\n")
const swapSecond = swapModels.get(swapWs, readTeam(swapWs, "team-swap") as TeamRecord)
swapModels.dispose()

// ── 3. THE PARSER'S LANE STRIPPING IS DECLARED-ONLY ──────────────────────────────────────────────
const undeclared = parsePlanMarkdown("## TODOs\n\n- [ ] 1. Core — the work\n")
const declared = parsePlanMarkdown("## TODOs\n\n- [ ] 1. Core — the work\n\n| Lane | Owner |\n| --- | --- |\n| Core | Engineer |\n")

/** Every measured fact, as one result. */
const result = {
  probe: "coderabbit-major-and-events",
  at: new Date().toISOString(),
  major: {
    foreignNonGhostIds: foreignModel.nodes.filter((node) => node.planned === false).map((node) => node.id),
    realBoardIds: REAL_IDS,
    foreignRejected: hostileWorkflow.model === undefined,
    foreignPageHasNoServedRanks: dagPageOf(hostileWorkflow)?.ranks === undefined,
    matchingAccepted: controlWorkflow.model !== undefined,
    residualSameIdSetAccepted: residualWorkflow.model !== undefined,
    officialSessionCalls,
    officialWorkspaceCalls,
    officialSessionModelAbsent: officialSessionWorkflow.model === undefined,
    officialWorkspaceModelAbsent: officialWorkspaceWorkflow.model === undefined,
    recordArmTeamId,
  },
  eventPlanCreated: {
    beforeGhosts: beforePlan?.report.planOnly ?? null,
    afterGhosts: afterPlan?.report.planOnly ?? null,
    notifyLatencyMs: creation.latencyMs,
    notified: creation.ok,
  },
  eventDirectoryReplaced: {
    batches: replaceBatches.map((event) => ({ sequence: event.sequence, coalesced: event.coalesced, paths: event.paths.length })),
    replacementDelivered: replacedBatch,
    postReplaceWriteDelivered: postReplaceBatch,
  },
  eventPlanSwap: {
    firstPlanOnly: swapFirst?.report.planOnly ?? null,
    secondPlanOnly: swapSecond?.report.planOnly ?? null,
    revisionConstant: 0,
  },
  parser: { undeclaredTitle: undeclared.tasks[0]?.title ?? null, declaredTitle: declared.tasks[0]?.title ?? null },
  verdict: {
    // The Major: the realistic collision must be REFUSED, a matching model ACCEPTED.
    foreignModelRejected: hostileWorkflow.model === undefined,
    matchingModelAccepted: controlWorkflow.model !== undefined,
    officialArmsNeverAsk: officialSessionCalls === 0 && officialWorkspaceCalls === 0,
    recordArmNamesItsTeam: recordArmTeamId === "team-real",
    // (a) creation is an EVENT that rebuilds the model.
    createdPlanReachesModel: creation.ok && JSON.stringify(afterPlan?.report.planOnly ?? null) === JSON.stringify(["T9"]),
    // (b) the replaced directory is re-armed; a write AFTER the re-arm still arrives.
    replacedDirectorySeen: replacedBatch,
    postReplaceWriteSeen: postReplaceBatch,
    // (c) the swap rebuilds despite an unchanged revision.
    planSwapRebuilds: JSON.stringify(swapFirst?.report.planOnly ?? null) === JSON.stringify(["T8"]) && JSON.stringify(swapSecond?.report.planOnly ?? null) === JSON.stringify(["T9"]),
    // (3) the title keeps an UNDECLARED lane-like prefix, and strips a DECLARED one.
    laneMarkerDeclaredOnly: undeclared.tasks[0]?.title === "Core — the work" && declared.tasks[0]?.title === "the work",
  },
}
writeFileSync(join(HERE, "major-events-result.json"), JSON.stringify(result, null, 1))
console.log(JSON.stringify(result, null, 1))
