// F4 repair probe: the reviewer's probe-edge shape, now expecting a typed creation refusal instead of
// a stranded record. Drives packages/mpd-worktree-plugin/src directly against a throwaway repository.
import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { resolveConfig, type Config } from "../../../../packages/mpd-worktree-plugin/src/config.ts"
import { createWorktree, removeWorktree, WorktreeError, type WorktreeDeps } from "../../../../packages/mpd-worktree-plugin/src/ops.ts"

const roots: string[] = []
function git(cwd: string, args: string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim()
}
function gitOk(cwd: string, args: string[]): boolean {
  try { execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "ignore", "ignore"] }); return true } catch { return false }
}
function sandbox(overrides: Partial<Config> = {}): WorktreeDeps & { root: string } {
  const root = mkdtempSync(join(tmpdir(), "n1-fix-f4-"))
  roots.push(root)
  git(root, ["init", "-q", "-b", "main"])
  git(root, ["config", "user.email", "agent@example.com"])
  git(root, ["config", "user.name", "N1 F4 Repair Probe"])
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
  // The branch does NOT exist yet, which is exactly when the pre-fix `git worktree add -b <protected>` succeeded.
  const createCode = refusal(() => createWorktree(deps, { name: "alice", branch: protectedName }))
  const indexFile = join(deps.root, ".mpd", "worktrees", "index.json")
  const recordPresent = existsSync(indexFile)
  const recorded = recordPresent
    ? String((JSON.parse(readFileSync(indexFile, "utf8")) as { worktrees: Array<Record<string, unknown>> }).worktrees[0]?.branch)
    : "none"
  const branchExists = gitOk(deps.root, ["rev-parse", "--verify", "refs/heads/" + protectedName])
  const dirExists = existsSync(join(deps.root, ".mpd", "worktrees", "alice"))
  const removeCode = refusal(() => removeWorktree(deps, { name: "alice", force: true }))
  // A normal create on the same NAME must succeed: the refusal registered nothing and left no branch.
  const recreateCode = refusal(() => createWorktree(deps, { name: "alice" }))
  console.log(
    `protected=${protectedName} create=${createCode} recordPresent=${recordPresent} recorded=${recorded} ` +
      `branchExists=${branchExists} dirExists=${dirExists} remove(force:true)=${removeCode} recreate=${recreateCode}`,
  )
}
for (const root of roots) rmSync(root, { recursive: true, force: true })
