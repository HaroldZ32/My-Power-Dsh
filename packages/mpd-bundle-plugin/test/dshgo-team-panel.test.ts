// THE TEAM PANEL'S LIVE HALF: registration, the BOARD SIGNATURE, and the watchdog read.
//
// WHY THIS FILE EXISTS (repair T10 #8 + #9): the two defects it locks are both invisible from the view
// builder — a tool result read as the payload instead of its envelope (so the predicate always fell back
// to "channel" and incidents were always empty), and a refresh signature that could not see a row's
// STATUS change. Both are asserted here against a real registration and a real data subscription.
import { describe, expect, test } from "bun:test"
import { createTeamPanelActions, registerDshGoTeamPanel, readTeamSnapshot } from "../src/dshgo-team-panel.ts"
import type { PanelBridge, PanelServices } from "../src/dshgo-panel.ts"

/** One task row of the fake board. */
interface FakeTask {
  /** Board row id. */
  id: string
  /** Row status word. */
  status: string
  /** Row subject. */
  subject: string
  /** Row owner name. */
  owner: string
  /** Row kind. */
  kind: string
}

/** The fake team store a test mutates between ticks. */
interface FakeTeam {
  /** The conversation's team record, or null for none. */
  record: Record<string, unknown> | null
}

/** Build the `mpdTeams` service face over a mutable store. */
function teamsFace(store: FakeTeam): { active: (workspace: string, sessionId?: string) => unknown } {
  return { active: (): unknown => store.record }
}

/** What a host double exposes: the captures a test asserts on, plus the two seams it drives. */
interface FakeHost {
  /** Every panel the bridge was asked to publish. */
  panels: Array<{ id: string; spec: { view?: unknown; data?: unknown; actions?: Record<string, unknown> } }>
  /** Every refresh the bridge was asked to run. */
  refreshes: string[]
  /** The log lines the registration wrote. */
  lines: string[]
  /** The adapter double the registration drives. */
  dsh: PanelBridge
  /** The row context the registration reads services through. */
  ctx: PanelServices
  /** The mutable service table, so an arm can add a face. */
  services: Record<string, unknown>
}

/** A host double: the bridge, the services and the captured calls. */
function fakeHost(store: FakeTeam): FakeHost {
  /** Every panel the bridge was asked to publish. */
  const panels: Array<{ id: string; spec: { view?: unknown; data?: unknown; actions?: Record<string, unknown> } }> = []
  /** Every refresh the bridge was asked to run. */
  const refreshes: string[] = []
  /** The log lines this registration wrote. */
  const lines: string[] = []
  /** The service table the row context resolves through. */
  const services: Record<string, unknown> = { mpdTeams: teamsFace(store) }
  /** The adapter double. */
  const dsh: PanelBridge = {
    dshGoPresent: (): boolean => true,
    dshGoPanel: (id: string, spec: unknown): boolean => {
      panels.push({ id, spec: spec as { view?: unknown; data?: unknown; actions?: Record<string, unknown> } })
      return true
    },
    dshGoRefresh: (id: string): void => { refreshes.push(id) },
    onServiceBound: (): (() => void) => () => {},
    workspaceRootForSession: (): string => "/ws",
  }
  /** The row context. */
  const ctx: PanelServices = { get: (name: string): unknown => services[name] }
  return { panels, refreshes, lines, dsh, ctx, services }
}

/** The board a test mutates: two rows, one in flight. */
function storeWith(): FakeTeam {
  /** The task rows, held in one place so a test can move them. */
  const tasks: FakeTask[] = [
    { id: "T1", status: "in_progress", subject: "Build it", owner: "Worker", kind: "work" },
    { id: "T2", status: "pending", subject: "Prove it", owner: "Reviewer", kind: "review" },
  ]
  return {
    record: {
      id: "team-1",
      name: "Drive surface",
      status: "approved",
      phase: "active",
      tasks,
      members: [{ name: "Worker", mode: "running" }, { name: "Reviewer", mode: "idle" }],
    },
  }
}

describe("the team panel registers under its own id", () => {
  test("one `mpd-team` publication and one log line", () => {
    /** A host whose bridge is bound. */
    const host = fakeHost(storeWith())
    /** The registration under test. */
    const registration = registerDshGoTeamPanel({ dsh: host.dsh, ctx: host.ctx, log: (line: string): void => { host.lines.push(line) }, pollMs: 1 })
    expect(host.panels.map((panel) => panel.id)).toEqual(["mpd-team"])
    expect(host.lines).toEqual(["[mpd] dshGo=team-panel"])
    registration.dispose()
  })
})

describe("the board signature sees a STATUS change (repair T10 #9)", () => {
  test("a row moving pending -> in_progress refreshes the view exactly once", async () => {
    /** A host whose bridge is bound. */
    const store = storeWith()
    /** The host under test. */
    const host = fakeHost(store)
    /** The registration under test. */
    const registration = registerDshGoTeamPanel({ dsh: host.dsh, ctx: host.ctx, log: (): void => {}, pollMs: 1 })
    /** The published panel's data function. */
    const data = host.panels[0]?.spec.data as (scope: unknown, emit: (value: unknown) => void) => () => void
    /** The cancel handle this subscription owns. */
    const cancel = data({ sessionId: "s1" }, () => {})
    // The seed is not a change: the app has just fetched the view.
    expect(host.refreshes).toHaveLength(0)
    /** The second row, moved in flight: the done/total pair alone could never see this. */
    const tasks = (store.record?.tasks ?? []) as FakeTask[]
    tasks[1] = { ...tasks[1], status: "in_progress" } as FakeTask
    // A few poll ticks: exactly ONE refresh, because the signature changes exactly once.
    await new Promise((resolve) => setTimeout(resolve, 25))
    expect(host.refreshes).toEqual(["mpd-team"])
    tasks[1] = { ...tasks[1], subject: "Revised subject" } as FakeTask
    await new Promise((resolve) => setTimeout(resolve, 25))
    expect(host.refreshes).toEqual(["mpd-team", "mpd-team"])
    cancel()
    registration.dispose()
  })
})

test("the table caps at fifty while the full board supplies counts and blocker states", () => {
  /** A claimed row, a missing blocker, and a completed prerequisite beyond the preview. */
  const tasks = [
    { id: "T1", status: "claimed", subject: "Taken" },
    { id: "T2", status: "pending", subject: "Waits", blockedBy: ["missing"] },
    { id: "T3", status: "pending", subject: "Ready", blockedBy: ["T51", "T52"] },
    ...Array.from({ length: 47 }, (_, index) => ({ id: "T" + (index + 4), status: "completed" })),
    { id: "T51", status: "completed", owner: "Worker" },
    { id: "T52", status: "failed", owner: "member-handle" },
  ]
  /** The real projection reads the store's own field spellings. */
  const host = fakeHost({ record: { teamId: "team-1", name: "Drive surface", tasks, members: [{ name: "Worker", executorRef: "member-handle" }] } })
  /** The Go data model exposes the board's tallies, independently of which rows fit. */
  const snapshot = readTeamSnapshot(host.ctx, "/ws", "s1")
  expect(snapshot.tasks).toHaveLength(50)
  expect(snapshot.tasks.slice(0, 3).map((task) => task.blockedBy)).toEqual([0, 1, 0])
  expect(snapshot.counts).toEqual({ total: 52, done: 48, active: 1, blocked: 1, completion: 92 })
  expect(snapshot.members[0]?.taskCount).toBe(2)
})

test("the registered Go panel reads the watchdog tool as the active conversation", async () => {
  /** Two roots have distinct registered agents. */
  const agentA = { session: { id: "s1", header: { cwd: "/first" } } }
  /** The panel is opened on the second root. */
  const agentB = { session: { id: "s2", header: { cwd: "/second" } } }
  /** The actual status tool returns teams with nested holds and incidents at numeric timestamps. */
  let answer: unknown = { ok: true, isError: false, value: {
    workspace: "/second",
    predicate: { source: "heartbeat", reason: "host fallback" },
    teams: [
      { teamId: "other-team", held: true, hold: { cause: "different team" }, incidents: [] },
      { teamId: "team-1", held: true, hold: { cause: "manual pause", taskId: "T2" }, incidents: [
        { id: "older", teamId: "team-1", at: 1762128000000, kind: "warn", cause: { kind: "silence", ms: 15000 } },
        { id: "newer", teamId: "team-1", at: 1762128060000, kind: "escalate", cause: { kind: "silence-heartbeat", ms: 21000 } },
      ] },
    ],
  } }
  /** Capture the scope supplied to the real adapter's tool execution entry. */
  const calls: unknown[] = []
  /** The Go view is fetched through the registered bridge spec. */
  const host = fakeHost(storeWith())
  host.dsh.workspaceRootForSession = (id) => id === "s2" ? "/second" : "/first"
  host.dsh.liveAgents = () => [agentA, agentB]
  host.dsh.executeTool = async (input) => { calls.push(input); return answer }
  /** The panel registration also owns its cleanup. */
  const registration = registerDshGoTeamPanel({ dsh: host.dsh, ctx: host.ctx, log: () => {} })
  try {
    /** The route function the host published and the first app invocation. */
    const view = host.panels[0]?.spec.view as (scope: unknown, caps: unknown) => Promise<unknown>
    /** The first draw contains the actual second-root diagnostics. */
    const rendered = JSON.stringify(await view({ sessionId: "s2" }, { app: "1.0.9", locale: "en" }))
    expect(calls).toEqual([{ name: "session-watchdog-status", arguments: { team_id: "team-1" }, agent: agentB }])
    expect(rendered).toContain("heartbeat")
    expect(rendered).toContain("manual pause")
    expect(rendered).toContain("2025-11-03T00:01:00.000Z")
    expect(rendered.indexOf("21000 ms")).toBeLessThan(rendered.indexOf("15000 ms"))
    expect(rendered).not.toContain("different team")
    answer = { ok: false, isError: true, error: "no store" }
    /** A failed result must disclose unknown hold status. */
    const refused = JSON.stringify(await view({ sessionId: "s2" }, { app: "1.0.9", locale: "en" }))
    expect(refused).toContain("Hold status unavailable")
    expect(refused).not.toContain("21000 ms")
  } finally {
    registration.dispose()
  }
})

describe("the selection store is the only state the taps touch", () => {
  test("select records the row and asks for a refresh; back clears it", async () => {
    /** A host whose bridge is bound. */
    const host = fakeHost(storeWith())
    /** The actions the registration publishes. */
    const actions = createTeamPanelActions({ dsh: host.dsh, ctx: host.ctx }, { get: () => "", set: (scope: unknown) => { void scope } })
    expect(await actions.select?.({ sessionId: "s1" }, { action: "select", value: { task: "T2" } })).toEqual({ refresh: true })
    expect(await actions.back?.({ sessionId: "s1" }, {})).toEqual({ refresh: true })
    // A row that vanished answers a toast rather than throwing.
    expect(await actions.select?.({ sessionId: "s1" }, { action: "select", value: {} })).toEqual({ toast: "That row is gone" })
  })
})
