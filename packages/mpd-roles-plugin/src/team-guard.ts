// The roster's READ-ONLY discipline for OFFICIAL Agent Teams teammates (AGENTS.md §13).
//
// The discipline has TWO enforcement surfaces and they must keep agreeing:
//   1. the ONE-SHOT path — `mpd_role_spawn` passes `READONLY_DENY` as `toolFilter.deny`;
//   2. the TEAM path — the official `spawn_teammate` cannot accept a per-teammate tool
//      filter (`docs/plan-0.1.7-adaptation.md` §3: `TeamService` forwards only
//      `{prompt, parent}` to `ctx.subagents.startContinuable`), so a live teammate's
//      discipline is enforced by a TOOL GUARD over the SAME list.
//
// Without (2) a "read-only" teammate kept write/edit/bash by accident — a measured defect
// of the retired profile-carried `toolDeny`. The guard is keyed on the CALLING agent's
// team identity: the official membership through the adapter (`dsh.teamMembership(exec.agent)`)
// FIRST; then the adapter's native-handlemap fallback (0.2.2-rc.2 removed the roster), then the
// mpd team RECORD, then the caller's session title. Role "teammate" + a model-facing name that
// normalises to a READ-ONLY roster member is denied.
//
// MONOTONIC, READ-ONLY and NON-THROWING: the guard denies a fixed extra set of tool names
// for a fixed set of member names, never mutates its input and never throws — a guard that
// throws takes the whole tool tree down. Every other call passes through untouched: the
// Lead, a worker member, a non-team agent, an identity no source can resolve and every tool
// outside the deny list.
import type { DshAdapter } from "../../mpd-dsh-adapter-plugin/src/index"

/** One roster entry as the guard needs it (the roster's own fields, structurally). */
export interface GuardRosterMember {
  /** The member's MODEL-FACING display name — the only spelling a Lead addresses it by. */
  name: string
  /** True for the members the read-only discipline protects. */
  readonly: boolean
}

/** What installing the team-path guard needs: the deny list, the roster and a degradation reporter. */
export interface ReadonlyGuardOptions {
  /** The write-capable tool names the roster denies (the SAME list the role-spawn path uses). */
  deny: readonly string[]
  /** The roster; every `readonly: true` member is protected. */
  members: readonly GuardRosterMember[]
  /** One-line reporter for an install-time degradation (the guard itself is silent). */
  warn: (line: string) => void
  /**
   * The RECORD identity source (A1 item 1, defence in depth): the caller's team membership read
   * from the mpd team record by session id, consulted only when the official plane is silent.
   * Absent means "this composition has no record surface", which leaves the title arm as the
   * last resort.
   */
  recordMemberOf?: (agent: unknown, exec: unknown) => { role?: string; name?: string } | undefined
}

/** The install outcome, REPORTED rather than thrown so a missing seam never aborts the row. */
export interface ReadonlyGuardInstall {
  /** True when the guard reached the harness tool registry. */
  installed: boolean
  /** Why it did not, when `installed` is false (already reported through `warn`). */
  reason?: string
  /** The registry's disposer, when installed. */
  dispose?: () => void
}

/**
 * The frozen team-member normalisation: lowercase, and every run of non-alphanumerics
 * becomes a single `-` (`"Deep Worker"` → `"deep-worker"`, `"Plan_Reviewer"` →
 * `"plan-reviewer"`). Leading/trailing separators are trimmed so `" Explorer "` and
 * `"-explorer-"` address the same member.
 *
 * NOTE this is deliberately NOT the roster's own `normalizeRoleNameKey` (which strips
 * separators entirely): the team path compares MODEL-FACING kebab names, and the two
 * spellings must not be conflated — a caller addressing `mpd_role_spawn` still goes
 * through the roster's own resolution.
 */
export function normalizeTeamMemberKey(name: string): string {
  return String(name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

/** Normalised key → the roster's own display name, for every READ-ONLY member. */
export function readonlyMemberKeys(members: readonly GuardRosterMember[]): Map<string, string> {
  /** Normalised key to display name, accumulated for every read-only member. */
  const keys = new Map<string, string>()
  for (const member of members) {
    if (member?.readonly !== true) continue
    /** This member's normalised key; an empty one addresses nothing and is skipped. */
    const key = normalizeTeamMemberKey(member.name)
    if (key !== "") keys.set(key, member.name)
  }
  return keys
}

/**
 * The READ-ONLY roster member a team member's name addresses, or `undefined`.
 *
 * Two spellings address a member:
 *   * the exact normalised name (`"Explorer"` / `"explorer"` / `"plan reviewer"`);
 *   * that name with ONE trailing numeric suffix (`"explorer-2"`) — a team-unique suffix
 *     the Lead may append when it stages the same member twice. Without this clause the
 *     discipline would be bypassable by appending a digit, which is exactly the defect
 *     class this guard exists to close.
 */
export function readonlyMemberForTeamName(
  name: string,
  readonlyKeys: ReadonlyMap<string, string>,
): string | undefined {
  /** The caller's normalised name. */
  const key = normalizeTeamMemberKey(name)
  if (key === "") return undefined
  /** The display name when the caller's name IS a read-only member. */
  const exact = readonlyKeys.get(key)
  if (exact !== undefined) return exact
  /** The name with one trailing numeric suffix removed — the second accepted spelling. */
  const withoutSuffix = key.replace(/-\d+$/, "")
  if (withoutSuffix === key || withoutSuffix === "") return undefined
  return readonlyKeys.get(withoutSuffix)
}

/**
 * The guard itself: a denial string for a denied (tool, caller) pair, else `undefined`.
 *
 * Pure with respect to the harness — the ONLY external reads are `membershipOf(agent)` and, on a
 * host whose roster cannot answer, `recordMemberOf(agent, exec)`. Exported so the decision is
 * testable without a registry, and so the plugin can install the exact same function it proves.
 *
 * IDENTITY LADDER (A1/A2, in order — a LATER source never vetoes an earlier one):
 *   1. the official membership (`0.2.2-rc.1`: byte-identical to before);
 *   2. the mpd team RECORD (defence in depth): the authoritative fallback on a task-board-only
 *      host (0.2.2-rc.2 removed the roster) and after a process restart that lost the executor's
 *      in-memory handle map;
 *   3. the caller's SESSION TITLE, matched against the READ-ONLY roster names only. This is the
 *      DEFAULT-TO-DENY arm: an agent nothing else can identify, whose own title names a read-only
 *      member, is denied rather than silently widened.
 * A blanket deny when both identity sources are silent would deny the Lead, every worker member,
 * ordinary subagents and every non-team session, so it is deliberately NOT applied: an agent no
 * source and no title identifies is not provably a team member and passes through.
 */
export function readonlyGuardDecision(
  exec: unknown,
  options: {
    deny: ReadonlySet<string>
    readonlyKeys: ReadonlyMap<string, string>
    membershipOf: (agent: unknown) => { role?: string; name?: string } | undefined
    recordMemberOf?: (agent: unknown, exec: unknown) => { role?: string; name?: string } | undefined
  },
): string | undefined {
  try {
    /** The tool being invoked; a name outside the deny list passes through immediately. */
    const toolName = String((exec as { name?: unknown } | undefined)?.name ?? "")
    if (!options.deny.has(toolName)) return undefined
    /** The caller's Agent handle, which every identity source is keyed on. */
    const agent = (exec as { agent?: unknown } | undefined)?.agent
    /** The official plane's answer — the FIRST source, and the only one 0.2.2-rc.1 needs. */
    const host = options.membershipOf(agent)
    /** The record fallback, consulted ONLY when the official plane is silent (A2's primary path). */
    const fromRecord = host === undefined || host === null ? options.recordMemberOf?.(agent, exec) : undefined
    /** The caller's team identity, from the highest source that answered. */
    const membership = host ?? fromRecord
    if (membership !== undefined && membership !== null) {
      // The Lead leads, a worker member writes, a non-team agent is somebody else's business.
      if (membership.role !== "teammate") return undefined
      /** The read-only member this caller's name addresses, if any. */
      const member = readonlyMemberForTeamName(String(membership.name ?? ""), options.readonlyKeys)
      if (member === undefined) return undefined
      return denialFor(toolName, String(membership.name ?? ""), member)
    }
    // NO identity source answered. LAST resort: the caller's own session title, matched against the
    // READ-ONLY names only — the conservative arm, so an unidentified read-only teammate cannot keep
    // its write tools. A title that names a worker (or no roster member at all) still passes.
    /** The session title the harness gave this caller, or the empty string when it carries none. */
    const title = String((exec as { agent?: { session?: { header?: { title?: unknown } } } } | undefined)?.agent?.session?.header?.title ?? "")
    /** The read-only member the title names, if any. */
    const byTitle = title === "" ? undefined : readonlyMemberForTeamName(title, options.readonlyKeys)
    // A WORKER title must not be denied: only a read-only match reaches the denial.
    return byTitle === undefined ? undefined : denialFor(toolName, title, byTitle)
  } catch {
    // A guard must never throw: an unexpected shape is a pass-through, never an outage.
    return undefined
  }
}

/**
 * The ONE denial sentence: it names the caller, the protected member, the denied tool and the way out.
 * @param toolName the denied tool name.
 * @param callerName the caller's model-facing team name (or session title).
 * @param member the read-only roster member the name resolves to.
 * @returns the message the harness shows the caller.
 */
function denialFor(toolName: string, callerName: string, member: string): string {
  return "roster read-only discipline: teammate \"" + callerName + "\" is the READ-ONLY roster member "
    + member + ", so `" + toolName + "` is denied. Read-only members never modify the tree: return the finding, "
    + "or ask the Lead (or a worker member — Deep Worker, Senior Engineer, Junior Engineer, Reviewer) to make the change."
}

/**
 * Install the guard through the adapter (`dsh.guardTool`). Degrades with a warning
 * instead of aborting the plugin tree — the roster's tools stay usable, and the
 * degradation is visible in the boot log.
 */
export function installReadonlyGuard(
  dsh: Pick<DshAdapter, "capabilities" | "guardTool" | "teamMembership">,
  options: ReadonlyGuardOptions,
): ReadonlyGuardInstall {
  /** Normalised key to display name for every read-only member, or an empty map. */
  const readonlyKeys = readonlyMemberKeys(options.members)
  if (readonlyKeys.size === 0) {
    options.warn("no read-only roster member is declared — the team-path read-only guard is NOT installed")
    return { installed: false, reason: "no-readonly-members" }
  }
  try {
    if (dsh.capabilities().toolsGuard !== true) {
      options.warn("the harness exposes no tools.guard seam — the team-path read-only guard is NOT installed "
        + "(read-only teammates would keep write access; the `mpd_role_spawn` path is unaffected)")
      return { installed: false, reason: "no-guard-seam" }
    }
    /** The deny list as a set, so the per-call decision costs one lookup. */
    const deny = new Set(options.deny)
    /** The registry's disposer, returned so the row can release the guard. */
    const dispose = dsh.guardTool((exec) => readonlyGuardDecision(exec, {
      deny,
      readonlyKeys,
      membershipOf: (agent) => dsh.teamMembership(agent) as { role?: string; name?: string } | undefined,
      ...(options.recordMemberOf === undefined ? {} : { recordMemberOf: options.recordMemberOf }),
    }))
    return { installed: true, ...(typeof dispose === "function" ? { dispose } : {}) }
  } catch (error) {
    options.warn("installing the team-path read-only guard failed (" + (error instanceof Error ? error.message : String(error)) + ")")
    return { installed: false, reason: "install-failed" }
  }
}

/** The structural face of the `mpdTeams` read service (NEVER imported from its package). */
interface TeamRecordsFace {
  /** Every team record in one workspace; `[]` when the surface cannot answer. */
  list?: (workspace: string) => unknown
}

/** One team record member row, as far as identity needs it. */
interface RecordMemberRow {
  /** The member's model-facing display name. */
  name?: unknown
  /** The executor's own handle for the member (its session id today). */
  executorRef?: unknown
}

/** One team record, as far as identity needs it. */
interface RecordTeamIdentity {
  /** The Lead session this team belongs to. */
  leadSessionId?: unknown
  /** Earlier Lead session ids (the fork/resume churn record). */
  leadHistory?: unknown
  /** The roster rows. */
  members?: unknown
}

/**
 * The identity a caller's session id carries on the mpd team RECORD — the defence-in-depth source
 * beside the adapter's native-handlemap fallback (A1 item 1 / A2).
 *
 * WHY IT EXISTS: 0.2.2-rc.2 removed the host roster, so `dsh.teamMembership` can only answer from
 * what this process raised. A process restart loses that in-memory map, and a teammate that keeps
 * running across it would otherwise read as "no team" — the exact silent privilege widening A1
 * item 1 calls HIGH. The record survives on disk and stores each member's `executorRef`, so it is
 * the authoritative fallback the contract names.
 *
 * TOTALLY CONTAINED: no record service, an unreadable record or a thrown read is a MISS, never an
 * exception (a guard must not take the tool tree down).
 * @param ctx the row's cordis context, read only through `get(id, false)`.
 * @param dsh the adapter slice that resolves the caller's workspace root.
 * @returns a resolver: the caller's role/name from the records, or undefined when no record knows it.
 */
export function teamRecordMemberOf(
  ctx: unknown,
  dsh: Pick<DshAdapter, "workspaceRoot">,
): (agent: unknown, exec: unknown) => { role?: string; name?: string } | undefined {
  return (agent: unknown, exec: unknown): { role?: string; name?: string } | undefined => {
    try {
      /** The team read surface, absent when the team-core row is not mounted. */
      const teams = (ctx as { get?: (id: string, strict?: boolean) => unknown } | undefined)?.get?.("mpdTeams", false) as TeamRecordsFace | undefined
      if (typeof teams?.list !== "function") return undefined
      /** The caller's session id, which is what a record member row stores as `executorRef`. */
      const sessionId = String((agent as { session?: { id?: unknown } } | undefined)?.session?.id ?? "")
      if (sessionId === "") return undefined
      /** The tool exec as the adapter's own parameter type: forwarded verbatim, never read here. */
      const target = exec as Parameters<DshAdapter["workspaceRoot"]>[0]
      /** The workspace whose records hold the answer. */
      const workspace = dsh.workspaceRoot(target)
      /** Every record in that workspace. */
      const records = teams.list.call(teams, workspace)
      if (!Array.isArray(records)) return undefined
      for (const raw of records) {
        /** One record, read structurally. */
        const record = (raw ?? {}) as RecordTeamIdentity
        /** Every id this record has recorded as its Lead, current first. */
        const leads = [record.leadSessionId, ...(Array.isArray(record.leadHistory) ? record.leadHistory : [])].filter((value: unknown): value is string => typeof value === "string" && value !== "")
        if (leads.includes(sessionId)) return { role: "lead" }
        /** The roster rows, as far as identity reads them. */
        const members = Array.isArray(record.members) ? record.members as RecordMemberRow[] : []
        /** The row this caller owns on this roster, when it is a member. */
        const own = members.find((member: RecordMemberRow): boolean => String(member?.executorRef ?? "") === sessionId)
        if (own !== undefined) return { role: "teammate", name: String(own.name ?? "") }
      }
      return undefined
    } catch {
      // A guard's identity resolver must never throw: an unreadable record is a miss.
      return undefined
    }
  }
}
