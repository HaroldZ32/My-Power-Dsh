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
import { ackIncidents, appendIncident, readHold, readIncidents, readWatermarks, unacknowledged, writeHold, type HoldRecord } from "../src/sidecars"
import { join } from "node:path"
import { pluginCtx, sandbox, teamViews, writeTeam } from "./support"

describe("the hold sidecar", () => {
  test("lives in the watchdog's own tree and never changes the live team readout", () => {
    // An isolated workspace for this case.
    const box = sandbox()
    try {
      // The live readout before the hold, compared byte-for-byte at the end.
      const teamView = writeTeam(box, {
        id: "team-a",
        members: [{ id: "a1", name: "Architect" }],
        tasks: [{ id: "t1", status: "in_progress", assignee: "Architect", attemptId: "att-1" }],
      })
      // The hold action's outcome, whose path must stay inside the watchdog tree.
      const applied = applyHold(box.workspace, box.stateDir, { team_id: "team-a", task_id: "t1", attempt_id: "1", cause: "silence", scene_at: 7 })
      expect(applied.applied).toBe(true)
      expect(existsSync(applied.path)).toBe(true)
      expect(applied.path.startsWith(box.workspace)).toBe(true)
      expect(applied.path.startsWith(join(box.workspace, box.stateDir, "watchdog"))).toBe(true)
      // The hold read back from disk.
      const hold = readHold(box.workspace, box.stateDir, "team-a")
      expect(hold?.taskId).toBe("t1")
      expect(hold?.attemptId).toBe("1")
      expect(hold?.sceneAt).toBe(7)
      // The team readout is the harness's and this package owns no part of it: it is unchanged.
      expect(teamViews(box)).toEqual([teamView])
    } finally {
      box.cleanup()
    }
  })

  test("is idempotent by id: a second identical write changes no bytes", () => {
    // An isolated workspace for this case.
    const box = sandbox()
    try {
      // The same hold record written twice, to prove byte-idempotence.
      // T-17: it carries the resolved `holdTtlMs` (900_000), the bound every plugin-written hold has.
      const hold: HoldRecord = { id: "h1", teamId: "team-a", since: 1, cause: "silence", taskId: "t1", attemptId: "att-1", sceneAt: 2, ttlMs: 900_000 }
      // The first write, which must report a change.
      const first = writeHold(box.workspace, box.stateDir, hold)
      // The second write of identical bytes, which must report no change.
      const second = writeHold(box.workspace, box.stateDir, hold)
      expect(first.changed).toBe(true)
      expect(second.changed).toBe(false)
      expect(second.ok).toBe(true)
    } finally {
      box.cleanup()
    }
  })

  test("re-applying a hold keeps the original id and since (the hold is not restarted)", () => {
    // An isolated workspace for this case.
    const box = sandbox()
    try {
      // The first hold, whose id and start time must survive the re-apply.
      const first = applyHold(box.workspace, box.stateDir, { team_id: "team-a", cause: "silence" })
      // The re-applied hold, which must keep the original identity.
      const second = applyHold(box.workspace, box.stateDir, { team_id: "team-a", cause: "silence" })
      expect(second.hold?.id).toBe(first.hold?.id)
      expect(second.hold?.since).toBe(first.hold?.since)
    } finally {
      box.cleanup()
    }
  })

  test("a resume of a non-held team is a no-op, and a second resume is a no-op", () => {
    // An isolated workspace for this case.
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
    // An isolated workspace for this case.
    const box = sandbox()
    try {
      // The refusal a hold without a team id must return.
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
    // An isolated workspace for this case.
    const box = sandbox()
    try {
      // The incident fields shared by the two records appended below.
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
      // The acknowledgement that moves the reader's watermark up to 200.
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

  test("a NON-FINITE upTo is REFUSED, never persisted as null", () => {
    // THE DEFECT THIS PINS (T6): `Math.max(current[reader] ?? 0, NaN)` is NaN, and
    // `JSON.stringify` renders NaN as `null`. The next read coalesces `null` back to 0, so the
    // reader silently replayed from zero — a no-op that looks exactly like a successful ack.
    // An Infinity is refused for the same reason: it is not a watermark any incident can carry.
    /** An isolated workspace for this case. */
    const box = sandbox()
    try {
      appendIncident(box.workspace, box.stateDir, {
        id: "i1", at: 100, teamId: "team-a", kind: "warn",
        cause: { kind: "silence", ms: 90_001 }, taskId: "t1", attemptId: "att-1",
        scene: null, hold: "not-requested", acknowledgedBy: [],
      })
      /** The refusal for a NaN watermark. */
      const nan = ackIncidents(box.workspace, box.stateDir, "web", Number.NaN)
      expect(nan.ok).toBe(false)
      expect(String(nan.error)).toContain("finite")
      // NOTHING was written: the document must not carry the `null` a NaN would serialize to.
      expect(readWatermarks(box.workspace, box.stateDir)).toEqual({})
      /** The watermark document as it stands on disk, or "" when the refusal wrote no file at all. */
      const doc = existsSync(join(box.workspace, box.stateDir, "watchdog", "read-watermark.json"))
        ? readFileSync(join(box.workspace, box.stateDir, "watchdog", "read-watermark.json"), "utf8")
        : ""
      expect(doc).not.toContain("null")
      // The replay is unchanged: a refused ack never silently rewinds a reader.
      expect(unacknowledged(box.workspace, box.stateDir, "web").length).toBe(1)
      /** The refusal for an infinite watermark. */
      const infinite = ackIncidents(box.workspace, box.stateDir, "web", Number.POSITIVE_INFINITY)
      expect(infinite.ok).toBe(false)
      expect(readWatermarks(box.workspace, box.stateDir)).toEqual({})
      // The falsifier: a FINITE ack still lands, so the guard is not a blanket refusal.
      expect(ackIncidents(box.workspace, box.stateDir, "web", 100).ok).toBe(true)
      expect(readWatermarks(box.workspace, box.stateDir)).toEqual({ web: 100 })
    } finally {
      box.cleanup()
    }
  })
})

describe("the plugin's own actions", () => {
  test("apply() registers exactly the three actions on the adapter", () => {
    // An isolated workspace for this case.
    const box = sandbox()
    try {
      // The plugin context whose adapter records every registration.
      const ctx = pluginCtx(box.workspace)
      // The apply report; this case asserts which tools it registered.
      const report = apply(ctx, { stateDir: box.stateDir, teamCacheMs: 0, tickIntervalMs: 3_600_000, warnSilenceMs: 7_200_000 })
      expect(report.applied).toBe(true)
      // The stub adapter, whose tool map holds what `apply` registered.
      const stub = ctx.__stub
      expect([...stub.tools.keys()].sort()).toEqual([HOLD_TOOL, RESUME_TOOL, STATUS_TOOL].sort())
      report.engine?.stop()
      ctx.__dispose()
    } finally {
      box.cleanup()
    }
  })

  test("the hold and resume actions are reachable through the adapter's internal tool seam", async () => {
    // An isolated workspace for this case.
    const box = sandbox()
    try {
      // The plugin context whose adapter exposes the internal tool runtime.
      const ctx = pluginCtx(box.workspace)
      // The apply report; its engine is stopped at the end of the case.
      const report = apply(ctx, { stateDir: box.stateDir, teamCacheMs: 0, tickIntervalMs: 3_600_000, warnSilenceMs: 7_200_000 })
      // The internal tool seam the actions must be reachable through.
      const runtime = ctx.__stub.adapter.toolRuntime()
      // The hold result, its shape asserted because the tool seam answers an unknown value.
      const held = (await runtime.execute({ name: HOLD_TOOL, arguments: { team_id: "team-a", task_id: "t1", attempt_id: "att-1" } })) as { applied: boolean }
      expect(held.applied).toBe(true)
      expect(readHold(box.workspace, box.stateDir, "team-a")?.id).toBeDefined()
      // The resume result, shape-asserted for the same reason.
      const resumed = (await runtime.execute({ name: RESUME_TOOL, arguments: { team_id: "team-a" } })) as { resumed: boolean }
      expect(resumed.resumed).toBe(true)
      // The second resume, which must be the not-held no-op.
      const again = (await runtime.execute({ name: RESUME_TOOL, arguments: { team_id: "team-a" } })) as { resumed: boolean; reason: string }
      expect(again.resumed).toBe(false)
      expect(again.reason).toBe("not-held")
      // The status result, shape-asserted for the same reason.
      const status = (await runtime.execute({ name: STATUS_TOOL, arguments: {} })) as { workspace: string }
      expect(status.workspace).toBe(box.workspace)
      report.engine?.stop()
      ctx.__dispose()
    } finally {
      box.cleanup()
    }
  })
})
