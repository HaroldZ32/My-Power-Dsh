#!/usr/bin/env node
// verify-gates — the aggregate over the repo's static member gates that NEVER short-circuits (T-70).
//
// WHY THIS EXISTS: `verify:gates` used to be a `&&` chain in package.json, so the FIRST red member
// hid every later one — with the vendor gate red, nobody ever learned whether the dist, row, doc or
// preset gate was green, and the wave had to run each gate by hand. This script runs EVERY member,
// prints EVERY member's own verdict (id + exit code + PASS/FAIL), and only then fails, naming the
// failing members on one summary line. The run loop has no early return and no short-circuit.
//
// THE MEMBER TABLE IS THE ONE PLACE TO ADD A MEMBER: `DECLARED_MEMBERS` below mirrors today's chain
// in package.json's `verify:gates`, resolved through its aliases (`verify:rows` ->
// `./scripts/verify-rows-parity.mjs`, `verify:docs` -> `./scripts/verify-docs-parity.mjs`). Every
// path-qualified command is written in the `./` form (T-89) and is printed that way too.
//
// Members run in the CALLER's working directory — the repo root under `bun run verify:gates`.
//
// Usage:
//   node ./scripts/verify-gates.mjs                      run the declared member table, then report
//   node ./scripts/verify-gates.mjs --list               resolve + print the member table; spawns NOTHING
//   node ./scripts/verify-gates.mjs --self-test          every arm on TEMP fixtures (never the tree)
//   node ./scripts/verify-gates.mjs --member <id>=<command>     repeatable; REPLACES the declared table
//   node ./scripts/verify-gates.mjs --members-file <json>       JSON array of {id, argv}, or {"members": [...]}
//   node ./scripts/verify-gates.mjs --help
//
// An override REPLACES the declared table (it never appends to it), so a fixture run travels the SAME
// resolution + run code path as the real sweep. `--members-file` supplies the base list and `--member`
// entries append to THAT list, in the order given. `--member` command strings are whitespace-tokenized
// with `"`/`'` grouping; anything needing a literal argv array uses `--members-file`.
//
// Exit codes:
//   0  every member exited 0
//   1  at least one member failed (the summary line names each failing member and its exit code)
//   2  runner/config error: unknown flag, unreadable/malformed/empty/duplicate member table, bad id
//
// EVERY line this script prints — including echoed member output — is prefixed `[verify-gates]`, so an
// aggregate transcript stays greppable without ambiguity. The self-test's trailing census line is
// `self-test PASS|FAIL: <passed>/<total> arms`, preceded by one `self-test arm <name>:` line per arm.
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const TAG = "[verify-gates]"
const SELF = fileURLToPath(import.meta.url)
const REPO_ROOT = resolve(dirname(SELF), "..")
const EXIT = { GREEN: 0, MEMBER_FAILED: 1, RUNNER_ERROR: 2 }
// A member that overflows the capture buffer is reported FAIL: a truncated transcript is not evidence.
const MAX_BUFFER = 64 * 1024 * 1024
// Echo cap per member per stream, always with an explicit suppression line (never a silent cut).
const MAX_ECHO_LINES = 400

// ─── THE MEMBER TABLE (the ONE declaration point: a member is added here, nowhere else) ───────────
const DECLARED_MEMBERS = [
  { id: "vendor", argv: ["node", "./scripts/verify-vendor.mjs"] },
  { id: "dist-fresh", argv: ["node", "./scripts/verify-dist-fresh.mjs"] },
  { id: "rows-parity", argv: ["node", "./scripts/verify-rows-parity.mjs"] },
  { id: "docs-parity", argv: ["node", "./scripts/verify-docs-parity.mjs"] },
  { id: "preset-conformance", argv: ["node", "./skills/dsh-qa/scripts/preset-conformance.mjs", "--self-test"] },
]

function usage() {
  return [
    `${TAG} usage: node ./scripts/verify-gates.mjs [options]`,
    `${TAG}   (no options)                     run every member gate of the declared table, then report`,
    `${TAG}   --list                           resolve + print the member table; spawns NOTHING`,
    `${TAG}   --self-test                      every arm on temp fixtures (never the live tree)`,
    `${TAG}   --member <id>=<command>          REPLACES the declared table (repeatable)`,
    `${TAG}   --members-file <json>            JSON array of {id, argv}, or {"members": [...]}`,
    `${TAG}   --help                           this text`,
    `${TAG} overrides replace the declared table; --member entries append to --members-file's list`,
    `${TAG} exit codes: 0 = every member green, 1 = at least one member failed, 2 = runner/config error`,
    `${TAG} a member id must match [A-Za-z0-9._-]+ (the verdict line and the census parse on that shape)`,
    `${TAG} self-test census: one "self-test arm <name>: PASS|FAIL" line per arm, then`,
    `${TAG}   "self-test PASS|FAIL: <passed>/<total> arms"`,
  ]
}

// `emit` is the ONLY way this script writes to stdout, and it enforces the prefix invariant: a line
// that arrives unprefixed is prefixed here rather than printed bare.
function emit(line) {
  const text = line.startsWith(TAG) ? line : `${TAG} ${line}`
  process.stdout.write(text + "\n")
}

function emitError(line) {
  const text = line.startsWith(TAG) ? line : `${TAG} ${line}`
  process.stderr.write(text + "\n")
}

const formatCommand = (argv) => argv.map((token) => (/\s/.test(token) ? JSON.stringify(token) : token)).join(" ")

// `--member` command strings are whitespace-tokenized; `"`/`'` group one token so a path with spaces
// stays a single argument.
function tokenizeCommand(text) {
  const raw = text.match(/"[^"]*"|'[^']*'|\S+/g) ?? []
  return raw.map((token) => {
    const quoted = token.length >= 2 && (token.startsWith('"') || token.startsWith("'")) && token.endsWith(token[0])
    return quoted ? token.slice(1, -1) : token
  })
}

function parseArgs(argv) {
  const opts = { selfTest: false, list: false, help: false, membersFile: null, memberSpecs: [] }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === "--self-test") opts.selfTest = true
    else if (arg === "--list") opts.list = true
    else if (arg === "--help" || arg === "-h") opts.help = true
    else if (arg === "--member") {
      i += 1
      opts.memberSpecs.push(requireValue(argv, i, "--member"))
    } else if (arg.startsWith("--member=")) opts.memberSpecs.push(arg.slice("--member=".length))
    else if (arg === "--members-file") {
      i += 1
      opts.membersFile = requireValue(argv, i, "--members-file")
    } else if (arg.startsWith("--members-file=")) opts.membersFile = arg.slice("--members-file=".length)
    else throw new Error(`unknown argument "${arg}" (run node ./scripts/verify-gates.mjs --help)`)
  }
  return opts
}

function requireValue(argv, index, flag) {
  const value = argv[index]
  if (value === undefined) throw new Error(`${flag} needs a value`)
  return value
}

function parseMemberSpec(spec) {
  const eq = spec.indexOf("=")
  if (eq <= 0) throw new Error(`--member expects <id>=<command>, got: ${spec}`)
  const id = spec.slice(0, eq).trim()
  const argv = tokenizeCommand(spec.slice(eq + 1))
  if (id === "") throw new Error(`--member needs a non-empty id: ${spec}`)
  if (argv.length === 0) throw new Error(`--member ${id} needs a non-empty command`)
  return { id, argv }
}

// The override boundary: parse the JSON into the SAME {id, argv} shape the declared table uses, and
// refuse anything that would make the per-member census lie.
function readMembersFile(file) {
  let parsed
  try {
    parsed = JSON.parse(readFileSync(resolve(file), "utf8"))
  } catch (err) {
    throw new Error(`--members-file ${file}: ${err.message}`)
  }
  const raw = Array.isArray(parsed) ? parsed : parsed?.members
  if (!Array.isArray(raw)) throw new Error(`--members-file ${file}: expected a JSON array of {id, argv} entries, or {"members": [...]}`)
  return raw.map((entry, index) => {
    const at = `${file}[${index}]`
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) throw new Error(`${at}: expected an object with {id, argv}`)
    if (typeof entry.id !== "string" || entry.id.trim() === "") throw new Error(`${at}: "id" must be a non-empty string`)
    const tokens = entry.argv
    if (!Array.isArray(tokens) || tokens.length === 0 || !tokens.every((token) => typeof token === "string" && token !== "")) {
      throw new Error(`${at}: "argv" must be a non-empty array of non-empty strings`)
    }
    return { id: entry.id.trim(), argv: [...tokens] }
  })
}

function resolveMembers(opts) {
  const override = opts.membersFile !== null || opts.memberSpecs.length > 0
  const supplied = []
  if (opts.membersFile !== null) supplied.push(...readMembersFile(opts.membersFile))
  for (const spec of opts.memberSpecs) supplied.push(parseMemberSpec(spec))
  const members = override ? supplied : DECLARED_MEMBERS.map((member) => ({ id: member.id, argv: [...member.argv] }))
  if (members.length === 0) {
    throw new Error("the member table is empty — refusing to report a sweep over zero members (pass the declared table, --members-file <json>, or --member <id>=<command>)")
  }
  const seen = new Set()
  for (const member of members) {
    // The id grammar is what the verdict line and the census parse on, so an id outside it is refused
    // at the boundary instead of printing an unparseable report.
    if (!/^[A-Za-z0-9._-]+$/.test(member.id)) {
      throw new Error(`member id ${JSON.stringify(member.id)} must match [A-Za-z0-9._-]+ — the verdict line and the census parse on that shape`)
    }
    if (seen.has(member.id)) throw new Error(`duplicate member id "${member.id}" — two members under one id would make the "all N reported" census lie`)
    seen.add(member.id)
  }
  return { members, declared: !override }
}

// A member's own transcript, echoed under the prefix so the aggregate stays a single greppable stream.
function echoStream(id, stream, text) {
  const lines = text.split("\n")
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop()
  const shown = lines.slice(0, MAX_ECHO_LINES)
  for (const line of shown) emit(`${TAG} ${id} ${stream}| ${line}`)
  if (lines.length > shown.length) emit(`${TAG} ${id} ${stream}| ... ${lines.length - shown.length} more line(s) suppressed (cap ${MAX_ECHO_LINES})`)
}

function describeSpawn(res) {
  if (res.error) {
    if (res.error.code === "ENOBUFS") return `output exceeded the ${MAX_BUFFER}-byte capture limit`
    return `spawn error: ${res.error.code ?? res.error.message}`
  }
  if (res.signal) return `killed by signal ${res.signal}`
  return null
}

function runAggregate(opts) {
  const { members, declared } = resolveMembers(opts)
  emit(`${TAG} ${opts.list ? "resolving" : "running"} ${members.length} member gate(s) (${declared ? "declared table" : "override table"})`)
  if (opts.list) {
    for (const member of members) emit(`${TAG} member ${member.id} :: ${formatCommand(member.argv)}`)
    emit(`${TAG} list OK: ${members.length} member gate(s) resolved, 0 spawned`)
    return EXIT.GREEN
  }
  const results = []
  // NO early exit: a red member never stops the sweep, it only marks the aggregate red at the end.
  for (const member of members) {
    emit(`${TAG} member ${member.id} :: ${formatCommand(member.argv)}`)
    const started = Date.now()
    const res = spawnSync(member.argv[0], member.argv.slice(1), {
      cwd: process.cwd(),
      encoding: "utf8",
      maxBuffer: MAX_BUFFER,
      stdio: ["ignore", "pipe", "pipe"],
    })
    const elapsedMs = Date.now() - started
    echoStream(member.id, "out", res.stdout ?? "")
    echoStream(member.id, "err", res.stderr ?? "")
    const note = describeSpawn(res)
    const verdict = note === null && res.status === 0 ? "PASS" : "FAIL"
    emit(`${TAG} member ${member.id}: exit=${res.status === null ? "n/a" : res.status} ${verdict} - ${note ?? `${elapsedMs}ms`}`)
    results.push({ id: member.id, exitCode: res.status, verdict })
  }
  const failed = results.filter((result) => result.verdict !== "PASS")
  if (failed.length === 0) {
    emit(`${TAG} PASS - ${results.length}/${results.length} member gate(s) green`)
  } else {
    const named = failed.map((result) => `${result.id} (exit=${result.exitCode === null ? "n/a" : result.exitCode})`).join(", ")
    emit(`${TAG} FAIL - ${failed.length}/${results.length} member gate(s) failed: ${named}`)
  }
  return failed.length === 0 ? EXIT.GREEN : EXIT.MEMBER_FAILED
}

// ─── self-test ───────────────────────────────────────────────────────────────────────────────────
// Every arm runs the AGGREGATE CHILD on TEMP fixtures (mkdtemp in os.tmpdir, removed in the `finally`),
// so the acceptance is provable without the tree being red: fixture members exit 0 or 1 on demand, and
// nothing here reads or writes the live repo. The one arm that exercises the DEFAULT path uses `--list`,
// which resolves the declared table and spawns NOTHING — the real member gates are never executed by
// this lane.
const FIXTURE_NAME = "fixture-member.mjs"
const FIXTURE_SOURCE = [
  'const code = Number(process.argv[2] ?? "0")',
  'const id = process.argv[3] ?? "member"',
  'process.stdout.write("fixture " + id + " stdout\\n")',
  'if (code !== 0) process.stderr.write("fixture " + id + " failed\\n")',
  "process.exit(Number.isFinite(code) ? code : 2)",
  "",
].join("\n")

const VERDICT_RE = /^\[verify-gates\] member (\S+): exit=(\S+) (PASS|FAIL)(?: - .*)?$/
const LIST_RE = /^\[verify-gates\] member (\S+) :: (.+)$/

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function assertEquals(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
}

function verdictLines(stdout) {
  return stdout
    .split("\n")
    .map((line) => VERDICT_RE.exec(line))
    .filter((match) => match !== null)
    .map((match) => ({ id: match[1], exit: match[2], verdict: match[3] }))
}

function listLines(stdout) {
  return stdout
    .split("\n")
    .map((line) => LIST_RE.exec(line))
    .filter((match) => match !== null)
    .map((match) => ({ id: match[1], command: match[2] }))
}

// The shared invariants every arm inherits: the child really ran, it printed something, and every line
// it printed carries the prefix. A run that prints nothing can never pass an arm.
function assertAggregateOutput(run, label) {
  if (run.error) throw new Error(`${label}: the aggregate could not be spawned: ${run.error.message}`)
  const lines = [...run.stdout.split("\n"), ...run.stderr.split("\n")].filter((line) => line !== "")
  assert(lines.length > 0, `${label}: the aggregate printed NOTHING — an empty transcript is not a sweep`)
  const unprefixed = lines.filter((line) => !line.startsWith(TAG))
  assert(unprefixed.length === 0, `${label}: ${unprefixed.length} line(s) are not prefixed ${TAG}: ${JSON.stringify(unprefixed[0])}`)
}

function spawnAggregate(args, cwd) {
  const res = spawnSync(process.execPath, [SELF, ...args], { cwd, encoding: "utf8", maxBuffer: MAX_BUFFER, stdio: ["ignore", "pipe", "pipe"] })
  return { args, cwd, exitCode: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "", error: res.error }
}

function buildArms(dir) {
  const writeFixtureJson = (name, text) => {
    writeFileSync(join(dir, name), text)
    return `./${name}`
  }
  const fixtureTable = (codes) =>
    codes.map((code, index) => ({ id: `m${index}`, argv: [process.execPath, `./${FIXTURE_NAME}`, String(code), `m${index}`] }))
  const memberFlags = (codes) => fixtureTable(codes).map((member) => `--member=${member.id}=${formatCommand(member.argv)}`)
  const expectedIds = fixtureTable([0, 0, 0, 0, 0]).map((member) => member.id).join(",")
  const reportedIds = (run) => verdictLines(run.stdout).map((verdict) => verdict.id).join(",")

  return [
    {
      name: "default-path-resolves-declared-table",
      check: () => {
        // The default path (no member override) is exercised HERE, twice: from the repo root exactly as
        // `bun run verify:gates` would call it, and from a temp dir. `--list` spawns nothing, so the live
        // member gates stay out of this lane's verify.
        const fromRepo = spawnAggregate(["--list"], REPO_ROOT)
        const fromTemp = spawnAggregate(["--list"], dir)
        for (const [label, run] of [["repo root", fromRepo], ["temp dir", fromTemp]]) {
          assertAggregateOutput(run, `--list from ${label}`)
          assertEquals(run.exitCode, EXIT.GREEN, `--list exit code from ${label}`)
          assertEquals(verdictLines(run.stdout).length, 0, `--list from ${label} must spawn no member`)
          assertEquals(listLines(run.stdout).map((entry) => entry.id).join(","), DECLARED_MEMBERS.map((member) => member.id).join(","), `declared member ids from ${label}`)
          assert(
            listLines(run.stdout).every((entry) => entry.command.includes(" ./")),
            `--list from ${label}: a declared command is not path-qualified with ./ (T-89)`,
          )
        }
        assertEquals(fromRepo.stdout, fromTemp.stdout, "the declared table must not depend on the working directory")
        return `${DECLARED_MEMBERS.length} declared member(s), ./ command forms, 0 spawned`
      },
    },
    {
      name: "all-green-fixture-reports-every-member",
      check: () => {
        const file = writeFixtureJson("members-green.json", JSON.stringify(fixtureTable([0, 0, 0, 0, 0])))
        const run = spawnAggregate([`--members-file=${file}`], dir)
        assertAggregateOutput(run, "all-green fixture")
        assertEquals(run.exitCode, EXIT.GREEN, "all-green fixture exit code")
        assertEquals(reportedIds(run), expectedIds, "every member reported, in table order")
        const verdicts = verdictLines(run.stdout)
        assert(verdicts.every((verdict) => verdict.verdict === "PASS" && verdict.exit === "0"), "every verdict line must carry exit=0 PASS")
        assert(run.stdout.includes(`${TAG} PASS - 5/5 member gate(s) green`), "the green summary line must count all 5 members")
        assert(run.stdout.includes(`${TAG} m0 out| fixture m0 stdout`), "the member's own output must be echoed (a silent run must fail this arm)")
        return "5/5 green, 5 verdict lines, transcript echoed"
      },
    },
    {
      name: "first-member-red-still-reports-the-rest",
      check: () => {
        const run = spawnAggregate(memberFlags([1, 0, 0, 0, 0]), dir)
        assertAggregateOutput(run, "first-member-red fixture (--member route)")
        assertEquals(run.exitCode, EXIT.MEMBER_FAILED, "exit code with m0 red")
        assertEquals(reportedIds(run), expectedIds, "ALL members must be reported when the FIRST one fails")
        const verdicts = verdictLines(run.stdout)
        assertEquals(verdicts[0].verdict, "FAIL", "m0's own verdict")
        assert(verdicts.slice(1).every((verdict) => verdict.verdict === "PASS"), "members AFTER the failure must still report their own PASS")
        assert(run.stdout.includes(`${TAG} FAIL - 1/5 member gate(s) failed: m0 (exit=1)`), "the failing member must be named on the summary line")
        assert(run.stdout.includes(`${TAG} m0 err| fixture m0 failed`), "the failing member's stderr must be echoed")
        return "m0 red: 5/5 reported, exit 1, summary names m0 (exit=1)"
      },
    },
    {
      name: "middle-member-red-still-reports-later-members",
      check: () => {
        const file = writeFixtureJson("members-middle-red.json", JSON.stringify(fixtureTable([0, 0, 1, 0, 0])))
        const run = spawnAggregate([`--members-file=${file}`], dir)
        assertAggregateOutput(run, "middle-member-red fixture (--members-file route)")
        assertEquals(run.exitCode, EXIT.MEMBER_FAILED, "exit code with m2 red")
        assertEquals(reportedIds(run), expectedIds, "ALL members must be reported when a MIDDLE one fails")
        const verdicts = verdictLines(run.stdout)
        assertEquals(verdicts[2].verdict, "FAIL", "m2's own verdict")
        assert(verdicts[3].verdict === "PASS" && verdicts[4].verdict === "PASS", "the members AFTER the red one must still run and report")
        assert(run.stdout.includes(`${TAG} FAIL - 1/5 member gate(s) failed: m2 (exit=1)`), "the failing middle member must be named")
        return "m2 red: 5/5 reported, m3+m4 still PASS, exit 1"
      },
    },
    {
      name: "two-members-red-are-both-named",
      check: () => {
        const file = writeFixtureJson("members-two-red.json", JSON.stringify(fixtureTable([1, 0, 0, 1, 0])))
        const run = spawnAggregate([`--members-file=${file}`], dir)
        assertAggregateOutput(run, "two-members-red fixture")
        assertEquals(run.exitCode, EXIT.MEMBER_FAILED, "exit code with two red members")
        assertEquals(reportedIds(run), expectedIds, "ALL members must be reported with two red members")
        assert(run.stdout.includes(`${TAG} FAIL - 2/5 member gate(s) failed: m0 (exit=1), m3 (exit=1)`), "BOTH failing members must be named, in table order")
        return "m0+m3 red: 5/5 reported, both named, exit 1"
      },
    },
    {
      name: "empty-member-table-is-refused",
      check: () => {
        const file = writeFixtureJson("members-empty.json", "[]\n")
        const run = spawnAggregate([`--members-file=${file}`], dir)
        assertAggregateOutput(run, "empty member table")
        assertEquals(run.exitCode, EXIT.RUNNER_ERROR, "an empty member table must be a runner error, never a green sweep")
        assertEquals(verdictLines(run.stdout).length, 0, "no member may be reported for an empty table")
        assert(run.stderr.includes("member table is empty"), "the refusal must name the empty member table")
        return "empty table refused, exit 2, 0 members reported"
      },
    },
    {
      name: "malformed-members-file-is-refused",
      check: () => {
        const file = writeFixtureJson("members-broken.json", '{ "members": [\n')
        const run = spawnAggregate([`--members-file=${file}`], dir)
        assertAggregateOutput(run, "malformed members file")
        assertEquals(run.exitCode, EXIT.RUNNER_ERROR, "a malformed members file must be a runner error")
        assertEquals(verdictLines(run.stdout).length, 0, "no member may be reported for an unparsable table")
        assert(run.stderr.includes("members-broken.json"), "the refusal must name the offending file")
        return "malformed JSON refused, exit 2, file named"
      },
    },
    {
      name: "duplicate-member-id-is-refused",
      check: () => {
        const duplicate = [
          { id: "dup", argv: ["node", "./a.mjs"] },
          { id: "dup", argv: ["node", "./b.mjs"] },
        ]
        const file = writeFixtureJson("members-duplicate.json", JSON.stringify(duplicate))
        const run = spawnAggregate([`--members-file=${file}`], dir)
        assertAggregateOutput(run, "duplicate member id")
        assertEquals(run.exitCode, EXIT.RUNNER_ERROR, "a duplicate member id must be a runner error")
        assertEquals(verdictLines(run.stdout).length, 0, "no member may be reported for a duplicate table")
        assert(run.stderr.includes('duplicate member id "dup"'), "the refusal must name the duplicate id")
        return "duplicate id refused, exit 2, id named"
      },
    },
    {
      name: "invalid-member-id-is-refused",
      check: () => {
        // `bad id` cannot be spelled on a verdict line, so it must never reach the run loop.
        const run = spawnAggregate(["--member=bad id=node ./never-runs.mjs"], dir)
        assertAggregateOutput(run, "invalid member id")
        assertEquals(run.exitCode, EXIT.RUNNER_ERROR, "a member id outside [A-Za-z0-9._-]+ must be a runner error")
        assertEquals(verdictLines(run.stdout).length, 0, "no member may be reported for an unspellable id")
        assert(run.stderr.includes("must match [A-Za-z0-9._-]+"), "the refusal must name the id grammar")
        return "invalid id refused, exit 2, grammar named"
      },
    },
  ]
}

function selfTest() {
  const report = []
  let dir = null
  let setupError = null
  try {
    dir = mkdtempSync(join(tmpdir(), "verify-gates-self-test-"))
    assert(resolve(dir).startsWith(resolve(tmpdir())), `the fixture root must be a temp dir, got ${dir}`)
    writeFileSync(join(dir, FIXTURE_NAME), FIXTURE_SOURCE)
    for (const arm of buildArms(dir)) {
      try {
        report.push({ arm: arm.name, ok: true, note: arm.check() })
      } catch (err) {
        report.push({ arm: arm.name, ok: false, note: err instanceof Error ? err.message : String(err) })
      }
      const entry = report[report.length - 1]
      emit(`${TAG} self-test arm ${entry.arm}: ${entry.ok ? "PASS" : "FAIL"} - ${entry.note}`)
    }
  } catch (err) {
    // Only fixture SETUP can land here (each arm already isolates its own failure), and a setup failure
    // must still end in the census grammar rather than an unhandled crash.
    setupError = err instanceof Error ? err.message : String(err)
  } finally {
    if (dir !== null) rmSync(dir, { recursive: true, force: true })
  }
  if (setupError !== null) emit(`${TAG} self-test arm fixture-setup: FAIL - ${setupError}`)
  if (report.length === 0) report.push({ arm: "census", ok: false, note: setupError ?? "no arm ran — a self-test that asserts nothing must never report PASS" })
  const failed = report.filter((entry) => !entry.ok).length
  // The census line carries <passed>/<total> in BOTH branches, matching the "PASS: N/N arms" grammar.
  emit(`${TAG} self-test ${failed === 0 ? "PASS" : "FAIL"}: ${report.length - failed}/${report.length} arms`)
  process.exitCode = failed === 0 ? EXIT.GREEN : EXIT.MEMBER_FAILED
}

async function main() {
  let opts
  try {
    opts = parseArgs(process.argv.slice(2))
  } catch (err) {
    emitError(err instanceof Error ? err.message : String(err))
    process.exitCode = EXIT.RUNNER_ERROR
    return
  }
  if (opts.help) {
    for (const line of usage()) emit(line)
    return
  }
  if (opts.selfTest) {
    selfTest()
    return
  }
  try {
    process.exitCode = runAggregate(opts)
  } catch (err) {
    emitError(err instanceof Error ? err.message : String(err))
    process.exitCode = EXIT.RUNNER_ERROR
  }
}

// `process.exitCode` (never `process.exit()`) so a piped stdout is fully flushed before the process
// ends — the self-test reads this process through pipes, and a hard exit can truncate the transcript.
await main()
