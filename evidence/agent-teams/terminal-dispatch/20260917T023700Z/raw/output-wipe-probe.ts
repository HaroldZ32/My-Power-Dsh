// Does the compose WIPE a stored deliverable? (`state.js:174` `activateTaskAttempt` sets
// `task.output = undefined`, reached from the same route `mpd-delta terminal-dispatch-recheck`
// guards.) Deterministic: the compose ALWAYS calls `beginTaskAttempt` when it mints a ticket.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, "../../../../..")
const STATE_DIR = join(".mpd", "team")
const CAPTAIN_ID = "session-captain-wipe"
const TEAM_ID = "wipe-probe"
const MEMBER_ID = "member-wipe"

const teamFile = (dir) => join(dir, STATE_DIR, TEAM_ID, "team.json")

async function run() {
  const dir = mkdtempSync(join(tmpdir(), "mpd-t07w-"))
  mkdirSync(join(dir, STATE_DIR, TEAM_ID, "inbox"), { recursive: true })
  const now = Date.now()
  writeFileSync(teamFile(dir), JSON.stringify({
    id: TEAM_ID, name: "wipe probe", captainSessionId: CAPTAIN_ID, createdAt: now, approvedAt: now,
    phase: "running", taskSeq: 1,
    members: [{ name: "Architect", id: MEMBER_ID, role: "worker", joinedAt: now, status: "idle" }],
    tasks: [{
      id: "t1", subject: "work t1", assignee: "Architect", dependencies: [],
      status: "in_progress", attempt: 1, attemptId: "attempt-t1-1",
      // a DELIVERABLE the member already stored on this task
      output: "THE STORED DELIVERABLE (9000 bytes of findings)",
      createdAt: now, updatedAt: now,
    }],
  }, null, 2) + "\n")
  const before = JSON.parse(readFileSync(teamFile(dir), "utf8")).tasks[0].output
  const captain = { id: CAPTAIN_ID, status: "idle", session: { header: { cwd: dir } } }
  const live = new Map([[CAPTAIN_ID, captain], [MEMBER_ID, { id: MEMBER_ID, status: "idle", session: { header: { cwd: dir } } }]])
  const deliveries = []
  const ctx = {
    agents: { get: (id) => live.get(id) },
    logger: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} },
    on: () => () => {},
    subagents: { prompt: async () => { deliveries.push(1); return { messageId: "m" } } },
  }
  const { installTeamScheduler } = await import(pathToFileURL(join(REPO, "packages/mpd-agent-teams-plugin/lib/scheduler.js")).href)
  const scheduler = installTeamScheduler(ctx, { stateDir: STATE_DIR })
  await scheduler.kickMember(dir, TEAM_ID, "Architect", captain)
  const after = JSON.parse(readFileSync(teamFile(dir), "utf8")).tasks[0]
  rmSync(dir, { recursive: true, force: true })
  return { outputBefore: before, outputAfter: after.output ?? null, wiped: after.output === undefined, deliveries: deliveries.length, statusAfter: after.status, attemptAfter: after.attempt, attemptsBefore: 1 }
}
console.log(JSON.stringify(await run(), null, 2))
