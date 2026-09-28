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
//   node scripts/run-qa-lanes.ts                       # the `all` suite (what test:qa:all runs)
//   node scripts/run-qa-lanes.ts --list                # registry + drift, per lane
//   node scripts/run-qa-lanes.ts --check-drift         # exit 1 when the manifest and disk disagree
//   node scripts/run-qa-lanes.ts --only mount-assert,agent-teams-adopt
//   node scripts/run-qa-lanes.ts --help
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { appendFileSync, closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import type { Stats } from "node:fs"
import { tmpdir } from "node:os"
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { readJson } from "./lib/repo.ts"

/** Directory holding this script, used to derive the default repository root. */
const HERE = dirname(fileURLToPath(import.meta.url))
/** Default repository root: the directory that owns the `scripts/` folder this file lives in. */
const DEFAULT_ROOT = resolve(HERE, "..")
/** Manifest path relative to the root, unless `--manifest` overrides it. */
const DEFAULT_MANIFEST = "skills/dsh-qa/cases.json"
/** Lane directory, as a DIRECTORY NAME relative to the root (it never carries an extension). */
const LANE_DIR = "skills/dsh-qa/scripts"
// T-83: the ONE specifier a `"required"` lane's driver must carry, asserted as a literal (never the
// export list — drivers legitimately import different members of the helper).
/** The immutability-helper specifier a `"required"` lane's driver must import. */
const GUARD_SPECIFIER = "./lib/immutable-output.ts"
/** The runner's four exit codes, so a caller can branch without parsing prose. */
interface ExitCodes {
  /** Every selected lane passed. */
  readonly GREEN: number
  /** At least one lane was unavailable and none failed. */
  readonly UNAVAILABLE: number
  /** At least one lane failed. */
  readonly FAILED: number
  /** Runner/config error: unknown case, unknown suite, or an unusable manifest. */
  readonly RUNNER_ERROR: number
}
/** The runner's exit-code table, one entry per documented outcome. */
const EXIT: ExitCodes = { GREEN: 0, UNAVAILABLE: 2, FAILED: 1, RUNNER_ERROR: 3 }
/** Default per-lane timeout in milliseconds (30 minutes) when neither the manifest nor `--timeout` sets one. */
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000
// Two spellings are in use: the full grammar with a quoted remedy, and a shorter one without.
// `prereq=` may be a PROBE PHRASE with spaces (`prereq=tui profile in the sandbox root`), so the
// prereq group is non-greedy and anchored on the ` remedy=` that follows it.
/** The `[mpd-qa]` marker grammar WITH a quoted remedy: the shape the suite's own lanes emit. */
const MARKER_FULL_RE = /^\[mpd-qa\] (SKIP|FAIL) case=(\S+) lane=(\S+) reason=(\S+) prereq=(.*?)\s+remedy=(.*)$/m
/** The `[mpd-qa]` marker grammar WITHOUT a remedy: the shorter spelling some lanes emit. */
const MARKER_SHORT_RE = /^\[mpd-qa\] (SKIP|FAIL) case=(\S+) lane=(\S+) reason=(\S+)(?:\s+prereq=(.*?))?\s*$/m

/** A lane's outcome: the three verdicts the exit-code summary counts. */
type Verdict = "pass" | "unavailable" | "fail"

/** One recorded signature the runner scans a lane's output for. */
interface SignatureRule {
  /** The reason code the signature maps to (`unauthorized`, `absent-credentials`, …). */
  readonly code: string
  /** The verdict a match implies: a refusal is a failure, a missing prerequisite is unavailability. */
  readonly verdict: Verdict
  /** The human-readable label printed in the lane line and in the result record. */
  readonly label: string
  /** The regular expression matched against the scanned text. */
  readonly test: RegExp
}

// Only a handful of the lane scripts implement the `[mpd-qa] SKIP|FAIL` protocol, so the runner —
// not each lane — owns the unavailable-vs-failed distinction. These are the signatures a lane
// records in its OWN stdout or in the evidence directory it printed. A 401 is deliberately NOT a
// prerequisite absence: the service answered and refused, so the lane really ran and really failed
// (measured: agent-teams-adopt is red on `webRoute … "status":401,"body":"{\"error\":\"unauthorized\"}"`
// in the pre-wave control too, while a missing provider key aborts before any assertion).
/** The signatures the runner recognises, checked in this order. */
const SIGNATURES: readonly SignatureRule[] = [
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

/** The message of a caught value: an Error's own message, else the value's string form. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// The reason-code class that means "this host lacks a prerequisite, the lane could not run"
// (SKILL.md documents the list; `absent-bundle-dist` is in use by the tui-settings-bridge lane
// and was missing from that list). Anything else is an assertion failure.
/** Whether a recorded reason names a missing prerequisite rather than a real assertion failure. */
function isPrereqReason(reason: unknown): boolean {
  return typeof reason === "string" && (reason === "unsupported-platform" || reason.startsWith("absent-"))
}

/** The current UTC instant as a filename-safe stamp (`:` replaced by `-`). */
function stamp(): string {
  return new Date().toISOString().replaceAll(":", "-")
}

/** Every parsed command-line option, with the argument parser's own defaults. */
interface Options {
  /** Suite to run; `all` is what `test:qa:all` selects. */
  suite: string
  /** Case names from `--only`, or null when the suite selection applies. */
  only: string[] | null
  /** `--list`: print the registry and the drift report, run nothing. */
  list: boolean
  /** `--check-drift`: exit 1 when the manifest and the disk disagree. */
  checkDrift: boolean
  /** `--json`: machine-readable output on the listing and suite surfaces. */
  json: boolean
  /** `--self-test`: run the fixture arms instead of any real lane. */
  selfTest: boolean
  /** `--help` / `-h`: print the usage block. */
  help: boolean
  /** Repository root the manifest's relative paths resolve against. */
  root: string
  /** Manifest path from `--manifest`, or null for the default. */
  manifest: string | null
  /** Evidence directory from `--evidence-dir`, or null for the timestamped default. */
  evidenceDir: string | null
  /** Per-lane timeout in milliseconds; 0 disables the runner's kill timer. */
  timeoutMs: number
}

/** Parse the command line into {@link Options}; any unusable argument throws. */
function parseArgs(argv: readonly string[]): Options {
  /** The option set under construction: every flag starts at its documented default. */
  const opts: Options = { suite: "all", only: null, list: false, checkDrift: false, json: false, selfTest: false, help: false, root: DEFAULT_ROOT, manifest: null, evidenceDir: null, timeoutMs: DEFAULT_TIMEOUT_MS }
  // Every value-taking flag accepts BOTH spellings (`--only=a,b` and `--only a,b`), because the
  // documented invocations in the task contracts and in SKILL.md use the space form.
  /** Flags that consume a value, in either `--flag=value` or `--flag value` spelling. */
  const VALUE_FLAGS: readonly string[] = ["only", "suite", "root", "manifest", "evidence-dir", "timeout"]
  /** The raw `--only` value while parsing; it is split into the option's list only once, at the end. */
  let onlyArg: string | null = null
  for (let i = 0; i < argv.length; i++) {
    /** The argument under inspection. */
    const arg = argv[i]
    /** Index of the `=` in a `--flag=value` spelling, or -1 when the value is not inline. */
    const eq = arg.startsWith("--") ? arg.indexOf("=") : -1
    /** The flag name without its leading dashes, or null when the token is not a flag. */
    const name = eq > 0 ? arg.slice(2, eq) : arg.startsWith("--") ? arg.slice(2) : null
    /** The flag's value: the inline `=value`, or null while it still has to come from the next token. */
    let value: string | null = eq > 0 ? arg.slice(eq + 1) : null
    if (name !== null && VALUE_FLAGS.includes(name)) {
      if (value === null) {
        if (i + 1 >= argv.length) throw new Error("--" + name + " requires a value")
        value = argv[++i]
      }
      if (name === "only") onlyArg = value
      else if (name === "suite") opts.suite = value
      else if (name === "root") opts.root = resolve(value)
      else if (name === "manifest") opts.manifest = value
      else if (name === "evidence-dir") opts.evidenceDir = value
      else {
        /** The requested timeout in milliseconds; 0 disables the timeout entirely. */
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
  /** `--only` split into trimmed, non-empty case names; null keeps the suite selection. */
  if (onlyArg !== null) opts.only = onlyArg.split(",").map((s: string): string => s.trim()).filter(Boolean)
  return opts
}

/** The usage block `--help` prints. */
function usage(): string {
  return [
    "QA suite runner (manifest: " + DEFAULT_MANIFEST + ")",
    "",
    "  node scripts/run-qa-lanes.ts [--suite=all] [--only=a,b] [--json] [--timeout=ms] [--evidence-dir=path]",
    "  node scripts/run-qa-lanes.ts --list [--json]",
    "  node scripts/run-qa-lanes.ts --check-drift",
    "  node scripts/run-qa-lanes.ts --self-test",
    "",
    "Verdicts: pass | unavailable (missing prerequisite, reason reported) | fail (ran and failed).",
    "Exit codes: 0 all green | 2 some unavailable | 1 some failed | 3 runner/config error.",
    "Lane stdout/stderr goes to FILES (lanes spawn dsh, whose MCP children hold inherited fds).",
  ].join("\n")
}

/** One lane or gate declaration as `skills/dsh-qa/cases.json` writes it. */
interface ManifestEntry {
  /** Stable case name, unique across the manifest and used by `--only`. */
  case: string
  /** `"gate"` for an argv-driven gate; absent (a lane) otherwise. */
  kind?: string
  /** Lane driver path relative to the root; absent for a gate. */
  script?: string
  /** Suites this entry belongs to; a missing list means it is outside every suite. */
  suites?: string[]
  /** Command and arguments of a gate, spawned without a shell. */
  argv?: string[]
  /** Extra arguments appended AFTER the suite's own default arguments of a lane. */
  args?: string[]
  /** Declared prerequisite names, reported verbatim by `--list`. */
  prereq?: string[]
  /** Declared reason an entry belongs to no suite; null when the manifest records none. */
  outsideSuites?: string | null
  /** The mandatory `"required"` / `"exempt: <reason>"` immutability-guard declaration. */
  immutabilityGuard?: string
  /** Per-entry timeout override in milliseconds; 0 disables the timeout for this entry. */
  timeoutMs?: number
}

/** The manifest document as it is parsed from disk. */
interface ManifestDocument {
  /** Schema version of the manifest file. */
  manifestVersion?: number
  /** Lane entries, in declaration order. */
  lanes?: ManifestEntry[]
  /** Gate entries, appended after the lanes. */
  gates?: ManifestEntry[]
}

/** A loaded, validated manifest plus the hash every result record quotes. */
interface LoadedManifest {
  /** Absolute path of the manifest file that was read. */
  readonly path: string
  /** The raw manifest text, hashed below and never re-read. */
  readonly text: string
  /** The parsed document, kept for callers that need the whole manifest. */
  readonly data: ManifestDocument
  /** Every lane and gate entry, lanes first. */
  readonly entries: ManifestEntry[]
  /** sha256 of `text`, quoted as `manifestSha256` in the result record. */
  readonly sha256: string
}

/** Read the manifest, validate the invariants the runner depends on, and hash its bytes. */
function loadManifest(root: string, manifestPath: string): LoadedManifest {
  /** Absolute manifest path: an absolute `--manifest` is used as given, else it resolves from the root. */
  const path = isAbsolute(manifestPath) ? manifestPath : join(root, manifestPath)
  if (!existsSync(path)) throw new Error("manifest not found: " + path)
  /** The manifest's bytes as text; the same text is hashed for the run record. */
  const text = readFileSync(path, "utf8")
  // JSON.parse returns `any`: the boundary cast below is the ONLY place the document's shape is
  // asserted, and every field the runner reads is either re-checked here or defaulted at its use.
  /** The parsed manifest document, typed by {@link ManifestDocument}. */
  let data: ManifestDocument
  try {
    data = JSON.parse(text) as ManifestDocument
  } catch (err) {
    throw new Error("manifest is not valid JSON (" + path + "): " + errorMessage(err))
  }
  /** Every declared entry: lanes first, then gates, exactly as the runner will select from them. */
  const entries: ManifestEntry[] = [...(data.lanes ?? []), ...(data.gates ?? [])]
  if (entries.length === 0) throw new Error("manifest declares no lanes: " + path)
  /** Case names already seen, so a duplicate is reported instead of silently shadowing one. */
  const seen = new Set<string>()
  for (const entry of entries) {
    if (!entry.case || typeof entry.case !== "string") throw new Error("manifest entry without a case name: " + JSON.stringify(entry))
    if (seen.has(entry.case)) throw new Error("duplicate case in manifest: " + entry.case)
    seen.add(entry.case)
    if (entry.kind !== "gate" && !entry.script) throw new Error("lane without a script: " + entry.case)
  }
  return { path, text, data, entries, sha256: createHash("sha256").update(text).digest("hex") }
}

/** The lane drivers the discovery considers: top-level `.ts` entries, underscore helpers excluded. */
function laneScriptsOnDisk(root: string): string[] {
  /** Absolute lane directory for this root. */
  const dir = join(root, LANE_DIR)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((name: string): boolean => name.endsWith(".ts"))
    .filter((name: string): boolean => !name.startsWith("_"))
    .sort()
    .map((name: string): string => LANE_DIR + "/" + name)
}

/** EVERY `.ts` entry in the lane directory, UNFILTERED and sorted — the independent walk the
 * discovery is asserted against (T-89's RUNNER half, lane B). */
function allTsEntries(root: string): string[] {
  /** Absolute lane directory for this root. */
  const dir = join(root, LANE_DIR)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((name: string): boolean => name.endsWith(".ts"))
    .sort()
    .map((name: string): string => LANE_DIR + "/" + name)
}

/** One manifest lane whose script file is no longer on disk. */
interface MissingScript {
  /** The case name of the entry whose driver is gone. */
  readonly case: string
  /** The declared driver path, or undefined for an entry that never had one. */
  readonly script: string | undefined
}

/** The count/partition assertions of T-89, all re-derived from the tree on every run. */
interface CountDrift {
  /** Lane scripts the discovery returned (what the runner will actually consider). */
  readonly discovered: number
  /** Every `.ts` entry in the lane directory, filtered or not (the independent walk). */
  readonly allTsEntries: number
  /** Discovered scripts the manifest declares. */
  readonly listed: number
  /** Discovered scripts the manifest does not declare at all. */
  readonly unlisted: number
  /** Declared lane scripts that belong to no suite (a deliberate exclusion). */
  readonly outsideSuites: number
  /** `.ts` entries excluded by the documented underscore rule. */
  readonly excludedUnderscore: string[]
  /** `.ts` entries the discovery dropped although no rule covers them. */
  readonly unexpectedDrop: string[]
  /** The partition arithmetic, with the boolean the assertion is about. */
  readonly partition: {
    /** Whether discovered + underscore-excluded accounts for every `.ts` entry. */
    readonly discoveredPlusExcludedEqualsAllTs: boolean
    /** Whether no count problem was found at all. */
    readonly ok: boolean
  }
  /** Every printable count problem; empty means the discovery is clean. */
  readonly problems: string[]
}

/** The immutability-guard declaration audit, one bucket per way a declaration can be wrong. */
interface GuardReport {
  /** Case names whose declaration is exactly `"required"`, sorted. */
  readonly required: string[]
  /** How many lanes declared a well-formed `exempt: <reason>`. */
  readonly exemptCount: number
  /** Case names with no declaration (or an empty one): the mandatory declaration is missing. */
  readonly undeclared: string[]
  /** Declarations that are neither `required` nor a well-formed exemption. */
  readonly malformed: MalformedGuard[]
  /** `required` drivers whose own bytes do not carry the guard specifier. */
  readonly missingImports: MissingGuardImport[]
  /** Whether the resolved required set is empty although lanes exist — always a RED. */
  readonly empty: boolean
}

/** One lane's malformed `immutabilityGuard` value, quoted back in the report. */
interface MalformedGuard {
  /** The case whose declaration is malformed. */
  readonly case: string
  /** The offending value exactly as the manifest holds it. */
  readonly value: string
}

/** One `required` lane whose driver does not import the immutability helper. */
interface MissingGuardImport {
  /** The case the driver belongs to. */
  readonly case: string
  /** The driver path relative to the root. */
  readonly script: string
  /** The specifier the driver was required to carry. */
  readonly expected: string
}

/** Everything the drift checks found, reported by `--list`, `--check-drift` and a suite run. */
interface DriftReport {
  /** On-disk lane scripts that appear in NO manifest entry. */
  readonly unlistedScripts: string[]
  /** Manifest lanes whose declared script file is gone. */
  readonly missingScripts: MissingScript[]
  /** The T-89 count/partition audit. */
  readonly countDrift: CountDrift
  /** The T-83 immutability-guard audit. */
  readonly guard: GuardReport
}

/** Compute every drift signal the runner reports, from one walk of the lane directory. */
function collectDrift(root: string, manifest: LoadedManifest): DriftReport {
  /** Every lane script the manifest declares; a gate entry has none, so undefined can appear here. */
  const declared = new Set(manifest.entries.filter((e: ManifestEntry): boolean => e.kind !== "gate").map((e: ManifestEntry): string | undefined => e.script))
  /** The lane drivers the discovery finds on disk for this root. */
  const discovered = laneScriptsOnDisk(root)
  /** On-disk drivers that no manifest entry declares. */
  const unlistedScripts = discovered.filter((script: string): boolean => !declared.has(script))
  /** Manifest lanes whose declared driver is no longer on disk. */
  const missingScripts: MissingScript[] = manifest.entries
    .filter((e: ManifestEntry): boolean => e.kind !== "gate" && (e.script ? !existsSync(join(root, e.script)) : false))
    .map((e: ManifestEntry): MissingScript => ({ case: e.case, script: e.script }))
  // A script that is on disk and in the manifest, but not in any suite, is a deliberate exclusion
  // and is NOT drift: the manifest states its reason (`outsideSuites`).
  /** The T-89 count/partition audit over the same discovery result. */
  const countDrift = collectCountDrift(root, manifest, discovered)
  return { unlistedScripts, missingScripts, countDrift, guard: collectGuard(root, manifest) }
}

/**
 * T-89's RUNNER half (lane B's obligation on this file): the discovery ASSERTS THE DISCOVERED FILE
 * COUNT, so a silently-discovered copy reddens. `discovered` is what the runner will actually
 * consider; `allTs` is an INDEPENDENT walk of the same directory. They may differ only by the
 * DOCUMENTED underscore exclusion — any other difference means the discovery dropped (or invented) a
 * file, which is the shape the row names. Every number is re-derived from the tree on every run and
 * is never a constant quoted from prose.
 */
function collectCountDrift(root: string, manifest: LoadedManifest, discovered: string[]): CountDrift {
  /** The independent walk: every `.ts` entry in the lane directory, filtered or not. */
  const allTs = allTsEntries(root)
  /** The discovery's own result as a set, for the partition comparison below. */
  const discoveredSet = new Set(discovered)
  // `pop()` is never undefined here: every element of either walk is `LANE_DIR + "/" + basename`, so the
  // split always has a last segment. The assertion only states what that construction already guarantees.
  /** `.ts` entries the discovery left out under the documented underscore rule. */
  const excludedUnderscore = allTs.filter((script: string): boolean => !discoveredSet.has(script) && script.split("/").pop()!.startsWith("_"))
  /** `.ts` entries the discovery dropped although the underscore rule does not cover them. */
  const unexpectedDrop = allTs.filter((script: string): boolean => !discoveredSet.has(script) && !script.split("/").pop()!.startsWith("_"))
  /** Declared lane scripts that belong to no suite: a deliberate exclusion. */
  const outsideSuites: Array<string | undefined> = manifest.entries
    .filter((e: ManifestEntry): boolean => e.kind !== "gate" && (e.script ? (e.suites ?? []).length === 0 : false))
    .map((e: ManifestEntry): string | undefined => e.script)
  /** The declared lane-script set, so `listed` and `unlisted` partition the discovery. */
  const declaredSet = declaredScriptSet(manifest)
  /** Discovered scripts the manifest declares: exactly what a suite run can execute. */
  const listed = discovered.filter((script: string): boolean => declaredSet.has(script))
  /** Discovered scripts with no manifest entry at all. */
  const unlisted = discovered.filter((script: string): boolean => !declaredSet.has(script))
  /** The printable count/partition problems; empty means the discovery is clean. */
  const problems: string[] = []
  if (unexpectedDrop.length > 0) problems.push("the discovery dropped " + unexpectedDrop.length + " .ts entry(ies) that are neither underscore-excluded nor declared: " + unexpectedDrop.join(", "))
  if (discovered.length + excludedUnderscore.length !== allTs.length) {
    problems.push("the discovery does not partition the directory: discovered=" + discovered.length + " + underscore-excluded=" + excludedUnderscore.length + " != .ts entries=" + allTs.length)
  }
  if (existsSync(join(root, LANE_DIR)) && discovered.length === 0 && allTs.length > 0) {
    problems.push("the lane directory holds " + allTs.length + " .ts entry(ies) but the discovery returned none (zero-subject discovery)")
  }
  return {
    discovered: discovered.length,
    allTsEntries: allTs.length,
    listed: listed.length,
    unlisted: unlisted.length,
    outsideSuites: outsideSuites.length,
    excludedUnderscore,
    unexpectedDrop,
    partition: { discoveredPlusExcludedEqualsAllTs: discovered.length + excludedUnderscore.length === allTs.length, ok: problems.length === 0 },
    problems,
  }
}

/** The DECLARED lane-script set, as a Set — shared by collectDrift and collectCountDrift. */
function declaredScriptSet(manifest: LoadedManifest): Set<string | undefined> {
  return new Set(manifest.entries.filter((e: ManifestEntry): boolean => e.kind !== "gate").map((e: ManifestEntry): string | undefined => e.script))
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
function collectGuard(root: string, manifest: LoadedManifest): GuardReport {
  /** The lane entries only: a gate has neither a driver file nor a guard declaration. */
  const lanes = manifest.entries.filter((e: ManifestEntry): boolean => e.kind !== "gate" && Boolean(e.script))
  /** Case names whose declaration is exactly `"required"`. */
  const required: string[] = []
  /** Case names whose declaration is a well-formed `exempt: <reason>`. */
  const exempt: string[] = []
  /** Case names with no usable declaration at all. */
  const undeclared: string[] = []
  /** Declarations that are neither `required` nor a well-formed exemption. */
  const malformed: MalformedGuard[] = []
  /** `required` drivers whose bytes do not carry the guard specifier. */
  const missingImports: MissingGuardImport[] = []
  for (const entry of lanes) {
    /** The entry's own declaration, read as an unknown JSON value before it is trusted. */
    const value = entry.immutabilityGuard
    if (typeof value !== "string" || value.trim() === "") {
      undeclared.push(entry.case)
      continue
    }
    // `lanes` holds only entries with a script (its filter requires one), so the two driver reads below
    // are always defined; the assertions state what that filter already guarantees.
    if (value === "required") {
      required.push(entry.case)
      /** The driver file whose import list must carry the guard specifier. */
      const path = join(root, entry.script!)
      if (existsSync(path) && !readFileSync(path, "utf8").includes(GUARD_SPECIFIER)) {
        missingImports.push({ case: entry.case, script: entry.script!, expected: GUARD_SPECIFIER })
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
function guardProblems(guard: GuardReport): string[] {
  return [
    ...guard.undeclared.map((name: string): string => "lane " + name + " carries no immutabilityGuard declaration (declare `required` or `exempt: <reason>`)"),
    ...guard.malformed.map((entry: MalformedGuard): string => "lane " + entry.case + " has a malformed immutabilityGuard: " + JSON.stringify(entry.value)),
    ...guard.missingImports.map((entry: MissingGuardImport): string => "required driver " + entry.script + " (" + entry.case + ") does not import " + entry.expected),
    ...(guard.empty ? ["the resolved required set is EMPTY — a declaration set that requires nothing is a RED"] : []),
  ]
}

/** Resolve the selected manifest entries from `--only` or the suite name; an empty selection throws. */
function selectEntries(manifest: LoadedManifest, opts: Options): ManifestEntry[] {
  if (opts.only) {
    /** Lookup from case name to its manifest entry, for `--only` resolution. */
    const byCase: Map<string, ManifestEntry> = new Map(manifest.entries.map((e: ManifestEntry): [string, ManifestEntry] => [e.case, e]))
    /** `--only` names the manifest does not declare; any of them is a usage error. */
    const unknown = opts.only.filter((name: string): boolean => !byCase.has(name))
    if (unknown.length > 0) throw new Error("--only names case(s) not in the manifest: " + unknown.join(", ") + " (see --list)")
    // Every name was checked against `byCase` immediately above, so each lookup is present.
    return opts.only.map((name: string): ManifestEntry => byCase.get(name)!)
  }
  /** The entries whose own `suites` list contains the requested suite. */
  const selected = manifest.entries.filter((entry: ManifestEntry): boolean => (entry.suites ?? []).includes(opts.suite))
  if (selected.length === 0) throw new Error("suite \"" + opts.suite + "\" matches no manifest entry (see --list)")
  return selected
}
/** A `[mpd-qa]` marker parsed out of a lane's own output. */
interface ParsedMarker {
  /** The marker keyword the grammar captured (`SKIP` or `FAIL`). */
  readonly kind: string
  /** The case name the lane reported. */
  readonly case: string
  /** The lane name the lane reported. */
  readonly lane: string
  /** The reason code, e.g. `absent-credentials` or `unauthorized`. */
  readonly reason: string
  /** The free-form prerequisite phrase, trimmed; `""` when the marker carried none. */
  readonly prereq: string
  /** The quoted remedy with its quotes stripped; `""` when the marker carried none. */
  readonly remedy: string
}

/** Parse the first `[mpd-qa]` marker in a lane's output, or null when it emitted none. */
function parseMarker(text: string): ParsedMarker | null {
  /** The first full-grammar marker, else the first short-grammar one. */
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

/** The last EXISTING evidence path a lane printed, as a root-relative path, or null. */
function findEvidencePath(text: string, root: string): string | null {
  /** Every path-shaped `evidence/…` token in the text, in printed order. */
  const candidates = text.match(/[A-Za-z0-9_./-]*evidence\/[A-Za-z0-9_@./-]+/g) ?? []
  for (const raw of candidates.reverse()) {
    /** The token with trailing sentence punctuation removed. */
    const cleaned = raw.replace(/[.,;:)\]]+$/, "")
    /** The token resolved against the root when it is not already absolute. */
    const absolute = isAbsolute(cleaned) ? cleaned : join(root, cleaned)
    if (existsSync(absolute)) {
      return isAbsolute(cleaned) ? relative(root, cleaned) : cleaned
    }
  }
  return null
}

/** The 1-based line number the given character index falls on. */
function lineOf(text: string, index: number): number {
  return text.slice(0, index).split(/\r?\n/).length
}

/** Every existing evidence path the lane printed in its own output (deduped, capped). */
function evidenceCandidates(log: string, root: string): string[] {
  /** Every path-shaped `evidence/…` token in the lane's output, in printed order. */
  const raw = log.match(/[A-Za-z0-9_./-]*evidence\/[A-Za-z0-9_@./-]+/g) ?? []
  /** The existing, deduplicated absolute evidence paths, in printed order. */
  const out: string[] = []
  for (const candidate of raw) {
    /** The token with trailing sentence punctuation removed. */
    const cleaned = candidate.replace(/[.,;:)\]]+$/, "")
    /** The token resolved against the root when it is not already absolute. */
    const absolute = isAbsolute(cleaned) ? cleaned : join(root, cleaned)
    if (existsSync(absolute) && !out.includes(absolute)) out.push(absolute)
  }
  return out.slice(-6)
}

/** One text source a signature may be matched against: a file, or the lane's own stdout. */
interface SignatureSource {
  /** Absolute path of the source file, or null for the lane's own stdout. */
  readonly file: string | null
  /** The scanned text, verbatim. */
  readonly text: string
}

// Read the lane's own evidence (plus the lane log itself) as text. Bounded on purpose: a lane's
// evidence is a handful of small files, and a credential PREREQUISITE must be reported from what
// the lane recorded — never inferred. Binary/unreadable files are skipped; no secret VALUE is
// copied anywhere, only the signature name plus the file and line that carry it.
/** Read the given targets (recursion depth 2, 60 files, 1 MiB each) into text sources. */
function collectEvidenceTexts(targets: readonly string[]): SignatureSource[] {
  /** The readable texts found so far; the walk stops adding once the file cap is reached. */
  const texts: SignatureSource[] = []
  /** Consider one target at the given depth, skipping binary, oversized and unreadable entries. */
  const consider = (target: string, depth: number): void => {
    if (texts.length >= 60) return
    // The catch below returns, so `stat` is always assigned on any path that reaches the next statement.
    /** `statSync`'s result for this target. */
    let stat: Stats
    try {
      stat = statSync(target)
    } catch {
      return
    }
    if (stat.isDirectory()) {
      if (depth >= 2) return
      /** The directory's entries, or an empty list when it cannot be read. */
      let entries: string[] = []
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
      /** The file's raw bytes; a NUL byte marks it as binary and it is skipped. */
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

/** One signature the scan found, with where the lane wrote it down. */
interface DetectedSignature {
  /** The reason code the signature maps to. */
  readonly code: string
  /** The verdict the match implies; the rung-2 step signature omits it, its branch hard-codes `fail`. */
  readonly verdict?: Verdict
  /** The human-readable label. */
  readonly label: string
  /** Absolute path of the source that carried it, or null for the lane's own stdout. */
  readonly file: string | null
  /** 1-based line inside that source, or null when the source is not line-addressable. */
  readonly line: number | null
}

/** Signatures matched against the given sources (kept separate so a rung can choose its scope). */
function matchSignatures(sources: readonly SignatureSource[]): DetectedSignature[] {
  /** The signatures found: one entry per rule at most, in rule order. */
  const found: DetectedSignature[] = []
  for (const signature of SIGNATURES) {
    for (const source of sources) {
      /** Index of this rule's first match inside the source, or -1 when it does not match. */
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
function detectSignatures(log: string, root: string): DetectedSignature[] {
  return matchSignatures([{ file: null, text: log }, ...collectEvidenceTexts(evidenceCandidates(log, root))])
}

/** Did one recorded step fail? Accepts the field variants the lanes actually write. */
function stepFailed(entry: Record<string, unknown>): boolean {
  if (entry.ok === true) return false
  if (entry.ok === false) return true
  if (entry.status === "failed" || entry.status === "fail") return true
  if (entry.verdict === "fail" || entry.verdict === "failed") return true
  return false
}

/** One recorded step: every field the lane wrote, plus the name the runner resolved for it. */
type RecordedStep = Record<string, unknown> & { readonly name: string }

/** The step container of an evidence document (`steps`, else `observed.steps`), or null when it has none. */
function stepContainerOf(data: unknown): Record<string, unknown> | unknown[] | null {
  // The evidence document is JSON, so the two casts below are its boundary: `typeof` narrows the runtime
  // kind first, and every field read off the result is then compared by value, never trusted blindly.
  /** The document as a record, or null when the parsed value is not an object. */
  const document = data !== null && typeof data === "object" ? (data as Record<string, unknown>) : null
  if (document === null) return null
  /** The nested `observed` record, present when a lane keeps its step map there. */
  const observed = document.observed !== null && typeof document.observed === "object" ? (document.observed as Record<string, unknown>) : null
  /** The step container: a top-level `steps` wins, else the nested one. */
  const steps = document.steps ?? observed?.steps
  if (steps === null || steps === undefined || typeof steps !== "object") return null
  // Only an object or an array can be a step container: an array is used as a list, any other object as a
  // name -> step map, which needs the record shape before it can be indexed.
  return Array.isArray(steps) ? steps : (steps as Record<string, unknown>)
}

/** The name a step record carries in its own `name`/`step` field, stringified; `""` when it names none. */
function stepNameOf(entry: unknown): string {
  /** The entry's own fields, or an empty record when the entry is not an object. */
  const fields: Record<string, unknown> = entry !== null && typeof entry === "object" ? (entry as Record<string, unknown>) : {}
  return String(fields.name ?? fields.step ?? "")
}

/** A copy of a step record under the given name, keeping every field the lane wrote. */
function stepRecord(entry: unknown, name: string): RecordedStep {
  /** The entry's own fields, or an empty record when the entry is not an object. */
  const fields: Record<string, unknown> = entry !== null && typeof entry === "object" ? (entry as Record<string, unknown>) : {}
  return { ...fields, name }
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
function failingStepFromEvidence(log: string, root: string): DetectedSignature | null {
  /** Inspect one candidate file: the step map of its JSON document, when it records one. */
  const inspect = (file: string): DetectedSignature | null => {
    if (!file.endsWith(".json") || !existsSync(file)) return null
    /** The parsed evidence document, read as an unknown JSON value. */
    let data: unknown
    try {
      data = readJson(file)
    } catch {
      return null
    }
    /** The document's step container, or null when it records no step map. */
    const steps = stepContainerOf(data)
    if (steps === null) return null
    /** Every recorded step, each carrying its resolved name beside the fields the lane wrote. */
    const list: RecordedStep[] = Array.isArray(steps)
      ? steps.map((entry: unknown): RecordedStep => stepRecord(entry, stepNameOf(entry)))
      : Object.entries(steps).map(([name, entry]: [string, unknown]): RecordedStep => stepRecord(entry, name))
    /** The first named step the lane's own record marks as failed, if any. */
    const failed = list.find((entry: RecordedStep): boolean => entry.name !== "" && stepFailed(entry))
    if (failed === undefined) return null
    return { code: "step:" + failed.name, label: "the lane's own evidence marks step `" + failed.name + "` as failed", file, line: null }
  }
  for (const candidate of evidenceCandidates(log, root).reverse()) {
    /** The candidate file's own step map, when it is a JSON document that records one. */
    const direct = inspect(candidate)
    if (direct) return direct
    if (!candidate.endsWith(".json")) {
      /** The `result.json` sibling a non-JSON evidence path points at. */
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
function tailRegion(text: string, lines: number = 200): string {
  /** Every line of the text, split on both LF and CRLF. */
  const all = text.split(/\r?\n/)
  return all.length <= lines ? text : all.slice(-lines).join("\n")
}

/** The scoped scan: the log's failing region plus the lane's own evidence records. */
function detectSignaturesScoped(log: string, root: string): DetectedSignature[] {
  return matchSignatures([{ file: null, text: tailRegion(log) }, ...collectEvidenceTexts(evidenceCandidates(log, root))])
}

/** Everything the classifier needs about one finished lane invocation. */
interface ClassifyInput {
  /** The child's exit status, with a null status already coerced to 1 by the caller. */
  readonly status: number
  /** The termination signal, or null on a normal exit. */
  readonly signal: string | null
  /** Whether the runner's own per-lane timeout killed the child. */
  readonly timedOut: boolean
  /** The lane's combined stdout+stderr, read back from its log file. */
  readonly log: string
  /** Repository root, used to resolve the evidence paths the lane printed. */
  readonly root: string
}

/** The runner's verdict for one lane, plus the evidence it was drawn from. */
interface Outcome {
  /** pass | unavailable | fail. */
  readonly verdict: Verdict
  /** The reason code, or null for a pass. */
  readonly reason: string | null
  /** The parsed `[mpd-qa]` marker, or null when the lane emitted none. */
  readonly marker: ParsedMarker | null
  /** A short explanation of how the verdict was reached. */
  readonly note?: string
  /** The signature the verdict was drawn from, when the runner classified from recorded evidence. */
  readonly signature?: DetectedSignature
  /** Further signatures the runner saw but did NOT use as the reason. */
  readonly alsoDetected?: DetectedSignature[]
}

/** Turn one lane's exit status, marker and recorded signatures into its verdict. */
function classify({ status, signal, timedOut, log, root }: ClassifyInput): Outcome {
  /** The `[mpd-qa]` marker the lane emitted, or null when it emitted none. */
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
  /** The whole-log signature scan, reported only under `alsoDetected` from here on. */
  const detected = detectSignatures(log, root)
  /** The failing step the lane's own evidence names, when it wrote a step map. */
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
  /** The signature scan scoped to the failing region (the log tail plus the evidence files). */
  const scoped = detectSignaturesScoped(log, root)
  /** The scanned refusal, if the failing region records one: the service answered and refused. */
  const refusal = scoped.find((entry: DetectedSignature): boolean => entry.verdict === "fail")
  /** The scanned prerequisite gap, if the failing region records one. */
  const gap = scoped.find((entry: DetectedSignature): boolean => entry.verdict === "unavailable")
  if (refusal) {
    /** The refusal's reason code, captured so the filter below compares a narrowed value. */
    const refusalCode = refusal.code
    return {
      verdict: "fail",
      reason: refusal.code,
      marker,
      signature: refusal,
      alsoDetected: detected.filter((entry: DetectedSignature): boolean => entry.code !== refusalCode),
      note: "the lane's own output/evidence records this failure in the FAILING REGION — the service answered and refused",
    }
  }
  if (gap) {
    /** The gap's reason code, captured so the filter below compares a narrowed value. */
    const gapCode = gap.code
    return {
      verdict: "unavailable",
      reason: gap.code,
      marker,
      signature: gap,
      alsoDetected: detected.filter((entry: DetectedSignature): boolean => entry.code !== gapCode),
      note: "the RUNNER classified this lane from its recorded prerequisite signature (the lane emits no [mpd-qa] marker of its own)",
    }
  }
  if (status === 2) return { verdict: "fail", reason: "usage-error", marker, note: "the lane refused the invocation (e.g. a REQUIRED argument is missing — supply it in " + DEFAULT_MANIFEST + ")" }
  return { verdict: "fail", reason: signal ? "signal-" + signal : "exit-" + status, marker }
}

/** The last `count` non-empty lines of a log, used for the failure tail in the result record. */
function tailLines(text: string, count: number = 6): string[] {
  return text.split(/\r?\n/).filter((line: string): boolean => line.trim() !== "").slice(-count)
}

/** One detected signature as the result record reports it. */
interface ReportedDetection {
  /** The signature's reason code. */
  readonly code: string
  /** Where it was seen: a root-relative path, or the placeholder for the lane's own stdout. */
  readonly file: string
  /** The 1-based line inside that source, or null when the source is not line-addressable. */
  readonly line: number | null
}

/** The signature the runner used as the lane's reason, with its human label. */
interface ReportedSignature extends ReportedDetection {
  /** The human-readable prerequisite/failure label. */
  readonly label: string
}

/** The `[mpd-qa]` marker as the result record reports it. */
interface ReportedMarker {
  /** The marker keyword the lane emitted. */
  readonly kind: string
  /** The lane name the marker carried. */
  readonly lane: string
  /** The reason code the marker carried. */
  readonly reason: string
  /** The prerequisite phrase, or `""` when the marker carried none. */
  readonly prereq: string
  /** The remedy text with its quotes stripped, or `""`. */
  readonly remedy: string
}

/** One lane's completed run, as `result.json` records it. */
interface LaneRun {
  /** The case name. */
  readonly case: string
  /** `gate` or `lane`. */
  readonly kind: string
  /** The final verdict. */
  readonly verdict: Verdict
  /** The reason code, or null for a pass. */
  readonly reason: string | null
  /** The classifier's explanation, or null when it wrote none. */
  readonly note: string | null
  /** The child's exit status, or null when it died on a signal. */
  readonly exitCode: number | null
  /** The termination signal, or null on a normal exit. */
  readonly signal: string | null
  /** Wall-clock duration in milliseconds. */
  readonly durationMs: number
  /** The command line as printed (a lane runs through `bun`, a gate runs its own argv). */
  readonly command: string
  /** The driver path the manifest declared, or null for a gate. */
  readonly script: string | null
  /** The parsed marker, reduced to the fields the record prints. */
  readonly marker: ReportedMarker | null
  /** The signature the reason was drawn from, or null. */
  readonly signature: ReportedSignature | null
  /** Further signatures the runner saw but did not use as the reason. */
  readonly alsoDetected: ReportedDetection[]
  /** The prerequisite names the manifest declared for this entry. */
  readonly declaredPrereq: string[]
  /** The evidence path the lane printed, or null. */
  readonly evidencePath: string | null
  /** The lane's log path, relative to the root. */
  readonly logPath: string
  /** The last non-empty output lines, recorded only for a failure. */
  readonly outputTail: string[]
  /** The suite the lane was selected for; stamped by the runner before the line is printed. */
  suite?: string
}

/** The spawn-result fields `runEntry` reads back from a finished child. */
interface SpawnOutcome {
  /** Exit status, null when the child was killed by a signal. */
  readonly status: number | null
  /** Termination signal, null on a normal exit. */
  readonly signal: string | null
  /** Spawn-level failure (Node reports its OWN timeout here as ETIMEDOUT), when there was one. */
  readonly error?: Error
}

/** Run one manifest entry to completion and record everything the suite summary needs. */
function runEntry(entry: ManifestEntry, ctx: RunContext): LaneRun {
  /** Wall-clock start, used for the lane's duration. */
  const startedAt = Date.now()
  /** The lane's log file name: the driver's base name with its extension dropped. */
  const logName = basename(entry.script ?? entry.case).replace(/\.ts$/, "") + ".log"
  /** Absolute path of this lane's own log. */
  const logPath = join(ctx.laneLogDir, logName)
  /** The descriptor the child's stdout AND stderr share: a file, never a pipe. */
  const stdout = openSync(logPath, "w")
  /** The per-lane timeout: the entry's own override wins over the run default; 0 disables it. */
  const timeoutMs = entry.timeoutMs ?? ctx.timeoutMs
  /** The command line as printed in the result record. */
  let command: string
  /** The finished child, reduced to the fields this runner reads. */
  let result: SpawnOutcome
  try {
    // Every lane entry carries a script (loadManifest rejects one without), so the assertions in the lane
    // branch below only state what the manifest validator already guarantees.
    if (entry.kind === "gate") {
      /** The gate's own argv; a gate without one cannot run. */
      const argv = entry.argv ?? []
      if (argv.length === 0) throw new Error("gate without argv: " + entry.case)
      command = argv.join(" ")
      result = spawnSync(argv[0], argv.slice(1), { cwd: ctx.root, stdio: ["ignore", stdout, stdout], timeout: timeoutMs > 0 ? timeoutMs : undefined })
    } else {
      // The suite's strict default (`--no-skip`) comes first; a lane's own `args` are appended,
      // never substituted (mount-assert needs BOTH the strict flag and its REQUIRED --expect).
      /** The lane's full argument list: the suite default first, the entry's own additions after. */
      const args = [...ctx.defaultArgs, ...(entry.args ?? [])]
      command = ["bun", entry.script, ...args].join(" ")
      result = spawnSync("bun", [entry.script!, ...args], { cwd: ctx.root, stdio: ["ignore", stdout, stdout], timeout: timeoutMs > 0 ? timeoutMs : undefined })
    }
  } finally {
    closeSync(stdout)
  }
  /** Wall-clock duration of the child, in milliseconds. */
  const durationMs = Date.now() - startedAt
  /** The lane's own output, read back from its log file (empty when the file is gone). */
  const log = existsSync(logPath) ? readFileSync(logPath, "utf8") : ""
  /** Whether the manifest named a lane driver that is not on disk. */
  const scriptMissing = entry.kind !== "gate" && (entry.script ? !existsSync(join(ctx.root, entry.script)) : false)
  // Node reports its own timeout as `ETIMEDOUT` on an ErrnoException, the Error subtype that carries `code`.
  /** The spawn-level error, typed as the ErrnoException the `code` field belongs to. */
  const spawnError = result.error as NodeJS.ErrnoException | undefined
  /** Whether the RUNNER's per-lane timeout killed the child. */
  const timedOut = spawnError?.code === "ETIMEDOUT"
  /** The verdict, its reason and the evidence behind it. */
  const outcome: Outcome = scriptMissing
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
    alsoDetected: (outcome.alsoDetected ?? []).map((detected: DetectedSignature): ReportedDetection => ({ code: detected.code, file: detected.file ? relative(ctx.root, detected.file) : "(the lane's own stdout)", line: detected.line })),
    declaredPrereq: entry.prereq ?? [],
    evidencePath: findEvidencePath(log, ctx.root),
    logPath: relative(ctx.root, logPath),
    outputTail: outcome.verdict === "fail" ? tailLines(log) : [],
  }
}

/** Render one lane's `[mpd-qa:<suite>]` result line. */
function printLaneLine(entry: LaneRun): string {
  /** The verdict tag, upper-cased for the line. */
  const tag = entry.verdict.toUpperCase()
  /** The printable fields; optional ones appear only when the run knows them. */
  const bits: string[] = ["[mpd-qa:" + entry.suite + "]", tag, "case=" + entry.case]
  if (entry.reason) bits.push("reason=" + entry.reason)
  if (entry.signature) bits.push("prereq=\"" + entry.signature.label + "\"", "signature=" + (entry.signature.file ?? "lane-stdout") + ":" + entry.signature.line)
  if (entry.alsoDetected?.length) bits.push("also=" + entry.alsoDetected.map((detected: ReportedDetection): string => detected.code).join(","))
  if (entry.exitCode !== 0) bits.push("exit=" + entry.exitCode)
  if (entry.evidencePath) bits.push("evidence=" + entry.evidencePath)
  bits.push("log=" + entry.logPath)
  if (entry.durationMs !== undefined) bits.push("ms=" + entry.durationMs)
  return bits.join(" ")
}

/** One counter per verdict, the unit of the suite summary. */
interface VerdictCounts {
  /** Lanes that passed. */
  pass: number
  /** Lanes whose prerequisite was missing. */
  unavailable: number
  /** Lanes that ran and failed, or could not run at all. */
  fail: number
}

/** The verdict tally plus the exit code it implies. */
interface Summary {
  /** One counter per verdict. */
  counts: VerdictCounts
  /** EXIT.FAILED when a lane failed, else EXIT.UNAVAILABLE when one was unavailable, else EXIT.GREEN. */
  exitCode: number
}

/** Count the recorded lanes and derive the exit code the tally implies. */
function summarize(run: RunRecord): Summary {
  /** Fresh counters for this pass over the recorded lanes. */
  const counts: VerdictCounts = { pass: 0, unavailable: 0, fail: 0 }
  for (const lane of run.lanes) counts[lane.verdict] = (counts[lane.verdict] ?? 0) + 1
  /** A failure outranks an unavailability, which outranks an all-green tally. */
  const exitCode = counts.fail > 0 ? EXIT.FAILED : counts.unavailable > 0 ? EXIT.UNAVAILABLE : EXIT.GREEN
  return { counts, exitCode }
}

/** Rewrite the run record to `result.json`, creating the evidence directory when needed. */
function writeResult(path: string, run: RunRecord): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(run, null, 2) + "\n")
}

/** Everything a lane run needs: the root, the invocation defaults and the evidence targets. */
interface RunContext {
  /** Repository root: every lane runs with this as its cwd. */
  readonly root: string
  /** Per-lane timeout in milliseconds; 0 disables the runner's kill timer. */
  readonly timeoutMs: number
  /** Arguments PREPENDED to every lane invocation (the suite's strict `--no-skip`). */
  readonly defaultArgs: string[]
  /** The drift report computed once for this run. */
  readonly drift: DriftReport
  /** Evidence directory as printed in the run banner (root-relative when possible). */
  readonly evidenceDir: string
  /** Absolute directory holding one log file per lane. */
  readonly laneLogDir: string
  /** Absolute path of the run's `output.log`. */
  readonly outputPath: string
  /** Absolute path of the run's `result.json`. */
  readonly resultPath: string
}

/** The complete run record, rewritten to `result.json` after every lane. */
interface RunRecord {
  /** The runner's own path, so a reader knows which script produced the record. */
  runner: string
  /** Repository root the run used. */
  root: string
  /** Manifest path relative to the root. */
  manifest: string
  /** sha256 of the manifest bytes. */
  manifestSha256: string
  /** The suite name, or `(only)` for a `--only` selection. */
  suite: string
  /** How many entries the run selected. */
  selected: number
  /** ISO instant the run started at. */
  startedAt: string
  /** ISO instant the run finished at, null until the summary is written. */
  finishedAt: string | null
  /** Total wall-clock duration in milliseconds, null until the run completes. */
  durationMs: number | null
  /** Whether the run reached its final summary (the continue-past-failure proof). */
  complete: boolean
  /** The exit code each outcome maps to, quoted for readers of the record. */
  exitCodes: { allGreen: number; someUnavailable: number; someFailed: number; runnerError: number }
  /** The drift report the run was started with. */
  drift: DriftReport
  /** One record per executed entry, in execution order. */
  lanes: LaneRun[]
  /** The running tally, rewritten after every lane. */
  counts: VerdictCounts
  /** The exit code the tally implies, null until the first lane settles. */
  exitCode: number | null
}

/** Run every selected entry, writing the result record after each one. */
function runSuite(opts: Options, manifest: LoadedManifest, ctx: RunContext): RunRecord {
  /** The entries this run will execute, in manifest order. */
  const selected = selectEntries(manifest, opts)
  /** The run record under construction; every field starts at its pre-run value. */
  const run: RunRecord = {
    runner: "scripts/run-qa-lanes.ts",
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
  /** Wall-clock start of the whole suite, for the run's total duration. */
  const startedMs = Date.now()
  /** Print one line to stdout AND to the run's own `output.log`. */
  const emit = (line: string): void => {
    process.stdout.write(line + "\n")
    appendFileSync(ctx.outputPath, line + "\n")
  }
  emit("[mpd-qa:" + run.suite + "] runner start manifest=" + run.manifest + " sha256=" + run.manifestSha256.slice(0, 12) + " lanes=" + selected.length + " evidence=" + ctx.evidenceDir)
  // The two drift lists the banner names; `as const` keeps the lookup keyed to this report, never a string.
  for (const driftKind of ["unlistedScripts", "missingScripts"] as const) {
    /** The drift entries of this kind, already computed for the run. */
    const value = ctx.drift[driftKind]
    if (value.length > 0) emit("[mpd-qa:" + run.suite + "] drift " + driftKind + "=" + value.length + " (run --list --check-drift for detail)")
  }
  // T-89 runner half: the discovered COUNT is printed on every run, and any count problem is loud.
  emit("[mpd-qa:" + run.suite + "] discovery=" + ctx.drift.countDrift.discovered + " lane script(s) (.ts entries " + ctx.drift.countDrift.allTsEntries + ", underscore-excluded " + ctx.drift.countDrift.excludedUnderscore.length + ", unlisted " + ctx.drift.countDrift.unlisted + ", outside-suite " + ctx.drift.countDrift.outsideSuites + ")")
  for (const problem of ctx.drift.countDrift.problems) emit("[mpd-qa:" + run.suite + "] drift count: " + problem)
  // T-83: the resolved required set is printed on EVERY run — including `required=0`, which is a RED.
  emit("[mpd-qa:" + run.suite + "] immutability required=" + ctx.drift.guard.required.length + (ctx.drift.guard.required.length === 0 ? " (RED: no lane declares required)" : ": " + ctx.drift.guard.required.join(", ")) + " exempt=" + ctx.drift.guard.exemptCount)
  for (const problem of guardProblems(ctx.drift.guard)) emit("[mpd-qa:" + run.suite + "] immutability guard: " + problem)
  for (const entry of selected) {
    /** This entry's completed run record. */
    const lane = runEntry(entry, ctx)
    lane.suite = run.suite
    run.lanes.push(lane)
    /** The tally and exit code after this lane, so a reader can watch them move. */
    const { counts, exitCode } = summarize(run)
    run.counts = counts
    run.exitCode = exitCode
    writeResult(ctx.resultPath, run)
    emit(printLaneLine(lane))
  }
  /** The final tally, once every lane has settled. */
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

/** One registry row `--list` prints: the manifest facts a reader needs, with defaults resolved. */
interface RegistryEntry {
  /** The case name. */
  readonly case: string
  /** `gate` or `lane`. */
  readonly kind: string
  /** The suites the entry belongs to; empty means outside every suite. */
  readonly suites: string[]
  /** The driver path, or null for a gate. */
  readonly script: string | null
  /** Extra arguments the entry appends to its invocation. */
  readonly args: string[]
  /** The prerequisite names the manifest declares. */
  readonly prereq: string[]
  /** The declared reason for an entry outside every suite, or null. */
  readonly outsideSuites: string | null
  /** The immutability-guard declaration, or null when the manifest carries none. */
  readonly immutabilityGuard: string | null
}

/** Print the registry (text or JSON) with the drift and guard sections appended. */
function listRegistry(root: string, manifest: LoadedManifest, drift: DriftReport, asJson: boolean): string {
  /** One row per manifest entry, in declaration order. */
  const entries: RegistryEntry[] = manifest.entries.map((entry: ManifestEntry): RegistryEntry => ({
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
  /** The human-readable report, appended line by line. */
  const lines: string[] = [
    "manifest: " + relative(root, manifest.path) + " (sha256 " + manifest.sha256.slice(0, 12) + ")",
    "cases: " + entries.length + " (" + entries.filter((e: RegistryEntry): boolean => e.kind === "lane").length + " lanes + " + entries.filter((e: RegistryEntry): boolean => e.kind === "gate").length + " gates; the all suite selects " + entries.filter((e: RegistryEntry): boolean => e.suites.includes("all") && e.kind === "lane").length + " lanes + " + entries.filter((e: RegistryEntry): boolean => e.suites.includes("all") && e.kind === "gate").length + " gates)",
    "",
    ["CASE", "KIND", "SUITES", "SCRIPT"].join("\t"),
  ]
  for (const entry of entries) {
    lines.push([entry.case, entry.kind, entry.suites.join(",") || "-", entry.script ?? "-"].join("\t"))
  }
  lines.push("")
  /** Entries that belong to no suite: each must carry its own declared reason. */
  const outside = entries.filter((e: RegistryEntry): boolean => e.suites.length === 0)
  lines.push("outside every suite (" + outside.length + ") — explicit, with reason:")
  for (const entry of outside) lines.push("  - " + entry.case + ": " + (entry.outsideSuites ?? "(no reason recorded — drift)"))
  lines.push("")
  lines.push("immutabilityGuard required (" + drift.guard.required.length + "): " + (drift.guard.required.join(", ") || "NONE — a resolved required set that is empty is a RED"))
  lines.push("immutabilityGuard exempt (" + drift.guard.exemptCount + ") — each with a declared reason; no lane may be silent")
  for (const problem of guardProblems(drift.guard)) lines.push("immutabilityGuard PROBLEM: " + problem)
  lines.push("")
  lines.push("discovery (" + drift.countDrift.discovered + " lane script(s); .ts entries " + drift.countDrift.allTsEntries + ", underscore-excluded " + drift.countDrift.excludedUnderscore.length + ", outside-suite " + drift.countDrift.outsideSuites + ")")
  for (const problem of drift.countDrift.problems) lines.push("discovery PROBLEM: " + problem)
  lines.push("drift unlistedScripts (" + drift.unlistedScripts.length + "): " + (drift.unlistedScripts.join(", ") || "none"))
  lines.push("drift missingScripts (" + drift.missingScripts.length + "): " + (drift.missingScripts.map((m: MissingScript): string => m.case + " -> " + m.script).join(", ") || "none"))
  return lines.join("\n")
}

/** Create the run's evidence directory and assemble the context every lane run needs. */
function makeContext(opts: Options, drift: DriftReport): RunContext {
  /** The evidence directory: the caller's path (root-relative when relative), else a timestamped default. */
  const evidenceDir = opts.evidenceDir
    ? (isAbsolute(opts.evidenceDir) ? opts.evidenceDir : join(opts.root, opts.evidenceDir))
    : join(opts.root, "evidence", "dsh-qa", "suite-runner", stamp())
  /** One log file per lane, holding that lane's combined stdout+stderr. */
  const laneLogDir = join(evidenceDir, "lanes")
  mkdirSync(laneLogDir, { recursive: true })
  /** The run's own line-by-line log, appended as the run progresses. */
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
/** One finished child invocation of this script, reduced to what the fixture arms assert on. */
interface ChildRun {
  /** Exit status, null when the child died on a signal. */
  readonly status: number | null
  /** Captured stdout, decoded as UTF-8. */
  readonly stdout: string
  /** Captured stderr, decoded as UTF-8. */
  readonly stderr: string
}

/** One lane entry of a fixture manifest: the subset of the schema these arms exercise. */
interface FixtureLane {
  /** Case name the runner resolves `--only` against. */
  readonly case: string
  /** Lane driver path relative to the fixture root. */
  readonly script: string
  /** Suites the lane belongs to; empty puts it outside every suite. */
  readonly suites: string[]
  /** The mandatory immutability-guard declaration; omitted only by the undeclared-arm fixture. */
  readonly immutabilityGuard?: string
  /** Extra arguments appended to the lane invocation (used by the timeout arm). */
  readonly args?: string[]
  /** Per-entry timeout override in milliseconds (used by the timeout arm). */
  readonly timeoutMs?: number
  /** Declared reason for an entry that belongs to no suite. */
  readonly outsideSuites?: string
}

/** One gate entry of a fixture manifest: an argv the runner spawns directly. */
interface FixtureGate {
  /** Case name of the gate. */
  readonly case: string
  /** Discriminator that keeps the entry out of the lane path. */
  readonly kind: string
  /** Command and arguments spawned for this gate. */
  readonly argv: string[]
  /** The suites the gate belongs to; the fixtures declare both gates outside every suite. */
  readonly suites: string[]
}

/** A fixture manifest document written by the self-test. */
interface FixtureManifest {
  /** Manifest schema version, mirrored from the real manifest. */
  readonly manifestVersion: number
  /** One entry per fixture lane. */
  readonly lanes: FixtureLane[]
  /** The fixture gates; omitted by the guard-only manifests. */
  readonly gates?: FixtureGate[]
}

/** The `--list --json` document, narrowed to the fields the self-test asserts on. */
interface ListRegistryJson {
  /** One row per manifest entry, in declaration order. */
  entries: RegistryEntry[]
  /** The drift report the same run computed. */
  drift: {
    /** On-disk lane scripts with no manifest entry. */
    unlistedScripts: string[]
    /** Manifest lanes whose declared script file is gone. */
    missingScripts: Array<{ case: string; script: string | undefined }>
  }
}

/** One lane as a run's `result.json` records it (the subset the self-test reads back). */
interface MixedLane {
  /** Case name of the lane. */
  case: string
  /** The verdict the run recorded for it. */
  verdict: string
  /** The reason code, or null for a pass. */
  reason: string | null
  /** The parsed `[mpd-qa]` marker, when the lane emitted one. */
  marker: ReportedMarker | null
  /** The signature the verdict was drawn from, when the runner classified from evidence. */
  signature: ReportedSignature | null
  /** Further signatures the runner saw but did not use as the reason. */
  alsoDetected: ReportedDetection[]
}

/** A completed run's `result.json`, narrowed to the fields the self-test asserts on. */
interface MixedRunRecord {
  /** Every lane the run recorded, in execution order. */
  lanes: MixedLane[]
  /** The verdict tally the run ended with. */
  counts: VerdictCounts
  /** Whether the run reached its final summary (the continue-past-failure property). */
  complete: boolean
  /** sha256 of the manifest the run read. */
  manifestSha256: string
}

/** Fixture-driven proof of the classifier, the drift checks and the guard rule (exit 1 on any failure). */
function selfTest(): void {
  /** The exemption every fixture lane but the required one declares, so the mandatory rule is satisfied. */
  const FIXTURE_EXEMPT = "exempt: fixture lane — takes no caller-supplied output target"
  /** Throwaway root holding the fixture lane corpus and manifests (never the real repository). */
  const fixtureRoot = mkdtempSync(join(tmpdir(), "mpd-qa-runner-selftest-"))
  /** The fixture's own lane directory, mirroring `<root>/skills/dsh-qa/scripts`. */
  const laneDir = join(fixtureRoot, LANE_DIR)
  mkdirSync(laneDir, { recursive: true })
  /** One fixture lane per classification arm: file name -> script body. */
  const fixtures: Record<string, string> = {
    "fx-fail.ts": "console.log('fx-fail: assertion failed: expected 1 got 2')\nprocess.exit(1)\n",
    "fx-pass.ts": "console.log('fx-pass ok')\nprocess.exit(0)\n",
    "fx-skip.ts": "console.log('[mpd-qa] SKIP case=fx-skip lane=real reason=absent-credentials prereq=tui profile in the sandbox root remedy=\"copy credentials\"')\nprocess.exit(0)\n",
    "fx-short.ts": "console.log('[mpd-qa] FAIL case=fx-short lane=real reason=absent-runtime')\nprocess.exit(1)\n",
    "fx-unavailable.ts": "console.log('[mpd-qa] FAIL case=fx-unavailable lane=real reason=absent-staged-pack prereq=dist/mpd-package/package.json remedy=\"node scripts/pack-mpd.ts\"')\nprocess.exit(1)\n",
    "fx-usage.ts": "console.error('usage: fx-usage --expect=<substring>')\nprocess.exit(2)\n",
    "fx-hang.ts": "setTimeout(() => {}, 5000)\n",
    "fx-outside.ts": "console.log('fx-outside: declared in the manifest with suites=[] — a deliberate exclusion, not drift')\nprocess.exit(0)\n",
    "fx-truly-unlisted.ts": "console.log('fx-truly-unlisted: on disk in NO manifest entry')\nprocess.exit(0)\n",
    // T-89 runner half fixtures: one DOCUMENTED exclusion (underscore prefix) and one non-.ts file.
    // Neither is a lane; the count assertion must still account for the underscore one and never count
    // the .txt one — a discovery that started counting either would redden the partition arm below.
    "_fx-internal.ts": "console.log('_fx-internal: a helper, not a lane — the underscore prefix is the documented exclusion')\nprocess.exit(0)\n",
    "fx-notes.txt": "not a lane script; the discovery only considers .ts entries\n",
    // Marker-less lanes are the majority in the real corpus (only ~6 of 44 implement the protocol),
    // so the runner must read their OWN recorded signatures: a missing provider credential makes the
    // lane UNAVAILABLE, while a 401 means the service answered and refused — the lane really failed.
    "fx-credential.ts": "console.log('dsh: MISSING_CREDENTIAL: llm-deepseek: no API key for provider route \"deepseek-official\"')\nprocess.exit(1)\n",
    "fx-401.ts": "console.log('webRoute: {\"ok\":false,\"status\":401,\"body\":\"{\\\"error\\\":\\\"unauthorized\\\"}\"}')\nprocess.exit(1)\n",
    "fx-both.ts": "console.log('webRoute: {\"ok\":false,\"status\":401,\"body\":\"{\\\"error\\\":\\\"unauthorized\\\"}\"}')\nconsole.log('dsh: MISSING_CREDENTIAL: no API key for provider route \"deepseek-official\"')\nprocess.exit(1)\n",
    // RUNG 2's fixture (t73): the same fence string, but printed while a step was PASSING, plus a
    // structured step map that names a DIFFERENT failing step — the label must come from the map.
    "fx-expected-fence.ts": [
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
    "fx-guard-ok.ts": [
      "import { mkdtempSync } from 'node:fs'",
      "import { tmpdir } from 'node:os'",
      "import { join } from 'node:path'",
      "import { exitOnRefusal, refuseOverwrite } from './lib/immutable-output.ts'",
      "const dir = mkdtempSync(join(tmpdir(), 'fx-guard-ok-'))",
      "try { refuseOverwrite(join(dir, 'result.json'), { label: 'fixture result.json' }) } catch (error) { exitOnRefusal(error, '[fx-guard-ok]') }",
      "console.log('fx-guard-ok: the guard accepted a fresh target')",
      "process.exit(0)",
      "",
    ].join("\n"),
    "fx-guard-bad.ts": "console.log('fx-guard-bad: a required fixture lane WITHOUT the guard import — present only to drive the missing-import arm')\nprocess.exit(0)\n",
  }
  // The fixture's own stub of the helper, so fx-guard-ok's import is real and resolvable.
  mkdirSync(join(laneDir, "lib"), { recursive: true })
  writeFileSync(join(laneDir, "lib", "immutable-output.ts"), [
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
  /** Absolute path of the fixture manifest the child runs are pointed at. */
  const fixtureManifest = join(fixtureRoot, DEFAULT_MANIFEST)
  mkdirSync(dirname(fixtureManifest), { recursive: true })
  /** The drifted fixture manifest: on-disk fixtures no entry declares, plus one entry whose script is gone. */
  const fixtureManifestDocument: FixtureManifest = {
    manifestVersion: 1,
    lanes: [
      { case: "fx-fail", script: LANE_DIR + "/fx-fail.ts", suites: ["all"], immutabilityGuard: FIXTURE_EXEMPT },
      { case: "fx-pass", script: LANE_DIR + "/fx-pass.ts", suites: ["all"], immutabilityGuard: FIXTURE_EXEMPT },
      { case: "fx-skip", script: LANE_DIR + "/fx-skip.ts", suites: ["all"], immutabilityGuard: FIXTURE_EXEMPT },
      { case: "fx-short", script: LANE_DIR + "/fx-short.ts", suites: ["all"], immutabilityGuard: FIXTURE_EXEMPT },
      { case: "fx-unavailable", script: LANE_DIR + "/fx-unavailable.ts", suites: ["all"], immutabilityGuard: FIXTURE_EXEMPT },
      { case: "fx-usage", script: LANE_DIR + "/fx-usage.ts", suites: ["all"], immutabilityGuard: FIXTURE_EXEMPT },
      { case: "fx-hang", script: LANE_DIR + "/fx-hang.ts", suites: ["all"], args: ["--no-skip"], timeoutMs: 400, immutabilityGuard: FIXTURE_EXEMPT },
      { case: "fx-credential", script: LANE_DIR + "/fx-credential.ts", suites: ["all"], immutabilityGuard: FIXTURE_EXEMPT },
      { case: "fx-401", script: LANE_DIR + "/fx-401.ts", suites: ["all"], immutabilityGuard: FIXTURE_EXEMPT },
      { case: "fx-both", script: LANE_DIR + "/fx-both.ts", suites: ["all"], immutabilityGuard: FIXTURE_EXEMPT },
      { case: "fx-expected-fence", script: LANE_DIR + "/fx-expected-fence.ts", suites: ["all"], immutabilityGuard: FIXTURE_EXEMPT },
      { case: "fx-missing", script: LANE_DIR + "/fx-missing-does-not-exist.ts", suites: ["all"], immutabilityGuard: FIXTURE_EXEMPT },
      { case: "fx-guard-ok", script: LANE_DIR + "/fx-guard-ok.ts", suites: ["all"], immutabilityGuard: "required" },
      { case: "fx-guard-bad", script: LANE_DIR + "/fx-guard-bad.ts", suites: ["all"], immutabilityGuard: FIXTURE_EXEMPT },
      { case: "fx-outside", script: LANE_DIR + "/fx-outside.ts", suites: [], outsideSuites: "fixture: deliberately outside every suite", immutabilityGuard: FIXTURE_EXEMPT },
    ],
    gates: [
      { case: "fx-gate-ok", kind: "gate", argv: ["node", "-e", "process.exit(0)"], suites: [] },
      { case: "fx-gate-fail", kind: "gate", argv: ["node", "-e", "process.exit(1)"], suites: [] },
    ],
  }
  writeFileSync(fixtureManifest, JSON.stringify(fixtureManifestDocument, null, 2))
  // A second manifest that accounts for EVERY fixture script on disk: the positive control for
  // --check-drift (no drift -> exit 0) next to the drifted manifest above (drift -> exit 1).
  /** File name of the clean control manifest, reused by several arms below. */
  const cleanManifest = "fixtures-clean-manifest.json"
  /** The clean control manifest: every on-disk fixture script is declared, so nothing can drift. */
  const cleanManifestDocument: FixtureManifest = {
    manifestVersion: 1,
    lanes: Object.keys(fixtures).map((name: string): FixtureLane => ({
      case: name.replace(/\.ts$/, ""),
      script: LANE_DIR + "/" + name,
      suites: [],
      // fx-guard-ok is the ONE required fixture lane (its import is real); fx-guard-bad is declared
      // exempt here on purpose — it drives the missing-import arm through the separate manifest below.
      immutabilityGuard: name === "fx-guard-ok.ts" ? "required" : FIXTURE_EXEMPT,
    })),
  }
  writeFileSync(join(fixtureRoot, cleanManifest), JSON.stringify(cleanManifestDocument, null, 2))
  // Three deliberately broken guard manifests: (a) a required lane with no import, (b) an undeclared
  // lane, (c) an all-exempt set whose resolved required count is zero. Each must redden --check-drift.
  /** One broken guard manifest per falsification arm: file name -> its lane list. */
  const guardManifests: Record<string, FixtureLane[]> = {
    "fixtures-guard-missing-import.json": [
      { case: "fx-guard-ok", script: LANE_DIR + "/fx-guard-ok.ts", suites: [], immutabilityGuard: "required" },
      { case: "fx-guard-bad", script: LANE_DIR + "/fx-guard-bad.ts", suites: [], immutabilityGuard: "required" },
    ],
    "fixtures-guard-undeclared.json": [
      { case: "fx-guard-ok", script: LANE_DIR + "/fx-guard-ok.ts", suites: [], immutabilityGuard: "required" },
      { case: "fx-pass", script: LANE_DIR + "/fx-pass.ts", suites: [] },
    ],
    "fixtures-guard-empty.json": [
      { case: "fx-pass", script: LANE_DIR + "/fx-pass.ts", suites: [], immutabilityGuard: FIXTURE_EXEMPT },
    ],
  }
  for (const [name, lanes] of Object.entries(guardManifests)) {
    /** One broken guard manifest document, written under its own file name. */
    const document: FixtureManifest = { manifestVersion: 1, lanes }
    writeFileSync(join(fixtureRoot, name), JSON.stringify(document, null, 2))
  }
  /** Every failure the self-test observed; empty means the whole arm set passed. */
  const failures: string[] = []
  /** Run one child invocation of THIS script and capture its streams as text. */
  const runChild = (args: string[]): ChildRun => {
    /** The finished child process, decoded as UTF-8 text. */
    const proc = spawnSync(process.execPath, [fileURLToPath(import.meta.url), ...args], { encoding: "utf8", cwd: fixtureRoot })
    return { status: proc.status, stdout: proc.stdout, stderr: proc.stderr }
  }
  /** The `--list --json` registry read-back, asserting the drift lists it prints. */
  const listResult = runChild(["--root=" + fixtureRoot, "--manifest=" + DEFAULT_MANIFEST, "--list", "--json"])
  if (listResult.status !== 0) failures.push("--list --json exited " + listResult.status + ": " + listResult.stderr.slice(0, 300))
  else {
    // The child's stdout is the JSON this runner wrote; the cast records that boundary and nothing more.
    /** The parsed registry document. */
    const registry = JSON.parse(listResult.stdout) as ListRegistryJson
    /** On-disk fixture lanes the manifest does not declare. */
    const unlisted = registry.drift.unlistedScripts
    if (!unlisted.includes(LANE_DIR + "/fx-truly-unlisted.ts")) failures.push("--list --json did not report the unlisted on-disk fixture lane: " + JSON.stringify(unlisted))
    if (unlisted.includes(LANE_DIR + "/fx-outside.ts")) failures.push("a lane declared with suites=[] was wrongly reported as drift: " + JSON.stringify(unlisted))
    if (registry.drift.missingScripts.length !== 1) failures.push("--list --json did not report the manifest entry whose script is gone")
    /** Registry rows outside every suite: fx-outside plus the two fixture gates. */
    const outside = registry.entries.filter((entry: RegistryEntry): boolean => entry.suites.length === 0)
    if (outside.length !== 3) failures.push("--list --json reported " + outside.length + " entries outside every suite (expected 3: fx-outside + the two fixture gates)")
  }
  /** The drifted manifest's verdict: the fixture MUST redden. */
  const driftResult = runChild(["--root=" + fixtureRoot, "--manifest=" + DEFAULT_MANIFEST, "--check-drift"])
  if (driftResult.status !== 1) failures.push("--check-drift exited " + driftResult.status + " on a drifted fixture (expected 1)")
  /** The clean manifest's verdict: the fixture MUST be green. */
  const cleanDrift = runChild(["--root=" + fixtureRoot, "--manifest=" + cleanManifest, "--check-drift"])
  if (cleanDrift.status !== 0) failures.push("--check-drift exited " + cleanDrift.status + " on a fixture where every on-disk script is declared (expected 0)")
  // ── T-83 guard arms: the mandatory declaration, both frozen falsifications, and the empty-set RED ──
  if (!/immutability required=1: fx-guard-ok/.test(cleanDrift.stdout)) failures.push("a clean --check-drift did not print the resolved required set (required=1: fx-guard-ok): " + cleanDrift.stdout.slice(-200))
  /** The missing-import arm: a `required` driver whose bytes do not carry the guard specifier. */
  const guardMissingImport = runChild(["--root=" + fixtureRoot, "--manifest=fixtures-guard-missing-import.json", "--check-drift"])
  if (guardMissingImport.status !== 1) failures.push("--check-drift exited " + guardMissingImport.status + " when a required driver does not import the guard (expected 1)")
  if (!guardMissingImport.stderr.includes("fx-guard-bad.ts")) failures.push("the missing-import arm did not NAME the driver: " + guardMissingImport.stderr.slice(0, 300))
  if (!guardMissingImport.stderr.includes(GUARD_SPECIFIER)) failures.push("the missing-import arm did not name the missing specifier: " + guardMissingImport.stderr.slice(0, 300))
  /** The undeclared arm: a lane carrying no guard declaration at all. */
  const guardUndeclared = runChild(["--root=" + fixtureRoot, "--manifest=fixtures-guard-undeclared.json", "--check-drift"])
  if (guardUndeclared.status !== 1) failures.push("--check-drift exited " + guardUndeclared.status + " when a lane carries no guard declaration (expected 1)")
  if (!guardUndeclared.stderr.includes("fx-pass")) failures.push("the undeclared arm did not NAME the case: " + guardUndeclared.stderr.slice(0, 300))
  /** The empty-set arm: every lane exempt, so the resolved required set is zero. */
  const guardEmpty = runChild(["--root=" + fixtureRoot, "--manifest=fixtures-guard-empty.json", "--check-drift"])
  if (guardEmpty.status !== 1) failures.push("--check-drift exited " + guardEmpty.status + " on an all-exempt manifest whose required set resolves to zero (expected 1)")
  if (!/required set is EMPTY/.test(guardEmpty.stderr)) failures.push("the empty-set arm did not say the required set is EMPTY: " + guardEmpty.stderr.slice(0, 300))
  /** The all-green subset: one passing lane plus one passing gate. */
  const green = runChild(["--root=" + fixtureRoot, "--manifest=" + DEFAULT_MANIFEST, "--only=fx-pass,fx-gate-ok", "--evidence-dir=ev-green"])
  if (green.status !== 0) failures.push("all-green subset exited " + green.status + " (expected 0): " + green.stdout.slice(-300))
  if (!/immutability required=1: fx-guard-ok/.test(green.stdout)) failures.push("a normal suite run did not print the resolved required set — it must be printed on EVERY run: " + green.stdout.slice(0, 300))
  // The space-separated spelling is the one the task contracts and SKILL.md document: pin it.
  /** The documented space-separated flag spelling. */
  const spaceForm = runChild(["--root", fixtureRoot, "--manifest", DEFAULT_MANIFEST, "--only", "fx-pass", "--evidence-dir", "ev-space"])
  if (spaceForm.status !== 0) failures.push("the space-separated flag spelling exited " + spaceForm.status + " (expected 0) — the documented invocations use it")
  /** The unavailable-only subset: a SKIP marker and a prerequisite-absence FAIL marker. */
  const unavailable = runChild(["--root=" + fixtureRoot, "--manifest=" + DEFAULT_MANIFEST, "--only=fx-skip,fx-unavailable", "--evidence-dir=ev-unavailable"])
  if (unavailable.status !== 2) failures.push("unavailable-only subset exited " + unavailable.status + " (expected 2): " + unavailable.stdout.slice(-300))
  if (!/UNAVAILABLE case=fx-unavailable reason=absent-staged-pack/.test(unavailable.stdout)) failures.push("the prereq-absence FAIL marker was not reported as unavailable")
  /** The mixed subset: every classification arm in ONE run, with the first lane failing. */
  const mixed = runChild(["--root=" + fixtureRoot, "--manifest=" + DEFAULT_MANIFEST, "--only=fx-fail,fx-pass,fx-skip,fx-unavailable,fx-short,fx-credential,fx-401,fx-both,fx-expected-fence,fx-usage,fx-hang,fx-missing,fx-gate-fail", "--evidence-dir=ev-mixed"])
  if (mixed.status !== 1) failures.push("mixed subset exited " + mixed.status + " (expected 1)")
  /** The mixed run's own result record, the subject of the per-case assertions below. */
  const resultPath = join(fixtureRoot, "ev-mixed", "result.json")
  if (!existsSync(resultPath)) failures.push("mixed run wrote no result.json")
  else {
    /** The parsed result record of the mixed run. */
    const result = readJson<MixedRunRecord>(resultPath)
    /** The run's lane records keyed by case name, for the per-case assertions below. */
    const byCase: Record<string, MixedLane> = Object.fromEntries(result.lanes.map((lane: MixedLane): [string, MixedLane] => [lane.case, lane]))
    /** The verdict every fixture arm must receive. */
    const expected: Record<string, string> = { "fx-fail": "fail", "fx-pass": "pass", "fx-skip": "unavailable", "fx-unavailable": "unavailable", "fx-short": "unavailable", "fx-credential": "unavailable", "fx-401": "fail", "fx-both": "fail", "fx-expected-fence": "fail", "fx-usage": "fail", "fx-hang": "fail", "fx-missing": "fail", "fx-gate-fail": "fail" }
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
    if (!(byCase["fx-expected-fence"].alsoDetected ?? []).some((entry: ReportedDetection): boolean => entry.code === "unauthorized")) failures.push("the expected 401 fence was not reported under alsoDetected for fx-expected-fence: " + JSON.stringify(byCase["fx-expected-fence"].alsoDetected))
    if (byCase["fx-expected-fence"].verdict !== "fail") failures.push("the rung-2 relabel must not move the verdict: " + JSON.stringify(byCase["fx-expected-fence"].verdict))
    // The continue-past-failure property: fx-fail ran FIRST and every later lane still ran.
    if (result.lanes.length !== 13) failures.push("mixed run recorded " + result.lanes.length + " lanes (expected 13)")
    if (result.counts.pass !== 1 || result.counts.unavailable !== 4 || result.counts.fail !== 8) failures.push("mixed counts were " + JSON.stringify(result.counts))
    /** Position of the deliberately failing first lane, and of the last lane that must still have run. */
    const failIndex = result.lanes.findIndex((lane: MixedLane): boolean => lane.case === "fx-fail")
    /** Index of the final recorded lane, which must be the fixture gate. */
    const lastIndex = result.lanes.length - 1
    if (failIndex !== 0 || result.lanes[lastIndex].case !== "fx-gate-fail") failures.push("the run did not continue to the last lane after the first failure")
    if (!result.complete) failures.push("mixed run result.json is not marked complete")
    if (!result.manifestSha256) failures.push("mixed run result.json carries no manifest hash")
    /** The per-lane log files the mixed run wrote into its own evidence directory. */
    const logs = readdirSync(join(fixtureRoot, "ev-mixed", "lanes"))
    if (!logs.includes("fx-pass.log")) failures.push("per-lane log for fx-pass missing (stdio must go to files)")
  }
  /** The unknown-case arm: `--only` naming a case the manifest does not declare. */
  const unknownCase = runChild(["--root=" + fixtureRoot, "--manifest=" + DEFAULT_MANIFEST, "--only=fx-nope", "--evidence-dir=ev-unknown"])
  if (unknownCase.status !== 3) failures.push("--only with an unknown case exited " + unknownCase.status + " (expected 3)")
  /** The unknown-suite arm: a suite name no entry belongs to. */
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

/** Dispatch on the parsed options: help, self-test, registry, drift check, or the suite run. */
function main(): void {
  /** The parsed options; parseArgs either returns a complete set or throws a usage error. */
  let opts: Options
  try {
    opts = parseArgs(process.argv.slice(2))
  } catch (err) {
    console.error("[run-qa-lanes] " + errorMessage(err))
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
  /** The manifest this invocation was pointed at; a load failure is a runner error, never a verdict. */
  let manifest: LoadedManifest
  try {
    manifest = loadManifest(opts.root, opts.manifest ?? DEFAULT_MANIFEST)
  } catch (err) {
    console.error("[run-qa-lanes] " + errorMessage(err))
    process.exit(EXIT.RUNNER_ERROR)
  }
  /** Everything the drift checks found, computed once and reported by every surface. */
  const drift = collectDrift(opts.root, manifest)
  if (opts.list) {
    console.log(listRegistry(opts.root, manifest, drift, opts.json))
    process.exit(EXIT.GREEN)
  }
  if (opts.checkDrift) {
    /** Every way the immutability-guard declaration can be wrong. */
    const problems = guardProblems(drift.guard)
    if (opts.json) console.log(JSON.stringify(drift, null, 2))
    if (drift.unlistedScripts.length > 0) console.error("[run-qa-lanes] drift: " + drift.unlistedScripts.length + " lane script(s) on disk in no manifest entry: " + drift.unlistedScripts.join(", "))
    if (drift.missingScripts.length > 0) console.error("[run-qa-lanes] drift: " + drift.missingScripts.length + " manifest entry(ies) whose script is gone: " + drift.missingScripts.map((m: MissingScript): string => m.case).join(", "))
    // T-89 runner half: the discovered count is PRINTED and asserted — every number here came from this
    // run's own walk of the lane directory, so a silently-discovered copy cannot stay invisible.
    console.log("[run-qa-lanes] discovery: " + drift.countDrift.discovered + " lane script(s) discovered (" + drift.countDrift.listed + " listed, " + drift.countDrift.unlisted + " unlisted, " + drift.countDrift.outsideSuites + " outside every suite); .ts entries " + drift.countDrift.allTsEntries + ", underscore-excluded " + drift.countDrift.excludedUnderscore.length)
    for (const problem of drift.countDrift.problems) console.error("[run-qa-lanes] drift: " + problem)
    for (const problem of problems) console.error("[run-qa-lanes] immutability guard: " + problem)
    // The resolved set is printed in the SAME canonical shape on every surface (check-drift, run, list).
    console.log("[run-qa-lanes] immutability required=" + drift.guard.required.length + (drift.guard.required.length === 0 ? " (RED: no lane declares required)" : ": " + drift.guard.required.join(", ")) + " exempt=" + drift.guard.exemptCount)
    if (drift.unlistedScripts.length === 0 && drift.missingScripts.length === 0 && drift.countDrift.problems.length === 0 && problems.length === 0) {
      console.log("[run-qa-lanes] manifest and disk agree (" + manifest.entries.length + " entries, " + drift.countDrift.discovered + " lane script(s) discovered) and the immutability guard is declared")
    }
    process.exit(drift.unlistedScripts.length > 0 || drift.missingScripts.length > 0 || drift.countDrift.problems.length > 0 || problems.length > 0 ? EXIT.FAILED : EXIT.GREEN)
  }
  /** The run's evidence targets and invocation defaults. */
  const ctx = makeContext(opts, drift)
  /** The finished run record; runSuite sets `exitCode` before it returns. */
  let run: RunRecord
  try {
    run = runSuite(opts, manifest, ctx)
  } catch (err) {
    console.error("[run-qa-lanes] " + errorMessage(err))
    process.exit(EXIT.RUNNER_ERROR)
  }
  if (opts.json) console.log(JSON.stringify(run, null, 2))
  // runSuite always fills `exitCode` before returning, so the assertion cannot change the exit code.
  process.exit(run.exitCode!)
}

await main()
