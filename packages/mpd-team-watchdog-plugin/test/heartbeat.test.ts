// Heartbeat store: attribution, the four moments, rotation and disk read-back.
//
// The acceptance this file backs (AC-1/AC-2 shape): the store is written on model
// steps AND on the adapter's POST tool hook, for members AND the captain, and what
// lands on disk is what a reader gets back. The FRESH-process read-back lives in
// the evidence lane (`evidence/team-watchdog/plugin/<ts>/fresh-read.mjs`), which
// imports the built dist in a separate node process; here the disk is read back
// through the module's own reader so a regression in the writer fails fast.
import { describe, expect, test } from "bun:test"
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { appendHeartbeat, listHeartbeatKeys, newestForTask, newestOverall, readHeartbeats, rotateHeartbeats, type HeartbeatStamp } from "../src/store"
import { WatchdogEngine } from "../src/engine"
import { agent, sandbox, stubAdapter, testConfig, writeTeam } from "./support"

/** A ctx stub that records the event handlers an engine installs. */
function stubCtx(dsh?: { onEvent: (event: string, handler: (...args: any[]) => unknown) => (() => void) | undefined }): { on: (event: string, handler: (...args: any[]) => unknown) => () => void; handlers: Map<string, (...args: any[]) => unknown> } {
  // Last handler per event name, recorded for tests that invoke one directly.
  const handlers = new Map<string, (...args: any[]) => unknown>()
  return {
    handlers,
    // The engine subscribes through `dsh.onEvent` (AGENTS.md §6: a harness event NAME is
    // part of the surface the adapter absorbs), and the real adapter forwards to `ctx.on`.
    // Registering on BOTH maps keeps `ctx.handlers` readable while letting `stub.emit(…)`
    // drive the same listener, exactly as a real composition does.
    on: (event, handler) => {
      // The handle the stub adapter returned, when it has an event seam at all.
      const disposer = dsh?.onEvent(event, handler)
      handlers.set(event, handler)
      return () => {
        handlers.delete(event)
        if (typeof disposer === "function") disposer()
      }
    },
  }
}

describe("heartbeat store", () => {
  test("a model step stamps the member AND the task the member owns", () => {
    // An isolated workspace for this case.
    const box = sandbox()
    try {
      writeTeam(box, {
        id: "team-a",
        members: [{ id: "a1", name: "Architect" }],
        tasks: [{ id: "t1", status: "in_progress", assignee: "Architect", attempt: 1, attemptId: "att-1" }],
      })
      // The stub adapter the engine stamps through.
      const stub = stubAdapter({ workspace: box.workspace })
      // The engine that owns the heartbeat writers.
      const engine = new WatchdogEngine(stub.adapter, stubCtx(stub.adapter), testConfig({ stateDir: box.stateDir }))
      engine.stamp("step", agent("a1", box.workspace))

      // What the store read back for the owning member.
      const stamps = readHeartbeats(box.workspace, box.stateDir, "Architect")
      expect(stamps.length).toBe(1)
      expect(stamps[0].kind).toBe("step")
      expect(stamps[0].member).toBe("Architect")
      expect(stamps[0].taskId).toBe("t1")
      // 0.1.7: the generation token is the official board REVISION (the projection renders
      // it as a string), because the official task view carries no attempt id.
      expect(stamps[0].attemptId).toBe("1")
      expect(stamps[0].teamId).toBe("team-a")
      expect(stamps[0].workspace).toBe(box.workspace)
    } finally {
      box.cleanup()
    }
  })

  test("the captain is stamped under its own key by the same code path", () => {
    // An isolated workspace for this case.
    const box = sandbox()
    try {
      writeTeam(box, {
        id: "team-a",
        captainSessionId: "sess-cap",
        members: [{ id: "a1", name: "Architect" }],
        tasks: [{ id: "t9", status: "in_progress", assignee: "captain", attempt: 1, attemptId: "att-cap" }],
      })
      // The stub adapter the engine stamps through.
      const stub = stubAdapter({ workspace: box.workspace })
      // The engine under test.
      const engine = new WatchdogEngine(stub.adapter, stubCtx(stub.adapter), testConfig({ stateDir: box.stateDir }))
      engine.stamp("step", agent("cap-agent", box.workspace, "sess-cap"))

      // What the store read back under the captain's own key.
      const stamps = readHeartbeats(box.workspace, box.stateDir, "captain")
      expect(stamps.length).toBe(1)
      expect(stamps[0].member).toBe("captain")
      expect(stamps[0].taskId).toBe("t9")
      expect(stamps[0].attemptId).toBe("1")
    } finally {
      box.cleanup()
    }
  })

  test("an agent outside every team still stamps, under a per-session key", () => {
    // An isolated workspace for this case.
    const box = sandbox()
    try {
      writeTeam(box, { id: "team-a", members: [{ id: "a1", name: "Architect" }], tasks: [] })
      // The stub adapter the engine stamps through.
      const stub = stubAdapter({ workspace: box.workspace })
      // The engine under test.
      const engine = new WatchdogEngine(stub.adapter, stubCtx(stub.adapter), testConfig({ stateDir: box.stateDir }))
      engine.stamp("step", agent("stranger", box.workspace, "session-abcdef12"))

      // The heartbeat keys the store holds for this workspace.
      const keys = listHeartbeatKeys(box.workspace, box.stateDir)
      expect(keys.length).toBe(1)
      expect(keys[0].startsWith("session-")).toBe(true)
      // What the per-session key read back.
      const stamps = readHeartbeats(box.workspace, box.stateDir, keys[0])
      expect(stamps.length).toBe(1)
      expect(stamps[0].member).toBe(null)
      expect(stamps[0].teamId).toBe(null)
    } finally {
      box.cleanup()
    }
  })

  test("the tool pair: the PRE hook opens the call (tool-start), the POST hook closes it (tool)", () => {
    // An isolated workspace for this case.
    const box = sandbox()
    try {
      writeTeam(box, {
        id: "team-a",
        members: [{ id: "a1", name: "Architect" }],
        tasks: [{ id: "t1", status: "claimed", assignee: "Architect", attemptId: "att-1" }],
      })
      // The stub adapter whose PRE and POST hooks the engine installs on.
      const stub = stubAdapter({ workspace: box.workspace })
      // The engine under test, with both heartbeat halves installed.
      const engine = new WatchdogEngine(stub.adapter, stubCtx(stub.adapter), testConfig({ stateDir: box.stateDir }))
      engine.install()
      // r6 installs BOTH halves; the POST half keeps its W-9 completion semantics.
      expect(stub.pre.length).toBe(1)
      expect(stub.post.length).toBe(1)

      // The POST hook stamps a COMPLETED call and nothing else.
      const returned = stub.post[0]({ name: "read", callId: "call-7", agent: agent("a1", box.workspace) }, { isError: false }, { kind: "accept" })
      expect(returned).toBeUndefined()

      // What the completion stamp left on disk.
      const stamps = readHeartbeats(box.workspace, box.stateDir, "Architect")
      expect(stamps.length).toBe(1)
      expect(stamps[0].kind).toBe("tool")
      expect(stamps[0].tool).toBe("read")
      expect(stamps[0].callId).toBe("call-7")
      expect(stamps[0].taskId).toBe("t1")

      // The PRE hook stamps the OPEN call: same call id, so the pair is readable.
      stub.pre[0]({ name: "read", callId: "call-8", agent: agent("a1", box.workspace) }, { kind: "allow" })
      // The store after the PRE hook opened a second, still-running call.
      const afterPre = readHeartbeats(box.workspace, box.stateDir, "Architect")
      expect(afterPre.length).toBe(2)
      expect(afterPre[1].kind).toBe("tool-start")
      expect(afterPre[1].tool).toBe("read")
      expect(afterPre[1].callId).toBe("call-8")
      expect(afterPre[1].taskId).toBe("t1")
      // A DENIED call is never dispatched, so nothing is opened for it.
      stub.pre[0]({ name: "write", callId: "call-9", agent: agent("a1", box.workspace) }, { kind: "deny", reason: "scope" })
      expect(readHeartbeats(box.workspace, box.stateDir, "Architect").length).toBe(2)
      expect(engine.getStats().toolStarts).toBe(1)
    } finally {
      box.cleanup()
    }
  })

  test("turn boundaries are stamped and an old generation is rotated away", () => {
    // An isolated workspace for this case.
    const box = sandbox()
    try {
      writeTeam(box, { id: "team-a", members: [{ id: "a1", name: "Architect" }], tasks: [] })
      // The stub adapter whose listeners the engine installs on.
      const stub = stubAdapter({ workspace: box.workspace })
      // The ctx stub whose handler map is read back below.
      const ctx = stubCtx(stub.adapter)
      // The engine under test.
      const engine = new WatchdogEngine(stub.adapter, ctx, testConfig({ stateDir: box.stateDir }))
      engine.install()
      // The installed `agent/session-start` listener (the turn-start writer).
      const start = stub.listener("agent/session-start")
      // The installed `agent/turn-stopping` listener (the turn-end writer).
      const stopping = stub.listener("agent/turn-stopping")
      expect(typeof start).toBe("function")
      expect(typeof stopping).toBe("function")

      for (let generation = 0; generation < 5; generation += 1) {
        start?.({ agent: agent("a1", box.workspace) })
        engine.stamp("step", agent("a1", box.workspace))
        stopping?.({ agent: agent("a1", box.workspace) })
      }

      // What survived rotation for the member.
      const stamps = readHeartbeats(box.workspace, box.stateDir, "Architect")
      // How many generations (turn-start stamps) survived.
      const starts = stamps.filter((stamp) => stamp.kind === "turn-start").length
      expect(starts).toBe(3)
      expect(engine.getStats().rotations).toBe(2)
    } finally {
      box.cleanup()
    }
  })

  test("timestamps advance across a turn (>= 3 distinct lastSeen values)", async () => {
    // An isolated workspace for this case.
    const box = sandbox()
    try {
      writeTeam(box, {
        id: "team-a",
        members: [{ id: "a1", name: "Architect" }],
        tasks: [{ id: "t1", status: "in_progress", assignee: "Architect", attemptId: "att-1" }],
      })
      // The stub adapter the engine stamps through.
      const stub = stubAdapter({ workspace: box.workspace })
      // The engine under test.
      const engine = new WatchdogEngine(stub.adapter, stubCtx(stub.adapter), testConfig({ stateDir: box.stateDir }))
      // The `lastSeen` values observed across the four steps.
      const seen: number[] = []
      for (let step = 0; step < 4; step += 1) {
        engine.stamp("step", agent("a1", box.workspace))
        await new Promise((resolve) => setTimeout(resolve, 3))
        // The newest stamp for the task after this step, when one exists yet.
        const newest = newestForTask(readHeartbeats(box.workspace, box.stateDir, "Architect"), "t1", "1")
        if (newest !== undefined) seen.push(newest.at)
      }
      // The distinct `lastSeen` values, which must be at least three.
      const distinct = [...new Set(seen)]
      expect(distinct.length).toBeGreaterThanOrEqual(3)
      expect([...distinct].sort((a, b) => a - b)).toEqual(distinct)
    } finally {
      box.cleanup()
    }
  })

  test("r2: rotation is PER TEAM, so one team's turnover cannot evict the other team's evidence", () => {
    // An isolated workspace for this case.
    const box = sandbox()
    try {
      // Two teams share ONE heartbeat file (the file key is the member NAME per workspace).
      // team-beta never turns over; team-alpha turns over four times.
      const stamp = (teamId: string, kind: string, at: number): HeartbeatStamp => ({
        kind: kind as "step",
        at,
        member: "Architect",
        memberKey: "Architect",
        teamId,
        taskId: "t1",
        attemptId: "att-1",
        turnId: teamId + "#" + at,
        workspace: box.workspace,
      })
      // The hand-written JSONL: one team-beta stamp, then four team-alpha generations.
      const lines: string[] = [JSON.stringify(stamp("team-beta", "step", 1_000))]
      for (let generation = 0; generation < 4; generation += 1) {
        lines.push(JSON.stringify(stamp("team-alpha", "turn-start", 10_000 + generation * 100)))
        lines.push(JSON.stringify(stamp("team-alpha", "step", 10_050 + generation * 100)))
        lines.push(JSON.stringify(stamp("team-alpha", "turn-end", 10_099 + generation * 100)))
      }
      // The shared heartbeat file both teams append to.
      const path = join(box.workspace, box.stateDir, "watchdog", "heartbeat", "architect.jsonl")
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, lines.join("\n") + "\n")

      // The rotation outcome, bounded to three generations PER TEAM.
      const rotated = rotateHeartbeats(box.workspace, box.stateDir, "Architect", 3)
      expect(rotated.rotated).toBe(true)
      // What survived: team-beta's single stamp and team-alpha's last three generations.
      const after = readHeartbeats(box.workspace, box.stateDir, "Architect")
      // team-beta's only stamp SURVIVES: its wedge stays observable as SILENCE, not as never-started.
      expect(after.some((entry) => entry.teamId === "team-beta")).toBe(true)
      // team-alpha is still bounded to `keep` generations.
      expect(after.filter((entry) => entry.teamId === "team-alpha" && entry.kind === "turn-start").length).toBe(3)
    } finally {
      box.cleanup()
    }
  })

  test("a torn last line does not hide the stamps before it", () => {
    // An isolated workspace for this case.
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
      // The same file, appended to directly to leave a torn last line.
      const path = `${box.workspace}/${box.stateDir}/watchdog/heartbeat/architect.jsonl`
      appendFileSync(path, '{"kind":"step","at":2', "utf8")
      // What a reader gets back: the complete stamp, not the torn one.
      const stamps = readHeartbeats(box.workspace, box.stateDir, "Architect")
      expect(stamps.length).toBe(1)
      expect(newestOverall(stamps)?.at).toBe(1)
    } finally {
      box.cleanup()
    }
  })
})
