import { expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { archivePlan, type StagedMember, type StagedPlan } from "../src/plan-store"
import { declareMembers, readProjectRosterBindings } from "../src/project-roster-binding"
import { locateProject, saveProject, type ProjectRecord } from "../src/project-store"
import { addTeamMember, draftTeam, writeTeam } from "../src/team-store"

/** Source timestamps are fixed so order cannot be mistaken for independent identity evidence. */
const now = new Date("2026-11-23T10:25:00.000Z")

/** An alias-only persisted project, exactly as pre-repair approval stored it. */
function legacyRecord(root: string): ProjectRecord {
  return { version: 1, projectId: "original-project", projectRoot: root, captainId: "captain-seat", members: [
    { memberId: "A-stable", name: "workmate-a", role: "Senior Engineer", route: { provider: "original", model: "pinned" } },
    { memberId: "B-stable", name: "workmate-b", role: "Senior Engineer", route: null },
  ], copies: [] }
}

/** Staging retains the requested logical name even when its approval renamed the board seat. */
function staged(side: "A" | "B", description: string, prompt: string = ""): StagedMember {
  return { name: `Worker${side}`, description, prompt, role: "Senior Engineer" }
}

/** Write an archived pre-repair approved plan and matching board using production codecs. */
function withLegacy(fn: (root: string, record: ProjectRecord, plan: StagedPlan) => void, options: { ambiguous?: boolean; pinned?: boolean } = {}): void {
  /** A test root outside this repository cannot discover its surrounding Git checkout. */
  const root = mkdtempSync(join(tmpdir(), "mpd-project-legacy-roster-"))
  try {
    /** Git's actual registered root is the project storage authority. */
    const git = spawnSync("git", ["init", "-q"], { cwd: root, encoding: "utf8" })
    if (git.status !== 0) throw new Error(git.stderr)
    /** Seed only the synthetic project with its old-format roster. */
    const record = legacyRecord(root)
    saveProject(locateProject(root), record)
    /** Two archived logical declarations, indistinguishable in the ambiguity arm. */
    const members = [staged("A", "first", options.pinned ? "workmate: workmate-a" : ""), staged("B", options.ambiguous ? "first" : "second", options.pinned ? "workmate: workmate-b" : "")]
    /** The archived order deliberately differs from the board's order. */
    const plan: StagedPlan = {
      version: 2, planId: "plan-roster-legacy", sessionId: "prior-captain", name: "legacy board", approval: "required", description: "", members, tasks: [],
      stagedAt: now.toISOString(), approvedAt: now.toISOString(), created: { members: [{ id: "new-B", name: "workmate-b" }, { id: "new-A", name: "workmate-a" }], tasks: [] },
    }
    /** Both archived board rows explicitly recorded the selected Workmate. */
    let board = draftTeam({ name: plan.name, description: plan.description, leadSessionId: plan.sessionId, planId: plan.planId }, now)
    for (const side of ["B", "A"] as const) {
      /** The legacy board copied immutable original declaration text into its approved row. */
      const item = members[side === "A" ? 0 : 1]
      board = addTeamMember(board, { name: `workmate-${side.toLowerCase()}`, description: item.description, role: item.role, projectMemberId: `${side}-stable` }, now)
    }
    writeTeam(root, { ...board, phase: "ended", approvedAt: now.toISOString(), endedAt: now.toISOString(),
      members: board.members.map((row) => ({ ...row, status: "running", workmate: row.name, executorRef: `stale-${row.name}` })) })
    archivePlan(root, plan)
    fn(root, record, plan)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test("legacy adoption uses a corroborated archived declaration without reordering accounts", () => {
  withLegacy((root, old, plan) => {
    /** The archived declaration and actual enrolled seat suffice to reconstruct its logical name. */
    const matches = readProjectRosterBindings(root, [...plan.members].reverse()).byLogicalName
    expect(matches.get("WorkerA")?.memberId).toBe("A-stable")
    expect(matches.get("WorkerB")?.memberId).toBe("B-stable")
    expect(matches.get("WorkerB")?.workmate).toBe("workmate-b")
    /** A later explicit Workmate change preserves role, route and the existing private account. */
    const migrated = declareMembers(old, [{ name: "replacement-workmate", logicalName: "WorkerA", workmate: "replacement-workmate", role: "Explorer", route: null, previous: matches.get("WorkerA") }])
    expect(migrated.members).toHaveLength(2)
    expect(migrated.members[0]).toMatchObject({ memberId: "A-stable", logicalName: "WorkerA", workmate: "replacement-workmate", role: "Senior Engineer", route: { provider: "original", model: "pinned" } })
    expect(migrated.members[1]).toEqual(old.members[1])
  })
})

test("an ambiguous unpinned legacy alias refuses and preserves the original roster", () => {
  withLegacy((root, old, plan) => {
    expect(() => readProjectRosterBindings(root, plan.members)).toThrow(/WorkerA.*ambiguous.*original-project/)
    expect(locateProject(root).record?.members).toEqual(old.members)
  }, { ambiguous: true })
})

test("an archived explicit pin disambiguates otherwise identical legacy declarations", () => {
  withLegacy((root, _old, plan) => {
    /** Both archived pins are corroborated by the actual board's selected Workmate. */
    const matches = readProjectRosterBindings(root, plan.members).byLogicalName
    expect(matches.get("WorkerA")?.memberId).toBe("A-stable")
    expect(matches.get("WorkerB")?.memberId).toBe("B-stable")
  }, { ambiguous: true, pinned: true })
})

test("a new logical declaration cannot adopt an occupied alias or a stale predecessor", () => {
  /** One fixed member's current account and admitted alias. */
  const record = declareMembers(legacyRecord("unused"), [{ name: "workmate-a", logicalName: "WorkerA", route: null, previous: { memberId: "A-stable", name: "workmate-a" } }])
  expect(() => declareMembers(record, [{ name: "workmate-a", logicalName: "WorkerC", route: null }])).toThrow(/reserved for "WorkerA"/)
  expect(() => declareMembers(record, [{ name: "elsewhere", logicalName: "WorkerA", route: null, previous: { memberId: "A-stable", name: "old-alias", logicalName: "WorkerA" } }])).toThrow(/changed during approval/)
})
