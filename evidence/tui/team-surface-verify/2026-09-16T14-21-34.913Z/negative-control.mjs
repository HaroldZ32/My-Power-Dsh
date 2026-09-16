#!/usr/bin/env bun
// NEGATIVE CONTROL for t8 (t3's F1: the committed-approval verdict must be visible).
//
// One mutation removes the verdict render from the plan scene's non-usable branch.
// The driver reports the failing-test COUNT before and after, and the failing test
// NAMES, and it fails unless BOTH hold:
//   * the mutation reddens the suite, and
//   * every red test belongs to the NEW t8 describe block (nothing else was disturbed).
// The source is restored byte-for-byte (sha256) and the suite is re-run green.
//
// Usage: bun evidence/tui/team-surface-verify/<timestamp>/negative-control.mjs
import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { spawnSync } from "node:child_process"

const REPO = process.cwd()
const OUT = join(REPO, "evidence", "tui", "team-surface-verify", "2026-09-16T14-21-34.913Z", "negative-control")
mkdirSync(OUT, { recursive: true })

const SCENES = join(REPO, "packages", "mpd-tui-plugin", "src", "scenes.ts")
const SUITE = "packages/mpd-tui-plugin/test/team-surface.test.ts"
const digest = (text) => "sha256:" + createHash("sha256").update(text).digest("hex")

const original = readFileSync(SCENES, "utf8")
const originalDigest = digest(original)

const MUTATION = {
  id: "T8-remove-the-verdict-render",
  removes: "the non-usable branch's verdict render (the `if (verdict)` arm)",
  from: "      if (verdict) {",
  to: "      if (false) {",
}

const runSuite = () => {
  const run = spawnSync("bun", ["test", SUITE], { cwd: REPO, encoding: "utf8" })
  const output = (run.stdout ?? "") + (run.stderr ?? "")
  // bun prints each failure at its site AND in the closing summary: de-duplicate by name.
  const failing = [
    ...new Set(
      output
        .split("\n")
        .filter((line) => line.startsWith("(fail)"))
        .map((line) => line.replace(/^\(fail\)\s*/u, "").replace(/\s*\[\d+(\.\d+)?ms\]\s*$/u, "").trim()),
    ),
  ]
  const counts = /(\d+) pass\b/.exec(output)
  return { status: run.status, output, failing, passCount: counts === undefined ? undefined : Number(counts[1]) }
}

const before = runSuite()
writeFileSync(join(OUT, "before.log"), before.output)

if (!original.includes(MUTATION.from)) {
  const payload = { ok: false, error: "mutation anchor not found — the control cannot be applied", mutation: MUTATION }
  writeFileSync(join(OUT, "result.json"), JSON.stringify(payload, null, 2) + "\n")
  console.log("[t8-control] FAIL: anchor not found")
  process.exit(1)
}

writeFileSync(SCENES, original.replace(MUTATION.from, MUTATION.to))
const after = runSuite()
writeFileSync(join(OUT, "mutated.log"), after.output)
writeFileSync(SCENES, original)
const restored = runSuite()
writeFileSync(join(OUT, "restored.log"), restored.output)

const restoredOk = digest(readFileSync(SCENES, "utf8")) === originalDigest
const newTests = new Set(before.failing)
const verdictTests = after.failing.filter((name) => name.includes("a COMMITTED approval is confirmed on screen"))
const foreign = after.failing.filter((name) => !name.includes("a COMMITTED approval is confirmed on screen"))

const payload = {
  slug: "tui-team-surface-verify-t8-negative-control",
  task: "t8",
  producedAt: new Date().toISOString(),
  target: "packages/mpd-tui-plugin/src/scenes.ts",
  originalDigest,
  mutation: MUTATION,
  suite: SUITE,
  before: { exitCode: before.status, failureCount: before.failing.length, failing: before.failing, passCount: before.passCount },
  afterMutation: { exitCode: after.status, failureCount: after.failing.length, failing: after.failing, passCount: after.passCount },
  restored: { exitCode: restored.status, failureCount: restored.failing.length, passCount: restored.passCount, byteIdentical: restoredOk },
  verdictTestsReddened: verdictTests,
  unrelatedTestsReddened: foreign,
  redCountBefore: before.failing.length,
  redCountAfter: after.failing.length,
  ok: before.status === 0 && after.status !== 0 && restored.status === 0 && restoredOk && verdictTests.length > 0 && foreign.length === 0 && newTests.size === 0,
  note: "The mutation must redden ONLY the new t8 verdict tests; the restored tree must be green and byte-identical.",
}
writeFileSync(join(OUT, "result.json"), JSON.stringify(payload, null, 2) + "\n")
console.log(`[t8-control] red before=${payload.redCountBefore} after=${payload.redCountAfter} ok=${payload.ok}`)
for (const name of after.failing) console.log(`  RED: ${name}`)
process.exit(payload.ok ? 0 : 1)
