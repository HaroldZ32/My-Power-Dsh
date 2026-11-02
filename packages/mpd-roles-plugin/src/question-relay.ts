// THE QUESTION RELAY: this bundle's own answerer on the harness `user-questions/request` waterfall,
// plus the two fenced HTTP routes that let a client which is NOT a DSH surface (a phone, a script,
// the DSH Go panel) answer `ask_user_question`.
//
// WHY A RELAY AND NOT A QUESTION UI. The harness asks its answerers in waterfall order and rejects
// with `NO_PROVIDER` when nobody claims the request. This module never competes with a real answerer:
// it awaits `next()` FIRST and only acts when that rejects with `NO_PROVIDER`. It then PARKS the
// request and hands it to a client over HTTP. The model's turn keeps the harness's own failure
// semantics — an unanswered question rejects the tool call with the ORIGINAL error after `ttlMs`,
// never with a synthetic one — so a caller can still branch on `NO_PROVIDER`.
//
// THE ATTACH GATE is what keeps an unattended engine from hanging a turn. A relay that parked every
// `NO_PROVIDER` request would sit for two minutes on a machine nobody is watching, so it parks ONLY
// when a client called `list()` within `attachWindowMs`; otherwise the original error is rethrown at
// once. A client that polls is a client that can answer.
//
// NOTHING HERE TOUCHES DISK. Pending questions are an in-memory interaction queue (plan §2): a
// process restart drops them, which is the honest outcome for a question whose asker is gone.
//
// THE ROUTES COPY THE WATCHDOG'S FENCED-ROUTE DISCIPLINE (mpd-team-watchdog/src/web.ts): an adapter
// probe wrapped in a `server.register` shape check, an effect-owned registration, a per-server
// WeakMap so a rebind never double-registers, the host fence FIRST, then this module's own method
// guard, a byte-capped single-decode body read, a parse at the boundary, and `{ok:true,…}` /
// `{ok:false,error}` JSON with `no-store`. A handler never throws and never echoes a filesystem path.
import type { DshAdapter, DshQuestionAnswer, DshQuestionAnswerEnvelope, DshQuestionItem, DshUserQuestionRequest } from "../../mpd-dsh-adapter-plugin/src/index"

/** How long a parked question waits for a client answer before the ORIGINAL error is rethrown. */
export const DEFAULT_QUESTION_TTL_MS = 120_000

/** How recent a `list()` must be for a `NO_PROVIDER` request to park instead of failing at once. */
export const DEFAULT_ATTACH_WINDOW_MS = 15_000

/** How many questions may be parked at once; parking beyond this evicts the OLDEST. */
export const DEFAULT_QUESTION_CAPACITY = 16

/** The GET route: every pending question, narrowed by `?sessionId=` when the client sends one. */
export const QUESTIONS_PATH = "/plugins/mpd-roles/questions"

/** The POST route: settle one pending question by id with label answers. */
export const ANSWER_PATH = "/plugins/mpd-roles/questions/answer"

/** Every route this module registers, so a reader and a test enumerate them from one place. */
export const QUESTION_ROUTES: readonly string[] = [QUESTIONS_PATH, ANSWER_PATH]

/** The largest answer body this surface accepts; anything larger is refused with 413 unparsed. */
export const MAX_BODY_BYTES = 64 * 1024

/**
 * One parked question as a client sees it.
 *
 * The shape is deliberately NARROW: the relay's own id (the handle a client answers with), the
 * session that asked, the parking instant, and the questions to display. The harness's internal
 * request object never leaves this module.
 */
export interface PendingQuestion {
  /** The opaque id a client answers with; unique within this process, never a harness identifier. */
  id: string
  /** The live session that asked, when the harness request named one. */
  sessionId?: string
  /** Epoch milliseconds at which the question was parked, for a client's age display. */
  createdAt: number
  /** The questions to display, copied so a client cannot mutate the parked request. */
  questions: DshQuestionItem[]
}

/** The relay's tuning knobs; every one has a default, so an unconfigured row still parks. */
export interface QuestionRelayOptions {
  /** Park lifetime in milliseconds; {@link DEFAULT_QUESTION_TTL_MS} unless a caller tunes it. */
  ttlMs?: number
  /** How recent a `list()` keeps the attach gate open; {@link DEFAULT_ATTACH_WINDOW_MS}. */
  attachWindowMs?: number
  /** Maximum parked questions; {@link DEFAULT_QUESTION_CAPACITY}. */
  capacity?: number
  /** The epoch-millisecond clock, injectable so the attach window is testable without waiting. */
  now?: () => number
  /** A bounded diagnostic sink (evictions); a throwing sink never fails a request. */
  warn?: (line: string) => void
}

/** One answer batch a client submits: the parked id plus the harness-shaped answers. */
export interface QuestionAnswerInput {
  /** The pending question the answers belong to. */
  id: string
  /** Answers whose `selected` entries are OPTION LABELS of that parked question, never indices; one entry per parked question item (the batch must COVER the request). */
  answers: DshQuestionAnswer[]
}

/**
 * The relay surface a row and its service consume.
 *
 * `list` is also the attach signal: calling it is what tells a later `NO_PROVIDER` request that a
 * client is listening, which is the contract that keeps an unattended engine from hanging a turn.
 */
export interface QuestionRelay {
  /**
   * The waterfall answerer: await `next()`, and park only when it rejects with `NO_PROVIDER`.
   *
   * THE REPLY IS THE HARNESS ENVELOPE (review F1): `next()` resolves the downstream answerer's
   * `{ answers: [...] }` and that object is returned by IDENTITY, never rebuilt; only a request this
   * relay CLAIMS is wrapped as `{ answers: <parked array> }`, because the harness consumes
   * `result.answers`. A bare array here would replace the envelope and crash the ask tool.
   *
   * @param request - the harness request, narrowed by the adapter.
   * @param next - the waterfall continuation, whose rejection decides whether this relay may park.
   * @returns the downstream envelope, or the envelope wrapping this relay's parked answers.
   */
  handle(request: DshUserQuestionRequest, next: () => Promise<DshQuestionAnswerEnvelope>): Promise<DshQuestionAnswerEnvelope>
  /**
   * Every parked question, OLDEST FIRST (newest last), narrowed to one session when asked.
   *
   * @param sessionId - an optional session filter; absent means "every parked question".
   * @returns independent copies, so a caller cannot mutate the parking lot.
   */
  list(sessionId?: string): PendingQuestion[]
  /**
   * Settle one parked question with a validated answer batch.
   *
   * @param input - the parked id plus the answer batch, validated by LABEL.
   * @returns true when the batch settled the question; false for an unknown/expired id or a refused batch.
   */
  answer(input: QuestionAnswerInput): boolean
  /** Reject every parked waiter with its ORIGINAL error and release the relay; idempotent. */
  dispose(): void
}

/** What installing the waterfall answerer produced: a live relay, or why the row must stay inert. */
export type QuestionRelayInstall =
  | { installed: true; relay: QuestionRelay; dispose: () => void }
  | { installed: false; reason: "no-seam" | "no-event-bus" | "threw" }

/** The response surface a route handler may rely on, structurally typed. */
interface RouteResponse {
  /** Write the status line and the headers. */
  writeHead: (status: number, headers: Record<string, string>) => void
  /** Write the body (or close the response with none). */
  end: (body?: string) => void
}

/** The request surface these routes read: the verb, the url, the headers the fence inspects, the body. */
interface RouteRequest {
  /** The HTTP verb; the GET route admits GET only and the answer route POST only. */
  method?: unknown
  /** The request URL, read for the `?sessionId=` filter the GET route documents. */
  url?: unknown
  /** The headers, handed verbatim to the host's fence. */
  headers?: unknown
  /** The body stream; a Node request is async-iterable. */
  [Symbol.asyncIterator]: () => AsyncIterator<unknown>
}

/** The registration surface of the host's web server, structurally typed. */
interface WebServerLike {
  /** Register one route; the host owns matching and lifetime. */
  register: (route: { kind: "exact"; path: string; handler: (req: unknown, res: unknown) => unknown }) => unknown
}

/** One route this module mounts: its exact path plus the handler the host calls per request. */
interface QuestionRoute {
  /** The exact path the host matches. */
  path: string
  /** The handler; it always answers JSON and never rejects. */
  handler: (req: unknown, res: unknown) => Promise<void>
}

/** One parsed body, or the precise reason a field was refused (400 with that reason). */
type ParsedBody<Value> = { ok: true; value: Value } | { ok: false; error: string }

/** The outcome of reading a request body, before any field is validated. */
type BodyRead = { ok: true; value: unknown } | { ok: false; status: 400 | 413 }

/** The adapter members the mount reads; a bare route test supplies exactly these. */
type QuestionWebAdapter = Pick<DshAdapter, "webServerOf" | "webRequestRejection" | "onServiceBound">

/** The row's effect seam: it hands the host a disposer-producing callback and returns its handle. */
export type QuestionEffect = (register: () => unknown) => unknown

/** What the web surface needs from the row beyond the adapter; nothing here is a harness service. */
export interface QuestionWebDeps {
  /** The live relay every request reads and answers; the row creates ONE per apply. */
  relay: QuestionRelay
  /** A bounded diagnostic sink; the route never prints and never throws through it. */
  warn?: (line: string) => void
}

/**
 * One PARKED question: its public view plus the handles that settle its waiter and cancellation.
 *
 * `original` is the harness's own rejection of `next()`, kept per entry because every non-answer
 * outcome (expiry, eviction, dispose) must rethrow THAT error — the model has to see `NO_PROVIDER`,
 * not a relay-invented substitute.
 */
interface ParkedQuestion {
  /** The public view clients poll; never mutated after it is parked. */
  view: PendingQuestion
  /** Resolve the waiter's promise with the validated answers. */
  resolve: (answers: DshQuestionAnswer[]) => void
  /** Reject the waiter's promise with an original error. */
  reject: (error: unknown) => void
  /** The expiry timer, cleared whenever the entry settles. */
  timer?: ReturnType<typeof setTimeout>
  /** The request's cancellation lifetime, kept so its listener can be removed. */
  signal?: AbortSignal
  /** The abort listener, removed whenever the entry settles. */
  onAbort?: () => void
  /** The error `next()` produced for this request; rethrown by every non-answer outcome. */
  original: unknown
}

/** One body chunk as bytes: a Buffer/Uint8Array is already bytes, a string is encoded here. */
const encoder = new TextEncoder()

/** Decode the joined body ONCE, so a multi-byte character split across chunks still round-trips. */
const decoder = new TextDecoder()

/** One thrown value as text; a non-Error is stringified rather than dropped. */
function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  if (error !== null && typeof error === "object") {
    /** The value's own `message` field, when it carries one. */
    const message = (error as { message?: unknown }).message
    if (typeof message === "string") return message
  }
  return String(error)
}

/**
 * Whether one rejection is the harness's `NO_PROVIDER`, read the documented way.
 *
 * The adapter copies the harness taxonomy code onto the error it throws, so a STRING `code` is
 * authoritative when it is present; the message pattern is the fallback for a harness (or a
 * waterfall) that rejects with a plain `Error`. The pattern is deliberately narrow, so an unrelated
 * failure can never be parked and silently delayed.
 *
 * @param error - the rejection `next()` produced.
 * @returns whether this relay may park the request instead of propagating it.
 */
function noProviderOf(error: unknown): boolean {
  /** The stable taxonomy code, when the rejection carries one. */
  const code = error !== null && typeof error === "object" ? (error as { code?: unknown }).code : undefined
  if (typeof code === "string") return code === "NO_PROVIDER"
  return /no user-questions answerer/i.test(messageOf(error))
}

/**
 * The value a cancelled request rejects with: the signal's own reason.
 *
 * A signal aborted with NO reason still needs a rejection rather than a hang, so the fallback names
 * the cancellation instead of reusing the `NO_PROVIDER` error — the model must not be told "nobody
 * answered" when the asker itself gave up.
 *
 * @param signal - the aborted request signal.
 * @returns the reason to reject with.
 */
function abortErrorOf(signal: AbortSignal): unknown {
  return signal.reason === undefined ? new Error("mpd-roles: the user-question request was aborted") : signal.reason
}

/**
 * One tuning amount, or its default.
 *
 * A mistyped knob must not make the relay unusable, so a non-finite or negative value is replaced
 * rather than propagated into a `setTimeout`.
 *
 * @param value - the caller's value, possibly absent.
 * @param fallback - the documented default.
 * @returns the value when it is a finite non-negative number, else the fallback.
 */
function amountOf(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback
}

/**
 * Copy a question list into the relay's own memory.
 *
 * A caller (and later a client) must never be able to mutate the parked request: the OPTION LABELS
 * are what an answer is validated against, so a shared array would turn a label check into a race.
 *
 * @param questions - the items as the harness request carried them.
 * @returns an independent copy, narrowed to the fields this bundle exposes.
 */
function copyQuestions(questions: readonly DshQuestionItem[]): DshQuestionItem[] {
  return questions.map((item) => {
    /** The item's own fields, narrowed to the adapter's plain-data shape. */
    const copy: DshQuestionItem = { id: item.id, question: item.question }
    if (item.header !== undefined) copy.header = item.header
    if (item.multiSelect !== undefined) copy.multiSelect = item.multiSelect
    if (item.options !== undefined) {
      copy.options = item.options.map((option) => (option.description === undefined
        ? { label: option.label }
        : { label: option.label, description: option.description }))
    }
    return copy
  })
}

/**
 * Copy one validated answer batch.
 *
 * The promise settles with this copy, so a client that keeps its request object cannot rewrite an
 * answer after the relay has handed it back to the harness.
 *
 * @param answers - the batch validated by {@link answersMatch}.
 * @returns independent answers, labels copied too.
 */
function copyAnswers(answers: readonly DshQuestionAnswer[]): DshQuestionAnswer[] {
  return answers.map((answer) => {
    /** One answer's own fields; `custom` is kept only when the client really sent text. */
    const copy: DshQuestionAnswer = { id: answer.id, selected: [...answer.selected] }
    if (typeof answer.custom === "string") copy.custom = answer.custom
    return copy
  })
}

/**
 * Why an answer batch was refused, as the ONE rule the caller reports.
 *
 * The members are listed in the precedence {@link answerRefusalOf} applies, so a caller never has to
 * guess which of several broken rules a refusal names.
 */
export type AnswerRefusal =
  | "shape"
  | "duplicate"
  | "unknown-id"
  | "missing"
  | "too-many-labels"
  | "label"

/**
 * Validate one answer batch against a parked question — LABELS ONLY, never indices.
 *
 * WHAT "VALID" MEANS (plan §4.3, amended after the CodeRabbit review of PR #88): the batch COVERS the
 * parked request — exactly one entry per parked question item, no duplicate ids and no id the request
 * never carried — every `selected` entry is one of THAT question's option labels, and a question that
 * is not `multiSelect: true` carries at most one label. An empty `selected` plus `custom` is still a
 * legitimate skipped / free-text answer, and a free-text question (no `options`) accepts only that.
 *
 * WHY COVERAGE IS PART OF VALIDITY: a batch that answered only SOME of the questions used to settle
 * the model's tool call with the rest unanswered, so the harness reported success for a request no
 * human finished. Partial input is now refused WHOLE and the request stays parked.
 *
 * The checks run in a FIXED order (shape, duplicate, unknown id, missing item, too many labels,
 * unknown label), so a refusal names one rule rather than the first entry that looked odd.
 *
 * @param view - the parked question being answered.
 * @param answers - the untrusted batch from a service caller or the wire.
 * @returns the rule that refused the batch, or undefined when it may settle the question.
 */
export function answerRefusalOf(view: PendingQuestion, answers: unknown): AnswerRefusal | undefined {
  if (!Array.isArray(answers) || answers.length === 0) return "shape"
  /** The question ids this request carries, so an id from another request is refused as unknown. */
  const parkedIds = new Set(view.questions.map((question) => question.id))
  /** The parked items keyed by id, so the label pass resolves one item without a scan. */
  const byId = new Map(view.questions.map((question) => [question.id, question]))
  /** The answer ids seen so far, so a question answered twice is refused. */
  const seen = new Set<string>()
  /** Every entry that passed the id checks, kept so the label pass does not re-narrow the raw value. */
  const entries: Array<{ readonly id: string; readonly selected: unknown; readonly custom: unknown }> = []
  for (const entry of answers) {
    if (entry === null || typeof entry !== "object") return "shape"
    /** The raw answer fields, narrowed one at a time. */
    const raw = entry as { id?: unknown; selected?: unknown; custom?: unknown }
    if (typeof raw.id !== "string" || raw.id === "") return "shape"
    if (seen.has(raw.id)) return "duplicate"
    seen.add(raw.id)
    if (!parkedIds.has(raw.id)) return "unknown-id"
    entries.push({ id: raw.id, selected: raw.selected, custom: raw.custom })
  }
  // COVERAGE: every parked question item has an answer. Duplicates and unknown ids were refused
  // above, so "every parked id was seen" is exactly "one entry per parked question item".
  for (const question of view.questions) {
    if (!seen.has(question.id)) return "missing"
  }
  for (const entry of entries) {
    /** The parked item this answer belongs to; the coverage pass above proved it is present. */
    const question = byId.get(entry.id)
    if (question === undefined) return "unknown-id"
    if (!Array.isArray(entry.selected)) return "shape"
    /** The labels this question really offers; empty for a free-text question. */
    const labels = new Set((question.options ?? []).map((option) => option.label))
    if (question.multiSelect !== true && entry.selected.length > 1) return "too-many-labels"
    for (const label of entry.selected) {
      if (typeof label !== "string") return "shape"
      if (!labels.has(label)) return "label"
    }
    if (entry.custom !== undefined && typeof entry.custom !== "string") return "shape"
  }
  return undefined
}

/**
 * Whether one answer batch may settle a parked question, narrowed to the typed batch.
 *
 * This is the SAME validator the route's reason line reads ({@link answerRefusalOf}), so the relay
 * and the wire can never disagree about which batch is acceptable.
 *
 * @param view - the parked question being answered.
 * @param answers - the untrusted batch from a service caller or the wire.
 * @returns whether the batch covers the request and every label it names is offered.
 */
function answersMatch(view: PendingQuestion, answers: unknown): answers is DshQuestionAnswer[] {
  return answerRefusalOf(view, answers) === undefined
}

/**
 * The next opaque pending-question id: a per-process counter plus the parking instant.
 *
 * The counter keeps two questions parked in the same millisecond distinct; the instant keeps an id
 * from a restarted process from colliding with a stale client view.
 *
 * @param sequence - the relay's monotonically increasing parking counter.
 * @param at - the parking instant in epoch milliseconds.
 * @returns the id a client answers with.
 */
function nextIdOf(sequence: number, at: number): string {
  return "q" + sequence.toString(36) + "-" + at.toString(36)
}

/**
 * Create the in-memory question relay.
 *
 * The returned object is the whole state machine: `handle` parks, `list` reads AND marks a client as
 * attached, `answer` settles one parked question by label, and `dispose` rejects everything parked
 * with its own original error. No disk, no module-level cache, no workspace state.
 *
 * @param options - the timing knobs and the optional diagnostic sink.
 * @returns the relay surface a row registers as its waterfall answerer.
 */
export function createQuestionRelay(options: QuestionRelayOptions = {}): QuestionRelay {
  /** Park lifetime: the window a model turn can afford to wait for a human answer. */
  const ttlMs = amountOf(options.ttlMs, DEFAULT_QUESTION_TTL_MS)
  /** The attach gate's window; a poll older than this means nobody is listening. */
  const attachWindowMs = amountOf(options.attachWindowMs, DEFAULT_ATTACH_WINDOW_MS)
  /** The parking bound; at least one slot, because a zero capacity could never park anything. */
  const capacity = Math.max(1, Math.floor(amountOf(options.capacity, DEFAULT_QUESTION_CAPACITY)))
  /** The clock every timestamp and the attach window read; injectable for deterministic tests. */
  const now = options.now ?? ((): number => Date.now())
  /** The parked questions, OLDEST FIRST, so eviction and "newest last" are the same order. */
  const parked: ParkedQuestion[] = []
  /** Epoch milliseconds of the most recent `list()`, i.e. the attach gate's only state. */
  let lastListAt: number | undefined
  /** Whether the row released the relay; a released relay parks and answers nothing. */
  let disposed = false
  /** The per-process parking counter, so two questions in one millisecond still get distinct ids. */
  let sequence = 0

  /** Report one diagnostic through the options sink, contained: a broken sink must not fail a request. */
  function warnLine(line: string): void {
    try {
      options.warn?.(line)
    } catch {
      // the diagnostic sink is best effort; the parking lot stays intact
    }
  }

  /** Release one entry's cancellation handles: its expiry timer and its abort listener. */
  function releaseHandles(entry: ParkedQuestion): void {
    if (entry.timer !== undefined) clearTimeout(entry.timer)
    if (entry.signal !== undefined && entry.onAbort !== undefined) {
      try {
        entry.signal.removeEventListener("abort", entry.onAbort)
      } catch {
        // a foreign signal that refuses removal is best effort; the entry is already leaving
      }
    }
  }

  /**
   * Remove one parked entry and settle it exactly once.
   *
   * THE REMOVAL IS THE GUARD: a timer that fires after an answer finds no entry and does nothing, so
   * a resolved promise can never be rejected afterwards by expiry, eviction or dispose.
   *
   * @param entry - the parked question to settle.
   * @param finish - the settlement to run after the entry has left the parking lot.
   */
  function settle(entry: ParkedQuestion, finish: () => void): void {
    /** The entry's position, or -1 when an earlier settle already removed it. */
    const at = parked.indexOf(entry)
    if (at < 0) return
    parked.splice(at, 1)
    releaseHandles(entry)
    finish()
  }

  /** Whether a client called `list()` recently enough for this relay to park a question. */
  function attached(): boolean {
    if (lastListAt === undefined) return false
    /** How long ago the last poll happened; a clock that moved BACKWARDS still counts as recent. */
    const elapsed = now() - lastListAt
    return elapsed <= attachWindowMs
  }

  /**
   * Park one failed request and hand the harness a promise a client will settle.
   *
   * CAPACITY IS BOUNDED BY EVICTION, NOT BY REFUSAL: an older question nobody answered must not keep
   * a newer one out, and the evicted waiter is rejected with ITS OWN original error, so it never
   * dangles. Every non-answer outcome rethrows the SAME `original` value the harness produced.
   *
   * @param request - the request whose `next()` rejected with `NO_PROVIDER`.
   * @param original - the harness's own rejection, rethrown by expiry, eviction and dispose.
   * @returns the promise the harness awaits until a client answers or the parking ends.
   */
  function park(request: DshUserQuestionRequest, original: unknown): Promise<DshQuestionAnswer[]> {
    while (parked.length >= capacity) {
      /** The oldest parked entry; `settle` removes it, so this loop always terminates. */
      const oldest = parked[0]
      if (oldest === undefined) break
      warnLine("question relay: the parked question " + oldest.view.id + " was evicted (capacity " + capacity + ")")
      settle(oldest, () => oldest.reject(oldest.original))
    }
    /** The settlement hooks, assigned synchronously by the promise executor below. */
    const hooks: { resolve?: (answers: DshQuestionAnswer[]) => void; reject?: (error: unknown) => void } = {}
    /** The promise the harness awaits; exactly one outcome ever settles it. */
    const promise = new Promise<DshQuestionAnswer[]>((resolve, reject): void => {
      hooks.resolve = resolve
      hooks.reject = reject
    })
    sequence += 1
    /** The parking instant, read once so the id and `createdAt` agree. */
    const at = now()
    /** The public view a client polls; its questions are a private copy. */
    const view: PendingQuestion = {
      id: nextIdOf(sequence, at),
      createdAt: at,
      ...(request.sessionId === undefined ? {} : { sessionId: request.sessionId }),
      questions: copyQuestions(request.questions),
    }
    /** The parked entry: its public view plus the way to settle the waiter's promise. */
    const entry: ParkedQuestion = {
      view,
      original,
      resolve: (answers: DshQuestionAnswer[]): void => {
        hooks.resolve?.(answers)
      },
      reject: (error: unknown): void => {
        hooks.reject?.(error)
      },
    }
    parked.push(entry)
    entry.timer = setTimeout((): void => {
      settle(entry, () => entry.reject(original))
    }, ttlMs)
    if (request.signal !== undefined) {
      /** The request's cancellation lifetime, kept so the listener can be removed on settle. */
      const signal = request.signal
      /** Reject the waiter the moment the asker cancels, and take the entry out of the parking lot. */
      const onAbort = (): void => {
        settle(entry, () => entry.reject(abortErrorOf(signal)))
      }
      entry.signal = signal
      entry.onAbort = onAbort
      try {
        signal.addEventListener("abort", onAbort, { once: true })
      } catch {
        // a foreign signal without addEventListener cannot be observed; the ttl still bounds the park
      }
      // The abort may have raced the subscription, so the state is re-read AFTER it.
      if (signal.aborted) onAbort()
    }
    return promise
  }

  /**
   * The waterfall answerer: await `next()` first, then decide whether this relay may park.
   *
   * ORDER IS THE CONTRACT. A rejection that is not `NO_PROVIDER` propagates UNCHANGED (the same
   * object), so a broken downstream answerer is never disguised as an answered question. Only after
   * a `NO_PROVIDER` rejection and an OPEN attach gate does the request park.
   *
   * THE PARKING LOT STAYS AN ARRAY (plan §4.3) and only the REPLY is wrapped: a client's answer
   * settles the waiter with `DshQuestionAnswer[]`, and the harness receives
   * `{ answers: <that array> }`. Every non-answer outcome still rejects with the ORIGINAL error, so
   * expiry, eviction, abort and dispose never get wrapped into an envelope.
   *
   * @param request - the harness request, narrowed by the adapter.
   * @param next - the downstream answerer; its envelope is returned as-is.
   * @returns the downstream envelope, or the envelope this relay's parked answers settle into.
   */
  async function handle(request: DshUserQuestionRequest, next: () => Promise<DshQuestionAnswerEnvelope>): Promise<DshQuestionAnswerEnvelope> {
    try {
      return await next()
    } catch (error) {
      if (!noProviderOf(error)) throw error
      // NOTHING TO ASK IS NOTHING TO ANSWER: parking an empty question set would wait for a human
      // who has no question to read, so the model gets the harness error back at once.
      if (request.questions.length === 0) throw error
      // A released relay must not accept new work; the harness keeps its own NO_PROVIDER error.
      if (disposed) throw error
      // An asker that already cancelled gets its own reason, never a wait for a client.
      if (request.signal?.aborted === true) throw abortErrorOf(request.signal)
      // THE ATTACH GATE: with no recent poll nobody can answer, so fail the turn NOW rather than hang it.
      if (!attached()) throw error
      // Only the CLAIMED reply is wrapped; a park rejection above/below is the original error.
      return { answers: await park(request, error) }
    }
  }

  /**
   * Every parked question, oldest first, narrowed to one session when asked.
   *
   * The call RECORDS the poll time — that is the attach gate — so a client that polls is exactly a
   * client the relay is willing to park for.
   *
   * @param sessionId - an optional session filter; absent means "every parked question".
   * @returns independent copies of the parked views, in parking order.
   */
  function list(sessionId?: string): PendingQuestion[] {
    if (disposed) return []
    lastListAt = now()
    /** The parked entries this read reports, in parking order. */
    const rows = parked.filter((entry) => sessionId === undefined || entry.view.sessionId === sessionId)
    return rows.map((entry) => ({
      ...entry.view,
      questions: copyQuestions(entry.view.questions),
    }))
  }

  /**
   * Settle one parked question with a validated answer batch.
   *
   * A REFUSAL IS NEVER PARTIAL: a batch that misses a parked question, repeats an id, names an id
   * this request never carried, puts several labels on a single-select question or selects a label
   * the question never offered returns false and leaves the question PARKED, so the client corrects
   * itself instead of losing the request — and the model's tool call is never settled half-answered.
   *
   * @param input - the parked id plus the answer batch.
   * @returns true only when this call settled the question.
   */
  function answer(input: QuestionAnswerInput): boolean {
    if (disposed) return false
    /** The id the client answered, empty when the call carried none. */
    const id = typeof input?.id === "string" ? input.id : ""
    if (id === "") return false
    /** The parked question that id names, or undefined when it is unknown or already settled. */
    const entry = parked.find((candidate) => candidate.view.id === id)
    if (entry === undefined) return false
    /** The untrusted batch, narrowed and label-validated by {@link answersMatch}. */
    const answers: unknown = input?.answers
    if (!answersMatch(entry.view, answers)) return false
    /** The settled value: a private copy, so a client cannot rewrite an answer after it settled. */
    const settledAnswers = copyAnswers(answers)
    settle(entry, () => entry.resolve(settledAnswers))
    return true
  }

  /** Reject every parked waiter with its ORIGINAL error; a second call is a no-op. */
  function dispose(): void {
    if (disposed) return
    disposed = true
    lastListAt = undefined
    // A row teardown must not turn a NO_PROVIDER refusal into a hang or a synthetic taxonomy the
    // model cannot branch on, so every waiter gets the error its own request produced.
    for (const entry of parked.splice(0)) {
      releaseHandles(entry)
      entry.reject(entry.original)
    }
  }

  return { handle, list, answer, dispose }
}

/**
 * Install the relay as the row's waterfall answerer.
 *
 * DEGRADE IS TOTAL AND SILENT: a composition whose adapter exposes no `onUserQuestionRequest`, whose
 * event bus is absent (the SAME probe the adapter itself degrades on), or whose registration throws
 * yields `installed: false` with the reason the row prints on its boot line. Nothing is thrown and no
 * relay is returned that would look like a working service.
 *
 * @param dsh - the adapter seams this install reads: the registration and its capability probe.
 * @param options - the relay's tuning knobs, passed through unchanged.
 * @returns the live relay plus its release, or the reason the row must stay inert.
 */
export function installQuestionRelay(
  dsh: Pick<DshAdapter, "onUserQuestionRequest" | "capabilities">,
  options: QuestionRelayOptions = {},
): QuestionRelayInstall {
  try {
    if (typeof dsh.onUserQuestionRequest !== "function") return { installed: false, reason: "no-seam" }
    // `events` is the adapter's own `typeof ctx.on === "function"` probe; without it the registration
    // is a silent no-op disposer, which must not be reported as an installed relay.
    if (dsh.capabilities().events !== true) return { installed: false, reason: "no-event-bus" }
    /** The relay this registration feeds; ONE per row, so every request lands in the same lot. */
    const relay = createQuestionRelay(options)
    /** The registration's disposer; a non-function answer is treated as "nothing to release". */
    const off = dsh.onUserQuestionRequest(
      (request: DshUserQuestionRequest, next: () => Promise<DshQuestionAnswerEnvelope>): Promise<DshQuestionAnswerEnvelope> => relay.handle(request, next),
      "mpd-roles",
    )
    return {
      installed: true,
      relay,
      dispose: (): void => {
        try {
          if (typeof off === "function") off()
        } catch {
          // an already-disposed registration is a successful disposal for this row
        }
        relay.dispose()
      },
    }
  } catch {
    return { installed: false, reason: "threw" }
  }
}

/**
 * Answer one JSON response with the wire headers every route shares.
 *
 * `cache-control: no-store` is unconditional: a pending question is transient by contract, so a
 * cached list would let a client answer a question that no longer exists.
 *
 * @param res - the route response, treated structurally.
 * @param status - the HTTP status to answer.
 * @param body - the JSON body; a success carries `ok:true`, every failure `ok:false` plus `error`.
 * @param headers - extra headers (a method guard sets `allow`).
 */
function writeJson(res: unknown, status: number, body: unknown, headers: Record<string, string> = {}): void {
  /** The response, narrowed to the write surface a one-shot JSON route may use. */
  const out = res as RouteResponse
  out.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers })
  out.end(JSON.stringify(body))
}

/** Report one diagnostic through the row sink, contained: a broken sink must not fail a request. */
function warnLine(deps: QuestionWebDeps, line: string): void {
  try {
    deps.warn?.(line)
  } catch {
    // the diagnostic sink is best effort; the response path stays intact
  }
}

/**
 * Read one request body under the 64 KiB cap.
 *
 * Chunks are kept as BYTES and decoded once at the end, so a multi-byte character split across two
 * chunks still round-trips; the cap is measured on bytes, not on UTF-16 units.
 *
 * @param request - the route's request, treated as a stream because that is all this module needs.
 * @returns the parsed JSON value, or the status the route must answer (400 unreadable/unparsable,
 * 413 over the cap).
 */
async function readBody(request: unknown): Promise<BodyRead> {
  /** The request narrowed to the streaming surface; a non-Node request simply fails this probe. */
  const req = request as Partial<RouteRequest> | undefined
  if (req === undefined || typeof req[Symbol.asyncIterator] !== "function") return { ok: false, status: 400 }
  /** The body chunks as bytes, kept separate until the whole body is decoded once. */
  const parts: Uint8Array[] = []
  /** Byte length accumulated so far; the 413 bound is measured on BYTES. */
  let size = 0
  for await (const chunk of req as RouteRequest) {
    /** One chunk as bytes; a non-string non-buffer chunk is stringified like the sibling route does. */
    const part = typeof chunk === "string" ? encoder.encode(chunk) : chunk instanceof Uint8Array ? chunk : encoder.encode(String(chunk))
    size += part.byteLength
    if (size > MAX_BODY_BYTES) return { ok: false, status: 413 }
    parts.push(part)
  }
  /** The body bytes joined into one contiguous buffer for a single decode. */
  const bytes = new Uint8Array(size)
  /** Write offset while joining the chunks. */
  let at = 0
  for (const part of parts) {
    bytes.set(part, at)
    at += part.byteLength
  }
  /** The fully decoded body text. */
  const raw = decoder.decode(bytes)
  if (raw.trim() === "") return { ok: false, status: 400 }
  try {
    return { ok: true, value: JSON.parse(raw) }
  } catch {
    return { ok: false, status: 400 }
  }
}

/** The body's own object shape, or undefined when it is null, an array or a primitive. */
function recordOf(body: unknown): Record<string, unknown> | undefined {
  return body !== null && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : undefined
}

/** The request's HTTP verb, upper-cased, or "" when the request carries none. */
function methodOf(request: unknown): string {
  /** The raw verb, narrowed to a string. */
  const method = (request as { method?: unknown } | undefined)?.method
  return typeof method === "string" ? method.toUpperCase() : ""
}

/**
 * The `?sessionId=` filter of one GET request, or undefined when the client sent none.
 *
 * The query is the repository's existing convention for a route that names a session (the team
 * routes use the same spelling); it SELECTS among parked questions and never authorizes anything —
 * the host fence has already run. An unparsable or blank URL simply means "no filter".
 *
 * @param request - the route request.
 * @returns the trimmed session id, or undefined.
 */
function sessionIdOf(request: unknown): string | undefined {
  /** The raw URL a Node request carries. */
  const raw = (request as { url?: unknown } | undefined)?.url
  if (typeof raw !== "string" || raw === "") return undefined
  try {
    /** The URL parsed against a placeholder base, since a route request may carry a path only. */
    const url = new URL(raw, "http://localhost")
    /** The trimmed filter, or empty when absent. */
    const value = url.searchParams.get("sessionId")?.trim() ?? ""
    return value === "" ? undefined : value
  } catch {
    return undefined
  }
}

/**
 * Validate one answer body at the boundary: `{ id, answers: [{ id, selected, custom? }] }`.
 *
 * Only the SHAPE is checked here. Whether the batch COVERS the parked request and whether each label
 * is one the parked question offers is the relay's decision (it owns the parked question), and its
 * refusal becomes this route's 400 with the rule that failed.
 *
 * @param body - the parsed JSON body.
 * @returns the validated input, or the one-line reason the boundary refused it.
 */
function parseAnswerBody(body: unknown): ParsedBody<QuestionAnswerInput> {
  /** The body as a plain object, or undefined when it is null, an array or a primitive. */
  const record = recordOf(body)
  if (record === undefined) return { ok: false, error: "the request body must be a JSON object" }
  /** The trimmed parked-question id, empty when absent or mistyped. */
  const id = typeof record.id === "string" ? record.id.trim() : ""
  if (id === "") return { ok: false, error: "id must be a non-empty string" }
  if (!Array.isArray(record.answers) || record.answers.length === 0) return { ok: false, error: "answers must be a non-empty array" }
  /** The validated answers, in the order the client sent them. */
  const answers: DshQuestionAnswer[] = []
  for (const entry of record.answers) {
    /** One raw answer, narrowed field by field. */
    const raw = entry !== null && typeof entry === "object" ? (entry as { id?: unknown; selected?: unknown; custom?: unknown }) : undefined
    if (raw === undefined) return { ok: false, error: "every answer must be a JSON object" }
    /** The answered question's id, trimmed and known non-empty. */
    const questionId = typeof raw.id === "string" ? raw.id.trim() : ""
    if (questionId === "") return { ok: false, error: "every answer needs a non-empty id" }
    if (!Array.isArray(raw.selected)) return { ok: false, error: "every answer needs selected as an array of strings" }
    /** The selected labels, proven strings here so the relay can compare them to option labels. */
    const selected: string[] = []
    for (const label of raw.selected) {
      if (typeof label !== "string") return { ok: false, error: "every answer needs selected as an array of strings" }
      selected.push(label)
    }
    if (raw.custom !== undefined && typeof raw.custom !== "string") return { ok: false, error: "custom must be a string when present" }
    /** One validated answer; `custom` is kept only when the client really sent text. */
    const answer: DshQuestionAnswer = { id: questionId, selected }
    if (typeof raw.custom === "string") answer.custom = raw.custom
    answers.push(answer)
  }
  return { ok: true, value: { id, answers } }
}

/**
 * Build the GET handler: fence, method guard, session filter, list.
 *
 * The fence runs FIRST even for a read — the repository has no unfenced route — and the method guard
 * is this module's own, because the host's route table matches a path, not a verb.
 *
 * @param dsh - the adapter the fence is delegated to.
 * @param deps - the live relay and the diagnostic sink.
 * @returns the async handler the web server calls per request.
 */
function listHandlerOf(dsh: Pick<DshAdapter, "webRequestRejection">, deps: QuestionWebDeps): (req: unknown, res: unknown) => Promise<void> {
  return async (req: unknown, res: unknown): Promise<void> => {
    try {
      // THE FENCE RUNS BEFORE ANY WORK: a refused request never reaches the method guard or the relay.
      /** The host's verdict for this request, or undefined when it may proceed. */
      const rejection = dsh.webRequestRejection(req)
      if (rejection !== undefined) {
        writeJson(res, rejection, { ok: false, error: `mpd-roles: the request is not authenticated for ${QUESTIONS_PATH}` })
        return
      }
      if (methodOf(req) !== "GET") {
        writeJson(res, 405, { ok: false, error: "mpd-roles: this route accepts GET only" }, { allow: "GET" })
        return
      }
      /** Every parked question this client may answer, newest last, narrowed by session when asked. */
      const pending = deps.relay.list(sessionIdOf(req))
      writeJson(res, 200, { ok: true, pending })
    } catch (error) {
      // NEVER THROW OUT OF A HANDLER: a throwing fence or relay is a payload. The detail goes to the
      // row log; the CLIENT message carries no filesystem path.
      warnLine(deps, `route ${QUESTIONS_PATH} failed: ${messageOf(error)}`)
      try {
        writeJson(res, 500, { ok: false, error: "mpd-roles: the request could not be completed" })
      } catch {
        // the response is already gone; nothing left to write and nothing left to throw
      }
    }
  }
}

/**
 * The ONE-LINE reason a refused batch is answered with, keyed by the rule that failed.
 *
 * The sentence is FIXED: it names the rule and never echoes a submitted id, label or count, so a
 * refusal cannot hand client input back over the wire (and a caller cannot mine the shape of the
 * parked request from an error line).
 *
 * @param refusal - the rule {@link answerRefusalOf} reported, or undefined when it reported none.
 * @returns the reason line, without the route's `mpd-roles:` prefix.
 */
function refusalLineOf(refusal: AnswerRefusal | undefined): string {
  switch (refusal) {
    case "missing":
      return "the answers must cover every question the request asked (one answer per question item)"
    case "duplicate":
      return "the answers name the same question id twice"
    case "unknown-id":
      return "an answer names a question this request does not carry"
    case "too-many-labels":
      return "a question that is not multi-select accepts at most one label"
    case "shape":
      return "an answer entry is malformed"
    case "label":
      return "an answer selected a label this question does not offer"
    default:
      // UNREACHABLE while `answer` and the membership probe read the same synchronous parking lot;
      // the fallback exists so the route always answers a sentence instead of `undefined`.
      return "the answer batch was refused"
  }
}

/**
 * Build the POST handler: fence, method guard, capped body, boundary parse, relay answer.
 *
 * A refusal carries the most precise status the boundary can justify: 404 when no parked question
 * has the id, 400 when the batch breaks a relay rule — a question left unanswered, a duplicate or
 * unknown id, several labels on a single-select question, a malformed entry or a label the question
 * never offered — with ONE line that names the rule and echoes no input.
 *
 * @param dsh - the adapter the fence is delegated to.
 * @param deps - the live relay and the diagnostic sink.
 * @returns the async handler the web server calls per request.
 */
function answerHandlerOf(dsh: Pick<DshAdapter, "webRequestRejection">, deps: QuestionWebDeps): (req: unknown, res: unknown) => Promise<void> {
  return async (req: unknown, res: unknown): Promise<void> => {
    try {
      /** The host's verdict for this request, or undefined when it may proceed. */
      const rejection = dsh.webRequestRejection(req)
      if (rejection !== undefined) {
        writeJson(res, rejection, { ok: false, error: `mpd-roles: the request is not authenticated for ${ANSWER_PATH}` })
        return
      }
      if (methodOf(req) !== "POST") {
        writeJson(res, 405, { ok: false, error: "mpd-roles: this route accepts POST only" }, { allow: "POST" })
        return
      }
      /** The body as the request streamed it, capped before any parse. */
      const read = await readBody(req)
      if (!read.ok) {
        writeJson(res, read.status, read.status === 413
          ? { ok: false, error: `mpd-roles: the request body exceeds ${MAX_BODY_BYTES} bytes` }
          : { ok: false, error: "mpd-roles: the request body is not valid JSON" })
        return
      }
      /** The parsed, shape-validated body, or the reason the boundary refused it. */
      const body = parseAnswerBody(read.value)
      if (!body.ok) {
        writeJson(res, 400, { ok: false, error: `mpd-roles: ${body.error}` })
        return
      }
      // A POST is itself proof a client is attached, so the membership probe's `list()` refresh is
      // not an accident: the person answering is exactly who the attach gate exists for. The probe
      // runs BEFORE `answer` and separates "no such id" (404) from "this batch breaks a rule" (400).
      /** The parked row this body answers, or undefined when the id is unknown or already settled. */
      const parkedRow = deps.relay.list().find((row) => row.id === body.value.id)
      if (deps.relay.answer(body.value)) {
        writeJson(res, 200, { ok: true, answered: true })
        return
      }
      if (parkedRow === undefined) {
        writeJson(res, 404, { ok: false, error: "mpd-roles: no pending question has that id" })
        return
      }
      // A KNOWN id whose batch was refused: the reason line names the ONE rule that failed.
      writeJson(res, 400, { ok: false, error: "mpd-roles: " + refusalLineOf(answerRefusalOf(parkedRow, body.value.answers)) })
    } catch (error) {
      warnLine(deps, `route ${ANSWER_PATH} failed: ${messageOf(error)}`)
      try {
        writeJson(res, 500, { ok: false, error: "mpd-roles: the request could not be completed" })
      } catch {
        // the response is already gone; nothing left to write and nothing left to throw
      }
    }
  }
}

/**
 * Mount both question routes against whatever web server this composition exposes right now.
 *
 * The first attempt runs at apply; a server that binds LATER is picked up by
 * `dsh.onServiceBound(["webServer", "httpServer"], …)`, and the retry is idempotent PER SERVER
 * OBJECT: a rebind onto the same server never registers a route twice, while a REPLACED server
 * object (Cordis swapping the service) gets its own registration. A composition with NO web server
 * (a headless profile) mounts nothing, calls no effect and throws nothing.
 *
 * @param dsh - the adapter; the server, the fence and the binding event all come through it.
 * @param effect - the row's `ctx.effect`; undefined means the routes would have no lifetime, so none
 * are registered.
 * @param deps - the live relay and the diagnostic sink.
 * @returns whether both routes are mounted on the CURRENT server after this call; false when no
 * server is bound yet, even if an earlier one carried both routes.
 */
export function registerQuestionWeb(dsh: QuestionWebAdapter, effect: QuestionEffect | undefined, deps: QuestionWebDeps): boolean {
  /**
   * The paths already registered ON EACH SERVER OBJECT, so a REPLACED server gets its own
   * registration while the SAME object is never registered twice. Keyed weakly because a host that
   * swaps its `webServer` service must stay able to collect the object it replaced.
   */
  const mountedByServer = new WeakMap<WebServerLike, Set<string>>()
  /** The host's web server as it exists right now, or undefined when it does not (yet). */
  const serverOf = (): WebServerLike | undefined => {
    try {
      /** The adapter's tolerant probe; a non-server answer reads as "not bound yet". */
      const server = dsh.webServerOf() as Partial<WebServerLike> | undefined
      return server !== undefined && server !== null && typeof server.register === "function" ? (server as WebServerLike) : undefined
    } catch {
      return undefined
    }
  }
  /** One route this module mounts. */
  const routes: ReadonlyArray<QuestionRoute> = [
    { path: QUESTIONS_PATH, handler: listHandlerOf(dsh, deps) },
    { path: ANSWER_PATH, handler: answerHandlerOf(dsh, deps) },
  ]
  /** Mount the routes that are still missing; true only when every route is mounted. */
  const attempt = (): boolean => {
    /** The server this attempt registers on, or undefined when the service is not bound. */
    const server = serverOf()
    // NO SERVER, NO MOUNT: a registration on a PREVIOUS server object says nothing about this
    // attempt, so it reports failure instead of a stale success.
    if (server === undefined) return false
    if (typeof effect !== "function") return false
    /** The paths already mounted on THIS server object; a replacement object starts with none. */
    const mounted = mountedByServer.get(server) ?? new Set<string>()
    mountedByServer.set(server, mounted)
    for (const route of routes) {
      if (mounted.has(route.path)) continue
      try {
        // The effect OWNS the registration: disposing the row disposes the route.
        effect(() => server.register({ kind: "exact", path: route.path, handler: route.handler }))
        mounted.add(route.path)
      } catch (error) {
        warnLine(deps, `registering ${route.path} failed: ${messageOf(error)}`)
      }
    }
    return mounted.size === QUESTION_ROUTES.length
  }
  /** Whether both routes mounted on the first attempt, reported to the row for its boot line. */
  const first = attempt()
  try {
    // `internal/service` is the FRAMEWORK's own binding event, reached through the adapter; a row
    // whose web server starts after it is still able to register its routes.
    dsh.onServiceBound(["webServer", "httpServer"], (): void => {
      attempt()
    })
  } catch (error) {
    // an adapter without the seam keeps the single attempt above; the routes it mounted stay answerable
    warnLine(deps, "the web-server binding subscription is unavailable: " + messageOf(error))
  }
  return first
}
