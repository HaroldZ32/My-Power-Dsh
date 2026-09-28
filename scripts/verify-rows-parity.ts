#!/usr/bin/env node
// B9 row-parity guard: the legacy installer (scripts/install-profile.ts) must
// declare the SAME row-id set as the bundle's patch layer. The measured defect
// this locks out: the installer and the patch once declared DIFFERENT row-id
// sets, so an install-profile install silently mounted none of the rows only the
// patch carried while `--dump-config` still looked healthy.
//
// 0.1.7-rc.2 SOURCE CHANGE: the patch layer is no longer ONE file. The root
// manifest declares `dsh.bundle.patch` as an ARRAY (the shipped-preset shape):
// the main bundle patch plus `presets/mpd.patch.yml`, which carries the whole
// mpd preset as a `@deepseek-ai/dsh-agent-preset` ROW. This guard therefore
// DISCOVERS the patch files from that one declaration — the same declaration the
// loader reads — and compares the UNION of their row ids, so a row that lives
// only in the second file is as binding as one in the first.
//
// Both row KINDS count now: an `- insert:` entry (a row this bundle adds) and a
// COLUMN-0 `- id:` id-target (a row this bundle overrides, e.g.
// `agent-preset-registry`, which the web-app layer declares). An id-target IS a
// row the legacy install must write, and leaving it out of the comparison is
// exactly how the two flows drift. Rows nested inside a preset row's inline
// `config.plugins` list are NOT home-patch rows — they travel INSIDE the
// `preset-mpd` row — and the extraction's indentation rule keeps them out.
//
// Gate story: run it exactly like the other repo-level guard,
// `node ./scripts/verify-rows-parity.ts` (cf. `node ./scripts/verify-vendor.ts`).
// Exit 0 = parity.
//
// The installer's set is MEASURED by running it in --dry-run against a throwaway
// --dsh-home (every row then renders as an insert and nothing is written), never
// by scraping its source: the printed patch is exactly what a legacy install
// would write. Commented-out rows (`# - id: …`) are skipped by construction.
//
// Lives under scripts/ (NOT skills/**) on purpose: skills/** is VENDOR_LOCK
// fingerprinted, and editing it would force a treeSha re-pin in the same commit.
//
// T-68 (wave 2b, lane B) adds `--self-test`. Before it this guard shipped NO
// self-test arm, so a parity guard that cannot be shown to redden was an
// assertion about its own source rather than an instrument. The arms are
// HERMETIC by construction: every one drives the SAME comparison over TEMP
// fixture patches and a TEMP fixture installer, and the run asserts that the LIVE
// patches' bytes and mtimes are untouched (the NEG CONTROL the acceptance names) —
// so another lane's patch edit can never redden the self-test, and the
// self-test can never touch the live tree.
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { readJson } from "./lib/repo.ts"

/** This script's own path on disk; the self-test arms re-spawn it through `process.execPath`. */
const SELF = fileURLToPath(import.meta.url)
/** The repository root, two directories above `<root>/scripts/<this file>`. */
const repoRoot = dirname(dirname(SELF))
/** The root manifest carrying the `dsh.bundle.patch` declaration the loader reads. */
const MANIFEST_PATH = join(repoRoot, "package.json")
/** The legacy installer whose dry-run render is the measured side of the comparison. */
const INSTALLER_PATH = join(repoRoot, "scripts", "install-profile.ts")
/** The prefix every line of this guard prints, so a log line names its producer. */
const PREFIX = "[verify-rows-parity]"

/** The subset of the root manifest's `dsh.bundle` block this guard reads. */
interface BundleDeclaration {
  /** The patch layer declaration: ONE path, an ARRAY of paths, or any foreign value. */
  readonly patch?: unknown
}

/** The manifest's `dsh` block; only the bundle patch declaration is of interest here. */
interface DshDeclaration {
  /** The bundle section holding the patch layer declaration. */
  readonly bundle?: BundleDeclaration
}

/** The root `package.json`, as far as this guard needs to type it. */
interface Manifest {
  /** The bundle declaration block; absent in a non-bundle package. */
  readonly dsh?: DshDeclaration
}

/** The bundle's patch files, from the ONE declaration the loader itself reads (string OR array). */
function declaredPatchPaths(manifestPath: string = MANIFEST_PATH): string[] {
  /** The raw declaration: unknown because it comes off disk and may be either shape. */
  const raw: unknown = readJson<Manifest>(manifestPath)?.dsh?.bundle?.patch
  /** The declaration normalized to a list — an array stays, a single string is wrapped, else empty. */
  const list: readonly unknown[] = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : []
  // Blank and non-string entries are dropped, then each surviving path is resolved against the repo
  // root, exactly as the loader resolves it.
  return list
    .filter((value: unknown): value is string => typeof value === "string" && value.trim() !== "")
    .map((value: string): string => resolve(repoRoot, value))
}

// Row ids declared by ONE patch file:
//   * entries of an `- insert:` list — 4-space indented (`    - id: X`), the
//     indentation the shipped patches and this bundle both use; deeper lines are
//     config (and a preset row's `config.plugins` children are deeper still), so
//     the rule keeps them out;
//   * a COLUMN-0 id-target (`- id: X`), i.e. a row the patch overrides in place.
// Commented-out rows (`# - id: …`) never match.
/** The row ids ONE patch file declares, in file order. */
function patchRowIds(patchText: string): string[] {
  /** The ids collected so far, in the order the file declares them. */
  const ids: string[] = []
  /** True while the scan sits inside an `- insert:` block at the list's own indentation. */
  let inInsert = false
  for (const raw of patchText.split(/\r?\n/)) {
    // A column-0 id-target is a row the patch overrides in place; the single match is reused
    // because `String.match` is nullable and the original re-ran the same regex here.
    const idTarget = raw.match(/^- id: ['"]?([A-Za-z0-9_.-]+)['"]?\s*$/)
    if (idTarget !== null) {
      ids.push(idTarget[1])
      continue
    }
    if (/^- insert:\s*$/.test(raw)) { inInsert = true; continue }
    if (!inInsert) continue
    if (raw.trim() === "") continue
    if (!raw.startsWith(" ")) { inInsert = false; continue }
    // An insert entry is indented exactly four spaces; deeper lines are config, never rows.
    const m = raw.match(/^ {4}- id: ['"]?([A-Za-z0-9_.-]+)['"]?\s*$/)
    if (m) ids.push(m[1])
  }
  return ids
}

/** A successful installer measurement: its ids are trustworthy and there is nothing to report. */
interface InstallerRunOk {
  /** Always true — the dry run exited 0. */
  readonly ok: true
  /** The row ids its dry-run render declared, in print order. */
  readonly ids: readonly string[]
  /** No failure text on the success arm. */
  readonly error: null
  /** No stderr to echo on the success arm. */
  readonly stderr: ""
}

/** A failed installer measurement: no ids were obtained and the diagnosis is carried here. */
interface InstallerRunFailed {
  /** Always false — the dry run errored or exited non-zero. */
  readonly ok: false
  /** Empty on this arm: a failed render measured nothing. */
  readonly ids: readonly string[]
  /** The pre-formatted reason, printed on the FAIL line. */
  readonly error: string
  /** The child's stderr, echoed after the FAIL line when non-empty. */
  readonly stderr: string
}

/** The installer's measured row set: either a usable render or a diagnosis. */
type InstallerRun = InstallerRunOk | InstallerRunFailed

// Row ids the installer declares, read from its own dry-run render (rows land at
// indent 0 as id-targets or indent 2 as inserts; deeper lines are config).
// Parameterized so `--self-test` drives a FIXTURE installer through the same
// code path the live run uses.
/** The row ids the installer at `installerPath` declares, measured through its own dry run. */
function installerRowIds(installerPath: string): InstallerRun {
  /** The throwaway home the dry run renders against; every row becomes an insert and nothing is written. */
  const scratch = mkdtempSync(join(tmpdir(), "mpd-rows-parity-home-"))
  try {
    /** The completed dry run; `encoding: "utf8"` makes both streams strings. */
    const r = spawnSync(process.execPath, [installerPath, "--dry-run", "--dsh-home", scratch], { encoding: "utf8" })
    if (r.error || r.status !== 0) {
      return { ok: false, ids: [], error: installerPath + " --dry-run exited " + String(r.status) + (r.error ? " (" + r.error.message + ")" : ""), stderr: String(r.stderr ?? "") }
    }
    /** The ids the render printed, at indent 0 (id-target) or indent 2 (insert). */
    const ids: string[] = []
    for (const m of String(r.stdout ?? "").matchAll(/^ {0,2}- id: ['"]?([A-Za-z0-9_.-]+)['"]?\s*$/gm)) ids.push(m[1])
    return { ok: true, ids, error: null, stderr: "" }
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

/** The ids that occur more than once, each listed once, in first-repeat order. */
function duplicates(ids: readonly string[]): string[] {
  return [...new Set(ids.filter((id: string, i: number): boolean => ids.indexOf(id) !== i))]
}

/** The two explicit sides the comparison runs over, so fixtures and the live run share ONE rule. */
interface CompareInputs {
  /** The raw text of every patch file in the layer under comparison. */
  readonly patchTexts: readonly string[]
  /** The row ids the installer's dry-run render declared. */
  readonly installerIds: readonly string[]
}

/** The comparison's outcome: both sets plus the drift each direction and the duplicates found. */
interface CompareResult {
  /** Every row id the patch layer declares (the union across the files). */
  readonly patchSet: ReadonlySet<string>
  /** Every row id the installer declares. */
  readonly installerSet: ReadonlySet<string>
  /** Ids the patch layer declares and the installer does not — the B9 drift shape. */
  readonly missing: readonly string[]
  /** Ids the installer declares and no patch file does — the reverse drift. */
  readonly extra: readonly string[]
  /** Ids the patch layer declares more than once. */
  readonly patchDup: readonly string[]
  /** Ids the installer declares more than once. */
  readonly installerDup: readonly string[]
}

/** The pure comparison over explicit inputs, so the live run and every fixture drive ONE rule. */
function compareRowSets({ patchTexts, installerIds }: CompareInputs): CompareResult {
  /** Every id the patch layer declares, concatenated across files. */
  const patchIds = patchTexts.flatMap((text: string): string[] => patchRowIds(text))
  /** The patch side as a set, for the directional difference below. */
  const patchSet = new Set(patchIds)
  /** The installer side as a set. */
  const installerSet = new Set(installerIds)
  // Directional sets: `missing` is declared by the patch layer but absent from the
  // installer (the B9 shape); `extra` is the reverse.
  /** Patch-layer ids the installer never declares. */
  const missing = [...patchSet].filter((id: string): boolean => !installerSet.has(id))
  /** Installer ids no patch file declares. */
  const extra = [...installerSet].filter((id: string): boolean => !patchSet.has(id))
  return { patchSet, installerSet, missing, extra, patchDup: duplicates(patchIds), installerDup: duplicates(installerIds) }
}

/** The parsed invocation, as the run and the self-test consume it. */
interface Options {
  /** The patch files to compare against; `--patch` replaces the manifest-derived list entirely. */
  patchPaths: string[]
  /** The installer to measure through `--dry-run`. */
  installerPath: string
  /** True when `--self-test` was requested: the fixture arms run and no live comparison happens. */
  selfTest: boolean
  /** True when `--quiet` was requested: the success line is suppressed. */
  quiet: boolean
}

/** The live read: unchanged behaviour, now driven by the shared comparison. */
function liveRun(opts: Options): void {
  /** The installer's measured row set; a failed render aborts before any comparison. */
  const installerRun = installerRowIds(opts.installerPath)
  if (!installerRun.ok) {
    console.error(PREFIX + " FAIL - " + installerRun.error)
    if (installerRun.stderr) console.error(String(installerRun.stderr).trim())
    process.exit(1)
  }
  /** The raw text of every patch file, in the order the caller declared them. */
  const patchTexts = opts.patchPaths.map((path: string): string => readFileSync(path, "utf8"))
  /** The comparison over the live patch texts and the installer's measured ids. */
  const cmp = compareRowSets({ patchTexts, installerIds: installerRun.ids })

  // Guard-1 (t8 / R7.15): a run with ZERO subjects is a degraded run, not a pass. Without this,
  // a patch layer that declares no row (or an installer that prints nothing) made the
  // comparison below trivially true and the gate exited 0 while checking nothing.
  if (cmp.patchSet.size === 0 || cmp.installerSet.size === 0) {
    /** The names of the empty sides, so the FAIL line says which subject is missing. */
    const empty = [cmp.patchSet.size === 0 ? "the bundle patch layer declares no row ids" : "", cmp.installerSet.size === 0 ? "the installer declares no row ids" : ""].filter(Boolean)
    console.error(PREFIX + " FAIL - zero-subject run: " + empty.join(" and ") + " - refusing to report PASS with nothing to compare")
    process.exit(1)
  }
  if (cmp.missing.length || cmp.extra.length || cmp.patchDup.length || cmp.installerDup.length) {
    console.error(PREFIX + " FAIL - installer vs bundle patch row ids differ")
    console.error("  bundle patch files (" + opts.patchPaths.length + "): " + opts.patchPaths.join(", "))
    console.error("  bundle patch rows  (" + cmp.patchSet.size + "): " + [...cmp.patchSet].join(", "))
    console.error("  installer rows     (" + cmp.installerSet.size + "): " + [...cmp.installerSet].join(", "))
    if (cmp.missing.length) console.error("  MISSING from scripts/install-profile.ts: " + cmp.missing.join(", "))
    if (cmp.extra.length) console.error("  EXTRA in scripts/install-profile.ts (not in the patch layer): " + cmp.extra.join(", "))
    if (cmp.patchDup.length) console.error("  DUPLICATE ids in the bundle patch layer: " + cmp.patchDup.join(", "))
    if (cmp.installerDup.length) console.error("  DUPLICATE ids in the installer: " + cmp.installerDup.join(", "))
    process.exit(1)
  }
  if (!opts.quiet) console.log(PREFIX + " ok: " + cmp.installerSet.size + " row ids match the " + opts.patchPaths.length + "-file bundle patch layer (" + [...cmp.installerSet].sort().join(", ") + ")")
}

// ---------------------------------------------------------------------------
// self-test (T-68) — every arm on TEMP fixtures; the live inputs are read-only
// ---------------------------------------------------------------------------

/** The generated fixture installer: plain JS, `.mjs` on purpose — a runtime fixture, not a wave source. */
const FIXTURE_INSTALLER_TEMPLATE: string = `#!/usr/bin/env node
// Fixture installer written by verify-rows-parity.ts --self-test: renders the row ids of ONE
// fixture in the same shape the real installer prints (indent 0 id-targets / indent 2 inserts).
const ROWS = __ROWS__
for (const id of ROWS) console.log("- id: " + id)
process.exit(0)
`

/** One patch file's text declaring the given ids as a single `- insert:` block. */
const fixturePatch = (ids: readonly string[]): string => ["- insert:", ...ids.map((id: string): string => "    - id: " + id), ""].join("\n")

/** The result of re-spawning this script for one self-test arm. */
interface ChildRun {
  /** The child's exit status, or null when it was killed by a signal. */
  readonly status: number | null
  /** The child's stdout. */
  readonly out: string
  /** The child's stderr. */
  readonly err: string
  /** stdout and stderr concatenated, in that order. */
  readonly all: string
}

/** Runs this script (SELF) as a child with the given arguments, capturing both streams as text. */
function childRun(args: readonly string[]): ChildRun {
  /** The completed child run. */
  const r = spawnSync(process.execPath, [SELF, ...args], { encoding: "utf8" })
  return { status: r.status, out: String(r.stdout ?? ""), err: String(r.stderr ?? ""), all: String(r.stdout ?? "") + String(r.stderr ?? "") }
}

/** One assertion of the self-test, with the detail printed beside it. */
interface SelfTestArm {
  /** The arm's name, printed in the PASS/FAIL line. */
  readonly name: string
  /** Whether the arm's assertion held. */
  readonly ok: boolean
  /** The measured detail, stringified only at print time. */
  readonly detail: unknown
}

/** Drives every fixture arm and returns the process exit code: 0 when all arms held, else 1. */
function selfTest(): number {
  /** The collected arms, printed in the order they were recorded. */
  const arms: SelfTestArm[] = []
  /** Records one arm; `ok` is coerced exactly as the original `Boolean(...)` did. */
  const arm = (name: string, ok: unknown, detail: unknown): void => { arms.push({ name, ok: Boolean(ok), detail }) }
  /** The start instant, used for the elapsed-ms detail of the hermeticity arm. */
  const startedAt = Date.now()
  /** The live patch files the manifest declares — read, never written, by this self-test. */
  const livePaths = declaredPatchPaths()
  /** The live patch bytes, compared again at the end to prove the run touched nothing. */
  const liveTexts = livePaths.map((path: string): string => readFileSync(path, "utf8"))
  /** The live patch mtimes before the run. */
  const liveMtimes = livePaths.map((path: string): number => statSync(path).mtimeMs)
  /** The live installer's mtime before the run; arm (f) asserts it is unchanged. */
  const liveInstallerMtime = statSync(INSTALLER_PATH).mtimeMs
  /** The temp root every fixture of this run is written under. */
  const scratch = mkdtempSync(join(tmpdir(), "mpd-rows-parity-selftest-"))
  try {
    /** Writes a fixture installer `.mjs` declaring `ids` and returns its path. */
    const installerFor = (name: string, ids: readonly string[]): string => {
      /** The fixture installer's path inside the temp root. */
      const p = join(scratch, name)
      writeFileSync(p, FIXTURE_INSTALLER_TEMPLATE.replace("__ROWS__", JSON.stringify(ids)))
      return p
    }
    /** A patch whose insert block declares exactly row-a..row-c. */
    const goodPatch = join(scratch, "good.patch.yml")
    writeFileSync(goodPatch, fixturePatch(["row-a", "row-b", "row-c"]))
    /** The same patch plus row-d — the SEEDED drift arm (b). */
    const driftPatch = join(scratch, "drift.patch.yml")
    writeFileSync(driftPatch, fixturePatch(["row-a", "row-b", "row-c", "row-d"]))
    /** A patch with no insert block at all — the zero-subject arm (e). */
    const emptyPatch = join(scratch, "empty.patch.yml")
    writeFileSync(emptyPatch, "# no insert block at all\n")
    // The 0.1.7 shape: a SECOND patch file carrying an id-target AND an insert row.
    /** The second patch file: one column-0 id-target plus one insert entry. */
    const secondPatch = join(scratch, "preset.patch.yml")
    writeFileSync(secondPatch, ["- id: registry-row", "  name: x", "", "- insert:", "    - id: preset-row", ""].join("\n"))

    // (a) fixture parity -> exit 0, the ids are named
    /** Arm (a): a fixture installer matching its patch passes and names the three ids. */
    const a = childRun(["--patch", goodPatch, "--installer", installerFor("fx-parity.mjs", ["row-a", "row-b", "row-c"])])
    arm("(a) fixture parity -> exit 0", a.status === 0 && a.out.includes("3 row ids match"), "exit " + a.status + "; " + a.out.trim())

    // (b) SEEDED violation: the patch declares one row the installer does not -> non-zero, fault NAMED
    /** Arm (b): the seeded missing row must exit 1 and name `row-d` as MISSING. */
    const b = childRun(["--patch", driftPatch, "--installer", installerFor("fx-missing.mjs", ["row-a", "row-b", "row-c"])])
    arm("(b) seeded missing row -> exit 1 + the fault named", b.status === 1 && b.err.includes("MISSING from") && b.err.includes("row-d"), "exit " + b.status + "; " + (b.err.split("\n").find((l: string): boolean => l.includes("MISSING")) ?? "(no MISSING line)"))

    // (c) the reverse direction is named too (an installer-only row)
    /** Arm (c): an installer-only row must exit 1 and name `row-z` as EXTRA. */
    const c = childRun(["--patch", goodPatch, "--installer", installerFor("fx-extra.mjs", ["row-a", "row-b", "row-c", "row-z"])])
    arm("(c) installer-only row -> exit 1 + EXTRA named", c.status === 1 && c.err.includes("EXTRA in") && c.err.includes("row-z"), "exit " + c.status + "; " + (c.err.split("\n").find((l: string): boolean => l.includes("EXTRA")) ?? "(no EXTRA line)"))

    // (d) duplicate ids are a fault, not a set-equality pass
    /** Arm (d): a repeated installer id must exit 1 with DUPLICATE named, despite equal sets. */
    const d = childRun(["--patch", goodPatch, "--installer", installerFor("fx-dup.mjs", ["row-a", "row-a", "row-b", "row-c"])])
    arm("(d) duplicate installer id -> exit 1 + DUPLICATE named", d.status === 1 && d.err.includes("DUPLICATE"), "exit " + d.status + "; " + (d.err.split("\n").find((l: string): boolean => l.includes("DUPLICATE")) ?? "(no DUPLICATE line)"))

    // (e) zero-subject guard: a patch with no insert block must never pass
    /** Arm (e): a patch declaring no row must exit 1 on the zero-subject guard. */
    const e = childRun(["--patch", emptyPatch, "--installer", installerFor("fx-empty.mjs", ["row-a"])])
    arm("(e) zero-subject patch -> exit 1 (degraded, never a pass)", e.status === 1 && e.err.includes("zero-subject"), "exit " + e.status)

    // (g) MULTI-FILE layer: an id-target and an insert living in the SECOND file
    // both bind the installer. One file alone is not the contract any more.
    /** Arm (g): both files together must pass and report a 2-file layer of five ids. */
    const gBoth = childRun(["--patch", goodPatch, "--patch", secondPatch, "--installer", installerFor("fx-multi.mjs", ["row-a", "row-b", "row-c", "registry-row", "preset-row"])])
    arm("(g) two patch files -> id-target + insert from the second both count", gBoth.status === 0 && gBoth.out.includes("5 row ids match") && gBoth.out.includes("2-file"), "exit " + gBoth.status + "; " + gBoth.out.trim())
    /** Arm (g2): dropping the second file must name BOTH of its rows as MISSING. */
    const gOne = childRun(["--patch", goodPatch, "--installer", installerFor("fx-multi.mjs", ["row-a", "row-b", "row-c", "registry-row", "preset-row"])])
    arm("(g2) dropping the second file -> exit 1 with BOTH of its rows named MISSING", gOne.status === 1 && gOne.err.includes("registry-row") && gOne.err.includes("preset-row"), "exit " + gOne.status + "; " + (gOne.err.split("\n").find((l: string): boolean => l.includes("MISSING")) ?? "(no MISSING line)"))

    // (h) the LIVE discovery must really read the manifest's array (>= 2 files).
    // A discovery that silently returned one file would compare a subset and pass.
    arm("(h) live manifest declares >= 2 patch files and discovery finds them all", livePaths.length >= 2 && liveTexts.every((text: string): boolean => text.length > 0), livePaths.map((p: string): string => p.replace(repoRoot + "/", "")).join(", ") || "(none)")

    // (f) hermeticity: fixtures live in a temp dir, and the LIVE inputs are untouched by the run
    /** The live patch mtimes re-read after every arm, which must equal the pre-run values. */
    const liveMtimesAfter = livePaths.map((path: string): number => statSync(path).mtimeMs)
    arm(
      "(f) hermetic: temp fixtures only; the live patches' bytes + mtimes are unchanged",
      scratch.startsWith(tmpdir())
        && livePaths.every((path: string, i: number): boolean => readFileSync(path, "utf8") === liveTexts[i])
        && liveMtimesAfter.every((mtime: number, i: number): boolean => mtime === liveMtimes[i])
        && statSync(INSTALLER_PATH).mtimeMs === liveInstallerMtime,
      "fixture root " + scratch + " (temp); live patches unchanged; elapsed " + (Date.now() - startedAt) + "ms",
    )
  } catch (error) {
    // The harness arm reports a throwable that escaped an arm; `stack` first, as the original's
    // `error?.stack ?? error` did, and a non-Error throwable stringifies the same way.
    arm("self-test harness", false, String(error instanceof Error ? (error.stack ?? error) : error))
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }

  for (const a of arms) console.log(PREFIX + " self-test " + (a.ok ? "PASS" : "FAIL") + " - " + a.name + " :: " + String(a.detail).slice(0, 220))
  /** How many arms failed; the exit code is derived from this count alone. */
  const failed = arms.filter((a: SelfTestArm): boolean => !a.ok).length
  console.log(PREFIX + " self-test " + (failed === 0 ? "PASS" : "FAIL") + ": " + (arms.length - failed) + "/" + arms.length + " arms")
  return failed === 0 ? 0 : 1
}

/** Parses this script's argv; unknown flags are a usage error and exit 2. */
function parseArgs(argv: string[]): Options {
  /** The live defaults: the manifest's own patch files, the real installer, both switches off. */
  const opts: Options = { patchPaths: declaredPatchPaths(), installerPath: INSTALLER_PATH, selfTest: false, quiet: false }
  /** True once a caller-supplied `--patch` replaced the manifest-derived default list. */
  let patchOverride = false
  for (let i = 0; i < argv.length; i += 1) {
    /** The argument under inspection. */
    const a = argv[i]
    if (a === "--self-test") opts.selfTest = true
    else if (a === "--quiet") opts.quiet = true
    else if (a === "--patch") {
      // Repeatable: the bundle's patch layer is an ARRAY, and a caller that names
      // one file means exactly that one file.
      if (!patchOverride) { opts.patchPaths = []; patchOverride = true }
      opts.patchPaths.push(resolve(argv[++i] ?? ""))
    } else if (a === "--installer") opts.installerPath = resolve(argv[++i] ?? "")
    else {
      console.error(PREFIX + " FAIL - unknown argument: " + a)
      console.error("usage: node ./scripts/verify-rows-parity.ts [--patch <path>]... [--installer <path>] [--quiet] [--self-test]")
      process.exit(2)
    }
  }
  return opts
}

/** The parsed invocation, driving the self-test or the live comparison below. */
const opts = parseArgs(process.argv.slice(2))
if (opts.selfTest) process.exit(selfTest())
liveRun(opts)
