import { test, expect } from "bun:test"
import { apply, sanitizeName, capText, autoNote, scoreMatch, PERSONA_CAP, MEMORY_CAP, NOTE_CAP, MATCH_THRESHOLD } from "../src/index.ts"
import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

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

function makePlugin() {
  const tools: any[] = []
  const spawned: any[] = []
  const provided: any = {}
  const ctx: any = {
    get: (k: string) => (k === "mpdRoles" ? makeRoles() : undefined),
    tools: { register(d: any) { tools.push(d) } },
    subagents: {
      start: async (_kind: string, opts: any) => {
        spawned.push(opts)
        return { result: { structured: { name: "alice", summary: "implemented the verilog counter", recommendation: "review the clocking", evidence: ["file:line"] }, stopReason: "complete" } }
      }
    },
    provide: (n: string, v: any) => { provided[n] = v }
  }
  apply(ctx)
  const byName = (n: string) => tools.find((t) => t.name === n)
  const exec = { agent: { id: "agent-1" }, signal: new AbortController().signal }
  return { tools, spawned, provided, byName, exec }
}

function sandboxHome() {
  const dir = mkdtempSync(join(tmpdir(), "mpd-wm-test-"))
  process.env.HOME = dir
  return dir
}

test("sanitizeName / capText / autoNote / scoreMatch units", () => {
  expect(sanitizeName("  Alice Cooper  ")).toBe("alice-cooper")
  expect(sanitizeName("Deep Worker")).toBe("deep-worker")
  expect(capText("x".repeat(10), 100).length).toBe(10)
  const capped = capText("a".repeat(100) + "B".repeat(100), 80)
  // content head+tail stays within max; the fixed truncation marker adds a small constant
  expect(capped.length).toBeLessThanOrEqual(80 + 64)
  expect(capped.includes("truncated")).toBe(true)
  const meta = { name: "alice", baseId: "hephaestus", baseName: "Deep Worker", description: "autonomous goal-driven implementation", provider: "deepseek-official", model: "deepseek-v4-flash", readonly: false, createdAt: "", updatedAt: "", uses: 1, lastTask: "implement verilog counter" }
  const note = autoNote(meta, "You are the Deep Worker.", "## 2026-01-01 — implement counter\nwrote cnt8.v")
  expect(note).toContain("Deep Worker")
  expect(note).toContain("counter")
  const implScore = scoreMatch("implement a verilog counter and verify", { note, baseName: "Deep Worker", description: meta.description, memoryTail: "wrote cnt8.v" })
  const unrelated = scoreMatch("paint a landscape", { note, baseName: "Deep Worker", description: meta.description, memoryTail: "wrote cnt8.v" })
  expect(implScore).toBeGreaterThan(unrelated)
  expect(MATCH_THRESHOLD).toBeGreaterThan(0)
  expect(MATCH_THRESHOLD).toBeLessThanOrEqual(1)
})

test("init → list → reflect → match lifecycle with a sandbox HOME", async () => {
  const home = sandboxHome()
  const { byName, exec, provided } = makePlugin()

  // unknown base
  await expect(byName("mpd_workmate_init").execute({ base: "nope" }, exec)).rejects.toThrow(/unknown base/)

  // init by FUNCTIONAL NAME (C1) — spelled with a space, and the name key is insensitive
  const init = await byName("mpd_workmate_init").execute({ base: "deep worker", name: "alice", note: "Counter specialist" }, exec)
  expect(init.name).toBe("alice")
  expect(init.baseName).toBe("Deep Worker")
  expect(init.model).toBe("deepseek-v4-flash")
  expect(init.baseId).toBeUndefined()
  expect(existsSync(join(home, ".mpd", "workmate", "alice", "meta.json"))).toBe(true)
  expect(existsSync(join(home, ".mpd", "workmate", "alice", "persona.md"))).toBe(true)
  expect(readFileSync(join(home, ".mpd", "workmate", "alice", "persona.md"), "utf8")).toContain("Deep Worker")
  // C4 negative control: the internal provenance key still lands on disk.
  expect(JSON.parse(readFileSync(join(home, ".mpd", "workmate", "alice", "meta.json"), "utf8")).baseId).toBe("hephaestus")

  // duplicate init rejected
  await expect(byName("mpd_workmate_init").execute({ base: "Deep Worker", name: "alice" }, exec)).rejects.toThrow(/already exists/)

  // init by an alternate spelling (hyphen) with an auto name (C2)
  const init2 = await byName("mpd_workmate_init").execute({ base: "researcher" }, exec)
  expect(init2.name).toBe("researcher-1")
  expect(init2.readonly).toBe(true)
  expect(init2.baseId).toBeUndefined()

  // list
  const list = await byName("mpd_workmate_list").execute({}, exec)
  expect(list.count).toBe(2)
  expect(list.workmates.map((w: any) => w.name).sort()).toEqual(["alice", "researcher-1"])
  expect(list.workmates.find((w: any) => w.name === "alice").note).toContain("Counter")
  // C3: no baseId key on any list row
  for (const w of list.workmates) expect(Object.hasOwn(w, "baseId")).toBe(false)

  // reflect: append memory, bump uses, regenerate note, cap memory
  const big = "x".repeat(MEMORY_CAP + 500)
  const r1 = await byName("mpd_workmate_reflect").execute({ name: "alice", task: "implement verilog counter", outcome: "wrote cnt8.v; gate passed", persona_delta: "prefer synchronous always blocks" }, exec)
  expect(r1.updated).toBe(true)
  expect(r1.uses).toBe(1)
  const r2 = await byName("mpd_workmate_reflect").execute({ name: "alice", task: "large memory", outcome: big }, exec)
  expect(r2.memoryChars).toBeLessThanOrEqual(MEMORY_CAP)
  const persona = readFileSync(join(home, ".mpd", "workmate", "alice", "persona.md"), "utf8")
  expect(persona).toContain("synchronous always blocks")
  const memory = readFileSync(join(home, ".mpd", "workmate", "alice", "memory.md"), "utf8")
  expect(memory).toContain("implement verilog counter")
  const note = readFileSync(join(home, ".mpd", "workmate", "alice", "note.md"), "utf8")
  expect(note.length).toBeLessThanOrEqual(NOTE_CAP + 2)

  // match: implementation task hits alice (Deep Worker), unrelated task does not match
  const m1 = await byName("mpd_workmate_match").execute({ task: "implement a verilog counter and verify it" }, exec)
  expect(m1.matched).toBe(true)
  expect(m1.matches[0].name).toBe("alice")
  for (const m of m1.matches) expect(Object.hasOwn(m, "baseId")).toBe(false)
  const m2 = await byName("mpd_workmate_match").execute({ task: "paint a watercolor landscape" }, exec)
  expect(m2.matched).toBe(false)
  expect(m2.suggestion).toContain("NEW workmate")

  // service exposes list/get/read — and none of them leaks the internal baseId
  const svcList = provided.mpdWorkmate.list()
  expect(svcList.length).toBe(2)
  for (const w of svcList) expect(Object.hasOwn(w, "baseId")).toBe(false)
  expect(provided.mpdWorkmate.get("alice").note).toContain("Deep Worker")
  expect(Object.hasOwn(provided.mpdWorkmate.get("alice"), "baseId")).toBe(false)
  expect(provided.mpdWorkmate.read("alice").memory).toContain("implement verilog counter")
  expect(Object.hasOwn(provided.mpdWorkmate.read("alice"), "baseId")).toBe(false)
  expect(provided.mpdWorkmate.get("missing")).toBeNull()
})

// ── C1/C2/C3: the omo alias is gone from the workmate place ─────────────────────────────────────
test("an omo roster id is refused as a base even when roles.get(id) resolves it, and the refusal names NAMES only", async () => {
  sandboxHome()
  const { byName, exec } = makePlugin()
  const OMO_IDS = ["hephaestus", "sisyphus", "oracle", "librarian", "explore", "metis", "momus", "multimodal-looker", "sisyphus-junior"]
  for (const id of OMO_IDS) {
    const err = await byName("mpd_workmate_init").execute({ base: id, name: "ghost-" + id }, exec).then(() => null, (e: any) => e)
    expect(err).not.toBeNull()
    expect(String(err.message)).toContain("unknown base")
    // the valid functional names ARE listed...
    expect(String(err.message)).toContain("Deep Worker")
    expect(String(err.message)).toContain("Researcher")
    // ...and no id appears anywhere in the message
    for (const other of OMO_IDS) expect(String(err.message)).not.toContain(other)
  }
  // no ghost instance was created by any refusal
  const list = await byName("mpd_workmate_list").execute({}, exec)
  expect(list.count).toBe(0)
})

test("the base key is case/space/hyphen insensitive and the auto name derives from the functional name (C1/C2)", async () => {
  const home = sandboxHome()
  const { byName, exec } = makePlugin()
  for (const spelling of ["Deep Worker", "deep worker", "deep-worker", "DEEP WORKER"]) {
    const out = await byName("mpd_workmate_init").execute({ base: spelling }, exec)
    expect(out.baseName).toBe("Deep Worker")
    expect(out.name).toMatch(/^deep-worker-\d+$/)
  }
  const names = readdirSync(join(home, ".mpd", "workmate"), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort()
  expect(names).toEqual(["deep-worker-1", "deep-worker-2", "deep-worker-3", "deep-worker-4"])
  // never the internal id
  expect(names.some((n) => n.startsWith("hephaestus"))).toBe(false)
})

test("spawn carries persona+memory+note, reflect instruction, readonly deny, own route", async () => {
  sandboxHome()
  const { byName, spawned, exec } = makePlugin()
  await byName("mpd_workmate_init").execute({ base: "Deep Worker", name: "alice" }, exec)
  await byName("mpd_workmate_reflect").execute({ name: "alice", task: "verify counter", outcome: "verified" }, exec)
  const out = await byName("mpd_workmate_spawn").execute({ name: "alice", task: "add a reset", context: "module is cnt8" }, exec)
  expect(out.status).toBe("complete")
  expect(out.summary).toContain("verilog counter")
  const opts = spawned[0]
  expect(opts.agentOptions.provider).toBe("deepseek-official")
  expect(opts.agentOptions.model).toBe("deepseek-v4-flash")
  const prompt = opts.prompt[0].text
  expect(prompt).toContain("You are the Deep Worker")
  expect(prompt).toContain("mpd_workmate_reflect")
  expect(prompt).toContain("verified")
  expect(opts.toolFilter).toBeUndefined() // non-readonly workmate keeps write tools
  // Name unification: the subagent is labelled with the workmate's OWN name — the
  // same word a team member would carry — never a `workmate-<key>-<random>` alias.
  expect(opts.label).toBe("alice")

  // readonly base → deny write tools
  await byName("mpd_workmate_init").execute({ base: "Researcher", name: "bob" }, exec)
  const readonlyOut = await byName("mpd_workmate_spawn").execute({ name: "bob", task: "search evidence" }, exec)
  expect(readonlyOut.status).toBe("complete")
  expect(spawned[1].toolFilter).toEqual({ deny: expect.arrayContaining(["write", "edit"]) })
  expect(spawned[1].label).toBe("bob")
})

test("workmate library root is under HOME and not in cwd", () => {
  const home = sandboxHome()
  const { byName, exec } = makePlugin()
  void byName("mpd_workmate_init").execute({ base: "Deep Worker", name: "zed" }, exec)
  const root = join(home, ".mpd", "workmate")
  expect(existsSync(root)).toBe(true)
  expect(readdirSync(root)).toContain("zed")
  expect(process.env.HOME).toBe(home)
  expect(PERSONA_CAP).toBeGreaterThan(0)
})

// ── C3: no tool output schema, result or advertising string carries the internal baseId ─────────
test("no workmate tool advertises or returns baseId", async () => {
  sandboxHome()
  const { tools, byName, exec } = makePlugin()
  for (const t of tools) {
    expect(JSON.stringify(t.output?.schema ?? {})).not.toContain("baseId")
    expect(JSON.stringify(t.parameters ?? {})).not.toContain("baseId")
    expect(String(t.description ?? "")).not.toMatch(/roster id|normal name/i)
    expect(JSON.stringify(t.parameters ?? {})).not.toMatch(/roster id|hephaestus/i)
  }
  // the init parameter advertises the functional NAME, not an id
  const baseParam = byName("mpd_workmate_init").parameters.properties.base
  expect(baseParam.description).toContain("functional name")
  expect(baseParam.description).not.toMatch(/roster id|hephaestus/)
  const out = await byName("mpd_workmate_init").execute({ base: "Deep Worker", name: "probe" }, exec)
  expect(Object.hasOwn(out, "baseId")).toBe(false)
})
