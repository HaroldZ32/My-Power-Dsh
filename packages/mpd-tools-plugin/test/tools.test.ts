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
