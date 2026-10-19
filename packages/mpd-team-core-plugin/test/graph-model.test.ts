// THE HOST'S ONE GRAPH COMPUTATION SITE: the served model, the per-team cache and the plan watch.
//
// WHY THESE ARMS EXIST (`.mpd/plans/living-graph.md`, Amendment 3). Both planes draw ONE model, and it
// is computed here — by `mpd-team-core-plugin`, from `mpd-graph-core` — so a session's web payload and
// the TUI service answer with the SAME ranks and edges. The arms below pin the three facts that make
// that true rather than an intention: the model reaches BOTH projections ADDITIVELY, the cache is per
// TEAM and invalidated by the change feed's revision, and a plan-file batch is funnelled into the SAME
// feed instead of opening a second notification channel a surface would have to learn about.
import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { GraphModels } from "../src/graph-model"
import { resolvePlanFile } from "../../mpd-graph-core/src/index.ts"
import { TEAM_STATE_PATH, buildTeamState, registerTeamRoutes } from "../src/team-web"
import { addTeamTask, createTeam, writeTeam, type TeamRecord } from "../src/team-store"
import type { GraphChangeEvent, GraphModel, GraphWatchOptions, GraphWatchTargets, GraphWatcher } from "../../mpd-graph-core/src/index.ts"

/** The frozen instant every record in this file is stamped with. */
const NOW = new Date("2026-10-19T09:00:00.000Z")
/** The executor read every payload arm reports. */
const EXECUTOR = { kind: "native", reason: "native: the default backend" }

/** The sandboxes this file created, removed after every arm. */
const sandboxes: string[] = []
afterEach(() => { for (const dir of sandboxes.splice(0)) rmSync(dir, { recursive: true, force: true }) })

/**
 * A workspace holding a team record and one plan file.
 *
 * The record is built through the STORE so the fixture cannot drift from the real shape; the plan is
 * the markdown the parser reads — one TODO per line, the second declaring its edge.
 * @param plan - the plan markdown to write under `.mpd/plans/wave.md`.
 * @returns the workspace path and the record written into it.
 */
function workspaceWith(plan: string): { workspace: string; team: TeamRecord } {
  /** A fresh sandbox, so the store's own writes never touch another arm. */
  const workspace = mkdtempSync(join(tmpdir(), "mpd-graph-model-"))
  sandboxes.push(workspace)
  mkdirSync(join(workspace, ".mpd", "plans"), { recursive: true })
  writeFileSync(join(workspace, ".mpd", "plans", "wave.md"), plan)
  /** The record, built task by task through the store. */
  let team = createTeam(workspace, { name: "wave-1", description: "one model", leadSessionId: "sess-1" }, NOW)
  team = addTeamTask(team, { subject: "Build the core", description: "own it", kind: "work" }, NOW)
  team = addTeamTask(team, { subject: "Review it", description: "judge it", kind: "review", blockedBy: ["T1"] }, NOW)
  writeTeam(workspace, team)
  return { workspace, team }
}

/** The plan whose first two TODOs the board carries, whose third is a GHOST, and whose second declares its edge. */
const PLAN: string = [
  "## TODOs",
  "",
  "1. Build the core",
  "2. Review it (blocked by 1)",
  "3. Plan-only follow-up",
  "",
].join("\n")

/** A watcher double: the cache registers a batch listener, and the arm fires it by hand. */
interface WatchDouble {
  /** The factory the cache must be given instead of `watchGraph`. */
  make: (targets: GraphWatchTargets, options: GraphWatchOptions) => GraphWatcher
  /** Deliver one batch, which in production a plan write would. */
  fire: () => void
  /** How many times the cache closed the watcher it armed. */
  closes: () => number
  /** How many watchers the cache armed. */
  armed: () => number
  /** The targets the LAST armed watcher was given, so a re-arm is observable. */
  targets: () => GraphWatchTargets | undefined
}

/**
 * Build a watcher double that records what the cache asked for and lets an arm fire a batch.
 * @returns the factory, the batch trigger, the counters and the captured targets.
 */
function watchDouble(): WatchDouble {
  /** The listener the cache registered through `onChange`. */
  let listener: ((event: GraphChangeEvent) => void) | undefined
  /** How many watchers were armed. */
  let armed = 0
  /** How many times a watcher was closed. */
  let closes = 0
  /** The targets of the last armed watcher. */
  let lastTargets: GraphWatchTargets | undefined
  return {
    make: (targets: GraphWatchTargets, options: GraphWatchOptions): GraphWatcher => {
      armed += 1
      lastTargets = targets
      listener = options.onChange
      return {
        subscribe: (next: (event: GraphChangeEvent) => void): (() => void) => { listener = next; return (): void => { listener = undefined } },
        poll: (): boolean => false,
        close: (): void => { closes += 1 },
        watching: true,
        closed: false,
        sequence: 0,
        coalesced: 0,
      }
    },
    fire: (): void => { listener?.({ paths: ["/ws/.mpd/plans/wave.md"], manual: false, sequence: 1, coalesced: 1 }) },
    closes: (): number => closes,
    armed: (): number => armed,
    targets: (): GraphWatchTargets | undefined => lastTargets,
  }
}

/**
 * A cache wired to a mutable revision, a notification counter and the watcher double.
 * @returns the cache, the counters and a function that "changes" the workspace.
 */
function cacheFixture(): { models: GraphModels; notifies: () => number; bump: () => void; watch: WatchDouble } {
  /** The revision the cache sees; a real feed bumps it on every change window. */
  let revision = 0
  /** How many times the cache asked the feed to publish a change. */
  let notifies = 0
  /** The watcher double. */
  const watch = watchDouble()
  /** The cache under test. */
  const models = new GraphModels({
    revision: (): number => revision,
    notify: (): void => { notifies += 1; revision += 1 },
    watch: watch.make,
  })
  return { models, notifies: (): number => notifies, bump: (): void => { revision += 1 }, watch }
}

describe("the model is computed with the shared core and cached per team", () => {
  test("the served model merges the board and the plan, ghosts included", () => {
    /** The workspace and its record. */
    const { workspace, team } = workspaceWith(PLAN)
    /** The cache wired to counters. */
    const fixture = cacheFixture()
    /** The served model. */
    const model = fixture.models.get(workspace, team) as GraphModel
    expect(model).toBeDefined()
    // THE PLAN'S CONTRIBUTION: a node only the plan declares is a GHOST, never dropped.
    expect(model.nodes.map((node) => node.id).sort()).toEqual(["T1", "T2", "T3"])
    expect(model.nodes.find((node) => node.id === "T3")?.planned).toBe(true)
    expect(model.report.planOnly).toEqual(["T3"])
    // THE CORE'S RANKS: T3 is a root, T2 sits one step past T1 — and `node.depth` IS the rank.
    expect(model.nodes.find((node) => node.id === "T1")?.depth).toBe(0)
    expect(model.nodes.find((node) => node.id === "T2")?.depth).toBe(1)
    expect(model.nodes.find((node) => node.id === "T3")?.depth).toBe(0)
    expect(model.edges.map((edge) => [edge.from, edge.to])).toEqual([["T1", "T2"]])
    expect(model.report.ranksDerived).toBe(true)
    fixture.models.dispose()
  })

  test("one team's model is not another team's: the cache key carries the team id", () => {
    /** The workspace, whose plan declares T1..T3. */
    const { workspace, team } = workspaceWith(PLAN)
    /** A SECOND record in the same workspace, with a board of its own. */
    let other = createTeam(workspace, { name: "wave-2", description: "another", leadSessionId: "sess-2" }, NOW)
    other = addTeamTask(other, { subject: "Other work", description: "do it", kind: "work" }, NOW)
    writeTeam(workspace, other)
    /** The cache wired to counters. */
    const fixture = cacheFixture()
    /** The first team's model. */
    const first = fixture.models.get(workspace, team) as GraphModel
    /** The second team's model. */
    const second = fixture.models.get(workspace, other) as GraphModel
    expect(second).not.toBe(first)
    // THE SAME ID IS A BOARD NODE IN ONE AND A GHOST IN THE OTHER — the wrong-picture bug this key
    // prevents: T2 is on the first board and only in the plan for the second.
    expect(first.nodes.find((node) => node.id === "T2")?.planned).toBe(false)
    expect(second.nodes.find((node) => node.id === "T2")?.planned).toBe(true)
    expect(second.nodes.find((node) => node.id === "T3")?.planned).toBe(true)
    // The second board's own task is a plan task too, so it stays a BOARD node there.
    expect(second.nodes.find((node) => node.id === "T1")?.planned).toBe(false)
    fixture.models.dispose()
  })

  test("the cache answers the SAME value until the revision moves, then rebuilds", () => {
    /** The workspace and its record. */
    const { workspace, team } = workspaceWith(PLAN)
    /** The cache wired to counters. */
    const fixture = cacheFixture()
    /** The first read. */
    const first = fixture.models.get(workspace, team)
    /** A second read inside the same revision window. */
    const again = fixture.models.get(workspace, team)
    expect(again).toBe(first)
    // A PLAN EDIT ALONE DOES NOT INVALIDATE: the file changed but no change window opened, so the
    // cached value is still the served one — exactly why the plan watcher must notify the feed.
    writeFileSync(join(workspace, ".mpd", "plans", "wave.md"), PLAN + "\n4. Fourth task\n")
    expect(fixture.models.get(workspace, team)).toBe(first)
    // THE REVISION IS THE KEY: once the feed publishes a change, the next read rebuilds.
    fixture.bump()
    /** The model after the revision moved. */
    const rebuilt = fixture.models.get(workspace, team) as GraphModel
    expect(rebuilt).not.toBe(first)
    expect(rebuilt.nodes.map((node) => node.id)).toContain("T4")
    fixture.models.dispose()
  })

  test("a plan path that RESOLVES DIFFERENTLY rebuilds the model with NO revision change", () => {
    // THE DEFECT THIS ARM PINS (CodeRabbit, Data Integrity): the model cache was valid while the TEAM
    // matched, so a plan file that resolves differently — the newest-plan fallback swapping to a newer
    // file — kept serving a stale model. `ensurePlanWatch` resolved the path a SECOND time, so the cache
    // and the watcher could even follow different files. Here the revision does NOT move and no
    // notification is fired: the PATH alone must make the cache rebuild.
    /** A fresh sandbox. */
    const workspace = mkdtempSync(join(tmpdir(), "mpd-graph-swap-"))
    sandboxes.push(workspace)
    /** The plans directory, which holds the two files this arm swaps between. */
    const plans = join(workspace, ".mpd", "plans")
    mkdirSync(plans, { recursive: true })
    // THE OLD ANSWER: for now the only file, so `resolvePlanFile` names it.
    writeFileSync(join(plans, "z-swap-old.md"), PLAN)
    /** The record written into that workspace. */
    let team = createTeam(workspace, { name: "wave-swap", description: "swap", leadSessionId: "sess-1" }, NOW)
    team = addTeamTask(team, { subject: "Build the core", description: "own it", kind: "work" }, NOW)
    team = addTeamTask(team, { subject: "Review it", description: "judge it", kind: "review", blockedBy: ["T1"] }, NOW)
    writeTeam(workspace, team)
    /** The cache wired to counters. */
    const fixture = cacheFixture()
    /** The model built from the OLD plan. */
    const before = fixture.models.get(workspace, team) as GraphModel
    expect(before.nodes.map((node) => node.id)).toContain("T3")
    expect(before.nodes.map((node) => node.id)).not.toContain("T4")
    // THE NEWEST PLAN APPEARS. The name sorts BEFORE the old one too, so even two mtimes landing in the
    // same millisecond resolve to the new file (the core's own name tie-break).
    /** The newer file, which `resolvePlanFile` must now answer. */
    const newer = join(plans, "a-swap-new.md")
    writeFileSync(newer, PLAN + "\n4. Newer plan task\n")
    expect(resolvePlanFile(workspace)).toBe(newer)
    // NOBODY TOLD THE CACHE: no feed notification was fired, so only the path comparison can save it.
    expect(fixture.notifies()).toBe(0)
    /** The model built after the swap, which must be rebuilt against the new file. */
    const after = fixture.models.get(workspace, team) as GraphModel
    expect(after).not.toBe(before)
    expect(after.nodes.map((node) => node.id)).toContain("T4")
    // AND THE WATCHER MOVED WITH IT: re-armed against the SAME path the read used, not left on the old
    // file — the split this patch exists to close.
    expect(fixture.watch.targets()?.planFile).toBe(newer)
    fixture.models.dispose()
  })

  test("a workspace with NO plan file still arms the plans directory, so the FIRST plan notifies", () => {
    // THE OTHER HALF OF THE SAME BLIND SPOT: `ensurePlanWatch` used to return early when no plan existed,
    // so the first plan file ever created in a workspace fired nothing at all.
    /** A fresh sandbox with a team but no `.mpd/plans` directory. */
    const workspace = mkdtempSync(join(tmpdir(), "mpd-graph-noplan-"))
    sandboxes.push(workspace)
    /** The record written into that workspace. */
    let team = createTeam(workspace, { name: "wave-empty", description: "no plan", leadSessionId: "sess-1" }, NOW)
    team = addTeamTask(team, { subject: "Build the core", description: "own it", kind: "work" }, NOW)
    writeTeam(workspace, team)
    /** The cache wired to counters. */
    const fixture = cacheFixture()
    expect(fixture.models.get(workspace, team)).toBeDefined()
    // ARMED ANYWAY: the directory target covers a plan that does not exist yet.
    expect(fixture.watch.armed()).toBe(1)
    expect(fixture.watch.targets()?.planFile).toBeUndefined()
    expect(String(fixture.watch.targets()?.plansDir).endsWith(join(".mpd", "plans"))).toBe(true)
    fixture.models.dispose()
  })

  test("a plan-file batch is funnelled into the SAME feed, and drops the cached model", () => {
    /** The workspace and its record. */
    const { workspace, team } = workspaceWith(PLAN)
    /** The cache wired to counters. */
    const fixture = cacheFixture()
    /** The first read, which arms the plan watcher. */
    const first = fixture.models.get(workspace, team)
    expect(fixture.watch.armed()).toBe(1)
    expect(fixture.notifies()).toBe(0)
    // THE FUNNEL: the watcher's batch calls the feed's own notify (here counted), which bumps the
    // revision, and the next read rebuilds — one channel, not a second one.
    writeFileSync(join(workspace, ".mpd", "plans", "wave.md"), PLAN + "\n4. Fourth task\n")
    fixture.watch.fire()
    expect(fixture.notifies()).toBe(1)
    /** The model after the funneled batch. */
    const rebuilt = fixture.models.get(workspace, team) as GraphModel
    expect(rebuilt).not.toBe(first)
    expect(rebuilt.nodes.map((node) => node.id)).toContain("T4")
    fixture.models.dispose()
  })

  test("dispose closes the watcher, and a disposed cache serves nothing", () => {
    /** The workspace and its record. */
    const { workspace, team } = workspaceWith(PLAN)
    /** The cache wired to counters. */
    const fixture = cacheFixture()
    expect(fixture.models.get(workspace, team)).toBeDefined()
    expect(fixture.watch.closes()).toBe(0)
    fixture.models.dispose()
    expect(fixture.watch.closes()).toBe(1)
    // IDEMPOTENT: a second dispose closes nothing twice, and a late read answers undefined rather than
    // reviving a watcher the row has already released.
    fixture.models.dispose()
    expect(fixture.watch.closes()).toBe(1)
    expect(fixture.models.get(workspace, team)).toBeUndefined()
  })
})

describe("the payload carries the model ADDITIVELY, on both projections", () => {
  test("buildTeamState carries the model and each task's served rank", () => {
    /** The workspace and its record. */
    const { workspace, team } = workspaceWith(PLAN)
    /** The cache wired to counters. */
    const fixture = cacheFixture()
    /** The model both projections carry. */
    const model = fixture.models.get(workspace, team) as GraphModel
    /** The payload the route builds. */
    const state = buildTeamState(team, workspace, "sess-1", EXECUTOR, undefined, model)
    expect(state.model).toBe(model)
    // THE PER-TASK RANK: board tasks only (a ghost has no board row), mapped from `GraphNode.depth`.
    /** The served rank of every board task. */
    const ranks: Record<string, number | undefined> = {}
    for (const task of state.tasks) ranks[task.id] = task.rank
    expect(ranks).toEqual({ T1: 0, T2: 1 })
    // THE OLD FIELDS ARE UNTOUCHED: `depth` keeps the store's summary meaning, so a 0.16.x consumer
    // reads exactly what it read before.
    expect(state.tasks.map((task) => task.depth)).toEqual([0, 1])
    fixture.models.dispose()
  })

  test("with NO model the payload is byte-for-byte the pre-wave shape: no `model`, no `rank`", () => {
    /** The workspace and its record. */
    const { workspace, team } = workspaceWith(PLAN)
    /** The payload built the way every pre-wave caller builds it. */
    const state = buildTeamState(team, workspace, "sess-1", EXECUTOR)
    expect(Object.hasOwn(state, "model")).toBe(false)
    for (const task of state.tasks) expect(Object.hasOwn(task, "rank")).toBe(false)
    // AND THE REST IS STILL THERE: the additive rule is about what is added, never what is dropped.
    expect(state.ok).toBe(true)
    expect(state.tasks.length).toBe(2)
    expect(state.counts.total).toBe(2)
    expect(state.team?.id).toBe(team.teamId)
  })

  test("the /state route asks for the model by TEAM and serves the SAME value", () => {
    /** The workspace and its record. */
    const { workspace, team } = workspaceWith(PLAN)
    /** The cache wired to counters. */
    const fixture = cacheFixture()
    /** The model the route must serve. */
    const model = fixture.models.get(workspace, team) as GraphModel
    /** The team id the route asked the model for, so the TEAM addressing is observable. */
    let askedTeam: string | undefined
    /** The captured `/state` handler. */
    let handler: ((req: unknown, res: unknown) => void) | undefined
    /** The body the handler wrote. */
    let body: Record<string, unknown> | undefined
    /** The response double: two methods are all a handler may rely on. */
    const res = {
      writeHead: (): void => {},
      end: (text: string): void => { body = JSON.parse(text) as Record<string, unknown> },
    }
    registerTeamRoutes({ register: (route: { path: string; handler: (req: unknown, res: unknown) => void }) => { if (route.path === TEAM_STATE_PATH) handler = route.handler; return () => {} } }, {
      recordFor: () => team,
      workspace: () => workspace,
      executor: () => EXECUTOR,
      effect: (fn: () => unknown) => fn(),
      warn: () => {},
      graph: (_workspace: string, teamId?: string) => { askedTeam = teamId; return model },
    })
    handler?.({ url: TEAM_STATE_PATH + "?sessionId=sess-1" }, res)
    // THE TEAM ID, NOT THE SESSION: the route asks for the record's own team, which is the only key
    // that cannot hand one team's ghosts to another.
    expect(askedTeam).toBe(team.teamId)
    expect(body?.model).toEqual(model)
    /** The served rank of every row in the wire payload. */
    const ranks = (body?.tasks as Array<Record<string, unknown>>).map((task) => task.rank)
    expect(ranks).toEqual([0, 1])
    fixture.models.dispose()
  })
})
