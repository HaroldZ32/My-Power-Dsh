import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
const LIB = "/root/dshProj/my-power-dsh/packages/mpd-agent-teams-plugin/lib"
const registry = (await import(join(LIB, "mpd-deltas.js"))).MPD_DELTAS
const regIds = new Set(registry.map((e) => e.id))
const report = []
for (const name of readdirSync(LIB).sort()) {
  if (!name.endsWith(".js")) continue
  const lines = readFileSync(join(LIB, name), "utf8").split("\n")
  const stack = []
  for (let i = 0; i < lines.length; i += 1) {
    const begin = /^\s*\/\/#region (mpd-delta [A-Za-z0-9-]+) \(/.exec(lines[i])
    const end = /^\s*\/\/#endregion (mpd-delta [A-Za-z0-9-]+)$/.exec(lines[i].trim())
    if (begin !== null) {
      if (stack.length > 0) report.push({ file: name, child: begin[1], childLine: i + 1, parent: stack[stack.length - 1].id, parentLine: stack[stack.length - 1].line, childRegistered: regIds.has(begin[1]), parentRegistered: regIds.has(stack[stack.length - 1].id) })
      stack.push({ id: begin[1], line: i + 1 })
      continue
    }
    if (end !== null) {
      const top = stack.pop()
      if (top === undefined || top.id !== end[1]) report.push({ file: name, mismatch: { opened: top?.id ?? null, closed: end[1], line: i + 1 } })
    }
  }
  if (stack.length > 0) report.push({ file: name, unclosed: stack })
}
console.log(JSON.stringify({ nestedRegions: report, nestedCount: report.filter((r) => r.child !== undefined).length, wellFormed: report.filter((r) => r.child === undefined).length }, null, 2))
