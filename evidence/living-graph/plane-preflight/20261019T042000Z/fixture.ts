// LANE E — the ONE plane fixture both probes share (TUI and web), so the two arms cannot drift apart.
//
// THE DISCRIMINATING DESIGN. The board is authoritative for the LIVE state but its own `blockedBy`
// carries only T3<-T1 and T4<-T2. The PLAN declares two extra edges — T2<-T1 and T4<-T2 (the second
// agrees with the board) — plus a plan-only ghost T5. The store's own longest-path depth therefore
// says T2=0 and T4=1, while the merged model derives T2=1, T4=2, T5=3. A plane that draws the board's
// depth disagrees with the model; a plane that draws the model's ranks agrees with the other plane.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { buildModel, parsePlanMarkdown } from "../../../../packages/mpd-graph-core/src/index.ts"
import type { BoardTask, GraphModel } from "../../../../packages/mpd-graph-core/src/index.ts"
import type { TeamRecord } from "../../../../packages/mpd-team-core-plugin/src/team-store.ts"

/** The fixture team's id, which is also its record's file name. */
export const TEAM = "team-plane-fixture"
/** The session that owns the fixture team. */
export const SESSION = "sess-lane-e"
/** The fixture plan: two plan-only edges (one agreeing) and one plan-only ghost. */
export const PLAN = `## TODOs

- [ ] 1. Anchor
- [ ] 2. Middle (blocked by 1)
- [ ] 3. Side
- [ ] 4. Leaf (blocked by: 2)
- [ ] 5. Ghost (blocked by 4)
`
/** The board fixture in the shipped record shape; T2 and T4 carry no BOARD blocker of their own. */
export const RECORD: TeamRecord = {
  version: 1,
  teamId: TEAM,
  name: "plane fixture",
  description: "Lane E plane discriminator",
  leadSessionId: SESSION,
  phase: "active",
  createdAt: "2026-10-19T00:00:00.000Z",
  members: [{ id: "M1", name: "Lead", description: "the only member", status: "running", spawnedAt: "2026-10-19T00:00:00.000Z" }],
  nextMemberNumber: 2,
  nextTaskNumber: 6,
  approvedAt: "2026-10-19T00:00:00.000Z",
  tasks: [
    { id: "T1", subject: "Anchor", kind: "requirement", status: "completed", owner: "Lead", blockedBy: [], createdAt: "2026-10-19T00:00:00.000Z", updatedAt: "2026-10-19T00:00:00.000Z", revision: 1 },
    { id: "T2", subject: "Middle", kind: "work", status: "in_progress", owner: "Lead", blockedBy: [], createdAt: "2026-10-19T00:00:00.000Z", updatedAt: "2026-10-19T00:00:00.000Z", revision: 1 },
    { id: "T3", subject: "Side", kind: "work", status: "pending", owner: "Lead", blockedBy: ["T1"], createdAt: "2026-10-19T00:00:00.000Z", updatedAt: "2026-10-19T00:00:00.000Z", revision: 1 },
    { id: "T4", subject: "Leaf", kind: "work", status: "pending", owner: "Lead", blockedBy: ["T2"], createdAt: "2026-10-19T00:00:00.000Z", updatedAt: "2026-10-19T00:00:00.000Z", revision: 1 },
  ],
} as TeamRecord
/** The rows the host merges: the served depth is the STORE's own longest-path value (T2=0, T4=1). */
export const BOARD: BoardTask[] = [
  { id: "T1", subject: "Anchor", kind: "requirement", status: "completed", owner: "Lead", blockedBy: [], depth: 0 },
  { id: "T2", subject: "Middle", kind: "work", status: "in_progress", owner: "Lead", blockedBy: [], depth: 0 },
  { id: "T3", subject: "Side", kind: "work", status: "pending", owner: "Lead", blockedBy: ["T1"], depth: 1 },
  { id: "T4", subject: "Leaf", kind: "work", status: "pending", owner: "Lead", blockedBy: ["T2"], depth: 1 },
]
/** The ONE model the host would serve to both planes. */
export const MODEL: GraphModel = buildModel({ board: BOARD, plan: parsePlanMarkdown(PLAN) })

/**
 * Write the fixture record into a fresh scratch workspace the team store can read.
 * @returns the workspace root.
 */
export function fixtureWorkspace(): string {
  /** The scratch workspace, under this run's own evidence directory. */
  const workspace = mkdtempSync(join(import.meta.dirname, "ws-"))
  mkdirSync(join(workspace, ".mpd", "team", "teams"), { recursive: true })
  writeFileSync(join(workspace, ".mpd", "team", "teams", `${TEAM}.json`), JSON.stringify(RECORD, null, 1))
  return workspace
}
