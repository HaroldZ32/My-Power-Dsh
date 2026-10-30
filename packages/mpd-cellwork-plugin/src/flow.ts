// CELLWORK FLOW — the four tools that carry the cell through B4–B7, and their ONE registration site.
//
//   cellwork_requirements  (planner)   finalize/update the agreed requirements document
//   cellwork_recon         (planner / subcaptain)   one-shot read-only consult
//   cellwork_split         (splitter)  submit/show the measured task graph
//   cellwork_activate      (captain)   materialise an accepted split on the LIVE team record
//
// The planning team's STAGING is not a tool of its own: `cellwork_start` performs it (Amendment 3), and
// this module exports the pieces `index.ts` calls. Everything here reaches the harness through the
// adapter ONLY (`dsh.executeTool`, `dsh.spawnAgent`, `dsh.teamExecutor`, `dsh.registerTool`); the two
// read-only services (`mpdTeams`, `mpdRoles`) and the config service are declared STRUCTURALLY, because
// the cross-package coupling inventory is frozen and may only shrink.
import { appendJournal, listCellIds, readCell, writeCell, requirementsPath, type CellReadFailure, type CellState, type CellMemberRecord } from "./state"
import { callerContext, sessionIdOf, type CallerContext, type TeamsServiceView } from "./caller"
import { type CellworkConfig } from "./config"
import { readRequirements, storedRequirementsText, validateRequirementsText, writeRequirements } from "./requirements"
import { latestSplit, readSplit, submitSplit, type SplitSubmission, type SplitTaskInput, type SplitVerdict } from "./split"
import { resolveTaskWindow, type RouteResolutionView, type WindowReading } from "./budget"
import { runRecon } from "./recon"
import { materializeSplit, type ActivatePartial, type ActivateResult } from "./activate"
import { PLANNER_MEMBER, SPLITTER_MEMBER } from "./staging"
import type { DshAdapter, DshToolExec } from "../../mpd-dsh-adapter-plugin/src/index"

/** The slice of the `mpdRoles` service this module reads (declared here, never imported). */
interface RosterServiceView {
  /** The full roster: the names and persona texts an owner role is validated against. */
  list?: () => Array<{ name?: string; persona?: string }>
  /** One role by name, carrying its persona text. */
  get?: (key: string) => { name?: string; persona?: string } | null
}

/** The slice of the `mpdConfig` service this module reads. */
interface ConfigServiceView {
  /** Read one dotted `mpd.jsonc` key. */
  get?: (dottedKey?: string) => unknown
  /** Resolve one roster agent's own `agentRoutes` entry (the route its window comes from). */
  agentRouteResolutionOf?: (member: string) => unknown
}

/** The host context this module reads; the adapter owns every harness seam behind it. */
export interface FlowCtx {
  /** The service lookup a row uses; a second argument of `false` means "absent is not an error". */
  get?: (serviceName: string, strict?: boolean) => unknown
}

/** What {@link installCellworkFlow} needs from the row. */
export interface FlowDeps {
  /** The resolved adapter (the ONE harness contact surface). */
  dsh: DshAdapter
  /** The host context, read only for the two MPD services and the config service. */
  ctx: FlowCtx
  /** The resolved knobs. */
  config: CellworkConfig
  /** The row's log sink. */
  warn: (line: string) => void
}

/** One flow tool's answer: a structured success (any documented fields) or the refusal sentence. */
type FlowResult = Record<string, unknown> | FlowFailure

/** The refusals every flow tool answers with — never a throw, so the model can act on the sentence. */
interface FlowFailure {
  /** Always false. */
  ok: false
  /** ONE sentence naming what was refused and what to do instead. */
  error: string
  /** The state path, when the refusal is about a record this build could not read. */
  path?: string
}

/**
 * The name key two board spellings must agree on (lowercase, non-alphanumerics collapsed).
 *
 * @param value - a member or owner spelling.
 * @returns the comparison key.
 */
function roleKeyOfOwner(row: Record<string, unknown>): string {
  return String(row.owner ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
}

/**
 * The workspace-relative spelling of a stored split verdict's own file.
 *
 * A REFUSED resubmission of an already-accepted revision lands beside the canonical file (Amendment 6
 * R2), so the path is read from the verdict instead of being rebuilt from its revision.
 *
 * @param workspace - the caller's workspace root.
 * @param verdict - the stored verdict whose path is wanted.
 * @returns the path relative to the workspace, or the absolute path for a verdict outside it.
 */
function splitPathFor(workspace: string, verdict: SplitVerdict): string {
  /** The path the verdict was persisted to, when it recorded one. */
  const file = verdict.file
  if (file === undefined || file === "") return [".mpd", "cellwork", verdict.cellId, "split", String(verdict.revision) + ".json"].join("/")
  /** The workspace prefix both spellings share, normalized once. */
  const prefix = workspace.endsWith("/") ? workspace : workspace + "/"
  return file.startsWith(prefix) ? file.slice(prefix.length) : file
}

/**
 * Read one tool's arguments as a record.
 *
 * @param args - the harness-validated arguments (the schema is not enforced inside the handler).
 * @returns the arguments, or an empty record.
 */
function readArgs(args: unknown): Record<string, unknown> {
  return typeof args === "object" && args !== null && !Array.isArray(args) ? args as Record<string, unknown> : {}
}

/**
 * Read one string field from untrusted arguments.
 *
 * @param args - the argument record.
 * @param key - the field name.
 * @returns the string, or "" when absent or not a string.
 */
function argString(args: Record<string, unknown>, key: string): string {
  return typeof args[key] === "string" ? args[key] as string : ""
}

/**
 * Read one string array from untrusted arguments.
 *
 * @param value - the raw argument value.
 * @returns the trimmed non-empty strings; `[]` for anything else.
 */
function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "").map((entry) => entry.trim()) : []
}

/**
 * The sentence a refusing cell read answers with.
 *
 * @param failure - the failed read.
 * @returns the refusal naming the path and the reason.
 */
function refusalText(failure: CellReadFailure): string {
  return "the cell record at " + failure.path + " cannot be read (" + failure.reason + ": " + failure.detail + ") — nothing was changed; repair or archive that file first"
}

/**
 * Read one team record through the service, tolerating every failure.
 *
 * @param teams - the team service view, when mounted.
 * @param workspace - the caller's workspace root.
 * @param teamId - the team id; "" answers undefined.
 * @returns the record, or undefined.
 */
function recordOf(teams: TeamsServiceView | undefined, workspace: string, teamId: string): Record<string, unknown> | undefined {
  if (teams === undefined || teamId === "" || workspace === "") return undefined
  /** The service's own read, total by contract. */
  const record = teams.get?.(workspace, teamId)
  return typeof record === "object" && record !== null ? record as Record<string, unknown> : undefined
}

/**
 * The board tasks of one team record, as records.
 *
 * @param record - the team record, or undefined.
 * @returns the task rows this build can read.
 */
function boardTasksOf(record: Record<string, unknown> | undefined): Array<Record<string, unknown>> {
  return record !== undefined && Array.isArray(record.tasks) ? record.tasks.filter((row): row is Record<string, unknown> => typeof row === "object" && row !== null) : []
}

/**
 * Install the four flow tools.
 *
 * @param deps - the adapter, the host context, the knobs and the log sink.
 * @returns one disposer per registration.
 */
export function installCellworkFlow(deps: FlowDeps): Array<() => void> {
  /** The adapter, named once so the tool bodies read cleanly. */
  const dsh = deps.dsh
  /** The resolved knobs. */
  const config = deps.config
  /** Every registration's disposer. */
  const disposers: Array<() => void> = []
  /** The team service, probed per call (the team row may activate after this one). */
  const teams = (): TeamsServiceView | undefined => {
    /** The service object, or undefined. */
    const service = deps.ctx.get?.("mpdTeams", false)
    return typeof service === "object" && service !== null ? service as TeamsServiceView : undefined
  }
  /** The roster service, probed per call. */
  const roster = (): RosterServiceView | undefined => {
    /** The service object, or undefined. */
    const service = deps.ctx.get?.("mpdRoles", false)
    return typeof service === "object" && service !== null ? service as RosterServiceView : undefined
  }
  /** The config service, probed per call. */
  const configService = (): ConfigServiceView | undefined => {
    /** The service object, or undefined. */
    const service = deps.ctx.get?.("mpdConfig", false)
    return typeof service === "object" && service !== null ? service as ConfigServiceView : undefined
  }
  /** The roster role names, or [] when the roster service cannot answer. */
  const rosterNames = (): string[] => {
    try {
      /** The roster rows. */
      const rows = roster()?.list?.()
      return Array.isArray(rows) ? rows.map((row) => String(row.name ?? "")).filter((name) => name !== "") : []
    } catch {
      return []
    }
  }
  /** The persona text for one roster role, or null when the roster service cannot answer. */
  const personaFor = (label: string): string | null => {
    try {
      /** The role row. */
      const role = roster()?.get?.(label)
      return role !== null && role !== undefined && typeof role.persona === "string" && role.persona.trim() !== "" ? role.persona : null
    } catch {
      return null
    }
  }
  /** The route one role resolves to, or undefined when the config service cannot answer. */
  const routeOf = (role: string): RouteResolutionView | undefined => {
    try {
      /** The service carrying the resolver. */
      const service = configService()
      /** The resolver, when the service exposes one. */
      const resolve = service?.agentRouteResolutionOf
      if (typeof resolve !== "function") return undefined
      /** The service's own answer. */
      const answer = resolve.call(service, role)
      return typeof answer === "object" && answer !== null ? answer as RouteResolutionView : undefined
    } catch {
      return undefined
    }
  }
  /** Read one role's window from the catalog (or the operator override). */
  const windowFor = async (role: string): Promise<WindowReading> =>
    resolveTaskWindow({ routeOf, catalog: () => dsh.llmCatalog(), config }, role)
  /** The caller's context for one dispatch. */
  const callerFor = (exec: DshToolExec): CallerContext => callerContext(dsh, exec, { teams })
  /**
   * Persist one transition: journal first, then the record (a torn journal costs one history line).
   *
   * @param workspace - the caller's workspace root.
   * @param next - the record after the transition.
   * @param entry - the journal fields.
   * @param now - the instant to stamp.
   * @returns the record as persisted.
   */
  const transition = (workspace: string, next: CellState, entry: Record<string, unknown>, now: Date): CellState => {
    /** The journal line count after the append. */
    const lines = appendJournal(workspace, next.cellId, entry, now)
    /** The record carrying the updated cursor. */
    const stamped: CellState = { ...next, journalCursor: lines > 0 ? lines : next.journalCursor }
    writeCell(workspace, stamped)
    return { ...stamped, updatedAt: now.toISOString() }
  }
  /**
   * Complete one cell task through the team plane, reporting rather than throwing on failure.
   *
   * @param exec - the calling dispatch (its agent is the task's owner).
   * @param teamId - the team the task is on.
   * @param predicate - which board task to close.
   * @param note - the closure note.
   * @returns the task id closed, or undefined when nothing matched or the call failed.
   */
  const completeCellTask = async (
    exec: DshToolExec,
    teamId: string,
    predicate: (row: Record<string, unknown>) => boolean,
    note: string,
  ): Promise<string | undefined> => {
    /** The live record. */
    const record = recordOf(teams(), dsh.workspaceRoot(exec), teamId)
    /** The first non-terminal task matching the predicate. */
    const row = boardTasksOf(record).find((candidate) => predicate(candidate) && candidate.status !== "completed" && candidate.status !== "failed" && candidate.status !== "cancelled")
    if (row === undefined) return undefined
    /** The board id. */
    const taskId = String(row.id ?? "")
    if (taskId === "") return undefined
    /** The completion call, run under the caller's own identity (the task's owner). */
    const result = await dsh.executeTool({ name: "agent_teams_task", arguments: { action: "complete", task_id: taskId, note }, agent: exec.agent })
    return result.ok ? taskId : undefined
  }

  // ── cellwork_requirements ────────────────────────────────────────────────
  disposers.push(dsh.registerTool({
    name: "cellwork_requirements",
    description: "The PLANNER's tool (cell-planner only): `finalize` the agreed requirements document or `update` it. Validates the six required sections (goal, non-goals, users/consumers, constraints, acceptance criteria, open questions). `finalize` refuses an incomplete document and completes the requirements task; `update` bumps the revision and marks the current split STALE.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["finalize", "update"], description: "finalize the agreed document, or update it (bumps the revision, marks the split stale)." },
        content: { type: "string", description: "The full markdown document. Omit to validate the file already at <cell>/requirements.md." },
      },
      required: ["action"],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          error: { type: "string" },
          path: { type: "string" },
          action: { type: "string" },
          revision: { type: "number" },
          splitStale: { type: "boolean" },
          alreadyFinalized: { type: "boolean" },
          missing: { type: "array", items: { type: "string" } },
          sections: { type: "array", items: { type: "object" } },
          requirementsPath: { type: "string" },
          splitTaskId: { type: "string" },
          splitTaskStatus: { type: "string" },
          redispatchable: { type: "boolean" },
          replacementSplitTaskId: { type: "string" },
          closedTaskId: { type: "string" },
        },
        required: ["ok"],
      },
      render: (_args: unknown, value: unknown): unknown => {
        /** The result as a record. */
        const result = typeof value === "object" && value !== null ? value as Record<string, unknown> : {}
        if (result.ok === false) return text("cellwork_requirements refused: " + String(result.error ?? "unknown refusal") + (Array.isArray(result.missing) && result.missing.length > 0 ? "\nmissing sections: " + result.missing.join(", ") : ""))
        return text("requirements " + String(result.action ?? "") + ": revision " + String(result.revision ?? "?") + (result.alreadyFinalized === true ? " (already finalized)" : "") + (result.splitStale === true ? " — the accepted split is STALE and must be re-submitted" : "") + (typeof result.closedTaskId === "string" ? " · requirements task " + result.closedTaskId + " completed" : ""))
      },
    },
    execute: async (args: unknown, exec: DshToolExec): Promise<FlowResult> => {
      /** The argument record. */
      const argv = readArgs(args)
      /** The requested action. */
      const action = argString(argv, "action")
      /** The caller's context. */
      const caller = callerFor(exec)
      if (caller.refusal !== null) return { ok: false, error: refusalText(caller.refusal), path: caller.refusal.path }
      if (caller.workspace === "" || caller.cell === null) return { ok: false, error: "cellwork_requirements: no active cell in this workspace — the tool is only callable inside a running cell" }
      /** The active cell's record. */
      const state = caller.cell
      if (state.phase === "stopped") return { ok: false, error: "cellwork_requirements: cell " + state.cellId + " is stopped and archived" }
      if (caller.member !== PLANNER_MEMBER) {
        return { ok: false, error: "cellwork_requirements is PLANNER-ONLY: this session is " + JSON.stringify(caller.member === "" ? "not a cell member" : caller.member) + ". The captain authors nothing (clause 1); the planner writes and finalizes the document, and the captain relays the user's answers." }
      }
      if (action !== "finalize" && action !== "update") return { ok: false, error: "cellwork_requirements: action must be `finalize` or `update` (got " + JSON.stringify(action) + ")" }
      /** The document text the call carries, or the file's current text. */
      let text_: string | null = null
      /** The supplied content, when the caller passed one. */
      const content = argString(argv, "content")
      if (content.trim() !== "") text_ = content
      else {
        try {
          text_ = readRequirements(caller.workspace, state.cellId)
        } catch (error) {
          return { ok: false, error: "cellwork_requirements: the requirements document could not be read (" + (error instanceof Error ? error.message : String(error)) + ")" }
        }
      }
      if (text_ === null || text_.trim() === "") {
        return { ok: false, error: "cellwork_requirements: no document to validate — write `requirements.md` under " + requirementsPath(caller.workspace, state.cellId) + " or pass `content`" }
      }
      /** The section validation. */
      const validation = validateRequirementsText(text_)
      /** The absolute document path. */
      const path = requirementsPath(caller.workspace, state.cellId)
      /** The instant this decision is stamped with. */
      const now = new Date()
      if (!validation.ok) {
        appendJournal(caller.workspace, state.cellId, { event: "requirements-refused", action, missing: validation.missing }, now)
        return { ok: false, error: "cellwork_requirements: the document is INCOMPLETE — these sections are missing or empty: " + validation.missing.join(", ") + ". Ask the user, fill them, and call again.", missing: [...validation.missing], sections: validation.sections, requirementsPath: path }
      }
      if (action === "finalize") {
        // A finalize over an already-accepted revision is idempotent ONLY when the bytes match. A changed
        // document must go through `update`, because update is what moves the revision and marks a live
        // split stale — the planner cannot silently change scope under an activated split.
        if (state.requirementsRevision > 0) {
          /** The accepted document as it stands. */
          const accepted = ((): string => {
            try { return readRequirements(caller.workspace, state.cellId) ?? "" } catch { return "" }
          })()
          if (accepted === storedRequirementsText(text_)) {
            return { ok: true, action, revision: state.requirementsRevision, splitStale: state.splitStale, alreadyFinalized: true, sections: validation.sections, requirementsPath: path }
          }
          return { ok: false, error: "cellwork_requirements: revision " + String(state.requirementsRevision) + " is already accepted and the document CHANGED — use {action:\"update\"} to revise it (an accepted revision is never rewritten in place)" }
        }
        writeRequirements(caller.workspace, state.cellId, text_)
        /** The requirements task this finalize closes, when the board still holds it open. */
        const closed = await completeCellTask(exec, state.teamId, (row) => String(row.kind ?? "") === "requirement" && String(row.owner ?? "") === PLANNER_MEMBER, "requirements revision 1 finalized")
        /** The record after the transition. */
        const next: CellState = { ...state, requirementsRevision: 1, phase: state.phase === "requirements" ? "split" : state.phase }
        transition(caller.workspace, next, { event: "requirements-finalize", revision: 1, sections: validation.sections.map((section) => section.key), closedTaskId: closed ?? null }, now)
        return { ok: true, action, revision: 1, splitStale: next.splitStale, alreadyFinalized: false, sections: validation.sections, requirementsPath: path, ...(closed === undefined ? {} : { closedTaskId: closed }) }
      }
      // UPDATE: a new revision, any accepted split is now stale, and the SAME split task is re-dispatched.
      writeRequirements(caller.workspace, state.cellId, text_)
      /** The new revision: one past the accepted one, or the first revision. */
      const revision = Math.max(1, state.requirementsRevision) + 1
      /** The live board, read to find the splitter's task. */
      const record = recordOf(teams(), caller.workspace, state.teamId)
      /** The splitter's task, in whichever spelling the board stored the owner. */
      const splitTask = boardTasksOf(record).find((row) => roleKeyOfOwner(row) === SPLITTER_MEMBER && String(row.status ?? "") !== "cancelled") ?? boardTasksOf(record).find((row) => roleKeyOfOwner(row) === SPLITTER_MEMBER)
      /** The board id of that task, when one exists. */
      const splitTaskId = splitTask === undefined ? "" : String(splitTask.id ?? "")
      /** The status that task is in, so the caller can see whether the row is still dispatchable. */
      const splitTaskStatus = splitTask === undefined ? "" : String(splitTask.status ?? "")
      /** Whether the row can still be dispatched (a terminal row cannot be reopened on this board). */
      const redispatchable = splitTaskStatus === "pending" || splitTaskStatus === "claimed" || splitTaskStatus === "in_progress"
      // A TERMINAL SPLIT ROW CANNOT BE REOPENED, and after the first activation it always is one (the
      // activation closes it). The re-split path therefore APPENDS a replacement splitter row — same
      // owner, same cell role, the new revision in its subject — rather than duplicating the graph: the
      // splitter needs one open row to claim, exactly as it had on the first pass.
      /** The replacement row this update appended, when the original row was terminal. */
      let replacementSplitTaskId = ""
      if (!redispatchable && state.teamId !== "") {
        /** The append onto the LIVE team (spawns nobody; the splitter already exists). */
        const appended = await dsh.executeTool({
          name: "agent_teams_plan",
          arguments: {
            action: "create_task",
            task: {
              subject: "Re-split for requirements revision " + String(revision),
              description: "The requirements document moved to revision " + String(revision) + ". Re-read `<cell>/requirements.md` and `cellwork_status`, then submit ONE measured graph against revision " + String(revision) + " with `cellwork_split {action:\"submit\"}`. Only NEW or CHANGED work needs a task: the activation reuses the board row of every key it keeps, and marks what you drop cancelled.",
              kind: "work",
              owner: SPLITTER_MEMBER,
              blocked_by: [],
            },
          },
          agent: exec.agent,
        })
        if (appended.ok) {
          /** The appended row's board id, when the answer carried one. */
          const row = typeof appended.value === "object" && appended.value !== null ? appended.value as Record<string, unknown> : {}
          /** The minted task, when the answer carried it. */
          const task = typeof row.task === "object" && row.task !== null ? row.task as Record<string, unknown> : undefined
          replacementSplitTaskId = typeof task?.id === "string" ? task.id : ""
        }
      }
      /** The record after the transition. */
      const next: CellState = { ...state, requirementsRevision: revision, splitStale: state.splitRevision !== null ? true : state.splitStale }
      transition(caller.workspace, next, { event: "requirements-update", revision, previousRevision: state.requirementsRevision, splitStale: next.splitStale, splitTaskId, splitTaskStatus, redispatchable, ...(replacementSplitTaskId === "" ? {} : { replacementSplitTaskId }) }, now)
      if (replacementSplitTaskId !== "") {
        appendJournal(caller.workspace, caller.cell.cellId, { event: "split-task-replaced", previousTaskId: splitTaskId, replacementTaskId: replacementSplitTaskId, revision }, now)
      }
      return {
        ok: true,
        action,
        revision,
        splitStale: next.splitStale,
        alreadyFinalized: false,
        sections: validation.sections,
        requirementsPath: path,
        splitTaskId,
        splitTaskStatus,
        redispatchable,
        replacementSplitTaskId,
        ...(splitTaskId === "" ? { message: "no split task is on the board yet — the splitter will receive the whole graph when it is dispatched" } : redispatchable
          ? { message: "the SAME split task " + splitTaskId + " is re-dispatched with revision " + String(revision) + (next.splitStale ? " and the split marked STALE" : "") + " — dispatch it with `cellwork_dispatch`" }
          : { message: "split task " + splitTaskId + " is " + splitTaskStatus + " and this board has no reopen verb, so a replacement row " + (replacementSplitTaskId === "" ? "could NOT be appended (no live team to append to)" : replacementSplitTaskId) + " carries the re-split with revision " + String(revision) + " — dispatch it with `cellwork_dispatch`" }),
      }
    },
  }))

  // ── cellwork_recon ───────────────────────────────────────────────────────
  disposers.push(dsh.registerTool({
    name: "cellwork_recon",
    description: "PLANNER/SUBCAPTAIN only: raise ONE read-only consult (label exactly `Explorer` or `Researcher`) through the adapter's direct one-shot start path, with an explicit absolute maxDepth so the consult is a leaf. The report is returned and journaled in the cell. A composition without the child-persona seam degrades to prose read-only and says so (`personaInjected:false`).",
    parameters: {
      type: "object",
      properties: {
        role: { type: "string", enum: ["Explorer", "Researcher"], description: "The read-only roster role; the label is applied verbatim so the child-persona seam applies the deny list." },
        task: { type: "string", description: "The one question the consult must answer." },
      },
      required: ["role", "task"],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          error: { type: "string" },
          path: { type: "string" },
          role: { type: "string" },
          label: { type: "string" },
          report: { type: "string" },
          stopReason: { oneOf: [{ type: "string" }, { type: "null" }] },
          personaInjected: { type: "boolean" },
        },
        required: ["ok"],
      },
      render: (_args: unknown, value: unknown): unknown => {
        /** The result as a record. */
        const result = typeof value === "object" && value !== null ? value as Record<string, unknown> : {}
        if (result.ok === false) return text("cellwork_recon refused: " + String(result.error ?? "unknown refusal"))
        return text(String(result.label ?? "consult") + " report (" + String(result.report ?? "").length + " chars" + (result.personaInjected === true ? ", persona injected" : ", NO persona seam") + "):\n\n" + String(result.report ?? ""))
      },
    },
    execute: async (args: unknown, exec: DshToolExec): Promise<FlowResult> => {
      /** The argument record. */
      const argv = readArgs(args)
      /** The caller's context. */
      const caller = callerFor(exec)
      if (caller.refusal !== null) return { ok: false, error: refusalText(caller.refusal), path: caller.refusal.path }
      if (caller.workspace === "" || caller.cell === null) {
        // A STOPPED cell is refused BY NAME: resolution skips it (it is no longer active), but the
        // contract refuses reconnaissance after the mode ends, and "no active cell" would hide why.
        /** The cell ids this workspace still holds, newest last. */
        const ids = listCellIds(caller.workspace)
        for (const id of ids) {
          /** That cell's record, when it can be read. */
          const read = readCell(caller.workspace, id)
          if (read.ok && read.state.phase === "stopped") return { ok: false, error: "cellwork_recon: cell " + id + " is stopped and archived — reconnaissance is refused after the mode ends" }
        }
        return { ok: false, error: "cellwork_recon: no active cell in this workspace" }
      }
      /** The consult outcome. */
      const result = await runRecon({
        spawn: (spec) => dsh.spawnAgent(spec).then((answer) => ({ output: answer.output, stopReason: answer.stopReason })),
        workspace: caller.workspace,
        cell: caller.cell,
        parent: exec.agent,
        caller: { member: caller.member, mode: caller.seat?.mode ?? "member" },
        config,
        personaFor,
        now: new Date(),
      }, { role: argString(argv, "role"), task: argString(argv, "task") })
      return result.ok ? { ...result } : { ok: false, error: result.error }
    },
  }))

  // ── cellwork_split ───────────────────────────────────────────────────────
  disposers.push(dsh.registerTool({
    name: "cellwork_split",
    description: "The SPLITTER's tool (cell-splitter only) for `submit`; any cell seat may `show` the last verdict. `submit` MEASURES every task (declared input bytes → tokens, the model-read context window) and validates the graph (dependency answer, acyclicity, write-scope ordering, verifier ≠ writer, role existence), accepting or refusing with a per-task breakdown; a refused split may be resubmitted.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["submit", "show"], description: "submit a graph, or show the last measured verdict." },
        revision: { type: "number", description: "submit: the requirements revision the graph targets; defaults to the accepted one." },
        tasks: {
          type: "array",
          items: {
            type: "object",
            properties: {
              key: { type: "string", description: "Stable task key; also the contract file name." },
              subject: { type: "string", description: "One-line title." },
              description: { type: "string", description: "The owner's acceptance text." },
              kind: { type: "string", enum: ["requirement", "work", "review", "repair", "integration"], description: "Chain kind; omitted means work." },
              ownerRole: { type: "string", description: "A roster role name or a cell role." },
              writeScopes: { type: "array", items: { type: "string" }, description: "Paths the task may write." },
              blockedBy: { type: "array", items: { type: "string" }, description: "Task keys that must close first; [] is an explicit root." },
              independent: { type: "boolean", description: "Explicit root, alternative to blockedBy: []." },
              inputs: { type: "array", items: { type: "string" }, description: "Workspace-relative paths the plugin MEASURES." },
              verify: { type: "boolean", description: "true when this task's work needs exactly one review task." },
            },
            required: ["key", "subject", "description", "ownerRole"],
            additionalProperties: false,
          },
        },
      },
      required: ["action"],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          error: { type: "string" },
          path: { type: "string" },
          action: { type: "string" },
          accepted: { type: "boolean" },
          revision: { type: "number" },
          findings: { type: "array", items: { type: "object" } },
          roles: { type: "array", items: { type: "object" } },
          tasks: { type: "array", items: { type: "object" } },
          totals: { type: "object" },
          splitPath: { type: "string" },
          supersededRevision: { oneOf: [{ type: "number" }, { type: "null" }] },
          message: { type: "string" },
        },
        required: ["ok"],
      },
      render: (_args: unknown, value: unknown): unknown => {
        /** The result as a record. */
        const result = typeof value === "object" && value !== null ? value as Record<string, unknown> : {}
        if (result.ok === false) return text("cellwork_split refused: " + String(result.error ?? "unknown refusal"))
        if (typeof result.message === "string") return text(result.message)
        return text("split revision " + String(result.revision ?? "?") + ": " + (result.accepted === true ? "ACCEPTED" : "REFUSED") + (result.accepted === true ? "" : " — the per-task breakdown is at " + String(result.splitPath ?? "?")) + "\n" + JSON.stringify(result.totals ?? {}, null, 2))
      },
    },
    execute: async (args: unknown, exec: DshToolExec): Promise<FlowResult> => {
      /** The argument record. */
      const argv = readArgs(args)
      /** The requested action. */
      const action = argString(argv, "action")
      /** The caller's context. */
      const caller = callerFor(exec)
      if (caller.refusal !== null) return { ok: false, error: refusalText(caller.refusal), path: caller.refusal.path }
      if (caller.workspace === "" || caller.cell === null) return { ok: false, error: "cellwork_split: no active cell in this workspace" }
      /** The active cell's record. */
      const state = caller.cell
      if (state.phase === "stopped") return { ok: false, error: "cellwork_split: cell " + state.cellId + " is stopped and archived" }
      if (action === "show") {
        /** The latest stored verdict. */
        const latest = latestSplit(caller.workspace, state.cellId)
        if (latest === null) return { ok: false, error: "cellwork_split show: no split has been submitted for " + state.cellId + " yet" }
        /** The stored read, narrowed once so the union's branches stay apart. */
        const read = latest.read
        if (!read.ok) return { ok: false, error: "cellwork_split show: " + read.detail, path: read.path }
        /** The stored verdict. */
        const verdict = read.verdict
        return { ok: true, action, accepted: verdict.accepted, revision: verdict.revision, findings: verdict.findings, roles: verdict.roles, tasks: verdict.tasks, totals: verdict.totals, splitPath: splitPathFor(caller.workspace, verdict) }
      }
      if (action !== "submit") return { ok: false, error: "cellwork_split: action must be `submit` or `show` (got " + JSON.stringify(action) + ")" }
      if (caller.member !== SPLITTER_MEMBER) {
        return { ok: false, error: "cellwork_split submit is SPLITTER-ONLY: this session is " + JSON.stringify(caller.member === "" ? "not a cell member" : caller.member) + ". The split is requirement reasoning (clause 1) and belongs to cell-splitter, not the captain." }
      }
      if (state.requirementsRevision === 0) return { ok: false, error: "cellwork_split: the requirements document has not been FINALIZED yet (revision 0) — wait for the planner to close the interview and the captain to dispatch you" }
      /** The revision this submission targets. */
      const asked = typeof argv.revision === "number" ? argv.revision : state.requirementsRevision
      if (asked !== state.requirementsRevision) {
        return { ok: false, error: "cellwork_split: revision " + String(asked) + " does not match the accepted requirements revision " + String(state.requirementsRevision) + " — a split is judged against the document it targets; re-read `cellwork_status` and resubmit against revision " + String(state.requirementsRevision) }
      }
      /** The raw task list. */
      const rawTasks = Array.isArray(argv.tasks) ? argv.tasks : []
      if (rawTasks.length === 0) return { ok: false, error: "cellwork_split: `tasks` is empty — submit the graph the planner's requirements justify" }
      /** The roster names the graph is validated against. */
      const roster = rosterNames()
      if (roster.length === 0) return { ok: false, error: "cellwork_split: the roster service (`mpdRoles`) is absent or empty in this composition, so owner roles cannot be validated — mount the roles row and resubmit" }
      /** The normalised submission. */
      const submission: SplitSubmission = {
        revision: asked,
        tasks: rawTasks.map((entry): SplitTaskInput => {
          /** The row as a record. */
          const row = readArgs(entry)
          return {
            key: argString(row, "key"),
            subject: argString(row, "subject"),
            description: argString(row, "description"),
            ...(argString(row, "kind") === "" ? {} : { kind: argString(row, "kind") }),
            ownerRole: argString(row, "ownerRole"),
            writeScopes: stringList(row.writeScopes),
            blockedBy: Array.isArray(row.blockedBy) ? stringList(row.blockedBy) : (row.independent === true ? [] : undefined),
            independent: row.independent === true,
            inputs: stringList(row.inputs),
            verify: row.verify === true,
          }
        }),
      }
      /** The measured verdict (already persisted to split/<revision>.json). */
      const verdict: SplitVerdict = await submitSplit({ workspace: caller.workspace, cellId: state.cellId, config, roster, window: windowFor, now: new Date() }, submission)
      /** The verdict path for the render/report, read from the verdict (a refusal may sit beside the canonical file). */
      const splitPath = splitPathFor(caller.workspace, verdict)
      if (verdict.accepted) {
        // THE SPLIT TASK STAYS OPEN (Amendment 5, arm a): it is the vehicle a requirements `update`
        // re-dispatches with the new revision, and it is closed by `cellwork_activate` once the work is
        // materialised. Closing it here would leave a re-split with no same-task row to reopen.
        /** The revision this one supersedes, when an accepted split already existed and differs. */
        const supersededRevision = state.splitRevision !== null && state.splitRevision !== verdict.revision ? state.splitRevision : null
        transition(caller.workspace, { ...state, splitRevision: verdict.revision, splitStale: false }, { event: "split-accepted", revision: verdict.revision, totals: verdict.totals, ...(supersededRevision === null ? {} : { supersededRevision }) }, new Date())
        if (supersededRevision !== null) {
          // The PREVIOUS accepted revision is superseded, recorded where a reader of the history finds it.
          appendJournal(caller.workspace, state.cellId, { event: "split-superseded", revision: supersededRevision, by: verdict.revision, activated: state.activatedRevision }, new Date())
        }
        return { ok: true, action, accepted: true, revision: verdict.revision, findings: verdict.findings, roles: verdict.roles, tasks: verdict.tasks, totals: verdict.totals, splitPath, supersededRevision, message: "split revision " + String(verdict.revision) + " ACCEPTED" + (supersededRevision === null ? "" : " (revision " + String(supersededRevision) + " is superseded)") + " — the captain may call `cellwork_activate`" }
      }
      appendJournal(caller.workspace, state.cellId, { event: "split-refused", revision: verdict.revision, findings: verdict.findings.length, refused: verdict.totals.refusedCount }, new Date())
      return { ok: true, action, accepted: false, revision: verdict.revision, findings: verdict.findings, roles: verdict.roles, tasks: verdict.tasks, totals: verdict.totals, splitPath }
    },
  }))

  // ── cellwork_activate ────────────────────────────────────────────────────
  disposers.push(dsh.registerTool({
    name: "cellwork_activate",
    description: "CAPTAIN only: materialise an ACCEPTED split on the LIVE team record. Requires an accepted split of the CURRENT requirements revision (a stale split is refused unless its revision is passed explicitly). Writes one frozen contract per NEW code task, raises each owner role as a member (persona TEXT in the prompt), appends each NEW task with reviews blocked by their work task, opens one verify loop per NEW code task BEFORE dispatch, then dispatches owner-only. A NEWER revision APPENDS to the same team: kept work reuses its board row, added work is appended, dropped work is marked `cancelled` and never deleted. It never re-creates the team.",
    parameters: {
      type: "object",
      properties: {
        revision: { type: "number", description: "The accepted split revision to activate when the requirements moved on (explicitly acknowledges staleness)." },
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
          mode: { type: "string", description: "`initial` for the first materialisation, `resplit` when a newer revision appended to the same team." },
          revision: { type: "number" },
          contracts: { type: "array", items: { type: "string" } },
          membersRaised: { type: "array", items: { type: "string" } },
          tasks: { type: "array", items: { type: "object" } },
          kept: { type: "array", items: { type: "string" }, description: "Split keys whose live board row was reused (never duplicated)." },
          cancelled: { type: "array", items: { type: "object" }, description: "Work this revision dropped: `{key, boardId}`, marked cancelled on the cell record and never deleted." },
          loops: { type: "array", items: { type: "object" } },
          dispatch: { type: "object" },
        },
        required: ["ok"],
      },
      render: (_args: unknown, value: unknown): unknown => {
        /** The result as a record. */
        const result = typeof value === "object" && value !== null ? value as Record<string, unknown> : {}
        if (result.ok === false) return text("cellwork_activate refused: " + String(result.error ?? "unknown refusal"))
        /** The dispatch block. */
        const dispatch = typeof result.dispatch === "object" && result.dispatch !== null ? result.dispatch as Record<string, unknown> : {}
        /** The pairs actually delivered. */
        const pairs = Array.isArray(dispatch.pairs) ? dispatch.pairs as Array<Record<string, unknown>> : []
        /** The tasks left out. */
        const skipped = Array.isArray(dispatch.skipped) ? dispatch.skipped as Array<Record<string, unknown>> : []
        return text("cell activated on split revision " + String(result.revision ?? "?") + (result.mode === "resplit" ? " (re-split: " + String(Array.isArray(result.kept) ? result.kept.length : 0) + " kept, " + String(Array.isArray(result.cancelled) ? result.cancelled.length : 0) + " cancelled)" : "") + ": " + String(Array.isArray(result.tasks) ? result.tasks.length : 0) + " task(s), " + String(Array.isArray(result.loops) ? result.loops.length : 0) + " verify loop(s), " + pairs.length + " dispatched" + (skipped.length === 0 ? "" : ", " + skipped.length + " reported: " + skipped.map((row) => String(row.subject ?? row.taskId) + ": " + String(row.reason)).join("; ")))
      },
    },
    execute: async (args: unknown, exec: DshToolExec): Promise<FlowResult> => {
      /** The argument record. */
      const argv = readArgs(args)
      /** The caller's context. */
      const caller = callerFor(exec)
      if (caller.refusal !== null) return { ok: false, error: refusalText(caller.refusal), path: caller.refusal.path }
      if (caller.workspace === "" || caller.cell === null) return { ok: false, error: "cellwork_activate: no active cell in this workspace" }
      /** The active cell's record. */
      const state = caller.cell
      // THE PRODUCER MUST BE A LIVE SESSION (contract A4): the verify loops are opened under the caller's
      // OWN agent, so a dispatch carrying no live caller refuses BEFORE any write.
      if (sessionIdOf(exec.agent) === "") {
        return { ok: false, error: "cellwork_activate: this dispatch carries no LIVE caller agent (no session id), so the verify loops cannot be opened under a real session — nothing was materialised. Call this tool from a live agent session; a detached or synthetic handle is not accepted." }
      }
      if (caller.sessionId === "" || caller.sessionId !== state.captainSessionId) return { ok: false, error: "cellwork_activate is CAPTAIN-ONLY: the captain of " + state.cellId + " is session " + state.captainSessionId + ", which is not this caller" }
      if (state.phase === "stopped") return { ok: false, error: "cellwork_activate: cell " + state.cellId + " is stopped and archived" }
      if (state.teamId === "") return { ok: false, error: "cellwork_activate: no planning team is recorded on " + state.cellId + " — run `cellwork_start` first" }
      /** The accepted split revision, or the refusal when nothing was accepted. */
      const acceptedRevision = state.splitRevision
      if (acceptedRevision === null) return { ok: false, error: "cellwork_activate: no split has been ACCEPTED for this cell — the splitter must submit one first" }
      /** The revision the caller explicitly acknowledges, when one was passed. */
      const explicit = typeof argv.revision === "number" ? argv.revision : undefined
      /** Whether the accepted split no longer matches the requirements document. */
      const movedOn = state.splitStale || acceptedRevision !== state.requirementsRevision
      if (movedOn && explicit !== acceptedRevision) {
        return { ok: false, error: "cellwork_activate: split revision " + String(acceptedRevision) + " is STALE (requirements revision " + String(state.requirementsRevision) + (state.splitStale ? ", marked stale by an update" : "") + ") — the splitter must re-submit against the current revision; to activate the stale revision deliberately, pass {revision:" + String(acceptedRevision) + "}" }
      }
      if (state.activatedRevision !== null) {
        // A SECOND ACTIVATION IS THE RE-SPLIT PATH, and it is only ever FORWARD: the same revision is
        // already on the board (nothing to append), and an earlier one has been superseded.
        if (acceptedRevision === state.activatedRevision) {
          return { ok: false, error: "cellwork_activate: split revision " + String(state.activatedRevision) + " is already materialised on team " + state.teamId + " — nothing would be added. A re-split is a requirements `update` (which bumps the revision and marks the split stale), a NEW accepted split revision, then this call again" }
        }
        if (acceptedRevision < state.activatedRevision) {
          return { ok: false, error: "cellwork_activate: split revision " + String(acceptedRevision) + " is OLDER than the materialised revision " + String(state.activatedRevision) + " — revisions only move forward; accept a newer split instead" }
        }
      }
      // A PARTIAL ACTIVATION IS RESUMABLE WITH THE SAME REVISION (contract A3): `activatedRevision` is
      // still null, and `activationInFlight` names the revision a failed pass owns. A DIFFERENT revision
      // is refused, because appending a second materialisation would duplicate its board rows.
      if (state.activationInFlight !== null && state.activationInFlight !== undefined && state.activationInFlight !== acceptedRevision) {
        return { ok: false, error: "cellwork_activate: split revision " + String(state.activationInFlight) + " is IN FLIGHT (a previous activation of it failed part-way), so revision " + String(acceptedRevision) + " cannot be materialised now — resume revision " + String(state.activationInFlight) + " while it is still the accepted split, or stop the cell. Activating a different revision would duplicate its board rows." }
      }
      /** The stored verdict of the revision being activated (not "the latest": a stale one may be activated on purpose). */
      const stored = readSplit(caller.workspace, state.cellId, acceptedRevision)
      if (!stored.ok) return { ok: false, error: "cellwork_activate: " + stored.detail, path: stored.path }
      if (!stored.verdict.accepted) return { ok: false, error: "cellwork_activate: revision " + String(acceptedRevision) + " was REFUSED by the measured verdict — the splitter must fix the findings and resubmit" }
      /**
       * Persist one partial activation on the cell record (contract A2).
       *
       * The phase STAYS `split` and `activatedRevision` stays null: a partial pass must never look like a
       * materialised revision. `activationInFlight` is the one marker a retry may resume from.
       *
       * @param partial - the artifacts created so far.
       * @param error - the failure sentence, on the final write for a failed pass.
       */
      const persistPartial = (partial: ActivatePartial, error?: string): void => {
        /** The record after the partial checkpoint. */
        const next: CellState = {
          ...state,
          activationInFlight: acceptedRevision,
          members: { ...state.members, ...partial.members },
          activatedTasks: { ...state.activatedTasks, ...partial.boardIds },
          activatedLoops: { ...(state.activatedLoops ?? {}), ...partial.loopIds },
        }
        transition(caller.workspace, next, { event: "cell-activation-partial", revision: acceptedRevision, members: Object.keys(partial.members), tasks: partial.boardIds, loops: partial.loopIds, contracts: Object.values(partial.contracts), ...(error === undefined ? {} : { error }) }, new Date())
      }
      /** The materialisation. */
      const activated: ActivateResult = await materializeSplit({
        dsh: dsh as unknown as Parameters<typeof materializeSplit>[0]["dsh"],
        workspace: caller.workspace,
        cell: state,
        config,
        captainAgent: exec.agent,
        split: stored.verdict,
        personaFor,
        // BOUND TO THE CALLER'S WORKSPACE, resolved from THIS dispatch's exec: `dsh.workspaceRoot()`
        // without it falls back to `DSH_WORKSPACE_ROOT`/`process.cwd()`, and a host serving a session
        // whose workspace differs from the process cwd would read another tree's board (or none at all)
        // for the dispatch pass and for closing the open splitter row.
        recordFor: (teamId: string) => recordOf(teams(), caller.workspace, teamId),
        checkpoint: (partial: ActivatePartial): void => { persistPartial(partial) },
        now: new Date(),
      })
      if (!activated.ok) {
        // THE FAILURE IS ITSELF A RESUMABLE STATE: persist the FINAL partial (the last checkpoint may
        // predate an artifact the failure left behind) together with the sentence that stopped the pass.
        if (activated.partial !== undefined) persistPartial(activated.partial, activated.error)
        return { ok: false, error: activated.error }
      }
      /** The cancellations this activation recorded, keyed by split key for the cell record. */
      const cancelledNow: Record<string, string> = {}
      for (const entry of activated.outcome.cancelled) cancelledNow[entry.key] = entry.boardId
      // THE LOOP TABLE IS MERGED, NEVER REPLACED: a re-split keeps the loops an earlier revision armed,
      // while this pass's (and a resumed pass's) ids are recorded by split key.
      /** The verify-loop ids the cell records after this activation. */
      const loopTable: Record<string, string> = { ...(state.activatedLoops ?? {}) }
      for (const loop of activated.outcome.loops) loopTable[loop.taskKey] = loop.loopId
      /** The record after activation: the raised members, the live board mapping and the executing phase. */
      const next: CellState = {
        ...state,
        phase: "executing",
        activatedRevision: acceptedRevision,
        activationInFlight: null,
        activatedTasks: { ...activated.outcome.boardIds },
        activatedLoops: loopTable,
        cancelledTasks: { ...state.cancelledTasks, ...cancelledNow },
        splitStale: false,
        members: { ...state.members, ...activated.outcome.members },
      }
      transition(caller.workspace, next, { event: "cell-activation", mode: activated.outcome.mode, revision: acceptedRevision, tasks: activated.outcome.tasks.length, kept: activated.outcome.kept.length, cancelled: activated.outcome.cancelled.length, loops: activated.outcome.loops.length, reused: activated.outcome.reused }, new Date())
      return {
        ok: true,
        cellId: state.cellId,
        mode: activated.outcome.mode,
        revision: acceptedRevision,
        contracts: activated.outcome.contracts,
        membersRaised: Object.keys(activated.outcome.members),
        reused: activated.outcome.reused,
        tasks: activated.outcome.tasks,
        kept: activated.outcome.kept,
        cancelled: activated.outcome.cancelled,
        loops: activated.outcome.loops,
        dispatch: activated.outcome.dispatch,
      }
    },
  }))

  return disposers
}

/**
 * One harness content block holding text.
 *
 * @param value - the text.
 * @returns the content blocks array.
 */
function text(value: string): Array<{ type: "text"; text: string }> {
  return [{ type: "text", text: value }]
}
