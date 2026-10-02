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
// `./scripts/verify-rows-parity.ts`, `verify:docs` -> `./scripts/verify-docs-parity.ts`). Every
// path-qualified command is written in the `./` form (T-89) and is printed that way too.
//
// Members run in the CALLER's working directory — the repo root under `bun run verify:gates`.
//
// Usage:
//   node ./scripts/verify-gates.ts                      run the declared member table, then report
//   node ./scripts/verify-gates.ts --list               resolve + print the member table; spawns NOTHING
//   node ./scripts/verify-gates.ts --self-test          every arm on TEMP fixtures (never the tree)
//   node ./scripts/verify-gates.ts --member <id>=<command>     repeatable; REPLACES the declared table
//   node ./scripts/verify-gates.ts --members-file <json>       JSON array of {id, argv}, or {"members": [...]}
//   node ./scripts/verify-gates.ts --help
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
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import type { SpawnSyncReturns } from "node:child_process"
import { readJson } from "./lib/repo.ts"

/** The line prefix every byte this script writes carries, on stdout and on stderr alike. */
const TAG: string = "[verify-gates]"
/** This script's own path, handed to every child aggregate so a run re-enters the same code. */
const SELF: string = fileURLToPath(import.meta.url)
/** The repository root, resolved from this file's own location under `<root>/scripts/`. */
const REPO_ROOT: string = resolve(dirname(SELF), "..")
/** The runner's exit-code contract, `as const` so the three codes stay literals instead of widening. */
const EXIT = { GREEN: 0, MEMBER_FAILED: 1, RUNNER_ERROR: 2 } as const
// A member that overflows the capture buffer is reported FAIL: a truncated transcript is not evidence.
const MAX_BUFFER: number = 64 * 1024 * 1024
// Echo cap per member per stream, always with an explicit suppression line (never a silent cut).
const MAX_ECHO_LINES: number = 400

// ─── THE MEMBER TABLE (the ONE declaration point: a member is added here, nowhere else) ───────────

/** One member gate of the resolved table: the id its verdict line carries and the argv to spawn. */
interface Member {
  /** Stable member id matching [A-Za-z0-9._-]+, which is the shape the verdict line and census parse. */
  readonly id: string
  /** The child command as an argv array: element 0 is the executable, never a shell string. */
  readonly argv: readonly string[]
}

/** The member gates this aggregate sweeps, in order: the `verify:gates` chain resolved verbatim. */
const DECLARED_MEMBERS: readonly Member[] = [
  { id: "vendor", argv: ["node", "./scripts/verify-vendor.ts"] },
  { id: "dist-fresh", argv: ["node", "./scripts/verify-dist-fresh.ts"] },
  { id: "rows-parity", argv: ["node", "./scripts/verify-rows-parity.ts"] },
  { id: "docs-parity", argv: ["node", "./scripts/verify-docs-parity.ts"] },
  { id: "preset-conformance", argv: ["node", "./skills/dsh-qa/scripts/preset-conformance.ts", "--self-test"] },
  // The two install-time rules (no cordis dependency, no lifecycle script) plus the packaging
  // contract that makes `dsh plugin --profile <p> add <spec>` work from a published package. `--pack`
  // asks npm for the real packlist, which is the ground truth the manifest's `files` allowlist is
  // only an implementation of.
  { id: "plugin-manifest", argv: ["node", "./scripts/verify-plugin-manifest.ts", "--pack"] },
  // Every declaration in the TypeScript source set carries a precise comment and every named
  // function spells out its parameter and return types.
  { id: "comment-coverage", argv: ["node", "./scripts/verify-comment-coverage.ts"] },
  // Every `.github/workflows/*.yml` must be LOADABLE YAML with a sane job/step shape. This member
  // exists because the failure it catches is invisible to every other one: GitHub rejects an
  // unloadable workflow at LOAD time — the run appears, fails in 0 s, creates NO job and no step
  // logs — so a single bad scalar in the workflow file silently disables this whole table at once
  // (measured 2026-09-28..2026-10-02: five pushes, zero jobs, no gate able to see it).
  { id: "workflows", argv: ["node", "./scripts/verify-workflows.ts"] },
]

/** The `--help` text: every option, the override rule, the exit codes and the census grammar. */
function usage(): readonly string[] {
  return [
    `${TAG} usage: node ./scripts/verify-gates.ts [options]`,
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
function emit(line: string): void {
  // `text` is the line as written: already prefixed when the caller prefixed it, else prefixed here.
  const text: string = line.startsWith(TAG) ? line : `${TAG} ${line}`
  process.stdout.write(text + "\n")
}

/** The stderr twin of {@link emit}, enforcing the same prefix invariant on the error stream. */
function emitError(line: string): void {
  // `text` is the line as written to stderr, prefixed for the same greppability reason as stdout.
  const text: string = line.startsWith(TAG) ? line : `${TAG} ${line}`
  process.stderr.write(text + "\n")
}

/** Render an argv as one command string, quoting any token that contains whitespace. */
const formatCommand = (argv: readonly string[]): string => argv.map((token: string): string => (/\s/.test(token) ? JSON.stringify(token) : token)).join(" ")

// `--member` command strings are whitespace-tokenized; `"`/`'` group one token so a path with spaces
// stays a single argument.
function tokenizeCommand(text: string): string[] {
  // `raw` is every whitespace-separated token, a quoted run counting as one token.
  const raw: string[] = text.match(/"[^"]*"|'[^']*'|\S+/g) ?? []
  return raw.map((token: string): string => {
    // `quoted` is true only when the token is wrapped in a MATCHING pair of the same quote character.
    const quoted: boolean = token.length >= 2 && (token.startsWith('"') || token.startsWith("'")) && token.endsWith(token[0])
    return quoted ? token.slice(1, -1) : token
  })
}

/** Parsed CLI options: which mode to run plus the member-table overrides the caller supplied. */
interface ParsedArgs {
  /** Whether `--self-test` was passed; every arm then runs on temp fixtures. */
  selfTest: boolean
  /** Whether `--list` was passed; the table is resolved and printed without spawning anything. */
  list: boolean
  /** Whether `--help`/`-h` was passed; the usage text is printed and the run ends green. */
  help: boolean
  /** The `--members-file` path, or null when no file was supplied. */
  membersFile: string | null
  /** The raw `--member <id>=<command>` specs in argv order, appended after the file's entries. */
  memberSpecs: string[]
}

/** Parse the CLI flags; an unknown flag is a runner error, never a silently ignored argument. */
function parseArgs(argv: readonly string[]): ParsedArgs {
  // `opts` is the option record, mutated in place as each flag is read.
  const opts: ParsedArgs = { selfTest: false, list: false, help: false, membersFile: null, memberSpecs: [] }
  // `i` walks the argv; `--member` and `--members-file` also consume the token that follows them.
  for (let i = 0; i < argv.length; i += 1) {
    // `arg` is the flag at this position.
    const arg: string = argv[i]
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
    else throw new Error(`unknown argument "${arg}" (run node ./scripts/verify-gates.ts --help)`)
  }
  return opts
}

/** Read the value of a flag whose argument follows it, refusing a flag that ends the argv. */
function requireValue(argv: readonly string[], index: number, flag: string): string {
  // `value` is the token at `index`, undefined when the flag was the very last argv element.
  const value: string | undefined = argv[index]
  if (value === undefined) throw new Error(`${flag} needs a value`)
  return value
}

/** Parse one `--member <id>=<command>` spec into the same {id, argv} shape the declared table uses. */
function parseMemberSpec(spec: string): Member {
  // `eq` is the offset of the `=` that splits the id from its command.
  const eq: number = spec.indexOf("=")
  if (eq <= 0) throw new Error(`--member expects <id>=<command>, got: ${spec}`)
  // `id` is the id half of the spec, trimmed of surrounding blanks.
  const id: string = spec.slice(0, eq).trim()
  // `argv` is the tokenized command half, which must name at least one token.
  const argv: string[] = tokenizeCommand(spec.slice(eq + 1))
  if (id === "") throw new Error(`--member needs a non-empty id: ${spec}`)
  if (argv.length === 0) throw new Error(`--member ${id} needs a non-empty command`)
  return { id, argv }
}

// The override boundary: parse the JSON into the SAME {id, argv} shape the declared table uses, and
// refuse anything that would make the per-member census lie.
function readMembersFile(file: string): Member[] {
  // `parsed` is the document as read; its shape is narrowed below before any entry is believed.
  let parsed: unknown
  try {
    parsed = readJson(resolve(file))
  } catch (err) {
    throw new Error(`--members-file ${file}: ${err instanceof Error ? err.message : String(err)}`)
  }
  // The document is only known to be JSON, so `members` is read structurally and validated below.
  const candidate: unknown = Array.isArray(parsed) ? parsed : (parsed as { members?: unknown } | null)?.members
  if (!Array.isArray(candidate)) throw new Error(`--members-file ${file}: expected a JSON array of {id, argv} entries, or {"members": [...]}`)
  return candidate.map((entry: unknown, index: number): Member => {
    // `at` is where this entry lives in the file, named by every refusal below.
    const at: string = `${file}[${index}]`
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) throw new Error(`${at}: expected an object with {id, argv}`)
    // `record` is the entry read as a string-keyed object, which the shape check above established.
    const record = entry as Record<string, unknown>
    // `id` is the raw id field, accepted only as a non-empty string.
    const id: unknown = record.id
    if (typeof id !== "string" || id.trim() === "") throw new Error(`${at}: "id" must be a non-empty string`)
    // `tokens` is the raw argv field, validated as a non-empty array of non-empty strings.
    const tokens: unknown = record.argv
    if (!Array.isArray(tokens) || tokens.length === 0 || !tokens.every((token: unknown): boolean => typeof token === "string" && token !== "")) {
      throw new Error(`${at}: "argv" must be a non-empty array of non-empty strings`)
    }
    // The guard above proved every element is a non-empty string, so this predicate only restates it.
    const argv: string[] = tokens.filter((token: unknown): token is string => typeof token === "string")
    return { id: id.trim(), argv }
  })
}

/** The resolved sweep subject: the members to run and where that list came from. */
interface ResolvedMembers {
  /** The members to run, in table order. */
  readonly members: Member[]
  /** True when the list is the declared table; false when a caller-supplied override replaced it. */
  readonly declared: boolean
}

/** Resolve the sweep subject and refuse any table that would make the per-member census lie. */
function resolveMembers(opts: ParsedArgs): ResolvedMembers {
  // `override` is true when the caller supplied ANY member source, which replaces the declared table.
  const override: boolean = opts.membersFile !== null || opts.memberSpecs.length > 0
  // `supplied` collects the caller's members: the file's entries first, then the `--member` ones.
  const supplied: Member[] = []
  if (opts.membersFile !== null) supplied.push(...readMembersFile(opts.membersFile))
  for (const spec of opts.memberSpecs) supplied.push(parseMemberSpec(spec))
  // `members` is the sweep subject: the override list as given, or a copy of the declared table.
  const members: Member[] = override ? supplied : DECLARED_MEMBERS.map((member: Member): Member => ({ id: member.id, argv: [...member.argv] }))
  if (members.length === 0) {
    throw new Error("the member table is empty — refusing to report a sweep over zero members (pass the declared table, --members-file <json>, or --member <id>=<command>)")
  }
  // `seen` records every id already accepted, so a duplicate is refused rather than printed twice.
  const seen = new Set<string>()
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
function echoStream(id: string, stream: string, text: string): void {
  // `lines` is the transcript split on newlines, minus the empty tail a trailing newline produces.
  const lines: string[] = text.split("\n")
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop()
  // `shown` is the head of the transcript that survives the per-member per-stream echo cap.
  const shown: string[] = lines.slice(0, MAX_ECHO_LINES)
  // `line` is one echoed transcript line, prefixed with the member id and the stream it came from.
  for (const line of shown) emit(`${TAG} ${id} ${stream}| ${line}`)
  if (lines.length > shown.length) emit(`${TAG} ${id} ${stream}| ... ${lines.length - shown.length} more line(s) suppressed (cap ${MAX_ECHO_LINES})`)
}

/** Describe why a spawned member is not a plain exit-code result, or null when it is one. */
function describeSpawn(res: SpawnSyncReturns<string>): string | null {
  if (res.error) {
    // The runtime error is errno-shaped; `Error` declares no `code`, so the standard errno view is used.
    const errno = res.error as NodeJS.ErrnoException
    if (errno.code === "ENOBUFS") return `output exceeded the ${MAX_BUFFER}-byte capture limit`
    return `spawn error: ${errno.code ?? errno.message}`
  }
  if (res.signal) return `killed by signal ${res.signal}`
  return null
}

/** One member's outcome in the sweep, kept in table order for the final census. */
interface MemberResult {
  /** The member id the verdict line carried. */
  readonly id: string
  /** The member's exit status, or null when it never exited (spawn error or a signal). */
  readonly exitCode: number | null
  /** PASS only when the member spawned, exited 0 and was not signalled. */
  readonly verdict: string
}

/** Run every resolved member (or list them), print each verdict, and return the aggregate exit code. */
function runAggregate(opts: ParsedArgs): number {
  // `members` and `declared` are the resolved table and its provenance, both named on the first line.
  const { members, declared } = resolveMembers(opts)
  emit(`${TAG} ${opts.list ? "resolving" : "running"} ${members.length} member gate(s) (${declared ? "declared table" : "override table"})`)
  if (opts.list) {
    // `member` is one resolved table row, printed with the exact command the run would spawn.
    for (const member of members) emit(`${TAG} member ${member.id} :: ${formatCommand(member.argv)}`)
    emit(`${TAG} list OK: ${members.length} member gate(s) resolved, 0 spawned`)
    return EXIT.GREEN
  }
  // `results` collects one verdict per member, in table order, for the final summary line.
  const results: MemberResult[] = []
  // NO early exit: a red member never stops the sweep, it only marks the aggregate red at the end.
  for (const member of members) {
    emit(`${TAG} member ${member.id} :: ${formatCommand(member.argv)}`)
    // `started` is the wall-clock instant this member's elapsed time is measured from.
    const started: number = Date.now()
    // `res` is the member's captured run: both streams are piped so they can be echoed under the prefix.
    const res = spawnSync(member.argv[0], member.argv.slice(1), {
      cwd: process.cwd(),
      encoding: "utf8",
      maxBuffer: MAX_BUFFER,
      stdio: ["ignore", "pipe", "pipe"],
    })
    // `elapsedMs` is how long the member took, printed when there is no other note to print.
    const elapsedMs: number = Date.now() - started
    echoStream(member.id, "out", res.stdout ?? "")
    echoStream(member.id, "err", res.stderr ?? "")
    // `note` is the reason a member is FAIL despite a zero exit, or null for a plain exit-code result.
    const note: string | null = describeSpawn(res)
    // `verdict` is PASS only when nothing went wrong AND the member exited 0.
    const verdict: string = note === null && res.status === 0 ? "PASS" : "FAIL"
    emit(`${TAG} member ${member.id}: exit=${res.status === null ? "n/a" : res.status} ${verdict} - ${note ?? `${elapsedMs}ms`}`)
    results.push({ id: member.id, exitCode: res.status, verdict })
  }
  // `failed` is every member whose verdict was not PASS, named on the summary line in table order.
  const failed: MemberResult[] = results.filter((result: MemberResult): boolean => result.verdict !== "PASS")
  if (failed.length === 0) {
    emit(`${TAG} PASS - ${results.length}/${results.length} member gate(s) green`)
  } else {
    // `named` is the summary tail: each failing member with the exit code that reddened it.
    const named: string = failed.map((result: MemberResult): string => `${result.id} (exit=${result.exitCode === null ? "n/a" : result.exitCode})`).join(", ")
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
const FIXTURE_NAME: string = "fixture-member.mjs"
/** The fixture member's source: exit with argv[2], print one stdout line (and one stderr line on failure). */
const FIXTURE_SOURCE: string = [
  'const code = Number(process.argv[2] ?? "0")',
  'const id = process.argv[3] ?? "member"',
  'process.stdout.write("fixture " + id + " stdout\\n")',
  'if (code !== 0) process.stderr.write("fixture " + id + " failed\\n")',
  "process.exit(Number.isFinite(code) ? code : 2)",
  "",
].join("\n")

/** Matches one member verdict line, capturing its id, exit token and PASS/FAIL word. */
const VERDICT_RE: RegExp = /^\[verify-gates\] member (\S+): exit=(\S+) (PASS|FAIL)(?: - .*)?$/
/** Matches one `--list` table line, capturing the member id and the command text after `::`. */
const LIST_RE: RegExp = /^\[verify-gates\] member (\S+) :: (.+)$/

/** Throw with the arm's own evidence message when an assertion does not hold. */
function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

/** Compare two primitives by identity and throw with both sides rendered, which is how arms assert. */
function assertEquals(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
}

/** One parsed verdict line: the member id, its exit token, and the verdict word exactly as printed. */
interface VerdictLine {
  /** The member id between `member ` and `:`. */
  readonly id: string
  /** The exit token as printed: a number, or `n/a` for a member with no numeric status. */
  readonly exit: string
  /** The verdict word as printed, PASS or FAIL. */
  readonly verdict: string
}

/** Extract every member verdict line from an aggregate's stdout, in printed order. */
function verdictLines(stdout: string): VerdictLine[] {
  return stdout
    .split("\n")
    .map((line: string): RegExpExecArray | null => VERDICT_RE.exec(line))
    .filter((match: RegExpExecArray | null): match is RegExpExecArray => match !== null)
    .map((match: RegExpExecArray): VerdictLine => ({ id: match[1], exit: match[2], verdict: match[3] }))
}

/** One parsed `--list` line: the member id and the command text after `::`. */
interface ListLine {
  /** The member id between `member ` and ` ::`. */
  readonly id: string
  /** The formatted command, which must keep the `./` path-qualified form (T-89). */
  readonly command: string
}

/** Extract every `--list` table line from an aggregate's stdout, in printed order. */
function listLines(stdout: string): ListLine[] {
  return stdout
    .split("\n")
    .map((line: string): RegExpExecArray | null => LIST_RE.exec(line))
    .filter((match: RegExpExecArray | null): match is RegExpExecArray => match !== null)
    .map((match: RegExpExecArray): ListLine => ({ id: match[1], command: match[2] }))
}

/** One aggregate child run observed by the self-test: its argv, cwd, exit status and both streams. */
interface AggregateRun {
  /** The flags the child aggregate was spawned with (the executable itself is not repeated here). */
  readonly args: readonly string[]
  /** The working directory the child ran in, which the declared-table arm varies on purpose. */
  readonly cwd: string
  /** The child's exit status, or null when it was killed by a signal. */
  readonly exitCode: number | null
  /** The child's captured stdout. */
  readonly stdout: string
  /** The child's captured stderr. */
  readonly stderr: string
  /** The spawn error when the child could not be started at all, else undefined. */
  readonly error: Error | undefined
}

// The shared invariants every arm inherits: the child really ran, it printed something, and every line
// it printed carries the prefix. A run that prints nothing can never pass an arm.
function assertAggregateOutput(run: AggregateRun, label: string): void {
  if (run.error) throw new Error(`${label}: the aggregate could not be spawned: ${run.error.message}`)
  // `lines` is everything the child printed on both streams, with its empty lines dropped.
  const lines: string[] = [...run.stdout.split("\n"), ...run.stderr.split("\n")].filter((line: string): boolean => line !== "")
  assert(lines.length > 0, `${label}: the aggregate printed NOTHING — an empty transcript is not a sweep`)
  // `unprefixed` is every printed line missing the prefix, which is a breach of this script's contract.
  const unprefixed: string[] = lines.filter((line: string): boolean => !line.startsWith(TAG))
  assert(unprefixed.length === 0, `${label}: ${unprefixed.length} line(s) are not prefixed ${TAG}: ${JSON.stringify(unprefixed[0])}`)
}

/** Spawn this same script as a child aggregate and capture its exit status and both streams. */
function spawnAggregate(args: readonly string[], cwd: string): AggregateRun {
  // `res` is the raw spawn result the run record below is built from.
  const res = spawnSync(process.execPath, [SELF, ...args], { cwd, encoding: "utf8", maxBuffer: MAX_BUFFER, stdio: ["ignore", "pipe", "pipe"] })
  return { args, cwd, exitCode: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "", error: res.error }
}

/** One self-test arm: a stable name plus the check returning its evidence or throwing on failure. */
interface Arm {
  /** The arm's stable name, printed on its census line. */
  readonly name: string
  /** Run the arm's assertions and return the evidence sentence a PASS prints. */
  readonly check: () => string
}

/** Build the self-test arms, all of which run against `dir`, a temp directory holding the fixtures. */
function buildArms(dir: string): Arm[] {
  /** Write one fixture file into the temp root and return the `./`-relative path members use. */
  const writeFixtureJson = (name: string, text: string): string => {
    writeFileSync(join(dir, name), text)
    return `./${name}`
  }
  /** Build the {id, argv} table whose i-th member exits with `codes[i]`, ids `m0`, `m1`, … */
  const fixtureTable = (codes: readonly number[]): Member[] =>
    codes.map((code: number, index: number): Member => ({ id: `m${index}`, argv: [process.execPath, `./${FIXTURE_NAME}`, String(code), `m${index}`] }))
  /** Spell the same table as `--member=<id>=<command>` flags, the CLI-override route into the runner. */
  const memberFlags = (codes: readonly number[]): string[] => fixtureTable(codes).map((member: Member): string => `--member=${member.id}=${formatCommand(member.argv)}`)
  /** The ids every "all members reported" assertion compares against: m0..m4, in table order. */
  const expectedIds: string = fixtureTable([0, 0, 0, 0, 0]).map((member: Member): string => member.id).join(",")
  /** Extract the reported member ids from a run's verdict lines, in printed order. */
  const reportedIds = (run: AggregateRun): string => verdictLines(run.stdout).map((verdict: VerdictLine): string => verdict.id).join(",")

  return [
    {
      name: "default-path-resolves-declared-table",
      check: (): string => {
        // The default path (no member override) is exercised HERE, twice: from the repo root exactly as
        // `bun run verify:gates` would call it, and from a temp dir. `--list` spawns nothing, so the live
        // member gates stay out of this lane's verify.
        const fromRepo: AggregateRun = spawnAggregate(["--list"], REPO_ROOT)
        // `fromTemp` is the same `--list` run from a temp cwd, which must resolve the identical table.
        const fromTemp: AggregateRun = spawnAggregate(["--list"], dir)
        // `runs` pairs each working directory's label with its run, so one loop asserts both of them.
        const runs: ReadonlyArray<readonly [string, AggregateRun]> = [["repo root", fromRepo], ["temp dir", fromTemp]]
        // `label` names the working directory the run came from; `run` is that run itself.
        for (const [label, run] of runs) {
          assertAggregateOutput(run, `--list from ${label}`)
          assertEquals(run.exitCode, EXIT.GREEN, `--list exit code from ${label}`)
          assertEquals(verdictLines(run.stdout).length, 0, `--list from ${label} must spawn no member`)
          assertEquals(listLines(run.stdout).map((entry: ListLine): string => entry.id).join(","), DECLARED_MEMBERS.map((member: Member): string => member.id).join(","), `declared member ids from ${label}`)
          assert(
            listLines(run.stdout).every((entry: ListLine): boolean => entry.command.includes(" ./")),
            `--list from ${label}: a declared command is not path-qualified with ./ (T-89)`,
          )
        }
        assertEquals(fromRepo.stdout, fromTemp.stdout, "the declared table must not depend on the working directory")
        return `${DECLARED_MEMBERS.length} declared member(s), ./ command forms, 0 spawned`
      },
    },
    {
      name: "all-green-fixture-reports-every-member",
      check: (): string => {
        // `file` is the temp members file the child aggregate reads its table from.
        const file: string = writeFixtureJson("members-green.json", JSON.stringify(fixtureTable([0, 0, 0, 0, 0])))
        // `run` is the child aggregate's run over that all-green fixture table.
        const run: AggregateRun = spawnAggregate([`--members-file=${file}`], dir)
        assertAggregateOutput(run, "all-green fixture")
        assertEquals(run.exitCode, EXIT.GREEN, "all-green fixture exit code")
        assertEquals(reportedIds(run), expectedIds, "every member reported, in table order")
        // `verdicts` is the parsed verdict lines, one per member, in printed order.
        const verdicts: VerdictLine[] = verdictLines(run.stdout)
        assert(verdicts.every((verdict: VerdictLine): boolean => verdict.verdict === "PASS" && verdict.exit === "0"), "every verdict line must carry exit=0 PASS")
        assert(run.stdout.includes(`${TAG} PASS - 5/5 member gate(s) green`), "the green summary line must count all 5 members")
        assert(run.stdout.includes(`${TAG} m0 out| fixture m0 stdout`), "the member's own output must be echoed (a silent run must fail this arm)")
        return "5/5 green, 5 verdict lines, transcript echoed"
      },
    },
    {
      name: "first-member-red-still-reports-the-rest",
      check: (): string => {
        // `run` is the aggregate run whose FIRST member is red and whose other four must still report.
        const run: AggregateRun = spawnAggregate(memberFlags([1, 0, 0, 0, 0]), dir)
        assertAggregateOutput(run, "first-member-red fixture (--member route)")
        assertEquals(run.exitCode, EXIT.MEMBER_FAILED, "exit code with m0 red")
        assertEquals(reportedIds(run), expectedIds, "ALL members must be reported when the FIRST one fails")
        // `verdicts` is the parsed verdict lines, whose first entry must be the red member.
        const verdicts: VerdictLine[] = verdictLines(run.stdout)
        assertEquals(verdicts[0].verdict, "FAIL", "m0's own verdict")
        assert(verdicts.slice(1).every((verdict: VerdictLine): boolean => verdict.verdict === "PASS"), "members AFTER the failure must still report their own PASS")
        assert(run.stdout.includes(`${TAG} FAIL - 1/5 member gate(s) failed: m0 (exit=1)`), "the failing member must be named on the summary line")
        assert(run.stdout.includes(`${TAG} m0 err| fixture m0 failed`), "the failing member's stderr must be echoed")
        return "m0 red: 5/5 reported, exit 1, summary names m0 (exit=1)"
      },
    },
    {
      name: "middle-member-red-still-reports-later-members",
      check: (): string => {
        // `file` is the temp members file whose third member (m2) is red.
        const file: string = writeFixtureJson("members-middle-red.json", JSON.stringify(fixtureTable([0, 0, 1, 0, 0])))
        // `run` is the aggregate run over that middle-red fixture table.
        const run: AggregateRun = spawnAggregate([`--members-file=${file}`], dir)
        assertAggregateOutput(run, "middle-member-red fixture (--members-file route)")
        assertEquals(run.exitCode, EXIT.MEMBER_FAILED, "exit code with m2 red")
        assertEquals(reportedIds(run), expectedIds, "ALL members must be reported when a MIDDLE one fails")
        // `verdicts` is the parsed verdict lines, whose third entry must be the red member.
        const verdicts: VerdictLine[] = verdictLines(run.stdout)
        assertEquals(verdicts[2].verdict, "FAIL", "m2's own verdict")
        assert(verdicts[3].verdict === "PASS" && verdicts[4].verdict === "PASS", "the members AFTER the red one must still run and report")
        assert(run.stdout.includes(`${TAG} FAIL - 1/5 member gate(s) failed: m2 (exit=1)`), "the failing middle member must be named")
        return "m2 red: 5/5 reported, m3+m4 still PASS, exit 1"
      },
    },
    {
      name: "two-members-red-are-both-named",
      check: (): string => {
        // `file` is the temp members file with two red members: m0 and m3.
        const file: string = writeFixtureJson("members-two-red.json", JSON.stringify(fixtureTable([1, 0, 0, 1, 0])))
        // `run` is the aggregate run over that two-red fixture table.
        const run: AggregateRun = spawnAggregate([`--members-file=${file}`], dir)
        assertAggregateOutput(run, "two-members-red fixture")
        assertEquals(run.exitCode, EXIT.MEMBER_FAILED, "exit code with two red members")
        assertEquals(reportedIds(run), expectedIds, "ALL members must be reported with two red members")
        assert(run.stdout.includes(`${TAG} FAIL - 2/5 member gate(s) failed: m0 (exit=1), m3 (exit=1)`), "BOTH failing members must be named, in table order")
        return "m0+m3 red: 5/5 reported, both named, exit 1"
      },
    },
    {
      name: "empty-member-table-is-refused",
      check: (): string => {
        // `file` is the temp members file holding an empty JSON array.
        const file: string = writeFixtureJson("members-empty.json", "[]\n")
        // `run` is the aggregate run that must refuse the empty table instead of reporting a green sweep.
        const run: AggregateRun = spawnAggregate([`--members-file=${file}`], dir)
        assertAggregateOutput(run, "empty member table")
        assertEquals(run.exitCode, EXIT.RUNNER_ERROR, "an empty member table must be a runner error, never a green sweep")
        assertEquals(verdictLines(run.stdout).length, 0, "no member may be reported for an empty table")
        assert(run.stderr.includes("member table is empty"), "the refusal must name the empty member table")
        return "empty table refused, exit 2, 0 members reported"
      },
    },
    {
      name: "malformed-members-file-is-refused",
      check: (): string => {
        // `file` is the temp members file holding deliberately truncated JSON.
        const file: string = writeFixtureJson("members-broken.json", '{ "members": [\n')
        // `run` is the aggregate run that must refuse the unparsable document.
        const run: AggregateRun = spawnAggregate([`--members-file=${file}`], dir)
        assertAggregateOutput(run, "malformed members file")
        assertEquals(run.exitCode, EXIT.RUNNER_ERROR, "a malformed members file must be a runner error")
        assertEquals(verdictLines(run.stdout).length, 0, "no member may be reported for an unparsable table")
        assert(run.stderr.includes("members-broken.json"), "the refusal must name the offending file")
        return "malformed JSON refused, exit 2, file named"
      },
    },
    {
      name: "duplicate-member-id-is-refused",
      check: (): string => {
        // `duplicate` is a table that spells the same member id twice on purpose.
        const duplicate: readonly Member[] = [
          { id: "dup", argv: ["node", "./a.mjs"] },
          { id: "dup", argv: ["node", "./b.mjs"] },
        ]
        // `file` is the temp members file holding that duplicate table.
        const file: string = writeFixtureJson("members-duplicate.json", JSON.stringify(duplicate))
        // `run` is the aggregate run that must refuse the duplicate id before spawning anything.
        const run: AggregateRun = spawnAggregate([`--members-file=${file}`], dir)
        assertAggregateOutput(run, "duplicate member id")
        assertEquals(run.exitCode, EXIT.RUNNER_ERROR, "a duplicate member id must be a runner error")
        assertEquals(verdictLines(run.stdout).length, 0, "no member may be reported for a duplicate table")
        assert(run.stderr.includes('duplicate member id "dup"'), "the refusal must name the duplicate id")
        return "duplicate id refused, exit 2, id named"
      },
    },
    {
      name: "invalid-member-id-is-refused",
      check: (): string => {
        // `bad id` cannot be spelled on a verdict line, so it must never reach the run loop.
        // `run` is the aggregate run whose single `--member` id carries a space and so cannot be printed.
        const run: AggregateRun = spawnAggregate(["--member=bad id=node ./never-runs.mjs"], dir)
        assertAggregateOutput(run, "invalid member id")
        assertEquals(run.exitCode, EXIT.RUNNER_ERROR, "a member id outside [A-Za-z0-9._-]+ must be a runner error")
        assertEquals(verdictLines(run.stdout).length, 0, "no member may be reported for an unspellable id")
        assert(run.stderr.includes("must match [A-Za-z0-9._-]+"), "the refusal must name the id grammar")
        return "invalid id refused, exit 2, grammar named"
      },
    },
  ]
}

/** One arm's census entry: its name, whether it held, and the sentence printed after PASS/FAIL. */
interface ReportEntry {
  /** The arm's stable name. */
  readonly arm: string
  /** Whether every assertion in the arm held. */
  readonly ok: boolean
  /** The arm's evidence sentence, or the failure message that reddened it. */
  readonly note: string
}

/** Run every arm on temp fixtures and print the census; exit code follows the arm outcomes. */
function selfTest(): void {
  // `report` accumulates one census entry per arm, in the order the arms ran.
  const report: ReportEntry[] = []
  // `dir` is the temp fixture root, or null while it has not been created yet.
  let dir: string | null = null
  // `setupError` carries a fixture-SETUP failure so the census still ends in its own grammar.
  let setupError: string | null = null
  try {
    dir = mkdtempSync(join(tmpdir(), "verify-gates-self-test-"))
    assert(resolve(dir).startsWith(resolve(tmpdir())), `the fixture root must be a temp dir, got ${dir}`)
    writeFileSync(join(dir, FIXTURE_NAME), FIXTURE_SOURCE)
    // `arm` is one self-test arm, run in the order the table declares.
    for (const arm of buildArms(dir)) {
      try {
        report.push({ arm: arm.name, ok: true, note: arm.check() })
      } catch (err) {
        report.push({ arm: arm.name, ok: false, note: err instanceof Error ? err.message : String(err) })
      }
      // `entry` is the census entry just pushed, printed with its own PASS/FAIL verdict.
      const entry: ReportEntry = report[report.length - 1]
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
  // `failed` counts the census entries that did not hold; the census line reports the complement.
  const failed: number = report.filter((entry: ReportEntry): boolean => !entry.ok).length
  // The census line carries <passed>/<total> in BOTH branches, matching the "PASS: N/N arms" grammar.
  emit(`${TAG} self-test ${failed === 0 ? "PASS" : "FAIL"}: ${report.length - failed}/${report.length} arms`)
  process.exitCode = failed === 0 ? EXIT.GREEN : EXIT.MEMBER_FAILED
}

/** Parse the CLI, dispatch to the requested mode, and set the process exit code. */
async function main(): Promise<void> {
  // `opts` is the parsed option set; the catch below returns, so it is assigned before any later use.
  let opts: ParsedArgs
  try {
    opts = parseArgs(process.argv.slice(2))
  } catch (err) {
    emitError(err instanceof Error ? err.message : String(err))
    process.exitCode = EXIT.RUNNER_ERROR
    return
  }
  if (opts.help) {
    // `line` is one usage line, emitted through the shared prefixing writer.
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
