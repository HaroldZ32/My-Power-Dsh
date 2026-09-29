// mpd-team-tools-plugin: the team WORKFLOW the official Agent Teams plugin does not ship.
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
import { createDshAdapter, type DshAdapter, type DshToolExec } from "../../mpd-dsh-adapter-plugin/src/index"
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
import {
  activeTeamId,
  addTeamMember,
  addTeamTask,
  blockingDependencies,
  createTeam,
  deleteTeam,
  derivePhase,
  listTeams,
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
export const name = "mpd-team-tools"
// INJECT: the TOOLS and COMMANDS seams (both resolved through the adapter, never on the raw
// ctx — the D6 gate polices that) and NOT the team plane itself: `ctx.agentTeams` is reached
// exclusively through `dsh.team*`, so a harness rename lands in the adapter.
export const inject = ["tools", "commands"]

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
}

/** A tool result narrow enough for the adapter's renderer. */
const text = (value: unknown): { type: "text"; text: string }[] => [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }]

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
      } satisfies MpdTeamsService)
    } catch (error) {
      console.warn(`[mpd-team-tools] publishing the ${TEAMS_SERVICE} service failed: ${String((error as Error)?.message ?? error)}`)
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
        task: { type: "object", description: "create_task: {subject, description, blocked_by?, write_scopes?, owner?}." },
        members: { type: "array", items: { type: "object" }, description: "edit: replacement member list." },
        tasks: { type: "array", items: { type: "object" }, description: "edit: replacement task list." },
        dry_run: { type: "boolean", description: "approve: report exactly what would be created, and create nothing." },
      },
      required: ["action"],
      additionalProperties: false,
    },
    output: {
      schema: { type: "object", properties: { plan: { type: "object" }, created: { type: "object" }, stoppedAt: { type: "string" }, archivedTo: { type: "string" }, members: { type: "array", items: { type: "object" } }, tasks: { type: "array", items: { type: "object" } }, hold: { type: "object" }, contracts: { type: "array", items: { type: "object" } } } },
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
          summary: record === undefined ? null : summariseTeam(record),
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
        /** The plan with the task appended (trimmed by the store). */
        const next = addTask(plan, {
          subject: String(raw.subject ?? ""),
          description: String(raw.description ?? ""),
          ...(Array.isArray(raw.blocked_by) ? { blockedBy: raw.blocked_by.map(String) } : {}),
          ...(Array.isArray(raw.write_scopes) ? { writeScopes: raw.write_scopes.map(String) } : {}),
          ...(raw.owner === undefined ? {} : { owner: String(raw.owner) }),
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
            /** The executor's spawn result, whose handle is read from whichever field it fills. */
            const spawned = await dsh.teamSpawnTeammate(exec.agent, {
              name: member.name,
              description: member.description === "" ? member.name : member.description,
              prompt: plan.members.find((staged) => staged.name === member.name)?.prompt ?? member.description,
              ...(exec.signal === undefined ? {} : { signal: exec.signal }),
            })
            /** The new member's handle, or the empty string when the executor reported none. */
            const id = String((spawned as any)?.id ?? (spawned as any)?.sessionId ?? (spawned as any)?.member?.id ?? "")
            created.members.push({ name: member.name, id })
            // A member that spawned is RUNNING; one the executor answered nothing for stays
            // `provisioning`, which is the honest state rather than a claimed success.
            record = updateTeamMember(record, member.id, id === "" ? {} : { executorRef: id, status: "running" })
          } catch (error) {
            record = updateTeamMember(record, member.id, { status: "failed" })
            stoppedAt = `member ${member.name}: ${String((error as Error)?.message ?? error)}`
            break
          }
        }
        if (stoppedAt === undefined) {
          for (const task of record.tasks) {
            try {
              /** This task's blockers, expressed in the EXECUTOR's ids. */
              const resolved = task.blockedBy.map((id) => executorTaskId.get(id)).filter((id): id is string => id !== undefined)
              /** The executor's board task, whose handle the record keeps beside its own id. */
              const view = await dsh.teamCreateTask(exec.agent, {
                subject: task.subject,
                description: task.description,
                ...(resolved.length === 0 ? {} : { blockedBy: resolved }),
                ...(task.writeScopes.length === 0 ? {} : { writeScopes: task.writeScopes }),
              })
              executorTaskId.set(task.id, view.id)
              created.tasks.push({ subject: task.subject, id: view.id })
              // The owner is reassigned only when the record names one; a task with no owner is
              // left unowned rather than silently handed to whoever spawned first.
              record = updateTeamTask(record, task.id, { executorRef: view.id }, now())
              /** The owning member's executor handle, present only when it actually spawned. */
              const ownerRef = task.owner === undefined ? undefined : record.members.find((member) => member.name === task.owner)?.executorRef
              if (ownerRef !== undefined) {
                await dsh.teamUpdateTask(exec.agent, { taskId: view.id, expectedRevision: view.revision, action: "reassign", owner: ownerRef })
              }
            } catch (error) {
              stoppedAt = `task ${task.subject}: ${String((error as Error)?.message ?? error)}`
              break
            }
          }
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
        /** The official task as it stands NOW — the source of every value the contract freezes. */
        const view = dsh.teamGetTask(exec.agent, String(args?.task_id ?? ""))
        /** The contract for this attempt, written before the board is told about the claim. */
        const contract = claimContract(workspace, {
          id: view.id,
          subject: view.subject,
          description: view.description,
          blockedBy: view.blockedBy,
          writeScopes: view.writeScopes,
          revision: view.revision,
        }, String(args?.claimant ?? sessionIdOf(exec)), now())
        /** The board's task after the claim; a refused claim falls back to the view so a contract still answers. */
        const task = await dsh.teamUpdateTask(exec.agent, { taskId: view.id, expectedRevision: view.revision, action: "claim" }).catch(() => view)
        return { contract, task }
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
      schema: { type: "object", properties: { pairs: { type: "array", items: { type: "object" } }, skipped: { type: "array", items: { type: "object" } }, halted: { type: "string" }, forgotten: { type: "array", items: { type: "string" } }, released: { type: "boolean" } } },
      render: (_args: any, value: any) =>
        text(
          value?.released !== undefined ? (value.released ? "released" : "that task was not dispatched")
            : value?.halted !== undefined ? `halted: ${value.halted}`
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
      /** The board projected into the dispatch task shape. */
      const tasks = dsh.teamListTasks(exec.agent).map((task) => ({
        id: task.id,
        subject: task.subject,
        status: task.status,
        ready: task.ready,
        blockedBy: task.blockedBy,
        ...(task.ownerName === undefined ? {} : { ownerName: task.ownerName }),
      }))
      /** The roster projected into the dispatch member shape. */
      const members = dsh.teamListMembers(exec.agent).map((member) => ({ id: member.id, name: member.name, status: member.status }))
      // PRUNE FIRST: a task deleted or completed out of band must not keep its member busy forever.
      const pruned = reconcile(readLedger(workspace), tasks)
      /** The pure decision for this pass: the pairs to dispatch and a reason for every task left out. */
      const plan = planDispatch({
        tasks,
        members,
        ledger: pruned.ledger,
        ...(hold === undefined ? {} : { hold: hold.reason }),
        ...(typeof args?.limit === "number" ? { limit: args.limit } : {}),
      })
      if (plan.halted !== undefined || args?.dry_run === true || plan.pairs.length === 0) {
        if (pruned.forgotten.length > 0) writeLedger(workspace, pruned.ledger)
        return { ...plan, forgotten: pruned.forgotten }
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
          await dsh.teamSendMessage(exec.agent, {
            target: pair.memberId,
            content: dsh.text(dispatchMessage({ id: pair.taskId, subject: pair.subject, status: "pending", ready: true }, task === undefined ? "" : String((task as any).description ?? ""))),
            ...(exec.signal === undefined ? {} : { signal: exec.signal }),
          })
          ledger = assign(ledger, pair, now())
          sent.push(pair)
        } catch (error) {
          skipped.push({ taskId: pair.taskId, subject: pair.subject, reason: `the message to ${pair.memberName} failed: ${String((error as Error)?.message ?? error)}` })
        }
      }
      writeLedger(workspace, ledger)
      return { pairs: sent, skipped, forgotten: pruned.forgotten }
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
      /** The live roster, or an empty list: a mailbox call must answer even with no team plane. */
      const roster = (() => { try { return dsh.teamListMembers(exec.agent) } catch { return [] } })()
      /** Resolve a member by name OR by id, because a captain addresses people by name. */
      const resolve = (name: string): ReturnType<DshAdapter["teamListMembers"]>[number] | undefined => roster.find((member) => member.id === name || member.name === name)

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
          await dsh.teamSendMessage(exec.agent, {
            target: target.id,
            content: dsh.text(`[${result.message.subject}]\n\n${result.message.body}`),
            ...(exec.signal === undefined ? {} : { signal: exec.signal }),
          })
          markDelivered(workspace, [result.message.id], now())
        } catch (error) {
          console.warn(`[mpd-team-tools] the mailbox recorded ${result.message.id} but the transport refused it: ${String((error as Error)?.message ?? error)}`)
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
        return { kind: "message", text: "Usage: /agent-teams <what the team is for> — stages a plan; nobody is spawned until you approve it with agent_teams_approve." }
      }
      /** The staged plan, awaiting approval — which the reply says explicitly. */
      const plan = stagePlan(workspace, sessionId, { name: goal.slice(0, 60), description: goal, approval: "required" }, now())
      return {
        kind: "message",
        text: `Staged ${describePlan(plan)}.\nAdd members with agent_teams_add_member and tasks with agent_teams_create_task, then approve with agent_teams_approve. Nobody is spawned before that.`,
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
      console.log(`[mpd-team-tools] team workflow plane: staged=${pending} hold=${readHold(root) === undefined ? "none" : "held"} registrations=${disposers.length} (${disposers.length - 1} tools + the /agent-teams command)`)
    } catch { /* a read-only workspace must not break the boot */ }
  }

  if (typeof ctx?.on === "function") ctx.on("dispose", () => { for (const dispose of disposers) { try { dispose() } catch { /* already gone */ } } })
}

// Re-exported for the unit tests, which drive the state machine without a ctx.
export { addMember, addTask, archivePlan, claimContract, clearHold, listContracts, placeHold, readContract, readHold, readPlan, stagePlan, writePlan, newPlanId }
export * from "./plan-store"
