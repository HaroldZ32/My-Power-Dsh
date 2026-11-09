// THE CAPTAIN SHELL GUARD'S OWN ARMS (contract `.mpd/plans/captain-self-test-fence.md` §3 C1, §4 A1).
//
// WAVE 2 adds two blocks at the bottom of the deny-table coverage: `.mpd/plans/captain-recon-fence.md`
// §3 C1's launcher-spelling normalisation (a shell spelling the literal table missed is still refused) and
// §3 C3's READ-ROUTE (a read verb on a path outside the documentation band is reconnaissance too). The
// read-route's own REPAIR block afterwards — one arm per finding and per nit of rec-20261109T030449-cae6c8,
// plus the regression that nothing reopened — is the 2026-11-09 repair: pipeline-aware searches (F1),
// quote-aware splitting (F2), `cd` tracking (F3), `rg --files` (F4), redirect targets (NIT 1) and
// `sed -i` (NIT 2). A THIRD block locks the captain's follow-up repair: the substitution-aware whole-string
// pass (repair A — a compound command is judged PER SEGMENT, while a command substitution is judged as its
// own command) and the stdin exemption narrowed to the verbs that really consume stdin (repair B — `find`
// after a pipe searches the tree and stays refused).
//
// WHAT THESE LOCK OUT: a top-level `mpd` session spending its own turn on the verification commands that
// produce gate evidence, or reading workspace source through the shell instead of delegating it. The
// decision is driven through its REAL exported function (`captainShellDecision`) and, for the install arm,
// through the callback the row really hands the adapter — so what is asserted is the shipped decision,
// never a re-implementation of it.
//
// THE CLASSIFICATION IS REUSED, NOT RE-DERIVED: the `topLevel` flag these arms pass is exactly what
// `sessionIsMpdCaptain` answers (the `mpd` preset's top-level session), which is why the agent doubles
// below carry real session headers rather than a boolean.
import { existsSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"

import {
  CAPTAIN_SHELL_DENY_PATTERNS,
  CAPTAIN_SHELL_READ_VERBS,
  CAPTAIN_SHELL_TOOLS,
  DEFAULT_CAPTAIN_SHELL_MODE,
  captainShellDecision,
  captainShellSegments,
  installCaptainShellGuard,
  matchCaptainShellDeny,
  normaliseCaptainShellSegment,
  resolveCaptainShellMode,
  splitCaptainShellSegments,
} from "../src/captain-shell.ts"
import type { CaptainShellMode } from "../src/captain-shell.ts"
import { sessionIsMpdCaptain } from "../src/complexity-gate.ts"
import type { DshAdapter, DshToolExec } from "../../mpd-dsh-adapter-plugin/src/index"

/** The repository root, three directories above this test file — the workspace root every arm judges against. */
const WORKSPACE_ROOT: string = join(import.meta.dir, "../../..")

/**
 * Whether one read-route token exists on disk, resolved against {@link WORKSPACE_ROOT} exactly as the
 * installed guard resolves it — the same probe the row hands the decision.
 *
 * @param raw - the token as the command spelled it.
 * @returns true when the token names something on disk.
 */
function pathExists(raw: string): boolean {
  return existsSync(raw.startsWith("/") ? raw : join(WORKSPACE_ROOT, raw))
}

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
  return captainShellDecision({
    toolName,
    args,
    workspaceRoot: WORKSPACE_ROOT,
    pathExists,
    topLevel: sessionIsMpdCaptain(agent),
    mode,
  })
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
    // WAVE 2 (contract `.mpd/plans/captain-recon-fence.md` §3 C1): the launcher spellings wave 1 missed.
    "npm-test": "npm test",
    "npm-run-gate": "npm run verify:gates",
    "npx-runner": "npx jest --ci",
    "bun-typecheck": "bun typecheck",
    "pnpm-test": "pnpm test",
    "yarn-test": "yarn test",
    // POST-REVIEW REPAIR (CodeRabbit round 1): the launcher spellings waves 1–2 still missed. The
    // representatives are chosen so each row is the FIRST match: `bun x tsc` would resolve to `tsc` above.
    "bun-run-test": "bun run test",
    "bunx-runner": "bunx tsgo --noEmit",
    "pkg-exec-runner": "npm exec tsc --noEmit",
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

  // POST-REVIEW REPAIR (CodeRabbit round 1 on the wave-2 PR): the spellings the table still missed. Each
  // arm is a command the finding names; the anti-false-positive arms are the ones it requires to stay
  // ALLOWED, so a widened row cannot pass by refusing everything.
  test("POST-REVIEW — `bun run test` is refused in BOTH spellings, and a lookalike script name is not", () => {
    for (const command of [
      "bun run test",
      "bun run test:unit",
      "bun run test --watch",
      "bun run --silent test",
      "sudo bun run test",
      "BUN RUN TEST",
    ]) {
      expect(bashByCaptain(command), command + " is not refused").toContain("captain shell: REFUSED")
    }
    // The word boundary does NOT swallow an unrelated script name, and a non-gate script stays allowed.
    expect(bashByCaptain("bun run testimony")).toBeUndefined()
    expect(bashByCaptain("bun run format")).toBeUndefined()
    // The bare spelling is the row this repair added; the `:` spelling keeps its EARLIER owner, so no
    // existing label changed hands (`bun-run-gate` already required a `:` or `_` after `test`).
    expect(matchCaptainShellDeny("bun run test")?.label).toBe("bun-run-test")
    expect(matchCaptainShellDeny("bun run test:unit")?.label).toBe("bun-run-gate")
  })

  test("POST-REVIEW — the `bunx` / `bun x` launcher is refused against every gate runner", () => {
    for (const command of [
      "bunx tsc --noEmit",
      "bunx tsgo --noEmit",
      "bunx jest --ci",
      "bunx vitest run",
      "bunx mocha test/captain-shell.test.ts",
      "bunx -- tsgo",
      "bun x tsgo",
      "bun x jest --ci",
      "sudo bunx vitest run",
    ]) {
      expect(bashByCaptain(command), command + " is not refused").toContain("captain shell: REFUSED")
    }
    // ANTI-FALSE-POSITIVE: a `bunx` binary that is NOT a gate runner is none of this table's business.
    expect(bashByCaptain("bunx cowsay hi")).toBeUndefined()
    expect(bashByCaptain("bun x cowsay hi")).toBeUndefined()
  })

  test("POST-REVIEW — the package-manager binary launchers are refused against every gate runner", () => {
    for (const command of [
      "npm exec tsc --noEmit",
      "npm exec -- tsc --noEmit",
      "npm exec tsgo --noEmit",
      "npm exec vitest run",
      "pnpm dlx jest --ci",
      "pnpm dlx -- tsc",
      "pnpm exec tsc --noEmit",
      "yarn dlx tsgo",
      "yarn dlx mocha test/captain-shell.test.ts",
      "yarn exec tsc --noEmit",
      "sudo npm exec tsc",
    ]) {
      expect(bashByCaptain(command), command + " is not refused").toContain("captain shell: REFUSED")
    }
    // ANTI-FALSE-POSITIVE: installing is a chore, not gate evidence, in every launcher.
    for (const command of ["npm install", "npm ci", "pnpm install", "yarn install", "npm run format", "yarn build"]) {
      expect(bashByCaptain(command), command + " must stay allowed").toBeUndefined()
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
    for (const command of ["git status", "git log --oneline -5", "ls -la", "echo hello", "bun install", "npm ci"]) {
      expect(bashByCaptain(command), command + " must stay allowed").toBeUndefined()
    }
    // A MENTION is not a command: an anchored rule never refuses its own name in an echo.
    expect(bashByCaptain('echo "bun test"')).toBeUndefined()
  })

  test("DELIBERATE semantic change (wave 2 §3 C3): `cat package.json` is now REFUSED", () => {
    // This arm used to live in the ALLOWED list above. The read-route makes it a reconnaissance command:
    // `package.json` is root metadata, not part of the documentation band, so refusing it is the band's
    // own reading — the change is the contract's, never a test edit made to obtain a green run.
    expect(bashByCaptain("cat package.json"), "cat package.json must now be refused").toContain("captain shell: REFUSED")
    expect(bashByCaptain("cat package.json")).toContain('role:"Explorer"')
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

describe("B1 — launcher-spelling normalisation (contract §3 C1 steps 1–4)", () => {
  test("every B1 spelling is REFUSED, and the sentence quotes what the caller wrote", () => {
    /** The R1 spellings §1 names plus the wrapper, assignment and absolute-path forms §3 C1 reduces. */
    const spellings: readonly string[] = [
      "npm test",
      "npm run typecheck",
      "bun typecheck",
      "bun run --silent typecheck",
      "env FOO=1 bun run typecheck",
      "/usr/bin/bun test",
    ]
    for (const command of spellings) {
      /** The refusal this spelling must produce. */
      const refusal = String(bashByCaptain(command) ?? "")
      expect(refusal, command + " is not refused").toContain("captain shell: REFUSED")
      // The quote is the SPELLING THE CALLER WROTE, so the model is told what it actually ran.
      expect(refusal, command + " is not quoted verbatim").toContain('"' + command + '"')
    }
  })

  test("step 1 — wrapper commands are stripped repeatedly, with their own flags and assignments", () => {
    for (const command of [
      "sudo bun test",
      "sudo -E bun test",
      "sudo -u root bun test",
      "command bun test",
      "exec bun test",
      "time bun test",
      "time -p bun test",
      "nohup bun test",
      "builtin bun test",
      "env bun test",
      "env FOO=1 bun test",
      "env -i FOO=1 bun test",
      "sudo env FOO=1 bun test",
      "nohup sudo -E env FOO=1 bun run --silent typecheck",
    ]) {
      expect(bashByCaptain(command), command + " is not refused").toContain("captain shell: REFUSED")
    }
  })

  test("step 2 — a leading NAME=value assignment is stripped, alone and repeated", () => {
    for (const command of ["FOO=1 bun test", "FOO=1 BAR=2 bun test", "CI=1 node scripts/verify-dist-fresh.ts"]) {
      expect(bashByCaptain(command), command + " is not refused").toContain("captain shell: REFUSED")
    }
  })

  test("step 3 — an ABSOLUTE launcher path is reduced to its basename", () => {
    for (const command of ["/usr/bin/bun test", "/usr/local/bin/bun test", "/usr/bin/npm test", "/opt/node/bin/node scripts/verify-dist-fresh.ts"]) {
      expect(bashByCaptain(command), command + " is not refused").toContain("captain shell: REFUSED")
    }
    // A PATH-SPELLED WRAPPER is the same wrapper (2026-11-09 addendum): `/usr/bin/env` reduces to `env`,
    // step 1 then strips it, and the launcher underneath is judged like the bare spelling.
    for (const command of ["/usr/bin/env bun test", "/usr/bin/env -i FOO=1 bun run typecheck"]) {
      expect(bashByCaptain(command), command + " is not refused").toContain("captain shell: REFUSED")
    }
    // A RELATIVE path is NOT a launcher spelling (contract §3 C1 step 3), so it is left exactly as written.
    expect(normaliseCaptainShellSegment("./script.sh bun test")).toBe("./script.sh bun test")
    expect(normaliseCaptainShellSegment("bin/bun test")).toBe("bin/bun test")
  })

  test("step 4 — flags between `run` and the script name do not hide the row", () => {
    for (const command of [
      "bun run --silent typecheck",
      "bun run -s typecheck",
      "bun run --silent verify:gates",
      "npm run --silent test",
      "npm run --silent verify:gates",
      "pnpm run --silent test",
      "yarn run --silent typecheck",
    ]) {
      expect(bashByCaptain(command), command + " is not refused").toContain("captain shell: REFUSED")
    }
  })

  test("the anti-false-positive list §3 C1 names stays ALLOWED", () => {
    for (const command of [
      "git status",
      "ls",
      "mkdir -p x",
      'node -e "1+1"',
      "bun run format",
      "npm install",
      // `cat docs/x.md` stays allowed now and after C3's read-route (it is inside the documentation band).
      "cat docs/x.md",
      'echo "bun test"',
      // Neighbours of the new rows that are NOT gate commands.
      "npx prettier --check .",
      "bun install",
      "pnpm install",
      "yarn install",
    ]) {
      expect(bashByCaptain(command), command + " must stay allowed").toBeUndefined()
    }
  })

  test("the normaliser reduces a compound launcher spelling to the canonical one", () => {
    expect(normaliseCaptainShellSegment("sudo -E env FOO=1 /usr/local/bin/bun run --silent typecheck")).toBe("bun run typecheck")
    expect(normaliseCaptainShellSegment("FOO=1 BAR=2 bun test")).toBe("bun test")
    expect(normaliseCaptainShellSegment("/opt/node/bin/node scripts/verify-dist-fresh.ts")).toBe("node scripts/verify-dist-fresh.ts")
    // Only internal whitespace is collapsed; nothing else about a spelling the table does not name is changed.
    expect(normaliseCaptainShellSegment("  bun   test  ")).toBe("bun test")
    expect(normaliseCaptainShellSegment("")).toBe("")
  })

  test("B1 is scoped exactly like the rest of the rule: a child and another preset keep full access", () => {
    for (const command of ["npm test", "env FOO=1 bun run typecheck", "/usr/bin/bun test"]) {
      expect(decide("bash", { command }, MEMBER), command + " must stay available to a child").toBeUndefined()
      expect(decide("bash", { command }, OTHER_PRESET_CAPTAIN), command + " must stay available outside the mpd preset").toBeUndefined()
    }
  })
})

describe("B3 — the shell read-route (contract §3 C3)", () => {
  test("every B3 probe: the source reads are refused, the documentation band stays readable", () => {
    // The contract's `cat packages/x.ts` arm is realized with a REAL source file: a token that names no
    // file is IGNORED by the exists-on-disk rule, so the literal spelling would prove nothing (see the
    // bounded-readings arm below, which states that rule instead of hiding it).
    /** The contract's B3 probes, each with the outcome it must produce (`true` = allowed). */
    const probes: ReadonlyArray<readonly [string, boolean]> = [
      ["cat packages/mpd-roles-plugin/src/index.ts", false],
      ["cat package.json", false],
      ["rg foo", false],
      ["rg foo docs/", true],
      ["sed -n '1,10p' docs/decisions.md", true],
      ["cat docs/decisions.md", true],
      ["cat AGENTS.md", true],
      ["git log -p", true],
      ["echo hi | cat", true],
      ["find . -name '*.ts'", false],
    ]
    for (const [command, allowed] of probes) {
      /** The decision for this probe; `undefined` means the call is allowed. */
      const refusal = bashByCaptain(command)
      expect(refusal === undefined, command + (allowed ? " must be allowed" : " must be refused")).toBe(allowed)
    }
  })

  test("bounded readings: a token that names no file is IGNORED, not refused (contract §3 C3)", () => {
    // The file-reader rule judges only EXISTING paths, which is exactly what keeps `sed -n '1,10p'`
    // allowed. The same rule means a non-existent source spelling slips through — a stated bound, and the
    // reason the B3 arm above uses a real source path.
    expect(bashByCaptain("cat packages/x.ts")).toBeUndefined()
    // A SEARCH aimed only at a non-existent path has NO existing path candidate, so the fail-closed
    // whole-workspace rule refuses it rather than reading it as a bounded search.
    expect(bashByCaptain("rg foo no-such-directory/")).toContain("captain shell: REFUSED")
  })

  test("every read verb is gated: one existing source path is enough to refuse any of them", () => {
    /** A source path that EXISTS on disk, so the rule judges every verb against it. */
    const source = "packages/mpd-roles-plugin/src/index.ts"
    for (const verb of CAPTAIN_SHELL_READ_VERBS) {
      /** One command in this verb's own argument shape, aimed at the source path. */
      const command = verb === "find"
        ? verb + " " + source + " -name '*.ts'"
        : verb === "rg" || verb === "grep" || verb === "ag" || verb === "ack"
          ? verb + " TODO " + source
          : verb + " " + source
      expect(bashByCaptain(command), command + " is not refused").toContain("captain shell: REFUSED")
    }
  })

  test("anti-false-positive: ordinary shell use and the documentation band stay allowed", () => {
    for (const command of [
      "git status",
      "ls -la",
      "echo hello",
      "bun install",
      "mkdir -p x",
      // A DECLARED residual (contract §6): `git` is not a read verb, so `git show` and `git grep` stay open.
      "git show HEAD:package.json",
      "git grep bun",
      // The documentation band and the named root documents stay readable through every reader shape.
      "cat docs/decisions.md",
      "head -n 5 docs/decisions.md",
      "tail -n 5 docs/decisions.md",
      "less docs/decisions.md",
      "more docs/decisions.md",
      "nl docs/decisions.md",
      "sed -n '1,10p' docs/decisions.md",
      "awk '{print}' docs/decisions.md",
      // Search verbs whose path argument is inside the band.
      "rg TODO docs/",
      "grep -rn TODO docs/",
      "ag TODO docs/",
      "ack TODO docs/",
      "find docs -name '*.md'",
      // stdin/pipeline use: a reader with no existing path reads the pipe, not the tree.
      "echo hi | cat",
      "cat",
      // The path-spelled wrapper must NOT be caught by the read-route when the verb is benign.
      "/usr/bin/env ls",
      "/usr/bin/env git status",
      // A runtime-assembled path is not judged (token bound): the literal `$F` names no file.
      "cat $F",
    ]) {
      expect(bashByCaptain(command), command + " must stay allowed").toBeUndefined()
    }
  })

  test("the refusal names the Explorer route out and stays inside the 600-character bound", () => {
    /** The refusal a real source read produces. */
    const refusal = String(bashByCaptain("cat packages/mpd-roles-plugin/src/index.ts") ?? "")
    expect(refusal).toContain("[mpd-roles] captain shell: REFUSED")
    expect(refusal).toContain("reads workspace content through the shell")
    expect(refusal).toContain("mpd_role_spawn")
    expect(refusal).toContain('role:"Explorer"')
    expect(refusal).toContain("captain.shell:\"allow\"")
    // The sentence quotes what the caller wrote.
    expect(refusal).toContain("packages/mpd-roles-plugin/src/index.ts")
    expect(refusal.length).toBeLessThanOrEqual(600)
    // A pathological long command is capped rather than allowed to break the bound.
    /** A real read followed by a very long argument tail. */
    const long = "cat packages/mpd-roles-plugin/src/index.ts " + "x".repeat(500)
    expect(String(bashByCaptain(long) ?? "").length).toBeLessThanOrEqual(600)
  })

  test("the read-route is SECOND: a deny row wins and keeps its own sentence", () => {
    // `cat … && bun test` is BOTH a read and a gate command: the deny table is tested first, so the sentence
    // the model receives is the verification one (contract §3 C3: the read-route runs only when no deny matched).
    /** The refusal for a compound that carries both families. */
    const refusal = String(bashByCaptain("cat package.json && bun test") ?? "")
    expect(refusal).toContain("is a verification command")
  })

  test("the read-route is scoped like the rest of the rule: child, other preset and allow mode", () => {
    for (const command of ["cat packages/mpd-roles-plugin/src/index.ts", "rg foo", "find . -name '*.ts'"]) {
      expect(decide("bash", { command }, MEMBER), command + " must stay available to a child").toBeUndefined()
      expect(decide("bash", { command }, OTHER_PRESET_CAPTAIN), command + " must stay available outside the mpd preset").toBeUndefined()
      expect(decide("bash", { command }, CAPTAIN, "allow"), command + " must stay available under allow").toBeUndefined()
    }
  })

  test("the INSTALLED callback resolves the root per call and refuses a source read", () => {
    /** The callback the adapter really received. */
    let installed: ((exec: DshToolExec) => string | undefined) | undefined
    /** The adapter double: the ONE seam plus the per-call workspace-root helper the read-route needs. */
    const dsh = {
      capabilities: () => ({ toolsGuard: true }),
      workspaceRoot: () => WORKSPACE_ROOT,
      guardTool: (guard: (exec: DshToolExec) => string | undefined): (() => void) => {
        installed = guard
        return () => { /* this arm asserts the callback, not disposal */ }
      },
    } as Pick<DshAdapter, "capabilities" | "guardTool" | "workspaceRoot">
    installCaptainShellGuard(dsh, { configValue: () => undefined, warn: () => { /* no degradation expected */ } })
    expect(installed?.({ name: "bash", arguments: { command: "cat packages/mpd-roles-plugin/src/index.ts" }, agent: CAPTAIN })).toContain("captain shell: REFUSED")
    expect(installed?.({ name: "bash", arguments: { command: "cat docs/decisions.md" }, agent: CAPTAIN })).toBeUndefined()
  })

  test("a throwing workspace-root helper degrades to \"\" and never escapes the guard", () => {
    /** The callback the adapter really received. */
    let installed: ((exec: DshToolExec) => string | undefined) | undefined
    /** The adapter double whose root helper throws, as an unreadable exec proxy would. */
    const dsh = {
      capabilities: () => ({ toolsGuard: true }),
      workspaceRoot: () => { throw new Error("no root") },
      guardTool: (guard: (exec: DshToolExec) => string | undefined): (() => void) => {
        installed = guard
        return () => { /* this arm asserts the callback, not disposal */ }
      },
    } as unknown as Pick<DshAdapter, "capabilities" | "guardTool" | "workspaceRoot">
    installCaptainShellGuard(dsh, { configValue: () => "deny", warn: () => { /* the degrade is the point */ } })
    expect(() => installed?.({ name: "bash", arguments: { command: "cat packages/mpd-roles-plugin/src/index.ts" }, agent: CAPTAIN })).not.toThrow()
    // With no root a relative source path still fails closed through the band test.
    expect(installed?.({ name: "bash", arguments: { command: "cat packages/mpd-roles-plugin/src/index.ts" }, agent: CAPTAIN })).toContain("captain shell: REFUSED")
  })
})

describe("B3 REPAIR — the four findings and two nits of rec-20261109T030449-cae6c8", () => {
  // EACH ARM BELOW IS A COMMAND A REASONABLE CAPTAIN RUNS that the first read-route wrongly refused, plus
  // the anti-false-positive sentence the finding names, plus the regression that proves nothing reopened.
  // The band and the workspace are the REAL ones (WORKSPACE_ROOT), so an arm's `exists` verdict is disk fact.

  test("F1 — a search verb FED BY STDIN with no path candidate reads the pipe, not the workspace", () => {
    // The three commands the finding names verbatim: none of them searches the workspace.
    for (const command of [
      "git log --oneline | grep fix",
      "ls -la | grep md",
      "cat docs/decisions.md | grep TODO",
    ]) {
      expect(bashByCaptain(command), command + " must be allowed").toBeUndefined()
    }
    // ANTI-FALSE-POSITIVE sentence: such a segment that DOES carry an existing out-of-band path is judged
    // and refused — the pipeline is not a blanket exemption.
    /** The refusal a piped search carrying a REAL source path produces. */
    const refusal = String(bashByCaptain("cat docs/decisions.md | grep TODO packages/mpd-roles-plugin/src/index.ts") ?? "")
    expect(refusal).toContain("captain shell: REFUSED")
    expect(refusal).toContain("packages/mpd-roles-plugin/src/index.ts")
    // The exemption is the PIPELINE, not the verb: a search in the first stage of a new pipeline is still a
    // whole-workspace search (`;` and `&&` do not feed it).
    expect(bashByCaptain("git log --oneline; grep fix")).toContain("captain shell: REFUSED")
    expect(bashByCaptain("git log --oneline && grep fix")).toContain("captain shell: REFUSED")
  })

  test("F1 — the splitter reports which stage of its pipeline a segment is", () => {
    // The pipeline fact is structural, so it is asserted on the splitter directly, not through a refusal.
    expect(splitCaptainShellSegments("git log | grep fix").map((segment) => segment.fedByPipe)).toEqual([false, true])
    expect(splitCaptainShellSegments("a | b || c; d").map((segment) => segment.fedByPipe)).toEqual([false, true, false, false])
    expect(splitCaptainShellSegments("a |& b").map((segment) => segment.fedByPipe)).toEqual([false, true])
  })

  test("F2 — the splitter is QUOTE-AWARE, so `|` inside a pattern never cuts the command", () => {
    // The finding's two spellings must each be ONE segment, with the path still judged normally.
    for (const command of [
      'grep -E "fix|feat" docs/decisions.md',
      "grep -E 'TODO|FIXME' docs/x",
    ]) {
      expect(captainShellSegments(command), command + " must stay one segment").toEqual([command])
      expect(bashByCaptain(command), command + " must be allowed").toBeUndefined()
    }
    // THE PATH IS STILL JUDGED: the same quoted pattern aimed at a source file is refused...
    /** The refusal a quoted-pattern search aimed at a real source file produces. */
    const refusal = String(bashByCaptain('grep -E "fix|feat" packages/mpd-roles-plugin/src/index.ts') ?? "")
    expect(refusal).toContain("captain shell: REFUSED")
    // ...and the refusal quotes the WHOLE segment, never a fragment cut out of the quoted pattern.
    expect(refusal).toContain('"grep -E "fix|feat" packages/mpd-roles-plugin/src/index.ts"')
    // `&&`, `||`, `;` and a newline inside quotes are arguments, not separators; outside they still split.
    expect(captainShellSegments('echo "a && bun test"')).toEqual(['echo "a && bun test"'])
    expect(captainShellSegments("echo 'a; b' && bun test")).toEqual(["echo 'a; b'", "bun test"])
    // A backslash escape protects a separator outside quotes too.
    expect(captainShellSegments("echo a\\; b")).toEqual(["echo a\\; b"])
  })

  test("F3 — `cd` is tracked, so a later RELATIVE candidate resolves against it", () => {
    // The finding's refusal and allowance, both relative to the tracked directory.
    expect(bashByCaptain("cd packages && cat mpd-roles-plugin/src/index.ts")).toContain("captain shell: REFUSED")
    // A SECOND `cd` composes: the tracked directory is `packages/mpd-roles-plugin` by the time `cat` runs.
    expect(bashByCaptain("cd packages && cd mpd-roles-plugin && cat src/index.ts")).toContain("captain shell: REFUSED")
    expect(bashByCaptain("cd docs && cat decisions.md")).toBeUndefined()
    // AN ABSOLUTE candidate is never rebased by a `cd` — it is judged exactly as written.
    /** An absolute documentation path, spelled from the real workspace root so the arm is machine-independent. */
    const absoluteDoc = join(WORKSPACE_ROOT, "docs/decisions.md")
    expect(bashByCaptain("cd packages && cat " + absoluteDoc)).toBeUndefined()
    // AN UNRESOLVABLE `cd` makes later RELATIVE candidates FAIL CLOSED — the finding's anti-false-positive
    // sentence, in both spellings it names (`"$X"` and `$(pwd)`).
    for (const command of [
      'cd "$X" && cat packages/mpd-roles-plugin/src/index.ts',
      "cd $(pwd) && cat docs/decisions.md",
      "cd ~ && cat docs/decisions.md",
      "cd && cat docs/decisions.md",
    ]) {
      expect(bashByCaptain(command), command + " must fail closed").toContain("captain shell: REFUSED")
    }
  })

  test("F4 — `rg --files` takes no pattern, so its first non-flag token is a PATH", () => {
    expect(bashByCaptain("rg --files docs/")).toBeUndefined()
    // The same fail-closed rule still applies to the mode: no path at all is a whole-workspace listing...
    expect(bashByCaptain("rg --files")).toContain("captain shell: REFUSED")
    // ...and a path outside the band is judged like any other.
    expect(bashByCaptain("rg --files packages/mpd-roles-plugin/src/index.ts")).toContain("captain shell: REFUSED")
    // The flag is the ONLY mode flag recognised: `--files-with-matches` still takes a pattern, so its first
    // non-flag token is the PATTERN and a call with only `docs/` left is a whole-workspace search.
    expect(bashByCaptain("rg --files-with-matches docs/")).toContain("captain shell: REFUSED")
    expect(bashByCaptain("rg --files-with-matches TODO docs/")).toBeUndefined()
  })

  test("NIT 1 — a redirect target is a WRITE, so it is stripped from the read candidates", () => {
    // The target here is a REAL out-of-band file (`package.json`), which is exactly what made the old rule
    // refuse a documentation read that happened to write somewhere.
    for (const command of [
      "cat docs/decisions.md > package.json",
      "cat docs/decisions.md >> package.json",
      "cat docs/decisions.md 2> package.json",
      "cat docs/decisions.md >package.json",
      "cat docs/decisions.md 2>&1",
      "rg TODO docs/ > package.json",
    ]) {
      expect(bashByCaptain(command), command + " must be allowed").toBeUndefined()
    }
    // Stripping the WRITE target must not hide the READ: the source path is still judged and refused.
    expect(bashByCaptain("cat packages/mpd-roles-plugin/src/index.ts > package.json")).toContain("captain shell: REFUSED")
  })

  test("NIT 2 — `sed -i` is a WRITE and writes are not gated on the read-route", () => {
    // An in-place edit of a SOURCE file is a write, not reconnaissance: the read-route lets it through.
    for (const command of [
      "sed -i 's/a/b/' packages/mpd-roles-plugin/src/index.ts",
      "sed -i.bak 's/a/b/' packages/mpd-roles-plugin/src/index.ts",
      "sed --in-place 's/a/b/' packages/mpd-roles-plugin/src/index.ts",
      "sed -ni '1p' packages/mpd-roles-plugin/src/index.ts",
    ]) {
      expect(bashByCaptain(command), command + " must be allowed").toBeUndefined()
    }
    // WITHOUT the in-place flag `sed` is judged exactly as before.
    expect(bashByCaptain("sed -n '1,10p' packages/mpd-roles-plugin/src/index.ts")).toContain("captain shell: REFUSED")
    expect(bashByCaptain("sed -n '1,10p' docs/decisions.md")).toBeUndefined()
  })

  test("REGRESSION — nothing reopened: the four reads the contract still refuses", () => {
    // The exact sentences the task names: each must still be refused after all six repairs.
    for (const command of [
      "rg foo",
      "cat packages/mpd-roles-plugin/src/index.ts",
      "cat package.json",
      "find . -name '*.ts'",
    ]) {
      expect(bashByCaptain(command), command + " must STILL be refused").toContain("captain shell: REFUSED")
    }
    // And the band's own reads plus the declared residuals are still allowed.
    for (const command of [
      "rg foo docs/",
      "find docs -name '*.md'",
      "echo hi | cat",
      "git show HEAD:package.json",
      "git grep bun",
      "grep -rn TODO docs/",
    ]) {
      expect(bashByCaptain(command), command + " must stay allowed").toBeUndefined()
    }
  })
})

describe("B3 FOLLOW-UP REPAIR — the substitution-aware whole-string pass (A) and the `find` stdin exclusion (B)", () => {
  // THE FALSE POSITIVE (A): the blanket whole-string read pass judged tokens that belong to ANOTHER
  // segment, so a documentation read followed by an ordinary second command was refused. The pass is kept
  // for the spelling it exists for — a command substitution, which is NOT a segment — and skipped otherwise.

  test("A — a compound command is judged PER SEGMENT, so another segment's tokens are not read candidates", () => {
    for (const command of [
      "cat docs/decisions.md && ls packages",
      "cat docs/decisions.md && rm -rf node_modules",
      // The unchanged spelling from the anti-false-positive list: still allowed.
      "cat docs/decisions.md && git status",
    ]) {
      expect(bashByCaptain(command), command + " must be allowed").toBeUndefined()
    }
    // The SEGMENT is still judged: the same shape whose FIRST segment reads a source path stays refused.
    expect(bashByCaptain("cat packages/mpd-roles-plugin/src/index.ts && ls packages")).toContain("captain shell: REFUSED")
  })

  test("A — a command substitution is NOT a segment, so the substituted command is judged on its own", () => {
    // `echo` is not a read verb, so the hidden `cat` is the command the route must see. The existing-on-disk
    // file proves the normal rule...
    expect(bashByCaptain("echo $(cat packages/mpd-roles-plugin/src/index.ts)")).toContain("captain shell: REFUSED")
    // ...and a NON-existent path proves the relaxed existence requirement: `x.ts` names no file, yet a
    // substitution is exactly the spelling that would otherwise hide the read.
    expect(bashByCaptain("echo `cat packages/x.ts`")).toContain("captain shell: REFUSED")
    // A separator INSIDE the substitution makes the splitter cut the body; the raw scan still sees it whole.
    expect(bashByCaptain("echo $(cat packages/mpd-roles-plugin/src/index.ts && true)")).toContain("captain shell: REFUSED")
    // A substitution that reads only the documentation band stays allowed, with no substitution at all or
    // one that never names a path.
    expect(bashByCaptain("echo $(cat docs/decisions.md)")).toBeUndefined()
    expect(bashByCaptain("echo $(pwd)")).toBeUndefined()
    // The tracked `cd` reaches the substituted command too.
    expect(bashByCaptain("cd docs && echo $(cat decisions.md)")).toBeUndefined()
    expect(bashByCaptain("cd packages && echo $(cat mpd-roles-plugin/src/index.ts)")).toContain("captain shell: REFUSED")
    // The token bound still holds: a runtime-assembled path is not judged.
    expect(bashByCaptain("cat $F")).toBeUndefined()
  })

  test("B — the stdin exemption covers only the verbs that really consume stdin", () => {
    // `find` never reads stdin, so a piped `find` searches the whole workspace exactly like a first-stage one.
    expect(bashByCaptain("git log | find")).toContain("captain shell: REFUSED")
    expect(bashByCaptain("git log | find . -name '*.ts'")).toContain("captain shell: REFUSED")
    // A piped `find` aimed INSIDE the band is judged like the first-stage spelling, whose allowance is the
    // band rather than the pipe.
    expect(bashByCaptain("git log | find docs -name '*.md'")).toBeUndefined()
    // The pattern-taking searches keep the F1 exemption — they really do consume stdin.
    expect(bashByCaptain("git log --oneline | grep fix")).toBeUndefined()
    expect(bashByCaptain("git log --oneline | rg fix")).toBeUndefined()
    expect(bashByCaptain("ls -la | ag fix")).toBeUndefined()
    expect(bashByCaptain("ls -la | ack fix")).toBeUndefined()
  })

  test("B2 — a RECURSIVE `grep` ignores its stdin, so the pipe buys no exemption (CodeRabbit round 1)", () => {
    // One arm per spelling the finding names: `-r`, `-R`, a short cluster carrying either letter,
    // `--recursive` and `--dereference-recursive`. GNU grep ignores stdin for ALL of them and recurses the
    // working directory, so `git log | grep -r fix` is a whole-workspace search, not a pipe read.
    for (const command of [
      "git log | grep -r fix",
      "git log | grep -R fix",
      "git log | grep -rn fix",
      "git log | grep -nr fix",
      "git log | grep -Rni fix",
      "ls | grep -rnl md",
      "git log | grep --recursive fix",
      "git log | grep --dereference-recursive fix",
    ]) {
      expect(bashByCaptain(command), command + " must be refused").toContain("captain shell: REFUSED")
    }
    // The PATH rule is unchanged: the same recursive piped grep carrying a REAL out-of-band path is refused
    // for the path, exactly like its non-recursive twin.
    expect(bashByCaptain("git log | grep -r fix packages/mpd-roles-plugin/src/index.ts")).toContain("captain shell: REFUSED")
    // ANTI-FALSE-POSITIVE: a NON-recursive piped grep keeps the F1 exemption, with or without ordinary flags,
    // and the task's own in-band spelling (`docs/x`, a path the disk need not confirm) stays allowed.
    for (const command of [
      "git log | grep fix",
      "ls | grep md",
      "cat docs/decisions.md | grep -n TODO",
      "git log --oneline | grep -i fix",
      "grep fix docs/x",
    ]) {
      expect(bashByCaptain(command), command + " must stay allowed").toBeUndefined()
    }
    // ...and a recursive grep aimed INSIDE the band is still allowed by the BAND, not by the pipe.
    expect(bashByCaptain("grep -rn TODO docs/")).toBeUndefined()
    expect(bashByCaptain("git log | grep -rn TODO docs/")).toBeUndefined()
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
      workspaceRoot: () => WORKSPACE_ROOT,
      guardTool: (guard: (exec: DshToolExec) => string | undefined): (() => void) => {
        installed = guard
        return () => { /* this arm asserts the callback, not disposal */ }
      },
    } as Pick<DshAdapter, "capabilities" | "guardTool" | "workspaceRoot">
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
      workspaceRoot: () => WORKSPACE_ROOT,
      guardTool: (guard: (exec: DshToolExec) => string | undefined): (() => void) => {
        installed = guard
        return () => { /* this arm asserts the callback, not disposal */ }
      },
    } as Pick<DshAdapter, "capabilities" | "guardTool" | "workspaceRoot">
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
      workspaceRoot: () => WORKSPACE_ROOT,
      guardTool: (guard: (exec: DshToolExec) => string | undefined): (() => void) => {
        installed = guard
        return () => { /* this arm asserts the callback, not disposal */ }
      },
    } as Pick<DshAdapter, "capabilities" | "guardTool" | "workspaceRoot">
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
      workspaceRoot: () => WORKSPACE_ROOT,
      guardTool: () => { throw new Error("the seam must not be called") },
    } as unknown as Pick<DshAdapter, "capabilities" | "guardTool" | "workspaceRoot">, {
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
      workspaceRoot: () => WORKSPACE_ROOT,
      guardTool: () => { throw new Error("registry refused") },
    } as unknown as Pick<DshAdapter, "capabilities" | "guardTool" | "workspaceRoot">, {
      configValue: () => undefined,
      warn: (line) => warnings.push(line),
    })
    expect(install.installed).toBe(false)
    expect(install.reason).toBe("install-failed")
    expect(install.mode).toBe("deny")
    expect(warnings.length).toBe(1)
  })
})
