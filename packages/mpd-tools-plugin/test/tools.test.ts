import { test, expect } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { join, relative } from "node:path"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"
import { apply } from "../src/index.ts"
import type { DshPostDecision, DshPostResult, DshTextBlock, DshToolExec } from "../../mpd-dsh-adapter-plugin/src/index.ts"

/** One `tools/post-execute` listener as the plugin registers it, in the shape the harness calls it. */
type PostExecuteListener = (exec: DshToolExec, result: DshPostResult, next: () => Promise<DshPostDecision>) => Promise<DshPostDecision>

/**
 * Drive the plugin's pre-execute guard against a ctx whose `tools.guard` records the listener, so a
 * test can call that listener directly instead of running a tool.
 *
 * @param config - row config; no caller disables `writeGuard`, so a listener is always recorded.
 * @returns the recorded guard: the denial text, or undefined when the write is allowed through.
 */
function makeGuard(config?: Parameters<typeof apply>[1]): (exec: DshToolExec) => string | undefined {
  /** The listener the plugin hands to `tools.guard`, captured when `apply` runs. */
  let guard: ((exec: DshToolExec) => string | undefined) | null = null
  /** The minimal row context: a `guard` sink plus an event bus this arm never uses. */
  const ctx: Parameters<typeof apply>[0] = {
    tools: {
      /** Keep the listener the plugin registers, so the test can call it directly. */
      guard(fn: (exec: DshToolExec) => string | undefined): void { guard = fn }
    },
    /** Accept the subscription the plugin makes; this arm drives the guard, never the bus. */
    on(): void {}
  }
  apply(ctx, config)
  // No caller disables `writeGuard`, so `apply` always records the listener before it returns.
  return guard!
}

/**
 * Drive the plugin's post-execute hooks against a ctx whose `on` records them, so a test can invoke
 * one waterfall the way the adapter would (downstream decision in, replacement out).
 *
 * @param config - row config; both waterfalls register unconditionally.
 * @returns the recorded `tools/post-execute` listeners, in registration order.
 */
function makeWaterfalls(config?: Parameters<typeof apply>[1]): PostExecuteListener[] {
  /** Every `tools/post-execute` listener the plugin registered, in registration order. */
  const hooks: PostExecuteListener[] = []
  /** The minimal row context: an inert `guard` plus an `on` that keeps only the post-execute event. */
  const ctx: Parameters<typeof apply>[0] = {
    tools: {
      /** Accept the plugin's guard registration; this arm drives the two waterfalls instead. */
      guard(): void {}
    },
    /** Record every `tools/post-execute` listener the plugin registers, in order. */
    on(ev: string, fn: PostExecuteListener): void { if (ev === "tools/post-execute") hooks.push(fn) }
  }
  apply(ctx, config)
  return hooks
}

test("write-guard allows first write to a new file", () => {
  /** A path that does not exist yet, under a fresh temp directory. */
  const fp = join(mkdtempSync(join(tmpdir(), "mpd-tools-")), "new.txt")
  /** The guard under test, as the plugin registered it. */
  const guard = makeGuard()
  expect(guard({ name: "write", arguments: { file_path: fp, content: "hello" } })).toBeUndefined()
})

test("write-guard allows idempotent rewrite of identical content", () => {
  /** The temp directory holding the fixture file. */
  const dir = mkdtempSync(join(tmpdir(), "mpd-tools-"))
  /** The existing target path. */
  const fp = join(dir, "a.txt")
  writeFileSync(fp, "same content")
  /** The guard under test, as the plugin registered it. */
  const guard = makeGuard()
  expect(guard({ name: "write", arguments: { file_path: fp, content: "same content" } })).toBeUndefined()
})

test("write-guard denies silent overwrite of differing content", () => {
  /** The temp directory holding the fixture file. */
  const dir = mkdtempSync(join(tmpdir(), "mpd-tools-"))
  /** The existing target path whose body differs from the requested one. */
  const fp = join(dir, "a.txt")
  writeFileSync(fp, "old")
  /** The guard under test, as the plugin registered it. */
  const guard = makeGuard()
  expect(guard({ name: "write", arguments: { file_path: fp, content: "new" } })).toContain("use the edit tool")
})

test("write-guard allows idempotent rewrite of a >1MB file (full-file compare)", () => {
  /** The temp directory holding the fixture file. */
  const dir = mkdtempSync(join(tmpdir(), "mpd-tools-"))
  /** The existing target path, >1MB so the guard must compare the whole body and not a prefix. */
  const fp = join(dir, "big.txt")
  /** The 1.5MB body written to disk and then offered back verbatim. */
  const big = "x".repeat(1_500_000)
  writeFileSync(fp, big)
  /** The guard under test, as the plugin registered it. */
  const guard = makeGuard()
  expect(guard({ name: "write", arguments: { file_path: fp, content: big } })).toBeUndefined()
  expect(guard({ name: "write", arguments: { file_path: fp, content: big + "diff" } })).toContain("use the edit tool")
})

// The write guard must resolve a RELATIVE file_path against the CALLING SESSION's workspace, never
// against the dsh process cwd — the same class the hashline guard was repaired for. Both failure
// directions are silent: a clobber the guard exists to prevent goes through (cwd has no such file),
// and an honest CREATE of <ws>/X is denied (cwd happens to hold an X with different content).
test("write-guard resolves a RELATIVE file_path against the session workspace, not process.cwd()", () => {
  /** The session workspace the guard must resolve against; unrelated to the process cwd. */
  const ws = mkdtempSync(join(tmpdir(), "mpd-tools-ws-"))
  /** The file already in that workspace: rewriting it with different content is the clobber. */
  writeFileSync(join(ws, "notes.md"), "old")
  /** One exec carrying the session whose header cwd IS that workspace. */
  const sessionExec: DshToolExec = { name: "write", arguments: { file_path: "notes.md", content: "new" }, agent: { session: { header: { cwd: ws } } } }
  /** The guard under test, as the plugin registered it. */
  const guard = makeGuard()
  // 1) The clobber: pre-fix the guard probed `<cwd>/notes.md`, found nothing and returned undefined.
  expect(guard(sessionExec) ?? "").toContain("use the edit tool")
  // 2) The mirror: a relative path that EXISTS from the process cwd but is absent from the session
  //    workspace must not be denied — pre-fix this honest CREATE was refused for a file the session
  //    never had. This test file's own cwd-relative path is that path by construction.
  /** This test file as a path relative to the process cwd, which resolves back to an existing file. */
  const relativeToCwd = relative(process.cwd(), fileURLToPath(import.meta.url))
  /** The same relative path read as the session would: a file that workspace does not contain. */
  const strayExec: DshToolExec = { name: "write", arguments: { file_path: relativeToCwd, content: "new" }, agent: { session: { header: { cwd: ws } } } }
  expect(guard(strayExec)).toBeUndefined()
})

/** The downstream accept decision every truncation arm starts from: one 100,000-character text block. */
const ACCEPT = { kind: "accept", content: [{ type: "text", text: "x".repeat(100_000) }] } as const

/**
 * Run one 100,000-character result through the truncation waterfall at the given budget.
 *
 * @param maxBytes - the `truncateMaxBytes` the plugin is configured with.
 * @returns the single text block the waterfall emitted.
 */
async function runTruncation(maxBytes: number): Promise<string> {
  /** The truncation waterfall, which is registered first. */
  const [hook] = makeWaterfalls({ truncateMaxBytes: maxBytes })
  /** The decision the adapter would have produced for an oversized result. */
  const out = await hook({}, { content: ACCEPT.content }, async () => ACCEPT)
  // The adapter's decision keeps `content` opaque on purpose; this arm knows the waterfall wrote exactly
  // one text block, so the blocks are asserted here rather than narrowed (type-level only).
  return (out.content as DshTextBlock[])[0].text
}

test("truncation output (incl. banner) never exceeds truncateMaxBytes", async () => {
  for (const maxBytes of [128, 256, 512, 1024, 4096]) {
    /** The truncated text produced at this budget. */
    const text = await runTruncation(maxBytes)
    expect(text.length).toBeLessThanOrEqual(maxBytes)
    expect(text).toContain("[mpd-tools truncated 100000 chars")
  }
})

// THE BOUNDARY the sampled budgets above never crossed: `budget = maxBytes - banner.length` is 1..3
// exactly when `Math.floor(budget * 0.3)` is 0, and `-0 === 0` made `slice(-0)` the WHOLE text — so
// the "truncated" output grew by 100,000 characters. The banner is 74 chars for these budgets.
test("truncation near the banner-length boundary never inflates the output", async () => {
  for (const maxBytes of [74, 75, 76, 77, 78, 79, 80]) {
    /** The truncated text produced at this boundary budget. */
    const text = await runTruncation(maxBytes)
    expect(text.length, "maxBytes=" + maxBytes).toBeLessThanOrEqual(maxBytes)
    expect(text, "maxBytes=" + maxBytes).toContain("[mpd-tools truncated 100000 chars")
  }
})

test("truncation with a budget smaller than the banner adds no head/tail slices", async () => {
  /** The truncated text, which here is the banner alone. */
  const text = await runTruncation(64) // banner alone is ~74 chars
  expect(text).toBe("\n... [mpd-tools truncated 100000 chars; keep 64 budget; tail follows] ...\n")
})

test("truncation keeps head and tail slices plus the banner", async () => {
  /** The budget this arm exercises: large enough to leave room beside the banner. */
  const maxBytes = 1024
  /** The truncated text produced at that budget. */
  const text = await runTruncation(maxBytes)
  expect(text.startsWith("x")).toBe(true)
  expect(text.endsWith("x")).toBe(true)
  expect(text).toContain("[mpd-tools truncated 100000 chars")
})

test("truncation passes through outputs within the budget unchanged", async () => {
  /** The truncation waterfall, which is registered first. */
  const [hook] = makeWaterfalls({ truncateMaxBytes: 1024 })
  /** A result that fits the budget, so the waterfall must return the decision untouched. */
  const small = { kind: "accept", content: [{ type: "text", text: "short output" }] } as const
  /** The decision the waterfall passed through. */
  const out = await hook({}, { content: small.content }, async () => small)
  expect(out).toBe(small)
})
