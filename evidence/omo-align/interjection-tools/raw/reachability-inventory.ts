import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const ROOT = "/root/dshProj/my-power-dsh/packages/mpd-agent-teams-plugin"
const LIB = join(ROOT, "lib")
const TESTS = [join(ROOT, "test"), join(ROOT, "self-fix-tests")]

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (/\.(js|mjs|ts)$/.test(full)) out.push(full)
  }
  return out
}

const libFiles = walk(LIB).filter((f) => !f.endsWith("mpd-deltas.js"))
const testFiles = TESTS.flatMap((dir) => { try { return walk(dir) } catch { return [] } })
const libSources = new Map(libFiles.map((f) => [f, readFileSync(f, "utf8")]))
const testSources = new Map(testFiles.map((f) => [f, readFileSync(f, "utf8")]))

/** Every `export function|const|async function` declared in lib/**. */
function declaredExports() {
  const found = []
  for (const [file, text] of libSources) {
    text.split("\n").forEach((line, index) => {
      const match = /^export\s+(?:async\s+)?(?:function|const|class)\s+([A-Za-z_$][\w$]*)/.exec(line)
      if (match) found.push({ symbol: match[1], file: relative(ROOT, file), line: index + 1 })
    })
  }
  return found
}

/** Where a symbol is USED outside its own declaration (import list or a call). */
function usages(symbol, ownerFile) {
  const hits = []
  for (const [file, text] of libSources) {
    const rel = relative(ROOT, file)
    text.split("\n").forEach((line, index) => {
      const trimmed = line.trim()
      if (trimmed.startsWith("//") || trimmed.startsWith("*")) return
      if (!new RegExp(`\\b${symbol}\\b`).test(line)) return
      if (new RegExp(`^export\\s+(?:async\\s+)?(?:function|const|class)\\s+${symbol}\\b`).test(trimmed)) return
      if (rel === ownerFile && /^\s*\*\s/.test(line)) return
      // an import binding is not a CALL SITE: prefer a real use when one exists
      const isImportBinding = /^import\b/.test(trimmed) || /^\s*\w+,?$/.test(line) || /[,{]\s*$/.test(trimmed)
      hits.push({ file: rel, line: index + 1, text: trimmed.slice(0, 100), isImportBinding })
    })
  }
  return hits
}

const rows = declaredExports().map(({ symbol, file, line }) => {
  const all = usages(symbol, file)
  // Production reachability = the symbol appears in a file OTHER than its own, OR it is
  // called inside its own module (an internal helper the module's exports rely on).
  const foreignFiles = [...new Set(all.filter((u) => u.file !== file).map((u) => u.file))]
  const internalCalls = all.filter((u) => u.file === file)
  const tests = [...testSources.entries()].filter(([, text]) => new RegExp(`\\b${symbol}\\b`).test(text)).map(([f]) => relative(ROOT, f))
  const reachable = foreignFiles.length > 0 || internalCalls.length > 0
  const callSites = all.filter((u) => u.isImportBinding !== true)
  // prefer a REAL call site for the reported location; fall back to the import binding
  const first = callSites[0] ?? all[0]
  return {
    symbol,
    declared: `${file}:${line}`,
    className: foreignFiles.length > 0 ? "REACHABLE (cross-module)" : internalCalls.length > 0 ? "REACHABLE (module-internal)" : "NO PRODUCTION CALLER",
    usedBy: foreignFiles,
    firstUse: first === undefined ? undefined : `${first.file}:${first.line}${first.isImportBinding === true ? " (import)" : ""}`,
    callSiteCount: callSites.length,
    tests: tests.length,
  }
})

const summary = {
  totalExports: rows.length,
  crossModule: rows.filter((r) => r.className.startsWith("REACHABLE (cross")).length,
  moduleInternal: rows.filter((r) => r.className.includes("module-internal")).length,
  noProductionCaller: rows.filter((r) => r.className === "NO PRODUCTION CALLER").map((r) => r.symbol),
}
console.log(JSON.stringify({ summary, rows }, null, 2))
