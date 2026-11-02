// THE GLOBAL STORE AND THE SCOPE PARAMETER (wave W3-D, decision D6).
//
// Every arm runs with `HOME`/`DSH_HOME` pointed at a mkdtemp sandbox (T-43), so the real
// `~/.mpd/memory` can never be written from here: the plugin derives the global root from `$HOME`
// and the shared guard refuses a root outside it.
import { afterAll, expect, test } from "bun:test"
import { existsSync, readFileSync, rmSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { join, sep } from "node:path"
import { enterSandboxHome, mount, sandbox, toolOf } from "./support.ts"

/** `mpd_memory_write`'s answer, as the output schema the tool declares. */
type MemoryWriteResult = {
  /** Absolute path of the markdown entry that was written and committed. */
  file: string
  /** The VCS backends that accepted the commit. */
  committedTo: string[]
  /** True once the workspace reflection claim stands (a global write only reports it). */
  reflectionDue: boolean
  /** The VCS mode the write ran under. */
  vcs: string
  /** The store the call addressed. */
  scope: string
}

/** `mpd_memory_read`'s answer, narrowed to the count and the matched entries' scopes/files. */
type MemoryReadResult = {
  /** The matched entries, capped at the requested limit. */
  entries: Array<{ kind?: string; file?: string; content?: string }>
  /** How many entries matched before the limit. */
  count: number
  /** The store the call read. */
  scope: string
}

/** `mpd_memory_status`'s answer, narrowed to the fields these arms assert on. */
type MemoryStatusResult = {
  /** The store root the status reports. */
  root: string
  /** The markdown entries the store holds. */
  entries: number
  /** The journal lines the store recorded. */
  journalLines: number
  /** The agent's own reflection counters. */
  reflection: { steps: number; triggered: boolean }
  /** The store the call reported. */
  scope: string
}

/** Every throwaway directory this file created, removed once the suite ends. */
const created: string[] = []

afterAll(() => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true })
})

/** A fresh throwaway directory, tracked for cleanup. */
function scratch(prefix: string): string {
  /** The directory mkdtemp just created. */
  const dir = sandbox(prefix)
  created.push(dir)
  return dir
}

/** Read the frontmatter of one written entry back as the object the plugin serialized. */
function frontmatterOf(file: string): any {
  /** The entry's whole text. */
  const raw = readFileSync(file, "utf8")
  /** Offset of the closing delimiter of the JSON frontmatter block. */
  const end = raw.indexOf("\n---\n", 4)
  return JSON.parse(raw.slice(4, end))
}

test("(a) a global write lands under the sandbox HOME, commits, and bootstraps no workspace store", async () => {
  /** The sandbox home this arm treats as the user's home. */
  const home = scratch("mpd-mem-global-home-")
  /** The throwaway workspace the plugin resolves through DSH_WORKSPACE_ROOT. */
  const workspace = scratch("mpd-mem-global-ws-")
  /** The environment hook that points HOME/DSH_HOME at the sandbox. */
  const leave = enterSandboxHome(home)
  /** The mounted plugin under test. */
  const plugin = mount(workspace, { vcs: "git", agentSlug: "gw" })
  try {
    /** The write tool, cast to the result shape this arm asserts on. */
    const write = toolOf<MemoryWriteResult>(plugin, "mpd_memory_write")
    /** The global write's answer. */
    const written = await write.execute({ title: "global note", content: "shared across projects", kind: "fact", scope: "global" }, {})
    /** The global store's own root, derived exactly as the plugin derives it. */
    const root = join(home, ".mpd", "memory")
    expect(written.scope).toBe("global")
    expect(written.vcs).toBe("git")
    expect(written.committedTo).toEqual(["git"])
    expect(written.file.startsWith(join(root, "repo", "memory") + sep)).toBe(true)
    expect(existsSync(written.file)).toBe(true)
    // The entry is a GLOBAL fact under the shared store's layout, and the repo really committed it.
    expect(frontmatterOf(written.file).scope).toBe("global")
    expect(existsSync(join(root, "repo", ".git"))).toBe(true)
    /** The commit subject of the global repository's tip, read with the real git CLI. */
    const log = spawnSync("git", ["log", "-1", "--pretty=%s"], { cwd: join(root, "repo"), encoding: "utf8" })
    expect(log.status).toBe(0)
    expect(log.stdout).toContain("memory: global-note-")
    // A GLOBAL write must not bootstrap the agent's workspace store as a side effect.
    expect(existsSync(join(workspace, ".mpd", "memory", "agents"))).toBe(false)
    /** The read tool, in the global scope. */
    const read = toolOf<MemoryReadResult>(plugin, "mpd_memory_read")
    /** The global read's answer: the one entry this arm wrote. */
    const listed = await read.execute({ scope: "global" }, {})
    expect(listed.count).toBe(1)
    expect(listed.scope).toBe("global")
    /** The status tool, in the global scope. */
    const status = toolOf<MemoryStatusResult>(plugin, "mpd_memory_status")
    /** The global status's answer. */
    const reported = await status.execute({ scope: "global" }, {})
    expect(reported.root).toBe(root)
    expect(reported.entries).toBe(1)
    expect(reported.journalLines).toBeGreaterThanOrEqual(1)
  } finally {
    plugin.restore()
    leave()
  }
})

test("(b) scope defaults to workspace, and a global read never creates the global store", async () => {
  /** The sandbox home this arm treats as the user's home (which no arm call may create). */
  const home = scratch("mpd-mem-default-home-")
  /** The throwaway workspace. */
  const workspace = scratch("mpd-mem-default-ws-")
  /** The environment hook that points HOME/DSH_HOME at the sandbox. */
  const leave = enterSandboxHome(home)
  /** The mounted plugin under test. */
  const plugin = mount(workspace, { vcs: "git", agentSlug: "dw" })
  try {
    /** The write tool, cast to the result shape this arm asserts on. */
    const write = toolOf<MemoryWriteResult>(plugin, "mpd_memory_write")
    /** A write with NO scope argument: it must keep the pre-wave-W3-D meaning exactly. */
    const written = await write.execute({ title: "workspace note", content: "per agent" }, {})
    /** The agent's workspace store root, derived from the slug this arm configured. */
    const agentRoot = join(workspace, ".mpd", "memory", "agents", "dw")
    expect(written.scope).toBe("workspace")
    expect(written.file.startsWith(join(agentRoot, "repo", "memory") + sep)).toBe(true)
    /** An EXPLICIT `scope:"workspace"` must name the same store as the default. */
    const explicit = await write.execute({ title: "workspace note two", content: "per agent", scope: "workspace" }, {})
    expect(explicit.scope).toBe("workspace")
    expect(explicit.file.startsWith(join(agentRoot, "repo", "memory") + sep)).toBe(true)
    /** The workspace read, with no scope argument: both entries are visible. */
    const read = toolOf<MemoryReadResult>(plugin, "mpd_memory_read")
    expect((await read.execute({}, {})).count).toBe(2)
    // A GLOBAL read answers an empty list and CREATES NOTHING: the global store does not exist yet.
    /** The global read's answer. */
    const globalRead = await read.execute({ scope: "global" }, {})
    expect(globalRead.count).toBe(0)
    expect(globalRead.scope).toBe("global")
    expect(existsSync(join(home, ".mpd", "memory"))).toBe(false)
    /** The status tool, reporting the default store. */
    const status = toolOf<MemoryStatusResult>(plugin, "mpd_memory_status")
    /** The default status's answer: the agent's own root. */
    const reported = await status.execute({}, {})
    expect(reported.scope).toBe("workspace")
    expect(reported.root).toBe(agentRoot)
    expect(reported.entries).toBe(2)
  } finally {
    plugin.restore()
    leave()
  }
})

test("a global write never advances the workspace reflection machine", async () => {
  /** The sandbox home this arm treats as the user's home. */
  const home = scratch("mpd-mem-reflect-home-")
  /** The throwaway workspace. */
  const workspace = scratch("mpd-mem-reflect-ws-")
  /** The environment hook that points HOME/DSH_HOME at the sandbox. */
  const leave = enterSandboxHome(home)
  /** The mounted plugin, with a threshold of ONE write so a single workspace write would raise the claim. */
  const plugin = mount(workspace, { vcs: "git", agentSlug: "rw", reflectionEvery: 1 })
  try {
    /** The write tool, cast to the result shape this arm asserts on. */
    const write = toolOf<MemoryWriteResult>(plugin, "mpd_memory_write")
    /** A global write: it must report the claim as it stands, never raise one. */
    const written = await write.execute({ title: "global reflection probe", content: "not an agent step", scope: "global" }, {})
    expect(written.reflectionDue).toBe(false)
    /** The status tool, reporting the agent's own store. */
    const status = toolOf<MemoryStatusResult>(plugin, "mpd_memory_status")
    /** The workspace store's counters, after the global write. */
    const reported = await status.execute({}, {})
    expect(reported.reflection.steps).toBe(0)
    expect(reported.reflection.triggered).toBe(false)
    // CONTROL: the same threshold does fire for a WORKSPACE write, so the arm above is falsifiable.
    expect((await write.execute({ title: "workspace step", content: "an agent step" }, {})).reflectionDue).toBe(true)
  } finally {
    plugin.restore()
    leave()
  }
})

test("the global mutation is guarded: a root outside the sandbox HOME is refused before anything is created", async () => {
  /** The sandbox home this arm treats as the user's home. */
  const home = scratch("mpd-mem-guard-home-")
  /** The throwaway workspace. */
  const workspace = scratch("mpd-mem-guard-ws-")
  /** A global root OUTSIDE that home, which the shared guard's containment rule must refuse. */
  const outside = join(scratch("mpd-mem-guard-outside-"), "global-memory")
  /** The environment hook that points HOME/DSH_HOME at the sandbox. */
  const leave = enterSandboxHome(home)
  /** The mounted plugin, configured with the outside root. */
  const plugin = mount(workspace, { vcs: "git", globalDir: outside })
  try {
    /** The write tool, cast to the result shape this arm asserts on. */
    const write = toolOf<MemoryWriteResult>(plugin, "mpd_memory_write")
    /** The refusal this arm asserts on: the write must reject, not silently no-op. */
    const caught = await write.execute({ title: "refused", content: "x", scope: "global" }, {}).then(() => null, (error: unknown) => error as { code?: string; status?: number; message?: string })
    expect(caught).not.toBeNull()
    // F2 of wave W0: the refusal's WIRE fields are the contract, never `instanceof` across packages.
    expect(caught?.code).toBe("real-home-refused")
    expect(caught?.status).toBe(403)
    expect(String(caught?.message)).toContain("mpd_memory: refusing to write a global memory entry")
    // The refusal must land BEFORE any directory is created: a refused write leaves no residue.
    expect(existsSync(outside)).toBe(false)
    // The documented escape hatch: the row's own override lets a deliberate boot through.
    process.env.MPD_DSH_MEMORY_ALLOW_REAL_HOME = "1"
    /** The overridden write's answer. */
    const allowed = await write.execute({ title: "allowed", content: "deliberate", scope: "global" }, {})
    expect(allowed.scope).toBe("global")
    expect(existsSync(allowed.file)).toBe(true)
    expect(allowed.file.startsWith(join(outside, "repo", "memory") + sep)).toBe(true)
  } finally {
    delete process.env.MPD_DSH_MEMORY_ALLOW_REAL_HOME
    plugin.restore()
    leave()
  }
})

test("a global entry and a workspace entry are separate files even with the same title", async () => {
  /** The sandbox home this arm treats as the user's home. */
  const home = scratch("mpd-mem-both-home-")
  /** The throwaway workspace. */
  const workspace = scratch("mpd-mem-both-ws-")
  /** The environment hook that points HOME/DSH_HOME at the sandbox. */
  const leave = enterSandboxHome(home)
  /** The mounted plugin under test. */
  const plugin = mount(workspace, { vcs: "git", agentSlug: "bw" })
  try {
    /** The write tool, cast to the result shape this arm asserts on. */
    const write = toolOf<MemoryWriteResult>(plugin, "mpd_memory_write")
    /** The workspace entry. */
    const local = await write.execute({ title: "same title", content: "local copy" }, {})
    /** The global entry, written on the same millisecond counter but into the other store. */
    const shared = await write.execute({ title: "same title", content: "shared copy", scope: "global" }, {})
    expect(local.file).not.toBe(shared.file)
    expect(existsSync(local.file)).toBe(true)
    expect(existsSync(shared.file)).toBe(true)
    expect(readFileSync(local.file, "utf8")).toContain("local copy")
    expect(readFileSync(shared.file, "utf8")).toContain("shared copy")
    // The global entry is tagged with its store; the workspace entry keeps the pre-wave bytes.
    expect(frontmatterOf(shared.file).scope).toBe("global")
    expect(frontmatterOf(local.file).scope).toBeUndefined()
  } finally {
    plugin.restore()
    leave()
  }
})
