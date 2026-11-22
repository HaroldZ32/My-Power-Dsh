// THE PER-WORKSPACE HALF OF THE LIBRARY (repair R-W3C, board row T28).
//
// The library is HOME-scoped and cross-project, which is exactly why two answers have to be PER WORKSPACE:
// the merge's in-use gate must see a live team in ANY workspace, and the auto-init cap must count only
// the instances a workspace actually owns. This file pins the workmate side of both — the attribution an
// instance carries, and the two merge defects the reviewer proved (a duplicate source passing the plan,
// and a confirmed apply throwing AFTER it had mutated).
import { afterEach, beforeEach, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { DshToolExec } from "../../mpd-dsh-adapter-plugin/src/index.ts"
import { apply, attuneWorkspaces, WORKSPACE_ATTRIBUTION_CAP } from "../src/index.ts"

/** The sandbox this file's arms run in: a HOME for the library and two workspace roots. */
interface Sandbox {
  /** The HOME the library resolves under. */
  home: string
  /** Workspace A, which hosts the "other project's" live team. */
  a: string
  /** Workspace B, the caller of the merge. */
  b: string
  /** Restore the process state this sandbox changed. */
  restore: () => void
}

/** One arm's sandbox, replaced per test. */
let sb: Sandbox

beforeEach(() => {
  /** The previous HOME, restored by `restore`. */
  const prevHome = process.env.HOME
  /** A fresh HOME, so the library never touches the real one. */
  const home = mkdtempSync(join(tmpdir(), "mpd-wm-attrib-home-"))
  /** The two workspace roots this file's callers come from. */
  const a = mkdtempSync(join(tmpdir(), "mpd-wm-attrib-a-"))
  /** The second workspace root. */
  const b = mkdtempSync(join(tmpdir(), "mpd-wm-attrib-b-"))
  process.env.HOME = home
  sb = { home, a, b, restore: () => { process.env.HOME = prevHome } }
})

afterEach(() => {
  sb.restore()
  rmSync(sb.home, { recursive: true, force: true })
  rmSync(sb.a, { recursive: true, force: true })
  rmSync(sb.b, { recursive: true, force: true })
})

/** The library root inside the current sandbox HOME. */
const root = (): string => join(sb.home, ".mpd", "workmate")

/**
 * Apply the plugin to a fake context whose agent registry reports BOTH workspaces.
 *
 * The union is what `agentlessRoots` reads, so a live team in workspace A is visible to a call made from
 * workspace B — the exact situation the reviewer's probe showed was missed.
 *
 * @returns the registered tools, looked up by name, and the exec for one given workspace.
 */
function makePlugin(reservePublicConsult?: (caller: DshToolExec) => Promise<(() => void) | undefined>): { byName: (name: string) => any; execFrom: (workspace: string) => DshToolExec } {
  /** Every tool descriptor the row registered. */
  const tools: any[] = []
  /** The base template the fake roster serves. */
  const base = { id: "hephaestus", name: "Deep Worker", description: "autonomous goal-driven implementation", readonly: false, chain: [{ provider: "deepseek-official", model: "deepseek-v4-flash" }], persona: "You are the Deep Worker." }
  /** The fake host context. */
  const ctx: any = {
    get: (k: string) => {
      if (k === "mpdRoles") return { list: () => [base], get: () => base }
      if (k === "agents") return { list: () => [{ session: { header: { cwd: sb.a } } }, { session: { header: { cwd: sb.b } } }] }
      if (k === "mpdConsults" && reservePublicConsult !== undefined) return { reservePublicConsult }
      return undefined
    },
    tools: { register: (d: any): void => { tools.push(d) } },
    subagents: { start: async (): Promise<unknown> => ({ result: { structured: { name: "x", summary: "s" } } }) },
    provide: (): void => {},
  }
  apply(ctx)
  return {
    byName: (name: string): any => tools.find((tool) => tool.name === name),
    execFrom: (workspace: string): DshToolExec => ({ agent: { id: workspace, session: { header: { cwd: workspace } } }, signal: new AbortController().signal }),
  }
}

/**
 * Seed one instance directory exactly as `mpd_workmate_init` would leave it.
 *
 * @param name - the instance key.
 * @param note - the note card the merge threshold scores.
 * @param workspaces - the attribution the instance carries.
 */
function seedInstance(name: string, note: string, workspaces: string[] = []): void {
  /** The instance directory. */
  const dir = join(root(), name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "meta.json"), JSON.stringify({
    name, baseId: "hephaestus", baseName: "Deep Worker", description: "autonomous goal-driven implementation",
    provider: "deepseek-official", model: "deepseek-v4-flash", readonly: false,
    createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-02T00:00:00.000Z", uses: 0,
    lastTask: "ship the wave", renamedFrom: [], personaRevision: 1, personaHash: "", baseRevision: "",
    workspaces,
  }, null, 2) + "\n")
  writeFileSync(join(dir, "persona.md"), "You are the Deep Worker.\n")
  writeFileSync(join(dir, "memory.md"), "")
  writeFileSync(join(dir, "note.md"), note + "\n")
}

/**
 * Write one mpd-owned team record naming a member, so the in-use gate sees a live seat.
 *
 * @param workspace - the workspace whose `.mpd/team` carries the record.
 * @param member - the member name (a workmate key, on a bound seat).
 */
function seedLiveTeam(workspace: string, member: string): void {
  /** The team directory of that workspace. */
  const dir = join(workspace, ".mpd", "team", "teams")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "team-1.json"), JSON.stringify({
    version: 1, teamId: "team-1", name: "the live wave", leadSessionId: "sess-1", phase: "active",
    createdAt: "2026-11-02T00:00:00.000Z",
    members: [{ id: "M1", name: member, description: member, status: "running", spawnedAt: "2026-11-02T00:00:00.000Z" }],
    tasks: [],
  }, null, 2))
}

test("attribution: init records the birth workspace, and reuse/bind keep the list newest-first and bounded", async () => {
  // The plugin, applied to a context whose registry reports both workspaces.
  const { byName, execFrom } = makePlugin()
  // One instance born in workspace A.
  await byName("mpd_workmate_init").execute({ base: "Deep Worker", name: "alice" }, execFrom(sb.a))
  /** The instance's metadata after the init. */
  const meta = (): any => JSON.parse(readFileSync(join(root(), "alice", "meta.json"), "utf8"))
  expect(meta().workspaces).toEqual([sb.a])
  // A REUSE from B attributes B ON TOP, newest first.
  await byName("mpd_workmate_spawn").execute({ name: "alice", task: "t" }, execFrom(sb.b))
  expect(meta().workspaces).toEqual([sb.b, sb.a])
  // A REFLECT from A moves A back to the front — the list is an ORDER, not a set.
  await byName("mpd_workmate_reflect").execute({ name: "alice", task: "t", outcome: "o" }, execFrom(sb.a))
  expect(meta().workspaces).toEqual([sb.a, sb.b])
  // The list tool reports the attribution, so a consumer can budget per workspace.
  /** The list tool's rows. */
  const list = await byName("mpd_workmate_list").execute({}, execFrom(sb.a))
  expect(list.workmates.find((row: any) => row.name === "alice").workspaces).toEqual([sb.a, sb.b])
  // THE BOUND: nine more workspaces cannot grow the list past the declared cap, and the oldest falls off.
  for (let index = 0; index < WORKSPACE_ATTRIBUTION_CAP + 1; index++) {
    /** A throwaway workspace root for this iteration. */
    const workspace = mkdtempSync(join(tmpdir(), "mpd-wm-attrib-extra-"))
    await byName("mpd_workmate_spawn").execute({ name: "alice", task: "t" }, execFrom(workspace))
    rmSync(workspace, { recursive: true, force: true })
  }
  expect(meta().workspaces.length).toBe(WORKSPACE_ATTRIBUTION_CAP)
  expect(meta().workspaces[0]).toContain("mpd-wm-attrib-extra-")
  // The helper itself is the one rule: most recent first, de-duplicated, capped.
  expect(attuneWorkspaces([], "")).toEqual([])
  expect(attuneWorkspaces(["x", "y"], "y")).toEqual(["y", "x"])
})

test("simultaneous workmate spawns keep both workspace attributions and a reflect made during admission", async () => {
  /** The two public attempts both wait before writing attribution. */
  const admissions = [Promise.withResolvers<void>(), Promise.withResolvers<void>()]
  /** The public tool invokes the admission service once per caller. */
  let entered = 0
  /** Successful reservations are released individually after the child settles. */
  let released = 0
  /** This double keeps each admission pending until its test-controlled resume. */
  const { byName, execFrom } = makePlugin(async () => {
    /** Reservation order identifies each of the two held calls. */
    const admitted = admissions[entered]
    if (admitted === undefined) throw new Error("Unexpected workmate admission")
    entered += 1
    await admitted.promise
    return (): void => { released += 1 }
  })
  seedInstance("alice", "worker")
  /** The workmate's library documents are shared by all workspace sessions. */
  const metaPath = join(root(), "alice", "meta.json")
  /** The later index write must preserve the fields produced by reflect as well. */
  const indexPath = join(root(), "index.json")
  /** Start both invocations from different sessions while the metadata is still the same. */
  const [fromA, fromB] = [sb.a, sb.b].map((workspace) => byName("mpd_workmate_spawn").execute({ name: "alice", task: "bounded consult" }, execFrom(workspace)))
  try {
    expect(entered).toBe(2)
    // Reflect under a third workspace to establish independent metadata and attribution during the await.
    await byName("mpd_workmate_reflect").execute({ name: "alice", task: "recent reflect", outcome: "kept observation" }, execFrom(sb.home))
    admissions[0].resolve()
    await fromA
    admissions[1].resolve()
    await fromB
    /** The complete record preserves both associations and the reflect. */
    const meta = JSON.parse(readFileSync(metaPath, "utf8"))
    expect(meta).toMatchObject({ workspaces: [sb.b, sb.a, sb.home], uses: 1, lastTask: "recent reflect" })
    expect(JSON.parse(readFileSync(indexPath, "utf8")).alice).toMatchObject({ uses: 1, updatedAt: meta.updatedAt })
    expect(released).toBe(2)
  } finally {
    for (const admission of admissions) admission.resolve()
    await Promise.allSettled([fromA, fromB])
  }
})

test("a TEAM_FIRST workmate refusal leaves metadata unchanged and releases the in-use guard", async () => {
  /** Exercise the wire boundary without a live provider. */
  const { byName, execFrom } = makePlugin(async () => { throw new Error("TEAM_FIRST: consult deferred") })
  await byName("mpd_workmate_init").execute({ base: "Deep Worker", name: "alice" }, execFrom(sb.a))
  /** Capture the exact metadata and index before an attempt from another project. */
  const paths = [join(root(), "alice", "meta.json"), join(root(), "index.json")]
  /** The bytes that must survive the refusal. */
  const before = paths.map((path) => readFileSync(path, "utf8"))
  await expect(byName("mpd_workmate_spawn").execute({ name: "alice", task: "excess consult" }, execFrom(sb.b))).rejects.toThrow(/TEAM_FIRST/)
  expect(paths.map((path) => readFileSync(path, "utf8"))).toEqual(before)
  await byName("mpd_workmate_rename").execute({ name: "alice", new_name: "alice-renamed" }, execFrom(sb.a))
  expect(existsSync(join(root(), "alice-renamed", "meta.json"))).toBe(true)
})

test("B1: the merge's in-use gate sees a live team in ANOTHER workspace (the reviewer's probe)", async () => {
  // The plugin, and a pair that would merge on every other axis.
  const { byName, execFrom } = makePlugin()
  seedInstance("oracle-1", "reviews diffs for correctness and regression risk")
  seedInstance("oracle-2", "reviews diffs for correctness and regression risk")
  // Workspace A hosts a LIVE team using oracle-1; the caller is workspace B.
  seedLiveTeam(sb.a, "oracle-1")
  /** The optimize tool. */
  const optimize = byName("mpd_workmate_optimize")
  // The plan made FROM B must already say in-use — before the fix B saw only its own (empty) team root.
  /** The dry-run result. */
  const dry = await optimize.execute({ pairs: [{ from: "oracle-2", into: "oracle-1" }], dryRun: true }, execFrom(sb.b))
  expect(dry.plan[0].mergeable).toBe(false)
  expect(dry.plan[0].reason).toBe("in-use")
  // And a confirmed call applies nothing.
  /** The confirmed result, which must merge nothing. */
  const applied = await optimize.execute({ pairs: [{ from: "oracle-2", into: "oracle-1" }], confirm: true }, execFrom(sb.b))
  expect(applied.applied).toEqual([])
  expect(existsSync(join(root(), "oracle-2"))).toBe(true)
})

test("B3: a duplicate source is refused at PLAN time, so the dry run is honest and confirm never throws", async () => {
  // Three instances, all of one base, all similar enough to merge.
  const { byName, execFrom } = makePlugin()
  seedInstance("oracle-1", "reviews diffs for correctness and regression risk")
  seedInstance("oracle-2", "reviews diffs for correctness and regression risk")
  seedInstance("oracle-3", "reviews diffs for correctness and regression risk")
  /** The optimize tool. */
  const optimize = byName("mpd_workmate_optimize")
  // THE SAME SOURCE TWICE: the second row is refused while PLANNING, where the defect used to surface
  // only after the first merge had already archived it.
  /** The two rows naming `oracle-2` as the source. */
  const dry = await optimize.execute({ pairs: [{ from: "oracle-2", into: "oracle-1" }, { from: "oracle-2", into: "oracle-3" }], dryRun: true }, execFrom(sb.b))
  expect(dry.plan.map((row: any) => row.mergeable)).toEqual([true, false])
  expect(dry.plan[1].reason).toBe("duplicate-source")
  // The confirmed call cannot throw any more, merges exactly the one row, and reports the other as skipped.
  /** The confirmed result. */
  const applied = await optimize.execute({ pairs: [{ from: "oracle-2", into: "oracle-1" }, { from: "oracle-2", into: "oracle-3" }], confirm: true }, execFrom(sb.b))
  expect(applied.applied.map((row: any) => row.from)).toEqual(["oracle-2"])
  expect(applied.skipped.some((row: any) => row.reason === "duplicate-source")).toBe(true)
  // The library really holds what the result says: the source archived once, the second target untouched.
  expect(existsSync(join(root(), "oracle-2"))).toBe(false)
  expect(existsSync(join(root(), "oracle-3"))).toBe(true)
  /** The archive names present after the apply. */
  const archive = readdirSync(join(root(), ".archive")).sort()
  expect(archive.length).toBe(1)
  expect(archive[0]).toContain("oracle-2-merged-oracle-1")
})
