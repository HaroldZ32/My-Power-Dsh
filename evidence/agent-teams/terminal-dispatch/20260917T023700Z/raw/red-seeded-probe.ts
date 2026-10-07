// Does the acceptance's RED premise hold? "a seeded terminal task must FAIL the assertion before
// the fix". This runs the SEEDED-TERMINAL case against BOTH shapes (shipped / region-stripped).
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, "../../../../..")
const PLUGIN = join(REPO, "packages/mpd-agent-teams-plugin")
const STATE_DIR = join(".mpd", "team")
const CAPTAIN_ID = "session-captain-seeded"
const TEAM_ID = "seeded-probe"
const MEMBER_ID = "member-seeded"

function scratchPlugin(strip) {
  const root = mkdtempSync(join(tmpdir(), "mpd-t07s-"))
  cpSync(join(PLUGIN, "lib"), join(root, "lib"), { recursive: true })
  try { symlinkSync(join(PLUGIN, "_deps"), join(root, "_deps")) } catch { /* present */ }
  if (strip) {
    const target = join(root, "lib", "scheduler.js")
    const stripped = readFileSync(target, "utf8").replace(/[ ]*\/\/#region mpd-delta terminal-dispatch-recheck[\s\S]*?\/\/#endregion mpd-delta terminal-dispatch-recheck\n/, "")
    if (stripped.includes("mpd-delta terminal-dispatch-recheck")) throw new Error("strip failed")
    writeFileSync(target, stripped)
  }
  return root
}

const teamFile = (dir) => join(dir, STATE_DIR, TEAM_ID, "team.json")

async function seededTerminalRun(module, status) {
  const dir = mkdtempSync(join(tmpdir(), "mpd-t07s-ws-"))
  mkdirSync(join(dir, STATE_DIR, TEAM_ID, "inbox"), { recursive: true })
  const now = Date.now()
  writeFileSync(teamFile(dir), JSON.stringify({
    id: TEAM_ID, name: "seeded", captainSessionId: CAPTAIN_ID, createdAt: now, approvedAt: now,
    phase: "running", taskSeq: 1,
    members: [{ name: "Architect", id: MEMBER_ID, role: "worker", joinedAt: now, status: "idle" }],
    tasks: [{ id: "t1", subject: "already done", assignee: "Architect", dependencies: [], status, attempt: 1, attemptId: "attempt-t1-1", createdAt: now, updatedAt: now }],
  }, null, 2) + "\n")
  const before = readFileSync(teamFile(dir), "utf8")
  const deliveries = []
  const captain = { id: CAPTAIN_ID, status: "idle", session: { header: { cwd: dir } } }
  const live = new Map([[CAPTAIN_ID, captain], [MEMBER_ID, { id: MEMBER_ID, status: "idle", session: { header: { cwd: dir } } }]])
  const ctx = {
    agents: { get: (id) => live.get(id) },
    logger: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} },
    on: () => () => {},
    subagents: { prompt: async (request) => { deliveries.push(request.content.map((b) => b.text).join("")); return { messageId: "m" } } },
  }
  const scheduler = module.installTeamScheduler(ctx, { stateDir: STATE_DIR })
  await scheduler.kickMember(dir, TEAM_ID, "Architect", captain)
  const out = { status, deliveries: deliveries.length, recordBytesUnchanged: readFileSync(teamFile(dir), "utf8") === before }
  rmSync(dir, { recursive: true, force: true })
  return out
}

const report = {}
for (const [label, strip] of [["shipped", false], ["region-stripped (pre-fix shape)", true]]) {
  const root = scratchPlugin(strip)
  const module = await import(pathToFileURL(join(root, "lib", "scheduler.js")).href)
  report[label] = []
  for (const status of ["completed", "failed", "cancelled"]) report[label].push(await seededTerminalRun(module, status))
  rmSync(root, { recursive: true, force: true })
}
console.log(JSON.stringify(report, null, 2))
const pre = report["region-stripped (pre-fix shape)"]
console.log(pre.every((r) => r.deliveries === 0)
  ? "PRE-FIX SHAPE: the seeded-terminal assertion PASSES there too — the acceptance's RED premise (\"must FAIL before the fix on a seeded terminal task\") is REFUTED by measurement: every selection predicate already excludes terminal work."
  : "PRE-FIX SHAPE: the seeded-terminal assertion FAILS there — the RED premise holds.")
