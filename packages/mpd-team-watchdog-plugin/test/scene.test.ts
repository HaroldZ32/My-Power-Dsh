// The scene snapshot: the AC-5 field set, atomicity/idempotence, and the loud
// degradation of an unwritable scene location.
import { describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { WatchdogEngine } from "../src/engine"
import { buildScene, isoBasic, mailboxUnreadObservable, readScene, writeScene } from "../src/scene"
import { readHold, readIncidents } from "../src/sidecars"
import { readHeartbeats } from "../src/store"

import { agent, sandbox, stubAdapter, teamRecordOf, testConfig, writeTeam, openOutstandingChannel } from "./support"

function stubCtx(): { on: (event: string, handler: (...args: any[]) => unknown) => () => void } {
  return { on: () => () => {} }
}

describe("the scene document", () => {
  test("carries exactly the AC-5 field set", () => {
    const box = sandbox()
    try {
      writeTeam(box, {
        id: "team-a",
        name: "Team A",
        phase: "running",
        captainSessionId: "sess-cap",
        members: [{ id: "a1", name: "Architect", status: "working" }],
        tasks: [{ id: "t1", status: "in_progress", assignee: "Architect", attempt: 2, attemptId: "att-1" }],
      })
      const team = teamRecordOf(box, "team-a")
      expect(team).toBeDefined()
      const scene = buildScene({
        team: team!,
        reason: "escalate",
        at: 1_700_000_000_000,
        silenceMs: 120_000,
        hold: { id: "h1", teamId: "team-a", since: 1, cause: "silence", taskId: "t1", attemptId: "att-1", sceneAt: 1_700_000_000_000 },
        mailbox: { web: 12 },
        incidents: [],
        // The streak map is keyed by `streakKey(teamId, taskId, attemptId)` — the team id is
        // part of the key because task ids are per-team (w11/W11-1). 0.1.7: the generation token
        // is the projected official board REVISION, so the key says `2` for a task at revision 2.
        streaks: { "team-a\u0000t1\u00002": 3 },
        heartbeat: () => [],
        unread: () => 2,
      })
      expect(Object.keys(scene).sort()).toEqual(
        ["at", "cause", "incidents", "mailbox", "members", "parkedAttempts", "reason", "schemaVersion", "tasks", "team"].sort(),
      )
      expect(scene.schemaVersion).toBe(1)
      expect(scene.cause).toEqual({ kind: "silence", ms: 120_000 })
      expect(Object.keys(scene.team).sort()).toEqual(["halted", "haltedAt", "hold", "id", "name", "phase"].sort())
      expect(scene.team.hold?.id).toBe("h1")
      expect(scene.tasks[0]).toEqual({ id: "t1", status: "in_progress", assignee: "Architect", attempt: 2, attemptId: "2", lastSeen: null, streak: 3 })
      expect(scene.members[0]).toEqual({ id: "a1", name: "Architect", status: "working", unread: 2, currentTask: "t1", lastSeen: null })
      expect(scene.mailbox).toEqual({ web: 12 })
      expect(scene.parkedAttempts).toEqual({ a1: "2" })
    } finally {
      box.cleanup()
    }
  })

  test("the halt flags have NO official source, so the scene carries null (never a fabricated pause)", () => {
    const box = sandbox()
    try {
      // A fixture that CLAIMS a halt cannot make the projection carry one: the official readout
      // (`dsh.teamLiveTeams()`) has no `halted`/`haltedAt` field at all, so the projection leaves
      // both absent and the scene reports `null` — the honest answer, and the one that keeps the
      // status surface from naming a pause mechanism the official plane does not have.
      writeTeam(box, {
        id: "team-a",
        halted: true,
        haltedAt: 42,
        members: [],
        tasks: [],
      })
      const team = teamRecordOf(box, "team-a")!
      const scene = buildScene({
        team,
        reason: "warn",
        at: 10,
        silenceMs: 1,
        hold: null,
        mailbox: {},
        incidents: [],
        streaks: {},
        heartbeat: () => [],
        unread: () => null,
      })
      expect(scene.team.halted).toBe(null)
      expect(scene.team.haltedAt).toBe(null)
      expect(scene.team.hold).toBe(null)
    } finally {
      box.cleanup()
    }
  })

  test("write -> read round-trips byte-identically and a second identical write changes no bytes", () => {
    const box = sandbox()
    try {
      const scene = buildScene({
        team: { id: "team-a", name: "Team A", members: [], tasks: [], raw: {} },
        reason: "warn",
        at: 1_700_000_000_000,
        silenceMs: 5,
        hold: null,
        mailbox: {},
        incidents: [],
        streaks: {},
        heartbeat: () => [],
        unread: () => null,
      })
      const first = writeScene(box.workspace, box.stateDir, "team-a", scene, scene.at)
      expect(first.ok).toBe(true)
      const before = readFileSync(first.path!, "utf8")
      expect(JSON.parse(before).reason).toBe("warn")
      expect(readScene(first.latestPath!)?.at).toBe(scene.at)

      const latestBefore = readFileSync(first.latestPath!, "utf8")
      const mtimeBefore = statSync(first.latestPath!).mtimeMs
      const again = writeScene(box.workspace, box.stateDir, "team-a", scene, scene.at)
      expect(again.ok).toBe(true)
      expect(readFileSync(again.latestPath!, "utf8")).toBe(latestBefore)
      expect(statSync(again.latestPath!).mtimeMs).toBe(mtimeBefore)
    } finally {
      box.cleanup()
    }
  })

  test("a scene file name is unique per incident even inside one millisecond", () => {
    const box = sandbox()
    try {
      const scene = buildScene({
        team: { id: "team-a", name: "Team A", members: [], tasks: [], raw: {} },
        reason: "warn",
        at: 1_700_000_000_000,
        silenceMs: 5,
        hold: null,
        mailbox: {},
        incidents: [],
        streaks: {},
        heartbeat: () => [],
        unread: () => null,
      })
      const a = writeScene(box.workspace, box.stateDir, "team-a", scene, scene.at)
      const b = writeScene(box.workspace, box.stateDir, "team-a", scene, scene.at)
      expect(a.path).not.toBe(b.path)
      expect(existsSync(a.path!)).toBe(true)
      expect(existsSync(b.path!)).toBe(true)
    } finally {
      box.cleanup()
    }
  })

  test("isoBasic is a file-safe timestamp", () => {
    expect(isoBasic(Date.UTC(2026, 8, 15, 15, 41, 32))).toBe("20260915T154132Z")
  })

  test("the member unread count is UNOBSERVABLE on the official plane (null, never a fabricated 0)", () => {
    const box = sandbox()
    try {
      // The reader that used to mirror the retired plugin's `<teamDir>/inbox/*.jsonl` is gone with
      // the plugin that wrote that file, and no adapter seam reports a per-member unread count.
      // A file left behind by an old install must NOT resurrect the old answer.
      const dir = join(box.workspace, box.stateDir, "team-a", "inbox")
      mkdirSync(dir, { recursive: true })
      writeFileSync(
        join(dir, "architect.jsonl"),
        [
          JSON.stringify({ id: "m1" }),
          JSON.stringify({ id: "m2", readAt: 5 }),
          JSON.stringify({ id: "m3", tombstone: true }),
          JSON.stringify({ id: "m4", deliveryClaimedAt: 1_000 }),
        ].join("\n") + "\n",
      )
      expect(mailboxUnreadObservable()).toBeNull()
    } finally {
      box.cleanup()
    }
  })
})

describe("an unwritable scene location", () => {
  test("degrades LOUDLY, still attempts the hold and still records the incident", async () => {
    const box = sandbox()
    const warnings: string[] = []
    const originalWarn = console.warn
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(" "))
    }
    try {
      writeTeam(box, {
        id: "team-a",
        members: [{ id: "a1", name: "Architect" }],
        tasks: [{ id: "t1", status: "in_progress", assignee: "Architect", attemptId: "att-1" }],
      })
      // Occupy the scene directory's place with a FILE: mkdir then fails ENOTDIR.
      const sceneRoot = join(box.workspace, box.stateDir, "watchdog")
      mkdirSync(sceneRoot, { recursive: true })
      writeFileSync(join(sceneRoot, "scene"), "not a directory\n")

      const stub = stubAdapter({ workspace: box.workspace })
      const engine = new WatchdogEngine(stub.adapter, stubCtx(), testConfig({ stateDir: box.stateDir }))
      engine.install()
      engine.stamp("step", agent("a1", box.workspace))
      const from = readHeartbeats(box.workspace, box.stateDir, "Architect")[0].at
      // The §1 channel authority: an open step with NO committed answer is OUTSTANDING, the
      // only state the §3 ladder may warn/escalate from (contract §1).
      openOutstandingChannel(stub, "a1", from)

      const result = await engine.tickOnce(from + 90_001)
      expect(result.decisions.map((d) => d.type)).toEqual(["warn"])
      expect(engine.getStats().sceneFailures).toBe(1)
      expect(engine.getStats().incidents).toBe(1)

      // The hold was still attempted on ESCALATE even with the scene broken.
      const escalated = await engine.tickOnce(from + 90_002)
      const held = await engine.tickOnce(from + 90_003)
      expect(escalated.decisions.map((d) => d.type)).toEqual(["warn"])
      expect(held.decisions.map((d) => d.type)).toEqual(["escalate"])
      expect(readHold(box.workspace, box.stateDir, "team-a")).toBeDefined()

      const named = warnings.find((line) => line.includes("scene write failed at"))
      expect(named).toBeDefined()
      expect(readIncidents(box.workspace, box.stateDir).length).toBe(3)
    } finally {
      console.warn = originalWarn
      box.cleanup()
    }
  })

  test("writeScene returns ok:false instead of throwing", () => {
    const box = sandbox()
    try {
      const sceneRoot = join(box.workspace, box.stateDir, "watchdog")
      mkdirSync(sceneRoot, { recursive: true })
      writeFileSync(join(sceneRoot, "scene"), "not a directory\n")
      const scene = buildScene({
        team: { id: "team-a", name: "Team A", members: [], tasks: [], raw: {} },
        reason: "warn",
        at: 1,
        silenceMs: 1,
        hold: null,
        mailbox: {},
        incidents: [],
        streaks: {},
        heartbeat: () => [],
        unread: () => null,
      })
      const written = writeScene(box.workspace, box.stateDir, "team-a", scene, scene.at)
      expect(written.ok).toBe(false)
      expect(typeof written.error).toBe("string")
      expect(written.path).toBe(null)
    } finally {
      box.cleanup()
    }
  })
})
