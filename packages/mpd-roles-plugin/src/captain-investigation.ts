// THE CAPTAIN INVESTIGATION GUARD — the workspace's TOP-LEVEL session does not do reconnaissance.
//
// WHY THIS EXISTS (the user's requirement, 2026-10-08): the user-facing main agent must keep its context
// small enough to drive very large projects, and RECONNAISSANCE — finding files, reading source, grepping
// for symbols — is what inflates it. The captain DELEGATES that work (a roster specialist: `Explorer` for
// "find the file and the code", `Researcher` for evidence-based search, or a team member) and consumes
// the REPORT.
//
// WHAT IT DENIES: `read`, `grep` and `glob` on a SOURCE path, for a session where `sessionIsTopLevel` is
// true — §5's ONE predicate for the captain (not a delegated child — `origin: "subagent"` or depth
// `1`+ — and NEVER a preset name: T-92), the same predicate the captain write rule beside it uses.
//
// WHAT STAYS OPEN — THE DOCUMENTATION BAND: `.mpd/**`, `docs/**`, `evidence/**`, `agent-references/**`
// and the root files `AGENTS.md` / `AGENT.md` / `CLAUDE.md` / `README.md` / `README.zh-CN.md` /
// `CHANGELOG.md` / `LICENSE*.md`. Integration stays possible because the contract, the records and the
// manual remain readable; the SOURCES do not.
//
// THE DECISION IS PURE ({@link captainInvestigationDecision}), so it is unit-testable without a harness,
// and the INSTALL is ONE `guardTool` registration through the adapter, beside the captain's write rule.
// The knob is `captain.investigation` in `mpd.jsonc`: `"deny"` (default) | `"allow"`; the row's boot line
// reports the mode it installed.
//
// HONEST BOUND, stated rather than implied: the guard reads a TOOL CALL's arguments, so reaching a source
// path through the shell (`cat`, `rg`) is NOT blocked — `bash` stays available to the captain for gates
// and git, exactly as §5 rule 5's command matcher has the same reading bound — and a path is judged by
// its SPELLING, so a symlink is never resolved.
import type { DshAdapter, DshToolExec } from "../../mpd-dsh-adapter-plugin/src/index"
import { readTargetPath } from "../../mpd-verify-plugin/src/law.ts"
import { sessionIsTopLevel } from "./complexity-gate.ts"

/** The `mpd.jsonc` key the modes are read from, through the config layer this bundle already uses. */
export const INVESTIGATION_CONFIG_KEY = "captain.investigation"

/** The two modes `captain.investigation` accepts; anything else reads as {@link DEFAULT_INVESTIGATION_MODE}. */
export type InvestigationMode = "deny" | "allow"

/** The mode a session gets when `mpd.jsonc` says nothing: the requirement's own default, fail-closed. */
export const DEFAULT_INVESTIGATION_MODE: InvestigationMode = "deny"

/** The path-consuming tools reconnaissance is done with; every other tool is somebody else's rule. */
export const INVESTIGATION_TOOLS: readonly string[] = ["read", "glob", "grep"]

/** The documentation BANDS the captain may still read: contracts, records, evidence and the reference. */
export const CAPTAIN_READABLE_PREFIXES: readonly string[] = [".mpd/", "docs/", "evidence/", "agent-references/"]

/** The ROOT instruction/overview files the captain may still read, by exact workspace-relative name. */
export const CAPTAIN_READABLE_ROOT_FILES: readonly string[] = [
  "AGENTS.md",
  "AGENT.md",
  "CLAUDE.md",
  "README.md",
  "README.zh-CN.md",
  "CHANGELOG.md",
]

/** The licence band at the workspace root (`LICENSE.md`, `LICENSE-NOTICES.md`), matched by basename. */
const ROOT_LICENSE_PATTERN = /^LICENSE.*\.md$/i

/** Everything {@link captainInvestigationDecision} needs, so the decision stays pure and harness-free. */
export interface CaptainInvestigationInput {
  /** The tool being dispatched. */
  toolName: string
  /** The call's argument object, as the harness validated it. */
  args: Record<string, unknown> | undefined
  /** The session workspace root, as the adapter resolved it. */
  workspaceRoot: string
  /** Whether the calling session is the workspace's TOP-LEVEL session (§5's captain predicate). */
  topLevel: boolean
  /** The mode in force. */
  mode: InvestigationMode
}

/**
 * Read `captain.investigation` as a mode.
 *
 * FAIL-CLOSED, by design: only the exact string `"allow"` turns the rule off, so a typo, an absent key or
 * a value of another type leaves the captain's reconnaissance denied rather than silently permitted.
 *
 * @param raw - the raw config value.
 * @returns `"allow"` for the exact opt-out spelling, `"deny"` otherwise.
 */
export function resolveInvestigationMode(raw: unknown): InvestigationMode {
  return raw === "allow" ? "allow" : "deny"
}

/**
 * Whether one path argument falls inside the documentation band the captain keeps.
 *
 * The order is the contract: a path that escapes the workspace (`..`), an absolute path outside the root
 * and every spelling that reaches no band are REFUSED; the bands and the named root files are ALLOWED.
 *
 * @param workspaceRoot - the session workspace root.
 * @param raw - the path the tool call carried.
 * @returns true when the captain may read that path.
 */
export function captainReadablePath(workspaceRoot: string, raw: string): boolean {
  /** The path normalised to POSIX, so a Windows separator cannot smuggle a band past the test. */
  const posix = String(raw ?? "").replace(/\\/g, "/")
  if (posix === "") return false
  /** The workspace root, normalised with no trailing separator. */
  const root = workspaceRoot.replace(/\\/g, "/").replace(/\/+$/, "")
  /** True when the caller spelled an absolute path. */
  const absolute = posix.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(posix)
  /** The workspace-relative spelling, or `undefined` when the path is not under the root. */
  let rel: string | undefined
  if (!absolute) rel = posix.startsWith("./") ? posix.slice(2) : posix
  else if (root !== "" && posix.startsWith(root + "/")) rel = posix.slice(root.length + 1)
  if (rel === undefined || rel === "") return false
  // NO PARENT HOPS: a spelling carrying a `..` segment is refused outright rather than resolved, so
  // `docs/../packages/x/src/y.ts` cannot start inside a band and end outside it.
  if (rel.split("/").includes("..")) return false
  /** True when the path is inside a documentation band, or IS the band directory itself. */
  const inBand = CAPTAIN_READABLE_PREFIXES.some((prefix) => rel!.startsWith(prefix) || rel === prefix.replace(/\/$/, ""))
  if (inBand) return true
  // THE ROOT FILES ARE EXACT: a nested `AGENTS.md` under a source tree is NOT this band, so a reader
  // cannot reach a source directory by spelling an instruction file inside it.
  if (CAPTAIN_READABLE_ROOT_FILES.includes(rel)) return true
  return rel.indexOf("/") === -1 && ROOT_LICENSE_PATTERN.test(rel)
}

/**
 * Decide one call for the captain's investigation rule.
 *
 * Pure with respect to the harness, like `captainWriteDecision` beside it: the caller passes the tool
 * name, the arguments, the resolved root, the top-level classification and the mode, and gets back the
 * denial sentence to hand the harness or `undefined` to let the call through.
 *
 * @param input - the call, its target and the mode in force.
 * @returns the denial the harness turns into a refusal result, or `undefined` to allow the call.
 */
export function captainInvestigationDecision(input: CaptainInvestigationInput): string | undefined {
  // THE MODE COMES FIRST: `"allow"` restores today's freedom exactly, for every session.
  if (input.mode !== "deny") return undefined
  // ONLY THE CAPTAIN: members, one-shot specialists, workmate spawns and verifier seats keep their
  // reconnaissance — the verifier's own envelope scopes ITS reads separately and must not be doubled.
  if (!input.topLevel) return undefined
  /** The tool name, read defensively so an unexpected shape is a pass-through. */
  const toolName = String(input.toolName ?? "")
  if (!INVESTIGATION_TOOLS.includes(toolName)) return undefined
  /** The path this call names; `glob`/`grep` name it under `path`, `read` under `file_path`. */
  const raw = readTargetPath(toolName, input.args)
  // FAIL-CLOSED on a missing path: `glob`/`grep` without a `path` search the WHOLE workspace, and the
  // pattern's own directory prefix is deliberately NOT a substitute (contract §2.2).
  if (raw === undefined) return investigationRefusal(toolName, "(no path argument — a bare call searches the whole workspace)")
  if (captainReadablePath(input.workspaceRoot, raw)) return undefined
  return investigationRefusal(toolName, JSON.stringify(raw))
}

/**
 * The sentence a refused reconnaissance call carries: WHY, the ROUTE OUT and the band that stays open.
 *
 * @param toolName - the tool that was attempted.
 * @param target - the path as the caller spelled it, or the reason none could be read.
 * @returns the denial sentence.
 */
function investigationRefusal(toolName: string, target: string): string {
  return "captain investigation rule: `" + toolName + "` on " + target + " is refused — the workspace's"
    + " TOP-LEVEL session does not run reconnaissance, so its context stays small enough for very large"
    + " projects. Delegate it: `mpd_role_spawn` with the `Explorer` role (find files and code) or the"
    + " `Researcher` role (evidence-based search), or hand the search to a team member, and consume the"
    + " REPORT. The documentation band stays open to you: `.mpd/**`, `docs/**`, `evidence/**`,"
    + " `agent-references/**`, the root AGENTS.md / README*.md / CHANGELOG.md / LICENSE*.md — and"
    + " `captain.investigation: \"allow\"` in mpd.jsonc restores full access."
}

/**
 * What installing the captain's investigation guard needs.
 *
 * The config reader is the row's own `configValue`, so the knob follows the EXISTING mechanism — the
 * mounted `mpdConfig` service first (a `.mpd/mpd.jsonc` edit is therefore picked up LIVE, T-18) and this
 * row's own patch config second — and no second config mechanism is introduced.
 */
export interface CaptainInvestigationOptions {
  /** The workspace root of one call, from the adapter. */
  workspaceRootOf: (exec: DshToolExec) => string
  /** Raw config reader for `captain.investigation`. */
  configValue: (key: string) => unknown
  /** One-line reporter for an install-time degradation. */
  warn: (line: string) => void
}

/** The install outcome, REPORTED rather than thrown so a missing seam never aborts the row. */
export interface CaptainInvestigationInstall {
  /** True when the guard reached the harness tool registry. */
  installed: boolean
  /** The mode observed at install time, which the row's boot line reports. */
  mode: InvestigationMode
  /** Why it did not install, when `installed` is false (already reported through `warn`). */
  reason?: string
  /** The registry's disposer, when installed. */
  dispose?: () => void
}

/**
 * Install the captain's investigation guard through the adapter (`dsh.guardTool`).
 *
 * Degrades with a warning instead of aborting the plugin tree: without the `tools.guard` seam the rule is
 * a stated absence rather than an enforcement, and the row's boot line says so.
 *
 * The MODE is read per call inside the decision — so a live `mpd.jsonc` edit takes effect without a
 * restart — while the returned `mode` is the install-time observation the boot line reports.
 *
 * @param dsh - the adapter's capability probe and its `guardTool` seam.
 * @param options - the root resolver, the config reader and the reporter.
 * @returns the install outcome.
 */
export function installCaptainInvestigationGuard(
  dsh: Pick<DshAdapter, "capabilities" | "guardTool">,
  options: CaptainInvestigationOptions,
): CaptainInvestigationInstall {
  /** The mode at install time, reported by the caller's boot line. */
  const mode = resolveInvestigationMode(options.configValue(INVESTIGATION_CONFIG_KEY))
  try {
    if (dsh.capabilities().toolsGuard !== true) {
      options.warn("the harness exposes no tools.guard seam — the captain investigation guard is NOT installed "
        + "(the top-level session keeps read/grep/glob on source paths; the rule lives in the instruction text only)")
      return { installed: false, mode, reason: "no-guard-seam" }
    }
    /** The registry's disposer, returned so the row can release the guard. */
    const dispose = dsh.guardTool((exec) => captainInvestigationDecision({
      toolName: String(exec?.name ?? ""),
      args: exec?.arguments,
      workspaceRoot: ((): string => { try { return options.workspaceRootOf(exec) } catch { return "" } })(),
      topLevel: sessionIsTopLevel(exec?.agent),
      mode: resolveInvestigationMode(options.configValue(INVESTIGATION_CONFIG_KEY)),
    }))
    return { installed: true, mode, ...(typeof dispose === "function" ? { dispose } : {}) }
  } catch (error) {
    options.warn("installing the captain investigation guard failed ("
      + (error instanceof Error ? error.message : String(error)) + ")")
    return { installed: false, mode, reason: "install-failed" }
  }
}
