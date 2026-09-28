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
// Used by scripts/check-citations.ts (T-53's named checker; its DURABLE home since t16 — the frozen
// evidence/extensions/docs-claims/check-citations.mjs is superseded beside itself) and
// evidence/extensions/debranding-probe/<ts>/verify-debranding-full.mjs.
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"

/** The exit code every refusal carries, so a driver's caller can tell it from a crash. */
export const IMMUTABLE_EXIT_CODE: number = 3

/** The error a refusal throws: it carries the process exit code the caller must use. */
export class ImmutableOutputError extends Error {
  /** The exit code the driver exits with; always `IMMUTABLE_EXIT_CODE`. */
  readonly exitCode: number

  /**
   * @param message The refusal sentence, naming the blocked target and the remedy.
   */
  constructor(message: string) {
    super(message)
    this.name = "ImmutableOutputError"
    this.exitCode = IMMUTABLE_EXIT_CODE
  }
}

/** Optional knobs of `refuseOverwrite`. */
export interface RefuseOverwriteOptions {
  /** What kind of artifact is being written, named in the refusal sentence. */
  readonly label?: string
  /** The remedy appended to the refusal sentence. */
  readonly remedy?: string
}

/** Optional knobs of `writeImmutable`. */
export interface WriteImmutableOptions {
  /** What kind of artifact is being written, named in any refusal. */
  readonly label?: string
}

/**
 * Filesystem-safe UTC stamp, the same shape the QA lanes use for evidence dirs.
 * @param date The instant to stamp.
 * @returns The ISO instant with every `:` replaced by `-`.
 */
export function timestamp(date: Date = new Date()): string {
  return date.toISOString().replaceAll(":", "-")
}

/**
 * Refuse an existing target. Returns the target unchanged when it is safe to write.
 * @param target The absolute path the caller intends to write.
 * @param options The label and remedy used in the refusal sentence.
 * @returns The target, unchanged, when it does not exist yet.
 * @throws An `ImmutableOutputError` when the target already exists.
 */
export function refuseOverwrite(target: string, { label = "output", remedy = "pass an explicit new target" }: RefuseOverwriteOptions = {}): string {
  if (existsSync(target)) {
    throw new ImmutableOutputError(
      "refusing to overwrite the existing " + label + ": " + target +
      " — evidence is immutable by default (T-53); " + remedy,
    )
  }
  return target
}

/**
 * Resolve the output directory a run must write into.
 * @param explicit A caller-named target; wins when it is a non-empty string.
 * @param baseDir The base directory a timestamped default is derived from.
 * @param slug The run's slug, used in the default directory name.
 * @returns Absolute path of the explicit target, or `<baseDir>/runs/<slug>-<ts>`.
 */
export function resolveOutputDir(explicit: string | undefined, baseDir: string, slug: string): string {
  if (explicit) return resolve(explicit)
  return join(baseDir, "runs", slug + "-" + timestamp())
}

/**
 * Write only to a path that does not exist yet (parents created).
 * @param target The absolute path to write.
 * @param contents The bytes to write.
 * @param options The label used in any refusal.
 * @returns The path that was written.
 * @throws An `ImmutableOutputError` when the target already exists.
 */
export function writeImmutable(target: string, contents: string | Uint8Array, { label = "evidence file" }: WriteImmutableOptions = {}): string {
  refuseOverwrite(target, { label })
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, contents)
  return target
}

/**
 * Print an ImmutableOutputError and exit with its code; rethrow anything else.
 * @param error The caught value; only an `ImmutableOutputError` is consumed.
 * @param prefix The banner prepended to the refusal sentence.
 * @throws The original value when it is not an `ImmutableOutputError`.
 */
export function exitOnRefusal(error: unknown, prefix: string): never {
  if (error instanceof ImmutableOutputError) {
    console.error(prefix + " " + error.message)
    process.exit(error.exitCode)
  }
  throw error
}

/** The offline self-test: refusal, fresh-path acceptance and the timestamped default. */
function selfTest(): void {
  /** The assertion labels that failed, printed together so one run reports every break. */
  const failures: string[] = []
  // The fixture root every path below lives under.
  const dir = mkdtempSync(join(tmpdir(), "mpd-immutable-selftest-"))
  // The pre-existing target the refusal arm must reject.
  const existing = join(dir, "already-there.json")
  writeFileSync(existing, "{}\n")
  // Whether the refusal arm really threw an `ImmutableOutputError` with the documented code.
  let refused = false
  try {
    refuseOverwrite(existing, { label: "fixture report" })
  } catch (error) {
    refused = error instanceof ImmutableOutputError && error.exitCode === IMMUTABLE_EXIT_CODE && error.message.includes("fixture report")
  }
  if (!refused) failures.push("an existing target must be refused with the label and the exit code")
  // A path that does not exist yet, which the acceptance arm must return unchanged.
  const fresh = join(dir, "fresh.json")
  if (refuseOverwrite(fresh) !== fresh) failures.push("a fresh target must be returned unchanged")
  // The nested target the writer must create parents for.
  const written = writeImmutable(join(dir, "nested", "out.log"), "ok\n")
  if (!existsSync(written)) failures.push("writeImmutable must create parents and write")
  // Whether a second write to the same path is refused.
  let secondRefused = false
  try {
    writeImmutable(written, "again\n")
  } catch (error) {
    secondRefused = error instanceof ImmutableOutputError
  }
  if (!secondRefused) failures.push("a second write to the same path must be refused")
  // The timestamped default directory a caller that names no target receives.
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

// The `.ts` name is this module's on-disk name after the wave's conversion, so the entry-module
// guard tests for it rather than for the retired `.mjs` spelling.
if (process.argv[1] && process.argv[1].endsWith("immutable-output.ts") && process.argv.includes("--self-test")) selfTest()
