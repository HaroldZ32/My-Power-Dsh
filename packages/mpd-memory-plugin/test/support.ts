// Shared harness for the memory plugin's wave-W3-D arms: mount the plugin against a throwaway
// workspace, capture the tools it registers AND the ONE post-execute listener it installs through the
// real adapter, and sandbox `HOME` so no arm can ever touch the real `~/.mpd/memory` (T-43).
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { apply } from "../src/index.ts"
import type { DshToolDef } from "../../mpd-dsh-adapter-plugin/src/index.ts"

/** The environment keys every sandboxed arm re-points, restored when the arm ends. */
const HOME_KEYS = ["HOME", "DSH_HOME", "MPD_DSH_MEMORY_ALLOW_REAL_HOME"] as const

/** One captured post-execute registration, invoked the way the harness waterfall invokes it. */
export interface CapturedListener {
  /** The event name the adapter registered on; a row's archive hook must be `tools/post-execute`. */
  event: string
  /** Run the waterfall: the adapter's wrapper with `next` answering an accept decision. */
  run: (exec: unknown, result: unknown) => Promise<unknown>
  /** True once the row released the registration through its own `dispose` cleanup. */
  disposed: boolean
}

/** What one mounted plugin offers an arm. */
export interface MountedPlugin {
  /** The throwaway workspace the plugin resolves through `DSH_WORKSPACE_ROOT`. */
  workspace: string
  /** Every tool the plugin registered, in registration order. */
  tools: DshToolDef[]
  /** The post-execute listeners captured from the real adapter registration. */
  listeners: CapturedListener[]
  /** Fire the row's `dispose` cleanup, exactly as cordis would. */
  dispose: () => void
  /** Put `DSH_WORKSPACE_ROOT` (and the sandboxed HOME keys) back as they were. */
  restore: () => void
}

/** A registered tool handle whose result the arm states itself; the adapter types every result `unknown`. */
export type MemoryTool<Result> = Omit<DshToolDef, "execute"> & {
  /** Run the tool body and resolve its declared output. */
  execute: (args: Record<string, unknown>, exec: Record<string, unknown>) => Promise<Result>
}

/**
 * Create one throwaway directory outside the workspace.
 *
 * @param prefix - the mkdtemp prefix that names the arm in a failure message.
 * @returns the absolute directory path.
 */
export function sandbox(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

/**
 * Point `HOME`/`DSH_HOME` at one sandbox for the duration of an arm.
 *
 * `DSH_HOME` marks the process as an isolated boot (which is what arms the T-43 guard) and `HOME` is
 * the sandbox the guard then allows the global store to live under. The real home is never addressed.
 *
 * @param home - the sandbox directory to treat as the user's home.
 * @returns a hook that restores every key this function changed.
 */
export function enterSandboxHome(home: string): () => void {
  /** The values the keys held before this arm, so the restore is exact. */
  const saved: Record<string, string | undefined> = {}
  for (const key of HOME_KEYS) saved[key] = process.env[key]
  process.env.HOME = home
  process.env.DSH_HOME = home
  delete process.env.MPD_DSH_MEMORY_ALLOW_REAL_HOME
  return (): void => {
    for (const key of HOME_KEYS) {
      if (saved[key] === undefined) delete process.env[key]
      else process.env[key] = saved[key]
    }
  }
}

/**
 * Apply the plugin against one workspace, capturing its tools and its post-execute registration.
 *
 * The context is a stand-in for the row's cordis context: `tools` captures definitions, `get` answers
 * `mpdTeams` (and nothing else, so `mpdConfig` stays absent), and `on` captures the adapter's
 * `tools/post-execute` registration plus the row's own `dispose` callback.
 *
 * @param workspace - the workspace the plugin must resolve through `DSH_WORKSPACE_ROOT`.
 * @param config - the row config under test (vcs mode, slug, reflectionEvery, globalDir).
 * @param options - the `mpdTeams` service stub, when the arm needs one.
 * @returns the captured tools and listener plus the restore/dispose hooks.
 */
export function mount(
  workspace: string,
  config: Parameters<typeof apply>[1],
  options: { teams?: unknown } = {},
): MountedPlugin {
  /** Every tool definition the plugin registered, in registration order. */
  const tools: DshToolDef[] = []
  /** Every post-execute listener the adapter registered, in registration order. */
  const listeners: CapturedListener[] = []
  /** The row's own `dispose` callbacks, fired by {@link MountedPlugin.dispose}. */
  const disposers: Array<() => void> = []
  /** The ambient workspace root this fixture replaces, so `restore` can put it back. */
  const ambient = process.env.DSH_WORKSPACE_ROOT
  /** The row context the plugin sees; it satisfies the plugin's own `Ctx` shape. */
  const ctx = {
    tools: {
      /** Capture one registered definition, in registration order. */
      register(definition: DshToolDef): void { tools.push(definition) },
      /** Answer a lookup by tool name; the memory plugin never reaches a service through this seam. */
      get(name: string): DshToolDef | undefined { return tools.find((tool) => tool.name === name) },
    },
    /** The harness service probe: only `mpdTeams` is served, so `mpdConfig` stays absent. */
    get(name: string): unknown { return name === "mpdTeams" ? options.teams : undefined },
    /** The cordis event subscription: capture the waterfall registration and the dispose cleanup. */
    on(event: string, callback: any): () => void {
      if (event === "tools/post-execute") {
        /** The registration this mount captured. */
        const captured: CapturedListener = {
          event,
          disposed: false,
          run: async (exec: unknown, result: unknown): Promise<unknown> => callback(exec, result, async () => ({ kind: "accept" })),
        }
        listeners.push(captured)
        return (): void => { captured.disposed = true }
      }
      if (event === "dispose") disposers.push(callback)
      return (): void => { /* the fixture registers nothing else */ }
    },
  }
  process.env.DSH_WORKSPACE_ROOT = workspace
  apply(ctx, config)
  return {
    workspace,
    tools,
    listeners,
    dispose: (): void => { for (const dispose of disposers) dispose() },
    restore: (): void => {
      if (ambient === undefined) delete process.env.DSH_WORKSPACE_ROOT
      else process.env.DSH_WORKSPACE_ROOT = ambient
    },
  }
}

/**
 * Find one registered tool and state the result shape the arm asserts on.
 *
 * @param plugin - the mounted plugin.
 * @param name - the registered tool name.
 * @returns the tool handle, typed to the arm's own result shape.
 */
export function toolOf<Result>(plugin: MountedPlugin, name: string): MemoryTool<Result> {
  /** The matching definition; a missing one is a fixture bug, so the cast below is safe by assertion. */
  const found = plugin.tools.find((tool) => tool.name === name)
  if (found === undefined) throw new Error("the plugin registered no tool named " + name)
  return found as MemoryTool<Result>
}
