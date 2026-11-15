// N1 re-verification probe (review2): the F1 vanished-directory prune WITHOUT `force`, the call a user
// makes when retrying after a crash between the branch delete and the index tombstone.
import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { resolveConfig } from "../../../../packages/mpd-worktree-plugin/src/config.ts"
import { createWorktree, removeWorktree, WorktreeError, type WorktreeDeps } from "../../../../packages/mpd-worktree-plugin/src/ops.ts"

function git(cwd: string, args: string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim()
}
function sandbox(): WorktreeDeps & { root: string } {
  const root = mkdtempSync(join(tmpdir(), "n1-review2-noforce-"))
  git(root, ["init", "-q", "-b", "main"])
  git(root, ["config", "user.email", "agent@example.com"])
  git(root, ["config", "user.name", "N1 Review NoForce Probe"])
  writeFileSync(join(root, ".gitignore"), ".mpd/\n")
  writeFileSync(join(root, "a.txt"), "one\n")
  git(root, ["add", "."])
  git(root, ["commit", "-q", "-m", "init"])
  return { root, config: resolveConfig(), log: [] as string[] } as WorktreeDeps & { root: string }
}
function refusal(body: () => unknown): string {
  try { body(); return "NO-REFUSAL" } catch (e) { return e instanceof WorktreeError ? e.code : `NON-WORKTREE:${String(e)}` }
}

const deps = sandbox()
const created = createWorktree(deps, { name: "alice" })
rmSync(created.path, { recursive: true, force: true })
git(deps.root, ["worktree", "prune"])
git(deps.root, ["branch", "-D", "agent/alice"])
let removed: { removed: boolean; branchDeleted: boolean } | undefined
let thrown = ""
try { removed = removeWorktree(deps, { name: "alice" }) } catch (e) { thrown = e instanceof WorktreeError ? e.code : String(e) }
const index = JSON.parse(readFileSync(join(deps.root, ".mpd", "worktrees", "index.json"), "utf8")) as { worktrees: Array<Record<string, unknown>> }
const recreate = refusal(() => createWorktree(deps, { name: "alice" }))
console.log(JSON.stringify({
  removeWithoutForce: thrown === "" ? "NO-REFUSAL" : thrown,
  removed: removed?.removed,
  branchDeleted: removed?.branchDeleted,
  status: index.worktrees[0]?.status,
  recreate,
}))
rmSync(deps.root, { recursive: true, force: true })
