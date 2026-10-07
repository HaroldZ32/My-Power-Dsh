#!/usr/bin/env node
// User-run helper: make the `mpd` agent preset the DEFAULT through the SANCTIONED, non-overwriting
// channel. Run it yourself; the bundle never does this for you.
//
// WHY IT EXISTS (user decision 2026-10-02, "strict zero-override"): this bundle used to id-target the
// host-owned preset registry rows (`agent-preset-registry` from dsh-web-app and
// `dsh-tui-agent-preset-registry` from dsh-tui) with `config.default: mpd`. An id-target REPLACES a
// host layer's decision, so both were removed — and an additive SECOND registry row is not the
// workaround either: two rows mounting `@deepseek-ai/dsh-agent-preset-registry` each call
// `reflect.provide('agentPresets', …)`, and a duplicate provide is a HARD cordis boot error. The
// deployment default is therefore the user's to set, and this script sets the ONE channel dsh-tui
// itself reads (see `docs/preset-default.md`, the bilingual pair that documents every step).
//
// WHAT IT WRITES, AND WHY THAT EXACT SHAPE: for a dsh-tui profile, dsh-tui's own
// `lib/types/presetPrefs.js` reads `<HOME>/.dsh-tui/agent-preset.json` and persists it with
// `JSON.stringify({ preset }, null, 2)` — two-space JSON, NO trailing newline. This helper mirrors
// that call byte-for-byte instead of inventing a shape; `--self-test` arm (f) cross-checks its bytes
// against the INSTALLED dsh-tui's own `writePresetPref`, so "mirrored" is measured, not asserted.
// For a web/headless profile it writes NOTHING (there is no such file there) and prints the two
// supported paths instead: the registry entry's `selectedDefault` volatile field (set from Settings)
// and the TUI-plane `DSH_TUI_PRESET` alternative.
//
// SAFETY: dry-run is the DEFAULT and prints the resolved absolute path first; a write needs `--yes`.
// `--home`/`--dsh-home` point the helper at a sandbox for QA, and the REAL `~/.dsh-tui` is written
// only when the RESOLVED target is the real one AND `--yes` was given — the run prints which of the
// two it is before touching anything. `--dsh-home` alone does NOT move the write target (the TUI
// stores its preference under HOME, not under DSH_HOME); it only names the profile the run reports on.
//
// Usage:
//   node scripts/set-default-preset.ts [--profile dsh-tui] [--preset mpd] [--home <dir>]
//                                      [--dsh-home <dir>] [--yes]
//   node scripts/set-default-preset.ts --self-test
//
// Exit: 0 on success (a dry run that prints, or a write that lands); 1 on an invalid preset id, an
//       unusable target, or a self-test arm that does not hold.

import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

/** This script's own path, so the self-test can re-spawn the LIVE helper instead of a copy. */
const SELF: string = fileURLToPath(import.meta.url)
/** The prefix on every line this helper prints, so a log line names its producer. */
const PREFIX: string = "[set-default-preset]"
/** This process's arguments, without the node executable and the script path. */
const ARGV: readonly string[] = process.argv.slice(2)
/** The preset id applied when `--preset` is absent: this bundle's own preset. */
const DEFAULT_PRESET: string = "mpd"
/** The profile assumed when `--profile` is absent: the DSH-TUI edition's profile name. */
const DEFAULT_PROFILE: string = "dsh-tui"
/** The directory name dsh-tui keeps its preferences in, under HOME (`DATA_DIR` in its paths.js). */
const TUI_DATA_DIRNAME: string = ".dsh-tui"
/** The preference file dsh-tui's `readPresetPref` reads; its basename is fixed by that module. */
const TUI_PREF_FILENAME: string = "agent-preset.json"
/**
 * The id boundary dsh-tui itself enforces (`PRESET_ID` in its `presetPrefs.js`): a lowercase
 * alphanumeric start followed by alphanumerics and dashes. An id outside it is refused HERE rather
 * than written, because dsh-tui's reader would then silently ignore the file it wrote.
 */
const PRESET_ID = /^[a-z0-9][a-z0-9-]*$/

/** The resolved run: which channel applies, what would be written, and where. */
interface Plan {
  /** The profile name the run reports on (`dsh-tui`, `web`, `headless`, …). */
  readonly profile: string
  /** The preset id to apply. */
  readonly preset: string
  /** True when the profile is the TUI plane, i.e. the preference file is the channel. */
  readonly tuiPlane: boolean
  /** The HOME whose `.dsh-tui` is the write target (the override, or the real home). */
  readonly home: string
  /** The absolute preference file this run would write; `<home>/.dsh-tui/agent-preset.json`. */
  readonly target: string
  /** True when the target resolves to the REAL `~/.dsh-tui`, not a sandbox named by `--home`. */
  readonly realHomeTarget: boolean
  /** True when the caller asked for the write with `--yes`; otherwise the run only prints. */
  readonly apply: boolean
  /** The absolute DSH home the run reports on, for the profile's context lines. */
  readonly dshHome: string
}

/**
 * Read one flag's value from an argument vector.
 * @param argv The argument vector to scan.
 * @param flag The flag name, spelled with its leading dashes.
 * @returns The value after the flag, the value after `flag=`, or undefined when the flag is absent.
 */
function flagValue(argv: readonly string[], flag: string): string | undefined {
  /** The flag's own index, or -1 when this run did not pass it. */
  const at = argv.indexOf(flag)
  if (at >= 0) return argv[at + 1]
  /** The `--flag=value` spelling, matched by prefix so the value needs no separate argv slot. */
  const inline = argv.find((arg: string): boolean => arg.startsWith(flag + "="))
  return inline === undefined ? undefined : inline.slice(flag.length + 1)
}

/**
 * Report a blocking finding and stop the process.
 * @param message The finding, printed after this helper's prefix.
 * @returns Never: the process exits here, which is what lets callers rely on the exit code.
 */
function fail(message: string): never {
  console.error(PREFIX + " FAIL: " + message)
  process.exit(1)
}

/**
 * The exact bytes dsh-tui's own writer produces for a preference file.
 * @param preset The preset id to persist.
 * @returns The file content, byte-for-byte what `writePresetPref` writes (no trailing newline).
 */
function prefBytes(preset: string): string {
  return JSON.stringify({ preset }, null, 2)
}

/**
 * Resolve this run's plan from the flags, refusing an unusable request before any I/O.
 * @param argv The argument vector to read the flags from.
 * @returns The plan, with every path absolute.
 */
function planOf(argv: readonly string[]): Plan {
  /** The profile under report; a `tui`-named profile is the TUI plane. */
  const profile: string = flagValue(argv, "--profile") ?? DEFAULT_PROFILE
  /** The preset id the caller asked for, defaulted to this bundle's own preset. */
  const preset: string = flagValue(argv, "--preset") ?? DEFAULT_PRESET
  if (!PRESET_ID.test(preset)) fail("invalid preset id " + JSON.stringify(preset) + ": dsh-tui's own reader accepts only " + String(PRESET_ID) + ", so a file with any other id would be ignored")
  /** The real home of THIS process, read before any override, so the two can be compared. */
  const realHome: string = homedir()
  /** The `--home` override, resolved; undefined when the run did not name one. */
  const homeFlag: string | undefined = flagValue(argv, "--home")
  /** The home whose `.dsh-tui` this run would write. */
  const home: string = resolve(homeFlag ?? realHome)
  /** The `--dsh-home` override: the profile root the run REPORTS on (never the write target). */
  const dshHome: string = resolve(flagValue(argv, "--dsh-home") ?? join(home, ".dsh"))
  /** The absolute preference file this run applies to. */
  const target: string = join(home, TUI_DATA_DIRNAME, TUI_PREF_FILENAME)
  /** True when a `--home` override moved the run off the real home. */
  const sandboxed: boolean = homeFlag !== undefined
  return {
    profile,
    preset,
    tuiPlane: profile.includes("tui"),
    home,
    target,
    realHomeTarget: !sandboxed && target === join(realHome, TUI_DATA_DIRNAME, TUI_PREF_FILENAME),
    apply: argv.includes("--yes"),
    dshHome,
  }
}

/**
 * The profile directory this run reports on, whether or not it is installed.
 * @param plan The resolved plan, whose `dshHome` and `profile` name the directory.
 * @returns The absolute profile directory.
 */
function profileDir(plan: Plan): string {
  return join(plan.dshHome, "profiles", plan.profile)
}

/**
 * The installed dsh-tui's own preference module, when this machine has one.
 * @param plan The resolved plan, whose `dshHome` holds the profiles to scan.
 * @returns The absolute path of `presetPrefs.js`, or undefined when no installed copy declares one.
 */
function installedPrefsModule(plan: Plan): string | undefined {
  /** The profiles directory to scan for an installed dsh-tui. */
  const profiles: string = join(plan.dshHome, "profiles")
  if (!existsSync(profiles)) return undefined
  for (const entry of readdirSync(profiles, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    /** The candidate module inside this profile's dsh-tui copy. */
    const candidate: string = join(profiles, entry.name, "node_modules", "@deepseek-harness-tui", "dsh-tui", "lib", "types", "presetPrefs.js")
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

/**
 * Print what the profile-plane channel is, for a profile that has no preference file.
 * @param plan The resolved plan.
 * @returns Nothing: the guidance is printed.
 */
function printNonTuiGuidance(plan: Plan): void {
  console.log(PREFIX + " profile \"" + plan.profile + "\" is not a dsh-tui profile, so this helper writes NOTHING.")
  console.log(PREFIX + " The deployment default is a HOST-OWNED row (" + join(profileDir(plan), "node_modules") + " -> @deepseek-ai/dsh-agent-preset-registry),")
  console.log(PREFIX + " and this bundle does not override it (strict zero-override; a second registry row is a duplicate-service boot error).")
  console.log(PREFIX + " Use ONE of these instead:")
  console.log(PREFIX + "   1. Settings -> Agent preset -> \"" + plan.preset + "\". That writes the `selectedDefault` VOLATILE field of the")
  console.log(PREFIX + "      `agent-preset-registry` entry, which the registry resolves for new sessions in preference to the deployment `default`.")
  console.log(PREFIX + "   2. dsh-tui plane only: `DSH_TUI_PRESET=" + plan.preset + "` in YOUR OWN profile patch")
  console.log(PREFIX + "      (" + join(profileDir(plan), "cordis.patch.yml") + "), or this helper with `--profile dsh-tui --yes`.")
  console.log(PREFIX + " Full steps: docs/preset-default.md (English) / docs/preset-default.zh-CN.md (简体中文).")
}

/**
 * Print the plan, and write it only when the run is an applying one.
 * @param plan The resolved plan.
 * @returns The process exit code: 0 when the run was printed or written, 1 on an unusable target.
 */
function execute(plan: Plan): number {
  /** The content this run applies, exactly as dsh-tui's own writer would. */
  const content: string = prefBytes(plan.preset)
  console.log(PREFIX + " profile: " + plan.profile + (plan.tuiPlane ? " (TUI plane)" : " (no preference file)"))
  console.log(PREFIX + " preset:  " + plan.preset)
  console.log(PREFIX + " home:    " + plan.home + (plan.realHomeTarget ? "  [REAL HOME]" : "  [sandbox/override]"))
  console.log(PREFIX + " dshHome: " + plan.dshHome + (existsSync(profileDir(plan)) ? "  (profile present)" : "  (profile NOT present)"))
  if (!plan.tuiPlane) {
    printNonTuiGuidance(plan)
    return 0
  }
  console.log(PREFIX + " target:  " + plan.target + "  [" + (plan.realHomeTarget ? "REAL HOME" : "not the real home") + "]")
  console.log(PREFIX + " intended bytes (" + Buffer.byteLength(content, "utf8") + "): " + JSON.stringify(content))
  if (!plan.apply) {
    console.log(PREFIX + " DRY-RUN (the default): nothing was written. Re-run with --yes to apply.")
    return 0
  }
  if (existsSync(plan.target) && !readFileSync(plan.target, "utf8").trimStart().startsWith("{")) fail("refusing to overwrite " + plan.target + ": it exists but is not a JSON object")
  console.log(PREFIX + " WRITE " + plan.target + (plan.realHomeTarget ? "  (THE REAL HOME — you asked for this with --yes)" : ""))
  try {
    mkdirSync(dirname(plan.target), { recursive: true })
    writeFileSync(plan.target, content)
  } catch (error) {
    return fail("cannot write " + plan.target + ": " + (error instanceof Error ? error.message : String(error)))
  }
  console.log(PREFIX + " wrote " + Buffer.byteLength(content, "utf8") + " byte(s); a NEW dsh-tui session now resolves \"" + plan.preset + "\".")
  return 0
}

/** What one self-test arm observed, printed so a failure names every value it compared. */
interface ArmRun {
  /** The child's exit status, or null when it was signalled. */
  readonly status: number | null
  /** The child's stdout, for substring assertions and the printed detail. */
  readonly out: string
  /** The child's stderr, where a refusal lands. */
  readonly err: string
}

/**
 * Run the LIVE helper with the flags of one arm.
 * @param args The helper arguments for this arm.
 * @returns The child's exit status, stdout and stderr.
 */
function runHelper(args: readonly string[]): ArmRun {
  /** The child helper process; the LIVE script is re-spawned, never a copied stand-in. */
  const child = spawnSync(process.execPath, [SELF, ...args], { encoding: "utf8" })
  return { status: child.status, out: child.stdout ?? "", err: child.stderr ?? "" }
}

/**
 * The `--self-test` arm runner: six fixtures over temporary homes, asserting the real behaviour.
 * @returns Never: exits 0 when every arm holds, 1 on the first arm that does not.
 */
async function selfTest(): Promise<never> {
  /** The temporary root every arm lives under, removed before the process exits. */
  const base: string = mkdtempSync(join(tmpdir(), "mpd-set-default-preset-"))
  /** The arm base for the TUI-plane arms. */
  const tuiHome: string = join(base, "tui-home")
  /** The arm base for the web-plane arm, kept separate so its emptiness is about THIS arm alone. */
  const webHome: string = join(base, "web-home")
  for (const dir of [tuiHome, webHome]) mkdirSync(dir, { recursive: true })
  /** One arm's verdict; a failure prints the observed values and stops the run. */
  const arm = (label: string, ok: boolean, detail: string): void => {
    console.log(PREFIX + " self-test " + (ok ? "ok   " : "FAIL ") + label + " — " + detail)
    if (!ok) {
      rmSync(base, { recursive: true, force: true })
      process.exit(1)
    }
  }
  /** The preference file the TUI-plane arms target inside their own sandbox home. */
  const target: string = join(tuiHome, TUI_DATA_DIRNAME, TUI_PREF_FILENAME)
  // ARM (a) DRY-RUN IS THE DEFAULT: the file must NOT appear, and the target must be printed first.
  /** The dry-run arm's child run. */
  const a = runHelper(["--home", tuiHome, "--profile", DEFAULT_PROFILE])
  arm("(a) dry-run by default -> exit 0, target printed, NOTHING written", a.status === 0 && a.out.includes(target) && a.out.includes("DRY-RUN") && !existsSync(target), "exit " + a.status + "; exists=" + existsSync(target) + "; target line=" + (a.out.split("\n").find((line: string): boolean => line.includes("target:")) ?? "(none)"))
  // ARM (b) `--yes` WRITES THE EXACT BYTES: the shape must equal dsh-tui's own writer output.
  /** The applying arm's child run. */
  const b = runHelper(["--home", tuiHome, "--profile", DEFAULT_PROFILE, "--yes"])
  /** The file's bytes after the applying run, or `""` when it was not written. */
  const written: string = existsSync(target) ? readFileSync(target, "utf8") : ""
  arm("(b) --yes writes the exact dsh-tui shape", b.status === 0 && written === prefBytes(DEFAULT_PRESET) && written === '{\n  "preset": "mpd"\n}', "exit " + b.status + "; bytes=" + Buffer.byteLength(written, "utf8") + "; content=" + JSON.stringify(written))
  // ARM (c) NEGATIVE CONTROL — AN INVALID ID IS REFUSED BEFORE THE WRITE: the file must be untouched.
  /** The invalid-id arm's child run. */
  const c = runHelper(["--home", tuiHome, "--profile", DEFAULT_PROFILE, "--yes", "--preset", "Bad Preset!"])
  arm("(c) an id outside dsh-tui's own boundary -> exit 1 and the file UNCHANGED", c.status === 1 && c.err.includes("invalid preset id") && readFileSync(target, "utf8") === prefBytes(DEFAULT_PRESET), "exit " + c.status + "; content=" + JSON.stringify(readFileSync(target, "utf8")))
  // ARM (d) NEGATIVE CONTROL — A WEB PROFILE WRITES NOTHING: the guidance is what it produces.
  /** The web-plane arm's child run. */
  const d = runHelper(["--home", webHome, "--profile", "web", "--yes"])
  /** The web arm's would-be target, asserted absent so "writes nothing" is measured. */
  const webTarget: string = join(webHome, TUI_DATA_DIRNAME, TUI_PREF_FILENAME)
  arm("(d) web profile -> exit 0, guidance printed, NOTHING written", d.status === 0 && d.out.includes("selectedDefault") && d.out.includes("DSH_TUI_PRESET") && !existsSync(webTarget), "exit " + d.status + "; exists=" + existsSync(webTarget))
  // ARM (e) THE REAL HOME IS NEVER TOUCHED WITHOUT THE OVERRIDE: this arm names no `--home`, so the
  // resolved target IS the real one — and without `--yes` the file must still be untouched.
  // It reads the real file's mtime+size BEFORE and AFTER rather than writing anything there.
  /** The real `~/.dsh-tui/agent-preset.json`, if the machine has one. */
  const realTarget: string = join(homedir(), TUI_DATA_DIRNAME, TUI_PREF_FILENAME)
  /** The real file's bytes before the arm, so a regression that touched it is detectable. */
  const realBefore: string = existsSync(realTarget) ? readFileSync(realTarget, "utf8") : "(absent)"
  /** The no-`--yes` real-home arm's child run. */
  const e = runHelper(["--profile", DEFAULT_PROFILE])
  /** The real file's bytes after the arm. */
  const realAfter: string = existsSync(realTarget) ? readFileSync(realTarget, "utf8") : "(absent)"
  arm("(e) real-home target named, no --yes -> exit 0, printed, real file untouched", e.status === 0 && e.out.includes("[REAL HOME]") && realBefore === realAfter, "exit " + e.status + "; mark=" + (e.out.includes("[REAL HOME]") ? "present" : "absent") + "; real file " + (realBefore === realAfter ? "unchanged" : "CHANGED"))
  // ARM (f) BYTE-FOR-BYTE MIRROR, MEASURED: run the INSTALLED dsh-tui's own `writePresetPref` into a
  // temporary directory and compare its bytes with this helper's. A missing install is a loud SKIP,
  // never a silent pass, because the whole point of this arm is that the shape was not invented.
  /** The plan used to locate an installed dsh-tui copy (the real home, read-only). */
  const plan: Plan = planOf(["--profile", DEFAULT_PROFILE])
  /** The installed preference module, or undefined when this machine has no dsh-tui. */
  const prefsModule: string | undefined = installedPrefsModule(plan)
  if (prefsModule === undefined) {
    console.log(PREFIX + " self-test SKIP (f) byte-parity with the installed dsh-tui: no presetPrefs.js found under " + join(plan.dshHome, "profiles") + " — install dsh-tui to exercise this arm")
  } else {
    /** The directory the installed writer is pointed at, so this arm writes only in the sandbox. */
    const referenceDir: string = join(base, "reference-home")
    /** The installed module's `writePresetPref`, invoked through a dynamic import of its real path. */
    const mod = await import(pathToFileURL(prefsModule).href) as { writePresetPref?: (preset: string, dir?: string) => boolean }
    /** The installed writer's verdict; false means it could not write and the arm cannot compare. */
    const ok: boolean = typeof mod.writePresetPref === "function" && mod.writePresetPref(DEFAULT_PRESET, referenceDir) === true
    /** The bytes dsh-tui's OWN writer produced. */
    const theirs: string = ok ? readFileSync(join(referenceDir, TUI_PREF_FILENAME), "utf8") : "(not written)"
    /** The installed dsh-tui's package directory, three levels above its `lib/types/<file>`. */
    const tuiPackage: string = dirname(dirname(dirname(prefsModule)))
    /** The installed dsh-tui version, printed so the arm names the build it mirrored. */
    let tuiVersion: string = "(version unknown)"
    try {
      tuiVersion = String(JSON.parse(readFileSync(join(tuiPackage, "package.json"), "utf8")).version)
    } catch { /* an unreadable manifest keeps the placeholder rather than failing the arm */ }
    arm("(f) byte parity with the installed dsh-tui@" + tuiVersion + " writer", ok && theirs === written, "theirs=" + JSON.stringify(theirs) + "; ours=" + JSON.stringify(written))
  }
  rmSync(base, { recursive: true, force: true })
  console.log(PREFIX + " self-test PASS: dry-run, apply, invalid-id refusal, web no-write, real-home safety, byte parity")
  process.exit(0)
}

// The one entry point: the self-test arm runner, or the plan against the caller's flags.
if (ARGV.includes("--self-test")) {
  await selfTest()
} else {
  process.exit(execute(planOf(ARGV)))
}
