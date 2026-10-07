#!/usr/bin/env bun
// FALSIFIABILITY DRIVER for the t2 surfaces (frozen contract §4.2 barriers 1-5).
//
// Each barrier is removed from the REAL source with one textual mutation, the
// surface test suite is re-run, and the run MUST FAIL. The source is restored
// byte-for-byte after each mutation (sha256 verified), and the suite is re-run
// one last time to prove the restored tree is green. A mutation that does NOT
// redden the suite means the barrier is untested — this driver exits 1 then.
//
// Usage: bun evidence/tui/team-surface/<timestamp>/negative-control.mjs
import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { spawnSync } from "node:child_process"

const REPO = process.cwd()
const OUT = join(REPO, "evidence", "tui", "team-surface", "20260916T134707Z", "negative-control")
mkdirSync(OUT, { recursive: true })

const SCENES = join(REPO, "packages", "mpd-tui-plugin", "src", "scenes.ts")
const SUITE = "packages/mpd-tui-plugin/test/team-surface.test.ts"
const digest = (text) => "sha256:" + createHash("sha256").update(text).digest("hex")

const original = readFileSync(SCENES, "utf8")
const originalDigest = digest(original)

const runSuite = () => {
  const run = spawnSync("bun", ["test", SUITE], { cwd: REPO, encoding: "utf8" })
  return { status: run.status, output: (run.stdout ?? "") + (run.stderr ?? "") }
}

/** One barrier removal: a textual mutation that must make the suite red. */
const MUTATIONS = [
  {
    id: "B2-phrase-gate",
    barrier: "§4.2 barrier 2 — Ctrl+X is inert until the echo exactly equals `approve <teamId>`",
    from: '      if (phrase === "" || echo !== phrase) {',
    to: "      if (false) {",
    expectFailingTest: "N2",
  },
  {
    id: "B3-no-prefill",
    barrier: "§4.2 barrier 3 — the echo is EMPTY on every entry and on every refresh (never prefilled, never carried over)",
    from: '      setView(readWorkflow(workspaceRoot, holds))\n      // Barrier 3: the echo is EMPTY on every entry and on every explicit refresh.\n      setEcho("")\n',
    to: "      setView(readWorkflow(workspaceRoot, holds))\n",
    expectFailingTest: "no prefill",
  },
  {
    id: "B4-chord-only",
    barrier: "§4.2 barrier 4 — mutations are chords; a bare printable key is consent input",
    from: '          if (key?.ctrl === true && input === "x") {',
    to: '          if (input === "x") {',
    expectFailingTest: "Escape/keys",
  },
  {
    id: "B5-single-flight",
    barrier: "§4.2 barrier 5 — every key is ignored while a call is in flight",
    from: "          if (busy) return",
    to: "          if (false) return",
    expectFailingTest: "phrase",
  },
  {
    id: "B1-separate-surface",
    barrier: "§4.2 barrier 1 / §3.1 — the workflow scene refuses the approval hop for a non-staged team",
    from: "          if (!staged) {",
    to: "          if (false) {",
    expectFailingTest: "NOT staged",
  },
  {
    id: "B6-precondition-read-only",
    barrier: "§3.2 — the precondition failure accepts ONLY Esc (a non-staged team is never archivable)",
    from: "          if (!usable) {",
    to: "          if (false) {",
    expectFailingTest: "READ-ONLY",
  },
]

const results = []
let ok = true

for (const mutation of MUTATIONS) {
  if (!original.includes(mutation.from)) {
    results.push({ ...mutation, applied: false, suiteStatus: null, reddened: false, note: "anchor not found — mutation NOT applied" })
    ok = false
    continue
  }
  const mutated = original.replace(mutation.from, mutation.to)
  writeFileSync(SCENES, mutated)
  const run = runSuite()
  writeFileSync(join(OUT, `${mutation.id}.log`), run.output)
  writeFileSync(SCENES, original)
  const restored = readFileSync(SCENES, "utf8")
  const restoredOk = digest(restored) === originalDigest
  const reddened = run.status !== 0
  const namesRed = (run.output.match(/\(fail\)/g) ?? []).length
  results.push({
    id: mutation.id,
    barrier: mutation.barrier,
    applied: true,
    from: mutation.from,
    to: mutation.to,
    suiteStatus: run.status,
    failingTests: namesRed,
    expectFailingTest: mutation.expectFailingTest,
    reddened,
    restoredByteIdentical: restoredOk,
    note: reddened ? "the suite REDDENED as required" : "THE SUITE STAYED GREEN — this barrier is untested",
  })
  if (!reddened || !restoredOk) ok = false
}

const final = runSuite()
writeFileSync(join(OUT, "final.log"), final.output)
if (final.status !== 0) ok = false

const payload = {
  slug: "tui-team-surface-negative-control",
  task: "t2",
  producedAt: new Date().toISOString(),
  target: "packages/mpd-tui-plugin/src/scenes.ts",
  originalDigest,
  restoredDigest: digest(readFileSync(SCENES, "utf8")),
  suite: SUITE,
  mutations: results,
  finalSuiteStatus: final.status,
  ok,
  note: "Every barrier removal must make the surface suite red, and the source must come back byte-identical.",
}
writeFileSync(join(OUT, "result.json"), JSON.stringify(payload, null, 2) + "\n")
console.log(`[negative-control] ok=${ok} restored=${payload.restoredDigest === originalDigest} finalSuite=${final.status}`)
for (const entry of results) console.log(`  ${entry.id}: applied=${entry.applied} reddened=${entry.reddened} restored=${entry.restoredByteIdentical} failingTests=${entry.failingTests ?? 0}`)
process.exit(ok ? 0 : 1)
