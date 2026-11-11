// CELLWORK STAGING — the planning team `cellwork_start` stages and approves (contract B4, Amendment 3).
//
// WHAT IS STAGED: TWO members and TWO tasks at the minimum, not one. `cell-planner` runs the Socratic
// requirements interview; `cell-splitter` turns the agreed document into the measured graph. The split
// task is BLOCKED BY the requirements task, so the splitter cannot start before the interview closes —
// and the splitter is a real agent with a real task rather than a duty quietly moved into the captain's
// lane, which is exactly what clause 1 (dispatch-only captain) forbids.
//
// THE PLANNING PHASE FANS OUT (contract §5.1): `cellwork.planning.analysts` (default 2, `0..8`) adds
// `cell-analyst-1 … cell-analyst-K` seats, alternating the read-only roster roles Explorer and Researcher,
// each with ONE `analysis-<i>` board task that charges it to reconnoitre and MAIL its findings to both
// planning seats. The split task is blocked by the requirements task AND every analysis task, so the
// graph is drawn from evidence rather than from the splitter's guesses. `analysts = 0` stages exactly the
// two-seat planning phase this module shipped before, byte for byte in shape.
//
// HOW A MEMBER GETS ITS DISCIPLINE. Team members get NO roster persona from the harness: the executor
// raises them by label and no roster row answers `cell-planner`. The persona TEXT therefore travels in the
// member's PROMPT, and the member's `role` (`Planner` / `Lead` / `Explorer` / `Researcher`) is what the
// team executor uses to route it on the right `agentRoutes` slot (a roster name it cannot match inherits
// the staging session's route).
//
// EVERY TEAM WRITE GOES THROUGH `dsh.executeTool({name:"agent_teams_*"})` — the captain's own session runs
// these calls, so the plan lands under the captain's identity exactly as a manual staging would.
import type { DshAdapter } from "../../mpd-dsh-adapter-plugin/src/index"
import { DEFAULT_CELLWORK_CONFIG, type CellworkConfig } from "./config"
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

/** The board-name prefix of one analysis lane: the lane at 1-based index `i` is `cell-analyst-<i>`. */
export const ANALYST_MEMBER_PREFIX = "cell-analyst-"

/** The upper bound of `cellwork.planning.analysts`; a value outside `0..8` falls back to the default (§3). */
export const MAX_PLANNING_ANALYSTS = 8

/**
 * The read-only roster roles the analysis lanes ALTERNATE between, in lane order (contract §5.1).
 *
 * Both are roster names whose own discipline denies every write tool, so an analysis lane can never
 * freeze a scope by editing the tree it was sent to read — the splitter's own `writeScopes` stay the
 * only description of who may write what.
 */
export const ANALYST_ROLES: readonly string[] = ["Explorer", "Researcher"]

/**
 * How many analysis lanes one cell stages: `cellwork.planning.analysts`, clamped to `0..8`.
 *
 * The config resolver already validates the knob and logs a refused value; this guard exists because the
 * value decides the SHAPE of the staged team, and a non-integer or out-of-range count would stage a seat
 * called `cell-analyst-2.5`. A value the plan cannot express falls back to the shipped default, never to
 * "stage nothing".
 *
 * @param config - the resolved knobs, read through the ONE `CellworkConfig` field the §3 table names.
 * @returns the accepted count, `0..8`.
 */
export function planningAnalystCount(config: Pick<CellworkConfig, "planningAnalysts">): number {
  /** The declared count. */
  const declared = config.planningAnalysts
  if (!Number.isInteger(declared) || declared < 0 || declared > MAX_PLANNING_ANALYSTS) return DEFAULT_CELLWORK_CONFIG.planningAnalysts
  return declared
}

/**
 * The board name of the analysis lane at 1-based index `i` (contract §5.1 names them `cell-analyst-<i>`).
 *
 * @param index - the lane's 1-based position in the staged order.
 * @returns the member name the board and the cell record carry.
 */
export function analystMemberName(index: number): string {
  return ANALYST_MEMBER_PREFIX + String(index)
}

/**
 * The roster role the analysis lane at 1-based index `i` is raised with: {@link ANALYST_ROLES} alternating.
 *
 * The FIRST lane is always `Explorer` (it finds the files and the code) and the second `Researcher` (it
 * collects the evidence), so a two-lane cell — the default — gets one of each rather than two of the same.
 *
 * @param index - the lane's 1-based position in the staged order.
 * @returns the roster role label.
 */
export function analystRole(index: number): string {
  return ANALYST_ROLES[(index - 1) % ANALYST_ROLES.length] ?? ANALYST_ROLES[0] ?? "Explorer"
}

/**
 * The subject of the analysis lane's board task: `analysis-<i>`, which is also the split task's blocker
 * reference at staging (the plan resolves a `blocked_by` entry by SUBJECT, never by board id).
 *
 * @param index - the lane's 1-based position in the staged order.
 * @returns the task subject.
 */
export function analysisTaskSubject(index: number): string {
  return "analysis-" + String(index)
}

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
  /** Every planning member this staging raised, keyed by board name (planner, splitter, analysts). */
  members?: Record<string, CellMemberRecord>
  /** The board ids staging records for later lookups; the analysis lanes are found by subject on the board. */
  tasks?: { requirementsId?: string; splitId?: string }
  /**
   * Whether this call CLAIMED an ownerless split ticket for `cell-splitter` (contract C11).
   *
   * A plan approval can post the split ticket with no owner (defect D2); staging repairs that itself, so
   * the requirements-update path can still find and re-dispatch the SAME row (defect D3).
   */
  ownerRepaired?: boolean
  /**
   * The sentence an OWNERLESS split ticket's repair reported, when the claim was refused (contract C11).
   *
   * Kept APART from `error` on purpose (CR #6): the ticket's board id is still recorded and still
   * resolvable by the id-first lookup, so the caller can journal "row known, owner missing" instead of
   * losing the id along with the failed repair.
   */
  ownerRepairError?: string
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
 * @param deps - the cell, the persona reader and the analysis lanes this cell actually staged (their board names).
 * @returns the prompt text.
 */
export function plannerPrompt(deps: Pick<StageDeps, "cell" | "personaFor"> & { planningSeats: readonly string[] }): string {
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
    "1. Ask the USER ONE question at a time. Never bundle questions — this rule is about the interview ONLY;",
    "   it never limits how many AGENTS you consult, delegate to or mail at once (see MAXIMUM PARALLELISM).",
    "2. When the answer arrives, REFLECT IT BACK in one sentence and ask for confirmation when it changes scope.",
    "3. Surface EDGE CASES explicitly: failure modes, empty states, who is NOT served, what is out of scope.",
    "4. Agree a DEFINITION OF DONE (acceptance criteria a verifier could check), not adjectives.",
    "5. Close only when all six sections are filled: " + REQUIRED_SECTION_NAMES.join(" · ") + ".",
    "",
    "THE RELAY (you cannot talk to the user directly):",
    "- Ask the captain with ONE STRUCTURED question: `cellwork_send {to:\"captain\", subject, body, kind:\"question\",",
    "  options:[{label:\"A. …\"},{label:\"B. …\"}]}`. The offered labels are what the captain relays to the user,",
    "  so give every label its own ordinal (`A. …`, `B. …`) and state in `body` what you need decided.",
    "- Read the captain's reply with `cellwork_inbox`: it renders the `answer` block with the selected label(s)",
    "  VERBATIM. Answer the captain the same way: `kind:\"answer\", replyTo:<the question's message id>, selected:[…]`.",
    "- Then WAIT for the captain's answer. Do not invent an answer, do not proceed on an assumption.",
    "- If reconnaissance is needed before you can ask a good question, call `cellwork_recon`",
    "  {role:\"Explorer\"|\"Researcher\", task} — a one-shot READ-ONLY consult; you get its report back. Pass",
    "  `questions:[…]` (1..8) instead of `task` to settle several at once.",
    "  For side-work you do not have to read immediately, `cellwork_delegate` starts a BATCH of BACKGROUND",
    "  consults in one call (the per-call bound is `cellwork.delegate.maxTasks`) and returns their ids; collect",
    "  them with `cellwork_consult`.",
    // C5/D15, ruling R2: the delegation block is EXPORTED by `prompts.ts` (lane E owns that file) and
    // spliced here, in the PLANNER prompt only. The block opens and closes with an empty line.
    ...PLANNER_RECON_LINES,
    "MAXIMUM PARALLELISM — MANY agents is the default, FEW is never the optimisation:",
    // THE ANALYSIS LANES ARE NAMED ONLY WHEN THEY EXIST (CodeRabbit #108): with
    // `cellwork.planning.analysts=0` the staging pass raises no analyst at all, so the old unconditional
    // "ALREADY running" claim sent the planner looking for reports nobody would ever send.
    ...(deps.planningSeats.length === 0 ? [] : [
      "- The analysis lanes " + deps.planningSeats.map((name) => "`" + name + "`").join(" · ") + " are ALREADY running for you and mail their findings",
      "  to you and to `cell-splitter`. Do not re-derive what they were sent for, and do not wait idle for them:",
      "  keep interviewing while they work.",
    ]),
    "- Fan the analysis OUT: `cellwork_recon` {role, questions:[…]} settles SEVERAL questions in one call, and",
    "  `cellwork_delegate` starts a BATCH of background consults in ONE call. Run INDEPENDENT investigations",
    "  CONCURRENTLY — never one-at-a-time — and start every lane the objective's unknowns justify.",
    "- DO NOT reduce the number of agents, lanes or consults to save tokens: MORE AGENTS IS THE DEFAULT, and",
    "  token economy is explicitly not a constraint of this mode. The only budget that binds you is the",
    "  per-TASK context measurement the splitter applies to the graph — never the number of agents you raise.",
    "- `cellwork_consult` {action:\"list\"|\"wait\"|\"collect\"|\"cancel\"} is how you settle them. A failed or",
    "  abandoned lane is REPORTED to the captain, who closes it — it is never a reason to start fewer lanes.",
    "",
    "THE DOCUMENT: write `<cell>/requirements.md` under the cell directory with these headings exactly:",
    "  ## Goal · ## Non-goals · ## Users / consumers · ## Constraints · ## Acceptance criteria · ## Open questions",
    "Every section must carry real content; an empty section will be refused.",
    "Then call `cellwork_requirements {action:\"finalize\"}` (pass `content` instead of writing the file if that",
    "is easier). A finalized revision unblocks the splitter.",
    "",
    "YOUR TOOLS: `cellwork_recon`, `cellwork_delegate`, `cellwork_consult`, `cellwork_requirements`,",
    "`cellwork_status`, `cellwork_send`/`agent_teams_mail`.",
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
    "  {key, subject, description, kind, ownerRole, member, writeScopes, blockedBy, inputs, verify}",
    "  · key: stable (`T1`, `auth-core`, …); it becomes the contract file name.",
    "  · kind: requirement | work | review | repair | integration (omitted means work).",
    "  · ownerRole: a ROSTER role name (Senior Engineer, Deep Worker, Junior Engineer, Reviewer, …) or a cell",
    "    role (cell-planner, cell-splitter). It is the role the executor routes the member by.",
    "  · member: the BOARD MEMBER the task is raised for — THE PARALLELISM SWITCH. Omit it and the role",
    "    spelling IS the member, so that role runs ONE seat and its tasks queue behind one another. Name it",
    "    (`Reviewer-2`, `Reviewer-3`, …) and THAT NAME is a separate seat, so several seats may share one",
    "    ownerRole and run at the same time. Tasks that can be ready at the SAME time on one ownerRole MUST",
    "    declare DIFFERENT member names; tasks that are ordered by the graph may share one.",
    "  · writeScopes: the paths the task will touch; code tasks MUST declare them.",
    "  · blockedBy: an array of task KEYS ([] is an explicit root) — or `independent: true`. A task that",
    "    answers neither is refused.",
    "  · inputs: workspace-relative file paths the owner must read. THE PLUGIN MEASURES THEM (`stat` + a",
    "    16 KiB sample), so a huge file is refused with real bytes instead of a guess.",
    "  · verify: true for every code-producing task. EACH verify:true TASK NEEDS EXACTLY ONE review task",
    "    whose `kind` is \"review\", whose `blockedBy` contains that task's key, and whose ownerRole is a",
    "    DIFFERENT role — the verifier must not be the writer.",
    "",
    "SEATS: at most `cellwork.seats.maxPerRole` (" + String(deps.config.seatsMaxPerRole) + ") seats per base role and `cellwork.seats.max` (" + String(deps.config.seatsMax) + ") execution",
    "seats per cell, planning seats excluded. Aim the graph BELOW both caps: a role whose ready tasks outnumber",
    "its declared members is serialised, and the plugin will say so as a NON-FATAL warning (role, width,",
    "declared names) on the verdict you get back — it never refuses the graph for it.",
    "",
    "NEVER reduce the number of agents or lanes to save tokens: a larger, more parallel graph is the GOAL,",
    "and graph size is not a cost here. The only thing the budget bounds is ONE task's size.",
    "",
    "TWO HARD GRAPH RULES: the dependency graph must be ACYCLIC, and two tasks may share a write scope only",
    "when a dependency edge orders them (otherwise one task must cut its scope or depend on the other).",
    "",
    "THE BUDGET (the plugin enforces it, you cannot argue with it): each task's measured estimate must fit",
    "`floor(window * " + String(deps.config.windowFraction) + ")` AND leave room for the model's max output plus " + String(deps.config.compactionHeadroomTokens) + " tokens of",
    "compaction headroom inside the model's own context window. The window is READ from the model catalog,",
    "never assumed. Tasks owned by the same role share that role's route.",
    "IT BOUNDS ONE TASK'S SIZE — never the task COUNT and never the number of seats or agents you declare.",
    "A REFUSAL RETURNS A PER-TASK BREAKDOWN (input bytes → tokens, budget, excess). Do not resubmit the same",
    "graph: SPLIT the task (into MORE parallel tasks, not fewer), cut the declared inputs, or move work to a",
    "larger-window owner role.",
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
 * One analysis lane's instantiation prompt: what to reconnoitre and the MAIL duty that closes it (§5.1).
 *
 * Read-only on purpose: the lane's product is a FINDING the planner quotes into the requirements document
 * and the splitter turns into `writeScopes`/`inputs`, so a lane that edited the tree would be describing
 * its own change instead of the repository it was sent to read.
 *
 * @param deps - the cell and the persona reader.
 * @param index - the lane's 1-based position in the staged order.
 * @returns the prompt text.
 */
export function analystPrompt(deps: Pick<StageDeps, "cell" | "personaFor">, index: number): string {
  /** The lane's board name, which is also the name the board dispatches it by. */
  const name = analystMemberName(index)
  /** The lane's roster role: Explorer on the first lane, Researcher on the second, alternating. */
  const role = analystRole(index)
  /** That role's persona text, when the roster service answered. */
  const persona = deps.personaFor(role)
  return [
    ...(persona === null ? [] : [persona, ""]),
    "[mpd-cellwork] You are " + name + ", analysis lane " + String(index) + " of cell " + deps.cell.cellId + ".",
    "",
    "OBJECTIVE (the user's own words):",
    deps.cell.objective,
    "",
    "YOUR JOB: RECONNOITRE the workspace for the facts the requirements interview and the task split are",
    "missing, then REPORT them. You are a READ-ONLY lane: never write, edit, rename or move a file, never run",
    "a mutating command, and never own a code task. A finding is a path, the excerpt that matters and the",
    "conclusion — not a tour of the repository.",
    "",
    "WHAT TO ANSWER FIRST (then follow whatever the objective makes urgent):",
    "1. WHERE the objective's code already lives: the packages, entry points, tests and the file that would",
    "   change first, with line references.",
    "2. WHICH gates and tests already exist that a task's verifier must run, and where they are declared.",
    "3. WHAT must be EXTENDED rather than re-created, and which existing patterns the implementation follows.",
    "4. WHICH constraints would change the SPLIT itself: shared files, generated code, `dist/`, migrations,",
    "   lockfiles — anything two writers would collide on.",
    "",
    "MAIL THE FINDINGS — one message to EACH planning seat, never one message per fact:",
    "  `cellwork_send {to:\"cell-planner\", subject:\"analysis-" + String(index) + ": <one line>\", body:\"<findings>\"}`",
    "  `cellwork_send {to:\"cell-splitter\", subject:\"analysis-" + String(index) + ": <one line>\", body:\"<findings>\"}`",
    "Then close your own board task: `agent_teams_task {action:\"complete\", task_id:<this task's id>}`.",
    "If the objective is too wide for one lane, FAN OUT instead of narrowing your pass: `cellwork_delegate`",
    "starts background read-only consults (Explorer/Researcher) in ONE call, and independent consults run",
    "concurrently. More lanes is the default; token economy is not a constraint of this mode.",
    "",
    "YOUR TOOLS: `read`, `grep`, `glob`, `cellwork_send`, `cellwork_inbox`, `cellwork_delegate`,",
    "`agent_teams_task`. You cannot write files, you do not ask the user questions, and—because you are a",
    "READ-ONLY lane—you judge the tree as you find it rather than changing it.",
  ].join("\n")
}

/**
 * The analysis task's acceptance text handed to the lane at staging (§5.1): reconnoitre, mail, close.
 *
 * @param cell - the cell being started.
 * @param index - the lane's 1-based position in the staged order.
 * @returns the task description.
 */
export function analystTaskDescription(cell: CellState, index: number): string {
  return [
    "Analysis lane " + String(index) + " of cell " + cell.cellId + ": reconnoitre the objective and report the",
    "facts the requirements interview and the task split are missing.",
    "Answer, with paths and line references: where the existing code lives, which gates/tests already cover",
    "it, what must be extended rather than re-created, and which shared files constrain the split.",
    "MAIL the findings to `cell-planner` AND `cell-splitter` (`cellwork_send`) before you finish.",
    "You are READ-ONLY: write no file and own no code task.",
    "CLOSE THE TASK with `agent_teams_task {action:\"complete\", task_id:<this task>}` once both mails are sent.",
  ].join("\n")
}

/**
 * One planning seat: its board name, the roster role it is routed by and the prompt it is raised with.
 *
 * A planning seat is a PLANNING seat: it is never a growth base and is never counted against
 * `cellwork.seats.max` (§5.1) — that count is about EXECUTION seats, and the analysis lanes belong to the
 * phase that decides what the execution seats will be.
 */
interface PlanningSeat {
  /** The board name (`cell-planner`, `cell-splitter`, `cell-analyst-<i>`). */
  name: string
  /** The roster role label the team executor routes the seat by. */
  role: string
  /** The instantiation prompt the seat's discipline travels in (a team member gets no roster persona). */
  prompt: string
}

/**
 * The lane index one analysis task subject names (`analysis-<i>`), or 0 when it names no lane.
 *
 * @param subject - a staged task subject, as the plan slot or the board carries it.
 * @returns the 1-based lane index, or 0.
 */
function analysisLaneOfSubject(subject: string): number {
  /** The subject's own tail, when it is a lane subject. */
  const match = /^analysis-(\d+)$/.exec(subject.trim())
  return match === null ? 0 : Number(match[1] ?? 0)
}

/**
 * The lane index one analysis seat name names (`cell-analyst-<i>`), or 0 when it names no lane.
 *
 * @param name - a member name, as the plan slot or the roster carries it.
 * @returns the 1-based lane index, or 0.
 */
function analysisLaneOfMember(name: string): number {
  /** The name's own tail, when it is a lane name. */
  const match = new RegExp("^" + ANALYST_MEMBER_PREFIX + "(\\d+)$").exec(name.trim())
  return match === null ? 0 : Number(match[1] ?? 0)
}

/**
 * The task or member rows one untrusted plan/team record exposes under `key`.
 *
 * @param record - the record as the plan or team service answered it (any shape is tolerated).
 * @param key - `tasks` or `members`.
 * @returns the OBJECT rows, in record order; `[]` when the record is unusable or carries none.
 */
function rowsOf(record: unknown, key: string): unknown[] {
  if (typeof record !== "object" || record === null) return []
  /** The rows the record declares under that key. */
  const rows = (record as Record<string, unknown>)[key]
  if (!Array.isArray(rows)) return []
  return rows.filter((row) => typeof row === "object" && row !== null)
}

/**
 * The `subject` of every object row in one plan/board task list.
 *
 * @param rows - the rows, untrusted.
 * @returns the subjects, in row order (a row without one yields "").
 */
function subjectsOf(rows: readonly unknown[]): string[] {
  return rows.map((row) => typeof row === "object" && row !== null ? textField(row as ToolValue, "subject") : "")
}

/**
 * The `name` of every object row in one plan/roster member list.
 *
 * @param rows - the rows, untrusted.
 * @returns the names, in row order (a row without one yields "").
 */
function namesOfRows(rows: readonly unknown[]): string[] {
  return rows.map((row) => typeof row === "object" && row !== null ? textField(row as ToolValue, "name") : "")
}

/**
 * Every analysis-lane index one plan slot or live team record CARRIES (§5.1, the R2 resume repair).
 *
 * Both halves are read because a failed pass can leave either one behind: a member whose task never staged,
 * or a task whose member never raised. The union is what the seat/task agreement is enforced against.
 *
 * @param subjects - the carriers' task subjects.
 * @param members - the carriers' member names.
 * @returns the lane indices, ascending and deduplicated; `[]` when no lane is carried.
 */
export function carriedAnalysisLanes(subjects: Iterable<string>, members: Iterable<string>): number[] {
  /** The lanes found on either half. */
  const lanes = new Set<number>()
  for (const subject of subjects) {
    /** The lane that subject names, when it names one. */
    const lane = analysisLaneOfSubject(subject)
    if (lane > 0) lanes.add(lane)
  }
  for (const member of members) {
    /** The lane that member name names, when it names one. */
    const lane = analysisLaneOfMember(member)
    if (lane > 0) lanes.add(lane)
  }
  return [...lanes].sort((left, right) => left - right)
}

/**
 * The analysis-lane set one staging pass must converge on.
 *
 * WHY THE CARRIED SET WINS (the R2 finding, both halves of it): the configured count is an INTENT for a
 * plan slot that carries no lane yet; once a slot carries lanes, those lanes are the FACT an earlier
 * attempt staged, and the slot's split row was created with exactly them as blockers. Growing the set on a
 * resume would append an analysis row the already-staged split row is NOT blocked by — its `blockedBy` is
 * frozen at creation and cannot be rewritten in place — letting the splitter wake before that lane settles
 * and breaching §5.1's "blocked by every analysis task". Shrinking never applies either: a lane the slot
 * carries keeps its seat and its row, because the work it was charged with is still pending.
 *
 * @param configured - `cellwork.planning.analysts` as resolved for THIS call (the fresh-slot intent).
 * @param carried - the lanes the plan slot or the live team already carries.
 * @returns the lanes to stage, ascending.
 */
export function convergedAnalysisLanes(configured: number, carried: readonly number[]): number[] {
  if (carried.length > 0) return [...carried].sort((left, right) => left - right)
  /** The configured lanes, for a slot that carries none yet (the fresh shape). */
  const lanes: number[] = []
  for (let index = 1; index <= configured; index += 1) lanes.push(index)
  return lanes
}

/**
 * The blocker subjects one staged split row declares, or undefined when its row does not expose them.
 *
 * The plan dialect may spell them `blockedBy` or `blocked_by`; a row that exposes NEITHER is UNPROVEN, not
 * stale, so an unknown slot shape must never refuse a plan a previous build staged.
 *
 * @param row - the staged split row.
 * @returns the declared blockers, or undefined when the row carries no list.
 */
function planBlockersOf(row: ToolValue): string[] | undefined {
  for (const key of ["blockedBy", "blocked_by"]) {
    /** The declared value under that spelling. */
    const value = row[key]
    if (Array.isArray(value)) return value.map((entry) => String(entry))
  }
  return undefined
}

/**
 * Every planning seat one staging pass stages, in board order: the planner, the splitter, then the lanes.
 *
 * ONE list is the source of truth for the four places staging needs the same seats — the plan's
 * `add_member` calls, the repair append on the recovery path, the task half of the seat/task agreement, and
 * the member rows the cell record keeps — so a resumed start can never stage a different shape from the
 * shape the plan slot already holds.
 *
 * @param deps - the cell, the persona reader and the knobs.
 * @param lanes - the analysis lanes to seat, ascending (see {@link convergedAnalysisLanes}).
 * @returns the seats in the order they are staged.
 */
function planningSeats(deps: StageDeps, lanes: readonly number[]): PlanningSeat[] {
  /** The two permanent seats: the interviewer and the graph designer. */
  const seats: PlanningSeat[] = [
    { name: PLANNER_MEMBER, role: PLANNER_ROLE, prompt: plannerPrompt({ cell: deps.cell, personaFor: deps.personaFor, planningSeats: lanes.map((lane) => analystMemberName(lane)) }) },
    { name: SPLITTER_MEMBER, role: SPLITTER_ROLE, prompt: splitterPrompt(deps) },
  ]
  /** The analysis lanes, alternating the two read-only roster roles (§5.1). */
  for (const lane of lanes) {
    seats.push({ name: analystMemberName(lane), role: analystRole(lane), prompt: analystPrompt(deps, lane) })
  }
  return seats
}

/**
 * Stage and approve the planning team (idempotent for an already-staged cell): the planner and the
 * splitter, plus one analysis lane per `cellwork.planning.analysts` (§5.1).
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
      // A REFUSED REPAIR IS REPORTED, never swallowed (CR #6): the id above is still recorded, and the
      // caller journals that the row is KNOWN but still UNOWNED.
      ...(ticket.repairError === "" ? {} : { ownerRepairError: ticket.repairError }),
      ...(record === undefined ? {} : {
        // A RESUMED RECORD REPORTS THE SHAPE IT HOLDS (R2 repair): the lanes are read from the live record's
        // own rows, so a knob change between two calls cannot make this branch claim a seat that was never
        // staged (or hide one that was).
        members: Object.fromEntries(planningSeats(deps, resumedLanes(record)).map((seat) => [seat.name, planningMemberRow(seat.name, seat.role, deps.cell, deps.now)])),
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
    // THE LANE SET A RECOVERY CONVERGES ON (R2 repair, half b): what the LIVE team already carries. The
    // configured count is NOT consulted here — a lane appended now would be a board row the already
    // resolved split ticket is not blocked by, so the approved team's own shape is the authority.
    /** The lanes the live team carries, as its board subjects and roster names declare them. */
    const recoveredLanes = carriedAnalysisLanes(subjectsOf(rowsOf(liveTeam, "tasks")), namesOfRows(roster))
    /** The planning rows recovered from that roster, keyed by name. */
    const recovered: Record<string, CellMemberRecord> = {}
    for (const seat of planningSeats(deps, recoveredLanes)) {
      /** That member's live row, when the approval raised it. */
      const row = roster.find((candidate) => textField(candidate, "name") === seat.name)
      if (row !== undefined) {
        recovered[seat.name] = livePlanningMemberRow(seat.name, seat.role, textField(row, "executorRef") === "" ? textField(row, "id") : textField(row, "executorRef"), deps.cell, deps.now)
        continue
      }
      // THE REPAIR THE FINDING ASKS FOR: the approval stopped before raising this member. A live team's
      // Lead may append it, so the failed row is repaired instead of re-approving the whole plan.
      /** That repair append. */
      const appended = await call({ action: "add_member", member: { name: seat.name, role: seat.role, description: seat.name + " (" + seat.role + ")", prompt: seat.prompt } })
      if (!appended.ok) {
        return { ok: false, error: "the planning team " + recoveredId + " is approved but " + seat.name + " could not be raised: " + appended.error, planName, teamId: recoveredId, partial: true }
      }
      recovered[seat.name] = livePlanningMemberRow(seat.name, seat.role, textField(appended.value, "spawned"), deps.cell, deps.now)
    }
    // EVERY RECOVERED SEAT MUST OWN ITS BOARD ROW (R2 repair, half b): repairing a missing lane MEMBER
    // without its `analysis-<i>` task leaves a seat with nothing to do, which is the finding's exact shape.
    // The missing row is appended to the LIVE team (the same verb `cellwork_activate` appends with).
    /** The subjects the live board already carries, so an existing lane row is never duplicated. */
    const liveSubjects = new Set(subjectsOf(rowsOf(liveTeam, "tasks")))
    for (const lane of recoveredLanes) {
      /** The lane's task subject. */
      const subject = analysisTaskSubject(lane)
      if (liveSubjects.has(subject)) continue
      /** The live append of the lane's missing row. */
      const appendedTask = await call({ action: "create_task", task: { subject, description: analystTaskDescription(deps.cell, lane), kind: "work", owner: analystMemberName(lane), blocked_by: [] } })
      if (!appendedTask.ok) {
        return { ok: false, error: "the planning team " + recoveredId + " is approved but " + subject + " could not be staged for " + analystMemberName(lane) + ": " + appendedTask.error, planName, teamId: recoveredId, partial: true }
      }
    }
    // THE RECOVERED TEAM'S SPLIT TICKET IS RESOLVED HERE TOO (contract C11): the approval had already
    // run, so no `create_task` answer carries its id — the board read is the only place it exists.
    /** The staged split ticket, resolved by the recorded id first and by its owner second. */
    const recoveredTicket = await resolveSplitTicket(deps, recoveredId, "", false)
    if (recoveredTicket.boardReadable && recoveredTicket.splitTaskId === "") return { ok: false, error: "the planning team " + recoveredId + " is approved but " + recoveredTicket.repairError, teamId: recoveredId, members: recovered, planName, partial: true }
    return { ok: true, alreadyStaged: true, teamId: recoveredId, members: recovered, tasks: { splitId: recoveredTicket.splitTaskId }, planName, ...(recoveredTicket.ownerRepaired ? { ownerRepaired: true } : {}), ...(recoveredTicket.repairError === "" ? {} : { ownerRepairError: recoveredTicket.repairError }) }
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
  // THE LANE SET THIS PASS CONVERGES ON (R2 repair, half a): the lanes the SLOT already carries when it
  // carries any, so a resume never appends an analysis row the slot's own split row is not blocked by —
  // and never re-reads the knob into a shape the slot cannot be re-blocked for.
  /** The lanes the plan slot carries, read from its subjects AND its member names. */
  const stagedLanes = convergedAnalysisLanes(planningAnalystCount(deps.config), carriedAnalysisLanes(subjectsOf(rowsOf(plan, "tasks")), namesOfRows(rowsOf(plan, "members"))))
  /** The seats this cell stages, in board order; every one of them owns at least one staged task. */
  const seats = planningSeats(deps, stagedLanes)
  // A SLOT'S SPLIT ROW CANNOT BE RE-BLOCKED IN PLACE, so a row whose DECLARED blockers omit a lane this
  // pass would otherwise rely on is refused instead of silently trusted: §5.1 says the splitter waits for
  // every analysis task, and a slot that does not expose its blockers at all proves nothing and refuses
  // nothing. A shape this build cannot produce is the only way here, hence the delete-and-retry repair.
  /** The split row the slot already carries, when an earlier attempt staged one. */
  const stagedSplit = rowsOf(plan, "tasks").find((row) => textField(row as ToolValue, "subject") === SPLIT_TASK_SUBJECT) as ToolValue | undefined
  /** The blockers that row declares, or undefined when the slot does not expose them. */
  const declaredBlockers = stagedSplit === undefined ? undefined : planBlockersOf(stagedSplit)
  // THE UNPROVEN DIALECT IS AN ACKNOWLEDGED BYPASS, NOT AN OVERSIGHT. Exactly TWO spellings are recognized —
  // `blockedBy` and `blocked_by`, the shapes this bundle's own plan rows carry — and a slot whose split row
  // exposes NEITHER reads as UNPROVEN, so the stale check below is SKIPPED for it: such a plan is trusted
  // as it was before this guard existed, which is how a host writing a THIRD spelling BYPASSES the guard by
  // design. THE TRADE: refusing an unproven row would wedge every plan a differently-spelled host staged, on
  // a condition this plugin cannot observe — so UNPROVEN BEATS WEDGED, and the honest bound is this sentence
  // (with `planBlockersOf`'s own doc) rather than a refusal no evidence could justify.
  /** The lanes the carried split row does NOT name, computed only from a declared list. */
  const unblockedLanes = declaredBlockers === undefined ? [] : stagedLanes.map(analysisTaskSubject).filter((subject) => !declaredBlockers.includes(subject))
  if (unblockedLanes.length > 0) {
    return { ok: false, error: "the plan slot's split row is not blocked by " + unblockedLanes.join(", ") + ", so the splitter could wake before those analysis lanes settle (§5.1) — a staged split row cannot be re-blocked in place; delete this cell's plan with `agent_teams_plan {action:\"delete\"}` and call `cellwork_start` again", planName, partial: true }
  }
  /** The seats, staged before the tasks so every owner resolves. */
  for (const seat of seats) {
    if (presentMembers.has(seat.name)) continue
    /** One member append. */
    const appended = await call({ action: "add_member", member: { name: seat.name, role: seat.role, description: seat.name + " (" + seat.role + ")", prompt: seat.prompt } })
    if (!appended.ok) return { ok: false, error: "cellwork could not stage " + seat.name + ": " + appended.error, planName, partial: true }
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
  // THE ANALYSIS LANES ARE ROOTS AND WRITE NOTHING (§5.1): each one reads the objective and mails its
  // findings, so `blocked_by: []` and no write scope are the honest declaration, not an omission. The plan
  // tool's own advisory about a scope-less `work` row is expected here and changes nothing about the split
  // graph, whose write scopes are what the splitter declares later.
  for (const lane of stagedLanes) {
    /** The lane's task subject, which is also its knob for the split task's blockers. */
    const subject = analysisTaskSubject(lane)
    if (presentSubjects.has(subject)) continue
    /** The lane's task append. */
    const analysis = await call({
      action: "create_task",
      task: { subject, description: analystTaskDescription(deps.cell, lane), kind: "work", owner: analystMemberName(lane), blocked_by: [] },
    })
    if (!analysis.ok) return { ok: false, error: "cellwork could not stage analysis task " + subject + ": " + analysis.error, planName, partial: true }
  }
  /** The split task, blocked by the requirements task AND every analysis lane (§5.1). */
  if (!presentSubjects.has(SPLIT_TASK_SUBJECT)) {
    /** The blocker subjects, in staging order: the interview, then EVERY converged analysis lane. */
    const blockers: string[] = [REQUIREMENTS_TASK_SUBJECT, ...stagedLanes.map(analysisTaskSubject)]
    /** The split row append. */
    const split = await call({
      action: "create_task",
      task: { subject: SPLIT_TASK_SUBJECT, description: splitterTaskDescription(deps.cell), kind: "work", owner: SPLITTER_MEMBER, blocked_by: blockers },
    })
    if (!split.ok) return { ok: false, error: "cellwork could not stage the split task: " + split.error, planName, partial: true }
  }
  /** The approval, which raises the seats and mints the record — ONE approve for the whole planning team. */
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
  /** Every planning member row, for the seats the approval actually raised (planner, splitter, analysts). */
  const members: Record<string, CellMemberRecord> = {}
  for (const row of raised) {
    /** The staged seat that row answers, or undefined for a row this staging never asked for. */
    const seat = seats.find((candidate) => candidate.name === row.name)
    if (seat === undefined) continue
    members[row.name] = {
      name: row.name,
      role: seat.role,
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
  // Its POSITION in the answer is requirements → analysis-1…K → split, so the positional fallback (used
  // only when the answer carried no subject) must follow the STAGED analyst count, not a fixed index.
  /** The id the approval's own answer named for the split ticket, or "". */
  const answeredSplitId = postedId(SPLIT_TASK_SUBJECT) === "" ? (posted[stagedLanes.length + 1]?.id ?? "") : postedId(SPLIT_TASK_SUBJECT)
  /** The staged split ticket, resolved by that id first and by its owner second. */
  const ticket = await resolveSplitTicket(deps, teamId, answeredSplitId, true)
  /** The id this staging records: the board read is authoritative, the approval's answer the fallback. */
  const splitId = ticket.splitTaskId === "" ? answeredSplitId : ticket.splitTaskId
  // A MISSING TICKET IS A HARD ERROR only when the board WAS readable and carried none: an unreadable
  // record proves nothing, so the approval's own answer is recorded instead of refusing a staged team.
  if (ticket.boardReadable && splitId === "") return { ok: false, error: "the planning team " + teamId + " was approved but " + ticket.repairError, teamId, members, planName, partial: true }
  if (ticket.repairError !== "") {
    // THE ID SURVIVES A FAILED REPAIR (CR #6): the split ticket is still BLOCKED by the requirements row
    // right after approval, so the claim legitimately fails. The id is answered anyway — that is what keeps
    // the ID-first lookup (C11) alive for every later retry — while the refusal keeps naming the repair
    // verb and `ownerRepairError` carries the reason the caller journals BESIDE the recorded id.
    return { ok: false, error: ticket.repairError, teamId, members, planName, tasks: { splitId }, ownerRepairError: ticket.repairError, partial: true }
  }
  return {
    ok: true,
    teamId,
    members,
    tasks: { requirementsId: postedId(REQUIREMENTS_TASK_SUBJECT), splitId },
    ...(ticket.ownerRepaired ? { ownerRepaired: true } : {}),
  }
}

/**
 * The analysis lanes one LIVE record a resumed start reports, read from its own task and member rows.
 *
 * A small wrapper so the idempotent arm names the rule ONCE: the configured count is the intent a FRESH slot
 * is staged from, never a description of a record that already exists.
 *
 * @param record - the live team record, as the team service answered it (any shape is tolerated).
 * @returns the lanes to report, ascending.
 */
function resumedLanes(record: unknown): number[] {
  return carriedAnalysisLanes(subjectsOf(rowsOf(record, "tasks")), namesOfRows(rowsOf(record, "members")))
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
 * The row is rebuilt field by field from the one the cell already carries, so the additive `adopted`
 * marker (contract B1) is carried EXPLICITLY — a rebuild must never make an adopted row read as staged.
 *
 * @param name - the member's board name.
 * @param role - its roster role label.
 * @param cell - the cell being started.
 * @param now - the instant to stamp.
 * @returns the member row with empty handles, which `callerContext` fills from the live record.
 */
function planningMemberRow(name: string, role: string, cell: CellState, now: Date): CellMemberRecord {
  /** The row the cell already carries under this name, whose additive markers must survive the rebuild. */
  const known = cell.members[name]
  return { name, role, sessionId: known?.sessionId ?? "", executorRef: known?.executorRef ?? "", mode: "member", handoffReady: known?.handoffReady ?? false, handoffs: known?.handoffs ?? 0, joinedAt: known?.joinedAt ?? now.toISOString(), ...(known?.adopted === true ? { adopted: true } : {}) }
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
