// PAGINATED `mpd_memory_read` (wave W4, item A6a): `offset` + `next_offset`, `count` stays the TOTAL.
//
// The contract this file pins: successive calls walk every match exactly once in the STABLE order the
// tool documents (entry file name ascending), `count` is the matched total on every page, and
// `next_offset` is `offset + returned` only while more remain. Every arm runs against a throwaway
// workspace (and, for the scope arm, a mkdtemp `HOME`), so no real store is touched.
import { afterAll, expect, test } from "bun:test"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { enterSandboxHome, mount, sandbox, toolOf } from "./support.ts"

/** `mpd_memory_read`'s answer, as the paginated output schema declares it. */
type MemoryReadResult = {
  /** This page's entries, in the tool's pinned order. */
  entries: Array<{ file?: string; kind?: string; description?: string }>
  /** The TOTAL entries that passed the filters, counted before the page was taken. */
  count: number
  /** The page start this call applied. */
  offset: number
  /** How many entries this page carries. */
  returned: number
  /** The next page's offset, or null when this page reached the end. */
  next_offset: number | null
  /** The store the call read. */
  scope: string
}

/** `mpd_memory_write`'s answer, narrowed to the fields these arms read. */
type MemoryWriteResult = {
  /** Absolute path of the markdown entry that was written and committed. */
  file: string
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

/**
 * Write one fixture entry straight into a store's memory directory.
 *
 * The read tool only READS this directory, so a fixture is the honest way to build a large page set
 * without paying one git commit per entry; one arm below still writes through the real tool.
 *
 * @param memoryDir - the store's `repo/memory/` directory.
 * @param name - the entry's file stem (its file name is `<name>.md`).
 * @param kind - the frontmatter kind the kind filter matches on.
 * @param description - the entry's description, which the query filter searches.
 */
function entryFixture(memoryDir: string, name: string, kind: string, description: string): void {
  mkdirSync(memoryDir, { recursive: true })
  writeFileSync(join(memoryDir, name + ".md"), "---\n" + JSON.stringify({ description, kind, tags: ["bulk"] }) + "\n---\n" + description + " body\n")
}

/** The workspace store's memory directory for one configured agent slug. */
function workspaceMemoryDir(workspace: string, slug: string): string {
  return join(workspace, ".mpd", "memory", "agents", slug, "repo", "memory")
}

test("(a) a 25-entry set pages 20 then 5, with count = 25 on BOTH pages", async () => {
  /** The throwaway workspace this arm's store lives under. */
  const workspace = scratch("mpd-mem-page-a-")
  /** The mounted plugin under test. */
  const plugin = mount(workspace, { agentSlug: "pg" })
  try {
    /** The store's memory directory the fixtures are written into. */
    const memoryDir = workspaceMemoryDir(workspace, "pg")
    for (let i = 0; i < 25; i += 1) entryFixture(memoryDir, "bulk-" + String(i).padStart(3, "0"), "note", "entry " + String(i))
    /** The read tool, cast to the paginated result shape. */
    const read = toolOf<MemoryReadResult>(plugin, "mpd_memory_read")
    /** The DEFAULT page: limit 20, offset 0. */
    const first = await read.execute({}, {})
    expect(first.count).toBe(25)
    expect(first.offset).toBe(0)
    expect(first.returned).toBe(20)
    expect(first.next_offset).toBe(20)
    expect(first.entries.length).toBe(20)
    // The pinned order: ascending file name, so the first page starts at the lowest name.
    expect(first.entries[0].file).toBe("bulk-000.md")
    /** The page the first answer's `next_offset` names. */
    const second = await read.execute({ offset: first.next_offset as number }, {})
    expect(second.count).toBe(25)
    expect(second.offset).toBe(20)
    expect(second.returned).toBe(5)
    expect(second.next_offset).toBeNull()
    expect(second.entries[0].file).toBe("bulk-020.md")
  } finally {
    plugin.restore()
  }
})

test("(b) an offset beyond the end answers an empty page with next_offset null", async () => {
  /** The throwaway workspace this arm's store lives under. */
  const workspace = scratch("mpd-mem-page-b-")
  /** The mounted plugin under test. */
  const plugin = mount(workspace, { agentSlug: "pg" })
  try {
    /** The store's memory directory the fixtures are written into. */
    const memoryDir = workspaceMemoryDir(workspace, "pg")
    for (let i = 0; i < 25; i += 1) entryFixture(memoryDir, "bulk-" + String(i).padStart(3, "0"), "note", "entry " + String(i))
    /** The read tool, cast to the paginated result shape. */
    const read = toolOf<MemoryReadResult>(plugin, "mpd_memory_read")
    /** A page start far past the matched set: empty, but the TOTAL is still reported. */
    const past = await read.execute({ offset: 100 }, {})
    expect(past.entries).toEqual([])
    expect(past.count).toBe(25)
    expect(past.offset).toBe(100)
    expect(past.returned).toBe(0)
    expect(past.next_offset).toBeNull()
    // A negative / fractional / non-numeric offset is floored to 0 rather than refused.
    expect((await read.execute({ offset: -3, limit: 3 }, {})).offset).toBe(0)
    expect((await read.execute({ offset: 7.9, limit: 3 }, {})).offset).toBe(7)
    expect((await read.execute({ offset: "abc" as unknown as number, limit: 3 }, {})).offset).toBe(0)
  } finally {
    plugin.restore()
  }
})

test("(c) a filter and pagination combine: walk is over the FILTERED set", async () => {
  /** The throwaway workspace this arm's store lives under. */
  const workspace = scratch("mpd-mem-page-c-")
  /** The mounted plugin under test. */
  const plugin = mount(workspace, { agentSlug: "pg" })
  try {
    /** The store's memory directory the fixtures are written into. */
    const memoryDir = workspaceMemoryDir(workspace, "pg")
    for (let i = 0; i < 25; i += 1) {
      entryFixture(memoryDir, "bulk-" + String(i).padStart(3, "0"), i < 12 ? "alpha" : "beta", i < 12 ? "alpha entry " + String(i) : "beta entry " + String(i))
    }
    /** The read tool, cast to the paginated result shape. */
    const read = toolOf<MemoryReadResult>(plugin, "mpd_memory_read")
    /** The files this walk visited, in order. */
    const walked: string[] = []
    /** The page cursor, starting at the first page. */
    let offset: number | null = 0
    /** How many pages this walk needed. */
    let pages = 0
    while (offset !== null) {
      /** One page of the filtered set. */
      const page = await read.execute({ kind: "alpha", limit: 5, offset }, {})
      // `count` is the FILTERED total on every page, never the store's size.
      expect(page.count).toBe(12)
      walked.push(...page.entries.map((entry) => String(entry.file)))
      pages += 1
      offset = page.next_offset
    }
    expect(pages).toBe(3)
    expect(walked.length).toBe(12)
    expect(new Set(walked).size).toBe(12)
    // Every visited entry really passed the filter, and the walk is in the pinned ascending order.
    expect(walked).toEqual(walked.slice().sort())
    expect(walked[0]).toBe("bulk-000.md")
    expect(walked[11]).toBe("bulk-011.md")
  } finally {
    plugin.restore()
  }
})

test("(d) the order is stable across calls and a full walk reaches every match exactly once", async () => {
  /** The throwaway workspace this arm's store lives under. */
  const workspace = scratch("mpd-mem-page-d-")
  /** The mounted plugin under test. */
  const plugin = mount(workspace, { agentSlug: "pg" })
  try {
    /** The store's memory directory the fixtures are written into. */
    const memoryDir = workspaceMemoryDir(workspace, "pg")
    for (let i = 0; i < 25; i += 1) entryFixture(memoryDir, "bulk-" + String(i).padStart(3, "0"), "note", "entry " + String(i))
    /** The read tool, cast to the paginated result shape. */
    const read = toolOf<MemoryReadResult>(plugin, "mpd_memory_read")
    /** One page's file names. */
    const namesOf = (page: MemoryReadResult): string[] => page.entries.map((entry) => String(entry.file))
    /** The same page requested twice. */
    const one = await read.execute({ limit: 10 }, {})
    /** The second request of the identical page, compared against the first. */
    const two = await read.execute({ limit: 10 }, {})
    expect(namesOf(one)).toEqual(namesOf(two))
    // A full walk with an uneven page size visits 25 distinct entries, in ascending order.
    /** The files the walk visited. */
    const walked: string[] = []
    /** The page cursor. */
    let offset: number | null = 0
    while (offset !== null) {
      /** One page of the walk. */
      const page = await read.execute({ limit: 7, offset }, {})
      walked.push(...namesOf(page))
      offset = page.next_offset
    }
    expect(walked.length).toBe(25)
    expect(new Set(walked).size).toBe(25)
    expect(walked).toEqual(walked.slice().sort())
  } finally {
    plugin.restore()
  }
})

test("(e) scope and pagination combine: the global page counts only the global store's matches", async () => {
  /** The sandbox home this arm treats as the user's home. */
  const home = scratch("mpd-mem-page-e-home-")
  /** The throwaway workspace this arm's store lives under. */
  const workspace = scratch("mpd-mem-page-e-")
  /** The environment hook that points HOME/DSH_HOME at the sandbox. */
  const leave = enterSandboxHome(home)
  /** The mounted plugin under test. */
  const plugin = mount(workspace, { agentSlug: "pg" })
  try {
    // Three global entries and two workspace entries, so a page that counted the wrong store would be
    // visibly wrong on BOTH numbers.
    /** The global store's memory directory. */
    const globalDir = join(home, ".mpd", "memory", "repo", "memory")
    for (let i = 0; i < 3; i += 1) entryFixture(globalDir, "global-" + String(i), "note", "global entry " + String(i))
    /** The workspace store's memory directory. */
    const localDir = workspaceMemoryDir(workspace, "pg")
    for (let i = 0; i < 2; i += 1) entryFixture(localDir, "local-" + String(i), "note", "local entry " + String(i))
    /** The read tool, cast to the paginated result shape. */
    const read = toolOf<MemoryReadResult>(plugin, "mpd_memory_read")
    /** The first global page. */
    const firstGlobal = await read.execute({ scope: "global", limit: 2 }, {})
    expect(firstGlobal.count).toBe(3)
    expect(firstGlobal.returned).toBe(2)
    expect(firstGlobal.next_offset).toBe(2)
    expect(firstGlobal.entries.map((entry) => entry.file)).toEqual(["global-0.md", "global-1.md"])
    /** The second global page: the one the cursor names. */
    const secondGlobal = await read.execute({ scope: "global", limit: 2, offset: 2 }, {})
    expect(secondGlobal.count).toBe(3)
    expect(secondGlobal.returned).toBe(1)
    expect(secondGlobal.next_offset).toBeNull()
    expect(secondGlobal.entries.map((entry) => entry.file)).toEqual(["global-2.md"])
    // The workspace store's page counts only its own two entries.
    /** The workspace page, which must not see the global fixtures. */
    const local = await read.execute({ limit: 50 }, {})
    expect(local.count).toBe(2)
    expect(local.entries.map((entry) => entry.file)).toEqual(["local-0.md", "local-1.md"])
  } finally {
    plugin.restore()
    leave()
  }
})

test("(f) entries written through the TOOL page the same way", async () => {
  /** The throwaway workspace this arm's store lives under. */
  const workspace = scratch("mpd-mem-page-f-")
  /** The mounted plugin under test. */
  const plugin = mount(workspace, { agentSlug: "pg", vcs: "git" })
  try {
    /** The write tool, cast to the result shape these arms read. */
    const write = toolOf<MemoryWriteResult>(plugin, "mpd_memory_write")
    // Three REAL writes, so the arms above cannot be reading a directory shape the writer never makes.
    /** The three entries this arm writes through the tool. */
    const written: string[] = []
    for (const title of ["paged one", "paged two", "paged three"]) written.push((await write.execute({ title, content: "body of " + title }, {})).file)
    expect(new Set(written).size).toBe(3)
    /** The read tool, cast to the paginated result shape. */
    const read = toolOf<MemoryReadResult>(plugin, "mpd_memory_read")
    /** The first page of the tool-written set. */
    const first = await read.execute({ limit: 2 }, {})
    expect(first.count).toBe(3)
    expect(first.returned).toBe(2)
    expect(first.next_offset).toBe(2)
    /** The last page. */
    const last = await read.execute({ limit: 2, offset: first.next_offset as number }, {})
    expect(last.count).toBe(3)
    expect(last.returned).toBe(1)
    expect(last.next_offset).toBeNull()
    // The two pages together name exactly the three files the tool wrote.
    expect([...first.entries.map((entry) => entry.file), ...last.entries.map((entry) => entry.file)].sort()).toEqual(written.map((file) => file.split("/").pop() ?? "").sort())
    expect(existsSync(written[0])).toBe(true)
  } finally {
    plugin.restore()
  }
})
