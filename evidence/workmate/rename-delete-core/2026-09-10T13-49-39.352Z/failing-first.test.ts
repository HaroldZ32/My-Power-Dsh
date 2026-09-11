// RUN IT WITH THE TEST RUNNER: `bun test <this file>` — a bare `bun <file>` answers
// "Cannot use test outside of the test runner", which must not be read as the control misbehaving.
//
// t15 failing-first evidence: the regression case run against the OLD (defective) schema, verbatim as
// it shipped. Uses the same helper bodies as packages/mpd-workmate-plugin/test/rename-delete.test.ts
// (which must live in the package test dir), with `ok` absent from the declared properties.
import { test, expect } from "bun:test"
import { apply } from "/root/dshProj/my-power-dsh/packages/mpd-workmate-plugin/src/index.ts"
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"

const DEEP_WORKER = {
  id: "hephaestus", name: "Deep Worker", description: "d", readonly: false,
  chain: [{ provider: "deepseek-official", model: "deepseek-v4-flash" }], persona: "You are the Deep Worker."
}

async function harnessValidator() {
  const dsh = execFileSync("which", ["dsh"], { encoding: "utf8" }).trim()
  const globalLib = join(dirname(dsh), "..", "lib", "node_modules")
  for (const base of [join(globalLib, "@deepseek-ai", "dsh"), globalLib]) {
    const candidate = join(base, "node_modules", "@deepseek-ai", "dsh-tools", "lib", "index.js")
    if (!existsSync(candidate)) continue
    const mod: any = await import(candidate)
    if (typeof mod.validateJsonSchemaValue === "function") return mod
  }
  throw new Error("harness validator unreachable")
}

test("FAILING FIRST: the old schema rejects the value the tool returns", async () => {
  const home = mkdtempSync(join(tmpdir(), "mpd-t15-ff-home-"))
  const cwd = mkdtempSync(join(tmpdir(), "mpd-t15-ff-cwd-"))
  const prevHome = process.env.HOME, prevCwd = process.cwd()
  process.env.HOME = home; process.chdir(cwd)
  try {
    const tools: any[] = []
    const ctx: any = {
      get: (k: string) => (k === "mpdRoles" ? { list: () => [{ ...DEEP_WORKER }], get: (id: string) => (id === "hephaestus" ? { ...DEEP_WORKER } : null) } : undefined),
      tools: { register(d: any) { tools.push(d) } },
      subagents: { start: async () => ({ result: { structured: {}, stopReason: "complete" } }) },
      provide: () => {}, effect: (fn: any) => fn(),
    }
    apply(ctx)
    const byName = (n: string) => tools.find((t) => t.name === n)
    const exec = { agent: { id: "a" }, signal: new AbortController().signal }
    await byName("mpd_workmate_init").execute({ base: "hephaestus", name: "oracle-1" }, exec)
    const value = await byName("mpd_workmate_rename").execute({ name: "oracle-1", new_name: "oracle-2" }, exec)

    const harness: any = await harnessValidator()
    // The old declaration: `ok` is NOT among the properties, additionalProperties is false.
    const OLD_SCHEMA = { type: "object", properties: { name: { type: "string" }, from: { type: "string" }, renamedFrom: { type: "array", items: { type: "string" } } }, required: ["name", "from"], additionalProperties: false }
    // What the regression case asserts: zero violations against the DECLARED schema.
    const violations = harness.validateJsonSchemaValue(OLD_SCHEMA, value, "value")
    console.log("OLD-SCHEMA VIOLATIONS: " + JSON.stringify(violations))
    expect(violations).toEqual([])
  } finally {
    process.env.HOME = prevHome; process.chdir(prevCwd)
  }
})
