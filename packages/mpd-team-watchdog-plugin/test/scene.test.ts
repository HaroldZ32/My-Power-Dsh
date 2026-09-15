// The scene snapshot: the AC-5 field set, atomicity/idempotence, and the loud
// degradation of an unwritable scene location.
import { describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { WatchdogEngine } from "../src/engine"
import { buildScene, isoBasic, mailboxUnread, readScene, writeScene } from "../src/scene"
import { readHold, readIncidents } from "../src/sidecars"
import { readHeartbeats } from "../src/store"
import { readTeam } from "../src/team"
import { agent, sandbox, stubAdapter, testConfig, writeTeam } from "./support"

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
      const team = readTeam(box.workspace, box.stateDir, "team-a")
      expect(team).toBeDefined()
      const scene = buildScene({
        team: team!,
        reason: "escalate",
        at: 1_700_000_000_000,
        silenceMs: 120_000,
        hold: { id: "h1", teamId: "team-a", since: 1, cause: "silence", taskId: "t1", attemptId: "att-1", sceneAt: 1_700_000_000_000 },
        mailbox: { web: 12 },
        incidents: [],
        streaks: { "t1\u0000att-1": 3 },
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
      expect(scene.tasks[0]).toEqual({ id: "t1", status: "in_progress", assignee: "Architect", attempt: 2, attemptId: "att-1", lastSeen: null, streak: 3 })
      expect(scene.members[0]).toEqual({ id: "a1", name: "Architect", status: "working", unread: 2, currentTask: "t1", lastSeen: null })
      expect(scene.mailbox).toEqual({ web: 12 })
      expect(scene.parkedAttempts).toEqual({ a1: "att-1" })
    } finally {
      box.cleanup()
    }
  })

  test("a halted team's adopted flags are carried verbatim beside the watchdog's own hold", () => {
    const box = sandbox()
    try {
      writeTeam(box, {
        id: "team-a",
        halted: true,
        haltedAt: 42,
        members: [],
        tasks: [],
      })
      const team = readTeam(box.workspace, box.stateDir, "team-a")!
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
      expect(scene.team.halted).toBe(true)
      expect(scene.team.haltedAt).toBe(42)
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

  test("mailboxUnread mirrors the adopted predicate (tombstones and read records are not unread)", () => {
    const box = sandbox()
    try {
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
      expect(mailboxUnread(box.workspace, box.stateDir, "team-a", "Architect", 1_010)).toBe(1)
      // The claim lease expires: m4 becomes unread again (the adopted rule).
      expect(mailboxUnread(box.workspace, box.stateDir, "team-a", "Architect", 200_000)).toBe(2)
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
      engine.stamp("step", agent("a1", box.workspace))
      const from = readHeartbeats(box.workspace, box.stateDir, "Architect")[0].at

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
