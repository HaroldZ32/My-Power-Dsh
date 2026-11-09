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
// reports the mode it installed.
//
// HONEST BOUND, stated rather than implied: the decision reads the command STRING, so it only sees the
// spelling a caller wrote — a command assembled at runtime by another program (`sh -c "$(...)"`, a script
// invoked by name) is not decomposed here, and the deny table is the contract's v1 set, not a taxonomy of
// every way a gate can be launched. The global `"allow"` mode is the only opt-out (contract §2 — no
// per-command escape).
import type { DshAdapter, DshToolExec } from "../../mpd-dsh-adapter-plugin/src/index"
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

/**
 * Split one command string into the segments the deny table tests.
 *
 * The separators are the contract's four: `&&`, `||`, `;`, `|` and a newline. Each segment is trimmed and
 * empty segments are dropped, so a trailing `&&` or a blank line contributes nothing to the table.
 *
 * @param command - the raw `command` argument of a shell call.
 * @returns the non-empty, trimmed segments in command order.
 */
export function captainShellSegments(command: string): string[] {
  return command
    .split(/&&|\|\||;|\||\r?\n/u)
    .map((segment) => segment.trim())
    .filter((segment) => segment !== "")
}

/**
 * Match one command string against the deny table, first row winning.
 *
 * @param segment - one normalised command segment (or the whole command string).
 * @returns the matched deny-table row, or `undefined` when the segment is not a verification command.
 */
export function matchCaptainShellDeny(segment: string): CaptainShellDenyPattern | undefined {
  for (const entry of CAPTAIN_SHELL_DENY_PATTERNS) {
    if (entry.pattern.test(segment)) return entry
  }
  return undefined
}

/** Everything {@link captainShellDecision} needs, so the decision stays pure and harness-free. */
export interface CaptainShellInput {
  /** The tool being dispatched. */
  toolName: string
  /** The call's argument object, as the harness validated it. */
  args: Record<string, unknown> | undefined
  /** Whether the calling session is the `mpd` preset's TOP-LEVEL session — the captain this rule is scoped to (`sessionIsMpdCaptain`). */
  topLevel: boolean
  /** The mode in force. */
  mode: CaptainShellMode
}

/**
 * Decide one call for the captain's shell rule.
 *
 * The order is the contract's: mode → captain classification → tool name → command normalisation → deny
 * table. Anything unusual — a missing or non-string `command`, an unknown tool spelling, a child session
 * — passes through untouched; only a STRING command on a gated shell tool, in deny mode, for the captain
 * can be refused.
 *
 * The test order inside the command is segment-first and then the whole trimmed string: segment-first
 * makes the quoted text the offending command rather than a long `cd … && …` line, and the whole-string
 * pass keeps a single command (the common case) covered even if a future pattern wants to read across a
 * separator.
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
  /** The normalised segments, tested in command order so the FIRST offending command is the one quoted. */
  const segments = captainShellSegments(raw)
  for (const segment of segments) {
    /** The matched command family, when this segment starts with one. */
    const entry = matchCaptainShellDeny(segment)
    if (entry !== undefined) return captainShellRefusal(segment, entry)
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
 * restart — while the returned `mode` is the install-time observation the boot line reports.
 *
 * @param dsh - the adapter's capability probe and its `guardTool` seam.
 * @param options - the config reader and the reporter.
 * @returns the install outcome.
 */
export function installCaptainShellGuard(
  dsh: Pick<DshAdapter, "capabilities" | "guardTool">,
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
        return captainShellDecision({
          toolName: String(exec?.name ?? ""),
          args: exec?.arguments,
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
