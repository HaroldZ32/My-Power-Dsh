// A1 item 1 / A2: the read-only guard's IDENTITY LADDER, and the DEFAULT-TO-DENY arm.
//
// 0.2.2-rc.2 removed the host roster, so `teamMembership()` can be silent for a teammate that is
// genuinely read-only. The guard must NEVER answer "allowed" on that silence alone: it falls back
// to the mpd team RECORD (authoritative here) and then to the caller's SESSION TITLE, denying any
// agent those sources show as a read-only member. rc.1 — where the host roster answers — must stay
// byte-identical, so every new arm below is reached ONLY when the earlier source is silent.
import { describe, expect, test } from "bun:test"

import { readonlyGuardDecision, teamRecordMemberOf } from "../src/team-guard"

/** The write-capable tool names the roster denies (the same list the role-spawn path uses). */
const DENY = new Set(["write", "edit", "bash", "mpd_hashline_edit"])

/** The protected roster members, keyed the way the guard normalises a model-facing name. */
const READONLY = new Map<string, string>([["reviewer", "Reviewer"], ["explorer", "Explorer"]])

/**
 * The exec one denied tool call arrives in.
 * @param toolName the tool being invoked.
 * @param options the agent shape and session title the arm needs.
 * @returns the exec object the guard reads.
 */
function execOf(toolName: string, options: { title?: string } = {}): unknown {
  /** The calling agent, whose session header may carry a title. */
  const agent = { session: { id: "session-1", header: options.title === undefined ? {} : { title: options.title } } }
  return { name: toolName, agent }
}

/** One identity source's canned answer. */
type Membership = { role?: string; name?: string } | undefined

/**
 * Decide one call through the guard with the sources the arm stages.
 * @param toolName the tool name under test.
 * @param sources the membership/record answers, or their absence.
 * @returns the guard's denial, or undefined when the call passes.
 */
function decide(toolName: string, sources: { host?: Membership; record?: Membership; title?: string }): string | undefined {
  return readonlyGuardDecision(execOf(toolName, sources.title === undefined ? {} : { title: sources.title }), {
    deny: DENY,
    readonlyKeys: READONLY,
    membershipOf: () => sources.host,
    ...(sources.record === undefined && sources.title === undefined
      ? {}
      : { recordMemberOf: () => sources.record }),
  })
}

describe("rc.1: the official membership is the FIRST and only answer", () => {
  test("a read-only teammate is denied, a worker and the Lead pass — exactly as today", () => {
    expect(decide("write", { host: { role: "teammate", name: "Reviewer" } })).toContain("READ-ONLY roster member Reviewer")
    // The suffix spelling resolves to the same member, as it always has.
    expect(decide("write", { host: { role: "teammate", name: "Reviewer-2" } })).toContain("READ-ONLY roster member Reviewer")
    expect(decide("write", { host: { role: "teammate", name: "Deep Worker" } })).toBeUndefined()
    expect(decide("write", { host: { role: "lead", name: "Reviewer" } })).toBeUndefined()
    // A tool outside the deny list never reaches an identity source at all.
    expect(decide("read", { host: { role: "teammate", name: "Reviewer" } })).toBeUndefined()
  })
})

describe("rc.2 defence in depth: the RECORD answers when the host roster is silent", () => {
  test("a recorded read-only teammate is denied; a recorded worker and the Lead pass", () => {
    expect(decide("bash", { record: { role: "teammate", name: "Explorer" } })).toContain("READ-ONLY roster member Explorer")
    expect(decide("bash", { record: { role: "teammate", name: "Senior Engineer" } })).toBeUndefined()
    expect(decide("bash", { record: { role: "lead", name: "captain" } })).toBeUndefined()
  })

  test("the HOST answer outranks the record (precedence, never a veto)", () => {
    // A host that says "worker" wins even if a stale record still calls the agent read-only.
    expect(decide("write", { host: { role: "teammate", name: "Deep Worker" }, record: { role: "teammate", name: "Reviewer" } })).toBeUndefined()
    // A host that says "read-only" wins even when the record is silent.
    expect(decide("write", { host: { role: "teammate", name: "Reviewer" } })).toBeDefined()
  })
})

describe("DEFAULT-TO-DENY: the session title is the last resort", () => {
  test("an unidentified caller whose TITLE names a read-only member is denied", () => {
    // This is the arm A1 item 1 calls HIGH: nothing else can identify the agent, and letting it
    // through would silently widen a read-only teammate.
    expect(decide("edit", { title: "Reviewer" })).toContain("READ-ONLY roster member Reviewer")
  })

  test("no source and a worker/absent title pass through — the bound, stated", () => {
    // A blanket deny here would deny the Lead, every worker member and every ordinary subagent, so
    // the conservative arm is scoped to a title that IS a read-only roster name.
    expect(decide("edit", { title: "Deep Worker" })).toBeUndefined()
    expect(decide("edit", {})).toBeUndefined()
  })

  test("a THROWING record source is a miss, never an outage", () => {
    /** The guard's decision when the record read explodes. */
    const denied = readonlyGuardDecision(execOf("write"), {
      deny: DENY,
      readonlyKeys: READONLY,
      membershipOf: () => undefined,
      recordMemberOf: () => { throw new Error("record exploded") },
    })
    expect(denied).toBeUndefined()
  })
})

describe("teamRecordMemberOf: the record identity resolver", () => {
  /** One team record with a lead and one member. */
  const RECORD = {
    leadSessionId: "session-lead",
    leadHistory: ["session-lead-old"],
    members: [{ name: "Reviewer", executorRef: "session-member" }],
  }

  /**
   * Build the resolver over a canned service.
   * @param records what `mpdTeams.list(workspace)` answers, or a thrower.
   * @returns the resolver the guard's option is bound to.
   */
  function resolverOver(records: unknown): (agent: unknown, exec: unknown) => { role?: string; name?: string } | undefined {
    /** The fake cordis context: only the `mpdTeams` read is consulted. */
    const ctx = {
      get: (name: string) => (name === "mpdTeams" ? { list: () => records } : undefined),
    }
    /** The adapter slice: a fixed workspace root. */
    const dsh = { workspaceRoot: () => "/workspace" }
    return teamRecordMemberOf(ctx, dsh as never)
  }

  test("the Lead (including a fork/resume id) and a member resolve; an unknown session does not", () => {
    /** The resolver over one live record. */
    const resolve = resolverOver([RECORD])
    expect(resolve({ session: { id: "session-lead" } }, {})).toEqual({ role: "lead" })
    expect(resolve({ session: { id: "session-lead-old" } }, {})).toEqual({ role: "lead" })
    expect(resolve({ session: { id: "session-member" } }, {})).toEqual({ role: "teammate", name: "Reviewer" })
    expect(resolve({ session: { id: "stranger" } }, {})).toBeUndefined()
    expect(resolve({ session: { id: "" } }, {})).toBeUndefined()
  })

  test("no service, a non-array answer and a throwing read are all misses", () => {
    expect(teamRecordMemberOf({ get: () => undefined }, { workspaceRoot: () => "/w" } as never)({ session: { id: "s" } }, {})).toBeUndefined()
    expect(resolverOver("not-an-array")({ session: { id: "session-member" } }, {})).toBeUndefined()
    /** The resolver over a service whose read throws. */
    const throwing = teamRecordMemberOf({ get: () => ({ list: () => { throw new Error("boom") } }) }, { workspaceRoot: () => "/w" } as never)
    expect(throwing({ session: { id: "session-member" } }, {})).toBeUndefined()
  })
})
