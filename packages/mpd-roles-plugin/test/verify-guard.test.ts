// FALSIFIERS FOR THE CAPTAIN TEST (contract `.mpd/plans/captain-test-fix.md`, clauses F1/F2/F5).
//
// THE DEFECT THESE ARMS LOCK OUT (T-92): the guard decided "is this the workspace's captain" with
// `sessionQualifies(agent, ["mpd"])`, a PRESET-keyed test. Every top-level session on this deployment
// records `agentPreset: "cordis"`, so the captain branch was unreachable and the user's own session was
// refused its git writes with a sentence claiming a fact the code never tested. The captain is the
// workspace's TOP-LEVEL session — a header, no parent session, delegation depth 0 — and these arms
// assert BOTH directions of that classification, preset ignored in both.
//
// The guard is driven through its real exported function (`verifyGuardDecision`) with a law double, so
// what is asserted is the decision the shipped hook makes, not a re-implementation of it.
import { describe, expect, test } from "bun:test"

import { sessionIsTopLevel, sessionQualifies, sessionRank } from "../src/complexity-gate.ts"
import { verifyGuardDecision } from "../src/verify-guard.ts"
import type { VerifyLawAccess } from "../src/verify-guard.ts"

/** The workspace root every arm resolves against; a string only, because classification never touches disk. */
const WORKSPACE = "/ws-captain-test"

/**
 * The law's runtime double for the guard: the two rules under test read only the loop list, the escape
 * count and the seat, so those answer the EMPTY case and the remaining methods are inert.
 *
 * @returns a law accessor whose workspace has no seat, no armed loop and no escape left.
 */
function lawDouble(): VerifyLawAccess {
  return {
    keyOf: () => "session-under-test",
    noteCall: () => { /* the arms assert decisions, not the observation log */ },
    escapeUses: () => 0,
    consumeEscape: () => false,
    countRead: () => { /* nothing in these arms is inside a diagnosis window */ },
    armedLoops: () => [],
    seatFor: () => undefined,
  }
}

/**
 * Run one call through the real guard decision, in `hard` mode, with the shared double.
 *
 * @param exec - the harness call shape under test: `name`, `arguments` and the `agent` double.
 * @returns the denial the guard would hand the harness, or `undefined` when the call is allowed.
 */
function decide(exec: Record<string, unknown>): string | undefined {
  return verifyGuardDecision(exec, {
    law: lawDouble(),
    mode: "hard",
    workspaceRoot: WORKSPACE,
    now: new Date(),
    warn: () => { /* the arms assert decisions, not warnings */ },
  })
}

/**
 * One agent double: an id, and a session header exactly as the arm spells it.
 *
 * @param header - the session header fields under test; `undefined` builds an agent with NO session.
 * @param id - the session id the law's key reader sees.
 * @returns the agent double.
 */
function agentDouble(header: Record<string, unknown> | undefined, id: string = "captain-session"): Record<string, unknown> {
  return header === undefined ? { id } : { id, session: { id, header } }
}

/** A `git commit` through the `bash` tool — the §5 write the one-git-writer rule covers. */
const GIT_WRITE: Record<string, unknown> = { name: "bash", arguments: { command: "git commit -m x" } }

/** A code write through the `write` tool — the call rule 4 (the captain's write rule) covers. */
const CODE_WRITE: Record<string, unknown> = { name: "write", arguments: { file_path: "packages/a/src/index.ts" } }

describe("F1 — sessionIsTopLevel: the workspace's top-level session, never a preset", () => {
  test("a header with no parent session and delegation depth 0 (or absent) IS top-level, whatever preset", () => {
    // THE MEASURED DEPLOYMENT: the user's own top-level session records `cordis`.
    expect(sessionIsTopLevel(agentDouble({ agentPreset: "cordis", delegationDepth: 0 }))).toBe(true)
    expect(sessionIsTopLevel(agentDouble({ agentPreset: "mpd", delegationDepth: 0 }))).toBe(true)
    // `delegationDepth` ABSENT is a top-level session too (a header the harness never recorded a depth for).
    expect(sessionIsTopLevel(agentDouble({ agentPreset: "cordis" }))).toBe(true)
    expect(sessionIsTopLevel(agentDouble({}))).toBe(true)
    // THE PRESET IS NOT CONSULTED: a name the gate would never cover is still the captain.
    expect(sessionIsTopLevel(agentDouble({ agentPreset: "anything-weird" }))).toBe(true)
    expect(sessionIsTopLevel(agentDouble({ agentPreset: undefined }))).toBe(true)
  })

  test("a parent session or a non-zero delegation depth is a CHILD, even under the `mpd` preset", () => {
    expect(sessionIsTopLevel(agentDouble({ parentSession: "parent-session" }))).toBe(false)
    expect(sessionIsTopLevel(agentDouble({ delegationDepth: 1 }))).toBe(false)
    expect(sessionIsTopLevel(agentDouble({ agentPreset: "mpd", delegationDepth: 1 }))).toBe(false)
    // BOTH marks at once, and the preset still does not rescue it.
    expect(sessionIsTopLevel(agentDouble({ agentPreset: "mpd", parentSession: "p", delegationDepth: 0 }))).toBe(false)
  })

  test("NO header is refused (fail-closed), and the class is reported", () => {
    expect(sessionIsTopLevel({ id: "no-session" })).toBe(false)
    expect(sessionIsTopLevel({ id: "empty-header", session: { header: undefined } })).toBe(false)
    expect(sessionIsTopLevel(undefined)).toBe(false)
    expect(sessionRank({ id: "no-session" })).toBe("headerless")
    expect(sessionRank(agentDouble({ delegationDepth: 2 }))).toBe("child")
    expect(sessionRank(agentDouble({ agentPreset: "cordis" }))).toBe("captain")
  })

  test("F3 — the session-start gate keeps its preset scope: it is NOT the captain test", () => {
    // UNCHANGED ON PURPOSE: whether the complexity gate should ALSO fire for a `cordis`-preset top-level
    // session is a separate question the captain puts to the user. This arm documents the split.
    expect(sessionQualifies(agentDouble({ agentPreset: "mpd" }))).toBe(true)
    expect(sessionQualifies(agentDouble({ agentPreset: "cordis" }))).toBe(false)
    // THE SPLIT, ON THE SAME DOUBLE: the gate says no, the captain test says yes.
    expect(sessionIsTopLevel(agentDouble({ agentPreset: "cordis" }))).toBe(true)
  })
})

describe("F2/F5 — the guard's two rules read that ONE predicate", () => {
  test("F5-1: a TOP-LEVEL `cordis` session may run a git write, and rule 4 still gates its code writes", () => {
    /** The user's own top-level session, as this deployment measures it. */
    const cordisCaptain = agentDouble({ cwd: WORKSPACE, agentPreset: "cordis", delegationDepth: 0 })
    // THE DEFECT, FIXED: §5 used to refuse this session its `git commit`.
    expect(decide({ ...GIT_WRITE, agent: cordisCaptain })).toBeUndefined()
    // READ-ONLY GIT was never the point, and still is not: the same caller stays open on it.
    expect(decide({ name: "bash", arguments: { command: "git status --short" }, agent: cordisCaptain })).toBeUndefined()
    // RULE 4 IS UNCHANGED: the captain's own code write is still refused (no loop, no escape, no delegation).
    expect(String(decide({ ...CODE_WRITE, agent: cordisCaptain }) ?? "")).toContain("verification law")
  })

  test("F5-2: a TOP-LEVEL `mpd` session is allowed the same git write — no regression for that deployment", () => {
    /** A top-level session that DOES carry the bundle's preset. */
    const mpdCaptain = agentDouble({ cwd: WORKSPACE, agentPreset: "mpd" })
    expect(decide({ ...GIT_WRITE, agent: mpdCaptain })).toBeUndefined()
    expect(String(decide({ ...CODE_WRITE, agent: mpdCaptain }) ?? "")).toContain("verification law")
  })

  test("F5-3: a CHILD session is STILL DENIED the git write under either preset — the rule survives", () => {
    /** A teammate/subagent of this workspace, carrying the bundle preset. */
    const mpdChild = agentDouble({ cwd: WORKSPACE, agentPreset: "mpd", parentSession: "captain-session" }, "member-mpd")
    /** The same shape of child, carrying this deployment's top-level preset. */
    const cordisChild = agentDouble({ cwd: WORKSPACE, agentPreset: "cordis", delegationDepth: 1 }, "member-cordis")
    expect(String(decide({ ...GIT_WRITE, agent: mpdChild }) ?? "")).toContain("one-git-writer rule")
    expect(String(decide({ ...GIT_WRITE, agent: cordisChild }) ?? "")).toContain("one-git-writer rule")
    // AND RULE 4 STILL LETS A MEMBER WRITE — a child session is exactly who the captain hands code to.
    expect(decide({ ...CODE_WRITE, agent: mpdChild })).toBeUndefined()
    expect(decide({ ...CODE_WRITE, agent: cordisChild })).toBeUndefined()
  })

  test("F5-4: a session with NO header is refused the git write (fail-closed)", () => {
    /** An agent the guard cannot classify at all. */
    const headerless = agentDouble(undefined, "unclassifiable-session")
    expect(String(decide({ ...GIT_WRITE, agent: headerless }) ?? "")).toContain("one-git-writer rule")
    // FAIL-CLOSED, and honest about WHICH case it is: the sentence does not call this session a member.
    expect(String(decide({ ...GIT_WRITE, agent: headerless }) ?? "")).toContain("no session header")
    expect(String(decide({ ...GIT_WRITE, agent: headerless }) ?? "")).not.toContain("member/child session")
  })

  test("F5-5: the denial states the class decided and names the route — with NO claim about top-levelness", () => {
    /** The denial a child session receives. */
    const childDenial = String(decide({ ...GIT_WRITE, agent: agentDouble({ agentPreset: "mpd", parentSession: "p" }) }) ?? "")
    expect(childDenial).toContain("member/child session of this workspace")
    expect(childDenial).toContain("parent session")
    // THE LEGITIMATE ROUTE, named: the user's own shell.
    expect(childDenial).toContain("user's OWN shell")
    // NEITHER SENTENCE ASSERTS TOP-LEVELNESS: the old one claimed the session was "NOT the workspace's
    // top-level captain" after testing only a preset name. This is the arm that locks the defect out.
    expect(childDenial).not.toContain("top-level")
    /** The denial the guard's captain-write rule produces for the top-level session. */
    const writeDenial = String(decide({ ...CODE_WRITE, agent: agentDouble({ agentPreset: "cordis" }) }) ?? "")
    expect(writeDenial).toContain("verification law")
    expect(writeDenial).not.toContain("top-level")
  })
})
