// The watchdog's knobs and its WARN -> ESCALATE state machine.
//
// The machine is deliberately small and pure enough to drive from a test with an
// injected `now`: the tick owns the clock, the machine owns the arithmetic.
//
//   OBSERVE (every tickIntervalMs)
//     silence = now - newestStamp(owner, task)
//     if the owner has a turn expected in flight AND silence > warnSilenceMs:
//         WARN(task, attemptId)   -> snapshot + notice
//         streak[task] += 1
//         if streak[task] >= warnStreakToEscalate:
//             ESCALATE(task, attemptId) -> scene + HOLD(team) + notice
//             the key is then DONE: no fourth WARN, no second ESCALATE
//     else:
//         streak[task] = 0
//
// The silence candidate set is NOT "every non-terminal task": a task whose owner
// is legitimately between turns is silent by design, and three WARNs against it
// would escalate a healthy team (design §0/GAP-1). A candidate therefore requires
// that the owner has actually stamped this task at least once in this generation
// — a claimed task that never stamped is reported `never-started`, a dispatch
// observation that never escalates.
import type { HeartbeatKind, HeartbeatStamp } from "./store.js"
import { TERMINAL_STATUSES } from "./team.js"

/** The five `mpd`-namespace watchdog knobs, resolved. */
export interface WatchdogKnobs {
  /** The kill switch (AC-10); `MPD_DSH_TEAM_WATCHDOG=off` also forces it off. */
  enabled: boolean
  /** Silence beyond this many ms is a WARN. */
  warnSilenceMs: number
  /** Tick cadence; must be < warnSilenceMs for the streak arithmetic to hold. */
  tickIntervalMs: number
  /** Consecutive WARNs for ONE task+attempt before ESCALATE. */
  warnStreakToEscalate: number
  /** What ESCALATE does: persist a hold (`pause`) or only record it (`warn-only`). */
  actionOnEscalate: "pause" | "warn-only"
}

/** The frozen defaults (plan §2.1 / D2). */
export const WATCHDOG_DEFAULTS: WatchdogKnobs = {
  enabled: true,
  warnSilenceMs: 90_000,
  tickIntervalMs: 15_000,
  warnStreakToEscalate: 3,
  actionOnEscalate: "pause",
}

/** A knob that had to be rejected or clamped, with the reason. */
export interface KnobIssue {
  path: string
  problem: string
  fallback: unknown
}

/** The resolved knobs plus every adjustment made while reading them. */
export interface ResolvedKnobs extends WatchdogKnobs {
  issues: KnobIssue[]
}

/**
 * Read the watchdog knobs out of the resolved `mpd` settings value.
 *
 * Unknown keys are KEPT by schemastery, so the `watchdog` object is readable
 * before its declaration lands in `mpd-config`'s schema — the declaration only
 * makes the knobs visible/editable in the two front doors.
 *
 * The row config is the DEFAULTS layer and the namespace is the live override:
 * a composition that writes no `watchdog` section keeps the row's values, and an
 * edit in either front door wins from then on (AC-11).
 *
 * @param namespaceValue - `settingsReader("mpd").get()`.
 * @param env - the process environment (injectable for tests).
 * @param defaults - the row config's values (the base layer).
 * @returns the knobs with every key resolved, plus the adjustments made.
 */
export function readKnobs(
  namespaceValue: unknown,
  env: Record<string, string | undefined> = process.env,
  defaults: WatchdogKnobs = WATCHDOG_DEFAULTS,
): ResolvedKnobs {
  const issues: KnobIssue[] = []
  const root = namespaceValue !== null && typeof namespaceValue === "object" ? (namespaceValue as Record<string, unknown>) : {}
  const sectionRaw = root.watchdog
  const section = sectionRaw !== null && typeof sectionRaw === "object" ? (sectionRaw as Record<string, unknown>) : {}

  const number = (key: keyof WatchdogKnobs, min: number): number => {
    const raw = section[key]
    if (raw === undefined) return defaults[key] as number
    if (typeof raw !== "number" || !Number.isFinite(raw) || raw < min) {
      issues.push({ path: "watchdog." + String(key), problem: "expected a finite number >= " + min, fallback: defaults[key] })
      return defaults[key] as number
    }
    return raw
  }

  const warnSilenceMs = number("warnSilenceMs", 1)
  let tickIntervalMs = number("tickIntervalMs", 1)
  if (tickIntervalMs >= warnSilenceMs) {
    // The streak arithmetic needs at least two observations inside one silence
    // window; a cadence at or beyond the threshold would WARN at most once and
    // could never escalate. Clamp instead of throwing: an apply-time throw takes
    // the whole row (and possibly the preset) down (AGENTS.md §12).
    const clamped = Math.max(1, Math.floor(warnSilenceMs / 3))
    issues.push({
      path: "watchdog.tickIntervalMs",
      problem: "must be < watchdog.warnSilenceMs (" + warnSilenceMs + "); clamped",
      fallback: clamped,
    })
    tickIntervalMs = clamped
  }

  let warnStreakToEscalate = number("warnStreakToEscalate", 1)
  if (!Number.isInteger(warnStreakToEscalate)) {
    const clamped = Math.max(1, Math.round(warnStreakToEscalate))
    issues.push({ path: "watchdog.warnStreakToEscalate", problem: "expected an integer; rounded", fallback: clamped })
    warnStreakToEscalate = clamped
  }

  let actionOnEscalate: "pause" | "warn-only" = defaults.actionOnEscalate
  if (section.actionOnEscalate !== undefined) {
    if (section.actionOnEscalate === "pause" || section.actionOnEscalate === "warn-only") {
      actionOnEscalate = section.actionOnEscalate
    } else {
      issues.push({ path: "watchdog.actionOnEscalate", problem: "expected 'pause' | 'warn-only'", fallback: defaults.actionOnEscalate })
    }
  }

  let enabled = defaults.enabled
  if (section.enabled !== undefined) {
    if (typeof section.enabled === "boolean") enabled = section.enabled
    else {
      issues.push({ path: "watchdog.enabled", problem: "expected a boolean", fallback: defaults.enabled })
    }
  }
  if (env.MPD_DSH_TEAM_WATCHDOG === "off" || env.MPD_DSH_TEAM_WATCHDOG === "0" || env.MPD_DSH_TEAM_WATCHDOG === "false") {
    enabled = false
  }

  return { enabled, warnSilenceMs, tickIntervalMs, warnStreakToEscalate, actionOnEscalate, issues }
}

/** One silence candidate: a live task whose owner is expected to be stepping. */
export interface SilenceCandidate {
  teamId: string
  taskId: string
  attemptId: string
  assignee: string
  /** The heartbeat file key of the owner. */
  memberKey: string
  /** The newest stamp for this task+attempt, or null when none was ever written. */
  lastSeen: number | null
  /**
   * The KIND of that newest stamp — the field the boundary predicate reads.
   *
   * A `turn-end` newest stamp means the owner FINISHED its turn and is between turns,
   * which is a healthy idle member, not a wedge (T69-ESCALATE-1). `null` when no stamp
   * was ever written, i.e. the `never-started` case.
   */
  lastKind: HeartbeatKind | null
  /**
   * Whether ANY stamp for this task+attempt was ever written (not "in this generation":
   * heartbeat rotation keeps the last generations, so a historical stamp still counts).
   * This is the precondition that separates `never-started` from `silence`.
   */
  everStampedForTask: boolean
}

/** What one observation concluded about one candidate. */
export type Decision =
  | { type: "warn"; teamId: string; taskId: string; attemptId: string; assignee: string; memberKey: string; silenceMs: number; lastSeen: number; streak: number }
  | { type: "escalate"; teamId: string; taskId: string; attemptId: string; assignee: string; memberKey: string; silenceMs: number; lastSeen: number; streak: number }
  | { type: "never-started"; teamId: string; taskId: string; attemptId: string; assignee: string; memberKey: string }

/**
 * The streak key: per TEAM, per task AND per attempt.
 *
 * The TEAM is part of the key because task ids are per-team (`t1`, `t2`, … are allocated by
 * each team's own `taskSeq`), so two teams in one workspace both have a `t1` — and a `pending`
 * task can carry an assignee with NO attemptId at all. Keying on `taskId\0attemptId` alone made
 * those two tasks share one streak: three single WARNs spread across TWO healthy teams summed
 * into one ESCALATE attributed to the first team, which then took a SPURIOUS HOLD while the
 * second team was silently never observed (w11/T70 finding W11-1, reproduced on the real
 * machine). A retry still starts clean, because the attemptId stays in the key.
 */
export function streakKey(teamId: string, taskId: string, attemptId: string): string {
  return teamId + "\u0000" + taskId + "\u0000" + attemptId
}

/**
 * The WARN -> ESCALATE state machine.
 *
 * One instance per process. `observe` is called once per tick per candidate; it
 * is deterministic for a given (candidates, now, knobs) triple, which is what
 * makes the fixture lanes able to assert exact WARN/ESCALATE counts.
 */
export class WatchdogMachine {
  /** Consecutive WARN counts, keyed `taskId\0attemptId`. */
  private readonly streaks = new Map<string, number>()
  /** Keys that already escalated: exactly one ESCALATE, and no fourth WARN. */
  private readonly escalated = new Set<string>()
  /** Keys already reported `never-started` (reported once per generation). */
  private readonly neverStarted = new Set<string>()

  /**
   * Observe every candidate once.
   *
   * @param candidates - the silence candidates of this tick.
   * @param now - the tick's clock (injectable).
   * @param knobs - the resolved knobs.
   * @returns the decisions, in candidate order.
   */
  observe(candidates: readonly SilenceCandidate[], now: number, knobs: WatchdogKnobs): Decision[] {
    if (!knobs.enabled) return []
    const decisions: Decision[] = []
    for (const candidate of candidates) {
      const key = streakKey(candidate.teamId, candidate.taskId, candidate.attemptId)
      if (this.escalated.has(key)) continue
      // BETWEEN TURNS IS NOT A WEDGE (T69-ESCALATE-1). The newest stamp being a
      // `turn-end` means the member completed its turn and has simply not been
      // re-dispatched: escalating that would hold a healthy team ~120 s after every
      // finished turn with no ready task. Withhold the observation AND reset the streak,
      // so a stale streak can never be spent once the member starts working again.
      if (candidate.lastKind === "turn-end") {
        this.streaks.delete(key)
        continue
      }
      if (candidate.lastSeen === null || !candidate.everStampedForTask) {
        if (!this.neverStarted.has(key)) {
          this.neverStarted.add(key)
          decisions.push({
            type: "never-started",
            teamId: candidate.teamId,
            taskId: candidate.taskId,
            attemptId: candidate.attemptId,
            assignee: candidate.assignee,
            memberKey: candidate.memberKey,
          })
        }
        this.streaks.delete(key)
        continue
      }
      const silenceMs = now - candidate.lastSeen
      if (silenceMs <= knobs.warnSilenceMs) {
        this.streaks.delete(key)
        continue
      }
      const streak = (this.streaks.get(key) ?? 0) + 1
      const base = {
        teamId: candidate.teamId,
        taskId: candidate.taskId,
        attemptId: candidate.attemptId,
        assignee: candidate.assignee,
        memberKey: candidate.memberKey,
        silenceMs,
        lastSeen: candidate.lastSeen,
        streak,
      }
      if (streak >= knobs.warnStreakToEscalate) {
        this.escalated.add(key)
        this.streaks.delete(key)
        decisions.push({ type: "escalate", ...base })
      } else {
        this.streaks.set(key, streak)
        decisions.push({ type: "warn", ...base })
      }
    }
    return decisions
  }

  /** A stamp arrived for a key: the streak resets and the key is not escalated. */
  clear(teamId: string, taskId: string, attemptId: string): void {
    const key = streakKey(teamId, taskId, attemptId)
    this.streaks.delete(key)
    this.neverStarted.delete(key)
  }

  /** Whether a TEAM's task+attempt already escalated (the tick's idempotence check). */
  hasEscalated(teamId: string, taskId: string, attemptId: string): boolean {
    return this.escalated.has(streakKey(teamId, taskId, attemptId))
  }

  /** The current streak map, for diagnostics and assertions. */
  snapshot(): { streaks: Record<string, number>; escalated: string[] } {
    return { streaks: Object.fromEntries(this.streaks), escalated: [...this.escalated].sort() }
  }
}

/** A candidate's silence, derived from its heartbeat file (the tick's input). */
export function candidateFor(
  team: { id: string; tasks: readonly { id: string; status: string; assignee?: string; attemptId?: string }[] },
  stampSource: (memberKey: string) => readonly HeartbeatStamp[],
  memberKeyOf: (assignee: string) => string,
): SilenceCandidate[] {
  const candidates: SilenceCandidate[] = []
  for (const task of team.tasks) {
    if (task.assignee === undefined || TERMINAL_STATUSES.includes(task.status)) continue
    const memberKey = memberKeyOf(task.assignee)
    const attemptId = task.attemptId ?? ""
    const stamps = stampSource(memberKey)
    // W11-2: the filter is by task id AND, when the stamp CARRIES one, by attempt id. A stamp
    // with no attempt information (undefined/null/empty) cannot contradict this generation and
    // is kept; a stamp that names a DIFFERENT attempt belongs to an earlier generation and must
    // not satisfy the precondition (it used to, so an old generation's stamp made a task with no
    // current stamp look "silent" instead of "never started").
    const taskAttempt = task.attemptId ?? ""
    const forTask = stamps.filter((stamp) => {
      if (stamp.taskId !== task.id) return false
      // TEAM SCOPE (r2, the false-negative repair): the heartbeat FILE is keyed by MEMBER NAME
      // per workspace (`heartbeatPath`), and roster names repeat across teams, so two teams whose
      // members share a name append to ONE file. Without this test the other team's stamp
      // satisfies this candidate and a WEDGED member looks alive — the watchdog stays silent,
      // which is the one failure mode this whole wave exists to prevent. A stamp that carries NO
      // team cannot contradict this team and is kept, the same permissive convention the attempt
      // rule below uses (and the reason the writer records `teamId` on every stamp).
      const stampTeam = stamp.teamId
      if (stampTeam !== undefined && stampTeam !== null && stampTeam !== "" && stampTeam !== team.id) return false
      const stampAttempt = stamp.attemptId
      if (stampAttempt === undefined || stampAttempt === null || stampAttempt === "") return true
      return stampAttempt === taskAttempt
    })
    const newest = forTask.reduce<HeartbeatStamp | undefined>((best, stamp) => (best === undefined || stamp.at >= best.at ? stamp : best), undefined)
    candidates.push({
      teamId: team.id,
      taskId: task.id,
      attemptId,
      assignee: task.assignee,
      memberKey,
      lastSeen: newest === undefined ? null : newest.at,
      lastKind: newest === undefined ? null : newest.kind,
      everStampedForTask: forTask.length > 0,
    })
  }
  return candidates
}
