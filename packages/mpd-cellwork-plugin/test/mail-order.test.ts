// Offline tests for the DURABLE-FIRST mail order (contract D6).
//
// The defect was an ORDER defect inside `cellwork_send`: the recipient's wake-up was handed to the
// executor BEFORE the durable mail row was appended, while the tool's own description and the module
// header both promised the reverse. A failed append could therefore leave a delivered wake for a row
// that never landed — invisible to every reader, because the log is the only record.
//
// These arms pin the order at the only place it can be observed: the executor sees the wake-up, so the
// fake executor reads the mail log at that instant and reports what was already on disk. The refusal arm
// (a mail log that cannot be appended to) is the red-before-fix case — under the old order the wake went
// out first and this assertion failed.
import { test, expect } from "bun:test"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { cellMailPath, deliverCellMail, foldCellMail, readCellMail, wakeFailures, type CellMailRecord } from "../src/mail.ts"
import { newCellState, writeCell, type CellMemberRecord } from "../src/state.ts"
import { installCellworkProtocol } from "../src/protocol.ts"
import { DEFAULT_CELLWORK_CONFIG } from "../src/config.ts"
import type { DshAdapter } from "../../mpd-dsh-adapter-plugin/src/index.ts"

/** The cell id every arm works in. */
const CELL_ID = "cell-20261031T120000000Z"

/** The captain's session id, which is what grants it the Lead authority a wake-up needs. */
const CAPTAIN_SESSION = "session-captain"

/** One fake live agent. */
interface FakeAgent {
  /** The agent id (the session-id readers fall back to it). */
  id: string
  /** The session the workspace root would resolve from. */
  session: { id: string; header: { cwd: string } }
}

/** What the fake executor saw on disk at the moment it was asked to wake a member. */
interface WakeObservation {
  /** How many `send` rows the log held. */
  sends: number
  /** How many `wake` rows the log held. */
  wakes: number
  /** The ids of the `send` rows present. */
  ids: string[]
}

/** The fake harness one arm drives. */
interface Harness {
  /** The temp workspace every root resolves to. */
  workspace: string
  /** The captain's handle. */
  captain: FakeAgent
  /** Captured tool definitions by name. */
  tools: Map<string, { name: string; execute: (args: unknown, exec: unknown) => Promise<unknown> }>
  /** Every message the team executor accepted. */
  sends: Array<{ handle: string; text: string }>
  /** Runs inside the executor, BEFORE it accepts the wake-up. */
  beforeSend?: () => void
  /** When true the executor throws, which is a FAILED wake-up rather than a lost row. */
  failWake: boolean
}

/**
 * One member row as the CELL record stores it.
 *
 * @param name - the member's board name.
 * @returns the row, already raised with a live handle.
 */
function memberRow(name: string): CellMemberRecord {
  return { name, role: name, sessionId: "session-" + name, executorRef: "handle-" + name, mode: "member", handoffReady: false, handoffs: 0, joinedAt: "2026-10-31T00:00:00.000Z" }
}

/**
 * Build the fake harness and install the protocol tools once.
 *
 * @param mailAsDirectory - create `mail.jsonl` as a DIRECTORY, so every append to it fails (EISDIR).
 * @returns the harness.
 */
function makeHarness(mailAsDirectory: boolean = false): Harness {
  /** The fresh temp workspace. */
  const workspace = mkdtempSync(join(tmpdir(), "mpd-cellwork-mail-"))
  /** The cell record, with one member that holds a live handle. */
  const cell = { ...newCellState({ cellId: CELL_ID, objective: "ship the widget", captainSessionId: CAPTAIN_SESSION, now: new Date("2026-10-31T12:00:00.000Z") }), phase: "executing" as const, teamId: "team-mail", members: { "cell-planner": memberRow("cell-planner") } }
  writeCell(workspace, cell)
  if (mailAsDirectory) {
    mkdirSync(cellMailPath(workspace, CELL_ID), { recursive: true })
  }
  /** The captain's handle. */
  const captain: FakeAgent = { id: CAPTAIN_SESSION, session: { id: CAPTAIN_SESSION, header: { cwd: workspace } } }
  /** Captured tool definitions. */
  const tools = new Map<string, { name: string; execute: (args: unknown, exec: unknown) => Promise<unknown> }>()
  /** The harness under construction, so the fake executor can read its own flags at call time. */
  const harness: Harness = { workspace, captain, tools, sends: [], failWake: false }
  /** The fake adapter: the registry, the root, the meter and the executor. */
  const adapter = {
    registerTool: (definition: { name: string; execute: (args: unknown, exec: unknown) => Promise<unknown> }): (() => void) => { tools.set(definition.name, definition); return (): void => {} },
    onAgentPreStep: (): undefined => undefined,
    onEvent: (): (() => void) => (): void => {},
    workspaceRoot: (): string => workspace,
    contextPressure: (): Record<string, unknown> => ({ usedTokens: null, windowTokens: null, ratio: null, provenance: "no-window" }),
    teamExecutor: (): Record<string, unknown> => ({
      send: async (_captain: unknown, handle: string, text: string): Promise<void> => {
        harness.beforeSend?.()
        if (harness.failWake) throw new Error("the transport refused the wake-up")
        harness.sends.push({ handle, text })
      },
    }),
  }
  installCellworkProtocol({
    dsh: adapter as unknown as DshAdapter,
    ctx: { get: (): undefined => undefined },
    config: DEFAULT_CELLWORK_CONFIG,
    warn: (): void => {},
  })
  return harness
}

/**
 * Run one captured tool.
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

/**
 * Every raw record in the harness's mail log, in append order.
 *
 * @param harness - the harness whose log is read.
 * @returns the parsed rows; an unreadable log answers an empty list.
 */
function logRows(harness: Harness): CellMailRecord[] {
  /** The raw log text. */
  let text = ""
  try {
    text = readFileSync(cellMailPath(harness.workspace, CELL_ID), "utf8")
  } catch {
    return []
  }
  return text.split("\n").filter((line) => line.trim() !== "").map((line) => JSON.parse(line) as CellMailRecord)
}

// ── the ordering contract ─────────────────────────────────────────────────

test("D6: the durable row lands BEFORE the wake-up, and the `wake` record reports the attempt", async () => {
  /** The harness whose executor observes the log at wake time. */
  const harness = makeHarness()
  /** What the executor saw when it was asked to wake the member. */
  let observed: WakeObservation | undefined
  harness.beforeSend = (): void => {
    /** The rows present at that instant. */
    const atWake = logRows(harness)
    observed = { sends: atWake.filter((row) => row.t === "send").length, wakes: atWake.filter((row) => row.t === "wake").length, ids: atWake.filter((row) => row.t === "send").map((row) => String(row.id)) }
  }
  /** The captain's message to the member. */
  const sent = await runTool(harness, "cellwork_send", { to: "cell-planner", subject: "status?", body: "one line please" })
  expect(sent.ok).toBe(true)
  expect(sent.wakeSent).toBe(true)
  expect(harness.sends.length).toBe(1)
  // THE ORDER: exactly the durable row was on disk, and NO wake record had been written yet.
  expect(observed).toBeDefined()
  expect(observed?.sends).toBe(1)
  expect(observed?.wakes).toBe(0)
  expect(observed?.ids).toEqual([String(sent.id)])
  // After the call: the row, then the attempt's outcome, both naming one id.
  /** The raw log after the call. */
  const rows = logRows(harness)
  expect(rows.map((row) => row.t)).toEqual(["send", "wake"])
  /** The wake record. */
  const wake = rows[1]
  expect(wake.t).toBe("wake")
  if (wake.t === "wake") {
    expect(wake.id).toBe(String(sent.id))
    expect(wake.sent).toBe(true)
    expect(wake.reason).toBeUndefined()
  }
  // Folding applies the attempt to the message, so `cellwork_supervise` sees the truth.
  /** The folded message. */
  const folded = foldCellMail(readCellMail(harness.workspace, CELL_ID))
  expect(folded.length).toBe(1)
  expect(folded[0].wakeSent).toBe(true)
  expect(wakeFailures(folded).length).toBe(0)
  // The `send` row itself claims nothing about the wake-up: it was written before the attempt existed.
  expect(folded[0].wakeReason).toBeUndefined()
})

test("D6: a durable row that cannot be written ends the call and NO wake-up is attempted", async () => {
  // The red-before-fix arm: under the old order the wake went out first and this could never hold.
  /** The harness whose `mail.jsonl` is a directory, so every append fails. */
  const harness = makeHarness(true)
  /** The captain's message. */
  const refused = await runTool(harness, "cellwork_send", { to: "cell-planner", subject: "status?", body: "one line please" })
  expect(refused.ok).toBe(false)
  expect(String(refused.error)).toContain("no message was sent and no wake-up was attempted")
  expect(harness.sends.length).toBe(0)
})

test("D6: a FAILED wake-up never costs the row, and the attempt is reported as undelivered", async () => {
  /** The harness whose transport throws. */
  const harness = makeHarness()
  harness.failWake = true
  /** The captain's message. */
  const sent = await runTool(harness, "cellwork_send", { to: "cell-planner", subject: "status?", body: "one line please" })
  expect(sent.ok).toBe(true)
  expect(sent.wakeSent).toBe(false)
  expect(String(sent.wakeReason)).toContain("the transport refused the wake-up")
  // The row is durable, and the attempt's failure is its own record.
  /** The raw log after the call. */
  const rows = logRows(harness)
  expect(rows.map((row) => row.t)).toEqual(["send", "wake"])
  /** The folded message. */
  const folded = foldCellMail(rows)
  expect(folded.length).toBe(1)
  expect(folded[0].wakeSent).toBe(false)
  expect(String(folded[0].wakeReason)).toContain("the transport refused the wake-up")
  // `cellwork_supervise`'s surface: an unread, unwoken row is exactly what it must show.
  expect(wakeFailures(folded).map((message) => message.id)).toEqual([String(sent.id)])
})

test("N1: a `wake` record that cannot be written is NOT reported as a sent wake, and the log stays truthful", async () => {
  // The repair's arm: the `send` row lands, the transport ACCEPTS the wake, and only the `wake` record's
  // append fails (the log is made read-only inside the executor, so the failure is the SECOND append).
  /** The harness whose mail log becomes unwritable exactly while the attempt is in flight. */
  const harness = makeHarness()
  /** The mail log path, made read-only inside the executor so ONLY the wake record's append fails. */
  const mailPath = cellMailPath(harness.workspace, CELL_ID)
  harness.beforeSend = (): void => { chmodSync(mailPath, 0o444) }
  /** The captain's message. */
  const answer = await runTool(harness, "cellwork_send", { to: "cell-planner", subject: "status?", body: "one line please" })
  // The transport WAS called exactly once: this is the RECORD-of-it failure, not a transport failure.
  expect(harness.sends.length).toBe(1)
  // THE ANSWER AGREES WITH THE LOG: not sent, and the reason names the failed RECORD append.
  expect(answer.ok).toBe(true)
  expect(answer.wakeSent).toBe(false)
  expect(String(answer.wakeReason)).toContain("`wake` record could not be written")
  expect(String(answer.wakeReason)).toContain("the transport accepted it")
  // The durable row is present, and a re-read fold reports it as undelivered — exactly what the log holds.
  /** The raw log, which holds the send row and NO wake row. */
  const rows = logRows(harness)
  expect(rows.map((row) => row.t)).toEqual(["send"])
  /** The folded log the supervisor reads. */
  const folded = foldCellMail(readCellMail(harness.workspace, CELL_ID))
  expect(folded.length).toBe(1)
  expect(folded[0].id).toBe(String(answer.id))
  expect(folded[0].wakeSent).toBe(false)
  expect(wakeFailures(folded).map((message) => message.id)).toEqual([String(answer.id)])
})

// ── the delivery seam itself ──────────────────────────────────────────────

test("D6: deliverCellMail calls the durable append first, and a refusal skips the attempt entirely", async () => {
  /** The call order the seam produced. */
  const order: string[] = []
  /** The delivery of a row that never lands. */
  const lost = await deliverCellMail({
    appendSend: (): boolean => { order.push("append"); return false },
    attemptWake: async (): Promise<{ sent: boolean }> => { order.push("wake"); return { sent: true } },
    appendWake: (): boolean => { order.push("wake-record"); return true },
  })
  expect(order).toEqual(["append"])
  expect(lost.landed).toBe(false)
  expect(lost.wakeSent).toBe(false)
  expect(String(lost.wakeReason)).toContain("no wake-up was attempted")
})

test("D6: deliverCellMail classifies a THROWN wake-up as a failed attempt, never as a lost row", async () => {
  /** The order the seam produced. */
  const order: string[] = []
  /** The outcome the seam recorded. */
  let recorded: { sent: boolean; reason?: string } | undefined
  /** The delivery of a row that lands and whose wake-up throws. */
  const delivery = await deliverCellMail({
    appendSend: (): boolean => { order.push("append"); return true },
    attemptWake: async (): Promise<{ sent: boolean }> => { order.push("wake"); throw new Error("boom") },
    appendWake: (outcome: { sent: boolean; reason?: string }): boolean => { order.push("wake-record"); recorded = outcome; return true },
  })
  expect(order).toEqual(["append", "wake", "wake-record"])
  expect(delivery.landed).toBe(true)
  expect(delivery.wakeSent).toBe(false)
  expect(String(delivery.wakeReason)).toContain("boom")
  expect(recorded?.sent).toBe(false)
  expect(String(recorded?.reason)).toContain("boom")
})

test("N1: deliverCellMail reports NOT sent when the `wake` record cannot be appended", async () => {
  /** The call order the seam produced. */
  const order: string[] = []
  /** The delivery of a row whose wake the transport accepted and whose record was lost. */
  const delivery = await deliverCellMail({
    appendSend: (): boolean => { order.push("append"); return true },
    attemptWake: async (): Promise<{ sent: boolean }> => { order.push("wake"); return { sent: true } },
    appendWake: (): boolean => { order.push("wake-record"); return false },
  })
  expect(order).toEqual(["append", "wake", "wake-record"])
  expect(delivery.landed).toBe(true)
  expect(delivery.wakeSent).toBe(false)
  expect(String(delivery.wakeReason)).toContain("`wake` record could not be written")
})

// ── folding a log an older build or a crash left behind ───────────────────

test("D6: folding tolerates a torn line, a wake record with no send, and a later successful attempt", () => {
  /** A log with a torn line, an orphan wake row, and a retried attempt. */
  const text = [
    JSON.stringify({ t: "send", id: "m1", cellId: CELL_ID, from: "captain", to: "cell-planner", subject: "s", body: "b", at: "2026-10-31T12:00:00.000Z", wakeSent: false }),
    JSON.stringify({ t: "wake", id: "m1", sent: false, reason: "the transport refused", at: "2026-10-31T12:00:01.000Z" }),
    "{\"t\":\"send\",\"id\":\"tor",
    JSON.stringify({ t: "wake", id: "ghost", sent: true, at: "2026-10-31T12:00:02.000Z" }),
    JSON.stringify({ t: "wake", id: "m1", sent: true, at: "2026-10-31T12:00:03.000Z" }),
  ].join("\n") + "\n"
  /** The temporary workspace the log is written into. */
  const workspace = mkdtempSync(join(tmpdir(), "mpd-cellwork-mail-fold-"))
  /** The log file the text is read back from. */
  const logPath = cellMailPath(workspace, CELL_ID)
  mkdirSync(join(workspace, ".mpd", "cellwork", CELL_ID), { recursive: true })
  writeFileSync(logPath, text, "utf8")
  /** The folded message. */
  const folded = foldCellMail(readCellMail(workspace, CELL_ID))
  expect(folded.length).toBe(1)
  expect(folded[0].id).toBe("m1")
  expect(folded[0].wakeSent).toBe(true)
  expect(folded[0].wakeReason).toBeUndefined()
})
