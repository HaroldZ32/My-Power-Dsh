// Wave-3 t4 regression tests for the O-1 apply-time root resolution and the
// call-time `/mpd-codegraph` handler. Kept inside `src/` (the task's in-scope
// path) so `bun test packages/mpd-codegraph-plugin` exercises it; it is not part
// of the dist build (`bun build src/index.ts`).
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { apply } from "./index"

/** One command definition as the plugin registers it, reduced to the fields these arms assert on. */
type Registered = { name: string; description: string; handler: (invocation?: unknown) => Promise<{ kind: string; text?: string }> }
/** The row context the plugin is applied against: only a service lookup, which the arms answer selectively. */
type Ctx = { get?(key: string): unknown }

/** The three ambient env values these arms overwrite, kept so `afterEach` can put each one back. */
const savedEnv = { root: process.env.DSH_WORKSPACE_ROOT, project: process.env.MPD_CODEGRAPH_PROJECT_CWD, legacy: process.env.MPD_DSH_CODEGRAPH_PROJECT_CWD }
/** Every temp workspace this file created, removed by `afterEach` so no arm leaks a directory. */
const temps: string[] = []

/** Create a temp workspace, optionally pre-marked with an index so the plugin skips initialization. */
function tempWorkspace(marked: boolean): string {
  /** The workspace directory, registered in `temps` before anything can fail. */
  const dir = mkdtempSync(join(tmpdir(), "mpd-cg-root-"))
  temps.push(dir)
  if (marked) {
    mkdirSync(join(dir, ".codegraph"), { recursive: true })
    writeFileSync(join(dir, ".codegraph", "codegraph.db"), "")
  }
  return dir
}

/** Capture the plugin's apply-time status line without printing it. */
function captureCwd(run: () => void): string {
  /** The real `console.log`, restored in the `finally` below. */
  const original = console.log
  /** Every line the plugin logged while `run` executed. */
  const lines: string[] = []
  console.log = (...args: unknown[]) => { lines.push(args.map(String).join(" ")) }
  try { run() } finally { console.log = original }
  /** The one status line this helper exists to read. */
  const line = lines.find((l) => l.startsWith("[mpd-codegraph] init status=")) ?? ""
  /** The `cwd=` field of that line, or null when the line does not carry one. */
  const match = / cwd=(\S+)/.exec(line)
  return match?.[1] ?? ""
}

/**
 * The adapter double the plugin now talks to (AGENTS.md §6: the command goes
 * through `registerCommand`, never through the harness registry directly).
 * `mounted: false` drops the `mpdDsh` service so `apply` builds the real
 * standalone adapter, which then reads the `commands` key itself — the stub
 * deliberately returns NOTHING from `register()`, so that path also proves the
 * adapter's non-callable-disposer guard.
 */
function commandCtx(rootFor?: (exec?: { agent?: unknown }) => string, mounted: boolean = true): { ctx: Ctx; registered: Registered[] } {
  /** Every command definition the plugin registered through this double. */
  const registered: Registered[] = []
  /** The `mpdDsh` service double: a workspace plane plus a recording command registry. */
  const dsh = {
    workspaceRoot: rootFor ?? ((exec?: { agent?: unknown }) => ((exec?.agent as any)?.session?.header?.cwd ?? process.cwd())),
    registerCommand: (definition: Registered) => { registered.push(definition); return () => { /* seam double: nothing to release */ } },
  }
  /** The row context: a service lookup that answers `mpdDsh`, and `commands` only on the unmounted path. */
  const ctx: Ctx = {
    /** Answer the two service names this plugin resolves, and nothing else. */
    get(key: string): unknown {
      if (key === "mpdDsh") return mounted ? dsh : undefined
      if (key === "commands" && !mounted) return { register: (d: unknown) => { registered.push(d as Registered) } }
      return undefined
    },
  }
  return { ctx, registered }
}

beforeEach(() => {
  delete process.env.DSH_WORKSPACE_ROOT
  delete process.env.MPD_CODEGRAPH_PROJECT_CWD
  delete process.env.MPD_DSH_CODEGRAPH_PROJECT_CWD
})

afterEach(() => {
  if (savedEnv.root === undefined) delete process.env.DSH_WORKSPACE_ROOT; else process.env.DSH_WORKSPACE_ROOT = savedEnv.root
  if (savedEnv.project === undefined) delete process.env.MPD_CODEGRAPH_PROJECT_CWD; else process.env.MPD_CODEGRAPH_PROJECT_CWD = savedEnv.project
  if (savedEnv.legacy === undefined) delete process.env.MPD_DSH_CODEGRAPH_PROJECT_CWD; else process.env.MPD_DSH_CODEGRAPH_PROJECT_CWD = savedEnv.legacy
  while (temps.length > 0) {
    /** One recorded temp workspace, removed with everything the plugin wrote inside it. */
    const dir = temps.pop()
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  }
})

describe("O-1 apply-time project root", () => {
  test("no session and no override falls back to process.cwd()", () => {
    /** The root the plugin resolved for this arm, read off its status line. */
    const observed = captureCwd(() => apply({ get: () => undefined }))
    expect(observed).toBe(process.cwd())
  })

  test("a session workspace (exec-less DSH_WORKSPACE_ROOT) beats the process cwd", () => {
    /** A marked workspace standing in for the calling session's own directory. */
    const session = tempWorkspace(true)
    process.env.DSH_WORKSPACE_ROOT = session
    /** The root the plugin resolved for this arm, read off its status line. */
    const observed = captureCwd(() => apply({ get: () => undefined }))
    expect(observed).toBe(session)
    expect(observed).not.toBe(process.cwd())
  })

  test("the explicit project-cwd override wins over the session workspace", () => {
    /** A marked workspace standing in for the calling session's own directory. */
    const session = tempWorkspace(true)
    /** A second marked workspace standing in for the operator's project-cwd override. */
    const override = tempWorkspace(true)
    process.env.DSH_WORKSPACE_ROOT = session
    process.env.MPD_CODEGRAPH_PROJECT_CWD = override
    expect(captureCwd(() => apply({ get: () => undefined }))).toBe(override)

    delete process.env.MPD_CODEGRAPH_PROJECT_CWD
    process.env.MPD_DSH_CODEGRAPH_PROJECT_CWD = override
    expect(captureCwd(() => apply({ get: () => undefined }))).toBe(override)
  })

  test("the status line names the session workspace, and the home skip still applies", () => {
    /** A marked workspace standing in for the calling session's own directory. */
    const session = tempWorkspace(true)
    process.env.DSH_WORKSPACE_ROOT = session
    /** The real `console.log`, restored in the `finally` below. */
    const original = console.log
    /** Every line the plugin logged during this arm. */
    const lines: string[] = []
    console.log = (...args: unknown[]) => { lines.push(args.map(String).join(" ")) }
    try { apply({ get: () => undefined }) } finally { console.log = original }
    expect(lines[0]).toContain("status=marker")
    expect(lines[0]).toContain("cwd=" + session)
  })
})

describe("O-1 call-time /mpd-codegraph handler", () => {
  test("resolves the invocation's session workspace, not the apply-time root", async () => {
    /** The marked workspace the plugin is applied against. */
    const applyRoot = tempWorkspace(true)
    /** A different marked workspace, supplied later by the command invocation. */
    const session = tempWorkspace(true)
    process.env.DSH_WORKSPACE_ROOT = applyRoot
    /** The adapter double's context and the command it recorded. */
    const { ctx, registered } = commandCtx()
    captureCwd(() => apply(ctx, { autoInit: false, binary: process.execPath }))
    expect(registered).toHaveLength(1)
    expect(registered[0]?.name).toBe("mpd-codegraph")

    /** The command's answer for an invocation whose session lives in the OTHER workspace. */
    const result = await registered[0]!.handler({ agent: { session: { header: { cwd: session } } } })
    expect(result.kind).toBe("success")
    expect(result.text).toContain(session)
    expect(result.text).not.toContain(applyRoot)
  })

  test("returns the harness CommandResult shape (kind), never the legacy success flag", async () => {
    /** The marked workspace the command invocation will name. */
    const session = tempWorkspace(true)
    /** The adapter double's context and the command it recorded. */
    const { ctx, registered } = commandCtx()
    captureCwd(() => apply(ctx, { autoInit: false, binary: process.execPath }))
    /** The command's answer, whose key set is the harness contract this arm pins. */
    const result = await registered[0]!.handler({ agent: { session: { header: { cwd: session } } } })
    expect(Object.keys(result)).toEqual(["kind", "text"])
    expect(result.kind).toBe("success")
  })

  test("re-resolves per invocation: two sessions, two targets", async () => {
    /** The first session workspace the handler will be asked about. */
    const first = tempWorkspace(true)
    /** The second, different session workspace. */
    const second = tempWorkspace(true)
    /** The adapter double's context and the command it recorded. */
    const { ctx, registered } = commandCtx()
    captureCwd(() => apply(ctx, { autoInit: false, binary: process.execPath }))
    /** The answer for the first invocation. */
    const one = await registered[0]!.handler({ agent: { session: { header: { cwd: first } } } })
    /** The answer for the second invocation, which must not reuse the first root. */
    const two = await registered[0]!.handler({ agent: { session: { header: { cwd: second } } } })
    expect(one.text).toContain(first)
    expect(two.text).toContain(second)
    expect(one.text).not.toContain(second)
  })
})

describe("command registration goes through the adapter (AGENTS.md §6)", () => {
  test("the standalone adapter registers the command and survives a stub register returning no disposer", async () => {
    /** The marked workspace the command invocation will name. */
    const session = tempWorkspace(true)
    /** The double for the UNMOUNTED composition, where the plugin builds the real adapter itself. */
    const { ctx, registered } = commandCtx(undefined, false)
    captureCwd(() => apply(ctx, { autoInit: false, binary: process.execPath }))
    expect(registered).toHaveLength(1)
    expect(registered[0]?.name).toBe("mpd-codegraph")
    /** The command's answer on that path, which must still resolve its own session root. */
    const result = await registered[0]!.handler({ agent: { session: { header: { cwd: session } } } })
    expect(result.kind).toBe("success")
    expect(result.text).toContain(session)
  })

  test("apply never throws when the composition has no command registry at all", () => {
    expect(() => { captureCwd(() => apply({ get: () => undefined }, { autoInit: false })) }).not.toThrow()
    expect(() => { captureCwd(() => apply({ get: (key: string) => (key === "commands" ? {} : undefined) }, { autoInit: false })) }).not.toThrow()
  })
})
