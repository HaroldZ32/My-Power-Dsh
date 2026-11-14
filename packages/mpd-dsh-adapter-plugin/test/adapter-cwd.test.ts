// Lane B of `.mpd/plans/agent-worktrees.md`: a spawn spec's `cwd` becomes the child's EFFECTIVE
// working directory — forwarded as `request.cwd` ONLY when the caller supplied one, so an absent path
// keeps the host's inherit-the-parent default. The official team backend has no cwd channel (D7), so it
// reports the drop in ONE line and raises the member in the shared checkout, never a throw.
import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createDshAdapter, type DshTeamExecutor } from "../src/index.ts"

/** One recorded call on a seam double: the method name and its forwarded arguments. */
interface Call {
  /** The method that was called. */
  seam: string
  /** The forwarded arguments. */
  args: unknown[]
}

/** The doubles one arm drives, plus the executor the adapter hands back. */
interface Harness {
  /** The adapter under test, for the one-shot spawn arms. */
  dsh: ReturnType<typeof createDshAdapter>
  /** The executor under test. */
  executor: DshTeamExecutor
  /** Every call a double recorded, in order. */
  calls: Call[]
  /** The Lead agent every team call is made as. */
  lead: { session: { id: string } }
}

/** What a double should answer, so an arm can choose the active team backend. */
interface DoubleOptions {
  /** Whether the subagents service exposes the modern `startActivation` seam. */
  activation?: boolean
  /** Whether the subagents service exposes the RETIRED `start` seam. */
  retired?: boolean
  /** Whether `ctx.agentTeams` is mounted, i.e. whether the official fallback can serve. */
  official?: boolean
}

/**
 * Build the harness: a real adapter over recording doubles.
 * @param options - which seams exist; the default is a modern host with both team backends.
 * @returns the harness an arm drives.
 */
function harness(options: DoubleOptions = {}): Harness {
  /** Every call the doubles observed. */
  const calls: Call[] = []
  /** Record one call on the seam under test. */
  const record = (seam: string, args: unknown[]): void => { calls.push({ seam, args }) }
  /** The subagents double: one-shot starts, the dummy activation report, and provider listing. */
  const subagents: Record<string, unknown> = {
    providers: () => ["spawn"],
    /** The modern one-shot arm: records its activation spec and settles immediately. */
    startActivation(spec: unknown): Promise<unknown> {
      record("startActivation", [spec])
      return Promise.resolve({ childId: "child-1", result: Promise.resolve({ output: "done", stopReason: "completed" }) })
    },
    /** The retired arm: records its `(provider, request)` pair and settles immediately. */
    start(provider: unknown, request: unknown): Promise<unknown> {
      record("start", [provider, request])
      return Promise.resolve({ id: "child-retired", result: Promise.resolve({ output: "done", stopReason: "completed" }) })
    },
    /** The durable-team arm, which is what makes the native executor available. */
    startContinuable(spec: unknown): Promise<unknown> {
      record("startContinuable", [spec])
      return Promise.resolve({ childId: "child-1" })
    },
  }
  if (options.activation === false) { delete subagents.startActivation; delete subagents.startContinuable }
  if (options.retired === false) delete subagents.start
  /** The official Agent Teams double: the raise and the delivery the executor uses. */
  const agentTeams: Record<string, unknown> = {
    /** Record the official raise, answering with a handle in the host's own vocabulary. */
    spawnTeammate(caller: unknown, request: unknown): Promise<unknown> {
      record("spawnTeammate", [caller, request])
      return Promise.resolve({ id: "sess-official-1" })
    },
    /** Record the official delivery, which no cwd arm exercises. */
    sendMessage(caller: unknown, request: unknown): Promise<unknown> {
      record("sendMessage", [caller, request])
      return Promise.resolve({ messageId: "m1", status: "delivered" })
    },
    /** Record the official interrupt, which no cwd arm exercises. */
    interrupt(caller: unknown, target: unknown): Promise<unknown> {
      record("interrupt", [caller, target])
      return Promise.resolve({ previousStatus: "running" })
    },
    /** Record the official wait; present because the executor quartet (D6) makes the service servable. */
    waitForChange(caller: unknown, timeoutMs: unknown, signal: unknown): Promise<unknown> {
      record("waitForChange", [caller, timeoutMs, signal])
      return Promise.resolve({ timedOut: true })
    },
  }
  /** The service lookup the adapter uses, over exactly the doubles this arm staged. */
  const ctx = {
    get: (name: string): unknown => {
      if (name === "subagents") return subagents
      if (name === "agentTeams") return options.official === false ? undefined : agentTeams
      return undefined
    },
  }
  /** The adapter under test. */
  const dsh = createDshAdapter(ctx as never)
  return { dsh, executor: dsh.teamExecutor(), calls, lead: { session: { id: "session-lead" } } }
}

/** The member request every team spawn arm uses; a caller route keeps routing silent. */
const REQUEST = {
  teamId: "team-1",
  memberId: "M1",
  name: "researcher",
  description: "the researcher",
  prompt: "You research.",
  agentOptions: { provider: "deepseek-official", model: "deepseek-v4-flash" },
} as const

/** A fresh workspace root for ONE arm's row log, so the arm starts with no recorded line. */
function freshLogRoot(): string {
  return mkdtempSync(join(tmpdir(), "mpd-adapter-cwd-"))
}

/**
 * The adapter row's log lines under one workspace root.
 * @param root - the workspace root the row logger resolves.
 * @returns the non-empty lines, `[]` when nothing was written.
 */
function logLinesOf(root: string): string[] {
  /** The sink's documented path: `<root>/.mpd/logs/<name>.log`. */
  const file = join(root, ".mpd", "logs", "mpd-dsh-adapter.log")
  if (!existsSync(file)) return []
  return readFileSync(file, "utf8").split("\n").filter((line) => line !== "")
}

/** Restore the env after every arm, so a workspace root cannot leak into the next one. */
afterEach(() => { delete process.env.DSH_WORKSPACE_ROOT })

describe("the one-shot spawn (spawnAgentAsync)", () => {
  test("a supplied cwd is forwarded as the activation request's cwd", async () => {
    /** The harness whose modern start arm records its spec. */
    const h = harness()
    await h.dsh.spawnAgentAsync({ label: "look", prompt: "go", parent: {}, cwd: "/ws/.mpd/worktrees/t1/m1" })
    /** The activation spec the double received. */
    const spec = h.calls[0].args[0] as { request: Record<string, unknown> }
    expect(spec.request.cwd).toBe("/ws/.mpd/worktrees/t1/m1")
  })

  test("an absent cwd stays ABSENT — the key is never written as undefined", async () => {
    /** The harness whose modern start arm records its spec. */
    const h = harness()
    await h.dsh.spawnAgentAsync({ label: "look", prompt: "go", parent: {} })
    /** The activation spec the double received. */
    const spec = h.calls[0].args[0] as { request: Record<string, unknown> }
    // Absence is the contract: the host inherits the parent's directory, and a written
    // `cwd: undefined` would be indistinguishable from a caller-supplied value to some serializers.
    expect("cwd" in spec.request).toBe(false)
    expect(Object.hasOwn(spec.request, "cwd")).toBe(false)
  })

  test("the RETIRED start arm forwards the same cwd, and omits it when absent", async () => {
    /** The recorded calls of the retired arm. */
    const calls: Call[] = []
    /** The adapter over a service exposing only the retired seam. */
    const dsh = createDshAdapter({ get: (name: string) => (name === "subagents" ? { providers: () => [], start: async (_provider: unknown, request: unknown) => { calls.push({ seam: "start", args: [request] }); return { id: "c", result: Promise.resolve({}) } } } : undefined) } as never)
    await dsh.spawnAgentAsync({ label: "with", prompt: "go", parent: {}, cwd: "/ws/wt" })
    await dsh.spawnAgentAsync({ label: "without", prompt: "go", parent: {} })
    /** The first request, which carried a path. */
    const withCwd = calls[0].args[0] as Record<string, unknown>
    /** The second request, which carried none. */
    const withoutCwd = calls[1].args[0] as Record<string, unknown>
    expect(withCwd.cwd).toBe("/ws/wt")
    expect("cwd" in withoutCwd).toBe(false)
  })

  test("startContinuableAgent forwards the caller's request.cwd VERBATIM (the reseed path)", async () => {
    /** The specs the durable-start double received. */
    const specs: unknown[] = []
    /** The adapter over a service exposing the modern durable seam. */
    const dsh = createDshAdapter({ get: (name: string) => (name === "subagents" ? { startActivation: async (spec: unknown) => { specs.push(spec); return { childId: "c" } } } : undefined) } as never)
    /** The spec a cellwork reseed builds, carrying its member's worktree inside `request`. */
    const spec = { provider: "spawn", label: "m1 · team-1", request: { prompt: [], parent: {}, maxDepth: 2, cwd: "/ws/.mpd/worktrees/t1/m1" }, signal: new AbortController().signal }
    await dsh.startContinuableAgent(spec)
    expect((specs[0] as { request: { cwd?: string } }).request.cwd).toBe("/ws/.mpd/worktrees/t1/m1")
    // The adapter added only its delivery policy; the caller's cwd is untouched.
    expect((specs[0] as { delivery?: string }).delivery).toBe("parent")
  })
})

describe("the native team backend", () => {
  test("a supplied cwd reaches the member's start request", async () => {
    /** The harness whose native backend records the activation spec. */
    const h = harness()
    await h.executor.spawn(h.lead, { ...REQUEST, cwd: "/ws/.mpd/worktrees/team-1/M1" })
    /** The activation request the manager received. */
    const request = (h.calls[0].args[0] as { request: Record<string, unknown> }).request
    expect(request.cwd).toBe("/ws/.mpd/worktrees/team-1/M1")
  })

  test("an absent cwd stays ABSENT, never `undefined`", async () => {
    /** The harness under test. */
    const h = harness()
    await h.executor.spawn(h.lead, { ...REQUEST })
    /** The activation request the manager received. */
    const request = (h.calls[0].args[0] as { request: Record<string, unknown> }).request
    expect("cwd" in request).toBe(false)
    expect(Object.hasOwn(request, "cwd")).toBe(false)
  })
})

describe("the official fallback (D7)", () => {
  test("a supplied cwd is DROPPED with ONE log line, and the spawn still succeeds", async () => {
    /** The fresh root this arm's row log is read from. */
    const root = freshLogRoot()
    process.env.DSH_WORKSPACE_ROOT = root
    /** The harness whose native seams are absent, forcing the official backend. */
    const h = harness({ activation: false, retired: false })
    expect(h.executor.kind).toBe("official")
    /** The raise, which must complete rather than throw on the unforwardable field. */
    const result = await h.executor.spawn(h.lead, { ...REQUEST, cwd: "/ws/.mpd/worktrees/team-1/M1" })
    expect(result).toEqual({ handle: "sess-official-1", executor: "official" })
    /** The official spawn request the service received. */
    const request = h.calls.find((call) => call.seam === "spawnTeammate")?.args[1] as Record<string, unknown>
    // The official service has no per-call cwd channel: the path must not leak into its vocabulary.
    expect("cwd" in request).toBe(false)
    /** Every line this spawn wrote to the adapter row log. */
    const lines = logLinesOf(root)
    expect(lines.length).toBe(1)
    expect(lines[0]).toContain("cannot set cwd")
    expect(lines[0]).toContain("shared checkout")
  })

  test("an ABSENT cwd writes no line at all", async () => {
    /** The fresh root this arm's row log is read from. */
    const root = freshLogRoot()
    process.env.DSH_WORKSPACE_ROOT = root
    /** The harness forced onto the official backend with no worktree path. */
    const h = harness({ activation: false, retired: false })
    /** The raise, which has nothing to drop. */
    const result = await h.executor.spawn(h.lead, { ...REQUEST })
    expect(result.executor).toBe("official")
    expect(logLinesOf(root)).toEqual([])
  })
})
