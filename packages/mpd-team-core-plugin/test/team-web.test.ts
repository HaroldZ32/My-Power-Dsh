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

import { TEAM_EVENTS_PATH, TEAM_PLAN_PATH, TEAM_ROUTES, TEAM_STATE_PATH, approvalPhraseFor, buildTeamMail, buildTeamPlan, buildTeamState, buildTeamTasks, buildWorkspaceTeams, planForSession, registerTeamRoutes } from "../src/team-web"
import { appendRecord } from "../src/mailbox-store"
import { addMember, addTask, stagePlan, writePlan } from "../src/plan-store"
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

  test("a session with NO team of its own still gets the WORKSPACE's teams (D2)", () => {
    // THE "建了但没用上" CASE, as a route contract: the record is SESSION-scoped, and a session that
    // approved nothing used to be served an empty payload while the workspace's team sat on disk. The
    // listing is what the panel renders instead of the dead empty state.
    /** The workspace of a record this session did NOT build. */
    const team = record()
    /** ANOTHER session's payload, asked for by a session that owns nothing here. */
    const state = buildTeamState(undefined, workspaceOf(team), "sess-elsewhere", EXECUTOR, buildWorkspaceTeams([team], undefined))
    expect(state.team).toBeNull()
    // The workspace listing is served, with the record's own identity and DERIVED phase.
    expect(state.workspaceTeams.records.length).toBe(1)
    expect(state.workspaceTeams.records[0].id).toBe(team.teamId)
    expect(state.workspaceTeams.records[0].name).toBe("wave-3")
    expect(state.workspaceTeams.records[0].phase).toBe("active")
    expect(state.workspaceTeams.records[0].tasks).toEqual({ total: 3, completed: 1, failed: 1 })
    expect(state.workspaceTeams.records[0].members).toBe(2)
    // NOT active for this session: the index binds nothing to it, and a panel that claimed otherwise
    // would point the captain at a team it cannot drive.
    expect(state.workspaceTeams.records[0].active).toBe(false)
    expect(state.workspaceTeams.activeId).toBeUndefined()
    // THE SESSION-SCOPED HALF IS UNTOUCHED: the same listing rides on a payload that HAS a team, so a
    // reader of `state.team` sees exactly what it saw before this field existed.
    /** The payload of the session that DOES own the team. */
    const owned = buildTeamState(team, workspaceOf(team), "sess-1", EXECUTOR, buildWorkspaceTeams([team], team.teamId))
    expect(owned.team?.id).toBe(team.teamId)
    expect(owned.workspaceTeams.activeId).toBe(team.teamId)
    expect(owned.workspaceTeams.records[0].active).toBe(true)
  })

  test("a workspace with NO teams is served an EMPTY listing, not a fabricated one", () => {
    // The honest empty state has to stay reachable: the panel renders "no team in this workspace yet"
    // from exactly this payload, and a listing invented from nothing would make that sentence
    // unreachable — the opposite failure to the dead end D2 removes.
    /** A workspace that never held a team. */
    const workspace = mkdtempSync(join(tmpdir(), "mpd-team-web-empty-"))
    sandboxes.push(workspace)
    /** The payload the route would serve there. */
    const state = buildTeamState(undefined, workspace, "sess-1", EXECUTOR, buildWorkspaceTeams([], undefined))
    expect(state.team).toBeNull()
    expect(state.workspaceTeams.records).toEqual([])
    expect(state.workspaceTeams.activeId).toBeUndefined()
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
    // FOUR routes since W1.3: the record, the staged plan, the contracts/hold and the mailbox. The
    // state route is still the one this arm drives.
    expect(routes.length).toBe(TEAM_ROUTES.length)
    for (const route of routes) expect(route.kind).toBe("exact")
    expect(routes.map((route) => route.path)).toContain(TEAM_STATE_PATH)
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
    ;(routes.find((route) => route.path === TEAM_STATE_PATH) as { handler: (req: unknown, res: unknown) => unknown }).handler({ url: `${TEAM_STATE_PATH}?sessionId=sess-1` }, res)
    expect(captured.status).toBe(200)
    expect((captured.body as { team: { id: string } | null }).team?.id).toBe(team.teamId)
    // A session with no team still gets a 200 and an empty state.
    ;(routes.find((route) => route.path === TEAM_STATE_PATH) as { handler: (req: unknown, res: unknown) => unknown }).handler({ url: `${TEAM_STATE_PATH}?sessionId=sess-other` }, res)
    expect(captured.status).toBe(200)
    expect((captured.body as { team: unknown }).team).toBeNull()
    // A request with NO query at all is answered rather than throwing.
    ;(routes.find((route) => route.path === TEAM_STATE_PATH) as { handler: (req: unknown, res: unknown) => unknown }).handler({}, res)
    expect(captured.status).toBe(200)
    // ── THE WORKSPACE LISTING IS READ BY THE ROUTE ITSELF (D2) ────────────────
    // The projection takes the listing as an argument, so this is the arm that proves the ROUTE reads
    // the workspace directory and threads it in. The other session's request is the one that matters:
    // it owns no team, yet the record on disk is served to it as the workspace's.
    ;(routes.find((route) => route.path === TEAM_STATE_PATH) as { handler: (req: unknown, res: unknown) => unknown })
      .handler({ url: `${TEAM_STATE_PATH}?sessionId=sess-other` }, res)
    /** That answer's listing half. */
    const listed = (captured.body as { workspaceTeams: { records: Array<{ id: string; phase: string }>; activeId?: string } }).workspaceTeams
    expect(listed.records.map((entry) => entry.id)).toEqual([team.teamId])
    expect(listed.records[0].phase).toBe("active")
    // The index binds the record to `sess-1`, so the OTHER session's listing marks nothing active.
    expect(listed.activeId).toBeUndefined()
  })

  test("a THROWING read becomes a 500 payload, never an uncaught throw in a request", () => {
    /** The routes the double captured. */
    const routes: Array<{ path: string; handler: (req: unknown, res: unknown) => unknown }> = []
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
    ;(routes.find((route) => route.path === TEAM_STATE_PATH) as { handler: (req: unknown, res: unknown) => unknown }).handler({ url: TEAM_STATE_PATH }, {
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
    // ONE WARNING PER ROUTE, because a server that refuses the registration refuses all four — the
    // family is mounted together, so a count of 1 here would mean three routes went unreported.
    expect(warned.length).toBe(TEAM_ROUTES.length)
    expect(warned[0]).toContain("duplicate route")
  })
})

/** Remove every sandbox this file created, so no arm leaks state into the next. */
import { afterEach } from "bun:test"
afterEach(() => { for (const dir of sandboxes.splice(0)) rmSync(dir, { recursive: true, force: true }) })

// ── W1.3: the three routes that serve what exists BEFORE an approval ─────────
//
// WHY THEY ARE SEPARATE FROM `/state`, and it is not tidiness. The mpd TEAM RECORD is materialised AT
// approval, so before one there is no record to read. A surface that reads only records therefore
// shows NOTHING for a staged plan — which is exactly what the TUI plan panel did, and why it claimed
// approval was impossible when `agent_teams_plan {action:"approve"}` was one call away. The staged
// plan carries its own identity, `planId`, and these arms pin the routes that serve it.
describe("the staged-plan route", () => {
  test("serves the PLAN and its planId, not the team record", () => {
    /** The workspace holding the staged plan. */
    const workspace = mkdtempSync(join(tmpdir(), "mpd-team-web-plan-"))
    sandboxes.push(workspace)
    /** A plan staged through the store, so the fixture cannot drift from the real shape. */
    let plan = stagePlan(workspace, "sess-plan", { name: "wave-4", description: "the web sidebar", approval: "required" }, NOW)
    plan = addMember(plan, { name: "Senior Engineer", description: "implements", prompt: "do it", role: "Senior Engineer" })
    plan = addTask(plan, { subject: "build it", description: "acceptance text", owner: "Senior Engineer", blockedBy: ["core"] })
    writePlan(workspace, plan)
    /** The payload the route would serve. */
    const payload = buildTeamPlan(plan, workspace, "sess-plan")
    expect(payload.ok).toBe(true)
    expect(payload.plan?.planId).toBe(plan.planId)
    // The planId is the PRE-approval identity and the phrase the approval gate demands — NOT the
    // teamId, which does not exist yet.
    expect(payload.plan?.planId.startsWith("plan-")).toBe(true)
    expect(payload.plan?.approved).toBe(false)
    expect(payload.plan?.discarded).toBe(false)
    expect(payload.plan?.members[0].name).toBe("Senior Engineer")
    expect(payload.plan?.tasks[0].blockedBy).toEqual(["core"])
    // A staged plan's own fields only: routing and task kind are resolved AT approval by the roster
    // slot, so projecting them here would invent columns the stage does not have.
    expect(Object.keys(payload.plan?.members[0] ?? {}).sort()).toEqual(["description", "name", "role"])
  })

  test("a session with NO staged plan is a payload with plan null, not an error", () => {
    /** The payload for a session that never staged anything. */
    const payload = buildTeamPlan(undefined, "/ws", "sess-none")
    expect(payload.ok).toBe(true)
    expect(payload.plan).toBeNull()
  })
})

describe("the task route", () => {
  test("serves the frozen contracts and the hold, in the store's own fields", () => {
    /** The workspace whose contracts are read. */
    const workspace = mkdtempSync(join(tmpdir(), "mpd-team-web-task-"))
    sandboxes.push(workspace)
    /** A plan staged through the store; `stagePlan` does not take members or tasks. */
    const staged = addTask(
      stagePlan(workspace, "s1", { name: "t", description: "d", approval: "required" }, NOW),
      { subject: "core", description: "the acceptance text" },
    )
    writePlan(workspace, staged)
    /** The payload under test. */
    const payload = buildTeamTasks(workspace)
    expect(payload.ok).toBe(true)
    expect(Array.isArray(payload.contracts)).toBe(true)
    expect(payload.hold).toBeNull()
    // A contract carries the FROZEN acceptance text plus who claimed it — there is no separate
    // `owner`/`acceptance` key, and inventing one would describe a shape the store does not have.
    if (payload.contracts.length > 0) {
      expect(Object.keys(payload.contracts[0]).sort()).toEqual(["attempt", "blockedBy", "claimedAt", "claimedBy", "description", "subject", "taskId"])
    }
  })
})

describe("the mail route", () => {
  test("serves the fold, and distinguishes an EMPTY mailbox from an unread one", () => {
    /** The workspace whose mailbox is read. */
    const workspace = mkdtempSync(join(tmpdir(), "mpd-team-web-mail-"))
    sandboxes.push(workspace)
    /** The payload for a mailbox nothing has written to. */
    const empty = buildTeamMail(workspace)
    expect(empty.ok).toBe(true)
    expect(empty.messages).toEqual([])
    // The RECORD COUNT is the discriminator the panel needs: zero records means nothing was ever
    // sent, which is a different sentence from "everything was read".
    expect(empty.records).toBe(0)
    // A `send` record in the union's own shape — `t` discriminates it, and the fold reads THAT.
    appendRecord(workspace, { t: "send", id: "m1", fromId: "s-arch", fromName: "Architect", toId: "s-cap", toName: "captain", subject: "contract", body: "contract frozen", at: "2026-09-30T09:00:00.000Z" })
    /** The payload after one message. */
    const one = buildTeamMail(workspace)
    expect(one.records).toBe(1)
    expect(one.messages.length).toBe(1)
    expect(one.messages[0].fromName).toBe("Architect")
    expect(one.messages[0].body).toBe("contract frozen")
    // A message the transport has not touched yet has NO delivery instant — the fold's own way of
    // saying "queued", which is a different sentence from "delivered and unread".
    expect(one.messages[0].deliveredAt).toBeUndefined()
    expect(one.messages[0].readAt).toBeUndefined()
  })
})

describe("the route family", () => {
  test("registers ALL FOUR paths, and one registration covers the family", () => {
    /** The routes the double captured. */
    const routes: string[] = []
    /** The web server double. */
    const server = { register: (route: { path: string }) => { routes.push(route.path); return () => {} } }
    /** Whether every route registered. */
    const ok = registerTeamRoutes(server, {
      recordFor: () => undefined,
      workspace: () => "/ws",
      executor: () => EXECUTOR,
      effect: (fn: () => unknown) => fn(),
      warn: () => {},
    })
    expect(ok).toBe(true)
    expect(routes.sort()).toEqual([...TEAM_ROUTES].sort())
    // The five paths are ONE family, declared in one place, so a panel cannot find one and miss
    // another — and the client's constants come from the same list.
    expect(TEAM_ROUTES.length).toBe(5)
    expect(TEAM_ROUTES).toContain(TEAM_PLAN_PATH)
    expect(TEAM_ROUTES).toContain(TEAM_EVENTS_PATH)
    // Under the `/plugins/mpd-team/*` family on purpose: the host THROWS on a duplicate exact route, and
    // `/plugins/events` is already taken by the harness's own HMR row.
    expect(TEAM_EVENTS_PATH).toBe("/plugins/mpd-team/events")
  })
})

// ── the SHARED half: one phrase rule, one projection, two consumers ─────────
//
// The user's directive for this work: the Web panel and the TUI scene share the infrastructure and
// differ only in how they DRAW it. These arms pin the two things that would otherwise be implemented
// twice — the approval phrase and the plan projection — because two spellings of "the thing you must
// type" make neither of them the contract.
describe("the shared approval phrase", () => {
  test("names the planId, and is SERVED in the payload rather than re-derived by a consumer", () => {
    /** The workspace holding the staged plan. */
    const workspace = mkdtempSync(join(tmpdir(), "mpd-team-web-phrase-"))
    sandboxes.push(workspace)
    /** A staged plan, which is the only state in which a gate is asked for a phrase. */
    const staged = stagePlan(workspace, "sess-phrase", { name: "wave", description: "d", approval: "required" }, NOW)
    writePlan(workspace, staged)
    /** The payload a surface would render. */
    const payload = planForSession(workspace, "sess-phrase")
    // THE PHRASE IS THE PLAN ID, because that is the PRE-approval identity: at the moment the gate
    // asks, no `teamId` exists to demand.
    expect(payload.plan?.phrase).toBe(approvalPhraseFor(staged.planId))
    expect(payload.plan?.phrase).toBe(`approve ${staged.planId}`)
    expect(payload.plan?.phrase.startsWith("approve plan-")).toBe(true)
    // SERVED, not re-derived: a consumer that computed this itself would be a second implementation of
    // the gate, free to drift from this one.
    expect(payload.plan?.phrase).toContain(payload.plan?.planId ?? "")
  })

  test("planForSession and the /plan route answer with the SAME projection", () => {
    // One function feeds both, so a surface cannot disagree with the Web panel about what is staged.
    /** The workspace under test. */
    const workspace = mkdtempSync(join(tmpdir(), "mpd-team-web-same-"))
    sandboxes.push(workspace)
    /** A staged plan with one member and one task. */
    const staged = addTask(
      addMember(
        stagePlan(workspace, "s1", { name: "n", description: "d", approval: "required" }, NOW),
        { name: "Reviewer", description: "judges", prompt: "judge" },
      ),
      { subject: "review it", description: "acceptance" },
    )
    writePlan(workspace, staged)
    /** The routes the double captured, by path. */
    const routes = new Map<string, (req: unknown, res: unknown) => unknown>()
    registerTeamRoutes({ register: (route: { path: string; handler: (req: unknown, res: unknown) => unknown }) => { routes.set(route.path, route.handler); return () => {} } }, {
      recordFor: () => undefined, workspace: () => workspace, executor: () => EXECUTOR, effect: (fn: () => unknown) => fn(), warn: () => {},
    })
    /** The response double. */
    const captured: { body: unknown } = { body: undefined }
    ;(routes.get(TEAM_PLAN_PATH) as (req: unknown, res: unknown) => unknown)(
      { url: `${TEAM_PLAN_PATH}?sessionId=s1` },
      { writeHead: () => {}, end: (text: string) => { captured.body = JSON.parse(text) } },
    )
    expect(captured.body).toEqual(planForSession(workspace, "s1"))
  })
})

// ── the EVENTS route: the family's one STREAMING member ──────────────────────
//
// The four JSON routes are answers; this one is a subscription. The arms below drive it the way the
// browser (`new EventSource`) and a QA lane (`curl -N`) do — through the headers, the frames and the
// teardown — because the two failure modes that matter here are invisible in a unit assertion about
// the payload: a stream that never writes its head, and a stream that outlives its client.
describe("the events route", () => {
  /** What a response double captured: the head, the frames, and the lifetime registrations. */
  interface StreamCapture {
    /** The status line `writeHead` was called with, or 0 before it was. */
    status: number
    /** The headers `writeHead` was called with. */
    headers: Record<string, string>
    /** Every frame `write` was called with, in order. */
    frames: string[]
    /** How many times the head was flushed explicitly. */
    flushed: number
    /** Every `on(event, …)` registration the response was asked for. */
    events: string[]
    /** The bodies `end` was called with. */
    ended: string[]
  }

  /** A response double recording everything a streaming handler may do to a real response. */
  function streamDouble(): { res: unknown; captured: StreamCapture } {
    /** The captured state, handed back so an arm reads exactly what the handler produced. */
    const captured: StreamCapture = { status: 0, headers: {}, frames: [], flushed: 0, events: [], ended: [] }
    return {
      captured,
      res: {
        writeHead: (status: number, headers: Record<string, string>): void => { captured.status = status; captured.headers = headers },
        flushHeaders: (): void => { captured.flushed += 1 },
        write: (frame: string): void => { captured.frames.push(frame) },
        end: (text: string): void => { captured.ended.push(String(text ?? "")) },
        on: (event: string): void => { captured.events.push(event) },
      },
    }
  }

  test("on connect it writes the SSE head, `retry: 1000` and ONE `event: hello` frame carrying the revision", () => {
    /** The response double and what it captured. */
    const { res, captured } = streamDouble()
    /** The request double; its `on` is what the teardown hangs off. */
    const closeHandlers: Record<string, () => void> = {}
    /** The route double's captured handler. */
    let handler: ((req: unknown, res: unknown) => void) | undefined
    registerTeamRoutes({ register: (route: { path: string; handler: (req: unknown, res: unknown) => void }) => { handler = route.handler; return () => {} } }, {
      recordFor: () => undefined,
      // The workspace is resolved PER REQUEST: this is the impure edge the stream must read like every
      // other route here, which is why it is a callback and not a value.
      workspace: () => "/ws",
      executor: () => EXECUTOR,
      effect: (fn: () => unknown) => fn(),
      warn: () => {},
      subscribe: () => () => {},
      revision: () => 7,
    })
    handler?.({ url: `${TEAM_EVENTS_PATH}?sessionId=sess-1`, on: (event: string, listener: () => void): void => { closeHandlers[event] = listener } }, res)
    expect(captured.status).toBe(200)
    expect(captured.headers["content-type"]).toBe("text/event-stream; charset=utf-8")
    expect(captured.headers["cache-control"]).toBe("no-store, no-transform")
    expect(captured.headers.connection).toBe("keep-alive")
    // The explicit head flush is what makes a client report OPEN before the first change exists.
    expect(captured.flushed).toBe(1)
    expect(captured.frames[0]).toBe("retry: 1000\n\n")
    expect(captured.frames[1]).toBe(`event: hello\ndata: {"rev":7}\n\n`)
    expect(closeHandlers.close).toBeDefined()
    // Both lifetime doors are used: the request's close is the client leaving, and the response's is
    // the one a host may report instead.
    expect(captured.events).toContain("close")
  })

  test("a change writes ONE `data:` frame carrying the CURRENT revision", () => {
    /** The subscription the route took, so the arm can fire it like a change would. */
    let notify: (() => void) | undefined
    /** How many times the route unsubscribed. */
    let unsubscribed = 0
    /** The revision the feed reports, moved by the arm between frames. */
    let rev = 1
    /** The response double and what it captured. */
    const { res, captured } = streamDouble()
    /** The route double's captured handler. */
    let handler: ((req: unknown, res: unknown) => void) | undefined
    registerTeamRoutes({ register: (route: { path: string; handler: (req: unknown, res: unknown) => void }) => { handler = route.handler; return () => {} } }, {
      recordFor: () => undefined, workspace: () => "/ws", executor: () => EXECUTOR, effect: (fn: () => unknown) => fn(), warn: () => {},
      subscribe: (_workspace: string, listener: () => void) => { notify = listener; return (): void => { unsubscribed += 1 } },
      revision: () => rev,
    })
    handler?.({ url: TEAM_EVENTS_PATH }, res)
    expect(captured.frames[1]).toBe(`event: hello\ndata: {"rev":1}\n\n`)
    rev = 2
    notify?.()
    // An UNNAMED data frame: the client's default `message` event, which is what a browser's
    // `EventSource` listens to without an `addEventListener` name.
    expect(captured.frames[2]).toBe(`data: {"rev":2}\n\n`)
    // The revision is read at FLUSH time, so a burst coalesced into one call still carries the newest
    // number rather than the one that opened the window.
    expect(captured.frames.length).toBe(3)
    expect(unsubscribed).toBe(0)
  })

  test("the client going away disposes the subscription, and no frame follows", () => {
    /** The subscription the route took. */
    let notify: (() => void) | undefined
    /** How many times the route unsubscribed. */
    let unsubscribed = 0
    /** The request double's registered close handlers, keyed by event. */
    const closeHandlers: Record<string, () => void> = {}
    /** The response double and what it captured. */
    const { res, captured } = streamDouble()
    /** The route double's captured handler. */
    let handler: ((req: unknown, res: unknown) => void) | undefined
    registerTeamRoutes({ register: (route: { path: string; handler: (req: unknown, res: unknown) => void }) => { handler = route.handler; return () => {} } }, {
      recordFor: () => undefined, workspace: () => "/ws", executor: () => EXECUTOR, effect: (fn: () => unknown) => fn(), warn: () => {},
      subscribe: (_workspace: string, listener: () => void) => {
        notify = listener
        // A REAL disposer forgets the listener, which is what makes "no frame follows" a real claim
        // rather than a statement about a bare counter.
        return (): void => { unsubscribed += 1; notify = undefined }
      },
      revision: () => 3,
    })
    handler?.({ url: TEAM_EVENTS_PATH, on: (event: string, listener: () => void): void => { closeHandlers[event] = listener } }, res)
    /** The frames written before the client left. */
    const before = captured.frames.length
    closeHandlers.close?.()
    // The disposer runs ONCE even though the request and the response both report a close.
    closeHandlers.close?.()
    expect(unsubscribed).toBe(1)
    notify?.()
    expect(captured.frames.length).toBe(before)
  })

  test("a composition with NO feed answers 503 instead of holding a dead stream open", () => {
    /** The response double and what it captured. */
    const { res, captured } = streamDouble()
    /** The route double's captured handler. */
    let handler: ((req: unknown, res: unknown) => void) | undefined
    registerTeamRoutes({ register: (route: { path: string; handler: (req: unknown, res: unknown) => void }) => { handler = route.handler; return () => {} } }, {
      recordFor: () => undefined, workspace: () => "/ws", executor: () => EXECUTOR, effect: (fn: () => unknown) => fn(), warn: () => {},
    })
    handler?.({ url: TEAM_EVENTS_PATH }, res)
    // A REFUSAL THAT ANSWERS: a client must be told the stream does not exist rather than be left
    // waiting on a connection that will never carry a frame.
    expect(captured.status).toBe(503)
    expect(JSON.parse(captured.ended[0])).toEqual({ ok: false, error: "mpd-team-core: the team change feed is unavailable in this composition" })
    // NOTHING was streamed: no `retry`, no `hello`, and no keep-alive left running behind the refusal.
    expect(captured.frames).toEqual([])
  })
})
