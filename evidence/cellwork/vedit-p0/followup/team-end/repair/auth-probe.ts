#!/usr/bin/env bun
// THE REVIEWER'S AUTH PROBE, reconstructed from `../review-b2/11-auth-probe.log` + its REPORT (B1/M1).
//
// The reviewer's probe script was not kept on disk (only its JSON log was), so this file re-creates the
// four arms it describes and drives the REAL tool against the REAL store:
//   arm A  a roster member with `{parentSession: lead}` and NO origin/depth  → must be REFUSED (B1)
//   arm B  the same member with `origin:"subagent"`                          → refused (control)
//   arm C  the same member with `delegationDepth:1`                          → refused (control)
//   arm D  a FORKED Lead (not on the roster, `parentSession` = the Lead)     → must END (C7-4 lineage)
//   arm M1 default-target end then the SAME call again                       → reported no-op, not a refusal
// It also prints the OLD raw check's verdict on the same record, so "the arm would have been red before
// the fix" is a measurement rather than a claim.
//
// Exit code: 0 when every arm matches; 1 with the failure list otherwise.
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { apply, TEAMS_SERVICE, type MpdTeamsService } from "../../../../../../packages/mpd-team-core-plugin/src/index.ts"
import { listTeams, memberNamedBy, readTeam, recordNamesLead, type TeamRecord } from "../../../../../../packages/mpd-team-core-plugin/src/team-store.ts"

/** The sandbox workspace every call is scoped to. */
const workspace = mkdtempSync(join(tmpdir(), "mpd-auth-probe-"))
/** The tools the plugin registered. */
const tools = new Map<string, any>()
/** A disposer-returning no-op for the seams this probe never exercises. */
const noop = (): (() => void) => () => {}
/** The stub executor: raise a member, accept a send, interrupt nothing. */
const executor = {
  kind: "native" as const,
  reason: "stub",
  providers: () => ["mpd-roster"],
  spawn: async (_caller: unknown, request: { name: string }) => ({ handle: `child-${request.name}` }),
  send: async () => {},
  interrupt: async () => {},
  membership: () => undefined,
  members: () => [],
}
/** The stub adapter the plugin reaches through `ctx.get("mpdDsh")`. */
const dsh = new Proxy({} as Record<string | symbol, unknown>, {
  get: (_target, prop) => {
    if (prop === "registerTool") return (definition: any) => { tools.set(definition.name, definition); return () => {} }
    if (prop === "registerCommand") return () => () => {}
    if (prop === "workspaceRoot") return () => workspace
    if (prop === "teamExecutor") return () => executor
    if (prop === "teamListMembers" || prop === "teamListTasks") return () => []
    if (prop === "capabilities") return () => ({})
    return noop
  },
})
/** The service the plugin publishes (unused by the arms, kept so boot matches the test fixture). */
let service: MpdTeamsService | undefined
/** The minimal cordis context `apply` needs. */
const ctx = {
  get: (id: string) => (id === "mpdDsh" ? dsh : id === "mpdRoles" ? { list: () => [] } : undefined),
  on: noop,
  effect: (fn: () => unknown) => { try { return fn() ?? (() => {}) } catch { return () => {} } },
  provide: (id: string, value: unknown) => { if (id === TEAMS_SERVICE) service = value as MpdTeamsService },
  inject: noop,
}
apply(ctx as never)

/**
 * Call one tool as one session, with the harness facts the arms vary.
 * @param name - the tool name.
 * @param args - its arguments.
 * @param sessionId - the calling session.
 * @param header - extra session-header facts.
 * @returns the tool body's value.
 */
async function callAs(name: string, args: unknown, sessionId: string, header: Record<string, unknown> = {}): Promise<Record<string, any>> {
  /** The registered tool. */
  const tool = tools.get(name)
  if (tool === undefined) throw new Error(`no tool ${name}`)
  /** The exec payload: session id plus the header facts the lineage rule reads. */
  const exec = { agent: { session: { id: sessionId, header: { cwd: workspace, ...header } } }, signal: undefined }
  return await tool.execute(args, exec) as Record<string, any>
}

/**
 * Stage and approve a one-member, one-task wave as one Lead session.
 * @param sessionId - the Lead session.
 * @returns the team record the approval wrote.
 */
async function approvedWaveAs(sessionId: string): Promise<TeamRecord> {
  await callAs("agent_teams_plan", { action: "create", name: "probe-wave", description: "probe" }, sessionId)
  await callAs("agent_teams_plan", { action: "add_member", member: { name: "Engineer", description: "implements", prompt: "You implement.", role: "Senior Engineer" } }, sessionId)
  await callAs("agent_teams_plan", { action: "create_task", task: { subject: "work", description: "do it", blocked_by: [], owner: "Engineer" } }, sessionId)
  /** The approve reply, whose `team` is the record it built. */
  const reply = await callAs("agent_teams_plan", { action: "approve" }, sessionId)
  return reply.team as TeamRecord
}

/**
 * Run one call expected to refuse.
 * @param run - the call.
 * @returns the refusal sentence, or a marker string when it unexpectedly succeeded.
 */
async function attempt(run: () => Promise<unknown>): Promise<string> {
  try {
    await run()
  } catch (error) {
    return (error as Error).message
  }
  return "<NO REFUSAL — the call succeeded>"
}

/** Every arm's observation, printed as the probe's JSON. */
const out: Record<string, unknown> = {}
/** The arms that did not match their expectation. */
const failures: string[] = []

/** The lead session every ordinary arm runs as. */
const LEAD = "sess-lead"
/** The first team, its member handle and the raw record. */
const first = await approvedWaveAs(LEAD)
/** The member's session id, which is the record's own `executorRef`. */
const memberHandle = String(first.members[0]?.executorRef ?? "")
out.memberHandle = memberHandle
out.leadSession = LEAD
out.teamId = first.teamId

// ARM A — the B1 bypass shape: parent recorded, no origin, no depth.
/** The refusal for the member's parent-only session. */
const armA = await attempt(() => callAs("agent_teams_control", { action: "end" }, memberHandle, { parentSession: LEAD }))
out.armA = armA
if (!armA.includes("is a member, not the Lead")) failures.push("armA did not refuse with the member sentence")
/** The record after arm A: still live. */
const afterA = readTeam(workspace, first.teamId) as TeamRecord
if (afterA.endedAt !== undefined) failures.push("armA ENDED the team (bypass still open)")
// THE DISCRIMINATOR: the OLD raw expression on the SAME record still answers "yes, this is the Lead",
// which is exactly what the pre-repair code consulted. The narrowed check answers "member".
out.oldRawCheck = recordNamesLead(afterA, [memberHandle, LEAD])
out.narrowedNamesMember = memberNamedBy(afterA, [memberHandle]) !== undefined
if (out.oldRawCheck !== true) failures.push("the old raw check did not reproduce the bypass shape")
if (out.narrowedNamesMember !== true) failures.push("the narrowed check did not identify the member row")

// ARMS B/C — the two shapes `where()` already drops, kept as controls.
/** The refusal for the `origin:"subagent"` shape. */
const armB = await attempt(() => callAs("agent_teams_control", { action: "end" }, memberHandle, { parentSession: LEAD, origin: "subagent" }))
out.armB = armB
if (!armB.includes("is a member, not the Lead")) failures.push("armB did not refuse")
/** The refusal for the `delegationDepth:1` shape. */
const armC = await attempt(() => callAs("agent_teams_control", { action: "end" }, memberHandle, { parentSession: LEAD, delegationDepth: 1 }))
out.armC = armC
if (!armC.includes("is a member, not the Lead")) failures.push("armC did not refuse")

// ARM D — a FORKED Lead (not on the roster) must still end, through the C7-4 lineage.
/** The fork's close. */
const armD = await callAs("agent_teams_control", { action: "end", reason: "fork closed the probe wave" }, "sess-lead-fork", { parentSession: LEAD })
out.armD = armD
if (armD.changed !== true) failures.push("armD (forked Lead) could not end the team")
if (readTeam(workspace, first.teamId)?.phase !== "ended") failures.push("armD left the record live")

// ARM M1 — the default-target repeat must REPORT the first ending, never throw the no-record refusal.
/** The second team, ended by the default target and then repeated. */
const second = await approvedWaveAs(LEAD)
/** The first default-target ending. */
const m1First = await callAs("agent_teams_control", { action: "end", reason: "probe wave landed" }, LEAD)
/** The identical call again. */
const m1Repeat = await callAs("agent_teams_control", { action: "end" }, LEAD)
out.m1 = { first: m1First, repeat: m1Repeat }
if (m1First.changed !== true) failures.push("m1 first end did not change")
if (m1Repeat.changed !== false) failures.push("m1 repeat was not the reported no-op")
if (m1Repeat.endedAt !== m1First.endedAt) failures.push("m1 repeat returned a different endedAt")
if (m1Repeat.reason !== "probe wave landed") failures.push("m1 repeat returned a different reason")
if (m1Repeat.teamId !== second.teamId) failures.push("m1 repeat reported a different team")
// And the no-op is exactly what the ended record holds.
if (readTeam(workspace, second.teamId)?.endedAt !== m1First.endedAt) failures.push("m1 record and reply disagree")

out.failures = failures
out.pass = failures.length === 0
console.log(JSON.stringify(out, null, 2))
console.log(failures.length === 0 ? "PROBE PASS" : "PROBE FAIL")
rmSync(workspace, { recursive: true, force: true })
process.exit(failures.length === 0 ? 0 : 1)
