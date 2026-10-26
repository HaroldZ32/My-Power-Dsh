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
    "",
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
    return {
      ok: true,
      alreadyStaged: true,
      teamId: existingTeamId,
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
  /** The session's current plan/team state, read before anything is staged. */
  const status = await call({ action: "status" })
  if (!status.ok) return { ok: false, error: "cellwork could not read the session's team state: " + status.error }
  /** The plan already staged for this session, when one exists. */
  const staged = status.value.plan
  if (typeof staged === "object" && staged !== null) {
    /** The staged plan as a record. */
    const plan = staged as ToolValue
    if (typeof plan.approvedAt === "string" && plan.approvedAt !== "") {
      return { ok: false, error: "a team plan is already APPROVED in this session; cellwork needs the staging slot free — finish or archive that team first" }
    }
    /** How many rows that plan already carries. */
    const stagedRows = (Array.isArray(plan.members) ? plan.members.length : 0) + (Array.isArray(plan.tasks) ? plan.tasks.length : 0)
    if (stagedRows > 0) {
      return { ok: false, error: "a different team plan is already staged in this session (" + String(stagedRows) + " row(s)); approve or delete it before starting cellwork" }
    }
  } else if (typeof status.value.team === "object" && status.value.team !== null) {
    return { ok: false, error: "this session already drives team " + textField(status.value.team as ToolValue, "teamId") + "; cellwork requires its own fresh team" }
  }
  // No usable plan is staged: create one and fill it. `approval:"required"` is the default, and the
  // explicit approve call below is what executes it (nothing is spawned before that).
  if (typeof staged !== "object" || staged === null) {
    /** The creation answer. */
    const created = await call({ action: "create", name: "cell " + deps.cell.cellId, description: deps.cell.objective })
    if (!created.ok) return { ok: false, error: "cellwork could not stage the planning team: " + created.error }
  }
  /** The two members, staged before the tasks so both owners resolve. */
  for (const [name, role, prompt] of [
    [PLANNER_MEMBER, PLANNER_ROLE, plannerPrompt(deps)] as const,
    [SPLITTER_MEMBER, SPLITTER_ROLE, splitterPrompt(deps)] as const,
  ]) {
    /** One member append. */
    const appended = await call({ action: "add_member", member: { name, role, description: name + " (" + role + ")", prompt } })
    if (!appended.ok) return { ok: false, error: "cellwork could not stage " + name + ": " + appended.error }
  }
  /** The requirements task, an explicit root. */
  const requirements = await call({
    action: "create_task",
    task: { subject: REQUIREMENTS_TASK_SUBJECT, description: plannerTaskDescription(deps.cell), kind: "requirement", owner: PLANNER_MEMBER, blocked_by: [] },
  })
  if (!requirements.ok) return { ok: false, error: "cellwork could not stage the requirements task: " + requirements.error }
  /** The split task, blocked by the requirements task (by subject, which approval resolves). */
  const split = await call({
    action: "create_task",
    task: { subject: SPLIT_TASK_SUBJECT, description: splitterTaskDescription(deps.cell), kind: "work", owner: SPLITTER_MEMBER, blocked_by: [REQUIREMENTS_TASK_SUBJECT] },
  })
  if (!split.ok) return { ok: false, error: "cellwork could not stage the split task: " + split.error }
  /** The approval, which raises the two members and mints the record. */
  const approved = await call({ action: "approve" })
  if (!approved.ok) return { ok: false, error: "cellwork could not approve the planning team: " + approved.error }
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
  if (teamId === "") return { ok: false, error: "the planning team was approved but the answer carried no team id — inspect `agent_teams_plan {action:\"status\"}` before retrying" }
  if (stoppedAt !== "") {
    return { ok: false, error: "the planning team " + teamId + " was approved but a member could not be raised (" + stoppedAt + "); the record exists — inspect `agent_teams_plan {action:\"status\"}` and repair it", teamId, members }
  }
  return {
    ok: true,
    teamId,
    members,
    tasks: { requirementsId: posted[0]?.id, splitId: posted[1]?.id },
  }
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
