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

function stubCtx(): { on: (event: string, handler: (...args: any[]) => unknown) => () => void } {
  return { on: () => () => {} }
}

/** Files anywhere under the watchdog root (the write-loop probe). */
function watchdogFileCount(workspace: string, stateDir: string): number {
  let count = 0
  const walk = (dir: string): void => {
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const entry of entries) {
      const path = join(dir, entry)
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
    const box = sandbox()
    const originalWarn = console.warn
    const warnings: string[] = []
    console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(" "))
    try {
      const stub = stubAdapter({ workspace: box.workspace })
      const engine = new WatchdogEngine(stub.adapter, stubCtx(), testConfig({ stateDir: box.stateDir }))
      engine.knownRoots = () => {
        throw new Error("boom")
      }
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
    const box = sandbox()
    const originalSet = globalThis.setInterval
    const originalClear = globalThis.clearInterval
    const created: unknown[] = []
    const cleared: unknown[] = []
    globalThis.setInterval = ((handler: () => void, ms?: number) => {
      const handle = originalSet(handler, ms)
      created.push(handle)
      return handle
    }) as unknown as typeof globalThis.setInterval
    globalThis.clearInterval = ((handle?: unknown) => {
      cleared.push(handle)
      return originalClear(handle as never)
    }) as unknown as typeof globalThis.clearInterval
    try {
      const ctx = pluginCtx(box.workspace)
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
    const box = sandbox()
    try {
      writeTeam(box, {
        id: "team-a",
        members: [{ id: "a1", name: "Architect" }],
        tasks: [{ id: "t1", status: "in_progress", assignee: "Architect", attemptId: "att-1" }],
      })
      const stub = stubAdapter({ workspace: box.workspace })
      const engine = new WatchdogEngine(stub.adapter, stubCtx(), testConfig({ stateDir: box.stateDir }))
      engine.stamp("step", agent("a1", box.workspace))
      const before = watchdogFileCount(box.workspace, box.stateDir)
      const { readHeartbeats } = await import("../src/store")
      const from = readHeartbeats(box.workspace, box.stateDir, "Architect")[0].at
      for (let index = 0; index < 5; index += 1) {
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
    const box = sandbox()
    const originalWarn = console.warn
    const warnings: string[] = []
    console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(" "))
    try {
      writeTeam(box, {
        id: "team-a",
        members: [{ id: "a1", name: "Architect" }],
        tasks: [{ id: "t1", status: "in_progress", assignee: "Architect", attemptId: "att-1" }],
      })
      const watchdog = join(box.workspace, box.stateDir, "watchdog")
      mkdirSync(watchdog, { recursive: true })
      // Occupy the heartbeat directory's place with a FILE.
      writeFileSync(join(watchdog, "heartbeat"), "not a directory\n")
      const stub = stubAdapter({ workspace: box.workspace })
      const engine = new WatchdogEngine(stub.adapter, stubCtx(), testConfig({ stateDir: box.stateDir }))
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
    const box = sandbox()
    try {
      writeTeam(box, {
        id: "team-a",
        members: [{ id: "a1", name: "Architect" }],
        tasks: [{ id: "t1", status: "in_progress", assignee: "Architect", attemptId: "att-1" }],
      })
      const stub = stubAdapter({ workspace: box.workspace })
      const engine = new WatchdogEngine(stub.adapter, stubCtx(), testConfig({ stateDir: box.stateDir }))
      // A WARN awaits, so the first tick is genuinely in flight when the second starts.
      engine.stamp("step", agent("a1", box.workspace))
      const from = readHeartbeats(box.workspace, box.stateDir, "Architect")[0].at
      openOutstandingChannel(stub, "a1", from)
      const first = engine.tickOnce(from + 90_001)
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
    const box = sandbox()
    const previous = process.env.MPD_DSH_TEAM_WATCHDOG
    process.env.MPD_DSH_TEAM_WATCHDOG = "off"
    try {
      writeTeam(box, {
        id: "team-a",
        members: [{ id: "a1", name: "Architect" }],
        tasks: [{ id: "t1", status: "in_progress", assignee: "Architect", attemptId: "att-1" }],
      })
      const stub = stubAdapter({ workspace: box.workspace })
      const engine = new WatchdogEngine(stub.adapter, stubCtx(), testConfig({ stateDir: box.stateDir }))
      engine.stamp("step", agent("a1", box.workspace))
      const { readHeartbeats } = await import("../src/store")
      const from = readHeartbeats(box.workspace, box.stateDir, "Architect")[0].at
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
    const box = sandbox()
    try {
      const ctx = pluginCtx(box.workspace)
      const report = apply(ctx, { stateDir: box.stateDir, enabled: false, tickIntervalMs: 3_600_000, warnSilenceMs: 7_200_000 })
      expect(report.applied).toBe(true)
      const result = await report.engine!.tickOnce(1)
      expect(result.skipped).toBe("disabled")
      ctx.__dispose()
    } finally {
      box.cleanup()
    }
  })
})
