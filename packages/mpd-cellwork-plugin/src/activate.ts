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
// rather than a second team: work the new revision KEEPS reuses the board row it already has, work the
// new revision ADDS is appended (member, task, contract, verify loop), and work the revision DROPS is
// marked CANCELLED on the cell record (`CellState.cancelledTasks`) — never deleted. The team-plane verbs
// this build has cannot cancel a row, so the cell record is where that fact lives and `cellwork_dispatch`
// is what refuses to wake a cancelled row.
//
// THE PRODUCER OF A VERIFY LOOP IS THE CAPTAIN'S LIVE SESSION. `mpd_verify_open` is opened with the
// CALLER's own agent handle (threaded in as `captainAgent`), and it is the ONE `mpd_verify_*` name the
// cellwork guard allows the captain — the rest stay refused, so opening a loop arms work the captain can
// never bind or verdict. The cell id survives only as DATA on the frozen contract (`producer:
// cellwork:<cellId>`) and in the journal, never as a fabricated session. A dispatch that carries no live
// caller agent refuses before anything is written.
//
// RESUMPTION IS THE FAILURE CONTRACT (P1 A2/A3). Every artifact this pass creates is recorded on the
// cell record through `ActivateDeps.checkpoint` as soon as it exists, and a failure after the first
// mutation returns a structured partial. A retry of the SAME accepted revision seeds its members from
// the live roster, its board ids from `CellState.activatedTasks` and its loops from
// `CellState.activatedLoops`, so nothing is raised, minted or armed twice: the only remaining window is
// a crash between one artifact and its checkpoint write, and the retry reconciles that artifact from the
// live roster/state instead of failing on a duplicate.
import { atomicWriteText, appendJournal, contractPath, type CellMemberRecord, type CellState } from "./state"
import type { CellworkConfig } from "./config"
import type { SplitTaskVerdict, SplitVerdict } from "./split"
import { roleKey } from "./split"
import { contractRelativePath, dispatchOwnerOnly, sendThroughExecutor, type DispatchMemberView, type DispatchRecordView, type DispatchReport } from "./dispatch"
import type { DshAdapter } from "../../mpd-dsh-adapter-plugin/src/index"

/** The DECLARED producer identity, recorded as DATA on the frozen contract and in the journal. */
export function producerIdentity(cellId: string): string {
  return "cellwork:" + cellId
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
  /**
   * Persist the partial artifacts after EACH one is created (contract A2).
   *
   * Called once per contract written, member ensured, task minted and verify loop opened, so a crash
   * leaves at most ONE artifact unrecorded. The caller owns the shape it writes (the cell record, under
   * `cell-activation-partial`).
   */
  checkpoint: (partial: ActivatePartial) => void
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
  /** `initial` for the first materialisation, `resplit` when a new revision appended to the same team. */
  mode: "initial" | "resplit"
  /** Absolute paths of the frozen contracts written (empty on a re-split that adds no code task). */
  contracts: string[]
  /** The member rows this call ENSURED, keyed by board name — the handles the guard resolves against. */
  members: Record<string, CellMemberRecord>
  /** The board names this pass REUSED from the cell record or the live roster instead of raising. */
  reused: string[]
  /** Every task, in creation order (only the rows this call minted). */
  tasks: ActivatedTask[]
  /** The board id every split key of THIS revision is materialised as, kept keys included. */
  boardIds: Record<string, string>
  /** The split keys this call REUSED a live board row for (the previous revision already had them). */
  kept: string[]
  /** The rows a new revision DROPPED, marked cancelled on the cell record and never deleted. */
  cancelled: Array<{ key: string; boardId: string }>
  /** Every verify loop opened. */
  loops: ActivatedLoop[]
  /** The owner-only dispatch pass's report. */
  dispatch: DispatchReport
  /** The splitter task closed by this activation, when the board still held it open. */
  splitTaskId?: string
}

/**
 * The artifacts one activation pass created before it failed (contract A2).
 *
 * The caller persists this on the cell record under `cell-activation-partial`, and a retry of the SAME
 * accepted revision reuses every entry instead of re-raising a member, re-minting a task or re-opening a
 * loop.
 */
export interface ActivatePartial {
  /** The members ensured so far, keyed by board name (raised, or resolved from the live roster). */
  members: Record<string, CellMemberRecord>
  /** The board ids minted so far, by split key. */
  boardIds: Record<string, string>
  /** The verify-loop ids opened so far, by split key. */
  loopIds: Record<string, string>
  /** The frozen contract paths written so far, by split key. */
  contracts: Record<string, string>
}

/** The activation result: the outcome, or the refusal sentence plus the partial once anything was written. */
export type ActivateResult =
  | { ok: true; outcome: ActivateOutcome }
  | { ok: false; error: string; partial?: ActivatePartial }

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
    "producer: " + producerIdentity(deps.cell.cellId),
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
 * @param deps - the adapter, the cell, the split, the captain's agent and the partial checkpoint.
 * @returns the artifacts created, or the refusal sentence plus the partial it may resume from.
 */
export async function materializeSplit(deps: ActivateDeps): Promise<ActivateResult> {
  /** The team id every write addresses; a cell with no team was never staged. */
  const teamId = deps.cell.teamId
  if (teamId === "") return { ok: false, error: "cellwork_activate: no team is recorded on " + deps.cell.cellId + " — run `cellwork_start` first (the planning team is the record activation appends to)" }
  /** The partial artifacts this pass produced, in the shape the caller persists. */
  const partial: ActivatePartial = { members: {}, boardIds: {}, loopIds: {}, contracts: {} }
  /** Whether anything has been written yet: before that, a failure has nothing to resume from. */
  let mutated = false
  /** A fresh copy of the partial, so a persisted checkpoint can never alias a later mutation. */
  const snapshot = (): ActivatePartial => ({ members: { ...partial.members }, boardIds: { ...partial.boardIds }, loopIds: { ...partial.loopIds }, contracts: { ...partial.contracts } })
  /** Record the partial after one artifact, then keep going. */
  const checkpoint = (): void => { mutated = true; deps.checkpoint(snapshot()) }
  /** The failure arm: the sentence, plus the partial once anything was written. */
  const fail = (error: string): ActivateResult => ({ ok: false, error, ...(mutated ? { partial: snapshot() } : {}) })
  /** A message from an unknown thrown value, without assuming it is an Error. */
  const errorText = (error: unknown): string => error instanceof Error ? error.message : String(error)
  /** One team-plane call; every refusal is surfaced verbatim, and a throw becomes a refusal. */
  const call = async (arguments_: Record<string, unknown>): Promise<{ ok: true; value: Record<string, unknown> } | { ok: false; error: string }> => {
    try {
      /** The adapter's normalized answer. */
      const result = await deps.dsh.executeTool({ name: "agent_teams_plan", arguments: arguments_, agent: deps.captainAgent })
      if (!result.ok) return { ok: false, error: typeof result.error === "string" ? result.error : "the agent_teams_plan call failed" }
      return { ok: true, value: typeof result.value === "object" && result.value !== null ? result.value as Record<string, unknown> : {} }
    } catch (error) {
      return { ok: false, error: errorText(error) }
    }
  }
  /** The review task that verifies one work key, when one exists. */
  const reviewerOf = (key: string): SplitTaskVerdict | undefined => deps.split.tasks.find((candidate) => candidate.kind === "review" && candidate.blockedBy.includes(key))
  // 0. THE DELTA: what this revision keeps, adds and drops, decided before anything is written.
  /** `initial` for the first materialisation, `resplit` when the team already carries a revision. */
  const mode: "initial" | "resplit" = deps.cell.activatedRevision === null ? "initial" : "resplit"
  /** The board ids the PREVIOUS activation minted, by split key — the resume seed for a kept task. */
  const previous = new Map(Object.entries(deps.cell.activatedTasks))
  /** The split keys this revision KEEPS: the previous activation already materialised a row for them. */
  const keptKeys = new Set(deps.split.tasks.filter((task) => previous.has(task.key)).map((task) => task.key))
  /** The keys this revision DROPS, minus the ones an earlier activation already cancelled. */
  const droppedKeys = [...previous.keys()].filter((key) => !keptKeys.has(key) && deps.cell.cancelledTasks[key] === undefined)
  /** The split tasks this call must materialise — everything the previous revision did not already have. */
  const fresh = deps.split.tasks.filter((task) => !keptKeys.has(task.key))
  /** The code tasks among them, which are the ones a contract is written for. */
  const freshCode = fresh.filter((task) => task.writeScopes.length > 0)
  /** The live team record as it stands, when the team service can answer. */
  let live: DispatchRecordView | undefined
  try { live = deps.recordFor(teamId) } catch { live = undefined }
  /** The live roster by comparison key, so a member raised before a crash stays resolvable. */
  const liveRoster = new Map<string, DispatchMemberView>()
  for (const row of live?.members ?? []) if (typeof row.name === "string" && row.name !== "") liveRoster.set(roleKey(row.name), row)
  /** The roles already on the cell record, by comparison key. */
  const existingMembers = new Map<string, CellMemberRecord>(Object.values(deps.cell.members).map((member) => [roleKey(member.name), member]))
  // THE LIVE ROSTER IS THE SECOND SEED (contract A3): a member can exist on the team record while the
  // cell record has no row for it (a crash between `add_member` and its checkpoint). The live
  // `executorRef` is the fresher handle, so it wins over a remembered one.
  for (const [key, row] of liveRoster) {
    /** The row already on the cell record, when there is one. */
    const remembered = existingMembers.get(key)
    /** The live executor handle, when the record carries one. */
    const executorRef = typeof row.executorRef === "string" ? row.executorRef : ""
    /** The member name the team record spells. */
    const name = typeof row.name === "string" ? row.name : key
    /** The tasks this role owns in the accepted split, which decide its mode on the cell record. */
    const owned = deps.split.tasks.filter((task) => roleKey(task.ownerRole) === key)
    existingMembers.set(key, remembered === undefined
      ? { name, role: typeof row.role === "string" ? row.role : "", sessionId: executorRef, executorRef, mode: owned.length > 0 && owned.every((task) => task.kind === "review") ? "verifier" : "member", handoffReady: false, handoffs: 0, joinedAt: deps.now.toISOString() }
      : { ...remembered, sessionId: executorRef === "" ? remembered.sessionId : executorRef, executorRef: executorRef === "" ? remembered.executorRef : executorRef })
  }
  // 1. CONTRACTS, before anything can be dispatched. A KEPT task's contract is deliberately NOT
  // rewritten: it is frozen, and a verifier may already be reading it.
  for (const task of freshCode) {
    /** The review task that will verify this one, when the split declared one. */
    const reviewer = reviewerOf(task.key)
    /** The contract document. */
    const doc = buildContractDoc(deps, task, reviewer, "")
    /** The absolute path. */
    const path = contractPath(deps.workspace, deps.cell.cellId, task.key)
    try {
      atomicWriteText(path, doc + "\n")
    } catch (error) {
      return fail("cellwork_activate could not write the contract for " + JSON.stringify(task.key) + ": " + errorText(error))
    }
    partial.contracts[task.key] = path
    checkpoint()
  }
  // 2. MEMBERS: one per distinct owner role, REUSING a planning member, a recorded member or a live
  // roster row instead of raising a second one.
  /** The roles handled in this pass, by comparison key. */
  const handledRoles = new Set<string>()
  /** The member rows this pass ensured, keyed by board name. */
  const newMembers: Record<string, CellMemberRecord> = {}
  /** The board names this pass reused instead of raising. */
  const reused: string[] = []
  for (const task of fresh) {
    /** The owner role's comparison key. */
    const key = roleKey(task.ownerRole)
    if (handledRoles.has(key)) continue
    handledRoles.add(key)
    /** The tasks this role owns, for its prompt. */
    const owned = deps.split.tasks.filter((candidate) => roleKey(candidate.ownerRole) === key)
    /** Something already answers for this role: the cell record or the live roster. */
    const existing = existingMembers.get(key)
    if (existing !== undefined) {
      reused.push(existing.name)
      // A LIVE-ROSTER row the CELL record never learned is persisted now, so the guard and the dispatch
      // pass see the same member; one the cell already records is left exactly as it was.
      if (deps.cell.members[existing.name] === undefined) {
        newMembers[existing.name] = existing
        partial.members = { ...partial.members, ...newMembers }
        checkpoint()
      }
      continue
    }
    /** Whether every task this role owns is a review. */
    const pureVerifier = owned.every((candidate) => candidate.kind === "review")
    /** The member name: the roster role spelling, which is also the board's owner spelling. */
    const name = task.ownerRole.trim()
    /** The member append; the live arm raises the teammate immediately. */
    const added = await call({
      action: "add_member",
      member: { name, role: name, description: name + (pureVerifier ? " (verifier)" : ""), prompt: memberPrompt(deps, name, owned) },
    })
    if (!added.ok) {
      // A DUPLICATE IS A RECONCILIATION, NOT A FAILURE (contract A3): the member exists on the live
      // roster but was not visible to the seed read, so its handle is resolved from a fresh read.
      if (added.error.includes("is already on the roster")) {
        /** The live record as it stands NOW, when it can be read. */
        let refreshed: DispatchRecordView | undefined
        try { refreshed = deps.recordFor(teamId) } catch { refreshed = undefined }
        /** The live row that already holds the name. */
        const row = (refreshed?.members ?? []).find((candidate) => roleKey(String(candidate.name ?? "")) === key)
        if (row !== undefined) {
          /** Its live executor handle. */
          const executorRef = typeof row.executorRef === "string" ? row.executorRef : ""
          /** Its board name, spelled the way the roster spells it. */
          const liveName = String(row.name)
          newMembers[liveName] = { name: liveName, role: name, sessionId: executorRef, executorRef, mode: pureVerifier ? "verifier" : "member", handoffReady: false, handoffs: 0, joinedAt: deps.now.toISOString() }
          reused.push(liveName)
          partial.members = { ...partial.members, ...newMembers }
          checkpoint()
          continue
        }
      }
      return fail("cellwork_activate could not raise " + JSON.stringify(name) + ": " + added.error)
    }
    /** The handle the raise produced, when the answer carried one. */
    const handle = typeof added.value.spawned === "string" ? added.value.spawned : ""
    if (handle === "") return fail("cellwork_activate raised " + JSON.stringify(name) + " but the answer carried no executor handle")
    newMembers[name] = { name, role: name, sessionId: handle, executorRef: handle, mode: pureVerifier ? "verifier" : "member", handoffReady: false, handoffs: 0, joinedAt: deps.now.toISOString() }
    partial.members = { ...partial.members, ...newMembers }
    checkpoint()
  }
  // 3. TASKS in dependency order; the board mints the ids every later call addresses. A KEPT key keeps
  // the id it was minted with — the live row is reused, never duplicated.
  /** The board id each split key is materialised as: the kept rows first, the new ones as they mint. */
  const boardIds = new Map<string, string>()
  for (const key of keptKeys) {
    /** The id the previous activation minted for that key. */
    const id = previous.get(key)
    if (id !== undefined && id !== "") boardIds.set(key, id)
  }
  /** The tasks as they landed, in creation order. */
  const activated: ActivatedTask[] = []
  for (const task of topologicalOrder(fresh)) {
    /** The owner member name (`cell-planner` for a cell role, else the role spelling). */
    const memberName = task.ownerRole.trim()
    /** The mapped blockers: keys already minted become board ids; a cell role is not a task so none remain. */
    const mappedBlockers = task.blockedBy.map((reference) => boardIds.get(reference) ?? previous.get(reference) ?? reference)
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
    if (!appended.ok) return fail("cellwork_activate could not append task " + JSON.stringify(task.key) + ": " + appended.error)
    /** The board row the append minted. */
    const row = typeof appended.value.task === "object" && appended.value.task !== null ? appended.value.task as Record<string, unknown> : undefined
    /** The minted board id. */
    const boardId = typeof row?.id === "string" ? row.id : ""
    if (boardId === "") return fail("cellwork_activate appended task " + JSON.stringify(task.key) + " but the answer carried no board id")
    boardIds.set(task.key, boardId)
    activated.push({ key: task.key, boardId, kind: task.kind, ownerRole: task.ownerRole, memberName })
    partial.boardIds[task.key] = boardId
    checkpoint()
  }
  // 4. VERIFY LOOPS, before dispatch: a verdict with no armed loop is a verdict nobody checks. The
  // condition is `activatedLoops`, NOT `freshCode` (contract A3): a KEPT task whose loop the failing
  // pass never opened is exactly the VEdit wedge, and a loop that already exists is never re-armed.
  /** Every verify loop this revision already has, by split key: the ones a recorded pass armed. */
  const loopIds = new Map<string, string>(Object.entries(deps.cell.activatedLoops ?? {}))
  /** The loops THIS pass opens, as the outcome reports them (a recorded loop is never re-armed). */
  const loops: ActivatedLoop[] = []
  /** Every split task that needs a loop (a task with no write scope produces no code to verify). */
  const codeTasks = deps.split.tasks.filter((task) => task.writeScopes.length > 0)
  for (const task of codeTasks) {
    if (loopIds.has(task.key)) continue
    /** The board id this task was materialised as. */
    const boardId = boardIds.get(task.key) ?? ""
    if (boardId === "") return fail("cellwork_activate has no board id for " + JSON.stringify(task.key) + " — refusing to open a verify loop for a row that is not on the board")
    /** The relative contract path the loop freezes. */
    const contract = contractRelativePath(deps.cell.cellId, task.key)
    /** The loop-open call, under the CAPTAIN'S OWN agent (contract A4). */
    let opened: { ok: boolean; value?: unknown; error?: unknown }
    try {
      opened = await deps.dsh.executeTool({
        name: "mpd_verify_open",
        arguments: { writer: "delegate", contract, scope: [...task.writeScopes], task_id: boardId },
        agent: deps.captainAgent,
      })
    } catch (error) {
      return fail("cellwork_activate could not open the verify loop for " + JSON.stringify(task.key) + ": " + errorText(error))
    }
    if (!opened.ok) return fail("cellwork_activate could not open the verify loop for " + JSON.stringify(task.key) + ": " + String(opened.error))
    /** The loop tool's structured answer. */
    const value = typeof opened.value === "object" && opened.value !== null ? opened.value as Record<string, unknown> : {}
    if (typeof value.refused === "string") return fail("cellwork_activate was REFUSED a verify loop for " + JSON.stringify(task.key) + ": " + value.refused)
    /** The minted loop id. */
    const loopId = typeof value.loopId === "string" ? value.loopId : ""
    if (loopId === "") return fail("cellwork_activate opened no loop id for " + JSON.stringify(task.key) + " — refusing to dispatch unarmed work")
    loopIds.set(task.key, loopId)
    loops.push({ taskKey: task.key, boardId, loopId })
    partial.loopIds[task.key] = loopId
    // THE FROZEN CONTRACT NAMES THE LOOP (the existing `withLoopId` path). The path is DERIVED, not
    // remembered: on a resume the contract was written by the pass that crashed, before the loop existed.
    const path = partial.contracts[task.key] ?? contractPath(deps.workspace, deps.cell.cellId, task.key)
    /** The stored document, so the loop id is appended to what the verifier reads. */
    const stored = buildContractDoc(deps, task, reviewerOf(task.key), boardId)
    try {
      atomicWriteText(path, withLoopId(stored, loopId) + "\n")
    } catch (error) {
      return fail("cellwork_activate could not rewrite the contract for " + JSON.stringify(task.key) + ": " + errorText(error))
    }
    checkpoint()
  }
  // THE DISPATCH GATE (contract A3): only after EVERY task has a board id and EVERY code task has a loop
  // id may the owners be woken — a dispatch that skips a loop is the disarmament this repair removes.
  for (const task of deps.split.tasks) {
    if ((boardIds.get(task.key) ?? "") === "") return fail("cellwork_activate has no board id for " + JSON.stringify(task.key) + " — refusing to dispatch")
    if (task.writeScopes.length > 0 && (loopIds.get(task.key) ?? "") === "") return fail("cellwork_activate has no verify loop for " + JSON.stringify(task.key) + " — refusing to dispatch unarmed work")
  }
  // 4b. CANCELLATION: work this revision dropped is marked on the cell record and journaled, never
  // deleted. The team plane carries the fact and the dispatch pass below refuses to wake those ids.
  /** The rows marked cancelled by this activation. */
  const cancelled: Array<{ key: string; boardId: string }> = []
  for (const key of droppedKeys) {
    /** The board id the dropped key was materialised as. */
    const boardId = previous.get(key) ?? ""
    cancelled.push({ key, boardId })
    appendJournal(deps.workspace, deps.cell.cellId, { event: "task-cancelled", key, boardId, revision: deps.split.revision, reason: "the accepted split no longer carries this task; the board row is kept and dispatch skips it" }, deps.now)
  }
  // 5. DISPATCH, owner-only, after the loops exist. A throw from this stage is a PARTIAL, not a wedge.
  /** The dispatch report the outcome carries. */
  let dispatch: DispatchReport
  /** The live record, re-read after the appends; the splitter's row is closed through it below. */
  let record: DispatchRecordView | undefined
  try {
    record = deps.recordFor(teamId)
    /** The delivery binding, when this composition exposes the team executor. */
    const send = sendThroughExecutor(deps.dsh.teamExecutor(), deps.captainAgent)
    /** The board ids this cell will never dispatch: every row cancelled before, plus this revision's. */
    const excludedTaskIds = [...Object.values(deps.cell.cancelledTasks), ...cancelled.map((entry) => entry.boardId)].filter((id) => id !== "")
    // THE DISPATCH SEES THE MAPPING IT JUST MINTED. The cell record passed in predates this activation,
    // so its `activatedTasks` is the PREVIOUS revision's map; the dispatch message resolves each board id
    // back to its split key through it (Amendment 6 R1), so the pass is handed the map as of THIS revision.
    /** The cell view the dispatch pass reads: the recorded cell with this revision's key→board id mapping. */
    const cellForDispatch: CellState = { ...deps.cell, activatedTasks: Object.fromEntries(boardIds) }
    dispatch = send === undefined
      ? { pairs: [], skipped: [], refused: "the team executor seam is absent, so no member can be woken — the board is materialised and ready for a manual `cellwork_dispatch`" }
      : await dispatchOwnerOnly({ workspace: deps.workspace, cell: cellForDispatch, record, send, excludedTaskIds, now: deps.now })
  } catch (error) {
    return fail("cellwork_activate could not dispatch: " + errorText(error))
  }
  // THE SPLIT TASK CLOSES HERE, not on acceptance: it stayed open through a requirements update so the
  // SAME row could be re-dispatched, and materialisation is the moment its work is done.
  /** The splitter's board row, when it is still open. */
  const splitterRow = (record?.tasks ?? []).find((task) => roleKey(String(task.owner ?? "")) === roleKey("cell-splitter") && task.status !== "completed" && task.status !== "failed" && task.status !== "cancelled")
  /** The id of that row. */
  const splitTaskId = String(splitterRow?.id ?? "")
  if (splitTaskId !== "") {
    try {
      await deps.dsh.executeTool({ name: "agent_teams_task", arguments: { action: "complete", task_id: splitTaskId, note: "split revision " + String(deps.split.revision) + " materialised by activation" }, agent: deps.captainAgent })
    } catch {
      // Best-effort closure: the board is already materialised and dispatched, so a throw here must not
      // turn a successful activation into a failure.
    }
  }
  appendJournal(deps.workspace, deps.cell.cellId, {
    event: "activate",
    teamId,
    mode,
    splitRevision: deps.split.revision,
    producer: producerIdentity(deps.cell.cellId),
    tasks: activated.map((task) => ({ key: task.key, boardId: task.boardId, owner: task.memberName, kind: task.kind })),
    kept: [...keptKeys],
    cancelled,
    contracts: Object.values(partial.contracts),
    loops: loops.map((loop) => ({ taskKey: loop.taskKey, loopId: loop.loopId })),
    reused,
    dispatched: dispatch.pairs.length,
    skipped: dispatch.skipped.length,
    ...(splitTaskId === "" ? {} : { splitTaskId }),
  }, deps.now)
  return {
    ok: true,
    outcome: {
      mode,
      contracts: Object.values(partial.contracts),
      members: { ...newMembers },
      reused: [...reused],
      tasks: activated,
      boardIds: Object.fromEntries(boardIds),
      kept: [...keptKeys],
      cancelled,
      loops,
      dispatch,
      ...(splitTaskId === "" ? {} : { splitTaskId }),
    },
  }
}
