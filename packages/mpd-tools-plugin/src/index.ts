// B1 omo-tools-plugin: port of upstream tool-level hooks onto DSH tool pipeline.
// 1) write-existing-file guard (deny silent clobber; identical content passes; use edit instead)
// 2) tool-output truncation (post-execute, token budget protection)
// 3) edit-error recovery guidance (post-execute)
import { existsSync, readFileSync } from "node:fs"

export const name = "omo-tools"
export const inject = ["tools"]

type Ctx = { tools: any; on: (ev: string, fn: (...args: any[]) => any) => void; [k: string]: any }
type Config = { writeGuard?: boolean; truncateMaxBytes?: number; recoveryHint?: string }

export function apply(ctx: Ctx, config: Config = {}): void {
  const writeGuard = config.writeGuard ?? true
  const maxBytes = config.truncateMaxBytes ?? 16384
  const recoveryHint = config.recoveryHint ??
    "omo-tools recovery: read the file fresh with the read tool, re-check exact old_string/new_string (whitespace matters), then retry the edit against the current file content."

  // 1) guard: no silent overwrite via write
  if (writeGuard) {
    ctx.tools.guard((exec: any) => {
      if (exec.name !== "write") return undefined
      const fp = exec.arguments?.file_path
      const content = exec.arguments?.content
      if (typeof fp !== "string" || typeof content !== "string") return undefined
      if (!existsSync(fp)) return undefined
      try {
        const old = readFileSync(fp, "utf8").slice(0, 1_048_576)
        if (old === content) return undefined // idempotent rewrite passes
      } catch { return undefined }
      return "omo-tools guard: target file already exists with different content — use the edit tool (or read then rewrite deliberately via write with identical content) instead of overwriting."
    })
  }

  // 2) truncate oversized tool outputs (post-execute waterfall)
  ctx.on("tools/post-execute", async (exec: any, result: any, next: any) => {
    const out = await next()
    if (out.kind !== "accept") return out
    const content = out.content ?? result?.content
    if (typeof content !== "string" || content.length <= maxBytes) return out
    const head = content.slice(0, Math.floor(maxBytes * 0.7))
    const tail = content.slice(-Math.floor(maxBytes * 0.3))
    return { ...out, content: head + "\n... [omo-tools truncated " + content.length + " bytes; keep " + maxBytes + " budget; tail follows] ...\n" + tail }
  })

  // 3) edit-error recovery guidance
  ctx.on("tools/post-execute", async (exec: any, result: any, next: any) => {
    const out = await next()
    if (out.kind !== "accept") return out
    const isEdit = exec.name === "edit" || exec.name === "str_replace_editor"
    if (!isEdit || !result?.isError) return out
    const msg = result?.error?.message ?? String(result?.error ?? "edit failed")
    const content = out.content ?? result?.content ?? msg
    return { ...out, content: "Edit failed: " + msg + "\n" + recoveryHint }
  })
}
