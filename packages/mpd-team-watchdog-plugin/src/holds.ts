// The hold registry — the STABLE SYNCHRONOUS READER the w7 dispatch gates consult.
//
// WHY THIS EXISTS (plan AMENDMENT 2, A2-1; adopted into the frozen contract):
// a bare sidecar beside `team.json` CANNOT enforce the pause, because `state.js`
// owns `team.json` and every reader path goes through `readTeam`, so a sidecar is
// invisible to the three scheduler decline gates. w7 therefore needs one of:
//   (a) the hold as a field on the team record written through the adopted LOCKED
//       path, or
//   (b) the sidecar stays the durable, authoritative record AND w3 exposes a stable
//       synchronous reader the gates consult.
//
// THIS PACKAGE IMPLEMENTS OPTION (b) and exposes it as the `mpdWatchdog` service:
//
//     const watchdog = ctx.get("mpdWatchdog", false)
//     const hold = watchdog?.isHeld(teamId, workspace)
//     if (hold?.held) return noteDispatchDecline(..., "held by the team watchdog")
//
// The answer is synchronous (a gate runs inside the scheduler's hot path), the map
// is HYDRATED AT APPLY from every hold file under the roots this process knows, and
// it is updated on every hold/resume this process performs. A team the map does not
// know is answered by ONE cheap file read (`hold/<teamId>.json`), which is also how
// a second process learns of a hold another process wrote.
//
// FAIL-OPEN RULE (stated, load-bearing): when the watchdog row is absent,
// `ctx.get("mpdWatchdog", false)` is undefined, `isHeld` is never called, and
// dispatch behaves EXACTLY as it does today. The watchdog can therefore only ever
// ADD a decline; it can never keep a team stopped because its own row failed to
// load. Every method here is non-throwing for the same reason.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { join, resolve } from "node:path"
import { holdDir, holdPath } from "./paths.js"
import type { HoldRecord, IncidentRecord } from "./sidecars.js"
import { ackIncidents, readIncidents, readWatermarks } from "./sidecars.js"

/** The service id the gates resolve: `ctx.get("mpdWatchdog", false)`. */
export const HOLD_SERVICE = "mpdWatchdog"

/** What a gate asks and gets back. */
export interface HoldView {
  /** The only field a gate must branch on. */
  held: boolean
  /** The durable hold's id, or null when not held. */
  holdId: string | null
  /** Epoch ms the hold was raised (`since`), or null when not held. */
  at: number | null
  /** The free-form reason (`cause`), or null when not held. */
  reason: string | null
  /** The task whose silence raised the hold, when known. */
  taskId: string | null
  /** That task's attempt id at escalation time, when known. */
  attemptId: string | null
  /** The workspace the answer came from, or null when the team is not held anywhere. */
  workspace: string | null
  /** `memory` (hydrated/recorded), `file` (read on demand) or `none`. */
  source: "memory" | "file" | "none"
}

/** A read-only listing entry. */
export interface HoldSummary {
  workspace: string
  teamId: string
  holdId: string
  since: number
  cause: string
  taskId: string | null
  attemptId: string | null
}

/** Parse one hold file; undefined when absent or unreadable. */
function readHoldFile(workspace: string, stateDir: string, teamId: string): HoldRecord | undefined {
  let text: string
  try {
    text = readFileSync(holdPath(workspace, stateDir, teamId), "utf8")
  } catch {
    return undefined
  }
  try {
    const parsed = JSON.parse(text) as HoldRecord
    if (parsed === null || typeof parsed !== "object" || typeof parsed.id !== "string") return undefined
    return parsed
  } catch {
    return undefined
  }
}

/**
 * The in-memory hold registry behind the `mpdWatchdog` service.
 *
 * One instance per applied row. Keyed `<resolved workspace>\0<teamId>`, because a
 * hold belongs to ONE team in ONE workspace and one host serves many sessions.
 */
export class HoldRegistry {
  private readonly stateDir: string
  private readonly entries = new Map<string, HoldRecord>()
  private readonly hydrated = new Set<string>()
  private fallbackWorkspace: string | null = null

  /**
   * @param stateDir - the team state directory (default `.mpd/team`).
   * @param fallbackWorkspace - the workspace used when a caller omits one.
   */
  constructor(stateDir: string, fallbackWorkspace: string | null = null) {
    this.stateDir = stateDir
    this.fallbackWorkspace = fallbackWorkspace === null ? null : resolve(fallbackWorkspace)
  }

  private key(workspace: string, teamId: string): string {
    return resolve(workspace) + "\u0000" + teamId
  }

  /**
   * Load every hold file under the given roots (idempotent per root).
   *
   * @param roots - workspace roots this process knows about.
   * @returns how many hold files were loaded.
   */
  hydrate(roots: readonly string[]): number {
    let loaded = 0
    for (const root of roots) {
      if (typeof root !== "string" || root === "") continue
      const workspace = resolve(root)
      if (this.fallbackWorkspace === null) this.fallbackWorkspace = workspace
      if (this.hydrated.has(workspace)) continue
      this.hydrated.add(workspace)
      let files: string[]
      try {
        files = readdirSync(holdDir(workspace, this.stateDir))
      } catch {
        continue
      }
      for (const file of files) {
        if (!file.endsWith(".json")) continue
        const teamId = file.slice(0, -".json".length)
        const hold = readHoldFile(workspace, this.stateDir, teamId)
        if (hold === undefined) continue
        this.entries.set(this.key(workspace, teamId), hold)
        loaded += 1
      }
    }
    return loaded
  }

  /** Record a hold this process just persisted (the write path calls this). */
  record(workspace: string, hold: HoldRecord): void {
    this.entries.set(this.key(workspace, hold.teamId), hold)
    this.hydrated.add(resolve(workspace))
  }

  /** Forget a hold this process just cleared (the resume path calls this). */
  forget(workspace: string, teamId: string): void {
    this.entries.delete(this.key(workspace, teamId))
  }

  /**
   * Is this team held? Synchronous, non-throwing, and safe to call on every
   * dispatch: an unknown team costs at most ONE small file read.
   *
   * @param teamId - the team id.
   * @param workspace - the team's workspace. Pass it whenever you have it: one host
   * serves many sessions, and a team id is only unique inside its workspace.
   * @returns the view; `held: false` with `source: 'none'` when nothing holds it.
   */
  isHeld(teamId: string, workspace?: string): HoldView {
    const id = String(teamId ?? "")
    const notHeld = (from: HoldView["source"], where: string | null = null): HoldView => ({
      held: false,
      holdId: null,
      at: null,
      reason: null,
      taskId: null,
      attemptId: null,
      workspace: where,
      source: from,
    })
    if (id === "") return notHeld("none")
    const where = workspace !== undefined && workspace !== "" ? workspace : this.fallbackWorkspace
    if (where !== null) {
      const known = this.entries.get(this.key(where, id))
      if (known !== undefined) return this.holdView(known, where, "memory")
      // The cheap file fallback: another process may have written this hold, and a
      // gate must not need a restart to learn about it.
      try {
        const hold = readHoldFile(where, this.stateDir, id)
        if (hold !== undefined) {
          this.entries.set(this.key(where, id), hold)
          return this.holdView(hold, where, "file")
        }
      } catch {
        return notHeld("none")
      }
      return notHeld("none", resolve(where))
    }
    // No workspace at all: answer from memory only (a single-workspace host).
    for (const [key, hold] of this.entries) {
      const [root, team] = key.split("\u0000")
      if (team === id) return this.holdView(hold, root, "memory")
    }
    return notHeld("none")
  }

  /** Whether a team is held, as a boolean (the terse form for a hot path). */
  holds(teamId: string, workspace?: string): boolean {
    return this.isHeld(teamId, workspace).held
  }

  /** Every hold this registry knows about (read-only, for diagnostics). */
  list(): HoldSummary[] {
    const out: HoldSummary[] = []
    for (const [key, hold] of this.entries) {
      const [workspace, teamId] = key.split("\u0000")
      out.push({ workspace, teamId, holdId: hold.id, since: hold.since, cause: hold.cause, taskId: hold.taskId, attemptId: hold.attemptId })
    }
    return out.sort((a, b) => (a.workspace + a.teamId).localeCompare(b.workspace + b.teamId))
  }

  /** How many workspaces have been hydrated (diagnostics). */
  hydratedRoots(): string[] {
    return [...this.hydrated].sort()
  }

  /**
   * The teams HELD right now in one workspace, read from the durable hold index.
   *
   * Synchronous and non-throwing: the TUI renders this on a status-line publish, so a broken or
   * absent store answers `[]` rather than throwing into a render path.
   *
   * @param workspace - the workspace whose holds to list.
   * @returns the held team ids, sorted.
   */
  heldTeams(workspace?: string): string[] {
    const where = this.workspaceOf(workspace)
    if (where === null) return []
    let files: string[]
    try {
      files = readdirSync(holdDir(where, this.stateDir))
    } catch {
      return []
    }
    const held: string[] = []
    for (const file of files) {
      if (!file.endsWith(".json")) continue
      try {
        if (readHoldFile(where, this.stateDir, file.slice(0, -".json".length)) !== undefined) held.push(file.slice(0, -".json".length))
      } catch {
        // an unreadable hold file is skipped; the rest of the index still answers
      }
    }
    return held.sort()
  }

  /**
   * The incidents one reader has not acknowledged yet (the unread replay).
   *
   * @param reader - the reader key (e.g. the TUI's `mpd-tui`).
   * @param workspace - the workspace whose incident log to read.
   * @returns the unacknowledged incidents in append order; `[]` on any failure.
   */
  unread(reader: string, workspace?: string): IncidentRecord[] {
    const where = this.workspaceOf(workspace)
    if (where === null) return []
    try {
      const watermark = readWatermarks(where, this.stateDir)[String(reader)] ?? 0
      return readIncidents(where, this.stateDir).filter((record) => record.at > watermark)
    } catch {
      return []
    }
  }

  /**
   * Advance one reader's watermark (the acknowledge action).
   *
   * The write happens HERE, inside the package that owns the file: a caller (the TUI) can therefore
   * honour an acknowledge without carrying any filesystem writer into its own build.
   *
   * @param reader - the reader key.
   * @param upTo - the incident timestamp to acknowledge up to.
   * @param workspace - the workspace whose watermark to advance.
   * @returns the outcome; `ok: false` with a reason on any failure (never throws).
   */
  acknowledge(reader: string, upTo: number, workspace?: string): { ok: boolean; watermark: number; error?: string } {
    const where = this.workspaceOf(workspace)
    if (where === null) return { ok: false, watermark: 0, error: "no workspace resolved" }
    try {
      const result = ackIncidents(where, this.stateDir, String(reader), Number(upTo))
      return result.error === undefined ? { ok: result.ok, watermark: result.watermark } : { ok: result.ok, watermark: result.watermark, error: result.error }
    } catch (error) {
      return { ok: false, watermark: 0, error: String((error as Error)?.message ?? error) }
    }
  }

  /**
   * The complete view one front door renders: the held teams plus one reader's unread incidents.
   *
   * @param reader - the reader key.
   * @param workspace - the workspace to read.
   * @returns the view; all-empty when nothing is held and nothing is unread.
   */
  view(reader: string, workspace?: string): { workspace: string | null; holds: string[]; unread: IncidentRecord[] } {
    const where = this.workspaceOf(workspace)
    if (where === null) return { workspace: null, holds: [], unread: [] }
    return { workspace: where, holds: this.heldTeams(where), unread: this.unread(reader, where) }
  }

  /** The workspace a call should read: the argument, else the fallback, else none. */
  private workspaceOf(workspace?: string): string | null {
    if (typeof workspace === "string" && workspace !== "") return resolve(workspace)
    return this.fallbackWorkspace
  }

  private holdView(hold: HoldRecord, workspace: string, source: HoldView["source"]): HoldView {
    return {
      held: true,
      holdId: hold.id,
      at: typeof hold.since === "number" ? hold.since : null,
      reason: typeof hold.cause === "string" ? hold.cause : null,
      taskId: hold.taskId ?? null,
      attemptId: hold.attemptId ?? null,
      workspace,
      source,
    }
  }
}

/**
 * The exact gate call shape w7 must use, kept here so the contract travels with the
 * implementation instead of living in a task description.
 *
 * ```js
 * const watchdog = ctx.get("mpdWatchdog", false)          // undefined when the row is absent
 * const hold = watchdog?.isHeld(teamId, workspace)        // synchronous, non-throwing
 * if (hold?.held) return noteDispatchDecline(scheduler, member, task, "held by the team watchdog")
 * ```
 */
export const HOLD_GATE_CALL = 'ctx.get("mpdWatchdog", false)?.isHeld(teamId, workspace)?.held === true'

/** The one-file probe a gate can use when it has a state root but no service. */
export function holdFileExists(workspace: string, stateDir: string, teamId: string): boolean {
  try {
    return statSync(holdPath(workspace, stateDir, teamId)).isFile()
  } catch {
    return existsSync(join(holdDir(workspace, stateDir), teamId + ".json"))
  }
}
