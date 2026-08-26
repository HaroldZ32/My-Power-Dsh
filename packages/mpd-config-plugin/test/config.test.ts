import { test, expect } from "bun:test"
import { stripJsonc, deepMerge } from "../src/index.ts"

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