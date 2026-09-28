import { test, expect } from "bun:test"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { apply } from "../src/index.ts"
import type { DshToolDef, DshToolExec } from "../../mpd-dsh-adapter-plugin/src/index.ts"

/** One normalized memory entry, narrowed to the frontmatter field the read arms assert on. */
type MemoryEntry = {
  /** Frontmatter `kind` — note, fact or reflection — defaulting to `note` when the file declares none. */
  kind: string
}

/** `mpd_memory_write`'s answer, as the output schema the tool declares. */
type MemoryWriteResult = {
  /** Absolute path of the markdown entry that was written and committed. */
  file: string
  /** The VCS backends that accepted the commit, in the order they ran. */
  committedTo: string[]
  /** True once this write crossed the reflection threshold, so a reflection is now due. */
  reflectionDue: boolean
  /** The VCS mode the write ran under: `git`, `svn` or `both`. */
  vcs: string
}

/** `mpd_memory_read`'s answer, as the output schema the tool declares. */
type MemoryReadResult = {
  /** The matched entries, capped at the requested limit. */
  entries: MemoryEntry[]
  /** How many entries matched, counted before the limit was applied. */
  count: number
}

/** `mpd_memory_reflect`'s answer, narrowed to the due hint this arm asserts on. */
type MemoryReflectResult = {
  /** True while a reflection is pending: the step threshold was crossed or a reservation is open. */
  due: boolean
}

/** `mpd_memory_reflect_complete`'s answer, narrowed to the field this arm asserts on. */
type MemoryReflectCompleteResult = {
  /** True when the transition was written as a memory entry and the commit succeeded. */
  completed: boolean
}

/**
 * A registered tool handle whose result the arm states itself: the adapter declares every tool result
 * `unknown`, so the handle names the one output schema the arm is about to assert on.
 */
type MemoryTool<Result> = Omit<DshToolDef, "execute"> & {
  /** Run the tool body and resolve its declared output; every arm passes an empty exec context. */
  execute(args: Record<string, unknown>, exec: DshToolExec): Promise<Result>
}

/** What `makePlugin` hands an arm: the captured registrations plus the environment restore hook. */
type MountedPlugin = {
  /** Every tool definition the plugin registered, in registration order. */
  tools: DshToolDef[]
  /** Put `DSH_WORKSPACE_ROOT` back as it was; every arm calls this as its last statement. */
  restore: () => void
}

/**
 * Apply the plugin against a throwaway workspace, capturing the tools it registers.
 *
 * @param dir - the workspace the plugin must resolve through `DSH_WORKSPACE_ROOT`.
 * @param config - the row config under test (vcs mode, dir, agentSlug, reflectionEvery).
 * @returns the captured tool definitions plus a `restore` that puts the ambient root back.
 */
function makePlugin(dir: string, config: Parameters<typeof apply>[1]): MountedPlugin {
  /** Every tool definition the plugin registered, in registration order. */
  const tools: DshToolDef[] = []
  /** The row context: `tools.register` captures a definition and `tools.get` searches them by name. */
  const ctx: Parameters<typeof apply>[0] = {
    tools: {
      /** Capture one registered definition, in registration order. */
      register(d: DshToolDef): void { tools.push(d) },
      /** Answer a lookup by tool name; the plugin never reaches a service through this seam. */
      get(n: string): DshToolDef | undefined { return tools.find((t) => t.name === n) }
    }
  }
  /** The ambient workspace root this fixture replaces, so `restore` can put it back. */
  const env = process.env.DSH_WORKSPACE_ROOT
  process.env.DSH_WORKSPACE_ROOT = dir
  apply(ctx, config)
  return { tools, restore: (): void => { if (env === undefined) delete process.env.DSH_WORKSPACE_ROOT; else process.env.DSH_WORKSPACE_ROOT = env } }
}

test("git backend: write -> commit -> read -> reflection due", async () => {
  /** The throwaway workspace this arm's memory store lives under. */
  const dir = mkdtempSync(join(tmpdir(), "mpd-mem-"))
  /** The captured tools and the ambient-root restorer for this arm. */
  const { tools, restore } = makePlugin(dir, { vcs: "git", dir: ".mpd", agentSlug: "t1", reflectionEvery: 1 })
  // The write tool under test: registered unconditionally (so the lookup cannot miss), with the cast
  // stating its declared output because the adapter types every tool result `unknown`.
  const write = tools.find((t) => t.name === "mpd_memory_write") as MemoryTool<MemoryWriteResult>
  /** The write's answer: the entry path and the commit/reflection facts. */
  const res = await write.execute({ title: "first note", content: "alpha beta", kind: "note", tags: ["demo"] }, {})
  expect(res.vcs).toBe("git")
  expect(existsSync(res.file)).toBe(true)
  expect(res.reflectionDue).toBe(true)
  expect(readFileSync(res.file, "utf8")).toContain("alpha beta")
  /** The git working copy the entry was committed into. */
  const repo = join(dir, ".mpd", "memory", "agents", "t1", "repo")
  expect(existsSync(join(repo, ".git"))).toBe(true)
  // The read tool under test, cast under the same unconditional-registration and `unknown`-result contract.
  const read = tools.find((t) => t.name === "mpd_memory_read") as MemoryTool<MemoryReadResult>
  /** The read's answer: the matching entries plus the unfiltered count. */
  const entries = await read.execute({ query: "alpha" }, {})
  expect(entries.count).toBe(1)
  expect(entries.entries[0].kind).toBe("note")
  // The reflection-state tool, cast under the same unconditional-registration and `unknown`-result contract.
  const reflect = tools.find((t) => t.name === "mpd_memory_reflect") as MemoryTool<MemoryReflectResult>
  /** The reflection state before completion: this arm wrote exactly one entry at `reflectionEvery: 1`. */
  const rs = await reflect.execute({}, {})
  expect(rs.due).toBe(true)
  // The completion tool, cast under the same unconditional-registration and `unknown`-result contract.
  const complete = tools.find((t) => t.name === "mpd_memory_reflect_complete") as MemoryTool<MemoryReflectCompleteResult>
  /** The completion's answer. */
  const done = await complete.execute({ content: "reflect: keep it minimal" }, {})
  expect(done.completed).toBe(true)
  /** The reflection state after completion: the reservation is gone, so nothing is due. */
  const rs2 = await reflect.execute({}, {})
  expect(rs2.due).toBe(false)
  restore()
})

test("svn backend REAL svn CLI: repo create, checkout, commit, log", async () => {
  /** The child-process module, imported here for the two real-CLI probes. */
  const { spawnSync } = await import("node:child_process")
  /** The `svn --version` probe that decides whether this arm can run at all. */
  const probe = spawnSync("svn", ["--version", "--quiet"], { encoding: "utf8" })
  if (probe.status !== 0) return // svn not installed: skip (documented)
  /** The throwaway workspace this arm's memory store lives under. */
  const dir = mkdtempSync(join(tmpdir(), "mpd-mem-svn-real-"))
  /** The captured tools and the ambient-root restorer for this arm. */
  const { tools, restore } = makePlugin(dir, { vcs: "svn", dir: ".mpd", agentSlug: "t3" })
  // The write tool under test: registered unconditionally (so the lookup cannot miss), with the cast
  // stating its declared output because the adapter types every tool result `unknown`.
  const write = tools.find((t) => t.name === "mpd_memory_write") as MemoryTool<MemoryWriteResult>
  /** The write's answer: the entry path and the backend it committed to. */
  const res = await write.execute({ title: "real svn note", content: "hello svn" }, {})
  expect(res.vcs).toBe("svn")
  expect(res.committedTo).toEqual(["svn"])
  expect(existsSync(res.file)).toBe(true)
  /** The agent's state root, holding the repository and its working copy. */
  const root = join(dir, ".mpd", "memory", "agents", "t3")
  expect(existsSync(join(root, "svn-repo", "db"))).toBe(true)
  expect(existsSync(join(root, "repo", ".svn"))).toBe(true)
  /** The repository's own log, read with the real CLI to prove the memory commit landed. */
  const log = spawnSync("svn", ["log", "-l", "10", "file://" + join(root, "svn-repo")], { encoding: "utf8" })
  expect(log.status).toBe(0)
  expect(log.stdout).toContain("memory: real-svn-note-")
  // read back through the plugin, cast under the same `unknown`-result contract as the write handle
  const read = tools.find((t) => t.name === "mpd_memory_read") as MemoryTool<MemoryReadResult>
  /** The read's answer for the content this arm just wrote. */
  const entries = await read.execute({ query: "hello svn" }, {})
  expect(entries.count).toBe(1)
  restore()
})

test("both vcs: commits to git and svn", async () => {
  /** The child-process module, imported here for the `svnadmin` probe. */
  const { spawnSync } = await import("node:child_process")
  /** The `svnadmin --version` probe that decides whether this arm can run at all. */
  const probe = spawnSync("svnadmin", ["--version", "--quiet"], { encoding: "utf8" })
  if (probe.status !== 0) return // svn not installed: skip (documented)
  /** The throwaway workspace this arm's memory store lives under. */
  const dir = mkdtempSync(join(tmpdir(), "mpd-mem-both-"))
  /** The captured tools and the ambient-root restorer for this arm. */
  const { tools, restore } = makePlugin(dir, { vcs: "both", dir: ".mpd", agentSlug: "t4" })
  // The write tool under test: registered unconditionally (so the lookup cannot miss), with the cast
  // stating its declared output because the adapter types every tool result `unknown`.
  const write = tools.find((t) => t.name === "mpd_memory_write") as MemoryTool<MemoryWriteResult>
  /** The write's answer, which must name BOTH backends. */
  const res = await write.execute({ title: "both note", content: "dual" }, {})
  expect(res.committedTo).toEqual(["git", "svn"])
  /** The agent's state root, holding one working copy with both VCS metadata directories. */
  const root = join(dir, ".mpd", "memory", "agents", "t4")
  expect(existsSync(join(root, "repo", ".git"))).toBe(true)
  expect(existsSync(join(root, "repo", ".svn"))).toBe(true)
  restore()
})

test("svn backend wiring with fake svn CLIs", async () => {
  /** The throwaway workspace holding both the fake bin directory and the memory store. */
  const dir = mkdtempSync(join(tmpdir(), "mpd-mem-svn-"))
  /** The directory prepended to PATH so the plugin's `svn`/`svnadmin` calls hit the fakes. */
  const fakeBin = join(dir, "fakebin")
  mkdirSync(fakeBin, { recursive: true })
  /** The file both fake CLIs append their argv to, which is the wiring evidence. */
  const svnLog = join(fakeBin, "svn.log")
  // The fake CLIs must be the PLATFORM's own kind of executable. The `#!/bin/sh` fixtures below
  // are invisible to a Windows spawn (measured: `spawn error: Executable not found in $PATH:
  // "svnadmin"`), so win32 gets the same two shims as batch files with the same protocol.
  if (process.platform === "win32") {
    writeFileSync(join(fakeBin, "svnadmin.cmd"), "@echo off\r\necho %* >> \"" + svnLog + "\"\r\nif \"%1\"==\"create\" mkdir \"%2\\db\"\r\nexit /b 0\r\n")
    writeFileSync(join(fakeBin, "svn.cmd"), "@echo off\r\necho %* >> \"" + svnLog + "\"\r\nif \"%1\"==\"checkout\" mkdir \"%3\\.svn\"\r\nexit /b 0\r\n")
  } else {
    writeFileSync(join(fakeBin, "svnadmin"), "#!/bin/sh\necho \"$*\" >> " + svnLog + "\nif [ \"$1\" = create ]; then mkdir -p \"$2/db\"; fi\nexit 0\n")
    writeFileSync(join(fakeBin, "svn"), "#!/bin/sh\necho \"$*\" >> " + svnLog + "\ncase \"$1\" in\ncheckout) mkdir -p \"$3/.svn\";;\nadd|commit) :;;\nesac\nexit 0\n")
    /** The promise-based fs module, imported only for its `chmod` so the shims become executable. */
    const chmod = await import("node:fs/promises")
    await chmod.chmod(join(fakeBin, "svnadmin"), 0o755)
    await chmod.chmod(join(fakeBin, "svn"), 0o755)
  }
  /** The PATH this arm replaces, so the real system PATH is restored before the test ends. */
  const oldPath = process.env.PATH
  // The PATH separator is platform-specific (win32 uses ";"): ":" produced a single, unrunnable
  // entry on Windows, so the real system PATH disappeared from the child's environment.
  process.env.PATH = fakeBin + (process.platform === "win32" ? ";" : ":") + oldPath
  /** The captured tools and the ambient-root restorer for this arm. */
  const { tools, restore } = makePlugin(dir, { vcs: "svn", dir: ".mpd", agentSlug: "t2" })
  // The write tool under test: registered unconditionally (so the lookup cannot miss), with the cast
  // stating its declared output because the adapter types every tool result `unknown`.
  const write = tools.find((t) => t.name === "mpd_memory_write") as MemoryTool<MemoryWriteResult>
  /** The write's answer, which must report the svn backend. */
  const res = await write.execute({ title: "svn note", content: "svn content" }, {})
  expect(res.vcs).toBe("svn")
  expect(existsSync(res.file)).toBe(true)
  /** Everything both fake CLIs were asked to do, in order. */
  const log = readFileSync(svnLog, "utf8")
  expect(log).toContain("create")
  expect(log).toContain("checkout")
  expect(log).toContain("commit")
  expect(res.committedTo).toEqual(["svn"])
  process.env.PATH = oldPath
  restore()
})
