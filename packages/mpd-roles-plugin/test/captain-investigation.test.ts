// THE CAPTAIN INVESTIGATION GUARD'S OWN ARMS (contract `.mpd/plans/lane-l-captain-investigation.md`, L1).
//
// WHAT THESE LOCK OUT: a top-level session spending its context on reconnaissance. The decision is driven
// through its REAL exported function (`captainInvestigationDecision`) and, for the install arm, through
// the callback the row really hands the adapter — so what is asserted is the shipped decision, never a
// re-implementation of it.
//
// THE CLASSIFICATION IS REUSED, NOT RE-DERIVED: the `topLevel` flag these arms pass is exactly what
// `sessionIsMpdCaptain` answers (the `mpd` preset's top-level session — §5's captain predicate AND the
// preset that owns this rule), which is why the agent doubles below carry real session headers rather
// than a boolean.
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
import { sessionIsMpdCaptain } from "../src/complexity-gate.ts"
import { readTargetPath } from "../../mpd-verify-plugin/src/law.ts"
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

/** The workspace's TOP-LEVEL session OF THE `mpd` PRESET: the one session this rule is scoped to. */
const CAPTAIN = agentDouble({ agentPreset: "mpd", delegationDepth: 0 })

/** A top-level session of ANOTHER preset (`cordis` is the deployment default): NOT gated by this rule. */
const OTHER_PRESET_CAPTAIN = agentDouble({ agentPreset: "cordis", delegationDepth: 0 })

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
    topLevel: sessionIsMpdCaptain(agent),
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

  test("the root instruction/overview files are allowed, and the instruction basenames at any depth", () => {
    for (const name of CAPTAIN_READABLE_ROOT_FILES) expect(readByCaptain(name)).toBeUndefined()
    expect(readByCaptain("LICENSE.md")).toBeUndefined()
    expect(readByCaptain("LICENSE-NOTICES.md")).toBeUndefined()
    // AN INSTRUCTION FILE ANYWHERE IS THE BAND (C4, D14): a nested AGENT.md/AGENTS.md/CLAUDE.md is readable;
    // a nested README.md is NOT.
    expect(readByCaptain("packages/x/AGENTS.md")).toBeUndefined()
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

  test("a TOP-LEVEL session of ANOTHER preset keeps its reconnaissance — the rule is scoped to `mpd`", () => {
    // The deployment's default preset is `cordis`, and the user's own working session runs it. This rule
    // is part of what the `mpd` preset MEANS, so it must not follow a session that never asked for it.
    expect(decide("read", { file_path: "packages/x/src/y.ts" }, OTHER_PRESET_CAPTAIN)).toBeUndefined()
    expect(decide("grep", { pattern: "x", path: "packages/x/src" }, OTHER_PRESET_CAPTAIN)).toBeUndefined()
    expect(decide("glob", { pattern: "**/*.ts" }, OTHER_PRESET_CAPTAIN)).toBeUndefined()
    // The SAME call IS refused for the `mpd` captain, so the arm above is not vacuous.
    expect(String(decide("read", { file_path: "packages/x/src/y.ts" }, CAPTAIN) ?? "")).toContain("captain investigation rule")
    // The predicate itself, in both directions.
    expect(sessionIsMpdCaptain(CAPTAIN)).toBe(true)
    expect(sessionIsMpdCaptain(OTHER_PRESET_CAPTAIN)).toBe(false)
    expect(sessionIsMpdCaptain(MEMBER)).toBe(false)
  })

  test("the rule still touches no WRITE tool and no bash — those have their own guards", () => {
    expect(decide("bash", { command: "cat packages/x/src/y.ts" }, CAPTAIN)).toBeUndefined()
    expect(decide("write", { file_path: "packages/x/src/y.ts" }, CAPTAIN)).toBeUndefined()
    expect(decide("edit", { file_path: "packages/x/src/y.ts" }, CAPTAIN)).toBeUndefined()
    expect(decide("", { file_path: "packages/x/src/y.ts" }, CAPTAIN)).toBeUndefined()
    // AN EXTERNAL CORPUS IS NOT WORKSPACE SOURCE (contract §2): the GitHub code search and the library
    // docs stay open, so a name absent from the list is genuinely released.
    expect(decide("mcp__grep_app__searchGitHub", { query: "readTargetPath", path: "src/a.ts" }, CAPTAIN)).toBeUndefined()
    expect(decide("mcp__context7__query-docs", { libraryId: "/org/project", query: "guards" }, CAPTAIN)).toBeUndefined()
  })
})

// THE CAPTAIN RECON FENCE, wave 2 (§3 C2, §4 B2): the tool doors wave 1 left open. Every arm drives the
// SHIPPED decision, so what is asserted is the registered behaviour, never a re-implementation.
describe("C2 — every source-returning tool is judged by the SAME path classifier", () => {
  test("mpd_hashline_read is a full-file reader and is refused on a source path, allowed on the band", () => {
    expect(String(decide("mpd_hashline_read", { path: "packages/x/src/y.ts" }, CAPTAIN) ?? "")).toContain("captain investigation rule")
    expect(decide("mpd_hashline_read", { path: "docs/a.md" }, CAPTAIN)).toBeUndefined()
    // The `./` spelling and the absolute spelling of the band are the SAME band (one classifier).
    expect(decide("mpd_hashline_read", { path: "./agent-references/glossary.md" }, CAPTAIN)).toBeUndefined()
    expect(decide("mpd_hashline_read", { path: WORKSPACE + "/docs/a.md" }, CAPTAIN)).toBeUndefined()
  })

  test("codegraph_explore has NO path argument, so the bare-call rule refuses it", () => {
    /** The denial a captain's code-graph query produces. */
    const denial = String(decide("mcp__codegraph__codegraph_explore", { query: "how does the guard work" }, CAPTAIN) ?? "")
    expect(denial).toContain("captain investigation rule")
    // The BARE-CALL reason, not a path judgement: this tool is refused for having nothing to judge.
    expect(denial).toContain("no path argument")
    // A bare call (no arguments at all) is refused by the same rule, so the door has no other spelling.
    expect(String(decide("mcp__codegraph__codegraph_explore", undefined, CAPTAIN) ?? "")).toContain("no path argument")
    // The mode still restores it, for the ONE documented route out.
    expect(decide("mcp__codegraph__codegraph_explore", { query: "x" }, MEMBER)).toBeUndefined()
  })

  test("ast_grep_search judges EVERY paths entry, in either order (T8 repair)", () => {
    // ONE SOURCE ENTRY IS REFUSED, whatever its position: order must not matter.
    expect(String(decide("mcp__ast_grep__search", { pattern: "x", language: "typescript", paths: ["packages/x/src"] }, CAPTAIN) ?? ""))
      .toContain("captain investigation rule")
    // THE BYPASS THIS REPAIR CLOSES: a permitted FIRST entry must not release a source entry behind it.
    /** The denial for a list whose source entry sits SECOND. */
    const sourceSecond = String(decide("mcp__ast_grep__search", { pattern: "x", language: "typescript", paths: ["docs/", "packages/x.ts"] }, CAPTAIN) ?? "")
    expect(sourceSecond).toContain("captain investigation rule")
    // The sentence NAMES THE OFFENDING ELEMENT, not element zero.
    expect(sourceSecond).toContain('on "packages/x.ts" is refused')
    /** The same pair, source entry FIRST — refused by the same rule, no ordering special case. */
    const sourceFirst = String(decide("mcp__ast_grep__search", { pattern: "x", language: "typescript", paths: ["packages/x.ts", "docs/"] }, CAPTAIN) ?? "")
    expect(sourceFirst).toContain("captain investigation rule")
    expect(sourceFirst).toContain('on "packages/x.ts" is refused')
    // EVERY entry inside the band is ALLOWED (the docs arm is unreachable without the list-aware reader).
    expect(decide("mcp__ast_grep__search", { pattern: "x", language: "typescript", paths: ["docs/", "agent-references/"] }, CAPTAIN)).toBeUndefined()
    expect(decide("mcp__ast_grep__search", { pattern: "x", language: "markdown", paths: ["docs"] }, CAPTAIN)).toBeUndefined()
    // FAIL-CLOSED with nothing to judge: an empty list, a non-string list, and an absent `paths`.
    expect(String(decide("mcp__ast_grep__search", { pattern: "x", language: "typescript", paths: [] }, CAPTAIN) ?? "")).toContain("no path argument")
    expect(String(decide("mcp__ast_grep__search", { pattern: "x", language: "typescript", paths: [123] }, CAPTAIN) ?? "")).toContain("no path argument")
    expect(String(decide("mcp__ast_grep__search", { pattern: "x", language: "typescript" }, CAPTAIN) ?? "")).toContain("no path argument")
    // ANY ELEMENT THAT IS NOT A NON-EMPTY STRING REFUSES THE WHOLE CALL (F5): it is never filtered out, so
    // a malformed element cannot ride beside a permitted one and turn into a docs-only search.
    /** The denial a list carrying a NUMBER after a permitted entry produces. */
    const nonStringLast = String(decide("mcp__ast_grep__search", { pattern: "x", language: "typescript", paths: ["docs/", 42] }, CAPTAIN) ?? "")
    expect(nonStringLast).toContain("captain investigation rule")
    expect(nonStringLast).toContain("not a non-empty string: 42")
    // ORDER DOES NOT MATTER: the same malformed element FIRST is refused by the same sentence.
    expect(String(decide("mcp__ast_grep__search", { pattern: "x", language: "typescript", paths: [42, "docs/"] }, CAPTAIN) ?? ""))
      .toContain("not a non-empty string: 42")
    // `null` and the EMPTY STRING are the same refused shape, never an ignorable element.
    expect(String(decide("mcp__ast_grep__search", { pattern: "x", language: "typescript", paths: ["docs/", null] }, CAPTAIN) ?? ""))
      .toContain("not a non-empty string: null")
    expect(String(decide("mcp__ast_grep__search", { pattern: "x", language: "typescript", paths: ["docs/", ""] }, CAPTAIN) ?? ""))
      .toContain('not a non-empty string: ""')
  })

  test("the SHARED reader still resolves paths[0] for both ast-grep tools — the precedence regression guard", () => {
    // `readTargetPath` in the verify package is the shared reader for ast-grep's single-path calls; its
    // contract is deliberately UNCHANGED by the T8 repair (the rewrite reads it, and it is a write tool).
    // The guard's own ast-grep decision does NOT go through it any more — see the arm above, which is why a
    // list whose FIRST entry is permitted can no longer read a source entry behind it.
    expect(readTargetPath("mcp__ast_grep__rewrite", { paths: ["packages/x.ts", "docs/a.md"] })).toBe("packages/x.ts")
    expect(readTargetPath("mcp__ast_grep__search", { paths: ["packages/x.ts", "docs/a.md"] })).toBe("packages/x.ts")
    expect(readTargetPath("mcp__ast_grep__search", { paths: ["docs/a.md"] })).toBe("docs/a.md")
    // The single-spelling tools still resolve through PATH_ARG_KEYS in the order that was frozen before:
    // `file_path` wins over `path` whatever a caller spells.
    expect(readTargetPath("read", { file_path: "a.ts", path: "b.ts" })).toBe("a.ts")
    expect(readTargetPath("grep", { path: "docs" })).toBe("docs")
    expect(readTargetPath("mcp__lsp__get_hover", { file_path: "x.ts" })).toBe("x.ts")
    // An absent or empty list resolves to nothing, which the guard then refuses as a bare call.
    expect(readTargetPath("mcp__ast_grep__search", {})).toBeUndefined()
    expect(readTargetPath("mcp__ast_grep__search", { paths: [] })).toBeUndefined()
  })

  test("the LSP readers are judged by file_path, and they keep the band open", () => {
    /** Every LSP reader the fence names whose harness schema carries a `file_path` to judge. */
    const readers: readonly string[] = [
      "mcp__lsp__find_definition",
      "mcp__lsp__get_hover",
      "mcp__lsp__find_references",
      "mcp__lsp__get_diagnostics",
      "mcp__lsp__find_implementation",
      "mcp__lsp__prepare_call_hierarchy",
      "mcp__lsp__get_incoming_calls",
      "mcp__lsp__get_outgoing_calls",
    ]
    for (const tool of readers) {
      expect(String(decide(tool, { file_path: "packages/x/src/y.ts", line: 3, character: 2, symbol_name: "apply" }, CAPTAIN) ?? ""))
        .toContain("captain investigation rule")
      expect(decide(tool, { file_path: "docs/a.md", line: 3, character: 2, symbol_name: "apply" }, CAPTAIN)).toBeUndefined()
    }
    // `find_workspace_symbols` carries ONLY a `query` — no path to judge — so the bare-call rule is its
    // door: a workspace-wide symbol lookup is the same act as a workspace-wide grep.
    expect(String(decide("mcp__lsp__find_workspace_symbols", { query: "readTargetPath" }, CAPTAIN) ?? ""))
      .toContain("no path argument")
  })

  test("the new doors leave a member, another preset and a non-listed tool untouched", () => {
    // A child session is exactly who the captain hands this work to.
    expect(decide("mpd_hashline_read", { path: "packages/x/src/y.ts" }, MEMBER)).toBeUndefined()
    expect(decide("mcp__ast_grep__search", { pattern: "x", language: "typescript", paths: ["packages/x"] }, MEMBER)).toBeUndefined()
    expect(decide("mcp__lsp__find_definition", { file_path: "packages/x/src/y.ts" }, MEMBER)).toBeUndefined()
    // The rule is part of what the `mpd` preset MEANS: another preset's top level keeps its recon.
    expect(decide("mpd_hashline_read", { path: "packages/x/src/y.ts" }, OTHER_PRESET_CAPTAIN)).toBeUndefined()
    expect(decide("mcp__lsp__get_diagnostics", { file_path: "packages/x/src/y.ts" }, OTHER_PRESET_CAPTAIN)).toBeUndefined()
  })

  test("mode `allow` releases the new doors too, so the knob covers the WHOLE guard", () => {
    expect(captainInvestigationDecision({
      toolName: "mpd_hashline_read",
      args: { path: "packages/x/src/y.ts" },
      workspaceRoot: WORKSPACE,
      topLevel: true,
      mode: "allow",
    })).toBeUndefined()
    expect(captainInvestigationDecision({
      toolName: "mcp__codegraph__codegraph_explore",
      args: { query: "x" },
      workspaceRoot: WORKSPACE,
      topLevel: true,
      mode: "allow",
    })).toBeUndefined()
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

  test("a throwing exec is PASSED THROUGH, never denied or thrown, and reported once", () => {
    /** Warnings the internal-error boundary must emit exactly once. */
    const warnings: string[] = []
    /** The callback the install hands the adapter. */
    let guard: ((exec: DshToolExec) => string | undefined) | undefined
    /** A minimal adapter double exposing the ONE seam under test. */
    const dsh = {
      capabilities: () => ({ toolsGuard: true }),
      guardTool: (installed: (exec: DshToolExec) => string | undefined): (() => void) => {
        guard = installed
        return () => { /* this arm asserts the callback, not disposal */ }
      },
    } as Pick<DshAdapter, "capabilities" | "guardTool">
    /** The install outcome under the deny mode. */
    const install = installCaptainInvestigationGuard(dsh, {
      workspaceRootOf: () => WORKSPACE,
      configValue: () => "deny",
      warn: (line) => warnings.push(line),
    })
    expect(install.installed).toBe(true)
    // A MALFORMED EXEC: every property read throws, which is what an unreadable exec/args proxy is here.
    const throwingExec = new Proxy({}, { get: () => { throw new Error("malformed exec") } }) as unknown as DshToolExec
    // F3: the guard must never throw out of its callback...
    expect(() => guard?.(throwingExec)).not.toThrow()
    // ...and never DENY an unrelated call for a reason of its own: the decision is a pass-through.
    expect(guard?.(throwingExec)).toBeUndefined()
    // ONE report across repeated failures, so a persistently malformed exec cannot flood the row log.
    expect(warnings.filter((line) => line.includes("internal error")).length).toBe(1)
    expect(guard?.(throwingExec)).toBeUndefined()
    expect(warnings.filter((line) => line.includes("internal error")).length).toBe(1)
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
