#!/usr/bin/env bun
// wave2b-lane-d.ts — lane D's corpus ARMS for wave 2b (T-25 reader · T-69 wrapper + call-site
// binding · T-77 scratch root · T-80 driver-header claims · T-89 `./` forms · T-74 `--out` discipline).
//
// WHY ONE DRIVER: every arm below asserts a CORPUS property, and each has an offline `--self-test`
// fixture so the arm itself is falsifiable without a live boot. `T-25`'s instrument leg is lane C's;
// here it is the DOCUMENTATION reading plus the naive-reader falsifier. `T-80`'s RULE is lane B2's
// (`scripts/check-citations.ts --driver-headers`); this driver runs it and asserts the AGREEMENT.
//
// OUTPUT DISCIPLINE (T-74, and the same discipline this file must obey): `--out <dir>` pins the
// evidence dir; an EXISTING target is refused (immutability by default, T-53), and with no `--out`
// the run lands in a fresh stamped caller-visible dir under `evidence/dsh-qa/wave2b-laneD/`.
import { spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { exitOnRefusal, refuseOverwrite, timestamp } from "./lib/immutable-output.ts"
import { readSessionEvents, scanZstdFrames } from "./lib/session-evidence.ts"
import { zstdCompressSync, zstdDecompressSync } from "node:zlib"

/** This script's own directory, from which the repository root is derived. */
const HERE: string = dirname(fileURLToPath(import.meta.url))
/** The repository root: this script lives at `<root>/skills/dsh-qa/scripts/`, three levels down. */
const REPO: string = resolve(HERE, "..", "..", "..")
/** The driver slug used in every log line, evidence path and skip marker. */
const SLUG: string = "wave2b-lane-d"
/** The corpus directory this driver scans, relative to the repository root. */
const LANE_DIR: string = "skills/dsh-qa/scripts"
/** The skill document whose sentences the T-25, T-74 and T-25-docs arms assert. */
const SKILL_MD: string = "skills/dsh-qa/SKILL.md"

/** The SHA-256 of a text or of raw file bytes; the byte form is what `dirDigest` fingerprints. */
const sha = (text: string | Uint8Array): string => createHash("sha256").update(text).digest("hex")
/** Read one repository-relative file as UTF-8 text. */
const readText = (rel: string): string => readFileSync(join(REPO, rel), "utf8")
/** Every file below `root`, as sorted-path-ready POSIX-relative names (directories recursed). */
const relPaths = (root: string, prefix: string = ""): string[] =>
  readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    // This entry's path relative to `root`, used as both the result and the recursion prefix.
    const rel = prefix === "" ? entry.name : prefix + "/" + entry.name
    return entry.isDirectory() ? relPaths(join(root, entry.name), rel) : [rel]
  })

// ── T-69: no corpus lane may compose a profile through the RAW flag ──────────────────────────
// The wrapper (`scripts/dump-config.ts`, lane B's file) is what a lane must invoke. The raw-flag
// occurrences that remain in PROSE (the manual's contrast sentence, the wrapper's own warning text)
// are declared EXCEPTIONS BY NAME — never by count — so a new raw site cannot hide in a total.
/** One declared raw-flag exception: the file it covers, and why that file may carry the flag. */
interface T69Exception {
  /** The repository-relative file the exception is declared for. */
  readonly site: string
  /** Why that file's raw-flag lines are prose, a fixture, or the scanner's own pattern. */
  readonly why: string
}

/** The raw-flag exceptions, declared by name so no new site can hide inside a total. */
const T69_EXCEPTIONS: readonly T69Exception[] = [
  // Declared by NAME. A file+line lands here only when the line's own text CONTRASTS the flag.
  { site: "skills/dsh-qa/SKILL.md", why: "prose: the skill's own description of what a mount proof may cite, and the contrast passages" },
  { site: "skills/dsh-qa/scripts/wave2b-lane-d.ts", why: "the SCANNER itself: its own pattern literal, its prose and its RED fixture live here, and the fixture MUST carry a raw invocation to prove the scan reddens" },
]
/** The raw harness flag, matched globally because the scanner resets `lastIndex` per line. */
const RAW_FLAG = /"--dump-config"/g

/** One raw-flag site: where it is, whether it is prose or an invocation, and whether it is declared. */
interface RawSite {
  /** The site as `<repo-relative file>:<1-based line>`. */
  readonly site: string
  /** `invocation` for a real argv token in executing code, `prose` for a comment or a doc line. */
  readonly kind: "prose" | "invocation"
  /** True when the file is one of the declared exceptions compared by site. */
  readonly covered: boolean
  /** The trimmed line, truncated to 120 characters, kept as the record's evidence. */
  readonly line: string
}

/** The raw-flag scan over the skills corpus: the files it covered, every site, the exceptions. */
interface RawScan {
  /** How many corpus files were read (scripts and documents together). */
  readonly filesScanned: number
  /** Every line carrying the raw flag literal, in file and line order. */
  readonly sites: RawSite[]
  /** The declared exception sites, echoed into the record. */
  readonly exceptions: readonly string[]
}

/**
 * Every `"--dump-config"` occurrence under `skills/`, classified by whether the line is an
 * EXECUTED argv token or prose. Corpus scripts are `.ts` after this wave, so the file filter
 * follows that rename; a `*.md` line is prose by definition.
 * @returns The scan's file count, its site records and the declared exception sites.
 */
export function scanRawDumpConfig(): RawScan {
  // Every matching raw-site record, one per line that carries the raw flag literal.
  const sites: RawSite[] = []
  // The corpus files the scanner reads: the skill scripts (now `.ts`) and the skill documents.
  const files = [
    ...relPaths(join(REPO, "skills")).filter((rel) => rel.endsWith(".ts") || rel.endsWith(".md")).map((rel) => "skills/" + rel),
  ]
  for (const rel of files) {
    // This file's whole text, split into lines by the scan below.
    const text = readText(rel)
    text.split("\n").forEach((line, index) => {
      RAW_FLAG.lastIndex = 0
      if (!RAW_FLAG.test(line)) return
      // The line without its leading indentation, used for the prose test and the record.
      const trimmed = line.trim()
      // PROSE is a comment or a doc line; an INVOCATION is a real argv token in executing code.
      const isProse = /^(\/\/|\*|#)/.test(trimmed) || !rel.endsWith(".ts")
      // True when this file is a declared exception (compared by SITE, never by a count).
      const covered = T69_EXCEPTIONS.some((entry) => entry.site === rel)
      sites.push({ site: rel + ":" + (index + 1), kind: isProse ? "prose" : "invocation", covered, line: trimmed.slice(0, 120) })
    })
  }
  return { filesScanned: files.length, sites, exceptions: T69_EXCEPTIONS.map((entry) => entry.site) }
}

/** One arm's verdict record: its stable id, its boolean, and the sentence a reader judges it by. */
interface Check {
  /** The stable arm id, e.g. `T-69.raw-flag`. */
  readonly id: string
  /** The arm's verdict. */
  readonly ok: boolean
  /** The one-sentence reading of the numbers the verdict rests on. */
  readonly detail: string
}

/** The T-69 arm's full reading: the verdict, the scan, and the uncovered invocations it flags. */
interface T69Reading {
  /** The arm's verdict record. */
  readonly check: Check
  /** The raw-flag scan the verdict was read from. */
  readonly scan: RawScan
  /** The uncovered INVOCATIONS — the sites that failed the arm. */
  readonly rawInvocations: RawSite[]
}

/** The T-69 arm: assert that no undisclosed raw `--dump-config` invocation survives in the corpus. */
function t69(): T69Reading {
  // The raw-flag scan over the skills corpus.
  const scan = scanRawDumpConfig()
  // The uncovered INVOCATIONS: those are the arm's failures.
  const rawInvocations = scan.sites.filter((site) => site.kind === "invocation" && !site.covered)
  // The arm's verdict record, with the corpus counts in its detail sentence.
  const check: Check = { id: "T-69.raw-flag", ok: rawInvocations.length === 0, detail: "raw `dsh --dump-config` invocation(s) in the corpus: " + (rawInvocations.map((s) => s.site).join(", ") || "none") + " (files scanned " + scan.filesScanned + ", prose sites " + scan.sites.filter((s) => s.kind === "prose").length + ", declared exceptions " + scan.exceptions.length + ")" }
  return { check, scan, rawInvocations }
}

// ── T-69 TWIN: every `join(REPO|repoRoot, …)` call site must resolve to a BINDING ────────────
// WHY THIS ARM EXISTS (R-D-F1): the T-69 arm above proves no lane composes a profile through the
// raw flag, and it stayed GREEN while five lanes crashed in `main()` — their rewritten call sites
// named an identifier that no file bound (`join(REPO, …)` in files that only bind `repoRoot`), so
// the crash happened when the argv expression was EVALUATED, not when the scanner looked at it.
// The predicate is the finding's own: a call site `join(REPO|repoRoot, …)` is satisfied by an
// in-file declaration, a named import clause, or a function parameter. Prose lines are exempt by
// the same whole-line rule the other arms use. An EMPTY site set is a RED (T-83).
/** The call-site pattern: `join(` with `REPO` or `repoRoot` as its first argument. */
const JOIN_IDENT = /join\(\s*(REPO|repoRoot)\s*,/g

/** The three ways a `join(REPO|repoRoot, …)` call site can be bound, each a whole-text predicate. */
type BindingTest = (text: string, name: string) => boolean

/** The binding predicates by kind, evaluated once per scanned file. */
const BINDING_TESTS: Record<"declared" | "imported" | "parameter", BindingTest> = {
  declared: (text: string, name: string): boolean => new RegExp("\\b(?:const|let|var)\\s+" + name + "\\b").test(text),
  imported: (text: string, name: string): boolean => [...text.matchAll(/\bimport\s*\{([\s\S]*?)\}\s*from/g)].some((match) => new RegExp("\\b" + name + "\\b").test(match[1])),
  parameter: (text: string, name: string): boolean => new RegExp("\\(([^()]*\\b" + name + "\\b[^()]*)\\)\\s*(?:=>|\\{)").test(text),
}

/** One scanned file's binding row: which kinds bind `REPO` and which bind `repoRoot` in its text. */
type BindingRow = readonly [kind: string, hasRepo: boolean, hasRepoRoot: boolean]

/** One file handed to the call-site binding scan: its site label and, when available, its text. */
interface JoinBindingEntry {
  /** The file's site label (`<repo-relative path>`), also the prefix of every reported site. */
  readonly site: string
  /** The file's text; a missing text is read as `""` so the scan cannot throw on an absent field. */
  readonly text?: string
}

/** One `join(REPO|repoRoot, …)` call site and the binding kinds that satisfy it in its own file. */
interface JoinSite {
  /** The site as `<file>:<1-based line>`. */
  readonly site: string
  /** The identifier the call passes as its first argument: `REPO` or `repoRoot`. */
  readonly name: string
  /** The binding kinds satisfied in that file; EMPTY means the site is unbound (an offender). */
  readonly binding: string[]
}

/** The call-site binding scan: how many files it read, every site, and the UNBOUND subset. */
interface JoinBindingScan {
  /** How many entries were scanned. */
  readonly filesScanned: number
  /** Every call site found, in file and line order. */
  readonly sites: JoinSite[]
  /** The sites with no binding kind at all — the arm's failures. */
  readonly offenders: JoinSite[]
}

/**
 * Classify every `join(REPO|repoRoot, …)` call site in the given files by how that identifier is
 * bound there. Prose lines (a leading `//`, `*` or `#`) are skipped by the same whole-line rule
 * the sibling arms use.
 * @param entries The files to scan, each with its site label and text.
 * @returns The site records and the subset with no binding at all.
 */
export function checkJoinBindings(entries: readonly JoinBindingEntry[]): JoinBindingScan {
  // Every call site found, one record per match.
  const sites: JoinSite[] = []
  // The per-file binding table: for each kind, whether it binds REPO and whether it binds repoRoot.
  const fileBindings: Map<string, BindingRow[]> = new Map()
  for (const entry of entries) {
    // This file's text, defaulted to `""` when the entry carries none.
    const text = String(entry.text ?? "")
    fileBindings.set(entry.site, Object.entries(BINDING_TESTS).map(([kind, test]): BindingRow => [kind, test(text, "REPO"), test(text, "repoRoot")]))
    text.split("\n").forEach((line, index) => {
      if (/^\s*(\/\/|\*|#)/.test(line)) return
      JOIN_IDENT.lastIndex = 0
      for (const match of line.matchAll(JOIN_IDENT)) {
        // The identifier the call site passes as its first argument (REPO or repoRoot).
        const name = match[1]
        // The binding kinds that satisfy this site in its own file — the map entry set above.
        const binding = fileBindings.get(entry.site)!.filter(([, hasRepo, hasRepoRoot]) => (name === "REPO" ? hasRepo : hasRepoRoot)).map(([kind]) => kind)
        sites.push({ site: entry.site + ":" + (index + 1), name, binding })
      }
    })
  }
  return { filesScanned: entries.length, sites, offenders: sites.filter((site) => site.binding.length === 0) }
}

/** The T-69 binding twin's full reading: the verdict plus the scan behind it. */
interface T69BindingReading {
  /** The arm's verdict record. */
  readonly check: Check
  /** The call-site binding scan the verdict was read from. */
  readonly scan: JoinBindingScan
}

/** The T-69 binding twin: scan the lane's own scripts and assert no unbound call site remains. */
function t69binding(): T69BindingReading {
  // The corpus files to scan: every `.ts` script under the lane directory (the wave's rename).
  const entries = relPaths(join(REPO, LANE_DIR))
    .filter((rel) => rel.endsWith(".ts"))
    .map((rel) => ({ site: LANE_DIR + "/" + rel, text: readText(LANE_DIR + "/" + rel) }))
  // The scan over those entries.
  const scan = checkJoinBindings(entries)
  // How many distinct FILES carry at least one call site (the site records carry a line suffix).
  const withSites = new Set(scan.sites.map((site) => site.site.split(":")[0])).size
  // The arm's verdict record, with the site counts in its detail sentence.
  const check: Check = { id: "T-69.call-site-binding", ok: scan.sites.length > 0 && scan.offenders.length === 0, detail: "`join(REPO|repoRoot, …)` call sites: " + scan.sites.length + " in " + withSites + " of " + scan.filesScanned + " scanned file(s); UNBOUND: " + (scan.offenders.map((site) => site.site + " `" + site.name + "`").join(", ") || "none") }
  return { check, scan }
}

// ── T-69 STREAM CONTRACT: the wrapper's JSON rides on STDOUT, its banner on STDERR ───────────
// WHY (R-D-F5, measured while repairing F1): every lane captures a child through its own helper, and
// several of those helpers returned stdout+stderr MERGED. `JSON.parse(merged)` then fails on the
// banner, the parse falls back to the ESCAPED envelope text, and a predicate carrying a `"`-quoted
// fragment silently goes FALSE — `bundle-lifecycle`'s `composed`/`layerDurability` were red for
// exactly that reason while the wrapper itself was byte-identical to the raw flag. This arm pins the
// contract the lanes must honour: stdout alone is the parseable envelope, the banner is on stderr,
// and a merged capture is NOT parseable (so falling back to it is a bug, not a tolerance).
/** The wrapper's composition-only banner, which must appear on stderr and never on stdout. */
const WRAPPER_BANNER = "COMPOSITION ONLY"

/** The repo wrapper's JSON envelope as printed on stdout by `scripts/dump-config.ts --json`. */
interface DumpEnvelope {
  /** The wrapped harness command's exit code, absent when the child never reported one. */
  readonly exitCode?: number
  /** The wrapped `--dump-config` stdout, read as `unknown` because the envelope is untrusted. */
  readonly stdout?: unknown
}

/** One wrapper invocation's stream reading: both streams, the parse verdicts and the banner placement. */
interface StreamProbe {
  /** The child's exit code, null when it never reported one. */
  readonly exit: number | null
  /** Everything the child wrote on stdout — the stream the envelope must ride on. */
  readonly stdout: string
  /** Everything the child wrote on stderr — the stream the banner must ride on. */
  readonly stderr: string
  /** The parsed envelope, or null when stdout was not JSON at all. */
  readonly envelope: DumpEnvelope | null
  /** Whether stdout ALONE parsed as an object carrying a string `stdout` field. */
  readonly stdoutIsEnvelope: boolean
  /** Whether the composition-only banner appeared on stdout (it must not). */
  readonly bannerOnStdout: boolean
  /** Whether the composition-only banner appeared on stderr (it must). */
  readonly bannerOnStderr: boolean
  /** Whether the MERGED stdout+stderr capture parsed (it must not — that is the F5 trap). */
  readonly mergedParses: boolean
}

/**
 * Invoke the repo wrapper once and measure its stream contract.
 * @param bin Optional `--bin` child; a fixture child proves the envelope still carries its stdout.
 * @returns Both streams, the parse verdicts, the banner placement and the exit code.
 */
export function dumpConfigStreams(bin?: string): StreamProbe {
  // The wrapper argv: the repo's own dump-config wrapper, always asked for a headless composition.
  const args = [join(REPO, "scripts", "dump-config.ts"), "--profile", "headless", "--json"]
  if (bin !== undefined) args.push("--bin", bin)
  // The finished wrapper child, captured with the two streams kept SEPARATE.
  const proc = spawnSync(process.execPath, args, { cwd: REPO, encoding: "utf8", timeout: 120_000, maxBuffer: 64 * 1024 * 1024 })
  // The child's stdout alone — the stream the envelope must ride on.
  const stdout = proc.stdout ?? ""
  // The child's stderr alone — the stream the banner must ride on.
  const stderr = proc.stderr ?? ""
  // The parsed envelope, or null when stdout was not JSON at all.
  let parsed: DumpEnvelope | null = null
  try { parsed = JSON.parse(stdout) } catch { parsed = null }
  // Whether the MERGED capture still parses — it must NOT, because the banner breaks the JSON.
  let mergedParses = true
  try { JSON.parse(stdout + stderr) } catch { mergedParses = false }
  return { exit: proc.status, stdout, stderr, envelope: parsed, stdoutIsEnvelope: parsed !== null && typeof parsed.stdout === "string", bannerOnStdout: stdout.includes(WRAPPER_BANNER), bannerOnStderr: stderr.includes(WRAPPER_BANNER), mergedParses }
}

/** Whether one probe honoured the whole contract: envelope on stdout, banner on stderr, no merge. */
const streamContractHolds = (r: StreamProbe): boolean => r.stdoutIsEnvelope && r.bannerOnStderr && !r.bannerOnStdout && !r.mergedParses

/** The live wrapper reading: the byte counts make an empty or merged capture visible in the record. */
interface LiveStreamReading {
  /** The wrapper child's exit code (null when it never reported one). */
  readonly exit: number | null
  /** How many bytes landed on stdout — the envelope's own stream. */
  readonly stdoutBytes: number
  /** How many bytes landed on stderr — the banner's own stream. */
  readonly stderrBytes: number
  /** Whether stdout alone parsed as the envelope. */
  readonly stdoutIsEnvelope: boolean
  /** Whether the MERGED capture parsed (it must not). */
  readonly mergedParses: boolean
}

/** The fixture probe's reading: it proves a `--bin` child's stdout stays reachable in the envelope. */
interface FixtureStreamReading {
  /** The wrapper child's exit code (null when it never reported one). */
  readonly exit: number | null
  /** Whether stdout alone parsed as the envelope. */
  readonly stdoutIsEnvelope: boolean
  /** Whether the child's own stdout text is reachable through the envelope's field, not the stream. */
  readonly childStdoutReachable: boolean
  /** Whether the MERGED capture parsed (it must not). */
  readonly mergedParses: boolean
}

/** The T-69 stream arm's reading: the verdict plus the live and fixture probes behind it. */
interface T69StreamReading {
  /** The arm's verdict record. */
  readonly check: Check
  /** The live wrapper reading (profile `headless`, no `--bin`). */
  readonly live: LiveStreamReading
  /** The scratch fixture child's reading, driven through `--bin`. */
  readonly fixture: FixtureStreamReading
}

/** The T-69 stream arm: measure the live wrapper and a fixture child against the stream contract. */
function t69stream(): T69StreamReading {
  // The scratch box holding the fixture child, removed in the `finally` below.
  const box = mkdtempSync(join(tmpdir(), "lane-d-t69s-"))
  // The fixture child's path: a `.mjs` SCRATCH file this arm writes, never a repo source.
  const child = join(box, "child.mjs")
  writeFileSync(child, '#!/usr/bin/env node\nprocess.stdout.write("SELF_TEST_CHILD_STDOUT\\n")\nprocess.stderr.write("SELF_TEST_CHILD_STDERR\\n")\n')
  chmodSync(child, 0o755)
  // The live wrapper probe, assigned in the try block and read after the `finally` runs.
  let live: StreamProbe
  // The fixture probe (the scratch child handed to `--bin`), assigned in the same try block.
  let fixture: StreamProbe
  try {
    live = dumpConfigStreams(undefined)
    fixture = dumpConfigStreams(child)
  } finally {
    rmSync(box, { recursive: true, force: true })
  }
  // Whether the fixture child's stdout is reachable through the envelope FIELD (not the raw stream).
  const fixtureChildReachable = fixture.envelope !== null && String(fixture.envelope.stdout).includes("SELF_TEST_CHILD_STDOUT")
  // The arm's verdict record: both probes must honour the contract AND the child must be reachable.
  const check: Check = { id: "T-69.json-stream", ok: streamContractHolds(live) && streamContractHolds(fixture) && fixtureChildReachable, detail: "live (profile headless): exit " + live.exit + ", stdout is the JSON envelope=" + live.stdoutIsEnvelope + ", banner on stderr=" + live.bannerOnStderr + ", banner on stdout=" + live.bannerOnStdout + ", MERGED capture parses=" + live.mergedParses + " | fixture child via --bin: envelope=" + fixture.stdoutIsEnvelope + ", child stdout reachable only through the field=" + fixtureChildReachable + ", merged parses=" + fixture.mergedParses }
  return { check, live: { exit: live.exit, stdoutBytes: live.stdout.length, stderrBytes: live.stderr.length, stdoutIsEnvelope: live.stdoutIsEnvelope, mergedParses: live.mergedParses }, fixture: { exit: fixture.exit, stdoutIsEnvelope: fixture.stdoutIsEnvelope, childStdoutReachable: fixtureChildReachable, mergedParses: fixture.mergedParses } }
}

// ── T-89: path-qualified commands carry the `./` form ────────────────────────────────────────
// A path-qualified token: a string literal that CONTAINS a slash (so a bare filename is not a path)
// and does not already start with `./` or `/`. `join(REPO, …)` expressions are ABSOLUTE and safe.
/** The quoted path-shaped token: at least one slash, captured from a double-quoted literal. */
const PATH_TOKEN = /"([A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]*)"/g
/** The invocation shapes whose string arguments are real argv tokens rather than prose. */
const EXECUTED = /(runSync|spawnSync|spawn|runInSandbox|execFileSync)\s*\(/

/** One path-qualified token that is EXECUTED without the `./` form — an arm failure. */
interface PathOffender {
  /** The site as `<file>:<1-based line>`. */
  readonly site: string
  /** The path-shaped token itself. */
  readonly token: string
  /** The trimmed line, truncated to 110 characters, kept as the record's evidence. */
  readonly line: string
}

/** One path-qualified token that is prose or absolute-by-construction (documented, not a failure). */
interface PathProseSite {
  /** The site as `<file>:<1-based line>`. */
  readonly site: string
  /** The path-shaped token itself. */
  readonly token: string
  /** Whether the token was built by `join()`/`resolve()`/`pathToFileURL()` on the same line. */
  readonly built: boolean
}

/** The T-89 scan: the files it read, the offenders, and the documented non-violations. */
interface PathScan {
  /** How many corpus files were read. */
  readonly filesScanned: number
  /** The executed tokens without the `./` form — the arm's failures. */
  readonly offenders: PathOffender[]
  /** The tokens that are prose or absolute-by-construction, reported separately. */
  readonly prose: PathProseSite[]
}

/**
 * Every path-qualified token in the lane's own scripts, split into real argv offenders and
 * documented non-violations. A token on a prose line, or built by an absolute-path helper on the
 * same line, is never an offender.
 * @returns The file count, the offenders and the prose readings.
 */
export function scanPathCommands(): PathScan {
  // The corpus files to scan: every `.ts` script under the lane directory (the wave's rename).
  const files = relPaths(join(REPO, LANE_DIR)).filter((rel) => rel.endsWith(".ts")).map((rel) => LANE_DIR + "/" + rel)
  // The path-qualified EXECUTED tokens that carry no `./` — the arm's failures.
  const offenders: PathOffender[] = []
  // The path-qualified tokens that are prose, built by join()/resolve(), or otherwise not argv.
  const prose: PathProseSite[] = []
  for (const rel of files) {
    // This file's whole text, split into lines by the scan below.
    const text = readText(rel)
    text.split("\n").forEach((line, index) => {
      // Whether this whole line is a comment or doc line (any token on it is prose).
      const isProse = /^\s*(\/\/|\*|#)/.test(line)
      for (const match of line.matchAll(PATH_TOKEN)) {
        // The quoted path-shaped token this match captured.
        const token = match[1]
        if (token.startsWith("./") || token.startsWith("/") || token.includes("${")) continue
        // A token built by join()/resolve()/pathToFileURL() on the same line is ABSOLUTE — safe.
        const built = /\b(join|resolve|pathToFileURL)\s*\(/.test(line)
        if (!EXECUTED.test(line) || isProse || built) { prose.push({ site: rel + ":" + (index + 1), token, built }); continue }
        offenders.push({ site: rel + ":" + (index + 1), token, line: line.trim().slice(0, 110) })
      }
    })
  }
  return { filesScanned: files.length, offenders, prose }
}

/** The file count a `./`-formed path discovers — the number a scratch-copy driver must NAME. */
export function discoveredCount(glob: string): DiscoveredCount {
  // The absolute directory the `./`-formed glob names, under the repository root.
  const dir = join(REPO, glob)
  if (!existsSync(dir)) return { glob, count: 0, exists: false }
  return { glob, count: relPaths(dir).filter((rel) => rel.endsWith(".ts")).length, exists: true }
}

/** What a `./`-formed path discovers: the glob, its script-file count, and whether it exists. */
interface DiscoveredCount {
  /** The `./`-formed path that was counted. */
  readonly glob: string
  /** How many `.ts` script files it discovers. */
  readonly count: number
  /** Whether the path exists at all (a missing path is a RED, not a zero). */
  readonly exists: boolean
}

/** The T-89 arm's reading: the verdict, the scan, and the discovery count of the `./` form. */
interface T89Reading {
  /** The arm's verdict record. */
  readonly check: Check
  /** The path-token scan the verdict was read from. */
  readonly scan: PathScan
  /** The count the `./`-formed lane path discovers. */
  readonly discovered: DiscoveredCount
}

/** The T-89 arm: no executed token may lack the `./` form, and the `./` form must discover files. */
function t89(): T89Reading {
  // The path-token scan over the lane's own scripts.
  const scan = scanPathCommands()
  // The `./`-formed lane path whose discovery count the arm asserts.
  const form = "./" + LANE_DIR
  // What that form discovers, which must be a non-zero set of script files.
  const discovered = discoveredCount(form)
  // The arm's verdict record, with the three readings in its detail sentence.
  const check: Check = { id: "T-89.dot-slash", ok: scan.offenders.length === 0 && discovered.count > 0, detail: "exectued argv tokens without `./`: " + (scan.offenders.map((o) => o.site).join(", ") || "none") + "; prose/usage occurrences (documented, not violations): " + scan.prose.length + "; the `./` form " + form + " discovers " + discovered.count + " file(s) (files scanned " + scan.filesScanned + ")" }
  return { check, scan, discovered }
}

// ── T-77: the scratch-root CONVENTION, read against the repository's own ignore rule ─────────
// must be IGNORED (the declared shape)
/** The declared scratch shape: a dot-prefixed root, which the repository's ignore rule must cover. */
const SCRATCH_SHAPE = ".qa-wave2b-lane-d-scratch/keep.txt"
// must NOT be ignored (no leading dot)
/** The near miss: the same shape WITHOUT the leading dot, which must stay trackable. */
const NEAR_MISS = "qa-wave2b-lane-d-scratch/keep.txt"

/** What `git check-ignore` answered for the probed paths. */
interface IgnoreResult {
  /** `git check-ignore`'s exit code (0 = at least one path is ignored, 1 = none is). */
  readonly exit: number | null
  /** The paths git reported as ignored; a blank line splits to `undefined` and is kept honest. */
  readonly ignored: readonly (string | undefined)[]
  /** The raw stdout, trimmed, kept so the matched pattern can be quoted in the record. */
  readonly raw: string
}

/**
 * Ask the repository's own ignore rule which of the given paths it covers.
 * @param paths The repository-relative paths to probe, one per line on the child's stdin.
 * @returns The child's exit code, the ignored subset and the raw rule output.
 */
export function checkIgnore(paths: readonly string[]): IgnoreResult {
  // `git check-ignore -v --stdin`: the paths go in on stdin, the matched rule comes back quoted.
  const proc = spawnSync("git", ["check-ignore", "-v", "--stdin"], { cwd: REPO, input: paths.join("\n") + "\n", encoding: "utf8" })
  // The paths git reported as ignored; a split's `.pop()` may answer undefined for a blank line.
  const matched = new Set(String(proc.stdout ?? "").split("\n").filter(Boolean).map((line) => line.split("\t").pop()))
  return { exit: proc.status, ignored: [...matched], raw: String(proc.stdout ?? "").trim() }
}

/** The T-77 arm's reading: the verdict plus the ignore probe behind it. */
interface T77Reading {
  /** The arm's verdict record. */
  readonly check: Check
  /** The ignore probe the verdict was read from. */
  readonly result: IgnoreResult
}

/** The T-77 arm: the declared scratch shape is ignored, and its un-dotted near miss is not. */
function t77(): T77Reading {
  // The ignore probe over the declared shape and its near miss.
  const result = checkIgnore([SCRATCH_SHAPE, NEAR_MISS])
  // Whether the dot-prefixed scratch shape is covered by the ignore rule.
  const shapeIgnored = result.ignored.includes(SCRATCH_SHAPE)
  // Whether the un-dotted near miss is (wrongly) covered too — it must not be.
  const nearMissIgnored = result.ignored.includes(NEAR_MISS)
  // The arm's verdict record, naming the matched pattern when one was reported.
  const check: Check = { id: "T-77.scratch-shape", ok: shapeIgnored && !nearMissIgnored, detail: "`" + SCRATCH_SHAPE + "` ignored=" + shapeIgnored + " (pattern: " + (result.raw.split("\n").find((l) => l.includes(SCRATCH_SHAPE))?.split("\t")[0] ?? "n/a") + "); near-miss `" + NEAR_MISS + "` ignored=" + nearMissIgnored }
  return { check, result }
}

// ── T-80: the header's CLAIMED keys and the driver's PRODUCED keys must agree ────────────────
/** What the citation checker answered for one driver-header scope. */
interface DriverHeaderResult {
  /** The checker's exit code, null when it never reported one. */
  readonly exit: number | null
  /** The checker's own `[driver-headers]` summary line, or `""` when it printed none. */
  readonly summary: string
  /** The violation count parsed out of that summary (NaN when it carries none). */
  readonly violations: number
  /** The claim-set count parsed out of that summary (NaN when it carries none). */
  readonly claimSets: number
  /** How many NO-CLAIM-SET rows the checker reported. */
  readonly noClaim: number
  /** Both streams joined, kept whole for the fixture arms' message assertions. */
  readonly out: string
}

/**
 * Run the citation checker's driver-header pass over one scope.
 * @param dir The scope: a directory of drivers, or a single scratch copy's directory.
 * @returns The checker's exit code, summary line and the counts parsed out of it.
 */
export function driverHeaderCheck(dir: string = "./" + LANE_DIR): DriverHeaderResult {
  // The citation checker's driver-header pass over that scope.
  const proc = spawnSync(process.execPath, [join(REPO, "scripts", "check-citations.ts"), "--driver-headers", "--dir", dir], { cwd: REPO, encoding: "utf8", timeout: 120_000 })
  // Both streams joined: the summary line and the violations are read from the combined text.
  const out = String(proc.stdout ?? "") + String(proc.stderr ?? "")
  // The checker's own summary line, or `""` when it printed none.
  const summary = out.split("\n").find((line) => line.startsWith("[driver-headers]")) ?? ""
  // How many NO-CLAIM-SET rows the checker reported.
  const noClaim = (out.match(/NO-CLAIM-SET/g) ?? []).length
  // The violation count parsed out of the summary line (NaN when it carries none).
  const violations = Number((summary.match(/(\d+) violation\(s\)/) ?? [])[1] ?? NaN)
  // The claim-set count parsed out of the summary line (NaN when it carries none).
  const claimSets = Number((summary.match(/(\d+) claim set\(s\)/) ?? [])[1] ?? NaN)
  return { exit: proc.status, summary, violations, claimSets, noClaim, out }
}

/** A seeded mismatch: a SCRATCH copy whose header claims one key too many (must REDDEN). */
export function seededHeaderMismatch(): string {
  // The scratch box the mutated copy is written into; the CALLER removes it.
  const box = mkdtempSync(join(tmpdir(), "lane-d-t80-"))
  // The real lane driver whose header is copied and bent — a repo SOURCE, hence `.ts`.
  const src = "skills/dsh-qa/scripts/lib/settings-bridge-lane.ts"
  // That driver's text, in which the claim anchor below must match EXACTLY once.
  const text = readText(src)
  // The exact claim-set line the seeded copy bends by one key.
  const anchor = "// CLAIM SET (T-80): this driver CLAIMS the assertion keys A1–A5"
  if (text.split(anchor).length - 1 !== 1) throw new Error("seeded mismatch: the claim anchor did not match exactly once")
  // The scratch copy: a `.mjs` filename this arm WRITES itself, handed to the checker via `--dir`.
  writeFileSync(join(box, "settings-bridge-lane.mjs"), text.replace(anchor, anchor.replace("A1–A5", "A1–A6")))
  return box
}

/** The T-80 arm's reading: the verdict plus the live and seeded checker runs behind it. */
interface T80Reading {
  /** The arm's verdict record. */
  readonly check: Check
  /** The checker's reading of the LIVE lane scope. */
  readonly live: DriverHeaderResult
  /** The checker's reading of the bent scratch copy, which must redden. */
  readonly seeded: DriverHeaderResult
}

/** The T-80 arm: the live scope is clean, and a seeded claim mismatch still reddens the checker. */
function t80(): T80Reading {
  // The checker's reading of the live lane scope.
  const live = driverHeaderCheck()
  // The scratch box holding the bent header copy, removed in the `finally` below.
  const box = seededHeaderMismatch()
  // The checker's reading of that bent copy, assigned in the try and read after the `finally`.
  let seeded: DriverHeaderResult
  try {
    seeded = driverHeaderCheck(box)
  } finally {
    rmSync(box, { recursive: true, force: true })
  }
  // The arm's verdict: the live scope clean AND the seeded mismatch really reddening.
  const check: Check = { id: "T-80.header-claims", ok: live.exit === 0 && live.violations === 0 && live.claimSets >= 2 && seeded.exit !== 0 && seeded.violations >= 1, detail: "live: " + live.summary + " | seeded mismatch: exit " + seeded.exit + ", violations " + seeded.violations + " (a claimed-but-unasserted key must redden)" }
  return { check, live, seeded }
}

// ── T-25: the naive reader vs the frame-by-frame reader, on ONE container ────────────────────
/** The two-frame container's shape: the file, its frame count, and the naive reader's outcome. */
interface NaiveShape {
  /** Absolute path of the temp container (removed before this reading is returned). */
  readonly file: string
  /** How many complete zstd frames the frame-by-frame reader found (must be at least 2). */
  readonly frames: number
  /** The one-shot reader's outcome: `threw…`, or the literal `first-frame-only`. */
  readonly naive: string
}

/** Build a TWO-FRAME container with the runtime's own zstd, and read both ways. */
export function naiveVsReader(): NaiveShape {
  // The ONE-SHOT reader this arm exists to contrast with the frame-by-frame one: it decompresses the
  // container ONCE, so it sees only the first frame — that is the trap the arm measures. It used to
  // be reached through `require("node:zlib")`, which throws `ReferenceError: require is not defined
  // in ES module scope` under node and made the whole arm unrunnable (a recorded RED baseline, not a
  // contract: repairing it is what lets the assertion below actually execute).
  // The scratch box holding the two-frame container, removed in the `finally` below.
  const box = mkdtempSync(join(tmpdir(), "lane-d-t25-"))
  try {
    // The container file the two frames are written to.
    const file = join(box, "session.frame")
    /** Wrap one object as ONE zstd frame, exactly as the session store writes them. */
    const frame = (obj: unknown): Buffer => zstdCompressSync(Buffer.from(JSON.stringify(obj) + "\n", "utf8"))
    writeFileSync(file, Buffer.concat([frame({ type: "header", sessionId: "s" }), frame({ type: "session/event", data: { kind: "tool/call", name: "probe" } })]))
    // The container's bytes, read back and handed to BOTH readers.
    const bytes = readFileSync(file)
    // How many frames the frame-by-frame reader finds in those bytes.
    const frames = (scanZstdFrames(bytes).frames ?? []).length
    // The one-shot reader's outcome: `threw` until the read below says otherwise.
    let naive = "threw"
    try {
      JSON.parse(zstdDecompressSync(bytes).toString("utf8").trim().split("\n")[0])
      naive = "first-frame-only"
    } catch (error) {
      // The caught value is `unknown`: its `message` is read through the shape cast the repo uses.
      naive = "threw: " + String((error as { message?: unknown } | null)?.message ?? error).slice(0, 60)
    }
    return { file, frames, naive }
  } finally {
    rmSync(box, { recursive: true, force: true })
  }
}

/** One real-store reading of the frame-by-frame reader, when a `--store` home was passed. */
interface RealStoreReading {
  /** The DSH_HOME whose store was read. */
  readonly home: string
  /** The reading's event count, as this arm has ALWAYS measured it (see the T-25 arm's cast). */
  readonly events: number | undefined
}

/** The T-25 arm's reading: the container shape, the documentation readings, and the real store. */
interface T25Reading {
  /** The arm's verdict record. */
  readonly check: Check
  /** The two-frame container's shape, which is the arm's falsifier. */
  readonly shape: NaiveShape
  /** The real-store reading, or null when no `--store` was passed. */
  readonly real: RealStoreReading | null
  /** How many bytes the skill document carries (a non-zero length is part of the docs reading). */
  readonly docBytes: number
}

/** The T-25 arm: the naive reader must fail on a multi-frame container, and the docs must say so. */
function t25(storeHome: string | undefined): T25Reading {
  // The two-frame container's shape, which IS the T-25 falsifier.
  const shape = naiveVsReader()
  // The skill document, whose text must name the three reader entry points and the trap.
  const doc = readText(SKILL_MD)
  // Whether the document names all three entry points the frame-by-frame reader exposes.
  const namedEntries = ["readSessionEvents", "findToolCall", "recordedToolNames"].every((name) => doc.includes(name))
  // Whether the document spells out the concatenated-frame trap that makes a naive read see zero.
  const trapDocumented = doc.includes("concatenated-zstd-frame") || doc.includes("frame by frame") || doc.includes("zero events")
  // The real-store reading, or null when no `--store` home was passed.
  let real: RealStoreReading | null = null
  if (storeHome !== undefined && existsSync(storeHome)) {
    // The store the reader selected; the arm reads its count through the cast noted below.
    const events = readSessionEvents(storeHome, {})
    real = {
      home: storeHome,
      // WHY THE CAST: the reader returns a `SessionStore` OBJECT that has never carried `length`, so
      // this expression ALWAYS answered `undefined` — a pre-existing defect of this arm that the
      // conversion must preserve rather than repair. The cast states the shape the line assumes.
      events: (events as { length?: number }).length,
    }
  }
  // The arm's verdict record, with all four readings in its detail sentence.
  const check: Check = { id: "T-25.naive-reader", ok: shape.frames >= 2 && naiveIsZero(shape.naive) && namedEntries && trapDocumented, detail: "container frames=" + shape.frames + ", naive one-shot read=" + shape.naive + " (the failure IS the evidence); docs name the three entry points=" + namedEntries + ", trap documented=" + trapDocumented + (real === null ? "; real-store reading: unavailable (no --store passed)" : "; real store " + real.home + " → " + real.events + " event(s)") }
  return { check, shape, real, docBytes: doc.length }
}
/** Whether a naive one-shot reading is a FAILURE (a throw, or only the container's first frame). */
const naiveIsZero = (naive: string): boolean => naive.startsWith("threw") || naive === "first-frame-only"

// ── T-74: the `--out` discipline, measured on this driver's own invocation ───────────────────
/** The rule sentence the skill document must carry byte-for-byte. */
const T74_RULE = "a verification that runs another task's driver pins its output with `--out` into its own evidence dir"

/** The pinned probe's before/after pair: the foreign dir's digest and where the run landed. */
interface T74Pair {
  /** The foreign directory's digest before the pinned probe ran. */
  readonly before: string
  /** The foreign directory's digest after it ran. */
  readonly after: string
  /** Whether the two digests match, i.e. the pinned run wrote nothing into the foreign dir. */
  readonly identical: boolean
  /** Whether the pinned output directory received the run's file. */
  readonly pinnedWrote: boolean
  /** The pinned probe's exit code (null when it never reported one). */
  readonly exit: number | null
}

/** The T-74 arm's reading: the verdict, the digest pair, and whether the rule sentence is present. */
interface T74Reading {
  /** The arm's verdict record. */
  readonly check: Check
  /** The digest pair, or null when no `--foreign` directory was passed. */
  readonly pair: T74Pair | null
  /** Whether the SKILL.md rule sentence is present byte-for-byte. */
  readonly rulePresent: boolean
}

/** The T-74 arm: the rule is documented, and a pinned run leaves the foreign directory untouched. */
function t74(foreignDir: string | undefined): T74Reading {
  // The skill document, whose text must carry the `--out` rule sentence.
  const doc = readText(SKILL_MD)
  // Whether that sentence is present byte-for-byte.
  const rulePresent = doc.includes(T74_RULE)
  // The digest pair, or null when no `--foreign` directory was passed.
  let pair: T74Pair | null = null
  if (foreignDir !== undefined) {
    // The scratch box the pinned probe runs inside, removed in the `finally` below.
    const box = mkdtempSync(join(tmpdir(), "lane-d-t74-"))
    try {
      // The foreign directory's digest BEFORE the cross-task run.
      const before = dirDigest(foreignDir)
      // The pinned output directory the probe is told to write into.
      const target = join(box, "pinned")
      // The probe run itself: this same driver re-invoked under `bun` with a pinned `--out`.
      const proc = spawnSync("bun", [join(HERE, "wave2b-lane-d.ts"), "--only", "t74-probe", "--out", target], { cwd: REPO, encoding: "utf8", timeout: 300_000 })
      // The foreign directory's digest AFTER the run — it must be unchanged.
      const after = dirDigest(foreignDir)
      pair = { before, after, identical: before === after, pinnedWrote: existsSync(target), exit: proc.status }
    } finally {
      rmSync(box, { recursive: true, force: true })
    }
  }
  // The arm's verdict record, with the digest pair in its detail sentence.
  const check: Check = { id: "T-74.out-discipline", ok: rulePresent && (pair === null || pair.identical), detail: "SKILL.md rule sentence present=" + rulePresent + (pair === null ? "; digest pair: not requested" : "; foreign dir digest " + pair.before.slice(0, 12) + " → " + pair.after.slice(0, 12) + " identical=" + pair.identical + " (the pinned dir received the run: " + pair.pinnedWrote + ")") }
  return { check, pair, rulePresent }
}

/**
 * Fingerprint every file under one directory: the sorted relative names plus each file's bytes.
 * @param dir The directory to digest.
 * @returns A hex digest with a ` files=<n>` suffix, or the literal `(absent)`.
 */
export function dirDigest(dir: string): string {
  if (!existsSync(dir)) return "(absent)"
  // Every file under the directory, in sorted relative-path order.
  const files = relPaths(dir).sort()
  return sha(files.map((rel) => rel + ":" + sha(readFileSync(join(dir, rel)))).join("\n")) + " files=" + files.length
}

// ── the run ──────────────────────────────────────────────────────────────────────────────────
/** The CLI arguments after the interpreter and this script's own path. */
const argv: string[] = process.argv.slice(2)
/**
 * Read `--name <value>` out of the argv.
 * @param name The flag to look for.
 * @param fallback The value to answer when the flag is absent (its type is preserved).
 * @returns The flag's following argv entry, or the fallback.
 */
const argOf = <T extends string | null | undefined>(name: string, fallback: T): string | T => {
  // The flag's position in the argv, or -1 when it was not passed at all.
  const at = argv.indexOf(name)
  return at >= 0 && argv[at + 1] !== undefined ? argv[at + 1] : fallback
}

/** The offline self-test: every arm's falsifier, run without a live boot. */
function selfTest(): void {
  // Every failed arm's name, printed together before the process exits non-zero.
  const failures: string[] = []
  // How many arms ran in total — the denominator of the final pass fraction.
  let total = 0
  /** Print one arm's outcome, and record its name when it failed. */
  const check = (name: string, ok: boolean, detail: string): void => {
    total += 1
    console.log("[self-test] " + (ok ? "ok  " : "FAIL") + " " + name + " — " + detail)
    if (!ok) failures.push(name)
  }
  /** The T-69 RED fixture: a scratch box holding a file that DOES carry a raw invocation. */
  const t69Fixture = (): string => {
    // The scratch box the raw-invocation fixture is written into.
    const box = mkdtempSync(join(tmpdir(), "lane-d-t69-"))
    writeFileSync(join(box, "raw.mjs"), 'const dump = spawnSync("dsh", ["--profile", "p", "--dump-config"])\n')
    return box
  }
  // The fixture box, removed in the `finally` below.
  const box = t69Fixture()
  try {
    // The fixture's own text, re-read to prove the scanner's pattern detects it.
    const text = readFileSync(join(box, "raw.mjs"), "utf8")
    check("t69-fixture-reddens", RAW_FLAG.test(text) || /"--dump-config"/.test(text), "a fixture carrying a raw invocation is DETECTED by the scanner's own pattern")
  } finally {
    rmSync(box, { recursive: true, force: true })
  }
  // The seeded-mismatch scratch box, removed in the `finally` below.
  const t80seeded = seededHeaderMismatch()
  try {
    // The checker's verdict on that bent header — it must be non-zero with a violation.
    const seeded = driverHeaderCheck(t80seeded)
    check("t80-seeded-mismatch-reddens", seeded.exit !== 0 && seeded.violations >= 1, "a scratch copy claiming one key too many exits " + seeded.exit + " with " + seeded.violations + " violation(s)")
  } finally {
    rmSync(t80seeded, { recursive: true, force: true })
  }
  // The two-frame container's shape: this call is where the frozen `require` defect throws.
  const shape = naiveVsReader()
  check("t25-two-frame-container", shape.frames >= 2 && naiveIsZero(shape.naive), "frames=" + shape.frames + ", naive read=" + shape.naive)
  // The ignore-rule reading for the declared scratch shape and its near miss.
  const ignore = checkIgnore([SCRATCH_SHAPE, NEAR_MISS])
  check("t77-shape-and-near-miss", ignore.ignored.includes(SCRATCH_SHAPE) !== ignore.ignored.includes(NEAR_MISS), "shape ignored=" + ignore.ignored.includes(SCRATCH_SHAPE) + ", near-miss ignored=" + ignore.ignored.includes(NEAR_MISS))
  // How many files the `./`-formed lane path discovers.
  const count = discoveredCount("./" + LANE_DIR)
  check("t89-dot-slash-discovers", count.exists && count.count > 0, "`./" + LANE_DIR + "` discovers " + count.count + " file(s)")
  /** One offline binding fixture: a synthetic site name plus the text the scanner must judge. */
  interface BindingFixture {
    /** The synthetic site label the scanner reports (also the fixture's identity in the reply). */
    readonly site: string
    /** The synthetic file text handed to `checkJoinBindings`. */
    readonly text: string
    /** True when the site is deliberately UNBOUND, i.e. the scan MUST flag it. */
    readonly unbound: boolean
  }
  // The five synthetic call sites: one deliberately unbound, four bound four different ways.
  const bindingFixtures: readonly BindingFixture[] = [
    { site: "fixture-unbound.mjs", text: 'const a = join(REPO, "scripts", "x.mjs")\n', unbound: true },
    { site: "fixture-declared.mjs", text: 'const REPO = "/tmp/repo"\nconst a = join(REPO, "scripts", "x.mjs")\n', unbound: false },
    { site: "fixture-imported.mjs", text: 'import { REPO } from "./lib/tui-lane.mjs"\nconst a = join(REPO, "scripts", "x.mjs")\n', unbound: false },
    { site: "fixture-parameter.mjs", text: 'function probe(repoRoot) { return join(repoRoot, "scripts", "x.mjs") }\n', unbound: false },
    { site: "fixture-prose.mjs", text: '// join(REPO, "scripts", "x.mjs") is absolute and safe\n', unbound: false },
  ]
  // The wrapper stream-contract arm: its live probe and its `--bin` fixture child.
  const streamArm = t69stream()
  check("t69-json-stream-contract", streamArm.check.ok && streamArm.fixture.childStdoutReachable, streamArm.check.detail)
  // The binding scan over the five synthetic call sites.
  const bindingScan = checkJoinBindings(bindingFixtures)
  // The fixture sites the scan flagged, which must be exactly the deliberately unbound one.
  const flagged = bindingScan.offenders.map((site) => site.site.split(":")[0])
  // The fixture sites that are EXPECTED to be flagged.
  const expectedFlagged = bindingFixtures.filter((fixture) => fixture.unbound).map((fixture) => fixture.site)
  check("t69-binding-reddens-and-spares", flagged.length === expectedFlagged.length && expectedFlagged.every((site) => flagged.includes(site)), "fixtures: " + bindingFixtures.length + ", flagged: " + (flagged.join(", ") || "none") + " (declared/imported/parameter/prose fixtures must NOT flag)")
  check("t74-rule-sentence", readText(SKILL_MD).includes(T74_RULE), "the SKILL.md rule sentence is present byte-for-byte")
  console.log("[self-test] " + (failures.length === 0 ? "PASS" : "FAIL") + " — " + SLUG + " (" + (total - failures.length) + "/" + total + " arms)")
  process.exit(failures.length === 0 ? 0 : 1)
}

if (argv.includes("--self-test")) selfTest()

/** One executed arm's reading: its verdict record, with every other field carried verbatim. */
interface ArmReading {
  /** The arm's verdict record — the one field the run itself reads. */
  readonly check: Check
}

// The `--only` selector, null when this run was not narrowed to a single arm.
const only = argOf("--only", null)
// The real session store to read (`--store`), undefined when this run reads none.
const storeHome = argOf("--store", undefined)
// The foreign evidence dir to digest before and after the pinned probe (`--foreign`).
const foreignDir = argOf("--foreign", undefined)
// This run's output directory: `--out`, else a fresh stamped dir under the lane's evidence root.
const out = resolve(argOf("--out", join(REPO, "evidence", "dsh-qa", "wave2b-laneD", timestamp())))
if (only === "t74-probe") {
  // The pinned probe: a cross-task invocation whose ONLY job is to land in the caller's dir (T-74).
  mkdirSync(out, { recursive: true })
  // The single file the probe writes, which the immutability guard refuses to overwrite.
  const target = join(out, "probe.txt")
  try {
    refuseOverwrite(target, { label: "probe output", remedy: "pass a fresh --out <dir>" })
  } catch (error) {
    exitOnRefusal(error, "[" + SLUG + "]")
  }
  writeFileSync(target, "wave2b lane D — T-74 probe\n")
  console.log("[" + SLUG + "] t74-probe wrote " + target)
  process.exit(0)
}

// The arms this run executes, in the fixed order the matrix lists them.
const arms: ArmReading[] = []
if (only === null || only === "t69") arms.push(t69())
if (only === null || only === "t69-binding") arms.push(t69binding())
if (only === null || only === "t69-stream") arms.push(t69stream())
if (only === null || only === "t89") arms.push(t89())
if (only === null || only === "t77") arms.push(t77())
if (only === null || only === "t80") arms.push(t80())
if (only === null || only === "t25") arms.push(t25(storeHome))
if (only === null || only === "t74") arms.push(t74(foreignDir))

mkdirSync(out, { recursive: true })
// Every executed arm's verdict record.
const checks = arms.map((arm) => arm.check)
// The arms whose verdict is false.
const failed = checks.filter((check) => !check.ok)
// The record written to `result.json`: the verdicts plus every arm's own readings.
const result = { slug: SLUG, suite: "wave2b lane D corpus arms", moment: new Date().toISOString(), only, checks, readings: arms.map((arm) => ({ id: arm.check.id, ...arm })), ok: failed.length === 0 }
// The record's path, which the immutability guard protects.
const resultPath = join(out, "result.json")
try {
  refuseOverwrite(resultPath, { label: "result.json", remedy: "pass a fresh --out <dir>" })
} catch (error) {
  exitOnRefusal(error, "[" + SLUG + "]")
}
writeFileSync(resultPath, JSON.stringify(result, null, 2) + "\n")
for (const check of checks) console.log("[" + SLUG + "] " + (check.ok ? "ok  " : "FAIL") + " " + check.id + " — " + check.detail)
console.log("[" + SLUG + "] " + (result.ok ? "PASS" : "FAIL") + " — " + checks.length + " arm(s), " + failed.length + " failed (evidence: " + resultPath + ")")
process.exit(result.ok ? 0 : 1)
