import { describe, test, expect } from "bun:test"
import { apply, sanitizeName, capText, autoNote, scoreMatch, PERSONA_CAP, MEMORY_CAP, NOTE_CAP, MATCH_THRESHOLD } from "../src/index.ts"
import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

/** The Deep Worker BASE template: a write-capable specialist with a working chain and a persona. */
const DEEP_WORKER = {
  id: "hephaestus", name: "Deep Worker", description: "autonomous goal-driven implementation",
  readonly: false, chain: [{ provider: "deepseek-official", model: "deepseek-v4-flash" }],
  persona: "You are the Deep Worker. Execute goals end-to-end with tools and verify every change."
}
/** The Researcher BASE template: read-only, so a workmate built from it spawns with the deny list. */
const RESEARCHER = {
  id: "librarian", name: "Researcher", description: "code / open-source evidence search",
  readonly: true, chain: [{ provider: "deepseek-official", model: "deepseek-v4-flash" }],
  persona: "You are the Researcher. Gather evidence with citations; never edit files."
}

/** The fake `mpdRoles` service: `list` answers both base templates, `get` resolves one by internal roster id. */
function makeRoles(): { list: () => Array<typeof DEEP_WORKER | typeof RESEARCHER>; get: (k: string) => typeof DEEP_WORKER | typeof RESEARCHER | null } {
  /** Both base templates the fake service reports, in list order. */
  const all = [DEEP_WORKER, RESEARCHER]
  return {
    list: () => all.map((r) => ({ ...r })),
    get: (k: string) => {
      /** The base template for this id, or undefined when the roster has no such id. */
      const r = all.find((x) => x.id === k)
      return r ? { ...r } : null
    }
  }
}

/** Applies the plugin to a fake cordis context and returns the registration handles a case drives it through. */
function makePlugin(): { tools: any[]; spawned: any[]; provided: any; byName: (n: string) => any; exec: { agent: { id: string }; signal: AbortSignal } } {
  /** Every tool descriptor the plugin registered, in registration order. */
  const tools: any[] = []
  /** The options of every subagent the plugin started, so a case can assert persona, route and tool filter. */
  const spawned: any[] = []
  /** Services published through `ctx.provide`, keyed by service name. */
  const provided: any = {}
  /** The fake cordis context; only the seams this plugin injects are wired. */
  const ctx: any = {
    get: (k: string) => (k === "mpdRoles" ? makeRoles() : undefined),
    tools: {
      /** Records a tool registration instead of validating it — no harness sits behind this fake context. */
      register(d: any): void { tools.push(d) }
    },
    subagents: {
      start: async (_kind: string, opts: any) => {
        spawned.push(opts)
        return { result: { structured: { name: "alice", summary: "implemented the verilog counter", recommendation: "review the clocking", evidence: ["file:line"] }, stopReason: "complete" } }
      }
    },
    provide: (n: string, v: any) => { provided[n] = v }
  }
  apply(ctx)
  /** Looks one registered tool up by its registered name. */
  const byName = (n: string): any => tools.find((t) => t.name === n)
  /** The minimal execution context the tools read: the calling agent and an abort signal. */
  const exec = { agent: { id: "agent-1" }, signal: new AbortController().signal }
  return { tools, spawned, provided, byName, exec }
}

/** Points $HOME at a fresh temp directory, so the library lands in the sandbox and never the real home. */
function sandboxHome(): string {
  /** The scratch home the library root is resolved under. */
  const dir = mkdtempSync(join(tmpdir(), "mpd-wm-test-"))
  process.env.HOME = dir
  return dir
}

test("sanitizeName / capText / autoNote / scoreMatch units", () => {
  expect(sanitizeName("  Alice Cooper  ")).toBe("alice-cooper")
  expect(sanitizeName("Deep Worker")).toBe("deep-worker")
  expect(capText("x".repeat(10), 100).length).toBe(10)
  /** The truncation input: the head is what identifies the entry, the tail is what keeps it current. */
  const capped = capText("a".repeat(100) + "B".repeat(100), 80)
  // content head+tail AND the truncation marker stay within max (S6: the marker is paid for out of
  // the cap, never appended on top of it).
  expect(capped.length).toBeLessThanOrEqual(80)
  expect(capped.includes("truncated")).toBe(true)
  /** A never-renamed instance fixture, so `renamedFrom` is empty: the directory key is its first name. */
  const meta = { name: "alice", baseId: "hephaestus", baseName: "Deep Worker", description: "autonomous goal-driven implementation", provider: "deepseek-official", model: "deepseek-v4-flash", readonly: false, createdAt: "", updatedAt: "", uses: 1, lastTask: "implement verilog counter", renamedFrom: [] }
  /** The auto-generated note card, built from the identity prefix and the newest memory heading. */
  const note = autoNote(meta, "You are the Deep Worker.", "## 2026-01-01 — implement counter\nwrote cnt8.v")
  expect(note).toContain("Deep Worker")
  expect(note).toContain("counter")
  /** Match score for a task the Deep Worker note actually describes. */
  const implScore = scoreMatch("implement a verilog counter and verify", { note, baseName: "Deep Worker", description: meta.description, memoryTail: "wrote cnt8.v" })
  /** Match score for an unrelated task, the negative control of the ranking assertion. */
  const unrelated = scoreMatch("paint a landscape", { note, baseName: "Deep Worker", description: meta.description, memoryTail: "wrote cnt8.v" })
  expect(implScore).toBeGreaterThan(unrelated)
  expect(MATCH_THRESHOLD).toBeGreaterThan(0)
  expect(MATCH_THRESHOLD).toBeLessThanOrEqual(1)
})

test("S6: capText honours the cap MARKER INCLUDED, at the boundary and below it", () => {
  /** The oversized input the finding names: 9000 chars against an 8192 cap. */
  const text = "x".repeat(9000)
  // The exact case from the defect report, plus caps small enough that the marker itself must yield.
  for (const max of [PERSONA_CAP, 1200, 200, 40, 31, 8]) {
    expect(capText(text, max).length, `cap ${max} exceeded`).toBeLessThanOrEqual(max)
  }
  /** The 8192-byte cap the report measured: the pre-fix result was 8192 + the marker's own bytes. */
  const capped = capText(text, PERSONA_CAP)
  expect(capped.length).toBe(PERSONA_CAP)
  // The marker is still reported when there is room for it, and the head/tail both survive.
  expect(capped).toContain("[truncated")
  expect(capped.startsWith("xxx")).toBe(true)
  expect(capped.endsWith("xxx")).toBe(true)
  // Unchanged contract: a text at or under the cap is returned verbatim, marker-free.
  expect(capText("short", PERSONA_CAP)).toBe("short")
  expect(capText(text, text.length)).toBe(text)
})

test("init → list → reflect → match lifecycle with a sandbox HOME", async () => {
  /** The sandbox home every assertion below resolves the library under. */
  const home = sandboxHome()
  /** The fake harness handles this lifecycle case drives. */
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
  /** The list tool's view once both instances exist. */
  const list = await byName("mpd_workmate_list").execute({}, exec)
  expect(list.count).toBe(2)
  expect(list.workmates.map((w: any) => w.name).sort()).toEqual(["alice", "researcher-1"])
  expect(list.workmates.find((w: any) => w.name === "alice").note).toContain("Counter")
  // C3: no baseId key on any list row
  for (const w of list.workmates) expect(Object.hasOwn(w, "baseId")).toBe(false)

  // reflect: append memory, bump uses, regenerate note, cap memory
  const big = "x".repeat(MEMORY_CAP + 500)
  /** Reflect result for a normal task: the memory was appended and `uses` moved. */
  const r1 = await byName("mpd_workmate_reflect").execute({ name: "alice", task: "implement verilog counter", outcome: "wrote cnt8.v; gate passed", persona_delta: "prefer synchronous always blocks" }, exec)
  expect(r1.updated).toBe(true)
  expect(r1.uses).toBe(1)
  /** Reflect result for an oversized outcome, which must be capped rather than rejected. */
  const r2 = await byName("mpd_workmate_reflect").execute({ name: "alice", task: "large memory", outcome: big }, exec)
  expect(r2.memoryChars).toBeLessThanOrEqual(MEMORY_CAP)
  /** The persona after the reflect applied its `persona_delta`. */
  const persona = readFileSync(join(home, ".mpd", "workmate", "alice", "persona.md"), "utf8")
  expect(persona).toContain("synchronous always blocks")
  /** The memory read back from disk, proving the reflect persisted and did not only report. */
  const memory = readFileSync(join(home, ".mpd", "workmate", "alice", "memory.md"), "utf8")
  expect(memory).toContain("implement verilog counter")
  /** The regenerated note card, checked against the byte cap. */
  const note = readFileSync(join(home, ".mpd", "workmate", "alice", "note.md"), "utf8")
  expect(note.length).toBeLessThanOrEqual(NOTE_CAP + 2)

  // match: implementation task hits alice (Deep Worker), unrelated task does not match
  const m1 = await byName("mpd_workmate_match").execute({ task: "implement a verilog counter and verify it" }, exec)
  expect(m1.matched).toBe(true)
  expect(m1.matches[0].name).toBe("alice")
  for (const m of m1.matches) expect(Object.hasOwn(m, "baseId")).toBe(false)
  /** Match result for a task nothing in the library describes: it must suggest a NEW workmate. */
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

// AC4 of the model-config-live-refresh wave, re-aimed by the per-agent routes contract: a
// `mpd_workmate_spawn` re-resolves its route PER SPAWN from the base agent's OWN `agentRoutes` entry,
// so a change saved between two spawns is what the SECOND spawn runs on — the frozen
// `meta.provider/model` are provenance only (contract `.mpd/plans/agent-routes-per-agent.md` §4), and
// an unusable route REFUSES the spawn (§3).
describe("AC4 — the spawn route is re-resolved per spawn (R2)", () => {
  test("a config change between two spawns carries to the second, and meta stays provenance", async () => {
    /** The sandbox home the library lands under, never the real home. */
    sandboxHome()
    /** The route the live config serves, FLIPPED between the two spawns below. */
    let liveRoute: { provider: string; model: string; reasoningEffort?: string } = { provider: "deepseek-official", model: "deepseek-v4-flash", reasoningEffort: "high" }
    /** The config-service double: the ONE total read the spawn path consumes, answered per call. */
    const mpdConfig = {
      agentRouteResolutionOf: (member: string) => (member === "Deep Worker" ? { ok: true, agent: member, route: { ...liveRoute } } : { ok: false, reason: "unrouted" }),
    }
    /** Every tool descriptor the plugin registered, in registration order. */
    const tools: any[] = []
    /** The options of every spawn the case started, asserted per spawn below. */
    const spawned: any[] = []
    /** The fake cordis context: the roles roster, the LIVE config service and a spawn sink. */
    const ctx: any = {
      get: (k: string) => (k === "mpdRoles" ? makeRoles() : k === "mpdConfig" ? mpdConfig : undefined),
      tools: {
        /** Records a tool registration instead of validating it — no harness sits behind this fake context. */
        register(d: any): void { tools.push(d) }
      },
      subagents: {
        /** Records the spawn options and answers a minimal structured report. */
        start: async (_kind: string, opts: any) => {
          spawned.push(opts)
          return { result: { structured: { name: "alice", summary: "done" }, stopReason: "complete" } }
        }
      },
      provide: () => { /* this case reads the tools, not the service */ }
    }
    apply(ctx)
    /** Looks one registered tool up by its registered name. */
    const byName = (n: string): any => tools.find((t) => t.name === n)
    /** The minimal execution context the tools read. */
    const exec = { agent: { id: "agent-1" }, signal: new AbortController().signal }
    // The instance is created while the live route is the DEFAULT slot: meta freezes that route
    // as its init-time provenance snapshot.
    await byName("mpd_workmate_init").execute({ base: "Deep Worker", name: "route-probe" }, exec)
    /** The first spawn: the live config's route is what it runs on (the adapter merges the flat
     *  route into `agentOptions`, so the three route fields are read there). */
    await byName("mpd_workmate_spawn").execute({ name: "route-probe", task: "first" }, exec)
    expect(spawned[0].agentOptions.provider).toBe("deepseek-official")
    expect(spawned[0].agentOptions.model).toBe("deepseek-v4-flash")
    expect(spawned[0].agentOptions.reasoningEffort).toBe("high")
    // The in-process config change — an `agentRoutes` save the config row picked up live. No
    // re-init, no restart: the NEXT spawn must carry the new route.
    liveRoute = { provider: "gateway", model: "deepseek-v4-pro", reasoningEffort: "low" }
    await byName("mpd_workmate_spawn").execute({ name: "route-probe", task: "second" }, exec)
    expect(spawned[1].agentOptions.provider).toBe("gateway")
    expect(spawned[1].agentOptions.model).toBe("deepseek-v4-pro")
    expect(spawned[1].agentOptions.reasoningEffort).toBe("low")
    // The frozen meta stays PROVENANCE ONLY: the init-time route, byte-untouched by the change.
    /** The instance's metadata read back from disk, asserting the provenance values survive. */
    const meta = JSON.parse(readFileSync(join(process.env.HOME ?? "", ".mpd", "workmate", "route-probe", "meta.json"), "utf8"))
    expect(meta.provider).toBe("deepseek-official")
    expect(meta.model).toBe("deepseek-v4-flash")
  })

  test("TWO agents with DIFFERENT routes spawn independently — no cross-talk (§9)", async () => {
    /** The sandbox home the library lands under, never the real home. */
    sandboxHome()
    /** One route per base agent: different provider AND model, so a shared read would show. */
    const routes: Record<string, { provider: string; model: string }> = {
      "Deep Worker": { provider: "company-api", model: "deepseek-flash" },
      Researcher: { provider: "local-gateway", model: "deepseek-pro" },
    }
    /** The config-service double: each base's OWN entry, read per spawn. */
    const mpdConfig = {
      agentRouteResolutionOf: (member: string) => (routes[member] === undefined ? { ok: false, reason: "unrouted" } : { ok: true, agent: member, route: { ...routes[member] } }),
    }
    /** Every tool descriptor the plugin registered, in registration order. */
    const tools: any[] = []
    /** The options of every spawn, asserted per agent below. */
    const spawned: any[] = []
    /** The fake context: the roster double, the per-agent route service and a spawn sink. */
    const ctx: any = {
      get: (k: string) => (k === "mpdRoles" ? makeRoles() : k === "mpdConfig" ? mpdConfig : undefined),
      tools: {
        /** Records a tool registration instead of validating it — no harness sits behind this fake context. */
        register(d: any): void { tools.push(d) }
      },
      subagents: {
        /** Records the spawn options and answers a minimal structured report. */
        start: async (_kind: string, opts: any) => {
          spawned.push(opts)
          return { result: { structured: { name: "alice", summary: "done" }, stopReason: "complete" } }
        }
      },
      provide: () => { /* this case reads the tools, not the service */ }
    }
    apply(ctx)
    /** Looks one registered tool up by its registered name. */
    const byName = (n: string): any => tools.find((t) => t.name === n)
    /** The minimal execution context the tools read. */
    const exec = { agent: { id: "agent-1" }, signal: new AbortController().signal }
    await byName("mpd_workmate_init").execute({ base: "Deep Worker", name: "route-a" }, exec)
    await byName("mpd_workmate_init").execute({ base: "Researcher", name: "route-b" }, exec)
    await byName("mpd_workmate_spawn").execute({ name: "route-a", task: "go a" }, exec)
    await byName("mpd_workmate_spawn").execute({ name: "route-b", task: "go b" }, exec)
    expect(spawned.length).toBe(2)
    expect(spawned[0].agentOptions?.provider).toBe("company-api")
    expect(spawned[0].agentOptions?.model).toBe("deepseek-flash")
    expect(spawned[1].agentOptions?.provider).toBe("local-gateway")
    expect(spawned[1].agentOptions?.model).toBe("deepseek-pro")
  })

  test("an UNCONFIGURED route REFUSES the spawn — the frozen meta is never a route (§3)", async () => {
    /** The sandbox home the library lands under, never the real home. */
    sandboxHome()
    /** Every tool descriptor the plugin registered, in registration order. */
    const tools: any[] = []
    /** The options of every spawn the case starts; the refusal must leave this EMPTY. */
    const spawned: any[] = []
    /** A config double whose TOTAL resolution says Deep Worker's route is unconfigured. */
    const mpdConfig = {
      agentRouteResolutionOf: (member: string) => ({
        ok: false,
        reason: "unconfigured",
        agent: member,
        missing: ["agentRoutes." + member + ".provider", "agentRoutes." + member + ".model"],
      }),
    }
    /** The fake cordis context: the roster double, the unconfigured config service and a spawn sink. */
    const ctx: any = {
      get: (k: string) => (k === "mpdRoles" ? makeRoles() : k === "mpdConfig" ? mpdConfig : undefined),
      tools: {
        /** Records a tool registration instead of validating it — no harness sits behind this fake context. */
        register(d: any): void { tools.push(d) }
      },
      subagents: {
        /** Records the spawn options and answers a minimal structured report. */
        start: async (_kind: string, opts: any) => {
          spawned.push(opts)
          return { result: { structured: { name: "alice", summary: "done" }, stopReason: "complete" } }
        }
      },
      provide: () => { /* this case reads the tools, not the service */ }
    }
    apply(ctx)
    /** Looks one registered tool up by its registered name. */
    const byName = (n: string): any => tools.find((t) => t.name === n)
    /** The minimal execution context the tools read. */
    const exec = { agent: { id: "agent-1" }, signal: new AbortController().signal }
    // Init succeeds even with no route: the library is provenance, and a route is a SPAWN-time read.
    await byName("mpd_workmate_init").execute({ base: "Deep Worker", name: "unconfigured-probe" }, exec)
    // The spawn REFUSES with the canonical sentence (and the branchable code).
    /** The refusal captured instead of thrown, so its message and code can be inspected. */
    const refusal = await byName("mpd_workmate_spawn").execute({ name: "unconfigured-probe", task: "go" }, exec).then(() => null, (e: any) => e)
    expect(refusal).not.toBeNull()
    expect(String(refusal.message)).toContain("AGENT_UNCONFIGURED")
    expect(String(refusal.message)).toContain("agentRoutes.Deep Worker.provider")
    expect(String(refusal.message)).toContain("agentRoutes.Deep Worker.model")
    expect(refusal.code).toBe("AGENT_UNCONFIGURED")
    // NOTHING ran, and the provenance values on disk were never substituted for a route.
    expect(spawned).toEqual([])
  })

  test("no config service + no DECLARED route refuses; an extension base's own route still runs", async () => {
    /** The sandbox home the library lands under, never the real home. */
    sandboxHome()
    /** Every tool descriptor the plugin registered, in registration order. */
    const tools: any[] = []
    /** The options of every spawn the case starts. */
    const spawned: any[] = []
    /** The roster double: a BASE member with a BLANK chain (the slot decides, and no slot is
     *  mounted), plus an EXTENSION member whose own declaration IS its route. */
    const base = { ...DEEP_WORKER, chain: [] as Array<{ provider: string; model: string }> }
    /** An extension-shaped role: it declares its own route, which no slot routes. */
    const extension = { ...DEEP_WORKER, name: "Code Reviewer", id: "extension:flows:Code Reviewer", chain: [{ provider: "ext-provider", model: "ext-model" }], readonly: false }
    /** The roster double answering both shapes by name. */
    const roles = { list: () => [base, extension], get: (k: string) => (k === base.id ? base : k === extension.id ? extension : null) }
    /** The fake cordis context: NO config service, the roster double, a spawn sink. */
    const ctx: any = {
      get: (k: string) => (k === "mpdRoles" ? roles : undefined),
      tools: {
        /** Records a tool registration instead of validating it — no harness sits behind this fake context. */
        register(d: any): void { tools.push(d) }
      },
      subagents: {
        /** Records the spawn options and answers a minimal structured report. */
        start: async (_kind: string, opts: any) => {
          spawned.push(opts)
          return { result: { structured: { name: "alice", summary: "done" }, stopReason: "complete" } }
        }
      },
      provide: () => { /* this case reads the tools, not the service */ }
    }
    apply(ctx)
    /** Looks one registered tool up by its registered name. */
    const byName = (n: string): any => tools.find((t) => t.name === n)
    /** The minimal execution context the tools read. */
    const exec = { agent: { id: "agent-1" }, signal: new AbortController().signal }
    await byName("mpd_workmate_init").execute({ base: "Deep Worker", name: "base-probe" }, exec)
    /** The base member's refusal: no slot service and no declared route leaves nothing to run on. */
    const refusal = await byName("mpd_workmate_spawn").execute({ name: "base-probe", task: "go" }, exec).then(() => null, (e: any) => e)
    expect(refusal).not.toBeNull()
    expect(String(refusal.message)).toContain("no route configured for Deep Worker")
    expect(spawned).toEqual([])
    // The EXTENSION base still runs, on ITS OWN declared route — never on a shipped default.
    await byName("mpd_workmate_init").execute({ base: "Code Reviewer", name: "ext-probe" }, exec)
    await byName("mpd_workmate_spawn").execute({ name: "ext-probe", task: "review" }, exec)
    expect(spawned[0].agentOptions.provider).toBe("ext-provider")
    expect(spawned[0].agentOptions.model).toBe("ext-model")
  })
})

test("an omo roster id is refused as a base even when roles.get(id) resolves it, and the refusal names NAMES only", async () => {
  sandboxHome()
  /** The fake harness for the retired-id refusal case. */
  const { byName, exec } = makePlugin()
  /** The retired upstream roster ids, none of which may be accepted as a base or named in a refusal. */
  const OMO_IDS = ["hephaestus", "sisyphus", "oracle", "librarian", "explore", "metis", "momus", "multimodal-looker", "sisyphus-junior"]
  for (const id of OMO_IDS) {
    /** This id's refusal, captured instead of thrown so its message can be inspected. */
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
  /** The sandbox home all four accepted spellings must resolve into. */
  const home = sandboxHome()
  /** A fresh harness, so each spelling starts from an empty library. */
  const { byName, exec } = makePlugin()
  for (const spelling of ["Deep Worker", "deep worker", "deep-worker", "DEEP WORKER"]) {
    /** The init result for one accepted spelling of the base. */
    const out = await byName("mpd_workmate_init").execute({ base: spelling }, exec)
    expect(out.baseName).toBe("Deep Worker")
    expect(out.name).toMatch(/^deep-worker-\d+$/)
  }
  /** The directory keys actually created — the instance identities — sorted for comparison. */
  const names = readdirSync(join(home, ".mpd", "workmate"), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort()
  expect(names).toEqual(["deep-worker-1", "deep-worker-2", "deep-worker-3", "deep-worker-4"])
  // never the internal id
  expect(names.some((n) => n.startsWith("hephaestus"))).toBe(false)
})

test("spawn carries persona+memory+note, reflect instruction, readonly deny, own route", async () => {
  sandboxHome()
  /** The fake harness, including the spawn options every assertion below reads. */
  const { byName, spawned, exec } = makePlugin()
  await byName("mpd_workmate_init").execute({ base: "Deep Worker", name: "alice" }, exec)
  await byName("mpd_workmate_reflect").execute({ name: "alice", task: "verify counter", outcome: "verified" }, exec)
  /** The spawn result the harness returned for the non-readonly workmate. */
  const out = await byName("mpd_workmate_spawn").execute({ name: "alice", task: "add a reset", context: "module is cnt8" }, exec)
  expect(out.status).toBe("complete")
  expect(out.summary).toContain("verilog counter")
  /** The options the plugin handed the subagent runtime for that workmate. */
  const opts = spawned[0]
  expect(opts.agentOptions.provider).toBe("deepseek-official")
  expect(opts.agentOptions.model).toBe("deepseek-v4-flash")
  /** The first prompt block, which must carry persona, memory and the reflect instruction. */
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
  /** The spawn result for the read-only Researcher-based workmate. */
  const readonlyOut = await byName("mpd_workmate_spawn").execute({ name: "bob", task: "search evidence" }, exec)
  expect(readonlyOut.status).toBe("complete")
  expect(spawned[1].toolFilter).toEqual({ deny: expect.arrayContaining(["write", "edit"]) })
  expect(spawned[1].label).toBe("bob")
})

test("workmate library root is under HOME and not in cwd", () => {
  /** The sandbox home the library root must resolve under. */
  const home = sandboxHome()
  /** The fake harness, used here only to initialize an instance. */
  const { byName, exec } = makePlugin()
  void byName("mpd_workmate_init").execute({ base: "Deep Worker", name: "zed" }, exec)
  /** The library root the T-43 rule pins under $HOME rather than under the process cwd. */
  const root = join(home, ".mpd", "workmate")
  expect(existsSync(root)).toBe(true)
  expect(readdirSync(root)).toContain("zed")
  expect(process.env.HOME).toBe(home)
  expect(PERSONA_CAP).toBeGreaterThan(0)
})

// ── C3: no tool output schema, result or advertising string carries the internal baseId ─────────
test("no workmate tool advertises or returns baseId", async () => {
  sandboxHome()
  /** The fake harness, including every registered descriptor for the disclosure sweep. */
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
  /** The init result whose keys must not disclose the internal base id. */
  const out = await byName("mpd_workmate_init").execute({ base: "Deep Worker", name: "probe" }, exec)
  expect(Object.hasOwn(out, "baseId")).toBe(false)
})
