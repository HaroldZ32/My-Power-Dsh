// THE WATCHDOG WEB ROUTES: two fenced, mutating endpoints so a web/mobile client can pause and
// resume MPD dispatch for ONE team without a tool call.
//
// WHAT THESE ARMS ARE ABOUT. The client half is being written against the paths, the verbs, the
// statuses and the JSON shape this file pins, so each arm drives the REAL stacked handler — fence,
// method guard, body cap, boundary parse, workspace resolution, store — and reads the outcome from
// the store, never from the response alone:
//   * a GET is refused with 405 + `allow: POST` on BOTH routes;
//   * an unparsable body, a blank team id and an oversized body are 400/400/413;
//   * a fence verdict answers 401 BEFORE anything is read or written;
//   * the happy path persists the durable sidecar and tells the SAME registry the tools use;
//   * a host whose web server is absent mounts nothing and throws nothing (the negative control);
//   * a host that cannot attribute the request to ONE workspace answers 400, not 500.
import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { DshAdapter } from "../../mpd-dsh-adapter-plugin/src/index.js"
import { HoldRegistry } from "../src/holds"
import { DEFAULT_STATE_DIR, holdPath } from "../src/paths"
import { HOLD_PATH, MAX_BODY_BYTES, RESUME_PATH, WATCHDOG_ROUTES, registerWatchdogWeb, type WatchdogEffect, type WatchdogWebDeps } from "../src/web"

/** The sandboxes this file created, removed after every arm. */
const sandboxes: string[] = []

/** Create one temp workspace and remember it for cleanup. */
function sandbox(): string {
  /** The fresh workspace root. */
  const dir = mkdtempSync(join(tmpdir(), "mpd-watchdog-web-"))
  sandboxes.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of sandboxes.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** One captured route registration from the web-server double. */
interface CapturedRoute {
  /** The registration kind; both watchdog routes are exact matches. */
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
  /** Live session roots, the agentless resolution's first input. */
  roots?: string[]
  /** The process-level root, the agentless resolution's fallback. */
  root?: string
  /** The binding callbacks `onServiceBound` captured, so an arm can simulate a late bind. */
  bound?: Array<(name: string) => void>
}

/** Build the adapter double; only the members above are read by this surface. */
function adapterFor(parts: AdapterParts): DshAdapter {
  /** The double, shaped as exactly the adapter members this module touches. */
  const adapter = {
    webServerOf: (): unknown => (typeof parts.server === "function" ? (parts.server as () => unknown)() : parts.server),
    webRequestRejection: (req: unknown): 401 | 403 | undefined => (parts.rejection === undefined ? undefined : parts.rejection(req)),
    workspaceRootsAll: (): string[] => parts.roots ?? [],
    workspaceRoot: (): string => parts.root ?? "",
    onServiceBound: (_names: readonly string[], callback: (name: string) => void): (() => void) => {
      parts.bound?.push(callback)
      return () => {}
    },
  }
  // The cast is the fixture's contract: the routes read these five members and nothing else.
  return adapter as unknown as DshAdapter
}

/** One request double: an async body stream plus the verb and headers a route reads. */
function requestDouble(method: string, body?: string): { method: string; headers: Record<string, string>; [Symbol.asyncIterator]: () => AsyncIterator<unknown> } {
  return {
    method,
    headers: {},
    // An async generator is the shape a Node request exposes to `for await (const chunk of req)`.
    async *[Symbol.asyncIterator](): AsyncGenerator<unknown, void, unknown> {
      if (body !== undefined) yield body
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

/** One mounted surface: the server double, the adapter the routes read, and the effect counter. */
interface Mounted {
  /** The registrations captured by the server double. */
  server: ServerDouble
  /** The adapter double the routes read. */
  adapter: DshAdapter
  /** How many registrations the row's effect seam has owned. */
  effects: { count: number }
}

/** Mount both routes against a fake server in a fresh temp workspace. */
function mount(workspace: string, deps: Partial<WatchdogWebDeps> = {}): Mounted {
  /** The server double the routes register on. */
  const server = serverDouble()
  /** The adapter over that server, with ONE live root so the workspace resolves unambiguously. */
  const adapter = adapterFor({ server, roots: [workspace] })
  /** The live count of effect-owned registrations. */
  const effects = { count: 0 }
  /** The row's effect seam: it runs the registration and counts the lifetime it owns. */
  const effect: WatchdogEffect = (register: () => unknown): unknown => {
    effects.count += 1
    return register()
  }
  registerWatchdogWeb(adapter, effect, { stateDir: DEFAULT_STATE_DIR, ...deps })
  return { server, adapter, effects }
}

describe("registration", () => {
  test("mounts BOTH exact routes through the adapter's webServerOf and the row's effect", () => {
    /** A temp workspace with no holds in it. */
    const workspace = sandbox()
    /** The mounted surface. */
    const mounted = mount(workspace)
    expect(mounted.server.routes.map((route) => route.path)).toEqual([...WATCHDOG_ROUTES])
    expect(mounted.server.routes.map((route) => route.kind)).toEqual(["exact", "exact"])
    expect(mounted.effects.count).toBe(WATCHDOG_ROUTES.length)
    // The paths ARE the fixed contract the client half is written against, not an implementation detail.
    expect(WATCHDOG_ROUTES).toEqual(["/plugins/mpd-team-watchdog/hold", "/plugins/mpd-team-watchdog/resume"])
  })

  test("the negative control: no web server means no route, no effect and no throw", () => {
    /** The adapter pieces for a host with no web plane; the binding list records the retry hookup. */
    const parts: AdapterParts = { server: undefined, roots: ["/ws"], bound: [] }
    /** The adapter double over an unbound web server. */
    const adapter = adapterFor(parts)
    /** How many registrations the row's effect seam owned. */
    let effects = 0
    /** The registration outcome: nothing mounted, and the call itself never throws. */
    const mounted = registerWatchdogWeb(adapter, (register: () => unknown): unknown => { effects += 1; return register() }, { stateDir: DEFAULT_STATE_DIR })
    expect(mounted).toBe(false)
    expect(effects).toBe(0)
    // The retry subscription is still installed: a server that binds later must still be able to mount.
    expect(parts.bound?.length).toBe(1)
  })

  test("retries through onServiceBound when the web server binds LATER, without double-registering", () => {
    /** A temp workspace the retried routes will mutate. */
    const workspace = sandbox()
    /** The server double that only becomes visible after the flag flips. */
    const server = serverDouble()
    /** The binding callbacks `registerWatchdogWeb` installed. */
    const bound: Array<(name: string) => void> = []
    /** Whether the host has bound its web server yet. */
    let boundNow = false
    /** The adapter whose probe answers `undefined` until the flag flips. */
    const adapter = adapterFor({ server: () => (boundNow ? server : undefined), roots: [workspace], bound })
    /** How many registrations the row's effect seam owned across both attempts. */
    let effects = 0
    /** The row's effect seam, shared by the first attempt and the retry. */
    const effect: WatchdogEffect = (register: () => unknown): unknown => { effects += 1; return register() }
    expect(registerWatchdogWeb(adapter, effect, { stateDir: DEFAULT_STATE_DIR })).toBe(false)
    expect(server.routes.length).toBe(0)
    // The service binds late: the adapter's binding event must mount the routes now.
    boundNow = true
    for (const callback of bound) callback("webServer")
    expect(server.routes.map((route) => route.path)).toEqual([...WATCHDOG_ROUTES])
    expect(effects).toBe(WATCHDOG_ROUTES.length)
    // A REBIND must not register the same exact path twice (the host refuses a duplicate).
    for (const callback of bound) callback("webServer")
    expect(server.routes.length).toBe(WATCHDOG_ROUTES.length)
    expect(effects).toBe(WATCHDOG_ROUTES.length)
  })

  test("a REPLACED web-server object gets its own registration, and the same object is never registered twice", () => {
    /** A temp workspace the routes would mutate if a handler ran. */
    const workspace = sandbox()
    /** The server the first attempt registers on. */
    const firstServer = serverDouble()
    /** The NEW object a host binds when it replaces the `webServer` service. */
    const replacedServer = serverDouble()
    /** The binding callbacks `registerWatchdogWeb` installed. */
    const bound: Array<(name: string) => void> = []
    /** The object `dsh.webServerOf()` answers right now; the replacement flips it. */
    let current: ServerDouble = firstServer
    /** The adapter whose probe follows that object. */
    const adapter = adapterFor({ server: (): ServerDouble => current, roots: [workspace], bound })
    /** How many registrations the row's effect seam owned across every attempt. */
    let effects = 0
    /** The row's effect seam, shared by the first attempt and every retry. */
    const effect: WatchdogEffect = (register: () => unknown): unknown => { effects += 1; return register() }
    // The FIRST server carries both routes, and the boot line is told so.
    expect(registerWatchdogWeb(adapter, effect, { stateDir: DEFAULT_STATE_DIR })).toBe(true)
    expect(firstServer.routes.map((route) => route.path)).toEqual([...WATCHDOG_ROUTES])
    // THE REPLACEMENT: a new object holds NO routes, so the retry must register BOTH on it. Tracking
    // the paths globally would skip them here and leave the live server with no route at all.
    current = replacedServer
    for (const callback of bound) callback("webServer")
    expect(replacedServer.routes.map((route) => route.path)).toEqual([...WATCHDOG_ROUTES])
    expect(effects).toBe(WATCHDOG_ROUTES.length * 2)
    // AND THE SAME OBJECT IS NEVER REGISTERED TWICE: repeating the bind adds nothing on it.
    for (const callback of bound) callback("webServer")
    expect(replacedServer.routes.length).toBe(WATCHDOG_ROUTES.length)
    expect(effects).toBe(WATCHDOG_ROUTES.length * 2)
  })
})

describe("the fence and the method guard", () => {
  test("a non-POST answers 405 with allow: POST on BOTH routes", async () => {
    /** A temp workspace the routes would mutate if they fell through. */
    const workspace = sandbox()
    /** The mounted surface. */
    const mounted = mount(workspace)
    for (const path of WATCHDOG_ROUTES) {
      /** The refusal a GET receives. */
      const captured = await invoke(routeAt(mounted.server, path), requestDouble("GET"))
      expect(captured.status).toBe(405)
      expect(captured.headers.allow).toBe("POST")
      expect((captured.body as { ok: boolean }).ok).toBe(false)
    }
    // NOTHING was written by the refused verbs.
    expect(existsSync(join(workspace, DEFAULT_STATE_DIR, "watchdog"))).toBe(false)
  })

  test("the host fence answers 401 BEFORE the body is read or the hold is written", async () => {
    /** A temp workspace whose hold file must stay absent. */
    const workspace = sandbox()
    /** The server double the routes register on. */
    const server = serverDouble()
    /** The adapter whose fence refuses every request. */
    const adapter = adapterFor({ server, roots: [workspace], rejection: () => 401 })
    registerWatchdogWeb(adapter, (register: () => unknown): unknown => register(), { stateDir: DEFAULT_STATE_DIR })
    /** The hold request: a VALID body, so only the fence can explain the refusal. */
    const req = requestDouble("POST", JSON.stringify({ teamId: "team-1" }))
    /** The refusal the client sees. */
    const captured = await invoke(routeAt(server, HOLD_PATH), req)
    expect(captured.status).toBe(401)
    expect((captured.body as { ok: boolean }).ok).toBe(false)
    // THE POINT: a refused request never reaches the store.
    expect(existsSync(holdPath(workspace, DEFAULT_STATE_DIR, "team-1"))).toBe(false)
  })
})

describe("the body boundary", () => {
  test("invalid JSON answers 400 on BOTH routes", async () => {
    /** A temp workspace with no holds in it. */
    const workspace = sandbox()
    /** The mounted surface. */
    const mounted = mount(workspace)
    for (const path of WATCHDOG_ROUTES) {
      /** The refusal a malformed body receives. */
      const captured = await invoke(routeAt(mounted.server, path), requestDouble("POST", "{not json"))
      expect(captured.status).toBe(400)
      expect((captured.body as { ok: boolean }).ok).toBe(false)
    }
  })

  test("a missing, blank or mistyped teamId answers 400 on BOTH routes", async () => {
    /** A temp workspace with no holds in it. */
    const workspace = sandbox()
    /** The mounted surface. */
    const mounted = mount(workspace)
    /** The bodies every route must refuse: absent, empty, whitespace-only, non-string, non-object. */
    const bodies: string[] = ["{}", JSON.stringify({ teamId: "" }), JSON.stringify({ teamId: "   " }), JSON.stringify({ teamId: 42 }), "[]"]
    for (const path of WATCHDOG_ROUTES) {
      for (const body of bodies) {
        /** The refusal one malformed team id receives. */
        const captured = await invoke(routeAt(mounted.server, path), requestDouble("POST", body))
        expect(captured.status).toBe(400)
        expect((captured.body as { ok: boolean }).ok).toBe(false)
      }
    }
    // No sidecar was created by any of the refused bodies.
    expect(existsSync(join(workspace, DEFAULT_STATE_DIR, "watchdog"))).toBe(false)
  })

  test("a body over the 64 KiB cap answers 413 without being parsed", async () => {
    /** A temp workspace with no holds in it. */
    const workspace = sandbox()
    /** The mounted surface. */
    const mounted = mount(workspace)
    /** A well-formed JSON body whose padding alone exceeds the cap. */
    const oversized = JSON.stringify({ teamId: "team-1", reason: "x".repeat(MAX_BODY_BYTES) })
    expect(oversized.length).toBeGreaterThan(MAX_BODY_BYTES)
    /** The refusal the oversized body receives. */
    const captured = await invoke(routeAt(mounted.server, HOLD_PATH), requestDouble("POST", oversized))
    expect(captured.status).toBe(413)
    expect((captured.body as { ok: boolean }).ok).toBe(false)
  })
})

describe("the mutations", () => {
  test("hold persists the sidecar and publishes to the registry; resume clears both", async () => {
    /** A temp workspace that starts with no holds. */
    const workspace = sandbox()
    /** The synchronous reader the dispatch gates consult; the route must publish into it. */
    const registry = new HoldRegistry(DEFAULT_STATE_DIR)
    /** The mounted surface, with the registry wired the way the plugin's `apply` wires it. */
    const mounted = mount(workspace, { registry })
    /** The durable sidecar this arm asserts on. */
    const file = holdPath(workspace, DEFAULT_STATE_DIR, "team-1")

    /** The hold request the client half will send. */
    const held = await invoke(routeAt(mounted.server, HOLD_PATH), requestDouble("POST", JSON.stringify({ teamId: "team-1", reason: "maintenance", ttlMs: 5000 })))
    expect(held.status).toBe(200)
    /** The success payload, narrowed for the assertions below. */
    const heldBody = held.body as { ok: boolean; hold: { applied: boolean; hold: { teamId: string; cause: string; ttlMs: number } } }
    expect(heldBody.ok).toBe(true)
    expect(heldBody.hold.applied).toBe(true)
    expect(heldBody.hold.hold.teamId).toBe("team-1")
    expect(heldBody.hold.hold.cause).toBe("maintenance")
    expect(heldBody.hold.hold.ttlMs).toBe(5000)
    // THE STATE ACTUALLY CHANGED: the durable sidecar exists and carries the request's fields.
    expect(existsSync(file)).toBe(true)
    /** The hold read back FROM DISK, so the response alone is not the evidence. */
    const persisted = JSON.parse(readFileSync(file, "utf8")) as { teamId: string; cause: string; ttlMs: number }
    expect(persisted.teamId).toBe("team-1")
    expect(persisted.cause).toBe("maintenance")
    expect(persisted.ttlMs).toBe(5000)
    // ... and the SAME registry the tools use reports the pause, so a web pause reaches the gates.
    expect(registry.isHeld("team-1", workspace).held).toBe(true)

    /** The resume request. */
    const resumed = await invoke(routeAt(mounted.server, RESUME_PATH), requestDouble("POST", JSON.stringify({ teamId: "team-1" })))
    expect(resumed.status).toBe(200)
    expect(resumed.body).toEqual({ ok: true, resumed: true })
    expect(existsSync(file)).toBe(false)
    expect(registry.isHeld("team-1", workspace).held).toBe(false)

    /** A SECOND resume for the same team: the documented 200 no-op, never an error (AC-8). */
    const again = await invoke(routeAt(mounted.server, RESUME_PATH), requestDouble("POST", JSON.stringify({ teamId: "team-1" })))
    expect(again.status).toBe(200)
    expect(again.body).toEqual({ ok: true, resumed: false })
  })

  test("the 200 hold answer keeps the consumer fields and carries NO filesystem path at any depth", async () => {
    /** A temp workspace whose absolute path must never appear in the answer. */
    const workspace = sandbox()
    /** The mounted surface. */
    const mounted = mount(workspace)
    /** The accepted hold. */
    const held = await invoke(routeAt(mounted.server, HOLD_PATH), requestDouble("POST", JSON.stringify({ teamId: "team-1", reason: "maintenance", ttlMs: 5000 })))
    expect(held.status).toBe(200)
    /** The success payload, narrowed to the shape the client half is written against. */
    const body = held.body as { ok: boolean; hold: { applied: boolean; changed?: boolean; hold: { teamId: string; cause: string; ttlMs: number } } }
    // THE KEPT FIELDS ARE STILL THERE: the route's own contract, unchanged by the narrowing.
    expect(body.ok).toBe(true)
    expect(body.hold.applied).toBe(true)
    expect(body.hold.hold.teamId).toBe("team-1")
    expect(body.hold.hold.cause).toBe("maintenance")
    expect(body.hold.hold.ttlMs).toBe(5000)
    // THE POINT OF THIS ARM: the store's absolute `path` — and any other path-shaped field — is gone
    // from EVERY depth of the serialized answer, and no field value names the sidecar either.
    expect(Object.keys(body.hold).sort()).toEqual(["applied", "changed", "hold"])
    expect(propertyNamesDeep(body)).not.toContain("path")
    expect(JSON.stringify(body)).not.toContain(workspace)
  })
})

describe("workspace resolution", () => {
  test("with NO live session the adapter's agentless root is used", async () => {
    /** A temp workspace the agentless root points at. */
    const workspace = sandbox()
    /** The server double the routes register on. */
    const server = serverDouble()
    /** The adapter with no live registry and the process-level root set to the sandbox. */
    const adapter = adapterFor({ server, roots: [], root: workspace })
    registerWatchdogWeb(adapter, (register: () => unknown): unknown => register(), { stateDir: DEFAULT_STATE_DIR })
    /** The accepted hold. */
    const captured = await invoke(routeAt(server, HOLD_PATH), requestDouble("POST", JSON.stringify({ teamId: "agentless-1" })))
    expect(captured.status).toBe(200)
    expect((captured.body as { ok: boolean }).ok).toBe(true)
    expect(existsSync(holdPath(workspace, DEFAULT_STATE_DIR, "agentless-1"))).toBe(true)
  })

  test("a request that cannot be tied to ONE workspace answers 400, not 500", async () => {
    /** The server double the routes register on. */
    const server = serverDouble()
    /** Two live roots: a body-only request cannot say which workspace it means. */
    const adapter = adapterFor({ server, roots: ["/ws-a", "/ws-b"], root: "/ws-a" })
    registerWatchdogWeb(adapter, (register: () => unknown): unknown => register(), { stateDir: DEFAULT_STATE_DIR })
    /** The refusal an ambiguous request receives. */
    const ambiguous = await invoke(routeAt(server, HOLD_PATH), requestDouble("POST", JSON.stringify({ teamId: "team-1" })))
    expect(ambiguous.status).toBe(400)
    expect((ambiguous.body as { ok: boolean }).ok).toBe(false)
    // The SAME body against a host with NO resolvable root is refused the same way, not a 500.
    /** The second server double, over a host with no root at all. */
    const bare = serverDouble()
    /** An adapter with neither a live session nor a process root. */
    const rootless = adapterFor({ server: bare, roots: [], root: "" })
    registerWatchdogWeb(rootless, (register: () => unknown): unknown => register(), { stateDir: DEFAULT_STATE_DIR })
    /** The refusal a root-less request receives. */
    const unattributable = await invoke(routeAt(bare, HOLD_PATH), requestDouble("POST", JSON.stringify({ teamId: "team-1" })))
    expect(unattributable.status).toBe(400)
    expect((unattributable.body as { ok: boolean }).ok).toBe(false)
  })
})
