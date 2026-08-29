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

test("mpdRoles service: list 11, get resolves aliases, unknown is null", () => {
  const { provided } = makePlugin()
  const svc = provided.mpdRoles
  expect(svc).toBeTruthy()
  expect(svc.list().length).toBe(11)
  const o = svc.get("mpd-prometheus")
  expect(o.id).toBe("prometheus")
  expect(o.readonly).toBe(true)
  expect(svc.get("missing")).toBeNull()
})

test("mpd_role_persona returns the extracted persona text", async () => {
  const { tools } = makePlugin()
  const tool = tools.find((t) => t.name === "mpd_role_persona")
  const res = await tool.execute({ role: "oracle" }, {})
  expect(res.role).toBe("oracle")
  expect(res.persona).toContain("read-only")
  expect(res.chars).toBe(res.persona.length)
})

test("mpd_role_spawn: read-only roles get write-deny toolFilter, workers none", async () => {
  const { tools, spawned, exec } = makePlugin()
  const spawn = tools.find((t) => t.name === "mpd_role_spawn")
  const ro = await spawn.execute({ role: "oracle", task: "review X" }, exec)
  expect(spawned[0].toolFilter).toEqual({ deny: READONLY_DENY })
  expect(spawned[0].persona).toContain("read-only")
  expect(spawned[0].agentOptions.model).toBe("deepseek-v4-pro")
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
  expect(oracle.model).toBe("deepseek-v4-pro")
})

test("read-only deny list covers every write-capable tool (no shell/AST/LSP write bypass)", async () => {
  const writeTools = ["write", "edit", "str_replace_editor", "apply_patch", "mpd_hashline_edit", "bash", "mcp__ast_grep__rewrite", "mcp__ast_grep__scan", "mcp__lsp__rename"]
  for (const t of writeTools) expect(READONLY_DENY).toContain(t)
  const { tools, spawned, exec } = makePlugin()
  const spawn = tools.find((t) => t.name === "mpd_role_spawn")
  await spawn.execute({ role: "oracle", task: "review X" }, exec)
  const deny = spawned[0].toolFilter.deny as string[]
  for (const t of writeTools) expect(deny).toContain(t)
})