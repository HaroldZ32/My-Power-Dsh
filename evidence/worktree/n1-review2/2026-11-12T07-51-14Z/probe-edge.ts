// N1 re-verification edge probe (review2): can a record created through the PUBLIC create path on a
// configured protected branch name still be removed or merged? This is a legitimacy path, not a tamper:
// createWorktree's `branch` override is documented as any `git check-ref-format --branch` name.
import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { resolveConfig, type Config } from "../../../../packages/mpd-worktree-plugin/src/config.ts"
import { createWorktree, mergeWorktree, removeWorktree, WorktreeError, type WorktreeDeps } from "../../../../packages/mpd-worktree-plugin/src/ops.ts"

const roots: string[] = []
function git(cwd: string, args: string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim()
}
function sandbox(overrides: Partial<Config> = {}): WorktreeDeps & { root: string } {
  const root = mkdtempSync(join(tmpdir(), "n1-review2-edge-"))
  roots.push(root)
  git(root, ["init", "-q", "-b", "main"])
  git(root, ["config", "user.email", "agent@example.com"])
  git(root, ["config", "user.name", "N1 Review Edge Probe"])
  writeFileSync(join(root, ".gitignore"), ".mpd/\n")
  writeFileSync(join(root, "a.txt"), "one\n")
  git(root, ["add", "."])
  git(root, ["commit", "-q", "-m", "init"])
  return { root, config: resolveConfig(overrides), log: [] as string[] } as WorktreeDeps & { root: string }
}
function refusal(body: () => unknown): string {
  try { body(); return "NO-REFUSAL" } catch (e) { return e instanceof WorktreeError ? e.code : `NON-WORKTREE:${String(e)}` }
}

for (const protectedName of ["dev", "master"]) {
  const deps = sandbox({ protectedBranches: ["master", "dev"] })
  // The branch does NOT exist yet, which is exactly when `git worktree add -b <protected> <base>` succeeds.
  const createCode = refusal(() => createWorktree(deps, { name: "alice", branch: protectedName }))
  const index = JSON.parse(readFileSync(join(deps.root, ".mpd", "worktrees", "index.json"), "utf8")) as { worktrees: Array<Record<string, unknown>> }
  const recorded = String(index.worktrees[0]?.branch)
  const exists = gitOk(deps.root, ["rev-parse", "--verify", "refs/heads/" + protectedName])
  const removeCode = refusal(() => removeWorktree(deps, { name: "alice", force: true }))
  const mergeCode = refusal(() => mergeWorktree(deps, { name: "alice", force: true }))
  console.log(
    `protected=${protectedName} create=${createCode} recorded=${recorded} branchExists=${exists} ` +
      `remove(force:true)=${removeCode} merge(force:true)=${mergeCode} ` +
      `recordStatus=${String(index.worktrees[0]?.status)} dirExists=${existsSync(join(deps.root, ".mpd", "worktrees", "alice"))}`,
  )
}
function gitOk(cwd: string, args: string[]): boolean {
  try { execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }); return true } catch { return false }
}
for (const root of roots) rmSync(root, { recursive: true, force: true })
