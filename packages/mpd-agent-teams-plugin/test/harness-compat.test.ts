// Proves the audited Harness subagent boundary against the REAL 0.1.5-rc.2
// service shape: `followup`/`registerContinuableSetup` are gone, team delivery
// is the PUBLIC `ctx.subagents.prompt(request, signal)` seam
// (`{requestId, parentSessionId, childSessionId, mode:'continuable',
// delivery:'queue', content}` → `{messageId}`), and member setup runs
// synchronously on `agent/session-start`.
//
// Regression this locks: the adopted 0.1.14 code called
// `ctx.subagents.followup(...)` unconditionally. On modern hosts that method
// does not exist, so EVERY scheduler wakeup (task assignment, captain
// guidance) failed inside deliverToMember's catch; the first batch of members
// only started because their spawn prompt told them what was assigned, and the
// scheduler never dispatched the second batch.
//
// Three host generations are covered, in order:
//   - Alpha.2: the receiver-bound `followup`.
//   - Alpha.5 … 0.1.2-rc.1: the symbol-keyed host FIFO queue.
//   - 0.1.5-rc.2+: the public `prompt(request, signal)` seam.
import { describe, expect, test } from "bun:test"
// The adopted Harness-compatibility layer is vendored JavaScript with no declaration file, so the
// generation ladder, the delivery guards and the symbol key itself all arrive untyped.
// The vendored module now resolves to its .ts source, so this surface is typed from that file.
import { HOST_PROMPT_QUEUE, guardSubagentDelivery, installContinuableMemberSetup, queueMemberPrompt, sessionOwnEvents } from "../lib/harness-compat.ts"
// The vendored module now resolves to its .ts source, so this surface is typed from that file.
import { deliverToMember } from "../lib/members.ts"

/** One prompt the fixture's `prompt` seam recorded, with the signal it was called under. */
interface PromptCall {
  /** Request payload as delivered; the arm asserts its shape through `toMatchObject`. */
  readonly request: Record<string, unknown>
  /** Cancellation signal handed to the seam; the arm pins its identity, not its content. */
  readonly signal: AbortSignal
}

/** One host content block; only `text` is read, so the block tag stays optional. */
type ContentBlock = {
  /** Block discriminator the host sets to `text`; this fixture never reads it. */
  readonly type?: string
  /** The turn body the fixture joins into one string. */
  readonly text: string
}

/** One FIFO delivery the legacy symbol queue recorded, as the raw arguments it received. */
type QueueCall = {
  /** Session the delivery was made on behalf of. */
  readonly parent: unknown
  /** Child session the turn was addressed to. */
  readonly childId: string
  /** Content blocks joined into one text body. */
  readonly text: string
  /** Provenance the host records for the delivery. */
  readonly source: unknown
}

/** Minimal stand-in for the 0.1.5-rc.2 `SubagentRuntime` service instance. */
function modernRuntime(calls: PromptCall[] = []): { interrupted: string[]; prompt: (request: Record<string, unknown>, signal: AbortSignal) => Promise<{ messageId: string }>; sendMessage: () => Promise<string>; interrupt: () => undefined; calls: PromptCall[] } {
  return {
    interrupted: [] as string[],
    prompt: async (request: Record<string, unknown>, signal: AbortSignal) => {
      calls.push({ request, signal })
      return { messageId: "message-1" }
    },
    sendMessage: async () => "message-2",
    interrupt: () => undefined,
    calls,
  }
}

/** Alpha.5 … 0.1.2-rc.1 shape: the host-only symbol-keyed FIFO queue. */
function symbolQueueRuntime(calls: QueueCall[] = []): { interrupted: string[]; sendMessage: () => Promise<string>; interrupt: () => undefined; calls: QueueCall[]; [key: symbol]: (parent: unknown, childId: string, content: ContentBlock[], source: unknown, signal: AbortSignal) => Promise<string> } {
  return {
    interrupted: [] as string[],
    [HOST_PROMPT_QUEUE]: async (parent: unknown, childId: string, content: ContentBlock[], source: unknown) => {
      calls.push({ parent, childId, text: content.map((block) => block.text).join(""), source })
      return "message-1"
    },
    sendMessage: async () => "message-2",
    interrupt: () => undefined,
    calls,
  }
}

/** Alpha.2 shape: the legacy receiver-bound followup exists. */
function legacyRuntime(): { calls: { parent: unknown; childId: string; text: string; options: { source: unknown } }[]; followup: (parent: unknown, childId: string, content: ContentBlock[], options: { source: unknown }) => Promise<string> } {
  /** Deliveries the legacy followup recorded, which the parity assertion reads back. */
  const calls: { parent: unknown; childId: string; text: string; options: { source: unknown } }[] = []
  return {
    calls,
    followup: async (parent: unknown, childId: string, content: ContentBlock[], options: { source: unknown }) => {
      calls.push({ parent, childId, text: content.map((block) => block.text).join(""), options })
      return "message-legacy"
    },
  }
}

/** Delivery-path ctx double: the runtime under test plus the logger the path reports through. */
function fakeCtx(subagents: unknown): { subagents: unknown; logger: { warn: (..._args: unknown[]) => undefined } } {
  return { subagents, logger: { warn: (..._args: unknown[]) => undefined } }
}

/** A ctx whose `get('agents')` answers the live-parent lookup the prompt guard needs. */
function guardCtx(runtime: unknown, agentsById: Record<string, unknown> = {}): { subagents: unknown; logger: { warn: () => undefined }; get: (name: string) => { get: (id: string) => unknown } | undefined; effect: (cb: () => (() => void) | undefined) => void } {
  return {
    subagents: runtime,
    logger: { warn: () => undefined },
    get: (name: string) => name === "agents" ? { get: (id: string) => agentsById[id] } : undefined,
    effect: (cb: () => (() => void) | undefined) => { cb() },
  }
}

describe("queueMemberPrompt: delivery follows the host generation", () => {
  test("0.1.5-rc.2 host: the public prompt seam carries the team turn as a queued turn", async () => {
    /** Modern runtime double; every assertion below reads the calls it recorded. */
    const runtime = modernRuntime()
    /** Captain session the turn is delivered on behalf of. */
    const captain = { id: "session-captain" }
    /** Cancellation signal whose identity the seam must pass through unchanged. */
    const controller = new AbortController()
    /** Message id the public prompt seam answered with. */
    const id = await queueMemberPrompt(runtime, captain, "member-1", [{ type: "text", text: "assignment" }], controller.signal)
    expect(id).toBe("message-1")
    expect(runtime.calls).toHaveLength(1)
    /** The single recorded prompt call, split into the request and the signal it carried. */
    const { request, signal } = runtime.calls[0]
    expect(request).toMatchObject({
      parentSessionId: "session-captain",
      childSessionId: "member-1",
      mode: "continuable",
      delivery: "queue",
      content: [{ type: "text", text: "assignment" }],
    })
    // The durable request identity is minted per delivery.
    expect(typeof request.requestId).toBe("string")
    // The payload is recorded as `unknown`; the typeof assertion above pins the id to a string.
    expect((request.requestId as string).length).toBeGreaterThan(0)
    expect(signal).toBe(controller.signal)
  })

  test("0.1.5-rc.2 host: public sendMessage is never used for team work", async () => {
    /** Modern runtime double whose `sendMessage` is replaced to count any use of it. */
    const runtime = modernRuntime()
    /** How many times the public sendMessage seam was used; team work must never use it. */
    let steered = 0
    runtime.sendMessage = async () => {
      steered += 1
      return "message-2"
    }
    await queueMemberPrompt(runtime, { id: "session-captain" }, "member-1", [{ type: "text", text: "assignment" }], new AbortController().signal)
    expect(steered).toBe(0)
  })

  test("Alpha.5 … 0.1.2-rc.1 host: the symbol-keyed FIFO queue still carries the turn", async () => {
    /** Symbol-queue runtime double; the ladder must pick its FIFO face over nothing. */
    const runtime = symbolQueueRuntime()
    /** Captain session the turn is delivered on behalf of. */
    const captain = { id: "session-captain" }
    /** Message id the symbol-keyed queue answered with. */
    const id = await queueMemberPrompt(runtime, captain, "member-1", [{ type: "text", text: "assignment" }], new AbortController().signal)
    expect(id).toBe("message-1")
    expect(runtime.calls[0]).toMatchObject({
      parent: captain,
      childId: "member-1",
      text: "assignment",
      source: { kind: "plugin", plugin: "dsh-agent-teams" },
    })
  })

  test("legacy host: the receiver-bound followup still wins when present", async () => {
    /** Alpha.2 runtime double carrying the receiver-bound followup. */
    const runtime = legacyRuntime()
    /** Message id the legacy followup answered with, which must win over the absent modern seam. */
    const id = await queueMemberPrompt(runtime, { id: "session-captain" }, "member-1", [{ type: "text", text: "assignment" }], new AbortController().signal)
    expect(id).toBe("message-legacy")
    expect(runtime.calls[0]).toMatchObject({ childId: "member-1", text: "assignment" })
  })

  test("neither contract: refuses instead of silently dropping the turn", async () => {
    await expect(queueMemberPrompt({}, { id: "session-captain" }, "member-1", [], new AbortController().signal))
      .rejects.toThrow(/unsupported Harness subagent contract/)
  })
})

describe("deliverToMember: the scheduler's wakeup path", () => {
  test("0.1.5-rc.2 runtime delivers through the public prompt seam and reports success", async () => {
    /** Modern runtime double the delivery path is expected to use. */
    const runtime = modernRuntime()
    /** Whether the delivery was accepted; the public prompt seam must report success. */
    const accepted = await deliverToMember(fakeCtx(runtime), { id: "session-captain" }, "member-1", "task t3", new AbortController().signal)
    expect(accepted).toBe(true)
    expect(runtime.calls[0]?.request.childSessionId).toBe("member-1")
    // The recorded payload is `unknown`; the text-block shape is what this arm pins.
    expect((runtime.calls[0]?.request.content as { text: string }[])[0]?.text).toBe("task t3")
  })

  test("a host without any delivery contract reports failure instead of throwing", async () => {
    /** Logger output the failure path must report through, instead of throwing. */
    const warnings: string[] = []
    /** A ctx whose runtime carries no delivery face at all. */
    const ctx = { subagents: {}, logger: { warn: (...args: unknown[]) => warnings.push(args.join(" ")) } }
    /** Whether the delivery was accepted; a hostless ctx must answer false, not throw. */
    const accepted = await deliverToMember(ctx, { id: "session-captain" }, "member-1", "task t3", new AbortController().signal)
    expect(accepted).toBe(false)
    expect(warnings.join("\n")).toContain("member member-1 delivery failed")
  })
})

describe("installContinuableMemberSetup: setup follows the host generation", () => {
  test("legacy host registers the seam directly, never the session-start listener", () => {
    /** Every setup function the legacy seam registered, in registration order. */
    const registered: unknown[] = []
    /** How many session-start listeners were installed; the legacy arm must install none. */
    let listeners = 0
    /** A legacy ctx exposing the continuable-setup seam and the listener seam side by side. */
    const ctx = {
      subagents: { registerContinuableSetup: (setup: unknown) => { registered.push(setup); return () => undefined } },
      on: () => { listeners += 1; return () => undefined },
      effect: () => undefined,
    }
    /** The member setup under test; the legacy seam must receive this very function. */
    const setup = (): (() => void) => () => undefined
    expect(installContinuableMemberSetup(ctx, setup)).toBe(true)
    expect(registered).toEqual([setup])
    expect(listeners).toBe(0)
  })

  test("0.1.5-rc.2 host: setup receives the live Agent and never reads childCtx.agent", () => {
    // The real handler asserts `expect(() => ctx.agent).toThrow()` and returns
    // the Agent, so a regression to `childCtx.agent` fails here with the exact
    // production error instead of passing against a fabricated ctx.
    /** Session-start handlers by event name, so the arm can fire the setup listener itself. */
    const handlers = new Map<string, (payload: unknown) => void>()
    /** Disposers the setup returned, run at the end to prove the teardown path. */
    const disposers: (() => void)[] = []
    /** The live Agent handed to setup; its `ctx.agent` read must throw on this host. */
    const agent: { id: string; ctx: Record<string, unknown> } = { id: "member-1", ctx: {} }
    agent.ctx = {
      effect: () => undefined,
      /** Reading `ctx.agent` without inject throws on this host, which is the arm's whole point. */
      get agent(): never {
        throw new Error('cannot get property "agent" without inject')
      },
    }
    /** The ctx the installer drives: a modern runtime plus the session-start listener seam. */
    const ctx = {
      subagents: modernRuntime(),
      logger: { warn: () => undefined },
      on: (name: string, cb: (payload: unknown) => void) => {
        handlers.set(name, cb)
        return () => handlers.delete(name)
      },
      effect: (cb: () => (() => void) | undefined) => {
        /** Disposer the effect body returned; only a function is worth collecting. */
        const d = cb()
        if (typeof d === "function") disposers.push(d)
      },
    }
    /** Agent ids the setup body saw, plus its once-only teardown marker. */
    const seen: string[] = []
    expect(installContinuableMemberSetup(ctx, (childCtx: { agent: { id: string } }, childAgent: { id: string; ctx: typeof agent.ctx }) => {
      // Must take the Agent from the argument; the ctx read throws on this host.
      void childCtx
      seen.push(childAgent.id)
      return () => seen.push(`teardown:${childAgent.id}`)
    })).toBe(true)

    /** The registered session-start listener, fired twice to prove the once-only guard. */
    const listener = handlers.get("agent/session-start")
    expect(listener).toBeDefined()
    listener?.({ agent })
    listener?.({ agent })
    expect(seen).toEqual(["member-1"])

    for (const dispose of disposers) dispose()
    expect(seen).toEqual(["member-1", "teardown:member-1"])
  })

  test("a host without either seam degrades with a warning instead of aborting apply()", () => {
    /** Logger output the degrade path must report through. */
    const warnings: string[] = []
    /** A ctx carrying neither the continuable-setup seam nor modern delivery. */
    const ctx = { subagents: {}, logger: { warn: (message: string) => warnings.push(message) }, on: () => () => undefined, effect: () => undefined }
    expect(installContinuableMemberSetup(ctx, () => () => undefined)).toBe(false)
    expect(warnings.join("\n")).toContain("unsupported Harness subagent contract")
  })
})

describe("sessionOwnEvents: child history excludes the inherited prefix", () => {
  test("prefers the modern ownEvents()", () => {
    /** A session whose own-events accessor answers the post-seed slice directly. */
    const session = { ownEvents: () => ["own"], events: ["seed", "own"], header: { seedLength: 1 } }
    expect(sessionOwnEvents(session)).toEqual(["own"])
  })

  test("legacy session logs are sliced at seedLength", () => {
    expect(sessionOwnEvents({ events: ["seed", "a", "b"], header: { seedLength: 1 } })).toEqual(["a", "b"])
    expect(sessionOwnEvents({ events: ["a"], header: {} })).toEqual(["a"])
  })

  test("an unreadable log is refused loudly", () => {
    expect(() => sessionOwnEvents({ header: {} })).toThrow(/unsupported Harness subagent contract/)
  })
})

describe("retired-member guard covers every resumable face", () => {
  test("0.1.5-rc.2 host: the public prompt seam rejects a retired member and passes others", async () => {
    /** Modern runtime double whose prompt seam the guard rewrites. */
    const runtime = modernRuntime()
    /** Guard ctx carrying the runtime plus the live-parent registry the lookup needs. */
    const ctx = guardCtx(runtime, { captain: { id: "captain" } })
    /** Ids this arm treats as retired; only the first child session must be refused. */
    const retired = new Set(["retired-1"])
    expect(guardSubagentDelivery(ctx, async (_sender: unknown, targetId: string) => retired.has(targetId))).toBe(true)
    /** Builds one modern prompt request for the given child session. */
    const request = (childSessionId: string): Record<string, unknown> => ({
      requestId: "request-1",
      parentSessionId: "captain",
      childSessionId,
      mode: "continuable",
      delivery: "queue",
      content: [{ type: "text", text: "x" }],
    })
    await expect(runtime.prompt(request("retired-1"), new AbortController().signal))
      .rejects.toThrow(/was retired and cannot be resumed/)
    await expect(runtime.prompt(request("member-9"), new AbortController().signal))
      .resolves.toEqual({ messageId: "message-1" })
    // Only the admitted turn reached the underlying seam.
    expect(runtime.calls).toHaveLength(1)
  })

  test("Alpha.5 … 0.1.2-rc.1 host: the FIFO queue rejects a retired member and passes others", async () => {
    /** Symbol-queue runtime double whose FIFO face the guard rewrites. */
    const runtime = symbolQueueRuntime()
    /** Guard ctx carrying the runtime plus the live-parent registry the lookup needs. */
    const ctx = guardCtx(runtime)
    /** Ids this arm treats as retired; only the first child session must be refused. */
    const retired = new Set(["retired-1"])
    expect(guardSubagentDelivery(ctx, async (_sender: unknown, targetId: string) => retired.has(targetId))).toBe(true)
    // The symbol-keyed FIFO face takes the cancellation signal as its fifth argument, which is
    // the host contract the ladder calls it under.
    await expect(runtime[HOST_PROMPT_QUEUE]({ id: "captain" }, "retired-1", [{ type: "text", text: "x" }], {}, new AbortController().signal))
      .rejects.toThrow(/was retired and cannot be resumed/)
    await expect(runtime[HOST_PROMPT_QUEUE]({ id: "captain" }, "member-9", [{ type: "text", text: "x" }], {}, new AbortController().signal))
      .resolves.toBe("message-1")
  })

  test("legacy host: followup is guarded without inventing the method", async () => {
    /** Alpha.2 runtime double carrying only the receiver-bound followup. */
    const runtime = legacyRuntime()
    /** Guard ctx carrying the runtime plus the live-parent registry the lookup needs. */
    const ctx = guardCtx(runtime)
    guardSubagentDelivery(ctx, async (_sender: unknown, targetId: string) => targetId === "retired-1")
    await expect(runtime.followup({ id: "captain" }, "retired-1", [], { source: {} })).rejects.toThrow(/retired/)
    await expect(runtime.followup({ id: "captain" }, "member-9", [{ type: "text", text: "y" }], { source: {} })).resolves.toBe("message-legacy")
  })

  test("a runtime with no delivery face no longer pretends to guard one", () => {
    /** Logger output the guard's own degrade path must report through. */
    const warnings: string[] = []
    /** A runtime double with all three delivery faces explicitly absent. */
    const runtime = { followup: undefined, prompt: undefined, sendMessage: undefined }
    /** Guard ctx whose runtime cannot serve any delivery face. */
    const ctx = { subagents: runtime, logger: { warn: (message: string) => warnings.push(message) }, effect: (cb: () => (() => void) | undefined) => { cb() } }
    expect(guardSubagentDelivery(ctx, async () => false)).toBe(false)
    // The broken legacy guard used to install itself as `followup`, which then
    // threw "followup.call is not a function" on every real delivery.
    expect(typeof runtime.followup).toBe("undefined")
    expect(warnings.join("\n")).toContain("retired-member guard")
  })
})
