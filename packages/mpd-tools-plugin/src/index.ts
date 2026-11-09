// B1 mpd-tools-plugin: port of upstream tool-level hooks onto DSH tool pipeline.
// 1) write-existing-file guard (deny silent clobber; identical content passes; use edit instead)
// 2) tool-output truncation (post-execute, token budget protection)
// 3) edit-error recovery guidance (post-execute)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, isAbsolute, join, resolve } from "node:path"
import { DSH_SEAM_TOOLS, dshSeamInject, resolveDshAdapter, rowLogLine } from "../../mpd-dsh-adapter-plugin/src/index"

/** The plugin id the bundle row mounts this module under. */
export const name = "mpd-tools"
/** The tool registry this row attaches its guard and both waterfalls to, named by its adapter constant. */
export const inject = dshSeamInject(DSH_SEAM_TOOLS)

/** The slice of the row context this plugin reads: the tool registry, the event bus and the config layer. */
type Ctx = { tools: any; on: (ev: string, fn: (...args: any[]) => any) => void; [k: string]: any }
/** The row's own config keys; every one is optional because the defaults below are the shipped behaviour. */
type Config = {
  writeGuard?: boolean
  truncateMaxBytes?: number
  recoveryHint?: string
  /** Row-config fallback for {@link CAPTAIN_MAX_RESULT_BYTES_KEY}; the live `mpdConfig` layer wins. */
  captain?: { maxResultBytes?: unknown }
}

/** The `mpd.jsonc` key that caps a CAPTAIN's tool result, read RAW and per call like every `captain.*` knob. */
export const CAPTAIN_MAX_RESULT_BYTES_KEY = "captain.maxResultBytes"

/** The cap a captain session gets when no layer declares one: the contract's 4096 BYTES. */
export const DEFAULT_CAPTAIN_MAX_RESULT_BYTES = 4096

/**
 * Read `captain.maxResultBytes` as an integer BYTE budget.
 *
 * `0` is a DECLARED disable and is kept; anything absent, non-numeric, fractional or negative falls back
 * to {@link DEFAULT_CAPTAIN_MAX_RESULT_BYTES}, because a typo in a config file must not silently switch a
 * guard off (fail-closed, the same direction `verify.evidenceBy` and `captain.shell` take).
 *
 * @param raw - the config value, as the layer reported it.
 * @returns the byte budget; `0` disables the captain cap.
 */
export function resolveMaxResultBytes(raw: unknown): number {
  /** The value as a number; `Number` of a non-numeric string is NaN, which fails the check below. */
  const value = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : Number.NaN
  return Number.isInteger(value) && value >= 0 ? value : DEFAULT_CAPTAIN_MAX_RESULT_BYTES
}

/**
 * Whether one agent's session is the CAPTAIN OF THE `mpd` PRESET.
 *
 * MIRRORED, not imported, from `mpd-roles-plugin`'s `sessionIsMpdCaptain`
 * (`packages/mpd-roles-plugin/src/complexity-gate.ts:1633-1638`), which composes the ONE `sessionRank`
 * classification with the preset test: header absent → NOT the captain (fail-closed);
 * `origin === "subagent"` → a child; `delegationDepth >= 1` → a child; otherwise the captain IFF
 * `agentPreset === "mpd"`. NO CROSS-PACKAGE IMPORT: `bun build` inlines each package's imports, so a
 * shared module would be copied rather than shared, and this row must classify exactly as the roles row
 * does. T-92 is why the delegation facts are read BEFORE the preset: a preset-keyed test alone once made
 * the captain branch unreachable when the whole deployment recorded one preset.
 *
 * @param agent - the live agent handle whose session header is classified.
 * @returns whether this session is the top-level session of the `mpd` preset.
 */
function isMpdCaptainSession(agent: unknown): boolean {
  /** The agent's session header, which carries the origin, the delegation depth and the preset. */
  const header = (agent as { session?: { header?: Record<string, unknown> } } | undefined)?.session?.header
  if (header === undefined || header === null) return false
  if (header.origin === "subagent") return false
  /** The delegation depth; an unreadable depth is not ">= 1" and is therefore read as the captain. */
  const depth = Number(header.delegationDepth)
  if (depth >= 1) return false
  return header.agentPreset === "mpd"
}

/**
 * The tool-name stem used in a full-text log's file name.
 *
 * The name comes from the harness, but it is sanitized anyway: a path separator or a `..` segment in it
 * must never steer the write out of `<workspace>/.mpd/logs/tool-results/`.
 *
 * @param exec - the tool execution whose registered name is being spelled.
 * @returns a filesystem-safe stem.
 */
function toolFileStem(exec: unknown): string {
  /** The registered tool name, read defensively so a bare waterfall call cannot throw. */
  const raw = String((exec as { name?: unknown } | undefined)?.name ?? "tool")
  return raw.replace(/[^A-Za-z0-9._-]+/g, "_") || "tool"
}

/**
 * Resolve a model-supplied path the way every mpd tool does: a RELATIVE path is taken against the
 * CALLING SESSION's workspace (`dsh.workspaceRoot(exec)`: session header cwd -> `DSH_WORKSPACE_ROOT`
 * -> cwd), never against the dsh process cwd; an absolute path is normalized and returned unchanged.
 *
 * @param target - the path exactly as the model spelled it.
 * @param dsh - the resolved adapter; its `workspaceRoot` is the ONE root source this row may use.
 * @param exec - the tool execution carrying the calling session, or undefined on an agentless call.
 * @returns the session-absolute target path.
 */
function sessionTarget(target: string, dsh: any, exec: any): string {
  return isAbsolute(target) ? resolve(target) : resolve(dsh.workspaceRoot(exec), target)
}

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
  /**
   * ONE `captain.*` config value, resolved PER CALL and never cached.
   *
   * Precedence: the mounted `mpdConfig` layer first (a `.mpd/mpd.jsonc` edit is therefore picked up
   * LIVE, T-18), this row's own config second, `undefined` last so the plugin's own default applies.
   *
   * @param key - the dot-path key, e.g. `captain.maxResultBytes`.
   * @returns the raw value, or `undefined` when neither layer declares it.
   */
  const configValue = (key: string): unknown => {
    /** The live config service, absent until the `mpd-config` row has applied. */
    const live = ((): { get?: (k: string) => unknown } | undefined => {
      try { return ctx.get?.("mpdConfig", false) as { get?: (k: string) => unknown } | undefined } catch { return undefined }
    })()
    /** The live layer's answer, which wins whenever the key is really declared there. */
    const fromLayer = ((): unknown => { try { return live?.get?.(key) } catch { return undefined } })()
    if (fromLayer !== undefined) return fromLayer
    if (key === CAPTAIN_MAX_RESULT_BYTES_KEY) return config.captain?.maxResultBytes
    return undefined
  }
  // THE ACTIVATION LINE (contract §3 C3): a mount lane asserts the cap in force rather than inferring the
  // default, and a degraded read (a row config that never arrived) is visible on the same line.
  rowLogLine("mpd-tools", "[mpd-tools] captainMaxResultBytes=" + resolveMaxResultBytes(configValue(CAPTAIN_MAX_RESULT_BYTES_KEY)))

  // 1) guard: no silent overwrite via write
  if (writeGuard) {
    dsh.guardTool((exec: any) => {
      if (exec.name !== "write") return undefined
      /** The requested target path, when the call carried a string one. */
      const fp = exec.arguments?.file_path
      /** The requested file body, when the call carried a string one. */
      const content = exec.arguments?.content
      if (typeof fp !== "string" || typeof content !== "string") return undefined
      // Session-absolute target: a RELATIVE file_path belongs to the calling session's workspace.
      // Probing the process cwd instead made BOTH directions silent — a clobber of <ws>/X went
      // through, and an honest CREATE of <ws>/X was denied when <cwd>/X happened to exist.
      /** The path this guard probes, resolved exactly as the write tool itself will resolve it. */
      const target = sessionTarget(fp, dsh, exec)
      if (!existsSync(target)) return undefined
      try {
        /** The current on-disk body, read only to tell an idempotent rewrite from a clobber. */
        const old = readFileSync(target, "utf8")
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

  /**
   * Today's character-budget truncation, UNCHANGED for every non-captain session and reused as the
   * captain's fallback when the full-text log cannot be written.
   *
   * @param text - the visible result text.
   * @param budgetBytes - the configured `truncateMaxBytes` character budget.
   * @param note - an optional sentence spliced into the banner (the captain's failed-log disclosure).
   * @returns the truncated text.
   */
  function legacyTruncate(text: string, budgetBytes: number, note?: string): string {
    /** The marker spliced between the kept head and tail; its own length counts against the budget. */
    const banner = "\n... [mpd-tools truncated " + text.length + " chars; keep " + budgetBytes + " budget; "
      + (note === undefined ? "" : note + "; ") + "tail follows] ...\n"
    /** The characters left for the head and tail once the banner is paid for. */
    const budget = Math.max(0, budgetBytes - banner.length) // banner counts against the budget
    // The tail's share, floored — but NEVER 0: `slice(-0)` is `slice(0)`, i.e. the WHOLE text, so a
    // budget of 1..3 (where `Math.floor(budget * 0.3)` is 0) used to return an output LARGER than
    // maxBytes and larger than the input it was meant to cap.
    /** Characters the trailing slice keeps; at least one whenever any budget is left. */
    const tailChars = Math.max(1, Math.floor(budget * 0.3))
    /** The leading slice, 70% of what is left after the banner (empty when the banner alone overruns). */
    const head = budget > 0 ? text.slice(0, Math.floor(budget * 0.7)) : ""
    /** The trailing slice, the remaining 30% (empty when the banner alone overruns). */
    const tail = budget > 0 ? text.slice(-tailChars) : ""
    return head + banner + tail
  }

  // 2) truncate oversized tool outputs (post-execute waterfall). NON-CAPTAIN sessions keep today's
  // character budget EXACTLY; a captain session gets its own BYTE cap plus a full-text log (C3).
  dsh.onPostToolExecute(async (exec: any, result: any, out: any) => {
    if (out.kind !== "accept") return out
    /** The result's visible text, taken from the replacement content or the raw result. */
    const text = blocksToText(out.content ?? result?.content)
    if (isMpdCaptainSession(exec?.agent)) {
      /** The captain's byte cap, read PER CALL so a `mpd.jsonc` edit is picked up live (T-18). */
      const cap = resolveMaxResultBytes(configValue(CAPTAIN_MAX_RESULT_BYTES_KEY))
      // `0` DISABLES the captain cap: the top-level session asked for untruncated results, and the
      // legacy budget does NOT silently take over (that would make the opt-out unobservable).
      if (cap === 0) return out
      /** The result's size in BYTES — the unit the contract specifies, not UTF-16 units. */
      const origBytes = Buffer.byteLength(text, "utf8")
      // AT THE CAP INCLUDED passes through byte-identical: no marker, no file, the same decision object.
      if (origBytes <= cap) return out
      /** The text as bytes, so the slices really are `cap` / `cap/2` BYTES and not characters. */
      const source = Buffer.from(text, "utf8")
      /** The leading slice: the cap itself. */
      const headBytes = Math.min(cap, origBytes)
      // THE TAIL NEVER OVERLAPS THE HEAD and never re-adds a byte: the retained content is strictly
      // smaller than the original, so "truncated" can never inflate the result it is meant to cap.
      /** The trailing slice: half a cap, clamped to the bytes the head did not already keep. */
      const tailBytes = Math.min(Math.floor(cap / 2), Math.max(0, origBytes - headBytes - 1))
      /** The head text (decoded, so a split multi-byte character becomes U+FFFD rather than a raw copy). */
      const head = source.subarray(0, headBytes).toString("utf8")
      /** The tail text, empty when the head already consumed the content. */
      const tail = tailBytes > 0 ? source.subarray(origBytes - tailBytes).toString("utf8") : ""
      /** The content bytes retained, reported in the marker. */
      const keptBytes = headBytes + tailBytes
      /** The full-text log path: `<workspace>/.mpd/logs/tool-results/<epochMs>-<tool>.log`. */
      const fullPath = join(dsh.workspaceRoot(exec), ".mpd", "logs", "tool-results", Date.now() + "-" + toolFileStem(exec) + ".log")
      try {
        mkdirSync(dirname(fullPath), { recursive: true })
        writeFileSync(fullPath, text, "utf8")
      } catch (error) {
        // BEST EFFORT (contract §3 C3): when the full text cannot be saved, keep TODAY'S behaviour and
        // say so in its banner — a captain never has text dropped without being told where it went.
        /** The write failure, rendered for the banner (a diagnostic never thrown out of a waterfall). */
        const reason = error instanceof Error ? error.message : String(error)
        return { ...out, content: [{ type: "text", text: legacyTruncate(text, maxBytes, "[mpd] full text log could not be written: " + reason) }] }
      }
      // The marker NAMES the recovery: the ORIGINAL byte count, the retained byte count and the absolute
      // path of the full text. Its own bytes are overhead ON TOP of the retained slices, never content.
      /** The marker spliced between head and tail, in the contract's exact spelling. */
      const marker = "\n[mpd] truncated " + origBytes + "B -> " + keptBytes + "B; full text: " + fullPath + "]"
      return { ...out, content: [{ type: "text", text: head + marker + tail }] }
    }
    // NON-CAPTAIN: today's character budget, untouched (the arms in `tools.test.ts` pin its banner).
    if (text.length <= maxBytes) return out
    return { ...out, content: [{ type: "text", text: legacyTruncate(text, maxBytes) }] }
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
