// Shared test support: a stub adapter (the ONLY harness surface the engine uses)
// and tiny fixture builders for an adopted team record and its heartbeats.
//
// The stub is deliberately minimal: it implements exactly the adapter methods the
// watchdog calls, so a test failure means the WATCHDOG misbehaved rather than the
// stub being clever.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { DshAdapter, DshToolDef } from "../../mpd-dsh-adapter-plugin/src/index.js"
import type { EngineConfig } from "../src/engine.js"

/** A workspace under a fresh temp dir, removed by `cleanup()`. */
export interface Sandbox {
  workspace: string
  stateDir: string
  cleanup: () => void
}

/** Create an isolated workspace (never the repo tree, never the real home). */
export function sandbox(): Sandbox {
  const workspace = mkdtempSync(join(tmpdir(), "watchdog-test-"))
  const stateDir = join(".mpd", "team")
  return {
    workspace,
    stateDir,
    cleanup: () => rmSync(workspace, { recursive: true, force: true }),
  }
}

/** One adopted team record fixture. */
export interface TeamFixture {
  id: string
  name?: string
  phase?: string
  halted?: boolean
  haltedAt?: number
  captainSessionId?: string
  members: Array<{ id: string; name: string; status?: string }>
  tasks: Array<{ id: string; status: string; assignee?: string; attempt?: number; attemptId?: string }>
}

/** Write a team record into the sandbox's adopted state root. */
export function writeTeam(box: Sandbox, team: TeamFixture): string {
  const dir = join(box.workspace, box.stateDir, team.id)
  mkdirSync(join(dir, "inbox"), { recursive: true })
  const record = {
    id: team.id,
    name: team.name ?? team.id,
    phase: team.phase ?? "running",
    ...(team.halted === undefined ? {} : { halted: team.halted }),
    ...(team.haltedAt === undefined ? {} : { haltedAt: team.haltedAt }),
    ...(team.captainSessionId === undefined ? {} : { captainSessionId: team.captainSessionId }),
    members: team.members.map((member) => ({ ...member })),
    tasks: team.tasks.map((task) => ({ ...task })),
  }
  const path = join(dir, "team.json")
  writeFileSync(path, JSON.stringify(record, null, 2))
  return path
}

/** One live-agent stub (`id` + `session.header.cwd` is all the engine reads). */
export function agent(id: string, workspace: string, sessionId = "session-" + id): Record<string, unknown> {
  return { id, session: { id: sessionId, header: { cwd: workspace } } }
}

/** The options a stub adapter is built from. */
export interface StubOptions {
  workspace: string
  settings?: unknown
}

/** The stub adapter plus the handles a test needs to drive it. */
export interface StubAdapter {
  adapter: DshAdapter
  tools: Map<string, DshToolDef>
  /** The PRE-dispatch observers (`tools/pre-execute`), in registration order. */
  pre: Array<(exec: any, decision: any) => void>
  post: Array<(exec: any, result: any, downstream: any) => unknown>
  settingsListeners: Array<(revision?: number, source?: string) => void>
  /** The tool names executed through `toolRuntime().execute`, in order. */
  toolExecutes: string[]
  setSettings: (value: unknown) => void
  emitSettings: () => void
}

/**
 * Build a stub adapter.
 *
 * `toolRuntime().execute` calls the registered tool's own `execute`, which is how
 * the engine's hold path reaches the plugin's own action through the tool seam.
 */
export function stubAdapter(options: StubOptions): StubAdapter {
  const tools = new Map<string, DshToolDef>()
  const pre: Array<(exec: any, decision: any) => void> = []
  const post: Array<(exec: any, result: any, downstream: any) => unknown> = []
  const settingsListeners: Array<(revision?: number, source?: string) => void> = []
  const toolExecutes: string[] = []
  let settings = options.settings
  const adapter = {
    workspaceRoot: (exec?: unknown) => {
      const cwd = (exec as { agent?: { session?: { header?: { cwd?: unknown } } } } | undefined)?.agent?.session?.header?.cwd
      return typeof cwd === "string" && cwd !== "" ? cwd : options.workspace
    },
    workspaceRootsAll: () => [options.workspace],
    settingsReader: () => ({ get: () => settings, describe: () => undefined }),
    onSettingsDocumentUpdated: (_ns: string, listener: (revision?: number, source?: string) => void) => {
      settingsListeners.push(listener)
      return () => {
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
        const index = pre.indexOf(listener)
        if (index >= 0) pre.splice(index, 1)
      }
    },
    onPostToolExecute: (listener: (exec: any, result: any, downstream: any) => unknown) => {
      post.push(listener)
      return () => {
        const index = post.indexOf(listener)
        if (index >= 0) post.splice(index, 1)
      }
    },
    toolRuntime: () => ({
      get: (toolName: string) => tools.get(toolName),
      execute: async (input: { name: string; arguments?: unknown }) => {
        toolExecutes.push(input.name)
        const definition = tools.get(input.name)
        if (definition === undefined) throw new Error("unknown tool " + input.name)
        return await definition.execute(input.arguments ?? {}, {})
      },
    }),
    capabilities: () => ({}),
  } as unknown as DshAdapter
  return {
    adapter,
    tools,
    pre,
    post,
    settingsListeners,
    toolExecutes,
    setSettings: (value: unknown) => {
      settings = value
    },
    emitSettings: () => {
      for (const listener of settingsListeners) listener(2, "user")
    },
  }
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
    logPrefix: "mpd-team-watchdog-test",
    toolInFlightMaxMs: 900_000,
    ...overrides,
  }
}

/** A plugin context stub: `get("mpdDsh")` hands `apply` the stub adapter. */
export interface PluginCtx {
  get: (id: string, strict?: boolean) => unknown
  provide?: (id: string, value: unknown) => void
  on: (event: string, handler: (...args: any[]) => unknown) => () => void
  effect: (callback: () => unknown) => void
  logger: { warn: (text: string) => void; info: (text: string) => void }
  handlers: Map<string, (...args: any[]) => unknown>
  warnings: string[]
  cleanups: Array<() => unknown>
  /** Services this row published (`ctx.provide`). */
  services: Map<string, unknown>
  __stub: StubAdapter
  __dispose: () => void
}

/** Build a plugin context plus its stub adapter (the `apply` surface). */
export function pluginCtx(workspace: string, settings?: unknown): PluginCtx {
  const stub = stubAdapter({ workspace, settings })
  const handlers = new Map<string, (...args: any[]) => unknown>()
  const cleanups: Array<() => unknown> = []
  const warnings: string[] = []
  const services = new Map<string, unknown>()
  return {
    get: (id: string) => (id === "mpdDsh" ? stub.adapter : services.get(id)),
    provide: (id: string, value: unknown) => {
      services.set(id, value)
    },
    services,
    on: (event, handler) => {
      handlers.set(event, handler)
      return () => handlers.delete(event)
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
        const result = cleanup()
        if (typeof result === "function") (result as () => void)()
      }
    },
  }
}
