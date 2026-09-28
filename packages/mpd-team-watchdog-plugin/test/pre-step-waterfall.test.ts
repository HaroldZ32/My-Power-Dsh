// DEFECT THIS FILE PINS (measured 2026-09-16 on a real mpd session, turn 113):
// `Cannot read properties of undefined (reading 'map')` — raised the instant the user
// sent ANY message, before the model call, recorded as
// `turn/end {reason:{kind:"error",error:{code:"UNKNOWN"}}}`, and reproducible on a
// freshly booted process.
//
// Cause: `agent/pre-step` is a CORDIS WATERFALL. `EventsService.waterfall` calls the
// listeners outermost-first with `next` appended and does
// `(cbs.shift() ?? inner)(...args)` — so a listener that returns WITHOUT calling
// `next()` VETOES the rest of the chain and its own return value BECOMES the step
// decision. The heartbeat writer was
// `(payload) => this.stamp("step", …)`, i.e. it returned a HeartbeatStamp. That stamp
// — an object with no `messages` — replaced the `{kind:'enter', messages}` decision,
// and the first consumer to read `decision.messages` died: the turn loop's `.length`
// check, the adopted agent-teams policy's `.findLastIndex`, or a `.map` in the
// assembly path, depending on the workspace state.
//
// Why the existing suite was blind: every heartbeat test drives the engine with the
// `stubCtx()` of `heartbeat.test.ts`, whose `on` merely RECORDS the handler and never
// applies dispatch semantics — so a handler that never delegates looks perfect.
//
// The test therefore drives the REAL vendored `@deepseek-ai/cordis` waterfall (the same
// implementation the installed harness dispatches through) and carries a NEGATIVE
// CONTROL that re-enacts the old shape, so the assertion is falsifiable: if cordis ever
// stops vetoing on a non-`next()` return, the control fails and this file must be
// re-read rather than trusted.
import { describe, expect, test } from "bun:test"
// The vendored cordis build ships no declaration file, so this module resolves to `any`; the
// directive stays loud and self-healing rather than a blanket `@ts-ignore`.
// @ts-expect-error vendored JavaScript has no declaration file
import { Context } from "../../mpd-agent-teams-plugin/_deps/cordis/lib/index.js"
import { WatchdogEngine, type EngineContext } from "../src/engine"
import type { DshAdapter } from "../../mpd-dsh-adapter-plugin/src/index.js"
import { readHeartbeats } from "../src/store"
import { agent, sandbox, stubAdapter, testConfig, writeTeam, type StubAdapter } from "./support"

/** The decision shape the harness's own turn loop consumes. */
const FALLBACK = { kind: "enter" as const, messages: ["claimed-user-message"] }

/**
 * A stub adapter whose `onEvent` forwards to a REAL cordis context.
 *
 * The engine subscribes through the ADAPTER (AGENTS.md §6), and the real adapter forwards
 * to `ctx.on` — so a test that drives `ctx.waterfall` / `ctx.emit` needs that forwarding,
 * not a stub-private listener map. This IS the production contract, not a test shortcut.
 */
function adapterOn(ctx: Context, stub: StubAdapter): DshAdapter {
  return {
    ...stub.adapter,
    onEvent: (event: string, handler: (...args: unknown[]) => unknown) => {
      // The real cordis subscription handle.
      const disposer = ctx.on(event as never, handler as never)
      return typeof disposer === "function" ? (disposer as unknown as () => void) : () => { /* bus owns teardown */ }
    },
  }
}

/** One engine whose listeners land on a REAL cordis context. */
function realEngine(box: { workspace: string; stateDir: string }): { ctx: Context; handle: WatchdogEngine; stub: StubAdapter; disposers: (() => void)[]; dispose: () => void } {
  // The real cordis context whose waterfall the harness dispatches through. Its type is the
  // vendored module's own `Context` export, written down because that module is untyped.
  const ctx: Context = new Context()
  // The stub adapter whose `onEvent` is overlaid with real forwarding.
  const stub = stubAdapter({ workspace: box.workspace })
  // The engine subscribes through the ADAPTER (`dsh.onEvent`), and the REAL adapter
  // forwards to `ctx.on`. This test needs the listener on the REAL cordis bus (it drives
  // `ctx.waterfall`), so the stub adapter's `onEvent` is overlaid with exactly that
  // forwarding — the production contract, not a test-only shortcut. The disposer is the
  // real context's, so disposal is exercised too (a broken disposer would leak listeners).
  const handle = new WatchdogEngine(adapterOn(ctx, stub), ctx as unknown as EngineContext, testConfig({ stateDir: box.stateDir }))
  // Teardown callbacks for every listener the engine installed.
  const disposers = handle.install()
  return { ctx, handle, stub, disposers, dispose: () => { for (const off of disposers) off() } }
}

describe("agent/pre-step is a waterfall (the decision must survive a heartbeat)", () => {
  test("the pre-step listener DELEGATES: the decision reaches the harness unchanged", () => {
    // An isolated workspace for this case.
    const box = sandbox()
    try {
      writeTeam(box, {
        id: "team-a",
        members: [{ id: "a1", name: "Architect" }],
        tasks: [{ id: "t1", status: "in_progress", assignee: "Architect", attempt: 1, attemptId: "att-1" }],
      })
      // The real-bus engine; its disposal runs in the inner finally.
      const { ctx, dispose } = realEngine(box)
      try {
        // The decision the harness's own turn loop would consume; held as `unknown` because the
        // vendored waterfall it arrives through is untyped, and narrowed at each use below.
        const decision: unknown = ctx.waterfall(ctx, "agent/pre-step", { agent: agent("a1", box.workspace) }, () => ({ ...FALLBACK }))
        // The defect: this used to be the HeartbeatStamp `{kind:"step", …}`.
        expect(decision).toEqual(FALLBACK)
        expect((decision as { messages?: unknown }).messages).toEqual(FALLBACK.messages)
        // …and the stamp the listener exists for WAS still written for the stepping agent.
        const stamps = readHeartbeats(box.workspace, box.stateDir, "Architect")
        expect(stamps.length).toBe(1)
        expect(stamps[0].kind).toBe("step")
        expect(stamps[0].taskId).toBe("t1")
      } finally {
        dispose()
      }
    } finally {
      box.cleanup()
    }
  })

  test("the listener delegates DOWNSTREAM: a later listener still runs and its decision wins", () => {
    // An isolated workspace for this case.
    const box = sandbox()
    try {
      writeTeam(box, { id: "team-a", members: [{ id: "a1", name: "Architect" }], tasks: [] })
      // The real-bus engine for this case.
      const { ctx, dispose } = realEngine(box)
      try {
        // The downstream listeners that actually ran, in order.
        const seen: string[] = []
        // Registered AFTER the engine's listener, i.e. strictly inner in the chain.
        ctx.on("agent/pre-step", (payload: unknown, next: () => unknown) => {
          seen.push("inner")
          // What the rest of the chain decided, read as the harness's own shape.
          const inner = next() as typeof FALLBACK
          return { ...inner, messages: [...inner.messages, "added-by-inner"] }
        })
        // The composed decision, into which the inner listener's edit must survive.
        const decision: unknown = ctx.waterfall(ctx, "agent/pre-step", { agent: agent("a1", box.workspace) }, () => ({ ...FALLBACK }))
        expect(seen).toEqual(["inner"])
        expect(decision).toEqual({ kind: "enter", messages: ["claimed-user-message", "added-by-inner"] })
      } finally {
        dispose()
      }
    } finally {
      box.cleanup()
    }
  })

  test("NEGATIVE CONTROL: the retired shape really does clobber the decision", () => {
    // Without this, the two tests above could pass on a cordis that no longer vetoes,
    // and the pin would silently stop measuring anything.
    const ctx: Context = new Context()
    // The retired shape: a listener returning a stamp instead of delegating.
    const stampLike = { kind: "step", at: Date.now(), memberKey: "Architect" }
    ctx.on("agent/pre-step", () => stampLike)
    // The composed decision the stamp-shaped listener replaced.
    const clobbered: unknown = ctx.waterfall(ctx, "agent/pre-step", { agent: { id: "a1" } }, () => ({ ...FALLBACK }))
    expect(clobbered).toEqual(stampLike)
    expect((clobbered as { messages?: unknown }).messages).toBeUndefined()
  })

  test("no listener we install returns a value on a non-waterfall dispatch (emit/serial)", async () => {
    // An isolated workspace for this case.
    const box = sandbox()
    try {
      writeTeam(box, { id: "team-a", members: [{ id: "a1", name: "Architect" }], tasks: [] })
      // Every handler registered on the engine's own ctx, by event name.
      const recorded = new Map<string, (...args: any[]) => unknown>()
      // An engine context that only records handlers; no bus semantics are involved.
      const ctx: EngineContext = {
        on: ((event: string, handler: (...args: any[]) => unknown) => {
          recorded.set(event, handler)
          return () => recorded.delete(event)
        }) as EngineContext["on"],
      }
      // The stub adapter whose `onEvent` is overlaid with real forwarding.
      const stub = stubAdapter({ workspace: box.workspace })
      // The engine whose handlers are asserted to return nothing.
      const handle = new WatchdogEngine(adapterOn(ctx, stub), ctx, testConfig({ stateDir: box.stateDir }))
      // Teardown callbacks for every listener the engine installed.
      const disposers = handle.install()
      try {
        // A session-start payload carrying the stepping agent.
        const payload = { agent: agent("a1", box.workspace), source: { kind: "startup" } }
        // Each handler must really be registered — an absent one would make the three
        // assertions below vacuously true (`?.()` on undefined).
        for (const event of ["agent/session-start", "agent/turn-stopping", "agent/pre-step"]) {
          expect(typeof recorded.get(event)).toBe("function")
        }
        // `agent/session-start` is an emit: a returned stamp would be meaningless today and
        // a bail value the day the harness dispatches it serially.
        expect(recorded.get("agent/session-start")?.(payload)).toBeUndefined()
        // `agent/turn-stopping` is a SERIAL dispatch: `isBailed` stops the chain on any
        // return that is not null/false/undefined, so this MUST stay undefined.
        expect(recorded.get("agent/turn-stopping")?.({ agent: agent("a1", box.workspace) })).toBeUndefined()
        // The pre-step handler keeps its signature and delegates when `next` is supplied.
        // The downstream continuation the pre-step handler must delegate to.
        const next = (): typeof FALLBACK => ({ ...FALLBACK })
        expect(recorded.get("agent/pre-step")?.({ agent: agent("a1", box.workspace) }, next)).toEqual(FALLBACK)
      } finally {
        for (const off of disposers) off()
      }
    } finally {
      box.cleanup()
    }
  })

  test("a THROWING stamp still delegates: a heartbeat failure never vetoes the step", () => {
    // `subscribe`'s own containment answers a thrown handler with `undefined`, which in a
    // waterfall is a VETO (the chain never reaches `next()`) — so the handler contains the
    // stamp itself and delegates anyway. The decision must survive a broken heartbeat.
    const box = sandbox()
    try {
      writeTeam(box, { id: "team-a", members: [{ id: "a1", name: "Architect" }], tasks: [] })
      // The real cordis context, so the waterfall path is exercised.
      const ctx: Context = new Context()
      // The stub adapter whose `onEvent` is overlaid with real forwarding.
      const stub = stubAdapter({ workspace: box.workspace })
      // The engine whose stamp is replaced with a thrower below.
      const handle = new WatchdogEngine(adapterOn(ctx, stub), ctx as unknown as EngineContext, testConfig({ stateDir: box.stateDir }))
      // Lines the engine's own warn channel produced.
      const warnings: string[] = []
      ;(handle as unknown as { warn: (text: string) => void }).warn = (text: string) => { warnings.push(text) }
      ;(handle as unknown as { stamp: () => never }).stamp = () => { throw new Error("store exploded") }
      // Teardown callbacks for every listener the engine installed.
      const disposers = handle.install()
      try {
        // The decision, which must survive the throwing stamp.
        const decision: unknown = ctx.waterfall(ctx, "agent/pre-step", { agent: agent("a1", box.workspace) }, () => ({ ...FALLBACK }))
        expect(decision).toEqual(FALLBACK)
        expect(warnings.length).toBe(1)
        expect(warnings[0]).toContain("store exploded")
      } finally {
        for (const off of disposers) off()
      }
    } finally {
      box.cleanup()
    }
  })
})
