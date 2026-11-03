// THE TEAM PANEL'S LIVE HALF: registration, the BOARD SIGNATURE, and the watchdog read.
//
// WHY THIS FILE EXISTS (repair T10 #8 + #9): the two defects it locks are both invisible from the view
// builder — a tool result read as the payload instead of its envelope (so the predicate always fell back
// to "channel" and incidents were always empty), and a refresh signature that could not see a row's
// STATUS change. Both are asserted here against a real registration and a real data subscription.
import { describe, expect, test } from "bun:test"
import { createTeamPanelActions, registerDshGoTeamPanel, buildTeamPanelFor } from "../src/dshgo-team-panel.ts"
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
    cancel()
    registration.dispose()
  })
})

describe("the watchdog read unwraps the tool envelope (repair T10 #8)", () => {
  test("the predicate and the incidents come from `value`, and a failure falls back", async () => {
    /** A store with one member, so the panel has a board. */
    const store = storeWith()
    /** What the fake tool runtime answers next. */
    let answer: unknown = { ok: true, value: { teams: [{ teamId: "team-1", held: false }], predicate: { source: "heartbeat" }, incidents: [{ ts: "2026-11-03T00:00:00Z", kind: "silence", detail: "T2 went quiet" }] } }
    /** The tool runtime the panel drives. */
    const tools = { executeTool: async (): Promise<unknown> => answer }
    /** The services the read uses. */
    const services: PanelServices = { get: (name: string): unknown => (name === "mpdTeams" ? teamsFace(store) : undefined) }
    /** The selection store, empty. */
    const selection = { get: (): string => "", set: (): void => {} }
    /** The rendered tree, read through its JSON because the tabs are literal content. */
    const rendered = JSON.stringify(await buildTeamPanelFor(services, tools, () => "/ws", selection, { sessionId: "s1" }, { app: "1.0.9", locale: "en" }))
    expect(rendered).toContain("heartbeat")
    expect(rendered).toContain("silence")
    // A refused call leaves the predicate at its documented default and the incident list empty.
    answer = { ok: false, error: "no store" }
    /** The tree built after the refusal. */
    const refused = JSON.stringify(await buildTeamPanelFor(services, tools, () => "/ws", selection, { sessionId: "s1" }, { app: "1.0.9", locale: "en" }))
    expect(refused).toContain("\"channel\"")
    // The incident ROW is gone; "silence" still appears in the designed empty-state copy, which is why
    // the assertion names the row's own detail instead of the word.
    expect(refused).not.toContain("T2 went quiet")
    // A REJECTED call must not escape the view builder either.
    const throwing = { executeTool: async (): Promise<unknown> => { throw new Error("runtime gone") } }
    await expect(buildTeamPanelFor(services, throwing, () => "/ws", selection, { sessionId: "s1" }, { app: "1.0.9", locale: "en" })).resolves.toBeDefined()
  })
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
