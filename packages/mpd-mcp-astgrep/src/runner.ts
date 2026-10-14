// runner.ts — the ast-grep process boundary of this bundle's OWN ast_grep MCP server.
//
// The engine is the `ast-grep` (`sg`) executable, exactly as this bundle drove it before: the
// server never parses source itself. This module owns the one thing that needs care — reading
// `sg --json=stream` output safely: one JSON object per line, hard caps on a single record, on the
// aggregate payload and on stderr, a whole-call deadline, an abort path, and a STOP that kills the
// child as soon as the answer can no longer change (so a huge tree cannot stream forever).
import { spawn } from "node:child_process"

/** Largest single NDJSON record accepted from `sg` before the run fails as OUTPUT_TOO_LARGE. */
export const MAX_JSON_RECORD_BYTES = 1024 * 1024
/** Largest stderr text this server keeps (and reports) — a diagnostic, never a transcript. */
export const MAX_STDERR_BYTES = 64 * 1024
/** Largest aggregate serialized match payload before the run truncates with reason `output_cap`. */
export const MAX_MCP_PAYLOAD_BYTES = 4 * 1024 * 1024
/** Hard ceiling on `maxMatches` a caller may ask for; the parser is authoritative, not the schema. */
export const MAX_MATCHES = 500
/** `maxMatches` used when the caller names none. */
export const DEFAULT_MATCHES = 50
/** Whole-call deadline in milliseconds used when the caller names none. */
export const DEFAULT_TIMEOUT_MS = 300_000
/** Hard ceiling on the whole-call deadline a caller may ask for. */
export const MAX_TIMEOUT_MS = 300_000

/** Every failure `spawnSgRunner` can raise, named so a tool can map it onto its own taxonomy. */
export type SgRunnerErrorCode =
  | "ABORTED"
  | "ENCODING_ERROR"
  | "OUTPUT_PARSE_FAILED"
  | "OUTPUT_TOO_LARGE"
  | "SG_FAILED"
  | "TIMEOUT"

/** Why a run returned fewer records than the tree holds; null when nothing was left out. */
export type SgTruncationReason = "match_limit" | "output_cap" | "sg_output_truncated" | null

/** One `sg` invocation: the executable, its argv, the working directory and the budgets. */
export interface SgRunnerInput {
  /** Absolute path of the ast-grep executable to spawn. */
  readonly sgPath: string
  /** argv[0..] handed to the executable, in order. */
  readonly args: readonly string[]
  /** Working directory of the child — also the root every reported path is made relative to. */
  readonly workdir: string
  /** Environment for the child; the caller's `process.env` when omitted. */
  readonly env?: NodeJS.ProcessEnv
  /** Cap on records collected before the run is stopped and marked `match_limit`. */
  readonly maxMatches?: number
  /** Whole-call deadline in milliseconds; the child is killed when it expires. */
  readonly timeoutMs?: number
  /** Abort signal: when it fires the child is killed and ABORTED is raised. */
  readonly signal?: AbortSignal
}

/** What one `sg` run produced: the records plus every fact needed to describe truncation honestly. */
export interface SgRunnerResult {
  /** Parsed NDJSON records, in the order `sg` emitted them (never re-sorted here). */
  readonly records: readonly Record<string, unknown>[]
  /** Whether the record set is incomplete for any reason. */
  readonly truncated: boolean
  /** Why it is incomplete, or null when it is complete. */
  readonly reason: SgTruncationReason
  /** How many records survived when the stream itself was malformed mid-way (0 otherwise). */
  readonly salvagedRecords: number
  /** Decoded stderr, capped at {@link MAX_STDERR_BYTES} on a UTF-8 boundary. */
  readonly stderr: string
  /** Wall-clock duration of the run in milliseconds. */
  readonly durationMs: number
  /** Lower bound on the real match count — `records.length + 1` when a cap stopped the run. */
  readonly atLeastMatches: number
  /** The aggregate payload budget this run enforced, so the payload can publish it. */
  readonly maxPayloadBytes: number
  /** Exit code of `sg`, or null when it was killed by a signal. */
  readonly exitCode: number | null
}

/** A failure of the `sg` boundary itself, carrying its taxonomy code and the captured stderr. */
export class SgRunnerError extends Error {
  /** The taxonomy code a tool maps onto its own error payload. */
  readonly code: SgRunnerErrorCode
  /** Decoded stderr of the failed run, capped like {@link SgRunnerResult.stderr}. */
  readonly stderr: string
  /** Wall-clock duration of the failed run in milliseconds. */
  readonly durationMs: number

  /**
   * @param code - the taxonomy code describing the failure
   * @param message - one-line human-readable cause
   * @param stderr - decoded stderr captured so far ("" when none)
   * @param durationMs - wall-clock duration of the failed run
   */
  constructor(code: SgRunnerErrorCode, message: string, stderr: string = "", durationMs: number = 0) {
    super(message)
    this.name = "SgRunnerError"
    this.code = code
    this.stderr = stderr
    this.durationMs = durationMs
  }
}

/**
 * Whether a parsed JSON value is a plain object (never an array or null).
 * @param value - the parsed JSON value to classify
 * @returns true when `value` is a plain object
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * Truncate a string to at most `maxBytes` UTF-8 bytes without splitting a code point.
 * @param value - the string to truncate
 * @param maxBytes - the byte budget
 * @returns the longest prefix of `value` within the budget
 */
function truncateUtf8(value: string, maxBytes: number): string {
  /** The value's UTF-8 bytes, which is what the budget counts. */
  const bytes = Buffer.from(value, "utf8")
  if (bytes.length <= maxBytes) return value
  /** Last byte index to keep, walked back off a continuation byte. */
  let end = maxBytes
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end -= 1
  return bytes.subarray(0, end).toString("utf8")
}

/**
 * Decode captured stderr, dropping a trailing partial code point before the byte cap is applied.
 * @param bytes - the raw stderr bytes captured so far
 * @returns the decoded, capped stderr text
 */
function decodeStderr(bytes: Buffer): string {
  /** Start of the last code point, walked back over at most three continuation bytes. */
  let start = bytes.length - 1
  while (start >= 0 && (bytes[start] & 0xc0) === 0x80 && bytes.length - start <= 3) start -= 1
  /** Lead byte of that code point, which names how many bytes it needs. */
  const lead = bytes[start]
  /** How many bytes the last code point requires (1 when it is not a valid lead byte). */
  const width = lead >= 0xc2 && lead <= 0xdf ? 2 : lead >= 0xe0 && lead <= 0xef ? 3 : lead >= 0xf0 && lead <= 0xf4 ? 4 : 1
  /** The bytes that form whole code points only. */
  const complete = start >= 0 && width > bytes.length - start ? bytes.subarray(0, start) : bytes
  return truncateUtf8(new TextDecoder().decode(complete), MAX_STDERR_BYTES)
}

/**
 * Run one `sg` invocation and collect its NDJSON records under the declared budgets.
 *
 * Resolves for every run that produced a readable stream — including a run that was stopped by a
 * cap, which is reported through `truncated`/`reason` rather than as an error. Rejects with
 * {@link SgRunnerError} for abort, timeout, an unreadable stream, and a `sg` exit that reports a
 * real failure (exit 0 and 1 are the two "the search ran" codes; exit 1 with an error diagnostic on
 * stderr is a failure).
 * @param input - the executable, argv, working directory and budgets of this run
 * @returns the collected records plus the truncation, stderr and timing facts
 */
export async function spawnSgRunner(input: SgRunnerInput): Promise<SgRunnerResult> {
  /** Wall-clock start, used for every reported duration. */
  const startedAt = performance.now()
  if (input.signal?.aborted) throw new SgRunnerError("ABORTED", "ast-grep request was aborted")

  return await new Promise<SgRunnerResult>((resolve, reject) => {
    /** Record cap of this run. */
    const maxMatches = input.maxMatches ?? DEFAULT_MATCHES
    /** The child process running `sg`. */
    const child = spawn(input.sgPath, [...input.args], {
      cwd: input.workdir,
      env: input.env,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    })
    /** Records parsed so far, in stream order. */
    const records: Record<string, unknown>[] = []
    /** Running size of `[` + the serialized records + separators + `]`, in bytes. */
    let serializedRecordsBytes = 2
    /** stderr chunks kept so far (capped at {@link MAX_STDERR_BYTES} in total). */
    const stderrChunks: Buffer[] = []
    /** Bytes of stderr kept so far. */
    let stderrBytes = 0
    /** The current stderr line's prefix, scanned for an error diagnostic. */
    let stderrLinePrefix = ""
    /** Whether stderr carried a line that starts with `ERROR` or `error:`. */
    let hasSgErrorDiagnostic = false
    /** Bytes of the current stdout line that have not been terminated by a newline yet. */
    let pending = Buffer.alloc(0)
    /** Whether any stdout line failed to parse as a JSON object. */
    let malformed = false
    /** The first fatal stream error, which wins over a later one. */
    let fatalError: SgRunnerErrorCode | null = null
    /** Why the run was stopped early, or null while it is still running. */
    let stopReason: "abort" | "limit" | "timeout" | null = null
    /** Which cap stopped a limited run. */
    let truncationReason: Exclude<SgTruncationReason, "sg_output_truncated" | null> | null = null
    /** SIGKILL escalation timer, armed after a SIGTERM. */
    let killTimer: ReturnType<typeof setTimeout> | undefined
    /** Whether the promise has already settled, so the second event is ignored. */
    let settled = false

    /** Milliseconds elapsed since this run started. */
    const duration = (): number => Math.max(0, Math.round(performance.now() - startedAt))
    /** The stderr text captured so far, decoded and capped. */
    const stderrText = (): string => decodeStderr(Buffer.concat(stderrChunks))
    /**
     * Stop the child at most once, recording why.
     * @param reason - the first reason the run must stop
     */
    const stop = (reason: Exclude<typeof stopReason, null>): void => {
      if (stopReason === null) stopReason = reason
      if (child.exitCode !== null || child.signalCode !== null) return
      if (process.platform === "win32") {
        child.kill()
        return
      }
      child.kill("SIGTERM")
      killTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL")
      }, 1_000)
      killTimer.unref()
    }
    /**
     * Record the first fatal stream error and stop the child.
     * @param code - the taxonomy code of the unreadable stream
     */
    const failOutput = (code: SgRunnerErrorCode): void => {
      fatalError ??= code
      stop("limit")
    }
    /**
     * Consume one complete stdout line.
     * @param line - the line's bytes, without its trailing newline
     * @returns false when the caller must stop feeding lines (a cap or a fatal stream error)
     */
    const parseLine = (line: Buffer): boolean => {
      /** The line without a trailing carriage return, which `sg` never means literally. */
      const value = line.length > 0 && line[line.length - 1] === 13 ? line.subarray(0, -1) : line
      if (value.length === 0) return true
      if (value.length > MAX_JSON_RECORD_BYTES) {
        failOutput("OUTPUT_TOO_LARGE")
        return false
      }
      /** The decoded line, or a fatal ENCODING_ERROR when it is not valid UTF-8. */
      let text: string
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(value)
      } catch {
        failOutput("ENCODING_ERROR")
        return false
      }
      try {
        /** The parsed record; anything that is not a plain object is malformed. */
        const parsed: unknown = JSON.parse(text)
        if (!isRecord(parsed)) throw new Error("record is not an object")
        /** The record's own serialized size, which the aggregate budget counts. */
        const serializedBytes = Buffer.byteLength(JSON.stringify(parsed), "utf8")
        /** The aggregate size this record would bring the payload to. */
        const nextAggregateBytes = serializedRecordsBytes + serializedBytes + (records.length > 0 ? 1 : 0)
        if (nextAggregateBytes > MAX_MCP_PAYLOAD_BYTES) {
          truncationReason = "output_cap"
          stop("limit")
          child.stdout.pause()
          return false
        }
        records.push(parsed)
        serializedRecordsBytes = nextAggregateBytes
        if (records.length > maxMatches) {
          records.length = maxMatches
          truncationReason = "match_limit"
          stop("limit")
          child.stdout.pause()
          return false
        }
      } catch {
        malformed = true
      }
      return true
    }

    /** Whole-call deadline for the child. */
    const timeout = setTimeout(() => stop("timeout"), input.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    timeout.unref()
    /** Abort listener that stops the child when the request is cancelled. */
    const onAbort = (): void => stop("abort")
    input.signal?.addEventListener("abort", onAbort, { once: true })

    child.stdout.on("data", (chunk: Buffer) => {
      if (stopReason === "limit") return
      pending = Buffer.concat([pending, chunk])
      /** Offset of the next newline in the pending buffer, or -1. */
      let newline = pending.indexOf(10)
      while (newline >= 0) {
        /** One complete line, without its newline. */
        const line = pending.subarray(0, newline)
        pending = pending.subarray(newline + 1)
        if (!parseLine(line)) return
        newline = pending.indexOf(10)
      }
      if (pending.length > MAX_JSON_RECORD_BYTES) failOutput("OUTPUT_TOO_LARGE")
    })
    child.stderr.on("data", (chunk: Buffer) => {
      if (!hasSgErrorDiagnostic) {
        for (const byte of chunk) {
          if (byte === 10 || byte === 13) {
            stderrLinePrefix = ""
          } else if (stderrLinePrefix.length < 80) {
            stderrLinePrefix += String.fromCharCode(byte)
            if (/^[\t ]*(?:ERROR\b|error:)/.test(stderrLinePrefix)) hasSgErrorDiagnostic = true
          }
        }
      }
      /** stderr budget left after what has already been kept. */
      const remaining = MAX_STDERR_BYTES - stderrBytes
      if (remaining <= 0) return
      /** The part of this chunk that fits the budget. */
      const kept = chunk.subarray(0, remaining)
      stderrChunks.push(kept)
      stderrBytes += kept.length
    })
    child.once("error", (error: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      if (killTimer) clearTimeout(killTimer)
      input.signal?.removeEventListener("abort", onAbort)
      reject(new SgRunnerError("SG_FAILED", error.message, stderrText(), duration()))
    })
    child.once("close", (exitCode: number | null) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      if (killTimer) clearTimeout(killTimer)
      input.signal?.removeEventListener("abort", onAbort)
      /** The stderr text as of the child's exit. */
      const stderr = stderrText()
      if (stopReason === "abort") return reject(new SgRunnerError("ABORTED", "ast-grep request was aborted", stderr, duration()))
      if (stopReason === "timeout") return reject(new SgRunnerError("TIMEOUT", "ast-grep request timed out", stderr, duration()))
      if (fatalError) return reject(new SgRunnerError(fatalError, "ast-grep output could not be read safely", stderr, duration()))
      if (stopReason !== "limit" && pending.length > 0) parseLine(pending)
      if (fatalError) return reject(new SgRunnerError(fatalError, "ast-grep output could not be read safely", stderr, duration()))
      /** Whether the exit code is a failure rather than `sg`'s "nothing matched" (1). */
      const failedExit = exitCode !== 0 && exitCode !== 1
      /** Whether exit 1 came with an error diagnostic, which makes it a failure. */
      const diagnosedExitOne = exitCode === 1 && hasSgErrorDiagnostic
      if (stopReason === null && (failedExit || diagnosedExitOne)) {
        return reject(new SgRunnerError("SG_FAILED", `ast-grep exited with code ${exitCode ?? "unknown"}`, stderr, duration()))
      }
      if (malformed && records.length === 0) return reject(new SgRunnerError("OUTPUT_PARSE_FAILED", "ast-grep produced no parseable JSON records", stderr, duration()))
      /** Whether a cap (rather than malformed output) left the record set incomplete. */
      const limited = stopReason === "limit" && truncationReason !== null
      /** Whether a malformed stream was salvaged into a partial record set. */
      const salvaged = malformed && records.length > 0
      resolve({
        records,
        truncated: limited || salvaged,
        reason: limited ? truncationReason : salvaged ? "sg_output_truncated" : null,
        salvagedRecords: salvaged ? records.length : 0,
        stderr,
        durationMs: duration(),
        atLeastMatches: limited ? records.length + 1 : records.length,
        maxPayloadBytes: MAX_MCP_PAYLOAD_BYTES,
        exitCode,
      })
    })
  })
}
