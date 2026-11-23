// The bundle's effective model-config route (R3, re-aimed by the agent-routes contract §7).
//
// WHAT IS ASSERTED HERE: (a) the route really registers on the host's web server beside the
// watchdog routes — the arm drives the REAL `apply` from the built `dist/index.js` over a
// cordis-shaped ctx (the same shape `watchdog-routes-boot.test.ts` uses), which is the wiring only a
// build proves — and answers JSON with `cache-control: no-store`, or 503 with a reason when no
// config row is composed; (b) the BODY projection — ONE typed resolution per roster AGENT, read PER
// REQUEST, and NEVER the retired `teamModels` table — is exercised against
// `src/model-config-web.ts` directly. That split is deliberate: a LANE does not rebuild `dist/`
// (the integrator does), so the body's semantics are pinned at the source here while the
// dist-freshness gate pins the SHIPPED bytes to this source at integration.
//
// WHAT IS NOT ASSERTED: that a browser renders the card. No browser exists in this environment;
// the card-side projection is covered by `settings-card.test.ts` over the card's own exports.
import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { apply as applySource } from "../src/index.ts"
import { buildModelConfigBody, ROSTER_MEMBERS } from "../src/model-config-web.ts"
import { apply as applyConfig } from "../../mpd-config-plugin/src/index.ts"
// The shipped dist build is JavaScript with no declaration file; the arms below drive its real
// `apply` over a cordis-shaped ctx, so no static type can describe it here.
// @ts-expect-error JavaScript build product has no declaration file
import { apply } from "../dist/index.js"

/** The route path this file is about. */
const MODEL_CONFIG_PATH = "/plugins/mpd/model-config"

/** The `mpdConfig` surface the route's pure builder reads (the mounted service, or a test double). */
interface ConfigDouble {
  /** Read one resolved config key, or the whole raw config when no key is given. */
  get?: (key?: string) => unknown
  /** The TOTAL per-agent route resolution (contract §2). */
  agentRouteResolutionOf?: (member: string) => unknown
}

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
function fakeHost(config?: ConfigDouble): {
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

/** A typed resolution double for one member: configured at `provider`/`model`. */
function configured(member: string, provider: string, model: string): unknown {
  return { ok: true, agent: member, route: { provider, model, reasoningEffort: "low" } }
}

/** A typed resolution double: the member is unconfigured, with both required leaves missing. */
function unconfigured(member: string): unknown {
  return { ok: false, reason: "unconfigured", agent: member, missing: ["provider", "model"] }
}

describe("the effective model-config route", () => {
  test("registers on the host's web server and answers no-store JSON beside the watchdog routes", async () => {
    /** The host whose config service answers a typed resolution per member. */
    const host = fakeHost({ get: () => ({}), agentRouteResolutionOf: (member) => configured(member, "deepseek-official", "deepseek-v4-pro") })
    apply(host.ctx)
    /** The route this arm drives. */
    const route = host.routes.get(MODEL_CONFIG_PATH)
    expect(route).toBeDefined()
    /** The response double the handler writes into. */
    const res = host.res()
    await route!.handler({ method: "GET", url: MODEL_CONFIG_PATH }, res)
    expect(res.status).toBe(200)
    expect(res.headers["cache-control"]).toBe("no-store")
    expect(res.headers["content-type"]).toContain("application/json")
    // The registration arm is SHAPE-AGNOSTIC on purpose: the served bytes are pinned to this
    // source by the integrator's dist-freshness gate, and the body's own shape is asserted below.
    expect(typeof JSON.parse(res.body).ok).toBe("boolean")
  })

  test("serves ONE typed resolution per roster agent, and NEVER the retired teamModels table", () => {
    /** The chains the service reports beside the agents. */
    const chains = { sisyphus: [{ provider: "deepseek-official", model: "deepseek-v4-pro" }] }
    /** The body the pure builder projects from that service. */
    const body = buildModelConfigBody({
      get: (key) => (key === "modelchain" ? chains : key === "teamModels" ? { slot1: { provider: "old", model: "old" } } : undefined),
      agentRouteResolutionOf: (member) => (member === "Architect" ? configured("Architect", "deepseek-official", "deepseek-v4-pro") : unconfigured(member)),
    })
    expect(body.ok).toBe(true)
    // Narrowing on the discriminant, so the body's fields are readable without a cast.
    if (!body.ok) throw new Error("the route refused a composed service: " + body.reason)
    // ONE entry per roster member, in the declared roster order — the per-agent table IS the payload.
    expect(Object.keys(body.agents)).toEqual([...ROSTER_MEMBERS])
    expect(body.agents.Architect).toEqual(configured("Architect", "deepseek-official", "deepseek-v4-pro"))
    expect(body.agents.Planner).toEqual(unconfigured("Planner"))
    // The retired table is NEVER read, even when the config service still exposes it.
    expect(JSON.stringify(body)).not.toContain("teamModels")
    expect(JSON.stringify(body)).not.toContain("slot1")
    // The chains ride the service read, which NO settings document holds.
    expect(body.modelchain).toEqual(chains)
  })

  test("the roster mirror IS the shared declaration's eleven agents, in group order", async () => {
    // The route does not import the config package (its server half stays dependency-free), so this
    // pin is what keeps the mirror from drifting when the roster changes.
    const shared = await import("../../mpd-config-plugin/src/settings-schema.ts")
    expect([...ROSTER_MEMBERS]).toEqual([...shared.ROSTER_AGENT_NAMES])
    expect(ROSTER_MEMBERS).toHaveLength(11)
  })

  test("is read PER REQUEST: a changed service resolution changes the next body (live refresh)", () => {
    /** The mutable model the service resolves. */
    let model = "deepseek-v4-flash"
    /** The service double reading the mutable model above. */
    const service: ConfigDouble = { agentRouteResolutionOf: (member) => (member === "Architect" ? configured("Architect", "deepseek-official", model) : unconfigured(member)) }
    /** The first body. */
    const first = buildModelConfigBody(service)
    if (!first.ok) throw new Error("the first read refused: " + first.reason)
    expect((first.agents.Architect as { route: { model: string } }).route.model).toBe("deepseek-v4-flash")
    // The change a SAVE would make: the next build must carry it with no restart, no re-register.
    model = "deepseek-v4-pro"
    /** The second body. */
    const second = buildModelConfigBody(service)
    if (!second.ok) throw new Error("the second read refused: " + second.reason)
    expect((second.agents.Architect as { route: { model: string } }).route.model).toBe("deepseek-v4-pro")
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

  test("the real bundle and config rows read and edit only the authenticated session's project", async () => {
    /** Isolated fixture holding both live workspaces and the absent user layer. */
    const box = mkdtempSync(join(tmpdir(), "mpd-web-model-config-"))
    /** Per-session project paths, including different routes for the same agent. */
    const workspaces = { a: join(box, "a"), b: join(box, "b") }
    /** The Web client's test host registry. */
    const host = fakeHost()
    /** Disposers from the registered server routes and file watchers. */
    const disposers: (() => void)[] = []
    /** The adapter sees live sessions and the harness authentication seam through this registry. */
    const services = new Map<string, unknown>([
      ["agents", { list: () => Object.entries(workspaces).map(([id, cwd]) => ({ session: { id, header: { cwd } } })) }],
      ["connection", { requestRejection: (request: { headers: { host?: string } }) => request.headers.host === "test.local" ? undefined : 403 }],
    ])
    /** Mount both production rows on the same context. */
    const ctx = {
      ...host.ctx,
      tools: { register: () => undefined },
      get: (key: string) => services.get(key) ?? host.ctx.get(key),
      provide: (key: string, service: unknown) => { services.set(key, service) },
      effect: (fn: () => unknown) => {
        /** Register the row's cleanup for this fixture. */
        const cleanup = fn()
        if (typeof cleanup === "function") disposers.push(() => cleanup())
      },
    }
    /** Locate an isolated project's actual config file. */
    const file = (key: keyof typeof workspaces): string => join(workspaces[key], ".mpd", "mpd.jsonc")
    /** Unrelated JSONC bytes the surgical write must preserve. */
    const original = (model: string): string => `// keep this comment\n{ "agentRoutes": { "deep-worker": { "provider": "example", "model": "${model}", }, }, "modelchain": { "chain": [{"provider":"example","model":"${model}"}] }, }\n`
    try {
      for (const key of ["a", "b"] as const) {
        mkdirSync(join(workspaces[key], ".mpd"), { recursive: true })
        writeFileSync(file(key), original(key))
      }
      applyConfig(ctx, { userFile: join(box, "absent-user.jsonc") })
      applySource(ctx)
      /** The exact HTTP handler installed by the bundle's normal apply path. */
      const route = host.routes.get(MODEL_CONFIG_PATH)
      if (route === undefined) throw new Error("model route did not register")
      /** Simulate a host request with a streamed JSON payload when posting. */
      const call = async (query: string, payload?: unknown, authorized: boolean = true): Promise<FakeRes> => {
        /** A Node request-shaped stream with origin and method metadata. */
        const request = {
          url: MODEL_CONFIG_PATH + query,
          method: payload === undefined ? "GET" : "POST",
          headers: { host: authorized ? "test.local" : "blocked.local" },
          /** Stream the JSON exactly as the Web client sends it. */
          async *[Symbol.asyncIterator](): AsyncGenerator<string> { yield JSON.stringify(payload) },
        }
        /** The response written by the registered handler. */
        const response = host.res()
        await route.handler(request, response)
        return response
      }
      expect(await call("")).toMatchObject({ status: 409 })
      expect(await call("?sessionId=missing")).toMatchObject({ status: 409 })
      expect(await call("?sessionId=a", undefined, false)).toMatchObject({ status: 403 })
      /** Initial read from each session. */
      const readA = await call("?sessionId=a")
      /** Session B has distinct values through the same route handler. */
      const readB = await call("?sessionId=b")
      expect(readA.status).toBe(200)
      expect(readB.status).toBe(200)
      expect(JSON.parse(readA.body)).toMatchObject({ agents: { "Deep Worker": { route: { model: "a" } } }, modelchain: { chain: [{ model: "a" }] } })
      expect(JSON.parse(readB.body)).toMatchObject({ agents: { "Deep Worker": { route: { model: "b" } } }, modelchain: { chain: [{ model: "b" }] } })
      /** Only the selected project's model leaf is edited. */
      const edits = [{ agent: "Deep Worker", leaf: "model", value: "updated-a" }]
      expect(await call("?sessionId=missing", edits)).toMatchObject({ status: 409 })
      expect(await call("?sessionId=a", edits, false)).toMatchObject({ status: 403 })
      expect(readFileSync(file("a"), "utf8")).toBe(original("a"))
      /** Read-back is immediate, with no watcher delay. */
      const saved = await call("?sessionId=a", edits)
      expect(saved.status).toBe(200)
      expect(JSON.parse(saved.body)).toMatchObject({ agents: { "Deep Worker": { route: { model: "updated-a" } } }, workspaceRoutes: { local: { "Deep Worker": { model: "updated-a" } } } })
      expect(readFileSync(file("a"), "utf8")).toBe(original("a").replace('"model": "a"', '"model": "updated-a"'))
      expect(readFileSync(file("b"), "utf8")).toBe(original("b"))
      /** Reset removes the exact field while leaving unrelated properties intact. */
      const reset = await call("?sessionId=a", [{ agent: "Deep Worker", leaf: "model" }])
      expect(reset.status).toBe(200)
      expect(JSON.parse(reset.body)).toMatchObject({ agents: { "Deep Worker": { ok: false, reason: "unconfigured" } } })
      expect(readFileSync(file("b"), "utf8")).toBe(original("b"))
    } finally {
      for (const dispose of disposers) dispose()
      rmSync(box, { recursive: true, force: true })
    }
  })

  test("a config row with NO per-agent resolver refuses instead of serving an empty table", () => {
    // An older composition exposes `get` only: the route must say so, not fabricate 11 entries.
    /** The refusal body of that composition. */
    const body = buildModelConfigBody({ get: () => ({ teamModels: { slot1: {} } }) })
    expect(body.ok).toBe(false)
    if (body.ok) throw new Error("a get-only service was accepted")
    expect(body.reason).toContain("agentRouteResolutionOf")
  })

  test("a THROWING config read answers 503 naming the error, never a partial 200", () => {
    /** The service whose typed read throws. */
    const service: ConfigDouble = { agentRouteResolutionOf: () => { throw new Error("boom") } }
    /** The refusal body of that composition. */
    const body = buildModelConfigBody(service)
    expect(body.ok).toBe(false)
    if (body.ok) throw new Error("a throwing read was accepted")
    expect(body.reason).toContain("boom")
  })
})
