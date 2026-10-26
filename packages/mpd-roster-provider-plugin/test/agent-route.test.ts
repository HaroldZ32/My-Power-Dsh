// The registered `mpd-roster` provider, driven through its REAL delegating `start`: the agent's OWN
// `agentRoutes` entry is the only route source (contract `.mpd/plans/agent-routes-per-agent.md`
// §4 + §8), an unusable route refuses the spawn BEFORE the composition's provider is touched, and a
// label naming no member inherits — the identity pass-through this row must never lose.
import { expect, test } from "bun:test"
import { apply, PROVIDER_NAME } from "../src/index"
import type { DshLlmCatalog } from "../../mpd-dsh-adapter-plugin/src/index"

/** The catalog the mount answers; every model declares the efforts the routes state. */
const CATALOG: DshLlmCatalog = {
  providers: [
    { id: "gateway", name: "Gateway", models: [{ id: "smart", name: "Smart", efforts: [{ id: "high", name: "High" }, { id: "low", name: "Low" }] }] },
    { id: "backup", name: "Backup", models: [{ id: "spare", name: "Spare", efforts: [{ id: "high", name: "High" }] }] },
  ],
  degraded: false,
}

/** One route an `agentRoutes` entry may declare. */
type Route = { provider: string; model: string; reasoningEffort?: string; fallbacks?: readonly unknown[] }

/** One resolution the config service double answers with — the contract's TOTAL union (§2). */
type Resolution =
  | { ok: true; agent: string; route: Route }
  | { ok: false; reason: "unconfigured"; agent: string; missing: readonly string[] }
  | { ok: false; reason: "invalid"; agent: string; problem: string }
  | { ok: false; reason: "unrouted" }

/**
 * Mount the row with a config-service double and a composition provider that records what it got.
 * @param resolutionOf - the TOTAL resolution the service answers per member.
 * @returns the registered provider and the requests the delegated-to provider received.
 */
function mounted(resolutionOf: (member: string) => Resolution): { provider: { name: string; start: (request: unknown) => unknown }; started: AnyRecord[] } {
  /** Requests the composition's own provider was handed, one per delegation. */
  const started: AnyRecord[] = []
  /** The provider the row registered; assigned by the fake registration seam during `apply`. */
  let provider!: { name: string; start: (request: unknown) => unknown }
  /** The composition's own provider a delegation delegates TO. */
  const base = {
    name: "spawn",
    capabilities: {},
    inheritsParentContext: false,
    start: async (request: unknown): Promise<unknown> => {
      started.push(request as AnyRecord)
      return { ok: true }
    },
  }
  /** The fake adapter mount: exactly the reads this row makes. */
  const dsh = {
    llmCatalog: async () => CATALOG,
    subagentProvider: (name: string) => (name === "spawn" ? base : undefined),
    registerSubagentProvider: (registered: unknown) => { provider = registered as { name: string; start: (request: unknown) => unknown } },
  }
  /** The cordis-shaped ctx, resolving the adapter and the config service by name. */
  const ctx: any = {
    get: (name: string) => (name === "mpdDsh" ? dsh : name === "mpdConfig" ? { agentRouteResolutionOf: resolutionOf } : undefined),
    on: () => undefined,
  }
  apply(ctx, {})
  return { provider, started }
}

/** An open record shape for the request/options assertions below. */
type AnyRecord = { agentOptions?: Record<string, unknown>; [key: string]: unknown }

test("a labelled teammate runs on its OWN agentRoutes entry, re-read per spawn", async () => {
  /** The resolution the service answers, FLIPPED between the two starts below. */
  let live: Resolution = { ok: true, agent: "Deep Worker", route: { provider: "gateway", model: "smart", reasoningEffort: "high" } }
  /** The mounted row, whose service answers the mutable resolution. */
  const { provider, started } = mounted(() => live)
  expect(provider.name).toBe(PROVIDER_NAME)
  await provider.start({ agentOptions: {}, descriptor: { label: "Deep Worker — implement the parser" } })
  expect(started[0].agentOptions).toMatchObject({ provider: "gateway", model: "smart", reasoningEffort: "high" })
  // The in-process config change: the NEXT teammate carries it, no re-mount and no restart.
  live = { ok: true, agent: "Deep Worker", route: { provider: "backup", model: "spare", reasoningEffort: "low" } }
  await provider.start({ agentOptions: {}, descriptor: { label: "Deep Worker — implement the parser" } })
  expect(started[1].agentOptions).toMatchObject({ provider: "backup", model: "spare", reasoningEffort: "low" })
})

test("TWO members with DIFFERENT routes run independently — no cross-talk (§9)", async () => {
  /** One route per roster agent, different in BOTH provider and model. */
  const routes: Record<string, Route> = {
    "Deep Worker": { provider: "gateway", model: "smart" },
    Architect: { provider: "backup", model: "spare" },
  }
  /** The mounted row with a per-agent resolution. */
  const { provider, started } = mounted((member) => ({ ok: true, agent: member, route: { ...routes[member] } }))
  await provider.start({ agentOptions: {}, descriptor: { label: "Deep Worker — implement" } })
  await provider.start({ agentOptions: {}, descriptor: { label: "Architect — review" } })
  expect(started[0].agentOptions).toMatchObject({ provider: "gateway", model: "smart" })
  expect(started[1].agentOptions).toMatchObject({ provider: "backup", model: "spare" })
})

test("an UNCONFIGURED route refuses the spawn with AGENT_UNCONFIGURED, and the composition's provider is NEVER called", async () => {
  /** The canonical refusal the config service reports for an unconfigured agent. */
  const refusal: Resolution = {
    ok: false,
    reason: "unconfigured",
    agent: "Deep Worker",
    missing: ["agentRoutes.Deep Worker.provider", "agentRoutes.Deep Worker.model"],
  }
  /** The mounted row with that service. */
  const { provider, started } = mounted(() => refusal)
  /** The rejection the start must raise; captured so its message and code can be read. */
  const error: any = await (provider.start({ agentOptions: {}, descriptor: { label: "Deep Worker — anything" } }) as Promise<unknown>).then(() => null, (e: unknown) => e)
  expect(error).not.toBeNull()
  /** The refusal's sentence, read once so every fact below is asserted against the same bytes. */
  const message = String(error.message)
  expect(message).toContain("AGENT_UNCONFIGURED")
  expect(message).toContain("Deep Worker")
  expect(message).toContain("agentRoutes.Deep Worker.provider")
  expect(message).toContain("agentRoutes.Deep Worker.model")
  expect(message).toContain("nothing was written and no child was started")
  expect(error.code).toBe("AGENT_UNCONFIGURED")
  // The DoD arm: the composition's provider was never reached, so no child exists.
  expect(started).toEqual([])
})

test("a MALFORMED leaf is equally fatal — one structured failure, never a substituted route", async () => {
  /** The `invalid` state the service reports for a present-but-non-string leaf. */
  const refusal: Resolution = { ok: false, reason: "invalid", agent: "Architect", problem: "agentRoutes.Architect.model" }
  /** The mounted row with that service. */
  const { provider, started } = mounted(() => refusal)
  /** The rejection the start must raise. */
  const error: any = await (provider.start({ agentOptions: {}, descriptor: { label: "Architect — boundaries" } }) as Promise<unknown>).then(() => null, (e: unknown) => e)
  expect(String(error?.message)).toContain("must be a string")
  expect(String(error?.message)).toContain("agentRoutes.Architect.model")
  expect(error?.code).toBe("AGENT_UNCONFIGURED")
  expect(started).toEqual([])
})

test("a label that names NO member INHERITS: the request is forwarded by identity (§4)", async () => {
  /** A service that would refuse every agent — proving it is never consulted for an unnamed label. */
  const { provider, started } = mounted(() => ({ ok: false, reason: "unconfigured", agent: "Deep Worker", missing: ["agentRoutes.Deep Worker.provider"] }))
  /** The request with a route the teammate must keep. */
  const request = { agentOptions: { provider: "captain-provider", model: "captain-model" }, descriptor: { label: "check the vendored corpus" } }
  await provider.start(request)
  expect(started[0]).toBe(request)
})

test("an UNROUTED name also inherits, rather than failing", async () => {
  /** A service that reports the label's name as unrouted (not a roster agent). */
  const { provider, started } = mounted(() => ({ ok: false, reason: "unrouted" }))
  /** The request the teammate must keep unchanged. */
  const request = { agentOptions: { provider: "lead-provider", model: "lead-model" }, descriptor: { label: "Architect — boundaries" } }
  await provider.start(request)
  expect(started[0]).toBe(request)
})

test("the agent's fallback chain is consumed once, before the spawn (catalog-positive first win)", async () => {
  /** A resolution whose primary is NOT listed but whose fallback IS. */
  const withFallback: Resolution = {
    ok: true,
    agent: "Researcher",
    route: { provider: "unlisted", model: "nothing", fallbacks: [{ provider: "gateway", model: "smart", reasoningEffort: "low" }] },
  }
  /** The mounted row with that chain. */
  const { provider, started } = mounted(() => withFallback)
  await provider.start({ agentOptions: {}, descriptor: { label: "Researcher — survey" } })
  expect(started[0].agentOptions).toMatchObject({ provider: "gateway", model: "smart", reasoningEffort: "low" })
})
