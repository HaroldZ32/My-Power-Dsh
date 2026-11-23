import { createHash, randomUUID } from "node:crypto"
import { linkSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs"
import { dirname, isAbsolute, join } from "node:path"
import type { DshAdapter, DshToolExec } from "../../mpd-dsh-adapter-plugin/src/index"
import { agentPaths, storePaths, type Config, type StoreDirs } from "./store"

/** The authenticated project seat projected by the optional team identity service. */
export interface MemorySeat {
  /** The scope granted by the resolver after checking the actual checkout and live session. */
  readonly kind: "member"
  /** Stable project identity, independent of checkout and board. */
  readonly projectId: string
  /** Canonical root containing the project's durable state. */
  readonly projectRoot: string
  /** Durable roster member identity, including the captain seat. */
  readonly memberId: string
  /** This call's execution checkout, used only for its explicit legacy view. */
  readonly checkoutRoot: string
}

/** A workspace call uses either the old checkout-local store or one authenticated project seat. */
export type WorkspaceMemory =
  | { readonly kind: "unbound"; readonly checkoutRoot: string }
  | MemorySeat

/** A refused request, an invalid fact, or a conflict with the version already published. */
export class ProjectMemoryError extends Error {
  /** Describe a project memory failure without including any stored content. */
  constructor(message: string) { super("mpd-memory: " + message) }
}

/** Resolve one tool execution and refuse a project seat mismatch before opening any store. */
export function resolveWorkspaceMemory(dsh: DshAdapter, exec: DshToolExec, identity: unknown): WorkspaceMemory {
  /** The real execution checkout, rather than any tool argument. */
  const checkoutRoot = dsh.workspaceRoot(exec)
  if (identity === undefined || identity === null) return { kind: "unbound", checkoutRoot }
  if (typeof identity !== "object" || !("resolveSeat" in identity) || typeof identity.resolveSeat !== "function") {
    throw new ProjectMemoryError("project identity service is unavailable")
  }
  /** Only the actual tool caller's session can authenticate a memory request. */
  const agent = exec?.agent
  /** The host's session object, absent for callers that have no authenticated session. */
  const session = typeof agent === "object" && agent !== null && "session" in agent ? agent.session : undefined
  /** Read the host-minted session id and omit display names and invocation arguments. */
  const sessionId = typeof session === "object" && session !== null && "id" in session && typeof session.id === "string" ? session.id : ""
  /** The service's authorization answer for this exact execution. */
  const seat: unknown = identity.resolveSeat({ checkoutRoot, sessionId })
  if (typeof seat === "object" && seat !== null && "kind" in seat) {
    if (seat.kind === "unbound") return { kind: "unbound", checkoutRoot }
    if (seat.kind === "member" && sessionId !== "" &&
        "projectId" in seat && typeof seat.projectId === "string" && seat.projectId !== "" &&
        "projectRoot" in seat && typeof seat.projectRoot === "string" && isAbsolute(seat.projectRoot) &&
        "memberId" in seat && typeof seat.memberId === "string" && seat.memberId !== "") {
      return { kind: "member", projectId: seat.projectId, projectRoot: seat.projectRoot, memberId: seat.memberId, checkoutRoot }
    }
  }
  throw new ProjectMemoryError("no authorized project memory seat for this caller and checkout")
}

/** A full digest gives an exact case-sensitive mapping without allowing ids or keys to form paths. */
export function memoryKeyPart(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex")
}

/** Canonical per-project path under the memory state directory. */
function projectRoot(config: Config, seat: MemorySeat): string {
  return join(seat.projectRoot, config.dir ?? ".mpd", "memory", "projects", memoryKeyPart(seat.projectId))
}

/** The private member store, or the existing checkout-local store for a standalone session. */
export function privatePaths(config: Config, scope: WorkspaceMemory): StoreDirs {
  if (scope.kind === "unbound") return agentPaths(config, scope.checkoutRoot)
  return storePaths(join(projectRoot(config, scope), "members", memoryKeyPart(scope.memberId)))
}

/** The distinct explicitly shared collection for an authenticated project seat. */
export function sharedPaths(config: Config, scope: WorkspaceMemory): StoreDirs {
  if (scope.kind === "unbound") throw new ProjectMemoryError("shared facts require an authorized project seat")
  return storePaths(join(projectRoot(config, scope), "shared"))
}

/** Publish complete bytes atomically, with exclusive publication for an immutable fact revision. */
export function publishMemory(path: string, content: string, exclusive: boolean, stagingDir: string = dirname(path)): void {
  /** Scratch bytes stay on the same filesystem and outside the versioned shared collection. */
  const staged = join(stagingDir, ".pending-" + randomUUID())
  try {
    writeFileSync(staged, content, { flag: "wx", mode: 0o600 })
    if (exclusive) linkSync(staged, path)
    else renameSync(staged, path)
  } catch (error) {
    if (exclusive && hasFsCode(error, "EEXIST")) {
      throw new ProjectMemoryError("another writer published this fact revision; recall before retrying")
    }
    throw error
  } finally {
    discardPending(staged)
  }
}

/** Test an OS error code without swallowing other read or publication failures. */
export function hasFsCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code
}

/** Remove a publication scratch file, which a successful rename already consumed. */
function discardPending(path: string): void {
  try { unlinkSync(path) } catch (error) { if (!hasFsCode(error, "ENOENT")) throw error }
}

/** Bound key-value recalls while preserving surrogate pairs at the preview boundary. */
export function previewText(value: string, units: number): string {
  if (value.length <= units) return value
  /** Last UTF-16 unit before the boundary, possibly the first half of a code point. */
  const last = value.charCodeAt(units - 1)
  return value.slice(0, last >= 0xd800 && last <= 0xdbff ? units - 1 : units)
}

/** Validate keys that address exactly one fact or one private note. */
export function exactMemoryKey(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "" || value.length > 120 || /[\u0000-\u001f\u007f]/u.test(value) || /[\ud800-\udfff]/u.test(value)) {
    throw new ProjectMemoryError("key must be 1–120 characters of well-formed text without control characters")
  }
  return value
}

/** Return the member-only runtime key directory, without creating it. */
function privateKeyDir(config: Config, seat: MemorySeat): string {
  return join(privatePaths(config, seat).runtime, "keys")
}

/** Write an exact private key in its own atomic file so unrelated writes never replace each other. */
export function saveMemberKey(config: Config, scope: WorkspaceMemory, key: string, value: string): { ok: boolean; key: string } | undefined {
  if (scope.kind === "unbound") return undefined
  /** The validated key and its member-only directory. */
  const id = exactMemoryKey(key)
  /** Runtime notes are separate from the journal and VCS-backed entries. */
  const dir = privateKeyDir(config, scope)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  publishMemory(join(dir, memoryKeyPart(id)), value, false)
  return { ok: true, key: id }
}

/** Read an exact private key and bound the value returned to the tool caller. */
export function recallMemberKey(config: Config, scope: WorkspaceMemory, key: string): { key: string; value: string; found: boolean; truncated?: boolean } | undefined {
  if (scope.kind === "unbound") return undefined
  /** The validated, case-sensitive requested key. */
  const id = exactMemoryKey(key)
  try {
    /** The full persisted value, clipped before crossing the tool boundary. */
    const stored = readFileSync(join(privateKeyDir(config, scope), memoryKeyPart(id)), "utf8")
    /** The bounded value returned to the caller. */
    const value = previewText(stored, 768)
    return { key: id, value, found: true, ...(value.length < stored.length ? { truncated: true } : {}) }
  } catch (error) {
    if (hasFsCode(error, "ENOENT")) return { key: id, value: "", found: false }
    throw error
  }
}
