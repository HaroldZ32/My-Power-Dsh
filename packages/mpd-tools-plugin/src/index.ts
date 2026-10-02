// B1 mpd-tools-plugin: port of upstream tool-level hooks onto DSH tool pipeline.
// 1) write-existing-file guard (deny silent clobber; identical content passes; use edit instead)
// 2) tool-output truncation (post-execute, token budget protection)
// 3) edit-error recovery guidance (post-execute)
import { existsSync, readFileSync } from "node:fs"
import { DSH_SEAM_TOOLS, dshSeamInject, resolveDshAdapter } from "../../mpd-dsh-adapter-plugin/src/index"

/** The plugin id the bundle row mounts this module under. */
export const name = "mpd-tools"
/** The tool registry this row attaches its guard and both waterfalls to, named by its adapter constant. */
export const inject = dshSeamInject(DSH_SEAM_TOOLS)

/** The slice of the row context this plugin reads: the tool registry plus the event bus the adapter resolves. */
type Ctx = { tools: any; on: (ev: string, fn: (...args: any[]) => any) => void; [k: string]: any }
/** The row's own config keys; every one is optional because the defaults below are the shipped behaviour. */
type Config = { writeGuard?: boolean; truncateMaxBytes?: number; recoveryHint?: string }

/**
 * Install the three agent-safety hooks on this row's tool pipeline: the pre-execute write guard, the
 * post-execute output truncation and the post-execute edit-error recovery hint.
 *
 * @param ctx - the row context; both harness seams are reached through `resolveDshAdapter`, never directly.
 * @param config - row overrides for the three defenses; omitted keys keep the documented defaults.
 */
export function apply(ctx: Ctx, config: Config = {}): void {
  // Every harness seam goes through the shared adapter (see packages/mpd-dsh-adapter-plugin).
  const dsh: any = resolveDshAdapter(ctx)
  /** Whether the pre-execute write guard is armed; armed unless the row turns it off. */
  const writeGuard = config.writeGuard ?? true
  /** The character budget one tool result may keep before truncation rewrites it. */
  const maxBytes = config.truncateMaxBytes ?? 16384
  /** The guidance appended to a failed edit's output; the row may replace the built-in text. */
  const recoveryHint = config.recoveryHint ??
    "mpd-tools recovery: read the file fresh with the read tool, re-check exact old_string/new_string (whitespace matters), then retry the edit against the current file content."

  // 1) guard: no silent overwrite via write
  if (writeGuard) {
    dsh.guardTool((exec: any) => {
      if (exec.name !== "write") return undefined
      /** The requested target path, when the call carried a string one. */
      const fp = exec.arguments?.file_path
      /** The requested file body, when the call carried a string one. */
      const content = exec.arguments?.content
      if (typeof fp !== "string" || typeof content !== "string") return undefined
      if (!existsSync(fp)) return undefined
      try {
        /** The current on-disk body, read only to tell an idempotent rewrite from a clobber. */
        const old = readFileSync(fp, "utf8")
        if (old === content) return undefined // idempotent rewrite passes
      } catch { return undefined }
      return "mpd-tools guard: target file already exists with different content — use the edit tool (or read then rewrite deliberately via write with identical content) instead of overwriting."
    })
  }

  // post-execute content is ContentBlock[] (official PostToolDecision shape);
  // extract text, then replace with one text block.
  function blocksToText(content: any): string {
    if (typeof content === "string") return content
    if (Array.isArray(content)) return content.map((b: any) => (b && b.type === "text" ? b.text : "")).join("\n")
    return ""
  }

  // 2) truncate oversized tool outputs (post-execute waterfall)
  dsh.onPostToolExecute(async (exec: any, result: any, out: any) => {
    if (out.kind !== "accept") return out
    /** The result's visible text, taken from the replacement content or the raw result. */
    const text = blocksToText(out.content ?? result?.content)
    if (text.length <= maxBytes) return out
    /** The marker spliced between the kept head and tail; its own length counts against the budget. */
    const banner = "\n... [mpd-tools truncated " + text.length + " chars; keep " + maxBytes + " budget; tail follows] ...\n"
    /** The characters left for the head and tail once the banner is paid for. */
    const budget = Math.max(0, maxBytes - banner.length) // banner counts against the budget
    /** The leading slice, 70% of what is left after the banner (empty when the banner alone overruns). */
    const head = budget > 0 ? text.slice(0, Math.floor(budget * 0.7)) : ""
    /** The trailing slice, the remaining 30% (empty when the banner alone overruns). */
    const tail = budget > 0 ? text.slice(-Math.floor(budget * 0.3)) : ""
    return { ...out, content: [{ type: "text", text: head + banner + tail }] }
  })

  // 3) edit-error recovery guidance
  dsh.onPostToolExecute(async (exec: any, result: any, out: any) => {
    if (out.kind !== "accept") return out
    /** Whether the failed call was one of the two editing tools this hint is written for. */
    const isEdit = exec.name === "edit" || exec.name === "str_replace_editor"
    if (!isEdit || !result?.isError) return out
    /** The tool's own failure text, or a generic fallback when it reported none. */
    const msg = result?.error?.message ?? String(result?.error ?? "edit failed")
    /** Whatever text the result already carried, kept in front of the recovery hint. */
    const prior = blocksToText(out.content ?? result?.content)
    return { ...out, content: [{ type: "text", text: (prior ? prior + "\n\n" : "") + "Edit failed: " + msg + "\n" + recoveryHint }] }
  })
}
