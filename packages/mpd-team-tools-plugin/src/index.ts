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
import { applyInboxEvent, emptyCounts, INBOX_EVENTS, unreadOf, type InboxCounts } from "./mailbox"
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

export const name = "mpd-team-tools"
// INJECT: the TOOLS and COMMANDS seams (both resolved through the adapter, never on the raw
// ctx — the D6 gate polices that) and NOT the team plane itself: `ctx.agentTeams` is reached
// exclusively through `dsh.team*`, so a harness rename lands in the adapter.
export const inject = ["tools", "commands"]

/** A tool result narrow enough for the adapter's renderer. */
const text = (value: unknown): { type: "text"; text: string }[] => [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }]

/** The dispatch ledger path: `<workspace>/.mpd/team/dispatch.json`. */
const dispatchPath = (workspace: string): string => join(workspace, ".mpd", "team", "dispatch.json")

/** Read the ledger; a missing or unreadable file is an empty ledger, never a crash. */
function readLedger(workspace: string): DispatchLedger {
  try {
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
  const state = plan.approvedAt !== undefined ? "approved" : plan.discardedAt !== undefined ? "discarded" : "staged"
  return `${plan.planId} (${state}): ${plan.members.length} member(s), ${plan.tasks.length} task(s)`
}

/**
 * Resolve the adapter once per call: the mounted `mpdDsh` service when there is one, and a
 * standalone instance otherwise (unit tests, or a composition that mounts this plugin alone).
 */
function adapterFor(ctx: any): DshAdapter {
  const mounted = typeof ctx?.get === "function" ? ctx.get("mpdDsh") : undefined
  return (mounted as DshAdapter | undefined) ?? createDshAdapter(ctx)
}

/** The calling session's id, or `"workspace"` when the surface has no session (a web route). */
function sessionIdOf(exec: DshToolExec | undefined): string {
  const agent = exec?.agent as any
  const id = agent?.session?.id ?? agent?.sessionId ?? agent?.id
  return typeof id === "string" && id !== "" ? id : "workspace"
}

export function apply(ctx: any): void {
  const dsh = adapterFor(ctx)
  const disposers: Array<() => void> = []
  const now = (): Date => new Date()

  /** Resolve the workspace + session for one call. */
  const where = (exec: DshToolExec | undefined) => ({ workspace: dsh.workspaceRoot(exec), sessionId: sessionIdOf(exec) })

  /** Read the staged plan for a call, or fail with a sentence the captain can act on. */
  const requirePlan = (exec: DshToolExec | undefined): { workspace: string; sessionId: string; plan: StagedPlan } => {
    const { workspace, sessionId } = where(exec)
    const plan = readPlan(workspace, sessionId)
    if (plan === undefined) throw new Error("no team is staged in this session — call agent_teams_create first")
    if (plan.approvedAt !== undefined) throw new Error(`plan ${plan.planId} is already approved; stage a new one to change the team`)
    return { workspace, sessionId, plan }
  }

  // ── the staged plan ─────────────────────────────────────────────────────────
  disposers.push(dsh.registerTool({
    name: "agent_teams_create",
    description:
      "Stage a team as a PLAN: name it, then add members and shared tasks, then approve it. Nothing is created and nobody is spawned until agent_teams_approve. Staging replaces any unapproved plan in this session (the previous one is archived).",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "The team's name, for the plan header." },
        description: { type: "string", description: "What this team is for. One or two sentences." },
        approval: { type: "string", enum: ["required", "automatic"], description: "`required` (default) waits for agent_teams_approve; `automatic` records that the captain may approve without asking." },
        replace: { type: "boolean", description: "Required to be true when a plan is already staged and approved — replacing an approved plan is a deliberate act." },
      },
      required: ["name"],
      additionalProperties: false,
    },
    output: { schema: { type: "object", properties: { plan: { type: "object" } } }, render: (_args: any, value: any) => text(describePlan(value?.plan)) },
    execute: async (args: any, exec: DshToolExec) => {
      const { workspace, sessionId } = where(exec)
      const existing = readPlan(workspace, sessionId)
      if (existing?.approvedAt !== undefined && args?.replace !== true) {
        throw new Error(`plan ${existing.planId} is already approved; pass replace:true to stage a different team`)
      }
      const plan = stagePlan(workspace, sessionId, {
        name: String(args?.name ?? "team"),
        description: String(args?.description ?? ""),
        approval: args?.approval === "automatic" ? "automatic" : "required",
      }, now())
      return { plan }
    },
  }))

  disposers.push(dsh.registerTool({
    name: "agent_teams_add_member",
    description: "Add one teammate to the STAGED plan. `prompt` is what spawn_teammate will receive on approval; take a roster member's persona text from mpd_role_persona first when the member maps to one.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "The teammate's name (unique within the plan)." },
        description: { type: "string", description: "One line on what this member is for." },
        prompt: { type: "string", description: "The full prompt the member receives. Required — a member with no prompt is a member with no job." },
        role: { type: "string", description: "Free-form role label for the plan header (e.g. the roster member's functional name)." },
      },
      required: ["name", "prompt"],
      additionalProperties: false,
    },
    output: { schema: { type: "object", properties: { plan: { type: "object" } } }, render: (_args: any, value: any) => text(describePlan(value?.plan)) },
    execute: async (args: any, exec: DshToolExec) => {
      const { workspace, plan } = requirePlan(exec)
      const member: StagedMember = {
        name: String(args?.name ?? ""),
        description: String(args?.description ?? ""),
        prompt: String(args?.prompt ?? ""),
        ...(args?.role === undefined ? {} : { role: String(args.role) }),
      }
      const next = addMember(plan, member)
      writePlan(workspace, next)
      return { plan: next }
    },
  }))

  disposers.push(dsh.registerTool({
    name: "agent_teams_create_task",
    description: "Add one shared task to the STAGED plan. It is posted to the official board on approval, with its blockedBy/writeScopes intact.",
    parameters: {
      type: "object",
      properties: {
        subject: { type: "string", description: "The task title." },
        description: { type: "string", description: "The acceptance contract: what 'done' means." },
        blocked_by: { type: "array", items: { type: "string" }, description: "Subjects or ids of planned tasks this one waits for." },
        write_scopes: { type: "array", items: { type: "string" }, description: "Workspace-relative paths this task may write (advisory)." },
        owner: { type: "string", description: "The staged member name that should own it." },
      },
      required: ["subject", "description"],
      additionalProperties: false,
    },
    output: { schema: { type: "object", properties: { plan: { type: "object" } } }, render: (_args: any, value: any) => text(describePlan(value?.plan)) },
    execute: async (args: any, exec: DshToolExec) => {
      const { workspace, plan } = requirePlan(exec)
      const task: StagedTask = {
        subject: String(args?.subject ?? ""),
        description: String(args?.description ?? ""),
        ...(Array.isArray(args?.blocked_by) ? { blockedBy: args.blocked_by.map(String) } : {}),
        ...(Array.isArray(args?.write_scopes) ? { writeScopes: args.write_scopes.map(String) } : {}),
        ...(args?.owner === undefined ? {} : { owner: String(args.owner) }),
      }
      const next = addTask(plan, task)
      writePlan(workspace, next)
      return { plan: next }
    },
  }))

  disposers.push(dsh.registerTool({
    name: "agent_teams_edit_plan",
    description: "Read or replace the STAGED plan's member and task lists atomically. Call with no `members`/`tasks` to read it back.",
    parameters: {
      type: "object",
      properties: {
        members: { type: "array", items: { type: "object" }, description: "Replacement member list (same shape as agent_teams_add_member)." },
        tasks: { type: "array", items: { type: "object" }, description: "Replacement task list (same shape as agent_teams_create_task)." },
        description: { type: "string", description: "Replacement plan description." },
      },
      additionalProperties: false,
    },
    output: { schema: { type: "object", properties: { plan: { type: "object" } } }, render: (_args: any, value: any) => text(describePlan(value?.plan)) },
    execute: async (args: any, exec: DshToolExec) => {
      const { workspace, sessionId } = where(exec)
      const plan = readPlan(workspace, sessionId)
      if (plan === undefined) throw new Error("no team is staged in this session — call agent_teams_create first")
      if (args?.members === undefined && args?.tasks === undefined && args?.description === undefined) return { plan }
      if (plan.approvedAt !== undefined) throw new Error(`plan ${plan.planId} is already approved and cannot be edited`)
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
    },
  }))

  // ── approval: the plan becomes a live team ──────────────────────────────────
  disposers.push(dsh.registerTool({
    name: "agent_teams_approve",
    description:
      "Approve the staged plan and EXECUTE it: spawn every staged member through the official spawn_teammate and post every staged task to the official board (resolving `owner` to the spawned member and `blocked_by` to posted task ids). Reports what it created; a failure names the member or task it stopped at.",
    parameters: { type: "object", properties: { dry_run: { type: "boolean", description: "Report exactly what approval would create, and create nothing." } }, additionalProperties: false },
    output: {
      schema: { type: "object", properties: { plan: { type: "object" }, created: { type: "object" }, stoppedAt: { type: "string" } } },
      render: (_args: any, value: any) => text(
        value?.plan === undefined ? "nothing to approve" :
        `approved ${value.plan.planId}: ${value.created?.members?.length ?? 0} member(s), ${value.created?.tasks?.length ?? 0} task(s)` +
        (value?.stoppedAt === undefined ? "" : ` — STOPPED at ${value.stoppedAt}`),
      ),
    },
    execute: async (args: any, exec: DshToolExec) => {
      const { workspace, sessionId } = where(exec)
      const plan = readPlan(workspace, sessionId)
      if (plan === undefined) throw new Error("no team is staged in this session — call agent_teams_create first")
      if (plan.approvedAt !== undefined) throw new Error(`plan ${plan.planId} is already approved`)
      const preview = { members: plan.members.map((member) => ({ name: member.name, id: "" })), tasks: plan.tasks.map((task) => ({ subject: task.subject, id: "" })) }
      if (args?.dry_run === true) {
        return { plan, created: preview, wouldSpawn: plan.members.length, wouldPost: plan.tasks.length }
      }

      const created: { members: Array<{ name: string; id: string }>; tasks: Array<{ subject: string; id: string }> } = { members: [], tasks: [] }
      const bySubject = new Map<string, string>()
      const idByName = new Map<string, string>()
      let stoppedAt: string | undefined

      for (const member of plan.members) {
        try {
          const spawned = await dsh.teamSpawnTeammate(exec.agent, {
            name: member.name,
            description: member.description === "" ? member.name : member.description,
            prompt: member.prompt,
            ...(exec.signal === undefined ? {} : { signal: exec.signal }),
          })
          const id = String((spawned as any)?.id ?? (spawned as any)?.sessionId ?? (spawned as any)?.member?.id ?? "")
          created.members.push({ name: member.name, id })
          if (id !== "") idByName.set(member.name, id)
        } catch (error) {
          stoppedAt = `member ${member.name}: ${String((error as Error)?.message ?? error)}`
          break
        }
      }

      if (stoppedAt === undefined) {
        for (const task of plan.tasks) {
          try {
            const resolved = (task.blockedBy ?? []).map((reference) => bySubject.get(reference) ?? reference)
            const view = await dsh.teamCreateTask(exec.agent, {
              subject: task.subject,
              description: task.description,
              ...(resolved.length === 0 ? {} : { blockedBy: resolved }),
              ...(task.writeScopes === undefined ? {} : { writeScopes: task.writeScopes }),
            })
            bySubject.set(task.subject, view.id)
            created.tasks.push({ subject: task.subject, id: view.id })
            // Ownership is a second call: the official service assigns an owner through
            // `updateTask`, never at creation, so an unowned task stays visibly unowned rather
            // than silently assigned to whoever happened to spawn first.
            const ownerId = task.owner === undefined ? undefined : idByName.get(task.owner)
            if (ownerId !== undefined) {
              await dsh.teamUpdateTask(exec.agent, { taskId: view.id, expectedRevision: view.revision, action: "reassign", owner: ownerId })
            }
          } catch (error) {
            stoppedAt = `task ${task.subject}: ${String((error as Error)?.message ?? error)}`
            break
          }
        }
      }

      const approved: StagedPlan = { ...plan, approvedAt: now().toISOString(), created }
      writePlan(workspace, approved)
      return { plan: approved, created, ...(stoppedAt === undefined ? {} : { stoppedAt }) }
    },
  }))

  disposers.push(dsh.registerTool({
    name: "agent_teams_delete",
    description: "Archive the staged plan under .mpd/team/archive/<planId>/ and clear the staging slot. Archive-first: nothing is hard-deleted, so a reviewer can still read what was staged.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    output: { schema: { type: "object", properties: { archivedTo: { type: "string" } } }, render: (_args: any, value: any) => text(value?.archivedTo === undefined ? "nothing to archive" : `archived to ${value.archivedTo}`) },
    execute: async (_args: any, exec: DshToolExec) => {
      const { workspace, sessionId } = where(exec)
      const plan = readPlan(workspace, sessionId)
      if (plan === undefined) return { archivedTo: undefined }
      const archivedTo = archivePlan(workspace, plan)
      return { archivedTo }
    },
  }))

  // ── contracts, claims and the halt ──────────────────────────────────────────
  disposers.push(dsh.registerTool({
    name: "agent_teams_claim_task",
    description: "Claim an OFFICIAL shared task for a teammate and freeze its contract: the task's subject, acceptance text, blockers and write scopes as they stand now, with a monotonic attempt counter (the Nth claim of this task). Returns the contract.",
    parameters: {
      type: "object",
      properties: {
        task_id: { type: "string", description: "The official task id." },
        claimant: { type: "string", description: "Who claims it — a teammate name or session id. Defaults to the calling agent." },
      },
      required: ["task_id"],
      additionalProperties: false,
    },
    output: { schema: { type: "object", properties: { contract: { type: "object" }, task: { type: "object" } } }, render: (_args: any, value: any) => text(value?.contract === undefined ? "no contract" : `attempt ${value.contract.attempt} of ${value.contract.taskId} by ${value.contract.claimedBy}`) },
    execute: async (args: any, exec: DshToolExec) => {
      const { workspace } = where(exec)
      const view = dsh.teamGetTask(exec.agent, String(args?.task_id ?? ""))
      const claimant = String(args?.claimant ?? sessionIdOf(exec))
      const contract = claimContract(workspace, {
        id: view.id,
        subject: view.subject,
        description: view.description,
        blockedBy: view.blockedBy,
        writeScopes: view.writeScopes,
        revision: view.revision,
      }, claimant, now())
      // The official board records the CLAIM too, so the two halves agree: the board's revision
      // moves, and the sidecar freezes what that revision MEANT.
      const task = await dsh.teamUpdateTask(exec.agent, { taskId: view.id, expectedRevision: view.revision, action: "claim" }).catch(() => view)
      return { contract, task }
    },
  }))

  disposers.push(dsh.registerTool({
    name: "agent_teams_task_contract",
    description: "Read a frozen task contract (or every contract in this workspace when task_id is omitted), including its attempt counter.",
    parameters: { type: "object", properties: { task_id: { type: "string", description: "The official task id; omit for every contract, newest claim first." } }, additionalProperties: false },
    output: { schema: { type: "object", properties: { contract: { type: "object" }, contracts: { type: "array", items: { type: "object" } } } }, render: (_args: any, value: any) => text(value?.contract ?? value?.contracts ?? "no contract") },
    execute: async (args: any, exec: DshToolExec) => {
      const { workspace } = where(exec)
      if (args?.task_id === undefined) return { contracts: listContracts(workspace) }
      const contract = readContract(workspace, String(args.task_id))
      if (contract === undefined) throw new Error(`no contract for task "${String(args.task_id)}" — it has never been claimed through agent_teams_claim_task`)
      return { contract }
    },
  }))

  disposers.push(dsh.registerTool({
    name: "agent_teams_halt",
    description: "HALT the team: record a hold that stops NEW dispatch while leaving the team and every teammate alive. Distinct from ending a team — nothing is archived and no member is interrupted.",
    parameters: { type: "object", properties: { reason: { type: "string", description: "Why the team is halted. Shown to anyone who asks for status." } }, required: ["reason"], additionalProperties: false },
    output: { schema: { type: "object", properties: { hold: { type: "object" } } }, render: (_args: any, value: any) => text(value?.hold === undefined ? "not halted" : `halted: ${value.hold.reason}`) },
    execute: async (args: any, exec: DshToolExec) => {
      const { workspace } = where(exec)
      return { hold: placeHold(workspace, String(args?.reason ?? ""), sessionIdOf(exec), now()) }
    },
  }))

  disposers.push(dsh.registerTool({
    name: "agent_teams_resume",
    description: "Clear a halt recorded by agent_teams_halt. Reports whether one was there.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    output: { schema: { type: "object", properties: { resumed: { type: "boolean" } } }, render: (_args: any, value: any) => text(value?.resumed === true ? "resumed" : "was not halted") },
    execute: async (_args: any, exec: DshToolExec) => ({ resumed: clearHold(where(exec).workspace) }),
  }))

  // ── the mailbox: the harness's OWN inbox arithmetic ─────────────────────────
  //
  // "Unread" here is not an approximation. The harness's agent inbox emits three scoped events —
  // `agent/inbox/inserted` when a message ENTERS the inbox, `agent/inbox/claimed` when the loop
  // takes it, and `agent/inbox/discarded` when it is dropped — so `inserted − claimed − discarded`
  // is the harness's own "waiting, not yet taken". They are dispatched through the AGENT's scope
  // carrier, which is why the subscription goes through the adapter's per-agent seam and not this
  // row's ctx.
  const unread = new Map<unknown, InboxCounts>()
  /** Agents whose counter is already attached, so `watch` is idempotent. */
  const counted = new Set<unknown>()
  const counterFor = (agent: unknown): InboxCounts => {
    let entry = unread.get(agent)
    if (entry === undefined) {
      entry = emptyCounts()
      unread.set(agent, entry)
    }
    return entry
  }
  /** Start counting for one agent; returns a disposer. Idempotent per agent. */
  const countInbox = (agent: unknown): (() => void) => {
    try {
      return dsh.subscribeAgentEvents(agent, [...INBOX_EVENTS], (event) => {
        unread.set(agent, applyInboxEvent(counterFor(agent), event))
      })
    } catch (error) {
      console.warn("[mpd-team-tools] the mailbox counter could not attach to this agent: " + String((error as Error)?.message ?? error))
      return () => {}
    }
  }

  disposers.push(dsh.registerTool({
    name: "agent_teams_mailbox",
    description:
      "How many messages are WAITING for this session's agent and have not been taken yet — the harness's own arithmetic over its inbox events (entered − claimed − discarded), not an estimate. `watch` attaches the counter to the calling agent; without it the tool reports what it has seen since attach.",
    parameters: { type: "object", properties: { watch: { type: "boolean", description: "Attach the counter to the calling agent (idempotent)." } }, additionalProperties: false },
    output: { schema: { type: "object", properties: { unread: { type: "number" }, inserted: { type: "number" }, claimed: { type: "number" }, discarded: { type: "number" } } }, render: (_args: any, value: any) => text(`${value?.unread ?? 0} message(s) waiting (entered ${value?.inserted ?? 0}, taken ${value?.claimed ?? 0}, discarded ${value?.discarded ?? 0})`) },
    execute: async (args: any, exec: DshToolExec) => {
      const agent = exec.agent
      if (args?.watch === true && agent !== undefined && !counted.has(agent)) {
        counted.add(agent)
        disposers.push(countInbox(agent))
      }
      const entry = unread.get(agent) ?? emptyCounts()
      return { unread: unreadOf(entry), ...entry }
    },
  }))

  // ── dispatch: the pairing nothing else performs ─────────────────────────────
  disposers.push(dsh.registerTool({
    name: "agent_teams_dispatch",
    description:
      "Pair READY shared tasks with IDLE members and tell each member to work its task. One pass pairs each task with one member and RECORDS the pairing, so a second pass can never hand the same task to a second teammate. Respects agent_teams_halt (a held team dispatches nothing) and skips a task that is blocked, completed, already dispatched, or has no free member — reporting which, per task. dry_run reports the pairing without sending anything.",
    parameters: {
      type: "object",
      properties: {
        dry_run: { type: "boolean", description: "Report the pairing and send nothing." },
        limit: { type: "number", description: "Cap the pairs in this pass (0 or omitted = no cap)." },
      },
      additionalProperties: false,
    },
    output: {
      schema: { type: "object", properties: { pairs: { type: "array", items: { type: "object" } }, skipped: { type: "array", items: { type: "object" } }, halted: { type: "string" }, forgotten: { type: "array", items: { type: "string" } } } },
      render: (_args: any, value: any) =>
        text(
          value?.halted !== undefined ? `halted: ${value.halted}`
            : (value?.pairs?.length ?? 0) === 0 ? "nothing to dispatch" + ((value?.skipped?.length ?? 0) === 0 ? "" : " (" + value.skipped.map((row: any) => row.subject + ": " + row.reason).join("; ") + ")")
            : value.pairs.map((pair: any) => `${pair.subject} -> ${pair.memberName}`).join("\n"),
        ),
    },
    execute: async (args: any, exec: DshToolExec) => {
      const { workspace } = where(exec)
      const hold = readHold(workspace)
      const tasks = dsh.teamListTasks(exec.agent).map((task) => ({
        id: task.id,
        subject: task.subject,
        status: task.status,
        ready: task.ready,
        blockedBy: task.blockedBy,
        ...(task.ownerName === undefined ? {} : { ownerName: task.ownerName }),
      }))
      const members = dsh.teamListMembers(exec.agent).map((member) => ({ id: member.id, name: member.name, status: member.status }))
      // PRUNE FIRST: a task deleted or completed out of band must not keep its member busy forever.
      const pruned = reconcile(readLedger(workspace), tasks)
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
      let ledger = pruned.ledger
      const sent: typeof plan.pairs = []
      const skipped = [...plan.skipped]
      for (const pair of plan.pairs) {
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

  disposers.push(dsh.registerTool({
    name: "agent_teams_dispatch_release",
    description: "Free one dispatched task so it can be dispatched again (a member finished, went away, or the work was reassigned). Reports whether a pairing was there.",
    parameters: { type: "object", properties: { task_id: { type: "string", description: "The task to free." } }, required: ["task_id"], additionalProperties: false },
    output: { schema: { type: "object", properties: { released: { type: "boolean" } } }, render: (_args: any, value: any) => text(value?.released === true ? "released" : "that task was not dispatched") },
    execute: async (args: any, exec: DshToolExec) => {
      const { workspace } = where(exec)
      const { ledger, released } = release(readLedger(workspace), String(args?.task_id ?? ""))
      if (released) writeLedger(workspace, ledger)
      return { released }
    },
  }))

  // ── status: both halves side by side ────────────────────────────────────────
  disposers.push(dsh.registerTool({
    name: "agent_teams_status",
    description: "The team in one read: the STAGED plan and the halt from this bundle's sidecar, beside the OFFICIAL roster and shared board. Read-only.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    output: { schema: { type: "object", properties: { plan: { type: "object" }, hold: { type: "object" }, members: { type: "array", items: { type: "object" } }, tasks: { type: "array", items: { type: "object" } }, contracts: { type: "array", items: { type: "object" } } } }, render: (_args: any, value: any) => text(value) },
    execute: async (_args: any, exec: DshToolExec) => {
      const { workspace, sessionId } = where(exec)
      const read = <T,>(fn: () => T, fallback: T): T => { try { return fn() } catch { return fallback } }
      return {
        plan: readPlan(workspace, sessionId) ?? null,
        hold: readHold(workspace) ?? null,
        members: read(() => dsh.teamListMembers(exec.agent), []),
        tasks: read(() => dsh.teamListTasks(exec.agent), []),
        contracts: read(() => listContracts(workspace), []),
      }
    },
  }))

  // ── the command ─────────────────────────────────────────────────────────────
  disposers.push(dsh.registerCommand({
    name: "agent-teams",
    description: "Stage a team for the current goal: /agent-teams <what the team is for>",
    input: { hint: "what the team is for" },
    handler: async (invocation: any) => {
      const workspace = dsh.workspaceRoot()
      const sessionId = sessionIdOf({ agent: invocation?.agent } as DshToolExec)
      const goal = String(invocation?.rawInput ?? "").trim()
      if (goal === "") {
        return { kind: "message", text: "Usage: /agent-teams <what the team is for> — stages a plan; nobody is spawned until you approve it with agent_teams_approve." }
      }
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
      const staging = join(root, ".mpd", "team", "staging")
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
