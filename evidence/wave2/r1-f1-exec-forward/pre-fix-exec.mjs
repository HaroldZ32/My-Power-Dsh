#!/usr/bin/env node
// R1-F1 negative-control driver: deterministically flip
// packages/mpd-verif-plugin/src/regress.ts back to the PRE-FIX call shape
// (`verifSim({...}, {})` — exec not forwarded) and back, so the argument-pinning
// test can be shown to FAIL against the old shape and PASS against the fix.
//
//   node pre-fix-exec.mjs --apply     mutate src/regress.ts to the pre-fix shape
//   node pre-fix-exec.mjs --restore   restore the fixed source from the backup
//
// Every step asserts its own precondition, so it can never half-apply silently.
import { copyFileSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..")
const srcPath = join(repoRoot, "packages", "mpd-verif-plugin", "src", "regress.ts")
const bakPath = srcPath + ".r1f1pre.bak"
const FIXED = "      }, {}, exec)"
const PRE_FIX = "      }, {}) // PRE-FIX SIMULATION (exec not forwarded)"

const mode = process.argv[2]
const fail = (msg) => { console.error("R1-F1-DRIVER-ERROR: " + msg); process.exit(1) }

if (mode === "--apply") {
  if (existsSync(bakPath)) fail("backup already exists — refusing to apply twice (run --restore first)")
  const text = readFileSync(srcPath, "utf8")
  const first = text.indexOf(FIXED)
  if (first === -1) fail("fixed call shape `}, {}, exec)` not found — source is not in the post-fix state")
  if (text.indexOf(FIXED, first + 1) !== -1) fail("ambiguous: the fixed call shape appears more than once")
  copyFileSync(srcPath, bakPath)
  writeFileSync(srcPath, text.replace(FIXED, PRE_FIX))
  const after = readFileSync(srcPath, "utf8")
  if (!after.includes(PRE_FIX) || after.includes(FIXED)) fail("pre-fix simulation did not land cleanly")
  console.log("applied pre-fix call shape (backup: " + bakPath + ")")
} else if (mode === "--restore") {
  if (!existsSync(bakPath)) fail("no backup to restore from — source was not mutated by this driver")
  copyFileSync(bakPath, srcPath)
  rmSync(bakPath)
  const after = readFileSync(srcPath, "utf8")
  if (!after.includes(FIXED) || after.includes("PRE-FIX SIMULATION")) fail("restore did not reproduce the fixed source")
  console.log("restored fixed source (exec forwarded)")
} else {
  fail("usage: pre-fix-exec.mjs --apply|--restore")
}
