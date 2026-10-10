// THE ROLES-SIDE INSTALL OF THE VERIFICATION LAW'S GUARD.
//
// WHY IT LIVES HERE AND NOT IN `mpd-verify-plugin`. The bundle already has exactly ONE `guardTool`
// install site (`installReadonlyGuard`, the roster's read-only discipline), and a second site would be a
// second place a harness release can break. This module is the ONE extra install: it decides with the
// PURE functions `mpd-verify-plugin/src/law.ts` exports and reads its state from the `mpdVerify` SERVICE
// that row publishes, so no state crosses the package boundary as a module singleton (which `bun build`
// would duplicate by inlining).
//
// TWO RULES, ONE HOOK:
//   1. the CAPTAIN's write rule — the workspace's TOP-LEVEL session (not a delegated child:
//      `origin: "subagent"` or a recorded depth of `1`+, and NOT a preset name: see `sessionIsTopLevel`
//      in `./complexity-gate.ts`) may not write
//      a code path without an armed loop, a counted escape, or a delegation;
//   2. the VERIFIER's envelope — a bound verifier seat may not reach the implementation, the shell or the
//      board before it has recorded a verdict.
//
// MONOTONIC, NON-THROWING, and it never mutates its input: a guard that throws takes the whole tool tree
// down, so every read is defensive and every unexpected shape is a pass-through to the OTHER rules rather
// than an outage. It degrades with ONE warning when the law's service is absent — the boot line then says
// `verifyGate=absent`, which is the honest bound, never silence.
import type { DshAdapter, DshToolExec } from "../../mpd-dsh-adapter-plugin/src/index"
import { sessionIsTopLevel, sessionRank } from "./complexity-gate.ts"
import type { ArmedLoopView, VerifierSeatView } from "../../mpd-verify-plugin/src/law.ts"
import {
  captainWriteDecision,
  gitWriterDecision,
  resolveVerifyMode,
  sessionKeyOf,
  verifierEnvelopeDecision,
} from "../../mpd-verify-plugin/src/law.ts"

/**
 * What the guard needs from the law's runtime, resolved PER CALL through the `mpdVerify` service.
 *
 * A structural subset of `VerifyRuntime`, declared here so this row's types do not depend on that
 * module's whole surface — and so a unit double can implement exactly the six methods the guard uses.
 */
export interface VerifyLawAccess {
  /** The session key of one agent. */
  keyOf(agent: unknown): string
  /** Record one guarded call, so blindness is provable from the plugin's own observation log. */
  noteCall(exec: DshToolExec): void
  /** The escape uses this session still holds. */
  escapeUses(sessionId: string): number
  /** Consume one escape use, reporting whether one was available. */
  consumeEscape(sessionId: string): boolean
  /** Count one implementation read inside a diagnosis window. */
  countRead(sessionId: string, path: string): void
  /** The armed loops of one workspace, read from disk so a concurrent arming is seen. */
  armedLoops(workspace: string): ArmedLoopView[]
  /** The verifier seat bound to one session, or `undefined`. */
  seatFor(workspace: string, sessionId: string): VerifierSeatView | undefined
}

/**
 * What installing the guard needs.
 *
 * THERE IS NO PRESET KNOB — deliberately, and it must not come back: §5's captain is the workspace's
 * TOP-LEVEL session (not a delegated child, and never a preset name), so no default here
 * may silently narrow the captain test. Both rules below read that ONE predicate (T-92).
 */
export interface VerifyGuardOptions {
  /** Resolve the law's runtime PER CALL; `undefined` degrades the guard to a stated rule. */
  law: () => VerifyLawAccess | undefined
  /** The workspace root of one call, from the adapter. */
  workspaceRootOf: (exec: DshToolExec) => string
  /** Raw config reader for `verify.mode`. */
  configValue: (key: string) => unknown
  /** One-line reporter for an install-time or advisory degradation. */
  warn: (line: string) => void
}

/** The install outcome, REPORTED rather than thrown so a missing seam never aborts the row. */
export interface VerifyGuardInstall {
  /** True when the guard reached the harness tool registry. */
  installed: boolean
  /** Why it did not, when `installed` is false (already reported through `warn`). */
  reason?: string
  /** The registry's disposer, when installed. */
  dispose?: () => void
}

/**
 * Decide one call: the denial sentence, or `undefined` to let it through.
 *
 * Pure with respect to the harness — the only external reads are the `law` accessor's methods, which the
 * caller binds to the published service. Exported so the decision is testable without a registry, and so
 * the plugin installs exactly the function the QA case proved.
 *
 * @param exec - the harness's execution object (tool name, arguments and the live agent).
 * @param options - the law accessor, the mode, the workspace root and the instant.
 * @returns the denial to hand the harness, or `undefined`.
 */
export function verifyGuardDecision(
  exec: unknown,
  options: {
    /** The law's runtime, or `undefined` when the verify row is absent. */
    law: VerifyLawAccess | undefined
    /** The mode in force. */
    mode: "hard" | "advisory" | "off"
    /** The calling session's workspace root. */
    workspaceRoot: string
    /** The instant, injected so the decision stays pure. */
    now: Date
    /** One-line reporter, used when the mode is `advisory` and a denial is recorded instead of enforced. */
    warn: (line: string) => void
  },
): string | undefined {
  try {
    /** The tool being dispatched. */
    const toolName = String((exec as { name?: unknown } | undefined)?.name ?? "")
    if (toolName === "") return undefined
    /** The raw calling agent, read once. */
    const agent = (exec as { agent?: unknown } | undefined)?.agent
    /** The law's runtime, or a pass-through when the verify row is not mounted. */
    const law = options.law
    // OBSERVATION HAPPENS EVEN IN `off` MODE: the log is how blindness is judged, and a mode switch must
    // not erase what the process saw. It is the cheapest possible call and it never throws.
    if (law !== undefined) {
      try { law.noteCall(exec as DshToolExec) } catch { /* observation never fails a call */ }
    }
    if (options.mode === "off") return undefined
    if (law === undefined) return undefined
    /** The caller's session key. */
    const sessionId = law.keyOf(agent)
    /** The verifier seat bound to this session, when there is one. */
    const seat = law.seatFor(options.workspaceRoot, sessionId)
    // RULE 2 — THE VERIFIER'S ENVELOPE, checked first: a bound seat is judged by its envelope whatever
    // else is true of it, because the seat is the narrower role.
    if (seat !== undefined) {
      /** The envelope's decision for this call. */
      const envelope = verifierEnvelopeDecision({
        toolName,
        args: (exec as { arguments?: Record<string, unknown> } | undefined)?.arguments,
        workspaceRoot: options.workspaceRoot,
        seat,
      })
      if (envelope.deny !== undefined) return advisoryOr(mode(options.mode), envelope.deny, options.warn)
      if (envelope.countedRead === true) {
        try { law.countRead(sessionId, String((exec as { arguments?: Record<string, unknown> } | undefined)?.arguments?.file_path ?? "")) } catch { /* counting is bookkeeping */ }
      }
      return undefined
    }
    // RULE 3 — §5's ONE-GIT-WRITER RULE. A member/child session may not run a git WRITE command; the
    // captain may, and read-only git stays open to everyone. Checked for `bash` ONLY, because that is
    // the one tool that can carry a command string at all. THE CAPTAIN IS THE WORKSPACE'S TOP-LEVEL
    // SESSION — not a delegated child, and never a preset name (T-92).
    if (toolName === "bash" || toolName === "powershell" || toolName === "pwsh") {
      /** Whether this caller is the workspace's top-level session: §5's one git writer. */
      const isCaptain = sessionIsTopLevel(agent)
      /** The §5 decision for this command. */
      const gitDeny = gitWriterDecision({
        command: (exec as { arguments?: Record<string, unknown> } | undefined)?.arguments?.command,
        topLevelCaptain: isCaptain,
        // THE DENIAL STATES WHAT WAS DECIDED, so the class is threaded from the SAME classification the
        // boolean above comes from — `law.ts` never re-derives (or invents) a reason of its own.
        callerClass: sessionRank(agent),
      })
      if (gitDeny !== undefined) return advisoryOr(mode(options.mode), gitDeny, options.warn)
    }
    // RULE 1 — THE CAPTAIN'S WRITE RULE. Only the workspace's TOP-LEVEL session is the captain — not a
    // delegated child (`origin: "subagent"` or depth `1`+), NOT a preset name: a member, a subagent, a
    // workflow worker and a ralph round are children, and they are precisely who the captain is supposed
    // to hand code to. The classification is the session gate's own predicate (`sessionIsTopLevel`),
    // reused rather than re-derived, so rules 1, 3 and the manual can never disagree about who is
    // top-level.
    /** The decision for this call. */
    const decision = captainWriteDecision({
      toolName,
      args: (exec as { arguments?: Record<string, unknown> } | undefined)?.arguments,
      workspaceRoot: options.workspaceRoot,
      sessionId,
      topLevel: sessionIsTopLevel(agent),
      loops: law.armedLoops(options.workspaceRoot),
      escapeUses: law.escapeUses(sessionId),
      now: options.now,
    })
    if (decision.deny === undefined) {
      // AN ESCAPE IS SPENT ON THE WRITE IT AUTHORISED, and only if it is still there when we spend it:
      // reading the allowance and consuming it are two steps, and a concurrent call may have taken it.
      if (decision.consumesEscape === true) {
        /** Whether the allowance really was consumed by this call. */
        const spent = law.consumeEscape(sessionId)
        if (!spent) {
          return advisoryOr(mode(options.mode), decision.deny ?? escalation(sessionId, toolName, decision.target.rel ?? decision.target.raw), options.warn)
        }
        options.warn("verify-law: the counted escape was spent on `" + toolName + "` (" + String(decision.target.rel ?? decision.target.raw) + ")")
      }
      return undefined
    }
    return advisoryOr(mode(options.mode), decision.deny, options.warn)
  } catch {
    // A guard must never throw: an unexpected shape is a pass-through, never an outage.
    return undefined
  }
}

/**
 * Read the mode once, defensively, so the decision below is one comparison.
 *
 * @param raw - the resolved mode.
 * @returns the mode.
 */
function mode(raw: "hard" | "advisory" | "off"): "hard" | "advisory" | "off" {
  return raw
}

/**
 * Apply the mode to a denial: `hard` returns it, `advisory` reports it and lets the call through.
 *
 * @param active - the mode in force.
 * @param deny - the denial the rule produced.
 * @param warn - the reporter used in advisory mode.
 * @returns the denial, or `undefined` in advisory mode.
 */
function advisoryOr(active: "hard" | "advisory" | "off", deny: string, warn: (line: string) => void): string | undefined {
  if (active !== "advisory") return deny
  warn("verify-law (advisory): " + deny)
  return undefined
}

/**
 * The denial a lost escape race reports: the allowance was read, then someone else spent it.
 *
 * @param sessionId - the caller's session key.
 * @param toolName - the tool that was attempted.
 * @param path - the path it named.
 * @returns the denial sentence.
 */
function escalation(sessionId: string, toolName: string, path: string): string {
  return "verification law: the counted escape for " + JSON.stringify(sessionId) + " was already spent by a concurrent call, so `"
    + toolName + "` on " + JSON.stringify(path) + " is refused. Take another escape or delegate the write."
}

/**
 * Install the guard through the adapter (`dsh.guardTool`).
 *
 * Degrades with a warning instead of aborting the plugin tree: without the seam the law is bookkeeping,
 * and the row's boot line says `verifyGate=absent` rather than implying an enforcement that is not there.
 *
 * @param dsh - the adapter's capability probe and its `guardTool` seam.
 * @param options - the law accessor, the root resolver and the config reader.
 * @returns the install outcome.
 */
export function installVerifyGuard(
  dsh: Pick<DshAdapter, "capabilities" | "guardTool">,
  options: VerifyGuardOptions,
): VerifyGuardInstall {
  try {
    if (dsh.capabilities().toolsGuard !== true) {
      options.warn("the harness exposes no tools.guard seam — the verification law's write guard is NOT installed "
        + "(the ledger, the five tools and the record validator still work; the captain's writes are unguarded)")
      return { installed: false, reason: "no-guard-seam" }
    }
    /** The registry's disposer, returned so the row can release the guard. */
    const dispose = dsh.guardTool((exec) => verifyGuardDecision(exec, {
      law: options.law(),
      mode: resolveVerifyMode(options.configValue("verify.mode")),
      workspaceRoot: ((): string => { try { return options.workspaceRootOf(exec) } catch { return "" } })(),
      now: new Date(),
      warn: options.warn,
    }))
    return { installed: true, ...(typeof dispose === "function" ? { dispose } : {}) }
  } catch (error) {
    options.warn("installing the verification law's write guard failed (" + (error instanceof Error ? error.message : String(error)) + ")")
    return { installed: false, reason: "install-failed" }
  }
}

/** Re-exported so the roles row has one import for both the key helper and the guard. */
export { sessionKeyOf }
