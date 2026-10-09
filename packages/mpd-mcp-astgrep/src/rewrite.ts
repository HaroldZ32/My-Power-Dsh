// rewrite.ts — the `rewrite` tool: preview an AST-aware rewrite, and optionally apply it.
//
// Two passes, always: the first runs `sg run --json=stream` and never mutates, the second runs
// `sg run --update-all` with NO json flag (`--update-all` combined with `--json` only previews). The
// split exists because the mutation pass returns no machine-readable result, so the counts a caller
// reads are the preview's — which the payload says out loud. A truncated preview is never applied,
// and a mutation pass that suddenly finds nothing is reported as REWRITE_STALE_PREVIEW rather than
// as success.
import { normalizeRecords, type NormalizedMatch } from "./normalize.ts"
import { validateRewriteHints } from "./hints.ts"
import {
  DEFAULT_MATCHES,
  DEFAULT_TIMEOUT_MS,
  MAX_MATCHES,
  MAX_TIMEOUT_MS,
  SgRunnerError,
  spawnSgRunner,
} from "./runner.ts"

/** Largest `pattern` this server accepts, in UTF-8 bytes. */
const MAX_PATTERN_BYTES = 16 * 1024
/** Largest `rewrite` template this server accepts, in UTF-8 bytes. */
const MAX_REWRITE_BYTES = 64 * 1024
/** Largest number of `paths` entries. */
const MAX_PATHS = 64
/** Largest `paths` entry, in code points. */
const MAX_PATH_CHARS = 4096
/** Largest number of `globs` entries. */
const MAX_GLOBS = 32
/** Largest `globs` entry, in code points. */
const MAX_GLOB_CHARS = 1024
/** Largest `selector`, in code points. */
const MAX_SELECTOR_CHARS = 128
/** Largest `workdir`, in code points. */
const MAX_WORKDIR_CHARS = 4096
/** Smallest whole-call deadline a caller may ask for, in milliseconds. */
const MIN_TIMEOUT_MS = 1_000

/** The raw MCP tool name this module implements, as the harness exposes it. */
export const REWRITE_TOOL_NAME = "rewrite" as const

/** Model-facing description of this tool, as the descriptor publishes it. */
export const REWRITE_TOOL_DESCRIPTION =
  "Preview an AST-aware rewrite, or apply it. The pattern obeys the same metavariable rules as `search`; the replacement may reference only metavariables the pattern captured, and an EMPTY replacement deletes the match. Nothing is written unless `apply` is true, and a truncated preview is refused rather than applied — narrow `paths` or raise `maxMatches`, then retry. Applying is two passes (a JSON preview, then a separate `--update-all` run), so the reported counts describe the preview, and a second apply is not guaranteed to be a no-op."

/** Warning that accompanies every applied rewrite, stating what its counts really measure. */
const APPLY_PREVIEW_WARNING =
  "Mutation counts are based on the preview pass; sg update-all does not return equivalent JSON."

/** The 25 languages ast-grep parses, as the descriptor's enum publishes them. */
const LANGUAGES = [
  "bash", "c", "cpp", "csharp", "css", "elixir", "go", "haskell", "html",
  "java", "javascript", "json", "kotlin", "lua", "nix", "php", "python",
  "ruby", "rust", "scala", "solidity", "swift", "typescript", "tsx", "yaml",
] as const

/** The match strictness levels ast-grep accepts; `template` is deliberately not one of them. */
const STRICTNESS = ["cst", "smart", "ast", "relaxed", "signature"] as const

/** A validated `rewrite` call. */
export interface RewriteInput {
  /** The structural pattern to match. */
  readonly pattern: string
  /** The replacement template; an empty string deletes the match. */
  readonly rewrite: string
  /** The language the pattern must parse in. */
  readonly language: (typeof LANGUAGES)[number]
  /** Files or directories to search; required, with no implicit ".". */
  readonly paths: readonly string[]
  /** Working directory for the run; defaults to this server's cwd. */
  readonly workdir?: string
  /** Include/exclude globs passed through to ast-grep. */
  readonly globs?: readonly string[]
  /** Sub-node selector used when the pattern is not a whole node. */
  readonly selector?: string
  /** Match strictness; defaults to `smart`. */
  readonly strictness: (typeof STRICTNESS)[number]
  /** Whether to write the rewrite to disk. */
  readonly apply: boolean
  /** Match cap for this call; defaults to 50. */
  readonly maxMatches: number
  /** Whole-call deadline in milliseconds; defaults to 300000. */
  readonly timeoutMs: number
  /** Search hidden files too (`--no-ignore hidden`). */
  readonly includeHidden?: boolean
  /** Follow symlinks (`--follow`). */
  readonly followSymlinks?: boolean
  /** Bypass non-fatal pattern-hint rejections. */
  readonly force?: boolean
}

/**
 * Count a string's Unicode code points, which is the unit the per-string `maxLength` values use.
 * @param value - the string to measure
 * @returns its length in code points
 */
function codePointLength(value: string): number {
  return [...value].length
}

/** Every argument name this tool accepts, so an unknown one is a caller mistake. */
const KNOWN_KEYS = new Set([
  "pattern", "rewrite", "language", "paths", "workdir", "globs", "selector",
  "strictness", "apply", "maxMatches", "timeoutMs", "includeHidden", "followSymlinks", "force",
])

/**
 * Validate a raw `rewrite` argument object.
 * @param input - the raw `arguments` object of the MCP call
 * @returns the validated input
 * @throws {Error} when any argument is missing or out of contract
 */
function parseRewriteInput(input: unknown): RewriteInput {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("Input must be an object")
  }
  /** The raw arguments as a field table. */
  const obj = input as Record<string, unknown>

  for (const key of Object.keys(obj)) {
    if (!KNOWN_KEYS.has(key)) throw new Error(`Unknown property: ${key}`)
  }

  if (typeof obj.pattern !== "string" || obj.pattern.length === 0) throw new Error("pattern must be a non-empty string")
  if (Buffer.byteLength(obj.pattern, "utf8") > MAX_PATTERN_BYTES) throw new Error("pattern must be at most 16KiB")

  if (typeof obj.rewrite !== "string") throw new Error("rewrite must be a string")
  if (Buffer.byteLength(obj.rewrite, "utf8") > MAX_REWRITE_BYTES) throw new Error("rewrite must be at most 64KiB")

  if (typeof obj.language !== "string" || !(LANGUAGES as readonly string[]).includes(obj.language)) {
    throw new Error(`language must be one of: ${LANGUAGES.join(", ")}`)
  }

  if (!Array.isArray(obj.paths)) throw new Error("paths must be an array")
  if (obj.paths.length < 1 || obj.paths.length > MAX_PATHS) throw new Error(`paths must have 1-${MAX_PATHS} entries`)
  for (const path of obj.paths) {
    if (typeof path !== "string" || path.length === 0) throw new Error("each path must be a non-empty string")
    if (codePointLength(path) > MAX_PATH_CHARS) {
      throw new Error(`each path must be at most ${MAX_PATH_CHARS} characters`)
    }
  }

  if (obj.workdir !== undefined) {
    if (typeof obj.workdir !== "string" || obj.workdir.length === 0) {
      throw new Error("workdir must be a non-empty string")
    }
    if (codePointLength(obj.workdir) > MAX_WORKDIR_CHARS) {
      throw new Error(`workdir must be at most ${MAX_WORKDIR_CHARS} characters`)
    }
  }

  if (obj.globs !== undefined) {
    if (!Array.isArray(obj.globs)) throw new Error("globs must be an array")
    if (obj.globs.length > MAX_GLOBS) throw new Error(`globs must have at most ${MAX_GLOBS} entries`)
    for (const glob of obj.globs) {
      if (typeof glob !== "string" || glob.length === 0) throw new Error("each glob must be a non-empty string")
      if (codePointLength(glob) > MAX_GLOB_CHARS) {
        throw new Error(`each glob must be at most ${MAX_GLOB_CHARS} characters`)
      }
    }
  }

  if (obj.selector !== undefined) {
    if (typeof obj.selector !== "string" || obj.selector.length === 0) {
      throw new Error("selector must be a non-empty string")
    }
    if (codePointLength(obj.selector) > MAX_SELECTOR_CHARS) {
      throw new Error(`selector must be at most ${MAX_SELECTOR_CHARS} characters`)
    }
  }

  /** The validated strictness, defaulted to `smart`. */
  let strictness: (typeof STRICTNESS)[number] = "smart"
  if (obj.strictness !== undefined) {
    if (typeof obj.strictness !== "string" || !(STRICTNESS as readonly string[]).includes(obj.strictness)) {
      throw new Error(`strictness must be one of: ${STRICTNESS.join(", ")}`)
    }
    strictness = obj.strictness as (typeof STRICTNESS)[number]
  }

  if (obj.apply !== undefined && typeof obj.apply !== "boolean") throw new Error("apply must be a boolean")

  /** The validated match cap, defaulted to 50. */
  let maxMatches = DEFAULT_MATCHES
  if (obj.maxMatches !== undefined) {
    if (
      typeof obj.maxMatches !== "number" ||
      !Number.isInteger(obj.maxMatches) ||
      obj.maxMatches < 1 ||
      obj.maxMatches > MAX_MATCHES
    ) {
      throw new Error(`maxMatches must be an integer between 1 and ${MAX_MATCHES}`)
    }
    maxMatches = obj.maxMatches
  }

  /** The validated whole-call deadline, defaulted to 300000 ms. */
  let timeoutMs = DEFAULT_TIMEOUT_MS
  if (obj.timeoutMs !== undefined) {
    if (
      typeof obj.timeoutMs !== "number" ||
      !Number.isInteger(obj.timeoutMs) ||
      obj.timeoutMs < MIN_TIMEOUT_MS ||
      obj.timeoutMs > MAX_TIMEOUT_MS
    ) {
      throw new Error(`timeoutMs must be an integer between ${MIN_TIMEOUT_MS} and ${MAX_TIMEOUT_MS}`)
    }
    timeoutMs = obj.timeoutMs
  }

  for (const flag of ["includeHidden", "followSymlinks", "force"] as const) {
    if (obj[flag] !== undefined && typeof obj[flag] !== "boolean") throw new Error(`${flag} must be a boolean`)
  }

  return {
    pattern: obj.pattern,
    rewrite: obj.rewrite,
    language: obj.language as RewriteInput["language"],
    paths: obj.paths as readonly string[],
    workdir: obj.workdir as string | undefined,
    globs: obj.globs as readonly string[] | undefined,
    selector: obj.selector as string | undefined,
    strictness,
    apply: (obj.apply as boolean | undefined) ?? false,
    maxMatches,
    timeoutMs,
    includeHidden: obj.includeHidden as boolean | undefined,
    followSymlinks: obj.followSymlinks as boolean | undefined,
    force: obj.force as boolean | undefined,
  }
}

/**
 * The scope flags both passes share.
 * @param input - the validated `rewrite` arguments
 * @returns the argv fragment naming strictness, selector, globs and symlink handling
 */
function scopeArgs(input: RewriteInput): string[] {
  /** The scope argv under construction. */
  const args: string[] = ["--strictness", input.strictness]
  if (input.selector) args.push("--selector", input.selector)
  if (input.globs) for (const glob of input.globs) args.push("--globs", glob)
  if (input.includeHidden) args.push("--no-ignore", "hidden")
  if (input.followSymlinks) args.push("--follow")
  return args
}

/**
 * The pattern/replacement/lang fragment both passes share.
 * @param input - the validated `rewrite` arguments
 * @returns the argv fragment naming the query
 */
function baseArgs(input: RewriteInput): string[] {
  return ["run", "-p", input.pattern, "-r", input.rewrite, "--lang", input.language]
}

/**
 * The argv of the non-mutating preview pass.
 * @param input - the validated `rewrite` arguments
 * @returns the argv to hand to the ast-grep executable
 */
export function buildRewriteArgs(input: RewriteInput): string[] {
  return [...baseArgs(input), "--json=stream", ...scopeArgs(input), ...input.paths]
}

/**
 * The argv of the mutating pass — no JSON flag, because `--update-all` with JSON only previews.
 * @param input - the validated `rewrite` arguments
 * @returns the argv to hand to the ast-grep executable
 */
export function buildRewriteApplyArgs(input: RewriteInput): string[] {
  return [...baseArgs(input), "--update-all", ...scopeArgs(input), ...input.paths]
}

/** Error codes the `rewrite` payload can carry. */
export type RewriteErrorCode =
  | "ABORTED"
  | "ENCODING_ERROR"
  | "INVALID_ARGUMENT"
  | "OUTPUT_PARSE_FAILED"
  | "OUTPUT_TOO_LARGE"
  | "PATTERN_HINT_REJECTED"
  | "PATTERN_PARSE_FAILED"
  | "PREVIEW_TRUNCATED"
  | "REWRITE_METAVARIABLE_KIND_MISMATCH"
  | "REWRITE_STALE_PREVIEW"
  | "REWRITE_UNBOUND_METAVARIABLE"
  | "SG_FAILED"
  | "TIMEOUT"
  | "UNSUPPORTED_LANGUAGE"

/** Which pass produced a `rewrite` failure. */
export type RewritePhase = "preflight" | "preview" | "apply"

/** One previewed match, with the text the rewrite would put in its place. */
export interface RewriteMatch extends NormalizedMatch {
  /** The replacement text `sg` reported for this match, or "" when it reported none. */
  readonly replacement: string
}

/** A successful `rewrite` payload. */
export interface RewriteSuccessPayload {
  /** Payload schema version, bumped only by a breaking shape change. */
  readonly schemaVersion: 1
  /** Always true on this branch. */
  readonly ok: true
  /** Which tool produced the payload. */
  readonly kind: "rewrite"
  /** The working directory the run used. */
  readonly workdir: string
  /** Whether the mutation pass really ran. */
  readonly applied: boolean
  /** The previewed matches, ordered by path then start byte. */
  readonly matches: readonly RewriteMatch[]
  /** What the preview planned, which is also what an apply did. */
  readonly counts: { readonly plannedMatches: number; readonly plannedFiles: number }
  /** How the preview was capped, if it was. */
  readonly truncation: {
    /** Whether the preview's record set is incomplete. */
    readonly truncated: boolean
    /** Why it is incomplete. */
    readonly reason: "match_limit" | "output_cap" | "sg_output_truncated" | null
    /** The match cap this call ran under. */
    readonly maxMatches: number
    /** The aggregate payload budget this call ran under. */
    readonly maxPayloadBytes: number
    /** Records kept when the stream itself was malformed mid-way. */
    readonly salvagedRecords: number
  }
  /** What the apply pass did, and the two things that are deliberately NOT claimed. */
  readonly application: {
    /** Whether the caller asked for a mutation. */
    readonly requested: boolean
    /** Whether a mutation pass actually ran. */
    readonly performed: boolean
    /** Always true: the counts above describe the preview, not the mutation pass. */
    readonly countsArePreviewBased: true
    /** Always false: a second apply is not guaranteed to be a no-op. */
    readonly idempotencyChecked: false
    /** Exit code of the mutation pass, or null when it never ran. */
    readonly secondPassExitCode: number | null
  }
  /** Non-blocking findings, plus the apply warning. */
  readonly warnings: readonly string[]
  /** Wall-clock duration of the call in milliseconds. */
  readonly durationMs: number
}

/** A failed `rewrite` payload. */
export interface RewriteErrorPayload {
  /** Payload schema version, bumped only by a breaking shape change. */
  readonly schemaVersion: 1
  /** Always false on this branch. */
  readonly ok: false
  /** Which tool produced the payload. */
  readonly kind: "rewrite"
  /** The failure, with the pass that produced it. */
  readonly error: {
    /** Taxonomy code of the failure. */
    readonly code: RewriteErrorCode
    /** One-line cause. */
    readonly message: string
    /** Whether retrying the same call could succeed. */
    readonly retryable: boolean
    /** Which pass produced the failure. */
    readonly phase: RewritePhase
    /** The language the caller named. */
    readonly language: string
    /** Diagnostics: captured stderr and/or the pre-flight findings. */
    readonly details: { readonly stderr?: string; readonly hints?: readonly string[] }
  }
  /** Wall-clock duration of the call in milliseconds. */
  readonly durationMs: number
}

/** Either branch of the `rewrite` result. */
export type RewritePayload = RewriteSuccessPayload | RewriteErrorPayload

/** Test seam of the two-pass flow: lets a caller stage a filesystem change between the passes. */
export interface RewriteHooks {
  /** Invoked after a non-truncated, non-empty preview and before the mutation pass starts. */
  readonly onPreviewComplete?: () => void | Promise<void>
}

/** The codes a caller may usefully retry unchanged. */
const RETRYABLE: ReadonlySet<RewriteErrorCode> = new Set<RewriteErrorCode>([
  "ABORTED",
  "OUTPUT_PARSE_FAILED",
  "REWRITE_STALE_PREVIEW",
  "TIMEOUT",
])

/** stderr marker ast-grep prints when a pattern only parsed into an ERROR node. */
const ERROR_NODE_RE = /Pattern contains an ERROR node/i

/**
 * Build one `rewrite` error payload.
 * @param code - taxonomy code of the failure
 * @param message - one-line cause
 * @param phase - the pass that produced the failure
 * @param language - the language the caller named
 * @param durationMs - wall-clock duration in milliseconds
 * @param details - captured stderr and/or the pre-flight findings
 * @returns the error payload
 */
function failure(
  code: RewriteErrorCode,
  message: string,
  phase: RewritePhase,
  language: string,
  durationMs: number,
  details: { stderr?: string; hints?: readonly string[] } = {},
): RewriteErrorPayload {
  return {
    schemaVersion: 1,
    ok: false,
    kind: "rewrite",
    error: { code, message, retryable: RETRYABLE.has(code), phase, language, details },
    durationMs,
  }
}

/**
 * Normalize preview records and pull each match's replacement text to the top level.
 * @param records - the raw preview records
 * @param workdir - the run's working directory
 * @returns the matches, each with its replacement
 */
function toRewriteMatches(records: readonly Record<string, unknown>[], workdir: string): RewriteMatch[] {
  return normalizeRecords(records, workdir).map((match) => ({
    ...match,
    replacement: typeof match.replacement === "string" ? match.replacement : "",
  }))
}

/**
 * Map a pre-flight finding code onto this tool's error taxonomy.
 * @param code - the code the linter decided on, or null
 * @returns the payload code
 */
function preflightCode(code: string | null): RewriteErrorCode {
  switch (code) {
    case "REWRITE_UNBOUND_METAVARIABLE":
      return "REWRITE_UNBOUND_METAVARIABLE"
    case "REWRITE_CARDINALITY_MISMATCH":
      return "REWRITE_METAVARIABLE_KIND_MISMATCH"
    case "LANGUAGE_UNSUPPORTED":
      return "UNSUPPORTED_LANGUAGE"
    case "PATTERN_HINT_REJECTED":
      return "PATTERN_HINT_REJECTED"
    default:
      return "INVALID_ARGUMENT"
  }
}

/**
 * Run one `rewrite` call: validate, preview, and — only when every gate holds — apply.
 * @param rawInput - the raw `arguments` object of the MCP call
 * @param sgPath - absolute path of the ast-grep executable
 * @param signal - abort signal of the in-flight request
 * @param hooks - optional test seam invoked between the preview and the mutation pass
 * @returns the success or error payload of this call
 */
export async function executeRewrite(
  rawInput: RewriteInput,
  sgPath: string,
  signal?: AbortSignal,
  hooks?: RewriteHooks,
): Promise<RewritePayload> {
  /** Wall-clock start of this call. */
  const startedAt = performance.now()
  /** Milliseconds elapsed since this call started. */
  const elapsed = (): number => Math.max(0, Math.round(performance.now() - startedAt))

  /** The validated arguments. */
  let input: RewriteInput
  try {
    input = parseRewriteInput(rawInput)
  } catch (error) {
    return failure(
      "INVALID_ARGUMENT",
      error instanceof Error ? error.message : String(error),
      "preflight",
      typeof (rawInput as { language?: unknown })?.language === "string"
        ? (rawInput as { language: string }).language
        : "unknown",
      elapsed(),
    )
  }

  /** The directory the run executes in. */
  const workdir = input.workdir ?? process.env.MPD_AST_GREP_PROJECT_CWD ?? process.cwd()

  /** The pre-flight verdict, which `force` can never bypass for the two rewrite-only checks. */
  const validation = validateRewriteHints(input.pattern, input.rewrite, input.language, {
    force: input.force,
    paths: input.paths,
    limit: input.maxMatches,
  })
  if (validation.rejected) {
    /** The finding that blocked the call, for the payload's message. */
    const blocking = validation.hints.find(
      (hint) => hint.severity === "always-reject" || hint.severity === "reject",
    )
    return failure(
      preflightCode(validation.code),
      blocking?.message ?? "Rewrite preflight rejected the request.",
      "preflight",
      input.language,
      elapsed(),
      { hints: validation.hints.map((hint) => hint.message) },
    )
  }
  /** Non-blocking findings of the pre-flight pass. */
  const warnings = validation.hints.map((hint) => hint.message)

  /** The preview run's result, or the failure the catch below turns into a payload. */
  let preview: Awaited<ReturnType<typeof spawnSgRunner>>
  try {
    preview = await spawnSgRunner({
      sgPath,
      args: buildRewriteArgs(input),
      workdir,
      maxMatches: input.maxMatches,
      timeoutMs: input.timeoutMs,
      signal,
    })
  } catch (error) {
    if (error instanceof SgRunnerError) {
      return failure(error.code as RewriteErrorCode, error.message, "preview", input.language, error.durationMs, {
        stderr: error.stderr,
      })
    }
    return failure(
      "SG_FAILED",
      error instanceof Error ? error.message : String(error),
      "preview",
      input.language,
      elapsed(),
    )
  }

  if (ERROR_NODE_RE.test(preview.stderr)) {
    return failure(
      "PATTERN_PARSE_FAILED",
      "ast-grep reported an ERROR node while parsing the pattern; the query failed rather than finding nothing.",
      "preview",
      input.language,
      elapsed(),
      { stderr: preview.stderr },
    )
  }

  /** The previewed matches. */
  const matches = toRewriteMatches(preview.records, workdir)
  /** How the preview was capped. */
  const truncation = {
    truncated: preview.truncated,
    reason: preview.reason,
    maxMatches: input.maxMatches,
    maxPayloadBytes: preview.maxPayloadBytes,
    salvagedRecords: preview.salvagedRecords,
  } as const
  /** What the preview planned — the only counts this tool can honestly report. */
  const counts = {
    plannedMatches: matches.length,
    plannedFiles: new Set(matches.map((match) => match.path)).size,
  } as const

  /**
   * Build a success payload for a call that did not mutate anything.
   * @param secondPassExitCode - exit code of a mutation pass that did not run, or null
   * @param extraWarnings - further warnings to append
   * @returns the payload
   */
  const dryRun = (secondPassExitCode: number | null, extraWarnings: readonly string[] = []): RewriteSuccessPayload => ({
    schemaVersion: 1,
    ok: true,
    kind: "rewrite",
    workdir,
    applied: false,
    matches,
    counts,
    truncation,
    application: {
      requested: input.apply,
      performed: false,
      countsArePreviewBased: true,
      idempotencyChecked: false,
      secondPassExitCode,
    },
    warnings: [...warnings, ...extraWarnings],
    durationMs: elapsed(),
  })

  if (!input.apply) return dryRun(null)

  if (truncation.truncated) {
    return failure(
      "PREVIEW_TRUNCATED",
      `Preview exceeded maxMatches=${input.maxMatches} or was only partially salvaged; a truncated preview is never applied. Narrow paths or globs, then retry.`,
      "preview",
      input.language,
      elapsed(),
      { stderr: preview.stderr },
    )
  }
  if (matches.length === 0) {
    return dryRun(null, ["Nothing to apply: the preview found no matches."])
  }
  await hooks?.onPreviewComplete?.()

  /** What is left of the whole-call deadline once the preview and the staging window are paid for. */
  const remainingBudgetMs = input.timeoutMs - elapsed()
  if (remainingBudgetMs <= 0) {
    return failure(
      "TIMEOUT",
      "The tool deadline expired before the mutation pass could start; nothing was modified.",
      "apply",
      input.language,
      elapsed(),
      { stderr: preview.stderr },
    )
  }

  /** Exit code of the mutation pass, or null when it was killed by a signal. */
  let applyExitCode: number | null
  /** stderr of the mutation pass, kept for a stale-preview diagnosis. */
  let applyStderr = ""
  try {
    /** The mutation run's result; only its exit code and stderr are used. */
    const applied = await spawnSgRunner({
      sgPath,
      args: buildRewriteApplyArgs(input),
      workdir,
      maxMatches: input.maxMatches,
      timeoutMs: remainingBudgetMs,
      signal,
    })
    applyExitCode = applied.exitCode
    applyStderr = applied.stderr
  } catch (error) {
    if (error instanceof SgRunnerError) {
      return failure(error.code as RewriteErrorCode, error.message, "apply", input.language, elapsed(), {
        stderr: error.stderr,
      })
    }
    return failure(
      "SG_FAILED",
      error instanceof Error ? error.message : String(error),
      "apply",
      input.language,
      elapsed(),
    )
  }

  if (applyExitCode === 1) {
    return failure(
      "REWRITE_STALE_PREVIEW",
      "The preview found matches but the mutation pass found none; the files or search scope changed between passes. Re-run the preview before applying.",
      "apply",
      input.language,
      elapsed(),
      { stderr: applyStderr },
    )
  }

  return {
    schemaVersion: 1,
    ok: true,
    kind: "rewrite",
    workdir,
    applied: true,
    matches,
    counts,
    truncation,
    application: {
      requested: true,
      performed: true,
      countsArePreviewBased: true,
      idempotencyChecked: false,
      secondPassExitCode: applyExitCode,
    },
    warnings: [...warnings, APPLY_PREVIEW_WARNING],
    durationMs: elapsed(),
  }
}
