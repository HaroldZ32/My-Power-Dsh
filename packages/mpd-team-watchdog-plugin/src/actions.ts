// The watchdog's OWN actions, registered through the adapter's tool seam.
//
// T-19 (wave 2, user ruling): `agent_teams_halt` is the SOLE EXTERNAL pause mechanism; the
// watchdog's PRESERVING hold is DEMOTED to its INTERNAL implementation — the durable record of
// the dispatch-side stop the watchdog raises for itself. The hold is not a second pause a caller
// chooses between: `session-watchdog-hold` / `-resume` stay REGISTERED as the implementation's
// own bookkeeping surface (removing a registered tool would be a tool-schema change), and every
// public surface names ONE mechanism and the hold only as its implementation.
//
//   session-watchdog-hold    persist the internal preserving hold for ONE team (implementation)
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
  /**
   * T-17: the bound after which this hold releases itself (`hold-auto-released`, cause `ttl`).
   * Omitted, the caller's default applies (the engine passes the resolved `holdTtlMs`); `0`
   * means "no TTL" and leaves only the activity path.
   */
  ttl_ms?: number
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
  defaultTtlMs = 0,
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
    // T-17: an explicit `ttl_ms` wins, an existing hold keeps ITS bound (a re-persist must not
    // silently extend a pause), and otherwise the caller's default (the resolved knob) applies.
    ttlMs:
      typeof args.ttl_ms === "number" && Number.isFinite(args.ttl_ms) && args.ttl_ms >= 0
        ? args.ttl_ms
        : existing?.ttlMs ?? defaultTtlMs,
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

/**
 * Read the ACTIVE PREDICATE SOURCE (contract §4): `channel` when the §1 fold is the
 * authority, `heartbeat` when the engine is running the report-only fallback. Supplied by
 * `apply` as a live provider so the status view can never print a stale copy of it.
 */
export type PredicateSourceProvider = () => { source: "channel" | "heartbeat"; reason: string; enrichment: boolean; events: number; sessions: number; states: Record<string, string>; announced: boolean }

/**
 * §7.2: the per-knob live-vs-file reading the status view prints, plus where it came from.
 * `file` is the `.mpd/mpd.jsonc` the reading was taken from and `fileFound` whether it existed.
 * T-18 (wave 2): `fileApplied`/`liveLayer` say which layer supplied the running values, so the
 * status view can show a file edit that took effect LIVE instead of implying a restart.
 */
export interface KnobDivergenceView {
  readings: Array<{ knob: string; live: number | boolean | string; file?: number | boolean | string; differs: boolean; restartRequired: boolean }>
  divergent: string[]
  restartRequired: boolean
  file: string | null
  fileFound: boolean
  /** T-18: whether the running values came from the workspace file layer (live, no restart). */
  fileApplied: boolean
  /** T-18: the layer that last moved and supplied the running values. */
  liveLayer: "namespace" | "file"
}

/** The live providers `apply` hands the status surface. Each is read at CALL time. */
export interface WatchdogSurfaces {
  predicate?: PredicateSourceProvider
  knobs?: () => KnobDivergenceView
  /** T-17: the resolved `holdTtlMs` a hold created without an explicit `ttl_ms` inherits. */
  holdTtlMs?: () => number
}

/** Register the three actions on the adapter. */
export function registerWatchdogActions(
  dsh: DshAdapter,
  stateDir: string,
  registry?: HoldRegistry,
  surfaces: WatchdogSurfaces = {},
): void {
  const predicateSource = surfaces.predicate
  dsh.registerTool({
    name: HOLD_TOOL,
    description:
      "Persist the team watchdog's PRESERVING hold for one team. This is the INTERNAL implementation of a team pause, not a second pause mechanism: the external pause a user operates is `agent_teams_halt` (the web Stop-team route), cleared by `agent_teams_resume`. The hold stops NEW dispatch into that team without cancelling anything: every non-terminal task keeps its status, assignee and attemptId. Returns applied:false (never a throw) when the hold could not be written, so a caller must not report a pause that did not land.",
    parameters: {
      type: "object",
      properties: {
        team_id: { type: "string", description: "The team to hold." },
        task_id: { type: "string", description: "The task whose silence caused the hold." },
        attempt_id: { type: "string", description: "That task's attempt id at escalation time." },
        cause: { type: "string", description: "Why the hold was raised (default: silence)." },
        scene_at: { type: "number", description: "Epoch ms of the scene written for this escalation." },
        ttl_ms: {
          type: "number",
          description:
            "T-17: auto-release bound in ms. Omitted, the resolved watchdog.holdTtlMs applies; 0 means no TTL (only the activity path can release it). Both paths append a hold-auto-released incident.",
        },
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
      let fallbackTtl = 0
      try {
        fallbackTtl = surfaces.holdTtlMs?.() ?? 0
      } catch {
        fallbackTtl = 0
      }
      return applyHold(workspace, stateDir, args ?? {}, registry, fallbackTtl)
    },
  })

  dsh.registerTool({
    name: RESUME_TOOL,
    description:
      "Clear the team watchdog's internal hold for one team (the implementation record only — the team pause itself is operated through `agent_teams_halt` / `agent_teams_resume`). A team that is not held is a no-op (resumed:false, reason:'not-held'), never an error; a second resume is likewise a no-op. Clearing the hold is the watchdog-side release only — the adopted dispatch gates that honour it are wired by w7.",
    parameters: {
      type: "object",
      properties: { team_id: { type: "string", description: "The team whose internal watchdog hold to clear." } },
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
      "READ-ONLY: show the team watchdog's durable store for this workspace — the hold per team, the heartbeat tails, the incident log, the per-reader watermark, (contract §4) which PREDICATE is running (`channel` = the session/event four-state fold, `heartbeat` = the report-only degradation which can never hold or escalate), (§7.2) the per-knob LIVE vs FILE value with a restartRequired flag (T-18: a `.mpd/mpd.jsonc` edit is applied LIVE once this process has observed it), and (T-19) the ONE pause state per team: the external mechanism is `agent_teams_halt` and the watchdog's preserving hold is reported only as its INTERNAL implementation. Use it to inspect what a lane or a restarting process would read from disk.",
    parameters: {
      type: "object",
      properties: { team_id: { type: "string", description: "Limit to one team." } },
      additionalProperties: false,
    },
    output: {
      schema: {
        type: "object",
        properties: {
          workspace: { type: "string" },
          paths: { type: "object" },
          predicate: { type: "object" },
          knobs: { type: "object" },
          teams: { type: "array", items: { type: "object" } },
        },
      },
      render: (_args: unknown, raw: unknown) => {
        const value = (raw ?? {}) as {
          teams: Array<{ teamId: string; held: boolean; halt: { halted: boolean; haltedAt: number | null }; pause: { paused: boolean; mechanism: string; implementation: string } }>
          predicate?: { source: string; reason: string }
          knobs?: KnobDivergenceView
        }
        const lines: string[] = []
        const predicate = value.predicate
        lines.push(
          predicate === undefined
            ? "predicate: channel (unknown to this renderer)"
            : "predicate: " + predicate.source + " — " + predicate.reason,
        )
        // §7.2: LIVE always; the FILE value only when the file states one that differs.
        const knobs = value.knobs
        if (knobs !== undefined) {
          lines.push(
            "knobs (live" + (knobs.fileFound ? " vs " + String(knobs.file) : ", no " + String(knobs.file)) + "): " +
              knobs.readings
                .map((reading) =>
                  reading.file === undefined || !reading.differs
                    ? reading.knob + "=" + String(reading.live)
                    : reading.knob + "=" + String(reading.live) + " (file " + String(reading.file) + ", restartRequired)",
                )
                .join(" | ") +
              (knobs.fileApplied ? "  ✔ the file layer is applied LIVE (T-18)" : "") +
              (knobs.restartRequired ? "  ⟵ a .mpd/mpd.jsonc edit is waiting for the next dsh boot" : ""),
          )
        }
        // T-19 (wave 2, user ruling): ONE pause state and ONE external mechanism. The watchdog's
        // preserving hold is named ONLY as that pause's internal implementation — never as a
        // second mechanism a caller picks between.
        for (const team of value.teams) {
          const pause = team.pause
          if (pause?.paused === true) {
            lines.push(team.teamId + ": PAUSED — mechanism: " + pause.mechanism + " (external) · watchdog preserving hold: internal implementation " + (pause.implementation === "watchdog-hold" ? "active" : "none"))
          } else lines.push(team.teamId + ": not paused")
          if (team.halt?.halted === true) lines.push("  halted since " + String(team.halt.haltedAt ?? "(unknown)"))
        }
        return [{ type: "text", text: lines.join("\n") }]
      },
    },
    execute: (args: { team_id?: string }, exec: unknown) => {
      const workspace = dsh.workspaceRoot(exec as never)
      const ids = args?.team_id === undefined || args.team_id === "" ? listTeamIds(workspace, stateDir) : [args.team_id]
      return {
        workspace,
        // §4: the status view NAMES the active predicate source.
        predicate: predicateSource?.() ?? { source: "unknown", reason: "the engine did not publish a predicate source", enrichment: false, events: 0, sessions: 0, states: {}, announced: false },
        // §7.2: per knob, the LIVE value and the FILE value when it differs.
        knobs: surfaces.knobs?.() ?? { readings: [], divergent: [], restartRequired: false, file: null, fileFound: false, fileApplied: false, liveLayer: "namespace" },
        paths: {
          heartbeat: heartbeatDir(workspace, stateDir),
          hold: join(workspace, stateDir, "watchdog", "hold"),
          incidents: incidentsPath(workspace, stateDir),
          watermark: watermarkPath(workspace, stateDir),
        },
        teams: ids.map((teamId) => {
          const hold = readHold(workspace, stateDir, teamId)
          const team = readTeam(workspace, stateDir, teamId)
          // T-19 (wave 2, user ruling): ONE pause state, ONE external mechanism. `halted` comes
          // from the adopted record (`agent_teams_halt`), `held` from this plugin's own hold
          // sidecar, and the hold is reported ONLY as the pause's internal implementation — the
          // two booleans stay as diagnostics, never as two selectable mechanisms.
          const halted = team?.halted === true
          const held = hold !== undefined
          const pause = {
            paused: halted || held,
            mechanism: "agent_teams_halt",
            implementation: held ? "watchdog-hold" : "none",
            halted,
            held,
          }
          return {
            teamId,
            held: hold !== undefined,
            hold: hold ?? null,
            phase: team?.phase ?? null,
            halted: team?.halted ?? null,
            halt: { halted, haltedAt: team?.haltedAt ?? null },
            pause,
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
