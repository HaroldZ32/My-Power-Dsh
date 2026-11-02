// THE QUESTION RELAY'S ARMS: the in-memory parking lot, the attach gate, the label validation and
// the row's INERT path when the adapter exposes no waterfall seam.
//
// WHAT THESE LOCK OUT, each one a contract point of plan §4.3:
//   * `next()` is awaited FIRST, so a real answerer keeps priority and only a `NO_PROVIDER` rejection
//     is ever parked — any other rejection propagates BY IDENTITY;
//   * the REPLY is the harness envelope `{ answers: [...] }`, never a bare array (independent review
//     F1): a downstream envelope comes back as the SAME object, a settled question wraps its parked
//     array, and every failure path (ttl, eviction, abort, dispose) still rejects with the ORIGINAL
//     error rather than an envelope;
//   * with no recent `list()` the ORIGINAL error is rethrown IMMEDIATELY (an unattended engine must
//     not hang a turn), which is asserted with a real timeout, not by inspection;
//   * `answer` is LABEL-only: an unknown label returns false, leaves the question parked, and a later
//     correct batch still settles it;
//   * expiry, capacity eviction and dispose all reject each waiter with ITS OWN original error;
//   * the row without the seam provides NO service and reports `questions=absent reason=no-seam` on
//     its single team-plane boot line (driven through the REAL `apply`, not the installer alone).
import { describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { DshQuestionAnswer, DshQuestionAnswerEnvelope, DshQuestionItem, DshUserQuestionRequest } from "../../mpd-dsh-adapter-plugin/src/index"
import { apply } from "../src/index.ts"
import { DEFAULT_ATTACH_WINDOW_MS, DEFAULT_QUESTION_CAPACITY, DEFAULT_QUESTION_TTL_MS, createQuestionRelay, installQuestionRelay } from "../src/question-relay.ts"

/** One well-formed question set: two items, both offering labels, the second multi-select. */
const QUESTIONS: DshQuestionItem[] = [
  { id: "scope", question: "Which scope should the wave cover?", options: [{ label: "Guard only" }, { label: "Guard and prompt" }] },
  { id: "notes", question: "Anything else?", options: [{ label: "verbose" }, { label: "terse" }], multiSelect: true },
]

/** A DIFFERENT request's questions, so an answer id from it can be proven unknown to {@link QUESTIONS}. */
const OTHER_QUESTIONS: DshQuestionItem[] = [
  { id: "deploy", question: "Which environment?", options: [{ label: "staging" }, { label: "prod" }] },
]

/**
 * One COMPLETE batch for {@link QUESTIONS}: exactly one entry per parked question item.
 *
 * Coverage is the amended contract (plan §4.3): a batch that answers only SOME of the parked
 * request is refused, so every arm that expects a settlement must send all of the items.
 */
function completeAnswers(): DshQuestionAnswer[] {
  return [
    { id: "scope", selected: ["Guard only"] },
    { id: "notes", selected: ["terse"] },
  ]
}

/**
 * The harness's own `NO_PROVIDER` rejection: an `Error` carrying the taxonomy code.
 *
 * The relay reads `code` first, so this is the shape the adapter produces for a waterfall with no
 * answerer — the case that may park.
 */
function noProviderError(message: string = "no user-questions answerer is available"): Error {
  return Object.assign(new Error(message), { code: "NO_PROVIDER" })
}

/** A rejection the relay must NEVER park: a plain failure with no code and no NO_PROVIDER wording. */
function otherError(): Error {
  return new Error("the answerer crashed while rendering the question")
}

/** Wait one macrotask, so a `handle` call's own microtasks have run before the arm inspects the lot. */
async function tick(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0)
  })
}

/**
 * Await a promise that MUST reject, failing the arm instead of hanging when it never settles.
 *
 * @param promise - the promise under test.
 * @param ms - the deadline in milliseconds.
 * @returns the rejection value.
 */
async function rejectionWithin(promise: Promise<unknown>, ms: number = 500): Promise<unknown> {
  /** A unique marker, so a timeout is distinguishable from any rejection value. */
  const marker = Symbol("still-pending")
  /** The rejection value, or the marker when the deadline won the race. */
  const outcome = await Promise.race([
    promise.then((): string => "resolved", (error: unknown): unknown => error),
    new Promise<symbol>((resolve) => {
      setTimeout(() => resolve(marker), ms)
    }),
  ])
  expect(outcome).not.toBe(marker)
  return outcome
}

/** The adapter double one install arm needs: a capability probe plus the waterfall registration. */
interface SeamDouble {
  /** The capability snapshot; `events` is what the installer gates on. */
  capabilities: () => { events: boolean }
  /** The registered waterfall answerer, captured so an arm can call the REAL registration. */
  handler?: (request: DshUserQuestionRequest, next: () => Promise<DshQuestionAnswerEnvelope>) => Promise<DshQuestionAnswerEnvelope>
  /** How many times the returned disposer ran. */
  released: { count: number }
  /** The seam itself; an arm replaces it with a thrower for the degrade arm. */
  onUserQuestionRequest?: (handler: (request: DshUserQuestionRequest, next: () => Promise<DshQuestionAnswerEnvelope>) => Promise<DshQuestionAnswerEnvelope>, label?: string) => () => void
}

/**
 * Build the adapter double the installer reads.
 *
 * @param parts - which seam shape this arm needs: present, absent or throwing, and whether the bus exists.
 * @returns the double, with the captured handler and the release counter.
 */
function seamDouble(parts: { seam: "present" | "absent" | "throw"; events?: boolean }): SeamDouble {
  /** The release counter the double's disposer increments. */
  const released = { count: 0 }
  /** The double; `onUserQuestionRequest` is removed for the absent arm. */
  const double: SeamDouble = {
    capabilities: () => ({ events: parts.events !== false }),
    released,
  }
  if (parts.seam === "throw") {
    double.onUserQuestionRequest = () => {
      throw new Error("the harness event bus refused the registration")
    }
  } else if (parts.seam === "present") {
    double.onUserQuestionRequest = (handler) => {
      double.handler = handler
      return () => {
        released.count += 1
      }
    }
  }
  return double
}

/**
 * Cast an install double to the installer's adapter slice.
 *
 * The fixture implements exactly the two members the installer READS; the cast is the fixture's
 * contract (the same shape the watchdog's route test uses for its adapter double).
 *
 * @param double - the double built by {@link seamDouble}.
 * @returns the double, typed as the installer's parameter.
 */
function asInstallAdapter(double: SeamDouble): Parameters<typeof installQuestionRelay>[0] {
  return double as unknown as Parameters<typeof installQuestionRelay>[0]
}

describe("handle: await next() first, park only on NO_PROVIDER", () => {
  test("a resolving next() is returned BY IDENTITY and nothing is parked", async () => {
    /** The envelope the downstream answerer produced, in the harness's own shape. */
    const downstream: DshQuestionAnswerEnvelope = { answers: [{ id: "scope", selected: ["Guard only"] }] }
    /** The relay under test; its attach gate is irrelevant on this path. */
    const relay = createQuestionRelay()
    // SAME OBJECT (review F1): rebuilding the envelope would be the same class of defect as answering
    // with a bare array, because the harness's own value would no longer be what cordis returns.
    expect(await relay.handle({ questions: QUESTIONS }, () => Promise.resolve(downstream))).toBe(downstream)
    expect(relay.list()).toEqual([])
  })

  test("a non-NO_PROVIDER rejection propagates by IDENTITY and parks nothing", async () => {
    /** The unrelated failure the downstream answerer produced. */
    const original = otherError()
    /** The relay, with the attach gate deliberately OPEN so a park would be possible. */
    const relay = createQuestionRelay()
    relay.list()
    /** The rejection the caller observed. */
    const observed = await rejectionWithin(relay.handle({ questions: QUESTIONS }, () => Promise.reject(original)))
    // SAME OBJECT, not a re-wrapped message: the harness must see the answerer's own failure.
    expect(observed).toBe(original)
    expect(relay.list()).toEqual([])
  })

  test("NO_PROVIDER parks and a settled question resolves to the harness ENVELOPE", async () => {
    /** The harness rejection the relay may park on. */
    const original = noProviderError()
    /** The relay under test. */
    const relay = createQuestionRelay()
    relay.list()
    /** The harness's pending question, settled by the answer below. */
    const pending = relay.handle({ questions: QUESTIONS, sessionId: "s1" }, () => Promise.reject(original))
    await tick()
    /** The parked rows, which is where the client learns the id. */
    const rows = relay.list()
    expect(rows.length).toBe(1)
    expect(rows[0].sessionId).toBe("s1")
    expect(rows[0].questions.map((item) => item.id)).toEqual(["scope", "notes"])
    /** The batch a client sends: labels only, and one entry per parked question item. */
    const answers: DshQuestionAnswer[] = [
      { id: "scope", selected: ["Guard and prompt"] },
      { id: "notes", selected: [] },
    ]
    expect(relay.answer({ id: rows[0].id, answers })).toBe(true)
    // The PARKING LOT stays a bare array (plan §4.3); only the REPLY is wrapped, because the harness
    // consumes `result.answers`. An array here would replace the envelope and crash the ask tool.
    expect(await pending).toEqual({ answers })
    expect(relay.list()).toEqual([])
  })

  test("a NO_PROVIDER-shaped MESSAGE without a code also parks (the documented fallback)", async () => {
    /** A plain Error carrying only the harness's wording, as an older waterfall would reject. */
    const original = new Error("no user-questions answerer is configured for this composition")
    /** The relay under test, attach gate open. */
    const relay = createQuestionRelay()
    relay.list()
    /** The pending question parked by the message fallback. */
    const pending = relay.handle({ questions: QUESTIONS }, () => Promise.reject(original))
    await tick()
    expect(relay.list().length).toBe(1)
    relay.dispose()
    expect(await rejectionWithin(pending)).toBe(original)
  })
})

describe("the attach gate: no listener, no park", () => {
  test("with no recent list() the ORIGINAL error is rethrown at once", async () => {
    /** The harness rejection that would otherwise park. */
    const original = noProviderError()
    /** A relay nobody polled: the gate is closed. */
    const relay = createQuestionRelay()
    /** The wall clock around the call, so "immediately" is MEASURED rather than assumed. */
    const started = Date.now()
    /** The rejection the caller observed. */
    const observed = await rejectionWithin(relay.handle({ questions: QUESTIONS }, () => Promise.reject(original)), 300)
    expect(observed).toBe(original)
    expect(Date.now() - started).toBeLessThan(300)
    expect(relay.list()).toEqual([])
  })

  test("a poll older than attachWindowMs closes the gate again", async () => {
    /** A controllable clock, so the window is asserted without waiting. */
    let clock = 1_000
    /** The relay with a 500 ms attach window over that clock. */
    const relay = createQuestionRelay({ now: () => clock, attachWindowMs: 500 })
    relay.list()
    clock += 501
    /** The harness rejection that must now be rethrown. */
    const original = noProviderError()
    expect(await rejectionWithin(relay.handle({ questions: QUESTIONS }, () => Promise.reject(original)), 300)).toBe(original)
    expect(relay.list()).toEqual([])
  })

  test("an empty question set is rethrown at once, even with the gate open", async () => {
    /** The harness rejection a request with no questions produced. */
    const original = noProviderError()
    /** A relay whose attach gate is OPEN, so only the empty set can explain the failure. */
    const relay = createQuestionRelay()
    relay.list()
    expect(await rejectionWithin(relay.handle({ questions: [] }, () => Promise.reject(original)), 300)).toBe(original)
    expect(relay.list()).toEqual([])
  })

  test("a poll INSIDE the window keeps parking available", async () => {
    /** A controllable clock. */
    let clock = 1_000
    /** The relay with a 500 ms attach window. */
    const relay = createQuestionRelay({ now: () => clock, attachWindowMs: 500 })
    relay.list()
    clock += 500
    /** The parked question, which proves the boundary value still counts as attached. */
    const pending = relay.handle({ questions: QUESTIONS }, () => Promise.reject(noProviderError()))
    await tick()
    expect(relay.list().length).toBe(1)
    relay.dispose()
    await rejectionWithin(pending)
  })
})

describe("list: order and session filter", () => {
  test("newest last, and a session filter narrows without dropping the others", async () => {
    /** The relay under test. */
    const relay = createQuestionRelay()
    relay.list()
    /** The first parked question, belonging to session a. */
    const first = relay.handle({ questions: QUESTIONS, sessionId: "a" }, () => Promise.reject(noProviderError()))
    await tick()
    relay.list()
    /** The second parked question, belonging to session b. */
    const second = relay.handle({ questions: QUESTIONS, sessionId: "b" }, () => Promise.reject(noProviderError()))
    await tick()
    // Oldest first, i.e. newest LAST: a client renders the list in reading order.
    expect(relay.list().map((row) => row.sessionId)).toEqual(["a", "b"])
    expect(relay.list("b").map((row) => row.sessionId)).toEqual(["b"])
    expect(relay.list("missing")).toEqual([])
    relay.dispose()
    await rejectionWithin(first)
    await rejectionWithin(second)
  })

  test("a listed row is a COPY: mutating it cannot corrupt the parked labels", async () => {
    /** The relay under test. */
    const relay = createQuestionRelay()
    relay.list()
    /** The parked question. */
    const pending = relay.handle({ questions: QUESTIONS }, () => Promise.reject(noProviderError()))
    await tick()
    /** The row a client receives. */
    const row = relay.list()[0]
    if (row.questions[0].options !== undefined && row.questions[0].options[0] !== undefined) row.questions[0].options[0].label = "Tampered"
    // The parked labels are untouched, so the original label is still accepted.
    expect(relay.answer({ id: row.id, answers: completeAnswers() })).toBe(true)
    await pending
  })
})

describe("answer: labels only, a refusal never settles", () => {
  test("an unknown id is false and changes nothing", async () => {
    /** The relay under test. */
    const relay = createQuestionRelay()
    relay.list()
    /** The parked question. */
    const pending = relay.handle({ questions: QUESTIONS }, () => Promise.reject(noProviderError()))
    await tick()
    expect(relay.answer({ id: "q-unknown", answers: completeAnswers() })).toBe(false)
    expect(relay.list().length).toBe(1)
    relay.dispose()
    await rejectionWithin(pending)
  })

  test("an unknown LABEL is false, does not settle, and the entry survives for a correct retry", async () => {
    /** The relay under test. */
    const relay = createQuestionRelay()
    relay.list()
    /** The parked question. */
    const pending = relay.handle({ questions: QUESTIONS }, () => Promise.reject(noProviderError()))
    await tick()
    /** The parked row the retry answers. */
    const row = relay.list()[0]
    // An index, a label of another question and an invented label are all refusals; every batch
    // below still COVERS the request, so the label is the only rule each attempt breaks.
    expect(relay.answer({ id: row.id, answers: [{ id: "scope", selected: ["0"] }, { id: "notes", selected: [] }] })).toBe(false)
    expect(relay.answer({ id: row.id, answers: [{ id: "scope", selected: ["verbose"] }, { id: "notes", selected: [] }] })).toBe(false)
    expect(relay.answer({ id: row.id, answers: [{ id: "scope", selected: ["Anything"] }, { id: "notes", selected: [] }] })).toBe(false)
    // The entry SURVIVED every refused attempt...
    expect(relay.list().map((entry) => entry.id)).toEqual([row.id])
    /** The correct batch a client sends on the retry: complete coverage. */
    const answers = completeAnswers()
    expect(relay.answer({ id: row.id, answers })).toBe(true)
    // The settled REPLY is the harness envelope (review F1), wrapping the validated labels.
    expect(await pending).toEqual({ answers })
  })

  test("an answer for a question the parked request never carried is refused", async () => {
    /** The relay under test. */
    const relay = createQuestionRelay()
    relay.list()
    /** The parked question. */
    const pending = relay.handle({ questions: QUESTIONS }, () => Promise.reject(noProviderError()))
    await tick()
    /** The parked row. */
    const row = relay.list()[0]
    // Coverage is COMPLETE, so the ghost id is the only rule this batch breaks.
    expect(relay.answer({ id: row.id, answers: [...completeAnswers(), { id: "ghost", selected: [] }] })).toBe(false)
    // A free-text answer is only meaningful for a free-text question; both arms are still parked.
    expect(relay.list().length).toBe(1)
    relay.dispose()
    await rejectionWithin(pending)
  })

  test("an empty batch is refused: nothing answered is not an answer", async () => {
    /** The relay under test. */
    const relay = createQuestionRelay()
    relay.list()
    /** The parked question. */
    const pending = relay.handle({ questions: QUESTIONS }, () => Promise.reject(noProviderError()))
    await tick()
    /** The parked row. */
    const row = relay.list()[0]
    expect(relay.answer({ id: row.id, answers: [] })).toBe(false)
    expect(relay.list().length).toBe(1)
    relay.dispose()
    await rejectionWithin(pending)
  })
})

// ── R2a: a batch must COVER the parked request ──────────────────────────────────────────────────
// The CodeRabbit review of PR #88 found that a batch answering only SOME of a parked request's
// questions settled the model's tool call with the rest unanswered, and that a single-select
// question accepted several labels. These arms pin the amended contract (plan §4.3): exactly one
// answer per parked question item, no duplicates, no ids from another request, and at most one label
// on a question that is not `multiSelect`. A refusal leaves the request PARKED so a client retries.
describe("answer: the batch must cover the parked request", () => {
  test("one answer for a two-item request is refused, the request stays parked, a complete batch settles it", async () => {
    /** The relay under test. */
    const relay = createQuestionRelay()
    relay.list()
    /** The two-item question set parked below. */
    const pending = relay.handle({ questions: QUESTIONS }, () => Promise.reject(noProviderError()))
    await tick()
    /** The parked row a client answers. */
    const row = relay.list()[0]
    /** A PARTIAL batch: only the first of the two parked questions is answered. */
    const partial: DshQuestionAnswer[] = [{ id: "scope", selected: ["Guard only"] }]
    expect(relay.answer({ id: row.id, answers: partial })).toBe(false)
    // THE REQUEST IS STILL PARKED: a partial batch never settles the model's tool call.
    expect(relay.list().map((entry) => entry.id)).toEqual([row.id])
    /** The complete batch the client retries with. */
    const answers = completeAnswers()
    expect(relay.answer({ id: row.id, answers })).toBe(true)
    expect(await pending).toEqual({ answers })
    expect(relay.list()).toEqual([])
  })

  test("a DUPLICATE answer id is refused and leaves the request parked", async () => {
    /** The relay under test. */
    const relay = createQuestionRelay()
    relay.list()
    /** The parked question. */
    const pending = relay.handle({ questions: QUESTIONS }, () => Promise.reject(noProviderError()))
    await tick()
    /** The parked row. */
    const row = relay.list()[0]
    // Both items are answered; the FIRST one twice. Coverage alone would pass, so the duplicate is
    // the only rule this batch breaks.
    const answers: DshQuestionAnswer[] = [
      { id: "scope", selected: ["Guard only"] },
      { id: "notes", selected: [] },
      { id: "scope", selected: ["Guard and prompt"] },
    ]
    expect(relay.answer({ id: row.id, answers })).toBe(false)
    expect(relay.list().map((entry) => entry.id)).toEqual([row.id])
    relay.dispose()
    await rejectionWithin(pending)
  })

  test("an UNKNOWN answer id is refused and leaves the request parked", async () => {
    /** The relay under test. */
    const relay = createQuestionRelay()
    relay.list()
    /** The parked question. */
    const pending = relay.handle({ questions: QUESTIONS }, () => Promise.reject(noProviderError()))
    await tick()
    /** The parked row. */
    const row = relay.list()[0]
    // Complete coverage plus one id this request never carried: the unknown id is the only refusal.
    const answers: DshQuestionAnswer[] = [...completeAnswers(), { id: "ghost", selected: [] }]
    expect(relay.answer({ id: row.id, answers })).toBe(false)
    expect(relay.list().map((entry) => entry.id)).toEqual([row.id])
    relay.dispose()
    await rejectionWithin(pending)
  })

  test("an answer id that belongs to ANOTHER parked request is refused here", async () => {
    /** The relay under test. */
    const relay = createQuestionRelay()
    relay.list()
    /** The first parked request. */
    const first = relay.handle({ questions: QUESTIONS, sessionId: "a" }, () => Promise.reject(noProviderError()))
    await tick()
    relay.list()
    /** The second parked request, whose question ids are DIFFERENT. */
    const second = relay.handle({ questions: OTHER_QUESTIONS, sessionId: "b" }, () => Promise.reject(noProviderError()))
    await tick()
    /** The parked rows, oldest first. */
    const rows = relay.list()
    expect(rows.length).toBe(2)
    // The first request's batch names the SECOND request's question id. Coverage of the first request
    // is otherwise complete, so "deploy" is the only id this request does not carry.
    const crossRequest: DshQuestionAnswer[] = [...completeAnswers(), { id: "deploy", selected: ["staging"] }]
    expect(relay.answer({ id: rows[0].id, answers: crossRequest })).toBe(false)
    // BOTH requests stay parked: a refused batch must not disturb another request's question either.
    expect(relay.list().map((entry) => entry.id)).toEqual([rows[0].id, rows[1].id])
    relay.dispose()
    await rejectionWithin(first)
    await rejectionWithin(second)
  })

  test("a question WITHOUT multiSelect accepts at most one label", async () => {
    /** The relay under test. */
    const relay = createQuestionRelay()
    relay.list()
    /** The parked question. */
    const pending = relay.handle({ questions: QUESTIONS }, () => Promise.reject(noProviderError()))
    await tick()
    /** The parked row. */
    const row = relay.list()[0]
    // `scope` is single-select, so two labels are two answers to a question that takes one.
    const answers: DshQuestionAnswer[] = [
      { id: "scope", selected: ["Guard only", "Guard and prompt"] },
      { id: "notes", selected: [] },
    ]
    expect(relay.answer({ id: row.id, answers })).toBe(false)
    expect(relay.list().map((entry) => entry.id)).toEqual([row.id])
    relay.dispose()
    await rejectionWithin(pending)
  })

  test("a multiSelect question accepts two labels (the single-label rule is not over-applied)", async () => {
    /** The relay under test. */
    const relay = createQuestionRelay()
    relay.list()
    /** The parked question. */
    const pending = relay.handle({ questions: QUESTIONS }, () => Promise.reject(noProviderError()))
    await tick()
    /** The parked row. */
    const row = relay.list()[0]
    /** The complete batch, with two labels on the multi-select item. */
    const answers: DshQuestionAnswer[] = [
      { id: "scope", selected: ["Guard only"] },
      { id: "notes", selected: ["verbose", "terse"] },
    ]
    expect(relay.answer({ id: row.id, answers })).toBe(true)
    expect(await pending).toEqual({ answers })
  })

  test("an empty selected plus custom is a legitimate skipped/free-text answer", async () => {
    /** The relay under test. */
    const relay = createQuestionRelay()
    relay.list()
    /** A free-text question: no options, so no label is ever offered. */
    const freeText: DshQuestionItem[] = [{ id: "note", question: "Anything else?" }]
    /** The parked question. */
    const pending = relay.handle({ questions: freeText }, () => Promise.reject(noProviderError()))
    await tick()
    /** The parked row. */
    const row = relay.list()[0]
    /** A skipped answer: nothing selected, the human typed their own text. */
    const answers: DshQuestionAnswer[] = [{ id: "note", selected: [], custom: "ship it" }]
    expect(relay.answer({ id: row.id, answers })).toBe(true)
    expect(await pending).toEqual({ answers })
  })
})

describe("bounds: ttl, capacity, dispose and abort", () => {
  test("ttl expiry rethrows the ORIGINAL error by IDENTITY, never wrapped in an envelope", async () => {
    /** The harness rejection the expiry must reproduce. */
    const original = noProviderError()
    /** The relay with a 5 ms park lifetime. */
    const relay = createQuestionRelay({ ttlMs: 5 })
    relay.list()
    /** The parked question, which expires below. */
    const pending = relay.handle({ questions: QUESTIONS }, () => Promise.reject(original))
    // A FAILURE IS NOT A REPLY: the rejection is the same object the harness produced, so the model
    // can still branch on `NO_PROVIDER` and no `{ answers: [] }` is invented for it.
    expect(await rejectionWithin(pending, 1_000)).toBe(original)
    expect(relay.list()).toEqual([])
  })

  test("capacity eviction rejects the OLDEST with ITS original error", async () => {
    /** The first question's harness rejection. */
    const firstOriginal = noProviderError("first")
    /** The second question's harness rejection. */
    const secondOriginal = noProviderError("second")
    /** The relay with ONE slot, so the second park must evict the first. */
    const relay = createQuestionRelay({ capacity: 1 })
    relay.list()
    /** The question that gets evicted. */
    const evicted = relay.handle({ questions: QUESTIONS }, () => Promise.reject(firstOriginal))
    // The rejection is observed from the START, so the eviction below can never surface as an
    // unhandled rejection between two awaits.
    /** The evicted waiter's outcome, captured before the second park happens. */
    const evictedOutcome = evicted.then((): string => "resolved", (error: unknown): unknown => error)
    await tick()
    relay.list()
    /** The question that takes the slot. */
    const kept = relay.handle({ questions: QUESTIONS }, () => Promise.reject(secondOriginal))
    await tick()
    expect(await evictedOutcome).toBe(firstOriginal)
    expect(relay.list().length).toBe(1)
    relay.dispose()
    expect(await rejectionWithin(kept)).toBe(secondOriginal)
  })

  test("dispose rejects every parked waiter with its own original and empties the lot", async () => {
    /** The first question's rejection. */
    const firstOriginal = noProviderError("first")
    /** The second question's rejection. */
    const secondOriginal = noProviderError("second")
    /** The relay under test. */
    const relay = createQuestionRelay()
    relay.list()
    /** The first parked question. */
    const first = relay.handle({ questions: QUESTIONS }, () => Promise.reject(firstOriginal))
    await tick()
    relay.list()
    /** The second parked question. */
    const second = relay.handle({ questions: QUESTIONS }, () => Promise.reject(secondOriginal))
    await tick()
    relay.dispose()
    expect(await rejectionWithin(first)).toBe(firstOriginal)
    expect(await rejectionWithin(second)).toBe(secondOriginal)
    expect(relay.list()).toEqual([])
    // A disposed relay accepts nothing: an answer is false and a new NO_PROVIDER is rethrown.
    expect(relay.answer({ id: "anything", answers: completeAnswers() })).toBe(false)
    /** A fresh harness rejection routed at the disposed relay. */
    const late = noProviderError("late")
    expect(await rejectionWithin(relay.handle({ questions: QUESTIONS }, () => Promise.reject(late)))).toBe(late)
  })

  test("an already-aborted signal rejects with the abort reason and parks nothing", async () => {
    /** A controller already aborted with a reason of its own. */
    const controller = new AbortController()
    /** The reason the caller must observe. */
    const reason = new Error("the asker went away")
    controller.abort(reason)
    /** The relay, attach gate open so ONLY the abort can explain the rejection. */
    const relay = createQuestionRelay()
    relay.list()
    /** The rejection the caller observed. */
    const observed = await rejectionWithin(relay.handle({ questions: QUESTIONS, signal: controller.signal }, () => Promise.reject(noProviderError())))
    expect(observed).toBe(reason)
    expect(relay.list()).toEqual([])
  })

  test("an abort AFTER parking settles the promise with the reason and removes the entry", async () => {
    /** A controller whose signal is handed to the parked request. */
    const controller = new AbortController()
    /** The reason the caller must observe. */
    const reason = new Error("the client cancelled")
    /** The relay under test. */
    const relay = createQuestionRelay()
    relay.list()
    /** The parked question. */
    const pending = relay.handle({ questions: QUESTIONS, signal: controller.signal }, () => Promise.reject(noProviderError()))
    await tick()
    expect(relay.list().length).toBe(1)
    controller.abort(reason)
    expect(await rejectionWithin(pending)).toBe(reason)
    expect(relay.list()).toEqual([])
  })
})

describe("installQuestionRelay: the seam decisions the row reports", () => {
  test("a present seam installs, routes the waterfall through the relay, and releases both halves", async () => {
    /** The adapter double whose registration is driven below. */
    const double = seamDouble({ seam: "present" })
    /** The install outcome. */
    const install = installQuestionRelay(asInstallAdapter(double))
    expect(install.installed).toBe(true)
    if (!install.installed) return
    install.relay.list()
    /** The harness rejection the REGISTERED handler parks on. */
    const original = noProviderError()
    /** The pending question, parked through the handler the adapter really received. */
    const pending = double.handler?.({ questions: QUESTIONS }, () => Promise.reject(original))
    expect(pending).toBeDefined()
    await tick()
    /** The parked row. */
    const row = install.relay.list()[0]
    expect(install.relay.answer({ id: row.id, answers: completeAnswers() })).toBe(true)
    // The REGISTERED handler's reply carries the harness envelope, so the adapter forwards an object
    // to this row and this row answers with an object (review F1: never a bare array).
    expect(await pending).toEqual({ answers: completeAnswers() })
    install.dispose()
    expect(double.released.count).toBe(1)
    // The relay half is released too: a NO_PROVIDER after dispose is rethrown.
    /** A fresh rejection routed at the released relay. */
    const late = noProviderError("late")
    expect(await rejectionWithin(install.relay.handle({ questions: QUESTIONS }, () => Promise.reject(late)))).toBe(late)
  })

  test("no seam: absent with reason no-seam", () => {
    expect(installQuestionRelay(asInstallAdapter(seamDouble({ seam: "absent" })))).toEqual({ installed: false, reason: "no-seam" })
  })

  test("a throwing seam: absent with reason threw, never a throw", () => {
    expect(installQuestionRelay(asInstallAdapter(seamDouble({ seam: "throw" })))).toEqual({ installed: false, reason: "threw" })
  })

  test("no event bus: absent with reason no-event-bus, because the registration would be a no-op", () => {
    expect(installQuestionRelay(asInstallAdapter(seamDouble({ seam: "present", events: false })))).toEqual({ installed: false, reason: "no-event-bus" })
  })
})

// ── the ROW's inert path, driven through the REAL `apply` ────────────────────────────────────────
/**
 * Run `run` with the row-log root pinned to a fresh SANDBOX workspace, and collect what this row
 * appended to its log.
 *
 * The row's diagnostics live in `<workspace>/.mpd/logs/<row>.log` (R5), so the boot token is read
 * back from the file a user would read instead of a stdout capture that cannot see it. Both env
 * keys the sink's root chain reads are pinned, and both are put back before the arm returns.
 *
 * @param row - the row log's base name, i.e. `<row>.log`.
 * @param run - the call under test.
 * @returns the call's own result, plus the lines appended to that row log while it ran.
 */
async function inRowLog<T>(row: string, run: () => T): Promise<{ result: T; lines: string[] }> {
  /** The sandbox workspace this arm's row log is written under, removed before the arm returns. */
  const sandbox = mkdtempSync(join(tmpdir(), "mpd-roles-relay-rowlog-"))
  /** The two env keys the sink's root chain reads, saved for the restore below. */
  const saved = { logDir: process.env.MPD_MCP_LOG_DIR, workspace: process.env.DSH_WORKSPACE_ROOT }
  process.env.MPD_MCP_LOG_DIR = sandbox
  process.env.DSH_WORKSPACE_ROOT = sandbox
  /** This row's log file under the sandbox. */
  const file = join(sandbox, ".mpd", "logs", `${row}.log`)
  /** The log's byte size BEFORE the call, so only the appended bytes are read back. */
  let offset = 0
  try {
    offset = statSync(file).size
  } catch {
    offset = 0
  }
  try {
    /** The appended text, split into non-empty lines; `[]` when the file is unreadable. */
    const lines = (): string[] => {
      try {
        return readFileSync(file, "utf8").slice(offset).split("\n").filter((line) => line !== "")
      } catch {
        return []
      }
    }
    return { result: await run(), lines: lines() }
  } finally {
    if (saved.logDir === undefined) delete process.env.MPD_MCP_LOG_DIR
    else process.env.MPD_MCP_LOG_DIR = saved.logDir
    if (saved.workspace === undefined) delete process.env.DSH_WORKSPACE_ROOT
    else process.env.DSH_WORKSPACE_ROOT = saved.workspace
    rmSync(sandbox, { recursive: true, force: true })
  }
}

/** A mounted `mpdDsh` stand-in carrying the members `apply` reads for these arms. */
function mountedStub(parts: { events?: boolean; seam?: "present" | "absent" | "throw" }): Record<string, unknown> {
  /** Definitions registered through the stub, which proves the row's tools still landed. */
  const tools: unknown[] = []
  /** The stub itself; the seam is added only for the arms that need it. */
  const stub: Record<string, unknown> = {
    capabilities: () => ({ toolsRegister: true, skillsProvider: true, events: parts.events === true }),
    registerTool: (definition: unknown): (() => void) => {
      tools.push(definition)
      return () => {}
    },
    spawnAgent: async (): Promise<unknown> => ({ structured: { role: "x", summary: "done" }, stopReason: "complete" }),
  }
  if (parts.seam === "present") stub.onUserQuestionRequest = (): (() => void) => () => {}
  if (parts.seam === "throw") {
    stub.onUserQuestionRequest = (): never => {
      throw new Error("the seam blew up")
    }
  }
  return stub
}

/**
 * A cordis-shaped ctx stand-in recording every provision and every warning line.
 *
 * @param mounted - the `mpdDsh` service the row resolves through `ctx.get`.
 * @param effect - the ctx's effect seam; ABSENT reproduces a bare ctx with no lifetime owner (R2b).
 * @returns the ctx handed to `apply`, the services it provided, and the lines its logger warned with.
 */
function fakeCtx(
  mounted: unknown,
  effect?: (register: () => unknown) => unknown,
): { ctx: Parameters<typeof apply>[0]; provided: Record<string, unknown>; warns: string[] } {
  /** The service map `ctx.provide` filled, keyed by service name. */
  const provided: Record<string, unknown> = {}
  /** The lines the row reported through `ctx.logger.warn`, in order. */
  const warns: string[] = []
  /** The ctx handed to apply; permissive, because the row reads many optional seams. */
  const ctx: any = {
    tools: { register: (): (() => void) => () => {} },
    subagents: { start: async (): Promise<unknown> => ({ result: { structured: { role: "x", summary: "done" }, stopReason: "complete" } }) },
    provide: (key: string, value: unknown): void => {
      provided[key] = value
    },
    get: (key: string): unknown => (key === "mpdDsh" ? mounted : undefined),
    logger: {
      warn: (line: string): void => {
        warns.push(line)
      },
      info: (): void => {},
      error: (): void => {},
    },
  }
  if (effect !== undefined) ctx.effect = effect
  return { ctx, provided, warns }
}

describe("the row without the adapter seam stays inert", () => {
  test("no onUserQuestionRequest: ONE boot token says absent, no service, no throw", async () => {
    /** The stub a host without the question seam would mount. */
    const stub = mountedStub({ events: true })
    /** The fake ctx over it. */
    const fake = fakeCtx(stub)
    /** The row-log lines this apply appended. */
    const log = await inRowLog("mpd-roles", () => {
      apply(fake.ctx)
    })
    /** The single team-plane boot signature every token lives on. */
    const boot = log.lines.find((line) => line.includes("team plane:")) ?? ""
    expect(boot).toContain("questions=absent reason=no-seam")
    // ONE line reports the relay at all; an absent seam is not a warning storm.
    expect(log.lines.filter((line) => line.includes("questions=")).length).toBe(1)
    expect(fake.provided.mpdQuestions).toBeUndefined()
    // The rest of the row still landed, so an inert relay cannot take the roster down.
    expect(fake.provided.mpdRoles).toBeDefined()
  })

  test("a live seam provides mpdQuestions and reports questions=relay on the boot line", async () => {
    /** The stub carrying the waterfall seam. */
    const stub = mountedStub({ events: true, seam: "present" })
    /** The fake ctx over it; NO effect seam, so this ctx has no relay lifetime owner (R2b). */
    const fake = fakeCtx(stub)
    /** The row-log lines this apply appended. */
    const log = await inRowLog("mpd-roles", () => {
      apply(fake.ctx)
    })
    /** The single team-plane boot signature every token lives on. */
    const boot = log.lines.find((line) => line.includes("team plane:")) ?? ""
    // No web server in this composition, so the honest route count is zero; with no `ctx.effect` the
    // answerer and its routes are never disposed, which the token now says out loud (R2b).
    expect(boot).toContain("questions=relay routes=0 lifetime=unowned")
    // ONE warning line records the same fact, so a leaked answerer is diagnosable from the log.
    /** The warning lines that report the missing lifetime owner. */
    const lifetimeWarns = fake.warns.filter((line) => line.includes("lifetime"))
    expect(lifetimeWarns.length).toBe(1)
    expect(lifetimeWarns[0]).toContain("no lifetime owner")
    /** The protocol service the DSH Go panel reads. */
    const service = fake.provided.mpdQuestions as { list: (input: { sessionId?: string }) => unknown; answer: (input: { id: string; answers: unknown[] }) => unknown }
    expect(typeof service.list).toBe("function")
    expect(typeof service.answer).toBe("function")
    expect(service.list({})).toEqual([])
    expect(service.answer({ id: "nope", answers: [] })).toBe(false)
  })

  test("with ctx.effect present the token stays unchanged and no lifetime warning is emitted", async () => {
    /** The stub carrying the waterfall seam. */
    const stub = mountedStub({ events: true, seam: "present" })
    /** The registrations the ctx's effect seam was handed, so the disposal is provably owned. */
    const owned: Array<() => unknown> = []
    /** The fake ctx WITH the effect seam a real cordis ctx exposes. */
    const fake = fakeCtx(stub, (register: () => unknown): unknown => {
      owned.push(register)
      return register()
    })
    /** The row-log lines this apply appended. */
    const log = await inRowLog("mpd-roles", () => {
      apply(fake.ctx)
    })
    /** The single team-plane boot signature. */
    const boot = log.lines.find((line) => line.includes("team plane:")) ?? ""
    // The owned case keeps the ORIGINAL token: only an unowned relay gets the suffix.
    expect(boot).toContain("questions=relay routes=0")
    expect(boot).not.toContain("lifetime=")
    expect(fake.warns.filter((line) => line.includes("lifetime"))).toEqual([])
    // The effect seam really owns a release: the relay's disposal is registered, not skipped.
    expect(owned.length).toBeGreaterThan(0)
  })

  test("a seam that THROWS is reported absent with reason threw, and provides no service", async () => {
    /** The stub whose registration refuses. */
    const stub = mountedStub({ events: true, seam: "throw" })
    /** The fake ctx over it. */
    const fake = fakeCtx(stub)
    /** The row-log lines this apply appended. */
    const log = await inRowLog("mpd-roles", () => {
      apply(fake.ctx)
    })
    /** The single team-plane boot signature. */
    const boot = log.lines.find((line) => line.includes("team plane:")) ?? ""
    expect(boot).toContain("questions=absent reason=threw")
    expect(fake.provided.mpdQuestions).toBeUndefined()
  })
})

describe("shipped constants and clean-up", () => {
  test("the documented defaults are the contract's numbers", () => {
    expect(DEFAULT_QUESTION_TTL_MS).toBe(120_000)
    expect(DEFAULT_ATTACH_WINDOW_MS).toBe(15_000)
    expect(DEFAULT_QUESTION_CAPACITY).toBe(16)
  })
})
