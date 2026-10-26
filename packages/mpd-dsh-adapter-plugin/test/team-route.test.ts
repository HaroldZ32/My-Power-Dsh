// THE NATIVE TEAM MEMBER ROUTE: identity -> the agent's OWN `agentRoutes` entry -> child `agentOptions`.
//
// WHY THIS FILE IS THE CONTRACT'S PROOF. Before this wave every member raised by the NATIVE team
// executor inherited the STAGING session's model route: `nativeTeamExecutor().spawn` built the spec
// from the caller's request and consulted no route source, so the configured per-agent routes applied
// to no teammate at all. The decision is now made in ONE pure place: a member's identity (role, then
// the head of its description, then its whole name) is matched through the live `mpdConfig` service,
// and a matched agent answers with its own route, which the spawn turns into `agentOptions`.
//
// The arms below are the ones a regression could hide behind:
//   * identity PRECEDENCE (role -> description head -> name), with the role losing to a description
//     only because the role names NO member;
//   * one shared label table proving `rosterNameHead` and `memberFromLabel` agree — including
//     `"Architect · team-1"`, where `·` is NOT a separator (that label is the native spec's own
//     `${name} · ${teamName}` spelling, and treating it as an identity would route a name suffix);
//   * the total, never-throwing failure shapes: unmatched, unconfigured, invalid, no service — with
//     the canonical `AGENT_UNCONFIGURED` sentence BUILT here from the typed state (contract §3).
import { describe, expect, test } from "bun:test"

import {
  agentUnconfiguredMessage,
  resolveTeamMemberRoute,
  rosterNameHead,
  type DshTeamAgentRouteAnswer,
  type DshTeamMemberIdentity,
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

/** The Architect route, whose OWN entry carries a fallback chain so the passthrough is visible. */
const ARCHITECT = {
  ok: true,
  agent: "Architect",
  route: { provider: "deepseek-official", model: "deepseek-v4-flash", reasoningEffort: "max", fallbacks: [{ provider: "backup", model: "spare" }] },
} as const satisfies DshTeamAgentRouteAnswer

/** A second usable route, so a two-member spawn can prove the routes actually differ. */
const WORKER = {
  ok: true,
  agent: "Deep Worker",
  route: { provider: "gateway", model: "smart-worker" },
} as const satisfies DshTeamAgentRouteAnswer

/** The typed `unconfigured` state the config service reports for an agent with no entry. */
const UNCONFIGURED = {
  ok: false,
  reason: "unconfigured",
  agent: "Junior Engineer",
  missing: ["agentRoutes.Junior Engineer.provider", "agentRoutes.Junior Engineer.model"],
} as const satisfies DshTeamAgentRouteAnswer

/** The typed `invalid` state, distinct from a merely absent one. */
const INVALID = {
  ok: false,
  reason: "invalid",
  agent: "Vision Analyst",
  problem: "agentRoutes.Vision Analyst.model",
} as const satisfies DshTeamAgentRouteAnswer

/**
 * A resolver double over a member->answer table, mirroring the real service's TOTAL contract:
 * a name it knows answers that entry, every other name answers `unrouted`.
 * @param answers - the member entries this double serves.
 * @returns the resolver a caller passes to `resolveTeamMemberRoute`.
 */
function resolverOf(answers: Readonly<Record<string, DshTeamAgentRouteAnswer>>): (member: string) => unknown {
  /** The entries keyed the way the real service normalizes them: lower-cased. */
  const byName = new Map(Object.entries(answers).map(([member, answer]) => [member.toLowerCase(), answer] as const))
  return (member: string): unknown => byName.get(member.toLowerCase()) ?? { ok: false, reason: "unrouted" }
}

/** The answers the routing arms share, including both unusable shapes. */
const ANSWERS: Readonly<Record<string, DshTeamAgentRouteAnswer>> = {
  Architect: ARCHITECT,
  "Senior Engineer": ARCHITECT,
  Reviewer: ARCHITECT,
  "Plan Reviewer": ARCHITECT,
  "Deep Worker": WORKER,
  "Vision Analyst": INVALID,
  "Junior Engineer": UNCONFIGURED,
}

/** The resolver most arms use. */
const RESOLVE = resolverOf(ANSWERS)

describe("resolveTeamMemberRoute — identity precedence", () => {
  test("role routes first", () => {
    /** The identity whose ROLE names the agent and whose description names nobody. */
    const identity: DshTeamMemberIdentity = { role: "Architect", description: "does odd jobs", name: "M1" }
    expect(resolveTeamMemberRoute(identity, RESOLVE)).toEqual({
      status: "routed",
      member: "Architect",
      // The route carries its three SEND fields; the agent's own chain rides beside it.
      route: { provider: "deepseek-official", model: "deepseek-v4-flash", reasoningEffort: "max" },
      fallbacks: ARCHITECT.route.fallbacks,
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
    // The fallback chain is the agent's OWN (config `AgentRoute.fallbacks`), forwarded untouched.
    expect(outcome.fallbacks).toEqual([{ provider: "backup", model: "spare" }])
  })

  test("the whole NAME routes when the description names nobody", () => {
    /** An identity whose description is prose and whose name is the roster agent. */
    const identity: DshTeamMemberIdentity = { description: "checks the diff", name: "Reviewer" }
    /** The outcome under test. */
    const outcome = resolveTeamMemberRoute(identity, RESOLVE)
    expect(outcome.status).toBe("routed")
    if (outcome.status !== "routed") throw new Error("expected a routed outcome")
    expect(outcome.member).toBe("Reviewer")
  })

  test("TWO members with DIFFERENT routes route independently — no cross-talk (§9)", () => {
    /** The first member's outcome. */
    const architect = resolveTeamMemberRoute({ role: "Architect", description: "", name: "M1" }, RESOLVE)
    /** The second member's outcome, read through the same resolver. */
    const worker = resolveTeamMemberRoute({ role: "Deep Worker", description: "", name: "M2" }, RESOLVE)
    if (architect.status !== "routed" || worker.status !== "routed") throw new Error("expected two routed outcomes")
    expect(architect.route).toEqual({ provider: "deepseek-official", model: "deepseek-v4-flash", reasoningEffort: "max" })
    expect(worker.route).toEqual({ provider: "gateway", model: "smart-worker" })
  })

  test("role=stranger loses to description=member: an UNROUTED role does not stop the walk", () => {
    /** The collision the precedence rule exists for: a role label plus a roster description. */
    const identity: DshTeamMemberIdentity = { role: "Wizard", description: "Architect — designs the seam", name: "Wizard" }
    /** The outcome under test. */
    const outcome = resolveTeamMemberRoute(identity, RESOLVE)
    expect(outcome.status).toBe("routed")
    if (outcome.status !== "routed") throw new Error("expected a routed outcome")
    expect(outcome.member).toBe("Architect")
  })

  test("an identity that names no agent is UNMATCHED, not an error", () => {
    expect(resolveTeamMemberRoute({ role: "Wizard", description: "does odd jobs", name: "helper" }, RESOLVE)).toEqual({ status: "unmatched" })
  })
})

describe("resolveTeamMemberRoute — total failure shapes (never a throw)", () => {
  test("unconfigured -> unusable carrying the canonical AGENT_UNCONFIGURED sentence", () => {
    /** The identity whose agent has no usable route. */
    const identity: DshTeamMemberIdentity = { description: "Junior Engineer — builds the fixture", name: "M3" }
    /** The outcome under test; the call itself is the no-throw assertion. */
    const outcome = resolveTeamMemberRoute(identity, RESOLVE)
    expect(outcome).toEqual({
      status: "unusable",
      member: "Junior Engineer",
      reason: "unconfigured",
      detail: agentUnconfiguredMessage("Junior Engineer", "missing agentRoutes.Junior Engineer.provider, agentRoutes.Junior Engineer.model"),
    })
  })

  test("invalid -> unusable with reason invalid and the offending path", () => {
    /** The identity whose route declares a malformed leaf. */
    const identity: DshTeamMemberIdentity = { description: "Vision Analyst — reads the screenshot", name: "M4" }
    /** The outcome under test. */
    const outcome = resolveTeamMemberRoute(identity, RESOLVE)
    expect(outcome).toEqual({
      status: "unusable",
      member: "Vision Analyst",
      reason: "invalid",
      detail: agentUnconfiguredMessage("Vision Analyst", "agentRoutes.Vision Analyst.model must be a string"),
    })
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
  /** One shared label row: the raw label, the head the split must yield, and the agent it names. */
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
    // a separator — the whole string stays the head and can match no roster agent.
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
