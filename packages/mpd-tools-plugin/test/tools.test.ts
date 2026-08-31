import { test, expect } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { apply } from "../src/index.ts"

function makeGuard(config?: any) {
  let guard: any = null
  const ctx: any = { tools: { guard(fn: any) { guard = fn } }, on() {} }
  apply(ctx, config)
  return guard
}

function makeWaterfalls(config?: any) {
  const hooks: Array<(exec: any, result: any, next: any) => any> = []
  const ctx: any = { tools: { guard() {} }, on(ev: string, fn: any) { if (ev === "tools/post-execute") hooks.push(fn) } }
  apply(ctx, config)
  return hooks
}

test("write-guard allows first write to a new file", () => {
  const fp = join(mkdtempSync(join(tmpdir(), "mpd-tools-")), "new.txt")
  const guard = makeGuard()
  expect(guard({ name: "write", arguments: { file_path: fp, content: "hello" } })).toBeUndefined()
})

test("write-guard allows idempotent rewrite of identical content", () => {
  const dir = mkdtempSync(join(tmpdir(), "mpd-tools-"))
  const fp = join(dir, "a.txt")
  writeFileSync(fp, "same content")
  const guard = makeGuard()
  expect(guard({ name: "write", arguments: { file_path: fp, content: "same content" } })).toBeUndefined()
})

test("write-guard denies silent overwrite of differing content", () => {
  const dir = mkdtempSync(join(tmpdir(), "mpd-tools-"))
  const fp = join(dir, "a.txt")
  writeFileSync(fp, "old")
  const guard = makeGuard()
  expect(guard({ name: "write", arguments: { file_path: fp, content: "new" } })).toContain("use the edit tool")
})

test("write-guard allows idempotent rewrite of a >1MB file (full-file compare)", () => {
  const dir = mkdtempSync(join(tmpdir(), "mpd-tools-"))
  const fp = join(dir, "big.txt")
  const big = "x".repeat(1_500_000)
  writeFileSync(fp, big)
  const guard = makeGuard()
  expect(guard({ name: "write", arguments: { file_path: fp, content: big } })).toBeUndefined()
  expect(guard({ name: "write", arguments: { file_path: fp, content: big + "diff" } })).toContain("use the edit tool")
})

const ACCEPT = { kind: "accept", content: [{ type: "text", text: "x".repeat(100_000) }] }

async function runTruncation(maxBytes: number): Promise<string> {
  const [hook] = makeWaterfalls({ truncateMaxBytes: maxBytes })
  const out = await hook({}, { content: ACCEPT.content }, async () => ACCEPT)
  return out.content[0].text
}

test("truncation output (incl. banner) never exceeds truncateMaxBytes", async () => {
  for (const maxBytes of [128, 256, 512, 1024, 4096]) {
    const text = await runTruncation(maxBytes)
    expect(text.length).toBeLessThanOrEqual(maxBytes)
    expect(text).toContain("[mpd-tools truncated 100000 chars")
  }
})

test("truncation with a budget smaller than the banner adds no head/tail slices", async () => {
  const text = await runTruncation(64) // banner alone is ~74 chars
  expect(text).toBe("\n... [mpd-tools truncated 100000 chars; keep 64 budget; tail follows] ...\n")
})

test("truncation keeps head and tail slices plus the banner", async () => {
  const maxBytes = 1024
  const text = await runTruncation(maxBytes)
  expect(text.startsWith("x")).toBe(true)
  expect(text.endsWith("x")).toBe(true)
  expect(text).toContain("[mpd-tools truncated 100000 chars")
})

test("truncation passes through outputs within the budget unchanged", async () => {
  const [hook] = makeWaterfalls({ truncateMaxBytes: 1024 })
  const small = { kind: "accept", content: [{ type: "text", text: "short output" }] }
  const out = await hook({}, { content: small.content }, async () => small)
  expect(out).toBe(small)
})
