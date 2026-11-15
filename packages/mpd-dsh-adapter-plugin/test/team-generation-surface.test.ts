// D6b / A1 / A2: the TWO generations of the official Agent Teams surface, absorbed by the adapter.
//
// WHAT THIS FILE PINS. 0.2.2-rc.2 kept the shared task board, REMOVED the roster/mailbox/spawn API,
// and ADDED the `isEnabled`/`setEnabled` switch. 0.2.2-rc.1 has the opposite shape: the full
// executor/roster surface and no switch. A caller must never see that difference:
//   * ONE capability predicate reports the surface, and `capabilities()` publishes it per family;
//   * roster/mailbox/spawn/wait answers are STRUCTURED (`unsupported` marker), never raw throws;
//   * membership falls back to the ACTIVE executor's handle map (A2) so the read-only guard and
//     the board's authority checks keep a name and a role on rc.2;
//   * the enable switch is exposed through the adapter and degrades to `undefined` on rc.1;
//   * every degraded capability logs ONE line per process, and rc.1 is byte-identical to before.
import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createDshAdapter, type DshAdapter, type DshTeamTaskView } from "../src/index"

/** One recorded call: the seam name and its arguments. */
interface Call {
  /** The method that was called. */
  seam: string
  /** The forwarded arguments. */
  args: unknown[]
}

/** The doubles one arm drives, plus the adapter under test. */
interface Harness {
  /** The adapter under test. */
  adapter: DshAdapter
  /** Every call a double recorded. */
  calls: Call[]
  /** The subagents double, for the membership-fallback arm. */
  subagents: Record<string, unknown>
}

/** A live Lead agent handle the arms address. */
const LEAD = { session: { id: "session-lead" } }

/** One task row a board double answers with. */
const TASK_ROW: DshTeamTaskView = {
  id: "task-1", revision: 1, subject: "s", description: "d", status: "pending",
  blockedBy: [], writeScopes: [], ready: true, writeScopeWarnings: [],
}

/** One task transition request the board arms send. */
const TASK_REQUEST = { taskId: "task-1", expectedRevision: 1, action: "claim" as const }

/**
 * The 0.2.2-rc.1 service: identity + roster + board + mailbox + spawn/interrupt, NO enable switch.
 * @param calls - the call log every method records into.
 * @returns the recording double.
 */
function rc1Service(calls: Call[]): Record<string, unknown> {
  return {
    /** Identity read: the Lead is a member, everybody else is not. */
    tryMembership: (agent: unknown) => (agent === LEAD ? { id: "team-1", role: "lead", name: "lead" } : undefined),
    /** Roster read. */
    listMembers: () => [{ id: "m1", name: "m1", role: "teammate", status: "running", diagnostics: [] }],
    /** Board list. */
    listTasks: () => [TASK_ROW],
    /** Board create. */
    createTask: async (_caller: unknown, request: unknown) => { calls.push({ seam: "createTask", args: [request] }); return TASK_ROW },
    /** Board read. */
    getTask: () => TASK_ROW,
    /** Board update. */
    updateTask: async (_caller: unknown, request: unknown) => { calls.push({ seam: "updateTask", args: [request] }); return { ...TASK_ROW, revision: 2, status: "in_progress" } },
    /** Mailbox send. */
    sendMessage: async () => ({ messageId: "message-1", status: "accepted" }),
    /** Teammate spawn. */
    spawnTeammate: async () => ({ member: { id: "member-1", name: "member", role: "teammate", status: "running", diagnostics: [] } }),
    /** Teammate interrupt. */
    interrupt: () => ({ previousStatus: "running" }),
    /** Change wait. */
    waitForChange: async () => ({ timedOut: false }),
  }
}

/**
 * The 0.2.2-rc.2 service: the shared board and the enable switch, NOTHING else.
 * @returns the recording double.
 */
function rc2Service(): Record<string, unknown> {
  return {
    /** Board list. */
    listTasks: () => [TASK_ROW],
    /** Board create. */
    createTask: async () => TASK_ROW,
    /** Board read. */
    getTask: () => TASK_ROW,
    /** Board update. */
    updateTask: async () => ({ ...TASK_ROW, revision: 2, status: "in_progress" }),
    /** The ADDED switch read. */
    isEnabled: () => true,
    /** The ADDED switch write. */
    setEnabled: async () => undefined,
  }
}

/**
 * Build a harness over one team-service double and one subagents double.
 * @param teams - the `agentTeams` value, or undefined for a composition without one.
 * @param subagentsOverride - a subagents double override, for the sendMessage/provider arms.
 * @returns the adapter plus the recorded calls.
 */
function harness(teams: Record<string, unknown> | undefined, subagentsOverride?: Record<string, unknown>): Harness {
  /** Every call a double recorded. */
  const calls: Call[] = []
  /** The subagents double: durable start, delivery, interrupt and the provider catalogue. */
  const subagents: Record<string, unknown> = subagentsOverride ?? {
    /** Durable-child start, answering a stable child id. */
    startContinuable: async (spec: unknown) => { calls.push({ seam: "startContinuable", args: [spec] }); return { childId: "child-1" } },
    /** Delivery to a child. */
    sendMessage: async () => undefined,
    /** Interrupt a child. */
    interrupt: () => undefined,
    /** Provider catalogue. */
    list: () => ["spawn"],
  }
  /** The ctx the adapter resolves services through. */
  const ctx = {
    get: (name: string): unknown => (name === "subagents" ? subagents : name === "agentTeams" ? teams : undefined),
  }
  return { adapter: createDshAdapter(ctx as never), calls, subagents }
}

/** A fresh workspace root for ONE arm's row log. */
function freshLogRoot(): string {
  return mkdtempSync(join(tmpdir(), "mpd-team-surface-"))
}

/** The adapter row's log lines under one workspace root. */
function logLinesOf(root: string): string[] {
  /** The sink's documented path. */
  const file = join(root, ".mpd", "logs", "mpd-dsh-adapter.log")
  if (!existsSync(file)) return []
  return readFileSync(file, "utf8").split("\n").filter((line) => line !== "")
}

/** Restore the env after every arm. */
afterEach(() => { delete process.env.DSH_WORKSPACE_ROOT })

describe("the capability predicate, per generation", () => {
  test("rc.1: the full executor surface, no enable switch", () => {
    /** The capability snapshot of a full rc.1 service. */
    const caps = harness(rc1Service([])).adapter.capabilities()
    expect(caps.teamServiceMounted).toBe(true)
    expect(caps.team).toBe(true)
    expect(caps.teamRoster).toBe(true)
    expect(caps.teamTasks).toBe(true)
    expect(caps.teamMessages).toBe(true)
    expect(caps.teamMessaging).toBe(true)
    expect(caps.teamSpawn).toBe(true)
    expect(caps.teamWait).toBe(true)
    expect(caps.teamInterrupt).toBe(true)
    // The switch is rc.2's addition: an rc.1 host has none.
    expect(caps.teamEnableSwitch).toBe(false)
    expect(caps.teamExecutorOfficial).toBe(true)
  })

  test("rc.2: the BOARD works, the roster/mailbox do not — team is false and teamTasks true", () => {
    // A1 item 3: `team` is NOT the board pre-flight. This arm pins exactly that.
    /** The capability snapshot of the task-board-only service. */
    const caps = harness(rc2Service()).adapter.capabilities()
    expect(caps.teamServiceMounted).toBe(true)
    expect(caps.team).toBe(false)
    expect(caps.teamRoster).toBe(false)
    expect(caps.teamTasks).toBe(true)
    expect(caps.teamMessages).toBe(false)
    expect(caps.teamMessaging).toBe(false)
    expect(caps.teamSpawn).toBe(false)
    expect(caps.teamWait).toBe(false)
    expect(caps.teamInterrupt).toBe(false)
    expect(caps.teamEnableSwitch).toBe(true)
    // Presence is not servability: the executor refuses this backend (D6).
    expect(caps.teamExecutorOfficial).toBe(false)
  })

  test("absent and HOSTILE services report false and never throw", () => {
    /** A service whose every member read throws: the predicate must treat it as absent, not crash. */
    const hostile = new Proxy({}, { get: () => { throw new Error("no services here") } })
    /** The ABSENT composition: nothing is mounted at all. */
    const absent = harness(undefined).adapter.capabilities()
    expect(absent.teamServiceMounted).toBe(false)
    expect(absent.teamTasks).toBe(false)
    // The HOSTILE one answers ctx.get but throws on every member read: it IS mounted (that is what
    // the flag means), and every DERIVED capability is false — the probe never throws.
    const surfaced = harness(hostile as unknown as Record<string, unknown>).adapter.capabilities()
    expect(surfaced.teamServiceMounted).toBe(true)
    expect(surfaced.team).toBe(false)
    expect(surfaced.teamTasks).toBe(false)
    expect(surfaced.teamEnableSwitch).toBe(false)
    expect(surfaced.teamExecutorOfficial).toBe(false)
  })
})

describe("rc.1 is byte-identical: no marker, no degrade line, today's answers", () => {
  test("every result keeps today's shape and no capability logs a degradation", () => {
    /** A fresh log root, so a degrade line would be visible. */
    const root = freshLogRoot()
    process.env.DSH_WORKSPACE_ROOT = root
    /** The adapter over the full rc.1 service. */
    const { adapter } = harness(rc1Service([]))
    /** The roster answer: plain rows, no marker. */
    const members = adapter.teamListMembers(LEAD)
    expect(members).toEqual([{ id: "m1", name: "m1", role: "teammate", status: "running", diagnostics: [] }])
    expect(members.unsupported).toBeUndefined()
    expect(adapter.teamMembership(LEAD)).toEqual({ teamId: "team-1", role: "lead", name: "lead" })
    expect(logLinesOf(root)).toEqual([])
  })

  test("the enable switch answers UNKNOWN on rc.1 and says so once, never throwing", async () => {
    /** A fresh log root for this arm's degrade line. */
    const root = freshLogRoot()
    process.env.DSH_WORKSPACE_ROOT = root
    /** The adapter over the full rc.1 service. */
    const { adapter } = harness(rc1Service([]))
    expect(adapter.teamEnabled(LEAD)).toBeUndefined()
    /** The enable-switch lines after the FIRST call: at most ONE (another test file may have
     * already spent this process's single line — the bound that matters is the next assertion). */
    const firstCount = logLinesOf(root).filter((line) => line.includes("enable-switch part")).length
    expect(firstCount).toBeLessThanOrEqual(1)
    if (firstCount === 1) expect(logLinesOf(root).find((line) => line.includes("enable-switch part"))).toContain("teamEnableSwitch")
    // The ONCE-per-process property: a second call adds NO line.
    await expect(adapter.setTeamEnabled(LEAD, true)).resolves.toBeUndefined()
    expect(logLinesOf(root).filter((line) => line.includes("enable-switch part")).length).toBe(firstCount)
  })
})

describe("rc.2 absorbs the removal: structured answers, never a raw throw", () => {
  test("the roster read answers [] with the marker naming the generation and the native path", () => {
    /** A fresh log root. */
    const root = freshLogRoot()
    process.env.DSH_WORKSPACE_ROOT = root
    /** The adapter over the task-board-only service. */
    const { adapter } = harness(rc2Service())
    /** The roster answer. */
    const members = adapter.teamListMembers(LEAD)
    expect(members).toEqual([])
    expect(members.unsupported?.unsupported).toBe(true)
    expect(members.unsupported?.capability).toBe("roster")
    expect(members.unsupported?.generation).toBe("task-board-only")
    // The one-sentence reason names the generation, the loss and the supported path.
    expect(members.unsupported?.reason).toContain("0.2.2-rc.2")
    expect(members.unsupported?.reason).toContain("teamRoster")
    expect(members.unsupported?.reason).toContain("NATIVE team executor")
    /** The roster-degrade lines after the FIRST call: at most ONE, never one per call. */
    const firstCount = logLinesOf(root).filter((line) => line.includes("roster part")).length
    expect(firstCount).toBeLessThanOrEqual(1)
    // The ONCE-per-process property: a second read adds NO line.
    adapter.teamListMembers(LEAD)
    expect(logLinesOf(root).filter((line) => line.includes("roster part")).length).toBe(firstCount)
  })

  test("mailbox, spawn and wait answer their structured markers", async () => {
    /** The adapter over the task-board-only service. */
    const { adapter } = harness(rc2Service())
    /** The send answer: nothing was queued. */
    const sent = await adapter.teamSendMessage(LEAD, { target: "researcher", content: [] })
    expect(sent).toEqual({ messageId: "", status: "unsupported", unsupported: expect.objectContaining({ capability: "send" }) })
    /** The spawn answer: an empty member row. */
    const spawned = await adapter.teamSpawnTeammate(LEAD, { name: "researcher", description: "d", prompt: [] })
    expect(spawned.member.id).toBe("")
    expect(spawned.unsupported?.capability).toBe("spawn")
    /** The wait answer: no change observed because none could be. */
    expect(await adapter.teamWaitForChange(LEAD, 1_000)).toEqual({ timedOut: true, unsupported: expect.objectContaining({ capability: "wait" }) })
    /** The interrupt answer: the conservative pre-cancellation status. */
    expect(adapter.teamInterrupt(LEAD, "researcher")).toEqual({ previousStatus: "inactive", unsupported: expect.objectContaining({ capability: "interrupt" }) })
    // The identity read is a FILTER: it stays `undefined`, never a marker or a throw.
    expect(adapter.teamMembership(LEAD)).toBeUndefined()
  })

  test("the BOARD half still works, and the enable switch is servable", async () => {
    /** The adapter over the task-board-only service. */
    const { adapter } = harness(rc2Service())
    expect(adapter.teamListTasks(LEAD)).toEqual([TASK_ROW])
    expect((await adapter.teamCreateTask(LEAD, { subject: "s" })).id).toBe("task-1")
    expect((await adapter.teamUpdateTask(LEAD, TASK_REQUEST)).revision).toBe(2)
    // The rc.2 switch answers the host state and reads the state BACK after a write.
    expect(adapter.teamEnabled(LEAD)).toBe(true)
    await expect(adapter.setTeamEnabled(LEAD, true)).resolves.toBe(true)
  })

  test("the board's signal addition is TOLERATED, never required", async () => {
    /** The adapter over the task-board-only service. */
    const { adapter } = harness(rc2Service())
    /** A cancellation signal the caller supplied. */
    const controller = new AbortController()
    // Both calls must succeed with and without the signal; the host accepts it as the third argument.
    await expect(adapter.teamCreateTask(LEAD, { subject: "s" }, controller.signal)).resolves.toBeDefined()
    await expect(adapter.teamUpdateTask(LEAD, TASK_REQUEST, controller.signal)).resolves.toBeDefined()
  })
})

describe("A2: membership falls back to the ACTIVE executor's handle map", () => {
  test("a member THIS adapter raised keeps its name and role on a task-board-only host", async () => {
    /** The adapter over the rc.2 service, with a native durable-child seam. */
    const { adapter } = harness(rc2Service())
    // Raise a member through the NATIVE executor first: its handle map is the identity source the
    // host no longer provides. A caller route keeps the routing read out of the arm.
    await adapter.teamExecutor().spawn(LEAD, {
      teamId: "team-1", memberId: "M1", name: "researcher", description: "the researcher", prompt: "You research.",
      agentOptions: { provider: "deepseek-official", model: "deepseek-v4-flash" },
    })
    // The host has no tryMembership (rc.2); the executor's map answers instead.
    expect(adapter.teamMembership({ session: { id: "child-1" } })).toEqual({ teamId: "team-1", role: "teammate", name: "researcher" })
    // An agent neither source knows stays a MISS.
    expect(adapter.teamMembership({ session: { id: "unknown" } })).toBeUndefined()
  })
})

describe("A1 item 4: the native seams report the SAME members they call", () => {
  test("subagentsSendMessage tracks sendMessage, and the executor's providers read list()", () => {
    /** A full subagents double. */
    const full = harness(undefined).adapter
    expect(full.capabilities().subagentsSendMessage).toBe(true)
    expect(full.teamExecutor().providers()).toEqual(["spawn"])
    /** A subagents double WITHOUT the delivery seam. */
    const withoutSend = harness(undefined, { startContinuable: async () => ({ childId: "c" }), interrupt: () => undefined, list: () => ["spawn"] })
    expect(withoutSend.adapter.capabilities().subagentsSendMessage).toBe(false)
  })
})
