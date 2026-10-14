// THE OFFICIAL-TEAMMATE PATH'S model-capability adaptation, driven through the REAL delegating `start`.
//
// `route.test.ts` pins the pure routing decision; this file pins what that file CANNOT: that a teammate
// whose slot names a model with no reasoning efforts reaches the composition's provider WITHOUT the
// keyword, while a teammate whose slot names a reasoning model still carries it. The fake mount supplies
// the catalog read and the composition's own provider, and that provider records the request it finally
// received — so the assertion is about the bytes on the wire, not about a helper's return value.
import { expect, test } from "bun:test"
import { apply, PROVIDER_NAME } from "../src/index"
import type { DshLlmCatalog } from "../../mpd-dsh-adapter-plugin/src/index"

/** The slots the fake config service answers: slot1 is effort-less (plain), slot3 is a reasoning model. */
const SLOTS = {
  slot1: { provider: "gateway", model: "fast", reasoningEffort: "max" },
  slot3: { provider: "gateway", model: "smart", reasoningEffort: "high" },
}

/** The catalog the mount answers; `fast` declares no efforts, `smart` declares `high`. */
const CATALOG: DshLlmCatalog = {
  providers: [
    {
      id: "gateway",
      name: "Gateway",
      models: [
        { id: "fast", name: "Fast", efforts: [] },
        { id: "smart", name: "Smart", efforts: [{ id: "high", name: "High" }] },
      ],
    },
  ],
  degraded: false,
}

/** The services one mounted row needs from its harness seams. */
interface Mount {
  /** The provider the row registered, recorded by the fake registration seam. */
  provider: { name: string; start: (request: unknown) => unknown }
  /** The requests the composition's own provider was finally handed, one per delegating `start`. */
  started: Array<{ agentOptions?: Record<string, unknown> }>
}

/**
 * Mount the row against doubles for its three collaborators: the adapter (`mpdDsh`, supplying the
 * catalog), the config service (`mpdConfig`, supplying the slots) and the composition's own provider
 * (reached through the adapter's `subagentProvider`).
 *
 * @returns the registered provider and the requests the delegated-to provider received.
 */
function mounted(): Mount {
  /** Requests the composition's own provider was handed, one per delegation. */
  const started: Array<{ agentOptions?: Record<string, unknown> }> = []
  /** The provider the row registered; assigned by the fake registration seam during `apply`. */
  let provider!: Mount["provider"]
  /** The composition's own provider a delegation delegates TO. */
  const base = {
    name: "spawn",
    capabilities: {},
    inheritsParentContext: false,
    start: async (request: unknown): Promise<unknown> => {
      started.push(request as { agentOptions?: Record<string, unknown> })
      return { ok: true }
    },
  }
  /** The fake adapter mount: exactly the three reads this row makes. */
  const dsh = {
    llmCatalog: async () => CATALOG,
    subagentProvider: (name: string) => (name === "spawn" ? base : undefined),
    registerSubagentProvider: (registered: unknown) => { provider = registered as Mount["provider"] },
  }
  /** The cordis-shaped ctx, resolving the adapter and the config service by name. */
  const ctx: any = {
    get: (name: string) => (name === "mpdDsh" ? dsh : name === "mpdConfig" ? { get: (key: string) => (key === "teamModels" ? SLOTS : undefined) } : undefined),
    // A disposal subscription the row may register; returning a no-op keeps the arm free of teardown.
    on: () => undefined,
  }
  apply(ctx, {})
  return { provider, started }
}

test("a teammate routed onto an effort-less model reaches the base provider WITHOUT the keyword", async () => {
  /** The mounted row and its recorded delegation. */
  const { provider, started } = mounted()
  expect(provider.name).toBe(PROVIDER_NAME)
  await provider.start({
    descriptor: { label: "Architect — split the module" },
    // The Lead's OWN route carries an effort; the slot's route must REPLACE it, adapted to the model.
    agentOptions: { provider: "lead-provider", model: "lead-model", reasoningEffort: "low", maxDepth: 3 },
  })
  expect(started.length).toBe(1)
  // provider/model come from slot1, the unrelated field survives, and NO effort is sent at all.
  expect(started[0].agentOptions).toEqual({ provider: "gateway", model: "fast", maxDepth: 3 })
})

test("CONTROL: a teammate routed onto a model that DECLARES efforts still carries the slot's keyword", async () => {
  /** The mounted row and its recorded delegation. */
  const { provider, started } = mounted()
  await provider.start({ descriptor: { label: "Deep Worker — implement it" }, agentOptions: {} })
  expect(started.length).toBe(1)
  // slot3 states `high` and the model declares `high`: the adaptation must leave it exactly there.
  expect(started[0].agentOptions).toEqual({ provider: "gateway", model: "smart", reasoningEffort: "high" })
})

test("a teammate whose label names NO member still inherits, untouched by the adaptation", async () => {
  /** The mounted row and its recorded delegation. */
  const { provider, started } = mounted()
  /** The Lead route a non-matching label must keep byte for byte. */
  const inherited = { provider: "lead-provider", model: "lead-model", reasoningEffort: "low" }
  await provider.start({ descriptor: { label: "check the vendored corpus" }, agentOptions: inherited })
  expect(started[0].agentOptions).toEqual(inherited)
})
