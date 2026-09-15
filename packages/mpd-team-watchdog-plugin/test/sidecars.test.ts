// The durable sidecars: the preserving hold, the incident log, the read watermark
// and the plugin's own actions reached through the adapter's tool seam.
//
// Acceptance this file backs: the watchdogHold + incident records live BESIDE
// `team.json` and the adopted team.json bytes are untouched by this package; the
// actions exist and are reachable through the internal tool seam; a resume of a
// non-held team is a no-op.
import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { apply } from "../src/index"
import { applyHold, applyResume, HOLD_TOOL, RESUME_TOOL, STATUS_TOOL } from "../src/actions"
import { ackIncidents, appendIncident, readHold, readIncidents, readWatermarks, unacknowledged, writeHold } from "../src/sidecars"
import { pluginCtx, sandbox, writeTeam } from "./support"

describe("the hold sidecar", () => {
  test("lives beside team.json and never changes a byte of it", () => {
    const box = sandbox()
    try {
      const teamPath = writeTeam(box, {
        id: "team-a",
        members: [{ id: "a1", name: "Architect" }],
        tasks: [{ id: "t1", status: "in_progress", assignee: "Architect", attemptId: "att-1" }],
      })
      const before = readFileSync(teamPath)
      const applied = applyHold(box.workspace, box.stateDir, { team_id: "team-a", task_id: "t1", attempt_id: "att-1", cause: "silence", scene_at: 7 })
      expect(applied.applied).toBe(true)
      expect(existsSync(applied.path)).toBe(true)
      expect(applied.path.startsWith(box.workspace)).toBe(true)
      const hold = readHold(box.workspace, box.stateDir, "team-a")
      expect(hold?.taskId).toBe("t1")
      expect(hold?.attemptId).toBe("att-1")
      expect(hold?.sceneAt).toBe(7)
      // The adopted record is byte-identical: this package owns no part of it.
      expect(readFileSync(teamPath).equals(before)).toBe(true)
    } finally {
      box.cleanup()
    }
  })

  test("is idempotent by id: a second identical write changes no bytes", () => {
    const box = sandbox()
    try {
      const hold = { id: "h1", teamId: "team-a", since: 1, cause: "silence", taskId: "t1", attemptId: "att-1", sceneAt: 2 }
      const first = writeHold(box.workspace, box.stateDir, hold)
      const second = writeHold(box.workspace, box.stateDir, hold)
      expect(first.changed).toBe(true)
      expect(second.changed).toBe(false)
      expect(second.ok).toBe(true)
    } finally {
      box.cleanup()
    }
  })

  test("re-applying a hold keeps the original id and since (the hold is not restarted)", () => {
    const box = sandbox()
    try {
      const first = applyHold(box.workspace, box.stateDir, { team_id: "team-a", cause: "silence" })
      const second = applyHold(box.workspace, box.stateDir, { team_id: "team-a", cause: "silence" })
      expect(second.hold?.id).toBe(first.hold?.id)
      expect(second.hold?.since).toBe(first.hold?.since)
    } finally {
      box.cleanup()
    }
  })

  test("a resume of a non-held team is a no-op, and a second resume is a no-op", () => {
    const box = sandbox()
    try {
      expect(applyResume(box.workspace, box.stateDir, { team_id: "team-a" })).toMatchObject({ resumed: false, reason: "not-held" })
      applyHold(box.workspace, box.stateDir, { team_id: "team-a" })
      expect(applyResume(box.workspace, box.stateDir, { team_id: "team-a" }).resumed).toBe(true)
      expect(applyResume(box.workspace, box.stateDir, { team_id: "team-a" })).toMatchObject({ resumed: false, reason: "not-held" })
      expect(readHold(box.workspace, box.stateDir, "team-a")).toBeUndefined()
    } finally {
      box.cleanup()
    }
  })

  test("a hold without a team_id is refused with a reason, never thrown", () => {
    const box = sandbox()
    try {
      const refused = applyHold(box.workspace, box.stateDir, {})
      expect(refused.applied).toBe(false)
      expect(refused.error).toContain("team_id")
    } finally {
      box.cleanup()
    }
  })
})

describe("incidents and the read watermark", () => {
  test("a record per incident plus a watermark per reader", () => {
    const box = sandbox()
    try {
      const base = {
        teamId: "team-a",
        kind: "warn" as const,
        cause: { kind: "silence" as const, ms: 90_001 },
        taskId: "t1",
        attemptId: "att-1",
        scene: null,
        hold: "not-requested" as const,
        acknowledgedBy: [],
      }
      appendIncident(box.workspace, box.stateDir, { id: "i1", at: 100, ...base })
      appendIncident(box.workspace, box.stateDir, { id: "i2", at: 200, ...base })
      expect(readIncidents(box.workspace, box.stateDir).length).toBe(2)
      expect(readWatermarks(box.workspace, box.stateDir)).toEqual({})
      // Without an acknowledgement the replay is permanent by design.
      expect(unacknowledged(box.workspace, box.stateDir, "web").length).toBe(2)
      const acked = ackIncidents(box.workspace, box.stateDir, "web", 200)
      expect(acked.ok).toBe(true)
      expect(readWatermarks(box.workspace, box.stateDir)).toEqual({ web: 200 })
      expect(unacknowledged(box.workspace, box.stateDir, "web").length).toBe(0)
      // The watermark only moves forward.
      ackIncidents(box.workspace, box.stateDir, "web", 100)
      expect(readWatermarks(box.workspace, box.stateDir).web).toBe(200)
      // A second reader still sees everything.
      expect(unacknowledged(box.workspace, box.stateDir, "tui").length).toBe(2)
    } finally {
      box.cleanup()
    }
  })
})

describe("the plugin's own actions", () => {
  test("apply() registers exactly the three actions on the adapter", () => {
    const box = sandbox()
    try {
      const ctx = pluginCtx(box.workspace)
      const report = apply(ctx, { stateDir: box.stateDir, teamCacheMs: 0, tickIntervalMs: 3_600_000, warnSilenceMs: 7_200_000 })
      expect(report.applied).toBe(true)
      const stub = ctx.__stub
      expect([...stub.tools.keys()].sort()).toEqual([HOLD_TOOL, RESUME_TOOL, STATUS_TOOL].sort())
      report.engine?.stop()
      ctx.__dispose()
    } finally {
      box.cleanup()
    }
  })

  test("the hold and resume actions are reachable through the adapter's internal tool seam", async () => {
    const box = sandbox()
    try {
      const ctx = pluginCtx(box.workspace)
      const report = apply(ctx, { stateDir: box.stateDir, teamCacheMs: 0, tickIntervalMs: 3_600_000, warnSilenceMs: 7_200_000 })
      const runtime = ctx.__stub.adapter.toolRuntime()
      const held = (await runtime.execute({ name: HOLD_TOOL, arguments: { team_id: "team-a", task_id: "t1", attempt_id: "att-1" } })) as { applied: boolean }
      expect(held.applied).toBe(true)
      expect(readHold(box.workspace, box.stateDir, "team-a")?.id).toBeDefined()
      const resumed = (await runtime.execute({ name: RESUME_TOOL, arguments: { team_id: "team-a" } })) as { resumed: boolean }
      expect(resumed.resumed).toBe(true)
      const again = (await runtime.execute({ name: RESUME_TOOL, arguments: { team_id: "team-a" } })) as { resumed: boolean; reason: string }
      expect(again.resumed).toBe(false)
      expect(again.reason).toBe("not-held")
      const status = (await runtime.execute({ name: STATUS_TOOL, arguments: {} })) as { workspace: string }
      expect(status.workspace).toBe(box.workspace)
      report.engine?.stop()
      ctx.__dispose()
    } finally {
      box.cleanup()
    }
  })
})
