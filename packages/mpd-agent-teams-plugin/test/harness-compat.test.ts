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
import { HOST_PROMPT_QUEUE, guardSubagentDelivery, installContinuableMemberSetup, queueMemberPrompt, sessionOwnEvents } from "../lib/harness-compat.js"
import { deliverToMember } from "../lib/members.js"

interface PromptCall { readonly request: Record<string, unknown>; readonly signal: AbortSignal }

/** Minimal stand-in for the 0.1.5-rc.2 `SubagentRuntime` service instance. */
function modernRuntime(calls: PromptCall[] = []) {
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
function symbolQueueRuntime(calls: { parent: unknown; childId: string; text: string; source: unknown }[] = []) {
  return {
    interrupted: [] as string[],
    [HOST_PROMPT_QUEUE]: async (parent: unknown, childId: string, content: { text: string }[], source: unknown) => {
      calls.push({ parent, childId, text: content.map((block) => block.text).join(""), source })
      return "message-1"
    },
    sendMessage: async () => "message-2",
    interrupt: () => undefined,
    calls,
  }
}

/** Alpha.2 shape: the legacy receiver-bound followup exists. */
function legacyRuntime() {
  const calls: { parent: unknown; childId: string; text: string; options: { source: unknown } }[] = []
  return {
    calls,
    followup: async (parent: unknown, childId: string, content: { text: string }[], options: { source: unknown }) => {
      calls.push({ parent, childId, text: content.map((block) => block.text).join(""), options })
      return "message-legacy"
    },
  }
}

function fakeCtx(subagents: unknown) {
  return { subagents, logger: { warn: (..._args: unknown[]) => undefined } }
}

/** A ctx whose `get('agents')` answers the live-parent lookup the prompt guard needs. */
function guardCtx(runtime: unknown, agentsById: Record<string, unknown> = {}) {
  return {
    subagents: runtime,
    logger: { warn: () => undefined },
    get: (name: string) => name === "agents" ? { get: (id: string) => agentsById[id] } : undefined,
    effect: (cb: () => (() => void) | undefined) => { cb() },
  }
}

describe("queueMemberPrompt: delivery follows the host generation", () => {
  test("0.1.5-rc.2 host: the public prompt seam carries the team turn as a queued turn", async () => {
    const runtime = modernRuntime()
    const captain = { id: "session-captain" }
    const controller = new AbortController()
    const id = await queueMemberPrompt(runtime, captain, "member-1", [{ type: "text", text: "assignment" }], controller.signal)
    expect(id).toBe("message-1")
    expect(runtime.calls).toHaveLength(1)
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
    expect((request.requestId as string).length).toBeGreaterThan(0)
    expect(signal).toBe(controller.signal)
  })

  test("0.1.5-rc.2 host: public sendMessage is never used for team work", async () => {
    const runtime = modernRuntime()
    let steered = 0
    runtime.sendMessage = async () => {
      steered += 1
      return "message-2"
    }
    await queueMemberPrompt(runtime, { id: "session-captain" }, "member-1", [{ type: "text", text: "assignment" }], new AbortController().signal)
    expect(steered).toBe(0)
  })

  test("Alpha.5 … 0.1.2-rc.1 host: the symbol-keyed FIFO queue still carries the turn", async () => {
    const runtime = symbolQueueRuntime()
    const captain = { id: "session-captain" }
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
    const runtime = legacyRuntime()
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
    const runtime = modernRuntime()
    const accepted = await deliverToMember(fakeCtx(runtime), { id: "session-captain" }, "member-1", "task t3", new AbortController().signal)
    expect(accepted).toBe(true)
    expect(runtime.calls[0]?.request.childSessionId).toBe("member-1")
    expect((runtime.calls[0]?.request.content as { text: string }[])[0]?.text).toBe("task t3")
  })

  test("a host without any delivery contract reports failure instead of throwing", async () => {
    const warnings: string[] = []
    const ctx = { subagents: {}, logger: { warn: (...args: unknown[]) => warnings.push(args.join(" ")) } }
    const accepted = await deliverToMember(ctx, { id: "session-captain" }, "member-1", "task t3", new AbortController().signal)
    expect(accepted).toBe(false)
    expect(warnings.join("\n")).toContain("member member-1 delivery failed")
  })
})

describe("installContinuableMemberSetup: setup follows the host generation", () => {
  test("legacy host registers the seam directly, never the session-start listener", () => {
    const registered: unknown[] = []
    let listeners = 0
    const ctx = {
      subagents: { registerContinuableSetup: (setup: unknown) => { registered.push(setup); return () => undefined } },
      on: () => { listeners += 1; return () => undefined },
      effect: () => undefined,
    }
    const setup = () => () => undefined
    expect(installContinuableMemberSetup(ctx, setup)).toBe(true)
    expect(registered).toEqual([setup])
    expect(listeners).toBe(0)
  })

  test("0.1.5-rc.2 host: setup receives the live Agent and never reads childCtx.agent", () => {
    // The real handler asserts `expect(() => ctx.agent).toThrow()` and returns
    // the Agent, so a regression to `childCtx.agent` fails here with the exact
    // production error instead of passing against a fabricated ctx.
    const handlers = new Map<string, (payload: unknown) => void>()
    const disposers: (() => void)[] = []
    const agent = { id: "member-1", ctx: {} as Record<string, unknown> }
    agent.ctx = {
      effect: () => undefined,
      get agent(): never {
        throw new Error('cannot get property "agent" without inject')
      },
    }
    const ctx = {
      subagents: modernRuntime(),
      logger: { warn: () => undefined },
      on: (name: string, cb: (payload: unknown) => void) => {
        handlers.set(name, cb)
        return () => handlers.delete(name)
      },
      effect: (cb: () => (() => void) | undefined) => { const d = cb(); if (typeof d === "function") disposers.push(d) },
    }
    const seen: string[] = []
    expect(installContinuableMemberSetup(ctx, (childCtx: { agent: { id: string } }, childAgent: { id: string; ctx: typeof agent.ctx }) => {
      // Must take the Agent from the argument; the ctx read throws on this host.
      void childCtx
      seen.push(childAgent.id)
      return () => seen.push(`teardown:${childAgent.id}`)
    })).toBe(true)

    const listener = handlers.get("agent/session-start")
    expect(listener).toBeDefined()
    listener?.({ agent })
    listener?.({ agent })
    expect(seen).toEqual(["member-1"])

    for (const dispose of disposers) dispose()
    expect(seen).toEqual(["member-1", "teardown:member-1"])
  })

  test("a host without either seam degrades with a warning instead of aborting apply()", () => {
    const warnings: string[] = []
    const ctx = { subagents: {}, logger: { warn: (message: string) => warnings.push(message) }, on: () => () => undefined, effect: () => undefined }
    expect(installContinuableMemberSetup(ctx, () => () => undefined)).toBe(false)
    expect(warnings.join("\n")).toContain("unsupported Harness subagent contract")
  })
})

describe("sessionOwnEvents: child history excludes the inherited prefix", () => {
  test("prefers the modern ownEvents()", () => {
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
    const runtime = modernRuntime()
    const ctx = guardCtx(runtime, { captain: { id: "captain" } })
    const retired = new Set(["retired-1"])
    expect(guardSubagentDelivery(ctx, async (_sender, targetId) => retired.has(targetId))).toBe(true)
    const request = (childSessionId: string) => ({
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
    const runtime = symbolQueueRuntime()
    const ctx = guardCtx(runtime)
    const retired = new Set(["retired-1"])
    expect(guardSubagentDelivery(ctx, async (_sender, targetId) => retired.has(targetId))).toBe(true)
    await expect(runtime[HOST_PROMPT_QUEUE]({ id: "captain" }, "retired-1", [{ type: "text", text: "x" }], {}, new AbortController().signal))
      .rejects.toThrow(/was retired and cannot be resumed/)
    await expect(runtime[HOST_PROMPT_QUEUE]({ id: "captain" }, "member-9", [{ type: "text", text: "x" }], {}, new AbortController().signal))
      .resolves.toBe("message-1")
  })

  test("legacy host: followup is guarded without inventing the method", async () => {
    const runtime = legacyRuntime()
    const ctx = guardCtx(runtime)
    guardSubagentDelivery(ctx, async (_sender, targetId) => targetId === "retired-1")
    await expect(runtime.followup({ id: "captain" }, "retired-1", [], { source: {} })).rejects.toThrow(/retired/)
    await expect(runtime.followup({ id: "captain" }, "member-9", [{ type: "text", text: "y" }], { source: {} })).resolves.toBe("message-legacy")
  })

  test("a runtime with no delivery face no longer pretends to guard one", () => {
    const warnings: string[] = []
    const runtime = { followup: undefined, prompt: undefined, sendMessage: undefined }
    const ctx = { subagents: runtime, logger: { warn: (message: string) => warnings.push(message) }, effect: (cb: () => (() => void) | undefined) => { cb() } }
    expect(guardSubagentDelivery(ctx, async () => false)).toBe(false)
    // The broken legacy guard used to install itself as `followup`, which then
    // threw "followup.call is not a function" on every real delivery.
    expect(typeof runtime.followup).toBe("undefined")
    expect(warnings.join("\n")).toContain("retired-member guard")
  })
})
