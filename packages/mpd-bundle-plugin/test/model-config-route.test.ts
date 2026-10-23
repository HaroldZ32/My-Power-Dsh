// The bundle's effective model-config route (R3, wave fix/model-config-live-refresh, lane L4).
//
// WHAT IS ASSERTED HERE: the route the Web settings card fetches for its see-before-you-edit block
// really registers beside the watchdog routes (driving the REAL `apply` from `dist/index.js` over a
// cordis-shaped ctx, the same shape `watchdog-routes-boot.test.ts` uses) and answers the three
// two effective tables from the `mpdConfig` service — read PER REQUEST, so a save made between two
// GETs changes the answer without any restart. The slot blocks are served RAW (no default layer,
// contract §2/§9): a slot the workspace never configured is ABSENT from the body, which is what lets
// the card render <unconfigured> instead of an invented route. The refusal arm pins the card's declared degradation: a
// composition without the config row answers 503 with a reason, never a wrong payload.
//
// WHAT IS NOT ASSERTED: that a browser renders the card. No browser exists in this environment;
// the card-side projection is covered by `settings-card.test.ts` over the card's own exports.
import { describe, expect, test } from "bun:test"
// The shipped dist build is JavaScript with no declaration file; the arms below drive its real
// `apply` over a cordis-shaped ctx, so no static type can describe it here.
// @ts-expect-error JavaScript build product has no declaration file
import { apply } from "../dist/index.js"

/** The route path this file is about. */
const MODEL_CONFIG_PATH = "/plugins/mpd/model-config"

/** The response double the route handler writes into. */
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

/** One route the web server double holds. */
interface RouteRecord {
  /** The route path. */
  path: string
  /** The handler the server invokes with a request and a response. */
  handler: (request: unknown, res: FakeRes) => unknown
}

/**
 * A cordis-shaped host carrying a web server and — optionally — an `mpdConfig` service double.
 *
 * @param config - the `mpdConfig` service the composition mounts; omitted models a webless config
 *   row (the card's declared-degradation branch).
 * @returns the ctx, the registered routes and the response factory an arm drives.
 */
function fakeHost(config?: { get: (key?: string) => unknown }): {
  ctx: { get: (name: string) => unknown; on: () => () => void; effect?: (fn: () => unknown) => unknown }
  routes: Map<string, RouteRecord>
  res: () => FakeRes
} {
  /** Registered routes keyed by path. */
  const routes = new Map<string, RouteRecord>()
  /** The service registry the ctx exposes. */
  const services = new Map<string, unknown>()
  services.set("webServer", { register: (route: RouteRecord) => { routes.set(route.path, route); return () => { routes.delete(route.path) } } })
  if (config !== undefined) services.set("mpdConfig", config)
  /** The ctx handed to the plugin's apply(). */
  const ctx: { get: (name: string) => unknown; on: () => () => void; effect?: (fn: () => unknown) => unknown } = {
    get: (name: string) => services.get(name),
    on: () => () => {},
  }
  ctx.effect = (fn: () => unknown) => {
    /** Whatever the effect callback returned, when it returned a disposer. */
    const disposer = fn()
    return typeof disposer === "function" ? disposer : () => {}
  }
  return { ctx, routes, res: fakeRes }
}

/** A response double: the route handler only writeHead + end. */
function fakeRes(): FakeRes {
  /** The response record the handler fills in as it writes. */
  const res: FakeRes = { status: 0, headers: {}, body: "" }
  res.writeHead = (status, headers) => { res.status = status; res.headers = headers ?? {}; return res }
  res.end = (chunk) => { if (chunk !== undefined) res.body += String(chunk); return res }
  return res
}

describe("the effective model-config route", () => {
  test("registers beside the watchdog routes and answers the two tables from the service", async () => {
    /** The mutable resolved tables, so a later arm can change them between two GETs. */
    const tables = {
      teamModels: { slot1: { provider: "deepseek-official", model: "deepseek-v4-pro", reasoningEffort: "max" } },
      modelchain: { sisyphus: [{ provider: "deepseek-official", model: "deepseek-v4-pro" }] },
    }
    /** The host whose config service reads the tables above. */
    const host = fakeHost({ get: (key) => (key === undefined ? tables : tables[key as keyof typeof tables]) })
    apply(host.ctx)
    /** The route this arm drives. */
    const route = host.routes.get(MODEL_CONFIG_PATH)
    expect(route).toBeDefined()
    /** The response double the handler writes into. */
    const res = host.res()
    await route!.handler({ method: "GET", url: MODEL_CONFIG_PATH }, res)
    expect(res.status).toBe(200)
    expect(res.headers["cache-control"]).toBe("no-store")
    /** The parsed body the route answered with. */
    const body = JSON.parse(res.body)
    expect(body.ok).toBe(true)
    expect(body.slots.slot1.model).toBe("deepseek-v4-pro")
    // The deleted table is GONE from the payload (contract §3) — not merely empty.
    expect(body).not.toHaveProperty("agentRoutes")
    expect(body.modelchain.sisyphus).toEqual([{ provider: "deepseek-official", model: "deepseek-v4-pro" }])
  })

  test("an UNCONFIGURED slot is ABSENT from the body, never filled in with a default", async () => {
    /** A workspace that declares only slot3: the other slots must not appear at all. */
    const tables = { teamModels: { slot3: { provider: "p", model: "m" } } }
    /** The host whose config service reads exactly that block. */
    const host = fakeHost({ get: (key) => (key === undefined ? tables : tables[key as keyof typeof tables]) })
    apply(host.ctx)
    /** The route this arm drives. */
    const route = host.routes.get(MODEL_CONFIG_PATH)!
    /** The response double the handler writes into. */
    const res = host.res()
    await route.handler({}, res)
    /** The parsed body the route answered with. */
    const body = JSON.parse(res.body)
    expect(body.slots).toEqual({ slot3: { provider: "p", model: "m" } })
    expect(body.slots).not.toHaveProperty("slot1")
  })

  test("the answer is read PER REQUEST: a changed service value changes the next GET (live refresh)", async () => {
    /** The mutable model the service resolves. */
    let slotModel = "deepseek-v4-flash"
    /** The host whose config service reads the mutable model. */
    const host = fakeHost({ get: (key) => (key === "teamModels" ? { slot1: { model: slotModel } } : undefined) })
    apply(host.ctx)
    /** The route this arm drives. */
    const route = host.routes.get(MODEL_CONFIG_PATH)!
    /** The first answer. */
    const first = host.res()
    await route.handler({}, first)
    expect(JSON.parse(first.body).slots.slot1.model).toBe("deepseek-v4-flash")
    // The change a SAVE would make: the next GET must carry it with no restart, no re-register.
    slotModel = "deepseek-v4-pro"
    /** The second answer. */
    const second = host.res()
    await route.handler({}, second)
    expect(JSON.parse(second.body).slots.slot1.model).toBe("deepseek-v4-pro")
  })

  test("a composition without the config row answers 503 with a reason, never a wrong payload", async () => {
    /** The host whose composition mounts no `mpdConfig` service. */
    const host = fakeHost()
    apply(host.ctx)
    /** The route this arm drives. */
    const route = host.routes.get(MODEL_CONFIG_PATH)
    expect(route).toBeDefined()
    /** The response double the handler writes into. */
    const res = host.res()
    await route!.handler({}, res)
    expect(res.status).toBe(503)
    /** The parsed refusal body. */
    const body = JSON.parse(res.body)
    expect(body.ok).toBe(false)
    expect(body.reason).toContain("mpdConfig service is not composed")
  })

  test("a THROWING config read answers 503 naming the error, never a partial 200", async () => {
    /** The host whose config service throws on every read. */
    const host = fakeHost({ get: () => { throw new Error("boom") } })
    apply(host.ctx)
    /** The route this arm drives. */
    const route = host.routes.get(MODEL_CONFIG_PATH)!
    /** The response double the handler writes into. */
    const res = host.res()
    await route.handler({}, res)
    expect(res.status).toBe(503)
    expect(JSON.parse(res.body).reason).toContain("boom")
  })
})
