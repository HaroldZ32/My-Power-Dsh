// LANE E — plane preflight: does the TUI drawing receive the MODEL's edges, or only the board's?
//
// THE QUESTION. The frozen contract's six-case table says a plan-declared edge must be DRAWN
// ("edge in the plan, absent from the board | drawn, marked declared"), and Amendment 3 makes the
// host compute ONE model both planes draw. The web plane draws `model.edges`; the TUI draws
// `task.dependencies` through `graph.ts`. `modelRows` joins the model's nodes into the board rows —
// but does it carry the node's dependency UNION, or does it keep the board's own `blockedBy`?
// This harness measures the exact value the TUI layout would draw an edge from.
//
// Run: bun evidence/living-graph/plane-preflight/<ts>/verify-tui-edges.ts
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { buildModel, parsePlanMarkdown } from "../../../../packages/mpd-graph-core/src/index.ts"
import type { BoardTask, GraphModel } from "../../../../packages/mpd-graph-core/src/index.ts"
import { readScopedWorkflow } from "../../../../packages/mpd-tui-plugin/src/team-state.ts"
import { dagPageOf, dagPanelLayout } from "../../../../packages/mpd-tui-plugin/src/panel-dag.ts"
import type { TeamRecord } from "../../../../packages/mpd-team-core-plugin/src/team-store.ts"

/** This run's own directory. */
const HERE = import.meta.dirname
/** The scratch workspace the team record is written into. */
const WS = mkdtempSync(join(HERE, "ws-"))
/** The fixture team's id. */
const TEAM = "team-plane-fixture"
/** The session that owns the fixture team. */
const SESSION = "sess-lane-e"
/** The plan fixture: T2 and T4 get plan-only blocker edges; T5 is a plan-only ghost. */
const PLAN = `## TODOs

- [ ] 1. Anchor
- [ ] 2. Middle (blocked by 1)
- [ ] 3. Side
- [ ] 4. Leaf (blocked by: 2)
- [ ] 5. Ghost (blocked by 4)
`
/** The board fixture, in the shipped record shape; T2 and T4 carry NO board blocker. */
const RECORD: TeamRecord = {
  version: 1,
  teamId: TEAM,
  name: "plane fixture",
  description: "Lane E plane discriminator",
  leadSessionId: SESSION,
  phase: "active",
  createdAt: "2026-10-19T00:00:00.000Z",
  members: [{ id: "M1", name: "Lead", description: "the only member", status: "running", spawnedAt: "2026-10-19T00:00:00.000Z" }],
  nextMemberNumber: 2,
  nextTaskNumber: 6,
  approvedAt: "2026-10-19T00:00:00.000Z",
  tasks: [
    { id: "T1", subject: "Anchor", kind: "requirement", status: "completed", owner: "Lead", blockedBy: [], createdAt: "2026-10-19T00:00:00.000Z", updatedAt: "2026-10-19T00:00:00.000Z", revision: 1 },
    { id: "T2", subject: "Middle", kind: "work", status: "in_progress", owner: "Lead", blockedBy: [], createdAt: "2026-10-19T00:00:00.000Z", updatedAt: "2026-10-19T00:00:00.000Z", revision: 1 },
    { id: "T3", subject: "Side", kind: "work", status: "pending", owner: "Lead", blockedBy: ["T1"], createdAt: "2026-10-19T00:00:00.000Z", updatedAt: "2026-10-19T00:00:00.000Z", revision: 1 },
    { id: "T4", subject: "Leaf", kind: "work", status: "pending", owner: "Lead", blockedBy: ["T2"], createdAt: "2026-10-19T00:00:00.000Z", updatedAt: "2026-10-19T00:00:00.000Z", revision: 1 },
  ],
} as TeamRecord

// Write the record where the team store reads it, so the fixture is read through the real path.
mkdirSync(join(WS, ".mpd", "team", "teams"), { recursive: true })
writeFileSync(join(WS, ".mpd", "team", "teams", `${TEAM}.json`), JSON.stringify(RECORD, null, 1))

/** The board rows the host would merge: served depth is the store's own longest-path value. */
const BOARD: BoardTask[] = [
  { id: "T1", subject: "Anchor", kind: "requirement", status: "completed", owner: "Lead", blockedBy: [], depth: 0 },
  { id: "T2", subject: "Middle", kind: "work", status: "in_progress", owner: "Lead", blockedBy: [], depth: 0 },
  { id: "T3", subject: "Side", kind: "work", status: "pending", owner: "Lead", blockedBy: ["T1"], depth: 1 },
  { id: "T4", subject: "Leaf", kind: "work", status: "pending", owner: "Lead", blockedBy: ["T2"], depth: 1 },
]
/** The ONE model the host would serve both planes. */
const model: GraphModel = buildModel({ board: BOARD, plan: parsePlanMarkdown(PLAN) })
// THE SHARED-FIXTURE GUARD: this probe keeps its own copy of the fixture so it reads as one file, and
// this comparison against `fixture.ts` (the copy the WEB probe imports) makes a drift between the two
// probes a loud failure rather than two arms quietly measuring different inputs.
import { MODEL as SHARED_MODEL, PLAN as SHARED_PLAN, RECORD as SHARED_RECORD, SESSION as SHARED_SESSION } from "./fixture.ts"
if (JSON.stringify(model) !== JSON.stringify(SHARED_MODEL) || PLAN !== SHARED_PLAN || JSON.stringify(RECORD) !== JSON.stringify(SHARED_RECORD) || SESSION !== SHARED_SESSION) {
  throw new Error("the TUI probe's fixture drifted from fixture.ts")
}
/** The `mpdTeams` face the TUI reads, narrowed to the two methods this read path calls. */
const teams = {
  active: (): TeamRecord | undefined => RECORD,
  graph: (): GraphModel => model,
}
/** The projection every TUI surface draws. */
const workflow = readScopedWorkflow({ workspace: WS, sessionId: SESSION, holds: [], teams: teams as never, records: [RECORD], views: [] })
/** The DAG page's own projection. */
const page = dagPageOf(workflow)
/** The layout the panel actually draws, at a width wide enough for boxes. */
const layout = page === undefined ? undefined : dagPanelLayout(page.tasks, 160, undefined, 40, page.ranks)

/** The model's own edge list, for the comparison. */
const modelEdges = model.edges.map((edge) => `${edge.from}->${edge.to}:${edge.source}`)
/** The dependency lists the TUI layout's edge composer would read, per drawn task. */
const tuiDeps = page?.tasks.map((task) => ({ id: task.id, dependencies: [...task.dependencies], depth: task.depth })) ?? []
/** The rank map the page handed the layout. */
const ranks = page?.ranks === undefined ? null : [...page.ranks.entries()].sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
/** The drawn rows of each task, read from the layout's hit rectangles. */
const hitRows = layout?.view.hits.map((hit) => `${hit.taskId}@${hit.row}`) ?? []
/** Whether every model edge's `to` row sits strictly BELOW its `from` row in the drawing. */
const drawnEdgeSource = tuiDeps.flatMap((task) => task.dependencies.map((from) => `${from}->${task.id}`))

/** The measured result. */
const result = {
  at: new Date().toISOString(),
  fixture: { workspace: WS, plan: PLAN, modelEdges, modelRanks: ranks },
  tui: { scope: workflow.scope, tasks: tuiDeps, ranks, drawnEdgeSource, hitRows },
  layoutMode: layout?.mode ?? null,
  // THE MODE LINE the panel prints: `ranks <derived|served>` from the DRAWING's own flag, next to the
  // MODEL's own report. They should tell a reader the same story about the same picture.
  ranksSource: { layoutRanksDerived: layout?.ranksDerived ?? null, modelRanksDerived: MODEL.report.ranksDerived, pageHasServedRanks: page?.ranks !== undefined },
  // THE TWO OBSERVATIONS THE CONTRACT TURNS ON:
  // 1. Does the TUI see the plan-only edges? Its edge source is each drawn task's `dependencies`.
  // 2. Do the ranks follow the MODEL (T2=1, T4=2) or the board's own depth (T2=0, T4=1)?
  verdict: {
    tuiSeesPlanOnlyEdgeT1toT2: drawnEdgeSource.includes("T1->T2"),
    tuiSeesPlanOnlyEdgeT2toT4: drawnEdgeSource.includes("T2->T4"),
    ranksFollowModel: ranks !== null && ranks.some(([id, rank]) => id === "T2" && rank === 1) && ranks.some(([id, rank]) => id === "T4" && rank === 2),
    ghostDrawn: (page?.tasks ?? []).some((task) => task.id === "T5" && task.planned === true),
  },
}
writeFileSync(join(HERE, "result.json"), JSON.stringify(result, null, 1))
console.log(JSON.stringify(result, null, 1))
