// mpd-team-compact-plugin: compact a FINISHED team's members.
//
// The user's request: "after every task is done and the team is about to be archived,
// compact the context of all members of the current (not yet archived) team."
//
// 0.1.7 REBASE: the vendor team plugin and its `<workspace>/.mpd/team/<teamId>/team.json` are
// retired. The roster and the board now come from the OFFICIAL Agent Teams service through the
// adapter (`dsh.teamLiveTeams()`), and the service exposes NO "finished team" predicate, so the
// trigger is DERIVED from both halves of that readout: every task terminal (the BOARD) AND every
// member inactive (the ROSTER).
//
// Frozen semantics (evidence/omo-align/requirements/team-compaction-contract.json):
//   trigger   a team whose EVERY task is terminal AND whose members are ALL idle
//   who       members only — the captain is NEVER compacted (the user runs /compact)
//   barrier   wait for all members to go idle, then compact them together
//   method    unconditional explicit compactNow (a null answer means "no safely
//             compactable range", which is recorded as a fact, not an error)
//   audit     <workspace>/.mpd/team-compact/<teamId>/ — NEVER .mpd/team
//   silence   audit only; a member is never notified (that would push context back in)
//
// HARD design constraints, each measured by the compact-hinge experiment (t45,
// evidence/omo-align/compact-hinge/result.json):
//   * The engine MUST be resolved per member through the member's OWN scoped context
//     (`agent.ctx.get("compaction")`). The host-plane `ctx.get("compaction")` is a
//     DIFFERENT object (`sameObject: false`) serving a different realm, so driving a
//     member with it would compact the wrong history. That lookup lives in ONE place —
//     the adapter's `compactionEngineForAgent` — so no call site can get it wrong.
//   * `busy` is NOT the concurrency signal. A concurrent drive was measured throwing
//     `cannot get required service "tokenMeter" in inactive context`, a Cordis
//     lifecycle error. That class is classified separately from the six
//     `ManualCompactionError` codes.
//   * A staged team member (`id === ""`) has no live Agent and is skipped EXPLICITLY.
//   * A team whose captain is gone has no in-process members; it is recorded
//     `not-live` rather than silently ignored.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { createDshAdapter, type DshAdapter, type DshLiveAgent, type DshTeamView } from "../../mpd-dsh-adapter-plugin/src/index"

export const name = "mpd-team-compact"
// INJECT: the TOOLS seam — and deliberately NOT `compaction`.
//
// Two measured facts decide this line:
//
// 1) `compaction` MUST NOT be declared here. The service is composed by
//    `presets/mpd/agent.cordis.yml` (rows 275-289), so a profile that does not mount that
//    preset has no compaction service at all. MEASURED in a web-profile boot:
//      `packages/mpd-team-compact-plugin/dist/index.js: pending (waiting for service: compaction)`
//    — the row never applied, which is the failure mode the contract forbids. t45's own
//    guidance covers it: "If the plugin must also tolerate a composition WITHOUT any
//    compaction service, keep the lookup defensive and degrade with a warning." So the
//    engine is resolved LAZILY at drive time (and always per member — the hinge rule).
//
// 2) `tools` MUST be declared, even though this plugin only reaches the tool registry
//    through the adapter. `createDshAdapter(ctx).service("tools")` reads the service off
//    THIS row's context, and a cordis ctx only exposes a service it has declared —
//    measured: without it, registration threw
//      `mpd-dsh-adapter: harness service "tools" is unavailable — cannot register tool ...`
//    while the adapter row itself had provided mpdDsh. The working sibling plugin does the
//    same thing (`mpd-workmate`: inject ["tools","subagents"]), so this is the established
//    pattern rather than a new one. `tools` is registered by the harness itself, so unlike
//    `compaction` it is always satisfiable and cannot park the row.
export const inject: string[] = ["tools"]

type Ctx = { on?: (e: string, h: (...a: any[]) => any) => any; get?: (k: string) => any; logger?: any; [k: string]: any }

/** This plugin's OWN audit namespace. Never `.mpd/team`. */
const COMPACT_STATE_DIR = join(".mpd", "team-compact")
const CAPTAIN_KEY = "captain"

/**
 * The OFFICIAL terminal task statuses.
 *
 * The OWNER of this vocabulary is the harness's own
 * `@deepseek-ai/dsh-experimental-agent-team` (`TeamTaskStatus = "pending" | "in_progress" |
 * "completed" | "deleted"`), and its terminal half is `completed` + `deleted`. It is mirrored
 * HERE, and the mirror is deliberate rather than sloppy: the official package is not resolvable
 * by a bare specifier from this repository (MEASURED: `MODULE_NOT_FOUND`), the adapter re-declares
 * its public types for exactly that reason (`DshTeamTaskStatus`), and a `.d.ts` cannot be imported
 * at runtime anyway. `deleted` is included because `listTasks` hides deleted rows, so a board the
 * service reports as all-`completed` is terminal with or without it — the honest set is both.
 *
 * `failed`/`cancelled` are NOT in the official union; they are tolerated so a harness release that
 * adds a terminal status cannot make this module's destructive pass fire on unfinished work.
 */
export const TERMINAL_TASK_STATUSES: readonly string[] = ["completed", "deleted", "failed", "cancelled"]

/**
 * The terminal vocabulary, as a call (the shape the pass and the row already use).
 *
 * It is SYNCHRONOUS now: there is no module to load — the mirror above is the authority — and a
 * failure mode that can no longer happen must not be dressed up as one. `await` on the result
 * still works, so every existing call site keeps its meaning.
 */
export function terminalTaskStatuses(): readonly string[] {
  return TERMINAL_TASK_STATUSES
}

/**
 * Whether ONE roster status means "this member is still doing something".
 *
 * The official `TeamMemberView.status` union is `running | inactive | provisioning | failed`;
 * everything that is not running/provisioning is inactive (finished, failed, or a status this
 * module does not know). That reading is deliberately conservative in the SAFE direction: an
 * unknown status does not block a compaction of a genuinely finished team, and the BARRIER below
 * still waits for every resolvable member to be idle before anything is driven.
 */
export function memberIsActive(status: string | undefined): boolean {
  return status === "running" || status === "provisioning"
}

/** The six `ManualCompactionError` codes, plus our own lifecycle classification. */
export const COMPACTION_FAILURE_CODES = ["busy", "cancelled", "changed", "summary", "commit", "persistence"] as const
/** Our own outcome vocabulary — never mixed with the engine's codes. */
export type CompactOutcome =
  | "compacted"
  | "no-safe-range"
  | "skipped-not-live"
  | "skipped-staged"
  | "skipped-captain"
  | "lifecycle-error"
  | "failed"

export interface CompactMemberRecord {
  member: string
  sessionId: string
  outcome: CompactOutcome
  /** The engine's failure code when it raised a ManualCompactionError (never "busy" alone). */
  failureCode?: string
  /** The raw error text for a lifecycle or unexpected error, so the audit is actionable. */
  error?: string
  shadowedTokenCount?: number
  summarySeq?: number
  /** Present for a member that never reached idle inside the barrier. */
  reason?: string
}

export interface CompactAudit {
  schema: "mpd/team-compact@1"
  teamId: string
  teamName: string
  at: number
  outcome: "compacted" | "refused" | "not-live" | "timeout"
  /** Why the pass did not compact, when it did not. */
  refusedReason?: string
  members: CompactMemberRecord[]
  /** engineKey is always "agent-scoped" — the only engine this plugin may drive. */
  engineResolution: "agent-scoped"
  /** Who asked for this pass: the tool call, or one of the two automatic triggers. */
  caller?: { via: "tool" | "turn-end" | "status"; sessionId?: string; cwd?: string }
  /** The ids the live registry ACTUALLY exposed when a pass found nobody resident. */
  liveAgentIds?: string[]
  /** Identical repeats collapsed into this record by the write-on-change rule. */
  suppressed?: number
}

/**
 * The write-on-change predicate: true when two audits describe the SAME outcome for the same
 * team. Compared: the outcome, the refusal reason, and each member name/outcome/reason/failure
 * code in order — so a new member, a new reason or a success makes it false and is never
 * swallowed.
 */
export function sameAuditOutcome(previous: CompactAudit | undefined, next: CompactAudit): boolean {
  if (previous === undefined) return false
  if (previous.outcome !== next.outcome) return false
  if ((previous.refusedReason ?? "") !== (next.refusedReason ?? "")) return false
  if (previous.members.length !== next.members.length) return false
  return previous.members.every((member, index) => {
    const other = next.members[index]
    if (other === undefined) return false
    return member.member === other.member
      && member.outcome === other.outcome
      && (member.reason ?? "") === (other.reason ?? "")
      && (member.failureCode ?? "") === (other.failureCode ?? "")
  })
}

// ── team state (read-only, projected from the official live readout) ─────────

export interface TeamMemberRecord {
  id: string
  name: string
  status?: string
}
export interface TeamTaskRecord {
  id: string
  status: string
  assignee?: string
}
export interface TeamRecord {
  /** The official team identity: the Lead Session id (`TeamId(root.id)`). */
  id: string
  name: string
  captainSessionId: string
  phase?: string
  /** The TEAMMATES: the official roster's Lead pseudo-row is the captain, never a member. */
  members: TeamMemberRecord[]
  tasks: TeamTaskRecord[]
}

/** One view of the official readout, projected. `undefined` for a view with no team identity. */
function projectTeam(view: DshTeamView): TeamRecord | undefined {
  const id = String(view?.teamId ?? "")
  if (id === "") return undefined
  const rows = Array.isArray(view.members) ? view.members : []
  const lead = rows.find((member) => member.role === "lead")
  const active = rows.some((member) => member.role === "teammate" && memberIsActive(member.status))
  return {
    id,
    name: String(lead?.name ?? view.leadName ?? ""),
    captainSessionId: String(view.leadSessionId ?? lead?.id ?? ""),
    phase: active ? "active" : "idle",
    members: rows
      .filter((member) => member.role !== "lead")
      .map((member) => ({
        id: String(member.id ?? ""),
        name: String(member.name ?? ""),
        ...(typeof member.status === "string" ? { status: member.status } : {}),
      })),
    tasks: (Array.isArray(view.tasks) ? view.tasks : []).map((task) => ({
      id: String(task.id ?? ""),
      status: String(task.status ?? ""),
      ...(typeof task.ownerName === "string" && task.ownerName !== "" ? { assignee: task.ownerName } : {}),
    })),
  }
}

/** Every LIVE team the adapter reports, projected. `[]` when the seam is absent (never throws). */
export function readTeams(dsh: DshAdapter): TeamRecord[] {
  let views: DshTeamView[]
  try {
    views = dsh.teamLiveTeams() ?? []
  } catch {
    return []
  }
  const teams: TeamRecord[] = []
  for (const view of views) {
    const team = projectTeam(view)
    // A SOLO session is the Lead of its own implicit team on the official plane, with no
    // teammate and no task: there is nothing to compact, and reporting it as a team would make
    // the automatic triggers run a pointless pass for every live session in the process.
    if (team === undefined) continue
    if (team.members.length === 0 && team.tasks.length === 0) continue
    teams.push(team)
  }
  return teams
}

/** Read one LIVE team by id. Returns undefined when the readout does not carry it. */
export function readTeamRecord(dsh: DshAdapter, teamId: string): TeamRecord | undefined {
  const wanted = String(teamId)
  return readTeams(dsh).find((team) => team.id === wanted)
}

/** Every live team id in this process (sorted), i.e. the teams a pass may consider. */
export function listTeamIds(dsh: DshAdapter): string[] {
  return readTeams(dsh).map((team) => team.id).sort()
}

/**
 * The trigger, as a pure predicate so it can be falsified without a boot.
 *
 * The official service exposes NO "finished team" predicate, so it is DERIVED from BOTH halves of
 * its readout: every task terminal (the BOARD, `teamListTasks`) AND no member active (the ROSTER,
 * `teamListMembers`). `terminal` is injected (not hard-coded) so the caller must hand in the
 * vocabulary that owns it; the negative controls are "any non-terminal task ⇒ never compact" and
 * "any running/provisioning member ⇒ never compact".
 *
 * The roster half is a REFUSAL, not a substitute for the barrier: a member whose record status is
 * stale but whose Agent is still working is caught by `compactTeamPass`'s idle barrier, which is
 * the one that can see the live Agents.
 */
export function teamIsFinished(team: TeamRecord, terminal: readonly string[]): boolean {
  if (!Array.isArray(team.tasks) || team.tasks.length === 0) return false
  if (!team.tasks.every((task) => terminal.includes(task.status))) return false
  return !team.members.some((member) => memberIsActive(member.status))
}

/** Members that this plugin may consider: every member except the captain. */
export function compactableMembers(team: TeamRecord): TeamMemberRecord[] {
  return team.members.filter((member) => member.name !== CAPTAIN_KEY && member.status !== "removed")
}

/** A member with no session id has not been spawned yet: it has no Agent to compact. */
export function isStagedMember(member: TeamMemberRecord): boolean {
  return member.id === ""
}

// ── audit ────────────────────────────────────────────────────────────────────

/** `<workspace>/.mpd/team-compact/<teamId>/` — accumulated, never overwritten. */
export function auditDir(workspace: string, teamId: string): string {
  return join(workspace, COMPACT_STATE_DIR, teamId)
}

export function writeAudit(workspace: string, audit: CompactAudit): string {
  const dir = auditDir(workspace, audit.teamId)
  mkdirSync(dir, { recursive: true })
  // One file per pass: a later pass must never hide an earlier one, because a
  // compaction is destructive and the audit is the only record of what was replaced.
  const file = join(dir, `${new Date(audit.at).toISOString().replace(/[:.]/g, "-")}.json`)
  writeFileSync(file, JSON.stringify(audit, null, 2) + "\n")
  return file
}

export function readAudits(workspace: string, teamId: string): CompactAudit[] {
  const dir = auditDir(workspace, teamId)
  if (!existsSync(dir)) return []
  try {
    return readdirSync(dir)
      .filter((entry) => entry.endsWith(".json"))
      .sort()
      .map((entry) => {
        try {
          return JSON.parse(readFileSync(join(dir, entry), "utf8")) as CompactAudit
        } catch {
          return undefined
        }
      })
      .filter((audit): audit is CompactAudit => audit !== undefined)
  } catch {
    return []
  }
}

// ── failure classification ───────────────────────────────────────────────────

/**
 * Classify a thrown error from a compaction drive.
 *
 * The point of this function is the HINGE-F5 rule: a concurrent drive does NOT
 * necessarily surface the engine's `busy` code. t45 measured it throwing
 * `cannot get required service "tokenMeter" in inactive context` — a Cordis
 * lifecycle failure. Those two families are recorded separately so a reader can tell
 * "the engine refused this compaction" from "we drove from a context that had moved on".
 */
export function classifyCompactionError(error: unknown): { outcome: CompactOutcome; failureCode?: string; error: string } {
  const text = error instanceof Error ? error.message : String(error)
  const code = (error as { code?: unknown } | undefined)?.code
  const named = typeof code === "string" && (COMPACTION_FAILURE_CODES as readonly string[]).includes(code)
    ? code
    : COMPACTION_FAILURE_CODES.find((candidate) => new RegExp(`\\b${candidate}\\b`, "i").test(text))
  if (named !== undefined && named !== "busy") return { outcome: "failed", failureCode: named, error: text }
  // A Cordis lifecycle failure: the context that issued the drive is no longer active.
  if (/inactive context|inactive\b/i.test(text) || /cannot get required service/i.test(text)) {
    return { outcome: "lifecycle-error", error: text }
  }
  if (named === "busy") return { outcome: "failed", failureCode: "busy", error: text }
  return { outcome: "failed", error: text }
}

// ── the pass ─────────────────────────────────────────────────────────────────

export interface CompactPassOptions {
  /** The terminal vocabulary the OWNER plugin exports. Defaults to the imported constant. */
  terminal: readonly string[]
  /** Barrier: how long to wait for every member to reach idle. */
  idleWaitMs?: number
  idlePollMs?: number
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

const DEFAULT_IDLE_WAIT_MS = 20_000
const DEFAULT_IDLE_POLL_MS = 250

function agentIsIdle(agent: DshLiveAgent | undefined): boolean {
  if (agent === undefined) return false
  const status = (agent as { status?: unknown }).status
  // Absent status is treated as AVAILABLE, matching the agent-teams scheduler's rule
  // (`live === undefined || live.status === 'idle'`) so the two plugins never disagree
  // about whether a member is free.
  return status === undefined || status === "idle"
}

/**
 * Run ONE compaction pass for ONE team. Pure orchestration: every harness seam arrives
 * through the adapter, and every branch is recorded in the returned audit.
 */
export async function compactTeamPass(
  dsh: DshAdapter,
  team: TeamRecord,
  options: CompactPassOptions,
): Promise<CompactAudit> {
  const now = options.now ?? (() => Date.now())
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const at = now()
  const members = compactableMembers(team)
  const base: Omit<CompactAudit, "outcome" | "members"> = {
    schema: "mpd/team-compact@1",
    teamId: team.id,
    teamName: team.name,
    at,
    engineResolution: "agent-scoped",
  }

  // NEGATIVE CONTROL, first: a team that still has work must NEVER be compacted. Both halves of
  // the derived "finished" predicate are named in the refusal, so an audit never says "nothing to
  // compact" when the real cause was a task, and never blames a task when the real cause was a
  // member that is still running.
  if (!teamIsFinished(team, options.terminal)) {
    const nonTerminal = team.tasks.filter((task) => !options.terminal.includes(task.status))
    const stillActive = team.members.filter((member) => memberIsActive(member.status))
    const reasons: string[] = []
    if (nonTerminal.length > 0) {
      reasons.push(`team still has ${nonTerminal.length} non-terminal task(s): ${nonTerminal.map((task) => `${task.id}=${task.status}`).join(", ")}`)
    }
    if (stillActive.length > 0) {
      reasons.push(`${stillActive.length} member(s) still active: ${stillActive.map((member) => `${member.name}=${String(member.status ?? "unknown")}`).join(", ")}`)
    }
    if (reasons.length === 0) reasons.push("the team's board carries no task at all: there is nothing to compact")
    return { ...base, outcome: "refused", refusedReason: reasons.join("; "), members: [] }
  }

  // Resolve every member's live Agent ONCE, so the barrier and the drive agree.
  const resolved = members.map((member) => ({
    member,
    staged: isStagedMember(member),
    agent: isStagedMember(member) ? undefined : dsh.liveAgent(member.id),
  }))
  const live = resolved.filter((entry) => !entry.staged && entry.agent !== undefined)
  if (live.length === 0) {
    // Every member is either staged or gone. Recorded, never silent: "not-live" is the
    // documented answer for a team whose captain/session is gone (user decision).
    return {
      ...base,
      outcome: "not-live",
      refusedReason: "no live member Agents in this process (team is dormant or not yet spawned)",
      members: resolved.map((entry) => ({
        member: entry.member.name,
        sessionId: entry.member.id,
        outcome: entry.staged ? "skipped-staged" : "skipped-not-live",
        ...entry.staged ? { reason: "member has no session id yet (not spawned)" } : { reason: "no live Agent for this session id" },
      })),
    }
  }

  // BARRIER: wait for EVERY live member to be idle before compacting any of them.
  const idleWaitMs = options.idleWaitMs ?? DEFAULT_IDLE_WAIT_MS
  const idlePollMs = options.idlePollMs ?? DEFAULT_IDLE_POLL_MS
  const deadline = now() + idleWaitMs
  let allIdle = live.every((entry) => agentIsIdle(dsh.liveAgent(entry.member.id)))
  while (!allIdle && now() < deadline) {
    await sleep(idlePollMs)
    allIdle = live.every((entry) => agentIsIdle(dsh.liveAgent(entry.member.id)))
  }
  if (!allIdle) {
    const busy = live.filter((entry) => !agentIsIdle(dsh.liveAgent(entry.member.id))).map((entry) => entry.member.name)
    return {
      ...base,
      outcome: "timeout",
      refusedReason: `waited ${idleWaitMs} ms for every member to be idle; still busy: ${busy.join(", ")}`,
      members: resolved.map((entry) => ({
        member: entry.member.name,
        sessionId: entry.member.id,
        outcome: entry.staged ? "skipped-staged" : entry.agent === undefined ? "skipped-not-live" : busy.includes(entry.member.name) ? "skipped-not-live" : "no-safe-range",
        reason: entry.staged
          ? "member has no session id yet (not spawned)"
          : entry.agent === undefined
            ? "no live Agent for this session id"
            : busy.includes(entry.member.name)
              ? "still busy when the barrier expired"
              : "idle, but the barrier never cleared so no drive was issued",
      })),
    }
  }

  // DRIVE. One member at a time: the engine mutates durable session history.
  const records: CompactMemberRecord[] = []
  for (const entry of resolved) {
    if (entry.staged) {
      records.push({ member: entry.member.name, sessionId: entry.member.id, outcome: "skipped-staged", reason: "member has no session id yet (not spawned)" })
      continue
    }
    if (entry.agent === undefined) {
      records.push({ member: entry.member.name, sessionId: entry.member.id, outcome: "skipped-not-live", reason: "no live Agent for this session id" })
      continue
    }
    // THE HINGE: the engine comes from the member's OWN scoped context, memoized in ONE
    // adapter helper. There is deliberately no `ctx.get("compaction")` fallback here —
    // a host-plane engine would compact a different realm's history.
    const engine = dsh.compactionEngineForAgent(entry.member.id) as { compactNow?: (...args: unknown[]) => unknown } | undefined
    if (engine === undefined || typeof engine.compactNow !== "function") {
      records.push({ member: entry.member.name, sessionId: entry.member.id, outcome: "skipped-not-live", reason: "the member's scoped context exposes no compaction engine" })
      continue
    }
    try {
      const result = await engine.compactNow(entry.agent, undefined) as { shadowedTokenCount?: number; summarySeq?: number } | null | undefined
      if (result === null || result === undefined) {
        // Documented meaning: "no safe useful range exists". A FACT, not a failure.
        records.push({ member: entry.member.name, sessionId: entry.member.id, outcome: "no-safe-range" })
      } else {
        records.push({
          member: entry.member.name,
          sessionId: entry.member.id,
          outcome: "compacted",
          ...result.shadowedTokenCount === undefined ? {} : { shadowedTokenCount: result.shadowedTokenCount },
          ...result.summarySeq === undefined ? {} : { summarySeq: result.summarySeq },
        })
      }
    } catch (error) {
      const classified = classifyCompactionError(error)
      records.push({
        member: entry.member.name,
        sessionId: entry.member.id,
        outcome: classified.outcome,
        ...classified.failureCode === undefined ? {} : { failureCode: classified.failureCode },
        error: classified.error,
      })
    }
  }

  return { ...base, outcome: "compacted", members: records }
}

// ── plugin ───────────────────────────────────────────────────────────────────

export function apply(ctx: Ctx): void {
  const dsh = (typeof ctx.get === "function" ? ctx.get("mpdDsh") : undefined) ?? createDshAdapter(ctx)
  const log = ctx.logger ?? { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }
  // The vocabulary is a local mirror of the OFFICIAL union (see `TERMINAL_TASK_STATUSES`), so it
  // is available synchronously and can never park the row on a module load.
  const terminalStatuses = (): readonly string[] => TERMINAL_TASK_STATUSES

  /** Identical-outcome attempts collapsed since the last WRITTEN record, per team. */
  const suppressedSinceWrite = new Map<string, number>()

  /**
   * WRITE-ON-CHANGE. Every pass used to leave a record, so one finished team that could never be
   * compacted produced 73 identical files in a day and a half (measured 2026-09-16: 235 records,
   * 2260 member entries, every single one `skipped-not-live`, zero successes) — the audit became
   * unreadable and the churn endless. A record is now written when the outcome CHANGES; identical
   * repeats are counted and carried onto the next written record as `suppressed`, and the manual
   * tool can force a write with `force: true`. Nothing is hidden: the count is on disk.
   */
  function writeOrSkip(workspace: string, teamId: string, audit: CompactAudit, caller: CompactAudit["caller"] | undefined, force: boolean): CompactAudit {
    if (audit.outcome === "not-live") {
      try {
        audit.liveAgentIds = dsh.liveAgents().map((agent: { id?: unknown }) => String(agent?.id ?? "")).filter((id: string) => id !== "").slice(0, 20)
      } catch { /* diagnostics are best-effort; a pass never fails for them */ }
    }
    if (caller !== undefined) audit.caller = caller
    const previous = readAudits(workspace, teamId).pop()
    if (!force && sameAuditOutcome(previous, audit)) {
      const collapsed = (suppressedSinceWrite.get(teamId) ?? 0) + 1
      suppressedSinceWrite.set(teamId, collapsed)
      audit.suppressed = collapsed
      return audit
    }
    const carried = suppressedSinceWrite.get(teamId) ?? 0
    if (carried > 0) audit.suppressed = carried
    suppressedSinceWrite.set(teamId, 0)
    writeAudit(workspace, audit)
    return audit
  }

  /** Run one pass for one team and persist its audit (write-on-change). Returns the audit. */
  async function runPass(workspace: string, teamId: string, caller?: CompactAudit["caller"], force = false): Promise<CompactAudit> {
    const team = readTeamRecord(dsh, teamId)
    if (team === undefined) {
      return writeOrSkip(workspace, teamId, {
        schema: "mpd/team-compact@1", teamId, teamName: "", at: Date.now(),
        outcome: "refused", refusedReason: "no LIVE team with that id in this process", members: [], engineResolution: "agent-scoped",
      }, caller, force)
    }
    const audit = await compactTeamPass(dsh, team, { terminal: terminalStatuses() })
    return writeOrSkip(workspace, teamId, audit, caller, force)
  }

  // TRIGGER 1 — the status edge. `agent/status` is the harness's own status edge; the pass is
  // idempotent-by-refusal (it re-reads the team record and refuses a team with work) and now
  // idempotent-by-write too (write-on-change), so a finished team that cannot be reached leaves
  // ONE record instead of one per edge.
  dsh.onEvent?.("agent/status", async () => {
    try {
      const workspace = dsh.workspaceRoot()
      if (workspace === undefined || workspace === "") return
      for (const teamId of listTeamIds(dsh)) {
        const team = readTeamRecord(dsh, teamId)
        if (team === undefined) continue
        if (!teamIsFinished(team, terminalStatuses())) continue
        await runPass(workspace, teamId, { via: "status" })
      }
    } catch (error) {
      log.warn?.(`mpd-team-compact: trigger pass failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  })

  // TRIGGER 2 — the member's own TURN BOUNDARY, and the only one that can actually reach a member.
  //
  // A continuable child's Activation is PROCESS-LOCAL and is released when the child settles
  // (`@deepseek-ai/dsh-subagent`: "Child session id → its live Activation. Process-local, never
  // durable"), so a member is resolvable exactly while it is running or finishing a turn. Driving
  // the pass from outside that window can only ever answer `not-live` — which is precisely what
  // was measured: 235 automatic passes, 2260 member entries, every one `skipped-not-live`, zero
  // successes. This trigger therefore runs the pass the moment a member of a FINISHED team stops
  // its turn, while its Agent is still resident. The other members are then handled by the same
  // barrier as before: a resident one is compacted, a released one is recorded as
  // `skipped-not-live` (it cannot be reached without materializing it, which the silence rule
  // forbids).
  //
  // SERIAL-DISPATCH SAFETY (binding): `agent/turn-stopping` is a `serial` dispatch — a listener
  // that RETURNS a value BAILS the rest of the chain, and a returned promise is awaited. This
  // handler therefore returns NOTHING (never a promise), contains its own failures, and does the
  // real work in a detached async block. Same rule as the watchdog's turn-end stamp.
  dsh.onEvent?.("agent/turn-stopping", (payload: unknown) => {
    try {
      const agent = (payload as { agent?: { session?: { id?: unknown; header?: { cwd?: unknown } } } } | undefined)?.agent
      const sessionId = String(agent?.session?.id ?? "")
      if (sessionId === "") return undefined
      const cwd = String(agent?.session?.header?.cwd ?? "")
      const workspace = cwd !== "" ? cwd : dsh.workspaceRoot()
      if (workspace === undefined || workspace === "") return undefined
      void (async () => {
        try {
          for (const teamId of listTeamIds(dsh)) {
            const team = readTeamRecord(dsh, teamId)
            if (team === undefined) continue
            if (!compactableMembers(team).some((member) => member.id === sessionId)) continue
            if (!teamIsFinished(team, terminalStatuses())) continue
            await runPass(workspace, teamId, { via: "turn-end", sessionId, cwd })
          }
        } catch (error) {
          log.warn?.(`mpd-team-compact: turn-boundary pass failed: ${error instanceof Error ? error.message : String(error)}`)
        }
      })()
    } catch (error) {
      log.warn?.(`mpd-team-compact: turn-boundary listener failed: ${error instanceof Error ? error.message : String(error)}`)
    }
    return undefined
  })

  // TOOL PARAMETERS ARE OBJECT-ROOTED JSON SCHEMA — both tools below.
  //
  // MEASURED DEFECT (2026-09-14): the first cut passed a BARE property map
  // (`parameters: { team_id: {…} }`). The adapter forwards `parameters` VERBATIM (it only
  // defaults a schema when the field is ABSENT), and the harness's raw `register()` path
  // does not validate parameters the way its `defineTool` does, so the registered schema
  // had no `type` at all and the provider rejected EVERY model request of a session
  // mounting the row:
  //   Invalid schema for function 'mpd_team_compact_run': schema must be a JSON Schema of
  //   'type: "object"', got 'type: null'
  // The mount-level gate for this class is the QA roles probe's TOOL_PARAM_SCHEMAS line
  // (a live-registry read; `--dump-config` is blind to it — AGENTS.md §4), and the unit
  // gate is the "object-rooted parameters" test in test/compaction.test.mjs.
  dsh.registerTool({
    name: "mpd_team_compact_run",
    description: "Compact the members of a FINISHED team (every task terminal and every member idle). The captain is never compacted. Writes an audit record under .mpd/team-compact/ and notifies nobody.",
    parameters: {
      type: "object",
      properties: {
        team_id: { type: "string", description: "The team to compact. Defaults to every finished team in this workspace." },
        force: { type: "boolean", description: "Write an audit record even when the outcome is identical to the previous one (repeats are otherwise collapsed by the write-on-change rule and counted in the next record\'s \"suppressed\")." },
      },
      additionalProperties: false,
    },
    output: {
      schema: { type: "object", properties: { passes: { type: "array", items: { type: "object" } } } },
      render: (_args: unknown, value: { passes: CompactAudit[] }) => [{
        type: "text",
        text: value.passes.length === 0
          ? "No finished team to compact."
          : value.passes.map((audit) => `${audit.teamId}: ${audit.outcome}${audit.refusedReason === undefined ? "" : ` (${audit.refusedReason})`} — ${audit.members.map((m) => `${m.member}=${m.outcome}`).join(", ") || "no members"}`).join("\n"),
      }],
    },
    async execute(args: { team_id?: string; force?: boolean }, exec: { agent?: { session?: { id?: string; header?: { cwd?: string } } } }) {
      const workspace = dsh.workspaceRoot(exec as never)
      const ids = args?.team_id === undefined || args.team_id === "" ? listTeamIds(dsh) : [args.team_id]
      const sessionId = String(exec?.agent?.session?.id ?? "")
      const caller: CompactAudit["caller"] = {
        via: "tool",
        ...sessionId === "" ? {} : { sessionId },
        ...exec?.agent?.session?.header?.cwd === undefined ? {} : { cwd: String(exec.agent.session.header.cwd) },
      }
      const passes: CompactAudit[] = []
      for (const teamId of ids) passes.push(await runPass(workspace, teamId, caller, args?.force === true))
      return { passes }
    },
  })

  dsh.registerTool({
    name: "mpd_team_compact_status",
    description: "Read-only: show the compaction audit for this workspace (one record per pass, newest last), including skipped members and the reason each was skipped.",
    parameters: {
      type: "object",
      properties: {
        team_id: { type: "string", description: "Limit to one team. Defaults to every team with an audit." },
      },
      additionalProperties: false,
    },
    output: {
      schema: { type: "object", properties: { teams: { type: "array", items: { type: "object" } } } },
      render: (_args: unknown, value: { teams: Array<{ teamId: string; passes: CompactAudit[] }> }) => {
        if (value.teams.length === 0) return [{ type: "text", text: "No compaction audit recorded in this workspace." }]
        return [{ type: "text", text: value.teams.map((entry) => {
          const last = entry.passes[entry.passes.length - 1]
          return `${entry.teamId}: ${entry.passes.length} pass(es); latest ${last?.outcome ?? "?"} at ${last === undefined ? "?" : new Date(last.at).toISOString()}${last?.refusedReason === undefined ? "" : ` (${last.refusedReason})`}`
        }).join("\n") }]
      },
    },
    async execute(args: { team_id?: string }, exec: { agent?: { session?: { header?: { cwd?: string } } } }) {
      const workspace = dsh.workspaceRoot(exec as never)
      const ids = args?.team_id === undefined || args.team_id === "" ? listTeamIds(dsh) : [args.team_id]
      return { teams: ids.map((teamId) => ({ teamId, passes: readAudits(workspace, teamId) })) }
    },
  })
}
