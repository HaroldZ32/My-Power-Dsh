import { test, expect } from "bun:test"
import { mkdtempSync, readFileSync, existsSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { GOAL_DEFAULTS, anchorsPath, apply, dropAnchor, readAnchors, writeAnchors } from "../src/index.ts"

/** One fake goal domain: the three harness tools this row may call, with the CAS they enforce. */
interface FakeGoalDomain {
  /** Every tool name the seam sent, in call order. */
  calls: string[]
  /** The durable goal the fake session log holds, or undefined before the first create. */
  goalNow(): Record<string, any> | undefined
  /** The `ctx.tools` double: registrations land in the caller's map, executions answer the trio. */
  registry(registered: Map<string, any>): Record<string, any>
}

/**
 * Build one fake goal domain, recording every call so an assertion can prove WHICH path ran.
 * @param hideTools - when true, the registry answers NO goal tool by name, modelling a composition
 *   that mounts the row without the harness's goal tools.
 * @returns the domain double.
 */
function fakeGoalDomain(hideTools: boolean = false): FakeGoalDomain {
  /** The durable goal the fake session log holds; undefined until `create_goal` runs. */
  let goal: any
  /** How many times each tool was called, so an assertion can prove WHICH path ran. */
  const calls: string[] = []
  /** The tool names the fake registry answers, mirroring the harness preset's goal trio. */
  const tools: Record<string, (args: any) => any> = {
    get_goal: () => ({ goal: goal ?? null, ...(goal === undefined ? {} : { activation: "armed" }) }),
    create_goal: (args: any) => {
      if (goal !== undefined) throw new Error("a goal is already current")
      goal = { id: "goal-1", revision: 1, objective: args.objective, phase: "active", roundsStarted: 0, maxGoalRounds: args.max_goal_rounds ?? 256 }
      return { goal, activation: "armed" }
    },
    update_goal: (args: any) => {
      if (goal === undefined) throw new Error("no current goal")
      if (args.goal_id !== goal.id || args.revision !== goal.revision) throw new Error("stale goal revision")
      if (args.action === "blocked") throw new Error("blocked requires at least 3 consecutive goal rounds; current round is 0")
      if (args.action === "complete") goal = { ...goal, revision: goal.revision + 1, phase: "complete" }
      return { goal, activation: "disarmed" }
    },
  }
  return {
    calls,
    goalNow: () => goal,
    /**
     * The `ctx.tools` double: it records every registration and answers `execute` for the trio.
     * @param registered - the map the registered tool definitions land in.
     * @returns the registry object.
     */
    registry(registered: Map<string, any>): Record<string, any> {
      return {
        /**
         * Capture one tool definition so a test can call it the way the model would.
         * @param definition - the definition the row registered.
         * @returns a disposer that removes it again.
         */
        register(definition: any): () => void { registered.set(definition.name, definition); return () => registered.delete(definition.name) },
        /**
         * Resolve a tool name the way the adapter's `hasTool` reads it.
         * @param name - the tool name to look up.
         * @returns the registered definition, a name-only stand-in for a preset tool, or undefined.
         */
        get(name: string): any { return registered.get(name) ?? (hideTools || tools[name] === undefined ? undefined : { name }) },
        /**
         * Run one call against the answer table; a throw becomes the harness's error result.
         * @param input - the `{name, arguments}` the adapter sends.
         * @returns the harness-shaped result.
         */
        async execute(input: any): Promise<any> {
          /** The handler for this tool name, or undefined when the name is unknown. */
          const handler = tools[input.name]
          calls.push(input.name)
          if (handler === undefined) return { isError: true, error: { message: 'unknown tool "' + input.name + '"' } }
          try {
            return { isError: false, value: handler(input.arguments ?? {}) }
          } catch (error: any) {
            return { isError: true, error: { message: String(error?.message ?? error) } }
          }
        },
      }
    },
  }
}

/** One mounted row over a throwaway workspace, with everything the tests need to drive it. */
interface MountedRow {
  /** The throwaway workspace root the row resolves state under. */
  dir: string
  /** The registered tool definitions, keyed by tool name. */
  registered: Map<string, any>
  /** The fake goal domain behind the tools. */
  domain: FakeGoalDomain
  /** The services the row provided through `ctx.provide`. */
  provided: Map<string, any>
  /** The exec a calling session presents: agent id, session id and the session header cwd. */
  exec: Record<string, any>
}

/**
 * Mount the row over a throwaway workspace, with a fake tool registry and an optional config service.
 * @param options - the row config, an optional `mpdConfig` double, and whether the goal tools exist.
 * @returns the mount, with the registered tools and the provided services.
 */
function mount(options: { config?: any; context?: any; hideTools?: boolean } = {}): MountedRow {
  /** A throwaway workspace root for this mount; never the real checkout. */
  const dir = mkdtempSync(join(tmpdir(), "mpd-goal-"))
  /** The registered tool definitions, so a test can invoke a tool the way the model would. */
  const registered = new Map<string, any>()
  /** The fake goal domain behind the tools. */
  const domain = fakeGoalDomain(options.hideTools === true)
  /** The services the row provided through `ctx.provide`. */
  const provided = new Map<string, any>()
  /** The ctx double: the tool registry, the optional mpdConfig lookup and `provide`. */
  const ctx: any = {
    tools: domain.registry(registered),
    get: (name: string) => (name === "mpdConfig" ? options.context : undefined),
    provide: (name: string, value: unknown) => provided.set(name, value),
  }
  apply(ctx, options.config ?? {})
  /** The exec a calling session presents: agent id, session id and the session header cwd. */
  const exec = { agent: { id: "agent-1", session: { id: "session-1", header: { cwd: dir } } }, signal: undefined }
  return { dir, registered, domain, provided, exec }
}

test("anchor creates a goal through the harness tools and records the anchor sidecar", async () => {
  /** The mounted row under test. */
  const m = mount()
  /** The service the other mpd rows consume. */
  const service = m.provided.get("mpdGoal")
  expect(service).toBeDefined()
  /** The anchor outcome for a fresh session. */
  const outcome = await service.anchor(m.exec, { objective: "ship the wave", source: "ulw" })
  expect(outcome.ok).toBe(true)
  expect(outcome.created).toBe(true)
  expect(outcome.goal?.id).toBe("goal-1")
  // The mutation went through the harness TOOL, never a service write.
  expect(m.domain.calls).toContain("create_goal")
  // The sidecar is durable state under the CALLING workspace, not the process cwd.
  /** The durable sidecar path under the calling workspace. */
  const file = anchorsPath(m.dir)
  expect(existsSync(file)).toBe(true)
  /** The sidecar as the row wrote it. */
  const anchors = readAnchors(file)
  expect(anchors["session-1"]?.goalId).toBe("goal-1")
  expect(anchors["session-1"]?.source).toBe("ulw")
  expect(JSON.parse(readFileSync(file, "utf8"))["session-1"].objective).toBe("ship the wave")
})

test("a second anchor keeps the unfinished goal instead of replacing it", async () => {
  /** The mounted row under test. */
  const m = mount()
  /** The service the other mpd rows consume. */
  const service = m.provided.get("mpdGoal")
  await service.anchor(m.exec, { objective: "first", source: "ulw" })
  /** The second anchor's outcome: an unfinished goal is kept, never replaced. */
  const second = await service.anchor(m.exec, { objective: "second", source: "boulder" })
  expect(second.ok).toBe(true)
  expect(second.created).toBe(false)
  expect(second.note).toContain("already current")
  // Exactly ONE create reached the harness: the harness's one-goal rule is never fought.
  expect(m.domain.calls.filter((name: string) => name === "create_goal")).toHaveLength(1)
})

test("auto-finish only completes a goal this row anchored; an explicit finish does not need one", async () => {
  /** A row that never anchored anything: its auto-finish must refuse. */
  const unanchored = mount()
  /** That row's service. */
  const unanchoredService = unanchored.provided.get("mpdGoal")
  /** The refusal an ownerless auto-finish produces. */
  const refused = await unanchoredService.finish(unanchored.exec, { outcome: "complete", source: "ulw" })
  expect(refused.ok).toBe(false)
  expect(refused.error).toContain("not anchored by mpd-goal")

  /** A row with an anchor, whose EXPLICIT tool path this arm drives. */
  const m = mount()
  /** That row's service. */
  const service = m.provided.get("mpdGoal")
  await service.anchor(m.exec, { objective: "ship the wave", source: "ulw" })
  // The explicit tool path (a model asking to close the goal) may finish a goal the row did not arm.
  /** The explicit finish tool's definition. */
  const explicit = m.registered.get("mpd_goal_finish")
  m.domain.calls.length = 0
  /** What the explicit tool call returned. */
  const toolResult = await explicit.execute({ outcome: "complete" }, m.exec)
  expect(toolResult.ok).toBe(true)
  expect(toolResult.goal?.phase).toBe("complete")
  expect(m.domain.calls).toContain("update_goal")

  // Once terminal, the anchor record is dropped, so a later run is free to anchor again.
  /** A second mount, where the AUTO path closes the goal. */
  const m2 = mount()
  /** That row's service. */
  const service2 = m2.provided.get("mpdGoal")
  await service2.anchor(m2.exec, { objective: "one", source: "ulw" })
  /** The auto finish's outcome. */
  const finished = await service2.finish(m2.exec, { outcome: "complete", source: "ulw" })
  expect(finished.ok).toBe(true)
  expect(readAnchors(anchorsPath(m2.dir))["session-1"]).toBeUndefined()
})

test("a blocked refusal from the harness is reported, not thrown", async () => {
  /** The mounted row under test. */
  const m = mount()
  /** The service the other mpd rows consume. */
  const service = m.provided.get("mpdGoal")
  await service.anchor(m.exec, { objective: "long haul", source: "ulw" })
  /** The blocked attempt, which the harness refuses before its threshold. */
  const blocked = await service.finish(m.exec, { outcome: "blocked", source: "ulw", reason: "two fruitless waves" })
  expect(blocked.ok).toBe(false)
  expect(String(blocked.error)).toContain("consecutive goal rounds")
  // A refusal leaves the anchor in place: the goal is still the live basis of execution.
  expect(readAnchors(anchorsPath(m.dir))["session-1"]?.goalId).toBe("goal-1")
})

test("mpd_goal_status reports the goal and the anchor, and reads without a driver", async () => {
  /** The mounted row under test. */
  const m = mount()
  /** The status tool's definition. */
  const status = m.registered.get("mpd_goal_status")
  /** The status before any anchor exists. */
  const before = await status.execute({}, m.exec)
  expect(before.enabled).toBe(true)
  expect(before.goal).toBeUndefined()
  /** The service the other rows consume. */
  const service = m.provided.get("mpdGoal")
  await service.anchor(m.exec, { objective: "ship the wave", source: "boulder" })
  /** The status after the anchor. */
  const after = await status.execute({}, m.exec)
  expect(after.goal?.objective).toBe("ship the wave")
  expect(after.anchored?.source).toBe("boulder")
  expect(after.autoAnchor).toBe(true)
})

test("mpd.jsonc wins over the row config, and disabling the row makes it inert", async () => {
  // A row configured on, with the runtime layer switching auto-anchor off and the cap to 7.
  /** An `mpdConfig` double carrying the runtime layer for the two keys under test. */
  const runtimeContext = { get: (key: string) => (key === "goal.autoAnchor" ? false : key === "goal.autoRounds" ? 7 : undefined) }
  /** The row configured on, with the runtime layer overriding both keys. */
  const m = mount({ config: { autoAnchor: true, autoRounds: 3 }, context: runtimeContext })
  /** That row's service. */
  const service = m.provided.get("mpdGoal")
  expect(service.autoAnchor()).toBe(false)
  /** The anchor created under the runtime cap. */
  const outcome = await service.anchor(m.exec, { objective: "ship", source: "ulw" })
  expect(outcome.goal?.maxGoalRounds).toBe(7)

  /** A row disabled by its own config. */
  const off = mount({ config: { enabled: false } })
  /** That row's service. */
  const offService = off.provided.get("mpdGoal")
  expect(offService.available()).toBe(false)
  /** The service-level refusal. */
  const refused = await offService.anchor(off.exec, { objective: "ship", source: "ulw" })
  expect(refused.ok).toBe(false)
  expect(refused.error).toContain("goal.enabled")
  /** The tool-level refusal, which the model would read. */
  const toolRefused = await off.registered.get("mpd_goal_anchor").execute({ objective: "ship" }, off.exec)
  expect(toolRefused.ok).toBe(false)
  expect(String(toolRefused.error)).toContain("disabled")
})

test("auto-finish refuses a goal another row anchored (ownership is per run, not per session)", async () => {
  /** The mounted row under test. */
  const m = mount()
  /** The service the other mpd rows consume. */
  const service = m.provided.get("mpdGoal")
  // A ULW run anchors first; a boulder work in the SAME session later inherits that goal (the
  // harness allows one goal per session), and must NOT be able to close it.
  await service.anchor(m.exec, { objective: "ship the wave", source: "ulw" })
  /** The boulder row's auto-finish attempt. */
  const foreign = await service.finish(m.exec, { outcome: "complete", source: "boulder" })
  expect(foreign.ok).toBe(false)
  expect(String(foreign.error)).toContain('anchored by "ulw"')
  // The owner's own finish still works, which is what makes the refusal an ownership rule and not a lock.
  /** The ULW row's own auto-finish. */
  const owner = await service.finish(m.exec, { outcome: "complete", source: "ulw" })
  expect(owner.ok).toBe(true)
})

test("an unrecordable ownership sidecar is reported, never swallowed", async () => {
  /** The mounted row under test. */
  const m = mount()
  /** The service the other mpd rows consume. */
  const service = m.provided.get("mpdGoal")
  // Make the workspace's `.mpd` a FILE, so the sidecar's mkdir fails and the write is impossible.
  writeFileSync(join(m.dir, ".mpd"), "not a directory")
  /** The anchor outcome under a workspace that cannot hold the sidecar. */
  const outcome = await service.anchor(m.exec, { objective: "ship the wave", source: "ulw" })
  // The goal EXISTS, so the call is not a failure — but the missing ownership is stated, not hidden.
  expect(outcome.ok).toBe(true)
  expect(outcome.created).toBe(true)
  expect(String(outcome.note)).toContain("ownership record could not be written")
  expect(String(outcome.note)).toContain("mpd_goal_finish")
})

test("anchor refuses when the composition mounts no goal tools", async () => {
  /** A row whose registry answers no goal tool by name. */
  const m = mount({ hideTools: true })
  /** The service the other mpd rows consume. */
  const service = m.provided.get("mpdGoal")
  /** The refusal a tool-less composition produces. */
  const refused = await service.anchor(m.exec, { objective: "ship", source: "ulw" })
  expect(refused.ok).toBe(false)
  expect(refused.created).toBe(false)
  expect(refused.error).toContain("goal tools are not mounted")
  // The tools READ path still works (the durable service is separate) — and reports no goal.
  /** The status tool's definition. */
  const status = m.registered.get("mpd_goal_status")
  /** The status in a tool-less composition. */
  const read = await status.execute({}, m.exec)
  expect(read.goal).toBeUndefined()
})

test("the anchor sidecar survives a malformed file and drops only its own record", () => {
  /** A throwaway workspace for the sidecar assertions. */
  const dir = mkdtempSync(join(tmpdir(), "mpd-goal-side-"))
  /** The sidecar path under that workspace. */
  const file = anchorsPath(dir)
  writeAnchors(file, { a: { goalId: "g1", revision: 1, objective: "o", source: "ulw", at: "t" }, b: { goalId: "g2", revision: 2, objective: "o2", source: "boulder", at: "t" } })
  expect(Object.keys(readAnchors(file))).toEqual(["a", "b"])
  dropAnchor(file, "a")
  expect(Object.keys(readAnchors(file))).toEqual(["b"])
  // A hand-mangled document reads as "no anchors" instead of taking a run down.
  writeFileSync(file, "{ not json")
  expect(readAnchors(file)).toEqual({})
  // The defaults are one declaration, so this pins the documented L0 layer.
  expect(GOAL_DEFAULTS).toEqual({ enabled: true, autoAnchor: true, autoRounds: 32 })
})
