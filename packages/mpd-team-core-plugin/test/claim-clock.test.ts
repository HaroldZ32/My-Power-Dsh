// S8 / AC8 — a CLAIM STARTS A FRESH ACTIVITY CLOCK.
//
// The defect (D6): `agent_teams_task {action:"claim"}` had no terminal-state guard and `updateTeamTask`
// keeps the ORIGINAL `startedAt` on a reopen, so a re-claimed old row revived a day-old instant and the
// watchdog's force rule saw an ancient row on its very next tick. S1 moved the trigger to SILENCE, and
// this arm pins the complementary half: the claim itself must stamp ITS OWN clock, so no stale baseline
// is inherited by anything that reads `startedAt` (the opt-in age ceiling included).
import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { apply } from "../src/index"
import { createTeam, readTeam, writeTeam, type TeamRecord } from "../src/team-store"

/** The captain session that owns the staged team. */
const LEAD = "sess-claim-lead"
/** The sandboxes this file created, removed after every arm. */
const sandboxes: string[] = []
afterEach(() => { for (const dir of sandboxes.splice(0)) rmSync(dir, { recursive: true, force: true }) })

/** One registered tool, as the stub adapter captured it. */
interface Tool {
  /** The tool's name. */
  name: string
  /** Its handler, which an arm calls directly. */
  execute: (args: unknown, exec: unknown) => Promise<unknown>
}

/** Mount the row over a sandbox and answer the `agent_teams_task` handler. */
function mount(): { workspace: string; call: (args: unknown) => Promise<unknown> } {
  /** The sandbox workspace the stores write into. */
  const workspace = mkdtempSync(join(tmpdir(), "mpd-claim-clock-"))
  sandboxes.push(workspace)
  /** The registered tools, by name. */
  const tools = new Map<string, Tool>()
  /** The stub adapter: registration, the workspace root and nothing else this arm reaches. */
  const dsh = {
    registerTool: (definition: Tool) => { tools.set(definition.name, definition); return () => {} },
    registerCommand: () => () => {},
    workspaceRoot: () => workspace,
    onEvent: () => () => {},
    teamExecutor: () => ({ send: async (): Promise<string> => "msg-1" }),
    teamListMembers: () => [],
    teamListTasks: () => [],
    capabilities: () => ({}),
  }
  /** The minimal cordis context `apply` needs. */
  const ctx = {
    get: (id: string) => (id === "mpdDsh" ? dsh : undefined),
    on: () => {},
    effect: (fn: () => unknown) => { try { return fn() ?? (() => {}) } catch { return () => {} } },
    provide: () => {},
    inject: () => {},
  }
  apply(ctx as never)
  return {
    workspace,
    call: async (args: unknown): Promise<unknown> => {
      /** The task tool the row registered. */
      const tool = tools.get("agent_teams_task")
      if (tool === undefined) throw new Error(`no agent_teams_task (have ${[...tools.keys()].join(", ")})`)
      return tool.execute(args, { agent: { session: { id: LEAD } }, signal: undefined })
    },
  }
}

describe("S8 — claim starts a fresh clock", () => {
  test("AC8: claiming a row whose startedAt is a DAY old stamps the CLAIM's instant, not the old one", async () => {
    // The mounted row.
    const box = mount()
    // The team, approved and bound to the lead session.
    /** The freshly created record. */
    const created = createTeam(box.workspace, { teamId: "team-claim", name: "claim", description: "claim clock", leadSessionId: LEAD }, new Date())
    /** The record with one pending row on the board. */
    const withTask: TeamRecord = { ...created, tasks: [{ id: "T1", subject: "the reclaimed row", description: "own it", kind: "work", status: "pending", blockedBy: [], writeScopes: ["packages/a/**"], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), revision: 1 }], nextTaskNumber: 2 }
    // THE DEFECT'S SHAPE: the row carries a start instant from a DAY ago.
    /** The day-old instant the row falsely claims. */
    const stale = new Date(Date.now() - 86_400_000).toISOString()
    withTask.tasks[0] = { ...withTask.tasks[0], startedAt: stale }
    writeTeam(box.workspace, withTask)
    // The claim, through the tool the captain actually uses.
    /** The claim's answer. */
    const answer = (await box.call({ action: "claim", task_id: "T1" })) as { task?: { startedAt?: string } }
    expect(answer.task).toBeDefined()
    // THE PIN: the fresh clock, not the revived one.
    /** The row as it now stands on disk. */
    const row = readTeam(box.workspace, "team-claim")?.tasks.find((task) => task.id === "T1")
    if (row === undefined) throw new Error("the claimed row vanished")
    expect(row.status).toBe("in_progress")
    expect(row.startedAt).toBeDefined()
    expect(row.startedAt).not.toBe(stale)
    // Within the last minute of THIS test's own clock: a claim stamps the claim's instant.
    expect(Date.parse(String(row.startedAt))).toBeGreaterThan(Date.now() - 60_000)
  })
})
