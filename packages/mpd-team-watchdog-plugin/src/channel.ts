// The FOUR-STATE CHANNEL PREDICATE (frozen contract §1 / T-48 D1).
//
// The watchdog used to infer a wedge from WALL-CLOCK SILENCE: a member that had
// stamped nothing for `warnSilenceMs` was treated as wedged, so a member writing a
// long answer, or one whose only tasks were blocked on unfinished dependencies,
// earned a WARN and — three ticks later — a HOLD on a healthy team.
//
// This module replaces that inference with a fold over the member's OWN record
// stream (`session/event`, contract §2). Per member session it classifies the
// channel into exactly ONE of four states:
//
//   OUTSTANDING  an open step with NO committed assistant answer — the ONLY state
//                that can warn/escalate, and only after `warnSilenceMs` since the
//                request became outstanding (the clock lives in the machine)
//   IN-FLIGHT    the open step has an answer AND a `tool/call` has no matching
//                `tool/result` — ALIVE until `toolInFlightMaxMs` past the call start
//   ALIVE        a committed answer, a completed step/tool result, or a turn that
//                has not closed — never a wedge, regardless of age
//   PARKED       no open turn (between turns, blocked on dependencies, finished but
//                not yet re-dispatched, staged plan, unclaimed task) — never a wedge
//
// `view()` answers `null` — NOT `PARKED` — when the session has no fold data at all.
// That distinction is the §4 degradation seam: with no channel evidence the engine
// falls back to the heartbeat rule in REPORT-ONLY mode, and a member that was simply
// never observed stays healthy instead of being reported PARKED on no evidence.
//
// The fold is incremental and append-only: `apply` consumes ONE event and updates
// the per-session state; nothing re-reads the log. It never throws, never reads a
// file, and never touches the clock on its own (event times come from the events).
import type { ChannelState } from "./machine.js"

export type { ChannelState }

/** One record-stream event, as much of it as the fold reads. */
export interface ChannelEventLike {
  /** The event's type verbatim (`turn/start`, `tool/call`, `assistant/message`, ...). */
  type?: unknown
  /** The record stream's own sequence number, when the event carries one. */
  seq?: unknown
  /** The event's wall-clock time in ms epoch, when it states one. */
  time?: unknown
  /** The event's payload, shape-checked at every read. */
  data?: unknown
}

/** What the fold concluded about ONE member session. */
export interface ChannelView {
  /** The single state of §1's table. */
  state: ChannelState
  /**
   * When the open request BECAME outstanding (the open step's start, ms epoch).
   * The machine's `warnSilenceMs` clock starts here; `null` for every other state.
   */
  outstandingSince: number | null
  /** The open tool call's start (ms epoch) when the state is IN-FLIGHT, else null. */
  inFlightSince: number | null
  /** The open tool call's tool name (diagnostics), or null. */
  inFlightTool: string | null
  /** The open turn/step, for diagnostics; null when no step is open. */
  turn: number | null
  /** The open step's index inside that turn, or null when no step is open. */
  step: number | null
  /** The newest event time folded for this session, or null when none carried one. */
  lastEventAt: number | null
  /** The newest event type folded for this session (diagnostics). */
  lastEventType: string | null
  /** How many events the fold consumed for this session. */
  events: number
  /** Whether an `agent/assistant-stream` start frame (or an answer) covered the open step. */
  firstToken: boolean
}

/** One assistant-stream frame, as the enrichment seam delivers it. */
export interface StreamFrameLike {
  /** The frame's type: `start`, `end` or `settled`. */
  type?: unknown
  /** The turn the frame belongs to; absent means the fold's open step. */
  turn?: unknown
  /** The step the frame belongs to; absent means the fold's open step. */
  step?: unknown
  /** The frame's time in ms epoch, stored as the streaming marker's stamp. */
  time?: unknown
}

/** The per-session fold state. */
interface SessionFold {
  /** The turn this session currently has open, or null between turns. */
  openTurn: number | null
  /** The step open inside that turn, with its start time; null between steps. */
  openStep: { turn: number; step: number; at: number } | null
  /** Committed answers: `turn/step` -> the event time that committed them. */
  answered: Map<string, number>
  /** Enrichment: an `agent/assistant-stream` start frame covered this `turn/step`. */
  streaming: Map<string, number>
  /** Open tool calls: callId -> its start. */
  openCalls: Map<string, { since: number; tool: string | null }>
  /** Newest event time folded for this session, or null when none carried one. */
  lastEventAt: number | null
  /** Newest event type folded for this session (diagnostics). */
  lastEventType: string | null
  /** How many events this session's fold consumed. */
  events: number
}

/** The `turn/step` key the fold stores answers and streaming under. */
function stepKey(turn: number, step: number): string {
  return String(turn) + "/" + String(step)
}

/** The value as a plain record, or null when it is not a non-null object. */
function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null
}

/** The value as a finite number, or null (NaN and non-numbers included). */
function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

/** The value as a non-empty string, or null. */
function asString(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null
}

/** The event's type, from the record event's own `type` field. */
export function eventTypeOf(event: unknown): string | null {
  return asString(asRecord(event)?.type)
}

/** The event's `data` payload. */
function dataOf(event: unknown): Record<string, unknown> {
  return asRecord(asRecord(event)?.data) ?? {}
}

/**
 * The event's time: the record's `time`, then a payload `time`.
 *
 * `NaN`/absent times are reported as `null` and the fold then keeps its previous
 * timestamp — a missing clock must never invent one (the machine's only clock is
 * the tick's `now`, and §1 rule 2 says only an OUTSTANDING request has a clock).
 */
export function eventTimeOf(event: unknown): number | null {
  // The event as a record, so both time spellings can be probed without a throw.
  const record = asRecord(event)
  return asNumber(record?.time) ?? asNumber(dataOf(event).time)
}

/**
 * The `callId` an event pairs on.
 *
 * `tool/call` carries it directly; `tool/result` carries it inside the model-facing
 * message (`message.content[0].toolCallId`) and older shapes may put it at the top
 * level. A shape that carries none is handled by `completeOldest` below.
 */
export function callIdOf(event: unknown): string | null {
  // The event's payload, where the call id is carried.
  const data = dataOf(event)
  // The model-facing message a result may wrap the call id in.
  const message = asRecord(data.message)
  // The message's content blocks; a non-array reads as "no blocks".
  const content = Array.isArray(message?.content) ? (message?.content as unknown[]) : []
  // The first content block, which is where a tool result names its call.
  const first = asRecord(content[0])
  return (
    asString(data.callId) ??
    asString(data.toolCallId) ??
    asString(first?.toolCallId) ??
    asString(message?.toolCallId) ??
    asString(message?.callId)
  )
}

/** The tool name a `tool/call` names. */
function toolNameOf(event: unknown): string | null {
  // The call event's payload, which names the tool.
  const data = dataOf(event)
  return asString(data.name) ?? asString(asRecord(data.message)?.name)
}

/**
 * The incremental four-state fold, one instance per process.
 *
 * `apply` is called once per `session/event` and is O(1); `view` is the read the tick
 * uses. Neither throws: an event shape the fold does not recognize changes nothing
 * (a future harness event must never be able to take the watchdog down).
 */
export class ChannelFold {
  /** Per-session fold state, keyed by the member session id. */
  private readonly folds = new Map<string, SessionFold>()

  /** How many events were folded (including unrecognized ones). */
  private applied = 0
  /** How many `apply` calls carried no usable session id and were dropped. */
  private unattributed = 0

  /** Fold ONE record event for one session. */
  apply(sessionId: unknown, event: unknown): ChannelView | null {
    // The session id, accepted only as a non-empty string.
    const id = asString(sessionId)
    if (id === null) {
      this.unattributed += 1
      return null
    }
    // This session's fold, created on first sight of the session.
    const fold = this.foldOf(id)
    this.applied += 1
    // The event's type; null marks an event the fold cannot read at all.
    const type = eventTypeOf(event)
    // The event's time, or null when it states none (the fold then keeps its own).
    const at = eventTimeOf(event)
    fold.events += 1
    if (type !== null) fold.lastEventType = type
    if (at !== null) fold.lastEventAt = at
    if (type === null) return this.view(id)
    // The event's payload, where the turn/step and tool fields live.
    const data = dataOf(event)
    // The turn the event belongs to, when it states one.
    const turn = asNumber(data.turn)
    // The step inside that turn, when the event states one.
    const step = asNumber(data.step)
    // The stamp used by state that needs a clock; 0 marks "the event stated no time".
    const time = at ?? 0

    try {
      switch (type) {
        case "turn/start": {
          fold.openTurn = turn
          fold.openStep = null
          break
        }
        case "turn/end": {
          // A closed turn is PARKED: the member finished its turn and is waiting to be
          // re-dispatched. Only the OPEN turn may be closed by it (a late `turn/end`
          // from a previous turn must not close the current one).
          if (fold.openTurn === null || turn === null || turn === fold.openTurn) {
            fold.openTurn = null
            fold.openStep = null
          }
          break
        }
        case "step/start": {
          if (turn !== null && step !== null) fold.openStep = { turn, step, at: time }
          break
        }
        case "step/end": {
          if (fold.openStep !== null && (turn === null || (turn === fold.openStep.turn && step === fold.openStep.step))) {
            fold.openStep = null
          }
          break
        }
        case "assistant/message":
        case "assistant/attempt": {
          // ONE authority: a committed answer is what flips an open step from
          // OUTSTANDING to answered. A payload without turn/step (a plugin-merged
          // attempt event) commits the step that is open right now.
          const key = turn !== null && step !== null ? stepKey(turn, step) : fold.openStep === null ? null : stepKey(fold.openStep.turn, fold.openStep.step)
          if (key !== null) {
            fold.answered.set(key, time)
            fold.streaming.delete(key)
          }
          break
        }
        case "tool/call": {
          // The id pairing this call with its result, when readable.
          const callId = callIdOf(event)
          if (callId !== null) fold.openCalls.set(callId, { since: time, tool: toolNameOf(event) })
          break
        }
        case "tool/result": {
          // The id pairing this result with its call, when readable.
          const callId = callIdOf(event)
          if (callId !== null) fold.openCalls.delete(callId)
          else this.completeOldest(fold)
          break
        }
        default:
          // An unrecognized (or purely informational) event: no state change. A new
          // harness event type must never be able to change the watchdog's verdict.
          break
      }
    } catch {
      // contained: a malformed event degrades to "no state change"
    }
    return this.view(id)
  }

  /**
   * Enrichment (contract §2, never required): the `start` frame of
   * `agent/assistant-stream` proves the model is DELIVERING a long answer, so the
   * open `(turn,step)` is ALIVE even though no `assistant/message` is committed yet
   * (§1 rule 3 — without this signal the state honestly stays OUTSTANDING).
   *
   * @returns whether a fold consumed the frame.
   */
  noteStreamFrame(sessionId: unknown, frame: unknown): boolean {
    // The session id, accepted only as a non-empty string.
    const id = asString(sessionId)
    if (id === null) {
      this.unattributed += 1
      return false
    }
    // The session's existing fold; a frame for an unknown session is dropped.
    const fold = this.folds.get(id)
    if (fold === undefined) return false
    // The frame as a record, so its fields can be probed safely.
    const record = asRecord(frame)
    // The frame's type verbatim (`start`, `end`, `settled`).
    const type = asString(record?.type)
    // The frame's turn, defaulting to the fold's open step.
    const turn = asNumber(record?.turn) ?? fold.openStep?.turn ?? null
    // The frame's step, defaulting to the fold's open step.
    const step = asNumber(record?.step) ?? fold.openStep?.step ?? null
    if (turn === null || step === null) return false
    // The `turn/step` key the streaming marker is stored under.
    const key = stepKey(turn, step)
    if (type === "start") {
      fold.streaming.set(key, asNumber(record?.time) ?? fold.lastEventAt ?? 0)
      return true
    }
    if (type === "end" || type === "settled") fold.streaming.delete(key)
    return false
  }

  /** Whether this session has any folded event (the §4 "no channel evidence" test). */
  has(sessionId: string): boolean {
    // The session's fold, absent when no event was ever folded for it.
    const fold = this.folds.get(sessionId)
    return fold !== undefined && fold.events > 0
  }

  /** The conclusion for one session, or `null` when the fold has no data for it. */
  view(sessionId: unknown): ChannelView | null {
    // The session id, accepted only as a non-empty string.
    const id = asString(sessionId)
    if (id === null) return null
    // The session's fold state, absent for a session that was never folded.
    const fold = this.folds.get(id)
    if (fold === undefined || fold.events === 0) return null

    // The single state this view will report.
    let state: ChannelState
    // The open step's start, set only for OUTSTANDING.
    let outstandingSince: number | null = null
    // The oldest open call's start, set only for IN-FLIGHT.
    let inFlightSince: number | null = null
    // The oldest open call's tool name, set only for IN-FLIGHT.
    let inFlightTool: string | null = null

    if (fold.openTurn === null) {
      // Between turns: blocked on dependencies, finished-but-unupdated, staged plan,
      // unclaimed task, or simply not re-dispatched yet. Never a wedge.
      state = "PARKED"
    } else if (fold.openStep === null) {
      // The turn has not closed but no step is open: the loop is between steps.
      state = "ALIVE"
    } else {
      // The key of the step currently open.
      const key = stepKey(fold.openStep.turn, fold.openStep.step)
      // Whether a committed answer covers that step.
      const answered = fold.answered.has(key)
      // Whether an enrichment start frame covers that step.
      const streaming = fold.streaming.has(key)
      if (!answered && !streaming) {
        state = "OUTSTANDING"
        outstandingSince = fold.openStep.at
      } else if (fold.openCalls.size > 0) {
        state = "IN-FLIGHT"
        // The earliest open call, whose start is the IN-FLIGHT clock.
        let oldest: { since: number; tool: string | null } | null = null
        for (const call of fold.openCalls.values()) if (oldest === null || call.since < oldest.since) oldest = call
        inFlightSince = oldest === null ? null : oldest.since
        inFlightTool = oldest === null ? null : oldest.tool
      } else {
        state = "ALIVE"
      }
    }

    return {
      state,
      outstandingSince,
      inFlightSince,
      inFlightTool,
      turn: fold.openStep?.turn ?? fold.openTurn,
      step: fold.openStep?.step ?? null,
      lastEventAt: fold.lastEventAt,
      lastEventType: fold.lastEventType,
      events: fold.events,
      firstToken: state === "OUTSTANDING" ? false : state === "ALIVE" || state === "IN-FLIGHT",
    }
  }

  /** Every session id the fold holds (sorted), for the status surface. */
  sessions(): string[] {
    return [...this.folds.keys()].sort()
  }

  /** The fold's own counters, for the status surface. */
  snapshot(): { events: number; unattributed: number; sessions: number; states: Record<string, ChannelState> } {
    // The per-session state map this snapshot reports.
    const states: Record<string, ChannelState> = {}
    for (const id of this.sessions()) {
      // The session's conclusion; a fold with no events contributes nothing.
      const view = this.view(id)
      if (view !== null) states[id] = view.state
    }
    return { events: this.applied, unattributed: this.unattributed, sessions: this.folds.size, states }
  }

  /** Drop one session's fold (a session that ended and was disposed). */
  forget(sessionId: string): void {
    this.folds.delete(sessionId)
  }

  /** The session's fold state, created empty on first use. */
  private foldOf(sessionId: string): SessionFold {
    // The existing fold state for this session, if any.
    let fold = this.folds.get(sessionId)
    if (fold === undefined) {
      fold = {
        openTurn: null,
        openStep: null,
        answered: new Map(),
        streaming: new Map(),
        openCalls: new Map(),
        lastEventAt: null,
        lastEventType: null,
        events: 0,
      }
      this.folds.set(sessionId, fold)
    }
    return fold
  }

  /**
   * A `tool/result` that carries no readable `callId` completes the OLDEST open call.
   *
   * The harness's sequential step pattern makes this exactly right (at most one call
   * is open inside a step); with overlapping calls and an unreadable id the fold
   * stays conservative, and the machine's `toolInFlightMaxMs` bound reports whatever
   * is left open ONCE rather than holding anything.
   */
  private completeOldest(fold: SessionFold): void {
    if (fold.openCalls.size === 0) return
    // The call id of the earliest open call, once one is found.
    let oldestId: string | null = null
    // Start time of the earliest open call seen so far, in ms epoch.
    let oldestSince = Number.POSITIVE_INFINITY
    for (const [callId, call] of fold.openCalls) {
      if (call.since < oldestSince) {
        oldestSince = call.since
        oldestId = callId
      }
    }
    if (oldestId !== null) fold.openCalls.delete(oldestId)
  }
}
