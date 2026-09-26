#!/usr/bin/env node
// docker/lib/report.mjs — assemble /out/result.json + /out/output.log from the run's state.
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

const argv = process.argv.slice(2)
const arg = (flag, fallback = "") => {
  const index = argv.indexOf("--" + flag)
  return index === -1 || index + 1 >= argv.length ? fallback : argv[index + 1]
}
const work = arg("work")
const out = arg("out")
const image = arg("image", "mpd-docker-e2e:local")
const started = Number(arg("started", "0"))
if (work === "" || out === "") {
  process.stderr.write("[report] usage: report.mjs --work <dir> --out <dir> [--image <tag>] [--started <epochSeconds>]\n")
  process.exit(2)
}

/**
 * The canonical assertion list of this case. An entry the run never recorded is emitted as
 * `null` with a "not reached" reason, so a partial run still produces a complete, honest report.
 */
const EXPECTED = [
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
  "boot.agentTeamService",
  "boot.servesHttp",
  "boot.presetMount",
  "boot.noFatalSignatures",
  "isolation.home",
  "isolation.realHome",
  "isolation.noCredentials",
  "boot.llmTurn",
]

/** Token/credential scrubbing for EVERY byte this script writes (AGENTS.md §10). */
function redact(text) {
  return String(text)
    .replace(/([?&]token=)[A-Za-z0-9._~+/=-]+/g, "$1<redacted>")
    .replace(/(\btoken\s*[:=]\s*)["']?[A-Za-z0-9._~+/=-]{8,}["']?/gi, "$1<redacted>")
    .replace(/(\bsk-)[A-Za-z0-9_-]{12,}/g, "$1<redacted>")
}

const readText = (path, fallback = "") => { try { return readFileSync(path, "utf8") } catch { return fallback } }

// ── assertions ────────────────────────────────────────────────────────────────
const recorded = new Map()
let corruptLines = 0
let lastCorrupt = ""
for (const line of readText(join(work, "assertions.ndjson")).split("\n")) {
  if (line.trim() === "") continue
  try {
    const row = JSON.parse(line)
    if (row && typeof row.name === "string") recorded.set(row.name, row)
    else { corruptLines += 1; lastCorrupt = line.slice(0, 200) }
  } catch {
    // A corrupt state line must never be dropped silently: an escaping bug in the recorder would
    // otherwise erase evidence and still produce a green report.
    corruptLines += 1
    lastCorrupt = line.slice(0, 200)
  }
}
const assertions = EXPECTED.map((name) => {
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
const facts = {}
const observations = {}
for (const line of readText(join(work, "facts.tsv")).split("\n")) {
  if (line.trim() === "") continue
  const tab = line.indexOf("\t")
  if (tab === -1) continue
  const key = line.slice(0, tab)
  const value = line.slice(tab + 1)
  if (key.startsWith("obs.")) observations[key.slice(4)] = redact(value)
  else facts[key] = value}
const hashes = []
for (const line of readText(join(work, "hashes.tsv")).split("\n")) {
  if (line.trim() === "") continue
  const match = /^([0-9a-f]{64})\s+\*?(.+)$/.exec(line)
  if (match !== null) hashes.push({ sha256: match[1], path: match[2] })
}

const stepsDir = join(work, "steps")
const steps = []
for (const line of readText(join(work, "steps.tsv")).split("\n")) {
  if (line.trim() === "") continue
  const [id, exit, seconds, logFile, ...command] = line.split("\t")
  const logPath = join(stepsDir, logFile)
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
const stamp = facts.stamp ?? new Date().toISOString()
const lines = []
lines.push("===== Docker client-install E2E (ubuntu:24.04 + compose) =====")
lines.push(`stamp:   ${stamp}`)
lines.push(`image:   ${image}`)
lines.push(`command: node scripts/docker-e2e.mjs   (container: ${facts.entrypoint ?? "docker/entrypoint.sh"})`)
lines.push("")
lines.push("PROVES: a clean ubuntu:24.04 container installs node/bun/pnpm + @deepseek-ai/dsh,")
lines.push("        copies this checkout, rebuilds every packages/*/dist from source, installs the")
lines.push("        bundle with `dsh plugin --profile web add .`, composes the mpd rows, and MOUNTS")
lines.push("        the installed profile in an isolated HOME/DSH_HOME with registration")
lines.push("        instrumentation (docker/probe.mjs) reading the live tool registry, plus a real")
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
  const label = assertion.ok === true ? "PASS" : assertion.ok === false ? "FAIL" : "NULL"
  lines.push(`${label} ${assertion.name}${assertion.reason === "" ? "" : " — " + assertion.reason}`)
  if (assertion.raw !== "") lines.push(`     raw: ${assertion.raw}`)
}
const failed = assertions.filter((a) => a.ok === false)
const nulls = assertions.filter((a) => a.ok === null)
lines.push("")
lines.push("===== summary =====")
lines.push(`passed=${assertions.filter((a) => a.ok === true).length} failed=${failed.length} null=${nulls.length} total=${assertions.length}`)
lines.push(`ok=${failed.length === 0}`)
lines.push(`complete=${nulls.length === 0}`)
// ── result.json ──────────────────────────────────────────────────────────────
const finishedAt = new Date()
const result = {
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
let outputText = redact(lines.join("\n")) + "\n"
// NEGATIVE CONTROL for the scrub guard below, driven by `node scripts/docker-e2e.mjs --self-test`. It
// is appended AFTER redact() on purpose: it simulates exactly the hole the guard exists for — a field
// that reached the artifact without passing the redactor — so the guard's FIRING path is exercised
// rather than assumed. Never set in a real run (the driver does not pass it).
if (process.env.MPD_E2E_FORCE_LEAK === "1") {
  outputText += "NEGATIVE CONTROL: http://127.0.0.1:1/?token=NOTAREDACTEDLEAK123456\n"
}

let resultText = JSON.stringify(result, null, 2) + "\n"

// ── post-write scrubbing check, on the ARTIFACT ───────────────────────────────
// AGENTS.md §10: evidence must not contain token material. Every field above already passed through
// redact(), and this reads back the bytes that are about to be published to prove it — the assertion
// `raw`/`reason` fields never pass through the log renderer, so they are exactly where a shape could
// survive. A leak turns the verdict red and rewrites BOTH artifacts with targeted shape scrubbing
// (targeted, so sha256 state anchors and session ids survive).
const leakPatterns = [/([?&]token=)(?!<redacted>)[A-Za-z0-9._~+/=-]{8,}/g, /\bsk-[A-Za-z0-9_-]{16,}/g]
const scrubShapes = (text) => String(text)
  .replace(/([?&]token=)(?!<redacted>)[A-Za-z0-9._~+/=-]{8,}/g, "$1<redacted>")
  .replace(/\bsk-[A-Za-z0-9_-]{16,}/g, "sk-<redacted>")
const findLeaks = (text) => leakPatterns.flatMap((pattern) => [...String(text).matchAll(pattern)].map((match) => match[0]))
const leaks = findLeaks(outputText + resultText)
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
const residual = findLeaks(readText(join(out, "output.log")) + readText(join(out, "result.json")))
if (residual.length > 0) {
  writeFileSync(join(out, "result.json"), JSON.stringify({
    case: "docker-client-install",
    ok: false,
    complete: false,
    reporter: "docker/lib/report.mjs",
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
