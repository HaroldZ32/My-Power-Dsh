// R1's OWN probe for lanes A and C (T6). It drives the REAL exported functions of
// `packages/mpd-cellwork-plugin/src` — never the lanes' test files — and asserts the frozen contract
// items one arm at a time. Temp workspaces are `mkdtemp` only (§7 R9: nothing runnable in the checkout).
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  applyReassignments,
  dispatchOwnerOnly,
  fenceReasonOf,
  type DispatchRecordView,
} from "../../../../packages/mpd-cellwork-plugin/src/dispatch.ts"
import {
  appendCellMail,
  cellMailPath,
  deliverCellMail,
  foldCellMail,
  readCellMail,
} from "../../../../packages/mpd-cellwork-plugin/src/mail.ts"
import {
  findSplitTicket,
  resolveSplitTicket,
  SPLIT_TICKET_REPAIR,
  type SplitTicketRow,
} from "../../../../packages/mpd-cellwork-plugin/src/staging.ts"
import {
  materializeSplit,
  resolvedMemberName,
  type ActivateProgress,
} from "../../../../packages/mpd-cellwork-plugin/src/activate.ts"
import {
  journalPath,
  newCellState,
  readCell,
  writeCell,
  type CellMemberRecord,
  type CellState,
} from "../../../../packages/mpd-cellwork-plugin/src/state.ts"
import type { SplitTaskVerdict, SplitVerdict } from "../../../../packages/mpd-cellwork-plugin/src/split.ts"
import type { CellworkConfig } from "../../../../packages/mpd-cellwork-plugin/src/config.ts"

/** The clock every fixture stamps, so ids and journals are deterministic. */
const NOW = new Date("2026-10-31T06:00:00.000Z")

/** Results of every arm; the exit code reports how many contract items failed. */
const failures: string[] = []

/** Record one arm's outcome and print it. */
function arm(id: string, ok: boolean, detail: string): void {
  if (!ok) failures.push(id)
  console.log(`${ok ? "PASS" : "FAIL"} ${id} — ${detail}`)
}

/** A fresh temp workspace. */
const sandbox = (): string => mkdtempSync(join(tmpdir(), "r1-ac-"))

/** The journal lines of one cell, parsed. */
function journalRows(workspace: string, cellId: string): Array<Record<string, unknown>> {
  try {
    return readFileSync(journalPath(workspace, cellId), "utf8").split("\n").filter((line) => line.trim() !== "").map((line) => JSON.parse(line) as Record<string, unknown>)
  } catch {
    return []
  }
}

/** One cell member row. */
const member = (name: string, over: Partial<CellMemberRecord> = {}): CellMemberRecord => ({
  name, role: "Senior Engineer", sessionId: "h-" + name, executorRef: "h-" + name,
  mode: "member", handoffReady: false, handoffs: 0, joinedAt: NOW.toISOString(), ...over,
})

/** A cell record in the split phase. */
const makeCell = (over: Partial<CellState> = {}): CellState => ({
  ...newCellState({ cellId: "cell-20261031T060000000Z-probe", objective: "probe the contract", captainSessionId: "cap-1", now: NOW }),
  phase: "split", teamId: "team-1", requirementsRevision: 1, splitRevision: 1, ...over,
})

// ══ A. C7 — three fence signals; a fenced owner is skipped, named, and left pending ═══════════════
{
  const workspace = sandbox()
  const cell = makeCell({ members: {
    Checkpoint: member("Checkpoint", { mode: "checkpoint" }),
    HandoffReady: member("HandoffReady", { handoffReady: true }),
    FencedFlag: member("FencedFlag", { fenced: true, fencedReason: "no-engine; the reseed failed" }),
    Healthy: member("Healthy"),
  } })
  /** The board: one ready row per member, plus a record-level fenced member (cell record empty). */
  const record = {
    teamId: "team-1",
    members: [
      { id: "M1", name: "Checkpoint", executorRef: "h-Checkpoint", status: "running" },
      { id: "M2", name: "HandoffReady", executorRef: "h-HandoffReady", status: "running" },
      { id: "M3", name: "FencedFlag", executorRef: "h-FencedFlag", status: "running" },
      { id: "M4", name: "Healthy", executorRef: "h-Healthy", status: "running" },
      { id: "M5", name: "RecordFenced", executorRef: "h-RecordFenced", status: "running", fenced: true },
    ],
    tasks: [
      { id: "T1", subject: "a", status: "pending", owner: "Checkpoint", blockedBy: [] },
      { id: "T2", subject: "b", status: "pending", owner: "HandoffReady", blockedBy: [] },
      { id: "T3", subject: "c", status: "pending", owner: "FencedFlag", blockedBy: [] },
      { id: "T4", subject: "d", status: "pending", owner: "Healthy", blockedBy: [] },
      { id: "T5", subject: "e", status: "pending", owner: "RecordFenced", blockedBy: [] },
    ],
  } as unknown as DispatchRecordView
  /** The messages the pass actually sent. */
  const sent: string[] = []
  const report = await dispatchOwnerOnly({ workspace, cell, record, send: async (handle) => { sent.push(handle) }, now: NOW })
  arm("A1 three cell signals fence (mode/handoffReady/fenced)", fenceReasonOf(cell.members.Checkpoint) !== undefined && fenceReasonOf(cell.members.HandoffReady) !== undefined && fenceReasonOf(cell.members.FencedFlag) !== undefined, `checkpoint=${String(fenceReasonOf(cell.members.Checkpoint))} | handoff=${String(fenceReasonOf(cell.members.HandoffReady))} | flag=${String(fenceReasonOf(cell.members.FencedFlag))}`)
  arm("A2 a record-level fenced row fences too", fenceReasonOf(record.members.find((row) => row.name === "RecordFenced")) !== undefined, `reason=${String(fenceReasonOf(record.members.find((row) => row.name === "RecordFenced")))}`)
  arm("A3 a fenced owner is never messaged", sent.length === 1 && sent[0] === "h-Healthy", `sent=${JSON.stringify(sent)}`)
  /** The skipped rows, by task id. */
  const skipped = new Map(report.skipped.map((row) => [row.taskId, row.reason]))
  arm("A4 every fenced row is REPORTED with the member and the reassign repair", ["T1", "T2", "T3", "T5"].every((id) => { const reason = skipped.get(id) ?? ""; return reason.includes("FENCED") && reason.includes("reassign") }), `reasons=${JSON.stringify(["T1", "T2", "T3", "T5"].map((id) => skipped.get(id)))}`)
  arm("A5 the ready non-fenced row is paired", report.pairs.length === 1 && report.pairs[0].taskId === "T4" && report.pairs[0].memberName === "Healthy", `pairs=${JSON.stringify(report.pairs.map((p) => p.taskId + ":" + p.memberName))}`)
  rmSync(workspace, { recursive: true, force: true })
}

// ══ B. C6 — reassign: claim BEFORE message, journaled; failures reported, never thrown ═════════════
{
  const workspace = sandbox()
  const cell = makeCell()
  const record = {
    teamId: "team-1",
    members: [
      { id: "M1", name: "Target", executorRef: "h-Target", status: "running" },
      { id: "M2", name: "Fenced", executorRef: "h-Fenced", status: "running", fenced: true, fencedReason: "no-engine" },
      { id: "M3", name: "Flaky", executorRef: "h-Flaky", status: "running" },
    ],
    tasks: [
      { id: "T1", subject: "a", status: "pending", owner: "Old" },
      { id: "T2", subject: "b", status: "pending", owner: "Old" },
      { id: "T3", subject: "c", status: "pending", owner: "Old" },
      { id: "T4", subject: "d", status: "completed", owner: "Old" },
      { id: "T5", subject: "e", status: "pending", owner: "Old" },
      { id: "T6", subject: "f", status: "pending", owner: "Old" },
      { id: "T7", subject: "g", status: "pending", owner: "Old" },
    ],
  } as unknown as DispatchRecordView
  /** The ordered side effects, so the claim-before-send order is observable. */
  const order: string[] = []
  const outcomes = await applyReassignments({
    workspace, cell, record,
    pairs: [
      { taskId: "T1", owner: "Target" },
      { taskId: "T2", owner: "Fenced" },
      { taskId: "T4", owner: "Target" },
      { taskId: "T5", owner: "Ghost" },
      { taskId: "T6", owner: "Flaky" },
      { taskId: "T7", owner: "Target" },
    ],
    claim: async (taskId) => { order.push("claim:" + taskId); return taskId === "T6" ? { ok: false, error: "the board refused" } : { ok: true } },
    send: async () => { order.push("send"); if (order.filter((entry) => entry === "send").length === 2) throw new Error("transport down") },
    now: NOW,
  })
  /** The outcome by task id. */
  const byTask = new Map(outcomes.map((row) => [row.taskId, row]))
  arm("B1 the successful pair is claimed THEN delivered", byTask.get("T1")?.claimed === true && byTask.get("T1")?.delivered === true, `T1=${JSON.stringify(byTask.get("T1"))}`)
  arm("B2 a FENCED target is refused before any claim", byTask.get("T2")?.claimed === false && String(byTask.get("T2")?.reason).includes("FENCED") && !order.includes("claim:T2"), `T2=${JSON.stringify(byTask.get("T2"))}, order=${JSON.stringify(order)}`)
  arm("B3 a terminal row is never reopened", byTask.get("T4")?.claimed === false && String(byTask.get("T4")?.reason).includes("terminal"), `T4=${JSON.stringify(byTask.get("T4"))}`)
  arm("B4 an unknown member is refused (no substitution)", byTask.get("T5")?.claimed === false && String(byTask.get("T5")?.reason).includes("roster does not name"), `T5=${JSON.stringify(byTask.get("T5"))}`)
  arm("B5 a refused claim is REPORTED, not thrown", byTask.get("T6")?.claimed === false && String(byTask.get("T6")?.reason).includes("board refused"), `T6=${JSON.stringify(byTask.get("T6"))}`)
  /** The journal rows this call appended. */
  const reassigned = journalRows(workspace, cell.cellId).filter((row) => row.event === "task-reassigned")
  arm("B6 the hand-over is journaled as task-reassigned", reassigned.length === 2 && reassigned[0].taskId === "T1" && reassigned[0].to === "Target", `rows=${JSON.stringify(reassigned.map((row) => row.taskId + "->" + row.to))}`)
  arm("B7 claim lands BEFORE the message", order.indexOf("claim:T1") !== -1 && order.indexOf("send") > order.indexOf("claim:T1"), `order=${JSON.stringify(order)}`)
  arm("B8 a send failure is REPORTED after the claim", byTask.get("T7")?.claimed === true && byTask.get("T7")?.delivered === false && String(byTask.get("T7")?.reason).includes("transport down"), `T7=${JSON.stringify(byTask.get("T7"))}`)
  rmSync(workspace, { recursive: true, force: true })
}

// ══ C. D6 — durable-first mail: no wake for a row that never landed; wake is its own record ═══════
{
  const workspace = sandbox()
  /** Whether the wake was attempted at all in the failing-append arm. */
  let attemptedWithNoRow = false
  const failed = await deliverCellMail({
    appendSend: () => false,
    attemptWake: async () => { attemptedWithNoRow = true; return { sent: true } },
    appendWake: () => true,
  })
  arm("C1 a failed durable append sends NO wake", failed.landed === false && failed.wakeSent === false && attemptedWithNoRow === false, `delivery=${JSON.stringify(failed)}, attempted=${attemptedWithNoRow}`)
  /** The order of the three seams on the success path. */
  const order: string[] = []
  const delivered = await deliverCellMail({
    appendSend: () => { order.push("append-send"); return true },
    attemptWake: async () => { order.push("wake"); return { sent: true } },
    appendWake: () => { order.push("append-wake"); return true },
  })
  arm("C2 write row -> wake -> write wake record", JSON.stringify(order) === JSON.stringify(["append-send", "wake", "append-wake"]) && delivered.landed === true && delivered.wakeSent === true, `order=${JSON.stringify(order)}`)
  /** A THROW from the wake seam is a failed wake, never a lost row. */
  const threw = await deliverCellMail({ appendSend: () => true, attemptWake: async () => { throw new Error("transport down") }, appendWake: () => true })
  arm("C3 a throwing wake is reported as not sent, row kept", threw.landed === true && threw.wakeSent === false && String(threw.wakeReason).includes("transport down"), `delivery=${JSON.stringify(threw)}`)
  rmSync(workspace, { recursive: true, force: true })
}
{
  const workspace = sandbox()
  const cellId = "cell-20261031T060000000Z-probe"
  /** A real send row, shaped as `cellwork_send` writes it. */
  const sendRow = { t: "send" as const, id: "m1", cellId, from: "cap", to: "Alpha", subject: "s", body: "b", at: NOW.toISOString(), wakeSent: false }
  appendCellMail(workspace, cellId, sendRow)
  appendCellMail(workspace, cellId, { t: "wake", id: "m1", sent: true, at: NOW.toISOString() })
  /** The log lines as they landed. */
  const lines = readFileSync(cellMailPath(workspace, cellId), "utf8").split("\n").filter((line) => line.trim() !== "").map((line) => JSON.parse(line) as Record<string, unknown>)
  arm("C4 send row carries wakeSent:false, wake is a separate record", lines.length === 2 && lines[0].t === "send" && lines[0].wakeSent === false && lines[1].t === "wake" && lines[1].sent === true, `lines=${JSON.stringify(lines.map((line) => line.t + ":" + String(line.wakeSent ?? line.sent)))}`)
  /** The fold of that pair. */
  const folded = foldCellMail(readCellMail(workspace, cellId))
  arm("C5 the fold reports the wake outcome", folded.length === 1 && folded[0].wakeSent === true, `folded=${JSON.stringify(folded.map((row) => row.wakeSent))}`)
  // AN OLDER LOG: a pre-`wake` row keeps its own `wakeSent: true` when folded by this build.
  /** A legacy row with no wake record at all. */
  appendCellMail(workspace, cellId, { t: "send", id: "m0", cellId, from: "cap", to: "Beta", subject: "old", body: "b", at: NOW.toISOString(), wakeSent: true })
  /** The fold including the legacy row. */
  const all = foldCellMail(readCellMail(workspace, cellId))
  arm("C6 a PRE-wake row keeps its own wakeSent in this build", all.find((row) => row.id === "m0")?.wakeSent === true, `legacy=${String(all.find((row) => row.id === "m0")?.wakeSent)}`)
  rmSync(workspace, { recursive: true, force: true })
}

// ══ D. C11 — split-ticket lookup by ID first, owner second, and the owner lost by approval ════════
{
  /** The board rows: an ownerless ticket (D2), a terminal one, and a live owner-named one. */
  const rows: SplitTicketRow[] = [
    { id: "T9", owner: "", status: "pending" },
    { id: "T7", owner: "cell-splitter", status: "completed" },
    { id: "T8", owner: "cell-splitter", status: "pending" },
  ]
  arm("D1 the recorded ID is found even with NO owner", findSplitTicket(rows, "T9", true)?.id === "T9", `found=${String(findSplitTicket(rows, "T9", true)?.id)}`)
  arm("D2 without an id the owner is the fallback (live row first)", findSplitTicket(rows, "", true)?.id === "T8", `found=${String(findSplitTicket(rows, "", true)?.id)}`)
  arm("D3 liveOnly skips a terminal owner row", findSplitTicket(rows, "", true)?.id === "T8" && findSplitTicket(rows, "T7", true)?.id === "T8", `liveOnly=${String(findSplitTicket(rows, "T7", true)?.id)}`)
  // An ownerless LIVE row is CLAIMED for cell-splitter by staging itself.
  const claimCalls: Array<Record<string, unknown>> = []
  const cell = makeCell({ splitTaskId: "T9" })
  const resolved = await resolveSplitTicket({
    dsh: { executeTool: async (request: { name: string; arguments: Record<string, unknown> }) => { claimCalls.push(request.arguments); return { ok: true, value: {} } } },
    workspace: "/tmp/nowhere", cell, captainAgent: {}, teams: () => ({ get: () => ({ tasks: rows }) }),
  } as never, "team-1", "", true)
  arm("D4 staging CLAIMS an ownerless ticket for cell-splitter", resolved.splitTaskId === "T9" && resolved.ownerRepaired === true && claimCalls.length === 1 && claimCalls[0].action === "claim" && claimCalls[0].claimant === "cell-splitter", `resolution=${JSON.stringify(resolved)}, claims=${JSON.stringify(claimCalls)}`)
  // A board with no ticket at all: the repair verb is named verbatim.
  const missing = await resolveSplitTicket({
    dsh: { executeTool: async () => ({ ok: true, value: {} }) },
    workspace: "/tmp/nowhere", cell: makeCell(), captainAgent: {}, teams: () => ({ get: () => ({ tasks: [] }) }),
  } as never, "team-1", "", true)
  arm("D5 a missing ticket is a hard error naming the repair verb", missing.splitTaskId === "" && missing.repairError.includes(SPLIT_TICKET_REPAIR), `repairError=${missing.repairError}`)
  // An UNREADABLE board proves nothing, so no absence is claimed.
  const unreadable = await resolveSplitTicket({
    dsh: { executeTool: async () => ({ ok: true, value: {} }) },
    workspace: "/tmp/nowhere", cell: makeCell(), captainAgent: {}, teams: () => undefined,
  } as never, "team-1", "T-answered", true)
  arm("D6 an unreadable board is not evidence of absence", unreadable.boardReadable === false && unreadable.repairError === "", `resolution=${JSON.stringify(unreadable)}`)
}

// ══ E. C1/C2/C3/C4/C5/C7/C8/C12 — activation: members, writer identity, progress, resume ═════════
{
  /** One split task in the frozen verdict shape. */
  const task = (key: string, ownerRole: string, memberName: string, writeScopes: readonly string[], kind = "work", blockedBy: readonly string[] = []): SplitTaskVerdict => ({
    key, subject: "subject " + key, description: "deliverable " + key, kind, ownerRole, member: memberName,
    writeScopes, blockedBy, inputs: [], verify: false, estimate: {} as never, budget: {} as never, accepted: true,
  })
  // C1's defect shape: TWO members share ONE owner role, plus a role-spelled member and a member row.
  const tasks: SplitTaskVerdict[] = [
    task("A", "Senior Engineer", "Alpha", ["src/a/**"]),
    task("B", "Senior Engineer", "Beta", ["src/b/**"]),
    task("C", "Reviewer", "Reviewer", ["src/c/**"]),
    task("E", "Junior Engineer", "", ["src/e/**"]),
    task("D", "Reviewer", "Reviewer", [], "review", ["C"]),
  ]
  /** The accepted split verdict. */
  const split = { version: 1, cellId: "cell-20261031T060000000Z-probe", revision: 1, submittedAt: NOW.toISOString(), accepted: true, tasks, findings: [] } as unknown as SplitVerdict
  /** The knobs `materializeSplit` reads. */
  const config = { depthMax: 2, contractGates: [] } as unknown as CellworkConfig
  /** A stateful fake team plane: the raises and appends a real team record would keep. */
  class FakeBoard {
    members: Array<Record<string, unknown>> = []
    tasks: Array<Record<string, unknown>> = []
    membersAdded: string[] = []
    tasksCreated: string[] = []
    loopCalls: Array<Record<string, unknown>> = []
    sends: string[] = []
    failLoopAt = 0
    dupOnce = new Set<string>()
    failMemberAt = 0
    failTaskAt = 0
    memberCalls = 0
    taskCalls = 0
    preSeeded: Array<Record<string, unknown>> = []
    async execute(request: { name: string; arguments: Record<string, unknown> }): Promise<{ ok: boolean; value?: Record<string, unknown>; error?: string }> {
      const args = request.arguments
      if (request.name === "agent_teams_plan" && args.action === "add_member") {
        const row = args.member as Record<string, unknown>
        const name = String(row.name)
        this.memberCalls += 1
        this.membersAdded.push(name)
        if (this.failMemberAt !== 0 && this.memberCalls === this.failMemberAt) return { ok: false, error: "the executor refused the raise" }
        // D1's wedge: the roster already answers for this name even though the seed read did not show it.
        if (this.dupOnce.has(name)) {
          this.dupOnce.delete(name)
          this.preSeeded.push({ id: "M-live", name, executorRef: "h-live-" + name, status: "running" })
          return { ok: false, error: 'teammate "' + name + '" is already on the roster' }
        }
        const id = "M" + (this.members.length + 1)
        const executorRef = "h-" + name
        this.members.push({ id, name, role: row.role, executorRef, status: "running" })
        return { ok: true, value: { spawned: executorRef, member: { id, name } } }
      }
      if (request.name === "agent_teams_plan" && args.action === "create_task") {
        const row = args.task as Record<string, unknown>
        this.taskCalls += 1
        if (this.failTaskAt !== 0 && this.taskCalls === this.failTaskAt) return { ok: false, error: "the board refused the append" }
        const id = "T" + (this.tasks.length + 1)
        this.tasksCreated.push(String(row.owner))
        this.tasks.push({ id, subject: row.subject, owner: row.owner, status: "pending", blockedBy: row.blocked_by ?? [], kind: row.kind })
        return { ok: true, value: { task: { id } } }
      }
      if (request.name === "agent_teams_task") return { ok: true, value: {} }
      if (request.name === "mpd_verify_open") {
        this.loopCalls.push(args)
        if (this.failLoopAt !== 0 && this.loopCalls.length === this.failLoopAt) return { ok: false, error: "the verify plane refused the loop" }
        return { ok: true, value: { loopId: "loop-" + String(args.task_id) } }
      }
      return { ok: false, error: "unexpected tool " + request.name }
    }
    /** The executor seam the dispatch step uses. */
    executor(): { send: (_agent: unknown, _handle: string, content: string) => Promise<void> } {
      return { send: async (_agent, _handle, content) => { this.sends.push(content) } }
    }
  }
  /** Run one activation pass against a board. */
  async function activate(board: FakeBoard, target: CellState, progress: ActivateProgress[]): Promise<Awaited<ReturnType<typeof materializeSplit>>> {
    return materializeSplit({
      dsh: {
        executeTool: (request: { name: string; arguments: Record<string, unknown> }) => board.execute(request),
        teamExecutor: () => board.executor(),
      },
      workspace: sandbox(),
      cell: target,
      config,
      captainAgent: {},
      split,
      personaFor: () => "PERSONA",
      recordFor: () => ({ teamId: "team-1", members: [...board.preSeeded, ...board.members], tasks: board.tasks }) as unknown as DispatchRecordView,
      progress: (step) => { progress.push(step) },
      now: NOW,
    } as never)
  }
  // E1-E5: the FIRST pass succeeds.
  const board = new FakeBoard()
  const progress: ActivateProgress[] = []
  const first = await activate(board, makeCell(), progress)
  arm("E1 the first activation materialises", first.ok === true, first.ok ? `tasks=${first.outcome.tasks.length}, loops=${first.outcome.loops.length}` : `error=${first.error}`)
  if (first.ok) {
    arm("E2 ONE member per DISTINCT member (two share one role)", JSON.stringify(board.membersAdded) === JSON.stringify(["Alpha", "Beta", "Reviewer", "Junior Engineer"]), `membersAdded=${JSON.stringify(board.membersAdded)}`)
    arm("E3 board owners are the MEMBER names", JSON.stringify([...board.tasksCreated].sort()) === JSON.stringify(["Alpha", "Beta", "Junior Engineer", "Reviewer", "Reviewer"]), `owners=${JSON.stringify(board.tasksCreated)}`)
    arm("E4 contracts name the ROLE and the MEMBER", first.ok && first.outcome.contracts.every((path) => { const text = readFileSync(path, "utf8"); return /Owner: \*\*.+?\*\* \(member `.+?`\)/.test(text) }), `contracts=${JSON.stringify(first.outcome.contracts)}`)
    /** The writer id the loop-open call carried, by board task id (A,B,C,E in order). */
    const writers = board.loopCalls.map((args) => String(args.writer_id))
    arm("E5 writer_id is the member's SESSION id (never the name)", JSON.stringify(writers) === JSON.stringify(["h-Alpha", "h-Beta", "h-Reviewer", "h-Junior Engineer"]), `writers=${JSON.stringify(writers)}`)
    /** The human name travels in writer_reason. */
    const reasons = board.loopCalls.map((args) => String(args.writer_reason))
    arm("E6 writer_reason names the member", JSON.stringify(reasons) === JSON.stringify(["member: Alpha", "member: Beta", "member: Reviewer", "member: Junior Engineer"]), `reasons=${JSON.stringify(reasons)}`)
    arm("E7 progress rows are COMPACT (stage+key+ordinal+total only)", progress.length === 17 && progress.every((step) => JSON.stringify(Object.keys(step).sort()) === JSON.stringify(["key", "ordinal", "stage", "total"])) && progress.every((step, index) => step.ordinal === index + 1 && step.total === 17), `count=${progress.length}, first=${JSON.stringify(progress[0])}, last=${JSON.stringify(progress.at(-1))}`)
    arm("E8 the dispatch wakes the resolved MEMBER owners", board.sends.length === 4, `sends=${board.sends.length}`)
  }
  // E9-E10: a FAILED pass at the loop stage returns exactly ONE whole-state partial.
  const failedBoard = new FakeBoard()
  failedBoard.failLoopAt = 3
  const failedProgress: ActivateProgress[] = []
  const failed = await activate(failedBoard, makeCell(), failedProgress)
  arm("E9 a failed pass returns ONE partial snapshot", failed.ok === false && failed.partial !== undefined && Array.isArray((failed as unknown as { partial?: unknown }).partial) === false && Object.keys(failed.partial ?? {}).sort().join(",") === "boardIds,contracts,loopIds,members", failed.ok ? "unexpected success" : `partial keys=${Object.keys(failed.partial ?? {}).sort().join(",")}, progress=${failedProgress.length}`)
  arm("E10 progress is compact up to the failure (no whole state)", failedProgress.length === 15 && failedProgress.every((step) => typeof step.key === "string" && typeof step.ordinal === "number"), `count=${failedProgress.length}`)
  // E11-E13: the RESUME of that same revision reuses everything and opens ONLY the missing loops.
  const resumeBoard = new FakeBoard()
  resumeBoard.members = board.members.map((row) => ({ ...row }))
  resumeBoard.tasks = board.tasks.map((row) => ({ ...row }))
  resumeBoard.membersAdded = []
  resumeBoard.tasksCreated = []
  /** The cell record the failed pass left behind (contract A2's shape). */
  const resumeCell = makeCell({
    members: { ...(failed.ok ? {} : failed.partial?.members ?? {}) },
    activatedTasks: { ...(failed.ok ? {} : failed.partial?.boardIds ?? {}) },
    activatedLoops: { ...(failed.ok ? {} : failed.partial?.loopIds ?? {}) },
    activationInFlight: 1,
  })
  const resumeProgress: ActivateProgress[] = []
  const resumed = await activate(resumeBoard, resumeCell, resumeProgress)
  arm("E11 the resume converges without duplicates", resumed.ok === true && resumeBoard.membersAdded.length === 0 && resumeBoard.tasksCreated.length === 0, resumed.ok ? `membersAdded=${JSON.stringify(resumeBoard.membersAdded)}, tasksCreated=${JSON.stringify(resumeBoard.tasksCreated)}` : `error=${resumed.error}`)
  arm("E12 the resume opens ONLY the missing loops", resumed.ok === true && resumeBoard.loopCalls.length === 2, `loopCalls=${resumeBoard.loopCalls.length}`)
  arm("E13 the resumed writer_id still names the session (Reviewer)", resumed.ok === true && String(resumeBoard.loopCalls[0]?.writer_id) === "h-Reviewer" && String(resumeBoard.loopCalls[0]?.writer_reason) === "member: Reviewer", `first=${JSON.stringify(resumeBoard.loopCalls[0])}`)
  // E14: the fallback spellings of the resolved member.
  arm("E14 an empty member falls back to the ownerRole", resolvedMemberName(task("X", "Junior Engineer", "", [])) === "Junior Engineer", `resolved=${resolvedMemberName(task("X", "Junior Engineer", "", []))}`)
  // E17-E20: C12 at the OTHER stages — a failure at member or task still resumes without duplicates.
  const memberFailBoard = new FakeBoard()
  memberFailBoard.failMemberAt = 2
  const memberFailProgress: ActivateProgress[] = []
  const memberFail = await activate(memberFailBoard, makeCell(), memberFailProgress)
  const memberFailCell = makeCell({
    members: { ...(memberFail.ok ? {} : memberFail.partial?.members ?? {}) },
    activatedTasks: { ...(memberFail.ok ? {} : memberFail.partial?.boardIds ?? {}) },
    activatedLoops: { ...(memberFail.ok ? {} : memberFail.partial?.loopIds ?? {}) },
    activationInFlight: 1,
  })
  /** A fresh board that already carries the members the failed pass raised. */
  const memberResumeBoard = new FakeBoard()
  memberResumeBoard.members = memberFailBoard.members.map((row) => ({ ...row }))
  memberResumeBoard.membersAdded = []
  const memberResume = await activate(memberResumeBoard, memberFailCell, [])
  arm("E17 a MEMBER-stage failure resumes without re-adding the member", memberFail.ok === false && memberResume.ok === true && memberResumeBoard.membersAdded.length === 3 && memberResumeBoard.members.length === 4, memberResume.ok ? `re-added=${JSON.stringify(memberResumeBoard.membersAdded)}, members=${memberResumeBoard.members.length}` : `resume error=${memberResume.error}`)
  arm("E18 the member-stage resume still arms every loop and task once", memberResume.ok === true && memberResume.outcome.loops.length === 4 && memberResume.outcome.tasks.length === 5 && memberResumeBoard.tasks.length === 5, memberResume.ok ? `loops=${memberResume.outcome.loops.length}, tasks=${memberResume.outcome.tasks.length}` : "no outcome")
  const taskFailBoard = new FakeBoard()
  taskFailBoard.failTaskAt = 3
  const taskFail = await activate(taskFailBoard, makeCell(), [])
  const taskFailCell = makeCell({
    members: { ...(taskFail.ok ? {} : taskFail.partial?.members ?? {}) },
    activatedTasks: { ...(taskFail.ok ? {} : taskFail.partial?.boardIds ?? {}) },
    activatedLoops: { ...(taskFail.ok ? {} : taskFail.partial?.loopIds ?? {}) },
    activationInFlight: 1,
  })
  const taskResumeBoard = new FakeBoard()
  taskResumeBoard.members = taskFailBoard.members.map((row) => ({ ...row }))
  taskResumeBoard.tasks = taskFailBoard.tasks.map((row) => ({ ...row }))
  taskResumeBoard.membersAdded = []
  taskResumeBoard.tasksCreated = []
  const taskResume = await activate(taskResumeBoard, taskFailCell, [])
  arm("E19 a TASK-stage failure resumes with no duplicate member/task", taskFail.ok === false && taskResume.ok === true && taskResumeBoard.membersAdded.length === 0 && taskResumeBoard.tasksCreated.length === 3 && taskResumeBoard.tasks.length === 5, taskResume.ok ? `membersAdded=${JSON.stringify(taskResumeBoard.membersAdded)}, tasksCreated=${JSON.stringify(taskResumeBoard.tasksCreated)}, tasks=${taskResumeBoard.tasks.length}` : `resume error=${taskResume.error}`)
  arm("E20 the task-stage resume opens the loops it had not reached", taskResume.ok === true && taskResumeBoard.loopCalls.length === 4, taskResume.ok ? `loopCalls=${taskResumeBoard.loopCalls.length}` : "no outcome")
  // E15-E16: D1's wedge reason — "already on the roster" is reconciled from a fresh read, not fatal.
  const dupBoard = new FakeBoard()
  dupBoard.dupOnce.add("Alpha")
  const dupProgress: ActivateProgress[] = []
  const dup = await activate(dupBoard, makeCell(), dupProgress)
  arm("E15 an 'already on the roster' answer is RECONCILED, not fatal", dup.ok === true && dup.outcome.members.Alpha?.executorRef === "h-live-Alpha" && dup.outcome.reused.includes("Alpha"), dup.ok ? `alpha=${JSON.stringify(dup.outcome.members.Alpha)}, reused=${JSON.stringify(dup.outcome.reused)}` : `error=${dup.error}`)
  arm("E16 the reconciled live handle is the loop's writer_id", dup.ok === true && String(dupBoard.loopCalls[0]?.writer_id) === "h-live-Alpha", dup.ok ? `writer=${String(dupBoard.loopCalls[0]?.writer_id)}` : "no loops opened")
}

// ══ F. R4 — the fence fields and the split-ticket id survive a record round-trip ═════════════════
{
  const workspace = sandbox()
  const cell = makeCell({
    members: {
      Fenced: member("Fenced", { fenced: true, fencedReason: "no-engine" }),
      Plain: member("Plain"),
    },
    splitTaskId: "T9",
  })
  writeCell(workspace, cell)
  const read = readCell(workspace, cell.cellId)
  const fencedRow = read.ok ? read.state.members.Fenced : undefined
  const plainRow = read.ok ? read.state.members.Plain : undefined
  arm("F1 fenced + fencedReason survive the record round-trip", fencedRow?.fenced === true && fencedRow?.fencedReason === "no-engine", `row=${JSON.stringify(fencedRow)}`)
  arm("F2 an unfenced member does not GROW a fenced:false key", plainRow !== undefined && !("fenced" in plainRow), `keys=${plainRow === undefined ? "missing" : JSON.stringify(Object.keys(plainRow))}`)
  arm("F3 splitTaskId survives the record round-trip", read.ok && read.state.splitTaskId === "T9", `splitTaskId=${read.ok ? String(read.state.splitTaskId) : "read failed"}`)
  rmSync(workspace, { recursive: true, force: true })
}

console.log(`\n${failures.length === 0 ? "ALL ARMS PASS" : `FAILED ARMS: ${failures.join(", ")}`}`)
process.exit(failures.length === 0 ? 0 : 1)
