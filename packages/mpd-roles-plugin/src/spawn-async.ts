// The consult supervisor for mpd-roles-plugin (§D2 of the throughput contract).
//
// ONE record per consult — blocking or async — because the two surfaces differ only in WHEN the
// caller reads the report. A record owns: the shared activation handle (`dsh.spawnAgentAsync`), the
// concurrency slot (`MPD_DSH_CONSULT_MAX`, default 8: over the cap a consult QUEUES and never
// throws), the 15-minute deadman (900 000 ms, the user's one-shot rule) and the handoff document the
// deadman writes before it interrupts a child. Open `bash` is the deadman's ONLY exemption and it
// has NO age bound (§D2.6).
//
// The module is deliberately free of harness services: it receives the raise and handoff seams, so
// its tests need no boot and a per-plane caller can reuse it.

import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { DshAsyncAgent, DshSpawnResult } from "../../mpd-dsh-adapter-plugin/src/index"

/** The default deadman bound on one consult: 15 minutes, the user's one-shot rule (§D2.6). */
export const CONSULT_FORCE_AFTER_MS = 900_000
/** The default cap on concurrently RUNNING consults (§D2.5) — the host's active-child limit. */
export const CONSULT_MAX_DEFAULT = 8
/** The largest `mpd_role_consult wait` timeout the tool accepts, in milliseconds (§D2.4). */
export const CONSULT_WAIT_MAX_MS = 60_000
/** The `wait` timeout used when the caller states none, in milliseconds. */
export const CONSULT_WAIT_DEFAULT_MS = 30_000
/** How many completed tool calls the handoff document may quote (name + a ≤400-character excerpt). */
export const CONSULT_ACTIVITY_HISTORY = 5

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

/** One observed tool call of a child — the unit the deadman's bash exemption reads. */
export interface ConsultActivity {
  /** The registered tool name (`bash` is the only name the deadman exempts). */
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
  /** The deadman bound, milliseconds; defaults to {@link CONSULT_FORCE_AFTER_MS}. */
  forceAfterMs?: () => number
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
  /** The deadman bound read per start, so a config change applies to the next consult. */
  const forceAfterMs = deps.forceAfterMs ?? ((): number => CONSULT_FORCE_AFTER_MS)
  /** The concurrency cap read per start. */
  const maxConcurrent = deps.maxConcurrent ?? ((): number => CONSULT_MAX_DEFAULT)
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
    return { id, role: input.role, task: input.task, exec: input.exec, state: "running", startedAt: now(), done, resolve: settle, reject: fail, reported: false, released: false, held: false }
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

  /** Write the handoff document the deadman promises; never throws (a failure is a log line). */
  const writeHandoff = (record: ConsultRecord, activity: ConsultToolActivity | undefined): string | undefined => {
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
      /** The document, one line per contract section. */
      const lines = [
        "# Consult handoff — " + record.id,
        "",
        "- task: " + record.task,
        "- role: " + record.role,
        "- started: " + new Date(record.startedAt).toISOString(),
        "- elapsed: " + (now() - record.startedAt) + " ms (deadman " + forceAfterMs() + " ms)",
        "- last tool calls:",
        ...(activity?.current === undefined ? [] : ["  - (IN FLIGHT) " + describeCall(activity.current)]),
        ...(calls.length === 0 && activity?.current === undefined ? ["  - (none observed)"] : []),
        ...calls.map((call) => "  - " + describeCall(call)),
        "",
        "Next step: resume the task above from the last completed tool call; the child was interrupted",
        "by the 15-minute consult deadman because its open call was not a `bash` command.",
        "",
      ]
      writeFileSync(path, lines.join("\n"), "utf8")
      return path
    } catch (error) {
      deps.log("consult handoff could not be written for " + record.id + ": " + (error instanceof Error ? error.message : String(error)))
      return undefined
    }
  }

  /** The deadman: exempt an OPEN bash, otherwise write the handoff and interrupt (§D2.6). */
  const onDeadman = (record: ConsultRecord): void => {
    if (record.reported) return
    // THE SUBJECT IS THE CHILD (F1 repair): ask for THIS consult's own child id, so a same-role
    // sibling's tool start/end can never overwrite or clear this child's open-call stamp.
    /** The child's activity, when the row observes tool calls. */
    const activity = deps.activityOf?.(record.handle?.id, record.role)
    /** The elapsed time at expiry, milliseconds. */
    const elapsedMs = now() - record.startedAt
    if (activity?.current?.name === "bash") {
      // THE ONLY EXEMPTION, WITH NO AGE BOUND (§D2.6): a legitimate verification run may take an
      // hour, so the deadman records ONE warning and re-arms instead of killing the child.
      deps.log("consult-long-bash " + record.id + " role=" + record.role + " elapsedMs=" + elapsedMs + " — an OPEN bash call is exempt from the consult deadman; re-armed")
      arm(record)
      return
    }
    /** The handoff path written before the interrupt (undefined when the write failed). */
    const handoff = writeHandoff(record, activity)
    if (handoff !== undefined) record.handoff = handoff
    record.state = "interrupted"
    try {
      record.handle?.interrupt()
    } catch {
      // Best-effort: the handoff on disk is the durable notification and the report still records
      // the interruption.
    }
    /** The interruption report: the handoff path and the last observed activity ride it (§D2.6). */
    const report: ConsultReport = {
      role: record.role,
      status: "interrupted",
      summary: "consult interrupted by the 15-minute deadman" + (handoff === undefined ? "" : " — handoff: " + handoff),
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
  /** Arm the deadman for one running record (re-armed after a long-bash exemption). */
  const arm = (record: ConsultRecord): void => {
    if (record.reported) return
    /** The bound in force for this arm, milliseconds. */
    const bound = Math.max(1, Math.trunc(Number(forceAfterMs())) || CONSULT_FORCE_AFTER_MS)
    record.timer = setTimer(() => {
      try {
        onDeadman(record)
      } catch (error) {
        deps.log("consult deadman threw for " + record.id + ": " + (error instanceof Error ? error.message : String(error)))
      }
    }, bound)
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
