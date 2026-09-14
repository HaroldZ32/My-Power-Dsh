// The artifact a real boot loads is `packages/mpd-ext-plugin/dist/index.js` (the
// bundle patch's `mpd-ext` row names exactly that file). Before any mounted boot,
// load THAT file, under NODE, and check the shape the loader depends on:
//   · it imports standalone (a measured failure class here: ERR_MODULE_NOT_FOUND);
//   · `name` is the row id and `inject` is empty (a declared-but-unregistered
//     service is a FATAL pending entry in this harness);
//   · `apply` is an async function: connect-at-apply needs the loader to await it.
//
// Run: node evidence/extensions/mcp-bridge-gates/20260914T171058Z/dist-load.mjs
import { fileURLToPath } from "node:url"

const dist = new URL("../../../../packages/mpd-ext-plugin/dist/index.js", import.meta.url)
const module = await import(dist.href)
const checks = [
  ["module loads standalone", true],
  ["name is the row id", module.name === "mpd-ext"],
  ["inject is empty", Array.isArray(module.inject) && module.inject.length === 0],
  ["apply is a function", typeof module.apply === "function"],
  ["apply is async (returns a promise)", module.apply.constructor.name === "AsyncFunction"],
]
const failed = checks.filter(([, ok]) => !ok)

// A real invocation with a hostile-but-harmless ctx: the plugin must never throw
// out of apply, and it must resolve (the loader waits on this promise).
const registered = []
const warnings = []
const ctx = {
  logger: { warn: (line) => warnings.push(line), info: () => {}, error: () => {} },
  get: () => undefined,
  provide: () => {},
  effect: () => () => {},
  tools: { register: (definition) => { registered.push(definition.name); return () => {} }, get: () => undefined, guard: () => () => {}, execute: async () => ({}) },
  skills: { registerProvider: () => () => {} },
}
let resolved = false
let threw = null
try {
  const result = module.apply(ctx, { quiet: true })
  resolved = result instanceof Promise
  await result
} catch (error) {
  threw = error instanceof Error ? error.message : String(error)
}
checks.push(["apply resolves without throwing", threw === null && resolved])
checks.push(["apply registered the four tools", registered.length === 4])

const report = {
  loadedPath: fileURLToPath(dist),
  checks: checks.map(([label, ok]) => ({ label, ok })),
  failed: failed.length + (threw === null && resolved && registered.length === 4 ? 0 : 1),
  registered,
  warnings,
  verdict: failed.length === 0 && threw === null && resolved && registered.length === 4 ? "pass" : "fail",
}
console.log(JSON.stringify(report, null, 2))
process.exitCode = report.verdict === "pass" ? 0 : 1
