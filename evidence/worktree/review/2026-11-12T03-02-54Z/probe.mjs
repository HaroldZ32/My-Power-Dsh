// T6 Lane F — the reviewer's OWN probe of the shipped `mpd-worktree` row.
//
// Independent of the writer's unit tests: it loads the BUILT dist artifact in plain node, hands
// `apply` a fake tools service, and drives the five registered tool definitions against REAL
// temporary git repositories. Every arm prints `ARM <id> PASS|FAIL <note>`; exit 1 if any arm failed.
// Nothing here reads the package's source or its test file.
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { pathToFileURL } from "node:url"

const DIST = process.env.MPD_WORKTREE_DIST ?? "/home/haroldzhao/MyProj/DshProj/My-Power-Dsh/packages/mpd-worktree-plugin/dist/index.js"
const results = []
const cleanup = []

/** Run git in a directory and return trimmed stdout (throws on non-zero, for setup steps). */
function git(cwd, args) {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim()
}

/** Run git and answer whether it exited 0 (for probes where non-zero is an answer). */
function gitOk(cwd, args) {
  try { execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }); return true } catch { return false }
}

/** Record one arm's outcome. */
function arm(id, ok, note) {
  results.push({ id, ok, note })
  console.log(`ARM ${id} ${ok ? "PASS" : "FAIL"} ${note}`)
}

/** Build a throwaway git workspace with one commit on `main`. */
function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), "t6-wt-"))
  cleanup.push(root)
  git(root, ["init", "-q", "-b", "main"])
  git(root, ["config", "user.email", "review@example.com"])
  git(root, ["config", "user.name", "T6 Review"])
  writeFileSync(join(root, ".gitignore"), ".mpd/\n")
  writeFileSync(join(root, "a.txt"), "one\n")
  git(root, ["add", "."])
  git(root, ["commit", "-q", "-m", "init"])
  return root
}

/** Commit one file in a checkout and return the SHA. */
function commitFile(dir, file, content, message) {
  writeFileSync(join(dir, file), content)
  git(dir, ["add", file])
  git(dir, ["commit", "-q", "-m", message])
  return git(dir, ["rev-parse", "HEAD"])
}

/** Mount one row instance: a fresh tool table and the published service. */
async function mount(rowConfig) {
  const row = await import(pathToFileURL(DIST).href + "?v=" + Math.random())
  const tools = new Map()
  const provided = new Map()
  const ctx = {
    get: (key) => (key === "tools" ? { register: (def) => { tools.set(def.name, def); return () => {} } } : undefined),
    provide: (id, value) => provided.set(id, value),
  }
  row.apply(ctx, rowConfig)
  const call = async (name, args) => {
    const def = tools.get(name)
    if (def === undefined) throw new Error("tool not registered: " + name)
    return def.execute(args, {})
  }
  return { row, tools, provided, call }
}

/** Read `.mpd/worktrees/index.json` of a root. */
function readIndex(root) {
  return JSON.parse(readFileSync(join(root, ".mpd", "worktrees", "index.json"), "utf8"))
}

/** Read the row log lines of a root. */
function logLines(root) {
  const file = join(root, ".mpd", "logs", "mpd-worktree.log")
  if (!existsSync(file)) return []
  return readFileSync(file, "utf8").split("\n").filter((line) => line !== "")
}

const repo = makeRepo()
process.env.DSH_WORKSPACE_ROOT = repo

const main = await mount({})

// P1 registration
{
  const names = [...main.tools.keys()].sort()
  const expected = ["mpd_worktree_create", "mpd_worktree_list", "mpd_worktree_merge", "mpd_worktree_remove", "mpd_worktree_status"]
  const schemas = [...main.tools.values()].every((def) => def.parameters?.type === "object")
  const service = main.provided.get("mpdWorktree")
  const ok = JSON.stringify(names) === JSON.stringify(expected) && schemas && typeof service?.createForMember === "function" && typeof service?.cwdForMember === "function"
  arm("P1-registration", ok, `tools=[${names.join(",")}] objectSchemas=${schemas} service=${typeof service?.createForMember}/${typeof service?.cwdForMember} name=${main.row.name}`)
}

// P2 create
{
  const created = await main.call("mpd_worktree_create", { name: "alice" })
  const idx = readIndex(repo)
  const rec = idx.worktrees[0]
  const ok =
    created.name === "alice" && created.path === join(repo, ".mpd", "worktrees", "alice") &&
    created.branch === "agent/alice" && created.base === "main" && created.repo === repo &&
    existsSync(join(created.path, "a.txt")) && idx.version === 1 && idx.worktrees.length === 1 &&
    rec.key === "manual/alice" && rec.status === "active" && gitOk(repo, ["rev-parse", "--verify", "refs/heads/agent/alice"])
  arm("P2-create", ok, JSON.stringify({ ...created, rec: { key: rec?.key, status: rec?.status }, indexVersion: idx.version }))
}

// P3 duplicate name
{
  let ok = false
  let note = ""
  try { await main.call("mpd_worktree_create", { name: "alice" }); note = "no refusal" } catch (error) {
    ok = /already registered/.test(String(error.message)); note = String(error.message).slice(0, 160)
  }
  arm("P3-create-duplicate", ok, note)
}

// P4 existing path
{
  mkdirSync(join(repo, ".mpd", "worktrees", "occupied"), { recursive: true })
  let ok = false
  let note = ""
  try { await main.call("mpd_worktree_create", { name: "occupied" }) } catch (error) {
    ok = /already exists/.test(String(error.message)); note = String(error.message).slice(0, 160)
  }
  arm("P4-create-path-exists", ok, note)
}

// P5 slug grammar
{
  let ok = false
  let note = ""
  try { await main.call("mpd_worktree_create", { name: "Bad Name" }) } catch (error) {
    ok = /\[a-z0-9\]/.test(String(error.message)); note = String(error.message).slice(0, 160)
  }
  arm("P5-create-invalid-name", ok, note)
}

// P6 D2 outside root
{
  const outside = await mount({ dir: "../t6-outside-" + process.pid })
  let ok = false
  let note = ""
  try { await outside.call("mpd_worktree_create", { name: "bob" }) } catch (error) {
    ok = /D2/.test(String(error.message)) && /outside the workspace root/.test(String(error.message))
    note = String(error.message).slice(0, 200)
  }
  const escaped = existsSync(join(dirname(repo), "t6-outside-" + process.pid, "bob"))
  arm("P6-D2-outside-root", ok && !escaped, note + " escapedDir=" + escaped)
}

// P7 list/status divergence
{
  const created = await main.call("mpd_worktree_status", { name: "alice" })
  writeFileSync(join(created.path, "w.txt"), "work\n")
  git(created.path, ["add", "w.txt"])
  git(created.path, ["commit", "-q", "-m", "work"])
  commitFile(repo, "m.txt", "main\n", "main ahead")
  const status = await main.call("mpd_worktree_status", { name: "alice" })
  const listed = await main.call("mpd_worktree_list", {})
  const ok = status.exists === true && status.dirty === false && status.ahead === 1 && status.behind === 1 && status.merged === false &&
    Array.isArray(listed) && listed.length === 1 && listed[0].name === "alice"
  arm("P7-list-status", ok, JSON.stringify({ exists: status.exists, dirty: status.dirty, ahead: status.ahead, behind: status.behind, merged: status.merged, listed: listed.length }))
}

// P8 unknown name
{
  let ok = false
  let note = ""
  try { await main.call("mpd_worktree_status", { name: "nobody" }) } catch (error) {
    ok = /no worktree named/.test(String(error.message)) && /alice/.test(String(error.message))
    note = String(error.message).slice(0, 160)
  }
  arm("P8-status-unknown", ok, note)
}

// P9 merge success
{
  const merged = await main.call("mpd_worktree_merge", { name: "alice" })
  const head = git(repo, ["rev-parse", "HEAD"])
  const parents = git(repo, ["rev-list", "--parents", "-n", "1", "HEAD"]).split(" ")
  const subject = git(repo, ["log", "-1", "--pretty=%s"])
  const rec = readIndex(repo).worktrees.find((row) => row.name === "alice")
  const ok = merged.merged === true && merged.branch === "agent/alice" && merged.into === "main" && merged.commit === head &&
    parents.length === 3 && subject === "merge(manual/alice): agent/alice" && rec.status === "merged" &&
    (await main.call("mpd_worktree_status", { name: "alice" })).merged === true
  arm("P9-merge-success", ok, JSON.stringify({ merged: merged.merged, into: merged.into, parents: parents.length, subject, indexStatus: rec.status }))
}

// P10 conflict abort
{
  const bob = await main.call("mpd_worktree_create", { name: "bob" })
  commitFile(bob.path, "a.txt", "bob\n", "bob edit")
  const mainCommit = commitFile(repo, "a.txt", "main-edit\n", "main edit")
  const merged = await main.call("mpd_worktree_merge", { name: "bob" })
  const clean = git(repo, ["status", "--porcelain"])
  const ok = merged.merged === false && JSON.stringify(merged.conflicts) === JSON.stringify(["a.txt"]) &&
    git(repo, ["rev-parse", "HEAD"]) === mainCommit && clean === "" &&
    !existsSync(join(repo, ".git", "MERGE_HEAD")) && readFileSync(join(repo, "a.txt"), "utf8") === "main-edit\n" &&
    readIndex(repo).worktrees.find((row) => row.name === "bob").status === "active"
  arm("P10-merge-conflict", ok, JSON.stringify({ merged: merged.merged, conflicts: merged.conflicts, mainClean: clean === "", headUnmoved: git(repo, ["rev-parse", "HEAD"]) === mainCommit }))
}

// P11 protected branch
{
  const guarded = await mount({ protectedBranches: ["main"] })
  let ok = false
  let note = ""
  try { await guarded.call("mpd_worktree_merge", { name: "bob" }) } catch (error) {
    ok = /protected branch/.test(String(error.message)); note = String(error.message).slice(0, 160)
  }
  arm("P11-protected-refused", ok, note)
  const forced = await guarded.call("mpd_worktree_merge", { name: "bob", force: true })
  arm("P12-force-bypasses-protection-only", forced.merged === false && Array.isArray(forced.conflicts) && forced.conflicts.includes("a.txt"), JSON.stringify({ merged: forced.merged, conflicts: forced.conflicts }))
}

// P13/P14 dirty + detached main
{
  const dirtyRoot = makeRepo()
  process.env.DSH_WORKSPACE_ROOT = dirtyRoot
  const row = await mount({})
  const wt = await row.call("mpd_worktree_create", { name: "carol" })
  commitFile(wt.path, "c.txt", "c\n", "carol work")
  writeFileSync(join(dirtyRoot, "a.txt"), "dirty-tracked\n")
  let dirtyOk = false
  let dirtyNote = ""
  try { await row.call("mpd_worktree_merge", { name: "carol" }) } catch (error) {
    dirtyOk = /TRACKED/.test(String(error.message)); dirtyNote = String(error.message).slice(0, 140)
  }
  git(dirtyRoot, ["checkout", "-q", "--", "a.txt"])
  git(dirtyRoot, ["checkout", "-q", "--detach"])
  let detachedOk = false
  let detachedNote = ""
  try { await row.call("mpd_worktree_merge", { name: "carol" }) } catch (error) {
    detachedOk = /detached/.test(String(error.message)); detachedNote = String(error.message).slice(0, 140)
  }
  arm("P13-merge-dirty-main", dirtyOk, dirtyNote)
  arm("P14-merge-detached-main", detachedOk, detachedNote)
  git(dirtyRoot, ["checkout", "-q", "main"])
  process.env.DSH_WORKSPACE_ROOT = repo
}

// P15 remove semantics
{
  const idxBefore = readIndex(repo).worktrees.find((row) => row.name === "bob")
  let unmergedOk = false
  let unmergedNote = ""
  try { await main.call("mpd_worktree_remove", { name: "bob" }) } catch (error) {
    unmergedOk = /unmerged/.test(String(error.message)); unmergedNote = String(error.message).slice(0, 140)
  }
  const removed = await main.call("mpd_worktree_remove", { name: "bob", force: true })
  const bobRec = readIndex(repo).worktrees.find((row) => row.name === "bob")
  const again = await main.call("mpd_worktree_remove", { name: "bob" })
  const ok = idxBefore.status === "active" && unmergedOk && removed.removed === true && removed.branchDeleted === true &&
    !existsSync(removed.path) && !gitOk(repo, ["rev-parse", "--verify", "--quiet", "refs/heads/agent/bob"]) &&
    bobRec.status === "removed" && again.removed === true
  arm("P15-remove-unmerged-and-idempotent", ok, JSON.stringify({ unmergedRefused: unmergedOk, removed: removed.removed, branchDeleted: removed.branchDeleted, tombstone: bobRec.status, repeat: again.removed }) + " " + unmergedNote)
}

// P16 corrupt index tolerance
{
  const corruptRoot = makeRepo()
  process.env.DSH_WORKSPACE_ROOT = corruptRoot
  const row = await mount({})
  await row.call("mpd_worktree_create", { name: "dave" })
  writeFileSync(join(corruptRoot, ".mpd", "worktrees", "index.json"), "{ not json")
  const listed = await row.call("mpd_worktree_list", {})
  let statusOk = false
  try { await row.call("mpd_worktree_status", { name: "dave" }) } catch (error) { statusOk = /no worktree named/.test(String(error.message)) }
  arm("P16-corrupt-index-tolerant", JSON.stringify(listed) === "[]" && statusOk, "list=" + JSON.stringify(listed) + " statusRefused=" + statusOk)
  process.env.DSH_WORKSPACE_ROOT = repo
}

// P17 service create/idempotency + cwd lookup
{
  const svcRoot = makeRepo()
  process.env.DSH_WORKSPACE_ROOT = svcRoot
  const row = await mount({})
  const service = row.provided.get("mpdWorktree")
  const first = service.createForMember(undefined, { teamId: "plan-x", member: "Senior Engineer" })
  const second = service.createForMember(undefined, { teamId: "plan-x", member: "Senior Engineer" })
  const idx = readIndex(svcRoot)
  const rec = idx.worktrees[0]
  const cwd = service.cwdForMember(undefined, { teamId: "plan-x", member: "Senior Engineer" })
  const ok = first !== undefined && first.path === join(svcRoot, ".mpd", "worktrees", "plan-x", "senior-engineer") &&
    first.branch === "agent/plan-x/senior-engineer" && first.path === second.path && first.branch === second.branch &&
    idx.worktrees.length === 1 && rec.key === "plan-x/Senior Engineer" && rec.status === "active" && cwd === first.path &&
    service.cwdForMember(undefined, { teamId: "plan-x", member: "nobody" }) === undefined
  arm("P17-service-create-idempotent", ok, JSON.stringify({ path: first?.path, branch: first?.branch, key: rec?.key, cwdIsPath: cwd === first?.path }))
  rmSync(first.path, { recursive: true, force: true })
  arm("P18-service-cwd-vanished", service.cwdForMember(undefined, { teamId: "plan-x", member: "Senior Engineer" }) === undefined, "vanished directory answers undefined")
  process.env.DSH_WORKSPACE_ROOT = repo
}

// P19 degrade: non-git workspace
{
  const bare = mkdtempSync(join(tmpdir(), "t6-wt-norepo-"))
  cleanup.push(bare)
  process.env.DSH_WORKSPACE_ROOT = bare
  const row = await mount({})
  const service = row.provided.get("mpdWorktree")
  const degraded = service.createForMember(undefined, { teamId: "plan-y", member: "alice" })
  await new Promise((resolve) => setTimeout(resolve, 150))
  const lines = logLines(bare).filter((line) => line.includes("plan-y/alice"))
  arm("P19-degrade-non-git", degraded === undefined && lines.length === 1 && /shared checkout/.test(lines[0]), "answer=" + String(degraded) + " lines=" + JSON.stringify(lines))
  process.env.DSH_WORKSPACE_ROOT = repo
}

// P20 disabled row
{
  const disabledRoot = makeRepo()
  process.env.DSH_WORKSPACE_ROOT = disabledRoot
  const row = await mount({ enabled: false })
  await new Promise((resolve) => setTimeout(resolve, 150))
  const lines = logLines(disabledRoot)
  const ok = row.tools.size === 0 && row.provided.get("mpdWorktree") === undefined && lines.some((line) => /disabled by config/.test(line))
  arm("P20-disabled-row", ok, "tools=" + row.tools.size + " service=" + String(row.provided.get("mpdWorktree")) + " lines=" + JSON.stringify(lines))
  process.env.DSH_WORKSPACE_ROOT = repo
}

// P21 branch override + validation
{
  const overrideRoot = makeRepo()
  process.env.DSH_WORKSPACE_ROOT = overrideRoot
  const row = await mount({})
  const created = await row.call("mpd_worktree_create", { name: "erin", branch: "work/erin", base: "main" })
  let invalidBranch = false
  let note = ""
  try { await row.call("mpd_worktree_create", { name: "frank", branch: "-dash" }) } catch (error) {
    invalidBranch = /not a valid branch name/.test(String(error.message)); note = String(error.message).slice(0, 120)
  }
  arm("P21-branch-override-and-validation", created.branch === "work/erin" && gitOk(overrideRoot, ["rev-parse", "--verify", "refs/heads/work/erin"]) && invalidBranch, "branch=" + created.branch + " invalidRefused=" + invalidBranch + " " + note)
  process.env.DSH_WORKSPACE_ROOT = repo
}

// P22 detached base fallback
{
  const detRoot = makeRepo()
  process.env.DSH_WORKSPACE_ROOT = detRoot
  const row = await mount({})
  const sha = git(detRoot, ["rev-parse", "HEAD"])
  git(detRoot, ["checkout", "-q", "--detach"])
  const created = await row.call("mpd_worktree_create", { name: "gina" })
  arm("P22-detached-base-sha", created.base === sha, "base=" + created.base + " headSha=" + sha)
  process.env.DSH_WORKSPACE_ROOT = repo
}

// P23 index atomic write leaves no temp files behind
{
  const files = execFileSync("ls", ["-1", join(repo, ".mpd", "worktrees")], { encoding: "utf8" }).trim().split("\n")
  arm("P23-index-atomic-no-temp", files.every((name) => !name.endsWith(".tmp")), "entries=" + JSON.stringify(files))
}

for (const dir of cleanup) rmSync(dir, { recursive: true, force: true })
const failed = results.filter((row) => !row.ok)
console.log(`PROBE arms=${results.length} failed=${failed.length} verdict=${failed.length === 0 ? "PASS" : "FAIL"}`)
if (failed.length > 0) {
  for (const row of failed) console.log("FAILED " + row.id + " :: " + row.note)
  process.exit(1)
}
