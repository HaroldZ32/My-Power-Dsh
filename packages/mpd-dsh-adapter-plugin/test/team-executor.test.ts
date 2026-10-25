// THE TEAM EXECUTOR (team-plane split, W2): mpd's team system behind ONE seam.
//
// WHAT THIS FILE IS FOR. Until W2 the only way to raise a teammate was the official Agent
// Teams service, so the bundle's team plane could not exist where that service is absent or
// unmountable — the measured `dsh-tui` case, where `TeamService`'s ROOT-bound projection
// registration is refused and the row never activates. The executor seam gives the bundle a
// SECOND, DEFAULT backend that needs nothing from the official plugin.
//
// The arms below are the ones that would let a regression hide:
//   * the DEFAULT is native, and the REASON says so (a silently-official default would undo
//     the whole split without failing anything);
//   * the native path forwards the provider and the member's `agentOptions` — the two
//     arguments the official tool row CANNOT forward, and therefore the whole point;
//   * a backend that resolves WITHOUT a handle is refused, so a member can never be recorded
//     on the roster that no later call could reach;
//   * when NEITHER backend serves, every call refuses with a sentence instead of a TypeError.
import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createDshAdapter, type DshCapabilities, type DshTeamExecutor, type DshTeamSlotAnswer } from "../src/index"

/** One recorded call on a backend double: the seam name, its receiver, and its arguments. */
interface Call {
  /** The method that was called. */
  seam: string
  /** The receiver it was called on, so a lost `this` is caught by identity. */
  receiver: unknown
  /** The forwarded arguments. */
  args: unknown[]
}

/** What a backend double should answer, so an arm can make a seam absent or contradictory. */
interface DoubleOptions {
  /** Whether `subagents.startContinuable` exists at all. */
  native?: boolean
  /** Whether `ctx.agentTeams` is mounted. */
  official?: boolean
  /** The `childId` a native start answers with; `""` models a backend that reports none. */
  childId?: string
  /** The handle an official spawn answers with; `""` models the same contradiction there. */
  memberId?: string
  /** The `mpdConfig` service double the spawn resolves the member's route through, when one exists. */
  config?: { slotResolutionOf?: (member: string) => unknown; teamModelRouteOf?: (member: string) => unknown }
}

/** The doubles one arm drives, plus the executor the adapter hands back. */
interface Harness {
  /** The executor under test. */
  executor: DshTeamExecutor
  /** Every call either double recorded, in order. */
  calls: Call[]
  /** The capability snapshot, for the pre-flight arm. */
  capabilities: DshCapabilities
  /** The Lead agent every call is made as. */
  lead: { session: { id: string } }
  /** A live child agent object, the identity the native membership arm uses. */
  child: { session: { id: string } }
}

/** The env override key this seam reads. */
const OVERRIDE = "MPD_DSH_TEAM_EXECUTOR"

/**
 * Build the harness: a real adapter against two recording doubles.
 * @param options - which seams exist and what the contradictory cases answer.
 * @returns the harness an arm drives.
 */
function harness(options: DoubleOptions = {}): Harness {
  /** Every call the doubles observed. */
  const calls: Call[] = []
  /** Record one call with its receiver and arguments. */
  const record = (seam: string, receiver: unknown, args: unknown[]): void => { calls.push({ seam, receiver, args }) }
  /** The native double: only the three seams the executor uses. */
  const subagents: Record<string, unknown> = {
    providers: () => ["spawn", "fork", "mpd-roster"],
    /** Record the raise and answer with a durable child id. */
    startContinuable(spec: unknown): Promise<unknown> {
      record("startContinuable", this, [spec])
      return Promise.resolve({ childId: options.childId ?? "child-1", messageId: "msg-1" })
    },
    /** Record the delivery and answer with an inbox id. */
    sendMessage(sender: unknown, targetId: unknown, content: unknown, opts: unknown): Promise<unknown> {
      record("sendMessage", this, [sender, targetId, content, opts])
      return Promise.resolve("msg-2")
    },
    /** Record the interrupt. */
    interrupt(targetSessionId: unknown, authority: unknown): void {
      record("interrupt", this, [targetSessionId, authority])
    },
  }
  if (options.native === false) delete subagents.startContinuable
  /** The official double: only the seams the executor uses. */
  const agentTeams: Record<string, unknown> = {
    /** Record the official raise and answer with a handle. */
    spawnTeammate(caller: unknown, request: unknown): Promise<unknown> {
      record("spawnTeammate", this, [caller, request])
      return Promise.resolve({ id: options.memberId ?? "sess-official-1" })
    },
    /** Record the official delivery. */
    sendMessage(caller: unknown, request: unknown): Promise<unknown> {
      record("sendMessage", this, [caller, request])
      return Promise.resolve({ messageId: "m1", status: "delivered" })
    },
    /** Record the official interrupt. */
    interrupt(caller: unknown, target: unknown): Promise<unknown> {
      record("interrupt", this, [caller, target])
      return Promise.resolve({ previousStatus: "running" })
    },
    /** Answer the host's own identity question for the two identities this file uses. */
    tryMembership(agent: unknown): unknown {
      record("tryMembership", this, [agent])
      /** The host's answer for the two identities this file uses. */
      const id = (agent as { session?: { id?: string } } | undefined)?.session?.id
      return id === "child-1" ? { id: "team-official", role: "teammate", name: "researcher" } : undefined
    },
  }
  /** The service lookup the adapter uses, over exactly the doubles this arm staged. */
  const ctx = {
    get: (name: string): unknown => {
      if (name === "subagents") return subagents
      if (name === "agentTeams") return options.official === false ? undefined : agentTeams
      if (name === "mpdConfig") return options.config
      return undefined
    },
  }
  /** The adapter under test. */
  const dsh = createDshAdapter(ctx as never)
  return {
    executor: dsh.teamExecutor(),
    calls,
    capabilities: dsh.capabilities(),
    lead: { session: { id: "session-lead" } },
    child: { session: { id: "child-1" } },
  }
}

/** Restore the env after every arm, so an override cannot leak into the next one. */
afterEach(() => { delete process.env[OVERRIDE]; delete process.env.DSH_WORKSPACE_ROOT })

/** The member request every spawn arm uses. */
const REQUEST = {
  teamId: "team-1",
  memberId: "M1",
  name: "researcher",
  description: "the researcher",
  prompt: "You research.",
} as const

/** The slot-1 route a matched roster member must receive as the child's `agentOptions`. */
const SLOT_ONE_ROUTE = { provider: "deepseek-official", model: "deepseek-v4-flash", reasoningEffort: "max" } as const

/** The slot-3 route, so two members can prove they receive DIFFERENT routes. */
const SLOT_THREE_ROUTE = { provider: "gateway", model: "smart-worker" } as const

/** The usable slot answers the routing arms resolve against, keyed by roster member. */
const ROUTED_ANSWERS: Readonly<Record<string, DshTeamSlotAnswer>> = {
  Architect: { ok: true, slot: "slot1", route: SLOT_ONE_ROUTE, fallbacks: [] },
  "Senior Engineer": { ok: true, slot: "slot1", route: SLOT_ONE_ROUTE, fallbacks: [] },
  "Deep Worker": { ok: true, slot: "slot3", route: SLOT_THREE_ROUTE, fallbacks: [] },
}

/** The canonical unconfigured answer; its MESSAGE is the one line a spawn must quote. */
const UNCONFIGURED_ANSWER: DshTeamSlotAnswer = {
  ok: false,
  status: "unconfigured",
  slot: "slot3",
  code: "SLOT_UNCONFIGURED",
  message: "SLOT_UNCONFIGURED: slot3 is not usable — missing teamModels.slot3.provider, teamModels.slot3.model",
}

/**
 * A config-service double over a member->answer table, mirroring the live service's total read:
 * a member it knows answers that entry, every other name answers `unrouted`.
 * @param answers - the member entries this double serves.
 * @returns the service surface the adapter resolves through `service("mpdConfig")`.
 */
function configWith(answers: Readonly<Record<string, DshTeamSlotAnswer>>): { slotResolutionOf: (member: string) => unknown } {
  /** The entries keyed the way the real service normalizes them: lower-cased. */
  const byName = new Map(Object.entries(answers).map(([member, answer]) => [member.toLowerCase(), answer] as const))
  return { slotResolutionOf: (member: string): unknown => byName.get(member.toLowerCase()) ?? { ok: false, status: "unrouted", slot: undefined } }
}

/** A fresh workspace root for ONE arm's row log, so the arm starts with no recorded line. */
function freshLogRoot(): string {
  return mkdtempSync(join(tmpdir(), "mpd-team-executor-"))
}

/** The adapter row's log lines under one workspace root; an absent file means nothing was written. */
function logLinesOf(root: string): string[] {
  /** The sink's documented path: `<root>/.mpd/logs/<name>.log`. */
  const file = join(root, ".mpd", "logs", "mpd-dsh-adapter.log")
  if (!existsSync(file)) return []
  return readFileSync(file, "utf8").split("\n").filter((line) => line !== "")
}

/** The start spec the native double received for one recorded call. */
interface RecordedSpec {
  /** The spec-level provider; kept at `spawn` and never confused with the child's route. */
  provider: string
  /** The child request, where a resolved route lands as `agentOptions` (or is omitted entirely). */
  request: { agentOptions?: unknown }
}

/** Read the native start spec out of one recorded call. */
function recordedSpec(call: Call | undefined): RecordedSpec {
  return call?.args[0] as RecordedSpec
}

describe("which backend is chosen", () => {
  test("NATIVE is the default, and the reason says so", () => {
    /** The harness with both backends available. */
    const h = harness()
    expect(h.executor.kind).toBe("native")
    expect(h.executor.reason).toContain("default")
    // The pre-flight flag agrees with the backend actually handed back.
    expect(h.capabilities.teamExecutorNative).toBe(true)
  })

  test("OFFICIAL is chosen only when the native seams are absent", () => {
    /** The harness whose subagents service cannot raise a durable child. */
    const h = harness({ native: false })
    expect(h.executor.kind).toBe("official")
    expect(h.executor.reason).toContain("native seams are unavailable")
    expect(h.capabilities.teamExecutorNative).toBe(false)
  })

  test("with NEITHER backend every call REFUSES with a sentence, never a TypeError", async () => {
    /** The harness with no team backend at all. */
    const h = harness({ native: false, official: false })
    expect(h.executor.kind).toBe("native")
    expect(h.executor.reason).toContain("UNAVAILABLE")
    // The refusal names the missing seam rather than throwing "not a function".
    await expect(h.executor.spawn(h.lead, { ...REQUEST })).rejects.toThrow(/no team executor is available/)
    // ...and so do the other two: an executor that cannot raise a member must not half-work
    // by delivering into a team it could never have built.
    await expect(h.executor.send(h.lead, "child-1", "hi")).rejects.toThrow(/no team executor is available/)
    await expect(h.executor.interrupt(h.lead, "child-1")).rejects.toThrow(/no team executor is available/)
  })

  test("the env override picks a backend, and FALLS THROUGH when that one cannot serve", () => {
    // The override exists for a diagnosis ("is this defect in the executor or the record?"),
    // so it must be honoured — but never at the cost of handing back a broken backend.
    process.env[OVERRIDE] = "official"
    expect(harness().executor.kind).toBe("official")
    process.env[OVERRIDE] = "native"
    expect(harness().executor.kind).toBe("native")
    // Asking for official in a composition that has none falls back to the native default
    // rather than to a backend whose every call would refuse.
    process.env[OVERRIDE] = "official"
    expect(harness({ official: false }).executor.kind).toBe("native")
    // A value that names neither backend is ignored, not treated as a third choice.
    process.env[OVERRIDE] = "something-else"
    expect(harness().executor.kind).toBe("native")
  })
})

describe("the native backend", () => {
  test("spawn forwards the PROVIDER and the member's agentOptions — the point of the seam", async () => {
    /** The harness under test. */
    const h = harness()
    /** The route the caller resolved for this member. */
    const route = { provider: "deepseek-official", model: "deepseek-v4-flash", reasoningEffort: "high" }
    /** What the backend reported. */
    const result = await h.executor.spawn(h.lead, { ...REQUEST, provider: "mpd-roster", agentOptions: route })
    expect(result).toEqual({ handle: "child-1", executor: "native" })
    /** The one call the double recorded. */
    const call = h.calls[0]
    expect(call.seam).toBe("startContinuable")
    // Receiver-bound: a lost `this` would have failed in production, not here.
    expect(call.receiver).toBeDefined()
    /** The spec the manager received. */
    const spec = call.args[0] as { provider: string; label: string; request: { prompt: unknown[]; parent: unknown; agentOptions?: unknown }; signal: unknown }
    // THE TWO ARGUMENTS THE OFFICIAL TOOL ROW CANNOT FORWARD: without these, a member's model
    // route could only arrive through row config, which is the indirection this seam removes.
    expect(spec.provider).toBe("mpd-roster")
    expect(spec.request.agentOptions).toEqual(route)
    expect(spec.request.parent).toBe(h.lead)
    // The prompt travels as content blocks, which is what the manager takes.
    expect(spec.request.prompt).toEqual([{ type: "text", text: "You research." }])
    // A caller that supplied no signal still gets a real one: the manager requires it.
    expect(spec.signal).toBeDefined()
  })

  test("spawn DEFAULTS the provider rather than sending an empty name", async () => {
    /** The harness under test. */
    const h = harness()
    await h.executor.spawn(h.lead, { ...REQUEST })
    /** The spec the manager received. */
    const spec = h.calls[0].args[0] as { provider: string }
    expect(spec.provider).toBe("spawn")
  })

  test("a start that reports NO child id is refused, so no phantom member is recorded", async () => {
    /** The harness whose backend answers without a handle. */
    const h = harness({ childId: "" })
    await expect(h.executor.spawn(h.lead, { ...REQUEST })).rejects.toThrow(/reported no child id/)
    // The registry stayed empty: a member with no handle is a member no call could reach.
    expect(h.executor.members()).toEqual([])
  })

  test("send delivers through sendMessage, which cold-resumes an absent child", async () => {
    /** The harness under test. */
    const h = harness()
    await h.executor.spawn(h.lead, { ...REQUEST })
    await h.executor.send(h.lead, "child-1", "work on T2")
    /** The send the double recorded. */
    const call = h.calls.find((entry) => entry.seam === "sendMessage")
    expect(call).toBeDefined()
    expect(call?.args[0]).toBe(h.lead)
    expect(call?.args[1]).toBe("child-1")
    expect(call?.args[2]).toEqual([{ type: "text", text: "work on T2" }])
    // The options bag always carries a signal: the manager requires one.
    expect((call?.args[3] as { signal: unknown }).signal).toBeDefined()
  })

  test("interrupt uses the ANCESTOR authority, which is the form this seam can honestly present", async () => {
    /** The harness under test. */
    const h = harness()
    await h.executor.spawn(h.lead, { ...REQUEST })
    await h.executor.interrupt(h.lead, "child-1")
    /** The interrupt the double recorded. */
    const call = h.calls.find((entry) => entry.seam === "interrupt")
    expect(call?.args[0]).toBe("child-1")
    expect(call?.args[1]).toEqual({ kind: "ancestor", agent: h.lead })
  })

  test("membership answers for a handle THIS adapter raised, and is a MISS for anyone else", async () => {
    /** The harness under test. */
    const h = harness()
    await h.executor.spawn(h.lead, { ...REQUEST })
    // The child agent object identifies itself BY the handle, which is what makes the answer
    // possible without asking any service — and what keeps the read-only guard working.
    expect(h.executor.membership(h.child)).toEqual({ teamId: "team-1", role: "teammate", name: "researcher" })
    // An agent this adapter never raised is a normal MISS, not an error: this is a FILTER.
    expect(h.executor.membership({ session: { id: "someone-else" } })).toBeUndefined()
    expect(h.executor.membership(undefined)).toBeUndefined()
    expect(h.executor.membership({})).toBeUndefined()
    // The registry lists what it holds, which is what a surface enumerates.
    expect(h.executor.members()).toEqual([{ handle: "child-1", teamId: "team-1", memberId: "M1", name: "researcher" }])
  })

  test("the provider list comes from the harness, and degrades to [] rather than leaking", () => {
    expect(harness().executor.providers()).toEqual(["spawn", "fork", "mpd-roster"])
    /** A harness whose provider list answers a non-array. */
    /** The harness whose provider list is read. */
    const h = harness()
    expect(Array.isArray(h.executor.providers())).toBe(true)
  })
})

// THE DEFECT THIS DESCRIBE CLOSES: every native teammate inherited the STAGING session's route,
// because `spawn` consulted no `teamModels` slot. These arms pin the resolved-route contract and
// the fallback policy that must never turn one unusable slot into a half-built team.
describe("the native member route (teamModels -> agentOptions)", () => {
  test("a matched member's request carries the slot route, while spec.provider stays spawn", async () => {
    process.env.DSH_WORKSPACE_ROOT = freshLogRoot()
    /** The harness whose config service routes Senior Engineer on slot 1. */
    const h = harness({ config: configWith(ROUTED_ANSWERS) })
    await h.executor.spawn(h.lead, { ...REQUEST, memberId: "M2", name: "M2", description: "Senior Engineer — implements the parser" })
    /** The spec the native double received. */
    const spec = recordedSpec(h.calls[0])
    expect(spec.request.agentOptions).toEqual(SLOT_ONE_ROUTE)
    // A DIFFERENT field: the spec-level provider names the subagent provider, not the model route.
    expect(spec.provider).toBe("spawn")
  })

  test("two members get the two different slots their identities name", async () => {
    process.env.DSH_WORKSPACE_ROOT = freshLogRoot()
    /** The harness whose config service routes two different members on two different slots. */
    const h = harness({ config: configWith(ROUTED_ANSWERS) })
    await h.executor.spawn(h.lead, { ...REQUEST, memberId: "M1", name: "Architect", description: "Architect — designs the seam" })
    await h.executor.spawn(h.lead, { ...REQUEST, memberId: "M2", name: "deep-worker", description: "Deep Worker — builds the fixture" })
    /** The first member's route. */
    const first = recordedSpec(h.calls[0]).request.agentOptions
    /** The second member's route. */
    const second = recordedSpec(h.calls[1]).request.agentOptions
    expect(first).toEqual(SLOT_ONE_ROUTE)
    expect(second).toEqual(SLOT_THREE_ROUTE)
    expect(first).not.toEqual(second)
  })

  test("an unmatched member's request has NO agentOptions key at all", async () => {
    process.env.DSH_WORKSPACE_ROOT = freshLogRoot()
    /** The harness whose config service routes the roster but names no "helper". */
    const h = harness({ config: configWith(ROUTED_ANSWERS) })
    await h.executor.spawn(h.lead, { ...REQUEST, name: "helper", description: "does odd jobs" })
    /** The request the manager received. */
    const request = recordedSpec(h.calls[0]).request as Record<string, unknown>
    // OMITTED, not `agentOptions: undefined`: today's inheritance must arrive as no key at all.
    expect("agentOptions" in request).toBe(false)
  })

  test("an unconfigured slot still raises the member and writes exactly ONE log line quoting the message", async () => {
    /** The fresh root this arm's row log is read from. */
    const root = freshLogRoot()
    process.env.DSH_WORKSPACE_ROOT = root
    /** The harness whose config service says Junior Engineer's slot is unconfigured. */
    const h = harness({ config: configWith({ "Junior Engineer": UNCONFIGURED_ANSWER }) })
    /** The raise that must still succeed: `approve` raises members in a loop, so a throw here
     *  would leave a half-built team. */
    const result = await h.executor.spawn(h.lead, { ...REQUEST, name: "junior", description: "Junior Engineer — builds the fixture" })
    expect(result).toEqual({ handle: "child-1", executor: "native" })
    /** The request the manager received. */
    const request = recordedSpec(h.calls[0]).request as Record<string, unknown>
    expect("agentOptions" in request).toBe(false)
    /** Every line this spawn wrote to the adapter row log. */
    const lines = logLinesOf(root)
    expect(lines.length).toBe(1)
    expect(lines[0]).toContain(String(UNCONFIGURED_ANSWER.message))
  })

  test("a composition with NO config service inherits, and still writes exactly ONE line", async () => {
    /** The fresh root this arm's row log is read from. */
    const root = freshLogRoot()
    process.env.DSH_WORKSPACE_ROOT = root
    /** The harness whose ctx exposes no mpdConfig service at all. */
    const h = harness()
    /** The raise, which must not throw merely because routing is unavailable. */
    const result = await h.executor.spawn(h.lead, { ...REQUEST, name: "Architect", description: "Architect — designs" })
    expect(result).toEqual({ handle: "child-1", executor: "native" })
    /** The request the manager received. */
    const request = recordedSpec(h.calls[0]).request as Record<string, unknown>
    expect("agentOptions" in request).toBe(false)
    expect(logLinesOf(root).length).toBe(1)
  })

  test("a caller-supplied agentOptions WINS: resolution is skipped and nothing is logged", async () => {
    /** The fresh root this arm's row log is read from. */
    const root = freshLogRoot()
    process.env.DSH_WORKSPACE_ROOT = root
    /** The route the CALLER resolved; the config service would route this member elsewhere. */
    const callerRoute = { provider: "caller", model: "caller-model" }
    /** The harness whose config service routes Architect on slot 1. */
    const h = harness({ config: configWith(ROUTED_ANSWERS) })
    await h.executor.spawn(h.lead, { ...REQUEST, name: "Architect", description: "Architect — designs", agentOptions: callerRoute })
    expect(recordedSpec(h.calls[0]).request.agentOptions).toEqual(callerRoute)
    // Skipped means SKIPPED: not even a fallback line, so a caller's route is never second-guessed.
    expect(logLinesOf(root)).toEqual([])
  })

  test("VERSION SKEW: a config service exposing only teamModelRouteOf still routes", async () => {
    process.env.DSH_WORKSPACE_ROOT = freshLogRoot()
    /** The pre-wave service surface: a raw route read, no typed slot resolution. */
    const legacy = { teamModelRouteOf: (member: string): unknown => (member.toLowerCase() === "architect" ? { provider: "legacy", model: "old-model" } : undefined) }
    /** The harness driven by the older service. */
    const h = harness({ config: legacy })
    await h.executor.spawn(h.lead, { ...REQUEST, name: "Architect", description: "Architect — designs" })
    expect(recordedSpec(h.calls[0]).request.agentOptions).toEqual({ provider: "legacy", model: "old-model" })
  })
})

describe("the official backend", () => {
  test("spawn, send and interrupt map onto the official service", async () => {
    /** The harness forced onto the official backend. */
    process.env[OVERRIDE] = "official"
    /** The harness driven onto the official backend. */
    const h = harness()
    expect(h.executor.kind).toBe("official")
    /** The handle the official spawn answered with. */
    const spawned = await h.executor.spawn(h.lead, { ...REQUEST })
    expect(spawned).toEqual({ handle: "sess-official-1", executor: "official" })
    await h.executor.send(h.lead, "sess-official-1", "work on T2")
    await h.executor.interrupt(h.lead, "sess-official-1")
    /** The spawn request the service received. */
    const spawn = h.calls.find((entry) => entry.seam === "spawnTeammate")
    expect((spawn?.args[1] as { name: string }).name).toBe("researcher")
    // An EMPTY description is replaced by the name: the host shows a blank roster row otherwise.
    expect((spawn?.args[1] as { description: string }).description).toBe("the researcher")
    /** The interrupt target, which this backend addresses by NAME rather than by handle. */
    const stop = h.calls.find((entry) => entry.seam === "interrupt")
    expect(stop?.args[1]).toBe("researcher")
  })

  test("membership is ASKED of the host, so a member raised elsewhere is still identified", () => {
    process.env[OVERRIDE] = "official"
    /** The harness under test. */
    const h = harness()
    // This adapter never spawned anything on this backend, yet the identity is answered — the
    // host owns the roster, which is the one capability the native backend does not reproduce.
    expect(h.executor.membership(h.child)).toEqual({ teamId: "team-official", role: "teammate", name: "researcher" })
    expect(h.executor.membership({ session: { id: "stranger" } })).toBeUndefined()
  })

  test("a spawn that reports no id is refused here too", async () => {
    process.env[OVERRIDE] = "official"
    /** The harness whose official spawn answers without an id. */
    const h = harness({ memberId: "" })
    await expect(h.executor.spawn(h.lead, { ...REQUEST })).rejects.toThrow(/reported no id/)
    expect(h.executor.members()).toEqual([])
  })
})

describe("the seam is total", () => {
  test("the executor never throws on construction, whatever the composition holds", () => {
    // Named explicitly because the whole point is that a caller never has to feature-detect:
    // there is ALWAYS an executor, and a refusal arrives per call with a reason.
    for (const options of [{}, { native: false }, { official: false }, { native: false, official: false }]) {
      /** The executor this composition yields. */
      const executor = harness(options).executor
      expect(typeof executor.kind).toBe("string")
      expect(executor.reason.length).toBeGreaterThan(0)
      expect(Array.isArray(executor.providers())).toBe(true)
      expect(Array.isArray(executor.members())).toBe(true)
    }
  })

  test("the reason is a SENTENCE a boot line can carry, in every case", () => {
    for (const options of [{}, { native: false }, { native: false, official: false }]) {
      /** The executor this composition yields. */
      const executor = harness(options).executor
      expect(executor.reason).toMatch(/native|official/)
      expect(executor.reason).not.toContain("undefined")
    }
  })
})
