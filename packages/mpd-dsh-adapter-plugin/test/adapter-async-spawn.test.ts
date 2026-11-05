// The async one-shot seam (§D2.1): `spawnAgentAsync` returns a handle WITHOUT awaiting the child,
// disposes the activation when the report settles, and `spawnAgent` stays the blocking projection
// with its documented `{output, structured, stopReason}` shape.
import { describe, expect, test } from "bun:test"
import { createDshAdapter } from "../src/index.ts"

/** One externally-settled promise used as an activation's `result`. */
function deferred(): { promise: Promise<any>; resolve: (value: any) => void } {
  /** The resolver captured by the executor. */
  let resolve: (value: any) => void = (): void => undefined
  /** The promise itself. */
  const promise = new Promise<any>((res) => { resolve = res })
  return { promise, resolve }
}

/** A ctx double exposing the one service this seam needs and a no-op event bus. */
function ctxWith(subagents: any): any {
  return {
    get: (name: string, _strict?: boolean) => (name === "subagents" ? subagents : undefined),
    on: () => () => undefined,
  }
}

/** A 0.2.1 subagent service whose activation is settled by the caller. */
function serviceWith(activation: any, calls: Array<{ seam: string; args: unknown[] }>): any {
  /** The service object, so the receiver is assertable after construction. */
  const service: any = {
    startActivation: async function (this: unknown, spec: any): Promise<any> {
      calls.push({ seam: "startActivation", args: [spec, this === service] })
      return activation
    },
    interrupt: (target: any, authority: any): void => { calls.push({ seam: "interrupt", args: [target, authority] }) },
  }
  return service
}

describe("spawnAgentAsync (§D2.1)", () => {
  test("returns a handle BEFORE the child settles, then disposes once on settle", async () => {
    /** The activation's report settlement. */
    const settled = deferred()
    /** The calls the fake service recorded. */
    const calls: Array<{ seam: string; args: unknown[] }> = []
    /** Whether dispose ran. */
    let disposed = 0
    /** The activation handle the service hands out. */
    const activation = { childId: "child-1", result: settled.promise, dispose: (): Promise<void> => { disposed += 1; return Promise.resolve() } }
    /** The service under test. */
    const service = serviceWith(activation, calls)
    /** The adapter under test. */
    const adapter = createDshAdapter(ctxWith(service))
    /** The started handle — this must resolve while `result` is still pending. */
    const handle = await adapter.spawnAgentAsync({ label: "look", prompt: "go", parent: {} })
    expect(handle.id).toBe("child-1")
    expect(disposed).toBe(0)
    settled.resolve({ output: "the answer", structured: { summary: "s" }, stopReason: "completed" })
    /** The normalized report. */
    const report = await handle.result
    expect(report.output).toBe("the answer")
    expect(report.structured).toEqual({ summary: "s" })
    expect(report.stopReason).toBe("completed")
    expect(disposed).toBe(1)
  })

  test("interrupt targets THIS child's session id and the handle stays idempotent", async () => {
    /** The activation's report settlement. */
    const settled = deferred()
    /** The calls the fake service recorded. */
    const calls: Array<{ seam: string; args: unknown[] }> = []
    /** The activation handle the service hands out. */
    const activation = { childId: "child-2", result: settled.promise, dispose: (): Promise<void> => Promise.resolve() }
    /** The service under test. */
    const service = serviceWith(activation, calls)
    /** The adapter under test. */
    const adapter = createDshAdapter(ctxWith(service))
    /** The started handle. */
    const handle = await adapter.spawnAgentAsync({ label: "look", prompt: "go" })
    handle.interrupt()
    handle.interrupt()
    expect(calls.filter((call) => call.seam === "interrupt").length).toBe(1)
    expect(calls.find((call) => call.seam === "interrupt")?.args[0]).toBe("child-2")
    settled.resolve({ output: "stopped", stopReason: "interrupted" })
    expect((await handle.result).stopReason).toBe("interrupted")
  })

  test("interrupt presents the SPAWNING parent as the ancestor authority", async () => {
    /** The activation's report settlement (never resolved: only the interrupt is asserted here). */
    const settled = deferred()
    /** The calls the fake service recorded. */
    const calls: Array<{ seam: string; args: unknown[] }> = []
    /** The activation handle the service hands out. */
    const activation = { childId: "child-4", result: settled.promise, dispose: (): Promise<void> => Promise.resolve() }
    /** The adapter under test. */
    const adapter = createDshAdapter(ctxWith(serviceWith(activation, calls)))
    /** The parent Agent the spawn is authorized by — the authority the interrupt must carry. */
    const parent = { session: { id: "captain" } }
    /** The started handle, spawned AS that parent. */
    const handle = await adapter.spawnAgentAsync({ label: "look", prompt: "go", parent })
    handle.interrupt()
    /** The interrupt call the seam saw. */
    const interruptCall = calls.find((call) => call.seam === "interrupt")
    expect(interruptCall?.args[0]).toBe("child-4")
    expect(interruptCall?.args[1]).toEqual({ kind: "ancestor", agent: parent })
  })

  test("a THROWN interrupt falls back to the raw handle's abort()", async () => {
    /** How many times the raw handle was aborted. */
    let aborts = 0
    /** The activation: a child that never settles, with its own abort fallback. */
    const activation: any = { childId: "child-5", result: new Promise<any>(() => undefined), dispose: (): Promise<void> => Promise.resolve(), abort: (): void => { aborts += 1 } }
    /** The service whose interrupt REFUSES the call. */
    const service = {
      startActivation: async (): Promise<any> => activation,
      interrupt: (): void => { throw new Error("the authority was refused") },
    }
    /** The adapter under test. */
    const adapter = createDshAdapter(ctxWith(service))
    /** The started handle. */
    const handle = await adapter.spawnAgentAsync({ label: "look", prompt: "go", parent: {} })
    handle.interrupt()
    // A refused interrupt must not leave the child running: the raw abort is the fallback.
    expect(aborts).toBe(1)
  })

  test("an ASYNCHRONOUSLY REJECTED interrupt also falls back to abort()", async () => {
    /** How many times the raw handle was aborted. */
    let aborts = 0
    /** The activation: a child that never settles, with its own abort fallback. */
    const activation: any = { childId: "child-6", result: new Promise<any>(() => undefined), dispose: (): Promise<void> => Promise.resolve(), abort: (): void => { aborts += 1 } }
    /** The service whose interrupt returns a REJECTED promise (an async host generation). */
    const service = {
      startActivation: async (): Promise<any> => activation,
      interrupt: async (): Promise<void> => { throw new Error("the authority was refused") },
    }
    /** The adapter under test. */
    const adapter = createDshAdapter(ctxWith(service))
    /** The started handle. */
    const handle = await adapter.spawnAgentAsync({ label: "look", prompt: "go", parent: {} })
    handle.interrupt()
    // The rejection settles on the microtask queue, so the fallback lands one tick later.
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(aborts).toBe(1)
  })

  test("spawnAgent remains the BLOCKING projection with the unchanged shape", async () => {
    /** The activation's report settlement. */
    const settled = deferred()
    /** The calls the fake service recorded. */
    const calls: Array<{ seam: string; args: unknown[] }> = []
    /** The activation handle the service hands out. */
    const activation = { childId: "child-3", result: settled.promise, dispose: (): Promise<void> => Promise.resolve() }
    /** The adapter under test. */
    const adapter = createDshAdapter(ctxWith(serviceWith(activation, calls)))
    /** Settle before the blocking call resumes, so it returns the normalized shape. */
    settled.resolve({ output: "blocking answer", structured: 7, stopReason: "completed" })
    /** The awaited report. */
    const report = await adapter.spawnAgent({ label: "look", prompt: "go" })
    expect(report).toEqual({ output: "blocking answer", structured: 7, stopReason: "completed" })
  })
})

describe("spawnAgentAsync on the RETIRED generation (§D2.1)", () => {
  test("start() is used and its run handle keeps the non-blocking contract", async () => {
    /** The run's settlement. */
    const settled = deferred()
    /** The calls the fake service recorded. */
    const calls: Array<{ seam: string; args: unknown[] }> = []
    /** The retired service: `start(mode, request)` returns a run handle. */
    const service = {
      start: async (mode: string, request: any): Promise<any> => {
        calls.push({ seam: "start", args: [mode, request] })
        return { id: "run-1", result: settled.promise }
      },
    }
    /** The adapter under test. */
    const adapter = createDshAdapter(ctxWith(service))
    /** The started handle. */
    const handle = await adapter.spawnAgentAsync({ label: "look", prompt: "go" })
    expect(handle.id).toBe("run-1")
    expect(calls.map((call) => call.seam)).toEqual(["start"])
    settled.resolve({ output: "retired answer", stopReason: "completed" })
    expect((await handle.result).output).toBe("retired answer")
  })
})
