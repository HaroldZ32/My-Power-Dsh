// Wave-3 t4 regression tests for the O-1 apply-time root resolution and the
// call-time `/mpd-codegraph` handler. Kept inside `src/` (the task's in-scope
// path) so `bun test packages/mpd-codegraph-plugin` exercises it; it is not part
// of the dist build (`bun build src/index.ts`).
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { apply } from "./index"

/** One command definition as the plugin registers it, reduced to the fields these arms assert on. */
type Registered = { name: string; description: string; handler: (invocation?: unknown) => Promise<{ kind: string; text?: string }> }
/** The row context the plugin is applied against: only a service lookup, which the arms answer selectively. */
type Ctx = { get?(key: string): unknown }

/** The five ambient env values these arms overwrite, kept so `afterEach` can put each one back. */
const savedEnv = { root: process.env.DSH_WORKSPACE_ROOT, project: process.env.MPD_CODEGRAPH_PROJECT_CWD, legacy: process.env.MPD_DSH_CODEGRAPH_PROJECT_CWD, binary: process.env.MPD_CODEGRAPH_BIN, binaryAlias: process.env.MPD_DSH_CODEGRAPH_BIN }
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

/**
 * The newest line the plugin recorded in a workspace, read from its log file.
 *
 * R5 (lane F) moved the apply-time status line OFF `console.log` and into
 * `<root>/.mpd/logs/mpd-codegraph.log`, so the arms below read the sink's output the same way a user
 * would. The ISO-8601 prefix the sink adds is stripped, leaving the line the plugin wrote.
 *
 * @param root the workspace root whose log is read.
 * @returns the newest recorded line, or `""` when the log does not exist yet.
 */
function lastLogLine(root: string): string {
  try {
    /** Every recorded line, oldest first; the sink always terminates the last one. */
    const lines = readFileSync(join(root, ".mpd", "logs", "mpd-codegraph.log"), "utf8").trimEnd().split("\n")
    return (lines.at(-1) ?? "").replace(/^\[[^\]]*\] /, "")
  } catch { return "" }
}

/**
 * Run `apply` and read the `cwd=` field off the status line it recorded in `root`'s log.
 *
 * @param root the workspace root `apply` is expected to log against.
 * @param run the call to make, usually one `apply`.
 * @returns the `cwd=` field of the newest recorded status line, or `""` when it carries none.
 */
function captureCwd(root: string, run: () => void): string {
  run()
  /** The `cwd=` field of that line, or null when the line does not carry one. */
  const match = / cwd=(\S+)/.exec(lastLogLine(root))
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
  delete process.env.MPD_CODEGRAPH_BIN
  delete process.env.MPD_DSH_CODEGRAPH_BIN
})

afterEach(() => {
  if (savedEnv.root === undefined) delete process.env.DSH_WORKSPACE_ROOT; else process.env.DSH_WORKSPACE_ROOT = savedEnv.root
  if (savedEnv.project === undefined) delete process.env.MPD_CODEGRAPH_PROJECT_CWD; else process.env.MPD_CODEGRAPH_PROJECT_CWD = savedEnv.project
  if (savedEnv.legacy === undefined) delete process.env.MPD_DSH_CODEGRAPH_PROJECT_CWD; else process.env.MPD_DSH_CODEGRAPH_PROJECT_CWD = savedEnv.legacy
  if (savedEnv.binary === undefined) delete process.env.MPD_CODEGRAPH_BIN; else process.env.MPD_CODEGRAPH_BIN = savedEnv.binary
  if (savedEnv.binaryAlias === undefined) delete process.env.MPD_DSH_CODEGRAPH_BIN; else process.env.MPD_DSH_CODEGRAPH_BIN = savedEnv.binaryAlias
  while (temps.length > 0) {
    /** One recorded temp workspace, removed with everything the plugin wrote inside it. */
    const dir = temps.pop()
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  }
})

describe("O-1 apply-time project root", () => {
  test("no session and no override falls back to process.cwd()", () => {
    /** The root the plugin resolved for this arm, read off its status line. */
    const observed = captureCwd(process.cwd(), () => apply({ get: () => undefined }))
    expect(observed).toBe(process.cwd())
  })

  test("a session workspace (exec-less DSH_WORKSPACE_ROOT) beats the process cwd", () => {
    /** A marked workspace standing in for the calling session's own directory. */
    const session = tempWorkspace(true)
    process.env.DSH_WORKSPACE_ROOT = session
    /** The root the plugin resolved for this arm, read off its status line. */
    const observed = captureCwd(session, () => apply({ get: () => undefined }))
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
    // The status line is written to the SESSION WORKSPACE's log even while the project root is the
    // override, which is exactly the distinction R5 draws between the log root and the project root.
    expect(captureCwd(session, () => apply({ get: () => undefined }))).toBe(override)

    delete process.env.MPD_CODEGRAPH_PROJECT_CWD
    process.env.MPD_DSH_CODEGRAPH_PROJECT_CWD = override
    expect(captureCwd(session, () => apply({ get: () => undefined }))).toBe(override)
  })

  test("the status line names the session workspace, and the home skip still applies", () => {
    /** A marked workspace standing in for the calling session's own directory. */
    const session = tempWorkspace(true)
    process.env.DSH_WORKSPACE_ROOT = session
    apply({ get: () => undefined })
    /** The line the plugin recorded in that workspace's log. */
    const line = lastLogLine(session)
    expect(line).toContain("status=marker")
    expect(line).toContain("cwd=" + session)
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
    apply(ctx, { autoInit: false, binary: process.execPath })
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
    apply(ctx, { autoInit: false, binary: process.execPath })
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
    apply(ctx, { autoInit: false, binary: process.execPath })
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
    apply(ctx, { autoInit: false, binary: process.execPath })
    expect(registered).toHaveLength(1)
    expect(registered[0]?.name).toBe("mpd-codegraph")
    /** The command's answer on that path, which must still resolve its own session root. */
    const result = await registered[0]!.handler({ agent: { session: { header: { cwd: session } } } })
    expect(result.kind).toBe("success")
    expect(result.text).toContain(session)
  })

  test("apply never throws when the composition has no command registry at all", () => {
    expect(() => { apply({ get: () => undefined }, { autoInit: false }) }).not.toThrow()
    expect(() => { apply({ get: (key: string) => (key === "commands" ? {} : undefined) }, { autoInit: false }) }).not.toThrow()
  })
})

/**
 * A real file standing in for an operator-supplied `codegraph` binary, so an override that RESOLVES
 * it is told apart from one that silently fell through to another tier.
 * @returns the absolute path of the created file, recorded for `afterEach` teardown.
 */
function binaryFixture(): string {
  /** A fresh temp directory holding this fixture. */
  const dir = mkdtempSync(join(tmpdir(), "mpd-cg-bin-"))
  temps.push(dir)
  /** The fixture binary's absolute path. */
  const file = join(dir, "codegraph")
  writeFileSync(file, "#!/bin/sh\nexit 0\n")
  return file
}

describe("S8: a blank-but-SET env value does not suppress its documented alias", () => {
  test("a blank MPD_CODEGRAPH_BIN still lets MPD_DSH_CODEGRAPH_BIN resolve the binary", () => {
    /** The marked session workspace whose log carries the status line. */
    const session = tempWorkspace(true)
    /** The alias-named binary, which must be the resolver's answer. */
    const alias = binaryFixture()
    process.env.DSH_WORKSPACE_ROOT = session
    process.env.MPD_CODEGRAPH_BIN = ""
    process.env.MPD_DSH_CODEGRAPH_BIN = alias
    apply({ get: () => undefined })
    // Pre-fix the blank primary suppressed the alias AND was filtered out, so the line read binary=-.
    expect(lastLogLine(session)).toContain("binary=" + alias)
  })

  test("a blank MPD_CODEGRAPH_PROJECT_CWD still lets its alias resolve the project root", () => {
    /** The marked session workspace, which is NOT the project root this arm resolves. */
    const session = tempWorkspace(true)
    /** The marked workspace the alias names as the project root. */
    const override = tempWorkspace(true)
    process.env.DSH_WORKSPACE_ROOT = session
    process.env.MPD_CODEGRAPH_PROJECT_CWD = ""
    process.env.MPD_DSH_CODEGRAPH_PROJECT_CWD = override
    expect(captureCwd(session, () => apply({ get: () => undefined }))).toBe(override)
  })

  test("NEGATIVE CONTROL: a non-blank primary still wins, and two blanks fall back to the session", () => {
    /** The marked session workspace, used as the log root and the fallback project root. */
    const session = tempWorkspace(true)
    /** The primary-named binary, which must beat the alias when it is not blank. */
    const primary = binaryFixture()
    /** The alias-named binary, which must lose to a usable primary. */
    const alias = binaryFixture()
    process.env.DSH_WORKSPACE_ROOT = session
    process.env.MPD_CODEGRAPH_BIN = primary
    process.env.MPD_DSH_CODEGRAPH_BIN = alias
    apply({ get: () => undefined })
    expect(lastLogLine(session)).toContain("binary=" + primary)
    // Both variables blank-but-SET: no override at all, so the session workspace decides.
    process.env.MPD_CODEGRAPH_PROJECT_CWD = ""
    process.env.MPD_DSH_CODEGRAPH_PROJECT_CWD = ""
    expect(captureCwd(session, () => apply({ get: () => undefined }))).toBe(session)
  })
})
