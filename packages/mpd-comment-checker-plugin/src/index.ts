// C4 mpd-comment-checker-plugin: comment-detection discipline on the DSH tool seam.
// Vendored core: upstream oh-my-openagent packages/comment-checker-core parser
// (base 8c57e46, SUL-1.0 fork terms). The check runner is adapted to a
// spawnSync-based stdin JSON call against the @code-yeongyu/comment-checker
// native binary (MIT, github.com/code-yeongyu/go-claude-code-comment-checker).
// Binary resolution: MPD_DSH_COMMENT_CHECKER_BIN, then
// <repo>/.toolchain/node_modules/@code-yeongyu/comment-checker/vendor/<platform>/comment-checker.
// Opt-in by default (config.autoCheck=false; the binary is ~51MB per platform).
import { existsSync, readFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { dirname, join, resolve } from "node:path"

export const name = "mpd-comment-checker"
export const inject = ["tools"]

type Ctx = { tools: any; on: (ev: string, fn: (...a: any[]) => any) => void }
type Config = { autoCheck?: boolean; binary?: string; timeoutMs?: number; maxMessageChars?: number }

function textBlock(text: string): any { return [{ type: "text", text }] }

function repoRoot(): string {
  // this plugin's dist is <root>/packages/mpd-comment-checker-plugin/dist/index.js
  return dirname(dirname(dirname(dirname(new URL(import.meta.url).pathname))))
}

function platformKey(): string {
  const arch = process.arch === "x64" ? "x64" : process.arch
  return process.platform + "-" + arch
}

export function resolveBinary(config: Config): string | null {
  if (config.binary && existsSync(resolve(config.binary))) return resolve(config.binary)
  const env = process.env.MPD_DSH_COMMENT_CHECKER_BIN
  if (env && existsSync(env)) return env
  const candidates = [
    join(repoRoot(), ".toolchain", "node_modules", "@code-yeongyu", "comment-checker", "vendor", platformKey(), "comment-checker"),
    join(repoRoot(), ".toolchain", "node_modules", "@code-yeongyu", "comment-checker", "bin", "comment-checker")
  ]
  for (const c of candidates) if (existsSync(c)) return c
  return null
}

function hookInputFor(path: string, content: string): any {
  return {
    session_id: "mpd",
    tool_name: "Write",
    transcript_path: "",
    cwd: process.env.DSH_WORKSPACE_ROOT ?? process.cwd(),
    hook_event_name: "PostToolUse",
    tool_input: { file_path: path, content },
    tool_response: { content: [{ type: "text", text: "file content" }], details: null, isError: false }
  }
}

function runCheck(binary: string, hookInput: any, timeoutMs: number): { hasComments: boolean; message: string } {
  const r = spawnSync(binary, ["check"], { input: JSON.stringify(hookInput), encoding: "utf8", timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 })
  if (r.error) throw new Error("mpd-comment-checker: spawn failed: " + String(r.error.message ?? r.error))
  const stderr = (r.stderr ?? "") + (r.stdout ?? "")
  if (r.status === 0) return { hasComments: false, message: "" }
  if (r.status === 2) return { hasComments: true, message: stderr }
  return { hasComments: false, message: "unexpected exit " + r.status + ": " + stderr.slice(0, 200) }
}

export { hookInputFor, runCheck }

export function apply(ctx: Ctx, config: Config = {}): void {
  const timeoutMs = config.timeoutMs ?? 30000
  const maxMessageChars = config.maxMessageChars ?? 12000

  ctx.tools.register({
    name: "mpd_comment_check",
    description: "Run the comment/docstring detector on one or more files (content in memory or read from disk). Returns per-file detection results; exit 2 means comments/docstrings found and the binary message spells the required action. The binary (@code-yeongyu/comment-checker, MIT) must be installed in .toolchain (installer flag --with-comment-checker) or set via MPD_DSH_COMMENT_CHECKER_BIN.",
    parameters: { type: "object", properties: { files: { type: "array", items: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path"], additionalProperties: false } } }, required: ["files"] },
    output: { schema: { type: "object", properties: { binary: { type: "string" }, results: { type: "array", items: { type: "object" } } }, required: ["binary", "results"] }, render: (_a: unknown, v: any) => textBlock("comment-check binary=" + v.binary + "\n" + v.results.map((x: any) => (x.hasComments ? "DETECTED " + x.path + ": " + x.message.slice(0, maxMessageChars) : "clean " + x.path)).join("\n")) },
    execute: async (args: any) => {
      const binary = resolveBinary(config)
      if (!binary) throw new Error("mpd-comment-checker: binary not found — run the installer with --with-comment-checker or set MPD_DSH_COMMENT_CHECKER_BIN")
      const files = Array.isArray(args?.files) ? args.files : []
      const results = []
      for (const f of files) {
        const path = String(f.path)
        const content = typeof f.content === "string" ? f.content : (existsSync(path) ? readFileSync(path, "utf8") : "")
        if (!content) { results.push({ path, hasComments: false, message: "no content to check" }); continue }
        try {
          const res = runCheck(binary, hookInputFor(path, content), timeoutMs)
          if (!res.hasComments && res.message) results.push({ path, hasComments: false, message: res.message })
          else results.push({ path, ...res })
        } catch (e: any) { results.push({ path, hasComments: false, message: "error: " + String(e?.message ?? e) }) }
      }
      return { binary, results }
    }
  })

  if (config.autoCheck === true) {
    ctx.on("tools/post-execute", async (exec: any, result: any, next: any) => {
      const out = await next()
      if (out.kind !== "accept") return out
      const isEdit = exec.name === "edit" || exec.name === "str_replace_editor" || exec.name === "write"
      if (!isEdit) return out
      const fp = exec.arguments?.file_path ?? exec.arguments?.path
      if (typeof fp !== "string") return out
      const binary = resolveBinary(config)
      if (!binary) return out
      let content = ""
      try { content = readFileSync(fp, "utf8") } catch { return out }
      if (!content) return out
      const res = runCheck(binary, hookInputFor(fp, content), timeoutMs)
      if (!res.hasComments) return out
      const hint = "\n[mpd-comment-checker] comments/docstrings detected in " + fp + ":\n" + res.message.slice(0, maxMessageChars)
      const c = out.content ?? result?.content ?? ""
      return { ...out, content: typeof c === "string" ? c + hint : c }
    })
  }
}
