// Rename + delete of workmate instances: tools, service, HTTP routes, safety gates and the
// edge-case matrix of the binding contract (.mpd/plans/workmate-rename-delete-contract.md §A-§M).
// Every case runs against a sandbox HOME (the library lives under HOME) and a sandbox cwd (the
// in-use gate reads <cwd>/.mpd/team); the real HOME and the real .mpd/team are never touched.
import { test, expect, beforeEach, afterEach } from "bun:test"
import { apply, busyTeams, READONLY_DENY } from "../src/index.ts"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"

const DEEP_WORKER = {
  id: "hephaestus", name: "Deep Worker", description: "autonomous goal-driven implementation",
  readonly: false, chain: [{ provider: "deepseek-official", model: "deepseek-v4-flash" }],
  persona: "You are the Deep Worker. Execute goals end-to-end with tools and verify every change."
}
const RESEARCHER = {
  id: "librarian", name: "Researcher", description: "code / open-source evidence search",
  readonly: true, chain: [{ provider: "deepseek-official", model: "deepseek-v4-flash" }],
  persona: "You are the Researcher. Gather evidence with citations; never edit files."
}

function makeRoles() {
  const all = [DEEP_WORKER, RESEARCHER]
  return {
    list: () => all.map((r) => ({ ...r })),
    get: (k: string) => {
      const r = all.find((x) => x.id === k)
      return r ? { ...r } : null
    }
  }
}

// ── harness ────────────────────────────────────────────────────────────────────────────────────
type Harness = ReturnType<typeof makeHarness>

function makeHarness(opts: { web?: boolean; spawnThrows?: boolean } = {}) {
  const tools: any[] = []
  const routes: any[] = []
  const spawned: any[] = []
  const provided: any = {}
  const ctx: any = {
    get: (k: string) => {
      if (k === "mpdRoles") return makeRoles()
      if (opts.web !== false && k === "webServer") return { register: (r: any) => { routes.push(r); return () => {} } }
      return undefined
    },
    tools: { register(d: any) { tools.push(d) } },
    subagents: {
      start: async (_mode: string, o: any) => {
        spawned.push(o)
        if (opts.spawnThrows) throw new Error("spawn boom")
        return { result: { structured: { name: "x", summary: "did the work" }, stopReason: "complete" } }
      }
    },
    provide: (n: string, v: any) => { provided[n] = v },
    effect: (fn: any) => fn()
  }
  apply(ctx)
  const byName = (n: string) => tools.find((t) => t.name === n)
  const exec = { agent: { id: "agent-1" }, signal: new AbortController().signal }
  return {
    tools, routes, spawned, provided, byName, exec,
    /** POST (or any verb) straight into a registered workmate route. */
    async call(path: string, method: string, body?: unknown) {
      const route = routes.find((r) => r.path === "/plugins/mpd-workmate/" + path)
      if (!route) throw new Error("no route registered for " + path)
      const res: any = {
        status: 0, headers: {} as Record<string, string>, raw: "",
        writeHead(s: number, h: any) { res.status = s; res.headers = h ?? {} },
        end(b?: any) { res.raw = b === undefined ? "" : String(b) }
      }
      const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))]
      const req: any = { method, async *[Symbol.asyncIterator]() { for (const c of chunks) yield c } }
      await route.handler(req, res)
      return { status: res.status, headers: res.headers, raw: res.raw as string, body: res.raw === "" ? null : JSON.parse(res.raw) }
    }
  }
}

let sb: { home: string; cwd: string; restore: () => void }

function sandbox() {
  const home = mkdtempSync(join(tmpdir(), "mpd-wm-home-"))
  const cwd = mkdtempSync(join(tmpdir(), "mpd-wm-cwd-"))
  const prevHome = process.env.HOME
  const prevCwd = process.cwd()
  process.env.HOME = home
  process.chdir(cwd)
  return {
    home, cwd,
    restore: () => { process.env.HOME = prevHome; process.chdir(prevCwd) }
  }
}

beforeEach(() => { sb = sandbox() })
afterEach(() => { sb.restore() })

const root = () => join(process.env.HOME as string, ".mpd", "workmate")
const inst = (key: string) => join(root(), key)
const readText = (p: string) => readFileSync(p, "utf8")
const readJson = (p: string) => JSON.parse(readText(p))
const indexKeys = () => Object.keys(readJson(join(root(), "index.json"))).sort()
const dirNames = () => readdirSync(root(), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort()

/** Write a team record shaped like the agent-teams state the §E(b) gate scans. `sub` is "" for a
 * live team (a direct child of `.mpd/team`) or "archive" for an archived one. */
function writeTeamRecord(cwd: string, teamId: string, members: string[], sub = "") {
  const dirPath = sub === "" ? join(cwd, ".mpd", "team", teamId) : join(cwd, ".mpd", "team", sub, teamId)
  mkdirSync(dirPath, { recursive: true })
  writeFileSync(join(dirPath, "team.json"), JSON.stringify({ id: teamId, name: teamId, members: members.map((m, i) => ({ id: "m" + i, name: m, status: "idle" })) }, null, 2))
}

async function initOne(h: Harness, name: string, base = "Deep Worker") {
  return h.byName("mpd_workmate_init").execute({ base, name }, h.exec)
}

// ── rename: the happy path and the full cascade (§F) ───────────────────────────────────────────
test("rename moves the evolved identity and preserves every byte of it", async () => {
  const h = makeHarness()
  await initOne(h, "oracle-1")
  await h.byName("mpd_workmate_reflect").execute({ name: "oracle-1", task: "design the DAG", outcome: "designed it" }, h.exec)
  const personaBefore = readText(join(inst("oracle-1"), "persona.md"))
  const memoryBefore = readText(join(inst("oracle-1"), "memory.md"))
  const metaBefore = readJson(join(inst("oracle-1"), "meta.json"))

  const out = await h.byName("mpd_workmate_rename").execute({ name: "oracle-1", new_name: "oracle-2" }, h.exec)
  expect(out.ok).toBe(true)
  expect(out.name).toBe("oracle-2")
  expect(out.from).toBe("oracle-1")
  expect(out.renamedFrom).toEqual(["oracle-1"])

  // the directory IS the identity: it moved, and nothing was left behind
  expect(existsSync(inst("oracle-1"))).toBe(false)
  expect(existsSync(inst("oracle-2"))).toBe(true)
  // persona/memory preserved byte-for-byte; identity fields carried, updatedAt advanced
  expect(readText(join(inst("oracle-2"), "persona.md"))).toBe(personaBefore)
  expect(readText(join(inst("oracle-2"), "memory.md"))).toBe(memoryBefore)
  const metaAfter = readJson(join(inst("oracle-2"), "meta.json"))
  expect(metaAfter.name).toBe("oracle-2")
  expect(metaAfter.baseId).toBe(metaBefore.baseId)
  expect(metaAfter.baseName).toBe(metaBefore.baseName)
  expect(metaAfter.createdAt).toBe(metaBefore.createdAt)
  expect(metaAfter.uses).toBe(metaBefore.uses)
  expect(metaAfter.lastTask).toBe(metaBefore.lastTask)
  expect(metaAfter.renamedFrom).toEqual(["oracle-1"])
  // index: the NEW key is present and the OLD key is GONE (a stale key would linger forever)
  expect(indexKeys()).toEqual(["oracle-2"])
  expect(readJson(join(root(), "index.json"))["oracle-2"].name).toBe("oracle-2")
  // note self-reference rewritten (autoNote prefix branch)
  expect(readText(join(inst("oracle-2"), "note.md")).startsWith('Deep Worker-based workmate "oracle-2".')).toBe(true)

  // the service reflects the mutation on the VERY NEXT call — no caching
  expect(h.provided.mpdWorkmate.get("oracle-1")).toBeNull()
  expect(h.provided.mpdWorkmate.get("oracle-2").name).toBe("oracle-2")
  expect(h.provided.mpdWorkmate.get("oracle-2").renamedFrom).toEqual(["oracle-1"])
  expect(h.provided.mpdWorkmate.read("oracle-2").persona).toContain("Deep Worker")
  expect(h.provided.mpdWorkmate.list().map((w: any) => w.name)).toEqual(["oracle-2"])
  const list = await h.byName("mpd_workmate_list").execute({}, h.exec)
  expect(list.workmates.map((w: any) => w.name)).toEqual(["oracle-2"])
  expect(list.workmates[0].renamedFrom).toEqual(["oracle-1"])
})

test("renamedFrom accumulates, dedupes, survives a later reflect and is capped", async () => {
  const h = makeHarness()
  await initOne(h, "oracle-1")
  const rename = (from: string, to: string) => h.byName("mpd_workmate_rename").execute({ name: from, new_name: to }, h.exec)

  await rename("oracle-1", "oracle-2")
  await rename("oracle-2", "oracle-3")
  // renaming back to an already-used key keeps every previous key exactly once, first-seen order
  await rename("oracle-3", "oracle-2")
  expect(h.provided.mpdWorkmate.get("oracle-2").renamedFrom).toEqual(["oracle-1", "oracle-2", "oracle-3"])
  await rename("oracle-2", "oracle-1")
  expect(h.provided.mpdWorkmate.get("oracle-1").renamedFrom).toEqual(["oracle-1", "oracle-2", "oracle-3"])

  // A4: a reflect must not silently drop renamedFrom (readMeta must whitelist it)
  await h.byName("mpd_workmate_reflect").execute({ name: "oracle-1", task: "t", outcome: "o" }, h.exec)
  expect(readJson(join(inst("oracle-1"), "meta.json")).renamedFrom).toEqual(["oracle-1", "oracle-2", "oracle-3"])
  expect(h.provided.mpdWorkmate.get("oracle-1").renamedFrom).toEqual(["oracle-1", "oracle-2", "oracle-3"])
  expect(h.provided.mpdWorkmate.read("oracle-1").renamedFrom).toEqual(["oracle-1", "oracle-2", "oracle-3"])

  // cap 10 (same library, a separate instance so the names above stay untouched)
  await initOne(h, "cap-1")
  let cur = "cap-1"
  for (let i = 2; i <= 14; i++) {
    const next = "cap-" + i
    await h.byName("mpd_workmate_rename").execute({ name: cur, new_name: next }, h.exec)
    cur = next
  }
  expect(h.provided.mpdWorkmate.get(cur).renamedFrom.length).toBe(10)
})

test("A5 note rule: only a LEADING autoNote prefix is rewritten, a custom note keeps its bytes", async () => {
  const h = makeHarness()
  // (a) auto note → prefix rewritten
  await initOne(h, "oracle-1")
  expect(readText(join(inst("oracle-1"), "note.md")).startsWith('Deep Worker-based workmate "oracle-1".')).toBe(true)
  await h.byName("mpd_workmate_rename").execute({ name: "oracle-1", new_name: "oracle-2" }, h.exec)
  expect(readText(join(inst("oracle-2"), "note.md")).startsWith('Deep Worker-based workmate "oracle-2".')).toBe(true)
  expect(readText(join(inst("oracle-2"), "note.md")).includes("oracle-1")).toBe(false)

  // (b) custom note (does NOT start with the prefix) → bytes untouched
  await initOne(h, "custom-1")
  const custom = "Hand-written specialist card: owns the clocking review.\nSecond line.\n"
  writeFileSync(join(inst("custom-1"), "note.md"), custom)
  await h.byName("mpd_workmate_rename").execute({ name: "custom-1", new_name: "custom-2" }, h.exec)
  expect(readText(join(inst("custom-2"), "note.md"))).toBe(custom)

  // (c) prefix ONLY at the start: a note that merely CONTAINS the text is left alone
  await initOne(h, "custom-3")
  const embedded = 'Do not touch: Deep Worker-based workmate "custom-3". quoted mid-note\n'
  writeFileSync(join(inst("custom-3"), "note.md"), embedded)
  await h.byName("mpd_workmate_rename").execute({ name: "custom-3", new_name: "custom-4" }, h.exec)
  expect(readText(join(inst("custom-4"), "note.md"))).toBe(embedded)
})

// ── name rules (D5 / §B) ───────────────────────────────────────────────────────────────────────
test("invalid names are rejected BEFORE any filesystem call, on both argument positions", async () => {
  const h = makeHarness()
  await initOne(h, "oracle-1")
  const before = readText(join(inst("oracle-1"), "meta.json"))
  const bad = ["", "Alice", "ORACLE-1", "oracle 1", "oracle/1", "oracle-1-", "..", ".", ".archive", "CJK名", "oracle_1!", "-oracle"]
  for (const b of bad) {
    await expect(h.byName("mpd_workmate_rename").execute({ name: "oracle-1", new_name: b }, h.exec)).rejects.toThrow(/invalid new_name/)
    await expect(h.byName("mpd_workmate_delete").execute({ name: b }, h.exec)).rejects.toThrow(/invalid name/)
  }
  // the source argument is validated too
  await expect(h.byName("mpd_workmate_rename").execute({ name: "Alice", new_name: "bob" }, h.exec)).rejects.toThrow(/invalid name/)
  // zero side effects: bytes, directory set and index are untouched
  expect(readText(join(inst("oracle-1"), "meta.json"))).toBe(before)
  expect(dirNames()).toEqual(["oracle-1"])
  expect(indexKeys()).toEqual(["oracle-1"])
})

test("same-key rename and case-only rename are refused with no side effect (M2)", async () => {
  const h = makeHarness()
  await initOne(h, "oracle-1")
  const before = readText(join(inst("oracle-1"), "meta.json"))
  await expect(h.byName("mpd_workmate_rename").execute({ name: "oracle-1", new_name: "oracle-1" }, h.exec)).rejects.toThrow(/equals the current key/)
  // "Oracle-1" sanitizes to the same key, so it is a case-only rename and equally refused
  await expect(h.byName("mpd_workmate_rename").execute({ name: "oracle-1", new_name: "Oracle-1" }, h.exec)).rejects.toThrow(/invalid new_name/)
  // sanitization collision ("Alice Cooper" is not its own sanitized form) is refused too
  await expect(h.byName("mpd_workmate_rename").execute({ name: "oracle-1", new_name: "Alice Cooper" }, h.exec)).rejects.toThrow(/invalid new_name/)
  expect(readText(join(inst("oracle-1"), "meta.json"))).toBe(before)
  expect(dirNames()).toEqual(["oracle-1"])
  expect(indexKeys()).toEqual(["oracle-1"])
})

test("the library ROOT can never be addressed as an instance (§B)", async () => {
  const h = makeHarness()
  await initOne(h, "oracle-1")
  for (const b of ["", "  ", "-", ".."]) {
    await expect(h.byName("mpd_workmate_rename").execute({ name: b, new_name: "oracle-2" }, h.exec)).rejects.toThrow()
    await expect(h.byName("mpd_workmate_delete").execute({ name: b }, h.exec)).rejects.toThrow()
  }
  expect(existsSync(root())).toBe(true)
  expect(dirNames()).toEqual(["oracle-1"])
})

// ── collision guard (M5) and symlinks (§H) ─────────────────────────────────────────────────────
test("collision guard: ANY lstat hit on the target is a 409 collision and nothing is overwritten (M5)", async () => {
  const h = makeHarness()
  await initOne(h, "oracle-1")

  // 1) existing EMPTY directory — the measured hazard: renameSync would silently overwrite it
  mkdirSync(inst("oracle-2"))
  await expect(h.byName("mpd_workmate_rename").execute({ name: "oracle-1", new_name: "oracle-2" }, h.exec)).rejects.toThrow(/already exists/)
  expect(existsSync(inst("oracle-1"))).toBe(true)
  expect(existsSync(inst("oracle-2"))).toBe(true)
  expect(readdirSync(inst("oracle-2")).length).toBe(0)

  // 2) existing NON-empty directory
  mkdirSync(join(inst("oracle-3"), "sub"), { recursive: true })
  writeFileSync(join(inst("oracle-3"), "sub", "file.txt"), "keep me")
  await expect(h.byName("mpd_workmate_rename").execute({ name: "oracle-1", new_name: "oracle-3" }, h.exec)).rejects.toThrow(/already exists/)
  expect(readText(join(inst("oracle-3"), "sub", "file.txt"))).toBe("keep me")

  // 3) a FILE as the target
  writeFileSync(inst("oracle-4"), "not a directory")
  await expect(h.byName("mpd_workmate_rename").execute({ name: "oracle-1", new_name: "oracle-4" }, h.exec)).rejects.toThrow(/already exists/)
  expect(readText(inst("oracle-4"))).toBe("not a directory")

  // 4) a DANGLING symlink: invisible to existsSync, visible to lstatSync
  symlinkSync(join(root(), "does-not-exist"), inst("oracle-5"))
  expect(existsSync(inst("oracle-5"))).toBe(false)
  await expect(h.byName("mpd_workmate_rename").execute({ name: "oracle-1", new_name: "oracle-5" }, h.exec)).rejects.toThrow(/already exists/)

  expect(existsSync(inst("oracle-1"))).toBe(true)
  expect(indexKeys()).toEqual(["oracle-1"])
})

test("a symlinked instance directory is refused, not resolved (§H)", async () => {
  const h = makeHarness()
  await initOne(h, "real-1")
  symlinkSync(inst("real-1"), inst("link-1"))
  const before = readText(join(inst("real-1"), "meta.json"))

  await expect(h.byName("mpd_workmate_rename").execute({ name: "link-1", new_name: "link-2" }, h.exec)).rejects.toThrow(/symlink/)
  await expect(h.byName("mpd_workmate_delete").execute({ name: "link-1" }, h.exec)).rejects.toThrow(/symlink/)
  // the link is still a link, the real instance is untouched, and the link is not a list entry
  expect(readText(join(inst("real-1"), "meta.json"))).toBe(before)
  expect(existsSync(inst("link-1"))).toBe(true)
  expect(existsSync(inst("link-2"))).toBe(false)
  expect(h.provided.mpdWorkmate.list().map((w: any) => w.name)).toEqual(["real-1"])
})

// ── unknown / orphan targets (§M3) ─────────────────────────────────────────────────────────────
test("unknown and orphan directories are never touched (M3), repeat delete is 404", async () => {
  const h = makeHarness()
  await expect(h.byName("mpd_workmate_rename").execute({ name: "nope", new_name: "other" }, h.exec)).rejects.toThrow(/no workmate named/)
  await expect(h.byName("mpd_workmate_delete").execute({ name: "nope" }, h.exec)).rejects.toThrow(/no workmate named/)

  // an orphan directory (no meta.json) is not addressable
  mkdirSync(join(inst("orphan-1"), "junk"), { recursive: true })
  writeFileSync(join(inst("orphan-1"), "junk", "f.txt"), "leave me")
  await expect(h.byName("mpd_workmate_rename").execute({ name: "orphan-1", new_name: "orphan-2" }, h.exec)).rejects.toThrow(/no meta.json/)
  await expect(h.byName("mpd_workmate_delete").execute({ name: "orphan-1" }, h.exec)).rejects.toThrow(/no meta.json/)
  expect(readText(join(inst("orphan-1"), "junk", "f.txt"))).toBe("leave me")
  expect(existsSync(inst("orphan-2"))).toBe(false)

  // delete + repeat delete (deliberately 404, not an idempotent 200)
  await initOne(h, "twice-1")
  expect((await h.byName("mpd_workmate_delete").execute({ name: "twice-1" }, h.exec)).purged).toBe(false)
  await expect(h.byName("mpd_workmate_delete").execute({ name: "twice-1" }, h.exec)).rejects.toThrow(/no workmate named/)
})

// ── delete: archive-first (D1) and explicit purge ──────────────────────────────────────────────
test("delete archives by default: hidden immediately, restorable, index key dropped", async () => {
  const h = makeHarness()
  await initOne(h, "oracle-1")
  await initOne(h, "keep-1")
  const keepBefore = readText(join(inst("keep-1"), "persona.md"))

  const out = await h.byName("mpd_workmate_delete").execute({ name: "oracle-1" }, h.exec)
  expect(out.ok).toBe(true)
  expect(out.purged).toBe(false)
  expect(typeof out.archived).toBe("string")
  expect(out.archived).toMatch(/\.archive[\\/]oracle-1-\d{4}-\d{2}-\d{2}T\d{6}Z$/)
  expect(existsSync(inst("oracle-1"))).toBe(false)
  expect(existsSync(out.archived)).toBe(true)

  // the archived copy is a complete instance (not a partial removal)
  for (const f of ["meta.json", "persona.md", "memory.md", "note.md"]) expect(existsSync(join(out.archived, f))).toBe(true)
  // gone from list / get / match / service immediately; the index key is dropped
  expect(h.provided.mpdWorkmate.get("oracle-1")).toBeNull()
  expect(h.provided.mpdWorkmate.read("oracle-1")).toBeNull()
  expect(h.provided.mpdWorkmate.list().map((w: any) => w.name)).toEqual(["keep-1"])
  const match = await h.byName("mpd_workmate_match").execute({ task: "anything at all" }, h.exec)
  expect(match.matches.map((m: any) => m.name)).toEqual(["keep-1"])
  expect(indexKeys()).toEqual(["keep-1"])
  // a reflect arriving after the delete must not resurrect the instance
  await expect(h.byName("mpd_workmate_reflect").execute({ name: "oracle-1", task: "t", outcome: "o" }, h.exec)).rejects.toThrow(/no workmate named "oracle-1"/)
  expect(existsSync(inst("oracle-1"))).toBe(false)
  // no other workmate's bytes changed
  expect(readText(join(inst("keep-1"), "persona.md"))).toBe(keepBefore)
})

test("purge requires confirm === name, then removes the instance for good (D1)", async () => {
  const h = makeHarness()
  await initOne(h, "purge-1")
  const del = (a: any) => h.byName("mpd_workmate_delete").execute(a, h.exec)

  // no confirm / wrong confirm → refused, nothing destroyed
  await expect(del({ name: "purge-1", purge: true })).rejects.toThrow(/confirm to equal the name/)
  await expect(del({ name: "purge-1", purge: true, confirm: "purge-2" })).rejects.toThrow(/confirm to equal the name/)
  await expect(del({ name: "purge-1", purge: true, confirm: " Purge-1 " })).rejects.toThrow(/confirm to equal the name/)
  expect(existsSync(inst("purge-1"))).toBe(true)
  expect(indexKeys()).toEqual(["purge-1"])

  // a non-boolean purge is not a purge: it archives (the safe direction)
  const soft = await del({ name: "purge-1", purge: "true", confirm: "purge-1" })
  expect(soft.purged).toBe(false)
  expect(existsSync(inst("purge-1"))).toBe(false)

  // real purge. ONE shape everywhere since the Architect's L1: the tool, the service and the §D HTTP
  // body all report `archived: null` (the schema allows null through `oneOf`, never a `type` array).
  await initOne(h, "purge-2")
  const out = await del({ name: "purge-2", purge: true, confirm: "purge-2" })
  expect(out).toEqual({ ok: true, name: "purge-2", archived: null, purged: true })
  expect(existsSync(inst("purge-2"))).toBe(false)
  expect(indexKeys()).toEqual([])
  // nothing left behind under the archive, including the purge staging directory
  const archive = join(root(), ".archive")
  expect(readdirSync(archive).filter((n) => n.startsWith("purge-2"))).toEqual([])
})

test("a READONLY instance is a valid mutation target: library administration, not self-editing (M1)", async () => {
  const h = makeHarness()
  await initOne(h, "librarian-1", "Researcher")
  expect(h.provided.mpdWorkmate.get("librarian-1").readonly).toBe(true)
  const out = await h.byName("mpd_workmate_rename").execute({ name: "librarian-1", new_name: "librarian-2" }, h.exec)
  expect(out.name).toBe("librarian-2")
  expect(h.provided.mpdWorkmate.get("librarian-2").readonly).toBe(true)
  const del = await h.byName("mpd_workmate_delete").execute({ name: "librarian-2" }, h.exec)
  expect(del.purged).toBe(false)
  expect(existsSync(inst("librarian-2"))).toBe(false)
})

test("delete never touches another workmate's bytes and leaves no partial instance", async () => {
  const h = makeHarness()
  await initOne(h, "alpha-1")
  await initOne(h, "beta-1")
  await h.byName("mpd_workmate_reflect").execute({ name: "alpha-1", task: "ta", outcome: "oa" }, h.exec)
  await h.byName("mpd_workmate_reflect").execute({ name: "beta-1", task: "tb", outcome: "ob" }, h.exec)
  const betaFiles = readdirSync(inst("beta-1")).sort().map((f) => f + ":" + readText(join(inst("beta-1"), f)))
  await h.byName("mpd_workmate_delete").execute({ name: "alpha-1" }, h.exec)
  const betaAfter = readdirSync(inst("beta-1")).sort().map((f) => f + ":" + readText(join(inst("beta-1"), f)))
  expect(betaAfter).toEqual(betaFiles)
  expect(indexKeys()).toEqual(["beta-1"])
})

// ── the in-use gate (§E) ───────────────────────────────────────────────────────────────────────
test("in-use gate: a name a team member holds blocks BOTH the rename target and the source (§E, A6)", async () => {
  const h = makeHarness()
  // A6: in production the blocked keys are roster member names; the record is fabricated in the
  // sandbox cwd so the case is deterministic under any invocation directory.
  writeTeamRecord(sb.cwd, "some-team", ["Architect", "Deep Worker"])
  await initOne(h, "oracle-1")

  // (1) renaming an existing instance TO a name a team member holds — the A6 deterministic refusal
  const targetErr = await h.byName("mpd_workmate_rename").execute({ name: "oracle-1", new_name: "architect" }, h.exec).then(() => null, (e: any) => e)
  expect(targetErr).not.toBeNull()
  expect(targetErr.code).toBe("in-use")
  expect(targetErr.status).toBe(409)
  expect(targetErr.blocking).toEqual([{ teamId: "some-team", member: "Architect" }])
  expect(targetErr.message).toContain("some-team/Architect") // the refusal must be actionable
  expect(existsSync(inst("oracle-1"))).toBe(true)
  expect(existsSync(inst("architect"))).toBe(false)

  // (2) the source side: an instance whose own key a team member holds
  await initOne(h, "architect")
  const srcErr = await h.byName("mpd_workmate_rename").execute({ name: "architect", new_name: "architect-2" }, h.exec).then(() => null, (e: any) => e)
  expect(srcErr.code).toBe("in-use")
  await expect(h.byName("mpd_workmate_delete").execute({ name: "architect" }, h.exec)).rejects.toThrow(/some-team\/Architect/)
  // refused means NOTHING happened
  expect(existsSync(inst("architect"))).toBe(true)
  expect(existsSync(inst("architect-2"))).toBe(false)
  expect(indexKeys()).toEqual(["architect", "oracle-1"])

  // a workmate no team member holds stays mutable
  expect((await h.byName("mpd_workmate_delete").execute({ name: "oracle-1" }, h.exec)).purged).toBe(false)
  await initOne(h, "oracle-3")
  expect((await h.byName("mpd_workmate_rename").execute({ name: "oracle-3", new_name: "oracle-4" }, h.exec)).name).toBe("oracle-4")
})

test("busyTeams reads <cwd>/.mpd/team, skips archived teams and non-directory entries, fails open", () => {
  // no team dir at all → no blocks (fail-open)
  expect(busyTeams("architect")).toEqual([])
  writeTeamRecord(sb.cwd, "live-team", ["Architect"])
  expect(busyTeams("architect")).toEqual([{ teamId: "live-team", member: "Architect" }])
  expect(busyTeams("oracle")).toEqual([])
  // archived teams live under team/archive/** (no record at the top level of the scan)
  writeTeamRecord(sb.cwd, "archived-team", ["Architect"], "archive")
  // retired-members.json is a file, not a directory → skipped
  writeFileSync(join(sb.cwd, ".mpd", "team", "retired-members.json"), JSON.stringify({ "Architect": true }))
  expect(busyTeams("architect")).toEqual([{ teamId: "live-team", member: "Architect" }])
  // an unreadable record is not a block
  mkdirSync(join(sb.cwd, ".mpd", "team", "broken-team"))
  writeFileSync(join(sb.cwd, ".mpd", "team", "broken-team", "team.json"), "{ not json")
  expect(busyTeams("architect")).toEqual([{ teamId: "live-team", member: "Architect" }])
})

// ── A3: the directory is the identity, never meta.name ─────────────────────────────────────────
test("A3: a stale meta.name cannot shadow the directory key, and a legacy key cannot resurrect a dir", async () => {
  const h = makeHarness()
  await initOne(h, "alice")
  await h.byName("mpd_workmate_reflect").execute({ name: "alice", task: "t1", outcome: "o1" }, h.exec)
  // simulate a mirror that drifted (e.g. an interrupted rename): meta.name says "stale"
  const meta = readJson(join(inst("alice"), "meta.json"))
  meta.name = "stale"
  writeFileSync(join(inst("alice"), "meta.json"), JSON.stringify(meta, null, 2) + "\n")

  expect(h.provided.mpdWorkmate.list().map((w: any) => w.name)).toEqual(["alice"])
  expect(dirNames()).toEqual(["alice"])

  // reflect keys on the directory: it writes alice/ (not stale/) and repairs the mirror
  await h.byName("mpd_workmate_reflect").execute({ name: "alice", task: "t2", outcome: "o2" }, h.exec)
  expect(existsSync(inst("stale"))).toBe(false)
  expect(readJson(join(inst("alice"), "meta.json")).name).toBe("alice")
  expect(readText(join(inst("alice"), "memory.md"))).toContain("t2")
  expect(indexKeys()).toEqual(["alice"])

  // M4: a reflect with the LEGACY key fails and must not resurrect the old directory
  await h.byName("mpd_workmate_rename").execute({ name: "alice", new_name: "alice-2" }, h.exec)
  await expect(h.byName("mpd_workmate_reflect").execute({ name: "alice", task: "t3", outcome: "o3" }, h.exec)).rejects.toThrow(/no workmate named "alice"/)
  expect(existsSync(inst("alice"))).toBe(false)
  expect(dirNames()).toEqual(["alice-2"])
  await expect(h.byName("mpd_workmate_spawn").execute({ name: "alice", task: "t" }, h.exec)).rejects.toThrow(/no workmate named "alice"/)
})

// ── atomicity (§H, §J) ─────────────────────────────────────────────────────────────────────────
test("an interrupted rename is rolled back: no half-moved instance, the key stays addressable", async () => {
  const h = makeHarness()
  await initOne(h, "oracle-1")
  const persona = readText(join(inst("oracle-1"), "persona.md"))
  const memory = readText(join(inst("oracle-1"), "memory.md"))
  // Fault injection for the partial-failure window: replace index.json with a DIRECTORY so the index
  // write throws AFTER the directory has already moved. (Root bypasses permission bits, so this is
  // the reliable way to make the post-move step fail.)
  rmSync(join(root(), "index.json"))
  mkdirSync(join(root(), "index.json"))

  const err = await h.byName("mpd_workmate_rename").execute({ name: "oracle-1", new_name: "oracle-2" }, h.exec).then(() => null, (e: any) => e)
  expect(err).not.toBeNull()
  expect(err.message).not.toContain(process.env.HOME as string) // no absolute path in an error body

  // rolled back: the instance is still addressable at its original key with its bytes intact
  expect(existsSync(inst("oracle-1"))).toBe(true)
  expect(existsSync(inst("oracle-2"))).toBe(false)
  expect(readText(join(inst("oracle-1"), "persona.md"))).toBe(persona)
  expect(readText(join(inst("oracle-1"), "memory.md"))).toBe(memory)
  expect(h.provided.mpdWorkmate.list().map((w: any) => w.name)).toEqual(["oracle-1"])
})

// ── the spawn counter must never leak a permanent block (§J) ───────────────────────────────────
test("a throwing spawn releases the in-use counter, so it cannot block a later rename", async () => {
  const h = makeHarness({ spawnThrows: true })
  await initOne(h, "oracle-1")
  await expect(h.byName("mpd_workmate_spawn").execute({ name: "oracle-1", task: "t" }, h.exec)).rejects.toThrow(/spawn boom/)
  const out = await h.byName("mpd_workmate_rename").execute({ name: "oracle-1", new_name: "oracle-2" }, h.exec)
  expect(out.name).toBe("oracle-2")
})

// ── output-schema safety (defect: a type ARRAY aborts the WHOLE plugin tree at load) ──────────
test("no registered output schema uses a type ARRAY, and every surface reports archived: null on purge", async () => {
  const h = makeHarness()
  // Regression pin for the measured defect: `archived: { type: ["string","null"] }` made the harness
  // throw `unsupported JSON schema: ... must be a single type string` and abort the entire plugin
  // tree, so the whole profile could not boot. One union anywhere is fatal, hence the sweep below.
  for (const t of h.tools) {
    const json = JSON.stringify(t.output?.schema ?? {})
    expect({ tool: t.name, hasTypeArray: /"type":\s*\[/.test(json) }).toEqual({ tool: t.name, hasTypeArray: false })
  }
  // nullable is expressed as `oneOf` (accepted by this harness validator), never as a type array
  const archived = h.byName("mpd_workmate_delete").output.schema.properties.archived
  expect(archived.oneOf).toEqual([{ type: "string" }, { type: "null" }])
  expect(archived.type).toBeUndefined()

  // ONE shape everywhere: tool, service and wire all say null on purge (Architect L1)
  await initOne(h, "shape-1")
  const viaTool = await h.byName("mpd_workmate_delete").execute({ name: "shape-1", purge: true, confirm: "shape-1" }, h.exec)
  expect(viaTool.archived).toBeNull()
  await initOne(h, "shape-2")
  expect(h.provided.mpdWorkmate.delete("shape-2", true, "shape-2").archived).toBeNull()
  await initOne(h, "shape-3")
  const viaRoute = await h.call("delete", "POST", { name: "shape-3", purge: true, confirm: "shape-3" })
  expect(viaRoute.status).toBe(200)
  expect(viaRoute.body.archived).toBeNull()
  // the archive case keeps the real path on BOTH surfaces
  await initOne(h, "shape-4")
  expect((await h.call("delete", "POST", { name: "shape-4" })).body.archived).toMatch(/\.archive[\\/]shape-4-/)
})

// ── the HTTP wire protocol (§D) ────────────────────────────────────────────────────────────────
test("routes: §D status/reason matrix, headers, no path leakage", async () => {
  const h = makeHarness()
  await initOne(h, "oracle-1")
  await initOne(h, "oracle-3")
  mkdirSync(inst("oracle-9")) // collision target: existing empty directory

  // success (rename) + protocol headers
  const ok = await h.call("rename", "POST", { name: "oracle-1", new_name: "oracle-2" })
  expect(ok.status).toBe(200)
  expect(ok.body).toMatchObject({ ok: true, name: "oracle-2", from: "oracle-1" })
  expect(ok.headers["content-type"]).toBe("application/json; charset=utf-8")
  expect(ok.headers["cache-control"]).toBe("no-store")

  // wrong verb
  const verb = await h.call("rename", "GET")
  expect(verb.status).toBe(405)
  expect(verb.headers.allow).toBe("POST")
  expect(verb.raw).toBe("")
  expect((await h.call("delete", "PUT")).status).toBe(405)

  // invalid JSON body
  const route = h.routes.find((r) => r.path === "/plugins/mpd-workmate/rename")
  const res: any = { status: 0, headers: {}, raw: "", writeHead(s: number, hd: any) { res.status = s; res.headers = hd }, end(b?: any) { res.raw = b === undefined ? "" : String(b) } }
  await route.handler({ method: "POST", async *[Symbol.asyncIterator]() { yield Buffer.from("{ nope") } }, res)
  expect(res.status).toBe(400)
  expect(JSON.parse(res.raw).error).toBeTruthy()

  const cases = [
    { path: "rename", method: "POST", body: { name: "oracle-2", new_name: "Alice" }, status: 400, reason: "invalid-name" },
    { path: "rename", method: "POST", body: { name: "Alice", new_name: "bob" }, status: 400, reason: "invalid-name" },
    { path: "rename", method: "POST", body: { name: "ghost", new_name: "oracle-4" }, status: 404, reason: "unknown" },
    { path: "rename", method: "POST", body: { name: "oracle-2", new_name: "oracle-9" }, status: 409, reason: "collision" },
    { path: "rename", method: "POST", body: { name: "oracle-2", new_name: "oracle-2" }, status: 400, reason: "invalid-name" },
    { path: "delete", method: "POST", body: { name: "ghost" }, status: 404, reason: "unknown" },
    { path: "delete", method: "POST", body: { name: "oracle-2", purge: true }, status: 400, reason: "confirm-required" },
    { path: "delete", method: "POST", body: { name: "Alice" }, status: 400, reason: "invalid-name" }
  ]
  for (const c of cases) {
    const r = await h.call(c.path, c.method, c.body)
    expect({ case: c.path + " " + JSON.stringify(c.body), status: r.status, reason: r.body?.reason })
      .toEqual({ case: c.path + " " + JSON.stringify(c.body), status: c.status, reason: c.reason })
    expect(typeof r.body.error).toBe("string")
    // an error body never leaks an absolute filesystem path
    expect(r.body.error.includes(process.env.HOME as string)).toBe(false)
    expect(r.body.error.includes("/tmp/")).toBe(false)
    expect(r.headers["cache-control"]).toBe("no-store")
  }

  // in-use → 409 with the blocking teams (the GUI branches on both fields). The target-name face is
  // asserted first: once an `architect` instance exists the collision guard owns that name instead.
  writeTeamRecord(sb.cwd, "blocking-team", ["Architect"])
  const inUseTarget = await h.call("rename", "POST", { name: "oracle-2", new_name: "architect" })
  expect(inUseTarget.status).toBe(409)
  expect(inUseTarget.body.reason).toBe("in-use")
  expect(inUseTarget.body.blocking).toEqual([{ teamId: "blocking-team", member: "Architect" }])
  await initOne(h, "architect")
  const inUse = await h.call("rename", "POST", { name: "architect", new_name: "architect-2" })
  expect(inUse.status).toBe(409)
  expect(inUse.body.reason).toBe("in-use")
  expect(inUse.body.blocking).toEqual([{ teamId: "blocking-team", member: "Architect" }])
  expect((await h.call("delete", "POST", { name: "architect" })).status).toBe(409)

  // delete: archive then purge
  const archived = await h.call("delete", "POST", { name: "oracle-3" })
  expect(archived.status).toBe(200)
  expect(archived.body).toMatchObject({ ok: true, name: "oracle-3", purged: false })
  expect(typeof archived.body.archived).toBe("string")
  await initOne(h, "oracle-5")
  const purged = await h.call("delete", "POST", { name: "oracle-5", purge: true, confirm: "oracle-5" })
  expect(purged.status).toBe(200)
  expect(purged.body).toEqual({ ok: true, name: "oracle-5", archived: null, purged: true })
})

test("a headless profile stays tool-only: no webServer, no route work, tools still function", async () => {
  const h = makeHarness({ web: false })
  expect(h.routes).toEqual([])
  await initOne(h, "oracle-1")
  const out = await h.byName("mpd_workmate_rename").execute({ name: "oracle-1", new_name: "oracle-2" }, h.exec)
  expect(out.name).toBe("oracle-2")
  expect((await h.byName("mpd_workmate_delete").execute({ name: "oracle-2" }, h.exec)).purged).toBe(false)
})

// ── output-schema conformance (t15 defect) ─────────────────────────────────────────────────────
// The exact gap this locks: the mutation tools returned `{ ok: true, ... }` while their declared
// `output.schema` had `additionalProperties: false` and no `ok` property. Every OTHER check missed
// it — the cases above drive a fake `ctx.tools.register` (so no validator runs), the route matrix
// bypasses the tool runtime entirely, and even a real-boot call with an INVALID name is refused
// before a value is produced. Only a VALID tool call through the harness output validator sees it,
// and there the harness answered `tool "mpd_workmate_rename" returned invalid output: "value.ok" is
// not a declared property (additionalProperties: false)` AFTER the mutation had been applied.
//
// So this case runs the REAL harness validator (`@deepseek-ai/dsh-tools`, the same library the
// tool runtime uses) against the schema the plugin actually registers, with the value the tool
// actually returns — and pins the old shape as a FAILURE so the defect can never come back silently.
import { createRequire } from "node:module"
import { existsSync } from "node:fs"

/** Every npm-global location the installed harness can live in, derived from the `dsh` binary. */
function harnessToolsCandidates(): string[] {
  const requireHere = createRequire(join(import.meta.dirname, "noop.js"))
  const candidates: string[] = []
  try { candidates.push(requireHere.resolve("@deepseek-ai/dsh-tools")) } catch { /* not a dependency of this checkout */ }
  try {
    const { execFileSync } = require("node:child_process")
    const dsh = execFileSync("which", ["dsh"], { encoding: "utf8" }).trim()
    const globalLib = join(dirname(dsh), "..", "lib", "node_modules")
    for (const base of [join(globalLib, "@deepseek-ai", "dsh"), globalLib]) {
      candidates.push(join(base, "node_modules", "@deepseek-ai", "dsh-tools", "lib", "index.js"))
    }
  } catch { /* dsh not on PATH */ }
  return candidates
}

/** The harness validator, resolved from the installed harness (never a local re-implementation). */
async function harnessValidator(): Promise<{ assertSupportedJsonSchema: (s: unknown) => void; validateJsonSchemaValue: (s: unknown, v: unknown, p?: string) => string[] }> {
  for (const candidate of harnessToolsCandidates()) {
    if (candidate.endsWith(".js") && !existsSync(candidate)) continue
    try {
      const mod: any = await import(candidate)
      if (typeof mod.validateJsonSchemaValue === "function" && typeof mod.assertSupportedJsonSchema === "function") return mod
    } catch { /* try the next resolution route */ }
  }
  throw new Error("t15: the harness validator (@deepseek-ai/dsh-tools) is unreachable from this checkout — this case cannot be skipped, it IS the regression lock")
}

test("the mutation tools' declared output schemas accept the values they return (t15)", async () => {
  const harness = await harnessValidator()
  const h = makeHarness()

  /** Drive a tool exactly as the harness would: run it, then validate the value against its schema. */
  const violationsOf = async (toolName: string, args: Record<string, unknown>) => {
    const tool = h.byName(toolName)
    expect(tool, toolName + " must be registered").toBeDefined()
    // Registration itself rejects an unsupported schema (name/type/parameters shape).
    harness.assertSupportedJsonSchema(tool.output.schema)
    const value = await tool.execute(args, h.exec)
    return { value, violations: harness.validateJsonSchemaValue(tool.output.schema, value, "value") }
  }

  await initOne(h, "oracle-1")
  const rename = await violationsOf("mpd_workmate_rename", { name: "oracle-1", new_name: "oracle-2" })
  expect({ violations: rename.violations }).toEqual({ violations: [] })
  expect(rename.value).toMatchObject({ ok: true, name: "oracle-2", from: "oracle-1" })

  const archive = await violationsOf("mpd_workmate_delete", { name: "oracle-2" })
  expect({ violations: archive.violations }).toEqual({ violations: [] })
  expect(archive.value).toMatchObject({ ok: true, name: "oracle-2", purged: false })

  await initOne(h, "oracle-3")
  const purge = await violationsOf("mpd_workmate_delete", { name: "oracle-3", purge: true, confirm: "oracle-3" })
  expect({ violations: purge.violations }).toEqual({ violations: [] })
  expect(purge.value).toMatchObject({ ok: true, name: "oracle-3", archived: null, purged: true })
})

test("the OLD return shape is rejected by the harness validator, so this lock can actually fail (t15)", async () => {
  const harness = await harnessValidator()
  const h = makeHarness()

  // The pre-repair schemas, byte-for-byte as they shipped in the defect (no `ok` property while
  // additionalProperties: false is set). Validating the CURRENT value against them must reproduce
  // the production failure exactly — otherwise this test cannot detect the regression it locks.
  const oldRenameSchema = { type: "object", properties: { name: { type: "string" }, from: { type: "string" }, renamedFrom: { type: "array", items: { type: "string" } } }, required: ["name", "from"], additionalProperties: false }
  const oldDeleteSchema = { type: "object", properties: { name: { type: "string" }, archived: { oneOf: [{ type: "string" }, { type: "null" }] }, purged: { type: "boolean" } }, required: ["name", "archived", "purged"], additionalProperties: false }

  await initOne(h, "oracle-1")
  const renameValue = await h.byName("mpd_workmate_rename").execute({ name: "oracle-1", new_name: "oracle-2" }, h.exec)
  const renameViolations = harness.validateJsonSchemaValue(oldRenameSchema, renameValue, "value")
  expect(renameViolations.length).toBeGreaterThan(0)
  expect(renameViolations.join("; ")).toContain('"value.ok" is not a declared property')

  const archiveValue = await h.byName("mpd_workmate_delete").execute({ name: "oracle-2" }, h.exec)
  expect(harness.validateJsonSchemaValue(oldDeleteSchema, archiveValue, "value").join("; ")).toContain('"value.ok" is not a declared property')

  await initOne(h, "oracle-3")
  const purgeValue = await h.byName("mpd_workmate_delete").execute({ name: "oracle-3", purge: true, confirm: "oracle-3" }, h.exec)
  expect(harness.validateJsonSchemaValue(oldDeleteSchema, purgeValue, "value").join("; ")).toContain('"value.ok" is not a declared property')

  // …and the CURRENT schemas accept those very same values: the repair is the difference.
  expect(harness.validateJsonSchemaValue(h.byName("mpd_workmate_rename").output.schema, renameValue, "value")).toEqual([])
  expect(harness.validateJsonSchemaValue(h.byName("mpd_workmate_delete").output.schema, archiveValue, "value")).toEqual([])
  expect(harness.validateJsonSchemaValue(h.byName("mpd_workmate_delete").output.schema, purgeValue, "value")).toEqual([])
})

// ── deny list (A2) ─────────────────────────────────────────────────────────────────────────────
test("the workmate deny list denies bash and the write-capable MCP tools, and carries no dead name", async () => {
  expect(READONLY_DENY).toEqual(["write", "edit", "mpd_hashline_edit", "bash", "mcp__ast_grep__rewrite", "mcp__ast_grep__scan", "mcp__lsp__rename"])
  for (const dead of ["str_replace" + "_editor", "apply" + "_patch"]) expect(READONLY_DENY).not.toContain(dead)

  const h = makeHarness()
  await initOne(h, "librarian-1", "Researcher")
  await h.byName("mpd_workmate_spawn").execute({ name: "librarian-1", task: "search" }, h.exec)
  expect(h.spawned[0].toolFilter).toEqual({ deny: [...READONLY_DENY] })
  // a non-readonly workmate keeps its write tools
  await initOne(h, "worker-1")
  await h.byName("mpd_workmate_spawn").execute({ name: "worker-1", task: "write" }, h.exec)
  expect(h.spawned[1].toolFilter).toBeUndefined()
})

// ── C3: the workmate web routes expose no roster id and no baseId ───────────────────────────────
test("the workmate web routes carry no id/baseId for a base or an instance", async () => {
  const h = makeHarness()
  await initOne(h, "routes-1")
  const callRoute = async (path: string, url = "") => {
    const route = h.routes.find((r) => r.path === "/plugins/mpd-workmate/" + path)
    if (!route) throw new Error("no route registered for " + path)
    const res: any = {
      status: 0, headers: {} as Record<string, string>, raw: "",
      writeHead(s: number, hd: any) { res.status = s; res.headers = hd ?? {} },
      end(b?: any) { res.raw = b === undefined ? "" : String(b) }
    }
    await route.handler({ method: "GET", url, async *[Symbol.asyncIterator]() {} }, res)
    return { status: res.status, body: res.raw === "" ? null : JSON.parse(res.raw) }
  }

  const list = await callRoute("list")
  expect(list.status).toBe(200)
  expect(list.body.workmates.length).toBe(1)
  for (const w of list.body.workmates) {
    expect(Object.hasOwn(w, "baseId")).toBe(false)
    expect(Object.hasOwn(w, "id")).toBe(false)
    expect(w.baseName).toBe("Deep Worker")
  }

  const roster = await callRoute("roster")
  expect(roster.status).toBe(200)
  expect(roster.body.bases.map((b: any) => b.name)).toEqual(["Deep Worker", "Researcher"])
  for (const b of roster.body.bases) {
    expect(Object.hasOwn(b, "id")).toBe(false)
    expect(Object.hasOwn(b, "baseId")).toBe(false)
  }

  const get = await callRoute("get", "/plugins/mpd-workmate/get?name=routes-1")
  expect(get.status).toBe(200)
  expect(Object.hasOwn(get.body, "baseId")).toBe(false)
  expect(get.body.baseName).toBe("Deep Worker")
  expect(get.body.name).toBe("routes-1")
})
