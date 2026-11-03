// The durable staged-plan store: the workflow the official plugin does not have.
//
// WHY IT EXISTS. The retired vendored plugin staged a team as a PLAN the user could read, edit
// and APPROVE before a single teammate existed, and froze each task's contract at claim time
// with a monotonic attempt counter. Neither the official tool row nor the native team executor
// has such a stage: a member is raised (and a task posted) the moment the tool is called, so a
// captain that wants a review step has nowhere to put one. This store is that step — a sidecar
// under `<workspace>/.mpd/team/`, never a second source of team truth: the roster and the board
// stay the team RECORD's, and this file only records what the user has staged, approved or
// halted.
//
// Everything here is PURE filesystem + plain data, so the whole state machine is unit-testable
// without a ctx, a harness or a model.
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { sanitizeId, nextIdSuffix, type TaskKind } from "./team-store"

/** One member the plan wants. The prompt is what the team executor hands the teammate on approval. */
export interface StagedMember {
  /** The teammate NAME the captain will address; the executor receives it verbatim. */
  name: string
  /** One-line role summary, shown in the staged plan for the user to read before approving. */
  description: string
  /** The full instantiation prompt the teammate receives once the plan is approved. */
  prompt: string
  /** Optional rostered role label — the FIRST identity the team executor matches against the roster when it resolves this member's model slot (then the description's head, then the name). */
  role?: string
}

/** One shared task the plan wants posted after approval. */
export interface StagedTask {
  /** The task title that will be posted to the board after approval. */
  subject: string
  /** The acceptance text the assigned member receives — how the task is to be worked. */
  description: string
  /**
   * What must close before this task is ready, in ONE of three forms:
   *
   *   1. a task id on the board this plan will build (`"T2"`);
   *   2. the SUBJECT of an earlier task in the same plan (the documented form, and the one a captain
   *      writes from the plan text itself);
   *   3. this plan's own 1-BASED POSITION (`"2"` for the second staged task) — the form that was
   *      silently accepted and then silently unresolved until 2026-10-06, when a live board carrying
   *      `["2"]`, `["2","3","4","6"]`, `["7","8","9"]` flattened its whole DAG to one column.
   *
   * Approval resolves all three to real board ids; anything that resolves to NOTHING is kept in the
   * board task's `blockedBy` and reported BESIDE it (see `TeamTaskRecord.unresolvedBlockers`), named in
   * the approved plan's `created.unresolved` and in the approval answer — never dropped in silence.
   */
  blockedBy?: string[]
  /** Paths the task is expected to touch, forwarded to the board's write-scope check. */
  writeScopes?: string[]
  /** Teammate name the captain wants to own it; the board resolves that name to a session. */
  owner?: string
  /**
   * What kind of row this is on the requirement chain (C7-4 F1, carried from the staged path by the
   * PR #42 review): `work` when the plan does not say, because that is what every staged task used to
   * become. Without the field a `repair` staged before approval silently reached the board as `work`.
   */
  kind?: TaskKind
  /** The user clause this task serves, carried to the board unchanged (same defect as {@link kind}). */
  coverageOf?: string
  /** The task a repair row was opened from, carried to the board unchanged (same defect). */
  sourceTaskId?: string
}

/**
 * The requirements document a staged plan carries.
 *
 * WHY IT RIDES THE PLAN (D4). The requirements plane moved from cellwork's private record onto the team
 * plane, and the plan is the ONE object a teammate already reads before approval — a second document
 * beside it would be a second place to disagree about what was agreed. The revision is what a split
 * names, so an accepted split can never silently target a stale requirements text.
 */
export interface StagedRequirements {
  /** Monotonic revision of the agreed document: every update bumps it and stales the current split. */
  revision: number
  /** The full markdown document, exactly as it was agreed. */
  content: string
  /** ISO instant this revision was agreed. */
  finalizedAt: string
}

/** One task row of a measured split, as the plan stores it. */
export interface StagedSplitTask {
  /** The stable task key the rest of the graph references (`T1`, `work-a`, …). */
  key: string
  /** The one-line title the board shows. */
  subject: string
  /** The RESOLVED board member the task is raised for. */
  member: string
  /** The paths the task may write. */
  writeScopes: string[]
  /** Whether this task's work must be verified by a review task. */
  verify: boolean
  /** Whether this task passed every measured condition. */
  accepted: boolean
}

/**
 * The measured split a staged plan carries: the graph verdict the splitter produced.
 *
 * Only the DECISIONS are kept here; the measurements that produced them stay in the splitter's own
 * evidence, so the plan document does not grow a second copy of every estimate.
 */
export interface StagedSplit {
  /** The requirements revision this split was measured against. */
  revision: number
  /** Whether the whole graph passed every condition. */
  accepted: boolean
  /** ISO instant the verdict was written. */
  submittedAt: string
  /** One row per measured task, in submission order. */
  tasks: StagedSplitTask[]
}

/** The version a NEW staged plan is written with. */
export const STAGED_PLAN_VERSION = 2

/** The whole staged plan for one session. */
export interface StagedPlan {
  /**
   * Format version of THIS record.
   *
   * `stagePlan` writes {@link STAGED_PLAN_VERSION} (2) since the requirements/split planes moved onto the
   * plan. `1` is admitted by the TYPE because a version-1 record still exists on disk — and in the
   * fixtures that prove the compatibility arm — and `readPlan` LIFTS it to 2 on read. Discarding the old
   * version instead would strand every plan staged before the upgrade, which is the R1 blocker.
   */
  version: 1 | typeof STAGED_PLAN_VERSION
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
  /** The agreed requirements document, when the plan carries one (absent on a hand-staged plan). */
  requirements?: StagedRequirements
  /** The measured split the plan was built from, when one was submitted (absent on a hand-staged plan). */
  split?: StagedSplit
  /** ISO instant the plan was staged; the plan id is derived from it. */
  stagedAt: string
  /** ISO instant approval happened; absent means the plan is still awaiting one. */
  approvedAt?: string
  /** ISO instant the plan was discarded instead of approved. */
  discardedAt?: string
  /** What approval actually created, so a reader can reconcile plan with reality. */
  created?: {
    members: Array<{ name: string; id: string }>
    tasks: Array<{ subject: string; id: string }>
    /**
     * The staged blockers that named NO task, per board task, as approval resolved them.
     *
     * This is the durable half of the report: the archived plan is what a captain (or a repairing
     * agent) reads afterwards, and the board task's own `unresolvedBlockers` is the live half. ABSENT
     * means every blocker of every staged task resolved to a real board id.
     */
    unresolved?: Array<{ taskId: string; references: string[] }>
  }
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

/**
 * The file id for ONE sidecar under `.mpd/team`, reduced and then REFUSED if it is unsafe.
 *
 * The two sibling stores already reduce their ids (`team-store.ts#sanitizeId`, the watchdog's
 * `safeSegment`), so this reuses the SAME reducer rather than inventing a third one. A
 * separator-carrying id is REFUSED OUTRIGHT instead of being silently rewritten: `sessionId`
 * reaches `stagingPath` straight from the web route's query string
 * (`team-web.ts#sessionOf` → `planForSession` → `readPlan` → `stagingPath`), so
 * `sessionId=../../escape` used to read and write `<workspace>/escape.json` — and folding it to
 * `..-..-escape` would have answered a DIFFERENT file than the caller asked for, which is its own
 * silent-wrong-answer defect.
 *
 * @param value - the candidate id (a session id or a task id).
 * @param what - what the id names, for a sentence a caller can act on.
 * @returns the reduced id, safe as one path segment.
 * @throws when the id carries a path separator, before or after the reduction.
 */
function planFileId(value: string, what: string): string {
  // The id as text, exactly as the caller supplied it.
  const raw = String(value)
  if (raw.includes("/") || raw.includes("\\")) {
    throw new Error(`${what} "${raw}" carries a path separator and is refused: ids name ONE file under .mpd/team`)
  }
  /** The reduced id, produced by the store family's own reducer. */
  const id = sanitizeId(raw)
  // The POST-CONDITION on the reused reducer: if a separator ever survived it, the join below would
  // escape the root, so the guard is re-asserted on the value that actually lands in the path.
  if (id.includes("/") || id.includes("\\")) {
    throw new Error(`${what} "${raw}" reduced to "${id}", which still carries a path separator and is refused`)
  }
  return id
}

/** `<root>/staging`: one JSON file per session that has a staged plan. */
const stagingDir = (workspace: string): string => join(teamRoot(workspace), "staging")
/** The staging slot of ONE session — the file a new stage replaces and approval clears. */
const stagingPath = (workspace: string, sessionId: string): string => join(stagingDir(workspace), planFileId(sessionId, "staging session id") + ".json")
/** `<root>/contracts`: one frozen task contract per file. */
const contractsDir = (workspace: string): string => join(teamRoot(workspace), "contracts")
/** The contract file of ONE task, keyed by its board id. */
const contractPath = (workspace: string, taskId: string): string => join(contractsDir(workspace), planFileId(taskId, "contract task id") + ".json")
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

/**
 * A stable, sortable, COLLISION-RESISTANT identity for one staged plan.
 *
 * Second precision was the measured defect (C7-4 F4): two plans staged inside the same second shared a
 * `planId`, so approval archived them into ONE `.mpd/team/archive/<planId>/` directory and the first was
 * lost. The millisecond timestamp keeps the id sortable; the suffix keeps two mints distinct.
 */
export function newPlanId(now: Date): string {
  return "plan-" + now.toISOString().replace(/[-:.TZ]/g, "").slice(0, 17) + "-" + nextIdSuffix()
}

/**
 * The plan staged for one session, or `undefined` when nothing is staged or the version is unknown.
 *
 * THE v1 READ-COMPAT ARM (R1). Until version 2 this reader answered `undefined` for ANY record whose
 * version was not exactly 1, so bumping the format would have stranded every plan staged before the
 * upgrade: `agent_teams_plan {action:"status"}` would report nothing staged, approval would refuse, and
 * the plan file would sit on disk unreadable until a human deleted it. A version-1 record therefore
 * reads as ITSELF with the version LIFTED to the current one — `requirements` and `split` are both
 * optional, so nothing is invented — and the lift is in memory only; the file is rewritten by whichever
 * call next persists the plan.
 * @param workspace - the workspace whose staging slot is read.
 * @param sessionId - the session whose staged plan is wanted.
 * @returns the plan, or undefined when nothing is staged or the version is one this build cannot read.
 */
export function readPlan(workspace: string, sessionId: string): StagedPlan | undefined {
  /** The parsed staging slot, read with an open version so an older record can be recognised. */
  const plan = readJson<Omit<StagedPlan, "version"> & { version?: unknown }>(stagingPath(workspace, sessionId))
  if (plan === undefined) return undefined
  /** The format version the file declares; anything that is not a number is unknown. */
  const version = typeof plan.version === "number" ? plan.version : undefined
  if (version !== 1 && version !== STAGED_PLAN_VERSION) return undefined
  return { ...plan, version: STAGED_PLAN_VERSION }
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
    version: STAGED_PLAN_VERSION,
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

/** How one blocker reference reads against the plan AS IT STANDS when the reference is written. */
export type BlockerForm =
  | "position"
  | "subject"
  | "board-id"
  | "unknown"

/**
 * Classify one staged blocker reference, so a captain learns at WRITE time what the text will mean.
 *
 * This is the write-time half of the 2026-10-06 defect: a plan whose `blockedBy` carried bare numbers
 * (its own positions) or free text was accepted without a word, and the failure only appeared three
 * layers downstream as a board with no edges. A reference is now read against the plan as written:
 *
 *   · `board-id` — `T<n>`, a task id the approval mints (the plan's own tasks become `T1…Tn`);
 *   · `position` — a bare number, the plan's own 1-BASED position (forward references included);
 *   · `subject`  — it matches a task already staged in this plan;
 *   · `unknown`  — none of the above, so nothing in this plan can resolve it: it is exactly the text
 *                  that used to be stored and silently dropped by every reader.
 *
 * ADVISORY, never a refusal: a forward reference is legitimate (tasks are written in order), and only
 * the approval knows the final board. `unknown` is the form worth saying out loud at write time.
 * @param plan - the plan as it stands, INCLUDING the task the reference was just written on.
 * @param reference - one reference, as the caller wrote it.
 * @returns which of the four forms it reads as.
 */
export function classifyBlocker(plan: StagedPlan, reference: string): BlockerForm {
  if (/^T\d+$/u.test(reference)) return "board-id"
  if (/^\d+$/u.test(reference)) return "position"
  return plan.tasks.some((task) => task.subject === reference) ? "subject" : "unknown"
}

/** Archive one plan under `.mpd/team/archive/<planId>/` and clear its staging slot. */
export function archivePlan(workspace: string, plan: StagedPlan): string {
  // `<archive>/<planId>/`, created before the plan is written into it. The path comes from
  // `archivePathFor`, so the id is reduced and refused in ONE place — `plan.planId` is read back
  // from a staging FILE on the `stagePlan` path, and joining it verbatim here is the same T5 class.
  /** The archive directory this plan lands in. */
  const target = archivePathFor(workspace, plan.planId)
  // F4 BACKSTOP: two plans sharing a `planId` used to land in ONE directory and the second write replaced
  // the first — the measured "one archive dir for two plans". Refusing loudly turns a silently lost plan
  // into a red gate; with the millisecond+suffix mint above this is unreachable in normal use.
  if (existsSync(join(target, "plan.json"))) {
    throw new Error(`plan id "${plan.planId}" is already archived in this workspace — refusing to overwrite an archived plan`)
  }
  mkdirSync(target, { recursive: true })
  writeJson(join(target, "plan.json"), plan)
  /** The session's staging slot, removed so the plan is no longer staged. */
  const staged = stagingPath(workspace, plan.sessionId)
  if (existsSync(staged)) rmSync(staged, { force: true })
  return target
}

/**
 * What one archived plan is, for a reader that needs the history rather than the content.
 *
 * The GLOBAL-MEMORY hook (D6) is the first consumer: on archive it asks which plan was archived, whether
 * it was approved, and which team that plan became, so the committed memory entry can name the team
 * instead of guessing one. That is why `teamId` is resolved by the CALLER (the record is where the
 * plan→team link lives) and is optional here.
 */
export interface ArchivedPlanSummary {
  /** The archived plan's identity, which is also its directory name. */
  planId: string
  /** ISO instant the archive file was written, from its own modification time. */
  archivedAt: string
  /** Whether the plan was approved before it was archived. */
  approved: boolean
  /** ISO instant approval happened, when it did. */
  approvedAt?: string
  /** The team this plan was approved into, when a team record still names the plan. */
  teamId?: string
  /** Absolute path of the archived plan document. */
  path: string
}

/**
 * Every archived plan this workspace holds, newest first.
 *
 * Reads the archive ONE entry at a time: a directory without a readable `plan.json`, a record whose
 * `planId` is not a string, or a stat failure is skipped rather than thrown, because this is a listing
 * for a memory hook and a broken archive entry must not take a caller down.
 * @param workspace - the workspace whose team archive is listed.
 * @returns the archived plans, newest first by their file's modification time.
 */
export function listArchivedPlans(workspace: string): ArchivedPlanSummary[] {
  /** The archive's directory entries, or none when the archive does not exist. */
  let entries: string[] = []
  try {
    entries = readdirSync(archiveDir(workspace))
  } catch {
    return []
  }
  /** The plans read, accumulated before the sort. */
  const out: ArchivedPlanSummary[] = []
  for (const entry of entries) {
    /** The archived plan document for this directory entry. */
    const path = join(archiveDir(workspace), entry, "plan.json")
    try {
      /** The plan's own bytes, parsed structurally: this listing needs the identity, not the schema. */
      const plan = JSON.parse(readFileSync(path, "utf8")) as { planId?: unknown; approvedAt?: unknown }
      /** The plan identity, which is what a team record is matched on. */
      const planId = typeof plan.planId === "string" && plan.planId !== "" ? plan.planId : entry
      /** The archive file's modification time, read as the instant this plan was archived. */
      const archivedAt = statSync(path).mtime.toISOString()
      /** The approval stamp, when the plan carries one. */
      const approvedAt = typeof plan.approvedAt === "string" ? plan.approvedAt : undefined
      out.push({
        planId,
        archivedAt,
        approved: approvedAt !== undefined,
        ...(approvedAt === undefined ? {} : { approvedAt }),
        path,
      })
    } catch {
      // An entry with no readable plan.json is not an archived plan this build can describe.
    }
  }
  return out.sort((left, right) => right.archivedAt.localeCompare(left.archivedAt))
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
  // T5, the SAME class as `stagingPath`: `planId` is read back from a staging FILE
  // (`stagePlan` → `readPlan` → `archivePlan`), so a planted plan whose `planId` carries `..`
  // segments used to make this `join()` write `<workspace>/../../…/plan.json` — OUTSIDE the
  // workspace. It is reduced and refused exactly like the other two ids.
  return join(archiveDir(workspace), planFileId(planId, "archived plan id"))
}

/** Rename helper kept here so the archive layout is described in ONE place. */
export function moveIntoArchive(workspace: string, from: string, planId: string): string {
  /** Where the plan lands, derived so the archive layout is described in one place. */
  const target = archivePathFor(workspace, planId)
  mkdirSync(archiveDir(workspace), { recursive: true })
  renameSync(from, target)
  return target
}
