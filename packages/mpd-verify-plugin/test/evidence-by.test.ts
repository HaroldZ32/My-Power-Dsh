// C2 — `verify.evidenceBy`: a CAPTAIN's `kind:"gate"` evidence is refused, `kind:"probe"` stays open.
//
// WHY THIS FILE EXISTS. The wave's goal is that the top-level `mpd` captain stops running verification
// itself. The rule lives in ONE place (`evidenceTool`) and is enforced BEFORE a gate is resolved or a
// process is spawned, so every arm here asserts a REAL consequence rather than a message: the refusal
// writes NO evidence file and NO ledger row, and the declared gate's argv never drops its sentinel file
// (which is what proves no child process ran). Each refusal has an ALLOWED sibling — the captain's probe,
// a child's gate, and the `any` configuration — because a rule that only ever shows one direction is
// worth nothing. The boot-line token is asserted here too, so a stale build cannot pass by default.
import { describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { DshToolDef } from "../../mpd-dsh-adapter-plugin/src/index"
import { apply } from "../src/index.ts"
import { isMpdCaptainSession, resolveEvidenceBy } from "../src/law.ts"
import { evidenceDir, readEvidence } from "../src/ledger.ts"
import { createVerifyRuntime } from "../src/observe.ts"
import { DEFAULT_LOOP_TTL_MS, registerVerifyTools } from "../src/tools.ts"

/** The one project gate these arms declare, so a run has an observable side effect. */
const SENTINEL_GATE = "captain-arm"

/** The subset of `mpd_verify_evidence`'s result these arms read. */
interface EvidenceOutcome {
  /** The refusal sentence, when the call was refused. */
  refused?: string
  /** The child's exit code for a gate run. */
  exit?: number
  /** The evidence id, minted only when evidence was really written. */
  evidenceId?: string
  /** The content-free readings a probe returns. */
  probe?: Array<{ path?: string; bytes?: number; sha256?: string; mtime?: string }>
}

/** A session handle shaped the way the verify predicates read it; supplying no header omits the key. */
interface SessionHandle {
  /** The session id the tools use as the caller key. */
  session: { id: string; header?: Record<string, unknown> }
}

/** A throwaway workspace under the OS temp dir — never the repository root (F.1). */
function sandbox(): string {
  return mkdtempSync(join(tmpdir(), "mpd-verify-evidence-by-"))
}

/** Remove a sandbox and prove it is gone. */
function cleanup(workspace: string): void {
  rmSync(workspace, { recursive: true, force: true })
  expect(existsSync(workspace)).toBe(false)
}

/** One agent handle; `header` omitted means the headerless session the predicate fails closed on. */
function agent(sessionId: string, header?: Record<string, unknown>): SessionHandle {
  return { session: header === undefined ? { id: sessionId } : { id: sessionId, header } }
}

/** The top-level session of the `mpd` preset — the captain the rule is scoped to. */
function captain(sessionId: string): SessionHandle {
  return agent(sessionId, { agentPreset: "mpd" })
}

/** A delegated child of the same preset. */
function child(sessionId: string): SessionHandle {
  return agent(sessionId, { origin: "subagent", delegationDepth: 1, agentPreset: "mpd" })
}

/**
 * Declare ONE fast project gate whose argv drops `spawned.txt` in the workspace.
 *
 * The sentinel is the arm's only proof that no child process ran: a gate refused AFTER resolution would
 * still resolve, and a refusal that happened after `runGate` would leave the file behind.
 *
 * @param workspace - the sandbox the project gate file is written into.
 */
function withSentinelGate(workspace: string): void {
  writeFileSync(join(workspace, "mpd-gates.json"), JSON.stringify({
    version: 1,
    gates: { [SENTINEL_GATE]: { argv: [process.execPath, "-e", "require('node:fs').writeFileSync('spawned.txt','ran')"] } },
  }), "utf8")
}

/**
 * The five registered law tools for one sandbox, with `verify.*` answered from `config`.
 *
 * @param workspace - the sandbox workspace the tools resolve state under.
 * @param config - the raw config answers, keyed by the full `verify.` spelling.
 * @returns the definitions keyed by tool name.
 */
function lawTools(workspace: string, config: Record<string, unknown> = {}): Map<string, DshToolDef> {
  /** The definitions the registration call hands the registry. */
  const captured: DshToolDef[] = []
  registerVerifyTools({
    /** Capture the definitions so an arm can call one directly, with no harness. */
    registerTools: (definitions: DshToolDef[]): (() => void) => { captured.push(...definitions); return () => {} },
  }, {
    /** The process-local runtime; these arms never observe an implementation read. */
    runtime: createVerifyRuntime({
      dsh: { workspaceRoot: () => workspace },
      warn: () => {},
      configValue: (key: string) => config[key],
      defaultEscapeUses: 1,
      loopTtlMs: DEFAULT_LOOP_TTL_MS,
    }),
    configValue: (key: string) => config[key],
    dsh: { workspaceRoot: () => workspace, teamMembership: () => undefined },
    log: () => {},
  })
  return new Map(captured.map((definition) => [definition.name, definition]))
}

/** One captured tool, refused loudly when the registration is incomplete. */
function toolFor(tools: Map<string, DshToolDef>, name: string): DshToolDef {
  /** The definition, absent only when registration broke. */
  const tool = tools.get(name)
  if (tool === undefined) throw new Error(name + " was not registered")
  return tool
}

/** Call one law tool as a named caller session. */
function callTool(tool: DshToolDef, args: Record<string, unknown>, who: unknown): EvidenceOutcome {
  return tool.execute(args, { name: tool.name, arguments: args, agent: who }) as EvidenceOutcome
}

/** Read the row's own boot lines back from its log sink. */
function bootLines(workspace: string): string[] {
  try {
    return readFileSync(join(workspace, ".mpd", "logs", "mpd-verify.log"), "utf8").split("\n").filter((line) => line !== "")
  } catch { return [] }
}

/** A stub composition the row's `apply()` can drive: the adapter slice and the services map. */
function bootHarness(workspace: string): Record<string, unknown> {
  /** The adapter slice `createLazyDshAdapter` resolves and forwards to. */
  const stub: Record<string, unknown> = {
    capabilities: () => ({ toolsGuard: true, toolsRegister: true }),
    workspaceRoot: () => workspace,
    registerTool: () => () => {},
    registerTools: () => () => {},
    guardTool: () => () => {},
    onPostToolExecute: () => () => {},
    teamMembership: () => undefined,
  }
  return {
    tools: {},
    provide: () => {},
    get: (id: string) => (id === "mpdDsh" ? stub : undefined),
    on: () => () => {},
  }
}

/**
 * Boot the row against a sandbox and return the boot lines it wrote.
 *
 * `rowLogLine` resolves its log root from `MPD_MCP_LOG_DIR` -> `DSH_WORKSPACE_ROOT` -> cwd, so BOTH are
 * pinned to the sandbox: without it the line would append to the REPOSITORY's own `.mpd/logs/` (the §7
 * isolation trap, one layer down from the workspace).
 *
 * @param workspace - the sandbox the row boots against.
 * @param config - the row config handed to `apply`.
 * @returns the lines the row wrote to its own log sink.
 */
function boot(workspace: string, config: Record<string, unknown>): string[] {
  /** The previous log root, restored after the arm. */
  const previousLogRoot = process.env.MPD_MCP_LOG_DIR
  /** The previous workspace root, restored after the arm. */
  const previousWorkspace = process.env.DSH_WORKSPACE_ROOT
  process.env.MPD_MCP_LOG_DIR = workspace
  process.env.DSH_WORKSPACE_ROOT = workspace
  try {
    apply(bootHarness(workspace) as never, config)
  } finally {
    if (previousLogRoot === undefined) delete process.env.MPD_MCP_LOG_DIR
    else process.env.MPD_MCP_LOG_DIR = previousLogRoot
    if (previousWorkspace === undefined) delete process.env.DSH_WORKSPACE_ROOT
    else process.env.DSH_WORKSPACE_ROOT = previousWorkspace
  }
  return bootLines(workspace)
}

describe("isMpdCaptainSession — the mirrored predicate", () => {
  test("a top-level `mpd` session IS the captain, including the seeded-fork shape (T-92)", () => {
    expect(isMpdCaptainSession(captain("s"))).toBe(true)
    // A SEEDED FORK is the user's real working session: it carries a parent link and depth 0, never a
    // subagent origin. The old "any parent session is a child" test classified the captain as a child.
    expect(isMpdCaptainSession(agent("s", { parentSession: "p", isSeeded: true, delegationDepth: 0, agentPreset: "mpd" }))).toBe(true)
    // An unreadable depth is NOT ">= 1", so it reads as the captain — the same conservative direction.
    expect(isMpdCaptainSession(agent("s", { delegationDepth: "n/a", agentPreset: "mpd" }))).toBe(true)
  })

  test("ABSENT or empty header fails closed: not the captain", () => {
    expect(isMpdCaptainSession({})).toBe(false)
    expect(isMpdCaptainSession(undefined)).toBe(false)
    expect(isMpdCaptainSession({ session: { id: "s" } })).toBe(false)
  })

  test("a recorded delegation fact makes it a child", () => {
    expect(isMpdCaptainSession(child("s"))).toBe(false)
    expect(isMpdCaptainSession(agent("s", { delegationDepth: 1, agentPreset: "mpd" }))).toBe(false)
    expect(isMpdCaptainSession(agent("s", { delegationDepth: 2, agentPreset: "mpd" }))).toBe(false)
  })

  test("a top-level session on ANOTHER preset is not this preset's captain", () => {
    expect(isMpdCaptainSession(agent("s", { agentPreset: "cordis" }))).toBe(false)
    expect(isMpdCaptainSession(agent("s"))).toBe(false)
  })
})

describe("mpd_verify_evidence — the captain's gate rule (C2 / A2)", () => {
  test("a captain's kind:\"gate\" is REFUSED before resolution: no spawn, no evidence file, no ledger row", () => {
    /** The sandbox the captain calls against. */
    const workspace = sandbox()
    withSentinelGate(workspace)
    /** The refusal the captain receives. */
    const out = callTool(toolFor(lawTools(workspace), "mpd_verify_evidence"), { kind: "gate", gate: SENTINEL_GATE }, captain("captain-1"))
    expect(out.refused).toContain("captain gate evidence")
    // The refusal must name the RECOVERY and say probe still works.
    expect(out.refused).toContain("mpd_role_spawn")
    expect(out.refused).toContain("Reviewer")
    expect(out.refused).toContain("probe")
    expect(out.refused).toContain("verify.evidenceBy")
    // NOTHING HAPPENED: no result, no ledger row, not even an evidence directory, and the declared gate's
    // own argv never ran (the sentinel is absent, which proves the refusal preceded the spawn).
    expect(out.evidenceId).toBeUndefined()
    expect(out.exit).toBeUndefined()
    expect(readEvidence(workspace)).toEqual([])
    expect(existsSync(evidenceDir(workspace))).toBe(false)
    expect(existsSync(join(workspace, "spawned.txt"))).toBe(false)
    cleanup(workspace)
  })

  test("the SAME captain's kind:\"probe\" is allowed and writes probe evidence", () => {
    /** The sandbox the captain probes. */
    const workspace = sandbox()
    writeFileSync(join(workspace, "artifact.bin"), "hello", "utf8")
    /** The allowed probe. */
    const out = callTool(toolFor(lawTools(workspace), "mpd_verify_evidence"), { kind: "probe", paths: ["artifact.bin"] }, captain("captain-1"))
    expect(out.refused).toBeUndefined()
    expect(out.probe?.length).toBe(1)
    expect(out.probe?.[0]?.path).toBe("artifact.bin")
    expect(out.probe?.[0]?.bytes).toBe(5)
    expect(out.probe?.[0]?.sha256).toMatch(/^[0-9a-f]{64}$/)
    // The probe DID write its evidence row — the rule refuses gate runs, not the captain's every call.
    /** The evidence rows on disk. */
    const rows = readEvidence(workspace)
    expect(rows.length).toBe(1)
    expect(rows[0]?.kind).toBe("probe")
    cleanup(workspace)
  })

  test("a CHILD's gate evidence is allowed and really runs the gate", () => {
    /** The sandbox the child calls against. */
    const workspace = sandbox()
    withSentinelGate(workspace)
    /** The allowed gate run. */
    const out = callTool(toolFor(lawTools(workspace), "mpd_verify_evidence"), { kind: "gate", gate: SENTINEL_GATE }, child("child-1"))
    expect(out.refused).toBeUndefined()
    expect(out.exit).toBe(0)
    expect(out.evidenceId).toBeString()
    expect(existsSync(join(workspace, "spawned.txt"))).toBe(true)
    expect(readEvidence(workspace).map((row) => row.kind)).toEqual(["gate"])
    cleanup(workspace)
  })

  test("mode \"any\" restores the captain's gate evidence", () => {
    /** The sandbox the captain calls against. */
    const workspace = sandbox()
    withSentinelGate(workspace)
    /** The opt-out configuration. */
    const tools = lawTools(workspace, { "verify.evidenceBy": "any" })
    /** The allowed gate run. */
    const out = callTool(toolFor(tools, "mpd_verify_evidence"), { kind: "gate", gate: SENTINEL_GATE }, captain("captain-1"))
    expect(out.refused).toBeUndefined()
    expect(out.exit).toBe(0)
    expect(existsSync(join(workspace, "spawned.txt"))).toBe(true)
    expect(readEvidence(workspace).map((row) => row.kind)).toEqual(["gate"])
    cleanup(workspace)
  })

  test("a missing or unknown session header is treated as NON-captain", () => {
    /** The sandbox the headerless caller uses. */
    const workspace = sandbox()
    withSentinelGate(workspace)
    /** The law tools with the DEFAULT mode (absent config). */
    const tool = toolFor(lawTools(workspace), "mpd_verify_evidence")
    /** A headerless caller. */
    const headerless = callTool(tool, { kind: "gate", gate: SENTINEL_GATE }, { session: { id: "headerless" } })
    expect(headerless.refused).toBeUndefined()
    expect(headerless.exit).toBe(0)
    /** A bare handle with no `session` key at all — the other unreadable shape. */
    const bare = callTool(tool, { kind: "gate", gate: SENTINEL_GATE }, {})
    expect(bare.refused).toBeUndefined()
    expect(bare.exit).toBe(0)
    // And a top-level session on ANOTHER preset passes: the rule is scoped to the `mpd` captain.
    /** A top-level `cordis` session. */
    const otherPreset = callTool(tool, { kind: "gate", gate: SENTINEL_GATE }, agent("cordis-top", { agentPreset: "cordis" }))
    expect(otherPreset.refused).toBeUndefined()
    expect(otherPreset.exit).toBe(0)
    expect(readEvidence(workspace).length).toBe(3)
    cleanup(workspace)
  })

  test("the `any` opt-out is case-insensitive and whitespace-trimmed; anything else fails CLOSED on verifier", () => {
    expect(resolveEvidenceBy(undefined)).toBe("verifier")
    expect(resolveEvidenceBy("verifier")).toBe("verifier")
    expect(resolveEvidenceBy("yes")).toBe("verifier")
    expect(resolveEvidenceBy("")).toBe("verifier")
    expect(resolveEvidenceBy("ANY")).toBe("any")
    expect(resolveEvidenceBy(" any ")).toBe("any")
    /** The sandbox the captain calls against with a misspelled opt-out. */
    const workspace = sandbox()
    withSentinelGate(workspace)
    /** The refusal that a misspelled value leaves in force. */
    const out = callTool(toolFor(lawTools(workspace, { "verify.evidenceBy": "yes" }), "mpd_verify_evidence"), { kind: "gate", gate: SENTINEL_GATE }, captain("captain-1"))
    expect(out.refused).toContain("captain gate evidence")
    expect(existsSync(join(workspace, "spawned.txt"))).toBe(false)
    expect(readEvidence(workspace)).toEqual([])
    cleanup(workspace)
  })
})

describe("the mpd-verify boot line (A4 token)", () => {
  test("prints evidenceBy=<mode> for the row config in force", () => {
    /** The sandbox the row boots against under the default rule. */
    const verifierWorkspace = sandbox()
    /** The default boot lines. */
    const verifierLines = boot(verifierWorkspace, { mode: "hard", escapeUses: 1, evidenceBy: "verifier" })
    expect(verifierLines.some((line) => line.includes("evidenceBy=verifier"))).toBe(true)
    cleanup(verifierWorkspace)
    /** A second sandbox, so the log sink's root changes and the second line is really the second boot. */
    const anyWorkspace = sandbox()
    /** The opt-out boot lines. */
    const anyLines = boot(anyWorkspace, { mode: "hard", escapeUses: 1, evidenceBy: "any" })
    expect(anyLines.some((line) => line.includes("evidenceBy=any"))).toBe(true)
    cleanup(anyWorkspace)
  })
})
