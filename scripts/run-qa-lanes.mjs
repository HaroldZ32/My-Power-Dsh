#!/usr/bin/env node
// QA suite runner: one manifest-driven pass over the dsh-qa lane corpus.
//
// Why this exists (T-32 / T-59 / T-60):
//   `test:qa:all` used to be an inline `for` loop in package.json that `exit 1`-ed on the FIRST
//   failing lane, so lane 1 of 27 hid the other 26 (measured: `mount-assert` exited 2 on every
//   suite run because the loop never passed its REQUIRED `--expect`, and nothing after it ran).
//   The lane list is DATA now (`skills/dsh-qa/cases.json`), so a lane that exists on disk but is
//   absent from the manifest is DETECTABLE (`--list`, `--check-drift`) instead of silently skipped.
//
// Verdicts (never a pass for a lane that could not run):
//   pass         exit 0, no `[mpd-qa]` marker
//   unavailable  a prerequisite is missing: `SKIP` marker (exit 0) or, under the strict `--no-skip`
//                the suite passes, a `FAIL` marker whose reason is a prerequisite-absence code
//   fail         the lane ran and failed, exited with a usage error, timed out, or its script is gone
//
// Exit codes (three outcomes + one runner error, so a caller can branch without parsing prose):
//   0  every selected lane passed
//   2  at least one lane was unavailable, none failed
//   1  at least one lane failed
//   3  runner/config error (unknown case, unknown suite, unusable manifest)
//
// Usage:
//   node scripts/run-qa-lanes.mjs                       # the `all` suite (what test:qa:all runs)
//   node scripts/run-qa-lanes.mjs --list                # registry + drift, per lane
//   node scripts/run-qa-lanes.mjs --check-drift         # exit 1 when the manifest and disk disagree
//   node scripts/run-qa-lanes.mjs --only mount-assert,agent-teams-adopt
//   node scripts/run-qa-lanes.mjs --help
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { appendFileSync, closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { readJson } from "./lib/repo.mjs"

const HERE = dirname(fileURLToPath(import.meta.url))
const DEFAULT_ROOT = resolve(HERE, "..")
const DEFAULT_MANIFEST = "skills/dsh-qa/cases.json"
const LANE_DIR = "skills/dsh-qa/scripts"
// T-83: the ONE specifier a `"required"` lane's driver must carry, asserted as a literal (never the
// export list — drivers legitimately import different members of the helper).
const GUARD_SPECIFIER = "./lib/immutable-output.mjs"
const EXIT = { GREEN: 0, UNAVAILABLE: 2, FAILED: 1, RUNNER_ERROR: 3 }
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000
// Two spellings are in use: the full grammar with a quoted remedy, and a shorter one without.
// `prereq=` may be a PROBE PHRASE with spaces (`prereq=tui profile in the sandbox root`), so the
// prereq group is non-greedy and anchored on the ` remedy=` that follows it.
const MARKER_FULL_RE = /^\[mpd-qa\] (SKIP|FAIL) case=(\S+) lane=(\S+) reason=(\S+) prereq=(.*?)\s+remedy=(.*)$/m
const MARKER_SHORT_RE = /^\[mpd-qa\] (SKIP|FAIL) case=(\S+) lane=(\S+) reason=(\S+)(?:\s+prereq=(.*?))?\s*$/m

// Only a handful of the lane scripts implement the `[mpd-qa] SKIP|FAIL` protocol, so the runner —
// not each lane — owns the unavailable-vs-failed distinction. These are the signatures a lane
// records in its OWN stdout or in the evidence directory it printed. A 401 is deliberately NOT a
// prerequisite absence: the service answered and refused, so the lane really ran and really failed
// (measured: agent-teams-adopt is red on `webRoute … "status":401,"body":"{\"error\":\"unauthorized\"}"`
// in the pre-wave control too, while a missing provider key aborts before any assertion).
const SIGNATURES = [
  {
    code: "unauthorized",
    verdict: "fail",
    label: "HTTP 401 / unauthorized route",
    test: /\b401\b[^\n]*unauthorized|unauthorized[^\n]*\b401\b/i,
  },
  {
    code: "absent-credentials",
    verdict: "unavailable",
    label: "provider credential (DEEPSEEK_API_KEY / deepseek-official route)",
    test: /MISSING_CREDENTIAL|no API key for provider route|missing DEEPSEEK_API_KEY/,
  },
]

// The reason-code class that means "this host lacks a prerequisite, the lane could not run"
// (SKILL.md documents the list; `absent-bundle-dist` is in use by the tui-settings-bridge lane
// and was missing from that list). Anything else is an assertion failure.
function isPrereqReason(reason) {
  return typeof reason === "string" && (reason === "unsupported-platform" || reason.startsWith("absent-"))
}

function stamp() {
  return new Date().toISOString().replaceAll(":", "-")
}

function parseArgs(argv) {
  const opts = { suite: "all", only: null, list: false, checkDrift: false, json: false, selfTest: false, help: false, root: DEFAULT_ROOT, manifest: null, evidenceDir: null, timeoutMs: DEFAULT_TIMEOUT_MS }
  // Every value-taking flag accepts BOTH spellings (`--only=a,b` and `--only a,b`), because the
  // documented invocations in the task contracts and in SKILL.md use the space form.
  const VALUE_FLAGS = ["only", "suite", "root", "manifest", "evidence-dir", "timeout"]
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const eq = arg.startsWith("--") ? arg.indexOf("=") : -1
    const name = eq > 0 ? arg.slice(2, eq) : arg.startsWith("--") ? arg.slice(2) : null
    let value = eq > 0 ? arg.slice(eq + 1) : null
    if (name !== null && VALUE_FLAGS.includes(name)) {
      if (value === null) {
        if (i + 1 >= argv.length) throw new Error("--" + name + " requires a value")
        value = argv[++i]
      }
      if (name === "only") opts.only = value
      else if (name === "suite") opts.suite = value
      else if (name === "root") opts.root = resolve(value)
      else if (name === "manifest") opts.manifest = value
      else if (name === "evidence-dir") opts.evidenceDir = value
      else {
        const ms = Number(value)
        if (!Number.isFinite(ms) || ms < 0) throw new Error("--timeout must be a non-negative number of milliseconds (0 disables the timeout)")
        opts.timeoutMs = ms
      }
      continue
    }
    if (arg === "--self-test") opts.selfTest = true
    else if (arg === "--list") opts.list = true
    else if (arg === "--check-drift") opts.checkDrift = true
    else if (arg === "--json") opts.json = true
    else if (arg === "--help" || arg === "-h") opts.help = true
    else throw new Error("unknown argument: " + arg + " (see --help)")
  }
  if (opts.only !== null) opts.only = opts.only.split(",").map((s) => s.trim()).filter(Boolean)
  return opts
}

function usage() {
  return [
    "QA suite runner (manifest: " + DEFAULT_MANIFEST + ")",
    "",
    "  node scripts/run-qa-lanes.mjs [--suite=all] [--only=a,b] [--json] [--timeout=ms] [--evidence-dir=path]",
    "  node scripts/run-qa-lanes.mjs --list [--json]",
    "  node scripts/run-qa-lanes.mjs --check-drift",
    "  node scripts/run-qa-lanes.mjs --self-test",
    "",
    "Verdicts: pass | unavailable (missing prerequisite, reason reported) | fail (ran and failed).",
    "Exit codes: 0 all green | 2 some unavailable | 1 some failed | 3 runner/config error.",
    "Lane stdout/stderr goes to FILES (lanes spawn dsh, whose MCP children hold inherited fds).",
  ].join("\n")
}

function loadManifest(root, manifestPath) {
  const path = isAbsolute(manifestPath) ? manifestPath : join(root, manifestPath)
  if (!existsSync(path)) throw new Error("manifest not found: " + path)
  const text = readFileSync(path, "utf8")
  let data
  try {
    data = JSON.parse(text)
  } catch (err) {
    throw new Error("manifest is not valid JSON (" + path + "): " + err.message)
  }
  const entries = [...(data.lanes ?? []), ...(data.gates ?? [])]
  if (entries.length === 0) throw new Error("manifest declares no lanes: " + path)
  const seen = new Set()
  for (const entry of entries) {
    if (!entry.case || typeof entry.case !== "string") throw new Error("manifest entry without a case name: " + JSON.stringify(entry))
    if (seen.has(entry.case)) throw new Error("duplicate case in manifest: " + entry.case)
    seen.add(entry.case)
    if (entry.kind !== "gate" && !entry.script) throw new Error("lane without a script: " + entry.case)
  }
  return { path, text, data, entries, sha256: createHash("sha256").update(text).digest("hex") }
}

function laneScriptsOnDisk(root) {
  const dir = join(root, LANE_DIR)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((name) => name.endsWith(".mjs"))
    .filter((name) => !name.startsWith("_"))
    .sort()
    .map((name) => LANE_DIR + "/" + name)
}

/** EVERY `.mjs` entry in the lane directory, UNFILTERED and sorted — the independent walk the
 * discovery is asserted against (T-89's RUNNER half, lane B). */
function allMjsEntries(root) {
  const dir = join(root, LANE_DIR)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((name) => name.endsWith(".mjs"))
    .sort()
    .map((name) => LANE_DIR + "/" + name)
}

function collectDrift(root, manifest) {
  const declared = new Set(manifest.entries.filter((e) => e.kind !== "gate").map((e) => e.script))
  const discovered = laneScriptsOnDisk(root)
  const unlistedScripts = discovered.filter((script) => !declared.has(script))
  const missingScripts = manifest.entries
    .filter((e) => e.kind !== "gate" && e.script && !existsSync(join(root, e.script)))
    .map((e) => ({ case: e.case, script: e.script }))
  // A script that is on disk and in the manifest, but not in any suite, is a deliberate exclusion
  // and is NOT drift: the manifest states its reason (`outsideSuites`).
  const countDrift = collectCountDrift(root, manifest, discovered)
  return { unlistedScripts, missingScripts, countDrift, guard: collectGuard(root, manifest) }
}

/**
 * T-89's RUNNER half (lane B's obligation on this file): the discovery ASSERTS THE DISCOVERED FILE
 * COUNT, so a silently-discovered copy reddens. `discovered` is what the runner will actually
 * consider; `allMjs` is an INDEPENDENT walk of the same directory. They may differ only by the
 * DOCUMENTED underscore exclusion — any other difference means the discovery dropped (or invented) a
 * file, which is the shape the row names. Every number is re-derived from the tree on every run and
 * is never a constant quoted from prose.
 */
function collectCountDrift(root, manifest, discovered) {
  const allMjs = allMjsEntries(root)
  const discoveredSet = new Set(discovered)
  const excludedUnderscore = allMjs.filter((script) => !discoveredSet.has(script) && script.split("/").pop().startsWith("_"))
  const unexpectedDrop = allMjs.filter((script) => !discoveredSet.has(script) && !script.split("/").pop().startsWith("_"))
  const outsideSuites = manifest.entries
    .filter((e) => e.kind !== "gate" && e.script && (e.suites ?? []).length === 0)
    .map((e) => e.script)
  const declaredSet = declaredScriptSet(manifest)
  const listed = discovered.filter((script) => declaredSet.has(script))
  const unlisted = discovered.filter((script) => !declaredSet.has(script))
  const problems = []
  if (unexpectedDrop.length > 0) problems.push("the discovery dropped " + unexpectedDrop.length + " .mjs entry(ies) that are neither underscore-excluded nor declared: " + unexpectedDrop.join(", "))
  if (discovered.length + excludedUnderscore.length !== allMjs.length) {
    problems.push("the discovery does not partition the directory: discovered=" + discovered.length + " + underscore-excluded=" + excludedUnderscore.length + " != .mjs entries=" + allMjs.length)
  }
  if (existsSync(join(root, LANE_DIR)) && discovered.length === 0 && allMjs.length > 0) {
    problems.push("the lane directory holds " + allMjs.length + " .mjs entry(ies) but the discovery returned none (zero-subject discovery)")
  }
  return {
    discovered: discovered.length,
    allMjsEntries: allMjs.length,
    listed: listed.length,
    unlisted: unlisted.length,
    outsideSuites: outsideSuites.length,
    excludedUnderscore,
    unexpectedDrop,
    partition: { discoveredPlusExcludedEqualsAllMjs: discovered.length + excludedUnderscore.length === allMjs.length, ok: problems.length === 0 },
    problems,
  }
}

/** The DECLARED lane-script set, as a Set — shared by collectDrift and collectCountDrift. */
function declaredScriptSet(manifest) {
  return new Set(manifest.entries.filter((e) => e.kind !== "gate").map((e) => e.script))
}

/**
 * T-83: every lane DECLARES its `immutabilityGuard` in the manifest (`"required"` or
 * `"exempt: <reason>"`) — the same declare-never-omit rule as `outsideSuites`. The declaration is
 * mandatory, an omitted or malformed one is drift, and a `"required"` lane whose driver does not
 * import the immutability helper is drift too. Nothing here is DERIVED from a predicate: measured,
 * `result.json` matches 45/45 drivers, `writeFileSync` 40/45, and a `--out` grep matched 12 files of
 * which only 2 really parse the flag (3 were `--outfile` remedy text, 5 usage comments) — so a
 * derived set would be either the forbidden 45-driver sweep or simply wrong.
 */
function collectGuard(root, manifest) {
  const lanes = manifest.entries.filter((e) => e.kind !== "gate" && e.script)
  const required = []
  const exempt = []
  const undeclared = []
  const malformed = []
  const missingImports = []
  for (const entry of lanes) {
    const value = entry.immutabilityGuard
    if (typeof value !== "string" || value.trim() === "") {
      undeclared.push(entry.case)
      continue
    }
    if (value === "required") {
      required.push(entry.case)
      const path = join(root, entry.script)
      if (existsSync(path) && !readFileSync(path, "utf8").includes(GUARD_SPECIFIER)) {
        missingImports.push({ case: entry.case, script: entry.script, expected: GUARD_SPECIFIER })
      }
      continue
    }
    if (/^exempt:\s*\S/.test(value)) {
      exempt.push(entry.case)
      continue
    }
    malformed.push({ case: entry.case, value })
  }
  return {
    required: required.sort(),
    exemptCount: exempt.length,
    undeclared,
    malformed,
    missingImports,
    empty: lanes.length > 0 && required.length === 0,
  }
}

/** Every way the guard declaration can be wrong, as printable lines. Empty array = clean. */
function guardProblems(guard) {
  return [
    ...guard.undeclared.map((name) => "lane " + name + " carries no immutabilityGuard declaration (declare `required` or `exempt: <reason>`)"),
    ...guard.malformed.map((entry) => "lane " + entry.case + " has a malformed immutabilityGuard: " + JSON.stringify(entry.value)),
    ...guard.missingImports.map((entry) => "required driver " + entry.script + " (" + entry.case + ") does not import " + entry.expected),
    ...(guard.empty ? ["the resolved required set is EMPTY — a declaration set that requires nothing is a RED"] : []),
  ]
}

function selectEntries(manifest, opts) {
  if (opts.only) {
    const byCase = new Map(manifest.entries.map((e) => [e.case, e]))
    const unknown = opts.only.filter((name) => !byCase.has(name))
    if (unknown.length > 0) throw new Error("--only names case(s) not in the manifest: " + unknown.join(", ") + " (see --list)")
    return opts.only.map((name) => byCase.get(name))
  }
  const selected = manifest.entries.filter((entry) => (entry.suites ?? []).includes(opts.suite))
  if (selected.length === 0) throw new Error("suite \"" + opts.suite + "\" matches no manifest entry (see --list)")
  return selected
}

function parseMarker(text) {
  const match = MARKER_FULL_RE.exec(text) ?? MARKER_SHORT_RE.exec(text)
  if (!match) return null
  return {
    kind: match[1],
    case: match[2],
    lane: match[3],
    reason: match[4],
    prereq: (match[5] ?? "").trim(),
    remedy: (match[6] ?? "").trim().replace(/^"|"$/g, ""),
  }
}

function findEvidencePath(text, root) {
  const candidates = text.match(/[A-Za-z0-9_./-]*evidence\/[A-Za-z0-9_@./-]+/g) ?? []
  for (const raw of candidates.reverse()) {
    const cleaned = raw.replace(/[.,;:)\]]+$/, "")
    const absolute = isAbsolute(cleaned) ? cleaned : join(root, cleaned)
    if (existsSync(absolute)) {
      return isAbsolute(cleaned) ? relative(root, cleaned) : cleaned
    }
  }
  return null
}

function lineOf(text, index) {
  return text.slice(0, index).split(/\r?\n/).length
}

/** Every existing evidence path the lane printed in its own output (deduped, capped). */
function evidenceCandidates(log, root) {
  const raw = log.match(/[A-Za-z0-9_./-]*evidence\/[A-Za-z0-9_@./-]+/g) ?? []
  const out = []
  for (const candidate of raw) {
    const cleaned = candidate.replace(/[.,;:)\]]+$/, "")
    const absolute = isAbsolute(cleaned) ? cleaned : join(root, cleaned)
    if (existsSync(absolute) && !out.includes(absolute)) out.push(absolute)
  }
  return out.slice(-6)
}

// Read the lane's own evidence (plus the lane log itself) as text. Bounded on purpose: a lane's
// evidence is a handful of small files, and a credential PREREQUISITE must be reported from what
// the lane recorded — never inferred. Binary/unreadable files are skipped; no secret VALUE is
// copied anywhere, only the signature name plus the file and line that carry it.
function collectEvidenceTexts(targets) {
  const texts = []
  const consider = (target, depth) => {
    if (texts.length >= 60) return
    let stat
    try {
      stat = statSync(target)
    } catch {
      return
    }
    if (stat.isDirectory()) {
      if (depth >= 2) return
      let entries = []
      try {
        entries = readdirSync(target)
      } catch {
        return
      }
      for (const entry of entries) consider(join(target, entry), depth + 1)
      return
    }
    if (!stat.isFile() || stat.size > 1024 * 1024) return
    try {
      const buffer = readFileSync(target)
      if (buffer.includes(0)) return
      texts.push({ file: target, text: buffer.toString("utf8") })
    } catch {
      return
    }
  }
  for (const target of targets) consider(target, 0)
  return texts
}

/** Signatures matched against the given sources (kept separate so a rung can choose its scope). */
function matchSignatures(sources) {
  const found = []
  for (const signature of SIGNATURES) {
    for (const source of sources) {
      const index = source.text.search(signature.test)
      if (index >= 0) {
        found.push({ code: signature.code, verdict: signature.verdict, label: signature.label, file: source.file, line: lineOf(source.text, index) })
        break
      }
    }
  }
  return found
}

/** Signatures the lane recorded about itself: which prerequisite (or which refusal) and where. */
function detectSignatures(log, root) {
  return matchSignatures([{ file: null, text: log }, ...collectEvidenceTexts(evidenceCandidates(log, root))])
}

/** Did one recorded step fail? Accepts the field variants the lanes actually write. */
function stepFailed(entry) {
  if (entry.ok === true) return false
  if (entry.ok === false) return true
  if (entry.status === "failed" || entry.status === "fail") return true
  if (entry.verdict === "fail" || entry.verdict === "failed") return true
  return false
}

/**
 * RUNG 2 of the reason ladder (t73): the FAILING STEP the lane recorded about itself.
 *
 * A label must never be drawn from a step the lane marked GREEN. The motivating case: the adopt
 * lane's evidence carried the expected 401 fence inside a PASSING `webRoute` step while its real
 * failure was `archive`, so the whole-log signature scan labelled that red `reason=unauthorized`
 * — verdict right, label wrong. The structured map the lane already writes (`steps{name:{ok}}`)
 * names the failing step directly, so the runner asks for it BEFORE any text scan.
 */
function failingStepFromEvidence(log, root) {
  const inspect = (file) => {
    if (!file.endsWith(".json") || !existsSync(file)) return null
    let data
    try {
      data = readJson(file)
    } catch {
      return null
    }
    const steps = data?.steps ?? data?.observed?.steps
    if (steps === undefined || steps === null || typeof steps !== "object") return null
    const list = Array.isArray(steps)
      ? steps.map((entry) => ({ ...(entry ?? {}), name: String(entry?.name ?? entry?.step ?? "") }))
      : Object.entries(steps).map(([name, entry]) => ({ ...(entry ?? {}), name }))
    const failed = list.find((entry) => entry.name !== "" && stepFailed(entry))
    if (failed === undefined) return null
    return { code: "step:" + failed.name, label: "the lane's own evidence marks step `" + failed.name + "` as failed", file, line: null }
  }
  for (const candidate of evidenceCandidates(log, root).reverse()) {
    const direct = inspect(candidate)
    if (direct) return direct
    if (!candidate.endsWith(".json")) {
      const sibling = inspect(join(dirname(candidate), "result.json"))
      if (sibling) return sibling
    }
  }
  return null
}

/**
 * RUNG 3's scope (t73): a lane reports its failure at the END, so when no structured map exists the
 * signature scan reads the FAILING REGION — the log's tail — instead of text it printed while a
 * step was still passing. The whole-log scan survives only as `alsoDetected`.
 */
function tailRegion(text, lines = 200) {
  const all = text.split(/\r?\n/)
  return all.length <= lines ? text : all.slice(-lines).join("\n")
}

/** The scoped scan: the log's failing region plus the lane's own evidence records. */
function detectSignaturesScoped(log, root) {
  return matchSignatures([{ file: null, text: tailRegion(log) }, ...collectEvidenceTexts(evidenceCandidates(log, root))])
}

function classify({ status, signal, timedOut, log, root }) {
  const marker = parseMarker(log)
  if (timedOut) return { verdict: "fail", reason: "timeout", marker, note: "killed after the runner's per-lane timeout" }
  if (status === 0) {
    if (marker?.kind === "SKIP") return { verdict: "unavailable", reason: marker.reason, marker }
    if (marker?.kind === "FAIL") return { verdict: "fail", reason: marker.reason, marker, note: "exit 0 with a FAIL marker" }
    return { verdict: "pass", reason: null, marker }
  }
  if (marker?.kind === "FAIL" && isPrereqReason(marker.reason)) {
    return { verdict: "unavailable", reason: marker.reason, marker, note: "missing prerequisite reported as FAIL under the strict --no-skip the suite passes" }
  }
  if (marker?.kind === "FAIL") return { verdict: "fail", reason: marker.reason, marker }
  if (marker?.kind === "SKIP") return { verdict: "fail", reason: "skip-marker-exit-" + status, marker, note: "a SKIP marker with a non-zero exit contradicts the case protocol" }
  // No marker. THE REASON LADDER (t73): (2) the lane's own structured step map names the failing
  // step; (3) failing that, a signature scan SCOPED to the failing region. The whole-log scan is
  // still computed, but only ever as `alsoDetected` — a fence a PASSING step printed must never
  // become the reason (measured on agent-teams-adopt: `webRoute` ok=true carried the 401 fence,
  // `archive` ok=false carried none, and the old code labelled the red `unauthorized`).
  const detected = detectSignatures(log, root)
  const step = failingStepFromEvidence(log, root)
  if (step) {
    return {
      verdict: "fail",
      reason: step.code,
      marker,
      signature: step,
      alsoDetected: detected,
      note: "the lane's own evidence marks this STEP failed — signatures found elsewhere in its output are reported under alsoDetected, never as the reason",
    }
  }
  const scoped = detectSignaturesScoped(log, root)
  const refusal = scoped.find((entry) => entry.verdict === "fail")
  const gap = scoped.find((entry) => entry.verdict === "unavailable")
  if (refusal) {
    return {
      verdict: "fail",
      reason: refusal.code,
      marker,
      signature: refusal,
      alsoDetected: detected.filter((entry) => entry.code !== refusal.code),
      note: "the lane's own output/evidence records this failure in the FAILING REGION — the service answered and refused",
    }
  }
  if (gap) {
    return {
      verdict: "unavailable",
      reason: gap.code,
      marker,
      signature: gap,
      alsoDetected: detected.filter((entry) => entry.code !== gap.code),
      note: "the RUNNER classified this lane from its recorded prerequisite signature (the lane emits no [mpd-qa] marker of its own)",
    }
  }
  if (status === 2) return { verdict: "fail", reason: "usage-error", marker, note: "the lane refused the invocation (e.g. a REQUIRED argument is missing — supply it in " + DEFAULT_MANIFEST + ")" }
  return { verdict: "fail", reason: signal ? "signal-" + signal : "exit-" + status, marker }
}

function tailLines(text, count = 6) {
  return text.split(/\r?\n/).filter((line) => line.trim() !== "").slice(-count)
}

function runEntry(entry, ctx) {
  const startedAt = Date.now()
  const logName = basename(entry.script ?? entry.case).replace(/\.mjs$/, "") + ".log"
  const logPath = join(ctx.laneLogDir, logName)
  const stdout = openSync(logPath, "w")
  const timeoutMs = entry.timeoutMs ?? ctx.timeoutMs
  let command
  let result
  try {
    if (entry.kind === "gate") {
      const argv = entry.argv ?? []
      if (argv.length === 0) throw new Error("gate without argv: " + entry.case)
      command = argv.join(" ")
      result = spawnSync(argv[0], argv.slice(1), { cwd: ctx.root, stdio: ["ignore", stdout, stdout], timeout: timeoutMs > 0 ? timeoutMs : undefined })
    } else {
      // The suite's strict default (`--no-skip`) comes first; a lane's own `args` are appended,
      // never substituted (mount-assert needs BOTH the strict flag and its REQUIRED --expect).
      const args = [...ctx.defaultArgs, ...(entry.args ?? [])]
      command = ["bun", entry.script, ...args].join(" ")
      result = spawnSync("bun", [entry.script, ...args], { cwd: ctx.root, stdio: ["ignore", stdout, stdout], timeout: timeoutMs > 0 ? timeoutMs : undefined })
    }
  } finally {
    closeSync(stdout)
  }
  const durationMs = Date.now() - startedAt
  const log = existsSync(logPath) ? readFileSync(logPath, "utf8") : ""
  const scriptMissing = entry.kind !== "gate" && entry.script && !existsSync(join(ctx.root, entry.script))
  const timedOut = result.error?.code === "ETIMEDOUT"
  const outcome = scriptMissing
    ? { verdict: "fail", reason: "script-missing", marker: null, note: "the manifest declares a lane whose script is not on disk" }
    : classify({ status: result.status ?? 1, signal: result.signal, timedOut, log, root: ctx.root })
  return {
    case: entry.case,
    kind: entry.kind ?? "lane",
    verdict: outcome.verdict,
    reason: outcome.reason,
    note: outcome.note ?? null,
    exitCode: result.status ?? null,
    signal: result.signal ?? null,
    durationMs,
    command,
    script: entry.script ?? null,
    marker: outcome.marker ? { kind: outcome.marker.kind, lane: outcome.marker.lane, reason: outcome.marker.reason, prereq: outcome.marker.prereq, remedy: outcome.marker.remedy } : null,
    signature: outcome.signature ? { code: outcome.signature.code, label: outcome.signature.label, file: outcome.signature.file ? relative(ctx.root, outcome.signature.file) : "(the lane's own stdout)", line: outcome.signature.line } : null,
    alsoDetected: (outcome.alsoDetected ?? []).map((detected) => ({ code: detected.code, file: detected.file ? relative(ctx.root, detected.file) : "(the lane's own stdout)", line: detected.line })),
    declaredPrereq: entry.prereq ?? [],
    evidencePath: findEvidencePath(log, ctx.root),
    logPath: relative(ctx.root, logPath),
    outputTail: outcome.verdict === "fail" ? tailLines(log) : [],
  }
}

function printLaneLine(entry) {
  const tag = entry.verdict.toUpperCase()
  const bits = ["[mpd-qa:" + entry.suite + "]", tag, "case=" + entry.case]
  if (entry.reason) bits.push("reason=" + entry.reason)
  if (entry.signature) bits.push("prereq=\"" + entry.signature.label + "\"", "signature=" + (entry.signature.file ?? "lane-stdout") + ":" + entry.signature.line)
  if (entry.alsoDetected?.length) bits.push("also=" + entry.alsoDetected.map((detected) => detected.code).join(","))
  if (entry.exitCode !== 0) bits.push("exit=" + entry.exitCode)
  if (entry.evidencePath) bits.push("evidence=" + entry.evidencePath)
  bits.push("log=" + entry.logPath)
  if (entry.durationMs !== undefined) bits.push("ms=" + entry.durationMs)
  return bits.join(" ")
}

function summarize(run) {
  const counts = { pass: 0, unavailable: 0, fail: 0 }
  for (const lane of run.lanes) counts[lane.verdict] = (counts[lane.verdict] ?? 0) + 1
  const exitCode = counts.fail > 0 ? EXIT.FAILED : counts.unavailable > 0 ? EXIT.UNAVAILABLE : EXIT.GREEN
  return { counts, exitCode }
}

function writeResult(path, run) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(run, null, 2) + "\n")
}

function runSuite(opts, manifest, ctx) {
  const selected = selectEntries(manifest, opts)
  const run = {
    runner: "scripts/run-qa-lanes.mjs",
    root: ctx.root,
    manifest: relative(ctx.root, manifest.path),
    manifestSha256: manifest.sha256,
    suite: opts.only ? "(only)" : opts.suite,
    selected: selected.length,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    durationMs: null,
    complete: false,
    exitCodes: { allGreen: EXIT.GREEN, someUnavailable: EXIT.UNAVAILABLE, someFailed: EXIT.FAILED, runnerError: EXIT.RUNNER_ERROR },
    drift: ctx.drift,
    lanes: [],
    counts: { pass: 0, unavailable: 0, fail: 0 },
    exitCode: null,
  }
  const startedMs = Date.now()
  const emit = (line) => {
    process.stdout.write(line + "\n")
    appendFileSync(ctx.outputPath, line + "\n")
  }
  emit("[mpd-qa:" + run.suite + "] runner start manifest=" + run.manifest + " sha256=" + run.manifestSha256.slice(0, 12) + " lanes=" + selected.length + " evidence=" + ctx.evidenceDir)
  for (const driftKind of ["unlistedScripts", "missingScripts"]) {
    const value = ctx.drift[driftKind]
    if (value.length > 0) emit("[mpd-qa:" + run.suite + "] drift " + driftKind + "=" + value.length + " (run --list --check-drift for detail)")
  }
  // T-89 runner half: the discovered COUNT is printed on every run, and any count problem is loud.
  emit("[mpd-qa:" + run.suite + "] discovery=" + ctx.drift.countDrift.discovered + " lane script(s) (.mjs entries " + ctx.drift.countDrift.allMjsEntries + ", underscore-excluded " + ctx.drift.countDrift.excludedUnderscore.length + ", unlisted " + ctx.drift.countDrift.unlisted + ", outside-suite " + ctx.drift.countDrift.outsideSuites + ")")
  for (const problem of ctx.drift.countDrift.problems) emit("[mpd-qa:" + run.suite + "] drift count: " + problem)
  // T-83: the resolved required set is printed on EVERY run — including `required=0`, which is a RED.
  emit("[mpd-qa:" + run.suite + "] immutability required=" + ctx.drift.guard.required.length + (ctx.drift.guard.required.length === 0 ? " (RED: no lane declares required)" : ": " + ctx.drift.guard.required.join(", ")) + " exempt=" + ctx.drift.guard.exemptCount)
  for (const problem of guardProblems(ctx.drift.guard)) emit("[mpd-qa:" + run.suite + "] immutability guard: " + problem)
  for (const entry of selected) {
    const lane = runEntry(entry, ctx)
    lane.suite = run.suite
    run.lanes.push(lane)
    const { counts, exitCode } = summarize(run)
    run.counts = counts
    run.exitCode = exitCode
    writeResult(ctx.resultPath, run)
    emit(printLaneLine(lane))
  }
  const { counts, exitCode } = summarize(run)
  run.counts = counts
  run.exitCode = exitCode
  run.finishedAt = new Date().toISOString()
  run.durationMs = Date.now() - startedMs
  run.complete = true
  writeResult(ctx.resultPath, run)
  emit("[mpd-qa:" + run.suite + "] summary selected=" + selected.length + " pass=" + counts.pass + " unavailable=" + counts.unavailable + " fail=" + counts.fail)
  emit("[mpd-qa:" + run.suite + "] evidence -> " + ctx.evidenceDir)
  emit("[mpd-qa:" + run.suite + "] exit " + exitCode + " (0=all green, 2=some unavailable, 1=some failed, 3=runner error)")
  return run
}

function listRegistry(root, manifest, drift, asJson) {
  const entries = manifest.entries.map((entry) => ({
    case: entry.case,
    kind: entry.kind ?? "lane",
    suites: entry.suites ?? [],
    script: entry.script ?? null,
    args: entry.args ?? [],
    prereq: entry.prereq ?? [],
    outsideSuites: entry.outsideSuites ?? null,
    immutabilityGuard: entry.immutabilityGuard ?? null,
  }))
  if (asJson) {
    return JSON.stringify({ manifest: relative(root, manifest.path), manifestSha256: manifest.sha256, entries, drift }, null, 2)
  }
  const lines = [
    "manifest: " + relative(root, manifest.path) + " (sha256 " + manifest.sha256.slice(0, 12) + ")",
    "cases: " + entries.length + " (" + entries.filter((e) => e.kind === "lane").length + " lanes + " + entries.filter((e) => e.kind === "gate").length + " gates; the all suite selects " + entries.filter((e) => e.suites.includes("all") && e.kind === "lane").length + " lanes + " + entries.filter((e) => e.suites.includes("all") && e.kind === "gate").length + " gates)",
    "",
    ["CASE", "KIND", "SUITES", "SCRIPT"].join("\t"),
  ]
  for (const entry of entries) {
    lines.push([entry.case, entry.kind, entry.suites.join(",") || "-", entry.script ?? "-"].join("\t"))
  }
  lines.push("")
  const outside = entries.filter((e) => e.suites.length === 0)
  lines.push("outside every suite (" + outside.length + ") — explicit, with reason:")
  for (const entry of outside) lines.push("  - " + entry.case + ": " + (entry.outsideSuites ?? "(no reason recorded — drift)"))
  lines.push("")
  lines.push("immutabilityGuard required (" + drift.guard.required.length + "): " + (drift.guard.required.join(", ") || "NONE — a resolved required set that is empty is a RED"))
  lines.push("immutabilityGuard exempt (" + drift.guard.exemptCount + ") — each with a declared reason; no lane may be silent")
  for (const problem of guardProblems(drift.guard)) lines.push("immutabilityGuard PROBLEM: " + problem)
  lines.push("")
  lines.push("discovery (" + drift.countDrift.discovered + " lane script(s); .mjs entries " + drift.countDrift.allMjsEntries + ", underscore-excluded " + drift.countDrift.excludedUnderscore.length + ", outside-suite " + drift.countDrift.outsideSuites + ")")
  for (const problem of drift.countDrift.problems) lines.push("discovery PROBLEM: " + problem)
  lines.push("drift unlistedScripts (" + drift.unlistedScripts.length + "): " + (drift.unlistedScripts.join(", ") || "none"))
  lines.push("drift missingScripts (" + drift.missingScripts.length + "): " + (drift.missingScripts.map((m) => m.case + " -> " + m.script).join(", ") || "none"))
  return lines.join("\n")
}

function makeContext(opts, drift) {
  const evidenceDir = opts.evidenceDir
    ? (isAbsolute(opts.evidenceDir) ? opts.evidenceDir : join(opts.root, opts.evidenceDir))
    : join(opts.root, "evidence", "dsh-qa", "suite-runner", stamp())
  const laneLogDir = join(evidenceDir, "lanes")
  mkdirSync(laneLogDir, { recursive: true })
  const outputPath = join(evidenceDir, "output.log")
  writeFileSync(outputPath, "")
  return {
    root: opts.root,
    timeoutMs: opts.timeoutMs,
    defaultArgs: ["--no-skip"],
    drift,
    evidenceDir: relative(opts.root, evidenceDir) || evidenceDir,
    laneLogDir,
    outputPath,
    resultPath: join(evidenceDir, "result.json"),
  }
}

function selfTest() {
  const FIXTURE_EXEMPT = "exempt: fixture lane — takes no caller-supplied output target"
  const fixtureRoot = mkdtempSync(join(tmpdir(), "mpd-qa-runner-selftest-"))
  const laneDir = join(fixtureRoot, LANE_DIR)
  mkdirSync(laneDir, { recursive: true })
  const fixtures = {
    "fx-fail.mjs": "console.log('fx-fail: assertion failed: expected 1 got 2')\nprocess.exit(1)\n",
    "fx-pass.mjs": "console.log('fx-pass ok')\nprocess.exit(0)\n",
    "fx-skip.mjs": "console.log('[mpd-qa] SKIP case=fx-skip lane=real reason=absent-credentials prereq=tui profile in the sandbox root remedy=\"copy credentials\"')\nprocess.exit(0)\n",
    "fx-short.mjs": "console.log('[mpd-qa] FAIL case=fx-short lane=real reason=absent-runtime')\nprocess.exit(1)\n",
    "fx-unavailable.mjs": "console.log('[mpd-qa] FAIL case=fx-unavailable lane=real reason=absent-staged-pack prereq=dist/mpd-package/package.json remedy=\"node scripts/pack-mpd.mjs\"')\nprocess.exit(1)\n",
    "fx-usage.mjs": "console.error('usage: fx-usage --expect=<substring>')\nprocess.exit(2)\n",
    "fx-hang.mjs": "setTimeout(() => {}, 5000)\n",
    "fx-outside.mjs": "console.log('fx-outside: declared in the manifest with suites=[] — a deliberate exclusion, not drift')\nprocess.exit(0)\n",
    "fx-truly-unlisted.mjs": "console.log('fx-truly-unlisted: on disk in NO manifest entry')\nprocess.exit(0)\n",
    // T-89 runner half fixtures: one DOCUMENTED exclusion (underscore prefix) and one non-.mjs file.
    // Neither is a lane; the count assertion must still account for the underscore one and never count
    // the .txt one — a discovery that started counting either would redden the partition arm below.
    "_fx-internal.mjs": "console.log('_fx-internal: a helper, not a lane — the underscore prefix is the documented exclusion')\nprocess.exit(0)\n",
    "fx-notes.txt": "not a lane script; the discovery only considers .mjs entries\n",
    // Marker-less lanes are the majority in the real corpus (only ~6 of 44 implement the protocol),
    // so the runner must read their OWN recorded signatures: a missing provider credential makes the
    // lane UNAVAILABLE, while a 401 means the service answered and refused — the lane really failed.
    "fx-credential.mjs": "console.log('dsh: MISSING_CREDENTIAL: llm-deepseek: no API key for provider route \"deepseek-official\"')\nprocess.exit(1)\n",
    "fx-401.mjs": "console.log('webRoute: {\"ok\":false,\"status\":401,\"body\":\"{\\\"error\\\":\\\"unauthorized\\\"}\"}')\nprocess.exit(1)\n",
    "fx-both.mjs": "console.log('webRoute: {\"ok\":false,\"status\":401,\"body\":\"{\\\"error\\\":\\\"unauthorized\\\"}\"}')\nconsole.log('dsh: MISSING_CREDENTIAL: no API key for provider route \"deepseek-official\"')\nprocess.exit(1)\n",
    // RUNG 2's fixture (t73): the same fence string, but printed while a step was PASSING, plus a
    // structured step map that names a DIFFERENT failing step — the label must come from the map.
    "fx-expected-fence.mjs": [
      "import { mkdirSync, writeFileSync } from 'node:fs'",
      "const fence = JSON.stringify({ ok: true, arm: 'fence-refusal', status: 401, body: JSON.stringify({ error: 'unauthorized' }) })",
      "mkdirSync('evidence/fx-expected-fence', { recursive: true })",
      "writeFileSync('evidence/fx-expected-fence/result.json', JSON.stringify({ steps: { webRoute: { ok: true, arm: 'fence-refusal', status: 401 }, archive: { ok: false, detail: 'the headless turn never ran the follow-up the model deferred' } } }))",
      "console.log('webRoute: ' + fence)",
      "console.log('evidence: evidence/fx-expected-fence/result.json')",
      "process.exit(1)",
      "",
    ].join("\n"),
    // T-83 arm fixtures: one required lane that REALLY imports the guard and drives it over a fresh
    // target (load-bearing, not a decorative import), and one that deliberately does not import it.
    "fx-guard-ok.mjs": [
      "import { mkdtempSync } from 'node:fs'",
      "import { tmpdir } from 'node:os'",
      "import { join } from 'node:path'",
      "import { exitOnRefusal, refuseOverwrite } from './lib/immutable-output.mjs'",
      "const dir = mkdtempSync(join(tmpdir(), 'fx-guard-ok-'))",
      "try { refuseOverwrite(join(dir, 'result.json'), { label: 'fixture result.json' }) } catch (error) { exitOnRefusal(error, '[fx-guard-ok]') }",
      "console.log('fx-guard-ok: the guard accepted a fresh target')",
      "process.exit(0)",
      "",
    ].join("\n"),
    "fx-guard-bad.mjs": "console.log('fx-guard-bad: a required fixture lane WITHOUT the guard import — present only to drive the missing-import arm')\nprocess.exit(0)\n",
  }
  // The fixture's own stub of the helper, so fx-guard-ok's import is real and resolvable.
  mkdirSync(join(laneDir, "lib"), { recursive: true })
  writeFileSync(join(laneDir, "lib", "immutable-output.mjs"), [
    "import { existsSync } from 'node:fs'",
    "export const IMMUTABLE_EXIT_CODE = 3",
    "export class ImmutableOutputError extends Error {",
    "  constructor(message) { super(message); this.name = 'ImmutableOutputError'; this.exitCode = IMMUTABLE_EXIT_CODE }",
    "}",
    "export function refuseOverwrite(target, { label = 'output' } = {}) {",
    "  if (existsSync(target)) throw new ImmutableOutputError('refusing to overwrite the existing ' + label + ': ' + target)",
    "  return target",
    "}",
    "export function exitOnRefusal(error, prefix) {",
    "  if (error instanceof ImmutableOutputError) { console.error(prefix + ' ' + error.message); process.exit(error.exitCode) }",
    "  throw error",
    "}",
    "",
  ].join("\n"))
  for (const [name, body] of Object.entries(fixtures)) writeFileSync(join(laneDir, name), body)
  const fixtureManifest = join(fixtureRoot, DEFAULT_MANIFEST)
  mkdirSync(dirname(fixtureManifest), { recursive: true })
  writeFileSync(fixtureManifest, JSON.stringify({
    manifestVersion: 1,
    lanes: [
      { case: "fx-fail", script: LANE_DIR + "/fx-fail.mjs", suites: ["all"], immutabilityGuard: FIXTURE_EXEMPT },
      { case: "fx-pass", script: LANE_DIR + "/fx-pass.mjs", suites: ["all"], immutabilityGuard: FIXTURE_EXEMPT },
      { case: "fx-skip", script: LANE_DIR + "/fx-skip.mjs", suites: ["all"], immutabilityGuard: FIXTURE_EXEMPT },
      { case: "fx-short", script: LANE_DIR + "/fx-short.mjs", suites: ["all"], immutabilityGuard: FIXTURE_EXEMPT },
      { case: "fx-unavailable", script: LANE_DIR + "/fx-unavailable.mjs", suites: ["all"], immutabilityGuard: FIXTURE_EXEMPT },
      { case: "fx-usage", script: LANE_DIR + "/fx-usage.mjs", suites: ["all"], immutabilityGuard: FIXTURE_EXEMPT },
      { case: "fx-hang", script: LANE_DIR + "/fx-hang.mjs", suites: ["all"], args: ["--no-skip"], timeoutMs: 400, immutabilityGuard: FIXTURE_EXEMPT },
      { case: "fx-credential", script: LANE_DIR + "/fx-credential.mjs", suites: ["all"], immutabilityGuard: FIXTURE_EXEMPT },
      { case: "fx-401", script: LANE_DIR + "/fx-401.mjs", suites: ["all"], immutabilityGuard: FIXTURE_EXEMPT },
      { case: "fx-both", script: LANE_DIR + "/fx-both.mjs", suites: ["all"], immutabilityGuard: FIXTURE_EXEMPT },
      { case: "fx-expected-fence", script: LANE_DIR + "/fx-expected-fence.mjs", suites: ["all"], immutabilityGuard: FIXTURE_EXEMPT },
      { case: "fx-missing", script: LANE_DIR + "/fx-missing-does-not-exist.mjs", suites: ["all"], immutabilityGuard: FIXTURE_EXEMPT },
      { case: "fx-guard-ok", script: LANE_DIR + "/fx-guard-ok.mjs", suites: ["all"], immutabilityGuard: "required" },
      { case: "fx-guard-bad", script: LANE_DIR + "/fx-guard-bad.mjs", suites: ["all"], immutabilityGuard: FIXTURE_EXEMPT },
      { case: "fx-outside", script: LANE_DIR + "/fx-outside.mjs", suites: [], outsideSuites: "fixture: deliberately outside every suite", immutabilityGuard: FIXTURE_EXEMPT },
    ],
    gates: [
      { case: "fx-gate-ok", kind: "gate", argv: ["node", "-e", "process.exit(0)"], suites: [] },
      { case: "fx-gate-fail", kind: "gate", argv: ["node", "-e", "process.exit(1)"], suites: [] },
    ],
  }, null, 2))
  // A second manifest that accounts for EVERY fixture script on disk: the positive control for
  // --check-drift (no drift -> exit 0) next to the drifted manifest above (drift -> exit 1).
  const cleanManifest = "fixtures-clean-manifest.json"
  writeFileSync(join(fixtureRoot, cleanManifest), JSON.stringify({
    manifestVersion: 1,
    lanes: Object.keys(fixtures).map((name) => ({
      case: name.replace(/\.mjs$/, ""),
      script: LANE_DIR + "/" + name,
      suites: [],
      // fx-guard-ok is the ONE required fixture lane (its import is real); fx-guard-bad is declared
      // exempt here on purpose — it drives the missing-import arm through the separate manifest below.
      immutabilityGuard: name === "fx-guard-ok.mjs" ? "required" : FIXTURE_EXEMPT,
    })),
  }, null, 2))
  // Three deliberately broken guard manifests: (a) a required lane with no import, (b) an undeclared
  // lane, (c) an all-exempt set whose resolved required count is zero. Each must redden --check-drift.
  const guardManifests = {
    "fixtures-guard-missing-import.json": [
      { case: "fx-guard-ok", script: LANE_DIR + "/fx-guard-ok.mjs", suites: [], immutabilityGuard: "required" },
      { case: "fx-guard-bad", script: LANE_DIR + "/fx-guard-bad.mjs", suites: [], immutabilityGuard: "required" },
    ],
    "fixtures-guard-undeclared.json": [
      { case: "fx-guard-ok", script: LANE_DIR + "/fx-guard-ok.mjs", suites: [], immutabilityGuard: "required" },
      { case: "fx-pass", script: LANE_DIR + "/fx-pass.mjs", suites: [] },
    ],
    "fixtures-guard-empty.json": [
      { case: "fx-pass", script: LANE_DIR + "/fx-pass.mjs", suites: [], immutabilityGuard: FIXTURE_EXEMPT },
    ],
  }
  for (const [name, lanes] of Object.entries(guardManifests)) {
    writeFileSync(join(fixtureRoot, name), JSON.stringify({ manifestVersion: 1, lanes }, null, 2))
  }
  const failures = []
  const runChild = (args) => {
    const proc = spawnSync(process.execPath, [fileURLToPath(import.meta.url), ...args], { encoding: "utf8", cwd: fixtureRoot })
    return { status: proc.status, stdout: proc.stdout, stderr: proc.stderr }
  }
  const listResult = runChild(["--root=" + fixtureRoot, "--manifest=" + DEFAULT_MANIFEST, "--list", "--json"])
  if (listResult.status !== 0) failures.push("--list --json exited " + listResult.status + ": " + listResult.stderr.slice(0, 300))
  else {
    const registry = JSON.parse(listResult.stdout)
    const unlisted = registry.drift.unlistedScripts
    if (!unlisted.includes(LANE_DIR + "/fx-truly-unlisted.mjs")) failures.push("--list --json did not report the unlisted on-disk fixture lane: " + JSON.stringify(unlisted))
    if (unlisted.includes(LANE_DIR + "/fx-outside.mjs")) failures.push("a lane declared with suites=[] was wrongly reported as drift: " + JSON.stringify(unlisted))
    if (registry.drift.missingScripts.length !== 1) failures.push("--list --json did not report the manifest entry whose script is gone")
    const outside = registry.entries.filter((entry) => entry.suites.length === 0)
    if (outside.length !== 3) failures.push("--list --json reported " + outside.length + " entries outside every suite (expected 3: fx-outside + the two fixture gates)")
  }
  const driftResult = runChild(["--root=" + fixtureRoot, "--manifest=" + DEFAULT_MANIFEST, "--check-drift"])
  if (driftResult.status !== 1) failures.push("--check-drift exited " + driftResult.status + " on a drifted fixture (expected 1)")
  const cleanDrift = runChild(["--root=" + fixtureRoot, "--manifest=" + cleanManifest, "--check-drift"])
  if (cleanDrift.status !== 0) failures.push("--check-drift exited " + cleanDrift.status + " on a fixture where every on-disk script is declared (expected 0)")
  // ── T-83 guard arms: the mandatory declaration, both frozen falsifications, and the empty-set RED ──
  if (!/immutability required=1: fx-guard-ok/.test(cleanDrift.stdout)) failures.push("a clean --check-drift did not print the resolved required set (required=1: fx-guard-ok): " + cleanDrift.stdout.slice(-200))
  const guardMissingImport = runChild(["--root=" + fixtureRoot, "--manifest=fixtures-guard-missing-import.json", "--check-drift"])
  if (guardMissingImport.status !== 1) failures.push("--check-drift exited " + guardMissingImport.status + " when a required driver does not import the guard (expected 1)")
  if (!guardMissingImport.stderr.includes("fx-guard-bad.mjs")) failures.push("the missing-import arm did not NAME the driver: " + guardMissingImport.stderr.slice(0, 300))
  if (!guardMissingImport.stderr.includes(GUARD_SPECIFIER)) failures.push("the missing-import arm did not name the missing specifier: " + guardMissingImport.stderr.slice(0, 300))
  const guardUndeclared = runChild(["--root=" + fixtureRoot, "--manifest=fixtures-guard-undeclared.json", "--check-drift"])
  if (guardUndeclared.status !== 1) failures.push("--check-drift exited " + guardUndeclared.status + " when a lane carries no guard declaration (expected 1)")
  if (!guardUndeclared.stderr.includes("fx-pass")) failures.push("the undeclared arm did not NAME the case: " + guardUndeclared.stderr.slice(0, 300))
  const guardEmpty = runChild(["--root=" + fixtureRoot, "--manifest=fixtures-guard-empty.json", "--check-drift"])
  if (guardEmpty.status !== 1) failures.push("--check-drift exited " + guardEmpty.status + " on an all-exempt manifest whose required set resolves to zero (expected 1)")
  if (!/required set is EMPTY/.test(guardEmpty.stderr)) failures.push("the empty-set arm did not say the required set is EMPTY: " + guardEmpty.stderr.slice(0, 300))
  const green = runChild(["--root=" + fixtureRoot, "--manifest=" + DEFAULT_MANIFEST, "--only=fx-pass,fx-gate-ok", "--evidence-dir=ev-green"])
  if (green.status !== 0) failures.push("all-green subset exited " + green.status + " (expected 0): " + green.stdout.slice(-300))
  if (!/immutability required=1: fx-guard-ok/.test(green.stdout)) failures.push("a normal suite run did not print the resolved required set — it must be printed on EVERY run: " + green.stdout.slice(0, 300))
  // The space-separated spelling is the one the task contracts and SKILL.md document: pin it.
  const spaceForm = runChild(["--root", fixtureRoot, "--manifest", DEFAULT_MANIFEST, "--only", "fx-pass", "--evidence-dir", "ev-space"])
  if (spaceForm.status !== 0) failures.push("the space-separated flag spelling exited " + spaceForm.status + " (expected 0) — the documented invocations use it")
  const unavailable = runChild(["--root=" + fixtureRoot, "--manifest=" + DEFAULT_MANIFEST, "--only=fx-skip,fx-unavailable", "--evidence-dir=ev-unavailable"])
  if (unavailable.status !== 2) failures.push("unavailable-only subset exited " + unavailable.status + " (expected 2): " + unavailable.stdout.slice(-300))
  if (!/UNAVAILABLE case=fx-unavailable reason=absent-staged-pack/.test(unavailable.stdout)) failures.push("the prereq-absence FAIL marker was not reported as unavailable")
  const mixed = runChild(["--root=" + fixtureRoot, "--manifest=" + DEFAULT_MANIFEST, "--only=fx-fail,fx-pass,fx-skip,fx-unavailable,fx-short,fx-credential,fx-401,fx-both,fx-expected-fence,fx-usage,fx-hang,fx-missing,fx-gate-fail", "--evidence-dir=ev-mixed"])
  if (mixed.status !== 1) failures.push("mixed subset exited " + mixed.status + " (expected 1)")
  const resultPath = join(fixtureRoot, "ev-mixed", "result.json")
  if (!existsSync(resultPath)) failures.push("mixed run wrote no result.json")
  else {
    const result = readJson(resultPath)
    const byCase = Object.fromEntries(result.lanes.map((lane) => [lane.case, lane]))
    const expected = { "fx-fail": "fail", "fx-pass": "pass", "fx-skip": "unavailable", "fx-unavailable": "unavailable", "fx-short": "unavailable", "fx-credential": "unavailable", "fx-401": "fail", "fx-both": "fail", "fx-expected-fence": "fail", "fx-usage": "fail", "fx-hang": "fail", "fx-missing": "fail", "fx-gate-fail": "fail" }
    for (const [name, verdict] of Object.entries(expected)) {
      if (byCase[name]?.verdict !== verdict) failures.push("lane " + name + " classified " + (byCase[name]?.verdict ?? "missing") + ", expected " + verdict)
    }
    if (byCase["fx-fail"].reason !== "exit-1") failures.push("fx-fail reason was " + byCase["fx-fail"].reason + " (expected exit-1) — a marker-less failure must not be read as a prerequisite")
    if (byCase["fx-usage"].reason !== "usage-error") failures.push("fx-usage reason was " + byCase["fx-usage"].reason + " (expected usage-error)")
    if (byCase["fx-hang"].reason !== "timeout") failures.push("fx-hang reason was " + byCase["fx-hang"].reason + " (expected timeout)")
    if (byCase["fx-missing"].reason !== "script-missing") failures.push("fx-missing reason was " + byCase["fx-missing"].reason + " (expected script-missing)")
    if (byCase["fx-skip"].marker?.reason !== "absent-credentials") failures.push("SKIP marker reason was not parsed: " + JSON.stringify(byCase["fx-skip"].marker))
    if (byCase["fx-skip"].marker?.prereq !== "tui profile in the sandbox root") failures.push("a marker prereq containing SPACES was mis-parsed (measured on tui-mount): " + JSON.stringify(byCase["fx-skip"].marker))
    if (byCase["fx-skip"].marker?.remedy !== "copy credentials") failures.push("marker remedy quotes were not stripped: " + JSON.stringify(byCase["fx-skip"].marker))
    if (byCase["fx-short"].reason !== "absent-runtime") failures.push("the short marker spelling (no prereq/remedy) was not parsed: " + JSON.stringify(byCase["fx-short"].marker))
    // The runner-side prerequisite classification: a missing provider credential is UNAVAILABLE
    // (with the file and line that carry the signature), a 401 is a FAILURE, and a lane that
    // records both is reported as the failure with the prerequisite surfaced separately.
    if (byCase["fx-credential"].reason !== "absent-credentials") failures.push("a marker-less credential abort was not classified as absent-credentials: " + JSON.stringify(byCase["fx-credential"]))
    if (byCase["fx-credential"].signature?.label === undefined) failures.push("the credential verdict carries no prerequisite label")
    if (byCase["fx-401"].reason !== "unauthorized") failures.push("a marker-less 401 was not classified as unauthorized: " + JSON.stringify(byCase["fx-401"]))
    if (byCase["fx-both"].reason !== "unauthorized") failures.push("a lane recording both a 401 and a missing key must report the FAILURE: " + JSON.stringify(byCase["fx-both"]))
    if (byCase["fx-both"].alsoDetected?.[0]?.code !== "absent-credentials") failures.push("the co-detected credential signature was dropped from fx-both: " + JSON.stringify(byCase["fx-both"].alsoDetected))
    // RUNG 2 (t73): when the lane's own evidence carries a step map, the label MUST name the step
    // it marks failed, and a signature printed inside a PASSING step may only appear under
    // alsoDetected. fx-expected-fence prints exactly the 401 fence text fx-401 fails on, but its
    // map marks `webRoute` ok and `archive` failed — so the reason must be the STEP, not the text.
    if (byCase["fx-expected-fence"].reason !== "step:archive") failures.push("fx-expected-fence reason was " + byCase["fx-expected-fence"].reason + " (expected step:archive — a fence inside a PASSING step must never become the reason)")
    if (byCase["fx-expected-fence"].signature?.code !== "step:archive") failures.push("fx-expected-fence signature was " + JSON.stringify(byCase["fx-expected-fence"].signature) + " (expected the failing step named by the lane's own evidence)")
    if (!(byCase["fx-expected-fence"].alsoDetected ?? []).some((entry) => entry.code === "unauthorized")) failures.push("the expected 401 fence was not reported under alsoDetected for fx-expected-fence: " + JSON.stringify(byCase["fx-expected-fence"].alsoDetected))
    if (byCase["fx-expected-fence"].verdict !== "fail") failures.push("the rung-2 relabel must not move the verdict: " + JSON.stringify(byCase["fx-expected-fence"].verdict))
    // The continue-past-failure property: fx-fail ran FIRST and every later lane still ran.
    if (result.lanes.length !== 13) failures.push("mixed run recorded " + result.lanes.length + " lanes (expected 13)")
    if (result.counts.pass !== 1 || result.counts.unavailable !== 4 || result.counts.fail !== 8) failures.push("mixed counts were " + JSON.stringify(result.counts))
    const failIndex = result.lanes.findIndex((lane) => lane.case === "fx-fail")
    const lastIndex = result.lanes.length - 1
    if (failIndex !== 0 || result.lanes[lastIndex].case !== "fx-gate-fail") failures.push("the run did not continue to the last lane after the first failure")
    if (!result.complete) failures.push("mixed run result.json is not marked complete")
    if (!result.manifestSha256) failures.push("mixed run result.json carries no manifest hash")
    const logs = readdirSync(join(fixtureRoot, "ev-mixed", "lanes"))
    if (!logs.includes("fx-pass.log")) failures.push("per-lane log for fx-pass missing (stdio must go to files)")
  }
  const unknownCase = runChild(["--root=" + fixtureRoot, "--manifest=" + DEFAULT_MANIFEST, "--only=fx-nope", "--evidence-dir=ev-unknown"])
  if (unknownCase.status !== 3) failures.push("--only with an unknown case exited " + unknownCase.status + " (expected 3)")
  const unknownSuite = runChild(["--root=" + fixtureRoot, "--manifest=" + DEFAULT_MANIFEST, "--suite=nope", "--evidence-dir=ev-suite"])
  if (unknownSuite.status !== 3) failures.push("--suite with no members exited " + unknownSuite.status + " (expected 3)")
  rmSync(fixtureRoot, { recursive: true, force: true })
  if (failures.length > 0) {
    console.error("[run-qa-lanes self-test] FAIL:")
    for (const failure of failures) console.error("  - " + failure)
    process.exit(1)
  }
  console.log("[run-qa-lanes self-test] ok: classification (pass/unavailable/fail), continue-past-failure, per-lane logs, exit codes 0/1/2/3, drift detection, the T-83 immutability-guard declaration rule (both falsifications + the empty-set RED) and the timeout guard verified on fixtures")
}

function main() {
  let opts
  try {
    opts = parseArgs(process.argv.slice(2))
  } catch (err) {
    console.error("[run-qa-lanes] " + err.message)
    process.exit(EXIT.RUNNER_ERROR)
  }
  if (opts.help) {
    console.log(usage())
    process.exit(EXIT.GREEN)
  }
  if (opts.selfTest) {
    selfTest()
    return
  }
  let manifest
  try {
    manifest = loadManifest(opts.root, opts.manifest ?? DEFAULT_MANIFEST)
  } catch (err) {
    console.error("[run-qa-lanes] " + err.message)
    process.exit(EXIT.RUNNER_ERROR)
  }
  const drift = collectDrift(opts.root, manifest)
  if (opts.list) {
    console.log(listRegistry(opts.root, manifest, drift, opts.json))
    process.exit(EXIT.GREEN)
  }
  if (opts.checkDrift) {
    const problems = guardProblems(drift.guard)
    if (opts.json) console.log(JSON.stringify(drift, null, 2))
    if (drift.unlistedScripts.length > 0) console.error("[run-qa-lanes] drift: " + drift.unlistedScripts.length + " lane script(s) on disk in no manifest entry: " + drift.unlistedScripts.join(", "))
    if (drift.missingScripts.length > 0) console.error("[run-qa-lanes] drift: " + drift.missingScripts.length + " manifest entry(ies) whose script is gone: " + drift.missingScripts.map((m) => m.case).join(", "))
    // T-89 runner half: the discovered count is PRINTED and asserted — every number here came from this
    // run's own walk of the lane directory, so a silently-discovered copy cannot stay invisible.
    console.log("[run-qa-lanes] discovery: " + drift.countDrift.discovered + " lane script(s) discovered (" + drift.countDrift.listed + " listed, " + drift.countDrift.unlisted + " unlisted, " + drift.countDrift.outsideSuites + " outside every suite); .mjs entries " + drift.countDrift.allMjsEntries + ", underscore-excluded " + drift.countDrift.excludedUnderscore.length)
    for (const problem of drift.countDrift.problems) console.error("[run-qa-lanes] drift: " + problem)
    for (const problem of problems) console.error("[run-qa-lanes] immutability guard: " + problem)
    // The resolved set is printed in the SAME canonical shape on every surface (check-drift, run, list).
    console.log("[run-qa-lanes] immutability required=" + drift.guard.required.length + (drift.guard.required.length === 0 ? " (RED: no lane declares required)" : ": " + drift.guard.required.join(", ")) + " exempt=" + drift.guard.exemptCount)
    if (drift.unlistedScripts.length === 0 && drift.missingScripts.length === 0 && drift.countDrift.problems.length === 0 && problems.length === 0) {
      console.log("[run-qa-lanes] manifest and disk agree (" + manifest.entries.length + " entries, " + drift.countDrift.discovered + " lane script(s) discovered) and the immutability guard is declared")
    }
    process.exit(drift.unlistedScripts.length > 0 || drift.missingScripts.length > 0 || drift.countDrift.problems.length > 0 || problems.length > 0 ? EXIT.FAILED : EXIT.GREEN)
  }
  const ctx = makeContext(opts, drift)
  let run
  try {
    run = runSuite(opts, manifest, ctx)
  } catch (err) {
    console.error("[run-qa-lanes] " + err.message)
    process.exit(EXIT.RUNNER_ERROR)
  }
  if (opts.json) console.log(JSON.stringify(run, null, 2))
  process.exit(run.exitCode)
}

await main()
