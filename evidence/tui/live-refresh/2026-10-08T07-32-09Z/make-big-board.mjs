// make-big-board.mjs — write a REALISTIC long-running-project board into a workspace so the DAG
// surfaces face the two frozen fallback triggers: MORE THAN 12 RANKS (a 16-deep dependency chain,
// `graph.ts` MAX_BOX_RANKS = 12) and MORE THAN 24 TASKS (`panel-dag.ts` LIST_ROWS = 24).
//
// The record shape is the one `packages/mpd-team-core-plugin/src/team-store.ts` declares and the one
// the repo's own fixture (docker/ui/team-fixture-records.mts) writes; this file only makes it BIG.
// Usage: node make-big-board.mjs <workspace> [teamId]
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const workspace = process.argv[2]
const teamId = process.argv[3] ?? "team-2026-10-08T07-00-00.000Z"
if (workspace === undefined) {
  process.stderr.write("usage: node make-big-board.mjs <workspace> [teamId]\n")
  process.exit(2)
}
const INSTANT = "2026-10-08T07:00:00.000Z"
const members = [
  { id: "M1", name: "lead", description: "Lead on this wave", role: "Lead", route: "deepseek-official/deepseek-v4-pro", status: "running", spawnedAt: INSTANT, executorRef: "teammate-lead" },
  { id: "M2", name: "core-worker", description: "Senior Engineer on this wave", role: "Senior Engineer", route: "deepseek-official/deepseek-flash", status: "running", spawnedAt: INSTANT, executorRef: "teammate-core-worker" },
  { id: "M3", name: "ui-worker", description: "Senior Engineer on this wave", role: "Senior Engineer", route: "deepseek-official/deepseek-flash", status: "inactive", spawnedAt: INSTANT, executorRef: "teammate-ui-worker" },
  { id: "M4", name: "qa-reviewer", description: "Reviewer on this wave", role: "Reviewer", route: "deepseek-official/deepseek-v4-pro", status: "inactive", spawnedAt: INSTANT, executorRef: "teammate-qa-reviewer" },
  { id: "M5", name: "deep-worker", description: "Deep Worker on this wave", role: "Deep Worker", route: "deepseek-official/deepseek-flash", status: "inactive", spawnedAt: INSTANT, executorRef: "teammate-deep-worker" },
]
const tasks = []
const pad = (n) => String(n).padStart(2, "0")
// The 16-deep chain: the rank axis, straight down.
for (let n = 1; n <= 16; n += 1) {
  const status = n <= 5 ? "completed" : n === 6 ? "in_progress" : n === 7 ? "failed" : "pending"
  tasks.push({
    id: `B${pad(n)}`, subject: `Chain step ${pad(n)}: ${n === 1 ? "freeze the contract" : n <= 5 ? "build the layer" : "integrate the layer"}`,
    description: `Acceptance: chain step ${pad(n)}`, kind: n <= 2 ? "requirement" : n === 7 ? "review" : "work", status,
    blockedBy: n === 1 ? [] : [`B${pad(n - 1)}`], writeScopes: [], createdAt: INSTANT, updatedAt: INSTANT, revision: 1,
    owner: members[1 + (n % 4)].name, attempt: status === "failed" ? 1 : undefined, round: n === 7 ? 1 : undefined,
  })
}
// Ten fan-out tasks hanging off the top of the chain, so several ranks carry more than one row.
for (let n = 1; n <= 10; n += 1) {
  const parent = n <= 5 ? "B01" : "B02"
  const status = n === 1 ? "completed" : n === 2 ? "in_progress" : "pending"
  tasks.push({
    id: `F${pad(n)}`, subject: `Fan task ${pad(n)} on ${parent}`, description: `Acceptance: fan task ${pad(n)}`,
    kind: "work", status, blockedBy: [parent], writeScopes: [], createdAt: INSTANT, updatedAt: INSTANT, revision: 1,
    owner: members[(n % 4) + 1].name,
  })
}
const record = {
  version: 1, teamId, name: "big-board", description: "26 tasks across 16 ranks: the fallback ladder probe",
  leadSessionId: "sess-live-refresh", phase: "active", createdAt: INSTANT, approvedAt: INSTANT,
  members, tasks, nextMemberNumber: 6, nextTaskNumber: 40,
}
const teamRoot = join(workspace, ".mpd", "team")
mkdirSync(join(teamRoot, "teams"), { recursive: true })
writeFileSync(join(teamRoot, "teams", `${teamId}.json`), JSON.stringify(record, null, 2))
writeFileSync(join(teamRoot, "teams.json"), JSON.stringify({ version: 1, active: { "sess-live-refresh": teamId } }, null, 2))
const ranks = new Set(tasks.map((t) => t.blockedBy.length))
process.stdout.write(`big board ${teamId}: tasks=${tasks.length} ranks>=${ranks.size} completed=${tasks.filter((t) => t.status === "completed").length} failed=${tasks.filter((t) => t.status === "failed").length}\n`)
