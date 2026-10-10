// THE DELEGATION GATE'S OWN ARMS (contract `.mpd/plans/delegation-gate.md`, D1/R1).
//
// WHAT THESE LOCK OUT: the harness's generic spawn tools (`subagent`, `subagent_fork`, `workflow`) being
// reachable as a free escape from §5 rule 2's sanctioned delegation surfaces. The decision is driven
// through its REAL exported function (`delegationGateDecision`) and, for the install arms, through the
// callback the row really hands the adapter — so what is asserted is the shipped decision, never a
// re-implementation of it.
//
// THE CLASSIFICATION IS REUSED, NOT RE-DERIVED: the `rank` these arms pass is exactly what `sessionRank`
// answers (§5's captain predicate, including the seeded-fork repair), which is why the agent doubles
// below carry real session headers rather than a rank string.
import { describe, expect, test } from "bun:test"

import {
  DEFAULT_DELEGATION_GATE_MODE,
  DELEGATION_CONFIG_KEY,
  DELEGATION_TOOLS,
  delegationGateDecision,
  delegationRefusal,
  installDelegationGate,
  resolveDelegationGateMode,
} from "../src/delegation-gate.ts"
import type { DelegationGateMode } from "../src/delegation-gate.ts"
import { sessionRank } from "../src/complexity-gate.ts"
import type { SessionRank } from "../src/complexity-gate.ts"
import type { DshAdapter } from "../../mpd-dsh-adapter-plugin/src/index"

/**
 * One agent double: a session header exactly as the arm spells it, so `sessionRank` decides the class.
 *
 * @param header - the session header fields under test.
 * @returns the agent double.
 */
function agentDouble(header: Record<string, unknown>): Record<string, unknown> {
  return { id: "delegation-arm", session: { id: "delegation-arm", header } }
}

/** The workspace's TOP-LEVEL session: §5's captain, preset ignored. */
const CAPTAIN = agentDouble({ agentPreset: "cordis", delegationDepth: 0 })

/** The USER'S REAL SESSION SHAPE (F0): a seeded fork — parent link, depth 0, no subagent origin. */
const SEEDED_FORK = agentDouble({ agentPreset: "cordis", parentSession: "seed-root", isSeeded: true, delegationDepth: 0 })

/** A member/child session: the harness recorded the subagent origin. */
const CHILD = agentDouble({ agentPreset: "mpd", origin: "subagent", parentSession: "parent-session", delegationDepth: 1 })

/** A session whose header the harness never recorded: never a free pass. */
const HEADERLESS = { id: "no-session" }

/**
 * Run one call through the real decision.
 *
 * @param toolName - the tool being dispatched.
 * @param mode - the mode in force.
 * @param agent - the calling agent double.
 * @returns the refusal the guard would hand the harness, or `undefined` when the call is allowed.
 */
function decide(toolName: string, mode: DelegationGateMode, agent: unknown): string | undefined {
  return delegationGateDecision({ toolName, mode, rank: sessionRank(agent) })
}

/** One tool the gate does not own, used to prove the pass-through. */
const BYSTANDER = "read"

describe("D1 — the decision table: mode × session class × tool", () => {
  test("the deny default refuses all three spawn tools for the captain, a child AND a headerless session", () => {
    for (const tool of DELEGATION_TOOLS) {
      for (const agent of [CAPTAIN, SEEDED_FORK, CHILD, HEADERLESS]) {
        expect(String(decide(tool, "deny", agent) ?? "")).toContain("delegation gate")
      }
    }
    // The canonical list is exactly the three official spawn tools.
    expect([...DELEGATION_TOOLS]).toEqual(["subagent", "subagent_fork", "workflow"])
    expect(DEFAULT_DELEGATION_GATE_MODE).toBe("deny")
  })

  test("the captain mode refuses the top-level session ONLY — the seeded fork included", () => {
    for (const tool of DELEGATION_TOOLS) {
      expect(String(decide(tool, "captain", CAPTAIN) ?? "")).toContain("delegation gate")
      // The F0 case: a seeded fork IS the captain, so `captain` mode binds it too.
      expect(String(decide(tool, "captain", SEEDED_FORK) ?? "")).toContain("delegation gate")
      // A member child is NOT the captain: the gate releases it under this mode.
      expect(decide(tool, "captain", CHILD)).toBeUndefined()
      expect(decide(tool, "captain", HEADERLESS)).toBeUndefined()
    }
  })

  test("the allow mode releases every session, and any other tool is somebody else's rule", () => {
    for (const tool of DELEGATION_TOOLS) {
      for (const agent of [CAPTAIN, SEEDED_FORK, CHILD, HEADERLESS]) {
        expect(decide(tool, "allow", agent)).toBeUndefined()
      }
    }
    for (const mode of ["deny", "captain", "allow"] as const) {
      for (const agent of [CAPTAIN, SEEDED_FORK, CHILD, HEADERLESS]) {
        expect(decide(BYSTANDER, mode, agent)).toBeUndefined()
      }
    }
  })

  test("the whole 3×3 table, cell by cell: every mode covers exactly one set of ranks", () => {
    /** The truth table: per mode, each rank's expected verdict — REFUSE (`true`) or release (`false`). */
    const table: ReadonlyArray<readonly [DelegationGateMode, ReadonlyArray<readonly [SessionRank, boolean]>]> = [
      ["deny", [["captain", true], ["child", true], ["headerless", true]]],
      ["captain", [["captain", true], ["child", false], ["headerless", false]]],
      ["allow", [["captain", false], ["child", false], ["headerless", false]]],
    ]
    /** One agent double per rank key, so each cell is driven through the REAL classification. */
    const byRank: Readonly<Record<SessionRank, unknown>> = { captain: CAPTAIN, child: CHILD, headerless: HEADERLESS }
    for (const [mode, rows] of table) {
      for (const [rank, refused] of rows) {
        /** The double this cell is about; the rank assertion below proves the key is honest. */
        const agent = byRank[rank]
        expect(sessionRank(agent)).toBe(rank)
        for (const tool of DELEGATION_TOOLS) {
          /** This cell's real decision, from the shipped function. */
          const decision = decide(tool, mode, agent)
          if (refused) expect(String(decision ?? "")).toContain("delegation gate")
          else expect(decision).toBeUndefined()
        }
      }
    }
  })

  test("an unexpected tool name is a pass-through, never a throw", () => {
    expect(delegationGateDecision({ toolName: "", mode: "deny", rank: "captain" })).toBeUndefined()
    expect(delegationGateDecision({ toolName: "subagent_extra", mode: "deny", rank: "captain" })).toBeUndefined()
  })
})

describe("D1 — the refusal sentence steers to the sanctioned paths", () => {
  test("the refusal names the three sanctioned routes, the knob and its two modes", () => {
    /** The refusal for one covered tool, asserted clause by clause. */
    const refusal = String(decide("subagent", "deny", CAPTAIN) ?? "")
    expect(refusal).toContain("`subagent` is refused")
    expect(refusal).toContain("mpd_role_spawn")
    expect(refusal).toContain("mpd_workmate_match")
    expect(refusal).toContain("mpd_workmate_spawn")
    expect(refusal).toContain("agent_teams_plan")
    expect(refusal).toContain("mpd_role_persona")
    expect(refusal).toContain("send_message")
    expect(refusal).toContain("The gate covers the captain and every member session")
    expect(refusal).toContain("delegation.gate")
    expect(refusal).toContain("\"captain\" limits it to the top-level session")
    expect(refusal).toContain("\"allow\" releases it entirely")
    // The refusal is a function of the tool name alone, so the same tool always reads the same sentence.
    expect(delegationRefusal("workflow")).toContain("`workflow` is refused")
  })
})

describe("D1 — resolveDelegationGateMode is fail-closed", () => {
  test("only the two exact spellings are honoured", () => {
    expect(resolveDelegationGateMode("captain")).toBe("captain")
    expect(resolveDelegationGateMode("allow")).toBe("allow")
    expect(resolveDelegationGateMode("deny")).toBe("deny")
    // A typo, a near-miss, a wrong type or an absent key all read as the fail-closed default.
    for (const raw of ["ALLOW", "Allow", "allow ", "deny!", "", "yes", true, 1, null, undefined, {}, ["allow"]]) {
      expect(resolveDelegationGateMode(raw)).toBe("deny")
    }
  })
})

describe("D1 — the install reaches the seam and reports its mode", () => {
  /**
   * One adapter double whose `guardTool` records the callback the row really installs.
   *
   * @param guardSeam - whether the harness reports the `tools.guard` capability.
   * @param config - the config values the row's reader answers.
   * @returns the adapter double plus the recorded callback and warnings.
   */
  function adapterDouble(guardSeam: boolean, config: Record<string, unknown>): {
    dsh: Pick<DshAdapter, "capabilities" | "guardTool">
    guards: ((exec: unknown) => string | undefined)[]
    warnings: string[]
  } {
    /** Every guard the row handed the fake registry. */
    const guards: ((exec: unknown) => string | undefined)[] = []
    /** Every warning the row reported. */
    const warnings: string[] = []
    return {
      // The double carries ONLY the two seams the install touches; the cast is the established pattern
      // for a partial adapter (captain-investigation.test.ts), because `capabilities()` is a wide record.
      dsh: {
        capabilities: () => ({ toolsGuard: guardSeam }),
        guardTool: (guard: (exec: unknown) => string | undefined): (() => void) => {
          guards.push(guard)
          return () => {}
        },
      } as unknown as Pick<DshAdapter, "capabilities" | "guardTool">,
      guards,
      warnings,
    }
  }

  test("with the seam present the guard denies a covered tool and follows the knob", () => {
    /** The config the row reads through its existing plumbing. */
    const config: Record<string, unknown> = { [DELEGATION_CONFIG_KEY]: "deny" }
    /** The adapter double, its recorded guards and warnings. */
    const { dsh, guards, warnings } = adapterDouble(true, config)
    /** The install outcome the boot line reports. */
    const install = installDelegationGate(dsh, { configValue: (key) => config[key], warn: (line) => warnings.push(line) })
    expect(install.installed).toBe(true)
    expect(install.mode).toBe("deny")
    expect(guards).toHaveLength(1)
    // The callback the ROW installed decides on the agent handle it is given — the real wiring.
    expect(String(guards[0]?.({ name: "subagent", agent: CAPTAIN }) ?? "")).toContain("delegation gate")
    expect(guards[0]?.({ name: "read", agent: CAPTAIN })).toBeUndefined()
    // The knob is read PER CALL, so a live `mpd.jsonc` edit takes effect without a restart.
    config[DELEGATION_CONFIG_KEY] = "allow"
    expect(guards[0]?.({ name: "subagent", agent: CAPTAIN })).toBeUndefined()
    expect(warnings).toEqual([])
  })

  test("a headerless or throwing call is a pass-through — a guard never takes a tool call down", () => {
    /** The adapter double for the failure shapes. */
    const { dsh, guards } = adapterDouble(true, {})
    installDelegationGate(dsh, { configValue: () => "deny", warn: () => {} })
    // No agent at all: `sessionRank` answers `headerless`, which the deny mode still refuses.
    expect(String(guards[0]?.({ name: "workflow", agent: undefined }) ?? "")).toContain("delegation gate")
    // An execution whose own shape throws must not throw out of the guard: the `name` read below is
    // the one the callback performs first, and it must degrade to a pass-through rather than an outage.
    /** A proxy whose every property read throws, i.e. the unreadable execution shape. */
    const unreadable = new Proxy({}, { get: (): never => { throw new Error("unreadable") } })
    expect(guards[0]?.(unreadable)).toBeUndefined()
  })

  test("a composition without the guard seam reports the absence instead of installing nothing silently", () => {
    /** The adapter double without the seam. */
    const { dsh, guards, warnings } = adapterDouble(false, {})
    /** The install outcome, which the boot line turns into `delegationGate=absent`. */
    const install = installDelegationGate(dsh, { configValue: () => "captain", warn: (line) => warnings.push(line) })
    expect(install.installed).toBe(false)
    expect(install.reason).toBe("no-guard-seam")
    // The mode is still REPORTED, so the boot line says which mode the composition failed to enforce.
    expect(install.mode).toBe("captain")
    expect(guards).toHaveLength(0)
    expect(warnings.join("\n")).toContain("no tools.guard seam")
    // The warn text names the knob, so an operator knows what the missing seam left unenforced.
    expect(warnings.join("\n")).toContain("delegation.gate")
  })

  test("a throwing guard seam is reported as an install failure, not an abort", () => {
    /** An adapter whose `guardTool` rejects the registration. */
    const dsh = {
      capabilities: () => ({ toolsGuard: true }),
      guardTool: (): (() => void) => { throw new Error("registry closed") },
    } as unknown as Pick<DshAdapter, "capabilities" | "guardTool">
    /** The warnings the failed install reported. */
    const warnings: string[] = []
    /** The install outcome of a registry that refuses the registration. */
    const install = installDelegationGate(dsh, { configValue: () => "deny", warn: (line: string): number => warnings.push(line) })
    expect(install.installed).toBe(false)
    expect(install.reason).toBe("install-failed")
    expect(warnings.join("\n")).toContain("registry closed")
  })
})
