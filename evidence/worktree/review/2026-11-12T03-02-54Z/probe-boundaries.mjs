// T6 boundary probes: (A) the `repo` argument is executed by the UNSANDBOXED plugin process, so the
// D2 fence covers the worktree PATH only; (B) `cwdForMember` hands a reseed a directory git no longer
// manages, and `git -C <that dir>` ascends to the MAIN checkout (the hazard `recordOf` guards against).
import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

const DIST = "/home/haroldzhao/MyProj/DshProj/My-Power-Dsh/packages/mpd-worktree-plugin/dist/index.js"
const results = []
const cleanup = []
function git(cwd, args) { return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim() }
function gitOk(cwd, args) { try { execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }); return true } catch { return false } }
function repo() {
  const root = mkdtempSync(join(tmpdir(), "t6-bound-"))
  cleanup.push(root)
  git(root, ["init", "-q", "-b", "main"])
  git(root, ["config", "user.email", "r@example.com"]); git(root, ["config", "user.name", "R"])
  writeFileSync(join(root, ".gitignore"), ".mpd/\n"); writeFileSync(join(root, "a.txt"), "one\n")
  git(root, ["add", "."]); git(root, ["commit", "-q", "-m", "init"])
  return root
}
async function mount(config = {}) {
  const row = await import(pathToFileURL(DIST).href + "?v=" + Math.random())
  const tools = new Map(); const provided = new Map()
  row.apply({ get: (k) => (k === "tools" ? { register: (d) => { tools.set(d.name, d); return () => {} } } : undefined), provide: (id, v) => provided.set(id, v) }, config)
  return { tools, provided, call: (n, a) => tools.get(n).execute(a, {}) }
}
const arm = (id, ok, note) => { results.push({ id, ok, note }); console.log(`ARM ${id} ${ok ? "PASS" : "FAIL"} ${note}`) }

// (A) repo outside the workspace
{
  const ws = repo(); const outside = repo()
  process.env.DSH_WORKSPACE_ROOT = ws
  const row = await mount()
  const created = await row.call("mpd_worktree_create", { name: "x", repo: outside })
  const branchOutside = gitOk(outside, ["rev-parse", "--verify", "refs/heads/agent/x"])
  const pathInside = created.path === join(ws, ".mpd", "worktrees", "x")
  // The observation: the branch landed in a repository OUTSIDE the workspace, from the plugin process.
  arm("P25-repo-arg-reaches-outside", branchOutside && pathInside && created.repo === outside, `path=${created.path} branchInOutsideRepo=${branchOutside} repo=${created.repo} workspace=${ws}`)
}
// (B) cwdForMember + unmanaged directory
{
  const ws = repo()
  process.env.DSH_WORKSPACE_ROOT = ws
  const row = await mount()
  const service = row.provided.get("mpdWorktree")
  const created = service.createForMember(undefined, { teamId: "plan-z", member: "Senior Engineer" })
  // Out-of-band damage: the worktree's `.git` link disappears while the directory stays.
  rmSync(join(created.path, ".git"), { recursive: true, force: true })
  const handed = service.cwdForMember(undefined, { teamId: "plan-z", member: "Senior Engineer" })
  // What git answers INSIDE the directory the reseed would be given.
  const toplevel = handed === undefined ? "n/a" : git(handed, ["rev-parse", "--show-toplevel"])
  const statusPath = handed === undefined ? "n/a" : git(handed, ["rev-parse", "--abbrev-ref", "HEAD"])
  arm("P26-cwdForMember-unmanaged-dir", handed !== undefined && toplevel === ws, `handed=${handed} gitToplevelInside=${toplevel} branchSeen=${statusPath} (expected: main checkout ${ws})`)
}
for (const dir of cleanup) rmSync(dir, { recursive: true, force: true })
const failed = results.filter((r) => !r.ok)
console.log(`BOUNDARY arms=${results.length} observed=${failed.length === 0 ? "hazards-confirmed" : "mixed"} `)
