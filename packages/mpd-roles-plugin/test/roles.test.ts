import { test, expect } from "bun:test"
import { apply, normalizeRoleKey, readPersona, pkgRoot, READONLY_DENY } from "../src/index.ts"
import { ROLES } from "../src/roles.data.ts"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

function makePlugin(config?: any) {
  const tools: any[] = []
  const spawned: any[] = []
  const provided: any = {}
  const ctx: any = {
    tools: { register(d: any) { tools.push(d) } },
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
    const p = join(pkgRoot(), "packages", "mpd-roles-plugin", "personas", r.id + ".md")
    expect(existsSync(p), r.id + " persona file").toBe(true)
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
  const { tools, spawned, exec } = makePlugin()
  const spawn = tools.find((t) => t.name === "mpd_role_spawn")
  const byName = await spawn.execute({ role: "Deep Worker", task: "implement Y" }, exec)
  expect(spawned[0].label).toBe("Deep Worker")
  expect(byName.role).toBe("Deep Worker")
  expect(byName.id).toBe("hephaestus")
  const byId = await spawn.execute({ role: "momus", task: "review the plan" }, exec)
  expect(spawned[1].label).toBe("Plan Reviewer")
  expect(byId.role).toBe("Plan Reviewer")
  expect(byId.id).toBe("momus")
})

test("mpdRoles service: list 11, get resolves aliases, unknown is null", () => {
  const { provided } = makePlugin()
  const svc = provided.mpdRoles
  expect(svc).toBeTruthy()
  expect(svc.list().length).toBe(11)
  const o = svc.get("mpd-prometheus")
  expect(o.id).toBe("prometheus")
  expect(o.readonly).toBe(true)
  expect(svc.get("Architect").id).toBe("oracle")
  expect(svc.get("missing")).toBeNull()
})

test("mpd_role_persona returns the extracted persona text", async () => {
  const { tools } = makePlugin()
  const tool = tools.find((t) => t.name === "mpd_role_persona")
  const res = await tool.execute({ role: "oracle" }, {})
  expect(res.role).toBe("Architect")
  expect(res.id).toBe("oracle")
  expect(res.persona).toContain("read-only")
  expect(res.persona).toContain("the Architect")
  expect(res.chars).toBe(res.persona.length)
})

test("mpd_role_spawn: read-only roles get write-deny toolFilter, workers none", async () => {
  const { tools, spawned, exec } = makePlugin()
  const spawn = tools.find((t) => t.name === "mpd_role_spawn")
  const ro = await spawn.execute({ role: "oracle", task: "review X" }, exec)
  expect(spawned[0].toolFilter).toEqual({ deny: READONLY_DENY })
  expect(spawned[0].persona).toContain("read-only")
  expect(spawned[0].agentOptions.model).toBe("deepseek-v4-flash")
  expect(ro.status).toBe("complete")
  expect(ro.summary).toBe("done")

  const workerCtx = makePlugin()
  const worker = workerCtx.tools.find((t) => t.name === "mpd_role_spawn")
  await worker.execute({ role: "hephaestus", task: "implement Y", model: "deepseek-v4-flash" }, workerCtx.exec)
  expect(workerCtx.spawned[0].toolFilter).toBeUndefined()
  expect(workerCtx.spawned[0].agentOptions.model).toBe("deepseek-v4-flash")
})

test("mpd_roles_list returns the full roster summary", async () => {
  const { tools } = makePlugin()
  const list = tools.find((t) => t.name === "mpd_roles_list")
  const res = await list.execute({}, {})
  expect(res.count).toBe(11)
  expect(res.roles.every((r: any) => r.id && r.model)).toBe(true)
  const oracle = res.roles.find((r: any) => r.id === "oracle")
  expect(oracle.readonly).toBe(true)
  expect(oracle.model).toBe("deepseek-v4-flash")
})

test("read-only deny list covers every write-capable tool (no shell/AST/LSP write bypass)", async () => {
  const writeTools = ["write", "edit", "mpd_hashline_edit", "bash", "mcp__ast_grep__rewrite", "mcp__ast_grep__scan", "mcp__lsp__rename"]
  for (const t of writeTools) expect(READONLY_DENY).toContain(t)
  const { tools, spawned, exec } = makePlugin()
  const spawn = tools.find((t) => t.name === "mpd_role_spawn")
  await spawn.execute({ role: "oracle", task: "review X" }, exec)
  const deny = spawned[0].toolFilter.deny as string[]
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
    const src = readFileSync(join(import.meta.dir, rel), "utf8")
    for (const dead of DEAD_TOOL_NAMES) expect(src).not.toContain(dead)
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
  const workmateDeny = mod?.READONLY_DENY
  if (!Array.isArray(workmateDeny)) {
    console.warn("[roles.test] mpd-workmate-plugin must export an array READONLY_DENY for this drift guard to compare; an unexported or non-array value means the guard would compare nothing")
  }
  expect(Array.isArray(workmateDeny)).toBe(true)
  expect(workmateDeny).toEqual([...READONLY_DENY])
  for (const dead of DEAD_TOOL_NAMES) expect(workmateDeny).not.toContain(dead)
})