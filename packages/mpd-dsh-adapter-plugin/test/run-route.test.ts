// The slot fallback chain, consumed ONCE before a spawn (contract `.mpd/plans/slot-single-source.md`
// §8): the first route the model catalog POSITIVELY lists wins, "not listed" is not "unavailable",
// the winner passes the effort adaptation, and a malformed entry is dropped — never fatal.
import { describe, expect, test } from "bun:test"
import { resolveRunRoute, routePositivelyListed, type DshLlmCatalog } from "../src/index"

/** A catalog that lists exactly the given provider→models pairs. */
function catalogOf(pairs: Record<string, string[]>): DshLlmCatalog {
  return { degraded: false, providers: Object.entries(pairs).map(([id, models]) => ({ id, name: id, models: models.map((model) => ({ id: model, name: model, efforts: ["low", "high", "max"].map((effort) => ({ id: effort, name: effort })) })) })) }
}

/** A double adapter whose catalog read is the given catalog (or a rejecting read). */
function adapterWith(catalog: DshLlmCatalog | Error): { llmCatalog: () => Promise<DshLlmCatalog> } {
  return {
    llmCatalog: async () => {
      if (catalog instanceof Error) throw catalog
      return catalog
    },
  }
}

describe("resolveRunRoute — the primary wins whenever the catalog lists it", () => {
  test("a listed primary keeps the run, and its effort is preserved untouched", async () => {
    /** The adapter double whose catalog lists the primary. */
    const dsh = adapterWith(catalogOf({ p: ["m"] }))
    /** The resolution under test. */
    const resolved = await resolveRunRoute(dsh, { provider: "p", model: "m", reasoningEffort: "max" }, [{ provider: "bp", model: "bm" }])
    expect(resolved).toEqual({ route: { provider: "p", model: "m", reasoningEffort: "max" }, index: 0, fallback: false, dropped: 0 })
  })

  test("the FIRST positively-listed fallback wins, in the user's order", async () => {
    /** Neither the primary nor fallback #1 is listed; only fallback #2 is. */
    const dsh = adapterWith(catalogOf({ other: ["om"], backup2: ["bm2"] }))
    /** The resolution under test. */
    const resolved = await resolveRunRoute(dsh, { provider: "p", model: "m", reasoningEffort: "high" }, [
      { provider: "backup1", model: "bm1" },
      { provider: "backup2", model: "bm2", reasoningEffort: "low" },
    ])
    expect(resolved).toEqual({ route: { provider: "backup2", model: "bm2", reasoningEffort: "low" }, index: 2, fallback: true, dropped: 0 })
  })

  test("a listed PROVIDER without the model is not a positive listing", async () => {
    /** The catalog knows the provider but not the exact model id. */
    const dsh = adapterWith(catalogOf({ backup: ["other-model"] }))
    /** The resolution under test: the fallback cannot win on a provider alone. */
    const resolved = await resolveRunRoute(dsh, { provider: "p", model: "m" }, [{ provider: "backup", model: "bm" }])
    expect(resolved.index).toBe(0)
    expect(resolved.route).toEqual({ provider: "p", model: "m" })
  })
})

describe("resolveRunRoute — 'not listed' is NOT 'unavailable'", () => {
  test("when NO candidate is positively listed the PRIMARY still stands", async () => {
    /** A catalog that lists none of the candidates. */
    const dsh = adapterWith(catalogOf({ other: ["om"] }))
    /** The resolution under test. */
    const resolved = await resolveRunRoute(dsh, { provider: "p", model: "m", reasoningEffort: "low" }, [{ provider: "bp", model: "bm" }])
    expect(resolved).toEqual({ route: { provider: "p", model: "m", reasoningEffort: "low" }, index: 0, fallback: false, dropped: 0 })
  })

  test("a missing seam, an empty catalog or a rejecting read keeps the primary and never throws", async () => {
    /** The primary every degraded read must keep. */
    const primary = { provider: "p", model: "m", reasoningEffort: "high" }
    expect((await resolveRunRoute(undefined, primary, [{ provider: "bp", model: "bm" }])).route).toEqual(primary)
    expect((await resolveRunRoute(adapterWith(catalogOf({})), primary, [{ provider: "bp", model: "bm" }])).route).toEqual(primary)
    expect((await resolveRunRoute(adapterWith(new Error("catalog down")), primary, [{ provider: "bp", model: "bm" }])).route).toEqual(primary)
  })
})

describe("resolveRunRoute — malformed fallbacks are dropped, and the effort rule still applies", () => {
  test("malformed entries are counted and never fail the run", async () => {
    /** The catalog lists the well-formed fallback, so it must still win after three drops. */
    const dsh = adapterWith(catalogOf({ backup: ["bm"] }))
    /** The resolution under test, whose chain carries every malformed shape. */
    const resolved = await resolveRunRoute(dsh, { provider: "p", model: "m" }, [
      null,
      "not-an-object",
      { provider: "backup" },
      { provider: "backup", model: 7 },
      { provider: "backup", model: "bm", reasoningEffort: 9 },
      { provider: "backup", model: "bm" },
    ])
    expect(resolved.dropped).toBe(5)
    expect(resolved.route).toEqual({ provider: "backup", model: "bm" })
    // A non-array chain is an empty chain, never a throw.
    expect((await resolveRunRoute(dsh, { provider: "p", model: "m" }, "nope" as unknown as unknown[])).route).toEqual({ provider: "p", model: "m" })
  })

  test("the WINNER's effort is adapted when its model declares no reasoning efforts", async () => {
    /** A catalog whose fallback model declares an EMPTY effort list, plus a provider for the primary. */
    const dsh = { llmCatalog: async (): Promise<DshLlmCatalog> => ({ degraded: false, providers: [{ id: "backup", name: "backup", models: [{ id: "bm", name: "bm", efforts: [] }] }] }) }
    /** The resolution under test: the primary is unlisted, the fallback wins, and its effort drops. */
    const resolved = await resolveRunRoute(dsh, { provider: "p", model: "m" }, [{ provider: "backup", model: "bm", reasoningEffort: "max" }])
    expect(resolved.route).toEqual({ provider: "backup", model: "bm" })
    expect(resolved.route).not.toHaveProperty("reasoningEffort")
  })
})

describe("routePositivelyListed — the exact predicate the chain acts on", () => {
  test("both halves must match, and nothing else counts", () => {
    /** A catalog with one provider and one model. */
    const catalog = catalogOf({ p: ["m"] })
    expect(routePositivelyListed(catalog, "p", "m")).toBe(true)
    expect(routePositivelyListed(catalog, "p", "other")).toBe(false)
    expect(routePositivelyListed(catalog, "other", "m")).toBe(false)
    expect(routePositivelyListed(catalog, "other", "other")).toBe(false)
  })
})
