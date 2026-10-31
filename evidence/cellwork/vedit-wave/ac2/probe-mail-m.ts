// R1's OWN re-review probe for CR repair M (CR#9): a supplied-but-unresolvable `member` must REFUSE,
// not fall back to the caller's own inbox. Drives the REAL registered `agent_teams_mail` tool through a
// stub composition in `mkdtemp` workspaces (§7 R9). The lane's tests are run, never used as proof.
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { apply, TEAMS_SERVICE, type MpdTeamsService } from "../../../../packages/mpd-team-core-plugin/src/index.ts"
import { send as sendRawMail } from "../../../../packages/mpd-team-core-plugin/src/mailbox-store.ts"
import { activeTeamId, readTeam } from "../../../../packages/mpd-team-core-plugin/src/team-store.ts"

/** The session the plan is approved from. */
const LEAD = "lead-session-1"

/** The instant every planted row stamps. */
const NOW = new Date("2026-10-31T06:00:00.000Z")

/** Results of every arm. */
const failures: string[] = []

/** Record one arm's outcome and print it. */
function arm(id: string, ok: boolean, detail: string): void {
  if (!ok) failures.push(id)
  console.log(`${ok ? "PASS" : "FAIL"} ${id} — ${detail}`)
}

/** One captured tool registration. */
interface Tool {
  /** The registered tool name. */
  name: string
  /** The registered executor. */
  execute: (args: unknown, exec: unknown) => Promise<unknown>
}

/** The stub harness: a sandbox workspace and the tools `apply` registered. */
interface Harness {
  /** The sandbox workspace. */
  workspace: string
  /** Drive one tool as one session. */
  call: (name: string, args: unknown, sessionId: string) => Promise<unknown>
}

/** Build the harness (the official plane absent; the record is the roster). */
function harness(): Harness {
  const workspace = mkdtempSync(join(tmpdir(), "r1-m-"))
  const tools = new Map<string, Tool>()
  let service: MpdTeamsService | undefined
  const executor = {
    kind: "native",
    reason: "probe",
    providers: (): string[] => ["spawn"],
    spawn: async (_caller: unknown, request: { name?: string }): Promise<{ handle: string; executor: string }> => ({ handle: "child-" + String(request?.name ?? "").replace(/\s+/g, "-"), executor: "native" }),
    send: async (): Promise<void> => {},
    interrupt: async (): Promise<void> => {},
    membership: (): undefined => undefined,
    members: (): [] => [],
  }
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
  const ctx = {
    get: (id: string) => (id === "mpdDsh" ? dsh : undefined),
    on: (): void => {},
    effect: (fn: () => unknown) => { try { return fn() ?? (() => {}) } catch { return () => {} } },
    provide: (id: string, value: unknown) => { if (id === TEAMS_SERVICE) service = value as MpdTeamsService },
    inject: (): void => {},
  }
  apply(ctx as never)
  return {
    workspace,
    call: async (name, args, sessionId) => {
      const tool = tools.get(name)
      if (tool === undefined) throw new Error(`no tool ${name} (have ${[...tools.keys()].join(", ")})`)
      return tool.execute(args, { agent: { session: { id: sessionId, header: {} } }, signal: undefined })
    },
  }
}

/** Approve a two-member team through the real plan tool. */
async function approveTeam(h: Harness): Promise<string> {
  await h.call("agent_teams_plan", { action: "create", name: "mail probe team", description: "one wave" }, LEAD)
  await h.call("agent_teams_plan", { action: "add_member", member: { name: "Senior Engineer", description: "implements", prompt: "You implement." } }, LEAD)
  await h.call("agent_teams_plan", { action: "add_member", member: { name: "Reviewer", description: "judges", prompt: "You review." } }, LEAD)
  await h.call("agent_teams_plan", { action: "create_task", task: { subject: "the work", description: "own it", owner: "Senior Engineer", blocked_by: [] } }, LEAD)
  await h.call("agent_teams_plan", { action: "approve" }, LEAD)
  const teamId = activeTeamId(h.workspace, LEAD)
  if (teamId === undefined) throw new Error("the approval bound no team")
  return teamId
}

/** One member's durable roster row. */
function memberOf(workspace: string, teamId: string, name: string): { id: string; name: string; handle: string } {
  const member = readTeam(workspace, teamId)?.members.find((candidate) => candidate.name === name)
  if (member?.executorRef === undefined) throw new Error(`no handle for ${name}`)
  return { id: member.id, name: member.name, handle: member.executorRef }
}

/** Plant one row through the real mailbox store. */
function plant(workspace: string, toId: string, toName: string, subject: string, teamId: string): void {
  const recorded = sendRawMail(workspace, { fromId: "planter", fromName: "the lead", toId, toName, subject, body: "b", memberIds: [toId], teamId }, NOW)
  if (!recorded.ok) throw new Error(`fixture send failed: ${recorded.detail}`)
}

/** The unread answer shape the arms read. */
interface UnreadAnswer {
  /** The listed rows, or undefined when the call refused. */
  messages?: Array<{ id?: string; subject?: string }>
  /** The refusal sentence, when the call refused. */
  refused?: string
  /** The outstanding count. */
  undelivered?: number
  /** Every row this inbox holds. */
  total?: number
  /** The resolved identity. */
  memberName?: string
}

// ══ M1 — a supplied-but-unresolvable `member` REFUSES and lists nothing, even when the CALLER has mail
{
  const h = harness()
  const teamId = await approveTeam(h)
  const senior = memberOf(h.workspace, teamId, "Senior Engineer")
  plant(h.workspace, senior.id, "Senior Engineer", "own-mail", teamId)
  /** The member caller, who HAS its own mail, naming a member that does not resolve. */
  const answer = await h.call("agent_teams_mail", { action: "unread", member: "Senior Enginerr" }, senior.handle) as UnreadAnswer
  arm("M1-1 a misspelled explicit member is REFUSED", typeof answer.refused === "string", `refused=${String(answer.refused)}`)
  arm("M1-2 the refusal NAMES the value", String(answer.refused).includes("Senior Enginerr"), `refused=${String(answer.refused)}`)
  arm("M1-3 no mail is listed (no fallback to the caller's own inbox)", answer.messages === undefined, `messages=${JSON.stringify(answer.messages)}`)
  rmSync(h.workspace, { recursive: true, force: true })
}

// ══ M2/M3 — the real spellings still resolve; M4 — omitting `member` still reads the caller's inbox ══
{
  const h = harness()
  const teamId = await approveTeam(h)
  const senior = memberOf(h.workspace, teamId, "Senior Engineer")
  plant(h.workspace, senior.id, "Senior Engineer", "for-senior", teamId)
  /** The explicit MEMBER ID spelling. */
  const byId = await h.call("agent_teams_mail", { action: "unread", member: senior.id }, LEAD) as UnreadAnswer
  arm("M2 explicit member ID still resolves", byId.refused === undefined && JSON.stringify(byId.messages?.map((row) => row.subject)) === JSON.stringify(["for-senior"]), `subjects=${JSON.stringify(byId.messages?.map((row) => row.subject))}`)
  /** The explicit NAME spelling. */
  const byName = await h.call("agent_teams_mail", { action: "unread", member: "Senior Engineer" }, LEAD) as UnreadAnswer
  arm("M3 explicit member NAME still resolves", byName.refused === undefined && JSON.stringify(byName.messages?.map((row) => row.subject)) === JSON.stringify(["for-senior"]), `subjects=${JSON.stringify(byName.messages?.map((row) => row.subject))}`)
  /** NO `member` argument: the member's own inbox. */
  const own = await h.call("agent_teams_mail", { action: "unread" }, senior.handle) as UnreadAnswer
  arm("M4 omitting `member` still reads the caller's own inbox", own.refused === undefined && JSON.stringify(own.messages?.map((row) => row.subject)) === JSON.stringify(["for-senior"]) && own.memberName === "Senior Engineer", `subjects=${JSON.stringify(own.messages?.map((row) => row.subject))}, memberName=${String(own.memberName)}`)
  /** A NON-MEMBER caller with no `member`: empty answer, no throw (today's behaviour kept). */
  let lead: UnreadAnswer | Error = new Error("not called")
  try { lead = await h.call("agent_teams_mail", { action: "unread" }, LEAD) as UnreadAnswer } catch (error) { lead = error as Error }
  arm("M5 a non-member caller with no `member` keeps the empty answer", !(lead instanceof Error) && (lead.messages?.length ?? -1) === 0 && lead.total === 0, lead instanceof Error ? `threw ${lead.message}` : `messages=${String(lead.messages?.length)}, total=${String(lead.total)}`)
  rmSync(h.workspace, { recursive: true, force: true })
}

console.log(`\n${failures.length === 0 ? "ALL ARMS PASS" : `FAILED ARMS: ${failures.join(", ")}`}`)
process.exit(failures.length === 0 ? 0 : 1)
