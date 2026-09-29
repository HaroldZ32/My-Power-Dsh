#!/usr/bin/env node
// T-72 support measurement: how FAR is a claim from the anchor it belongs to, in the REAL subjects?
//
// The enforcement closes the "shadowed" hole by pairing a claim with the anchor AT ITS SITE instead
// of anywhere in the document. Before choosing that window, this measures the distance between every
// line-bearing path citation and the claim that names its path:line, in the checker's own subjects.
// A cluster at 0/1 means the site window is safe for the recorded citations; a long tail means the
// window would mass-redden the docs (acceptance (c) forbids that).
import { readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, "..", "..", "..", "..")
const STATUS_HEADING = /^## 12\./m
const SUBJECTS = [
  { path: "docs/extension-authoring-guide.md" },
  { path: "docs/extension-authoring-guide.zh-CN.md" },
  { path: "EXTENSIONS-FOR-AGENTS.md" },
  { path: "docs/extension-adaptation-report.md", from: STATUS_HEADING },
  { path: "docs/extension-adaptation-report.zh-CN.md", from: STATUS_HEADING },
]
const PATH_PATTERN = /(?<![\w/.-])((?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+\.(?:json|ya?ml|mjs|md|js|ts))(?![A-Za-z0-9_])(?::(\d+)(?:[-–](\d+))?)?/g
const CLAIM_PATTERN = /`([^`]+)`\s*[,，]?\s*\(?\s*`((?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+\.(?:json|ya?ml|mjs|md|js|ts))(?::(\d+)(?:[-–](\d+))?)?`/g

const histogram = new Map()
const orphans = []
let anchored = 0
for (const subject of SUBJECTS) {
  const full = readFileSync(join(REPO, subject.path), "utf8")
  let text = full
  let offset = 0
  if (subject.from !== undefined) {
    const match = subject.from.exec(full)
    offset = full.slice(0, match.index).split("\n").length - 1
    text = full.slice(match.index)
  }
  const lines = text.split("\n")
  const claims = []
  for (const match of text.matchAll(new RegExp(CLAIM_PATTERN.source, CLAIM_PATTERN.flags))) {
    claims.push({ path: match[2], line: match[3] === undefined ? undefined : Number(match[3]), endLine: match[4] === undefined ? undefined : Number(match[4]), docLine: offset + text.slice(0, match.index).split("\n").length })
  }
  lines.forEach((line, index) => {
    const docLine = offset + index + 1
    for (const match of line.matchAll(PATH_PATTERN)) {
      const citationLine = match[2] === undefined ? undefined : Number(match[2])
      if (citationLine === undefined) continue
      anchored += 1
      const endLine = match[3] === undefined ? undefined : Number(match[3])
      const candidates = claims.filter((claim) => claim.path === match[1] && claim.line === citationLine && claim.endLine === endLine)
      if (candidates.length === 0) {
        orphans.push(`${subject.path}:${docLine} ${match[1]}:${citationLine} — NO claim with this path:line in the document`)
        continue
      }
      const distance = Math.min(...candidates.map((claim) => Math.abs(claim.docLine - docLine)))
      histogram.set(distance, (histogram.get(distance) ?? 0) + 1)
      if (distance > 1) orphans.push(`${subject.path}:${docLine} ${match[1]}:${citationLine} — nearest claim is ${distance} line(s) away (claim doc line ${candidates.map((c) => c.docLine).join(",")})`)
    }
  })
}
console.log(`[claim-proximity] ${anchored} line-bearing path citation(s) in the real subjects`)
console.log(`[claim-proximity] |claim.docLine - citation.docLine| histogram: ${[...histogram.entries()].sort((a, b) => a[0] - b[0]).map(([d, n]) => `${d} line(s): ${n}`).join(" · ")}`)
console.log(`[claim-proximity] citations with no same-path:line claim anywhere in their document: ${orphans.filter((o) => o.includes("NO claim")).length}`)
console.log(`[claim-proximity] citations whose nearest claim is MORE than 1 line away: ${orphans.filter((o) => o.includes("line(s) away")).length}`)
for (const orphan of orphans) console.log("  - " + orphan)
