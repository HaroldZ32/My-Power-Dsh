import { expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { appendFileSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { basename, delimiter, join } from "node:path"
import { enterSandboxHome, mount, sandbox, toolOf } from "./support.ts"

/** Tool results shared by ordinary writes and reflection completion. */
interface BackendReceipt {
  /** The plaintext entry's path in the working copy. */
  readonly file: string
  /** Backends that successfully recorded the entry. */
  readonly committedTo: readonly string[]
  /** The backend-specific failures. */
  readonly errors: readonly string[]
}

/** Reflection completion reports whether all requested backends succeeded. */
interface ReflectionReceipt extends BackendReceipt {
  /** Whether the claim was settled. */
  readonly completed: boolean
}

/** The part of the public reflection state this regression compares. */
interface ReflectionStatus {
  /** Whether completion is still owed. */
  readonly due: boolean
  /** Counters that may only advance/reset together on successful completion. */
  readonly state: { readonly reflectionsCompleted: number; readonly stepsSinceReflection: number }
}

for (const scope of ["workspace", "global"] as const) {
  test(`${scope} write reports Git failure while retaining the plaintext entry`, async () => {
    /** Both stores and the adapter log are isolated under a throwaway root. */
    const root = sandbox("mpd-memory-write-backend-")
    /** The environment exit that restores the real user's home settings. */
    const leave = enterSandboxHome(root)
    /** The mounted tool writes only to the sandbox. */
    const plugin = mount(root, { vcs: "git", agentSlug: "recovery" })
    try {
      /** Scope-aware public write tool. */
      const write = toolOf<BackendReceipt>(plugin, "mpd_memory_write")
      /** Input for a successful write that bootstraps the sandbox repository. */
      const initial = { title: "first", content: "git seed", scope }
      expect((await write.execute(initial, {})).committedTo).toEqual(["git"])
      /** Where this scope stores its Git working copy. */
      const store = scope === "global" ? join(root, ".mpd", "memory") : join(root, ".mpd", "memory", "agents", "recovery")
      /** The two scopes exercise failures from different steps of the backend. */
      const diagnostic = scope === "workspace" ? "git commit failed" : "git add failed"
      if (scope === "workspace") {
        mkdirSync(join(store, "repo", ".git", "hooks"), { recursive: true })
        writeFileSync(join(store, "repo", ".git", "hooks", "pre-commit"), "#!/bin/sh\necho 'fixture rejected commit' >&2\nexit 1\n", { mode: 0o755 })
      } else {
        writeFileSync(join(store, "repo", ".git", "index.lock"), "fixture")
      }
      /** The second write is independent from the seeded entry. */
      const args = { title: "second", content: "plaintext retained", scope }
      /** Working-copy write can succeed while the backend has an error. */
      const result = await write.execute(args, {})
      expect(readFileSync(result.file, "utf8")).toContain("plaintext retained")
      expect(result.errors.join("\n")).toContain(diagnostic)
      expect(result.committedTo).toEqual([])
      expect(JSON.stringify(await write.output?.render?.(args, result))).toContain(diagnostic)
    } finally {
      plugin.restore()
      leave()
      rmSync(root, { recursive: true, force: true })
    }
  })
}

test("reflection stays due after Git failure and retry settles the same entry once", async () => {
  /** Disposable root containing the entire agent repository and state. */
  const workspace = sandbox("mpd-memory-reflection-backend-")
  /** Isolate host and user home roots along with the workspace. */
  const leave = enterSandboxHome(workspace)
  /** The mounted tools trigger reflection after one write. */
  const plugin = mount(workspace, { vcs: "git", agentSlug: "recovery", reflectionEvery: 1 })
  try {
    /** The note write that deliberately raises a reflection claim. */
    const write = toolOf<BackendReceipt>(plugin, "mpd_memory_write")
    /** Public reflection state inspection before and after settlement. */
    const reflect = toolOf<ReflectionStatus>(plugin, "mpd_memory_reflect")
    /** The completion tool called both before and after backend recovery. */
    const complete = toolOf<ReflectionReceipt>(plugin, "mpd_memory_reflect_complete")
    await write.execute({ title: "first", content: "raise a claim" }, {})
    /** The store paths are solely inside this test's sandbox. */
    const store = join(workspace, ".mpd", "memory", "agents", "recovery")
    /** The Git repository holding this agent's entries. */
    const repo = join(store, "repo")
    /** Backend fault injected without editing existing entry bytes. */
    const lock = join(repo, ".git", "index.lock")
    writeFileSync(lock, "fixture")
    /** The submission retried after backend recovery. */
    const payload = { title: "retryable", content: "reflection body" }
    /** A backend failure leaves a file on disk and keeps the claim open. */
    const failed = await complete.execute(payload, {})
    expect(failed.completed).toBe(false)
    expect(failed.committedTo).toEqual([])
    expect(failed.errors.join("\n")).toContain("git add failed")
    expect(JSON.stringify(await complete.output?.render?.(payload, failed))).toContain("git add failed")
    expect(readFileSync(failed.file, "utf8")).toContain("reflection body")
    expect(await reflect.execute({}, {})).toMatchObject({ due: true, state: { reflectionsCompleted: 0, stepsSinceReflection: 1 } })

    await expect(complete.execute({ ...payload, content: "changed payload" }, {})).rejects.toThrow("original title and content")
    rmSync(lock)
    /** Fail local journaling after Git succeeds by temporarily replacing the journal with a directory. */
    const journalPath = join(store, "runtime", "journal.jsonl")
    /** The original journal is restored before retry. */
    const savedJournal = journalPath + ".saved"
    renameSync(journalPath, savedJournal)
    mkdirSync(journalPath)
    await expect(complete.execute(payload, {})).rejects.toThrow()
    expect(await reflect.execute({}, {})).toMatchObject({ due: true, state: { reflectionsCompleted: 0, stepsSinceReflection: 1 } })
    rmSync(journalPath, { recursive: true })
    renameSync(savedJournal, journalPath)
    // Model an interruption after a complete JSON object reached disk but before its final LF.
    appendFileSync(journalPath, JSON.stringify({ kind: "reflection", file: basename(failed.file) }))
    /** Recovered completion must settle the original file. */
    const done = await complete.execute(payload, {})
    expect(done).toMatchObject({ completed: true, file: failed.file, committedTo: ["git"], errors: [] })
    expect(await complete.execute(payload, {})).toEqual(done)
    expect(await reflect.execute({}, {})).toMatchObject({ due: false, state: { reflectionsCompleted: 1, stepsSinceReflection: 0 } })
    expect(readdirSync(join(repo, "memory")).filter((file) => file.startsWith("reflection-"))).toEqual([basename(done.file)])
    /** Git's history for the reflection, counted independently of the tool receipt. */
    const history = spawnSync("git", ["rev-list", "--count", "HEAD", "--", "memory/" + basename(done.file)], { cwd: repo, encoding: "utf8" })
    expect(history.status).toBe(0)
    expect(history.stdout.trim()).toBe("1")
    /** Completed reflections are journaled exactly once. */
    const journal = readFileSync(join(store, "runtime", "journal.jsonl"), "utf8").split("\n")
    expect(journal.filter((line) => line.includes('"kind":"reflection"'))).toHaveLength(1)
  } finally {
    plugin.restore()
    leave()
    rmSync(workspace, { recursive: true, force: true })
  }
})

for (const ending of ['{"kind":"reflection","file":', '{"kind":"legacy","note":"café"}']) {
  test(`reflection repairs an unterminated journal and concurrent retries converge (${ending})`, async () => {
    /** All user data and VCS operations are isolated in this store. */
    const workspace = sandbox("mpd-memory-torn-reflection-")
    /** The Git subprocesses inherit isolated home settings. */
    const leave = enterSandboxHome(workspace)
    /** A single note is enough to raise a claim. */
    const plugin = mount(workspace, { vcs: "git", agentSlug: "torn", reflectionEvery: 1 })
    try {
      /** The note and its journal entry predate the torn tail. */
      const note = await toolOf<BackendReceipt>(plugin, "mpd_memory_write").execute({ title: "first", content: "prior café bytes" }, {})
      /** The prior note must survive the retry byte for byte. */
      const noteBytes = readFileSync(note.file)
      /** The store's runtime and Git repository share this disposable prefix. */
      const store = join(workspace, ".mpd", "memory", "agents", "torn")
      /** Append a partial or legacy complete record lacking a final LF. */
      const journal = join(store, "runtime", "journal.jsonl")
      appendFileSync(journal, ending)
      /** Preserve all supplied bytes, including the incomplete record, in place. */
      const previous = readFileSync(journal, "utf8")
      /** Reflection is due until Git and journaling are both complete. */
      const reflect = toolOf<ReflectionStatus>(plugin, "mpd_memory_reflect")
      /** Same submission throughout the failure, retry and replay. */
      const payload = { title: "recover", content: "reflection body" }
      /** The public completion tool receives both retry calls. */
      const complete = toolOf<ReflectionReceipt>(plugin, "mpd_memory_reflect_complete")
      /** Block the real Git backend on the first submission. */
      const lock = join(store, "repo", ".git", "index.lock")
      writeFileSync(lock, "fixture")
      /** The first attempt reserves the entry while leaving the claim due. */
      const failed = await complete.execute(payload, {})
      expect(failed.completed).toBe(false)
      expect(await reflect.execute({}, {})).toMatchObject({ due: true })
      expect(readFileSync(journal, "utf8")).toBe(previous)
      rmSync(lock)

      /** Overlapping public calls must report the same single settlement. */
      const [settled, replay] = await Promise.all([complete.execute(payload, {}), complete.execute(payload, {})])
      expect(settled).toEqual({ completed: true, file: failed.file, committedTo: ["git"], errors: [] })
      expect(replay).toEqual(settled)
      expect(await reflect.execute({}, {})).toMatchObject({ due: false, state: { reflectionsCompleted: 1, stepsSinceReflection: 0 } })
      /** A readable reflection record has its own line and can be parsed independently. */
      const after = readFileSync(journal, "utf8")
      expect(after.startsWith(previous + "\n")).toBe(true)
      /** The suffix must contain exactly one parseable reflection row. */
      const added = after.slice(previous.length).trim().split("\n")
      expect(added).toHaveLength(1)
      expect(JSON.parse(added[0])).toMatchObject({ kind: "reflection", file: basename(failed.file) })
      expect(readFileSync(note.file)).toEqual(noteBytes)
      expect(await complete.execute(payload, {})).toEqual(settled)
      expect(readFileSync(journal, "utf8")).toBe(after)

      // Simulate a legacy tool that settled the state after concatenating records in one line.
      /** Preserve the old malformed line when recovering an already-settled receipt. */
      const legacy = previous + added[0] + "\n"
      writeFileSync(journal, legacy)
      expect(await complete.execute(payload, {})).toEqual(settled)
      /** Only a new parseable record is appended on recovery, with no second counter advance. */
      const recovered = readFileSync(journal, "utf8")
      expect(recovered.startsWith(legacy)).toBe(true)
      expect(JSON.parse(recovered.slice(legacy.length))).toMatchObject({ kind: "reflection", file: basename(failed.file) })
      expect(await reflect.execute({}, {})).toMatchObject({ due: false, state: { reflectionsCompleted: 1 } })
      expect(await complete.execute(payload, {})).toEqual(settled)
      expect(readFileSync(journal, "utf8")).toBe(recovered)
    } finally {
      plugin.restore()
      leave()
      rmSync(workspace, { recursive: true, force: true })
    }
  })
}

test.skipIf(process.platform === "win32")("both mode commits independently and retries only the unfinished backend", async () => {
  /** All working copies, executable fixtures and logs live in this disposable root. */
  const root = sandbox("mpd-memory-dual-recovery-")
  /** Environment state restored after the fake Subversion executable is removed. */
  const originalPath = process.env.PATH
  /** Fixture directory prepended to PATH; Git still uses the real executable. */
  const bin = join(root, "bin")
  /** Isolate Git's global config and the host's own settings. */
  const leave = enterSandboxHome(root)
  /** A second mount must be able to recover the original claim from disk. */
  const config = { vcs: "both", agentSlug: "dual-recovery", reflectionEvery: 1 } as const
  /** The active mount changes between the failed and successful returns. */
  let plugin = mount(root, config)
  try {
    mkdirSync(bin)
    writeFileSync(join(bin, "svnadmin"), '#!/bin/sh\nmkdir -p "$2/db"\n', { mode: 0o755 })
    writeFileSync(join(bin, "svn"), '#!/bin/sh\ncase "$1" in\ncheckout) mkdir -p "$3/.svn";;\nadd) if [ -f .block-svn ]; then echo "fixture add failure" >&2; exit 1; fi;;\ncommit) printf "%s\\n" "$*" >> .svn/fixture-commits;;\nesac\n', { mode: 0o755 })
    process.env.PATH = bin + delimiter + (originalPath ?? "")
    /** A normal write in both mode must also show a partial receipt. */
    const write = toolOf<BackendReceipt>(plugin, "mpd_memory_write")
    /** Repository path inside the isolated store. */
    const repo = join(root, ".mpd", "memory", "agents", "dual-recovery", "repo")
    mkdirSync(repo, { recursive: true })
    /** Inject an SVN staging failure even though the SVN commit command would succeed. */
    const marker = join(repo, ".block-svn")
    writeFileSync(marker, "fail")
    expect(await write.execute({ title: "partial", content: "still committed to Git" }, {})).toMatchObject({ committedTo: ["git"], errors: [expect.stringContaining("svn add failed")] })
    /** Public completion before unblocking SVN. */
    const complete = toolOf<ReflectionReceipt>(plugin, "mpd_memory_reflect_complete")
    /** The reflection bytes to replay on the next mount. */
    const payload = { title: "dual", content: "one saved file" }
    /** Git is confirmed, but SVN still owes this same entry. */
    const partial = await complete.execute(payload, {})
    expect(partial).toMatchObject({ completed: false, committedTo: ["git"], errors: [expect.stringContaining("svn add failed")] })
    // Another note increments the counter without replacing the in-progress claim.
    await write.execute({ title: "new note", content: "keep the existing claim" }, {})
    plugin.restore()
    plugin = mount(root, config)
    rmSync(marker)
    // This lock makes another Git stage fail and proves that recovery visits only unfinished SVN.
    writeFileSync(join(repo, ".git", "index.lock"), "fixture")
    /** Remounted completion uses the persisted file path and backend results. */
    const recovered = await toolOf<ReflectionReceipt>(plugin, "mpd_memory_reflect_complete").execute(payload, {})
    expect(recovered).toEqual({ completed: true, file: partial.file, committedTo: ["git", "svn"], errors: [] })
    expect(readFileSync(join(repo, ".svn", "fixture-commits"), "utf8").trim().split("\n")).toEqual([expect.stringContaining("memory: reflection")])
  } finally {
    plugin.restore()
    leave()
    if (originalPath === undefined) delete process.env.PATH
    else process.env.PATH = originalPath
    rmSync(root, { recursive: true, force: true })
  }
})
