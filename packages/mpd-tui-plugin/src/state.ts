// Read-only projection of the mpd state the TUI board and status line show.
//
// Every path is resolved UNDER the given workspace root (the caller passes
// `dsh.workspaceRoot(exec)`, i.e. the calling session's cwd first — never the
// dsh process cwd), except the workmate library, which is the user's
// cross-project library under `$HOME/.mpd/workmate` by design (AGENTS.md §6).
//
// Nothing here throws: a missing/broken state file degrades to an empty
// section plus a bounded problem note, because a status line or a board must
// never be able to take the TUI down.
import { readFileSync, readdirSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { scalarText } from "./sanitize.js"

/** Bounded caps so one pathological state directory cannot stall a render. */
const MAX_TEAMS = 20
const MAX_PLANS = 200
const MAX_WORKMATES = 200
const MAX_TASKS = 5000
const MAX_PROBLEMS = 5

export interface TeamSummary {
  id: string
  name: string
  phase: string
  description?: string
  /** `awaiting_review` | `awaiting_feedback` — present only while the team is staged. */
  planReviewState?: string
  members: number
  tasks: {
    total: number
    completed: number
    inProgress: number
    pending: number
    failed: number
    claimed: number
    cancelled: number
    other: number
  }
}

export interface BoulderSummary {
  works: number
  active: number
  completed: number
  paused: number
  abandoned: number
  newestPlan?: string
}

export interface BoardState {
  /** Workspace root the workspace-local sections were read from. */
  workspace: string
  /** Home directory the workmate library was read from. */
  home: string
  team?: TeamSummary
  boulder?: BoulderSummary
  plans: { count: number; newest?: string }
  workmates: { count: number; names: string[] }
  /** Bounded, sanitized notes about entries that could not be read. */
  problems: string[]
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

/** `.mpd/team/<teamId>/team.json` — the newest team record wins. */
function readTeam(root: string, problems: string[]): TeamSummary | undefined {
  const teamsDir = join(root, ".mpd", "team")
  let entries: string[]
  try {
    entries = readdirSync(teamsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .slice(0, MAX_TEAMS)
  } catch {
    return undefined
  }
  let best: { record: Record<string, unknown>; sortKey: string } | undefined
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
      record = readJson(path)
    } catch {
      problems.push(`team ${name}: invalid JSON`)
      continue
    }
    if (!isRecord(record)) continue
    // Newest first: a later record timestamp wins; ties fall back to file size,
    // so the fully-frozen team record beats a half-written one.
    const stamp = String(record.approvedAt ?? record.createdAt ?? "")
    const sortKey = `${stamp}\u0000${String(size).padStart(12, "0")}`
    if (best === undefined || sortKey > best.sortKey) best = { record, sortKey }
  }
  if (best === undefined) return undefined
  const record = best.record
  const counts = { total: 0, completed: 0, inProgress: 0, pending: 0, failed: 0, claimed: 0, cancelled: 0, other: 0 }
  for (const task of asArray(record.tasks).slice(0, MAX_TASKS)) {
    if (!isRecord(task)) continue
    counts.total += 1
    switch (String(task.status ?? "pending")) {
      case "completed":
        counts.completed += 1
        break
      case "in_progress":
        counts.inProgress += 1
        break
      case "pending":
        counts.pending += 1
        break
      case "failed":
        counts.failed += 1
        break
      case "claimed":
        counts.claimed += 1
        break
      case "cancelled":
        counts.cancelled += 1
        break
      default:
        counts.other += 1
    }
  }
  const phase = scalarText(record.phase, 40) ?? "unknown"
  const planReviewState = scalarText(record.planReviewState, 40) ?? (phase === "staged" ? "awaiting_review" : undefined)
  return {
    id: scalarText(record.id, 60) ?? "?",
    name: scalarText(record.name, 80) ?? "?",
    phase,
    description: scalarText(record.description, 160),
    ...(planReviewState === undefined ? {} : { planReviewState }),
    members: asArray(record.members).length,
    tasks: counts,
  }
}

/** `.mpd/boulder.json` — `works` is keyed by work id (tolerates an array form). */
function readBoulder(root: string, problems: string[]): BoulderSummary | undefined {
  const path = join(root, ".mpd", "boulder.json")
  let document: unknown
  try {
    document = readJson(path)
  } catch (error) {
    const code = (error as { code?: string } | undefined)?.code
    if (code !== "ENOENT") problems.push(`boulder.json: ${code === undefined ? "unreadable" : "invalid JSON"}`)
    return undefined
  }
  if (!isRecord(document)) return undefined
  const raw = isRecord(document.works) ? Object.values(document.works) : asArray(document.works)
  const summary: BoulderSummary = { works: 0, active: 0, completed: 0, paused: 0, abandoned: 0 }
  for (const work of raw) {
    if (!isRecord(work)) continue
    summary.works += 1
    const status = String(work.status ?? "active")
    if (status === "active") summary.active += 1
    else if (status === "completed") summary.completed += 1
    else if (status === "paused") summary.paused += 1
    else if (status === "abandoned") summary.abandoned += 1
    const plan = scalarText(work.plan_name ?? work.active_plan, 120)
    if (plan !== undefined && (summary.newestPlan === undefined || plan > summary.newestPlan)) summary.newestPlan = plan
  }
  return summary
}

/** `.mpd/plans/*.md` — the plan files a boulder work can be bound to. */
function readPlans(root: string): { count: number; newest?: string } {
  const dir = join(root, ".mpd", "plans")
  try {
    const names = readdirSync(dir)
      .filter((name) => name.endsWith(".md"))
      .sort()
    return { count: names.length, newest: scalarText(names[names.length - 1], 120) }
  } catch {
    return { count: 0 }
  }
}

/** `$HOME/.mpd/workmate/<key>/meta.json` — the durable workmate library. */
function readWorkmates(home: string): { count: number; names: string[] } {
  const dir = join(home, ".mpd", "workmate")
  try {
    const names = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => entry.name)
      .slice(0, MAX_WORKMATES)
    const present: string[] = []
    for (const name of names) {
      try {
        const meta = readJson(join(dir, name, "meta.json"))
        const label = isRecord(meta) ? scalarText(meta.name ?? name, 60) : undefined
        present.push(label ?? scalarText(name, 60) ?? "?")
      } catch {
        // Orphan directory (no meta.json): not an addressable instance.
      }
    }
    present.sort()
    return { count: present.length, names: present }
  } catch {
    return { count: 0, names: [] }
  }
}

/**
 * Read the whole board projection once.
 * @param workspace - the calling session's workspace root.
 * @param home - the home directory holding the workmate library.
 * @returns the projection; never throws.
 */
export function readBoardState(workspace: string, home: string = homedir()): BoardState {
  const problems: string[] = []
  const state: BoardState = {
    workspace,
    home,
    plans: readPlans(workspace),
    workmates: readWorkmates(home),
    problems,
  }
  try {
    state.team = readTeam(workspace, problems)
  } catch {
    problems.push("team state unreadable")
  }
  try {
    state.boulder = readBoulder(workspace, problems)
  } catch {
    problems.push("boulder state unreadable")
  }
  if (problems.length > MAX_PROBLEMS) problems.length = MAX_PROBLEMS
  return state
}

/** One compact line for the keyed status contribution (`tuiStatus`). */
/**
 * The runtime notice a save with no live session workspace produces (§D.2 row 2). It is a
 * CONSTANT because the same sentence must appear on every surface that reports the outcome,
 * and it is passed in (never read from disk) because this package performs zero writes.
 */
export const NO_LIVE_SESSION_NOTICE = "saved to settings — not yet written to any .mpd/mpd.jsonc (no live session)"

/**
 * The notice for the N-root refusal: settings-only, with the candidates in the bridge's log line.
 * Same two-part honesty as above — persisted, not written, and never lost.
 */
export const AMBIGUOUS_MULTI_ROOT_NOTICE = "saved to settings — not written to any file: several live workspaces, so the target is ambiguous (see the log for the candidates)"

export function statusLine(state: BoardState, notice?: string): string {
  const parts: string[] = []
  if (state.team !== undefined) {
    const done = state.team.tasks.completed
    const total = state.team.tasks.total
    parts.push(`team ${state.team.name} ${state.team.members}·${done}/${total}`)
    if (state.team.tasks.failed > 0) parts.push(`failed ${state.team.tasks.failed}`)
  } else {
    parts.push("team -")
  }
  if (state.boulder !== undefined && state.boulder.works > 0) parts.push(`boulder ${state.boulder.active}/${state.boulder.works}`)
  parts.push(`plans ${state.plans.count}`)
  parts.push(`workmates ${state.workmates.count}`)
  if (state.problems.length > 0) parts.push(`notes ${state.problems.length}`)
  // The bridge notice goes LAST so the counts stay readable, and it is the exact sentence
  // the design fixes for this case (never a paraphrase).
  if (notice !== undefined && notice.length > 0) parts.push(notice)
  return `mpd: ${parts.join(" · ")}`
}

/** Body lines for the board scene, already sanitized and bounded. */
export function boardLines(state: BoardState, holds: readonly string[] = []): string[] {
  const lines: string[] = []
  lines.push(`workspace  ${state.workspace}`)
  if (state.team !== undefined) {
    const tasks = state.team.tasks
    lines.push("")
    lines.push(`team       ${state.team.name} (${state.team.id}) · phase ${state.team.phase}`)
    lines.push(`members    ${state.team.members}`)
    lines.push(
      `tasks      ${tasks.total} total · ${tasks.completed} completed · ${tasks.inProgress} in progress · ${tasks.pending} pending · ${tasks.claimed} claimed · ${tasks.failed} failed`,
    )
    // T3 (frozen §3.3): the staged state without opening a scene. Omitted, never faked, when
    // the team is not staged.
    if (state.team.phase === "staged" && state.team.planReviewState !== undefined) {
      lines.push(`team-plan  ${state.team.planReviewState}`)
    }
  } else {
    lines.push("")
    lines.push("team       (none in this workspace)")
  }
  // T3: the team watchdog's own HOLD, a different fact from `halted` (snapshot.js:94).
  if (holds.length > 0) lines.push(`team-hold  held (${holds.join(", ")})`)
  lines.push("")
  if (state.boulder !== undefined && state.boulder.works > 0) {
    lines.push(
      `boulder    ${state.boulder.works} work(s) · ${state.boulder.active} active · ${state.boulder.completed} completed${state.boulder.newestPlan === undefined ? "" : ` · newest ${state.boulder.newestPlan}`}`,
    )
  } else {
    lines.push("boulder    (no work ledger)")
  }
  lines.push(`plans      ${state.plans.count}${state.plans.newest === undefined ? "" : ` · newest ${state.plans.newest}`}`)
  lines.push(
    `workmates  ${state.workmates.count}${state.workmates.names.length === 0 ? "" : ` · ${state.workmates.names.slice(0, 6).join(", ")}`}`,
  )
  if (state.problems.length > 0) {
    lines.push("")
    for (const problem of state.problems) lines.push(`note       ${problem}`)
  }
  return lines
}
