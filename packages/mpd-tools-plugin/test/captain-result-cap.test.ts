// C3 — `captain.maxResultBytes`: a CAPTAIN's tool result is capped in BYTES, with the full text on disk.
//
// WHY THIS FILE EXISTS. Every tool result the top-level `mpd` session receives is context it carries for
// the rest of the run, so the contract gives that ONE caller a much smaller budget (default 4096 bytes)
// while CHILD sessions keep today's 16384-character truncation exactly. The cap must not merely be
// "small enough": the boundary is asserted both ways (AT the cap passes through byte-identical; ONE byte
// over truncates), because an off-by-one here is the failure mode this kind of guard usually ships with.
// Every arm also asserts the RECOVERY the contract requires — the original byte count and the absolute
// path of the full text — and reads the saved file back, so the evidence is on disk rather than implied.
import { describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { DshPostDecision, DshPostResult, DshTextBlock, DshToolExec } from "../../mpd-dsh-adapter-plugin/src/index.ts"
import {
  apply,
  DEFAULT_CAPTAIN_MAX_RESULT_BYTES,
  resolveMaxResultBytes,
} from "../src/index.ts"

/** One `tools/post-execute` listener as the plugin registers it, in the shape the harness calls it. */
type PostExecuteListener = (exec: DshToolExec, result: DshPostResult, next: () => Promise<DshPostDecision>) => Promise<DshPostDecision>

/** A throwaway workspace under the OS temp dir — never the repository root (F.1). */
function sandbox(): string {
  return mkdtempSync(join(tmpdir(), "mpd-tools-captain-cap-"))
}

/** Remove a sandbox and prove it is gone. */
function cleanup(workspace: string): void {
  rmSync(workspace, { recursive: true, force: true })
  expect(existsSync(workspace)).toBe(false)
}

/** The full-text log directory under one sandbox. */
function toolResultsDir(workspace: string): string {
  return join(workspace, ".mpd", "logs", "tool-results")
}

/** The top-level `mpd` session: depth 0, the `mpd` preset, no recorded delegation fact. */
function captain(workspace: string): { session: { id: string; header: Record<string, unknown> } } {
  return { session: { id: "captain-session", header: { cwd: workspace, agentPreset: "mpd" } } }
}

/** A delegated child of the same preset — a recorded subagent origin and depth, like the harness records. */
function child(workspace: string): { session: { id: string; header: Record<string, unknown> } } {
  return { session: { id: "child-session", header: { cwd: workspace, agentPreset: "mpd", origin: "subagent", delegationDepth: 1 } } }
}

/** The downstream accept decision the harness would hand the waterfall. */
function accept(text: string): DshPostDecision {
  return { kind: "accept", content: [{ type: "text", text }] } as DshPostDecision
}

/** The one text block a waterfall decision carries. */
function textOf(decision: DshPostDecision): string {
  return (decision.content as DshTextBlock[])[0].text
}

/**
 * Install the plugin and return its truncation waterfall, with the log env pinned to the sandbox.
 *
 * `rowLogLine` resolves its root from `MPD_MCP_LOG_DIR` -> `DSH_WORKSPACE_ROOT` -> cwd; pinning both is
 * the §7 isolation rule one layer below the workspace, otherwise the activation line lands in the
 * REPOSITORY's own `.mpd/logs/`.
 *
 * @param workspace - the sandbox the plugin resolves state against.
 * @param config - the row config handed to `apply`.
 * @param live - optional `mpdConfig` answers, keyed by the full dot-path spelling.
 * @returns the first registered `tools/post-execute` listener (the truncation waterfall).
 */
function truncationHook(
  workspace: string,
  config: Parameters<typeof apply>[1] = {},
  live: Record<string, unknown> = {},
): PostExecuteListener {
  /** Every post-execute listener the plugin registered, in order (truncation, then edit recovery). */
  const hooks: PostExecuteListener[] = []
  /** The minimal row context: an inert guard, the event bus and the config service. */
  const ctx: Parameters<typeof apply>[0] = {
    tools: {
      /** Accept the plugin's guard registration; these arms drive the waterfalls instead. */
      guard(): void {},
    },
    /** Record every `tools/post-execute` listener, in registration order. */
    on(ev: string, fn: PostExecuteListener): void { if (ev === "tools/post-execute") hooks.push(fn) },
    /** Answer the LIVE config layer; everything else is absent, so the row-private adapter is used. */
    get(id: string): unknown { return id === "mpdConfig" ? { get: (key: string) => live[key] } : undefined },
  }
  /** The previous log root, restored after the arm. */
  const previousLogRoot = process.env.MPD_MCP_LOG_DIR
  /** The previous workspace root, restored after the arm. */
  const previousWorkspace = process.env.DSH_WORKSPACE_ROOT
  process.env.MPD_MCP_LOG_DIR = workspace
  process.env.DSH_WORKSPACE_ROOT = workspace
  try {
    apply(ctx, config)
  } finally {
    if (previousLogRoot === undefined) delete process.env.MPD_MCP_LOG_DIR
    else process.env.MPD_MCP_LOG_DIR = previousLogRoot
    if (previousWorkspace === undefined) delete process.env.DSH_WORKSPACE_ROOT
    else process.env.DSH_WORKSPACE_ROOT = previousWorkspace
  }
  /** The truncation waterfall, absent only when registration broke. */
  const hook = hooks[0]
  if (hook === undefined) throw new Error("the truncation waterfall was not registered")
  return hook
}

/** Run one result text through a waterfall the way the adapter does (downstream in, replacement out). */
async function run(hook: PostExecuteListener, text: string, agent: unknown, tool: string = "bash"): Promise<DshPostDecision> {
  /** The decision the harness already produced for this result. */
  const downstream = accept(text)
  return hook({ name: tool, arguments: {}, agent } as DshToolExec, downstream, async () => downstream)
}

describe("resolveMaxResultBytes — the config seam", () => {
  test("default 4096, an explicit integer wins, and 0 is a DECLARED disable", async () => {
    expect(resolveMaxResultBytes(undefined)).toBe(DEFAULT_CAPTAIN_MAX_RESULT_BYTES)
    expect(resolveMaxResultBytes(4096)).toBe(4096)
    expect(resolveMaxResultBytes(1024)).toBe(1024)
    expect(resolveMaxResultBytes("2048")).toBe(2048)
    expect(resolveMaxResultBytes(0)).toBe(0)
    expect(resolveMaxResultBytes("0")).toBe(0)
  })

  test("anything unreadable fails CLOSED on the default rather than switching the cap off", async () => {
    expect(resolveMaxResultBytes("yes")).toBe(DEFAULT_CAPTAIN_MAX_RESULT_BYTES)
    expect(resolveMaxResultBytes("")).toBe(DEFAULT_CAPTAIN_MAX_RESULT_BYTES)
    expect(resolveMaxResultBytes(-1)).toBe(DEFAULT_CAPTAIN_MAX_RESULT_BYTES)
    expect(resolveMaxResultBytes(1.5)).toBe(DEFAULT_CAPTAIN_MAX_RESULT_BYTES)
  })
})

describe("mpd-tools captain result cap (C3 / A3)", () => {
  test("a captain result over the cap is truncated, and the FULL text is on disk with its absolute path", async () => {
    /** The sandbox the captain calls in. */
    const workspace = sandbox()
    /** The oversized result, ASCII so its byte and character counts agree. */
    const text = "x".repeat(100_000)
    /** The waterfall under the captain's explicit cap. */
    const hook = truncationHook(workspace, { captain: { maxResultBytes: 4096 } })
    /** The decision the captain receives. */
    const out = await run(hook, text, captain(workspace))
    /** The visible text the model would see. */
    const body = textOf(out)
    // THE MARKER NAMES THE ORIGINAL BYTES, THE KEPT BYTES AND THE ABSOLUTE RECOVERY PATH.
    expect(body).toContain("[mpd] truncated 100000B -> 6144B")
    expect(body).toContain("full text: " + toolResultsDir(workspace))
    expect(body.length).toBeLessThan(text.length)
    // THE FILE IS THE CONTRACT'S OWN PATH SHAPE, and it really carries the whole result.
    /** The files written under the full-text log directory. */
    const files = readdirSync(toolResultsDir(workspace))
    expect(files.length).toBe(1)
    expect(files[0]).toMatch(/^\d+-bash\.log$/)
    expect(readFileSync(join(toolResultsDir(workspace), files[0] as string), "utf8")).toBe(text)
    cleanup(workspace)
  })

  test("EXACTLY at the cap passes through byte-identical — no marker, no file", async () => {
    /** The sandbox the captain calls in. */
    const workspace = sandbox()
    /** A result whose byte count equals the cap. */
    const text = "y".repeat(4096)
    /** The waterfall under the default cap. */
    const hook = truncationHook(workspace, { captain: { maxResultBytes: 4096 } })
    /** The decision the harness already produced. */
    const downstream = accept(text)
    /** The decision the waterfall returned. */
    const out = await hook({ name: "bash", arguments: {}, agent: captain(workspace) }, downstream, async () => downstream)
    // SAME OBJECT, not merely equal content: a pass-through must not rewrite the decision.
    expect(out).toBe(downstream)
    expect(textOf(out)).not.toContain("[mpd] truncated")
    expect(existsSync(toolResultsDir(workspace))).toBe(false)
    cleanup(workspace)
  })

  test("ONE byte over the cap truncates — the off-by-one boundary", async () => {
    /** The sandbox the captain calls in. */
    const workspace = sandbox()
    /** A result exactly one byte larger than the cap. */
    const text = "y".repeat(4097)
    /** The waterfall under the default cap. */
    const hook = truncationHook(workspace, { captain: { maxResultBytes: 4096 } })
    /** The decision the harness already produced. */
    const downstream = accept(text)
    /** The decision the waterfall returned. */
    const out = await hook({ name: "bash", arguments: {}, agent: captain(workspace) }, downstream, async () => downstream)
    /** The visible text the model would see. */
    const body = textOf(out)
    expect(out).not.toBe(downstream)
    // ORIGINAL is 4097B (the whole result) and KEPT is the 4096B head: the marker reports the ORIGINAL.
    expect(body).toContain("[mpd] truncated 4097B -> 4096B")
    expect(body).toContain("full text: ")
    expect(readFileSync(join(toolResultsDir(workspace), readdirSync(toolResultsDir(workspace))[0] as string), "utf8")).toBe(text)
    cleanup(workspace)
  })

  test("the cap is measured in BYTES: a 2000-character CJK result (6000 B) is truncated", async () => {
    /** The sandbox the captain calls in. */
    const workspace = sandbox()
    /** Two thousand CJK characters, three UTF-8 bytes each. */
    const text = "中".repeat(2000)
    /** The waterfall under the default cap. */
    const hook = truncationHook(workspace, { captain: { maxResultBytes: 4096 } })
    /** The decision the captain receives. */
    const out = await run(hook, text, captain(workspace))
    expect(text.length).toBeLessThan(4096) // under the cap in CHARACTERS ...
    expect(Buffer.byteLength(text, "utf8")).toBe(6000) // ... but over it in BYTES.
    expect(textOf(out)).toContain("[mpd] truncated 6000B")
    cleanup(workspace)
  })

  test("a CHILD's result is untouched by the captain cap and keeps today's character budget", async () => {
    /** The sandbox the child calls in. */
    const workspace = sandbox()
    /** The oversized result. */
    const text = "z".repeat(100_000)
    /** A generous legacy budget proves the CAPTAIN cap is what did not fire, not truncation in general. */
    const hook = truncationHook(workspace, { captain: { maxResultBytes: 4096 }, truncateMaxBytes: 1_000_000 })
    /** The decision the harness already produced. */
    const downstream = accept(text)
    /** The decision the waterfall returned for the child. */
    const out = await hook({ name: "bash", arguments: {}, agent: child(workspace) }, downstream, async () => downstream)
    expect(out).toBe(downstream)
    expect(existsSync(toolResultsDir(workspace))).toBe(false)
    cleanup(workspace)
  })

  test("a child still receives today's 16384-character banner, unchanged", async () => {
    /** The sandbox the child calls in. */
    const workspace = sandbox()
    /** The oversized result. */
    const text = "z".repeat(100_000)
    /** Today's budget, the shipped default. */
    const hook = truncationHook(workspace, { captain: { maxResultBytes: 4096 }, truncateMaxBytes: 16384 })
    /** The decision the child receives. */
    const out = await run(hook, text, child(workspace))
    /** The visible text the child would see. */
    const body = textOf(out)
    expect(body).toContain("[mpd-tools truncated 100000 chars; keep 16384 budget; tail follows]")
    expect(body).not.toContain("[mpd] truncated")
    cleanup(workspace)
  })

  test("`captain.maxResultBytes: 0` disables the cap — and the legacy budget does NOT take over", async () => {
    /** The sandbox the captain calls in. */
    const workspace = sandbox()
    /** The oversized result. */
    const text = "q".repeat(100_000)
    /** The opt-out: cap 0, and a legacy budget large enough that it cannot mask the answer either way. */
    const hook = truncationHook(workspace, { captain: { maxResultBytes: 0 }, truncateMaxBytes: 1_000_000 })
    /** The decision the harness already produced. */
    const downstream = accept(text)
    /** The decision the waterfall returned. */
    const out = await hook({ name: "bash", arguments: {}, agent: captain(workspace) }, downstream, async () => downstream)
    expect(out).toBe(downstream)
    expect(existsSync(toolResultsDir(workspace))).toBe(false)
    cleanup(workspace)
  })

  test("a small captain result passes through unchanged", async () => {
    /** The sandbox the captain calls in. */
    const workspace = sandbox()
    /** A result well under the default cap. */
    const text = "small output"
    /** The waterfall with no config at all, so the shipped default governs. */
    const hook = truncationHook(workspace)
    /** The decision the harness already produced. */
    const downstream = accept(text)
    /** The decision the waterfall returned. */
    const out = await hook({ name: "bash", arguments: {}, agent: captain(workspace) }, downstream, async () => downstream)
    expect(out).toBe(downstream)
    cleanup(workspace)
  })

  test("the LIVE config layer wins over the row config, read per call", async () => {
    /** The sandbox the captain calls in. */
    const workspace = sandbox()
    /** A result over the live cap but under the row's. */
    const text = "r".repeat(2000)
    /** The row says 4096; `mpd.jsonc` (the live layer) says 512. */
    const hook = truncationHook(workspace, { captain: { maxResultBytes: 4096 } }, { "captain.maxResultBytes": 512 })
    /** The decision the captain receives. */
    const out = await run(hook, text, captain(workspace))
    // kept = 512-byte head + 256-byte tail (T-18: the layer's answer outranks the row pin).
    expect(textOf(out)).toContain("[mpd] truncated 2000B -> 768B")
    cleanup(workspace)
  })

  test("a FAILED full-text write degrades to today's truncation and says so in the banner", async () => {
    /** The sandbox the captain calls in. */
    const workspace = sandbox()
    // Make the log directory IMPOSSIBLE to create: `.mpd/logs` is a regular file, so mkdir -p fails.
    mkdirSync(join(workspace, ".mpd"), { recursive: true })
    writeFileSync(join(workspace, ".mpd", "logs"), "not a directory")
    /** The oversized result. */
    const text = "w".repeat(100_000)
    /** The waterfall with today's budget, which the degraded path must fall back to. */
    const hook = truncationHook(workspace, { captain: { maxResultBytes: 4096 }, truncateMaxBytes: 16384 })
    /** The decision the captain receives. */
    const out = await run(hook, text, captain(workspace))
    /** The visible text the captain would see. */
    const body = textOf(out)
    expect(body).toContain("[mpd] full text log could not be written:")
    expect(body).toContain("[mpd-tools truncated 100000 chars; keep 16384 budget;")
    expect(body).not.toBe(text)
    cleanup(workspace)
  })

  test("the activation line reports captainMaxResultBytes=<n>", async () => {
    /** The sandbox the row boots against. */
    const workspace = sandbox()
    truncationHook(workspace, { captain: { maxResultBytes: 2048 } })
    /** The row's own log lines. */
    const lines = readFileSync(join(workspace, ".mpd", "logs", "mpd-tools.log"), "utf8").split("\n").filter((line) => line !== "")
    expect(lines.some((line) => line.includes("captainMaxResultBytes=2048"))).toBe(true)
    cleanup(workspace)
  })
})
