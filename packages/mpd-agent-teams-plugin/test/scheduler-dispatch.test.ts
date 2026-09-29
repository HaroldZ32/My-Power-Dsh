// Proves the shared-task scheduler actually wakes the NEXT member after the
// first batch completes — the behaviour a stalled team loses.
//
// Regression this locks (live 2026-09-10, team "workmate-rename-delete"): the
// first batch ran, then t3/t4/t5 (whose only dependency had completed) were
// never delivered. The members' sessions show the spawn prompt and nothing
// else, and the captain's `agent_teams_send_message` results all read
// "delivered via mailbox" — i.e. every wakeup failed inside deliverToMember
// because the host has no `ctx.subagents.followup`.
//
// The runtime here is the real 0.1.5-rc.2 shape (the public
// `ctx.subagents.prompt(request, signal)` seam, no followup), so this test fails
// on the pre-fix delivery path.
import { describe, expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
// The vendored module now resolves to its .ts source, so this surface is typed from that file.
import { installTeamScheduler } from "../lib/scheduler.ts"

/** State root the scheduler reads every fixture team from, relative to the workspace cwd. */
const STATE_DIR = ".agent-teams"
/** Session id the fixture registers as the captain, so the scheduler's live lookup can find it. */
const CAPTAIN_ID = "session-captain-1"

/** One member turn the fixture's prompt seam accepted, and what it carried. */
interface Delivery {
  /** Child session the turn was addressed to. */
  readonly childId: string
  /** Joined text of the turn; the assignment wording is asserted through it. */
  readonly text: string
}

/** One persisted member row, naming only the fields the scheduler reads back. */
type MemberRecord = {
  /** Roster name the task assignee is matched against. */
  name: string
  /** Session id the registry lookup resolves. */
  id: string
  /** Roster role, carried through from the fixture. */
  role: string
  /** Provider the member was spawned with. */
  provider: string
  /** Model the member was spawned with. */
  model: string
  /** Epoch ms the member joined. */
  joinedAt: number
  /** Liveness status; `idle` is what the member's dispatch edge waits for. */
  status: "idle"
}

/** One persisted task row; `output` carries the result the dependent batch receives. */
type TaskRecord = {
  /** Task id the assignment text and the dependencies refer to. */
  id: string
  /** Human-facing subject, echoed into the assignment text. */
  subject: string
  /** Roster name of the assignee. */
  assignee: string
  /** Ids of the tasks that must complete before this one may be dispatched. */
  dependencies: string[]
  /** Lifecycle status; only `pending` tasks are dispatched. */
  status: string
  /** Epoch ms the task was created. */
  createdAt: number
  /** Epoch ms the task last changed; the claim path rewrites it. */
  updatedAt: number
  /** Result the completed dependency contributes to the dependent's assignment. */
  output?: string
}

/** The plugin-context seams `installTeamScheduler` reads, each recorded by this fixture. */
type SchedulerCtx = {
  /** Agent-registry seam the scheduler resolves members and the captain through. */
  agents: { get: (id: string) => unknown }
  /** Logger seam; warnings are collected so an arm can assert the failure path. */
  logger: { warn: (...args: unknown[]) => void }
  /** Event seam; handlers are captured so an arm can fire `agent/status` itself. */
  on: (name: string, handler: (payload: unknown) => void) => () => boolean
  /** Delivery seam; `prompt` is ABSENT on the arm proving a real failure is reported. */
  subagents: { prompt?: (request: { childSessionId: string; content: { text: string }[] }) => Promise<{ messageId: string }> }
}

/** Temp workspace plus its teardown, so every arm cleans up the state root it wrote. */
function makeWorkspace(): { dir: string; cleanup: () => void } {
  /** Fresh temp directory standing in for the session workspace. */
  const dir = mkdtempSync(join(tmpdir(), "mpd-scheduler-dispatch-"))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

/** One roster member row the fixture team lists; the scheduler matches it by name. */
function member(name: string, id: string): MemberRecord {
  return { name, id, role: "worker", provider: "deepseek", model: "deepseek-v4", joinedAt: Date.now(), status: "idle" as const }
}

/** One task row in the fixture team; `dependencies` defaults to none and `status` to pending. */
function task(id: string, subject: string, assignee: string, dependencies: string[] = [], status: string = "pending"): TaskRecord {
  return { id, subject, assignee, dependencies, status, createdAt: Date.now(), updatedAt: Date.now() }
}

/** Write one durable team record the scheduler can read back. */
function writeTeam(workspace: string, team: Record<string, unknown>): void {
  mkdirSync(join(workspace, STATE_DIR, String(team.id), "inbox"), { recursive: true })
  writeFileSync(join(workspace, STATE_DIR, String(team.id), "team.json"), JSON.stringify(team, null, 2))
}

/** Re-read the durable team record a round trip just wrote, naming the tasks the arms inspect. */
function readTeamFile(workspace: string, teamId: string): { tasks: TaskRecord[] } {
  return JSON.parse(require("node:fs").readFileSync(join(workspace, STATE_DIR, teamId, "team.json"), "utf8"))
}

/** One runtime with a captain plus the given idle members, all registry-live. */
function makeCtx(workspace: string, memberIds: string[]): { ctx: SchedulerCtx; captain: { id: string; status: string; session: { header: { cwd: string } } }; deliveries: Delivery[]; warnings: string[]; handlers: Map<string, (payload: unknown) => void>; live: Map<string, unknown> } {
  /** Member turns the delivery seam accepted, in order. */
  const deliveries: Delivery[] = []
  /** Logger output, joined by the arms to assert both the failure and the clean path. */
  const warnings: string[] = []
  /** Registered event handlers by name, so an arm can fire `agent/status` itself. */
  const handlers = new Map<string, (payload: unknown) => void>()
  /** Registry of live sessions the scheduler resolves member ids against. */
  const live = new Map<string, unknown>()
  /** The captain session the scheduler receives as the requesting session. */
  const captain = { id: CAPTAIN_ID, status: "idle", session: { header: { cwd: workspace } } }
  live.set(CAPTAIN_ID, captain)
  for (const id of memberIds) live.set(id, { id, status: "idle", session: { header: { cwd: workspace } } })
  /** The fixture context; one arm replaces its `subagents` seam with an empty host. */
  const ctx: SchedulerCtx = {
    agents: { get: (id: string) => live.get(id) },
    logger: { warn: (...args: unknown[]) => { warnings.push(args.map(String).join(" ")) } },
    on: (name: string, cb: (payload: unknown) => void) => { handlers.set(name, cb); return () => handlers.delete(name) },
    subagents: {
      prompt: async (request: { childSessionId: string; content: { text: string }[] }) => {
        deliveries.push({ childId: request.childSessionId, text: request.content.map((block) => block.text).join("") })
        return { messageId: "message-1" }
      },
    },
  }
  return { ctx, captain, deliveries, warnings, handlers, live }
}

/** The fixture team record: a captain, two members, and whatever tasks the arm supplies. */
function baseTeam(workspace: string, tasks: unknown[]): { id: string; name: string; description: string; captainSessionId: string; createdAt: number; approvedAt: number; phase: string; taskSeq: number; members: MemberRecord[]; tasks: unknown[] } {
  return {
    id: "team-1",
    name: "Team One",
    description: "dispatch regression fixture",
    captainSessionId: CAPTAIN_ID,
    createdAt: Date.now(),
    approvedAt: Date.now(),
    phase: "running",
    taskSeq: tasks.length,
    members: [member("Alpha", "member-alpha"), member("Bravo", "member-bravo")],
    tasks,
  }
}

describe("scheduler dispatch across a dependency boundary", () => {
  test("the first batch is delivered and dependents stay parked", async () => {
    /** Temp workspace holding the fixture team record. */
    const ws = makeWorkspace()
    try {
      writeTeam(ws.dir, baseTeam(ws.dir, [
        task("t1", "first cut", "Alpha"),
        task("t2", "second cut", "Bravo", ["t1"]),
      ]))
      /** Fixture context, its captain, and the member turns the scheduler delivered. */
      const { ctx, captain, deliveries } = makeCtx(ws.dir, ["member-alpha", "member-bravo"])
      /** The installed scheduler, kicked by hand so the arm needs no live team. */
      const scheduler = installTeamScheduler(ctx, { stateDir: STATE_DIR })

      await scheduler.kickTeam(ws.dir, "team-1", captain)

      expect(deliveries).toHaveLength(1)
      expect(deliveries[0].childId).toBe("member-alpha")
      expect(deliveries[0].text).toContain("AgentTeams automatic task assignment")
      expect(deliveries[0].text).toContain("Task: t1 — first cut")
      // Dependents are not dispatched early.
      expect(deliveries.some((d) => d.childId === "member-bravo")).toBe(false)
      // The fixture writes exactly one task with this id, so the lookup cannot miss.
      expect(readTeamFile(ws.dir, "team-1").tasks.find((t: { id: string }) => t.id === "t1")!.status).toBe("claimed")
    } finally {
      ws.cleanup()
    }
  })

  test("completing the first batch dispatches the next batch to its idle members", async () => {
    /** Temp workspace holding the fixture team record. */
    const ws = makeWorkspace()
    try {
      /** The fixture team both kicks share, so the second kick sees the first one's write. */
      const team = baseTeam(ws.dir, [
        task("t1", "first cut", "Alpha"),
        task("t2", "second cut", "Bravo", ["t1"]),
      ])
      writeTeam(ws.dir, team)
      /** Fixture context, its captain, the delivered turns, and the logger output. */
      const { ctx, captain, deliveries, warnings } = makeCtx(ws.dir, ["member-alpha", "member-bravo"])
      /** The installed scheduler, kicked by hand so the arm needs no live team. */
      const scheduler = installTeamScheduler(ctx, { stateDir: STATE_DIR })

      await scheduler.kickTeam(ws.dir, "team-1", captain)
      expect(deliveries).toHaveLength(1)

      // Member Alpha finishes t1 (the state write `agent_teams_update_task` does).
      const afterFirst = readTeamFile(ws.dir, "team-1")
      // The fixture writes exactly one task with this id, so the lookup cannot miss.
      const t1 = afterFirst.tasks.find((t: { id: string }) => t.id === "t1")!
      t1.status = "completed"
      t1.output = "the first cut is done"
      t1.updatedAt = Date.now()
      writeTeam(ws.dir, afterFirst)

      await scheduler.kickTeam(ws.dir, "team-1", captain)

      /** The turns the second kick delivered to the dependent member. */
      const second = deliveries.filter((d) => d.childId === "member-bravo")
      expect(second).toHaveLength(1)
      expect(second[0].text).toContain("Task: t2 — second cut")
      // The completed dependency's result rides along with the assignment.
      expect(second[0].text).toContain("the first cut is done")
      expect(warnings.join("\n")).not.toContain("delivery failed")
    } finally {
      ws.cleanup()
    }
  })

  test("a member's idle edge delivers its own newly unblocked task", async () => {
    /** Temp workspace holding the fixture team record. */
    const ws = makeWorkspace()
    try {
      writeTeam(ws.dir, baseTeam(ws.dir, [
        task("t1", "first cut", "Alpha", [], "completed"),
        task("t3", "follow-up cut", "Alpha", ["t1"]),
      ]))
      /** Fixture context, the delivered turns, its captured handlers and its live registry. */
      const { ctx, deliveries, handlers, live } = makeCtx(ws.dir, ["member-alpha", "member-bravo"])
      installTeamScheduler(ctx, { stateDir: STATE_DIR })

      /** The registered idle edge, driven directly so the arm needs no host. */
      const idle = handlers.get("agent/status")
      expect(idle).toBeDefined()
      idle?.({ agent: live.get("member-alpha"), status: "idle" })
      // syncMemberStatus is async; yield until its kick settles.
      for (let i = 0; i < 50 && deliveries.length === 0; i++) await new Promise((resolve) => setTimeout(resolve, 5))

      expect(deliveries).toHaveLength(1)
      expect(deliveries[0].childId).toBe("member-alpha")
      expect(deliveries[0].text).toContain("Task: t3 — follow-up cut")
    } finally {
      ws.cleanup()
    }
  })

  test("a real delivery failure is reported, not swallowed as success", async () => {
    /** Temp workspace holding the fixture team record. */
    const ws = makeWorkspace()
    try {
      writeTeam(ws.dir, baseTeam(ws.dir, [task("t1", "first cut", "Alpha")]))
      /** Fixture context, its captain, and the logger output the arm asserts on. */
      const { ctx, captain, warnings } = makeCtx(ws.dir, ["member-alpha", "member-bravo"])
      // A host that cannot accept the turn must leave the task claimable.
      ctx.subagents = {}
      /** The installed scheduler, kicked by hand so the arm needs no live team. */
      const scheduler = installTeamScheduler(ctx, { stateDir: STATE_DIR })

      await scheduler.kickTeam(ws.dir, "team-1", captain)

      expect(warnings.join("\n")).toContain("delivery failed")
      // The fixture writes exactly one task with this id, so the lookup cannot miss.
      const t1 = readTeamFile(ws.dir, "team-1").tasks.find((t: { id: string }) => t.id === "t1")!
      expect(t1.status).toBe("pending")
      expect(t1.assignee).toBe("Alpha")
    } finally {
      ws.cleanup()
    }
  })
})
