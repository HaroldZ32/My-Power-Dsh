// R1's OWN re-review probe for CR repairs A (CR#2, CR#4, CR#7), B (CR#5) and C (CR#3, CR#6).
// It drives the real exported functions / the real registered flow tool — never the lanes' tests — and
// keeps every fixture in a `mkdtemp` workspace (§7 R9).
import { createHash } from "node:crypto"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  applyReassignments,
  dispatchOwnerOnly,
  handleOrNull,
  type DispatchRecordView,
} from "../../../../packages/mpd-cellwork-plugin/src/dispatch.ts"
import { deliverCellMail } from "../../../../packages/mpd-cellwork-plugin/src/mail.ts"
import { roleKey, validateGraph, type SplitTaskInput } from "../../../../packages/mpd-cellwork-plugin/src/split.ts"
import {
  findSplitTicket,
  resolveSplitTicket,
  SPLIT_TICKET_REPAIR,
  type SplitTicketRow,
} from "../../../../packages/mpd-cellwork-plugin/src/staging.ts"
import { materializeSplit } from "../../../../packages/mpd-cellwork-plugin/src/activate.ts"
import { installCellworkFlow } from "../../../../packages/mpd-cellwork-plugin/src/flow.ts"
import {
  journalPath,
  newCellState,
  readCell,
  writeCell,
  type CellMemberRecord,
  type CellState,
} from "../../../../packages/mpd-cellwork-plugin/src/state.ts"
import type { CellworkConfig } from "../../../../packages/mpd-cellwork-plugin/src/config.ts"
import type { SplitTaskVerdict, SplitVerdict } from "../../../../packages/mpd-cellwork-plugin/src/split.ts"

/** The clock every fixture stamps. */
const NOW = new Date("2026-10-31T06:00:00.000Z")

/** Failures per arm; the exit code reports how many contract items failed. */
const failures: string[] = []

/** Record one arm's outcome and print it. */
function arm(id: string, ok: boolean, detail: string): void {
  if (!ok) failures.push(id)
  console.log(`${ok ? "PASS" : "FAIL"} ${id} — ${detail}`)
}

/** A fresh temp workspace. */
const sandbox = (): string => mkdtempSync(join(tmpdir(), "r1-ac2-"))

/** The parsed journal of one cell. */
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
  ...newCellState({ cellId: "cell-20261031T060000000Z-probe", objective: "probe", captainSessionId: "cap-1", now: NOW }),
  phase: "split", teamId: "team-1", requirementsRevision: 1, splitRevision: 1, ...over,
})

// ══ CR#2 — reassigning to a failed / provisioning member is refused, before the claim ═════════════
{
  const workspace = sandbox()
  const cell = makeCell({ members: { Target: member("Target"), Fenced: member("Fenced", { fenced: true }) } })
  const record = {
    teamId: "team-1",
    members: [
      { id: "M1", name: "Failed", executorRef: "h-Failed", status: "failed" },
      { id: "M2", name: "Prov", executorRef: "h-Prov", status: "provisioning" },
      { id: "M3", name: "Target", executorRef: "h-Target", status: "running" },
      { id: "M4", name: "Fenced", executorRef: "h-Fenced", status: "running", fenced: true },
    ],
    tasks: [
      { id: "T1", subject: "a", status: "pending", owner: "Old" },
      { id: "T2", subject: "b", status: "pending", owner: "Old" },
      { id: "T3", subject: "c", status: "pending", owner: "Old" },
      { id: "T4", subject: "d", status: "pending", owner: "Old" },
    ],
  } as unknown as DispatchRecordView
  /** The claim seam's calls, so "not claimed" is observable. */
  const claims: string[] = []
  /** The transport's calls, so "not messaged" is observable. */
  const sent: string[] = []
  const outcomes = await applyReassignments({
    workspace, cell, record,
    pairs: [
      { taskId: "T1", owner: "Failed" },
      { taskId: "T2", owner: "Prov" },
      { taskId: "T3", owner: "Target" },
      { taskId: "T4", owner: "Fenced" },
    ],
    claim: async (taskId) => { claims.push(taskId); return { ok: true } },
    send: async (handle) => { sent.push(handle) },
    now: NOW,
  })
  const byTask = new Map(outcomes.map((row) => [row.taskId, row]))
  arm("CR2-1 a FAILED target is refused and reported", byTask.get("T1")?.claimed === false && byTask.get("T1")?.delivered === false && String(byTask.get("T1")?.reason).includes("FAILED"), `T1=${JSON.stringify(byTask.get("T1"))}`)
  arm("CR2-2 a PROVISIONING target is refused and reported", byTask.get("T2")?.claimed === false && String(byTask.get("T2")?.reason).includes("still being raised"), `T2=${JSON.stringify(byTask.get("T2"))}`)
  arm("CR2-3 neither target was claimed nor messaged", !claims.includes("T1") && !claims.includes("T2") && !sent.includes("h-Failed") && !sent.includes("h-Prov"), `claims=${JSON.stringify(claims)}, sent=${JSON.stringify(sent)}`)
  arm("CR2-4 the rows stay pending (no board write happened)", record.tasks.filter((row) => row.status === "pending").length === 4, `pending=${record.tasks.filter((row) => row.status === "pending").length}`)
  arm("CR2-5 a running target is still delivered (no regression)", byTask.get("T3")?.claimed === true && byTask.get("T3")?.delivered === true, `T3=${JSON.stringify(byTask.get("T3"))}`)
  arm("CR2-6 a fenced target is still refused (no regression)", byTask.get("T4")?.claimed === false && String(byTask.get("T4")?.reason).includes("FENCED"), `T4=${JSON.stringify(byTask.get("T4"))}`)
  rmSync(workspace, { recursive: true, force: true })
}

// ══ CR#4 — a blank cell executorRef falls through to the LIVE roster handle (both paths) ═════════
{
  arm("CR4-1 handleOrNull treats '', whitespace and non-strings as absent", handleOrNull("") === null && handleOrNull("   ") === null && handleOrNull(undefined) === null && handleOrNull(42) === null && handleOrNull(" h1 ") === "h1", `["", "   ", undefined, 42].map(handleOrNull)=${JSON.stringify(["", "   ", undefined, 42].map((value) => handleOrNull(value)))}, trimmed=${JSON.stringify(handleOrNull(" h1 "))}`)
  const workspace = sandbox()
  // The CELL record's handle is BLANK; the LIVE roster carries the valid one.
  const cell = makeCell({ members: { Blank: member("Blank", { executorRef: "" }), Blank2: member("Blank2", { executorRef: "   " }) } })
  const record = {
    teamId: "team-1",
    members: [
      { id: "M1", name: "Blank", executorRef: "h-live-1", status: "running" },
      { id: "M2", name: "Blank2", executorRef: "h-live-2", status: "running" },
    ],
    tasks: [
      { id: "T1", subject: "a", status: "pending", owner: "Blank", blockedBy: [] },
      { id: "T2", subject: "b", status: "pending", owner: "Blank2", blockedBy: [] },
    ],
  } as unknown as DispatchRecordView
  /** The transport's calls. */
  const sent: string[] = []
  const report = await dispatchOwnerOnly({
    workspace, cell, record,
    send: async (handle) => { sent.push(handle) },
    // The protocol handler's own expression: the CELL row's handle first, which is blank here.
    handleFor: (name) => cell.members[name]?.executorRef,
    now: NOW,
  })
  arm("CR4-2 the DISPATCH pass delivers through the LIVE handle when the cell's is blank", report.pairs.length === 2 && JSON.stringify(sent.sort()) === JSON.stringify(["h-live-1", "h-live-2"]), `pairs=${JSON.stringify(report.pairs.map((p) => p.memberName + ":" + p.handle))}`)
  // The reassign path, same blank-cell shape.
  const claims: string[] = []
  const reassignedSent: string[] = []
  const outcomes = await applyReassignments({
    workspace, cell, record,
    pairs: [{ taskId: "T1", owner: "Blank" }, { taskId: "T2", owner: "Blank2" }],
    claim: async (taskId) => { claims.push(taskId); return { ok: true } },
    send: async (handle) => { reassignedSent.push(handle) },
    handleFor: (name) => cell.members[name]?.executorRef,
    now: NOW,
  })
  arm("CR4-3 the REASSIGN path delivers through the LIVE handle when the cell's is blank", outcomes.every((row) => row.claimed && row.delivered) && JSON.stringify(reassignedSent.sort()) === JSON.stringify(["h-live-1", "h-live-2"]), `outcomes=${JSON.stringify(outcomes.map((row) => row.owner + ":" + row.delivered))}`)
  // A genuinely absent handle on BOTH sides still reports.
  const absentRecord = {
    teamId: "team-1",
    members: [{ id: "M3", name: "NoHandle", executorRef: "", status: "running" }],
    tasks: [{ id: "T3", subject: "c", status: "pending", owner: "NoHandle", blockedBy: [] }],
  } as unknown as DispatchRecordView
  const absentReport = await dispatchOwnerOnly({ workspace, cell: makeCell(), record: absentRecord, send: async () => {}, now: NOW })
  const absentReassign = await applyReassignments({ workspace, cell: makeCell(), record: absentRecord, pairs: [{ taskId: "T3", owner: "NoHandle" }], claim: async () => ({ ok: true }), send: async () => {}, now: NOW })
  arm("CR4-4 a handle absent on BOTH sides is still reported", (absentReport.skipped[0]?.reason ?? "").includes("no executor handle") && (absentReassign[0]?.reason ?? "").includes("no executor handle"), `dispatch=${absentReport.skipped[0]?.reason}; reassign=${absentReassign[0]?.reason}`)
  rmSync(workspace, { recursive: true, force: true })
}

// ══ CR#7 — the N1 seam behaviour, unconditional (the permission arm is test-side) ════════════════
{
  // The FIRST append lands, the transport accepts, and the `wake` RECORD append fails.
  const order: string[] = []
  const lost = await deliverCellMail({
    appendSend: () => { order.push("send-row"); return true },
    attemptWake: async () => { order.push("wake"); return { sent: true } },
    appendWake: () => { order.push("wake-record"); return false },
  })
  arm("CR7-1 a failed `wake` record append is reported NOT sent, with its own reason", lost.landed === true && lost.wakeSent === false && String(lost.wakeReason).includes("wake") && String(lost.wakeReason).includes("could not be written"), `delivery=${JSON.stringify(lost)}`)
  arm("CR7-2 the order is still row -> attempt -> record", JSON.stringify(order) === JSON.stringify(["send-row", "wake", "wake-record"]), `order=${JSON.stringify(order)}`)
  // The failed `send` row path still attempts NOTHING.
  let attempted = false
  const notLanded = await deliverCellMail({ appendSend: () => false, attemptWake: async () => { attempted = true; return { sent: true } }, appendWake: () => true })
  arm("CR7-3 a failed durable send append still sends NO wake", notLanded.landed === false && notLanded.wakeSent === false && attempted === false, `delivery=${JSON.stringify(notLanded)}, attempted=${attempted}`)
  // Control: both appends land -> sent.
  const ok = await deliverCellMail({ appendSend: () => true, attemptWake: async () => ({ sent: true }), appendWake: () => true })
  arm("CR7-4 both appends landing still reports sent", ok.landed === true && ok.wakeSent === true, `delivery=${JSON.stringify(ok)}`)
  // The arm is root-safe BY SOURCE: skip-as-root behind getuid with a stated reason, seam arm unconditional.
  const testText = readFileSync("packages/mpd-cellwork-plugin/test/mail-order.test.ts", "utf8")
  arm("CR7-5 the permission arm is skipped-as-root WITH its stated reason", testText.includes("process.getuid?.() === 0") && testText.includes("test.skip") && testText.includes("SKIPPED as root") && testText.includes("seam-level N1 arm"), "source check on test/mail-order.test.ts")
  arm("CR7-6 the seam-level N1 arm is unconditional `test(`", /test\("N1: deliverCellMail reports NOT sent when the `wake` record cannot be appended"/.test(testText), "source check on the unconditional seam arm")
}

// ══ CR#5 — split validation uses the SAME identity key activation groups by ══════════════════════
{
  /** One split task input. */
  const task = (key: string, ownerRole: string, memberName: string | undefined, kind: string, blockedBy: readonly string[], verify = false): SplitTaskInput => ({
    key, subject: "subject " + key, description: "d", kind, ownerRole,
    ...(memberName === undefined ? {} : { member: memberName }),
    writeScopes: ["src/x/**"], blockedBy, independent: false, inputs: [], verify,
  })
  const roster = ["Senior Engineer", "Reviewer"]
  /** The work/review pair spelling ONE seat two ways under ONE role (verify:true arms the review check). */
  const pair = validateGraph([
    { ...task("W", "Senior Engineer", "Seat A", "work", [], true) },
    { ...task("R", "Senior Engineer", "seat-a", "review", ["W"]), writeScopes: [] },
  ], roster)
  arm("CR5-1 a work/review pair spelling the seat two ways is REFUSED as self-review", pair.some((finding) => finding.code === "self-review"), `codes=${JSON.stringify(pair.map((finding) => finding.code))}, detail=${String(pair.find((finding) => finding.code === "self-review")?.detail)}`)
  /** Same identity, DIFFERENT roles, no review relationship. */
  const conflict = validateGraph([
    task("A", "Senior Engineer", "Seat A", "work", []),
    task("B", "Reviewer", "seat-a", "work", []),
  ], roster)
  arm("CR5-2 two roles spelling one identity is member-role-conflict", conflict.some((finding) => finding.code === "member-role-conflict"), `codes=${JSON.stringify(conflict.map((finding) => finding.code))}`)
  /** A name with no identity at all. */
  const punctuation = validateGraph([task("P", "Senior Engineer", "---", "work", [])], roster)
  arm("CR5-3 a punctuation-only member name is member-invalid", punctuation.some((finding) => finding.code === "member-invalid"), `codes=${JSON.stringify(punctuation.map((finding) => finding.code))}, detail=${String(punctuation.find((finding) => finding.code === "member-invalid")?.detail)}`)
  /** Identical spellings share one seat without a finding. */
  const shared = validateGraph([
    task("A", "Senior Engineer", "Seat A", "work", []),
    task("B", "Senior Engineer", "Seat A", "work", []),
  ], roster)
  arm("CR5-4 identical spellings still share one member without a finding", shared.filter((finding) => finding.code === "member-role-conflict" || finding.code === "self-review").length === 0, `codes=${JSON.stringify(shared.map((finding) => finding.code))}`)
  // Activation is UNTOUCHED by the repair: its bytes equal the T6 anchor.
  const activateHash = createHash("sha256").update(readFileSync("packages/mpd-cellwork-plugin/src/activate.ts")).digest("hex")
  arm("CR5-5 activate.ts was NOT changed to accommodate the validation (T6 anchor)", activateHash === "34de09c3a2e0b3aa80aba53749e64fd0361e8b46ddf719aa8edd2a208574954d", `activate.ts sha256=${activateHash}`)
  // Identical spellings still raise ONE member at activation.
  /** One split verdict task. */
  const verdictTask = (key: string, memberName: string): SplitTaskVerdict => ({
    key, subject: "subject " + key, description: "d", kind: "work", ownerRole: "Senior Engineer",
    member: memberName, writeScopes: ["src/x/**"], blockedBy: [], inputs: [], verify: false,
    estimate: {} as never, budget: {} as never, accepted: true,
  })
  const split = { version: 1, cellId: "cell-20261031T060000000Z-probe", revision: 1, submittedAt: NOW.toISOString(), accepted: true, tasks: [verdictTask("A", "Seat A"), verdictTask("B", "Seat A")], findings: [] } as unknown as SplitVerdict
  const added: string[] = []
  const result = await materializeSplit({
    dsh: {
      executeTool: async (request: { name: string; arguments: Record<string, unknown> }) => {
        if (request.name === "agent_teams_plan" && request.arguments.action === "add_member") {
          const name = String((request.arguments.member as Record<string, unknown>).name)
          added.push(name)
          return { ok: true, value: { spawned: "h-" + name } }
        }
        return { ok: true, value: { task: { id: "T1" }, loopId: "loop-1" } }
      },
      teamExecutor: () => undefined,
    },
    workspace: sandbox(),
    cell: makeCell(),
    config: { depthMax: 2, contractGates: [] } as unknown as CellworkConfig,
    captainAgent: {},
    split,
    personaFor: () => null,
    recordFor: () => ({ teamId: "team-1", members: [], tasks: [] }) as unknown as DispatchRecordView,
    progress: () => {},
    now: NOW,
  } as never)
  arm("CR5-6 identical spellings raise exactly ONE member", result.ok === true && JSON.stringify(added) === JSON.stringify(["Seat A"]), `added=${JSON.stringify(added)}, ok=${result.ok}`)
}

// ══ CR#3 — two consecutive updates append ONE replacement row and REUSE it ═══════════════════════
{
  /** A fresh harness: the flow tools over an in-process team double. */
  function harness(initialTasks: Array<Record<string, unknown>>, recordedSplitTaskId: string, splitRevision: number | null) {
    const workspace = sandbox()
    /** The live team double, mutated by the create_task append. */
    const team = { teamId: "team-1", members: [], tasks: [...initialTasks] }
    /** How many splitter rows the update minted. */
    let minted = 0
    /** The tool definitions the flow module registered. */
    const tools = new Map<string, { name: string; execute: (args: unknown, exec: unknown) => Promise<unknown> }>()
    const dsh = {
      registerTool: (definition: { name: string; execute: (args: unknown, exec: unknown) => Promise<unknown> }) => { tools.set(definition.name, definition); return () => {} },
      registerCommand: () => () => {},
      workspaceRoot: () => workspace,
      executeTool: async (request: { name: string; arguments: Record<string, unknown> }) => {
        const args = request.arguments
        if (request.name === "agent_teams_plan" && args.action === "create_task") {
          minted += 1
          const id = "R" + String(minted)
          team.tasks.push({ id, subject: (args.task as Record<string, unknown>).subject, owner: (args.task as Record<string, unknown>).owner, status: "pending", kind: "work", blocked_by: [] })
          return { ok: true, value: { task: { id } } }
        }
        return { ok: true, value: {} }
      },
      spawnAgent: async () => ({}),
      llmCatalog: () => undefined,
      teamExecutor: () => undefined,
    }
    /** The read-only services the flow module probes. */
    const ctx = { get: (name: string) => (name === "mpdTeams" ? { get: () => team } : undefined) }
    installCellworkFlow({ dsh: dsh as never, ctx: ctx as never, config: { depthMax: 2, contractGates: [] } as unknown as CellworkConfig, warn: () => {} })
    const cell = makeCell({
      cellId: "cell-20261031T060000000Z-probe",
      captainSessionId: "cap-1",
      phase: "split",
      teamId: "team-1",
      requirementsRevision: 1,
      splitRevision,
      splitTaskId: recordedSplitTaskId,
      members: { "cell-planner": member("cell-planner", { role: "Planner", sessionId: "planner-1", executorRef: "planner-1" }) },
    })
    writeCell(workspace, cell)
    /** The exec the planner's dispatch carries. */
    const exec = { agent: { session: { id: "planner-1", header: { cwd: workspace } } } }
    /** Run one requirements update. */
    const update = async (body: string): Promise<Record<string, unknown>> => {
      const tool = tools.get("cellwork_requirements")
      if (tool === undefined) throw new Error(`no cellwork_requirements tool (have ${[...tools.keys()].join(", ")})`)
      return tool.execute({ action: "update", content: body }, exec) as Promise<Record<string, unknown>>
    }
    return { workspace, team, update, minted: () => minted }
  }
  /** A valid six-section requirements document with a distinguishable body. */
  const doc = (tag: string): string => ["## Goal", tag, "## Non-goals", "n", "## Users / consumers", "u", "## Constraints", "c", "## Acceptance criteria", "a", "## Open questions", "o"].join("\n")
  // Scenario 1: recorded id is the CLOSED original; two consecutive updates.
  const h = harness([{ id: "T1", subject: "split for revision 1", owner: "cell-splitter", status: "completed", kind: "work", blocked_by: [] }], "T1", 1)
  const first = await h.update(doc("one"))
  const afterFirst = h.team.tasks.length
  const second = await h.update(doc("two"))
  const afterSecond = h.team.tasks.length
  arm("CR3-1 the first update appends ONE replacement row", first.ok === true && h.minted() === 1 && afterFirst === 2 && typeof first.replacementSplitTaskId === "string" && String(first.replacementSplitTaskId) !== "", `minted=${h.minted()}, tasks=${afterFirst}, replacement=${String(first.replacementSplitTaskId)}`)
  arm("CR3-2 the first update WRITES the replacement id back", first.recordedSplitTaskId === first.replacementSplitTaskId && readCell(h.workspace, "cell-20261031T060000000Z-probe").ok && (readCell(h.workspace, "cell-20261031T060000000Z-probe") as { state: CellState }).state.splitTaskId === first.replacementSplitTaskId, `recorded=${String(first.recordedSplitTaskId)}, state=${String(((readCell(h.workspace, "cell-20261031T060000000Z-probe") as { state: CellState }).state.splitTaskId))}`)
  arm("CR3-3 the SECOND update REUSES the live row and appends NOTHING", second.ok === true && second.redispatchable === true && second.splitTaskId === first.replacementSplitTaskId && second.replacementSplitTaskId === "" && h.minted() === 1 && afterSecond === 2, `minted=${h.minted()}, tasks=${afterSecond}, second=${JSON.stringify({ splitTaskId: second.splitTaskId, redispatchable: second.redispatchable, replacement: second.replacementSplitTaskId })}`)
  /** The journal facts for the two updates. */
  const logs = journalRows(h.workspace, "cell-20261031T060000000Z-probe")
  arm("CR3-4 exactly ONE split-task-replaced row exists for the two updates", logs.filter((row) => row.event === "split-task-replaced").length === 1, `rows=${JSON.stringify(logs.filter((row) => row.event === "split-task-replaced").map((row) => row.replacementTaskId))}`)
  arm("CR3-5 the update rows carry the recorded id and the reuse flag", logs.filter((row) => row.event === "requirements-update").length === 2 && logs.filter((row) => row.event === "requirements-update").at(-1)?.redispatchable === true, `updates=${JSON.stringify(logs.filter((row) => row.event === "requirements-update").map((row) => ({ recorded: row.recordedSplitTaskId, redispatchable: row.redispatchable })))}`)
  rmSync(h.workspace, { recursive: true, force: true })
  // Scenario 2: a LIVE row exists beside the recorded CLOSED one -> the live row wins, nothing appended.
  const h2 = harness([
    { id: "T1", subject: "split for revision 1", owner: "cell-splitter", status: "completed", kind: "work", blocked_by: [] },
    { id: "R9", subject: "re-split for revision 2", owner: "cell-splitter", status: "pending", kind: "work", blocked_by: [] },
  ], "T1", 1)
  const live = await h2.update(doc("one"))
  arm("CR3-6 a LIVE row is preferred over the recorded CLOSED one", live.ok === true && live.splitTaskId === "R9" && live.redispatchable === true && live.replacementSplitTaskId === "" && h2.minted() === 0 && h2.team.tasks.length === 2, `picked=${String(live.splitTaskId)}, minted=${h2.minted()}, tasks=${h2.team.tasks.length}`)
  arm("CR3-7 the preferred live id is written back", live.recordedSplitTaskId === "R9", `recorded=${String(live.recordedSplitTaskId)}`)
  rmSync(h2.workspace, { recursive: true, force: true })
}

// ══ CR#6 — a FAILED owner repair keeps the ticket id, and the ID-first lookup finds it ═══════════
{
  /** The ownerless split ticket the repair cannot claim yet. */
  const rows: SplitTicketRow[] = [{ id: "T9", owner: "", status: "pending" }]
  /** The claim calls the seam saw. */
  const claims: Array<Record<string, unknown>> = []
  const resolved = await resolveSplitTicket({
    dsh: { executeTool: async (request: { name: string; arguments: Record<string, unknown> }) => { claims.push(request.arguments); return { ok: false, error: "the split task is blocked by its requirements task" } } },
    workspace: "/tmp/nowhere",
    cell: makeCell(),
    captainAgent: {},
    teams: () => ({ get: () => ({ tasks: rows }) }),
  } as never, "team-1", "T9", true)
  arm("CR6-1 a FAILED owner repair still returns the ticket id", resolved.splitTaskId === "T9", `resolution=${JSON.stringify(resolved)}`)
  arm("CR6-2 the failure names the repair verb in its error", resolved.repairError.includes(SPLIT_TICKET_REPAIR), `repairError=${resolved.repairError}`)
  arm("CR6-3 an ID-first lookup FINDS the row afterwards", findSplitTicket(rows, resolved.splitTaskId, false)?.id === "T9", `found=${String(findSplitTicket(rows, resolved.splitTaskId, false)?.id)}`)
  arm("CR6-4 the repair path was actually attempted", claims.length === 1 && claims[0].action === "claim" && claims[0].claimant === "cell-splitter", `claims=${JSON.stringify(claims)}`)
  // Source: the staging callers keep the id AND surface the error; index.ts journals both facts.
  const stagingText = readFileSync("packages/mpd-cellwork-plugin/src/staging.ts", "utf8")
  const indexText = readFileSync("packages/mpd-cellwork-plugin/src/index.ts", "utf8")
  arm("CR6-5 staging keeps the id on the refused-repair branch and surfaces ownerRepairError", stagingText.includes("tasks: { splitId }") && stagingText.includes("ownerRepairError: ticket.repairError"), "source check on staging.ts")
  arm("CR6-6 the partial/staged journal rows carry splitTaskId AND ownerRepairError", indexText.includes("ownerRepairError: staged.ownerRepairError") && indexText.includes("splitTaskId: partialState.splitTaskId") && indexText.includes("splitTaskId: stagedState.splitTaskId"), "source check on index.ts")
}

console.log(`\n${failures.length === 0 ? "ALL ARMS PASS" : `FAILED ARMS: ${failures.join(", ")}`}`)
process.exit(failures.length === 0 ? 0 : 1)
