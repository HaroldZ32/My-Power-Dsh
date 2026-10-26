// C9 mpd-cellwork-plugin — cell-work, the command-triggered dispatch-only mode (v1, Wave 2 core).
//
// WHAT THIS ROW OWNS. `/cellwork <objective>` is the ONLY entry point (contract B1): it writes the cell
// record under `<ws>/.mpd/cellwork/<cell-id>/`, then submits ONE activation directive as the invoking
// agent's own next user turn. Nothing else starts the mode — no tool, no event, no preset flag — which
// is why `cellwork_start` REFUSES to create a cell and only continues one.
//
// THE THREE TOOLS THIS WAVE SHIPS. `cellwork_status` reports the cell, `cellwork_start` opens the
// requirements phase on an existing cell, and `cellwork_stop` archives it. The staging of the
// planner/splitter team, the requirements document, the measured split, activation, dispatch,
// checkpoint/handoff/compaction/promotion, sub-teams and mail are the flow lane's tools; they extend
// the same CELL RECORD and the same guard this file installs.
//
// THE GUARD IS INSTALLED ONCE, through the adapter's `tools.guard` seam (contract B2). Its predicate is
// pure (`cellworkGuardDecision`); this row only supplies the seat lookup, which resolves the caller
// against the active cell record and — for a re-raised member — the live team record.
//
// EVERY HARNESS TOUCH GOES THROUGH `resolveDshAdapter(ctx)` (AGENTS.md §6): the command registry, the
// tool registry, the guard seam, the workspace root, the log sink, the user-message factory and the
// tool executor used to read the team board. This file names no raw cordis registry member: its own
// `Ctx` type declares only the two members it probes, and every harness capability arrives as a `dsh`
// method, so a harness rename is an edit in the adapter and never here.
import { DSH_SEAM_COMMANDS, DSH_SEAM_TOOLS, dshSeamInject, resolveDshAdapter, textBlock, type DshAdapter, type DshCommandDef, type DshCommandInvocation, type DshToolExec, type DshUserMessage } from "../../mpd-dsh-adapter-plugin/src/index"
import { callerContext, sessionIdOf, type CallerContext, type TeamsServiceView } from "./caller"
import { resolveCellworkConfig, type CellworkConfig } from "./config"
import { installCellworkGuard } from "./guard"
import { CELLWORK_USAGE, activationDirective } from "./prompts"
import { installCellworkFlow, type FlowCtx } from "./flow"
import { installCellworkProtocol } from "./protocol"
import type { ProtocolCtx } from "./protocol-core"
import { stagePlanningTeam } from "./staging"
import { cellDir, freeCellId, journalPath, newCellState, readActiveCell, readCell, recordTransition, requirementsPath, statePath, writeCell, type CellReadFailure, type CellState } from "./state"

/** The cordis plugin name; the bundle patch addresses this row by its id `mpd-cellwork`. */
export const name = "mpd-cellwork"
/** Both seams are declared by their adapter constants: this row registers tools and one command. */
export const inject = dshSeamInject(DSH_SEAM_TOOLS, DSH_SEAM_COMMANDS)

/** The host context this row reads; the adapter owns the real seam surface behind it. */
type Ctx = { tools?: unknown; effect?: (fn: () => unknown, label?: string) => unknown; get?: (serviceName: string, strict?: boolean) => unknown; [key: string]: unknown }

/** The row config as the patch may declare it — the same keys `mpd.jsonc` carries under `cellwork`. */
export type CellworkRowConfig = Partial<CellworkConfig>

/** The `mpdConfig` service slice this row reads: arbitrary dotted keys from the merged JSONC layers. */
interface ConfigServiceView {
  /** Read one dotted key; undefined when the file never declared it. */
  get?: (dottedKey?: string) => unknown
}

/** The failure shape every cellwork tool answers with — never a throw, so the model can act on it. */
interface CellworkFailure {
  /** Always false; the discriminator the renderer and a caller branch on. */
  ok: false
  /** ONE sentence naming what was refused and what to do instead. */
  error: string
  /** The record path, when the refusal is about a state this build could not read. */
  path?: string
}

/** What `cellwork_status` answers on success. */
interface CellworkStatusResult {
  /** True on success. */
  ok: true
  /** The cell the caller is in (or was asked about). */
  cellId: string
  /** The lifecycle phase. */
  phase: string
  /** Whether the cell was archived. */
  archived: boolean
  /** The user's objective, verbatim. */
  objective: string
  /** The session the captain guard applies to. */
  captainSessionId: string
  /** Nesting level; 0 for the top cell. */
  depth: number
  /** The parent cell id, or null. */
  parentCellId: string | null
  /** The live team id, or "" while no team was approved. */
  teamId: string
  /** The accepted requirements revision (0 before the first finalize). */
  requirementsRevision: number
  /** The accepted split revision, or null. */
  splitRevision: number | null
  /** Whether a requirements update invalidated the accepted split. */
  splitStale: boolean
  /** ISO instant the planner team was staged, or "". */
  startedAt: string
  /** The cell's members, in board order. */
  members: Array<{ name: string; role: string; mode: string; sessionId: string }>
  /** How many checkpoints were injected so far. */
  checkpoints: number
  /** The caller's own cell seat, or null when the session belongs to no cell. */
  seat: { name: string; mode: string } | null
  /** The live team's member count, when the team record was readable. */
  teamMembers: number
  /** The live team's task count, when the team record was readable. */
  teamTasks: number
  /** The cell directory every artifact lives under. */
  cellDir: string
  /** Absolute state record path. */
  statePath: string
  /** Absolute journal path. */
  journalPath: string
  /** Absolute requirements document path (present only after the first finalize). */
  requirementsPath: string
}

/** What `cellwork_start` answers on success. */
interface CellworkStartResult {
  /** True on success. */
  ok: true
  /** The cell that entered the requirements phase. */
  cellId: string
  /** The phase after this call. */
  phase: string
  /** ISO instant the phase was opened (the first successful call's instant). */
  startedAt: string
  /** The live team id, or "" when no team has been approved yet. */
  teamId: string
  /** Whether an approved team exists — the value the flow lane's staging flips to true. */
  staged: boolean
  /** How many members that team holds, when it was readable. */
  teamMembers: number
  /** How many tasks that team holds, when it was readable. */
  teamTasks: number
  /** Whether this call did the transition or found it already done. */
  alreadyStarted: boolean
  /** Absolute state record path. */
  statePath: string
}

/** What `cellwork_stop` answers on success. */
interface CellworkStopResult {
  /** True on success. */
  ok: true
  /** The archived cell. */
  cellId: string
  /** Always true: stopping archives, never deletes. */
  archived: boolean
  /** Whether `force` was needed and given. */
  forced: boolean
  /** Why the cell was stopped. */
  reason: string
  /** The in-progress tasks a non-forced stop refused on; empty when the stop was clean. */
  inProgress: string[]
  /** Absolute state record path. */
  statePath: string
}

/**
 * Read one dotted `mpd.jsonc` key through the config service, tolerating its absence.
 *
 * Total on purpose: a composition without `mpd-config` means "the row config is the only layer", never
 * a failed boot.
 *
 * @param ctx - the host context.
 * @param dottedKey - the full key, e.g. `cellwork.depthMax`.
 * @returns the declared value, or undefined.
 */
function configValue(ctx: Ctx, dottedKey: string): unknown {
  /** The config service, probed with a false default so an absent row is not an error. */
  const service = ctx.get?.("mpdConfig", false) as ConfigServiceView | undefined
  if (service === undefined || typeof service.get !== "function") return undefined
  try {
    return service.get(dottedKey)
  } catch {
    return undefined
  }
}

/**
 * Resolve the `mpdTeams` service, PER CALL.
 *
 * Lazy because the team row may activate after this one; a service captured at apply time would be a
 * permanent absence. A composition without it still reads the cell record — which is the authoritative
 * half — so this is a degradation, not a failure.
 *
 * @param ctx - the host context.
 * @returns the service view, or undefined.
 */
function teamsService(ctx: Ctx): TeamsServiceView | undefined {
  /** The service, probed with a false default. */
  const service = ctx.get?.("mpdTeams", false)
  if (typeof service !== "object" || service === null) return undefined
  return service as TeamsServiceView
}

/**
 * The roster persona text for one role label, or null when the roster service cannot answer.
 *
 * Structurally read: the `mpdRoles` service is the roster's public surface, and importing another
 * package's src would add a frozen cross-package coupling the inventory may not grow.
 *
 * @param ctx - the host context.
 * @param label - the roster role name (`Planner`, `Lead`, …).
 * @returns the persona text, or null.
 */
function personaOf(ctx: Ctx, label: string): string | null {
  /** The roster service, probed with a false default. */
  const service = ctx.get?.("mpdRoles", false) as { get?: (key: string) => { persona?: unknown } | null } | undefined
  if (service === undefined || typeof service.get !== "function") return null
  try {
    /** The role row. */
    const role = service.get(label)
    return role !== null && role !== undefined && typeof role.persona === "string" && role.persona.trim() !== "" ? role.persona : null
  } catch {
    return null
  }
}

/**
 * Read one team record through the service, tolerating every failure.
 *
 * @param ctx - the host context.
 * @param workspace - the caller's workspace root.
 * @param teamId - the team to read; "" answers undefined without touching the service.
 * @returns the record, or undefined when there is no service, no id or no readable record.
 */
function teamRecordOf(ctx: Ctx, workspace: string, teamId: string): Record<string, unknown> | undefined {
  if (teamId === "" || workspace === "") return undefined
  /** The service's own read, which is total by contract. */
  const record = teamsService(ctx)?.get?.(workspace, teamId)
  return typeof record === "object" && record !== null ? record as Record<string, unknown> : undefined
}

/**
 * The member and task counts of one team record, for the status/start summaries.
 *
 * @param record - the team record, or undefined.
 * @returns the two counts; both are 0 when the record is absent.
 */
function teamCounts(record: Record<string, unknown> | undefined): { members: number; tasks: number } {
  if (record === undefined) return { members: 0, tasks: 0 }
  return {
    members: Array.isArray(record.members) ? record.members.length : 0,
    tasks: Array.isArray(record.tasks) ? record.tasks.length : 0,
  }
}

/**
 * The board tasks a non-forced stop must refuse on: everything a teammate is actively working.
 *
 * `claimed` and `in_progress` are the two live states; a `pending` task is not being worked and a
 * terminal one is done, so neither blocks an archive.
 *
 * @param record - the team record, or undefined.
 * @returns one `id (subject)` line per live task, in board order.
 */
function liveTasks(record: Record<string, unknown> | undefined): string[] {
  if (record === undefined || !Array.isArray(record.tasks)) return []
  /** The live rows only. */
  const live = record.tasks.filter((task) => typeof task === "object" && task !== null) as Array<Record<string, unknown>>
  return live
    .filter((task) => task.status === "claimed" || task.status === "in_progress")
    .map((task) => String(task.id ?? "?") + " (" + String(task.subject ?? "") + ")")
}

/** The sentence a refusing read answers with, naming the absolute path and what was wrong. */
function refusalText(failure: CellReadFailure): string {
  return "the cell record at " + failure.path + " cannot be read (" + failure.reason + ": " + failure.detail + ") — nothing was changed; repair or archive that file first"
}

/**
 * The one-line render every cellwork tool result uses.
 *
 * @param value - the tool's structured result.
 * @returns the harness content blocks.
 */
function render(value: unknown): unknown {
  /** The result as a record, so the renderer never assumes a branch. */
  const result = typeof value === "object" && value !== null ? value as Record<string, unknown> : {}
  if (result.ok === false) return textBlock("cellwork refused: " + String(result.error ?? "unknown refusal") + (typeof result.path === "string" ? "\nstate: " + result.path : ""))
  if ("alreadyStarted" in result) {
    return textBlock("cellwork start " + String(result.cellId) + ": phase " + String(result.phase)
      + (result.staged === true ? " — team " + String(result.teamId) + ": " + String(result.teamMembers) + " member(s), " + String(result.teamTasks) + " task(s)" : " — no approved team yet")
      + (result.alreadyStarted === true ? " (already started)" : ""))
  }
  if ("inProgress" in result || "forced" in result) {
    return textBlock("cellwork stopped " + String(result.cellId) + " — archived" + (result.forced === true ? " (forced)" : "") + ", reason: " + String(result.reason ?? ""))
  }
  if ("members" in result) {
    /** The member lines of the status render. */
    const members = Array.isArray(result.members) ? result.members as Array<Record<string, unknown>> : []
    return textBlock("cellwork " + String(result.cellId) + " — phase " + String(result.phase) + (result.archived === true ? " (archived)" : "")
      + "\n  objective: " + String(result.objective)
      + "\n  captain: " + String(result.captainSessionId) + (result.seat === null ? "" : " · you: " + String((result.seat as Record<string, unknown>).name) + " (" + String((result.seat as Record<string, unknown>).mode) + ")")
      + "\n  requirements rev " + String(result.requirementsRevision) + " · split rev " + String(result.splitRevision ?? "-") + (result.splitStale === true ? " (STALE)" : "")
      + "\n  team: " + (String(result.teamId) === "" ? "none approved" : String(result.teamId) + " — " + String(result.teamMembers) + " member(s), " + String(result.teamTasks) + " task(s)")
      + "\n  members (" + members.length + "): " + (members.length === 0 ? "-" : members.map((member) => String(member.name) + "[" + String(member.mode) + "]").join(", "))
      + "\n  checkpoints injected: " + String(result.checkpoints)
      + "\n  state: " + String(result.statePath))
  }
  return textBlock(JSON.stringify(value, null, 2))
}

/**
 * Read one string argument, trimmed; anything else is "".
 *
 * @param args - the tool arguments, read as an untrusted record.
 * @param key - the argument name.
 * @returns the trimmed string, or "".
 */
function argString(args: Record<string, unknown>, key: string): string {
  /** The declared value. */
  const value = args[key]
  return typeof value === "string" ? value.trim() : ""
}

/**
 * Mount the cell-work row: resolve the config, install the guard, register the three tools and the
 * one command.
 *
 * Teardown is handed to the plugin's own fiber when the context offers `effect`, so a reload releases
 * the guard, the tools and the command instead of leaking a second registration.
 *
 * @param ctx - the host context.
 * @param config - the row's `config:` block from the bundle patch.
 */
export function apply(ctx: Ctx, config: CellworkRowConfig = {}): void {
  /** The one seam surface this row may touch. */
  const dsh: DshAdapter = resolveDshAdapter(ctx)
  /** The row's log sink (R5: rows never print; a line goes to `<root>/.mpd/logs/mpd-cellwork.log`). */
  const warn = (line: string): void => { dsh.rowLog("mpd-cellwork", line) }
  /** The resolved knobs: file override, then the row config, then the documented default. */
  const cfg: CellworkConfig = resolveCellworkConfig(config, (dottedKey) => configValue(ctx, dottedKey), warn)
  /** Every registration's disposer, released together on teardown. */
  const disposers: Array<() => void> = []

  // THE GUARD, ONCE. Its seat lookup resolves the caller against the ACTIVE cell record; a session in
  // no cell passes through, which is what makes the mode free while it is off.
  /** The guard's install outcome, reported on the mount line. */
  const guard = installCellworkGuard(dsh, {
    seatOf: (exec) => callerContext(dsh, exec, { teams: () => teamsService(ctx) }).seat,
    warn,
  })
  if (guard.dispose !== undefined) disposers.push(guard.dispose)

  // ── cellwork_status ───────────────────────────────────────────────────────
  disposers.push(dsh.registerTool({
    name: "cellwork_status",
    description: "Report one cell: phase, objective, captain, requirements/split revisions, members and their modes, injected checkpoints, the live team's member/task counts and the on-disk paths. Defaults to the workspace's ACTIVE cell; pass `cellId` to read another. Never mutates anything.",
    parameters: {
      type: "object",
      properties: { cellId: { type: "string", description: "The cell to report; omitted reads the workspace's active cell." } },
      additionalProperties: false,
    },
    output: {
      schema: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          error: { type: "string" },
          path: { type: "string" },
          cellId: { type: "string" },
          phase: { type: "string" },
          archived: { type: "boolean" },
          objective: { type: "string" },
          captainSessionId: { type: "string" },
          depth: { type: "number" },
          parentCellId: { oneOf: [{ type: "string" }, { type: "null" }] },
          teamId: { type: "string" },
          requirementsRevision: { type: "number" },
          splitRevision: { oneOf: [{ type: "number" }, { type: "null" }] },
          splitStale: { type: "boolean" },
          startedAt: { type: "string" },
          members: { type: "array", items: { type: "object" } },
          checkpoints: { type: "number" },
          seat: { oneOf: [{ type: "object" }, { type: "null" }] },
          teamMembers: { type: "number" },
          teamTasks: { type: "number" },
          cellDir: { type: "string" },
          statePath: { type: "string" },
          journalPath: { type: "string" },
          requirementsPath: { type: "string" },
        },
        required: ["ok"],
      },
      render: (_args: unknown, value: unknown) => render(value),
    },
    execute: (args: unknown, exec: DshToolExec): CellworkStatusResult | CellworkFailure => {
      /** The caller's workspace, session and seat. */
      const caller: CallerContext = callerContext(dsh, exec, { teams: () => teamsService(ctx) })
      if (caller.workspace === "") return { ok: false, error: "cellwork_status: the workspace root could not be resolved for this call" }
      /** The requested cell id, or "" for the active cell. */
      const requested = argString(readArgs(args), "cellId")
      /** The record being reported; resolved by exactly one of the two branches below. */
      let state: CellState
      if (requested === "") {
        /** The workspace's active cell, or the refusal that replaced it. */
        const active = readActiveCell(caller.workspace)
        if (!active.ok) return { ok: false, error: refusalText(active), path: active.path }
        if (active.cell === null) return { ok: false, error: "cellwork_status: no cell is active in this workspace — start one with `/cellwork <objective>`" }
        state = active.cell.state
      } else {
        /** The named cell's own record. */
        const single = readCell(caller.workspace, requested)
        if (!single.ok) return { ok: false, error: refusalText(single), path: single.path }
        state = single.state
      }
      /** The live team's counts, when a team id is recorded and readable. */
      const counts = teamCounts(teamRecordOf(ctx, caller.workspace, state.teamId))
      return {
        ok: true,
        cellId: state.cellId,
        phase: state.phase,
        archived: state.archived,
        objective: state.objective,
        captainSessionId: state.captainSessionId,
        depth: state.depth,
        parentCellId: state.parentCellId,
        teamId: state.teamId,
        requirementsRevision: state.requirementsRevision,
        splitRevision: state.splitRevision,
        splitStale: state.splitStale,
        startedAt: state.startedAt,
        members: Object.values(state.members).map((member) => ({ name: member.name, role: member.role, mode: member.mode, sessionId: member.sessionId })),
        checkpoints: state.checkpoints.length,
        seat: caller.seat === undefined ? null : { name: caller.seat.name, mode: caller.seat.mode },
        teamMembers: counts.members,
        teamTasks: counts.tasks,
        cellDir: cellDir(caller.workspace, state.cellId),
        statePath: statePath(caller.workspace, state.cellId),
        journalPath: journalPath(caller.workspace, state.cellId),
        requirementsPath: requirementsPath(caller.workspace, state.cellId),
      }
    },
  }))

  // ── cellwork_start ───────────────────────────────────────────────────────
  disposers.push(dsh.registerTool({
    name: "cellwork_start",
    description: "Open the REQUIREMENTS phase of the ACTIVE cell (captain only): validates the cell and the caller, stamps `startedAt`, writes the journal entry and reports the live team. A cell is created by `/cellwork` ALONE — this tool never starts the mode and never creates a cell. Idempotent: a second call reports the first one's result.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    output: {
      schema: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          error: { type: "string" },
          path: { type: "string" },
          cellId: { type: "string" },
          phase: { type: "string" },
          startedAt: { type: "string" },
          teamId: { type: "string" },
          staged: { type: "boolean" },
          teamMembers: { type: "number" },
          teamTasks: { type: "number" },
          alreadyStarted: { type: "boolean" },
          statePath: { type: "string" },
        },
        required: ["ok"],
      },
      render: (_args: unknown, value: unknown) => render(value),
    },
    execute: async (_args: unknown, exec: DshToolExec): Promise<CellworkStartResult | CellworkFailure> => {
      /** The caller's workspace, session and seat. */
      const caller: CallerContext = callerContext(dsh, exec, { teams: () => teamsService(ctx) })
      if (caller.refusal !== null) return { ok: false, error: refusalText(caller.refusal), path: caller.refusal.path }
      if (caller.cell === null || caller.cell === undefined) return { ok: false, error: "cellwork_start: no cell is active in this workspace — a cell is created by `/cellwork <objective>` and by nothing else" }
      /** The active cell's record. */
      const state = caller.cell
      if (caller.sessionId === "" || caller.sessionId !== state.captainSessionId) {
        return { ok: false, error: "cellwork_start is CAPTAIN-ONLY: the captain of " + state.cellId + " is session " + state.captainSessionId + ", which is not this caller" }
      }
      if (state.phase === "stopped") return { ok: false, error: "cellwork_start: " + state.cellId + " is stopped and archived — start a new cell with `/cellwork <objective>`" }
      /** The instant this call transitions the phase (or would have). */
      const now = new Date()
      /** Whether the requirements phase was already opened. */
      const alreadyStarted = state.startedAt !== ""
      /** The record after the transition (identical when it was already open). */
      const next: CellState = alreadyStarted ? state : { ...state, startedAt: now.toISOString(), phase: state.phase === "requirements" ? "requirements" : state.phase }
      if (!alreadyStarted) {
        recordTransition(caller.workspace, next, { event: "start", phase: next.phase, captainSessionId: state.captainSessionId }, now)
      }
      // AMENDMENT 3: this tool STAGES the two-member planning team. It runs after the record transition
      // so a failed approval leaves a started cell the captain can retry, never a half-created team with
      // no record behind it. A retry is safe: staging is idempotent once `teamId` is recorded.
      /** The record after staging (identical when a team was already recorded). */
      let stagedState: CellState = next
      if (next.teamId === "") {
        /** The staging outcome. */
        const staged = await stagePlanningTeam({
          dsh,
          workspace: caller.workspace,
          cell: next,
          captainAgent: exec.agent,
          personaFor: (label) => personaOf(ctx, label),
          teams: () => teamsService(ctx),
          config: cfg,
          now,
        })
        if (!staged.ok) return { ok: false, error: staged.error ?? "cellwork_start: staging the planning team failed" }
        /** The record carrying the approved team and the two planning members. */
        stagedState = { ...next, teamId: staged.teamId ?? next.teamId, members: { ...next.members, ...(staged.members ?? {}) } }
        recordTransition(caller.workspace, stagedState, { event: "planning-team-staged", teamId: stagedState.teamId, members: Object.keys(staged.members ?? {}), tasks: staged.tasks ?? {} }, now)
      }
      /** The live team's counts, when one is recorded and readable. */
      const counts = teamCounts(teamRecordOf(ctx, caller.workspace, stagedState.teamId))
      return {
        ok: true,
        cellId: stagedState.cellId,
        phase: stagedState.phase,
        startedAt: stagedState.startedAt,
        teamId: stagedState.teamId,
        staged: stagedState.teamId !== "",
        teamMembers: counts.members,
        teamTasks: counts.tasks,
        alreadyStarted,
        statePath: statePath(caller.workspace, stagedState.cellId),
      }
    },
  }))

  // ── cellwork_stop ────────────────────────────────────────────────────────
  disposers.push(dsh.registerTool({
    name: "cellwork_stop",
    description: "End the mode (captain only): ARCHIVES the cell (no deletion), clears the guard and gives every tool back. REFUSES while a cell task is claimed or in_progress unless `force:true`, and a forced stop is journaled as such.",
    parameters: {
      type: "object",
      properties: {
        force: { type: "boolean", description: "Stop even with live tasks; the exception is recorded in the journal." },
        reason: { type: "string", description: "One line answering why the cell ends." },
        cellId: { type: "string", description: "The cell to stop; omitted uses the workspace's active cell." },
      },
      additionalProperties: false,
    },
    output: {
      schema: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          error: { type: "string" },
          path: { type: "string" },
          cellId: { type: "string" },
          archived: { type: "boolean" },
          forced: { type: "boolean" },
          reason: { type: "string" },
          inProgress: { type: "array", items: { type: "string" } },
          statePath: { type: "string" },
        },
        required: ["ok"],
      },
      render: (_args: unknown, value: unknown) => render(value),
    },
    execute: (args: unknown, exec: DshToolExec): CellworkStopResult | CellworkFailure => {
      /** The tool arguments, read as an untrusted record. */
      const input = readArgs(args)
      /** The caller's workspace, session and seat. */
      const caller: CallerContext = callerContext(dsh, exec, { teams: () => teamsService(ctx) })
      /** The workspace this call would write into. */
      const workspace = caller.workspace
      if (workspace === "") return { ok: false, error: "cellwork_stop: the workspace root could not be resolved for this call" }
      /** The requested cell, or the active one. */
      const requested = argString(input, "cellId")
      /** The record being stopped; resolved by exactly one of the two branches below. */
      let state: CellState
      if (requested === "") {
        /** The workspace's active cell, or the refusal that replaced it. */
        const active = readActiveCell(workspace)
        if (!active.ok) return { ok: false, error: refusalText(active), path: active.path }
        if (active.cell === null) return { ok: false, error: "cellwork_stop: no cell is active in this workspace" }
        state = active.cell.state
      } else {
        /** The named cell's own record. */
        const single = readCell(workspace, requested)
        if (!single.ok) return { ok: false, error: refusalText(single), path: single.path }
        state = single.state
      }
      if (caller.sessionId === "" || caller.sessionId !== state.captainSessionId) {
        return { ok: false, error: "cellwork_stop is CAPTAIN-ONLY: the captain of " + state.cellId + " is session " + state.captainSessionId + ", which is not this caller" }
      }
      if (state.phase === "stopped") {
        return { ok: true, cellId: state.cellId, archived: true, forced: false, reason: state.stopReason === "" ? "already stopped" : state.stopReason, inProgress: [], statePath: statePath(workspace, state.cellId) }
      }
      /** The live tasks a non-forced stop must refuse on. */
      const inProgress = liveTasks(teamRecordOf(ctx, workspace, state.teamId))
      /** Whether the caller demanded the exception. */
      const forced = input.force === true
      if (inProgress.length > 0 && !forced) {
        return { ok: false, error: "cellwork_stop refused: " + String(inProgress.length) + " task(s) are still being worked (" + inProgress.join("; ") + "). Let them finish, fail them on the board, or pass force:true with a reason — a forced stop is journaled" }
      }
      /** The instant of the archive. */
      const now = new Date()
      /** The caller's stated reason, or the default that says what happened. */
      const reason = argString(input, "reason") === "" ? (forced ? "forced stop" : "stopped by the captain") : argString(input, "reason")
      /** The archived record: stopped, archived, and no longer the workspace's active cell. */
      const stopped: CellState = { ...state, phase: "stopped", archived: true, stopReason: reason }
      recordTransition(workspace, stopped, { event: "stop", reason, forced, inProgress }, now)
      return { ok: true, cellId: state.cellId, archived: true, forced, reason, inProgress, statePath: statePath(workspace, state.cellId) }
    },
  }))

  // ── /cellwork — THE ONLY ENTRY POINT (contract B1) ───────────────────────
  // A command handler runs "without sending the command to the model", so the handler WRITES the cell
  // record and then SUBMITS the activation directive as the invoking agent's own next user turn. An
  // empty argument answers usage and writes NOTHING — not even the cell root.
  // The handler shared by the one command spelling.
  //
  // Synchronous on purpose: nothing here awaits, so the record and the injection are ordered by the
  // statements themselves and a host that awaits the handler sees the same order.
  const runCellworkCommand = (invocation: DshCommandInvocation): { kind: "error" | "success"; text: string } => {
    /** The user's objective from the invocation, trimmed. */
    const objective = String(invocation?.rawInput ?? "").trim()
    if (objective === "") return { kind: "error", text: CELLWORK_USAGE }
    /** The command's workspace, resolved from the invoking agent. */
    const workspace = dsh.workspaceRoot({ agent: invocation?.agent } as DshToolExec)
    /** The workspace's current cell scan. */
    const active = readActiveCell(workspace)
    if (!active.ok) return { kind: "error", text: "cellwork refused: " + refusalText(active) }
    if (active.cell !== null) {
      return {
        kind: "error",
        text: "cellwork refused: cell " + active.cell.state.cellId + " is still active in this workspace (phase " + active.cell.state.phase + ") — one cell at a time, and a second one would fight the first for the same team board. Read it with `cellwork_status`, finish it, or end it with `cellwork_stop` first.",
      }
    }
    /** The instant this cell is minted at, which its id also encodes. */
    const now = new Date()
    /** The fresh record, phase `requirements`, capturing the captain session. */
    const created = newCellState({ cellId: freeCellId(workspace, now), objective, captainSessionId: sessionIdOf(invocation?.agent), now })
    writeCell(workspace, created)
    recordTransition(workspace, created, { event: "start", phase: created.phase, objective, captainSessionId: created.captainSessionId }, now)
    /** The activation directive submitted as the invoking agent's own next user turn. */
    const directive: DshUserMessage = dsh.userMessage({ text: activationDirective({ state: created, workspace }), source: { kind: "mpd-cellwork", reason: "activation-directive" } })
    if (invocation?.submit?.(directive) !== true) {
      // NOTHING RUNS IF NOTHING WAS INJECTED. Leaving the record active would fence a captain whose
      // turn never received the directive, so the just-created cell is archived with the reason.
      recordTransition(workspace, { ...created, phase: "stopped", archived: true, stopReason: "no-live-turn-surface" }, { event: "stop", reason: "no-live-turn-surface", forced: false }, now)
      return { kind: "error", text: "cellwork could not start: no live agent turn surface to submit the activation directive, so cell " + created.cellId + " was archived immediately and no mode is active" }
    }
    return { kind: "success", text: "cellwork active: " + created.cellId + " — the activation directive was submitted as this agent's next turn" }
  }
  // ── the flow tools (B4–B7) from their own module ──────────────────────────
  disposers.push(...installCellworkFlow({ dsh, ctx: ctx as FlowCtx, config: cfg, warn }))

  // ── the protocol tools and listeners (B8/B9) ──────────────────────────────
  disposers.push(...installCellworkProtocol({ dsh, ctx: ctx as ProtocolCtx, config: cfg, warn }))

  /** The one command definition; the name has no second spelling by contract. */
  const command: DshCommandDef = { name: "cellwork", description: "Start cell-work for an objective: a dedicated planner interview, a measured task split, and a team that dispatches, hands off, compacts and promotes (captain dispatches only).", input: { hint: "objective" }, handler: runCellworkCommand }
  disposers.push(dsh.registerCommand(command))

  // Cordis owns teardown: hand the disposers to the plugin's own fiber when the context offers
  // `effect`, so a teardown releases the guard, the tools and the command together.
  if (typeof ctx.effect === "function") ctx.effect(() => () => { for (const dispose of disposers) dispose() }, "mpd-cellwork.registrations")
  warn("[mpd-cellwork] mounted: guard=" + (guard.installed ? "on" : "OFF(" + String(guard.reason ?? "?") + ")") + " depthMax=" + String(cfg.depthMax) + " checkpointRatio=" + String(cfg.checkpointRatio) + " windowFraction=" + String(cfg.windowFraction) + " windowOverride=" + String(cfg.windowOverride ?? "none"))
}

/**
 * Read one tool's arguments as a record, so a malformed call cannot throw inside a branch.
 *
 * @param args - the harness-validated arguments, read as unknown because the schema is not enforced
 *   inside the handler.
 * @returns the arguments, or an empty record.
 */
function readArgs(args: unknown): Record<string, unknown> {
  return typeof args === "object" && args !== null && !Array.isArray(args) ? args as Record<string, unknown> : {}
}
