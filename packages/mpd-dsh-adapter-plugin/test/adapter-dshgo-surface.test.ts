// The three DSH Go seams this wave adds — `dshGoOn`, `dshGoStrip`, `dshGoCaps` — plus the widened
// panel view. Each arm pins one of the two contract facts: a bound bridge is driven with the bridge's
// OWN call shape, and an absent or broken bridge degrades to `false`/`null` with ONE log line instead
// of throwing, so a host that is not the DSH Go app still boots the rows that publish panels.
import { expect, test } from "bun:test"
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
