// Seam 5 — `ctx.tuiCommandTrees`: subcommand completion for `/mpd`.
//
// Conventions (t3 brief §c): the provider's `root` must match a real command
// registry entry (kebab-lowercase, unique); this plugin registers `/mpd` itself,
// so the tree and the command cannot drift apart. Completion is display metadata
// only — execution stays with the command registry.
import type { PluginContextLike, SeamOutcome, TuiCommandTreesLike } from "./types.js"
import type { Log } from "./log.js"
import { onService } from "./host.js"

/** The command root the tree completes (`/mpd`). */
export const COMMAND_ROOT = "mpd"

/** Actions the `/mpd` grammar accepts (bare = picker, `<value>` = direct, `status` = print). */
export const COMMAND_ACTIONS: readonly string[] = ["board", "team", "plan", "workmates", "status"]

/** Children advertised for `/mpd <child>`. */
export const COMMAND_CHILDREN: readonly { name: string; description: string; descriptions?: Record<string, string> }[] = [
  { name: "board", description: "Open the mpd board scene", descriptions: { zh: "打开 MPD 面板" } },
  { name: "team", description: "Open the team workflow scene", descriptions: { zh: "打开团队工作流面板" } },
  { name: "plan", description: "Review and approve a staged plan", descriptions: { zh: "审阅并批准待定计划" } },
  { name: "workmates", description: "List the durable workmate library", descriptions: { zh: "列出 workmate 库" } },
  { name: "status", description: "Print the mpd status line", descriptions: { zh: "输出 MPD 状态行" } },
]

/**
 * Activate the command-tree provider.
 * @param ctx - the plugin context.
 * @param log - diagnostics.
 * @returns the seam handle.
 */
export function registerCommandTrees(ctx: PluginContextLike, log: Log): { outcome(): SeamOutcome } {
  /** The seam result, rewritten when the provider is requested or refused. */
  let outcome: SeamOutcome = { state: "absent", detail: "tuiCommandTrees was not injected" }

  onService(ctx, "tuiCommandTrees", (_scoped, service) => {
    /** The probed service as the tree provider it must be, before `register` is trusted. */
    const trees = service as TuiCommandTreesLike
    if (typeof trees?.register !== "function") {
      outcome = { state: "refused", detail: "tuiCommandTrees.register is missing" }
      return
    }
    try {
      trees.register({
        root: COMMAND_ROOT,
        descriptions: { zh: "MPD 面板与状态" },
        // Only the root's children are claimed: a deeper path is not ours to complete.
        children: (canonicalPath: readonly string[]) => (canonicalPath.length <= 1 ? COMMAND_CHILDREN : []),
      })
      // No read-back for a provider, and a refused provider also returns a
      // disposer: `requested`, never "registered".
      outcome = { state: "requested", detail: `provider for /${COMMAND_ROOT} requested (no host read-back)` }
    } catch (error) {
      outcome = { state: "refused", detail: String((error as Error)?.message ?? error) }
      log.debug(`tuiCommandTrees registration refused: ${outcome.detail ?? ""}`)
    }
  })

  return { outcome: () => outcome }
}
