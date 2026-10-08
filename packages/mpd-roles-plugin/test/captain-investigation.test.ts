// THE CAPTAIN INVESTIGATION GUARD'S OWN ARMS (contract `.mpd/plans/lane-l-captain-investigation.md`, L1).
//
// WHAT THESE LOCK OUT: a top-level session spending its context on reconnaissance. The decision is driven
// through its REAL exported function (`captainInvestigationDecision`) and, for the install arm, through
// the callback the row really hands the adapter — so what is asserted is the shipped decision, never a
// re-implementation of it.
//
// THE CLASSIFICATION IS REUSED, NOT RE-DERIVED: the `topLevel` flag these arms pass is exactly what
// `sessionIsTopLevel` answers (§5's captain predicate, T-92), which is why the agent doubles below carry
// real session headers rather than a boolean.
import { describe, expect, test } from "bun:test"

import {
  CAPTAIN_READABLE_ROOT_FILES,
  DEFAULT_INVESTIGATION_MODE,
  INVESTIGATION_CONFIG_KEY,
  captainInvestigationDecision,
  captainReadablePath,
  installCaptainInvestigationGuard,
  resolveInvestigationMode,
} from "../src/captain-investigation.ts"
import type { CaptainInvestigationInput } from "../src/captain-investigation.ts"
import { sessionIsTopLevel } from "../src/complexity-gate.ts"
import type { DshAdapter, DshToolExec } from "../../mpd-dsh-adapter-plugin/src/index"

/** The workspace root every arm resolves against; classification never touches disk. */
const WORKSPACE = "/ws-captain-investigation"

/**
 * One agent double: a session header exactly as the arm spells it, so `sessionIsTopLevel` decides.
 *
 * @param header - the session header fields under test.
 * @param id - the session id the law's key reader would see.
 * @returns the agent double.
 */
function agentDouble(header: Record<string, unknown>, id: string = "captain-session"): Record<string, unknown> {
  return { id, session: { id, header } }
}

/** The workspace's TOP-LEVEL session: §5's captain, preset ignored. */
const CAPTAIN = agentDouble({ agentPreset: "cordis", delegationDepth: 0 })

/** A member/child session: it keeps `read`/`grep`/`glob`, because the captain hands it the work. */
const MEMBER = agentDouble({ agentPreset: "mpd", parentSession: "parent-session", delegationDepth: 1 })

/**
 * Run one call through the real decision, in the shipped default mode.
 *
 * @param toolName - the tool being dispatched.
 * @param args - the call's arguments, or `undefined` for a bare call.
 * @param agent - the calling agent double.
 * @returns the denial the guard would hand the harness, or `undefined` when the call is allowed.
 */
function decide(toolName: string, args: Record<string, unknown> | undefined, agent: Record<string, unknown>): string | undefined {
  return captainInvestigationDecision({
    toolName,
    args,
    workspaceRoot: WORKSPACE,
    topLevel: sessionIsTopLevel(agent),
    mode: DEFAULT_INVESTIGATION_MODE,
  })
}

/**
 * A `read` of one path by the captain, as the harness would dispatch it.
 *
 * @param path - the path the call names.
 * @returns the decision for that call.
 */
function readByCaptain(path: string): string | undefined {
  return decide("read", { file_path: path }, CAPTAIN)
}

describe("L1 — the decision function's behaviour table, path by path", () => {
  test("a SOURCE path is refused, and the sentence teaches the route", () => {
    /** The denial a captain's reconnaissance of the plugin sources produces. */
    const denial = String(readByCaptain("packages/x/src/y.ts") ?? "")
    expect(denial).toContain("captain investigation rule")
    // WHY, the way out and the band that stays open — the three clauses contract §2.3 requires.
    expect(denial).toContain("TOP-LEVEL session does not run reconnaissance")
    expect(denial).toContain("mpd_role_spawn")
    expect(denial).toContain("Explorer")
    expect(denial).toContain("Researcher")
    expect(denial).toContain("documentation band stays open")
  })

  test("the documentation band is allowed: .mpd/**, docs/**, evidence/**, agent-references/**", () => {
    expect(readByCaptain(".mpd/plans/p.md")).toBeUndefined()
    expect(readByCaptain("docs/a.md")).toBeUndefined()
    expect(readByCaptain("evidence/x/y.json")).toBeUndefined()
    expect(readByCaptain("agent-references/glossary.md")).toBeUndefined()
    // THE BAND DIRECTORY ITSELF, and the `./` spelling of a member, are the same band.
    expect(readByCaptain(".mpd")).toBeUndefined()
    expect(readByCaptain("./docs/a.md")).toBeUndefined()
  })

  test("the root instruction/overview files are allowed, and only at the root", () => {
    for (const name of CAPTAIN_READABLE_ROOT_FILES) expect(readByCaptain(name)).toBeUndefined()
    expect(readByCaptain("LICENSE.md")).toBeUndefined()
    expect(readByCaptain("LICENSE-NOTICES.md")).toBeUndefined()
    // A NESTED instruction file is NOT the band: spelling one inside a source tree reaches no source.
    expect(String(readByCaptain("packages/x/AGENTS.md") ?? "")).toContain("captain investigation rule")
    expect(String(readByCaptain("packages/x/README.md") ?? "")).toContain("captain investigation rule")
  })

  test("a call with NO usable path is refused (fail-closed), for every reconnaissance tool", () => {
    expect(String(decide("read", {}, CAPTAIN) ?? "")).toContain("no path argument")
    expect(String(decide("grep", { pattern: "sessionIsTopLevel" }, CAPTAIN) ?? "")).toContain("no path argument")
    expect(String(decide("glob", { pattern: "**/*.ts" }, CAPTAIN) ?? "")).toContain("no path argument")
    // The PATTERN's own directory prefix is NOT a substitute for a path (contract §2.2).
    expect(String(decide("glob", { pattern: "packages/**/*.ts" }, CAPTAIN) ?? "")).toContain("captain investigation rule")
  })

  test("grep/glob are judged by the SAME rule on their path argument", () => {
    expect(String(decide("grep", { pattern: "x", path: "packages/x/src" }, CAPTAIN))).toContain("captain investigation rule")
    expect(decide("grep", { pattern: "x", path: "docs" }, CAPTAIN)).toBeUndefined()
    expect(String(decide("glob", { pattern: "*.ts", path: "scripts" }, CAPTAIN))).toContain("captain investigation rule")
    expect(decide("glob", { pattern: "*.md", path: "agent-references" }, CAPTAIN)).toBeUndefined()
  })

  test("a path outside the workspace, or one spelled out of a band, is refused", () => {
    expect(String(readByCaptain("/etc/passwd") ?? "")).toContain("captain investigation rule")
    // NO PARENT HOPS: a spelling that starts inside a band and ends outside it never resolves.
    expect(String(readByCaptain("docs/../packages/x/src/y.ts") ?? "")).toContain("captain investigation rule")
    // A backslash spelling cannot smuggle a band past the test either.
    expect(String(readByCaptain("..\\packages\\x\\src\\y.ts") ?? "")).toContain("captain investigation rule")
    // An ABSOLUTE spelling of an allowed band is still the allowed band.
    expect(readByCaptain(WORKSPACE + "/docs/a.md")).toBeUndefined()
    expect(String(readByCaptain(WORKSPACE + "/packages/x/src/y.ts") ?? "")).toContain("captain investigation rule")
  })

  test("a NON-top-level session keeps reconnaissance — members, spawns and verifier seats", () => {
    expect(decide("read", { file_path: "packages/x/src/y.ts" }, MEMBER)).toBeUndefined()
    expect(decide("grep", { pattern: "x", path: "packages/x/src" }, MEMBER)).toBeUndefined()
    expect(decide("glob", { pattern: "**/*.ts" }, MEMBER)).toBeUndefined()
    // A session the guard cannot classify at all is NOT the captain either (fail-open for the rule:
    // only a positively-classified top-level session is restricted).
    expect(decide("read", { file_path: "packages/x/src/y.ts" }, { id: "headerless" })).toBeUndefined()
  })

  test("the rule touches NO tool but the three reconnaissance tools", () => {
    expect(decide("bash", { command: "cat packages/x/src/y.ts" }, CAPTAIN)).toBeUndefined()
    expect(decide("write", { file_path: "packages/x/src/y.ts" }, CAPTAIN)).toBeUndefined()
    expect(decide("edit", { file_path: "packages/x/src/y.ts" }, CAPTAIN)).toBeUndefined()
    expect(decide("", { file_path: "packages/x/src/y.ts" }, CAPTAIN)).toBeUndefined()
  })
})

describe("L1/L3 — the mode resolver and the mode's own arms", () => {
  test("only the exact spelling `allow` opts out; everything else is the fail-closed default", () => {
    expect(resolveInvestigationMode("allow")).toBe("allow")
    expect(resolveInvestigationMode("deny")).toBe("deny")
    expect(resolveInvestigationMode(undefined)).toBe("deny")
    expect(resolveInvestigationMode("ALLOW")).toBe("deny")
    expect(resolveInvestigationMode(true)).toBe("deny")
    expect(resolveInvestigationMode({ allow: true })).toBe("deny")
    expect(DEFAULT_INVESTIGATION_MODE).toBe("deny")
  })

  test("mode `allow` restores today's freedom exactly, for the captain on a source path", () => {
    /** The same call as the refused arm above, under the opt-out mode. */
    const input: CaptainInvestigationInput = {
      toolName: "read",
      args: { file_path: "packages/x/src/y.ts" },
      workspaceRoot: WORKSPACE,
      topLevel: true,
      mode: "allow",
    }
    expect(captainInvestigationDecision(input)).toBeUndefined()
  })

  test("the band test is total for a primitive path argument", () => {
    expect(captainReadablePath(WORKSPACE, "")).toBe(false)
    expect(captainReadablePath(WORKSPACE, ".")).toBe(false)
    expect(captainReadablePath("/", "docs/a.md")).toBe(true)
  })
})

describe("L2 — the INSTALL is the decision the arms above proved, with a reported mode", () => {
  test("the guard reaches the seam and the reported mode follows the knob", () => {
    /** The callback the install hands the adapter, plus the disposer it returns. */
    const capture: { guard?: (exec: DshToolExec) => string | undefined; disposed: boolean } = { disposed: false }
    /** A minimal adapter double: the capability probe and the ONE seam under test. */
    const dsh = {
      capabilities: () => ({ toolsGuard: true }),
      guardTool: (guard: (exec: DshToolExec) => string | undefined): (() => void) => {
        capture.guard = guard
        return () => { capture.disposed = true }
      },
    } as Pick<DshAdapter, "capabilities" | "guardTool">
    /** The config layer's answer for the knob, as the row's `configValue` would resolve it. */
    let raw: unknown = undefined
    /** The install outcome under the default (no knob) mode. */
    const install = installCaptainInvestigationGuard(dsh, {
      workspaceRootOf: () => WORKSPACE,
      configValue: (key: string) => (key === INVESTIGATION_CONFIG_KEY ? raw : undefined),
      warn: () => { /* the arms assert the install outcome, not its warnings */ },
    })
    expect(install.installed).toBe(true)
    expect(install.mode).toBe("deny")
    expect(typeof capture.guard).toBe("function")
    // THROUGH THE INSTALLED HOOK: the captain's source read is refused, its docs read is not, and a
    // member's source read is not — the same three facts the pure arms established, now on the wire.
    expect(String(capture.guard?.({ name: "read", arguments: { file_path: "packages/x/src/y.ts" }, agent: CAPTAIN }) ?? "")).toContain("captain investigation rule")
    expect(capture.guard?.({ name: "read", arguments: { file_path: "docs/a.md" }, agent: CAPTAIN })).toBeUndefined()
    expect(capture.guard?.({ name: "read", arguments: { file_path: "packages/x/src/y.ts" }, agent: MEMBER })).toBeUndefined()
    // THE KNOB, READ PER CALL: flipping it to `allow` changes the SAME hook, with no re-install.
    raw = "allow"
    expect(capture.guard?.({ name: "read", arguments: { file_path: "packages/x/src/y.ts" }, agent: CAPTAIN })).toBeUndefined()
  })

  test("a composition without the guard seam reports the absence instead of installing nothing silently", () => {
    /** The outcome for an adapter whose harness exposes no `tools.guard`. */
    const install = installCaptainInvestigationGuard({
      capabilities: () => ({ toolsGuard: false }),
      guardTool: () => { throw new Error("the seam must not be called") },
    } as unknown as Pick<DshAdapter, "capabilities" | "guardTool">, {
      workspaceRootOf: () => WORKSPACE,
      configValue: () => "deny",
      warn: () => { /* the reason field carries the outcome */ },
    })
    expect(install.installed).toBe(false)
    expect(install.reason).toBe("no-guard-seam")
    expect(install.mode).toBe("deny")
  })
})
