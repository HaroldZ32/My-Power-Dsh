// mpd-team-core-plugin: the team RECORD and the team WORKFLOW the official Agent Teams plugin does not ship.
//
// WHY THIS EXISTS. Harness 0.1.7-rc.2 replaced the vendored `agent-teams` body with an official
// plugin that owns the RUNTIME — roster, shared board, mailbox, continuable teammates — and
// nothing else. The retired body also carried a WORKFLOW around that runtime: a team staged as a
// plan the user can read, edit and approve before anybody exists; a task contract frozen at claim
// time with a monotonic attempt counter; a halt that stops new dispatch without ending the team;
// and an archive instead of a delete. Every one of those is a deliberate review point, and none
// of them has a field on the official service, so they live here as a SIDECAR:
//
//   <workspace>/.mpd/team/staging/<sessionId>.json   the staged plan
//   <workspace>/.mpd/team/contracts/<taskId>.json    the frozen contract + attempt
//   <workspace>/.mpd/team/hold.json                  the halt
//   <workspace>/.mpd/team/dispatch.json              the dispatch ledger (who is working what)
//   <workspace>/.mpd/team/archive/<planId>/          what was staged, kept
//
// The sidecar is NEVER a second source of team truth: the roster and the board stay the official
// service's, read and written through the ADAPTER, and `agent_teams_status` prints both halves
// side by side so a reader can see which is which.
//
// NAMING. The tools keep the retired `agent_teams_*` names on purpose. They are the vocabulary
// this bundle's captains, skills and docs already use, and a plan/task contract is the same
// concept under either implementation — the alternative (inventing new names for old ideas) is
// what makes a migration unreadable.
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { rowLogLine, createDshAdapter, dshSeamInject, DSH_SEAM_COMMANDS, DSH_SEAM_TOOLS, type DshAdapter, type DshToolExec } from "../../mpd-dsh-adapter-plugin/src/index"
import {
  inboxOf,
  markDelivered,
  markRead,
  readMailbox,
  send as sendMail,
  summarise,
  undeliveredOf,
  unreadOf as unreadMessages,
} from "./mailbox-store"
import {
  assign,
  dispatchMessage,
  planDispatch,
  reconcile,
  release,
  type DispatchLedger,
} from "./dispatch"
import {
  addMember,
  addTask,
  archivePlan,
  claimContract,
  classifyBlocker,
  clearHold,
  listContracts,
  newPlanId,
  placeHold,
  readContract,
  readHold,
  readPlan,
  stagePlan,
  writePlan,
  type BlockerForm,
  type StagedMember,
  type StagedPlan,
  type StagedTask,
} from "./plan-store"
import { planForSession, registerTeamRoutes, TEAM_ROUTES, type TeamWebPlan } from "./team-web"
import { ChangeFeed } from "./change-feed"
import {
  activeTeamId,
  addTeamMember,
  addTeamTask,
  blockingDependencies,
  casClaimTask,
  casCloseTask,
  createTeam,
  idleMembers,
  readyTasks,
  deleteTeam,
  derivePhase,
  listTeams,
  losslessSummary,
  memberProgress,
  onTeamStateWritten,
  readTeam,
  recordNamesMember,
  summariseTeam,
  taskDepths,
  taskVisual,
  unbindActiveTeam,
  updateTeamMember,
  updateTeamTask,
  withDerivedPhase,
  writeTeam,
  type TeamRecord,
  type TeamTaskRecord,
} from "./team-store"

/** The cordis plugin name, matched against this row's id in the bundle patch. */
export const name = "mpd-team-core"
// INJECT: the TOOLS and COMMANDS seams (both resolved through the adapter, never on the raw
// ctx — the D6 gate polices that) and NOT the team plane itself: `ctx.agentTeams` is reached
// exclusively through `dsh.team*`, so a harness rename lands in the adapter. The two NAMES come
// from the adapter's seam vocabulary, so a renamed harness service is an edit in ONE file.
export const inject: string[] = dshSeamInject(DSH_SEAM_TOOLS, DSH_SEAM_COMMANDS)

/**
 * The service id this row publishes: the bundle's OWN team read surface.
 *
 * Every mpd surface that used to reconstruct a team from `dsh.teamLiveTeams()` — the TUI scenes,
 * the web panel, the watchdog, the workmate in-use gate — resolves this instead. It is the seam
 * that makes the separation real: a consumer reads the mpd record and never asks the official
 * plane what the team is, so the team plane survives a composition where the official service is
 * absent or unmountable (which is exactly the `dsh-tui` case).
 */
export const TEAMS_SERVICE = "mpdTeams"

/** The read surface published as {@link TEAMS_SERVICE}; every member is synchronous and non-throwing. */
export interface MpdTeamsService {
  /** Every team this workspace holds, newest first. */
  list: (workspace: string) => TeamRecord[]
  /** One team by id, or undefined. */
  get: (workspace: string, teamId: string) => TeamRecord | undefined
  /** The team bound to one Lead session, or undefined when that session has none. */
  active: (workspace: string, sessionId?: string) => TeamRecord | undefined
  /** The tallies, edges, cycles and per-task rank of one team. */
  summary: (record: TeamRecord) => ReturnType<typeof summariseTeam>
  /** The visual state a renderer draws for one task of one team (`blocked` is derived here). */
  visual: (record: TeamRecord, taskId: string) => string
  /** The completed/total counts and the current task of one member. */
  progress: (record: TeamRecord, name: string) => ReturnType<typeof memberProgress>
  /** The team ids this workspace holds, so a gate can ask "is any of these live?" without reading. */
  teamIds: (workspace: string) => string[]
  /** The member display names of one team, which is what the workmate in-use gate matches on. */
  memberNames: (workspace: string) => string[]
  /**
   * The STAGED PLAN of one session — what exists BEFORE an approval — or a null-plan payload.
   *
   * THE SAME PROJECTION THE `/plan` ROUTE SERVES, deliberately: a surface that re-read the staging
   * file itself would be a second implementation of both the projection and the approval gate, free to
   * drift from the Web panel's. This is the shared half; a surface only decides how to DRAW it.
   * @param workspace - the workspace to read.
   * @param sessionId - the session whose staged plan is wanted.
   * @returns the payload, with `plan: null` when that session has nothing staged.
   */
  planFor: (workspace: string, sessionId: string) => TeamWebPlan
  /** Subscribe to change notifications for one workspace; the returned disposer is idempotent. */
  subscribe: (workspace: string, listener: () => void) => () => void
  /** A monotonically increasing revision of one workspace's team state; 0 before any change is seen. */
  revision: (workspace: string) => number
}

/** A tool result narrow enough for the adapter's renderer. */
const text = (value: unknown): { type: "text"; text: string }[] => [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }]

/**
 * The watchdog's answer for one session's team.
 *
 * THREE STATES, because two cannot be honest: `held` refuses the dispatch pass, `free` lets it
 * through, and `not-readable` lets it through WHILE SAYING SO — a hold that cannot be read is
 * reported as `not-readable`, never as a hold, so a broken reader can neither park a team nor lie
 * about why it did.
 */
export interface WatchdogHoldRead {
  /** What the watchdog service answered. */
  state: "held" | "free" | "not-readable"
  /** Why, for `held` and `not-readable`; absent for `free`. */
  reason?: string
}

/**
 * What a session's team resolution answered: the team, or the sentence that says why none resolved.
 *
 * TWO FIELDS RATHER THAN `TeamRecord | undefined`, because the two ways of resolving nothing are
 * different facts and a caller must be able to say which one it hit: a session with NO team at all
 * gets the standing `approve a plan first` sentence, while a session that is a member of MORE THAN
 * ONE team gets a refusal naming the ambiguity — guessing there would silently bind a board action to
 * the wrong team. `record` is present exactly when the resolution was unique.
 */
interface TeamResolution {
  /** The one team this session belongs to; absent when nothing (or more than one thing) resolved. */
  record?: TeamRecord
  /** Why nothing resolved, already a sentence a refusal quotes; absent when a record did resolve. */
  refusal?: string
}

/** The dispatch ledger path: `<workspace>/.mpd/team/dispatch.json`. */
const dispatchPath = (workspace: string): string => join(workspace, ".mpd", "team", "dispatch.json")

/** Read the ledger; a missing or unreadable file is an empty ledger, never a crash. */
function readLedger(workspace: string): DispatchLedger {
  try {
    /** The parsed ledger, accepted only when it is a plain object; anything else reads as empty. */
    const raw = JSON.parse(readFileSync(dispatchPath(workspace), "utf8")) as DispatchLedger
    return raw !== null && typeof raw === "object" ? raw : {}
  } catch {
    return {}
  }
}

/**
 * Persist the ledger. Throws only on a real write failure.
 *
 * ATOMIC (T7): the bytes land in a sibling temp file that is then renamed over the target — the same
 * shape `team-store.ts#writeJson` uses — so a reader sees either the whole old ledger or the whole new
 * one. Before this the plain `writeFileSync` could be observed half-written, and a reader who caught it
 * mid-write got a `JSON.parse` throw and the `catch` above answering `{}` — i.e. it silently read a
 * ledger that had LOST every existing pairing. The temp file lives in the SAME directory, so the
 * rename stays on one filesystem.
 */
function writeLedger(workspace: string, ledger: DispatchLedger): void {
  mkdirSync(join(workspace, ".mpd", "team"), { recursive: true })
  /** The sibling temp file this write lands in before the rename. */
  const temp = dispatchPath(workspace) + ".tmp-" + process.pid
  writeFileSync(temp, JSON.stringify(ledger, null, 2) + "\n")
  renameSync(temp, dispatchPath(workspace))
}

/** The rendered one-line summary of a staged plan. */
function describePlan(plan: StagedPlan | undefined): string {
  if (plan === undefined) return "no staged plan"
  /** The plan's lifecycle word, derived in approval-before-discard order so it cannot be both. */
  const state = plan.approvedAt !== undefined ? "approved" : plan.discardedAt !== undefined ? "discarded" : "staged"
  return `${plan.planId} (${state}): ${plan.members.length} member(s), ${plan.tasks.length} task(s)`
}

/**
 * One list argument as a string array, or `undefined` when the caller sent no list at that key.
 *
 * The tool surface reads its arguments defensively (the registered parameter schema is advisory —
 * the harness's strict argument validation belongs to the typed `defineTool` path, not to the
 * `tools.register` seam this row uses), so every list is normalised here before it reaches a store.
 *
 * @param value - the raw argument at one key, of unknown shape.
 * @returns the entries as strings, or `undefined` when the key held no array.
 */
function stringList(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.map(String) : undefined
}

/**
 * Read a written blocker list back to the caller, one entry per reference, in written order.
 *
 * The WRITE-TIME half of R21: `agent_teams_plan {action:"create_task"}` answers with this, so a captain
 * learns what their text means while they are still writing the plan, instead of meeting it at approval
 * time as a board whose graph quietly flattened. Nothing here refuses a reference — a forward position
 * is legitimate — the reading only names the form.
 * @param plan - the plan as it stands, including the task just appended.
 * @param references - the references exactly as the caller wrote them.
 * @returns one `{ reference, form }` entry per reference, in order.
 */
function blockerReading(plan: StagedPlan, references: readonly string[]): Array<{ reference: string; form: BlockerForm }> {
  return references.map((reference) => ({ reference, form: classifyBlocker(plan, reference) }))
}

/**
 * The sentence the write-time reading prints: what resolved, and what named nothing this plan can
 * resolve. An empty string when every reference read as a form the approval can resolve.
 * @param blockers - the reading the tool is returning.
 * @returns one line, or `""` when nothing needs saying.
 */
function blockerSentence(blockers: unknown): string {
  if (!Array.isArray(blockers) || blockers.length === 0) return ""
  /** The entries whose form names nothing this plan can resolve. */
  const unknown = blockers.filter((entry: { form?: string }) => entry?.form === "unknown").map((entry: { reference?: string }) => String(entry?.reference ?? ""))
  /** The forms seen, in written order, so the answer shows how the rest WILL resolve. */
  const forms = [...new Set(blockers.map((entry: { form?: string }) => String(entry?.form ?? "?")))].join("/")
  if (unknown.length === 0) return ` — blocked_by reads as ${forms}`
  return ` — WARNING: blocked_by ${unknown.map((reference) => `"${reference}"`).join(", ")} name(s) no task this plan can resolve (only a position like "2", a staged subject, or a board id like "T2" resolves); approval will report it and draw no edge`
}

/**
 * Resolve the adapter once per call: the mounted `mpdDsh` service when there is one, and a
 * standalone instance otherwise (unit tests, or a composition that mounts this plugin alone).
 */
function adapterFor(ctx: any): DshAdapter {
  /** The mounted adapter service, when this composition has one. */
  const mounted = typeof ctx?.get === "function" ? ctx.get("mpdDsh") : undefined
  return (mounted as DshAdapter | undefined) ?? createDshAdapter(ctx)
}

/** The calling session's id, or `"workspace"` when the surface has no session (a web route). */
function sessionIdOf(exec: DshToolExec | undefined): string {
  /** The calling agent, read defensively: a route-driven call may carry no session at all. */
  const agent = exec?.agent as any
  /** Candidate session id, trying the session, then the flattened field, then the agent id. */
  const id = agent?.session?.id ?? agent?.sessionId ?? agent?.id
  return typeof id === "string" && id !== "" ? id : "workspace"
}

/** Row entry point: build the adapter once, then register the five tools and the `/agent-teams` command. */
export function apply(ctx: any): void {
  /** The adapter facade — the only contact surface this row has with the harness seams. */
  const dsh = adapterFor(ctx)
  /** Registration disposers, run together on row disposal and counted in the boot line below. */
  const disposers: Array<() => void> = []
  /** The clock seam: one place to substitute in a test, and the reason every store takes a `Date`. */
  const now = (): Date => new Date()

  /**
   * THE CHANGE FEED: the push substrate every other mpd surface subscribes to.
   *
   * It is built FIRST, before the service that publishes it, for the same reason the service is
   * published before the tools: a consumer that resolves `mpdTeams` during this row's own activation
   * must find a live feed rather than a member that throws when called. Constructing it also registers
   * its hook on the store's writers (`onTeamStateWritten`), which is what makes this process's OWN
   * mutations — a tool call, an approval, a dispatch pass — notify without polling anything.
   *
   * DISPOSED WITH THE ROW: the hook, the debounce timers and every `fs.watch` handle go together, so a
   * reload cannot leave a dead feed observing writes or a stale watcher holding the teams directory.
   */
  const feed = new ChangeFeed({ warn: (line: string): void => { rowLogLine("mpd-team-core", line) } })
  disposers.push((): void => { feed.dispose() })

  /**
   * THE TEAM EXECUTOR: the ONE seam a member is raised through and a message delivered to.
   *
   * Resolved per CALL rather than cached, because which backend is active can change when a
   * service becomes ACTIVE later — and because `teamExecutor()` is TOTAL, so a caller never has to
   * feature-detect: a composition with no backend at all gets an executor whose every call refuses
   * with a sentence. That is what lets this row register its tools unconditionally and work in a
   * `dsh-tui` composition, where the official service cannot mount.
   */
  const executor = (): ReturnType<DshAdapter["teamExecutor"]> => dsh.teamExecutor()

  /** Resolve the workspace + session for one call. */
  const where = (exec: DshToolExec | undefined): { workspace: string; sessionId: string } => ({ workspace: dsh.workspaceRoot(exec), sessionId: sessionIdOf(exec) })

  /** Read the staged plan for a call, or fail with a sentence the captain can act on. */
  const requirePlan = (exec: DshToolExec | undefined): { workspace: string; sessionId: string; plan: StagedPlan } => {
    /** The call's workspace and session, resolved once so the plan lookup and the write agree. */
    const { workspace, sessionId } = where(exec)
    /** The session's staged plan, or undefined when nothing is staged yet. */
    const plan = readPlan(workspace, sessionId)
    if (plan === undefined) throw new Error("no team is staged in this session — call agent_teams_create first")
    if (plan.approvedAt !== undefined) throw new Error(`plan ${plan.planId} is already approved; stage a new one to change the team`)
    return { workspace, sessionId, plan }
  }

  /**
   * The hold the TEAM WATCHDOG has placed on this session's team, as a refusal sentence.
   *
   * The watchdog's hold used to be carried and consulted by nobody, while `agent_teams_dispatch`
   * read only its own workspace-wide `hold.json` — so a team the watchdog had parked stayed
   * dispatchable, which is the one thing a preserve-hold exists to prevent. The two holds are
   * different things and BOTH stop a pass: `hold.json` halts the workspace, the watchdog's halts one
   * team. Reading the record is what makes this possible at all, because only the record says which
   * team this session's dispatch belongs to.
   *
   * Fail-open: an absent service, an unknown team or a throwing read answers `free` (or
   * `not-readable`, which is REPORTED and still lets the pass through), so a composition without the
   * watchdog dispatches exactly as it did before.
   * @param workspace - the workspace the pass runs in.
   * @param sessionId - the Lead session whose team is being dispatched.
   * @returns the discriminated reading; see {@link WatchdogHoldRead}.
   */
  const readWatchdogHold = (workspace: string, sessionId: string): WatchdogHoldRead => {
    try {
      /** This session's team, or undefined when nothing has been approved here. */
      const record = recordFor(workspace, sessionId)
      if (record === undefined) return { state: "free" }
      /** The watchdog's own service, read defensively: it is another row and may be absent. */
      const watchdog = typeof (ctx as { get?: unknown })?.get === "function" ? (ctx as { get: (id: string) => any }).get("mpdWatchdog") : undefined
      // The ROW IS ABSENT: the watchdog's own FAIL-OPEN RULE applies ("the watchdog can only ever ADD
      // a decline; it can never keep a team stopped because its own row failed to load"), so this is
      // `free` — not `not-readable`, which is reserved for a service that answered badly.
      if (watchdog === undefined || watchdog === null) return { state: "free" }
      if (typeof watchdog.isHeld !== "function") return { state: "not-readable", reason: "the mpdWatchdog service exposes no isHeld()" }
      // THE ONLY FIELD A GATE MAY BRANCH ON is `held` (the watchdog's own documented gate call is
      // `isHeld(teamId, workspace)?.held === true`). Reading the OBJECT for truthiness is the defect
      // measured on 2026-10-02: every answer is a HoldView object, so `{held: false}` refused every
      // pass with "the team watchdog holds <team>" while the watchdog's own store said not-held —
      // while `session-watchdog-resume` and `agent_teams_control resume` both answered "not held".
      const view = watchdog.isHeld(record.teamId, workspace)
      if (view === null || typeof view !== "object" || typeof view.held !== "boolean") {
        return { state: "not-readable", reason: "mpdWatchdog.isHeld() answered without a boolean `held`" }
      }
      if (view.held !== true) return { state: "free" }
      return { state: "held", reason: `the team watchdog holds ${record.teamId}` }
    } catch (error) {
      return { state: "not-readable", reason: String((error as Error)?.message ?? error) }
    }
  }

  /**
   * The mpd team record bound to one session — the team itself, once one has been approved.
   *
   * THREE ARMS, IN THIS ORDER, so nothing that resolved before changes meaning:
   *   1. THE BOUND INDEX (the fast path) — the id `approve` wrote for this session.
   *   2. THE RECORDED LEAD — when the index is missing (a hand-removed `teams.json`, a workspace copied
   *      without it, a record written by another surface) the newest record whose `leadSessionId` is
   *      this session answers instead, so the team is never lost to a bookkeeping file.
   *   3. THE RECORDED MEMBER (defect D5a) — a teammate is neither the index's key nor any record's lead,
   *      so before this arm existed a MEMBER resolved nothing and every board action refused with
   *      `no team record in this workspace — approve a plan first`; MEASURED on a real session during
   *      the tui-dag-highlight wave, where a member could claim a task but never close its own row.
   *      The roster read is the DURABLE one (`recordNamesMember` matches the member's recorded handle
   *      and name), never a guess from the session's shape.
   *
   * AMBIGUITY IS REFUSED, NOT GUESSED: a session recorded on the roster of more than one team resolves
   * NONE and says so, because binding a board write to the wrong team is worse than refusing it.
   *
   * Never throws — a status render cannot be taken down by a bad record.
   * @param workspace - the workspace to read.
   * @param sessionId - the session whose team is wanted.
   * @returns the resolution; see {@link TeamResolution}.
   */
  const resolveTeam = (workspace: string, sessionId: string): TeamResolution => {
    try {
      /** The bound team id, when the index still carries one. */
      const bound = activeTeamId(workspace, sessionId)
      if (bound !== undefined) {
        /** The bound record, which may have been deleted out from under the index. */
        const record = readTeam(workspace, bound)
        if (record !== undefined) return { record }
      }
      /** Every team this workspace holds, newest first. */
      const teams = listTeams(workspace)
      // Newest first, so a session that approved several waves gets its LATEST team.
      /** The newest team this session LEADS, if any. */
      const leading = teams.find((record) => record.leadSessionId === sessionId)
      if (leading !== undefined) return { record: leading }
      /** Every team whose durable roster names this session as a member. */
      const memberOf = teams.filter((record) => recordNamesMember(record, [sessionId]))
      if (memberOf.length === 1) return { record: memberOf[0] }
      if (memberOf.length > 1) {
        return {
          refusal: `this session is on the roster of ${memberOf.length} teams in this workspace (${memberOf.map((record) => record.teamId).join(", ")}) and the record does not say which one it works on — run this from the team's lead session, or remove the duplicate roster entry`,
        }
      }
      return {}
    } catch {
      return {}
    }
  }

  /**
   * The team bound to one session, or `undefined` when it has none — the reading a RENDER takes.
   *
   * The sentence-carrying form is {@link resolveTeam}; this one is the same resolution with the
   * refusal dropped, for the callers that only draw (the `mpdTeams` service, the status payload, the
   * mailbox roster) and have nothing to refuse.
   * @param workspace - the workspace to read.
   * @param sessionId - the session whose team is wanted.
   * @returns the record, or undefined when this session has no single team.
   */
  const recordFor = (workspace: string, sessionId: string): TeamRecord | undefined => resolveTeam(workspace, sessionId).record

  // ── the mpd team read surface: THE seam every other mpd plugin reads ────────
  // Published before the tools so a consumer that resolves the service during this row's own
  // activation still finds it. Every member is synchronous and non-throwing: it is called from
  // render paths (the TUI scene, the web panel) and from a mutation gate (workmate rename/delete),
  // and neither may be taken down by a bad record.
  if (typeof (ctx as { provide?: unknown })?.provide === "function") {
    try {
      ;(ctx as { provide: (id: string, value: unknown) => unknown }).provide(TEAMS_SERVICE, {
        list: (workspace: string) => { try { return listTeams(workspace) } catch { return [] } },
        get: (workspace: string, teamId: string) => { try { return readTeam(workspace, teamId) } catch { return undefined } },
        active: (workspace: string, sessionId?: string) => recordFor(workspace, sessionId ?? "workspace"),
        summary: (record: TeamRecord) => summariseTeam(record),
        visual: (record: TeamRecord, taskId: string) => {
          /** The task asked about, or undefined when the id is not on this board. */
          const task = record.tasks.find((candidate) => candidate.id === taskId)
          return task === undefined ? "unknown" : taskVisual(task, record.tasks)
        },
        progress: (record: TeamRecord, name: string) => memberProgress(record, name),
        teamIds: (workspace: string) => { try { return listTeams(workspace).map((record) => record.teamId) } catch { return [] } },
        memberNames: (workspace: string) => {
          try {
            /** Every member name of every team in this workspace, deduplicated. */
            const names = new Set<string>()
            for (const record of listTeams(workspace)) for (const member of record.members) names.add(member.name)
            return [...names]
          } catch {
            return []
          }
        },
        // THE SHARED PROJECTION. The TUI calls this and the `/plan` route calls `planForSession`
        // directly; both resolve through the same function, so a surface cannot disagree with the Web
        // panel about what is staged or what phrase the gate demands. It never throws: a broken
        // staging file must redden a surface's empty state, not take its render down.
        planFor: (workspace: string, sessionId: string) => {
          try {
            return planForSession(workspace, sessionId)
          } catch (error) {
            rowLogLine("mpd-team-core", `[mpd-team-core] reading the staged plan failed: ${String((error as Error)?.message ?? error)}`)
            return { ok: true, workspace, sessionId, plan: null }
          }
        },
        // THE PUSH SUBSTRATE, and the two members that make a surface stop polling. `subscribe` is
        // the in-process half of the feed — the same one the `/events` route serves over the wire —
        // so a TUI page and a browser tab are watching the same observation, not two of them.
        //
        // BOTH ARE CONTAINED LIKE EVERY OTHER MEMBER HERE: they are resolved during activation and
        // called from a render path, so a broken feed must answer (a dead disposer, a zero revision)
        // rather than throw into a surface that cannot catch.
        subscribe: (workspace: string, listener: () => void) => {
          try { return feed.subscribe(workspace, listener) } catch { return (): void => {} }
        },
        revision: (workspace: string) => {
          try { return feed.revision(workspace) } catch { return 0 }
        },
      } satisfies MpdTeamsService)
    } catch (error) {
      rowLogLine("mpd-team-core", `[mpd-team-core] publishing the ${TEAMS_SERVICE} service failed: ${String((error as Error)?.message ?? error)}`)
    }
  }

  // ── the tool surface: FIVE tools, not fourteen ──────────────────────────────
  //
  // WHY CONSOLIDATED. Every tool's name, description and parameter schema sits in the model's context
  // on every turn, and the hand-written surface had grown to 14 tools costing ~7,600 characters
  // (~1,900 tokens) before a single word of the actual task. The actions below were never independent
  // decisions — they are steps of ONE workflow — so they are `action` values on five tools, with the
  // descriptions trimmed to what a caller must know to pick the right action.
  //
  // What is preserved: every action the old surface exposed, unchanged in meaning. What changed: how
  // many places the model must read to find it.

  disposers.push(dsh.registerTool({
    name: "agent_teams_plan",
    description:
      "The team PLAN. `create` stages a plan and spawns nothing; `add_member`/`create_task` append to it; `edit` reads or replaces it; `approve` EXECUTES it through the TEAM EXECUTOR — the NATIVE continuable-subagent backend is the DEFAULT, and the official `dsh.team*` calls are the FALLBACK — REFUSING a plan with 0 members and 0 tasks; `delete` archives; `status` shows plan, halt, roster and board.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["create", "add_member", "create_task", "edit", "approve", "delete", "status"], description: "What to do." },
        name: { type: "string", description: "create: the team's name." },
        description: { type: "string", description: "create/edit: what the team is for." },
        approval: { type: "string", enum: ["required", "automatic"], description: "create: `required` (default) waits for `approve`." },
        replace: { type: "boolean", description: "create: required to replace an ALREADY APPROVED plan." },
        member: { type: "object", description: "add_member: {name, prompt, description?, role?}; `prompt` is the teammate's instantiation prompt." },
        // The canonical shape stays in the description because the context budget below is binding:
        // only the TWO keys a caller really put somewhere else are declared as their own properties.
        task: { type: "object", description: "create_task: {subject, description, blocked_by?, write_scopes?, owner?}; `owner`/`blocked_by` may also sit beside it." },
        owner: { type: "string", description: "create_task: alias of `task.owner`." },
        blocked_by: { type: "array", items: { type: "string" }, description: "create_task: alias of `task.blocked_by`." },
        members: { type: "array", items: { type: "object" }, description: "edit: replacement members." },
        tasks: { type: "array", items: { type: "object" }, description: "edit: replacement tasks." },
        dry_run: { type: "boolean", description: "approve: report what would be created, and create nothing." },
      },
      required: ["action"],
      additionalProperties: false,
    },
    output: {
      // THE DECLARED SHAPE OF EVERY BRANCH, stated honestly rather than loosely: `status` answers
      // `plan`/`hold`/`team`/`summary` as an OBJECT or as `null` when this session has no staged
      // plan, no hold and no team (measured 2026-10-02, defect 1: the schema said `object` only, so
      // the harness rejected the nulls with `"value.plan" must be an object`). The harness's schema
      // subset has no `type` arrays, so the nullable form is an exact-one `oneOf`.
      schema: {
        type: "object",
        properties: {
          plan: { oneOf: [{ type: "object" }, { type: "null" }] },
          hold: { oneOf: [{ type: "object" }, { type: "null" }] },
          team: { oneOf: [{ type: "object" }, { type: "null" }] },
          summary: { oneOf: [{ type: "object" }, { type: "null" }] },
          members: { type: "array", items: { type: "object" } },
          tasks: { type: "array", items: { type: "object" } },
          contracts: { type: "array", items: { type: "object" } },
          created: { type: "object" },
          stoppedAt: { type: "string" },
          archivedTo: { type: "string" },
          // The write-time blocker reading of `create_task` / `edit`: one `{ reference, form }` per
          // reference, declared so the harness's own output validation accepts it.
          blockers: { type: "array", items: { type: "object" } },
        },
      },
      render: (_args: any, value: any) =>
        text(
          value?.archivedTo !== undefined ? `archived to ${value.archivedTo}`
            : value?.created !== undefined ? `approved ${value.plan?.planId ?? ""}: ${value.created.members?.length ?? 0} member(s), ${value.created.tasks?.length ?? 0} task(s)` + (value.stoppedAt === undefined ? "" : ` — STOPPED at ${value.stoppedAt}`)
              // THE LOUD HALF. An approval that carried a blocker naming no task says so HERE, in the
              // answer the captain reads, with the board task and the exact text — because the whole
              // defect was a plan whose dangling references were accepted, stored and never mentioned.
              + (Array.isArray(value.created.unresolved) && value.created.unresolved.length > 0
                ? ` — WARNING: ${value.created.unresolved.length} task(s) carry blockers that name no task (${value.created.unresolved.map((entry: { taskId?: string; references?: string[] }) => `${entry.taskId ?? "?"}:[${(entry.references ?? []).join(",")}]`).join(" ")}); they draw no edge`
                : "")
            : value?.members !== undefined ? `plan ${value.plan?.planId ?? "(none)"} · members ${value.members.length} · tasks ${value.tasks?.length ?? 0} · hold ${value.hold === null || value.hold === undefined ? "none" : "held"}`
            // The task-writing branches answer with the blockers reading, which is the sentence that
            // tells a captain at WRITE time whether their references can resolve (R21).
            : Array.isArray(value?.blockers) && value.blockers.length > 0 ? `task "${value.plan?.tasks?.at?.(-1)?.subject ?? ""}" staged${blockerSentence(value.blockers)}`
            : describePlan(value?.plan),
        ),
    },
    execute: async (args: any, exec: DshToolExec) => {
      /** The requested action, stringified so a non-string argument can only miss, never throw. */
      const action = String(args?.action ?? "")
      /** The call's workspace and session; every branch below stays inside them. */
      const { workspace, sessionId } = where(exec)

      if (action === "status") {
        /** Read one seam defensively: a status call must answer even when a service is absent. */
        const read = <T,>(fn: () => T, fallback: T): T => { try { return fn() } catch { return fallback } }
        /** The mpd record bound to this session — the team, when one was ever approved here. */
        const record = recordFor(workspace, sessionId)
        // THE AUTHORITATIVE HALF: with a record present, the roster and the board are MPD's. The
        // official readout is still reported, but BESIDE it and under its own key, so a reader can
        // see the executor's view without confusing it for the team.
        return {
          plan: readPlan(workspace, sessionId) ?? null,
          hold: readHold(workspace) ?? null,
          team: record ?? null,
          members: record === undefined ? read(() => dsh.teamListMembers(exec.agent), []) : record.members,
          tasks: record === undefined ? read(() => dsh.teamListTasks(exec.agent), []) : record.tasks,
          // The summary crosses a TOOL boundary, so it is projected to lossless JSON here: the store's
          // own `depths` is a Map and a Map cannot survive the harness's snapshot (defect 1).
          summary: record === undefined ? null : losslessSummary(summariseTeam(record)),
          contracts: read(() => listContracts(workspace), []),
        }
      }

      if (action === "create") {
        /** The plan already staged here, whose approval state decides whether this create may replace it. */
        const existing = readPlan(workspace, sessionId)
        if (existing?.approvedAt !== undefined && args?.replace !== true) {
          throw new Error(`plan ${existing.planId} is already approved; pass replace:true to stage a different team`)
        }
        return { plan: stagePlan(workspace, sessionId, {
          name: String(args?.name ?? "team"),
          description: String(args?.description ?? ""),
          approval: args?.approval === "automatic" ? "automatic" : "required",
        }, now()) }
      }

      if (action === "add_member") {
        /** The staged, not-yet-approved plan this call appends to. */
        const { plan } = requirePlan(exec)
        /** The raw member argument, read as a record because the tool schema is not enforced here. */
        const raw = (args?.member ?? {}) as Record<string, unknown>
        /** The plan with the member appended (trimmed and duplicate-checked by the store). */
        const next = addMember(plan, {
          name: String(raw.name ?? ""),
          description: String(raw.description ?? ""),
          prompt: String(raw.prompt ?? ""),
          ...(raw.role === undefined ? {} : { role: String(raw.role) }),
        })
        writePlan(workspace, next)
        return { plan: next }
      }

      if (action === "create_task") {
        /** The staged, not-yet-approved plan this call appends to. */
        const { plan } = requirePlan(exec)
        /** The raw task argument, read as a record because the tool schema is not enforced here. */
        const raw = (args?.task ?? {}) as Record<string, unknown>
        // BOTH SPELLINGS, ONE READING (measured 2026-10-02, defects 4 and 5): the caller sent
        // `owner` and `blocked_by` BESIDE `task` in 9 of 10 live create_task calls, and this branch
        // read only the nested pair — so the board came back `owner: null, blockedBy: []` while the
        // call plainly carried both. The nested key wins; the top-level alias is the caller's.
        /** The blockers, from the nested key or its top-level alias. */
        const blockedBy = stringList(raw.blocked_by ?? raw.blockedBy ?? args?.blocked_by)
        /** The write scopes, from the nested key or its top-level alias. */
        const writeScopes = stringList(raw.write_scopes ?? raw.writeScopes ?? args?.write_scopes)
        /** The owning teammate's display name, from the nested key or its top-level alias. */
        const owner = raw.owner ?? args?.owner
        /** The plan with the task appended (trimmed by the store). */
        const next = addTask(plan, {
          subject: String(raw.subject ?? ""),
          description: String(raw.description ?? ""),
          ...(blockedBy === undefined ? {} : { blockedBy }),
          ...(writeScopes === undefined ? {} : { writeScopes }),
          ...(owner === undefined ? {} : { owner: String(owner) }),
        })
        writePlan(workspace, next)
        // SAID AT WRITE TIME (R21): each reference is classified against the plan AS IT NOW STANDS, so
        // a captain sees immediately which forms will resolve and which name nothing this plan can
        // resolve — the sentence the defect never produced. Advisory, never a refusal: a forward
        // reference (`3` before task 3 exists) is legitimate and reads as `position`.
        return { plan: next, ...(blockedBy === undefined ? {} : { blockers: blockerReading(next, blockedBy) }) }
      }

      if (action === "edit") {
        /** The plan being edited, or undefined when the session has nothing staged. */
        const plan = readPlan(workspace, sessionId)
        if (plan === undefined) throw new Error("no team is staged in this session — use action:\"create\" first")
        if (args?.members === undefined && args?.tasks === undefined && args?.description === undefined) return { plan }
        if (plan.approvedAt !== undefined) throw new Error(`plan ${plan.planId} is already approved and cannot be edited`)
        /** The replacement plan, assembled immutably so a rejected edit leaves the stored one untouched. */
        const next: StagedPlan = {
          ...plan,
          ...(args?.description === undefined ? {} : { description: String(args.description) }),
          ...(Array.isArray(args?.members)
            ? { members: args.members.map((raw: any): StagedMember => {
                if (typeof raw?.name !== "string" || raw.name.trim() === "") throw new Error("every staged member needs a name")
                if (typeof raw?.prompt !== "string" || raw.prompt.trim() === "") throw new Error(`staged member "${raw.name}" needs a prompt`)
                return { name: raw.name, description: String(raw?.description ?? ""), prompt: raw.prompt, ...(raw?.role === undefined ? {} : { role: String(raw.role) }) }
              }) }
            : {}),
          ...(Array.isArray(args?.tasks)
            ? { tasks: args.tasks.map((raw: any): StagedTask => {
                if (typeof raw?.subject !== "string" || raw.subject.trim() === "") throw new Error("every staged task needs a subject")
                return {
                  subject: raw.subject,
                  description: String(raw?.description ?? ""),
                  ...(Array.isArray(raw?.blockedBy) || Array.isArray(raw?.blocked_by) ? { blockedBy: (raw.blockedBy ?? raw.blocked_by).map(String) } : {}),
                  ...(Array.isArray(raw?.writeScopes) || Array.isArray(raw?.write_scopes) ? { writeScopes: (raw.writeScopes ?? raw.write_scopes).map(String) } : {}),
                  ...(raw?.owner === undefined ? {} : { owner: String(raw.owner) }),
                }
              }) }
            : {}),
        }
        writePlan(workspace, next)
        // An edit REPLACES the task list, so the same write-time reading is answered here: every
        // reference of every task that survived the edit, classified against the plan as it now stands.
        /** Every blocker reference the edited plan carries, in task order. */
        const editedReferences = next.tasks.flatMap((task) => task.blockedBy ?? [])
        return { plan: next, ...(editedReferences.length === 0 ? {} : { blockers: blockerReading(next, editedReferences) }) }
      }

      if (action === "delete") {
        /** The plan to archive, or undefined when there is nothing to archive. */
        const plan = readPlan(workspace, sessionId)
        if (plan === undefined) return {}
        return { archivedTo: archivePlan(workspace, plan) }
      }

      if (action === "approve") {
        /** The plan being approved; it must exist and must not already be approved. */
        const plan = readPlan(workspace, sessionId)
        if (plan === undefined) throw new Error("no team is staged in this session — use action:\"create\" first")
        if (plan.approvedAt !== undefined) throw new Error(`plan ${plan.planId} is already approved`)
        // ── AN EMPTY SHELL IS NOT A TEAM (D4a) ────────────────────────────────
        // A plan can be staged mechanically — the session-start gate (D5) does exactly that, with
        // `approval:"required"` and nothing in it — and approving one used to MINT A TEAM RECORD with
        // no member and no task: a name in `.mpd/team/teams/`, a row in every panel, and no work
        // behind it. The refusal is a sentence that says what to do instead, so the caller is not left
        // guessing which of the two lists it must fill.
        // THE CHECK SITS ABOVE `dry_run` DELIBERATELY: a preview of an empty plan would report "0
        // members, 0 tasks" for a CALL THAT CANNOT SUCCEED, which reads as a successful dry run and
        // invites the very approval this refuses. Both spellings answer with the same actionable
        // sentence instead, which is also what the /agent-teams command's own usage line promises.
        /** How many members and tasks the plan actually carries (zero on either side is fine). */
        const staged = plan.members.length + plan.tasks.length
        if (staged === 0) {
          throw new Error(`plan ${plan.planId} is EMPTY — it has 0 members and 0 tasks, and approving it would create a team with nothing in it; add a member with agent_teams_plan {action:"add_member", member:{name, prompt}} and/or a task with {action:"create_task", task:{subject, description}} first`)
        }
        if (args?.dry_run === true) {
          return { plan, created: { members: plan.members.map((m) => ({ name: m.name, id: "" })), tasks: plan.tasks.map((t) => ({ subject: t.subject, id: "" })) } }
        }
        // ── the separation, at the one moment it matters ──────────────────────
        // The mpd record is materialised BEFORE anything is spawned and carries its OWN ids, so
        // the team exists as mpd data from the first instant. Everything below only fills in
        // `executorRef` — the backend's handle — which is why a crash mid-approval leaves a record
        // naming exactly what was attempted instead of nothing at all, and why an executor swap
        // (W2) changes no id any surface has already shown.
        /** The mpd record this approval builds; persisted at the end, and on failure too. */
        let record = createTeam(workspace, { name: plan.name, description: plan.description, leadSessionId: sessionId }, now())
        for (const member of plan.members) {
          record = addTeamMember(record, { name: member.name, description: member.description, ...(member.role === undefined ? {} : { role: member.role }) }, now())
        }
        // THE ORDER IS THE FIX (defect 2026-10-06). Every staged task is minted FIRST and the blockers
        // are resolved afterwards, against the COMPLETE board: a plan may legitimately name a task that
        // comes LATER (a forward reference), and resolving per insert could only ever see the tasks
        // before it — which is how a plan written in its own POSITIONS (`["2"]`, `["7","8","9"]`) used to
        // reach the board as references no task answered, flattening the whole DAG to one column with no
        // warning anywhere. `blockedBy` is therefore added in a second pass, through `updateTeamTask`,
        // once the plan's own namespace can be mapped to real board ids.
        for (const task of plan.tasks) {
          record = addTeamTask(record, {
            subject: task.subject,
            description: task.description,
            kind: "work",
            ...(task.blockedBy === undefined ? {} : { blockedBy: task.blockedBy }),
            ...(task.writeScopes === undefined ? {} : { writeScopes: task.writeScopes }),
            ...(task.owner === undefined ? {} : { owner: task.owner }),
          }, now())
        }
        /** The plan's own references → the board ids this approval minted, in plan order. */
        const planAlias = new Map<string, string>()
        plan.tasks.forEach((task, index) => {
          /** The board task the staged task at this position was minted as; absent for an empty subject. */
          const minted = record.tasks[index]
          if (minted === undefined) return
          // BOTH FORMS THE PLAN CAN MEAN are mapped, position first: `"2"` is the second staged task,
          // and the subject is what the plan-store's own documentation has always promised.
          planAlias.set(String(index + 1), minted.id)
          if (!planAlias.has(task.subject)) planAlias.set(task.subject, minted.id)
        })
        for (const [index, task] of plan.tasks.entries()) {
          /** The board task this staged task became. */
          const minted = record.tasks[index]
          if (minted === undefined || (task.blockedBy ?? []).length === 0) continue
          /** What this task's references resolve to now that the whole plan is on the board. */
          const mapped = (task.blockedBy ?? []).map((reference) => planAlias.get(reference) ?? reference)
          // UNCHANGED MEANS ALREADY RIGHT. A subject or a backward id was resolved when the task was
          // minted, so re-writing it would only move the task's own revision for nothing; only a
          // reference the first pass could NOT resolve (a plan position, a forward reference) is
          // rewritten — and a rewrite is what turns that dangling entry into a real edge.
          if (mapped.length === minted.blockedBy.length && mapped.every((id, at) => minted.blockedBy[at] === id)) continue
          record = updateTeamTask(record, minted.id, { blockedBy: mapped }, now())
        }
        /** What approval actually created, recorded onto the plan so a reader can reconcile plan with reality. */
        const created: NonNullable<StagedPlan["created"]> = { members: [], tasks: [] }
        // THE REPORT A CAPTAIN SEES AT APPROVAL TIME, not three layers downstream: every staged blocker
        // that named no task is named HERE, with the board task it landed on. It travels in the
        // approval ANSWER (rendered by the tool) and into the archived plan's `created.unresolved`, and
        // the same list is on each board task as `unresolvedBlockers` for every later reader.
        /** The board tasks carrying a blocker nothing answered, in board order. */
        const unresolvedBlockers = record.tasks
          .filter((task) => (task.unresolvedBlockers ?? []).length > 0)
          .map((task) => ({ taskId: task.id, references: [...(task.unresolvedBlockers ?? [])] }))
        if (unresolvedBlockers.length > 0) created.unresolved = unresolvedBlockers
        /** The executor's own task handle per mpd task id, so a blocker can be named in ITS vocabulary. */
        const executorTaskId = new Map<string, string>()
        /** The first failure's description; set means approval stopped rather than half-build the team. */
        let stoppedAt: string | undefined
        for (const member of record.members) {
          try {
            // THE EXECUTOR RAISES THE MEMBER. On the native backend this passes the member's
            // PROVIDER and its `agentOptions` as ordinary arguments — the two things the official
            // tool row cannot forward — so a roster slot route, a persona and the read-only deny
            // list reach a teammate directly, and nothing here needs the official plugin mounted.
            /** The backend's answer, whose handle the record keeps BESIDE our own member id. */
            const spawned = await executor().spawn(exec.agent, {
              teamId: record.teamId,
              memberId: member.id,
              name: member.name,
              description: member.description === "" ? member.name : member.description,
              prompt: plan.members.find((staged) => staged.name === member.name)?.prompt ?? member.description,
              ...(member.route === undefined ? {} : { provider: member.route }),
              // The roster role travels as the identity the native provider's route reads, which is
              // the same signal the official row had to smuggle through the teammate DESCRIPTION.
              ...(exec.signal === undefined ? {} : { signal: exec.signal }),
            })
            created.members.push({ name: member.name, id: spawned.handle })
            record = updateTeamMember(record, member.id, { executorRef: spawned.handle, status: "running" })
          } catch (error) {
            record = updateTeamMember(record, member.id, { status: "failed" })
            stoppedAt = `member ${member.name}: ${String((error as Error)?.message ?? error)}`
            break
          }
        }
        // THE TASKS ARE NOT POSTED TO A BACKEND BOARD. The mpd record IS the board — the dependency
        // edges, the attempts, the review fields and the executor handles are all here, and a
        // second board would be a second source of truth for the same team. The official backend's
        // `executorRef` is filled in only where a backend actually minted something to point at.
        if (stoppedAt === undefined) for (const task of record.tasks) {
          created.tasks.push({ subject: task.subject, id: task.id })
        }
        /** The record stamped approved, its phase brought in line with what actually happened. */
        const approvedRecord = withDerivedPhase({ ...record, approvedAt: now().toISOString() })
        writeTeam(workspace, approvedRecord)
        /** The plan marked approved, carrying what was created. */
        const approved: StagedPlan = { ...plan, approvedAt: now().toISOString(), created }
        writePlan(workspace, approved)
        // The plan is archived so the STAGING slot is free for the next wave while the approved
        // plan stays readable; the record is what every surface reads from here on.
        if (stoppedAt === undefined) archivePlan(workspace, { ...approved })
        return { plan: approved, team: approvedRecord, created, ...(stoppedAt === undefined ? {} : { stoppedAt }) }
      }

      throw new Error(`agent_teams_plan: unknown action "${action}" (create | add_member | create_task | edit | approve | delete | status)`)
    },
  }))

  disposers.push(dsh.registerTool({
    name: "agent_teams_task",
    description:
      "Shared board tasks: `claim` (freezes the contract), `contract`, `release`, and terminal `complete`/`fail` (owner-only; optional `note`/`expected_revision`; a FAIL unblocks its dependents).",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["claim", "contract", "release", "complete", "fail"], description: "What to do." },
        task_id: { type: "string", description: "the task id; `release` takes the task to free." },
        claimant: { type: "string", description: "claim: who claims it (default: the caller)." },
        note: { type: "string", description: "complete/fail: one line recorded on the row." },
        expected_revision: { type: "number", description: "complete/fail: the revision you decided on; stale is refused." },
      },
      required: ["action"],
      additionalProperties: false,
    },
    output: {
      schema: { type: "object", properties: { contract: { type: "object" }, contracts: { type: "array", items: { type: "object" } }, task: { type: "object" }, released: { type: "boolean" }, refused: { type: "string" }, taskId: { type: "string" }, status: { type: "string" }, closedBy: { type: "string" }, attempt: { type: "number" }, revision: { type: "number" }, dependents: { type: "array", items: { type: "object" } }, note: { oneOf: [{ type: "string" }, { type: "null" }] } } },
      render: (_args: any, value: any) =>
        text(
          value?.refused !== undefined ? `refused: ${value.refused}`
            : value?.status !== undefined ? `${value.taskId} -> ${value.status} (by ${value.closedBy}, attempt ${value.attempt})`
            : value?.released !== undefined ? (value.released ? "released" : "that task was not dispatched")
            : value?.contract !== undefined ? `attempt ${value.contract.attempt} of ${value.contract.taskId} by ${value.contract.claimedBy}`
            : value?.contracts !== undefined ? `${value.contracts.length} contract(s)`
            : "no contract",
        ),
    },
    execute: async (args: any, exec: DshToolExec) => {
      /** The call's workspace, which is where contracts and the ledger live. */
      const { workspace } = where(exec)
      /** The requested action, stringified so a non-string argument can only miss, never throw. */
      const action = String(args?.action ?? "")

      if (action === "release") {
        /** The pruned ledger and whether a pairing was actually there to free. */
        const { ledger, released } = release(readLedger(workspace), String(args?.task_id ?? ""))
        if (released) writeLedger(workspace, ledger)
        return { released }
      }

      if (action === "contract") {
        if (args?.task_id === undefined) return { contracts: listContracts(workspace) }
        /** The frozen contract for the requested task, or undefined when it was never claimed here. */
        const contract = readContract(workspace, String(args.task_id))
        if (contract === undefined) throw new Error(`no contract for task "${String(args.task_id)}" — it has never been claimed through this tool`)
        return { contract }
      }

      if (action === "claim") {
        // THE RECORD IS THE BOARD (W2): the task, its acceptance text and its blockers are read
        // from mpd's own team, so a contract can be frozen in a composition where no backend board
        // exists at all. The `revision` the contract freezes is the record's own, which moves on
        // every mpd mutation and never on somebody else's.
        // THE SPECIFIC SENTENCE WHERE THERE IS ONE: an ambiguous roster gets the refusal that names the
        // teams instead of the standing "approve a plan first", which would be a lie about the cause.
        /** The team this call works on, or the sentence saying why none resolved. */
        const resolved = resolveTeam(workspace, sessionIdOf(exec))
        if (resolved.record === undefined) throw new Error(resolved.refusal ?? "no team record in this workspace — approve a plan first")
        /** The team this call works on. */
        const record = resolved.record
        /** The task being claimed. */
        const task = record.tasks.find((candidate) => candidate.id === String(args?.task_id ?? ""))
        if (task === undefined) throw new Error(`no task "${String(args?.task_id ?? "")}" in team ${record.teamId}`)
        /** The claimer, defaulting to the calling session. */
        const claimant = String(args?.claimant ?? sessionIdOf(exec))
        /** The contract for this attempt, written before the record is told about the claim. */
        const contract = claimContract(workspace, {
          id: task.id,
          subject: task.subject,
          description: task.description,
          blockedBy: task.blockedBy,
          writeScopes: task.writeScopes,
          revision: task.revision,
        }, claimant, now())
        /** The record after the claim: owned, in flight, and carrying the new attempt counter. */
        const claimed = updateTeamTask(record, task.id, { status: "in_progress", owner: claimant === "" ? undefined : claimant, attempt: contract.attempt }, now())
        writeTeam(workspace, claimed)
        /** This task as the record now holds it. */
        const view = claimed.tasks.find((candidate) => candidate.id === task.id) ?? task
        return { contract, task: view }
      }

      if (action === "complete" || action === "fail") {
        // THE MISSING TERMINAL VERB (captain amendment, 2026-10-07). The mpd-native plane could open a
        // plan, add members and create tasks, and then NOTHING could close a row: the official
        // `team_task_*` verbs are disabled in a dsh-tui boot (the host refuses the root-bound effect
        // their activation needs), so this board is the only board — and a board whose rows never reach
        // a terminal state can never satisfy a dependency, so `agent_teams_dispatch` could not pair a
        // blocked task and the whole DAG was frozen. MEASURED on this wave's own board.
        // THE SPECIFIC SENTENCE WHERE THERE IS ONE: an ambiguous roster gets the refusal that names the
        // teams instead of the standing "approve a plan first", which would be a lie about the cause.
        /** The team this call works on, or the sentence saying why none resolved. */
        const resolved = resolveTeam(workspace, sessionIdOf(exec))
        if (resolved.record === undefined) throw new Error(resolved.refusal ?? "no team record in this workspace — approve a plan first")
        /** The team this call works on. */
        const record = resolved.record
        /** The task to close. */
        const taskId = String(args?.task_id ?? "")
        if (taskId === "") throw new Error(`agent_teams_task ${action}: task_id is required`)
        /** The raw calling agent, read for the title the harness gives it. */
        const self = exec.agent as any
        /** The caller's team identity, when the official plane knows one. */
        const membership = ((): { role?: string; name?: string } | undefined => {
          try { return dsh.teamMembership(exec.agent) as { role?: string; name?: string } | undefined } catch { return undefined }
        })()
        // THE CALLER'S OWN SPELLINGS, never a name the caller TYPES: `claimant` is deliberately NOT read
        // here, because accepting it would let any agent close any row by naming its owner.
        const caller = [sessionIdOf(exec), String(self?.session?.header?.title ?? ""), String(membership?.name ?? "")].filter((value) => value !== "")
        // RE-READ IMMEDIATELY BEFORE THE CAS, the dispatch pass's own discipline: the record was opened
        // before this branch and a concurrent write may have moved it.
        const fresh = readTeam(workspace, record.teamId) ?? record
        /** The closure decision, or the refusal and its reason. */
        const outcome = casCloseTask(fresh, {
          taskId,
          status: action === "complete" ? "completed" : "failed",
          caller,
          lead: membership?.role === "lead",
          ...(typeof args?.expected_revision === "number" ? { expectedRevision: args.expected_revision } : {}),
          ...(args?.note === undefined ? {} : { note: String(args.note) }),
          now: now(),
        })
        if (!outcome.applied) return { refused: outcome.reason, taskId }
        writeTeam(workspace, withDerivedPhase(outcome.record))
        // A FAILED ROW IS RELEASED FROM THE DISPATCH LEDGER, so the repair can be dispatched again on the
        // next pass: the pairing is what makes a member look busy, and a closed row must not hold one.
        /** Whether this closure also freed a dispatch pairing. */
        let releasedFromDispatch = false
        if (outcome.status === "failed") {
          /** The ledger after freeing this row's pairing, and whether one was there to free. */
          const freed = release(readLedger(workspace), taskId)
          if (freed.released) { writeLedger(workspace, freed.ledger); releasedFromDispatch = true }
        }
        rowLogLine("mpd-team-core", `[mpd-team-core] task ${taskId} ${outcome.status} by ${outcome.closedBy}`)
        return {
          taskId,
          status: outcome.status,
          closedBy: outcome.closedBy,
          attempt: outcome.attempt,
          revision: outcome.task.revision,
          note: outcome.task.note ?? null,
          dependents: outcome.dependents,
          releasedFromDispatch,
        }
      }

      throw new Error(`agent_teams_task: unknown action "${action}" (claim | contract | release | complete | fail)`)
    },
  }))

  disposers.push(dsh.registerTool({
    name: "agent_teams_dispatch",
    description:
      "Pair READY shared tasks with IDLE members. `run` pairs each ready task with one idle member, tells that member to work it, and RECORDS the pairing — so a second pass can never hand the same task to two members. Tasks it does not pair are reported with the reason (blocked, completed, already dispatched, no free member). `release` frees a pairing.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["run", "release"], description: "What to do." },
        task_id: { type: "string", description: "release: the task to free." },
        dry_run: { type: "boolean", description: "run: report the pairing and send nothing." },
        limit: { type: "number", description: "run: cap the pairs in this pass (0 or omitted = no cap)." },
      },
      required: ["action"],
      additionalProperties: false,
    },
    output: {
      // `refused` and `holdRead` are declared because BOTH really appear: a pass with no team record
      // is refused, and a watchdog hold that could not be read is REPORTED rather than guessed at.
      schema: { type: "object", properties: { pairs: { type: "array", items: { type: "object" } }, skipped: { type: "array", items: { type: "object" } }, halted: { type: "string" }, refused: { type: "string" }, holdRead: { type: "string" }, forgotten: { type: "array", items: { type: "string" } }, released: { type: "boolean" } } },
      render: (_args: any, value: any) =>
        text(
          value?.released !== undefined ? (value.released ? "released" : "that task was not dispatched")
            : value?.halted !== undefined ? `halted: ${value.halted}`
            : value?.refused !== undefined ? `refused: ${value.refused}`
            : (value?.pairs?.length ?? 0) === 0 ? "nothing to dispatch" + ((value?.skipped?.length ?? 0) === 0 ? "" : " (" + value.skipped.map((row: any) => row.subject + ": " + row.reason).join("; ") + ")")
            : value.pairs.map((pair: any) => `${pair.subject} -> ${pair.memberName}` + (typeof pair.note === "string" && pair.note !== "" ? ` [${pair.note}]` : "")).join("\n"),
        ),
    },
    execute: async (args: any, exec: DshToolExec) => {
      /** The call's workspace, where the dispatch ledger lives. */
      const { workspace } = where(exec)
      /** The requested action, stringified so a non-string argument can only miss, never throw. */
      const action = String(args?.action ?? "")

      if (action === "release") {
        /** The pruned ledger and whether a pairing was actually there to free. */
        const { ledger, released } = release(readLedger(workspace), String(args?.task_id ?? ""))
        if (released) writeLedger(workspace, ledger)
        return { released }
      }

      /** The workspace hold, if any; its reason refuses the WHOLE pass inside `planDispatch`. */
      const hold = readHold(workspace)
      // The WATCHDOG's hold is a second, per-team pause. It is composed into the same refusal so a
      // caller reads one sentence whichever hold stopped the pass.
      /** This session's team, which names the team a watchdog hold would apply to. */
      const teamId = recordFor(workspace, sessionIdOf(exec))?.teamId
      // ONE AUTHORITATIVE SOURCE for the watchdog's hold: its own `mpdWatchdog` service, read through
      // the gate call the watchdog documents (`isHeld(teamId, workspace)?.held === true`). A hold that
      // cannot be read is NOT a hold — it is reported as `not-readable` and the pass continues.
      /** The watchdog's reading for this session's team. */
      const watchdog = teamId === undefined ? ({ state: "free" } as WatchdogHoldRead) : readWatchdogHold(workspace, sessionIdOf(exec))
      /** The refusal reason, whichever of the two holds applies first. */
      const holdReason = hold?.reason ?? (watchdog.state === "held" ? watchdog.reason : undefined)
      /** The honest note a caller reads when the watchdog's hold could not be read at all. */
      const holdNote = watchdog.state === "not-readable" ? `not-readable: ${String(watchdog.reason ?? "the watchdog's hold could not be read")}` : undefined
      // THE RECORD IS THE BOARD (W2). Both loops below read mpd's own team, so a dispatch pass
      // works in a composition where the official service cannot mount — which is the whole point
      // of owning the record — and the readiness rule is the store's own OPT-1 rule rather than a
      // projection of somebody else's.
      /** The team this pass dispatches, or the sentence saying why none resolved. */
      const resolvedDispatch = resolveTeam(workspace, sessionIdOf(exec))
      if (resolvedDispatch.record === undefined) return { pairs: [], skipped: [], refused: resolvedDispatch.refusal ?? "no team record in this workspace — approve a plan first" }
      /** The team this pass dispatches. */
      let record: TeamRecord = resolvedDispatch.record
      // Bound to a const because `record` is REASSIGNED as pairs are accepted, so a captured `let`
      // would change under the two closures below; the tip carries its own `TeamRecord` annotation.
      /** The team as this pass read it. */
      const opened: TeamRecord = record
      /** The tasks this pass may dispatch, by the store's own OPT-1 readiness rule. */
      const readyIds = new Set(readyTasks(opened).map((candidate) => candidate.id))
      /** The board, in the dispatch engine's shape. */
      const tasks = opened.tasks.map((task) => ({
        id: task.id,
        subject: task.subject,
        status: task.status,
        // OPT-1: a FAILED blocker does not hold a task back, and `readyTasks` is the ONE place
        // that rule lives, so the dispatch engine cannot drift from the store.
        ready: readyIds.has(task.id),
        blockedBy: task.blockedBy,
        ...(task.owner === undefined ? {} : { ownerName: task.owner }),
      }))
      /** The roster, in the dispatch engine's shape; the engine pairs only with `inactive` (idle). */
      const idle = new Set(idleMembers(opened).map((member) => member.name))
      /** The roster in the dispatch engine's shape: a member is `inactive` when it is free. */
      const members = opened.members.map((member) => ({ id: member.executorRef ?? member.id, name: member.name, status: idle.has(member.name) ? "inactive" : "running" }))
      // PRUNE FIRST: a task deleted or completed out of band must not keep its member busy forever.
      const pruned = reconcile(readLedger(workspace), tasks)
      /** The pure decision for this pass: the pairs to dispatch and a reason for every task left out. */
      const plan = planDispatch({
        tasks,
        members,
        ledger: pruned.ledger,
        ...(holdReason === undefined ? {} : { hold: holdReason }),
        ...(typeof args?.limit === "number" ? { limit: args.limit } : {}),
      })
      if (plan.halted !== undefined || args?.dry_run === true || plan.pairs.length === 0) {
        if (pruned.forgotten.length > 0) writeLedger(workspace, pruned.ledger)
        return { ...plan, forgotten: pruned.forgotten, ...(holdNote === undefined ? {} : { holdRead: holdNote }) }
      }
      // The pass's OWN view of the ledger: the pre-await prune, extended by each accepted pairing.
      // It is deliberately NOT what gets written — the merge before the write (T7) re-reads the file
      // and takes ONLY this pass's `sent` entries from here, so a concurrent release survives.
      /** The ledger this pass carries: the pre-await prune plus its own accepted pairings. */
      let ledger = pruned.ledger
      /** The pairs the transport actually accepted, which are the ones recorded. */
      const sent: typeof plan.pairs = []
      /** The plan's skips plus any pairing whose message failed, so nothing is dropped silently. */
      const skipped = [...plan.skipped]
      for (const pair of plan.pairs) {
        /** The board's own record for this pair, used for the acceptance text. */
        const task = tasks.find((candidate) => candidate.id === pair.taskId)
        try {
          // DELIVERED THROUGH THE EXECUTOR, which on the native backend cold-resumes a child that
          // is not currently live — the behaviour a dispatch pass depends on.
          await executor().send(exec.agent, pair.memberId, dispatchMessage({ id: pair.taskId, subject: pair.subject, status: "pending", ready: true }, task === undefined ? "" : String((task as any).description ?? "")), exec.signal)
          // COMPARE-AND-SET (T2), AFTER the await and never before it. `opened` was read before the
          // loop, and another caller — a member's own `agent_teams_task {action:"claim"}` — may have
          // written the record while this pass was suspended. Re-reading here and applying the patch
          // to the FRESH record is what keeps that write: a blind `writeTeam(record)` rewrote the
          // whole file from the stale snapshot and silently reverted it. The pairing is still
          // recorded in the RECORD as well as the ledger — the assignment is what makes the member
          // non-idle on the NEXT pass, and a ledger alone would leave the record claiming the task
          // is unowned.
          /** The record as it stands on disk right now. */
          const onDisk = readTeam(workspace, opened.teamId)
          if (onDisk === undefined) {
            skipped.push({ taskId: pair.taskId, subject: pair.subject, reason: "the team record disappeared while the pass was in flight" })
            continue
          }
          /** The revision this pass's decision was based on, from the record it has been carrying. */
          const expected = record.tasks.find((candidate) => candidate.id === pair.taskId)?.revision
          if (expected === undefined) {
            skipped.push({ taskId: pair.taskId, subject: pair.subject, reason: `task ${pair.taskId} is no longer on the pass's board` })
            continue
          }
          /** The compare-and-set outcome for this pairing. */
          const claimed = casClaimTask(onDisk, pair.taskId, pair.memberName, expected, now())
          if (!claimed.applied) {
            // REPORTED, not silently dropped: the message was delivered, but the board's own record
            // refused the claim, so the caller must see why the task is not marked in flight.
            skipped.push({ taskId: pair.taskId, subject: pair.subject, reason: `the board refused the claim: ${claimed.reason}` })
            continue
          }
          // The FRESH record, carrying this one pairing and everything a concurrent writer added.
          record = claimed.record
          writeTeam(workspace, record)
          ledger = assign(ledger, pair, now())
          sent.push(pair)
        } catch (error) {
          skipped.push({ taskId: pair.taskId, subject: pair.subject, reason: `the message to ${pair.memberName} failed: ${String((error as Error)?.message ?? error)}` })
        }
      }
      // MERGE (T7), never a blind overwrite. `pruned` was read BEFORE the first `await`, and the
      // ledger has a SECOND writer that runs across this pass's suspension — `agent_teams_task
      // {action:"release"}` reads the same file and writes it back with one entry removed. Writing
      // this pass's whole pre-await map back erased that release: the member stayed recorded as busy
      // and the freed task could never be dispatched again. So the map is re-read, re-pruned against
      // the SAME board this pass decided on, and only this pass's OWN accepted operations are applied.
      /** The ledger as it stands on disk right now, pruned by the rule `pruned` was built with. */
      const fresh = reconcile(readLedger(workspace), tasks)
      /** The merged ledger: everything a concurrent writer left, plus this pass's own pairings. */
      const merged: DispatchLedger = { ...fresh.ledger }
      // DELIBERATE CONFLICT RULE: when the fresh read shows that a task THIS PASS ASSIGNED was
      // meanwhile released, the pass's assignment still wins — the send really went out, so recording
      // it is the honest outcome, and dropping it would leave a delivered task unowned on the board.
      // Only `sent` is re-applied; an entry this pass merely inherited is never resurrected.
      for (const pair of sent) merged[pair.taskId] = ledger[pair.taskId]
      writeLedger(workspace, merged)
      return { pairs: sent, skipped, forgotten: pruned.forgotten, ...(holdNote === undefined ? {} : { holdRead: holdNote }) }
    },
  }))

  // ── the mailbox: OURS, with a read state the harness cannot provide ─────────
  //
  // The official mailbox keeps `messages` and `delivered` and nothing else — "read" is not observable
  // anywhere in it, so a captain's real question ("did they SEE it?") has no answer there. This
  // sidecar owns the whole `sent → delivered → read` lifecycle; delivery still rides the official
  // transport so a member really receives the message. `mailbox-store.ts` holds the rules.
  disposers.push(dsh.registerTool({
    name: "agent_teams_mail",
    description:
      "The team mailbox. `send` messages one member (through the official transport) and records it; `unread` lists what a member has NOT acknowledged; `read` acknowledges ids; `summary` counts total/unread/undelivered per member. Delivery and reading are separate facts: a message the transport accepted is still unread until the recipient acknowledges it.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["send", "unread", "read", "summary"], description: "What to do." },
        to: { type: "string", description: "send: the member name or id to message." },
        subject: { type: "string", description: "send: one line the recipient sees first." },
        body: { type: "string", description: "send: the message." },
        member: { type: "string", description: "unread: whose inbox (defaults to the caller)." },
        ids: { type: "array", items: { type: "string" }, description: "read: the message ids to acknowledge." },
      },
      required: ["action"],
      additionalProperties: false,
    },
    output: {
      schema: { type: "object", properties: { message: { type: "object" }, messages: { type: "array", items: { type: "object" } }, summary: { type: "array", items: { type: "object" } }, moved: { type: "array", items: { type: "string" } }, refused: { type: "string" } } },
      render: (_args: any, value: any) =>
        text(
          value?.refused !== undefined ? `refused: ${value.refused}`
            : value?.message !== undefined ? `sent ${value.message.id} to ${value.message.toName}`
            : value?.moved !== undefined ? `acknowledged ${value.moved.length} message(s)`
            : value?.summary !== undefined ? (value.summary.length === 0 ? "no mail" : value.summary.map((row: any) => `${row.memberName}: ${row.unread} unread / ${row.total} total`).join("\n"))
            : (value?.messages?.length ?? 0) === 0 ? "nothing unread"
            : value.messages.map((mail: any) => `${mail.id} from ${mail.fromName}: ${mail.subject}`).join("\n"),
        ),
    },
    execute: async (args: any, exec: DshToolExec) => {
      /** The call's workspace, where the mailbox log lives. */
      const { workspace } = where(exec)
      /** The caller's id, used when the payload carries no session of its own. */
      const caller = sessionIdOf(exec)
      /** The raw calling agent, read for the display name the official payload carries. */
      const self = exec.agent as any
      // THE RECORD IS THE ROSTER (W2): a mailbox call must answer with no official plane mounted,
      // and the handle a message is delivered to is the one the EXECUTOR recorded at spawn time.
      /** This session's team, when one was approved here. */
      const mailTeam = recordFor(workspace, caller)
      /** The roster in the shape this tool addresses members by: id OR name, plus the handle. */
      const roster = (mailTeam?.members ?? []).map((member) => ({ id: member.id, name: member.name, status: member.status, handle: member.executorRef ?? "" }))
      /** Resolve a member by name OR by id, because a captain addresses people by name. */
      const resolve = (name: string): { id: string; name: string; status: string; handle: string } | undefined => roster.find((member) => member.id === name || member.name === name)

      if (args?.action === "send") {
        /** The addressed member, or undefined — in which case the refusal names the whole roster. */
        const target = resolve(String(args?.to ?? ""))
        if (target === undefined) {
          return { refused: `"${String(args?.to ?? "")}" is not a member of this team (members: ${roster.map((m) => m.name).join(", ") || "none"})` }
        }
        /** The store's verdict: the recorded message, or the refusal and its reason. */
        const result = sendMail(workspace, {
          fromId: self?.session?.id ?? caller,
          fromName: self?.session?.header?.title ?? caller,
          toId: target.id,
          toName: target.name,
          subject: String(args?.subject ?? ""),
          body: String(args?.body ?? ""),
          memberIds: roster.map((member) => member.id),
        }, now())
        if (!result.ok) return { refused: result.detail }
        // The transport carries it; a delivery failure does NOT lose the record — the message stays
        // undelivered in the ledger, which is exactly what `summary` reports.
        try {
          // A member with no handle was never raised, so there is nothing to deliver to and the
          // message stays UNDELIVERED in the ledger — which is exactly what `summary` reports.
          if (target.handle === "") throw new Error(`${target.name} has no executor handle — it was never raised`)
          await executor().send(exec.agent, target.handle, `[${result.message.subject}]\n\n${result.message.body}`, exec.signal)
          markDelivered(workspace, [result.message.id], now())
        } catch (error) {
          rowLogLine("mpd-team-core", `[mpd-team-core] the mailbox recorded ${result.message.id} but the transport refused it: ${String((error as Error)?.message ?? error)}`)
        }
        return { message: result.message }
      }

      if (args?.action === "read") {
        return { moved: markRead(workspace, Array.isArray(args?.ids) ? args.ids.map(String) : [], now()) }
      }

      if (args?.action === "summary") {
        return { summary: summarise(readMailbox(workspace)) }
      }

      /** The folded mailbox, read once so the unread/undelivered/total counts agree. */
      const state = readMailbox(workspace)
      /** The member whose inbox was asked for, when the call named one. */
      const wanted = args?.member === undefined ? undefined : resolve(String(args.member))
      /** The inbox owner: the named member, else the caller's own session. */
      const memberId = wanted?.id ?? self?.session?.id ?? caller
      return {
        messages: unreadMessages(state, memberId).map((message) => ({
          id: message.id,
          fromName: message.fromName,
          subject: message.subject,
          body: message.body,
          sentAt: message.sentAt,
          delivered: message.deliveredAt !== undefined,
        })),
        undelivered: undeliveredOf(state, memberId).length,
        total: inboxOf(state, memberId).length,
        memberName: wanted?.name ?? memberId,
      }
    },
  }))

  disposers.push(dsh.registerTool({
    name: "agent_teams_control",
    description:
      "Halt or resume the team. `halt` stops NEW DISPATCH and leaves the team and every teammate alive (use agent_teams_plan action:\"delete\" to end a team). `resume` clears the hold.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["halt", "resume"], description: "What to do." },
        reason: { type: "string", description: "halt: why the team is halted; shown to anyone who asks for status." },
      },
      required: ["action"],
      additionalProperties: false,
    },
    output: {
      schema: { type: "object", properties: { hold: { type: "object" }, resumed: { type: "boolean" } } },
      render: (_args: any, value: any) =>
        text(value?.resumed !== undefined ? (value.resumed ? "resumed" : "was not halted") : value?.hold === undefined ? "not halted" : `halted: ${value.hold.reason}`),
    },
    execute: async (args: any, exec: DshToolExec) => {
      /** The call's workspace, where the hold record lives. */
      const { workspace } = where(exec)
      if (String(args?.action ?? "") === "resume") return { resumed: clearHold(workspace) }
      if (String(args?.action ?? "") !== "halt") throw new Error(`agent_teams_control: unknown action "${String(args?.action ?? "")}" (halt | resume)`)
      return { hold: placeHold(workspace, String(args?.reason ?? ""), sessionIdOf(exec), now()) }
    },
  }))

  // ── the command ─────────────────────────────────────────────────────────────
  disposers.push(dsh.registerCommand({
    name: "agent-teams",
    description: "Stage a team for the current goal: /agent-teams <what the team is for>",
    input: { hint: "what the team is for" },
    handler: async (invocation: any) => {
      /** The command's workspace: a command has no tool exec, so it resolves from the process view. */
      const workspace = dsh.workspaceRoot()
      /** The invoking session, so the plan is staged where that session will approve it. */
      const sessionId = sessionIdOf({ agent: invocation?.agent } as DshToolExec)
      /** The command's argument, trimmed; empty means the user gets usage instead of a plan. */
      const goal = String(invocation?.rawInput ?? "").trim()
      if (goal === "") {
        // THE NAMES ARE THE REGISTERED ONES. These lines used to send the user to `agent_teams_approve`,
        // `agent_teams_add_member` and `agent_teams_create_task` — three tools the RETIRED vendored
        // plugin registered and this one does not. The real surface is the `action` enum on
        // `agent_teams_plan`, so a user following the old sentence looked up a tool that is not there.
        return { kind: "message", text: "Usage: /agent-teams <what the team is for> — stages a plan; nobody is spawned until you approve it with agent_teams_plan {action: \"approve\"}." }
      }
      /** The staged plan, awaiting approval — which the reply says explicitly. */
      const plan = stagePlan(workspace, sessionId, { name: goal.slice(0, 60), description: goal, approval: "required" }, now())
      return {
        kind: "message",
        text: `Staged ${describePlan(plan)}.\nAdd members and tasks with agent_teams_plan {action: \"add_member\" | \"create_task\"}, then approve with agent_teams_plan {action: \"approve\"}. Nobody is spawned before that.`,
      }
    },
  }))

  // A durable sidecar that survives a reload is the only thing this plugin keeps; report it once
  // so a boot log shows the plane is live without a tool call.
  const root = (() => { try { return dsh.workspaceRoot() } catch { return "" } })()
  if (root !== "") {
    try {
      /** The staging directory whose file count is the boot line's "staged" number. */
      const staging = join(root, ".mpd", "team", "staging")
      /** How many sessions currently have a staged plan in this workspace. */
      const pending = existsSync(staging) ? readdirSync(staging).filter((file) => file.endsWith(".json")).length : 0
      // The count is DERIVED from the registrations this apply() made: a literal here said "10" while
      // the plane had grown to 12, which is exactly the kind of boot line a reader trusts and should
      // not.
      // COUNT WHAT IT SAYS: `disposers` holds the tool registrations AND the command, so calling the
      // total "tools" read 14 for 13 tools. The label is the honest one now.
      // DERIVED, both numbers: `disposers` holds the tool registrations plus the ONE command this
      // apply() registers last. The literal that used to sit here said "13 tools" while the plane had
      // grown to 14 — a boot line a reader trusts must not be hand-maintained.
      // THE EXECUTOR IS NAMED ON A LOG LINE, because which backend raises a member is the ONE fact
      // an operator needs when a team behaves differently than expected — and because a silent fall
      // back to the official plane is exactly the regression the split exists to prevent.
      //
      // TIMING, MEASURED: `subagents` is a HOST-plane service and this row can apply BEFORE it is
      // ACTIVE, so an apply-time read answers "unavailable" in a perfectly healthy composition
      // (`evidence/dsh-qa/preset-conformance/*/boot.log`, the run that produced the deferred branch
      // below). The TOOLS are unaffected — every call re-resolves the executor lazily, which is why
      // that is the design — so only this LINE has to wait for the binding to become true.
      /** Log the executor as it stands right now. Called at apply, and again on a late binding. */
      const reportExecutor = (): void => {
        /** The executor at this instant, contained: the seam is total but a log line must not throw. */
        const view = (() => { try { return executor() } catch (error) { return { kind: "unavailable", reason: String((error as Error)?.message ?? error) } } })()
        rowLogLine("mpd-team-core", `[mpd-team-core] team executor: ${view.kind} (${view.reason})`)
      }
      rowLogLine("mpd-team-core", `[mpd-team-core] team workflow plane: staged=${pending} hold=${readHold(root) === undefined ? "none" : "held"} registrations=${disposers.length} (${disposers.length - 1} tools + the /agent-teams command)`)
      reportExecutor()
      // ── THE WEB ROUTE: the mpd team, served to the browser ───────────────────
      // Registered through the adapter's `webServerOf()` (never a raw ctx service read), and
      // re-attempted when the web server binds LATER — the same host-plane ordering that made the
      // executor line lie once already, so the second attempt is not speculative.
      /** Register the route against whatever web server this composition has right now. */
      const mountTeamRoute = (): boolean => registerTeamRoutes(dsh.webServerOf() as never, {
        recordFor: (sessionId: string) => recordFor(dsh.workspaceRoot(), sessionId),
        workspace: () => dsh.workspaceRoot(),
        executor: () => {
          /** The executor as of this request, contained so a route never throws into a response. */
          const view = executor()
          return { kind: view.kind, reason: view.reason }
        },
        effect: (fn: () => unknown, label: string) => { try { return ctx?.effect?.(fn, label) } catch { return undefined } },
        warn: (line: string) => rowLogLine("mpd-team-core", `[mpd-team-core] ${line}`),
        // The SAME feed the service publishes, handed to the stream route as its two doors. A route
        // that had its own feed would be a second observer of the same writes and a second watcher on
        // the same directory — the exact duplication the ONE substrate exists to prevent.
        subscribe: (workspace: string, listener: () => void) => feed.subscribe(workspace, listener),
        revision: (workspace: string) => feed.revision(workspace),
      })
      // Mounted ONCE here and retried on the binding below; the route is idempotent by path on the
      // host's own registry, and a second registration attempt against the SAME server is harmless
      // because the composition only ever has one.
      if (mountTeamRoute()) rowLogLine("mpd-team-core", `[mpd-team-core] team web routes: ${TEAM_ROUTES.join(" ")}`)
      try {
        dsh.onServiceBound(["webServer", "httpServer"], () => { mountTeamRoute() })
      } catch { /* an adapter without the seam keeps the single attempt above */ }

      // Re-report ONCE when the NATIVE backend's service binds, so the line the operator reads is
      // the composition's real answer rather than an ordering artefact. A composition that never
      // binds it keeps the apply-time line, which is the honest thing to print.
      //
      // ONLY `subagents` IS NAMED, and not the official service beside it: naming that service by
      // string outside the adapter is EXACTLY what the D6 gate forbids (`node
      // packages/mpd-dsh-adapter-plugin/test/no-direct-team-access.test.ts` reported this line the
      // first time it was written with both). The gate is right, and nothing is lost — the executor
      // re-resolves its backend on every CALL, so a late-binding official service is picked up
      // where it matters whether or not this line is ever re-printed.
      try {
        dsh.onServiceBound(["subagents"], () => reportExecutor())
      } catch { /* an adapter without the seam keeps the apply-time line */ }
    } catch { /* a read-only workspace must not break the boot */ }
  }

  if (typeof ctx?.on === "function") ctx.on("dispose", () => { for (const dispose of disposers) { try { dispose() } catch { /* already gone */ } } })
}

// Re-exported for the unit tests, which drive the state machine without a ctx.
export { addMember, addTask, archivePlan, claimContract, clearHold, listContracts, placeHold, readContract, readHold, readPlan, stagePlan, writePlan, newPlanId }
export * from "./plan-store"
