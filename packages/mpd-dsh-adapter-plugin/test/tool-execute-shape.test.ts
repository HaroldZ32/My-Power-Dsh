// mpd-dsh-adapter SHAPE-ADAPTATION tests: harness 0.2.1 took `ToolsService.execute(single call)` and
// harness 0.2.2 replaced it with `execute({ calls: [...] })`. These arms pin BOTH sides against fake
// registries: the payload the adapter BUILDS for each shape, the result it projects from each answer,
// the agent passthrough, and that a genuine tool error still surfaces — the shim never discovers a
// shape by throwing, so no real error can be swallowed as a mismatch.
import { describe, expect, test } from "bun:test"
import { createDshAdapter } from "../src/index"

/** One payload a fake registry received, read as the loose record the seam is at that boundary. */
type CapturedPayload = Record<string, any>

/**
 * A ctx whose ONLY service is the tools registry — exactly what `executeTool` reads.
 * @param tools - the fake registry the adapter must drive.
 * @returns the ctx double.
 */
function ctxWith(tools: unknown): any {
  return { get: (name: string) => (name === "tools" ? tools : undefined), on: () => () => {}, provide: () => {} }
}

/**
 * A 0.2.2-SHAPED registry: `resolve()` and `executable()` exist only on the batch generation, which
 * is the capability the adapter feature-detects.
 * @param answer - what `execute` resolves with.
 * @returns the fake service plus every payload it received.
 */
function batchRegistry(answer: unknown): { service: Record<string, unknown>; payloads: CapturedPayload[] } {
  /** The payloads this registry received, in call order. */
  const payloads: CapturedPayload[] = []
  return {
    payloads,
    service: {
      resolve: () => ({ tools: [] }),
      executable: () => undefined,
      execute: async (payload: CapturedPayload) => { payloads.push(payload); return answer },
    },
  }
}

/**
 * A 0.2.1-SHAPED registry: neither `resolve` nor `executable` exists, so the single-call contract is
 * the one it answers.
 * @param answer - what `execute` resolves with.
 * @returns the fake service plus every payload it received.
 */
function singleCallRegistry(answer: unknown): { service: Record<string, unknown>; payloads: CapturedPayload[] } {
  /** The payloads this registry received, in call order. */
  const payloads: CapturedPayload[] = []
  return {
    payloads,
    service: { execute: async (payload: CapturedPayload) => { payloads.push(payload); return answer } },
  }
}

describe("ToolsService.execute shape adaptation", () => {
  test("a BATCH registry is asked with { calls: [...] } carrying a RAW JSON STRING, and results[0].result is projected", async () => {
    /** The batch-shaped fake and its recorded payloads. */
    const fake = batchRegistry({ results: [{ callId: "call-1", result: { isError: false, value: { echo: { a: 1 } }, content: [] } }] })
    /** The adapter over it. */
    const adapter = createDshAdapter(ctxWith(fake.service))
    expect(await adapter.executeTool({ name: "ok", arguments: { a: 1 }, callId: "call-1" }))
      .toMatchObject({ ok: true, isError: false, value: { echo: { a: 1 } } })
    expect(fake.payloads.length).toBe(1)
    /** The one payload the adapter built. */
    const payload = fake.payloads[0]!
    expect(payload.calls).toEqual([{ type: "tool-call", id: "call-1", name: "ok", arguments: JSON.stringify({ a: 1 }) }])
    // The argument ENCODING is the raw JSON string, never the object.
    expect(typeof payload.calls[0].arguments).toBe("string")
    // The batch envelope replaces the single-call fields instead of mixing both.
    expect("name" in payload).toBe(false)
    expect("arguments" in payload).toBe(false)
    // `signal` is REQUIRED by the batch contract and really is an AbortSignal.
    expect(typeof payload.signal?.throwIfAborted).toBe("function")
    // No caller agent was given, so none rides the execution.
    expect("agent" in payload).toBe(false)
  })

  test("a SINGLE-CALL registry keeps the 0.2.1 payload and no batch envelope", async () => {
    /** The single-call fake and its recorded payloads. */
    const fake = singleCallRegistry({ value: { echo: { a: 1 } } })
    /** The adapter over it. */
    const adapter = createDshAdapter(ctxWith(fake.service))
    expect(await adapter.executeTool({ name: "ok", arguments: { a: 1 }, callId: "call-1" }))
      .toMatchObject({ ok: true, isError: false, value: { echo: { a: 1 } } })
    expect(fake.payloads.length).toBe(1)
    /** The one payload the adapter built. */
    const payload = fake.payloads[0]!
    expect(payload.name).toBe("ok")
    expect(payload.arguments).toEqual({ a: 1 })
    expect(payload.callId).toBe("call-1")
    expect(typeof payload.signal?.throwIfAborted).toBe("function")
    expect("calls" in payload).toBe(false)
    expect("agent" in payload).toBe(false)
  })

  test("the calling agent rides BOTH shapes verbatim, and stays absent when not given", async () => {
    /** The calling Agent the adapter must forward. */
    const liveAgent = { id: "captain-session" }
    /** The batch-shaped fake. */
    const batch = batchRegistry({ results: [{ callId: "call-2", result: { isError: false, value: 1 } }] })
    /** The single-call fake. */
    const single = singleCallRegistry({ value: 1 })
    await createDshAdapter(ctxWith(batch.service)).executeTool({ name: "t", callId: "call-2", agent: liveAgent })
    await createDshAdapter(ctxWith(single.service)).executeTool({ name: "t", callId: "call-3", agent: liveAgent })
    expect(batch.payloads[0]!.agent).toBe(liveAgent)
    expect(single.payloads[0]!.agent).toBe(liveAgent)
  })

  test("a genuine tool ERROR surfaces on both shapes and is never swallowed", async () => {
    /** The batch answer for a denied call: the SAME `ToolExecutionResult` shape, nested once. */
    const batch = batchRegistry({ results: [{ callId: "call-4", result: { isError: true, error: { message: "denied" }, content: [] } }] })
    /** The single-call answer for the same denial. */
    const single = singleCallRegistry({ isError: true, error: { message: "denied" } })
    expect(await createDshAdapter(ctxWith(batch.service)).executeTool({ name: "fails", callId: "call-4" }))
      .toMatchObject({ ok: false, isError: true, error: "denied" })
    expect(await createDshAdapter(ctxWith(single.service)).executeTool({ name: "fails", callId: "call-5" }))
      .toMatchObject({ ok: false, isError: true, error: "denied" })
  })

  test("a registry that THROWS surfaces one error result and is never retried in the other shape", async () => {
    /** A batch-shaped registry whose executor rejects with a plain Error. */
    const payloads: CapturedPayload[] = []
    /** The batch-shaped fake that throws. */
    const service = {
      resolve: () => ({ tools: [] }),
      execute: async (payload: CapturedPayload) => { payloads.push(payload); throw new Error("tool exploded") },
    }
    expect(await createDshAdapter(ctxWith(service)).executeTool({ name: "boom" }))
      .toMatchObject({ ok: false, isError: true, error: "tool exploded" })
    // ONE attempt only: a blind second call in the other shape would push a second payload.
    expect(payloads.length).toBe(1)
  })

  test("toolRuntime().execute returns the RAW per-call result on both shapes", async () => {
    /** The per-call outcome the batch shape nests under `results[0].result`. */
    const callResult = { isError: false as const, value: { echo: "x" }, content: [] }
    /** The batch-shaped fake. */
    const batch = batchRegistry({ results: [{ callId: "call-6", result: callResult }] })
    /** The single-call fake answering with the same outcome unwrapped. */
    const single = singleCallRegistry(callResult)
    expect(await createDshAdapter(ctxWith(batch.service)).toolRuntime().execute({ name: "ok", callId: "call-6" })).toEqual(callResult)
    expect(await createDshAdapter(ctxWith(single.service)).toolRuntime().execute({ name: "ok", callId: "call-7" })).toEqual(callResult)
  })
})
