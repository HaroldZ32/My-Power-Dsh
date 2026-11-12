// Lane C of `.mpd/plans/agent-worktrees.md`: a write-capable member is raised in its OWN git
// worktree, forwarded as the child's EFFECTIVE cwd. The worktree row publishes that capability as the
// `mpdWorktree` service (Lane A) and this module is the ONLY place team-core names it, so the two rows
// agree on ONE service id and ONE degrade rule.
//
// DEGRADE NEVER FAILS (D4/D7): an absent service, a disabled row, a non-git workspace or a failed
// create all leave the spawn request unchanged (no `cwd`) with exactly ONE log line. A read-only
// specialist is never given a worktree — it is classified by the SAME roster predicate the dispatch
// guard uses (`readonlyMemberKeys` / `isReadonlyMemberName`), never by a second list.
import { isReadonlyMemberName, readonlyMemberKeys, type RosterRow } from "./dispatch.ts"

/**
 * The service id Lane A publishes for per-member worktrees.
 *
 * Spelled once here so a rename in one row cannot leave this row reading a service nobody provides.
 */
export const WORKTREE_SERVICE = "mpdWorktree"

/** One member the worktree service addresses: the owning team and the member's display name. */
export interface WorktreeMemberRef {
  /** The owning team's id, spelled exactly as the team record spells it. */
  teamId: string
  /** The member's display name, which is also the name its seat is addressed by. */
  member: string
}

/** The slice of the `mpdWorktree` service this row consumes (contract §3 Lane A). */
export interface WorktreeServiceView {
  /**
   * Create (or reuse) one member's worktree.
   * @param exec - the spawn site's exec, read only to resolve the workspace root.
   * @param ref - the owning team and member.
   * @returns the worktree path and branch, or undefined when the row degraded (never a throw).
   */
  createForMember?: (exec: unknown, ref: WorktreeMemberRef) => { path?: string; branch?: string } | undefined
  /**
   * Read one member's recorded worktree path, for the compaction reseed.
   * @param exec - the caller's exec, read only to resolve the workspace root.
   * @param ref - the owning team and member.
   * @returns the existing path, or undefined when no active worktree is recorded (never a throw).
   */
  cwdForMember?: (exec: unknown, ref: WorktreeMemberRef) => string | undefined
}

/** What one spawn site asks the lookup: where the member should work, if anywhere. */
export interface MemberWorktreeQuery {
  /** The spawn site's exec, forwarded to the service so it resolves the right workspace. */
  exec: unknown
  /** The owning team's id. */
  teamId: string
  /** The member's display name. */
  member: string
  /** The member's role label when its spawner knows one — the dispatch guard classifies it too. */
  role?: string
}

/** Where one member should work, plus whether this lookup CREATED that worktree. */
export interface MemberWorktreeAssignment {
  /** The member's own worktree path. */
  path: string
  /** True only when no active worktree existed before this lookup created one. */
  created: boolean
}

/** The per-call worktree lookup a spawn site builds once and reuses across a roster loop. */
export type MemberWorktreeLookup = (query: MemberWorktreeQuery) => MemberWorktreeAssignment | undefined

/**
 * Read the roster's READ-ONLY keys from the mpd-owned roster service.
 *
 * The SAME source and the SAME rule the dispatch guard uses (`mpdRoles.list()` plus
 * {@link readonlyMemberKeys}), so a member classified read-only for dispatch is also skipped here.
 * FAIL-OPEN, exactly like the guard: a roster that cannot be read classifies nobody, and the worktree
 * is then offered to every member rather than silently withheld.
 * @param service - the row's optional-service lookup (`ctx.get(id, false)`), contained by the caller.
 * @returns the normalised read-only keys, or `undefined` when the roster could NOT be read (an absent
 *          service or a throwing `list()`), so the caller can retry after a late-binding mount.
 */
export function rosterReadonlyKeys(service: (id: string) => unknown): ReadonlySet<string> | undefined {
  try {
    /** The mpd-owned roster service; absent in a composition that does not mount the roles row. */
    const roles = service("mpdRoles") as { list?: () => RosterRow[] } | undefined
    if (typeof roles?.list !== "function") return undefined
    return readonlyMemberKeys(roles.list())
  } catch {
    return undefined
  }
}

/**
 * Build the worktree lookup one spawn site applies to every member it raises.
 *
 * The lookup answers the member's worktree path and whether it was CREATED for this attempt, or
 * `undefined` in EVERY degrade case. Exactly one
 * line is written per lookup instance when the service is absent or refuses, so an approve loop that
 * raises five members in a composition without the worktree row says so ONCE, not five times. A
 * read-only member and an already-classified degrade answer `undefined` without a second line — the
 * service logs its own failure (Lane A), and logging it here again would be the second line.
 * @param service - the row's optional-service lookup (`ctx.get(id, false)`), contained by the caller.
 * @param log - the row's diagnostic sink; the caller prefixes the row name.
 * @returns the lookup a spawn site calls once per member.
 */
export function memberWorktreeLookup(service: (id: string) => unknown, log: (line: string) => void): MemberWorktreeLookup {
  /** The read-only keys, cached ONLY once the roster could actually classify a member. */
  let readonlyKeys: ReadonlySet<string> | undefined
  /** The set an unreadable roster classifies against this call, without caching it. */
  const unclassified: ReadonlySet<string> = new Set<string>()
  /** Whether this lookup's ONE degrade line has been written. */
  let reported = false
  /** Write the lookup's one degrade line. */
  const report = (line: string): void => {
    if (reported) return
    reported = true
    log(line)
  }
  return (query: MemberWorktreeQuery): MemberWorktreeAssignment | undefined => {
    // THE ROSTER IS RE-READ UNTIL IT CAN CLASSIFY (CodeRabbit round 1): an mpdRoles row that mounts
    // after this lookup was built must still protect a read-only member. Only a successful read — even
    // an empty one — is cached; an absent/throwing roster is retried on the next member.
    if (readonlyKeys === undefined) readonlyKeys = rosterReadonlyKeys(service)
    /** The keys this call classifies against; an unreadable roster classifies nobody. */
    const keys = readonlyKeys ?? unclassified
    // A read-only specialist writes nothing, so a worktree would be a checkout it can never use.
    if (isReadonlyMemberName(query.member, keys)) return undefined
    if (query.role !== undefined && isReadonlyMemberName(query.role, keys)) return undefined
    /** The worktree service, probed PER CALL so a late-ACTIVE row is not frozen out. */
    const worktree = service(WORKTREE_SERVICE) as WorktreeServiceView | undefined
    if (worktree === undefined || typeof worktree.createForMember !== "function") {
      // The row is absent or disabled: today's shared-checkout spawn, said ONCE (D4).
      report("[mpd-team-core] the mpdWorktree service is absent — team members spawn in the shared checkout (no per-member worktree)")
      return undefined
    }
    try {
      /** Whether an active worktree already existed before this call; an unreadable answer counts as reused. */
      let existed = true
      try {
        existed = typeof worktree.cwdForMember === "function" && worktree.cwdForMember(query.exec, { teamId: query.teamId, member: query.member }) !== undefined
      } catch {
        // A service that cannot answer "does it exist?" is treated as a REUSE, so a later failed spawn
        // never deletes a checkout this row did not create.
        existed = true
      }
      /** What the service created or reused for this member. */
      const created = worktree.createForMember(query.exec, { teamId: query.teamId, member: query.member })
      // An undefined answer means the service already degraded AND logged its own line; adding one
      // here would break the contract's "exactly one log line total".
      if (typeof created?.path !== "string" || created.path === "") return undefined
      return { path: created.path, created: !existed }
    } catch (error) {
      // The service promises it never throws; a row's own code is still another row's, so the spawn
      // must survive it. This is the one line for a REFUSAL that never reported itself.
      report("[mpd-team-core] the mpdWorktree service refused for " + query.teamId + "/" + query.member + ": " + String((error as Error)?.message ?? error) + " (the member spawns in the shared checkout)")
      return undefined
    }
  }
}
