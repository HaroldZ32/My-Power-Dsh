#!/usr/bin/env node
// The cross-platform `test:qa` / `test:qa:strict` sweep — one `--self-test` pass per QA case.
//
// Why this file exists (Windows fix): both package scripts used to be a POSIX-only
// `for f in skills/dsh-qa/scripts/*.mjs; do … done` loop. `bun run` executes a package script
// with the PLATFORM shell, so on Windows the body reaches cmd.exe as plain commands — measured:
// `bun: command not found: for` (plus one line each for `do` and `done`) and exit 1. The gate the
// manual names for "every plugin/QA-script change" could therefore not run at all on Windows.
//
// It is also the same defect shape `scripts/run-qa-lanes.mjs` was written to kill (T-32: an inline
// loop `exit 1`-ed on the FIRST failing case, so case 1 of N hid the other N-1). This runner keeps
// the old commands, order and exit codes, and reports EVERY failing case instead of only the first.
//
// Usage:
//   node scripts/run-qa-selftests.mjs             # == `bun run test:qa`
//   node scripts/run-qa-selftests.mjs --strict    # == `bun run test:qa:strict` (`--no-skip`)
//   node scripts/run-qa-selftests.mjs --root <dir>
//
// Exit codes: 0 every case passed · 1 at least one case failed or discovery found nothing.
import { spawnSync } from "node:child_process"
import { readdirSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const CASE_DIR = "skills/dsh-qa/scripts"
const argv = process.argv.slice(2)
const rootFlag = argv.indexOf("--root")
const ROOT = resolve(rootFlag >= 0 ? (argv[rootFlag + 1] ?? ".") : join(HERE, ".."))
const STRICT = argv.includes("--strict")
const LABEL = STRICT ? "test:qa:strict" : "test:qa"
// The strict lane is the same sweep with the suite's no-skip flag first; the case's own flags are
// never substituted. `test:qa` additionally runs the two mpd-ext checks that always sat after the
// loop (the strict lane, like the shell line it replaces, does not).
const CASE_ARGS = STRICT ? ["--self-test", "--no-skip"] : ["--self-test"]
const MPD_EXT = [["scripts/mpd-ext.mjs", "--self-test"]]
if (!STRICT) MPD_EXT.push(["scripts/mpd-ext.mjs", "validate", "extensions/mpd-ext-example"])

const say = (line) => console.log("[" + LABEL + "] " + line)

let cases = []
try {
  cases = readdirSync(join(ROOT, CASE_DIR), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".mjs"))
    .map((entry) => entry.name)
    .sort()
} catch (error) {
  console.error("[" + LABEL + "] FAILED: cannot read " + join(ROOT, CASE_DIR) + ": " + String(error?.message ?? error))
  process.exit(1)
}
if (cases.length === 0) {
  console.error("[" + LABEL + "] FAILED: zero cases discovered under " + CASE_DIR + " — refusing to report a vacuous PASS")
  process.exit(1)
}

const failures = []
const runCase = (label, argv2) => {
  say(label)
  const result = spawnSync("bun", argv2, { cwd: ROOT, stdio: "inherit" })
  if (result.error) failures.push({ label, note: String(result.error.message ?? result.error) })
  else if ((result.status ?? 1) !== 0) failures.push({ label, note: "exit " + String(result.status) })
}

for (const name of cases) runCase(name, [join(CASE_DIR, name), ...CASE_ARGS])
for (const argv2 of MPD_EXT) runCase(argv2.join(" "), argv2)

const total = cases.length + MPD_EXT.length
if (failures.length > 0) {
  for (const failure of failures) say("FAILED: " + failure.label + " (" + failure.note + ")")
  console.error("[" + LABEL + "] FAIL - " + failures.length + " of " + total + " case(s) failed")
  process.exit(1)
}
say("all self-tests passed" + (STRICT ? " with no skips" : ""))
