// Seam 5 — `ctx.tuiCommandTrees`: subcommand completion for `/mpd` and `/mpd-model`.
//
// Conventions (t3 brief §c): the provider's `root` must match a real command
// registry entry (kebab-lowercase, unique); this plugin registers `/mpd` itself,
// so the tree and the command cannot drift apart. Completion is display metadata
// only — execution stays with the command registry.
//
// BILINGUAL (R4). The root and every child carry BOTH halves of `descriptions`; the host
// resolves them with its own active language when it renders the completion menu, so `/lang`
// repaints them without a plugin-side subscription. The plain `description` field stays the
// English fallback the host uses when a language is unavailable, so the `en` half of the pair IS
// that string by construction — the two cannot drift.
import type { SeamOutcome, TuiAdapter } from "./types.js"

/** The command root the tree completes (`/mpd`). */
export const COMMAND_ROOT = "mpd"

/** The pick-list command's name, without the leading slash. */
export const MODEL_COMMAND = "mpd-model"

/** Actions the `/mpd` grammar accepts (bare = picker, `<value>` = direct, `status` = print). */
export const COMMAND_ACTIONS: readonly string[] = ["board", "team", "plan", "subagents", "panel", "dag", "workmate", "workmates", "status"]

/**
 * One completion node: the English fallback the host holds in `description`, plus BOTH halves of
 * the localized pair it resolves at render time.
 */
export interface CommandChild {
  /** The subcommand name as typed. */
  readonly name: string
  /** The English description — also the `en` half of {@link descriptions}. */
  readonly description: string
  /** The localized description pair the host resolves with its active language. */
  readonly descriptions: { readonly zh: string; readonly en: string }
}

/** Children advertised for `/mpd <child>`. */
export const COMMAND_CHILDREN: readonly CommandChild[] = [
  { name: "board", description: "Open the mpd board scene", descriptions: { zh: "打开 MPD 面板", en: "Open the mpd board scene" } },
  { name: "team", description: "Open the team workflow scene", descriptions: { zh: "打开团队工作流面板", en: "Open the team workflow scene" } },
  { name: "plan", description: "Review and approve a staged plan", descriptions: { zh: "审阅并批准待定计划", en: "Review and approve a staged plan" } },
  { name: "subagents", description: "Open the subagents + team panel", descriptions: { zh: "打开子代理与团队合并面板", en: "Open the subagents + team panel" } },
  { name: "panel", description: "Open the sidebar panel, or the full-screen merged panel where the host has no panel seam", descriptions: { zh: "打开侧栏面板；宿主无面板接缝时使用全屏合并面板", en: "Open the sidebar panel, or the full-screen merged panel where the host has no panel seam" } },
  // AMENDED (wave `tui-014-adaptation`, clause C3): the DAG page has NO sidebar panel of its own any
  // more — it merged INTO the MPD panel, and this route re-aims onto that panel. The old wording
  // promised a separate panel the sidebar no longer contains, and this description is USER-VISIBLE in
  // the command palette, so the promise had to move with the merge.
  { name: "dag", description: "Open the MPD panel on its dependency DAG, or the full-screen DAG scene", descriptions: { zh: "打开 MPD 面板的依赖 DAG 视图；无接缝时使用全屏 DAG 场景", en: "Open the MPD panel on its dependency DAG, or the full-screen DAG scene" } },
  { name: "workmate", description: "Open the workmate page (its own sidebar panel), or the full-screen fallback", descriptions: { zh: "打开 workmate 页面（独立侧栏面板）；无接缝时使用全屏回退", en: "Open the workmate page (its own sidebar panel), or the full-screen fallback" } },
  { name: "workmates", description: "List the durable workmate library", descriptions: { zh: "列出 workmate 库", en: "List the durable workmate library" } },
  { name: "status", description: "Print the mpd status line", descriptions: { zh: "输出 MPD 状态行", en: "Print the mpd status line" } },
]

/** The root's own description pair, used by the tree provider and by the command registration. */
export const COMMAND_ROOT_DESCRIPTIONS: { readonly zh: string; readonly en: string } = {
  zh: "MPD 面板与状态",
  en: "MPD surfaces: the board, the team workflow and the status line",
}

/** The `/mpd-model` description pair (the root of the pick-list command's own tree). */
export const MODEL_COMMAND_DESCRIPTIONS: { readonly zh: string; readonly en: string } = {
  zh: "选择式模型设置：槽位 → 提供商 → 模型 → 推理强度",
  en: "Pick-list model settings: slot → provider → model → reasoning effort",
}

/** The ENGLISH fallback description of `/mpd-model`, as the harness command registry stores it. */
export const MODEL_COMMAND_DESCRIPTION = MODEL_COMMAND_DESCRIPTIONS.en

/**
 * Activate the command-tree providers: one for `/mpd` (its subcommands) and one for `/mpd-model`.
 *
 * Both are registered from this single function because they belong to the same surface and the
 * same seam handle — a composition that has no command trees loses both, and says so once.
 * @param tui - the DSH-TUI seam adapter (this file names no seam id of its own).
 * @returns the seam handle.
 */
export function registerCommandTrees(tui: TuiAdapter): { outcome(): SeamOutcome } {
  /** The adapter's handle for the `/mpd` tree; it carries the measured outcome. */
  const handle = tui.registerCommandTree({
    root: COMMAND_ROOT,
    descriptions: COMMAND_ROOT_DESCRIPTIONS,
    // Only the root's children are claimed: a deeper path is not ours to complete.
    children: (canonicalPath: readonly string[]) => (canonicalPath.length <= 1 ? COMMAND_CHILDREN : []),
  })
  // The pick-list command has no subcommands (its arguments are picked in the dialog, never typed),
  // so its provider claims the root and completes nothing below it. Registering it is what keeps
  // the completion menu honest that `/mpd-model` exists.
  tui.registerCommandTree({
    root: MODEL_COMMAND,
    descriptions: MODEL_COMMAND_DESCRIPTIONS,
    children: () => [],
  })
  return { outcome: (): SeamOutcome => handle.outcome() }
}
