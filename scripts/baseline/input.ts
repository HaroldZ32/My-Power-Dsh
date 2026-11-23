import { createHash } from "node:crypto"
import { lstatSync, readFileSync, readdirSync, type Dirent } from "node:fs"
import { join } from "node:path"

/** A decoded JSON object before field-level checks. */
export type Row = Readonly<Record<string, unknown>>

/** Accept an object without widening its properties to unchecked types. */
export function object(value: unknown): Row | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Row : undefined
}

/** Return a persisted nonempty key without normalizing executor identities. */
export function key(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined
}

/** Return a valid count or generation, including the initial generation zero. */
export function counter(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

/** Normalize the clocks used by MPD JSON records and harness events. */
export function instant(value: unknown): number | undefined {
  /** The parsed instant, bounded to the range JSON timestamps can represent. */
  const time = typeof value === "string" ? Date.parse(value) : counter(value)
  return time !== undefined && Number.isFinite(time) && Math.abs(time) <= 8.64e15 ? time : undefined
}

/** One file or directory observed during this scan. */
interface Source {
  /** Relative to the scan root. */
  readonly path: string
  /** Distinguishes unavailable inputs from malformed content read from disk. */
  readonly state: "read" | "absent" | "unreadable" | "malformed"
  /** Number of bytes consumed for a file read. */
  readonly bytes?: number
  /** Digest of the exact bytes consumed, before decoding. */
  readonly sha256?: string
  /** Diagnostic wording owned by the collector. */
  readonly reason?: string
  /** One-based JSONL location when an individual record is malformed. */
  readonly line?: number
}

/** One JSONL row with its stable file-local coordinate. */
export interface Line {
  /** Object decoded from one nonblank input line. */
  readonly row: Row
  /** One-based position before any parse failures were filtered out. */
  readonly line: number
}

/** Guard one traversal step before opening workspace evidence. */
function checkedPath(root: string, relative: string): string {
  /** Each component is checked before following the next one. */
  let current = root
  for (const component of relative.split("/")) {
    if (component === "" || component === "." || component === ".." || component.includes("\\")) throw new Error("invalid input path")
    current = join(current, component)
    if (lstatSync(current).isSymbolicLink()) throw new Error("symlink input")
  }
  return current
}

/** Accumulate reproducible input fingerprints and sanitized coverage while scanning. */
export class Inputs {
  /** Workspace-relative paths, with hashes of the exact file bytes consumed. */
  readonly sources: Source[] = []

  /** The already resolved target directory. */
  readonly root: string

  /** Bind all input operations to this workspace. */
  constructor(root: string) {
    this.root = root
  }

  /** Record a shape or parse failure without retaining free text from the input. */
  malformed(path: string, reason: string, line?: number): void {
    this.sources.push({ path, state: "malformed", reason, ...(line === undefined ? {} : { line }) })
  }

  /** Record an I/O outcome using the OS error code when available. */
  unavailable(path: string, error: unknown): void {
    /** The IO class is sufficient to explain a coverage gap. */
    const code = error instanceof Error && "code" in error ? key(error.code) : undefined
    this.sources.push(code === "ENOENT"
      ? { path, state: "absent" }
      : { path, state: "unreadable", reason: code ?? "unsupported input" })
  }

  /** Return a sorted directory listing. Absence and read failures are distinguishable in coverage. */
  directory(path: string): Dirent[] {
    try {
      /** Directory filenames are sorted for reproducible output. */
      const entries = readdirSync(checkedPath(this.root, path), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, "en"))
      this.sources.push({ path, state: "read" })
      return entries
    } catch (error) {
      this.unavailable(path, error)
      return []
    }
  }

  /** Read a regular file and hash the bytes that the parser will consume. */
  bytes(path: string): Buffer | undefined {
    try {
      /** The checked path must be a regular file so reads cannot block on a FIFO. */
      const absolute = checkedPath(this.root, path)
      if (!lstatSync(absolute).isFile()) throw new Error("non-regular input")
      /** Content and digest refer to the same read, including during an append. */
      const bytes = readFileSync(absolute)
      this.sources.push({ path, state: "read", bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") })
      return bytes
    } catch (error) {
      this.unavailable(path, error)
      return undefined
    }
  }

  /** Decode one JSON object without hiding malformed or non-object inputs. */
  json(path: string): Row | undefined {
    /** A missing or unreadable file was already registered by the byte reader. */
    const bytes = this.bytes(path)
    if (bytes === undefined) return undefined
    return this.parse(path, bytes.toString("utf8"))
  }

  /** Parse an individual object and retain its coordinate for diagnostics. */
  parse(path: string, text: string, line?: number): Row | undefined {
    try {
      /** A valid JSON scalar still fails the record contract. */
      const row = object(JSON.parse(text))
      if (row !== undefined) return row
      this.malformed(path, "expected a JSON object", line)
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error
      this.malformed(path, "invalid JSON", line)
    }
    return undefined
  }

  /** Read JSONL, recovering the complete rows before and after a bad line. */
  lines(path: string, text?: string): Line[] {
    /** A caller can supply decompressed bytes, already fingerprinted as consumed. */
    const content = text ?? this.bytes(path)?.toString("utf8")
    return content?.split("\n").flatMap((value, index) => {
      if (value.trim() === "") return []
      /** The persisted line index is not shifted by missing or malformed records. */
      const line = index + 1
      /** Errors are reported by the parser so other lines remain useful. */
      const row = this.parse(path, value, line)
      return row === undefined ? [] : [{ row, line }]
    }) ?? []
  }

  /** Check whether the current group of reads contains a known coverage gap. */
  complete(since: number, missingIsGap: boolean): boolean {
    return this.sources.slice(since).every(({ state }) => state === "read" || (state === "absent" && !missingIsGap))
  }
}
