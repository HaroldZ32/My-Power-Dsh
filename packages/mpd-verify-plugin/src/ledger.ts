// THE VERIFICATION LEDGER — the durable side of the law, plus the in-memory state a guard needs.
//
// Layout under `<workspace>/.mpd/verify/` (spec (b), frozen):
//   loops/<loopId>.json      one ARMED delegation+verification loop
//   records/<recordId>.json  one validated verification record
//   evidence/<id>.json|.log  one gate run, or one content-free artifact probe
//   seats.json               which agent key is bound to which loop as the VERIFIER seat
//   repairs/<repairId>.json  the standalone repair task a FAIL opened without a team
//   escape.jsonl             the COUNTED escapes, append-only, one JSON object per line
//
// WHY A WORKSPACE-SCOPED FILE STORE AND NOT A SERVICE. Every consumer of this state is either a tool
// call or a guard call, both of which already resolve the workspace root per call (AGENTS.md §6), and a
// record has to outlive the process that wrote it — the captain may restart between writing code and
// verifying it. The directory is under `.mpd/`, which the classifier treats as ALWAYS WRITABLE, so the
// ledger can never be gated by its own law.
//
// NOTHING HERE IS CACHED AT MODULE LEVEL except {@link VerifyRuntime}, whose state is deliberately
// process-local (an escape allowance is consumed by the next write; an observation is what the guard
// saw). It is published as the `mpdVerify` SERVICE, and that matters: `bun build` INLINES imported
// modules, so a module-level singleton imported by two packages would produce TWO copies and the
// roles-plugin guard would read an allowance that `mpd_verify_escape` never wrote.
import { createHash, randomBytes } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"

/** One loop's writer seat. */
export interface LoopWriter {
  /** `self` means the captain writes (COUNTED and visible); `delegate` means a member does. */
  kind: "self" | "delegate"
  /** The writer's agent key; for a delegated loop opened by the observer, the delegate is named later. */
  id: string
  /** Why the captain is writing its own code — REQUIRED for `self`, echoed in every report. */
  reason?: string
}

/** One loop's verifier seat. */
export interface LoopVerifier {
  /** The verifier's agent key; the literal `unbound` until a seat binds. */
  id: string
  /** ISO instant a seat bound itself to this loop, when one has. */
  boundAt?: string
}

/** One delegation+verification loop. */
export interface VerifyLoop {
  /** Format version. */
  version: 1
  /** mpd-minted loop id. */
  loopId: string
  /** The board task this loop verifies, when it verifies one. */
  taskId: string | null
  /**
   * The wave contract THIS loop was opened against, workspace-relative — what its verifier is handed.
   *
   * ADDITIVE, and OPTIONAL on purpose: a loop file written by an older revision carries no such field,
   * and an absent one means "the declared default" (`DEFAULT_CONTRACT_PATH` in `law.ts`) rather than
   * "no basis". It is recorded per loop because the hardcoded pair this field replaces handed every
   * later wave the PREVIOUS wave's plan.
   */
  contract?: string
  /** The workspace the loop belongs to. */
  workspace: string
  /** The agent key the loop belongs to (the captain's session, for a self-writer loop). */
  sessionId: string
  /** Who writes. */
  writer: LoopWriter
  /** Who verifies. */
  verifier: LoopVerifier
  /** The scopes the loop authorises; EMPTY means the whole workspace. */
  scope: string[]
  /** Only `armed` authorises anything; `closed` is terminal. */
  status: "armed" | "closed"
  /** How the loop came to exist: an explicit tool call, or the observer seeing a delegation. */
  openedVia: "tool" | "observer"
  /** ISO instant the loop was opened. */
  createdAt: string
  /** ISO instant after which the loop authorises nothing. */
  expiresAt: string
}

/** One bound VERIFIER seat: which loop, and how far the ratchet has turned. */
export interface VerifySeat {
  /** The loop the seat verifies. */
  loopId: string
  /** The verifier's agent key; equal to the seat file's key. */
  verifierId: string
  /** True once a recorded FAIL unlocked implementation reading for diagnosis (the ratchet). */
  unlocked: boolean
  /** ISO instant the unlock happened, when it did. */
  unlockedAt?: string
  /** The record whose FAIL opened the window. */
  unlockedBy?: string
  /** The documents the seat may always read: the loop's frozen basis, workspace-relative. */
  docPaths: string[]
}

/** The seat file's content: every bound seat, keyed by the verifier's agent key. */
export interface SeatFile {
  /** Format version. */
  version: 1
  /** The seats, keyed by agent key. */
  seats: Record<string, VerifySeat>
}

/** One counted escape, as the JSONL row records it. */
export interface EscapeRow {
  /** Format version. */
  version: 1
  /** ISO instant the escape was taken. */
  at: string
  /** The agent key that took it. */
  sessionId: string
  /** The caller's stated reason — required, because an unexplained escape is indistinguishable from a bug. */
  reason: string
  /** The path the caller said it needed, when it said one. */
  path?: string
  /** The 1-based ordinal of this escape for its session, so a report can say "escape 2/3". */
  count: number
}

/** What one gate run produced on disk. */
export interface EvidenceMeta {
  /** Format version. */
  version: 1
  /** The evidence id. */
  evidenceId: string
  /** The loop it belongs to; `probe` runs are not bound to a loop. */
  loopId: string | null
  /** `gate` for a whitelisted command run, `probe` for a content-free artifact reading. */
  kind: "gate" | "probe"
  /** The exact command line for a gate run; absent for a probe. */
  cmd?: string
  /** The exit code for a gate run; absent for a probe. */
  exit?: number
  /** ISO instant the evidence was produced. */
  at: string
  /** The log's path, relative to the workspace root, for a gate run. */
  logPath?: string
  /** The log's sha256, for a gate run. */
  logSha256?: string
  /** The artifact readings, for a probe. */
  probe?: Array<{ path: string; bytes: number; sha256: string; mtime: string }>
}

/** One standalone repair task, opened when a FAIL has no team to write to. */
export interface RepairTask {
  /** Format version. */
  version: 1
  /** The repair's id. */
  repairId: string
  /** The record whose FAIL opened it. */
  sourceRecordId: string
  /** The board task the failed work came from, when the loop named one. */
  sourceTaskId: string | null
  /** The finding ids the repair must address. */
  sourceFindingIds: string[]
  /** The summary a writer reads first. */
  summary: string
  /** The agent the repair is addressed to. */
  writerId: string
  /** Open until a later PASS closes it. */
  status: "open"
  /** ISO instant. */
  createdAt: string
}

/** The root of the law's state for one workspace. */
export function verifyRoot(workspace: string): string {
  return join(workspace, ".mpd", "verify")
}

/** The directory holding this workspace's loops. */
export function loopsDir(workspace: string): string {
  return join(verifyRoot(workspace), "loops")
}

/** The directory holding this workspace's verification records. */
export function recordsDir(workspace: string): string {
  return join(verifyRoot(workspace), "records")
}

/** The directory holding this workspace's gate evidence and probes. */
export function evidenceDir(workspace: string): string {
  return join(verifyRoot(workspace), "evidence")
}

/** The directory holding this workspace's standalone repairs. */
export function repairsDir(workspace: string): string {
  return join(verifyRoot(workspace), "repairs")
}

/** The seat file's path. */
export function seatsPath(workspace: string): string {
  return join(verifyRoot(workspace), "seats.json")
}

/** The escape log's path. */
export function escapePath(workspace: string): string {
  return join(verifyRoot(workspace), "escape.jsonl")
}

/**
 * Create one directory, and every parent, without ever throwing.
 *
 * A ledger that cannot be created must not take a tool call down: the caller reads the boolean and
 * reports the degradation, which is the same discipline every other mpd store follows.
 *
 * @param dir - the absolute directory path.
 * @returns true when the directory exists afterwards.
 */
export function ensureDir(dir: string): boolean {
  try { mkdirSync(dir, { recursive: true }); return true } catch { return false }
}

/**
 * Read one JSON file, or `undefined` when it is absent or unparsable.
 *
 * A corrupt half-written record must read as ABSENT rather than as a crash: the guard's job is to deny,
 * not to bring the process down, and the record's own validator refuses anything malformed.
 *
 * @param path - the absolute file path.
 * @returns the parsed value, or `undefined`.
 */
export function readJson<T>(path: string): T | undefined {
  try {
    if (!existsSync(path)) return undefined
    return JSON.parse(readFileSync(path, "utf8")) as T
  } catch { return undefined }
}

/**
 * Write one JSON file atomically (temp file + rename), creating its directory.
 *
 * @param path - the absolute file path.
 * @param value - the value to serialise.
 * @returns true when the write landed.
 */
export function writeJsonAtomic(path: string, value: unknown): boolean {
  try {
    ensureDir(join(path, ".."))
    /** The temporary sibling, so a reader never observes a half-written file. */
    const tmp = path + ".tmp-" + randomBytes(4).toString("hex")
    writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n", "utf8")
    renameSync(tmp, path)
    return true
  } catch { return false }
}

/**
 * List every `*.json` file in one directory, parsed, sorted by file name.
 *
 * @param dir - the absolute directory path.
 * @returns the parsed values; an absent directory lists as empty, never as an error.
 */
export function listJson<T>(dir: string): T[] {
  /** The parsed values, accumulated in file-name order. */
  const values: T[] = []
  try {
    if (!existsSync(dir)) return values
    for (const name of readdirSync(dir).filter((entry) => entry.endsWith(".json")).sort()) {
      /** This file's parsed content; a malformed file is skipped rather than fatal. */
      const value = readJson<T>(join(dir, name))
      if (value !== undefined) values.push(value)
    }
  } catch { /* an unreadable directory lists as empty */ }
  return values
}

/**
 * Mint a filesystem-safe, sortable, unique id.
 *
 * The instant makes a directory listing readable in time order and the random suffix makes two ids
 * minted in the same millisecond distinct — the property a record store needs and a bare timestamp
 * does not have.
 *
 * @param prefix - the id's family (`loop`, `rec`, `ev`, `rep`).
 * @returns the id.
 */
export function mintId(prefix: string): string {
  /** The UTC instant, compacted to `YYYYMMDDTHHMMSSmmm`. */
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z").replace("Z", "")
  return prefix + "-" + stamp + "-" + randomBytes(3).toString("hex")
}

/**
 * The sha256 of one file's bytes, or the empty string when it cannot be read.
 *
 * @param path - the absolute file path.
 * @returns the lowercase hex digest.
 */
export function sha256File(path: string): string {
  try {
    if (!existsSync(path) || !statSync(path).isFile()) return ""
    return createHash("sha256").update(readFileSync(path)).digest("hex")
  } catch { return "" }
}

/**
 * The sha256 of a string's UTF-8 bytes.
 *
 * @param text - the text to hash.
 * @returns the lowercase hex digest.
 */
export function sha256Text(text: string): string {
  return createHash("sha256").update(String(text ?? ""), "utf8").digest("hex")
}

/**
 * Hash one document, as a `{path, sha256}` pair.
 *
 * @param workspace - the workspace root, used to spell the path relatively when it is inside it.
 * @param path - the absolute document path.
 * @returns the hashed document, or `undefined` when the file cannot be read.
 */
export function hashDoc(workspace: string, path: string): { path: string; sha256: string } | undefined {
  /** The digest, or `""` when the file is unreadable. */
  const digest = sha256File(path)
  if (digest === "") return undefined
  /** The workspace-relative spelling when the document is inside the workspace. */
  const rel = path.startsWith(workspace + "/") ? path.slice(workspace.length + 1) : path
  return { path: rel, sha256: digest }
}

/** Read every loop this workspace knows. */
export function readLoops(workspace: string): VerifyLoop[] {
  return listJson<VerifyLoop>(loopsDir(workspace))
}

/** Persist one loop, replacing the file with its id. */
export function writeLoop(workspace: string, loop: VerifyLoop): boolean {
  return writeJsonAtomic(join(loopsDir(workspace), loop.loopId + ".json"), loop)
}

/** Read every verification record this workspace knows, oldest first. */
export function readRecords(workspace: string): VerificationRecordView[] {
  return listJson<VerificationRecordView>(recordsDir(workspace))
}

/**
 * The record fields the ledger reads back.
 *
 * Deliberately a LOCAL structural view rather than an import of `record.ts`'s type: this module is
 * loaded by the guard, and a guard that pulled the whole validator in would pay for it on every tool
 * call in the process.
 */
export interface VerificationRecordView {
  /** The record id. */
  recordId: string
  /** The loop it belongs to. */
  loopId: string
  /** The writer seat. */
  writerId: string
  /** The verifier seat. */
  verifierId: string
  /** The verdict. */
  verdict: string
  /** ISO instant. */
  createdAt: string
}

/** Persist one record. */
export function writeRecord(workspace: string, record: { recordId: string }): boolean {
  return writeJsonAtomic(join(recordsDir(workspace), record.recordId + ".json"), record)
}

/** Persist one piece of evidence metadata plus its log, in one call. */
export function writeEvidence(workspace: string, meta: EvidenceMeta, log?: string): boolean {
  /** Whether the metadata landed; the log is written first so a reader never sees metadata without it. */
  const wroteLog = log === undefined ? true : (() => {
    try {
      ensureDir(evidenceDir(workspace))
      writeFileSync(join(evidenceDir(workspace), meta.evidenceId + ".log"), log, "utf8")
      return true
    } catch { return false }
  })()
  return writeJsonAtomic(join(evidenceDir(workspace), meta.evidenceId + ".json"), meta) && wroteLog
}

/** Read every evidence metadata row this workspace knows. */
export function readEvidence(workspace: string): EvidenceMeta[] {
  return listJson<EvidenceMeta>(evidenceDir(workspace))
}

/** Persist one standalone repair task. */
export function writeRepair(workspace: string, repair: RepairTask): boolean {
  return writeJsonAtomic(join(repairsDir(workspace), repair.repairId + ".json"), repair)
}

/** Read the seat file, defaulting to an empty one. */
export function readSeats(workspace: string): SeatFile {
  return readJson<SeatFile>(seatsPath(workspace)) ?? { version: 1, seats: {} }
}

/** Persist the seat file. */
export function writeSeats(workspace: string, seats: SeatFile): boolean {
  return writeJsonAtomic(seatsPath(workspace), seats)
}

/**
 * Append one escape row to the JSONL log and return the row with its ordinal.
 *
 * The count is derived from the log itself rather than from memory, so "escape 3/1" cannot be reported
 * by a process that restarted between two escapes.
 *
 * @param workspace - the workspace root.
 * @param sessionId - the agent key taking the escape.
 * @param reason - the caller's stated reason.
 * @param path - the path the caller said it needed, when it said one.
 * @returns the appended row, or `undefined` when the log could not be written.
 */
export function appendEscape(workspace: string, sessionId: string, reason: string, path?: string): EscapeRow | undefined {
  /** The rows already of record for this session, which is what the ordinal counts. */
  const prior = readEscapes(workspace).filter((row) => row.sessionId === sessionId).length
  /** The row to append. */
  const row: EscapeRow = {
    version: 1,
    at: new Date().toISOString(),
    sessionId,
    reason,
    count: prior + 1,
    ...(path === undefined ? {} : { path }),
  }
  try {
    ensureDir(verifyRoot(workspace))
    writeFileSync(escapePath(workspace), JSON.stringify(row) + "\n", { encoding: "utf8", flag: "a" })
    return row
  } catch { return undefined }
}

/** Read every escape row, in append order; a malformed line is skipped, never fatal. */
export function readEscapes(workspace: string): EscapeRow[] {
  /** The parsed rows. */
  const rows: EscapeRow[] = []
  try {
    if (!existsSync(escapePath(workspace))) return rows
    for (const line of readFileSync(escapePath(workspace), "utf8").split("\n")) {
      if (line.trim() === "") continue
      try { rows.push(JSON.parse(line) as EscapeRow) } catch { /* one bad line never voids the log */ }
    }
  } catch { /* an unreadable log reads as empty */ }
  return rows
}
