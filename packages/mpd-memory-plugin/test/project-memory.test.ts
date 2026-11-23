import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { basename, join, resolve } from "node:path"
import { expect, test } from "bun:test"
import { enterSandboxHome, mount, sandbox, toolOf, type MountedPlugin } from "./support.ts"

/** One synthetic caller carries a host-shaped session id, display title and actual cwd. */
function caller(id: string, cwd: string): Record<string, unknown> {
  return { agent: { session: { id, header: { cwd, title: "Same display name" } } } }
}

/** Use actual Git checkout topology so only the identity service is a test stand-in. */
function git(cwd: string, ...args: string[]): string {
  /** The git invocation is local and creates no network connections. */
  const result = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" })
  if (result.status !== 0) throw new Error("test git " + args[0] + " failed: " + result.stderr)
  return result.stdout.trim()
}

/** Launch a fresh repository and an empty baseline commit. */
function repo(dir: string): void {
  mkdirSync(dir, { recursive: true })
  git(dir, "init", "-q")
  git(dir, "-c", "user.email=test@example.invalid", "-c", "user.name=Test", "commit", "-qm", "fixture", "--allow-empty")
}

/** Build the valid, denied and independent identity combinations for the memory handler. */
async function fixture(check: (f: { home: string; root: string; sibling: string; clone: string; other: string; plugin: MountedPlugin; services: Map<string, unknown> }) => Promise<void>): Promise<void> {
  /** Throwaway HOME and DSH_HOME guard all pre-existing memory and Git configuration. */
  const home = sandbox("mpd-project-memory-")
  /** Environment restorer for this isolated fixture. */
  const restoreHome = enterSandboxHome(home)
  /** Main checkout containing the canonical project record. */
  const root = join(home, "primary", "same-name")
  /** A checked-out linked worktree with its own cwd. */
  const sibling = join(home, "sibling")
  /** A genuine independent Git clone authorized only for a single member. */
  const clone = join(home, "approved-development-copy")
  /** An unrelated project with a matching basename and the same member id. */
  const other = join(home, "independent", "same-name")
  /** The service map is read on each invocation, matching late Cordis service reads. */
  const services = new Map<string, unknown>()
  /** Multiple callers exercise the same registered tool handles. */
  const plugin = mount(other, { agentSlug: "identical-slug", reflectionEvery: 1 }, { services })
  try {
    repo(root)
    repo(other)
    git(root, "worktree", "add", "--detach", "-q", sibling, "HEAD")
    git(root, "clone", "--no-local", "-q", root, clone)
    services.set("mpdProjectIdentity", {
      /** Stand in for the board-backed identity service agreed with T2. */
      resolveSeat({ checkoutRoot, sessionId }: { checkoutRoot: string; sessionId: string }): object {
        if (checkoutRoot === other && sessionId === "other-A") {
          return { kind: "member", checkoutRoot, projectRoot: other, projectId: "other-project", teamId: "other-board", memberId: "member-A" }
        }
        if (checkoutRoot === root || checkoutRoot === sibling || checkoutRoot === clone) {
          /** Exactly the assigned session handles admitted for the specific checkout. */
          const A = (checkoutRoot === root && sessionId === "original-A") || (checkoutRoot === sibling && sessionId === "reopened-A") || (checkoutRoot === clone && sessionId === "copied-A")
          /** The durable role authenticated by that handle and checkout pairing. */
          const memberId = A ? "member-A" : checkoutRoot !== clone && sessionId === "original-B" ? "member-B" : checkoutRoot === root && sessionId === "captain" ? "captain" : ""
          if (memberId !== "") {
            return { kind: "member", checkoutRoot, projectRoot: root, projectId: "original-project", teamId: checkoutRoot === root ? "old-board" : "new-board", memberId }
          }
        }
        return { kind: "denied" }
      },
    })
    await check({ home, root, sibling, clone, other, plugin, services })
  } finally {
    plugin.dispose()
    plugin.restore()
    restoreHome()
    rmSync(home, { force: true, recursive: true })
  }
}

/** Read results expose the exact filenames, content and version metadata selected by the tool. */
interface Page {
  /** Number of entries in the filtered set before pagination. */
  readonly count: number
  /** Offset of the next entry, if anything follows this page. */
  readonly next_offset: number | null
  /** Shared fact validity. */
  readonly validity?: string
  /** Current fact revision, even when the expected revision was superseded. */
  readonly revision?: number
  /** The tool's returned records. */
  readonly entries: ReadonlyArray<{ readonly file?: string; readonly content: string; readonly truncated?: boolean; readonly source?: string; readonly author?: string; readonly appliesTo?: string; readonly supersedes?: number }>
}

/** Tool write outcome used to locate evidence and check successful local commits. */
interface WriteResult {
  /** Absolute path of the entry persisted by the tool. */
  readonly file: string
  /** Backend errors, empty on successful commitment. */
  readonly errors: readonly string[]
  /** Only backends that wrote the entry to history. */
  readonly committedTo: readonly string[]
  /** Current shared fact revision, only present for shared writes. */
  readonly revision?: number
}

test("separates member and captain canaries and reopens a durable member across assigned checkouts", async () => {
  await fixture(async ({ root, other, sibling, clone, plugin }) => {
    /** Read and write the registered VCS-backed memory tools. */
    const write = toolOf<WriteResult>(plugin, "mpd_memory_write")
    /** The exact recall entry point. */
    const read = toolOf<Page>(plugin, "mpd_memory_read")
    /** Private canary authored and committed by one legitimately mapped caller. */
    const written = await write.execute({ title: "Private canary", content: "alpha member only", readOnly: true }, caller("original-A", root))
    expect(written.errors).toEqual([])
    /** The key handed to recall comes from the tool's output, not the store path. */
    const key = basename(written.file)
    expect((await read.execute({ key }, caller("original-B", root))).count).toBe(0)
    expect((await read.execute({ key }, caller("captain", root))).count).toBe(0)
    expect((await read.execute({ key }, caller("other-A", other))).count).toBe(0)
    expect((await read.execute({ key }, caller("reopened-A", sibling))).entries[0]?.content).toBe("alpha member only")
    expect((await read.execute({ key }, caller("copied-A", clone))).count).toBe(1)
    expect((await read.execute({ key: key.toUpperCase() }, caller("reopened-A", sibling))).count).toBe(0)
    expect((await read.execute({ scope: "legacy", key }, caller("original-B", root))).count).toBe(0)
    expect(existsSync(join(sibling, ".mpd", "memory"))).toBe(false)
    expect(existsSync(join(clone, ".mpd", "memory"))).toBe(false)
    await expect(read.execute({ key, memberId: "member-A", sessionId: "copied-A" }, caller("original-B", clone))).rejects.toThrow("no authorized project memory seat")
    /** Reflection tracking follows the same member binding and advances only in their own store. */
    const reflect = toolOf<{ due: boolean }>(plugin, "mpd_memory_reflect")
    expect((await reflect.execute({}, caller("reopened-A", sibling))).due).toBe(true)
    expect((await reflect.execute({}, caller("original-B", root))).due).toBe(false)
    expect((await reflect.execute({}, caller("captain", root))).due).toBe(false)
    await expect(reflect.execute({}, caller("helper", root))).rejects.toThrow("no authorized project memory seat")
  })
})

test("shared facts stay readable and report only successful VCS backends", async () => {
  await fixture(async ({ root, plugin }) => {
    /** The registered tool owns shared publication and authenticated receipts. */
    const write = toolOf<WriteResult>(plugin, "mpd_memory_write")
    /** An initial revision creates the shared store and the Git metadata. */
    const fact = { scope: "shared", key: "receipt", source: "src/rpc.ts@base", appliesTo: "api-v1", title: "Receipt", content: "first" }
    /** The first commit identifies the exact shared Git working copy. */
    const first = await write.execute(fact, caller("original-A", root))
    expect(first.committedTo).toEqual(["git"])
    /** Refuse the next commit through Git while leaving its working-copy bytes available. */
    const repoPath = resolve(first.file, "../../..")
    writeFileSync(join(repoPath, ".git", "hooks", "pre-commit"), "#!/bin/sh\necho 'shared fixture rejected commit' >&2\nexit 1\n", { mode: 0o755 })
    /** Another authorized member can publish and read the new local revision. */
    const next = await write.execute({ ...fact, supersedes: 1, content: "second" }, caller("original-B", root))
    expect(next).toMatchObject({ revision: 2, committedTo: [], errors: [expect.stringContaining("shared fixture rejected commit")] })
    expect(readFileSync(next.file, "utf8")).toContain("second")
  })
})

test("publishes sourced shared facts explicitly and withholds stale or inapplicable content", async () => {
  await fixture(async ({ root, other, sibling, plugin }) => {
    /** Shared publication uses the same registered write tool with a deliberate scope. */
    const write = toolOf<WriteResult>(plugin, "mpd_memory_write")
    /** The shared view never searches private, legacy or global memory. */
    const read = toolOf<Page>(plugin, "mpd_memory_read")
    /** Fields common to both revisions. */
    const initial = { scope: "shared", key: "rpc-interface", source: "src/rpc.ts@base", appliesTo: "api-v1", title: "Interface", content: "old signature" }
    await expect(write.execute({ ...initial, source: undefined }, caller("original-A", root))).rejects.toThrow("source")
    await expect(write.execute({ ...initial, scope: undefined }, caller("original-A", root))).rejects.toThrow("require shared scope")
    expect((await write.execute(initial, caller("original-A", root))).revision).toBe(1)
    expect((await read.execute({ scope: "shared", key: initial.key, appliesTo: "api-v1" }, caller("original-B", root))).entries[0]).toMatchObject({ source: "src/rpc.ts@base", content: "old signature", author: "member-A" })
    await expect(write.execute({ ...initial, content: "unacknowledged overwrite" }, caller("original-B", root))).rejects.toThrow("revision conflict")
    /** The second member references the current version and publishes current applicability. */
    const second = await write.execute({ ...initial, supersedes: 1, source: "src/rpc.ts@new", appliesTo: "api-v2", content: "current signature" }, caller("original-B", root))
    expect(second.revision).toBe(2)
    expect(second.errors).toEqual([])
    expect(readFileSync(second.file, "utf8")).toContain("current signature")
    expect(await read.execute({ scope: "shared", key: initial.key, revision: 1 }, caller("reopened-A", sibling))).toMatchObject({ validity: "superseded", entries: [], revision: 2 })
    expect(await read.execute({ scope: "shared", key: initial.key, appliesTo: "api-v1" }, caller("reopened-A", sibling))).toMatchObject({ validity: "not-applicable", entries: [], revision: 2 })
    expect(await read.execute({ scope: "shared", key: initial.key, revision: 3 }, caller("reopened-A", sibling))).toMatchObject({ validity: "revision-mismatch", entries: [], revision: 2 })
    expect((await read.execute({ scope: "shared", key: initial.key, appliesTo: "api-v2" }, caller("captain", root))).entries[0]).toMatchObject({ content: "current signature", author: "member-B", appliesTo: "api-v2", supersedes: 1 })
    expect((await read.execute({ scope: "shared", key: initial.key }, caller("other-A", other))).validity).toBe("missing")
    expect((await read.execute({ query: "current signature" }, caller("original-B", root))).count).toBe(0)
    await expect(read.execute({ scope: "shared", key: initial.key }, caller("helper", root))).rejects.toThrow("no authorized project memory seat")
  })
})

test("keeps unattributed data explicitly readable and standalone callers on their old store", async () => {
  await fixture(async ({ root, plugin, services }) => {
    /** This directory predates durable member identity. */
    const legacy = join(root, ".mpd", "memory", "agents", "identical-slug", "repo", "memory")
    mkdirSync(legacy, { recursive: true })
    writeFileSync(join(legacy, "legacy.md"), "old unattributed bytes")
    /** Read the mounted tool with and without a project authority. */
    const read = toolOf<Page>(plugin, "mpd_memory_read")
    expect((await read.execute({ key: "legacy.md" }, caller("original-A", root))).count).toBe(0)
    expect((await read.execute({ scope: "legacy", key: "legacy.md" }, caller("original-A", root))).entries[0]?.content).toBe("old unattributed bytes")
    services.set("mpdProjectIdentity", { resolveSeat: () => ({ kind: "unbound" }) })
    expect((await read.execute({ key: "legacy.md" }, caller("plain", root))).count).toBe(1)
    await expect(read.execute({ scope: "shared", key: "legacy.md" }, caller("plain", root))).rejects.toThrow("authorized project seat")
    services.delete("mpdProjectIdentity")
    expect((await read.execute({ key: "legacy.md" }, caller("plain", root))).count).toBe(1)
  })
})

test("bounds both structured memory and rendered tool text while pagination remains contiguous", async () => {
  await fixture(async ({ root, plugin }) => {
    /** Pin ten oversized files with escaping-heavy Unicode/control text. */
    const status = toolOf<{ root: string }>(plugin, "mpd_memory_status")
    /** A member path is created only once fixtures explicitly seed it. */
    const exec = caller("original-A", root)
    /** Repository layout for this authenticated member's markdown entries. */
    const dir = join((await status.execute({}, exec)).root, "repo", "memory")
    mkdirSync(dir, { recursive: true })
    for (let i = 0; i < 10; i += 1) writeFileSync(join(dir, `large-${i}.md`), ("\u0000😃汉").repeat(4000))
    /** The read limit is the caller's desired item count before applying the byte ceiling. */
    const read = toolOf<Page>(plugin, "mpd_memory_read")
    /** First page for all ten matches, emitted below as a replay metric. */
    const first = await read.execute({ limit: 50 }, exec)
    expect(first.count).toBe(10)
    expect(first.entries.every((entry) => entry.truncated)).toBe(true)
    // The installed host refuses a tool result if serializing it would drop an optional key.
    expect(JSON.parse(JSON.stringify(first))).toStrictEqual(first)
    expect(first.next_offset).toBe(first.entries.length)
    /** Measure real serialized payload and rendered text including escaping. */
    const bytes = Buffer.byteLength(JSON.stringify(first))
    /** The text renderer called by the real adapter returns an array of text blocks. */
    const rendered = read.output?.render?.({}, first)
    expect(bytes).toBeLessThan(8192)
    expect(Buffer.byteLength(JSON.stringify(rendered))).toBeLessThan(10240)
    expect((await read.execute({ offset: first.next_offset }, exec)).entries[0]?.file).toBe(`large-${first.next_offset}.md`)
    console.log(`project-memory: matches=${first.count} page=${first.entries.length} resultBytes=${bytes} renderedEnvelopeBytes=${Buffer.byteLength(JSON.stringify(rendered))}`)
  })
})
