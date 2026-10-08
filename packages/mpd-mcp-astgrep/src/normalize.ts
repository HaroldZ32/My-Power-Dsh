// normalize.ts — turn one raw `sg` NDJSON record into the stable match shape every tool publishes.
//
// The shape is the contract a consumer reads, so it is derived here ONCE: a repository-relative
// path, a 1-based line with the column `sg` itself reports, byte offsets, and the metavariables
// split into single- and multi-node captures (a multi capture is sliced out of the match text by
// byte range, because `sg` reports it as an array of nodes rather than as text).
import { posix, win32 } from "node:path"

/** One end of a match, as a 1-based line, an `sg` column and an absolute byte offset. */
export interface NormalizedPoint {
  /** 1-based line number, i.e. `sg`'s 0-based line plus one. */
  readonly line: number
  /** Column as `sg` reports it (0-based, in code points). */
  readonly column: number
  /** Absolute byte offset of this end within the file. */
  readonly byteOffset: number
}

/** A match as every payload publishes it, plus whatever extra keys the raw record carried. */
export interface NormalizedMatch extends Record<string, unknown> {
  /** Repository-relative path when it resolves inside the working directory, else absolute. */
  readonly path: string
  /** Lower-cased language, when the raw record named one. */
  readonly language?: string
  /** The matched source text. */
  readonly text: string
  /** Byte range of the match within its file. */
  readonly range: { readonly start: NormalizedPoint; readonly end: NormalizedPoint }
  /** Captured metavariables, split by cardinality. */
  readonly metavariables: {
    /** `$NAME` captures: one node each, as text. */
    readonly single: Readonly<Record<string, string>>
    /** `$$$NAME` captures: the whole span between the first and last node, as text. */
    readonly multi: Readonly<Record<string, string>>
  }
}

/**
 * Assert that a raw value is a plain object, naming the field in the error.
 * @param value - the value to check
 * @param label - the field name used in the thrown message
 * @returns the same value, typed as a record
 */
function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError(`Invalid ${label}`)
  return value as Record<string, unknown>
}

/**
 * Assert that a raw value is a finite number, naming the field in the error.
 * @param value - the value to check
 * @param label - the field name used in the thrown message
 * @returns the same value, typed as a number
 */
function number(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`Invalid ${label}`)
  return value
}

/**
 * Build one normalized point from `sg`'s `{line, column}` pair and a byte offset.
 * @param raw - the raw `{line, column}` object
 * @param byteOffset - the byte offset belonging to this end of the range
 * @returns the normalized point, with the line made 1-based
 */
function point(raw: unknown, byteOffset: unknown): NormalizedPoint {
  /** The raw point as a field table. */
  const value = object(raw, "range point")
  return {
    line: number(value.line, "line") + 1,
    column: number(value.column, "column"),
    byteOffset: number(byteOffset, "byte offset"),
  }
}

/**
 * Rewrite every backslash as a forward slash.
 * @param value - the path to rewrite
 * @returns the path with POSIX separators
 */
function slash(value: string): string {
  return value.replaceAll("\\", "/")
}

/**
 * Whether a path is spelled as a Windows absolute path.
 * @param value - the path to classify
 * @returns true for `C:\…` / `C:/…` / `\\…` spellings
 */
function isWindowsPath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\")
}

/**
 * Make a reported file path stable: relative to the working directory when it is inside it.
 * @param file - the path `sg` reported
 * @param workdir - the run's working directory
 * @returns the path relative to `workdir`, or the absolute path when it lies outside
 */
function stablePath(file: string, workdir: string): string {
  if (isWindowsPath(file) || isWindowsPath(workdir)) {
    /** The run's working directory, resolved with the win32 rules. */
    const root = win32.resolve(workdir)
    /** The reported file, resolved against that root. */
    const absolute = win32.resolve(root, file)
    /** The file relative to the root. */
    const relative = win32.relative(root, absolute)
    /** Whether that relative path stays inside the root. */
    const inside = relative === "" || (!relative.startsWith("..\\") && relative !== ".." && !win32.isAbsolute(relative))
    return slash(inside ? relative || "." : absolute)
  }
  /** The run's working directory, resolved with the POSIX rules. */
  const root = posix.resolve(workdir)
  /** The reported file, resolved against that root. */
  const absolute = posix.resolve(root, file)
  /** The file relative to the root. */
  const relative = posix.relative(root, absolute)
  /** Whether that relative path stays inside the root. */
  const inside = relative === "" || (!relative.startsWith("../") && relative !== ".." && !posix.isAbsolute(relative))
  return inside ? relative || "." : absolute
}

/**
 * Read a metavariable's text, whether `sg` reported a string or a node object.
 * @param value - the raw metavariable value
 * @returns the captured text, or "" when it cannot be read
 */
function nodeText(value: unknown): string {
  if (typeof value === "string") return value
  /** The raw value as a node object. */
  const node = object(value, "metavariable node")
  return typeof node.text === "string" ? node.text : ""
}

/**
 * Read the byte range of one captured node, when the record carries one.
 * @param value - the raw metavariable node
 * @returns the node's `{start, end}` byte offsets, or null when they are absent
 */
function nodeByteRange(value: unknown): { start: number; end: number } | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null
  /** The node's `range` field as a field table. */
  const range = object((value as Record<string, unknown>).range, "metavariable range")
  /** The `range.byteOffset` field as a field table. */
  const bytes = object(range.byteOffset, "metavariable byte range")
  return typeof bytes.start === "number" && typeof bytes.end === "number"
    ? { start: bytes.start, end: bytes.end }
    : null
}

/**
 * Split a record's metavariables into single-node text and multi-node spans.
 * @param raw - the record's `metaVariables` value, when present
 * @param text - the match text, which a multi capture is sliced out of
 * @param matchStart - the match's absolute start byte, the origin of that slice
 * @returns the single and multi capture tables
 */
function normalizeMetavariables(raw: unknown, text: string, matchStart: number): { single: Record<string, string>; multi: Record<string, string> } {
  /** The `metaVariables` object, or an empty one when the record carries none. */
  const meta = raw === undefined ? {} : object(raw, "metaVariables")
  /** The `single` table, or an empty one. */
  const singles = meta.single === undefined ? {} : object(meta.single, "single metavariables")
  /** The `multi` table, or an empty one. */
  const multis = meta.multi === undefined ? {} : object(meta.multi, "multi metavariables")
  /** Single-node captures, as text. */
  const single: Record<string, string> = {}
  /** Multi-node captures, as the text span they cover. */
  const multi: Record<string, string> = {}
  for (const [name, value] of Object.entries(singles)) single[name] = nodeText(value)
  for (const [name, value] of Object.entries(multis)) {
    if (!Array.isArray(value) || value.length === 0) {
      multi[name] = ""
      continue
    }
    /** Byte range of the capture's first node. */
    const first = nodeByteRange(value[0])
    /** Byte range of the capture's last node. */
    const last = nodeByteRange(value[value.length - 1])
    /** The match text as bytes, which the capture is sliced out of. */
    const bytes = Buffer.from(text, "utf8")
    /** Start of the span, relative to the match. */
    const start = (first?.start ?? matchStart) - matchStart
    /** End of the span, relative to the match. */
    const end = (last?.end ?? matchStart) - matchStart
    multi[name] = start >= 0 && end >= start && end <= bytes.length
      ? new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(start, end))
      : value.map(nodeText).join("")
  }
  return { single, multi }
}

/**
 * Normalize one raw `sg` record, preserving any extra keys the record carried.
 * @param rawValue - the parsed NDJSON record
 * @param workdir - the run's working directory, used to make the path relative
 * @returns the normalized match
 */
export function normalizeMatch(rawValue: Record<string, unknown>, workdir: string): NormalizedMatch {
  /** The record as a field table. */
  const raw = object(rawValue, "ast-grep record")
  /** The matched text, or "" when the record omitted it. */
  const text = typeof raw.text === "string" ? raw.text : ""
  /** The reported file path, or "" when the record omitted it. */
  const file = typeof raw.file === "string" ? raw.file : ""
  /** The record's `range` field as a field table. */
  const range = object(raw.range, "range")
  /** The record's `range.byteOffset` field as a field table. */
  const bytes = object(range.byteOffset, "byte range")
  /** Start byte of the match, the origin of a multi-capture slice. */
  const startByte = number(bytes.start, "start byte offset")
  /** The normalized match, built so extra record keys can be appended in their own order. */
  const normalized: Record<string, unknown> = {
    path: stablePath(file, workdir),
    ...(typeof raw.language === "string" ? { language: raw.language.toLowerCase() } : {}),
    text,
    range: {
      start: point(range.start, startByte),
      end: point(range.end, number(bytes.end, "end byte offset")),
    },
    metavariables: normalizeMetavariables(raw.metaVariables, text, startByte),
  }
  /** Raw keys this normalizer already consumed, so they are never copied twice. */
  const consumed = new Set(["text", "range", "file", "lines", "language", "metaVariables", "charCount", "transformed"])
  for (const [key, value] of Object.entries(raw)) if (!consumed.has(key)) normalized[key] = value
  return normalized as NormalizedMatch
}

/**
 * Normalize every record and order the result by path, then by start byte.
 * @param records - the raw records of one run
 * @param workdir - the run's working directory
 * @returns the normalized, ordered matches
 */
export function normalizeRecords(records: readonly Record<string, unknown>[], workdir: string): NormalizedMatch[] {
  return records
    .map((record) => normalizeMatch(record, workdir))
    .sort((left, right) => {
      /** Order of the two paths, which decides the result before any byte offset is compared. */
      const pathOrder = left.path < right.path ? -1 : left.path > right.path ? 1 : 0
      return pathOrder || left.range.start.byteOffset - right.range.start.byteOffset
    })
}
