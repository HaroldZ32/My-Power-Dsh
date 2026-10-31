// THE ONE-SHOT WORKMATE SPAWN CARRIES AN EXPLICIT DEPTH CAP (defect D17 — the `mpd_role_spawn` rule).
//
// WHY. `mpd_workmate_spawn` forwarded NO `maxDepth`, so the host applied its own depth default: a NESTED
// caller (a depth-1 cell planner or a team member) had its consult refused there with a `SubagentDepthError`
// even though that consult is a LEAF which spawns nothing. The cap is now the caller's recorded delegation
// depth plus one, exactly as `mpd_role_spawn` forwards it.
//
// BOTH HALVES ARE ASSERTED, and the PARITY is a third arm. The pure arm reads every header shape a caller can
// carry; the parity arm compares this package's helper VALUE-FOR-VALUE with `mpd-roles`' own — imported from
// SOURCE, which is a TEST-ONLY coupling (this package ships no runtime dependency on that row, so the two
// helpers are duplicated on purpose and this file is what fails the moment they drift). The wiring arm drives
// the REGISTERED tool through the row's real `apply` and reads the spec the adapter handed the spawn seam.
import { expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { apply, spawnMaxDepthOf } from "../src/index.ts"
import { spawnMaxDepthOf as roleSpawnMaxDepthOf } from "../../mpd-roles-plugin/src/index.ts"

/** The Deep Worker BASE template the fake roster serves: write-capable, with a working chain and a persona. */
const DEEP_WORKER = {
  id: "hephaestus",
  name: "Deep Worker",
  description: "autonomous goal-driven implementation",
  readonly: false,
  chain: [{ provider: "deepseek-official", model: "deepseek-v4-flash" }],
  persona: "You are the Deep Worker. Execute goals end-to-end with tools and verify every change.",
}

/**
 * The fake `mpdRoles` service the workmate row resolves its BASE templates from.
 *
 * @returns `list` and `get`, answering the one base template this file's spawn needs.
 */
function makeRoles(): { list: () => Array<typeof DEEP_WORKER>; get: (key: string) => typeof DEEP_WORKER | null } {
  return {
    list: () => [{ ...DEEP_WORKER }],
    get: (key: string) => (key === DEEP_WORKER.id ? { ...DEEP_WORKER } : null),
  }
}

/** Points `$HOME` at a fresh temp directory, so the workmate library lands in the sandbox and never the real home. */
function sandboxHome(): string {
  /** The scratch home the library root is resolved under. */
  const dir = mkdtempSync(join(tmpdir(), "mpd-wm-depth-"))
  process.env.HOME = dir
  return dir
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
 * Concatenate the TEXT BLOCKS a spawn prompt is built from.
 *
 * The seam carries the harness's own block list (`[{type:"text", text}]`), not a plain string, so
 * `String(spec.prompt)` would assert against `"[object Object]"`.
 *
 * @param blocks - the spec's `prompt` field, as the adapter handed it over.
 * @returns the concatenated text, or `""` for a shape this reader does not recognise.
 */
function blocksText(blocks: unknown): string {
  if (Array.isArray(blocks)) {
    return blocks.map((block) => (typeof block === "object" && block !== null && typeof (block as { text?: unknown }).text === "string" ? String((block as { text: unknown }).text) : "")).join("")
  }
  return typeof blocks === "string" ? blocks : ""
}

/**
 * Apply the plugin once to a fake cordis context and expose what the spawn seam received.
 *
 * @returns the tool lookup, the spawn specs in order, and a caller factory bound to nothing else.
 */
function makePlugin(): { byName: (name: string) => any; spawned: any[] } {
  /** Every tool descriptor the plugin registered, in registration order. */
  const tools: any[] = []
  /** The options of every subagent the plugin started, so an arm can read the forwarded spec. */
  const spawned: any[] = []
  /** Services published through `ctx.provide`. */
  const provided: any = {}
  /** The fake cordis context: only the seams this row injects are wired. */
  const ctx: any = {
    get: (key: string) => (key === "mpdRoles" ? makeRoles() : undefined),
    tools: {
      /** Records a tool registration instead of validating it — no harness sits behind this fake context. */
      register(d: unknown): void { tools.push(d) },
    },
    subagents: {
      /** The harness's own start seam; the adapter reaches it through `ctx.subagents`. */
      start: async (_kind: string, opts: any) => {
        spawned.push(opts)
        return { result: { structured: { name: "depth-probe", summary: "done" }, stopReason: "complete" } }
      },
    },
    provide: (name: string, value: any) => { provided[name] = value },
  }
  apply(ctx)
  /** Looks one registered tool up by its registered name. */
  const byName = (name: string): any => tools.find((tool) => tool.name === name)
  return { byName, spawned }
}

test("the reading matches mpd_role_spawn's helper on EVERY header shape — the parity pin", () => {
  /** Every caller shape a session header can take, including the ones that are NOT a depth. */
  const shapes: Array<unknown> = [
    undefined,
    {},
    { session: {} },
    { session: { header: {} } },
    { session: { header: { agentPreset: "mpd", delegationDepth: 0 } } },
    // A SEEDED FORK (parent link + isSeeded, depth 0) is still the workspace's top-level session (§5, T-92).
    { session: { header: { parentSession: "p", isSeeded: true, delegationDepth: 0 } } },
    { session: { header: { delegationDepth: 1 } } },
    { session: { header: { delegationDepth: 2 } } },
    { session: { header: { delegationDepth: 7 } } },
    // A string depth the harness recorded, and a subagent-origin child with no depth at all.
    { session: { header: { delegationDepth: "3" } } },
    { session: { header: { origin: "subagent" } } },
    // Values that are NOT a usable depth: negative, fractional below one, unparsable.
    { session: { header: { delegationDepth: -1 } } },
    { session: { header: { delegationDepth: 0.5 } } },
    { session: { header: { delegationDepth: "not-a-depth" } } },
  ]
  for (const agent of shapes) {
    expect({ agent, cap: spawnMaxDepthOf(agent) }).toEqual({ agent, cap: roleSpawnMaxDepthOf(agent) })
  }
})

test("the values themselves: top-level 1, nested 2, and deeper nesting scales with the caller", () => {
  // A top-level caller and a caller with no readable depth both forward 1 — today's behaviour, now explicit.
  expect(spawnMaxDepthOf(undefined)).toBe(1)
  expect(spawnMaxDepthOf({ session: { header: { delegationDepth: 0 } } })).toBe(1)
  expect(spawnMaxDepthOf({ session: { header: { delegationDepth: "x" } } })).toBe(1)
  // The measured D17 case: a depth-1 caller's consult is a LEAF at depth 2, which no default can refuse.
  expect(spawnMaxDepthOf({ session: { header: { delegationDepth: 1 } } })).toBe(2)
  expect(spawnMaxDepthOf({ session: { header: { delegationDepth: 2 } } })).toBe(3)
  // A recorded `origin: "subagent"` child without a depth still gets a CHILD's cap, matching `sessionRank`.
  expect(spawnMaxDepthOf({ session: { header: { origin: "subagent" } } })).toBe(2)
})

test("THE WIRING: the registered mpd_workmate_spawn forwards `maxDepth` = caller depth + 1, per call", async () => {
  // The library must land in the sandbox: `$HOME` is the workmate root this row resolves.
  sandboxHome()
  /** The plugin handles, with the spawn sink this arm reads. */
  const { byName, spawned } = makePlugin()
  // The instance is created by a TOP-LEVEL caller, so its own provenance cannot stand in for the spawn depth.
  await byName("mpd_workmate_init").execute({ base: "deep worker", name: "depth-probe" }, caller({ agentPreset: "mpd", delegationDepth: 0 }))
  // The nested consult: the caller is a depth-1 child, so the spawn must carry 2.
  await byName("mpd_workmate_spawn").execute({ name: "depth-probe", task: "nested consult" }, caller({ delegationDepth: 1 }))
  expect(spawned.length).toBe(1)
  expect(spawned[0].maxDepth).toBe(2)
  expect(Object.hasOwn(spawned[0], "maxDepth")).toBe(true)
  // A SECOND spawn from a TOP-LEVEL caller carries 1: the cap is read per call, never cached on the record.
  await byName("mpd_workmate_spawn").execute({ name: "depth-probe", task: "top-level consult" }, caller({ agentPreset: "mpd", delegationDepth: 0 }))
  expect(spawned.length).toBe(2)
  expect(spawned[1].maxDepth).toBe(1)
})

test("CONTROL: the forwarded cap disturbs neither the route, the label nor the prompt", async () => {
  sandboxHome()
  /** The plugin handles, with the spawn sink this arm reads. */
  const { byName, spawned } = makePlugin()
  await byName("mpd_workmate_init").execute({ base: "deep worker", name: "depth-control" }, caller({ agentPreset: "mpd", delegationDepth: 0 }))
  await byName("mpd_workmate_spawn").execute({ name: "depth-control", task: "answer one question" }, caller({ delegationDepth: 1 }))
  expect(spawned.length).toBe(1)
  // The instance's own route still travels as the harness `agentOptions`, and the label is the workmate's name.
  expect(spawned[0].agentOptions?.provider).toBe("deepseek-official")
  expect(spawned[0].agentOptions?.model).toBe("deepseek-v4-flash")
  expect(spawned[0].label).toBe("depth-control")
  // The task still reaches the prompt, so the cap did not displace the consult it bounds.
  expect(blocksText(spawned[0].prompt)).toContain("answer one question")
})
