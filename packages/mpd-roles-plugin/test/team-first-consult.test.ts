import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { DshToolDef, DshToolExec } from "../../mpd-dsh-adapter-plugin/src/index.ts"
import { apply as applyWorkmate } from "../../mpd-workmate-plugin/src/index.ts"
import { apply as applyRoles } from "../src/index.ts"

/** A known plan slot and tool availability, independent of the caller's Team config. */
interface TeamFixture {
  /** A prior plan, when the slot is already occupied. */
  readonly plan?: { planId: string; approved?: boolean }
  /** A mounted Team plane may still refuse an attempt to create a shell. */
  readonly refuseCreate?: boolean
  /** A partial composition cannot provide working owner-bound dispatch. */
  readonly missingDispatch?: boolean
}

/** The fake host holds every activation until the test releases it. */
function consultHost(workspace: string, settings: Readonly<Record<string, unknown>> = {}, team: TeamFixture = {}): {
  readonly calls: unknown[]
  readonly started: unknown[]
  readonly call: (name: string, args: Record<string, unknown>, exec?: DshToolExec) => Promise<unknown>
  readonly exec: DshToolExec
  readonly releaseChildren: () => void
  readonly bounded: <T>(dispatch: () => T) => T
} {
  /** Tool definitions from the actual roles and workmate plugin registrations. */
  const tools = new Map<string, DshToolDef>()
  /** MPD services captured from the same host context. */
  const services = new Map<string, unknown>()
  /** Every action that reached the registered Team surface. */
  const calls: unknown[] = []
  /** Every activation the real adapter requested. */
  const started: unknown[] = []
  /** The staged plan is visible to the gate as soon as its create call returns. */
  let plan: { planId: string; approved?: boolean } | null = team.plan ?? null
  /** Runner-controlled barrier holds child results beyond the async tool returns. */
  const children = Promise.withResolvers<void>()
  /** The synthetic direct caller has the same durable key as its team record would. */
  const exec: DshToolExec = { agent: { id: "captain", session: { id: "captain", header: { cwd: workspace, agentPreset: "mpd" } } }, signal: new AbortController().signal }
  /** Only the three Team tools can contribute the capability used by this test. */
  const teamTools = new Set(["agent_teams_plan", "agent_teams_task", "agent_teams_dispatch"])
  if (team.missingDispatch) teamTools.delete("agent_teams_dispatch")
  services.set("mpdConfig", {
    get: (key: string, root?: string): unknown => root === workspace ? settings[key] : undefined,
    agentRouteResolutionOf: (agent: string) => ({ ok: true, agent, route: { provider: "test", model: "test" } }),
  })
  services.set("mpdTeams", { planFor: () => ({ plan }) })
  /** The host provides the normal seams while keeping model calls offline. */
  const ctx = {
    tools: {
      get: (name: string) => tools.get(name) ?? (teamTools.has(name) ? { name } : undefined),
      register: (tool: DshToolDef) => { tools.set(tool.name, tool) },
      execute: async (input: { name: string; arguments: unknown }) => {
        if (input.name !== "agent_teams_plan") throw new Error(`Unexpected tool ${input.name}`)
        calls.push(input.arguments)
        if (team.refuseCreate) return { isError: true, error: { message: "plan store is read-only" } }
        plan = { planId: "plan-overlap" }
        return { isError: false, value: { plan } }
      },
    },
    subagents: {
      start: async (_kind: string, args: unknown) => {
        started.push(args)
        await children.promise
        return { result: { structured: { summary: "settled" }, stopReason: "complete" } }
      },
    },
    get: (name: string) => services.get(name),
    provide: (name: string, service: unknown) => { services.set(name, service) },
  }
  applyRoles(ctx)
  applyWorkmate(ctx)
  /** Public tool dispatch is the subject. The test never calls the admission helper. */
  const call = async (name: string, args: Record<string, unknown>, sender: DshToolExec = exec): Promise<unknown> => {
    /** A missing registration is a fixture failure. */
    const tool = tools.get(name)
    if (tool === undefined) throw new Error(`Missing tool ${name}`)
    return tool.execute(args, sender)
  }
  /** The optional engine-only service is separate from all public tool parameters. */
  const service = services.get("mpdConsults") as { runBounded: <T>(dispatch: () => T) => T }
  return { calls, started, call, exec, bounded: service.runBounded, releaseChildren: () => children.resolve() }
}

/** The overlapping batch uses both roster entry points and the durable workmate surface. */
test("the fourth overlapping public consult stages one required plan before dispatching a fourth child", async () => {
  /** Disposable library and workspace; no real profile or credentials are in use. */
  const workspace = mkdtempSync(join(tmpdir(), "mpd-team-first-consult-"))
  /** Restore the shared process environment even when the RED assertion fails. */
  const priorHome = process.env.HOME
  process.env.HOME = workspace
  /** Three running consultations should stay live while additional async requests are refused. */
  const host = consultHost(workspace)
  /** The one blocking call is drained during cleanup on both RED and GREEN. */
  let blocking: Promise<unknown> | undefined
  try {
    await host.call("mpd_workmate_init", { base: "Deep Worker", name: "worker" })
    await host.call("mpd_role_spawn_async", { role: "Deep Worker", task: "first lane" })
    await host.call("mpd_role_spawn_async", { role: "Deep Worker", task: "second lane" })
    blocking = host.call("mpd_workmate_spawn", { name: "worker", task: "third lane" })
    /** Wait for the third activation itself before asserting that the next two cannot launch. */
    for (let attempt = 0; attempt < 100 && host.started.length < 3; attempt += 1) await Bun.sleep(1)
    expect(host.started).toHaveLength(3)
    /** Both the extra concurrent calls must observe the same staged plan. */
    const overflow = await Promise.allSettled([4, 5].map((item) => host.call("mpd_role_spawn_async", { role: "Deep Worker", task: `lane ${item}` })))
    expect(overflow.map((result) => result.status === "rejected" ? String(result.reason) : result.status)).toEqual([
      expect.stringContaining("TEAM_FIRST"),
      expect.stringContaining("plan-overlap"),
    ])
    expect(host.started).toHaveLength(3)
    expect(host.calls).toEqual([expect.objectContaining({ action: "create", approval: "required" })])
    await expect(host.call("mpd_role_spawn", { role: "Deep Worker", task: "excess blocking role" })).rejects.toThrow(/TEAM_FIRST/)
    host.releaseChildren()
    await blocking
    expect(await host.call("mpd_role_spawn", { role: "Deep Worker", task: "bounded retry" })).toMatchObject({ summary: "settled" })
  } finally {
    host.releaseChildren()
    await blocking
    if (priorHome === undefined) delete process.env.HOME
    else process.env.HOME = priorHome
    rmSync(workspace, { recursive: true, force: true })
  }
})

/** Room for one bounded call survives an operator trigger or supervisor limit of one. */
test("live limits share role and workmate reservations while the internal engine scope stays isolated", async () => {
  /** Both the workmate library and team record stay inside this test root. */
  const workspace = mkdtempSync(join(tmpdir(), "mpd-team-first-limit-"))
  /** The tests restore the previous process environment, even on a failed assertion. */
  const priorHome = process.env.HOME
  /** The non-default value the existing supervisor actually sees. */
  const priorLimit = process.env.MPD_DSH_CONSULT_MAX
  process.env.HOME = workspace
  process.env.MPD_DSH_CONSULT_MAX = "2"
  /** The host uses the smaller supervisor capacity even when the volume setting is larger. */
  const host = consultHost(workspace, { "team.reteam.afterConsults": 7 }, { plan: { planId: "plan-earlier" } })
  /** A pending internal call is always drained, even when a public call fails unexpectedly. */
  let managed: Promise<unknown> | undefined
  try {
    await host.call("mpd_workmate_init", { base: "Deep Worker", name: "worker" })
    await host.call("mpd_role_spawn_async", { role: "Deep Worker", task: "one public consult" })
    managed = host.bounded(() => host.call("mpd_role_spawn", { role: "Deep Worker", task: "internal slot" }))
    for (let attempt = 0; attempt < 100 && host.started.length < 2; attempt += 1) await Bun.sleep(1)
    expect(host.started).toHaveLength(2)
    await expect(host.call("mpd_workmate_spawn", { name: "worker", task: "concurrent public request" })).rejects.toThrow(/check it matches the current request/)
    expect(host.calls).toEqual([])
    expect(host.started).toHaveLength(2)
    host.releaseChildren()
    await expect(managed).resolves.toMatchObject({ summary: "settled" })
  } finally {
    host.releaseChildren()
    await managed
    if (priorHome === undefined) delete process.env.HOME
    else process.env.HOME = priorHome
    if (priorLimit === undefined) delete process.env.MPD_DSH_CONSULT_MAX
    else process.env.MPD_DSH_CONSULT_MAX = priorLimit
    rmSync(workspace, { recursive: true, force: true })
  }
})

/** Each independent case uses the public async role entry point with the threshold floored at two. */
const BYPASS_CASES = [
  { name: "mode off", settings: { "team.gate": "off" } },
  { name: "mode advisory", settings: { "team.gate": "advisory" } },
  { name: "volume disabled", settings: { "team.reteam.enabled": false } },
  { name: "missing dispatch", team: { missingDispatch: true } },
  { name: "active team" },
  { name: "member caller", depth: 1 },
  { name: "non-MPD composition", preset: "cordis" },
] as const

test.each([...BYPASS_CASES])("an overlapping batch bypasses Team admission for $name", async (control) => {
  /** A case that needs a live team writes only under its disposable workspace. */
  const workspace = mkdtempSync(join(tmpdir(), "mpd-team-first-bypass-"))
  if (control.name === "active team") {
    /** One active record led by this caller, following the real disk projection. */
    const teams = join(workspace, ".mpd", "team", "teams")
    mkdirSync(teams, { recursive: true })
    writeFileSync(join(teams, "team-working.json"), JSON.stringify({ teamId: "team-working", leadSessionId: "captain", members: [{ id: "worker" }], tasks: [{ status: "in_progress" }] }))
  }
  /** Non-default threshold one must still allow the first request. */
  const host = consultHost(workspace, { "team.reteam.afterConsults": 1, ...("settings" in control ? control.settings : {}) }, "team" in control ? control.team : {})
  /** Same session and workspace identity, with the case-specific preset or delegation rank. */
  const exec: DshToolExec = {
    agent: { id: "captain", session: { id: "captain", header: { cwd: workspace, agentPreset: "preset" in control ? control.preset : "mpd", delegationDepth: "depth" in control ? control.depth : 0 } } },
    signal: new AbortController().signal,
  }
  try {
    await Promise.all([1, 2].map((lane) => host.call("mpd_role_spawn_async", { role: "Deep Worker", task: `lane ${lane}` }, exec)))
    await Bun.sleep(1)
    expect(host.started).toHaveLength(2)
    expect(host.calls).toEqual([])
  } finally {
    host.releaseChildren()
    rmSync(workspace, { recursive: true, force: true })
  }
})

test.each([false, true])("a failed stage or a previously approved plan leaves a bounded retry available (approved=%s)", async (approved) => {
  /** A previous approved slot is distinct from a live team. A failed stage brings no plan id. */
  const workspace = mkdtempSync(join(tmpdir(), "mpd-team-first-recovery-"))
  /** Its first public call always gets a slot, even at the configured floor. */
  const host = consultHost(workspace, { "team.reteam.afterConsults": 1 }, approved ? { plan: { planId: "earlier-approved", approved: true } } : { refuseCreate: true })
  try {
    /** The launch result is immediate but the child remains held by the fixture. */
    const started = await host.call("mpd_role_spawn_async", { role: "Deep Worker", task: "only active call" }) as { consultId: string }
    /** Two overlapping requests receive one truthful recovery decision. */
    const overflow = await Promise.allSettled([2, 3].map((lane) => host.call("mpd_role_spawn_async", { role: "Deep Worker", task: `lane ${lane}` })))
    for (const result of overflow) {
      if (result.status !== "rejected" || !(result.reason instanceof Error)) throw new Error("Expected the public admission refusal")
      expect(result.reason).toHaveProperty("code", "TEAM_FIRST")
      expect(result.reason.message).toContain("No usable plan was confirmed")
      expect(result.reason.message).not.toContain("earlier-approved")
    }
    expect(host.calls).toHaveLength(approved ? 0 : 1)
    expect(host.started).toHaveLength(1)
    host.releaseChildren()
    await host.call("mpd_role_consult", { action: "wait", consultId: started.consultId })
    expect(await host.call("mpd_role_spawn", { role: "Deep Worker", task: "retry in the freed slot" })).toMatchObject({ summary: "settled" })
  } finally {
    host.releaseChildren()
    rmSync(workspace, { recursive: true, force: true })
  }
})
