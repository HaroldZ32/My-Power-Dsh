// t70 machine probe — drives the REAL WatchdogMachine (source import, no tree edit).
import { WatchdogMachine, WATCHDOG_DEFAULTS, streakKey, readKnobs } from "/root/dshProj/my-power-dsh/packages/mpd-team-watchdog-plugin/src/machine.ts"

const K = { ...WATCHDOG_DEFAULTS }
const cand = (teamId, taskId, attemptId, lastSeen, stamped = true) => ({
  teamId, taskId, attemptId, assignee: "Architect", memberKey: "architect", lastSeen, stampedThisGeneration: stamped,
})
const out = {}

// 1) exactly one ESCALATE per key and NO fourth WARN (silence 200s > 90s threshold)
{
  const m = new WatchdogMachine()
  const c = cand("teamA", "t1", "attempt-1", 0)
  const seq = [1, 2, 3, 4, 5].map((tick) => m.observe([c], tick * 100_000, K).map((d) => d.type + ":" + d.streak))
  out.oneEscalateNoFourthWarn = { seq, snapshot: m.snapshot() }
}

// 2) a NEW attemptId starts a clean streak (the retry case)
{
  const m = new WatchdogMachine()
  const a1 = cand("teamA", "t1", "attempt-1", 0)
  const a2 = cand("teamA", "t1", "attempt-2", 0)
  const t1 = m.observe([a1], 100_000, K).map((d) => d.type + ":" + d.streak)
  const t2 = m.observe([a2], 200_000, K).map((d) => d.type + ":" + d.streak)
  out.newAttemptStartsClean = { firstAttempt: t1, secondAttempt: t2 }
}

// 3) FLAPPING: WARN, recovery, WARN, recovery ... must never escalate
{
  const m = new WatchdogMachine()
  const seq = []
  for (let i = 1; i <= 6; i++) {
    seq.push(m.observe([cand("teamA", "t1", "a", 0)], i * 100_000, K).map((d) => d.type))       // silent -> WARN
    seq.push(m.observe([cand("teamA", "t1", "a", i * 100_000)], i * 100_000, K).map((d) => d.type)) // fresh stamp -> recovery
  }
  out.flapping = { seq: seq.map((s) => s.join("") || "none"), escalated: m.snapshot().escalated }
}

// 4) the FROZEN thresholds really used (not a scaled shortcut): silence just under vs over 90_000
{
  const m1 = new WatchdogMachine()
  const under = m1.observe([cand("teamA", "t1", "a", 0)], 90_000, K)          // == threshold -> no WARN
  const justOver = m1.observe([cand("teamA", "t1", "a", 0)], 90_001, K)       // > threshold -> WARN
  const escalatedAt = [1, 2, 3, 4].map((i) => {
    const mm = new WatchdogMachine()
    let last = []
    for (let n = 0; n < i; n++) last = mm.observe([cand("b", "t9", "z", 0)], 1_000_000 + n, K)
    return { at: i, kinds: last.map((d) => d.type) }
  })
  out.frozenThresholds = { thresholdMs: K.warnSilenceMs, streakToEscalate: K.warnStreakToEscalate, underKinds: under.map(d=>d.type), justOverKinds: justOver.map(d=>d.type), escalateAtIndex: escalatedAt }
}

// 5) CROSS-TEAM COLLISION: two teams, same taskId, same (empty) attemptId -> shared streak?
{
  const m = new WatchdogMachine()
  const A = cand("teamA", "t1", "", 0)
  const B = cand("teamB", "t1", "", 0)
  // one tick at a time, alternating teams, so each team sees only ONE warn per tick
  const seq = []
  for (let i = 0; i < 3; i++) {
    seq.push({ tick: i, A: m.observe([A], 100_000 + i, K).map((d) => d.type + ":" + d.streak + ":" + d.teamId) })
    seq.push({ tick: i, B: m.observe([B], 100_000 + i, K).map((d) => d.type + ":" + d.streak + ":" + d.teamId) })
  }
  out.crossTeamCollision = { keyForEmptyAttempt: streakKey("t1", ""), seq, escalated: m.snapshot().escalated, note: "each team observed its own task ONCE per tick; a per-team machine would never escalate either" }
}

// 6) a stamp arriving resets (clear) and a never-started task is reported once, never escalating
{
  const m = new WatchdogMachine()
  const never = cand("teamA", "t2", "a", null, false)
  const seq = [1, 2].map((i) => m.observe([never], i * 100_000, K).map((d) => d.type))
  out.neverStarted = seq
}
console.log(JSON.stringify(out, null, 1))
