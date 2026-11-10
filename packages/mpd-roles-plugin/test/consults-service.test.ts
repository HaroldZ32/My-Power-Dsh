// THE `mpdConsults` SERVICE (cellwork async delegation, contract §3.1).
//
// WHAT THESE ARMS PROVE. The service is a SECOND VIEW of the ONE supervisor, not a second registry:
// a start through the service is visible to `mpd_role_consult`'s `list`, the shared concurrency cap still
// queues, and `settle`/`collect` keep the supervisor's own release semantics. Two arms are about the ONE
// behavioural difference the contract allows: the service path does NOT apply `consultDepthRefusal` (the
// cell plane owns its own cap), while the tools still do.
import { describe, expect, test } from "bun:test"
import { apply } from "../src/index.ts"
import { createMpConsults } from "../src/consults.ts"
import { createConsultSupervisor, type ConsultSupervisor } from "../src/spawn-async.ts"

/** One externally-settled promise, standing in for a child's `result`. */
function deferred(): { promise: Promise<any>; resolve: (value: any) => void } {
  /** The resolver captured by the executor. */
  let resolve: (value: any) => void = (): void => undefined
  /** The promise itself. */
  const promise = new Promise<any>((res) => { resolve = res })
  return { promise, resolve }
}

/** Let queued microtasks and one timer tick run. */
function tick(ms: number = 5): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** The normalized child report a fake handle resolves with. */
const CHILD_REPORT = { output: "done", structured: { summary: "the answer", recommendation: "ship it", details: "d", evidence: ["e1"] }, stopReason: "completed" }

/** A canonicaliser that behaves like the roster's: spaces/hyphens/case collapse to the ONE name. */
function canonical(role: string): string | null {
  /** The collapsed key of the requested spelling. */
  const key = role.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
  for (const name of ["Deep Worker", "Reviewer", "Explorer"]) {
    if (name.toLowerCase().replace(/[^a-z0-9]+/g, "-") === key) return name
  }
  return null
}

/** One composed service plus the supervisor and the raise log behind it. */
interface Composed {
  /** The service under test. */
  service: ReturnType<typeof createMpConsults>
  /** The ONE supervisor the service reads and writes. */
  supervisor: ConsultSupervisor
  /** Every role the raise seam was asked to start, in order. */
  raised: string[]
}

/**
 * Compose the service over a REAL supervisor and a fake raise.
 *
 * @param options - `maxConcurrent` sets the shared cap; `failFirst` makes the first raise reject.
 * @returns the composed service, its supervisor and the raise log.
 */
function compose(options: { maxConcurrent?: number; failFirst?: boolean } = {}): Composed {
  /** The roles the raise seam started. */
  const raised: string[] = []
  /** The supervisor under test. */
  const supervisor = createConsultSupervisor({ handoffDir: () => "/tmp/mpd-handoff", log: () => undefined, activityOf: () => undefined, ...(options.maxConcurrent === undefined ? {} : { maxConcurrent: () => options.maxConcurrent as number }) })
  /** The service under test. */
  const service = createMpConsults({
    supervisor,
    raise: async (spec) => {
      raised.push(spec.role)
      if (options.failFirst === true && raised.length === 1) throw new Error("the injected raise failure")
      /** This child's settlement, which the test resolves. */
      const settled = deferred()
      setTimeout(() => settled.resolve(CHILD_REPORT), 1)
      return { id: "child-" + String(raised.length), result: settled.promise, interrupt: (): void => undefined }
    },
    canonicalRole: (role) => canonical(role),
  })
  return { service, supervisor, raised }
}

describe("mpdConsults service (§3.1)", () => {
  test("start answers a running id at once and echoes the CANONICAL role", async () => {
    /** The composed service. */
    const { service, raised } = compose()
    /** The start's answer. */
    const started = await service.start({ role: "deep-worker", task: "probe the tree", exec: {} })
    expect(started.state).toBe("running")
    expect(started.role).toBe("Deep Worker")
    expect(started.consultId).toBeTruthy()
    // NOT awaited: the call answered before the child settled (the raise runs behind the record).
    expect(raised).toEqual(["Deep Worker"])
    expect(service.list().length).toBe(1)
    expect(service.list()[0].role).toBe("Deep Worker")
  })

  test("settle awaits settlement without releasing; collect returns the report and RELEASES", async () => {
    /** The composed service. */
    const { service } = compose()
    /** The started consult. */
    const started = await service.start({ role: "Reviewer", task: "review", exec: {} })
    /** The settled view. */
    const settled = await service.settle(started.consultId)
    expect(settled.state).toBe("complete")
    // `settle` released nothing: the record is still listable and still collectable.
    expect(service.list().length).toBe(1)
    /** The released outcome. */
    const collected = service.collect(started.consultId)
    expect(collected?.report?.summary).toBe("the answer")
    expect(collected?.report?.role).toBe("Reviewer")
    // RELEASED: a second collect — and the list — no longer know it.
    expect(service.collect(started.consultId)).toBeUndefined()
    expect(service.list().length).toBe(0)
  })

  test("wait answers the RUNNING view when its bound wins, never a throw", async () => {
    /** A supervisor whose consults never settle inside the test's bound. */
    const supervisor = createConsultSupervisor({ handoffDir: () => "/tmp/mpd-handoff", log: () => undefined, activityOf: () => undefined })
    /** The service over a never-settling raise. */
    const service = createMpConsults({ supervisor, raise: async () => ({ id: "child-slow", result: new Promise<any>(() => undefined), interrupt: (): void => undefined }), canonicalRole: canonical })
    /** The started consult. */
    const started = await service.start({ role: "Explorer", task: "slow" , exec: {} })
    /** The bounded wait. */
    const waited = await service.wait(started.consultId, 5)
    expect(waited.state).toBe("running")
    expect(waited.consultId).toBe(started.consultId)
  })

  test("the shared cap QUEUES an over-cap start instead of refusing it", async () => {
    /** Every role the raise seam started. */
    const raised: string[] = []
    /** Each child's settlement, in raise order. */
    const settlers: Array<{ resolve: (value: any) => void }> = []
    /** A supervisor with a cap of ONE. */
    const supervisor = createConsultSupervisor({ handoffDir: () => "/tmp/mpd-handoff", log: () => undefined, activityOf: () => undefined, maxConcurrent: () => 1 })
    /** The service over a raise whose children settle only when the test says so. */
    const service = createMpConsults({
      supervisor,
      raise: async (spec) => {
        raised.push(spec.role)
        /** This child's settlement. */
        const settled = deferred()
        settlers.push(settled)
        return { id: "child-" + String(raised.length), result: settled.promise, interrupt: (): void => undefined }
      },
      canonicalRole: canonical,
    })
    /** The first consult, which takes the only slot. */
    const first = await service.start({ role: "Reviewer", task: "one", exec: {} })
    /** The second consult, which must QUEUE and still answer an id. */
    const second = await service.start({ role: "Explorer", task: "two", exec: {} })
    expect(second.consultId).not.toBe(first.consultId)
    await tick()
    // Only ONE child is raised while the first holds the slot; the second is recorded, not refused.
    expect(raised.length).toBe(1)
    expect(service.list().map((entry) => entry.state)).toEqual(["running", "running"])
    // Releasing the slot raises the QUEUED child instead of failing the call.
    settlers[0].resolve(CHILD_REPORT)
    await service.settle(first.consultId)
    await tick()
    expect(raised.length).toBe(2)
    settlers[1].resolve(CHILD_REPORT)
    expect((await service.settle(second.consultId)).state).toBe("complete")
  })

  test("a FAILED raise settles as `failed` through settle (no throw) and cancels to interrupted", async () => {
    /** A service whose first raise rejects. */
    const { service } = compose({ failFirst: true })
    /** The started consult, whose child never raised. */
    const started = await service.start({ role: "Reviewer", task: "boom", exec: {} })
    /** The settled view of the failure. */
    const settled = await service.settle(started.consultId)
    expect(settled.state).toBe("failed")
    /** The released outcome, which carries the failure text. */
    const collected = service.collect(started.consultId)
    expect(collected?.error).toContain("injected raise failure")
    // A second consult cancels to `interrupted`.
    /** A second, healthy consult. */
    const second = await service.start({ role: "Explorer", task: "cancel me", exec: {} })
    expect(service.cancel(second.consultId).state).toBe("interrupted")
  })

  test("an unknown role and an empty task are REFUSED before any child is raised", async () => {
    /** The composed service. */
    const { service, raised } = compose()
    await expect(service.start({ role: "no such agent", task: "x", exec: {} })).rejects.toThrow(/unknown role/)
    await expect(service.start({ role: "Reviewer", task: "   ", exec: {} })).rejects.toThrow(/task required/)
    expect(raised).toEqual([])
    expect(service.list()).toEqual([])
  })

  test("an id this process does not know is `undefined` from collect and a throw from cancel", async () => {
    /** The composed service. */
    const { service } = compose()
    expect(service.collect("nope")).toBeUndefined()
    expect(() => service.cancel("nope")).toThrow(/unknown consult/i)
  })
})

/** One recording cordis ctx, the smallest shape `apply` accepts. */
interface PluginHarness {
  /** The tool definitions the row registered, by name. */
  tools: Map<string, any>
  /** The services `ctx.provide` published. */
  provided: Record<string, any>
  /** The children the fake subagent seam was asked to raise. */
  spawned: any[]
}

/**
 * Apply the roles row to a recording ctx.
 *
 * @returns the harness's captured surfaces.
 */
function makePlugin(): PluginHarness {
  /** Captured tools, by name. */
  const tools = new Map<string, any>()
  /** Captured services. */
  const provided: Record<string, any> = {}
  /** The children the spawn seam saw. */
  const spawned: any[] = []
  /** The config double: a usable route for the base roster, nothing else. */
  const configDouble = { agentRouteResolutionOf: (member: string) => ({ ok: true, agent: member, route: { provider: "deepseek-official", model: "deepseek-flash" } }) }
  /** The permissive ctx. */
  const ctx: any = {
    tools: { register: (definition: any): void => { tools.set(String(definition.name), definition) } },
    skills: { registerProvider: (): void => undefined },
    subagents: {
      start: async (_kind: string, options: any) => {
        spawned.push(options)
        return { result: { structured: { role: "x", summary: "done" }, stopReason: "complete" } }
      },
    },
    provide: (name: string, value: any): void => { provided[name] = value },
    get: (name: string) => (name === "mpdConfig" ? configDouble : undefined),
  }
  apply(ctx, {})
  return { tools, provided, spawned }
}

describe("the row provides `mpdConsults` over its ONE supervisor", () => {
  test("the service is provided with its SEVEN methods and is NOT a tool", () => {
    /** The applied row. */
    const harness = makePlugin()
    /** The provided service. */
    const service = harness.provided.mpdConsults
    expect(service).toBeDefined()
    for (const method of ["canonicalRole", "start", "list", "wait", "settle", "collect", "cancel"]) expect(typeof service[method]).toBe("function")
    // It is a SERVICE: no tool carries its name, and no tool output advertises it.
    expect([...harness.tools.keys()].sort()).toEqual(["mpd_role_consult", "mpd_role_persona", "mpd_role_spawn", "mpd_role_spawn_async", "mpd_roles_list"])
    expect([...harness.tools.keys()]).not.toContain("mpdConsults")
  })

  test("R1.3: `canonicalRole` is the ROSTER's own resolver — four Deep Worker spellings, one name; unknown is undefined", () => {
    /** The applied row: the REAL resolver, not a double. */
    const harness = makePlugin()
    /** The caller's dispatch. */
    const exec = { agent: { id: "agent-1" } }
    // `DeepWorker` is the measured disagreement: the roster accepts it, the removed cellwork-local pass did not.
    for (const spelling of ["Deep Worker", "deep worker", "deep-worker", "DeepWorker"]) {
      expect(harness.provided.mpdConsults.canonicalRole(spelling, exec)).toBe("Deep Worker")
    }
    // The FROZEN one-argument form works too: a base-roster spelling resolves without an `exec`.
    expect(harness.provided.mpdConsults.canonicalRole("DeepWorker")).toBe("Deep Worker")
    expect(harness.provided.mpdConsults.canonicalRole("no such agent", exec)).toBeUndefined()
    expect(harness.provided.mpdConsults.canonicalRole("", exec)).toBeUndefined()
  })

  test("R1.3: an unknown role is refused by BOTH the tool and the service; a known spelling resolves to the SAME name", async () => {
    /** The applied row. */
    const harness = makePlugin()
    /** The caller's dispatch. */
    const exec = { agent: { id: "agent-1" }, signal: new AbortController().signal }
    await expect(harness.tools.get("mpd_role_spawn").execute({ role: "no such agent", task: "x" }, exec)).rejects.toThrow(/unknown role/)
    await expect(harness.provided.mpdConsults.start({ role: "no such agent", task: "x", exec })).rejects.toThrow(/unknown role/)
    expect(harness.provided.mpdConsults.canonicalRole("DeepWorker", exec)).toBe("Deep Worker")
    expect(harness.spawned).toEqual([])
  })

  test("ONE registry: a service start is visible to `mpd_role_consult {action:\"list\"}`, and collect releases it", async () => {
    /** The applied row. */
    const harness = makePlugin()
    /** The caller's dispatch, as the tool executor passes it. */
    const exec = { agent: { id: "agent-1" }, signal: new AbortController().signal }
    /** The start through the SERVICE. */
    const started = await harness.provided.mpdConsults.start({ role: "deep worker", task: "probe", exec, maxDepth: 3 })
    expect(started.role).toBe("Deep Worker")
    // The TOOL's own list sees it: one supervisor, not two.
    /** The tool's list answer. */
    const listed = await harness.tools.get("mpd_role_consult").execute({ action: "list" }, exec)
    expect(listed.consults.map((entry: any) => entry.consultId)).toContain(started.consultId)
    // The child was raised with the caller's ABSOLUTE cap, not the caller-depth arithmetic.
    await tick()
    expect(harness.spawned.length).toBe(1)
    expect(harness.spawned[0].maxDepth).toBe(3)
    expect(harness.spawned[0].label).toBe("Deep Worker")
    // Collecting through the service releases the record the tool listed.
    await harness.provided.mpdConsults.settle(started.consultId)
    harness.provided.mpdConsults.collect(started.consultId)
    /** The tool's list after the release. */
    const after = await harness.tools.get("mpd_role_consult").execute({ action: "list" }, exec)
    expect(after.consults).toEqual([])
  })

  test("THE ONE DIFFERENCE: a depth-2 session is refused by the TOOL and allowed by the SERVICE", async () => {
    /** The applied row. */
    const harness = makePlugin()
    /** A team member two levels below the session that started the work. */
    const deep = { agent: { id: "agent-deep", session: { id: "agent-deep", header: { delegationDepth: 2 } } }, signal: new AbortController().signal }
    // The TOOL applies the roster's depth floor...
    await expect(harness.tools.get("mpd_role_spawn_async").execute({ role: "Explorer", task: "x" }, deep)).rejects.toThrow(/delegation depth 2/)
    // ...and the SERVICE does not: this is the bounded plane's exemption (one consumer today: cellwork).
    /** The service start at depth 2. */
    const started = await harness.provided.mpdConsults.start({ role: "Explorer", task: "x", exec: deep, maxDepth: 3 })
    expect(started.state).toBe("running")
    await tick()
    expect(harness.spawned.length).toBe(1)
    expect(harness.spawned[0].maxDepth).toBe(3)
  })

  test("onSettled: the observer fires ONCE on success and ONCE on failure, with NO wait/collect", async () => {
    /** The composed service over a real supervisor. */
    const { service } = compose()
    /** Every outcome the observer saw. */
    const seen: Array<{ state: string; hasReport: boolean; error?: string }> = []
    /** The started consult, with its observer armed. */
    const started = await service.start({ role: "Explorer", task: "x", exec: {}, onSettled: (outcome): void => { seen.push({ state: String((outcome as { state?: unknown }).state ?? ""), hasReport: (outcome as { report?: unknown }).report !== undefined, ...((outcome as { error?: unknown }).error === undefined ? {} : { error: String((outcome as { error?: unknown }).error) }) }) } })
    // NOBODY calls `wait` or `collect`: the settlement itself must notify.
    await tick(20)
    expect(seen.length).toBe(1)
    expect(seen[0].state).toBe("complete")
    expect(seen[0].hasReport).toBe(true)
    // A collect AFTER the fact must not fire it a second time (one settlement, one callback).
    service.collect(started.consultId)
    await tick(5)
    expect(seen.length).toBe(1)
  })

  test("onSettled: a consult whose POST-start settlement fails notifies with the failure text", async () => {
    /** The composed service whose child's settlement REJECTS after the activation started. */
    const { service, supervisor } = compose()
    /** Every outcome the observer saw. */
    const seen: Array<{ state: string; error?: string }> = []
    /** The started consult. */
    const started = await service.start({ role: "Explorer", task: "x", exec: {}, onSettled: (outcome): void => { seen.push({ state: String((outcome as { state?: unknown }).state ?? ""), ...((outcome as { error?: unknown }).error === undefined ? {} : { error: String((outcome as { error?: unknown }).error) }) }) } })
    // The deadman is the ONE path that settles a started consult without a child answer; cancel is the
    // caller-initiated equivalent and must notify identically.
    supervisor.cancel(started.consultId)
    await tick(5)
    expect(seen.length).toBe(1)
    expect(seen[0].state).toBe("interrupted")
    // A cancel that lands after settlement is a no-op, so the observer still saw ONE outcome.
    supervisor.cancel(started.consultId)
    await tick(5)
    expect(seen.length).toBe(1)
  })

  test("R1.1: a depth-2 caller with NO forwarded cap lands at caller depth + 1 (3) — the row's OWN rule, not a cell cap", async () => {
    /** The applied row. */
    const harness = makePlugin()
    /** A team member two levels below the session that started the work. */
    const deep = { agent: { id: "agent-deep", session: { id: "agent-deep", header: { delegationDepth: 2 } } }, signal: new AbortController().signal }
    // NO `maxDepth`: this is what cellwork sends since the repair. The service must derive the cap from the
    // caller's recorded depth (`spawnMaxDepthOf` = 2 + 1), placing the child one level below as a LEAF.
    /** The service start at depth 2, with no absolute cap. */
    const started = await harness.provided.mpdConsults.start({ role: "Explorer", task: "x", exec: deep })
    expect(started.state).toBe("running")
    await tick()
    expect(harness.spawned.length).toBe(1)
    // 3 arrives from the DEPTH SCALE, never from `cellwork.depthMax` (which counts nested CELLS and is not
    // even visible to this row).
    expect(harness.spawned[0].maxDepth).toBe(3)
  })
})
