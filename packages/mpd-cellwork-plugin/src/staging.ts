// CELLWORK STAGING — the planning team `cellwork_start` stages and approves (contract B4, Amendment 3).
//
// WHAT IS STAGED: TWO members and TWO tasks, not one. `cell-planner` runs the Socratic requirements
// interview; `cell-splitter` turns the agreed document into the measured graph. The split task is
// BLOCKED BY the requirements task, so the splitter cannot start before the interview closes — and the
// splitter is a real agent with a real task rather than a duty quietly moved into the captain's lane,
// which is exactly what clause 1 (dispatch-only captain) forbids.
//
// HOW A MEMBER GETS ITS DISCIPLINE. Team members get NO roster persona from the harness: the executor
// raises them by label and no roster row answers `cell-planner`. The persona TEXT therefore travels in the
// member's PROMPT, and the member's `role` (`Planner` / `Lead`) is what the team executor uses to route it
// on the right `agentRoutes` slot (a roster name it cannot match inherits the staging session's route).
//
// EVERY TEAM WRITE GOES THROUGH `dsh.executeTool({name:"agent_teams_*"})` — the captain's own session runs
// these calls, so the plan lands under the captain's identity exactly as a manual staging would.
import type { DshAdapter } from "../../mpd-dsh-adapter-plugin/src/index"
import type { CellworkConfig } from "./config"
import type { CellMemberRecord, CellState } from "./state"
import type { TeamsServiceView } from "./caller"
import { roleKey } from "./split"
import { PLANNER_RECON_LINES } from "./prompts"

/** The planner member's board name. */
export const PLANNER_MEMBER = "cell-planner"

/** The splitter member's board name. */
export const SPLITTER_MEMBER = "cell-splitter"

/** The planner's roster persona label (its `agentRoutes` slot and persona source). */
export const PLANNER_ROLE = "Planner"

/** The splitter's roster persona label — the decompose-and-delegate lane. */
export const SPLITTER_ROLE = "Lead"

/** The requirements task's subject, which is also the split task's blocker reference at staging. */
export const REQUIREMENTS_TASK_SUBJECT = "Requirements interview and agreed requirements document"

/** The split task's subject. */
export const SPLIT_TASK_SUBJECT = "Measured task split from the agreed requirements"

/** The six sections the planner must close with the user, in the order it should ask about them. */
export const REQUIRED_SECTION_NAMES: readonly string[] = ["Goal", "Non-goals", "Users / consumers", "Constraints", "Acceptance criteria", "Open questions"]

/** What {@link stagePlanningTeam} needs: the adapter, the cell, the captain's agent and the persona reader. */
export interface StageDeps {
  /** The adapter (tool execution only — the team plane is driven through it). */
  dsh: Pick<DshAdapter, "executeTool" | "workspaceRoot">
  /** The workspace root the caller resolved through the adapter. */
  workspace: string
  /** The ACTIVE cell being started. */
  cell: CellState
  /** The captain's live agent handle, authorizing every team call. */
  captainAgent: unknown
  /** The persona text for one roster label, or null when the roster service cannot answer. */
  personaFor: (label: string) => string | null
  /** The live-team service, read after approval to confirm the record exists. */
  teams: () => TeamsServiceView | undefined
  /** The resolved knobs (the contract gate list travels into the splitter's instructions). */
  config: CellworkConfig
  /** The instant to stamp the member rows with. */
  now: Date
}

/** The staging outcome. */
export interface StageResult {
  /** Whether the planning team is staged and approved. */
  ok: boolean
  /** The refusal sentence when `ok` is false. */
  error?: string
  /** Whether the team was already staged by an earlier call (idempotent start). */
  alreadyStaged?: boolean
  /** The approved team id, when one exists. */
  teamId?: string
  /** The two planning members, keyed by board name. */
  members?: Record<string, CellMemberRecord>
  /** The board ids of the two tasks. */
  tasks?: { requirementsId?: string; splitId?: string }
  /**
   * Whether this call CLAIMED an ownerless split ticket for `cell-splitter` (contract C11).
   *
   * A plan approval can post the split ticket with no owner (defect D2); staging repairs that itself, so
   * the requirements-update path can still find and re-dispatch the SAME row (defect D3).
   */
  ownerRepaired?: boolean
  /**
   * The name of the plan slot this cell stages under (`"cell " + cellId`), so a caller can journal WHICH
   * plan a partial failure left behind and a retry can recognize its own slot.
   */
  planName?: string
  /**
   * Whether the staging stopped after WRITING something (a plan, a member, a task, or an approved team).
   *
   * A partial result still carries what EXISTS — `teamId` and `members` when the approval got that far —
   * so the caller can record it and the next call can resume instead of refusing.
   */
  partial?: boolean
}

/** A loosely-read tool value: the team tools answer records, and every field is checked before use. */
type ToolValue = Record<string, unknown>;

/**
 * Read one text field from an untrusted record.
 *
 * @param record - the record to read.
 * @param key - the field name.
 * @returns the string, or "" when absent or not a string.
 */
function textField(record: Record<string, unknown> | undefined, key: string): string {
  /** The raw value. */
  const value = record?.[key]
  return typeof value === "string" ? value : ""
}

/**
 * Read the members a plan-approval answer created, keyed by name.
 *
 * @param value - the `agent_teams_plan approve` value.
 * @returns one `{ name, id }` per created member.
 */
function createdMembers(value: ToolValue): Array<{ name: string; id: string }> {
  /** The `created` block. */
  const created = typeof value.created === "object" && value.created !== null ? value.created as Record<string, unknown> : {}
  /** The member rows, filtered to records that name a member. */
  const rows = Array.isArray(created.members) ? created.members : []
  return rows
    .filter((row): row is Record<string, unknown> => typeof row === "object" && row !== null)
    .map((row) => ({ name: textField(row, "name"), id: textField(row, "id") }))
    .filter((row) => row.name !== "")
}

/**
 * Read the tasks a plan-approval answer created, in plan order.
 *
 * @param value - the `agent_teams_plan approve` value.
 * @returns one `{ subject, id }` per created task.
 */
function createdTasks(value: ToolValue): Array<{ subject: string; id: string }> {
  /** The `created` block. */
  const created = typeof value.created === "object" && value.created !== null ? value.created as Record<string, unknown> : {}
  /** The task rows. */
  const rows = Array.isArray(created.tasks) ? created.tasks : []
  return rows
    .filter((row): row is Record<string, unknown> => typeof row === "object" && row !== null)
    .map((row) => ({ subject: textField(row, "subject"), id: textField(row, "id") }))
}

/**
 * The planner's instantiation prompt: the Socratic interview, the relay protocol and its tools.
 *
 * @param deps - the cell and the persona reader.
 * @returns the prompt text.
 */
export function plannerPrompt(deps: Pick<StageDeps, "cell" | "personaFor">): string {
  /** The persona text, when the roster service answered. */
  const persona = deps.personaFor(PLANNER_ROLE)
  return [
    ...(persona === null ? [] : [persona, ""]),
    "[mpd-cellwork] You are cell-planner, the requirements interviewer of cell " + deps.cell.cellId + ".",
    "",
    "OBJECTIVE (the user's own words):",
    deps.cell.objective,
    "",
    "YOUR JOB: run a SOCRATIC interview with the user and produce ONE agreed requirements document. You",
    "never implement, never split the work, and never answer a question that belongs to the user.",
    "",
    "THE PROTOCOL:",
    "1. Ask ONE question at a time. Never bundle questions.",
    "2. When the answer arrives, REFLECT IT BACK in one sentence and ask for confirmation when it changes scope.",
    "3. Surface EDGE CASES explicitly: failure modes, empty states, who is NOT served, what is out of scope.",
    "4. Agree a DEFINITION OF DONE (acceptance criteria a verifier could check), not adjectives.",
    "5. Close only when all six sections are filled: " + REQUIRED_SECTION_NAMES.join(" · ") + ".",
    "",
    "THE RELAY (you cannot talk to the user directly):",
    "- Mail the captain ONE structured question: `cellwork_send {to:\"captain\", subject, body}` — or",
    "  `agent_teams_mail` when the cell-aware sender is not mounted. Put the question, why it matters, and",
    "  the options you see in the body, so the captain can put it to the user with `ask_user_question`.",
    "- Then WAIT for the captain's answer. Do not invent an answer, do not proceed on an assumption.",
    "- If reconnaissance is needed before you can ask a good question, call `cellwork_recon`",
    "  {role:\"Explorer\"|\"Researcher\", task} — a one-shot READ-ONLY consult; you get its report back.",
    // C5/D15, ruling R2: the delegation block is EXPORTED by `prompts.ts` (lane E owns that file) and
    // spliced here, in the PLANNER prompt only. The block opens and closes with an empty line.
    ...PLANNER_RECON_LINES,
    "THE DOCUMENT: write `<cell>/requirements.md` under the cell directory with these headings exactly:",
    "  ## Goal · ## Non-goals · ## Users / consumers · ## Constraints · ## Acceptance criteria · ## Open questions",
    "Every section must carry real content; an empty section will be refused.",
    "Then call `cellwork_requirements {action:\"finalize\"}` (pass `content` instead of writing the file if that",
    "is easier). A finalized revision unblocks the splitter.",
    "",
    "YOUR TOOLS: `cellwork_recon`, `cellwork_requirements`, `cellwork_status`, `cellwork_send`/`agent_teams_mail`.",
    "Do NOT call `ask_user_question` (that is the captain's surface) and do NOT submit a split.",
  ].join("\n")
}

/**
 * The splitter's instantiation prompt: the graph shape, the measured budget and the refusal protocol.
 *
 * @param deps - the cell, the persona reader and the knobs.
 * @returns the prompt text.
 */
export function splitterPrompt(deps: Pick<StageDeps, "cell" | "personaFor" | "config">): string {
  /** The persona text, when the roster service answered. */
  const persona = deps.personaFor(SPLITTER_ROLE)
  /** The gate commands the frozen contracts will list, when configured. */
  const gates = deps.config.contractGates.length === 0 ? "(the repository's own declared gates)" : deps.config.contractGates.join(" · ")
  return [
    ...(persona === null ? [] : [persona, ""]),
    "[mpd-cellwork] You are cell-splitter, the task-graph designer of cell " + deps.cell.cellId + ".",
    "",
    "OBJECTIVE (the user's own words):",
    deps.cell.objective,
    "",
    "YOUR JOB: turn the FINALIZED requirements document into a task graph, submit it with `cellwork_split`,",
    "and fix whatever the plugin's measured refusal names. You never implement and never own a work task.",
    "",
    "READ FIRST: `<cell>/requirements.md` (the agreed scope) and `cellwork_status` (the current",
    "requirementsRevision — pass it as `revision`). If the document is still revision 0, the interview is not",
    "closed yet: wait for the captain's dispatch instead of inventing scope.",
    "",
    "THE GRAPH — one object per task, exactly these fields:",
    "  {key, subject, description, kind, ownerRole, writeScopes, blockedBy, inputs, verify}",
    "  · key: stable (`T1`, `auth-core`, …); it becomes the contract file name.",
    "  · kind: requirement | work | review | repair | integration (omitted means work).",
    "  · ownerRole: a ROSTER role name (Senior Engineer, Deep Worker, Junior Engineer, Reviewer, …) or a cell",
    "    role (cell-planner, cell-splitter). It is the role the executor routes the member by.",
    "  · writeScopes: the paths the task will touch; code tasks MUST declare them.",
    "  · blockedBy: an array of task KEYS ([] is an explicit root) — or `independent: true`. A task that",
    "    answers neither is refused.",
    "  · inputs: workspace-relative file paths the owner must read. THE PLUGIN MEASURES THEM (`stat` + a",
    "    16 KiB sample), so a huge file is refused with real bytes instead of a guess.",
    "  · verify: true for every code-producing task. EACH verify:true TASK NEEDS EXACTLY ONE review task",
    "    whose `kind` is \"review\", whose `blockedBy` contains that task's key, and whose ownerRole is a",
    "    DIFFERENT role — the verifier must not be the writer.",
    "",
    "TWO HARD GRAPH RULES: the dependency graph must be ACYCLIC, and two tasks may share a write scope only",
    "when a dependency edge orders them (otherwise one task must cut its scope or depend on the other).",
    "",
    "THE BUDGET (the plugin enforces it, you cannot argue with it): each task's measured estimate must fit",
    "`floor(window * " + String(deps.config.windowFraction) + ")` AND leave room for the model's max output plus " + String(deps.config.compactionHeadroomTokens) + " tokens of",
    "compaction headroom inside the model's own context window. The window is READ from the model catalog,",
    "never assumed. Tasks owned by the same role share that role's route.",
    "A REFUSAL RETURNS A PER-TASK BREAKDOWN (input bytes → tokens, budget, excess). Do not resubmit the same",
    "graph: SPLIT the task, cut the declared inputs, or move work to a larger-window owner role.",
    "",
    "FROZEN CONTRACTS: each code task's verification contract will list its write scopes and these gate",
    "commands for the verifier: " + gates + ".",
    "",
    "SUBMIT: `cellwork_split {action:\"submit\", revision:<requirementsRevision>, tasks:[…]}`; then read the",
    "verdict with `cellwork_split {action:\"show\"}`. On acceptance the captain materialises the graph.",
    "Ambiguity in the requirements goes back to the planner THROUGH THE CAPTAIN — mail the captain; do not",
    "invent scope.",
  ].join("\n")
}

/**
 * Stage and approve the two-member planning team (idempotent for an already-staged cell).
 *
 * @param deps - the adapter, the cell, the captain's agent and the persona reader.
 * @returns the approved team id, the member rows and the two task ids, or the refusal sentence.
 */
export async function stagePlanningTeam(deps: StageDeps): Promise<StageResult> {
  /** The team id already recorded on the cell, which makes this call idempotent. */
  const existingTeamId = deps.cell.teamId
  if (existingTeamId !== "") {
    /** The live record, when the team service can read it. */
    const record = deps.teams()?.get?.(deps.workspace, existingTeamId)
    // THE SPLIT TICKET IS RESOLVED ON THE IDEMPOTENT PATH TOO (contract C11): a retry that takes this
    // arm is the moment the earlier pass's failure stopped, and its board id is recorded from here on.
    /** The staged split ticket, resolved by the recorded id first and by its owner second. */
    const ticket = await resolveSplitTicket(deps, existingTeamId, "", false)
    if (ticket.boardReadable && ticket.splitTaskId === "") return { ok: false, error: "the planning team " + existingTeamId + " is on this cell's record but " + ticket.repairError, teamId: existingTeamId, planName: "cell " + deps.cell.cellId, partial: true }
    return {
      ok: true,
      alreadyStaged: true,
      teamId: existingTeamId,
      tasks: { splitId: ticket.splitTaskId },
      ...(ticket.ownerRepaired ? { ownerRepaired: true } : {}),
      ...(record === undefined ? {} : {
        members: {
          [PLANNER_MEMBER]: planningMemberRow(PLANNER_MEMBER, PLANNER_ROLE, deps.cell, deps.now),
          [SPLITTER_MEMBER]: planningMemberRow(SPLITTER_MEMBER, SPLITTER_ROLE, deps.cell, deps.now),
        },
      }),
    }
  }
  /** One team-plane call; the value is the tool's structured answer. */
  const call = async (arguments_: Record<string, unknown>): Promise<{ ok: true; value: ToolValue } | { ok: false; error: string }> => {
    /** The adapter's normalized answer. */
    const result = await deps.dsh.executeTool({ name: "agent_teams_plan", arguments: arguments_, agent: deps.captainAgent })
    if (!result.ok) return { ok: false, error: typeof result.error === "string" ? result.error : "the agent_teams_plan call failed" }
    return { ok: true, value: typeof result.value === "object" && result.value !== null ? result.value as ToolValue : {} }
  }
  /** THE NAME THIS CELL ALWAYS STAGES UNDER, and the key a retry recognizes its own slot by. */
  const planName = "cell " + deps.cell.cellId
  /** The session's current plan/team state, read before anything is staged. */
  const status = await call({ action: "status" })
  if (!status.ok) return { ok: false, error: "cellwork could not read the session's team state: " + status.error }
  /** The plan already staged for this session, when one exists. */
  const staged = status.value.plan
  /** The staged plan read as a record, or undefined when the slot is free. */
  const plan = typeof staged === "object" && staged !== null ? staged as ToolValue : undefined
  /** Whether the plan in the slot is THIS cell's, so it may be RESUMED instead of refused. */
  const resumable = plan !== undefined && textField(plan, "name") === planName
  /** Whether that plan is already approved, which means the TEAM exists and only a record may be missing. */
  const approvedAlready = resumable && textField(plan, "approvedAt") !== ""
  // A PLAN THAT IS NOT OURS STILL REFUSES, exactly as before: cellwork needs a free slot, and resuming
  // somebody else's plan would stage this cell's members onto another cell's board.
  if (plan !== undefined && !resumable) {
    if (textField(plan, "approvedAt") !== "") {
      return { ok: false, error: "a team plan is already APPROVED in this session; cellwork needs the staging slot free — finish or archive that team first" }
    }
    /** How many rows that plan already carries. */
    const stagedRows = (Array.isArray(plan.members) ? plan.members.length : 0) + (Array.isArray(plan.tasks) ? plan.tasks.length : 0)
    if (stagedRows > 0) {
      return { ok: false, error: "a different team plan is already staged in this session (" + String(stagedRows) + " row(s)); approve or delete it before starting cellwork" }
    }
  }
  // A PLAN LEFT BY AN EARLIER ATTEMPT OF THIS SAME CELL IS RESUMED, not refused: a half-staged team is
  // what a failed approval leaves behind, and refusing it would strand a cell nobody can start.
  if (approvedAlready) {
    /** The approved team the status answer carries, when it carries one. */
    const liveTeam = typeof status.value.team === "object" && status.value.team !== null ? status.value.team as ToolValue : undefined
    /** The team id the approval minted. */
    const recoveredId = textField(liveTeam, "teamId")
    if (recoveredId === "") {
      return { ok: false, error: "the planning plan " + planName + " is APPROVED but the session reports no team id — inspect `agent_teams_plan {action:\"status\"}` before retrying", planName, partial: true }
    }
    /** The roster rows that team carries. */
    const roster = Array.isArray(liveTeam?.members) ? liveTeam.members.filter((row) => typeof row === "object" && row !== null) as Array<ToolValue> : []
    /** The planning rows recovered from that roster, keyed by name. */
    const recovered: Record<string, CellMemberRecord> = {}
    for (const [name, role] of [[PLANNER_MEMBER, PLANNER_ROLE], [SPLITTER_MEMBER, SPLITTER_ROLE]] as const) {
      /** That member's live row, when the approval raised it. */
      const row = roster.find((candidate) => textField(candidate, "name") === name)
      if (row !== undefined) {
        recovered[name] = livePlanningMemberRow(name, role, textField(row, "executorRef") === "" ? textField(row, "id") : textField(row, "executorRef"), deps.cell, deps.now)
        continue
      }
      // THE REPAIR THE FINDING ASKS FOR: the approval stopped before raising this member. A live team's
      // Lead may append it, so the failed row is repaired instead of re-approving the whole plan.
      /** That repair append. */
      const appended = await call({ action: "add_member", member: { name, role, description: name + " (" + role + ")", prompt: name === PLANNER_MEMBER ? plannerPrompt(deps) : splitterPrompt(deps) } })
      if (!appended.ok) {
        return { ok: false, error: "the planning team " + recoveredId + " is approved but " + name + " could not be raised: " + appended.error, planName, teamId: recoveredId, partial: true }
      }
      recovered[name] = livePlanningMemberRow(name, role, textField(appended.value, "spawned"), deps.cell, deps.now)
    }
    // THE RECOVERED TEAM'S SPLIT TICKET IS RESOLVED HERE TOO (contract C11): the approval had already
    // run, so no `create_task` answer carries its id — the board read is the only place it exists.
    /** The staged split ticket, resolved by the recorded id first and by its owner second. */
    const recoveredTicket = await resolveSplitTicket(deps, recoveredId, "", false)
    if (recoveredTicket.boardReadable && recoveredTicket.splitTaskId === "") return { ok: false, error: "the planning team " + recoveredId + " is approved but " + recoveredTicket.repairError, teamId: recoveredId, members: recovered, planName, partial: true }
    return { ok: true, alreadyStaged: true, teamId: recoveredId, members: recovered, tasks: { splitId: recoveredTicket.splitTaskId }, planName, ...(recoveredTicket.ownerRepaired ? { ownerRepaired: true } : {}) }
  }
  // No usable plan of ours is staged: create one and fill it. `approval:"required"` is the default, and
  // the explicit approve call below is what executes it (nothing is spawned before that).
  if (plan === undefined) {
    if (typeof status.value.team === "object" && status.value.team !== null) {
      return { ok: false, error: "this session already drives team " + textField(status.value.team as ToolValue, "teamId") + "; cellwork requires its own fresh team" }
    }
    /** The creation answer. */
    const created = await call({ action: "create", name: planName, description: deps.cell.objective })
    if (!created.ok) return { ok: false, error: "cellwork could not stage the planning team: " + created.error, planName }
  }
  /** The member names the slot ALREADY carries, so a resume never duplicates a row a failed pass wrote. */
  const presentMembers = new Set((Array.isArray(plan?.members) ? plan.members : []).map((row) => typeof row === "object" && row !== null ? textField(row as ToolValue, "name") : ""))
  /** The two members, staged before the tasks so both owners resolve. */
  for (const [name, role, prompt] of [
    [PLANNER_MEMBER, PLANNER_ROLE, plannerPrompt(deps)] as const,
    [SPLITTER_MEMBER, SPLITTER_ROLE, splitterPrompt(deps)] as const,
  ]) {
    if (presentMembers.has(name)) continue
    /** One member append. */
    const appended = await call({ action: "add_member", member: { name, role, description: name + " (" + role + ")", prompt } })
    if (!appended.ok) return { ok: false, error: "cellwork could not stage " + name + ": " + appended.error, planName, partial: true }
  }
  /** The task subjects the slot ALREADY carries, for the same resume reason. */
  const presentSubjects = new Set((Array.isArray(plan?.tasks) ? plan.tasks : []).map((row) => typeof row === "object" && row !== null ? textField(row as ToolValue, "subject") : ""))
  /** The requirements task, an explicit root. */
  if (!presentSubjects.has(REQUIREMENTS_TASK_SUBJECT)) {
    /** The requirements row append. */
    const requirements = await call({
      action: "create_task",
      task: { subject: REQUIREMENTS_TASK_SUBJECT, description: plannerTaskDescription(deps.cell), kind: "requirement", owner: PLANNER_MEMBER, blocked_by: [] },
    })
    if (!requirements.ok) return { ok: false, error: "cellwork could not stage the requirements task: " + requirements.error, planName, partial: true }
  }
  /** The split task, blocked by the requirements task (by subject, which approval resolves). */
  if (!presentSubjects.has(SPLIT_TASK_SUBJECT)) {
    /** The split row append. */
    const split = await call({
      action: "create_task",
      task: { subject: SPLIT_TASK_SUBJECT, description: splitterTaskDescription(deps.cell), kind: "work", owner: SPLITTER_MEMBER, blocked_by: [REQUIREMENTS_TASK_SUBJECT] },
    })
    if (!split.ok) return { ok: false, error: "cellwork could not stage the split task: " + split.error, planName, partial: true }
  }
  /** The approval, which raises the two members and mints the record. */
  const approved = await call({ action: "approve" })
  if (!approved.ok) return { ok: false, error: "cellwork could not approve the planning team: " + approved.error, planName, partial: true }
  /** The team record the approval built. */
  const team = typeof approved.value.team === "object" && approved.value.team !== null ? approved.value.team as ToolValue : undefined
  /** The approved team id, which every later write addresses. */
  const teamId = textField(team, "teamId")
  /** The members the approval raised. */
  const raised = createdMembers(approved.value)
  /** The tasks the approval posted. */
  const posted = createdTasks(approved.value)
  /** The approval's own failure sentence, when a member could not be raised. */
  const stoppedAt = textField(approved.value, "stoppedAt")
  /** The two planning member rows, built from what the approval actually raised. */
  const members: Record<string, CellMemberRecord> = {}
  for (const row of raised) {
    if (row.name !== PLANNER_MEMBER && row.name !== SPLITTER_MEMBER) continue
    members[row.name] = {
      name: row.name,
      role: row.name === PLANNER_MEMBER ? PLANNER_ROLE : SPLITTER_ROLE,
      sessionId: row.id,
      executorRef: row.id,
      mode: "member",
      handoffReady: false,
      handoffs: 0,
      joinedAt: deps.now.toISOString(),
    }
  }
  if (teamId === "") return { ok: false, error: "the planning team was approved but the answer carried no team id — inspect `agent_teams_plan {action:\"status\"}` before retrying", planName, partial: true }
  if (stoppedAt !== "") {
    // THE PARTIAL OUTCOME IS PRESERVED, not thrown away: the team EXISTS, its id and the rows the
    // approval did raise travel back with the refusal, and the caller records them so the retry takes
    // the idempotent path instead of staging a second team.
    return { ok: false, error: "the planning team " + teamId + " was approved but a member could not be raised (" + stoppedAt + "); the record exists — inspect `agent_teams_plan {action:\"status\"}` and repair it", teamId, members, planName, partial: true }
  }
  /** The board id the approval minted for one staged subject, or "" when it carried none. */
  const postedId = (subject: string): string => posted.find((row) => row.subject === subject)?.id ?? ""
  // THE SPLIT TICKET IS RESOLVED AND ITS OWNER REPAIRED HERE (contract C11, defects D2/D3): the approval
  // may post it with NO owner, so the board is read back and the row is claimed for `cell-splitter`.
  /** The id the approval's own answer named for the split ticket, or "". */
  const answeredSplitId = postedId(SPLIT_TASK_SUBJECT) === "" ? (posted[1]?.id ?? "") : postedId(SPLIT_TASK_SUBJECT)
  /** The staged split ticket, resolved by that id first and by its owner second. */
  const ticket = await resolveSplitTicket(deps, teamId, answeredSplitId, true)
  /** The id this staging records: the board read is authoritative, the approval's answer the fallback. */
  const splitId = ticket.splitTaskId === "" ? answeredSplitId : ticket.splitTaskId
  // A MISSING TICKET IS A HARD ERROR only when the board WAS readable and carried none: an unreadable
  // record proves nothing, so the approval's own answer is recorded instead of refusing a staged team.
  if (ticket.boardReadable && splitId === "") return { ok: false, error: "the planning team " + teamId + " was approved but " + ticket.repairError, teamId, members, planName, partial: true }
  if (ticket.repairError !== "") return { ok: false, error: ticket.repairError, teamId, members, planName, partial: true }
  return {
    ok: true,
    teamId,
    members,
    tasks: { requirementsId: postedId(REQUIREMENTS_TASK_SUBJECT), splitId },
    ...(ticket.ownerRepaired ? { ownerRepaired: true } : {}),
  }
}

/**
 * Build one planning member row from the handle a LIVE team record (or a repair append) carries.
 *
 * @param name - the member's board name.
 * @param role - its roster role label.
 * @param handle - the executor handle the team minted for it.
 * @param cell - the cell being started, whose own row wins when it already carries a handle.
 * @param now - the instant to stamp.
 * @returns the member row.
 */
function livePlanningMemberRow(name: string, role: string, handle: string, cell: CellState, now: Date): CellMemberRecord {
  /** The row the cell already carries, which is complete when the cell knows the handle. */
  const base = planningMemberRow(name, role, cell, now)
  return handle === "" ? base : { ...base, sessionId: handle, executorRef: handle }
}

/**
 * Build one planning member row whose executor handle is not known yet (the idempotent start arm).
 *
 * @param name - the member's board name.
 * @param role - its roster role label.
 * @param cell - the cell being started.
 * @param now - the instant to stamp.
 * @returns the member row with empty handles, which `callerContext` fills from the live record.
 */
function planningMemberRow(name: string, role: string, cell: CellState, now: Date): CellMemberRecord {
  return { name, role, sessionId: cell.members[name]?.sessionId ?? "", executorRef: cell.members[name]?.executorRef ?? "", mode: "member", handoffReady: cell.members[name]?.handoffReady ?? false, handoffs: cell.members[name]?.handoffs ?? 0, joinedAt: cell.members[name]?.joinedAt ?? now.toISOString() }
}

/**
 * The requirements task's acceptance text handed to the planner at staging.
 *
 * @param cell - the cell being started.
 * @returns the task description.
 */
export function plannerTaskDescription(cell: CellState): string {
  return [
    "Run the Socratic requirements interview for cell " + cell.cellId + " and produce ONE agreed document.",
    "Ask the user through the captain, one question at a time; never answer for them.",
    "Required sections: " + REQUIRED_SECTION_NAMES.join(", ") + ".",
    "Write `<cell>/requirements.md`, then call `cellwork_requirements {action:\"finalize\"}`.",
    "CLOSE THE TASK with `agent_teams_task {action:\"complete\", task_id:<this task>}` when the revision is accepted.",
  ].join("\n")
}

/**
 * The split task's acceptance text handed to the splitter at staging.
 *
 * @param cell - the cell being started.
 * @returns the task description.
 */
export function splitterTaskDescription(cell: CellState): string {
  return [
    "Turn the FINALIZED requirements document of cell " + cell.cellId + " into a measured task graph.",
    "Submit `cellwork_split {action:\"submit\", revision:<requirementsRevision>, tasks:[…]}` (shape in your prompt).",
    "Every verify:true task needs exactly one review task, blocked by it, owned by a DIFFERENT role.",
    "Fix every refusal the measured breakdown names; then close the task with",
    "`agent_teams_task {action:\"complete\", task_id:<this task>}` once a split revision is ACCEPTED.",
  ].join("\n")
}

/** The board statuses a still-actionable row never carries. */
const TERMINAL_TICKET_STATUSES: readonly string[] = ["completed", "failed", "cancelled"]

/** One board row, as much of it as the split-ticket lookup reads (contract C11). */
export interface SplitTicketRow {
  /** The board id the row answers to; read through `String(...)`, so an untrusted record is tolerated. */
  id?: unknown
  /** The declared owner's board name. */
  owner?: unknown
  /** The board status, used only to tell a live row from a terminal one. */
  status?: unknown
}

/** The sentence every missing/ownerless split ticket's report carries: the repair verb, verbatim. */
export const SPLIT_TICKET_REPAIR = "agent_teams_task {action:\"claim\", claimant:\"cell-splitter\"}"

/**
 * Find the cell's split ticket on one board read: the RECORDED id first, the owner second (contract C11).
 *
 * The recorded id wins because a staged ticket can reach the board with NO owner (defect D2), and an
 * owner-only lookup then reports "no split task" forever — which is also what blinded the STALE machinery
 * (defect D3). The owner match stays as the fallback for a cell whose record predates
 * {@link CellState.splitTaskId}.
 *
 * @param rows - the cell team's board rows, in board order.
 * @param splitTaskId - the recorded board id, or "" when the cell never recorded one.
 * @param liveOnly - true to skip terminal rows, false to consider every row.
 * @returns the row, or undefined when the board holds no split ticket.
 */
export function findSplitTicket(rows: readonly SplitTicketRow[], splitTaskId: string, liveOnly: boolean): SplitTicketRow | undefined {
  /** Whether one row is still actionable. */
  const live = (row: SplitTicketRow): boolean => !TERMINAL_TICKET_STATUSES.includes(String(row.status ?? ""))
  /** The row the cell RECORDED, whatever its owner says. */
  const recorded = splitTaskId === "" ? undefined : rows.find((row) => String(row.id ?? "") === splitTaskId)
  if (recorded !== undefined && (!liveOnly || live(recorded))) return recorded
  /** The splitter's rows, in board order. */
  const owned = rows.filter((row) => roleKey(String(row.owner ?? "")) === roleKey(SPLITTER_MEMBER))
  /** The live row first, the terminal one only when the caller tolerates it. */
  return owned.find(live) ?? (liveOnly ? undefined : owned[0])
}

/** What {@link resolveSplitTicket} found and repaired. */
export interface SplitTicketResolution {
  /** The split ticket's board id, or "" when the board carries none. */
  splitTaskId: string
  /** Whether this call CLAIMED an ownerless row for `cell-splitter`. */
  ownerRepaired: boolean
  /** The refusal sentence of a failed owner repair, or "" when no repair was needed or it succeeded. */
  repairError: string
  /**
   * Whether the team record could be READ at all.
   *
   * A record the service cannot answer proves nothing about the board: `false` means "absence is not
   * evidence", so a caller must not report a missing ticket — it falls back to the id the approval answered.
   */
  boardReadable: boolean
}

/**
 * Resolve the cell's staged split ticket on the live board and repair a LOST OWNER (contract C11, D2).
 *
 * Runs AFTER the approval, against the board the approval minted. An ownerless ticket is claimed for
 * `cell-splitter` here, so a requirements update can find and re-dispatch the SAME row instead of
 * reporting "no split task" (D3). The repair is reported, never thrown: the board id is recorded either
 * way, and the id-first lookup keeps working when the claim itself is refused.
 *
 * @param deps - the adapter, the workspace, the captain's agent and the team reader.
 * @param teamId - the approved team whose board is read.
 * @param preferredId - the board id the approval answered, when it carried one.
 * @param liveOnly - true on the fresh-approval path (the ticket must still be actionable), false on a
 *   resume, where a ticket the activation already CLOSED is a normal row and its id must still be kept.
 * @returns what was found and what the repair did.
 */
export async function resolveSplitTicket(deps: Pick<StageDeps, "dsh" | "workspace" | "cell" | "captainAgent" | "teams">, teamId: string, preferredId: string, liveOnly: boolean): Promise<SplitTicketResolution> {
  /** The live board, read back after the approval. */
  const record = deps.teams()?.get?.(deps.workspace, teamId)
  if (typeof record !== "object" || record === null) {
    // A record the service cannot answer is NOT an empty board: nothing here can prove the ticket absent,
    // so the caller keeps whatever id the approval answered and no repair sentence is invented.
    return { splitTaskId: "", ownerRepaired: false, repairError: "", boardReadable: false }
  }
  /** Its task rows, as the lookup reads them. */
  const rows = Array.isArray((record as { tasks?: unknown }).tasks) ? (record as { tasks: unknown[] }).tasks.filter((row) => typeof row === "object" && row !== null) as SplitTicketRow[] : []
  /** The id the cell already recorded. */
  const recorded = (deps.cell.splitTaskId ?? "").trim()
  /** The id this call could add. */
  const preferred = preferredId.trim()
  /** The row: the recorded id first, the approval's id second, the owner last. */
  const row = (recorded === "" ? undefined : findSplitTicket(rows, recorded, liveOnly))
    ?? (preferred === "" ? undefined : findSplitTicket(rows, preferred, liveOnly))
    ?? findSplitTicket(rows, "", liveOnly)
  if (row === undefined) return { splitTaskId: "", ownerRepaired: false, repairError: "no split ticket is on the board — repair it with `" + SPLIT_TICKET_REPAIR + "`", boardReadable: true }
  /** The ticket's board id, which every later lookup reads first. */
  const splitTaskId = String(row.id ?? "")
  /** The owner the board stored, which a plan-approval defect can leave empty (D2). */
  const owner = String(row.owner ?? "").trim()
  if (owner !== "" || splitTaskId === "") return { splitTaskId, ownerRepaired: false, repairError: "", boardReadable: true }
  try {
    /** The repair claim, for the row's fixed owner (`cell-splitter`). */
    const claimed = await deps.dsh.executeTool({ name: "agent_teams_task", arguments: { action: "claim", task_id: splitTaskId, claimant: SPLITTER_MEMBER }, agent: deps.captainAgent })
    if (!claimed.ok) return { splitTaskId, ownerRepaired: false, repairError: "the ownerless split ticket " + splitTaskId + " could not be claimed (" + String(claimed.error) + ") — repair it with `" + SPLIT_TICKET_REPAIR + "`", boardReadable: true }
    return { splitTaskId, ownerRepaired: true, repairError: "", boardReadable: true }
  } catch (error) {
    return { splitTaskId, ownerRepaired: false, repairError: "the ownerless split ticket " + splitTaskId + " could not be claimed (" + (error instanceof Error ? error.message : String(error)) + ") — repair it with `" + SPLIT_TICKET_REPAIR + "`", boardReadable: true }
  }
}
