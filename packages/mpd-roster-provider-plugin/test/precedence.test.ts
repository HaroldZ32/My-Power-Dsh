// R2's TEAMMATE half: the registered `mpd-roster` provider consumes the config service's FULL
// precedence chain (`agentRoutes[name]` > `teamModels.slot{N}` > defaults) PER CALL, so a saved
// route reaches the NEXT teammate — and the local slot read is only the fallback for a composition
// without the config row. Driven through the REAL delegating `start`, so the assertion is about the
// bytes the composition's provider received.
import { expect, test } from "bun:test"
import { apply, PROVIDER_NAME } from "../src/index"
import type { DshLlmCatalog } from "../../mpd-dsh-adapter-plugin/src/index"

/** The catalog the mount answers; both models declare the efforts the routes state. */
const CATALOG: DshLlmCatalog = {
  providers: [
    {
      id: "gateway",
      name: "Gateway",
      models: [
        { id: "smart", name: "Smart", efforts: [{ id: "high", name: "High" }, { id: "low", name: "Low" }] },
        { id: "smart-pro", name: "Smart Pro", efforts: [{ id: "high", name: "High" }, { id: "low", name: "Low" }] },
      ],
    },
  ],
  degraded: false,
}

/**
 * Mount the row with a LIVE config service carrying BOTH halves: the `teamModels` slot read (the
 * fallback) and the `teamModelRouteOf` precedence read (the path under test).
 *
 * @param routeOf - the precedence read the service answers with, mutable per case.
 * @param slots - the slots the fallback read answers with.
 * @returns the registered provider and the requests the delegated-to provider received.
 */
function mounted(routeOf: (member: string) => unknown, slots: Record<string, unknown>): { provider: { name: string; start: (request: unknown) => unknown }; started: Array<{ agentOptions?: Record<string, unknown> }> } {
  /** Requests the composition's own provider was handed, one per delegation. */
  const started: Array<{ agentOptions?: Record<string, unknown> }> = []
  /** The provider the row registered; assigned by the fake registration seam during `apply`. */
  let provider!: { name: string; start: (request: unknown) => unknown }
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
  /** The fake adapter mount: exactly the reads this row makes. */
  const dsh = {
    llmCatalog: async () => CATALOG,
    subagentProvider: (name: string) => (name === "spawn" ? base : undefined),
    registerSubagentProvider: (registered: unknown) => { provider = registered as { name: string; start: (request: unknown) => unknown } },
  }
  /** The cordis-shaped ctx, resolving the adapter and the two-sided config service by name. */
  const ctx: any = {
    get: (name: string) =>
      name === "mpdDsh"
        ? dsh
        : name === "mpdConfig"
          ? { get: (key: string) => (key === "teamModels" ? slots : undefined), teamModelRouteOf: routeOf }
          : undefined,
    // A disposal subscription the row may register; returning a no-op keeps the arm free of teardown.
    on: () => undefined,
  }
  apply(ctx, {})
  return { provider, started }
}

test("a labelled teammate routes by the precedence chain, and a config change reaches the NEXT teammate", async () => {
  /** The precedence route the live service answers, FLIPPED between the two starts below. */
  let route: { provider: string; model: string; reasoningEffort?: string } = { provider: "gateway", model: "smart-pro", reasoningEffort: "low" }
  /** The slot fallback, whose values the precedence route must beat. */
  const slots = { slot3: { provider: "gateway", model: "smart", reasoningEffort: "high" } }
  /** The mounted row, whose service answers BOTH reads with different values. */
  const { provider, started } = mounted((member) => (member === "Deep Worker" ? { ...route } : undefined), slots)
  expect(provider.name).toBe(PROVIDER_NAME)
  // FIRST teammate: the precedence route (smart-pro@low) wins over the slot (smart@high).
  await provider.start({ agentOptions: {}, descriptor: { label: "Deep Worker — implement the parser" } })
  expect(started[0].agentOptions).toMatchObject({ provider: "gateway", model: "smart-pro", reasoningEffort: "low" })
  // The in-process config change (an `agentRoutes` save): no re-mount, no restart — the NEXT
  // teammate routes on the new value.
  route = { provider: "gateway", model: "smart", reasoningEffort: "high" }
  await provider.start({ agentOptions: {}, descriptor: { label: "Deep Worker — implement the parser" } })
  expect(started[1].agentOptions).toMatchObject({ provider: "gateway", model: "smart", reasoningEffort: "high" })
})

test("a service without the precedence read falls back to the slot mapping, unchanged", async () => {
  /** The mounted row whose config service carries the slot read ONLY (a pre-wave composition). */
  const { provider, started } = mounted(() => undefined, { slot3: { provider: "gateway", model: "smart", reasoningEffort: "high" } })
  await provider.start({ agentOptions: {}, descriptor: { label: "Junior Engineer — fix the typo" } })
  expect(started[0].agentOptions).toMatchObject({ provider: "gateway", model: "smart", reasoningEffort: "high" })
})

test("a loud precedence error reaches the captain unchanged (never silently substituted)", async () => {
  /** The mounted row whose precedence read THROWS, as a malformed agentRoutes entry would. */
  const { provider } = mounted(() => { throw new Error("mpd-config: agentRoutes.Deep Worker must be an object of optional provider/model/reasoningEffort strings") }, {})
  // The delegating start must REJECT with the service's own error — the registered contract:
  // fail loudly naming the member, never fall through to a slot silently.
  await expect(provider.start({ agentOptions: {}, descriptor: { label: "Deep Worker — anything" } })).rejects.toThrow(/agentRoutes\.Deep Worker/)
})
