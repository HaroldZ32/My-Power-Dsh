// THE CAPTAIN SHELL GUARD'S OWN ARMS (contract `.mpd/plans/captain-self-test-fence.md` §3 C1, §4 A1).
//
// WHAT THESE LOCK OUT: a top-level `mpd` session spending its own turn on the verification commands that
// produce gate evidence. The decision is driven through its REAL exported function
// (`captainShellDecision`) and, for the install arm, through the callback the row really hands the
// adapter — so what is asserted is the shipped decision, never a re-implementation of it.
//
// THE CLASSIFICATION IS REUSED, NOT RE-DERIVED: the `topLevel` flag these arms pass is exactly what
// `sessionIsMpdCaptain` answers (the `mpd` preset's top-level session), which is why the agent doubles
// below carry real session headers rather than a boolean.
import { describe, expect, test } from "bun:test"

import {
  CAPTAIN_SHELL_DENY_PATTERNS,
  CAPTAIN_SHELL_TOOLS,
  DEFAULT_CAPTAIN_SHELL_MODE,
  captainShellDecision,
  captainShellSegments,
  installCaptainShellGuard,
  matchCaptainShellDeny,
  resolveCaptainShellMode,
} from "../src/captain-shell.ts"
import type { CaptainShellMode } from "../src/captain-shell.ts"
import { sessionIsMpdCaptain } from "../src/complexity-gate.ts"
import type { DshAdapter, DshToolExec } from "../../mpd-dsh-adapter-plugin/src/index"

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

/** A member/child session: it keeps its shell, because its parent hands it this very work. */
const MEMBER = agentDouble({ agentPreset: "mpd", parentSession: "parent-session", delegationDepth: 1 })

/**
 * Run one call through the real decision, in the shipped default mode unless an arm says otherwise.
 *
 * @param toolName - the tool being dispatched.
 * @param args - the call's arguments, or `undefined` for a bare call.
 * @param agent - the calling agent double.
 * @param mode - the mode in force; defaults to the fail-closed default.
 * @returns the refusal the guard would hand the harness, or `undefined` when the call is allowed.
 */
function decide(
  toolName: string,
  args: Record<string, unknown> | undefined,
  agent: Record<string, unknown>,
  mode: CaptainShellMode = DEFAULT_CAPTAIN_SHELL_MODE,
): string | undefined {
  return captainShellDecision({ toolName, args, topLevel: sessionIsMpdCaptain(agent), mode })
}

/**
 * A captain `bash` call running one command, as the harness would dispatch it.
 *
 * @param command - the command string the call carries.
 * @returns the decision for that call.
 */
function bashByCaptain(command: string): string | undefined {
  return decide("bash", { command }, CAPTAIN)
}

describe("A1 — mode, rank, tool name and argument shape", () => {
  test("the default mode is deny, and a captain's `bun test` is refused with the route out", () => {
    // The default is fail-closed: an ABSENT key reads as deny (contract §3 C1).
    expect(DEFAULT_CAPTAIN_SHELL_MODE).toBe("deny")
    /** The refusal a captain's test run produces. */
    const refusal = String(bashByCaptain("bun test") ?? "")
    expect(refusal).toContain("[mpd-roles] captain shell: REFUSED")
    // WHY, the way out and the configuration opt-out — the three clauses the contract requires.
    expect(refusal).toContain("is a verification command")
    expect(refusal).toContain("mpd_role_spawn")
    expect(refusal).toContain('role:"Reviewer"')
    expect(refusal).toContain("captain.shell:\"allow\"")
    // The gate-shaped clause names the second door this wave closes (C2).
    expect(refusal).toContain("mpd_verify_evidence {kind:\"gate\"}")
    expect(refusal.length).toBeLessThanOrEqual(600)
  })

  test("only the exact string `allow` turns the rule off", () => {
    expect(resolveCaptainShellMode("allow")).toBe("allow")
    for (const raw of [undefined, null, "deny", "Allow", "ALLOW", true, 1, "", {}]) {
      expect(resolveCaptainShellMode(raw)).toBe("deny")
    }
    expect(decide("bash", { command: "bun test" }, CAPTAIN, "allow")).toBeUndefined()
  })

  test("a CHILD session's `bun test` is allowed, and so is another preset's top-level session", () => {
    expect(decide("bash", { command: "bun test" }, MEMBER)).toBeUndefined()
    expect(decide("bash", { command: "bun test" }, OTHER_PRESET_CAPTAIN)).toBeUndefined()
  })

  test("a non-shell tool passes through even when its arguments carry a `command`", () => {
    expect(decide("write", { command: "bun test" }, CAPTAIN)).toBeUndefined()
    expect(decide("mpd_verify_evidence", { command: "bun test" }, CAPTAIN)).toBeUndefined()
    expect(CAPTAIN_SHELL_TOOLS).toEqual(["bash", "powershell", "pwsh"])
  })

  test("the two PowerShell spellings are gated like bash", () => {
    expect(decide("powershell", { command: "bun test" }, CAPTAIN)).toBeDefined()
    expect(decide("pwsh", { command: "node scripts/verify-dist-fresh.ts" }, CAPTAIN)).toBeDefined()
  })

  test("a missing or non-string command passes through untouched", () => {
    expect(decide("bash", {}, CAPTAIN)).toBeUndefined()
    expect(decide("bash", undefined, CAPTAIN)).toBeUndefined()
    expect(decide("bash", { command: null }, CAPTAIN)).toBeUndefined()
    expect(decide("bash", { command: 42 }, CAPTAIN)).toBeUndefined()
    expect(decide("bash", { command: ["bun test"] }, CAPTAIN)).toBeUndefined()
    expect(decide("bash", { command: "" }, CAPTAIN)).toBeUndefined()
  })
})

describe("A1 — the deny table, row by row", () => {
  /** One representative command for every deny-table label, so a new row cannot ship untested. */
  const REPRESENTATIVE: Record<string, string> = {
    "bun-test": "bun test",
    "bun-run-gate": "bun run verify:gates",
    "bun-run-typecheck": "bun run typecheck",
    "node-verify-script": "node scripts/verify-dist-fresh.ts",
    "node-release-script": "node scripts/repin-vendor.ts --check",
    "qa-scripts": "bun skills/dsh-qa/scripts/reset.ts",
    "npm-pack": "npm pack",
    docker: "docker build -t mpd:e2e .",
    tsc: "npx tsc --noEmit",
    "bun-build": "bun build packages/mpd-roles-plugin/src/index.ts --target node --format esm --outfile packages/mpd-roles-plugin/dist/index.js",
  }

  test("every shipped deny-table row matches its representative command", () => {
    for (const entry of CAPTAIN_SHELL_DENY_PATTERNS) {
      /** The command this row is meant to catch; its absence is a table/test drift. */
      const command = REPRESENTATIVE[entry.label]
      expect(typeof command, "no representative command for deny-table row " + entry.label).toBe("string")
      expect(matchCaptainShellDeny(command), entry.label + " does not match " + command).toBe(entry)
      expect(bashByCaptain(command), entry.label + " is not refused").toContain("captain shell: REFUSED")
    }
  })

  test("the contract's second spelling of each family is caught too", () => {
    for (const command of [
      "bun run test:qa",
      "node scripts/pack-mpd.ts",
      "node scripts/docker-e2e.ts --mode source",
      "node scripts/install-profile.ts --dry-run",
      "node skills/dsh-qa/scripts/preset-conformance.ts",
      "npm run pack",
      "bun x tsc --noEmit",
      "node ./node_modules/typescript/bin/tsc",
    ]) {
      expect(bashByCaptain(command), command + " is not refused").toContain("captain shell: REFUSED")
    }
  })

  test("the case-insensitive match and the optional `sudo` prefix both hold", () => {
    expect(bashByCaptain("BUN TEST")).toBeDefined()
    expect(bashByCaptain("sudo bun test")).toBeDefined()
    expect(bashByCaptain("sudo docker build .")).toBeDefined()
    expect(bashByCaptain("sudo node scripts/verify-dist-fresh.ts")).toBeDefined()
  })

  test("`bun run typecheck` is refused, with flags, sudo, case and a compound segment", () => {
    for (const command of ["bun run typecheck", "bun run typecheck --noEmit", "sudo bun run typecheck", "BUN RUN TYPECHECK"]) {
      expect(bashByCaptain(command), command + " is not refused").toContain("captain shell: REFUSED")
    }
    // A COMPOUND COMMAND QUOTES THE SEGMENT: the line's `cd` prefix is not what the sentence reports.
    /** The refusal for `cd … && bun run typecheck`, whose offending segment is the second one. */
    const refusal = String(bashByCaptain("cd packages/x && bun run typecheck") ?? "")
    expect(refusal).toContain("captain shell: REFUSED")
    expect(refusal).toContain('"bun run typecheck"')
  })

  test("a NON-gate script name and ordinary shell use stay allowed after the typecheck row", () => {
    for (const command of ["bun run format", "git status", "ls"]) {
      expect(bashByCaptain(command), command + " must stay allowed").toBeUndefined()
    }
  })

  test("legitimate captain shell use is allowed: git, the filesystem and bookkeeping", () => {
    for (const command of ["git status", "git log --oneline -5", "ls -la", "cat package.json", "echo hello", "bun install", "npm ci"]) {
      expect(bashByCaptain(command), command + " must stay allowed").toBeUndefined()
    }
    // A MENTION is not a command: an anchored rule never refuses its own name in an echo.
    expect(bashByCaptain('echo "bun test"')).toBeUndefined()
  })
})

describe("A1 — command normalisation", () => {
  test("every separator splits the command and the offending SEGMENT is quoted", () => {
    for (const command of ["cd packages/mpd-roles-plugin && bun test", "true || bun test", "echo start; bun test", "git status | bun test", "cd /tmp\nbun test"]) {
      /** The refusal for this compound command. */
      const refusal = String(bashByCaptain(command) ?? "")
      expect(refusal, command + " is not refused").toContain("captain shell: REFUSED")
      // The segment, never the whole `cd … && …` line, is what the sentence quotes back.
      expect(refusal).toContain('"bun test"')
    }
  })

  test("a compound of allowed commands is allowed", () => {
    for (const command of ["git status && git diff", "ls | wc -l", "echo a; echo b", "git status\nls"]) {
      expect(bashByCaptain(command), command + " must stay allowed").toBeUndefined()
    }
  })

  test("the segment splitter trims, drops empty segments and keeps command order", () => {
    expect(captainShellSegments("  cd x &&  bun test || ls\n\n git status ")).toEqual(["cd x", "bun test", "ls", "git status"])
    expect(captainShellSegments("")).toEqual([])
    expect(captainShellSegments(" && ; || \n ")).toEqual([])
  })
})

describe("A1 — the refusal sentence stays inside the contract's 600-character bound", () => {
  test("a gate-shaped row names mpd_verify_evidence; a non-gate-shaped row does not", () => {
    /** The refusal for a gate command, which carries the C2 clause. */
    const gate = String(bashByCaptain("bun test") ?? "")
    /** The refusal for a launch/package chore, which carries no gate-evidence clause. */
    const chore = String(bashByCaptain("docker build .") ?? "")
    expect(gate).toContain("mpd_verify_evidence")
    expect(chore).not.toContain("mpd_verify_evidence")
    expect(chore).toContain("captain shell: REFUSED")
  })

  test("a pathological long command is capped rather than allowed to break the bound", () => {
    /** A real deny-table hit followed by a very long argument tail. */
    const long = "bun test " + "x".repeat(500)
    /** Its refusal, which must still fit the contract's bound. */
    const refusal = String(bashByCaptain(long) ?? "")
    expect(refusal).toContain("captain shell: REFUSED")
    expect(refusal.length).toBeLessThanOrEqual(600)
  })
})

describe("A1 — install through the adapter", () => {
  test("installs through the real `tools.guard` seam and refuses the captain's `bun test`", () => {
    /** The callback the adapter really received. */
    let installed: ((exec: DshToolExec) => string | undefined) | undefined
    /** The adapter double exposing the ONE seam under test. */
    const dsh = {
      capabilities: () => ({ toolsGuard: true }),
      guardTool: (guard: (exec: DshToolExec) => string | undefined): (() => void) => {
        installed = guard
        return () => { /* this arm asserts the callback, not disposal */ }
      },
    } as Pick<DshAdapter, "capabilities" | "guardTool">
    /** The install outcome under the absent-config default. */
    const install = installCaptainShellGuard(dsh, { configValue: () => undefined, warn: () => { /* no degradation expected */ } })
    expect(install.installed).toBe(true)
    expect(install.mode).toBe("deny")
    /** The callback the row now runs for every tool call. */
    const guard = installed
    expect(guard?.({ name: "bash", arguments: { command: "bun test" }, agent: CAPTAIN })).toContain("captain shell: REFUSED")
    expect(guard?.({ name: "bash", arguments: { command: "git status" }, agent: CAPTAIN })).toBeUndefined()
    expect(guard?.({ name: "bash", arguments: { command: "bun test" }, agent: MEMBER })).toBeUndefined()
    expect(guard?.({ name: "read", arguments: { file_path: "src/x.ts" }, agent: CAPTAIN })).toBeUndefined()
  })

  test("the mode is read PER CALL, so a live mpd.jsonc edit applies without a reinstall", () => {
    /** The mutable config value the guard reads on every call, like the live config layer. */
    let configured: unknown = "deny"
    /** The callback the adapter really received. */
    let installed: ((exec: DshToolExec) => string | undefined) | undefined
    /** The adapter double exposing the ONE seam under test. */
    const dsh = {
      capabilities: () => ({ toolsGuard: true }),
      guardTool: (guard: (exec: DshToolExec) => string | undefined): (() => void) => {
        installed = guard
        return () => { /* this arm asserts the callback, not disposal */ }
      },
    } as Pick<DshAdapter, "capabilities" | "guardTool">
    /** The install outcome, whose reported mode is the INSTALL-TIME observation. */
    const install = installCaptainShellGuard(dsh, { configValue: () => configured, warn: () => { /* no degradation expected */ } })
    expect(install.mode).toBe("deny")
    /** The callback the row now runs for every tool call. */
    const call = (): string | undefined => installed?.({ name: "bash", arguments: { command: "bun test" }, agent: CAPTAIN })
    expect(call()).toContain("captain shell: REFUSED")
    // A live edit to `captain.shell: "allow"` takes effect on the NEXT call, with no reinstall.
    configured = "allow"
    expect(call()).toBeUndefined()
    // ...and switching back denies again, so the mode is never cached.
    configured = "deny"
    expect(call()).toContain("captain shell: REFUSED")
  })

  test("a malformed exec is a pass-through, reported ONCE and never thrown", () => {
    /** Every warning the install and its callback reported. */
    const warnings: string[] = []
    /** The callback the adapter really received. */
    let installed: ((exec: DshToolExec) => string | undefined) | undefined
    /** The adapter double exposing the ONE seam under test. */
    const dsh = {
      capabilities: () => ({ toolsGuard: true }),
      guardTool: (guard: (exec: DshToolExec) => string | undefined): (() => void) => {
        installed = guard
        return () => { /* this arm asserts the callback, not disposal */ }
      },
    } as Pick<DshAdapter, "capabilities" | "guardTool">
    /** The install outcome under the deny mode. */
    installCaptainShellGuard(dsh, { configValue: () => "deny", warn: (line) => warnings.push(line) })
    /** A malformed exec: every property read throws, which is what an unreadable exec proxy is here. */
    const throwingExec = new Proxy({}, { get: () => { throw new Error("malformed exec") } }) as unknown as DshToolExec
    // The guard must never throw out of its callback...
    expect(() => installed?.(throwingExec)).not.toThrow()
    // ...and never DENY an unrelated call for a reason of its own: the decision is a pass-through.
    expect(installed?.(throwingExec)).toBeUndefined()
    // ONE report across repeated failures, so a persistently malformed exec cannot flood the row log.
    expect(warnings.filter((line) => line.includes("internal error")).length).toBe(1)
    expect(installed?.(throwingExec)).toBeUndefined()
    expect(warnings.filter((line) => line.includes("internal error")).length).toBe(1)
  })

  test("a composition without the guard seam reports the absence instead of installing nothing silently", () => {
    /** Every warning the failed install reported. */
    const warnings: string[] = []
    /** The outcome for an adapter whose harness exposes no `tools.guard`. */
    const install = installCaptainShellGuard({
      capabilities: () => ({ toolsGuard: false }),
      guardTool: () => { throw new Error("the seam must not be called") },
    } as unknown as Pick<DshAdapter, "capabilities" | "guardTool">, {
      configValue: () => "allow",
      warn: (line) => warnings.push(line),
    })
    expect(install.installed).toBe(false)
    expect(install.reason).toBe("no-guard-seam")
    // The install-time MODE is still reported, so the boot line can say what WOULD have applied.
    expect(install.mode).toBe("allow")
    expect(warnings.length).toBe(1)
    expect(warnings[0]).toContain("tools.guard")
  })

  test("an adapter that throws while installing degrades with the reason instead of taking the row down", () => {
    /** Every warning the failed install reported. */
    const warnings: string[] = []
    /** The outcome for an adapter whose `guardTool` seam throws. */
    const install = installCaptainShellGuard({
      capabilities: () => ({ toolsGuard: true }),
      guardTool: () => { throw new Error("registry refused") },
    } as unknown as Pick<DshAdapter, "capabilities" | "guardTool">, {
      configValue: () => undefined,
      warn: (line) => warnings.push(line),
    })
    expect(install.installed).toBe(false)
    expect(install.reason).toBe("install-failed")
    expect(install.mode).toBe("deny")
    expect(warnings.length).toBe(1)
  })
})
