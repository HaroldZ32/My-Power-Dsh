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
import { Context } from "../../mpd-agent-teams-plugin/_deps/cordis/lib/index.js"
import { WatchdogEngine, type EngineContext } from "../src/engine"
import { readHeartbeats } from "../src/store"
import { agent, sandbox, stubAdapter, testConfig, writeTeam } from "./support"

/** The decision shape the harness's own turn loop consumes. */
const FALLBACK = { kind: "enter" as const, messages: ["claimed-user-message"] }

/** One engine whose listeners land on a REAL cordis context. */
function realEngine(box: { workspace: string; stateDir: string }) {
  const ctx = new Context()
  const stub = stubAdapter({ workspace: box.workspace })
  // The engine only needs `ctx.on`; `subscribe` keeps the disposer the real context
  // returns, so disposal is exercised too (a broken disposer would leak listeners).
  const handle = new WatchdogEngine(stub.adapter, ctx as unknown as EngineContext, testConfig({ stateDir: box.stateDir }))
  const disposers = handle.install()
  return { ctx, handle, stub, disposers, dispose: () => { for (const off of disposers) off() } }
}

describe("agent/pre-step is a waterfall (the decision must survive a heartbeat)", () => {
  test("the pre-step listener DELEGATES: the decision reaches the harness unchanged", () => {
    const box = sandbox()
    try {
      writeTeam(box, {
        id: "team-a",
        members: [{ id: "a1", name: "Architect" }],
        tasks: [{ id: "t1", status: "in_progress", assignee: "Architect", attempt: 1, attemptId: "att-1" }],
      })
      const { ctx, dispose } = realEngine(box)
      try {
        const decision = ctx.waterfall(ctx, "agent/pre-step", { agent: agent("a1", box.workspace) }, () => ({ ...FALLBACK }))
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
    const box = sandbox()
    try {
      writeTeam(box, { id: "team-a", members: [{ id: "a1", name: "Architect" }], tasks: [] })
      const { ctx, dispose } = realEngine(box)
      try {
        const seen: string[] = []
        // Registered AFTER the engine's listener, i.e. strictly inner in the chain.
        ctx.on("agent/pre-step", (payload: unknown, next: () => unknown) => {
          seen.push("inner")
          const inner = next() as typeof FALLBACK
          return { ...inner, messages: [...inner.messages, "added-by-inner"] }
        })
        const decision = ctx.waterfall(ctx, "agent/pre-step", { agent: agent("a1", box.workspace) }, () => ({ ...FALLBACK }))
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
    const ctx = new Context()
    const stampLike = { kind: "step", at: Date.now(), memberKey: "Architect" }
    ctx.on("agent/pre-step", () => stampLike)
    const clobbered = ctx.waterfall(ctx, "agent/pre-step", { agent: { id: "a1" } }, () => ({ ...FALLBACK }))
    expect(clobbered).toEqual(stampLike)
    expect((clobbered as { messages?: unknown }).messages).toBeUndefined()
  })

  test("no listener we install returns a value on a non-waterfall dispatch (emit/serial)", async () => {
    const box = sandbox()
    try {
      writeTeam(box, { id: "team-a", members: [{ id: "a1", name: "Architect" }], tasks: [] })
      const recorded = new Map<string, (...args: any[]) => unknown>()
      const ctx: EngineContext = {
        on: ((event: string, handler: (...args: any[]) => unknown) => {
          recorded.set(event, handler)
          return () => recorded.delete(event)
        }) as EngineContext["on"],
      }
      const stub = stubAdapter({ workspace: box.workspace })
      const handle = new WatchdogEngine(stub.adapter, ctx, testConfig({ stateDir: box.stateDir }))
      const disposers = handle.install()
      try {
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
        const next = () => ({ ...FALLBACK })
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
      const ctx = new Context()
      const stub = stubAdapter({ workspace: box.workspace })
      const handle = new WatchdogEngine(stub.adapter, ctx as unknown as EngineContext, testConfig({ stateDir: box.stateDir }))
      const warnings: string[] = []
      ;(handle as unknown as { warn: (text: string) => void }).warn = (text: string) => { warnings.push(text) }
      ;(handle as unknown as { stamp: () => never }).stamp = () => { throw new Error("store exploded") }
      const disposers = handle.install()
      try {
        const decision = ctx.waterfall(ctx, "agent/pre-step", { agent: agent("a1", box.workspace) }, () => ({ ...FALLBACK }))
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
