// THE CAPTAIN SHELL GUARD — the `mpd` preset's TOP-LEVEL session does not run verification.
//
// WHY THIS EXISTS (contract `.mpd/plans/captain-self-test-fence.md` §1/§3 C1): the investigation guard
// beside this file gates `read`/`grep`/`glob` and states that the shell route stays open, so the captain
// could still spend its own context (and its own turn) running `bun test`, `node scripts/verify-*` and the
// other gate commands. Evidence without evidence is not done (§4), and the PRODUCER of that evidence is a
// specialist, never the captain. This guard refuses exactly those commands, while `bash` stays available
// for git, the filesystem and bookkeeping — the legitimate uses §5's own rules depend on.
//
// THE DECISION IS PURE ({@link captainShellDecision}), so every arm is unit-testable without a harness,
// and the INSTALL is ONE `guardTool` registration through the adapter, beside the investigation guard. The
// mode is `captain.shell` in `mpd.jsonc`: `"deny"` (default, fail-closed) | `"allow"`; the row's boot line
// reports the mode it installed. The session's WORKSPACE ROOT is resolved PER CALL through the adapter
// helper — never cached — because the read-route below judges paths against it (AGENTS.md §6).
//
// HONEST BOUND, stated rather than implied: the decision reads the command STRING, so it only sees the
// spelling a caller wrote — a command assembled at runtime by another program (`sh -c "$(...)"`, a script
// invoked by name) is not decomposed here, and the deny table is a list of command FAMILIES, not a
// taxonomy of every way a gate can be launched. WAVE 2 (contract `.mpd/plans/captain-recon-fence.md`
// §3 C1) removes the SPELLING gap: each segment is reduced by a launcher normaliser before the table
// reads it, so a wrapper (`sudo`, `env FOO=1`), a bare `NAME=value`, an absolute launcher path and a flag
// between `run` and the script name all reach the same row. A PATH-SPELLED wrapper counts too:
// `/usr/bin/env bun test` reduces to `env bun test` and is then stripped. That reduction is TOKEN-based
// too — `bun run --filter x test` is NOT collapsed (a flag's separate value cannot be told from the script
// name), so that spelling remains outside what this table can see. The global `"allow"` mode is the only
// opt-out (contract §2 — no per-command escape).
//
// WAVE 2 §3 C3 — THE SHELL READ-ROUTE, a SECOND decision family that runs only when NO deny row matched.
// When the first token (after the same normalisation) is a READ VERB, the shell is not a reconnaissance
// route either. Tokens are the subject, and SEVEN rules bind it (the four findings and two nits of the
// 2026-11-09 repair, rec-20261109T030449-cae6c8, plus the captain's follow-up repair of the same day —
// the substitution-aware whole-string pass and the `find` stdin exclusion; until then a reasonable
// captain command was refused):
//   1. SEGMENTATION IS QUOTE-AWARE (repair F2): the command splits on top-level `&&`, `||`, `;`, `|` and a
//      newline ONLY outside single/double quotes, with backslash escapes respected — so
//      `grep -E "fix|feat" docs/decisions.md` is ONE segment, its path argument is judged normally, and a
//      refusal never quotes a fragment cut out of a quoted pattern.
//   2. THE FIRST NON-FLAG TOKEN of `rg` / `grep` / `ag` / `ack` is the PATTERN, never a path candidate;
//      `find` has no pattern, so every non-flag token of it is a path candidate; `rg --files` is the ONE
//      mode flag that ALSO takes no pattern (repair F4), so `rg --files docs/` lists a band directory.
//   3. A CANDIDATE IS JUDGED when it EXISTS on disk OR lands inside the documentation band; anything else
//      (a glob, a sed script, a pattern) is IGNORED. A SEARCH with no path candidate at all is REFUSED —
//      the fail-closed whole-workspace rule — UNLESS the segment RECEIVES STDIN (repair F1): a search verb
//      that is not the FIRST stage of its pipeline reads the pipe, so `git log --oneline | grep fix` is
//      allowed while a first-stage `rg foo` stays refused; a piped segment that DOES carry an existing
//      out-of-band path is still judged and refused. The stdin exemption covers ONLY the verbs that really
//      consume stdin (`rg`, `grep`, `ag`, `ack`, repair F5): `find` has no pattern and never reads stdin,
//      and `rg --files` lists the tree, so a piped one is judged exactly like a first-stage one —
//      `git log | find` is a whole-workspace search and stays refused.
//   4. `cd` IS TRACKED across the segments of one command (repair F3) and a later RELATIVE candidate is
//      resolved against it, so `cd packages && cat mpd-roles-plugin/src/index.ts` is refused while
//      `cd docs && cat decisions.md` is allowed; an ABSOLUTE candidate is never rebased. A `cd` whose
//      target cannot be resolved (`cd "$X"`, `cd $(pwd)`, `cd ~`, a bare `cd`) makes every later RELATIVE
//      candidate FAIL CLOSED — the one deliberate over-block on this route.
//   5. A REDIRECT TARGET is a WRITE (repair NIT 1): `> out.txt`, `>> log`, `2>&1` and their attached
//      spellings are stripped before the candidates are read, so a write destination is never judged as a
//      read.
//   6. `sed -i` is a WRITE (repair NIT 2) and writes are not gated on this route: a `sed` carrying the
//      in-place flag bypasses the read-route entirely; a `sed` without it is judged as before.
//   7. THE WHOLE-STRING PASS IS SUBSTITUTION-AWARE (repair A). With no command substitution (`$(` or a
//      backtick) the segmentation is COMPLETE, so the second pass over the whole line is SKIPPED: it could
//      then only judge tokens that belong to ANOTHER segment, and `cat docs/decisions.md && ls packages`
//      was refused for the `packages` that belongs to `ls`. Command substitution is NOT a segment, though
//      — a command it hides never reaches the splitter — so when one IS present the whole line is still
//      judged conservatively, AND every substituted body is judged as its own command with the existence
//      requirement relaxed to path-shaped tokens (`echo $(cat packages/x)` is refused even when `x` does
//      not exist). A command with no substitution can no longer be refused by the second pass.
// A FILE READER with no judged path argument is ALLOWED (stdin/pipeline: `echo hi | cat`). One consequence
// is DELIBERATE: `cat package.json` is now REFUSED — the readable band admits `.mpd/`, `docs/`, `evidence/`,
// `agent-references/`, the instruction files and the named root documents, never arbitrary root metadata.
// DECLARED RESIDUALS (contract §6, accepted): `git show HEAD:package.json` and `git grep` are NOT read
// verbs, so they stay open; closing that class is a different problem and out of scope. The rule reads
// TOKENS, so a path assembled at runtime (`cat "$F"`) is not judged — the literal `$F` is not a file — while
// a token's surrounding quotes ARE stripped before the existence probe, so `cat "packages/x.ts"` is judged
// like the bare spelling. `cd` TRACKING IS PER CALL: the guard is stateless, so a `cd` run in an EARLIER
// bash call is not remembered, only the segments of the command string under judgement are.
// `rg --files` is the ONLY mode flag recognised (no general flag table), and a `cd` target carrying a `..`
// hop above the workspace root is treated as unresolvable rather than guessed.
import { existsSync } from "node:fs"
import { join } from "node:path"
import type { DshAdapter, DshToolExec } from "../../mpd-dsh-adapter-plugin/src/index"
import { captainReadablePath } from "./captain-investigation.ts"
import { sessionIsMpdCaptain } from "./complexity-gate.ts"

/** The `mpd.jsonc` key the modes are read from, through the config layer this bundle already uses. */
export const CAPTAIN_SHELL_CONFIG_KEY = "captain.shell"

/** The two modes `captain.shell` accepts; anything else reads as {@link DEFAULT_CAPTAIN_SHELL_MODE}. */
export type CaptainShellMode = "deny" | "allow"

/** The mode a session gets when `mpd.jsonc` says nothing: the contract's own default, fail-closed. */
export const DEFAULT_CAPTAIN_SHELL_MODE: CaptainShellMode = "deny"

/**
 * The shell tools this rule gates.
 *
 * The contract names the three spellings a harness may register: POSIX `bash` and the two PowerShell
 * ids. A composition that registers none of them simply never matches — the rule is scoped by NAME, not
 * by any assumption that a shell exists.
 */
export const CAPTAIN_SHELL_TOOLS: readonly string[] = ["bash", "powershell", "pwsh"]

/** One row of the deny table: the command family it names and how its refusal should read. */
export interface CaptainShellDenyPattern {
  /** The stable short name of the command family, used in tests and logs (never on the model-facing line). */
  readonly label: string
  /** The anchored, case-insensitive matcher; the optional `sudo` prefix is part of every row (contract §3 C1). */
  readonly pattern: RegExp
  /** Whether the family produces gate evidence, which the refusal sentence then names (`mpd_verify_evidence`, C2). */
  readonly gateShaped: boolean
}

/**
 * The deny table: contract §3 C1's v1 rows in contract order, plus ONE repair row added below.
 *
 * Every pattern is ANCHORED at the segment start and allows one optional `sudo` prefix, so `cd x && bun
 * test` is caught per segment while `echo "bun test"` is not — the rule refuses a command, never the
 * mention of one. `npm pack` and `docker` are launch/package chores rather than gate evidence, which is
 * why they do not carry the `mpd_verify_evidence` clause.
 *
 * `bun-run-typecheck` was added 2026-11-09 by the Reviewer's finding on the C1 wave: the root `typecheck`
 * script is gate evidence, yet neither `bun-run-gate` (which requires a `verify`/`test` prefix) nor `tsc`
 * (which matches the BINARY, not the script name) caught it while the persona already refused it.
 *
 * WAVE 2 (contract `.mpd/plans/captain-recon-fence.md` §3 C1) APPENDS the six launcher spellings wave 1's
 * literal table missed: npm, npx, pnpm and yarn invocations of a gate script, plus a bare `bun typecheck`.
 * Because {@link matchCaptainShellDeny} reduces every segment through
 * {@link normaliseCaptainShellSegment} FIRST, the optional-`sudo` prefix each row still carries is now
 * belt-and-braces rather than the only wrapper handled.
 */
export const CAPTAIN_SHELL_DENY_PATTERNS: readonly CaptainShellDenyPattern[] = [
  { label: "bun-test", pattern: /^(?:sudo\s+)?bun\s+test\b/i, gateShaped: true },
  { label: "bun-run-gate", pattern: /^(?:sudo\s+)?bun\s+run\s+(?:verify|test)[:_]/i, gateShaped: true },
  { label: "bun-run-typecheck", pattern: /^(?:sudo\s+)?bun\s+run\s+typecheck\b/i, gateShaped: true },
  { label: "node-verify-script", pattern: /^(?:sudo\s+)?node\s+scripts\/verify-/i, gateShaped: true },
  {
    label: "node-release-script",
    pattern: /^(?:sudo\s+)?node\s+scripts\/(?:repin-vendor|pack-mpd|docker-e2e|install-profile)/i,
    gateShaped: true,
  },
  { label: "qa-scripts", pattern: /^(?:sudo\s+)?(?:bun|node)\s+skills\/dsh-qa\/scripts\//i, gateShaped: true },
  { label: "npm-pack", pattern: /^(?:sudo\s+)?npm\s+(?:pack|run\s+pack)\b/i, gateShaped: false },
  { label: "docker", pattern: /^(?:sudo\s+)?docker\b/i, gateShaped: false },
  { label: "tsc", pattern: /^(?:sudo\s+)?(?:bun|node|npx)\s+.*\btsc\b/i, gateShaped: true },
  { label: "bun-build", pattern: /^(?:sudo\s+)?bun\s+build\s+packages\//i, gateShaped: true },
  // WAVE 2 — the launcher spellings wave 1 missed (contract §3 C1). Appended AFTER the v1 rows so no
  // existing label changes owner; every one is gate-shaped, so each refusal names `mpd_verify_evidence`.
  { label: "npm-test", pattern: /^(?:sudo\s+)?npm\s+(?:run\s+)?(?:test|typecheck)\b/i, gateShaped: true },
  { label: "npm-run-gate", pattern: /^(?:sudo\s+)?npm\s+run\s+(?:verify|test)[:_]/i, gateShaped: true },
  { label: "npx-runner", pattern: /^(?:sudo\s+)?npx\s+(?:tsc|tsgo|jest|vitest|mocha)\b/i, gateShaped: true },
  { label: "bun-typecheck", pattern: /^(?:sudo\s+)?bun\s+typecheck\b/i, gateShaped: true },
  { label: "pnpm-test", pattern: /^(?:sudo\s+)?pnpm\s+(?:run\s+)?(?:test|typecheck)\b/i, gateShaped: true },
  { label: "yarn-test", pattern: /^(?:sudo\s+)?yarn\s+(?:run\s+)?(?:test|typecheck)\b/i, gateShaped: true },
]

/** The longest command segment the refusal quotes, so the sentence stays inside the contract's 600-character bound. */
const MAX_QUOTED_SEGMENT = 140

/**
 * Read `captain.shell` as a mode.
 *
 * FAIL-CLOSED, by design and mirroring `resolveInvestigationMode`: only the exact string `"allow"` turns
 * the rule off, so a typo, an absent key or a value of another type leaves the captain's shell denied
 * rather than silently permitted.
 *
 * @param raw - the raw config value.
 * @returns `"allow"` for the exact opt-out spelling, `"deny"` otherwise.
 */
export function resolveCaptainShellMode(raw: unknown): CaptainShellMode {
  return raw === "allow" ? "allow" : "deny"
}

/** One top-level segment of a shell command, carrying the pipeline fact the read-route needs (repair F1). */
export interface CaptainShellSegment {
  /** The segment exactly as the caller wrote it, minus the whitespace the separators left around it. */
  readonly text: string
  /** True when a single `|` (or `|&`) precedes this segment, so the command reads STDIN, not the tree. */
  readonly fedByPipe: boolean
}

/**
 * Split one command string into its top-level segments, QUOTE-AWARE (contract §3 C3, repair F2).
 *
 * The separators are `&&`, `||`, `;`, `|` and a newline, and they split ONLY outside single/double quotes:
 * `grep -E "fix|feat" docs/decisions.md` is one segment, so the `|` inside the pattern can never cut the
 * command into a fragment a refusal would then quote. A backslash escapes the next character outside
 * quotes and inside double quotes (inside single quotes it is literal, as POSIX says), and a single `|`
 * (or the `|&` spelling) marks the FOLLOWING segment as fed by a pipe.
 *
 * @param command - the raw `command` argument of a shell call.
 * @returns the non-empty, trimmed segments in command order, each with its pipeline fact.
 */
export function splitCaptainShellSegments(command: string): CaptainShellSegment[] {
  /** The segments closed so far, in command order. */
  const segments: CaptainShellSegment[] = []
  /** The segment being accumulated, separators removed. */
  let current = ""
  /** The quote run the scanner is inside, or `null` at top level. */
  let quote: "\"" | "'" | null = null
  /** Whether the segment being accumulated is fed by a pipe; it becomes the NEXT segment's flag on a flush. */
  let fedByPipe = false
  /**
   * Close the accumulator into {@link segments} when it holds a non-blank command.
   *
   * @param nextFedByPipe - whether the segment AFTER this one is fed by a pipe.
   */
  const flush = (nextFedByPipe: boolean): void => {
    /** The accumulated segment without the whitespace the separators left behind. */
    const text = current.trim()
    if (text !== "") segments.push({ text, fedByPipe })
    current = ""
    fedByPipe = nextFedByPipe
  }
  for (let index = 0; index < command.length; index += 1) {
    /** The character the scanner is looking at. */
    const char = command[index] ?? ""
    // INSIDE SINGLE QUOTES only the closing quote is special; a backslash is literal there (POSIX).
    if (quote === "'") {
      current += char
      if (char === "'") quote = null
      continue
    }
    // INSIDE DOUBLE QUOTES a backslash escapes one character and the closing quote ends the run.
    if (quote === "\"") {
      current += char
      if (char === "\\" && index + 1 < command.length) {
        current += command[index + 1] ?? ""
        index += 1
      } else if (char === "\"") quote = null
      continue
    }
    // OUTSIDE QUOTES a backslash escapes one character, so `\;` and `\|` are arguments, not separators.
    if (char === "\\") {
      current += char
      if (index + 1 < command.length) {
        current += command[index + 1] ?? ""
        index += 1
      }
      continue
    }
    if (char === "'" || char === "\"") {
      quote = char
      current += char
      continue
    }
    // THE SEPARATORS: `&&`, `||` and `;` end a command (the next one is NOT fed), a single `|` ends one and
    // FEEDS the next, and a newline ends one. `\r` is dropped so a CRLF newline behaves like a bare one.
    if (char === "&" && command[index + 1] === "&") {
      flush(false)
      index += 1
      continue
    }
    if (char === "|" && command[index + 1] === "|") {
      flush(false)
      index += 1
      continue
    }
    if (char === "|") {
      /** True for the `|&` spelling, which pipes stdout AND stderr into the next stage. */
      const withStderr = command[index + 1] === "&"
      flush(true)
      if (withStderr) index += 1
      continue
    }
    if (char === ";") {
      flush(false)
      continue
    }
    if (char === "\n") {
      flush(false)
      continue
    }
    if (char === "\r") continue
    current += char
  }
  flush(false)
  return segments
}

/**
 * Split one command string into the segments the deny table tests.
 *
 * The deny table reads plain text, so this is {@link splitCaptainShellSegments} projected to its texts —
 * the pipeline fact stays available to the read-route, which is the only family that needs it (repair F1).
 *
 * @param command - the raw `command` argument of a shell call.
 * @returns the non-empty, trimmed segments in command order.
 */
export function captainShellSegments(command: string): string[] {
  return splitCaptainShellSegments(command).map((segment) => segment.text)
}

/**
 * The wrapper commands stripped from the front of a segment, repeatedly (contract §3 C1 step 1).
 *
 * `env` is ALSO in the step-3 binary list, so the path-spelled wrapper is the same wrapper:
 * `/usr/bin/env bun test` reduces to `env bun test` and is then stripped here (2026-11-09 addendum).
 */
const SHELL_WRAPPER_COMMANDS: readonly string[] = ["sudo", "command", "exec", "time", "nohup", "builtin", "env"]

/** The `sudo` short options that consume a SEPARATE argument, so `sudo -u root bun test` still reaches the binary. */
const SUDO_ARGUMENT_FLAGS: readonly string[] = ["-u", "-g", "-C", "-D", "-h", "-p", "-r", "-t", "-T", "-U"]

/**
 * The binary basenames an ABSOLUTE launcher path is reduced to (contract §3 C1 step 3); a relative path is
 * never reduced. `env` is here as well as in {@link SHELL_WRAPPER_COMMANDS}: `/usr/bin/env` spells the same
 * wrapper, and reducing it lets step 1 remove it (2026-11-09 addendum).
 */
const LAUNCHER_BINARY_BASENAMES: readonly string[] = ["bun", "node", "npm", "npx", "tsc", "tsgo", "deno", "pnpm", "yarn", "env"]

/** A leading `NAME=value` shell assignment, which is not part of the command it prefixes (contract §3 C1 step 2). */
const SHELL_ASSIGNMENT_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*=/

/** Flags between `run` and the script name, collapsed so the `run` rows read the script (contract §3 C1 step 4). */
const RUN_SCRIPT_FLAGS_PATTERN = /\brun\s+(?:-\S+\s+)+/gi

/**
 * Reduce one leading token from an ABSOLUTE launcher path to its basename.
 *
 * `./script.sh` and `bin/bun` are RELATIVE spellings and are returned untouched: only a path that starts
 * at the filesystem root is a spelling of the launcher (contract §3 C1 step 3).
 *
 * @param token - the segment's current leading token.
 * @returns the launcher's basename when the token is an absolute path to a known launcher, else the token unchanged.
 */
function reduceLauncherPath(token: string): string {
  if (!token.startsWith("/")) return token
  /** The launcher name the absolute path ends in, lowercased for the case-insensitive list. */
  const basename = token.slice(token.lastIndexOf("/") + 1).toLowerCase()
  return LAUNCHER_BINARY_BASENAMES.includes(basename) ? basename : token
}

/**
 * Reduce one command segment to the canonical launcher spelling the deny table matches (contract §3 C1).
 *
 * The pipeline is applied from the FRONT only, in the contract's order and to a fixed point: wrapper
 * commands with their own flags/assignments, leading `NAME=value` tokens, an absolute launcher path, then
 * the flags that may sit between `run` and the script name. Internal whitespace collapses to one space,
 * because only prefix tokens are read here — the REFUSAL still quotes the segment as the caller wrote it.
 *
 * The reduction is TOKEN-based (contract §6): a command assembled at runtime is not seen, and a `run` flag
 * that takes a SEPARATE value (`bun run --filter x test`) is not collapsed, because its value cannot be
 * told from the script name.
 *
 * @param segment - one command segment, as the splitter produced it.
 * @returns the canonical spelling the deny table reads; an empty string when the segment held only wrappers.
 */
export function normaliseCaptainShellSegment(segment: string): string {
  /** The segment's remaining tokens; the prefix is consumed from the front of this list. */
  let tokens = segment.trim().split(/\s+/u).filter((token) => token !== "")
  /** Whether the last pass still reduced something; the loop stops at the first fixed point. */
  let reduced = true
  while (reduced && tokens.length > 0) {
    reduced = false
    /** The current leading token, lowercased for the case-insensitive wrapper/launcher tests. */
    const head = (tokens[0] ?? "").toLowerCase()
    // STEP 1 — a wrapper command, its own flags and any assignment that follows it.
    if (SHELL_WRAPPER_COMMANDS.includes(head)) {
      tokens.shift()
      reduced = true
      while (tokens.length > 0) {
        /** The token after the wrapper: one of its flags or an assignment, never the command itself. */
        const next = tokens[0] ?? ""
        if (next.startsWith("-")) {
          tokens.shift()
          // A sudo option whose value is a SEPARATE token must take that token with it, or the value
          // (`root` in `sudo -u root bun test`) would be read as the command name.
          if (head === "sudo" && SUDO_ARGUMENT_FLAGS.includes(next.toLowerCase())) tokens.shift()
          continue
        }
        if (!SHELL_ASSIGNMENT_PATTERN.test(next)) break
        tokens.shift()
      }
      continue
    }
    // STEP 2 — a leading shell assignment (`FOO=1 bun test`).
    if (SHELL_ASSIGNMENT_PATTERN.test(tokens[0] ?? "")) {
      tokens.shift()
      reduced = true
      continue
    }
    // STEP 3 — an ABSOLUTE launcher path (`/usr/local/bin/bun test`).
    /** The leading token reduced to a launcher basename when it is an absolute path to one. */
    const reducedHead = reduceLauncherPath(tokens[0] ?? "")
    if (reducedHead !== tokens[0]) {
      tokens[0] = reducedHead
      reduced = true
      continue
    }
    break
  }
  // STEP 4 — flags between `run` and the script name, applied to the joined spelling so `run` is read as a
  // word; the result is re-split because collapsing a flag can join two tokens.
  /** The prefix-reduced spelling, before the `run` flags are collapsed. */
  const joined = tokens.join(" ")
  /** The same spelling with the script-side flags removed (a no-op for every command without `run`). */
  const collapsed = joined.replace(RUN_SCRIPT_FLAGS_PATTERN, "run ")
  return collapsed.split(/\s+/u).filter((token) => token !== "").join(" ")
}

/**
 * Match one command string against the deny table, first row winning.
 *
 * The segment is reduced through {@link normaliseCaptainShellSegment} FIRST, so the table is written
 * against one canonical launcher spelling and a wrapper/assignment/absolute-path spelling cannot slip past
 * a literal row (contract §3 C1).
 *
 * @param segment - one command segment (or the whole command string); normalised here, not by the caller.
 * @returns the matched deny-table row, or `undefined` when the segment is not a verification command.
 */
export function matchCaptainShellDeny(segment: string): CaptainShellDenyPattern | undefined {
  /** The segment in the canonical launcher spelling every row is written against (contract §3 C1). */
  const normalised = normaliseCaptainShellSegment(segment)
  for (const entry of CAPTAIN_SHELL_DENY_PATTERNS) {
    if (entry.pattern.test(normalised)) return entry
  }
  return undefined
}

// ─── THE READ-ROUTE (wave 2, contract `.mpd/plans/captain-recon-fence.md` §3 C3) ───────────────────────
// The second decision family: a READ VERB on a path outside the documentation band is reconnaissance, and
// reconnaissance is delegated. It runs only when no deny row matched, so the deny table keeps precedence.

/** The SEARCH verbs whose FIRST non-flag token is the PATTERN, never a path candidate (contract §3 C3). */
const READ_VERB_PATTERN_FIRST: readonly string[] = ["rg", "grep", "ag", "ack"]

/** The SEARCH verbs with no pattern at all: every non-flag token of them is a path candidate (contract §3 C3). */
const READ_VERB_NO_PATTERN: readonly string[] = ["find"]

/** The FILE READERS: every EXISTING non-flag token is judged, and a reader with none is allowed (stdin). */
const READ_VERB_FILE_READERS: readonly string[] = [
  "cat", "head", "tail", "less", "more", "sed", "awk", "strings", "xxd", "od", "nl",
]

/** The shell verbs the read-route judges (contract §3 C3's sixteen), exported so a test can iterate them all. */
export const CAPTAIN_SHELL_READ_VERBS: readonly string[] = [
  ...READ_VERB_PATTERN_FIRST,
  ...READ_VERB_NO_PATTERN,
  ...READ_VERB_FILE_READERS,
]

/** The ONE mode flag that takes no pattern: `rg --files` lists files, so every non-flag token is a path (F4). */
const RG_FILES_MODE_FLAG = "--files"

/** A redirect OPERATOR in its own token (`>`, `>>`, `2>`, `2>>`, `&>`), whose target is the NEXT token (NIT 1). */
const REDIRECT_OPERATOR_PATTERN = /^(?:\d*|&)>>?$/u

/** A redirect with its target ATTACHED (`>out.txt`, `2>log`, `2>&1`, `&>log`), dropped as one token (NIT 1). */
const REDIRECT_ATTACHED_PATTERN = /^(?:\d*|&)>>?\S+$/u

/** The `sed` in-place flag in both spellings: the short cluster (`-i`, `-ni`, `-i.bak`) and `--in-place` (NIT 2). */
const SED_IN_PLACE_PATTERN = /^(?:-[a-zA-Z]*i|--in-place(?:=|$))/u

/** The characters that make a `cd` target UNRESOLVABLE rather than literal: expansion, globbing and HOME (F3). */
const CD_DYNAMIC_TARGET_CHARS: readonly string[] = ["$", "`", "(", ")", "*", "?", "[", "]", "~"]

/**
 * Whether one read-route token is spelled as an ABSOLUTE path, which a tracked `cd` never rebases (F3).
 *
 * @param token - a non-flag read-route token, quotes already stripped.
 * @returns true for a POSIX or drive-letter absolute spelling.
 */
function isAbsolutePathToken(token: string): boolean {
  return token.startsWith("/") || /^[a-zA-Z]:[\\/]/u.test(token)
}

/**
 * Remove the tokens a REDIRECT contributes, so a write destination is never read as a read candidate (NIT 1).
 *
 * The operator form consumes the token after it (`> out.txt`); the attached form is one token already
 * (`>out.txt`, `2>&1`) and is dropped alone. The OPERATOR test runs first because `>>` would otherwise also
 * satisfy the attached form (`>>?` may match one `>` and leave the other to `\S+`). A QUOTED `">"` is not an
 * operator — the quotes are still on the token here — so an argument that merely spells one survives.
 *
 * @param tokens - the non-flag tokens of one read-verb segment, quotes still attached.
 * @returns the tokens with every redirect operator and its target removed.
 */
function stripRedirectTargets(tokens: readonly string[]): string[] {
  /** The tokens that are not part of a redirect. */
  const kept: string[] = []
  for (let index = 0; index < tokens.length; index += 1) {
    /** The token under inspection, quotes still attached. */
    const token = tokens[index] ?? ""
    if (REDIRECT_OPERATOR_PATTERN.test(token)) {
      index += 1
      continue
    }
    if (REDIRECT_ATTACHED_PATTERN.test(token)) continue
    kept.push(token)
  }
  return kept
}

/**
 * Whether one `sed` token carries the in-place flag, which makes the command a WRITE (NIT 2).
 *
 * @param token - one non-flag token of the segment, as `sed` would receive it.
 * @returns true for `-i`, a short cluster ending in `i`, an `-i` with a backup suffix, or `--in-place`.
 */
function isSedInPlaceFlag(token: string): boolean {
  return SED_IN_PLACE_PATTERN.test(token)
}

/**
 * Resolve a LITERAL `cd` target against the directory a previous `cd` left behind (repair F3).
 *
 * `.` and empty segments are dropped and `..` pops one level, so the result is a normalised
 * workspace-relative directory with no leading or trailing separator.
 *
 * @param cwd - the workspace-relative directory a relative target starts from (`""` is the workspace root).
 * @param target - the literal target as the caller spelled it, quotes already stripped.
 * @returns the resolved workspace-relative directory, or `undefined` when a `..` climbs above the root.
 */
function resolveRelativeDirectory(cwd: string, target: string): string | undefined {
  /** The resolved path segments, mutated as the target is walked. */
  const parts = cwd === "" ? [] : cwd.split("/")
  for (const piece of target.replace(/\\/g, "/").split("/")) {
    if (piece === "" || piece === ".") continue
    if (piece === "..") {
      if (parts.length === 0) return undefined
      parts.pop()
      continue
    }
    parts.push(piece)
  }
  return parts.join("/")
}

/** The directory state the read-route carries across the segments of ONE command (repair F3). */
interface CaptainShellDirectoryState {
  /** The workspace-relative directory a RELATIVE candidate resolves against (`""` is the workspace root). */
  readonly cwd: string
  /** True when a `cd` target could not be resolved, which makes every later relative candidate fail closed. */
  readonly dynamic: boolean
}

/**
 * Read one segment as a `cd` and return the directory state it leaves behind (repair F3).
 *
 * The target must be LITERAL: a `$`/backtick/parenthesis expansion, a glob, a `~` (HOME is not the
 * workspace), a bare `cd` (HOME) or `cd -` (OLDPWD) is UNRESOLVABLE, and an absolute target is resolvable
 * only when it lands inside the workspace root. Anything unresolvable sets the fail-closed flag rather
 * than guessing, because a later relative candidate would otherwise be judged against the wrong directory.
 *
 * @param segment - one command segment as the splitter produced it.
 * @param workspaceRoot - the session workspace root the tracked directory is relative to.
 * @param state - the directory state the previous segments left behind.
 * @returns the state this segment leaves, or `undefined` when the segment is not a `cd`.
 */
function applyCaptainShellCd(
  segment: string,
  workspaceRoot: string,
  state: CaptainShellDirectoryState,
): CaptainShellDirectoryState | undefined {
  /** The segment's tokens in the canonical launcher spelling, so a wrapper cannot hide the verb. */
  const tokens = normaliseCaptainShellSegment(segment).split(/\s+/u).filter((token) => token !== "")
  if ((tokens[0] ?? "").toLowerCase() !== "cd") return undefined
  if (state.dynamic) return state
  /** The target tokens, with `cd`'s own flags (`-P`, `--`) removed; a lone `-` is OLDPWD and leaves none. */
  const targets = tokens.slice(1).filter((token) => !token.startsWith("-"))
  /** The target with one layer of shell quotes removed, or `undefined` when the caller gave none. */
  const target = targets.length === 0 ? undefined : stripSurroundingQuotes(targets[0] ?? "")
  if (target === undefined || target === "") return { cwd: "", dynamic: true }
  if ([...target].some((char) => CD_DYNAMIC_TARGET_CHARS.includes(char))) return { cwd: "", dynamic: true }
  if (isAbsolutePathToken(target)) {
    /** The target normalised to POSIX with no trailing separator. */
    const normalisedTarget = target.replace(/\\/g, "/").replace(/\/+$/u, "")
    /** The workspace root, normalised the same way. */
    const root = workspaceRoot.replace(/\\/g, "/").replace(/\/+$/u, "")
    if (root === "" || (normalisedTarget !== root && !normalisedTarget.startsWith(root + "/"))) {
      return { cwd: "", dynamic: true }
    }
    if (normalisedTarget === root) return { cwd: "", dynamic: false }
    /** The workspace-relative spelling of the absolute target. */
    const relative = resolveRelativeDirectory("", normalisedTarget.slice(root.length + 1))
    return relative === undefined ? { cwd: "", dynamic: true } : { cwd: relative, dynamic: false }
  }
  /** The workspace-relative directory the literal target names, or `undefined` when it leaves the root. */
  const next = resolveRelativeDirectory(state.cwd, target)
  return next === undefined ? { cwd: "", dynamic: true } : { cwd: next, dynamic: false }
}

/**
 * Strip ONE layer of matching surrounding quotes from a read-route token, the way a POSIX shell would.
 *
 * A quoted SOURCE path must be judged like the bare spelling (`cat "packages/x.ts"`), while `cat "$F"`
 * stays unjudged because the stripped token `$F` names no file — the token-based bound in the module header.
 *
 * @param token - one non-flag token of a read-verb segment.
 * @returns the token without its matching outer quotes, or the token unchanged.
 */
function stripSurroundingQuotes(token: string): string {
  if (token.length < 2) return token
  /** The token's first character, which decides whether the last one closes a quote. */
  const first = token[0]
  if ((first === '"' || first === "'") && token.endsWith(first)) return token.slice(1, -1)
  return token
}

/** The two COMMAND-SUBSTITUTION openers the splitter cannot see: the `$(` form and the backtick form. */
const COMMAND_SUBSTITUTION_OPENERS: readonly string[] = ["$(", "`"]

/**
 * Whether one command string carries a COMMAND SUBSTITUTION anywhere in it (repair A).
 *
 * The splitter knows only the top-level separators, so a substitution is NOT a segment: the command it
 * hides (`echo $(cat packages/x)`) is invisible to the per-segment pass and is why the whole-string pass
 * stays. This probe decides whether that pass runs at all: without a substitution the segmentation is
 * COMPLETE, so a second pass over the whole line could only judge tokens that belong to another segment.
 *
 * The probe is deliberately QUOTE-BLIND: a backtick inside single quotes is literal to a POSIX shell, yet
 * it still selects the conservative pass. That direction is fail-closed (the pass adds only refusals for a
 * substitution-bearing string), which is the contract's accepted bias for this route.
 *
 * @param command - the raw `command` argument of a shell call.
 * @returns true when the string contains `$(` or a backtick.
 */
function hasCommandSubstitution(command: string): boolean {
  return COMMAND_SUBSTITUTION_OPENERS.some((opener) => command.includes(opener))
}

/**
 * Extract the command bodies of every command substitution in one string (repair A).
 *
 * `$(` bodies are closed by the matching `)` at the same NESTING depth, so a nested `$(cat $(pwd)/x)` is
 * one body; a backtick body ends at the next unescaped backtick. A backslash escapes the next character,
 * so `\$(` is literal text. An UNCLOSED opener yields no body for itself (and ends the scan): a shell
 * would not run it as a complete command, and the segment pass still sees the literal text. Each body is
 * also scanned recursively, so a substitution nested in the other spelling contributes its own body.
 *
 * @param command - the raw `command` argument of a shell call, or one body already extracted from it.
 * @returns the substituted command bodies in command order, delimiters removed.
 */
function captainShellSubstitutionBodies(command: string): string[] {
  /** The bodies found so far, in command order; a nested substitution appends its own body too. */
  const bodies: string[] = []
  for (let index = 0; index < command.length; index += 1) {
    /** The character the scanner is looking at. */
    const char = command[index] ?? ""
    // A BACKSLASH escapes the next character, so an escaped opener is literal text rather than a command.
    if (char === "\\") {
      index += 1
      continue
    }
    if (char === "`") {
      /** The index of the closing backtick, or -1 when this substitution is never closed. */
      let close = -1
      for (let scan = index + 1; scan < command.length; scan += 1) {
        /** The character inside the candidate body. */
        const inner = command[scan] ?? ""
        if (inner === "\\") {
          scan += 1
          continue
        }
        if (inner === "`") {
          close = scan
          break
        }
      }
      if (close === -1) break
      /** The command the backticks would run in a POSIX shell. */
      const body = command.slice(index + 1, close)
      bodies.push(body, ...captainShellSubstitutionBodies(body))
      index = close
      continue
    }
    if (char !== "$" || command[index + 1] !== "(") continue
    /** The nesting depth, starting just inside the outer `(`. */
    let depth = 1
    /** The index of the `)` that closes the outer `(`, or -1 when this substitution is never closed. */
    let close = -1
    for (let scan = index + 2; scan < command.length; scan += 1) {
      /** The character inside the candidate body. */
      const inner = command[scan] ?? ""
      if (inner === "\\") {
        scan += 1
        continue
      }
      if (inner === "(") depth += 1
      if (inner === ")") {
        depth -= 1
        if (depth === 0) {
          close = scan
          break
        }
      }
    }
    if (close === -1) break
    /** The command the `$( … )` would run in a POSIX shell. */
    const body = command.slice(index + 2, close)
    bodies.push(body, ...captainShellSubstitutionBodies(body))
    index = close
  }
  return bodies
}

/**
 * Judge one command-substitution body as the command it would run (repair A).
 *
 * A substitution hides its command from the splitter, so this is the ONLY pass that sees it. The body is
 * judged through the ordinary read-route with the EXISTENCE requirement relaxed: a token carrying a path
 * separator is judged even when it names no file on disk (`echo \`cat packages/x.ts\`` is refused), because
 * the substitution is exactly the spelling a caller could use to hide a source read. The trade is the
 * route's accepted one — a conservative refusal, never an unjudged read.
 *
 * @param body - one substituted command, delimiters already removed.
 * @param context - the band, the disk probe and the tracked directory of the enclosing segment.
 * @returns the refusal sentence, or `undefined` when the substitution reads inside the documentation band.
 */
function captainShellSubstitutionReadRefusal(body: string, context: CaptainShellReadContext): string | undefined {
  /** The disk probe with the existence requirement relaxed: a token with a `/` is a path candidate. */
  const pathExists = (raw: string): boolean => raw.includes("/") || context.pathExists(raw)
  return captainShellReadViolation(body, {
    workspaceRoot: context.workspaceRoot,
    pathExists,
    fedByPipe: false,
    cwd: context.cwd,
    cwdDynamic: context.cwdDynamic,
  })
}

/**
 * The sentence a read-route refusal carries: WHY, the reconnaissance route out and the configuration opt-out.
 *
 * The quoted segment is capped at {@link MAX_QUOTED_SEGMENT} characters so the whole sentence stays inside
 * the contract's 600-character bound, exactly like the deny-table sentence.
 *
 * @param segment - the offending command segment as written.
 * @returns the denial sentence naming `mpd_role_spawn {role:"Explorer"}`.
 */
function captainShellReadRefusalText(segment: string): string {
  /** The command as the model should see it: verbatim unless it is too long to quote inside the bound. */
  const shown = segment.length > MAX_QUOTED_SEGMENT ? segment.slice(0, MAX_QUOTED_SEGMENT - 1) + "…" : segment
  return "[mpd-roles] captain shell: REFUSED — \"" + shown + "\" reads workspace content through the shell, and"
    + " reconnaissance is not the captain's job. Delegate it: mpd_role_spawn {role:\"Explorer\", task:\"find what"
    + " you need and report it\"}. The documentation band (.mpd/, docs/, evidence/, agent-references/), the"
    + " instruction files and the named root documents stay readable; captain.shell:\"allow\" in mpd.jsonc is"
    + " the configuration opt-out."
}

/** Everything one read-route judgement needs: the band to judge against, the disk probe and the pipeline state. */
export interface CaptainShellReadContext {
  /** The session workspace root the readable band is judged against. */
  readonly workspaceRoot: string
  /** Whether one RESOLVED token exists on disk; an absolute token is probed as written. */
  readonly pathExists: (raw: string) => boolean
  /** True when a single `|` feeds this segment, so a PATTERN-TAKING search with no path reads STDIN (F1/F5). */
  readonly fedByPipe: boolean
  /** The workspace-relative directory a relative candidate resolves against, tracked from `cd` (repair F3). */
  readonly cwd: string
  /** True when an earlier `cd` was unresolvable, so every later relative candidate fails closed (repair F3). */
  readonly cwdDynamic: boolean
}

/**
 * Judge one command segment against the read-route (contract §3 C3, as repaired 2026-11-09).
 *
 * The six PER-SEGMENT rules of the module header are implemented here: quote-aware tokens (the splitter
 * ran before this call), pattern-first verbs, `rg --files`, redirect stripping, the `sed -i` write bypass,
 * the per-command `cd`, and the stdin exemption for a piped search. Rule 7 (the substitution-aware
 * whole-string pass) lives in {@link captainShellDecision}, which also feeds each substituted body through
 * this function. A candidate is JUDGED when it exists on disk OR lands inside the documentation band;
 * anything else is IGNORED, which is what keeps a sed script (`'1,10p'`) and a find glob (`'*.md'`) out of
 * the rule.
 *
 * @param segment - one command segment as the quote-aware splitter produced it.
 * @param context - the band, the disk probe, the pipeline fact and the tracked directory.
 * @returns the refusal sentence, or `undefined` when the segment is not a read-route violation.
 */
export function captainShellReadViolation(segment: string, context: CaptainShellReadContext): string | undefined {
  /** The segment's tokens in the canonical launcher spelling, so a wrapper cannot hide the verb. */
  const tokens = normaliseCaptainShellSegment(segment).split(/\s+/u).filter((token) => token !== "")
  /** The command verb, lowercased for the case-insensitive table. */
  const verb = (tokens[0] ?? "").toLowerCase()
  // NIT 2 — AN IN-PLACE `sed` IS A WRITE, and writes are not gated on this route: a model that edits a file
  // is not reading it, and the deny table already owns the gate commands.
  if (verb === "sed" && tokens.slice(1).some((token) => isSedInPlaceFlag(token))) return undefined
  if (!CAPTAIN_SHELL_READ_VERBS.includes(verb)) return undefined
  // A REDIRECT TARGET IS A WRITE DESTINATION, never a read candidate (NIT 1), so it leaves the token list
  // before anything is judged; quotes are removed only for the tokens that survive.
  const nonFlags = stripRedirectTargets(tokens.slice(1).filter((token) => !token.startsWith("-")))
    .map(stripSurroundingQuotes)
  // `rg --files` is the ONE mode flag that takes NO pattern (F4), so it must not donate the first non-flag
  // token to the pattern slot the way a plain `rg` does.
  const filesMode = verb === "rg" && tokens.slice(1).some((token) => token === RG_FILES_MODE_FLAG)
  /** True when this verb's FIRST non-flag token is its pattern, never a path candidate (rule 2). */
  const patternFirst = READ_VERB_PATTERN_FIRST.includes(verb) && !filesMode
  /** True when this verb SEARCHES, so an empty path set means the WHOLE workspace is searched (rule 3). */
  const search = patternFirst || filesMode || READ_VERB_NO_PATTERN.includes(verb)
  /** The path candidates: a pattern-first verb consumes its FIRST non-flag token as the pattern. */
  const candidates = patternFirst ? nonFlags.slice(1) : nonFlags
  /** How many candidates this rule could JUDGE — a real path on disk, or a spelling inside the band. */
  let judged = 0
  for (const raw of candidates) {
    // F3 — AFTER AN UNRESOLVABLE `cd` a relative token can no longer be proven to point where it is spelled,
    // so it fails CLOSED. Absolute spellings are unaffected: a `cd` never rebases them.
    if (!isAbsolutePathToken(raw) && context.cwdDynamic) return captainShellReadRefusalText(segment)
    /** The token with the tracked `cd` applied; an absolute token is judged exactly as written (rule 4). */
    const resolved = isAbsolutePathToken(raw) || context.cwd === "" ? raw : context.cwd + "/" + raw
    /** True when the resolved token names something on disk — one of the two kinds of evidence of a path. */
    const exists = context.pathExists(resolved)
    /** True when the resolved spelling lands inside the documentation band WITHOUT the disk being consulted. */
    const inBand = captainReadablePath(context.workspaceRoot, resolved)
    // ANYTHING THAT IS NEITHER is a glob, a script, a pattern or a spelling the disk cannot confirm: IGNORED,
    // which is what keeps `find docs -name '*.md'` and `sed -n '1,10p' docs/x` allowed.
    if (!exists && !inBand) continue
    judged += 1
    if (!inBand) return captainShellReadRefusalText(segment)
  }
  if (judged > 0) return undefined
  // A SEARCH WITH NO PATH IS A WHOLE-WORKSPACE SEARCH, refused before any path is judged: that is what makes
  // a first-stage `rg foo` refused and `rg foo docs/` allowed (rule 3). ONLY the PATTERN-TAKING searches
  // (`rg`/`grep`/`ag`/`ack`) read STDIN when a pipe feeds them (repairs F1 and F5): `find` and `rg --files`
  // take no pattern and never read stdin, so a piped one searches the tree exactly like a first-stage one.
  return search && !(patternFirst && context.fedByPipe) ? captainShellReadRefusalText(segment) : undefined
}

/** Everything {@link captainShellDecision} needs, so the decision stays pure and harness-free. */
export interface CaptainShellInput {
  /** The tool being dispatched. */
  toolName: string
  /** The call's argument object, as the harness validated it. */
  args: Record<string, unknown> | undefined
  /** The session workspace root, resolved by the adapter PER CALL — the read-route judges the band against it. */
  workspaceRoot: string
  /** Whether one read-route token exists on disk, resolved against {@link CaptainShellInput.workspaceRoot} by the caller. */
  pathExists: (raw: string) => boolean
  /** Whether the calling session is the `mpd` preset's TOP-LEVEL session — the captain this rule is scoped to (`sessionIsMpdCaptain`). */
  topLevel: boolean
  /** The mode in force. */
  mode: CaptainShellMode
}

/**
 * Decide one call for the captain's shell rule.
 *
 * The order is the contract's: mode → captain classification → tool name → command normalisation → deny
 * table → read-route. Anything unusual — a missing or non-string `command`, an unknown tool spelling, a
 * child session — passes through untouched; only a STRING command on a gated shell tool, in deny mode, for
 * the captain can be refused.
 *
 * The test order inside the command is segment-first and then the whole trimmed string: segment-first
 * makes the quoted text the offending command rather than a long `cd … && …` line, and the whole-string
 * pass keeps a single command (the common case) covered even if a future pattern wants to read across a
 * separator. The READ-ROUTE pass is STATEFUL within the call: a `cd` segment moves the directory every
 * later RELATIVE candidate is resolved against (repair F3), so that pass walks the segments in order; its
 * whole-string arm runs ONLY for a command carrying a command substitution (repair A), and every
 * substituted body is judged as a command of its own.
 *
 * @param input - the call, its classification and the mode in force.
 * @returns the refusal the harness turns into a rejected result, or `undefined` to allow the call.
 */
export function captainShellDecision(input: CaptainShellInput): string | undefined {
  // THE MODE COMES FIRST: `"allow"` restores the captain's shell exactly, for every session.
  if (input.mode !== "deny") return undefined
  // ONLY THE CAPTAIN: members, specialists, workmate spawns and verifier seats keep their shell — they
  // are where the captain is required to send this work.
  if (!input.topLevel) return undefined
  /** The tool name, read defensively so an unexpected shape is a pass-through. */
  const toolName = String(input.toolName ?? "")
  if (!CAPTAIN_SHELL_TOOLS.includes(toolName)) return undefined
  /** The command this call would run; only a string is a command we can judge. */
  const raw = input.args?.command
  // ANYTHING UNUSUAL PASSES THROUGH (contract §3 C1): no `command`, a `null`, a structured argument — the
  // rule refuses a verification command, never an argument shape it did not expect.
  if (typeof raw !== "string") return undefined
  /** The split and trimmed segments, tested in command order so the FIRST offending command is the one quoted. */
  const segments = splitCaptainShellSegments(raw)
  for (const segment of segments) {
    /** The matched command family, when this segment starts with one. */
    const entry = matchCaptainShellDeny(segment.text)
    if (entry !== undefined) return captainShellRefusal(segment.text, entry)
  }
  // THE WHOLE STRING IS TESTED TOO (contract §3 C1), trimmed: with no separator this is the same single
  // segment, so the second pass only matters for a spelling the splitter kept together.
  /** The whole command, trimmed; empty when the call carried only whitespace. */
  const whole = raw.trim()
  if (whole !== "") {
    /** The matched command family for the whole string, if any. */
    const entry = matchCaptainShellDeny(whole)
    if (entry !== undefined) return captainShellRefusal(whole, entry)
  }
  // THE READ-ROUTE RUNS SECOND (contract §3 C3), and only when NO deny row matched: the deny table keeps
  // precedence, and a reading command is a different family with its own sentence and its own route out.
  /** The directory state a `cd` leaves for the segments after it (repair F3); every command starts at the root. */
  let directory: CaptainShellDirectoryState = { cwd: "", dynamic: false }
  for (const segment of segments) {
    // A COMMAND SUBSTITUTION IS NOT A SEGMENT (repair A): the command it hides never reaches the splitter,
    // so every substituted body is judged as its own command, against the directory tracked so far. This
    // runs BEFORE the segment's own judgement because the substitution is exactly the spelling a caller
    // could use to hide a source read while the visible verb stays benign (`echo $(cat packages/x)`).
    for (const body of captainShellSubstitutionBodies(segment.text)) {
      /** The read-route refusal for this substituted command, when it reads outside the band. */
      const substitutedRead = captainShellSubstitutionReadRefusal(body, {
        workspaceRoot: input.workspaceRoot,
        pathExists: input.pathExists,
        fedByPipe: false,
        cwd: directory.cwd,
        cwdDynamic: directory.dynamic,
      })
      if (substitutedRead !== undefined) return substitutedRead
    }
    /** The state this segment leaves behind when it is a `cd`; `undefined` for every other command. */
    const moved = applyCaptainShellCd(segment.text, input.workspaceRoot, directory)
    if (moved !== undefined) {
      directory = moved
      continue
    }
    /** The read-route refusal for this segment, when it reads outside the documentation band. */
    const read = captainShellReadViolation(segment.text, {
      workspaceRoot: input.workspaceRoot,
      pathExists: input.pathExists,
      fedByPipe: segment.fedByPipe,
      cwd: directory.cwd,
      cwdDynamic: directory.dynamic,
    })
    if (read !== undefined) return read
  }
  // THE WHOLE-STRING READ PASS IS SUBSTITUTION-AWARE (repair A). With NO command substitution the segments
  // above are COMPLETE, so this pass could only judge tokens that belong to ANOTHER segment
  // (`cat docs/decisions.md && ls packages` — `packages` is `ls`'s argument, not a read) and is SKIPPED.
  // A substitution is not a segment, so when one IS present the line is judged once more, conservatively.
  if (hasCommandSubstitution(raw) && whole !== "") {
    /** The read-route refusal for the whole command, mirroring the deny table's second pass. */
    const read = captainShellReadViolation(whole, {
      workspaceRoot: input.workspaceRoot,
      pathExists: input.pathExists,
      fedByPipe: false,
      cwd: "",
      cwdDynamic: false,
    })
    if (read !== undefined) return read
    // THE SPLITTER CUTS INSIDE A SUBSTITUTION that carries a top-level separator (`$(cat a && ls b)`), so
    // the RAW string is scanned too: only here is the COMPLETE body visible. The body is judged against the
    // workspace root because a cut segment cannot attribute its tracked directory; a path-shaped token is
    // refused regardless of the directory (the substitution route's conservative trade).
    for (const body of captainShellSubstitutionBodies(raw)) {
      /** The read-route refusal for one complete substituted command, when it reads outside the band. */
      const substitutedRead = captainShellSubstitutionReadRefusal(body, {
        workspaceRoot: input.workspaceRoot,
        pathExists: input.pathExists,
        fedByPipe: false,
        cwd: "",
        cwdDynamic: false,
      })
      if (substitutedRead !== undefined) return substitutedRead
    }
  }
  return undefined
}

/**
 * The sentence a refused shell call carries: WHY, the ROUTE OUT and the configuration opt-out.
 *
 * The quoted segment is capped at {@link MAX_QUOTED_SEGMENT} characters so the whole sentence stays inside
 * the contract's 600-character bound even on a pathological command line; every normal gate command is far
 * shorter, so the cap changes nothing a reader would act on.
 *
 * @param segment - the offending command segment as written.
 * @param entry - the deny-table row it matched.
 * @returns the denial sentence, assembled exactly as contract §3 C1 spells it.
 */
function captainShellRefusal(segment: string, entry: CaptainShellDenyPattern): string {
  /** The command as the model should see it: verbatim unless it is too long to quote inside the bound. */
  const shown = segment.length > MAX_QUOTED_SEGMENT ? segment.slice(0, MAX_QUOTED_SEGMENT - 1) + "…" : segment
  /** The clause that names the second door this wave closes, present only for a gate-shaped command. */
  const evidenceClause = entry.gateShaped
    ? " mpd_verify_evidence {kind:\"gate\"} is refused for the captain too (verify.evidenceBy), so the delegate records it."
    : ""
  return "[mpd-roles] captain shell: REFUSED — \"" + shown + "\" is a verification command and verification is not"
    + " the captain's job. Delegate it: mpd_role_spawn {role:\"Reviewer\", task:\"run <exact command> and"
    + " report the outcome\"}. bash stays yours for git, filesystem and bookkeeping; captain.shell:\"allow\""
    + " in mpd.jsonc is the configuration opt-out." + evidenceClause
}

/**
 * What installing the captain's shell guard needs.
 *
 * The config reader is the row's own `configValue`, so the knob follows the EXISTING mechanism — the
 * mounted `mpdConfig` service first (a `.mpd/mpd.jsonc` edit is therefore picked up LIVE, T-18) and this
 * row's own patch config second — and no second config mechanism is introduced.
 */
export interface CaptainShellOptions {
  /** Raw config reader for `captain.shell`. */
  configValue: (key: string) => unknown
  /** One-line reporter: an install-time degradation, or the ONE internal guard error that passes a call through. */
  warn: (line: string) => void
}

/** The install outcome, REPORTED rather than thrown so a missing seam never aborts the row. */
export interface CaptainShellInstall {
  /** True when the guard reached the harness tool registry. */
  installed: boolean
  /** The mode observed at install time, which the row's boot line reports. */
  mode: CaptainShellMode
  /** Why it did not install, when `installed` is false (already reported through `warn`). */
  reason?: string
  /** The registry's disposer, when installed. */
  dispose?: () => void
}

/**
 * Whether one read-route token EXISTS on disk, resolved against the session workspace root.
 *
 * The probe is a RESOLVER, not a validator: a throw, an unreadable path or a malformed token reads as
 * "does not exist", which makes the read-route IGNORE it (contract §3 C3) rather than refuse a call for a
 * reason of its own. A relative token is resolved against the root; an absolute one is probed as written.
 *
 * @param workspaceRoot - the session workspace root, resolved per call by the adapter helper.
 * @param raw - the token as the command spelled it (surrounding quotes already stripped).
 * @returns true when the token names something on disk.
 */
function captainShellPathExists(workspaceRoot: string, raw: string): boolean {
  try {
    if (raw === "") return false
    /** True when the token is already absolute, POSIX-spelled or Windows-spelled. */
    const absolute = raw.startsWith("/") || /^[a-zA-Z]:[\\/]/u.test(raw)
    return existsSync(absolute || workspaceRoot === "" ? raw : join(workspaceRoot, raw))
  } catch {
    return false
  }
}

/**
 * Install the captain's shell guard through the adapter (`dsh.guardTool`).
 *
 * Degrades with a warning instead of aborting the plugin tree: without the `tools.guard` seam the rule is
 * a stated absence rather than an enforcement, and the row's boot line says so.
 *
 * The callback body is ERROR-BOUNDED: a malformed/throwing exec handle or an unreadable config layer
 * passes the call through (returning `undefined`) and is reported once — the guard must never deny or
 * fail an unrelated tool call for a reason of its own.
 *
 * The MODE is read per call inside the decision — so a live `mpd.jsonc` edit takes effect without a
 * restart — while the returned `mode` is the install-time observation the boot line reports. The WORKSPACE
 * ROOT is resolved per call too, through `dsh.workspaceRoot(exec)`, because the read-route judges paths
 * against the calling session's root and AGENTS.md §6 forbids caching it (a throw degrades to `""`, which
 * keeps the relative band checks working and makes absolute paths fail closed).
 *
 * @param dsh - the adapter's capability probe, its `guardTool` seam and its per-call workspace root.
 * @param options - the config reader and the reporter.
 * @returns the install outcome.
 */
export function installCaptainShellGuard(
  dsh: Pick<DshAdapter, "capabilities" | "guardTool" | "workspaceRoot">,
  options: CaptainShellOptions,
): CaptainShellInstall {
  /** The mode at install time, reported by the caller's boot line. */
  const mode = resolveCaptainShellMode(options.configValue(CAPTAIN_SHELL_CONFIG_KEY))
  try {
    if (dsh.capabilities().toolsGuard !== true) {
      options.warn("the harness exposes no tools.guard seam — the captain shell guard is NOT installed "
        + "(the top-level session keeps its shell on verification commands; the rule lives in the instruction text only)")
      return { installed: false, mode, reason: "no-guard-seam" }
    }
    /**
     * Whether the internal-error warning has already been reported, so a persistently malformed exec
     * call is visible in the row log ONCE instead of on every tool call.
     */
    let reportedInternalError = false
    /** The registry's disposer, returned so the row can release the guard. */
    const dispose = dsh.guardTool((exec) => {
      // AN INTERNAL ERROR MUST NEVER FAIL AN UNRELATED TOOL CALL: a throwing exec/args proxy or a config
      // layer that refuses a read is a PASS-THROUGH, reported once, never a deny and never a throw.
      try {
        /** The workspace root FOR THIS CALL (AGENTS.md §6): a throw degrades to `""`, never to a cached root. */
        const workspaceRoot = ((): string => {
          try {
            return dsh.workspaceRoot(exec)
          } catch {
            return ""
          }
        })()
        return captainShellDecision({
          toolName: String(exec?.name ?? ""),
          args: exec?.arguments,
          workspaceRoot,
          pathExists: (raw) => captainShellPathExists(workspaceRoot, raw),
          topLevel: sessionIsMpdCaptain(exec?.agent),
          mode: resolveCaptainShellMode(options.configValue(CAPTAIN_SHELL_CONFIG_KEY)),
        })
      } catch (error) {
        if (!reportedInternalError) {
          reportedInternalError = true
          options.warn("the captain shell guard hit an internal error and passed the call through ("
            + (error instanceof Error ? error.message : String(error)) + ")")
        }
        return undefined
      }
    })
    return { installed: true, mode, ...(typeof dispose === "function" ? { dispose } : {}) }
  } catch (error) {
    options.warn("installing the captain shell guard failed ("
      + (error instanceof Error ? error.message : String(error)) + ")")
    return { installed: false, mode, reason: "install-failed" }
  }
}
