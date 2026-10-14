// C7-4 — the five case arms for the `team-dispatch-guard` QA lane, as CONTENT for the single skills
// writer to fold into `skills/dsh-qa/scripts/team-dispatch-guard.ts` (AGENTS.md §9: ONE skills writer per
// wave). This file is NOT landed by its author.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// THE FOLD (exact, mechanical):
//   1. rewrite every import prefix `../../../../../../packages/` (6 levels, this draft's depth under
//      `evidence/`) to `../../../packages/` (3 levels, the case's home under `skills/dsh-qa/scripts/`);
//   2. copy everything from the `── harness ──` banner down into the case file;
//   3. `c74Arms()` is ASYNC (it drives the real registered tools, whose `execute` returns a promise), so
//      `selfTest()` becomes `async` and `main()` becomes `async`; at the bottom of the case,
//      `process.exit(main(...))` becomes `main(process.argv.slice(2)).then((code) => process.exit(code))`;
//      in `selfTest()`/`main()` append `...(await c74Arms())` to the arm list — the five positive arms and
//      their eight negative controls then run in `--self-test` AND in the real lane;
//   4. nothing else: `c74Arms()` returns the case's own `Arm` shape and removes every sandbox it created.
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// WHAT EACH ARM PROVES (plan .mpd/plans/tui-015-adaptation.md, "Plan amendment 2 (2026-10-14): C7-4"):
//   F1 mid-run append — after approval (which ARCHIVES the staging file) `agent_teams_plan
//      {action:"create_task"}` appends to the caller's LIVE APPROVED record, carrying the
//      requirement-chain fields (kind/coverageOf/sourceTaskId).
//   F2 member self-close — a member session whose id IS the recorded `executorRef` closes a row whose
//      owner is written as the member's NAME (the measured refusal).
//   F3 mailbox scope — `agent_teams_mail {action:"summary"}` is FILTERED to the resolved team's members
//      and labelled `scope:"team"`; with no team it is labelled `scope:"workspace"`.
//   F4 id collision — two mints in the same millisecond differ, and a colliding id is REFUSED.
//   F5 session churn — a forked/resumed captain session resolves its team and closes as lead, and the
//      heal is PERSISTED (lead history + registry binding).
// Every fix is paired with its NEGATIVE CONTROL, and the negative controls are as load-bearing as the
// fixes: the gate must not over-block, and it must not widen captaincy to a delegation child.
//
// FIXTURE NOTES (honest bounds, carry into the PR body):
//   • ONE stub executor mints `child-<member name>` as the handle; that handle IS the member session's own
//     id in these arms, which is exactly how the record spells `executorRef` on a real spawn.
//   • The official identity plane is ABSENT (membership answers `undefined`), the measured condition of
//     every defect here — so nothing can pass by reading the official roster.
//   • The F5 churn arm stamps `header.parentSession` (a seeded fork shape: parent + depth 0 + NO subagent
//     origin). A recorded DELEGATION CHILD (`origin:"subagent"` or depth 1+) is the negative control.
//   • The F1 negative control plants a staged-but-approved plan by hand, which is the partial-approval
//     state (record written, archival skipped) the refusal sentence exists for.

import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { apply } from "../../../../../../packages/mpd-team-core-plugin/src/index.ts"
import { send as sendRawMail } from "../../../../../../packages/mpd-team-core-plugin/src/mailbox-store.ts"
import { archivePlan, newPlanId, stagePlan, writePlan, type StagedPlan } from "../../../../../../packages/mpd-team-core-plugin/src/plan-store.ts"
import { activeTeamId, createTeam, newTeamId, readTeam } from "../../../../../../packages/mpd-team-core-plugin/src/team-store.ts"

/** One assertion's outcome, in the shape the case already prints and writes to evidence. */
export interface Arm {
  /** The frozen assertion id (`f1`, `f1-neg`, …). */
  id: string
  /** What the arm asserts, in one line. */
  claim: string
  /** True when the observed behaviour matches the claim. */
  ok: boolean
  /** The observed value, so a red arm is diagnosable without re-running. */
  observed: string
}

/** One captured tool registration, with `execute` kept so an arm can drive it. */
interface Tool {
  /** The registered tool name. */
  name: string
  /** The registered tool's executor, exactly as the harness would call it. */
  execute: (args: unknown, exec: unknown) => Promise<unknown>
}

/** The extra session-header fields an arm stamps. */
interface HeaderOpts {
  /** The session TITLE (the persona prompt prefix). */
  title?: string
  /** The parent session the harness recorded. */
  parentSession?: string
  /** `"subagent"` marks a recorded delegation child. */
  origin?: string
  /** A recorded delegation depth of 1+ also marks a child. */
  delegationDepth?: number
}

/** The session id the fixture plan is approved from. */
const LEAD = "lead-session-1"

/** The instant the fixture store arms stamp. */
const NOW = new Date("2026-10-14T12:00:00.000Z")

// ── harness ─────────────────────────────────────────────────────────────────────────────────────

/** The mini-harness one arm drives: the sandbox and the registered tools. */
interface Harness {
  /** The sandbox workspace every call is scoped to. */
  workspace: string
  /** Drive one registered tool by name as a given session. */
  call: (name: string, args: unknown, sessionId: string, opts?: HeaderOpts) => Promise<unknown>
}

/**
 * Build the mini-harness: the REAL plugin applied against a stub composition.
 * @param workspace - the sandbox workspace to scope every call to.
 * @returns the harness an arm drives.
 */
function harness(workspace: string): Harness {
  /** The tools the plugin registered. */
  const tools = new Map<string, Tool>()
  /** The stub backend: it raises any member and mints a handle derived from the member's name. */
  const executor = {
    kind: "native",
    reason: "the case's own executor",
    providers: (): string[] => ["spawn"],
    spawn: async (_caller: unknown, request: { name?: string }): Promise<{ handle: string; executor: string }> => ({
      handle: "child-" + String(request?.name ?? "").replace(/\s+/g, "-"),
      executor: "native",
    }),
    send: async (): Promise<void> => {},
    interrupt: async (): Promise<void> => {},
    /** The official identity plane is ABSENT — the measured condition of these defects. */
    membership: (): undefined => undefined,
    members: (): [] => [],
  }
  /** The stub adapter: the seams this row uses, and nothing else. */
  const dsh = {
    registerTool: (definition: Tool): (() => void) => { tools.set(definition.name, definition); return () => {} },
    registerCommand: (): (() => void) => () => {},
    workspaceRoot: (): string => workspace,
    text: (value: unknown): unknown => value,
    teamExecutor: (): typeof executor => executor,
    teamMembership: (): undefined => undefined,
    teamListMembers: (): [] => [],
    teamListTasks: (): [] => [],
    capabilities: (): Record<string, never> => ({}),
  }
  /** The minimal cordis context `apply` needs. */
  const ctx = {
    get: (id: string) => (id === "mpdDsh" ? dsh : undefined),
    on: (): void => {},
    effect: (fn: () => unknown) => { try { return fn() ?? (() => {}) } catch { return () => {} } },
    provide: (): void => {},
    inject: (): void => {},
  }
  apply(ctx as never)
  return {
    workspace,
    call: async (name: string, args: unknown, sessionId: string, opts?: HeaderOpts) => {
      /** The registered tool, or a thrown error naming what WAS registered. */
      const tool = tools.get(name)
      if (tool === undefined) throw new Error(`no tool ${name}`)
      /** The session title, stamped only when the arm set one. */
      const title = opts?.title
      /** The parent session, stamped only when the arm recorded one. */
      const parentSession = opts?.parentSession
      /** The subagent origin, stamped only when the arm recorded one. */
      const origin = opts?.origin
      /** The delegation depth, stamped only when the arm recorded one. */
      const delegationDepth = opts?.delegationDepth
      /** The header, carrying exactly the fields the arm asked for. */
      const header = {
        ...(title === undefined ? {} : { title }),
        ...(parentSession === undefined ? {} : { parentSession }),
        ...(origin === undefined ? {} : { origin }),
        ...(delegationDepth === undefined ? {} : { delegationDepth }),
      }
      return tool.execute(args, { agent: { session: { id: sessionId, header } }, signal: undefined })
    },
  }
}

/**
 * Approve a two-member, two-task team through the REAL plan tool, as {@link LEAD}.
 * @param h - the harness to approve in.
 * @returns the approved team's id.
 */
async function approveTeam(h: Harness): Promise<string> {
  await h.call("agent_teams_plan", { action: "create", name: "the wave", description: "one wave" }, LEAD)
  await h.call("agent_teams_plan", { action: "add_member", member: { name: "Senior Engineer", description: "implements", prompt: "You implement." } }, LEAD)
  await h.call("agent_teams_plan", { action: "add_member", member: { name: "Reviewer", description: "judges", prompt: "You review." } }, LEAD)
  await h.call("agent_teams_plan", { action: "create_task", task: { subject: "the lane work", description: "own the record", owner: "Senior Engineer" } }, LEAD)
  await h.call("agent_teams_plan", { action: "create_task", task: { subject: "the review", description: "judge it", owner: "Reviewer" } }, LEAD)
  await h.call("agent_teams_plan", { action: "approve" }, LEAD)
  /** The team the approval bound to the Lead session. */
  const teamId = activeTeamId(h.workspace, LEAD)
  if (teamId === undefined) throw new Error("the approval bound no team to the lead session")
  return teamId
}

/**
 * The executor handle the record kept for one member — that member's OWN session id.
 * @param workspace - the workspace holding the record.
 * @param teamId - the team to read.
 * @param memberName - the member to look up.
 * @returns the recorded handle.
 */
function handleOf(workspace: string, teamId: string, memberName: string): string {
  /** The member as the durable record names it. */
  const member = readTeam(workspace, teamId)?.members.find((candidate) => candidate.name === memberName)
  if (member?.executorRef === undefined) throw new Error(`the record kept no handle for "${memberName}"`)
  return member.executorRef
}

/** One task's status as the record on DISK holds it. */
function statusOnDisk(workspace: string, teamId: string, taskId: string): string | undefined {
  return readTeam(workspace, teamId)?.tasks.find((candidate) => candidate.id === taskId)?.status
}

/**
 * A thrown refusal captured as an Error, so an arm can quote its sentence.
 * @param work - the call that is expected to refuse.
 * @returns the thrown value, or undefined when the call succeeded.
 */
async function refusalOf(work: Promise<unknown>): Promise<Error | undefined> {
  return work.then(() => undefined, (error: unknown) => error as Error)
}

// ── the arms ────────────────────────────────────────────────────────────────────────────────────

/**
 * The five C7-4 arms plus their eight negative controls, each with a fresh sandbox it removes itself.
 * @returns the arms, in the plan's fix order.
 */
export async function c74Arms(): Promise<Arm[]> {
  /** The arms produced, in order. */
  const out: Arm[] = []
  /** Every sandbox this call created, removed in the `finally`. */
  const sandboxes: string[] = []
  /** A fresh sandbox, registered for cleanup. */
  const sandbox = (): string => {
    /** The directory created for one fixture. */
    const dir = mkdtempSync(join(tmpdir(), "mpd-c74-case-"))
    sandboxes.push(dir)
    return dir
  }
  try {
    // ── F1 — the mid-run append lands on the APPROVED record ───────────────────────────────────
    {
      /** The F1 fixture. */
      const h = harness(sandbox())
      /** The approved team. */
      const teamId = await approveTeam(h)
      /** The tool's own answer for the append. */
      const answer = await h.call("agent_teams_plan", { action: "create_task", task: { subject: "the repair", description: "fix it", kind: "repair", coverageOf: "C7-4 F1", sourceTaskId: "T1" } }, LEAD) as { appended?: string }
      /** The row read back from DISK. */
      const minted = readTeam(h.workspace, teamId)?.tasks.at(-1)
      out.push({ id: "f1", claim: "mid-run create_task appends to the LIVE APPROVED record with kind/coverageOf/sourceTaskId", ok: (answer.appended ?? "").includes("live team " + teamId) && minted?.kind === "repair" && minted?.coverageOf === "C7-4 F1" && minted?.sourceTaskId === "T1", observed: `appended=${answer.appended ?? "(none)"} kind=${minted?.kind} coverageOf=${minted?.coverageOf} sourceTaskId=${minted?.sourceTaskId}` })

      // NEGATIVE CONTROL: a plan that IS staged and already approved still refuses.
      /** A second fixture whose staging slot is planted with an approved plan. */
      const staged = harness(sandbox())
      await approveTeam(staged)
      /** The staged-but-approved plan. */
      const stranded: StagedPlan = { version: 1, planId: "plan-stranded-1", sessionId: LEAD, name: "x", description: "", approval: "required", members: [], tasks: [], stagedAt: NOW.toISOString(), approvedAt: NOW.toISOString() }
      writePlan(staged.workspace, stranded)
      /** The refusal sentence. */
      const strandedFailure = await refusalOf(staged.call("agent_teams_plan", { action: "create_task", task: { subject: "x", description: "d" } }, LEAD))
      out.push({ id: "f1-neg-staged-approved", claim: "NEGATIVE CONTROL: a staged-but-approved plan still refuses", ok: String(strandedFailure?.message) === "plan plan-stranded-1 is already approved; stage a new one to change the team", observed: String(strandedFailure?.message ?? "(no refusal)") })

      // NEGATIVE CONTROL: no staged plan and no live team keeps the standing sentence.
      /** A third fixture with no team at all. */
      const none = harness(sandbox())
      /** The refusal sentence. */
      const noneFailure = await refusalOf(none.call("agent_teams_plan", { action: "create_task", task: { subject: "x", description: "d" } }, "sess-nobody"))
      out.push({ id: "f1-neg-no-team", claim: "NEGATIVE CONTROL: no staged plan and no live team keeps the standing sentence", ok: String(noneFailure?.message) === "no team is staged in this session — call agent_teams_create first", observed: String(noneFailure?.message ?? "(no refusal)") })
    }

    // ── F2 — a member closes its own row by its recorded name ──────────────────────────────────
    {
      /** The F2 fixture. */
      const h = harness(sandbox())
      /** The approved team. */
      const teamId = await approveTeam(h)
      /** The member's own session id, exactly as the record kept it. */
      const member = handleOf(h.workspace, teamId, "Senior Engineer")
      /** The closure's own answer. */
      const closed = await h.call("agent_teams_task", { action: "complete", task_id: "T1", note: "mine" }, member, { title: "You are the Senior Engineer, the roster's implementation specialist; ..." }) as { refused?: string; closedBy?: string }
      out.push({ id: "f2", claim: "a member session whose id IS the executorRef closes a row owned by its NAME", ok: closed.refused === undefined && closed.closedBy === "owner" && statusOnDisk(h.workspace, teamId, "T1") === "completed", observed: `refused=${closed.refused ?? "(none)"} closedBy=${closed.closedBy ?? "(none)"} status=${statusOnDisk(h.workspace, teamId, "T1")}` })

      // NEGATIVE CONTROL: a roster member still cannot close a row it does not own. A FRESH fixture, so
      // the positive arm above cannot have already made T1 terminal.
      /** The second fixture, whose T1 is still pending. */
      const neg = harness(sandbox())
      /** The negative fixture's team. */
      const negTeamId = await approveTeam(neg)
      /** The Reviewer's own session, which owns T2 and not T1. */
      const reviewer = handleOf(neg.workspace, negTeamId, "Reviewer")
      /** The refusal, in the shape the tool returns it. */
      const refused = await neg.call("agent_teams_task", { action: "complete", task_id: "T1" }, reviewer, { title: "You are the Reviewer." }) as { refused?: string }
      out.push({ id: "f2-neg", claim: "NEGATIVE CONTROL: a roster member still cannot close a row it does not own", ok: refused.refused === 'task T1 is owned by "Senior Engineer" and this caller is neither that owner nor this team\'s lead' && statusOnDisk(neg.workspace, negTeamId, "T1") === "pending", observed: refused.refused ?? "(no refusal)" })
    }

    // ── F3 — the mailbox summary is scoped ─────────────────────────────────────────────────────
    {
      /** The F3 fixture. */
      const h = harness(sandbox())
      await approveTeam(h)
      // One real message to THIS team, and one stale row from a wave that ended days ago.
      await h.call("agent_teams_mail", { action: "send", to: "Senior Engineer", subject: "hi", body: "work" }, LEAD)
      sendRawMail(h.workspace, { fromId: "x", fromName: "old-wave", toId: "foreign-sess", toName: "old-wave", subject: "stale", body: "b", memberIds: ["foreign-sess"] }, NOW)
      /** The tool's own answer. */
      const scoped = await h.call("agent_teams_mail", { action: "summary" }, LEAD) as { scope?: string; summary?: Array<{ memberId?: string }> }
      /** The member ids the scoped summary carries. */
      const ids = (scoped.summary ?? []).map((row) => row.memberId)
      out.push({ id: "f3", claim: "mailbox summary is FILTERED to the resolved team and labelled scope:team", ok: scoped.scope === "team" && ids.includes("M1") && !ids.includes("foreign-sess"), observed: `scope=${scoped.scope} ids=${JSON.stringify(ids)}` })

      // NEGATIVE CONTROL: no resolved team answers scope:workspace and the WHOLE fold.
      /** A second fixture with the stale row and no team. */
      const none = harness(sandbox())
      sendRawMail(none.workspace, { fromId: "x", fromName: "old-wave", toId: "foreign-sess", toName: "old-wave", subject: "stale", body: "b", memberIds: ["foreign-sess"] }, NOW)
      /** The tool's own answer for a session that belongs to no team. */
      const workspaceScope = await none.call("agent_teams_mail", { action: "summary" }, "sess-nobody") as { scope?: string; summary?: Array<{ memberId?: string }> }
      out.push({ id: "f3-neg", claim: "NEGATIVE CONTROL: no resolved team answers scope:workspace and the WHOLE fold", ok: workspaceScope.scope === "workspace" && (workspaceScope.summary ?? []).some((row) => row.memberId === "foreign-sess"), observed: `scope=${workspaceScope.scope} ids=${JSON.stringify((workspaceScope.summary ?? []).map((row) => row.memberId))}` })
    }

    // ── F4 — ids never collide, and a collision is REFUSED ─────────────────────────────────────
    {
      /** The first team id at the frozen instant. */
      const teamA = newTeamId(NOW)
      /** The second team id at the SAME instant. */
      const teamB = newTeamId(NOW)
      /** The first plan id at the frozen instant. */
      const planA = newPlanId(NOW)
      /** The second plan id at the SAME instant. */
      const planB = newPlanId(NOW)
      out.push({ id: "f4", claim: "two mints in the SAME millisecond differ (team and plan)", ok: teamA !== teamB && planA !== planB && /^team-\d{17}-[a-z0-9]+-[a-z0-9]+$/.test(teamA), observed: `teamA=${teamA} teamB=${teamB} planA=${planA} planB=${planB}` })

      // NEGATIVE CONTROL: a colliding TEAM id reddens.
      /** The sandbox for the collision controls. */
      const ws = sandbox()
      createTeam(ws, { name: "first", description: "", leadSessionId: "s1", teamId: "team-fixed-1" }, NOW)
      /** The refusal sentence. */
      const teamCollision = await refusalOf(Promise.resolve().then(() => createTeam(ws, { name: "second", description: "", leadSessionId: "s2", teamId: "team-fixed-1" }, NOW)))
      out.push({ id: "f4-neg-team", claim: "NEGATIVE CONTROL: a colliding TEAM id reddens (createTeam refuses an existing id)", ok: /already exists in this workspace/.test(String(teamCollision?.message ?? "")), observed: String(teamCollision?.message ?? "(no refusal)") })

      // NEGATIVE CONTROL: a colliding PLAN archive reddens.
      /** The plan about to be archived twice. */
      const plan = stagePlan(ws, "s1", { name: "one", description: "", approval: "required" }, NOW)
      archivePlan(ws, plan)
      /** The refusal sentence. */
      const planCollision = await refusalOf(Promise.resolve().then(() => archivePlan(ws, plan)))
      out.push({ id: "f4-neg-plan", claim: "NEGATIVE CONTROL: a colliding PLAN id reddens (archivePlan refuses an existing archive)", ok: /already archived in this workspace/.test(String(planCollision?.message ?? "")), observed: String(planCollision?.message ?? "(no refusal)") })
    }

    // ── F5 — a forked/resumed captain keeps its captaincy ──────────────────────────────────────
    {
      /** The F5 fixture. */
      const h = harness(sandbox())
      /** The approved team. */
      const teamId = await approveTeam(h)
      // The fork: a new session id whose recorded parent is the approving session.
      /** The closure's own answer. */
      const closed = await h.call("agent_teams_task", { action: "complete", task_id: "T2", note: "captain" }, "lead-fork-2", { parentSession: LEAD }) as { refused?: string; closedBy?: string }
      /** The healed record. */
      const healed = readTeam(h.workspace, teamId)
      out.push({ id: "f5", claim: "a forked lead session resolves and closes as lead, and the heal PERSISTS (history + registry)", ok: closed.refused === undefined && closed.closedBy === "lead" && (healed?.leadHistory ?? []).includes("lead-fork-2") && activeTeamId(h.workspace, "lead-fork-2") === teamId, observed: `closedBy=${closed.closedBy ?? "(none)"} history=${JSON.stringify(healed?.leadHistory ?? [])} bound=${activeTeamId(h.workspace, "lead-fork-2") ?? "(none)"}` })

      // NEGATIVE CONTROL: an unbound session with no history is still refused.
      /** The refusal sentence for a session the record never named. */
      const stranger = await refusalOf(h.call("agent_teams_task", { action: "complete", task_id: "T1" }, "lead-stranger"))
      out.push({ id: "f5-neg-unbound", claim: "NEGATIVE CONTROL: an unbound session with no history is still refused", ok: String(stranger?.message) === "no team record in this workspace — approve a plan first", observed: String(stranger?.message ?? "(no refusal)") })

      // NEGATIVE CONTROL: a delegation CHILD of the lead is NOT healed into the lead history.
      /** The refusal sentence for a recorded child. */
      const child = await refusalOf(h.call("agent_teams_task", { action: "complete", task_id: "T1" }, "child-of-lead", { parentSession: LEAD, origin: "subagent", delegationDepth: 1 }))
      out.push({ id: "f5-neg-child", claim: "NEGATIVE CONTROL: a delegation CHILD of the lead is NOT healed into the lead history", ok: String(child?.message) === "no team record in this workspace — approve a plan first" && !(readTeam(h.workspace, teamId)?.leadHistory ?? []).includes("child-of-lead"), observed: `${String(child?.message ?? "(no refusal)")}; history=${JSON.stringify(readTeam(h.workspace, teamId)?.leadHistory ?? [])}` })
    }

    return out
  } finally {
    for (const dir of sandboxes.splice(0)) rmSync(dir, { recursive: true, force: true })
  }
}
