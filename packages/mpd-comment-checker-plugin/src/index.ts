// C4 mpd-comment-checker-plugin: comment-detection discipline on the DSH tool seam.
// No vendored parser: this row VENDORS NOTHING. Detection is done by the on-demand npm
// binary @code-yeongyu/comment-checker, which this plugin RESOLVES and then SPAWNS per
// check as a spawnSync-based stdin JSON call (MIT,
// github.com/code-yeongyu/go-claude-code-comment-checker).
// Binary resolution: dependency-first — @code-yeongyu/comment-checker is declared
// as an optionalDependency of the bundle package (used UNMODIFIED, per policy),
// resolved from the plugin's own package location via createRequire; then env /
// dev-toolchain fallbacks for local checkout QA.
// Opt-in behavior: config.autoCheck=false by default (the binary is ~51MB).
import { existsSync, readFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { dirname, isAbsolute, join, resolve } from "node:path"
import { DSH_SEAM_TOOLS, bundleRootOf, dshSeamInject, textBlock, workspaceRootOf, resolveDshAdapter } from "../../mpd-dsh-adapter-plugin/src/index"

/** The cordis row id this plugin registers under; the bundle patch mounts it as `mpd-comment-checker`. */
export const name = "mpd-comment-checker"
/** Cordis service ids this row waits for; the tool seam is its only hard requirement. */
export const inject = dshSeamInject(DSH_SEAM_TOOLS)

/** The slice of the cordis context this row uses: the tool seam plus the optional config service. */
type Ctx = { tools: any; on: (ev: string, fn: (...a: any[]) => any) => void; get?: (k: string) => any }
/** Row config, overridable per key by the `mpdConfig` runtime layer (mpd.jsonc wins). */
type Config = { autoCheck?: boolean; binary?: string; timeoutMs?: number; maxMessageChars?: number }

/** Merge the row config with the mpdConfig runtime layer (mpd.jsonc wins per key). */
function mergedConfig(ctx: Ctx, config: Config): Config {
  /** The mpdConfig service when a config plugin is composed; absent leaves the row config authoritative. */
  const svc = ctx.get?.("mpdConfig") as { get: (k?: string) => any } | undefined
  if (!svc?.get) return config
  /** Reads one `mpd.jsonc` leaf through the config service, keyed by its dotted path. */
  const v = (k: string): unknown => svc.get(k)
  // Every leaf below is asserted to the type its own `typeof` guard just proved: `unknown` cannot be
  // narrowed across the `v(...)` call boundary, and the config service declares no value type.
  return {
    ...config,
    autoCheck: typeof v("commentChecker.autoCheck") === "boolean" ? (v("commentChecker.autoCheck") as boolean) : config.autoCheck,
    binary: typeof v("commentChecker.bin") === "string" ? (v("commentChecker.bin") as string) : config.binary,
    timeoutMs: typeof v("commentChecker.timeoutMs") === "number" ? (v("commentChecker.timeoutMs") as number) : config.timeoutMs,
    maxMessageChars: typeof v("commentChecker.maxMessageChars") === "number" ? (v("commentChecker.maxMessageChars") as number) : config.maxMessageChars,
  }
}


// The bundle root, resolved by the shared helper (bundleRootOf): this plugin's entry is
// <root>/packages/mpd-comment-checker-plugin/{src,dist}/index.ts|js in both install layouts.
const repoRoot = (): string => bundleRootOf(import.meta.url)

/**
 * The `<platform>-<arch>` directory name the detector binary ships under.
 * @returns the platform key, e.g. `linux-x64`.
 */
function platformKey(): string {
  /** The arch spelling; every arch keeps node's own name, x64 included. */
  const arch = process.arch === "x64" ? "x64" : process.arch
  return process.platform + "-" + arch
}

/**
 * Resolves the detector from the installed optional dependency of the bundle package.
 * @returns the vendored binary path, or null when the package is not installed.
 */
function dependencyBinary(): string | null {
  // @code-yeongyu/comment-checker installed as a (optional) dependency of the
  // enclosing @mpd-dsh/mpd package -> sibling node_modules parent-walk finds it.
  try {
    /** A require bound to this module, so package resolution starts at the plugin. */
    const req = createRequire(import.meta.url)
    /** The dependency's package.json, the anchor of its `vendor/` directory. */
    const p = req.resolve("@code-yeongyu/comment-checker/package.json")
    return join(dirname(p), "vendor", platformKey(), "comment-checker")
  } catch { return null }
}

/**
 * Resolves the detector binary in the documented order: an explicit `config.binary`, then
 * `MPD_DSH_COMMENT_CHECKER_BIN`, then the installed optional dependency, then the repo-local
 * dev-toolchain copies. Every candidate must exist on disk.
 * @param config - the effective config, whose `binary` override wins over every other source.
 * @returns the binary path, or null when no candidate exists (the callers fail open).
 */
export function resolveBinary(config: Config): string | null {
  if (config.binary && existsSync(resolve(config.binary))) return resolve(config.binary)
  /** The operator's explicit override, second in the resolution order. */
  const env = process.env.MPD_DSH_COMMENT_CHECKER_BIN
  if (env && existsSync(env)) return env
  /** The binary of the installed optional dependency, third in the resolution order. */
  const dep = dependencyBinary()
  if (dep && existsSync(dep)) return dep
  /** Repo-local dev-toolchain copies, the last resort for a checkout without the dependency. */
  const candidates = [
    join(repoRoot(), ".toolchain", "node_modules", "@code-yeongyu", "comment-checker", "vendor", platformKey(), "comment-checker"),
    join(repoRoot(), ".toolchain", "node_modules", "@code-yeongyu", "comment-checker", "bin", "comment-checker")
  ]
  for (const c of candidates) if (existsSync(c)) return c
  return null
}

// `root` is the CALLING SESSION's workspace (adapter workspaceRoot); it is only metadata
// for the detector binary, so an omitted value degrades to the process default.
function hookInputFor(path: string, content: string, root?: string): any {
  return {
    session_id: "mpd",
    tool_name: "Write",
    transcript_path: "",
    cwd: root ?? workspaceRootOf(),
    hook_event_name: "PostToolUse",
    tool_input: { file_path: path, content },
    tool_response: { content: [{ type: "text", text: "file content" }], details: null, isError: false }
  }
}

/**
 * Runs the detector on one PostToolUse payload, which travels on the child's stdin.
 * @param binary - the resolved binary to execute.
 * @param hookInput - the payload the binary parses.
 * @param timeoutMs - wall-clock bound for the child, in milliseconds.
 * @returns whether comments were found, with the binary's message; a spawn failure throws.
 */
function runCheck(binary: string, hookInput: any, timeoutMs: number): { hasComments: boolean; message: string } {
  /** The child's exit status and captured output; `error` is set when the spawn itself failed. */
  const r = spawnSync(binary, ["check"], { input: JSON.stringify(hookInput), encoding: "utf8", timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 })
  if (r.error) throw new Error("mpd-comment-checker: spawn failed: " + String(r.error.message ?? r.error))
  /** The binary's message: stderr first, stdout appended. */
  const stderr = (r.stderr ?? "") + (r.stdout ?? "")
  if (r.status === 0) return { hasComments: false, message: "" }
  if (r.status === 2) return { hasComments: true, message: stderr }
  return { hasComments: false, message: "unexpected exit " + r.status + ": " + stderr.slice(0, 200) }
}

export { hookInputFor, runCheck }

/**
 * Registers the `mpd_comment_check` tool and, only when `autoCheck` is true, the post-execute hook.
 * @param ctx - the cordis context; every harness seam is reached through the shared adapter.
 * @param config - the row config, merged with the mpdConfig layer per key.
 */
export function apply(ctx: Ctx, config: Config = {}): void {
  // Every harness seam goes through the shared adapter (see packages/mpd-dsh-adapter-plugin).
  const dsh: any = resolveDshAdapter(ctx)
  /** The effective config: the row config with every mpd.jsonc override applied. */
  const cfg = mergedConfig(ctx, config)
  /** Per-run wall-clock bound, in milliseconds; 30000 when unset. */
  const timeoutMs = cfg.timeoutMs ?? 30000
  /** Cap on the retained detection message, in characters; 12000 when unset. */
  const maxMessageChars = cfg.maxMessageChars ?? 12000

  dsh.registerTool({
    name: "mpd_comment_check",
    description: "Run the comment/docstring detector on one or more files (content in memory or read from disk). Returns per-file detection results; exit 2 means comments/docstrings found and the binary message spells the required action. The binary (@code-yeongyu/comment-checker, MIT) must be installed in .toolchain (installer flag --with-comment-checker) or set via MPD_DSH_COMMENT_CHECKER_BIN.",
    parameters: { type: "object", properties: { files: { type: "array", items: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path"], additionalProperties: false } } }, required: ["files"] },
    output: { schema: { type: "object", properties: { binary: { type: "string" }, results: { type: "array", items: { type: "object" } } }, required: ["binary", "results"] }, render: (_a: unknown, v: any) => textBlock("comment-check binary=" + v.binary + "\n" + v.results.map((x: any) => (x.hasComments ? "DETECTED " + x.path + ": " + x.message.slice(0, maxMessageChars) : "clean " + x.path)).join("\n")) },
    execute: async (args: any, exec: any) => {
      /** The resolved detector binary; the call fails loudly when none is installed. */
      const binary = resolveBinary(cfg)
      if (!binary) throw new Error("mpd-comment-checker: binary not found — run the installer with --with-comment-checker or set MPD_DSH_COMMENT_CHECKER_BIN")
      /** The requested files, or none when the argument was malformed. */
      const files = Array.isArray(args?.files) ? args.files : []
      /** One result record per requested file, in request order. */
      const results = []
      for (const f of files) {
        /** The file's path, as the caller spelled it. */
        const path = String(f.path)
        /** The content to scan: the caller's string, else the file on disk, else empty. */
        const content = typeof f.content === "string" ? f.content : (existsSync(path) ? readFileSync(path, "utf8") : "")
        if (!content) { results.push({ path, hasComments: false, message: "no content to check" }); continue }
        try {
          /** The detector's verdict for this file. */
          const res = runCheck(binary, hookInputFor(path, content, dsh.workspaceRoot(exec)), timeoutMs)
          if (!res.hasComments && res.message) results.push({ path, hasComments: false, message: res.message })
          else results.push({ path, ...res })
        } catch (e: any) { results.push({ path, hasComments: false, message: "error: " + String(e?.message ?? e) }) }
      }
      return { binary, results }
    }
  })

  if (cfg.autoCheck === true) {
    /**
     * Append one note to a decision without replacing the text it already carries.
     *
     * @param out - the downstream decision the waterfall received.
     * @param result - the raw tool result, read only when the decision carries no content.
     * @param note - the text to append.
     * @returns a decision of the same kind whose single text block ends with `note`.
     */
    const appendNote = (out: any, result: any, note: string): any => {
      /** The decision's content in whichever shape the harness produced it. */
      const c = out.content ?? result?.content
      /** The decision's existing text, blocks flattened, so the note appends rather than replaces. */
      const text = typeof c === "string" ? c : (Array.isArray(c) ? c.map((b: any) => (b && b.type === "text" ? b.text : "")).join("\n") : "")
      return { ...out, content: [{ type: "text", text: (text ? text + "\n\n" : "") + note }] }
    }

    dsh.onPostToolExecute(async (exec: any, result: any, out: any) => {
      if (out.kind !== "accept") return out
      /** Whether the finished call is one that writes content; `str_replace_editor` is the legacy name. */
      const isEdit = exec.name === "edit" || exec.name === "str_replace_editor" || exec.name === "write"
      if (!isEdit) return out
      /** The path the edit targeted, under either argument spelling. */
      const fp = exec.arguments?.file_path ?? exec.arguments?.path
      if (typeof fp !== "string") return out
      // Session-absolute target: the plain edit/write tools report the path as the MODEL wrote it —
      // usually RELATIVE — so probing it against the dsh process cwd found nothing and skipped in
      // silence, i.e. the check silently never ran for the session's own file.
      /** The path this hook really reads: a relative `file_path` belongs to the calling session. */
      const target = isAbsolute(fp) ? resolve(fp) : resolve(dsh.workspaceRoot(exec), fp)
      /** The resolved detector binary; absent leaves the decision untouched. */
      const binary = resolveBinary(cfg)
      if (!binary) return out
      /** The edited file's content, empty when the read failed. */
      let content = ""
      /** Why the read failed, or "" when it succeeded; the failure is REPORTED below, never swallowed. */
      let readError = ""
      try { content = readFileSync(target, "utf8") } catch (e: any) { readError = String(e?.message ?? e) }
      // A DECLARED miss: the degrade stays (the decision passes through), but it now says which path
      // could not be read, so "the check found nothing" is distinguishable from "the check never ran".
      if (readError) return appendNote(out, result, "[mpd-comment-checker] auto-check skipped " + target + ": " + readError)
      if (!content) return out
      /** The detector's verdict on the edited file. */
      const res = runCheck(binary, hookInputFor(target, content, dsh.workspaceRoot(exec)), timeoutMs)
      if (!res.hasComments) return out
      /** The text appended to the tool result when comments were found. */
      const hint = "[mpd-comment-checker] comments/docstrings detected in " + target + ":\n" + res.message.slice(0, maxMessageChars)
      return appendNote(out, result, hint)
    })
  }
}
