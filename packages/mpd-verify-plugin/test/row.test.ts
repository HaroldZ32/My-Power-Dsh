// THE ROW'S OWN INTEGRATION ARM — mount it into a stub composition and drive the REAL wiring.
//
// The offline arms in `law.test.ts` prove the DECISIONS. This file proves the PLUMBING between them: that
// `apply()` publishes the `mpdVerify` service, registers all five tools through the adapter, installs the
// delegation observer, writes the boot marker and prints a boot line a mount lane can assert — and that
// the ROLES-side guard, reading that very service, refuses the captain's code write and allows it again
// once `mpd_verify_open` armed a loop. Without this arm a typo in `apply()` would be invisible until a
// live boot, which is the slowest possible place to find it.
import { describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { apply } from "../src/index.ts"
import { VERIFY_SERVICE } from "../src/service.ts"
import { installVerifyGuard } from "../../mpd-roles-plugin/src/verify-guard.ts"

/** One registered tool, as the stub registry keeps it. */
interface RegisteredTool {
  /** The tool name the model calls. */
  name: string
  /** The body the harness would invoke. */
  execute: (args: unknown, exec: unknown) => unknown
}

/** A stub composition that records everything the row does. */
function harness(workspace: string): {
  ctx: Record<string, unknown>
  tools: RegisteredTool[]
  guards: Array<(exec: unknown) => string | undefined>
  lines: string[]
  observers: { count: number }
  services: Map<string, unknown>
  stub: Record<string, unknown>
} {
  /** Every tool the row registered. */
  const tools: RegisteredTool[] = []
  /** Every guard the row installed. */
  const guards: Array<(exec: unknown) => string | undefined> = []
  /** Every boot line the row printed. */
  const lines: string[] = []
  /** How many post-execute observers were installed. */
  const observers = { count: 0 }
  /** The services published through `provide`. */
  const services = new Map<string, unknown>()
  /** The adapter slice `createLazyDshAdapter` will resolve and forward to. */
  const stub: Record<string, unknown> = {
    capabilities: () => ({ toolsGuard: true, toolsRegister: true }),
    workspaceRoot: () => workspace,
    registerTool: (definition: RegisteredTool) => { tools.push(definition); return () => { /* unregistered */ } },
    registerTools: (definitions: RegisteredTool[]) => { for (const definition of definitions) tools.push(definition); return () => { /* unregistered */ } },
    guardTool: (guard: (exec: unknown) => string | undefined) => { guards.push(guard); return () => { /* unregistered */ } },
    onPostToolExecute: () => { observers.count += 1; return () => { /* unregistered */ } },
    teamMembership: () => undefined,
  }
  /** The ctx: `get` answers the adapter for `mpdDsh`, nothing for the config layer, and the law's service. */
  const ctx: Record<string, unknown> = {
    tools: {},
    provide: (id: string, value: unknown) => { services.set(id, value) },
    get: (id: string, strict?: boolean) => {
      if (id === "mpdDsh") return stub
      if (id === VERIFY_SERVICE) return services.get(VERIFY_SERVICE)
      if (id === "mpdConfig") return undefined
      if (strict === true) return undefined
      return undefined
    },
    on: () => () => { /* unregistered */ },
  }
  // The boot-log sink: `rowLogLine` writes to stdout, so the line is captured by patching the writer the
  // adapter exports would be overkill — instead the row's own log calls are read back from the console
  // spy below. The array is filled by the spy in `installLineSpy`.
  return { ctx, tools, guards, lines, observers, services, stub }
}

/**
 * Read the row's own boot lines back from its LOG SINK.
 *
 * `rowLogLine` deliberately never prints to the terminal (R5): it appends to
 * `<workspace>/.mpd/logs/<row>.log`. Reading that file is therefore the honest way to assert a boot line
 * a mount lane would check — and it also pins the R5 discipline for this row.
 *
 * @param workspace - the workspace the row booted against.
 * @returns the log's lines, or an empty list when nothing was written.
 */
function bootLines(workspace: string): string[] {
  try {
    return readFileSync(join(workspace, ".mpd", "logs", "mpd-verify.log"), "utf8").split("\n").filter((line) => line !== "")
  } catch { return [] }
}

describe("the mpd-verify row", () => {
  test("apply publishes the service, registers five tools, installs the observer and marks the boot", () => {
    /** The sandbox workspace the row boots against — NEVER the repository root (F.1). */
    const workspace = mkdtempSync(join(tmpdir(), "mpd-verify-row-"))
    /** The stub composition this arm drives. */
    const h = harness(workspace)
    // THE LOG ROOT IS AN ENV FACT, not a row parameter: `rowLogLine` resolves
    // `MPD_MCP_LOG_DIR` -> `DSH_WORKSPACE_ROOT` -> cwd, so a unit test that did not pin it would append
    // to the REPOSITORY's own `.mpd/logs/` — the §7 isolation trap, one layer down from the workspace.
    /** The previous log roots, restored before the next arm. */
    const previousLogRoot = process.env.MPD_MCP_LOG_DIR
    /** The previous DSH_WORKSPACE_ROOT, restored after the arm. */
    const previousWorkspace = process.env.DSH_WORKSPACE_ROOT
    // `rowLogLine` hands `openLogSink` an EXPLICIT root — `workspaceRootOf(undefined)`, which resolves
    // `DSH_WORKSPACE_ROOT` before cwd — so BOTH spellings are pinned here. Without this the boot line
    // appends to the REPOSITORY's own `.mpd/logs/`, which is the §7 isolation trap one layer down.
    process.env.MPD_MCP_LOG_DIR = workspace
    process.env.DSH_WORKSPACE_ROOT = workspace
    try {
      apply(h.ctx as never, { mode: "hard", escapeUses: 1 })
    } finally {
      if (previousLogRoot === undefined) delete process.env.MPD_MCP_LOG_DIR
      else process.env.MPD_MCP_LOG_DIR = previousLogRoot
      if (previousWorkspace === undefined) delete process.env.DSH_WORKSPACE_ROOT
      else process.env.DSH_WORKSPACE_ROOT = previousWorkspace
    }
    // THE SERVICE, which the roles-side guard resolves per call.
    expect(h.services.has(VERIFY_SERVICE)).toBe(true)
    // THE FIVE TOOLS, by name.
    expect(h.tools.map((tool) => tool.name).sort()).toEqual([
      "mpd_verify_escape", "mpd_verify_evidence", "mpd_verify_open", "mpd_verify_record", "mpd_verify_seat",
    ])
    // THE OBSERVER and the BOOT MARKER.
    expect(h.observers.count).toBe(1)
    /** The lines the row wrote to its own log sink. */
    const lines = bootLines(workspace)
    expect(lines.some((line) => line.includes("verifyGate=installed"))).toBe(true)
    expect(lines.some((line) => line.includes("bootMarker=written"))).toBe(true)
    expect(lines.some((line) => line.includes("tools=5"))).toBe(true)
    rmSync(workspace, { recursive: true, force: true })
  })

  test("the ROLES-side guard, reading that service, refuses a captain write and allows it after an arm", async () => {
    /** The sandbox workspace. */
    const workspace = mkdtempSync(join(tmpdir(), "mpd-verify-guard-"))
    /** The stub composition this arm drives. */
    const h = harness(workspace)
    apply(h.ctx as never, { mode: "hard", escapeUses: 1 })
    /** The law's runtime, as the guard resolves it. */
    const law = h.services.get(VERIFY_SERVICE)
    /** The guard's install, against the same stub registry. */
    const installed = installVerifyGuard(h.stub as never, {
      presets: ["mpd"],
      law: () => law as never,
      workspaceRootOf: () => workspace,
      configValue: () => undefined,
      warn: () => { /* the arms assert decisions, not warnings */ },
    })
    expect(installed.installed).toBe(true)
    /** The installed guard. */
    const guard = h.guards.at(-1)
    expect(guard).toBeDefined()
    /** A TOP-LEVEL mpd agent, in this workspace. */
    const agent = { session: { id: "captain-session", header: { cwd: workspace, agentPreset: "mpd" } } }
    /** THE DENIAL: a code write with no loop and no escape. */
    expect(String(guard?.({ name: "write", arguments: { file_path: "packages/a/src/index.ts" }, agent }) ?? "")).toContain("verification law")
    // THE OTHER DIRECTION, on the SAME guard: a documentation write is never gated.
    expect(guard?.({ name: "write", arguments: { file_path: "docs/index.md" }, agent })).toBeUndefined()
    // A CHILD session is never the captain.
    expect(guard?.({ name: "write", arguments: { file_path: "packages/a/src/index.ts" }, agent: { session: { id: "member", header: { cwd: workspace, agentPreset: "mpd", parentSession: "captain-session" } } } })).toBeUndefined()
    // ARM A LOOP through the tool the row registered, then the SAME write is allowed.
    /** The `mpd_verify_open` tool. */
    const open = h.tools.find((tool) => tool.name === "mpd_verify_open")
    /** The arm's result. */
    const armed = await open?.execute({ writer: "self", verifier: "a-different-agent", self_write_reason: "only writer", scope: ["packages/a"] }, { agent }) as { refused?: string; loopId?: string }
    expect(armed.refused).toBeUndefined()
    expect(armed.loopId).toBeDefined()
    expect(guard?.({ name: "write", arguments: { file_path: "packages/a/src/index.ts" }, agent })).toBeUndefined()
    rmSync(workspace, { recursive: true, force: true })
  })

  test("§5's one-git-writer rule through the INSTALLED guard: member denied, captain allowed", () => {
    /** The sandbox workspace. */
    const workspace = mkdtempSync(join(tmpdir(), "mpd-verify-git-"))
    /** The stub composition this arm drives. */
    const h = harness(workspace)
    apply(h.ctx as never, { mode: "hard" })
    installVerifyGuard(h.stub as never, {
      presets: ["mpd"], law: () => h.services.get(VERIFY_SERVICE) as never, workspaceRootOf: () => workspace,
      configValue: () => undefined, warn: () => { /* the arms assert decisions, not warnings */ },
    })
    /** The installed guard. */
    const guard = h.guards.at(-1)
    // A MEMBER is a child session (`parentSession` set), so it is not the captain.
    const member = { session: { id: "member-session", header: { cwd: workspace, agentPreset: "mpd", parentSession: "captain-session" } } }
    expect(String(guard?.({ name: "bash", arguments: { command: "git commit -m x" }, agent: member }) ?? "")).toContain("one-git-writer rule")
    // READ-ONLY GIT STAYS OPEN — the other direction on the same tool.
    expect(guard?.({ name: "bash", arguments: { command: "git status --short" }, agent: member })).toBeUndefined()
    // THE CAPTAIN MAY COMMIT: §5 makes the captain the ONE git writer, so the rule must not touch it.
    const captain = { session: { id: "captain-session", header: { cwd: workspace, agentPreset: "mpd" } } }
    expect(guard?.({ name: "bash", arguments: { command: "git commit -m x" }, agent: captain })).toBeUndefined()
    rmSync(workspace, { recursive: true, force: true })
  })

  test("a self-writer loop without a reason or without a different verifier is REFUSED", async () => {
    /** The sandbox workspace. */
    const workspace = mkdtempSync(join(tmpdir(), "mpd-verify-open-"))
    /** The stub composition this arm drives. */
    const h = harness(workspace)
    apply(h.ctx as never, {})
    /** The `mpd_verify_open` tool. */
    const open = h.tools.find((tool) => tool.name === "mpd_verify_open")
    /** A top-level agent. */
    const agent = { session: { id: "captain-session", header: { cwd: workspace, agentPreset: "mpd" } } }
    expect(String((await open?.execute({ writer: "self", verifier: "other" }, { agent }) as { refused?: string })?.refused ?? "")).toContain("self_write_reason")
    expect(String((await open?.execute({ writer: "self", self_write_reason: "because" }, { agent }) as { refused?: string })?.refused ?? "")).toContain("requires `verifier`")
    rmSync(workspace, { recursive: true, force: true })
  })

  test("an escape is counted, logged and buys exactly one write", async () => {
    /** The sandbox workspace. */
    const workspace = mkdtempSync(join(tmpdir(), "mpd-verify-escape-"))
    /** The stub composition this arm drives. */
    const h = harness(workspace)
    apply(h.ctx as never, {})
    /** The law's runtime. */
    const law = h.services.get(VERIFY_SERVICE)
    installVerifyGuard(h.stub as never, {
      presets: ["mpd"], law: () => law as never, workspaceRootOf: () => workspace,
      configValue: () => undefined, warn: () => { /* not asserted here */ },
    })
    /** The installed guard. */
    const guard = h.guards.at(-1)
    /** The caller. */
    const agent = { session: { id: "captain-session", header: { cwd: workspace, agentPreset: "mpd" } } }
    /** The escape tool. */
    const escape = h.tools.find((tool) => tool.name === "mpd_verify_escape")
    expect(guard?.({ name: "write", arguments: { file_path: "packages/a/src/x.ts" }, agent })).toBeDefined()
    /** The escape's result. */
    const escaped = await escape?.execute({ reason: "the only writer is this session" }, { agent }) as { count?: number }
    expect(escaped.count).toBe(1)
    // ALLOWED ONCE, then DENIED AGAIN — the allowance is spent by the write it authorised.
    expect(guard?.({ name: "write", arguments: { file_path: "packages/a/src/x.ts" }, agent })).toBeUndefined()
    expect(guard?.({ name: "write", arguments: { file_path: "packages/a/src/x.ts" }, agent })).toBeDefined()
    /** The escape log, read back from the workspace the row wrote it into. */
    const log = await import("node:fs").then((fs) => fs.readFileSync(join(workspace, ".mpd", "verify", "escape.jsonl"), "utf8"))
    expect(log).toContain("the only writer is this session")
    rmSync(workspace, { recursive: true, force: true })
  })
})
