#!/usr/bin/env bun
// Case team-dispatch-guard — the C7 amendment's HARD GATE (plan .mpd/plans/tui-015-adaptation.md,
// "Plan amendment (2026-10-14, user-mandated): C7"), landed by Lane Q.
//
// Landed by the wave's single skills writer: the C7-1..C7-3 seam assertions (author: Guard Engineer) and
// the C7-4 arms folded from evidence/tui/dsh-tui-015/guard/case-draft/c74/ per that draft's HANDOFF.
//
// WHAT IT PROVES. Four MEASURED defect classes, with the frozen assertions the plan names:
//   (a) C7-1 CROSS-TEAM: a task×member pairing across DIFFERENT teams is REFUSED, naming BOTH team ids.
//       HONEST BOUND: the mpd-native `agent_teams_dispatch` pass builds BOTH sides from ONE record, so a
//       cross-team pool is not constructible through the tool; the invariant is asserted at the PAIRING
//       SEAM (`planDispatch`/`pairingRefusal`), which is the code that decides every pairing.
//   (b) C7-2 READ-ONLY: through the REAL tool, a task carrying `write_scopes` is never paired with a
//       read-only specialist (its `readonly` flag comes from mpd-roles-plugin's OWN `mpdRoles` service),
//       and the refusal is REPORTED rather than a wrong-but-free member being grabbed.
//   (c) C7-3 PHANTOM TEAM: a team record whose phase is terminal/archived (or whose OWN plan, keyed by
//       the record's `planId`, was archived without approval) is SKIPPED by resolution and marked
//       terminal by the consistency pass.
//   (d) THE NEGATIVE CONTROL: a valid same-team, write-capable pairing still SUCCEEDS. The gate must not
//       over-block, so every refusal arm is paired with the positive one.
//   (e) C7-4 ADAPTATION ARMS (thirteen, driven through the REAL registered tools over a stub
//       composition): the mid-run `create_task` lands on the LIVE APPROVED record with its
//       requirement-chain fields; a member session closes a row owned by its NAME; the mailbox summary
//       is scoped to the resolved team; id mints never collide and a collision is refused; a forked
//       captain keeps its captaincy with a PERSISTED heal. Each of the five fixes carries its negative
//       control, and the official identity plane is ABSENT — the measured condition of these defects.
//
// PREREQ: absent-toolchain-binary .toolchain/node_modules/.bin/bun "install the pinned toolchain (AGENTS.md §6)"
// PREREQ: absent-runtime packages/mpd-team-core-plugin/src/dispatch.ts "this lane is in-process over the bundle's own source (no dsh spawn)"
//
// Usage:
//   bun skills/dsh-qa/scripts/team-dispatch-guard.ts --self-test
//   bun skills/dsh-qa/scripts/team-dispatch-guard.ts [--out <dir>]
// Evidence -> evidence/dsh-qa/team-dispatch-guard/<timestamp>/{result.json,output.log}
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { exitOnRefusal, refuseOverwrite, writeImmutable } from "./lib/immutable-output.ts"
import { isReadonlyMemberName, pairingRefusal, planDispatch, readonlyMemberKeys, type DispatchMember, type DispatchTask } from "../../../packages/mpd-team-core-plugin/src/dispatch.ts"
import { apply } from "../../../packages/mpd-team-core-plugin/src/index.ts"
import { send as sendRawMail } from "../../../packages/mpd-team-core-plugin/src/mailbox-store.ts"
import { archivePlan, newPlanId, stagePlan, writePlan, type StagedPlan } from "../../../packages/mpd-team-core-plugin/src/plan-store.ts"
import { isLiveTeam, isLiveTeamPhase, readArchivedPlanIndex, reapReapedTeams, resolveTeamRecord, type ArchivedPlanIndex } from "../../../packages/mpd-team-core-plugin/src/team-lifecycle.ts"
import { activeTeamId, bindActiveTeam, createTeam, newTeamId, readTeam, writeTeam, type TeamPhase, type TeamRecord } from "../../../packages/mpd-team-core-plugin/src/team-store.ts"
import { ROLES } from "../../../packages/mpd-roles-plugin/src/roles.data.ts"

/** The lane slug: the case name in cases.json and the evidence directory name. */
const SLUG = "team-dispatch-guard"

/** A board task for the guard arms; only the fields a guard reads are varied. */
function task(id: string, over: Partial<DispatchTask> = {}): DispatchTask {
  return { id, subject: "task " + id, status: "pending", ready: true, ...over }
}

/** An idle roster member for the guard arms; only the fields a guard reads are varied. */
function member(id: string, name: string, over: Partial<DispatchMember> = {}): DispatchMember {
  return { id, name, status: "inactive", ...over }
}

/** A minimal team record for the lifecycle arms; every field the rules do not read keeps a fixed value. */
function record(over: Partial<TeamRecord> & { teamId: string }): TeamRecord {
  return {
    version: 1,
    name: "wave",
    description: "why",
    leadSessionId: "lead-1",
    phase: "active",
    createdAt: "2026-10-14T00:00:00.000Z",
    members: [],
    tasks: [],
    nextMemberNumber: 1,
    nextTaskNumber: 1,
    ...over,
  }
}

/** An archive index carrying no evidence, for arms that do not exercise the archive rule. */
const EMPTY_INDEX: ArchivedPlanIndex = { approved: new Set<string>(), unapproved: new Set<string>() }

/** The roster rows EXACTLY as mpd-roles-plugin's `mpdRoles` service publishes them. */
const ROSTER_ROWS = ROLES.map((role) => ({ name: role.name, readonly: role.readonly }))

/** The read-only key set the dispatch tool builds from that service, per call. */
const READONLY_KEYS = readonlyMemberKeys(ROSTER_ROWS)

/** One assertion's outcome, printed and written to evidence. */
interface Arm {
  /** The frozen assertion id: a | b | c | d. */
  id: string
  /** What the arm asserts, in one line. */
  claim: string
  /** True when the observed behaviour matches the claim. */
  ok: boolean
  /** The observed value, so a red arm is diagnosable without re-running. */
  observed: string
}

/** Run the four frozen assertions over the pure seam (the offline half and the whole falsifier). */
function arms(): Arm[] {
  /** The accumulated arms, in the plan's order. */
  const out: Arm[] = []
  /** (a) a cross-team pairing is refused, with BOTH ids in the sentence. */
  const cross = planDispatch({ tasks: [task("T1", { teamId: "team-a" })], members: [member("m-foreign", "qa-reader-writer", { teamId: "team-b" })], ledger: {} })
  /** The refusal sentence, which must name the task team and the member team. */
  const crossReason = cross.skipped[0]?.reason ?? ""
  out.push({ id: "a", claim: "cross-team pairing REFUSED, naming both team ids", ok: cross.pairs.length === 0 && crossReason.includes("team-a") && crossReason.includes("team-b") && crossReason.includes("CROSS-TEAM"), observed: crossReason })
  /** (b) a write task never pairs with a read-only specialist, and the reason is reported. */
  const readOnly = planDispatch({ tasks: [task("T5", { teamId: "team-a", writeScopes: ["packages/x"] })], members: [member("m-ro", "Plan Reviewer", { teamId: "team-a", readonly: isReadonlyMemberName("Plan Reviewer", READONLY_KEYS) })], ledger: {} })
  /** The refusal sentence for the read-only arm. */
  const readOnlyReason = readOnly.skipped[0]?.reason ?? ""
  out.push({ id: "b", claim: "write task × read-only member REFUSED, reason reported", ok: readOnly.pairs.length === 0 && readOnlyReason.includes("WRITE-TASK-ON-READ-ONLY") && readOnlyReason.includes("Plan Reviewer"), observed: readOnlyReason })
  /** (c) resolution skips a terminal team and falls through to the live one, or to none. */
  const ghost = record({ teamId: "team-ghost", phase: "archived" as TeamPhase, leadSessionId: "lead-1", createdAt: "2026-10-14T02:00:00.000Z" })
  /** The live team the same lead now works in. */
  const live = record({ teamId: "team-live", phase: "active", leadSessionId: "lead-1", createdAt: "2026-10-14T01:00:00.000Z" })
  /** The fall-through resolution (ghost newest first, so it would win without the skip). */
  const resolved = resolveTeamRecord({ teams: [ghost, live], sessionId: "lead-1", index: EMPTY_INDEX })
  /** The resolution when ONLY the ghost exists. */
  const none = resolveTeamRecord({ teams: [ghost], sessionId: "lead-1", index: EMPTY_INDEX })
  // The archive arm keys by the RECORD'S OWN plan id, exactly as the shipped reader builds the index
  // (PR #42 review F-D): a legacy `lead\0name` key is not evidence about any record, so a fixture that
  // keys by it asserts a rule the shipped code no longer has. Three directions, so the alignment cannot
  // trade assertion power for green: the record whose OWN plan was discarded is NOT live; the record
  // whose OWN plan was archived WITH approval STAYS live (the normal archive of an approved team); and
  // the legacy-keyed index is IGNORED for a record that carries a plan id.
  /** The ghost record whose OWN plan was archived WITHOUT approval. */
  const archiveGhost = record({ teamId: "team-x", phase: "active", planId: "plan-ghost" })
  /** The live record whose OWN plan was archived WITH approval. */
  const archiveLive = record({ teamId: "team-y", phase: "active", planId: "plan-live" })
  /** The index exactly as `readArchivedPlanIndex` builds it: keyed by each plan's own id. */
  const archiveIndex: ArchivedPlanIndex = { approved: new Set<string>(["plan-live"]), unapproved: new Set<string>(["plan-ghost"]) }
  /** Whether the discarded plan's own team is NOT live. */
  const archiveReaped = isLiveTeam(archiveGhost, archiveIndex)
  /** Whether the approved plan's own team stays live. */
  const archiveLiveKept = isLiveTeam(archiveLive, archiveIndex)
  /** Whether a LEGACY `lead\0name` index is ignored for a record carrying a plan id. */
  const legacyKeyIgnored = isLiveTeam(archiveGhost, { approved: new Set<string>(), unapproved: new Set<string>(["lead-1\u0000wave"]) })
  out.push({ id: "c", claim: "terminal/archived team SKIPPED, live team resolves, none when only a ghost, and the archive arm keys by the record's OWN plan id", ok: resolved.record?.teamId === "team-live" && none.record === undefined && isLiveTeamPhase("active") && !isLiveTeamPhase("archived") && archiveReaped === false && archiveLiveKept === true && legacyKeyIgnored === true, observed: `resolved=${resolved.record?.teamId ?? "(none)"} onlyGhost=${none.record?.teamId ?? "(none)"} archiveReaped=${archiveReaped} archiveLiveKept=${archiveLiveKept} legacyKeyIgnored=${legacyKeyIgnored}` })
  /** (d) THE NEGATIVE CONTROL: a valid same-team, write-capable pairing still succeeds. */
  const valid = planDispatch({ tasks: [task("T2", { teamId: "team-a", writeScopes: ["packages/x"] })], members: [member("m-w", "Senior Engineer", { teamId: "team-a", readonly: isReadonlyMemberName("Senior Engineer", READONLY_KEYS) })], ledger: {} })
  out.push({ id: "d", claim: "NEGATIVE CONTROL: a valid same-team write-capable pairing still SUCCEEDS", ok: valid.pairs.length === 1 && valid.pairs[0]?.memberId === "m-w" && valid.skipped.length === 0, observed: JSON.stringify(valid.pairs.map((pair) => [pair.taskId, pair.memberId])) })
  return out
}

/** Print the arms and return the exit code (0 = every assertion holds). */
async function selfTest(): Promise<number> {
  /** The arm outcomes: the C7-1..C7-3 seam assertions plus the C7-4 tool-driven arms. */
  const results = [...arms(), ...(await c74Arms())]
  for (const arm of results) console.log(`${arm.ok ? "ok  " : "FAIL"} (${arm.id}) ${arm.claim} — ${arm.observed}`)
  /** Whether every arm held. */
  const ok = results.every((arm) => arm.ok)
  console.log(ok ? `SELF-TEST: PASS (${results.length} arms: 4 C7-1..C7-3 seam assertions + 13 C7-4 arms incl. their negative controls)` : "SELF-TEST: FAIL")
  return ok ? 0 : 1
}

/**
 * The real-lane arm: the guard behaviour over the REAL team store, driven through the resolution and
 * consistency-pass entry points. (The tool-level arm — `agent_teams_dispatch` over the mounted built
 * row — is the wiring Deep Worker adds beside this file's assertions; see HANDOFF.md.)
 * @returns the arms produced by this lane, so `main` can gate on them.
 */
function realLaneArms(): { arms: Arm[]; workspace: string } {
  /** The sandbox workspace every record is written into. */
  const workspace = mkdtempSync(join(tmpdir(), "mpd-c7-lane-"))
  // (b) a write task and an idle read-only member: the record's own roster classifies the member.
  writeTeam(workspace, record({
    teamId: "team-guard",
    name: "guard",
    leadSessionId: "lead-gate",
    phase: "active",
    members: [
      { id: "M1", name: "Plan Reviewer", role: "Plan Reviewer", description: "read-only", status: "running", executorRef: "sess-ro", spawnedAt: "2026-10-14T00:00:00.000Z" },
      { id: "M2", name: "Senior Engineer", description: "writes", status: "running", executorRef: "sess-w", spawnedAt: "2026-10-14T00:00:00.000Z" },
    ],
    tasks: [
      { id: "T1", subject: "write task", description: "writes", kind: "work", status: "pending", blockedBy: [], writeScopes: ["packages/x"], revision: 1, createdAt: "2026-10-14T00:00:00.000Z", updatedAt: "2026-10-14T00:00:00.000Z" },
    ],
    nextMemberNumber: 3,
    nextTaskNumber: 2,
  }))
  bindActiveTeam(workspace, "lead-gate", "team-guard")
  // The pass the tool performs: tasks and members both tagged with the resolved record's team id.
  /** The record under test. */
  const opened = readTeam(workspace, "team-guard")!
  /** The board in the dispatch engine's shape, exactly as the tool builds it. */
  const tasks = opened.tasks.map((t) => ({ id: t.id, subject: t.subject, status: t.status, ready: true, blockedBy: t.blockedBy, teamId: opened.teamId, writeScopes: t.writeScopes }))
  /** The roster in the dispatch engine's shape, exactly as the tool builds it (readonly from the service rows). */
  const members = opened.members.map((m) => ({ id: m.executorRef ?? m.id, name: m.name, status: "inactive", teamId: opened.teamId, readonly: isReadonlyMemberName(m.name, READONLY_KEYS) || (m.role !== undefined && isReadonlyMemberName(m.role, READONLY_KEYS)) }))
  /** A pass with ONLY the read-only member idle: the write task must be refused. */
  const refused = planDispatch({ tasks, members: members.filter((m) => m.readonly === true), ledger: {} })
  /** A pass with ONLY the write-capable member idle: the same task must pair (the negative control). */
  const paired = planDispatch({ tasks, members: members.filter((m) => m.readonly !== true), ledger: {} })
  // (c) the phantom: a terminal record bound for a lead.
  writeTeam(workspace, record({ teamId: "team-phantom", name: "phantom", leadSessionId: "lead-ghost", phase: "archived" as TeamPhase }))
  bindActiveTeam(workspace, "lead-ghost", "team-phantom")
  /** The archive index for this workspace. */
  const index = readArchivedPlanIndex(workspace)
  /** The resolution a bound ghost produces. */
  const resolved = resolveTeamRecord({ bound: readTeam(workspace, "team-phantom")!, teams: [record({ teamId: "team-phantom", name: "phantom", leadSessionId: "lead-ghost", phase: "archived" as TeamPhase })], sessionId: "lead-ghost", index })
  /** The ids the consistency pass marked terminal. */
  const reaped = reapReapedTeams(workspace, new Date("2026-10-14T10:00:00.000Z"))
  /** The repaired record. */
  const repaired = readTeam(workspace, "team-phantom")
  return {
    workspace,
    arms: [
      { id: "b-real", claim: "REAL store: the write task is refused the read-only member, reason reported", ok: refused.pairs.length === 0 && (refused.skipped[0]?.reason ?? "").includes("WRITE-TASK-ON-READ-ONLY"), observed: refused.skipped[0]?.reason ?? "(no skip)" },
      { id: "d-real", claim: "REAL store NEGATIVE CONTROL: the same task pairs with the write-capable member", ok: paired.pairs.length === 1 && paired.pairs[0]?.memberId === "sess-w", observed: JSON.stringify(paired.pairs.map((pair) => pair.memberId)) },
      { id: "c-real", claim: "REAL store: the bound phantom resolves NOTHING and is marked terminal with a reason", ok: resolved.record === undefined && reaped.includes("team-phantom") && repaired?.phase === "ended" && (repaired?.archivedReason ?? "").includes("not a live team phase"), observed: `resolved=${resolved.record?.teamId ?? "(none)"} reaped=${JSON.stringify(reaped)} phase=${repaired?.phase}` },
      { id: "registry-real", claim: "REAL store: the terminal team's OWN bound lead no longer resolves it", ok: activeTeamId(workspace, "lead-ghost") === "team-phantom" && resolveTeamRecord({ bound: repaired!, teams: [repaired!], sessionId: "lead-ghost", index }).record === undefined, observed: `bound=${activeTeamId(workspace, "lead-ghost")} resolved=${resolveTeamRecord({ bound: repaired!, teams: [repaired!], sessionId: "lead-ghost", index }).record?.teamId ?? "(none)"}` },
    ],
  }
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

/** The lane entry point: `--self-test`, else the real lane with evidence. */
async function main(argv: readonly string[]): Promise<number> {
  if (argv.includes("--self-test")) return await selfTest()
  /** The explicit `--out` target, when the caller pinned one. */
  const outIndex = argv.indexOf("--out")
  /** The requested evidence directory, or undefined to derive one. */
  const requested = outIndex >= 0 ? argv[outIndex + 1] : undefined
  if (requested !== undefined) refuseOverwrite(requested, { label: "evidence dir", remedy: "pass a fresh --out directory" })
  /** The real-lane outcome, whose workspace this function owns and removes. */
  const lane = realLaneArms()
  try {
    /** Every arm: the four frozen seam assertions, the real-store arms and the C7-4 arms. */
    const all = [...arms(), ...lane.arms, ...(await c74Arms())]
    for (const arm of all) console.log(`${arm.ok ? "ok  " : "FAIL"} (${arm.id}) ${arm.claim} — ${arm.observed}`)
    /** The derived evidence directory. */
    const dir = requested ?? join(process.cwd(), "evidence", "dsh-qa", SLUG, new Date().toISOString().replace(/[:.]/g, "-"))
    writeImmutable(join(dir, "result.json"), JSON.stringify({ case: SLUG, ok: all.every((arm) => arm.ok), arms: all }, null, 2) + "\n")
    console.log(`evidence -> ${dir}`)
    return all.every((arm) => arm.ok) ? 0 : 1
  } finally {
    rmSync(lane.workspace, { recursive: true, force: true })
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => exitOnRefusal(error, SLUG),
)
