// Seam 5 — `ctx.tuiCommandTrees`: subcommand completion for `/mpd`.
//
// Conventions (t3 brief §c): the provider's `root` must match a real command
// registry entry (kebab-lowercase, unique); this plugin registers `/mpd` itself,
// so the tree and the command cannot drift apart. Completion is display metadata
// only — execution stays with the command registry.
import type { SeamOutcome, TuiAdapter } from "./types.js"

/** The command root the tree completes (`/mpd`). */
export const COMMAND_ROOT = "mpd"

/** Actions the `/mpd` grammar accepts (bare = picker, `<value>` = direct, `status` = print). */
export const COMMAND_ACTIONS: readonly string[] = ["board", "team", "plan", "subagents", "workmates", "status"]

/** Children advertised for `/mpd <child>`. */
export const COMMAND_CHILDREN: readonly { name: string; description: string; descriptions?: Record<string, string> }[] = [
  { name: "board", description: "Open the mpd board scene", descriptions: { zh: "打开 MPD 面板" } },
  { name: "team", description: "Open the team workflow scene", descriptions: { zh: "打开团队工作流面板" } },
  { name: "plan", description: "Review and approve a staged plan", descriptions: { zh: "审阅并批准待定计划" } },
  { name: "subagents", description: "Open the subagents + team panel", descriptions: { zh: "打开子代理与团队合并面板" } },
  { name: "workmates", description: "List the durable workmate library", descriptions: { zh: "列出 workmate 库" } },
  { name: "status", description: "Print the mpd status line", descriptions: { zh: "输出 MPD 状态行" } },
]

/**
 * Activate the command-tree provider.
 * @param tui - the DSH-TUI seam adapter (this file names no seam id of its own).
 * @returns the seam handle.
 */
export function registerCommandTrees(tui: TuiAdapter): { outcome(): SeamOutcome } {
  /** The adapter's handle for this one registration; it carries the measured outcome. */
  const handle = tui.registerCommandTree({
    root: COMMAND_ROOT,
    descriptions: { zh: "MPD 面板与状态" },
    // Only the root's children are claimed: a deeper path is not ours to complete.
    children: (canonicalPath: readonly string[]) => (canonicalPath.length <= 1 ? COMMAND_CHILDREN : []),
  })
  return { outcome: (): SeamOutcome => handle.outcome() }
}
