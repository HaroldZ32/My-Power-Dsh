// scan.ts — the `scan` tool: run ONE explicit ast-grep YAML rule source over files.
//
// "One explicit source" is the whole contract: either `ruleFile` or `inlineRules`, never both, and
// never an ambient `sgconfig.yml` — a scan whose rule set depends on the working directory is not
// reproducible. Like `rewrite`, applying is two passes: a bounded JSON preview, then a separate
// plain `--update-all` run, because `--update-all` combined with `--json` only previews.
import {
  DEFAULT_MATCHES,
  DEFAULT_TIMEOUT_MS,
  MAX_MATCHES,
  MAX_TIMEOUT_MS,
  SgRunnerError,
  spawnSgRunner,
} from "./runner.ts"
import { normalizeRecords, type NormalizedMatch } from "./normalize.ts"

/** Largest number of `paths` entries. */
const MAX_PATHS = 64
/** Largest number of `globs` entries. */
const MAX_GLOBS = 32
/** Smallest whole-call deadline a caller may ask for, in milliseconds. */
const MIN_TIMEOUT_MS = 1_000
/** Largest `paths` / `workdir` / `ruleFile` entry, in code points. */
const MAX_PATH_LENGTH = 4_096
/** Largest `globs` entry, in code points. */
const MAX_GLOB_LENGTH = 1_024
/** Largest `inlineRules` document, in UTF-8 bytes. */
const MAX_INLINE_RULE_BYTES = 64 * 1_024

/** The raw MCP tool name this module implements, as the harness exposes it. */
export const SCAN_TOOL_NAME = "scan" as const

/** Model-facing description of this tool, as the descriptor publishes it. */
export const SCAN_TOOL_DESCRIPTION =
  "Run ast-grep YAML rules over files. Name exactly ONE rule source — `ruleFile` (a path) or `inlineRules` (the YAML text) — and never both; no ambient `sgconfig.yml` is consulted, so a scan is reproducible from its arguments alone. Nothing is written unless `apply` is true. `includeMetadata` adds each rule's metadata block to the matches. Applying runs a bounded JSON preview and then a separate plain `--update-all` pass, so the reported counts describe the preview; a truncated preview is never applied."

/** A validated `scan` call. */
export interface ScanInput {
  /** Path to the YAML rule file; mutually exclusive with `inlineRules`. */
  readonly ruleFile?: string
  /** The YAML rule document itself; mutually exclusive with `ruleFile`. */
  readonly inlineRules?: string
  /** Files or directories to scan; required, with no implicit ".". */
  readonly paths: readonly string[]
  /** Working directory for the run; defaults to this server's cwd. */
  readonly workdir?: string
  /** Include/exclude globs passed through to ast-grep. */
  readonly globs?: readonly string[]
  /** Match cap for this call; defaults to 50. */
  readonly maxMatches: number
  /** Whole-call deadline in milliseconds; defaults to 300000. */
  readonly timeoutMs: number
  /** Scan hidden files too (`--no-ignore hidden`). */
  readonly includeHidden?: boolean
  /** Follow symlinks (`--follow`). */
  readonly followSymlinks?: boolean
  /** Add each rule's metadata block to its matches (`--include-metadata`). */
  readonly includeMetadata: boolean
  /** Whether to write the rules' fixes to disk. */
  readonly apply: boolean
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
  "ruleFile", "inlineRules", "paths", "workdir", "globs", "maxMatches",
  "timeoutMs", "includeHidden", "followSymlinks", "includeMetadata", "apply",
])

/**
 * Validate a raw `scan` argument object.
 * @param input - the raw `arguments` object of the MCP call
 * @returns the validated input
 * @throws {Error} when any argument is missing or out of contract
 */
function parseScanInput(input: unknown): ScanInput {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("Input must be an object")
  }
  /** The raw arguments as a field table. */
  const obj = input as Record<string, unknown>
  for (const key of Object.keys(obj)) {
    if (!KNOWN_KEYS.has(key)) throw new Error(`Unknown property: ${key}`)
  }

  /** Whether the caller named a rule file. */
  const hasRuleFile = obj.ruleFile !== undefined
  /** Whether the caller supplied inline rules. */
  const hasInlineRules = obj.inlineRules !== undefined
  if (hasRuleFile === hasInlineRules) {
    throw new Error("Exactly one of ruleFile or inlineRules must be provided")
  }
  if (hasRuleFile && (typeof obj.ruleFile !== "string" || obj.ruleFile.length === 0)) {
    throw new Error("ruleFile must be a non-empty string")
  }
  if (typeof obj.ruleFile === "string" && codePointLength(obj.ruleFile) > MAX_PATH_LENGTH) {
    throw new Error(`ruleFile must be at most ${MAX_PATH_LENGTH} characters`)
  }
  if (hasInlineRules && (typeof obj.inlineRules !== "string" || obj.inlineRules.length === 0)) {
    throw new Error("inlineRules must be a non-empty string")
  }
  if (typeof obj.inlineRules === "string" && Buffer.byteLength(obj.inlineRules, "utf8") > MAX_INLINE_RULE_BYTES) {
    throw new Error("inlineRules must be at most 64KiB")
  }

  if (!Array.isArray(obj.paths)) throw new Error("paths must be an array")
  if (obj.paths.length < 1 || obj.paths.length > MAX_PATHS) {
    throw new Error(`paths must have 1-${MAX_PATHS} entries`)
  }
  for (const path of obj.paths) {
    if (typeof path !== "string" || path.length === 0) throw new Error("each path must be a non-empty string")
    if (codePointLength(path) > MAX_PATH_LENGTH) throw new Error(`each path must be at most ${MAX_PATH_LENGTH} characters`)
  }

  if (obj.workdir !== undefined && (typeof obj.workdir !== "string" || obj.workdir.length === 0)) {
    throw new Error("workdir must be a non-empty string")
  }
  if (typeof obj.workdir === "string" && codePointLength(obj.workdir) > MAX_PATH_LENGTH) {
    throw new Error(`workdir must be at most ${MAX_PATH_LENGTH} characters`)
  }
  if (obj.globs !== undefined) {
    if (!Array.isArray(obj.globs)) throw new Error("globs must be an array")
    if (obj.globs.length > MAX_GLOBS) throw new Error(`globs must have at most ${MAX_GLOBS} entries`)
    for (const glob of obj.globs) {
      if (typeof glob !== "string" || glob.length === 0) throw new Error("each glob must be a non-empty string")
      if (codePointLength(glob) > MAX_GLOB_LENGTH) throw new Error(`each glob must be at most ${MAX_GLOB_LENGTH} characters`)
    }
  }

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

  for (const flag of ["includeHidden", "followSymlinks", "includeMetadata", "apply"] as const) {
    if (obj[flag] !== undefined && typeof obj[flag] !== "boolean") throw new Error(`${flag} must be a boolean`)
  }

  return {
    ruleFile: obj.ruleFile as string | undefined,
    inlineRules: obj.inlineRules as string | undefined,
    paths: obj.paths as readonly string[],
    workdir: obj.workdir as string | undefined,
    globs: obj.globs as readonly string[] | undefined,
    maxMatches,
    timeoutMs,
    includeHidden: obj.includeHidden as boolean | undefined,
    followSymlinks: obj.followSymlinks as boolean | undefined,
    includeMetadata: (obj.includeMetadata as boolean | undefined) ?? false,
    apply: (obj.apply as boolean | undefined) ?? false,
  }
}

/**
 * The rule-source fragment of the argv, from whichever source the caller named.
 * @param input - the validated `scan` arguments
 * @returns the argv fragment naming the rule source
 */
function sourceArgs(input: ScanInput): string[] {
  return input.ruleFile !== undefined
    ? ["--rule", input.ruleFile]
    : ["--inline-rules", input.inlineRules as string]
}

/**
 * The scope flags both passes share.
 * @param input - the validated `scan` arguments
 * @returns the argv fragment naming globs and symlink handling
 */
function scopeArgs(input: ScanInput): string[] {
  /** The scope argv under construction. */
  const args: string[] = []
  if (input.globs) for (const glob of input.globs) args.push("--globs", glob)
  if (input.includeHidden) args.push("--no-ignore", "hidden")
  if (input.followSymlinks) args.push("--follow")
  return args
}

/**
 * The argv of the non-mutating preview pass.
 * @param input - the validated `scan` arguments
 * @returns the argv to hand to the ast-grep executable
 */
export function buildScanArgs(input: ScanInput): string[] {
  return [
    "scan",
    ...sourceArgs(input),
    ...(input.includeMetadata ? ["--include-metadata"] : []),
    "--json=stream",
    ...scopeArgs(input),
    ...input.paths,
  ]
}

/**
 * The argv of the mutating pass — no JSON flag, because `--update-all` with JSON only previews.
 * @param input - the validated `scan` arguments
 * @returns the argv to hand to the ast-grep executable
 */
export function buildScanApplyArgs(input: ScanInput): string[] {
  return ["scan", ...sourceArgs(input), "--update-all", ...scopeArgs(input), ...input.paths]
}

/** The rule facts every scan match carries, lifted out of the rule that produced it. */
export interface ScanRuleBlock {
  /** The rule's `id`, or "" when the match named none. */
  readonly ruleId: string
  /** The rule's severity, when it declares one. */
  readonly severity?: string
  /** The rule's note, when it declares one. */
  readonly note?: string
  /** The rule's message, when it declares one. */
  readonly message?: string
  /** The rule's labels, or an empty array. */
  readonly labels: readonly unknown[]
  /** The rule's metadata block, when it declares one (and the pass asked for metadata). */
  readonly metadata?: unknown
}

/** One scan match: the normalized match, its fix text, and the rule that produced it. */
export interface ScanMatch extends NormalizedMatch {
  /** The text the rule's `fix` would write, or "" when the rule declares no fix. */
  readonly replacement: string
  /** Byte offsets of the fix, when the record carried them. */
  readonly replacementOffsets?: unknown
  /** The rule that produced this match. */
  readonly rule: ScanRuleBlock
}

/** Error codes the `scan` payload can carry. */
export type ScanErrorCode =
  | "ABORTED"
  | "ENCODING_ERROR"
  | "INVALID_ARGUMENT"
  | "OUTPUT_PARSE_FAILED"
  | "OUTPUT_TOO_LARGE"
  | "PREVIEW_TRUNCATED"
  | "RULE_PARSE_FAILED"
  | "SG_FAILED"
  | "TIMEOUT"

/** Which pass produced a `scan` failure. */
export type ScanPhase = "preflight" | "preview" | "apply"

/** A successful `scan` payload. */
export interface ScanSuccessPayload {
  /** Payload schema version, bumped only by a breaking shape change. */
  readonly schemaVersion: 1
  /** Always true on this branch. */
  readonly ok: true
  /** Which tool produced the payload. */
  readonly kind: "scan"
  /** The working directory the run used. */
  readonly workdir: string
  /** Whether the mutation pass really ran. */
  readonly applied: boolean
  /** The previewed matches, ordered by path then start byte. */
  readonly matches: readonly ScanMatch[]
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
  /** What the apply pass did. */
  readonly application: {
    /** Whether the caller asked for a mutation. */
    readonly requested: boolean
    /** Whether a mutation pass actually ran. */
    readonly performed: boolean
    /** Always true: the counts above describe the preview, not the mutation pass. */
    readonly countsArePreviewBased: true
    /** Exit code of the mutation pass, or null when it never ran. */
    readonly secondPassExitCode: number | null
  }
  /** Non-blocking findings, plus an apply warning. */
  readonly warnings: readonly string[]
  /** Wall-clock duration of the call in milliseconds. */
  readonly durationMs: number
}

/** A failed `scan` payload. */
export interface ScanErrorPayload {
  /** Payload schema version, bumped only by a breaking shape change. */
  readonly schemaVersion: 1
  /** Always false on this branch. */
  readonly ok: false
  /** Which tool produced the payload. */
  readonly kind: "scan"
  /** The failure, with the pass that produced it. */
  readonly error: {
    /** Taxonomy code of the failure. */
    readonly code: ScanErrorCode
    /** One-line cause. */
    readonly message: string
    /** Whether retrying the same call could succeed. */
    readonly retryable: boolean
    /** Which pass produced the failure. */
    readonly phase: ScanPhase
    /** Diagnostics: the captured stderr, when there was one. */
    readonly details: { readonly stderr?: string }
  }
  /** Wall-clock duration of the call in milliseconds. */
  readonly durationMs: number
}

/** Either branch of the `scan` result. */
export type ScanPayload = ScanSuccessPayload | ScanErrorPayload

/** The codes a caller may usefully retry unchanged. */
const RETRYABLE: ReadonlySet<ScanErrorCode> = new Set<ScanErrorCode>(["ABORTED", "OUTPUT_PARSE_FAILED", "TIMEOUT"])

/** stderr shapes ast-grep emits when the YAML rule source cannot be parsed. */
const RULE_PARSE_RE = /Cannot parse rule|not a valid ast-grep rule|Fail to parse yaml as RuleConfig/i

/** stderr shape of ast-grep's rule-schema deprecation notice, which is surfaced as a warning. */
const DEPRECATION_WARNING_RE = /^warning:.*\bsg\b.*deprecated/im

/** Warning that accompanies every applied scan, stating what its counts really measure. */
const APPLY_PREVIEW_WARNING =
  "Mutation counts are based on the preview pass; sg scan --update-all does not return equivalent JSON."

/**
 * Build one `scan` error payload.
 * @param code - taxonomy code of the failure
 * @param message - one-line cause
 * @param phase - the pass that produced the failure
 * @param durationMs - wall-clock duration in milliseconds
 * @param details - the captured stderr, when there was one
 * @returns the error payload
 */
function failure(
  code: ScanErrorCode,
  message: string,
  phase: ScanPhase,
  durationMs: number,
  details: { stderr?: string } = {},
): ScanErrorPayload {
  return {
    schemaVersion: 1,
    ok: false,
    kind: "scan",
    error: { code, message, retryable: RETRYABLE.has(code), phase, details },
    durationMs,
  }
}

/**
 * Turn a runner failure into a payload, naming a rule-parse failure when stderr proves one.
 * @param error - the runner failure
 * @param phase - the pass that produced it
 * @returns the error payload
 */
function runnerFailure(error: SgRunnerError, phase: ScanPhase): ScanErrorPayload {
  if (RULE_PARSE_RE.test(error.stderr)) {
    return failure(
      "RULE_PARSE_FAILED",
      "ast-grep could not parse the explicit YAML rule source.",
      phase,
      error.durationMs,
      { stderr: error.stderr },
    )
  }
  return failure(error.code as ScanErrorCode, error.message, phase, error.durationMs, { stderr: error.stderr })
}

/**
 * Normalize scan records and lift each match's rule facts into a `rule` block.
 * @param records - the raw preview records
 * @param workdir - the run's working directory
 * @returns the matches, each with its fix and its rule block
 */
function toScanMatches(records: readonly Record<string, unknown>[], workdir: string): ScanMatch[] {
  return normalizeRecords(records, workdir).map((normalized) => {
    /** The normalized match as a field table, so rule keys can be lifted out of it. */
    const raw = normalized as Record<string, unknown>
    /** The rule facts this match carries. */
    const rule: ScanRuleBlock = {
      ruleId: typeof raw.ruleId === "string" ? raw.ruleId : "",
      ...(typeof raw.severity === "string" ? { severity: raw.severity } : {}),
      ...(typeof raw.note === "string" ? { note: raw.note } : {}),
      ...(typeof raw.message === "string" ? { message: raw.message } : {}),
      labels: Array.isArray(raw.labels) ? raw.labels : [],
      ...(raw.metadata !== undefined ? { metadata: raw.metadata } : {}),
    }
    /** The match without the rule keys, which move into the `rule` block. */
    const match = { ...raw }
    delete match.ruleId
    delete match.severity
    delete match.note
    delete match.message
    delete match.labels
    delete match.metadata
    return {
      ...match,
      replacement: typeof raw.replacement === "string" ? raw.replacement : "",
      rule,
    } as ScanMatch
  })
}

/**
 * Run one `scan` call: validate, preview, and — only when every gate holds — apply.
 * @param rawInput - the raw `arguments` object of the MCP call
 * @param sgPath - absolute path of the ast-grep executable
 * @param signal - abort signal of the in-flight request
 * @returns the success or error payload of this call
 */
export async function executeScan(
  rawInput: unknown,
  sgPath: string,
  signal?: AbortSignal,
): Promise<ScanPayload> {
  /** Wall-clock start of this call. */
  const startedAt = performance.now()
  /** Milliseconds elapsed since this call started. */
  const elapsed = (): number => Math.max(0, Math.round(performance.now() - startedAt))

  /** The validated arguments. */
  let input: ScanInput
  try {
    input = parseScanInput(rawInput)
  } catch (error) {
    return failure(
      "INVALID_ARGUMENT",
      error instanceof Error ? error.message : String(error),
      "preflight",
      elapsed(),
    )
  }

  /** The directory the run executes in. */
  const workdir = input.workdir ?? process.env.MPD_AST_GREP_PROJECT_CWD ?? process.cwd()
  /** The preview run's result, or the failure the catch below turns into a payload. */
  let preview: Awaited<ReturnType<typeof spawnSgRunner>>
  try {
    preview = await spawnSgRunner({
      sgPath,
      args: buildScanArgs(input),
      workdir,
      maxMatches: input.maxMatches,
      timeoutMs: input.timeoutMs,
      signal,
    })
  } catch (error) {
    if (error instanceof SgRunnerError) return runnerFailure(error, "preview")
    return failure("SG_FAILED", error instanceof Error ? error.message : String(error), "preview", elapsed())
  }

  /** The previewed matches. */
  const matches = toScanMatches(preview.records, workdir)
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
  /** Non-blocking findings: ast-grep's own rule-schema deprecation notice, when it printed one. */
  const warnings = DEPRECATION_WARNING_RE.test(preview.stderr) ? [preview.stderr.trim()] : []

  /**
   * Build a success payload for a call that did not mutate anything.
   * @param extraWarnings - further warnings to append
   * @returns the payload
   */
  const dryRun = (extraWarnings: readonly string[] = []): ScanSuccessPayload => ({
    schemaVersion: 1,
    ok: true,
    kind: "scan",
    workdir,
    applied: false,
    matches,
    counts,
    truncation,
    application: {
      requested: input.apply,
      performed: false,
      countsArePreviewBased: true,
      secondPassExitCode: null,
    },
    warnings: [...warnings, ...extraWarnings],
    durationMs: elapsed(),
  })

  if (!input.apply) return dryRun()
  if (preview.truncated) {
    return failure(
      "PREVIEW_TRUNCATED",
      `Preview exceeded maxMatches=${input.maxMatches} or was only partially salvaged; a truncated preview is never applied. Narrow paths or globs, then retry.`,
      "preview",
      elapsed(),
      { stderr: preview.stderr },
    )
  }
  if (matches.length === 0) return dryRun(["Nothing to apply: the preview found no matches."])

  /** What is left of the whole-call deadline once the preview pass is paid for. */
  const remainingBudgetMs = input.timeoutMs - elapsed()
  if (remainingBudgetMs <= 0) {
    return failure(
      "TIMEOUT",
      "The tool deadline expired during the preview pass; the mutation pass was not started.",
      "preview",
      elapsed(),
      { stderr: preview.stderr },
    )
  }

  /** The mutation run's result; only its exit code is published. */
  let applied: Awaited<ReturnType<typeof spawnSgRunner>>
  try {
    applied = await spawnSgRunner({
      sgPath,
      args: buildScanApplyArgs(input),
      workdir,
      maxMatches: input.maxMatches,
      timeoutMs: remainingBudgetMs,
      signal,
    })
  } catch (error) {
    if (error instanceof SgRunnerError) return runnerFailure(error, "apply")
    return failure("SG_FAILED", error instanceof Error ? error.message : String(error), "apply", elapsed())
  }

  return {
    schemaVersion: 1,
    ok: true,
    kind: "scan",
    workdir,
    applied: true,
    matches,
    counts,
    truncation,
    application: {
      requested: true,
      performed: true,
      countsArePreviewBased: true,
      secondPassExitCode: applied.exitCode,
    },
    warnings: [...warnings, APPLY_PREVIEW_WARNING],
    durationMs: elapsed(),
  }
}
