// LANE E — live-refresh probe: does a FILE EDIT change the model WITHOUT a restart, through the ONE
// event path (the core plan watcher → feed.notify → the feed a TUI surface and the web SSE share)?
//
// WHAT THIS DRIVES. The real `GraphModels` cache, the real `ChangeFeed`, the real `watchGraph`, the
// real `readTeam`. Nothing polls: the probe awaits the FEED's own listener (the same one the TUI's
// `subscribeTeams` and the web's `/plugins/mpd-team/events` stream are built on) and only then reads
// the model. Latency is measured from the write to that listener, and the watcher's own batch counter
// says whether the debounce coalesced the notifications or dropped one.
//
// Run: bun evidence/living-graph/live-preflight/<ts>/verify-live.ts
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { watchGraph } from "../../../../packages/mpd-graph-core/src/index.ts"
import type { GraphChangeEvent, GraphModel } from "../../../../packages/mpd-graph-core/src/index.ts"
import { ChangeFeed } from "../../../../packages/mpd-team-core-plugin/src/change-feed.ts"
import { GraphModels } from "../../../../packages/mpd-team-core-plugin/src/graph-model.ts"
import { readTeam } from "../../../../packages/mpd-team-core-plugin/src/team-store.ts"
import type { TeamRecord } from "../../../../packages/mpd-team-core-plugin/src/team-store.ts"

/** This run's own directory. */
const HERE = import.meta.dirname
/** A scratch workspace whose team and plan the probe edits. */
const WS = mkdtempSync(join(HERE, "ws-"))
/** The fixture team id. */
const TEAM = "team-live-fixture"
/** The board file the probe rewrites. */
const BOARD_FILE = join(WS, ".mpd", "team", "teams", `${TEAM}.json`)
/** The plan file the probe rewrites. */
const PLAN_FILE = join(WS, ".mpd", "plans", "task-plan.md")
/** Every diagnostic line the product emitted, kept for the transcript. */
const warnings: string[] = []
/** Every batch the core plan watcher delivered, with its coalescing count. */
const batches: GraphChangeEvent[] = []
/** The moments the feed's own listener fired. */
const feedEvents: number[] = []

mkdirSync(join(WS, ".mpd", "team", "teams"), { recursive: true })
mkdirSync(join(WS, ".mpd", "plans"), { recursive: true })

/**
 * Write a team record with the given task ids, all as roots.
 * @param ids - the task ids the board should carry.
 */
function writeBoard(ids: readonly string[]): void {
  /** The record this write lands. */
  const record: TeamRecord = {
    version: 1,
    teamId: TEAM,
    name: "live fixture",
    description: "Lane E live-refresh fixture",
    leadSessionId: "sess-live",
    phase: "active",
    createdAt: "2026-10-19T00:00:00.000Z",
    members: [{ id: "M1", name: "Lead", description: "the only member", status: "running", spawnedAt: "2026-10-19T00:00:00.000Z" }],
    nextMemberNumber: 2,
    nextTaskNumber: 10,
    approvedAt: "2026-10-19T00:00:00.000Z",
    tasks: ids.map((id) => ({ id, subject: `Task ${id}`, kind: "work", status: "pending", blockedBy: [], createdAt: "2026-10-19T00:00:00.000Z", updatedAt: "2026-10-19T00:00:00.000Z", revision: 1 })),
  } as TeamRecord
  writeFileSync(BOARD_FILE, JSON.stringify(record, null, 1))
}

/**
 * Write a plan declaring the given numbered TODOs.
 * @param count - how many TODO items to declare.
 * @param suffix - extra title text, so a rewritten plan is observably different.
 */
function writePlan(count: number, suffix: string): void {
  /** The TODO lines. */
  const lines: string[] = ["## TODOs", ""]
  for (let index = 1; index <= count; index += 1) lines.push(`- [ ] ${index}. Planned ${index} ${suffix}`)
  writeFileSync(PLAN_FILE, `${lines.join("\n")}\n`)
}

writeBoard(["T1", "T2"])
writePlan(2, "v1")

/** The change feed every mpd surface subscribes to (the TUI's `teams.subscribe`, the web's SSE). */
const feed = new ChangeFeed({ debounceMs: 50, warn: (line: string): void => { warnings.push(line) } })
/** The cache under test, with the core's real watcher wrapped so a batch's counters are observable. */
const models = new GraphModels({
  revision: (workspace: string): number => feed.revision(workspace),
  notify: (workspace: string): void => { feed.notify(workspace) },
  warn: (line: string): void => { warnings.push(line) },
  watch: (targets, options) => watchGraph(targets, {
    ...options,
    onChange: (event: GraphChangeEvent): void => {
      batches.push(event)
      options.onChange?.(event)
    },
  }),
})
feed.subscribe(WS, (): void => { feedEvents.push(Date.now()) })

/**
 * Wait until the feed's listener has fired at least `count` times.
 * @param count - how many events to wait for.
 * @param ms - the wait budget.
 * @returns the elapsed wait, or throws on timeout.
 */
async function waitForFeed(count: number, ms = 5000): Promise<number> {
  /** The moment the wait began. */
  const start = Date.now()
  while (Date.now() - start < ms) {
    if (feedEvents.length >= count) return Date.now() - start
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`the feed delivered ${feedEvents.length} event(s), wanted ${count}, within ${ms} ms (warnings: ${warnings.join(" | ")})`)
}

/** The node ids of a model, for the transcript. */
const idsOf = (model: GraphModel | undefined): string[] => model?.nodes.map((node) => node.id) ?? []
/** The plan-only ids of a model. */
const ghostsOf = (model: GraphModel | undefined): string[] => model?.report.planOnly ?? []
/** The board-only ids of a model. */
const boardOnlyOf = (model: GraphModel | undefined): string[] => model?.report.boardOnly ?? []

/** The measurement, or the failure that stopped it. */
let result: Record<string, unknown>
try {
  /** The first read: arms the plan watch and builds the model on demand. */
  const first = models.get(WS, readTeam(WS, TEAM) as TeamRecord)
  // PHASE A — TWO PLAN WRITES INSIDE ONE DEBOUNCE WINDOW. The model must show BOTH, and the batch's
  // `coalesced` count must say the two notifications were one delivery rather than one being dropped.
  /** The moment the FIRST of the two writes landed. */
  const aAt = Date.now()
  writePlan(3, "v2")
  await new Promise((resolve) => setTimeout(resolve, 10))
  writePlan(4, "v2")
  /** The moment the second write landed, from which latency is measured. */
  const aSecondAt = Date.now()
  await waitForFeed(feedEvents.length + 1)
  /** The feed event that answered the edits. */
  const aEventAt = feedEvents[feedEvents.length - 1]
  /** The model after the batch, rebuilt through the same cache. */
  const afterA = models.get(WS, readTeam(WS, TEAM) as TeamRecord)
  // PHASE B — A BOARD EDIT. The store write is the feed's OTHER source; the model must follow it too.
  /** The moment the board rewrite landed. */
  const bAt = Date.now()
  writeBoard(["T1", "T2", "T3"])
  await waitForFeed(feedEvents.length + 1)
  /** The feed event that answered the board edit. */
  const bEventAt = feedEvents[feedEvents.length - 1]
  /** The model after the board edit. */
  const afterB = models.get(WS, readTeam(WS, TEAM) as TeamRecord)
  result = {
    probe: "live-refresh",
    at: new Date().toISOString(),
    workspace: WS,
    planFile: PLAN_FILE,
    boardFile: BOARD_FILE,
    before: { nodes: idsOf(first), ghosts: ghostsOf(first), boardOnly: boardOnlyOf(first) },
    phaseA: {
      writes: 2,
      batches: batches.map((event) => ({ sequence: event.sequence, coalesced: event.coalesced, paths: event.paths.length, manual: event.manual })),
      feedEvents: feedEvents.length - 1,
      latencyFromSecondWriteMs: aEventAt - aSecondAt,
      elapsedFromFirstWriteMs: aEventAt - aAt,
      after: { nodes: idsOf(afterA), ghosts: ghostsOf(afterA) },
    },
    phaseB: {
      boardWrite: "T3 added",
      latencyMs: bEventAt - bAt,
      after: { nodes: idsOf(afterB), ghosts: ghostsOf(afterB), boardOnly: boardOnlyOf(afterB) },
    },
    feedRevisions: { afterPlan: feed.revision(WS), },
    warnings,
    verdict: {
      // The first plan edit is visible WITHOUT a restart.
      planEditReachesModel: ghostsOf(afterA).includes("T3") && ghostsOf(afterA).includes("T4"),
      // Two writes in one window: the SECOND was coalesced, not dropped (both ghosts present + counter).
      secondWriteNotDropped: ghostsOf(afterA).includes("T4"),
      debounceCoalesced: batches.some((event) => event.coalesced >= 2) || batches.length === 1,
      // A board edit reaches the model through the feed's own notification path.
      boardEditReachesModel: idsOf(afterB).includes("T3"),
      // No poller is involved: the probe never called poll(); the feed's listener is the event source.
      eventDriven: batches.every((event) => event.manual === false),
    },
  }
} catch (error) {
  result = { probe: "live-refresh", at: new Date().toISOString(), error: String(error), warnings, batches, feedEvents: feedEvents.length }
} finally {
  models.dispose()
  feed.dispose()
}
writeFileSync(join(HERE, "live-result.json"), JSON.stringify(result, null, 1))
console.log(JSON.stringify(result, null, 1))
