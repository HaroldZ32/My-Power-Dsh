// THE NATIVE TEAM MEMBER ROUTE: identity -> `teamModels` slot -> a child `agentOptions`.
//
// WHY THIS FILE IS THE CONTRACT'S PROOF. Before this wave every member raised by the NATIVE team
// executor inherited the STAGING session's model route: `nativeTeamExecutor().spawn` built the spec
// from the caller's request and consulted no `teamModels` slot, so the four configured routes
// applied to no teammate at all. The decision is now made in ONE pure place: a member's identity
// (role, then the head of its description, then its whole name) is matched through the live
// `mpdConfig` service, and a matched slot answers with a route the spawn turns into `agentOptions`.
//
// The arms below are the ones a regression could hide behind:
//   * identity PRECEDENCE (role -> description head -> name), with the role losing to a description
//     only because the role names NO member;
//   * one shared label table proving `rosterNameHead` and `memberFromLabel` agree — including
//     `"Architect · team-1"`, where `·` is NOT a separator (that label is the native spec's own
//     `${name} · ${teamId}` spelling, and treating it as an identity would route a team-id suffix);
//   * the total, never-throwing failure shapes: unmatched, unconfigured, invalid, no service.
import { describe, expect, test } from "bun:test"

import {
  resolveTeamMemberRoute,
  rosterNameHead,
  type DshTeamMemberIdentity,
  type DshTeamSlotAnswer,
} from "../src/index"
import { memberFromLabel } from "../../mpd-roster-provider-plugin/src/route"

/** The eleven roster names, the vocabulary the config service matches case-insensitively. */
const ROSTER: readonly string[] = [
  "Architect",
  "Researcher",
  "Planner",
  "Deep Worker",
  "Senior Engineer",
  "Lead",
  "Explorer",
  "Reviewer",
  "Plan Reviewer",
  "Vision Analyst",
  "Junior Engineer",
]

/** The slot-1 route the table below hands out, with a fallback chain so passthrough is visible. */
const SLOT_ONE = {
  ok: true,
  slot: "slot1",
  route: { provider: "deepseek-official", model: "deepseek-v4-flash", reasoningEffort: "max" },
  fallbacks: [{ provider: "backup", model: "spare" }],
} as const satisfies DshTeamSlotAnswer

/** A second usable slot, so a two-member spawn can prove the routes actually differ. */
const SLOT_THREE = {
  ok: true,
  slot: "slot3",
  route: { provider: "gateway", model: "smart-worker" },
  fallbacks: [],
} as const satisfies DshTeamSlotAnswer

/** The canonical unconfigured answer the config service builds; its MESSAGE is what gets logged. */
const UNCONFIGURED = {
  ok: false,
  status: "unconfigured",
  slot: "slot3",
  code: "SLOT_UNCONFIGURED",
  message: "SLOT_UNCONFIGURED: slot3 is not usable — missing teamModels.slot3.provider, teamModels.slot3.model",
} as const satisfies DshTeamSlotAnswer

/** The canonical malformed-leaf answer, distinct from a merely absent one. */
const INVALID = {
  ok: false,
  status: "invalid",
  slot: "slot4",
  code: "SLOT_UNCONFIGURED",
  message: "SLOT_UNCONFIGURED: slot4 is not usable — teamModels.slot4.model is not a string",
} as const satisfies DshTeamSlotAnswer

/**
 * A resolver double over a member->answer table, mirroring the real service's TOTAL contract:
 * a member it knows answers that entry, every other name answers `unrouted`.
 * @param answers - the member entries this double serves.
 * @returns the resolver a caller passes to `resolveTeamMemberRoute`.
 */
function resolverOf(answers: Readonly<Record<string, DshTeamSlotAnswer>>): (member: string) => unknown {
  /** The entries keyed the way the real service normalizes them: lower-cased. */
  const byName = new Map(Object.entries(answers).map(([member, answer]) => [member.toLowerCase(), answer] as const))
  return (member: string): unknown => byName.get(member.toLowerCase()) ?? { ok: false, status: "unrouted", slot: undefined }
}

/** The answers the routing arms share, including both unusable shapes. */
const ANSWERS: Readonly<Record<string, DshTeamSlotAnswer>> = {
  Architect: SLOT_ONE,
  "Senior Engineer": SLOT_ONE,
  Reviewer: SLOT_ONE,
  "Plan Reviewer": SLOT_ONE,
  "Deep Worker": SLOT_THREE,
  "Vision Analyst": INVALID,
  "Junior Engineer": UNCONFIGURED,
}

/** The resolver most arms use. */
const RESOLVE = resolverOf(ANSWERS)

describe("resolveTeamMemberRoute — identity precedence", () => {
  test("role routes first", () => {
    /** The identity whose ROLE names the member and whose description names nobody. */
    const identity: DshTeamMemberIdentity = { role: "Architect", description: "does odd jobs", name: "M1" }
    expect(resolveTeamMemberRoute(identity, RESOLVE)).toEqual({
      status: "routed",
      member: "Architect",
      slot: "slot1",
      route: SLOT_ONE.route,
      fallbacks: SLOT_ONE.fallbacks,
    })
  })

  test("the description HEAD routes when no role is given", () => {
    /** The identity the native path builds from a roster-named description. */
    const identity: DshTeamMemberIdentity = { description: "Senior Engineer — implements the parser", name: "M2" }
    /** The outcome under test. */
    const outcome = resolveTeamMemberRoute(identity, RESOLVE)
    expect(outcome.status).toBe("routed")
    if (outcome.status !== "routed") throw new Error("expected a routed outcome")
    expect(outcome.member).toBe("Senior Engineer")
    expect(outcome.route).toEqual({ provider: "deepseek-official", model: "deepseek-v4-flash", reasoningEffort: "max" })
  })

  test("the whole NAME routes when the description names nobody", () => {
    /** An identity whose description is prose and whose name is the roster member. */
    const identity: DshTeamMemberIdentity = { description: "checks the diff", name: "Reviewer" }
    /** The outcome under test. */
    const outcome = resolveTeamMemberRoute(identity, RESOLVE)
    expect(outcome.status).toBe("routed")
    if (outcome.status !== "routed") throw new Error("expected a routed outcome")
    expect(outcome.member).toBe("Reviewer")
  })

  test("role=stranger loses to description=member: an UNROUTED role does not stop the walk", () => {
    /** The collision the precedence rule exists for: a role label plus a roster description. */
    const identity: DshTeamMemberIdentity = { role: "Wizard", description: "Architect — designs the seam", name: "Wizard" }
    /** The outcome under test. */
    const outcome = resolveTeamMemberRoute(identity, RESOLVE)
    expect(outcome.status).toBe("routed")
    if (outcome.status !== "routed") throw new Error("expected a routed outcome")
    expect(outcome.member).toBe("Architect")
    expect(outcome.slot).toBe("slot1")
  })

  test("an identity that names no member is UNMATCHED, not an error", () => {
    expect(resolveTeamMemberRoute({ role: "Wizard", description: "does odd jobs", name: "helper" }, RESOLVE)).toEqual({ status: "unmatched" })
  })
})

describe("resolveTeamMemberRoute — total failure shapes (never a throw)", () => {
  test("unconfigured -> unusable carrying the service's OWN message", () => {
    /** The identity whose slot is a real member with no usable route. */
    const identity: DshTeamMemberIdentity = { description: "Junior Engineer — builds the fixture", name: "M3" }
    /** The outcome under test; the call itself is the no-throw assertion. */
    const outcome = resolveTeamMemberRoute(identity, RESOLVE)
    expect(outcome).toEqual({ status: "unusable", member: "Junior Engineer", slot: "slot3", reason: "unconfigured", detail: UNCONFIGURED.message })
  })

  test("invalid -> unusable with reason invalid and the service's message", () => {
    /** The identity whose slot declares a malformed leaf. */
    const identity: DshTeamMemberIdentity = { description: "Vision Analyst — reads the screenshot", name: "M4" }
    /** The outcome under test. */
    const outcome = resolveTeamMemberRoute(identity, RESOLVE)
    expect(outcome).toEqual({ status: "unusable", member: "Vision Analyst", slot: "slot4", reason: "invalid", detail: INVALID.message })
  })

  test("no resolver at all -> no-config-service", () => {
    expect(resolveTeamMemberRoute({ role: "Architect", description: "", name: "M1" }, undefined)).toEqual({ status: "no-config-service" })
  })

  test("a resolver that THROWS is contained as no answer, never escaping the spawn", () => {
    /** A hostile/stale service double whose every call throws. */
    const throwing = (): unknown => { throw new Error("service down") }
    expect(resolveTeamMemberRoute({ role: "Architect", description: "", name: "M1" }, throwing)).toEqual({ status: "unmatched" })
  })
})

describe("rosterNameHead ≡ memberFromLabel — one rule, one shared table", () => {
  /** One shared label row: the raw label, the head the split must yield, and the member it names. */
  interface LabelRow {
    /** The raw label the caller passes (a description, a name, or a hostile value). */
    label: unknown
    /** What `rosterNameHead` must return. */
    head: string
    /** What `memberFromLabel` must answer over the roster. */
    member: string | undefined
  }
  /** Every separator, the case-insensitive match, and the `·` boundary in ONE table. */
  const TABLE: readonly LabelRow[] = [
    { label: "Architect", head: "Architect", member: "Architect" },
    { label: "Architect — designs the seam", head: "Architect", member: "Architect" },
    { label: "Architect – en dash", head: "Architect", member: "Architect" },
    { label: "Reviewer: correctness", head: "Reviewer", member: "Reviewer" },
    { label: "Plan Reviewer | plan", head: "Plan Reviewer", member: "Plan Reviewer" },
    { label: "Senior Engineer - implements", head: "Senior Engineer", member: "Senior Engineer" },
    { label: "  Deep Worker  ", head: "Deep Worker", member: "Deep Worker" },
    { label: "architect — lowercase", head: "architect", member: "Architect" },
    // THE BOUNDARY THIS FILE PINS: the native spec's own label spelling carries `·`, which is NOT
    // a separator — the whole string stays the head and can match no roster member.
    { label: "Architect · team-1", head: "Architect · team-1", member: undefined },
    { label: "team-1 · Architect", head: "team-1 · Architect", member: undefined },
    { label: "helper", head: "helper", member: undefined },
    { label: "", head: "", member: undefined },
    { label: 42, head: "", member: undefined },
  ]

  test("the same table answers both functions", () => {
    for (const row of TABLE) {
      expect(rosterNameHead(row.label)).toBe(row.head)
      expect(memberFromLabel(row.label, ROSTER)).toBe(row.member)
    }
  })
})
