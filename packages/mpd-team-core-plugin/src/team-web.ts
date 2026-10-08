// The team WEB ROUTE: the mpd-owned team, served to the browser.
//
// WHY A ROUTE AND NOT THE CLIENT STORE. Until W4 the Web team tab read the OFFICIAL client
// projection (`useSessions(s => s.projectionsBySession[leadId].values.agentTeam)`), which is the last
// place the official plugin remained the source of truth — and which is EMPTY in exactly the
// compositions the split exists for, because a client store can only carry what a mounted service
// projected. The mpd record is the team; this route serves it.
//
// IT ALSO DECOUPLES THE BODY FROM THE HOST. `dsh-better-sidebar` and the harness's own right sidebar
// are two different extension APIs with two different prop shapes, and a body written against either
// one is a body that only works there. Both can `fetch`, so both get the same JSON and render the
// same view.
//
// The projection mirrors the TUI's (`mpd-tui-plugin/src/team-state.ts`) because the two surfaces
// answer the same question and must not disagree — but it is computed here from the RECORD, which is
// why it can carry `kind`, `attempt`, `round` and `verdict` at all.
import type { TeamRecord } from "./team-store"
import { blockingDependencies, cycleIds, derivePhase, idleMembers, listTeams, memberProgress, readyTasks, summariseTeam, taskVisual, activeTeamId } from "./team-store"
import { listContracts, readHold, readPlan, type StagedPlan } from "./plan-store"
import { readMailbox, readRecords } from "./mailbox-store"

/** The route the Web team view polls. Exported so the client and the route cannot drift. */
export const TEAM_STATE_PATH = "/plugins/mpd-team/state"

/**
 * The route serving the session's STAGED PLAN — what exists BEFORE an approval.
 *
 * A SEPARATE ROUTE BECAUSE IT IS A SEPARATE THING, which is the fact the TUI plan surface got wrong:
 * the team record (`.mpd/team/teams/<teamId>.json`) is materialised AT approval, so before one there
 * is no record to read and a surface that reads only records shows nothing. The staged plan lives in
 * `.mpd/team/staging/<sessionId>.json` and carries its OWN identity, `planId`.
 */
export const TEAM_PLAN_PATH = "/plugins/mpd-team/plan"

/** The route serving the frozen task contracts and the workspace hold. */
export const TEAM_TASK_PATH = "/plugins/mpd-team/task"

/** The route serving the mailbox fold. */
export const TEAM_MAIL_PATH = "/plugins/mpd-team/mail"

/**
 * The route that STREAMS team-state changes instead of being polled.
 *
 * A Server-Sent-Events stream rather than a WebSocket, because every surface this bundle has — a
 * browser tab, a TUI page, a `curl` in a QA lane — can consume one over plain HTTP with no handshake,
 * no extra dependency and no second server; and because the payload is a bare revision, so a client
 * that misses a frame reconnects and re-reads the routes it already knows rather than needing a
 * replayable log. Under the `/plugins/mpd-team/*` family deliberately: a duplicate EXACT route makes
 * the host throw, so the family prefix is what keeps this path from ever colliding with another row's.
 */
export const TEAM_EVENTS_PATH = "/plugins/mpd-team/events"

/** Every route this module registers, so a reader and a test can enumerate them from one place. */
export const TEAM_ROUTES: readonly string[] = [TEAM_STATE_PATH, TEAM_PLAN_PATH, TEAM_TASK_PATH, TEAM_MAIL_PATH, TEAM_EVENTS_PATH]

/**
 * The exact phrase an approval gate demands for one staged plan.
 *
 * ONE IMPLEMENTATION FOR EVERY SURFACE. The Web panel, the TUI scene and any future surface must
 * demand the SAME string, or a captain who learned the gesture in one place is refused in the other —
 * and, worse, two spellings of "the thing you must type" make neither of them the contract. The phrase
 * names the **`planId`**, which is the PRE-approval identity: the team record does not exist yet, so
 * demanding its `teamId` is demanding something that cannot be known at the moment it is asked for.
 * @param planId - the staged plan's own identity (`plan-<instant>`).
 * @returns the exact string the user must type.
 */
export function approvalPhraseFor(planId: string): string {
  return `approve ${planId}`
}

/** The reader key the route answers for, so a log can tell a panel from another consumer. */
export const TEAM_WEB_READER = "web-panel"

/** One member row, as the browser reads it. */
export interface TeamWebMember {
  /** The mpd member id. */
  id: string
  /** Display name. */
  name: string
  /** Optional roster role label. */
  role?: string
  /** The member's own state. */
  status: string
  /** Tasks this member owns that are completed. */
  done: number
  /** Tasks this member owns, in any state. */
  total: number
  /** The first unfinished task this member owns, when there is one. */
  current?: string
  /** `provider/model` when the roster resolved a slot for this member. */
  route?: string
}

/** One task row, as the browser reads it. */
export interface TeamWebTask {
  /** The mpd task id (`T1`). */
  id: string
  /** The task title. */
  subject: string
  /** `requirement` | `work` | `review` | `repair` | `integration`. */
  kind?: string
  /** The task's own state. */
  status: string
  /** The RENDERED state (`blocked` is derived, OPT-1 included). */
  visual: string
  /** The owning member's display name. */
  owner?: string
  /** Claim counter. */
  attempt?: number
  /** Review round. */
  round?: number
  /** Review verdict. */
  verdict?: string
  /** Blockers, in board order. */
  blockedBy: string[]
  /** Blockers that FAILED — reported beside the state, which is the OPT-1 rule. */
  failedBy: string[]
  /** Longest dependency path; the graph's rank. */
  depth: number
}

/** One of the WORKSPACE's teams, as the browser reads it in the session-less listing. */
export interface TeamWebWorkspaceTeam {
  /** The mpd team id (`<team-…>`), which `approve <teamId>` names. */
  id: string
  /** The team name the user reads. */
  name: string
  /** What the team is for. */
  description: string
  /** `staged` | `active` | `idle` | `ended`, derived from the record. */
  phase: string
  /** ISO instant the plan was approved, when it was. */
  approvedAt?: string
  /** ISO instant the team was ended, when it was. */
  endedAt?: string
  /** The task tally, so a reader can tell a finished wave from one still running. */
  tasks: { total: number; completed: number; failed: number }
  /** The roster size. */
  members: number
  /** Whether the index binds this team to the session that asked. */
  active: boolean
}

/** The whole payload the Web team view renders. */
export interface TeamWebState {
  /** The route's own success marker; a payload without it is treated as unreadable. */
  ok: boolean
  /** The workspace the record was read from. */
  workspace: string
  /** The session the caller asked about. */
  sessionId: string
  /**
   * The WORKSPACE's teams, newest first — the answer for a session that has none of its own.
   *
   * WHY IT IS HERE (D2): the record is SESSION-scoped, so a session that did not approve the
   * workspace's team rendered an empty panel while that team sat on disk — the "建了但没用上"
   * experience. `records: []` answers the honest empty state; a NON-EMPTY list is information the
   * panel shows instead of a dead end. The session-scoped `team` below is unchanged, so the TUI and
   * every existing reader of this payload see exactly what they saw before.
   */
  workspaceTeams: {
    /** Every readable record under `.mpd/team/teams`, newest first. */
    records: TeamWebWorkspaceTeam[]
    /** The team the index binds to the session that asked, when it binds one. */
    activeId?: string
  }
  /** The team head, or null when this session has no team. */
  team: {
    /** The mpd team id, which `approve <teamId>` names. */
    id: string
    /** The team name the user reads. */
    name: string
    /** What the team is for. */
    description: string
    /** `staged` | `active` | `idle` | `ended`. */
    phase: string
    /** ISO instant the plan was approved, when it was. */
    approvedAt?: string
    /** Dependency edges across the board. */
    links: number
  } | null
  /** The tally, in the record's own vocabulary. */
  counts: { total: number; completed: number; running: number; ready: number; blocked: number; failed: number; releasedByFailure: number }
  /** The roster. */
  members: TeamWebMember[]
  /** The board, in rank order. */
  tasks: TeamWebTask[]
  /** Task ids on a dependency cycle; a non-empty list is a broken board, reported not hidden. */
  cycles: string[]
  /** Which backend raises this team's members, and why — the split's own state, made visible. */
  executor: { kind: string; reason: string }
  /** Bounded notes about what could not be read. */
  problems: string[]
}

/**
 * Project the workspace's teams into the rows the browser reads.
 *
 * The list counterpart of the single-team head: a session with no team of its OWN still gets the
 * workspace's, which is the whole point of D2. The phase is DERIVED per row through the store's own
 * rule, and the tally comes from the record rather than from the panel counting rendered nodes.
 * @param teams - the workspace's records, as {@link listTeams} answers them.
 * @param activeId - the team the index binds to the session that asked, when it binds one.
 * @returns the listing half of the payload.
 */
export function buildWorkspaceTeams(teams: readonly TeamRecord[], activeId: string | undefined): TeamWebState["workspaceTeams"] {
  return {
    records: teams.map((team) => ({
      id: team.teamId,
      name: team.name,
      description: team.description,
      phase: derivePhase(team),
      ...(team.approvedAt === undefined ? {} : { approvedAt: team.approvedAt }),
      ...(team.endedAt === undefined ? {} : { endedAt: team.endedAt }),
      tasks: {
        total: team.tasks.length,
        completed: team.tasks.filter((task) => task.status === "completed").length,
        failed: team.tasks.filter((task) => task.status === "failed").length,
      },
      members: team.members.length,
      active: team.teamId === activeId,
    })),
    ...(activeId === undefined ? {} : { activeId }),
  }
}

/**
 * Project one record into the browser payload.
 *
 * PURE, so the whole projection is testable without a server, a socket or a session — and so the
 * client's contract is a value rather than a running handler. The workspace listing arrives as an
 * ARGUMENT rather than being read here, so this stays a projection of values: the route reads the
 * directory (and says so in its own name), and a test can pin the listing it wants.
 * @param record - the team record, or undefined when the session has none.
 * @param workspace - the workspace the read happened in.
 * @param sessionId - the session the caller asked about.
 * @param executor - the active backend's kind and reason.
 * @param workspaceTeams - the workspace's own teams, or omitted when the caller did not read them.
 * @returns the payload.
 */
export function buildTeamState(
  record: TeamRecord | undefined,
  workspace: string,
  sessionId: string,
  executor: { kind: string; reason: string },
  workspaceTeams?: TeamWebState["workspaceTeams"],
): TeamWebState {
  /** The workspace listing this payload carries; an absent one reads as "nothing was read", never as a promise. */
  const listing: TeamWebState["workspaceTeams"] = workspaceTeams ?? { records: [] }
  /** The empty payload every early return shares. */
  const empty: TeamWebState = {
    ok: true,
    workspace,
    sessionId,
    workspaceTeams: listing,
    team: null,
    counts: { total: 0, completed: 0, running: 0, ready: 0, blocked: 0, failed: 0, releasedByFailure: 0 },
    members: [],
    tasks: [],
    cycles: [],
    executor,
    problems: [],
  }
  if (record === undefined) return empty
  /** The tallies, the cycles and the per-task rank, computed once from the record. */
  const summary = summariseTeam(record)
  /** The tasks ready to be dispatched right now, by the store's own OPT-1 rule. */
  const ready = new Set(readyTasks(record).map((task) => task.id))
  /** The members free to take work. */
  const idle = new Set(idleMembers(record).map((member) => member.name))
  /** The board, drawn in rank order so the browser can lay it out without re-sorting. */
  const tasks: TeamWebTask[] = record.tasks
    .map((task) => ({
      id: task.id,
      subject: task.subject,
      ...(task.kind === undefined ? {} : { kind: task.kind }),
      status: task.status,
      // The VISUAL state is derived HERE, by the same function the TUI uses, so the two surfaces
      // cannot disagree about what `blocked` means across a refresh.
      visual: taskVisual(task, record.tasks),
      ...(task.owner === undefined ? {} : { owner: task.owner }),
      ...(task.attempt === undefined ? {} : { attempt: task.attempt }),
      ...(task.round === undefined ? {} : { round: task.round }),
      ...(task.verdict === undefined ? {} : { verdict: task.verdict }),
      blockedBy: [...task.blockedBy],
      // OPT-1: a failed blocker does NOT block, and it is reported BESIDE the state so a reader can
      // see that a task is dispatchable only because a prerequisite gave up.
      failedBy: blockingDependencies(record.tasks, task.blockedBy).failed,
      depth: summary.depths.get(task.id) ?? 0,
    }))
    .sort((left, right) => left.depth - right.depth)
  return {
    ok: true,
    workspace,
    sessionId,
    // The workspace listing travels on BOTH shapes: a session that HAS a team still sees its
    // siblings, which is what makes the panel a workspace view rather than a session view.
    workspaceTeams: listing,
    team: {
      id: record.teamId,
      name: record.name,
      description: record.description,
      // DERIVED, never the stored field. A record persists whatever phase it was written with, and
      // a `writeTeam` that followed a task mutation would leave `staged` on an approved team —
      // measured: this line served exactly that until the arm caught it. `derivePhase` is the
      // store's OWN rule, so the payload cannot disagree with the record it describes.
      phase: derivePhase(record),
      ...(record.approvedAt === undefined ? {} : { approvedAt: record.approvedAt }),
      links: summary.links,
    },
    counts: {
      total: summary.total,
      completed: summary.completed,
      running: summary.running,
      ready: ready.size,
      blocked: summary.blocked,
      failed: summary.failed,
      releasedByFailure: summary.releasedByFailure,
    },
    members: record.members.map((member) => {
      /** This member's progress over the tasks it owns. */
      const progress = memberProgress(record, member.name)
      return {
        id: member.id,
        name: member.name,
        ...(member.role === undefined ? {} : { role: member.role }),
        // A member the roster has not settled reads as `idle` when it has nothing in flight, which is
        // the word the browser's status vocabulary uses.
        status: member.status === "running" && idle.has(member.name) ? "idle" : member.status,
        done: progress.done,
        total: progress.total,
        ...(progress.current === undefined ? {} : { current: progress.current }),
        ...(member.route === undefined ? {} : { route: member.route }),
      }
    }),
    tasks,
    cycles: cycleIds(record.tasks),
    executor,
    problems: summary.cycles.length === 0 ? [] : [`cycle ${summary.cycles.join(",")}`],
  }
}

/** The staged-plan payload: what exists BEFORE an approval, keyed by `planId`. */
export interface TeamWebPlan {
  /** The route's own success marker. */
  ok: boolean
  /** The workspace the plan was read from. */
  workspace: string
  /** The session the caller asked about. */
  sessionId: string
  /** The staged plan, or null when this session has none awaiting approval. */
  plan: {
    /** The PRE-approval identity — `plan-<instant>` — and the phrase the approval gate demands. */
    planId: string
    /** The team name the user reads. */
    name: string
    /** What the team is for. */
    description: string
    /** `required` waits for an explicit approval; `automatic` may proceed on its own. */
    approval: string
    /** ISO instant the plan was staged. */
    stagedAt: string
    /** The EXACT string a gate demands before approving this plan. Served, never re-derived. */
    phrase: string
    /** Whether an approval already committed; a second one is refused. */
    approved: boolean
    /** Whether it was discarded instead. */
    discarded: boolean
    /** The teammates it wants raised, and what approval actually created for each. */
    members: Array<{ name: string; description: string; role?: string; id?: string }>
    /** The tasks it wants posted, and the ids approval assigned them. */
    tasks: Array<{ subject: string; description: string; owner?: string; blockedBy: string[]; id?: string }>
  } | null
}

/** The task/hold payload: the frozen contracts and the workspace hold. */
export interface TeamWebTasks {
  /** The route's own success marker. */
  ok: boolean
  /** The workspace the contracts were read from. */
  workspace: string
  /** The frozen acceptance contracts, one per claimed task. */
  contracts: Array<{ taskId: string; subject: string; description: string; claimedBy: string; claimedAt: string; attempt: number; blockedBy: string[] }>
  /** The workspace hold, or null when nothing is held. */
  hold: { reason: string; heldBy: string; heldAt: string } | null
}

/** The mailbox payload: the fold's own per-member view. */
export interface TeamWebMail {
  /** The route's own success marker. */
  ok: boolean
  /** The workspace the mailbox was read from. */
  workspace: string
  /** One row per message, in the fold's order, in the FOLD's own vocabulary. */
  messages: Array<{ id: string; fromName: string; toName: string; subject: string; body: string; sentAt: string; deliveredAt?: string; readAt?: string }>
  /** How many records the fold consumed, so a reader can tell an empty mailbox from an unread one. */
  records: number
}

/**
 * Project the session's staged plan for the browser.
 * @param plan - the plan, or undefined when the session has none staged.
 * @param workspace - the workspace the read happened in.
 * @param sessionId - the session the caller asked about.
 * @returns the payload.
 */
export function buildTeamPlan(plan: StagedPlan | undefined, workspace: string, sessionId: string): TeamWebPlan {
  if (plan === undefined) return { ok: true, workspace, sessionId, plan: null }
  /** The created ids by member NAME, so a staged member shows the id approval gave it. */
  const memberIds = new Map((plan.created?.members ?? []).map((entry) => [entry.name, entry.id]))
  /** The created ids by task SUBJECT, for the same reason. */
  const taskIds = new Map((plan.created?.tasks ?? []).map((entry) => [entry.subject, entry.id]))
  return {
    ok: true,
    workspace,
    sessionId,
    plan: {
      planId: plan.planId,
      name: plan.name,
      description: plan.description,
      approval: plan.approval,
      stagedAt: plan.stagedAt,
      // SERVED, NOT RE-DERIVED. Every consumer that computed this itself would be a second
      // implementation of the gate, free to drift from this one.
      phrase: approvalPhraseFor(plan.planId),
      approved: plan.approvedAt !== undefined,
      discarded: plan.discardedAt !== undefined,
      // The stage's OWN fields only. A staged plan carries no `provider`/`model`/`kind` — routing is
      // resolved at approval by the roster slot, and a task's kind is chosen then too — so projecting
      // them here would invent columns the stage does not have. What it does carry is what the
      // approval gate must show: who, what, and which subjects must close first.
      members: plan.members.map((member) => ({
        name: member.name,
        description: member.description,
        ...(member.role === undefined ? {} : { role: member.role }),
        ...(memberIds.has(member.name) ? { id: memberIds.get(member.name) as string } : {}),
      })),
      tasks: plan.tasks.map((task) => ({
        subject: task.subject,
        description: task.description,
        ...(task.owner === undefined ? {} : { owner: task.owner }),
        blockedBy: [...(task.blockedBy ?? [])],
        ...(taskIds.has(task.subject) ? { id: taskIds.get(task.subject) as string } : {}),
      })),
    },
  }
}

/**
 * Project the frozen contracts and the workspace hold for the browser.
 * @param workspace - the workspace to read.
 * @returns the payload.
 */
export function buildTeamTasks(workspace: string): TeamWebTasks {
  /** The hold, read once so the payload cannot disagree with itself. */
  const hold = readHold(workspace)
  return {
    ok: true,
    workspace,
    // The CONTRACT's own fields. A contract is the FROZEN acceptance text plus who claimed it — it
    // carries no separate `owner`/`acceptance` key, and inventing them would describe a shape the
    // store does not have.
    contracts: listContracts(workspace).map((contract) => ({
      taskId: contract.taskId,
      subject: contract.subject,
      description: contract.description,
      claimedBy: contract.claimedBy,
      claimedAt: contract.claimedAt,
      attempt: contract.attempt,
      blockedBy: [...contract.blockedBy],
    })),
    hold: hold === undefined ? null : { reason: hold.reason, heldBy: hold.heldBy, heldAt: hold.heldAt },
  }
}

/**
 * Project the mailbox fold for the browser.
 * @param workspace - the workspace to read.
 * @returns the payload.
 */
export function buildTeamMail(workspace: string): TeamWebMail {
  /** The folded mailbox, asked for its own messages rather than re-deriving them. */
  const state = readMailbox(workspace) as { messages?: unknown[] }
  // THE FOLD'S OWN FIELD NAMES. A `MailMessage` carries `fromName`/`toName`/`subject`/`body`/`sentAt`
  // and optional `deliveredAt`/`readAt` — there is no `from`/`to`/`content`/`ts`. Projecting invented
  // names yielded a payload of empty strings and `read: false` for every message, which a panel would
  // have rendered as a mailbox full of blank, unread rows.
  /** The message rows, kept to the fields the panel renders. */
  const messages = (Array.isArray(state.messages) ? state.messages : []).map((raw) => {
    /** One message, read leniently: the fold is the contract, not this projection. */
    const entry = (raw ?? {}) as Record<string, unknown>
    return {
      id: String(entry.id ?? ""),
      fromName: String(entry.fromName ?? ""),
      toName: String(entry.toName ?? ""),
      subject: String(entry.subject ?? ""),
      body: String(entry.body ?? ""),
      sentAt: String(entry.sentAt ?? ""),
      ...(entry.deliveredAt === undefined ? {} : { deliveredAt: String(entry.deliveredAt) }),
      ...(entry.readAt === undefined ? {} : { readAt: String(entry.readAt) }),
    }
  })
  // THE RECORD COUNT COMES FROM THE RECORDS, not from the fold: the fold returns `{ messages }` and
  // nothing else, so asking it for a count invented a field that does not exist and read as 0 — which
  // would have told every panel "nothing was ever sent" about a mailbox holding messages.
  return { ok: true, workspace, messages, records: readRecords(workspace).length }
}

/**
 * The ONE plan projection, shared by the route and the service.
 *
 * `buildTeamPlan` is pure and this is the impure half — it resolves the workspace itself, PER CALL,
 * because one host serves many sessions with different workspaces (§6). Both consumers call THIS:
 * the `/plan` route for the browser, and `mpdTeams.planFor` for the TUI. Neither re-reads the staging
 * file, so the two cannot disagree about what is staged or what the gate demands.
 * @param workspace - the workspace to read.
 * @param sessionId - the session whose staged plan is wanted.
 * @returns the payload.
 */
export function planForSession(workspace: string, sessionId: string): TeamWebPlan {
  return buildTeamPlan(readPlan(workspace, sessionId), workspace, sessionId)
}

/** The response surface a route handler may rely on, structurally typed. */
interface RouteResponse {
  /** Write the status line and the headers. */
  writeHead: (status: number, headers: Record<string, string>) => void
  /** Write the body. */
  end: (text: string) => void
}

/**
 * The response surface a STREAMING handler may rely on, structurally typed.
 *
 * `RouteResponse` is deliberately NOT widened: a one-shot JSON route has no business calling `write`,
 * and a stream has no business calling `end(body)`. This is a SECOND, narrower surface for the second
 * kind of route. It is not a new adapter seam — the host's own route type owns the whole response
 * lifecycle and names SSE as a supported use of it ("may hold the response open, e.g. SSE"), so
 * `write` and the lifetime callbacks are part of the contract this module is handed.
 */
interface EventResponse {
  /** Write the status line and the headers. */
  writeHead: (status: number, headers: Record<string, string>) => void
  /** Write one frame; a stream is never compressed, so each call reaches the socket. */
  write: (frame: string) => unknown
  /** Close the stream. */
  end: () => void
  /** Push the head out before the first frame, when the host's response object offers it. */
  flushHeaders?: () => void
  /** Register a lifetime callback; the stream's teardown hangs off `close`. */
  on?: (event: string, listener: () => void) => unknown
}

/** The request surface a streaming handler may rely on: the URL it was asked, and its close event. */
interface EventRequest {
  /** The request URL, which carries the session query parameter like every other route here. */
  url?: unknown
  /** Register a lifetime callback; `close` fires when the client goes away. */
  on?: (event: string, listener: () => void) => unknown
}

/** The interval between keep-alive comments, short enough that no ordinary proxy drops an idle stream. */
const SSE_PING_MS = 15000

/**
 * Register the team state route on the host's web server.
 *
 * The caller owns the server probe and the lifetime (`ctx.effect`); this function only tolerates a
 * server that cannot register, and answers `{ ok: false, error }` rather than throwing inside a
 * request — a route that throws takes the whole panel down with it.
 * @param webServer - the host's web server, or undefined when this composition has none.
 * @param deps - the record lookup, the executor read, the change feed and the lifetime seam.
 * @returns whether the route was registered.
 */
export function registerTeamRoutes(
  webServer: { register: (route: { kind: string; path: string; handler: (req: unknown, res: unknown) => unknown }) => unknown } | undefined,
  deps: {
    /** The record for one session, or undefined when it has no team. */
    recordFor: (sessionId: string) => TeamRecord | undefined
    /** The workspace a read should be attributed to. */
    workspace: () => string
    /** The active backend's kind and reason. */
    executor: () => { kind: string; reason: string }
    /** Own a disposable for the caller's fibre lifetime. */
    effect: (fn: () => unknown, label: string) => unknown
    /** A bounded diagnostic sink. */
    warn: (line: string) => void
    /** The change feed's subscription door; absent in a composition that never built a feed. */
    subscribe?: (workspace: string, listener: () => void) => () => void
    /** The change feed's counter; a stream is refused unless BOTH it and `subscribe` are present. */
    revision?: (workspace: string) => number
  },
): boolean {
  if (webServer === undefined || typeof webServer.register !== "function") return false
  /** Answer one JSON response, using only the two methods a handler may rely on. */
  const json = (res: unknown, status: number, body: unknown): void => {
    /** The response, narrowed to the write surface this module uses. */
    const out = res as RouteResponse
    out.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" })
    out.end(JSON.stringify(body))
  }
  /** The session id the request names, or the empty string when it names none. */
  const sessionOf = (req: unknown): string => {
    /** The request URL, or "" when it carries none. */
    const url = String((req as { url?: unknown }).url ?? "")
    /** Offset of the query string, or -1 when there is none. */
    const at = url.indexOf("?")
    if (at < 0) return ""
    /** The raw `sessionId` value, or null when the parameter is absent. */
    const value = new URLSearchParams(url.slice(at + 1)).get("sessionId")
    return value === null ? "" : value.trim()
  }
  /** Register one exact route, answering a 500 payload rather than throwing inside a request. */
  const mount = (path: string, build: (req: unknown) => unknown): boolean => {
    try {
      deps.effect(() => (webServer as { register: (route: unknown) => unknown }).register({
        kind: "exact",
        path,
        handler: (req: unknown, res: unknown) => {
          try {
            json(res, 200, build(req))
          } catch (error) {
            // A route that throws takes the whole panel down with it; this one answers.
            json(res, 500, { ok: false, error: `mpd-team-core: ${String((error as Error)?.message ?? error)}` })
          }
        },
      }), `mpd-team-core: web route ${path}`)
      return true
    } catch (error) {
      deps.warn(`registering ${path} failed: ${String((error as Error)?.message ?? error)}`)
      return false
    }
  }
  /** Whether every route registered; the caller logs one line per run, not per route. */
  let all = true
  /**
   * Register one exact STREAMING route, whose handler owns the response for the client's whole session.
   *
   * A separate helper from {@link mount} on purpose: `mount` answers once and closes, this one answers
   * and then KEEPS the response open, so it needs its own response surface and its own failure
   * containment — an uncaught throw in here is an uncaught throw inside the host's request listener.
   * @param path - the exact route path to register.
   * @param handler - the streaming handler; it owns everything after `writeHead`.
   * @returns whether the route was registered.
   */
  const mountStream = (path: string, handler: (req: unknown, res: unknown) => void): boolean => {
    try {
      deps.effect(() => (webServer as { register: (route: unknown) => unknown }).register({
        kind: "exact",
        path,
        handler: (req: unknown, res: unknown) => {
          try {
            handler(req, res)
          } catch (error) {
            deps.warn(`the ${path} stream failed: ${String((error as Error)?.message ?? error)}`)
          }
        },
      }), `mpd-team-core: web route ${path}`)
      return true
    } catch (error) {
      deps.warn(`registering ${path} failed: ${String((error as Error)?.message ?? error)}`)
      return false
    }
  }
  /**
   * Answer one Server-Sent-Events stream of team-state revisions.
   *
   * THE FRAMES ARE THE CONTRACT and the client is deliberately dumb: `retry: 1000` then an
   * `event: hello` frame carrying the current revision, then one unnamed `data:` frame per change,
   * then nothing but `: ping` comments while the team is quiet. A revision is all a client needs —
   * every surface already knows which routes to re-read, so the stream carries no team payload and
   * cannot go stale between frames.
   * @param req - the request, whose `close` event is the teardown trigger.
   * @param res - the response, held open for the lifetime of the stream.
   */
  const events = (req: unknown, res: unknown): void => {
    /** The subscription door; absent in a composition that mounted this module without a feed. */
    const subscribe = deps.subscribe
    /** The counter; a stream needs BOTH doors, so a half-wired feed is refused rather than half-served. */
    const revision = deps.revision
    // A REFUSAL THAT ANSWERS. A stream that cannot be served must be a normal error response: never a
    // throw inside a request, and never a response held open with nothing ever written to it, which is
    // what a client cannot tell apart from a healthy idle stream.
    if (subscribe === undefined || revision === undefined) {
      json(res, 503, { ok: false, error: "mpd-team-core: the team change feed is unavailable in this composition" })
      return
    }
    /** The response, narrowed to the streaming surface this handler uses. */
    const out = res as EventResponse
    // PER REQUEST, never cached across requests: one host serves many sessions with different
    // workspaces, and each panel asks about its own. `deps.workspace()` is the same impure edge the
    // JSON routes read, and the session comes from the SAME query parameter they use.
    /** The workspace this stream follows. */
    const workspace = deps.workspace()
    /** The session the request names, recorded on the open line so a log can tell one panel from another. */
    const sessionId = sessionOf(req)
    /** The revision reader, contained: a broken counter must refuse the stream, not redden the host. */
    const revisionNow = (): number => {
      try { return revision(workspace) } catch { return 0 }
    }
    try {
      out.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        // `no-transform` is the half that matters for a stream: it forbids a proxy from re-encoding or
        // coalescing the body, which is exactly how a buffering middlebox turns SSE into a freeze.
        "cache-control": "no-store, no-transform",
        "connection": "keep-alive",
        // Named explicitly even though the host's own compression filter already skips
        // `text/event-stream`: a reverse proxy in front of the host honours THIS header, and the two
        // layers must agree to leave the stream alone.
        "x-accel-buffering": "no",
      })
      // THE HEAD IS FLUSHED EXPLICITLY, so the client's `EventSource` reports OPEN — and a QA lane's
      // `curl -N` prints the first bytes — before any change has happened. The host does not compress
      // this content type, so `write` itself is unbuffered; this call is about the head, which
      // `writeHead` alone may hold until the first body byte.
      if (typeof out.flushHeaders === "function") out.flushHeaders()
      out.write("retry: 1000\n\n")
      out.write(`event: hello\ndata: ${JSON.stringify({ rev: revisionNow() })}\n\n`)
    } catch (error) {
      deps.warn(`opening the events stream failed: ${String((error as Error)?.message ?? error)}`)
      try { out.end() } catch { /* the socket is already gone */ }
      return
    }
    /** The keep-alive interval: a comment every 15 s, which is what keeps an idle stream a stream. */
    const ping = setInterval((): void => {
      try { out.write(": ping\n\n") } catch { /* the teardown below owns the handle */ }
    }, SSE_PING_MS)
    // A keep-alive timer must never be the reason the server stays up once every client is gone.
    /** The timer handle's optional `unref`, absent on some runtimes. */
    const unref = (ping as { unref?: unknown }).unref
    if (typeof unref === "function") (unref as () => void).call(ping)
    /** The subscription, or a no-op when subscribing itself was refused. */
    let unsubscribe: () => void = (): void => {}
    try {
      unsubscribe = subscribe(workspace, (): void => {
        // Read at FLUSH time, so a burst coalesced into one call still carries the newest revision.
        try { out.write(`data: ${JSON.stringify({ rev: revisionNow() })}\n\n`) } catch { /* closed */ }
      })
    } catch (error) {
      deps.warn(`subscribing the events stream failed: ${String((error as Error)?.message ?? error)}`)
    }
    /** Whether this stream has been torn down, so the two close events release its resources once. */
    let closed = false
    /** Release the interval and the subscription; idempotent, and safe to call from any callback. */
    const close = (): void => {
      if (closed) return
      closed = true
      clearInterval(ping)
      try { unsubscribe() } catch { /* a broken disposer must not escape the teardown */ }
    }
    // CLEANUP HANGS OFF THE LIFETIME OF THE REQUEST *AND* THE RESPONSE, because either can be the one
    // a host reports. Without it every page visit would leave a listener in the feed and an interval
    // on the event loop — the leak that turns a notification substrate into a slow one.
    if (typeof (req as EventRequest).on === "function") (req as EventRequest).on?.("close", close)
    if (typeof out.on === "function") out.on("close", close)
    deps.warn(`the events stream opened for ${workspace} (session=${sessionId === "" ? "none" : sessionId})`)
  }
  // THE FIVE ROUTES ARE ONE FAMILY, registered together so a panel cannot find one and miss another.
  // `/state` serves the mpd RECORD (what exists after approval); `/plan` serves the STAGED PLAN (what
  // exists before one, keyed by `planId`); `/task` and `/mail` serve the contract/hold and the mailbox
  // fold; `/events` STREAMS the changes those four would otherwise be polled for. Splitting them is
  // deliberate: a surface that reads only records cannot show a staged plan, which is exactly the
  // confusion that made the TUI plan panel claim no approval was possible.
  // `/state` serves the mpd RECORD (what exists after approval); `/plan` serves the STAGED PLAN (what
  // exists before one, keyed by `planId`); `/task` and `/mail` serve the contract/hold and the mailbox
  // fold. Splitting them is deliberate: a surface that reads only records cannot show a staged plan,
  // which is exactly the confusion that made the TUI plan panel claim no approval was possible.
  all = mount(TEAM_STATE_PATH, (req) => {
    /** The session this request asks about. */
    const sessionId = sessionOf(req)
    /** The workspace this request is attributed to, resolved PER CALL like every other read here. */
    const workspace = deps.workspace()
    // THE WORKSPACE LISTING IS READ HERE, at the impure edge, and passed into the projection: the
    // session-scoped record stays exactly what it was, and a session with none now renders the
    // workspace's teams instead of a dead empty state (D2). `activeTeamId` is the index's answer for
    // THIS session, which is what marks the row the panel should call active.
    return buildTeamState(deps.recordFor(sessionId), workspace, sessionId, deps.executor(), buildWorkspaceTeams(listTeams(workspace), activeTeamId(workspace, sessionId)))
  }) && all
  all = mount(TEAM_PLAN_PATH, (req) => {
    /** The session whose staged plan is asked for. */
    const sessionId = sessionOf(req)
    // The SHARED projection — the same call the service exposes to the TUI, so the two cannot drift.
    return planForSession(deps.workspace(), sessionId)
  }) && all
  all = mount(TEAM_TASK_PATH, () => buildTeamTasks(deps.workspace())) && all
  all = mount(TEAM_MAIL_PATH, () => buildTeamMail(deps.workspace())) && all
  // LAST, and streaming: it is the only route whose handler does not return a body, so it registers
  // through its own helper rather than through `mount`'s one-shot shape.
  all = mountStream(TEAM_EVENTS_PATH, events) && all
  return all
}
