// The durable staged-plan store: the workflow the official plugin does not have.
//
// WHY IT EXISTS. The retired vendored plugin staged a team as a PLAN the user could read, edit
// and APPROVE before a single teammate existed, and froze each task's contract at claim time
// with a monotonic attempt counter. The official plugin has no such stage: `spawn_teammate`
// creates a teammate immediately and `team_task_create` posts a task immediately, so a captain
// that wants a review step has nowhere to put one. This store is that step — a sidecar under
// `<workspace>/.mpd/team/`, never a second source of team truth: the roster and the board stay
// the official service's, and this file only records what the user has staged, approved or
// halted.
//
// Everything here is PURE filesystem + plain data, so the whole state machine is unit-testable
// without a ctx, a harness or a model.
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

/** One member the plan wants. The prompt is what `spawn_teammate` will receive. */
export interface StagedMember {
  /** The teammate NAME the captain will address; `spawn_teammate` receives it verbatim. */
  name: string
  /** One-line role summary, shown in the staged plan for the user to read before approving. */
  description: string
  /** The full instantiation prompt `spawn_teammate` will receive once the plan is approved. */
  prompt: string
  /** Optional rostered role label, carried for readability — model routing does not read it. */
  role?: string
}

/** One shared task the plan wants posted after approval. */
export interface StagedTask {
  /** The task title that will be posted to the board after approval. */
  subject: string
  /** The acceptance text the assigned member receives — how the task is to be worked. */
  description: string
  /** Subjects of tasks that must close first; resolved to board ids when the task is created. */
  blockedBy?: string[]
  /** Paths the task is expected to touch, forwarded to the board's write-scope check. */
  writeScopes?: string[]
  /** Teammate name the captain wants to own it; the board resolves that name to a session. */
  owner?: string
}

/** The whole staged plan for one session. */
export interface StagedPlan {
  /** Format version; a reader refuses a record whose version it does not know. */
  version: 1
  /** Stable, sortable plan identity (`plan-<UTC instant>`), reused as the archive directory name. */
  planId: string
  /** The staging session: exactly ONE plan may be staged per session. */
  sessionId: string
  /** The team name the user reads at approval time. */
  name: string
  /** What the team is for, as the user reads it in the staged plan. */
  description: string
  /** Whether the plan waits for an explicit approval or may proceed automatically. */
  approval: "required" | "automatic"
  /** The teammates the plan wants spawned, in the order they were staged. */
  members: StagedMember[]
  /** The shared tasks the plan wants posted, in the order they were staged. */
  tasks: StagedTask[]
  /** ISO instant the plan was staged; the plan id is derived from it. */
  stagedAt: string
  /** ISO instant approval happened; absent means the plan is still awaiting one. */
  approvedAt?: string
  /** ISO instant the plan was discarded instead of approved. */
  discardedAt?: string
  /** What approval actually created, so a reader can reconcile plan with reality. */
  created?: { members: Array<{ name: string; id: string }>; tasks: Array<{ subject: string; id: string }> }
}

/** A task's frozen contract, written when the task is claimed. */
export interface TaskContract {
  /** Format version of the contract; a mismatch reads as "no contract". */
  version: 1
  /** The board task this contract freezes; its file name is derived from this id. */
  taskId: string
  /** The task title AS IT WAS at claim time, so the contract survives a later board edit. */
  subject: string
  /** The acceptance text frozen at claim time, which is what the attempt is judged against. */
  description: string
  /** The blockers recorded at claim time, copied so a later board edit cannot rewrite history. */
  blockedBy: string[]
  /** The write scopes recorded at claim time, copied for the same reason as the blockers. */
  writeScopes: string[]
  /** Monotonic per task: the Nth time this task was claimed. */
  attempt: number
  /** Session id of the member that claimed the task for this attempt. */
  claimedBy: string
  /** ISO instant of the claim; contracts are listed newest claim first. */
  claimedAt: string
  /** The board revision the contract was frozen at — the official plugin's own generation token. */
  revision: number
}

/** `.mpd/team` under the workspace: the bundle's own team sidecar root. */
export function teamRoot(workspace: string): string {
  return join(workspace, ".mpd", "team")
}

/** `<root>/staging`: one JSON file per session that has a staged plan. */
const stagingDir = (workspace: string): string => join(teamRoot(workspace), "staging")
/** The staging slot of ONE session — the file a new stage replaces and approval clears. */
const stagingPath = (workspace: string, sessionId: string): string => join(stagingDir(workspace), sessionId + ".json")
/** `<root>/contracts`: one frozen task contract per file. */
const contractsDir = (workspace: string): string => join(teamRoot(workspace), "contracts")
/** The contract file of ONE task, keyed by its board id. */
const contractPath = (workspace: string, taskId: string): string => join(contractsDir(workspace), taskId + ".json")
/** The single hold record; its presence IS the halted state. */
const holdPath = (workspace: string): string => join(teamRoot(workspace), "hold.json")
/** `<root>/archive`: archived plans, so a replaced or discarded plan is never truly lost. */
const archiveDir = (workspace: string): string => join(teamRoot(workspace), "archive")

/** Read one JSON file, or `undefined` when it is absent or unreadable. */
function readJson<T>(path: string): T | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T
  } catch {
    return undefined
  }
}

/** Write one JSON file, creating its directory. Throws only on a real write failure. */
function writeJson(path: string, value: unknown): void {
  mkdirSync(join(path, ".."), { recursive: true })
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n")
}

/** A stable, sortable identity for one staged plan. */
export function newPlanId(now: Date): string {
  return "plan-" + now.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)
}

/** The plan staged for one session, or `undefined` when nothing is staged. */
export function readPlan(workspace: string, sessionId: string): StagedPlan | undefined {
  /** The parsed staging slot; an absent or unreadable file means nothing is staged. */
  const plan = readJson<StagedPlan>(stagingPath(workspace, sessionId))
  return plan === undefined || plan.version !== 1 ? undefined : plan
}

/** Persist a plan (the caller owns its content). */
export function writePlan(workspace: string, plan: StagedPlan): void {
  writeJson(stagingPath(workspace, plan.sessionId), plan)
}

/**
 * Stage a new plan for one session, REPLACING any plan already staged there.
 *
 * Replacing is deliberate: a session has ONE staged team at a time (the retired plugin allowed
 * several, and the measured consequence was a captain that could not tell which one the user
 * was reading). `agent_teams_delete` archives the previous one rather than dropping it.
 */
export function stagePlan(
  workspace: string,
  sessionId: string,
  input: { name: string; description: string; approval: "required" | "automatic" },
  now: Date,
): StagedPlan {
  /** The plan already staged for this session, if any. */
  const existing = readPlan(workspace, sessionId)
  if (existing !== undefined && existing.approvedAt === undefined) archivePlan(workspace, existing)
  /** The new record, assembled before it is persisted. */
  const plan: StagedPlan = {
    version: 1,
    planId: newPlanId(now),
    sessionId,
    name: input.name,
    description: input.description,
    approval: input.approval,
    members: [],
    tasks: [],
    stagedAt: now.toISOString(),
  }
  writePlan(workspace, plan)
  return plan
}

/** Append one member to a staged plan. Throws on a duplicate or empty name. */
export function addMember(plan: StagedPlan, member: StagedMember): StagedPlan {
  /** The trimmed name, which is both the duplicate key and the stored value. */
  const name = member.name.trim()
  if (name === "") throw new Error("a teammate needs a non-empty name")
  if (plan.members.some((existing) => existing.name === name)) throw new Error(`teammate "${name}" is already staged`)
  return { ...plan, members: [...plan.members, { ...member, name }] }
}

/** Append one task to a staged plan. Throws on an empty subject. */
export function addTask(plan: StagedPlan, task: StagedTask): StagedPlan {
  /** The trimmed subject, which is what gets stored and later posted. */
  const subject = task.subject.trim()
  if (subject === "") throw new Error("a task needs a non-empty subject")
  return { ...plan, tasks: [...plan.tasks, { ...task, subject }] }
}

/** Archive one plan under `.mpd/team/archive/<planId>/` and clear its staging slot. */
export function archivePlan(workspace: string, plan: StagedPlan): string {
  /** `<archive>/<planId>/`, created before the plan is written into it. */
  const target = join(archiveDir(workspace), plan.planId)
  mkdirSync(target, { recursive: true })
  writeJson(join(target, "plan.json"), plan)
  /** The session's staging slot, removed so the plan is no longer staged. */
  const staged = stagingPath(workspace, plan.sessionId)
  if (existsSync(staged)) rmSync(staged, { force: true })
  return target
}

/**
 * Freeze one task's contract and bump its attempt counter.
 *
 * The counter is per TASK and monotonic across claims, which is what makes "the Nth attempt at
 * t4" answerable — the official board keeps only a `revision`, and a revision moves for every
 * mutation (an edit, a dependency change), so it cannot stand in for an attempt.
 */
export function claimContract(
  workspace: string,
  task: { id: string; subject: string; description: string; blockedBy?: readonly string[]; writeScopes?: readonly string[]; revision: number },
  claimant: string,
  now: Date,
): TaskContract {
  /** The task's previous contract, whose attempt counter this claim increments. */
  const previous = readJson<TaskContract>(contractPath(workspace, task.id))
  /** The frozen contract for THIS attempt. */
  const contract: TaskContract = {
    version: 1,
    taskId: task.id,
    subject: task.subject,
    description: task.description,
    blockedBy: [...(task.blockedBy ?? [])],
    writeScopes: [...(task.writeScopes ?? [])],
    attempt: (previous?.attempt ?? 0) + 1,
    claimedBy: claimant,
    claimedAt: now.toISOString(),
    revision: task.revision,
  }
  writeJson(contractPath(workspace, task.id), contract)
  return contract
}

/** Read one task's frozen contract. */
export function readContract(workspace: string, taskId: string): TaskContract | undefined {
  /** The parsed contract; an absent file or unknown version reads as "no contract". */
  const contract = readJson<TaskContract>(contractPath(workspace, taskId))
  return contract === undefined || contract.version !== 1 ? undefined : contract
}

/** Every contract this workspace holds, newest claim first. */
export function listContracts(workspace: string): TaskContract[] {
  /** Contract file names, or an empty list when the directory does not exist yet. */
  let names: string[] = []
  try {
    names = readdirSync(contractsDir(workspace))
  } catch {
    return []
  }
  /** Readable contracts, accumulated before the newest-first sort. */
  const out: TaskContract[] = []
  for (const name of names) {
    if (!name.endsWith(".json")) continue
    /** The contract in this file, or undefined when the file is unreadable. */
    const contract = readJson<TaskContract>(join(contractsDir(workspace), name))
    if (contract !== undefined && contract.version === 1) out.push(contract)
  }
  return out.sort((left, right) => right.claimedAt.localeCompare(left.claimedAt))
}

/** A hold: the bundle's own pause. The official plugin exposes none. */
export interface TeamHold {
  /** Format version of the hold record. */
  version: 1
  /** Why the team is held; shown to the captain and carried into a dispatch refusal. */
  reason: string
  /** ISO instant the hold was placed. */
  heldAt: string
  /** Who placed the hold (a session id or a tool caller), for attribution. */
  heldBy: string
}

/** The current hold, or `undefined` when the workspace is not held. */
export function readHold(workspace: string): TeamHold | undefined {
  /** The parsed hold; an absent or unknown-version record reads as "not held". */
  const hold = readJson<TeamHold>(holdPath(workspace))
  return hold === undefined || hold.version !== 1 ? undefined : hold
}

/** Place the hold. Returns the record written. */
export function placeHold(workspace: string, reason: string, heldBy: string, now: Date): TeamHold {
  /** The record written to disk; its presence is what makes the team halted. */
  const hold: TeamHold = { version: 1, reason, heldAt: now.toISOString(), heldBy }
  writeJson(holdPath(workspace), hold)
  return hold
}

/** Clear the hold. Returns whether one was there. */
export function clearHold(workspace: string): boolean {
  /** The hold file; a missing one means the workspace was already unheld. */
  const path = holdPath(workspace)
  if (!existsSync(path)) return false
  rmSync(path, { force: true })
  return true
}

/** Move a staged plan into the archive and return where it landed (used by {@link archivePlan}). */
export function archivePathFor(workspace: string, planId: string): string {
  return join(archiveDir(workspace), planId)
}

/** Rename helper kept here so the archive layout is described in ONE place. */
export function moveIntoArchive(workspace: string, from: string, planId: string): string {
  /** Where the plan lands, derived so the archive layout is described in one place. */
  const target = archivePathFor(workspace, planId)
  mkdirSync(archiveDir(workspace), { recursive: true })
  renameSync(from, target)
  return target
}
