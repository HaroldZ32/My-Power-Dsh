import { test, expect } from "bun:test"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { apply } from "../src/index.ts"

function makePlugin(dir: string, config: any) {
  const tools: any[] = []
  const ctx: any = { tools: { register(d: any) { tools.push(d) }, get(n: string) { return tools.find((t) => t.name === n) } } }
  const env = process.env.DSH_WORKSPACE_ROOT
  process.env.DSH_WORKSPACE_ROOT = dir
  apply(ctx, config)
  return { tools, restore: () => { if (env === undefined) delete process.env.DSH_WORKSPACE_ROOT; else process.env.DSH_WORKSPACE_ROOT = env } }
}

test("git backend: write -> commit -> read -> reflection due", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mpd-mem-"))
  const { tools, restore } = makePlugin(dir, { vcs: "git", dir: ".mpd", agentSlug: "t1", reflectionEvery: 1 })
  const write = tools.find((t) => t.name === "mpd_memory_write")
  const res = await write.execute({ title: "first note", content: "alpha beta", kind: "note", tags: ["demo"] }, {})
  expect(res.vcs).toBe("git")
  expect(existsSync(res.file)).toBe(true)
  expect(res.reflectionDue).toBe(true)
  expect(readFileSync(res.file, "utf8")).toContain("alpha beta")
  const repo = join(dir, ".mpd", "memory", "agents", "t1", "repo")
  expect(existsSync(join(repo, ".git"))).toBe(true)
  const read = tools.find((t) => t.name === "mpd_memory_read")
  const entries = await read.execute({ query: "alpha" }, {})
  expect(entries.count).toBe(1)
  expect(entries.entries[0].kind).toBe("note")
  const reflect = tools.find((t) => t.name === "mpd_memory_reflect")
  const rs = await reflect.execute({}, {})
  expect(rs.due).toBe(true)
  const complete = tools.find((t) => t.name === "mpd_memory_reflect_complete")
  const done = await complete.execute({ content: "reflect: keep it minimal" }, {})
  expect(done.completed).toBe(true)
  const rs2 = await reflect.execute({}, {})
  expect(rs2.due).toBe(false)
  restore()
})

test("svn backend wiring with fake svn CLIs", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mpd-mem-svn-"))
  const fakeBin = join(dir, "fakebin")
  mkdirSync(fakeBin, { recursive: true })
  const svnLog = join(fakeBin, "svn.log")
  writeFileSync(join(fakeBin, "svnadmin"), "#!/bin/sh\necho \"$*\" >> " + svnLog + "\nif [ \"$1\" = create ]; then mkdir -p \"$2/db\"; fi\nexit 0\n")
  writeFileSync(join(fakeBin, "svn"), "#!/bin/sh\necho \"$*\" >> " + svnLog + "\ncase \"$1\" in\ncheckout) mkdir -p \"$3/.svn\";;\nadd|commit) :;;\nesac\nexit 0\n")
  const chmod = await import("node:fs/promises")
  await chmod.chmod(join(fakeBin, "svnadmin"), 0o755)
  await chmod.chmod(join(fakeBin, "svn"), 0o755)
  const oldPath = process.env.PATH
  process.env.PATH = fakeBin + ":" + oldPath
  const { tools, restore } = makePlugin(dir, { vcs: "svn", dir: ".mpd", agentSlug: "t2" })
  const write = tools.find((t) => t.name === "mpd_memory_write")
  const res = await write.execute({ title: "svn note", content: "svn content" }, {})
  expect(res.vcs).toBe("svn")
  expect(existsSync(res.file)).toBe(true)
  const log = readFileSync(svnLog, "utf8")
  expect(log).toContain("create")
  expect(log).toContain("checkout")
  expect(log).toContain("commit")
  expect(res.committedTo).toEqual(["svn"])
  process.env.PATH = oldPath
  restore()
})
