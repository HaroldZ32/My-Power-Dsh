// D6 STATIC GATE — no direct Agent Teams access outside the adapter.
//
// `docs/plan-0.1.7-adaptation.md` §4 (decision D6) rules that every mpd plugin reaches the
// official Agent Teams service ONLY through `mpd-dsh-adapter`: a direct `ctx.agentTeams`
// read or a direct `ctx.subagents.startContinuable` call outside the adapter row is a
// violation, because AGENTS.md §6 makes that one file the place a harness rename or
// reshape is absorbed — a second contact surface is exactly what the rule forbids.
//
// The scan covers `packages/mpd-*/src/**/*.ts` EXCEPT `packages/mpd-dsh-adapter-plugin`
// (the ONE sanctioned route) and fails naming file + line for either literal identifier.
//
// WHAT THE SCAN DOES, and what it deliberately does not:
//   * COMMENTS are stripped before matching (line structure preserved), so an explanatory
//     "never touch ctx.agentTeams here" is not a false positive, while the STRING form
//     `ctx.get("agentTeams")` — the same violation spelled differently — still reddens;
//   * findings report the ORIGINAL line number and the original line text;
//   * files under `packages/mpd-*/src` that are NOT `*.ts` are the DECLARED OUT-OF-BAND
//     set: every hit there is printed in a loud NOT COVERED section and never fails the
//     run, the same discipline `scripts/verify-dist-fresh.mjs` follows for unmatched
//     `dist/` files — a blind spot that is named beats one that is silent.
//
// USAGE (both work; `--self-test` proves the gate reddens on a seeded violation):
//   node packages/mpd-dsh-adapter-plugin/test/no-direct-team-access.test.mjs [--self-test]
//   bun  packages/mpd-dsh-adapter-plugin/test/no-direct-team-access.test.mjs [--self-test]
//
// Under `bun test` the two functions below are registered as ordinary test cases, so the
// gate also guards the adapter package's own suite.
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"

/** The two literal identifiers this gate owns (adaptation plan §4, D6). */
export const FORBIDDEN_IDENTIFIERS = ["agentTeams", "startContinuable"]

/** The one package allowed to touch them: the adapter IS the contact surface. */
export const ADAPTER_PACKAGE = "mpd-dsh-adapter-plugin"

/** The scanned band: every other `packages/mpd-*` package's TypeScript sources. */
const BAND_EXTENSION = ".ts"
/** Extensions reported (never failed) when they sit under a scanned package's `src/`. */
const OUT_OF_BAND_EXTENSIONS = [".js", ".mjs", ".cjs", ".jsx", ".tsx", ".mts", ".cts"]

const here = dirname(fileURLToPath(import.meta.url))
/** `<repo>/packages/mpd-dsh-adapter-plugin/test` -> `<repo>`. */
export const REPO_ROOT = resolve(here, "..", "..", "..")

/**
 * Blank out comments while preserving BOTH the character count and every newline, so a
 * finding keeps the original line number. String and template literals are copied
 * verbatim (their content is code-shaped: `ctx.get("agentTeams")` must still match).
 *
 * Declared bound: a regular expression whose body contains `//` can swallow the rest of
 * its line. That direction is a false NEGATIVE on one line, never a false positive.
 */
export function stripComments(source) {
  let out = ""
  let inBlock = false
  let quote = ""
  for (let at = 0; at < source.length; at += 1) {
    const ch = source[at]
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

/** Every file under `dir` (recursive); `[]` when the directory does not exist. */
function walkFiles(dir) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const files = []
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...walkFiles(full))
    else if (entry.isFile()) files.push(full)
  }
  return files
}

/** The `src/` roots of every `packages/mpd-*` package except the adapter, sorted by name. */
function scannedPackageRoots(repoRoot) {
  const packagesDir = join(repoRoot, "packages")
  let entries
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

/**
 * Scan one repository root.
 *
 * @returns `{{ findings, outOfBand, packages, files }}` — `findings` are the violations
 *   (each `{file, line, identifier, text}` with `file` relative to `repoRoot`), and
 *   `outOfBand` are the NOT COVERED hits that never fail the run.
 */
export function scanDirectTeamAccess(repoRoot = REPO_ROOT) {
  const findings = []
  const outOfBand = []
  const roots = scannedPackageRoots(repoRoot)
  let files = 0
  for (const srcRoot of roots) {
    for (const file of walkFiles(srcRoot)) {
      const extension = file.slice(file.lastIndexOf("."))
      const relPath = relative(repoRoot, file).split(sep).join("/")
      let source
      try {
        source = readFileSync(file, "utf8")
      } catch {
        continue
      }
      if (extension !== BAND_EXTENSION) {
        const lines = source.split("\n")
        lines.forEach((text, index) => {
          for (const identifier of FORBIDDEN_IDENTIFIERS) {
            if (new RegExp(`\\b${identifier}\\b`).test(text)) {
              outOfBand.push({ file: relPath, line: index + 1, identifier, text: text.trim() })
            }
          }
        })
        continue
      }
      files += 1
      const original = source.split("\n")
      const stripped = stripComments(source).split("\n")
      for (let index = 0; index < stripped.length; index += 1) {
        for (const identifier of FORBIDDEN_IDENTIFIERS) {
          if (new RegExp(`\\b${identifier}\\b`).test(stripped[index])) {
            findings.push({
              file: relPath,
              line: index + 1,
              identifier,
              text: (original[index] ?? "").trim(),
            })
          }
        }
      }
    }
  }
  return { findings, outOfBand, packages: roots.length, files }
}

/** `true` when `child` sits under `parent` (both absolute). */
function isUnder(parent, child) {
  const rel = relative(parent, child)
  return rel !== "" && !rel.startsWith("..") && !rel.startsWith(sep) && resolve(parent, rel) === resolve(child)
}

/**
 * The negative control: seed a fixture tree with the SAME shapes the real band can carry
 * and assert the scanner reddens where it must and stays silent where it must not.
 *
 * @returns `{{ ok, checks, tempRoot, findings, outOfBand }}`; `checks` is a list of
 *   `{name, ok, detail}` so a caller can print exactly which arm failed.
 */
export function selfTest() {
  let tempRoot
  let checks
  try {
    try {
      tempRoot = mkdtempSync(join(tmpdir(), "no-direct-team-access-"))
    } catch {
      // The file sandbox can deny the platform temp area; a repository-local scratch dir
      // keeps the self-test runnable there (it is removed in the `finally` below).
      const localRoot = join(here, ".tmp-no-direct-team-access")
      mkdirSync(localRoot, { recursive: true })
      tempRoot = mkdtempSync(join(localRoot, "run-"))
    }
    const write = (relPath, text) => {
      const full = join(tempRoot, relPath)
      mkdirSync(dirname(full), { recursive: true })
      writeFileSync(full, text, "utf8")
    }

    // 1. Two seeded violations: one at the fixture root, one nested (recursion arm).
    write("packages/mpd-fixture/src/index.ts", [
      "// a fixture plugin that reaches the team service directly",
      "export function apply(ctx) {",
      "  const teams = ctx.agentTeams",
      "  return teams",
      "}",
      "",
    ].join("\n"))
    write("packages/mpd-fixture/src/nested/deep.ts", [
      "export async function spawn(ctx, spec) {",
      "  return ctx.subagents.startContinuable(spec)",
      "}",
      "",
    ].join("\n"))
    // 2. A COMMENT mentioning both identifiers must NOT be a finding.
    write("packages/mpd-fixture/src/commented.ts", [
      "// This plugin must NEVER read ctx.agentTeams or call",
      "// ctx.subagents.startContinuable: the adapter owns both seams.",
      "export const clean = true",
      "",
    ].join("\n"))
    // 3. The string spelling of the same violation MUST be a finding.
    write("packages/mpd-fixture/src/string-form.ts", 'export const teams = (ctx) => ctx.get("agentTeams")\n')
    // 4. The adapter package is the ONE sanctioned route, and a non-mpd package is out of band.
    write(`packages/${ADAPTER_PACKAGE}/src/index.ts`, "export const service = (ctx) => ctx.get(\"agentTeams\")\n")
    write("packages/not-mpd/src/index.ts", "export const teams = (ctx) => ctx.agentTeams\n")
    // 5. A non-`.ts` file under a scanned package's src is REPORTED but never a failure.
    write("packages/mpd-fixture/src/legacy.js", "const agentTeams = require(\"some-vendored-team-plugin\")\n")

    const result = scanDirectTeamAccess(tempRoot)
    const found = (file, line, identifier) => result.findings.some(
      (finding) => finding.file === file && finding.line === line && finding.identifier === identifier,
    )

    checks = [
      {
        name: "seeded violation at packages/mpd-fixture/src/index.ts:3",
        ok: found("packages/mpd-fixture/src/index.ts", 3, "agentTeams"),
        detail: "ctx.agentTeams must redden",
      },
      {
        name: "seeded violation in a NESTED file (recursion)",
        ok: found("packages/mpd-fixture/src/nested/deep.ts", 2, "startContinuable"),
        detail: "ctx.subagents.startContinuable must redden",
      },
      {
        name: "the STRING spelling ctx.get(\"agentTeams\") reddens too",
        ok: found("packages/mpd-fixture/src/string-form.ts", 1, "agentTeams"),
        detail: "a renamed spelling must not escape the gate",
      },
      {
        name: "a COMMENT mentioning both identifiers is NOT a finding",
        ok: !result.findings.some((finding) => finding.file === "packages/mpd-fixture/src/commented.ts"),
        detail: "documentation about the rule is not a violation of it",
      },
      {
        name: "the adapter package is excluded",
        ok: !result.findings.some((finding) => finding.file.includes(ADAPTER_PACKAGE)),
        detail: `${ADAPTER_PACKAGE} IS the sanctioned route`,
      },
      {
        name: "a non-mpd package is outside the band",
        ok: !result.findings.some((finding) => finding.file.startsWith("packages/not-mpd/")),
        detail: "only packages/mpd-* is scanned",
      },
      {
        name: "exactly the three seeded findings are reported",
        ok: result.findings.length === 3,
        detail: `got ${result.findings.length}: ${result.findings.map((finding) => `${finding.file}:${finding.line}`).join(", ")}`,
      },
      {
        // The exit code is what a CI lane reads, so the reddening path is asserted end to
        // end (report() is given a no-op sink: the self-test's own output stays clean).
        name: "a finding turns into a NONZERO exit code, a clean scan into zero",
        ok: report(result, () => {}) === 1 && report(scanDirectTeamAccess(tempRoot), () => {}) === 1
          && report({ findings: [], outOfBand: [], packages: 0, files: 0 }, () => {}) === 0,
        detail: "the gate must redden, not merely print",
      },
      {
        name: "an out-of-band .js hit is REPORTED as NOT COVERED, never as a failure",
        ok: result.outOfBand.some((hit) => hit.file === "packages/mpd-fixture/src/legacy.js" && hit.line === 1)
          && !result.findings.some((finding) => finding.file.endsWith(".js")),
        detail: "the blind spot is named, not silent",
      },
      {
        name: "the fixture walker actually read the seeded band",
        // ONE scanned package root: the fixture, because the adapter package is excluded
        // by name and `not-mpd` is outside the `mpd-*` band. FOUR .ts files; `legacy.js`
        // is out of band and is counted under NOT COVERED instead.
        ok: result.packages === 1 && result.files === 4,
        detail: `packages=${result.packages} files=${result.files}`,
      },
    ]
    return {
      ok: checks.every((check) => check.ok),
      checks,
      tempRoot,
      findings: result.findings,
      outOfBand: result.outOfBand,
    }
  } finally {
    if (tempRoot !== undefined) {
      try {
        rmSync(tempRoot, { recursive: true, force: true })
      } catch {
        // A leftover scratch dir is noise, never a self-test failure.
      }
      // Remove the sandbox fallback parent when it is empty (it is only ever a scratch root).
      const localRoot = join(here, ".tmp-no-direct-team-access")
      if (isUnder(here, localRoot)) {
        try {
          rmSync(localRoot, { recursive: true, force: true })
        } catch {
          // Ditto.
        }
      }
    }
  }
}

/** One stable, greppable report line per finding. */
function findingLine(finding) {
  return `  ${finding.file}:${finding.line}: ${finding.identifier} — ${finding.text}`
}

/** Print the full report and return the process exit code (0 = clean). */
export function report(result, stream = console.log) {
  stream("NO-DIRECT-TEAM-ACCESS — D6 static gate (docs/plan-0.1.7-adaptation.md §4)")
  stream(`band: packages/mpd-*/src/**/*${BAND_EXTENSION}, minus packages/${ADAPTER_PACKAGE} (the ONE sanctioned route)`)
  stream(`scanned: ${result.packages} package(s), ${result.files} ${BAND_EXTENSION} file(s)`)
  if (result.outOfBand.length > 0) {
    stream(`NOT COVERED (declared out of band, never a failure) — ${result.outOfBand.length} hit(s):`)
    for (const hit of result.outOfBand) stream(findingLine(hit))
  }
  if (result.findings.length === 0) {
    stream("RESULT: PASS (0 findings)")
    return 0
  }
  stream(`RESULT: FAIL (${result.findings.length} finding(s)) — every mpd plugin must reach the team service through mpd-dsh-adapter:`)
  for (const finding of result.findings) stream(findingLine(finding))
  return 1
}

/** The `--self-test` banner: one line per arm, then the verdict. */
function reportSelfTest(result, stream = console.log) {
  stream("SELF-TEST — no-direct-team-access (negative control over a seeded fixture tree)")
  for (const check of result.checks) stream(`  ${check.ok ? "ok  " : "FAIL"} ${check.name}${check.ok ? "" : ` — ${check.detail}`}`)
  const passed = result.checks.filter((check) => check.ok).length
  stream(`SELF-TEST: ${result.ok ? "PASS" : "FAIL"} (${passed}/${result.checks.length} checks)`)
  return result.ok ? 0 : 1
}

async function main(argv, stream = console.log) {
  if (argv.includes("--self-test")) {
    const result = selfTest()
    // The self-test is the negative control: it must NOT depend on the repository's own
    // state, or a real violation would hide behind a failing control.
    return reportSelfTest(result, stream)
  }
  return report(scanDirectTeamAccess(REPO_ROOT), stream)
}

// ── the bun:test arm ────────────────────────────────────────────────────────────────
// `node` cannot resolve `bun:test` at all, and MEASURED with bun 1.4.0 a plain
// `bun <this file>` resolves the module but REJECTS `test(...)` with "Cannot use test
// outside of the test runner" (registration throws, the process would die before the CLI
// ran). Both cases therefore fall through to the CLI below; only `bun test` registers,
// which is what makes this gate part of the adapter package's own suite as well.
try {
  const { expect, test } = await import("bun:test")
  test("no direct Agent Teams access outside the adapter (D6)", () => {
    const result = scanDirectTeamAccess(REPO_ROOT)
    report(result)
    expect(result.findings).toEqual([])
  })
  test("the gate reddens on a seeded violation (negative control)", () => {
    const result = selfTest()
    reportSelfTest(result)
    expect(result.ok).toBe(true)
  })
} catch {
  // Not under the bun test runner (or not bun at all): the CLI is the whole surface.
}

if (import.meta.main) {
  const code = await main(process.argv.slice(2))
  if (code !== 0) process.exitCode = code
}
