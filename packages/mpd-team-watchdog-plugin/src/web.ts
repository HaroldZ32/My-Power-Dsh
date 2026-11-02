// The watchdog's WEB surface: two FENCED, MUTATING routes that let a web/mobile client pause and
// resume MPD dispatch for ONE team without a tool call.
//
//   POST /plugins/mpd-team-watchdog/hold    {"teamId": string, "reason"?: string, "ttlMs"?: number}
//   POST /plugins/mpd-team-watchdog/resume  {"teamId": string}
//
// WHY THE SHAPE IS WHAT IT IS (each half is a binding rule, not taste):
//   * the server is read through the ADAPTER (`dsh.webServerOf()`), never `ctx.get("webServer")`,
//     because the adapter is the one file allowed to see a harness service name;
//   * every registration is owned by the row's effect, so a disposed row takes its routes with it,
//     and a late-binding server is retried through `dsh.onServiceBound`;
//   * the host fence (`dsh.webRequestRejection`) runs BEFORE the method guard, the body read, the
//     workspace resolution and the mutation — a refused request must never reach the hold store, and
//     the fence is FAIL-CLOSED by design (an absent Connection service answers 401);
//   * the method guard is this module's own: the team-web helper has none, and these routes MUTATE,
//     so a GET must never fall through to a write;
//   * the body is capped at 64 KiB and parsed ONCE at the boundary, so no interior code re-validates;
//   * no handler throws: every failure becomes `{ok:false,error}` with a message that never carries a
//     filesystem path.
//
// WORKSPACE RESOLUTION IS AGENTLESS. A route request carries no agent exec, so the workspace comes
// from the adapter's documented agentless form: the union of live session roots when it is
// unambiguous (`workspaceRootsAll()`), and the env -> process.cwd() form (`workspaceRoot()`) when no
// session is registered. A host that serves SEVERAL live workspaces cannot attribute a body-only
// request to one of them, so it answers 400 rather than mutating a guessed root.
import type { DshAdapter } from "../../mpd-dsh-adapter-plugin/src/index.js"
import { applyHold, applyResume } from "./actions.js"
import type { HoldRegistry } from "./holds.js"

/** The hold route: pause NEW dispatch into one team. The client half is written against this path. */
export const HOLD_PATH = "/plugins/mpd-team-watchdog/hold"

/** The resume route: clear one team's hold; a team that is not held is a 200 no-op. */
export const RESUME_PATH = "/plugins/mpd-team-watchdog/resume"

/** Every route this module registers, so a reader and a test can enumerate them from one place. */
export const WATCHDOG_ROUTES: readonly string[] = [HOLD_PATH, RESUME_PATH]

/** The largest request body this surface accepts; anything larger is refused with 413 unparsed. */
export const MAX_BODY_BYTES = 64 * 1024

/** The row's effect seam: it hands the host a disposer-producing callback and returns its handle. */
export type WatchdogEffect = (register: () => unknown) => unknown

/** What the web surface needs from the row beyond the adapter; nothing here is a harness service. */
export interface WatchdogWebDeps {
  /** The team state directory the hold sidecars live under (the row's resolved `stateDir`). */
  stateDir: string
  /** The synchronous hold reader the dispatch gates consult; omitted in a bare unit test. */
  registry?: HoldRegistry
  /** The resolved `holdTtlMs` a hold created without an explicit `ttlMs` inherits; 0 means none. */
  holdTtlMs?: () => number
  /** A bounded diagnostic sink; the route itself never prints. */
  warn?: (line: string) => void
}

/** The response surface a route handler may rely on, structurally typed. */
interface RouteResponse {
  /** Write the status line and the headers. */
  writeHead: (status: number, headers: Record<string, string>) => void
  /** Write the body (or close the response with none). */
  end: (body?: string) => void
}

/** The request surface this module reads: the verb, the headers the fence inspects, the body stream. */
interface RouteRequest {
  /** The HTTP verb; anything but POST is answered 405 before any read. */
  method?: unknown
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

/** One JSON answer a mutation route produces. */
interface RouteAnswer {
  /** The HTTP status to answer. */
  status: number
  /** The JSON body; a success carries `ok: true`, every failure `ok: false` plus an `error`. */
  body: unknown
}

/** One parsed body, or the precise reason a field was refused (400 with that reason). */
type ParsedBody<Value> = { ok: true; value: Value } | { ok: false; error: string }

/** The validated hold body: `teamId` required, the two tuning fields optional. */
interface HoldBody {
  /** The team to hold; already trimmed and known non-empty. */
  teamId: string
  /** Why the hold was raised; `applyHold` defaults it to `silence`. */
  reason?: string
  /** T-17 auto-release bound in ms; `0` means no TTL. */
  ttlMs?: number
}

/** The validated resume body: only the team whose hold to clear. */
interface ResumeBody {
  /** The team to resume; already trimmed and known non-empty. */
  teamId: string
}

/** The outcome of reading a request body, before any field is validated. */
type BodyRead = { ok: true; value: unknown } | { ok: false; status: 400 | 413 }

/** One body chunk as bytes: a Buffer/Uint8Array is already bytes, a string is encoded here. */
const encoder = new TextEncoder()

/** Decode the joined body ONCE, so a multi-byte character split across chunks still round-trips. */
const decoder = new TextDecoder()

/** One thrown value as text; a non-Error is stringified rather than dropped. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Report one diagnostic through the row sink, contained: a broken sink must not fail a request. */
function warnLine(deps: WatchdogWebDeps, line: string): void {
  try {
    deps.warn?.(line)
  } catch {
    // the diagnostic sink is best effort; the response path stays intact
  }
}

/**
 * Read one request body under the 64 KiB cap.
 *
 * @param request - the route's request, treated as a stream because that is all this module needs.
 * @returns the parsed JSON value, or the status the route must answer (400 unreadable/unparsable,
 * 413 over the cap).
 */
async function readBody(request: unknown): Promise<BodyRead> {
  /** The request narrowed to the streaming surface; a non-Node request simply fails the probe below. */
  const req = request as Partial<RouteRequest> | undefined
  if (req === undefined || typeof req[Symbol.asyncIterator] !== "function") return { ok: false, status: 400 }
  /** The body chunks as bytes, kept separate until the whole body is decoded once. */
  const parts: Uint8Array[] = []
  /** Byte length accumulated so far; the 413 bound is measured on BYTES, not UTF-16 units. */
  let size = 0
  for await (const chunk of req as RouteRequest) {
    /** One chunk as bytes; a non-string non-buffer chunk is stringified like the workmate route does. */
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

/** Validate the hold body at the boundary: a blank team id and a mistyped tuning field are 400s. */
function parseHoldBody(body: unknown): ParsedBody<HoldBody> {
  /** The body as a plain object, or undefined when it is not one. */
  const record = recordOf(body)
  if (record === undefined) return { ok: false, error: "the request body must be a JSON object" }
  /** The trimmed team id, empty when absent or mistyped. */
  const teamId = typeof record.teamId === "string" ? record.teamId.trim() : ""
  if (teamId === "") return { ok: false, error: "teamId must be a non-empty string" }
  if (record.reason !== undefined && typeof record.reason !== "string") return { ok: false, error: "reason must be a string when present" }
  if (record.ttlMs !== undefined && !(typeof record.ttlMs === "number" && Number.isFinite(record.ttlMs) && record.ttlMs >= 0)) {
    return { ok: false, error: "ttlMs must be a finite number >= 0 when present" }
  }
  return { ok: true, value: { teamId, reason: record.reason, ttlMs: record.ttlMs } }
}

/** Validate the resume body at the boundary: only a non-empty team id is meaningful. */
function parseResumeBody(body: unknown): ParsedBody<ResumeBody> {
  /** The body as a plain object, or undefined when it is not one. */
  const record = recordOf(body)
  if (record === undefined) return { ok: false, error: "the request body must be a JSON object" }
  /** The trimmed team id, empty when absent or mistyped. */
  const teamId = typeof record.teamId === "string" ? record.teamId.trim() : ""
  if (teamId === "") return { ok: false, error: "teamId must be a non-empty string" }
  return { ok: true, value: { teamId } }
}

/**
 * The workspace a BODY-ONLY mutation belongs to, resolved through the adapter's agentless form.
 *
 * Precedence: exactly ONE live session root wins; with NO live session the adapter's env ->
 * process.cwd() root answers. A host serving SEVERAL live workspaces cannot attribute a request
 * that names no session, so it refuses instead of mutating a guessed root — the same discipline
 * `workspaceForRequest` applies in `mpd-team-core` for a session it cannot resolve.
 *
 * @param dsh - the adapter whose two workspace readers are used.
 * @returns the absolute workspace root the mutation belongs to.
 * @throws Error when no single workspace can be attributed; the route maps it to 400.
 */
function workspaceForRequest(dsh: DshAdapter): string {
  /** The distinct live session roots, in the adapter's registration order. */
  const live = new Set<string>()
  try {
    for (const root of dsh.workspaceRootsAll() ?? []) {
      if (typeof root === "string" && root !== "") live.add(root)
    }
  } catch {
    // an absent agent registry IS the agentless case, resolved by the process-level reader below
  }
  if (live.size === 1) return [...live][0]
  if (live.size > 1) throw new Error("this host serves several workspaces and the request names none")
  /** The agentless root: `DSH_WORKSPACE_ROOT`, then the dsh process cwd. */
  let root = ""
  try {
    root = dsh.workspaceRoot()
  } catch {
    root = ""
  }
  if (typeof root !== "string" || root === "") throw new Error("no workspace root is resolvable")
  return root
}

/**
 * Build one mutation handler: fence, method guard, capped body, workspace, mutation, answer.
 *
 * THE ORDER IS THE CONTRACT. The fence runs first and returns before anything else; only an admitted
 * POST reaches the stream. A throw anywhere — from the fence, the stream, the resolver or the store —
 * becomes a JSON answer, so a route never throws into the host.
 *
 * @param dsh - the adapter the fence is delegated to.
 * @param path - the exact route path, used in messages so a log names the route that refused.
 * @param deps - the row's diagnostic sink, used by the contained failure path.
 * @param parse - the boundary parser for this route's body.
 * @param mutate - the store operation, run only after every check passed.
 * @returns the async handler the web server calls per request.
 */
function handlerFor<Value>(
  dsh: DshAdapter,
  path: string,
  deps: WatchdogWebDeps,
  parse: (body: unknown) => ParsedBody<Value>,
  mutate: (workspace: string, body: Value) => RouteAnswer,
): (req: unknown, res: unknown) => Promise<void> {
  return async (req: unknown, res: unknown): Promise<void> => {
    /** The response, narrowed to the write surface a one-shot JSON route may use. */
    const out = res as RouteResponse
    /** Answer one JSON response with the shared wire headers. */
    const json = (status: number, body: unknown, headers: Record<string, string> = {}): void => {
      out.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers })
      out.end(JSON.stringify(body))
    }
    try {
      // THE FENCE RUNS BEFORE ANY WORK: a refused request never reaches the method guard, the body
      // stream, the workspace resolution or the hold store.
      /** The host's verdict for this request, or undefined when it may proceed. */
      const rejection = dsh.webRequestRejection(req)
      if (rejection !== undefined) {
        json(rejection, { ok: false, error: `mpd-team-watchdog: the request is not authenticated for ${path}` })
        return
      }
      // OUR OWN METHOD GUARD, before the body: these two routes MUTATE state, and the shared team-web
      // helper has no guard of its own, so a GET must be refused here rather than fall through.
      if ((req as { method?: unknown } | undefined)?.method !== "POST") {
        json(405, { ok: false, error: "mpd-team-watchdog: this route accepts POST only" }, { allow: "POST" })
        return
      }
      /** The body as the request streamed it, capped before any parse. */
      const read = await readBody(req)
      if (!read.ok) {
        json(
          read.status,
          {
            ok: false,
            error:
              read.status === 413
                ? `mpd-team-watchdog: the request body exceeds ${MAX_BODY_BYTES} bytes`
                : "mpd-team-watchdog: the request body is not valid JSON",
          },
        )
        return
      }
      /** The parsed, validated body, or the reason the boundary refused it. */
      const body = parse(read.value)
      if (!body.ok) {
        json(400, { ok: false, error: `mpd-team-watchdog: ${body.error}` })
        return
      }
      /** The workspace this mutation belongs to; a request that cannot be tied to one is a 400. */
      let workspace = ""
      try {
        workspace = workspaceForRequest(dsh)
      } catch {
        json(400, { ok: false, error: "mpd-team-watchdog: the request cannot be attributed to one workspace" })
        return
      }
      /** The store's answer, produced only after every check above passed. */
      const answer = mutate(workspace, body.value)
      json(answer.status, answer.body)
    } catch (error) {
      // NEVER THROW OUT OF A HANDLER: an unreadable stream, a throwing fence or a failing store is a
      // payload. The detail goes to the row log; the CLIENT message carries no filesystem path.
      warnLine(deps, `route ${path} failed: ${messageOf(error)}`)
      try {
        json(500, { ok: false, error: "mpd-team-watchdog: the request could not be completed" })
      } catch {
        // the response is already gone; nothing left to write and nothing left to throw
      }
    }
  }
}

/**
 * Mount the two routes against whatever web server this composition exposes right now.
 *
 * The first attempt runs at apply; a server that binds LATER is picked up by
 * `dsh.onServiceBound(["webServer", "httpServer"], ...)`, and the retry is idempotent PER SERVER
 * OBJECT: a rebind onto the same server never registers a route twice, while a REPLACED server
 * object (Cordis swapping the service) gets its own registration. A composition with NO web server
 * (a headless profile) mounts nothing, calls no effect and throws nothing: the row stays tool-only.
 *
 * @param dsh - the adapter; the server, the fence and the binding event all come through it.
 * @param effect - the row's `ctx.effect`; undefined means the routes would have no lifetime, so none
 * are registered.
 * @param deps - the state directory, the hold registry and the diagnostic sink.
 * @returns whether both routes are mounted on the CURRENT server after this call; false when no
 * server is bound yet, even if an earlier one carried both routes.
 */
export function registerWatchdogWeb(dsh: DshAdapter, effect: WatchdogEffect | undefined, deps: WatchdogWebDeps): boolean {
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
  /** The hold mutation: persist the sidecar and report the narrowed answer under `ok:true`. */
  const hold = (workspace: string, body: HoldBody): RouteAnswer => {
    /** The TTL a hold created without an explicit one inherits; 0 when the provider fails. */
    let fallbackTtl = 0
    try {
      fallbackTtl = deps.holdTtlMs?.() ?? 0
    } catch {
      fallbackTtl = 0
    }
    /** The persistence outcome; `path` is deliberately not echoed on failure. */
    const applied = applyHold(workspace, deps.stateDir, { team_id: body.teamId, cause: body.reason, ttl_ms: body.ttlMs }, deps.registry, fallbackTtl)
    if (!applied.applied) {
      // A caller must never announce a pause that did not land (design §7): the detail is logged,
      // the client gets a generic 500, and no filesystem path crosses the wire.
      warnLine(deps, `the hold for ${body.teamId} was not persisted: ${applied.error ?? "unknown error"}`)
      return { status: 500, body: { ok: false, error: "mpd-team-watchdog: the hold could not be persisted" } }
    }
    // THE WIRE SHAPE IS NARROWER THAN THE STORE'S (CodeRabbit, security): `applyHold` also returns
    // the sidecar's absolute filesystem `path`, which a client has no use for and which must never
    // leave the server. The three kept fields are the ones a consumer reads — the verdict, already
    // proven true by the guard above, the durable record, and whether the write changed the file.
    return { status: 200, body: { ok: true, hold: { applied: true, hold: applied.hold, changed: applied.changed } } }
  }
  /** The resume mutation: a not-held team is the documented 200 no-op, a failed clear is a 500. */
  const resume = (workspace: string, body: ResumeBody): RouteAnswer => {
    /** The clear outcome; `resumed:false` with reason `not-held` is a success, not an error (AC-8). */
    const cleared = applyResume(workspace, deps.stateDir, { team_id: body.teamId }, deps.registry)
    if (cleared.resumed || cleared.reason === "not-held") return { status: 200, body: { ok: true, resumed: cleared.resumed } }
    warnLine(deps, `the hold for ${body.teamId} was not cleared: ${cleared.reason ?? "unknown reason"}`)
    return { status: 500, body: { ok: false, error: "mpd-team-watchdog: the hold could not be cleared" } }
  }
  /** One route this module mounts. */
  const routes: ReadonlyArray<{ path: string; handler: (req: unknown, res: unknown) => Promise<void> }> = [
    { path: HOLD_PATH, handler: handlerFor(dsh, HOLD_PATH, deps, parseHoldBody, hold) },
    { path: RESUME_PATH, handler: handlerFor(dsh, RESUME_PATH, deps, parseResumeBody, resume) },
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
    return mounted.size === WATCHDOG_ROUTES.length
  }
  /** Whether both routes mounted on the first attempt, reported to the caller for its boot line. */
  const first = attempt()
  try {
    // `internal/service` is the FRAMEWORK's own binding event, reached through the adapter; a row
    // whose web server starts after it is still able to register its routes.
    dsh.onServiceBound(["webServer", "httpServer"], () => {
      attempt()
    })
  } catch (error) {
    // an adapter without the seam keeps the single attempt above; the routes it mounted stay answerable
    warnLine(deps, "the web-server binding subscription is unavailable: " + messageOf(error))
  }
  return first
}
