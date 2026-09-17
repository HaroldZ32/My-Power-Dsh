#!/usr/bin/env node
// Wave-2b lane B evidence runner: every §2 verify command and every red-side/driver reading, FULL output
// captured per step (never a tail), then result.json with the exit codes and a digest per artifact.
// usage: node ./run-laneB-evidence.mjs [<evidence-dir>]      (run from the repository root)
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const startedAt = Date.now()
const repo = process.cwd()
const here = dirname(fileURLToPath(import.meta.url))
const dir = resolve(process.argv[2] ?? here)
if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
const sha = (f) => createHash("sha256").update(readFileSync(f)).digest("hex")
const written = new Set()

const run = (name, cmd, args, { timeout = 900_000 } = {}) => {
  const t = Date.now()
  let exitCode
  let output
  try {
    output = execFileSync(cmd, args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout, maxBuffer: 256 * 1024 * 1024 })
    exitCode = 0
  } catch (error) {
    exitCode = error.status ?? -1
    output = String(error.stdout ?? "") + String(error.stderr ?? "")
  }
  const log = name + ".log"
  writeFileSync(join(dir, log), output)
  written.add(log)
  return { name, command: [cmd, ...args].join(" "), exitCode, ms: Date.now() - t, log }
}

const STEPS = [
  // §2 — the lane-scoped verify list, in the acceptance's order
  ["self-test-verify-rows-parity", process.execPath, ["./scripts/verify-rows-parity.mjs", "--self-test"], 0],
  ["live-verify-rows-parity", process.execPath, ["./scripts/verify-rows-parity.mjs"], 0],
  ["self-test-verify-manual-paths", process.execPath, ["./scripts/verify-manual-paths.mjs", "--self-test"], 0],
  ["self-test-verify-gates", process.execPath, ["./scripts/verify-gates.mjs", "--self-test"], 0],
  ["self-test-mpd-doctor", process.execPath, ["./scripts/mpd-doctor.mjs", "--self-test"], 0],
  ["self-test-install-git-hooks", process.execPath, ["./scripts/install-git-hooks.mjs", "--self-test"], 0],
  ["self-test-repin-vendor", process.execPath, ["./scripts/repin-vendor.mjs", "--self-test"], 0],
  ["self-test-run-qa-lanes", process.execPath, ["./scripts/run-qa-lanes.mjs", "--self-test"], 0],
  ["self-test-verify-pack-closure", process.execPath, ["./scripts/verify-pack-closure.mjs", "--self-test"], 0],
  // the CONTRACT's two verify commands
  ["contract-verify-rows-parity", process.execPath, ["./scripts/verify-rows-parity.mjs"], 0],
  ["contract-check-drift", process.execPath, ["./scripts/run-qa-lanes.mjs", "--check-drift"], 0],
  // readings that are ADMISSIBLE in-lane but are not verify entries (T-84: a red the lane cannot keep
  // green lives in EVIDENCE): the live manual audit, the real-tree doctor, the doctor's env control
  ["reading-verify-manual-paths-live", process.execPath, ["./scripts/verify-manual-paths.mjs"], "reported"],
  ["reading-mpd-doctor-live", process.execPath, ["./scripts/mpd-doctor.mjs"], "reported"],
  ["reading-mpd-doctor-missing-sg", process.execPath, ["./scripts/mpd-doctor.mjs"], "reported"],
  ["reading-repin-vendor-check", process.execPath, ["./scripts/repin-vendor.mjs", "--check"], "reported"],
  // the two evidence-side drivers (T-88 derived surfaces, T-77 gitignore shape)
  ["driver-derived-surface-selftest", process.execPath, [join(here, "derived-surface-audit.mjs"), "--self-test"], 0],
  ["driver-derived-surface-live", process.execPath, [join(here, "derived-surface-audit.mjs")], 0],
  ["driver-gitignore-shape", process.execPath, [join(here, "gitignore-shape-driver.mjs")], 0],
]
const steps = []
for (const [name, cmd, args, expected] of STEPS) {
  if (name === "reading-mpd-doctor-missing-sg") {
    const t = Date.now()
    let exitCode
    let output
    try {
      output = execFileSync(cmd, args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 900_000, maxBuffer: 256 * 1024 * 1024, env: { ...process.env, MPD_AST_GREP_SG_PATH: "/nonexistent/sg" } })
      exitCode = 0
    } catch (error) {
      exitCode = error.status ?? -1
      output = String(error.stdout ?? "") + String(error.stderr ?? "")
    }
    const log = name + ".log"
    writeFileSync(join(dir, log), output)
    written.add(log)
    steps.push({ name, command: [cmd, ...args].join(" ") + "   (env MPD_AST_GREP_SG_PATH=/nonexistent/sg)", exitCode, ms: Date.now() - t, expected, log })
    continue
  }
  const step = run(name, cmd, args)
  steps.push({ ...step, expected })
}

const result = {
  schema: "laneB/wave2b-laneB-evidence/1",
  captured_at: new Date().toISOString(),
  task: "t14 - wave-2b lane B: gates/packaging/hygiene (T-34, T-41, T-66, T-68, T-70, T-71, T-77, T-88 + T-89's runner half)",
  repo_head: execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: repo, encoding: "utf8" }).trim(),
  steps,
  failures: steps.filter((s) => s.expected === 0 && s.exitCode !== 0).map((s) => s.name + " (exit " + s.exitCode + ")"),
  reported_readings: steps.filter((s) => s.expected === "reported").map((s) => ({ name: s.name, exitCode: s.exitCode, note: "declared READING: its exit code is evidence, not this lane's verdict" })),
  artifacts: {},
  digests_skipped: {},
  result_digest_note: "result.json excludes itself; every run prints its own post-write digest.",
}
writeFileSync(join(dir, "runner-summary.json"), JSON.stringify(result, null, 2))
written.add("runner-summary.json")
for (const entry of readdirSync(dir).sort()) {
  const abs = join(dir, entry)
  if (!statSync(abs).isFile() || entry === "result.json") continue
  const info = statSync(abs)
  if (!written.has(entry)) {
    if (info.size === 0) { result.digests_skipped[entry] = "empty file at digest time (0 bytes)"; continue }
    if (info.mtimeMs >= startedAt) { result.digests_skipped[entry] = "mtime inside this run and not written by the runner"; continue }
  }
  result.artifacts[entry] = sha(abs).slice(0, 16)
}
writeFileSync(join(dir, "result.json"), JSON.stringify(result, null, 2))
const digest = sha(join(dir, "result.json")).slice(0, 16)
console.log(JSON.stringify({ dir, ok: result.failures.length === 0, failures: result.failures, reported: result.reported_readings, artifacts: Object.keys(result.artifacts).length, result_json_digest: digest }, null, 2))
process.exit(result.failures.length === 0 ? 0 : 1)
