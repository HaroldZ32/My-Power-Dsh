// The consult supervisor for mpd-roles-plugin (§D2 of the throughput contract).
//
// ONE record per consult — blocking or async — because the two surfaces differ only in WHEN the
// caller reads the report. A record owns: the shared activation handle (`dsh.spawnAgentAsync`), the
// concurrency slot (`MPD_DSH_CONSULT_MAX`, default 8: over the cap a consult QUEUES and never
// throws), the deadman and the handoff document the deadman writes before it interrupts a child.
//
// THE DEADMAN NOW SHARES THE FORCE SUPERVISOR'S SEMANTICS (contract §S9): its bound is SILENCE,
// resolved per arm from `consult.forceAfterMs` → `watchdog.forceAfterMs` → 900 000 ms, and ANY open
// tool younger than `toolInFlightMaxMs` counts as activity. An open `bash` keeps the no-age-bound
// exemption; any OTHER open tool past that bound stops counting (a hung tool) and the child is
// interrupted. With no open tool the expiry compares MEASURED IDLE (`now - lastActivityAt`, stamped by
// every tool start, every tool completion and every committed assistant message) against the same
// bound, so a child that is demonstrably working re-arms from the REMAINING time and is never cut at
// the bound. The handoff carries the measured idle duration and quotes the last assistant message
// when the row observed one.
//
// The module is deliberately free of harness services: it receives the raise and handoff seams, so
// its tests need no boot and a per-plane caller can reuse it.

import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { DshAsyncAgent, DshSpawnResult } from "../../mpd-dsh-adapter-plugin/src/index"

/**
 * The DOCUMENTED DEFAULT deadman bound on one consult: 15 minutes, the user's one-shot rule (§D2.6).
 *
 * It is only the LAST link of the resolution chain (§S9): the bound in force is read at every arm
 * from `consult.forceAfterMs`, then `watchdog.forceAfterMs`, and only then this value — so a
 * configured bound is never shadowed by a module constant.
 */
export const CONSULT_FORCE_AFTER_MS = 900_000
/**
 * The default bound for the in-flight half of the deadman's predicate (§S3): an OPEN tool younger
 * than this explains silence away, and one older than it stops counting. Used only when the source
 * declares no `watchdog.toolInFlightMaxMs` (or declares an unusable one).
 */
export const CONSULT_TOOL_IN_FLIGHT_MAX_MS = 900_000
/** The default cap on concurrently RUNNING consults (§D2.5) — the host's active-child limit. */
export const CONSULT_MAX_DEFAULT = 8
/** The largest `mpd_role_consult wait` timeout the tool accepts, in milliseconds (§D2.4). */
export const CONSULT_WAIT_MAX_MS = 60_000
/** The `wait` timeout used when the caller states none, in milliseconds. */
export const CONSULT_WAIT_DEFAULT_MS = 30_000
/** How many completed tool calls the handoff document may quote (name + a ≤400-character excerpt). */
export const CONSULT_ACTIVITY_HISTORY = 5
/** How many characters of the last assistant message the handoff may quote (a longer answer is cut, never dropped). */
export const CONSULT_MESSAGE_EXCERPT = 1_200

/** Prefix that keeps a LABEL-keyed bucket distinct from a child-id bucket (the no-id fallback). */
export const CONSULT_LABEL_KEY_PREFIX = "label:"

/**
 * Key one tool-activity bucket by the CHILD's immutable identity — the fix for F1 (§D2.6).
 *
 * The subject of the bash exemption is THE CHILD, never its role: two concurrent consults of one role
 * must not share (or clear) each other's open-call stamp. The identity read is the child agent's own
 * session id — the SAME field the adapter's `sessionIdOfAgent` reads, and the SAME value `DshAsyncAgent.id`
 * reports, which is what `ConsultSupervisorDeps.activityOf` receives from `onDeadman`.
 * @param agent - the tool execution's calling agent.
 * @param labelOf - the row's adapter-backed label reader, used ONLY when no id exists (display fallback).
 * @returns the child session id, `label:<role>` for an id-less child, or undefined when neither exists.
 */
export function consultActivityKeyOf(agent: unknown, labelOf: (agent: unknown) => string | undefined): string | undefined {
  if (agent === null || typeof agent !== "object") return undefined
  /** The child agent's session id, read defensively: a stub or a stale handle may carry none. */
  const session = (agent as { session?: { id?: unknown } }).session
  if (typeof session?.id === "string" && session.id !== "") return session.id
  /** The display fallback: the roster label, which is all an id-less composition can offer. */
  const label = labelOf(agent)
  return typeof label === "string" && label !== "" ? CONSULT_LABEL_KEY_PREFIX + label : undefined
}

/**
 * The fallback bucket key for a consult whose child reported no id (§D2.6 display fallback).
 * @param role - the roster role name (the child label).
 * @returns the label-keyed bucket name.
 */
export function consultLabelKey(role: string): string {
  return CONSULT_LABEL_KEY_PREFIX + role
}

/** One observed tool call of a child — the unit the deadman's in-flight predicate reads. */
export interface ConsultActivity {
  /** The registered tool name (`bash` is the only name with the no-age-bound exemption). */
  name: string
  /** When the call started, epoch milliseconds. */
  startedAt: number
  /** The call's argument object, quoted (truncated) in the handoff. */
  arguments?: Record<string, unknown>
}

/** What is known about one child's tool calls: the OPEN call plus the last few completed ones. */
export interface ConsultToolActivity {
  /** The call currently in flight, when one is open. */
  current?: ConsultActivity
  /** The most recent COMPLETED calls, oldest first, bounded by {@link CONSULT_ACTIVITY_HISTORY}. */
  history: ConsultActivity[]
  /**
   * When the newest observable activity was seen, epoch milliseconds: a tool boundary (start or
   * end) or a committed assistant message. The deadman compares the idle it measures from here
   * against its bound, so a stamp inside the window re-arms the timer instead of letting the
   * expiry cut a working child; absent, the measurement falls back to the consult's own start.
   */
  lastActivityAt?: number
  /**
   * The last committed assistant message's text, when the activity source observes the child's
   * `session/event` stream. The handoff quotes it so a resumed child knows what it was saying when
   * it went silent; absent, the handoff states that none was observed.
   */
  lastAssistantMessage?: string
}

/** Everything one consult start needs; `raise` closes over the roster's route/persona resolution. */
export interface ConsultStartInput {
  /** The roster role name (also the child label, and the activity key the deadman reads). */
  role: string
  /** The task text, recorded in the handoff document. */
  task: string
  /** The caller's tool execution; used for the workspace-scoped handoff directory only. */
  exec: unknown
  /** Raise the child on the shared activation seam; resolves once the child STARTED. */
  raise: () => Promise<DshAsyncAgent>
  /**
   * Optional SETTLEMENT OBSERVER: fired exactly ONCE when this consult leaves `running`.
   *
   * WHY IT EXISTS (cellwork consult DAG, contract §5.2). A caller that records the consult somewhere
   * durable must be able to learn it settled WITHOUT a seat happening to call `wait`/`collect` — a
   * picture that only updates when someone looks would show a finished consult as running forever.
   * The callback is invoked from the ONE settlement path (`finish`/`failRecord`), so it fires for every
   * outcome: a report, a deadman interruption, a cancel and a raise failure.
   *
   * ABSENT MEANS TODAY'S BEHAVIOUR: nothing is constructed and nothing is called, so every existing
   * caller is inert with respect to it. A THROW from the callback is caught and logged — an observer must
   * never be able to break the settlement it observes.
   */
  onSettled?: (outcome: ConsultOutcome) => void
}

/** The lifecycle state of one consult record. */
export type ConsultState = "running" | "complete" | "interrupted" | "failed"

/** The report one settled consult carries — the blocking tool's unchanged shape (§D0.1). */
export interface ConsultReport {
  /** The roster role name. */
  role: string
  /** `complete` when the child reported, `interrupted` when the deadman settled it. */
  status: "complete" | "interrupted"
  /** The child's summary, or its final text when it structured none. */
  summary: string
  /** The child's recommendation, empty when absent. */
  recommendation: string
  /** The child's details, empty when absent. */
  details: string
  /** The evidence entries the child cited. */
  evidence: string[]
  /** Why the child stopped, or null when the host declared none. */
  stopReason: string | null
  /** The consult identity, stable for the process life (§D2.3). */
  consultId: string
  /** The consult's elapsed time at settlement, milliseconds. */
  elapsedMs: number
  /** The handoff document, present only on an interruption (§D2.6). */
  handoff?: string
  /** The last observed activity spelled for the report, present only on an interruption. */
  lastActivity?: string
}

/** The public view of one consult (the `list` / `wait` answer). */
export interface ConsultView {
  /** The stable consult identity. */
  consultId: string
  /** The roster role name. */
  role: string
  /** The lifecycle state. */
  state: ConsultState
  /** When the consult started, epoch milliseconds. */
  startedAt: number
  /** How long it has been running (or ran), milliseconds. */
  elapsedMs: number
  /** The handoff path, when the consult was interrupted with one. */
  handoff?: string
}

/** The `collect` / `cancel` answer: a view, plus the released report when the consult settled. */
export interface ConsultOutcome extends ConsultView {
  /** The settled report, released from the registry by `collect`. */
  report?: ConsultReport
  /** The failure text of a consult whose child could not be raised. */
  error?: string
}

/** The dependencies the supervisor is composed with; every one is injectable for a bootless test. */
export interface ConsultSupervisorDeps {
  /** The workspace handoff directory for THIS caller, resolved per call; `<ws>/.mpd/handoff`. */
  handoffDir: (exec: unknown) => string
  /** Report one line (a long-bash record, a handoff failure, a deadman error). */
  log: (line: string) => void
  /** The cap on running consults; defaults to {@link CONSULT_MAX_DEFAULT}. */
  maxConcurrent?: () => number
  /** The deadman bound, milliseconds, read PER ARM from the live config chain (§S9). */
  forceAfterMs?: () => number
  /**
   * The in-flight-tool bound, milliseconds, read PER EXPIRY: an OPEN tool younger than this is
   * activity, an older one is not (§S3). Defaults to {@link CONSULT_TOOL_IN_FLIGHT_MAX_MS}; `0`
   * keeps the watchdog's meaning (no open tool explains silence away).
   */
  toolInFlightMaxMs?: () => number
  /**
   * The child's current/last tool activity, keyed by the CHILD's id (F1 repair).
   *
   * The first argument is `record.handle?.id` — `DshAsyncAgent.id`, available from the moment `arm()`
   * runs; `role` is the display fallback used only when no id exists.
   */
  activityOf?: (childId: string | undefined, role: string) => ConsultToolActivity | undefined
  /** Clock, epoch milliseconds. */
  now?: () => number
  /** Timer arming, injectable. */
  setTimer?: (fn: () => void, ms: number) => unknown
  /** Timer clearing, injectable. */
  clearTimer?: (handle: unknown) => void
}

/** The supervisor `apply` builds once and every consult surface shares. */
export interface ConsultSupervisor {
  /** Start one consult and return its RUNNING view at once (queueing and spawning run behind it). */
  start(input: ConsultStartInput): ConsultView
  /** Wait for one consult's settlement and return its report (the blocking tool's await). */
  settle(consultId: string): Promise<ConsultReport>
  /** Block up to `timeoutMs` (clamped to {@link CONSULT_WAIT_MAX_MS}) for a report, a view, or a failure. */
  wait(consultId: string, timeoutMs: number): Promise<ConsultView | ConsultReport | ConsultOutcome>
  /** Return the settled report and RELEASE the record (a running consult answers its view). */
  collect(consultId: string): ConsultOutcome
  /** Interrupt this consult's child and settle it `interrupted` (a caller-initiated stop). */
  cancel(consultId: string): ConsultOutcome
  /** Every consult this process knows, in creation order. */
  list(): ConsultView[]
}

/** One internal record; a caller only ever holds a {@link ConsultView} or a {@link ConsultReport}. */
interface ConsultRecord {
  /** The stable consult identity. */
  id: string
  /** The roster role name. */
  role: string
  /** The task text, kept for the handoff. */
  task: string
  /** The caller's execution, kept for the workspace-scoped handoff directory. */
  exec: unknown
  /** The lifecycle state. */
  state: ConsultState
  /** When the consult started, epoch milliseconds. */
  startedAt: number
  /** The activation handle, once the child started. */
  handle?: DshAsyncAgent
  /** The deadman timer handle. */
  timer?: unknown
  /**
   * The bound the CURRENT arm was set under, milliseconds. An expiry decides with THIS value, so a
   * configuration change that lands mid-flight governs the NEXT arm instead of moving the deadline of
   * the one already running (AC9); a live `0` still disables the rule outright.
   */
  armBoundMs?: number
  /** The settlement promise every surface awaits. */
  done: Promise<ConsultReport>
  /** The settlement resolver. */
  resolve: (report: ConsultReport) => void
  /** The settlement rejecter (only a failure to raise the child reaches it). */
  reject: (error: unknown) => void
  /** Whether the record already settled (one settlement per consult). */
  reported: boolean
  /** The settled report, once `reported`. */
  report?: ConsultReport
  /** The failure text of a consult whose child could not be raised. */
  failure?: string
  /** The handoff path, when the deadman wrote one. */
  handoff?: string
  /** Whether the concurrency slot was returned. */
  released: boolean
  /** Whether this record HOLDS a slot granted by `acquire()` (a queued consult holds none). */
  held: boolean
  /** Whether the ONE `consult-long-bash` incident was already recorded (one per consult, not one per re-arm). */
  longBashLogged?: boolean
  /** The `startedAt` of the open call already reported as in-flight activity, so one call yields one line. */
  inFlightLoggedFor?: number
  /** The caller's optional settlement observer, fired once from the ONE settlement path. */
  onSettled?: (outcome: ConsultOutcome) => void
}

/**
 * Read `MPD_DSH_CONSULT_MAX` (§D2.5), falling back to {@link CONSULT_MAX_DEFAULT} on anything
 * unusable — a bad value must not disable the cap or make the tool throw.
 * @returns the positive cap in force.
 */
export function consultMaxFromEnv(): number {
  /** The raw env value, or undefined outside a process. */
  const raw = typeof process !== "undefined" && process.env ? process.env.MPD_DSH_CONSULT_MAX : undefined
  /** The parsed bound; a non-positive or unparsable answer is replaced by the default. */
  const parsed = typeof raw === "string" && raw.trim() !== "" ? Math.trunc(Number(raw)) : Number.NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : CONSULT_MAX_DEFAULT
}

/**
 * Build the consult supervisor (§D2).
 * @param deps - the raise/handoff/clock seams this module composes with.
 * @returns the supervisor every consult surface shares.
 */
export function createConsultSupervisor(deps: ConsultSupervisorDeps): ConsultSupervisor {
  /** Clock in epoch milliseconds. */
  const now = deps.now ?? ((): number => Date.now())
  /** Arm a timer (the deadman and the wait bound both use it). */
  const setTimer = deps.setTimer ?? ((fn: () => void, ms: number): unknown => setTimeout(fn, ms))
  /** Clear a timer. */
  const clearTimer = deps.clearTimer ?? ((handle: unknown): void => { clearTimeout(handle as ReturnType<typeof setTimeout>) })
  /** The deadman bound read per arm, so a config change applies to the NEXT arm (§S9). */
  const forceAfterMs = deps.forceAfterMs ?? ((): number => CONSULT_FORCE_AFTER_MS)
  /** The in-flight-tool bound read per expiry, so a config change applies to the NEXT expiry (§S3). */
  const toolInFlightMaxMs = deps.toolInFlightMaxMs ?? ((): number => CONSULT_TOOL_IN_FLIGHT_MAX_MS)
  /** The concurrency cap read per start. */
  const maxConcurrent = deps.maxConcurrent ?? ((): number => CONSULT_MAX_DEFAULT)

  /**
   * The deadman bound one arm runs under, milliseconds.
   *
   * A non-positive answer DISABLES the deadman, which is the shared meaning of the knob (`0`
   * disables the rule); an unusable answer falls back to {@link CONSULT_FORCE_AFTER_MS} rather than
   * catching a parse error and firing at once.
   * @returns the bound in milliseconds, `<= 0` when the deadman is disabled.
   */
  const boundOf = (): number => {
    /** The configured bound, truncated to whole milliseconds. */
    const configured = Math.trunc(Number(forceAfterMs()))
    return Number.isFinite(configured) ? configured : CONSULT_FORCE_AFTER_MS
  }

  /**
   * The in-flight-tool bound one expiry runs under, milliseconds.
   * @returns the bound in milliseconds; `0` means no open tool explains silence away.
   */
  const inFlightBoundOf = (): number => {
    /** The configured bound, truncated to whole milliseconds. */
    const configured = Math.trunc(Number(toolInFlightMaxMs()))
    return Number.isFinite(configured) ? Math.max(0, configured) : CONSULT_TOOL_IN_FLIGHT_MAX_MS
  }
  /** Every live consult, keyed by its id (insertion order is creation order). */
  const records = new Map<string, ConsultRecord>()
  /** The number of consults occupying a concurrency slot right now. */
  let active = 0
  /** Waiters for a slot, FIFO so the queue is fair and never starved. */
  const queue: Array<() => void> = []
  /** The monotonic part of a consult id, so two starts in one millisecond never collide. */
  let sequence = 0

  /** Take one concurrency slot: immediate when under the cap, queued otherwise (never throws). */
  const acquire = (): Promise<void> => {
    /** The cap in force for this start; a broken value degrades to the default. */
    const cap = Math.max(1, Math.trunc(Number(maxConcurrent())) || CONSULT_MAX_DEFAULT)
    if (active < cap) {
      active += 1
      return Promise.resolve()
    }
    return new Promise<void>((resolve) => { queue.push(() => { active += 1; resolve() }) })
  }

  /** Give one slot back, waking exactly one waiter. */
  const release = (): void => {
    active = Math.max(0, active - 1)
    /** The next waiter, when one is queued. */
    const next = queue.shift()
    if (next !== undefined) next()
  }

  /** Mint one running record with its settlement promise. */
  const createRecord = (input: ConsultStartInput): ConsultRecord => {
    sequence += 1
    /** The stable id: time + sequence, readable in a log and unique per process. */
    const id = "consult-" + now().toString(36) + "-" + sequence.toString(36)
    /** The settlement resolver, filled by the promise executor below. */
    let settle: (report: ConsultReport) => void = (): void => undefined
    /** The settlement rejecter, filled by the promise executor below. */
    let fail: (error: unknown) => void = (): void => undefined
    /** The settlement promise; its executor runs synchronously, so both callbacks exist at once. */
    const done = new Promise<ConsultReport>((resolve, reject) => { settle = resolve; fail = reject })
    // A consult nobody collected must not surface as an unhandled rejection; the report stays
    // readable through the record, and `settle` still observes the original rejection.
    void done.catch(() => undefined)
    return { id, role: input.role, task: input.task, exec: input.exec, state: "running", startedAt: now(), done, resolve: settle, reject: fail, reported: false, released: false, held: false, ...(input.onSettled === undefined ? {} : { onSettled: input.onSettled }) }
  }

  /** Project a settled handle onto the report shape every consumer reads (§D0.1). */
  const reportFrom = (record: ConsultRecord, result: DshSpawnResult): ConsultReport => {
    /** The child's structured answer, when it produced one. */
    const structured = (result.structured ?? {}) as Record<string, unknown>
    return {
      role: record.role,
      status: "complete",
      summary: typeof structured.summary === "string" ? structured.summary : result.output,
      recommendation: typeof structured.recommendation === "string" ? structured.recommendation : "",
      details: typeof structured.details === "string" ? structured.details : "",
      evidence: Array.isArray(structured.evidence) ? structured.evidence.map((entry) => String(entry)) : [],
      stopReason: typeof result.stopReason === "string" ? result.stopReason : null,
      consultId: record.id,
      elapsedMs: now() - record.startedAt,
    }
  }

  /**
   * Fire the caller's settlement observer once, defensively.
   *
   * Called from BOTH settlement paths AFTER the record's own state is final, so an observer sees the
   * settled view rather than the running one it already knew. `reported` is the single-shot guard: a
   * consult settles once, so an observer cannot be told twice even if both paths were somehow reached.
   * @param record - the record that just settled.
   */
  const notifySettled = (record: ConsultRecord): void => {
    /** The observer, when the caller supplied one. */
    const observer = record.onSettled
    if (observer === undefined) return
    try {
      observer({ ...viewOf(record), ...(record.report === undefined ? {} : { report: record.report }), ...(record.failure === undefined ? {} : { error: record.failure }) })
    } catch (error) {
      deps.log("mpd_role_spawn_async: the onSettled observer threw (" + (error instanceof Error ? error.message : String(error)) + ") — the consult settled anyway")
    }
  }

  /** Settle a record ONCE: clear the deadman, free its slot, publish the report. */
  const finish = (record: ConsultRecord, report: ConsultReport): void => {
    if (record.reported) return
    record.reported = true
    record.report = report
    record.state = report.status
    if (record.handoff !== undefined) record.report = { ...report, handoff: record.handoff }
    if (record.timer !== undefined) {
      clearTimer(record.timer)
      record.timer = undefined
    }
    // A QUEUED consult holds no slot, so settlement must not release one (CR repair: cancelling a
    // queued consult used to admit one extra child). The waiter that is later woken releases the slot
    // it was granted in `start`'s early-return branch.
    if (record.held && !record.released) {
      record.released = true
      release()
    }
    record.resolve(record.report)
    notifySettled(record)
  }

  /** Settle a record as FAILED once: clear the deadman, free its slot, reject the settlement. */
  const failRecord = (record: ConsultRecord, error: unknown): void => {
    if (record.reported) return
    record.reported = true
    record.state = "failed"
    record.failure = error instanceof Error ? error.message : String(error)
    if (record.timer !== undefined) {
      clearTimer(record.timer)
      record.timer = undefined
    }
    if (record.held && !record.released) {
      record.released = true
      release()
    }
    record.reject(error)
    notifySettled(record)
  }

  /** Render one observed call for the handoff: name + a ≤400-character argument excerpt. */
  const describeCall = (call: ConsultActivity): string => {
    /** The argument JSON, truncated to the contract's 400-character bound. */
    const args = call.arguments === undefined ? "" : JSON.stringify(call.arguments)
    return call.name + (args === "" ? "" : " " + (args.length > 400 ? args.slice(0, 400) + "…" : args))
  }

  /** Spell the last observed activity: the OPEN call first, then the recent history newest-first. */
  const lastActivityOf = (activity: ConsultToolActivity | undefined): string | undefined => {
    if (activity === undefined) return undefined
    /** The in-flight call first, then the completed ring newest-first. */
    const calls = [...(activity.current === undefined ? [] : [activity.current]), ...[...activity.history].reverse()]
    if (calls.length === 0) return undefined
    return calls.slice(0, CONSULT_ACTIVITY_HISTORY).map(describeCall).join(" | ")
  }

  /**
   * Measure how long the consult has been idle at one expiry.
   *
   * The newest instant the source reported wins: `lastActivityAt` (a stamped tool boundary or a
   * committed assistant message), an open call's start, then the completed history, each only as a
   * fallback for a source that stamps none of them. A consult with no observation at all measures
   * from its own start, so the document always states a measured duration.
   * @param record - the consult being forced.
   * @param activity - the source's view, when it has one.
   * @param at - the expiry instant, epoch milliseconds.
   * @returns the idle duration in milliseconds, never negative.
   */
  const idleMsOf = (record: ConsultRecord, activity: ConsultToolActivity | undefined, at: number): number => {
    /** Every instant the source can attest, the consult's own start first. */
    const stamps: number[] = [record.startedAt]
    if (typeof activity?.lastActivityAt === "number" && Number.isFinite(activity.lastActivityAt)) stamps.push(activity.lastActivityAt)
    if (typeof activity?.current?.startedAt === "number" && Number.isFinite(activity.current.startedAt)) stamps.push(activity.current.startedAt)
    for (const call of activity?.history ?? []) {
      if (typeof call.startedAt === "number" && Number.isFinite(call.startedAt)) stamps.push(call.startedAt)
    }
    return Math.max(0, at - Math.max(...stamps))
  }

  /**
   * Write the handoff document the deadman promises; never throws (a failure is a log line).
   * @param record - the consult being forced.
   * @param activity - the source's view, quoted for whoever resumes the task.
   * @param boundMs - the deadman bound this expiry ran under, quoted as the trigger.
   * @param idleMs - the measured idle duration that triggered the force.
   * @returns the document path, or undefined when the write failed.
   */
  const writeHandoff = (record: ConsultRecord, activity: ConsultToolActivity | undefined, boundMs: number, idleMs: number): string | undefined => {
    try {
      /** The workspace handoff directory for this consult's caller. */
      const dir = deps.handoffDir(record.exec)
      mkdirSync(dir, { recursive: true })
      /** The UTC instant, colon-safe for a file name. */
      const instant = new Date(now()).toISOString().replace(/[:.]/g, "-")
      /** The document path the report carries. */
      const path = join(dir, "consult-" + record.id + "-" + instant + ".md")
      /** The completed calls, oldest first. */
      const calls = activity === undefined ? [] : activity.history
      /** The call open AT KILL TIME: past the in-flight bound, or the bound was disabled. */
      const open = activity?.current
      /** How long that open call had run, milliseconds (0 when no call was open). */
      const openAgeMs = open === undefined ? 0 : Math.max(0, now() - open.startedAt)
      /** The last committed assistant message, when the source observed one. */
      const message = activity?.lastAssistantMessage
      /** The message line: the quoted answer on ONE line, or the honest absence. */
      const messageLine = message === undefined || message === ""
        ? "- last assistant message: (none observed)"
        : "- last assistant message: " + (message.length > CONSULT_MESSAGE_EXCERPT ? message.slice(0, CONSULT_MESSAGE_EXCERPT) + "…" : message).replace(/\s+/g, " ")
      /** The document, one line per contract section. */
      const lines = [
        "# Consult handoff — " + record.id,
        "",
        "- task: " + record.task,
        "- role: " + record.role,
        "- started: " + new Date(record.startedAt).toISOString(),
        "- elapsed: " + (now() - record.startedAt) + " ms (deadman bound " + boundMs + " ms)",
        "- idle: " + idleMs + " ms with no observable activity" + (open === undefined ? "" : "; the open " + open.name + " call had run " + openAgeMs + " ms"),
        messageLine,
        "- last tool calls:",
        ...(open === undefined ? [] : ["  - (IN FLIGHT) " + describeCall(open)]),
        ...(calls.length === 0 && open === undefined ? ["  - (none observed)"] : []),
        ...calls.map((call) => "  - " + describeCall(call)),
        "",
        "Next step: resume the task above from the last completed tool call. The child was interrupted",
        "by the consult deadman after " + idleMs + " ms with no observable activity (bound " + boundMs + " ms"
          + (open === undefined ? "" : ", and its open " + open.name + " call had run " + openAgeMs + " ms and no longer counted as activity")
          + ").",
        "",
      ]
      writeFileSync(path, lines.join("\n"), "utf8")
      return path
    } catch (error) {
      deps.log("consult handoff could not be written for " + record.id + ": " + (error instanceof Error ? error.message : String(error)))
      return undefined
    }
  }

  /**
   * The deadman (§D2.6, §S9): decide whether THIS consult is still working, and act only when it is not.
   *
   * The predicate is the force supervisor's, applied to this consult's own tool map, and it is decided
   * on MEASURED SILENCE rather than on the mere fact that a timer expired: with an open `bash` the
   * child is exempt at ANY age (one `consult-long-bash` record); with another open tool YOUNGER than
   * the in-flight bound it is working (re-arm); with an open tool PAST that bound it is hung and this
   * expiry settles it. With no open tool the measured idle (`now - lastActivityAt`, stamped by every
   * tool start, every tool completion and every committed assistant message) decides BEFORE anything
   * is interrupted: below the bound the child is demonstrably working and re-arms from the REMAINING
   * time, so a slow-but-busy child is never cut at the bound; at or past it the child is silent and
   * gets the handoff plus the interrupt.
   * @param record - the running consult whose deadman expired.
   */
  const onDeadman = (record: ConsultRecord): void => {
    if (record.reported) return
    // THE SUBJECT IS THE CHILD (F1 repair): ask for THIS consult's own child id, so a same-role
    // sibling's tool start/end can never overwrite or clear this child's open-call stamp.
    /** The child's activity, when the row observes tool calls. */
    const activity = deps.activityOf?.(record.handle?.id, record.role)
    /** The expiry instant, epoch milliseconds. */
    const at = now()
    /** The elapsed time at expiry, milliseconds. */
    const elapsedMs = at - record.startedAt
    /** The deadman bound this expiry runs under, quoted in the handoff and the report. */
    const boundMs = boundOf()
    // The knob can be turned to `0` WHILE a consult runs: that declares the deadman DISABLED, so an
    // already-armed timer stops instead of cutting a child the operator just unbound.
    if (boundMs <= 0) return
    /** The bound the CURRENT arm was set under: the deadline this expiry is measuring against (AC9). */
    const armBoundMs = record.armBoundMs ?? boundMs
    /** The call currently open, when one is. */
    const open = activity?.current
    if (open?.name === "bash") {
      // THE NO-AGE-BOUND EXEMPTION (§D2.6, kept by §S3): a legitimate verification run may take an
      // hour, so the deadman records ONE incident and re-arms instead of killing the child. This is
      // the only case that ignores the in-flight bound.
      if (record.longBashLogged !== true) {
        record.longBashLogged = true
        deps.log("consult-long-bash " + record.id + " role=" + record.role + " elapsedMs=" + elapsedMs + " — an OPEN bash call is exempt from the consult deadman; re-armed")
      }
      arm(record)
      return
    }
    /** Whether an open NON-`bash` call has outlived the in-flight bound, which makes it a hung tool. */
    let hung = false
    if (open !== undefined) {
      /** The in-flight bound this expiry runs under, milliseconds. */
      const inFlightMs = inFlightBoundOf()
      /** How long that call has been open, milliseconds. */
      const openAgeMs = Math.max(0, at - open.startedAt)
      if (inFlightMs > 0 && openAgeMs < inFlightMs) {
        // ANY in-flight tool younger than the bound is activity (§S3) — not just `bash`. One log line
        // per open call keeps the re-arm visible without turning a long call into a log loop.
        if (record.inFlightLoggedFor !== open.startedAt) {
          record.inFlightLoggedFor = open.startedAt
          deps.log("consult-tool-in-flight " + record.id + " role=" + record.role + " tool=" + open.name + " ageMs=" + openAgeMs + " boundMs=" + inFlightMs + " — the open call is activity; re-armed")
        }
        arm(record)
        return
      }
      // Past that bound the call stops counting as activity (§S3), so this expiry settles the child
      // whatever the idle measurement says: a hung tool is the one case silence cannot explain away.
      hung = inFlightMs > 0
    }
    /** The measured idle duration at THIS expiry (§S9), milliseconds — taken BEFORE the decision. */
    const idleMs = idleMsOf(record, activity, at)
    if (!hung && idleMs < armBoundMs) {
      // THE CHILD IS DEMONSTRABLY WORKING: a tool completion, a tool start or a committed assistant
      // message landed inside the bound, so the expiry is not a silence. Re-arm from what is LEFT of
      // the bound (never a fresh full bound), which keeps the deadline honest for a slow child and
      // means a child producing activity at any cadence below the bound is never interrupted at all.
      /** The time left before this child would really be silent, milliseconds (at least 1). */
      const remainingMs = armBoundMs - idleMs
      arm(record, remainingMs)
      return
    }
    /** The handoff path written before the interrupt (undefined when the write failed). */
    const handoff = writeHandoff(record, activity, armBoundMs, idleMs)
    if (handoff !== undefined) record.handoff = handoff
    record.state = "interrupted"
    try {
      record.handle?.interrupt()
    } catch {
      // Best-effort: the handoff on disk is the durable notification and the report still records
      // the interruption.
    }
    /** The interruption report: the handoff path, the idle duration and the last activity ride it (§D2.6/§S9). */
    const report: ConsultReport = {
      role: record.role,
      status: "interrupted",
      summary: "consult interrupted by the consult deadman after " + idleMs + " ms with no observable activity (bound " + armBoundMs + " ms)" + (handoff === undefined ? "" : " — handoff: " + handoff),
      recommendation: "",
      details: "",
      evidence: handoff === undefined ? [] : [handoff],
      stopReason: "interrupted",
      consultId: record.id,
      elapsedMs,
      ...(handoff === undefined ? {} : { handoff }),
      ...(lastActivityOf(activity) === undefined ? {} : { lastActivity: lastActivityOf(activity) as string }),
    }
    finish(record, report)
  }

  // Declared AFTER its caller on purpose: `onDeadman` runs only from a timer, long after this
  // function body completed, so the hoisted binding is always assigned by then.
  /**
   * Arm (or RE-arm) the deadman for one running record.
   *
   * The bound is resolved HERE, per arm, through the live chain (§S9); a non-positive bound disables
   * the deadman and arms nothing, exactly as `forceAfterMs: 0` disables the watchdog's rule.
   * @param record - the consult to supervise.
   * @param delayMs - how long THIS arm waits, milliseconds. Absent means the full bound, which is what
   *   the first arm and every open-tool re-arm use; a re-arm on measured activity passes the REMAINING
   *   time (`bound - idle`) instead, so the deadline cannot slide past the silence bound.
   */
  const arm = (record: ConsultRecord, delayMs?: number): void => {
    if (record.reported) return
    /** The bound in force for this arm, milliseconds. */
    const bound = boundOf()
    if (bound <= 0) return
    /** The delay this arm waits, clamped to 1 ms so a nearly-exhausted bound still re-checks once. */
    const waitMs = delayMs === undefined ? bound : Math.max(1, Math.min(bound, Math.trunc(delayMs)))
    record.armBoundMs = bound
    record.timer = setTimer(() => {
      try {
        onDeadman(record)
      } catch (error) {
        deps.log("consult deadman threw for " + record.id + ": " + (error instanceof Error ? error.message : String(error)))
      }
    }, waitMs)
  }

  /** Project a record onto the public view. */
  const viewOf = (record: ConsultRecord): ConsultView => ({
    consultId: record.id,
    role: record.role,
    state: record.state,
    startedAt: record.startedAt,
    elapsedMs: now() - record.startedAt,
    ...(record.handoff === undefined ? {} : { handoff: record.handoff }),
  })

  /** Resolve one consult id or throw the tool-facing error. */
  const requireRecord = (consultId: string): ConsultRecord => {
    /** The record, when this process minted it. */
    const record = records.get(consultId)
    if (record === undefined) throw new Error("mpd_role_consult: unknown consultId \"" + consultId + "\" — use action list")
    return record
  }

  /** Start one consult; returns its RUNNING view at once (queueing and spawning run behind it). */
  const start = (input: ConsultStartInput): ConsultView => {
    /** The record this call owns. */
    const record = createRecord(input)
    records.set(record.id, record)
    void (async (): Promise<void> => {
      await acquire()
      // The slot is GRANTED from here on, so settlement may release it; before this line a queued
      // consult owns nothing.
      record.held = true
      // A cancel that landed while this consult was QUEUED never starts a child. Its waiter was just
      // granted a slot, so THIS branch still releases that granted slot.
      if (record.reported) {
        if (!record.released) {
          record.released = true
          release()
        }
        return
      }
      try {
        /** The started activation handle. */
        const handle = await input.raise()
        record.handle = handle
        if (record.reported) {
          try { handle.interrupt() } catch { /* already settled */ }
          return
        }
        arm(record)
        void handle.result.then(
          (result: DshSpawnResult): void => { finish(record, reportFrom(record, result)) },
          (error: unknown): void => { failRecord(record, error) },
        )
      } catch (error) {
        failRecord(record, error)
      }
    })()
    return viewOf(record)
  }

  /** Wait for one consult's settlement and return its report. */
  const settle = async (consultId: string): Promise<ConsultReport> => {
    /** The record being awaited. */
    const record = requireRecord(consultId)
    return await record.done
  }

  /** Block up to `timeoutMs` for a report, or answer the running/failed view when the bound wins. */
  const wait = async (consultId: string, timeoutMs: number): Promise<ConsultView | ConsultReport | ConsultOutcome> => {
    /** The record being awaited. */
    const record = requireRecord(consultId)
    // A consult that already SETTLED answers at once; a FAILED one carries its failure text, exactly
    // as `collect` would, so the two read surfaces never disagree about why it failed (CR repair).
    if (record.reported) return record.report ?? { ...viewOf(record), ...(record.failure === undefined ? {} : { error: record.failure }) }
    /** The bound in force: 1..CONSULT_WAIT_MAX_MS, defaulting when unstated or invalid. */
    const bound = Math.min(CONSULT_WAIT_MAX_MS, Math.max(1, Math.trunc(Number(timeoutMs)) || CONSULT_WAIT_DEFAULT_MS))
    return await new Promise<ConsultView | ConsultReport | ConsultOutcome>((resolve) => {
      /** The timeout's timer handle. */
      let timer: unknown
      /** Answer with the current view (the consult is still running). */
      const timedOut = (): void => {
        if (timer !== undefined) clearTimer(timer)
        resolve(viewOf(record))
      }
      timer = setTimer(timedOut, bound)
      void record.done.then(
        (report: ConsultReport): void => {
          if (timer !== undefined) clearTimer(timer)
          resolve(report)
        },
        (): void => {
          if (timer !== undefined) clearTimer(timer)
          // A FAILED settlement carries the failure text: the output schema already has `error`, and
          // `collect` answers it too — `wait` used to drop it (CR repair).
          resolve({ ...viewOf(record), ...(record.failure === undefined ? {} : { error: record.failure }) })
        },
      )
    })
  }

  /** Return the settled report and RELEASE the record (a running consult answers its view). */
  const collect = (consultId: string): ConsultOutcome => {
    /** The record being collected. */
    const record = requireRecord(consultId)
    if (!record.reported) return viewOf(record)
    /** The released report. */
    const report = record.report
    records.delete(consultId)
    return { ...viewOf(record), ...(report === undefined ? {} : { report }), ...(record.failure === undefined ? {} : { error: record.failure }) }
  }

  /** Interrupt this consult's child and settle it `interrupted` (a caller-initiated stop). */
  const cancel = (consultId: string): ConsultOutcome => {
    /** The record being cancelled. */
    const record = requireRecord(consultId)
    if (record.reported) return { ...viewOf(record), ...(record.report === undefined ? {} : { report: record.report }) }
    record.state = "interrupted"
    if (record.timer !== undefined) {
      clearTimer(record.timer)
      record.timer = undefined
    }
    try {
      record.handle?.interrupt()
    } catch {
      // Best-effort, as in the deadman: the settlement below is what the caller observes.
    }
    /** The cancellation report (no handoff: the caller cancelled, the deadman did not fire). */
    const report: ConsultReport = {
      role: record.role,
      status: "interrupted",
      summary: "consult cancelled by the caller",
      recommendation: "",
      details: "",
      evidence: [],
      stopReason: "interrupted",
      consultId: record.id,
      elapsedMs: now() - record.startedAt,
    }
    finish(record, report)
    return { ...viewOf(record), report }
  }

  /** Every consult this process knows, in creation order. */
  const list = (): ConsultView[] => [...records.values()].map(viewOf)

  return { start, settle, wait, collect, cancel, list }
}
