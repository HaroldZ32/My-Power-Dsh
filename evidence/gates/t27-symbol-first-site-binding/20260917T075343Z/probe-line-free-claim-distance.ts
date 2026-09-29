#!/usr/bin/env node
// t27 (F3) support measurement: how FAR is a LINE-FREE (symbol-first) claim from the anchor it
// belongs to, in the REAL subjects?
//
// F3: `symbolOnlyClaimCheck` matched line-free claims DOCUMENT-WIDE (`.find` over every claim with
// the same path), so a WRONG symbol-first claim passes whenever an EARLIER line-free claim for the
// same path exists. The fix binds it to the anchor's SITE with `claimForSite()`
// (|claim.docLine - citation.docLine| <= ROT_SITE_WINDOW = 1). Before choosing that, this measures
// the real documents: a cluster at 0/1 means the binding changes nothing there; a long tail means it
// would silently un-verify real anchors (the "gate that lies" class this lane exists to close).
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
const notAtSite = []
let lineFreeCitations = 0
for (const subject of SUBJECTS) {
  const full = readFileSync(join(REPO, subject.path), "utf8")
  let text = full
  let offset = 0
  if (subject.from !== undefined) {
    const match = subject.from.exec(full)
    offset = full.slice(0, match.index).split("\n").length - 1
    text = full.slice(match.index)
  }
  const claims = []
  for (const match of text.matchAll(new RegExp(CLAIM_PATTERN.source, CLAIM_PATTERN.flags))) {
    if (match[3] !== undefined) continue // line-bearing claims belong to the OTHER arm
    claims.push({ path: match[2], docLine: offset + text.slice(0, match.index).split("\n").length })
  }
  text.split("\n").forEach((line, index) => {
    const docLine = offset + index + 1
    for (const match of line.matchAll(PATH_PATTERN)) {
      if (match[2] !== undefined) continue // line-bearing citations belong to the other arm
      lineFreeCitations += 1
      const forPath = claims.filter((claim) => claim.path === match[1])
      if (forPath.length === 0) {
        orphans.push(`${subject.path}:${docLine} ${match[1]} — no line-free claim for this path (stays free/opt-in)`)
        continue
      }
      const distance = Math.min(...forPath.map((claim) => Math.abs(claim.docLine - docLine)))
      histogram.set(distance, (histogram.get(distance) ?? 0) + 1)
      if (distance > 1) notAtSite.push(`${subject.path}:${docLine} ${match[1]} — nearest claim ${distance} line(s) away (claim doc lines ${forPath.map((c) => c.docLine).join(",")})`)
    }
  })
}
console.log(`[t27-claim-distance] ${lineFreeCitations} LINE-FREE path citation(s) in the real subjects`)
console.log(`[t27-claim-distance] |claim.docLine - citation.docLine| histogram: ${[...histogram.entries()].sort((a, b) => a[0] - b[0]).map(([d, n]) => `${d} line(s): ${n}`).join(" · ")}`)
console.log(`[t27-claim-distance] citations with NO line-free claim for their path at all (opt-in freedom): ${orphans.length}`)
console.log(`[t27-claim-distance] citations whose nearest line-free claim is MORE than 1 line away (would be un-verified by site binding): ${notAtSite.length}`)
for (const entry of notAtSite) console.log("  ! " + entry)
