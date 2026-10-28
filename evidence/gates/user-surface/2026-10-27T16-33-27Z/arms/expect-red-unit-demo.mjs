#!/usr/bin/env node
// N3 (CodeRabbit, PR #75) — UNIT-LEVEL DEMO of the named-cause `--expect-red` gate.
//
// WHAT THIS PROVES, AND WHAT IT DOES NOT. It is NOT a boot: the three assertion sets below are HAND-BUILT
// to mirror what a real run records, and they are graded by the SAME exported `classifyExpectRed` the
// case's `--expect-red` branch calls (imported from the working tree, not copied). So the proof is
// unit-level: "a boot that SUCCEEDED but whose palette capture failed is not accepted as a detected
// stale install anchor" is decided by the exact function that decides it at run time, with no boot and
// no docker. The live counterpart is `../red/expect-red.json`, where the same function graded a REAL
// v0.15.5 stale-anchor boot and returned ok:true with `cause=stale-install-anchor…+profile-row-list-missing:mpd-cellwork`.
//
// Usage (from the repository root): node evidence/gates/user-surface/<stamp>/arms/expect-red-unit-demo.mjs
import { classifyExpectRed } from "../../../../../skills/dsh-qa/scripts/lib/user-surface-eval.ts"

/** The stale version the demonstration stages; the anchor must report exactly this. */
const TARGET = { staleVersion: "0.15.5", expectedRow: "mpd-cellwork" }

/** One assertion row in the shape the case records. */
const row = (name, ok, raw) => ({ name, ok, reason: ok ? "held" : "failed", raw })

/** The assertions of a boot that mounted correctly and whose palette was captured. */
const HEALTHY = [
  row("userSurface.probe", true, "loaderEntries=155 commands=33 tools=117"),
  row("userSurface.bundleResolution", true, "source=profile dir=/p version=0.16.1 profileVersion=0.16.1 sameCopyDigests=true"),
  row("userSurface.profileRowListWins", true, "profileRows=36 bootEntries=155 missing=-"),
  row("userSurface.rowsWitness", true, "failed=-"),
  row("userSurface.negativeControl", true, "aliveBefore=95 aliveAfter=95"),
]

/** A-1: the boot SUCCEEDED, the palette capture failed. The old branch called this "red as required". */
const PALETTE_BROKEN = [
  ...HEALTHY.filter((entry) => entry.name !== "userSurface.negativeControl"),
  row("userSurface.negativeControl", false, "aliveBefore=null aliveAfter=null"),
  row("userSurface.command.mpd", false, "registry=no palette=none (no palette box in the capture)"),
  row("userSurface.command.ulw", false, "registry=no palette=none (no palette box in the capture)"),
]

/** A-2: the boot crashed before the instrumentation row wrote its record. */
const BOOT_CRASHED = [
  row("userSurface.probe", false, "the instrumentation row wrote no record"),
  ...HEALTHY.filter((entry) => entry.name !== "userSurface.probe" && entry.name !== "userSurface.rowsWitness"),
  row("userSurface.rowsWitness", false, "failed=every-declared-row"),
]

/** B: the real reproduction — the anchor resolved the staged 0.15.5 copy and its row list omits mpd-cellwork. */
const NAMED_CAUSE = [
  row("userSurface.probe", true, "loaderEntries=154 commands=33 tools=117"),
  row("userSurface.command.mpd", true, "registry+palette"),
  row("userSurface.rowsWitness", false, "failed=mpd-cellwork"),
  row("userSurface.row.mpd-cellwork", false, "the boot's loader holds NO entry for it"),
  row("userSurface.command.cellwork", false, "neither the registry nor the palette carries it"),
  row("userSurface.profileRowListWins", false, "profileRows=36 bootEntries=154 missing=mpd-cellwork"),
  row("userSurface.bundleResolution", false, "source=install-anchor dir=/tmp/anchor/lib/node_modules/@mpd-dsh/mpd version=0.15.5 profileVersion=0.16.1 sameCopyDigests=false"),
]

/** The scenario list: each expectation is the exit-code contract `--expect-red` now implements. */
const SCENARIOS = [
  { id: "A-1 palette-capture-failed (boot SUCCEEDED)", assertions: PALETTE_BROKEN, problems: [], expectOk: false },
  { id: "A-2 boot-crash (no probe record)", assertions: BOOT_CRASHED, problems: [], expectOk: false },
  { id: "B named stale-anchor cause", assertions: NAMED_CAUSE, problems: [], expectOk: true },
]

let failed = 0
for (const scenario of SCENARIOS) {
  const verdict = classifyExpectRed(scenario.assertions, scenario.problems, TARGET)
  const held = verdict.ok === scenario.expectOk
  if (!held) failed += 1
  console.log("== " + scenario.id + " -> expect ok=" + String(scenario.expectOk) + " got ok=" + String(verdict.ok) + " :: " + (held ? "HELD" : "FAIL"))
  console.log("   cause=" + (verdict.cause === "" ? "-" : verdict.cause))
  console.log("   sentence=" + verdict.sentence)
  console.log("   unexplained=" + (verdict.unexplained.join(",") || "-"))
  console.log("   exit-code-as---expect-red=" + (verdict.ok ? 0 : 1))
}
console.log("scenarios=" + String(SCENARIOS.length) + " failed=" + String(failed))
process.exit(failed === 0 ? 0 : 1)
