// UNAMBIGUOUS MEMBER RESOLUTION ON `cellwork_send` (repair round 2, finding B).
//
// `nameKey` is ASCII-only: 后端1 and 前端1 both normalize to `1`, and a name with no ASCII letters or
// digits normalizes to `""`. A normalized-first lookup therefore picked the FIRST collision, so the
// captain addressing 前端1 could deliver to 后端1 (and `运维1`, which no member carries, resolved onto
// the same collision). These arms pin the ONE rule the verbs share — exact table key, then exact display
// name, then the normalized key only when it is NON-EMPTY and UNIQUE — plus the exact-name self guard,
// which must keep refusing a CJK seat that messages itself without confusing it for a colleague.
import { test, expect } from "bun:test"
import { mkdtempSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { DEFAULT_CELLWORK_CONFIG } from "../src/config.ts"
import { readCellMail, type CellMailRecord } from "../src/mail.ts"
import { installCellworkProtocol } from "../src/protocol.ts"
import { newCellState, writeCell, type CellMemberRecord } from "../src/state.ts"
import type { DshAdapter } from "../../mpd-dsh-adapter-plugin/src/index.ts"

/** The cell id every arm works in. */
const CELL_ID = "cell-20261104T160000000Z"

/** The captain's session id, which is what makes it the cell's Lead. */
const CAPTAIN_SESSION = "session-captain"

/** One fake live agent: its session id and the workspace header the readers resolve from. */
interface FakeAgent {
  /** The agent id (the session-id readers fall back to it). */
  id: string
  /** The session the workspace root resolves from. */
  session: { id: string; header: { cwd: string } }
}

/** One captured tool definition (the fake registry hands the runner back here). */
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
  /** The captain's handle. */
  captain: FakeAgent
  /** The members this cell seats, by their recorded display name. */
  members: Record<string, FakeAgent>
  /** Captured tool definitions by name. */
  tools: Map<string, CapturedTool>
}

/**
 * One member row as the CELL record stores it, already raised with a live handle.
 *
 * @param name - the member's board name.
 * @param sessionId - the session the member answers as.
 * @returns the row.
 */
function memberRow(name: string, sessionId: string): CellMemberRecord {
  return { name, role: name, sessionId, executorRef: "handle-" + name, mode: "member", handoffReady: false, handoffs: 0, joinedAt: "2026-11-04T00:00:00.000Z" }
}

/**
 * Build the fake harness and install the protocol tools once.
 *
 * The cell seats two names that BOTH normalize to `1` (the collision) beside an ASCII captain, which is
 * the shape that made the normalized-first lookup pick the wrong recipient.
 *
 * @returns the harness.
 */
function makeHarness(): Harness {
  /** The fresh temp workspace. */
  const workspace = mkdtempSync(join(tmpdir(), "mpd-cellwork-resolution-"))
  /** The cell record: a captain and the two colliding CJK seats. */
  const cell = {
    ...newCellState({ cellId: CELL_ID, objective: "resolve one member", captainSessionId: CAPTAIN_SESSION, now: new Date("2026-11-04T16:00:00.000Z") }),
    phase: "executing" as const,
    teamId: "team-resolution",
    members: { "后端1": memberRow("后端1", "session-be"), "前端1": memberRow("前端1", "session-fe") },
  }
  writeCell(workspace, cell)
  /** The captain's handle. */
  const captain: FakeAgent = { id: CAPTAIN_SESSION, session: { id: CAPTAIN_SESSION, header: { cwd: workspace } } }
  /** The two members' handles, keyed by the name the record seats them under. */
  const members: Record<string, FakeAgent> = {
    "后端1": { id: "session-be", session: { id: "session-be", header: { cwd: workspace } } },
    "前端1": { id: "session-fe", session: { id: "session-fe", header: { cwd: workspace } } },
  }
  /** Captured tool definitions. */
  const tools = new Map<string, CapturedTool>()
  /** The fake adapter: the registry, the root and the executor. */
  const adapter = {
    registerTool: (definition: CapturedTool): (() => void) => { tools.set(definition.name, definition); return (): void => {} },
    onAgentPreStep: (): undefined => undefined,
    onEvent: (): (() => void) => (): void => {},
    workspaceRoot: (): string => workspace,
    contextPressure: (): Record<string, unknown> => ({ usedTokens: null, windowTokens: null, ratio: null, provenance: "no-window" }),
    teamExecutor: (): Record<string, unknown> => ({ send: async (): Promise<void> => undefined }),
  }
  installCellworkProtocol({
    dsh: adapter as unknown as DshAdapter,
    ctx: { get: (): undefined => undefined },
    config: DEFAULT_CELLWORK_CONFIG,
    warn: (): void => {},
  })
  return { workspace, captain, members, tools }
}

/**
 * Run one captured tool as one agent.
 *
 * @param harness - the harness that captured it.
 * @param name - the tool name.
 * @param args - its arguments.
 * @param agent - the caller (the captain unless an arm says otherwise).
 * @returns the tool's structured answer.
 */
async function runTool(harness: Harness, name: string, args: Record<string, unknown>, agent?: FakeAgent): Promise<Record<string, unknown>> {
  /** The captured definition. */
  const tool = harness.tools.get(name)
  if (tool === undefined) throw new Error("no captured tool named " + name)
  /** The tool's answer, narrowed to a record. */
  const answer = await tool.execute(args, { name, agent: agent ?? harness.captain })
  return typeof answer === "object" && answer !== null ? answer as Record<string, unknown> : {}
}

/**
 * Every `send` row this cell's mail log holds, in append order.
 *
 * @param harness - the harness whose log is read.
 * @returns the send rows.
 */
function sendRows(harness: Harness): Array<Extract<CellMailRecord, { t: "send" }>> {
  return readCellMail(harness.workspace, CELL_ID).filter((row): row is Extract<CellMailRecord, { t: "send" }> => row.t === "send")
}

test("B: the EXACT CJK recipient wins over the first normalized collision", async () => {
  /** The harness whose two members share the normalized key `1`. */
  const harness = makeHarness()
  /** The captain's message to the SECOND of the two colliding names. */
  const answer = await runTool(harness, "cellwork_send", { to: "前端1", subject: "status?", body: "one line please" })
  expect(answer.ok).toBe(true)
  // THE RECIPIENT IS THE NAMED SEAT, not the first member whose key also normalizes to `1`.
  expect(sendRows(harness).map((row) => row.to)).toEqual(["前端1"])
})

test("B: an ambiguous normalized recipient is refused instead of delivered to the first collision", async () => {
  /** The harness whose two members share the normalized key `1`. */
  const harness = makeHarness()
  /** The captain's message to the bare key `1`, which names neither member exactly. */
  const answer = await runTool(harness, "cellwork_send", { to: "1", subject: "status?", body: "one line please" })
  expect(answer.ok).toBe(false)
  /** The refusal sentence, which names both candidates so the reader can pick one. */
  const error = String(answer.error)
  expect(error).toContain("unambiguous")
  expect(error).toContain("后端1")
  expect(error).toContain("前端1")
  // NOTHING WAS WRITTEN: an unknown name is refused before the durable send.
  expect(sendRows(harness)).toHaveLength(0)
})

test("B: `运维1`, which no member carries, is refused rather than resolved onto the collision", async () => {
  /** The harness whose two members share the normalized key `1`. */
  const harness = makeHarness()
  /** The captain's message to an absent name that normalizes onto `1`. */
  const answer = await runTool(harness, "cellwork_send", { to: "运维1", subject: "status?", body: "one line please" })
  expect(answer.ok).toBe(false)
  expect(String(answer.error)).toContain("\"运维1\"")
  expect(sendRows(harness)).toHaveLength(0)
})

test("B: a CJK seat messaging ITSELF is still refused, by exact name", async () => {
  /** The harness whose two members share the normalized key `1`. */
  const harness = makeHarness()
  /** The colliding member's own message to its own name. */
  const answer = await runTool(harness, "cellwork_send", { to: "前端1", subject: "note", body: "to myself" }, harness.members["前端1"])
  expect(answer.ok).toBe(false)
  expect(String(answer.error)).toContain("a seat cannot message itself")
  expect(sendRows(harness)).toHaveLength(0)
})
