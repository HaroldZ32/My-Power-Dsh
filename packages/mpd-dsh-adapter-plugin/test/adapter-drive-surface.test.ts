// The DRIVE SURFACE of mpd-dsh-adapter (plan `.mpd/plans/mpd-drive-surface.md` §4.1, task A).
//
// The plan gives a non-model client three surfaces, and every one of them reaches the harness
// through THIS adapter, never through a harness service directly (AGENTS.md §6):
//
//   * `askUserQuestion` — the bundle's own question ask, so a relay can ask without importing a
//     harness type;
//   * `onUserQuestionRequest` — a WATERFALL answerer on `user-questions/request`, the seam the
//     question relay parks a request on;
//   * `dshGoPresent` / `dshGoPanel` / `dshGoRefresh` — the DSH Go native-panel bridge, which most
//     hosts do not carry at all.
//
// What is asserted here is the DEGRADE TABLE and the MAPPING, because those are the contract a
// consumer is written against: which answers are copied (and that an absent `custom` stays absent),
// which failures are loud throws with an exact message, which are `false` plus ONE log line, and
// which are silent no-ops. The doubles record what reached the harness, so a seam that forwards a
// rewritten request fails here instead of inside a peer plugin at boot.
//
// AND THE WATERFALL REPLY IS AN OBJECT, NOT AN ARRAY (independent review F1, 2026-11-02): cordis
// `waterfall()` returns the OUTERMOST listener's value, this row registers at boot, and the harness
// consumes `result.answers.map`. The arms below therefore assert IDENTITY — the downstream envelope
// reaches cordis as the SAME object — plus one arm that runs the harness's own projection over the
// listener's value, so the original defect would fail here at the module boundary.
import { describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  createDshAdapter,
  type DshQuestionAnswerEnvelope,
  type DshQuestionItem,
  type DshUserQuestionRequest,
} from "../src/index"

/** The harness event the waterfall answerer registers on. */
const REQUEST_EVENT = "user-questions/request"

/** The row-log base name the adapter's warning channel writes under. */
const ADAPTER_LOG = "mpd-dsh-adapter"

/** An event-bus double: records the registration, hands back a disposer. */
type EventBus = (event: string, listener: (...args: unknown[]) => unknown) => () => void

/** One registration the event-bus double captured. */
interface Registration {
  /** The event name the adapter registered on. */
  event: string
  /** The listener the adapter handed the bus. */
  listener: (...args: unknown[]) => unknown
}

/** The ctx a seam test needs: a service lookup plus the OPTIONAL event bus. */
interface FakeCtx {
  /** Answer the named service, or `undefined` when the composition does not carry it. */
  get(serviceName: string): unknown
  /** The harness event bus; absent on a composition without one. */
  on?: EventBus
}

/**
 * A ctx double over a per-service map.
 * @param services - what `get(name)` answers; a name absent from the map reads `undefined`.
 * @param on - the event bus to attach, or undefined for a composition that has none.
 * @returns the ctx the adapter is built over.
 */
function fakeCtx(services: Record<string, unknown>, on?: EventBus): FakeCtx {
  return {
    get: (serviceName: string): unknown => services[serviceName],
    ...(on === undefined ? {} : { on }),
  }
}

/**
 * An event-bus double that records every registration.
 * @returns the `on` member plus the registrations it captured, in registration order.
 */
function recordingBus(): { on: EventBus; registrations: Registration[] } {
  /** The registrations captured so far, in order. */
  const registrations: Registration[] = []
  return {
    on: (event: string, listener: (...args: unknown[]) => unknown): (() => void) => {
      registrations.push({ event, listener })
      return (): void => {
        /** Index of this registration, or -1 when it was already disposed. */
        const at = registrations.findIndex((entry) => entry.listener === listener)
        if (at >= 0) registrations.splice(at, 1)
      }
    },
    registrations,
  }
}

/**
 * The harness's OWN consumption of a waterfall reply, copied from `dsh-tool-ask-user`'s
 * `answerResult`: it reads `result.answers` and maps it. A listener that answered with a bare array
 * makes this throw `Cannot read properties of undefined (reading 'map')` — the F1 defect — so an arm
 * that runs this projection asserts the module boundary the real tool sits behind.
 * @param result - whatever the outermost waterfall listener returned.
 * @returns the model-facing answer payload the harness would build.
 */
function harnessAnswerProjection(result: unknown): { answers: Array<{ id: string; selected: string[]; custom?: string }> } {
  /** The reply's `answers` field, read exactly the way the harness reads it (no guard). */
  const answers = (result as { answers: Array<{ id: string; selected: string[]; custom?: string }> }).answers
  return {
    answers: answers.map((answer) => ({
      id: answer.id,
      selected: [...answer.selected],
      ...(answer.custom === undefined ? {} : { custom: answer.custom }),
    })),
  }
}

/**
 * Run `run` with the adapter's row log pinned to a fresh SANDBOX workspace and report what the
 * warning channel appended.
 *
 * `rowLogLine` resolves its root as `DSH_WORKSPACE_ROOT` → cwd (`workspaceRootOf`), so both env
 * keys are pinned to the sandbox: an ambient value would otherwise send the line somewhere this arm
 * cannot read, and the repo's own `.mpd/logs` is never touched. The sandbox is removed afterwards.
 * @param run - the call under test.
 * @returns the call's own result plus the non-empty lines appended while it ran.
 */
async function loggedLines<T>(run: () => Promise<T> | T): Promise<{ result: T; lines: string[] }> {
  /** The sandbox workspace this arm's row log is written under. */
  const sandbox = mkdtempSync(join(tmpdir(), "mpd-adapter-drive-"))
  /** The two env keys the sink's root chain reads, saved for the restore below. */
  const saved = { logDir: process.env.MPD_MCP_LOG_DIR, workspace: process.env.DSH_WORKSPACE_ROOT }
  process.env.MPD_MCP_LOG_DIR = sandbox
  process.env.DSH_WORKSPACE_ROOT = sandbox
  try {
    /** The call's own result, returned unchanged. */
    const result = await run()
    /** The appended lines, or none when the arm never reached the warning channel. */
    let lines: string[] = []
    try {
      lines = readFileSync(join(sandbox, ".mpd", "logs", `${ADAPTER_LOG}.log`), "utf8")
        .split("\n")
        .filter((line) => line !== "")
    } catch {
      lines = []
    }
    return { result, lines }
  } finally {
    if (saved.logDir === undefined) delete process.env.MPD_MCP_LOG_DIR
    else process.env.MPD_MCP_LOG_DIR = saved.logDir
    if (saved.workspace === undefined) delete process.env.DSH_WORKSPACE_ROOT
    else process.env.DSH_WORKSPACE_ROOT = saved.workspace
    rmSync(sandbox, { recursive: true, force: true })
  }
}

describe("askUserQuestion", () => {
  test("maps the harness batch and drops an absent custom", async () => {
    /** The questions the caller asks, forwarded by identity. */
    const questions: DshQuestionItem[] = [{ id: "q1", question: "Ship it?", options: [{ label: "yes" }] }]
    /** The caller's cancellation lifetime, forwarded unchanged. */
    const controller = new AbortController()
    /** The requests the service double received, in order. */
    const received: Array<{ questions: unknown; signal?: unknown }> = []
    /** The adapter over a harness whose question service answers two items. */
    const adapter = createDshAdapter(fakeCtx({
      userQuestions: {
        ask: async (request: { questions: unknown; signal?: unknown }) => {
          received.push(request)
          return {
            answers: [
              { id: "q1", selected: ["yes", "later"], custom: "typed by the human" },
              { id: "q2", selected: ["no"] },
            ],
          }
        },
      },
    }))

    /** The adapter's projection of that batch. */
    const answers = await adapter.askUserQuestion({ questions, signal: controller.signal })

    expect(answers).toEqual([
      { id: "q1", selected: ["yes", "later"], custom: "typed by the human" },
      { id: "q2", selected: ["no"] },
    ])
    // The ABSENT custom is the point of the second entry: `toEqual` would accept `custom: undefined`
    // on the received object only if the key were there, so the arm also states it explicitly.
    expect(Object.hasOwn(answers[1], "custom")).toBe(false)
    expect(received[0].questions).toBe(questions)
    expect(received[0].signal).toBe(controller.signal)
  })

  test("throws the exact message when the service is missing", async () => {
    /** An adapter over a composition with no question service at all. */
    const adapter = createDshAdapter(fakeCtx({}))
    await expect(adapter.askUserQuestion({ questions: [] }))
      .rejects.toThrow("ask_user_question failed: no user-questions service")

    /** An adapter over a half-present service: the name resolves but `ask` is not callable. */
    const halfPresent = createDshAdapter(fakeCtx({ userQuestions: {} }))
    await expect(halfPresent.askUserQuestion({ questions: [] }))
      .rejects.toThrow("ask_user_question failed: no user-questions service")
  })

  test("rethrows the harness rejection with its code preserved", async () => {
    /** The harness rejection, carrying the taxonomy code a relay branches on. */
    const rejection = Object.assign(new Error("no user-questions answerer is attached"), { code: "NO_PROVIDER" })
    /** The adapter over a service that rejects the way the harness does. */
    const adapter = createDshAdapter(fakeCtx({ userQuestions: { ask: async () => { throw rejection } } }))

    /** The error the adapter threw; captured rather than pattern-matched, because `code` is the subject. */
    let thrown: unknown
    try {
      await adapter.askUserQuestion({ questions: [] })
    } catch (error) {
      thrown = error
    }

    // The throw is the subject and its type is narrowed once here, which is why the cast is local.
    expect(thrown).toBeInstanceOf(Error)
    expect((thrown as Error).message).toBe("ask_user_question failed: no user-questions answerer is attached")
    expect((thrown as { code?: unknown }).code).toBe("NO_PROVIDER")
  })
})

describe("onUserQuestionRequest", () => {
  test("registers on the event, narrows the request and forwards the downstream envelope by IDENTITY", async () => {
    /** The event bus double that captures the registration. */
    const bus = recordingBus()
    /** The caller's cancellation lifetime, which the narrowed request must carry by identity. */
    const controller = new AbortController()
    /** What the handler observed; assigned by the answerer itself. */
    const observed: { request?: DshUserQuestionRequest; envelope?: DshQuestionAnswerEnvelope } = {}
    /** The adapter over a context that carries the harness event bus. */
    const adapter = createDshAdapter(fakeCtx({}, bus.on))

    /** The registration's disposer. */
    const dispose = adapter.onUserQuestionRequest(async (request, next) => {
      observed.request = request
      observed.envelope = await next()
      return observed.envelope
    }, "relay")
    expect(typeof dispose).toBe("function")
    expect(bus.registrations).toHaveLength(1)
    expect(bus.registrations[0].event).toBe(REQUEST_EVENT)

    /** The registration's listener, invoked the way cordis dispatches a waterfall. */
    const listener = bus.registrations[0].listener
    /** The harness's own (wider) request shape, carrying fields the adapter must NOT forward. */
    const harnessRequest = {
      questions: [{
        id: "q1",
        question: "Ship it?",
        detail: "extra context",
        header: "Decision",
        options: [{ label: "yes", description: "go ahead" }, { label: "no" }],
        multiSelect: true,
        intent: { kind: "plan-review", approve: "yes" },
      }],
      agent: { id: "session-7" },
      signal: controller.signal,
      wait: { callId: "call-1", timed: true },
    }
    /** The downstream answerer's reply, in the harness's OWN envelope shape. */
    const downstream: DshQuestionAnswerEnvelope = { answers: [{ id: "q1", selected: ["yes"], custom: "typed" }] }
    /** The continuation cordis hands the listener: the harness's own envelope-producing closure. */
    const next = async (): Promise<unknown> => downstream

    /** What the waterfall listener answered. */
    const answered = await listener(harnessRequest, next)

    // IDENTITY, NOT EQUALITY (review F1): a re-mapped array or a rebuilt wrapper would replace the
    // harness's own value at the outermost listener, which is the whole defect. `toBe` locks that.
    expect(answered).toBe(downstream)
    expect(observed.envelope).toBe(downstream)
    expect(answered).toEqual({ answers: [{ id: "q1", selected: ["yes"], custom: "typed" }] })
    expect(observed.request).toEqual({
      questions: [{
        id: "q1",
        question: "Ship it?",
        header: "Decision",
        options: [{ label: "yes", description: "go ahead" }, { label: "no" }],
        multiSelect: true,
      }],
      sessionId: "session-7",
      signal: controller.signal,
    })
    expect(bus.registrations).toHaveLength(1)
    dispose()
    expect(bus.registrations).toHaveLength(0)
  })

  test("a handler that CLAIMS the request hands its own envelope to cordis unchanged", async () => {
    /** The event bus double that captures the registration. */
    const bus = recordingBus()
    /** The envelope the handler builds itself, never derived from a downstream answerer. */
    const claimed: DshQuestionAnswerEnvelope = { answers: [{ id: "q1", selected: ["no"] }] }
    /** The adapter over a context that carries the harness event bus. */
    const adapter = createDshAdapter(fakeCtx({}, bus.on))
    adapter.onUserQuestionRequest(async () => claimed)

    /** A continuation that must not run: this handler claims the request instead of delegating. */
    const next = async (): Promise<unknown> => {
      throw new Error("the handler claimed the request, so next() must not be called")
    }
    /** What the listener returned to cordis. */
    const answered = await bus.registrations[0].listener({ questions: [] }, next)

    // The same OBJECT, so a consumer that mutates or reads the reply sees what the handler built.
    expect(answered).toBe(claimed)
  })

  test("the reply survives the harness's own consumption shape (the F1 regression, module boundary)", async () => {
    /** The event bus double that captures the registration. */
    const bus = recordingBus()
    /** The adapter over a context that carries the harness event bus. */
    const adapter = createDshAdapter(fakeCtx({}, bus.on))
    // A relay-shaped answerer: delegate, and return whatever the downstream answerer produced.
    adapter.onUserQuestionRequest(async (_request, next) => next(), "mpd-roles")
    /** The harness-shaped answer object the downstream answerer resolves. */
    const downstream = { answers: [{ id: "q1", selected: ["yes"], custom: "typed" }, { id: "q2", selected: ["a", "b"] }] }

    /** What the OUTERMOST listener — this row, registered at boot — returned to the waterfall. */
    const replied = await bus.registrations[0].listener({ questions: [] }, async () => downstream)
    /** The harness's own projection, captured so "does not throw" is asserted rather than implied. */
    let projected: { answers: Array<{ id: string; selected: string[]; custom?: string }> } | undefined
    expect(() => {
      projected = harnessAnswerProjection(replied)
    }).not.toThrow()
    expect(projected).toEqual(downstream)
  })

  test("leaves sessionId undefined when the request names no agent", async () => {
    /** The event bus double that captures the registration. */
    const bus = recordingBus()
    /** What the handler observed; assigned by the answerer itself. */
    const observed: { request?: DshUserQuestionRequest } = {}
    /** The adapter over a context that carries the harness event bus. */
    const adapter = createDshAdapter(fakeCtx({}, bus.on))
    adapter.onUserQuestionRequest(async (request) => {
      observed.request = request
      return { answers: [] }
    })

    await bus.registrations[0].listener({ questions: [] }, async () => ({ answers: [] }))

    expect(observed.request).toEqual({ questions: [] })
    expect(observed.request?.sessionId).toBeUndefined()
  })

  test("propagates a handler rejection unchanged", async () => {
    /** The event bus double that captures the registration. */
    const bus = recordingBus()
    /** The answerer's own failure; the harness must see THIS error, not a substitute. */
    const original = new Error("relay exploded")
    /** The adapter over a context that carries the harness event bus. */
    const adapter = createDshAdapter(fakeCtx({}, bus.on))
    adapter.onUserQuestionRequest(async () => { throw original })

    /** The rejection the listener produced; captured so identity is asserted, not just the message. */
    let caught: unknown
    try {
      await bus.registrations[0].listener({ questions: [] }, async () => ({ answers: [] }))
    } catch (error) {
      caught = error
    }

    expect(caught).toBe(original)
  })

  test("degrades to a no-op disposer with one log line when the bus is absent", async () => {
    /** The adapter over a composition with no event bus at all. */
    const adapter = createDshAdapter(fakeCtx({}))
    /** The registration's outcome: a disposer that must exist and must not throw. */
    const outcome = await loggedLines(() => adapter.onUserQuestionRequest(async () => ({ answers: [] }), "relay"))

    expect(typeof outcome.result).toBe("function")
    expect(() => outcome.result()).not.toThrow()
    expect(outcome.lines).toHaveLength(1)
    expect(outcome.lines[0]).toContain("onUserQuestionRequest(relay) degraded")
  })

  test("degrades the same way when the registration itself throws", async () => {
    /** An event bus that refuses every registration, the way a torn-down context does. */
    const throwingBus: EventBus = (): (() => void) => { throw new Error("bus tore down") }
    /** The adapter over that context. */
    const adapter = createDshAdapter(fakeCtx({}, throwingBus))
    /** The registration's outcome under a throwing bus. */
    const outcome = await loggedLines(() => adapter.onUserQuestionRequest(async () => ({ answers: [] })))

    expect(typeof outcome.result).toBe("function")
    expect(outcome.lines).toHaveLength(1)
    expect(outcome.lines[0]).toContain("onUserQuestionRequest(anonymous) degraded")
  })
})

describe("dshGoPresent", () => {
  test("reports the bridge's presence", () => {
    expect(createDshAdapter(fakeCtx({})).dshGoPresent()).toBe(false)
    expect(createDshAdapter(fakeCtx({ dshGo: { panel: (): void => {}, refresh: (): void => {} } })).dshGoPresent()).toBe(true)
  })
})

describe("dshGoPanel", () => {
  test("returns false with one log line when the bridge is absent", async () => {
    /** The adapter over a host that is not DSH Go. */
    const adapter = createDshAdapter(fakeCtx({}))
    /** The publication's outcome on an absent bridge. */
    const outcome = await loggedLines(() => adapter.dshGoPanel("mpd", { view: { type: "stack" } }))

    expect(outcome.result).toBe(false)
    expect(outcome.lines).toHaveLength(1)
    expect(outcome.lines[0]).toContain('dshGo degraded — panel "mpd"')
  })

  test("passes the spec through verbatim and returns true", async () => {
    /** The publications the bridge double received, in order. */
    const publications: Array<{ id: string; spec: unknown }> = []
    /** The adapter over a bridge that accepts every panel. */
    const adapter = createDshAdapter(fakeCtx({
      dshGo: { panel: (id: string, spec: unknown): void => { publications.push({ id, spec }) } },
    }))
    /** One panel spec, identified below so a rewritten copy fails the arm. */
    const spec = { view: { type: "stack" }, data: { team: null }, actions: { approve: { call: "approve" } } }
    /** The publication's outcome on a present bridge. */
    const outcome = await loggedLines(() => adapter.dshGoPanel("mpd", spec))

    expect(outcome.result).toBe(true)
    expect(outcome.lines).toHaveLength(0)
    expect(publications).toHaveLength(1)
    expect(publications[0].id).toBe("mpd")
    expect(publications[0].spec).toBe(spec)
  })

  test("returns false with one log line when the bridge throws", async () => {
    /** The adapter over a bridge whose publication fails. */
    const adapter = createDshAdapter(fakeCtx({
      dshGo: { panel: (): void => { throw new Error("bridge is closing") } },
    }))
    /** The publication's outcome on a throwing bridge. */
    const outcome = await loggedLines(() => adapter.dshGoPanel("mpd", { view: {} }))

    expect(outcome.result).toBe(false)
    expect(outcome.lines).toHaveLength(1)
    expect(outcome.lines[0]).toContain("the bridge threw: bridge is closing")
  })
})

describe("dshGoRefresh", () => {
  test("is a no-op when the bridge is absent", () => {
    /** The adapter over a host that is not DSH Go. */
    const adapter = createDshAdapter(fakeCtx({}))
    expect(() => adapter.dshGoRefresh("mpd")).not.toThrow()
  })

  test("forwards the panel id and swallows a bridge failure", () => {
    /** The panel ids the bridge double was asked to refresh, in order. */
    const refreshed: string[] = []
    /** The adapter over a bridge whose refresh works. */
    const adapter = createDshAdapter(fakeCtx({
      dshGo: { refresh: (id: string): void => { refreshed.push(id) } },
    }))
    adapter.dshGoRefresh("mpd")
    expect(refreshed).toEqual(["mpd"])

    /** The adapter over a bridge whose refresh fails. */
    const failing = createDshAdapter(fakeCtx({
      dshGo: { refresh: (): void => { throw new Error("gone") } },
    }))
    expect(() => failing.dshGoRefresh("mpd")).not.toThrow()
  })
})

describe("capabilities", () => {
  test("flips askUser and dshGo with their services", () => {
    /** The flags over a composition that carries neither service. */
    const absent = createDshAdapter(fakeCtx({})).capabilities()
    expect(absent.askUser).toBe(false)
    expect(absent.dshGo).toBe(false)

    /** The flags over a composition that carries both. */
    const present = createDshAdapter(fakeCtx({
      userQuestions: { ask: async (): Promise<unknown> => ({ answers: [] }) },
      dshGo: { panel: (): void => {}, refresh: (): void => {} },
    })).capabilities()
    expect(present.askUser).toBe(true)
    expect(present.dshGo).toBe(true)
  })

  test("exposes the five frozen methods with their declared arity", () => {
    /** The adapter over an empty composition; arity is all this arm reads. */
    const adapter = createDshAdapter(fakeCtx({}))
    // Arity is frozen because consumers are written against these signatures: a re-shaped method
    // must redden HERE instead of surfacing as an `undefined is not a function` in a peer plugin.
    expect(adapter.askUserQuestion.length).toBe(1)
    expect(adapter.onUserQuestionRequest.length).toBe(2)
    expect(adapter.dshGoPresent.length).toBe(0)
    expect(adapter.dshGoPanel.length).toBe(2)
    expect(adapter.dshGoRefresh.length).toBe(1)
  })
})
