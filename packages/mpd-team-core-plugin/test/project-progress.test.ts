import { afterEach, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { installProjectProgress } from "../src/project-progress"
import { addTeamMember, addTeamTask, createTeam, readTeam, updateTeamMember, updateTeamTask, writeTeam, type TeamRecord } from "../src/team-store"

/** Each actor in these tests uses only its own synthetic project state. */
const sandboxes: string[] = []
afterEach(() => { for (const path of sandboxes.splice(0)) rmSync(path, { recursive: true, force: true }) })

/** A live board, an exact original worker, and native events driven independently of tool execution. */
function fixture(): {
  stage: ReturnType<typeof installProjectProgress>; agent: object; board: TeamRecord; root: string; receipts: string[];
  fire: (event: string, ...args: unknown[]) => unknown; row: () => NonNullable<ReturnType<typeof readTeam>>
} {
  /** Plain workspace isolated from any live Git checkout. */
  const root = mkdtempSync(join(tmpdir(), "mpd-owner-progress-"))
  sandboxes.push(root)
  /** Own stable Agent and session handle used by the real progress resolver. */
  const agent = { session: { id: "worker" } }
  /** This test clock does not decide whether the tool receipt matches. */
  const now = new Date()
  /** Draft, member, and task before the fixture stamps actual assignment state. */
  let board = createTeam(root, { name: "work", description: "one local board", leadSessionId: "captain" }, now)
  board = addTeamMember(board, { name: "writer", description: "owns the work", projectMemberId: "member-1" }, now)
  board = updateTeamMember(board, "M1", { executorRef: "worker", status: "running" })
  board = addTeamTask(board, { subject: "next source", description: "read then write", owner: "worker", kind: "work", writeScopes: ["out.txt"], blockedBy: [] }, now)
  board = updateTeamTask({ ...board, approvedAt: now.toISOString(), phase: "active" }, "T1", { status: "in_progress", attempt: 1 }, now)
  writeTeam(root, board)
  /** Hooks capture actual spawns/events only in the fixture. */
  const events = new Map<string, (...args: unknown[]) => unknown>()
  /** Any message the tested worker requests for its next boundary. */
  const receipts: string[] = []
  /** The isolated native bus and exact project seat. */
  const stage = installProjectProgress({
    dsh: { workspaceRoot: () => root, onEvent: (name, callback) => { events.set(name, callback); return () => { events.delete(name) } }, contextPressure: () => ({ usedTokens: 12000, windowTokens: 200000, ratio: 0.06, provenance: "observed" }), userMessage: (m) => ({ id: "next-step", role: "user", source: m.source ?? { kind: "fixture" }, content: [{ type: "text", text: m.text }] }), steerAgentTurn: (original, message) => { expect(original).toBe(agent); receipts.push(JSON.stringify(message)) } },
    identity: { resolveSeat: ({ sessionId }) => sessionId === "worker" ? { kind: "member", seat: "member", memberId: "member-1", memberName: "writer", projectId: "project", projectRoot: root, checkoutRoot: root, teamId: board.teamId } : { kind: "denied" } },
    warn: (message) => { throw new Error(message) },
  })
  return { stage, agent, board, root, receipts, fire: (event, ...args) => events.get(event)?.(...args), row: () => readTeam(root, board.teamId) ?? board }
}

test("the original owner can continue once after an unrelated read; the exact successful operation then clears the declaration", () => {
  /** Two independent paths exercise exact filename matching. */
  const f = fixture()
  f.stage.write(f.agent, "T1", f.board.tasks[0].revision, "read target.txt")
  f.fire("session/event", { id: "worker" }, { type: "tool/call", data: { callId: "other", name: "read", arguments: '{"file_path":"other.txt"}' } })
  f.fire("session/event", { id: "worker" }, { type: "tool/result", data: { message: { toolCallId: "other", isError: false } } })
  f.fire("agent/turn-stopping", { agent: f.agent })
  f.fire("session/event", { id: "worker" }, { type: "tool/call", data: { callId: "exact", name: "read", arguments: '{"file_path":"target.txt"}' } })
  f.fire("session/event", { id: "worker" }, { type: "tool/result", data: { message: { toolCallId: "exact", isError: false } } })
  f.fire("agent/turn-stopping", { agent: f.agent })
  expect(f.receipts).toHaveLength(1)
  expect(f.row().tasks[0].projectProgress).toBeUndefined()
})

test("a legitimate wait and a later superseded ready revision issue no continuation", () => {
  /** Author an explicit wait on the real fixture board. */
  const f = fixture()
  f.stage.write(f.agent, "T1", f.board.tasks[0].revision, "wait for dependency input")
  f.fire("agent/turn-stopping", { agent: f.agent })
  expect(f.receipts).toHaveLength(0)
  f.stage.write(f.agent, "T1", f.row().tasks[0].revision, "read target.txt")
  writeTeam(f.root, updateTeamTask(f.row(), "T1", { note: "changed by another authorized board action" }, new Date()))
  f.fire("agent/turn-stopping", { agent: f.agent })
  expect(f.receipts).toHaveLength(0)
})

test("a non-owner and an out-of-scope next write cannot create a reservation", () => {
  /** Keep the admission check tied to the actual Agent object and writable task scope. */
  const f = fixture()
  expect(() => f.stage.write({ session: { id: "peer" } }, "T1", f.board.tasks[0].revision, "write out.txt")).toThrow(/assigned project worker/)
  expect(() => f.stage.write(f.agent, "T1", f.board.tasks[0].revision, "write out.txt/child")).toThrow(/authorized checkout or write scope/)
  expect(f.row().tasks[0].projectProgress).toBeUndefined()
})
