// Heartbeat store: attribution, the four moments, rotation and disk read-back.
//
// The acceptance this file backs (AC-1/AC-2 shape): the store is written on model
// steps AND on the adapter's POST tool hook, for members AND the captain, and what
// lands on disk is what a reader gets back. The FRESH-process read-back lives in
// the evidence lane (`evidence/team-watchdog/plugin/<ts>/fresh-read.mjs`), which
// imports the built dist in a separate node process; here the disk is read back
// through the module's own reader so a regression in the writer fails fast.
import { describe, expect, test } from "bun:test"
import { appendFileSync } from "node:fs"
import { appendHeartbeat, listHeartbeatKeys, newestForTask, newestOverall, readHeartbeats, rotateHeartbeats } from "../src/store"
import { WatchdogEngine } from "../src/engine"
import { agent, sandbox, stubAdapter, testConfig, writeTeam } from "./support"

/** A ctx stub that records the event handlers an engine installs. */
function stubCtx(): { on: (event: string, handler: (...args: any[]) => unknown) => () => void; handlers: Map<string, (...args: any[]) => unknown> } {
  const handlers = new Map<string, (...args: any[]) => unknown>()
  return {
    handlers,
    on: (event, handler) => {
      handlers.set(event, handler)
      return () => handlers.delete(event)
    },
  }
}

describe("heartbeat store", () => {
  test("a model step stamps the member AND the task the member owns", () => {
    const box = sandbox()
    try {
      writeTeam(box, {
        id: "team-a",
        members: [{ id: "a1", name: "Architect" }],
        tasks: [{ id: "t1", status: "in_progress", assignee: "Architect", attempt: 1, attemptId: "att-1" }],
      })
      const stub = stubAdapter({ workspace: box.workspace })
      const engine = new WatchdogEngine(stub.adapter, stubCtx(), testConfig({ stateDir: box.stateDir }))
      engine.stamp("step", agent("a1", box.workspace))

      const stamps = readHeartbeats(box.workspace, box.stateDir, "Architect")
      expect(stamps.length).toBe(1)
      expect(stamps[0].kind).toBe("step")
      expect(stamps[0].member).toBe("Architect")
      expect(stamps[0].taskId).toBe("t1")
      expect(stamps[0].attemptId).toBe("att-1")
      expect(stamps[0].teamId).toBe("team-a")
      expect(stamps[0].workspace).toBe(box.workspace)
    } finally {
      box.cleanup()
    }
  })

  test("the captain is stamped under its own key by the same code path", () => {
    const box = sandbox()
    try {
      writeTeam(box, {
        id: "team-a",
        captainSessionId: "sess-cap",
        members: [{ id: "a1", name: "Architect" }],
        tasks: [{ id: "t9", status: "in_progress", assignee: "captain", attempt: 1, attemptId: "att-cap" }],
      })
      const stub = stubAdapter({ workspace: box.workspace })
      const engine = new WatchdogEngine(stub.adapter, stubCtx(), testConfig({ stateDir: box.stateDir }))
      engine.stamp("step", agent("cap-agent", box.workspace, "sess-cap"))

      const stamps = readHeartbeats(box.workspace, box.stateDir, "captain")
      expect(stamps.length).toBe(1)
      expect(stamps[0].member).toBe("captain")
      expect(stamps[0].taskId).toBe("t9")
      expect(stamps[0].attemptId).toBe("att-cap")
    } finally {
      box.cleanup()
    }
  })

  test("an agent outside every team still stamps, under a per-session key", () => {
    const box = sandbox()
    try {
      writeTeam(box, { id: "team-a", members: [{ id: "a1", name: "Architect" }], tasks: [] })
      const stub = stubAdapter({ workspace: box.workspace })
      const engine = new WatchdogEngine(stub.adapter, stubCtx(), testConfig({ stateDir: box.stateDir }))
      engine.stamp("step", agent("stranger", box.workspace, "session-abcdef12"))

      const keys = listHeartbeatKeys(box.workspace, box.stateDir)
      expect(keys.length).toBe(1)
      expect(keys[0].startsWith("session-")).toBe(true)
      const stamps = readHeartbeats(box.workspace, box.stateDir, keys[0])
      expect(stamps.length).toBe(1)
      expect(stamps[0].member).toBe(null)
      expect(stamps[0].teamId).toBe(null)
    } finally {
      box.cleanup()
    }
  })

  test("the POST tool hook stamps a completed tool call, never a pre-dispatch one", () => {
    const box = sandbox()
    try {
      writeTeam(box, {
        id: "team-a",
        members: [{ id: "a1", name: "Architect" }],
        tasks: [{ id: "t1", status: "claimed", assignee: "Architect", attemptId: "att-1" }],
      })
      const stub = stubAdapter({ workspace: box.workspace })
      const engine = new WatchdogEngine(stub.adapter, stubCtx(), testConfig({ stateDir: box.stateDir }))
      engine.install()
      expect(stub.post.length).toBe(1)

      const returned = stub.post[0]({ name: "read", callId: "call-7", agent: agent("a1", box.workspace) }, { isError: false }, { kind: "accept" })
      expect(returned).toBeUndefined()

      const stamps = readHeartbeats(box.workspace, box.stateDir, "Architect")
      expect(stamps.length).toBe(1)
      expect(stamps[0].kind).toBe("tool")
      expect(stamps[0].tool).toBe("read")
      expect(stamps[0].callId).toBe("call-7")
      expect(stamps[0].taskId).toBe("t1")
    } finally {
      box.cleanup()
    }
  })

  test("turn boundaries are stamped and an old generation is rotated away", () => {
    const box = sandbox()
    try {
      writeTeam(box, { id: "team-a", members: [{ id: "a1", name: "Architect" }], tasks: [] })
      const stub = stubAdapter({ workspace: box.workspace })
      const ctx = stubCtx()
      const engine = new WatchdogEngine(stub.adapter, ctx, testConfig({ stateDir: box.stateDir }))
      engine.install()
      const start = ctx.handlers.get("agent/session-start")
      const stopping = ctx.handlers.get("agent/turn-stopping")
      expect(typeof start).toBe("function")
      expect(typeof stopping).toBe("function")

      for (let generation = 0; generation < 5; generation += 1) {
        start?.({ agent: agent("a1", box.workspace) })
        engine.stamp("step", agent("a1", box.workspace))
        stopping?.({ agent: agent("a1", box.workspace) })
      }

      const stamps = readHeartbeats(box.workspace, box.stateDir, "Architect")
      const starts = stamps.filter((stamp) => stamp.kind === "turn-start").length
      expect(starts).toBe(3)
      expect(engine.getStats().rotations).toBe(2)
    } finally {
      box.cleanup()
    }
  })

  test("timestamps advance across a turn (>= 3 distinct lastSeen values)", async () => {
    const box = sandbox()
    try {
      writeTeam(box, {
        id: "team-a",
        members: [{ id: "a1", name: "Architect" }],
        tasks: [{ id: "t1", status: "in_progress", assignee: "Architect", attemptId: "att-1" }],
      })
      const stub = stubAdapter({ workspace: box.workspace })
      const engine = new WatchdogEngine(stub.adapter, stubCtx(), testConfig({ stateDir: box.stateDir }))
      const seen: number[] = []
      for (let step = 0; step < 4; step += 1) {
        engine.stamp("step", agent("a1", box.workspace))
        await new Promise((resolve) => setTimeout(resolve, 3))
        const newest = newestForTask(readHeartbeats(box.workspace, box.stateDir, "Architect"), "t1", "att-1")
        if (newest !== undefined) seen.push(newest.at)
      }
      const distinct = [...new Set(seen)]
      expect(distinct.length).toBeGreaterThanOrEqual(3)
      expect([...distinct].sort((a, b) => a - b)).toEqual(distinct)
    } finally {
      box.cleanup()
    }
  })

  test("a torn last line does not hide the stamps before it", () => {
    const box = sandbox()
    try {
      appendHeartbeat(box.workspace, box.stateDir, "Architect", {
        kind: "step",
        at: 1,
        member: "Architect",
        memberKey: "Architect",
        teamId: "team-a",
        taskId: "t1",
        attemptId: "att-1",
        turnId: "x",
        workspace: box.workspace,
      })
      const path = `${box.workspace}/${box.stateDir}/watchdog/heartbeat/architect.jsonl`
      appendFileSync(path, '{"kind":"step","at":2', "utf8")
      const stamps = readHeartbeats(box.workspace, box.stateDir, "Architect")
      expect(stamps.length).toBe(1)
      expect(newestOverall(stamps)?.at).toBe(1)
    } finally {
      box.cleanup()
    }
  })
})
