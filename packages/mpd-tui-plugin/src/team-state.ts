// Read-only projection of ONE team's workflow — the data behind the two new TUI
// surfaces (`mpd-tui-team`, `mpd-tui-plan`).
//
// Boundary (frozen contract `.mpd/plans/tui-team-surface.md` §5.5): this module
// READS `<workspace>/.mpd/team/<teamId>/team.json` (the adopted agent-teams
// plugin owns that file) and the mailboxes under it. It performs ZERO writes —
// no write primitive may appear in this package's built bytes — and it never
// touches a harness service: mutation goes through the adapter, in index.ts.
//
// Everything is projected from the REAL durable record, not a hand-built object:
// the field names below are the adopted `team.json` shape and the semantics of
// `depth`, `failed-dependency` marking and "which task is a member on" mirror the
// Web panel's own snapshot assembly (`lib/snapshot.js:56-118`,
// `lib/state.js:114-128`/`:1397-1442`) so the two editions cannot disagree about
// a fact they both display.
//
// Nothing here throws: a missing, unreadable or malformed record degrades to an
// empty workflow plus a bounded problem note. A scene must never be able to take
// the session down (contract §10, last acceptance criterion).
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { scalarText } from "./sanitize.js"

/** Bounded caps — the board's own values, so one pathological record cannot stall a render. */
const MAX_TEAMS = 20
const MAX_TASKS = 5000
const MAX_PROBLEMS = 5
const MAX_INBOX_TAIL = 5
/** Mirror of the adopted mailbox lease: a delivery claim younger than this is not unread. */
const MAILBOX_LEASE_MS = 60_000
/** The captain's mailbox key (adopted `CAPTAIN_KEY`). */
const CAPTAIN_KEY = "captain"
/** The mailbox key cap (adopted `MAX_KEY_LENGTH`). */
const MAILBOX_KEY_MAX = 48

/** One task row of the workflow view. */
export interface TeamTaskRow {
  id: string
  subject: string
  /** Optional in the durable record — a hand-written fixture may omit it (§3.1 item 4). */
  kind?: string
  status: string
  /** The visual state the Web panel computes: completed|failed|cancelled|running|blocked|open. */
  visual: string
  assignee?: string
  attempt?: number
  round?: number
  verdict?: string
  dependencies: string[]
  failedDependencies: string[]
  /** Longest dependency path length (0 = a root); the row's indent. */
  depth: number
}

/** One roster row: the member plus the progress facts the Web panel shows. */
export interface TeamMemberRow {
  name: string
  role?: string
  /** `provider/model`, or the bare model when no provider is recorded. */
  route?: string
  status: string
  done: number
  total: number
  progress: number
  currentTask?: string
  unread: number
}

/** The team-level facts. */
export interface TeamHead {
  id: string
  name: string
  phase: string
  description?: string
  captainSessionId?: string
  planReviewState?: string
  /** `approvedAt ?? createdAt`, the record's own ordering stamp. */
  stagedAt?: string
  /** True while `phase === "staged"` — the Web's own precondition for the plan editor. */
  staged: boolean
  runnable: boolean
  links: number
}

/** The whole projection. `team` is undefined when the workspace has no readable record. */
export interface TeamWorkflow {
  workspace: string
  team?: TeamHead
  members: TeamMemberRow[]
  tasks: TeamTaskRow[]
  counts: {
    total: number
    completed: number
    inProgress: number
    pending: number
    claimed: number
    failed: number
    cancelled: number
    other: number
  }
  mail: { unread: number; captainInbox: { from: string; content: string }[] }
  /** Team ids the team watchdog currently holds for this workspace (never fabricated). */
  holds: readonly string[]
  problems: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

/** Sanitized optional text: `undefined` when the field is missing or not a scalar. */
function asText(value: unknown, maxCells: number): string | undefined {
  return scalarText(value, maxCells)
}

/** Spread one optional sanitized field into an object literal. */
function optional(key: string, value: string | undefined): Record<string, string> {
  return value === undefined ? {} : { [key]: value }
}

/** The adopted mailbox key normalization (mirrors `state.js:sanitizeKey`). */
export function mailboxKey(name: string): string {
  const cleaned = name
    .normalize("NFC")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
  if (cleaned === "") return ""
  const points = [...cleaned]
  return points.length > MAILBOX_KEY_MAX ? points.slice(0, MAILBOX_KEY_MAX).join("") : cleaned
}

/**
 * Unread messages in one mailbox file, by the adopted reader's own rule
 * (`state.js:845-855`): tombstones never count, a read message never counts, and
 * a delivery claim inside the lease window does not count yet.
 */
function unreadCount(file: string): number {
  let raw: string
  try {
    raw = readFileSync(file, "utf8")
  } catch {
    return 0
  }
  const now = Date.now()
  let unread = 0
  for (const rawLine of raw.split("\n")) {
    const line = rawLine.replace(/^\uFEFF/u, "")
    if (line.trim() === "") continue
    let value: unknown
    try {
      value = JSON.parse(line)
    } catch {
      continue
    }
    if (!isRecord(value)) continue
    if (value.tombstone === true) continue
    if (value.readAt !== undefined) continue
    const claimed = asNumber(value.deliveryClaimedAt)
    if (claimed !== undefined && now - claimed < MAILBOX_LEASE_MS) continue
    unread += 1
  }
  return unread
}

/** The last N captain-inbox rows, as `{from, content}` (the Web panel's own tail shape). */
function captainInboxTail(file: string): { from: string; content: string }[] {
  let raw: string
  try {
    raw = readFileSync(file, "utf8")
  } catch {
    return []
  }
  const tail: { from: string; content: string }[] = []
  for (const rawLine of raw.split("\n")) {
    const line = rawLine.replace(/^\uFEFF/u, "")
    if (line.trim() === "") continue
    let value: unknown
    try {
      value = JSON.parse(line)
    } catch {
      continue
    }
    if (!isRecord(value) || value.tombstone === true) continue
    const from = scalarText(value.from, 40) ?? "?"
    const content = scalarText(value.content, 200) ?? ""
    if (content === "") continue
    tail.push({ from, content })
  }
  return tail.slice(-MAX_INBOX_TAIL)
}

/** The dependency ids that still block (`state.js:dependencyStates`). */
function blockingDependencies(tasks: readonly TeamTaskRow[], dependencies: readonly string[]): { blocking: string[]; failed: string[] } {
  const byId = new Map(tasks.map((task) => [task.id, task]))
  const blocking: string[] = []
  const failed: string[] = []
  for (const id of dependencies) {
    const status = byId.get(id)?.status
    if (status === "completed" || status === "cancelled") continue
    if (status === "failed") failed.push(id)
    else blocking.push(id)
  }
  return { blocking, failed }
}

/** The visual state the Web panel renders (`state.js:1397-1407`). */
export function taskVisualState(status: string, tasks: readonly TeamTaskRow[], dependencies: readonly string[]): string {
  if (status === "completed") return "completed"
  if (status === "failed") return "failed"
  if (status === "cancelled") return "cancelled"
  if (status === "in_progress") return "running"
  return blockingDependencies(tasks, dependencies).blocking.length > 0 ? "blocked" : "open"
}

/**
 * Longest dependency-path depth per task (`state.js:1415-1442`). A cycle is
 * visible instead of fatal: a revisited node resolves to 0 and the caller adds a
 * note, so the render can never hang or blow the stack.
 */
export function taskDepths(tasks: readonly { id: string; dependencies: readonly string[] }[]): Map<string, number> {
  const byId = new Map(tasks.map((task) => [task.id, task]))
  const depths = new Map<string, number>()
  const visiting = new Set<string>()
  const depthOf = (taskId: string): number => {
    const cached = depths.get(taskId)
    if (cached !== undefined) return cached
    if (visiting.has(taskId)) return 0
    const task = byId.get(taskId)
    if (task === undefined) return 0
    visiting.add(taskId)
    const dependencies = [...task.dependencies].filter((id) => byId.has(id)).sort()
    const depth = dependencies.length === 0 ? 0 : 1 + Math.max(...dependencies.map(depthOf))
    visiting.delete(taskId)
    depths.set(taskId, depth)
    return depth
  }
  for (const task of tasks) depthOf(task.id)
  return depths
}

/** Ids taking part in a dependency cycle (a bounded, visible note instead of a hang). */
export function cycleIds(tasks: readonly { id: string; dependencies: readonly string[] }[]): string[] {
  const byId = new Map(tasks.map((task) => [task.id, task]))
  const done = new Set<string>()
  const stack: string[] = []
  const inStack = new Set<string>()
  const cyclic = new Set<string>()
  const visit = (id: string): void => {
    if (done.has(id)) return
    if (inStack.has(id)) {
      for (const entry of stack.slice(stack.indexOf(id))) cyclic.add(entry)
      return
    }
    const task = byId.get(id)
    if (task === undefined) return
    inStack.add(id)
    stack.push(id)
    for (const dependency of task.dependencies) if (byId.has(dependency)) visit(dependency)
    stack.pop()
    inStack.delete(id)
    done.add(id)
  }
  for (const task of tasks) visit(task.id)
  return [...cyclic].sort()
}

/** The first unfinished task a member owns (`snapshot.js:15-21`). */
function currentTaskOf(memberName: string, tasks: readonly TeamTaskRow[]): string | undefined {
  for (const task of tasks) {
    if (task.status === "in_progress" && task.assignee === memberName) return task.id
  }
  return undefined
}

/** Pick the newest record: `approvedAt ?? createdAt`, ties by file size (`state.ts:107-109`). */
function newestRecordPath(teamsDir: string, problems: string[]): string | undefined {
  let entries: string[]
  try {
    entries = readdirSync(teamsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .slice(0, MAX_TEAMS)
  } catch {
    return undefined
  }
  let best: { path: string; record: Record<string, unknown>; sortKey: string } | undefined
  for (const name of entries) {
    const path = join(teamsDir, name, "team.json")
    let size: number
    try {
      size = statSync(path).size
    } catch {
      problems.push(`team ${name}: unreadable`)
      continue
    }
    let record: unknown
    try {
      record = JSON.parse(readFileSync(path, "utf8"))
    } catch {
      problems.push(`team ${name}: invalid JSON`)
      continue
    }
    if (!isRecord(record)) {
      problems.push(`team ${name}: not an object`)
      continue
    }
    const stamp = String(record.approvedAt ?? record.createdAt ?? "")
    const sortKey = `${stamp}\u0000${String(size).padStart(12, "0")}`
    if (best === undefined || sortKey > best.sortKey) best = { path, record, sortKey }
  }
  return best?.path
}

/** An empty workflow: what every failure path renders instead of a crash. */
function emptyWorkflow(workspace: string, problems: string[], holds: readonly string[]): TeamWorkflow {
  return {
    workspace,
    members: [],
    tasks: [],
    counts: { total: 0, completed: 0, inProgress: 0, pending: 0, claimed: 0, failed: 0, cancelled: 0, other: 0 },
    mail: { unread: 0, captainInbox: [] },
    holds,
    problems,
  }
}

/**
 * Read one workflow projection.
 * @param workspace - the calling session's workspace root (never `process.cwd()` cached).
 * @param holds - the team ids the watchdog currently holds (read through its service).
 * @returns the projection; never throws.
 */
export function readTeamWorkflow(workspace: string, holds: readonly string[] = []): TeamWorkflow {
  const problems: string[] = []
  const teamsDir = join(workspace, ".mpd", "team")
  let path: string | undefined
  try {
    path = newestRecordPath(teamsDir, problems)
  } catch {
    problems.push("team state unreadable")
  }
  if (path === undefined) {
    if (problems.length === 0) return emptyWorkflow(workspace, problems, holds)
    return emptyWorkflow(workspace, problems.slice(0, MAX_PROBLEMS), holds)
  }
  let record: Record<string, unknown>
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"))
    if (!isRecord(parsed)) throw new Error("not an object")
    record = parsed
  } catch {
    problems.push("team record unreadable")
    return emptyWorkflow(workspace, problems.slice(0, MAX_PROBLEMS), holds)
  }

  const tasks: TeamTaskRow[] = []
  for (const raw of asArray(record.tasks).slice(0, MAX_TASKS)) {
    if (!isRecord(raw)) continue
    const id = asText(raw.id, 40)
    if (id === undefined) continue
    const dependencies = asArray(raw.dependencies)
      .map((entry) => asText(entry, 40))
      .filter((entry): entry is string => entry !== undefined)
    tasks.push({
      id,
      subject: asText(raw.subject, 160) ?? "",
      ...optional("kind", asText(raw.kind, 40)),
      status: asText(raw.status, 40) ?? "pending",
      visual: "open",
      ...optional("assignee", asText(raw.assignee, 80)),
      ...(asNumber(raw.attempt) === undefined ? {} : { attempt: asNumber(raw.attempt) as number }),
      ...(asNumber(raw.round) === undefined ? {} : { round: asNumber(raw.round) as number }),
      ...optional("verdict", asText(raw.verdict, 40)),
      dependencies,
      failedDependencies: [],
      depth: 0,
    })
  }
  const depths = taskDepths(tasks)
  for (const task of tasks) {
    task.depth = depths.get(task.id) ?? 0
    task.failedDependencies = blockingDependencies(tasks, task.dependencies).failed
    task.visual = taskVisualState(task.status, tasks, task.dependencies)
  }
  // Frozen §3.1 item 4: the DAG is "ordered by `depth` then creation order". The order is
  // established ONCE here, in the projection, so both renderers (`teamWorkflowLines` and
  // `planProjectionLines`) emit the identical sequence and neither can drift. `createdAt`
  // is not a per-task fact in the durable record, so the record's own array index IS the
  // creation-order tiebreak (the array is appended in creation order by the adopted plugin).
  const creationIndex = new Map(tasks.map((task, index) => [task.id, index]))
  tasks.sort((left, right) => left.depth - right.depth || (creationIndex.get(left.id) ?? 0) - (creationIndex.get(right.id) ?? 0))
  const cycle = cycleIds(tasks)
  if (cycle.length > 0) problems.push(`cycle ${cycle.join(",")}`)

  const counts = { total: 0, completed: 0, inProgress: 0, pending: 0, claimed: 0, failed: 0, cancelled: 0, other: 0 }
  for (const task of tasks) {
    counts.total += 1
    switch (task.status) {
      case "completed":
        counts.completed += 1
        break
      case "in_progress":
        counts.inProgress += 1
        break
      case "pending":
        counts.pending += 1
        break
      case "claimed":
        counts.claimed += 1
        break
      case "failed":
        counts.failed += 1
        break
      case "cancelled":
        counts.cancelled += 1
        break
      default:
        counts.other += 1
    }
  }

  const teamId = asText(record.id, 60) ?? "?"
  const inboxDir = join(workspace, ".mpd", "team", asString(record.id) ?? "", "inbox")
  const members: TeamMemberRow[] = []
  let unreadTotal = 0
  for (const raw of asArray(record.members)) {
    if (!isRecord(raw)) continue
    const status = asText(raw.status, 40) ?? "unknown"
    if (status === "removed") continue
    const name = asText(raw.name, 80) ?? "?"
    const provider = asString(raw.provider)?.trim() ?? ""
    const model = asString(raw.model)?.trim() ?? ""
    const route = provider !== "" && model !== "" ? `${provider}/${model}` : model !== "" ? model : undefined
    const owned = tasks.filter((task) => task.assignee === name)
    const done = owned.filter((task) => task.status === "completed").length
    const key = mailboxKey(name)
    const unread = key === "" ? 0 : unreadCount(join(inboxDir, `${key}.jsonl`))
    unreadTotal += unread
    const currentTask = currentTaskOf(name, tasks)
    members.push({
      name,
      ...optional("role", asText(raw.role, 120)),
      ...optional("route", route),
      status,
      done,
      total: owned.length,
      progress: owned.length === 0 ? 0 : Math.round((done / owned.length) * 100),
      ...optional("currentTask", currentTask),
      unread,
    })
  }
  const captainKey = mailboxKey(CAPTAIN_KEY)
  const captainFile = join(inboxDir, `${captainKey}.jsonl`)
  const captainUnread = unreadCount(captainFile)
  const inboxTail = captainInboxTail(captainFile)

  const phase = asText(record.phase, 40) ?? "running"
  const staged = phase === "staged"
  const planReviewState = asText(record.planReviewState, 40) ?? (staged ? "awaiting_review" : undefined)
  const stagedAt = asText(record.approvedAt ?? record.createdAt, 40)
  const links = tasks.reduce((sum, task) => sum + task.dependencies.length, 0)

  return {
    workspace,
    team: {
      id: teamId,
      name: asText(record.name, 80) ?? "?",
      phase,
      ...optional("description", asText(record.description, 160)),
      ...optional("captainSessionId", asText(record.captainSessionId, 80)),
      ...optional("planReviewState", planReviewState),
      ...optional("stagedAt", stagedAt),
      staged,
      runnable: members.length > 0 && tasks.length > 0,
      links,
    },
    members,
    tasks,
    counts,
    mail: { unread: unreadTotal + captainUnread, captainInbox: inboxTail },
    holds,
    problems: problems.slice(0, MAX_PROBLEMS),
  }
}

/** The exact phrase the user must type to approve (`approve <teamId>`), from the record's own id. */
export function approvalPhrase(teamId: string): string {
  return `approve ${teamId}`
}

/** The team-scene body: header, watchdog, roster, task DAG, counts, mailbox, problems. */
export function teamWorkflowLines(workflow: TeamWorkflow): string[] {
  if (workflow.team === undefined) return ["team       (none in this workspace)"]
  const team = workflow.team
  const lines: string[] = []
  lines.push(`team       ${team.name} (${team.id})`)
  lines.push(`phase      ${team.phase}`)
  if (team.staged && team.planReviewState !== undefined) lines.push(`plan       ${team.planReviewState}`)
  if (team.captainSessionId !== undefined) lines.push(`captain    ${team.captainSessionId}`)
  if (team.staged && team.stagedAt !== undefined) lines.push(`staged     ${team.stagedAt}`)
  // A hold row exists ONLY while the watchdog reports this team as held: never a fabricated "ok".
  if (workflow.holds.includes(team.id)) lines.push(`watchdog   HELD (${workflow.holds.join(", ")})`)
  lines.push("")
  lines.push("roster")
  if (workflow.members.length === 0) lines.push("  (no members)")
  for (const member of workflow.members) {
    const parts = [member.name]
    if (member.role !== undefined) parts.push(member.role)
    if (member.route !== undefined) parts.push(member.route)
    parts.push(member.status)
    let row = `  ${parts.join(" · ")}`
    row += ` · ${member.done}/${member.total}`
    if (member.currentTask !== undefined) row += ` · ${member.currentTask}`
    if (member.unread > 0) row += ` · ${member.unread} unread`
    lines.push(row)
  }
  lines.push("")
  lines.push("tasks")
  if (workflow.tasks.length === 0) lines.push("  (no tasks)")
  for (const task of workflow.tasks) {
    const indent = "  ".repeat(Math.min(task.depth, 12))
    let row = `${indent}${task.id} [${task.kind ?? "-"}] ${task.subject} · ${task.status}`
    if (task.assignee !== undefined) row += ` @${task.assignee}`
    if (task.attempt !== undefined) row += ` attempt ${task.attempt}`
    if (task.round !== undefined) row += ` r${task.round}`
    if (task.verdict !== undefined) row += ` verdict ${task.verdict}`
    if (task.dependencies.length > 0) row += ` deps=${task.dependencies.join(",")}`
    for (const failed of task.failedDependencies) row += ` failed-dep=${failed}`
    if (task.visual === "blocked") row += " BLOCKED"
    lines.push(row)
  }
  lines.push("")
  const tasks = workflow.counts
  lines.push(
    `tasks      ${tasks.total} total · ${tasks.completed} completed · ${tasks.inProgress} in progress · ${tasks.pending} pending · ${tasks.claimed} claimed · ${tasks.failed} failed`,
  )
  lines.push(`mail       ${workflow.mail.unread} unread`)
  for (const message of workflow.mail.captainInbox) lines.push(`  ${message.from}: ${message.content}`)
  if (workflow.problems.length > 0) {
    lines.push("")
    for (const problem of workflow.problems) lines.push(`note       ${problem}`)
  }
  return lines
}

/** The plan-scene projection lines (read-only; the action block is appended by the scene). */
export function planProjectionLines(workflow: TeamWorkflow): string[] {
  if (workflow.team === undefined) return ["no staged plan for team (none)"]
  const team = workflow.team
  const lines: string[] = []
  lines.push(`team       ${team.name} (${team.id}) · phase ${team.phase} · review ${team.planReviewState ?? "-"}`)
  lines.push(`members    ${workflow.members.length} · tasks ${workflow.tasks.length} · links ${team.links}`)
  // The Web's own runnable gate (`client.js:1459`), restated for the terminal.
  lines.push(`runnable   ${team.runnable ? "yes" : "no"}`)
  // The TUI has no inline editors (NOT-CLAIMED #2), so this is always `none`.
  lines.push("edits      none (the TUI has no inline plan editors)")
  lines.push("")
  lines.push("roster")
  if (workflow.members.length === 0) lines.push("  (no members)")
  for (const member of workflow.members) {
    const parts = [member.name]
    if (member.role !== undefined) parts.push(member.role)
    if (member.route !== undefined) parts.push(member.route)
    parts.push(member.status)
    lines.push(`  ${parts.join(" · ")} · ${member.done}/${member.total}`)
  }
  lines.push("")
  lines.push("tasks")
  if (workflow.tasks.length === 0) lines.push("  (no tasks)")
  for (const task of workflow.tasks) {
    const indent = "  ".repeat(Math.min(task.depth, 12))
    let row = `${indent}${task.id} [${task.kind ?? "-"}] ${task.subject} · ${task.status}`
    if (task.assignee !== undefined) row += ` @${task.assignee}`
    if (task.dependencies.length > 0) row += ` deps=${task.dependencies.join(",")}`
    if (task.visual === "blocked") row += " BLOCKED"
    lines.push(row)
  }
  return lines
}
