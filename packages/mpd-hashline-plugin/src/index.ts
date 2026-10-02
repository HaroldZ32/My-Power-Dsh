// C3 mpd-hashline-plugin: hash-anchored edit discipline on the DSH tool seam.
// Vendored core: the upstream project packages/hashline-core (base 8c57e46;
// SUL-1.0, inherited from upstream; see LICENSE.md). Adaptation: diff-utils.ts bundles a
// minimal unified-diff generator instead of the npm "diff" dependency.
// Model: files stay PLAIN on disk; the hashline layer is a ref view + anchored
// edit discipline. Tools:
//   1) mpd_hashline_read   - show the file as LINE#HASH|content (anchors for edits);
//   2) mpd_hashline_edit   - apply anchored replace/append/prepend edits (validated
//      against current hashes), write back plain content, report a unified diff;
//   3) mpd_hashline_format - register the file for the discipline (idempotent, no disk change);
//   4) mpd_hashline_restore- unregister the discipline;
// plus a post-execute guard warning when plain edit/write touched a registered file.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, isAbsolute, join, resolve } from "node:path"
import {
  toHashlineContent,
  applyHashlineEditsWithReport,
  generateUnifiedDiff,
  computeLineHash,
  normalizeHashlineEdits,
  type HashlineEdit,
} from "./vendor/index.ts"
import { DSH_SEAM_TOOLS, dshSeamInject, type DshAdapter, textBlock, resolveDshAdapter } from "../../mpd-dsh-adapter-plugin/src/index"

/** Cordis plugin name of this row; the bundle patch mounts it under the id `mpd-hashline`. */
export const name = "mpd-hashline"
/** Cordis service ids this row waits for: the tool registrar is its only seam, named by its adapter constant. */
export const inject = dshSeamInject(DSH_SEAM_TOOLS)

/** The slice of the cordis context this row uses: the tool registrar, the post-execute seam and an optional service lookup. */
type Ctx = { tools: any; on: (ev: string, fn: (...a: any[]) => any) => void; get?: (k: string) => any }
/** Row config, overridable per key by the `mpdConfig` runtime layer (mpd.jsonc wins). */
type Config = { guardEditTools?: boolean; maxDiffChars?: number; registryFile?: string }
/** The post-execute exec fields the guard reads: the plain tool's name and its arguments. */
type ToolExec = { name: string; arguments?: any }

/** Merge the row config with the mpdConfig runtime layer (mpd.jsonc wins per key). */
function mergedConfig(ctx: Ctx, config: Config): Config {
  // The mpdConfig service, present only when mpd-config-plugin is mounted in the same composition.
  const svc = ctx.get?.("mpdConfig") as { get: (k?: string) => any } | undefined
  if (!svc?.get) return config
  // Reads one `mpd.jsonc` leaf by its dotted key; the value stays as untyped as the service declares
  // it, so the return type is spelled from that service instead of restating a shape.
  const v = (k: string): ReturnType<NonNullable<typeof svc>["get"]> => svc.get(k)
  return {
    ...config,
    guardEditTools: typeof v("hashline.guardEditTools") === "boolean" ? v("hashline.guardEditTools") : config.guardEditTools,
    maxDiffChars: typeof v("hashline.maxDiffChars") === "number" ? v("hashline.maxDiffChars") : config.maxDiffChars,
    registryFile: typeof v("hashline.registryFile") === "string" ? v("hashline.registryFile") : config.registryFile,
  }
}


// Explicit override (config.registryFile / mpd.jsonc hashline.registryFile) wins; otherwise
// the CALLING SESSION's workspace (adapter workspaceRoot) — never the dsh process cwd.
function registryPath(config: Config, dsh: DshAdapter, exec?: any): string {
  return config.registryFile ? resolve(config.registryFile) : join(dsh.workspaceRoot(exec), ".mpd", "hashline-files.json")
}

// Relative tool paths resolve against the session workspace, exactly like the harness
// bash tool's workdir resolution; absolute paths are returned unchanged.
function sessionPath(target: string, dsh: DshAdapter, exec?: any): string {
  return isAbsolute(target) ? resolve(target) : resolve(dsh.workspaceRoot(exec), target)
}

/** Registered file paths exactly as stored; a missing or malformed registry reads as empty. */
function readRegistry(p: string): string[] {
  try {
    // Parsed registry content, trusted only as a list: anything else reads as nothing registered.
    const v = JSON.parse(readFileSync(p, "utf8")); return Array.isArray(v) ? v : []
  } catch { return [] }
}

/** Persist the registry de-duplicated and pretty-printed, creating the parent directory first. */
function writeRegistry(p: string, files: string[]): void {
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, JSON.stringify([...new Set(files)], null, 2))
}

/** Whether `fp` is under the discipline, resolved with the same base the tools use for it. */
function registered(config: Config, dsh: DshAdapter, fp: string, exec?: any): boolean {
  // Paths as stored: absolute for anything this row registered through a calling session.
  const list = readRegistry(registryPath(config, dsh, exec))
  // Same base as the registry and as every tool body: a RELATIVE file_path (what the plain
  // edit/write tools report) must resolve against the session workspace, or the membership test
  // silently misses and the guard no-ops. Absolute paths are unchanged.
  const target = sessionPath(fp, dsh, exec)
  return list.some((x) => sessionPath(x, dsh, exec) === target)
}

/** Apply validated edits, write the plain result back, and report counts plus a capped diff. */
function editFile(fp: string, edits: HashlineEdit[], maxDiffChars: number): any {
  // Content before the edit: the diff's left side and the no-change test.
  const raw = readFileSync(fp, "utf8")
  // Vendored applier's outcome: plain content plus the noop and deduplicated edit counts.
  const report = applyHashlineEditsWithReport(raw, edits)
  writeFileSync(fp, report.content)
  // Empty when nothing changed, otherwise the unified diff truncated to the configured cap.
  const diff = report.content === raw ? "" : generateUnifiedDiff(raw, report.content, fp).slice(0, maxDiffChars)
  // Trailing-newline-insensitive body, so a file ending in a newline reports its real line count.
  const contentForCount = report.content.endsWith("\n") ? report.content.slice(0, -1) : report.content
  return {
    path: fp,
    lines: contentForCount === "" ? 0 : contentForCount.split("\n").length,
    noopEdits: report.noopEdits,
    deduplicatedEdits: report.deduplicatedEdits,
    diff
  }
}

/**
 * Registers the four hashline tools and, unless `guardEditTools` is false, the post-execute guard.
 * @param ctx - the cordis context; every harness seam is reached through the shared adapter.
 * @param config - the row config, merged with the mpdConfig layer per key.
 */
export function apply(ctx: Ctx, config: Config = {}): void {
  // Every harness seam goes through the shared adapter (see packages/mpd-dsh-adapter-plugin).
  const dsh: any = resolveDshAdapter(ctx)
  // Row config with the runtime layer merged over it: mpd.jsonc wins per key.
  const cfg = mergedConfig(ctx, config)
  // Diff cap every edit this row applies; both the row config and mpd.jsonc may override it.
  const maxDiffChars = cfg.maxDiffChars ?? 4000

  dsh.registerTool({
    name: "mpd_hashline_read",
    description: "Show a file as hashline view: one 'LINE#HASH|content' line per source line, where LINE#HASH is the anchor to use with mpd_hashline_edit. Read-only; the file on disk stays plain.",
    parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
    output: { schema: { type: "object", properties: { path: { type: "string" }, lines: { type: "integer" }, view: { type: "string" } }, required: ["path", "lines", "view"] }, render: (_a: unknown, v: any) => textBlock(v.view) },
    execute: async (args: any, exec: any) => {
      // Absolute path of the file to view, resolved against the calling session's workspace.
      const fp = sessionPath(String(args?.path), dsh, exec)
      if (!existsSync(fp)) throw new Error("mpd-hashline: file not found: " + fp)
      // Plain file content; the anchor view is derived from it and never written back.
      const raw = readFileSync(fp, "utf8")
      // The LINE#HASH|content view whose anchors the caller passes back to mpd_hashline_edit.
      const out = toHashlineContent(raw)
      return { path: fp, lines: out === "" ? 0 : out.split("\n").length, view: out }
    }
  })

  dsh.registerTool({
    name: "mpd_hashline_edit",
    description: "Apply hash-anchored edits to a file: edits are {op: replace|append|prepend, pos: 'LINE#HASH' anchor, end?: 'LINE#HASH' (replace range), lines: 'new text' | ['line1', ...]}. Obtain anchors from mpd_hashline_read. Anchors are validated against current hashes (HashlineMismatchError on drift, with remapped refs); matched edits are applied to plain content and the file is written back plain. Returns noop/deduped counts and a unified diff.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        edits: { type: "array", items: { type: "object", properties: { op: { type: "string", enum: ["replace", "append", "prepend"] }, pos: { type: "string" }, end: { type: "string" }, lines: { oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }] } }, required: ["op"], additionalProperties: false } }
      },
      required: ["path", "edits"],
      additionalProperties: false
    },
    output: {
      schema: { type: "object", properties: { path: { type: "string" }, lines: { type: "integer" }, noopEdits: { type: "integer" }, deduplicatedEdits: { type: "integer" }, diff: { type: "string" } }, required: ["path", "lines"], additionalProperties: false },
      render: (_a: unknown, v: any) => textBlock("hashline edited: " + v.path + " (" + v.lines + " lines, noop=" + v.noopEdits + ", deduped=" + v.deduplicatedEdits + ")\n" + (v.diff ?? ""))
    },
    execute: async (args: any, exec: any) => {
      // Absolute path of the file to edit, resolved against the calling session's workspace.
      const fp = sessionPath(String(args?.path), dsh, exec)
      if (!existsSync(fp)) throw new Error("mpd-hashline: file not found: " + fp)
      // Raw editor input, kept untyped on purpose: normalizeHashlineEdits rejects every malformed shape.
      const rawEdits = Array.isArray(args?.edits) ? args.edits : []
      if (rawEdits.length === 0) throw new Error("mpd-hashline: at least one edit required")
      // Normalize BEFORE applying: fills missing anchors (replace{end}-only becomes
      // single-line replace), rejects unknown ops, and gives a clean error instead
      // of an undefined.trim() crash inside applyReplaceLines.
      const edits = normalizeHashlineEdits(rawEdits)
      return editFile(fp, edits, maxDiffChars)
    }
  })

  dsh.registerTool({
    name: "mpd_hashline_format",
    description: "Register a file for the hashline discipline (idempotent; the file on disk is NOT changed). After registration the post-edit guard warns when plain edit/write tools change the file. The returned view is the hashline anchor view.",
    parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
    output: { schema: { type: "object", properties: { path: { type: "string" }, lines: { type: "integer" }, view: { type: "string" } }, required: ["path", "lines", "view"] }, render: (_a: unknown, v: any) => textBlock("hashline disciplined: " + v.path + "\n" + v.view) },
    execute: async (args: any, exec: any) => {
      // Absolute path of the file to register, resolved against the calling session's workspace.
      const fp = sessionPath(String(args?.path), dsh, exec)
      if (!existsSync(fp)) throw new Error("mpd-hashline: file not found: " + fp)
      // Registry location for THIS session: an explicit registryFile override wins over the workspace root.
      const rp = registryPath(cfg, dsh, exec)
      writeRegistry(rp, [...readRegistry(rp), fp])
      // Plain content of the registered file, read only to build the returned anchor view.
      const raw = readFileSync(fp, "utf8")
      // Anchor view returned to the caller; registration itself never changes the file.
      const out = toHashlineContent(raw)
      return { path: fp, lines: out === "" ? 0 : out.split("\n").length, view: out }
    }
  })

  dsh.registerTool({
    name: "mpd_hashline_restore",
    description: "Unregister a file from the hashline discipline (the plain file content is untouched). After this, plain edits no longer trigger the hashline guard.",
    parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
    output: { schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] }, render: (_a: unknown, v: any) => textBlock("hashline discipline removed: " + v.path) },
    execute: async (args: any, exec: any) => {
      // Absolute path of the file to unregister, resolved against the calling session's workspace.
      const fp = sessionPath(String(args?.path), dsh, exec)
      // Registry location holding the entry to drop, resolved exactly like registration.
      const rp = registryPath(cfg, dsh, exec)
      writeRegistry(rp, readRegistry(rp).filter((x) => resolve(x) !== fp))
      return { path: fp }
    }
  })

  // Guard: plain edit/write on a discipline-registered file silently invalidates anchors.
  if (cfg.guardEditTools !== false) {
    dsh.onPostToolExecute(async (exec: ToolExec, result: any, out: any) => {
      if (out.kind !== "accept") return out
      // Only the three plain-mutation tool names can invalidate anchors; every other call passes through.
      const isEdit = exec.name === "edit" || exec.name === "str_replace_editor" || exec.name === "write"
      if (!isEdit) return out
      // Path as the plain tool reported it; `registered` resolves a relative one against the session.
      const fp = exec.arguments?.file_path ?? exec.arguments?.path
      if (typeof fp !== "string" || !registered(cfg, dsh, fp, exec)) return out
      // Warning appended to the tool result, naming the re-read / switch / restore remedies.
      const hint = "[mpd-hashline guard] " + fp + " is hashline-disciplined and was changed with a plain edit tool, so the LINE#HASH anchors you saw are now stale. Re-read with mpd_hashline_read and continue with mpd_hashline_edit, or run mpd_hashline_restore to drop the discipline."
      // Downstream result content, either a string or the harness's array of text blocks.
      const content = out.content ?? result?.content
      // Flattened text of the downstream result; a block that is not text contributes an empty string.
      const text = typeof content === "string" ? content : (Array.isArray(content) ? content.map((b: any) => (b && b.type === "text" ? b.text : "")).join("\n") : "")
      return { ...out, content: [{ type: "text", text: (text ? text + "\n\n" : "") + hint }] }
    })
  }
}
