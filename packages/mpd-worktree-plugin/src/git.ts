// Every git invocation the mpd-worktree row makes, in one place: one spawn shape, one result shape,
// and no throw for an expected refusal (a refusal is DATA the caller turns into a typed error).
//
// All calls use `git -C <dir>` so the process cwd is never consulted; a row must not depend on where
// the harness happens to run.
import { spawnSync } from "node:child_process"

/** One git invocation's observable result; `code` is -1 when git could not start and -2 when it timed out. */
export interface GitResult {
  /** Exit status; -1 when git itself did not run, -2 when {@link GIT_TIMEOUT_CODE} killed it. */
  code: number
  /** Standard output, decoded as UTF-8. */
  stdout: string
  /** Standard error, decoded as UTF-8. */
  stderr: string
}

/** The wall-clock bound for one git invocation, so a stalled git cannot hold the host event loop. */
export const GIT_TIMEOUT_MS = 30_000

/** The result code for a git invocation killed at {@link GIT_TIMEOUT_MS}; distinct from -1 (spawn failure). */
export const GIT_TIMEOUT_CODE = -2

/**
 * Runs one git command in a directory.
 * @param cwd the directory `git -C` runs in.
 * @param args the git arguments, in argv order.
 * @param timeoutMs the wall-clock bound for this invocation; defaults to {@link GIT_TIMEOUT_MS}.
 * @returns the exit code and both streams; never throws.
 */
export function runGit(cwd: string, args: readonly string[], timeoutMs: number = GIT_TIMEOUT_MS): GitResult {
  /** The child's captured result; spawnSync kills a run past the bound and reports `ETIMEDOUT`. */
  const result = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8", timeout: timeoutMs, killSignal: "SIGKILL" })
  /** Whether the bound, not git, ended the run; that answer must not be confused with a spawn failure. */
  const timedOut = (result.error as { code?: string } | undefined)?.code === "ETIMEDOUT"
  return {
    code: timedOut ? GIT_TIMEOUT_CODE : result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: timedOut ? `git timed out after ${timeoutMs}ms` : result.stderr ?? "",
  }
}

/**
 * The first non-blank line of a git stream, for a one-line refusal reason.
 * @param text raw stdout or stderr.
 * @returns the first non-blank trimmed line, or "" when the stream is empty.
 */
export function firstLine(text: string): string {
  for (const line of text.split("\n")) {
    /** The trimmed line, tested for blankness before it is returned. */
    const trimmed = line.trim()
    if (trimmed !== "") return trimmed
  }
  return ""
}

/**
 * The repository's canonical top-level directory.
 * @param dir the directory to test (`git -C <dir> rev-parse --show-toplevel`).
 * @returns the toplevel path, or undefined when `dir` is not inside a git work tree.
 */
export function repoTopLevel(dir: string): string | undefined {
  /** git's own answer for the candidate directory. */
  const result = runGit(dir, ["rev-parse", "--show-toplevel"])
  if (result.code !== 0) return undefined
  /** The trimmed toplevel; a blank answer is treated as absent. */
  const top = result.stdout.trim()
  return top === "" ? undefined : top
}

/** The main checkout's HEAD, the base every comparison in this row is made against. */
export interface HeadInfo {
  /** The checked-out branch name, or the commit SHA when detached. */
  ref: string
  /** Whether HEAD is detached; a merge into a detached checkout is refused. */
  detached: boolean
}

/**
 * Reads the main checkout's current HEAD.
 * @param repo the repository directory.
 * @returns the branch name (or SHA when detached), or undefined for an unborn/broken HEAD.
 */
export function headOf(repo: string): HeadInfo | undefined {
  /** The symref answer: the branch name, or the literal `HEAD` when detached. */
  const branch = runGit(repo, ["rev-parse", "--abbrev-ref", "HEAD"])
  if (branch.code !== 0) return undefined
  /** The trimmed symbolic answer. */
  const symbolic = branch.stdout.trim()
  if (symbolic === "HEAD") {
    /** The detached commit SHA, the only ref such a checkout has. */
    const sha = runGit(repo, ["rev-parse", "HEAD"])
    if (sha.code !== 0) return undefined
    /** The trimmed SHA. */
    const detachedSha = sha.stdout.trim()
    return detachedSha === "" ? undefined : { ref: detachedSha, detached: true }
  }
  return symbolic === "" ? undefined : { ref: symbolic, detached: false }
}

/**
 * The branch a checkout has checked out, WITHOUT git's ambiguous abbreviation.
 *
 * `git rev-parse --abbrev-ref HEAD` abbreviates through the whole ref namespace, so a branch that
 * shares its name with another ref (a `feature` release tag beside the `feature` branch) is reported
 * as `heads/feature`. A record stores the short name, so comparing the two refused every remove and
 * merge on such a worktree. `git symbolic-ref --quiet HEAD` answers the full symbolic ref and nothing
 * else, which is unambiguous once the `refs/heads/` prefix is stripped; a detached checkout keeps the
 * literal `HEAD` spelling so a caller can still tell it apart from a branch, and a HEAD git cannot read
 * at all answers undefined.
 * @param dir the checkout directory.
 * @returns the short branch name (or the literal `HEAD` when detached), or undefined when git cannot answer.
 */
export function checkedOutBranch(dir: string): string | undefined {
  /** The full symbolic ref (`refs/heads/<name>`); it exits non-zero for a detached or unreadable HEAD. */
  const symbolic = runGit(dir, ["symbolic-ref", "--quiet", "HEAD"])
  if (symbolic.code === 0) {
    /** The trimmed full ref name; a blank answer counts as "git cannot say". */
    const full = symbolic.stdout.trim()
    if (full === "") return undefined
    return full.startsWith("refs/heads/") ? full.slice("refs/heads/".length) : full
  }
  /** Whether a commit is checked out at all: a detached HEAD resolves, a broken one does not. */
  const head = runGit(dir, ["rev-parse", "--verify", "--quiet", "HEAD"])
  return head.code === 0 ? "HEAD" : undefined
}

/**
 * Reads the commit HEAD points at — the commit a successful merge lands.
 * @param repo the repository directory.
 * @returns the SHA, or undefined when HEAD does not resolve.
 */
export function headSha(repo: string): string | undefined {
  /** `rev-parse HEAD`, which answers both an attached and a detached HEAD. */
  const result = runGit(repo, ["rev-parse", "HEAD"])
  /** The trimmed SHA, empty when the probe failed. */
  const sha = result.stdout.trim()
  return result.code === 0 && sha !== "" ? sha : undefined
}

/**
 * Whether a branch name legal by `git check-ref-format --branch` (an argument beginning with `-` is
 * refused here as well, because git would read it as an option).
 * @param repo the repository the name will be created in.
 * @param branch the candidate branch name.
 * @returns true when git accepts the name.
 */
export function isValidBranch(repo: string, branch: string): boolean {
  if (branch.trim() === "" || branch.startsWith("-")) return false
  return runGit(repo, ["check-ref-format", "--branch", branch]).code === 0
}

/**
 * The local branch ref a recorded short branch name addresses, for commands that take a revision.
 *
 * A bare name is ambiguous whenever another ref carries it too: with a tag `feature` present,
 * `git merge feature` merges the TAG and `git merge-base --is-ancestor feature …` answers for the tag
 * as well. A recorded branch is always a local branch, so every revision-shaped use of it addresses
 * `refs/heads/<name>` explicitly. Commands that take a branch NAME rather than a revision keep the
 * short spelling, because they resolve it against `refs/heads/` themselves (`git branch -d
 * refs/heads/<name>` is refused as "branch not found").
 * @param branch the short branch name a record carries.
 * @returns the full local ref, `refs/heads/<branch>`.
 */
export function branchRef(branch: string): string {
  return "refs/heads/" + branch
}

/**
 * Whether the repository knows a LOCAL branch.
 * @param repo the repository directory.
 * @param branch the branch name.
 * @returns true when `refs/heads/<branch>` exists.
 */
export function branchExists(repo: string, branch: string): boolean {
  return runGit(repo, ["rev-parse", "--verify", "--quiet", "refs/heads/" + branch]).code === 0
}

/**
 * Whether a ref/commit resolves in the repository.
 * @param repo the repository directory.
 * @param rev the ref, branch or SHA.
 * @returns true when `rev` peels to a commit.
 */
export function resolvesToCommit(repo: string, rev: string): boolean {
  return runGit(repo, ["rev-parse", "--verify", "--quiet", rev + "^{commit}"]).code === 0
}

/**
 * Whether `branch` is an ancestor of `main` — the row's definition of "merged".
 * @param repo the repository directory.
 * @param branch the branch that may be merged.
 * @param main the comparison ref (the main checkout's HEAD).
 * @returns true when every commit of `branch` is reachable from `main`.
 */
export function isAncestor(repo: string, branch: string, main: string): boolean {
  return runGit(repo, ["merge-base", "--is-ancestor", branch, main]).code === 0
}

/** A branch's distance from the main checkout's current ref. */
export interface RevCount {
  /** Commits the branch has that the main ref does not. */
  ahead: number
  /** Commits the main ref has that the branch does not. */
  behind: number
}

/**
 * The ahead/behind pair of a branch relative to the main ref.
 * @param repo the repository directory.
 * @param branch the branch to count.
 * @param main the main checkout's ref.
 * @returns the pair, or undefined when either side does not resolve.
 */
export function revCount(repo: string, branch: string, main: string): RevCount | undefined {
  /** `--left-right --count` prints `<left>\t<right>` for `branch...main`. */
  const result = runGit(repo, ["rev-list", "--left-right", "--count", branch + "..." + main])
  if (result.code !== 0) return undefined
  /** The two counters, in git's own left/right order. */
  const parts = result.stdout.trim().split(/\s+/)
  if (parts.length < 2) return undefined
  return { ahead: Number(parts[0]) || 0, behind: Number(parts[1]) || 0 }
}

/**
 * Whether a directory has uncommitted changes (tracked or untracked).
 * @param dir the directory to probe; it must already be a managed checkout or worktree.
 * @returns true when `git status --porcelain` reports anything.
 */
export function isDirty(dir: string): boolean {
  /** The porcelain status; a failing probe is reported as clean so the caller's own `exists` check governs. */
  const result = runGit(dir, ["status", "--porcelain"])
  return result.code === 0 && result.stdout.trim() !== ""
}

/**
 * Whether the MAIN checkout has changes to TRACKED files. Untracked files do not block a merge that
 * does not touch them, so they are excluded here on purpose.
 * @param repo the repository directory.
 * @returns true when a tracked path is modified or staged.
 */
export function trackedDirty(repo: string): boolean {
  /** The porcelain status limited to tracked paths. */
  const result = runGit(repo, ["status", "--porcelain", "--untracked-files=no"])
  return result.code === 0 && result.stdout.trim() !== ""
}

/**
 * The worktree paths git itself reports for a repository.
 * @param repo the repository directory.
 * @returns the `worktree <path>` records in git's order; empty when the listing fails.
 */
export function worktreePaths(repo: string): string[] {
  /** The porcelain listing. */
  const result = runGit(repo, ["worktree", "list", "--porcelain"])
  if (result.code !== 0) return []
  /** The collected paths. */
  const paths: string[] = []
  for (const line of result.stdout.split("\n")) {
    if (line.startsWith("worktree ")) paths.push(line.slice("worktree ".length).trim())
  }
  return paths
}

/**
 * Adds a worktree on a NEW branch.
 * @param repo the repository directory.
 * @param path the absolute directory to create.
 * @param branch the branch to create.
 * @param base the ref/SHA the branch starts from.
 * @returns git's failure text, or undefined on success.
 */
export function addWorktree(repo: string, path: string, branch: string, base: string): string | undefined {
  /** The creation invocation, in the contract's argument order. */
  const result = runGit(repo, ["worktree", "add", path, "-b", branch, base])
  return result.code === 0 ? undefined : firstLine(result.stderr) || firstLine(result.stdout) || "git worktree add exited " + result.code
}

/**
 * Attaches an EXISTING local branch to a new worktree, preserving every commit it carries.
 *
 * Only the recovery path of `createForMember` calls this: `git worktree add <path> <branch>` checks the
 * branch out as-is (never `-b`/`-B`, never a reset) and git itself refuses the attach when another
 * worktree currently has that branch checked out — the unsafe-reattach safeguard.
 * @param repo the repository directory.
 * @param path the absolute directory to create.
 * @param branch the existing local branch to attach.
 * @returns git's failure text, or undefined on success.
 */
export function attachWorktree(repo: string, path: string, branch: string): string | undefined {
  /** The attach invocation: no `-b`, so no branch is created and no commit is discarded. */
  const result = runGit(repo, ["worktree", "add", path, branch])
  return result.code === 0 ? undefined : firstLine(result.stderr) || firstLine(result.stdout) || "git worktree add exited " + result.code
}

/**
 * Removes one worktree directory.
 * @param repo the repository directory.
 * @param path the worktree directory.
 * @param force whether git may discard a dirty or locked worktree.
 * @returns git's failure text, or undefined on success.
 */
export function removeWorktreePath(repo: string, path: string, force: boolean): string | undefined {
  /** The removal invocation; `--force` is placed before the path git reads as the target. */
  const result = runGit(repo, ["worktree", "remove", ...(force ? ["--force"] : []), path])
  return result.code === 0 ? undefined : firstLine(result.stderr) || firstLine(result.stdout) || "git worktree remove exited " + result.code
}

/**
 * Prunes worktree registrations whose directories are gone — the contract's "a missing path is
 * pruned, not an error" path.
 * @param repo the repository directory.
 * @returns nothing; a prune failure is intentionally silent because the caller's next git call reports it.
 */
export function pruneWorktrees(repo: string): void {
  runGit(repo, ["worktree", "prune"])
}

/**
 * Deletes a local branch.
 * @param repo the repository directory.
 * @param branch the branch name.
 * @param force whether to use `-D` (discard unmerged commits) instead of `-d`.
 * @returns git's failure text, or undefined on success.
 */
export function deleteBranch(repo: string, branch: string, force: boolean): string | undefined {
  /** The deletion invocation; `-d` refuses an unmerged branch unless the caller forced it. */
  const result = runGit(repo, ["branch", force ? "-D" : "-d", branch])
  return result.code === 0 ? undefined : firstLine(result.stderr) || firstLine(result.stdout) || "git branch delete exited " + result.code
}

/** The outcome of one `git merge --no-ff` attempt. */
export interface MergeOutcome {
  /** Whether the merge committed. */
  ok: boolean
  /** The paths git reported as conflicted; empty for a non-conflict failure. */
  conflicts: string[]
  /** git's own explanation, when it is not a plain conflict (or when the abort itself failed). */
  reason?: string
}

/**
 * Merges one branch into the MAIN checkout's current branch with `--no-ff`, aborting on conflict so
 * the caller's "change nothing" promise holds.
 * @param repo the repository directory (its main checkout carries the checked-out target branch).
 * @param branch the branch to merge.
 * @param message the merge commit message.
 * @returns the outcome; only `ok: true` leaves a commit behind.
 */
export function mergeBranch(repo: string, branch: string, message: string): MergeOutcome {
  /** The merge attempt. */
  const result = runGit(repo, ["merge", "--no-ff", branch, "-m", message])
  if (result.code === 0) return { ok: true, conflicts: [] }
  /** Whether git actually STARTED a merge: only that state has something to abort. */
  const started = runGit(repo, ["rev-parse", "--verify", "--quiet", "MERGE_HEAD"]).code === 0
  if (!started) {
    return { ok: false, conflicts: [], reason: firstLine(result.stderr) || firstLine(result.stdout) || "git merge exited " + result.code }
  }
  /** The conflicted paths, collected BEFORE the abort clears them. */
  const conflicts = runGit(repo, ["diff", "--name-only", "--diff-filter=U"])
    .stdout.split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
  /** The abort's own result; a failed abort is REPORTED, never swallowed. */
  const abort = runGit(repo, ["merge", "--abort"])
  return abort.code === 0
    ? { ok: false, conflicts }
    : { ok: false, conflicts, reason: "git merge --abort failed: " + (firstLine(abort.stderr) || "exit " + abort.code) }
}
