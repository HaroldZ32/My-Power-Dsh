#!/usr/bin/env bun
// FALSIFIABILITY DRIVER — repair round 2 (task t6).
//
// Two families of mutations, each applied to the REAL source, each followed by the
// surface suite, each of which MUST come back red. The source is restored
// byte-for-byte after every mutation (sha256 verified) and the suite is re-run at the
// end to prove the restored tree is green.
//
//   B1..B6 — the frozen §4.2/§3.2 accidental-approval barriers (t2's record, re-run here)
//   R1..R3 — the three t4 findings this repair closes (F1 §9.4, F2 §3.1 item 4, F3 §4.5)
//
// A mutation that does NOT redden the suite means the behaviour is untested — the
// driver exits 1 then. Usage: bun evidence/tui/team-surface/<timestamp>/negative-control.mjs
import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { spawnSync } from "node:child_process"

const REPO = process.cwd()
const OUT = join(REPO, "evidence", "tui", "team-surface", "20260916T140135Z", "negative-control")
mkdirSync(OUT, { recursive: true })

const FILES = {
  scenes: join(REPO, "packages", "mpd-tui-plugin", "src", "scenes.ts"),
  teamState: join(REPO, "packages", "mpd-tui-plugin", "src", "team-state.ts"),
}
const SUITE = "packages/mpd-tui-plugin/test/team-surface.test.ts"
const digest = (text) => "sha256:" + createHash("sha256").update(text).digest("hex")

const originals = {}
const originalDigests = {}
for (const [key, path] of Object.entries(FILES)) {
  originals[key] = readFileSync(path, "utf8")
  originalDigests[key] = digest(originals[key])
}

const runSuite = () => {
  const run = spawnSync("bun", ["test", SUITE], { cwd: REPO, encoding: "utf8" })
  return { status: run.status, output: (run.stdout ?? "") + (run.stderr ?? "") }
}

const MUTATIONS = [
  {
    id: "B1-separate-surface",
    family: "barrier",
    file: "scenes",
    barrier: "§4.2 barrier 1 / §3.1 — the workflow scene refuses the approval hop for a non-staged team",
    from: "          if (!staged) {",
    to: "          if (false) {",
  },
  {
    id: "B2-phrase-gate",
    family: "barrier",
    file: "scenes",
    barrier: "§4.2 barrier 2 — Ctrl+X is inert until the echo exactly equals `approve <teamId>`",
    from: '      if (phrase === "" || echo !== phrase) {',
    to: "      if (false) {",
  },
  {
    id: "B3-no-prefill",
    family: "barrier",
    file: "scenes",
    barrier: "§4.2 barrier 3 — the echo is EMPTY on every entry and on every refresh",
    from: '      setView(readWorkflow(workspaceRoot, holds))\n      // Barrier 3: the echo is EMPTY on every entry and on every explicit refresh.\n      setEcho("")\n',
    to: "      setView(readWorkflow(workspaceRoot, holds))\n",
  },
  {
    id: "B4-chord-only",
    family: "barrier",
    file: "scenes",
    barrier: "§4.2 barrier 4 — mutations are chords; a bare printable key is consent input",
    from: '          if (key?.ctrl === true && input === "x") {',
    to: '          if (input === "x") {',
  },
  {
    id: "B5-single-flight",
    family: "barrier",
    file: "scenes",
    barrier: "§4.2 barrier 5 — every key is ignored while a call is in flight",
    from: "          if (busy) return",
    to: "          if (false) return",
  },
  {
    id: "B6-precondition-read-only",
    family: "barrier",
    file: "scenes",
    barrier: "§3.2 — the precondition failure accepts ONLY Esc (a non-staged team is never archivable)",
    from: "          if (!usable) {",
    to: "          if (false) {",
  },
  {
    id: "R1-9.4-render-boundary",
    family: "repair",
    file: "scenes",
    barrier: "F1 / §9.4 — the ONE render boundary strips control characters and clamps cells",
    from: 'export function safeLine(value: unknown): string {\n  const raw = typeof value === "string" ? value : String(value ?? "")\n  return clampCells(stripControl(raw), SCENE_ROW_MAX_CELLS)\n}',
    to: 'export function safeLine(value: unknown): string {\n  return typeof value === "string" ? value : String(value ?? "")\n}',
  },
  {
    id: "R2-dag-depth-order",
    family: "repair",
    file: "teamState",
    barrier: "F2 / §3.1 item 4 — the DAG is ordered by depth then creation order",
    from: "  tasks.sort((left, right) => left.depth - right.depth || (creationIndex.get(left.id) ?? 0) - (creationIndex.get(right.id) ?? 0))",
    to: "  void creationIndex",
  },
  {
    id: "R3-echo-kept-on-refusal",
    family: "repair",
    file: "scenes",
    barrier: "F3 / §4.5 — a refused approve keeps the consent echo",
    from: '        setBusy(false)\n        setView(readWorkflow(workspaceRoot, holds))\n      }\n    }\n\n    const runDiscard',
    to: '        setBusy(false)\n        setEcho("")\n        setView(readWorkflow(workspaceRoot, holds))\n      }\n    }\n\n    const runDiscard',
  },
]

const results = []
let ok = true

for (const mutation of MUTATIONS) {
  const path = FILES[mutation.file]
  const original = originals[mutation.file]
  if (!original.includes(mutation.from)) {
    results.push({ ...mutation, applied: false, suiteStatus: null, reddened: false, note: "anchor not found — mutation NOT applied" })
    ok = false
    continue
  }
  writeFileSync(path, original.replace(mutation.from, mutation.to))
  const run = runSuite()
  writeFileSync(join(OUT, `${mutation.id}.log`), run.output)
  writeFileSync(path, original)
  const restoredOk = digest(readFileSync(path, "utf8")) === originalDigests[mutation.file]
  const reddened = run.status !== 0
  results.push({
    id: mutation.id,
    family: mutation.family,
    file: mutation.file,
    barrier: mutation.barrier,
    applied: true,
    suiteStatus: run.status,
    failingTests: (run.output.match(/\(fail\)/g) ?? []).length,
    reddened,
    restoredByteIdentical: restoredOk,
    note: reddened ? "the suite REDDENED as required" : "THE SUITE STAYED GREEN — this behaviour is untested",
  })
  if (!reddened || !restoredOk) ok = false
}

const final = runSuite()
writeFileSync(join(OUT, "final.log"), final.output)
if (final.status !== 0) ok = false

const payload = {
  slug: "tui-team-surface-negative-control-repair2",
  task: "t6",
  producedAt: new Date().toISOString(),
  targets: { scenes: "packages/mpd-tui-plugin/src/scenes.ts", teamState: "packages/mpd-tui-plugin/src/team-state.ts" },
  originalDigests,
  restoredDigests: Object.fromEntries(Object.entries(FILES).map(([key, path]) => [key, digest(readFileSync(path, "utf8"))])),
  suite: SUITE,
  mutations: results,
  finalSuiteStatus: final.status,
  ok,
  note: "Every barrier AND every repaired behaviour must make the surface suite red when removed, and the source must come back byte-identical.",
}
writeFileSync(join(OUT, "result.json"), JSON.stringify(payload, null, 2) + "\n")
console.log(`[negative-control] ok=${ok} finalSuite=${final.status}`)
for (const entry of results) console.log(`  ${entry.id}: applied=${entry.applied} reddened=${entry.reddened} restored=${entry.restoredByteIdentical} failingTests=${entry.failingTests ?? 0}`)
process.exit(ok ? 0 : 1)
