import { spawnSync } from "node:child_process"
import { realpathSync, statSync } from "node:fs"
import { resolve } from "node:path"

/** Git's registered checkouts share one object store and one primary checkout. */
export interface ProjectCheckout {
  /** Canonical checkout containing the calling session's cwd. */
  readonly checkoutRoot: string
  /** Canonical Git common directory, shared exclusively by linked worktrees. */
  readonly commonDir: string
  /** Canonical primary checkout, independent of which linked worktree initiated the call. */
  readonly primaryRoot: string
  /** Registered, present checkout roots, including the primary checkout. */
  readonly worktrees: readonly string[]
  /** Filesystem identity of the common directory, used alongside the copy locator token. */
  readonly checkoutKey: string
}

/** Canonicalize on-disk aliases while preserving an absolute path for an absent workspace. */
export function canonicalPath(path: string): string {
  try {
    return realpathSync(path)
  } catch (error) {
    if (missingPath(error)) return resolve(path)
    throw error
  }
}

/** Identify a missing file without treating denied or malformed state as absent. */
export function missingPath(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT"
}

/** Read Git's own checkout metadata, with repository selectors inherited from neither caller nor host. */
function gitRead(cwd: string, args: readonly string[]): string | undefined {
  /** A Git invocation for the caller's directory, never a remote or mutating command. */
  const result = spawnSync("git", [...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_DIR: undefined, GIT_WORK_TREE: undefined, GIT_COMMON_DIR: undefined },
    timeout: 5000,
  })
  return result.status === 0 ? result.stdout : undefined
}

/** Recognize worktrees Git itself registers and whose primary checkout owns the common directory. */
export function projectCheckout(workspace: string): ProjectCheckout | undefined {
  /** Git's absolute repository address, or no checkout for a plain workspace. */
  const metadata = gitRead(workspace, ["rev-parse", "--path-format=absolute", "--show-toplevel", "--git-common-dir"])
  if (metadata === undefined) return undefined
  /** The two positional fields in Git's rev-parse response. */
  const [top, common] = metadata.trimEnd().split("\n")
  if (top === undefined || common === undefined) return undefined
  /** Resolve directory aliases so authorization compares actual checkouts. */
  const checkoutRoot = canonicalPath(top)
  /** The location shared only by linked Git worktrees. */
  const commonDir = canonicalPath(common)
  /** Null delimiters preserve registered paths containing spaces and literal quotes. */
  const listing = gitRead(workspace, ["worktree", "list", "--porcelain", "-z"])
  if (listing === undefined) return undefined
  /** Worktree addresses in Git's order, with its primary checkout first. */
  const worktrees = listing.split("\0").filter((line) => line.startsWith("worktree ")).map((line) => canonicalPath(line.slice(9)))
  /** The primary must be a real checkout of this same Git directory. */
  const primaryRoot = worktrees[0]
  if (primaryRoot === undefined || !worktrees.includes(checkoutRoot)) return undefined
  /** Refuse a bare/common-dir layout whose first listing is not a checkout. */
  const primaryCommon = primaryRoot === checkoutRoot ? commonDir : gitRead(primaryRoot, ["rev-parse", "--path-format=absolute", "--git-common-dir"])?.trimEnd()
  if (primaryCommon === undefined || canonicalPath(primaryCommon) !== commonDir) return undefined
  /** Device and inode identify the actual Git metadata object behind this path. */
  const info = statSync(commonDir, { bigint: true })
  return { checkoutRoot, commonDir, primaryRoot, worktrees, checkoutKey: `${info.dev}:${info.ino}` }
}
