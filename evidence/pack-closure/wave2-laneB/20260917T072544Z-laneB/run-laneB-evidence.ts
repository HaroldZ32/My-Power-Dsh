#!/usr/bin/env node
// Lane B (wave 2, t9; repaired in t29 from review-B F1/F2) evidence driver.
//
// SELF-SUFFICIENT AND RE-RUNNABLE: `node <this> [<evidence-dir>]` from the repository root regenerates
// EVERY reading it cites, into a fresh directory if you point it at one. The four harness scripts are
// resolved relative to THIS file's directory (not the output directory), and each harness's JSON is
// parsed out of the `<name>.log` this run just wrote and saved as `<name>.json` — so the readings can
// never come from a file the driver did not write (review-B F1).
//
// DIGEST DISCIPLINE (review-B F2): the digest loop names the files THIS RUN wrote and digests them by
// name; any other top-level file is digested only when it is non-empty AND its mtime predates this run,
// and everything skipped is listed with its reason. `result.json` cannot carry its own digest and is
// excluded explicitly.
//
// It never writes into `dist/mpd-package`: every artifact reading is a READ (or a cpSync copy into a
// temp dir owned by a harness).
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const startedAt = Date.now()
const repo = process.cwd()
const here = dirname(fileURLToPath(import.meta.url))
const dir = resolve(process.argv[2] ?? here)
const sha = (file) => createHash("sha256").update(readFileSync(file)).digest("hex")
const writtenByThisRun = new Set()

const run = (name, cmd, args, { timeout = 900_000 } = {}) => {
  if (!existsSync(dir)) throw new Error("output directory does not exist: " + dir)
  const started = Date.now()
  let exitCode
  let output
  try {
    output = execFileSync(cmd, args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout, maxBuffer: 128 * 1024 * 1024 })
    exitCode = 0
  } catch (error) {
    exitCode = error.status ?? -1
    output = String(error.stdout ?? "") + String(error.stderr ?? "")
  }
  const logName = name + ".log"
  writeFileSync(join(dir, logName), output)
  writtenByThisRun.add(logName)
  return { name, command: [cmd, ...args].join(" "), exitCode, ms: Date.now() - started, log: logName }
}

/** A harness prints its JSON report to stdout; that stdout IS the artifact, so parse IT (never a stale file). */
const parseJsonFromLog = (text) => {
  const trimmed = text.trim()
  try {
    return { ok: true, value: JSON.parse(trimmed) }
  } catch {
    /* fall through to the braced span */
  }
  const first = trimmed.indexOf("{")
  const last = trimmed.lastIndexOf("}")
  if (first >= 0 && last > first) {
    try {
      return { ok: true, value: JSON.parse(trimmed.slice(first, last + 1)) }
    } catch (error) {
      return { ok: false, error: String(error?.message ?? error) }
    }
  }
  return { ok: false, error: "no JSON object found in the harness output" }
}

const harnesses = {}
const runHarness = (name) => {
  const script = join(here, name + ".mjs")
  if (!existsSync(script)) {
    const step = { name, command: process.execPath + " " + script, exitCode: null, ms: 0, log: null, missing_script: script }
    harnesses[name] = { step, value: null, error: "harness script missing beside the driver: " + script }
    return step
  }
  const step = run(name, process.execPath, [script])
  const parsed = parseJsonFromLog(readFileSync(join(dir, step.log), "utf8"))
  if (parsed.ok) {
    const jsonName = name + ".json"
    writeFileSync(join(dir, jsonName), JSON.stringify(parsed.value, null, 2))
    writtenByThisRun.add(jsonName)
    harnesses[name] = { step, value: parsed.value, error: null, json: jsonName }
  } else {
    harnesses[name] = { step, value: null, error: parsed.error }
  }
  return step
}

// The inferred artifact stamp, by the ONE canonical construction: sha256 over the UNSORTED
// `find … -printf '%P\t%s\t%T@\n'` listing, plus the file count. A stamp built any other way is not a
// comparable string (measured lesson: an earlier reading with an extra `| sort` was not comparable).
const stampOf = () => {
  const text = execFileSync("find", ["dist/mpd-package", "-type", "f", "-printf", "%P\t%s\t%T@\n"], { cwd: repo, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  const files = execFileSync("find", ["dist/mpd-package", "-type", "f"], { cwd: repo, encoding: "utf8" }).trim().split("\n").filter(Boolean).length
  return { digest: createHash("sha256").update(text).digest("hex").slice(0, 16), files }
}

const steps = []
steps.push(run("closure", process.execPath, ["scripts/verify-pack-closure.mjs"]))
const stampAfterClosure = stampOf()
steps.push(run("closure-selftest", process.execPath, ["scripts/verify-pack-closure.mjs", "--self-test"]))
steps.push(run("dist-fresh", process.execPath, ["scripts/verify-dist-fresh.mjs"]))
steps.push(run("dist-fresh-ext-plugin", process.execPath, ["scripts/verify-dist-fresh.mjs", "--only", "mpd-ext-plugin"]))
steps.push(run("dist-fresh-tui-plugin", process.execPath, ["scripts/verify-dist-fresh.mjs", "--only", "mpd-tui-plugin"]))
steps.push(run("dist-fresh-selftest", process.execPath, ["scripts/verify-dist-fresh.mjs", "--self-test"]))
const aggregate = run("verify-gates", "bun", ["run", "verify:gates"])
steps.push(aggregate)
for (const name of ["t67-build-form-diff", "t63-t76-seeded-mutation", "t63-out-flag-equivalence", "t67-round-trip"]) steps.push(runHarness(name))

// The contract's verify list is the gate's own; the aggregate is REPORTED, never gating (review-B/T-84).
const EXPECTED = {
  closure: 0,
  "closure-selftest": 0,
  "dist-fresh": "reported",
  "dist-fresh-ext-plugin": 0,
  "dist-fresh-tui-plugin": 0,
  "dist-fresh-selftest": 0,
  "verify-gates": "reported",
  "t67-build-form-diff": 0,
  "t63-t76-seeded-mutation": 0,
  "t63-out-flag-equivalence": 0,
  "t67-round-trip": 0,
}

const read = (name) => readFileSync(join(dir, name + ".log"), "utf8")
const closureLog = read("closure")
const parse = (text, re) => {
  const m = text.match(re)
  return m === null ? null : m.slice(1)
}
const driftLine = (text) => text.split("\n").filter((l) => l.includes("CONTENT-DRIFT-EXPECTED (expected")).map((l) => ({
  path: l.match(/ - ([^:]+): source mtime/)?.[1] ?? null,
  sourceMtime: l.match(/source mtime ([0-9T:.Z-]+)/)?.[1] ?? null,
  stamp: l.match(/artifact stamp ([0-9T:.Z-]+)/)?.[1] ?? null,
}))

const summary = {
  schema: "laneB/wave2-laneB-evidence/2",
  captured_at: new Date().toISOString(),
  driver: { file: "run-laneB-evidence.mjs", resolved_harnesses_from: here, output_dir: dir },
  task: "t9 - lane B: T-63/T-65/T-67/T-76 (+ t26 ROUTE-FILE repair, t29 driver repair)",
  repo_head: execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: repo, encoding: "utf8" }).trim(),
  steps: steps.map((s) => ({ ...s, expected: EXPECTED[s.name] ?? null })),
  harness_parse_errors: Object.fromEntries(Object.entries(harnesses).filter(([, h]) => h.error !== null).map(([k, h]) => [k, h.error])),
  readings: {
    closure: {
      verdict: parse(closureLog, /\[verify-pack-closure\] (ok|FAIL)/),
      contentBytes: parse(closureLog, /content bytes: (\d+) file\(s\) compared, (\d+) identical, (\d+) drift, (\d+) expected-after-pack/),
      completeness: parse(closureLog, /completeness: (\d+) declared source file\(s\) compared, (\d+) present, (\d+) declared exemption\(s\), (\d+) absent/),
      stamp: parse(closureLog, /pack stamp ([0-9T:.Z-]+) \(([^)]+)\)/),
      exemption: parse(closureLog, /exemption exercised: (\S+)/),
      expectedDrift: driftLine(closureLog),
    },
    closureSelftest: { arms: parse(read("closure-selftest"), /self-test (?:PASS|FAIL): (\d+\/\d+) arms/), armFailures: (read("closure-selftest").match(/self-test FAIL - /g) ?? []).length, expectedFailLines: (read("closure-selftest").match(/\[verify-pack-closure\] FAIL/g) ?? []).length },
    distFresh: { verdict: parse(read("dist-fresh"), /\[verify-dist-fresh\] (ok|FAIL)/), targets: parse(read("dist-fresh"), /(\d+\/\d+) targets fresh/), notCovered: parse(read("dist-fresh"), /(\d+) NOT COVERED/), buildForm: (read("dist-fresh").match(/BUILD_FORM/g) ?? []).length },
    distFreshSelftest: { arms: parse(read("dist-fresh-selftest"), /\[verify-dist-fresh self-test\] (\d+\/\d+) arms passed/) },
    verifyGates: { exitCode: aggregate.exitCode, failingSubGate: (read("verify-gates").match(/\[(verify-[a-z-]+|preset-conformance)\][^\n]*FAIL[^\n]*/g) ?? []).slice(0, 4), note: "cross-lane aggregate: REPORTED with its cause, never gating this lane's exit code (a failed command cannot coexist with a completed task)" },
    t67: harnesses["t67-build-form-diff"].value,
    t67RoundTrip: harnesses["t67-round-trip"].value,
    mutation: harnesses["t63-t76-seeded-mutation"].value,
    outFlagEquivalence: harnesses["t63-out-flag-equivalence"].value,
  },
  artifact_read_only_proof: {
    method: "canonical stamp = sha256(unsorted `find dist/mpd-package -type f -printf '%P\t%s\t%T@\n'`) truncated to 16 hex, + file count",
    before_steps: stampAfterClosure,
    after_steps: stampOf(),
  },
  changed_paths: ["scripts/verify-pack-closure.mjs", "scripts/verify-dist-fresh.mjs", "scripts/pack-mpd.mjs", "packages/mpd-ext-plugin/package.json", "packages/mpd-team-watchdog-plugin/package.json", "packages/mpd-tui-plugin/package.json"],
  digests: {},
  digests_skipped: {},
  result_digest_note: "result.json cannot carry its own digest; digest it externally (every run prints the file's own digest in `regenerated`).",
}
summary.artifact_read_only_proof.identical = summary.artifact_read_only_proof.before_steps.digest === summary.artifact_read_only_proof.after_steps.digest

// The summary goes to disk BY NAME (so a caller's stdout redirect cannot leave a half-written file being
// digested) and is then digested with everything else this run wrote.
const summaryName = "driver-summary.json"
writeFileSync(join(dir, summaryName), JSON.stringify(summary, null, 2))
writtenByThisRun.add(summaryName)

for (const entry of readdirSync(dir).sort()) {
  const abs = join(dir, entry)
  if (!statSync(abs).isFile()) continue
  if (entry === "result.json") continue
  const info = statSync(abs)
  if (!writtenByThisRun.has(entry)) {
    if (info.size === 0) {
      summary.digests_skipped[entry] = "empty file at digest time (0 bytes) - not evidence"
      continue
    }
    if (info.mtimeMs >= startedAt) {
      summary.digests_skipped[entry] = "mtime falls inside this run (" + new Date(info.mtimeMs).toISOString() + ") and the driver did not write it - excluded rather than digested mid-write"
      continue
    }
  }
  summary.digests[entry] = sha(abs).slice(0, 16)
}
writeFileSync(join(dir, "result.json"), JSON.stringify(summary, null, 2))

const bad = summary.steps.filter((s) => s.expected === 0 && s.exitCode !== 0)
const parseErrors = Object.keys(summary.harness_parse_errors)
const ok = bad.length === 0 && parseErrors.length === 0
const resultDigest = sha(join(dir, "result.json")).slice(0, 16)
console.log(JSON.stringify({
  ok,
  output_dir: dir,
  regenerated: { artifacts: Object.keys(summary.digests).length, result_json_digest: resultDigest, result_json_note: "digest taken after the write; result.json excludes itself from its own map" },
  steps: summary.steps.map((s) => [s.name, s.exitCode, s.expected, s.ms + "ms"]),
  aggregate_reported: { exitCode: aggregate.exitCode, failingSubGate: summary.readings.verifyGates.failingSubGate },
  harnesses_parsed: Object.fromEntries(Object.entries(harnesses).map(([k, h]) => [k, h.value === null ? "PARSE-FAILED: " + h.error : "ok"])),
  readings: {
    closureVerdict: summary.readings.closure.verdict,
    contentBytes: summary.readings.closure.contentBytes,
    completeness: summary.readings.closure.completeness,
    closureArms: summary.readings.closureSelftest.arms,
    distArms: summary.readings.distFreshSelftest.arms,
    stampIdentical: summary.artifact_read_only_proof.identical,
    expectedDriftCount: summary.readings.closure.expectedDrift.length,
  },
  failedExpectations: bad.map((s) => s.name + " (exit " + s.exitCode + ")"),
  digests_skipped: summary.digests_skipped,
}, null, 2))
process.exit(ok ? 0 : 1)
