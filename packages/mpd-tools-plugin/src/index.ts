// B1 mpd-tools-plugin: port of upstream tool-level hooks onto DSH tool pipeline.
// 1) write-existing-file guard (deny silent clobber; identical content passes; use edit instead)
// 2) tool-output truncation (post-execute, token budget protection)
// 3) edit-error recovery guidance (post-execute)
import { existsSync, readFileSync } from "node:fs"
import { createDshAdapter } from "../../mpd-dsh-adapter-plugin/src/index"

export const name = "mpd-tools"
export const inject = ["tools"]

type Ctx = { tools: any; on: (ev: string, fn: (...args: any[]) => any) => void; [k: string]: any }
type Config = { writeGuard?: boolean; truncateMaxBytes?: number; recoveryHint?: string }

export function apply(ctx: Ctx, config: Config = {}): void {
  // Every harness seam goes through the shared adapter (see packages/mpd-dsh-adapter-plugin).
  const dsh = (typeof ctx.get === "function" ? ctx.get("mpdDsh") : undefined) ?? createDshAdapter(ctx)
  const writeGuard = config.writeGuard ?? true
  const maxBytes = config.truncateMaxBytes ?? 16384
  const recoveryHint = config.recoveryHint ??
    "mpd-tools recovery: read the file fresh with the read tool, re-check exact old_string/new_string (whitespace matters), then retry the edit against the current file content."

  // 1) guard: no silent overwrite via write
  if (writeGuard) {
    dsh.guardTool((exec: any) => {
      if (exec.name !== "write") return undefined
      const fp = exec.arguments?.file_path
      const content = exec.arguments?.content
      if (typeof fp !== "string" || typeof content !== "string") return undefined
      if (!existsSync(fp)) return undefined
      try {
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
    const text = blocksToText(out.content ?? result?.content)
    if (text.length <= maxBytes) return out
    const banner = "\n... [mpd-tools truncated " + text.length + " chars; keep " + maxBytes + " budget; tail follows] ...\n"
    const budget = Math.max(0, maxBytes - banner.length) // banner counts against the budget
    const head = budget > 0 ? text.slice(0, Math.floor(budget * 0.7)) : ""
    const tail = budget > 0 ? text.slice(-Math.floor(budget * 0.3)) : ""
    return { ...out, content: [{ type: "text", text: head + banner + tail }] }
  })

  // 3) edit-error recovery guidance
  dsh.onPostToolExecute(async (exec: any, result: any, out: any) => {
    if (out.kind !== "accept") return out
    const isEdit = exec.name === "edit" || exec.name === "str_replace_editor"
    if (!isEdit || !result?.isError) return out
    const msg = result?.error?.message ?? String(result?.error ?? "edit failed")
    const prior = blocksToText(out.content ?? result?.content)
    return { ...out, content: [{ type: "text", text: (prior ? prior + "\n\n" : "") + "Edit failed: " + msg + "\n" + recoveryHint }] }
  })
}
