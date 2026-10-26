// CELLWORK ACTIVATE — materialise an ACCEPTED split on the LIVE team record (contract B7).
//
// THE ORDER IS THE CONTRACT, and it is not cosmetic:
//   1. one frozen CONTRACT per code task, written before anything is dispatched, so the verifier's
//      document exists before its subject can start;
//   2. MEMBERS, each raised with its persona TEXT in the prompt (team members get no roster persona) and
//      its roster `role` forwarded for routing;
//   3. TASKS, in dependency order, with every review task blocked by its work task;
//   4. one VERIFY LOOP per code task (`mpd_verify_open`, the contract path and the write scope) — BEFORE
//      dispatch, because a verdict with no loop is a verdict nobody armed;
//   5. DISPATCH, owner-only (see `dispatch.ts`; the platform fallback is deliberately not inherited).
//
// IT NEVER RE-CREATES THE TEAM. The planning team staged by `cellwork_start` is the live record every
// call addresses; activation appends to it, which is also what makes the re-split path (Wave 3) an append
// rather than a second team.
//
// THE PRODUCER IDENTITY FOR `mpd_verify_open`. The captain's own session is fenced by the cellwork guard
// (B2's allowlist has no `mpd_verify_*`), and the verifier does not exist as a live agent yet. The loop is
// therefore opened under a DECLARED PRODUCER identity — `cellwork:<cellId>` with the workspace in its
// session header — which the guard passes (it is nobody's seat) and which the verify plane records
// honestly instead of impersonating the captain or a member. See the report's declared bounds.
import { atomicWriteText, appendJournal, contractPath, type CellMemberRecord, type CellState } from "./state"
import type { CellworkConfig } from "./config"
import type { SplitTaskVerdict, SplitVerdict } from "./split"
import { roleKey } from "./split"
import { contractRelativePath, dispatchOwnerOnly, sendThroughExecutor, type DispatchRecordView, type DispatchReport } from "./dispatch"
import type { DshAdapter } from "../../mpd-dsh-adapter-plugin/src/index"

/** The producer identity the verify loops are opened under (declared, never impersonated). */
export function producerSessionId(cellId: string): string {
  return "cellwork:" + cellId
}

/** The synthetic agent handle that carries the producer identity and the workspace to the verify plane. */
export function producerAgent(cellId: string, workspace: string): { session: { id: string; header: { cwd: string } } } {
  return { session: { id: producerSessionId(cellId), header: { cwd: workspace } } }
}

/** What {@link materializeSplit} needs. */
export interface ActivateDeps {
  /** The adapter: team tools through `executeTool`, delivery through `teamExecutor`. */
  dsh: Pick<DshAdapter, "executeTool" | "teamExecutor">
  /** The workspace root the caller resolved through the adapter. */
  workspace: string
  /** The ACTIVE cell entering the executing phase. */
  cell: CellState
  /** The resolved knobs (contract gates, depth cap). */
  config: CellworkConfig
  /** The captain's live agent handle — the Lead every team write is authorized by. */
  captainAgent: unknown
  /** The measured, ACCEPTED split verdict being materialised. */
  split: SplitVerdict
  /** The roster persona text for one role, or null when the roster service cannot answer. */
  personaFor: (role: string) => string | null
  /** Read the live team record by id, or undefined when the team service cannot answer. */
  recordFor: (teamId: string) => DispatchRecordView | undefined
  /** The instant to journal with. */
  now: Date
}

/** One split task as it landed on the live board. */
export interface ActivatedTask {
  /** The split's key. */
  key: string
  /** The board id the task was minted as (`T3`, …). */
  boardId: string
  /** The task kind. */
  kind: string
  /** The declared owner role. */
  ownerRole: string
  /** The member name that owns it. */
  memberName: string
}

/** One verify loop opened for one code task. */
export interface ActivatedLoop {
  /** The split task key the loop covers. */
  taskKey: string
  /** The board task id. */
  boardId: string
  /** The loop id the verify plane minted. */
  loopId: string
}

/** What a successful activation produced. */
export interface ActivateOutcome {
  /** Absolute paths of the frozen contracts written. */
  contracts: string[]
  /** The member rows this call raised, keyed by board name — the handles the guard resolves against. */
  members: Record<string, CellMemberRecord>
  /** Every task, in creation order. */
  tasks: ActivatedTask[]
  /** Every verify loop opened. */
  loops: ActivatedLoop[]
  /** The owner-only dispatch pass's report. */
  dispatch: DispatchReport
  /** The splitter task closed by this activation, when the board still held it open. */
  splitTaskId?: string
}

/** The activation result: the outcome, or the refusal sentence. */
export type ActivateResult = { ok: true; outcome: ActivateOutcome } | { ok: false; error: string }

/**
 * Order tasks so every blocker is materialised before the task that depends on it.
 *
 * A split may legitimately list a blocker AFTER the blocked task; board creation resolves references
 * against tasks that already exist, so creation order must be topological. Ties keep submission order,
 * which makes the pass deterministic.
 *
 * @param tasks - the split's tasks, in submission order.
 * @returns the same tasks, blockers first.
 */
export function topologicalOrder(tasks: readonly SplitTaskVerdict[]): SplitTaskVerdict[] {
  /** The ordered result. */
  const ordered: SplitTaskVerdict[] = []
  /** The keys already emitted. */
  const emitted = new Set<string>()
  /** The rows by key. */
  const byKey = new Map(tasks.map((task) => [task.key, task]))
  /**
   * Emit one key after its blockers.
   * @param key - the key to emit.
   */
  const emit = (key: string): void => {
    if (emitted.has(key)) return
    /** The row, when the graph holds it. */
    const row = byKey.get(key)
    if (row === undefined) { emitted.add(key); return }
    for (const blocker of row.blockedBy) emit(blocker)
    emitted.add(key)
    ordered.push(row)
  }
  for (const task of tasks) emit(task.key)
  return ordered
}

/**
 * The member's instantiation prompt: its persona, the cell protocol and the tasks it owns.
 *
 * @param deps - the cell, the persona reader and the knobs.
 * @param ownerRole - the role the member was raised for.
 * @param owned - the split tasks that role owns.
 * @returns the prompt text.
 */
export function memberPrompt(deps: Pick<ActivateDeps, "cell" | "personaFor" | "config">, ownerRole: string, owned: readonly SplitTaskVerdict[]): string {
  /** The persona text, when the roster service answered. */
  const persona = deps.personaFor(ownerRole)
  /** One line per owned task: its key and subject. */
  const taskLines = owned.map((task) => "  · " + task.key + " — " + task.subject)
  return [
    ...(persona === null ? [] : [persona, ""]),
    "[mpd-cellwork] You are " + ownerRole + " on cell " + deps.cell.cellId + ".",
    "",
    "OBJECTIVE (the user's own words):",
    deps.cell.objective,
    "",
    "YOUR TASKS on this cell's board (one dispatch message per task will follow):",
    ...taskLines,
    "",
    "PROTOCOL:",
    "1. WAIT for the dispatch message naming your task, then CLAIM it: agent_teams_task {action:\"claim\", task_id}.",
    "2. The dispatch message names the paths you may write. Do not write outside them.",
    "3. Read the frozen contract named in the message before you start; it is what your verifier judges.",
    "4. On completion: agent_teams_task {action:\"complete\", task_id, note:\"<one line>\"}.",
    "5. If you need a user decision, mail the captain; the captain relays the question. Do not guess.",
    "6. If the plugin tells you to CHECKPOINT, call cellwork_handoff and end your turn.",
  ].join("\n")
}

/**
 * Build the review task's acceptance text, naming the frozen contract that carries the loop id.
 *
 * @param task - the review task's verdict row.
 * @param workTask - the work task it reviews.
 * @param cellId - the cell.
 * @returns the task description.
 */
export function reviewTaskDescription(task: SplitTaskVerdict, workTask: SplitTaskVerdict, cellId: string): string {
  /** The contract path, relative to the workspace, that the verifier is handed. */
  const contract = contractRelativePath(cellId, workTask.key)
  return [
    "VERIFY the work task " + JSON.stringify(workTask.key) + " (" + workTask.subject + ") as a BLIND reviewer.",
    "Frozen contract: " + contract + " — read it (and the repository documentation) BEFORE the implementation.",
    "It names the verification loop to bind with `mpd_verify_seat`; the loop was opened at activation.",
    "Then run the gates it lists, and record the verdict with `mpd_verify_record`",
    "(a PASS cites the documents it rests on and the gate evidence ids; a FAIL names each finding and its",
    "document source). You never fix the work: a FAIL bounces it back to its writer as a repair task.",
  ].join("\n")
}

/**
 * Build one code task's frozen acceptance contract.
 *
 * @param deps - the cell, the split and the knobs.
 * @param task - the work task the contract covers.
 * @param reviewer - the review task that will verify it, when one exists.
 * @param boardId - the board id the task was minted as.
 * @returns the markdown document.
 */
export function buildContractDoc(deps: Pick<ActivateDeps, "cell" | "config" | "split">, task: SplitTaskVerdict, reviewer: SplitTaskVerdict | undefined, boardId: string): string {
  /** The gate commands the contract lists. */
  const gates = deps.config.contractGates.length === 0
    ? ["the repository's own declared gates (read the project instruction file: AGENTS.md §4, or its equivalent)"]
    : [...deps.config.contractGates]
  /** The role that will verify this task, when a review task exists. */
  const verifier = reviewer === undefined ? "NO REVIEW TASK — this task's verification is not armed" : reviewer.ownerRole
  return [
    "# Acceptance contract — " + task.key + ": " + task.subject,
    "",
    "Cell: `" + deps.cell.cellId + "` · split revision " + String(deps.split.revision) + " · frozen " + deps.split.submittedAt,
    "Owner: **" + task.ownerRole + "** · Verifier: **" + verifier + "** · Board task: `" + boardId + "`",
    "",
    "## Deliverable",
    task.description,
    "",
    "## Allowed write scopes",
    ...(task.writeScopes.length === 0 ? ["(none declared — this task produces no code)"] : task.writeScopes.map((scope) => "- `" + scope + "`")),
    "",
    "## Acceptance criteria",
    "1. The deliverable above exists, and every changed path is inside the allowed write scopes.",
    "2. The gate commands below pass, with their observed exit codes quoted.",
    "3. The BUILD's claims are re-checked from THIS contract and the documentation, never from the builder's reasoning.",
    "4. A DIFFERENT agent records the verdict (see the verification protocol), citing documents and gate evidence ids.",
    "",
    "## Gate commands",
    ...gates.map((gate) => "- `" + gate + "`"),
    "",
    "## Verification protocol",
    "1. Bind the seat: `mpd_verify_seat {loop_id:<id from this contract's Loop section>}`.",
    "2. Read the documentation band and this contract first; only a RECORDED FAIL makes reading the implementation legitimate.",
    "3. Produce gate evidence and record the verdict: `mpd_verify_record {loop_id, verdict:\"PASS\"|\"FAIL\", sources:[…], evidence_ids:[…]}`.",
    "4. On FAIL, name each finding with the document source that proves it and leave the repair to the writer.",
    "",
    "## Loop",
    "The verification loop is opened at activation; its id is appended below before dispatch.",
  ].join("\n")
}

/**
 * Append the loop id to a contract document, replacing the placeholder line.
 *
 * @param doc - the contract markdown.
 * @param loopId - the loop the verify plane minted.
 * @returns the document with the concrete loop id.
 */
export function withLoopId(doc: string, loopId: string): string {
  return doc.replace("its id is appended below before dispatch.", "`" + loopId + "` (`mpd_verify_seat {loop_id:\"" + loopId + "\"}`).")
}

/**
 * Materialise one accepted split on the live team record.
 *
 * @param deps - the adapter, the cell, the split and the captain's agent.
 * @returns the artifacts created, or the refusal sentence.
 */
export async function materializeSplit(deps: ActivateDeps): Promise<ActivateResult> {
  /** The team id every write addresses; a cell with no team was never staged. */
  const teamId = deps.cell.teamId
  if (teamId === "") return { ok: false, error: "cellwork_activate: no team is recorded on " + deps.cell.cellId + " — run `cellwork_start` first (the planning team is the record activation appends to)" }
  /** One team-plane call; every refusal is surfaced verbatim. */
  const call = async (arguments_: Record<string, unknown>): Promise<{ ok: true; value: Record<string, unknown> } | { ok: false; error: string }> => {
    /** The adapter's normalized answer. */
    const result = await deps.dsh.executeTool({ name: "agent_teams_plan", arguments: arguments_, agent: deps.captainAgent })
    if (!result.ok) return { ok: false, error: typeof result.error === "string" ? result.error : "the agent_teams_plan call failed" }
    return { ok: true, value: typeof result.value === "object" && result.value !== null ? result.value as Record<string, unknown> : {} }
  }
  /** The code tasks: the ones that declare a write scope. */
  const codeTasks = deps.split.tasks.filter((task) => task.writeScopes.length > 0)
  /** The review task that verifies one work key, when one exists. */
  const reviewerOf = (key: string): SplitTaskVerdict | undefined => deps.split.tasks.find((candidate) => candidate.kind === "review" && candidate.blockedBy.includes(key))
  // 1. CONTRACTS, before anything can be dispatched.
  /** The absolute contract paths written, by split key. */
  const contractPaths = new Map<string, string>()
  for (const task of codeTasks) {
    /** The review task that will verify this one, when the split declared one. */
    const reviewer = reviewerOf(task.key)
    /** The contract document. */
    const doc = buildContractDoc(deps, task, reviewer, "");
    /** The absolute path. */
    const path = contractPath(deps.workspace, deps.cell.cellId, task.key)
    atomicWriteText(path, doc + "\n")
    contractPaths.set(task.key, path)
  }
  // 2. MEMBERS: one per distinct owner role, reusing a planning member for a cell role.
  /** The roles already on the cell record, by comparison key. */
  const existingMembers = new Map(Object.values(deps.cell.members).map((member) => [roleKey(member.name), member]))
  /** The roles handled in this pass, by comparison key. */
  const handledRoles = new Set<string>()
  /** The member rows this pass raised, keyed by board name. */
  const newMembers: Record<string, CellMemberRecord> = {}
  for (const task of deps.split.tasks) {
    /** The owner role's comparison key. */
    const key = roleKey(task.ownerRole)
    if (handledRoles.has(key)) continue
    handledRoles.add(key)
    /** The tasks this role owns, for its prompt. */
    const owned = deps.split.tasks.filter((candidate) => roleKey(candidate.ownerRole) === key)
    /** An existing cell member for this role (the planner/splitter, or a re-run). */
    if (existingMembers.has(key)) continue
    /** Whether every task this role owns is a review. */
    const pureVerifier = owned.every((candidate) => candidate.kind === "review")
    /** The member name: the roster role spelling, which is also the board's owner spelling. */
    const name = task.ownerRole.trim()
    /** The member append; the live arm raises the teammate immediately. */
    const added = await call({
      action: "add_member",
      member: { name, role: name, description: name + (pureVerifier ? " (verifier)" : ""), prompt: memberPrompt(deps, name, owned) },
    })
    if (!added.ok) return { ok: false, error: "cellwork_activate could not raise " + JSON.stringify(name) + ": " + added.error }
    /** The handle the raise produced, when the answer carried one. */
    const handle = typeof added.value.spawned === "string" ? added.value.spawned : ""
    if (handle === "") return { ok: false, error: "cellwork_activate raised " + JSON.stringify(name) + " but the answer carried no executor handle" }
    newMembers[name] = { name, role: name, sessionId: handle, executorRef: handle, mode: pureVerifier ? "verifier" : "member", handoffReady: false, handoffs: 0, joinedAt: deps.now.toISOString() }
  }
  // 3. TASKS in dependency order; the board mints the ids every later call addresses.
  /** The board id each split key became. */
  const boardIds = new Map<string, string>()
  /** The tasks as they landed, in creation order. */
  const activated: ActivatedTask[] = []
  for (const task of topologicalOrder(deps.split.tasks)) {
    /** The owner member name (`cell-planner` for a cell role, else the role spelling). */
    const memberName = task.ownerRole.trim()
    /** The mapped blockers: keys already minted become board ids; a cell role is not a task so none remain. */
    const mappedBlockers = task.blockedBy.map((reference) => boardIds.get(reference) ?? reference)
    /** The task's description; a review task additionally names its frozen contract. */
    const description = task.kind === "review"
      ? reviewTaskDescription(task, deps.split.tasks.find((candidate) => candidate.key === task.blockedBy[0]) ?? task, deps.cell.cellId)
      : task.description
    /** The live append. */
    const appended = await call({
      action: "create_task",
      task: {
        subject: task.subject,
        description,
        kind: task.kind,
        owner: memberName,
        ...(task.writeScopes.length === 0 ? {} : { write_scopes: [...task.writeScopes] }),
        blocked_by: mappedBlockers,
      },
    })
    if (!appended.ok) return { ok: false, error: "cellwork_activate could not append task " + JSON.stringify(task.key) + ": " + appended.error }
    /** The board row the append minted. */
    const row = typeof appended.value.task === "object" && appended.value.task !== null ? appended.value.task as Record<string, unknown> : undefined
    /** The minted board id. */
    const boardId = typeof row?.id === "string" ? row.id : ""
    if (boardId === "") return { ok: false, error: "cellwork_activate appended task " + JSON.stringify(task.key) + " but the answer carried no board id" }
    boardIds.set(task.key, boardId)
    activated.push({ key: task.key, boardId, kind: task.kind, ownerRole: task.ownerRole, memberName })
  }
  // 4. VERIFY LOOPS, before dispatch: a verdict with no armed loop is a verdict nobody checks.
  /** The loops opened. */
  const loops: ActivatedLoop[] = []
  for (const task of codeTasks) {
    /** The board id the task minted. */
    const boardId = boardIds.get(task.key) ?? ""
    if (boardId === "") continue
    /** The relative contract path the loop freezes. */
    const contract = contractRelativePath(deps.cell.cellId, task.key)
    /** The loop-open call, under the declared producer identity (see the file header). */
    const opened = await deps.dsh.executeTool({
      name: "mpd_verify_open",
      arguments: { writer: "delegate", contract, scope: [...task.writeScopes], task_id: boardId },
      agent: producerAgent(deps.cell.cellId, deps.workspace),
    })
    if (!opened.ok) return { ok: false, error: "cellwork_activate could not open the verify loop for " + JSON.stringify(task.key) + ": " + String(opened.error) }
    /** The loop tool's structured answer. */
    const value = typeof opened.value === "object" && opened.value !== null ? opened.value as Record<string, unknown> : {}
    if (typeof value.refused === "string") return { ok: false, error: "cellwork_activate was REFUSED a verify loop for " + JSON.stringify(task.key) + ": " + value.refused }
    /** The minted loop id. */
    const loopId = typeof value.loopId === "string" ? value.loopId : ""
    if (loopId === "") return { ok: false, error: "cellwork_activate opened no loop id for " + JSON.stringify(task.key) + " — refusing to dispatch unarmed work" }
    loops.push({ taskKey: task.key, boardId, loopId })
    /** The contract path this task's document lives at. */
    const path = contractPaths.get(task.key)
    if (path !== undefined) {
      /** The stored document, so the loop id is appended to what the verifier reads. */
      const stored = buildContractDoc(deps, task, reviewerOf(task.key), boardId)
      atomicWriteText(path, withLoopId(stored, loopId) + "\n")
      // The task's own description was built before the board id existed; the contract is the authority
      // the verifier reads, and it now names the loop.
    }
  }
  // 5. DISPATCH, owner-only, after the loops exist.
  /** The live record, re-read after every append. */
  const record = deps.recordFor(teamId)
  /** The delivery binding, when this composition exposes the team executor. */
  const send = sendThroughExecutor(deps.dsh.teamExecutor(), deps.captainAgent)
  /** The dispatch report (or the refusal when no executor seam exists). */
  const dispatch: DispatchReport = send === undefined
    ? { pairs: [], skipped: [], refused: "the team executor seam is absent, so no member can be woken — the board is materialised and ready for a manual `cellwork_dispatch`" }
    : await dispatchOwnerOnly({ workspace: deps.workspace, cell: deps.cell, record, send, now: deps.now })
  // THE SPLIT TASK CLOSES HERE, not on acceptance: it stayed open through a requirements update so the
  // SAME row could be re-dispatched, and materialisation is the moment its work is done.
  /** The splitter's board row, when it is still open. */
  const splitterRow = (record?.tasks ?? []).find((task) => roleKey(String(task.owner ?? "")) === roleKey("cell-splitter") && task.status !== "completed" && task.status !== "failed" && task.status !== "cancelled")
  /** The id of that row. */
  const splitTaskId = String(splitterRow?.id ?? "")
  if (splitTaskId !== "") {
    await deps.dsh.executeTool({ name: "agent_teams_task", arguments: { action: "complete", task_id: splitTaskId, note: "split revision " + String(deps.split.revision) + " materialised by activation" }, agent: deps.captainAgent })
  }
  appendJournal(deps.workspace, deps.cell.cellId, {
    event: "activate",
    teamId,
    splitRevision: deps.split.revision,
    tasks: activated.map((task) => ({ key: task.key, boardId: task.boardId, owner: task.memberName, kind: task.kind })),
    contracts: [...contractPaths.values()],
    loops: loops.map((loop) => ({ taskKey: loop.taskKey, loopId: loop.loopId })),
    dispatched: dispatch.pairs.length,
    skipped: dispatch.skipped.length,
    ...(splitTaskId === "" ? {} : { splitTaskId }),
  }, deps.now)
  return { ok: true, outcome: { contracts: [...contractPaths.values()], members: newMembers, tasks: activated, loops, dispatch, ...(splitTaskId === "" ? {} : { splitTaskId }) } }
}
