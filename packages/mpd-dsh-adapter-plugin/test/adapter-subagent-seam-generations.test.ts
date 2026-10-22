// THE DURABLE-CHILD SEAM, ACROSS HARNESS GENERATIONS (harness 0.2.1-rc.2 adaptation).
//
// WHAT BROKE. Release 0.2.1-rc.2 REMOVED `SubagentRuntime.startContinuable()` — and with it
// `.start(mode, request)`. Proven absent, not assumed: `grep -rn 'startContinuable'` over the
// whole 0.2.1-rc.2 closure at `.mpd/reference/harness-021/node_modules/@deepseek-ai/` returns
// zero hits. The replacement is `startActivation(spec)`, which differs in TWO ways that would
// silently corrupt a naive rename:
//
//   1. `delivery` is a REQUIRED field of the activation spec. Both canonical callers inside the
//      harness pass `"parent"` (`dsh-experimental-agent-team`'s teammate spawn and
//      `dsh-tool-subagent`'s one-shot tool), so that is the spelling this adapter passes.
//   2. `startActivation` returns a `SubagentActivation` whose `result.output` is the child's
//      assistant CONTENT BLOCKS, where the retired `.start()` returned a flattened string.
//
// WHY BOTH ARMS ARE TESTED HERE. The adapter deliberately supports either generation behind ONE
// probe. A claim like that is worth nothing unless BOTH arms are driven, so every arm below runs
// against a service double that models exactly one generation — including the arm where the
// service carries NEITHER, which must refuse with a sentence naming both members instead of a
// `TypeError`.
import { afterEach, describe, expect, test } from "bun:test"

import { createDshAdapter, type DshCapabilities, type DshSpawnResult, type DshTeamExecutor } from "../src/index"

/** One recorded call on a service double: the member name, its receiver, and its arguments. */
interface Call {
  /** The method that was called. */
  seam: string
  /** The receiver it was called on, so a lost `this` is caught by identity. */
  receiver: unknown
  /** The forwarded arguments. */
  args: unknown[]
}

/** Which generation of the durable-child seam a double models. */
type Generation = "activation" | "continuable" | "none"

/** What a service double should answer, so an arm can make a generation absent or contradictory. */
interface DoubleOptions {
  /** The generation to model; `"none"` models a build with no durable-child start at all. */
  generation?: Generation
  /** The `childId` the start answers with; `""` models a backend that reports none. */
  childId?: string
  /** The blocks (0.2.1) or string (retired) an activation's `result.output` carries. */
  output?: unknown
  /** The `stopReason` an activation's result carries. */
  stopReason?: unknown
  /**
   * How the 0.2.1 activation's `dispose()` behaves. A real handle always carries one (`Promise<void>`
   * that rejects on teardown failure); `absent` models a stub without teardown so the optionality
   * arm stays tested.
   */
  dispose?: "resolve" | "reject" | "throw" | "absent"
}

/** The doubles one arm drives, plus the adapter under test. */
interface Harness {
  /** The adapter under test. */
  dsh: ReturnType<typeof createDshAdapter>
  /** Every call the double recorded, in order. */
  calls: Call[]
  /** The capability snapshot, for the pre-flight arms. */
  capabilities: DshCapabilities
  /** The service double itself, so an arm can assert identity of the receiver. */
  subagents: Record<string, unknown>
  /** The Lead agent every call is made as. */
  lead: { session: { id: string } }
}

/** The env override key the executor seam reads; cleared so no arm inherits another's choice. */
const OVERRIDE = "MPD_DSH_TEAM_EXECUTOR"

/**
 * Build a harness over a subagent service double of ONE generation.
 * @param options - the generation to model and what its start should answer.
 * @returns the adapter, the recorded calls and the capability snapshot.
 */
function harness(options: DoubleOptions = {}): Harness {
  /** The generation this double models. */
  const generation = options.generation ?? "activation"
  /** Every call the double observed. */
  const calls: Call[] = []
  /** Record one call with its receiver and arguments. */
  const record = (seam: string, receiver: unknown, args: unknown[]): void => { calls.push({ seam, receiver, args }) }
  /** The settled result a 0.2.1 activation hands back, mirroring `SubagentResult`. */
  const result = Promise.resolve({
    output: options.output ?? [{ type: "text", text: "researched" }],
    stopReason: options.stopReason ?? "completed",
  })
  /** Whether an activation's `result` has settled; its `dispose` records this to prove the ORDER. */
  let activationSettled = false
  /** The service double: ONLY the members its generation actually has. */
  const subagents: Record<string, unknown> = {
    /** The provider catalogue, so `providers()` answers something realistic. */
    providers: () => ["spawn", "fork", "mpd-roster"],
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
  if (generation === "activation") {
    /** The SAME result, flagged first so the flag is already true whenever `spawnAgent` resumes. */
    const activationResult = result.then((value) => {
      activationSettled = true
      return value
    })
    /** The activation handle itself, so the dispose arm can assert its receiver by identity. */
    const activation: Record<string, unknown> = {
      childId: options.childId ?? "child-021",
      messageId: "msg-021",
      result: activationResult,
    }
    /** The teardown behaviour this arm models; `absent` keeps a handle WITHOUT the member. */
    const disposeMode = options.dispose ?? "resolve"
    if (disposeMode !== "absent") {
      activation.dispose = function (this: unknown): Promise<void> {
        // The flag is read AT CALL TIME: a dispose that ran before `result` settled would record
        // false, which is the ordering defect this arm exists to catch.
        record("dispose", this, [activationSettled])
        if (disposeMode === "throw") throw new Error("dispose boom")
        if (disposeMode === "reject") return Promise.reject(new Error("dispose rejected"))
        return Promise.resolve()
      }
    }
    /** The 0.2.1 member: `startActivation(spec)` → activation with a durable `childId`. */
    subagents.startActivation = function (this: unknown, spec: unknown): Promise<unknown> {
      record("startActivation", this, [spec])
      return Promise.resolve(activation)
    }
  }
  if (generation === "continuable") {
    /** The retired member: `startContinuable(spec)` → a handle, no `delivery` field existed. */
    subagents.startContinuable = function (this: unknown, spec: unknown): Promise<unknown> {
      record("startContinuable", this, [spec])
      return Promise.resolve({ childId: options.childId ?? "child-old", messageId: "msg-old" })
    }
    /** The retired one-shot member: `start(mode, request)` → a run whose result it settles. */
    subagents.start = function (this: unknown, mode: unknown, request: unknown): Promise<unknown> {
      record("start", this, [mode, request])
      return Promise.resolve({ result })
    }
  }
  /** The adapter under test, over a ctx that serves exactly this double. */
  const dsh = createDshAdapter({
    get: (name: string): unknown => (name === "subagents" ? subagents : undefined),
  } as never)
  return { dsh, calls, capabilities: dsh.capabilities(), subagents, lead: { session: { id: "session-lead" } } }
}

afterEach(() => { delete process.env[OVERRIDE] })

/** The member request every team-spawn arm uses. */
const REQUEST = {
  teamId: "team-1",
  memberId: "M1",
  name: "researcher",
  description: "the researcher",
  prompt: "You research.",
} as const

describe("the capability probe is honest PER GENERATION", () => {
  test("a 0.2.1 service reports available, and the reason names startActivation", () => {
    /** A service with the 0.2.1 member only — the shape the target harness actually ships. */
    const h = harness({ generation: "activation" })
    expect(h.capabilities.subagentsContinuable).toBe(true)
    expect(h.capabilities.teamExecutorNative).toBe(true)
    /** The executor under test. */
    const executor: DshTeamExecutor = h.dsh.teamExecutor()
    expect(executor.kind).toBe("native")
    // The diagnostic must name WHICH member bound: a future rename is then one boot line away
    // from diagnosis instead of an afternoon of bisecting a silently-official backend.
    expect(executor.reason).toContain("startActivation")
    expect(executor.reason).not.toContain("startContinuable")
  })

  test("subagentsSpawn agrees with spawnAgent: TRUE on a 0.2.1 service with no start()", () => {
    /** A 0.2.1 service: `startActivation` exists, the retired `start` does NOT. */
    const h = harness({ generation: "activation" })
    // The defect this locks: the flag checked `subagents.start` alone and reported FALSE on the
    // harness this bundle now targets, contradicting the call path that actually spawned.
    expect(h.capabilities.subagentsSpawn).toBe(true)
    expect(h.capabilities.subagentsContinuable).toBe(true)
  })

  test("subagentsSpawn is FALSE only when NO spawn member exists at all", () => {
    /** A service with no spawn member on either generation. */
    const h = harness({ generation: "none" })
    expect(h.capabilities.subagentsSpawn).toBe(false)
  })

  test("a RETIRED service still reports available, and the reason names startContinuable", () => {
    /** A pre-0.2.1 service: the old member is the only one present. */
    const h = harness({ generation: "continuable" })
    expect(h.capabilities.subagentsContinuable).toBe(true)
    expect(h.capabilities.teamExecutorNative).toBe(true)
    /** The executor under test. */
    const executor = h.dsh.teamExecutor()
    expect(executor.kind).toBe("native")
    expect(executor.reason).toContain("startContinuable")
  })

  test("NEITHER member reports unavailable and names both, never a blanket true", async () => {
    /** A build that can raise no durable child: one test that cannot lie about a stripped host. */
    const h = harness({ generation: "none" })
    expect(h.capabilities.subagentsContinuable).toBe(false)
    expect(h.capabilities.teamExecutorNative).toBe(false)
    /** The executor under test. */
    const executor = h.dsh.teamExecutor()
    expect(executor.kind).toBe("native")
    expect(executor.reason).toContain("startActivation")
    expect(executor.reason).toContain("startContinuable")
    expect(executor.reason).toContain("UNAVAILABLE")
    // ...and the refusal names both members rather than throwing "not a function".
    await expect(executor.spawn(h.lead, { ...REQUEST })).rejects.toThrow(/exposes neither startActivation\(\) nor startContinuable\(\)/)
  })
})

describe("the native team backend raises a member on the 0.2.1 seam", () => {
  test("spawn() calls startActivation with the mandatory delivery policy and the member's route", async () => {
    /** A 0.2.1 service, the generation the target harness ships. */
    const h = harness({ generation: "activation", childId: "child-021" })
    /** The member's route, which only this backend can forward. */
    const agentOptions = { provider: "deepseek-official", model: "deepseek-v4", reasoningEffort: "high" }
    /** The spawn answer: the durable child id, which is the handle a caller records. */
    const spawned = await h.dsh.teamExecutor().spawn(h.lead, { ...REQUEST, provider: "mpd-roster", agentOptions })
    expect(spawned).toEqual({ handle: "child-021", executor: "native" })
    // Exactly ONE call, on the 0.2.1 member, receiver-bound.
    expect(h.calls.map((call) => call.seam)).toEqual(["startActivation"])
    expect(h.calls[0]?.receiver).toBe(h.subagents)
    /** The activation spec the adapter built. */
    const spec = h.calls[0]?.args[0] as Record<string, unknown>
    // The provider and the route are the two arguments the official tool row CANNOT forward.
    expect(spec.provider).toBe("mpd-roster")
    expect(spec.label).toBe("researcher · team-1")
    // `delivery` is REQUIRED in 0.2.1 and the adapter supplies the spelling the harness's own
    // callers use; a released build that dropped it would fail here.
    expect(spec.delivery).toBe("parent")
    /** The task half of the spec. */
    const request = spec.request as Record<string, unknown>
    expect(request.prompt).toEqual([{ type: "text", text: "You research." }])
    expect(request.parent).toBe(h.lead)
    expect(request.agentOptions).toEqual(agentOptions)
  })

  test("a backend that reports NO child id is refused rather than recorded as a member", async () => {
    /** A 0.2.1 service whose start resolves without an id — a backend contradiction. */
    const h = harness({ generation: "activation", childId: "" })
    // Recording this would put a member on the roster that no later call could reach.
    await expect(h.dsh.teamExecutor().spawn(h.lead, { ...REQUEST })).rejects.toThrow(/reported no child id/)
  })
})

describe("the native team backend still raises a member on the RETIRED seam", () => {
  test("spawn() calls startContinuable and, because that release had no such field, adds no delivery", async () => {
    /** A retired service: the only member is the one 0.2.1 removed. */
    const h = harness({ generation: "continuable", childId: "child-old" })
    /** The spawn answer. */
    const spawned = await h.dsh.teamExecutor().spawn(h.lead, { ...REQUEST })
    expect(spawned).toEqual({ handle: "child-old", executor: "native" })
    expect(h.calls.map((call) => call.seam)).toEqual(["startContinuable"])
    /** The spec the retired member was handed. */
    const spec = h.calls[0]?.args[0] as Record<string, unknown>
    // The retired spec is forwarded as it was built: `delivery` never existed there, and
    // injecting an unknown field into a release that never validated it is a guess, not support.
    expect("delivery" in spec).toBe(false)
    expect(spec.provider).toBe("spawn")
    expect((spec.request as Record<string, unknown>).parent).toBe(h.lead)
  })
})

describe("spawnAgent follows the generation too", () => {
  test("0.2.1: it starts an activation and projects the child's CONTENT BLOCKS onto text", async () => {
    /** A 0.2.1 service whose child answered with two text blocks around a reasoning block. */
    const h = harness({
      generation: "activation",
      output: [
        { type: "text", text: "first " },
        { type: "reasoning", text: "ignored internal reasoning" },
        { type: "text", text: "second" },
      ],
      stopReason: "completed",
    })
    /** The normalized answer. */
    const answer: DshSpawnResult = await h.dsh.spawnAgent({ label: "look", prompt: "go", parent: h.lead })
    // `output` is `readonly ContentBlock[]` on 0.2.1, and only text blocks are this field's
    // contract; serializing the reasoning block or emitting "[object Object]" would both be wrong.
    expect(answer.output).toBe("first second")
    expect(answer.stopReason).toBe("completed")
    // Start, THEN exactly one release of the settled consult: the one-shot contract this arm pins.
    expect(h.calls.map((call) => call.seam)).toEqual(["startActivation", "dispose"])
    /** The activation spec. */
    const spec = h.calls[0]?.args[0] as Record<string, unknown>
    expect(spec.provider).toBe("spawn")
    expect(spec.label).toBe("look")
    expect(spec.delivery).toBe("parent")
    expect((spec.request as Record<string, unknown>).prompt).toEqual([{ type: "text", text: "go" }])
  })

  test("0.2.1: the retired persona/toolFilter fields are NOT forwarded into the released request", async () => {
    /** A 0.2.1 service. */
    const h = harness({ generation: "activation" })
    // Both fields still reach the adapter: `mpd-roles-plugin` and `mpd-workmate-plugin` pass
    // `persona` today. 0.2.1 removed them from the start request, so the honest behaviour is to
    // drop them from the request and log the omission once — never to smuggle them in, and never
    // to fail the spawn.
    await h.dsh.spawnAgent({ label: "look", prompt: "go", parent: h.lead, persona: "a persona", toolFilter: ["read"] })
    /** The request half of the activation spec. */
    const request = (h.calls[0]?.args[0] as Record<string, unknown>).request as Record<string, unknown>
    expect("persona" in request).toBe(false)
    expect("toolFilter" in request).toBe(false)
    // The spawn itself still happened: a retired field must not cost the call — and the settled
    // consult is still released exactly once.
    expect(h.calls.map((call) => call.seam)).toEqual(["startActivation", "dispose"])
  })

  test("0.2.1: an absent caller signal becomes a never-aborting one, because the field is REQUIRED", async () => {
    /** A 0.2.1 service. */
    const h = harness({ generation: "activation" })
    await h.dsh.spawnAgent({ label: "look", prompt: "go", parent: h.lead })
    /** The activation spec. */
    const spec = h.calls[0]?.args[0] as Record<string, unknown>
    expect(spec.signal).toBeInstanceOf(AbortSignal)
    expect((spec.signal as AbortSignal).aborted).toBe(false)
  })

  test("0.2.1: the settled consult disposes its activation EXACTLY ONCE, after the result", async () => {
    /** A 0.2.1 service whose activation records its own disposal. */
    const h = harness({ generation: "activation" })
    /** The normalized answer, which the release must leave untouched. */
    const answer = await h.dsh.spawnAgent({ label: "look", prompt: "go", parent: h.lead })
    expect(answer).toEqual({ output: "researched", structured: undefined, stopReason: "completed" })
    // Start, THEN one release. The recorded `true` is the ORDERING proof: the double records
    // whether `result` had already settled when dispose ran, so a release fired too early is false.
    expect(h.calls.map((call) => call.seam)).toEqual(["startActivation", "dispose"])
    expect(h.calls[1]?.args[0]).toBe(true)
    // Exactly once, and on the activation handle itself: disposal addresses THAT execution.
    expect(h.calls.filter((call) => call.seam === "dispose")).toHaveLength(1)
    /** The receiver dispose was invoked on — the activation handle the double handed out. */
    const receiver = h.calls[1]?.receiver as Record<string, unknown>
    expect(receiver.childId).toBe("child-021")
    expect(typeof receiver.dispose).toBe("function")
  })

  test("0.2.1: a REJECTING dispose still returns the report — teardown failure is not the answer", async () => {
    /** A 0.2.1 service whose dispose rejects, as the harness does on a cleanup failure. */
    const h = harness({ generation: "activation", dispose: "reject" })
    /** The report, which must survive the failed teardown unchanged. */
    const answer = await h.dsh.spawnAgent({ label: "look", prompt: "go", parent: h.lead })
    expect(answer).toEqual({ output: "researched", structured: undefined, stopReason: "completed" })
    expect(h.calls.map((call) => call.seam)).toEqual(["startActivation", "dispose"])
  })

  test("0.2.1: a THROWING dispose still returns the report", async () => {
    /** A 0.2.1 service whose dispose throws synchronously instead of returning a rejected promise. */
    const h = harness({ generation: "activation", dispose: "throw" })
    await expect(h.dsh.spawnAgent({ label: "look", prompt: "go", parent: h.lead }))
      .resolves.toEqual({ output: "researched", structured: undefined, stopReason: "completed" })
    // The synchronous throw is contained exactly like a rejection: the report is already settled.
    expect(h.calls.map((call) => call.seam)).toEqual(["startActivation", "dispose"])
  })

  test("0.2.1: an activation WITHOUT dispose is tolerated, because the release is optional", async () => {
    /** A 0.2.1-shaped service whose handle omits teardown, as a stub may. */
    const h = harness({ generation: "activation", dispose: "absent" })
    /** The report. */
    const answer = await h.dsh.spawnAgent({ label: "look", prompt: "go", parent: h.lead })
    expect(answer.output).toBe("researched")
    // A missing member is a no-op, never a TypeError and never a fabricated release.
    expect(h.calls.map((call) => call.seam)).toEqual(["startActivation"])
  })

  test("RETIRED: it calls start(mode, request) and forwards the fields that release still had", async () => {
    /** A retired service, whose child answered with the flattened string that release returned. */
    const h = harness({ generation: "continuable", output: "plain text", stopReason: "max-tokens" })
    /** The normalized answer. */
    const answer = await h.dsh.spawnAgent({
      label: "look",
      prompt: "go",
      parent: h.lead,
      persona: "a persona only that release honours",
      toolFilter: ["read"],
      maxDepth: 2,
    })
    // A string `output` is passed through, which is why the projection accepts both shapes.
    expect(answer.output).toBe("plain text")
    expect(answer.stopReason).toBe("max-tokens")
    // The retired run handle exposed no teardown member, so this arm stays EXACTLY as it was:
    // one `start` call and no fabricated dispose.
    expect(h.calls.map((call) => call.seam)).toEqual(["start"])
    expect(h.calls[0]?.args[0]).toBe("spawn")
    /** The request the retired member was handed. */
    const request = h.calls[0]?.args[1] as Record<string, unknown>
    expect(request.label).toBe("look")
    expect(request.persona).toBe("a persona only that release honours")
    expect(request.toolFilter).toEqual(["read"])
    expect(request.maxDepth).toBe(2)
  })

  test("NEITHER generation refuses with a sentence naming both members", async () => {
    /** A service with no start member at all. */
    const h = harness({ generation: "none" })
    await expect(h.dsh.spawnAgent({ label: "look", prompt: "go", parent: h.lead }))
      .rejects.toThrow(/exposes neither startActivation\(\) nor start\(\)/)
  })
})

describe("startContinuableAgent is the same seam, and keeps its SYNCHRONOUS throw", () => {
  test("0.2.1: it injects the mandatory delivery policy and forwards everything else", async () => {
    /** A 0.2.1 service. */
    const h = harness({ generation: "activation" })
    /** The caller's own spec, which predates the released field. */
    const spec = { provider: "spawn", label: "member", request: { prompt: [], parent: h.lead }, signal: new AbortController().signal }
    await h.dsh.startContinuableAgent(spec)
    // Start ONLY, and deliberately NO dispose: this is the DURABLE team seam, whose whole point is
    // continuity, so the R2 one-shot release must never leak into it.
    expect(h.calls.map((call) => call.seam)).toEqual(["startActivation"])
    // The adapter owns exactly ONE field on this generation: the one the release made mandatory.
    expect(h.calls[0]?.args[0]).toEqual({ ...spec, delivery: "parent" })
  })

  test("RETIRED: it forwards the caller's spec VERBATIM", async () => {
    /** A retired service. */
    const h = harness({ generation: "continuable" })
    /** The caller's spec. */
    const spec = { provider: "spawn", label: "member", request: { prompt: [], parent: h.lead } }
    await h.dsh.startContinuableAgent(spec)
    expect(h.calls.map((call) => call.seam)).toEqual(["startContinuable"])
    expect(h.calls[0]?.args[0]).toBe(spec)
  })

  test("a missing seam throws SYNCHRONOUSLY, not as a rejected promise", () => {
    /** A service with neither member. */
    const h = harness({ generation: "none" })
    // Parity with the raw expression a caller would run: the throw must precede the call, so
    // `expect(fn).toThrow()` — not `rejects` — is the contract this surface promises.
    expect(() => h.dsh.startContinuableAgent({ label: "member" }))
      .toThrow(/exposes neither startActivation\(\) nor startContinuable\(\)/)
  })
})
