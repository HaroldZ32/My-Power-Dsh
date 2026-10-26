// Read-only projection of ONE team's workflow — the data behind the two TUI
// surfaces (`mpd-tui-team`, `mpd-tui-plan`).
//
// 0.1.7 REBASE, then the 2026-09-30 TEAM-PLANE SPLIT.
//
// TWO SOURCES, ONE SHAPE. The PRIMARY source is now the mpd-OWNED team record, read through the
// `mpdTeams` service (`<workspace>/.mpd/team/teams/<teamId>.json`, written by `mpd-team-core`),
// which carries the review fields the official board has no column for — `kind`, `attempt`,
// `round`, `verdict` — and which exists even in a composition where the official service cannot
// mount. The OFFICIAL live readout (`liveTeamViews` → `dsh.teamLiveTeams()`) is kept as a
// FALLBACK for a composition without the mpd team row.
//
// The fallback is not decoration, and the reason the record is primary is MEASURED: in a `dsh-tui`
// composition the official service cannot mount at all (`TeamService` registers its session
// projection through a ROOT-bound `ctx.root` proxy and the dsh-tui host refuses `root.effect` from
// a plugin activation), so this surface used to read nothing and render `(none in this workspace)`.
//
// What the official plane does not carry is still reported as ABSENT rather than invented, and that
// rule now binds the FALLBACK path:
//   * `subject`, `status`, `blockedBy`, `ownerName` come from the board, so the DAG, the depth
//     ordering and the BLOCKED marking keep working on either source;
//   * on the FALLBACK path `kind`, `verdict`, `round`, `attempt` have NO official field: they stay
//     ABSENT and are never populated, so a renderer that prints them prints the honest blank. On the
//     mpd RECORD they are real data;
//   * `phase` is DERIVED on the fallback (a teammate running/provisioning ⇒ `active`) and STORED on
//     the record; the peer mailbox lives in the Lead Session log with no adapter seam, so `unread`
//     is `null` ("not observable") on either source, never a fabricated `0`.
//
// This module still performs ZERO writes — no write primitive may appear in this package's built
// bytes — and it never touches a harness service: the ADAPTER and the `mpdTeams` service are the
// only contact surfaces, and a scene receives its resolved views from the composition root.
//
// Nothing here throws: an absent/unreadable readout degrades to an empty workflow plus a bounded
// problem note. A scene must never be able to take the session down (contract §10, last criterion).
import { isRecord } from "../../mpd-dsh-adapter-plugin/src/index.js"
import type { DshAdapter, DshTeamView } from "../../mpd-dsh-adapter-plugin/src/index.js"
import { scalarText } from "./sanitize.js"
import type { TeamRecord, TeamTaskRecord } from "../../mpd-team-core-plugin/src/team-store.js"
import type { GraphModel, GraphNode } from "../../mpd-graph-core/src/types.ts"
import { ID_ORDER } from "../../mpd-graph-core/src/rank.ts"

/** Bounded caps — so one pathological readout cannot stall a render. */
const MAX_TEAMS = 20
/** Tasks projected per team before the projection stops, a render-stall bound. */
const MAX_TASKS = 5000
/** Problem notes kept for display; further ones are dropped, not queued. */
const MAX_PROBLEMS = 5
/** The mailbox key cap (mirrors the retired `MAX_KEY_LENGTH` the normalisation was written for). */
const MAILBOX_KEY_MAX = 48
/**
 * The `visual` a GROUP PSEUDO-NODE carries in the served model: a frame, never a task.
 *
 * Declared as data because the row projection is the one reader that must NOT publish such a node as a
 * board task. The value is the model's own vocabulary (`mpd-graph-core`), restated here as a literal
 * because that module's constant is not part of the barrel this package imports.
 */
const GROUP_VISUAL = "group"

/**
 * THE SESSION-EMPTY MARKER — what a surface says when ITS OWN session has no team.
 *
 * It is a CONSTANT rather than a sentence composed at each call site because it is an acceptance
 * subject: `test/session-scope.test.ts` asserts the rendered frame carries exactly this string, so a
 * surface that silently fell back to another session's board would redden on the marker's absence.
 * It is ASCII, because the drawing half of every surface is CJK-free by contract.
 */
export const NO_SESSION_TEAM_MARKER = "no team in this session"

/**
 * THE WORKSPACE-SCOPED MARKER — what marks a drawing that is NOT this session's board.
 *
 * A surface that cannot read a session id (an older host, a keypress-time read) still draws the
 * workspace's principal team, exactly as it did before session scoping existed — but it must SAY SO,
 * so a reader can tell "this is not my session's board" from "this is". The marker is drawn as a
 * visible row beside the header on every such drawing, never only asserted in a test.
 */
export const WORKSPACE_SCOPE_MARKER = "workspace-level"

/**
 * Where one projection's team came from — the three-state honesty rule, as data.
 *
 * `session` is the normal case (the surface asked for a session id and a team resolved for it);
 * `workspace` is the marked fallback (no session id was readable, so today's workspace-principal
 * rule ran); `none` is the honest empty state (a session id WAS readable and this session has no
 * team — the surface must draw nothing rather than another session's board).
 */
export type TeamScope = "session" | "workspace" | "none"

/** The provenance of one projection, carried ON the projection so every renderer can report it. */
export interface TeamSource {
  /** Which of the three states this read landed in. */
  scope: TeamScope
  /** The session the surface asked for, present whenever the surface could read one. */
  sessionId?: string
  /**
   * How many teams this workspace holds — informational, and only ever set on the `none` state.
   *
   * The contract allows the empty state to name this: it tells a reader whether the workspace is
   * empty or whether the board simply belongs to somebody else. It is never used to select a team.
   */
  workspaceTeams?: number
}

/**
 * One listener registration on the team feed; the returned disposer is idempotent.
 *
 * The signature is the one frozen in `.mpd/plans/lane-s-change-feed.md` §3.1, restated here as the
 * consumer's own structural type so this package never imports the team plugin's runtime.
 */
export type TeamFeedSubscribe = (listener: () => void) => () => void

/**
 * The SERVICE's own feed member, in the two-argument form frozen by Lane S §3.1.
 *
 * It is a different type from {@link TeamFeedSubscribe} on purpose: a SURFACE subscribes to the
 * workspace it belongs to, while the service is the thing that knows workspaces. Collapsing the two
 * would make the workspace argument unspellable.
 */
export type TeamFeedSubscribeMember = (workspace: string, listener: () => void) => () => void

/**
 * Resolve the LIVE team feed for the CALLING session's workspace, per call.
 *
 * `undefined` means "this composition has no feed yet" (the `mpdTeams` row binds asynchronously, so
 * the accessor is asked again on every render). The identity of the function it returns MUST be
 * stable while the feed is bound: a surface uses it as an effect dependency, and a closure rebuilt
 * per render would re-subscribe on every frame.
 */
export type TeamFeedAccessor = () => TeamFeedSubscribe | undefined

/**
 * The session-scoped team reads a SCENE needs, on top of the two source closures it already takes.
 *
 * One object rather than two more positional parameters: the four scene factories already carry seven
 * arguments each, and the two fields here always travel together (a composition either has the team row
 * and therefore its feed, or it has neither). Every field is resolved PER CALL — the workspace inside the
 * accessor, the service by the caller — because one host serves many sessions.
 */
export interface TeamSourceDeps {
  /** The `mpdTeams` face, resolved per call; undefined when this composition has no team row. */
  teams?: () => MpdTeamsLike | undefined
  /** The live team feed for the calling session's workspace, resolved per render. */
  subscribeTeams?: TeamFeedAccessor
}

/** One task row of the workflow view. */
export interface TeamTaskRow {
  /** The board's task id, sanitized; a row without one is dropped. */
  id: string
  /** The board's subject, sanitized; empty when the board carries none. */
  subject: string
  /**
   * The task's acceptance text, sanitized — the record's own `description`, carried through.
   *
   * IT IS CARRIED FOR CLAUSE C3, and it is the reason the projection keeps it at all: the CJK ban
   * governs the DRAWING, while the click/pin detail body must keep the original subject AND description
   * untouched. A projection that dropped the description could not honour that half of the clause no
   * matter what the detail body did with it — the text would no longer exist to show.
   */
  description?: string
  /** Optional in the durable record — a hand-written fixture may omit it (§3.1 item 4). */
  kind?: string
  /** The official board status; `pending` when the board carries none. */
  status: string
  /** The visual state the Web panel computes: completed|failed|cancelled|running|blocked|open. */
  visual: string
  /**
   * True for a GHOST row: the task plan declares this id and the board does not (wave `living-graph`).
   *
   * Set only by {@link modelRows} when it synthesizes a row from a served model node; an ordinary
   * board row leaves it absent, so a consumer that keys on the boolean sees ghosts and nothing else.
   */
  planned?: boolean
  /** Owner display name, absent when the board records none. */
  assignee?: string
  /** Attempt counter; no official field in 0.1.7, so it stays unset. */
  attempt?: number
  /** Review round; no official field in 0.1.7, so it stays unset. */
  round?: number
  /** Review verdict; no official field in 0.1.7, so it stays unset. */
  verdict?: string
  /** Ids this task is blocked by, in board order. */
  dependencies: string[]
  /** The dependency ids that failed, i.e. that no later state can unblock. */
  failedDependencies: string[]
  /** Longest dependency path length (0 = a root); the row's indent. */
  depth: number
  /**
   * The INNERMOST group frame this row draws inside, absent for a task of the root frame.
   *
   * CARRIED SO THE DRAWING NEEDS NO SECOND LOOKUP: the model names it per node, the projection passes it
   * through, and `graph.ts` buckets the rows by it when a grouped picture is asked for. A row without one
   * is a root task, which is the same reading the absent field has on the model.
   */
  group?: string
}

/** One roster row: the member plus the progress facts the Web panel shows. */
export interface TeamMemberRow {
  /** The member's display name, sanitized; `?` when the board carries none. */
  name: string
  /** The member's role text (the board's description field), when it has one. */
  role?: string
  /** `provider/model`, or the bare model when no provider is recorded. */
  route?: string
  /** The member's official status; `unknown` when the readout carries none. */
  status: string
  /** Tasks owned by this member that are completed. */
  done: number
  /** Tasks owned by this member, in any state. */
  total: number
  /** Completion percentage, 0-100 and rounded; 0 when the member owns nothing. */
  progress: number
  /** The first in-progress task this member owns, when there is one. */
  currentTask?: string
  /** `null` = NOT OBSERVABLE on the official plane (the mailbox is the Lead session's). */
  unread: number | null
}

/** The team-level facts. */
export interface TeamHead {
  /** The team's own id, sanitized; `?` when the readout carries none. */
  id: string
  /** The lead's name, sanitized; `?` when the readout carries none. */
  name: string
  /** Derived phase: `active` while a teammate runs or provisions, else `idle`. */
  phase: string
  /** The team's description; no official source in 0.1.7, so it stays absent. */
  description?: string
  /** The Lead session's id, when the readout carries one. */
  captainSessionId?: string
  /** Plan-review state; no official source in 0.1.7, so it stays absent. */
  planReviewState?: string
  /** `approvedAt ?? createdAt`, the record's own ordering stamp. */
  stagedAt?: string
  /** True while `phase === "staged"` — the Web's own precondition for the plan editor. */
  staged: boolean
  /** Whether the plan surface may offer to run the team (members and tasks both exist). */
  runnable: boolean
  /** Total dependency edges across the DAG. */
  links: number
}

/** The whole projection. `team` is undefined when the workspace has no readable record. */
export interface TeamWorkflow {
  /** The workspace this projection was scoped to. */
  workspace: string
  /**
   * WHERE this team came from, in the three-state vocabulary.
   *
   * Optional only so a hand-built fixture stays valid; every reader in this package sets it, and a
   * renderer treats an absent source as the workspace-scoped fallback — the state that predates
   * session scoping, and therefore the only honest reading of an unlabelled projection.
   */
  source?: TeamSource
  /** The team head, absent when this workspace has no readable readout. */
  team?: TeamHead
  /** The roster rows; the lead and removed members are excluded. */
  members: TeamMemberRow[]
  /** The DAG rows, ordered by depth and then by board order. */
  tasks: TeamTaskRow[]
  /**
   * The SERVED graph model for this team, when the host publishes one (wave `living-graph`).
   *
   * Optional on purpose: ABSENT means this composition has no model (an older host, a unit fixture,
   * or a service whose model cannot be proved to describe this board) and every surface draws the
   * board alone, exactly as before. PRESENT means the DAG page draws the model's nodes — plan-only
   * GHOSTS included — and takes each node's rank from the model instead of deriving one.
   */
  model?: GraphModel
  /** Task tally by official status, plus an `other` bucket. */
  counts: {
    total: number
    completed: number
    inProgress: number
    pending: number
    claimed: number
    failed: number
    cancelled: number
    other: number
  }
  /** `unread: null` = not observable; `captainInbox` is always empty for the same reason. */
  mail: { unread: number | null; captainInbox: { from: string; content: string }[] }
  /** Team ids the team watchdog currently holds for this workspace (never fabricated). */
  holds: readonly string[]
  /** Bounded notes about what could not be read or had to be cut. */
  problems: string[]
}


/** Treats a non-array as absent, so a malformed readout section degrades to empty. */
function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

/** A non-empty string, or undefined for every other value (the empty string included). */
function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

/** A finite number, or undefined for every other value. */
function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

/** Sanitized optional text: `undefined` when the field is missing or not a scalar. */
function asText(value: unknown, maxCells: number): string | undefined {
  return scalarText(value, maxCells)
}

/** Spread one optional sanitized field into an object literal. */
function optional(key: string, value: string | undefined): Record<string, string> {
  return value === undefined ? {} : { [key]: value }
}

/** The adopted mailbox key normalization (mirrors `state.js:sanitizeKey`). */
export function mailboxKey(name: string): string {
  /** The normalized key: NFC, trimmed, lower-cased, non-alphanumerics collapsed to `-`. */
  const cleaned = name
    .normalize("NFC")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
  if (cleaned === "") return ""
  /** The key's code points, so the length cap never splits a surrogate pair. */
  const points = [...cleaned]
  return points.length > MAILBOX_KEY_MAX ? points.slice(0, MAILBOX_KEY_MAX).join("") : cleaned
}

/**
 * The dependency ids that still block, and the subset of them that FAILED.
 *
 * **OPT-1 (user decision, 2026-09-13) — DO NOT "FIX" THIS.** A FAILED dependency does NOT block its
 * dependents: they stay `open` and dispatchable, and the failure is carried in the SECOND list so a
 * renderer can name it (`failed-dep=`). The reasoning recorded with the decision: a failed dependency
 * must not pin its dependents forever, and a cancelled one already does not. An unknown id counts as
 * pending, hence blocking. `mpd-team-core-plugin/src/team-store.ts` carries the same rule on the
 * mpd-owned record; the two must keep agreeing.
 */
function blockingDependencies(tasks: readonly TeamTaskRow[], dependencies: readonly string[]): { blocking: string[]; failed: string[] } {
  /** Task lookup by id, the index every dependency walk uses. */
  const byId = new Map(tasks.map((task) => [task.id, task]))
  /** Dependency ids that still block: neither completed nor cancelled. */
  const blocking: string[] = []
  /** Dependency ids that failed, which no later state can unblock. */
  const failed: string[] = []
  for (const id of dependencies) {
    /** This dependency's status; an unknown id counts as pending, hence blocking. */
    const status = byId.get(id)?.status
    if (status === "completed" || status === "cancelled") continue
    if (status === "failed") failed.push(id)
    else blocking.push(id)
  }
  return { blocking, failed }
}

/** The visual state the Web panel renders (`state.js:1397-1407`). */
export function taskVisualState(status: string, tasks: readonly TeamTaskRow[], dependencies: readonly string[]): string {
  if (status === "completed") return "completed"
  if (status === "failed") return "failed"
  if (status === "cancelled") return "cancelled"
  if (status === "in_progress") return "running"
  return blockingDependencies(tasks, dependencies).blocking.length > 0 ? "blocked" : "open"
}

/**
 * Longest dependency-path depth per task (`state.js:1415-1442`). A cycle is
 * visible instead of fatal: a revisited node resolves to 0 and the caller adds a
 * note, so the render can never hang or blow the stack.
 */
export function taskDepths(tasks: readonly { id: string; dependencies: readonly string[] }[]): Map<string, number> {
  /** Task lookup by id. */
  const byId = new Map(tasks.map((task) => [task.id, task]))
  /** Memoized depth per task id, filled as the walk returns. */
  const depths = new Map<string, number>()
  /** Ids on the current path, so a cycle resolves to 0 instead of recursing forever. */
  const visiting = new Set<string>()
  /**
   * Longest dependency path below one task.
   * @param taskId - the task to measure.
   * @returns the path length; 0 for a root, an unknown id or a revisited node.
   */
  const depthOf = (taskId: string): number => {
    /** This task's memoized depth, when the walk already computed it. */
    const cached = depths.get(taskId)
    if (cached !== undefined) return cached
    if (visiting.has(taskId)) return 0
    /** This task's row, undefined when the id is not in the list. */
    const task = byId.get(taskId)
    if (task === undefined) return 0
    visiting.add(taskId)
    /** The task's known dependencies, sorted so the walk is deterministic. */
    const dependencies = [...task.dependencies].filter((id) => byId.has(id)).sort()
    // A LOOP, never `1 + Math.max(...deps)`: a spread over a pathologically long dependency array
    // overflows the stack, and a record that wide must degrade to a depth instead of a crash.
    /** The deepest dependency path found so far; `dependencies.length === 0` falls out as 0 below. */
    let deepest = 0
    for (const id of dependencies) {
      /** This dependency's own depth, memoized by the walk. */
      const depth = depthOf(id)
      if (depth > deepest) deepest = depth
    }
    /** One plus the deepest dependency, or 0 when nothing depends below this task. */
    const depth = dependencies.length === 0 ? 0 : 1 + deepest
    visiting.delete(taskId)
    depths.set(taskId, depth)
    return depth
  }
  for (const task of tasks) depthOf(task.id)
  return depths
}

/** Ids taking part in a dependency cycle (a bounded, visible note instead of a hang). */
export function cycleIds(tasks: readonly { id: string; dependencies: readonly string[] }[]): string[] {
  /** Task lookup by id. */
  const byId = new Map(tasks.map((task) => [task.id, task]))
  /** Ids whose whole subtree was already visited. */
  const done = new Set<string>()
  /** The current DFS path, in visit order. */
  const stack: string[] = []
  /** Membership index of `stack`, so a back edge is recognised in constant time. */
  const inStack = new Set<string>()
  /** Ids proven to sit on a cycle. */
  const cyclic = new Set<string>()
  /**
   * Walks one id's dependencies, recording every node on a back edge as cyclic.
   * @param id - the id to visit.
   */
  const visit = (id: string): void => {
    if (done.has(id)) return
    if (inStack.has(id)) {
      for (const entry of stack.slice(stack.indexOf(id))) cyclic.add(entry)
      return
    }
    /** This id's row, undefined when the list does not carry it. */
    const task = byId.get(id)
    if (task === undefined) return
    inStack.add(id)
    stack.push(id)
    for (const dependency of task.dependencies) if (byId.has(dependency)) visit(dependency)
    stack.pop()
    inStack.delete(id)
    done.add(id)
  }
  for (const task of tasks) visit(task.id)
  return [...cyclic].sort()
}

/** The first unfinished task a member owns (`snapshot.js:15-21`). */
function currentTaskOf(memberName: string, tasks: readonly TeamTaskRow[]): string | undefined {
  for (const task of tasks) {
    if (task.status === "in_progress" && task.assignee === memberName) return task.id
  }
  return undefined
}

/**
 * An empty workflow: what every failure path renders instead of a crash.
 * @param workspace - the workspace this read was scoped to.
 * @param problems - the bounded notes about what could not be read.
 * @param holds - the team ids the watchdog currently holds.
 * @param source - the provenance this empty projection carries, so a renderer can tell "this session
 *   has no team" from "nothing is readable here"; omitted leaves the projection unlabelled.
 * @returns the empty projection.
 */
function emptyWorkflow(workspace: string, problems: string[], holds: readonly string[], source?: TeamSource): TeamWorkflow {
  return {
    workspace,
    ...(source === undefined ? {} : { source }),
    members: [],
    tasks: [],
    counts: { total: 0, completed: 0, inProgress: 0, pending: 0, claimed: 0, failed: 0, cancelled: 0, other: 0 },
    mail: { unread: null, captainInbox: [] },
    holds,
    problems,
  }
}

/**
 * The LIVE team views that belong to ONE workspace, resolved through the adapter.
 *
 * The official readout is process-wide, so the per-workspace scoping the TUI needs is recovered
 * from the SAME registry the readout itself folds: a view belongs to `workspace` when its Lead
 * session is a live Agent whose session cwd IS that workspace. When the registry cannot answer at
 * all, every view is returned — the readout is then the only truth available, and showing a live
 * team is better than showing none. A readout that throws degrades to `[]`, never a throw.
 *
 * @param dsh - the adapter (the ONE harness contact surface).
 * @param workspace - the calling session's workspace root.
 * @returns the views, never throwing.
 */
export function liveTeamViews(dsh: DshAdapter, workspace: string): DshTeamView[] {
  /** The readout's views, before the workspace scoping below. */
  let views: DshTeamView[]
  try {
    views = dsh.teamLiveTeams() ?? []
  } catch {
    return []
  }
  /** The live agents used to recover the per-workspace scoping. */
  let agents: readonly unknown[] = []
  try {
    agents = dsh.liveAgents() ?? []
  } catch {
    agents = []
  }
  if (agents.length === 0 || workspace === "") return views.slice(0, MAX_TEAMS)
  /** Session cwd per live agent id, the index that places a view in a workspace. */
  const cwdOf = new Map<string, string>()
  for (const entry of agents) {
    /** One live-agent entry, read for its id and its session cwd. */
    const agent = entry as { id?: unknown; session?: { header?: { cwd?: unknown } } } | undefined
    /** The agent's id, empty when the entry carries no usable one. */
    const id = typeof agent?.id === "string" ? agent.id : ""
    /** The agent session's cwd, of any type until the string check below. */
    const cwd = agent?.session?.header?.cwd
    if (id !== "" && typeof cwd === "string") cwdOf.set(id, cwd)
  }
  /** Views whose Lead session cwd IS this workspace. */
  const own = views.filter((view) => cwdOf.get(String(view.leadSessionId ?? "")) === workspace)
  // A view whose Lead the registry does not carry cannot be placed in any workspace; it is kept
  // only when NOTHING could be placed, so a single-workspace host still renders its team.
  return (own.length > 0 ? own : views).slice(0, MAX_TEAMS)
}

/** The roster status of a member, in the official vocabulary (`TeamMemberView.status`). */
function memberStatus(view: DshTeamView, index: number): string {
  /** The view's roster rows, empty when the field is not an array. */
  const rows = Array.isArray(view.members) ? view.members : []
  /** The roster row at this index, undefined when the readout is shorter. */
  const row = rows[index]
  return typeof row?.status === "string" ? row.status : "unknown"
}

/** Whether any teammate row is doing something (the DERIVED phase, see the module header). */
function teamActive(view: DshTeamView): boolean {
  /** The view's roster rows, empty when the field is not an array. */
  const rows = Array.isArray(view.members) ? view.members : []
  return rows.some((member) => member.role === "teammate" && (member.status === "running" || member.status === "provisioning"))
}

/**
 * Choose the team the surface shows: the live view with the most tasks, ties broken by the
 * readout's own order. There are no timestamps on the official plane, so "newest" is not a
 * question that can be asked; "the one with a board" is.
 */
function principalView(views: readonly DshTeamView[]): DshTeamView | undefined {
  /** The view with the most tasks so far; ties keep the readout's own order. */
  let best: DshTeamView | undefined
  for (const view of views) {
    /** This view's task count, zero when the field is not an array. */
    const tasks = Array.isArray(view.tasks) ? view.tasks.length : 0
    if (best === undefined || tasks > (Array.isArray(best.tasks) ? best.tasks.length : 0)) best = view
  }
  return best
}

/**
 * Read one workflow projection from the OFFICIAL readout.
 *
 * @param workspace - the calling session's workspace root (display + problem notes).
 * @param holds - the team ids the watchdog currently holds (read through its service).
 * @param views - the LIVE team views for that workspace, resolved by the caller through the
 *   adapter (`liveTeamViews(dsh, workspace)`); pass `[]` when the seam is absent. On the
 *   SESSION-scoped path these are already filtered to this session's own views.
 * @param source - the provenance the projection carries, so a reader knows whether it is looking at
 *   its own session's board or at the marked workspace-level fallback.
 * @returns the projection; never throws.
 */
export function readTeamWorkflow(workspace: string, holds: readonly string[] = [], views: readonly DshTeamView[] = [], source?: TeamSource): TeamWorkflow {
  /** Notes about what could not be read; bounded before they are returned. */
  const problems: string[] = []
  /** The view this projection is built from. */
  const view = principalView(views.slice(0, MAX_TEAMS))
  if (view === undefined) return emptyWorkflow(workspace, problems, holds, source)

  /** The board's task rows, capped by `MAX_TASKS`. */
  const rawTasks = Array.isArray(view.tasks) ? view.tasks.slice(0, MAX_TASKS) : []
  /** The projected rows, built before the depth and visual passes below. */
  const tasks: TeamTaskRow[] = []
  for (const raw of rawTasks) {
    if (raw === null || typeof raw !== "object") continue
    /** This row's sanitized id; a row without one is dropped. */
    const id = asText(raw.id, 40)
    if (id === undefined) continue
    /** This row's blocking ids, sanitized with unusable entries stripped. */
    const dependencies = (Array.isArray(raw.blockedBy) ? raw.blockedBy : [])
      .map((entry) => asText(entry, 40))
      .filter((entry): entry is string => entry !== undefined)
    tasks.push({
      id,
      subject: asText(raw.subject, 160) ?? "",
      // `kind`/`round`/`verdict`/`attempt` have NO official source: the row leaves them absent so a
      // renderer prints the honest blank instead of a value the board never carried.
      status: asText(raw.status, 40) ?? "pending",
      visual: "open",
      ...optional("assignee", asText(raw.ownerName, 80)),
      dependencies,
      failedDependencies: [],
      depth: 0,
    })
  }
  /** Depth per task id, computed once for the whole DAG. */
  const depths = taskDepths(tasks)
  for (const task of tasks) {
    task.depth = depths.get(task.id) ?? 0
    task.failedDependencies = blockingDependencies(tasks, task.dependencies).failed
    task.visual = taskVisualState(task.status, tasks, task.dependencies)
  }
  // The DAG is ordered by `depth` then the board's own order (there is no per-task creation
  // timestamp to sort by on the official plane, and the board's rows ARE append-ordered).
  const creationIndex = new Map(tasks.map((task, index) => [task.id, index]))
  tasks.sort((left, right) => left.depth - right.depth || (creationIndex.get(left.id) ?? 0) - (creationIndex.get(right.id) ?? 0))
  /** The ids taking part in a dependency cycle, reported as a note. */
  const cycle = cycleIds(tasks)
  if (cycle.length > 0) problems.push(`cycle ${cycle.join(",")}`)

  /** Task tally by official status, plus an `other` bucket. */
  const counts = { total: 0, completed: 0, inProgress: 0, pending: 0, claimed: 0, failed: 0, cancelled: 0, other: 0 }
  for (const task of tasks) {
    counts.total += 1
    switch (task.status) {
      case "completed":
        counts.completed += 1
        break
      case "in_progress":
        counts.inProgress += 1
        break
      case "pending":
        counts.pending += 1
        break
      case "claimed":
        counts.claimed += 1
        break
      case "failed":
        counts.failed += 1
        break
      case "cancelled":
        counts.cancelled += 1
        break
      default:
        counts.other += 1
    }
  }

  /** The readout's roster rows, empty when the field is not an array. */
  const memberRows = Array.isArray(view.members) ? view.members : []
  /** The projected roster rows; the lead and removed members are excluded. */
  const members: TeamMemberRow[] = []
  memberRows.forEach((raw, index) => {
    if (raw === null || typeof raw !== "object") return
    if (raw.role === "lead") return
    // A `removed` teammate is not part of the roster (the Web panel's own filter, tolerated here
    // for a record-shaped fixture; the official statuses are running|inactive|provisioning|failed).
    if ((raw as { status?: unknown }).status === "removed") return
    /** This member's display name; `?` when the row carries none. */
    const name = asText(raw.name, 80) ?? "?"
    /** This member's official status, read back by roster index. */
    const status = memberStatus(view, index)
    /** This member's provider id, empty when the row carries none. */
    const provider = asString(raw.provider)?.trim() ?? ""
    /** This member's model id, empty when the row carries none. */
    const model = asString(raw.model)?.trim() ?? ""
    /** `provider/model`, the bare model, or undefined when neither is recorded. */
    const route = provider !== "" && model !== "" ? `${provider}/${model}` : model !== "" ? model : undefined
    /** Tasks assigned to this member, in DAG order. */
    const owned = tasks.filter((task) => task.assignee === name)
    /** Tasks of this member that are completed. */
    const done = owned.filter((task) => task.status === "completed").length
    members.push({
      name,
      ...optional("role", asText(raw.description, 120)),
      ...optional("route", route),
      status,
      done,
      total: owned.length,
      progress: owned.length === 0 ? 0 : Math.round((done / owned.length) * 100),
      ...optional("currentTask", currentTaskOf(name, tasks)),
      unread: null,
    })
  })

  /** The derived phase, taken from the roster's own activity. */
  const phase = teamActive(view) ? "active" : "idle"
  /** Total dependency edges across the DAG. */
  const links = tasks.reduce((sum, task) => sum + task.dependencies.length, 0)
  // A team the readout carries at all is one a session owns; the plan surface's runnable gate is
  // the Web's own (`members && tasks`).
  const runnable = members.length > 0 && tasks.length > 0

  return {
    workspace,
    ...(source === undefined ? {} : { source }),
    team: {
      id: asText(view.teamId, 60) ?? "?",
      name: asText(view.leadName, 80) ?? "?",
      phase,
      ...optional("captainSessionId", asText(view.leadSessionId, 80)),
      // No staged phase and no approval flow exist on the official plane: `staged` is ALWAYS false
      // and the two stamp fields have no source, so they stay absent rather than invented.
      staged: false,
      runnable,
      links,
    },
    members,
    tasks,
    counts,
    mail: { unread: null, captainInbox: [] },
    holds,
    problems: problems.slice(0, MAX_PROBLEMS),
  }
}

/** The exact phrase the user must type to approve (`approve <teamId>`), from the record's own id. */
export function approvalPhrase(teamId: string): string {
  return `approve ${teamId}`
}

/**
 * The structural face of the `mpdTeams` service this package reads.
 *
 * Declared STRUCTURALLY rather than imported: the service is another plugin's runtime object, and a
 * value import would bundle that plugin's whole module graph into this one. Only the members this
 * package actually calls are named, so a wider service stays compatible.
 */
export interface MpdTeamsLike {
  /** Every team in a workspace, newest first. */
  list?: (workspace: string) => TeamRecord[]
  /** The team bound to one Lead session. */
  active?: (workspace: string, sessionId?: string) => TeamRecord | undefined
  /**
   * The SERVED graph model of one team: the shared plan→graph core's output for this workspace.
   *
   * `teamId` GIVEN means the model of THAT team, which is what a session-scoped reader passes so a
   * session never receives another team's ghosts. OMITTED means the workspace-PRINCIPAL team, the
   * documented back-compat answer for a host with no session of its own. The member is optional and a
   * missing one is not an error: every TUI surface then draws the board it already reads.
   * @param workspace - the workspace to read, resolved per call.
   * @param teamId - the mpd team whose model is wanted, when the caller knows which one it draws.
   * @returns the served model, or undefined when this composition publishes none.
   */
  graph?: (workspace: string, teamId?: string) => GraphModel | undefined
  /**
   * The STAGED PLAN of one session — the SHARED projection, exactly as the Web panel receives it.
   *
   * The service-level reads above are workspace-scoped because an agentless surface has no session of
   * its own; a SCENE does, on its live channel, which is why this one takes a session id and why the
   * TUI does not need a second implementation of the plan projection or of the approval gate.
   * @param workspace - the workspace to read.
   * @param sessionId - the session whose staged plan is wanted.
   * @returns the payload, or undefined when this composition exposes no plan face.
   */
  planFor?: (workspace: string, sessionId: string) => MpdPlanView | undefined
  /**
   * Subscribe to change notifications for one workspace (the PUSH substrate, Lane S §3.1).
   *
   * It is the ONE member that makes a surface stop polling: a listener call means the team state of
   * THAT workspace changed — by this process or by another — so a surface re-reads instead of waiting
   * for its next tick. The timers STAY as the fallback, and a composition without this member (or a
   * throwing call) loses only the push.
   * @param workspace - the workspace to follow, resolved per call.
   * @param listener - called asynchronously after a coalesced change; must not throw.
   * @returns a disposer, idempotent, releasing this listener.
   */
  subscribe?: TeamFeedSubscribeMember
}

/** The staged-plan payload a TUI surface renders; the shared projection's own shape. */
export interface MpdPlanView {
  /** The staged plan, or null when this session has nothing awaiting approval. */
  plan: {
    /** The PRE-approval identity. */
    planId: string
    /** The team name the user reads. */
    name: string
    /** What the team is for. */
    description: string
    /** `required` waits for an explicit approval. */
    approval: string
    /** The EXACT string the approval gate demands, SERVED rather than re-derived. */
    phrase: string
    /** Whether an approval already committed. */
    approved: boolean
    /** Whether it was discarded instead. */
    discarded: boolean
    /** The teammates it wants raised. */
    members: Array<{ name: string; description: string; role?: string }>
    /** The tasks it wants posted. */
    tasks: Array<{ subject: string; description: string; owner?: string; blockedBy: string[] }>
  } | null
}

/**
 * Read the staged plan a TUI surface should show, through the SHARED service face.
 *
 * The session id comes from the surface's own live channel — the one piece of session identity a TUI
 * scene has, and the reason the plan is reachable here at all. Nothing is cached: the caller resolves
 * it per read, exactly as §6 requires of every workspace root.
 * @param teams - the `mpdTeams` service face, or undefined when the composition has none.
 * @param workspace - the workspace resolved for THIS read.
 * @param sessionId - the live session's id, or undefined when the channel has not bound one yet.
 * @returns the plan view, or undefined when there is nothing to show or no service to ask.
 */
export function readPlanView(teams: MpdTeamsLike | undefined, workspace: string, sessionId: string | undefined): MpdPlanView["plan"] | undefined {
  if (teams === undefined || typeof teams.planFor !== "function" || sessionId === undefined || sessionId === "") return undefined
  try {
    return teams.planFor(workspace, sessionId)?.plan ?? undefined
  } catch {
    // A service that throws must redden the surface's empty state, not take its render down.
    return undefined
  }
}

/**
 * The team a TUI surface should show WHEN IT HAS NO SESSION ID: the newest record that is not ended.
 *
 * THIS IS THE MARKED FALLBACK, NOT THE RULE. It used to be the only way a TUI surface picked a team,
 * and that is exactly the defect the user reported: a NEW session still drew the OLD session's DAG,
 * because "newest not-ended team of the workspace" is session-blind. Every surface that CAN read a
 * session id now goes through {@link readScopedWorkflow} instead and reaches this function only with
 * no id to ask `active()` with — where the drawing is marked workspace-level so a reader can tell.
 *
 * "Newest" is the record's own `createdAt` (the order `list` returns). An ENDED team is skipped so a
 * finished wave does not hide the running one behind it; a workspace whose every team has ended still
 * shows the newest, because a reader asking "what happened" must get the last answer rather than a
 * blank.
 * @param records - the records to choose from, newest first as `list` returns them.
 * @returns the principal record, or undefined when the workspace holds none.
 */
export function principalRecord(records: readonly TeamRecord[]): TeamRecord | undefined {
  return records.find((record) => record.endedAt === undefined) ?? records[0]
}

/**
 * Read the LIVE mpd records for one workspace, through the `mpdTeams` service.
 *
 * Never throws: an absent service (the mpd team row is not mounted) or a service that fails answers
 * `[]`, which sends every caller down the official fallback path.
 * @param teams - the resolved `mpdTeams` service, or undefined when the row is absent.
 * @param workspace - the workspace to read.
 * @returns the records, newest first; `[]` when there is no service or no team.
 */
export function mpdTeamRecords(teams: MpdTeamsLike | undefined, workspace: string): TeamRecord[] {
  try {
    /** The service's `list`, when the resolved object carries one. */
    const list = teams?.list
    if (typeof list !== "function" || workspace === "") return []
    return list(workspace) ?? []
  } catch {
    return []
  }
}

/**
 * Read ONE surface's session id off the object that carries it.
 *
 * EVERY TUI surface has a session id within reach and none of them used it for team selection; the
 * carrier differs (`props.channel.sessionId` on a scene, the `snapshot().sessionId` a panel's host API
 * returns) but the FIELD is the same string on both, so one reader serves all three surfaces. An empty
 * string is "unavailable", never a session called "".
 * @param carrier - the live channel object or a panel host snapshot, as the surface received it.
 * @returns the session id, or undefined when this carrier does not carry a usable one.
 */
export function sessionIdOf(carrier: unknown): string | undefined {
  if (carrier === null || carrier === undefined || typeof carrier !== "object") return undefined
  /** The `sessionId` field, before it is trusted to be a non-empty string. */
  const id = (carrier as { sessionId?: unknown }).sessionId
  return typeof id === "string" && id !== "" ? id : undefined
}

/**
 * Resolve ONE session's OWN team record — the fix for the cross-session defect.
 *
 * THE SERVICE ANSWERS FIRST (`mpdTeams.active`), because it is the only reader that also resolves the
 * two cases a plain field match cannot: the workspace's bound-session index, and a team this session
 * is the SINGLE member of. Its answer is authoritative — a service that returns nothing is a service
 * saying "this session has no team", and inventing a second guess behind it would be the very leak
 * this function exists to close.
 *
 * THE DURABLE SCAN IS THE DEGRADATION, and it is still strictly session-scoped: it matches the
 * record's own `leadSessionId` against this session and NEVER falls back to "the newest record", so a
 * composition whose `mpdTeams` face carries no `active` member still cannot draw another session's
 * board. (It cannot resolve the single-member case, which needs the roster write path the service
 * owns — that is the declared bound of this half.)
 * @param teams - the `mpdTeams` face, or undefined when this composition has no team row.
 * @param workspace - the workspace resolved for THIS read.
 * @param sessionId - the session whose own team is wanted; must be a non-empty id.
 * @param records - this workspace's records as `list` returned them, newest first.
 * @returns the record that belongs to this session, or undefined when it has none.
 */
export function sessionRecord(
  teams: MpdTeamsLike | undefined,
  workspace: string,
  sessionId: string,
  records: readonly TeamRecord[],
): TeamRecord | undefined {
  /** The service's own session resolver, when this face carries one. */
  const active = teams?.active
  if (typeof active === "function") {
    try {
      return active(workspace, sessionId) ?? undefined
    } catch {
      // A THROWING SERVICE IS NOT AN ANSWER: the durable scan below is session-scoped too, so falling
      // through can only narrow the result, never widen it.
    }
  }
  return records.find((record) => record.leadSessionId === sessionId)
}

/**
 * The OFFICIAL readout's views that belong to ONE session.
 *
 * The official plane carries the Lead session id on every view, which is exactly enough to answer the
 * one question session scoping needs and not enough to answer more: a view is this session's when its
 * `leadSessionId` IS this session. Views that name another session (or none) are dropped rather than
 * drawn, so the preserved official fallback cannot leak a board across sessions either.
 * @param views - the live views for this workspace.
 * @param sessionId - the session whose views are wanted.
 * @returns the views this session owns; `[]` when it owns none.
 */
export function sessionViewsOf(views: readonly DshTeamView[], sessionId: string): DshTeamView[] {
  return views.filter((view) => scalarText(view.leadSessionId, 80) === sessionId)
}

/** Everything ONE session-scoped team read needs, injected per call so the read is testable. */
export interface ScopedTeamRead {
  /** The workspace resolved for THIS read; never cached across calls. */
  workspace: string
  /** The calling session's id, or undefined when this surface cannot read one (an older host). */
  sessionId?: string
  /** The team ids the watchdog currently holds for this workspace. */
  holds: readonly string[]
  /** The `mpdTeams` face, or undefined when this composition has no team row. */
  teams?: MpdTeamsLike
  /** The mpd records for this workspace, resolved per call; `[]` when there is no service. */
  records: readonly TeamRecord[]
  /** The official readout for this workspace, resolved per call; `[]` when the seam is absent. */
  views: readonly DshTeamView[]
}

/**
 * THE ONE TEAM READER every TUI surface uses — session-scoped, with the three-state honesty rule.
 *
 * The defect this replaces was a SELECTION rule, not a renderer bug: every surface asked for "the
 * newest not-ended team of the WORKSPACE", so a session that had just been created drew the previous
 * session's DAG as if it were its own. The rule is now:
 *
 *   · a session id IS readable → the record `mpdTeams.active(workspace, sessionId)` resolves for THAT
 *     session, else the official readout's views whose Lead IS that session. Another session's board is
 *     never consulted, in either half;
 *   · a session id IS readable and nothing resolves → the honest EMPTY projection, marked `none` and
 *     carrying how many teams the workspace holds. The renderer says "no team in this session" and
 *     draws no DAG: a fallback to the workspace principal here would be precisely the reported defect;
 *   · NO session id is readable (an older host, a keypress-time read) → today's workspace-principal
 *     behaviour survives, marked `workspace`, so the surface draws it WITH the visible marker that says
 *     this is not necessarily your session's board.
 *
 * The read never throws: an unreadable projection is an empty one carrying the same source, so a
 * renderer can still tell the reader what happened.
 * @param read - the workspace, the session id, the holds and the two sources, all resolved per call.
 * @returns the projection; never undefined, and never another session's team.
 */
export function readScopedWorkflow(read: ScopedTeamRead): TeamWorkflow {
  /** The session id this read is scoped to; an empty string is "unavailable", never a session. */
  const sessionId = typeof read.sessionId === "string" && read.sessionId !== "" ? read.sessionId : undefined
  try {
    if (sessionId === undefined) {
      // THE MARKED FALLBACK. This is the ONLY arm where the workspace principal may be drawn — and it
      // is marked, so a reader can see that the board is not necessarily theirs.
      /** The workspace's principal record, under the pre-existing rule. */
      const principal = principalRecord(read.records)
      if (principal !== undefined) return attachModel(readRecordWorkflow(read.workspace, read.holds, principal, { scope: "workspace" }), read.teams, read.workspace, principal.teamId)
      // NO MODEL ON THIS ARM: the projection came from the OFFICIAL views, so this reader cannot name
      // the mpd team it belongs to. `graph(workspace)` would answer for the workspace PRINCIPAL team,
      // and every team numbers its tasks from `T1` — an id check cannot tell them apart, so asking at
      // all would risk drawing another session's graph. The board is drawn alone instead.
      return readTeamWorkflow(read.workspace, read.holds, read.views, { scope: "workspace" })
    }
    /** The record THIS session owns, through the service's own resolver. */
    const record = sessionRecord(read.teams, read.workspace, sessionId, read.records)
    if (record !== undefined) return attachModel(readRecordWorkflow(read.workspace, read.holds, record, { scope: "session", sessionId }), read.teams, read.workspace, record.teamId)
    /** The official views THIS session owns; another session's view is never drawn from here. */
    const mine = sessionViewsOf(read.views, sessionId)
    // NO MODEL HERE EITHER, for the same reason as the workspace arm: an official view carries the
    // HOST's team identity, not the mpd record's, so there is no mpd `teamId` to ask `graph` for.
    if (mine.length > 0) return readTeamWorkflow(read.workspace, read.holds, mine, { scope: "session", sessionId })
    // THE HONEST EMPTY STATE. The count is informational only — it is never used to choose a team.
    return emptyWorkflow(read.workspace, [], read.holds, { scope: "none", sessionId, workspaceTeams: read.records.length })
  } catch (error) {
    /** The one line a crashed read leaves behind; bounded, and never a thrown render. */
    const note = `the team read failed: ${String((error as Error)?.message ?? error)}`.slice(0, 200)
    return emptyWorkflow(read.workspace, [note], read.holds, {
      scope: sessionId === undefined ? "workspace" : "none",
      ...(sessionId === undefined ? {} : { sessionId }),
    })
  }
}

/**
 * Attach the SERVED graph model to a projection, when it demonstrably describes the SAME board.
 *
 * TWO DEFENCES, because one was provably too weak. (1) THE CALLER MUST NAME ITS TEAM: this function
 * is reached only from a record-based arm, which passes the record's own `teamId`; the two
 * official-view arms do NOT call it at all, because `graph(workspace)` would answer for the workspace
 * PRINCIPAL team and an mpd team id cannot be derived from a host view. (2) THE GUARD IS A BIJECTION
 * OVER THE ROOT FRAME (cellwork wave 4, T31): every board id must appear as a NON-GHOST node of that
 * frame, that frame must carry no other real task, and every OTHER node in the model must be explained
 * by the nesting — a member of a subcell (`group` names it), a subcell's own box (`visual: "group"`), or
 * a plan-only ghost. An intersection is satisfiable by coincidence — every team numbers its tasks from
 * `T1`, so almost any two teams share an id — while this bijection still refuses a model that describes
 * a different board. IT IS NOT THE WHOLE NODE SET ANY MORE, and that is the fix: the host MERGES the
 * live descendants into this model, so a nested team's model legitimately carries more nodes than the
 * parent's board. Demanding equality refused every such model, and the live symptom was a TUI that drew
 * a qualified sub-team reference (`team-nested-sub::C4`) — an edge from the board — with no frame
 * around it. A model that survives both defences is attached; otherwise it is dropped and the board is
 * drawn alone. A throwing service costs the model, never the board.
 * @param workflow - the projection to enrich.
 * @param teams - the `mpdTeams` face, when this composition has one.
 * @param workspace - the workspace this read is scoped to, resolved per call.
 * @param teamId - the mpd team the projection was built from; a caller that cannot name one must not
 *   call this function at all (the service's no-team form answers for the principal).
 * @returns the projection with `model` set only when both defences accepted it.
 */
function attachModel(workflow: TeamWorkflow, teams: MpdTeamsLike | undefined, workspace: string, teamId: string): TeamWorkflow {
  if (teams === undefined || typeof teams.graph !== "function") return workflow
  /** The served model, read defensively: a refusing service must not cost the board. */
  let model: GraphModel | undefined
  try {
    model = teams.graph(workspace, teamId)
  } catch {
    model = undefined
  }
  if (model === undefined || !Array.isArray(model.nodes)) return workflow
  /** The task ids this projection's own board carries. */
  const boardIds = new Set(workflow.tasks.map((task) => task.id))
  // THE ROOT FRAME, WHICH IS THE ONLY PART THE BOARD CAN PROVE: a real task drawn inside this record's
  // own frame (not a ghost, not a nested member, not a subcell's box).
  /** The model's ROOT-FRAME task ids — the nodes this board must match node for node. */
  const rootIds = model.nodes.filter((node) => node.planned === false && node.group === undefined && node.visual !== GROUP_VISUAL).map((node) => node.id)
  /** Those ids as a set, so a duplicated node cannot inflate the count. */
  const rootSet = new Set(rootIds)
  // EVERY EXTRA NODE MUST BE EXPLAINED by the nesting: a member of a group THIS MODEL DECLARES (`group`
  // names one of `model.groups`), a subcell's own box (`visual: "group"`), or a plan-only ghost. The
  // declared-group check is load-bearing rather than tidy — a `group` tag naming an id no group carries
  // explains nothing, and accepting it would let a model smuggled from another source pass itself off as
  // nested. An unexplained extra real task is another team's row, the exact collision the bijection
  // exists to refuse, so it costs the model.
  /** The group ids the MODEL ITSELF declares — the only ids a node's `group` tag may name. */
  const declaredGroups = new Set((model.groups ?? []).map((group) => group.id))
  /** Whether every node outside this board is a nested member of a DECLARED group, a box, or a ghost. */
  const extrasExplained = model.nodes.every((node) => boardIds.has(node.id) || node.planned === true || (node.group !== undefined && declaredGroups.has(node.group)) || node.visual === GROUP_VISUAL)
  // THE BIJECTION OVER THE ROOT FRAME: equal cardinality, no duplicate root nodes, and the board is a
  // subset of them — which, with equal cardinality, makes the two sets EQUAL.
  const sameBoard = rootSet.size === boardIds.size && rootIds.length === rootSet.size && [...boardIds].every((id) => rootSet.has(id)) && extrasExplained
  return sameBoard ? { ...workflow, model } : workflow
}

/**
 * The rank a served node names, normalized the way the layout expects (finite, integer, >= 0).
 *
 * `node.depth` IS the rank: the core's `GraphTask` documents `depth` as "longest dependency path
 * (0 = a root); the boxes view's RANK", and the merge fills it from the rank derivation.
 * @param node - the served model node.
 * @returns the rank; a non-finite or negative depth is 0, the drawing's own root rule.
 */
function rankOfNode(node: GraphNode): number {
  return typeof node.depth === "number" && Number.isFinite(node.depth) ? Math.max(0, Math.floor(node.depth)) : 0
}

/**
 * Synthesize the row a plan-only node draws: the model node is the only source.
 *
 * A ghost has no board row, so every field the board would have supplied stays honestly absent; its
 * `visual` is kept verbatim (`"planned"` by the merge) and `planned` marks it for a consumer that
 * keys on the boolean rather than the string.
 * @param node - the served model node, a ghost by construction.
 * @returns the row the DAG page draws for it.
 */
function ghostRow(node: GraphNode): TeamTaskRow {
  return {
    id: node.id,
    subject: node.subject,
    ...(node.kind === undefined ? {} : { kind: node.kind }),
    status: node.status ?? "pending",
    visual: node.visual,
    ...(node.assignee === undefined ? {} : { assignee: node.assignee }),
    dependencies: [...node.dependencies],
    failedDependencies: [],
    depth: rankOfNode(node),
    planned: true,
    ...(node.group === undefined ? {} : { group: node.group }),
  }
}

/**
 * The DAG rows for one projection, with the SERVED model joined in.
 *
 * MEMBERSHIP, RANK AND EDGES COME FROM THE MODEL; THE LIVE STATE AND THE DETAIL COME FROM THE BOARD.
 * A node with a board row keeps that row's own `visual`, subject, description, attempt and the review
 * fields (the TUI computed them with the OPT-1 failed-dependency rule the bare record cannot express),
 * and takes the node's `depth` — which IS the model's rank — and the node's `dependencies` — which are
 * the UNION the merge computed, not the board's own list. THE EDGE AUTHORITY IS THE MODEL, and that is
 * load-bearing rather than tidy: `graph.ts` draws an edge from exactly `dependencies`, so keeping the
 * board's list here silently dropped a PLAN-ONLY edge between two BOARD nodes — measured: a plan
 * declaring `2. Middle (blocked by 1)` over a board whose T2 carried `blockedBy: []` drew T2 one rank
 * down with NO incoming arrow, a node floating for a reason the drawing never shows. `failedDependencies`
 * deliberately stays the board row's own: a plan reference that names no node is an `unresolved`
 * REPORT entry, never a failed dependency. A node with NO board row is a GHOST, synthesized by
 * {@link ghostRow} and never dropped.
 *
 * TOTAL AND ORDERED: a board row the model omits is still returned (a stale model must not lose a
 * task), and the merged list is sorted by the core's numeric id collator, so a ghost lands at its
 * id's position rather than wherever an insertion happened.
 * @param workflow - the projection to read.
 * @returns the rows to draw; the workflow's own rows, unchanged, when no model was accepted.
 */
export function modelRows(workflow: TeamWorkflow): TeamTaskRow[] {
  /** The accepted model, or undefined when this projection carries none. */
  const model = workflow.model
  if (model === undefined) return workflow.tasks
  /** The board rows this projection already holds, keyed by id for the join. */
  const byId = new Map(workflow.tasks.map((task) => [task.id, task]))
  /** The ids the model named, so a board row it omitted can be appended rather than lost. */
  const seen = new Set<string>()
  /** The joined rows, before the final ordering pass. */
  const rows: TeamTaskRow[] = []
  for (const node of model.nodes) {
    // A GROUP PSEUDO-NODE IS A FRAME, NOT A TASK (`cellwork` wave 4). The model draws one node per
    // subcell so the ROOT frame can rank the box, and painting it as a board row would put a fake task
    // into the counts, the legend, the roster and the pointer. The box reaches the drawing through
    // `GraphModel.groups` instead, which is why this is a skip and not a second projection.
    if (node.visual === GROUP_VISUAL) continue
    seen.add(node.id)
    /** This node's board row, when the board carries the id. */
    const row = byId.get(node.id)
    if (row === undefined) {
      rows.push(ghostRow(node))
      continue
    }
    // THE MODEL OWNS THE EDGES. Spreading the board row alone kept ITS `dependencies`, which is what
    // the drawing paints edges from — so a plan-declared dependency between two board nodes vanished
    // before the drawing saw it. The union (the model node's list) is the graph; everything else stays
    // board-authoritative, including `failedDependencies` (see the header: a dangling PLAN reference is
    // an unresolved report entry, not a failure).
    rows.push({ ...row, dependencies: [...node.dependencies], depth: rankOfNode(node), ...(node.group === undefined ? {} : { group: node.group }) })
  }
  for (const task of workflow.tasks) if (!seen.has(task.id)) rows.push(task)
  rows.sort((left, right) => ID_ORDER.compare(left.id, right.id))
  return rows
}

/**
 * The served rank of every model node, keyed by id, or undefined when the projection carries none.
 *
 * `node.depth` IS THE RANK (see {@link rankOfNode}). This map is a PROJECTION only — nothing
 * serializes it — and the layout takes it as an optional input, so a projection without a model falls
 * back to the core's own `rankPlan` rather than to a second derivation here.
 * @param workflow - the projection to read.
 * @returns every node's rank, or undefined when no model was accepted.
 */
export function modelRanks(workflow: TeamWorkflow | undefined): ReadonlyMap<string, number> | undefined {
  /** The accepted model, or undefined when this projection carries none. */
  const model = workflow?.model
  if (model === undefined) return undefined
  /** The rank of every node, keyed by id. */
  const ranks = new Map<string, number>()
  for (const node of model.nodes) ranks.set(node.id, rankOfNode(node))
  return ranks
}

/**
 * Project ONE mpd team record into the workflow shape every TUI renderer already consumes.
 *
 * This is the PRIMARY path. `kind`, `attempt`, `round` and `verdict` are real here (the whole
 * reason the record exists), the roster's route comes from the record's own `route`, and `phase`
 * is the STORED one brought in line with the record's contents rather than re-derived from scratch.
 * @param workspace - the calling session's workspace root (display only).
 * @param holds - the team ids the watchdog currently holds.
 * @param record - the record to project.
 * @param source - the provenance the projection carries; a record reached through the SESSION resolver
 *   is marked `session`, one reached by the workspace-principal rule is marked `workspace`.
 * @returns the projection; never throws.
 */
export function readRecordWorkflow(workspace: string, holds: readonly string[], record: TeamRecord, source?: TeamSource): TeamWorkflow {
  /** Notes about what could not be read; bounded before they are returned. */
  const problems: string[] = []
  /** The board, capped so one pathological record cannot stall a render. */
  const board: TeamTaskRecord[] = record.tasks.slice(0, MAX_TASKS)
  // OWNERSHIP HAS TWO SPELLINGS, and this projection read only one: a declared owner carries a display
  // name, while a CLAIM stamps the claimer's executor handle (the session id). The member cards credit
  // by name, so a handle-owned task rendered as `0/0` beside a completed board (measured 2026-10-19 on
  // the Docker TUI lane). The record's own roster maps a handle back to its member name here, once.
  /** The roster's executor handles mapped back to their display names. */
  const handleToName = new Map<string, string>()
  for (const member of record.members) {
    /** This member's handle, when the record carries one. */
    const handle = scalarText(member.executorRef, 80)
    /** This member's display name. */
    const name = scalarText(member.name, 80)
    if (handle !== undefined && name !== undefined) handleToName.set(handle, name)
  }
  /** The task owner as a member NAME: a claim's handle resolves to its roster row. */
  const ownerName = (owner: string | undefined): string | undefined => owner === undefined ? undefined : (handleToName.get(owner) ?? owner)
  /** The projected rows, built before the depth and visual passes below. */
  const tasks: TeamTaskRow[] = board.map((task) => ({
    id: scalarText(task.id, 40) ?? "",
    subject: scalarText(task.subject, 160) ?? "",
    description: scalarText(task.description, 400),
    kind: scalarText(task.kind, 24),
    status: scalarText(task.status, 40) ?? "pending",
    visual: "open",
    assignee: ownerName(scalarText(task.owner, 80)),
    attempt: typeof task.attempt === "number" ? task.attempt : undefined,
    round: typeof task.round === "number" ? task.round : undefined,
    verdict: scalarText(task.verdict, 40),
    dependencies: task.blockedBy.map((id) => scalarText(id, 40)).filter((id): id is string => id !== undefined),
    failedDependencies: [],
    depth: 0,
  }))
  /** Depth per task id, computed once for the whole board. */
  const depths = taskDepths(tasks)
  for (const task of tasks) {
    task.depth = depths.get(task.id) ?? 0
    task.failedDependencies = blockingDependencies(tasks, task.dependencies).failed
    task.visual = taskVisualState(task.status, tasks, task.dependencies)
  }
  /** The board ordered by rank then by the record's own order, which is the graph's reading order. */
  const order = new Map(tasks.map((task, index) => [task.id, index]))
  tasks.sort((left, right) => left.depth - right.depth || (order.get(left.id) ?? 0) - (order.get(right.id) ?? 0))
  /** The ids on a dependency cycle, reported rather than drawn as if the board were sound. */
  const cycle = cycleIds(tasks)
  if (cycle.length > 0) problems.push(`cycle ${cycle.join(",")}`)

  /** Task tally by the record's own status vocabulary. */
  const counts = { total: 0, completed: 0, inProgress: 0, pending: 0, claimed: 0, failed: 0, cancelled: 0, other: 0 }
  for (const task of tasks) {
    counts.total += 1
    switch (task.status) {
      case "completed": counts.completed += 1; break
      case "in_progress": counts.inProgress += 1; break
      case "pending": counts.pending += 1; break
      case "claimed": counts.claimed += 1; break
      case "failed": counts.failed += 1; break
      case "cancelled": counts.cancelled += 1; break
      default: counts.other += 1
    }
  }

  /** The roster rows, excluding nothing: the record never carries a lead or a removed member. */
  const members: TeamMemberRow[] = record.members.map((member) => {
    /** This member's display name; `?` when the row carries none. */
    const name = scalarText(member.name, 80) ?? "?"
    /** Tasks assigned to this member, in board order. */
    const owned = tasks.filter((task) => task.assignee === name)
    /** Tasks of this member that are completed. */
    const done = owned.filter((task) => task.status === "completed").length
    /** The first owned task still in flight. */
    const current = owned.find((task) => task.status === "in_progress" || task.status === "claimed")
    return {
      name,
      role: scalarText(member.role ?? member.description, 120),
      route: scalarText(member.route, 80),
      status: scalarText(member.status, 40) ?? "unknown",
      done,
      total: owned.length,
      progress: owned.length === 0 ? 0 : Math.round((done / owned.length) * 100),
      currentTask: current?.id,
      // The mpd mailbox is ours and DOES carry a read state, but the record does not fold it in;
      // `null` keeps the honest "not observable here" rather than a fabricated 0.
      unread: null,
    }
  })

  /** Whether anything is actually in flight, which is what `phase` means to a reader. */
  const active = record.members.some((member) => member.status === "running" || member.status === "provisioning")
    || record.tasks.some((task) => task.status === "in_progress" || task.status === "claimed")
  /** Total dependency edges across the board. */
  const links = tasks.reduce((sum, task) => sum + task.dependencies.length, 0)

  return {
    workspace,
    ...(source === undefined ? {} : { source }),
    team: {
      id: scalarText(record.teamId, 60) ?? "?",
      name: scalarText(record.name, 80) ?? "?",
      // The STORED phase, brought in line with the record: an ended team stays ended, and a record
      // whose contents have moved on is not left claiming a phase it no longer has.
      phase: record.endedAt !== undefined ? "ended" : record.approvedAt === undefined ? "staged" : active ? "active" : "idle",
      description: scalarText(record.description, 200),
      captainSessionId: scalarText(record.leadSessionId, 80),
      stagedAt: scalarText(record.approvedAt ?? record.createdAt, 40),
      // `staged` is the Web's own precondition for the plan editor, and on this source it is REAL.
      staged: record.approvedAt === undefined,
      runnable: members.length > 0 && tasks.length > 0,
      links,
    },
    members,
    tasks,
    counts,
    mail: { unread: null, captainInbox: [] },
    holds,
    problems: problems.slice(0, MAX_PROBLEMS),
  }
}

/**
 * The team-scene body: header, watchdog, roster, task DAG, counts, mailbox, problems.
 *
 * IT OWNS THE THREE-STATE HONESTY RULE for the full-screen surfaces, exactly as the DAG page owns it
 * for the sidebar: both the team scene and the merged subagent scene render THIS function, so the two
 * cannot describe one session's team differently. A session-scoped read that resolved nothing renders
 * {@link NO_SESSION_TEAM_MARKER} and no DAG; a read with no session id renders today's board with the
 * visible {@link WORKSPACE_SCOPE_MARKER} line above it.
 *
 * AN UNLABELLED PROJECTION KEEPS TODAY'S BYTES. `source` is set by {@link readScopedWorkflow} and by
 * every reader in this package; a fixture that hand-builds a workflow carries none, and marking that as
 * workspace-level would rewrite the expected output of arms that have nothing to do with scoping. The
 * absent case is therefore rendered exactly as it was — the marker means "this READ was session-less",
 * never "this object is old".
 * @param workflow - the projection, with its own provenance in `source`.
 * @returns the body lines, in scene order.
 */
export function teamWorkflowLines(workflow: TeamWorkflow): string[] {
  /** The provenance this projection carries; ABSENT is neither of the two new states. */
  const scope = workflow.source?.scope
  /** How many teams the workspace holds, when the reader could count them. */
  const held = workflow.source?.workspaceTeams
  if (workflow.team === undefined) {
    /** The lines that follow the team row when this session has no team of its own. */
    const empty: string[] = []
    if (scope === "none") {
      empty.push(`team       ${NO_SESSION_TEAM_MARKER}`)
      if (typeof held === "number" && held > 0) empty.push(`workspace  ${held} team(s) here, none bound to this session`)
      return empty
    }
    return [scope === "workspace" ? `team       ${WORKSPACE_SCOPE_MARKER} (none in this workspace)` : "team       (none in this workspace)"]
  }
  /** The head this body renders; the caller already ruled out its absence. */
  const team = workflow.team
  /** The body lines, in scene order. */
  const lines: string[] = []
  // THE MARKER ROW GOES FIRST, above the board it labels: a reader must know before reading the DAG
  // that this drawing is the workspace's, not necessarily this session's.
  if (scope === "workspace") lines.push(`scope      ${WORKSPACE_SCOPE_MARKER} (no session id on this surface)`)
  lines.push(`team       ${team.name} (${team.id})`)
  lines.push(`phase      ${team.phase}`)
  if (team.staged && team.planReviewState !== undefined) lines.push(`plan       ${team.planReviewState}`)
  if (team.captainSessionId !== undefined) lines.push(`captain    ${team.captainSessionId}`)
  if (team.staged && team.stagedAt !== undefined) lines.push(`staged     ${team.stagedAt}`)
  // A hold row exists ONLY while the watchdog reports this team as held: never a fabricated "ok".
  if (workflow.holds.includes(team.id)) lines.push(`watchdog   HELD (${workflow.holds.join(", ")})`)
  lines.push("")
  lines.push("roster")
  if (workflow.members.length === 0) lines.push("  (no members)")
  for (const member of workflow.members) {
    /** The roster row's fields: name, then role/route when they exist, then status. */
    const parts = [member.name]
    if (member.role !== undefined) parts.push(member.role)
    if (member.route !== undefined) parts.push(member.route)
    parts.push(member.status)
    /** The roster row under construction. */
    let row = `  ${parts.join(" · ")}`
    row += ` · ${member.done}/${member.total}`
    if (member.currentTask !== undefined) row += ` · ${member.currentTask}`
    // Unread is `null` on the official plane: the row prints nothing rather than a fake `0`.
    if (member.unread !== null && member.unread > 0) row += ` · ${member.unread} unread`
    lines.push(row)
  }
  lines.push("")
  lines.push("tasks")
  if (workflow.tasks.length === 0) lines.push("  (no tasks)")
  for (const task of workflow.tasks) {
    /** The row's indent: two cells per dependency level, capped at 12 levels. */
    const indent = "  ".repeat(Math.min(task.depth, 12))
    /** The task row under construction. */
    let row = `${indent}${task.id} [${task.kind ?? "-"}] ${task.subject} · ${task.status}`
    if (task.assignee !== undefined) row += ` @${task.assignee}`
    if (task.attempt !== undefined) row += ` attempt ${task.attempt}`
    if (task.round !== undefined) row += ` r${task.round}`
    if (task.verdict !== undefined) row += ` verdict ${task.verdict}`
    if (task.dependencies.length > 0) row += ` deps=${task.dependencies.join(",")}`
    for (const failed of task.failedDependencies) row += ` failed-dep=${failed}`
    if (task.visual === "blocked") row += " BLOCKED"
    lines.push(row)
  }
  lines.push("")
  /** The task tally, rendered as the summary row. */
  const tasks = workflow.counts
  lines.push(
    `tasks      ${tasks.total} total · ${tasks.completed} completed · ${tasks.inProgress} in progress · ${tasks.pending} pending · ${tasks.claimed} claimed · ${tasks.failed} failed`,
  )
  lines.push(workflow.mail.unread === null ? "mail       (not observable on the official team plane)" : `mail       ${workflow.mail.unread} unread`)
  for (const message of workflow.mail.captainInbox) lines.push(`  ${message.from}: ${message.content}`)
  if (workflow.problems.length > 0) {
    lines.push("")
    for (const problem of workflow.problems) lines.push(`note       ${problem}`)
  }
  return lines
}

/**
 * The plan-scene projection lines (read-only; the action block is appended by the scene).
 *
 * IT CARRIES THE SAME THREE-STATE HONESTY RULE as {@link teamWorkflowLines}, for the same reason: this
 * body draws the roster and the task DAG, so a session-less read here would show another session's
 * board beside this session's plan. The plan's own SESSION-SCOPED half (the staged plan itself) is
 * unaffected — it is read through `planFor(workspace, sessionId)`.
 * @param workflow - the projection, with its own provenance in `source`.
 * @returns the projection lines; an unlabelled projection renders exactly as it did before.
 */
export function planProjectionLines(workflow: TeamWorkflow): string[] {
  /** The provenance this projection carries; ABSENT is neither of the two new states. */
  const scope = workflow.source?.scope
  if (workflow.team === undefined) {
    if (scope === "none") return ["no staged plan for team (none)", `${NO_SESSION_TEAM_MARKER} — no DAG to draw here`]
    return ["no staged plan for team (none)"]
  }
  /** The head this projection renders. */
  const team = workflow.team
  /** The projection lines, in scene order. */
  const lines: string[] = []
  if (scope === "workspace") lines.push(`scope      ${WORKSPACE_SCOPE_MARKER} (no session id on this surface)`)
  lines.push(`team       ${team.name} (${team.id}) · phase ${team.phase} · review ${team.planReviewState ?? "-"}`)
  lines.push(`members    ${workflow.members.length} · tasks ${workflow.tasks.length} · links ${team.links}`)
  // The Web's own runnable gate (`client.js:1459`), restated for the terminal.
  lines.push(`runnable   ${team.runnable ? "yes" : "no"}`)
  // The TUI has no inline editors (NOT-CLAIMED #2), so this is always `none`.
  lines.push("edits      none (the TUI has no inline plan editors)")
  lines.push("")
  lines.push("roster")
  if (workflow.members.length === 0) lines.push("  (no members)")
  for (const member of workflow.members) {
    /** The roster row's fields, rendered as in the workflow scene. */
    const parts = [member.name]
    if (member.role !== undefined) parts.push(member.role)
    if (member.route !== undefined) parts.push(member.route)
    parts.push(member.status)
    lines.push(`  ${parts.join(" · ")} · ${member.done}/${member.total}`)
  }
  lines.push("")
  lines.push("tasks")
  if (workflow.tasks.length === 0) lines.push("  (no tasks)")
  for (const task of workflow.tasks) {
    /** The row's indent: two cells per dependency level, capped at 12 levels. */
    const indent = "  ".repeat(Math.min(task.depth, 12))
    /** The task row under construction. */
    let row = `${indent}${task.id} [${task.kind ?? "-"}] ${task.subject} · ${task.status}`
    if (task.assignee !== undefined) row += ` @${task.assignee}`
    if (task.dependencies.length > 0) row += ` deps=${task.dependencies.join(",")}`
    if (task.visual === "blocked") row += " BLOCKED"
    lines.push(row)
  }
  return lines
}
