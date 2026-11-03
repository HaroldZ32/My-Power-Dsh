#!/usr/bin/env bun
// review-b3 — the T10 probe: does the REPAIRED end verb still grant a MEMBER Lead authority when the
// session's own id is not the record's executorRef (a resumed member / a handle-less member row)?
//
// The reviewed Blocker (B1) was the shape where the member's session id IS the executorRef; that shape is
// now refused. This probe measures the REMAINING shape, and keeps every control beside it:
//   arm T1  member session (id != executorRef) + {parentSession: lead} + persona TITLE → ???  (the question)
//   arm T2  the same session ALSO stamped origin:"subagent"                            → must not end
//   arm T3  the exact reviewed shape (session id == executorRef) + parentSession        → must be refused
//   arm T4  a genuine fork (not on the roster, no roster title)                        → must END by design
//   arm T5  the title-shaped member's live-ROSTER append (callerIdentity's own path)   → measures whether
//           the plane's identity rule sees this session as a member at all
// Exit 0 only when every EXPECTED arm matches (T2/T3 refuse, T4 ends); T1/T5 are printed, not gated,
// because they are the measurement.
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { apply, TEAMS_SERVICE, type MpdTeamsService } from "../../../../../packages/mpd-team-core-plugin/src/index.ts"
import { activeTeamId, listTeams, readTeam, type TeamRecord } from "../../../../../packages/mpd-team-core-plugin/src/team-store.ts"

/** The sandbox workspace every call is scoped to. */
const workspace = mkdtempSync(join(tmpdir(), "mpd-review-b3-"))
/** The tools the plugin registered. */
const tools = new Map<string, any>()
/** A disposer-returning no-op for the seams this probe never exercises. */
const noop = (): (() => void) => () => {}
/** The stub executor: raise a member, accept a send, interrupt nothing. */
const executor = { kind: "native" as const, reason: "stub", providers: () => ["mpd-roster"], spawn: async (_c: unknown, r: any) => ({ handle: `child-${r.name}` }), send: async () => {}, interrupt: async () => {}, membership: () => undefined, members: () => [] }
/** The stub adapter the plugin reaches through `ctx.get("mpdDsh")`. */
const dsh = new Proxy({} as Record<string | symbol, unknown>, { get: (_t, prop) => {
  if (prop === "registerTool") return (definition: any) => { tools.set(definition.name, definition); return () => {} }
  if (prop === "registerCommand") return () => () => {}
  if (prop === "workspaceRoot") return () => workspace
  if (prop === "teamExecutor") return () => executor
  if (prop === "teamListMembers" || prop === "teamListTasks") return () => []
  if (prop === "capabilities") return () => ({})
  return noop
} })
/** The service the plugin publishes (unused by the arms). */
let service: MpdTeamsService | undefined
/** The minimal cordis context `apply` needs. */
const ctx = { get: (id: string) => (id === "mpdDsh" ? dsh : id === "mpdRoles" ? { list: () => [] } : undefined), on: noop, effect: (fn: () => unknown) => { try { return fn() ?? (() => {}) } catch { return () => {} } }, provide: (id: string, value: unknown) => { if (id === TEAMS_SERVICE) service = value as MpdTeamsService }, inject: noop }
apply(ctx as never)
/** The Lead session. */
const LEAD = "sess-lead"
/** The persona-prompt prefix the harness stamps as a member session's title. */
const TITLE = "You are the Senior Engineer, the roster's implementation specialist; ..."
/** Call one tool as one session, with the harness facts the arms vary. */
async function callAs(name: string, args: unknown, sessionId: string, header: Record<string, unknown> = {}): Promise<Record<string, any>> {
  const tool = tools.get(name)
  if (tool === undefined) throw new Error(`no tool ${name}`)
  return await tool.execute(args, { agent: { session: { id: sessionId, header: { cwd: workspace, ...header } } }, signal: undefined }) as Record<string, any>
}
/** Stage and approve a one-member wave as the Lead. */
async function approvedWave(): Promise<TeamRecord> {
  await callAs("agent_teams_plan", { action: "create", name: "b3", description: "d" }, LEAD)
  await callAs("agent_teams_plan", { action: "add_member", member: { name: "Senior Engineer", description: "i", prompt: "p", role: "Senior Engineer" } }, LEAD)
  await callAs("agent_teams_plan", { action: "create_task", task: { subject: "w", description: "d", blocked_by: [], owner: "Senior Engineer" } }, LEAD)
  const reply = await callAs("agent_teams_plan", { action: "approve" }, LEAD)
  return reply.team as TeamRecord
}
/** Run one call expected to refuse; answer the sentence or a marker. */
async function refusalOf(run: () => Promise<unknown>): Promise<string> {
  try { await run(); return "NO REFUSAL" } catch (error) { return String((error as Error)?.message ?? error) }
}
const out: Record<string, unknown> = {}
/** The approved team and the member's recorded executor handle. */
const team = await approvedWave()
const memberHandle = String(team.members[0]?.executorRef ?? "")
out.memberHandle = memberHandle
out.teamId = team.teamId
// T1 — the remaining shape: id is NOT the executorRef, parentSession is the Lead, no origin/depth.
const resumed = "member-resumed-77"
out.armT1 = await callAs("agent_teams_control", { action: "end", reason: "resumed member closed the wave" }, resumed, { parentSession: LEAD, title: TITLE }).then((r: any) => r, (e: any) => `REFUSED: ${e.message}`)
out.t1After = { phase: readTeam(workspace, team.teamId)?.phase, endedAt: readTeam(workspace, team.teamId)?.endedAt }
out.t1HealedHistory = readTeam(workspace, team.teamId)?.leadHistory ?? []
out.t1Binding = activeTeamId(workspace, resumed)
// T2 — the same session as a recorded delegation child must not end.
const team2 = await approvedWave()
out.armT2 = await refusalOf(() => callAs("agent_teams_control", { action: "end" }, resumed, { parentSession: LEAD, title: TITLE, origin: "subagent" }))
out.t2Phase = readTeam(workspace, team2.teamId)?.phase
// T3 — the reviewed shape (id == executorRef) must be refused.
const team3 = await approvedWave()
out.armT3 = await refusalOf(() => callAs("agent_teams_control", { action: "end" }, String(team3.members[0]?.executorRef), { parentSession: LEAD }))
out.t3Phase = readTeam(workspace, team3.teamId)?.phase
// T4 — a genuine fork (not on the roster) must still end by design.
const team4 = await approvedWave()
out.armT4 = await callAs("agent_teams_control", { action: "end", reason: "fork closed it" }, "sess-lead-fork", { parentSession: LEAD, title: "You are the captain's fork." }).then((r: any) => r, (e: any) => `REFUSED: ${e.message}`)
out.t4Phase = readTeam(workspace, team4.teamId)?.phase
// T5 — the title-shaped member's live-roster append (the plane's callerIdentity path, pre-existing).
const team5 = await approvedWave()
out.armT5Append = await callAs("agent_teams_plan", { action: "add_member", member: { name: "Sneak", description: "x", prompt: "y" } }, resumed, { parentSession: LEAD, title: TITLE }).then((r: any) => "ALLOWED (appended " + String(r?.member?.name ?? "?") + ")", (e: any) => `REFUSED: ${e.message}`)
out.t5LeadHistory = readTeam(workspace, team5.teamId)?.leadHistory ?? []
out.t5Roster = (readTeam(workspace, team5.teamId)?.members ?? []).map((m: any) => m.name)
/** The gated arms only: the repaired refusal shape and the by-design fork. */
const failures: string[] = []
if (String(out.armT2).startsWith("NO")) failures.push("T2 was not refused")
if (String(out.armT3).startsWith("NO")) failures.push("T3 (reviewed shape) was NOT refused")
if ((out.armT4 as any)?.changed !== true) failures.push("T4 (genuine fork) could not end")
out.failures = failures
out.pass = failures.length === 0
console.log(JSON.stringify(out, null, 2))
console.log(failures.length === 0 ? "PROBE PASS (gated arms)" : "PROBE FAIL (gated arms)")
