#!/usr/bin/env node
// The cross-platform `test:qa` / `test:qa:strict` sweep — one `--self-test` pass per QA case.
//
// Why this file exists (Windows fix): both package scripts used to be a POSIX-only
// `for f in skills/dsh-qa/scripts/*.mjs; do … done` loop. `bun run` executes a package script
// with the PLATFORM shell, so on Windows the body reaches cmd.exe as plain commands — measured:
// `bun: command not found: for` (plus one line each for `do` and `done`) and exit 1. The gate the
// manual names for "every plugin/QA-script change" could therefore not run at all on Windows.
//
// It is also the same defect shape `scripts/run-qa-lanes.ts` was written to kill (T-32: an inline
// loop `exit 1`-ed on the FIRST failing case, so case 1 of N hid the other N-1). This runner keeps
// the old commands, order and exit codes, and reports EVERY failing case instead of only the first.
//
// Usage:
//   node scripts/run-qa-selftests.ts             # == `bun run test:qa`
//   node scripts/run-qa-selftests.ts --strict    # == `bun run test:qa:strict` (`--no-skip`)
//   node scripts/run-qa-selftests.ts --root <dir>
//
// Exit codes: 0 no failures (non-strict runs may report SKIP) · 1 failure, strict SKIP or no cases.
import { spawnSync } from "node:child_process"
import { readdirSync } from "node:fs"
import type { Dirent } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

/** The directory holding this runner; its parent is the default sweep root. */
const HERE = dirname(fileURLToPath(import.meta.url))
/** The root-relative directory the QA cases live in. */
const CASE_DIR = "skills/dsh-qa/scripts"
/** This process's arguments, without the node executable and script path. */
const argv = process.argv.slice(2)
/** Result type used by the sweep and the marker controls. */
type CaseOutcome = "pass" | "skip" | "fail"

/** Grade a case from its exit status and first stdout line, per the QA marker contract. */
function caseOutcome(status: number | null, stdout: string, strict: boolean): CaseOutcome {
  if (status !== 0) return "fail"
  /** The prerequisite marker must head stdout, independently of stderr diagnostics. */
  const firstLine = stdout.split(/\r?\n/, 1)[0]
  if (firstLine.startsWith("[mpd-qa] FAIL ")) return "fail"
  if (firstLine.startsWith("[mpd-qa] SKIP ")) return strict ? "fail" : "skip"
  return "pass"
}

if (argv.includes("--self-test")) {
  /** A fixture using the same first-line format the cases emit. */
  const skip = '[mpd-qa] SKIP case=fixture lane=self-test reason=absent-fixture prereq=probe remedy="-"'
  if (caseOutcome(0, "case passed\n", false) !== "pass" ||
      caseOutcome(0, `${skip}\n`, false) !== "skip" ||
      caseOutcome(0, `${skip}\n`, true) !== "fail" ||
      caseOutcome(1, `${skip}\n`, false) !== "fail" ||
      caseOutcome(0, skip.replace(" SKIP ", " FAIL "), false) !== "fail") process.exit(1)
  console.log("PASS: clean, skip, strict skip, nonzero skip and inconsistent failure marker")
  process.exit(0)
}

/** The `--root` flag's index, or -1 when it was not given. */
const rootFlag = argv.indexOf("--root")
/** The sweep root: the `--root` value when given, else this script's parent (the repository root). */
const ROOT = resolve(rootFlag >= 0 ? (argv[rootFlag + 1] ?? ".") : join(HERE, ".."))
/** True when the strict lane was requested; it only changes the label and the case flags. */
const STRICT = argv.includes("--strict")
/** The label every line of this run is prefixed with — the package script this sweep mirrors. */
const LABEL = STRICT ? "test:qa:strict" : "test:qa"
// The strict lane is the same sweep with the suite's no-skip flag first; the case's own flags are
// never substituted. `test:qa` additionally runs the two mpd-ext checks that always sat after the
// loop (the strict lane, like the shell line it replaces, does not).
/** The flags appended to every discovered case's own path. */
const CASE_ARGS: string[] = STRICT ? ["--self-test", "--no-skip"] : ["--self-test"]
/** The mpd-ext commands that run after the case loop; the validate row exists on the non-strict lane only. */
const MPD_EXT: string[][] = [["scripts/mpd-ext.ts", "--self-test"]]
if (!STRICT) MPD_EXT.push(["scripts/mpd-ext.ts", "validate", "extensions/mpd-ext-example"])

/** Prints one line under this run's label. */
const say = (line: string): void => console.log("[" + LABEL + "] " + line)

/** The discovered case file names, sorted; empty until discovery succeeds. */
let cases: string[] = []
try {
  // Discovery enumerates the `.ts` cases the wave converted; a `.mjs` left in the directory (a
  // generated fixture, a stray copy) is NOT a case any more and must not be spawned.
  cases = readdirSync(join(ROOT, CASE_DIR), { withFileTypes: true })
    .filter((entry: Dirent): boolean => entry.isFile() && entry.name.endsWith(".ts"))
    .map((entry: Dirent): string => entry.name)
    .sort()
} catch (error) {
  console.error("[" + LABEL + "] FAILED: cannot read " + join(ROOT, CASE_DIR) + ": " + (error instanceof Error ? error.message : String(error)))
  process.exit(1)
}
if (cases.length === 0) {
  console.error("[" + LABEL + "] FAILED: zero cases discovered under " + CASE_DIR + " — refusing to report a vacuous PASS")
  process.exit(1)
}

/** One case that did not pass, kept so the run can report every failure instead of the first. */
interface CaseFailure {
  /** The case label as printed — a case file name or the joined mpd-ext command. */
  readonly label: string
  /** Why it failed: the spawn error message, or the child's exit code. */
  readonly note: string
}

/** Every failure collected by this run, in run order. */
const failures: CaseFailure[] = []
/** Number of exit-zero cases with a prerequisite skip marker. */
let skipped = 0
/** Runs one case through `bun` and preserves the child's stdout marker in the transcript. */
const runCase = (label: string, argv2: readonly string[]): void => {
  say(label)
  /** Capture stdout separately to classify its first line while keeping stderr live. */
  const result = spawnSync("bun", argv2, { cwd: ROOT, stdio: ["ignore", "pipe", "inherit"], encoding: "utf8", maxBuffer: 32 * 1024 * 1024 })
  /** The child's original stdout, which may be absent after a spawn failure. */
  const stdout = result.stdout ?? ""
  process.stdout.write(stdout)
  if (result.error) {
    failures.push({ label, note: result.error.message })
    return
  }
  switch (caseOutcome(result.status, stdout, STRICT)) {
    case "pass": break
    case "skip": skipped += 1; break
    case "fail":
      failures.push({ label, note: result.status === 0 ? stdout.split(/\r?\n/, 1)[0] : `exit ${result.status ?? result.signal}` })
      break
  }
}

// Every discovered case runs first, in sorted order, then the mpd-ext rows — the same order the
// replaced shell loop used.
for (const name of cases) runCase(name, [join(CASE_DIR, name), ...CASE_ARGS])
for (const argv2 of MPD_EXT) runCase(argv2.join(" "), argv2)

/** The number of subjects this run was supposed to execute: every case plus every mpd-ext row. */
const total = cases.length + MPD_EXT.length
for (const failure of failures) say("FAILED: " + failure.label + " (" + failure.note + ")")
/** The mutually exclusive pass, skip and fail census, including strict-mode failures. */
const passed = total - skipped - failures.length
say(`${failures.length > 0 ? "FAIL" : skipped > 0 ? "COMPLETE WITH SKIPS" : "PASS"} - ${passed} passed, ${skipped} skipped, ${failures.length} failed (${total} total)`)
process.exitCode = failures.length > 0 ? 1 : 0
