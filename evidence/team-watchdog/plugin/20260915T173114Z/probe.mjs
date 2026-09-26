// t73 (repair round 2) evidence probe — the two w11 findings, before/after.
//
// W11-1: the streak key omitted the TEAM, so two teams in one workspace that both have a `t1`
//        (and a task with an EMPTY attempt id, which the adopted amend path can produce) shared
//        one streak: three single WARNs spread across two healthy teams summed into one ESCALATE
//        that took a SPURIOUS HOLD, while the second team was silently never observed.
// W11-2: the stamp filter was by task id only, so a stamp from an EARLIER attempt satisfied the
//        "has it ever stamped this task" precondition — an old generation's stamp made a task with
//        no current stamp look silent instead of `never-started`.
//
// Part A drives the REAL machine (src) on the exact w11 scenario and prints the fixed per-team
//  behaviour. Part B models the REMOVED keying to show what the same sequence used to produce —
//  it is a model of the old key (`taskId\0attemptId`), not the old code, and it is labelled as
//  such. Part C drives the REAL shipped dist end-to-end over two teams in one workspace.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, "..", "..", "..", "..")
const SRC = join(REPO, "packages", "mpd-team-watchdog-plugin", "src", "machine.ts")
const DIST = join(REPO, "packages", "mpd-team-watchdog-plugin", "dist", "index.js")
for (const required of [SRC, DIST]) {
  if (!existsSync(required)) {
    console.error("FATAL: missing " + required)
    process.exit(2)
  }
}
const { WatchdogMachine, WATCHDOG_DEFAULTS, streakKey } = await import(SRC)
const { apply } = await import(DIST)

const checks = []
const check = (id, ok, detail) => checks.push({ id, ok, ...(detail === undefined ? {} : { detail }) })
const knobs = { ...WATCHDOG_DEFAULTS }
const candidate = (overrides = {}) => ({
  teamId: "team-a",
  taskId: "t1",
  attemptId: "",
  assignee: "Architect",
  memberKey: "Architect",
  lastSeen: 1_000,
  lastKind: "step",
  everStampedForTask: true,
  ...overrides,
})

// ── PART A: the real machine, the w11 sequence ──────────────────────────────
const machine = new WatchdogMachine()
const teamA = candidate({ teamId: "team-a" })
const teamB = candidate({ teamId: "team-b" })
const now = 1_000 + knobs.warnSilenceMs + 1
const sequence = []
// Tick 1: both teams are observed once (the w11 probe's tick0).
sequence.push({ tick: 1, observed: ["team-a", "team-b"], decisions: machine.observe([teamA, teamB], now, knobs).map((d) => ({ type: d.type, team: d.teamId, streak: d.streak })) })
// Tick 2: the same.
sequence.push({ tick: 2, observed: ["team-a", "team-b"], decisions: machine.observe([teamA, teamB], now + 1, knobs).map((d) => ({ type: d.type, team: d.teamId, streak: d.streak })) })
// Tick 3: only team-a is observed (team-b's record is gone).
sequence.push({ tick: 3, observed: ["team-a"], decisions: machine.observe([teamA], now + 2, knobs).map((d) => ({ type: d.type, team: d.teamId, streak: d.streak })) })
// Tick 4: team-b comes back on its own.
sequence.push({ tick: 4, observed: ["team-b"], decisions: machine.observe([teamB], now + 3, knobs).map((d) => ({ type: d.type, team: d.teamId, streak: d.streak })) })

const escalatedTeams = sequence.flatMap((tick) => tick.decisions).filter((d) => d.type === "escalate").map((d) => d.team)
check(
  "A1 each team carries its OWN streak; no cross-team summation",
  sequence[0].decisions.map((d) => d.streak).join(",") === "1,1" && sequence[1].decisions.map((d) => d.streak).join(",") === "2,2",
  sequence.slice(0, 2),
)
check(
  "A2 a team escalates only at its OWN third consecutive warn (team-a at tick 3, never team-b before its own third)",
  sequence[2].decisions.length === 1 && sequence[2].decisions[0].type === "escalate" && sequence[2].decisions[0].team === "team-a" && sequence[3].decisions[0].type === "escalate" && sequence[3].decisions[0].team === "team-b",
  { tick3: sequence[2].decisions, tick4: sequence[3].decisions },
)
check(
  "A3 the escalated set is keyed per TEAM (two distinct keys for the same task id)",
  machine.snapshot().escalated.length === 2 && machine.snapshot().escalated.every((key) => key.split("\u0000").length === 3),
  machine.snapshot().escalated,
)
check("A4 the KEY ITSELF is team-scoped", streakKey("team-a", "t1", "") !== streakKey("team-b", "t1", ""), { a: streakKey("team-a", "t1", ""), b: streakKey("team-b", "t1", "") })

// ── PART B: a MODEL of the removed keying, for the contrast ─────────────────
// This is not the old code: it replays the SAME observations through the OLD key
// (`taskId\0attemptId`) and applies the same 3-strike rule, so the difference is attributable
// to the keying alone.
const oldKeyStreaks = new Map()
const oldKeyEscalated = new Set()
const oldKeySequence = []
for (const tick of sequence) {
  const observed = tick.observed.map((team) => (team === "team-a" ? teamA : teamB))
  const decisions = []
  for (const entry of observed) {
    const key = entry.taskId + "\u0000" + entry.attemptId // THE REMOVED KEY
    if (oldKeyEscalated.has(key)) continue
    const streak = (oldKeyStreaks.get(key) ?? 0) + 1
    if (streak >= knobs.warnStreakToEscalate) {
      oldKeyEscalated.add(key)
      oldKeyStreaks.delete(key)
      decisions.push({ type: "escalate", team: entry.teamId, streak })
    } else {
      oldKeyStreaks.set(key, streak)
      decisions.push({ type: "warn", team: entry.teamId, streak })
    }
  }
  oldKeySequence.push({ tick: tick.tick, observed: tick.observed, decisions })
}
const oldEscalations = oldKeySequence.flatMap((tick) => tick.decisions).filter((d) => d.type === "escalate")
check(
  "B1 the REMOVED keying collapses the two teams into ONE streak and escalates on the 3rd cross-team warn",
  oldKeySequence[0].decisions.map((d) => d.streak).join(",") === "1,2" && oldEscalations.length === 1 && oldEscalations[0].team === "team-a" && oldEscalations[0].streak === 3,
  { oldSequence: oldKeySequence, escalations: oldEscalations },
)
check(
  "B2 under the removed keying the SECOND team is never observed again (one escalation, one team)",
  oldEscalations.length === 1 && new Set(oldEscalations.map((d) => d.team)).size === 1,
  oldEscalations,
)

// ── PART C: the shipped dist, two teams in ONE workspace, end to end ────────
const WS = join(HERE, "raw", "ws")
const STATE_DIR = join(".mpd", "team")
rmSync(WS, { recursive: true, force: true })
const deliveries = []
const warnings = []
const services = new Map()
const live = new Map()
const captain = { id: "session-captain-t73", status: "idle", session: { header: { cwd: WS } }, cancel: () => {} }
live.set(captain.id, captain)
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
const MEMBER_OF = { "team-a": "Architect", "team-b": "Reviewer" }
for (const teamId of ["team-a", "team-b"]) {
  const dir = join(WS, STATE_DIR, teamId)
  mkdirSync(join(dir, "inbox"), { recursive: true })
  writeFileSync(
    join(dir, "team.json"),
    JSON.stringify(
      {
        id: teamId,
        name: teamId,
        captainSessionId: captain.id,
        phase: "running",
        createdAt: 1,
        approvedAt: 1,
        taskSeq: 1,
        // The reachable shape w11 quoted from the adopted amend path: an assignee with NO attemptId.
        // Distinct member NAMES so the per-member heartbeat files stay separate: the store keys
        // its files by member name per workspace, so two teams with the same member name would
        // share one heartbeat file (a layout consequence, noted in result.json).
        members: [{ name: MEMBER_OF[teamId], id: "child-" + teamId, role: "worker", status: "idle" }],
        tasks: [{ id: "t1", subject: "shared task id", assignee: MEMBER_OF[teamId], dependencies: [], status: "in_progress", attempt: 0, createdAt: 1, updatedAt: 1 }],
      },
      null,
      2,
    ) + "\n",
  )
  const heartbeatDir = join(WS, STATE_DIR, "watchdog", "heartbeat")
  mkdirSync(heartbeatDir, { recursive: true })
  // One stamp per team, carrying NO attempt id (the task has none either).
  writeFileSync(
    join(heartbeatDir, MEMBER_OF[teamId].toLowerCase() + ".jsonl"),
    JSON.stringify({ kind: "step", at: 1_000, member: MEMBER_OF[teamId], memberKey: MEMBER_OF[teamId], teamId, taskId: "t1", attemptId: null, turnId: "g1", workspace: WS }) + "\n",
  )
}
process.env.DSH_WORKSPACE_ROOT = WS
const report = apply(ctx, { stateDir: STATE_DIR, teamCacheMs: 0, tickIntervalMs: 3_600_000, warnSilenceMs: knobs.warnSilenceMs, warnStreakToEscalate: knobs.warnStreakToEscalate, actionOnEscalate: "pause" })
const tick = await report.engine.tickOnce(1_000 + knobs.warnSilenceMs + 1)
const holdA = existsSync(join(WS, STATE_DIR, "watchdog", "hold", "team-a.json"))
const holdB = existsSync(join(WS, STATE_DIR, "watchdog", "hold", "team-b.json"))
const decisions = tick.decisions.map((d) => ({ type: d.type, team: d.teamId, task: d.taskId, streak: d.streak }))
readFileSync(join(WS, STATE_DIR, "team-a", "team.json"), "utf8")
check(
  "C1 the SHIPPED dist gives each team its own warn on one tick, and takes NO hold",
  decisions.length === 2 && decisions.every((d) => d.type === "warn" && d.streak === 1) && holdA === false && holdB === false,
  { decisions, holds: { "team-a": holdA, "team-b": holdB } },
)

// ── PART D: W11-2 end to end — a stamp from ANOTHER attempt is not this generation ──
function rewriteTeamA(attemptId, attempt) {
  writeFileSync(
    join(WS, STATE_DIR, "team-a", "team.json"),
    JSON.stringify(
      {
        id: "team-a", name: "team-a", captainSessionId: captain.id, phase: "running", createdAt: 1, approvedAt: 1, taskSeq: 1,
        members: [{ name: MEMBER_OF["team-a"], id: "child-team-a", role: "worker", status: "idle" }],
        tasks: [{ id: "t1", subject: "shared task id", assignee: MEMBER_OF["team-a"], dependencies: [], status: "in_progress", attempt, createdAt: 1, updatedAt: 1, ...(attemptId === undefined ? {} : { attemptId }) }],
      },
      null, 2,
    ) + "\n",
  )
}
function rewriteStamp(attemptId) {
  writeFileSync(
    join(WS, STATE_DIR, "watchdog", "heartbeat", MEMBER_OF["team-a"].toLowerCase() + ".jsonl"),
    JSON.stringify({ kind: "step", at: 1_000, member: MEMBER_OF["team-a"], memberKey: MEMBER_OF["team-a"], teamId: "team-a", taskId: "t1", attemptId, turnId: "g1", workspace: WS }) + "\n",
  )
}
// (1) the task is now attempt 2, but the only stamp belongs to attempt 1 → NOT this generation.
rewriteTeamA("att-2", 2)
rewriteStamp("att-1")
const neverStartedBefore = report.engine.getStats().neverStarted
const staleTick = await report.engine.tickOnce(1_000 + knobs.warnSilenceMs * 4 + 1)
// NOTE (measured, and worth knowing): a `never-started` observation is deliberately NOT pushed
// into `TickResult.decisions` — the tick records it durably and counts it, then `continue`s
// before the WARN/ESCALATE push. So the proof reads the ARTIFACTS (the incident record and the
// counter), not the decision list, which stays the WARN/ESCALATE list.
const staleForTeamA = staleTick.decisions.filter((d) => d.teamId === "team-a")
const staleIncidents = readFileSync(join(WS, STATE_DIR, "watchdog", "incidents.jsonl"), "utf8")
  .split("\n")
  .filter((line) => line.trim() !== "")
  .map((line) => JSON.parse(line))
  .filter((incident) => incident.kind === "never-started" && incident.teamId === "team-a" && incident.taskId === "t1")
check(
  "D1 a stamp from an EARLIER attempt does NOT satisfy the precondition: never-started, not a warn",
  staleForTeamA.length === 0 && report.engine.getStats().neverStarted === neverStartedBefore + 1 && staleIncidents.length === 1 && staleIncidents[0].attemptId === "att-2" && staleIncidents[0].scene === null,
  { warnDecisionsForTeamA: staleForTeamA, neverStarted: report.engine.getStats().neverStarted, incidents: staleIncidents },
)
// (2) the SAME task, the stamp moved to the CURRENT attempt → silence again (the fix is not a mute).
rewriteStamp("att-2")
const freshTick = await report.engine.tickOnce(1_000 + knobs.warnSilenceMs * 5 + 1)
const freshForTeamA = freshTick.decisions.filter((d) => d.teamId === "team-a")
check(
  "D2 the SAME task with a stamp on the CURRENT attempt warns again (direction two)",
  freshForTeamA.length === 1 && freshForTeamA[0].type === "warn" && freshForTeamA[0].streak === 1,
  freshForTeamA,
)
report.engine.stop()
delete process.env.DSH_WORKSPACE_ROOT

const result = {
  task: "t73",
  findings: {
    "W11-1": "the streak key omitted the team id, so two teams sharing a task id and an empty attempt id shared one streak (spurious HOLD + a silently unobserved team)",
    "W11-2": "the stamp filter was by task id only, so a stamp from an EARLIER attempt satisfied the precondition",
  },
  fix: {
    key: 'streakKey(teamId, taskId, attemptId) === teamId + "\\u0000" + taskId + "\\u0000" + attemptId',
    threadedThrough: ["observe()", "clear()", "hasEscalated()", "snapshot()", "engine.ts scene streaks", "scene.ts task.streak lookup", "test/machine.test.ts"],
    stampFilter: "a stamp that CARRIES a non-empty attempt id must equal the task's; a stamp with no attempt information cannot contradict and is kept",
  },
  partA_realMachine: sequence,
  partB_modelOfRemovedKeying: { note: "a MODEL of the old key, not the old code — same observations, same 3-strike rule, old `taskId\\0attemptId` key", sequence: oldKeySequence },
  partC_shippedDist: { decisions, holds: { "team-a": holdA, "team-b": holdB }, warnings: warnings.filter((line) => line.includes("ESCALATE") || line.includes("WARN")) },
  partD_attemptFilter: { staleAttemptWarnDecisions: staleForTeamA, staleAttemptIncidents: staleIncidents, currentAttemptObservations: freshForTeamA },
  neverStartedIsNotInTickDecisions: "measured: the tick records a never-started observation durably and counts it, then `continue`s before the WARN/ESCALATE push, so TickResult.decisions stays the WARN/ESCALATE list",
  observation: "The heartbeat store keys its files by MEMBER NAME per workspace, so two teams whose member shares a name would share one heartbeat file. This probe gives the teams distinct member names to keep the attribution clean; the shared-file case is a layout consequence NOT addressed by this repair (the streak keying is).",
  escalatedTeams,
  checks,
  ok: checks.every((entry) => entry.ok),
}
writeFileSync(join(HERE, "result.json"), JSON.stringify(result, null, 2) + "\n")
console.log(JSON.stringify(result, null, 2))
process.exit(result.ok ? 0 : 1)
