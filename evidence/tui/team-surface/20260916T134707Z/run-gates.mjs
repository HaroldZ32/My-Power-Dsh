#!/usr/bin/env bun
// Gate sweep for t2: runs every verify command of the task contract in order and
// records the exit code plus the tail of each output. It ALSO records the
// falsification of the two `bun test packages` failures: the same failing test
// file, re-run from a cwd that has no `.mpd/mpd.jsonc`, is green — proving the
// failures are environment-conditioned (this checkout's own session artifact) and
// not caused by the changed packages.
//
// Usage: bun evidence/tui/team-surface/<timestamp>/run-gates.mjs
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { spawnSync } from "node:child_process"

const REPO = process.cwd()
const OUT = join(REPO, "evidence", "tui", "team-surface", "20260916T134707Z")
mkdirSync(OUT, { recursive: true })

const GATES = [
  { id: "bun-test-packages", command: "bun test packages", argv: ["test", "packages"] },
  { id: "typecheck", command: "bun run typecheck", argv: ["run", "typecheck"] },
  { id: "tui-mount", command: "node skills/dsh-qa/scripts/tui-mount.mjs", argv: ["../node_modules/.bin/../../skills/dsh-qa/scripts/tui-mount.mjs"] },
  { id: "tui-panels", command: "node skills/dsh-qa/scripts/tui-panels.mjs", argv: [] },
  { id: "tui-spec-conformance", command: "node skills/dsh-qa/scripts/tui-spec-conformance.mjs", argv: [] },
]
void GATES

const run = (bin, args, options = {}) => {
  const result = spawnSync(bin, args, { cwd: REPO, encoding: "utf8", ...options })
  return { status: result.status, output: (result.stdout ?? "") + (result.stderr ?? "") }
}

const records = []
const sweep = [
  { id: "bun-test-packages", command: "bun test packages", bin: "bun", args: ["test", "packages"] },
  { id: "typecheck", command: "bun run typecheck", bin: "bun", args: ["run", "typecheck"] },
  { id: "tui-mount", command: "node skills/dsh-qa/scripts/tui-mount.mjs", bin: "node", args: ["skills/dsh-qa/scripts/tui-mount.mjs"] },
  { id: "tui-panels", command: "node skills/dsh-qa/scripts/tui-panels.mjs", bin: "node", args: ["skills/dsh-qa/scripts/tui-panels.mjs"] },
  { id: "tui-spec-conformance", command: "node skills/dsh-qa/scripts/tui-spec-conformance.mjs", bin: "node", args: ["skills/dsh-qa/scripts/tui-spec-conformance.mjs"] },
]

for (const gate of sweep) {
  const result = run(gate.bin, gate.args)
  writeFileSync(join(OUT, `${gate.id}.log`), result.output)
  const tail = result.output.trim().split("\n").slice(-6).join("\n")
  records.push({ ...gate, exitCode: result.status, tail })
  console.log(`[gate] ${gate.command} -> exit ${result.status}`)
}

// The environment-conditioned failure, falsified TWICE: same file from a clean cwd, and
// the WHOLE test set from a clean cwd. The latter is the captain's standing WAIVED-GATE
// replacement for the repo-cwd invocation (see `waiver` below).
const cleanCwd = "/tmp/mpd-t2-clean-cwd"
mkdirSync(cleanCwd, { recursive: true })
const control = run("bun", ["test", join(REPO, "packages/mpd-config-plugin/test/settings-wiring.test.ts")], { cwd: cleanCwd })
writeFileSync(join(OUT, "bun-test-packages.clean-cwd-control.log"), control.output)
console.log(`[gate] control: same config test from a clean cwd -> exit ${control.status}`)

const cleanFull = run("bun", ["test", join(REPO, "packages")], { cwd: cleanCwd })
writeFileSync(join(OUT, "bun-test-packages.clean-cwd-full.log"), cleanFull.output)
console.log(`[gate] control: the WHOLE suite from a clean cwd -> exit ${cleanFull.status}`)

const payload = {
  slug: "tui-team-surface-gates",
  task: "t2",
  producedAt: new Date().toISOString(),
  repoRoot: REPO,
  gates: records,
  control: {
    why: "the two repo-cwd `bun test packages` failures are in packages/mpd-config-plugin, which this task did not touch",
    command: `cd ${cleanCwd} && bun test ${join(REPO, "packages/mpd-config-plugin/test/settings-wiring.test.ts")}`,
    exitCode: control.status,
    tail: control.output.trim().split("\n").slice(-4).join("\n"),
  },
  cleanCwdFullSuite: {
    command: `cd ${cleanCwd} && bun test ${join(REPO, "packages")}`,
    exitCode: cleanFull.status,
    tail: cleanFull.output.trim().split("\n").slice(-5).join("\n"),
    sameTestCount: /Ran 791 tests/.test(cleanFull.output),
  },
  waiver: {
    ruling: "WAIVED GATE (a): `bun test packages` from the REPO cwd is excluded from the verify list; the clean-cwd invocation replaces it",
    source: "evidence/extensions/integration-ledger/20260916T071414Z/delivery-ledger.md §10 (captain ruling)",
    reason:
      "two PRE-EXISTING, non-hermetic assertions in packages/mpd-config-plugin/test/settings-wiring.test.ts assume <cwd>/.mpd/mpd.jsonc does not exist, while this workspace deliberately HAS that gitignored file",
  },
  ok:
    records.filter((record) => record.id !== "bun-test-packages").every((record) => record.exitCode === 0) &&
    control.status === 0 &&
    cleanFull.status === 0,
}
writeFileSync(join(OUT, "gates.result.json"), JSON.stringify(payload, null, 2) + "\n")
console.log(`[gates] ok=${payload.ok}`)
process.exit(payload.ok ? 0 : 1)
