#!/usr/bin/env node
// t18 mutation control: prove the new blocked-on-FAIL test is FALSIFIABLE.
//
// `apply` neutralizes the engine's blocking rule (a FAIL quality-gate lane no longer sets
// status = "blocked"), so the new test must go RED; `restore` puts the verified bytes back.
// Refuses to run when its anchor is absent.
import { copyFileSync, readFileSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { join } from "node:path"

const REPO = "/root/dshProj/my-power-dsh"
const TARGET = join(REPO, "packages", "mpd-ulw-plugin", "src", "index.ts")
const SNAPSHOT = join(REPO, "evidence", "ulw", "l2d-review-repairs", "t18-20260918T015650Z", "index.ts.t18fixed")

const FIXED = '        if (gateLedger.some((l) => l.verdict === "FAIL")) status = "blocked"'
const MUTATED = '        if (false && gateLedger.some((l) => l.verdict === "FAIL")) status = "blocked" // MUTATION: blocking disabled'

const sha256 = (text) => createHash("sha256").update(text).digest("hex")
const mode = process.argv[2]
if (mode === "apply") {
  const source = readFileSync(TARGET, "utf8")
  if (!source.includes(FIXED)) {
    console.error("MUTATION ANCHOR ABSENT — refusing to mutate")
    process.exit(2)
  }
  writeFileSync(TARGET, source.replace(FIXED, MUTATED))
  console.log("mutation applied: a FAIL quality-gate lane no longer blocks the run")
  console.log("sha256 now " + sha256(readFileSync(TARGET, "utf8")))
} else if (mode === "restore") {
  copyFileSync(SNAPSHOT, TARGET)
  console.log("restored from " + SNAPSHOT)
  console.log("sha256 now " + sha256(readFileSync(TARGET, "utf8")))
} else {
  console.error("usage: mutation-control.mjs apply|restore")
  process.exit(2)
}
