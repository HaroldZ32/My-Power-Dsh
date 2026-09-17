// RED probe for T-07 (t36): run the compose→deliver RACE against (a) the shipped scheduler, and
// (b) a copy with `mpd-delta terminal-dispatch-recheck` STRIPPED — the pre-fix shape. The reading
// is what the delivery stub saw ON DISK at the instant of the wake.
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, "../../../../..")
const PLUGIN = join(REPO, "packages/mpd-agent-teams-plugin")
const STATE_DIR = join(".mpd", "team")
const CAPTAIN_ID = "session-captain-probe"
const TEAM_ID = "terminal-probe"
const MEMBER_ID = "member-architect-probe"
const RUNS = Number(process.argv[2] ?? 20)

/** A scratch copy of the plugin whose scheduler either carries or lacks the re-check region. */
function scratchPlugin({ strip }) {
  const root = mkdtempSync(join(tmpdir(), "mpd-t07-"))
  cpSync(join(PLUGIN, "lib"), join(root, "lib"), { recursive: true })
  try { symlinkSync(join(PLUGIN, "_deps"), join(root, "_deps")) } catch { /* already there */ }
  if (strip) {
    const target = join(root, "lib", "scheduler.js")
    const stripped = readFileSync(target, "utf8").replace(/[ ]*\/\/#region mpd-delta terminal-dispatch-recheck[\s\S]*?\/\/#endregion mpd-delta terminal-dispatch-recheck\n/, "")
    if (stripped.includes("mpd-delta terminal-dispatch-recheck")) throw new Error("strip failed")
    writeFileSync(target, stripped)
  }
  return root
}

const teamFile = (dir) => join(dir, STATE_DIR, TEAM_ID, "team.json")

function writeFixture(dir) {
  mkdirSync(join(dir, STATE_DIR, TEAM_ID, "inbox"), { recursive: true })
  const now = Date.now()
  writeFileSync(teamFile(dir), JSON.stringify({
    id: TEAM_ID, name: "terminal probe", captainSessionId: CAPTAIN_ID,
    createdAt: now, approvedAt: now, phase: "running", taskSeq: 1,
    members: [{ name: "Architect", id: MEMBER_ID, role: "worker", joinedAt: now, status: "idle" }],
    tasks: [{ id: "t1", subject: "work t1", assignee: "Architect", dependencies: [], status: "in_progress", attempt: 1, attemptId: "attempt-t1-1", createdAt: now, updatedAt: now }],
  }, null, 2) + "\n")
}

/** One race run; returns what the delivery stub saw on disk at wake time. */
async function oneRun(schedulerModule, dir) {
  const deliveries = []
  const declines = []
  const captain = { id: CAPTAIN_ID, status: "idle", session: { header: { cwd: dir } } }
  const live = new Map([[CAPTAIN_ID, captain], [MEMBER_ID, { id: MEMBER_ID, status: "idle", session: { header: { cwd: dir } } }]])
  const ctx = {
    agents: { get: (id) => live.get(id) },
    logger: { warn: (...a) => { declines.push(a.map(String).join(" ")) }, info: () => {}, error: () => {}, debug: () => {} },
    on: () => () => {},
    subagents: { prompt: async (request) => { const text = request.content.map((b) => b.text).join(""); const id = /Task: (\S+)/u.exec(text)?.[1]; const rec = JSON.parse(readFileSync(teamFile(dir), "utf8")); deliveries.push({ id, statusAtDelivery: rec.tasks.find((t) => t.id === id)?.status ?? "(gone)" }); return { messageId: "m" } } },
  }
  const scheduler = schedulerModule.installTeamScheduler(ctx, { stateDir: STATE_DIR })
  const pending = scheduler.kickMember(dir, TEAM_ID, "Architect", captain)
  for (let i = 0; i < 200; i += 1) {
    const rec = JSON.parse(readFileSync(teamFile(dir), "utf8"))
    if (rec.members[0].status === "working") break
    await new Promise((r) => setTimeout(r, 1))
  }
  const rec = JSON.parse(readFileSync(teamFile(dir), "utf8"))
  rec.tasks[0].status = "completed"
  rec.tasks[0].verdict = "pass"
  writeFileSync(teamFile(dir), JSON.stringify(rec, null, 2) + "\n")
  await pending
  const final = JSON.parse(readFileSync(teamFile(dir), "utf8"))
  const refused = declines.some((line) => line.includes("before its assignment could be delivered"))
  return { deliveries, refused, finalStatus: final.tasks[0].status, member: final.members[0].status }
}

const report = {}
for (const [label, strip] of [["shipped", false], ["region-stripped (pre-fix shape)", true]]) {
  const root = scratchPlugin({ strip })
  const module = await import(pathToFileURL(join(root, "lib", "scheduler.js")).href)
  let terminalDeliveries = 0, anyDelivery = 0, reverted = 0, refusals = 0, deliveredWhileRefusable = 0
  for (let i = 0; i < RUNS; i += 1) {
    const dir = mkdtempSync(join(tmpdir(), "mpd-t07-ws-"))
    writeFixture(dir)
    const out = await oneRun(module, dir)
    if (out.deliveries.length > 0) anyDelivery += 1
    if (out.refused) refusals += 1
    if (out.refused && out.deliveries.length > 0) deliveredWhileRefusable += 1
    if (out.deliveries.some((d) => ["completed", "failed", "cancelled"].includes(d.statusAtDelivery))) terminalDeliveries += 1
    if (out.finalStatus !== "completed") reverted += 1
    rmSync(dir, { recursive: true, force: true })
  }
  report[label] = { runs: RUNS, anyDelivery, refusalsObserved: refusals, runsWithBothRefusalAndDelivery: deliveredWhileRefusable, terminalDeliveries, taskRevertedAwayFromCompleted: reverted }
  rmSync(root, { recursive: true, force: true })
}
console.log(JSON.stringify(report, null, 2))
const shippedBad = report["shipped"].terminalDeliveries > 0 || report["shipped"].taskRevertedAwayFromCompleted > 0
console.log("SHIPPED READING: refusals=" + report["shipped"].refusalsObserved + " terminalDeliveries=" + report["shipped"].terminalDeliveries + " reverts=" + report["shipped"].taskRevertedAwayFromCompleted)
console.log("REFUSAL IS THE DECISIVE READING: only the re-check can emit it; the stripped copy CANNOT refuse at all, so every run it delivers is a run whose completion may already have landed before the decision.")
console.log(report["region-stripped (pre-fix shape)"].terminalDeliveries > 0
  ? "PRE-FIX SHAPE: terminal delivery WAS produced — the region is what stops it (RED demonstrated)"
  : "PRE-FIX SHAPE: the race did not land in this run; the invariant is pinned by the seeded/terminal cases instead")
