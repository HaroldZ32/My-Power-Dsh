// THE `mpd-team` NATIVE PANEL: THE BOARD, ITS ROSTER, ONE TASK'S CONTRACT AND THE WATCHDOG.
//
// WHY A SECOND PANEL: the workbench panel answers "what is going on in this conversation" in four broad
// tabs; a team's board is a different reading surface with its own selected row, its own actions and its
// own budget. Contract D4 gives it its own panel id (`mpd-team`), and the manifest declares both.
//
// SELECTION IS PER SCOPE, NOT IN THE VIEW. A tap on a board row carries `{ id: "select", args: { task } }`
// — the protocol's documented row-action form — and this module records the id for that scope, then asks
// the app to re-fetch. The Detail tab is therefore built from the CURRENT selection on every build, which
// is the only way a row tap can change a tab's content: a view tree's node list is fixed once built.
//
// EVERY HANDLER ANSWERS AN EFFECT AND NEVER THROWS. A missing service, a missing conversation and a
// refusal all become a toast; `complete`/`fail` and the watchdog verbs are driven through the tool
// runtime (the SAME tools a person would call), so their own refusal sentence reaches the toast verbatim
// instead of being guessed at here.
import { rowLogLine } from "../../mpd-dsh-adapter-plugin/src/index"
import type { DshGoCaps, DshGoView } from "../../mpd-dsh-adapter-plugin/src/dshgo-view"
import { DSHGO_POLL_MS, type PanelBridge, type PanelEffect, type PanelReply, type PanelServices } from "./dshgo-panel"
import { buildTeamView, type TeamPanelMember, type TeamPanelSnapshot, type TeamPanelTask, type TeamWatchdogSnapshot } from "./dshgo-views"

/** The panel id the manifest declares for the team board; the live registration MUST use the same id. */
export const DSHGO_TEAM_PANEL_ID = "mpd-team"

/** The strip id the manifest declares; one live line, refreshed by the same 2 s poll. */
export const DSHGO_STRIP_ID = "mpd-status"

/** How many board rows the panel draws: the app's own list/table ceiling. */
export const TEAM_MAX_ROWS = 50

/** The one fragment of a task's acceptance text the detail tab prints before clipping. */
const MAX_DESCRIPTION_CHARS = 600

/** The structural face of the `mpdTeams` service, read exactly like the workbench panel reads it. */
interface TeamFace {
  /** The team bound to one Lead session, or undefined when that session has none. */
  active?: (workspace: string, sessionId?: string) => unknown
}

/** The structural face of the `mpdWatchdog` service: the hold registry the dispatch gates consult. */
interface WatchdogFace {
  /** Whether one team is held, with the record's own fields. */
  isHeld?: (teamId: string, workspace?: string) => unknown
}

/** The structural face of the tool runtime, used ONLY to drive the two documented tool families. */
interface ToolFace {
  /** Call one registered tool in-process. */
  executeTool?: (input: { name: string; arguments?: unknown }) => Promise<unknown>
}

/** The read-only watchdog diagnostic whose value carries the predicate, the holds and the incidents. */
const STATUS_TOOL = "session-watchdog-status"

/** The model the team panel PUSHES: the counters and roster its bindings read, and nothing else. */
export interface TeamPushModel {
  /** The board's identity, so a bind can print the team's name. */
  team: { readonly id: string; readonly name: string; readonly status: string; readonly phase: string } | null
  /** The derived counters the hero tiles bind. */
  counts: TeamPanelSnapshot["counts"]
  /** The roster, which the members tab binds a count against. */
  members: readonly TeamPanelMember[]
  /** The board rows, so a future bound list has a path to read. */
  tasks: readonly TeamPanelTask[]
}

/** What the registration needs beyond the workbench panel's options: the selected-row store. */
export interface TeamPanelOptions {
  /** The adapter's DSH Go seam, plus the tool runtime when the composition exposes one. */
  dsh: PanelBridge
  /** The row context, read only through `get(name, false)`. */
  ctx: PanelServices
  /** Resolve a session's workspace root when the bridge cannot answer it. */
  workspace?: (sessionId: string) => string | undefined
  /** The diagnostic sink; the default is this row's own log file. */
  log?: (line: string) => void
  /** The poll period, defaulting to {@link DSHGO_POLL_MS}. */
  pollMs?: number
}

/** The per-scope SELECTED board row, which is what the Detail tab renders. */
export interface TeamSelectionStore {
  /** The selected task id for one scope, or an empty string when nothing is selected. */
  get: (scope: unknown) => string
  /** Record one task id for a scope; an empty string clears the selection. */
  set: (scope: unknown, taskId: string) => void
}

/** One scope's key: its session id, so two panels on two conversations never share a selection. */
function scopeKeyOf(scope: unknown): string {
  /** The scope read as a plain object. */
  const record = typeof scope === "object" && scope !== null ? (scope as Record<string, unknown>) : undefined
  /** The session id the bridge put on the scope. */
  const sessionId = record === undefined ? undefined : record.sessionId
  return typeof sessionId === "string" ? sessionId : ""
}

/** Read one string field from an unknown value, answering `""` for anything else. */
function stringOf(value: unknown): string {
  return typeof value === "string" ? value : ""
}

/** Read one array field, answering `[]` for anything else. */
function arrayOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

/** Narrow an unknown to a plain record. */
function recordOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined
}

/** Clip one line to a character budget and flatten its whitespace. */
function clip(value: string, max: number): string {
  /** The flattened line the cap applies to. */
  const flat = value.replace(/\s+/g, " ").trim()
  return flat.length <= max ? flat : flat.slice(0, max)
}

/** Run a probe, answering `fallback` when it throws. */
function probe<T>(read: () => T, fallback: T): T {
  try {
    return read()
  } catch {
    return fallback
  }
}

/**
 * Project one board row onto the panel's task shape.
 * @param value - the record's task row, read structurally.
 * @returns the narrowed task the board and detail tabs render.
 */
function taskOf(value: unknown): TeamPanelTask {
  /** The row as a record, or an empty one when the record is malformed. */
  const task = recordOf(value) ?? {}
  return {
    id: stringOf(task.id),
    subject: clip(stringOf(task.subject), 120),
    owner: clip(stringOf(task.owner), 60),
    status: clip(stringOf(task.status), 40),
    kind: clip(stringOf(task.kind), 40),
    blockedBy: arrayOf(task.blockedBy).length,
    description: clip(stringOf(task.description) || stringOf(task.acceptance), MAX_DESCRIPTION_CHARS),
    dependencies: arrayOf(task.blockedBy).map((id) => stringOf(id)).filter((id) => id !== "").join(", "),
    verdict: clip(stringOf(recordOf(task.verdict)?.verdict) || stringOf(task.verdict), 40),
  }
}

/**
 * Project one member row onto the panel's member shape.
 * @param value - the record's member row, read structurally.
 * @returns the narrowed member the members tab renders.
 */
function memberOf(value: unknown): TeamPanelMember {
  /** The row as a record, or an empty one when malformed. */
  const member = recordOf(value) ?? {}
  return {
    name: clip(stringOf(member.name), 60),
    mode: clip(stringOf(member.mode) || stringOf(member.status) || "idle", 40),
    handoff: clip(stringOf(member.handoff) || stringOf(member.handoffState), 40),
  }
}

/**
 * The counters the board hero reads.
 * @param tasks - the projection of every board row.
 * @returns the five derived counters with `completion` as a whole percentage.
 */
function countsOf(tasks: readonly TeamPanelTask[]): TeamPanelSnapshot["counts"] {
  /** Rows in a terminal status. */
  const done = tasks.filter((task) => task.status === "completed" || task.status === "cancelled" || task.status === "failed").length
  /** Rows in flight. */
  const active = tasks.filter((task) => task.status === "in_progress").length
  /** Rows that name at least one blocker. */
  const blocked = tasks.filter((task) => task.blockedBy > 0).length
  return { total: tasks.length, done, active, blocked, completion: tasks.length === 0 ? 0 : Math.round((done / tasks.length) * 100) }
}

/**
 * Read the team panel's data model: what the push emits and what the view's bindings reference.
 * @param services - the row context the two services are resolved from.
 * @param workspace - the absolute workspace root, or undefined when it could not be resolved.
 * @param sessionId - the live session the panel is attached to.
 * @returns the snapshot, with an empty board when nothing could be read.
 */
export function readTeamSnapshot(services: PanelServices, workspace: string | undefined, sessionId: string): TeamPanelSnapshot {
  /** The snapshot a conversation-less or team-less panel renders. */
  const empty: TeamPanelSnapshot = { team: null, tasks: [], counts: { total: 0, done: 0, active: 0, blocked: 0, completion: 0 }, members: [], selected: null, watchdog: { predicate: "unknown", held: false, reason: "", taskId: "", incidents: [] } }
  if (workspace === undefined || workspace === "" || sessionId === "") return empty
  /** The team service, resolved per read so a late mount is honoured. */
  const face = probe(() => services.get?.("mpdTeams", false), undefined) as TeamFace | undefined
  if (face?.active === undefined) return empty
  /** The conversation's team record. */
  const record = recordOf(probe(() => face.active?.(workspace, sessionId), undefined))
  if (record === undefined) return empty
  /** Every board row, projected once and reused by the counters and the board tab. */
  const tasks = arrayOf(record.tasks).map(taskOf).slice(0, TEAM_MAX_ROWS)
  return {
    team: { id: stringOf(record.id) || stringOf(record.teamId), name: clip(stringOf(record.name) || "team", 60), status: clip(stringOf(record.status), 40), phase: clip(stringOf(record.phase), 40) },
    tasks,
    counts: countsOf(tasks),
    members: arrayOf(record.members).map(memberOf).slice(0, 6),
    selected: null,
    watchdog: empty.watchdog,
  }
}

/**
 * Read the watchdog's contribution to the panel.
 *
 * The STATUS tool is the only surface that carries the predicate AND the incidents; when it is not
 * mounted, the hold registry still answers the one boolean the tab needs. Both paths fail open.
 * @param services - the row context, read for the hold registry.
 * @param tools - the tool runtime, when the composition exposed one.
 * @param teamId - the team the tab is about.
 * @param workspace - the absolute workspace root.
 * @returns the watchdog half of the snapshot, never a throw.
 */
async function readWatchdog(services: PanelServices, tools: ToolFace | undefined, teamId: string, workspace: string): Promise<TeamWatchdogSnapshot> {
  /** The hold registry, when this composition mounts the watchdog row. */
  const registry = probe(() => services.get?.("mpdWatchdog", false), undefined) as WatchdogFace | undefined
  /** The registry's answer for this team, read structurally. */
  const hold = recordOf(probe(() => registry?.isHeld?.(teamId, workspace), undefined))
  /** The status value, when the tool runtime answered it. */
  const status = tools?.executeTool === undefined ? undefined : await probe(() => tools.executeTool?.({ name: STATUS_TOOL, arguments: {} }) as Promise<unknown>, undefined)
  /** The status value as a record. */
  const record = recordOf(status)
  /** The status row for THIS team, when the store knows it. */
  const row = record === undefined ? undefined : arrayOf(record.teams).map((entry) => recordOf(entry)).find((entry) => entry !== undefined && (stringOf(entry.teamId) === teamId || entry.teamId === undefined))
  /** The predicate the engine published, or the documented default when it published none. */
  const predicate = clip(stringOf(recordOf(record?.predicate)?.source) || "channel", 20)
  /** The incidents, newest first, clipped to the tab's five rows. */
  const incidents = arrayOf(record?.incidents)
    .map((entry) => recordOf(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== undefined)
    .slice(0, 5)
    .map((entry) => ({ at: clip(stringOf(entry.ts) || stringOf(entry.at), 24), kind: clip(stringOf(entry.kind) || "incident", 30), detail: clip(stringOf(entry.detail) || stringOf(entry.reason), 80) }))
  return {
    predicate,
    held: hold?.held === true || row?.held === true,
    reason: clip(stringOf(hold?.reason) || stringOf(hold?.cause), 60),
    taskId: clip(stringOf(hold?.taskId), 20),
    incidents,
  }
}

/**
 * Build the team panel's view for one scope: the live read, the selection and the watchdog status.
 * @param services - the row context.
 * @param tools - the tool runtime, when available.
 * @param workspaceOf - resolve a session's workspace root.
 * @param selection - the per-scope selected-row store.
 * @param scope - the invocation scope.
 * @param caps - what the app can draw.
 * @returns the complete view tree, v2 or its v1 fallback.
 */
export async function buildTeamPanelFor(services: PanelServices, tools: ToolFace | undefined, workspaceOf: (sessionId: string) => string | undefined, selection: TeamSelectionStore, scope: unknown, caps?: DshGoCaps | null): Promise<DshGoView> {
  /** The session this panel is attached to. */
  const sessionId = scopeKeyOf(scope)
  /** The workspace the team lives in. */
  const workspace = workspaceOf(sessionId)
  /** The synchronous half of the model. */
  const snapshot = readTeamSnapshot(services, workspace, sessionId)
  /** The selected row: the recorded id, or the board's first in-flight row as the default. */
  const selectedId = selection.get(scope)
  /** The task the detail tab shows. */
  const selected = snapshot.tasks.find((task) => task.id === selectedId) ?? snapshot.tasks.find((task) => task.status === "in_progress") ?? snapshot.tasks[0] ?? null
  /** The watchdog half, read from the tool when it answered and the registry otherwise. */
  const watchdog = snapshot.team === null ? snapshot.watchdog : await readWatchdog(services, tools, snapshot.team.id, workspace ?? "")
  return buildTeamView({ ...snapshot, selected, watchdog }, caps)
}

/**
 * Build the tap handlers the team panel publishes.
 *
 * THREE HANDLERS, AND WHY THE MUTATIONS ARE GONE (repair T8/H1+M3). A panel tap is ANONYMOUS: this
 * module calls the tool runtime with no `agent`, so `agent_teams_task` sees the agentless sentinel
 * `"workspace"` and refuses every owned row — a `complete`/`fail` button here was a control that could
 * never succeed. The watchdog pair had the mirror-image defect: it could succeed, but the tool resolved
 * its workspace from `DSH_WORKSPACE_ROOT`/`cwd` instead of the panel's session, so a hold could land in a
 * DIFFERENT store while the toast said it worked. Both directions are closed the honest way: the panel
 * no longer offers a mutation it cannot address, and the two tabs say where the action does live. What
 * remains is genuinely addressable — selecting a row, clearing that selection, and re-fetching the view.
 * @param options - the bridge, the service registry and the failure sink.
 * @param selection - the per-scope selected-row store the Detail tab reads.
 * @returns the action map, keyed by the ids the view names.
 */
export function createTeamPanelActions(options: TeamPanelOptions, selection: TeamSelectionStore): Record<string, (scope: unknown, event: unknown) => Promise<PanelReply>> {
  /** The event's `args`, where a row action's `{ task }` travels. */
  const argsOf = (event: unknown): Record<string, unknown> => recordOf(recordOf(event)?.value) ?? {}
  /** Select one board row, then ask the app to rebuild the view so the Detail tab follows. */
  const select = async (scope: unknown, event: unknown): Promise<PanelReply> => {
    /** The task id the tapped row carried. */
    const taskId = stringOf(argsOf(event).task)
    if (taskId === "") return { toast: "That row is gone" }
    selection.set(scope, taskId)
    return { refresh: true }
  }
  /** Clear the selection, so the Detail tab falls back to the board's first in-flight row. */
  const back = async (scope: unknown): Promise<PanelReply> => {
    selection.set(scope, "")
    return { refresh: true }
  }
  /** The refresh handler: the protocol's own shorthand. */
  const refresh = async (): Promise<PanelReply> => ({ refresh: true })
  return { select, back, refresh }
}

/**
 * Publish `panel('mpd-team', …)` through the adapter, once, and only on a host that carries the bridge.
 * @param options - the bridge, the service registry and the injectable sinks.
 * @returns whether the apply-time attempt published the panel, plus the release for this module's work.
 */
export function registerDshGoTeamPanel(options: TeamPanelOptions): { registered: boolean; dispose: () => void } {
  /** The diagnostic sink: the row's file log unless a caller (a test) injects one. */
  const log = options.log ?? ((line: string): void => { rowLogLine("mpd-bundle", line) })
  /** The poll period this registration uses. */
  const pollMs = options.pollMs ?? DSHGO_POLL_MS
  /** Whether the panel is published; a second attempt after a success is a no-op. */
  let registered = false
  /** The last state this module announced, so one decision logs one token. */
  let announced: "" | "absent" | "panel" = ""
  /** The late-bind subscription's disposer, once one was installed. */
  let offBound: (() => void) | undefined
  /** The selected board row per scope, which is what the Detail tab renders. */
  const selections = new Map<string, string>()
  /** The selection store both the view and the actions read. */
  const selection: TeamSelectionStore = {
    get: (scope: unknown): string => selections.get(scopeKeyOf(scope)) ?? "",
    set: (scope: unknown, taskId: string): void => {
      if (taskId === "") selections.delete(scopeKeyOf(scope))
      else selections.set(scopeKeyOf(scope), taskId)
    },
  }
  /** Every interval this registration owns, so the release can clear all of them. */
  const timers = new Set<ReturnType<typeof setInterval>>()
  /** The serialized snapshot last emitted per scope, so an unchanged tick emits nothing. */
  const emitted = new Map<string, string>()
  /** The board signature last seen per scope, so only a REAL change refreshes the view. */
  const signatures = new Map<string, string>()
  /** Resolve the workspace one scope reads, from the bridge when it can and the injected seam otherwise. */
  const workspaceOf = (sessionId: string): string | undefined => {
    /** What the bridge's own lookup answered, when the seam is present. */
    const fromBridge = probe(() => (typeof options.dsh.workspaceRootForSession === "function" ? options.dsh.workspaceRootForSession(sessionId) : undefined), undefined)
    if (typeof fromBridge === "string" && fromBridge !== "") return fromBridge
    return probe(() => options.workspace?.(sessionId), undefined)
  }
  /** The push model one scope emits; the watchdog half rides only in the view, so the push stays sync. */
  const snapshotOf = (scope: unknown): TeamPushModel => {
    /** The session this scope addresses. */
    const sessionId = scopeKeyOf(scope)
    /** The team model with the selection applied. */
    const team = readTeamSnapshot(options.ctx, sessionId === "" ? undefined : workspaceOf(sessionId), sessionId)
    return { team: team.team, counts: team.counts, members: team.members, tasks: team.tasks }
  }
  /** The board `signature` a scope currently shows: ids and statuses, never the detail text. */
  const signatureOf = (snapshot: TeamPushModel): string => (snapshot.team === null ? "" : snapshot.team.id + "|" + String(snapshot.counts.done) + "/" + String(snapshot.counts.total))
  /** Push one snapshot when it differs from the last emitted one, and refresh the view on a board change. */
  const publishInto = (key: string, snapshot: TeamPushModel, send: ((value: TeamPushModel) => void) | undefined, seed: boolean): void => {
    /** The snapshot's serialized form, which is what "unchanged" is measured on. */
    const serialized = JSON.stringify(snapshot)
    if (seed || emitted.get(key) !== serialized) {
      emitted.set(key, serialized)
      probe(() => send?.(snapshot), undefined)
    }
    /** The board signature this tick shows. */
    const signature = signatureOf(snapshot)
    /** Whether this is a real change rather than the subscription's first reading. */
    const changed = !seed && signatures.has(key) && signatures.get(key) !== signature
    signatures.set(key, signature)
    if (changed) probe(() => options.dsh.dshGoRefresh(DSHGO_TEAM_PANEL_ID), undefined)
  }
  /** The `data` function: seed, poll, emit on change, refresh on a board change, cancel cleanly. */
  const data = (scope: unknown, emit: unknown): (() => void) => {
    /** The app's emit callback, when the bridge handed one. */
    const send = typeof emit === "function" ? (emit as (value: TeamPushModel) => void) : undefined
    /** The scope's state key. */
    const key = scopeKeyOf(scope)
    publishInto(key, snapshotOf(scope), send, true)
    /** The interval this subscription owns. */
    const timer = setInterval(() => { publishInto(key, snapshotOf(scope), send, false) }, pollMs)
    timers.add(timer)
    return (): void => {
      clearInterval(timer)
      timers.delete(timer)
      emitted.delete(key)
      signatures.delete(key)
    }
  }
  /** The view function: a live read per render, including the watchdog half. */
  const view = async (scope: unknown, caps: DshGoCaps): Promise<DshGoView> => buildTeamPanelFor(options.ctx, options.dsh as unknown as ToolFace, workspaceOf, selection, scope, caps)
  /** The panel definition the bridge receives. */
  const spec = { view, data, actions: createTeamPanelActions(options, selection) }
  /** Try to publish the panel; stay silent and wait for a bind when this host has no bridge. */
  const attempt = (): void => {
    if (registered) return
    /** Whether the bridge is bound right now. */
    const present = probe(() => options.dsh.dshGoPresent() === true, false)
    if (!present) {
      if (offBound === undefined) {
        offBound = probe(() => {
          /** The subscription's disposer, or a no-op when the runtime answered none. */
          const off = options.dsh.onServiceBound(["dshGo"], () => { attempt() })
          return typeof off === "function" ? off : (): void => {}
        }, (): void => {})
      }
      if (announced !== "absent") log("[mpd] dshGo=team-absent")
      announced = "absent"
      return
    }
    if (probe(() => options.dsh.dshGoPanel(DSHGO_TEAM_PANEL_ID, spec) === true, false)) {
      registered = true
      if (announced !== "panel") log("[mpd] dshGo=team-panel")
      announced = "panel"
      return
    }
    if (announced !== "absent") log("[mpd] dshGo=team-absent")
    announced = "absent"
  }
  attempt()
  return {
    registered,
    dispose: (): void => {
      for (const timer of timers) clearInterval(timer)
      timers.clear()
      emitted.clear()
      signatures.clear()
      selections.clear()
      probe(() => offBound?.(), undefined)
      offBound = undefined
    },
  }
}
