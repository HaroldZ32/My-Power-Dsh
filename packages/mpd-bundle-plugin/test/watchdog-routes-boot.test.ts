// The bundle's OWN web routes must survive a web server that binds AFTER this row's apply().
//
// MEASURED DEFECT (2026-09-23, win32, a live `dsh web` profile carrying
// `@linxin666/dsh-web-all` + this bundle): `/plugins/mpd-workmate/list` and `/roster`
// answered 200 while `/plugins/mpd-team-watchdog/state?reader=web-panel` answered 404 on
// every poll — the red console line the user reported. Cause: this plugin resolved
// `webServer` with a ONE-SHOT `ctx.get` probe at apply() time and gave up, while
// `mpd-workmate-plugin` re-tried on the runtime's `internal/service` binding event and
// therefore registered. Same composition, same race, one survivor.
//
// These cases drive the REAL `apply` from `dist/index.js` (the shipped bytes) over a
// cordis-shaped ctx, so the retry, the first-try path, the legacy `httpServer` name, the
// no-seam marker behaviour and a plain GET are all pinned without a browser or a server.
import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
// The shipped dist build is JavaScript with no declaration file; the arms below drive its real
// `apply` over a cordis-shaped ctx, so no static type can describe it here.
// @ts-expect-error JavaScript build product has no declaration file
import { apply, WATCHDOG_WEB_READER } from "../dist/index.js"

/** The bundle's state route, the path the measured live 404 was reported on. */
const STATE_PATH = "/plugins/mpd-team-watchdog/state"
/** The bundle's acknowledge route, paired with the state route. */
const ACK_PATH = "/plugins/mpd-team-watchdog/ack"

/** The response double the route handlers write into. */
interface FakeRes {
  /** The status code the last writeHead set. */
  status: number
  /** The headers the last writeHead set. */
  headers: Record<string, string>
  /** The body text accumulated by end(). */
  body: string
  /** Record one response's status and headers, as the web server does. */
  writeHead?: (status: number, headers?: Record<string, string>) => FakeRes
  /** Append one chunk to the body, as the web server does. */
  end?: (chunk?: unknown) => FakeRes
}

/** One route the web server double holds: its path is also its registry key. */
interface RouteRecord {
  /** The route path the plugin registered. */
  path: string
  /** The handler the server invokes with a request and a response. */
  handler: (request: unknown, res: FakeRes) => Promise<void>
}

/** The cordis-shaped ctx the plugin's apply() drives in these arms. */
interface FakeCtx {
  /** The one-shot service probe the plugin makes at apply() time. */
  get: (name: string) => unknown
  /** Subscribe to a runtime event; `internal/service` is the one that can wake a late row. */
  on: (event: string, listener: (name: string, value: unknown) => void) => () => void
  /** The effect seam; absent when an arm models a host without one. */
  effect?: (fn: () => unknown) => unknown
}

/** Knobs for the host double, one field per composition variant the arms need. */
interface FakeHostOptions {
  /** Bind the web server before apply(), the path that already worked. */
  bindAtApply?: boolean
  /** Provide the effect seam; false models a headless marker host. */
  withEffect?: boolean
}

/** The host double plus the handles an arm drives it through. */
interface FakeHost {
  /** The ctx handed to the plugin's apply(). */
  ctx: FakeCtx
  /** The routes registered so far, keyed by path. */
  routes: Map<string, RouteRecord>
  /** The web server double itself, for a rebind. */
  webServer: { register: (route: RouteRecord) => () => void }
  /** Bind a service after apply(), waking every parked `internal/service` listener. */
  bindService: (name: string, value: unknown) => void
}
/** A response double: the route handlers only writeHead + end. */
function fakeRes(): FakeRes {
  /** The response record the handlers fill in as they write. */
  const res: FakeRes = { status: 0, headers: {}, body: "" }
  res.writeHead = (status, headers) => { res.status = status; res.headers = headers ?? {}; return res }
  res.end = (chunk) => { if (chunk !== undefined) res.body += String(chunk); return res }
  return res
}

/**
 * A cordis-shaped host for the plugin.
 *
 * `bindService` is the runtime's own `internal/service` event and is the ONLY thing that can
 * wake a registration that lost the apply()-time race — which is the whole point of the case
 * below: a host without it reproduces the live 404.
 */
function fakeHost({ bindAtApply = false, withEffect = true }: FakeHostOptions = {}): FakeHost {
  /** Service registry the ctx exposes through its one-shot probe. */
  const services = new Map<string, unknown>()
  /** Registered routes keyed by path, so a rebind cannot double-register. */
  const routes = new Map<string, RouteRecord>()
  /** `internal/service` listeners: the only path that can wake a late registration. */
  const serviceListeners: Array<(name: string, value: unknown) => void> = []
  /** The web server double whose register() the plugin calls. */
  const webServer = {
    register: (route: RouteRecord) => { routes.set(route.path, route); return () => { routes.delete(route.path) } },
  }
  if (bindAtApply) services.set("webServer", webServer)
  /** The cordis-shaped ctx handed to the plugin's apply(). */
  const ctx: FakeCtx = {
    get: (name) => services.get(name),
    on: (event, listener) => { if (event === "internal/service") serviceListeners.push(listener); return () => {} },
  }
  if (withEffect) ctx.effect = (fn) => {
    /** Whatever the effect callback returned, when it returned a disposer. */
    const disposer = fn();
    return typeof disposer === "function" ? disposer : () => {};
  }
  return {
    ctx,
    routes,
    webServer,
    bindService: (name, value) => {
      services.set(name, value)
      for (const listener of serviceListeners) listener(name, value)
    },
  }
}

describe("the watchdog routes survive a late-bound web server", () => {
  test("a web server that binds AFTER apply() still gets BOTH routes (the live 404)", () => {
    /** A host whose web server has not bound yet. */
    const host = fakeHost()
    apply(host.ctx)
    // Nothing to bind to yet: the server's fiber has not activated.
    expect([...host.routes.keys()]).toEqual([])
    host.bindService("webServer", host.webServer)
    expect([...host.routes.keys()].sort()).toEqual([ACK_PATH, STATE_PATH])
  })

  test("a web server bound AT apply() registers immediately (the path that already worked)", () => {
    /** A host whose web server is already registered at apply time. */
    const host = fakeHost({ bindAtApply: true })
    apply(host.ctx)
    expect([...host.routes.keys()].sort()).toEqual([ACK_PATH, STATE_PATH])
  })

  test("an unrelated late binding registers nothing and never throws", () => {
    /** A host with no web server bound at apply time. */
    const host = fakeHost()
    apply(host.ctx)
    expect(() => {
      host.bindService("mpdConfig", { get: () => undefined })
      host.bindService("mpdRoles", {})
    }).not.toThrow()
    expect([...host.routes.keys()]).toEqual([])
  })

  test("httpServer is accepted as the legacy name for the same surface", () => {
    /** A host whose server binds under the legacy `httpServer` name. */
    const host = fakeHost()
    apply(host.ctx)
    host.bindService("httpServer", host.webServer)
    expect([...host.routes.keys()].sort()).toEqual([ACK_PATH, STATE_PATH])
  })

  test("no effect seam keeps the plugin a headless marker and never throws", () => {
    /** A host without the effect seam. */
    const host = fakeHost({ withEffect: false })
    expect(() => apply(host.ctx)).not.toThrow()
    host.bindService("webServer", host.webServer)
    expect([...host.routes.keys()]).toEqual([])
  })

  test("a rebind of the SAME server never registers the routes twice", () => {
    /** A host whose server is registered at apply time. */
    const host = fakeHost({ bindAtApply: true })
    apply(host.ctx)
    expect(host.routes.size).toBe(2)
    host.bindService("webServer", host.webServer)
    expect(host.routes.size).toBe(2)
  })
})

describe("the late-registered state route really answers", () => {
  test("GET answers 200 with ok:true and the web reader key", async () => {
    /** A throwaway workspace root, so the route reads an empty store. */
    const workspace = mkdtempSync(join(tmpdir(), "mpd-watchdog-web-"))
    /** The workspace root env value to restore after the arm. */
    const saved = process.env.DSH_WORKSPACE_ROOT
    process.env.DSH_WORKSPACE_ROOT = workspace
    try {
      /** A host whose web server binds after apply(). */
      const host = fakeHost()
      apply(host.ctx)
      host.bindService("webServer", host.webServer)
      /** The state route the late binding registered. */
      const route = host.routes.get(STATE_PATH)!
      expect(route).toBeDefined()
      /** The response double the handler writes into. */
      const res = fakeRes()
      await route.handler({ method: "GET", url: STATE_PATH + "?reader=" + WATCHDOG_WEB_READER }, res)
      expect(res.status).toBe(200)
      /** The parsed JSON payload the route answered with. */
      const body = JSON.parse(res.body)
      expect(body.ok).toBe(true)
      expect(body.reader).toBe(WATCHDOG_WEB_READER)
      expect(body.stuck).toBe(false)
      // An EMPTY sandbox store is a valid, non-degraded answer — never an error payload.
      expect(Array.isArray(body.held)).toBe(true)
      expect(body.held).toHaveLength(0)
    } finally {
      if (saved === undefined) delete process.env.DSH_WORKSPACE_ROOT
      else process.env.DSH_WORKSPACE_ROOT = saved
      rmSync(workspace, { recursive: true, force: true })
    }
  })
})
