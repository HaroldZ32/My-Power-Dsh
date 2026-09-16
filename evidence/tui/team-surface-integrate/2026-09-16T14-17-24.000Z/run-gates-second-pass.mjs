#!/usr/bin/env bun
// t5 gate sweep, SECOND PASS — re-run on the SETTLED revision.
//
// WHY A SECOND PASS: pass 1 (run-gates.mjs) straddled the t8 verdict-line repair, which rebuilt
// `packages/mpd-tui-plugin/dist/index.js` at 14:22:21 while pass 1 was still running — the early
// gates measured one revision and the lanes another. AGENTS.md §7 requires verification on SETTLED
// hashes, so this pass re-runs the whole set and PROVES the tree did not move under it: the
// revision is digested at the start AND at the end, and any file whose digest changed is named.
//
// It also turns the corpus question into an ASSERTION: the recomputed `skills/**` fingerprint must
// equal BOTH the expected value and what `VENDOR_LOCK.json` pins, so "the only red is drift" is
// measured rather than argued.
//
// Usage: bun evidence/tui/team-surface-integrate/<ts>/run-gates-second-pass.mjs
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"

const REPO = process.cwd()
const OUT = join(REPO, "evidence", "tui", "team-surface-integrate", "2026-09-16T14-17-24.000Z")
const PASS = join(OUT, "second-pass")
const RAW = join(PASS, "raw")
mkdirSync(RAW, { recursive: true })

const EXPECTED = { fileCount: 319, treeSha: "303e163148afc07e7dad10775d3de7e96b4caa1cfae9c1a91575ae906d8cc27d" }

const WATCHED = [
  "packages/mpd-tui-plugin/dist/index.js",
  "packages/mpd-tui-plugin/src/scenes.ts",
  "packages/mpd-tui-plugin/src/team-state.ts",
  "packages/mpd-tui-plugin/src/state.ts",
  "packages/mpd-tui-plugin/src/sanitize.ts",
  "packages/mpd-tui-plugin/src/commands.ts",
  "packages/mpd-tui-plugin/src/command-trees.ts",
  "packages/mpd-dsh-adapter-plugin/src/index.ts",
  "packages/mpd-dsh-adapter-plugin/dist/index.js",
  "skills/dsh-qa/scripts/tui-team-surface.mjs",
  "skills/dsh-qa/scripts/lib/tui-lane.mjs",
  "skills/dsh-qa/SKILL.md",
  "VENDOR_LOCK.json",
  "docs/tui-parity.md",
  "docs/tui-parity.zh-CN.md",
  "docs/tui.md",
  "docs/tui.zh-CN.md",
  "README.md",
  "README.zh-CN.md",
  "packages/mpd-tui-plugin/README.md",
  "packages/mpd-tui-plugin/README.zh-CN.md",
]

const sha = (rel) => {
  try {
    return createHash("sha256").update(readFileSync(join(REPO, rel))).digest("hex")
  } catch (error) {
    return `unreadable: ${String(error)}`
  }
}
const digestAll = () => Object.fromEntries(WATCHED.map((rel) => [rel, sha(rel)]))

const revisionAtStart = {
  at: new Date().toISOString(),
  branch: spawnSync("git", ["branch", "--show-current"], { encoding: "utf8" }).stdout.trim(),
  files: digestAll(),
}
writeFileSync(join(PASS, "REVISION-START.json"), JSON.stringify(revisionAtStart, null, 2) + "\n")

const records = []
const run = (bin, args, options = {}) => {
  const started = Date.now()
  const result = spawnSync(bin, args, { cwd: REPO, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...options })
  return { status: result.status, output: (result.stdout ?? "") + (result.stderr ?? ""), ms: Date.now() - started }
}
const gate = (id, command, bin, args, options = {}) => {
  process.stdout.write(`[gate] ${command} … `)
  const r = run(bin, args, options)
  writeFileSync(join(RAW, `${id}.log`), r.output)
  records.push({ id, command, exitCode: r.status, ms: r.ms, log: `second-pass/raw/${id}.log` })
  console.log(`exit ${r.status} (${r.ms} ms)`)
  return r
}

gate("typecheck", "bun run typecheck", "bun", ["run", "typecheck"])
gate("verify-docs", "bun run verify:docs", "bun", ["run", "verify:docs"])
const repoCwdSuite = gate("bun-test-packages", "bun test packages", "bun", ["test", "packages"])
gate("delta-check", "node scripts/patch-agent-teams-fixes.mjs --check", "node", ["scripts/patch-agent-teams-fixes.mjs", "--check"])
const vendor = gate("verify-vendor", "node scripts/verify-vendor.mjs", "node", ["scripts/verify-vendor.mjs"])
const fingerprint = gate(
  "fingerprint-asserted",
  `node ${join(OUT, "fingerprint.mjs")} ${EXPECTED.fileCount} ${EXPECTED.treeSha}`,
  "node",
  [join(OUT, "fingerprint.mjs"), String(EXPECTED.fileCount), EXPECTED.treeSha],
)
const testQa = gate("test-qa", "bun run test:qa", "bun", ["run", "test:qa"])

const cleanCwd = mkdtempSync(join(tmpdir(), "mpd-t5b-clean-cwd-"))
const cleanSuite = gate("bun-test-packages-clean-cwd", `cd <clean-cwd> && bun test ${join(REPO, "packages")}`, "bun", ["test", join(REPO, "packages")], { cwd: cleanCwd })

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
for (const lane of LANES) gate(lane.replace(/^.*\//, "").replace(/\.mjs$/, ""), `node ${lane}`, "node", [lane])

// The settle proof: re-digest after the sweep and name anything that moved.
const revisionAtEnd = { at: new Date().toISOString(), files: digestAll() }
const moved = Object.keys(revisionAtStart.files).filter((f) => revisionAtStart.files[f] !== revisionAtEnd.files[f])
writeFileSync(join(PASS, "REVISION-END.json"), JSON.stringify(revisionAtEnd, null, 2) + "\n")

const tail = (text, n) => text.trim().split("\n").slice(-n).join("\n")
const payload = {
  slug: "tui-team-surface-integrate-gates-second-pass",
  task: "t5",
  producedAt: new Date().toISOString(),
  why: "pass 1 straddled the t8 repair (dist rebuilt mid-run); this pass re-ran the whole set on the settled revision",
  revision: { start: revisionAtStart.at, end: revisionAtEnd.at, files: revisionAtStart.files, revisionStable: moved.length === 0, movedDuringSweep: moved },
  gates: records,
  bunTestPackages: {
    repoCwd: { command: "bun test packages", exitCode: repoCwdSuite.status, tail: tail(repoCwdSuite.output, 7) },
    cleanCwd: { command: `cd <mktemp> && bun test ${join(REPO, "packages")}`, exitCode: cleanSuite.status, tail: tail(cleanSuite.output, 7) },
    whyBoth: "the captain's standing waiver records the clean-cwd reading as the replacement; both readings are reported together, never the green one alone",
  },
  verifyVendor: {
    command: "node scripts/verify-vendor.mjs",
    exitCode: vendor.status,
    lastLines: tail(vendor.output, 4),
    otherAssetFailures: vendor.output.split("\n").filter((l) => /^FAIL/.test(l) && !/skills/.test(l)),
  },
  corpus: {
    expected: EXPECTED,
    pinnedByVendorLock: JSON.parse(readFileSync(join(REPO, "VENDOR_LOCK.json"), "utf8")).assets.skills,
    assertionExitCode: fingerprint.status,
    assertionLog: "second-pass/raw/fingerprint-asserted.log",
  },
  testQa: { command: "bun run test:qa", exitCode: testQa.status, lastLines: tail(testQa.output, 3) },
}
writeFileSync(join(PASS, "gates.result.json"), JSON.stringify(payload, null, 2) + "\n")
console.log(`\n[second-pass] revisionStable=${payload.revision.revisionStable} moved=${JSON.stringify(moved)}`)
console.log(`[second-pass] verify-vendor exit ${vendor.status}; test:qa exit ${testQa.status}; fingerprint exit ${fingerprint.status}`)
