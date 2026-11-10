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
// RESUMPTION IS THE FAILURE CONTRACT (P1 A2/A3, C8). Each artifact this pass creates is journaled as
// ONE compact progress row through `ActivateDeps.progress`; the FULL partial is handed back with the
// failure and persisted ONCE by the caller, so a pass cannot flood the journal with whole-state rows
// (defect D7). A retry of the SAME accepted revision seeds its members from the live roster, its board
// ids from `CellState.activatedTasks` and its loops from `CellState.activatedLoops`, so nothing is
// raised, minted or armed twice: the only remaining window is a crash between one artifact and the
// failure snapshot, and the retry reconciles that artifact from the live roster/state instead of
// failing on a duplicate.
import { existsSync, readFileSync } from "node:fs"
import { atomicWriteText, appendJournal, contractPath, resolveCellTeam, type BoardTeamService, type CellMemberRecord, type CellState } from "./state"
import type { CellworkConfig } from "./config"
import type { SplitTaskVerdict, SplitVerdict } from "./split"
import { roleKey } from "./split"
import { contractRelativePath, type DispatchMemberView, type DispatchRecordView, type DispatchReport } from "./dispatch"
import type { TeamActionsServiceView } from "./caller"
import type { DshAdapter } from "../../mpd-dsh-adapter-plugin/src/index"
import { findSplitTicket } from "./staging"
import { growExecutionSeats, type SeatGrowthResult } from "./elastic"

/**
 * The placeholder sentence a frozen contract carries until {@link withLoopId} replaces it.
 *
 * Its ABSENCE from an existing contract file is the durable evidence that the task is already armed: a
 * record written before `CellState.activatedLoops` existed cannot say so itself.
 */
const CONTRACT_LOOP_PLACEHOLDER = "The verification loop is opened at activation; its id is appended below before dispatch."

/** The DECLARED producer identity, recorded as DATA on the frozen contract and in the journal. */
export function producerIdentity(cellId: string): string {
  return "cellwork:" + cellId
}

/**
 * One COMPACT per-artifact progress row of an activation pass (contract C8).
 *
 * The row carries the artifact's identity and its place in the pass, never the accumulated state: the
 * whole-state snapshot is persisted ONCE, when a pass fails, so a single activation cannot flood the
 * journal with re-serialised state (defect D7).
 */
export interface ActivateProgress {
  /** The stage the artifact belongs to. */
  stage: "contract" | "member" | "task" | "loop"
  /** The artifact's key: a split key, or the member name for a member artifact. */
  key: string
  /** 1-based position of this artifact in the whole pass. */
  ordinal: number
  /** How many artifacts this pass is expected to produce in total. */
  total: number
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
  recordFor: (teamId: string) => Record<string, unknown> | undefined
  /**
   * The team service, for the §7.1 board resolution.
   *
   * OPTIONAL for an older wiring: absent means the resolution falls back to `recordFor`'s fast path,
   * which is today's behaviour — never a refused activation.
   */
  teams?: () => BoardTeamService | undefined
  /**
   * The canonical roster role names, for runtime seat growth (§4.1).
   *
   * OPTIONAL like {@link ActivateDeps.teams}: absent falls back to the role spellings the cell and team
   * rows already record, confirmed through `personaFor` — a declared execution role still grows, and a
   * non-roster base is still refused.
   */
  rosterRoles?: () => readonly string[]
  /**
   * The TEAM-PLANE write surface, probed per call.
   *
   * The plane OWNS dispatch pairing and cancellation (wave W2-D): this pass asks it for one owner-only
   * pass and closes the rows the split dropped through it. Absent means a composition without the team
   * row, which the dispatch stage reports instead of guessing.
   */
  teamActions: () => TeamActionsServiceView | undefined
  /**
   * Journal ONE compact progress row per artifact as it is created (contract C8).
   *
   * `stage` names what was created, `key` the artifact, and `ordinal`/`total` place it in the pass. The
   * FULL partial is NOT persisted here: the caller records it once, when the pass FAILS, so a pass cannot
   * flood the journal with whole-state rows (defect D7). Every row the caller writes for this pass is
   * stamped with {@link ActivateDeps.now}, so the journal stays monotonic.
   */
  progress: (step: ActivateProgress) => void
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
  /**
   * The statement a RE-SPLIT owes its captain (C5/D4), absent on an initial activation.
   *
   * WHY IT EXISTS: keeping a live board row and NOT rewriting its frozen contract is deliberate, but a
   * result that only carries counts reads as "the whole split was materialised", so a captain plans a
   * scope expansion against a contract that allows no such path. This field says, in words: how many were
   * kept, that their contracts are not rewritten, what a scope expansion therefore needs, that this
   * activation already dispatched owner-only, and the one stage-4 exception where a kept contract IS rebuilt.
   */
  notice?: string
  /**
   * The team the EXECUTION board landed on, when it differs from the record's previous `teamId` (§7.1).
   *
   * The caller persists it as the cell's `teamId`; absent means the record already names the right team.
   */
  teamId?: string
  /**
   * The staging team id preserved when {@link ActivateOutcome.teamId} replaced it (§7.1).
   *
   * Travels WITH `teamId` only: a record whose ids agree needs no rewrite.
   */
  planningTeamId?: string
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
 * The board member one split task resolves to (contract C1).
 *
 * A declared `member` names the board member directly and lets several members share one `ownerRole`
 * (real parallelism); without one, the role spelling IS the member, which is the pre-C1 behaviour.
 *
 * @param task - the accepted split task.
 * @returns the member name, trimmed; the role spelling when no member is declared.
 */
export function resolvedMemberName(task: SplitTaskVerdict): string {
  /** The declared member, when the graph validator accepted one. */
  const declared = (task.member ?? "").trim()
  return declared === "" ? task.ownerRole.trim() : declared
}

/**
 * The member's instantiation prompt: its persona, the cell protocol and the tasks it owns.
 *
 * @param deps - the cell, the persona reader and the knobs.
 * @param memberName - the board member name the teammate is raised as.
 * @param ownerRole - the role the member was raised for (its persona and routing label).
 * @param owned - the split tasks that member owns.
 * @returns the prompt text.
 */
export function memberPrompt(deps: Pick<ActivateDeps, "cell" | "personaFor" | "config">, memberName: string, ownerRole: string, owned: readonly SplitTaskVerdict[]): string {
  /** The persona text, when the roster service answered. */
  const persona = deps.personaFor(ownerRole)
  /** One line per owned task: its key and subject. */
  const taskLines = owned.map((task) => "  · " + task.key + " — " + task.subject)
  return [
    ...(persona === null ? [] : [persona, ""]),
    "[mpd-cellwork] You are " + memberName + " (" + ownerRole + ") on cell " + deps.cell.cellId + ".",
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
 * The statement a re-split owes its captain (C5/D4): what was kept, what that costs, and what ran.
 *
 * Written as ONE sentence chain rather than a structured object because its consumer is a MODEL reading a
 * tool result: a captain must not have to infer any of these four facts from counts.
 *
 * @param keptCount - how many split keys reused a live board row.
 * @param dispatched - how many owner-only pairs this activation's dispatch pass delivered.
 * @param rebuiltKept - the kept keys whose contract had to be rebuilt because their loop was never recorded.
 * @returns the notice text.
 */
function resplitNotice(keptCount: number, dispatched: number, rebuiltKept: readonly string[]): string {
  /** The stage-4 exception, named with its keys when any kept task hit it. */
  const exception = rebuiltKept.length === 0
    ? "Stage-4 exception: a kept task whose loop was never recorded is the ONLY case where a kept contract is rebuilt, gaining its verify loop id."
    : "Stage-4 exception: " + String(rebuiltKept.length) + " kept task(s) had no recorded loop, so their frozen contracts WERE rebuilt with the loop id (" + rebuiltKept.join(", ") + ")."
  return "RE-SPLIT on the same team: " + String(keptCount) + " kept task(s) reuse their live board rows, and their frozen contracts are NOT rewritten — the bytes a verifier may already be reading stay as first frozen. Consequence: a scope expansion needs a manual re-freeze plus a new verify loop, so land it as a NEW split revision; editing the kept contract in place is not what this activation does. " + String(dispatched) + " owner-only pair(s) were dispatched by this activation. " + exception
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
  /** The board MEMBER that owns the task, which C1 lets differ from the role (several members, one role). */
  const memberName = resolvedMemberName(task)
  return [
    "# Acceptance contract — " + task.key + ": " + task.subject,
    "",
    "Cell: `" + deps.cell.cellId + "` · split revision " + String(deps.split.revision) + " · frozen " + deps.split.submittedAt,
    "producer: " + producerIdentity(deps.cell.cellId),
    "Owner: **" + task.ownerRole + "** (member `" + memberName + "`) · Verifier: **" + verifier + "** · Board task: `" + boardId + "`",
    "",
    "## Deliverable",
    task.description,
    "",
    "## Allowed write scopes",
    // THE RECOVERY, NOT JUST THE FACT (C4/D3): a writer handed "(none declared)" used to stop at its first
    // edit with no instruction. The line now says what to DO before that first write.
    ...(task.writeScopes.length === 0
      ? ["(none declared — this task produces no code)", "", "If it DOES need to write, ask the captain for a scope extension BEFORE the first write: this contract allows no path, so any edit is outside it."]
      : task.writeScopes.map((scope) => "- `" + scope + "`")),
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
    CONTRACT_LOOP_PLACEHOLDER,
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
  return doc.replace(CONTRACT_LOOP_PLACEHOLDER, "The verification loop is opened at activation; `" + loopId + "` (`mpd_verify_seat {loop_id:\"" + loopId + "\"}`).")
}

/**
 * Whether one task's FROZEN contract already names a verify loop.
 *
 * A cell activated before {@link CellState.activatedLoops} existed records no loop id, but the contract
 * its activation froze does: {@link withLoopId} REPLACES {@link CONTRACT_LOOP_PLACEHOLDER} when a loop is
 * armed, so the placeholder's absence from an existing file is the durable evidence of the arming. Used
 * only to SKIP re-arming a KEPT task — never to rewrite that frozen contract.
 *
 * @param deps - the activation's workspace and cell, which resolve the contract path.
 * @param taskKey - the split key whose contract is checked.
 * @returns true only when the contract file exists and no longer carries the placeholder.
 */
function contractAlreadyNamesLoop(deps: Pick<ActivateDeps, "workspace" | "cell">, taskKey: string): boolean {
  /** The absolute path the activation writes this task's contract to. */
  const path = contractPath(deps.workspace, deps.cell.cellId, taskKey)
  try {
    if (!existsSync(path)) return false
    return !readFileSync(path, "utf8").includes(CONTRACT_LOOP_PLACEHOLDER)
  } catch {
    // An unreadable contract is NOT evidence of an arming: fall through to the normal open/rewrite path,
    // which will surface the same I/O failure where it matters.
    return false
  }
}

/**
 * Materialise one accepted split on the live team record.
 *
 * @param deps - the adapter, the cell, the split, the captain's agent and the progress sink.
 * @returns the artifacts created, or the refusal sentence plus the partial it may resume from.
 */
export async function materializeSplit(deps: ActivateDeps): Promise<ActivateResult> {
  // THE BOARD IS RESOLVED, NOT TRUSTED FROM THE RECORD (§7.1/§7.1a sites 3 and 8): a normal cell's
  // planning team goes clean-terminal and activation lands on a FRESH team, so `cell.teamId` names the
  // dead one. Every team read below — the live-roster seed, the cancellation, the final report — goes
  // through this ONE resolution instead of `deps.cell.teamId`.
  // THE START-OF-PASS RESOLUTION IS EVIDENCE-GATED: an INITIAL activation has no minted board ids to
  // verify `teamId` against, so it reads NOTHING extra (the writes resolve the live team themselves and
  // the end-of-pass resolution names the board by its own minted ids). A RE-SPLIT does have minted ids,
  // so its seed/cancel path resolves the execution board and never the dead planning team (§7.1a site 8).
  /** Whether this pass is a RE-SPLIT, whose recorded team must be verified against the minted ids. */
  const resplit = Object.values(deps.cell.activatedTasks ?? {}).some((id) => id !== "")
  /** The board this activation's seed and cancellation read. */
  const board = resplit
    ? resolveCellTeam({ workspace: deps.workspace, cell: deps.cell, teams: deps.teams?.(), recordFor: deps.recordFor })
    : { teamId: deps.cell.teamId }
  /** The staging team id the record carried BEFORE this pass, preserved on the outcome (§7.1). */
  const planningTeamId = deps.cell.teamId
  /** The team id every write addresses; a cell with no team was never staged. */
  const teamId = board.teamId
  if (teamId === "") return { ok: false, error: "cellwork_activate: no team is recorded on " + deps.cell.cellId + " — run `cellwork_start` first (the planning team is the record activation appends to)" }
  /** The partial artifacts this pass produced, in the shape the caller persists. */
  const partial: ActivatePartial = { members: {}, boardIds: {}, loopIds: {}, contracts: {} }
  /** Whether anything has been written yet: before that, a failure has nothing to resume from. */
  let mutated = false
  /** How many artifacts this pass has journaled so far. */
  let artifacts = 0
  /** How many artifacts this pass is expected to produce, assigned once the delta is known. */
  let total = 0
  /**
   * Journal ONE compact progress row for an artifact that now exists (contract C8).
   *
   * @param stage - the pass stage the artifact belongs to.
   * @param key - the artifact's split key, or the member name for a member artifact.
   */
  const progress = (stage: ActivateProgress["stage"], key: string): void => {
    mutated = true
    artifacts += 1
    deps.progress({ stage, key, ordinal: artifacts, total })
  }
  /** A fresh copy of the partial, so the failure snapshot can never alias a later mutation. */
  const snapshot = (): ActivatePartial => ({ members: { ...partial.members }, boardIds: { ...partial.boardIds }, loopIds: { ...partial.loopIds }, contracts: { ...partial.contracts } })
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
  /** The distinct board members the fresh tasks resolve to, in submission order (contract C1). */
  const memberOrder: string[] = []
  for (const task of fresh) {
    /** The member this task resolves to. */
    const name = resolvedMemberName(task)
    if (!memberOrder.some((seen) => roleKey(seen) === roleKey(name))) memberOrder.push(name)
  }
  /** Every verify loop this revision already has, by split key: the ones a recorded pass armed. */
  const loopIds = new Map<string, string>(Object.entries(deps.cell.activatedLoops ?? {}))
  /** Every split task that needs a loop (a task with no write scope produces no code to verify). */
  const codeTasks = deps.split.tasks.filter((task) => task.writeScopes.length > 0)
  /** Code-task keys ALREADY armed whose loop id the record cannot name (a pre-`activatedLoops` cell). */
  const armedByContract = new Set<string>()
  /** The code tasks whose loop THIS pass must open, decided up front so `total` is exact. */
  const loopTargets: SplitTaskVerdict[] = []
  for (const task of codeTasks) {
    if (loopIds.has(task.key)) continue
    // F1: a KEPT task from a cell activated BEFORE `activatedLoops` existed has no recorded id, but its
    // frozen contract may already name a loop. Re-opening would duplicate the loop and rewrite a contract
    // a verifier may be reading — so such a task is skipped, and its arming satisfies the dispatch gate.
    if (keptKeys.has(task.key) && contractAlreadyNamesLoop(deps, task.key)) {
      armedByContract.add(task.key)
      continue
    }
    loopTargets.push(task)
  }
  /** How many artifacts this pass will produce: contracts, members, tasks and verify loops (C8). */
  total = freshCode.length + memberOrder.length + fresh.length + loopTargets.length
  /** The live team record as it stands, when the team service can answer. */
  let live: DispatchRecordView | undefined
  try { live = deps.recordFor(teamId) } catch { live = undefined }
  /** The live roster by comparison key, so a member raised before a crash stays resolvable. */
  const liveRoster = new Map<string, DispatchMemberView>()
  for (const row of live?.members ?? []) if (typeof row.name === "string" && row.name !== "") liveRoster.set(roleKey(row.name), row)
  /** The roles already on the cell record, by comparison key. */
  const existingMembers = new Map<string, CellMemberRecord>(Object.values(deps.cell.members).map((member) => [roleKey(member.name), member]))
  // THE LIVE ROSTER IS THE SECOND SEED (contract A3): a member can exist on the team record while the
  // cell record has no row for it (a crash between `add_member` and the failure snapshot). The live
  // `executorRef` is the fresher handle, so it wins over a remembered one.
  for (const [key, row] of liveRoster) {
    /** The row already on the cell record, when there is one. */
    const remembered = existingMembers.get(key)
    /** The live executor handle, when the record carries one. */
    const executorRef = typeof row.executorRef === "string" ? row.executorRef : ""
    /** The member name the team record spells. */
    const name = typeof row.name === "string" ? row.name : key
    /** The tasks this member owns in the accepted split, which decide its mode on the cell record. */
    const owned = deps.split.tasks.filter((task) => roleKey(resolvedMemberName(task)) === key)
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
    progress("contract", task.key)
  }
  // 2. MEMBERS: one per DISTINCT board member (contract C1) — several members may share one owner role,
  // which is the real parallelism D10 was missing — REUSING a planning member, a recorded member or a
  // live roster row instead of raising a second one.
  /** The members handled in this pass, by comparison key. */
  const handledMembers = new Set<string>()
  /** The member rows this pass ensured, keyed by board name. */
  const newMembers: Record<string, CellMemberRecord> = {}
  /** The board names this pass reused instead of raising. */
  const reused: string[] = []
  for (const memberName of memberOrder) {
    /** The member's comparison key. */
    const key = roleKey(memberName)
    if (handledMembers.has(key)) continue
    handledMembers.add(key)
    /** The tasks this MEMBER owns, for its prompt. */
    const owned = deps.split.tasks.filter((candidate) => roleKey(resolvedMemberName(candidate)) === key)
    /** The roster role the member answers to; C1 refuses two roles for one member. */
    const ownerRole = (owned[0]?.ownerRole ?? memberName).trim()
    /** Something already answers for this member: the cell record or the live roster. */
    const existing = existingMembers.get(key)
    if (existing !== undefined) {
      reused.push(existing.name)
      // A LIVE-ROSTER row the CELL record never learned is persisted now, so the guard and the dispatch
      // pass see the same member; one the cell already records is left exactly as it was.
      if (deps.cell.members[existing.name] === undefined) {
        newMembers[existing.name] = existing
        partial.members = { ...partial.members, ...newMembers }
        progress("member", existing.name)
      }
      continue
    }
    /** Whether every task this member owns is a review. */
    const pureVerifier = owned.every((candidate) => candidate.kind === "review")
    /** The member append; the live arm raises the teammate immediately. The ROLE carries the routing. */
    const added = await call({
      action: "add_member",
      member: { name: memberName, role: ownerRole, description: memberName + (pureVerifier ? " (verifier)" : ""), prompt: memberPrompt(deps, memberName, ownerRole, owned) },
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
          newMembers[liveName] = { name: liveName, role: ownerRole, sessionId: executorRef, executorRef, mode: pureVerifier ? "verifier" : "member", handoffReady: false, handoffs: 0, joinedAt: deps.now.toISOString() }
          reused.push(liveName)
          partial.members = { ...partial.members, ...newMembers }
          progress("member", liveName)
          continue
        }
      }
      return fail("cellwork_activate could not raise " + JSON.stringify(memberName) + ": " + added.error)
    }
    /** The handle the raise produced, when the answer carried one. */
    const handle = typeof added.value.spawned === "string" ? added.value.spawned : ""
    if (handle === "") return fail("cellwork_activate raised " + JSON.stringify(memberName) + " but the answer carried no executor handle")
    newMembers[memberName] = { name: memberName, role: ownerRole, sessionId: handle, executorRef: handle, mode: pureVerifier ? "verifier" : "member", handoffReady: false, handoffs: 0, joinedAt: deps.now.toISOString() }
    partial.members = { ...partial.members, ...newMembers }
    progress("member", memberName)
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
    /** The board member the task resolves to: its declared `member`, else its role spelling (contract C1). */
    const memberName = resolvedMemberName(task)
    /** The mapped blockers: keys already minted become board ids; a cell role is not a task so none remain. */
    const mappedBlockers = task.blockedBy.map((reference) => boardIds.get(reference) ?? previous.get(reference) ?? reference)
    // THE FROZEN-CONTRACT POINTER RIDES THE BOARD ROW, NOT A PRIVATE MESSAGE BUILDER (wave W2-B step 1).
    // Any dispatcher — the team plane today — delivers the description VERBATIM, so putting the pointer
    // here is what keeps Amendment 6 R1 true through the plane instead of only through cellwork's own
    // message text. The pointer names the SPLIT KEY's contract file, never the board id's.
    /** The path the verifier's loop froze for this split key. */
    const contractPointer = "FROZEN CONTRACT: " + contractRelativePath(deps.cell.cellId, task.key)
    /** The task's description; a review task additionally names its frozen contract. */
    const description = (task.kind === "review"
      ? reviewTaskDescription(task, deps.split.tasks.find((candidate) => candidate.key === task.blockedBy[0]) ?? task, deps.cell.cellId)
      : task.description) + "\n\n" + contractPointer
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
    progress("task", task.key)
  }
  // 4. VERIFY LOOPS, before dispatch: a verdict with no armed loop is a verdict nobody checks. The
  // condition is `activatedLoops`, NOT `freshCode` (contract A3): a KEPT task whose loop the failing
  // pass never opened is exactly the VEdit wedge, and a loop that already exists is never re-armed.
  /** The loops THIS pass opens, as the outcome reports them (a recorded loop is never re-armed). */
  const loops: ActivatedLoop[] = []
  for (const task of loopTargets) {
    /** The board id this task was materialised as. */
    const boardId = boardIds.get(task.key) ?? ""
    if (boardId === "") return fail("cellwork_activate has no board id for " + JSON.stringify(task.key) + " — refusing to open a verify loop for a row that is not on the board")
    /** The relative contract path the loop freezes. */
    const contract = contractRelativePath(deps.cell.cellId, task.key)
    /** The board member that OWNS this code task (contract C1). */
    const memberName = resolvedMemberName(task)
    /** The member row that carries the owner's agent identity, from this pass or the earlier seed. */
    const owner = newMembers[memberName] ?? existingMembers.get(roleKey(memberName))
    // THE LOOP NAMES ITS WRITER (contract C2, defect D12): `mpd_verify_record` compares the recorded
    // writer id against the VERIFIER's session id, so the value must be an agent identity, never a
    // display name. The cell record's `sessionId` is that identity; `executorRef` is the fallback for a
    // composition that hands back only the executor handle.
    const writerId = (owner?.sessionId ?? "").trim() === "" ? (owner?.executorRef ?? "").trim() : (owner?.sessionId ?? "").trim()
    /** The loop-open call, under the CAPTAIN'S OWN agent (contract A4). */
    let opened: { ok: boolean; value?: unknown; error?: unknown }
    try {
      opened = await deps.dsh.executeTool({
        name: "mpd_verify_open",
        arguments: {
          writer: "delegate",
          contract,
          scope: [...task.writeScopes],
          task_id: boardId,
          ...(writerId === "" ? {} : { writer_id: writerId, writer_reason: "member: " + memberName }),
        },
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
    progress("loop", task.key)
  }
  // THE DISPATCH GATE (contract A3): only after EVERY task has a board id and EVERY code task has a loop
  // id may the owners be woken — a dispatch that skips a loop is the disarmament this repair removes.
  for (const task of deps.split.tasks) {
    if ((boardIds.get(task.key) ?? "") === "") return fail("cellwork_activate has no board id for " + JSON.stringify(task.key) + " — refusing to dispatch")
    if (task.writeScopes.length > 0 && (loopIds.get(task.key) ?? "") === "" && !armedByContract.has(task.key)) return fail("cellwork_activate has no verify loop for " + JSON.stringify(task.key) + " — refusing to dispatch unarmed work")
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
  // THE BOARD IS THE AUTHORITY (wave W2-D step C): the rows this revision dropped are CLOSED through the
  // team plane, so no later pass — the plane's or this cell's — can pair them. The cell record keeps its
  // own cancelled map for status; the plane's terminal `cancelled` row is what actually stops a dispatch.
  if (cancelled.length > 0) {
    /** The rows to close, with the ids the previous activation minted. */
    const cancelledIds = cancelled.map((entry) => entry.boardId).filter((id) => id !== "")
    /** The plane's write surface. */
    const plane = deps.teamActions()
    if (cancelledIds.length > 0 && plane?.cancelTasks === undefined) {
      // A REFUSAL, not a silent skip: an unclosed row stays dispatchable, which is the defect this step
      // exists to remove. The failure names the service so the operator knows what is missing.
      return fail("cellwork_activate dropped " + String(cancelledIds.length) + " row(s) but this composition exposes no mpdTeamActions.cancelTasks, so they would stay dispatchable — the activation is left un-dispatched and can be resumed")
    }
    if (cancelledIds.length > 0 && plane?.cancelTasks !== undefined) {
      /** The plane's answer for the cancellation. */
      // THE CANCEL TARGETS THE RESOLVED BOARD (§7.1a site 3), never the stale recorded id: cancelling on
      // the dead planning team answered `ok:true` with every row `skipped`, a silent no-op reporting success.
      /** The plane's answer for the cancellation. */
      const closed = (await plane.cancelTasks({ workspace: deps.workspace, teamId, taskIds: cancelledIds, note: "the accepted split no longer carries this task" })) as Record<string, unknown>
      if (closed?.ok === false) return fail("cellwork_activate could not close the dropped row(s): " + String(closed.error ?? "the team plane refused the cancellation"))
      // A ROW THE PLANE SKIPPED IS NOT CANCELLED. The old path reported success for an answer whose every
      // entry was skipped; the rows would stay dispatchable, which is the defect this step exists to remove.
      /** The rows the plane did not cancel, with its reason. */
      const uncancelled = Array.isArray(closed.skipped) ? (closed.skipped as Array<Record<string, unknown>>).filter((row) => typeof row.taskId === "string") : []
      if (uncancelled.length > 0) {
        return fail("cellwork_activate could not close " + String(uncancelled.length) + " dropped row(s) on team " + teamId + ": " + uncancelled.map((row) => String(row.taskId) + " (" + String(row.reason ?? "the plane skipped it") + ")").join("; ") + " — the activation is left un-dispatched and can be resumed")
      }
    }
  }
  // 5. DISPATCH, owner-only, after the loops exist. A throw from this stage is a PARTIAL, not a wedge.
  /** The dispatch report the outcome carries. */
  let dispatch: DispatchReport
  /** The live record, re-read after the appends; the splitter's row is closed through it below. */
  let record: DispatchRecordView | undefined
  /** Every seat this pass's initial growth raised or adopted (§4.1), journaled with the activation. */
  let growth: SeatGrowthResult = { members: {}, reassign: [], grown: [], reused: [], refused: [], warnings: [], caps: { perRole: 0, total: 0 } }
  try {
    // THE STRICT DISPATCH READ STAYS FIRST: a team read that throws here must FAIL the pass (the original
    // behaviour). Only after it succeeds may the growth path consult the resolver, whose reads are total.
    record = deps.recordFor(teamId)
    // THE INITIAL PASS GROWS SEATS TOO (§4.1): a RE-SPLIT can start with every existing seat BUSY, so the
    // freshly appended rows would otherwise wait for the next captain pass. The board is resolved with the
    // ids THIS pass minted, so a fresh execution team is found by its own evidence (§7.1).
    /** The board after this pass's appends. */
    const afterBoard = resolveCellTeam({ workspace: deps.workspace, cell: { ...deps.cell, activatedTasks: Object.fromEntries(boardIds) }, teams: deps.teams?.(), recordFor: deps.recordFor })
    growth = await growExecutionSeats({
      dsh: deps.dsh,
      workspace: deps.workspace,
      cell: { ...deps.cell, members: { ...deps.cell.members, ...newMembers }, activatedTasks: Object.fromEntries(boardIds) },
      config: deps.config,
      captainAgent: deps.captainAgent,
      record: afterBoard.record,
      refreshRecord: () => deps.recordFor(afterBoard.teamId),
      rosterRoles: deps.rosterRoles?.() ?? [],
      personaFor: deps.personaFor,
      now: deps.now,
    })
    // The grown rows travel with this pass's members, so the caller persists them in ONE transition.
    for (const [name, row] of Object.entries(growth.members)) newMembers[name] = row
    /** The team-plane write surface, probed per call. */
    const plane = deps.teamActions()
    // THE PLANE PAIRS (wave W2-D). The pass is owner-only and carries NO exclusion list: the rows this
    // revision dropped were CLOSED on the board by `cancelTasks` below, so the plane's own `cancelled` rule
    // skips them and the reason a reader sees is the plane's `cancelled` — one rule, not a private filter.
    if (plane?.dispatch === undefined) {
      dispatch = { pairs: [], skipped: [], refused: "the mpdTeamActions service is absent, so no member can be woken — the board is materialised and ready for a manual `cellwork_dispatch`" }
    } else {
      /** The plane's answer for this pass. */
      const reply = (await plane.dispatch({ sessionId: deps.cell.captainSessionId, mode: "owner-only", ...(growth.reassign.length === 0 ? {} : { reassign: growth.reassign }) })) as Record<string, unknown>
      dispatch = reply?.ok === false
        ? { pairs: [], skipped: [], refused: String(reply.error ?? "the team plane refused the activation pass") }
        : {
          pairs: Array.isArray(reply.pairs) ? reply.pairs as DispatchReport["pairs"] : [],
          skipped: Array.isArray(reply.skipped) ? reply.skipped as DispatchReport["skipped"] : [],
        }
    }
  } catch (error) {
    return fail("cellwork_activate could not dispatch: " + errorText(error))
  }
  // THE SPLIT TASK CLOSES HERE, not on acceptance: it stayed open through a requirements update so the
  // SAME row could be re-dispatched, and materialisation is the moment its work is done.
  // The RECORDED board id is read FIRST (contract C11): a staged ticket that reached the board with NO
  // owner would never match an owner-only lookup, and its row would stay open forever.
  /** The splitter's board row, when it is still open. */
  const splitterRow = findSplitTicket(record?.tasks ?? [], deps.cell.splitTaskId ?? "", true)
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
  // THE RECORD LEARNS THE EXECUTION TEAM IT ACTUALLY WROTE TO (§7.1): after every append, the board is
  // resolved again with THIS pass's minted ids, so a fresh execution team is named by its own evidence and
  // a legacy cell whose `teamId` named the dead planning team is repaired on the record it reports.
  /** The board the completed pass landed on. */
  const finalBoard = resolveCellTeam({ workspace: deps.workspace, cell: { ...deps.cell, activatedTasks: Object.fromEntries(boardIds) }, teams: deps.teams?.(), recordFor: deps.recordFor })
  /** The execution team id the outcome reports; the input's id when nothing better resolved. */
  const executionTeamId = finalBoard.teamId === "" ? teamId : finalBoard.teamId
  appendJournal(deps.workspace, deps.cell.cellId, {
    event: "activate",
    teamId,
    resolvedTeamId: executionTeamId,
    ...(executionTeamId === teamId ? {} : { recordedTeamId: teamId }),
    mode,
    splitRevision: deps.split.revision,
    producer: producerIdentity(deps.cell.cellId),
    tasks: activated.map((task) => ({ key: task.key, boardId: task.boardId, owner: task.memberName, kind: task.kind })),
    kept: [...keptKeys],
    cancelled,
    contracts: Object.values(partial.contracts),
    loops: loops.map((loop) => ({ taskKey: loop.taskKey, loopId: loop.loopId })),
    reused,
    // ONE compact row per artifact, never the accumulated state (contract C8/D7).
    progress: artifacts,
    dispatched: dispatch.pairs.length,
    skipped: dispatch.skipped.length,
    grown: growth.grown.length,
    ...(growth.warnings.length === 0 ? {} : { seatWarnings: growth.warnings }),
    ...(splitTaskId === "" ? {} : { splitTaskId }),
  }, deps.now)
  // THE KEPT CONTRACT'S ONE REBUILD, NAMED (C5): stage 4 rewrites a kept task's contract only when its loop
  // was never recorded, and the notice below states that this is the exception rather than the rule.
  /** The kept keys whose frozen contract this pass rebuilt because their loop id was missing. */
  const rebuiltKept = loopTargets.filter((task) => keptKeys.has(task.key)).map((task) => task.key)
  /** The statement a re-split owes its captain; an initial activation keeps nothing, so it carries none. */
  const notice = keptKeys.size === 0 ? undefined : resplitNotice(keptKeys.size, dispatch.pairs.length, rebuiltKept)
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
      // §7.1: the record takes the execution board id and preserves the staging id beside it.
      ...(executionTeamId === "" || executionTeamId === planningTeamId ? {} : { teamId: executionTeamId, planningTeamId }),
      ...(splitTaskId === "" ? {} : { splitTaskId }),
      ...(notice === undefined ? {} : { notice }),
    },
  }
}
