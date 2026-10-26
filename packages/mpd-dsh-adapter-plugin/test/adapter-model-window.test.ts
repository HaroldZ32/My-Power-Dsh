// THE MODEL-WINDOW PROJECTION (cellwork wave 1, A2): the HARNESS's resolved window and output cap
// reach the catalog, and an unresolved limit is `null` — never a constant.
//
// WHAT THIS FILE PROVES. The split-time budget reads this projection instead of a literal, so the
// catalog must carry `resolveModelInfo().context.contextWindow` and `defaultMaxTokens` VERBATIM, must
// write BOTH keys on every model (so a consumer can tell "producer did not report" from "the harness
// resolved nothing"), and must never substitute a plausible-looking window.
import { describe, expect, test } from "bun:test"

import { createDshAdapter } from "../src/index"

/**
 * Build a ctx whose ONLY service is the model registry, the one seam this projection reads.
 * @param llm - the fake `llm` service.
 * @returns the ctx the real adapter resolves through.
 */
function llmOnlyCtx(llm: unknown): { get: (name: string) => unknown } {
  return { get: (name: string): unknown => (name === "llm" ? llm : undefined) }
}

describe("the catalog carries the window the harness itself resolved", () => {
  test("context.contextWindow and defaultMaxTokens land on the model verbatim", async () => {
    /** A registry whose one model reports both limits. */
    const llm = {
      listProviders: () => [{ id: "deepseek-official", name: "DeepSeek Official" }],
      listModels: async () => [{ provider: "deepseek-official", id: "deepseek-v4-pro", name: "DeepSeek V4 Pro" }],
      resolveModelInfo: async () => ({
        provider: "deepseek-official",
        id: "deepseek-v4-pro",
        name: "DeepSeek V4 Pro",
        context: { contextWindow: 123456 },
        defaultMaxTokens: 8192,
        reasoning: { efforts: [{ id: "max", name: "Max" }], defaultEffort: "max" },
      }),
    }
    /** The projected catalog. */
    const catalog = await createDshAdapter(llmOnlyCtx(llm)).llmCatalog()
    // A non-round window (123456) proves the value is passed through, not matched against a table.
    expect(catalog.providers[0].models[0]).toEqual({
      id: "deepseek-v4-pro",
      name: "DeepSeek V4 Pro",
      efforts: [{ id: "max", name: "Max" }],
      defaultEffort: "max",
      contextWindow: 123456,
      maxOutputTokens: 8192,
    })
  })

  test("an unresolved window AND cap are both present as null, never a fallback", async () => {
    /** A registry whose model resolves no limits at all. */
    const llm = {
      listProviders: () => [{ id: "p", name: "P" }],
      listModels: async () => [{ id: "anonymous", name: "Anonymous" }],
      resolveModelInfo: async () => ({ provider: "p", id: "anonymous", name: "Anonymous" }),
    }
    /** The projected catalog. */
    const catalog = await createDshAdapter(llmOnlyCtx(llm)).llmCatalog()
    /** The one projected model. */
    const model = catalog.providers[0].models[0]
    // KEY PRESENCE is part of the contract: without it a consumer cannot distinguish a producer
    // that omitted the field from a harness that resolved nothing.
    expect(Object.hasOwn(model, "contextWindow")).toBe(true)
    expect(Object.hasOwn(model, "maxOutputTokens")).toBe(true)
    expect(model.contextWindow).toBeNull()
    expect(model.maxOutputTokens).toBeNull()
  })

  test("one resolved limit never invents the other", async () => {
    /** A registry whose model reports a window but no output cap. */
    const llm = {
      listProviders: () => [{ id: "p", name: "P" }],
      listModels: async () => [{ id: "window-only", name: "Window Only" }],
      resolveModelInfo: async () => ({ provider: "p", id: "window-only", name: "Window Only", context: { contextWindow: 64000 } }),
    }
    /** The projected catalog. */
    const catalog = await createDshAdapter(llmOnlyCtx(llm)).llmCatalog()
    /** The one projected model. */
    const model = catalog.providers[0].models[0]
    expect(model.contextWindow).toBe(64000)
    expect(model.maxOutputTokens).toBeNull()
  })

  test("a resolved output cap without a window leaves the window null", async () => {
    /** A registry whose model reports an output cap but no window. */
    const llm = {
      listProviders: () => [{ id: "p", name: "P" }],
      listModels: async () => [{ id: "cap-only", name: "Cap Only" }],
      resolveModelInfo: async () => ({ provider: "p", id: "cap-only", name: "Cap Only", defaultMaxTokens: 4096 }),
    }
    /** The projected catalog. */
    const catalog = await createDshAdapter(llmOnlyCtx(llm)).llmCatalog()
    /** The one projected model. */
    const model = catalog.providers[0].models[0]
    expect(model.contextWindow).toBeNull()
    expect(model.maxOutputTokens).toBe(4096)
  })
})
