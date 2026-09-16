#!/usr/bin/env node

// t11 corrective action (captain ruling on the probe-report overwrite incident):
// recompute t7's own before/after snapshot over the 13 pre-existing evidence
// directories and compare against the archived digest
// `441c5ba89620c937f2908c1e9543cb2a063c2a14f32ecee36372b8f3e42d4124`.
//
// Method (t7's, reproduced): the snapshot is a file of `<sha256>  <relpath>` lines,
// and the digest is the sha256 OF THAT FILE's bytes. Recomputing every line's hash
// and re-serializing the same order reproduces the digest iff every pre-existing
// file still has identical content.
import { createHash } from "node:crypto"
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { dirname, join, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, "..", "..", "..", "..")
const ARCHIVE = join(REPO, "evidence", "extensions", "boundary-index")
const EXPECTED = "441c5ba89620c937f2908c1e9543cb2a063c2a14f32ecee36372b8f3e42d4124"

const logs = []
const log = (text) => {
  logs.push(text)
  process.stdout.write(text + "\n")
}
const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex")

log("verify-immutability — t7's snapshot, recomputed by the verifier")

const archived = readFileSync(join(ARCHIVE, "hashes-before.txt"), "utf8")
const archivedDigest = sha256(Buffer.from(archived))
log(`  archived hashes-before.txt digest: ${archivedDigest}`)
log(`  archived hashes-after.txt  digest: ${sha256(Buffer.from(readFileSync(join(ARCHIVE, "hashes-after.txt"), "utf8")))}`)
log(`  expected (captain-quoted)         : ${EXPECTED}`)

const lines = archived.split("\n").filter((line) => line.trim() !== "")
const dirs = readFileSync(join(ARCHIVE, "pre-existing-dirs.txt"), "utf8").split("\n").filter((line) => line.trim() !== "")

const modified = []
const missing = []
const recomputedLines = []
for (const line of lines) {
  const match = /^([0-9a-f]{64})\s\s(.+)$/.exec(line)
  if (match === null) {
    modified.push({ path: line, reason: "unparseable snapshot line" })
    continue
  }
  const [, hash, path] = match
  const absolute = join(REPO, path)
  if (!existsSync(absolute)) {
    missing.push({ path, expected: hash })
    continue
  }
  const current = sha256(readFileSync(absolute))
  if (current !== hash) modified.push({ path, expected: hash, current })
  recomputedLines.push(`${current}  ${path}`)
}
const recomputedDigest = sha256(Buffer.from(recomputedLines.join("\n") + "\n"))

// files that exist NOW under those directories but are not in the before list
const known = new Set(lines.map((line) => /^[0-9a-f]{64}\s\s(.+)$/.exec(line)?.[1]).filter(Boolean))
const walk = (relative) => {
  const out = []
  for (const entry of readdirSync(relative === "" ? REPO : join(REPO, relative), { withFileTypes: true })) {
    const child = relative === "" ? entry.name : join(relative, entry.name)
    if (entry.isDirectory()) out.push(...walk(child))
    else out.push(child)
  }
  return out
}
const added = []
for (const dir of dirs) {
  if (!existsSync(join(REPO, dir))) continue
  for (const file of walk(dir.replace(/\/$/, ""))) {
    const stat = statSync(join(REPO, file))
    if (stat.isDirectory()) continue
    if (!known.has(file)) added.push(file)
  }
}

const digestMatches = recomputedDigest === archivedDigest && archivedDigest === EXPECTED
const ok = modified.length === 0 && missing.length === 0 && digestMatches

log(`  files in the archived set: ${lines.length} (from ${dirs.length} pre-existing directories)`)
log(`  recomputed digest         : ${recomputedDigest}`)
log(`  modified=${modified.length} missing=${missing.length} added-since=${added.length}`)
log(`  digest matches the archive and the captain-quoted value: ${digestMatches}`)
if (modified.length > 0) for (const entry of modified) log(`    MODIFIED ${entry.path}`)
if (missing.length > 0) for (const entry of missing) log(`    MISSING  ${entry.path}`)
log(`  VERDICT: ${ok ? "no pre-existing evidence file was modified or deleted by this verification pass" : "DIFFERENCE FOUND — see the lists above"}`)

const report = {
  task: "t11",
  item: "corrective action — evidence immutability recheck (captain ruling on the probe-report overwrite)",
  attempt_id: "f488e6cf-997c-4899-b5bc-897ae67d869c",
  basis: "evidence/extensions/boundary-index/{hashes-before.txt,hashes-after.txt,pre-existing-dirs.txt} — t7's own 13-directory snapshot",
  archived_digest: archivedDigest,
  expected_digest: EXPECTED,
  recomputed_digest: recomputedDigest,
  digest_matches: digestMatches,
  files_in_snapshot: lines.length,
  directories: dirs.length,
  modified,
  missing,
  added_since_snapshot: added,
  verdict: ok ? "passed" : "failed",
}
writeFileSync(join(HERE, "raw", "immutability-recheck.json"), JSON.stringify(report, null, 2) + "\n")
writeFileSync(join(HERE, "raw", "immutability-recheck.log"), logs.join("\n") + "\n")
process.exitCode = ok ? 0 : 1
