// The `/mpd` command — the documented entry point for the mpd surfaces.
//
// Grammar (t3 brief §c + frozen contract `.mpd/plans/tui-team-surface.md` §5.1):
//   `/mpd`             -> picker (the host dialog supplies the labels)
//   `/mpd <value>`     -> apply that action directly
//   `/mpd team`        -> open the team-workflow scene
//   `/mpd plan`        -> open the plan-approval scene
//   `/mpd status`      -> print the current state
//
// A command is an ENTRY POINT, never the deliverable: the surfaces themselves are
// the full-screen scenes (frozen §1).
//
// The command registry is the HARNESS command service (`ctx.commands`,
// dsh-commands): it is not one of the four harness seams owned by
// packages/mpd-dsh-adapter-plugin, and the host TUI guide registers the
// scene-opening command directly (spec §接缝八 step 2). It is activated through
// the deferred inject form like every other seam here.
//
// Registering it is what makes the `tuiCommandTrees` provider truthful: the
// tree's must match a real command-registry entry.
//
// The board action is also the ONLY place this plugin appends its log-only
// session event, and only after `registration.ts` VERIFIED that the event type is
// known to a reachable dsh-session copy — an unregistered log-only event would
// make the user's session unresumable (iron rule 2).
import type { SeamOutcome, SessionLike, TuiAdapter } from "./types.js"
import type { Log } from "./log.js"
import { scalarText } from "./sanitize.js"
import { BOARD_OPENED_EVENT } from "./registration.js"
import { COMMAND_ACTIONS, COMMAND_ROOT, MODEL_COMMAND, MODEL_COMMAND_DESCRIPTION } from "./command-trees.js"
import type { PanelOutcome } from "./panel.js"
import { panelStatusLine } from "./panel.js"
import { t } from "./i18n.js"

/**
 * How one routed panel open ended, plus the id it went to.
 *
 * `outcome` is the panel surface's own three-state answer (see `panel.ts`), carried through the
 * command layer unchanged so the two entry points cannot disagree about which surface opened.
 */
export interface PanelRoute {
  /** The surface the routed open ended on. */
  readonly outcome: PanelOutcome
  /** The final host panel id, when one was discovered. */
  readonly id: string | undefined
}

/** What the command needs from the rest of the plugin. */
export interface CommandActions {
  /** Opens the board; false when the scene seam is absent in this composition. */
  openBoard(via: "command" | "shortcut"): boolean
  /** Open the team-workflow surface (frozen §3.1). */
  openTeam(): boolean
  /** Open the merged panel: the host's own subagent rows above the MPD team body. */
  openSubagents(): boolean
  /**
   * Open the SIDEBAR panel, or the full-screen merged scene when this host has no usable panel seam.
   * Returns how the routed open ended, so the printed line names the surface the user is looking at
   * instead of claiming the panel opened when the scene did.
   */
  openPanel(): PanelRoute
  /** The plan-approval surface (frozen §3.2). */
  openPlan(): boolean
  /** The status line as text, for the `/mpd status` print path. */
  statusText(): string
  /** The workmate library as text, for the `/mpd workmates` print path. */
  workmatesText(): string
  /** Picker for the bare form; undefined when no dialog seam is available. */
  pickAction(): Promise<string | undefined>
  /** The `/mpd-model` pick-list chain; its result is the command's own rendered outcome. */
  openModelMenu(): Promise<CommandResult>
  /** Append the log-only board-opened record when it is safe to do so. */
  recordBoardOpened(via: "command" | "shortcut", session: SessionLike | undefined): void
}

/** What a command handler returns: success with optional output, or a user-facing error. */
type CommandResult = { kind: "success"; text?: string } | { kind: "error"; text: string }

/** The usage suffix of an unknown-action error; the action list is the tree's own. */
const USAGE = `/${COMMAND_ROOT} [${COMMAND_ACTIONS.join("|")}]`

/**
 * Activate `/mpd` and `/mpd-model`.
 * @param tui - the DSH-TUI seam adapter (this file names no seam id of its own).
 * @param actions - the handlers.
 * @returns the seam handle.
 */
export function registerCommands(tui: TuiAdapter, actions: CommandActions): { outcome(): SeamOutcome } {
  /** The adapter's handle for this one registration; it carries the measured outcome. */
  const handle = tui.registerCommand({
    name: COMMAND_ROOT,
    description: "MPD: open the board or the team surfaces, list the workmate library, or print the status line",
    handler: async (invocation): Promise<CommandResult> => {
      /** The invocation's lower-cased input, empty for the bare `/mpd` form. */
      const raw = typeof invocation?.rawInput === "string" ? invocation.rawInput.trim().toLowerCase() : ""
      /** The invoking session when the registry supplied one; the log-only record needs it. */
      const session = invocation?.agent?.session
      if (raw === "") {
        // Bare form = picker. The host dialog supplies the localized chrome;
        // labels stay the host's where the contract wants that.
        const picked = await actions.pickAction()
        return runAction(picked ?? "board", actions, session)
      }
      /** The first whitespace-separated token, i.e. the action to run. */
      const head = raw.split(/\s+/u)[0] ?? ""
      return runAction(head, actions, session)
    },
  })
  // The pick-list model settings menu is its OWN command (R3): `/mpd model` would collide with
  // the `/mpd` grammar's single-value form, and a menu is an entry point a user reaches directly.
  // Its outcome text is the chain's own sentence (see `model-menu.ts`), so nothing is reworded
  // here — a failure to write must reach the user as the sentence that names the failure.
  tui.registerCommand({
    name: MODEL_COMMAND,
    description: MODEL_COMMAND_DESCRIPTION,
    handler: async (): Promise<CommandResult> => actions.openModelMenu(),
  })
  return { outcome: (): SeamOutcome => handle.outcome() }
}

/** One action of the `/mpd` grammar. */
function runAction(action: string, actions: CommandActions, session: SessionLike | undefined): CommandResult {
  if (action === "board") {
    // Record BEFORE opening: the transcript row must be projected while the chat
    // is still the active screen (a scene hides it until it closes).
    actions.recordBoardOpened("command", session)
    /** Whether the board scene opened; a refusal becomes a command error. */
    const opened = actions.openBoard("command")
    return opened ? { kind: "success" } : { kind: "error", text: t("command.boardMissing") }
  }
  if (action === "workmates") return { kind: "success", text: clamp(actions.workmatesText()) }
  if (action === "status") return { kind: "success", text: clamp(actions.statusText()) }
  if (action === "team") {
    return actions.openTeam()
      ? { kind: "success" }
      : { kind: "error", text: t("command.teamMissing") }
  }
  if (action === "subagents") {
    return actions.openSubagents()
      ? { kind: "success" }
      : { kind: "error", text: t("command.subagentsMissing") }
  }
  if (action === "panel") {
    // `/mpd panel` always PRINTS which surface it reached (frozen clause R4 + the wave's status-line
    // requirement): a routed open that fell back to the full-screen scene must not read as a panel
    // that opened, and a host without the seam must say so rather than stay silent.
    /** How the routed open ended, and the discovered host panel id. */
    const route = actions.openPanel()
    return { kind: "success", text: clamp(panelStatusLine(route.outcome, route.id)) }
  }
  if (action === "plan") {
    return actions.openPlan()
      ? { kind: "success" }
      : { kind: "error", text: t("command.planMissing") }
  }
  return { kind: "error", text: t("command.unknownAction", { action: clamp(action, 40), usage: USAGE }) }
}

/**
 * Append the log-only board-opened record to the invoking session.
 * @param session - the live session, when the command registry supplied one.
 * @param typeKnown - the verification result from `registration.ts`.
 * @param via - which entry point opened the board.
 * @param view - the opened view id.
 * @param log - diagnostics.
 */
export function appendBoardOpened(
  session: SessionLike | undefined,
  typeKnown: boolean,
  via: "command" | "shortcut",
  view: string,
  log: Log,
): boolean {
  if (session === undefined || typeof session.append !== "function") return false
  if (!typeKnown) {
    // Iron rule 2 is not satisfied for any reachable dsh-session copy: skip the
    // record instead of risking an unresumable session log.
    log.debug("board-opened record skipped: the event type is not known to the live dsh-session copy")
    return false
  }
  try {
    session.append(BOARD_OPENED_EVENT, { view, via, at: Date.now() })
    return true
  } catch (error) {
    log.debug(`board-opened record failed: ${String((error as Error)?.message ?? error)}`)
    return false
  }
}

/**
 * Clamps command output to the host's message budget.
 * @param value - the text to clamp.
 * @param maxCells - the cell cap; 800 when the caller does not say.
 * @returns the clamped text, or an empty string when it is not renderable.
 */
function clamp(value: string, maxCells: number = 800): string {
  return scalarText(value, maxCells) ?? ""
}
