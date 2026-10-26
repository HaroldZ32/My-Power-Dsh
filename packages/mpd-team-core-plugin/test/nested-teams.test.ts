// NESTED TEAMS (cellwork wave 4, contract D2): the record's parent link, DERIVED at approval from the
// records rather than from a tool argument, and the projection that hands `mpd-graph-core` one group per
// live descendant.
//
// WHY THESE ARMS EXIST. A subcell renders as a BOX whose interior is that subcell's own DAG, and the
// source of that nesting is ONE additive field on the team record. Three facts must therefore be
// MEASURED rather than intended: the field stays ADDITIVE (a root team's record carries no new key), the
// derivation nests exactly when the records say so (a member's team under the team that raised it, a
// Lead's next wave BESIDE it, a dead parent's member's team at the root), and a childless tree keeps the
// byte-identical flat model both planes already draw.
//
// THE SEAM IS (b) IMPLICIT DERIVATION, and the reason is measured: this row's whole tool surface costs
// 4,996 of a 5,000-character budget (`tool-surface.test.ts`), so an explicit `parent_team_id` argument
// would have to be paid for by deleting another tool's description. The parent link is already a FACT the
// workspace holds — the executor recorded the subcaptain's handle on the parent team's roster — so it is
// read from there instead of restated by a model that could mistype it.
import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { apply, TEAMS_SERVICE, type MpdTeamsService } from "../src/index"
import { addTeamTask, createTeam, listTeams, readTeam, writeTeam, type TeamRecord } from "../src/team-store"
import { buildTeamState } from "../src/team-web"
import type { GraphModel } from "../../mpd-graph-core/src/index.ts"

/** The frozen instant every fixture in this file is stamped with. */
const NOW = new Date("2026-10-26T09:00:00.000Z")

/** The sandboxes this file created, removed after every arm. */
const sandboxes: string[] = []
afterEach(() => { for (const dir of sandboxes.splice(0)) rmSync(dir, { recursive: true, force: true }) })

/** One registered tool, typed for the two fields these arms drive. */
interface CapturedTool {
  /** The registered name. */
  name: string
  /** The runner, called with the harness's own exec shape. */
  execute: (args: unknown, exec: unknown) => Promise<unknown>
}

/** The sandbox one arm drives: the workspace, the tool driver and the published read surface. */
interface Harness {
  /** The temp workspace every call resolves to. */
  workspace: string
  /**
   * Drive one registered tool AS a given session.
   * @param name - the tool name.
   * @param args - its arguments.
   * @param sessionId - the calling session.
   * @returns the tool's own answer, or its thrown refusal.
   */
  call: (name: string, args: unknown, sessionId: string) => Promise<unknown>
  /**
   * The `mpdTeams` service the row published.
   * @returns the service, once `apply` ran.
   */
  service: () => MpdTeamsService
}

/**
 * Build the harness: the REAL plugin applied to a stub composition.
 *
 * The stub backend mints one predictable handle per member NAME, and that handle IS the member
 * session's own id in these arms — which is what lets an arm promote a member simply by calling the
 * tools as `child-<name>`.
 * @returns the sandbox.
 */
function harness(): Harness {
  /** A fresh workspace, so no arm sees another arm's records. */
  const workspace = mkdtempSync(join(tmpdir(), "mpd-nested-"))
  sandboxes.push(workspace)
  /** The tools the plugin registered. */
  const tools = new Map<string, CapturedTool>()
  /** The service captured from `ctx.provide`; read through a getter because `apply` runs after this literal. */
  let service: MpdTeamsService | undefined
  /** The stub backend: raises every member and mints a name-derived handle. */
  const executor = {
    kind: "native",
    reason: "the arm's own executor",
    /** The backends this stub claims to provide. */
    providers: (): string[] => ["spawn"],
    /**
     * Record nothing and answer a predictable handle.
     * @param _caller - the staging agent, never inspected.
     * @param request - the raise request, read for the member's name.
     * @returns the handle the record keeps as `executorRef`.
     */
    spawn: async (_caller: unknown, request: { name?: string }): Promise<{ handle: string; executor: string }> => ({
      handle: "child-" + String(request?.name ?? "").replace(/\s+/g, "-"),
      executor: "native",
    }),
    /** Deliver nothing; these arms never dispatch. */
    send: async (): Promise<void> => {},
    /** Interrupt nobody. */
    interrupt: async (): Promise<void> => {},
    /** The backend tracks no live identity — the same blindness as a dsh-tui boot. */
    membership: (): undefined => undefined,
    /** The backend tracks no members; the record is the roster. */
    members: (): [] => [],
  }
  /** The stub adapter: the seams this row uses, and nothing else. */
  const dsh = {
    registerTool: (definition: CapturedTool): (() => void) => { tools.set(definition.name, definition); return () => {} },
    registerCommand: (): (() => void) => () => {},
    workspaceRoot: (): string => workspace,
    text: (value: unknown): unknown => value,
    teamExecutor: (): typeof executor => executor,
    teamMembership: (): undefined => undefined,
    teamListMembers: (): [] => [],
    teamListTasks: (): [] => [],
    capabilities: (): Record<string, never> => ({}),
  }
  /** The minimal cordis context `apply` needs; `provide` captures the read surface it publishes. */
  const ctx = {
    get: (id: string) => (id === "mpdDsh" ? dsh : undefined),
    on: (): void => {},
    effect: (fn: () => unknown) => { try { return fn() ?? (() => {}) } catch { return () => {} } },
    provide: (id: string, value: unknown): void => { if (id === TEAMS_SERVICE) service = value as MpdTeamsService },
    inject: (): void => {},
  }
  apply(ctx as never)
  return {
    workspace,
    call: async (name: string, args: unknown, sessionId: string): Promise<unknown> => {
      /** The registered tool, or a thrown error naming what WAS registered. */
      const tool = tools.get(name)
      if (tool === undefined) throw new Error(`no tool ${name} (have ${[...tools.keys()].join(", ")})`)
      return tool.execute(args, { agent: { session: { id: sessionId, header: { cwd: workspace } } }, signal: undefined })
    },
    service: (): MpdTeamsService => {
      if (service === undefined) throw new Error("the row published no mpdTeams service")
      return service
    },
  }
}

/**
 * Stage and approve a one-member, one-task team AS one session, and return the record it minted.
 *
 * The plan goes through the REAL plan tool on purpose: the parent link is a property of the record the
 * APPROVAL writes, so an arm that built the record by hand would prove nothing about the derivation.
 * @param h - the sandbox.
 * @param sessionId - the approving session.
 * @param name - the team name.
 * @param member - the single member to raise; the stub's handle for it is `child-<member>`.
 * @returns the record the approval created.
 */
async function approveTeam(h: Harness, sessionId: string, name: string, member: string): Promise<TeamRecord> {
  await h.call("agent_teams_plan", { action: "create", name, description: `${name} does one thing` }, sessionId)
  await h.call("agent_teams_plan", { action: "add_member", member: { name: member, prompt: `You are ${member}; do the work.` } }, sessionId)
  await h.call("agent_teams_plan", { action: "create_task", task: { subject: `${name} row`, description: "one row", blocked_by: [] } }, sessionId)
  /** The approval's answer, read for the record it built. */
  const answer = await h.call("agent_teams_plan", { action: "approve" }, sessionId) as { team?: TeamRecord }
  if (answer.team === undefined) throw new Error(`the approval of ${name} answered no team`)
  return answer.team
}

/**
 * A record written STRAIGHT to disk, the shape only a hand edit can produce.
 * @param teamId - the record's id.
 * @param parentTeamId - the parent the hand edit points at.
 * @param member - the one member's name (and, through the stub convention, its handle's suffix).
 * @returns the record to persist.
 */
function handEdited(teamId: string, parentTeamId: string, member: string): TeamRecord {
  return {
    version: 1,
    teamId,
    name: teamId,
    description: "hand-edited fixture",
    leadSessionId: `sess-${teamId}`,
    parentTeamId,
    phase: "active",
    createdAt: NOW.toISOString(),
    members: [{ id: "M1", name: member, description: "a worker", status: "running", spawnedAt: NOW.toISOString(), executorRef: `child-${member}` }],
    tasks: [],
    nextMemberNumber: 2,
    nextTaskNumber: 1,
  }
}

describe("the parent link is additive and derived from the records", () => {
  test("a root team's record carries NO parentTeamId key, and reads back as plain JSON", async () => {
    /** The sandbox. */
    const h = harness()
    /** The record a first-ever approval minted. */
    const record = await approveTeam(h, "sess-root", "root wave", "worker")
    // THE ADDITIVE CLAIM, measured on what the tool WROTE: no key at all, so every reader that predates
    // nested teams reads the same record it always did.
    expect("parentTeamId" in record).toBe(false)
    expect(JSON.parse(JSON.stringify(record))).toEqual(record)
    // AND THE FLAT MODEL: a childless tree supplies no groups, so the projection is the old one.
    expect((h.service().graph(h.workspace, record.teamId) as GraphModel).groups).toBeUndefined()
  })

  test("a MEMBER's approval nests its team under the team whose roster records it", async () => {
    /** The sandbox. */
    const h = harness()
    // The parent team raises one member; the stub's handle for it IS that member's session id.
    const parent = await approveTeam(h, "sess-parent", "parent cell", "sub")
    expect(parent.members.map((member) => member.executorRef)).toEqual(["child-sub"])
    // The promoted member stages and approves its OWN team from its own session.
    const child = await approveTeam(h, "child-sub", "child cell", "worker")
    expect(child.parentTeamId).toBe(parent.teamId)
    // THE PARENT NAMES ONLY ITS OWN TEAM: nesting adds no child list to it, so the parent cell's record
    // is what it was — which is the property the D5 arm relies on.
    expect("parentTeamId" in (readTeam(h.workspace, parent.teamId) as TeamRecord)).toBe(false)
  })

  test("a Lead's NEXT wave is a SIBLING, never a child of its own team", async () => {
    /** The sandbox. */
    const h = harness()
    /** The Lead's first team. */
    const first = await approveTeam(h, "sess-lead", "wave one", "worker")
    /** The same session's second team, staged after the first landed. */
    const second = await approveTeam(h, "sess-lead", "wave two", "worker")
    expect(second.teamId).not.toBe(first.teamId)
    // The rule that keeps every later wave out of the previous wave's box.
    expect("parentTeamId" in second).toBe(false)
  })

  test("three levels: a grandchild nests under its own parent, not under the root", async () => {
    /** The sandbox. */
    const h = harness()
    /** Level one. */
    const root = await approveTeam(h, "sess-root", "root cell", "sub")
    /** Level two, approved by the promoted member. */
    const middle = await approveTeam(h, "child-sub", "middle cell", "grand")
    /** Level three, approved by the member THAT team raised. */
    const leaf = await approveTeam(h, "child-grand", "leaf cell", "worker")
    expect(middle.parentTeamId).toBe(root.teamId)
    expect(leaf.parentTeamId).toBe(middle.teamId)
  })

  test("a team that ENDED is no parent: its member's next team is a ROOT", async () => {
    /** The sandbox. */
    const h = harness()
    /** The parent team. */
    const parent = await approveTeam(h, "sess-parent", "parent cell", "sub")
    // The wave ends — the lifecycle's own terminal shape, written through the store so nothing else moves.
    writeTeam(h.workspace, { ...(readTeam(h.workspace, parent.teamId) as TeamRecord), phase: "ended", endedAt: NOW.toISOString() })
    /** The member's team, approved after the parent ended. */
    const child = await approveTeam(h, "child-sub", "child cell", "worker")
    // LIVENESS IS THE GATE: a sub-team is never born inside a finished parent.
    expect("parentTeamId" in child).toBe(false)
  })

  test("TWO live rosters refuse the approval instead of guessing the box", async () => {
    /** The sandbox. */
    const h = harness()
    /** The first team that records the shared member. */
    const one = await approveTeam(h, "sess-a", "cell one", "shared")
    /** The second team that records the same member. */
    const two = await approveTeam(h, "sess-b", "cell two", "shared")
    await h.call("agent_teams_plan", { action: "create", name: "ambiguous", description: "which box?" }, "child-shared")
    await h.call("agent_teams_plan", { action: "add_member", member: { name: "worker", prompt: "You work." } }, "child-shared")
    await h.call("agent_teams_plan", { action: "create_task", task: { subject: "one row", description: "one row", blocked_by: [] } }, "child-shared")
    /** The refusal the ambiguous approval answered with, or undefined when it (wrongly) created a team. */
    const refusal = await h.call("agent_teams_plan", { action: "approve" }, "child-shared").then(() => undefined, (error: Error) => error)
    expect(refusal?.message).toContain("roster of 2 live teams")
    expect(refusal?.message).toContain(one.teamId)
    expect(refusal?.message).toContain(two.teamId)
    // NOTHING WAS MINTED: a refused approval must not leave a guess behind.
    expect(listTeams(h.workspace).map((record) => record.name)).not.toContain("ambiguous")
  })

  test("a hand-edited CYCLE in the chain refuses the approval", async () => {
    /** The sandbox. */
    const h = harness()
    // TWO records pointing at each other: the shape no tool can write, and the reason the walk must
    // bound itself. Only ONE of them records the approving session, so the ambiguity rule stays quiet
    // and the CYCLE rule is what the arm measures.
    writeTeam(h.workspace, handEdited("team-cyc-a", "team-cyc-b", "walker"))
    writeTeam(h.workspace, handEdited("team-cyc-b", "team-cyc-a", "other"))
    await h.call("agent_teams_plan", { action: "create", name: "cyclic child", description: "nests under a loop" }, "child-walker")
    await h.call("agent_teams_plan", { action: "add_member", member: { name: "worker", prompt: "You work." } }, "child-walker")
    await h.call("agent_teams_plan", { action: "create_task", task: { subject: "one row", description: "one row", blocked_by: [] } }, "child-walker")
    /** The refusal the cyclic chain answered with. */
    const refusal = await h.call("agent_teams_plan", { action: "approve" }, "child-walker").then(() => undefined, (error: Error) => error)
    expect(refusal?.message).toContain("CYCLE")
    expect(refusal?.message).toContain("team-cyc-a")
    expect(refusal?.message).toContain("team-cyc-b")
  })
})

describe("the projection groups every live descendant, recursively", () => {
  /**
   * A two-level fixture built STRAIGHT through the store with explicit ids, so two sandboxes are
   * comparable byte for byte (the determinism arm needs identical ids, not minted ones).
   * @param workspace - the sandbox to fill.
   * @returns the root and child team ids.
   */
  function twoLevels(workspace: string): { rootId: string; childId: string } {
    /** The root team, with two rows so the outer columns are readable. */
    let root = createTeam(workspace, { teamId: "team-root", name: "root cell", description: "the outer frame", leadSessionId: "sess-root" }, NOW)
    root = addTeamTask(root, { subject: "root first", description: "own it", kind: "work" }, NOW)
    root = addTeamTask(root, { subject: "root second", description: "judge it", kind: "review", blockedBy: ["T1"] }, NOW)
    writeTeam(workspace, root)
    /** The child team, whose own row is its interior's first column. */
    let child = createTeam(workspace, { teamId: "team-child", name: "child cell", description: "the inner frame", leadSessionId: "sess-child", parentTeamId: "team-root" }, NOW)
    child = addTeamTask(child, { subject: "child work", description: "do it", kind: "work" }, NOW)
    writeTeam(workspace, child)
    return { rootId: "team-root", childId: "team-child" }
  }

  test("a childless tree keeps EXACTLY today's model (the backward pin)", () => {
    /** The sandbox. */
    const h = harness()
    /** A lone team, no children. */
    let lonely = createTeam(h.workspace, { teamId: "team-lonely", name: "lonely", description: "no children", leadSessionId: "sess-1" }, NOW)
    lonely = addTeamTask(lonely, { subject: "solo", description: "do it", kind: "work" }, NOW)
    writeTeam(h.workspace, lonely)
    /** The served model. */
    const model = h.service().graph(h.workspace, "team-lonely") as GraphModel
    // NO GROUP KEY AT ALL, which is what makes the flat bytes identical to the pre-wave model.
    expect(Object.keys(model).sort()).toEqual(["cycles", "edges", "nodes", "ranks", "report"])
    expect(model.nodes.map((node) => [node.id, node.depth, node.visual])).toEqual([["T1", 0, "open"]])
  })

  test("one group per child, the child's rows inside it, and the OUTER rank unchanged", () => {
    /** The sandbox. */
    const h = harness()
    /** The fixture ids. */
    const { rootId, childId } = twoLevels(h.workspace)
    /** The root's model, which carries the child as a box. */
    const model = h.service().graph(h.workspace, rootId) as GraphModel
    expect(model.groups?.map((group) => [group.id, group.parentId, group.depth])).toEqual([[childId, null, 0]])
    // THE BOX IS A NODE of the outer frame, drawn in the group visual.
    expect(model.nodes.find((node) => node.id === childId)?.visual).toBe("group")
    // AMENDMENT 7 — BOTH TEAMS MINT `T1`, AND BOTH SURVIVE: the child's is the team plane's own
    // `<teamId>::<taskId>` spelling, so the merge cannot fold two rows into one node.
    expect(model.nodes.find((node) => node.id === `${childId}::T1`)?.subject).toBe("child work")
    expect(model.nodes.find((node) => node.id === `${childId}::T1`)?.group).toBe(childId)
    expect(model.nodes.find((node) => node.id === "T1")?.subject).toBe("root first")
    // THE ROOT'S OWN ROWS ARE UNTOUCHED by the nesting: BARE ids, outer columns, no `group`. The box
    // itself is a node of the ROOT frame (no `group`) and is excluded here by its visual.
    expect(model.nodes.filter((node) => node.group === undefined && node.visual !== "group").map((node) => [node.id, node.depth])).toEqual([["T1", 0], ["T2", 1]])
    // AND THE OUTER BUCKETS rank the root's rows WITH the box between them: the pseudo-node takes part in
    // the ROOT frame's ranking (that is what keeps external columns correct), while `T2` — blocked by `T1`
    // — stays one column further out. This is the per-task `rank` `/state` serves for the outer board.
    expect(model.ranks).toEqual([["T1", childId], ["T2"]])
  })

  test("three levels nest recursively: a grandchild is a box inside the child's box", () => {
    /** The sandbox. */
    const h = harness()
    /** The two-level fixture, extended by one more level. */
    const { rootId, childId } = twoLevels(h.workspace)
    /** The grandchild, nested under the child. */
    let grand = createTeam(h.workspace, { teamId: "team-grand", name: "grand cell", description: "the innermost frame", leadSessionId: "sess-grand", parentTeamId: childId }, NOW)
    grand = addTeamTask(grand, { subject: "grand work", description: "do it", kind: "work" }, NOW)
    writeTeam(h.workspace, grand)
    /** The root's model. */
    const model = h.service().graph(h.workspace, rootId) as GraphModel
    // PARENTS BEFORE CHILDREN, ordered by (depth, id): the child at depth 0, the grandchild at 1 under it.
    expect(model.groups?.map((group) => [group.id, group.parentId, group.depth])).toEqual([
      [childId, null, 0],
      ["team-grand", childId, 1],
    ])
    // The child's frame lists its OWN row AND its nested box, which is what the renderer draws inside it.
    expect(model.groups?.find((group) => group.id === childId)?.memberIds).toEqual([`${childId}::T1`, "team-grand"])
  })

  test("the same records produce the same bytes, in two sandboxes", () => {
    /** The first sandbox. */
    const first = harness()
    /** The second sandbox, filled with the identical fixture. */
    const second = harness()
    /** The first sandbox's fixture ids. */
    const one = twoLevels(first.workspace)
    /** The second sandbox's fixture ids. */
    const two = twoLevels(second.workspace)
    expect(one).toEqual(two)
    // DETERMINISM: identical records, identical JSON — no directory order, no insertion accident.
    expect(JSON.stringify(first.service().graph(first.workspace, one.rootId))).toBe(JSON.stringify(second.service().graph(second.workspace, two.rootId)))
  })

  test("a terminal child is NOT drawn as a box", () => {
    /** The sandbox. */
    const h = harness()
    /** The fixture ids. */
    const { rootId, childId } = twoLevels(h.workspace)
    // The child's wave ends: a finished subcell is history, not a box inside a live team.
    writeTeam(h.workspace, { ...(readTeam(h.workspace, childId) as TeamRecord), phase: "ended", endedAt: NOW.toISOString() })
    /** The root's model after the child ended. */
    const model = h.service().graph(h.workspace, rootId) as GraphModel
    expect(model.groups).toBeUndefined()
    expect(model.nodes.map((node) => node.id)).toEqual(["T1", "T2"])
  })

  test("the `/state` payload carries `groups` and keeps every OUTER task's rank", () => {
    /** The sandbox. */
    const h = harness()
    /** The fixture ids. */
    const { rootId, childId } = twoLevels(h.workspace)
    /** The root's record, which is what the route builds its payload from. */
    const root = readTeam(h.workspace, rootId) as TeamRecord
    /** The ONE model the route hands the payload — the same value `mpdTeams.graph` answers. */
    const model = h.service().graph(h.workspace, rootId) as GraphModel
    /** The payload `/plugins/mpd-team/state` serves for this team. */
    const state = buildTeamState(root, h.workspace, "sess-root", { kind: "native", reason: "native: the default backend" }, undefined, model)
    // THE CONTRACT'S CLAUSE, measured on the payload rather than on the model alone.
    expect(state.model?.groups?.map((group) => group.id)).toEqual([childId])
    // PER-TASK `rank` IS THE OUTER RANK: the root's own rows keep their outer columns, and the box does
    // not reshuffle them.
    expect(state.tasks.map((task) => [task.id, task.rank])).toEqual([["T1", 0], ["T2", 1]])
    // The child's rows are NOT rows of this payload: the board it projects is the ROOT team's.
    expect(state.tasks.map((task) => task.id)).not.toContain(`${childId}::T1`)
  })
})
