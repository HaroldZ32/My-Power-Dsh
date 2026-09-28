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
import { isRecord } from "../../mpd-dsh-adapter-plugin/src/index.js"
import type { DshTeamView } from "../../mpd-dsh-adapter-plugin/src/index.js"
import { scalarText } from "./sanitize.js"

/** Bounded caps so one pathological state directory cannot stall a render. */
const MAX_TEAMS = 20
/** Plan files scanned before the projection stops counting, a render-stall bound. */
const MAX_PLANS = 200
/** Workmate directories enumerated before the projection stops, a render-stall bound. */
const MAX_WORKMATES = 200
/** Tasks counted per team before the tally stops, a render-stall bound. */
const MAX_TASKS = 5000
/** Problem notes kept for display; further ones are dropped, not queued. */
const MAX_PROBLEMS = 5

/** The live team as the board and status line show it, projected from the official readout. */
export interface TeamSummary {
  /** The team's own id, sanitized; `?` when the readout does not carry one. */
  id: string
  /** The lead's name, sanitized; `?` when the readout does not carry one. */
  name: string
  /** Derived phase: `active` while a teammate runs or provisions, else `idle`. */
  phase: string
  /** The team's description; has no official source in 0.1.7, so it stays absent. */
  description?: string
  /** `awaiting_review` | `awaiting_feedback` — present only while the team is staged. */
  planReviewState?: string
  /** Teammates on the roster, the lead excluded. */
  members: number
  /** Task tally by state, one bucket per official status plus `other`. */
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

/** The boulder work ledger as the board shows it, tallied by status. */
export interface BoulderSummary {
  /** Works recorded in the ledger. */
  works: number
  /** Works whose status is `active` (also the default for a record without one). */
  active: number
  /** Works whose status is `completed`. */
  completed: number
  /** Works whose status is `paused`. */
  paused: number
  /** Works whose status is `abandoned`. */
  abandoned: number
  /** Highest plan name seen across the works, by plain string order. */
  newestPlan?: string
}

/** One board projection: the three workspace sections plus the home-side workmate library. */
export interface BoardState {
  /** Workspace root the workspace-local sections were read from. */
  workspace: string
  /** Home directory the workmate library was read from. */
  home: string
  /** The live team, absent when the readout carries none. */
  team?: TeamSummary
  /** The work ledger, absent when the file is missing or unreadable. */
  boulder?: BoulderSummary
  /** Plan-file count and the newest name, ordered by file name. */
  plans: { count: number; newest?: string }
  /** Workmate instances found in the library, sorted by display name. */
  workmates: { count: number; names: string[] }
  /** Bounded, sanitized notes about entries that could not be read. */
  problems: string[]
}

/** Reads and parses a JSON file; a missing or malformed file throws to the caller. */
function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"))
}


/** Treats a non-array as absent, so a malformed section degrades to empty. */
function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}
/**
 * The live team summary, projected from the OFFICIAL readout.
 *
 * 0.1.7: `.mpd/team/<teamId>/team.json` is gone with the plugin that owned it, so the summary comes
 * from the views the caller resolved through the adapter (`liveTeamViews`). There are no record
 * timestamps to order by, so the team with a BOARD wins (ties keep the readout's own order), and
 * `phase` is DERIVED from the roster: a teammate running/provisioning means `active`.
 *
 * `description` and `planReviewState` have no official source and stay absent — a status row that
 * invented a review state would be claiming a staged plan the plane cannot have.
 */
function readTeam(views: readonly DshTeamView[], problems: string[]): TeamSummary | undefined {
  /** The readout entry with the most tasks; the board shows exactly one team. */
  let best: DshTeamView | undefined
  for (const view of views.slice(0, MAX_TEAMS)) {
    /** Task count of this readout entry, zero when the field is not an array. */
    const tasks = Array.isArray(view.tasks) ? view.tasks.length : 0
    if (best === undefined || tasks > (Array.isArray(best.tasks) ? best.tasks.length : 0)) best = view
  }
  if (best === undefined) return undefined
  /** Roster rows of the winning entry, empty when the field is not an array. */
  const rows = Array.isArray(best.members) ? best.members : []
  if (rows.length === 0 && (Array.isArray(best.tasks) ? best.tasks.length : 0) === 0) return undefined
  /** Task tally being accumulated, one bucket per official status plus `other`. */
  const counts = { total: 0, completed: 0, inProgress: 0, pending: 0, failed: 0, claimed: 0, cancelled: 0, other: 0 }
  for (const task of (Array.isArray(best.tasks) ? best.tasks : []).slice(0, MAX_TASKS)) {
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
  /** Roster rows that are members, i.e. everything but the lead. */
  const teammates = rows.filter((member) => isRecord(member) && member.role !== "lead")
  /** Whether any teammate is running or provisioning, which is what `active` means. */
  const active = teammates.some((member) => member.status === "running" || member.status === "provisioning")
  if (views.length > MAX_TEAMS) problems.push(`team readout truncated to ${MAX_TEAMS} entries`)
  return {
    id: scalarText(best.teamId, 60) ?? "?",
    name: scalarText(best.leadName, 80) ?? "?",
    phase: active ? "active" : "idle",
    members: teammates.length,
    tasks: counts,
  }
}

/** `.mpd/boulder.json` — `works` is keyed by work id (tolerates an array form). */
function readBoulder(root: string, problems: string[]): BoulderSummary | undefined {
  /** Path of the work ledger under this workspace root. */
  const path = join(root, ".mpd", "boulder.json")
  /** The parsed ledger document; stays undefined when the file cannot be read. */
  let document: unknown
  try {
    document = readJson(path)
  } catch (error) {
    /** The filesystem error code, used to tell a missing file from a malformed one. */
    const code = (error as { code?: string } | undefined)?.code
    if (code !== "ENOENT") problems.push(`boulder.json: ${code === undefined ? "unreadable" : "invalid JSON"}`)
    return undefined
  }
  if (!isRecord(document)) return undefined
  /** The work records, from either the keyed or the array form of the ledger. */
  const raw = isRecord(document.works) ? Object.values(document.works) : asArray(document.works)
  /** The tally being accumulated for the board row. */
  const summary: BoulderSummary = { works: 0, active: 0, completed: 0, paused: 0, abandoned: 0 }
  for (const work of raw) {
    if (!isRecord(work)) continue
    summary.works += 1
    /** This work's status; a record without one counts as `active`. */
    const status = String(work.status ?? "active")
    if (status === "active") summary.active += 1
    else if (status === "completed") summary.completed += 1
    else if (status === "paused") summary.paused += 1
    else if (status === "abandoned") summary.abandoned += 1
    /** This work's plan name, under either key the ledger has used. */
    const plan = scalarText(work.plan_name ?? work.active_plan, 120)
    if (plan !== undefined && (summary.newestPlan === undefined || plan > summary.newestPlan)) summary.newestPlan = plan
  }
  return summary
}

/** `.mpd/plans/*.md` — the plan files a boulder work can be bound to. */
function readPlans(root: string): { count: number; newest?: string } {
  /** Path of the plan directory under this workspace root. */
  const dir = join(root, ".mpd", "plans")
  try {
    /** Plan file names, sorted; a directory without any yields a zero count. */
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
  /** Path of the durable workmate library under this home directory. */
  const dir = join(home, ".mpd", "workmate")
  try {
    /** Candidate instance keys: visible directories, capped by `MAX_WORKMATES`. */
    const names = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => entry.name)
      .slice(0, MAX_WORKMATES)
    /** Display names of the instances that proved addressable. */
    const present: string[] = []
    for (const name of names) {
      try {
        /** This instance's metadata file; a missing one marks an orphan directory. */
        const meta = readJson(join(dir, name, "meta.json"))
        /** The instance's display name, falling back to its directory key. */
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
export function readBoardState(workspace: string, home: string = homedir(), views: readonly DshTeamView[] = []): BoardState {
  /** Bounded notes about entries that could not be read, rendered last on the board. */
  const problems: string[] = []
  /** The projection being assembled; the two optional sections land below. */
  const state: BoardState = {
    workspace,
    home,
    plans: readPlans(workspace),
    workmates: readWorkmates(home),
    problems,
  }
  try {
    state.team = readTeam(views, problems)
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

/**
 * Renders the one-line status contribution.
 * @param state - the board projection to summarize.
 * @param notice - the settings-bridge notice to append last, when one applies.
 * @returns the `mpd: …` line, contributions joined by ` · `.
 */
export function statusLine(state: BoardState, notice?: string): string {
  /** The contributions, in the order the host will join them. */
  const parts: string[] = []
  if (state.team !== undefined) {
    /** Completed task count of the team row. */
    const done = state.team.tasks.completed
    /** Total task count of the team row. */
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
  /** The body lines, in board order. */
  const lines: string[] = []
  lines.push(`workspace  ${state.workspace}`)
  if (state.team !== undefined) {
    /** The team's task tally, rendered as the `tasks` row. */
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
