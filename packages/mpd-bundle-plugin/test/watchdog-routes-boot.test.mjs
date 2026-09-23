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
import { apply, WATCHDOG_WEB_READER } from "../dist/index.js"

const STATE_PATH = "/plugins/mpd-team-watchdog/state"
const ACK_PATH = "/plugins/mpd-team-watchdog/ack"

/** A response double: the route handlers only writeHead + end. */
function fakeRes() {
  const res = { status: 0, headers: {}, body: "" }
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
function fakeHost({ bindAtApply = false, withEffect = true } = {}) {
  const services = new Map()
  const routes = new Map()
  const serviceListeners = []
  const webServer = {
    register: (route) => { routes.set(route.path, route); return () => { routes.delete(route.path) } },
  }
  if (bindAtApply) services.set("webServer", webServer)
  const ctx = {
    get: (name) => services.get(name),
    on: (event, listener) => { if (event === "internal/service") serviceListeners.push(listener); return () => {} },
  }
  if (withEffect) ctx.effect = (fn) => { const disposer = fn(); return typeof disposer === "function" ? disposer : () => {} }
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
    const host = fakeHost()
    apply(host.ctx)
    // Nothing to bind to yet: the server's fiber has not activated.
    expect([...host.routes.keys()]).toEqual([])
    host.bindService("webServer", host.webServer)
    expect([...host.routes.keys()].sort()).toEqual([ACK_PATH, STATE_PATH])
  })

  test("a web server bound AT apply() registers immediately (the path that already worked)", () => {
    const host = fakeHost({ bindAtApply: true })
    apply(host.ctx)
    expect([...host.routes.keys()].sort()).toEqual([ACK_PATH, STATE_PATH])
  })

  test("an unrelated late binding registers nothing and never throws", () => {
    const host = fakeHost()
    apply(host.ctx)
    expect(() => {
      host.bindService("mpdConfig", { get: () => undefined })
      host.bindService("mpdRoles", {})
    }).not.toThrow()
    expect([...host.routes.keys()]).toEqual([])
  })

  test("httpServer is accepted as the legacy name for the same surface", () => {
    const host = fakeHost()
    apply(host.ctx)
    host.bindService("httpServer", host.webServer)
    expect([...host.routes.keys()].sort()).toEqual([ACK_PATH, STATE_PATH])
  })

  test("no effect seam keeps the plugin a headless marker and never throws", () => {
    const host = fakeHost({ withEffect: false })
    expect(() => apply(host.ctx)).not.toThrow()
    host.bindService("webServer", host.webServer)
    expect([...host.routes.keys()]).toEqual([])
  })

  test("a rebind of the SAME server never registers the routes twice", () => {
    const host = fakeHost({ bindAtApply: true })
    apply(host.ctx)
    expect(host.routes.size).toBe(2)
    host.bindService("webServer", host.webServer)
    expect(host.routes.size).toBe(2)
  })
})

describe("the late-registered state route really answers", () => {
  test("GET answers 200 with ok:true and the web reader key", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "mpd-watchdog-web-"))
    const saved = process.env.DSH_WORKSPACE_ROOT
    process.env.DSH_WORKSPACE_ROOT = workspace
    try {
      const host = fakeHost()
      apply(host.ctx)
      host.bindService("webServer", host.webServer)
      const route = host.routes.get(STATE_PATH)
      expect(route).toBeDefined()
      const res = fakeRes()
      await route.handler({ method: "GET", url: STATE_PATH + "?reader=" + WATCHDOG_WEB_READER }, res)
      expect(res.status).toBe(200)
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
