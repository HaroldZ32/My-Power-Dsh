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
import { CAPTAIN_KEY, TERMINAL_STATUSES } from "./team.js"

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
  /**
   * THE FORCE BOUND (S1), measured on SILENCE: how long a task's owner may produce NO observable
   * activity before the supervisor treats it as WEDGED and starts the two-phase force (grace, then
   * interrupt, handoff, requeue and split). `0` DISABLES the whole rule.
   *
   * NOT a task age: a member inside one long tool call, one long answer or one long step is ACTIVE,
   * and the receipt for that is a stamp, a `session/event` fact or an update — never the row's
   * `startedAt`. `maxTaskAgeMs` below is the ONLY age path, and it is off by default.
   *
   * Read LIVE per tick, like every other knob, so lowering it reaches a running watchdog.
   */
  forceAfterMs: number
  /**
   * S2 — the OPT-IN AGE CEILING: force a task once it has been `in_progress` for this long, EVEN
   * WHEN its owner is demonstrably active. `0` (the DEFAULT) means NEVER, which is the contract's
   * position: age alone killed four working lanes on 2026-11-06 (904s–946s, all mid-tool), and this
   * knob exists only for an operator who deliberately wants that hard cap back.
   *
   * TURNING IT ON REINTRODUCES THE 2026-11-06 FAILURE MODE. It is not a safety net; it is a
   * declaration that a task may be killed for being old, whatever its owner is doing.
   */
  maxTaskAgeMs: number
  /**
   * S4 — the GRACE WINDOW: after the first crossing of `forceAfterMs` the member is asked ONCE to
   * write its handoff and end its turn, and is interrupted only when this long passes with the task
   * still `in_progress` and the member still silent. `0` disables the grace phase (the pre-S4
   * single-phase force, which the contract keeps only as a knob and not as a default).
   */
  graceMs: number
}

/** The frozen defaults (frozen contract §3, T-48/D3). */
export const WATCHDOG_DEFAULTS: WatchdogKnobs = {
  enabled: true,
  // 10 minutes of an OUTSTANDING (answered-nothing) request before the first WARN. The
  // old 90 s inferred a wedge from wall-clock silence, which the channel predicate no
  // longer does: a long ANSWER and a long TOOL CALL are both explained, so the bound
  // only ever bounds a request nobody is answering.
  warnSilenceMs: 600_000,
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
  // S1: the bound is SILENCE now, not task age. Fifteen minutes with no stamp, no `session/event`
  // fact and no tool boundary is a member that stopped; a member working inside one call, one step
  // or one long answer is active and is never a target, however old its row is.
  forceAfterMs: 900_000,
  // S2: the age ceiling is OPT-IN and off by default, because age alone is what killed four
  // working lanes on 2026-11-06. Setting it reintroduces exactly that failure mode.
  maxTaskAgeMs: 0,
  // S4: ninety seconds between "write your handoff and end your turn" and the interrupt. Long
  // enough for a seven-section document, short enough that a hung member costs 90 s, not a wave.
  graceMs: 90_000,
}

/**
 * §7.2's per-knob reading: what the process is RUNNING with, what the FILE says, and whether a
 * restart is needed for the file value to take effect.
 */
export interface KnobReading {
  /** The `watchdog.<name>` key this reading is about. */
  knob: string
  /** The value the running process resolved (the settings namespace + the row defaults). */
  live: number | boolean | string
  /** The value `.mpd/mpd.jsonc` carries, or undefined when that file states none. */
  file: number | boolean | string | undefined
  /** Whether the file states a DIFFERENT value, i.e. whether a restart would change anything. */
  differs: boolean
  /** Whether a restart is needed for the file value to take effect (`differs`). */
  restartRequired: boolean
}

/**
 * Build the §7.2 readings: one per knob, LIVE value always, FILE value when the file states one.
 *
 * Pure by construction — the caller supplies the live knobs and the parsed file section — so the
 * divergence rule is testable without a boot, a settings service or a file.
 *
 * @param live - the resolved knobs the process is running with.
 * @param fileSection - the `watchdog` object parsed out of `.mpd/mpd.jsonc` (or anything else).
 * @returns one reading per knob, in the frozen §3 order.
 */
export function knobReadings(live: WatchdogKnobs, fileSection: unknown): KnobReading[] {
  // The file's `watchdog` section as a plain object; anything else reads as "states nothing".
  const file = fileSection !== null && typeof fileSection === "object" ? (fileSection as Record<string, unknown>) : {}
  // Knob names in the frozen contract order the status view prints them in.
  const knobs: (keyof WatchdogKnobs)[] = ["warnSilenceMs", "tickIntervalMs", "warnStreakToEscalate", "actionOnEscalate", "toolInFlightMaxMs", "holdTtlMs", "forceAfterMs", "maxTaskAgeMs", "graceMs", "enabled"]
  return knobs.map((knob) => {
    // The value this process runs with, cast because a keyed read cannot narrow the knob union.
    const liveValue = live[knob] as number | boolean | string
    // The raw value the file states for this knob, of any JSON type.
    const raw = file[knob]
    // The file value when it is a scalar; an object or array states nothing readable.
    const fileValue = typeof raw === "number" || typeof raw === "boolean" || typeof raw === "string" ? raw : undefined
    // Whether the file states a scalar the process is not running with.
    const differs = fileValue !== undefined && fileValue !== liveValue
    return { knob: String(knob), live: liveValue, file: fileValue, differs, restartRequired: differs }
  })
}

/** A knob that had to be rejected or clamped, with the reason. */
export interface KnobIssue {
  /** Dotted config path of the rejected knob, e.g. `watchdog.tickIntervalMs`. */
  path: string
  /** Why the value was rejected, in the words the boot log prints. */
  problem: string
  /** The value actually used instead, of whatever type that knob has. */
  fallback: unknown
}

/** The resolved knobs plus every adjustment made while reading them. */
export interface ResolvedKnobs extends WatchdogKnobs {
  /** Every adjustment made while reading the knobs, for the boot log. */
  issues: KnobIssue[]
}

/** The `watchdog` section of a namespace value as a plain object (`{}` when it states none). */
export function watchdogSectionOf(namespaceValue: unknown): Record<string, unknown> {
  // The namespace value as a plain object; anything else reads as an empty namespace.
  const root = namespaceValue !== null && typeof namespaceValue === "object" ? (namespaceValue as Record<string, unknown>) : {}
  // The raw `watchdog` leaf, before its shape is checked.
  const sectionRaw = root.watchdog
  return sectionRaw !== null && typeof sectionRaw === "object" ? (sectionRaw as Record<string, unknown>) : {}
}

/**
 * A stable digest of one knob LAYER's `watchdog` section, for change detection.
 *
 * Key order must not matter (a rewritten file with the same values is not a change), so the
 * keys are sorted before serialization. `null` means "this layer states no watchdog values",
 * which is itself an observable state (a file deleted or a section removed is a change).
 */
export function sectionDigest(section: unknown): string | null {
  if (section === null || typeof section !== "object") return null
  // The section as an open record, the only shape a digest can serialize.
  const record = section as Record<string, unknown>
  // The section's own keys, sorted so key order alone cannot fake a change.
  const keys = Object.keys(record).sort()
  if (keys.length === 0) return null
  // The section rewritten in sorted-key order, which is what gets serialized.
  const ordered: Record<string, unknown> = {}
  for (const key of keys) ordered[key] = record[key]
  return JSON.stringify(ordered)
}

/**
 * T-18 (wave 2, user ruling) — merge a FILE layer's `watchdog` section over the namespace value.
 *
 * The user ruling is that the knobs are DATA and must therefore be live in-process: the frozen
 * thing was the settings namespace's base (the resolved value is a snapshot taken at mount), not
 * the plugin module. This helper produces the namespace-SHAPED value `readKnobs` already consumes,
 * with the file's stated leaves winning and every leaf the file does not state left to the
 * namespace (and, below that, to the row defaults). It is pure, so the merge rule is testable
 * without a boot, a settings service or a file.
 *
 * @param namespaceValue - `settingsReader("mpd").get()` — the LEGACY namespace snapshot, which is UNSERVED on the pinned host (its registration is refused), so this normally carries nothing
 * @param fileSection - the `watchdog` object parsed out of the workspace's `.mpd/mpd.jsonc`.
 * @returns a namespace-shaped value with the file layer applied on top.
 */
export function overlayWatchdogSection(namespaceValue: unknown, fileSection: unknown): unknown {
  // The namespace value copied as an open record, so the merge cannot mutate the caller's.
  const base = namespaceValue !== null && typeof namespaceValue === "object" ? { ...(namespaceValue as Record<string, unknown>) } : {}
  // The file's section as an open record; a non-object states no leaves at all.
  const file = fileSection !== null && typeof fileSection === "object" ? (fileSection as Record<string, unknown>) : {}
  return { ...base, watchdog: { ...watchdogSectionOf(namespaceValue), ...file } }
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
 * T-18 (wave 2): the value passed in may already carry the workspace FILE layer applied by
 * `overlayWatchdogSection` — the engine folds a fresh `.mpd/mpd.jsonc` edit in when that file is
 * the layer that moved. This function does not care: it reads one namespace-shaped value.
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
  // The `watchdog` object the resolved namespace value carries.
  const section = watchdogSectionOf(namespaceValue)
  // Adjustments recorded while reading, returned together with the resolved knobs.
  const issues: KnobIssue[] = []
  // Read a numeric knob: unusable values fall back to the default and record an issue.
  const number = (key: keyof WatchdogKnobs, min: number): number => {
    // The raw value the section states for this knob, if any.
    const raw = section[key]
    if (raw === undefined) return defaults[key] as number
    if (typeof raw !== "number" || !Number.isFinite(raw) || raw < min) {
      issues.push({ path: "watchdog." + String(key), problem: "expected a finite number >= " + min, fallback: defaults[key] })
      return defaults[key] as number
    }
    return raw
  }

  // The OUTSTANDING age in ms that triggers the first WARN.
  const warnSilenceMs = number("warnSilenceMs", 1)
  // Tick cadence in ms, clamped below when it would outrun the warn bound.
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

  // Consecutive OUTSTANDING observations before ESCALATE, rounded to an integer.
  let warnStreakToEscalate = number("warnStreakToEscalate", 1)
  if (!Number.isInteger(warnStreakToEscalate)) {
    // The rounded streak bound, never below one observation.
    const clamped = Math.max(1, Math.round(warnStreakToEscalate))
    issues.push({ path: "watchdog.warnStreakToEscalate", problem: "expected an integer; rounded", fallback: clamped })
    warnStreakToEscalate = clamped
  }

  // What ESCALATE does; the default unless the section states one of the two verbs.
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

  // S1's force bound (silence, not age). 0 is MEANINGFUL (`the rule is off`), so the floor is 0 and
  // a disabled rule cannot be confused with a missing one.
  const forceAfterMs = number("forceAfterMs", 0)

  // S2's opt-in age ceiling. 0 is the DEFAULT and means NEVER, so the floor is 0 again.
  const maxTaskAgeMs = number("maxTaskAgeMs", 0)

  // S4's grace window. 0 disables the phase (the pre-S4 single-phase force), which is a deliberate
  // choice rather than a missing value.
  const graceMs = number("graceMs", 0)

  // The kill switch: defaults first, the environment override applied last.
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

  return { enabled, warnSilenceMs, tickIntervalMs, warnStreakToEscalate, actionOnEscalate, toolInFlightMaxMs, holdTtlMs, forceAfterMs, maxTaskAgeMs, graceMs, issues }
}

/** One tool call the channel fold observed, in the shape a handoff document quotes it (S5). */
export interface ToolCallExcerpt {
  /** The tool name verbatim, as the `tool/call` event named it. */
  tool: string
  /** A single-line excerpt of the call's arguments, capped by the fold — never the whole payload. */
  excerpt: string
  /** When the call started (ms epoch), so a reader can order two calls and time the last one. */
  at: number
}

/** One silence candidate: a live task whose owner is expected to be stepping. */
export interface SilenceCandidate {
  /** The team the silent task belongs to. */
  teamId: string
  /** The task whose owner has gone silent. */
  taskId: string
  /** The generation token of that task; empty when the board carries none. */
  attemptId: string
  /** The owning member's name, or `captain`. */
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
  /**
   * D3: the board status VERBATIM (`in_progress`, `pending`, …).
   *
   * Only `in_progress` can be WEDGED: a `pending` row is waiting for a dispatch, not being worked,
   * and forcing it would interrupt a member for work it never started. ABSENT means the caller did
   * not state a status (an older fixture), and an absent status is NEVER forced — the fail-safe
   * direction is "do not interrupt on a guess".
   */
  status?: string
  /**
   * S1: epoch ms at which the task entered `in_progress` (the record's own `startedAt`), or null
   * when the board carries none.
   *
   * NO LONGER THE FORCE TRIGGER — the trigger is measured silence (see {@link "observeWedge"} for
   * the exact predicate) and `startedAt` survives for two weaker jobs: it is quoted in the handoff
   * document, and it is the clock of the OPT-IN `maxTaskAgeMs` ceiling. A candidate with no stamp
   * and no startedAt is measured by silence alone.
   */
  startedAt?: number | null
  /**
   * D3: the tool names of this task's newest stamps, oldest first (at most five).
   *
   * HISTORY, not a decision input: the force handoff document quotes them so the next owner can see
   * what the interrupted member was doing. Never used by the machine to decide anything.
   */
  recentTools?: readonly string[]
  /**
   * S5: the last tool calls the FOLD observed, oldest first (at most five), each with an argument
   * excerpt. The stamps carry tool NAMES only, so this is the one source an argument excerpt can
   * come from; a member with no fold evidence falls back to {@link recentTools} (names alone).
   *
   * HISTORY, not a decision input: the supervisor handoff quotes it so the next owner can see what
   * the interrupted member was actually running. The machine never decides anything from it.
   */
  recentToolCalls?: readonly ToolCallExcerpt[]
  /**
   * S5: the last assistant message the fold observed for this member, or null when it observed
   * none. Also HANDOFF EVIDENCE only — the force rule never reads it.
   */
  assistantMessage?: string | null
  /**
   * D3: whether this candidate's owner IS the team's LEAD (the captain).
   *
   * The engine resolves it (the owner may be stored as the lead's session id, which the machine cannot
   * recognise on its own), and it gates the FORCE rule only: the captain is NEVER interrupted by D3.
   * The silence ladder still applies — the captain's own seat can be watched and warned about.
   */
  lead?: boolean
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
   * S4's GRACE decision: the member's measured silence crossed `forceAfterMs`, so the supervisor asks
   * it ONCE to write its handoff and end its turn, and NOTHING is interrupted.
   *
   * `deadline` is when the kill phase becomes due (`graceSentAt + graceMs`); the decision carries the
   * measured `silentMs` and the evidence the directive quotes, so the team plane can word a message
   * that names the actual row and clock. A member that complies ends in `mode: checkpoint`, and the
   * kill phase then uses ITS document instead of writing a template.
   */
  | {
      type: "grace"
      teamId: string
      taskId: string
      attemptId: string
      assignee: string
      memberKey: string
      /** The measured silence that crossed the bound, in ms. */
      silentMs: number
      /** When the row entered `in_progress` (ms epoch), or null when the board carried none. */
      startedAt: number | null
      /** How long the row had been in progress at the tick's clock, in ms (0 when unclocked). */
      elapsedMs: number
      /** When the grace window expires and the kill phase becomes due (ms epoch). */
      deadline: number
    }
  /**
   * S4's KILL decision (the second phase): the grace window expired with the member still silent and
   * the row still `in_progress`, so the force supervisor must interrupt it, use or write the handoff,
   * requeue the row and split the work.
   *
   * `silentMs` is the MEASURED idle duration that triggered the force (S5 requires the handoff to
   * state it); `elapsedMs` is the row's age and is 0 when the board carries no `startedAt`.
   */
  | {
      type: "wedged"
      teamId: string
      taskId: string
      attemptId: string
      assignee: string
      memberKey: string
      /** The measured silence that triggered the kill, in ms. */
      silentMs: number
      /** When the row entered `in_progress` (ms epoch), or null when the board carried none. */
      startedAt: number | null
      /** How long the row had been in progress at the tick's clock, in ms (0 when unclocked). */
      elapsedMs: number
      /** When the grace directive was sent, ms epoch — the kill phase's own start. */
      graceSentAt: number
      /** The tool NAMES the stamps recorded, oldest first (the fallback when the fold saw none). */
      lastToolCalls: readonly string[]
      /** S5: the fold's tool calls WITH argument excerpts, oldest first; empty without fold data. */
      toolCalls: readonly ToolCallExcerpt[]
      /** S5: the last assistant message the fold observed, or null. */
      assistantMessage: string | null
    }
  /**
   * D3's EXEMPTION report: the force bound was crossed while its owner had a `bash` call open.
   *
   * The member is WORKING (a verification run may legitimately take an hour), so nothing is
   * interrupted; the incident is the audit trail that the bound was crossed and the exemption was
   * taken. Recorded ONCE per task+attempt generation, at the boundary.
   */
  | { type: "long-bash"; teamId: string; taskId: string; attemptId: string; assignee: string; memberKey: string; startedAt: number | null; elapsedMs: number; inFlightMs: number; tool: string | null }

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
   * D3 keys already FORCED: one `wedged` decision per task+attempt generation, so a task that the
   * supervisor could not requeue this tick cannot interrupt its owner twice.
   *
   * The engine RE-ARMS a key through {@link rearmWedge} when the force action aborted for a
   * retryable reason (a handoff write failure), which is what makes "retry next tick" possible.
   * A key that survives (a NON-retryable refusal, or no team plane to act on) keeps blocking a
   * second force, and {@link observeWedge} hands the candidate to the silence ladder instead.
   */
  private readonly wedgeForced = new Set<string>()
  /** D3 keys already reported as exempt (`long-bash`): one incident per generation, at the boundary. */
  private readonly longBashReported = new Set<string>()
  /**
   * S4's PER-PHASE dedupe: keys (team+task+attempt) whose GRACE directive was already sent, mapped to
   * the tick that sent it.
   *
   * GRACE AND KILL ARE TWO DECISIONS, NOT ONE, which is why this map exists beside
   * {@link wedgeForced}: the grace phase is spent the moment the directive goes out, and the kill
   * phase is spent the moment the interrupt decision is emitted. A stamp for the key (real progress)
   * forgets BOTH through {@link clear}, so the next crossing starts a fresh window.
   */
  private readonly graceSentAt = new Map<string, number>()

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
    // The decisions of this observation pass, in candidate order.
    const decisions: Decision[] = []
    for (const candidate of candidates) {
      // This candidate's streak and escalation key.
      const key = streakKey(candidate.teamId, candidate.taskId, candidate.attemptId)
      // ── S1/S4: THE FORCE RULE, ON SILENCE, IN TWO PHASES ────────────────────────────
      // Evaluated BEFORE every channel question and BEFORE the silence ladder: it consumes the
      // candidate while it decides (grace sent / grace pending / kill emitted) or takes the bash
      // exemption, and falls through untouched otherwise so a force that produced no new revision
      // cannot silence the ladder.
      if (this.observeWedge(candidate, key, now, knobs, decisions)) continue
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
        // THE LADDER'S OWN CLOCK, read through the ONE helper the force rule also consumes
        // (`silenceOf`): the request's outstanding instant, with the last stamp as the fallback.
        // No clock at all: the fold cannot say when the request became outstanding, and inventing
        // one is exactly the wall-clock inference this redesign removes.
        const silentMs = this.silenceOf(candidate, now)
        if (silentMs === null) {
          this.streaks.delete(key)
          continue
        }
        this.observeSilence(candidate, key, silentMs, now, knobs, "silence-channel", "OUTSTANDING", false, decisions)
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
      // The same ONE silence helper the force rule reads: the newest stamp's age, which is the §4
      // rule's whole clock. It answers `null` only for a state the ladder withholds (`turn-end`
      // reached above), which keeps the ladder and the force rule from disagreeing about silence.
      const silentMs = this.silenceOf(candidate, now)
      if (silentMs === null) {
        this.streaks.delete(key)
        continue
      }
      this.observeSilence(candidate, key, silentMs, now, knobs, "silence-heartbeat", null, candidate.heartbeatFallback === true, decisions)
    }
    return decisions
  }

  /**
   * S1/S2/S3/S4: decide whether ONE candidate is WEDGED, and record which phase that is.
   *
   * THE PREDICATE, in the order the contract states it:
   *   1. `forceAfterMs <= 0` disables the rule (the falsifier: the pre-D3 behaviour). The age CEILING
   *      never revives a disabled rule, because "0 disables the whole rule" is the frozen contract.
   *   2. Only an `in_progress` task can be wedged — a `pending` row is waiting for a dispatch.
   *   3. THE CAPTAIN IS NEVER A FORCE TARGET (rule 5): the Lead's own seat is skipped here, and the
   *      action refuses it again on the record — two independent guards, because interrupting the
   *      session that authorised the team would take the whole wave down.
   *   4. S3: an OPEN tool call is ACTIVITY. An open `bash` is exempt with NO bound (a legitimate
   *      verification run may take an hour) and reports ONE `long-bash` incident at the boundary; any
   *      OTHER tool holds the rule off only while it is younger than `toolInFlightMaxMs` — past that
   *      the entry stops counting as activity, which is exactly what a HUNG tool looks like.
   *   5. S1: the trigger is the MEASURED SILENCE from `silenceOf` — the same clock the §3 ladder
   *      reads. A candidate whose state the ladder explains (ALIVE/PARKED, or a `turn-end` boundary)
   *      reports no silence and is never forced by time alone.
   *   6. S2: the OPT-IN `maxTaskAgeMs` ceiling is the ONLY age path. `0` (the default) means age can
   *      never force anything; a non-zero value deliberately reintroduces the 2026-11-06 failure mode.
   *   7. S4: TWO PHASES on one key. The first crossing emits ONE `grace` decision (the directive) and
   *      interrupts nobody; the `wedged` (kill) decision follows only when `graceMs` has passed with
   *      the task still crossing. `graceMs: 0` skips straight to the kill, which is the pre-S4 shape.
   *
   * @param candidate - the candidate under observation.
   * @param key - its team+task+attempt key (the dedupe key, one entry per phase).
   * @param now - the tick's clock (injectable).
   * @param knobs - the resolved knobs (`forceAfterMs`, `maxTaskAgeMs` and `graceMs` are read live).
   * @param decisions - the decisions of this pass, appended to in place.
   * @returns true when the candidate was CONSUMED (do not run the silence ladder for it).
   */
  private observeWedge(
    candidate: SilenceCandidate,
    key: string,
    now: number,
    knobs: WatchdogKnobs,
    decisions: Decision[],
  ): boolean {
    // 1. The rule is off; every other decision path stays as it was.
    if (knobs.forceAfterMs <= 0) return false
    // 2. A task that is not being worked cannot be wedged.
    if (candidate.status !== "in_progress") return false
    // THE CAPTAIN IS NEVER A FORCE TARGET (rule 5): `lead` is the engine's resolution (the owner may be
    // the lead's session id), and `CAPTAIN_KEY` covers a fixture that spells it the short way.
    if (candidate.assignee === CAPTAIN_KEY || candidate.lead === true) return false
    // The task's own start instant, quoted by the handoff and used by the age ceiling ONLY. Absent is
    // not a refusal: the silence clock does not need it (a fixture or a legacy row may carry none).
    const startedAt = typeof candidate.startedAt === "number" && Number.isFinite(candidate.startedAt) ? candidate.startedAt : null
    // How long the row has been in progress, in ms; 0 is the honest reading when nobody clocked it.
    const elapsedMs = startedAt === null ? 0 : now - startedAt
    // ── 4. S3: THE IN-FLIGHT TOOL ────────────────────────────────────────────────────────────────
    // THE TOOL NAME IS THE EXEMPTION, never the presence of a start instant (§D3.3, review F3): a
    // stamp stream that names the tool but carries no usable clock (a harness that skips `at`, or a
    // fold that saw the call without its start) is still an OPEN call, and interrupting that member
    // would be the exact false positive the exemption exists to prevent.
    const tool = this.openToolOf(candidate)
    // The measured silence this tick: the ladder's own clock, or null when the state is explained.
    const silentMs = this.silenceOf(candidate, now)
    // S2's ceiling, the ONLY age path, and off unless an operator turned it on.
    const ageExceeded = knobs.maxTaskAgeMs > 0 && startedAt !== null && now - startedAt >= knobs.maxTaskAgeMs
    // Whether the force bound was crossed by SILENCE, by the opt-in ceiling, or not at all.
    const crossed = (silentMs !== null && silentMs >= knobs.forceAfterMs) || ageExceeded
    if (!crossed) return false
    if (tool.tool === "bash") {
      // The exemption is reported ONCE per generation, at the boundary, and it interrupts nothing.
      if (!this.longBashReported.has(key)) {
        this.longBashReported.add(key)
        decisions.push({
          type: "long-bash",
          teamId: candidate.teamId,
          taskId: candidate.taskId,
          attemptId: candidate.attemptId,
          assignee: candidate.assignee,
          memberKey: candidate.memberKey,
          startedAt,
          elapsedMs,
          // A call whose start nobody stamped has no measurable age; 0 is the honest reading.
          inFlightMs: tool.since === null ? 0 : now - tool.since,
          tool: tool.tool,
        })
      }
      return true
    }
    // ANY OTHER OPEN TOOL is activity while it is inside its bound. With no clock the bound cannot be
    // measured, and the fail-safe direction is "do not interrupt on a guess".
    if (tool.tool !== null) {
      if (tool.since === null) return false
      if (knobs.toolInFlightMaxMs > 0 && now - tool.since <= knobs.toolInFlightMaxMs) return false
      // Past the bound (or with suppression disabled) the entry STOPS being activity: a tool call
      // that outlives its window is the hung tool this rule exists for, so the decision falls through.
    }
    // ── 5/7. ONE DECISION PER PHASE PER GENERATION ──────────────────────────────────────────────
    // The kill decision is emitted at most once per generation. A key that already reached it came
    // back with the same revision, so the force produced NO new attempt (a NON-retryable refusal
    // leaves the key in place; a retryable one re-arms through `rearmWedge`) or it never reached the
    // team plane. The candidate must then fall through to the silence ladder — a watchdog that goes
    // silent for a task whose force failed is the one failure this rule must not cause.
    if (this.wedgeForced.has(key)) return false
    // The grace phase: the directive goes out FIRST, and the kill waits for `graceMs` from it.
    const graceSentAt = this.graceSentAt.get(key)
    if (knobs.graceMs > 0 && graceSentAt === undefined) {
      this.graceSentAt.set(key, now)
      decisions.push({
        type: "grace",
        teamId: candidate.teamId,
        taskId: candidate.taskId,
        attemptId: candidate.attemptId,
        assignee: candidate.assignee,
        memberKey: candidate.memberKey,
        silentMs: silentMs ?? elapsedMs,
        startedAt,
        elapsedMs,
        deadline: now + knobs.graceMs,
      })
      return true
    }
    // Inside the window: consumed, so neither a second directive nor a WARN is emitted meanwhile.
    if (knobs.graceMs > 0 && graceSentAt !== undefined && now - graceSentAt < knobs.graceMs) return true
    this.wedgeForced.add(key)
    decisions.push({
      type: "wedged",
      teamId: candidate.teamId,
      taskId: candidate.taskId,
      attemptId: candidate.attemptId,
      assignee: candidate.assignee,
      memberKey: candidate.memberKey,
      silentMs: silentMs ?? elapsedMs,
      startedAt,
      elapsedMs,
      // A kill reached without a grace phase (`graceMs: 0`) is its own grace instant.
      graceSentAt: graceSentAt ?? now,
      lastToolCalls: [...(candidate.recentTools ?? [])],
      toolCalls: [...(candidate.recentToolCalls ?? [])],
      assistantMessage: candidate.assistantMessage ?? null,
    })
    return true
  }

  /**
   * The ONE silence clock: how long this candidate has produced no observable activity, in ms, or
   * `null` when the state itself is EXPLAINED and no silence should be measured.
   *
   * Both consumers read it — the §3 WARN ladder and the S1 force rule — so the two can never
   * disagree about what silence is (S1: "reuse the silence machinery the watchdog already computes,
   * do not build a second clock"). The source is chosen exactly as §1/§4 always chose it:
   *   * the channel predicate when the fold answered for the member (`OUTSTANDING` clocks from the
   *     request's own start; `IN-FLIGHT` clocks from the open call, which is S3's bound);
   *   * the heartbeat stamps otherwise, with the ladder's own withholdings: a `turn-end` boundary is
   *     "between turns", and a member that never stamped this task has no clock at all.
   *
   * @param candidate - the candidate whose silence is measured.
   * @param now - the tick's clock (injectable).
   * @returns the silent interval in ms, or null when the candidate is explained / has no clock.
   */
  private silenceOf(candidate: SilenceCandidate, now: number): number | null {
    // The channel predicate is the §1 authority whenever the fold answered for this member.
    if (candidate.channelState === "OUTSTANDING") {
      // The request's own start; the newest stamp is only the fallback clock.
      const since = typeof candidate.outstandingSince === "number" ? candidate.outstandingSince : candidate.lastSeen
      return since === null ? null : now - since
    }
    if (candidate.channelState === "IN-FLIGHT") {
      // The open call's start is the bound's clock (S3). No clock means no measurable silence.
      const since = candidate.inFlightSince ?? candidate.channelInFlightSince ?? null
      return since === null ? null : now - since
    }
    if (candidate.channelState === "ALIVE" || candidate.channelState === "PARKED") {
      // Explained states (contract §1): an answered/streaming step, a step between steps, or a member
      // between turns. The ladder never warns on them, so the force rule must not kill on them.
      return null
    }
    // §4: no channel evidence — the heartbeat clock, with the ladder's two withholdings.
    if (candidate.lastKind === "turn-end") return null
    if (candidate.lastSeen === null || !candidate.everStampedForTask) return null
    return now - candidate.lastSeen
  }

  /**
   * The tool call this candidate has OPEN, from the stamps first and the fold second (S3).
   *
   * The stamps are the in-flight bound's authority (§1 rule 1); the fold's `tool/call` is the
   * fallback when the stamp stream carries no open call (a harness without the PRE hook, or a call
   * attributed to another task). A call with no readable start is still an open call — the tool name
   * decides the bash exemption — and `since: null` states that nobody clocked it.
   *
   * @param candidate - the candidate whose open call is read.
   * @returns the open call's tool name and start, or `{ tool: null, since: null }` when none is open.
   */
  private openToolOf(candidate: SilenceCandidate): { tool: string | null; since: number | null } {
    // The stamp's own open call wins: it is the stream the bound was designed around.
    if (typeof candidate.inFlightTool === "string" && candidate.inFlightTool !== "") {
      return { tool: candidate.inFlightTool, since: typeof candidate.inFlightSince === "number" ? candidate.inFlightSince : null }
    }
    // The fold's reading is the fallback, and the ONLY source when the PRE hook never fired.
    if (typeof candidate.channelInFlightTool === "string" && candidate.channelInFlightTool !== "") {
      return { tool: candidate.channelInFlightTool, since: typeof candidate.channelInFlightSince === "number" ? candidate.channelInFlightSince : null }
    }
    return { tool: null, since: null }
  }

  /**
   * D3: allow ONE task+attempt generation to be decided again after a retryable force abort.
   *
   * WHY THIS IS NOT `clear`: `clear` is the STAMP path (a member reported progress), which resets
   * every per-generation report. A handoff WRITE failure is not progress — the task is still wedged —
   * so only the force flag is re-armed and the incident dedupe stays spent, which is what "retry next
   * tick, at most once per attempt [recorded]" means.
   *
   * @param teamId - the team the task belongs to.
   * @param taskId - the board row that stays wedged.
   * @param attemptId - its generation token.
   */
  rearmWedge(teamId: string, taskId: string, attemptId: string): void {
    this.wedgeForced.delete(streakKey(teamId, taskId, attemptId))
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
    // The open call's start: the heartbeat stamp first, the fold's call time as fallback.
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
    // How long the call has been open, in ms.
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
    // The streak after this observation: one more than the stored count.
    const streak = (this.streaks.get(key) ?? 0) + 1
    this.streaks.set(key, streak)
    // The decision fields shared by the WARN and ESCALATE shapes.
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
    // The key whose per-generation reports are forgotten.
    const key = streakKey(teamId, taskId, attemptId)
    this.streaks.delete(key)
    this.neverStarted.delete(key)
    this.toolExpired.delete(key)
    this.reportedFallback.delete(key)
    // D3/S4: a stamp for this task+attempt is EVIDENCE of progress, so the force, its grace phase and
    // the exemption report are forgotten with the rest — the next time the task crosses the bound it
    // is decided afresh, with a NEW grace window rather than the previous one's deadline.
    this.wedgeForced.delete(key)
    this.longBashReported.delete(key)
    this.graceSentAt.delete(key)
  }

  /** Whether a TEAM's task+attempt already escalated (the tick's idempotence check). */
  hasEscalated(teamId: string, taskId: string, attemptId: string): boolean {
    return this.escalated.has(streakKey(teamId, taskId, attemptId))
  }

  /** The current streak map, for diagnostics and assertions. */
  snapshot(): { streaks: Record<string, number>; escalated: string[]; toolExpired: string[]; inFlightSuppressed: number; wedged: string[]; longBash: string[]; grace: Record<string, number> } {
    return {
      streaks: Object.fromEntries(this.streaks),
      escalated: [...this.escalated].sort(),
      toolExpired: [...this.toolExpired].sort(),
      inFlightSuppressed: this.inFlightSuppressed,
      wedged: [...this.wedgeForced].sort(),
      longBash: [...this.longBashReported].sort(),
      // S4's open grace windows, key -> the instant the directive was recorded at.
      grace: Object.fromEntries(this.graceSentAt),
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
  // Call ids that already have their POST completion stamp.
  const completed = new Set<string>()
  // The PRE stamps seen, in file order.
  const starts: HeartbeatStamp[] = []
  for (const stamp of stamps) {
    if (stamp.kind === "tool" && typeof stamp.callId === "string" && stamp.callId !== "") completed.add(stamp.callId)
    if (stamp.kind === "tool-start") starts.push(stamp)
  }
  // A harness build that stamps no `callId` at all cannot be paired: fall back to the
  // newest-stamp rule, which is exactly right for the sequential call pattern a real turn has.
  const pairable = starts.some((stamp) => typeof stamp.callId === "string" && stamp.callId !== "")
  if (pairable) {
    // The newest unmatched start, i.e. the call still in flight.
    let newestStart: HeartbeatStamp | undefined
    for (const stamp of starts) {
      // This start's call id, or null when the harness stamped none.
      const callId = typeof stamp.callId === "string" && stamp.callId !== "" ? stamp.callId : null
      if (callId !== null && completed.has(callId)) continue
      if (newestStart === undefined || stamp.at >= newestStart.at) newestStart = stamp
    }
    return newestStart === undefined ? null : { since: newestStart.at, tool: newestStart.tool ?? null }
  }
  // The newest stamp overall, used by the unpaired fallback rule.
  let newest: HeartbeatStamp | undefined
  for (const stamp of stamps) if (newest === undefined || stamp.at >= newest.at) newest = stamp
  if (newest === undefined || newest.kind !== "tool-start") return null
  return { since: newest.at, tool: newest.tool ?? null }
}

/**
 * The record's GENERATION FLOOR (T-16, contract §6): the newest of the team record's own
 * `createdAt`/`approvedAt`, or `null` when the record carries neither.
 *
 * `null` is PERMISSIVE on purpose (§0/A3): a record that cannot say when it was created cannot
 * bound a stamp's generation, and an absent `createdAt` must never turn a watchdog silent.
 *
 * @param team - the projected record (only the two timestamps are read).
 * @returns the floor in ms epoch, or null when the record does not state one.
 */
export function generationFloorOf(team: { createdAt?: number | null; approvedAt?: number | null }): number | null {
  // The finite record timestamps, one per field the record carries.
  const stamps = [team.createdAt, team.approvedAt].filter((value): value is number => typeof value === "number" && Number.isFinite(value))
  return stamps.length === 0 ? null : Math.max(...stamps)
}

/** A candidate's silence, derived from its heartbeat file (the tick's input). */
export function candidateFor(
  team: {
    id: string
    tasks: readonly {
      id: string
      status: string
      assignee?: string
      attemptId?: string
      dispatched?: boolean
      /** D3: epoch ms the task entered `in_progress`, when the projection could read one. */
      startedAt?: number
    }[]
    /** T-16's generation bound; absent/null leaves the slice PERMISSIVE (§0/A3). */
    createdAt?: number | null
    approvedAt?: number | null
  },
  stampSource: (memberKey: string) => readonly HeartbeatStamp[],
  memberKeyOf: (assignee: string) => string,
): SilenceCandidate[] {
  // The generation bound every accepted stamp must be at or after; null is permissive.
  const generationFloor = generationFloorOf(team)
  // The candidates derived from the record's non-terminal owned tasks.
  const candidates: SilenceCandidate[] = []
  for (const task of team.tasks) {
    if (task.assignee === undefined || TERMINAL_STATUSES.includes(task.status)) continue
    // The heartbeat file key of this task's owner.
    const memberKey = memberKeyOf(task.assignee)
    // The generation token recorded on the candidate; empty when the board carries none.
    const attemptId = task.attemptId ?? ""
    // Every stamp on disk for the owner, before the per-task filters below.
    const stamps = stampSource(memberKey)
    // W11-2: the filter is by task id AND, when the stamp CARRIES one, by attempt id. A stamp
    // with no attempt information (undefined/null/empty) cannot contradict this generation and
    // is kept; a stamp that names a DIFFERENT attempt belongs to an earlier generation and must
    // not satisfy the precondition (it used to, so an old generation's stamp made a task with no
    // current stamp look "silent" instead of "never started").
    const taskAttempt = task.attemptId ?? ""
    // ── T-16 / §6: THE SILENCE SLICE IS GENERATION-SCOPED ────────────────────────────────
    // A stamp older than the record's own `createdAt`/`approvedAt` belongs to a PREVIOUS
    // generation of the team and can never prove that THIS record's task is being worked on.
    // Measured leak (2026-09-16): a hold took task `t12` whose only stamp (05:33:35Z) predated
    // the record's `createdAt` (05:51:45Z) — silence was computed against a stamp from before
    // the record existed, and 3 ticks later a healthy team was paused.
    //
    // The bound lands HERE, on the slice that answers "is the CURRENT generation silent", and
    // NOT on the dispatch disjunction below (`dispatched`/`workedOn`), which stays permissive:
    // an earlier-generation stamp still makes a task OBSERVABLE, it just cannot make it SILENT.
    // That is what keeps the r7 pin green (`test/dispatch-precondition.test.ts:157-172`, §0/A3)
    // while a pre-generation stamp can no longer escalate anything: the candidate is reported
    // `never-started` instead, which never holds.
    const forTask = stamps.filter((stamp) => {
      if (stamp.taskId !== task.id) return false
      if (generationFloor !== null && typeof stamp.at === "number" && stamp.at < generationFloor) return false
      // TEAM SCOPE (r2, the false-negative repair): the heartbeat FILE is keyed by MEMBER NAME
      // per workspace (`heartbeatPath`), and roster names repeat across teams, so two teams whose
      // members share a name append to ONE file. Without this test the other team's stamp
      // satisfies this candidate and a WEDGED member looks alive — the watchdog stays silent,
      // which is the one failure mode this whole wave exists to prevent. A stamp that carries NO
      // team cannot contradict this team and is kept, the same permissive convention the attempt
      // rule below uses (and the reason the writer records `teamId` on every stamp).
      const stampTeam = stamp.teamId
      if (stampTeam !== undefined && stampTeam !== null && stampTeam !== "" && stampTeam !== team.id) return false
      // The attempt the stamp names; absent means it cannot contradict this generation.
      const stampAttempt = stamp.attemptId
      if (stampAttempt === undefined || stampAttempt === null || stampAttempt === "") return true
      return stampAttempt === taskAttempt
    })
    // THE DISPATCH PRECONDITION (r7 — the staged-plan flood). A task is observed only once
    // somebody was actually HANDED it, and the record of that is a DISJUNCTION:
    //
    //   * a non-empty `attemptId` — the official board's monotonic `revision`, which the
    //     projection renders as the generation token; or
    //   * ANY stamp for this task in this team, of ANY generation — a stamped task WAS worked on,
    //     even when its attempt has since been revoked/amended and the id cleared, which is why
    //     this test is deliberately NOT the W11-2-filtered slice: that slice answers "is the
    //     CURRENT generation silent", not "was this task ever handed out".
    //
    // A task with neither has never been given to anybody — the normal state of a task correctly
    // blocked on unfinished dependencies, or of one the Lead has simply not assigned yet.
    // Reported, those are pure noise, and a 12-task plan emitted 12 `never-started` records plus
    // 12 console lines on EVERY host start (measured 2026-09-16) — for a plan nothing had been
    // dispatched into and nothing should have been. `never-started` is DEFINED as a CLAIMED task
    // whose owner never stamped; an unclaimed task is not one, and silence/escalation must not be
    // spent on it either (a task nobody owns cannot be a wedge). On the OFFICIAL board an owner is
    // set exactly at claim/reassign time, so the `dispatched` flag the projection carries is the
    // faithful spelling of "somebody was handed this".
    const dispatched = task.dispatched === true || taskAttempt !== ""
    // Whether ANY stamp ever worked this task in this team, of any generation.
    const workedOn = stamps.some(
      (stamp) =>
        stamp.taskId === task.id &&
        // The r2 team scope, the same permissive convention the slice below uses: a stamp that
        // carries NO team cannot contradict this team, a stamp naming ANOTHER team says nothing
        // about this task at all.
        (stamp.teamId === undefined || stamp.teamId === null || stamp.teamId === "" || stamp.teamId === team.id),
    )
    if (!dispatched && !workedOn) continue
    // The newest stamp of the generation-scoped slice, or undefined when it is empty.
    const newest = forTask.reduce<HeartbeatStamp | undefined>((best, stamp) => (best === undefined || stamp.at >= best.at ? stamp : best), undefined)
    // D3's handoff evidence: the tool names this task's stamps recorded, oldest first, last five.
    const recentTools = forTask
      .filter((stamp): stamp is HeartbeatStamp & { tool: string } => typeof stamp.tool === "string" && stamp.tool !== "")
      .slice(-5)
      .map((stamp) => stamp.tool)
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
      // D3: the wedge clock and the handoff's tool history ride the same candidate.
      status: task.status,
      startedAt: typeof task.startedAt === "number" && Number.isFinite(task.startedAt) ? task.startedAt : null,
      recentTools,
    })
  }
  return candidates
}
