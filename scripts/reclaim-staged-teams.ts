#!/usr/bin/env node
// OPT-2 residual reclamation (user decision 2026-09-13, binding): empty STAGED teams
// are pure residue from the old unconditional auto-provisioning. They must never be
// deleted raw — they are ARCHIVED with the same semantics `agent_teams_delete` uses
// (`<stateRoot>/archive/<teamId>/`, reviewable later), and the run prints the
// reclamation manifest (teamId / phase / task count / archived?).
//
// SAFETY:
//   - a team that is APPROVED (approvedAt set) or currently RUNNING is NEVER touched,
//     whatever its task count;
//   - a staged team that already carries tasks is NOT residue and is left alone
//     (its plan may still be under review);
//   - only `staged && !approvedAt && tasks.length === 0` is reclaimed;
//   - nothing is removed with rm(): archival is a directory RENAME.
//
// Usage:
//   node scripts/reclaim-staged-teams.ts [--apply] [--workspace <dir>]
// Default is a DRY RUN: it prints the manifest and changes nothing.
import { existsSync, readdirSync, type Dirent } from "node:fs"
import { join, resolve } from "node:path"
import { readJson } from "./lib/repo.ts"
import { archiveTeamDir } from "../packages/mpd-agent-teams-plugin/lib/state.ts"

/**
 * The `team.json` fields this reclamation classifies. Every field is optional because the
 * document is read from disk and any of them may be missing in an older or partial record.
 */
interface TeamRecord {
  /** Lifecycle phase of the team; only the literal `staged` can ever be residue. */
  readonly phase?: string
  /** Approval timestamp; present (even as `null`) once a human approved the staged plan. */
  readonly approvedAt?: unknown
  /** The team's task list; a record without one makes residue undecidable. */
  readonly tasks?: readonly unknown[]
}

/** One live team directory under the state root, keyed by its directory name. */
interface LiveTeam {
  /** Team id: the directory name, and the key `archiveTeamDir` archives by. */
  readonly id: string
  /** Absolute path of that team's `team.json`, already known to exist. */
  readonly path: string
}

/** One row of the reclamation manifest, exactly as the run prints it. */
interface ManifestEntry {
  /** Team id (the directory name). */
  readonly teamId: string
  /** Declared phase, or `(unreadable)` when no readable record carried one. */
  readonly phase: string
  /** Number of tasks, or `null` when the record carries no task array. */
  readonly tasks: number | null
  /** Whether an approval timestamp was present on the record. */
  readonly approved: boolean
  /** Whether the record is reclaimable residue under the rule stated in the header. */
  readonly residual: boolean
  /** Whether this run archived it; only ever `true` under `--apply`. */
  archived: boolean
}

/** Raw command-line arguments after the node executable and this script's own path. */
const args: string[] = process.argv.slice(2)
/** Whether the run archives residue instead of only reporting it. */
const apply: boolean = args.includes("--apply")
/** Position of `--workspace` in the argv, or -1 when the flag was not given. */
const wsIndex: number = args.indexOf("--workspace")
/** Workspace whose state root is scanned: the flag value, else `DSH_WORKSPACE_ROOT`, else cwd. */
const workspace: string = resolve(wsIndex >= 0 ? args[wsIndex + 1] : (process.env.DSH_WORKSPACE_ROOT ?? process.cwd()))
/** State directory relative to the workspace; `MPD_TEAM_STATE_DIR` overrides the `.mpd/team` default. */
const stateDir: string = process.env.MPD_TEAM_STATE_DIR ?? join(".mpd", "team")
/** Absolute state root: the directory whose live team subdirectories are scanned. */
const stateRoot: string = join(workspace, stateDir)

/**
 * Read one team record from disk.
 * @param path - absolute path of the team's `team.json`.
 * @returns the parsed record, or `undefined` when the file cannot be read or parsed.
 */
function readTeamFile(path: string): TeamRecord | undefined {
  try { return readJson<TeamRecord>(path) } catch { return undefined }
}

/**
 * Every live (non-archived) team directory with a team.json.
 * @returns one entry per visible directory directly under the state root that carries a
 *          `team.json`; `[]` when the state root itself does not exist yet.
 */
function liveTeams(): LiveTeam[] {
  if (!existsSync(stateRoot)) return []
  return readdirSync(stateRoot, { withFileTypes: true })
    .filter((entry: Dirent): boolean => entry.isDirectory() && entry.name !== "archive" && !entry.name.startsWith("."))
    .map((entry: Dirent): LiveTeam => ({ id: entry.name, path: join(stateRoot, entry.name, "team.json") }))
    .filter((team: LiveTeam): boolean => existsSync(team.path))
}

/**
 * Whether one record is reclaimable residue: staged, never approved, zero tasks.
 * @param team - the parsed record, or `undefined` when it could not be read.
 * @returns `true` only for a staged record with no approval timestamp and an empty task array.
 */
export function isResidual(team: TeamRecord | undefined): boolean {
  if (team === undefined) return false
  if (team.phase !== "staged") return false
  if (team.approvedAt !== undefined) return false
  if (!Array.isArray(team.tasks)) return false
  return team.tasks.length === 0
}

/** Manifest rows, one per live team, in the state root's own directory order. */
const manifest: ManifestEntry[] = []
/** Number of teams this run actually archived; always 0 in a dry run. */
let reclaimed = 0
for (const dir of liveTeams()) {
  /** The record for this team, or `undefined` when its `team.json` is unreadable. */
  const team: TeamRecord | undefined = readTeamFile(dir.path)
  /** Whether that record matches the residue rule. */
  const residual: boolean = isResidual(team)
  /** This team's manifest row, printed whether or not it is residue. */
  const entry: ManifestEntry = {
    teamId: dir.id,
    phase: team?.phase ?? "(unreadable)",
    tasks: Array.isArray(team?.tasks) ? team.tasks.length : null,
    approved: team?.approvedAt !== undefined,
    residual,
    archived: false,
  }
  if (residual && apply) {
    await archiveTeamDir(stateRoot, dir.id)
    entry.archived = true
    reclaimed += 1
  }
  manifest.push(entry)
}

/** The printed result: the resolved roots, the run mode, the counts and the full manifest. */
const result = {
  workspace,
  stateRoot,
  apply,
  scanned: manifest.length,
  reclaimable: manifest.filter((entry: ManifestEntry): boolean => entry.residual).length,
  reclaimed,
  manifest,
}
console.log(JSON.stringify(result, null, 2))
console.log(`[reclaim-staged-teams] ${apply ? "APPLIED" : "DRY RUN"}: ${result.reclaimable} residual of ${result.scanned} live team(s)` + (apply ? `, ${reclaimed} archived` : " (nothing changed)"))
if (!apply && result.reclaimable > 0) console.log("[reclaim-staged-teams] re-run with --apply to archive them")
