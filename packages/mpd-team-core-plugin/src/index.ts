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
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
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
  clearHold,
  listContracts,
  newPlanId,
  placeHold,
  readContract,
  readHold,
  readPlan,
  stagePlan,
  writePlan,
  type StagedMember,
  type StagedPlan,
  type StagedTask,
} from "./plan-store"
import { planForSession, registerTeamRoutes, TEAM_ROUTES, type TeamWebPlan } from "./team-web"
import {
  activeTeamId,
  addTeamMember,
  addTeamTask,
  blockingDependencies,
  createTeam,
  idleMembers,
  readyTasks,
  deleteTeam,
  derivePhase,
  listTeams,
  losslessSummary,
  memberProgress,
  readTeam,
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

/** Persist the ledger. */
function writeLedger(workspace: string, ledger: DispatchLedger): void {
  mkdirSync(join(workspace, ".mpd", "team"), { recursive: true })
  writeFileSync(dispatchPath(workspace), JSON.stringify(ledger, null, 2) + "\n")
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
   * The index is the fast path; when it is missing (a hand-removed `teams.json`, a workspace copied
   * without it, a record written by another surface) the newest record whose `leadSessionId` is
   * this session answers instead, so the team is never lost to a bookkeeping file. Returns
   * `undefined` — never throws — so a status render cannot be taken down by a bad record.
   * @param workspace - the workspace to read.
   * @param sessionId - the Lead session whose team is wanted.
   * @returns the record, or undefined when this session has no team.
   */
  const recordFor = (workspace: string, sessionId: string): TeamRecord | undefined => {
    try {
      /** The bound team id, when the index still carries one. */
      const bound = activeTeamId(workspace, sessionId)
      if (bound !== undefined) {
        /** The bound record, which may have been deleted out from under the index. */
        const record = readTeam(workspace, bound)
        if (record !== undefined) return record
      }
      // Newest first, so a session that approved several waves gets its LATEST team.
      return listTeams(workspace).find((record) => record.leadSessionId === sessionId)
    } catch {
      return undefined
    }
  }

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
      "The team PLAN. `create` stages a plan (nothing is spawned); `add_member`/`create_task` append to it; `edit` reads or replaces it; `approve` EXECUTES it (spawns members through spawn_teammate, posts tasks to the official board, resolves blocked_by and owner); `delete` archives it; `status` shows the plan, the halt, and the official roster and board side by side.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["create", "add_member", "create_task", "edit", "approve", "delete", "status"], description: "What to do." },
        name: { type: "string", description: "create: the team's name." },
        description: { type: "string", description: "create/edit: what the team is for." },
        approval: { type: "string", enum: ["required", "automatic"], description: "create: `required` (default) waits for `approve`." },
        replace: { type: "boolean", description: "create: required to replace an ALREADY APPROVED plan." },
        member: { type: "object", description: "add_member: {name, prompt, description?, role?}. `prompt` is what spawn_teammate receives." },
        // The canonical shape stays in the description because the context budget below is binding:
        // only the TWO keys a caller really put somewhere else are declared as their own properties.
        task: { type: "object", description: "create_task: {subject, description, blocked_by?, write_scopes?, owner?}; `owner`/`blocked_by` may also sit beside `task`." },
        owner: { type: "string", description: "create_task: alias of `task.owner`." },
        blocked_by: { type: "array", items: { type: "string" }, description: "create_task: alias of `task.blocked_by`." },
        members: { type: "array", items: { type: "object" }, description: "edit: replacement member list." },
        tasks: { type: "array", items: { type: "object" }, description: "edit: replacement task list." },
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
        },
      },
      render: (_args: any, value: any) =>
        text(
          value?.archivedTo !== undefined ? `archived to ${value.archivedTo}`
            : value?.created !== undefined ? `approved ${value.plan?.planId ?? ""}: ${value.created.members?.length ?? 0} member(s), ${value.created.tasks?.length ?? 0} task(s)` + (value.stoppedAt === undefined ? "" : ` — STOPPED at ${value.stoppedAt}`)
            : value?.members !== undefined ? `plan ${value.plan?.planId ?? "(none)"} · members ${value.members.length} · tasks ${value.tasks?.length ?? 0} · hold ${value.hold === null || value.hold === undefined ? "none" : "held"}`
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
        return { plan: next }
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
        return { plan: next }
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
        /** What approval actually created, recorded onto the plan so a reader can reconcile plan with reality. */
        const created: { members: Array<{ name: string; id: string }>; tasks: Array<{ subject: string; id: string }> } = { members: [], tasks: [] }
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
      "Shared board tasks. `claim` claims one for a member AND freezes its contract — the acceptance text, blockers and write scopes as they stand now, with a monotonic attempt counter; `contract` reads a frozen contract back (or every one in this workspace); `release` frees one dispatched task so it can be dispatched again.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["claim", "contract", "release"], description: "What to do." },
        task_id: { type: "string", description: "claim/contract: the official task id. release: the task to free." },
        claimant: { type: "string", description: "claim: who claims it. Defaults to the calling agent." },
      },
      required: ["action"],
      additionalProperties: false,
    },
    output: {
      schema: { type: "object", properties: { contract: { type: "object" }, contracts: { type: "array", items: { type: "object" } }, task: { type: "object" }, released: { type: "boolean" } } },
      render: (_args: any, value: any) =>
        text(
          value?.released !== undefined ? (value.released ? "released" : "that task was not dispatched")
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
        /** The team this call works on, or a refusal naming what is missing. */
        const record = recordFor(workspace, sessionIdOf(exec))
        if (record === undefined) throw new Error("no team record in this workspace — approve a plan first")
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

      throw new Error(`agent_teams_task: unknown action "${action}" (claim | contract | release)`)
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
            : value.pairs.map((pair: any) => `${pair.subject} -> ${pair.memberName}`).join("\n"),
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
      /** The team this pass dispatches, or a refusal naming what is missing. */
      let record = recordFor(workspace, sessionIdOf(exec))
      if (record === undefined) return { pairs: [], skipped: [], refused: "no team record in this workspace — approve a plan first" }
      // Bound to a const so the narrowing survives into the two closures below: `record` is
      // reassigned as pairs are accepted, and a captured `let` would widen back to `| undefined`.
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
      /** The ledger as it will be written: pruned first, then extended by each accepted pairing. */
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
          // The pairing is recorded in the RECORD as well as the ledger: the assignment is what
          // makes the member non-idle on the NEXT pass, and a ledger alone would leave the record
          // claiming the task is unowned.
          record = updateTeamTask(record, pair.taskId, { owner: pair.memberName, status: "in_progress" }, now())
          writeTeam(workspace, record)
          ledger = assign(ledger, pair, now())
          sent.push(pair)
        } catch (error) {
          skipped.push({ taskId: pair.taskId, subject: pair.subject, reason: `the message to ${pair.memberName} failed: ${String((error as Error)?.message ?? error)}` })
        }
      }
      writeLedger(workspace, ledger)
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
      "Halt or resume the team. `halt` records a hold that stops NEW DISPATCH while leaving the team and every teammate alive — it is not an ending (use agent_teams_plan action:\"delete\" to end and archive a team). `resume` clears the hold.",
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
