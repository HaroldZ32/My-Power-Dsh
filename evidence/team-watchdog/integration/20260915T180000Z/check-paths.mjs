#!/usr/bin/env node
// t78 — the ledger's own path-existence check.
//
// A report that cites a missing artifact is the one failure a ledger must not have, so this script
// extracts every backticked repo-relative path from .mpd/plans/team-watchdog-report.md, resolves it
// against the repo root, and checks it with existsSync. Directory citations (a trailing `/`) must
// exist as directories. Glob-ish placeholders (`<ts>`, `…`, `*`) are skipped and REPORTED as skipped
// rather than silently counted as passing. Exit 1 if any cited path is missing.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, "..", "..", "..", "..")
const REPORT = join(REPO, ".mpd", "plans", "team-watchdog-report.md")
const OUT = join(HERE, "raw")
mkdirSync(OUT, { recursive: true })

const ROOTS = ["evidence/", "packages/", "skills/", "scripts/", ".mpd/", "docs/", "presets/"]
const text = readFileSync(REPORT, "utf8")

const cited = new Set()
for (const match of text.matchAll(/`([^`\n]+)`/g)) {
  const token = match[1].trim().replace(/[.,;:]$/, "")
  if (!ROOTS.some((root) => token.startsWith(root))) continue
  cited.add(token)
}

const skipped = []
const checked = []
const missing = []

/** `{a,b}.md` → several real paths (the repo's own cited-path checker expands braces too). */
function expandBraces(token) {
  const match = /\{([^{}]*)\}/.exec(token)
  if (match === null) return [token]
  return match[1]
    .split(",")
    .flatMap((part) => expandBraces(token.slice(0, match.index) + part + token.slice(match.index + match[0].length)))
}

/**
 * A citation may carry a `:<line>` suffix (this repo's prose convention), and the file must still
 * exist — so the suffix is STRIPPED for the existence test and the line is verified separately.
 * A genuinely absent file is still a MISS.
 */
function checkToken(token) {
  const lineMatch = /^(.*\.(?:md|js|mjs|ts|json|yml|yaml|log)):(\d+)$/.exec(token)
  const pathToken = lineMatch === null ? token : lineMatch[1]
  const line = lineMatch === null ? undefined : Number(lineMatch[2])
  const bare = pathToken.endsWith("/") ? pathToken.slice(0, -1) : pathToken
  const path = join(REPO, bare)
  const exists = existsSync(path)
  let lineOk
  let lineText
  if (exists && line !== undefined) {
    const lines = readFileSync(path, "utf8").split("\n")
    lineOk = lines.length >= line
    lineText = lineOk ? String(lines[line - 1]).trim().slice(0, 96) : undefined
  }
  return { token, pathToken, line, exists, lineOk, lineText, ok: exists && (line === undefined || lineOk === true) }
}

for (const token of [...cited].sort()) {
  if (/[<>*…]/.test(token)) {
    skipped.push(token) // a placeholder or a glob: not an addressable path
    continue
  }
  for (const expanded of expandBraces(token)) {
    const result = checkToken(expanded)
    checked.push(result)
    if (!result.ok) missing.push(result.line !== undefined && result.exists ? `${expanded} (file exists, line missing)` : expanded)
  }
}

const lines = []
lines.push(`[check-paths] report=${REPORT}`)
lines.push(`[check-paths] repo=${REPO}`)
lines.push(`[check-paths] cited repo-relative tokens=${cited.size} · checked=${checked.length} · skipped(placeholders)=${skipped.length} · missing=${missing.length}`)
for (const item of skipped) lines.push(`  SKIPPED (placeholder/glob): ${item}`)
for (const item of checked) {
  const lineNote = item.line === undefined ? "" : ` (line ${item.line} ${item.lineOk ? "present" : "MISSING"}: ${JSON.stringify(item.lineText ?? "")})`
  lines.push(`  ${item.ok ? "OK  " : "MISS"} ${item.token}${lineNote}`)
}
lines.push(missing.length === 0 ? "[check-paths] PASS — every cited path exists" : `[check-paths] FAIL — missing: ${missing.join(", ")}`)

const stdout = lines.join("\n")
writeFileSync(join(OUT, "check-paths.log"), stdout + "\n", "utf8")
const summary = {
  task: "t78 — ledger path-existence check",
  reportPath: REPORT,
  cited: cited.size,
  checked: checked.length,
  skipped: skipped.length,
  missing,
  skippedTokens: skipped,
  ok: missing.length === 0,
  checkedAt: new Date().toISOString(),
  checks: checked,
}
writeFileSync(join(HERE, "path-check.json"), JSON.stringify(summary, null, 2) + "\n", "utf8")
console.log(stdout)
process.exit(missing.length === 0 ? 0 : 1)
