// CELLWORK MAIL — the undelivered bound is CONFIGURABLE and read per call (C3, lane A's half).
//
// WHY THIS FILE EXISTS (VEdit P0): `cellwork_send` refused once a recipient already had 8 undelivered
// messages, and that number was a bare `?? 8` inside the shared store with no config key and no
// disclosure. The VEdit cells hit it repeatedly (handover §7). The bound now comes from
// `mail.maxUndelivered` in the workspace config, read per call, and the DEFAULT stays 8.
//
// LANE BOUNDARY: the shared store's own refusal sentence and the team-core call site belong to lane B.
// This file proves what lane A owns — the cellwork call site PASSES the configured bound through.
import { test, expect } from "bun:test"
import { mkdtempSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { newCellState, writeCell, type CellMemberRecord } from "../src/state.ts"
import { installCellworkProtocol } from "../src/protocol.ts"
import { DEFAULT_CELLWORK_CONFIG } from "../src/config.ts"
import type { DshAdapter } from "../../mpd-dsh-adapter-plugin/src/index.ts"

/** The cell id every arm works in. */
const CELL_ID = "cell-20261103T010000000Z"

/** The team id the cell record names. */
const TEAM_ID = "team-mail-bound"

/** The captain's session id. */
const CAPTAIN_SESSION = "session-captain"

/** The member the messages are addressed to. */
const MEMBER_NAME = "cell-planner"

/** One fake live agent. */
interface FakeAgent {
  /** The shared session id. */
  id: string
  /** The session the workspace root resolves from. */
  session: { id: string; header: { cwd: string } }
}

/** One captured tool definition (the fields these arms read). */
interface CapturedTool {
  /** The registered name. */
  name: string
  /** The tool description, which must DISCLOSE the bound. */
  description?: string
  /** The runner. */
  execute: (args: unknown, exec: unknown) => Promise<unknown>
}

/** The fake harness one arm drives. */
interface Harness {
  /** The temp workspace. */
  workspace: string
  /** The captain's handle. */
  captain: FakeAgent
  /** The captured tool definitions, by name. */
  tools: Map<string, CapturedTool>
}

/**
 * One member row as the cell record stores it.
 *
 * @returns the row.
 */
function memberRow(): CellMemberRecord {
  return {
    name: MEMBER_NAME,
    role: "Planner",
    sessionId: "session-" + MEMBER_NAME,
    executorRef: "handle-" + MEMBER_NAME,
    mode: "member",
    handoffReady: false,
    handoffs: 0,
    joinedAt: "2026-11-03T00:00:00.000Z",
  }
}

/**
 * Build the harness: a temp workspace with one started cell and the protocol tools installed once.
 *
 * @param declaredBound - the value `mail.maxUndelivered` declares, or undefined to leave the key absent.
 * @returns the harness.
 */
function makeHarness(declaredBound: number | undefined): Harness {
  /** The fresh temp workspace. */
  const workspace = mkdtempSync(join(tmpdir(), "mpd-cellwork-mail-bound-"))
  /** The cell record, persisted so the tools read it back like a real cell. */
  const base = newCellState({ cellId: CELL_ID, objective: "ship the widget", captainSessionId: CAPTAIN_SESSION, now: new Date("2026-11-03T00:00:00.000Z") })
  writeCell(workspace, { ...base, phase: "executing", teamId: TEAM_ID, members: { [MEMBER_NAME]: memberRow() } })
  /** The captain's handle. */
  const captain: FakeAgent = { id: CAPTAIN_SESSION, session: { id: CAPTAIN_SESSION, header: { cwd: workspace } } }
  /** The captured tool definitions. */
  const tools = new Map<string, CapturedTool>()
  /** The factory's tool registration. */
  const adapter = {
    registerTool: (definition: CapturedTool): (() => void) => { tools.set(definition.name, definition); return (): void => {} },
    onAgentPreStep: (): undefined => undefined,
    onEvent: (): (() => void) => (): void => {},
    workspaceRoot: (): string => workspace,
    contextPressure: (): Record<string, unknown> => ({ usedTokens: null, windowTokens: null, ratio: null, provenance: "no-window" }),
    compactionEngineForAgent: (): undefined => undefined,
    interruptAgent: (): void => {},
    startContinuableAgent: async (): Promise<never> => { throw new Error("no reseed in this arm") },
    userMessage: (value: unknown): unknown => value,
    injectAgentMessage: (): void => {},
    executeTool: async (): Promise<Record<string, unknown>> => ({ ok: true, isError: false, value: {} }),
  }
  installCellworkProtocol({
    dsh: adapter as unknown as DshAdapter,
    ctx: {
      // THE CONFIG LAYER THE ROW ACTUALLY READS: `mpdConfig.get(<dotted key>)`.
      get: (name: string): unknown => name === "mpdConfig"
        ? { get: (key: string): unknown => (key === "mail.maxUndelivered" ? declaredBound : undefined) }
        : undefined,
    },
    config: { ...DEFAULT_CELLWORK_CONFIG, compactionRetries: 1, idleBarrierDelayMs: 0 },
    warn: (): void => {},
  })
  return { workspace, captain, tools }
}

/**
 * Run one captured tool as the captain.
 *
 * @param harness - the harness that captured it.
 * @param name - the tool name.
 * @param args - its arguments.
 * @returns the tool's structured answer.
 */
async function runTool(harness: Harness, name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  /** The captured definition. */
  const tool = harness.tools.get(name)
  if (tool === undefined) throw new Error("no captured tool named " + name)
  /** The tool's answer, narrowed to a record. */
  const answer = await tool.execute(args, { name, agent: harness.captain })
  return typeof answer === "object" && answer !== null ? answer as Record<string, unknown> : {}
}

test("C3: `mail.maxUndelivered` reaches the shared store's bound (a configured 1 refuses the second row)", async () => {
  /** The harness whose config declares a bound of 1. */
  const harness = makeHarness(1)
  /** The first message: one undelivered row, which is the bound itself. */
  const first = await runTool(harness, "cellwork_send", { to: MEMBER_NAME, subject: "one", body: "first" })
  expect(first.ok).toBe(true)
  /** The second message: over the configured bound. */
  const second = await runTool(harness, "cellwork_send", { to: MEMBER_NAME, subject: "two", body: "second" })
  expect(second.ok).toBe(false)
  // The refusal names the RECIPIENT and the bound it enforced (the sentence's wording is the shared
  // store's, which is lane B's surface; this arm asserts only what lane A's call site controls).
  expect(String(second.error)).toContain(MEMBER_NAME)
  expect(String(second.error)).toContain("1")
})

test("C3 control: an ABSENT config key keeps the documented default of 8", async () => {
  /** The harness with no `mail.maxUndelivered` declared. */
  const harness = makeHarness(undefined)
  for (let index = 1; index <= 8; index += 1) {
    /** The index-th send, all of which fit inside the default bound. */
    const sent = await runTool(harness, "cellwork_send", { to: MEMBER_NAME, subject: "s" + String(index), body: "b" + String(index) })
    expect(sent.ok).toBe(true)
  }
  /** The ninth row, which the default bound refuses. */
  const ninth = await runTool(harness, "cellwork_send", { to: MEMBER_NAME, subject: "s9", body: "b9" })
  expect(ninth.ok).toBe(false)
  expect(String(ninth.error)).toContain("8")
})

test("C3: a declared 0 DISABLES the bound, the same reading the shared store documents", async () => {
  /** The harness whose config declares a bound of 0. */
  const harness = makeHarness(0)
  // 0 is honoured, not replaced by the default: the resolver the store exports decides, and this call
  // site passes its answer through untouched. Past 8 the default would have refused.
  for (let index = 1; index <= 10; index += 1) {
    /** The index-th send, none of which may be refused by a disabled bound. */
    const sent = await runTool(harness, "cellwork_send", { to: MEMBER_NAME, subject: "d" + String(index), body: "b" + String(index) })
    expect(sent.ok).toBe(true)
  }
})

test("C3: the cellwork_send description DISCLOSES the bound, the config key and both recovery paths", () => {
  /** The harness whose captured description is under test. */
  const harness = makeHarness(undefined)
  /** The tool's description, which is the only place a model learns the bound exists. */
  const description = String(harness.tools.get("cellwork_send")?.description ?? "")
  expect(description).toContain("mail.maxUndelivered")
  expect(description).toContain("8")
  // The bound is SHARED with the official mail tool, so nobody is told to fall back to it.
  expect(description).toContain("agent_teams_mail")
  // Both recovery paths are named.
  expect(description).toContain("cellwork_inbox")
  expect(description).toContain("reassign")
})
