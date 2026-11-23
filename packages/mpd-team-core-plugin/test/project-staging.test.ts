import { afterEach, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { admitTeam } from "../src/project-admission"
import { adoptProjectStage, readProjectStage, withProjectStage } from "../src/project-staging"
import { locateProject, withProjectLock } from "../src/project-store"
import { stagePlan, stagingPath, writePlan } from "../src/plan-store"
import { createTeam } from "../src/team-store"

/** Fresh project roots are isolated from the actual checkout and its admission locks. */
const sandboxes: string[] = []
afterEach(() => { for (const root of sandboxes.splice(0)) rmSync(root, { recursive: true, force: true }) })

/** Let Git itself register the linked and independent checkout identities. */
function git(cwd: string, ...args: string[]): void {
  /** Every invocation uses this case's sandbox cwd. */
  const child = spawnSync("git", args, { cwd, encoding: "utf8" })
  if (child.status !== 0) throw new Error(child.stderr)
}

/** A source draft, a first admitted sibling, and an independent clone. */
function fixture(): { origin: string; winner: string; clone: string } {
  /** All board state is written under this fresh Git test root. */
  const root = mkdtempSync(join(tmpdir(), "mpd-stage-adoption-"))
  sandboxes.push(root)
  /** Git's primary checkout and shared common directory. */
  const primary = join(root, "primary")
  /** The draft's authorized physical checkout. */
  const origin = join(root, "origin")
  /** The first admitted sibling's board root. */
  const winner = join(root, "winner")
  /** The negative control has the same history but independent Git metadata. */
  const clone = join(root, "clone")
  git(root, "init", "-q", primary)
  git(primary, "-c", "user.name=QA", "-c", "user.email=qa@example.test", "commit", "-qm", "fixture", "--allow-empty")
  git(primary, "worktree", "add", "-q", "--detach", origin, "HEAD")
  git(primary, "worktree", "add", "-q", "--detach", winner, "HEAD")
  git(primary, "clone", "--no-local", "-q", primary, clone)
  admitTeam({ workspace: winner, sessionId: "winner", planId: "winner", planName: "winner", members: [] }, (workspace) => createTeam(workspace, { name: "winner", description: "existing board", leadSessionId: "winner" }, new Date()))
  return { origin, winner, clone }
}

test("the owning session finds its physical draft after binding, but a peer or independent checkout cannot borrow it", () => {
  /** A migrated workspace with an existing losing stage. */
  const f = fixture()
  /** Stage directly to model a file created by the older plugin before project binding. */
  const original = stagePlan(f.origin, "owner", { name: "keep", description: "original stage", approval: "required" }, new Date())
  expect(readProjectStage(f.winner, "owner").plan).toEqual(original)
  expect(readProjectStage(f.winner, "peer").plan).toBeUndefined()
  expect(readProjectStage(f.clone, "owner").plan).toBeUndefined()
  withProjectStage(f.winner, "owner", (slot) => {
    if (slot.plan === undefined) throw new Error("original stage was lost")
    writePlan(slot.workspace, { ...slot.plan, description: "still owned" })
  })
  expect(readProjectStage(f.winner, "owner").plan).toEqual({ ...original, description: "still owned" })
})

test("the next mutation completes equal-copy recovery but refuses competing drafts", () => {
  /** Simulate interruption after exclusive publication and before old-slot cleanup. */
  const f = fixture()
  /** The original plan identity and exact source bytes. */
  const original = stagePlan(f.origin, "owner", { name: "keep", description: "original stage", approval: "required" }, new Date())
  /** The two authorized paths from the interrupted adoption. */
  const origin = stagingPath(f.origin, "owner")
  /** Canonical destination has equal bytes until the recovery completes. */
  const target = stagingPath(f.winner, "owner")
  mkdirSync(dirname(target), { recursive: true })
  copyFileSync(origin, target)
  expect(readProjectStage(f.winner, "owner").plan).toEqual(original)
  withProjectStage(f.winner, "owner", (slot) => {
    if (slot.plan === undefined) throw new Error("interrupted draft was lost")
    writePlan(slot.workspace, { ...slot.plan, description: "safe edit" })
  })
  expect(existsSync(origin)).toBe(false)
  /** Two different owner drafts are deliberately ambiguous; neither may be replaced. */
  const separate = stagePlan(f.origin, "owner", { name: "other", description: "competing draft", approval: "required" }, new Date())
  /** Snapshot before the attempted reserve. */
  const before = readFileSync(target, "utf8")
  expect(() => withProjectLock(locateProject(f.winner), (location) => adoptProjectStage(location, f.winner, separate))).toThrow(/conflicting staged plans/)
  expect(readFileSync(target, "utf8")).toBe(before)
  expect(existsSync(origin)).toBe(true)
})

test("adoption preserves exact source bytes and refuses to approve a stale edit snapshot", () => {
  /** The test reads only synthetic state under a registered Git common directory. */
  const f = fixture()
  /** The exact draft the asynchronous approval originally saw. */
  const original = stagePlan(f.origin, "owner", { name: "keep", description: "original stage", approval: "required" }, new Date())
  /** A legitimate edit that wins while the old approval is doing asynchronous route work. */
  const current = { ...original, description: "newer draft", tasks: [{ subject: "review", description: "keep fields", kind: "review" as const, blockedBy: ["1"] }] }
  writePlan(f.origin, current)
  /** Reject the stale revision before any board or roster can publish. */
  const origin = stagingPath(f.origin, "owner")
  /** The canonical adoption target. */
  const target = stagingPath(f.winner, "owner")
  expect(() => withProjectLock(locateProject(f.winner), (location) => adoptProjectStage(location, f.winner, original))).toThrow(/changed before approval/)
  expect(existsSync(target)).toBe(false)
  /** Copy the winning revision without re-encoding its kind/dependency metadata. */
  const expected = readFileSync(origin, "utf8")
  withProjectLock(locateProject(f.winner), (location) => adoptProjectStage(location, f.winner, current))
  expect(readFileSync(target, "utf8")).toBe(expected)
  expect(existsSync(origin)).toBe(false)
})

test("a linked checkout's staged path cannot traverse a symlink into an independent clone", () => {
  /** Same-named user files in these checkouts have independent authority. */
  const f = fixture()
  stagePlan(f.clone, "owner", { name: "foreign", description: "private", approval: "required" }, new Date())
  symlinkSync(join(f.clone, ".mpd"), join(f.origin, ".mpd"), "dir")
  expect(() => readProjectStage(f.winner, "owner")).toThrow(/escapes its registered checkout/)
})
