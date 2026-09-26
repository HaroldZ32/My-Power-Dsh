#!/usr/bin/env node
// t16 mutation control: prove the new schema tests are FALSIFIABLE.
//
// `apply` restores the RETIRED return shape — `planFile` emitted unconditionally, so it is
// `null` whenever plan=false (the defect the harness refused) — and the suite must then go
// RED on the declared-schema test. `restore` puts the verified fixed bytes back; the caller
// confirms the sha256 is unchanged. Refuses to run when its anchor is absent.
import { copyFileSync, readFileSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { join } from "node:path"

const REPO = "/root/dshProj/my-power-dsh"
const TARGET = join(REPO, "packages", "mpd-ulw-plugin", "src", "index.ts")
const SNAPSHOT = join(REPO, "evidence", "ulw", "l2c-schema-fix", "20260918T015142Z", "index.ts.fixed")

const FIXED = "      return { status, rounds: used, ...(planFile === null ? {} : { planFile }), verdict, ledger: gateLedger, finalReport, stateFile }"
const RETIRED = "      return { status, rounds: used, planFile, verdict, ledger: gateLedger, finalReport, stateFile }"

function sha256(text) {
  return createHash("sha256").update(text).digest("hex")
}

const mode = process.argv[2]
if (mode === "apply") {
  const source = readFileSync(TARGET, "utf8")
  if (!source.includes(FIXED)) {
    console.error("MUTATION ANCHOR ABSENT — refusing to mutate (the fixed return is not in the file)")
    process.exit(2)
  }
  writeFileSync(TARGET, source.replace(FIXED, RETIRED))
  console.log("mutation applied: planFile is emitted unconditionally again (retired t16 shape)")
  console.log("sha256 now " + sha256(readFileSync(TARGET, "utf8")))
} else if (mode === "restore") {
  copyFileSync(SNAPSHOT, TARGET)
  console.log("restored from " + SNAPSHOT)
  console.log("sha256 now " + sha256(readFileSync(TARGET, "utf8")))
} else {
  console.error("usage: mutation-control.mjs apply|restore")
  process.exit(2)
}
