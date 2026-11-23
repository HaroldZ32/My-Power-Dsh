import { randomUUID } from "node:crypto"
import { mkdirSync, renameSync } from "node:fs"
import { resolve } from "node:path"
import { activeCopyTask, checkCopyAssignment, ownCopy, requireCaptain, requireGrantCaptain, type CopyAuthority } from "./copy-authority.ts"
import { allocatedCopyBytes, checkSource, createCopy, directoryId, independentGitId, pathExists } from "./copy-git.ts"
import { availableBytes, COPY_APPROVAL_MS, copyDirectory, copyPath, prepareCopyDirectories, readCopies, reservedBytes, stagePath, withCopyLock, writeCopy, type CopyRecord } from "./copy-store.ts"
import { WorktreeError } from "./ops.ts"

/** Arguments for a single copy request as parsed by the tool boundary. */
export interface CopyRequest {
  /** ID of the member's active task in the current board. */
  readonly taskId: string
  /** Source normally specified as the dot alias for the native project root. */
  readonly source: string
  /** Exact object ID of the committed base to fetch. */
  readonly base: string
  /** Single path segment for the published checkout. */
  readonly destination: string
  /** Subset of the assigned board write scopes. */
  readonly scope: readonly string[]
  /** Justification for allocating an independent copy. */
  readonly reason: string
  /** Setup assumptions, including any separately authorized committed inputs. */
  readonly setup: string
  /** Estimated peak bytes before developer work completes. */
  readonly estimatedBytes: number
}

/** Require the decision and any initial allocation to take place in the current approval window. */
function checkFresh(record: CopyRecord): void {
  if (!(Date.now() < Date.parse(record.requestedAt) + COPY_APPROVAL_MS)) {
    throw new WorktreeError("copy-expired", "the request is older than 24 hours; have the writer send a fresh request")
  }
}

/** Return existing authorized requests without taking a filesystem lock or creating state. */
export function listCopies(authority: CopyAuthority): CopyRecord[] {
  return readCopies(copyDirectory(authority.seat.projectRoot)).filter((record) => ownCopy(authority, record))
}

/** Persist the immutable copy request, with no clone or reservation created by the member. */
export function requestCopy(authority: CopyAuthority, request: CopyRequest): CopyRecord {
  if (authority.seat.seat !== "member") throw new WorktreeError("copy-forbidden", "only the assigned member may request a copy")
  /** Copy sources are restricted to the canonical project root admitted by the host. */
  const root = authority.seat.projectRoot
  if (resolve(root, request.source) !== root) throw new WorktreeError("copy-source", "the source must be the admitted project checkout")
  checkSource(root, request.base)
  /** A board's task IDs are local to that board and the host binds the caller to one board. */
  const teamId = authority.seat.teamId
  /** Freeze the board claim and approved write paths alongside the request. */
  const task = activeCopyTask(authority, teamId, request.taskId, authority.seat.memberName, authority.session)
  if (!request.scope.every((scope) => task.writeScopes.includes(scope))) {
    throw new WorktreeError("copy-scope", "request only write scopes declared on the assigned board task")
  }
  /** Requests in sibling worktrees share the project ledger and its capacity lock. */
  const dir = copyDirectory(root)
  /** The destination name is mapped to one canonical in-project path before taking the lock. */
  const destination = copyPath(dir, request.destination)
  return withCopyLock(dir, () => {
    /** The state shared by all runners in this project. */
    const records = readCopies(dir)
    /** Prevent parallel checkout requests for the same live board attempt. */
    const previous = records.find((row) => row.teamId === teamId && row.taskId === task.id && row.attempt === (task.attempt ?? 0) &&
      row.status !== "declined" && ((row.status !== "requested" && row.status !== "approved") ||
        Date.now() < Date.parse(row.requestedAt) + COPY_APPROVAL_MS))
    if (previous !== undefined) {
      if (ownCopy(authority, previous) && previous.base === request.base && previous.destination === request.destination &&
          previous.reason === request.reason && previous.setup === request.setup && previous.estimatedBytes === request.estimatedBytes &&
          JSON.stringify(previous.scope) === JSON.stringify(request.scope)) return previous
      throw new WorktreeError("copy-already-requested", "this task attempt already has a copy request")
    }
    if (pathExists(destination)) throw new WorktreeError("copy-destination-exists", "choose an unused copy destination")
    /** A fresh request gets a private staging directory only after authorized allocation. */
    const id = randomUUID()
    prepareCopyDirectories(dir, destination, stagePath(dir, id))
    return writeCopy(dir, {
      ...request, id, teamId, attempt: task.attempt ?? 0, source: root,
      memberId: authority.seat.memberId, memberName: authority.seat.memberName, writerSession: authority.session,
      projectId: authority.seat.projectId, availableAtRequest: String(availableBytes(dir)), requestedAt: new Date().toISOString(), status: "requested",
    })
  })
}

/** Context borrowed while the project-wide lock is held. */
export interface LockedCopy {
  /** Native authority for this tool invocation. */
  readonly authority: CopyAuthority
  /** Request being changed inside the shared lock. */
  readonly record: CopyRecord
  /** All requests counted against the same filesystem budget. */
  readonly records: readonly CopyRecord[]
  /** Project-local state and reservation directory. */
  readonly dir: string
  /** Canonical path allocated for the member. */
  readonly path: string
  /** Canonical staging or quarantine directory for this request. */
  readonly stage: string
}

/** Read a request fresh inside the same critical section as all changes to its reservation. */
export function changeCopy<T>(authority: CopyAuthority, id: string, operation: (copy: LockedCopy) => T): T {
  /** No request input selects the ledger authority. */
  const dir = copyDirectory(authority.seat.projectRoot)
  return withCopyLock(dir, () => {
    /** A matching id in a different project is invisible to this caller. */
    const records = readCopies(dir)
    /** Requests are filtered before their stored paths or operations can be used. */
    const record = records.find((row) => row.id === id && ownCopy(authority, row))
    if (record === undefined || record.source !== authority.seat.projectRoot) {
      throw new WorktreeError("copy-unknown", "no accessible copy request has this id")
    }
    /** Paths are derived from validated request identifiers. */
    const path = copyPath(dir, record.destination)
    /** One predictable recovery location exists for each staging transaction. */
    const stage = stagePath(dir, record.id)
    prepareCopyDirectories(dir, path, stage)
    return operation({ authority, record, records, dir, path, stage })
  })
}

/** Check the on-disk budget after subtracting all other live requests' unspent reservations. */
function checkCapacity(copy: LockedCopy): string {
  /** Read the exact filesystem that holds both the clone and the reservation ledger. */
  const available = availableBytes(copy.dir)
  if (available - reservedBytes(copy.records, copy.record.id) < BigInt(copy.record.estimatedBytes)) {
    throw new WorktreeError("copy-insufficient-space", "available bytes after other copy reservations are below this request's estimate")
  }
  return String(available)
}

/** Record the original board captain's approval or explicit refusal. */
export function decideCopy(copy: LockedCopy, approved: boolean, reason?: string): CopyRecord {
  /** A repeat may resume a dead caller, but only through the current project authority. */
  const { authority, record, dir, path } = copy
  requireGrantCaptain(authority, record)
  if (!approved) {
    if (record.status === "declined") return record
    if (record.status !== "requested" && record.status !== "approved") throw new WorktreeError("copy-state", "an allocated copy cannot be declined")
    /** A new decline without a note replaces any earlier approval note. */
    const { decisionReason: _previousReason, ...pending } = record
    return writeCopy(dir, { ...pending, status: "declined", captainSession: authority.session, decidedAt: new Date().toISOString(),
      ...(reason === undefined ? {} : { decisionReason: reason }) })
  }
  if (["creating", "ready", "integrated", "disposed"].includes(record.status)) return record
  if (record.status !== "requested" && record.status !== "approved") throw new WorktreeError("copy-state", "only a pending request can be approved")
  checkFresh(record)
  checkCopyAssignment(authority, record)
  checkSource(record.source, record.base)
  if (pathExists(path) || copy.records.some((row) => row.id !== record.id && row.destination === record.destination &&
      !["declined", "disposed", "requested"].includes(row.status) &&
      (row.status !== "approved" || Date.now() < Date.parse(row.requestedAt) + COPY_APPROVAL_MS))) {
    throw new WorktreeError("copy-destination-exists", "this destination is already allocated or reserved")
  }
  if (record.status === "approved") return record
  return writeCopy(dir, { ...record, status: "approved", captainSession: authority.session, decidedAt: new Date().toISOString(),
    availableAtApproval: checkCapacity(copy), ...(reason === undefined ? {} : { decisionReason: reason }) })
}

/** Ensure only the exact original writer can touch a copy before integration. */
export function requireWriter(authority: CopyAuthority, record: CopyRecord): void {
  if (authority.seat.seat !== "member" || !ownCopy(authority, record)) {
    throw new WorktreeError("copy-forbidden", "only the assigned writer can allocate or submit this copy")
  }
  checkCopyAssignment(authority, record)
}

/** Revalidate both the directory and its Git data before acting on a published checkout. */
export function checkCheckout(record: CopyRecord, path: string): void {
  if (directoryId(path) !== record.rootId || independentGitId(record.source, path) !== record.gitId) {
    throw new WorktreeError("copy-path-changed", "the recorded checkout or Git directory was replaced")
  }
}

/** Allocate one checkout from the durable grant, publish it, and bind its member capability. */
export function allocateCopy(copy: LockedCopy): CopyRecord {
  /** The same request state identifies the only permitted staging directory and destination. */
  const { authority, record, dir, path, stage } = copy
  requireWriter(authority, record)
  if (record.status === "ready") {
    checkCheckout(record, path)
    return record
  }
  if ((record.status !== "approved" && record.status !== "creating") || !record.captainSession || !record.decidedAt) {
    throw new WorktreeError("copy-approval-required", "the project captain must approve this request first")
  }
  /** Checkpoint preparation before publication and resume only the documented directory. */
  let preparing = record
  if (record.status === "approved") {
    checkFresh(record)
    checkCapacity(copy)
    checkSource(record.source, record.base)
    if (pathExists(path) || pathExists(stage)) throw new WorktreeError("copy-destination-exists", "the checkout or staging path is already occupied")
    mkdirSync(stage, { mode: 0o700 })
    preparing = writeCopy(dir, { ...record, status: "creating", rootId: directoryId(stage) })
    createCopy(record.source, stage, record.base)
    preparing = writeCopy(dir, { ...preparing, gitId: independentGitId(record.source, stage), allocatedBytes: String(allocatedCopyBytes(stage)) })
  }
  if (preparing.gitId === undefined) {
    throw new WorktreeError("copy-incomplete", "the interrupted staging copy is retained for recovery; no second allocation was made")
  }
  checkCopyAssignment(authority, preparing)
  if (!pathExists(path)) {
    checkCheckout(preparing, stage)
    renameSync(stage, path)
  }
  checkCheckout(preparing, path)
  authority.identity.bindCheckout({ projectRoot: record.source, checkoutRoot: path, memberId: record.memberId })
  return writeCopy(dir, { ...preparing, status: "ready" })
}
