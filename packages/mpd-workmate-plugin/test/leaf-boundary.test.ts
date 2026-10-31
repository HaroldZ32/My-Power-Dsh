// THE LEAF BOUNDARY, WORKMATE HALF (CR repair E): a workmate consult is a leaf, too.
//
// WHY THIS FILE EXISTS SEPARATELY. `mpd_workmate_spawn` is the SECOND bundle spawn tool, and the gap CodeRabbit
// found was symmetric: a workmate child could call either spawn tool again and nest past the consultation
// boundary the depth cap draws, and a READ-ONLY workmate could have handed its task to a write-capable role.
// This row therefore applies the same two controls as the roster row — the spawn-tool deny in every child's own
// scope, and the depth floor in the tool — and this file pins both, plus the parity of the two rows' copies.
import { expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { READONLY_DENY, LEAF_SPAWN_DENY, apply, consultDepthRefusal } from "../src/index.ts"
import {
  LEAF_SPAWN_DENY as ROLE_LEAF_SPAWN_DENY,
  consultDepthRefusal as roleConsultDepthRefusal,
} from "../../mpd-roles-plugin/src/index.ts"
import { createDshAdapter } from "../../mpd-dsh-adapter-plugin/src/index.ts"

/** The Deep Worker BASE template: write-capable, so its workmate children take the LEAF deny alone. */
const DEEP_WORKER = {
  id: "hephaestus",
  name: "Deep Worker",
  description: "autonomous goal-driven implementation",
  readonly: false,
  chain: [{ provider: "deepseek-official", model: "deepseek-v4-flash" }],
  persona: "You are the Deep Worker.",
}

/** The Researcher BASE template: read-only, so its workmate children take the write deny AND the leaf deny. */
const RESEARCHER = {
  id: "librarian",
  name: "Researcher",
  description: "evidence search",
  readonly: true,
  chain: [{ provider: "deepseek-official", model: "deepseek-v4-flash" }],
  persona: "You are the Researcher.",
}

/** One tool restriction this mount asked the adapter to apply, in call order. */
interface Restriction {
  /** The child whose own scope was restricted. */
  agent: unknown
  /** The deny names, in the order the row asked for them. */
  names: string[]
}

/** What one mounted row exposes to the arms below. */
interface Mounted {
  /** The tool definitions the row registered. */
  tools: any[]
  /** The live `agent/created` listeners, in registration order. */
  listeners: Array<(payload: unknown) => unknown>
  /** Every restriction the row asked the adapter for. */
  restrictions: Restriction[]
  /** Every spawn spec the adapter forwarded. */
  spawned: any[]
}

/** Points `$HOME` at a fresh temp directory, so the workmate library lands in the sandbox and never the real home. */
function sandboxHome(): string {
  /** The scratch home the library root is resolved under. */
  const dir = mkdtempSync(join(tmpdir(), "mpd-wm-leaf-"))
  process.env.HOME = dir
  return dir
}

/**
 * The fake `mpdRoles` service the workmate row resolves its BASE templates from.
 *
 * @returns `list` and `get`, answering the two base templates this file needs.
 */
function makeRoles(): { list: () => Array<typeof DEEP_WORKER | typeof RESEARCHER>; get: (key: string) => typeof DEEP_WORKER | typeof RESEARCHER | null } {
  /** Both base templates the fake service reports, in list order. */
  const all = [DEEP_WORKER, RESEARCHER]
  return {
    list: () => all.map((template) => ({ ...template })),
    get: (key: string) => {
      /** The base template whose internal id this key is. */
      const template = all.find((candidate) => candidate.id === key)
      return template === undefined ? null : { ...template }
    },
  }
}

/**
 * Mount the workmate row once, with the child-seam seams under this file's control.
 *
 * `createDshAdapter` is the REAL adapter with only three members replaced: the event bus (so the arms drive
 * `agent/created` themselves), the label read (so a child is the object the arm emitted) and the retained deny
 * applier (so the arms assert WHAT the row asks to deny; the host's acceptance of that list is the adapter's
 * own contract, covered by its own tests).
 *
 * @returns the tools, listeners, restrictions and spawn specs of this mount.
 */
function mounted(): Mounted {
  /** Tool definitions the row registered, in registration order. */
  const tools: any[] = []
  /** The `agent/created` listeners, in registration order (the child-persona seam's, then the leaf one). */
  const listeners: Array<(payload: unknown) => unknown> = []
  /** Every restriction the row asked for, in call order. */
  const restrictions: Restriction[] = []
  /** Every spawn spec the adapter forwarded to the subagent seam. */
  const spawned: any[] = []
  /** The permissive cordis-shaped ctx the row's `apply` sees; its `mpdDsh` reader is wired below. */
  const ctx: any = {
    tools: {
      /** Record one tool definition; the row never reads a registration result. */
      register(d: unknown): void { tools.push(d) },
    },
    subagents: {
      /** The harness's own start seam; the real adapter reaches it through `ctx.subagents`. */
      start: async (_kind: string, opts: any) => {
        spawned.push(opts)
        return { result: { structured: { name: "leaf-probe", summary: "done" }, stopReason: "complete" } }
      },
    },
    provide: (): void => { /* the service nothing here asserts */ },
    get: (key: string) => (key === "mpdRoles" ? makeRoles() : undefined),
  }
  /** The `mpdDsh` double the row resolves instead of building its own adapter. */
  const dsh: any = {
    ...createDshAdapter(ctx),
    onEvent: (event: string, handler: (...args: unknown[]) => unknown): (() => void) => {
      if (event === "agent/created") listeners.push(handler)
      return () => { /* this file drives the listeners directly */ }
    },
    subagentLabelOf: (agent: unknown): string | undefined => (agent as { label?: string } | undefined)?.label,
    restrictAgentToolsRetained: (agent: unknown, names: readonly string[]): { applied: string[]; pruned: string[] } => {
      restrictions.push({ agent, names: [...names] })
      return { applied: [...names], pruned: [] }
    },
  }
  ctx.get = (key: string) => (key === "mpdDsh" ? dsh : key === "mpdRoles" ? makeRoles() : undefined)
  apply(ctx)
  return { tools, listeners, restrictions, spawned }
}

/**
 * One calling agent handle carrying a session header, as a dispatch carries it.
 *
 * @param header - the calling session's header fields under test.
 * @returns the exec double the registered tools receive.
 */
function caller(header: Record<string, unknown>): { agent: { id: string; session: { header: Record<string, unknown> } }; signal: AbortSignal } {
  return { agent: { id: "caller-session", session: { header } }, signal: new AbortController().signal }
}

/**
 * Broadcast one `agent/created` payload to every listener, the way the host does.
 *
 * @param listeners - the listeners this mount registered.
 * @param agent - the child agent the payload carries.
 */
function emitCreated(listeners: Array<(payload: unknown) => unknown>, agent: Record<string, unknown>): void {
  for (const listener of listeners) listener({ agent })
}

test("the two rows' copies agree, and the depth sentence is identical (source-level parity)", () => {
  expect([...LEAF_SPAWN_DENY]).toEqual(["mpd_role_spawn", "mpd_workmate_spawn"])
  // PARITY, pinned from source (test-only import): each row ships its own copy on purpose.
  expect([...ROLE_LEAF_SPAWN_DENY]).toEqual([...LEAF_SPAWN_DENY])
  /** One depth-2 caller header, the shape both rows must judge the same way. */
  const deep = { session: { header: { delegationDepth: 2 } } }
  expect(consultDepthRefusal(deep)).toBe(roleConsultDepthRefusal(deep))
  // And the boundary itself: depth 1 open (the cell planner's shape), depth 2 refused.
  expect(consultDepthRefusal({ session: { header: { delegationDepth: 1 } } })).toBeUndefined()
  expect(String(consultDepthRefusal(deep))).toContain("mpd_workmate_spawn")
  // THE SEPARATION IS INTENTIONAL: the read-only guarantee is untouched at exactly eight names.
  expect(READONLY_DENY).toHaveLength(8)
})

test("THE WIRING: mpd_workmate_spawn refuses a depth-2 caller and starts NO child, while depth 1 still spawns", async () => {
  sandboxHome()
  /** The mount the arms below drive. */
  const harness = mounted()
  /** The spawn tool this row registered. */
  const spawn = harness.tools.find((tool) => tool?.name === "mpd_workmate_spawn")
  expect(spawn).toBeDefined()
  await harness.tools.find((tool) => tool?.name === "mpd_workmate_init").execute({ base: "deep worker", name: "leaf-probe" }, caller({ agentPreset: "mpd", delegationDepth: 0 }))
  // THE FLOOR: a depth-2 caller is refused before the instance is even read, so no child is started.
  await expect(spawn.execute({ name: "leaf-probe", task: "go" }, caller({ delegationDepth: 2 }))).rejects.toThrow(/delegation depth 2/)
  expect(harness.spawned.length).toBe(0)
  // THE INTENDED NESTED CONSULTATION SURVIVES: a depth-1 caller still spawns, and the cap makes it a leaf.
  await spawn.execute({ name: "leaf-probe", task: "go" }, caller({ delegationDepth: 1 }))
  expect(harness.spawned.length).toBe(1)
  expect(harness.spawned[0].maxDepth).toBe(2)
})

test("a READ-ONLY workmate child gets the write deny AND the leaf deny in ONE restriction call", async () => {
  sandboxHome()
  /** The mount, whose init below creates a READ-ONLY workmate from the Researcher base. */
  const harness = mounted()
  await harness.tools.find((tool) => tool?.name === "mpd_workmate_init").execute({ base: "researcher", name: "readonly-leaf" }, caller({ agentPreset: "mpd", delegationDepth: 0 }))
  emitCreated(harness.listeners, { label: "readonly-leaf" })
  expect(harness.restrictions.length).toBe(1)
  expect(harness.restrictions[0].names).toEqual([...READONLY_DENY, ...LEAF_SPAWN_DENY])
})

test("a WRITE-CAPABLE workmate child gets the leaf deny alone, in ONE restriction call", async () => {
  sandboxHome()
  /** The mount, whose init below creates a write-capable workmate from the Deep Worker base. */
  const harness = mounted()
  await harness.tools.find((tool) => tool?.name === "mpd_workmate_init").execute({ base: "deep worker", name: "write-leaf" }, caller({ agentPreset: "mpd", delegationDepth: 0 }))
  emitCreated(harness.listeners, { label: "write-leaf" })
  expect(harness.restrictions.length).toBe(1)
  expect(harness.restrictions[0].names).toEqual([...LEAF_SPAWN_DENY])
})

test("a child this row did not raise is left alone", () => {
  sandboxHome()
  /** A fresh mount, so the restriction list belongs to this arm alone. */
  const harness = mounted()
  // A roster role label belongs to the ROLES row's seam: this row must not touch its scope.
  emitCreated(harness.listeners, { label: "Explorer" })
  emitCreated(harness.listeners, {})
  expect(harness.restrictions.length).toBe(0)
})
