// Reviewer probe: recovery bound for the tag-collision stranding — deleting the directory by hand lets
// the tool's prune path finish; nothing in the tool itself can reach that state.
import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { resolveConfig } from "../../../../packages/mpd-worktree-plugin/src/config.ts"
import { createWorktree, removeWorktree, WorktreeError, type WorktreeDeps } from "../../../../packages/mpd-worktree-plugin/src/ops.ts"
function git(cwd: string, args: string[]): string { return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim() }
function refusal(body: () => unknown): string { try { body(); return "NO-REFUSAL" } catch (e) { return e instanceof WorktreeError ? e.code : `NON:${String(e)}` } }
const root = mkdtempSync(join(tmpdir(), "n1-review3-rec-"))
git(root, ["init", "-q", "-b", "main"]); git(root, ["config", "user.email", "a@b.c"]); git(root, ["config", "user.name", "p"])
writeFileSync(join(root, ".gitignore"), ".mpd/\n"); writeFileSync(join(root, "a.txt"), "one\n")
git(root, ["add", "."]); git(root, ["commit", "-q", "-m", "init"])
git(root, ["tag", "feature", "main"])
const deps: WorktreeDeps = { root, config: resolveConfig({ protectedBranches: [] }), log: () => undefined }
const created = createWorktree(deps, { name: "alice", branch: "feature" })
console.log("tool remove while directory present =", refusal(() => removeWorktree(deps, { name: "alice", force: true })))
rmSync(created.path, { recursive: true, force: true })
const removed = removeWorktree(deps, { name: "alice", force: true })
console.log("after manual directory deletion, remove =", JSON.stringify(removed))
const idx = JSON.parse(readFileSync(join(root, ".mpd", "worktrees", "index.json"), "utf8")) as { worktrees: Array<Record<string, unknown>> }
console.log("tombstone =", idx.worktrees[0]?.status, "branchDeleted =", removed.branchDeleted)
rmSync(root, { recursive: true, force: true })
