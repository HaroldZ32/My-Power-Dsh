// WHICH PLAN FILE THE GRAPH FOLLOWS, and the tolerant read of it.
//
// ONE RESOLUTION, IN ONE PLACE: the host plugin and every future consumer must watch and parse the
// SAME file, or two planes draw two plans. The order is documented in the package README and pinned
// by tests:
//
//   1. BEACON — the ledger's ACTIVE boulder work's `active_plan` (`.mpd/boulder.json`), and only
//      while that work's status is `active`. A terminal work is deliberately NOT a beacon: its plan
//      is history, and pinning the live picture to history is the staleness the frozen contract
//      forbids. A beacon whose file no longer exists also falls through.
//   2. NEWEST — the newest `*.md` under `.mpd/plans/` by modification time, then by name for a tie,
//      so two files written in the same millisecond still resolve the same way on every run.
//   3. NONE — `undefined`, which every caller must treat as "no plan", never as an error.
//
// The read is tolerant for the same reason the parser is: a file mid-write is the normal state under
// a watcher, so an unreadable file becomes ONE reported problem, and a missing file passed as
// `undefined` becomes an empty plan with nothing to report.
import { readFileSync, readdirSync, statSync } from "node:fs"
import { isAbsolute, join, resolve } from "node:path"
import { parsePlanMarkdown } from "./plan.ts"
import type { PlanDocument } from "./types.ts"

/** Where a boulder ledger keeps its own state, relative to the session workspace. */
const LEDGER_PATH = join(".mpd", "boulder.json")

/** Where plan files live, relative to the session workspace. */
const PLANS_DIR = join(".mpd", "plans")

/** The slice of one recorded boulder work this resolver reads. */
interface BoulderWork {
  /** The work's own plan path, spelled relative to the workspace root or absolutely. */
  active_plan?: unknown
  /** The work's lifecycle status; only `active` may be a beacon. */
  status?: unknown
}

/** The slice of `.mpd/boulder.json` this resolver reads. */
interface BoulderState {
  /** The work the ledger marks current. */
  active_work_id?: unknown
  /** The ledger's own copy of the current plan path, used when the work entry carries none. */
  active_plan?: unknown
  /** Every recorded work, keyed by work id. */
  works?: unknown
}

/** An empty plan: what a caller gets when no plan file resolves. */
const EMPTY_PLAN: PlanDocument = { tasks: [], lanes: [], problems: [] }

/**
 * Whether a value is a plain object, so a JSON read can be narrowed without casting.
 * @param value - the value to test.
 * @returns true for a non-null, non-array object.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * A plan path exactly as a ledger spelled it, resolved against the workspace root.
 * @param root - the session workspace root.
 * @param value - the ledger's raw value.
 * @returns the absolute path, or undefined when the value is not a non-empty string.
 */
function planPathFrom(root: string, value: unknown): string | undefined {
  if (typeof value !== "string" || value.trim() === "") return undefined
  return isAbsolute(value) ? resolve(value) : resolve(root, value)
}

/**
 * Read and parse the boulder ledger, when it exists and parses.
 * @param root - the session workspace root.
 * @returns the ledger's slice, or undefined when it is absent or unreadable.
 */
function readBoulderState(root: string): BoulderState | undefined {
  try {
    /** The ledger's parsed JSON. */
    const parsed: unknown = JSON.parse(readFileSync(join(root, LEDGER_PATH), "utf8"))
    return isRecord(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

/**
 * The plan an ACTIVE boulder work is bound to, when the ledger names one whose file exists.
 * @param root - the session workspace root.
 * @returns the beacon's absolute path, or undefined when there is no active work or no readable file.
 */
function beaconPlan(root: string): string | undefined {
  /** The ledger's slice, when one exists. */
  const state = readBoulderState(root)
  if (state === undefined) return undefined
  /** The recorded works, when the ledger carries them. */
  const works = isRecord(state.works) ? state.works : undefined
  /** The id the ledger marks current. */
  const activeId = typeof state.active_work_id === "string" ? state.active_work_id : undefined
  /** The work record that id names, when it names one. */
  const record = works !== undefined && activeId !== undefined && isRecord(works[activeId]) ? (works[activeId] as BoulderWork) : undefined
  if (record === undefined || record.status !== "active") return undefined
  /** The work's plan path, falling back to the ledger's own copy. */
  const path = planPathFrom(root, record.active_plan) ?? planPathFrom(root, state.active_plan)
  if (path === undefined) return undefined
  try {
    return statSync(path).isFile() ? path : undefined
  } catch {
    return undefined
  }
}

/**
 * The newest plan file under `.mpd/plans/`, by modification time and then by name.
 * @param root - the session workspace root.
 * @returns the absolute path, or undefined when the directory holds no plan file.
 */
function newestPlan(root: string): string | undefined {
  /** One candidate plan file: its absolute path, modification time and name. */
  const candidates: Array<{ path: string; mtimeMs: number; name: string }> = []
  try {
    /** The plans directory for this workspace, named once so the watcher can be told the same path. */
    const directory = plansDirectory(root)
    /** The plans directory's entries. */
    const entries = readdirSync(directory, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".md") || entry.name.endsWith(".zh-CN.md")) continue
      /** The entry's absolute path. */
      const path = join(directory, entry.name)
      /** The entry's stats, absent when it vanished between listing and stat. */
      const stats = statSync(path, { throwIfNoEntry: false })
      if (stats === undefined) continue
      candidates.push({ path, mtimeMs: stats.mtimeMs, name: entry.name })
    }
  } catch {
    return undefined
  }
  candidates.sort((left, right) => right.mtimeMs - left.mtimeMs || left.name.localeCompare(right.name))
  return candidates[0]?.path
}

/**
 * The directory plan files live in for a workspace.
 *
 * EXPORTED so the resolver, the watcher and any host cache cannot disagree about it: a host that
 * resolves a plan path and then arms a watch must name the SAME directory, or the cache and the
 * watcher follow two different trees and "a new plan appears" never reaches the cache.
 * @param workspaceRoot - the CALLING SESSION's workspace root, expected absolute (the adapter's value).
 * @returns the absolute `.mpd/plans` directory under it.
 */
export function plansDirectory(workspaceRoot: string): string {
  return join(workspaceRoot, PLANS_DIR)
}

/**
 * The plan file the graph must follow: the active beacon, else the newest plan, else none.
 * @param workspaceRoot - the CALLING SESSION's workspace root, expected absolute (the adapter's value).
 * @returns the absolute plan path, or undefined when this workspace has no plan file.
 */
export function resolvePlanFile(workspaceRoot: string): string | undefined {
  /** The active boulder work's plan, when the ledger names one that still exists. */
  const beacon = beaconPlan(workspaceRoot)
  if (beacon !== undefined) return beacon
  return newestPlan(workspaceRoot)
}

/**
 * Read a plan file tolerantly: never throws, and reports what it could not read.
 *
 * `undefined` is a legitimate input — the caller resolved "no plan" — and yields an empty document
 * with NO problem, because a workspace without a plan is a normal state rather than a defect.
 * @param path - the absolute plan path, or undefined for "there is none".
 * @returns the parsed document, or an empty one plus one problem when the named file could not be read.
 */
export function readPlanFile(path: string | undefined): PlanDocument {
  if (path === undefined) return { tasks: [...EMPTY_PLAN.tasks], lanes: [...EMPTY_PLAN.lanes], problems: [...EMPTY_PLAN.problems] }
  try {
    return parsePlanMarkdown(readFileSync(path, "utf8"))
  } catch {
    return { tasks: [], lanes: [], problems: [{ line: 0, text: path, reason: "plan file could not be read" }] }
  }
}
