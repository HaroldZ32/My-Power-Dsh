#!/usr/bin/env node
// Golden runner: execute each task's declared verifier; --task filters one task.
import { readdirSync, readFileSync, existsSync } from "node:fs"
import { join, resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"

const root = resolve(dirname(fileURLToPath(import.meta.url)))
const args = process.argv.slice(2)
const only = args.indexOf("--task") >= 0 ? args[args.indexOf("--task") + 1] : undefined
const tasks = readdirSync(root).filter((d) => existsSync(join(root, d, "task.json"))).sort()
const results = []
let failed = 0
for (const id of tasks) {
  if (only && id !== only) continue
  const meta = JSON.parse(readFileSync(join(root, id, "task.json"), "utf8"))
  const r = spawnSync(meta.verify[0], meta.verify.slice(1), { shell: true, cwd: resolve(root, "..", ".."), encoding: "utf8", timeout: 120000, maxBuffer: 8 * 1024 * 1024 })
  const out = ((r.stdout ?? "") + (r.stderr ?? "")).slice(-1200)
  const ok = r.status === 0
  if (!ok) failed++
  results.push({ id, kind: meta.kind, lang: meta.lang, ok, exit: r.status, tail: out })
  console.log((ok ? "PASS" : "FAIL") + "  " + id + "  (" + meta.kind + "/" + meta.lang + ")")
}
if (only) {
  const r = results[0]
  if (!r) { console.error("[golden] unknown task: " + only); process.exit(1) }
  console.log(r.tail)
  process.exit(r.ok ? 0 : 1)
}
console.log("[golden] total=" + results.length + " failed=" + failed)
process.exit(failed ? 1 : 0)
