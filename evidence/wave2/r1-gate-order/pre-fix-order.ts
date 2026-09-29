#!/usr/bin/env node
// R1 negative-control driver: deterministically flip packages/mpd-verif-plugin/
// src/regress.ts to the PRE-FIX ordering (work dir created before the cocotb
// iron gate) and back, so the order-pinning tests can be shown to FAIL against
// the old order and PASS against the fix.
//
//   node pre-fix-order.mjs --apply     mutate src/regress.ts to the pre-fix order
//   node pre-fix-order.mjs --restore   restore the fixed source from the backup
//
// The transformation is anchored on exact source lines (no regex guessing) and
// every step asserts its own precondition, so it can never half-apply silently.
import { copyFileSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..")
const srcPath = join(repoRoot, "packages", "mpd-verif-plugin", "src", "regress.ts")
const bakPath = srcPath + ".r1pre.bak"
const MARKER = "  const regressDir = createRegressDir(exec) // PRE-FIX ORDER SIMULATION"
const SEED_ANCHOR = "  const seedBase = args.seedBase ?? dateSeedBase()"
const LANE_LINE = "\n  const regressDir = createRegressDir(exec)\n"

const mode = process.argv[2]
const fail = (msg) => { console.error("R1-DRIVER-ERROR: " + msg); process.exit(1) }

if (mode === "--apply") {
  if (existsSync(bakPath)) fail("backup already exists — refusing to apply twice (run --restore first)")
  const text = readFileSync(srcPath, "utf8")
  if (text.includes(MARKER)) fail("source already carries the pre-fix marker")
  if (!text.includes(SEED_ANCHOR)) fail("seed anchor not found")
  const laneIdx = text.indexOf(LANE_LINE)
  if (laneIdx === -1) fail("post-gate `createRegressDir` line not found")
  if (text.indexOf(LANE_LINE, laneIdx + 1) !== -1) fail("ambiguous: more than one 2-space createRegressDir line")
  copyFileSync(srcPath, bakPath)
  const mutated = text
    .replace(LANE_LINE, "\n") // drop the post-gate creation (cocotb lane)
    .replace(SEED_ANCHOR, SEED_ANCHOR + "\n" + MARKER)
  if (!mutated.includes(MARKER)) fail("insertion failed")
  writeFileSync(srcPath, mutated)
  console.log("applied pre-fix order simulation (backup: " + bakPath + ")")
} else if (mode === "--restore") {
  if (!existsSync(bakPath)) fail("no backup to restore from — source was not mutated by this driver")
  copyFileSync(bakPath, srcPath)
  rmSync(bakPath)
  console.log("restored fixed source from backup")
} else {
  fail("usage: pre-fix-order.mjs --apply|--restore")
}
