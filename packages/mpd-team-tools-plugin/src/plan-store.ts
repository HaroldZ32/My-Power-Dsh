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
  name: string
  description: string
  prompt: string
  role?: string
}

/** One shared task the plan wants posted after approval. */
export interface StagedTask {
  subject: string
  description: string
  blockedBy?: string[]
  writeScopes?: string[]
  owner?: string
}

/** The whole staged plan for one session. */
export interface StagedPlan {
  version: 1
  planId: string
  sessionId: string
  name: string
  description: string
  approval: "required" | "automatic"
  members: StagedMember[]
  tasks: StagedTask[]
  stagedAt: string
  approvedAt?: string
  discardedAt?: string
  /** What approval actually created, so a reader can reconcile plan with reality. */
  created?: { members: Array<{ name: string; id: string }>; tasks: Array<{ subject: string; id: string }> }
}

/** A task's frozen contract, written when the task is claimed. */
export interface TaskContract {
  version: 1
  taskId: string
  subject: string
  description: string
  blockedBy: string[]
  writeScopes: string[]
  /** Monotonic per task: the Nth time this task was claimed. */
  attempt: number
  claimedBy: string
  claimedAt: string
  /** The board revision the contract was frozen at — the official plugin's own generation token. */
  revision: number
}

/** `.mpd/team` under the workspace: the bundle's own team sidecar root. */
export function teamRoot(workspace: string): string {
  return join(workspace, ".mpd", "team")
}

const stagingDir = (workspace: string): string => join(teamRoot(workspace), "staging")
const stagingPath = (workspace: string, sessionId: string): string => join(stagingDir(workspace), sessionId + ".json")
const contractsDir = (workspace: string): string => join(teamRoot(workspace), "contracts")
const contractPath = (workspace: string, taskId: string): string => join(contractsDir(workspace), taskId + ".json")
const holdPath = (workspace: string): string => join(teamRoot(workspace), "hold.json")
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
  const existing = readPlan(workspace, sessionId)
  if (existing !== undefined && existing.approvedAt === undefined) archivePlan(workspace, existing)
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
  const name = member.name.trim()
  if (name === "") throw new Error("a teammate needs a non-empty name")
  if (plan.members.some((existing) => existing.name === name)) throw new Error(`teammate "${name}" is already staged`)
  return { ...plan, members: [...plan.members, { ...member, name }] }
}

/** Append one task to a staged plan. Throws on an empty subject. */
export function addTask(plan: StagedPlan, task: StagedTask): StagedPlan {
  const subject = task.subject.trim()
  if (subject === "") throw new Error("a task needs a non-empty subject")
  return { ...plan, tasks: [...plan.tasks, { ...task, subject }] }
}

/** Archive one plan under `.mpd/team/archive/<planId>/` and clear its staging slot. */
export function archivePlan(workspace: string, plan: StagedPlan): string {
  const target = join(archiveDir(workspace), plan.planId)
  mkdirSync(target, { recursive: true })
  writeJson(join(target, "plan.json"), plan)
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
  const previous = readJson<TaskContract>(contractPath(workspace, task.id))
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
  const contract = readJson<TaskContract>(contractPath(workspace, taskId))
  return contract === undefined || contract.version !== 1 ? undefined : contract
}

/** Every contract this workspace holds, newest claim first. */
export function listContracts(workspace: string): TaskContract[] {
  let names: string[] = []
  try {
    names = readdirSync(contractsDir(workspace))
  } catch {
    return []
  }
  const out: TaskContract[] = []
  for (const name of names) {
    if (!name.endsWith(".json")) continue
    const contract = readJson<TaskContract>(join(contractsDir(workspace), name))
    if (contract !== undefined && contract.version === 1) out.push(contract)
  }
  return out.sort((left, right) => right.claimedAt.localeCompare(left.claimedAt))
}

/** A hold: the bundle's own pause. The official plugin exposes none. */
export interface TeamHold {
  version: 1
  reason: string
  heldAt: string
  heldBy: string
}

/** The current hold, or `undefined` when the workspace is not held. */
export function readHold(workspace: string): TeamHold | undefined {
  const hold = readJson<TeamHold>(holdPath(workspace))
  return hold === undefined || hold.version !== 1 ? undefined : hold
}

/** Place the hold. Returns the record written. */
export function placeHold(workspace: string, reason: string, heldBy: string, now: Date): TeamHold {
  const hold: TeamHold = { version: 1, reason, heldAt: now.toISOString(), heldBy }
  writeJson(holdPath(workspace), hold)
  return hold
}

/** Clear the hold. Returns whether one was there. */
export function clearHold(workspace: string): boolean {
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
  const target = archivePathFor(workspace, planId)
  mkdirSync(archiveDir(workspace), { recursive: true })
  renameSync(from, target)
  return target
}
