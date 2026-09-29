import { test, expect } from "bun:test"
import { apply, normalizeRoleKey, readPersona, pkgRoot, READONLY_DENY, rosterFunctionList, rosterNameList } from "../src/index.ts"
import { ROLES } from "../src/roles.data.ts"
import { apply as applyExtensions } from "../../mpd-ext-plugin/src/index.ts"
import { apply as applyWorkmate } from "../../mpd-workmate-plugin/src/index.ts"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

/** Apply the plugin to a recording ctx and return the surfaces the arms assert on. */
function makePlugin(config?: Parameters<typeof apply>[1]): {
  tools: any[]
  spawned: Array<{ label: string; persona?: string; toolFilter?: { deny: string[] }; agentOptions: { model: string } }>
  provided: Record<string, any>
  exec: { agent: { id: string }; signal: AbortSignal }
} {
  /** Tool definitions the plugin registered, in registration order. */
  const tools: any[] = []
  /** Subagent specs the fake subagents.start received, one per spawn. */
  const spawned: any[] = []
  /** The service map ctx.provide filled; mpdRoles is the surface under test. */
  const provided: any = {}
  /** The permissive cordis-shaped ctx apply sees, with no real harness seam behind it. */
  const ctx: any = {
    tools: {
      /** Record one tool definition; the plugin never reads a registration result. */
      register(d: unknown): void { tools.push(d) }
    },
    subagents: {
      start: async (_kind: string, opts: any) => {
        spawned.push(opts)
        return { result: { structured: { role: "oracle", summary: "done", recommendation: "keep it simple", evidence: ["e1"] }, stopReason: "complete" } }
      }
    },
    provide: (n: string, v: any) => { provided[n] = v }
  }
  apply(ctx, config)
  return { tools, spawned, provided, exec: { agent: { id: "agent-1" }, signal: new AbortController().signal } }
}

test("roster: 11 roles, unique ids, non-empty chains and fields", () => {
  expect(ROLES.length).toBe(11)
  expect(new Set(ROLES.map((r) => r.id)).size).toBe(11)
  for (const r of ROLES) {
    expect(r.name.length).toBeGreaterThan(0)
    expect(r.description.length).toBeGreaterThan(0)
    expect(r.chain.length).toBeGreaterThan(0)
    expect(r.chain[0].provider).toBe("deepseek-official")
    expect(r.personaFile).toContain("personas/")
  }
})

test("persona assets exist for every role and contain real instructions", () => {
  for (const r of ROLES) {
    /** Absolute path of this role persona asset under the package root. */
    const p = join(pkgRoot(), "packages", "mpd-roles-plugin", "personas", r.id + ".md")
    expect(existsSync(p), r.id + " persona file").toBe(true)
    /** The persona file raw text, compared with what readPersona extracts. */
    const text = readFileSync(p, "utf8")
    expect(text.length).toBeGreaterThan(200)
    expect(readPersona({}, r)).toBe(text.trim())
  }
})

test("normalizeRoleKey: canonical, chain keys and legacy mpd- ids", () => {
  expect(normalizeRoleKey("oracle")).toBe("oracle")
  expect(normalizeRoleKey("mpd-oracle")).toBe("oracle")
  expect(normalizeRoleKey("sisyphus-junior")).toBe("sisyphus-junior")
  expect(normalizeRoleKey("sisyphusJunior")).toBe("sisyphus-junior")
  expect(normalizeRoleKey("multimodalLooker")).toBe("multimodal-looker")
  expect(normalizeRoleKey("bogus")).toBeNull()
  expect(normalizeRoleKey("")).toBeNull()
})

/**
 * The name-unification contract: the roster's normal display names are the SAME
 * names team mode gives its members, so a non-team caller addresses a role with
 * the team word — in any case or separator spelling — and never has to learn the
 * stable ids to do it. Every name must resolve, to its OWN id.
 */
test("normalizeRoleKey: team-style normal names resolve to the same role as their id", () => {
  for (const r of ROLES) {
    expect(normalizeRoleKey(r.name), r.name).toBe(r.id)
    expect(normalizeRoleKey(r.name.toLowerCase()), r.name).toBe(r.id)
    expect(normalizeRoleKey(r.name.toUpperCase()), r.name).toBe(r.id)
    expect(normalizeRoleKey(r.name.replaceAll(" ", "-")), r.name).toBe(r.id)
    expect(normalizeRoleKey(r.name.replaceAll(" ", "_")), r.name).toBe(r.id)
    expect(normalizeRoleKey(r.name.replaceAll(" ", "")), r.name).toBe(r.id)
  }
  expect(normalizeRoleKey("Deep Worker")).toBe("hephaestus")
  expect(normalizeRoleKey("  plan reviewer  ")).toBe("momus")
  expect(normalizeRoleKey("Vision Analyst")).toBe("multimodal-looker")
})

test("a one-shot spawn is labelled with the team-style normal name, not the id", async () => {
  /** A fresh apply recorded surfaces: registrations, spawn specs and one exec. */
  const { tools, spawned, exec } = makePlugin()
  /** The mpd_role_spawn definition, located by name rather than by index. */
  const spawn = tools.find((t) => t.name === "mpd_role_spawn")
  /** The spawn result when the role is addressed by its normal display name. */
  const byName = await spawn.execute({ role: "Deep Worker", task: "implement Y" }, exec)
  expect(spawned[0].label).toBe("Deep Worker")
  expect(byName.role).toBe("Deep Worker")
  /** The spawn result when the same role is addressed by its stable id. */
  const byId = await spawn.execute({ role: "momus", task: "review the plan" }, exec)
  expect(spawned[1].label).toBe("Plan Reviewer")
  expect(byId.role).toBe("Plan Reviewer")
})

/**
 * The alias guard. The roster's stable ids are inherited upstream keys: they stay
 * ACCEPTED (chain lookup, persona asset names, legacy callers), but no surface may
 * ADVERTISE one — every description, parameter and rendered line addresses a role by
 * its name and says what it does. Word-boundary matching keeps the honest English
 * words that merely contain an id as a substring (the "Explorer" role contains
 * "explore") from failing this guard.
 */
test("no surface advertises an upstream alias: names plus what a role does", async () => {
  /** A second fresh apply, shared by the alias and payload arms. */
  const { tools, spawned, exec } = makePlugin()
  /** The spawn tool whose description and render are part of the advertised surface. */
  const spawn = tools.find((t) => t.name === "mpd_role_spawn")
  /** The persona tool, whose render and schema join the same advertised surface. */
  const persona = tools.find((t) => t.name === "mpd_role_persona")
  /** The list tool, whose render and schema join the same advertised surface. */
  const list = tools.find((t) => t.name === "mpd_roles_list")
  /** A resolved list result, rendered and searched for id-shaped text. */
  const listRes = await list.execute({}, {})
  /** A resolved spawn result for the Plan Reviewer role. */
  const spawnRes = await spawn.execute({ role: "Plan Reviewer", task: "review the plan" }, exec)
  /** A resolved persona result; its persona text is masked before the scan. */
  const personaRes = await persona.execute({ role: "Architect" }, {})
  /** Every model-facing string a caller can read, scanned for an advertised alias. */
  const surfaces = [
    list.description, JSON.stringify(list.parameters), list.output.render({}, listRes)[0].text,
    spawn.description, JSON.stringify(spawn.parameters), spawn.output.render({}, spawnRes)[0].text,
    persona.description, JSON.stringify(persona.parameters), persona.output.render({}, personaRes)[0].text,
    JSON.stringify(personaRes).replace(/"persona":"[^"]*"/, '"persona":"…"'), // the persona TEXT is the role's own instructions
    rosterFunctionList(), rosterNameList(),
  ]
  for (const surface of surfaces) {
    for (const role of ROLES) {
      /** Word-boundary matcher for one role id, so honest English words are not flagged. */
      const alias = new RegExp("\\b" + role.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i")
      expect(alias.test(surface), surface.slice(0, 80) + " … advertises the alias " + role.id).toBe(false)
    }
  }
  // …while every NAME and its function text IS present where it matters.
  for (const role of ROLES) {
    expect(listRes.roles.map((r: any) => r.name)).toContain(role.name)
    expect(list.output.render({}, listRes)[0].text).toContain(role.name)
  }
  expect(spawned[0].label).toBe("Plan Reviewer")
})

test("the roster tool payloads carry no id field (an alias is not part of a result)", async () => {
  /** A third fresh apply, used for the payload-key arm. */
  const { tools, exec } = makePlugin()
  /** The roster list definition whose payload keys must not carry an id. */
  const list = tools.find((t) => t.name === "mpd_roles_list")
  /** The spawn definition whose payload keys must not carry an id. */
  const spawn = tools.find((t) => t.name === "mpd_role_spawn")
  /** The persona definition whose payload keys must not carry an id. */
  const persona = tools.find((t) => t.name === "mpd_role_persona")
  /** A resolved list payload; only its roles entries are key-checked. */
  const listRes = await list.execute({}, {})
  /** A resolved spawn payload, checked for an id key. */
  const spawnRes = await spawn.execute({ role: "momus", task: "review" }, exec)
  /** A resolved persona payload, checked for an id key. */
  const personaRes = await persona.execute({ role: "momus" }, {})
  expect(Object.keys(listRes.roles[0])).not.toContain("id")
  expect(Object.keys(spawnRes)).not.toContain("id")
  expect(Object.keys(personaRes)).not.toContain("id")
  for (const t of [list, spawn, persona]) {
    expect(JSON.stringify(t.output.schema)).not.toContain('"id"')
  }
})

test("mpdRoles service: list 11, get resolves aliases, unknown is null", () => {
  /** The services a fresh apply provided, keyed by service name. */
  const { provided } = makePlugin()
  /** The mpdRoles service the mpd-modelchain consumer reads. */
  const svc = provided.mpdRoles
  expect(svc).toBeTruthy()
  expect(svc.list().length).toBe(11)
  /** The role resolved from a legacy mpd- prefixed id. */
  const o = svc.get("mpd-prometheus")
  expect(o.id).toBe("prometheus")
  expect(o.readonly).toBe(true)
  expect(svc.get("Architect").id).toBe("oracle")
  expect(svc.get("missing")).toBeNull()
})

test("mpd_role_persona returns the extracted persona text under the role's NAME", async () => {
  /** A fresh apply registrations, searched for the persona tool. */
  const { tools } = makePlugin()
  /** The mpd_role_persona definition under test. */
  const tool = tools.find((t) => t.name === "mpd_role_persona")
  /** The persona result: the extracted text plus the character count it reports. */
  const res = await tool.execute({ role: "oracle" }, {})
  expect(res.role).toBe("Architect")
  expect(res.persona).toContain("read-only")
  expect(res.persona).toContain("the Architect")
  expect(res.chars).toBe(res.persona.length)
})

test("mpd_role_spawn: read-only roles get write-deny toolFilter, workers none", async () => {
  /** A fresh apply whose read-only and worker spawns are compared. */
  const { tools, spawned, exec } = makePlugin()
  /** The spawn tool the read-only discipline is asserted through. */
  const spawn = tools.find((t) => t.name === "mpd_role_spawn")
  /** The read-only role spawn result, which reports the subagent own status. */
  const ro = await spawn.execute({ role: "oracle", task: "review X" }, exec)
  expect(spawned[0].toolFilter).toEqual({ deny: READONLY_DENY })
  expect(spawned[0].persona).toContain("read-only")
  expect(spawned[0].agentOptions.model).toBe("deepseek-v4-flash")
  expect(ro.status).toBe("complete")
  expect(ro.summary).toBe("done")

  /** A second, independent apply used for the write-capable role. */
  const workerCtx = makePlugin()
  /** The spawn tool from that second apply. */
  const worker = workerCtx.tools.find((t) => t.name === "mpd_role_spawn")
  await worker.execute({ role: "hephaestus", task: "implement Y", model: "deepseek-v4-flash" }, workerCtx.exec)
  expect(workerCtx.spawned[0].toolFilter).toBeUndefined()
  expect(workerCtx.spawned[0].agentOptions.model).toBe("deepseek-v4-flash")
})

test("mpd_roles_list returns the full roster summary", async () => {
  /** A fresh apply registrations, searched for the list tool. */
  const { tools } = makePlugin()
  /** The mpd_roles_list definition under test. */
  const list = tools.find((t) => t.name === "mpd_roles_list")
  /** The list payload: the count plus one summary row per role. */
  const res = await list.execute({}, {})
  expect(res.count).toBe(11)
  expect(res.roles.every((r: any) => r.name && r.model && r.description)).toBe(true)
  /** The Architect summary row, the read-only reference entry. */
  const oracle = res.roles.find((r: any) => r.name === "Architect")
  expect(oracle.readonly).toBe(true)
  expect(oracle.model).toBe("deepseek-v4-flash")
  expect(oracle.description.length).toBeGreaterThan(10)
})

test("read-only deny list covers every write-capable tool (no shell/AST/LSP write bypass)", async () => {
  /** The write-capable tool names the deny list must cover, bash included. */
  const writeTools = ["write", "edit", "mpd_hashline_edit", "bash", "mcp__ast_grep__rewrite", "mcp__ast_grep__scan", "mcp__lsp__rename"]
  for (const t of writeTools) expect(READONLY_DENY).toContain(t)
  /** A fresh apply whose recorded toolFilter is compared with the constant. */
  const { tools, spawned, exec } = makePlugin()
  /** The spawn tool whose recorded filter is the one-shot enforcement surface. */
  const spawn = tools.find((t) => t.name === "mpd_role_spawn")
  await spawn.execute({ role: "oracle", task: "review X" }, exec)
  /** The deny list as the fake subagents.start recorded it; the read-only spawn above always carries a filter, so the assertion only removes the optionality. */
  const deny = spawned[0].toolFilter!.deny as string[]
  for (const t of writeTools) expect(deny).toContain(t)
})

/**
 * The harness validates the WHOLE deny list at spawn time and rejects the child when a single name is
 * unknown, so one dead entry breaks every read-only spawn. These two names are exactly that defect and
 * must never come back. They are assembled from fragments so this guard does not itself re-introduce
 * the literals it forbids.
 */
const DEAD_TOOL_NAMES = ["str_replace" + "_editor", "apply" + "_patch"]

test("read-only deny list carries no dead tool name (the defect that broke every read-only spawn)", () => {
  for (const dead of DEAD_TOOL_NAMES) expect(READONLY_DENY).not.toContain(dead)
})

test("the same dead names must not reappear in the roles source or its built dist", () => {
  for (const rel of ["../src/index.ts", "../dist/index.js"]) {
    /** The package source text, grepped for the forbidden dead tool names. */
    const src = readFileSync(join(import.meta.dir, rel), "utf8")
    for (const dead of DEAD_TOOL_NAMES) expect(src).not.toContain(dead)
  }
})

/**
 * Alias guard on the SHIPPED artifact: the source can look clean while the built dist
 * still renders `Name (alias)`. The ids legitimately appear in the dist as chain keys
 * and persona paths, so only the DISPLAY SHAPE is forbidden — an id inside a
 * parenthetical, which is exactly how the upstream alias used to be shown.
 */
test("the built dist renders no role as `Name (upstream-alias)`", () => {
  /** The built bundle text, grepped for an alias-shaped render. */
  const dist = readFileSync(join(import.meta.dir, "../dist/index.js"), "utf8")
  for (const role of ROLES) {
    /** Parenthesised-alias matcher for one role id, the retired display shape. */
    const aliasShape = new RegExp("\\(\\s*" + role.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*\\)", "i")
    expect(aliasShape.test(dist), role.name + " is still rendered with its alias in dist").toBe(false)
  }
})

/**
 * Parity guard (captain decision A2): the workmate plugin denies the same tools on its own read-only
 * spawns, so the two arrays must stay identical — the drift between them is the class that let this
 * defect hide. A missing export FAILS this test rather than skipping it: a guard that silently
 * disengages reports green with zero assertions, which is exactly how this defect class hid once
 * already. The failures below are therefore deliberate — fix the export, never the guard.
 */
test("roles and workmate read-only deny lists are exactly equal (drift guard)", async () => {
  // A missing named export surfaces as `undefined` (bun does not throw for ESM named imports), so the
  // landing check is a shape check, never an exception check. It FAILS rather than returning: a drift
  // guard that disengages silently is the one shape it must never have (t6 review finding).
  const mod: any = await import("../../mpd-workmate-plugin/src/index.ts").catch(() => null)
  /** The workmate plugin own deny list, compared for drift. */
  const workmateDeny = mod?.READONLY_DENY
  if (!Array.isArray(workmateDeny)) {
    console.warn("[roles.test] mpd-workmate-plugin must export an array READONLY_DENY for this drift guard to compare; an unexported or non-array value means the guard would compare nothing")
  }
  expect(Array.isArray(workmateDeny)).toBe(true)
  expect(workmateDeny).toEqual([...READONLY_DENY])
  for (const dead of DEAD_TOOL_NAMES) expect(workmateDeny).not.toContain(dead)
})
// ── extension-contributed roles (t4) ─────────────────────────────────────────
// These tests drive the REAL mpd-ext registry: an extension is registered through
// `mpd-ext`'s own service and the roster must pick its roles up PER CALL through the same
// lazy `ctx.get("mpdExtensions")` seam the mounted tree uses. A hand-made service stub
// would prove only the stub, so only the broken/absent cases use one.

/** The extension persona asset the fixture writes, and the text asserted later. */
const EXT_PERSONA = "# Code Reviewer\nYou review a change read-only. Never edit any file."

/** A stub ctx serving the cordis service map lazily — exactly the seam both plugins use. */
function serviceCtx(): {
  ctx: Parameters<typeof apply>[0]
  services: Record<string, any>
  tools: any[]
  spawned: Array<{ label: string; persona?: string; toolFilter?: { deny: string[] } }>
  provided: Record<string, any>
  warnings: string[]
  exec: { agent: { id: string }; signal: AbortSignal }
} {
  /** The lazily resolved cordis service map ctx.get reads. */
  const services: Record<string, any> = {}
  /** Tool definitions the extension and roster plugins registered. */
  const tools: any[] = []
  /** Subagent specs recorded by the fake subagents.start. */
  const spawned: any[] = []
  /** The service map ctx.provide filled, shared with the get seam. */
  const provided: Record<string, any> = {}
  /** Lines the fake logger received, asserted for the loud refusals. */
  const warnings: string[] = []
  /** The permissive ctx both the ext plugin and the roster apply to. */
  const ctx: any = {
    logger: { warn: (line: unknown) => { warnings.push(String(line)) } },
    tools: {
      /** Record one tool definition and hand it straight back to the caller. */
      register(definition: unknown): unknown { tools.push(definition); return definition }
    },
    skills: {
      /** Accept the skills provider registration the plugin makes; unused here. */
      registerProvider(): void { /* the skills plane is not under test here */ }
    },
    subagents: {
      start: async (_kind: string, options: any) => {
        spawned.push(options)
        return { result: { structured: { role: "x", summary: "done" }, stopReason: "complete" } }
      }
    },
    provide: (n: string, v: any) => { provided[n] = v; services[n] = v },
    get: (n: string) => services[n],
  }
  return { ctx, services, tools, spawned, provided, warnings, exec: { agent: { id: "agent-1" }, signal: new AbortController().signal } }
}

/** One extension root carrying the persona asset, plus a descriptor that references it. */
function extensionFixture(id: string = "authoring-flows", roleName: string = "Code Reviewer"): {
  root: string
  descriptor: Record<string, unknown>
} {
  /** The temp extension root that owns the persona asset. */
  const root = mkdtempSync(join(tmpdir(), "mpd-roles-ext-"))
  mkdirSync(join(root, "personas"), { recursive: true })
  writeFileSync(join(root, "personas", "code-reviewer.md"), EXT_PERSONA)
  return {
    root,
    descriptor: {
      apiVersion: 1,
      id,
      description: "authoring flow",
      contributes: {
        roles: [{
          name: roleName,
          description: "Reviews a change without editing it",
          readonly: true,
          persona: "personas/code-reviewer.md",
          provider: "deepseek-official",
          model: "deepseek-v4-flash",
        }],
      },
    },
  }
}

/** HOME sandboxed per test: the user extension plane and the workmate library both hang off it. */
function sandboxHome(): { home: string; restore: () => void } {
  /** The sandbox directory installed as HOME for the test duration. */
  const home = mkdtempSync(join(tmpdir(), "mpd-roles-home-"))
  /** The HOME value to restore, or undefined when the variable was unset. */
  const previous = process.env.HOME
  process.env.HOME = home
  return {
    home,
    restore: () => {
      if (previous === undefined) delete process.env.HOME
      else process.env.HOME = previous
      rmSync(home, { recursive: true, force: true })
    },
  }
}

/** Locate a registered definition by name, failing loudly when it is absent. */
function toolNamed(tools: any[], name: string): any {
  /** The located definition; absent names throw rather than assert on undefined. */
  const t = tools.find((candidate) => candidate.name === name)
  if (!t) throw new Error("no tool named " + name)
  return t
}

test("extension roles: a real mpd-ext registration joins the roster with its owning extension", async () => {
  /** The HOME sandbox that keeps the extension plane off the real home. */
  const sandbox = sandboxHome()
  try {
    /** The ext + roster stack sharing one recording ctx. */
    const stack = serviceCtx()
    applyExtensions(stack.ctx, {})
    apply(stack.ctx, {})
    /** The roster list tool from that stack. */
    const list = toolNamed(stack.tools, "mpd_roles_list")
    // Baseline instead of a hard 12: the ext plugin also discovers <bundle>/extensions (the
    // shipped reference extension is disabled there, but no assertion may depend on that).
    const baseline = (await list.execute({}, stack.exec)).count
    expect(baseline).toBeGreaterThanOrEqual(ROLES.length)
    /** The fixture extension and the descriptor document that references it. */
    const { root, descriptor } = extensionFixture()
    expect(stack.services.mpdExtensions.register(descriptor, { root }).ok).toBe(true)

    /** The list payload after the extension role joined the roster. */
    const listed = await list.execute({}, stack.exec)
    expect(listed.count).toBe(baseline + 1)
    /** The extension-contributed role summary row. */
    const contributed = listed.roles.find((r: any) => r.name === "Code Reviewer")
    expect(contributed.extension).toBe("authoring-flows")
    expect(contributed.readonly).toBe(true)
    expect(contributed.model).toBe("deepseek-v4-flash")
    expect(listed.refused).toEqual([])
    // The render names the owning extension and leaves the base lines untouched.
    const rendered = list.output.render({}, listed)[0].text
    expect(rendered).toContain("Code Reviewer")
    expect(rendered).toContain("extension:authoring-flows")
    expect(rendered).toContain("- Architect [deepseek-v4-flash readonly] — ")

    // Spawn: addressed by the declared name in ANY spelling, labelled with that name, and
    // carrying the declared read-only discipline.
    const spawn = toolNamed(stack.tools, "mpd_role_spawn")
    /** The extension role spawn result, addressed by its declared name. */
    const spawned = await spawn.execute({ role: "code reviewer", task: "review the change" }, stack.exec)
    expect(spawned.role).toBe("Code Reviewer")
    expect(stack.spawned[0].label).toBe("Code Reviewer")
    expect(stack.spawned[0].toolFilter).toEqual({ deny: READONLY_DENY })
    expect(String(stack.spawned[0].persona)).toContain("Never edit any file")

    /** The persona tool from the same stack. */
    const persona = toolNamed(stack.tools, "mpd_role_persona")
    /** The extension persona result. */
    const personaRes = await persona.execute({ role: "Code Reviewer" }, stack.exec)
    expect(personaRes.role).toBe("Code Reviewer")
    expect(personaRes.persona).toContain("Code Reviewer")
    expect(personaRes.chars).toBe(personaRes.persona.length)

    // The mpdRoles service is the surface mpd_workmate_init and mpd_modelchain_resolve read.
    const service = stack.provided.mpdRoles
    expect(service.list().length).toBe(baseline + 1)
    /** The service-level resolution of the extension role by its declared name. */
    const byName = service.get("Code Reviewer")
    expect(byName.id).toBe("ext-authoring-flows-code-reviewer")
    expect(byName.readonly).toBe(true)
    expect(byName.persona).toContain("Code Reviewer")
    expect(byName.chain).toEqual([{ provider: "deepseek-official", model: "deepseek-v4-flash" }])
    // …and the namespaced id resolves through the same service.
    expect(service.get("ext-authoring-flows-code-reviewer").name).toBe("Code Reviewer")
    expect(service.get("Deep Worker").id).toBe("hephaestus")
  } finally {
    sandbox.restore()
  }
})

test("extension roles: resolved PER CALL — later registration and disabled extensions take effect next call", async () => {
  /** The HOME sandbox for the per-call resolution arm. */
  const sandbox = sandboxHome()
  try {
    /** The ext + roster stack used to prove resolution happens per call. */
    const stack = serviceCtx()
    applyExtensions(stack.ctx, {})
    apply(stack.ctx, {})
    /** The roster list tool, called once before and once after the registration. */
    const list = toolNamed(stack.tools, "mpd_roles_list")
    // mpd-roles applied BEFORE any extension existed: an apply-time merge would have frozen
    // this count, so the SAME baseline must grow by exactly one on the next call.
    const baseline = (await list.execute({}, stack.exec)).count

    /** The extension registered after the first list call. */
    const { root, descriptor } = extensionFixture()
    expect(stack.services.mpdExtensions.register(descriptor, { root }).ok).toBe(true)
    expect((await list.execute({}, stack.exec)).count).toBe(baseline + 1)

    // A disabled extension contributes nothing anywhere else, so it contributes no role.
    const ghost = extensionFixture("disabled-ext", "Ghost Reviewer").descriptor
    expect(stack.services.mpdExtensions.register({ ...ghost, enabled: false }, { root }).ok).toBe(true)
    /** The list payload after a DISABLED extension was registered. */
    const afterDisabled = await list.execute({}, stack.exec)
    expect(afterDisabled.count).toBe(baseline + 1)
    expect(afterDisabled.roles.map((r: any) => r.name)).not.toContain("Ghost Reviewer")
  } finally {
    sandbox.restore()
  }
})

test("extension roles: a name colliding with a base role or another extension is refused loudly, never fatally", async () => {
  /** The HOME sandbox for the collision arm. */
  const sandbox = sandboxHome()
  try {
    /** The ext + roster stack used for the three colliding descriptors. */
    const stack = serviceCtx()
    applyExtensions(stack.ctx, {})
    apply(stack.ctx, {})
    /** An extension naming an existing base role, which must be refused. */
    const first = extensionFixture("ext-a", "Architect") // collides with the base roster
    /** An extension with a free name, which must join the roster. */
    const second = extensionFixture("ext-b", "Code Reviewer")
    /** A second extension claiming the same name in another spelling, refused as a clash. */
    const third = extensionFixture("ext-c", "code reviewer") // collides with ext-b
    /** The roster list tool, called before any registration to establish the baseline. */
    const list = toolNamed(stack.tools, "mpd_roles_list")
    /** The pre-registration count the single accepted role must raise by one. */
    const baseline = (await list.execute({}, stack.exec)).count
    expect(stack.services.mpdExtensions.register(first.descriptor, { root: first.root }).ok).toBe(true)
    expect(stack.services.mpdExtensions.register(second.descriptor, { root: second.root }).ok).toBe(true)
    expect(stack.services.mpdExtensions.register(third.descriptor, { root: third.root }).ok).toBe(true)

    /** The list payload after the three registrations. */
    const listed = await list.execute({}, stack.exec) // must not throw: the roster keeps answering
    // Only ext-b's role joins the roster: ext-a (base-name clash) and ext-c (cross-extension clash)
    // are refused, so the count grows by exactly one.
    expect(listed.count).toBe(baseline + 1)
    expect(listed.roles.find((r: any) => r.name === "Architect").extension).toBe(null)
    /** The refused names, sorted: the base clash and the cross-extension clash. */
    const refusedNames = listed.refused.map((r: any) => r.name).sort()
    expect(refusedNames).toEqual(["Architect", "code reviewer"])
    /** The refusal attributed to the second extension, whose reason names the first. */
    const crossExtension = listed.refused.find((r: any) => r.extension === "ext-c")
    expect(crossExtension.reason).toContain('extension "ext-b"')
    for (const refused of listed.refused) {
      expect(Object.keys(refused).sort()).toEqual(["extension", "name", "reason"])
    }
    /** The rendered list text, asserted for both the count and the base-clash reason. */
    const rendered = list.output.render({}, listed)[0].text
    expect(rendered).toContain("refused (2):")
    expect(rendered).toContain("is already taken by the base roster")
    // "Loudly" = reported to the log as well as in the tool result (once per reason).
    expect(stack.warnings.some((line) => line.includes("extension role refused") && line.includes("Architect"))).toBe(true)

    // The extension registry itself stays intact: a refused role is a roster decision only.
    // Asserted by ID, never by count: the bundle plane also discovers whatever ships under
    // <bundle>/extensions (e.g. the reference extension), so a raw length is not stable.
    const registryIds = stack.services.mpdExtensions.list().extensions.map((e: any) => e.id)
    expect(registryIds).toEqual(expect.arrayContaining(["ext-a", "ext-b", "ext-c"]))
    // …and the other extension roles still spawn.
    const spawn = toolNamed(stack.tools, "mpd_role_spawn")
    expect((await spawn.execute({ role: "Code Reviewer", task: "review" }, stack.exec)).role).toBe("Code Reviewer")
    /** The spawn result for the BASE Architect, proving the base role still spawns. */
    const unknown = await spawn.execute({ role: "Architect", task: "review" }, stack.exec)
    expect(unknown.role).toBe("Architect") // the BASE Architect still spawns
    expect(stack.spawned[1].label).toBe("Architect")
  } finally {
    sandbox.restore()
  }
})

test("extension roles: usable as a workmate BASE template (real mpd_workmate_init)", async () => {
  /** The HOME sandbox for the workmate-base arm. */
  const sandbox = sandboxHome()
  try {
    /** The ext + roster + workmate stack sharing one ctx. */
    const stack = serviceCtx()
    applyExtensions(stack.ctx, {})
    apply(stack.ctx, {})
    applyWorkmate(stack.ctx)
    /** The extension registered before the workmate is initialised. */
    const { root, descriptor } = extensionFixture()
    expect(stack.services.mpdExtensions.register(descriptor, { root }).ok).toBe(true)

    /** The mpd_workmate_init definition under test. */
    const init = toolNamed(stack.tools, "mpd_workmate_init")
    /** The init result: the extension role used as a workmate BASE template. */
    const created = await init.execute({ base: "Code Reviewer", name: "code-reviewer-1", note: "extension base" }, stack.exec)
    expect(created.baseName).toBe("Code Reviewer")
    // C3 (workmate alias removal): the roster id is internal provenance exposed by NO tool
    // output — only the stored record below may carry it.
    expect(created.baseId).toBeUndefined()
    expect(created.readonly).toBe(true)
    /** The workmate record directory the library wrote under the sandbox HOME. */
    const dir = join(sandbox.home, ".mpd", "workmate", "code-reviewer-1")
    expect(readFileSync(join(dir, "persona.md"), "utf8")).toContain("Code Reviewer")
    expect(JSON.parse(readFileSync(join(dir, "meta.json"), "utf8")).baseId).toBe("ext-authoring-flows-code-reviewer")
  } finally {
    sandbox.restore()
  }
})

test("extension roles: an absent or broken mpdExtensions service leaves the base roster answering", async () => {
  /** The HOME sandbox for the degraded-service arm. */
  const sandbox = sandboxHome()
  try {
    // (a) no ctx.get at all — the standalone/unit shape.
    const bare = makePlugin()
    /** The list tool of a plugin applied with NO ctx.get at all. */
    const bareList = toolNamed(bare.tools, "mpd_roles_list")
    /** The base-only payload, with an empty refusal list. */
    const bareRes = await bareList.execute({}, {})
    expect(bareRes.count).toBe(11)
    expect(bareRes.refused).toEqual([])

    // (b) a registered service whose list() throws must degrade to base-only, never throw.
    const stack = serviceCtx()
    apply(stack.ctx, {})
    stack.services.mpdExtensions = {
      /** A registry whose list() throws, for the base-only degradation arm. */
      list(): never { throw new Error("registry exploded") }
    }
    /** The roster list tool used to assert the base roster after the throwing registry. */
    const list = toolNamed(stack.tools, "mpd_roles_list")
    expect((await list.execute({}, stack.exec)).count).toBe(11)
    expect(stack.warnings.some((line) => line.includes("mpdExtensions.list() failed"))).toBe(true)

    // (c) an agent-scoped cordis ctx THROWS on ctx.get for a key outside `inject`.
    const throwing = serviceCtx()
    throwing.ctx.get = (key: string) => {
      if (key === "mpdExtensions") throw new Error('cannot get property "mpdExtensions" without inject')
      return throwing.services[key]
    }
    apply(throwing.ctx, {})
    /** The list tool of a stack whose ctx.get throws for the extension key. */
    const throwingList = toolNamed(throwing.tools, "mpd_roles_list")
    expect((await throwingList.execute({}, throwing.exec)).count).toBe(11)
    /** The spawn tool of that throwing-inject stack. */
    const spawn = toolNamed(throwing.tools, "mpd_role_spawn")
    expect((await spawn.execute({ role: "Deep Worker", task: "x" }, throwing.exec)).role).toBe("Deep Worker")
    expect(throwing.warnings.some((line) => line.includes('ctx.get("mpdExtensions") failed'))).toBe(true)
  } finally {
    sandbox.restore()
  }
})

test("extension roles do NOT enter the agent-teams `mpd` profile member list (documented limit)", async () => {
  /** The HOME sandbox for the documented-limit arm. */
  const sandbox = sandboxHome()
  try {
    /** The ext + roster stack used to list the extension role by name. */
    const stack = serviceCtx()
    applyExtensions(stack.ctx, {})
    apply(stack.ctx, {})
    /** The extension whose role must NOT reach the static profile list. */
    const { root, descriptor } = extensionFixture()
    stack.services.mpdExtensions.register(descriptor, { root })
    /** The list payload that does carry the extension role, proving the contrast. */
    const listed = await toolNamed(stack.tools, "mpd_roles_list").execute({}, stack.exec)
    expect(listed.roles.map((r: any) => r.name)).toContain("Code Reviewer")
    // The adopted agent-teams `mpd` roster profile is static patch configuration: this plugin
    // publishes no member template, so an extension role is spawnable/workmate-able but can
    // never be staged as a teammate. Pinned against the bundle patch itself.
    const patch = readFileSync(join(pkgRoot(), "cordis.patch.yml"), "utf8")
    expect(patch).not.toContain("Code Reviewer")
  } finally {
    sandbox.restore()
  }
})

/**
 * The bundle loads `dist/index.js`, so a src-only edit ships DEAD (the measured stale-dist
 * class). These markers are the extension-role wiring: a rebuild that is forgotten fails here.
 */
test("the built dist carries the extension-role wiring (a src-only change would ship dead)", () => {
  for (const rel of ["../src/index.ts", "../dist/index.js"]) {
    /** Each file text, grepped for the extension-service wiring. */
    const source = readFileSync(join(import.meta.dir, rel), "utf8")
    expect(source, rel + " does not resolve the extension service").toContain("mpdExtensions")
    expect(source, rel + " does not report a refused extension role").toContain("is already taken by")
  }
})

/**
 * t16 regression: the roster must not expose a PROJECT-plane extension's role.
 *
 * The frozen contract rejects a project manifest's `roles` item (tool and provider
 * registration is process-global and cannot be scoped to a session), so the extension side
 * loads nothing for it — while this resolver used to check enabled/roles/persona and never
 * the plane, and therefore exposed it. The two surfaces must agree: nothing usable, with the
 * contract's own reason recorded, and the base roster untouched.
 */
test("extension roles: a PROJECT-plane extension's role is refused (the contract rejects it)", async () => {
  /** The HOME sandbox for the project-plane arm. */
  const sandbox = sandboxHome()
  try {
    /** The ext + roster stack used for the project-plane refusal. */
    const stack = serviceCtx()
    applyExtensions(stack.ctx, {})
    apply(stack.ctx, {})
    /** The roster list tool, called before the project extension registers. */
    const list = toolNamed(stack.tools, "mpd_roles_list")
    /** The pre-registration count a refused project role must leave unchanged. */
    const baseline = (await list.execute({}, stack.exec)).count

    /** The project-plane descriptor, registered with an explicit plane. */
    const { root, descriptor } = extensionFixture("proj-ext", "Project Reviewer")
    expect(stack.services.mpdExtensions.register(descriptor, { plane: "project", root }).ok).toBe(true)

    // The extension side exposes NOTHING for this plane (its role item is rejected there).
    const view = stack.services.mpdExtensions.list().extensions.find((entry: any) => entry.id === "proj-ext")
    expect(view.plane).toBe("project")
    expect(view.contributions.roles).toBe(0)
    expect(view.roles).toEqual([])

    // …and the roster agrees: the role is not usable and the refusal names the reason.
    const listed = await list.execute({}, stack.exec)
    expect(listed.count).toBe(baseline)
    expect(listed.roles.map((r: any) => r.name)).not.toContain("Project Reviewer")
    /** The refusal recorded for the project extension role. */
    const refusal = listed.refused.find((r: any) => r.extension === "proj-ext")
    expect(refusal.name).toBe("Project Reviewer")
    expect(refusal.reason).toContain("project-level extensions may contribute skills and flows only")
    expect(stack.warnings.some((line) => line.includes("extension role refused") && line.includes("Project Reviewer"))).toBe(true)

    // The refusal is per role and never fatal: a user-plane role still works in the same call.
    const good = extensionFixture("user-ext", "User Reviewer").descriptor
    stack.services.mpdExtensions.register(good, { root })
    /** The list payload after a USER-plane role joined in the same session. */
    const after = await list.execute({}, stack.exec)
    expect(after.roles.map((r: any) => r.name)).toContain("User Reviewer")
  } finally {
    sandbox.restore()
  }
})
