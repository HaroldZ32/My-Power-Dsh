// The watchdog's OWN actions, registered through the adapter's tool seam.
//
// They are the ONLY sanctioned way to hold/resume a team on the watchdog's
// behalf: `agent_teams_halt` is NOT used (it cancels every non-terminal task —
// `tools.js:238-243` — destroying exactly the work a pause must preserve), and
// the hold is deliberately NOT a captain declaration, so no identity gate is
// assumed for it (design §4.2).
//
//   session-watchdog-hold    persist the preserving hold for ONE team
//   session-watchdog-resume  clear it (a no-op for a team that is not held)
//   session-watchdog-status  READ-ONLY diagnostics over the whole watchdog store
//
// w7 drives the first two from the adopted dispatch gates; this package lands
// them and their contract only.
import { randomUUID } from "node:crypto"
import { join } from "node:path"
import type { DshAdapter } from "../../mpd-dsh-adapter-plugin/src/index.js"
import type { HoldRegistry } from "./holds.js"
import { heartbeatDir, holdPath, incidentsPath, watermarkPath } from "./paths.js"
import { appendIncident, clearHold, readHold, readIncidents, readWatermarks, writeHold, type HoldRecord } from "./sidecars.js"
import { listHeartbeatKeys, newestOverall, readHeartbeats } from "./store.js"
import { listTeamIds, readTeam } from "./team.js"

/** The tool names this package registers (also the internal-seam names w7 calls). */
export const HOLD_TOOL = "session-watchdog-hold"
export const RESUME_TOOL = "session-watchdog-resume"
export const STATUS_TOOL = "session-watchdog-status"

/** Arguments accepted by {@link HOLD_TOOL}. */
export interface HoldArgs {
  team_id?: string
  task_id?: string
  attempt_id?: string
  cause?: string
  scene_at?: number
}

/** Arguments accepted by {@link RESUME_TOOL}. */
export interface ResumeArgs {
  team_id?: string
}

/**
 * Persist the hold for one team.
 *
 * @returns `{applied:true, hold}` only after the record is on disk; a persistence
 * failure returns `{applied:false, error}` so no caller can announce a pause that
 * did not happen (design §7).
 */
export function applyHold(
  workspace: string,
  stateDir: string,
  args: HoldArgs,
  registry?: HoldRegistry,
): { applied: boolean; hold?: HoldRecord; error?: string; path: string; changed?: boolean } {
  const teamId = String(args.team_id ?? "").trim()
  if (teamId === "") return { applied: false, error: "team_id is required", path: holdPath(workspace, stateDir, "") }
  const existing = readHold(workspace, stateDir, teamId)
  const hold: HoldRecord = {
    id: existing?.id ?? randomUUID(),
    teamId,
    since: existing?.since ?? Date.now(),
    cause: args.cause ?? existing?.cause ?? "silence",
    taskId: args.task_id ?? existing?.taskId ?? null,
    attemptId: args.attempt_id ?? existing?.attemptId ?? null,
    sceneAt: args.scene_at ?? existing?.sceneAt ?? 0,
  }
  const written = writeHold(workspace, stateDir, hold)
  if (!written.ok) return { applied: false, error: written.error, path: written.path }
  // The durable record landed: publish it to the synchronous reader the gates use.
  registry?.record(workspace, hold)
  return { applied: true, hold, path: written.path, changed: written.changed }
}

/**
 * Clear the hold for one team.
 *
 * A team that is not held is a NO-OP, not an error (AC-8): the action is safe to
 * call twice and safe to call on a team the watchdog never touched.
 */
export function applyResume(
  workspace: string,
  stateDir: string,
  args: ResumeArgs,
  registry?: HoldRegistry,
): { resumed: boolean; reason?: string; hold?: HoldRecord; path: string } {
  const teamId = String(args.team_id ?? "").trim()
  if (teamId === "") return { resumed: false, reason: "team_id is required", path: holdPath(workspace, stateDir, "") }
  const hold = readHold(workspace, stateDir, teamId)
  if (hold === undefined) return { resumed: false, reason: "not-held", path: holdPath(workspace, stateDir, teamId) }
  const cleared = clearHold(workspace, stateDir, teamId)
  const stillHeld = readHold(workspace, stateDir, teamId)
  if (stillHeld !== undefined) {
    return { resumed: false, reason: "hold could not be cleared", hold, path: cleared.path }
  }
  // The clear is verified on disk BEFORE the reader is told the team is free: a gate
  // must never resume dispatch against a hold that is still persisted.
  registry?.forget(workspace, teamId)
  return { resumed: true, hold, path: cleared.path }
}

/** Register the three actions on the adapter. */
export function registerWatchdogActions(dsh: DshAdapter, stateDir: string, registry?: HoldRegistry): void {
  dsh.registerTool({
    name: HOLD_TOOL,
    description:
      "Persist the team watchdog's PRESERVING hold for one team. It stops NEW dispatch into that team without cancelling anything: every non-terminal task keeps its status, assignee and attemptId. Returns applied:false (never a throw) when the hold could not be written, so a caller must not report a pause that did not land. This is the watchdog's own hold, NOT agent_teams_halt.",
    parameters: {
      type: "object",
      properties: {
        team_id: { type: "string", description: "The team to hold." },
        task_id: { type: "string", description: "The task whose silence caused the hold." },
        attempt_id: { type: "string", description: "That task's attempt id at escalation time." },
        cause: { type: "string", description: "Why the hold was raised (default: silence)." },
        scene_at: { type: "number", description: "Epoch ms of the scene written for this escalation." },
      },
      required: ["team_id"],
      additionalProperties: false,
    },
    output: {
      schema: { type: "object", properties: { applied: { type: "boolean" }, hold: { type: "object" }, error: { type: "string" } } },
      render: (_args: unknown, raw: unknown) => {
        const value = (raw ?? {}) as { applied: boolean; hold?: HoldRecord; error?: string }
        return value.applied
          ? [{ type: "text", text: "watchdog hold applied for " + String(value.hold?.teamId) + " (since " + String(value.hold?.since) + ")" }]
          : [{ type: "text", text: "watchdog hold NOT applied: " + String(value.error ?? "unknown error") }]
      },
    },
    execute: (args: HoldArgs, exec: unknown) => {
      const workspace = dsh.workspaceRoot(exec as never)
      return applyHold(workspace, stateDir, args ?? {}, registry)
    },
  })

  dsh.registerTool({
    name: RESUME_TOOL,
    description:
      "Clear the team watchdog's hold for one team. A team that is not held is a no-op (resumed:false, reason:'not-held'), never an error; a second resume is likewise a no-op. Clearing the hold is the watchdog-side release only — the adopted dispatch gates that honour it are wired by w7.",
    parameters: {
      type: "object",
      properties: { team_id: { type: "string", description: "The team to release." } },
      required: ["team_id"],
      additionalProperties: false,
    },
    output: {
      schema: { type: "object", properties: { resumed: { type: "boolean" }, reason: { type: "string" }, hold: { type: "object" } } },
      render: (_args: unknown, raw: unknown) => {
        const value = (raw ?? {}) as { resumed: boolean; reason?: string }
        return value.resumed
          ? [{ type: "text", text: "watchdog hold cleared" }]
          : [{ type: "text", text: "watchdog hold not cleared: " + String(value.reason ?? "unknown") }]
      },
    },
    execute: (args: ResumeArgs, exec: unknown) => {
      const workspace = dsh.workspaceRoot(exec as never)
      return applyResume(workspace, stateDir, args ?? {}, registry)
    },
  })

  dsh.registerTool({
    name: STATUS_TOOL,
    description:
      "READ-ONLY: show the team watchdog's durable store for this workspace — the hold per team, the heartbeat tails, the incident log and the per-reader watermark. Use it to inspect what a lane or a restarting process would read from disk.",
    parameters: {
      type: "object",
      properties: { team_id: { type: "string", description: "Limit to one team." } },
      additionalProperties: false,
    },
    output: {
      schema: { type: "object", properties: { workspace: { type: "string" }, paths: { type: "object" }, teams: { type: "array", items: { type: "object" } } } },
      render: (_args: unknown, raw: unknown) => {
        const value = (raw ?? {}) as { teams: Array<{ teamId: string; held: boolean }> }
        const lines = value.teams.map((team) => team.teamId + ": " + (team.held ? "HELD" : "not held"))
        return [{ type: "text", text: lines.join("\n") || "no teams" }]
      },
    },
    execute: (args: { team_id?: string }, exec: unknown) => {
      const workspace = dsh.workspaceRoot(exec as never)
      const ids = args?.team_id === undefined || args.team_id === "" ? listTeamIds(workspace, stateDir) : [args.team_id]
      return {
        workspace,
        paths: {
          heartbeat: heartbeatDir(workspace, stateDir),
          hold: join(workspace, stateDir, "watchdog", "hold"),
          incidents: incidentsPath(workspace, stateDir),
          watermark: watermarkPath(workspace, stateDir),
        },
        teams: ids.map((teamId) => {
          const hold = readHold(workspace, stateDir, teamId)
          const team = readTeam(workspace, stateDir, teamId)
          return {
            teamId,
            held: hold !== undefined,
            hold: hold ?? null,
            phase: team?.phase ?? null,
            halted: team?.halted ?? null,
            heartbeatKeys: listHeartbeatKeys(workspace, stateDir),
            heartbeatTails: Object.fromEntries(
              listHeartbeatKeys(workspace, stateDir).map((key) => {
                const stamps = readHeartbeats(workspace, stateDir, key)
                return [key, { count: stamps.length, newest: newestOverall(stamps) ?? null }]
              }),
            ),
            incidents: readIncidents(workspace, stateDir).filter((record) => record.teamId === teamId),
            watermarks: readWatermarks(workspace, stateDir),
            // What the w7 gates would answer for THIS team right now.
            isHeld: registry?.isHeld(teamId, workspace) ?? null,
          }
        }),
      }
    },
  })
}

/** Record one incident durably (used by the tick; exported for the lanes). */
export function recordIncident(
  workspace: string,
  stateDir: string,
  incident: Parameters<typeof appendIncident>[2],
): { ok: boolean; path: string; error?: string } {
  return appendIncident(workspace, stateDir, incident)
}
