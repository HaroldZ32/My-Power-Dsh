// THE TEAM WEB ROUTE (W4): the mpd-owned team, served to the browser.
//
// WHY THESE ARMS EXIST. Until W4 the Web team tab read the OFFICIAL client projection
// (`useSessions(s => s.projectionsBySession[leadId].values.agentTeam)`) — the last place the official
// plugin was still the source of truth, and a store that is EMPTY in exactly the compositions the
// split exists for, because a client store can only carry what a mounted service projected. The
// route is the replacement, so the arms below are about the two things that make it one:
//   * the payload is computed from the RECORD, and carries what the official board has no column for
//     (`kind`, `attempt`, `round`, `verdict`);
//   * the VISUAL state is derived by the SAME function the TUI uses, so two surfaces answering one
//     question cannot disagree across a refresh;
//   * a route never throws into a response — an unreadable record is a payload, not a 500 storm.
import { describe, expect, test } from "bun:test"

import { TEAM_STATE_PATH, buildTeamState, registerTeamRoutes } from "../src/team-web"
import { addTeamMember, addTeamTask, createTeam, updateTeamTask, writeTeam, type TeamRecord } from "../src/team-store"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

/** The frozen instant every record in this file is stamped with. */
const NOW = new Date("2026-09-30T09:15:00.000Z")
/** The executor read every arm reports. */
const EXECUTOR = { kind: "native", reason: "native: the default backend" }

/** The sandboxes this file created, removed after every arm. */
const sandboxes: string[] = []

/** Build a record with two members and the three-task chain the payload arms read. */
function record(): TeamRecord {
  /** A fresh sandbox, so the store's own writes never touch another arm. */
  const workspace = mkdtempSync(join(tmpdir(), "mpd-team-web-"))
  sandboxes.push(workspace)
  /** The record, built through the STORE so the fixture cannot drift from the real shape. */
  let team = createTeam(workspace, { name: "wave-3", description: "split the plane", leadSessionId: "sess-1" }, NOW)
  team = addTeamMember(team, { name: "Senior Engineer", description: "implements", role: "Senior Engineer", route: "deepseek-official/deepseek-v4-flash" }, NOW)
  team = addTeamMember(team, { name: "Reviewer", description: "judges", role: "Reviewer" }, NOW)
  team = addTeamTask(team, { subject: "core", description: "own the record", kind: "requirement", owner: "Senior Engineer" }, NOW)
  team = addTeamTask(team, { subject: "review the core", description: "judge it", kind: "review", blockedBy: ["core"], owner: "Reviewer" }, NOW)
  team = addTeamTask(team, { subject: "repair the mailbox", description: "fix it", kind: "repair", blockedBy: ["core"] }, NOW)
  team = updateTeamTask(team, "T1", { status: "completed", attempt: 2 }, NOW)
  team = updateTeamTask(team, "T3", { status: "failed" }, NOW)
  // T2 waits on BOTH the completed requirement and the FAILED repair. The second blocker is the
  // OPT-1 case: it releases T2 rather than pinning it, and it is reported beside the state.
  team = updateTeamTask(team, "T2", { blockedBy: ["T1", "T3"] }, NOW)
  // APPROVED, so the phase is the live one: a record that was never approved reads `staged`
  // whatever its members look like, which is the store's own rule and not a payload accident.
  team = { ...team, approvedAt: NOW.toISOString() }
  writeTeam(workspace, team)
  return team
}

/** The workspace a built record lives in, recovered from its own path. */
function workspaceOf(team: TeamRecord): string {
  // The record's own file name is `<teamId>.json` under `<ws>/.mpd/team/teams/`, so the workspace is
  // three levels up — computed rather than remembered, so a store layout change reddens here.
  return sandboxes[sandboxes.length - 1]
}

describe("the payload is computed from the RECORD", () => {
  test("it carries the review fields the official board has no column for", () => {
    /** The record under test. */
    const team = record()
    /** The payload the route would serve. */
    const state = buildTeamState(team, workspaceOf(team), "sess-1", EXECUTOR)
    expect(state.ok).toBe(true)
    expect(state.team?.id).toBe(team.teamId)
    expect(state.team?.name).toBe("wave-3")
    expect(state.team?.phase).toBe("active")
    /** The task rows by id. */
    const byId = new Map(state.tasks.map((task) => [task.id, task]))
    // THE POINT OF OWNING THE RECORD: these four are real here, and were permanently blank while the
    // browser read the official projection.
    expect(byId.get("T1")?.kind).toBe("requirement")
    expect(byId.get("T1")?.attempt).toBe(2)
    expect(byId.get("T2")?.kind).toBe("review")
    expect(byId.get("T3")?.kind).toBe("repair")
    // The route the roster resolved travels with the member.
    expect(state.members[0].route).toBe("deepseek-official/deepseek-v4-flash")
  })

  test("the VISUAL state comes from the same function the TUI uses", () => {
    /** The payload under test. */
    const state = buildTeamState(record(), "/ws", "sess-1", EXECUTOR)
    /** The visual state per task id. */
    const visual = new Map(state.tasks.map((task) => [task.id, task.visual]))
    expect(visual.get("T1")).toBe("completed")
    // OPT-1 (user decision 2026-09-13): T3 FAILED, so T2 — which it blocks — is RELEASED rather than
    // pinned. It stays `open`, and the failure is reported BESIDE it.
    expect(visual.get("T3")).toBe("failed")
    expect(visual.get("T2")).toBe("open")
    expect(state.tasks.find((task) => task.id === "T2")?.failedBy).toEqual(["T3"])
    // The counts keep the released tasks OUT of the plain `ready` number, which is what stops
    // "2 ready" from hiding that one of them is only ready because a prerequisite gave up.
    expect(state.counts.releasedByFailure).toBe(1)
  })

  test("the board is ordered by RANK, so the browser can lay out a graph without re-sorting", () => {
    /** The payload under test. */
    const state = buildTeamState(record(), "/ws", "sess-1", EXECUTOR)
    /** The ranks, in payload order. */
    const depths = state.tasks.map((task) => task.depth)
    expect(depths).toEqual([...depths].sort((left, right) => left - right))
    expect(state.tasks[0].depth).toBe(0)
    // The dependency edges travel, which is what a graph draws.
    expect(state.tasks.find((task) => task.id === "T2")?.blockedBy).toEqual(["T1", "T3"])
    // T2 blocks on two tasks and T3 blocks on one: three edges, counted from the board.
    expect(state.team?.links).toBe(3)
  })

  test("the EXECUTOR is named, so the split's own state is visible in the browser", () => {
    /** The payload under test. */
    const state = buildTeamState(record(), "/ws", "sess-1", EXECUTOR)
    expect(state.executor.kind).toBe("native")
    expect(state.executor.reason).toContain("default")
  })

  test("a session with NO team is a payload with `team: null`, not an error", () => {
    // The empty state must be renderable: the panel shows "no team yet" from THIS, and a 404 would
    // make every panel show a failure instead.
    /** The payload for a session that never staged a team. */
    const state = buildTeamState(undefined, "/ws", "sess-9", EXECUTOR)
    expect(state.ok).toBe(true)
    expect(state.team).toBeNull()
    expect(state.members).toEqual([])
    expect(state.tasks).toEqual([])
    expect(state.counts.total).toBe(0)
    // The executor is still reported: "which backend WOULD raise a member" is answerable with no team.
    expect(state.executor.kind).toBe("native")
  })

  test("a cycle is REPORTED in the payload rather than drawn as a sound board", () => {
    /** The workspace holding the cyclic record. */
    const workspace = mkdtempSync(join(tmpdir(), "mpd-team-web-cyc-"))
    sandboxes.push(workspace)
    /** A record whose two tasks block each other. */
    let team = createTeam(workspace, { name: "cyc", description: "x", leadSessionId: "s1" }, NOW)
    team = addTeamTask(team, { subject: "a", description: "a" }, NOW)
    team = addTeamTask(team, { subject: "b", description: "b" }, NOW)
    // The blockers are set AFTER both exist: `addTeamTask` resolves a reference against the tasks
    // already on the board, so a forward reference stays verbatim and would NOT form the cycle.
    team = updateTeamTask(team, "T1", { blockedBy: ["T2"] }, NOW)
    team = updateTeamTask(team, "T2", { blockedBy: ["T1"] }, NOW)
    writeTeam(workspace, team)
    /** The payload under test. */
    const state = buildTeamState(team, workspace, "s1", EXECUTOR)
    expect(state.cycles).toEqual(["T1", "T2"])
    expect(state.problems.length).toBeGreaterThan(0)
  })
})

describe("the route", () => {
  test("registers ONE exact path, and answers the caller's own session", () => {
    /** The routes the double captured. */
    const routes: Array<{ kind: string; path: string; handler: (req: unknown, res: unknown) => unknown }> = []
    /** The web server double. */
    const server = { register: (route: { kind: string; path: string; handler: (req: unknown, res: unknown) => unknown }) => { routes.push(route); return () => {} } }
    /** The record every request resolves to. */
    const team = record()
    /** Whether the route registered. */
    const ok = registerTeamRoutes(server, {
      recordFor: (sessionId: string) => (sessionId === "sess-1" ? team : undefined),
      workspace: () => workspaceOf(team),
      executor: () => EXECUTOR,
      effect: (fn: () => unknown) => fn(),
      warn: () => {},
    })
    expect(ok).toBe(true)
    expect(routes.length).toBe(1)
    expect(routes[0].kind).toBe("exact")
    expect(routes[0].path).toBe(TEAM_STATE_PATH)
    // The path is the one the CLIENT polls: the two are one constant, not two literals.
    expect(TEAM_STATE_PATH).toBe("/plugins/mpd-team/state")
    /** The response double, capturing the status and the body. */
    const captured: { status: number; body: unknown } = { status: 0, body: undefined }
    /** The response double the handler writes into. */
    const res = {
      writeHead: (status: number) => { captured.status = status },
      end: (text: string) => { captured.body = JSON.parse(text) },
    }
    // The caller's OWN session decides which team is answered.
    routes[0].handler({ url: `${TEAM_STATE_PATH}?sessionId=sess-1` }, res)
    expect(captured.status).toBe(200)
    expect((captured.body as { team: { id: string } | null }).team?.id).toBe(team.teamId)
    // A session with no team still gets a 200 and an empty state.
    routes[0].handler({ url: `${TEAM_STATE_PATH}?sessionId=sess-other` }, res)
    expect(captured.status).toBe(200)
    expect((captured.body as { team: unknown }).team).toBeNull()
    // A request with NO query at all is answered rather than throwing.
    routes[0].handler({}, res)
    expect(captured.status).toBe(200)
  })

  test("a THROWING read becomes a 500 payload, never an uncaught throw in a request", () => {
    /** The routes the double captured. */
    const routes: Array<{ handler: (req: unknown, res: unknown) => unknown }> = []
    /** The server double: it captures the route and never refuses. */
    const server = { register: (route: { kind: string; path: string; handler: (req: unknown, res: unknown) => unknown }) => { routes.push(route); return () => {} } }
    registerTeamRoutes(server, {
      recordFor: () => { throw new Error("the store exploded") },
      workspace: () => "/ws",
      executor: () => EXECUTOR,
      effect: (fn: () => unknown) => fn(),
      warn: () => {},
    })
    /** The response double. */
    const captured: { status: number; body: unknown } = { status: 0, body: undefined }
    routes[0].handler({ url: TEAM_STATE_PATH }, {
      writeHead: (status: number) => { captured.status = status },
      end: (text: string) => { captured.body = JSON.parse(text) },
    })
    // A route that threw would take the whole panel down with it; this one answers.
    expect(captured.status).toBe(500)
    expect(String((captured.body as { error: string }).error)).toContain("the store exploded")
  })

  test("a composition with NO web server registers nothing and says so quietly", () => {
    // A headless profile has no web server, and that is not a defect — the route simply is not there.
    expect(registerTeamRoutes(undefined, {
      recordFor: () => undefined, workspace: () => "/ws", executor: () => EXECUTOR, effect: (fn: () => unknown) => fn(), warn: () => {},
    })).toBe(false)
    // A server that REFUSES the registration is reported, not thrown: the row must still apply.
    /** The warnings the refused registration produced. */
    const warned: string[] = []
    expect(registerTeamRoutes({ register: () => { throw new Error("duplicate route") } }, {
      recordFor: () => undefined, workspace: () => "/ws", executor: () => EXECUTOR, effect: (fn: () => unknown) => fn(), warn: (line: string) => warned.push(line),
    })).toBe(false)
    expect(warned.length).toBe(1)
    expect(warned[0]).toContain("duplicate route")
  })
})

/** Remove every sandbox this file created, so no arm leaks state into the next. */
import { afterEach } from "bun:test"
afterEach(() => { for (const dir of sandboxes.splice(0)) rmSync(dir, { recursive: true, force: true }) })
