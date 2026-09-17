#!/usr/bin/env node
// T-53: evidence output paths are IMMUTABLE BY DEFAULT.
//
// A plain run of an evidence driver used to rewrite the SAME canonical artifact every time
// (`result.json`/`output.log` next to the script, a `probe-report.json` inside the script's own
// directory), so a re-run silently replaced another task's record. The rule implemented here:
//
//   * a caller that names an EXPLICIT target keeps it — but a target that already EXISTS is REFUSED
//     (never overwritten), with the remedy in the message;
//   * a caller that names NO target gets a FRESH timestamped path, so a plain run can never land on
//     a canonical artifact by accident;
//   * refusing is an error, not a warning: the caller exits non-zero (IMMUTABLE_EXIT_CODE).
//
// Used by evidence/extensions/docs-claims/check-citations.mjs and
// evidence/extensions/debranding-probe/<ts>/verify-debranding-full.mjs (T-53's named drivers).
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"

export const IMMUTABLE_EXIT_CODE = 3

export class ImmutableOutputError extends Error {
  constructor(message) {
    super(message)
    this.name = "ImmutableOutputError"
    this.exitCode = IMMUTABLE_EXIT_CODE
  }
}

/** Filesystem-safe UTC stamp, the same shape the QA lanes use for evidence dirs. */
export function timestamp(date = new Date()) {
  return date.toISOString().replaceAll(":", "-")
}

/** Refuse an existing target. Returns the target unchanged when it is safe to write. */
export function refuseOverwrite(target, { label = "output", remedy = "pass an explicit new target" } = {}) {
  if (existsSync(target)) {
    throw new ImmutableOutputError(
      "refusing to overwrite the existing " + label + ": " + target +
      " — evidence is immutable by default (T-53); " + remedy,
    )
  }
  return target
}

/** Explicit target wins; otherwise `<baseDir>/runs/<slug>-<ts>` — a path that cannot exist yet. */
export function resolveOutputDir(explicit, baseDir, slug) {
  if (explicit) return resolve(explicit)
  return join(baseDir, "runs", slug + "-" + timestamp())
}

/** Write only to a path that does not exist yet (parents created). */
export function writeImmutable(target, contents, { label = "evidence file" } = {}) {
  refuseOverwrite(target, { label })
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, contents)
  return target
}

/** Print an ImmutableOutputError and exit with its code; rethrow anything else. */
export function exitOnRefusal(error, prefix) {
  if (error instanceof ImmutableOutputError) {
    console.error(prefix + " " + error.message)
    process.exit(error.exitCode)
  }
  throw error
}

function selfTest() {
  const failures = []
  const dir = mkdtempSync(join(tmpdir(), "mpd-immutable-selftest-"))
  const existing = join(dir, "already-there.json")
  writeFileSync(existing, "{}\n")
  let refused = false
  try {
    refuseOverwrite(existing, { label: "fixture report" })
  } catch (error) {
    refused = error instanceof ImmutableOutputError && error.exitCode === IMMUTABLE_EXIT_CODE && error.message.includes("fixture report")
  }
  if (!refused) failures.push("an existing target must be refused with the label and the exit code")
  const fresh = join(dir, "fresh.json")
  if (refuseOverwrite(fresh) !== fresh) failures.push("a fresh target must be returned unchanged")
  const written = writeImmutable(join(dir, "nested", "out.log"), "ok\n")
  if (!existsSync(written)) failures.push("writeImmutable must create parents and write")
  let secondRefused = false
  try {
    writeImmutable(written, "again\n")
  } catch (error) {
    secondRefused = error instanceof ImmutableOutputError
  }
  if (!secondRefused) failures.push("a second write to the same path must be refused")
  const autoDir = resolveOutputDir(undefined, dir, "probe")
  if (!autoDir.startsWith(join(dir, "runs") + "/probe-")) failures.push("the default dir must be a fresh `<base>/runs/<slug>-<ts>` path: " + autoDir)
  if (existsSync(autoDir)) failures.push("the default dir must not exist before the run")
  if (resolveOutputDir(join(dir, "explicit"), dir, "probe") !== resolve(dir, "explicit")) failures.push("an explicit dir must win")
  rmSync(dir, { recursive: true, force: true })
  if (failures.length > 0) {
    console.error("[immutable-output self-test] FAIL:")
    for (const failure of failures) console.error("  - " + failure)
    process.exit(1)
  }
  console.log("[immutable-output self-test] ok: existing targets refused (exit " + IMMUTABLE_EXIT_CODE + "), fresh paths allowed, defaults are timestamped and cannot collide")
}

if (process.argv[1] && process.argv[1].endsWith("immutable-output.mjs") && process.argv.includes("--self-test")) selfTest()
