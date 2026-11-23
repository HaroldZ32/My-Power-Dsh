import { afterEach, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { openCell } from "../../mpd-cellwork-plugin/src/open"
import { readCell, writeCell, type CellMemberRecord, type CellState } from "../../mpd-cellwork-plugin/src/state"
import { commitResplit, resplitTicketAccepted, type ResplitRequest } from "../src/cellwork-resplit"
import { projectIdentity } from "../src/project-admission"
import { addTeamMember, addTeamTask, createTeam, readTeam, updateTeamMember, updateTeamTask, writeTeam, type TeamRecord } from "../src/team-store"

/** Test roots are fresh synthetic Git projects. */
const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

/** A fixed clock makes complete history easy to compare byte for byte. */
const now = new Date("2026-11-23T00:00:00Z")

/** Planning roles carry their original native handles in both records. */
function seat(name: string, sessionId: string, role: string): CellMemberRecord {
  return { name, role, mode: "member", sessionId, executorRef: sessionId, joinedAt: now.toISOString(), handoffReady: false, handoffs: 0 }
}

/** Build the normal accepted revision 1 across a genuine project identity, cell and board. */
function fixture(live: boolean = false): { root: string; state: CellState; team: TeamRecord; request: ResplitRequest } {
  /** No parent of this directory shares its Git store. */
  const root = mkdtempSync(join(tmpdir(), "mpd-cellwork-resplit-"))
  roots.push(root)
  expect(spawnSync("git", ["init", "-q", root]).status).toBe(0)
  /** Native admission creates the project lock and exact captain reservation. */
  const opened = openCell({ workspace: root, objective: "split this synthetic objective", captainSessionId: "captain", admission: projectIdentity, now })
  if (!opened.ok) throw new Error(opened.error)
  /** Both planning roles remain board-local. */
  const planner = seat("cell-planner", "original-planner", "Planner")
  /** Only the existing splitter role can own the replacement. */
  const splitter = seat("cell-splitter", "original-splitter", "Lead")
  /** The planning board remains the live execution board after materializing revision 1. */
  let team = createTeam(root, { name: `cell ${opened.cellId}`, description: "fixture", leadSessionId: "captain" }, now)
  for (const member of [planner, splitter]) {
    team = addTeamMember(team, { name: member.name, role: member.role, description: "fixture", projectScope: "run" }, now)
    team = updateTeamMember(team, member.name, { executorRef: member.sessionId, status: "inactive" })
  }
  team = addTeamTask({ ...team, approvedAt: now.toISOString(), phase: "idle" }, { subject: "Measured task split from the agreed requirements", description: "original planning contract", blockedBy: [], owner: splitter.name }, now)
  if (!live) team = updateTeamTask(team, "T1", { status: "completed" }, now)
  writeTeam(root, team)
  /** Both records must agree on the exact prior ticket. */
  const current = readCell(root, opened.cellId)
  if (!current.ok) throw new Error(current.detail)
  /** This is the last accepted scope before the requirements update. */
  const state = writeCell(root, { ...current.state, phase: "executing", teamId: team.teamId, splitTaskId: "T1", requirementsRevision: 1, splitRevision: 1, activatedRevision: 1,
    members: { [planner.name]: planner, [splitter.name]: splitter } })
  return { root, team, state, request: { cellId: state.cellId, teamId: team.teamId, previousRevision: 1, revision: 2 } }
}

test("a terminal ticket stays closed, interrupted publication leaves one inert row, and retry releases it", () => {
  /** The original contract and member identities are immutable through both attempts. */
  const { root, state, team, request } = fixture()
  /** Simulate a failure after the board write but before Cellwork can publish its acceptance. */
  const first = commitResplit(root, "original-planner", request, () => { throw new Error("interrupted publication") }, now)
  expect(first).toEqual({ ok: false, error: "interrupted publication" })
  /** The new row exists but dispatch and ordinary claim cannot use it yet. */
  const reserved = readTeam(root, team.teamId)?.tasks[1]
  if (reserved === undefined) throw new Error("the reservation was lost")
  expect(reserved).toMatchObject({ id: "T2", owner: "cell-splitter", status: "pending", resplit: { cellId: state.cellId, revision: 2 } })
  expect(resplitTicketAccepted(root, team.teamId, reserved)).toBe(false)
  expect(readCell(root, state.cellId)).toMatchObject({ ok: true, state: { requirementsRevision: 1, splitTaskId: "T1" } })
  /** Retrying the same compare-and-set attaches exactly that existing slot. */
  const next = commitResplit(root, "original-planner", request, (ticket) => {
    writeCell(root, { ...state, requirementsRevision: 2, splitTaskId: ticket.id, splitStale: true })
  }, now)
  expect(next).toEqual({ ok: true, ticket: { id: "T2", status: "pending", replacement: true } })
  expect(resplitTicketAccepted(root, team.teamId, reserved)).toBe(true)
  expect(readTeam(root, team.teamId)?.tasks).toEqual([team.tasks[0], reserved])
  expect(readTeam(root, team.teamId)?.members).toEqual(team.members)
  expect(commitResplit(root, "original-planner", request, () => { throw new Error("must not publish a second update") }, now)).toMatchObject({ ok: false })
})

test("the live original ticket is reused unmodified", () => {
  /** An update before completion needs no replacement or board mutation. */
  const { root, team, request } = fixture(true)
  /** Record the id the caller would publish in the cell. */
  let selected = ""
  expect(commitResplit(root, "original-planner", request, (ticket) => { selected = ticket.id }, now)).toEqual({ ok: true, ticket: { id: "T1", status: "pending", replacement: false } })
  expect(selected).toBe("T1")
  expect(readTeam(root, team.teamId)).toEqual(team)
})

test("foreign actors, stopped cells and ambiguous splitter tickets cannot publish or mutate", () => {
  /** The expected revision and actual owner of the live project remain explicit. */
  const { root, state, team, request } = fixture(true)
  /** Any publication is an assertion failure in this control. */
  const publish = (): never => { throw new Error("unexpected publication") }
  expect(commitResplit(root, "captain", request, publish, now)).toMatchObject({ ok: false })
  expect(commitResplit(root, "different-planner", request, publish, now)).toMatchObject({ ok: false })
  expect(commitResplit(root, "original-planner", { ...request, teamId: "foreign-board" }, publish, now)).toMatchObject({ ok: false })
  writeCell(root, { ...state, phase: "stopped" })
  expect(commitResplit(root, "original-planner", request, publish, now)).toMatchObject({ ok: false })
  expect(readTeam(root, team.teamId)).toEqual(team)
  writeCell(root, state)
  /** Two live candidates would make ownership ambiguous even for the real planner. */
  const ambiguous = addTeamTask(team, { subject: "Re-split for requirements revision 2", description: "legacy duplicate", owner: "cell-splitter" }, now)
  writeTeam(root, ambiguous)
  expect(commitResplit(root, "original-planner", request, publish, now)).toEqual({ ok: false, error: "the original splitter has ambiguous live tickets" })
  expect(readTeam(root, team.teamId)).toEqual(ambiguous)
})
