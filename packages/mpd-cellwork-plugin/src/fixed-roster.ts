import { roleKey } from "./split"
import type { SplitVerdict } from "./split"

/** Fixed project identity comes from Team's own authenticated roster service. */
export interface FixedSeat {
  /** Stable Workmate-independent project member identifier. */
  readonly memberId: string
  /** Current board-facing alias. */
  readonly name: string
  /** Authored member name before Workmate binding. */
  readonly logicalName?: string
  /** Pinned roster role when one was explicitly declared. */
  readonly role?: string
}

/** Declared bundle service lookup, with no harness contacts. */
interface Context {
  /** Resolve the optional project-identity row. */
  get?: (id: string, strict?: boolean) => unknown
}

/** Parse exactly the authenticated roster shape used by Cellwork. */
function fixedSeat(value: unknown): value is FixedSeat {
  return typeof value === "object" && value !== null && "memberId" in value && typeof value.memberId === "string" &&
    "name" in value && typeof value.name === "string" && (!("logicalName" in value) || typeof value.logicalName === "string") &&
    (!("role" in value) || typeof value.role === "string")
}

/** An absent older service is distinguished from an admitted project with zero fixed seats. */
export function fixedRosterOf(ctx: Context, checkoutRoot: string, sessionId: string): readonly FixedSeat[] | undefined {
  /** Existing authority is called with the actual session and checkout already resolved by the adapter. */
  const identity = ctx.get?.("mpdProjectIdentity", false)
  if (typeof identity !== "object" || identity === null || !("roster" in identity) || typeof identity.roster !== "function") return undefined
  /** Corrupt or denied reads stop activation rather than silently allowing unconstrained growth. */
  const value: unknown = identity.roster({ checkoutRoot, sessionId })
  if (typeof value !== "object" || value === null || !("members" in value) || !Array.isArray(value.members) || !value.members.every(fixedSeat)) {
    throw new Error("project roster could not be read; no execution seats were raised")
  }
  return value.members
}

/** Use explicit names or the sole compatible fixed seat when the split names only a roster role. */
function seatOf(owner: string, role: string, roster: readonly FixedSeat[]): FixedSeat | undefined {
  /** An authored logical or board-facing alias is authoritative when unique. */
  const exact = roster.filter((seat) => roleKey(seat.name) === roleKey(owner) || roleKey(seat.logicalName ?? seat.name) === roleKey(owner))
  /** A role-only shorthand may choose its sole fixed candidate, without picking among peers. */
  const matches = exact.length === 0 && roleKey(owner) === roleKey(role) ? roster.filter((seat) => roleKey(seat.role ?? "") === roleKey(role)) : exact
  /** A split cannot silently repurpose a fixed seat into another role. */
  return matches.length === 1 && roleKey(matches[0].role ?? "") === roleKey(role) ? matches[0] : undefined
}

/** Normalize a split before any execution artifacts or raises, preserving independent review. */
export function fixedOwners(split: SplitVerdict, roster: readonly FixedSeat[]): SplitVerdict {
  if (roster.length === 0) return split
  /** The selected exact board name must be used consistently through mint, contracts and dispatch. */
  const tasks = split.tasks.map((task) => {
    /** The accepted role and stable owner name form one assignment request. */
    const owner = task.member.trim() || task.ownerRole.trim()
    /** Missing or ambiguous names remain the split author's decision. */
    const seat = seatOf(owner, task.ownerRole, roster)
    if (seat === undefined) throw new Error(`unresolved fixed owner ${JSON.stringify(owner)} for ${JSON.stringify(task.ownerRole)}; name a compatible declared member or ask the project captain to declare one via agent_teams_plan action roster, then resubmit the split`)
    return { ...task, member: seat.name }
  })
  for (const task of tasks) {
    if (task.kind === "review" && tasks.some((candidate) => candidate.kind !== "review" && task.blockedBy.includes(candidate.key) && task.member === candidate.member)) {
      throw new Error(`review ${JSON.stringify(task.key)} resolves to the same fixed seat as its writer; select an independent verifier and resubmit the split`)
    }
  }
  return { ...split, tasks }
}