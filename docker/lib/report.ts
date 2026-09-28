#!/usr/bin/env node
// docker/lib/report.ts — assemble /out/result.json + /out/output.log from the run's state.
//
// WHY A SEPARATE REPORTER: the verdict must be COMPLETE even when the run aborts early (apt
// failure, install failure). The entrypoint records what it observed and then calls this script,
// which knows the canonical assertion list and emits every name it never saw as
// `{ok: null, reason: "not reached: ..."}`. That is the honest shape the task asks for — an
// assertion that could not be evaluated is never silently dropped and never rendered as a pass.
//
// Exit code: 0 when no assertion is FALSE (nulls are reported, not fatal), 1 when any is false,
// 2 when the state is unreadable.
//
// Redaction (AGENTS.md §10): the boot log carries the local Web UI URL with its `?token=`, and the
// evidence must not contain token material. Every byte written by this script passes through
// redact() first.
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"

/** One sha256 anchor of the run, as parsed out of `hashes.tsv`. */
interface HashRow {
  /** The 64-hex digest the entrypoint recorded. */
  sha256: string
  /** The path the digest belongs to. */
  path: string
}

/** One executed step of the run, as parsed out of `steps.tsv` plus its log file. */
interface StepRow {
  /** The step id (for example `08-rebuild`). */
  id: string
  /** The step's exit status. */
  exit: number
  /** Wall-clock seconds the step took. */
  seconds: number
  /** The command line that was run. */
  cmd: string
  /** The log file name inside `<work>/steps/`. */
  logFile: string
  /** Size of that log file in bytes (0 when it was never written). */
  logBytes: number
  /** The last 30 lines of the redacted log, for the human-readable report. */
  tail: string[]
  /** The full redacted log body — kept out of result.json, present in output.log. */
  body: string
}

/** One entry of `result.assertions[]`, after canonical ordering and redaction. */
interface ReportAssertion {
  /** The canonical assertion name, or a name the run reported beyond the canonical list. */
  name: string
  /** The recorded verdict: `true`, `false`, or `null` when the run never reached it. */
  ok: unknown
  /** Why the verdict is what it is, redacted. */
  reason: string
  /** The raw witness line that justified the verdict, redacted. */
  raw: string
}

/** The summary block of result.json: the counts plus the names behind the failure/null verdicts. */
interface ResultSummary {
  /** How many assertions the report carries in total. */
  total: number
  /** How many are `true`. */
  passed: number
  /** How many are `false`. */
  failed: number
  /** How many could not be evaluated. */
  null: number
  /** The names of the false assertions. */
  failedNames: readonly string[]
  /** The names of the unevaluated assertions. */
  nullNames: readonly string[]
}

/** The harness block of result.json: what this run certifies, restated so no reader has to infer it. */
interface ResultHarness {
  /** The `@deepseek-ai/dsh` version the container actually installed. */
  installed: string | null
  /** The version the run pinned and asserted. */
  expected: string | null
  /** The assertion name that grades the pair above. */
  assertion: string
  /** The Node major/minor the container installed. */
  node: string | null
  /** The bun version the container installed. */
  bun: string | null
  /** The pnpm version the container installed. */
  pnpm: string | null
  /** The container base image. */
  ubuntu: string | null
}

/** The whole result.json document, assembled in memory before it is written. */
interface RunResult {
  /** The case id this report belongs to. */
  case: string
  /** One-line human description of what the case does. */
  title: string
  /** True when no assertion is false (unevaluated assertions do not make the run red). */
  ok: boolean
  /** True when every canonical assertion was reached. */
  complete: boolean
  /** The docker image tag the run used. */
  image: string
  /** ISO timestamp the run started, or `null` when the caller passed no start time. */
  startedAt: string | null
  /** ISO timestamp the report was assembled. */
  finishedAt: string
  /** Whole-run duration in seconds, or `null` without a start time. */
  durationSeconds: number | null
  /** The harness/toolchain versions this run certifies. */
  harness: ResultHarness
  /** What the run witnessed at runtime. */
  proves: readonly string[]
  /** Row-list facts that are COMPOSITION evidence only. */
  provesCompositionOnly: readonly string[]
  /** What the run deliberately does not prove. */
  doesNotProve: readonly string[]
  /** The assertion counts. */
  summary: ResultSummary
  /** Every assertion, canonical ones first, then any extra ones the run recorded. */
  assertions: ReportAssertion[]
  /** Observations the report carries but never gates on. */
  observations: Record<string, string>
  /** Facts recorded by the entrypoint. */
  facts: Record<string, string>
  /** The sha256 anchors of the measured inputs. */
  hashes: readonly HashRow[]
  /** The executed steps, without their (large) log bodies. */
  steps: readonly Omit<StepRow, "body">[]
  /** File name of the companion log inside the same output directory. */
  outputLog: string
  /** Set after assembly: true when no token-shaped value reached either artifact. */
  evidenceScrubbed?: boolean
  /** Up to three token shapes that reached the artifact (present only when a leak was found). */
  leakShapes?: readonly string[]
}

/** The command line this script was invoked with, minus the node executable and script path. */
const argv: string[] = process.argv.slice(2)
/** Read `--<flag> <value>` off the command line, or `fallback` when the flag is absent/valueless. */
const arg = (flag: string, fallback: string = ""): string => {
  // Index of the flag token, or -1 when the caller never passed it.
  const index = argv.indexOf("--" + flag)
  return index === -1 || index + 1 >= argv.length ? fallback : argv[index + 1]
}
/** The recorded run state (`assertions.ndjson`, `facts.tsv`, `hashes.tsv`, `steps.tsv`). */
const work: string = arg("work")
/** The output directory that receives `result.json` and `output.log`. */
const out: string = arg("out")
/** The docker image tag, restated in both artifacts so the evidence names its own input. */
const image: string = arg("image", "mpd-docker-e2e:local")
/** Epoch seconds the run started; 0 means "not supplied", which makes durationSeconds null. */
const started: number = Number(arg("started", "0"))
if (work === "" || out === "") {
  process.stderr.write("[report] usage: report.ts --work <dir> --out <dir> [--image <tag>] [--started <epochSeconds>]\n")
  process.exit(2)
}

/**
 * The canonical assertion list of this case. An entry the run never recorded is emitted as
 * `null` with a "not reached" reason, so a partial run still produces a complete, honest report.
 */
const EXPECTED: readonly string[] = [
  "ubuntu.version",
  "toolchain.apt",
  "toolchain.node",
  "toolchain.bun",
  "toolchain.pnpm",
  "harness.version",
  "copy.contextFiltered",
  "copy.repo",
  "build.bunInstall",
  "build.dists",
  "install.exit",
  "install.profileDep",
  "install.installedTree",
  "compose.dumpExit",
  "compose.mpdRows",
  "compose.presetRow",
  "compose.agentTeamRows",
  "boot.probeApplied",
  "boot.adapterService",
  "boot.adapterToolCall",
  "boot.mpdTools",
  "boot.agentTeamTools",
  "boot.sessionGateListener",
  "boot.agentTeamService",
  "boot.servesHttp",
  "boot.presetMount",
  "boot.noFatalSignatures",
  "isolation.home",
  "isolation.realHome",
  "isolation.noCredentials",
  // ── the DSH-TUI edition (docker/tui-lane.sh) ─────────────────────────────────
  // A developer host cannot install a global npm prefix, so the container is the ONLY
  // place the TUI profile is exercised end to end. Every one of these is a real
  // assertion; a failed boot lands as `false`, never as a silent skip.
  "tui.hostInstall",
  "tui.pluginAddHost",
  "tui.pluginAddBundle",
  "tui.compose",
  "tui.registryDefaultMpd",
  "tui.presetRow",
  "tui.mpdTuiRow",
  "tui.agentTeamRows",
  "tui.boot",
  "tui.noFatalSignatures",
  "tui.sessionPreset",
  "boot.llmTurn",
]

/**
 * View an unknown value as a string-keyed bag, so a parsed NDJSON row can be read at all.
 *
 * @param value - A value produced by `JSON.parse`.
 * @returns The value viewed as a bag, or `undefined` for a primitive (including `null`).
 */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null) return undefined
  /** The value's own type tag, tested against the two kinds that can carry properties. */
  const kind = typeof value
  // A cast is unavoidable: the rows are parsed JSON, so nothing about their shape is static.
  return kind === "object" || kind === "function" ? (value as Record<string, unknown>) : undefined
}

/** Token/credential scrubbing for EVERY byte this script writes (AGENTS.md §10). */
function redact(text: unknown): string {
  return String(text)
    .replace(/([?&]token=)[A-Za-z0-9._~+/=-]+/g, "$1<redacted>")
    .replace(/(\btoken\s*[:=]\s*)["']?[A-Za-z0-9._~+/=-]{8,}["']?/gi, "$1<redacted>")
    .replace(/(\bsk-)[A-Za-z0-9_-]{12,}/g, "$1<redacted>")
}

/** Read a state file as UTF-8, answering `fallback` when it does not exist or cannot be read. */
const readText = (path: string, fallback: string = ""): string => { try { return readFileSync(path, "utf8") } catch { return fallback } }

// ── assertions ────────────────────────────────────────────────────────────────
/** The recorder's NDJSON rows keyed by assertion name; field values stay `unknown` until read. */
const recorded = new Map<string, Record<string, unknown>>()
/** How many state lines were not readable as an assertion row. */
let corruptLines = 0
/** The last corrupt line, truncated — carried into the report as the witness for that failure. */
let lastCorrupt = ""
for (const line of readText(join(work, "assertions.ndjson")).split("\n")) {
  if (line.trim() === "") continue
  try {
    // The parsed row, still untyped until the shape check below.
    const parsed: unknown = JSON.parse(line)
    // The same row viewed as a bag, or `undefined` for a primitive line.
    const row = asRecord(parsed)
    if (row !== undefined && typeof row.name === "string") recorded.set(row.name, row)
    else { corruptLines += 1; lastCorrupt = line.slice(0, 200) }
  } catch {
    // A corrupt state line must never be dropped silently: an escaping bug in the recorder would
    // otherwise erase evidence and still produce a green report.
    corruptLines += 1
    lastCorrupt = line.slice(0, 200)
  }
}
/** The canonical assertions in order, with any unreached entry emitted as a `null` verdict. */
const assertions: ReportAssertion[] = EXPECTED.map((name) => {
  // The recorded row for this name, or `undefined` when the run never got that far.
  const row = recorded.get(name)
  if (row !== undefined) return { name, ok: row.ok ?? null, reason: redact(String(row.reason ?? "")), raw: redact(String(row.raw ?? "")) }
  return { name, ok: null, reason: "not reached: the run stopped before this assertion (see the steps in output.log)", raw: "" }
})
for (const [name, row] of recorded) {
  if (!EXPECTED.includes(name)) assertions.push({ name: redact(name), ok: row.ok ?? null, reason: redact(String(row.reason ?? "")), raw: redact(String(row.raw ?? "")) })
}
if (corruptLines > 0) {
  assertions.push({
    name: "state.corruptLine",
    ok: false,
    reason: `${corruptLines} line(s) of the assertion state file are not valid JSON — evidence was lost, so this run cannot be read as a pass`,
    raw: lastCorrupt,
  })
}

// ── facts / observations / hashes / steps ─────────────────────────────────────
/** Facts recorded by the entrypoint (`facts.tsv`). */
const facts: Record<string, string> = {}
/** Observations the report carries but never gates on (`obs.` rows of `facts.tsv`). */
const observations: Record<string, string> = {}
for (const line of readText(join(work, "facts.tsv")).split("\n")) {
  if (line.trim() === "") continue
  // The tab that separates the key from the value; a line without one is not a fact.
  const tab = line.indexOf("\t")
  if (tab === -1) continue
  // The fact key (or `obs.<name>` for an observation).
  const key = line.slice(0, tab)
  // The value that follows the first tab, tabs and all.
  const value = line.slice(tab + 1)
  if (key.startsWith("obs.")) observations[key.slice(4)] = redact(value)
  else facts[key] = value}
/** The measured sha256 anchors (`hashes.tsv`, sha256sum format). */
const hashes: HashRow[] = []
for (const line of readText(join(work, "hashes.tsv")).split("\n")) {
  if (line.trim() === "") continue
  // A sha256sum line: the digest, whitespace, an optional binary marker, then the path.
  const match = /^([0-9a-f]{64})\s+\*?(.+)$/.exec(line)
  if (match !== null) hashes.push({ sha256: match[1], path: match[2] })
}

/** The directory holding one log file per executed step. */
const stepsDir = join(work, "steps")
/** The executed steps in run order, each with its redacted log. */
const steps: StepRow[] = []
for (const line of readText(join(work, "steps.tsv")).split("\n")) {
  if (line.trim() === "") continue
  /** One step's columns: id, exit code, seconds, log path, then the command's own arguments. */
  const [id, exit, seconds, logFile, ...command] = line.split("\t")
  // The log path for this step; a missing file degrades to an empty body.
  const logPath = join(stepsDir, logFile)
  // The raw log body, redacted below before it can reach an artifact.
  const body = readText(logPath)
  steps.push({
    id,
    exit: Number(exit),
    seconds: Number(seconds),
    cmd: command.join("\t"),
    logFile,
    logBytes: existsSync(logPath) ? statSync(logPath).size : 0,
    tail: redact(body).split("\n").slice(-30),
    body,
  })
}

// ── output.log: the raw artifact a human reads first ─────────────────────────
/** The run stamp (or the report's own instant when the entrypoint recorded none). */
const stamp = facts.stamp ?? new Date().toISOString()
/** The human-readable log, assembled line by line and redacted once before it is written. */
const lines: string[] = []
lines.push("===== Docker client-install E2E (ubuntu:24.04 + compose) =====")
lines.push(`stamp:   ${stamp}`)
lines.push(`image:   ${image}`)
lines.push(`command: node scripts/docker-e2e.ts   (container: ${facts.entrypoint ?? "docker/entrypoint.sh"})`)
lines.push("")
lines.push("PROVES: a clean ubuntu:24.04 container installs node/bun/pnpm + @deepseek-ai/dsh,")
lines.push("        copies this checkout, rebuilds every packages/*/dist from source, installs the")
lines.push("        bundle with `dsh plugin --profile web add .`, composes the mpd rows, and MOUNTS")
lines.push("        the installed profile in an isolated HOME/DSH_HOME with registration")
lines.push("        instrumentation (docker/probe.ts) reading the live tool registry, plus a real")
lines.push("        `POST /api/session/create` with agentPreset=mpd (the gateway refuses on an")
lines.push("        inactive preset row).")
lines.push("DOES NOT PROVE: any live LLM turn (no credentials are staged, AGENTS.md §10); that the")
lines.push("        COMPOSED row list equals the MOUNTED row list (the dump is labelled composition")
lines.push("        only); a packed/tarball install (dist/mpd-package is not exercised here).")
lines.push("")
lines.push("===== facts =====")
for (const [key, value] of Object.entries(facts)) lines.push(`${key} = ${value}`)
lines.push("")
lines.push("===== observations (reported, never gated) =====")
for (const [key, value] of Object.entries(observations)) lines.push(`${key} = ${value}`)
lines.push("")
lines.push("===== steps =====")
for (const step of steps) {
  lines.push(`----- STEP ${step.id} (exit=${step.exit}, ${step.seconds}s) -----`)
  lines.push(`$ ${step.cmd}`)
  lines.push(redact(step.body))
  lines.push("")
}
lines.push("===== assertions =====")
for (const assertion of assertions) {
  // The rendered verdict label: PASS / FAIL / NULL, never a silent absence.
  const label = assertion.ok === true ? "PASS" : assertion.ok === false ? "FAIL" : "NULL"
  lines.push(`${label} ${assertion.name}${assertion.reason === "" ? "" : " — " + assertion.reason}`)
  if (assertion.raw !== "") lines.push(`     raw: ${assertion.raw}`)
}
/** The assertions that are explicitly false (a null verdict is reported, not fatal). */
const failed = assertions.filter((a) => a.ok === false)
/** The assertions the run never evaluated. */
const nulls = assertions.filter((a) => a.ok === null)
lines.push("")
lines.push("===== summary =====")
lines.push(`passed=${assertions.filter((a) => a.ok === true).length} failed=${failed.length} null=${nulls.length} total=${assertions.length}`)
lines.push(`ok=${failed.length === 0}`)
lines.push(`complete=${nulls.length === 0}`)
// ── result.json ──────────────────────────────────────────────────────────────
/** The instant the report was assembled, used for the timestamps and the duration. */
const finishedAt = new Date()
/** The machine-readable report; `evidenceScrubbed` is assigned once the leak scan below has run. */
const result: RunResult = {
  case: "docker-client-install",
  title: "a clean ubuntu:24.04 container installs and boots @mpd-dsh/mpd from a copy of this checkout",
  ok: failed.length === 0,
  complete: nulls.length === 0,
  image,
  startedAt: started > 0 ? new Date(started * 1000).toISOString() : null,
  finishedAt: finishedAt.toISOString(),
  durationSeconds: started > 0 ? Math.round(finishedAt.getTime() / 1000 - started) : null,
  // The exact harness this whole run certifies. Asserted by `harness.version` (exact string equality
  // against the pin) and restated here so no reader has to infer it from the assertion list.
  harness: {
    installed: facts.harnessVersion ?? null,
    expected: facts.harnessVersionExpected ?? null,
    assertion: "harness.version",
    node: facts.node ?? null,
    bun: facts.bun ?? null,
    pnpm: facts.pnpm ?? null,
    ubuntu: facts.ubuntuImage ?? null,
  },
  // PROVES = runtime behaviour witnessed inside a booted process.
  proves: [
    "node 24 + bun + pnpm + @deepseek-ai/dsh install inside a bare ubuntu:24.04 container",
    "the bundle installs with ONE command from a copy of the checkout (dsh plugin --profile web add .)",
    "every packages/*/dist entry rebuilds from source with the canonical repo-root bun build",
    "a MOUNTING boot in an isolated HOME/DSH_HOME applies the plugin tree and registers the mpd tools",
    "the official TeamService (@deepseek-ai/dsh-experimental-agent-team) is mounted in that process",
    "the mpd session gate LISTENER is registered for a real mpd session (liveness, not composition)",
    "the mpd preset really mounts: POST /api/session/create answers ok with agentPreset=mpd",
  ],
  // COMPOSITION ONLY = row lists. Kept in its own field so nothing here can be read as a load proof
  // (AGENTS.md §4: --dump-config composes rows and never executes plugin code).
  provesCompositionOnly: [
    "the composed profile carries the mpd rows, the preset-mpd row and the three official agent-team rows",
  ],
  doesNotProve: [
    "any live LLM turn or model routing: no credentials are staged (AGENTS.md §10)",
    "`--dump-config` output is COMPOSITION evidence and is never cited here as a plugin load",
    "a packed/tarball install from dist/mpd-package",
    "a machine without network access: apt, nodejs.org, bun.sh, npm and the registry are all used",
  ],
  summary: {
    total: assertions.length,
    passed: assertions.filter((a) => a.ok === true).length,
    failed: failed.length,
    null: nulls.length,
    failedNames: failed.map((a) => a.name),
    nullNames: nulls.map((a) => a.name),
  },
  assertions,
  observations,
  facts: Object.fromEntries(Object.entries(facts).map(([k, v]) => [k, redact(v)])),
  hashes,
  steps: steps.map(({ body, ...rest }) => rest),
  outputLog: "output.log",
}
mkdirSync(out, { recursive: true })
/** The log text as it will be written, before the post-write leak scan reads it back. */
let outputText = redact(lines.join("\n")) + "\n"
// NEGATIVE CONTROL for the scrub guard below, driven by `node scripts/docker-e2e.ts --self-test`. It
// is appended AFTER redact() on purpose: it simulates exactly the hole the guard exists for — a field
// that reached the artifact without passing the redactor — so the guard's FIRING path is exercised
// rather than assumed. Never set in a real run (the driver does not pass it).
if (process.env.MPD_E2E_FORCE_LEAK === "1") {
  outputText += "NEGATIVE CONTROL: http://127.0.0.1:1/?token=NOTAREDACTEDLEAK123456\n"
}

/** The machine-readable report as it will be written, before the post-write leak scan reads it back. */
let resultText = JSON.stringify(result, null, 2) + "\n"

// ── post-write scrubbing check, on the ARTIFACT ───────────────────────────────
// AGENTS.md §10: evidence must not contain token material. Every field above already passed through
// redact(), and this reads back the bytes that are about to be published to prove it — the assertion
// `raw`/`reason` fields never pass through the log renderer, so they are exactly where a shape could
// survive. A leak turns the verdict red and rewrites BOTH artifacts with targeted shape scrubbing
// (targeted, so sha256 state anchors and session ids survive).
/** The token/secret shapes that must never reach an artifact. */
const leakPatterns: readonly RegExp[] = [/([?&]token=)(?!<redacted>)[A-Za-z0-9._~+/=-]{8,}/g, /\bsk-[A-Za-z0-9_-]{16,}/g]
/** Rewrite the leak shapes in place, leaving every other byte (anchors, ids) untouched. */
const scrubShapes = (text: unknown): string => String(text)
  .replace(/([?&]token=)(?!<redacted>)[A-Za-z0-9._~+/=-]{8,}/g, "$1<redacted>")
  .replace(/\bsk-[A-Za-z0-9_-]{16,}/g, "sk-<redacted>")
/** Every leak-shaped substring of a text, as the report names them. */
const findLeaks = (text: unknown): string[] => leakPatterns.flatMap((pattern) => [...String(text).matchAll(pattern)].map((match) => match[0]))
/** The leak shapes found across both artifacts as they currently stand. */
const leaks = findLeaks(outputText + resultText)
/** The log text actually written — the pre-scrub text unless a leak forced a rewrite. */
let safeOutput = outputText
result.evidenceScrubbed = leaks.length === 0
if (leaks.length > 0) {
  result.ok = false
  result.complete = false
  result.summary.failed = (result.summary.failed ?? 0) + 1
  result.summary.failedNames = [...(result.summary.failedNames ?? []), "isolation.evidenceScrubbed"]
  result.leakShapes = leaks.slice(0, 3)
  safeOutput = scrubShapes(outputText)
  process.stderr.write(`[report] FAIL isolation.evidenceScrubbed — ${leaks.length} token-shaped value(s) reached the evidence; both artifacts are being rewritten with targeted scrubbing\n`)
}
// Re-render from `result` AFTER `evidenceScrubbed` is set: the field is part of the artifact, and a
// clean run must carry `evidenceScrubbed: true` explicitly (measured 2026-09-27 — rendering before
// the assignment silently published a green result.json with the field missing, which is exactly the
// kind of absence a reader cannot distinguish from "not checked").
resultText = JSON.stringify(result, null, 2) + "\n"
if (leaks.length > 0) resultText = scrubShapes(resultText)
writeFileSync(join(out, "output.log"), safeOutput)
writeFileSync(join(out, "result.json"), resultText)

// Re-read what is actually on disk. If a leak shape somehow survived the rewrite, replace result.json
// with a minimal failure record (which by construction carries no log bytes) and exit 2 — an
// unscrubbable artifact must never be published as a valid report.
/** The leak shapes still present after the rewrite — must be empty for the report to be publishable. */
const residual = findLeaks(readText(join(out, "output.log")) + readText(join(out, "result.json")))
if (residual.length > 0) {
  writeFileSync(join(out, "result.json"), JSON.stringify({
    case: "docker-client-install",
    ok: false,
    complete: false,
    reporter: "docker/lib/report.ts",
    reason: "a token-shaped value survived the scrub; the report body was withheld rather than published",
    leakCount: residual.length,
  }, null, 2) + "\n")
  process.stderr.write(`[report] FATAL — ${residual.length} token shape(s) survived the scrub; result.json was replaced with a withheld-report record\n`)
  process.exit(2)
}

process.stdout.write(`[report] ok=${result.ok} complete=${result.complete} passed=${result.summary.passed} failed=${result.summary.failed} null=${result.summary.null} scrubbed=${result.evidenceScrubbed} -> ${join(out, "result.json")}\n`)
for (const assertion of failed) process.stdout.write(`[report] FAIL ${assertion.name} — ${assertion.reason}${assertion.raw === "" ? "" : " | raw: " + assertion.raw}\n`)
for (const assertion of nulls) process.stdout.write(`[report] NULL ${assertion.name} — ${assertion.reason}\n`)
process.exit(result.ok === true ? 0 : 1)
