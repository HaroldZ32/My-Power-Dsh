// The mpd-OWNED team record: this bundle's own team truth.
//
// WHY IT EXISTS (the 2026-09-30 separation). Until this module the bundle kept only a SIDECAR
// around the official plane: the staged plan, the frozen contracts, the halt, the dispatch ledger
// and the mailbox were ours, while the ROSTER and the BOARD stayed `ctx.agentTeams`'s. That made
// the official plugin the system of record, and it cost three measured things:
//
//   • a `dsh-tui` composition cannot mount the official service at all (its `TeamService`
//     constructor registers a session projection through a ROOT-bound `ctx.root.sessionProjections`
//     proxy, and the dsh-tui host refuses `root.effect` from a plugin activation), so the TUI team
//     scene had nothing to read and rendered `(none in this workspace)`;
//   • the official board carries NO `kind`, `attempt`, `round` or `verdict`, so the requirement →
//     work → review chain the captain's own rules call for could not be represented, let alone
//     drawn;
//   • `mpd-workmate-plugin`'s in-use gate scanned the RETIRED `<ws>/.mpd/team/<teamId>/team.json`
//     layout and was therefore blind to every real teammate.
//
// WHAT THIS STORE IS. One JSON record per team, under `.mpd/team/teams/<teamId>.json`, owned and
// written by mpd alone. It carries the whole team — roster, board, dependency edges, attempts,
// verdicts and the executor handle of each member and task — so every surface (TUI, web, watchdog,
// compact, workmate) reads ONE place, and the official plane becomes an interchangeable BACKEND
// behind the adapter rather than the source of truth.
//
// WHAT IT IS NOT. It is not an executor: nothing here spawns an agent, sends a message or touches a
// harness service. Spawning stays behind the adapter (W2's `TeamExecutor`); this module records
// what that executor was asked to do and what it reported back, which is exactly why the record
// survives an executor swap.
//
// Everything here is PURE filesystem + plain data — no ctx, no harness, no clock of its own (every
// mutator takes the `Date` it should stamp) — so the whole state machine is unit-testable.
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

/** Where a team is in its lifecycle; `staged` means nothing has been spawned yet. */
export type TeamPhase = "staged" | "active" | "idle" | "ended"

/**
 * What a task IS, which is what turns a flat board into the requirement chain the captain's rules
 * ask for (`kind=repair` + `sourceTaskId` for finding-driven work, `coverageOf` naming the user
 * clause a task serves).
 */
export type TaskKind = "requirement" | "work" | "review" | "repair" | "integration"

/** A task's own state; `blocked` is DERIVED from `blockedBy` and never stored. */
export type TaskStatus = "pending" | "claimed" | "in_progress" | "completed" | "failed" | "cancelled"

/** A member's own state, mirroring the vocabulary the official roster uses so a reader sees one set. */
export type MemberStatus = "provisioning" | "running" | "inactive" | "failed"

/** One member of a team, as mpd records it. */
export interface TeamMemberRecord {
  /** mpd-minted, stable, short id (`M1`, `M2`, …); never reused inside a team. */
  id: string
  /** The display name the captain addresses; unique within the team. */
  name: string
  /** One-line role summary shown on the roster. */
  description: string
  /** Optional roster role label (`Senior Engineer`, `Reviewer`, …) for readability and routing. */
  role?: string
  /** `provider/model` when the roster resolved a team-model slot for this member. */
  route?: string
  /** This member's own state. */
  status: MemberStatus
  /** ISO instant the member was staged (or spawned, once status leaves `provisioning`). */
  spawnedAt: string
  /**
   * The EXECUTOR's own handle for this member (an official teammate session id today), or absent
   * while nothing has been spawned. mpd never mints it and never depends on its shape.
   */
  executorRef?: string
}

/** One task of a team's board, as mpd records it. */
export interface TeamTaskRecord {
  /** mpd-minted, stable, short id (`T1`, `T2`, …); this is the id the graph draws and tools take. */
  id: string
  /** The task title. */
  subject: string
  /** The acceptance text: how the task is to be worked and what closes it. */
  description: string
  /** What the task is, in the chain vocabulary. */
  kind: TaskKind
  /** This task's own state. */
  status: TaskStatus
  /** Ids of mpd tasks that must close before this one is ready. */
  blockedBy: string[]
  /** Paths the task is expected to touch, forwarded to the executor's write-scope check. */
  writeScopes: string[]
  /** Display name of the owning member, when one is assigned. */
  owner?: string
  /** Monotonic per task: the Nth time this task was claimed. Set by `agent_teams_task claim`. */
  attempt?: number
  /** Review round, set by a review task's own lifecycle. */
  round?: number
  /** Review verdict (`pass`/`fail`/`changes`), set by a review task's own lifecycle. */
  verdict?: string
  /** The requirement clause this task serves, for a coverage question. */
  coverageOf?: string
  /** The task a `repair` was opened from. */
  sourceTaskId?: string
  /** ISO instant the task was added to the record. */
  createdAt: string
  /** ISO instant the task last changed. */
  updatedAt: string
  /** The EXECUTOR's own handle for this task (an official board id today), or absent. */
  executorRef?: string
  /** Monotonic per task: bumped on every mpd-side mutation, so a CAS can name a revision. */
  revision: number
}

/** The whole durable record of one team. */
export interface TeamRecord {
  /** Format version; a reader refuses a record whose version it does not know. */
  version: 1
  /** mpd-minted identity (`team-<UTC instant>`), also the record's file name. */
  teamId: string
  /** The team name the user reads. */
  name: string
  /** What the team is for. */
  description: string
  /** The Lead session this team belongs to; a workspace may hold several teams at once. */
  leadSessionId: string
  /** Where the team is in its lifecycle. */
  phase: TeamPhase
  /** ISO instant the record was created. */
  createdAt: string
  /** ISO instant the plan was approved (the moment anything could be spawned). */
  approvedAt?: string
  /** ISO instant the team was explicitly ended; absent while it is live. */
  endedAt?: string
  /** The roster. */
  members: TeamMemberRecord[]
  /** The board. */
  tasks: TeamTaskRecord[]
  /** The next member number to mint; monotonic so an id is never reused after a removal. */
  nextMemberNumber: number
  /** The next task number to mint; monotonic for the same reason. */
  nextTaskNumber: number
}

/** The per-workspace index: which team is ACTIVE for which Lead session. */
export interface TeamsIndex {
  /** Format version of the index; an unknown version reads as empty rather than throwing. */
  version: 1
  /** Lead session id → team id. A session with no entry has no active team. */
  active: Record<string, string>
}

/** `.mpd/team` under the workspace: the bundle's own team root (shared with the sidecar files). */
export function teamRoot(workspace: string): string {
  return join(workspace, ".mpd", "team")
}

/** `<root>/teams`: one record file per team. */
export function teamsDir(workspace: string): string {
  return join(teamRoot(workspace), "teams")
}

/** The record file of ONE team. The id is sanitized by {@link sanitizeId} before it lands here. */
export function teamRecordPath(workspace: string, teamId: string): string {
  return join(teamsDir(workspace), sanitizeId(teamId) + ".json")
}

/** The per-workspace active-team index. */
export function teamsIndexPath(workspace: string): string {
  return join(teamRoot(workspace), "teams.json")
}

/**
 * Reduce an id to something safe to use as a file name.
 *
 * Ids are minted here and never user-supplied in practice, but a record read back from disk (or a
 * hand-written fixture) reaches {@link teamRecordPath}, and a path separator in an id would let a
 * read escape `.mpd/team`. Anything outside `[A-Za-z0-9._-]` collapses to `-`.
 * @param value - the candidate id.
 * @returns the sanitized id, or `"unnamed"` when nothing usable is left.
 */
export function sanitizeId(value: string): string {
  // Leading dots are stripped as well as separators: `.` and `..` are not names, and a leading dot
  // would hide the record from a plain `ls` of the teams directory.
  /** The collapsed form; every run of unusable characters becomes one dash. */
  const cleaned = String(value).replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[.-]+/, "").replace(/-+$/, "")
  return cleaned === "" ? "unnamed" : cleaned
}

/** Read one JSON file, or `undefined` when it is absent, unreadable or not an object. */
function readJson<T>(path: string): T | undefined {
  try {
    /** The parsed value, accepted only when it is a plain object. */
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"))
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as T) : undefined
  } catch {
    return undefined
  }
}

/**
 * Write one JSON file, creating its directory. Throws only on a real write failure.
 *
 * ATOMIC (T2): the bytes land in a sibling temp file that is then renamed over the target, so a
 * reader — including the dispatch pass re-reading before its own write — sees either the whole old
 * document or the whole new one, never a half-written record. The temp file lives in the SAME
 * directory, so the rename stays on one filesystem.
 */
function writeJson(path: string, value: unknown): void {
  mkdirSync(join(path, ".."), { recursive: true })
  /** The sibling temp file this write lands in before the rename. */
  const temp = path + ".tmp-" + process.pid
  writeFileSync(temp, JSON.stringify(value, null, 2) + "\n")
  renameSync(temp, path)
}

/** A stable, sortable identity for one team, derived from the instant it was created. */
export function newTeamId(now: Date): string {
  return "team-" + now.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)
}

/** The session key an index entry uses; a sessionless surface is keyed as `workspace`. */
export function sessionKey(sessionId: string | undefined): string {
  return typeof sessionId === "string" && sessionId !== "" ? sessionId : "workspace"
}

/** The index, or an empty one when the file is absent or unreadable. */
export function readTeamsIndex(workspace: string): TeamsIndex {
  /** The parsed index, accepted only when its version and its `active` map are both usable. */
  const index = readJson<TeamsIndex>(teamsIndexPath(workspace))
  // An ARRAY passes `typeof === "object"`, and a read of `active[session]` on one would answer
  // undefined for every session while a write would silently attach to the array — so it is refused.
  if (index === undefined || index.version !== 1 || index.active === null || typeof index.active !== "object" || Array.isArray(index.active)) {
    return { version: 1, active: {} }
  }
  return index
}

/** Persist the index. */
export function writeTeamsIndex(workspace: string, index: TeamsIndex): void {
  writeJson(teamsIndexPath(workspace), index)
}

/** The team id ACTIVE for one session, or `undefined` when that session has none. */
export function activeTeamId(workspace: string, sessionId: string | undefined): string | undefined {
  /** The index entry for this session, if any. */
  const id = readTeamsIndex(workspace).active[sessionKey(sessionId)]
  return typeof id === "string" && id !== "" ? id : undefined
}

/** Bind one session to a team; the previous binding, if any, is replaced. */
export function bindActiveTeam(workspace: string, sessionId: string | undefined, teamId: string): void {
  /** The index with this session pointed at the team. */
  const index = readTeamsIndex(workspace)
  index.active[sessionKey(sessionId)] = teamId
  writeTeamsIndex(workspace, index)
}

/** Drop one session's binding. Returns whether a binding was there. */
export function unbindActiveTeam(workspace: string, sessionId: string | undefined): boolean {
  /** The index this call edits. */
  const index = readTeamsIndex(workspace)
  /** The key being dropped. */
  const key = sessionKey(sessionId)
  if (index.active[key] === undefined) return false
  delete index.active[key]
  writeTeamsIndex(workspace, index)
  return true
}

/** One team record, or `undefined` when the file is absent or its version is unknown. */
export function readTeam(workspace: string, teamId: string): TeamRecord | undefined {
  /** The parsed record. */
  const record = readJson<TeamRecord>(teamRecordPath(workspace, teamId))
  if (record === undefined || record.version !== 1) return undefined
  if (!Array.isArray(record.members) || !Array.isArray(record.tasks)) return undefined
  return record
}

/** Persist one team record. */
export function writeTeam(workspace: string, record: TeamRecord): void {
  writeJson(teamRecordPath(workspace, record.teamId), record)
}

/** Every readable team in this workspace, NEWEST FIRST (records carry no ordering of their own). */
export function listTeams(workspace: string): TeamRecord[] {
  /** The record file names, or an empty list when nothing was ever staged here. */
  let names: string[] = []
  try {
    names = readdirSync(teamsDir(workspace))
  } catch {
    return []
  }
  /** Readable records, accumulated before the newest-first sort. */
  const out: TeamRecord[] = []
  for (const name of names) {
    if (!name.endsWith(".json")) continue
    /** The record in this file, skipped when unreadable or of an unknown version. */
    const record = readTeam(workspace, name.slice(0, -".json".length))
    if (record !== undefined) out.push(record)
  }
  return out.sort((left, right) => right.createdAt.localeCompare(left.createdAt))
}

/** Delete one team's record file. Returns whether a file was there. */
export function deleteTeam(workspace: string, teamId: string): boolean {
  /** The record path; a missing file means the team was already gone. */
  const path = teamRecordPath(workspace, teamId)
  if (!existsSync(path)) return false
  rmSync(path, { force: true })
  return true
}

/** What {@link createTeam} needs to mint a record. */
export interface NewTeamInput {
  /** The team name the user reads. */
  name: string
  /** What the team is for. */
  description: string
  /** The Lead session that owns it. */
  leadSessionId: string
}

/**
 * Mint a team record and make it the ACTIVE team for its Lead session.
 *
 * `phase` starts at `staged`: creating a team spawns nothing. Only an approval moves it on, which
 * is the review point the whole workflow exists for.
 * @param workspace - the workspace the record belongs to.
 * @param input - name, description and owning session.
 * @param now - the instant to stamp, so a test can pin it.
 * @returns the record as written.
 */
export function createTeam(workspace: string, input: NewTeamInput, now: Date): TeamRecord {
  /** The record, assembled before it is persisted. */
  const record: TeamRecord = {
    version: 1,
    teamId: newTeamId(now),
    name: input.name,
    description: input.description,
    leadSessionId: sessionKey(input.leadSessionId),
    phase: "staged",
    createdAt: now.toISOString(),
    members: [],
    tasks: [],
    nextMemberNumber: 1,
    nextTaskNumber: 1,
  }
  writeTeam(workspace, record)
  bindActiveTeam(workspace, input.leadSessionId, record.teamId)
  return record
}

/** What {@link addTeamMember} needs to append a member. */
export interface NewMemberInput {
  /** The display name the captain addresses. */
  name: string
  /** One-line role summary. */
  description: string
  /** Optional roster role label. */
  role?: string
  /** Optional `provider/model` the roster resolved for this member. */
  route?: string
}

/**
 * Append one member to a record (pure: the caller persists).
 * @param record - the record to copy.
 * @param input - the member to append.
 * @param now - the instant to stamp as `spawnedAt`.
 * @returns the new record, or the SAME record when the name is empty or already on the roster.
 */
export function addTeamMember(record: TeamRecord, input: NewMemberInput, now: Date): TeamRecord {
  /** The trimmed name, which is both the duplicate key and the stored value. */
  const name = input.name.trim()
  if (name === "") return record
  if (record.members.some((member) => member.name === name)) return record
  /** The appended member, carrying the record's own monotonic id. */
  const member: TeamMemberRecord = {
    id: "M" + record.nextMemberNumber,
    name,
    description: input.description,
    status: "provisioning",
    spawnedAt: now.toISOString(),
    ...(input.role === undefined ? {} : { role: input.role }),
    ...(input.route === undefined ? {} : { route: input.route }),
  }
  return { ...record, members: [...record.members, member], nextMemberNumber: record.nextMemberNumber + 1 }
}

/** What {@link addTeamTask} needs to append a task. */
export interface NewTaskInput {
  /** The task title. */
  subject: string
  /** The acceptance text. */
  description: string
  /** What the task is; defaults to `work`. */
  kind?: TaskKind
  /** Subjects or ids this task is blocked by; a subject is resolved when a task carries it. */
  blockedBy?: string[]
  /** Paths the task is expected to touch. */
  writeScopes?: string[]
  /** Display name of the owning member. */
  owner?: string
  /** The requirement clause this task serves. */
  coverageOf?: string
  /** The task a repair was opened from. */
  sourceTaskId?: string
}

/** Resolve one blocker reference to a task id: an exact id wins, else the first subject match. */
function resolveBlocker(record: TeamRecord, reference: string): string {
  if (record.tasks.some((task) => task.id === reference)) return reference
  /** The first task whose subject is the reference, which is how a staged plan writes blockers. */
  const bySubject = record.tasks.find((task) => task.subject === reference)
  return bySubject === undefined ? reference : bySubject.id
}

/**
 * Append one task to a record (pure: the caller persists).
 *
 * The id is MINTED HERE (`T1`, `T2`, …) rather than taken from an executor, which is what lets the
 * board survive an executor swap: `executorRef` carries the backend's own handle beside it.
 * @param record - the record to copy.
 * @param input - the task to append.
 * @param now - the instant to stamp.
 * @returns the new record, or the SAME record when the subject is empty.
 */
export function addTeamTask(record: TeamRecord, input: NewTaskInput, now: Date): TeamRecord {
  /** The trimmed subject, which is what gets stored. */
  const subject = input.subject.trim()
  if (subject === "") return record
  /** The blockers, each resolved against the tasks this record already carries. */
  const blockedBy = (input.blockedBy ?? []).map((reference) => resolveBlocker(record, reference))
  /** The appended task, carrying the record's own monotonic id. */
  const task: TeamTaskRecord = {
    id: "T" + record.nextTaskNumber,
    subject,
    description: input.description,
    kind: input.kind ?? "work",
    status: "pending",
    blockedBy,
    writeScopes: [...(input.writeScopes ?? [])],
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    revision: 1,
    ...(input.owner === undefined ? {} : { owner: input.owner }),
    ...(input.coverageOf === undefined ? {} : { coverageOf: input.coverageOf }),
    ...(input.sourceTaskId === undefined ? {} : { sourceTaskId: input.sourceTaskId }),
  }
  return { ...record, tasks: [...record.tasks, task], nextTaskNumber: record.nextTaskNumber + 1 }
}

/** The fields {@link updateTeamTask} may change; `revision` and `updatedAt` are always bumped. */
export interface TaskPatch {
  /** The task's new state. */
  status?: TaskStatus
  /** The owning member's display name; an empty string clears the owner. */
  owner?: string
  /** The attempt counter to record. */
  attempt?: number
  /** The review round to record. */
  round?: number
  /** The review verdict to record. */
  verdict?: string
  /** The executor's own handle for this task. */
  executorRef?: string
  /** The task's new blockers, resolved against this record. */
  blockedBy?: string[]
}

/**
 * Apply a patch to one task (pure: the caller persists).
 * @param record - the record to copy.
 * @param taskId - the mpd task id to patch.
 * @param patch - the fields to change.
 * @param now - the instant to stamp as `updatedAt`.
 * @returns a new record; the same record when the id is unknown or the patch is empty.
 */
export function updateTeamTask(record: TeamRecord, taskId: string, patch: TaskPatch, now: Date): TeamRecord {
  /** Whether any task matched, so an unknown id can return the same object. */
  let touched = false
  /** The board with the patch applied. */
  const tasks = record.tasks.map((task) => {
    if (task.id !== taskId) return task
    touched = true
    /** The patched task; every optional field is applied only when the patch carries it. */
    const next: TeamTaskRecord = {
      ...task,
      updatedAt: now.toISOString(),
      revision: task.revision + 1,
      ...(patch.status === undefined ? {} : { status: patch.status }),
      ...(patch.attempt === undefined ? {} : { attempt: patch.attempt }),
      ...(patch.round === undefined ? {} : { round: patch.round }),
      ...(patch.verdict === undefined ? {} : { verdict: patch.verdict }),
      ...(patch.executorRef === undefined ? {} : { executorRef: patch.executorRef }),
      ...(patch.blockedBy === undefined ? {} : { blockedBy: patch.blockedBy.map((reference) => resolveBlocker(record, reference)) }),
    }
    if (patch.owner !== undefined) {
      if (patch.owner === "") delete next.owner
      else next.owner = patch.owner
    }
    return next
  })
  return touched ? { ...record, tasks } : record
}

/**
 * The outcome of a compare-and-set task mutation: either the record to persist, or the refusal.
 *
 * A refusal is a RESULT, not an error: the caller reports it (the dispatch pass puts it in
 * `skipped`) so a lost update is visible, which is the whole point of the compare-and-set.
 */
export type CasTaskOutcome =
  | { /** The fresh record with the patch applied; persist THIS one. */ applied: true; record: TeamRecord }
  | { /** Why nothing was written; already a sentence a caller can show. */ applied: false; reason: string }

/**
 * Claim one task for dispatch against the FRESHEST on-disk record (T2's compare-and-set).
 *
 * WHY THIS EXISTS. The dispatch pass used to read the record ONCE and then rewrite the WHOLE FILE
 * after every `await executor().send(...)`. A member's own `agent_teams_task {action:"claim"}` that
 * landed during that await was erased by the next write, which restored the pass's stale snapshot:
 * the board then showed an in-flight task as pending and its attempt counter regressed, so a later
 * claim reused the same attempt number. `updateTeamTask` bumps `task.revision` on every mpd-side
 * mutation, and that counter is what this compares.
 *
 * The rule: the patch is applied to `fresh` — never to the snapshot the caller opened with — and
 * only when the task is EXACTLY as the caller decided on it. Anything else is refused loudly and
 * carries the reason, so the caller can report it rather than silently reverting a concurrent write.
 *
 * @param fresh - the record re-read from disk immediately before this call.
 * @param taskId - the mpd task id to claim.
 * @param owner - the member name taking the task.
 * @param expectedRevision - the revision the caller's decision was based on.
 * @param now - the instant to stamp as `updatedAt`.
 * @returns the record to persist, or the refusal with its reason.
 */
export function casClaimTask(
  fresh: TeamRecord,
  taskId: string,
  owner: string,
  expectedRevision: number,
  now: Date,
): CasTaskOutcome {
  /** The task as it stands on disk, or undefined when it is gone. */
  const task = fresh.tasks.find((candidate) => candidate.id === taskId)
  if (task === undefined) return { applied: false, reason: `task ${taskId} is no longer on the board` }
  if (task.revision !== expectedRevision) {
    return { applied: false, reason: `task ${taskId} changed while the pass was in flight (revision ${expectedRevision} -> ${task.revision})` }
  }
  if (task.status !== "pending") return { applied: false, reason: `task ${taskId} is now "${task.status}"` }
  // The OWNER is deliberately NOT a refusal: a plan may pre-assign one (`create_task owner=…`), and
  // that is a plan-time intent, not a claim. A concurrent CLAIM is still caught by the revision
  // above, because every mpd-side mutation — a claim included — bumps it.
  return { applied: true, record: updateTeamTask(fresh, taskId, { owner, status: "in_progress" }, now) }
}

/** The fields {@link updateTeamMember} may change. */
export interface MemberPatch {
  /** The member's new state. */
  status?: MemberStatus
  /** The executor's own handle for this member. */
  executorRef?: string
  /** The `provider/model` the roster resolved. */
  route?: string
}

/**
 * Apply a patch to one member, addressed by id OR by name (a tool caller has the name).
 * @param record - the record to copy.
 * @param key - the member id (`M1`) or display name.
 * @param patch - the fields to change.
 * @returns a new record; the same record when nothing matched.
 */
export function updateTeamMember(record: TeamRecord, key: string, patch: MemberPatch): TeamRecord {
  /** Whether any member matched. */
  let touched = false
  /** The roster with the patch applied. */
  const members = record.members.map((member) => {
    if (member.id !== key && member.name !== key) return member
    touched = true
    return {
      ...member,
      ...(patch.status === undefined ? {} : { status: patch.status }),
      ...(patch.executorRef === undefined ? {} : { executorRef: patch.executorRef }),
      ...(patch.route === undefined ? {} : { route: patch.route }),
    }
  })
  return touched ? { ...record, members } : record
}

/**
 * Derive the phase from what the record actually shows, so a phase can never drift from it.
 *
 * `ended` is sticky (an explicit end outranks any leftover state), `staged` is the pre-approval
 * state, `active` needs something actually in flight, and anything else that has been approved is
 * `idle`. A record that was never approved never becomes `active`, however its members look.
 *
 * `provisioning` COUNTS as in flight: after approval a member sits in `provisioning` until the
 * executor reports a session back, and that window is work happening, not an idle team.
 * @param record - the record to read.
 * @returns the phase to store and to show.
 */
export function derivePhase(record: TeamRecord): TeamPhase {
  if (record.endedAt !== undefined) return "ended"
  if (record.approvedAt === undefined) return "staged"
  /** Whether a member is doing something. */
  const busyMember = record.members.some((member) => member.status === "running" || member.status === "provisioning")
  /** Whether a task is doing something. */
  const busyTask = record.tasks.some((task) => task.status === "in_progress" || task.status === "claimed")
  return busyMember || busyTask ? "active" : "idle"
}

/** The stored phase brought back in line with the record's own contents. */
export function withDerivedPhase(record: TeamRecord): TeamRecord {
  /** The derived phase; a stale stored value is replaced rather than trusted. */
  const phase = derivePhase(record)
  return phase === record.phase ? record : { ...record, phase }
}

/** A task's RENDERED state: `blocked` is computed from the blockers, never stored. */
export type TaskVisual = "completed" | "failed" | "cancelled" | "running" | "blocked" | "open"

/**
 * The blockers that still block: neither completed nor cancelled.
 * @param board - the tasks to resolve against.
 * @param blockedBy - the blocker ids to classify.
 * @returns the still-blocking ids and the ids that failed (which no later state can unblock).
 */
export function blockingDependencies(board: readonly TeamTaskRecord[], blockedBy: readonly string[]): { blocking: string[]; failed: string[] } {
  /** Task lookup by id, the index every blocker walk uses. */
  const byId = new Map(board.map((task) => [task.id, task]))
  /** Blocker ids that still block. */
  const blocking: string[] = []
  /** Blocker ids that failed. */
  const failed: string[] = []
  for (const id of blockedBy) {
    /** This blocker's status; an unknown id counts as pending, hence blocking. */
    const status = byId.get(id)?.status
    if (status === "completed" || status === "cancelled") continue
    if (status === "failed") failed.push(id)
    else blocking.push(id)
  }
  return { blocking, failed }
}

/**
 * The visual state a renderer draws for one task.
 *
 * **OPT-1 (user decision, 2026-09-13) — DO NOT "FIX" THIS.** A FAILED blocker does NOT block its
 * dependents: they stay `open` and dispatchable, and the failure is reported SEPARATELY (see
 * {@link blockingDependencies}'s `failed` list and {@link TeamRecordSummary.releasedByFailure}) so a
 * reader sees it and decides. The reasoning recorded with that decision: a failed dependency must not
 * pin its dependents forever, and a cancelled one already does not. The retired vendored body carried
 * the same three-state rule (`dependencyStates`), the Web panel and the TUI project it, and this store
 * is its third implementation — the three must keep agreeing.
 * @param task - the task to classify.
 * @param board - the tasks its blockers resolve against.
 * @returns the visual state, `blocked` being derived rather than stored.
 */
export function taskVisual(task: TeamTaskRecord, board: readonly TeamTaskRecord[]): TaskVisual {
  if (task.status === "completed") return "completed"
  if (task.status === "failed") return "failed"
  if (task.status === "cancelled") return "cancelled"
  if (task.status === "in_progress" || task.status === "claimed") return "running"
  // OPT-1: only the still-UNSATISFIED blockers count here, which is why a failed one is absent.
  return blockingDependencies(board, task.blockedBy).blocking.length > 0 ? "blocked" : "open"
}

/**
 * Longest blocker-path depth per task: 0 for a root, which is the graph's RANK.
 *
 * A cycle resolves to 0 rather than recursing forever, so a malformed board degrades to a flat
 * drawing instead of a hang.
 * @param board - the tasks to measure.
 * @returns depth per task id.
 */
export function taskDepths(board: readonly TeamTaskRecord[]): Map<string, number> {
  /** Task lookup by id. */
  const byId = new Map(board.map((task) => [task.id, task]))
  /** Memoized depth per task id. */
  const depths = new Map<string, number>()
  /** Ids on the current path, so a cycle resolves instead of recursing. */
  const visiting = new Set<string>()
  /**
   * Longest blocker path below one task.
   * @param id - the task to measure.
   * @returns the path length; 0 for a root, an unknown id or a revisited node.
   */
  const depthOf = (id: string): number => {
    /** This task's memoized depth, when the walk already computed it. */
    const cached = depths.get(id)
    if (cached !== undefined) return cached
    if (visiting.has(id)) return 0
    /** This task's row, undefined when the id is not on the board. */
    const task = byId.get(id)
    if (task === undefined) return 0
    visiting.add(id)
    /** The task's known blockers, sorted so the walk is deterministic. */
    const blockers = [...task.blockedBy].filter((candidate) => byId.has(candidate)).sort()
    /** One plus the deepest blocker, or 0 when nothing blocks below this task. */
    const depth = blockers.length === 0 ? 0 : 1 + Math.max(...blockers.map(depthOf))
    visiting.delete(id)
    depths.set(id, depth)
    return depth
  }
  for (const task of board) depthOf(task.id)
  return depths
}

/**
 * Ids taking part in a blocker cycle, so a malformed board is REPORTED instead of drawn as if it
 * were sound.
 * @param board - the tasks to scan.
 * @returns the ids on at least one cycle, sorted.
 */
export function cycleIds(board: readonly TeamTaskRecord[]): string[] {
  /** Task lookup by id. */
  const byId = new Map(board.map((task) => [task.id, task]))
  /** Ids whose whole subtree was already visited. */
  const done = new Set<string>()
  /** The current DFS path, in visit order. */
  const stack: string[] = []
  /** Membership index of `stack`, so a back edge is recognised in constant time. */
  const inStack = new Set<string>()
  /** Ids proven to sit on a cycle. */
  const cyclic = new Set<string>()
  /**
   * Walk one id's blockers, recording every node on a back edge as cyclic.
   * @param id - the id to visit.
   */
  const visit = (id: string): void => {
    if (done.has(id)) return
    if (inStack.has(id)) {
      for (const entry of stack.slice(stack.indexOf(id))) cyclic.add(entry)
      return
    }
    /** This id's task, undefined when the board does not carry it. */
    const task = byId.get(id)
    if (task === undefined) return
    inStack.add(id)
    stack.push(id)
    for (const blocker of task.blockedBy) if (byId.has(blocker)) visit(blocker)
    stack.pop()
    inStack.delete(id)
    done.add(id)
  }
  for (const task of board) visit(task.id)
  return [...cyclic].sort()
}

/** The tallies and edges every surface shows, computed once from the record. */
export interface TeamRecordSummary {
  /** Total tasks on the board. */
  total: number
  /** Tasks whose own state is `completed`. */
  completed: number
  /** Tasks actually running (in progress or claimed). */
  running: number
  /**
   * Tasks genuinely ready to start: pending, with no unfinished blocker AND no failed one.
   *
   * OPT-1 keeps a task behind a FAILED blocker dispatchable, so those tasks are counted in
   * {@link releasedByFailure} instead of here — the two must never be one number, or "N ready"
   * would hide that N of them can only start because a prerequisite gave up.
   */
  ready: number
  /** Tasks still waiting on an unfinished blocker. */
  blocked: number
  /** Tasks whose OWN state is `failed` — a failed TASK, which is not the same as a failed blocker. */
  failed: number
  /**
   * Tasks OPT-1 releases: pending, with no unfinished blocker, but at least one blocker FAILED.
   *
   * These are dispatchable by decision, and a reader must be able to see that they are dispatchable
   * ONLY because a prerequisite failed — the whole reason OPT-1 reports the failure beside the state
   * rather than folding it into it.
   */
  releasedByFailure: number
  /** Tasks cancelled or otherwise off the board. */
  other: number
  /** Dependency edges across the board. */
  links: number
  /** Ids on at least one blocker cycle; a non-empty list is a broken board, reported not hidden. */
  cycles: string[]
  /** Depth (rank) per task id, the graph's column index. */
  depths: Map<string, number>
}

/**
 * Summarise one record for the surfaces.
 * @param record - the record to summarise.
 * @returns the tallies, the edge count, the cycles and the per-task rank.
 */
export function summariseTeam(record: TeamRecord): TeamRecordSummary {
  /** The board this summary counts. */
  const board = record.tasks
  /** The counts, accumulated in one pass over the board. */
  const summary: TeamRecordSummary = { total: board.length, completed: 0, running: 0, ready: 0, blocked: 0, failed: 0, releasedByFailure: 0, other: 0, links: 0, cycles: cycleIds(board), depths: taskDepths(board) }
  for (const task of board) {
    /** This task's rendered state. */
    const visual = taskVisual(task, board)
    /** This task's blockers, split into "still waiting" and "gave up" (OPT-1). */
    const { blocking, failed } = blockingDependencies(board, task.blockedBy)
    if (visual === "completed") summary.completed += 1
    else if (visual === "running") summary.running += 1
    else if (visual === "blocked") summary.blocked += 1
    else if (visual === "failed") summary.failed += 1
    else if (visual === "open") {
      // OPT-1: a task is still "ready" when a blocker FAILED, because the decision releases it — but
      // it is counted apart, so "6 ready" can never hide "3 of them are only ready because a
      // prerequisite failed".
      if (failed.length > 0 && blocking.length === 0) summary.releasedByFailure += 1
      else summary.ready += 1
    } else summary.other += 1
    summary.links += task.blockedBy.filter((id) => board.some((candidate) => candidate.id === id)).length
  }
  return summary
}

/**
 * One team summary in the shape a TOOL RESULT may carry: identical counts, with `depths` as a plain
 * id→depth RECORD instead of a Map.
 *
 * WHY IT EXISTS (measured 2026-10-02, defect 1): the harness runs its lossless-JSON snapshot over a
 * tool body's value BEFORE it validates the declared output schema, and a `Map` is not lossless JSON
 * — so `agent_teams_plan action:"status"` failed with "value is not lossless JSON" whenever a team
 * record existed, and the whole status view was unreadable. The `mpdTeams` service keeps the Map
 * (the Web and TUI planes index it by id), so the projection belongs at the tool boundary alone.
 */
export interface TeamRecordSummaryResult extends Omit<TeamRecordSummary, "depths"> {
  /** Longest blocker path per task id, as a plain record keyed by task id. */
  depths: Record<string, number>
}

/**
 * Project a summary onto the lossless-JSON shape a tool result must carry.
 *
 * @param summary - the summary read from the store.
 * @returns the same counts, with `depths` as a plain record.
 */
export function losslessSummary(summary: TeamRecordSummary): TeamRecordSummaryResult {
  return { ...summary, depths: Object.fromEntries(summary.depths) }
}

/** The member's progress over the tasks it owns. */
export interface MemberProgress {
  /** Tasks owned by this member that are completed. */
  done: number
  /** Tasks owned by this member, in any state. */
  total: number
  /** The first unfinished task this member owns, when there is one. */
  current?: string
}

/**
 * One member's progress, matched by display name.
 * @param record - the record to read.
 * @param name - the member's display name.
 * @returns the counts and the current task id.
 */
export function memberProgress(record: TeamRecord, name: string): MemberProgress {
  /** Tasks this member owns, in board order. */
  const owned = record.tasks.filter((task) => task.owner === name)
  /** The first owned task that is not finished. */
  const current = owned.find((task) => task.status !== "completed" && task.status !== "cancelled")
  return {
    done: owned.filter((task) => task.status === "completed").length,
    total: owned.length,
    ...(current === undefined ? {} : { current: current.id }),
  }
}

/**
 * The tasks ready to be dispatched: pending, and with no UNSATISFIED blocker (OPT-1).
 *
 * A blocker that FAILED does not hold a task back — see {@link taskVisual} for the decision and its
 * reason. {@link summariseTeam} counts those tasks apart, so "ready" and "ready only because a
 * prerequisite failed" are never the same number.
 * @param record - the record to read.
 * @returns the dispatchable tasks, in board order.
 */
export function readyTasks(record: TeamRecord): TeamTaskRecord[] {
  return record.tasks.filter((task) => task.status === "pending" && blockingDependencies(record.tasks, task.blockedBy).blocking.length === 0)
}

/** The members free to take work: provisioned, and with no task in flight. */
export function idleMembers(record: TeamRecord): TeamMemberRecord[] {
  /** Names with a task actually in flight. */
  const busy = new Set(record.tasks.filter((task) => task.status === "in_progress" || task.status === "claimed").map((task) => task.owner).filter((owner): owner is string => owner !== undefined))
  return record.members.filter((member) => member.status === "running" && !busy.has(member.name))
}
