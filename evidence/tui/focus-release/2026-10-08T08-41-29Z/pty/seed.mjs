// Write ONE mpd team record into a workspace and bind it to a session. Usage:
//   node seed.mjs <workspace> <sessionId> <teamId> <teamName> <extraTasks>
// The record shape is the one `TeamRecord` declares in packages/mpd-team-core-plugin/src/team-store.ts.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
const [workspace, sessionId, teamId, teamName, extra] = process.argv.slice(2)
const now = new Date().toISOString()
const task = (id, subject, status) => ({ id, subject, description: `Acceptance: ${subject}`, kind: "work", status, blockedBy: [], writeScopes: [], createdAt: now, updatedAt: now, revision: 1 })
const record = {
  version: 1, teamId, name: teamName, description: `board for ${sessionId}`, leadSessionId: sessionId,
  phase: "active", createdAt: now, approvedAt: now,
  members: [{ id: "M1", name: "lead", description: "Lead", role: "Lead", route: "deepseek-official/deepseek-v4-pro", status: "running", spawnedAt: now }],
  tasks: [task("T1", "first lane", "pending"), task("T2", "second lane", "pending"), task("T3", "third lane", "pending"), task("T4", "fourth lane", "pending"), ...(Number(extra) > 0 ? [task("T5", "appended lane", "pending")] : [])],
  nextMemberNumber: 2, nextTaskNumber: 6,
}
const teamRoot = join(workspace, ".mpd", "team")
mkdirSync(join(teamRoot, "teams"), { recursive: true })
writeFileSync(join(teamRoot, "teams", `${teamId}.json`), JSON.stringify(record, null, 2))
const indexPath = join(teamRoot, "teams.json")
let index = { version: 1, active: {} }
if (existsSync(indexPath)) { try { index = JSON.parse(readFileSync(indexPath, "utf8")) } catch { index = { version: 1, active: {} } } }
index.active = { ...(index.active ?? {}), [sessionId]: teamId }
writeFileSync(indexPath, JSON.stringify(index, null, 2))
process.stdout.write(`seeded ${teamId} (${teamName}) for ${sessionId}: ${record.tasks.length} tasks\n`)
