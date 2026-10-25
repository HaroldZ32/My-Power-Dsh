// THE TEAM DOOR — mpd is the SINGLE team front door (user decision, 2026-10-23).
//
// WHY THIS EXISTS. The official Agent Teams plugin owns a board of its own, and nothing made it yield to
// the mpd RECORD: a captain could author `spawn_teammate` / `team_task_create` straight into the official
// plane, where a task needs no dependency answer, `approve` refuses no overlapping write scope, and a
// claim has no readiness gate — the three guarantees `.mpd/plans/task-dependency-guard.md` added, silently
// absent from the same workspace. The recorded consequence was a documented BYPASS (that plan's R7,
// "the official bypass is documented, not hidden"); this door replaces the documentation with the rule.
//
// WHAT IT REFUSES: exactly the five official AUTHORING verbs, by WHOLE NAME — never by prefix, never by
// case-insensitive match, never by a trim: `spawn_teammate`, `team_task_create`, `team_task_list`,
// `team_task_get`, `team_task_update`. A name that merely STARTS with one of them is a different tool and
// passes through (`test/team-door-guard.test.ts` pins the near misses), and an absent name is a
// pass-through rather than an outage.
//
// WHAT IT RELEASES, deliberately: `send_message`, `list_agents`, `wait_agent`, `interrupt_agent`. These are
// the BASE GLOBAL harness rows this bundle's own preset mounts (`presets/mpd.patch.yml:332,335`) and the
// harness instructs every continuable child to call `send_message` (`dsh-subagent/lib/index.js:1460` and
// `472-478`), so refusing them would break our own plumbing instead of the official door. The control arms
// in the test file are written to make that collateral visible if the set ever widens.
//
// SCOPE — THE CONSERVATIVE VARIANT: EVERY AGENT IS REFUSED, and the precedent's preset bypass is
// DELIBERATELY NOT mirrored. The delegation gate (`mpd-roles-plugin/src/delegation-gate.ts`) installs
// through this same seam and releases one caller before its decision:
//
//     if (rank === "captain" && !sessionIsMpdCaptain(exec?.agent)) return undefined
//
// i.e. a TOP-LEVEL session that is not the `mpd` preset's captain keeps its own habits, because that rule
// is part of what the `mpd` preset MEANS. That bypass does not transfer here, for three reasons:
//   1. the SUBJECT of this door is a WORKSPACE-scoped artifact — one `.mpd/team/teams/<id>.json` RECORD
//      per workspace — not a per-session captain contract. Releasing a foreign-preset top-level session
//      would let the official board and the mpd RECORD diverge INSIDE THE SAME WORKSPACE, which is the
//      exact fork this door exists to close;
//   2. the replacement is never further away than the refused tool: this row is mounted on the HOST plane
//      (`cordis.patch.yml`, id `mpd-team-core`), so `agent_teams_plan` / `agent_teams_task` are registered
//      process-wide and every session that receives the five names also receives the mpd door;
//   3. it would make the door a NO-OP exactly where it must bind: the repository's own recorded
//      measurement (T-92, `complexity-gate.ts`) is that a top-level session on this deployment carries
//      `agentPreset: "cordis"` — the deployment default — so a preset-keyed release would release the
//      primary session.
//
// THE REFUSAL IS THE PRODUCT. `tools.guard` denies by returning a STRING, and that string is the ONLY
// thing the model sees (the call never dispatches), so it must be one paragraph that names the refused
// tool, says WHERE this workspace's team plane is and which guarantees the official board does not carry,
// and spells the executable replacement verb by verb. A bare "denied" would leave the model to guess.
//
// HONEST BOUND, stated rather than implied: a guard reads a TOOL CALL at dispatch, so it cannot stop a
// model from TRYING a name, it does not touch the adapter's own official-executor FALLBACK (a service
// call, not a tool call), and a session on a profile WITHOUT this bundle mounted has no door at all.
import type { DshAdapter } from "../../mpd-dsh-adapter-plugin/src/index"

/**
 * The official Agent Teams AUTHORING verbs, which the mpd RECORD replaces.
 *
 * Frozen as written: the guard compares whole names, so this list is the complete surface — a sixth
 * official verb added upstream is NOT refused until it is named here, which is the conservative direction
 * (an unknown name is released rather than broken).
 */
export const TEAM_DOOR_TOOLS: readonly string[] = ["spawn_teammate", "team_task_create", "team_task_list", "team_task_get", "team_task_update"]

/**
 * The sentence a refused call carries: what was refused, WHY the official board is the wrong plane here,
 * and the executable replacement for authoring, driving and reading the team.
 *
 * ONE paragraph on purpose — it is read as a tool result, and the replacement has to be copy-pasteable.
 * @param toolName - the tool that was attempted, named in the sentence so a model cannot mistake which
 * call was refused.
 * @returns the refusal sentence.
 */
export function teamDoorRefusal(toolName: string): string {
  return "team door: `" + toolName + "` is refused — this workspace's team plane is the mpd RECORD "
    + "(`<workspace>/.mpd/team/teams/<teamId>.json`, served as `mpdTeams`), so the official board is NOT "
    + "guarded here: it asks no required dependency answer for a task, refuses no write-scope overlap at "
    + "approve, and gates no claim readiness. Author on the RECORD with `agent_teams_plan "
    + "{action:\"add_member\"|\"create_task\"|\"approve\"}`, drive it with `agent_teams_task "
    + "{action:\"claim\"|\"complete\"|\"fail\"}`, and read it with `agent_teams_plan {action:\"status\"}` — "
    + "every session in this composition carries those tools, so no lane is left without a door."
}

/** What installing the team door needs: the reporter for an install-time degradation. */
export interface TeamDoorOptions {
  /** One-line reporter for an install-time degradation (the guard itself is silent). */
  warn: (line: string) => void
}

/** The install outcome, REPORTED rather than thrown so a missing seam never aborts the row. */
export interface TeamDoorInstall {
  /** True when the guard reached the harness tool registry. */
  installed: boolean
  /** Why it did not install, when `installed` is false (already reported through `warn`). */
  reason?: string
  /** The registry's disposer, when installed, so the row can release the guard on teardown. */
  dispose?: () => void
}

/**
 * Install the team door through the adapter (`dsh.guardTool`), ONCE.
 *
 * `tools.guard` is process-wide and monotonic, so this is the ONE registration the row makes for the
 * team plane; the returned disposer releases it on row teardown.
 *
 * Degrades with a warning instead of aborting the plugin tree: without the `tools.guard` seam the rule is
 * a stated absence rather than an enforcement. NEVER throws from the guard itself — an unreadable call is
 * a pass-through, so a guard can never take an unrelated tool call down for a reason of its own.
 * @param dsh - the adapter's capability probe and its `guardTool` seam.
 * @param options - the degradation reporter.
 * @returns the install outcome.
 */
export function installTeamDoorGuard(
  dsh: Pick<DshAdapter, "capabilities" | "guardTool">,
  options: TeamDoorOptions,
): TeamDoorInstall {
  try {
    if (dsh.capabilities().toolsGuard !== true) {
      options.warn("the harness exposes no tools.guard seam — the team door is NOT installed "
        + "(the official team authoring tools stay available beside the mpd RECORD, so an authoring call "
        + "is advice-only; mounting a harness with `tools.guard` installs it with no config change)")
      return { installed: false, reason: "no-guard-seam" }
    }
    /** The refused names as a set, so the per-call decision costs one lookup instead of a scan. */
    const door = new Set(TEAM_DOOR_TOOLS)
    /** The registry's disposer, returned so the row can release the guard. */
    const dispose = dsh.guardTool((exec) => {
      try {
        /** The dispatched tool's registered name, read defensively so an unexpected shape passes through. */
        const name = String(exec?.name ?? "")
        // WHOLE-NAME MEMBERSHIP IS THE ENTIRE PREDICATE: no trim, no case folding and no prefix test, so a
        // name this set does not spell exactly is a different tool.
        if (!door.has(name)) return undefined
        return teamDoorRefusal(name)
      } catch {
        // A guard that throws would take an unrelated tool call down; an unreadable call is a
        // pass-through, and the decision above already fails closed for the names it does read.
        return undefined
      }
    })
    return { installed: true, ...(typeof dispose === "function" ? { dispose } : {}) }
  } catch (error) {
    options.warn("installing the team door failed ("
      + (error instanceof Error ? error.message : String(error)) + ")")
    return { installed: false, reason: "install-failed" }
  }
}
