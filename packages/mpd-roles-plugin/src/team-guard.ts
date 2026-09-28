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
// team membership through the adapter (`dsh.teamMembership(exec.agent)`): role
// "teammate" + a model-facing name that normalises to a READ-ONLY roster member.
//
// MONOTONIC, READ-ONLY and NON-THROWING: the guard denies a fixed extra set of tool names
// for a fixed set of member names, never mutates its input and never throws — a guard that
// throws takes the whole tool tree down. Every other call passes through untouched: the
// Lead, a worker member, a non-team agent, an unresolvable membership and every tool
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
  /** The write-capable tool names the roster denies (the SAME list the one-shot path uses). */
  deny: readonly string[]
  /** The roster; every `readonly: true` member is protected. */
  members: readonly GuardRosterMember[]
  /** One-line reporter for an install-time degradation (the guard itself is silent). */
  warn: (line: string) => void
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
 * Pure with respect to the harness — the ONLY external read is `membershipOf(agent)`,
 * which the caller binds to `dsh.teamMembership` (a never-throwing method). Exported so
 * the decision is testable without a registry, and so the plugin can install the exact
 * same function it proves.
 */
export function readonlyGuardDecision(
  exec: unknown,
  options: {
    deny: ReadonlySet<string>
    readonlyKeys: ReadonlyMap<string, string>
    membershipOf: (agent: unknown) => { role?: string; name?: string } | undefined
  },
): string | undefined {
  try {
    /** The tool being invoked; a name outside the deny list passes through immediately. */
    const toolName = String((exec as { name?: unknown } | undefined)?.name ?? "")
    if (!options.deny.has(toolName)) return undefined
    /** The caller's team membership: the Lead, a teammate, or an agent with no team at all. */
    const membership = options.membershipOf((exec as { agent?: unknown } | undefined)?.agent)
    // The Lead leads, a worker member writes, a non-team agent is somebody else's business.
    if (membership === undefined || membership === null || membership.role !== "teammate") return undefined
    /** The read-only member this caller's name addresses, if any. */
    const member = readonlyMemberForTeamName(String(membership.name ?? ""), options.readonlyKeys)
    if (member === undefined) return undefined
    return "roster read-only discipline: teammate \"" + String(membership.name) + "\" is the READ-ONLY roster member "
      + member + ", so `" + toolName + "` is denied. Read-only members never modify the tree: return the finding, "
      + "or ask the Lead (or a worker member — Deep Worker, Senior Engineer, Junior Engineer, Reviewer) to make the change."
  } catch {
    // A guard must never throw: an unexpected shape is a pass-through, never an outage.
    return undefined
  }
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
        + "(read-only teammates would keep write access; the one-shot path is unaffected)")
      return { installed: false, reason: "no-guard-seam" }
    }
    /** The deny list as a set, so the per-call decision costs one lookup. */
    const deny = new Set(options.deny)
    /** The registry's disposer, returned so the row can release the guard. */
    const dispose = dsh.guardTool((exec) => readonlyGuardDecision(exec, {
      deny,
      readonlyKeys,
      membershipOf: (agent) => dsh.teamMembership(agent) as { role?: string; name?: string } | undefined,
    }))
    return { installed: true, ...(typeof dispose === "function" ? { dispose } : {}) }
  } catch (error) {
    options.warn("installing the team-path read-only guard failed (" + (error instanceof Error ? error.message : String(error)) + ")")
    return { installed: false, reason: "install-failed" }
  }
}
