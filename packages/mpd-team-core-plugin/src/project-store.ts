import { randomUUID } from "node:crypto"
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import type * as Sqlite from "node:sqlite"
import { canonicalPath, missingPath, projectCheckout, type ProjectCheckout } from "./project-checkout"

/** A fixed seat's configured route, or null when the executor inherits its captain's route. */
export type ProjectRoute = { readonly provider: string; readonly model: string; readonly reasoningEffort?: string } | null

/** A durable participant shared by successive boards; the host session is tracked on its board. */
export interface ProjectMember {
  /** Project-local account id, independent of board and host handles. */
  readonly memberId: string
  /** Current board-facing name. Old records contain only this workmate or display alias. */
  readonly name: string
  /** The captain-declared roster name before any Workmate suggestion. */
  readonly logicalName?: string
  /** Workmate bound on admission, when the board uses one. */
  readonly workmate?: string
  /** The first approved roster role for this seat. */
  readonly role?: string
  /** Effective route when one was available at declaration. */
  readonly route: ProjectRoute
}

/** A copy locator must be corroborated by the primary checkout's project record. */
interface CopyBinding {
  /** Identity expected in the primary record. */
  readonly projectId: string
  /** Primary checkout from which to authenticate the locator. */
  readonly primaryRoot: string
  /** Canonical copy directory registered during allocation. */
  readonly checkoutRoot: string
  /** Device and inode of the independent Git directory. */
  readonly checkoutKey: string
  /** Fixed project seat authorized to work in the copy. */
  readonly memberId: string
  /** Bilateral allocation token, stable across retries. */
  readonly token: string
}

/** Durable identity beneath the primary checkout, with the state root chosen once at first use. */
export interface ProjectRecord {
  /** Disk format version for safe admission after upgrades. */
  readonly version: 1
  /** Durable project id issued on the first admitted run. */
  readonly projectId: string
  /** Shared state root, preserving the original location of adopted legacy state. */
  readonly projectRoot: string
  /** The captain's durable scope, separate from the current captain session. */
  readonly captainId: string
  /** Most recent captain authenticated by admission, including after its board ends. */
  readonly captainSessionId?: string
  /** Permanent seats declared so far. */
  readonly members: readonly ProjectMember[]
  /** Captain-approved independent checkout registrations. */
  readonly copies: readonly CopyBinding[]
}

/** Actual tool cwd is separate from the canonical address used for structured state. */
export interface ProjectLocation {
  /** The actual calling Git checkout or plain workspace. */
  readonly checkoutRoot: string
  /** The authority used for the cross-process lock. */
  readonly primaryRoot: string
  /** Registered roots examined when adopting historical state. */
  readonly roots: readonly string[]
  /** Identity is absent before the first Team or Cellwork run. */
  readonly record?: ProjectRecord
  /** Additional proof required when the checkout has its own Git objects. */
  readonly copy?: CopyBinding
}

/** An internal registration is passed only after the copy service has checked durable approval. */
export interface CopyRegistration {
  /** The project state root whose captain approved the allocation. */
  readonly projectRoot: string
  /** The canonical directory allocated by the copy service. */
  readonly checkoutRoot: string
  /** The durable project seat the approval names. */
  readonly memberId: string
}

/** Expected project errors can be surfaced at tool and command boundaries. */
export class ProjectAdmissionError extends Error {
  /** Expected refusal type shared by the Team and Cellwork boundaries. */
  readonly name = "ProjectAdmissionError"
}

/** Distinguish absent files from invalid or denied state so a corrupt record never admits another run. */
export function readProjectJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"))
  } catch (error) {
    if (missingPath(error)) return undefined
    throw new ProjectAdmissionError(`cannot read project state at ${path}`, { cause: error })
  }
}

/** Replace a local record atomically for readers in other processes. */
function storeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  /** Same-directory rename stays on the same filesystem. */
  const temp = `${path}.${randomUUID()}.tmp`
  writeFileSync(temp, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 })
  renameSync(temp, path)
}

/** Narrow data at the filesystem boundary. */
export function objectValue(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** Match persisted concrete routes without inventing a route for inherited or legacy seats. */
export function routeValue(value: unknown): value is ProjectRoute {
  return value === null || (objectValue(value) && typeof value.provider === "string" && typeof value.model === "string" && (value.reasoningEffort === undefined || typeof value.reasoningEffort === "string"))
}

/** All identity fields needed to enforce a copy binding. */
function copyValue(value: unknown): value is CopyBinding {
  return objectValue(value) && typeof value.projectId === "string" && typeof value.primaryRoot === "string" && typeof value.checkoutRoot === "string" && typeof value.checkoutKey === "string" && typeof value.memberId === "string" && typeof value.token === "string"
}

/** A stored seat is independently usable across many board ids. */
function memberValue(value: unknown): value is ProjectMember {
  return objectValue(value) && typeof value.memberId === "string" && typeof value.name === "string" &&
    (value.logicalName === undefined || typeof value.logicalName === "string" && value.logicalName !== "") &&
    (value.workmate === undefined || typeof value.workmate === "string" && value.workmate !== "") &&
    (value.role === undefined || typeof value.role === "string") && routeValue(value.route)
}

/** Identity and mutex files stay apart from board archives. */
function projectDir(primaryRoot: string): string {
  return join(primaryRoot, ".mpd", "project-team")
}

/** Locator owned by a specific independent copy allocation. */
function locatorPath(commonDir: string): string {
  return join(commonDir, "mpd-project-checkout.json")
}

/** Read the primary record and reject unknown versions before any write. */
function loadProject(primaryRoot: string): ProjectRecord | undefined {
  /** The canonical identity document. */
  const path = join(projectDir(primaryRoot), "identity.json")
  /** Parsed bytes are unknown until every required property is checked. */
  const value = readProjectJson(path)
  if (value === undefined) return undefined
  if (objectValue(value) && value.version === 1 && typeof value.projectId === "string" && typeof value.projectRoot === "string" && typeof value.captainId === "string" && Array.isArray(value.members) && value.members.every(memberValue) && Array.isArray(value.copies) && value.copies.every(copyValue)) {
    return { version: 1, projectId: value.projectId, projectRoot: value.projectRoot, captainId: value.captainId, ...(typeof value.captainSessionId === "string" ? { captainSessionId: value.captainSessionId } : {}), members: value.members, copies: value.copies }
  }
  throw new ProjectAdmissionError(`invalid project identity at ${path}`)
}

/** Write through the primary root even when a legacy run's board remains in a linked checkout. */
export function saveProject(location: ProjectLocation, record: ProjectRecord): void {
  storeJson(join(projectDir(location.primaryRoot), "identity.json"), record)
}

/** Resolve authority from Git metadata or a mutually corroborated copy locator. */
export function locateProject(workspace: string): ProjectLocation {
  /** Git binding, when this cwd belongs to a registered checkout. */
  const git = projectCheckout(workspace)
  /** Plain workspaces retain their absolute state paths. */
  const checkoutRoot = git?.checkoutRoot ?? canonicalPath(workspace)
  /** A locator read from the checkout, never supplied as a tool argument. */
  const locator = git === undefined ? undefined : readProjectJson(locatorPath(git.commonDir))
  if (locator !== undefined) {
    if (!copyValue(locator) || locator.checkoutRoot !== checkoutRoot || locator.checkoutKey !== git?.checkoutKey) {
      throw new ProjectAdmissionError(`stale project copy locator at ${checkoutRoot}`)
    }
    /** A clone-local file alone has no authority. */
    const record = loadProject(locator.primaryRoot)
    if (record?.projectId !== locator.projectId || !record.copies.some((binding) => binding.token === locator.token && binding.checkoutRoot === checkoutRoot && binding.checkoutKey === git.checkoutKey && binding.memberId === locator.memberId)) {
      throw new ProjectAdmissionError(`unregistered project copy at ${checkoutRoot}`)
    }
    return { checkoutRoot, primaryRoot: locator.primaryRoot, roots: [record.projectRoot], record, copy: locator }
  }
  /** Linked worktrees and cwd aliases converge on one lock and identity record. */
  const primaryRoot = git?.primaryRoot ?? checkoutRoot
  /** The stored identity is intentionally optional before first structured use. */
  const record = loadProject(primaryRoot)
  if (record !== undefined && !(git?.worktrees ?? [checkoutRoot]).includes(record.projectRoot)) {
    throw new ProjectAdmissionError(`project state root ${record.projectRoot} is no longer a registered checkout`)
  }
  return { checkoutRoot, primaryRoot, roots: git?.worktrees ?? [checkoutRoot], ...(record === undefined ? {} : { record }) }
}

/** Serialize short synchronous writes across local processes using SQLite's process-owned file lock. */
export function withProjectLock<T>(location: ProjectLocation, operation: (fresh: ProjectLocation) => T): T {
  /** Load SQLite only for structured mutations; an ordinary boot performs no admission work. */
  const sqlite: typeof Sqlite | undefined = process.getBuiltinModule("node:sqlite")
  if (sqlite === undefined) throw new ProjectAdmissionError("project admission requires the Node SQLite builtin")
  /** No pending async work runs inside the transaction; a process exit releases the lock. */
  const dir = projectDir(location.primaryRoot)
  mkdirSync(dir, { recursive: true })
  /** The database is only a lock coordinator. Boards and identity remain ordinary local records. */
  const db = new sqlite.DatabaseSync(join(dir, "admission.sqlite"))
  try {
    db.exec("PRAGMA busy_timeout = 5000; BEGIN IMMEDIATE")
    return operation(locateProject(location.checkoutRoot))
  } finally {
    db.close()
  }
}

/** Validate that a copy is a different, actual Git checkout rather than a linked worktree. */
function independentCheckout(project: ProjectLocation, path: string): ProjectCheckout {
  /** A real primary checkout and an independent common dir are required. */
  const git = projectCheckout(path)
  if (git === undefined || git.checkoutRoot !== canonicalPath(path) || git.primaryRoot !== git.checkoutRoot || git.commonDir === projectCheckout(project.primaryRoot)?.commonDir) {
    throw new ProjectAdmissionError(`project copy at ${path} must have an independent Git common directory`)
  }
  return git
}

/** Register one independently allocated Git checkout for the named durable member. */
export function bindCheckout(input: CopyRegistration): void {
  withProjectLock(locateProject(input.projectRoot), (location) => {
    /** The captain-approved registration refers to a fixed seat in this project. */
    const record = location.record
    if (location.copy !== undefined || record === undefined || !record.members.some((member) => member.memberId === input.memberId)) {
      throw new ProjectAdmissionError("project copy needs an existing fixed project member")
    }
    /** Stat the actual allocation, not merely the registered path. */
    const git = independentCheckout(location, input.checkoutRoot)
    if (loadProject(git.checkoutRoot) !== undefined) throw new ProjectAdmissionError(`checkout ${git.checkoutRoot} already belongs to a project`)
    /** Existing registration is replayable only for this exact Git directory and seat. */
    const existing = record.copies.find((binding) => binding.checkoutRoot === git.checkoutRoot)
    if (existing !== undefined && (existing.checkoutKey !== git.checkoutKey || existing.memberId !== input.memberId)) {
      throw new ProjectAdmissionError(`checkout ${git.checkoutRoot} is already registered to a different allocation`)
    }
    /** The locator cannot be overwritten if it points into another project. */
    const locator = readProjectJson(locatorPath(git.commonDir))
    if (locator !== undefined && (!copyValue(locator) || locator.token !== existing?.token)) {
      throw new ProjectAdmissionError(`checkout ${git.checkoutRoot} has a conflicting copy locator`)
    }
    /** A token is stable on retries after the primary write, including a crash before the locator write. */
    const binding = existing ?? { projectId: record.projectId, primaryRoot: location.primaryRoot, checkoutRoot: git.checkoutRoot, checkoutKey: git.checkoutKey, memberId: input.memberId, token: randomUUID() }
    if (existing === undefined) saveProject(location, { ...record, copies: [...record.copies, binding] })
    storeJson(locatorPath(git.commonDir), binding)
  })
}

/** Revoke a copy by address and owner; an absent registration is already revoked. */
export function unbindCheckout(input: CopyRegistration): void {
  withProjectLock(locateProject(input.projectRoot), (location) => {
    /** The primary record is authoritative even if the disposable checkout is already gone. */
    const record = location.record
    if (record === undefined || location.copy !== undefined) return
    /** Use the actual checkout's recorded canonical address. */
    const checkoutRoot = canonicalPath(input.checkoutRoot)
    /** Keep the tombstoned locator inert until the copies service removes its registered directory. */
    const remaining = record.copies.filter((copy) => copy.checkoutRoot !== checkoutRoot || copy.memberId !== input.memberId)
    if (remaining.length !== record.copies.length) saveProject(location, { ...record, copies: remaining })
  })
}
