import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, test } from "bun:test"
import { apply as applyMemory } from "../../mpd-memory-plugin/src/index.ts"
import { enterSandboxHome } from "../../mpd-memory-plugin/test/support.ts"
import type { DshToolDef } from "../../mpd-dsh-adapter-plugin/src/index"
import { apply } from "../src/index.ts"

/** One caller's host-owned session identity and execution checkout. */
function caller(id: string, cwd: string): { agent: { session: { id: string; header: { cwd: string } } } } {
  return { agent: { session: { id, header: { cwd } } } }
}

/** Host-shaped service registry; both plugins run their real adapter registration path. */
function context(): { tools: { register(definition: DshToolDef): void }; get(name: string): unknown; provide(name: string, service: unknown): void; tool(name: string): DshToolDef } {
  /** Every registered definition in the test host. */
  const tools = new Map<string, DshToolDef>()
  /** Cordis service slots, populated and read as the two bundles activate. */
  const services = new Map<string, unknown>()
  return {
    tools: {
      /** Capture the definition the plugin submits through the adapter. */
      register(definition: DshToolDef): void { tools.set(definition.name, definition) },
    },
    /** Resolve the fixture or real plugin service dynamically. */
    get(name: string): unknown { return services.get(name) },
    /** Mount one service in the shared context. */
    provide(name: string, service: unknown): void { services.set(name, service) },
    /** Require the alias to be visible through the unchanged public tool name. */
    tool(name: string): DshToolDef {
      /** Successful registration returns the actual handler. */
      const tool = tools.get(name)
      if (tool === undefined) throw new Error("missing registration " + name)
      return tool
    },
  }
}

test("aliases use the same authenticated memory service as the VCS-backed tools", async () => {
  /** Fixtures are disposable and never start a real agent or use the real HOME. */
  const root = mkdtempSync(join(tmpdir(), "mpd-modelchain-memory-"))
  /** Isolate HOME and DSH_HOME for the real local Git-backed note creates. */
  const restoreHome = enterSandboxHome(root)
  /** An authorized member's second checkout. */
  const sibling = join(root, "sibling")
  /** The standalone map, with a configured location to exercise callers using that option. */
  const legacyPath = join(root, "legacy", "notes.json")
  /** Host-shaped service and tool registry. */
  const ctx = context()
  apply(ctx, { memoryFile: "legacy/notes.json" })
  /** The original public write tool. */
  const save = ctx.tool("mpd_memory_save")
  /** The original public read tool. */
  const recall = ctx.tool("mpd_memory_recall")
  try {
    mkdirSync(sibling)
    expect(await save.execute({ key: "goal", value: "old goal" }, caller("solo", root))).toEqual({ ok: true, key: "goal" })
    expect(await recall.execute({ key: "goal" }, caller("solo", root))).toEqual({ key: "goal", value: "old goal", found: true })
    /** Compare legacy bytes after private writes to rule out implicit promotion. */
    const old = readFileSync(legacyPath, "utf8")
    ctx.provide("mpdProjectIdentity", {
      /** Use fixture membership under either authorized checkout. */
      resolveSeat({ checkoutRoot, sessionId }: { checkoutRoot: string; sessionId: string }): object {
        if (sessionId === "solo") return { kind: "unbound" }
        /** Fixture IDs are durable across board ids and reopen. */
        const memberId = sessionId === "writer" || sessionId === "reopened" ? "writer" : sessionId === "peer" ? "peer" : ""
        if (memberId === "") return { kind: "denied" }
        return { kind: "member", projectId: "p", memberId, projectRoot: root, checkoutRoot, teamId: sessionId === "reopened" ? "new-board" : "old-board" }
      },
    })
    await expect(save.execute({ key: "goal", value: "service absent" }, caller("writer", root))).rejects.toThrow("project memory service unavailable")
    await expect(recall.execute({ key: "goal", scope: "legacy" }, caller("helper", root))).rejects.toThrow("project memory service unavailable")
    applyMemory(ctx)
    await expect(recall.execute({ key: "goal", scope: "legacy" }, caller("helper", root))).rejects.toThrow("no authorized project memory seat")
    await expect(save.execute({ key: "goal", value: "blocked write" }, caller("helper", root))).rejects.toThrow("no authorized project memory seat")
    expect(await recall.execute({ key: "goal" }, caller("writer", root))).toEqual({ key: "goal", value: "", found: false })
    expect(await recall.execute({ key: "goal", scope: "legacy" }, caller("writer", root))).toEqual({ key: "goal", value: "old goal", found: true, scope: "legacy" })
    expect(await save.execute({ key: "goal", value: "new private goal" }, caller("writer", root))).toEqual({ ok: true, key: "goal" })
    expect(await recall.execute({ key: "goal" }, caller("reopened", sibling))).toEqual({ key: "goal", value: "new private goal", found: true })
    expect(await recall.execute({ key: "Goal" }, caller("reopened", sibling))).toEqual({ key: "Goal", value: "", found: false })
    expect(await recall.execute({ key: "goal" }, caller("peer", root))).toEqual({ key: "goal", value: "", found: false })
    expect(await recall.execute({ key: "goal" }, caller("solo", root))).toEqual({ key: "goal", value: "old goal", found: true })
    expect(existsSync(join(sibling, ".mpd"))).toBe(false)
    expect(readFileSync(legacyPath, "utf8")).toBe(old)
    /** The markdown APIs independently route through the same mounted identity. */
    const write = ctx.tool("mpd_memory_write")
    /** The private and shared markdown recall entry point. */
    const read = ctx.tool("mpd_memory_read")
    await write.execute({ title: "Private markdown", content: "markdown canary" }, caller("writer", root))
    expect(await read.execute({ query: "markdown canary" }, caller("reopened", sibling))).toMatchObject({ count: 1 })
    expect(await read.execute({ query: "markdown canary" }, caller("peer", root))).toMatchObject({ count: 0 })
    await write.execute({ scope: "shared", key: "interface", title: "Interface", content: "Shared fact", source: "doc@a", appliesTo: "a" }, caller("writer", root))
    expect(await read.execute({ scope: "shared", key: "interface" }, caller("peer", root))).toMatchObject({ count: 1, validity: "current" })
  } finally {
    restoreHome()
    rmSync(root, { recursive: true, force: true })
  }
})

test("legacy keys remain exact and explicit legacy previews are bounded", async () => {
  /** Fresh standalone caller root and an old map with edge-case keys. */
  const root = mkdtempSync(join(tmpdir(), "mpd-modelchain-legacy-"))
  /** Optional memory service absent on a standalone host. */
  const ctx = context()
  try {
    apply(ctx)
    /** Conventional legacy workspace map. */
    const path = join(root, ".mpd", "memory.json")
    mkdirSync(join(root, ".mpd"))
    writeFileSync(path, JSON.stringify({ Huge: "X".repeat(767) + "😃tail" }))
    /** Registered aliases from the standalone service composition. */
    const recall = ctx.tool("mpd_memory_recall")
    expect(await recall.execute({ key: "constructor" }, caller("solo", root))).toEqual({ key: "constructor", value: "", found: false })
    await ctx.tool("mpd_memory_save").execute({ key: "__proto__", value: "literal" }, caller("solo", root))
    expect(await recall.execute({ key: "__proto__" }, caller("solo", root))).toEqual({ key: "__proto__", value: "literal", found: true })
    expect(await recall.execute({ key: "Huge", scope: "legacy" }, caller("solo", root))).toEqual({ key: "Huge", value: "X".repeat(767), found: true, scope: "legacy", truncated: true })
    expect(await recall.execute({ key: "huge" }, caller("solo", root))).toEqual({ key: "huge", value: "", found: false })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
