// t35 — CENSUS EQUIVALENCE DRIVER. `scripts/verify-manual-paths.mjs` is UNTRACKED (a wave-2 file, `??` in
// git), so there is no byte diff and no pre-edit copy to diff against: the "the matcher was NOT loosened"
// claim has to be MEASURED. This driver does exactly that, from three archived runs:
//
//   BEFORE   = the OLD instrument on the current manual (kind `after2` under the t28 evidence dir, exit 1,
//              unresolved=2) — the reading the task must keep beside the new one;
//   REMOVAL  = the NEW instrument with the DECLARED class EMPTIED (`--no-anticipatory`), on the same manual.
//              If the class is the ONLY thing that changed behaviour, this run must be CENSUS-IDENTICAL to
//              BEFORE — every bucket, every family, the audited count and both names;
//   AFTER    = the NEW instrument with the class ACTIVE (the t35 verify run, exit 0).
//
// The movement clause is asserted too: AFTER.unresolved + AFTER.anticipatory + AFTER['declared-unreferenced']
// must equal BEFORE.unresolved, so no refusal disappears without being accounted for in a printed bucket.
//
// Usage: node t35-census-compare.mjs [--out <dir>]
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

const HERE = dirname(new URL(import.meta.url).pathname)
const T28 = resolve(HERE, "..", "20260917T1455Z-t28")
const args = process.argv.slice(2)
const argOf = (name, fallback) => {
  const index = args.indexOf(name)
  return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback
}
const OUT = resolve(argOf("--out", HERE))

function readCensus(file) {
  const text = readFileSync(file, "utf8")
  const buckets = {}
  const families = {}
  for (const line of text.split("\n")) {
    let hit = /census bucket=(\S+) direction=\S+ count=(\d+)/.exec(line)
    if (hit) buckets[hit[1]] = Number(hit[2])
    hit = /census family=(\S+) direction=\S+ total=(\d+)/.exec(line)
    if (hit) families[hit[1]] = Number(hit[2])
    hit = /subjects audited=(\d+) \(resolved=(\d+) unresolved=(\d+)\)/.exec(line)
    if (hit) buckets.audited = Number(hit[1])
  }
  const fail = /FAIL unresolved=(\d+)/.exec(text)
  const pass = /PASS resolved=(\d+) over-report=(\d+) under-report=(\d+) declared=(\d+)/.exec(text)
  return { file, buckets, families, failUnresolved: fail === null ? null : Number(fail[1]), pass: pass === null ? null : { resolved: Number(pass[1]), over: Number(pass[2]), under: Number(pass[3]), declared: Number(pass[4]) } }
}

const before = readCensus(join(T28, "raw", "verify-manual-paths-after2.log"))
const removal = readCensus(join(HERE, "raw", "removal-arm.log"))
const after = readCensus(join(HERE, "raw", "after-in-place.log"))

const checks = {}
const note = (name, ok, reading) => { checks[name] = { ok, reading } }

// (1) the class-emptied NEW instrument must be census-identical to the OLD instrument
// Only buckets the OLD instrument also printed can be compared for equality; the two bucket LINES this
// change ADDS are asserted separately (they must be empty when the class is emptied — an addition, not a
// change to any existing bucket).
const sharedBuckets = Object.keys(before.buckets).filter((name) => removal.buckets[name] !== undefined).sort()
const addedBuckets = Object.keys(removal.buckets).filter((name) => before.buckets[name] === undefined).sort()
const bucketDiffs = sharedBuckets.filter((name) => before.buckets[name] !== removal.buckets[name]).map((name) => `${name}: before=${before.buckets[name]} removal=${removal.buckets[name]}`)
note("class-emptied run is census-identical to the old instrument on every bucket it printed", bucketDiffs.length === 0, bucketDiffs.length === 0 ? `all ${sharedBuckets.length} shared buckets equal (${sharedBuckets.map((n) => n + "=" + before.buckets[n]).join(", ")})` : bucketDiffs.join("; "))
note("the buckets this change ADDS are empty when the class is emptied", addedBuckets.length > 0 && addedBuckets.every((name) => removal.buckets[name] === 0), `added buckets ${addedBuckets.map((n) => n + "=" + removal.buckets[n]).join(", ")}`)
const sharedFamilies = Object.keys(before.families).filter((name) => removal.families[name] !== undefined).sort()
const familyDiffs = sharedFamilies.filter((name) => before.families[name] !== removal.families[name]).map((name) => `${name}: before=${before.families[name]} removal=${removal.families[name]}`)
note("class-emptied run: both matcher-error families equal (the families the old instrument printed)", familyDiffs.length === 0 && (removal.families.declared ?? -1) === 0, familyDiffs.length === 0 ? sharedFamilies.map((n) => `${n}=${before.families[n]}`).join(" ") + `; declared=${removal.families.declared ?? "-"} (the family this change adds, empty with the class emptied)` : familyDiffs.join("; "))
note("class-emptied run still FAILS on the same two names", removal.failUnresolved === before.failUnresolved && removal.failUnresolved === before.buckets.unresolved, `before=${before.failUnresolved} removal=${removal.failUnresolved} (unresolved ${before.buckets.unresolved})`)

// (2) the class-active run is green and the movement is fully accounted for
const moved = (after.buckets.unresolved ?? 0) + (after.buckets.anticipatory ?? 0) + (after.buckets["declared-unreferenced"] ?? 0)
note("class-active run is GREEN with no unresolved path", (after.buckets.unresolved ?? -1) === 0 && after.pass !== null, `unresolved=${after.buckets.unresolved} PASS=${JSON.stringify(after.pass)}`)
note("the movement is fully accounted for", moved === before.buckets.unresolved, `after(${after.buckets.unresolved} unresolved + ${after.buckets.anticipatory} anticipatory + ${after.buckets["declared-unreferenced"]} unreferenced) = ${moved} = before.unresolved ${before.buckets.unresolved}`)
note("the class touches nothing outside itself", after.buckets.resolved === before.buckets.resolved && after.families["over-report"] === before.families["over-report"] && after.families["under-report"] === before.families["under-report"], `resolved ${before.buckets.resolved} -> ${after.buckets.resolved}; over ${before.families["over-report"]} -> ${after.families["over-report"]}; under ${before.families["under-report"]} -> ${after.families["under-report"]}; audited ${before.buckets.audited} -> ${after.buckets.audited}`)
note("both declared entries are named with their reason", (after.buckets.anticipatory ?? 0) === 2 && (after.buckets["declared-unreferenced"] ?? -1) === 0 && (after.families.declared ?? 0) === 2, `anticipatory=${after.buckets.anticipatory} declared-unreferenced=${after.buckets["declared-unreferenced"]} family declared=${after.families.declared}`)

const failed = Object.entries(checks).filter(([, check]) => check.ok !== true).map(([name]) => name)
const result = {
  schema: "t35/census-equivalence/1",
  why: "the instrument is UNTRACKED (no byte diff exists) and no pre-edit copy was archived, so the non-loosening claim is measured from censuses rather than diffed",
  inputs: { before: before.file, removal: removal.file, after: after.file },
  censuses: { before, removal, after },
  checks,
  verdict: failed.length === 0 ? "PASS" : "FAIL",
  failedChecks: failed,
  finishedAt: new Date().toISOString(),
}
writeFileSync(join(OUT, "t35-census-equivalence.json"), JSON.stringify(result, null, 2) + "\n")
for (const [name, check] of Object.entries(checks)) console.log(`${check.ok ? "ok  " : "FAIL"} ${name} — ${check.reading}`)
process.exit(failed.length === 0 ? 0 : 1)
