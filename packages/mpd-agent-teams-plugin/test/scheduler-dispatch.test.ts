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
import { installTeamScheduler } from "../lib/scheduler.js"

const STATE_DIR = ".agent-teams"
const CAPTAIN_ID = "session-captain-1"

interface Delivery { readonly childId: string; readonly text: string }

function makeWorkspace() {
  const dir = mkdtempSync(join(tmpdir(), "mpd-scheduler-dispatch-"))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

function member(name: string, id: string) {
  return { name, id, role: "worker", provider: "deepseek", model: "deepseek-v4", joinedAt: Date.now(), status: "idle" as const }
}

function task(id: string, subject: string, assignee: string, dependencies: string[] = [], status = "pending") {
  return { id, subject, assignee, dependencies, status, createdAt: Date.now(), updatedAt: Date.now() }
}

/** Write one durable team record the scheduler can read back. */
function writeTeam(workspace: string, team: Record<string, unknown>) {
  mkdirSync(join(workspace, STATE_DIR, String(team.id), "inbox"), { recursive: true })
  writeFileSync(join(workspace, STATE_DIR, String(team.id), "team.json"), JSON.stringify(team, null, 2))
}

function readTeamFile(workspace: string, teamId: string) {
  return JSON.parse(require("node:fs").readFileSync(join(workspace, STATE_DIR, teamId, "team.json"), "utf8"))
}

/** One runtime with a captain plus the given idle members, all registry-live. */
function makeCtx(workspace: string, memberIds: string[]) {
  const deliveries: Delivery[] = []
  const warnings: string[] = []
  const handlers = new Map<string, (payload: unknown) => void>()
  const live = new Map<string, unknown>()
  const captain = { id: CAPTAIN_ID, status: "idle", session: { header: { cwd: workspace } } }
  live.set(CAPTAIN_ID, captain)
  for (const id of memberIds) live.set(id, { id, status: "idle", session: { header: { cwd: workspace } } })
  const ctx = {
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

function baseTeam(workspace: string, tasks: unknown[]) {
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
    const ws = makeWorkspace()
    try {
      writeTeam(ws.dir, baseTeam(ws.dir, [
        task("t1", "first cut", "Alpha"),
        task("t2", "second cut", "Bravo", ["t1"]),
      ]))
      const { ctx, captain, deliveries } = makeCtx(ws.dir, ["member-alpha", "member-bravo"])
      const scheduler = installTeamScheduler(ctx, { stateDir: STATE_DIR })

      await scheduler.kickTeam(ws.dir, "team-1", captain)

      expect(deliveries).toHaveLength(1)
      expect(deliveries[0].childId).toBe("member-alpha")
      expect(deliveries[0].text).toContain("AgentTeams automatic task assignment")
      expect(deliveries[0].text).toContain("Task: t1 — first cut")
      // Dependents are not dispatched early.
      expect(deliveries.some((d) => d.childId === "member-bravo")).toBe(false)
      expect(readTeamFile(ws.dir, "team-1").tasks.find((t: { id: string }) => t.id === "t1").status).toBe("claimed")
    } finally {
      ws.cleanup()
    }
  })

  test("completing the first batch dispatches the next batch to its idle members", async () => {
    const ws = makeWorkspace()
    try {
      const team = baseTeam(ws.dir, [
        task("t1", "first cut", "Alpha"),
        task("t2", "second cut", "Bravo", ["t1"]),
      ])
      writeTeam(ws.dir, team)
      const { ctx, captain, deliveries, warnings } = makeCtx(ws.dir, ["member-alpha", "member-bravo"])
      const scheduler = installTeamScheduler(ctx, { stateDir: STATE_DIR })

      await scheduler.kickTeam(ws.dir, "team-1", captain)
      expect(deliveries).toHaveLength(1)

      // Member Alpha finishes t1 (the state write `agent_teams_update_task` does).
      const afterFirst = readTeamFile(ws.dir, "team-1")
      const t1 = afterFirst.tasks.find((t: { id: string }) => t.id === "t1")
      t1.status = "completed"
      t1.output = "the first cut is done"
      t1.updatedAt = Date.now()
      writeTeam(ws.dir, afterFirst)

      await scheduler.kickTeam(ws.dir, "team-1", captain)

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
    const ws = makeWorkspace()
    try {
      writeTeam(ws.dir, baseTeam(ws.dir, [
        task("t1", "first cut", "Alpha", [], "completed"),
        task("t3", "follow-up cut", "Alpha", ["t1"]),
      ]))
      const { ctx, deliveries, handlers, live } = makeCtx(ws.dir, ["member-alpha", "member-bravo"])
      installTeamScheduler(ctx, { stateDir: STATE_DIR })

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
    const ws = makeWorkspace()
    try {
      writeTeam(ws.dir, baseTeam(ws.dir, [task("t1", "first cut", "Alpha")]))
      const { ctx, captain, warnings } = makeCtx(ws.dir, ["member-alpha", "member-bravo"])
      // A host that cannot accept the turn must leave the task claimable.
      ctx.subagents = {}
      const scheduler = installTeamScheduler(ctx, { stateDir: STATE_DIR })

      await scheduler.kickTeam(ws.dir, "team-1", captain)

      expect(warnings.join("\n")).toContain("delivery failed")
      const t1 = readTeamFile(ws.dir, "team-1").tasks.find((t: { id: string }) => t.id === "t1")
      expect(t1.status).toBe("pending")
      expect(t1.assignee).toBe("Alpha")
    } finally {
      ws.cleanup()
    }
  })
})
