#!/usr/bin/env node
// t18 citation sweep (re-run of the t16 §4 method, shipped as a re-takeable tool).
//
// Walks evidence/install-deps, extracts every repo-relative `evidence/install-deps/...` string a
// record CITES, and resolves each against the filesystem. A string is an ANCHOR only when it is a
// concrete path: globs (`*`), ellipses (`…` / `...`), placeholders (`<ts>`, `$VAR`) and truncated
// fragments are reported in their own bucket, never as unresolved anchors.
//
// Usage: node evidence/install-deps/repair-f1/citation-sweep.mjs [--out <dir>]
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, "..", "..", "..")
const SCOPE = join(REPO, "evidence", "install-deps")
const SKIP_DIRS = new Set(["node_modules", "cache", "sandboxes", ".git"])
const TEXT = /\.(md|json|mjs|js|ts|txt|log|out|yaml|yml)$/
const CITED = /evidence\/install-deps\/[A-Za-z0-9._/@-]+/g

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue
    const path = join(dir, entry)
    const stat = lstatSync(path)
    if (stat.isSymbolicLink()) continue
    if (stat.isDirectory()) yield* walk(path)
    else if (stat.isFile() && TEXT.test(path)) yield path
  }
}

const files = [...walk(SCOPE)]
const cited = new Map() // string -> [{file,line}]
for (const file of files) {
  let text = ""
  try { text = readFileSync(file, "utf8") } catch { continue }
  text.split("\n").forEach((line, index) => {
    for (const raw of line.match(CITED) ?? []) {
      const value = raw.replace(/[.,;:)\]]+$/, "")
      if (!cited.has(value)) cited.set(value, [])
      if (cited.get(value).length < 4) cited.get(value).push({ file: relative(REPO, file), line: index + 1 })
    }
  })
}

const nonAnchors = new Map()
const unresolved = new Map()
const resolved = new Set()
for (const [value, where] of cited) {
  if (value.includes("*") || value.includes("...") || value.includes("…") || value.includes("<") || value.includes("$")) {
    nonAnchors.set(value, where)
    continue
  }
  if (existsSync(join(REPO, value))) resolved.add(value)
  else unresolved.set(value, where)
}

const report = {
  case: "install-deps/repair-f1/citation-sweep",
  measured_at_utc: new Date().toISOString(),
  scope: "evidence/install-deps",
  files_scanned: files.length,
  distinct_cited: cited.size,
  resolved: resolved.size,
  non_anchor_patterns: nonAnchors.size,
  unresolved: unresolved.size,
  unresolved_detail: [...unresolved.entries()].map(([value, where]) => ({ value, citedBy: where })),
  non_anchor_detail: [...nonAnchors.keys()].sort(),
}
const outIndex = process.argv.indexOf("--out")
const outDir = outIndex === -1 ? HERE : join(REPO, process.argv[outIndex + 1])
mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, "citation-sweep.result.json"), JSON.stringify(report, null, 2) + "\n")
console.log(`[citation-sweep] files=${report.files_scanned} distinct=${report.distinct_cited} resolved=${report.resolved} nonAnchors=${report.non_anchor_patterns} unresolved=${report.unresolved}`)
for (const item of report.unresolved_detail) console.log("  UNRESOLVED " + item.value + "  (cited by " + item.citedBy[0].file + ":" + item.citedBy[0].line + ")")
if (report.unresolved !== 0) process.exit(1)
