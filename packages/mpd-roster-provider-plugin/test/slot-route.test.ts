// The registered `mpd-roster` provider, driven through its REAL delegating `start`: the SLOT is the
// only route source (contract `.mpd/plans/slot-single-source.md` §6-§8), an unusable slot refuses the
// spawn BEFORE the composition's provider is touched, and a label naming no member inherits.
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

/** One resolution the config service double answers with. */
type Resolution =
  | { ok: true; route: { provider: string; model: string; reasoningEffort?: string }; fallbacks?: readonly unknown[] }
  | { ok: false; status: "unconfigured" | "invalid"; code: string; message: string }
  | { ok: false; status: "unrouted" }

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
    get: (name: string) => (name === "mpdDsh" ? dsh : name === "mpdConfig" ? { slotResolutionOf: resolutionOf } : undefined),
    on: () => undefined,
  }
  apply(ctx, {})
  return { provider, started }
}

/** An open record shape for the request/options assertions below. */
type AnyRecord = { agentOptions?: Record<string, unknown>; [key: string]: unknown }

test("a labelled teammate runs on the SLOT's route, re-read per spawn", async () => {
  /** The resolution the service answers, FLIPPED between the two starts below. */
  let live: Resolution = { ok: true, route: { provider: "gateway", model: "smart", reasoningEffort: "high" } }
  /** The mounted row, whose service answers the mutable resolution. */
  const { provider, started } = mounted(() => live)
  expect(provider.name).toBe(PROVIDER_NAME)
  await provider.start({ agentOptions: {}, descriptor: { label: "Deep Worker — implement the parser" } })
  expect(started[0].agentOptions).toMatchObject({ provider: "gateway", model: "smart", reasoningEffort: "high" })
  // The in-process config change: the NEXT teammate carries it, no re-mount and no restart.
  live = { ok: true, route: { provider: "backup", model: "spare", reasoningEffort: "low" } }
  await provider.start({ agentOptions: {}, descriptor: { label: "Deep Worker — implement the parser" } })
  expect(started[1].agentOptions).toMatchObject({ provider: "backup", model: "spare", reasoningEffort: "low" })
})

test("an UNCONFIGURED slot refuses the spawn with SLOT_UNCONFIGURED, and the composition's provider is NEVER called", async () => {
  /** The canonical refusal the config service builds for an unconfigured slot. */
  const refusal: Resolution = {
    ok: false,
    status: "unconfigured",
    code: "SLOT_UNCONFIGURED",
    message: "SLOT_UNCONFIGURED: slot3 (Deep Worker, Junior Engineer) is not usable — missing teamModels.slot3.provider, teamModels.slot3.model; nothing was written and no child was started. Configure it with /mpd-model, or set teamModels.slot3 in .mpd/mpd.jsonc.",
  }
  /** The mounted row with that service. */
  const { provider, started } = mounted(() => refusal)
  /** The rejection the start must raise; captured so its message and code can be read. */
  const error: any = await (provider.start({ agentOptions: {}, descriptor: { label: "Deep Worker — anything" } }) as Promise<unknown>).then(() => null, (e: unknown) => e)
  expect(error).not.toBeNull()
  expect(String(error.message)).toContain("SLOT_UNCONFIGURED")
  expect(error.code).toBe("SLOT_UNCONFIGURED")
  // THE DoD ARM: the composition's provider never ran, so no child was started.
  expect(started).toEqual([])
})

test("a MALFORMED leaf is equally fatal — one structured failure, never a substituted route", async () => {
  /** A service answer for a slot whose model leaf is malformed. */
  const refusal: Resolution = {
    ok: false,
    status: "invalid",
    code: "SLOT_UNCONFIGURED",
    message: "SLOT_UNCONFIGURED: slot1 (Architect, Planner, Reviewer, Lead, Senior Engineer) is not usable — teamModels.slot1.model must be a string, but it is 7; nothing was written and no child was started. Configure it with /mpd-model, or set teamModels.slot1 in .mpd/mpd.jsonc.",
  }
  /** The mounted row with that service. */
  const { provider, started } = mounted(() => refusal)
  /** The rejection the start must raise. */
  const error: any = await (provider.start({ agentOptions: {}, descriptor: { label: "Architect — boundaries" } }) as Promise<unknown>).then(() => null, (e: unknown) => e)
  expect(String(error?.message)).toContain("must be a string")
  expect(started).toEqual([])
})

test("a label that names NO member INHERITS: the request is forwarded by identity (§6)", async () => {
  /** A service that would refuse every member — proving it is never consulted for an unnamed label. */
  const { provider, started } = mounted(() => ({ ok: false, status: "unconfigured", code: "SLOT_UNCONFIGURED", message: "must not be read" }))
  /** The request with a route the teammate must keep. */
  const request = { agentOptions: { provider: "captain-provider", model: "captain-model" }, descriptor: { label: "check the vendored corpus" } }
  await provider.start(request)
  expect(started[0]).toBe(request)
})

test("an UNROUTED member (a name no slot carries) also inherits, rather than failing", async () => {
  /** A service that reports the label's member as unrouted. */
  const { provider, started } = mounted(() => ({ ok: false, status: "unrouted" }))
  /** The request the teammate must keep unchanged. */
  const request = { agentOptions: { provider: "lead-provider", model: "lead-model" }, descriptor: { label: "Architect — boundaries" } }
  await provider.start(request)
  expect(started[0]).toBe(request)
})

test("the slot's fallback chain is consumed once, before the spawn (catalog-positive first win)", async () => {
  /** A resolution whose primary is NOT listed but whose fallback IS. */
  const withFallback: Resolution = {
    ok: true,
    route: { provider: "unlisted", model: "nothing" },
    fallbacks: [{ provider: "gateway", model: "smart", reasoningEffort: "low" }],
  }
  /** The mounted row with that chain. */
  const { provider, started } = mounted(() => withFallback)
  await provider.start({ agentOptions: {}, descriptor: { label: "Researcher — survey" } })
  expect(started[0].agentOptions).toMatchObject({ provider: "gateway", model: "smart", reasoningEffort: "low" })
})
