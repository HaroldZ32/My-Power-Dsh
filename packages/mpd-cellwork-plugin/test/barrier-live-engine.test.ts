// CELLWORK BARRIER — the compaction engine from the LIVE member (D1/C1) and the reseed parent from a
// LIVE session (D1/C2).
//
// WHY THIS FILE EXISTS (VEdit P0, lane A): every member reaching the context checkpoint was FENCED. The
// `agent/turn-stopping` listener detached the barrier with `void runBarrier(...)`, so the host's serial
// dispatch had already moved on; the barrier then slept, asked the registry for the member by session id
// (the member was gone: `no-engine`) and reseeded with the DEAD member as `request.parent`, which the
// host's `startActivation` refuses with `UNAUTHORIZED: subagent creation requires the exact live parent
// agent` (Band 0 `cell-20261031T085543161Z`, Band 1 `cell-20261102T050548232Z`).
//
// THE REGISTRY DOUBLE enforces the host's own documented condition — `agents.get(parent.id) === parent`
// — so a reseed raised under a detached handle throws EXACTLY as the host does. `detachMember` reproduces
// the measured state: the member's Agent is still the one the event handed us, but the registry no longer
// lists it.
//
// Every workspace is a fresh temp dir; nothing here reads the repository's own state.
import { test, expect } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { handoffPath, journalPath, newCellState, statePath, writeCell, type CellState } from "../src/state.ts"
import { installCellworkProtocol } from "../src/protocol.ts"
import { DEFAULT_CELLWORK_CONFIG } from "../src/config.ts"
import type { DshAdapter } from "../../mpd-dsh-adapter-plugin/src/index.ts"
import { createDshAdapter } from "../../mpd-dsh-adapter-plugin/src/index.ts"

/** The cell id every arm works in. */
const CELL_ID = "cell-20261103T000000000Z"

/** The team id the cell record names. */
const TEAM_ID = "team-barrier-live"

/** The captain's session id (the LAST reseed-parent fallback). */
const CAPTAIN_SESSION = "session-captain"

/** The member's session id, which the cell record knows it by. */
const MEMBER_SESSION = "session-member"

/** The member's durable parent session id, read from the stopping agent's session header. */
const PARENT_SESSION = "session-parent"

/** The member's board name inside the cell. */
const MEMBER_NAME = "Senior Engineer"

/** One compaction engine as the seams hand it back. */
interface Engine {
  /** The collected drives, one entry per `compactNow` call. */
  calls: Array<{ agent: unknown; at: number }>
  /** The host engine's drive, answering whatever the arm scripted. */
  compactNow: (agent: unknown, signal: AbortSignal) => Promise<unknown>
}

/** One fake live Agent: the id the registry keys it by and its own scoped context. */
interface FakeAgent {
  /** The shared session/agent id. */
  id: string
  /** The session the workspace root, the parent link and the delegation depth resolve from. */
  session: { id: string; header: { cwd: string; parentSession?: string; delegationDepth?: number; origin?: string } }
  /** The Agent's own scoped context, which serves the member's engine. */
  ctx?: { get: (name: string) => unknown }
}

/** One captured tool definition (only the fields these arms read). */
interface CapturedTool {
  /** The registered name. */
  name: string
  /** The runner, called with the harness-validated arguments and the dispatch. */
  execute: (args: unknown, exec: unknown) => Promise<unknown>
}

/** The fake harness one arm drives. */
interface Harness {
  /** The temp workspace every root resolves to. */
  workspace: string
  /** The stopping member's handle, which the event carries. */
  member: FakeAgent
  /** The member's original parent handle. */
  parent: FakeAgent
  /** The captain's handle. */
  captain: FakeAgent
  /** The live-session registry the adapter's lookups consult. */
  registry: Map<string, FakeAgent>
  /** The engine the member's own scope serves. */
  engine: Engine
  /** Every reseed the barrier raised, with the parent object and the `maxDepth` it handed the host. */
  reseeds: Array<{ parent: unknown; prompt: string; maxDepth: unknown }>
  /** Every interrupt the barrier issued (`targetSessionId`). */
  interrupts: string[]
  /** Every directive injected into the member. */
  directives: string[]
  /** The registered event handlers, by event name. */
  events: Map<string, (payload: unknown) => unknown>
  /** Every `agentPresets.serviceFor` call the REAL adapter made (the preset-realm door's evidence). */
  presetDoorCalls: Array<{ agent: unknown; key: string }>
  /** The adapter double, kept so an arm can read the seams it was handed. */
  adapter: Record<string, unknown>
}

/** Options one arm may change on the harness. */
interface HarnessOptions {
  /** Whether the member's Agent is STILL in the registry (false is the measured D1 state). */
  detached?: boolean
  /** Whether the parent handle is still live. */
  parentLive?: boolean
  /** Whether the captain handle is still live. */
  captainLive?: boolean
  /**
   * The delegation facts on the PARENT's session header, which is what the reseed's `maxDepth` derives
   * from (R2.1). Absent means a top-level parent: depth 0, so the child lands at depth 1.
   */
  parentHeader?: { delegationDepth?: number; origin?: string }
  /** Whether the live-handle engine seam exists (false = an older mounted adapter). */
  liveEngineSeam?: boolean
  /**
   * WHICH doors the member's engine is reachable through — the composition this arm models.
   *
   * `agent-scope` (the default) is the composition every pre-existing arm models: the engine sits on
   * `agent.ctx`. `preset` is the REAL one under dsh-tui 0.18.0: the host's root `compaction-basic` row is
   * disabled and this bundle's preset realm-isolates compaction, so `agent.ctx` serves NOTHING and the
   * only door is `agentPresets.serviceFor(agent, "compaction")`. `none` mounts neither door, which is the
   * `no-engine` case.
   */
  engineDoors?: "agent-scope" | "preset" | "none"
  /**
   * The engine the REGISTRY seam answers instead of the member's own.
   *
   * N1's arm needs BOTH sources reachable at once with DIFFERENT answers: without it the registry and
   * the handle serve the same object, so a registry-first implementation would pass every existing arm.
   */
  registryEngineOverride?: Engine
  /** The engine's scripted answers, one per drive; the last one repeats. */
  answers?: readonly unknown[]
  /** The knobs that change the arm's timing. */
  knobs?: Partial<typeof DEFAULT_CELLWORK_CONFIG>
}

/**
 * One member row as the CELL record stores it: handoff-ready, waiting for the barrier.
 *
 * @returns the member row.
 */
function memberRow(): CellState["members"][string] {
  return {
    name: MEMBER_NAME,
    role: MEMBER_NAME,
    sessionId: MEMBER_SESSION,
    executorRef: "handle-" + MEMBER_NAME,
    mode: "checkpoint",
    handoffReady: true,
    handoffs: 1,
    joinedAt: "2026-11-03T00:00:00.000Z",
  }
}

/**
 * Build the harness: a temp workspace with one handoff-ready member, a registry double, and the protocol
 * tools installed once.
 *
 * @param options - the registry/detachment/timing variation this arm needs.
 * @returns the harness with every captured registration.
 */
function makeHarness(options: HarnessOptions = {}): Harness {
  /** The fresh temp workspace. */
  const workspace = mkdtempSync(join(tmpdir(), "mpd-cellwork-barrier-"))
  /** The cell record, persisted so the barrier reads it back like a real cell. */
  const base = newCellState({ cellId: CELL_ID, objective: "ship the widget", captainSessionId: CAPTAIN_SESSION, now: new Date("2026-11-03T00:00:00.000Z") })
  writeCell(workspace, { ...base, phase: "executing", teamId: TEAM_ID, members: { [MEMBER_NAME]: memberRow() } })
  /** The handoff document the barrier compacts and reseeds from. */
  mkdirSync(join(workspace, ".mpd", "cellwork", CELL_ID, "handoff"), { recursive: true })
  writeFileSync(handoffPath(workspace, CELL_ID, MEMBER_NAME, 1), ["## Task", "finish the widget", "## State", "half", "## Decisions", "one", "## Artifacts", "src/a.ts", "## Verified facts", "tests pass", "## Open questions", "none", "## Next step", "finish B"].join("\n") + "\n")
  /** The scripted engine answers, the last one repeating. */
  const answers = options.answers === undefined ? [{ shadowedTokenCount: 5 }] : [...options.answers]
  /** The drives the engine collected. */
  const calls: Array<{ agent: unknown; at: number }> = []
  /** The member's own engine, served from its scoped context. */
  const engine: Engine = {
    calls,
    compactNow: async (agent: unknown): Promise<unknown> => {
      calls.push({ agent, at: Date.now() })
      return answers[Math.min(calls.length - 1, answers.length - 1)]
    },
  }
  /** The captain's handle, whose session the cell record names. */
  const captain: FakeAgent = { id: CAPTAIN_SESSION, session: { id: CAPTAIN_SESSION, header: { cwd: workspace } } }
  /** The member's original parent handle, whose header decides the reseed's depth cap. */
  const parent: FakeAgent = { id: PARENT_SESSION, session: { id: PARENT_SESSION, header: { cwd: workspace, ...(options.parentHeader ?? {}) } } }
  /** Which doors serve the engine in the composition this arm models. */
  const doors = options.engineDoors ?? "agent-scope"
  /** The engine the member's OWN SCOPE serves: nothing when the preset realm isolates compaction. */
  const scopedEngine = doors === "agent-scope" ? engine : undefined
  /** The stopping member's handle: still carrying its engine, even when the registry forgot it. */
  const member: FakeAgent = { id: MEMBER_SESSION, session: { id: MEMBER_SESSION, header: { cwd: workspace, parentSession: PARENT_SESSION } }, ctx: { get: (name: string): unknown => (name === "compaction" ? scopedEngine : undefined) } }
  /** The live-session registry, which is what the adapter's lookups actually consult. */
  const registry = new Map<string, FakeAgent>()
  if (options.captainLive !== false) registry.set(CAPTAIN_SESSION, captain)
  if (options.parentLive !== false) registry.set(PARENT_SESSION, parent)
  if (options.detached !== true) registry.set(MEMBER_SESSION, member)
  /** Every reseed the barrier raised, with the depth cap it forwarded. */
  const reseeds: Array<{ parent: unknown; prompt: string; maxDepth: unknown }> = []
  /** Every interrupt the barrier issued. */
  const interrupts: string[] = []
  /** Every directive injected into the member. */
  const directives: string[] = []
  /** Every `agentPresets.serviceFor` call the REAL adapter made. */
  const presetDoorCalls: Array<{ agent: unknown; key: string }> = []
  /** The registered event handlers. */
  const events = new Map<string, (payload: unknown) => unknown>()
  /** The captured tool definitions. */
  const tools = new Map<string, CapturedTool>()
  /** The engine the registry-lookup seam answers with: the member's own, only while it is LIVE. */
  const registryEngine = (id: string): unknown => options.registryEngineOverride ?? registry.get(String(id ?? ""))?.ctx?.get("compaction")
  /** The adapter double: the shape the host exposes, narrowed to what the barrier touches. */
  const adapter: Record<string, unknown> = {
    registerTool: (definition: CapturedTool): (() => void) => { tools.set(definition.name, definition); return (): void => {} },
    onAgentPreStep: (): undefined => undefined,
    onEvent: (name: string, handler: (payload: unknown) => unknown): (() => void) => { events.set(name, handler); return (): void => {} },
    workspaceRoot: (): string => workspace,
    contextPressure: (): Record<string, unknown> => ({ usedTokens: null, windowTokens: null, ratio: null, provenance: "no-window" }),
    liveAgent: (id: string): FakeAgent | undefined => registry.get(String(id ?? "")),
    liveAgentExact: (id: string): FakeAgent | undefined => registry.get(String(id ?? "")),
    compactionEngineForAgent: (id: string): unknown => registryEngine(id),
    userMessage: (value: unknown): unknown => value,
    injectAgentMessage: (_agent: unknown, message: unknown): void => { directives.push(String((message as { text?: unknown }).text ?? "")) },
    interruptAgent: (targetSessionId: string): void => { interrupts.push(targetSessionId) },
    startContinuableAgent: async (spec: unknown): Promise<unknown> => {
      /** The raised request, read structurally because the seam takes `unknown`. */
      const request = (spec as { request?: { parent?: FakeAgent; prompt?: string; maxDepth?: unknown } } | undefined)?.request
      reseeds.push({ parent: request?.parent, prompt: String(request?.prompt ?? ""), maxDepth: request?.maxDepth })
      // THE HOST'S OWN CONDITION, enforced by the double: a parent the registry no longer holds is
      // refused with the exact sentence the fences recorded.
      if (request?.parent === undefined || registry.get(request.parent.id) !== request.parent) {
        throw new Error("UNAUTHORIZED: subagent creation requires the exact live parent agent")
      }
      return { childId: "handle-fresh" }
    },
    executeTool: async (): Promise<Record<string, unknown>> => ({ ok: true, isError: false, value: {} }),
  }
  if (doors === "agent-scope") {
    // THE PRE-EXISTING COMPOSITION: the double answers the member's own scope, exactly as before.
    if (options.liveEngineSeam !== false) {
      adapter.compactionEngineForLiveAgent = (agent: unknown): unknown => (agent as FakeAgent | undefined)?.ctx?.get("compaction")
    }
  } else {
    // THE REAL COMPOSITION: both engine seams come from the REAL adapter, built over a context that
    // mounts (or, for `none`, deliberately does not mount) the host's preset roster.
    /** The real adapter over this composition's services. */
    const real = createDshAdapter({
      get: (name: string): unknown => {
        if (name === "agentPresets") {
          if (doors !== "preset") return undefined
          return {
            serviceFor: (target: unknown, key: string): unknown => {
              presetDoorCalls.push({ agent: target, key })
              return key === "compaction" ? engine : undefined
            },
          }
        }
        if (name === "agents") return { get: (id: string): unknown => registry.get(String(id ?? "")) }
        return undefined
      },
    } as never)
    adapter.compactionEngineForLiveAgent = real.compactionEngineForLiveAgent
    adapter.compactionEngineForAgent = real.compactionEngineForAgent
  }
  installCellworkProtocol({
    dsh: adapter as unknown as DshAdapter,
    ctx: { get: (): undefined => undefined },
    config: { ...DEFAULT_CELLWORK_CONFIG, compactionRetries: 1, idleBarrierDelayMs: 0, ...options.knobs },
    warn: (): void => {},
  })
  return { workspace, member, parent, captain, registry, engine, reseeds, interrupts, directives, events, presetDoorCalls, adapter }
}

/**
 * The barrier the plugin registered for `agent/turn-stopping`.
 *
 * @param harness - the harness whose registration is read.
 * @returns the listener.
 */
function stopListener(harness: Harness): (payload: unknown) => unknown {
  /** The registered listener. */
  const listener = harness.events.get("agent/turn-stopping")
  if (listener === undefined) throw new Error("the plugin registered no agent/turn-stopping listener")
  return listener
}

/**
 * Every journal row of the harness's cell, in append order.
 *
 * @param harness - the harness whose cell is read.
 * @returns the parsed rows.
 */
function journalRows(harness: Harness): Array<Record<string, unknown>> {
  /** The raw journal text, or "" when nothing was journaled yet. */
  let text = ""
  try {
    text = readFileSync(journalPath(harness.workspace, CELL_ID), "utf8")
  } catch {
    return []
  }
  return text.split("\n").filter((line) => line.trim() !== "").map((line) => JSON.parse(line) as Record<string, unknown>)
}

/**
 * The member row exactly as the record file holds it, read raw so an additive key is observable.
 *
 * @param harness - the harness whose cell is read.
 * @returns the stored row.
 */
function rawMember(harness: Harness): Record<string, unknown> {
  /** The parsed record file. */
  const parsed = JSON.parse(readFileSync(statePath(harness.workspace, CELL_ID), "utf8")) as { members?: Record<string, Record<string, unknown>> }
  return parsed.members?.[MEMBER_NAME] ?? {}
}

// ── C6(a): the listener hands the host an awaitable ─────────────────────────

test("D1/C6(a): the turn-stopping listener RETURNS the barrier promise, so the serial dispatch awaits it", async () => {
  /** The harness whose member is detached after its turn. */
  const harness = makeHarness({ detached: true })
  /** Whatever the listener handed the host. */
  const returned = stopListener(harness)({ agent: harness.member })
  // A returned promise is awaited by the host's serial dispatch; `void` is not, and that is the defect.
  expect(returned).toBeInstanceOf(Promise)
  await returned
  // The barrier really ran: the member's own engine was driven once.
  expect(harness.engine.calls.length).toBe(1)
})

// ── C6(b,c,d): the LIVE handle is the engine's source ──────────────────────

test("D1/C6(b,c,d): the engine comes from the LIVE handle even when the registry lookup misses, and a compacted member is PROMOTED (not fenced)", async () => {
  /** The harness whose member the registry no longer lists. */
  const harness = makeHarness({ detached: true })
  // The exact D1 condition: the registry would answer `no-engine`, the handle still serves the engine.
  expect(harness.adapter.compactionEngineForAgent === undefined ? undefined : (harness.adapter.compactionEngineForAgent as (id: string) => unknown)(MEMBER_SESSION)).toBeUndefined()
  await stopListener(harness)({ agent: harness.member })
  expect(harness.engine.calls.length).toBe(1)
  expect(harness.engine.calls[0].agent).toBe(harness.member)
  expect(harness.directives.length).toBe(1)
  expect(harness.directives[0]).toContain("PROMOTED")
  expect(harness.reseeds.length).toBe(0)
  // N4 — NO INTERRUPT: C1's promoted path keeps the member live, and an interrupt would kill exactly the
  // member this arm proves survives (the harness collects every interruptAgent call).
  expect(harness.interrupts.length).toBe(0)
  /** The persisted member row. */
  const stored = rawMember(harness)
  expect(stored.mode).toBe("subcaptain")
  expect(stored.handoffReady).toBe(false)
  expect("fenced" in stored).toBe(false)
  /** The journal rows the barrier wrote. */
  const rows = journalRows(harness)
  expect(rows.some((row) => row.event === "compaction" && row.outcome === "promoted")).toBe(true)
  expect(rows.some((row) => row.event === "checkpoint-unrecoverable")).toBe(false)
})

/**
 * Install the ORDER probe: every timer with a POSITIVE delay scheduled inside the window is recorded into
 * `timeline`, in the order it is scheduled; the arm records the engine's own drives into the SAME list.
 *
 * WHY EVERY TIMER, NOT ONLY THE CONFIGURED ONE (A3-F2): recording just `idleBarrierDelayMs` left a
 * HARD-CODED pre-attempt sleep invisible — the reviewer's `await deps.sleep(200)` mutation stayed green —
 * and the D1 defect this contract removes WAS a hard-coded 200 ms sleep. So ANY positive delay is
 * recorded, with its own value in the entry: a red names what was scheduled, and a hard-coded sleep can no
 * longer hide behind the knob. A `0 ms` tick is not a sleep and is ignored.
 * @returns the shared timeline and the restore function the arm MUST call in `finally`.
 */
function orderProbe(): { timeline: string[]; restore: () => void } {
  /** The events in the order they really happen: `drive` from the engine, `timer(<ms>)` from the clock. */
  const timeline: string[] = []
  /** The runtime's own timer, put back by `restore()` so no later arm inherits the probe. */
  const realSetTimeout = globalThis.setTimeout
  globalThis.setTimeout = ((callback: (...args: never[]) => void, ms?: number, ...rest: never[]) => {
    if (typeof ms === "number" && ms > 0) timeline.push("timer(" + ms + "ms)")
    return realSetTimeout(callback as never, ms, ...(rest as never[]))
  }) as unknown as typeof globalThis.setTimeout
  return { timeline, restore: (): void => { globalThis.setTimeout = realSetTimeout } }
}

test("C1: the FIRST attempt is driven BEFORE any delay is scheduled — ANY delay, hard-coded included (ORDER, never a duration bound)", async () => {
  /** The harness whose configured delay is far longer than any reasonable first attempt. */
  const harness = makeHarness({ detached: true, answers: [{ shadowedTokenCount: 5 }], knobs: { compactionRetries: 1, idleBarrierDelayMs: 1500 } })
  /** The clock probe: every positive-delay timer scheduled in the window lands in the timeline. */
  const probe = orderProbe()
  /** The member's own drive, recorded into the SAME timeline the clock probe writes to. */
  const realCompactNow = harness.engine.compactNow
  harness.engine.compactNow = async (agent: unknown, signal: AbortSignal): Promise<unknown> => {
    probe.timeline.push("drive")
    return realCompactNow(agent, signal)
  }
  try {
    await stopListener(harness)({ agent: harness.member })
  } finally {
    probe.restore()
  }
  expect(harness.engine.calls.length).toBe(1)
  // THE CLAUSE: the drive is the ONLY event — so it is necessarily the first. ANY timer before it reddens,
  // and the failure message spells exactly what was scheduled (e.g. `timer(200ms)`, the D1 defect's own
  // value), which is the blindness the previous probe had.
  expect(probe.timeline).toEqual(["drive"])
})

test("C1: the ORDER probe SEES a real retry sleep, whatever its length (two-sided control)", async () => {
  /** The harness whose first attempt answers null, so the SECOND one follows a real sleep. */
  const harness = makeHarness({ detached: true, answers: [null, { shadowedTokenCount: 5 }], knobs: { compactionRetries: 2, idleBarrierDelayMs: 40 } })
  /** The same clock probe the arm above uses. */
  const probe = orderProbe()
  /** The member's own drive, recorded into the SAME timeline the clock probe writes to. */
  const realCompactNow = harness.engine.compactNow
  harness.engine.compactNow = async (agent: unknown, signal: AbortSignal): Promise<unknown> => {
    probe.timeline.push("drive")
    return realCompactNow(agent, signal)
  }
  try {
    await stopListener(harness)({ agent: harness.member })
  } finally {
    probe.restore()
  }
  // THE CONTROL: the probe is NOT blind — the retry really scheduled a timer, and only AFTER the first drive.
  expect(harness.engine.calls.length).toBe(2)
  expect(probe.timeline).toContain("timer(40ms)")
  expect(probe.timeline[0]).toBe("drive")
  expect(probe.timeline.indexOf("timer(40ms)")).toBeGreaterThan(probe.timeline.indexOf("drive"))
})

test("C1: the registry lookup is the FALLBACK for a composition without the live-handle seam", async () => {
  /** The harness with an older adapter (no `compactionEngineForLiveAgent`) whose member is still live. */
  const harness = makeHarness({ detached: false, liveEngineSeam: false })
  await stopListener(harness)({ agent: harness.member })
  expect(harness.engine.calls.length).toBe(1)
  expect(harness.directives.length).toBe(1)
  expect(String(rawMember(harness).mode)).toBe("subcaptain")
})

test("D1/C1: the LIVE handle's engine WINS over a registry that answers a DIFFERENT engine", async () => {
  /** The engine the registry would serve — a different object from the member's own. */
  const otherEngine: Engine = { calls: [], compactNow: async (): Promise<unknown> => ({ shadowedTokenCount: 1 }) }
  /** The harness whose member is STILL registered, while the registry answers that other engine. */
  const harness = makeHarness({ detached: false, registryEngineOverride: otherEngine })
  // BOTH sources are reachable in this arm, with different answers: that is what makes the order visible.
  expect((harness.adapter.compactionEngineForAgent as (id: string) => unknown)(MEMBER_SESSION)).toBe(otherEngine)
  await stopListener(harness)({ agent: harness.member })
  // THE HANDLE WINS: the member's own engine was driven, once, with the member as the agent.
  expect(harness.engine.calls.length).toBe(1)
  expect(harness.engine.calls[0].agent).toBe(harness.member)
  // THE PRIORITY, which no same-engine arm could see: a registry-first implementation would drive THIS
  // engine and answer from a different shadowed count — the recycled-incarnation defect C1 freezes.
  expect(otherEngine.calls.length).toBe(0)
  expect(String(rawMember(harness).mode)).toBe("subcaptain")
})

// ── C6(e,f,g): the reseed parent is a LIVE session ─────────────────────────

test("D1/C6(e): a reseed is raised under the LIVE parent object, never the dead member", async () => {
  /** The harness whose engine answers "no safely compactable range" on every attempt. */
  const harness = makeHarness({ detached: true, answers: [null] })
  await stopListener(harness)({ agent: harness.member })
  expect(harness.reseeds.length).toBe(1)
  // THE HOST'S CONDITION: the parent object IS the object the registry holds.
  expect(harness.reseeds[0].parent).toBe(harness.parent)
  expect(harness.registry.get(PARENT_SESSION)).toBe(harness.parent)
  expect(harness.reseeds[0].parent).not.toBe(harness.member)
  expect(harness.reseeds[0].prompt).toContain("finish B")
  expect(String(rawMember(harness).mode)).toBe("subcaptain")
})

test("D1/C6(f): a dead parent falls back to the CAPTAIN, and the fallback is journaled as a fact", async () => {
  /** The harness whose original parent session ended but whose captain is still live. */
  const harness = makeHarness({ detached: true, answers: [null], parentLive: false })
  await stopListener(harness)({ agent: harness.member })
  expect(harness.reseeds.length).toBe(1)
  expect(harness.reseeds[0].parent).toBe(harness.captain)
  /** The journal row that records which parent was used. */
  const row = journalRows(harness).find((entry) => entry.event === "reseed-parent")
  expect(row?.parentSource).toBe("captain")
  expect(row?.parentSessionId).toBe(CAPTAIN_SESSION)
  expect(String(row?.originalParentSessionId)).toBe(PARENT_SESSION)
})

// ── R2.1: the reseed cap is the LIVE PARENT's depth + 1 ────────────────────

test("R2.1: the reseed forwards the parent's depth + 1, never `cellwork.depthMax`", async () => {
  // The two scales DIFFER on purpose (3 vs 2): the cell cap counts nested CELLS, the child lands one
  // level below its parent, so a forwarded cell cap would name a level the child never occupies.
  /** The harness whose parent sits at delegation depth 1 in a cell tree bounded at 3. */
  const harness = makeHarness({ detached: true, answers: [null], parentHeader: { delegationDepth: 1 }, knobs: { depthMax: 3 } })
  await stopListener(harness)({ agent: harness.member })
  expect(harness.reseeds.length).toBe(1)
  expect(harness.reseeds[0].maxDepth).toBe(2)
  // The cell-tree knob is NOT what travels, and the host's hidden default is never reached.
  expect(harness.reseeds[0].maxDepth).not.toBe(3)
  expect(harness.reseeds[0].maxDepth).not.toBeUndefined()
})

test("R2.1: a deeper parent moves the cap with it, and a top-level parent answers 1", async () => {
  /** A parent recorded at delegation depth 2, the cell tree still bounded at 3. */
  const deep = makeHarness({ detached: true, answers: [null], parentHeader: { delegationDepth: 2 }, knobs: { depthMax: 3 } })
  await stopListener(deep)({ agent: deep.member })
  expect(deep.reseeds[0].maxDepth).toBe(3)
  /** A parent with no recorded depth at all: a top-level session, whose child lands at depth 1. */
  const top = makeHarness({ detached: true, answers: [null], knobs: { depthMax: 3 } })
  await stopListener(top)({ agent: top.member })
  expect(top.reseeds[0].maxDepth).toBe(1)
  /** A parent recorded as a subagent with no depth: a CHILD, so its own child lands one level lower. */
  const child = makeHarness({ detached: true, answers: [null], parentHeader: { origin: "subagent" }, knobs: { depthMax: 3 } })
  await stopListener(child)({ agent: child.member })
  expect(child.reseeds[0].maxDepth).toBe(2)
})

test("R2.1: the fallback to the CAPTAIN derives from the captain's own depth, not the member's parent's", async () => {
  /** The harness whose original parent is dead, so the captain is the live parent the child lands under. */
  const harness = makeHarness({ detached: true, answers: [null], parentLive: false })
  await stopListener(harness)({ agent: harness.member })
  expect(harness.reseeds.length).toBe(1)
  expect(harness.reseeds[0].parent).toBe(harness.captain)
  // The captain's session records no delegation depth, so the reseeded child is a depth-1 session.
  expect(harness.reseeds[0].maxDepth).toBe(1)
})

test("D1/C6(g): with BOTH parents dead the reseed is refused as `reseed-parent-unavailable` and no child is raised", async () => {
  /** The harness whose parent AND captain sessions are gone. */
  const harness = makeHarness({ detached: true, answers: [null], parentLive: false, captainLive: false })
  await stopListener(harness)({ agent: harness.member })
  // NO child: a reseed under a dead parent is the very throw this fix removes.
  expect(harness.reseeds.length).toBe(0)
  /** The member row the refused barrier fenced. */
  const stored = rawMember(harness)
  expect(stored.fenced).toBe(true)
  expect(String(stored.fencedReason)).toContain("reseed-parent-unavailable")
  // The reason keeps the ENGINE classification AND the reseed refusal apart: `no-safe-range` here (the
  // engine existed and answered null), which a `no-engine` composition would report instead.
  expect(String(stored.fencedReason)).toContain("no-safe-range")
  expect(String(stored.fencedReason)).not.toContain("UNAUTHORIZED")
  /** The give-up journal row. */
  const row = journalRows(harness).find((entry) => entry.event === "checkpoint-unrecoverable")
  expect(String(row?.reason)).toContain("reseed-parent-unavailable")
})

test("C2: the reseed parent ids are carried, and a host throw during the reseed still appends its sentence", async () => {
  /** The harness whose live parent makes the reseed reach the host, which then refuses for its own reason. */
  const harness = makeHarness({ detached: true, answers: [null] })
  // The host seam refuses even a LIVE parent here, so the appended sentence is observable.
  harness.adapter.startContinuableAgent = async (): Promise<never> => { throw new Error("the host is out of slots") }
  await stopListener(harness)({ agent: harness.member })
  expect(String(rawMember(harness).fencedReason)).toContain("the reseed failed: the host is out of slots")
})

// ── ROOT CAUSE 1: the engine lives in the preset's ISOLATE realm ───────────
//
// dsh-tui 0.18.0 disables the host's root `compaction-basic` row and this bundle's `mpd` preset mounts
// compaction inside `isolate: { compaction: true, … }`. A realm-isolated service is NOT reachable from
// `agent.ctx`, which is why every arm above stayed green while production answered `no-engine`: those
// arms put the engine on `agent.ctx`. The two arms below hand the barrier the REAL adapter, so the
// engine can only be reached through the host's own door `agentPresets.serviceFor(agent, "compaction")`.

test("R1: the barrier compacts through the preset REALM door — agent.ctx serves no engine while agentPresets.serviceFor does", async () => {
  /** The harness modelling the REAL composition: the engine sits ONLY in the preset isolate realm. */
  const harness = makeHarness({ detached: true, engineDoors: "preset", answers: [{ shadowedTokenCount: 5 }] })
  // THE COMPOSITION, asserted rather than assumed: the member's own scope answers NOTHING for compaction.
  expect(harness.member.ctx?.get("compaction")).toBeUndefined()
  await stopListener(harness)({ agent: harness.member })
  // THE DOOR: the engine was reached through `agentPresets.serviceFor`, with THIS handle and that key.
  expect(harness.presetDoorCalls.length).toBeGreaterThan(0)
  expect(harness.presetDoorCalls[0].agent).toBe(harness.member)
  expect(harness.presetDoorCalls[0].key).toBe("compaction")
  // THE OUTCOME: compacted once with the member handle, then PROMOTED — never fenced as `no-engine`.
  expect(harness.engine.calls.length).toBe(1)
  expect(harness.engine.calls[0].agent).toBe(harness.member)
  expect(harness.directives.length).toBe(1)
  expect(harness.directives[0]).toContain("PROMOTED")
  expect(harness.reseeds.length).toBe(0)
  /** The persisted member row. */
  const stored = rawMember(harness)
  expect(String(stored.mode)).toBe("subcaptain")
  expect("fenced" in stored).toBe(false)
  expect(String(stored.fencedReason ?? "")).not.toContain("no-engine")
})

test("R1: with NO preset roster and no agent-scope engine the barrier keeps `no-engine` — never a fabricated engine", async () => {
  /** The harness with NEITHER engine door mounted. */
  const harness = makeHarness({ detached: true, engineDoors: "none", answers: [null] })
  await stopListener(harness)({ agent: harness.member })
  // NOTHING was driven: an absent engine is never invented, and no preset door was even offered.
  expect(harness.engine.calls.length).toBe(0)
  expect(harness.presetDoorCalls.length).toBe(0)
  /** The compaction journal row: the classification is still the ORIGINAL `no-engine`. */
  const row = journalRows(harness).find((entry) => entry.event === "compaction")
  expect(String(row?.reason)).toBe("no-engine")
  // The pre-existing reseed fallback still runs under the live parent, and the host never refuses it.
  expect(harness.reseeds.length).toBe(1)
  expect(harness.reseeds[0].parent).toBe(harness.parent)
})

// ── ROOT CAUSE 2: the reseed parent is proven against the registry ────────

test("R2: a parent the registry answers with a DIFFERENT instance is refused `reseed-parent-unavailable` with ZERO spawn calls", async () => {
  /** The harness whose engine has no safe range, so the reseed path runs. */
  const harness = makeHarness({ detached: true, answers: [null] })
  /** A registry whose identity lookup answers a FRESH handle for the parent — never the held instance. */
  const freshParent = (id: string): FakeAgent | undefined => (id === PARENT_SESSION ? { ...harness.parent } : harness.registry.get(id))
  // THE HOST'S CONDITION IS UNPROVABLE HERE: `get(parent.id) === parent` fails at call time.
  harness.adapter.liveAgentExact = freshParent
  await stopListener(harness)({ agent: harness.member })
  // ZERO SPAWN calls: the barrier refused BEFORE `startContinuableAgent`, so nothing was let throw. The
  // interrupt DOES fire (`interruptAgent` runs before the parent is resolved), so the claim this arm can
  // carry is the spawn count, not a total host-call count — and the interrupt is asserted, not assumed.
  expect(harness.reseeds.length).toBe(0)
  expect(harness.interrupts.length).toBe(1)
  /** The member row the refused barrier fenced. */
  const stored = rawMember(harness)
  expect(stored.fenced).toBe(true)
  expect(String(stored.fencedReason)).toContain("reseed-parent-unavailable")
  // The distinct reason REPLACES the host's sentence; the measured production string never appears.
  expect(String(stored.fencedReason)).not.toContain("UNAUTHORIZED")
})

test("R2: a parent only the LIST-SCAN seam knows is NOT forwarded — the identity seam answers nothing and the barrier refuses", async () => {
  /** The harness whose engine has no safe range, so the reseed path runs. */
  const harness = makeHarness({ detached: true, answers: [null] })
  // THE MEASURED ROOT CAUSE: `get` no longer holds either candidate while the LEGACY list-scan seam still
  // answers a stale handle for both. A `liveAgent`-based reseed would forward the stale captain, and the
  // host's identity check would throw the very UNAUTHORIZED sentence the journals carry.
  harness.registry.delete(PARENT_SESSION)
  harness.registry.delete(CAPTAIN_SESSION)
  /** The stale handle the legacy seam would offer as the parent. */
  const staleParent: FakeAgent = { id: PARENT_SESSION, session: { id: PARENT_SESSION, header: { cwd: harness.workspace } } }
  /** The stale handle the legacy seam would offer as the captain. */
  const staleCaptain: FakeAgent = { id: CAPTAIN_SESSION, session: { id: CAPTAIN_SESSION, header: { cwd: harness.workspace } } }
  /** The legacy seam's answer: handles the registry's own `get` does NOT return. */
  const legacyScan = (id: string): FakeAgent | undefined => (id === PARENT_SESSION ? staleParent : id === CAPTAIN_SESSION ? staleCaptain : undefined)
  harness.adapter.liveAgent = legacyScan
  await stopListener(harness)({ agent: harness.member })
  // NO child under a stale handle: the barrier answered `reseed-parent-unavailable` instead.
  expect(harness.reseeds.length).toBe(0)
  /** The member row the refused barrier fenced. */
  const stored = rawMember(harness)
  expect(stored.fenced).toBe(true)
  expect(String(stored.fencedReason)).toContain("reseed-parent-unavailable")
  expect(String(stored.fencedReason)).not.toContain("UNAUTHORIZED")
})

test("N1: the legacy `liveAgent` seam's stale parent is never used — `liveSessionOf` resolves through `liveAgentExact`", async () => {
  /** The harness whose engine has no safe range, whose parent session ended, and whose captain is live. */
  const harness = makeHarness({ detached: true, answers: [null], parentLive: false })
  /** The stale handle the legacy list-scan seam still offers for the parent session the registry dropped. */
  const staleParent: FakeAgent = { id: PARENT_SESSION, session: { id: PARENT_SESSION, header: { cwd: harness.workspace } } }
  /** The legacy seam: a stale parent handle for the dead session, the registry's own answer for every other id. */
  const legacyScan = (id: string): FakeAgent | undefined => (String(id ?? "") === PARENT_SESSION ? staleParent : harness.registry.get(String(id ?? "")))
  harness.adapter.liveAgent = legacyScan
  // THE TWO SEAMS DISAGREE, which is the pair only a `liveSessionOf` back on `liveAgent` would consume: the
  // legacy seam answers a stale parent for the id, while the identity seam answers NOTHING for it.
  expect((harness.adapter.liveAgent as (id: string) => FakeAgent | undefined)(PARENT_SESSION)).toBe(staleParent)
  expect((harness.adapter.liveAgentExact as (id: string) => FakeAgent | undefined)(PARENT_SESSION)).toBeUndefined()
  await stopListener(harness)({ agent: harness.member })
  // THE EXACT SEAM DECIDES: the stale parent is skipped, the LIVE captain becomes the parent, and a child is
  // raised. A `liveAgent`-based resolver would have taken `staleParent`, failed the identity proof and refused
  // with NO child — so this arm reddens the moment `liveSessionOf` goes back to the legacy seam.
  expect(harness.reseeds.length).toBe(1)
  expect(harness.reseeds[0].parent).toBe(harness.captain)
  /** The lineage row the reseed wrote. */
  const row = journalRows(harness).find((entry) => entry.event === "reseed-parent")
  expect(row?.parentSource).toBe("captain")
  expect(row?.originalParentSessionId).toBe(PARENT_SESSION)
})

test("R2: a parent the registry HOLDS is forwarded as that exact instance — the identity the host demands", async () => {
  /** The harness whose engine has no safe range, so the reseed path runs under the live parent. */
  const harness = makeHarness({ detached: true, answers: [null] })
  /** The adapter's own identity answer, read before the barrier runs. */
  const exact = harness.adapter.liveAgentExact as (id: string) => FakeAgent | undefined
  // THE PARENT THE HOST WILL COMPARE: the registry's own instance, not a copy.
  expect(exact(PARENT_SESSION)).toBe(harness.parent)
  await stopListener(harness)({ agent: harness.member })
  expect(harness.reseeds.length).toBe(1)
  // IDENTITY, not deep equality — this is the object `agents.get(parent.id)` answers.
  expect(harness.reseeds[0].parent).toBe(harness.parent)
  expect(harness.registry.get(PARENT_SESSION)).toBe(harness.parent)
  expect(String(rawMember(harness).mode)).toBe("subcaptain")
})
