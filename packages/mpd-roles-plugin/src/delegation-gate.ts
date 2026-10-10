// THE DELEGATION GATE — the official spawn tools are NOT this bundle's delegation path.
//
// WHY THIS EXISTS (the user's requirement, 2026-10-10): AGENTS.md §5 rule 2 names the sanctioned
// delegation surfaces — `mpd_role_spawn` for a one-shot roster specialist, the workmate library for a
// durable instance, Agent Teams for multi-member work — but NOTHING denied the harness's own generic
// spawn tools `subagent` / `subagent_fork` / `workflow`, so the sanctioned discipline was advice and
// the escape cost nothing. The harness exposes `tools.guard` (a guard callback DENIES by RETURNING A
// STRING) and that is the established mechanism this bundle already uses twice (the verification law's
// write guard, the captain investigation guard).
//
// WHAT IT DENIES: a call to any name in {@link DELEGATION_TOOLS}, for the sessions the mode covers. The
// mode is `delegation.gate` in `mpd.jsonc`: `"deny"` (default: every session, captain and members
// alike), `"captain"` (the top-level session only) or `"allow"` (the gate is released entirely).
//
// WHY A GUARD AND NOT A PRESET-PLANE OMISSION: the live top-level session on this deployment runs a
// preset this bundle does not own (`cordis`), so "do not compose the row" is not available to us —
// a guard keyed on §5's PRESET-FREE session rank covers every session in a workspace that mounts this
// bundle, whatever preset the profile assigned. That is the honest scope: mounting the bundle is the
// opt-in.
//
// THE DECISION IS PURE ({@link delegationGateDecision}), so it is unit-testable without a harness, and
// the INSTALL is ONE `guardTool` registration through the adapter, beside the captain investigation
// guard; the row's boot line reports the mode it installed.
//
// HONEST BOUND, stated rather than implied: the guard reads a TOOL CALL at dispatch, so it cannot stop
// a model from TRYING another tool, and a session on a profile WITHOUT this bundle mounted has no gate
// at all.
import type { DshAdapter } from "../../mpd-dsh-adapter-plugin/src/index"
import { sessionRank } from "./complexity-gate.ts"
import type { SessionRank } from "./complexity-gate.ts"

/** The `mpd.jsonc` key the modes are read from, through the config layer this bundle already uses. */
export const DELEGATION_CONFIG_KEY = "delegation.gate"

/**
 * The three modes `delegation.gate` accepts.
 *
 * `deny` covers the captain AND every member session, `captain` limits the rule to the top-level
 * session, and `allow` releases it entirely; anything else reads as {@link DEFAULT_DELEGATION_GATE_MODE}.
 */
export type DelegationGateMode = "deny" | "captain" | "allow"

/** The mode a session gets when `mpd.jsonc` says nothing: fail-closed, like the investigation knob. */
export const DEFAULT_DELEGATION_GATE_MODE: DelegationGateMode = "deny"

/** The harness's generic spawn tools, the ones this bundle replaces with its own delegation surfaces. */
export const DELEGATION_TOOLS: readonly string[] = ["subagent", "subagent_fork", "workflow"]

/**
 * Read `delegation.gate` as a mode.
 *
 * FAIL-CLOSED, by design: only the two exact spellings `"captain"` and `"allow"` are honoured, so a
 * typo, an absent key or a value of another type leaves the official spawn tools denied rather than
 * silently permitted.
 *
 * @param raw - the raw config value.
 * @returns the mode for the exact spellings, `"deny"` otherwise.
 */
export function resolveDelegationGateMode(raw: unknown): DelegationGateMode {
  if (raw === "captain") return "captain"
  if (raw === "allow") return "allow"
  return "deny"
}

/** Everything {@link delegationGateDecision} needs, so the decision stays pure and harness-free. */
export interface DelegationGateInput {
  /** The tool being dispatched. */
  toolName: string
  /** The mode in force. */
  mode: DelegationGateMode
  /** §5's session class of the caller, from the ONE `sessionRank` predicate. */
  rank: SessionRank
}

/**
 * Decide one call for the delegation rule.
 *
 * THE ORDER IS THE CONTRACT:
 *  1. a non-`deny` mode passes everything except the `captain` mode's own top-level calls;
 *  2. a tool outside {@link DELEGATION_TOOLS} is somebody else's rule;
 *  3. under `deny` the captain, a member child AND a headerless session are all refused (fail-closed:
 *     an unreadable header is never a free pass); under `captain` only the top-level session is;
 *  4. the refusal sentence teaches the sanctioned routes.
 *
 * @param input - the call, the session class of its caller and the mode in force.
 * @returns the refusal the harness turns into a denied tool result, or `undefined` to allow the call.
 */
export function delegationGateDecision(input: DelegationGateInput): string | undefined {
  // THE MODE COMES FIRST: `allow` releases the gate for every session, and `captain` covers every
  // session except the workspace's top-level one.
  if (input.mode !== "deny" && !(input.mode === "captain" && input.rank === "captain")) return undefined
  /** The tool name, read defensively so an unexpected shape is a pass-through. */
  const toolName = String(input.toolName ?? "")
  if (!DELEGATION_TOOLS.includes(toolName)) return undefined
  // Under `deny` the captain, a member child and a headerless session are ALL refused; under
  // `captain` the mode guard above already narrowed the callers to the top-level session.
  if (input.mode === "deny" && (input.rank === "captain" || input.rank === "child" || input.rank === "headerless")) {
    return delegationRefusal(toolName)
  }
  if (input.mode === "captain" && input.rank === "captain") return delegationRefusal(toolName)
  return undefined
}

/**
 * The sentence a refused spawn call carries: WHY, the sanctioned ROUTES and the knob that releases it.
 *
 * @param toolName - the tool that was attempted.
 * @returns the refusal sentence.
 */
export function delegationRefusal(toolName: string): string {
  return "delegation gate: `" + toolName + "` is refused — the official spawn tools are not the delegation"
    + " path under the MPD discipline. Delegate instead: `mpd_role_spawn` (one-shot roster specialist),"
    + " `mpd_workmate_match` + `mpd_workmate_spawn` (durable instance), or Agent Teams for multi-member work"
    + " (`agent_teams_plan`, persona from `mpd_role_persona`); `send_message` continues an existing"
    + " continuable child. The gate covers the captain and every member session. `delegation.gate` in"
    + " mpd.jsonc: \"captain\" limits it to the top-level session, \"allow\" releases it entirely."
}

/**
 * What installing the delegation gate needs.
 *
 * The config reader is the row's own `configValue`, so the knob follows the EXISTING mechanism — the
 * mounted `mpdConfig` service first (a `.mpd/mpd.jsonc` edit is therefore picked up LIVE, T-18) and
 * this row's own patch config second — and no second config mechanism is introduced.
 */
export interface DelegationGateOptions {
  /** Raw config reader for `delegation.gate`. */
  configValue: (key: string) => unknown
  /** One-line reporter for an install-time degradation. */
  warn: (line: string) => void
}

/** The install outcome, REPORTED rather than thrown so a missing seam never aborts the row. */
export interface DelegationGateInstall {
  /** True when the guard reached the harness tool registry. */
  installed: boolean
  /** The mode observed at install time, which the row's boot line reports. */
  mode: DelegationGateMode
  /** Why it did not install, when `installed` is false (already reported through `warn`). */
  reason?: string
  /** The registry's disposer, when installed. */
  dispose?: () => void
}

/**
 * Install the delegation gate through the adapter (`dsh.guardTool`).
 *
 * Degrades with a warning instead of aborting the plugin tree: without the `tools.guard` seam the rule
 * is a stated absence rather than an enforcement, and the row's boot line says so.
 *
 * The MODE is read per call inside the decision — so a live `mpd.jsonc` edit takes effect without a
 * restart — while the returned `mode` is the install-time observation the boot line reports.
 *
 * NEVER throws from the guard itself: an unreadable agent handle or a throwing rank probe reads as
 * "not the captain" only in the sense that the decision is skipped, so a guard can never take a tool
 * call down for a reason of its own.
 *
 * @param dsh - the adapter's capability probe and its `guardTool` seam.
 * @param options - the config reader and the reporter.
 * @returns the install outcome.
 */
export function installDelegationGate(
  dsh: Pick<DshAdapter, "capabilities" | "guardTool">,
  options: DelegationGateOptions,
): DelegationGateInstall {
  /** The mode at install time, reported by the caller's boot line. */
  const mode = resolveDelegationGateMode(options.configValue(DELEGATION_CONFIG_KEY))
  try {
    if (dsh.capabilities().toolsGuard !== true) {
      options.warn("the harness exposes no tools.guard seam — the delegation gate is NOT installed "
        + "(the official spawn tools stay available; the rule lives in the instruction text only; "
        + "`delegation.gate` in mpd.jsonc selects the mode once the seam exists)")
      return { installed: false, mode, reason: "no-guard-seam" }
    }
    /** The registry's disposer, returned so the row can release the guard. */
    const dispose = dsh.guardTool((exec) => {
      try {
        return delegationGateDecision({
          toolName: String(exec?.name ?? ""),
          mode: resolveDelegationGateMode(options.configValue(DELEGATION_CONFIG_KEY)),
          rank: sessionRank(exec?.agent),
        })
      } catch {
        // A guard that throws would take an unrelated tool call down; an unreadable call is a
        // pass-through, and the rank predicate itself already fails closed for the sessions it reads.
        return undefined
      }
    })
    return { installed: true, mode, ...(typeof dispose === "function" ? { dispose } : {}) }
  } catch (error) {
    options.warn("installing the delegation gate failed ("
      + (error instanceof Error ? error.message : String(error)) + ")")
    return { installed: false, mode, reason: "install-failed" }
  }
}
