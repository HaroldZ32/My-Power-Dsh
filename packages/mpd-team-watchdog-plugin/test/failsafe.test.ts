// AC-15 (fail-safe): the watchdog cannot wedge the host.
//
//   * a throwing tick body is caught and COUNTED, never propagated;
//   * exactly ONE interval owns the cadence, and a live knob change replaces it;
//   * a tick with no state change writes nothing (no write loop);
//   * an unwritable heartbeat/scene location degrades to a counted failure;
//   * a tick that starts while the previous one still runs is SKIPPED, not queued.
import { describe, expect, test } from "bun:test"
import { mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { WatchdogEngine } from "../src/engine"
import { apply } from "../src/index"
import { readHeartbeats } from "../src/store"
import { agent, pluginCtx, sandbox, stubAdapter, testConfig, writeTeam, openOutstandingChannel } from "./support"

/** A ctx stub; the engine only ever reads `on` from it in this file. */
function stubCtx(dsh?: { onEvent: (event: string, handler: (...args: any[]) => unknown) => (() => void) | undefined }): { on: (event: string, handler: (...args: any[]) => unknown) => () => void } {
  return { on: () => () => {} }
}

/** Files anywhere under the watchdog root (the write-loop probe). */
function watchdogFileCount(workspace: string, stateDir: string): number {
  // Files found under the watchdog root.
  let count = 0
  // Recursively count the files below one directory.
  const walk = (dir: string): void => {
    // Directory entries; an unreadable directory contributes nothing.
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const entry of entries) {
      // Full path of this entry.
      const path = join(dir, entry)
      // Whether the entry is a directory; a failed stat reads as a file.
      let isDir = false
      try {
        isDir = statSync(path).isDirectory()
      } catch {
        isDir = false
      }
      if (isDir) walk(path)
      else count += 1
    }
  }
  walk(join(workspace, stateDir, "watchdog"))
  return count
}

describe("AC-15 fail-safe", () => {
  test("a throwing tick body is caught and counted, and the tick still returns", async () => {
    // An isolated workspace for this case.
    const box = sandbox()
    // The real console.warn, restored in the finally block.
    const originalWarn = console.warn
    // The lines the engine's console channel produced.
    const warnings: string[] = []
    console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(" "))
    try {
      // The stub adapter the engine is built on.
      const stub = stubAdapter({ workspace: box.workspace })
      // The engine under test, with the shared test config.
      const engine = new WatchdogEngine(stub.adapter, stubCtx(stub.adapter), testConfig({ stateDir: box.stateDir }))
      engine.knownRoots = () => {
        throw new Error("boom")
      }
      // The tick's result; the throwing body must be contained.
      const result = await engine.tickOnce(1)
      expect(engine.getStats().tickErrors).toBe(1)
      expect(engine.getStats().lastError).toBe("boom")
      expect(result.skipped).toContain("tick error")
      expect(warnings.some((line) => line.includes("tick threw 1 time(s)"))).toBe(true)
      // And the next tick with a working body still runs (the count is not fatal).
      engine.knownRoots = () => []
      expect((await engine.tickOnce(2)).skipped).toBeUndefined()
      expect(engine.getStats().ticks).toBe(2)
    } finally {
      console.warn = originalWarn
      box.cleanup()
    }
  })

  test("exactly ONE interval owns the cadence, and a live cadence change replaces it", () => {
    // An isolated workspace for this case.
    const box = sandbox()
    // The real interval factory, restored in the finally block.
    const originalSet = globalThis.setInterval
    // The real clearInterval, restored in the finally block.
    const originalClear = globalThis.clearInterval
    // Every interval handle the row created.
    const created: unknown[] = []
    // Every handle the row cleared.
    const cleared: unknown[] = []
    globalThis.setInterval = ((handler: () => void, ms?: number) => {
      // The real timer handle, recorded before it is returned.
      const handle = originalSet(handler, ms)
      created.push(handle)
      return handle
    }) as unknown as typeof globalThis.setInterval
    globalThis.clearInterval = ((handle?: unknown) => {
      cleared.push(handle)
      return originalClear(handle as never)
    }) as unknown as typeof globalThis.clearInterval
    try {
      // The plugin context whose adapter records the row's tools.
      const ctx = pluginCtx(box.workspace)
      // The apply report, whose cadence and disposers are asserted.
      const report = apply(ctx, { stateDir: box.stateDir, teamCacheMs: 0, tickIntervalMs: 60_000, warnSilenceMs: 120_000 })
      expect(report.applied).toBe(true)
      expect(report.disposers).toBeGreaterThan(0)
      expect(created.length).toBe(1)
      expect(report.intervalMs).toBe(60_000)
      // A live change to the cadence rebuilds the ONE interval; it never adds a second.
      report.engine?.onKnobsChanged?.({ ...report.knobs, tickIntervalMs: 30_000 })
      expect(created.length).toBe(2)
      expect(cleared.length).toBe(1)
      // Disposal clears the live interval.
      ctx.__dispose()
      expect(cleared.length).toBe(2)
      expect(report.engine?.isStopped()).toBe(true)
    } finally {
      globalThis.setInterval = originalSet
      globalThis.clearInterval = originalClear
      box.cleanup()
    }
  })

  test("a tick with no state change writes nothing (no write loop)", async () => {
    // An isolated workspace for this case.
    const box = sandbox()
    try {
      writeTeam(box, {
        id: "team-a",
        members: [{ id: "a1", name: "Architect" }],
        tasks: [{ id: "t1", status: "in_progress", assignee: "Architect", attemptId: "att-1" }],
      })
      // The stub adapter the engine is built on.
      const stub = stubAdapter({ workspace: box.workspace })
      // The engine under test.
      const engine = new WatchdogEngine(stub.adapter, stubCtx(stub.adapter), testConfig({ stateDir: box.stateDir }))
      engine.stamp("step", agent("a1", box.workspace))
      // The watchdog file count before the idle ticks.
      const before = watchdogFileCount(box.workspace, box.stateDir)
      // The store reader, imported dynamically for this case.
      const { readHeartbeats } = await import("../src/store")
      // The step stamp's time, the clock the ticks are relative to.
      const from = readHeartbeats(box.workspace, box.stateDir, "Architect")[0].at
      for (let index = 0; index < 5; index += 1) {
        // This idle tick's result, which must decide nothing.
        const result = await engine.tickOnce(from + 10 + index)
        expect(result.decisions).toEqual([])
      }
      expect(watchdogFileCount(box.workspace, box.stateDir)).toBe(before)
      expect(engine.getStats().scenes).toBe(0)
      expect(engine.getStats().incidents).toBe(0)
    } finally {
      box.cleanup()
    }
  })

  test("an unwritable heartbeat location degrades to a counted failure", () => {
    // An isolated workspace for this case.
    const box = sandbox()
    // The real console.warn, restored in the finally block.
    const originalWarn = console.warn
    // The lines the engine's console channel produced.
    const warnings: string[] = []
    console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(" "))
    try {
      writeTeam(box, {
        id: "team-a",
        members: [{ id: "a1", name: "Architect" }],
        tasks: [{ id: "t1", status: "in_progress", assignee: "Architect", attemptId: "att-1" }],
      })
      // The watchdog root, where the heartbeat path is blocked below.
      const watchdog = join(box.workspace, box.stateDir, "watchdog")
      mkdirSync(watchdog, { recursive: true })
      // Occupy the heartbeat directory's place with a FILE.
      writeFileSync(join(watchdog, "heartbeat"), "not a directory\n")
      // The stub adapter the engine is built on.
      const stub = stubAdapter({ workspace: box.workspace })
      // The engine under test.
      const engine = new WatchdogEngine(stub.adapter, stubCtx(stub.adapter), testConfig({ stateDir: box.stateDir }))
      // The stamp whose write must fail and be counted.
      const stamp = engine.stamp("step", agent("a1", box.workspace))
      expect(stamp.member).toBe("Architect")
      expect(engine.getStats().heartbeatFailures).toBe(1)
      expect(engine.getStats().heartbeatWrites).toBe(0)
      expect(warnings.some((line) => line.includes("heartbeat write failed at"))).toBe(true)
    } finally {
      console.warn = originalWarn
      box.cleanup()
    }
  })

  test("a tick that starts while the previous one runs is skipped, never queued", async () => {
    // An isolated workspace for this case.
    const box = sandbox()
    try {
      writeTeam(box, {
        id: "team-a",
        members: [{ id: "a1", name: "Architect" }],
        tasks: [{ id: "t1", status: "in_progress", assignee: "Architect", attemptId: "att-1" }],
      })
      // The stub adapter the engine is built on.
      const stub = stubAdapter({ workspace: box.workspace })
      // The engine under test.
      const engine = new WatchdogEngine(stub.adapter, stubCtx(stub.adapter), testConfig({ stateDir: box.stateDir }))
      // A WARN awaits, so the first tick is genuinely in flight when the second starts.
      engine.stamp("step", agent("a1", box.workspace))
      // The step stamp's time, which is the OUTSTANDING clock.
      const from = readHeartbeats(box.workspace, box.stateDir, "Architect")[0].at
      openOutstandingChannel(stub, "a1", from)
      // The first tick, left pending so the second one overlaps it.
      const first = engine.tickOnce(from + 90_001)
      // The overlapping tick, which must be skipped rather than queued.
      const second = await engine.tickOnce(from + 90_002)
      expect(second.skipped).toBe("previous tick still running")
      expect(engine.getStats().tickSkips).toBe(1)
      await first
      // `ticks` counts the ticks that RAN; the skipped one is counted separately.
      expect(engine.getStats().ticks).toBe(1)
      expect(engine.getStats().tickSkips).toBe(1)
    } finally {
      box.cleanup()
    }
  })

  test("the env kill switch makes the tick observe nothing at all", async () => {
    // An isolated workspace for this case.
    const box = sandbox()
    // The env value to restore when the case ends.
    const previous = process.env.MPD_DSH_TEAM_WATCHDOG
    process.env.MPD_DSH_TEAM_WATCHDOG = "off"
    try {
      writeTeam(box, {
        id: "team-a",
        members: [{ id: "a1", name: "Architect" }],
        tasks: [{ id: "t1", status: "in_progress", assignee: "Architect", attemptId: "att-1" }],
      })
      // The stub adapter the engine is built on.
      const stub = stubAdapter({ workspace: box.workspace })
      // The engine under test.
      const engine = new WatchdogEngine(stub.adapter, stubCtx(stub.adapter), testConfig({ stateDir: box.stateDir }))
      engine.stamp("step", agent("a1", box.workspace))
      // The store reader, imported dynamically for this case.
      const { readHeartbeats } = await import("../src/store")
      // The step stamp's time, the clock the disabled tick is relative to.
      const from = readHeartbeats(box.workspace, box.stateDir, "Architect")[0].at
      // The tick's result, which must report the environment kill switch.
      const result = await engine.tickOnce(from + 90_001)
      expect(result.skipped).toBe("disabled")
      expect(result.decisions).toEqual([])
      expect(engine.getStats().scenes).toBe(0)
    } finally {
      if (previous === undefined) delete process.env.MPD_DSH_TEAM_WATCHDOG
      else process.env.MPD_DSH_TEAM_WATCHDOG = previous
      box.cleanup()
    }
  })

  test("a row config kill switch also disables the engine", async () => {
    // An isolated workspace for this case.
    const box = sandbox()
    try {
      // The plugin context the row is applied to.
      const ctx = pluginCtx(box.workspace)
      // The apply report, whose engine is ticked directly below.
      const report = apply(ctx, { stateDir: box.stateDir, enabled: false, tickIntervalMs: 3_600_000, warnSilenceMs: 7_200_000 })
      expect(report.applied).toBe(true)
      // The tick's result, which must report the row-config kill switch.
      const result = await report.engine!.tickOnce(1)
      expect(result.skipped).toBe("disabled")
      ctx.__dispose()
    } finally {
      box.cleanup()
    }
  })
})
