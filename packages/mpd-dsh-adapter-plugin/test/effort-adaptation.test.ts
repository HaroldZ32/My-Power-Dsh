// THE MODEL-CAPABILITY ADAPTATION for a reasoning-effort route — the defect and its bounds in one file.
//
// WHY THIS FILE EXISTS. A `teamModels` slot is read MATERIALISED over its schema defaults, so a slot
// whose model declares NO reasoning efforts at all still carried the slot's default `max`/`high`. That
// keyword was forced into the run and the provider refused the call — the reported defect.
// `withSupportedEffort` is the ONE place that decision is made, so this file pins all THREE of its
// answers: DROP on a model the catalog lists with `efforts: []`, KEEP on a model that declares efforts
// (supported or not), and KEEP on every "no knowledge" state (an unknown model, a composition with no
// catalog seam, and a catalog read that rejects).
import { describe, expect, test } from "bun:test"
import { modelDeclaresNoEffort, withSupportedEffort, type DshLlmCatalog } from "../src/index"

/** A catalog with one effort-less model and one reasoning model; anything else is deliberately absent. */
const CATALOG: DshLlmCatalog = {
  providers: [
    {
      id: "gateway",
      name: "Gateway",
      models: [
        { id: "plain", name: "Plain", efforts: [] },
        { id: "thinking", name: "Thinking", efforts: [{ id: "high", name: "High" }, { id: "max", name: "Max" }] },
      ],
    },
  ],
  degraded: false,
}

/** A catalog reader double whose answer is fixed, counting its reads so "never read" is provable. */
function reader(catalog: DshLlmCatalog | Error): { llmCatalog: () => Promise<DshLlmCatalog>; reads: () => number } {
  /** How many times the catalog was asked; an arm that must not read asserts this stays 0. */
  let reads = 0
  return {
    llmCatalog: async () => {
      reads += 1
      if (catalog instanceof Error) throw catalog
      return catalog
    },
    reads: () => reads,
  }
}

describe("modelDeclaresNoEffort", () => {
  test("true only for a listed model whose efforts array is EMPTY", () => {
    expect(modelDeclaresNoEffort(CATALOG, "gateway", "plain")).toBe(true)
    expect(modelDeclaresNoEffort(CATALOG, "gateway", "thinking")).toBe(false)
  })

  test("an unlisted provider or model is NO KNOWLEDGE, never an inferred incapability", () => {
    expect(modelDeclaresNoEffort(CATALOG, "nobody", "plain")).toBe(false)
    expect(modelDeclaresNoEffort(CATALOG, "gateway", "nobody")).toBe(false)
    // A degraded read that listed nothing answers the same way: absence is not evidence.
    expect(modelDeclaresNoEffort({ providers: [], degraded: true }, "gateway", "plain")).toBe(false)
  })
})

describe("withSupportedEffort", () => {
  test("an absent route or an absent effort is returned BY IDENTITY, and the catalog is never read", async () => {
    /** The counting reader, so "the catalog was not consulted" is measured rather than assumed. */
    const r = reader(CATALOG)
    expect(await withSupportedEffort(r, undefined)).toBeUndefined()
    /** A route that states no effort at all: there is nothing to adapt. */
    const noEffort = { provider: "gateway", model: "plain" }
    expect(await withSupportedEffort(r, noEffort)).toBe(noEffort)
    expect(r.reads()).toBe(0)
  })

  test("THE DEFECT: a model listed with NO efforts loses the keyword, so the call runs", async () => {
    /** The route the reported failure forced onto an effort-less model. */
    const route = { provider: "gateway", model: "plain", reasoningEffort: "max" }
    /** The adapted route the caller must send instead. */
    const adapted = await withSupportedEffort(reader(CATALOG), route)
    // A NEW object, and the only difference is the missing keyword — the provider/model travel as given.
    expect(adapted).not.toBe(route)
    expect(adapted).toEqual({ provider: "gateway", model: "plain" })
    expect("reasoningEffort" in (adapted ?? {})).toBe(false)
    // The caller's own object is never mutated.
    expect(route.reasoningEffort).toBe("max")
  })

  test("a model that DECLARES efforts keeps the keyword UNCHANGED, supported or not", async () => {
    // The contract's other half: an unsupported value here is a visible configuration error, never
    // silently swapped for another effort. Identity proves nothing was rebuilt.
    /** A keyword the model offers. */
    const supported = { provider: "gateway", model: "thinking", reasoningEffort: "max" }
    expect(await withSupportedEffort(reader(CATALOG), supported)).toBe(supported)
    /** A keyword the model does NOT offer: it must still travel unchanged. */
    const unsupported = { provider: "gateway", model: "thinking", reasoningEffort: "low" }
    expect(await withSupportedEffort(reader(CATALOG), unsupported)).toBe(unsupported)
  })

  test("NO KNOWLEDGE keeps the keyword: an unknown model, no catalog seam, and a rejected read", async () => {
    /** A route for a model the catalog does not list. */
    const unknown = { provider: "somewhere", model: "else", reasoningEffort: "max" }
    expect(await withSupportedEffort(reader(CATALOG), unknown)).toBe(unknown)
    expect(await withSupportedEffort({}, unknown)).toBe(unknown)
    expect(await withSupportedEffort(reader(new Error("llm unavailable")), unknown)).toBe(unknown)
    // The SAME two degradations on the effort-less model: only a CATALOG ENTRY may drop a keyword.
    /** The effort-less route, which a blind read must leave alone. */
    const plain = { provider: "gateway", model: "plain", reasoningEffort: "max" }
    expect(await withSupportedEffort({}, plain)).toBe(plain)
    expect(await withSupportedEffort(reader(new Error("llm unavailable")), plain)).toBe(plain)
  })
})
