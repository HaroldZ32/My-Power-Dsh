#!/usr/bin/env bun
// t5 gate sweep — the wave's full verify set on ONE frozen revision (task t5, acceptance #3).
//
// Records, per gate: the literal command, its exit code, and the FULL output (not a tail) so a
// reader can re-derive every claim. Two readings are recorded for `bun test packages` TOGETHER
// (repo cwd and a clean cwd): the captain's standing waiver
// (evidence/extensions/integration-ledger/20260916T071414Z/delivery-ledger.md §10) replaces the
// repo-cwd invocation with the clean-cwd one, and citing only the green reading would misreport
// the tree.
//
// `test:qa` is run TWICE on purpose: once as the contract's literal command (which stops at the
// first failing self-test — the un-re-pinned corpus gate) and once as a per-script sweep that
// records EVERY script's own exit code, so "no other self-test fails" is measured rather than
// inferred from an early abort.
//
// Usage: bun evidence/tui/team-surface-integrate/<ts>/run-gates.mjs
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"

const REPO = process.cwd()
const OUT = join(REPO, "evidence", "tui", "team-surface-integrate", "2026-09-16T14-17-24.000Z")
const RAW = join(OUT, "raw")
mkdirSync(RAW, { recursive: true })

const sha = (rel) => {
  try {
    return createHash("sha256").update(readFileSync(join(REPO, rel))).digest("hex")
  } catch (error) {
    return `unreadable: ${String(error)}`
  }
}

// The frozen revision: every artifact this sweep's claims depend on, pinned by digest.
const REVISION = {
  pinnedAt: new Date().toISOString(),
  repoRoot: REPO,
  branch: spawnSync("git", ["branch", "--show-current"], { encoding: "utf8" }).stdout.trim(),
  files: Object.fromEntries(
    [
      "packages/mpd-tui-plugin/dist/index.js",
      "packages/mpd-tui-plugin/src/scenes.ts",
      "packages/mpd-tui-plugin/src/team-state.ts",
      "packages/mpd-tui-plugin/src/state.ts",
      "packages/mpd-tui-plugin/src/sanitize.ts",
      "packages/mpd-tui-plugin/src/commands.ts",
      "packages/mpd-tui-plugin/src/command-trees.ts",
      "packages/mpd-tui-plugin/src/shortcuts.ts",
      "packages/mpd-dsh-adapter-plugin/src/index.ts",
      "packages/mpd-dsh-adapter-plugin/dist/index.js",
      "skills/dsh-qa/scripts/tui-team-surface.mjs",
      "skills/dsh-qa/scripts/lib/tui-lane.mjs",
      "skills/dsh-qa/SKILL.md",
      "VENDOR_LOCK.json",
    ].map((rel) => [rel, sha(rel)]),
  ),
}
writeFileSync(join(OUT, "REVISION.json"), JSON.stringify(REVISION, null, 2) + "\n")

const run = (bin, args, options = {}) => {
  const started = Date.now()
  const result = spawnSync(bin, args, { cwd: REPO, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...options })
  return {
    status: result.status,
    output: (result.stdout ?? "") + (result.stderr ?? ""),
    ms: Date.now() - started,
  }
}

const records = []
const gate = (id, command, bin, args, options = {}) => {
  process.stdout.write(`[gate] ${command} … `)
  const r = run(bin, args, options)
  writeFileSync(join(RAW, `${id}.log`), r.output)
  records.push({ id, command, exitCode: r.status, ms: r.ms, log: `raw/${id}.log` })
  console.log(`exit ${r.status} (${r.ms} ms)`)
  return r
}

// --- 1. the contract's literal verify commands -------------------------------------------------
gate("typecheck", "bun run typecheck", "bun", ["run", "typecheck"])
gate("verify-docs", "bun run verify:docs", "bun", ["run", "verify:docs"])
const repoCwdSuite = gate("bun-test-packages", "bun test packages", "bun", ["test", "packages"])
gate("delta-check", "node scripts/patch-agent-teams-fixes.mjs --check", "node", ["scripts/patch-agent-teams-fixes.mjs", "--check"])
const vendor = gate("verify-vendor", "node scripts/verify-vendor.mjs", "node", ["scripts/verify-vendor.mjs"])
gate("fingerprint", "node evidence/tui/team-surface-integrate/2026-09-16T14-17-24.000Z/fingerprint.mjs", "node", [
  "evidence/tui/team-surface-integrate/2026-09-16T14-17-24.000Z/fingerprint.mjs",
])
const testQa = gate("test-qa", "bun run test:qa", "bun", ["run", "test:qa"])

// --- 2. the clean-cwd reading of the same suite (the waiver's replacement) ---------------------
const cleanCwd = mkdtempSync(join(tmpdir(), "mpd-t5-clean-cwd-"))
const cleanSuite = gate("bun-test-packages-clean-cwd", `cd <clean-cwd> && bun test ${join(REPO, "packages")}`, "bun", ["test", join(REPO, "packages")], { cwd: cleanCwd })

// --- 3. the per-script self-test sweep (is the lock gate the ONLY red?) ------------------------
const listScripts = spawnSync("bash", ["-c", "ls skills/dsh-qa/scripts/*.mjs"], { encoding: "utf8" })
const scripts = listScripts.stdout.trim().split("\n").filter(Boolean)
const selfTests = []
for (const script of scripts) {
  const rel = script.replace(REPO + "/", "")
  const r = spawnSync("bun", [rel, "--self-test"], { cwd: REPO, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  const output = (r.stdout ?? "") + (r.stderr ?? "")
  const failed = r.status !== 0
  selfTests.push({ script: rel, exitCode: r.status, failed, tail: output.trim().split("\n").slice(-3).join(" | ").slice(0, 400) })
  if (failed) writeFileSync(join(RAW, `selftest-failed-${rel.replace(/[^a-z0-9]+/gi, "-")}.log`), output)
  process.stdout.write(failed ? "F" : ".")
}
console.log("")

// --- 4. the TUI lanes -------------------------------------------------------------------------
const LANES = [
  "skills/dsh-qa/scripts/tui-mount.mjs",
  "skills/dsh-qa/scripts/tui-panels.mjs",
  "skills/dsh-qa/scripts/tui-admission.mjs",
  "skills/dsh-qa/scripts/tui-distribution.mjs",
  "skills/dsh-qa/scripts/tui-spec-conformance.mjs",
  "skills/dsh-qa/scripts/tui-settings-bridge.mjs",
  "skills/dsh-qa/scripts/web-settings-bridge.mjs",
  "skills/dsh-qa/scripts/tui-team-surface.mjs",
]
for (const lane of LANES) {
  gate(lane.replace(/^.*\//, "").replace(/\.mjs$/, ""), `node ${lane}`, "node", [lane])
}

const tail = (text, n) => text.trim().split("\n").slice(-n).join("\n")
const driftLines = vendor.output.split("\n").filter((l) => /stale|drift|mismatch|FAIL|PASS/i.test(l))

const payload = {
  slug: "tui-team-surface-integrate-gates",
  task: "t5",
  producedAt: new Date().toISOString(),
  revision: REVISION,
  gates: records,
  bunTestPackages: {
    repoCwd: { command: "bun test packages", exitCode: repoCwdSuite.status, tail: tail(repoCwdSuite.output, 8) },
    cleanCwd: { command: `cd <mktemp> && bun test ${join(REPO, "packages")}`, exitCode: cleanSuite.status, tail: tail(cleanSuite.output, 8) },
    whyBoth: "the captain's standing waiver records the clean-cwd reading as the replacement; both readings are reported together, never the green one alone",
  },
  verifyVendor: {
    command: "node scripts/verify-vendor.mjs",
    exitCode: vendor.status,
    driftLines,
    expectedBecause: "the wave's skills/** change invalidates the corpus treeSha; VENDOR_LOCK.json is out of this task's scope and must be re-pinned by the captain in the same commit (AGENTS.md §9/§11)",
    otherAssetFailures: vendor.output.split("\n").filter((l) => /^FAIL/.test(l) && !/skills/.test(l)),
  },
  testQa: {
    command: "bun run test:qa",
    exitCode: testQa.status,
    lastLines: tail(testQa.output, 6),
  },
  selfTestSweep: {
    total: selfTests.length,
    failed: selfTests.filter((t) => t.failed),
    note: "test:qa aborts at its first failing self-test; this sweep ran EVERY self-test so 'the corpus gate is the only red' is measured",
  },
  tuiLanes: records.filter((r) => LANES.some((l) => l.endsWith(`${r.id}.mjs`))),
  cleanCwdUsed: cleanCwd,
}
writeFileSync(join(OUT, "gates.result.json"), JSON.stringify(payload, null, 2) + "\n")
console.log(`\n[sweep] wrote ${join(OUT, "gates.result.json")}`)
console.log(`[sweep] verify-vendor exit ${vendor.status}; test:qa exit ${testQa.status}; self-test failures ${payload.selfTestSweep.failed.length}`)
