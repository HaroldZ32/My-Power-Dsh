// R1's OWN independent probe for the mail family review (T14): D16b team-scoped `unread`, D16c self
// identity, and R7/H1 (an ack frees exactly one bound slot). It drives the REAL registered
// `agent_teams_mail` tool through a stub composition, plus the real mailbox-store functions, with its
// OWN assertions and its OWN temp workspaces — the lane's test arms are not read for proof.
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { apply, TEAMS_SERVICE, type MpdTeamsService } from "../../../../packages/mpd-team-core-plugin/src/index.ts"
import {
  isOutstanding,
  markDelivered,
  markRead,
  readMailbox,
  scopeToTeam,
  send as sendRawMail,
  summarise,
  undeliveredOf,
} from "../../../../packages/mpd-team-core-plugin/src/mailbox-store.ts"
import { activeTeamId, readTeam } from "../../../../packages/mpd-team-core-plugin/src/team-store.ts"

/** The session id the plan is approved from, so every fixture knows the Lead. */
const LEAD = "lead-session-1"

/** The instant every planted row stamps, so the fixture is deterministic. */
const NOW = new Date("2026-10-31T05:00:00.000Z")

/** One captured tool registration, with `execute` kept so an arm can drive it. */
interface Tool {
  /** The registered tool name. */
  name: string
  /** The registered tool's executor, as the harness would call it. */
  execute: (args: unknown, exec: unknown) => Promise<unknown>
}

/** The harness one arm drives: a sandbox workspace and the tools `apply` registered. */
interface Harness {
  /** The sandbox workspace every call is scoped to. */
  workspace: string
  /** The tools the plugin registered, by name. */
  tools: Map<string, Tool>
  /** Drive one registered tool by name as a given session. */
  call: (name: string, args: unknown, sessionId: string, opts?: { title?: string; parentSession?: string; origin?: string; delegationDepth?: number }) => Promise<unknown>
}

/** Results of every arm, so the exit code reports how many contract items failed. */
const failures: string[] = []

/** Record one arm's outcome and print it. */
function arm(id: string, ok: boolean, detail: string): void {
  if (!ok) failures.push(id)
  console.log(`${ok ? "PASS" : "FAIL"} ${id} — ${detail}`)
}

/** A fresh sandbox workspace. */
function sandbox(): string {
  return mkdtempSync(join(tmpdir(), "r1-mail-"))
}

/** Build the harness: the real plugin applied against a stub composition (the lane's own fixture). */
function harness(): Harness {
  /** The sandbox workspace, also what `workspaceRoot` answers. */
  const workspace = sandbox()
  /** The tools the plugin registered. */
  const tools = new Map<string, Tool>()
  /** The service the plugin published (kept so `provide` is not a black hole). */
  let service: MpdTeamsService | undefined
  /** The stub backend: it raises every member, and the handle it mints IS the member's session id. */
  const executor = {
    kind: "native",
    reason: "the probe's own executor",
    providers: (): string[] => ["spawn"],
    spawn: async (_caller: unknown, request: { name?: string }): Promise<{ handle: string; executor: string }> => ({
      handle: "child-" + String(request?.name ?? "").replace(/\s+/g, "-"),
      executor: "native",
    }),
    send: async (): Promise<void> => {},
    interrupt: async (): Promise<void> => {},
    membership: (): undefined => undefined,
    members: (): [] => [],
  }
  /** The stub adapter: only the seams this row uses. */
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
    provide: (id: string, value: unknown) => { if (id === TEAMS_SERVICE) service = value as MpdTeamsService },
    inject: (): void => {},
  }
  apply(ctx as never)
  return {
    workspace,
    tools,
    call: async (name, args, sessionId, opts) => {
      /** The registered tool, or a thrown error naming what WAS registered. */
      const tool = tools.get(name)
      if (tool === undefined) throw new Error(`no tool ${name} (have ${[...tools.keys()].join(", ")})`)
      /** The header, carrying exactly the session fields the arm asked for. */
      const header = {
        ...(opts?.title === undefined ? {} : { title: opts.title }),
        ...(opts?.parentSession === undefined ? {} : { parentSession: opts.parentSession }),
        ...(opts?.origin === undefined ? {} : { origin: opts.origin }),
        ...(opts?.delegationDepth === undefined ? {} : { delegationDepth: opts.delegationDepth }),
      }
      return tool.execute(args, { agent: { session: { id: sessionId, header } }, signal: undefined })
    },
  }
}

/** Approve a two-member team through the real plan tool, as {@link LEAD}; returns its id. */
async function approveTeam(h: Harness): Promise<string> {
  await h.call("agent_teams_plan", { action: "create", name: "mail probe team", description: "one wave" }, LEAD)
  await h.call("agent_teams_plan", { action: "add_member", member: { name: "Senior Engineer", description: "implements", prompt: "You implement." } }, LEAD)
  await h.call("agent_teams_plan", { action: "add_member", member: { name: "Reviewer", description: "judges", prompt: "You review." } }, LEAD)
  await h.call("agent_teams_plan", { action: "create_task", task: { subject: "the lane work", description: "own the record", owner: "Senior Engineer", blocked_by: [] } }, LEAD)
  await h.call("agent_teams_plan", { action: "approve" }, LEAD)
  /** The team the approval bound to the Lead session. */
  const teamId = activeTeamId(h.workspace, LEAD)
  if (teamId === undefined) throw new Error("the approval bound no team to the lead session")
  return teamId
}

/** One member's durable row on the approved team. */
function memberOf(workspace: string, teamId: string, name: string): { id: string; name: string; handle: string } {
  /** The durable record's roster row for that name. */
  const member = readTeam(workspace, teamId)?.members.find((candidate) => candidate.name === name)
  if (member?.executorRef === undefined) throw new Error(`the record kept no handle for "${name}"`)
  return { id: member.id, name: member.name, handle: member.executorRef }
}

/** One planted row through the real store, shaped exactly as `agent_teams_mail` would write it. */
function plant(workspace: string, toId: string, toName: string, subject: string, teamId?: string, minutes = 0): string {
  /** The recorded message, whose id the arm uses as the row's identity. */
  const recorded = sendRawMail(workspace, {
    fromId: "planter", fromName: "the lead", toId, toName, subject, body: "b",
    memberIds: [toId], ...(teamId === undefined ? {} : { teamId }),
  }, new Date(NOW.getTime() + minutes * 60_000))
  if (!recorded.ok) throw new Error(`fixture send failed: ${recorded.detail}`)
  return recorded.message.id
}

/** The tool's own unread answer, read with the fields the probe asserts on. */
interface UnreadAnswer {
  /** The listed rows. */
  messages?: Array<{ id?: string; subject?: string; delivered?: boolean }>
  /** The outstanding count the tool reports. */
  undelivered?: number
  /** Every row this inbox has. */
  total?: number
  /** The identity the answer resolved to. */
  memberName?: string
}

// ══ W1 — D16b: a retired team's backlog is invisible to a fresh team's same-id member ═════════════
{
  const h = harness()
  const teamId = await approveTeam(h)
  // Mint the fresh team up to M4: every team restarts its member ids at M1, which is the live shape.
  await h.call("agent_teams_plan", { action: "add_member", member: { name: "Explorer", description: "recon", prompt: "You explore." } }, LEAD)
  await h.call("agent_teams_plan", { action: "add_member", member: { name: "Planner", description: "plans", prompt: "You plan." } }, LEAD)
  /** The fresh team's OWN M4 — the id a retired wave also minted. */
  const planner = memberOf(h.workspace, teamId, "Planner")
  arm("W0 the fresh team minted its own M4", planner.id === "M4", `planner.id=${planner.id}`)
  // An UNSTAMPED legacy row to the SAME member id: no team can prove it owns it. Planted FIRST because
  // an unstamped SEND is an unscoped count (the documented fallback), which would hit the bound below.
  plant(h.workspace, planner.id, "Planner", "legacy", undefined, 0)
  // The retired backlog: 8 rows stamped with a FINISHED wave's team, addressed to the reused id.
  for (let i = 0; i < 8; i += 1) plant(h.workspace, planner.id, "Planner", "old" + i, "team-retired", i + 1)
  // One row that really belongs to the fresh team.
  plant(h.workspace, planner.id, "Planner", "ours", teamId, 10)
  /** The fresh team's own view of that member's inbox. */
  const answer = await h.call("agent_teams_mail", { action: "unread", member: "Planner" }, LEAD) as UnreadAnswer
  arm("W1a retired rows invisible in the unread list", JSON.stringify(answer.messages?.map((m) => m.subject)) === JSON.stringify(["ours"]), `subjects=${JSON.stringify(answer.messages?.map((m) => m.subject))}`)
  arm("W1b retired rows invisible in total/undelivered", answer.total === 1 && answer.undelivered === 1, `total=${String(answer.total)}, undelivered=${String(answer.undelivered)}`)
  arm("W1e an UNSTAMPED row is invisible to a team-scoped unread", JSON.stringify(answer.messages?.map((m) => m.subject)) === JSON.stringify(["ours"]) && answer.total === 1, `subjects=${JSON.stringify(answer.messages?.map((m) => m.subject))}, total=${String(answer.total)}`)
  // And they must not consume the fresh team's bound: backlog 1 < 8, so the send is accepted.
  const accepted = await h.call("agent_teams_mail", { action: "send", to: "Planner", subject: "fresh-send", body: "b" }, LEAD) as { message?: { id?: string }; refused?: string }
  arm("W1c retired backlog does not block the fresh team's send", accepted.refused === undefined && accepted.message?.id !== undefined, `refused=${String(accepted.refused)}`)
  // The self path (no `member`) reads the same team-scoped inbox.
  const self = await h.call("agent_teams_mail", { action: "unread" }, planner.handle) as UnreadAnswer
  arm("W1d self path sees its own team's rows, not the retired ones", self.messages?.some((m) => m.subject === "ours") === true && self.messages?.some((m) => String(m.subject).startsWith("old")) === false, `subjects=${JSON.stringify(self.messages?.map((m) => m.subject))}, memberName=${String(self.memberName)}`)
  rmSync(h.workspace, { recursive: true, force: true })
}

// ══ W2 — D16c: self identity, explicit member spellings, and PRECEDENCE ═════════════════════════
{
  const h = harness()
  const teamId = await approveTeam(h)
  const senior = memberOf(h.workspace, teamId, "Senior Engineer")
  const reviewer = memberOf(h.workspace, teamId, "Reviewer")
  plant(h.workspace, senior.id, "Senior Engineer", "own-mail", teamId, 0)
  plant(h.workspace, reviewer.id, "Reviewer", "reviewer-mail", teamId, 1)
  /** The member's own session, calling with NO `member` argument (the live defect's shape). */
  const self = await h.call("agent_teams_mail", { action: "unread" }, senior.handle) as UnreadAnswer
  arm("W2a self call with no member resolves to its own MEMBER id", JSON.stringify(self.messages?.map((m) => m.subject)) === JSON.stringify(["own-mail"]) && self.memberName === "Senior Engineer", `subjects=${JSON.stringify(self.messages?.map((m) => m.subject))}, memberName=${String(self.memberName)}`)
  /** The explicit spellings the tool documents: the member NAME and the minted member ID. */
  const byName = await h.call("agent_teams_mail", { action: "unread", member: "Reviewer" }, LEAD) as UnreadAnswer
  arm("W2b explicit member by NAME resolves", JSON.stringify(byName.messages?.map((m) => m.subject)) === JSON.stringify(["reviewer-mail"]), `subjects=${JSON.stringify(byName.messages?.map((m) => m.subject))}`)
  const byId = await h.call("agent_teams_mail", { action: "unread", member: reviewer.id }, LEAD) as UnreadAnswer
  arm("W2c explicit member by MEMBER ID resolves", JSON.stringify(byId.messages?.map((m) => m.subject)) === JSON.stringify(["reviewer-mail"]), `subjects=${JSON.stringify(byId.messages?.map((m) => m.subject))}`)
  // PRECEDENCE: a member asking for ANOTHER member's inbox must get that inbox, never its own.
  const precedenceName = await h.call("agent_teams_mail", { action: "unread", member: "Reviewer" }, senior.handle) as UnreadAnswer
  arm("W2d explicit member BEATS self identity (by name)", JSON.stringify(precedenceName.messages?.map((m) => m.subject)) === JSON.stringify(["reviewer-mail"]), `subjects=${JSON.stringify(precedenceName.messages?.map((m) => m.subject))}`)
  const precedenceId = await h.call("agent_teams_mail", { action: "unread", member: reviewer.id }, senior.handle) as UnreadAnswer
  arm("W2e explicit member BEATS self identity (by member id)", JSON.stringify(precedenceId.messages?.map((m) => m.subject)) === JSON.stringify(["reviewer-mail"]), `subjects=${JSON.stringify(precedenceId.messages?.map((m) => m.subject))}`)
  const ownId = await h.call("agent_teams_mail", { action: "unread", member: senior.id }, senior.handle) as UnreadAnswer
  arm("W2f explicit member id naming ITSELF still lists its own mail", JSON.stringify(ownId.messages?.map((m) => m.subject)) === JSON.stringify(["own-mail"]), `subjects=${JSON.stringify(ownId.messages?.map((m) => m.subject))}`)
  // NON-MEMBER caller of the calling team: the LEAD is not on the roster. Empty answer, no throw.
  /** The Lead's own empty inbox answer, captured with its own error handler so a throw is an arm. */
  let nonMember: UnreadAnswer | Error = new Error("not called")
  try { nonMember = await h.call("agent_teams_mail", { action: "unread" }, LEAD) as UnreadAnswer } catch (error) { nonMember = error as Error }
  arm("W2g a non-member caller of the team gets an empty answer, not a throw", !(nonMember instanceof Error) && (nonMember.messages?.length ?? -1) === 0 && nonMember.total === 0, nonMember instanceof Error ? `threw ${nonMember.message}` : `messages=${String(nonMember.messages?.length)}, total=${String(nonMember.total)}, memberName=${String(nonMember.memberName)}`)
  rmSync(h.workspace, { recursive: true, force: true })
}

// ══ W3 — a caller in NO team still reads the WHOLE fold (the documented fallback) ════════════════
{
  const h = harness()
  const stranger = "stranger-session"
  plant(h.workspace, stranger, "stranger", "unstamped-mail", undefined, 0)
  plant(h.workspace, stranger, "stranger", "stamped-mail", "team-x", 1)
  /** The stranger's own view: no team identity, so no team filter applies. */
  const answer = await h.call("agent_teams_mail", { action: "unread" }, stranger) as UnreadAnswer
  arm("W3a no-team caller reads the whole fold", JSON.stringify(answer.messages?.map((m) => m.subject)) === JSON.stringify(["unstamped-mail", "stamped-mail"]) && answer.total === 2 && answer.undelivered === 2, `subjects=${JSON.stringify(answer.messages?.map((m) => m.subject))}, total=${String(answer.total)}, undelivered=${String(answer.undelivered)}`)
  rmSync(h.workspace, { recursive: true, force: true })
}

// ══ W4 — R7/H1: the bound value, the exact sentence, an ack frees EXACTLY one slot ═══════════════
{
  const h = harness()
  const teamId = await approveTeam(h)
  const senior = memberOf(h.workspace, teamId, "Senior Engineer")
  for (let i = 0; i < 8; i += 1) plant(h.workspace, senior.id, "Senior Engineer", "q" + i, teamId, i)
  /** The summary before any ack. */
  const before = await h.call("agent_teams_mail", { action: "summary" }, LEAD) as { summary?: Array<{ memberId?: string; undelivered?: number }> }
  arm("W4a summary reports the 8-row backlog", before.summary?.find((row) => row.memberId === senior.id)?.undelivered === 8, `summary.undelivered=${String(before.summary?.find((row) => row.memberId === senior.id)?.undelivered)}`)
  /** The bound's refusal, quoted exactly. */
  const refused = await h.call("agent_teams_mail", { action: "send", to: "Senior Engineer", subject: "ninth", body: "b" }, LEAD) as { refused?: string }
  arm("W4b the 9th send refuses with the EXACT sentence at bound 8", refused.refused === '"Senior Engineer" already has 8 undelivered message(s) (bound 8) — it is not keeping up', `refused=${String(refused.refused)}`)
  /** The oldest row id taken from the tool's OWN answer, never a fixture guess. */
  const queued = await h.call("agent_teams_mail", { action: "unread", member: "Senior Engineer" }, LEAD) as UnreadAnswer
  const first = String(queued.messages?.[0]?.id ?? "")
  arm("W4c the unread answer names the row to ack", first !== "", `id=${first}`)
  /** Ack ONE row through the tool. */
  const acked = await h.call("agent_teams_mail", { action: "read", ids: [first] }, LEAD) as { moved?: string[] }
  arm("W4d the ack moves exactly one row", JSON.stringify(acked.moved) === JSON.stringify([first]), `moved=${JSON.stringify(acked.moved)}`)
  /** The summary drops by exactly one. */
  const after = await h.call("agent_teams_mail", { action: "summary" }, LEAD) as { summary?: Array<{ memberId?: string; undelivered?: number }> }
  arm("W4e summary drops by exactly one after one ack", after.summary?.find((row) => row.memberId === senior.id)?.undelivered === 7, `summary.undelivered=${String(after.summary?.find((row) => row.memberId === senior.id)?.undelivered)}`)
  /** The unblocked send is ACCEPTED... */
  const unblocked = await h.call("agent_teams_mail", { action: "send", to: "Senior Engineer", subject: "after-ack", body: "b" }, LEAD) as { message?: { id?: string }; refused?: string }
  arm("W4f the ack unblocks the next send", unblocked.refused === undefined && unblocked.message?.id !== undefined, `refused=${String(unblocked.refused)}`)
  /**
   * EXACTLY ONE slot moved. The stub transport ACCEPTED the send above, so that row is delivered and
   * cannot fill the slot the ack freed. Refill ONE outstanding row instead: had the ack freed TWO
   * slots, the backlog would now be 7 and this send would pass — it must be 8 and refuse.
   */
  plant(h.workspace, senior.id, "Senior Engineer", "refill", teamId, 30)
  const next = await h.call("agent_teams_mail", { action: "send", to: "Senior Engineer", subject: "again", body: "b" }, LEAD) as { refused?: string }
  arm("W4g EXACTLY one slot moved (one refill returns the bound and refuses)", typeof next.refused === "string" && next.refused.includes("already has 8 undelivered message(s) (bound 8)"), `refused=${String(next.refused)}`)
  // Each further ack frees exactly one more: 8 -> 7 -> 6, one row at a time (never "all at once").
  /** The next outstanding row, again taken from the tool's answer. */
  const queued2 = await h.call("agent_teams_mail", { action: "unread", member: "Senior Engineer" }, LEAD) as UnreadAnswer
  const second = String(queued2.messages?.find((m) => typeof m.subject === "string" && m.subject.startsWith("q"))?.id ?? "")
  await h.call("agent_teams_mail", { action: "read", ids: [second] }, LEAD)
  /** The summary after the second ack. */
  const after2 = await h.call("agent_teams_mail", { action: "summary" }, LEAD) as { summary?: Array<{ memberId?: string; undelivered?: number }> }
  arm("W4h another ack frees exactly one (8 -> 7)", after2.summary?.find((row) => row.memberId === senior.id)?.undelivered === 7, `summary.undelivered=${String(after2.summary?.find((row) => row.memberId === senior.id)?.undelivered)}`)
  /** The next outstanding row that is not the one just acked. */
  const queued3 = await h.call("agent_teams_mail", { action: "unread", member: "Senior Engineer" }, LEAD) as UnreadAnswer
  const third = String(queued3.messages?.find((m) => typeof m.subject === "string" && m.subject.startsWith("q") && String(m.id) !== second)?.id ?? "")
  await h.call("agent_teams_mail", { action: "read", ids: [third] }, LEAD)
  /** The summary after the third ack. */
  const after3 = await h.call("agent_teams_mail", { action: "summary" }, LEAD) as { summary?: Array<{ memberId?: string; undelivered?: number }> }
  arm("W4h2 yet another ack frees exactly one more (7 -> 6)", after3.summary?.find((row) => row.memberId === senior.id)?.undelivered === 6, `summary.undelivered=${String(after3.summary?.find((row) => row.memberId === senior.id)?.undelivered)}`)
  // The three consumers agree at the store level too: summary column, undeliveredOf and isOutstanding.
  /** The folded state for the agreement check. */
  const state = readMailbox(h.workspace)
  /** Rows this team owns, addressed to the member, still outstanding. */
  const byStore = scopeToTeam(state, teamId).messages.filter((m) => m.toId === senior.id && isOutstanding(m)).length
  /** The summary's own answer for the same member. */
  const bySummary = summarise(scopeToTeam(state, teamId)).find((row) => row.memberId === senior.id)?.undelivered
  /** The bound's own helper for the same member. */
  const byHelper = undeliveredOf(scopeToTeam(state, teamId), senior.id).length
  arm("W4i summary, undeliveredOf and isOutstanding agree", byStore === bySummary && bySummary === byHelper && byStore === 6, `isOutstanding=${byStore}, summary=${String(bySummary)}, undeliveredOf=${byHelper}`)
  // DELIVERY is the other release valve: it frees exactly one per delivered row.
  /** One still-outstanding row to deliver. */
  const toDeliver = scopeToTeam(readMailbox(h.workspace), teamId).messages.find((m) => m.toId === senior.id && isOutstanding(m))
  if (toDeliver === undefined) throw new Error("fixture has no outstanding row to deliver")
  markDelivered(h.workspace, [toDeliver.id], new Date(NOW.getTime() + 60 * 60_000))
  /** The summary after the delivery. */
  const afterDelivery = await h.call("agent_teams_mail", { action: "summary" }, LEAD) as { summary?: Array<{ memberId?: string; undelivered?: number }> }
  arm("W4j delivery frees exactly one slot", afterDelivery.summary?.find((row) => row.memberId === senior.id)?.undelivered === 5, `summary.undelivered=${String(afterDelivery.summary?.find((row) => row.memberId === senior.id)?.undelivered)}`)
  rmSync(h.workspace, { recursive: true, force: true })
}

// ══ W5 — H1 re-run UNCHANGED at the STORE level (my original T11 C1/C2/C3 arms) ═════════════════
{
  const ws = sandbox()
  /** A direct store-level send input. */
  const msg = (over: Record<string, unknown> = {}) => ({
    fromId: "captain", fromName: "captain", toId: "M4", toName: "M4", subject: "s", body: "b",
    memberIds: ["M1", "M2", "M3", "M4"], ...over,
  })
  for (let i = 0; i < 8; i += 1) {
    const r = sendRawMail(ws, msg({ teamId: "team-current", subject: "cur" + i }), new Date(NOW.getTime() + i * 60_000))
    if (!r.ok) throw new Error(`fixture send failed: ${r.detail}`)
  }
  const before = sendRawMail(ws, msg({ teamId: "team-current", subject: "blocked" }), new Date(NOW.getTime() + 9 * 60_000))
  const target = readMailbox(ws).messages.find((m) => m.subject === "cur0")
  if (target === undefined) throw new Error("fixture message missing")
  const moved = markRead(ws, [target.id], new Date(NOW.getTime() + 10 * 60_000))
  const after = sendRawMail(ws, msg({ teamId: "team-current", subject: "after-read" }), new Date(NOW.getTime() + 11 * 60_000))
  const afterAgain = sendRawMail(ws, msg({ teamId: "team-current", subject: "again" }), new Date(NOW.getTime() + 12 * 60_000))
  arm("W5a H1 CLOSED: ack frees exactly one slot (store level)", before.ok === false && moved.length === 1 && after.ok && !afterAgain.ok, `before.ok=${before.ok}, moved=${moved.length}, afterAck.ok=${after.ok}, afterAgain.ok=${afterAgain.ok}`)
  /** What the ack changed on the row. */
  const folded = readMailbox(ws).messages.find((m) => m.id === target.id)
  arm("W5b the ack sets readAt and never fabricates delivery", folded?.readAt !== undefined && folded?.deliveredAt === undefined, `readAt=${String(folded?.readAt)}, deliveredAt=${String(folded?.deliveredAt)}`)
  arm("W5c the acked row leaves the outstanding set", folded !== undefined && !isOutstanding(folded), `isOutstanding=${folded === undefined ? "missing" : String(isOutstanding(folded))}`)
  rmSync(ws, { recursive: true, force: true })
}

// ══ W6 — OBSERVATION ONLY (no verdict): `member` given a SESSION id, a spelling the tool's own
//    resolver does not accept. Recorded so the sharp edge is documented rather than guessed. ═════════
{
  const h = harness()
  const teamId = await approveTeam(h)
  const senior = memberOf(h.workspace, teamId, "Senior Engineer")
  const reviewer = memberOf(h.workspace, teamId, "Reviewer")
  plant(h.workspace, senior.id, "Senior Engineer", "own-mail", teamId, 0)
  plant(h.workspace, reviewer.id, "Reviewer", "reviewer-mail", teamId, 1)
  /** A MEMBER caller naming a colleague by SESSION id — does it reach that colleague's inbox? */
  const memberCaller = await h.call("agent_teams_mail", { action: "unread", member: reviewer.handle }, senior.handle) as UnreadAnswer
  console.log(`OBS O1 member caller, member=<colleague session id> — subjects=${JSON.stringify(memberCaller.messages?.map((m) => m.subject))}, memberName=${String(memberCaller.memberName)}`)
  /** A NON-MEMBER (Lead) caller naming a member by SESSION id. */
  const leadCaller = await h.call("agent_teams_mail", { action: "unread", member: reviewer.handle }, LEAD) as UnreadAnswer
  console.log(`OBS O2 lead caller, member=<member session id> — subjects=${JSON.stringify(leadCaller.messages?.map((m) => m.subject))}, total=${String(leadCaller.total)}, memberName=${String(leadCaller.memberName)}`)
  rmSync(h.workspace, { recursive: true, force: true })
}

console.log(`\n${failures.length === 0 ? "ALL ARMS PASS" : `FAILED ARMS: ${failures.join(", ")}`}`)
process.exit(failures.length === 0 ? 0 : 1)
