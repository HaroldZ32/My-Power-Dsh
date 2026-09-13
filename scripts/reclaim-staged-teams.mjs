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
//   node scripts/reclaim-staged-teams.mjs [--apply] [--workspace <dir>]
// Default is a DRY RUN: it prints the manifest and changes nothing.
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { archiveTeamDir } from "../packages/mpd-agent-teams-plugin/lib/state.js"

const args = process.argv.slice(2)
const apply = args.includes("--apply")
const wsIndex = args.indexOf("--workspace")
const workspace = resolve(wsIndex >= 0 ? args[wsIndex + 1] : (process.env.DSH_WORKSPACE_ROOT ?? process.cwd()))
const stateDir = process.env.MPD_TEAM_STATE_DIR ?? join(".mpd", "team")
const stateRoot = join(workspace, stateDir)

/** Read one team.json; undefined when unreadable. */
function readTeamFile(path) {
  try { return JSON.parse(readFileSync(path, "utf8")) } catch { return undefined }
}

/** Every live (non-archived) team directory with a team.json. */
function liveTeams() {
  if (!existsSync(stateRoot)) return []
  return readdirSync(stateRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== "archive" && !entry.name.startsWith("."))
    .map((entry) => ({ id: entry.name, path: join(stateRoot, entry.name, "team.json") }))
    .filter((team) => existsSync(team.path))
}

/** Whether one record is reclaimable residue: staged, never approved, zero tasks. */
export function isResidual(team) {
  if (team === undefined) return false
  if (team.phase !== "staged") return false
  if (team.approvedAt !== undefined) return false
  if (!Array.isArray(team.tasks)) return false
  return team.tasks.length === 0
}

const manifest = []
let reclaimed = 0
for (const dir of liveTeams()) {
  const team = readTeamFile(dir.path)
  const residual = isResidual(team)
  const entry = {
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

const result = {
  workspace,
  stateRoot,
  apply,
  scanned: manifest.length,
  reclaimable: manifest.filter((entry) => entry.residual).length,
  reclaimed,
  manifest,
}
console.log(JSON.stringify(result, null, 2))
console.log(`[reclaim-staged-teams] ${apply ? "APPLIED" : "DRY RUN"}: ${result.reclaimable} residual of ${result.scanned} live team(s)` + (apply ? `, ${reclaimed} archived` : " (nothing changed)"))
if (!apply && result.reclaimable > 0) console.log("[reclaim-staged-teams] re-run with --apply to archive them")
