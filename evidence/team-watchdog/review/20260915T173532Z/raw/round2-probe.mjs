// t74 round-2 probe — drives the REAL pipeline (candidateFor + WatchdogMachine) on the CURRENT shape.
import { WatchdogMachine, WATCHDOG_DEFAULTS, streakKey, candidateFor } from "/root/dshProj/my-power-dsh/packages/mpd-team-watchdog-plugin/src/machine.ts"
const K = { ...WATCHDOG_DEFAULTS }
const team = (id, taskId = "t1", attemptId = "", status = "in_progress", assignee = "Architect") =>
  ({ id, tasks: [{ id: taskId, status, assignee, ...(attemptId === null ? {} : { attemptId }) }] })
const stamps = (list) => () => list
const st = (taskId, at, kind = "step", attemptId) => ({ taskId, at, kind, memberKey: "architect", ...(attemptId === undefined ? {} : { attemptId }) })
const out = {}

// 1) THE FIXED CROSS-TEAM CASE: two teams, same task id, EMPTY attempt id, each observed once per tick
{
  const m = new WatchdogMachine()
  const A = team("team-a"), B = team("team-b")
  const cA = candidateFor(A, stamps([st("t1", 0)]), () => "architect")[0]
  const cB = candidateFor(B, stamps([st("t1", 0)]), () => "architect")[0]
  out.candidateShape = Object.keys(cA).join(",")
  const seq = []
  for (let i = 0; i < 4; i++) {
    seq.push({ tick: i, A: m.observe([cA], 100_000 + i, K).map((d) => d.type + ":" + d.streak + ":" + d.teamId) })
    seq.push({ tick: i, B: m.observe([cB], 100_000 + i, K).map((d) => d.type + ":" + d.streak + ":" + d.teamId) })
  }
  out.crossTeam = { keyA: streakKey("team-a", "t1", ""), keyB: streakKey("team-b", "t1", ""), seq, escalated: m.snapshot().escalated }
}

// 2) the NEW turn-end guard (T69-ESCALATE-1): a newest `turn-end` stamp is not a wedge
{
  const m = new WatchdogMachine()
  const c = candidateFor(team("t", "t1", "att-1"), stamps([st("t1", 0, "turn-end", "att-1")]), () => "architect")[0]
  out.turnEnd = { lastKind: c.lastKind, decisions: [1, 2, 3, 4].map((i) => m.observe([c], i * 100_000, K).map((d) => d.type)), escalated: m.snapshot().escalated }
}

// 3) the five original attacks on the real pipeline
{
  const m = new WatchdogMachine()
  const c = candidateFor(team("t", "t1", "att-1"), stamps([st("t1", 0, "step", "att-1")]), () => "architect")[0]
  out.oneEscalateNoFourthWarn = [1,2,3,4,5].map((i) => m.observe([c], i * 100_000, K).map((d) => d.type + ":" + d.streak))
}
{
  const m = new WatchdogMachine()
  const old = candidateFor(team("t", "t1", "att-1"), stamps([st("t1", 0, "step", "att-1")]), () => "architect")[0]
  const fresh = candidateFor(team("t", "t1", "att-2"), stamps([st("t1", 0, "step", "att-2")]), () => "architect")[0]
  out.newAttemptStartsClean = { old: m.observe([old], 100_000, K).map((d) => d.type + ":" + d.streak), fresh: m.observe([fresh], 200_000, K).map((d) => d.type + ":" + d.streak) }
}
{
  const m = new WatchdogMachine()
  const c = candidateFor(team("t", "t1", "att-1"), stamps([st("t1", 0, "step", "att-1")]), () => "architect")[0]
  const seq = []
  for (let i = 1; i <= 6; i++) {
    seq.push(m.observe([c], i * 100_000, K).map((d) => d.type))
    const recovered = candidateFor(team("t", "t1", "att-1"), stamps([st("t1", i * 100_000, "step", "att-1")]), () => "architect")[0]
    seq.push(m.observe([recovered], i * 100_000, K).map((d) => d.type))
  }
  out.flapping = { seq: seq.map((s) => s.join("") || "none"), escalated: m.snapshot().escalated }
}
{
  const m1 = new WatchdogMachine()
  const at = candidateFor(team("t", "t1", "att-1"), stamps([st("t1", 0, "step", "att-1")]), () => "architect")[0]
  out.frozenThresholds = { threshold: K.warnSilenceMs, streakToEscalate: K.warnStreakToEscalate, atThreshold: m1.observe([at], 90_000, K).map((d) => d.type), justOver: m1.observe([at], 90_001, K).map((d) => d.type) }
}
{
  const m = new WatchdogMachine()
  const c = candidateFor(team("t", "t2", "att-1"), stamps([]), () => "architect")[0]
  out.neverStarted = { lastSeen: c.lastSeen, everStamped: c.everStampedForTask, decisions: [1, 2].map((i) => m.observe([c], i * 100_000, K).map((d) => d.type)) }
}

// 4) W11-2: a stamp naming ANOTHER attempt must not satisfy this generation
{
  const t2 = team("t", "t1", "att-2")
  out.w11_2 = {
    otherAttempt: candidateFor(t2, stamps([st("t1", 111, "step", "att-1")]), () => "architect")[0],
    sameAttempt: candidateFor(t2, stamps([st("t1", 222, "step", "att-2")]), () => "architect")[0],
    attemptless: candidateFor(t2, stamps([st("t1", 333, "step")]), () => "architect")[0],
  }
}
console.log(JSON.stringify(out, null, 1))
