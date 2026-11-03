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
  /** The session the workspace root and the parent link resolve from. */
  session: { id: string; header: { cwd: string; parentSession?: string } }
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
  /** Every reseed the barrier raised, with the parent object it handed the host. */
  reseeds: Array<{ parent: unknown; prompt: string }>
  /** Every interrupt the barrier issued (`targetSessionId`). */
  interrupts: string[]
  /** Every directive injected into the member. */
  directives: string[]
  /** The registered event handlers, by event name. */
  events: Map<string, (payload: unknown) => unknown>
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
  /** Whether the live-handle engine seam exists (false = an older mounted adapter). */
  liveEngineSeam?: boolean
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
  /** The member's original parent handle. */
  const parent: FakeAgent = { id: PARENT_SESSION, session: { id: PARENT_SESSION, header: { cwd: workspace } } }
  /** The stopping member's handle: still carrying its engine, even when the registry forgot it. */
  const member: FakeAgent = { id: MEMBER_SESSION, session: { id: MEMBER_SESSION, header: { cwd: workspace, parentSession: PARENT_SESSION } }, ctx: { get: (name: string): unknown => (name === "compaction" ? engine : undefined) } }
  /** The live-session registry, which is what the adapter's lookups actually consult. */
  const registry = new Map<string, FakeAgent>()
  if (options.captainLive !== false) registry.set(CAPTAIN_SESSION, captain)
  if (options.parentLive !== false) registry.set(PARENT_SESSION, parent)
  if (options.detached !== true) registry.set(MEMBER_SESSION, member)
  /** Every reseed the barrier raised. */
  const reseeds: Array<{ parent: unknown; prompt: string }> = []
  /** Every interrupt the barrier issued. */
  const interrupts: string[] = []
  /** Every directive injected into the member. */
  const directives: string[] = []
  /** The registered event handlers. */
  const events = new Map<string, (payload: unknown) => unknown>()
  /** The captured tool definitions. */
  const tools = new Map<string, CapturedTool>()
  /** The engine the registry-lookup seam answers with: the member's own, only while it is LIVE. */
  const registryEngine = (id: string): unknown => registry.get(String(id ?? ""))?.ctx?.get("compaction")
  /** The adapter double: the shape the host exposes, narrowed to what the barrier touches. */
  const adapter: Record<string, unknown> = {
    registerTool: (definition: CapturedTool): (() => void) => { tools.set(definition.name, definition); return (): void => {} },
    onAgentPreStep: (): undefined => undefined,
    onEvent: (name: string, handler: (payload: unknown) => unknown): (() => void) => { events.set(name, handler); return (): void => {} },
    workspaceRoot: (): string => workspace,
    contextPressure: (): Record<string, unknown> => ({ usedTokens: null, windowTokens: null, ratio: null, provenance: "no-window" }),
    liveAgent: (id: string): FakeAgent | undefined => registry.get(String(id ?? "")),
    compactionEngineForAgent: (id: string): unknown => registryEngine(id),
    userMessage: (value: unknown): unknown => value,
    injectAgentMessage: (_agent: unknown, message: unknown): void => { directives.push(String((message as { text?: unknown }).text ?? "")) },
    interruptAgent: (targetSessionId: string): void => { interrupts.push(targetSessionId) },
    startContinuableAgent: async (spec: unknown): Promise<unknown> => {
      /** The raised request, read structurally because the seam takes `unknown`. */
      const request = (spec as { request?: { parent?: FakeAgent; prompt?: string } } | undefined)?.request
      reseeds.push({ parent: request?.parent, prompt: String(request?.prompt ?? "") })
      // THE HOST'S OWN CONDITION, enforced by the double: a parent the registry no longer holds is
      // refused with the exact sentence the fences recorded.
      if (request?.parent === undefined || registry.get(request.parent.id) !== request.parent) {
        throw new Error("UNAUTHORIZED: subagent creation requires the exact live parent agent")
      }
      return { childId: "handle-fresh" }
    },
    executeTool: async (): Promise<Record<string, unknown>> => ({ ok: true, isError: false, value: {} }),
  }
  if (options.liveEngineSeam !== false) {
    adapter.compactionEngineForLiveAgent = (agent: unknown): unknown => (agent as FakeAgent | undefined)?.ctx?.get("compaction")
  }
  installCellworkProtocol({
    dsh: adapter as unknown as DshAdapter,
    ctx: { get: (): undefined => undefined },
    config: { ...DEFAULT_CELLWORK_CONFIG, compactionRetries: 1, idleBarrierDelayMs: 0, ...options.knobs },
    warn: (): void => {},
  })
  return { workspace, member, parent, captain, registry, engine, reseeds, interrupts, directives, events, adapter }
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

test("C1: no sleep happens before the FIRST attempt (the engine is driven immediately)", async () => {
  /** The harness whose retry delay is long enough that a pre-attempt sleep is measurable. */
  const harness = makeHarness({ detached: true, answers: [{ shadowedTokenCount: 5 }], knobs: { compactionRetries: 1, idleBarrierDelayMs: 1500 } })
  /** The instant the listener was handed the payload. */
  const startedAt = Date.now()
  await stopListener(harness)({ agent: harness.member })
  expect(harness.engine.calls.length).toBe(1)
  /** How long the FIRST drive took to happen. */
  const firstDriveAfterMs = harness.engine.calls[0].at - startedAt
  expect(firstDriveAfterMs).toBeLessThan(500)
})

test("C1: the registry lookup is the FALLBACK for a composition without the live-handle seam", async () => {
  /** The harness with an older adapter (no `compactionEngineForLiveAgent`) whose member is still live. */
  const harness = makeHarness({ detached: false, liveEngineSeam: false })
  await stopListener(harness)({ agent: harness.member })
  expect(harness.engine.calls.length).toBe(1)
  expect(harness.directives.length).toBe(1)
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
