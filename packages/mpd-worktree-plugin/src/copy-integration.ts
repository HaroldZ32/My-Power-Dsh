import { renameSync, rmSync } from "node:fs"
import { requireCaptain } from "./copy-authority.ts"
import { allocatedCopyBytes, checkDisposable, integrateCandidate, pathExists, pinCandidate } from "./copy-git.ts"
import { checkCheckout, requireWriter, type LockedCopy } from "./copy-lifecycle.ts"
import { availableBytes, writeCopy, type CopyRecord } from "./copy-store.ts"
import { verifyCopyCandidate } from "./copy-verification.ts"
import { isValidBranch } from "./git.ts"
import { WorktreeError } from "./ops.ts"

/** Save the assigned writer's candidate without touching the project's refs or working tree. */
export function submitCopy(copy: LockedCopy, commit: string): CopyRecord {
  /** The owner and checkout must match the original grant. */
  const { authority, record, dir, path } = copy
  requireWriter(authority, record)
  if (record.status !== "ready") throw new WorktreeError("copy-state", "only a ready copy can submit a candidate")
  checkCheckout(record, path)
  if (record.candidate === commit) return record
  pinCandidate(path, record.base, commit, record.scope)
  return writeCopy(dir, { ...record, candidate: commit, submittedAt: new Date().toISOString() })
}

/** Transfer only the independently verified candidate into the captain's checked-out integration branch. */
export function mergeCopy(copy: LockedCopy, into: string, verification: string, protectedBranches: readonly string[]):
{ merged: boolean; conflicts: string[]; record: CopyRecord } {
  /** All source and sink paths have already been derived from the admitted project. */
  const { authority, record, dir, path } = copy
  requireCaptain(authority)
  if (record.status === "integrated" && record.integrationBranch === into && record.verifiedRecord === verification) {
    return { merged: true, conflicts: [], record }
  }
  if (record.status !== "ready" || record.candidate === undefined) {
    throw new WorktreeError("copy-state", "only a ready copy with a submitted candidate can integrate")
  }
  if (!isValidBranch(record.source, into) || protectedBranches.includes(into)) {
    throw new WorktreeError("copy-integration-branch", "use the repository's unprotected integration branch")
  }
  checkCheckout(record, path)
  verifyCopyCandidate(record.source, record, verification)
  /** The branch may have moved since submission, but the SHA in the proof and the Git merge stay fixed. */
  const result = integrateCandidate(record.source, path, record.candidate, into)
  return { ...result, record: result.merged ? writeCopy(dir, { ...record, status: "integrated", verifiedRecord: verification,
    integrationBranch: into }) : record }
}

/** Keep live writers out of the reclamation window. */
function checkWriterFinished(copy: LockedCopy): void {
  /** This may be an archived board if the normal terminal-edge sweep has already run. */
  const team = copy.authority.teams.get(copy.record.source, copy.record.teamId)
  /** A lost board cannot establish that the assigned writer has stopped. */
  const task = team?.tasks.find((row) => row.id === copy.record.taskId)
  if (task === undefined || !["completed", "failed", "cancelled"].includes(task.status)) {
    throw new WorktreeError("copy-writer-active", "close the original board assignment before disposing of the copy")
  }
}

/** Remove only the registered, integrated, clean checkout after checking all its private work. */
export function disposeCopy(copy: LockedCopy): CopyRecord {
  /** The staging directory doubles as quarantine so interrupted removals remain retryable. */
  const { authority, record, dir, path, stage } = copy
  requireCaptain(authority)
  if (record.status === "disposed") return record
  if ((record.status !== "integrated" && record.status !== "disposing") || !record.integrationBranch || !record.candidate) {
    throw new WorktreeError("copy-state", "successful integration must precede disposal")
  }
  checkWriterFinished(copy)
  /** Record the checked directory and original measured bytes before withdrawing capability. */
  let disposing = record
  if (record.status === "integrated") {
    checkCheckout(record, path)
    checkDisposable(record.source, path, record.candidate, record.integrationBranch)
    if (pathExists(stage)) throw new WorktreeError("copy-path-changed", "the cleanup quarantine is occupied")
    disposing = writeCopy(dir, { ...record, status: "disposing", releasedBytes: String(allocatedCopyBytes(path)),
      freeBeforeDisposal: String(availableBytes(dir)) })
  }
  if (pathExists(path)) {
    checkCheckout(disposing, path)
    checkDisposable(record.source, path, record.candidate, record.integrationBranch)
    if (pathExists(stage)) throw new WorktreeError("copy-path-changed", "the cleanup quarantine is occupied")
    authority.identity.unbindCheckout({ projectRoot: record.source, checkoutRoot: path, memberId: record.memberId })
    renameSync(path, stage)
  }
  if (pathExists(stage)) {
    checkCheckout(disposing, stage)
    checkDisposable(record.source, stage, record.candidate, record.integrationBranch)
    allocatedCopyBytes(stage)
    rmSync(stage, { recursive: true })
  }
  return writeCopy(dir, { ...disposing, status: "disposed", freeAfterDisposal: String(availableBytes(dir)) })
}
