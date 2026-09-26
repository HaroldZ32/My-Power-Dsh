#!/usr/bin/env node
// T-77 (lane B's gitignore half) — the pattern family must ignore QA scratch roots BY SHAPE, not by
// name. The decisive test the acceptance names: create TWO root dirs, one that matches the shape and one
// NEAR-MISS that merely shares the prefix, and assert ignored / NOT ignored respectively, with
// `git check-ignore -v` naming the pattern that matched (a read-only command).
//
// The family the shape must cover includes stamp FILES as well as directories: the "existing" rows below
// are a file (`.qa-t15-dir` is a regular file, measured) and a directory, and both must report ignored.
// The driver writes nothing of its own: the two probe dirs are created and removed inside one run, and
// the near-miss is deliberately NOT ignored, so it exists in `git status` for the duration of the run.
//
// usage: node ./gitignore-shape-driver.mjs [--json]
// exit 0 = shape ignored + near-miss visible + the pattern named; exit 1 = either probe behaved otherwise
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"

const repo = process.cwd()
const PREFIX = "[gitignore-shape]"
const SHAPE_PROBE = ".qa-w2b-shape-probe"
const NEAR_MISS_PROBE = ".quarantine-probe"
const EXISTING_SCRATCH = [".qa-t15-dir", ".qa-t17-dir", ".qa-t21-dir", ".qa-reloc"]
const json = process.argv.includes("--json")

const checkIgnore = (relPath) => {
  try {
    const out = execFileSync("git", ["check-ignore", "-v", "./" + relPath], { cwd: repo, encoding: "utf8" })
    return { ignored: true, pattern: out.trim() }
  } catch (error) {
    return { ignored: false, pattern: String(error.stdout ?? "").trim(), status: error.status }
  }
}

const results = { shape: null, nearMiss: null, existing: [], ok: false }
mkdirSync(join(repo, SHAPE_PROBE), { recursive: true })
mkdirSync(join(repo, NEAR_MISS_PROBE), { recursive: true })
try {
  results.shape = { path: SHAPE_PROBE, ...checkIgnore(SHAPE_PROBE) }
  results.nearMiss = { path: NEAR_MISS_PROBE, ...checkIgnore(NEAR_MISS_PROBE) }
  for (const rel of EXISTING_SCRATCH) if (existsSync(join(repo, rel))) results.existing.push({ path: rel, ...checkIgnore(rel) })
  results.ok = results.shape.ignored === true && results.nearMiss.ignored === false
} finally {
  rmSync(join(repo, SHAPE_PROBE), { recursive: true, force: true })
  rmSync(join(repo, NEAR_MISS_PROBE), { recursive: true, force: true })
}

if (json) {
  console.log(JSON.stringify(results, null, 2))
} else {
  console.log(PREFIX + " shape probe   ./" + results.shape.path + " -> ignored=" + results.shape.ignored + " pattern=" + JSON.stringify(results.shape.pattern))
  console.log(PREFIX + " near-miss     ./" + results.nearMiss.path + " -> ignored=" + results.nearMiss.ignored + (results.nearMiss.ignored ? " (the shape swallowed a legitimate path!)" : " (visible, as required)"))
  for (const e of results.existing) console.log(PREFIX + " existing      ./" + e.path + " -> ignored=" + e.ignored + " pattern=" + JSON.stringify(e.pattern))
  console.log(PREFIX + (results.ok ? " ok: the shape ignores the .qa-* family and does NOT swallow the near-miss" : " FAIL - the shape and/or the near-miss behaved differently than the row requires"))
}
process.exit(results.ok ? 0 : 1)
