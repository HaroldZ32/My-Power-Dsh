// The watchdog's knobs and its WARN -> ESCALATE state machine.
//
// The machine is deliberately small and pure enough to drive from a test with an
// injected `now`: the tick owns the clock, the machine owns the arithmetic.
//
//   OBSERVE (every tickIntervalMs)
//     THE CHANNEL PREDICATE DECIDES THE STATE (contract §1, T-48/D1). When the
//     candidate carries a `channelState` from the `session/event` fold, that state is
//     the ONE authority:
//         PARKED / ALIVE  -> never a wedge, regardless of age; streak reset
//         IN-FLIGHT       -> explained until `toolInFlightMaxMs` past the call start,
//                            then exactly ONE `tool-expired` report (never a hold)
//         OUTSTANDING     -> the ONLY warnable state: WARN once `warnSilenceMs` has
//                            elapsed SINCE THE REQUEST BECAME OUTSTANDING, then
//                            ESCALATE after `warnStreakToEscalate` consecutive
//                            OUTSTANDING observations
//     Without channel evidence the machine runs the heartbeat rule (§4 degradation)
//     in REPORT-ONLY mode when the candidate says `heartbeatFallback`: it may WARN
//     ONCE (cause `silence-heartbeat`) and may NEVER hold or escalate.
//
//     ESCALATE holds ONLY when `actionOnEscalate === "pause"` (§3: the default is
//     `warn-only`, so a WARN is a report and nothing more).
//
// The silence candidate set is NOT "every non-terminal task": a task whose owner
// is legitimately between turns is silent by design, and three WARNs against it
// would escalate a healthy team (design §0/GAP-1). A candidate therefore requires
// that the owner has actually stamped this task at least once in this generation
// — a claimed task that never stamped is reported `never-started`, a dispatch
// observation that never escalates.
import type { HeartbeatKind, HeartbeatStamp } from "./store.js"
import { TERMINAL_STATUSES } from "./team.js"

/**
 * The four channel states of frozen contract §1.
 *
 * `null` (never this literal) means NO CHANNEL EVIDENCE for that member session —
 * the caller then uses the heartbeat rule in report-only mode (§4).
 */
export type ChannelState = "OUTSTANDING" | "IN-FLIGHT" | "ALIVE" | "PARKED"

/** Why a WARN/ESCALATE was recorded; the durable incident carries it verbatim. */
export type WatchdogCause = "silence-channel" | "silence-heartbeat"

/** The `mpd`-namespace watchdog knobs, resolved. */
export interface WatchdogKnobs {
  /** The kill switch (AC-10); `MPD_DSH_TEAM_WATCHDOG=off` also forces it off. */
  enabled: boolean
  /** How long a request may stay OUTSTANDING before the FIRST warn (§3). */
  warnSilenceMs: number
  /** Tick cadence; must be < warnSilenceMs for the streak arithmetic to hold. */
  tickIntervalMs: number
  /** Consecutive OUTSTANDING observations for ONE task+attempt before ESCALATE. */
  warnStreakToEscalate: number
  /** What ESCALATE does: persist a hold (`pause`) or only record it (`warn-only`). */
  actionOnEscalate: "pause" | "warn-only"
  /**
   * THE SECONDARY BOUND (r6). A tool call in flight suppresses the silence rule for at
   * most this long; past it the entry stops suppressing and is reported ONCE as a
   * `tool-expired` WARN-class incident (never a scene, never a hold, never an escalate).
   * `0` disables the whole in-flight suppression, i.e. the pre-r6 behaviour — which is
   * also this feature's falsifier.
   */
  toolInFlightMaxMs: number
  /**
   * T-17's auto-release bound (§3, new knob): a hold a `pause` escalation persisted is
   * released after this long, with a durable `hold-auto-released` incident. `0` = never
   * expire. Read by the hold registry; the machine itself never holds a team by itself.
   */
  holdTtlMs: number
}

/** The frozen defaults (frozen contract §3, T-48/D3). */
export const WATCHDOG_DEFAULTS: WatchdogKnobs = {
  enabled: true,
  // 10 minutes of an OUTSTANDING (answered-nothing) request before the first WARN. The
  // old 90 s inferred a wedge from wall-clock silence, which the channel predicate no
  // longer does: a long ANSWER and a long TOOL CALL are both explained, so the bound
  // only ever bounds a request nobody is answering.
  warnSilenceMs: 90_000,
  tickIntervalMs: 15_000,
  // Six consecutive OUTSTANDING observations after the first WARN — a NARROWER ladder
  // than the old three, because the surviving trigger (a genuinely unanswered request)
  // is the expensive one to get wrong in either direction.
  warnStreakToEscalate: 6,
  // §3: ESCALATE records by default. A hold is an explicit opt-in (`pause`).
  actionOnEscalate: "warn-only",
  // 10x the warn bound: long enough for any real build/boot/lane this workspace runs,
  // short enough that a genuinely hung tool is reported inside a quarter of an hour.
  toolInFlightMaxMs: 900_000,
  // 15 minutes: a hold that nobody resumed releases itself and leaves a durable record.
  holdTtlMs: 900_000,
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

  // The r6 in-flight bound. 0 is a MEANINGFUL value (suppression disabled), so the
  // floor is 0 rather than 1 — and it is read through the same guarded path as the rest.
  const toolInFlightMaxMs = number("toolInFlightMaxMs", 0)

  // T-17's hold TTL (§3). 0 is likewise meaningful (`never expire`).
  const holdTtlMs = number("holdTtlMs", 0)

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

  return { enabled, warnSilenceMs, tickIntervalMs, warnStreakToEscalate, actionOnEscalate, toolInFlightMaxMs, holdTtlMs, issues }
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
  /**
   * EXPLAINED ACTIVITY (r6): the `at` of an unmatched PRE stamp — a tool call this member
   * started and has not reported completing — or `null` when no call is in flight.
   *
   * This is the whole point of r6: a member that spends 20 minutes inside ONE `bash` call
   * is WORKING, not wedged, and the POST-only stamp stream cannot tell the difference.
   *
   * Under the channel predicate the STATE comes from the fold and these stamps decide only
   * the `tool-expired` BOUND (§1 rule 1); they remain the whole fallback source in §4.
   */
  inFlightSince: number | null
  /** The tool name of that in-flight call (diagnostics), or null. */
  inFlightTool: string | null
  /**
   * THE CHANNEL PREDICATE (contract §1, T-48/D1): the state the `session/event` fold
   * concluded for this candidate's owner session, or `null`/absent when the fold has NO
   * evidence for that member.
   *
   * Absent (`undefined`) means the caller supplied no channel view at all (a unit test
   * driving the heartbeat rule directly); that is the same heartbeat path, without the
   * report-only cap. `null` means the caller DID ask the fold and it had nothing — that
   * is the §4 degradation case and it is reported, never silent (see `heartbeatFallback`).
   */
  channelState?: ChannelState | null
  /** When the owner's open request became OUTSTANDING (ms epoch), from the fold. */
  outstandingSince?: number | null
  /**
   * The open tool call's start as the FOLD saw it (ms epoch) — the bound's fallback clock
   * when the heartbeat stamps carry no open call for this task (the PRE hook is absent, or
   * the call was attributed to another task). Never used while a stamp clock exists: the
   * stamps stay the bound's authority (§1 rule 1).
   */
  channelInFlightSince?: number | null
  /** The open tool call's tool name as the fold saw it (diagnostics), or null. */
  channelInFlightTool?: string | null
  /**
   * §4 DEGRADATION: this candidate has NO channel evidence, so the heartbeat rule runs in
   * REPORT-ONLY mode — it may WARN ONCE (cause `silence-heartbeat`) and may NEVER hold or
   * escalate. The engine sets it exactly when the fold cannot answer for the member.
   */
  heartbeatFallback?: boolean
}

/** What one observation concluded about one candidate. */
export type Decision =
  | { type: "warn"; teamId: string; taskId: string; attemptId: string; assignee: string; memberKey: string; silenceMs: number; lastSeen: number; streak: number; cause: WatchdogCause; state: ChannelState | null }
  | { type: "escalate"; teamId: string; taskId: string; attemptId: string; assignee: string; memberKey: string; silenceMs: number; lastSeen: number; streak: number; cause: WatchdogCause; state: ChannelState | null }
  | { type: "never-started"; teamId: string; taskId: string; attemptId: string; assignee: string; memberKey: string }
  /**
   * The in-flight entry outlived `toolInFlightMaxMs`: reported ONCE per task+attempt as a
   * WARN-class record and NOTHING else — no scene, no hold, no escalate, ever. A tool call
   * that runs for a quarter of an hour and a hang inside one are indistinguishable by
   * construction, so the conservative action (report, do not pause) is the only honest one.
   */
  | { type: "tool-expired"; teamId: string; taskId: string; attemptId: string; assignee: string; memberKey: string; inFlightMs: number; since: number; tool: string | null }

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
  /** Keys already reported `tool-expired` (one report per task+attempt generation). */
  private readonly toolExpired = new Set<string>()
  /**
   * §4 keys already reported through the REPORT-ONLY heartbeat fallback: the fallback
   * may WARN once per generation and never escalates, so a degraded watchdog cannot
   * turn into a per-tick incident stream.
   */
  private readonly reportedFallback = new Set<string>()
  /** How many observations the in-flight rule explained away (r6 evidence). */
  private inFlightSuppressed = 0

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

      // ── THE CHANNEL PREDICATE (contract §1 / T-48 D1) ────────────────────────────
      // When the fold has an answer for this member's session, that answer is the ONE
      // authority: the heartbeat stamps below never override it (rule 1). Only
      // OUTSTANDING can warn, and only after `warnSilenceMs` SINCE THE REQUEST BECAME
      // OUTSTANDING — the fold's step start, never a wall-clock age of a stamp.
      const channel = candidate.channelState
      if (channel === "ALIVE" || channel === "PARKED") {
        // ALIVE: a committed answer, a completed step/tool result or a turn that has not
        // closed — a completed step is ALIVE forever (rule 2), no matter how long ago.
        // PARKED: no open turn — between turns, blocked on dependencies, finished but not
        // yet re-dispatched, staged plan, unclaimed task. Neither is ever a wedge.
        this.streaks.delete(key)
        continue
      }
      if (channel === "IN-FLIGHT") {
        this.observeInFlight(candidate, key, now, knobs, decisions)
        continue
      }
      if (channel === "OUTSTANDING") {
        const since = typeof candidate.outstandingSince === "number" ? candidate.outstandingSince : candidate.lastSeen
        // No clock at all: the fold cannot say when the request became outstanding, and
        // inventing one is exactly the wall-clock inference this redesign removes.
        if (since === null) {
          this.streaks.delete(key)
          continue
        }
        this.observeSilence(candidate, key, now - since, now, knobs, "silence-channel", "OUTSTANDING", false, decisions)
        continue
      }

      // ── §4 DEGRADATION: the heartbeat rule ───────────────────────────────────────
      // Reached only when the fold has no evidence for this member (`channelState` is
      // null and the engine flagged it) or when a caller drives the machine without any
      // channel view at all (the unit tests, and any pre-redesign embedder).
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
      // EXPLAINED ACTIVITY (r6 — the long-tool false positive). A member inside ONE tool
      // call is WORKING, not wedged: our own lanes boot a real `dsh` for minutes, so the
      // POST-only stamp stream made a healthy team look silent and the tick PAUSED it.
      // While the entry is inside the bound the candidate is neither warned nor escalated,
      // and the streak is reset so a stale count cannot be spent the moment the call ends.
      //
      // The bound is the honest half of the trade: past `toolInFlightMaxMs` the entry STOPS
      // suppressing and is reported once as a WARN-class `tool-expired` record (never a
      // hold, never a scene, never an escalate), and `toolInFlightMaxMs: 0` disables the
      // suppression entirely — the pre-r6 behaviour, which is what makes this rule
      // falsifiable rather than assumed.
      // A non-number `inFlightSince` (a candidate built by an older caller, or one whose
      // stamps carried no start) is NOT an in-flight observation: the silence rule applies,
      // which is the fail-safe direction for a watchdog — better a WARN than a silent member.
      if (typeof candidate.inFlightSince === "number" && knobs.toolInFlightMaxMs > 0) {
        this.observeInFlight(candidate, key, now, knobs, decisions)
        continue
      }
      this.observeSilence(candidate, key, now - candidate.lastSeen, now, knobs, "silence-heartbeat", null, candidate.heartbeatFallback === true, decisions)
    }
    return decisions
  }

  /**
   * ONE `tool-expired` report for an open call past `toolInFlightMaxMs`, and nothing else.
   *
   * The bound's clock is the heartbeat `tool-start` stamp when there is one (the stamps are
   * the bound's authority, §1 rule 1); the fold's own `tool/call` time is the fallback when
   * the stamp stream carries no open call, because "a call is open" is already known and a
   * missing clock must not turn into a silent watchdog. With no clock at all, and with the
   * bound disabled (`0`), the entry is explained rather than reported: IN-FLIGHT is never a
   * wedge by construction.
   */
  private observeInFlight(
    candidate: SilenceCandidate,
    key: string,
    now: number,
    knobs: WatchdogKnobs,
    decisions: Decision[],
  ): void {
    this.streaks.delete(key)
    const since =
      typeof candidate.inFlightSince === "number"
        ? candidate.inFlightSince
        : typeof candidate.channelInFlightSince === "number"
          ? candidate.channelInFlightSince
          : null
    if (since === null || knobs.toolInFlightMaxMs <= 0) {
      this.inFlightSuppressed += 1
      return
    }
    const inFlightMs = now - since
    if (inFlightMs <= knobs.toolInFlightMaxMs) {
      this.inFlightSuppressed += 1
      return
    }
    if (this.toolExpired.has(key)) return
    this.toolExpired.add(key)
    decisions.push({
      type: "tool-expired",
      teamId: candidate.teamId,
      taskId: candidate.taskId,
      attemptId: candidate.attemptId,
      assignee: candidate.assignee,
      memberKey: candidate.memberKey,
      inFlightMs,
      since,
      tool: candidate.inFlightTool ?? candidate.channelInFlightTool ?? null,
    })
  }

  /**
   * The §3 ladder for one silent observation: WARN, then ESCALATE after
   * `warnStreakToEscalate` consecutive observations.
   *
   * `reportOnly` (§4) is the degradation cap: the heartbeat fallback may WARN ONCE per
   * task+attempt generation with its own cause, and may NEVER escalate or hold — the
   * streak keeps counting so the diagnostics still show the silence continuing.
   */
  private observeSilence(
    candidate: SilenceCandidate,
    key: string,
    silenceMs: number,
    now: number,
    knobs: WatchdogKnobs,
    cause: WatchdogCause,
    state: ChannelState | null,
    reportOnly: boolean,
    decisions: Decision[],
  ): void {
    if (silenceMs <= knobs.warnSilenceMs) {
      this.streaks.delete(key)
      return
    }
    const streak = (this.streaks.get(key) ?? 0) + 1
    this.streaks.set(key, streak)
    const base = {
      teamId: candidate.teamId,
      taskId: candidate.taskId,
      attemptId: candidate.attemptId,
      assignee: candidate.assignee,
      memberKey: candidate.memberKey,
      silenceMs,
      lastSeen: candidate.lastSeen ?? candidate.outstandingSince ?? now,
      streak,
      cause,
      state,
    }
    if (streak >= knobs.warnStreakToEscalate && !reportOnly) {
      this.escalated.add(key)
      this.streaks.delete(key)
      decisions.push({ type: "escalate", ...base })
      return
    }
    if (reportOnly) {
      if (this.reportedFallback.has(key)) return
      this.reportedFallback.add(key)
    }
    decisions.push({ type: "warn", ...base })
  }

  /** A stamp arrived for a key: the streak resets and the key is not escalated. */
  clear(teamId: string, taskId: string, attemptId: string): void {
    const key = streakKey(teamId, taskId, attemptId)
    this.streaks.delete(key)
    this.neverStarted.delete(key)
    this.toolExpired.delete(key)
    this.reportedFallback.delete(key)
  }

  /** Whether a TEAM's task+attempt already escalated (the tick's idempotence check). */
  hasEscalated(teamId: string, taskId: string, attemptId: string): boolean {
    return this.escalated.has(streakKey(teamId, taskId, attemptId))
  }

  /** The current streak map, for diagnostics and assertions. */
  snapshot(): { streaks: Record<string, number>; escalated: string[]; toolExpired: string[]; inFlightSuppressed: number } {
    return {
      streaks: Object.fromEntries(this.streaks),
      escalated: [...this.escalated].sort(),
      toolExpired: [...this.toolExpired].sort(),
      inFlightSuppressed: this.inFlightSuppressed,
    }
  }
}

/**
 * The tool call a member has open for one task, derived from its stamps (r6).
 *
 * A call is IN FLIGHT from its PRE stamp (`tool-start`) to its POST stamp (`tool` of the
 * SAME `callId`). The `callId` pairing — not "the newest stamp is a start" — is what keeps
 * this right when two calls overlap: a completed sibling cannot clear a still-running one,
 * and a start whose completion arrived under a DIFFERENT task id (the task moved while the
 * call ran) stays in flight until the bound reports it.
 *
 * A harness build that stamps no `callId` falls back to the newest-stamp rule, which is
 * exactly right for the sequential call pattern every real turn has.
 *
 * @param stamps - the stamps already filtered to ONE task+attempt (+ team).
 * @returns the newest unmatched start, or null when nothing is in flight.
 */
export function inFlightFor(stamps: readonly HeartbeatStamp[]): { since: number; tool: string | null } | null {
  const completed = new Set<string>()
  const starts: HeartbeatStamp[] = []
  for (const stamp of stamps) {
    if (stamp.kind === "tool" && typeof stamp.callId === "string" && stamp.callId !== "") completed.add(stamp.callId)
    if (stamp.kind === "tool-start") starts.push(stamp)
  }
  // A harness build that stamps no `callId` at all cannot be paired: fall back to the
  // newest-stamp rule, which is exactly right for the sequential call pattern a real turn has.
  const pairable = starts.some((stamp) => typeof stamp.callId === "string" && stamp.callId !== "")
  if (pairable) {
    let newestStart: HeartbeatStamp | undefined
    for (const stamp of starts) {
      const callId = typeof stamp.callId === "string" && stamp.callId !== "" ? stamp.callId : null
      if (callId !== null && completed.has(callId)) continue
      if (newestStart === undefined || stamp.at >= newestStart.at) newestStart = stamp
    }
    return newestStart === undefined ? null : { since: newestStart.at, tool: newestStart.tool ?? null }
  }
  let newest: HeartbeatStamp | undefined
  for (const stamp of stamps) if (newest === undefined || stamp.at >= newest.at) newest = stamp
  if (newest === undefined || newest.kind !== "tool-start") return null
  return { since: newest.at, tool: newest.tool ?? null }
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
    // THE DISPATCH PRECONDITION (r7 — the staged-plan flood). A task is observed only once
    // somebody was actually HANDED it, and the record of that is a DISJUNCTION:
    //
    //   * a non-empty `attemptId` — the adopted scheduler writes it at dispatch
    //     (`beginTaskAttempt(task, member)` in lib/scheduler.js, before the ticket is delivered)
    //     and the member's own `claim_task` reuses it; or
    //   * ANY stamp for this task in this team, of ANY generation — a stamped task WAS worked on,
    //     even when its attempt has since been revoked/amended and the id cleared, which is why
    //     this test is deliberately NOT the W11-2-filtered slice: that slice answers "is the
    //     CURRENT generation silent", not "was this task ever handed out".
    //
    // A task with neither has never been given to anybody — the normal state of a plan that is
    // still `staged` (awaiting the user's approval in the Web panel), of a task correctly blocked
    // on unfinished dependencies, or of one the scheduler has simply not reached yet. Reported,
    // the first two are pure noise, and a 12-task staged plan emitted 12 `never-started` records
    // plus 12 console lines on EVERY host start (measured 2026-09-16) — for a plan nothing had
    // been dispatched into and nothing should have been. `never-started` is DEFINED as a CLAIMED
    // task whose owner never stamped; an unclaimed task is not one, and silence/escalation must
    // not be spent on it either (a task nobody owns cannot be a wedge).
    const dispatched = taskAttempt !== ""
    const workedOn = stamps.some(
      (stamp) =>
        stamp.taskId === task.id &&
        // The r2 team scope, the same permissive convention the slice below uses: a stamp that
        // carries NO team cannot contradict this team, a stamp naming ANOTHER team says nothing
        // about this task at all.
        (stamp.teamId === undefined || stamp.teamId === null || stamp.teamId === "" || stamp.teamId === team.id),
    )
    if (!dispatched && !workedOn) continue
    const newest = forTask.reduce<HeartbeatStamp | undefined>((best, stamp) => (best === undefined || stamp.at >= best.at ? stamp : best), undefined)
    // r6: the SAME filtered slice answers the in-flight question, so a start recorded
    // against another team/attempt can never explain THIS candidate's silence away.
    const inFlight = inFlightFor(forTask)
    candidates.push({
      teamId: team.id,
      taskId: task.id,
      attemptId,
      assignee: task.assignee,
      memberKey,
      lastSeen: newest === undefined ? null : newest.at,
      lastKind: newest === undefined ? null : newest.kind,
      everStampedForTask: forTask.length > 0,
      inFlightSince: inFlight === null ? null : inFlight.since,
      inFlightTool: inFlight === null ? null : inFlight.tool,
    })
  }
  return candidates
}
