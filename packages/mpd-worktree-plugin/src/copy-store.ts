import { randomUUID } from "node:crypto"
import { mkdirSync, readdirSync, readFileSync, renameSync, rmdirSync, statfsSync, lstatSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { OBJECT_ID, directoryId, pathExists } from "./copy-git.ts"
import { WorktreeError } from "./ops.ts"
import { canonicalPath, isValidName } from "./paths.ts"

/** A fixed deadline for allocating a copy while its board attempt remains active. */
export const COPY_APPROVAL_MS = 24 * 60 * 60 * 1000

/** Filesystem-safe identifier used for immutable copy-request filenames. */
const COPY_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** A disk fingerprint is represented as two untruncated decimal integers. */
const FILE_ID = /^\d+:\d+$/

/** States that may be restored from disk by a retried tool call. */
const PHASES = ["requested", "approved", "declined", "creating", "ready", "integrated", "disposing", "disposed"] as const

/** The durable authorization and size reservation for one board attempt. */
export interface CopyRecord {
  /** Request id, also used to derive the private staging path. */
  readonly id: string
  /** Stable project identity returned by native authorization. */
  readonly projectId: string
  /** Board on which the original active assignment was claimed. */
  readonly teamId: string
  /** Assignment ID within that board. */
  readonly taskId: string
  /** Claim counter, to detect revocation or reassignment. */
  readonly attempt: number
  /** Durable member identity, independent of session activation. */
  readonly memberId: string
  /** Original board's spelling of the owner. */
  readonly memberName: string
  /** Native activation that was assigned and submitted the commit. */
  readonly writerSession: string
  /** Canonical project checkout that supplies committed objects. */
  readonly source: string
  /** Full object ID of the approved starting commit. */
  readonly base: string
  /** Path segment allocated within the copy directory. */
  readonly destination: string
  /** Explicit requested paths, subset of the existing board scopes. */
  readonly scope: readonly string[]
  /** Member's explanation of why a linked worktree is unsuitable. */
  readonly reason: string
  /** Setup and build assumptions for the captain's estimate check. */
  readonly setup: string
  /** Peak footprint in bytes, including expected temporary setup data. */
  readonly estimatedBytes: number
  /** Filesystem-available bytes observed when the member opened the request. */
  readonly availableAtRequest: string
  /** ISO instant that starts the authorization window. */
  readonly requestedAt: string
  /** Approval or refusal is attributable and time-bounded. */
  readonly status: typeof PHASES[number]
  /** Authenticated project captain who made the decision. */
  readonly captainSession?: string
  /** ISO instant when the approval or refusal was recorded. */
  readonly decidedAt?: string
  /** Available bytes observed when the captain reserved capacity. */
  readonly availableAtApproval?: string
  /** Optional explanation for the decision. */
  readonly decisionReason?: string
  /** Root fingerprint saved before Git writes. */
  readonly rootId?: string
  /** Git directory fingerprint saved before publishing. */
  readonly gitId?: string
  /** Copy's initial allocated blocks, in bytes, netted against the reservation. */
  readonly allocatedBytes?: string
  /** Exact candidate declared by the assigned writer, then used for verification and merge. */
  readonly candidate?: string
  /** ISO instant of submission, before an independent PASS. */
  readonly submittedAt?: string
  /** Project verification record that authorized the exact merge. */
  readonly verifiedRecord?: string
  /** Local target branch required to retain the candidate before disposal. */
  readonly integrationBranch?: string
  /** Measured copy allocation in bytes when disposal started. */
  readonly releasedBytes?: string
  /** Filesystem-available bytes sampled before removing this copy. */
  readonly freeBeforeDisposal?: string
  /** Filesystem-available bytes sampled after the removal. */
  readonly freeAfterDisposal?: string
}

/** Resolve the private state and clone parent without accepting a redirected ancestor. */
export function copyDirectory(root: string): string {
  /** Runtime copy metadata lives only under the authorized project root. */
  const path = join(root, ".mpd", "copies")
  if (canonicalPath(path) !== path) throw new WorktreeError("copy-path-changed", "the copy state path contains a symlink")
  return path
}

/** Resolve the approved destination from its validated single segment. */
export function copyPath(dir: string, destination: string): string {
  if (!isValidName(destination)) throw new WorktreeError("copy-destination", "destination must be a lowercase name inside .mpd/copies/checkouts")
  /** A missing final segment is allowed before allocation. */
  const path = join(dir, "checkouts", destination)
  if (canonicalPath(path) !== path) throw new WorktreeError("copy-path-changed", "the destination contains a symlink")
  return path
}

/** Resolve only the staging path for this record and no caller-selected filesystem location. */
export function stagePath(dir: string, id: string): string {
  if (!COPY_ID.test(id)) throw new WorktreeError("copy-id", "invalid copy request id")
  /** The preparing tree is not accessible via a checkout binding. */
  const path = join(dir, "staging", id)
  if (canonicalPath(path) !== path) throw new WorktreeError("copy-path-changed", "the staging path contains a symlink")
  return path
}

/** Physical writable bytes still available to an unprivileged process on the destination filesystem. */
export function availableBytes(path: string): bigint {
  /** Use bigint to reserve correctly even on filesystems with more than 2^53 bytes. */
  const stat = statfsSync(path, { bigint: true })
  return stat.bavail * stat.bsize
}

/** Verify the one reservation ledger covers one device for both staging and published checkouts. */
export function prepareCopyDirectories(dir: string, destination: string, stage: string): void {
  for (const path of [join(dir, "requests"), join(dir, "checkouts"), join(dir, "staging")]) {
    mkdirSync(path, { recursive: true, mode: 0o700 })
    directoryId(path)
  }
  /** Mount points under a shared path would invalidate free-space comparisons. */
  const device = lstatSync(dir, { bigint: true }).dev
  if ([destination, stage].some((path) => lstatSync(join(path, ".."), { bigint: true }).dev !== device)) {
    throw new WorktreeError("copy-filesystem", "staging and checkouts must use the reservation ledger's filesystem")
  }
}

/** Narrow a parsed JSON object to a safe field map. */
export function objectOf(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : {}
}

/** Parse the index fail-closed, since dropping a damaged request could lose its reservation. */
function isRecord(record: Record<string, unknown>): record is Record<string, unknown> & CopyRecord {
  /** Properties later used as paths, Git arguments or authorization decisions. */
  const requiredText = ["id", "projectId", "teamId", "taskId", "memberId", "memberName", "writerSession", "source", "base",
    "destination", "reason", "setup", "availableAtRequest", "requestedAt", "status"]
  /** Optional state is also validated before a retry can act on it. */
  const optionalText = ["captainSession", "decidedAt", "decisionReason", "submittedAt", "verifiedRecord", "integrationBranch"]
  /** Physical size observations serialize as lossless decimal strings. */
  const bytes = ["allocatedBytes", "availableAtApproval", "freeBeforeDisposal", "freeAfterDisposal", "releasedBytes"]
  return requiredText.every((key) => typeof record[key] === "string" && record[key] !== "") &&
    optionalText.every((key) => record[key] === undefined || typeof record[key] === "string") &&
    bytes.every((key) => record[key] === undefined || /^\d+$/.test(String(record[key]))) &&
    ["rootId", "gitId"].every((key) => record[key] === undefined || FILE_ID.test(String(record[key]))) &&
    COPY_ID.test(String(record.id)) && isValidName(String(record.destination)) && OBJECT_ID.test(String(record.base)) &&
    (record.candidate === undefined || OBJECT_ID.test(String(record.candidate))) && PHASES.some((phase) => phase === record.status) &&
    Number.isSafeInteger(record.attempt) && Number(record.attempt) >= 0 &&
    Number.isSafeInteger(record.estimatedBytes) && Number(record.estimatedBytes) > 0 &&
    Array.isArray(record.scope) && record.scope.length > 0 && record.scope.every((scope) => typeof scope === "string")
}

/** Read the project ledger from regular files beneath its canonical path. */
export function readCopies(dir: string): CopyRecord[] {
  /** No part of a request's payload can choose its ledger path. */
  const requests = join(dir, "requests")
  if (!pathExists(requests)) return []
  directoryId(requests)
  return readdirSync(requests).filter((file) => COPY_ID.test(file.slice(0, -5)) && file.endsWith(".json")).map((file) => {
    /** A canonical filename must agree with its contents. */
    const path = join(requests, file)
    if (!lstatSync(path).isFile()) throw new WorktreeError("copy-ledger", `expected a regular request file at ${file}`)
    /** Unknown JSON is narrowed before the caller can mutate Git or filesystem state. */
    const record = objectOf(JSON.parse(readFileSync(path, "utf8")))
    if (isRecord(record) && `${record.id}.json` === file) return record
    throw new WorktreeError("copy-ledger", `invalid copy request ${file}`)
  })
}

/** Persist one transition atomically while holding the project reservation lock. */
export function writeCopy(dir: string, record: CopyRecord): CopyRecord {
  /** Temp and ledger share a filesystem so the publication is atomic. */
  const temp = join(dir, "requests", `${randomUUID()}.tmp`)
  writeFileSync(temp, `${JSON.stringify(record, null, 2)}\n`, { flag: "wx", mode: 0o600, flush: true })
  renameSync(temp, join(dir, "requests", `${record.id}.json`))
  return record
}

/** Serialize approval, allocation and release across processes in this project. */
export function withCopyLock<T>(dir: string, operation: () => T): T {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  directoryId(dir)
  /** Exclusive mkdir is a cross-process test-and-set even on hosts without a lock service. */
  const lock = join(dir, "lock")
  try {
    mkdirSync(lock, { mode: 0o700 })
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      throw new WorktreeError("copy-busy", "another process holds the project copy lock; retry after it finishes")
    }
    throw error
  }
  try {
    return operation()
  } finally {
    rmdirSync(lock)
  }
}

/** Compute unspent reservations in bytes, allowing stale approvals to stop consuming capacity. */
export function reservedBytes(records: readonly CopyRecord[], except: string): bigint {
  return records.reduce((total, record) => {
    if (record.id === except || record.status === "requested" || record.status === "declined" || record.status === "disposed" ||
        (record.status === "approved" && Date.now() >= Date.parse(record.requestedAt) + COPY_APPROVAL_MS)) return total
    /** `statfs` already counts the observed allocation, so reserve only the unspent estimate. */
    const unspent = BigInt(record.estimatedBytes) - BigInt(record.allocatedBytes ?? 0)
    return total + (unspent > 0n ? unspent : 0n)
  }, 0n)
}
