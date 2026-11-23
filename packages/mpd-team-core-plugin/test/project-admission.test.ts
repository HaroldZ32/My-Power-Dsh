import { afterEach, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { openCell } from "../../mpd-cellwork-plugin/src/open"
import { readCell, recordTransition } from "../../mpd-cellwork-plugin/src/state"
import { createWake, readWakeHistory, readWakeMatch, rememberWakeMatch } from "../src/captain-wake-store"
import { placeHold } from "../src/plan-store"
import { fixedProjectRoster, projectIdentity, projectStateWorkspace } from "../src/project-admission"
import { addTeamTask, createTeam, endTeamRecord, listTeams, readTeam, updateTeamTask, writeTeam, type TaskStatus, type TeamRecord } from "../src/team-store"

/** Every operation in these arms is confined to a synthetic Git project. */
const sandboxes: string[] = []
afterEach(() => { for (const root of sandboxes.splice(0)) rmSync(root, { force: true, recursive: true }) })

/** Exercise Git's own checkout discovery rather than fabricating a .git pointer. */
function git(cwd: string, ...args: string[]): void {
  /** A local, credential-free Git operation. */
  const result = spawnSync("git", args, { cwd, encoding: "utf8" })
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`)
}

/** Two linked worktrees plus an unused address for an independent development copy. */
function fixture(): { top: string; left: string; right: string; clone: string } {
  /** Every checkout stays in this temporary directory. */
  const root = mkdtempSync(join(tmpdir(), "mpd-project-admission-"))
  sandboxes.push(root)
  /** The primary checkout, distinct from both callers. */
  const top = join(root, "main")
  /** First competing worktree. */
  const left = join(root, "left")
  /** Second competing worktree. */
  const right = join(root, "right")
  git(root, "init", "-q", top)
  git(top, "-c", "user.name=QA", "-c", "user.email=qa@example.test", "commit", "--allow-empty", "-qm", "fixture")
  git(top, "worktree", "add", "-q", "--detach", left, "HEAD")
  git(top, "worktree", "add", "-q", "--detach", right, "HEAD")
  return { top, left, right, clone: join(root, "copy") }
}

/** Child code drives the public registration paths through real plugin apply calls and stub host seams. */
const worker = `
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { apply as team } from "./packages/mpd-team-core-plugin/src/index";
import { apply as cell } from "./packages/mpd-cellwork-plugin/src/index";
const [cwd, id, action, readyA, readyB] = process.argv.slice(1);
const services = new Map();
const tools = new Map();
let raises = 0;
let spawnedRoute;
let refusedPlanningSeat = false;
const adapter = new Proxy({}, { get: (_, key) => ({
  registerTool: (tool) => (tools.set(tool.name, tool), () => {}),
  workspaceRoot: (exec) => exec?.agent?.session?.header?.cwd ?? cwd,
  workspaceRootsAll: () => [cwd],
  capabilities: () => ({}),
  teamListMembers: () => [],
  teamListTasks: () => [],
  executeTool: async ({name, arguments: input, agent}) => {
    try { return {ok:true, isError:false, value:await tools.get(name).execute(input,{agent})}; }
    catch (error) { return {ok:false,isError:true,error:error.message}; }
  },
  teamExecutor: () => ({ kind: "native", spawn: async (_agent, input) => {
    spawnedRoute = input.agentOptions;
    if (action === "team-crash") process.exit(75);
    if (action === "planning-retry" && input.name === "cell-splitter" && !refusedPlanningSeat) {
      refusedPlanningSeat = true;
      throw new Error("fixture child quota");
    }
    return { handle: id + "-worker-" + ++raises };
  }, members: () => [] }),
  llmCatalog: async () => ({ providers: [], degraded: false }),
})[key] ?? (() => () => {}) });
services.set("mpdConfig", { agentRouteResolutionOf: (name, root) => ({ ok: true, agent: name, route: { provider: "test-provider", model: action === "team-scoped" || action === "roster-scoped" ? root === cwd ? "route-a" : "route-b" : id } }) });
const ctx = { get: (key) => key === "mpdDsh" ? adapter : services.get(key), provide: (key, value) => services.set(key, value) };
team(ctx); cell(ctx);
const call = (name, args) => tools.get(name).execute(args, { agent: { session: { id, header: { cwd } } } });
if (action === "team" || action === "team-crash" || action === "team-scoped") {
  await call("agent_teams_plan", { action: "create", name: id });
  await call("agent_teams_plan", { action: "add_member", member: { name: "Worker", role: "Senior Engineer", prompt: "fixture" } });
  await call("agent_teams_plan", { action: "create_task", task: { subject: "work", description: "fixture", blocked_by: [], owner: "Worker" } });
}
if (readyA && readyB) {
  writeFileSync(readyA, "ready");
  for (let step = 0; !existsSync(readyB); step++) {
    if (step === 200) throw new Error("peer did not reach the race barrier");
    await Bun.sleep(10);
  }
}
try {
  if (action.startsWith("planning-")) {
    const original = await call("cellwork_open", { objective: id });
    if (!original.ok) throw new Error(original.error);
    let previous;
    if (action !== "planning-none" && action !== "planning-retry") {
      const automatic = action !== "planning-manual";
      previous = (await call("agent_teams_plan", { action: "create", name: "original draft", description: automatic ? "Staged mechanically by the mpd session-start complexity gate on B." : "the user's empty draft" })).plan;
      if (automatic) {
        mkdirSync(cwd + "/.mpd/session-gate", { recursive: true });
        writeFileSync(cwd + "/.mpd/session-gate/" + id + ".json", JSON.stringify({ lastFiredAt: 1, planId: previous.planId, teamIdAtFire: "" }));
      }
      if (action === "planning-populated") await call("agent_teams_plan", { action: "create_task", task: { subject: "real user work", description: "keep this", blocked_by: [] } });
      if (action === "planning-edited") await call("agent_teams_plan", { action: "edit", description: "user edited the shell" });
    }
    const first = await call("cellwork_start", {});
    const second = first.ok || action === "planning-retry" ? await call("cellwork_start", {}) : undefined;
    const status = await call("agent_teams_plan", { action: "status" });
    console.log(JSON.stringify({ ...first, second, status, previous, raises }));
  } else if (action === "roster-scoped") {
    const result = await call("agent_teams_plan", { action: "roster", member: { name: "Additional reviewer", role: "Reviewer" } });
    console.log(JSON.stringify({ ...result, raises }));
  } else {
    const result = action.startsWith("cell") ? await call("cellwork_open", { objective: id }) : await call("agent_teams_plan", { action: "approve" });
    console.log(JSON.stringify({ ...result, raises, spawnedRoute }));
  }
} catch (error) {
  console.log(JSON.stringify({ ok: false, error: error.message, raises }));
}
`

/** Results include the original board or cell IDs and every executor spawn in the child process. */
interface Outcome {
  /** False marks a typed refusal. */
  ok?: boolean
  /** Attributable project admission refusal. */
  error?: string
  /** The newly created or replayed board. */
  team?: TeamRecord
  /** The newly created or replayed cell. */
  cellId?: string
  /** The first Cellwork planning approval's board. */
  teamId?: string
  /** The same-cell retry does not mint another board. */
  second?: { ok: boolean; teamId?: string }
  /** Preserve the precise prior stage on a refused replacement. */
  previous?: { planId: string; name: string }
  /** The current owner's stage after the call. */
  status?: { plan?: { planId: string; name: string } }
  /** Number of calls into this process's synthetic executor. */
  raises: number
  /** Route options actually passed to the native executor. */
  spawnedRoute?: { provider: string; model: string }
}

/** Run one independent local process with its actual checkout provided by the host session seam. */
async function run(cwd: string, id: string, action: string, barrier: string[] = []): Promise<Outcome> {
  /** The working directory for import resolution stays this worktree. */
  const proc = Bun.spawn([process.execPath, "-e", worker, cwd, id, action, ...barrier], { stdout: "pipe", stderr: "pipe" })
  /** Wait for process termination and drain both streams. */
  const [exit, output, stderr] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()])
  if (action === "team-crash" && exit === 75) return { raises: 0 }
  if (exit !== 0) throw new Error(stderr || output)
  /** The final line is the tool result; mounted rows may emit diagnostics before it. */
  const last = output.trimEnd().split("\n").at(-1)
  if (last === undefined || last === "") throw new Error(stderr)
  return JSON.parse(last) as Outcome
}

/** Race siblings with a barrier immediately before their observed admission calls. */
function race(f: ReturnType<typeof fixture>, left: string, right: string): Promise<[Outcome, Outcome]> {
  /** Per-process barrier files are outside board state. */
  const ready = [join(f.top, "ready-left"), join(f.top, "ready-right")]
  return Promise.all([run(f.left, "left-captain", left, ready), run(f.right, "right-captain", right, [...ready].reverse())])
}

test("processes racing Team approvals converge on one board and an attributable refusal", async () => {
  /** Both participants have separate Git checkouts and independent process-local locks. */
  const f = fixture()
  /** The barrier causes both processes to approach admission with staged plans. */
  const outcomes = await race(f, "team", "team")
  /** The winner may be either caller. */
  const winner = outcomes.find((outcome) => outcome.team !== undefined)?.team
  if (winner === undefined) throw new Error(`race did not produce an admitted board: ${JSON.stringify(outcomes)}`)
  expect(outcomes.filter((outcome) => outcome.ok === false)).toHaveLength(1)
  expect(outcomes.find((outcome) => outcome.ok === false)?.error).toContain(winner.teamId)
  expect(outcomes.map((outcome) => outcome.raises).sort()).toEqual([0, 1])
  expect(listTeams(f.top).map((team) => team.teamId)).toEqual([winner.teamId])
  /** Replay from the other root and a new process retains the original recorded board and handle. */
  const replay = await run(winner.leadSessionId.startsWith("left") ? f.right : f.left, winner.leadSessionId, "replay")
  expect(replay.team).toEqual(winner)
  expect(replay.raises).toBe(0)
})

test("a terminated approval process leaves its original board and unconfirmed seat on replay", async () => {
  /** Use a different process for replay, since the previous executor exited during spawn. */
  const f = fixture()
  await run(f.left, "captain", "team-crash")
  /** Read the write that happened before the first call to the executor. */
  const [interrupted] = listTeams(f.top)
  expect(interrupted?.tasks).toEqual([])
  expect(interrupted?.members[0]?.id).toBe("M1")
  expect(interrupted?.members[0]?.executorRef).toBeUndefined()
  /** A retry retains the stage and does not confidently spawn an unconfirmed activation again. */
  const replay = await run(f.right, "captain", "replay")
  expect(replay.team).toEqual(interrupted)
  expect(replay.raises).toBe(0)
  expect(listTeams(f.top)).toHaveLength(1)
})

test("Team approval and Cellwork open contend for the same slot", async () => {
  /** Independent processes enter via different public tools. */
  const f = fixture()
  /** Exactly one outcome owns the project. */
  const [team, cell] = await race(f, "team", "cell")
  expect(Number(team.team !== undefined) + Number(cell.cellId !== undefined)).toBe(1)
  expect(team.error ?? cell.error).toContain(team.team?.teamId ?? cell.cellId ?? "missing")
  if (cell.cellId !== undefined) {
    /** The original cell reopens without minting a second record. */
    const replay = await run(f.left, "right-captain", "cell-replay")
    expect(replay.cellId).toBe(cell.cellId)
  }
})

test("copies retain exact member scope while independent same-name clones stay unbound", async () => {
  /** A new copy must authenticate through a primary-side registration. */
  const f = fixture()
  /** Old ordinary work has neither created nor entered admission. */
  expect(projectIdentity.resolveSeat({ checkoutRoot: f.left, sessionId: "captain" })).toEqual({ kind: "unbound" })
  expect(existsSync(join(f.top, ".mpd", "project-team"))).toBe(false)
  /** A normal approval uses the canonical root while the worker calls from a sibling checkout. */
  const opened = await run(f.left, "captain", "team")
  /** The actual durable member result, reached by the backend handle only. */
  const seat = projectIdentity.resolveSeat({ checkoutRoot: f.right, sessionId: "captain-worker-1" })
  expect(seat.kind).toBe("member")
  if (seat.kind !== "member") throw new Error("member was not admitted")
  expect(seat).toMatchObject({ projectRoot: f.top, checkoutRoot: f.right, teamId: opened.team?.teamId, seat: "member" })
  git(f.top, "clone", "--no-local", "-q", f.top, f.clone)
  expect(projectIdentity.resolveSeat({ checkoutRoot: f.clone, sessionId: "captain-worker-1" })).toEqual({ kind: "unbound" })
  /** Register the independent Git directory for one durable seat. */
  const registration = { projectRoot: f.top, checkoutRoot: f.clone, memberId: seat.memberId }
  projectIdentity.bindCheckout(registration)
  projectIdentity.bindCheckout(registration)
  expect(projectIdentity.resolveSeat({ checkoutRoot: f.clone, sessionId: "captain-worker-1" })).toMatchObject({ projectId: seat.projectId, memberId: seat.memberId, checkoutRoot: f.clone })
  expect(projectIdentity.resolveSeat({ checkoutRoot: f.clone, sessionId: "captain" })).toEqual({ kind: "denied" })
  expect(projectStateWorkspace(f.clone, "captain-worker-1")).toBe(f.top)
  /** A copied locator cannot authorize another Git common directory. */
  const other = join(tmpdir(), `mpd-copy-negative-${seat.projectId}`)
  sandboxes.push(other)
  git(f.top, "clone", "--no-local", "-q", f.top, other)
  copyFileSync(join(f.clone, ".git", "mpd-project-checkout.json"), join(other, ".git", "mpd-project-checkout.json"))
  expect(projectIdentity.resolveSeat({ checkoutRoot: other, sessionId: "captain-worker-1" })).toEqual({ kind: "denied" })
  projectIdentity.unbindCheckout(registration)
  expect(projectIdentity.resolveSeat({ checkoutRoot: f.clone, sessionId: "captain-worker-1" })).toEqual({ kind: "denied" })
})

test("successive waves keep member IDs, role and effective route across distinct sessions", async () => {
  /** The next captain arrives in a different checkout with a different model configured. */
  const f = fixture()
  /** The first recorded route and durable ids. */
  const first = await run(f.left, "first-captain", "team")
  if (first.team === undefined) throw new Error(first.error ?? "first approval returned no board")
  /** The first captain seat remains the authority for integration after closure. */
  const captain = projectIdentity.resolveSeat({ checkoutRoot: f.top, sessionId: "first-captain" })
  expect(captain).toMatchObject({ kind: "member", seat: "captain", teamId: first.team.teamId })
  endTeamRecord(f.top, first.team.teamId, "first wave shipped", new Date())
  expect(projectIdentity.resolveSeat({ checkoutRoot: f.top, sessionId: "first-captain" })).toEqual(captain)
  /** Approval starts a new board using the existing member declaration. */
  const after = await run(f.right, "second-captain", "team")
  expect(after.team?.teamId).toBeDefined()
  expect(after.team?.teamId).not.toBe(first.team.teamId)
  expect(after.team?.members[0]).toMatchObject({ projectMemberId: first.team.members[0]?.projectMemberId, role: "Senior Engineer", route: "test-provider/first-captain", executorRef: "second-captain-worker-1" })
  expect(projectIdentity.resolveSeat({ checkoutRoot: f.right, sessionId: "first-captain" })).toEqual({ kind: "denied" })
  if (captain.kind !== "member") throw new Error("first captain was not authorized")
  expect(projectIdentity.resolveSeat({ checkoutRoot: f.right, sessionId: "second-captain" })).toMatchObject({ memberId: captain.memberId, projectId: captain.projectId })
})

test("new durable routes use the staging session checkout for approval and explicit roster declarations", async () => {
  /** Canonical state and the session's configuration are deliberately in distinct checkouts. */
  const f = fixture()
  /** Approval binds the project at its main path and must still use the staging session's route. */
  const opened = await run(f.left, "captain", "team-scoped")
  expect(opened.team?.members[0]?.route).toBe("test-provider/route-a")
  expect(opened.spawnedRoute).toMatchObject({ provider: "test-provider", model: "route-a" })
  await run(f.right, "captain", "roster-scoped")
  expect(fixedProjectRoster({ checkoutRoot: f.top, sessionId: "captain" }).members).toEqual(expect.arrayContaining([
    expect.objectContaining({ name: "Additional reviewer", route: expect.objectContaining({ provider: "test-provider", model: "route-a" }) }),
  ]))
})

test("Cellwork start resumes a paused planning approval without restaging either board or seats", async () => {
  /** Both attempts run the mounted tools against the same durable Team and Cellwork records. */
  const f = fixture()
  /** The synthetic host rejects the splitter once, after the planner has started. */
  const result = await run(f.left, "captain", "planning-retry")
  expect(result).toMatchObject({ ok: false, error: expect.stringContaining("fixture child quota"), second: { ok: true }, raises: 4 })
  /** The retry's board is the one left by the first attempt and all planning tasks are published once. */
  const boards = listTeams(f.top)
  expect(boards).toHaveLength(1)
  expect(boards[0]).toMatchObject({ teamId: result.second?.teamId })
  expect(boards[0]?.members.map((seat) => seat.id)).toEqual(["M1", "M2", "M3", "M4"])
  expect(boards[0]?.approvalTaskIds).toEqual(["T1", "T2", "T3", "T4"])
})

/** Archive one fixture cell through its genuine persisted stop/state format. */
function stoppedRun(root: string, status: TaskStatus, forced: boolean, unresolved: boolean = false): { team: TeamRecord; cellId: string } {
  /** Stable start and end order for the original wake's qualifying event. */
  const now = new Date("2026-11-23T00:00:00.000Z")
  /** The original admission creates a real project identity. */
  const original = openCell({ workspace: root, objective: "initial delivered objective", captainSessionId: "original-captain", admission: projectIdentity, now })
  if (!original.ok) throw new Error(original.error)
  /** Match the same board name and exact stop target as the mounted path. */
  const board = createTeam(root, { name: `cell ${original.cellId}`, description: "old objective", leadSessionId: "original-captain" }, now)
  /** The board remains live until the next valid admission. */
  const withTask = addTeamTask({ ...board, approvedAt: now.toISOString(), phase: "idle" }, { subject: "artifact", description: "old objective", blockedBy: unresolved ? ["missing prerequisite"] : [] }, now)
  /** Simulate the actual persisted result rows without introducing another host. */
  const team = updateTeamTask(withTask, "T1", { status }, now)
  writeTeam(root, team)
  /** Preserve the archived source and journal cursor rather than constructing an invented stop marker. */
  const cell = readCell(root, original.cellId)
  if (!cell.ok) throw new Error("fixture lost its cell state")
  recordTransition(root, { ...cell.state, teamId: team.teamId, phase: "stopped", archived: true, stopReason: "fixture stop" },
    { event: "stop", teamId: team.teamId, reason: "fixture stop", forced, inProgress: [] }, now)
  return { team, cellId: original.cellId }
}

test("one successor wins the project lock after a clean stop and the old wake stays addressable", async () => {
  /** Both contenders own real sibling worktrees. */
  const f = fixture()
  /** A clean archive is eligible but still carries the original live board. */
  const prior = stoppedRun(f.top, "completed", false)
  /** The original session owns the pending qualifying notification. */
  const scope = { workspace: f.top, sessionId: "original-captain" }
  /** Preserve the stored project captain identity before the handover. */
  const old = projectIdentity.resolveSeat({ checkoutRoot: f.top, sessionId: scope.sessionId })
  /** Persist the observed terminal match before the successor closes the board. */
  const wake = createWake(scope, 1, { teamId: prior.team.teamId, condition: { kind: "tasks", ids: ["T1"], mode: "all" }, armedAt: "2026-11-22T23:59:59.000Z" })
  if (wake === undefined || old.kind !== "member") throw new Error("fixture did not establish wake and captain")
  rememberWakeMatch(scope, wake, { tasks: { T1: "completed" } })
  /** Process-local mutexes cannot satisfy this race. */
  const outcomes = await race(f, "cell", "cell")
  /** The losing result names the winning cell, not the old board. */
  const winner = outcomes.find((result) => result.cellId !== undefined)
  expect(outcomes.filter((result) => result.cellId !== undefined)).toHaveLength(1)
  expect(outcomes.find((result) => result.error !== undefined)?.error).toContain(winner?.cellId ?? "missing")
  expect(readTeam(f.top, prior.team.teamId)).toMatchObject({ phase: "ended", leadSessionId: scope.sessionId, tasks: prior.team.tasks })
  expect(readCell(f.top, prior.cellId)).toMatchObject({ ok: true, state: { archived: true, captainSessionId: scope.sessionId } })
  expect(readWakeHistory(scope, 1)[0]?.id).toBe(wake.id)
  expect(readWakeMatch(scope, wake)).toEqual({ tasks: { T1: "completed" } })
  /** Whichever contender won now holds the exact same durable captain account. */
  const captainSeats = [projectIdentity.resolveSeat({ checkoutRoot: f.left, sessionId: "left-captain" }), projectIdentity.resolveSeat({ checkoutRoot: f.right, sessionId: "right-captain" })]
  expect(captainSeats.filter((seat) => seat.kind === "member")).toEqual([expect.objectContaining({ projectId: old.projectId, memberId: old.memberId })])
})

test("ordinary Team approval can also follow a clean stopped Cellwork board", async () => {
  /** Exercise the staged-draft prepare callback while closing the old board. */
  const f = fixture()
  /** A completed cell should leave its board available as history. */
  const prior = stoppedRun(f.top, "completed", false)
  /** The next legitimate objective can use a different structured entry point. */
  const next = await run(f.right, "next-captain", "team")
  expect(next.team?.teamId).toBeDefined()
  expect(next.team?.teamId).not.toBe(prior.team.teamId)
  expect(readTeam(f.top, prior.team.teamId)).toMatchObject({ phase: "ended", tasks: prior.team.tasks })
  expect(next.raises).toBe(1)
})

test.each(["pending", "failed", "held", "watchdog", "forced", "unresolved"] as const)("stopped Cellwork preserves the board slot when %s", (kind) => {
  /** Test each disqualifier at the same real project boundary. */
  const f = fixture()
  /** Failed and pending retain their rows; other fixtures isolate each guard. */
  const prior = stoppedRun(f.top, kind === "pending" || kind === "failed" ? kind : "completed", kind === "forced", kind === "unresolved")
  if (kind === "held") placeHold(f.top, "operator hold", "original-captain", new Date())
  /** Watchdog holds arrive through the mounted project's existing read seam. */
  const admission = { ...projectIdentity, admitCell: <T>(input: { checkoutRoot: string; sessionId: string }, open: (workspace: string) => T): T => projectIdentity.admitCell(input, open, () => kind !== "watchdog") }
  /** A legitimate competing checkout keeps receiving an attributable busy result. */
  const next = openCell({ workspace: f.right, objective: "next objective", captainSessionId: "next-captain", admission, now: new Date() })
  expect(next).toMatchObject({ ok: false, error: expect.stringContaining(prior.team.teamId) })
  expect(readTeam(f.top, prior.team.teamId)?.endedAt).toBeUndefined()
})

test.each(["none", "automatic", "manual", "populated", "edited"] as const)("planning binds only its own Cellwork stage with %s shell", async (kind) => {
  /** Admission begins in a sibling worktree while the durable gate receipt remains caller-local. */
  const f = fixture()
  /** Use the two real tool registrations with the same existing test executor. */
  const result = await run(f.left, "shell-captain", `planning-${kind}`)
  if (kind === "none" || kind === "automatic") {
    expect(result.ok).toBe(true)
    expect(result.teamId).toBeDefined()
    expect(result.second).toMatchObject({ ok: true, teamId: result.teamId })
    expect(listTeams(f.top)).toHaveLength(1)
    if (kind === "automatic") expect(existsSync(join(f.top, ".mpd", "team", "archive", result.previous?.planId ?? "missing", "plan.json"))).toBe(true)
  } else {
    expect(result.ok).toBe(false)
    expect(result.error).toContain("different team plan")
    expect(result.status?.plan).toMatchObject({ planId: result.previous?.planId, name: result.previous?.name })
    expect(result.raises).toBe(0)
  }
})

test("legacy Cellwork reopens in place and conflicting legacy runs keep their IDs", () => {
  /** Legacy state lives independently in Git-registered worktrees before the upgrade. */
  const f = fixture()
  /** This cell was created without the admission service. */
  const original = openCell({ workspace: f.left, objective: "legacy", captainSessionId: "captain", now: new Date() })
  if (!original.ok) throw new Error(original.error)
  /** A second pre-existing top-level run must remain visible as a conflict. */
  const conflict = createTeam(f.right, { name: "legacy board", description: "conflict", leadSessionId: "other" }, new Date())
  /** Attempt to reopen through the project-aware route from a different checkout. */
  const inputs = { workspace: f.top, objective: "legacy", captainSessionId: "captain", admission: projectIdentity, now: new Date() }
  /** The refusal names both independently active historical runs. */
  const refused = openCell(inputs)
  if (refused.ok) throw new Error(`admitted conflicting legacy runs: ${JSON.stringify(refused)}`)
  expect(refused.error).toContain(original.cellId)
  expect(refused.error).toContain(conflict.teamId)
  expect(existsSync(join(f.top, ".mpd", "project-team", "identity.json"))).toBe(false)
  expect(readTeam(f.right, conflict.teamId)).toEqual(conflict)
  writeTeam(f.right, { ...conflict, phase: "ended", endedAt: new Date().toISOString() })
  expect(openCell(inputs)).toMatchObject({ ok: true, cellId: original.cellId, statePath: original.statePath, replayed: true })
})
