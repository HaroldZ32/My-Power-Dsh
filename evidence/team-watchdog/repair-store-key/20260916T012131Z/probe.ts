// t79 (r2) evidence — the cross-team heartbeat READ contamination, before/after.
//
// THE DEFECT: `heartbeatPath()` builds `<watchdogRoot>/heartbeat/<memberKey>.jsonl` with NO team
// segment and `memberKey` is the member NAME, so two teams in ONE workspace whose members share a
// name append to ONE file. `candidateFor` filtered that file by taskId (+attempt) but NOT by team,
// so team A's stamp satisfied team B's candidate: a WEDGED member looked alive and the watchdog
// stayed silent — the one failure mode this wave exists to prevent.
//
// THE FIX is read-side: the candidate's stamps are filtered by the stamp's own `teamId` (which the
// writer already records on every stamp), with the same permissive convention t73 used for the
// attempt: a stamp that carries NO team cannot contradict and is kept.
//
// This probe shows, on the REAL engine and the REAL store:
//   A. the structural cause — one FILE holding BOTH teams' stamps;
//   B. the FALSE NEGATIVE reproduced through a model of the removed predicate (no team test),
//      which is what the code did before this repair;
//   C. the fix end to end — the wedged team now WARNS while the other team's stamp is present;
//   D. the same-team control — a member's OWN recent stamp still suppresses the WARN exactly as
//      before (the fix is not a mute).
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, "..", "..", "..", "..")
const SRC_MACHINE = join(REPO, "packages", "mpd-team-watchdog-plugin", "src", "machine.ts")
const SRC_STORE = join(REPO, "packages", "mpd-team-watchdog-plugin", "src", "store.ts")
const SRC_PATHS = join(REPO, "packages", "mpd-team-watchdog-plugin", "src", "paths.ts")
const DIST = join(REPO, "packages", "mpd-team-watchdog-plugin", "dist", "index.js")
for (const required of [SRC_MACHINE, SRC_STORE, SRC_PATHS, DIST]) {
  if (!existsSync(required)) {
    console.error("FATAL: missing " + required)
    process.exit(2)
  }
}
const { candidateFor, WATCHDOG_DEFAULTS } = await import(SRC_MACHINE)
const { readHeartbeats } = await import(SRC_STORE)
const { heartbeatPath } = await import(SRC_PATHS)
const { apply } = await import(DIST)

const checks = []
const check = (id, ok, detail) => checks.push({ id, ok, ...(detail === undefined ? {} : { detail }) })
const knobs = { ...WATCHDOG_DEFAULTS }
const WS = join(HERE, "raw", "ws")
const STATE_DIR = join(".mpd", "team")
const SHARED_NAME = "Architect" // the SAME member name in both teams — the whole point
const TEAM_A = "team-alpha"
const TEAM_B = "team-beta"
rmSync(WS, { recursive: true, force: true })
mkdirSync(join(WS, STATE_DIR), { recursive: true })

// ── the fixture: two teams, both with a task `t1`, both with a member named "Architect" ──────
function writeTeam(teamId, stampAt) {
  const dir = join(WS, STATE_DIR, teamId)
  mkdirSync(join(dir, "inbox"), { recursive: true })
  writeFileSync(
    join(dir, "team.json"),
    JSON.stringify(
      {
        id: teamId,
        name: teamId,
        captainSessionId: "session-captain-t79",
        phase: "running",
        createdAt: 1,
        approvedAt: 1,
        taskSeq: 1,
        members: [{ name: SHARED_NAME, id: "child-" + teamId, role: "worker", status: "idle" }],
        tasks: [{ id: "t1", subject: "work", assignee: SHARED_NAME, dependencies: [], status: "in_progress", attempt: 1, attemptId: "att-1", createdAt: 1, updatedAt: 1 }],
      },
      null,
      2,
    ) + "\n",
  )
  return stampAt
}
// ONE shared heartbeat file (the member name is the key), holding BOTH teams' stamps:
// team-alpha stamped RECENTLY, team-beta's last stamp is LONG past the threshold (it is wedged).
const RECENT = 1_000_000_000_000
const WEDGED_AT = RECENT - 10 * knobs.warnSilenceMs
writeTeam(TEAM_A, RECENT)
writeTeam(TEAM_B, WEDGED_AT)
const HEARTBEAT = heartbeatPath(WS, STATE_DIR, SHARED_NAME)
mkdirSync(dirname(HEARTBEAT), { recursive: true })
const line = (teamId, at) =>
  JSON.stringify({ kind: "step", at, member: SHARED_NAME, memberKey: SHARED_NAME, teamId, taskId: "t1", attemptId: "att-1", turnId: "g1", workspace: WS })
writeFileSync(HEARTBEAT, line(TEAM_A, RECENT) + "\n" + line(TEAM_B, WEDGED_AT) + "\n")

// ── A: the structural cause ─────────────────────────────────────────────────
const raw = readFileSync(HEARTBEAT, "utf8").split("\n").filter((entry) => entry.trim() !== "").map((entry) => JSON.parse(entry))
check(
  "A1 ONE heartbeat file holds BOTH teams' stamps (the structural cause)",
  raw.length === 2 && new Set(raw.map((entry) => entry.teamId)).size === 2 && HEARTBEAT.includes(SHARED_NAME.toLowerCase()),
  { path: HEARTBEAT.replace(REPO + "/", ""), teams: raw.map((entry) => entry.teamId) },
)

// ── B: the removed predicate, modelled (this is what the code did before) ────
// Same stamps, same task+attempt filter, WITHOUT the team test — exactly the pre-repair filter.
const removedPredicate = (stamps, taskId, attemptId) =>
  stamps.filter((stamp) => stamp.taskId === taskId && (stamp.attemptId ?? "") === (attemptId ?? ""))
const stampsForB = readHeartbeats(WS, STATE_DIR, SHARED_NAME)
const underRemoved = removedPredicate(stampsForB, "t1", "att-1")
const newestUnderRemoved = underRemoved.reduce((best, stamp) => (best === undefined || stamp.at >= best.at ? stamp : best), undefined)
const removedVerdict = {
  stampsKeptForTeamB: underRemoved.map((stamp) => ({ teamId: stamp.teamId, at: stamp.at })),
  newestAt: newestUnderRemoved?.at ?? null,
  newestTeam: newestUnderRemoved?.teamId ?? null,
  silenceMs: newestUnderRemoved === undefined ? null : RECENT - newestUnderRemoved.at,
  wouldWarn: newestUnderRemoved !== undefined && RECENT - newestUnderRemoved.at > knobs.warnSilenceMs,
}
check(
  "B1 FALSE NEGATIVE reproduced by the removed predicate: team-beta's wedged member looks ALIVE",
  removedVerdict.newestTeam === TEAM_A && removedVerdict.silenceMs === 0 && removedVerdict.wouldWarn === false,
  removedVerdict,
)

// ── C: the fix, through the REAL candidateFor ───────────────────────────────
const candidateForB = candidateFor({ id: TEAM_B, tasks: [{ id: "t1", status: "in_progress", assignee: SHARED_NAME, attemptId: "att-1" }] }, () => stampsForB, (name) => name)
const candidateForA = candidateFor({ id: TEAM_A, tasks: [{ id: "t1", status: "in_progress", assignee: SHARED_NAME, attemptId: "att-1" }] }, () => stampsForB, (name) => name)
const bCandidate = candidateForB[0]
const aCandidate = candidateForA[0]
check(
  "C1 team-beta's candidate is now judged on ITS OWN stamp: the wedge is SILENT (a WARN is due)",
  bCandidate !== undefined && bCandidate.lastSeen === WEDGED_AT && bCandidate.everStampedForTask === true && RECENT - bCandidate.lastSeen > knobs.warnSilenceMs,
  bCandidate,
)
check(
  "C2 team-alpha's candidate still sees its own recent stamp (alive, no WARN)",
  aCandidate !== undefined && aCandidate.lastSeen === RECENT && RECENT - aCandidate.lastSeen === 0,
  aCandidate,
)

// ── C3: end to end through the SHIPPED dist ─────────────────────────────────
const deliveries = []
const warnings = []
const services = new Map()
const live = new Map()
const captain = { id: "session-captain-t79", status: "idle", session: { header: { cwd: WS } }, cancel: () => {} }
live.set(captain.id, captain)
live.set("child-" + TEAM_A, { id: "child-" + TEAM_A, status: "idle", session: { header: { cwd: WS } } })
live.set("child-" + TEAM_B, { id: "child-" + TEAM_B, status: "idle", session: { header: { cwd: WS } } })
const ctx = {
  get: (id) => services.get(id),
  provide: (id, value) => services.set(id, value),
  agents: { get: (id) => live.get(id), list: () => [] },
  logger: { warn: (...a) => warnings.push(a.map(String).join(" ")), info: (...a) => warnings.push(a.map(String).join(" ")), error: () => {}, debug: () => {} },
  on: () => () => {},
  effect: () => {},
  inject: () => () => {},
  tools: { register: () => () => {}, get: () => undefined, has: () => false },
  subagents: { prompt: async (request) => (deliveries.push(request), { messageId: "m" }), interrupt: () => {}, drainContinuableChildren: async () => {} },
}
process.env.DSH_WORKSPACE_ROOT = WS
const report = apply(ctx, { stateDir: STATE_DIR, teamCacheMs: 0, tickIntervalMs: 3_600_000, warnSilenceMs: knobs.warnSilenceMs, warnStreakToEscalate: knobs.warnStreakToEscalate, actionOnEscalate: "pause" })
const tick = await report.engine.tickOnce(RECENT + 1)
report.engine.stop()
delete process.env.DSH_WORKSPACE_ROOT
const decisions = tick.decisions.map((d) => ({ type: d.type, teamId: d.teamId, taskId: d.taskId, silenceMs: d.silenceMs }))
check(
  "C3 the shipped engine WARNS for the wedged team and stays silent for the live one",
  decisions.length === 1 && decisions[0].type === "warn" && decisions[0].teamId === TEAM_B,
  { decisions },
)

// ── D: the same-team control — the fix is not a mute ────────────────────────
const sameTeamStamps = [line(TEAM_B, RECENT)].map((entry) => JSON.parse(entry))
const sameTeamCandidate = candidateFor({ id: TEAM_B, tasks: [{ id: "t1", status: "in_progress", assignee: SHARED_NAME, attemptId: "att-1" }] }, () => sameTeamStamps, (name) => name)[0]
check(
  "D1 a member's OWN recent stamp in the SAME team still suppresses the WARN",
  sameTeamCandidate !== undefined && sameTeamCandidate.lastSeen === RECENT && RECENT - sameTeamCandidate.lastSeen === 0,
  sameTeamCandidate,
)
// and the permissive half: a stamp carrying NO team is still counted
const teamlessStamps = [JSON.parse(line(null, RECENT)).teamId = null, JSON.parse(line(null, RECENT))].slice(1)
const teamlessCandidate = candidateFor({ id: TEAM_B, tasks: [{ id: "t1", status: "in_progress", assignee: SHARED_NAME, attemptId: "att-1" }] }, () => teamlessStamps, (name) => name)[0]
check(
  "D2 the permissive convention holds: a stamp with NO team is still counted",
  teamlessCandidate !== undefined && teamlessCandidate.lastSeen === RECENT && teamlessCandidate.everStampedForTask === true,
  teamlessCandidate,
)

const result = {
  task: "t79",
  defect: "the heartbeat FILE is keyed by member NAME per workspace, so two teams whose members share a name share one file; the candidate filter was by task+attempt but NOT by team, so the other team's stamp satisfied this candidate and a WEDGED member looked alive (false negative)",
  fix: "read-side: the candidate's stamps are now filtered by the stamp's own teamId (permissive when the stamp carries none) — no store migration",
  structuralCause: { file: HEARTBEAT.replace(REPO + "/", ""), teamsSharingIt: raw.map((entry) => entry.teamId) },
  removedPredicateModel: removedVerdict,
  realCandidateTeamB: bCandidate,
  realCandidateTeamA: aCandidate,
  shippedEngineDecisions: decisions,
  sameTeamControl: sameTeamCandidate,
  teamlessStampControl: teamlessCandidate,
  checks,
  ok: checks.every((entry) => entry.ok),
}
writeFileSync(join(HERE, "result.json"), JSON.stringify(result, null, 2) + "\n")
console.log(JSON.stringify(result, null, 2))
process.exit(result.ok ? 0 : 1)
