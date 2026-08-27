import { test, expect } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { stripJsonc, deepMerge, apply } from "../src/index.ts"

test("stripJsonc removes comments and trailing commas", () => {
  const src = ['{', '  // user layer', '  "memory": { "vcs": "git", /* inline */ "enabled": true },', '  "ulw": { "maxRounds": 5, },', '}'].join(String.fromCharCode(10))
  const out = stripJsonc(src)
  expect(out).not.toContain("//")
  expect(out).not.toContain("/*")
  expect(() => JSON.parse(out)).not.toThrow()
  expect(JSON.parse(out)).toEqual({ memory: { vcs: "git", enabled: true }, ulw: { maxRounds: 5 } })
})

test("stripJsonc keeps comments inside strings", () => {
  const out = stripJsonc('{ "a": "http://x" }')
  expect(JSON.parse(out).a).toBe("http://x")
})

test("deepMerge project wins, nested merged, pollution safe", () => {
  const base = { memory: { vcs: "git", dir: ".mpd/memory" }, team: { stateDir: ".mpd/team" } } as any
  const over = { memory: { vcs: "both" }, ulw: { maxRounds: 3 } }
  const merged = deepMerge(base, over)
  expect(merged.memory).toEqual({ vcs: "both", dir: ".mpd/memory" })
  expect(merged.team.stateDir).toBe(".mpd/team")
  expect(merged.ulw.maxRounds).toBe(3)
  const polluted = deepMerge({}, JSON.parse('{"__proto__":{"pol":true}}'))
  expect((Object.prototype as any).pol).toBeUndefined()
  expect(JSON.stringify(polluted)).not.toContain("pol")
})

test("mpd_config_get result is lossless JSON for a missing key (value null, never undefined)", async () => {
  const prevHome = process.env.DSH_HOME
  const prevRoot = process.env.DSH_WORKSPACE_ROOT
  process.env.DSH_HOME = mkdtempSync(join(tmpdir(), "mpd-cfg-home-"))
  process.env.DSH_WORKSPACE_ROOT = mkdtempSync(join(tmpdir(), "mpd-cfg-ws-"))
  try {
    const tools: any[] = []
    apply({ tools: { register: (t: any) => tools.push(t) }, provide: () => {} } as any, {})
    const get = tools.find((t) => t.name === "mpd_config_get")
    const withKey = await get.execute({ key: "memory.vcs" })
    expect(withKey.value).toBeNull()
    expect(withKey.key).toBe("memory.vcs")
    // host contract: JSON round-trip must be lossless and contain no undefined fields
    expect(JSON.parse(JSON.stringify(withKey))).toEqual(withKey)
    expect(Object.values(withKey)).not.toContain(undefined)
    const noKey = await get.execute({})
    expect(JSON.parse(JSON.stringify(noKey))).toEqual(noKey)
    expect(noKey.value).toBeUndefined() // field omitted entirely when no key requested
  } finally {
    if (prevHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = prevHome
    if (prevRoot === undefined) delete process.env.DSH_WORKSPACE_ROOT; else process.env.DSH_WORKSPACE_ROOT = prevRoot
  }
})