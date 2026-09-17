#!/usr/bin/env node
// Reproducible byte accounting for `evidence/extensions/docs-claims/check-citations.mjs`.
//
// WHY THIS EXISTS (captain's record request, 2026-09-17): the checker grew inside lane C's
// window (24,021 B pre-wave -> 25,530 -> 28,116 -> 30,345 B). The reviewing seat excluded a
// relaxation independently (arm-name+verdict sets: exactly one changed line, same 12-arm
// denominator, MORE anchors verified). What was still owed was WHAT the bytes are and whether
// any of them could change a reading under an unexercised input. This script produces the
// numbers that declaration rests on, so a reviewer can re-run it:
//
//   node evidence/extensions/docs-claims/<run-dir>/growth-accounting.mjs
//
// It reads ONLY two files (the pre-wave copy retained in the RED worktree and the current
// revision), shells out to `git diff --no-index --unified=0`, and prints JSON. Nothing is written.
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { spawnSync } from "node:child_process"

const PRE = process.argv[2] ?? ".mpd/red-baseline/evidence/extensions/docs-claims/check-citations.mjs"
const CUR = process.argv[3] ?? "evidence/extensions/docs-claims/check-citations.mjs"

const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex")
const size = (path) => readFileSync(path).length
const bytesOf = (text) => Buffer.byteLength(text, "utf8")

const diff = spawnSync("git", ["diff", "--no-index", "--unified=0", PRE, CUR], { encoding: "utf8" })
const lines = (diff.stdout ?? "").split("\n")

// Each hunk is attributed to a change set by the mechanism its added lines name. The two sets
// are the two edits lane C made: T-53 (immutable output plumbing — NO check rule change) and
// T-55 (symbol-first verification — ONE new failure mode).
const ATTR = [
  { set: "T-53", test: /immutable-output|OUT_FLAG|OUT_EXPLICIT|OUT_ROOT|writeImmutable|exitOnRefusal|output_root|output_target|T-53/ },
  { set: "T-55", test: /symbolOnly|symbol_only|reportedEvidence|T-55|line-less|lineLess|symbol-first/ },
]
const hunks = []
let current = null
for (const line of lines) {
  if (line.startsWith("@@")) {
    current = { header: line, added: 0, removed: 0, addedBytes: 0, removedBytes: 0, text: [] }
    hunks.push(current)
    continue
  }
  if (current === null) continue
  if (line.startsWith("+") && !line.startsWith("+++")) { current.added += 1; current.addedBytes += bytesOf(line.slice(1)) + 1; current.text.push(line.slice(1)) }
  else if (line.startsWith("-") && !line.startsWith("---")) { current.removed += 1; current.removedBytes += bytesOf(line.slice(1)) + 1; current.text.push(line.slice(1)) }
}
for (const hunk of hunks) {
  const joined = hunk.text.join("\n")
  const hit = ATTR.find((entry) => entry.test.test(joined))
  hunk.set = hit === undefined ? "unattributed" : hit.set
  hunk.netBytes = hunk.addedBytes - hunk.removedBytes
}
const bySet = {}
for (const hunk of hunks) {
  const entry = bySet[hunk.set] ?? { hunks: 0, added: 0, removed: 0, addedBytes: 0, removedBytes: 0, netBytes: 0 }
  entry.hunks += 1
  entry.added += hunk.added
  entry.removed += hunk.removed
  entry.addedBytes += hunk.addedBytes
  entry.removedBytes += hunk.removedBytes
  entry.netBytes += hunk.netBytes
  bySet[hunk.set] = entry
}
console.log(JSON.stringify({
  preWave: { path: PRE, bytes: size(PRE), sha256: sha256(PRE) },
  current: { path: CUR, bytes: size(CUR), sha256: sha256(CUR) },
  totalDelta: { addedBytes: hunks.reduce((sum, h) => sum + h.addedBytes, 0), removedBytes: hunks.reduce((sum, h) => sum + h.removedBytes, 0), netBytes: size(CUR) - size(PRE), addedLines: hunks.reduce((sum, h) => sum + h.added, 0), removedLines: hunks.reduce((sum, h) => sum + h.removed, 0) },
  bySet,
  hunks: hunks.map((hunk) => ({ header: hunk.header, set: hunk.set, added: hunk.added, removed: hunk.removed, addedBytes: hunk.addedBytes, removedBytes: hunk.removedBytes, netBytes: hunk.netBytes, firstAddedLine: hunk.text[0]?.slice(0, 110) })),
  retainedRevisions: {
    note: "the intermediate revisions (5e56c82c… 25,530 B, e332da70… 28,116 B) are NOT on disk — T-82 — so the 25,530→30,345 window cannot be byte-attributed per revision; what is measured is the retained pair below and the per-hunk classification of the final revision",
    windowNetBytes: 30345 - 25530,
  },
}, null, 2))
