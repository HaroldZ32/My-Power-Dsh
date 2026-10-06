// D6 STATIC GATE for the DSH-TUI plane — no direct `tui*` access outside the TUI adapter.
//
// `.mpd/plans/mpd-seam-convergence.md` A2.2 rules that `packages/mpd-tui-adapter-plugin` is the ONE
// place a DSH-TUI service is named, probed or bound: `packages/mpd-tui-plugin/src/**` must not
// spell a `tui*` service id at all. The reason is the same one AGENTS.md §6 states for the DSH
// plane — a dsh-tui release that renames or reshapes a seam must be absorbed in ONE file instead of
// across thirteen, and a second contact surface is exactly what the rule forbids.
//
// The scan covers `packages/mpd-*/src/**/*.ts` EXCEPT `packages/mpd-tui-adapter-plugin` (the ONE
// sanctioned route) and fails naming file + line for any of the sixteen ids, in ALL THREE
// spellings:
//   * PROPERTY — `ctx.tuiScenes`, and the same read through an ALIASED receiver (`const t = ctx;
//     t.tuiScenes`), because an alias is not a different seam;
//   * STRING — `ctx.get("tuiScenes")`, `ctx.inject(["tuiScenes"])`, `onService(ctx, "tuiScenes")`,
//     `serviceOf(ctx, "tuiScenes")`: the same violation spelled as a service id;
//   * BARE — any other occurrence of the identifier (a re-exported table, a template literal), which
//     is the catch-all that keeps the two rules above from being evadable by a third spelling.
//
// WHAT THE SCAN DOES, and what it deliberately does not:
//   * COMMENTS are stripped before matching (line structure preserved), so an explanatory
//     "never touch ctx.tuiScenes here" is not a false positive, while the STRING form still
//     reddens;
//   * findings report the ORIGINAL line number and the original line text;
//   * files under a scanned `package/src` that are NOT `*.ts` are the DECLARED OUT-OF-BAND set:
//     every hit there is printed in a loud NOT COVERED section and never fails the run, the same
//     discipline `scripts/verify-dist-fresh.ts` follows for unmatched `dist/` files — a blind spot
//     that is named beats one that is silent.
//
// USAGE (both work; `--self-test` proves the gate reddens on a seeded violation):
//   node packages/mpd-tui-adapter-plugin/test/no-direct-tui-access.test.ts [--self-test]
//   bun  packages/mpd-tui-adapter-plugin/test/no-direct-tui-access.test.ts [--self-test]
//
// Under `bun test` the two functions below are registered as ordinary test cases, so the gate also
// guards the adapter package's own suite.
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import type { Dirent } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"

/** One reported hit: the rule that matched, and the original line it matched on. */
interface Finding {
  /** The file's path relative to the scanned root, `/`-separated. */
  file: string
  /** The 1-based line in the ORIGINAL file (comment stripping preserves line structure). */
  line: number
  /** The matched id and the rule that owned the line. */
  identifier: string
  /** The original line's text, trimmed, so a finding reads without opening the file. */
  text: string
}

/** One scan's outcome: the violations, the declared out-of-band hits, and the coverage counts. */
interface ScanResult {
  /** Every violation found in the band, one report per line. */
  findings: Finding[]
  /** Hits in a non-`.ts` file under a scanned `src/`: printed as NOT COVERED, never failing. */
  outOfBand: Finding[]
  /** How many `packages/mpd-*` `src/` roots were scanned. */
  packages: number
  /** How many `.ts` files were read inside those roots. */
  files: number
}

/** One self-test arm: its description, its verdict, and the detail printed when it fails. */
interface SelfTestCheck {
  /** The arm's description, printed on its own report line. */
  name: string
  /** Whether the arm held. */
  ok: boolean
  /** The measured value, printed only for a failing arm. */
  detail: string
}

/** The self-test's full result: every arm plus the scan the seeded fixture produced. */
interface SelfTestResult {
  /** Whether every arm held. */
  ok: boolean
  /** Every arm, in the order the fixture declares them. */
  checks: SelfTestCheck[]
  /** The fixture root, already removed (`undefined` only when the run never seeded one). */
  tempRoot: string | undefined
  /** The findings of the seeded scan: one per seeded violation. */
  findings: Finding[]
  /** The declared out-of-band hits of the seeded scan (the non-`.ts` fixture). */
  outOfBand: Finding[]
}

/** A report sink: one line at a time, so a caller can capture or silence the report. */
type ReportStream = (line: string) => void

/**
 * The sixteen DSH-TUI service ids this gate owns.
 *
 * The fifteen `tui*` services — the fourteen available since dsh-tui 0.12.0 plus `tuiPanels`, which
 * 0.13.0 added — and `tuiPrompt`. A seam missing from this list is a seam a consumer file could name
 * directly without the gate reddening, which is why the list is kept in step with `TUI_SEAMS` by a
 * MECHANISM and not by hand: the test "the forbidden list tracks the adapter's seam table" reddens
 * when the adapter names a `tui*` id this list does not carry.
 */
export const FORBIDDEN_TUI_SEAMS: readonly string[] = [
  "tuiScenes",
  "tuiStatus",
  "tuiRenderers",
  "tuiSettingsSections",
  "tuiShortcuts",
  "tuiDialogs",
  "tuiCommandTrees",
  "tuiPluginHost",
  "tuiToast",
  "tuiThemes",
  "tuiPluginStorage",
  "tuiMessageObserver",
  "tuiEffectLedger",
  "tuiWorkspaces",
  "tuiPanels",
  "tuiPrompt",
]

/**
 * The helper names that READ a service by id. Rule 2 owns a line when one of them is called with a
 * quoted forbidden id, which is the STRING spelling of the same violation rule 1 catches.
 */
export const SEAM_READING_HELPERS: readonly string[] = ["get", "inject", "onService", "serviceOf", "readableService"]

/** The one package allowed to touch them: the TUI adapter IS the contact surface. */
export const ADAPTER_PACKAGE: string = "mpd-tui-adapter-plugin"

/** The scanned band: every other `packages/mpd-*` package's TypeScript sources. */
const BAND_EXTENSION = ".ts"
/** Extensions reported (never failed) when they sit under a scanned package's `src/`. */
const OUT_OF_BAND_EXTENSIONS = [".js", ".mjs", ".cjs", ".jsx", ".tsx", ".mts", ".cts", ".gitkeep", ""]

/** This test file's own directory, which is also the fallback scratch root's parent. */
const here = dirname(fileURLToPath(import.meta.url))
/** `<repo>/packages/mpd-tui-adapter-plugin/test` -> `<repo>`. */
export const REPO_ROOT: string = resolve(here, "..", "..", "..")

/**
 * Blank out comments while preserving BOTH the character count and every newline, so a finding
 * keeps the original line number. String and template literals are copied verbatim (their content
 * is code-shaped: `ctx.get("tuiScenes")` must still match).
 *
 * Declared bound: a regular expression whose body contains `//` can swallow the rest of its line.
 * That direction is a false NEGATIVE on one line, never a false positive.
 * @param source - the file's full text.
 * @returns the same text with comment spans replaced by spaces.
 */
export function stripComments(source: string): string {
  /** The rebuilt source: comment spans become spaces, and every kept byte is copied verbatim. */
  let out = ""
  /** Whether the scanner is inside a block comment right now. */
  let inBlock = false
  /** The quote character of the string/template literal currently open, or `""` for none. */
  let quote = ""
  for (let at = 0; at < source.length; at += 1) {
    /** The character under the cursor. */
    const ch = source[at]
    /** The character after it, `undefined` past the end (which the escape arm coalesces). */
    const next = source[at + 1]
    if (inBlock) {
      if (ch === "*" && next === "/") {
        inBlock = false
        out += "  "
        at += 1
        continue
      }
      out += ch === "\n" ? "\n" : " "
      continue
    }
    if (quote !== "") {
      out += ch
      if (ch === "\\") {
        out += next ?? ""
        at += 1
        continue
      }
      if (ch === quote) quote = ""
      continue
    }
    if (ch === "/" && next === "*") {
      inBlock = true
      out += "  "
      at += 1
      continue
    }
    if (ch === "/" && next === "/") {
      while (at < source.length && source[at] !== "\n") {
        out += " "
        at += 1
      }
      out += "\n"
      continue
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch
      out += ch
      continue
    }
    out += ch
  }
  return out
}

/**
 * Every file under `dir` (recursive); `[]` when the directory does not exist.
 * @param dir - the directory to walk.
 * @returns the absolute paths of the files it holds.
 */
function walkFiles(dir: string): string[] {
  /** The directory entries; the catch below returns before this is ever read. */
  let entries: Dirent[]
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  /** The files collected so far, in the order the directory listed them. */
  const files: string[] = []
  for (const entry of entries) {
    /** The entry's path, relative to the walk's starting directory. */
    const full = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...walkFiles(full))
    else if (entry.isFile()) files.push(full)
  }
  return files
}

/**
 * The `src/` roots of every `packages/mpd-*` package except the adapter, sorted by name.
 * @param repoRoot - the scanned repository root.
 * @returns the absolute `src` directories the band covers.
 */
function scannedPackageRoots(repoRoot: string): string[] {
  /** The `packages/` directory of the scanned root. */
  const packagesDir = join(repoRoot, "packages")
  /** The entries of `packages/`; the catch below returns before this is ever read. */
  let entries: Dirent[]
  try {
    entries = readdirSync(packagesDir, { withFileTypes: true })
  } catch {
    return []
  }
  return entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("mpd-") && entry.name !== ADAPTER_PACKAGE)
    .map((entry) => join(packagesDir, entry.name, "src"))
    .filter((dir) => {
      try {
        return statSync(dir).isDirectory()
      } catch {
        return false
      }
    })
    .sort()
}

/** Escape one id for use inside a regular expression (the ids carry no metacharacter today). */
function escapeId(id: string): string {
  return id.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")
}

/**
 * Scan one repository root for direct DSH-TUI seam access.
 * @param repoRoot - the repository root to scan; defaults to this checkout.
 * @returns `{findings, outOfBand, packages, files}` — `findings` are the violations (each
 *   `{file, line, identifier, text}` with `file` relative to `repoRoot`), and `outOfBand` are the
 *   NOT COVERED hits that never fail the run.
 */
export function scanDirectTuiAccess(repoRoot: string = REPO_ROOT): ScanResult {
  /** The violations found in the band. */
  const findings: Finding[] = []
  /** The hits in a non-`.ts` file: printed as NOT COVERED, never a failure. */
  const outOfBand: Finding[] = []
  /** The `src/` root of every package the band covers. */
  const roots = scannedPackageRoots(repoRoot)
  /** How many `.ts` files the walk actually read (the coverage count the report prints). */
  let files = 0
  for (const srcRoot of roots) {
    for (const file of walkFiles(srcRoot)) {
      /** The file's extension, taken from its last dot (`""` for an extensionless file). */
      const extension = file.slice(file.lastIndexOf("."))
      /** The path as the report prints it: relative to the scanned root, `/`-separated. */
      const relPath = relative(repoRoot, file).split(sep).join("/")
      /** The file's text; an unreadable file is skipped rather than failing the whole scan. */
      let source: string
      try {
        source = readFileSync(file, "utf8")
      } catch {
        continue
      }
      if (extension !== BAND_EXTENSION) {
        /** The out-of-band file's lines, matched whole because nothing is stripped there. */
        const lines = source.split("\n")
        lines.forEach((text, index) => {
          for (const seam of FORBIDDEN_TUI_SEAMS) {
            if (new RegExp(`\\b${seam}\\b`).test(text)) {
              outOfBand.push({ file: relPath, line: index + 1, identifier: seam, text: text.trim() })
            }
          }
        })
        continue
      }
      files += 1
      /** The original lines, quoted verbatim by each finding. */
      const original = source.split("\n")
      /** The same lines with comments blanked out, line structure preserved. */
      const stripped = stripComments(source).split("\n")
      for (let index = 0; index < stripped.length; index += 1) {
        for (const seam of FORBIDDEN_TUI_SEAMS) {
          // ONE REPORT PER VIOLATION. A line can satisfy two rules at once, and a line counted
          // twice makes every count in this file meaningless. The FIRST rule to match owns the
          // line; the rest skip it.
          if (findings.some((finding) => finding.file === relPath && finding.line === index + 1)) continue
          /** The `receiver.tuiScenes` spelling, whatever the receiver is named. */
          const property = new RegExp(`\\b([A-Za-z_$][\\w$]*)\\s*\\.\\s*${seam}\\b`)
          /** The `helper("tuiScenes")` / `helper(["tuiScenes"])` spelling. */
          const viaString = new RegExp(
            `\\b(?:${SEAM_READING_HELPERS.join("|")})\\s*\\(\\s*\\[?\\s*["'\x60]${seam}["'\x60]`,
          )
          /** The catch-all: the id spelled anywhere else (a table, a template, an aliased read). */
          const bare = new RegExp(`\\b${seam}\\b`)
          /** The property rule's receiver, when that rule owns the line. */
          const receiver = property.exec(stripped[index])
          if (receiver !== null) {
            findings.push({
              file: relPath,
              line: index + 1,
              identifier: `${seam} read as a property of \`${receiver[1]}\` — bind it through mpd-tui-adapter`,
              text: (original[index] ?? "").trim(),
            })
          } else if (viaString.test(stripped[index])) {
            findings.push({
              file: relPath,
              line: index + 1,
              identifier: `${seam} named to a service-reading helper — bind it through mpd-tui-adapter`,
              text: (original[index] ?? "").trim(),
            })
          } else if (bare.test(stripped[index])) {
            findings.push({
              file: relPath,
              line: index + 1,
              identifier: `${seam} spelled directly — read it from TUI_SEAMS in mpd-tui-adapter`,
              text: (original[index] ?? "").trim(),
            })
          }
        }
      }
    }
  }
  return { findings, outOfBand, packages: roots.length, files }
}

/**
 * The negative control: seed a fixture tree with the SAME shapes the real band can carry and assert
 * the scanner reddens where it must and stays silent where it must not.
 * @returns `{ok, checks, tempRoot, findings, outOfBand}`; `checks` is a list of
 *   `{name, ok, detail}` so a caller can print exactly which arm failed.
 */
export function selfTest(): SelfTestResult {
  /** The seeded fixture root; removed before this function returns. */
  const tempRoot = mkdtempSync(join(tmpdir(), "mpd-tui-access-gate-"))
  /** Every arm, in the order the fixture declares them. */
  const checks: SelfTestCheck[] = []
  /** The findings of the seeded scan, or `[]` when the scan never ran. */
  let findings: Finding[] = []
  /** The out-of-band hits of the seeded scan, or `[]` when the scan never ran. */
  let outOfBand: Finding[] = []
  try {
    /** The fixture package the seeded violations live in. */
    const fixtureSrc = join(tempRoot, "packages", "mpd-fixture-plugin", "src")
    mkdirSync(fixtureSrc, { recursive: true })
    // The seeded file carries EVERY spelling the real band can carry — plus one comment-only
    // mention, which must stay silent.
    writeFileSync(
      join(fixtureSrc, "bad.ts"),
      [
        "// a comment naming tuiScenes must NOT be a finding",
        "const t = ctx",
        "export function boot(ctx: any): void {",
        "  const a = ctx.tuiScenes",
        "  const b = t.tuiStatus",
        "  const c = ctx.get(\"tuiRenderers\")",
        "  const d = ctx.inject([\"tuiShortcuts\"], () => undefined)",
        "  const e = serviceOf(ctx, 'tuiDialogs')",
        "}",
        "",
      ].join("\n"),
      "utf8",
    )
    // The declared out-of-band shape: a non-`.ts` file is REPORTED, never failed.
    writeFileSync(join(fixtureSrc, "legacy.js"), "const f = ctx.tuiToast\n", "utf8")
    // The excluded package: its hits must not be counted at all (it IS the contact surface).
    /** The excluded package's own `src/`, created before the fixture file lands in it. */
    const adapterSrc = join(tempRoot, "packages", ADAPTER_PACKAGE, "src")
    mkdirSync(adapterSrc, { recursive: true })
    writeFileSync(join(adapterSrc, "index.ts"), "export const TUI_SEAMS = { scenes: \"tuiScenes\", status: \"tuiStatus\" }\n", "utf8")
    /** The seeded scan's result. */
    const result = scanDirectTuiAccess(tempRoot)
    findings = result.findings
    outOfBand = result.outOfBand
    /** The helpers the four seeded violations name, for the membership arms below. */
    const ids = result.findings.map((finding) => finding.identifier)
    checks.push({
      name: "the seeded band yields exactly the five seeded violations",
      ok: result.findings.length === 5,
      detail: `findings=${String(result.findings.length)} (${result.findings.map((f) => `${f.file}:${String(f.line)}`).join(", ")})`,
    })
    checks.push({
      name: "the comment-only mention is not a finding",
      ok: !result.findings.some((finding) => finding.line === 1),
      detail: "line 1 of the fixture names a seam inside a comment and must stay silent",
    })
    checks.push({
      name: "the aliased receiver is caught (an alias is not a different seam)",
      ok: ids.some((id) => id.includes("tuiStatus") && id.includes("`t`")),
      detail: `identifiers=${ids.join(" | ")}`,
    })
    checks.push({
      name: "the string forms are caught (get / inject / serviceOf)",
      ok: ["tuiRenderers", "tuiShortcuts", "tuiDialogs"].every((seam) => ids.some((id) => id.startsWith(seam))),
      detail: `identifiers=${ids.join(" | ")}`,
    })
    checks.push({
      name: "the adapter package is excluded by identity",
      ok: !result.findings.some((finding) => finding.file.includes(ADAPTER_PACKAGE)),
      detail: "the contact surface itself must never be reported",
    })
    checks.push({
      name: "the non-.ts fixture file is reported out of band, never as a finding",
      ok: result.outOfBand.length === 1 && result.outOfBand[0]?.file.endsWith("legacy.js") === true,
      detail: `outOfBand=${String(result.outOfBand.length)}`,
    })
    checks.push({
      name: "the scan covers the adapter package's siblings",
      ok: result.packages === 1 && result.files === 1,
      detail: `packages=${String(result.packages)} files=${String(result.files)}`,
    })
  } catch (error) {
    checks.push({ name: "the fixture seeded and scanned without throwing", ok: false, detail: String((error as Error)?.message ?? error) })
  } finally {
    try {
      rmSync(tempRoot, { recursive: true, force: true })
    } catch {
      // A leftover temp dir is not a failure of the gate.
    }
  }
  return { ok: checks.every((check) => check.ok), checks, tempRoot: undefined, findings, outOfBand }
}

/**
 * Turn one finding into the report line every section prints.
 * @param finding - the finding to render.
 * @returns the one-line rendering.
 */
function findingLine(finding: Finding): string {
  return `  ${finding.file}:${finding.line}: ${finding.identifier} — ${finding.text}`
}

/**
 * Print the full report.
 * @param result - the scan to report.
 * @param stream - the sink, one line at a time.
 * @returns the process exit code (0 = clean).
 */
export function report(result: ScanResult, stream: ReportStream = console.log): number {
  stream("NO-DIRECT-TUI-ACCESS — D6 static gate for the DSH-TUI plane (.mpd/plans/mpd-seam-convergence.md A2.2)")
  stream(`band: packages/mpd-*/src/**/*${BAND_EXTENSION}, minus packages/${ADAPTER_PACKAGE} (the ONE sanctioned route)`)
  stream(`scanned: ${result.packages} package(s), ${result.files} ${BAND_EXTENSION} file(s)`)
  stream(`declared out-of-band: every non-.ts file under a scanned src/ (currently the .gitkeep placeholders) — printed, never failed`)
  if (result.outOfBand.length > 0) {
    stream(`NOT COVERED (declared out of band, never a failure) — ${result.outOfBand.length} hit(s):`)
    for (const hit of result.outOfBand) stream(findingLine(hit))
  }
  if (result.findings.length === 0) {
    stream("RESULT: PASS (0 findings)")
    return 0
  }
  stream(`RESULT: FAIL (${result.findings.length} finding(s)) — every mpd plugin must reach a DSH-TUI seam through ${ADAPTER_PACKAGE}:`)
  for (const finding of result.findings) stream(findingLine(finding))
  return 1
}

/**
 * Print the `--self-test` banner: one line per arm, then the verdict.
 * @param result - the self-test result.
 * @param stream - the sink, one line at a time.
 * @returns the process exit code (0 = every arm held).
 */
function reportSelfTest(result: SelfTestResult, stream: ReportStream = console.log): number {
  stream("SELF-TEST — no-direct-tui-access (negative control over a seeded fixture tree)")
  for (const check of result.checks) stream(`  ${check.ok ? "ok  " : "FAIL"} ${check.name}${check.ok ? "" : ` — ${check.detail}`}`)
  /** The arms that held, printed as the `passed/total` tally. */
  const passed = result.checks.filter((check) => check.ok).length
  stream(`SELF-TEST: ${result.ok ? "PASS" : "FAIL"} (${passed}/${result.checks.length} checks)`)
  return result.ok ? 0 : 1
}

/**
 * The CLI: `--self-test` runs the negative control, otherwise the real band is scanned.
 * @param argv - the process arguments after the script name.
 * @param stream - the sink, one line at a time.
 * @returns the process exit code.
 */
async function main(argv: string[], stream: ReportStream = console.log): Promise<number> {
  if (argv.includes("--self-test")) {
    /** The negative control's result, which must not depend on this repository's state. */
    const result = selfTest()
    // The self-test is the negative control: it must NOT depend on the repository's own state, or
    // a real violation would hide behind a failing control.
    return reportSelfTest(result, stream)
  }
  return report(scanDirectTuiAccess(REPO_ROOT), stream)
}

// ── the bun:test arm ────────────────────────────────────────────────────────────────
// `node` cannot resolve `bun:test` at all, and MEASURED with bun 1.4.0 a plain `bun <this file>`
// resolves the module but REJECTS `test(...)` with "Cannot use test outside of the test runner"
// (registration throws, the process would die before the CLI ran). Both cases therefore fall
// through to the CLI below; only `bun test` registers, which is what makes this gate part of the
// adapter package's own suite as well.
try {
  /** The test runner's own registration API; importing it is the whole bun:test arm. */
  const { expect, test } = await import("bun:test")
  test("no direct DSH-TUI seam access outside the TUI adapter (A2.2)", () => {
    /** The scan of the REAL band this repository currently carries. */
    const result = scanDirectTuiAccess(REPO_ROOT)
    report(result)
    expect(result.findings).toEqual([])
  })
  test("the gate reddens on a seeded violation (negative control)", () => {
    /** The negative control's result; every arm must have held. */
    const result = selfTest()
    reportSelfTest(result)
    expect(result.ok).toBe(true)
  })
  test("the forbidden list tracks the adapter's seam table", async () => {
    // THE DRIFT THIS CATCHES (measured 2026-10-06): dsh-tui 0.13.0 added `tuiPanels` and the adapter
    // adopted it, while this gate's list still carried only the fourteen 0.12.0 services — so a
    // consumer file could have named the new seam directly and the gate would have stayed green.
    // The invariant is therefore DERIVED from the table, not from the release we last targeted: every
    // `tui*`-shaped id in `TUI_SEAMS` must be forbidden outside the adapter. The harness services the
    // table also brokers (`commands`, `settings`) are deliberately NOT this gate's business.
    /** The adapter's own seam table, the single source of the service ids. */
    const { TUI_SEAMS } = await import("../src/index.ts")
    /** The `tui*` ids the table names. */
    const tuiIds = Object.values(TUI_SEAMS).filter((id) => id.startsWith("tui"))
    expect(tuiIds.length).toBeGreaterThan(0)
    for (const id of tuiIds) expect(FORBIDDEN_TUI_SEAMS).toContain(id)
  })
} catch {
  // Not under the bun test runner (or not bun at all): the CLI is the whole surface.
}

if (import.meta.main) {
  /** The exit code the CLI computed; a non-zero code must reach the shell. */
  const code = await main(process.argv.slice(2))
  if (code !== 0) process.exitCode = code
}
