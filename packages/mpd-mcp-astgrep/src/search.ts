// search.ts — the `search` tool: structural search over files with the ast-grep engine.
//
// The caller's arguments are validated here (the JSON Schema in the tool descriptor describes the
// same limits, but the parser is authoritative, because two of the budgets are counted in BYTES and
// JSON Schema `maxLength` counts code points), then translated into the `sg run` argv, then run under
// the runner's budgets. Everything the caller sees is assembled in this module.
import {
  DEFAULT_MATCHES,
  DEFAULT_TIMEOUT_MS,
  MAX_MATCHES,
  MAX_TIMEOUT_MS,
  SgRunnerError,
  spawnSgRunner,
} from "./runner.ts"
import { normalizeRecords, type NormalizedMatch } from "./normalize.ts"
import { validatePatternHints } from "./hints.ts"

/** Largest `pattern` this server accepts, in UTF-8 bytes. */
const MAX_PATTERN_BYTES = 16 * 1024
/** Largest number of `globs` entries. */
const MAX_GLOBS = 32
/** Largest number of `paths` entries. */
const MAX_PATHS = 64
/** Smallest whole-call deadline a caller may ask for, in milliseconds. */
const MIN_TIMEOUT_MS = 1000
/** Largest `paths` / `workdir` entry, in code points. */
const MAX_PATH_LEN = 4096
/** Largest `globs` entry, in code points. */
const MAX_GLOB_LEN = 1024
/** Largest `selector`, in code points. */
const MAX_SELECTOR_LEN = 128
/** Largest `workdir`, in code points. */
const MAX_WORKDIR_LEN = 4096

/** The raw MCP tool name this module implements, as the harness exposes it. */
export const SEARCH_TOOL_NAME = "search" as const

/** Model-facing description of this tool, as the descriptor publishes it. */
export const SEARCH_TOOL_DESCRIPTION =
  "Search code by syntax shape with ast-grep. Write the pattern as code, not as a regular expression, and make it parse as ONE AST node in the required language; keep `paths` narrow. `$NAME` and `$_` capture a single whole node, `$$$NAME` and `$$$` capture zero or more nodes; a capture name must be UPPERCASE (`$$NAME` is invalid), a partial token never captures, and repeating a name requires identical code in every position. Wrap syntax that cannot stand alone, or name a `selector` to match a sub-node. A parse warning means the query failed — it does not mean the code is absent.";

/** The 25 languages ast-grep parses, as the descriptor's enum publishes them. */
const LANGUAGES = [
  "bash", "c", "cpp", "csharp", "css", "elixir", "go", "haskell", "html",
  "java", "javascript", "json", "kotlin", "lua", "nix", "php", "python",
  "ruby", "rust", "scala", "solidity", "swift", "typescript", "tsx", "yaml",
] as const

/** The match strictness levels ast-grep accepts; `template` is deliberately not one of them. */
const STRICTNESS = ["cst", "smart", "ast", "relaxed", "signature"] as const

/** A validated `search` call. */
export interface SearchInput {
  /** The structural pattern to match. */
  readonly pattern: string
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
  readonly strictness?: (typeof STRICTNESS)[number]
  /** Match cap for this call; defaults to 50. */
  readonly maxMatches?: number
  /** Whole-call deadline in milliseconds; defaults to 300000. */
  readonly timeoutMs?: number
  /** Search hidden files too (`--no-ignore hidden`). */
  readonly includeHidden?: boolean
  /** Follow symlinks (`--follow`). */
  readonly followSymlinks?: boolean
  /** Bypass non-fatal pattern-hint rejections. */
  readonly force?: boolean
}

/** A failed `search` argument check, carrying the language the caller named for the error payload. */
export class SearchArgumentError extends Error {
  /** The caller's `language` argument, or "unknown" when it was absent or not a string. */
  readonly language: string

  /**
   * @param message - the validation failure, as the caller must read it
   * @param language - the caller's `language` argument for the error payload
   */
  constructor(message: string, language: string) {
    super(message)
    this.name = "SearchArgumentError"
    this.language = language
  }
}

/**
 * Count a string's Unicode code points, which is the unit JSON Schema `maxLength` counts.
 * @param value - the string to measure
 * @returns its length in code points
 */
function codePoints(value: string): number {
  /** Running count of code points. */
  let count = 0
  for (const _ of value) count++
  return count
}

/**
 * Validate a raw `search` argument object.
 * @param input - the raw `arguments` object of the MCP call
 * @returns the validated input
 * @throws {SearchArgumentError} when any argument is missing or out of contract
 */
export function parseSearchInput(input: unknown): SearchInput {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new SearchArgumentError("Input must be an object", "unknown")
  }
  /** The raw arguments as a field table. */
  const obj = input as Record<string, unknown>
  /** The caller's language for the error payload, resolved before any check can fail. */
  const language = typeof obj.language === "string" ? obj.language : "unknown"

  if (typeof obj.pattern !== "string") throw new SearchArgumentError("pattern must be a string", language)
  if (obj.pattern.length === 0) throw new SearchArgumentError("pattern must be at least 1 character", language)
  if (Buffer.byteLength(obj.pattern, "utf8") > MAX_PATTERN_BYTES) {
    throw new SearchArgumentError("pattern must be at most 16384 bytes", language)
  }

  if (typeof obj.language !== "string" || !(LANGUAGES as readonly string[]).includes(obj.language)) {
    throw new SearchArgumentError(`language must be one of: ${LANGUAGES.join(", ")}`, language)
  }

  if (!Array.isArray(obj.paths)) throw new SearchArgumentError("paths must be an array", language)
  if (obj.paths.length < 1 || obj.paths.length > MAX_PATHS) {
    throw new SearchArgumentError(`paths must have 1-${MAX_PATHS} entries`, language)
  }
  for (const path of obj.paths) {
    if (typeof path !== "string" || path.length === 0) throw new SearchArgumentError("each path must be a non-empty string", language)
    if (codePoints(path) > MAX_PATH_LEN) throw new SearchArgumentError(`each path must be at most ${MAX_PATH_LEN} characters`, language)
  }

  if (obj.workdir !== undefined) {
    if (typeof obj.workdir !== "string") throw new SearchArgumentError("workdir must be a string", language)
    if (obj.workdir.length === 0) throw new SearchArgumentError("workdir must be at least 1 character", language)
    if (codePoints(obj.workdir) > MAX_WORKDIR_LEN) throw new SearchArgumentError(`workdir must be at most ${MAX_WORKDIR_LEN} characters`, language)
  }

  if (obj.globs !== undefined) {
    if (!Array.isArray(obj.globs)) throw new SearchArgumentError("globs must be an array", language)
    if (obj.globs.length > MAX_GLOBS) throw new SearchArgumentError(`globs must have at most ${MAX_GLOBS} entries`, language)
    for (const glob of obj.globs) {
      if (typeof glob !== "string" || glob.length === 0) throw new SearchArgumentError("each glob must be a non-empty string", language)
      if (codePoints(glob) > MAX_GLOB_LEN) throw new SearchArgumentError(`each glob must be at most ${MAX_GLOB_LEN} characters`, language)
    }
  }

  if (obj.selector !== undefined) {
    if (typeof obj.selector !== "string") throw new SearchArgumentError("selector must be a string", language)
    if (obj.selector.length === 0) throw new SearchArgumentError("selector must be at least 1 character", language)
    if (codePoints(obj.selector) > MAX_SELECTOR_LEN) throw new SearchArgumentError(`selector must be at most ${MAX_SELECTOR_LEN} characters`, language)
  }

  /** The validated strictness, defaulted to `smart`. */
  let strictness: (typeof STRICTNESS)[number] = "smart"
  if (obj.strictness !== undefined) {
    if (typeof obj.strictness !== "string" || !(STRICTNESS as readonly string[]).includes(obj.strictness)) {
      throw new SearchArgumentError(`strictness must be one of: ${STRICTNESS.join(", ")}`, language)
    }
    strictness = obj.strictness as (typeof STRICTNESS)[number]
  }

  /** The validated match cap, defaulted to 50. */
  let maxMatches = DEFAULT_MATCHES
  if (obj.maxMatches !== undefined) {
    if (typeof obj.maxMatches !== "number" || !Number.isInteger(obj.maxMatches) || obj.maxMatches < 1 || obj.maxMatches > MAX_MATCHES) {
      throw new SearchArgumentError(`maxMatches must be an integer between 1 and ${MAX_MATCHES}`, language)
    }
    maxMatches = obj.maxMatches
  }

  /** The validated whole-call deadline, defaulted to 300000 ms. */
  let timeoutMs = DEFAULT_TIMEOUT_MS
  if (obj.timeoutMs !== undefined) {
    if (typeof obj.timeoutMs !== "number" || !Number.isInteger(obj.timeoutMs) || obj.timeoutMs < MIN_TIMEOUT_MS || obj.timeoutMs > MAX_TIMEOUT_MS) {
      throw new SearchArgumentError(`timeoutMs must be an integer between ${MIN_TIMEOUT_MS} and ${MAX_TIMEOUT_MS}`, language)
    }
    timeoutMs = obj.timeoutMs
  }

  if (obj.includeHidden !== undefined && typeof obj.includeHidden !== "boolean") {
    throw new SearchArgumentError("includeHidden must be a boolean", language)
  }
  if (obj.followSymlinks !== undefined && typeof obj.followSymlinks !== "boolean") {
    throw new SearchArgumentError("followSymlinks must be a boolean", language)
  }
  if (obj.force !== undefined && typeof obj.force !== "boolean") {
    throw new SearchArgumentError("force must be a boolean", language)
  }

  /** Every argument name this tool accepts, so an unknown one is a caller mistake. */
  const known = new Set([
    "pattern", "language", "paths", "workdir", "globs", "selector",
    "strictness", "maxMatches", "timeoutMs", "includeHidden", "followSymlinks", "force",
  ])
  for (const key of Object.keys(obj)) {
    if (!known.has(key)) throw new SearchArgumentError(`Unknown property: ${key}`, language)
  }

  return {
    pattern: obj.pattern,
    language: obj.language as SearchInput["language"],
    paths: obj.paths as string[],
    workdir: obj.workdir as string | undefined,
    globs: obj.globs as string[] | undefined,
    selector: obj.selector as string | undefined,
    strictness,
    maxMatches,
    timeoutMs,
    includeHidden: obj.includeHidden as boolean | undefined,
    followSymlinks: obj.followSymlinks as boolean | undefined,
    force: obj.force as boolean | undefined,
  }
}

/**
 * Translate a validated call into the `sg run` argv.
 * @param input - the validated `search` arguments
 * @returns the argv to hand to the ast-grep executable
 */
export function buildSearchArgs(input: SearchInput): string[] {
  /** The argv under construction. */
  const args: string[] = ["run", "-p", input.pattern, "--lang", input.language, "--json=stream"]
  args.push("--strictness", input.strictness ?? "smart")
  if (input.selector) args.push("--selector", input.selector)
  if (input.globs) for (const glob of input.globs) args.push("--globs", glob)
  if (input.includeHidden) args.push("--no-ignore", "hidden")
  if (input.followSymlinks) args.push("--follow")
  args.push(...input.paths)
  return args
}

/** Error codes the `search` payload can carry. */
export type SearchErrorCode =
  | "INVALID_ARGUMENT"
  | "BINARY_NOT_FOUND"
  | "BINARY_INVALID"
  | "UNSUPPORTED_LANGUAGE"
  | "PATTERN_HINT_REJECTED"
  | "PATTERN_PARSE_FAILED"
  | "REWRITE_UNBOUND_METAVARIABLE"
  | "REWRITE_METAVARIABLE_KIND_MISMATCH"
  | "PATH_NOT_FOUND"
  | "PATH_UNREADABLE"
  | "TIMEOUT"
  | "ABORTED"
  | "OUTPUT_TOO_LARGE"
  | "OUTPUT_PARSE_FAILED"
  | "PREVIEW_TRUNCATED"
  | "REWRITE_STALE_PREVIEW"
  | "SG_FAILED"
  | "ENCODING_ERROR"

/** The codes a caller may usefully retry unchanged. */
const RETRYABLE_CODES: ReadonlySet<SearchErrorCode> = new Set<SearchErrorCode>([
  "TIMEOUT",
  "ABORTED",
  "OUTPUT_PARSE_FAILED",
  "REWRITE_STALE_PREVIEW",
])

/** A successful `search` payload. */
export interface SearchSuccessPayload {
  /** Payload schema version, bumped only by a breaking shape change. */
  readonly schemaVersion: 1
  /** Always true on this branch. */
  readonly ok: true
  /** Which tool produced the payload. */
  readonly kind: "search"
  /** The working directory the run used. */
  readonly workdir: string
  /** The matches, ordered by path then start byte. */
  readonly matches: NormalizedMatch[]
  /** Counts of this payload, plus the null totals a truncated run cannot know. */
  readonly counts: {
    /** Matches returned in this payload. */
    readonly returnedMatches: number
    /** Distinct files among the returned matches. */
    readonly returnedFiles: number
    /** Total matches when the run was complete, else null. */
    readonly totalMatches: number | null
    /** Total files when the run was complete, else null. */
    readonly totalFiles: number | null
    /** Lower bound on the real match count when a cap stopped the run. */
    readonly atLeastMatches: number
  }
  /** How the run was capped, if it was. */
  readonly truncation: {
    /** Whether the record set is incomplete. */
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
  /** Non-blocking findings, including the limit warning. */
  readonly warnings: string[]
  /** Wall-clock duration of the run in milliseconds. */
  readonly durationMs: number
}

/** A failed `search` payload. */
export interface SearchErrorPayload {
  /** Payload schema version, bumped only by a breaking shape change. */
  readonly schemaVersion: 1
  /** Always false on this branch. */
  readonly ok: false
  /** The failure, with the phase that produced it and the caller-facing diagnosis. */
  readonly error: {
    /** Taxonomy code of the failure. */
    readonly code: SearchErrorCode
    /** One-line cause. */
    readonly message: string
    /** Whether retrying the same call could succeed. */
    readonly retryable: boolean
    /** Whether the failure happened in the pre-flight checks or in the run itself. */
    readonly phase: "search" | "preflight"
    /** The language the caller named. */
    readonly language: string
    /** Diagnostics: captured stderr and the actionable hint. */
    readonly details: {
      /** Decoded stderr of the failed run, or "" when there was none. */
      readonly stderr: string
      /** The actionable next step, or "" when there is none. */
      readonly hint: string
    }
  }
}

/** Either branch of the `search` result. */
export type SearchPayload = SearchSuccessPayload | SearchErrorPayload

/** stderr marker ast-grep prints when a pattern only parsed into an ERROR node. */
const ERROR_NODE_RE = /Pattern contains an ERROR node/i

/**
 * Whether stderr reports that the pattern did not really parse.
 * @param stderr - the captured stderr of the run
 * @returns true when ast-grep reported an ERROR node
 */
function detectPatternParseFailure(stderr: string): boolean {
  return ERROR_NODE_RE.test(stderr)
}

/**
 * Build one `search` error payload.
 * @param code - taxonomy code of the failure
 * @param message - one-line cause
 * @param language - the language the caller named
 * @param phase - the phase that produced the failure
 * @param stderr - captured stderr, or ""
 * @param hint - the actionable next step, or ""
 * @param durationMs - wall-clock duration in milliseconds
 * @returns the error payload
 */
function makeError(
  code: SearchErrorCode,
  message: string,
  language: string,
  phase: "search" | "preflight",
  stderr: string,
  hint: string,
  durationMs: number,
): SearchErrorPayload {
  return {
    schemaVersion: 1,
    ok: false,
    error: {
      code,
      message,
      retryable: RETRYABLE_CODES.has(code),
      phase,
      language,
      details: { stderr, hint },
    },
  }
}

/** Warning added when a cap stopped the run before the tree was exhausted. */
const LIMIT_WARNING = "Result limit reached; narrow paths or globs."

/**
 * Run one `search` call.
 * @param input - the validated `search` arguments
 * @param sgPath - absolute path of the ast-grep executable
 * @param signal - abort signal of the in-flight request
 * @returns the success or error payload of this call
 */
export async function executeSearch(
  input: SearchInput,
  sgPath: string,
  signal?: AbortSignal,
): Promise<SearchPayload> {
  /** Wall-clock start of this call. */
  const startedAt = performance.now()
  /** The directory the run executes in. */
  const workdir = input.workdir ?? process.cwd()
  /** The match cap of this call. */
  const maxMatches = input.maxMatches ?? DEFAULT_MATCHES
  /** The whole-call deadline of this call. */
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS

  /** The pre-flight pattern verdict. */
  const validation = validatePatternHints(input.pattern, input.language, {
    force: input.force,
    paths: input.paths,
    limit: maxMatches,
  })
  if (validation.rejected) {
    /** The finding that blocked the call, for the payload's message. */
    const rejectHint = validation.hints.find((hint) => hint.severity === "always-reject" || hint.severity === "reject")
    return makeError(
      (validation.code ?? "INVALID_ARGUMENT") as SearchErrorCode,
      rejectHint?.message ?? "Pattern validation failed",
      input.language,
      "preflight",
      "",
      validation.hints.map((hint) => hint.message).join("; "),
      Math.round(performance.now() - startedAt),
    )
  }

  /** The argv of this run. */
  const args = buildSearchArgs(input)

  /** The run's result, or the failure the catch below turns into a payload. */
  let runnerResult: Awaited<ReturnType<typeof spawnSgRunner>>
  try {
    runnerResult = await spawnSgRunner({
      sgPath,
      args,
      workdir,
      maxMatches,
      timeoutMs,
      signal,
    })
  } catch (error) {
    if (error instanceof SgRunnerError) {
      return makeError(
        error.code as SearchErrorCode,
        error.message,
        input.language,
        "search",
        error.stderr,
        "",
        error.durationMs,
      )
    }
    return makeError(
      "SG_FAILED",
      error instanceof Error ? error.message : String(error),
      input.language,
      "search",
      "",
      "",
      Math.round(performance.now() - startedAt),
    )
  }

  if (detectPatternParseFailure(runnerResult.stderr)) {
    return makeError(
      "PATTERN_PARSE_FAILED",
      "Pattern did not parse as one " + input.language + " AST node.",
      input.language,
      "search",
      runnerResult.stderr,
      "Use a complete function, call, declaration, or wrapped context.",
      runnerResult.durationMs,
    )
  }

  /** Non-blocking findings of the pre-flight pass. */
  const warnings = validation.hints.map((hint) => hint.message)
  /** The normalized matches of this run. */
  const matches = normalizeRecords(runnerResult.records, workdir)
  /** The distinct files among those matches. */
  const fileSet = new Set(matches.map((match) => match.path))
  /** How many distinct files the payload returns. */
  const returnedFiles = fileSet.size

  /** Whether the run left matches out. */
  const truncated = runnerResult.truncated
  /** Why it left them out. */
  const reason = runnerResult.reason
  /** Total matches, known only when the run was complete. */
  const totalMatches = truncated ? null : matches.length
  /** Total files, known only when the run was complete. */
  const totalFiles = truncated ? null : returnedFiles

  if (truncated) {
    warnings.push(LIMIT_WARNING)
  }

  return {
    schemaVersion: 1,
    ok: true,
    kind: "search",
    workdir,
    matches,
    counts: {
      returnedMatches: matches.length,
      returnedFiles,
      totalMatches,
      totalFiles,
      atLeastMatches: runnerResult.atLeastMatches,
    },
    truncation: {
      truncated,
      reason,
      maxMatches,
      maxPayloadBytes: runnerResult.maxPayloadBytes,
      salvagedRecords: runnerResult.salvagedRecords,
    },
    warnings,
    durationMs: runnerResult.durationMs,
  }
}
