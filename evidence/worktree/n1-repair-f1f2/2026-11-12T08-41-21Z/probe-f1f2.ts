// Repair probe for F1 (a branch name colliding with a tag) and F2 (a full-ref branch spelling).
// It drives the SAME operation functions the tools register against real throwaway repositories, and
// asserts the observable lifecycle rather than a return shape: the merged commit must land, the
// removal must prune, and a refused create must leave no ref, directory, registration or record.
// Repair-owned evidence; never imported by the product.
import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { resolveConfig } from "../../../../packages/mpd-worktree-plugin/src/config.ts"
import { createWorktree, mergeWorktree, removeWorktree, WorktreeError, type WorktreeDeps } from "../../../../packages/mpd-worktree-plugin/src/ops.ts"

/** One throwaway repository plus the resolved config its operations run with. */
interface ProbeSandbox {
  /** The absolute workspace root (also the repository toplevel). */
  root: string
  /** The dependencies the operations run with. */
  deps: WorktreeDeps
}

/**
 * Runs one git command and returns its trimmed stdout.
 * @param cwd the directory `git -C` runs in.
 * @param args the git arguments.
 * @returns the trimmed standard output.
 */
function git(cwd: string, args: string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim()
}

/**
 * Runs one git probe whose non-zero exit is an expected answer.
 * @param cwd the directory `git -C` runs in.
 * @param args the git arguments.
 * @returns true when git exited 0.
 */
function gitOk(cwd: string, args: string[]): boolean {
  try {
    execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: "pipe" })
    return true
  } catch {
    return false
  }
}

/**
 * Creates a repository on `main` with one commit and the deps object.
 * @param protectedBranches the resolved protected list for this sandbox.
 * @returns the sandbox.
 */
function sandbox(protectedBranches: string[] = []): ProbeSandbox {
  /** The throwaway root directory. */
  const root = mkdtempSync(join(tmpdir(), "n1-repair-probe-"))
  git(root, ["init", "-q", "-b", "main"])
  git(root, ["config", "user.email", "a@b.c"])
  git(root, ["config", "user.name", "probe"])
  writeFileSync(join(root, ".gitignore"), ".mpd/\n")
  writeFileSync(join(root, "a.txt"), "one\n")
  git(root, ["add", "."])
  git(root, ["commit", "-q", "-m", "init"])
  return { root, deps: { root, config: resolveConfig({ protectedBranches }), log: () => undefined } }
}

/**
 * Commits one file inside a checkout.
 * @param dir the checkout to commit in.
 * @param file the relative file name.
 * @param body the file content.
 * @returns the created commit's SHA.
 */
function commitFile(dir: string, file: string, body: string): string {
  writeFileSync(join(dir, file), body)
  git(dir, ["add", file])
  git(dir, ["commit", "-q", "-m", "probe work"])
  return git(dir, ["rev-parse", "HEAD"])
}

/** Every assertion the probe made, so a silent skip cannot read as a pass. */
const checks: string[] = []

/**
 * Asserts one observable fact and records its label.
 * @param condition the fact that must hold.
 * @param label the printable description of the fact.
 * @returns nothing; throws when the fact does not hold.
 */
function expect(condition: boolean, label: string): void {
  if (!condition) throw new Error("PROBE FAILED: " + label)
  checks.push(label)
  console.log("ok  " + label)
}

/**
 * Returns a refusal's typed code, or `NO-REFUSAL` when the operation returned.
 * @param body the operation under test.
 * @returns the code or `NO-REFUSAL`.
 */
function refusal(body: () => unknown): string {
  try {
    body()
    return "NO-REFUSAL"
  } catch (error) {
    return error instanceof WorktreeError ? error.code : `NON:${String(error)}`
  }
}

// A) The tag-collision lifecycle: create, merge the BRANCH's commit, remove and prune.
{
  /** One repository whose tag shares the branch name the create chooses. */
  const s = sandbox()
  git(s.root, ["tag", "feature", "main"])
  /** The created record on the colliding name. */
  const created = createWorktree(s.deps, { name: "alice", branch: "feature" })
  console.log("\n=== A) tag feature + create branch feature ===")
  console.log("recorded branch =", created.branch, "| worktree abbrev =", git(created.path, ["rev-parse", "--abbrev-ref", "HEAD"]))
  expect(git(created.path, ["rev-parse", "--abbrev-ref", "HEAD"]) === "heads/feature", "A1 the old comparison's poisoned input is reproduced")
  /** The commit only the branch carries; a tag-resolving merge would leave it out of main. */
  const tip = commitFile(created.path, "feature.txt", "feature\n")
  console.log("merge =", JSON.stringify(mergeWorktree(s.deps, { name: "alice" })))
  expect(gitOk(s.root, ["merge-base", "--is-ancestor", tip, "HEAD"]), "A2 merge landed the BRANCH tip, not the tag")
  expect(existsSync(join(s.root, "feature.txt")), "A3 the branch's file is in the main checkout")
  /** The removal after the merge. */
  const removed = removeWorktree(s.deps, { name: "alice" })
  console.log("remove =", JSON.stringify(removed))
  expect(removed.removed && removed.branchDeleted === true, "A4 remove succeeded and deleted the branch")
  expect(!existsSync(created.path), "A5 the worktree directory is gone")
  expect(!gitOk(s.root, ["rev-parse", "--verify", "--quiet", "refs/heads/feature"]), "A6 the branch ref is gone")
  /** The terminal record left behind. */
  const index = JSON.parse(readFileSync(join(s.root, ".mpd", "worktrees", "index.json"), "utf8")) as { worktrees: Array<Record<string, unknown>> }
  expect(index.worktrees[0]?.status === "removed", "A7 the record is a removed tombstone, not an active stranding")
  rmSync(s.root, { recursive: true, force: true })
}

// B) The DEFAULT branch name colliding with a tag: remove must prune.
{
  /** One repository whose tag shares the default `agent/alice` branch name. */
  const s = sandbox()
  git(s.root, ["tag", "agent/alice", "main"])
  /** The created record on the default branch. */
  const created = createWorktree(s.deps, { name: "alice" })
  console.log("\n=== B) tag agent/alice + default create ===")
  console.log("recorded branch =", created.branch, "| worktree abbrev =", git(created.path, ["rev-parse", "--abbrev-ref", "HEAD"]))
  expect(git(created.path, ["rev-parse", "--abbrev-ref", "HEAD"]) === "heads/agent/alice", "B1 the collision is reproduced on the DEFAULT name")
  /** The removal that used to refuse branch-mismatch. */
  const removed = removeWorktree(s.deps, { name: "alice" })
  console.log("remove =", JSON.stringify(removed))
  expect(removed.removed && removed.branchDeleted === true, "B2 remove succeeded and deleted the default branch")
  expect(!existsSync(created.path), "B3 the worktree directory is gone")
  expect(!gitOk(s.root, ["rev-parse", "--verify", "--quiet", "refs/heads/agent/alice"]), "B4 the branch ref is gone")
  rmSync(s.root, { recursive: true, force: true })
}

// C) Full-ref spellings: refused with no branch ref, directory, registration or record.
{
  /** One repository that protects `dev` and already carries the branch the spelling addresses. */
  const s = sandbox(["dev"])
  git(s.root, ["branch", "dev"])
  /** The path the refused creates would have used. */
  const target = join(s.root, ".mpd", "worktrees", "alice")
  console.log("\n=== C) full-ref branch spellings ===")
  console.log("control short branch dev =", refusal(() => createWorktree(s.deps, { name: "alice", branch: "dev" })))
  expect(refusal(() => createWorktree(s.deps, { name: "alice", branch: "dev" })) === "protected-branch", "C1 the short protected name is still refused")
  for (const branch of ["refs/heads/dev", "refs/heads/main"]) {
    /** The refusal for one full-ref spelling. */
    const code = refusal(() => createWorktree(s.deps, { name: "alice", branch }))
    console.log(`create branch="${branch}" =`, code)
    expect(code === "invalid-branch", `C2 [${branch}] refused as invalid-branch`)
    expect(!gitOk(s.root, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]), `C3 [${branch}] no new branch ref was created`)
    expect(!existsSync(target), `C4 [${branch}] no directory exists`)
    expect(!git(s.root, ["worktree", "list", "--porcelain"]).includes(target), `C5 [${branch}] no git worktree registration exists`)
    expect(!existsSync(join(s.root, ".mpd", "worktrees", "index.json")), `C6 [${branch}] no index record exists`)
  }
  expect(gitOk(s.root, ["rev-parse", "--verify", "--quiet", "refs/heads/dev"]), "C7 the pre-existing dev branch is untouched")
  expect(gitOk(s.root, ["rev-parse", "--verify", "--quiet", "refs/heads/main"]), "C8 the pre-existing main branch is untouched")
  /** The ordinary short-branch create that must still work. */
  const created = createWorktree(s.deps, { name: "alice", branch: "work/alice" })
  console.log("control create work/alice =", created.branch, "| dir exists =", existsSync(created.path))
  expect(created.branch === "work/alice" && existsSync(created.path), "C9 a normal short branch still creates")
  /** The record that successful create wrote. */
  const index = JSON.parse(readFileSync(join(s.root, ".mpd", "worktrees", "index.json"), "utf8")) as { worktrees: Array<Record<string, unknown>> }
  expect(index.worktrees.length === 1 && index.worktrees[0]?.status === "active", "C10 exactly one active record, for the short name")
  rmSync(s.root, { recursive: true, force: true })
}

console.log(`\nRESULT: PASS checks=${checks.length}`)
