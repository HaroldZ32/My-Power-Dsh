// THE CONTEXT-PRESSURE SEAM (cellwork wave 1, A1): live occupancy against the MODEL's own window.
//
// WHAT THIS FILE PROVES. The token meter's `contextPressure` projection is the only honest source of
// a checkpoint trigger, so the seam must (a) prefer the projection's forward-looking figure, (b) read
// the window the model reported and NEVER substitute a constant, (c) degrade to a provenance instead
// of throwing, and (d) accept an Agent, a Session or a session id.
import { describe, expect, test } from "bun:test"

import { createDshAdapter } from "../src/index"

/** The host-side `contextPressure` state fields this read consumes. */
interface PressureState {
  /** The window the model reported at runtime; absent before the first `request/context` event. */
  contextWindow?: number
  /** Provider-reported prompt size of the most recent request. */
  pressureTokens?: number
}

/** The client-visible view the registry's `snapshot` produces for the same unit. */
interface PressureView {
  /** Provider-reported prompt size carried into the view. */
  pressureTokens?: number
  /** The projection's forward-looking figure, which the host state does NOT carry. */
  projectedTokens?: number
  /** The window copied from the state. */
  contextWindow?: number
}

/** What one arm's fake harness answers. */
interface HarnessOptions {
  /** Whether a `sessionProjections` service is mounted at all (default true). */
  projections?: boolean
  /** The state `stateOf` answers; `undefined` models "no cell for this session". */
  state?: PressureState | undefined
  /** Whether `stateOf` throws instead of answering. */
  stateThrows?: boolean
  /** The view `snapshot` answers; omitted models a registry that produced none. */
  view?: PressureView | undefined
  /** Whether `snapshot` throws instead of answering. */
  snapshotThrows?: boolean
  /** The `sessions.get` answer per id, when the arm mounts a session store. */
  sessionById?: Map<string, unknown>
  /** The live-agent registry doubles, for the session-id fallback arm. */
  agents?: Array<{ id: string; session: unknown }>
}

/** One fake harness: only the services a context-pressure read may touch. */
interface Harness {
  /** The ctx the real adapter resolves services through. */
  ctx: { get: (name: string) => unknown }
  /** Every session `stateOf` was asked about, in order, so identity is asserted not assumed. */
  reads: unknown[]
}

/**
 * Build the fake harness the arms drive.
 * @param options - which services exist and what they answer.
 * @returns the ctx plus the recorded projection reads.
 */
function harness(options: HarnessOptions = {}): Harness {
  /** Every session object the projection registry was asked about. */
  const reads: unknown[] = []
  /** The projection registry double, with the two reads the seam uses. */
  const projections = {
    /**
     * Answer the host state for one session.
     * @param session - the session object the seam resolved.
     * @param key - the projection unit key.
     * @returns the configured state.
     */
    stateOf(session: unknown, key: string): unknown {
      reads.push(session)
      expect(key).toBe("contextPressure")
      if (options.stateThrows === true) throw new Error("projection plane unavailable")
      return options.state
    },
    /**
     * Answer the client-visible snapshot for one session.
     * @param _session - the session object the seam resolved; unused by this double.
     * @param keys - the units the caller asked for.
     * @returns the snapshot shape the harness produces.
     */
    snapshot(_session: unknown, keys: readonly string[]): unknown {
      expect(keys).toEqual(["contextPressure"])
      if (options.snapshotThrows === true) throw new Error("snapshot unavailable")
      return options.view === undefined ? { asOfSeq: 1, values: {} } : { asOfSeq: 1, values: { contextPressure: options.view } }
    },
  }
  /** The sessions store double, present only when the arm configured one. */
  const sessions = options.sessionById === undefined
    ? undefined
    : {
      /**
       * Resolve one id the way the host store does.
       * @param id - the session id to resolve.
       * @returns the configured session, or undefined.
       */
      get: (id: string): unknown => options.sessionById?.get(id),
    }
  /** The live-agent registry double, present only when the arm configured one. */
  const agents = options.agents === undefined
    ? undefined
    : {
      /**
       * List the live agents this arm configured.
       * @returns the configured agents.
       */
      list: (): unknown[] => options.agents ?? [],
      /**
       * Resolve one live agent id.
       * @param id - the live agent id.
       * @returns the configured agent, or undefined.
       */
      get: (id: string): unknown => (options.agents ?? []).find((agent) => agent.id === id),
    }
  /** The ctx the real adapter resolves every service through. */
  const ctx = {
    /**
     * Answer one harness service by id.
     * @param name - the service id.
     * @returns the configured double, or undefined.
     */
    get: (name: string): unknown => {
      if (name === "sessionProjections") return options.projections === false ? undefined : projections
      if (name === "sessions") return sessions
      if (name === "agents") return agents
      return undefined
    },
  }
  return { ctx, reads }
}

describe("the observed occupancy and the model's own window", () => {
  test("observed prefers projectedTokens over pressureTokens and divides by the REPORTED window", () => {
    /** The Session object the read must be keyed on. */
    const session = { id: "session-1" }
    /** A harness whose projection carries both figures and a non-round observed window. */
    const h = harness({
      state: { contextWindow: 123456, pressureTokens: 40000 },
      view: { contextWindow: 123456, pressureTokens: 40000, projectedTokens: 30864 },
    })
    /** The occupancy read through the public seam. */
    const pressure = createDshAdapter(h.ctx).contextPressure(session)
    expect(pressure).toEqual({ usedTokens: 30864, windowTokens: 123456, ratio: 0.25, provenance: "observed" })
    // The registry was handed the SAME session object, never a reconstructed or guessed one.
    expect(h.reads[0]).toBe(session)
  })

  test("the provider-reported pressure is the fallback when the view carries no projection", () => {
    /** A session the arm reads through. */
    const session = { id: "session-2" }
    /** A harness whose view exposes only the provider sample. */
    const h = harness({ state: { contextWindow: 100000, pressureTokens: 5000 }, view: { pressureTokens: 5000 } })
    /** The occupancy read through the public seam. */
    const pressure = createDshAdapter(h.ctx).contextPressure(session)
    expect(pressure).toEqual({ usedTokens: 5000, windowTokens: 100000, ratio: 0.05, provenance: "observed" })
  })

  test("a projection with no reported window is no-window, with NO guessed constant", () => {
    /** A harness whose meter has seen usage but no `request/context` window yet. */
    const h = harness({ state: { pressureTokens: 1234 }, view: { pressureTokens: 1234 } })
    /** The occupancy read through the public seam. */
    const pressure = createDshAdapter(h.ctx).contextPressure({ id: "session-3" })
    expect(pressure).toEqual({ usedTokens: 1234, windowTokens: null, ratio: null, provenance: "no-window" })
    // The two constants a fallback would plausibly invent; neither may appear.
    expect(pressure.windowTokens).not.toBe(262144)
    expect(pressure.windowTokens).not.toBe(1_000_000)
  })

  test("a zero projection is an observation, so the ratio refuses to divide by a zero side", () => {
    /** A harness whose projection reports exactly zero occupied tokens. */
    const h = harness({ state: { contextWindow: 1000 }, view: { projectedTokens: 0 } })
    /** The occupancy read through the public seam. */
    const pressure = createDshAdapter(h.ctx).contextPressure({ id: "session-4" })
    expect(pressure.usedTokens).toBe(0)
    expect(pressure.windowTokens).toBe(1000)
    expect(pressure.ratio).toBeNull()
    expect(pressure.provenance).toBe("observed")
  })
})

describe("degradation is a provenance, never a throw", () => {
  test("no projection service at all is unavailable", () => {
    /** A composition with no session-projection plane. */
    const h = harness({ projections: false })
    /** The occupancy read through the public seam. */
    const pressure = createDshAdapter(h.ctx).contextPressure({ id: "session-5" })
    expect(pressure).toEqual({ usedTokens: null, windowTokens: null, ratio: null, provenance: "unavailable" })
  })

  test("a registry with no materialized state for this session is unavailable", () => {
    /** A harness whose registry has no cell for the session. */
    const h = harness({ state: undefined })
    /** The occupancy read through the public seam. */
    const pressure = createDshAdapter(h.ctx).contextPressure({ id: "session-6" })
    expect(pressure.provenance).toBe("unavailable")
    expect(pressure.windowTokens).toBeNull()
  })

  test("a throwing state read degrades instead of propagating", () => {
    /** A harness whose projection read throws. */
    const h = harness({ stateThrows: true })
    /** The occupancy read through the public seam. */
    const pressure = createDshAdapter(h.ctx).contextPressure({ id: "session-7" })
    expect(pressure.provenance).toBe("unavailable")
  })

  test("a throwing SNAPSHOT still answers from the state", () => {
    /** A harness whose client view is unreadable but whose host state is intact. */
    const h = harness({ state: { contextWindow: 1000, pressureTokens: 250 }, snapshotThrows: true })
    /** The occupancy read through the public seam. */
    const pressure = createDshAdapter(h.ctx).contextPressure({ id: "session-8" })
    expect(pressure).toEqual({ usedTokens: 250, windowTokens: 1000, ratio: 0.25, provenance: "observed" })
  })
})

describe("what a caller may hand the seam", () => {
  test("a live Agent is unwrapped to the session its projection is keyed on", () => {
    /** The session the agent carries. */
    const session = { id: "agent-session" }
    /** A harness that reports the window for any session. */
    const h = harness({ state: { contextWindow: 1000, pressureTokens: 100 }, view: {} })
    /** The occupancy read for the live Agent. */
    const pressure = createDshAdapter(h.ctx).contextPressure({ session })
    expect(pressure.provenance).toBe("observed")
    expect(h.reads[0]).toBe(session)
  })

  test("a session id resolves through the `sessions` store", () => {
    /** The session the store holds for the id. */
    const session = { id: "sess-42" }
    /** A harness with a session store that knows the id. */
    const h = harness({
      state: { contextWindow: 1000, pressureTokens: 100 },
      view: {},
      sessionById: new Map([["sess-42", session]]),
    })
    /** The occupancy read by id. */
    const pressure = createDshAdapter(h.ctx).contextPressure("sess-42")
    expect(pressure.provenance).toBe("observed")
    expect(h.reads[0]).toBe(session)
  })

  test("a session id falls back to the live-agent registry when no store answers", () => {
    /** The session the live agent carries. */
    const session = { id: "agent-7" }
    /** A harness whose only route to the session is the live registry. */
    const h = harness({ state: { contextWindow: 1000, pressureTokens: 100 }, view: {}, agents: [{ id: "agent-7", session }] })
    /** The occupancy read by id. */
    const pressure = createDshAdapter(h.ctx).contextPressure("agent-7")
    expect(pressure.provenance).toBe("observed")
    expect(h.reads[0]).toBe(session)
  })

  test("a target that names no session is unavailable and reads nothing", () => {
    /** A harness that would answer if it were asked. */
    const h = harness({ state: { contextWindow: 1000, pressureTokens: 100 }, view: {} })
    /** The adapter under test. */
    const adapter = createDshAdapter(h.ctx)
    for (const target of [undefined, null, "", "   ", 42]) {
      expect(adapter.contextPressure(target).provenance).toBe("unavailable")
    }
    // Nothing reached the registry: no session object was invented for a nameless caller.
    expect(h.reads).toHaveLength(0)
  })
})
