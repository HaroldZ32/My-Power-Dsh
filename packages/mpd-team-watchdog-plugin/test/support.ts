// Shared test support: a stub adapter (the ONLY harness surface the engine uses)
// and tiny fixture builders for a live team readout and its heartbeats.
//
// The stub is deliberately minimal: it implements exactly the adapter methods the
// watchdog calls, so a test failure means the WATCHDOG misbehaved rather than the
// stub being clever.
//
// 0.1.7 REBASE: the watchdog no longer reads `<stateDir>/<teamId>/team.json`. Its source is the
// adapter's `teamLiveTeams()` (the official Agent Teams readout), so a fixture is registered as a
// LIVE TEAM VIEW on the stub adapter keyed by the fixture's workspace, and `writeTeam()` keeps its
// old position in every test: it builds the view from the `TeamFixture` shape and installs it.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { DshAdapter, DshTeamTaskView, DshTeamView, DshToolDef } from "../../mpd-dsh-adapter-plugin/src/index.js"
import type { EngineConfig } from "../src/engine.js"
import { projectTeamView, type TeamRecord } from "../src/team.js"

/** A workspace under a fresh temp dir, removed by `cleanup()`. */
export interface Sandbox {
  /** Absolute path of the temp workspace this sandbox owns. */
  workspace: string
  /** Team state directory, relative to that workspace. */
  stateDir: string
  /** Remove the workspace tree; every test calls it from a `finally`. */
  cleanup: () => void
}

/** Create an isolated workspace (never the repo tree, never the real home). */
export function sandbox(): Sandbox {
  // A fresh temp directory, so no test can touch the repo tree or the real home.
  const workspace = mkdtempSync(join(tmpdir(), "watchdog-test-"))
  // The production state directory, so paths resolve exactly as in a real session.
  const stateDir = join(".mpd", "team")
  return {
    workspace,
    stateDir,
    cleanup: () => rmSync(workspace, { recursive: true, force: true }),
  }
}

/** One live-team fixture, in the RETIRED record's vocabulary (what the tests were written in). */
export interface TeamFixture {
  /** The team id this fixture registers under. */
  id: string
  /** Display name; the id is used when it is absent. */
  name?: string
  /** Fixture phase word, carried into the retired-record file when one is written. */
  phase?: string
  /** Fixture halt flag, kept so a consumer's shape still accepts the retired field. */
  halted?: boolean
  /** Epoch ms of that halt, when the fixture states one. */
  haltedAt?: number
  /** The Lead session id, which the projection matches the captain against. */
  captainSessionId?: string
  /** T-16: the record's own generation floor (absent = permissive, §0/A3). */
  createdAt?: number
  /** The record's approval time, the other half of T-16's generation floor. */
  approvedAt?: number
  /** Roster rows; the projection synthesises the Lead row rather than listing it here. */
  members: Array<{ id: string; name: string; status?: string }>
  /** Board rows, in board order. */
  tasks: Array<{ id: string; status: string; assignee?: string; attempt?: number; attemptId?: string; dependencies?: string[] }>
}

/**
 * One member's `revision` in the fixture's task row.
 *
 * The fixture's `attemptId` is a STRING token (the retired record's attempt id), while the
 * official board's generation counter is the numeric `revision` the projection renders as the
 * generation token. A fixture that names no revision gets `1`, so a stamp written with
 * `attemptId: "1"` matches it.
 */
function revisionOf(task: TeamFixture["tasks"][number]): number {
  if (typeof task.attempt === "number" && Number.isFinite(task.attempt)) return task.attempt
  if (typeof task.attemptId === "string" && /^\d+$/.test(task.attemptId)) return Number(task.attemptId)
  return 1
}

/** Project one fixture onto an official team view. */
export function viewOf(team: TeamFixture): DshTeamView {
  // The Lead pseudo-row every official readout carries.
  const lead = {
    id: team.captainSessionId ?? team.id + "-lead",
    name: "lead",
    role: "lead" as const,
    status: "running" as const,
    diagnostics: [],
  }
  return {
    teamId: team.id,
    leadName: lead.name,
    leadSessionId: lead.id,
    members: [
      lead,
      ...team.members.map((member) => ({
        id: member.id,
        name: member.name,
        role: "teammate" as const,
        status: (member.status ?? "running") as DshTeamView["members"][number]["status"],
        diagnostics: [],
      })),
    ],
    tasks: team.tasks.map((task): DshTeamTaskView => ({
      id: task.id,
      revision: revisionOf(task),
      subject: task.id,
      description: "",
      status: task.status as DshTeamTaskView["status"],
      blockedBy: task.dependencies ?? [],
      writeScopes: [],
      ...(task.assignee === undefined ? {} : { ownerName: task.assignee === "captain" ? "lead" : task.assignee }),
      ready: true,
      writeScopeWarnings: [],
    })),
  }
}

/**
 * The workspace-keyed fixture registry the stub adapters answer `teamLiveTeams()` from.
 *
 * A real host has ONE readout per process; a test suite runs many independent sandboxes, so the
 * stub keys them by workspace. `writeTeam` is the only writer, which keeps the fixture's
 * lifecycle exactly where it was (one call per test).
 */
const liveTeams = new Map<string, DshTeamView[]>()

/** Register one team fixture for a sandbox's workspace and return an immutable copy of its view. */
export function writeTeam(box: Sandbox, team: TeamFixture): DshTeamView {
  // The official-shaped view this fixture registers.
  const view = viewOf(team)
  // The workspace's current fixtures, empty when none was registered before.
  const existing = liveTeams.get(box.workspace) ?? []
  liveTeams.set(box.workspace, [...existing.filter((entry) => entry.teamId !== view.teamId), view])
  // The team's scratch directory is kept: a scene/hold/heartbeat writer that wandered into the
  // team's own directory would still be visible, and the retired record's `inbox/` is gone.
  mkdirSync(join(box.workspace, box.stateDir, team.id), { recursive: true })
  return JSON.parse(JSON.stringify(view)) as DshTeamView
}

/**
 * Register a fixture team AND materialize the RETIRED record file at its old path.
 *
 * Only a test that mounts `packages/mpd-agent-teams-plugin/lib` (the retired, still-retained
 * vendored plugin) needs the file: that lib owns `<stateDir>/<teamId>/team.json` as ITS state and
 * reads it back. The watchdog reads the file NOWHERE any more, which is exactly why this is a
 * separate helper instead of something `writeTeam` does for every fixture.
 *
 * @returns the written record path.
 */
export function writeTeamRecord(box: Sandbox, team: TeamFixture): string {
  // The team's retired scratch directory (`<stateDir>/<teamId>`).
  const dir = join(box.workspace, box.stateDir, team.id)
  mkdirSync(join(dir, "inbox"), { recursive: true })
  // The retired record file's content, rebuilt from the same fixture.
  const record = {
    id: team.id,
    name: team.name ?? team.id,
    phase: team.phase ?? "running",
    ...(team.createdAt === undefined ? {} : { createdAt: team.createdAt }),
    ...(team.approvedAt === undefined ? {} : { approvedAt: team.approvedAt }),
    ...(team.halted === undefined ? {} : { halted: team.halted }),
    ...(team.haltedAt === undefined ? {} : { haltedAt: team.haltedAt }),
    ...(team.captainSessionId === undefined ? {} : { captainSessionId: team.captainSessionId }),
    members: team.members.map((member) => ({ ...member })),
    tasks: team.tasks.map((task) => ({ ...task })),
  }
  // The retired record path the still-retained vendored lib reads.
  const path = join(dir, "team.json")
  writeFileSync(path, JSON.stringify(record, null, 2))
  writeTeam(box, team)
  return path
}

/** The CURRENT views for a workspace, as fresh copies (the byte-identity assertions use this). */
export function teamViews(box: Sandbox): DshTeamView[] {
  return JSON.parse(JSON.stringify(liveTeams.get(box.workspace) ?? [])) as DshTeamView[]
}

/** Forget a workspace's fixtures (a `cleanup()`-independent reset for a lane that reuses a box). */
export function clearTeams(workspace: string): void {
  liveTeams.delete(workspace)
}

/** The projected record of one fixture team (the plugin's own projection, not a second one). */
export function teamRecordOf(box: Sandbox, teamId: string): TeamRecord | undefined {
  // The registered view for that team id, when this workspace has one.
  const view = (liveTeams.get(box.workspace) ?? []).find((entry) => entry.teamId === teamId)
  return view === undefined ? undefined : projectTeamView(view)
}

/**
 * Install the OFFICIAL team service and the live-agent registry on a REAL context.
 *
 * A test that mounts the REAL adapter (`createDshAdapter(ctx)`) needs them, because the adapter
 * reaches the official plane exactly the way production does: `ctx.get("agentTeams")` for the
 * service and `ctx.get("agents")` for the registry. The services are a faithful MINIMAL fake of
 * the installed host's (`agentTeams/lib/index.ts`): `tryMembership` resolves the Lead by its
 * Session id and a teammate by its own id, `listMembers` returns the Lead row plus the roster in
 * creation order, and `listTasks` returns the board. The ADAPTER remains the code under test.
 *
 * The registry's agents are synthesised from the fixtures (a Lead per team, one agent per
 * teammate), so a liveness/projection read answers the same way it would on a live host.
 */
export function provideTeamsOn(ctx: unknown, box: Sandbox, agents: unknown[] = []): void {
  // The ctx as an open record, the only way to install services on an unknown ctx.
  const target = ctx as Record<string, unknown>
  // The workspace's current fixture views.
  const views = (): DshTeamView[] => liveTeams.get(box.workspace) ?? []
  // The same readout behind a call, matching the service methods' own shape.
  const target0 = (): DshTeamView[] => views()
  target.agentTeams = {
    tryMembership: (candidate: { id?: unknown }) => {
      // The candidate's own id, accepted only as a string.
      const id = typeof candidate?.id === "string" ? candidate.id : ""
      for (const view of target0()) {
        if (id !== "" && id === view.leadSessionId) return { id: view.teamId, role: "lead", name: view.leadName }
        // The teammate row whose id is the candidate, if the view has one.
        const member = view.members.find((entry) => entry.id === id && entry.role === "teammate")
        if (member !== undefined) return { id: view.teamId, role: "teammate", name: member.name }
      }
      return undefined
    },
    listMembers: (candidate: { id?: unknown }) => {
      for (const view of target0()) {
        if (candidate?.id === view.leadSessionId || view.members.some((entry) => entry.id === candidate?.id)) return view.members
      }
      return []
    },
    listTasks: (candidate: { id?: unknown }) => {
      for (const view of target0()) {
        if (candidate?.id === view.leadSessionId || view.members.some((entry) => entry.id === candidate?.id)) return view.tasks
      }
      return []
    },
  }
  // The synthesised live-agent registry, keyed by agent id.
  const registry = new Map<string, unknown>()
  for (const view of views()) {
    registry.set(view.leadSessionId, { id: view.leadSessionId, session: { id: view.leadSessionId, header: { cwd: box.workspace } } })
    for (const member of view.members) {
      registry.set(member.id, { id: member.id, session: { id: member.id, header: { cwd: box.workspace } } })
    }
  }
  for (const entry of agents) {
    // An explicitly supplied agent's id, when it states a string one.
    const id = (entry as { id?: unknown })?.id
    if (typeof id === "string") registry.set(id, entry)
  }
  target.agents = {
    list: () => [...registry.values()],
    get: (id: string) => registry.get(id),
  }
}

/** One live-agent stub (`id` + `session.header.cwd` is all the engine reads). */
export function agent(id: string, workspace: string, sessionId: string = "session-" + id): Record<string, unknown> {
  return { id, session: { id: sessionId, header: { cwd: workspace } } }
}

/** The options a stub adapter is built from. */
export interface StubOptions {
  /** Workspace root the stub resolves paths against. */
  workspace: string
  /** The value `settingsReader("mpd").get()` answers. */
  settings?: unknown
  /**
   * Whether the stub advertises the live-agent registry via `capabilities().agents`. The engine's
   * r4 liveness re-check consults it; the default (`true`) mirrors a real host.
   */
  agents?: boolean
  /** The live agents `liveAgents()` answers (defaults to none). */
  liveAgents?: unknown[]
}

/** The stub adapter plus the handles a test needs to drive it. */
export interface StubAdapter {
  /** The stub adapter itself, cast to the real interface. */
  adapter: DshAdapter
  /** Tools registered through the adapter, by name. */
  tools: Map<string, DshToolDef>
  /** The PRE-dispatch observers (`tools/pre-execute`), in registration order. */
  pre: Array<(exec: any, decision: any) => void>
  /** The POST-completion observers (`tools/post-execute`), in registration order. */
  post: Array<(exec: any, result: any, downstream: any) => unknown>
  /** `settings/document-updated` listeners the engine installed. */
  settingsListeners: Array<(revision?: number, source?: string) => void>
  /** The tool names executed through `toolRuntime().execute`, in order. */
  toolExecutes: string[]
  /** Replace the value the settings reader answers, without notifying anyone. */
  setSettings: (value: unknown) => void
  /** Replace the live-agent list `liveAgents()` answers (the r4 liveness re-check). */
  setLiveAgents: (agents: unknown[]) => void
  /** Fire `settings/document-updated` at every installed listener. */
  emitSettings: () => void
  /**
   * Dispatch one adapter event (`session/event`, `agent/assistant-stream`, …) to the
   * listeners this stub registered, exactly as the harness's emit dispatch does.
   * Returns how many listeners were called.
   */
  emit: (event: string, ...args: unknown[]) => number
  /**
   * The LAST handler registered for one event through this stub's `onEvent`.
   *
   * The engine subscribes through the ADAPTER (AGENTS.md §6), so the listener lives on
   * the adapter's map, not on a separate ctx stub — a test that wants to invoke it reads
   * it from here.
   */
  listener: (event: string) => ((...args: unknown[]) => unknown) | undefined
}

/**
 * Build a stub adapter.
 *
 * `toolRuntime().execute` calls the registered tool's own `execute`, which is how
 * the engine's hold path reaches the plugin's own action through the tool seam.
 */
export function stubAdapter(options: StubOptions): StubAdapter {
  // The registry `registerTool` fills and `toolRuntime().get` reads.
  const tools = new Map<string, DshToolDef>()
  // PRE-dispatch observers, in registration order.
  const pre: Array<(exec: any, decision: any) => void> = []
  // POST-completion observers, in registration order.
  const post: Array<(exec: any, result: any, downstream: any) => unknown> = []
  // Settings-update listeners, in registration order.
  const settingsListeners: Array<(revision?: number, source?: string) => void> = []
  // Names of the tools executed through `toolRuntime().execute`, in order. */
  const toolExecutes: string[] = []
  // Event listeners by event name, mirroring the harness bus.
  const eventListeners = new Map<string, Array<(...args: unknown[]) => unknown>>()
  // The current settings value the reader answers.
  let settings = options.settings
  // The current live-agent list `liveAgents()` answers.
  let liveAgents = options.liveAgents ?? []
  // The stub adapter, implementing exactly the seams the watchdog calls.
  const adapter = {
    // The OFFICIAL team readout: the watchdog's only source of rosters and boards (0.1.7).
    teamLiveTeams: () => JSON.parse(JSON.stringify(liveTeams.get(options.workspace) ?? [])) as DshTeamView[],
    liveAgents: () => liveAgents,
    workspaceRoot: (exec?: unknown) => {
      // The exec agent's session cwd, when the payload carries one.
      const cwd = (exec as { agent?: { session?: { header?: { cwd?: unknown } } } } | undefined)?.agent?.session?.header?.cwd
      return typeof cwd === "string" && cwd !== "" ? cwd : options.workspace
    },
    workspaceRootsAll: () => [options.workspace],
    settingsReader: () => ({ get: () => settings, describe: () => undefined }),
    onSettingsDocumentUpdated: (_ns: string, listener: (revision?: number, source?: string) => void) => {
      settingsListeners.push(listener)
      return () => {
        // Position of the listener being removed, -1 when it is already gone.
        const index = settingsListeners.indexOf(listener)
        if (index >= 0) settingsListeners.splice(index, 1)
      }
    },
    registerTool: (definition: DshToolDef) => {
      tools.set(definition.name, definition)
      return () => tools.delete(definition.name)
    },
    onPreToolExecute: (listener: (exec: any, decision: any) => void) => {
      pre.push(listener)
      return () => {
        // Position of the observer being removed, -1 when it is already gone.
        const index = pre.indexOf(listener)
        if (index >= 0) pre.splice(index, 1)
      }
    },
    onPostToolExecute: (listener: (exec: any, result: any, downstream: any) => unknown) => {
      post.push(listener)
      return () => {
        // Position of the observer being removed, -1 when it is already gone.
        const index = post.indexOf(listener)
        if (index >= 0) post.splice(index, 1)
      }
    },
    onEvent: (event: string, handler: (...args: unknown[]) => unknown) => {
      // The listener list for this event, created on first use.
      const list = eventListeners.get(event) ?? []
      list.push(handler)
      eventListeners.set(event, list)
      return () => {
        // Position of the handler being removed, -1 when it is already gone.
        const index = list.indexOf(handler)
        if (index >= 0) list.splice(index, 1)
      }
    },
    toolRuntime: () => ({
      get: (toolName: string) => tools.get(toolName),
      execute: async (input: { name: string; arguments?: unknown }) => {
        toolExecutes.push(input.name)
        // The registered tool, absent when the name is unknown (an error is thrown below).
        const definition = tools.get(input.name)
        if (definition === undefined) throw new Error("unknown tool " + input.name)
        return await definition.execute(input.arguments ?? {}, {})
      },
    }),
    capabilities: () => ({ agents: options.agents !== false }),
  } as unknown as DshAdapter
  return {
    adapter,
    tools,
    pre,
    post,
    settingsListeners,
    toolExecutes,
    // The LAST handler registered for one event through the adapter's `onEvent`. The engine
    // subscribes through the ADAPTER (AGENTS.md §6), so a test that wants to invoke the
    // listener it installed reads it here rather than off a separate ctx stub.
    listener: (event: string) => {
      // The listener list for this event, empty when none was registered.
      const list = eventListeners.get(event) ?? []
      return list[list.length - 1]
    },
    setSettings: (value: unknown) => {
      settings = value
    },
    setLiveAgents: (agents: unknown[]) => {
      liveAgents = agents
    },
    emitSettings: () => {
      for (const listener of settingsListeners) listener(2, "user")
    },
    emit: (event: string, ...args: unknown[]) => {
      // How many listeners this emit reached.
      let called = 0
      for (const listener of eventListeners.get(event) ?? []) {
        listener(...args)
        called += 1
      }
      return called
    },
  }
}

/**
 * Open an OUTSTANDING channel for one member session: a turn and a step with NO committed
 * assistant answer.
 *
 * That is the ONLY state the §3 ladder may warn or escalate from, so any test that expects a
 * WARN, an ESCALATE or a hold must open one. A member with no channel evidence at all now runs
 * the §4 report-only fallback, which may WARN and can NEVER hold — the behaviour this wave
 * exists to guarantee.
 *
 * @param stub - the stub adapter whose `emit` reaches the engine's fold.
 * @param sessionId - the member session id the team record carries.
 * @param at - the request's start (ms), i.e. the moment it became OUTSTANDING.
 * @returns the number of listeners each event reached.
 */
export function openOutstandingChannel(stub: StubAdapter, sessionId: string, at: number, turn: number = 1, step: number = 1): number {
  // Listeners reached by the `turn/start` event.
  const first = stub.emit("session/event", { id: sessionId }, { type: "turn/start", seq: 1, time: at, data: { turn } })
  // Listeners reached by the `step/start` event.
  const second = stub.emit("session/event", { id: sessionId }, { type: "step/start", seq: 2, time: at, data: { turn, step } })
  return first + second
}

/** Engine config with the fast, deterministic test values. */
export function testConfig(overrides: Partial<EngineConfig> = {}): EngineConfig {
  return {
    stateDir: join(".mpd", "team"),
    enabled: true,
    warnSilenceMs: 90_000,
    tickIntervalMs: 15_000,
    warnStreakToEscalate: 3,
    actionOnEscalate: "pause",
    teamCacheMs: 0,
    keepGenerations: 3,
    deadTeamGraceMs: 86_400_000,
    logPrefix: "mpd-team-watchdog-test",
    toolInFlightMaxMs: 900_000,
    holdTtlMs: 900_000,
    // Skipped-team reasons stay off the console here: `false` is the engine's own resolved
    // default (index.ts), so the suite's output is the pre-typing output.
    verboseSkips: false,
    ...overrides,
  }
}

/** A plugin context stub: `get("mpdDsh")` hands `apply` the stub adapter. */
export interface PluginCtx {
  /** Service lookup; `mpdDsh` answers the stub adapter. */
  get: (id: string, strict?: boolean) => unknown
  /** Service publication, recorded into `services`. */
  provide?: (id: string, value: unknown) => void
  /** Event bus, backed by the stub adapter's own `onEvent` map. */
  on: (event: string, handler: (...args: any[]) => unknown) => () => void
  /** Cleanup registration; `__dispose` runs everything pushed here. */
  effect: (callback: () => unknown) => void
  /** Logger whose lines land in `warnings`, where the tests read them. */
  logger: { warn: (text: string) => void; info: (text: string) => void }
  /** Last handler registered per event name. */
  handlers: Map<string, (...args: any[]) => unknown>
  /** Every logger line, in order. */
  warnings: string[]
  /** Cleanup callbacks registered through `effect`. */
  cleanups: Array<() => unknown>
  /** Services this row published (`ctx.provide`). */
  services: Map<string, unknown>
  /** The stub adapter `get("mpdDsh")` hands out. */
  __stub: StubAdapter
  /** Run every cleanup, plus a disposer a cleanup returns. */
  __dispose: () => void
  /**
   * Open-record tail a real cordis context also has; it is what makes this stub assignable
   * where the engine's `EngineContext` (itself an open record) is the declared parameter.
   */
  [key: string]: unknown
}

/** Build a plugin context plus its stub adapter (the `apply` surface). */
export function pluginCtx(workspace: string, settings?: unknown): PluginCtx {
  // The adapter the ctx hands `apply` under the `mpdDsh` id.
  const stub = stubAdapter({ workspace, settings })
  // Last handler per event name, for tests that invoke the listener directly.
  const handlers = new Map<string, (...args: any[]) => unknown>()
  // Cleanup callbacks registered through `effect`.
  const cleanups: Array<() => unknown> = []
  // Every logger line, in order.
  const warnings: string[] = []
  // Services published through `provide`, by id.
  const services = new Map<string, unknown>()
  return {
    get: (id: string) => (id === "mpdDsh" ? stub.adapter : services.get(id)),
    provide: (id: string, value: unknown) => {
      services.set(id, value)
    },
    services,
    // The ctx stub's event bus IS the stub adapter's: the ENGINE (like the real
    // plugins) subscribes through `dsh.onEvent`, and the adapter forwards to `ctx.on`.
    // Modelling both halves on ONE map keeps `ctx.handlers` (which several tests read)
    // and `stub.emit(event, …)` (which drives the adapter side) describing the same
    // listener, exactly as they do in a real composition.
    on: (event, handler) => {
      // The subscription handle the stub's `onEvent` returned.
      const disposer = stub.adapter.onEvent(event, handler)
      handlers.set(event, handler)
      return () => {
        handlers.delete(event)
        if (typeof disposer === "function") disposer()
      }
    },
    effect: (callback: () => unknown) => {
      cleanups.push(callback)
    },
    logger: {
      warn: (text: string) => warnings.push(text),
      info: (text: string) => warnings.push(text),
    },
    handlers,
    warnings,
    cleanups,
    __stub: stub,
    __dispose: () => {
      for (const cleanup of cleanups) {
        // The cleanup's return value; a function is a nested disposer.
        const result = cleanup()
        if (typeof result === "function") (result as () => void)()
      }
    },
  }
}
