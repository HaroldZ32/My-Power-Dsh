// The worktree state file: `<ws>/.mpd/worktrees/index.json`, version 1.
//
// Two properties matter and both are tested:
//   * ATOMIC WRITE — a temp file in the SAME directory then `rename`, so a crash never leaves a
//     half-written index a later read would misparse.
//   * TOLERANT READ — a corrupt or absent file reads as an EMPTY index, never a throw: a damaged
//     state file must not wedge every worktree operation.
//
// The in-process lock is a RE-ENTRANCY guard, not a queue: every mutation below is a synchronous
// spawnSync sequence, so the event loop cannot interleave two of them. The guard still matters because
// a future async step would otherwise race, and because it makes the critical section explicit.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"

/** The lifecycle of one recorded worktree. */
export type WorktreeStatus = "active" | "merged" | "removed"

/** One worktree the row knows about; the record is the durable truth, git is the live truth. */
export interface WorktreeEntry {
  /** The identity the contract fixes: `<teamId>/<member>` for team members, `manual/<name>` otherwise. */
  key: string
  /** The display/addressable name the tools accept. */
  name: string
  /** The team that owns the worktree, when one does. */
  teamId?: string
  /** The member that owns the worktree, when one does. */
  member?: string
  /** The repository the worktree belongs to (git's canonical toplevel). */
  repo: string
  /** The absolute worktree directory. */
  path: string
  /** The branch created for the worktree. */
  branch: string
  /** The ref/SHA the branch started from. */
  base: string
  /** ISO timestamp of the creation. */
  createdAt: string
  /** Where the worktree stands in its lifecycle. */
  status: WorktreeStatus
  /** True when the directory is gone but the branch could not be deleted yet; a later remove retries it. */
  branchPending?: boolean
}

/** The whole state file. */
export interface WorktreeIndex {
  /** Schema version; the row only reads and writes version 1. */
  version: 1
  /** Every record the row has created, including tombstones. */
  worktrees: WorktreeEntry[]
}

/** An empty, well-formed index — the answer for a missing or unreadable file. */
export function emptyIndex(): WorktreeIndex {
  return { version: 1, worktrees: [] }
}

/**
 * Whether a parsed value is a well-formed record. A malformed record is DROPPED (tolerance is about
 * surviving damage, not about trusting it).
 * @param value one `worktrees[]` element.
 * @returns true when every required field has the right type and the status is one of the three.
 */
function isEntry(value: unknown): value is WorktreeEntry {
  if (value === null || typeof value !== "object") return false
  /** The record viewed as an open bag, so each field is narrowed on its own. */
  const record = value as Record<string, unknown>
  /** The three statuses a record may carry. */
  const statuses: readonly string[] = ["active", "merged", "removed"]
  return (
    typeof record.key === "string" &&
    typeof record.name === "string" &&
    typeof record.repo === "string" &&
    typeof record.path === "string" &&
    typeof record.branch === "string" &&
    typeof record.base === "string" &&
    typeof record.createdAt === "string" &&
    typeof record.status === "string" &&
    statuses.includes(record.status) &&
    (record.teamId === undefined || typeof record.teamId === "string") &&
    (record.member === undefined || typeof record.member === "string") &&
    (record.branchPending === undefined || typeof record.branchPending === "boolean")
  )
}

/**
 * Reads the index, tolerating absence and corruption.
 * @param file the absolute index path.
 * @returns the parsed index, or an empty index when the file is absent, unparsable or misshapen.
 */
export function readIndex(file: string): WorktreeIndex {
  try {
    /** The file's raw text; the try/catch below covers the read as well as the parse. */
    const text = readFileSync(file, "utf8")
    /** The parsed JSON value, narrowed to the bag shape before any field is read. */
    const parsed: unknown = JSON.parse(text)
    if (parsed === null || typeof parsed !== "object") return emptyIndex()
    /** The `worktrees` array, which is the only field this loader trusts. */
    const list = (parsed as { worktrees?: unknown }).worktrees
    if (!Array.isArray(list)) return emptyIndex()
    return { version: 1, worktrees: list.filter((entry): entry is WorktreeEntry => isEntry(entry)) }
  } catch {
    return emptyIndex()
  }
}

/**
 * Writes the index atomically (temp file in the same directory, then rename).
 * @param file the absolute index path; its parent directory is created when missing.
 * @param index the index to persist.
 * @returns nothing; a write failure throws, because a mutation that cannot be recorded must not look done.
 */
export function writeIndex(file: string, index: WorktreeIndex): void {
  mkdirSync(dirname(file), { recursive: true })
  /** A sibling temp name: `rename` is atomic only within one filesystem, so it must share the directory. */
  const temp = file + "." + process.pid + "." + Date.now() + ".tmp"
  writeFileSync(temp, JSON.stringify(index, null, 2) + "\n", "utf8")
  renameSync(temp, file)
}

/** The in-process critical sections, keyed by state-file path. */
const heldLocks = new Set<string>()

/**
 * Runs one mutation inside the state file's in-process critical section.
 * @param file the absolute index path that identifies the lock.
 * @param body the mutation; its return value is passed through.
 * @returns whatever `body` returned.
 */
export function withLock<T>(file: string, body: () => T): T {
  if (heldLocks.has(file)) throw new Error("[mpd-worktree] internal: re-entrant worktree state mutation for " + file)
  heldLocks.add(file)
  try {
    return body()
  } finally {
    heldLocks.delete(file)
  }
}

/**
 * Whether a state file already exists — used only for the boot line, never for a decision.
 * @param file the absolute index path.
 * @returns true when the file is present.
 */
export function indexExists(file: string): boolean {
  return existsSync(file)
}
