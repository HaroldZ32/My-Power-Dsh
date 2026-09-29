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
import { blockingDependencies, cycleIds, derivePhase, idleMembers, memberProgress, readyTasks, summariseTeam, taskVisual } from "./team-store"

/** The route the Web team view polls. Exported so the client and the route cannot drift. */
export const TEAM_STATE_PATH = "/plugins/mpd-team/state"

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

/** The whole payload the Web team view renders. */
export interface TeamWebState {
  /** The route's own success marker; a payload without it is treated as unreadable. */
  ok: boolean
  /** The workspace the record was read from. */
  workspace: string
  /** The session the caller asked about. */
  sessionId: string
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
 * Project one record into the browser payload.
 *
 * PURE, so the whole projection is testable without a server, a socket or a session — and so the
 * client's contract is a value rather than a running handler.
 * @param record - the team record, or undefined when the session has none.
 * @param workspace - the workspace the read happened in.
 * @param sessionId - the session the caller asked about.
 * @param executor - the active backend's kind and reason.
 * @returns the payload.
 */
export function buildTeamState(
  record: TeamRecord | undefined,
  workspace: string,
  sessionId: string,
  executor: { kind: string; reason: string },
): TeamWebState {
  /** The empty payload every early return shares. */
  const empty: TeamWebState = {
    ok: true,
    workspace,
    sessionId,
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

/** The response surface a route handler may rely on, structurally typed. */
interface RouteResponse {
  /** Write the status line and the headers. */
  writeHead: (status: number, headers: Record<string, string>) => void
  /** Write the body. */
  end: (text: string) => void
}

/**
 * Register the team state route on the host's web server.
 *
 * The caller owns the server probe and the lifetime (`ctx.effect`); this function only tolerates a
 * server that cannot register, and answers `{ ok: false, error }` rather than throwing inside a
 * request — a route that throws takes the whole panel down with it.
 * @param webServer - the host's web server, or undefined when this composition has none.
 * @param deps - the record lookup, the executor read, and the lifetime seam.
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
  try {
    deps.effect(() => (webServer as { register: (route: unknown) => unknown }).register({
      kind: "exact",
      path: TEAM_STATE_PATH,
      handler: (req: unknown, res: unknown) => {
        try {
          /** The session this request asks about. */
          const sessionId = sessionOf(req)
          json(res, 200, buildTeamState(deps.recordFor(sessionId), deps.workspace(), sessionId, deps.executor()))
        } catch (error) {
          json(res, 500, { ok: false, error: `mpd-team-core: ${String((error as Error)?.message ?? error)}` })
        }
      },
    }), "mpd-team-core: web state route")
    return true
  } catch (error) {
    deps.warn(`registering ${TEAM_STATE_PATH} failed: ${String((error as Error)?.message ?? error)}`)
    return false
  }
}
