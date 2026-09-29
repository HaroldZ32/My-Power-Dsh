import { readFileSync, writeFileSync, unlinkSync } from "node:fs"
import { spawnSync } from "node:child_process"

const original = readFileSync("packages/mpd-ext-plugin/test/mcp.test.ts", "utf8")
const lines = original.split("\n")
const testStarts = []
lines.forEach((line, index) => { if (line.startsWith("test(")) testStarts.push(index) })
const armIndex = testStarts.findIndex((start) => lines[start].includes("tools/call maps content"))

for (const keep of [0, 1, 2, 3, 4]) {
  const enabled = new Set([testStarts[keep], testStarts[armIndex]])
  const variant = lines.map((line, index) => (testStarts.includes(index) && !enabled.has(index) ? line.replace("test(", "if (false) test(") : line)).join("\n")
  const path = "packages/mpd-ext-plugin/test/zz-bisect.test.ts"
  writeFileSync(path, variant)
  const run = spawnSync("bun", ["test", path], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 300000 })
  const out = String(run.stdout ?? "") + String(run.stderr ?? "")
  const armLine = out.split("\n").find((l) => l.includes("tools/call maps content")) ?? "(not reported)"
  const first = lines[testStarts[keep]].slice(5, 60)
  console.log("only #" + keep + " (" + first.trim() + "...) + arm: exit=" + run.status + " :: " + armLine.trim().slice(0, 90))
  unlinkSync(path)
}