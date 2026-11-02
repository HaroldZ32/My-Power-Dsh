// THE QUESTION ROUTES' ARMS: two FENCED endpoints — a read (`GET …/questions`) and a mutation
// (`POST …/questions/answer`) — that let any client answer `ask_user_question` without a DSH
// surface attached.
//
// WHAT THESE LOCK OUT, each one a contract point of plan §4.3 and the watchdog's route discipline:
//   * registration is effect-owned, exact-path, and idempotent PER SERVER OBJECT, so a rebind never
//     double-registers and a REPLACED server object gets its own registration;
//   * the host fence answers FIRST (401/403) — a refused request never reaches the method guard or
//     the body stream, which the `read` counters below PROVE rather than assume;
//   * the module's own method guard answers 405 WITH `allow`, in both directions;
//   * the body cap is 64 KiB measured on bytes (413 above it), a malformed body is 400, an unknown id
//     is 404, and an unknown label is 400 while the question STAYS parked for a correct retry;
//   * no handler throws, no reply carries a path-shaped key or an absolute path, and every reply is
//     `cache-control: no-store`.
import { afterEach, describe, expect, test } from "bun:test"
import type { DshQuestionAnswer, DshQuestionItem } from "../../mpd-dsh-adapter-plugin/src/index"
import {
  ANSWER_PATH,
  MAX_BODY_BYTES,
  QUESTIONS_PATH,
  QUESTION_ROUTES,
  createQuestionRelay,
  registerQuestionWeb,
  type PendingQuestion,
  type QuestionEffect,
  type QuestionRelay,
  type QuestionWebDeps,
} from "../src/question-relay.ts"

/** One well-formed question set the parked questions carry; its labels are what answers validate. */
const QUESTIONS: DshQuestionItem[] = [
  { id: "scope", question: "Which scope should the wave cover?", options: [{ label: "Guard only" }, { label: "Guard and prompt" }] },
]

/** The relays this file created, disposed after every arm so no park timer outlives the file. */
const relays: QuestionRelay[] = []

/**
 * Create a relay for one arm and remember it for `afterEach` disposal.
 *
 * @param options - the relay's tuning knobs, when an arm needs non-default timing.
 * @returns the relay under test.
 */
function relayFor(options: Parameters<typeof createQuestionRelay>[0] = {}): QuestionRelay {
  /** The relay this arm uses. */
  const relay = createQuestionRelay(options)
  relays.push(relay)
  return relay
}

afterEach(() => {
  for (const relay of relays.splice(0)) relay.dispose()
})

/** Wait one macrotask, so a `handle` call's own microtasks have run before the arm inspects the lot. */
async function tick(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0)
  })
}

/**
 * Park one question on the relay and return the handle a client answers with.
 *
 * @param relay - the relay to park on.
 * @param sessionId - the session the question belongs to, when the arm filters by one.
 * @returns the parked id, the pending handle promise and the harness's original rejection.
 */
async function park(relay: QuestionRelay, sessionId?: string): Promise<{ id: string; pending: Promise<DshQuestionAnswer[]>; original: Error }> {
  // The poll IS the attach gate: without it the relay refuses to park (plan §4.3).
  relay.list()
  /** The harness rejection that makes the request parkable. */
  const original: Error = Object.assign(new Error("no user-questions answerer"), { code: "NO_PROVIDER" })
  /** The pending handle promise the route will settle. */
  const pending = relay.handle({ questions: QUESTIONS, ...(sessionId === undefined ? {} : { sessionId }) }, () => Promise.reject(original))
  // Observed from the start, so a park that an arm never answers cannot surface as unhandled.
  pending.catch(() => undefined)
  await tick()
  /** The parked rows, newest last; the last one is the question this helper parked. */
  const rows = relay.list()
  return { id: rows[rows.length - 1].id, pending, original }
}

/** One captured route registration from the web-server double. */
interface CapturedRoute {
  /** The registration kind; both question routes are exact matches. */
  kind: string
  /** The exact path the host would match. */
  path: string
  /** The handler the host calls once per request. */
  handler: (req: unknown, res: unknown) => unknown
}

/** A web-server double that records every registration and hands back a disposer. */
interface ServerDouble {
  /** The registrations, in mount order. */
  routes: CapturedRoute[]
  /** Register one route; the double records it and disposes nothing. */
  register: (route: CapturedRoute) => () => void
}

/** Build one web-server double. */
function serverDouble(): ServerDouble {
  /** The registrations this double has recorded so far. */
  const routes: CapturedRoute[] = []
  return {
    routes,
    register: (route: CapturedRoute): (() => void) => {
      routes.push(route)
      return () => {}
    },
  }
}

/** The adapter members these routes read; every other member is absent by the cast in {@link adapterFor}. */
interface AdapterParts {
  /** The web-server probe's answer; a FUNCTION is called per probe for a late-binding arm. */
  server?: unknown | (() => unknown)
  /** The host fence; the default admits every request. */
  rejection?: (req: unknown) => 401 | 403 | undefined
  /** The binding callbacks `onServiceBound` captured, so an arm can simulate a late bind. */
  bound?: Array<(name: string) => void>
}

/** The adapter surface {@link registerQuestionWeb} takes, so the double casts to exactly it. */
type WebAdapter = Parameters<typeof registerQuestionWeb>[0]

/** Build the adapter double; only the members above are read by this surface. */
function adapterFor(parts: AdapterParts): WebAdapter {
  /** The double, shaped as exactly the adapter members this module touches. */
  const adapter = {
    webServerOf: (): unknown => (typeof parts.server === "function" ? (parts.server as () => unknown)() : parts.server),
    webRequestRejection: (req: unknown): 401 | 403 | undefined => (parts.rejection === undefined ? undefined : parts.rejection(req)),
    onServiceBound: (_names: readonly string[], callback: (name: string) => void): (() => void) => {
      parts.bound?.push(callback)
      return () => {}
    },
  }
  // The cast is the fixture's contract: the routes read these three members and nothing else.
  return adapter as unknown as WebAdapter
}

/** One request double: an async body stream plus the verb, url and headers a route reads. */
interface RequestDouble {
  /** The HTTP verb under test. */
  method: string
  /** The request URL, which the GET route reads for its `?sessionId=` filter. */
  url: string
  /** The headers, passed through to the fence double. */
  headers: Record<string, string>
  /** How many chunks the body stream has yielded, so an arm can prove a body was NOT read. */
  read: { chunks: number }
  /** The async-iterable body surface a Node request exposes. */
  [Symbol.asyncIterator]: () => AsyncIterator<unknown>
}

/**
 * Build one request double.
 *
 * @param method - the HTTP verb.
 * @param body - the body text, absent for a request with no body.
 * @param url - the request URL; defaults to the GET path.
 * @returns the request double, with a `read` counter the fence/method arms assert on.
 */
function requestDouble(method: string, body?: string, url: string = QUESTIONS_PATH): RequestDouble {
  /** The read counter, incremented by each yielded chunk. */
  const read = { chunks: 0 }
  return {
    method,
    url,
    headers: {},
    read,
    // An async generator is the shape a Node request exposes to `for await (const chunk of req)`.
    async *[Symbol.asyncIterator](): AsyncGenerator<unknown, void, unknown> {
      if (body !== undefined) {
        read.chunks += 1
        yield body
      }
    },
  }
}

/** One captured response, filled by the double below. */
interface CapturedResponse {
  /** The status line, or 0 when the handler never wrote one. */
  status: number
  /** The headers written with the status line. */
  headers: Record<string, string>
  /** The parsed JSON body, or undefined when the handler wrote none. */
  body: unknown
}

/** A response double that captures the status, the headers and the parsed JSON body. */
function responseDouble(): { res: { writeHead: (status: number, headers: Record<string, string>) => void; end: (body?: string) => void }; captured: CapturedResponse } {
  /** The captured fields, mutated by the double's two methods. */
  const captured: CapturedResponse = { status: 0, headers: {}, body: undefined }
  return {
    captured,
    res: {
      writeHead: (status: number, headers: Record<string, string>): void => {
        captured.status = status
        captured.headers = headers
      },
      end: (body?: string): void => {
        captured.body = body === undefined || body === "" ? undefined : JSON.parse(body)
      },
    },
  }
}

/** The captured route at one path; the arm asserts it was registered rather than assuming an order. */
function routeAt(server: ServerDouble, path: string): CapturedRoute {
  /** The matching registration, or undefined when the route was never mounted. */
  const found = server.routes.find((route) => route.path === path)
  expect(found).toBeDefined()
  return found as CapturedRoute
}

/** Drive one captured route with one request and return what the handler wrote. */
async function invoke(route: CapturedRoute, req: unknown): Promise<CapturedResponse> {
  /** The response the handler writes into. */
  const { res, captured } = responseDouble()
  await route.handler(req, res)
  return captured
}

/** Every property NAME in one JSON value at any depth, so a leaked field cannot hide in a nested object. */
function propertyNamesDeep(value: unknown): string[] {
  /** The names collected so far, in walk order. */
  const names: string[] = []
  /** Walk one JSON value: an object contributes its keys and recurses, an array only recurses. */
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item)
      return
    }
    if (node === null || typeof node !== "object") return
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      names.push(key)
      walk(child)
    }
  }
  walk(value)
  return names
}

/** Every STRING value in one JSON value at any depth. */
function stringValuesDeep(value: unknown): string[] {
  /** The strings collected so far, in walk order. */
  const values: string[] = []
  /** Walk one JSON value: a string is collected, an array/object recurses. */
  const walk = (node: unknown): void => {
    if (typeof node === "string") {
      values.push(node)
      return
    }
    if (Array.isArray(node)) {
      for (const item of node) walk(item)
      return
    }
    if (node === null || typeof node !== "object") return
    for (const child of Object.values(node as Record<string, unknown>)) walk(child)
  }
  walk(value)
  return values
}

/** Property names that would mean an internal filesystem location leaked into a reply. */
const PATH_KEYS = new Set(["path", "file", "filepath", "dir", "directory", "root", "cwd", "workspace", "workspaceroot"])

/**
 * Assert one reply carries no path-shaped key and no absolute-path-shaped string.
 *
 * @param reply - the parsed JSON reply to walk.
 */
function expectNoPath(reply: unknown): void {
  expect(propertyNamesDeep(reply).filter((name) => PATH_KEYS.has(name.toLowerCase()))).toEqual([])
  for (const text of stringValuesDeep(reply)) {
    expect(text.startsWith("/")).toBe(false)
    expect(/^[A-Za-z]:[\\/]/.test(text)).toBe(false)
  }
}

/** One mounted surface: the server double and the relay the routes read. */
interface Mounted {
  /** The registrations captured by the server double. */
  server: ServerDouble
  /** The live relay both routes use. */
  relay: QuestionRelay
  /** How many registrations the row's effect seam has owned. */
  effects: { count: number }
}

/**
 * Mount both routes against a fake server over one fresh relay.
 *
 * @param deps - overrides, e.g. a throwing relay for the contained-failure arm.
 * @param parts - adapter overrides, e.g. a fence verdict.
 * @returns the mounted surface the arms drive.
 */
function mount(deps: Partial<QuestionWebDeps> = {}, parts: Partial<AdapterParts> = {}): Mounted {
  /** The server double the routes register on. */
  const server = serverDouble()
  /** The adapter over that server. */
  const adapter = adapterFor({ server, ...parts })
  /** The live count of effect-owned registrations. */
  const effects = { count: 0 }
  /** The row's effect seam: it runs the registration and counts the lifetime it owns. */
  const effect: QuestionEffect = (register: () => unknown): unknown => {
    effects.count += 1
    return register()
  }
  /** The relay both routes read unless an arm overrides it. */
  const relay = deps.relay ?? relayFor()
  registerQuestionWeb(adapter, effect, { relay, ...deps })
  return { server, relay, effects }
}

describe("registration", () => {
  test("mounts BOTH exact routes through the adapter probe and the row's effect", () => {
    /** The mounted surface. */
    const mounted = mount()
    expect(mounted.server.routes.map((route) => route.path)).toEqual([...QUESTION_ROUTES])
    expect(mounted.server.routes.map((route) => route.kind)).toEqual(["exact", "exact"])
    expect(mounted.effects.count).toBe(QUESTION_ROUTES.length)
    // The paths ARE the fixed contract the client half is written against, not an implementation detail.
    expect(QUESTION_ROUTES).toEqual(["/plugins/mpd-roles/questions", "/plugins/mpd-roles/questions/answer"])
    expect(ANSWER_PATH).toBe("/plugins/mpd-roles/questions/answer")
    expect(QUESTIONS_PATH).toBe("/plugins/mpd-roles/questions")
  })

  test("the negative control: no web server means no route, no effect and no throw", () => {
    /** The adapter pieces for a host with no web plane; the binding list records the retry hookup. */
    const parts: AdapterParts = { server: undefined, bound: [] }
    /** The adapter double over an unbound web server. */
    const adapter = adapterFor(parts)
    /** How many registrations the row's effect seam owned. */
    let effects = 0
    /** The registration outcome: nothing mounted, and the call itself never throws. */
    const mounted = registerQuestionWeb(adapter, (register: () => unknown): unknown => {
      effects += 1
      return register()
    }, { relay: relayFor() })
    expect(mounted).toBe(false)
    expect(effects).toBe(0)
    // The retry subscription is still installed: a server that binds later must still be able to mount.
    expect(parts.bound?.length).toBe(1)
  })

  test("retries through onServiceBound when the web server binds LATER, without double-registering", () => {
    /** The server double that only becomes visible after the flag flips. */
    const server = serverDouble()
    /** The binding callbacks `registerQuestionWeb` installed. */
    const bound: Array<(name: string) => void> = []
    /** Whether the host has bound its web server yet. */
    let boundNow = false
    /** The adapter whose probe answers `undefined` until the flag flips. */
    const adapter = adapterFor({ server: () => (boundNow ? server : undefined), bound })
    /** How many registrations the row's effect seam owned across both attempts. */
    let effects = 0
    /** The row's effect seam, shared by the first attempt and the retry. */
    const effect: QuestionEffect = (register: () => unknown): unknown => {
      effects += 1
      return register()
    }
    expect(registerQuestionWeb(adapter, effect, { relay: relayFor() })).toBe(false)
    expect(server.routes.length).toBe(0)
    // The service binds late: the adapter's binding event must mount the routes now.
    boundNow = true
    for (const callback of bound) callback("webServer")
    expect(server.routes.map((route) => route.path)).toEqual([...QUESTION_ROUTES])
    expect(effects).toBe(QUESTION_ROUTES.length)
    // A REBIND must not register the same exact path twice (the host refuses a duplicate).
    for (const callback of bound) callback("webServer")
    expect(server.routes.length).toBe(QUESTION_ROUTES.length)
    expect(effects).toBe(QUESTION_ROUTES.length)
  })

  test("a REPLACED web-server object gets its own registration", () => {
    /** The first server object a host exposed. */
    const first = serverDouble()
    /** The replacement server object, after the host swapped its service. */
    const second = serverDouble()
    /** The binding callbacks the module installed. */
    const bound: Array<(name: string) => void> = []
    /** The server the probe currently answers with. */
    let current: ServerDouble = first
    /** The adapter over the swappable probe. */
    const adapter = adapterFor({ server: () => current, bound })
    /** The row's effect seam, counting lifetime ownership. */
    const effect: QuestionEffect = (register: () => unknown): unknown => register()
    expect(registerQuestionWeb(adapter, effect, { relay: relayFor() })).toBe(true)
    expect(first.routes.length).toBe(QUESTION_ROUTES.length)
    current = second
    for (const callback of bound) callback("webServer")
    // The replacement object carries its OWN registrations, because the WeakMap is keyed by object.
    expect(second.routes.map((route) => route.path)).toEqual([...QUESTION_ROUTES])
  })

  test("an effect-less composition mounts nothing, even with a server bound", () => {
    /** The server double that WOULD carry the routes. */
    const server = serverDouble()
    /** The adapter over that server. */
    const adapter = adapterFor({ server })
    expect(registerQuestionWeb(adapter, undefined, { relay: relayFor() })).toBe(false)
    expect(server.routes.length).toBe(0)
  })
})

describe("the fence answers first", () => {
  test("a 401 verdict answers before the method guard and before any body read", async () => {
    /** The mounted surface with a fence that refuses everything. */
    const mounted = mount({}, { rejection: (): 401 => 401 })
    /** A POST to the GET route, carrying a body the fence must keep unread. */
    const req = requestDouble("POST", "{ not json")
    /** The answer the route wrote. */
    const reply = await invoke(routeAt(mounted.server, QUESTIONS_PATH), req)
    expect(reply.status).toBe(401)
    expect(reply.body).toMatchObject({ ok: false })
    // NEITHER the method guard (which would answer 405) NOR the body stream ran.
    expect(req.read.chunks).toBe(0)
  })

  test("a 403 verdict answers the answer route before the body is read", async () => {
    /** The mounted surface with a fence that forbids. */
    const mounted = mount({}, { rejection: (): 403 => 403 })
    /** A POST with a body the fence must keep unread. */
    const req = requestDouble("POST", JSON.stringify({ id: "q1", answers: [] }))
    /** The answer the route wrote. */
    const reply = await invoke(routeAt(mounted.server, ANSWER_PATH), req)
    expect(reply.status).toBe(403)
    expect(req.read.chunks).toBe(0)
  })
})

describe("the method guard", () => {
  test("a POST to the GET route is 405 with allow: GET", async () => {
    /** The mounted surface. */
    const mounted = mount()
    /** The refused request; it carries a body that must stay unread. */
    const req = requestDouble("POST", "{}")
    /** The answer the route wrote. */
    const reply = await invoke(routeAt(mounted.server, QUESTIONS_PATH), req)
    expect(reply.status).toBe(405)
    expect(reply.headers.allow).toBe("GET")
    expect(req.read.chunks).toBe(0)
  })

  test("a GET to the answer route is 405 with allow: POST, before the body", async () => {
    /** The mounted surface. */
    const mounted = mount()
    /** The refused request. */
    const req = requestDouble("GET", "{}")
    /** The answer the route wrote. */
    const reply = await invoke(routeAt(mounted.server, ANSWER_PATH), req)
    expect(reply.status).toBe(405)
    expect(reply.headers.allow).toBe("POST")
    expect(req.read.chunks).toBe(0)
  })
})

describe("GET /plugins/mpd-roles/questions", () => {
  test("the happy path lists every parked question, newest last", async () => {
    /** The mounted surface. */
    const mounted = mount()
    /** The first parked question, belonging to session a. */
    const first = await park(mounted.relay, "a")
    /** The second parked question, belonging to session b. */
    const second = await park(mounted.relay, "b")
    /** The answer the route wrote. */
    const reply = await invoke(routeAt(mounted.server, QUESTIONS_PATH), requestDouble("GET"))
    expect(reply.status).toBe(200)
    expect(reply.headers["cache-control"]).toBe("no-store")
    /** The parked rows the reply carries. */
    const pending = (reply.body as { pending: PendingQuestion[] }).pending
    expect(pending.map((row) => row.id)).toEqual([first.id, second.id])
    expect(pending.map((row) => row.sessionId)).toEqual(["a", "b"])
    // The wire shape is the narrow projection, never the harness request object.
    expect(Object.keys(pending[0]).sort()).toEqual(["createdAt", "id", "questions", "sessionId"])
    expectNoPath(reply.body)
  })

  test("?sessionId= narrows the list, and a blank value means no filter", async () => {
    /** The mounted surface. */
    const mounted = mount()
    /** One question per session. */
    const first = await park(mounted.relay, "a")
    /** The second session's question. */
    const second = await park(mounted.relay, "b")
    /** The narrowed answer the route wrote. */
    const narrowed = await invoke(routeAt(mounted.server, QUESTIONS_PATH), requestDouble("GET", undefined, QUESTIONS_PATH + "?sessionId=b"))
    expect((narrowed.body as { pending: PendingQuestion[] }).pending.map((row) => row.id)).toEqual([second.id])
    /** The blank-filter answer, which reports both. */
    const blank = await invoke(routeAt(mounted.server, QUESTIONS_PATH), requestDouble("GET", undefined, QUESTIONS_PATH + "?sessionId="))
    expect((blank.body as { pending: PendingQuestion[] }).pending.map((row) => row.id)).toEqual([first.id, second.id])
  })
})

describe("POST /plugins/mpd-roles/questions/answer", () => {
  test("the happy path settles the parked promise and answers answered: true", async () => {
    /** The mounted surface. */
    const mounted = mount()
    /** The parked question the route answers. */
    const parked = await park(mounted.relay)
    /** The batch a phone would send: labels only. */
    const answers: DshQuestionAnswer[] = [{ id: "scope", selected: ["Guard only"] }]
    /** The answer the route wrote. */
    const reply = await invoke(routeAt(mounted.server, ANSWER_PATH), requestDouble("POST", JSON.stringify({ id: parked.id, answers })))
    expect(reply.status).toBe(200)
    expect(reply.body).toEqual({ ok: true, answered: true })
    expect(reply.headers["cache-control"]).toBe("no-store")
    // The parked promise really settled with the validated answers.
    expect(await parked.pending).toEqual(answers)
    expect(mounted.relay.list()).toEqual([])
    expectNoPath(reply.body)
  })

  test("an unknown id is 404 and leaves every parked question alone", async () => {
    /** The mounted surface. */
    const mounted = mount()
    /** The parked question that must survive the refused call. */
    const parked = await park(mounted.relay)
    /** The answer the route wrote. */
    const reply = await invoke(routeAt(mounted.server, ANSWER_PATH), requestDouble("POST", JSON.stringify({ id: "q-unknown", answers: [{ id: "scope", selected: ["Guard only"] }] })))
    expect(reply.status).toBe(404)
    expect(reply.body).toMatchObject({ ok: false })
    expect(String((reply.body as { error: string }).error)).toContain("no pending question")
    expect(mounted.relay.list().map((row) => row.id)).toEqual([parked.id])
    expectNoPath(reply.body)
  })

  test("an unknown LABEL is 400, the entry survives, and a correct retry still settles it", async () => {
    /** The mounted surface. */
    const mounted = mount()
    /** The parked question the retry answers. */
    const parked = await park(mounted.relay)
    /** The answer route's handler, invoked twice below. */
    const route = routeAt(mounted.server, ANSWER_PATH)
    /** The refused answer the route wrote. */
    const refused = await invoke(route, requestDouble("POST", JSON.stringify({ id: parked.id, answers: [{ id: "scope", selected: ["Not an option"] }] })))
    expect(refused.status).toBe(400)
    expect(refused.body).toMatchObject({ ok: false })
    // THE QUESTION IS STILL PARKED: a typo must not destroy the request.
    expect(mounted.relay.list().map((row) => row.id)).toEqual([parked.id])
    expectNoPath(refused.body)
    /** The batch the corrected retry sends. */
    const answers: DshQuestionAnswer[] = [{ id: "scope", selected: ["Guard and prompt"] }]
    /** The answer the corrected retry wrote. */
    const accepted = await invoke(route, requestDouble("POST", JSON.stringify({ id: parked.id, answers })))
    expect(accepted.status).toBe(200)
    expect(await parked.pending).toEqual(answers)
  })

  test("a malformed JSON body is 400", async () => {
    /** The mounted surface. */
    const mounted = mount()
    /** The answer the route wrote. */
    const reply = await invoke(routeAt(mounted.server, ANSWER_PATH), requestDouble("POST", "{ this is not json"))
    expect(reply.status).toBe(400)
    expect(String((reply.body as { error: string }).error)).toContain("not valid JSON")
    expectNoPath(reply.body)
  })

  test("a body that is not a JSON object is 400", async () => {
    /** The mounted surface. */
    const mounted = mount()
    /** The answer the route wrote for an array body. */
    const reply = await invoke(routeAt(mounted.server, ANSWER_PATH), requestDouble("POST", "[1,2,3]"))
    expect(reply.status).toBe(400)
    expectNoPath(reply.body)
  })

  test("a body with no answers is 400 (nothing answered is not an answer)", async () => {
    /** The mounted surface. */
    const mounted = mount()
    /** The answer the route wrote. */
    const reply = await invoke(routeAt(mounted.server, ANSWER_PATH), requestDouble("POST", JSON.stringify({ id: "q1", answers: [] })))
    expect(reply.status).toBe(400)
    expect(String((reply.body as { error: string }).error)).toContain("answers")
  })

  test("a body over 64 KiB is 413 without a parse", async () => {
    /** The mounted surface. */
    const mounted = mount()
    /** A body ONE byte over the documented cap, padded as an unparsable string on purpose. */
    const oversized = "x".repeat(MAX_BODY_BYTES + 1)
    /** The answer the route wrote. */
    const reply = await invoke(routeAt(mounted.server, ANSWER_PATH), requestDouble("POST", oversized))
    expect(reply.status).toBe(413)
    expect(String((reply.body as { error: string }).error)).toContain(String(MAX_BODY_BYTES))
    expectNoPath(reply.body)
  })

  test("a request with no body stream is 400, not a throw", async () => {
    /** The mounted surface. */
    const mounted = mount()
    /** A request whose body is not an async iterable (a non-Node caller). */
    const req = { method: "POST", url: ANSWER_PATH, headers: {} }
    /** The answer the route wrote. */
    const reply = await invoke(routeAt(mounted.server, ANSWER_PATH), req)
    expect(reply.status).toBe(400)
  })
})

describe("a handler never throws and never leaks a path", () => {
  test("the deep no-path walk over every reply this surface can produce", async () => {
    /** The mounted surface. */
    const mounted = mount()
    /** The parked question one happy POST settles. */
    const parked = await park(mounted.relay)
    /** The routes driven below. */
    const listRoute = routeAt(mounted.server, QUESTIONS_PATH)
    /** The answer route driven below. */
    const answerRoute = routeAt(mounted.server, ANSWER_PATH)
    /** Every reply this surface produces in one arm, so the walk covers all branches. */
    const replies = [
      await invoke(listRoute, requestDouble("GET")),
      await invoke(listRoute, requestDouble("POST", "{}")),
      await invoke(answerRoute, requestDouble("GET", "{}")),
      await invoke(answerRoute, requestDouble("POST", "{ bad json")),
      await invoke(answerRoute, requestDouble("POST", JSON.stringify({ id: "missing", answers: [{ id: "scope", selected: ["Guard only"] }] }))),
      await invoke(answerRoute, requestDouble("POST", JSON.stringify({ id: parked.id, answers: [{ id: "scope", selected: ["Bad label"] }] }))),
      await invoke(answerRoute, requestDouble("POST", JSON.stringify({ id: parked.id, answers: [{ id: "scope", selected: ["Guard only"] }] }))),
    ]
    // Every reply is JSON, no-store, and free of path-shaped keys/values.
    for (const reply of replies) {
      expect(reply.status).not.toBe(0)
      expect(reply.headers["cache-control"]).toBe("no-store")
      expect(reply.headers["content-type"]).toContain("application/json")
      expectNoPath(reply.body)
    }
  })

  test("a throwing fence becomes a 500 payload, never a rejected handler", async () => {
    /** The mounted surface whose fence throws. */
    const mounted = mount({}, {
      rejection: (): 401 => {
        throw new Error("the connection service exploded")
      },
    })
    /** The answer the route wrote. */
    const reply = await invoke(routeAt(mounted.server, QUESTIONS_PATH), requestDouble("GET"))
    expect(reply.status).toBe(500)
    expect(reply.body).toMatchObject({ ok: false })
    expectNoPath(reply.body)
  })

  test("a relay whose reads throw becomes a 500 payload on both routes", async () => {
    /** A relay double that throws from both reads, proving the handler contains it. */
    const broken: QuestionRelay = {
      handle: async (): Promise<DshQuestionAnswer[]> => [],
      list: (): PendingQuestion[] => {
        throw new Error("the parking lot is broken")
      },
      answer: (): boolean => {
        throw new Error("the parking lot is broken")
      },
      dispose: (): void => {},
    }
    /** The mounted surface over the broken relay. */
    const mounted = mount({ relay: broken })
    /** The GET answer the route wrote. */
    const listed = await invoke(routeAt(mounted.server, QUESTIONS_PATH), requestDouble("GET"))
    expect(listed.status).toBe(500)
    expectNoPath(listed.body)
    /** The POST answer the route wrote. */
    const answered = await invoke(routeAt(mounted.server, ANSWER_PATH), requestDouble("POST", JSON.stringify({ id: "q1", answers: [{ id: "scope", selected: ["Guard only"] }] })))
    expect(answered.status).toBe(500)
    expectNoPath(answered.body)
  })
})
