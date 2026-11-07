// The three DSH Go seams this wave adds — `dshGoOn`, `dshGoStrip`, `dshGoCaps` — plus the widened
// panel view. Each arm pins one of the two contract facts: a bound bridge is driven with the bridge's
// OWN call shape, and an absent or broken bridge degrades to `false`/`null` with ONE log line instead
// of throwing, so a host that is not the DSH Go app still boots the rows that publish panels.
import { describe, expect, test } from "bun:test"
import { createDshAdapter } from "../src/index.ts"

/** The slice of a cordis ctx these arms drive: a service lookup and an inert event bus. */
interface FakeCtx {
  /** Resolve one service by name; undefined models a composition without it. */
  get(name: string): unknown
  /** Register a bus listener; the adapter only needs a disposer back. */
  on(): () => void
  /** Provide a service; the adapter's own registration is not what these arms test. */
  provide(): void
}

/**
 * Build an adapter bound to the given service table.
 * @param services - the service objects this composition exposes.
 * @returns the adapter under test.
 */
function adapterWith(services: Record<string, unknown>): ReturnType<typeof createDshAdapter> {
  /** The fake ctx the adapter resolves services through. */
  const ctx: FakeCtx = {
    get: (name: string) => services[name],
    on: (): (() => void) => () => {},
    provide: () => {},
  }
  return createDshAdapter(ctx)
}

test("dshGoOn registers the tap handler with the bridge and returns true", () => {
  /** What the bridge recorded when the seam called it. */
  const recorded: { id?: string; handler?: unknown } = {}
  /** The bridge double: only `on` is needed for this arm. */
  const bridge = { on: (id: string, handler: unknown) => { recorded.id = id; recorded.handler = handler } }
  /** The adapter under test. */
  const adapter = adapterWith({ dshGo: bridge })
  /** A handler whose return value must reach the bridge unchanged. */
  const handler = (): { toast: string } => ({ toast: "已派活" })
  expect(adapter.dshGoOn("mpd-dispatch", handler)).toBe(true)
  expect(recorded.id).toBe("mpd-dispatch")
  expect(recorded.handler).toBe(handler)
  expect((recorded.handler as () => unknown)()).toEqual({ toast: "已派活" })
})

test("dshGoOn degrades to false when the bridge is absent, has no on(), or throws", () => {
  expect(adapterWith({}).dshGoOn("x", () => undefined)).toBe(false)
  expect(adapterWith({ dshGo: {} }).dshGoOn("x", () => undefined)).toBe(false)
  expect(adapterWith({ dshGo: { on: () => { throw new Error("boom") } } }).dshGoOn("x", () => undefined)).toBe(false)
})

test("dshGoStrip registers the data function and returns true", () => {
  /** What the bridge recorded when the seam called it. */
  const recorded: { id?: string; dataFn?: unknown } = {}
  /** The bridge double: only `strip` is needed for this arm. */
  const bridge = { strip: (id: string, dataFn: unknown) => { recorded.id = id; recorded.dataFn = dataFn } }
  /** A data function the bridge would drive. */
  const dataFn = (): (() => void) => () => {}
  expect(adapterWith({ dshGo: bridge }).dshGoStrip("mpd-status", dataFn)).toBe(true)
  expect(recorded.id).toBe("mpd-status")
  expect(recorded.dataFn).toBe(dataFn)
})

test("dshGoStrip degrades to false when the bridge is absent, has no strip(), or throws", () => {
  expect(adapterWith({}).dshGoStrip("x", () => () => {})).toBe(false)
  expect(adapterWith({ dshGo: {} }).dshGoStrip("x", () => () => {})).toBe(false)
  expect(adapterWith({ dshGo: { strip: () => { throw new Error("boom") } } }).dshGoStrip("x", () => () => {})).toBe(false)
})

test("dshGoCaps reads a caps() method first", () => {
  /** The bridge double: a `caps()` answer with a mixed component list. */
  const bridge = { caps: () => ({ app: "1.0.9", locale: "zh", components: ["stack", 7, "tabs"], surfaces: ["panels"], extra: "ignored" }) }
  expect(adapterWith({ dshGo: bridge }).dshGoCaps()).toEqual({ app: "1.0.9", locale: "zh", components: ["stack", "tabs"], surfaces: ["panels"] })
})

test("dshGoCaps falls back to a caps or capabilities property", () => {
  expect(adapterWith({ dshGo: { caps: { app: "1.0.9" } } }).dshGoCaps()).toEqual({ app: "1.0.9" })
  expect(adapterWith({ dshGo: { capabilities: { locale: "en" } } }).dshGoCaps()).toEqual({ locale: "en" })
})

test("dshGoCaps degrades to null when the bridge cannot answer", () => {
  expect(adapterWith({}).dshGoCaps()).toBeNull()
  expect(adapterWith({ dshGo: {} }).dshGoCaps()).toBeNull()
  expect(adapterWith({ dshGo: { caps: () => { throw new Error("boom") } } }).dshGoCaps()).toBeNull()
  expect(adapterWith({ dshGo: { caps: "nope" } }).dshGoCaps()).toBeNull()
  expect(adapterWith({ dshGo: { caps: () => "nope" } }).dshGoCaps()).toBeNull()
})

test("dshGoPanel forwards a per-render view function verbatim", () => {
  /** What the bridge recorded when the seam called it. */
  const recorded: { id?: string; spec?: unknown } = {}
  /** The bridge double: only `panel` is needed for this arm. */
  const bridge = { panel: (id: string, spec: unknown) => { recorded.id = id; recorded.spec = spec } }
  /** A view function receiving the invocation scope and caps. */
  const view = (scope: { sessionId?: string }, caps: { app?: string }): Record<string, unknown> => ({ type: "stack", children: [{ type: "text", text: `${scope.sessionId}:${caps.app}` }] })
  /** The spec the panel lane would publish. */
  const spec = { view, data: { ready: 3 }, actions: { refresh: (): undefined => undefined } }
  expect(adapterWith({ dshGo: bridge }).dshGoPanel("mpd", spec)).toBe(true)
  expect(recorded.id).toBe("mpd")
  expect(recorded.spec).toBe(spec)
})

test("dshGoPresent reports whether the bridge is bound", () => {
  expect(adapterWith({ dshGo: { panel: () => undefined } }).dshGoPresent()).toBe(true)
  expect(adapterWith({}).dshGoPresent()).toBe(false)
})

test("a class-based bridge keeps its receiver on every seam (repair T10 #11)", () => {
  /**
   * A bridge whose members read `this`, which is what a real service object may do.
   *
   * The adapter calls `member(args)` DETACHED on `dshGoOn`, and `read()` detached on `dshGoCaps`; an
   * unbound read throws a TypeError there and the degrade path turns it into `false`/`null`, i.e. a
   * silently dead composer action, strip and capability read. This arm fails unless the seam binds.
   */
  class ClassBridge {
    /** The sink the registered handlers land in; a detached call cannot reach it. */
    readonly handlers: Array<{ id: string; handler: unknown }> = []
    /** The capabilities this bridge reports; a detached call throws on `this`. */
    readonly capabilities = { app: "1.0.9", locale: "zh-CN" }
    /** Register one handler through the receiver. */
    on(id: string, handler: unknown): boolean {
      this.handlers.push({ id, handler })
      return true
    }
    /** Publish one strip through the receiver. */
    strip(id: string, dataFn: unknown): boolean {
      return id !== "" && typeof dataFn === "function"
    }
    /** Report the capabilities through the receiver. */
    caps(): { app: string; locale: string } {
      return this.capabilities
    }
  }
  /** The bridge under test. */
  const bridge = new ClassBridge()
  /** The adapter over it. */
  const adapter = adapterWith({ dshGo: bridge })
  expect(adapter.dshGoOn("mpd-dispatch", () => ({ toast: "ok" }))).toBe(true)
  expect(bridge.handlers.map((entry) => entry.id)).toEqual(["mpd-dispatch"])
  expect(adapter.dshGoStrip("mpd-status", () => () => {})).toBe(true)
  expect(adapter.dshGoCaps()).toEqual({ app: "1.0.9", locale: "zh-CN" })
})

// ── R11: the deferred, standard binding form ─────────────────────────────────────────────────
//
// The DSH Go native-plugin standard binds the host half with `ctx.inject(['dshGo'], …)` — not
// `'dshGo?'`, which cordis does not implement, and not a top-level `inject` entry, which would keep
// a bridgeless host from starting the row at all. These arms pin the ONE binding the adapter
// registers, the scoped service it hands the seams, and the older path that must keep working when
// the inject seam is missing, throws, or yields nothing.

/** The slice of a cordis ctx a DEFERRED-INJECT arm drives: a root probe plus the inject seam. */
interface DeferredCtx {
  /** Resolve one ROOT service; a service provided below the root is deliberately invisible here. */
  get(name: string): unknown
  /** Register a bus listener; the adapter only needs a disposer back. */
  on(): () => void
  /** Provide a service; these arms never register one. */
  provide(): void
  /** The deferred inject seam: records the dependency list and keeps the callback for `fire`. */
  inject(deps: readonly string[], callback: (scoped: unknown) => void): () => void
}

/** One deferred binding as the ctx recorded it, plus the handle that fires it. */
interface DeferredBinding {
  /** The adapter under test, built BEFORE the inject fires (the race a real host can produce). */
  adapter: ReturnType<typeof createDshAdapter>
  /** Every dependency list the adapter injected, in call order. */
  deps: string[][]
  /** Run the recorded inject callback against one scoped ctx, as cordis does when the seam binds. */
  fire(scoped: Record<string, unknown>): void
}

/**
 * Build an adapter over a ctx whose `dshGo` lives BELOW the root — the shape the deferred inject
 * exists for — and hand back the seam the arm fires.
 * @param rootServices - what the ROOT ctx can see; empty models a root probe blind to the bridge.
 * @returns the adapter, the recorded dependency lists and the fire function.
 */
function deferredAdapter(rootServices: Record<string, unknown> = {}): DeferredBinding {
  /** Every dependency list the adapter injected. */
  const deps: string[][] = []
  /** The callback the adapter registered, until the arm fires it. */
  let callback: ((scoped: unknown) => void) | undefined
  /** The root ctx double: services come from the table, the inject records instead of resolving. */
  const ctx: DeferredCtx = {
    get: (name: string): unknown => rootServices[name],
    on: (): (() => void) => () => {},
    provide: (): void => {},
    inject: (names: readonly string[], cb: (scoped: unknown) => void): (() => void) => {
      deps.push([...names])
      callback = cb
      return () => {}
    },
  }
  return {
    adapter: createDshAdapter(ctx),
    deps,
    fire: (scoped: Record<string, unknown>): void => {
      callback?.(scoped)
    },
  }
}

describe("the bridge is bound with the deferred ctx.inject form", () => {
  test("ONE ctx.inject(['dshGo'], …) is registered and the service arrives through it", () => {
    /** What the bridge recorded when a seam reached it. */
    const recorded: { id?: string } = {}
    /** The bridge double; it exists only BELOW the root, exactly like a scoped service. */
    const bridge = { panel: (id: string): void => { recorded.id = id } }
    /** The adapter plus its deferred seam. */
    const deferred = deferredAdapter()
    // The standard's binding form, literally: one deferred binding, for the one seam.
    expect(deferred.deps).toEqual([["dshGo"]])
    // A root probe answers nothing, so the inject is the ONLY channel to the bridge.
    expect(deferred.adapter.dshGoPresent()).toBe(false)
    expect(deferred.adapter.dshGoPanel("mpd", { view: { type: "text", text: "x" } })).toBe(false)
    deferred.fire({ dshGo: bridge })
    expect(deferred.adapter.dshGoPresent()).toBe(true)
    expect(deferred.adapter.dshGoPanel("mpd", { view: { type: "text", text: "x" } })).toBe(true)
    expect(recorded.id).toBe("mpd")
  })

  test("a scoped ctx that answers only through get() still binds", () => {
    /** A bridge reachable through the scoped `get` form alone. */
    const bridge = { caps: { app: "1.0.9" } }
    /** The adapter plus its deferred seam. */
    const deferred = deferredAdapter()
    deferred.fire({ get: (name: string): unknown => (name === "dshGo" ? bridge : undefined) })
    expect(deferred.adapter.dshGoPresent()).toBe(true)
    expect(deferred.adapter.dshGoCaps()).toEqual({ app: "1.0.9" })
  })

  test("a fired inject that yields no service leaves the root probe in charge (older host)", () => {
    /** The bridge the OLD path already reached through the root ctx. */
    const bridge = { on: (): boolean => true }
    /** The adapter plus its deferred seam, over a root that serves the bridge directly. */
    const deferred = deferredAdapter({ dshGo: bridge })
    deferred.fire({ get: (): undefined => undefined })
    expect(deferred.adapter.dshGoPresent()).toBe(true)
    expect(deferred.adapter.dshGoOn("mpd-dispatch", () => undefined)).toBe(true)
  })

  test("a bridgeless host registers nothing and reaches no bridge", () => {
    /** The adapter plus the inject that never fires: the DSH Go app is not this host. */
    const deferred = deferredAdapter()
    expect(deferred.deps).toEqual([["dshGo"]])
    expect(deferred.adapter.dshGoPresent()).toBe(false)
    expect(deferred.adapter.dshGoOn("mpd-dispatch", () => undefined)).toBe(false)
    expect(deferred.adapter.dshGoStrip("mpd-status", () => () => {})).toBe(false)
    expect(deferred.adapter.dshGoCaps()).toBeNull()
  })

  test("an inject seam that throws, or no seam at all, keeps the lazy root probe working", () => {
    /** The bridge a legacy composition serves from the root ctx. */
    const bridge = { panel: (): void => {}, on: (): boolean => true }
    /** A ctx whose inject seam refuses the registration. */
    const throwing = {
      get: (name: string): unknown => (name === "dshGo" ? bridge : undefined),
      on: (): (() => void) => () => {},
      provide: (): void => {},
      inject: (): void => { throw new Error("no deferred inject on this ctx") },
    }
    /** The adapter built over it must not throw, and must still reach the bridge. */
    const adapter = createDshAdapter(throwing)
    expect(adapter.dshGoPresent()).toBe(true)
    expect(adapter.dshGoPanel("mpd", { view: { type: "text", text: "x" } })).toBe(true)
    // And a ctx with NO inject seam (the pre-R11 double shape) is the same older path.
    expect(adapterWith({ dshGo: bridge }).dshGoPresent()).toBe(true)
  })

  test("the deferred inject wakes the onServiceBound subscribers the surface rows registered", () => {
    /** The adapter plus a seam whose event BUS is inert, so only the inject can wake a subscriber. */
    const deferred = deferredAdapter()
    /** The names the kept subscriber was woken with. */
    const kept: string[] = []
    /** The names the disposed subscriber was woken with; it must stay empty. */
    const dropped: string[] = []
    /** The names a subscriber for ANOTHER service was woken with; it must stay empty too. */
    const unrelated: string[] = []
    /** The live subscription: the wake under test. */
    const offKept = deferred.adapter.onServiceBound(["dshGo"], (name: string): void => { kept.push(name) })
    /** The subscription disposed BEFORE the bind: it must not be woken. */
    const offDropped = deferred.adapter.onServiceBound(["dshGo"], (name: string): void => { dropped.push(name) })
    /** A subscription for a different service: the dshGo wake must not reach it. */
    const offUnrelated = deferred.adapter.onServiceBound(["mpdConfig"], (name: string): void => { unrelated.push(name) })
    // The bus never fires in this double; a disposed subscriber must not be woken either.
    offDropped()
    deferred.fire({ dshGo: { panel: (): void => {} } })
    expect(kept).toEqual(["dshGo"])
    expect(dropped).toEqual([])
    expect(unrelated).toEqual([])
    offKept()
    offUnrelated()
  })
})
