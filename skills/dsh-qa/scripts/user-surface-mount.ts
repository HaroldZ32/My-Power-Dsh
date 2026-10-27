#!/usr/bin/env node
// Case user-surface-mount — "the release artifact is mapped onto what the USER can actually use".
//
// WHAT THIS CASE EXISTS FOR. Two green lights shipped while the product was broken:
//   (A) evidence/docker/client-install/2026-10-26T17-19-00Z scored 122 assertions ok=true and never
//       asserted a single slash command — the mount side only had generic rows (`boot.probeApplied`,
//       `boot.mpdTools`), and row integrity was `compose.mpdRows` listing FIVE rows against a
//       zero-override contract. Nothing in that lane would have noticed a command that never existed.
//   (B) 0.16.1 shipped and `mpd-cellwork` never mounted in a real user session: a stale
//       `@mpd-dsh/mpd@0.15.5` sat on the loader's INSTALL ANCHOR, `resolveBundleDir` prefers the
//       anchor over the profile, so the row LIST came from 0.15.5 while the row MODULES resolved from
//       the profile. Composition-only checks were green throughout.
//
// THE THREE ARMS, and what each one is allowed to claim:
//   1. ROW MOUNT — every row id the INSTALLED release artifact declares (its `dsh.bundle.patch`
//      layers, enumerated at run time so a new or deleted row changes the assertion set with no edit
//      here) is asserted effective in a REAL boot. Witness per row, recorded in the evidence:
//        · `sink`            the row's OWN log file `<ws>/.mpd/logs/<row>.log` is non-empty;
//        · `registration`    a name the row's own module declares (tool/command) is LIVE in the boot;
//        · `loader-active`   the loader holds an ACTIVE fiber with a runtime for that id (its
//                            `apply()` ran) — the fallback for a row that names no inspectable
//                            surface and writes no sink;
//        · `disabled-by-design` the artifact declares `disabled: true` and the loader agrees.
//      A row the loader never composed, a row whose fiber never became ACTIVE, and a disabled row
//      that came up ENABLED are all failures — and so is a row whose fiber is FAILED (3) or DISPOSED
//      (4), EVEN when it left a non-empty sink or a live registration behind: the fiber state is read
//      before any surface witness is accepted (CodeRabbit F9, PR #75).
//   2. COMMAND REGISTRATION — the seven commands this bundle contributes (`docs/user-guide.md` §12)
//      are asserted on the LIVE `commands` registry AND on the command palette a user sees, one
//      palette capture each. `/mpd` and `/mpd-model` are documented TUI-ONLY, so the PALETTE is their
//      required surface and a registry listing is recorded without being required. A command failure
//      GATES unless the command is the ONE documented exception (`NON_GATING_COMMANDS`, today
//      `/mpd-codegraph`) and every declared row mounted in the same boot (CodeRabbit F11, PR #75), so
//      an undocumented command nobody has seen fail yet can never ride a green run. The corpus guard
//      (`corpusProblems`) fails the run if the expected set is not exactly the published seven, which
//      is the negative control requirement 2 asks for: drop one and the arm reddens.
//   3. UPGRADE PATH — the profile's row list must be the one the boot composed, and the bundle the
//      loader resolved must be the profile's COPY BYTE-FOR-BYTE (version AND patch-layer digests),
//      because the 0.16.1 defect produced a hybrid whose composition never showed a difference. With
//      `--stale-bundle <dir>` the same arms run against a deliberately older bundle placed on the
//      install anchor, which is the direct B regression: the run must then go RED, and
//      `--expect-red` encodes that expectation so this file can prove its own falsifiability.
//
// NOT PROVEN HERE, stated rather than glossed: a live model turn (no credential, no turn: the row and
// command surfaces do not need one), the Web plane (the palette witness is TUI), and a packed/tarball
// install (the subject is whatever profile `--profile` names).
//
// ISOLATION (AGENTS.md §7): a fresh DSH_HOME + sandbox HOME + sandbox workspace, the real `~/.dsh` is
// only READ to copy the profile in, and `assertSessionsSandboxed` fails the run if any session store
// key escapes. The probe row is appended to the SANDBOX PROFILE's own user layer, so no product row
// is ever supplied by this case.
//
// PREREQ: absent-dsh-binary dsh install @deepseek-ai/dsh so the real harness binary is on PATH
// PREREQ: absent-dsh-binary dsh-tui npm i -g @deepseek-harness-tui/dsh-tui@0.17.0 (the TUI plane the palette witness needs)
// PREREQ: absent-runtime tmux apt-get install tmux (a real PTY is required; stdout must not be a pipe)
// PREREQ: absent-fixture tui-profile:install the bundle into a dsh-tui profile (dsh plugin --profile dsh-tui add .)
//
// Usage:
//   node skills/dsh-qa/scripts/user-surface-mount.ts --self-test
//   node skills/dsh-qa/scripts/user-surface-mount.ts [--profile <dir>] [--evidence <dir>] [--json-out <file>]
//                                                    [--ndjson-out <file>] [--stale-bundle <dir>] [--expect-red]
//                                                    [--keep-sandbox] [--no-skip]
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { appendFileSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { homedir } from "node:os"
import { basename, dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import {
  CONTRIBUTED_COMMANDS, NON_GATING_COMMANDS, TUI_ONLY_COMMANDS, classifyExpectRed, commandGates, corpusProblems,
  enumerateArtifactRows, evaluateCommand, evaluateNegativeControl, evaluateProfileRowList, evaluateRows,
  moduleNameCandidates, paletteCount, paletteCommandRows, parsePatchRows, replayBundleResolution,
  resolveRowModule, scanModule, sinkRows, unappliedLabel,
} from "./lib/user-surface-eval.ts"
import type { ExpectRedTarget, PatchRow, RedAssertion, RowContext, RowObservation, RowVerdict } from "./lib/user-surface-eval.ts"
import { readSessionEvents, recordedToolNames } from "./lib/session-evidence.ts"
import { assertSessionsSandboxed } from "./lib/workspace-isolation.ts"
import { provisionTuiHome, runTuiSession, tmuxPresent, tuiBinaryPresent } from "./lib/tui-lane.ts"

/** The case slug: the sandbox prefix, the evidence directory name and every log line. */
const SLUG = "user-surface-mount"
/** This file's absolute path, the anchor for the repository root below. */
const SELF = fileURLToPath(import.meta.url)
/** The repository root (`<root>/skills/dsh-qa/scripts/`). */
const REPO = dirname(dirname(dirname(dirname(SELF))))
/** The command a user could never have: the live negative control's subject. */
const NEGATIVE_CONTROL = "mpd-qa-no-such-command"
/** Where the boot's specks and captures land by default (the release-gate evidence band). */
const DEFAULT_EVIDENCE_ROOT = join(REPO, "evidence", "gates", "user-surface")
/** The scratch root of this case; `/.qa-*` in `.gitignore` covers it (AGENTS.md §7 / T-77). */
const SCRATCH_ROOT = join(REPO, ".qa-user-surface")
/** The probe row's module, mounted as instrumentation into the sandbox profile's user layer. */
const PROBE_MODULE = join(REPO, "skills", "dsh-qa", "scripts", "lib", "user-surface-probe.ts")

/** One assertion row in the shape `docker/lib/report.ts` and the QA evidence both read. */
export interface UserSurfaceAssertion {
  /** Stable assertion name, e.g. `userSurface.row.mpd-cellwork`. */
  readonly name: string
  /** true pass, false fail, null not evaluated. */
  readonly ok: boolean | null
  /** Human reason; the failure sentence when `ok` is false. */
  readonly reason: string
  /** The verbatim observation the verdict came from. */
  readonly raw: string
  /** False for a non-gating FINDING: it is recorded on the record but does not redden the gate. */
  readonly gating?: boolean
  /** The finding id when this row is a tracked, non-gating gap. */
  readonly finding?: string
}

/**
 * The companion marker row a DECLARED BOUND emits beside its own `userSurface.row.<id>` row.
 *
 * WHY A SECOND ROW AND NOT A REASON STRING: the docker lane (`scripts/docker-e2e.ts`) reddens every
 * NULL row under a REQUIRED prefix with exit 3 — correct for "the step never ran", wrong for "the row
 * is composed but this plane cannot prove it". Both are `ok:null`, so a driver that tried to tell them
 * apart would have to read prose, and a reader cannot audit that. The bound therefore DECLARES itself
 * per id in a TRUE row named `userSurface.bound.<id>`: the row's own verdict stays NULL (a bound is
 * never a pass), `userSurface.rowsDeclaredBound` still lists every id, and the docker lane excuses
 * exactly the `userSurface.row.<id>` nulls whose id carries this marker — an unmarked null, or a
 * marked row recorded FALSE, is still a failure there.
 * @param verdict The row's verdict, whose `witness` is this case's own name for the bound.
 * @returns The marker assertion, or null when the row is not a declared bound.
 */
function declaredBoundMarker(verdict: RowVerdict): UserSurfaceAssertion | null {
  if (verdict.ok !== null || verdict.witness !== "declared-bound") return null
  return {
    name: "userSurface.bound." + verdict.id,
    ok: true,
    reason: "declared bound: the artifact composes this row but this plane cannot prove it individually, so its own row stays NULL and is never read as a pass",
    raw: verdict.raw,
  }
}

/** Everything this run decided its subject was: the artifact, its rows and the boot's witnesses. */
export interface UserSurfaceFacts {
  /** The profile directory the boot used (a sandbox copy of the caller's). */
  readonly profileDir: string
  /** The installed bundle directory inside that profile. */
  readonly bundleDir: string
  /** The artifact's own version. */
  readonly bundleVersion: string
  /** The artifact's declared patch layers, absolute. */
  readonly patchFiles: readonly string[]
  /** How many rows the artifact declares. */
  readonly rowCount: number
  /** The resolved bundle the loader would use, as a REPLAY (labelled as such). */
  readonly resolution: { readonly dir: string; readonly version: string; readonly source: string }
  /** The rows that wrote a non-empty log sink, with byte sizes. */
  readonly sinks: ReadonlyArray<{ readonly id: string; readonly bytes: number }>
  /** Per-row witness counts, for the report's one-line summary. */
  readonly witnessCounts: Readonly<Record<string, number>>
  /** The command names the live registry listed for the session's agent. */
  readonly registryCommands: readonly string[]
  /** The palette count per captured command. */
  readonly paletteCounts: Readonly<Record<string, number | null>>
  /** The agent preset the session ran, as the harness recorded it. */
  readonly agentPreset: string | null
}

/** This run's whole record, written to `result.json` and (optionally) replayed as NDJSON. */
export interface UserSurfaceResult {
  /** The case id. */
  readonly case: string
  /** UTC instant the run started. */
  readonly startedAt: string
  /** UTC instant the run settled. */
  readonly finishedAt: string
  /** True when every assertion passed. */
  readonly ok: boolean
  /** True when every assertion was evaluated (never false in a completed run). */
  readonly complete: boolean
  /** Which mode produced it: the normal arm or the deliberate-falsification arm. */
  readonly mode: string
  /** The assertions, in assertion order. */
  readonly assertions: readonly UserSurfaceAssertion[]
  /** The subject facts, quoted so a reader can re-derive every verdict. */
  readonly facts: UserSurfaceFacts
  /** What this case does NOT prove, printed with the verdict. */
  readonly doesNotProve: readonly string[]
}

/** The parsed command line. */
interface CaseOptions {
  /** Run the offline arms and exit. */
  readonly selfTest: boolean
  /** The installed profile whose bundle is the subject. */
  readonly profile: string
  /** Where the evidence lands; `""` means a timestamped directory under `evidence/gates/user-surface`. */
  readonly evidence: string
  /** Where to write the whole record; `""` skips it. */
  readonly jsonOut: string
  /** Where to append the assertions as NDJSON (the docker lane's state file); `""` skips it. */
  readonly ndjsonOut: string
  /** A bundle package to place on the install anchor, modelling a stale global install; `""` is off. */
  readonly staleBundle: string
  /** True when the run is EXPECTED to go red (the falsification arm's own verdict). */
  readonly expectRed: boolean
  /** Keep the sandbox after the run, for a reader who wants to poke it. */
  readonly keepSandbox: boolean
}

/**
 * Parse this case's command line.
 * @param argv The arguments after the script path.
 * @returns The resolved options.
 */
function parseArgs(argv: readonly string[]): CaseOptions {
  /** The value following a flag, or "" when it is absent. */
  const valueOf = (flag: string): string => {
    /** The flag's index in argv, or -1. */
    const index = argv.indexOf(flag)
    return index >= 0 ? String(argv[index + 1] ?? "") : ""
  }
  return {
    selfTest: argv.includes("--self-test"),
    profile: valueOf("--profile") || join(homedir(), ".dsh", "profiles", "dsh-tui"),
    evidence: valueOf("--evidence"),
    jsonOut: valueOf("--json-out"),
    ndjsonOut: valueOf("--ndjson-out"),
    staleBundle: valueOf("--stale-bundle"),
    expectRed: argv.includes("--expect-red"),
    keepSandbox: argv.includes("--keep-sandbox") || valueOf("--keep-sandbox") === "true",
  }
}

/**
 * Print the two documented invocations.
 * @returns Nothing; writes to stdout.
 */
function usage(): void {
  console.log("usage: node skills/dsh-qa/scripts/user-surface-mount.ts --self-test")
  console.log("       node skills/dsh-qa/scripts/user-surface-mount.ts [--profile <dir>] [--evidence <dir>]")
  console.log("            [--json-out <file>] [--ndjson-out <file>] [--stale-bundle <dir>] [--expect-red] [--keep-sandbox]")
}

/**
 * A filesystem-safe UTC stamp for the evidence directory.
 * @param now The instant to stamp.
 * @returns `YYYY-MM-DDTHH-MM-SSZ`.
 */
function stamp(now: Date): string {
  return now.toISOString().replaceAll(":", "-").replace(/\.\d+Z$/, "Z")
}

/**
 * The SHA-256 of one file, or "" when it cannot be read.
 * @param file Absolute path.
 * @returns The hex digest, or "".
 */
function sha256File(file: string): string {
  try { return createHash("sha256").update(readFileSync(file)).digest("hex") } catch { return "" }
}

/**
 * The version one installed bundle package declares.
 * @param dir Absolute path of a bundle package directory.
 * @returns Its `version`, or "" when unreadable.
 */
function readVersion(dir: string): string {
  try { return String((JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { version?: unknown }).version ?? "") } catch { return "" }
}

/**
 * The `package.json` of the dsh installation a binary belongs to.
 *
 * The loader derives its INSTALL ANCHOR from the running package's own location, so the anchor is a
 * property of the binary that boots — not of the profile. Both a normal PATH launcher and this case's
 * anchor-prefix shim are handled: the shim's `exec node <package>/lib/bin.js` target is read back.
 * @param dshBinary Absolute path of the `dsh` executable the boot will use.
 * @returns The anchor `package.json` path, or "" when it cannot be determined.
 */
function installAnchorOf(dshBinary: string): string {
  // A shim written by this case names the target package directly; read it back instead of guessing.
  try {
    /** The shim's bytes, when the binary is a script this case wrote. */
    const text = readFileSync(dshBinary, "utf8")
    /** The package directory the shim execs, captured from its `lib/bin.js` target. */
    const target = /exec node "([^"]+)\/lib\/bin\.js"/.exec(text)
    if (target !== null) return join(String(target[1]), "package.json")
  } catch { /* not a text shim: fall through to the resolution below */ }
  try {
    /** A resolver anchored beside the launcher, i.e. the harness's own installation. */
    const resolver = createRequire(join(dirname(dshBinary), "anchor.cjs"))
    return resolver.resolve("@deepseek-ai/dsh/package.json")
  } catch { /* fall through: the launcher is a bin-directory symlink, not a live resolution root */ }
  try {
    /** The launcher's real path: `<prefix>/lib/node_modules/@deepseek-ai/dsh/lib/bin.js`. */
    const real = realpathSync(dshBinary)
    /** The package directory that file sits in. */
    const packageDir = dirname(dirname(real))
    return existsSync(join(packageDir, "package.json")) ? join(packageDir, "package.json") : ""
  } catch { return "" }
}

/**
 * Write one NDJSON assertion line, the shape `docker/lib/report.ts` parses.
 *
 * A NON-GATING row is NOT written here, and that is the docker lane's contract rather than a
 * convenience: that report treats any `ok:null` row under a required prefix as an unmeasured arm
 * (exit 3), which is exactly right for "the step did not run" and exactly wrong for "a named product
 * finding was recorded". The finding still reaches the report through `userSurface.findings` (a TRUE
 * row listing its ids), and the full record — including the finding's own FALSE verdict — stays in
 * this case's `result.json`/`rows.json` under the evidence tree.
 *
 * The `userSurface.bound.<id>` markers are ordinary GATING rows (TRUE), so they DO reach the lane:
 * they are what lets it tell a DECLARED BOUND from a step that never ran, and dropping them here would
 * turn every bound back into exit 3.
 * @param file Destination file; the line is appended so a lane can merge several cases.
 * @param assertion The assertion to append.
 */
function appendNdjson(file: string, assertion: UserSurfaceAssertion): void {
  if (file === "" || assertion.gating === false) return
  appendFileSync(file, JSON.stringify({ name: assertion.name, ok: assertion.ok, reason: assertion.reason, raw: assertion.raw }) + "\n")
}

// ── the offline arms ─────────────────────────────────────────────────────────

/** One offline arm's outcome. */
interface SelfTestArm {
  /** The arm's name, printed on its line. */
  readonly name: string
  /** True when the arm held. */
  readonly ok: boolean
  /** One sentence on what was measured. */
  readonly detail: string
}

/**
 * Run every offline arm, including the two NEGATIVE controls requirement 2 fixes.
 * @returns The arms in run order.
 */
function selfTestArms(): SelfTestArm[] {
  /** Every arm's outcome, in run order. */
  const arms: SelfTestArm[] = []
  /** Record one arm from a boolean and a sentence. */
  const arm = (name: string, ok: boolean, detail: string): void => { arms.push({ name, ok, detail }) }

  // 1. The artifact's layers really enumerate — from THIS checkout, which ships the same two layers.
  /** The checkout's own two shipped layers, read as the artifact's would be. */
  const checkoutRows = [
    ...parsePatchRows(readFileSync(join(REPO, "cordis.patch.yml"), "utf8"), "cordis.patch.yml"),
    ...parsePatchRows(readFileSync(join(REPO, "presets", "mpd.patch.yml"), "utf8"), "presets/mpd.patch.yml"),
  ]
  arm("layers.enumerate", checkoutRows.length >= 60 && checkoutRows.some((row) => row.id === "mpd-cellwork"),
    "rows=" + String(checkoutRows.length) + " mpd-cellwork=" + String(checkoutRows.some((row) => row.id === "mpd-cellwork")))
  arm("layers.disabledFlags", checkoutRows.filter((row) => row.disabled).length >= 2,
    "disabled=" + checkoutRows.filter((row) => row.disabled).map((row) => row.id).join(","))

  // 2. The assertion set FOLLOWS the layers: add a row and it appears, delete one and it disappears.
  /** A minimal two-row layer, then the same layer with one row added and one removed. */
  const base = "- insert:\n    - id: row-a\n      name: '@x/a'\n    - id: row-b\n      name: '@x/b'\n"
  /** The base's ids. */
  const baseIds = parsePatchRows(base, "synthetic.yml").map((row) => row.id)
  /** The mutated layer: `row-b` deleted, `row-c` added. */
  const mutatedIds = parsePatchRows("- insert:\n    - id: row-a\n      name: '@x/a'\n    - id: row-c\n      name: '@x/c'\n", "synthetic.yml").map((row) => row.id)
  arm("layers.followsTheArtifact", baseIds.join(",") === "row-a,row-b" && mutatedIds.join(",") === "row-a,row-c",
    "base=" + baseIds.join(",") + " mutated=" + mutatedIds.join(",") + " (no hardcoded row count anywhere)")

  // 3. The row witness order: sink beats registration beats loader-active, and each failure reddens.
  /** One active observation, the shape the probe records. */
  const activeRow: RowObservation = { id: "row-a", state: 2, hasRuntime: true, disabled: false }
  /** The declared row the observations grade. */
  const declared: PatchRow[] = [{ id: "row-a", name: "@mpd-dsh/mpd/packages/x/dist/index.js", disabled: false, patch: "cordis.patch.yml", line: 1 }]
  /** The composition context the self-test grades inside. */
  const ctx: RowContext = { agentPreset: "mpd", presetLayer: "mpd.patch.yml" }
  arm("rows.sinkPreferred", evaluateRows(declared, [activeRow], ["row-a"], new Map([["row-a", ["tool_a"]]]), ctx)[0]?.witness === "sink", "sink wins over registration")
  arm("rows.registration", evaluateRows(declared, [activeRow], [], new Map([["row-a", ["tool_a"]]]), ctx)[0]?.witness === "registration", "a live module-declared name is a witness")
  arm("rows.loaderActive", evaluateRows(declared, [activeRow], [], new Map(), ctx)[0]?.witness === "loader-active", "an ACTIVE fiber with a runtime is the fallback")
  arm("rows.missingIsRed", evaluateRows(declared, [], [], new Map(), ctx)[0]?.ok === false, "a row the loader never composed FAILS")
  arm("rows.inactiveIsRed", evaluateRows(declared, [{ ...activeRow, state: 1, hasRuntime: false }], [], new Map(), ctx)[0]?.ok === false, "a composed row that never activated FAILS")
  // 3b. A DEAD FIBER OUTRANKS THE SURFACE WITNESSES (CodeRabbit F9, PR #75). THE REVERSE CONTROL is the
  //     first arm: a row whose fiber is FAILED (3) but which WROTE A LOG SINK used to be accepted as a
  //     `sink` pass, and the second covers the same hole through `registration` on a DISPOSED fiber.
  /** The reverse control's subject: an enabled row whose fiber FAILED after writing its sink. */
  const deadFibreRow: RowObservation = { id: "row-a", state: 3, hasRuntime: false, disabled: false }
  /** That row's verdict, read once so every arm below grades the same object. */
  const deadFibreVerdict = evaluateRows(declared, [deadFibreRow], ["row-a"], new Map([["row-a", ["tool_a"]]]), ctx)[0] as RowVerdict
  arm("rows.deadFibreSinkReddens", deadFibreVerdict.ok === false && deadFibreVerdict.witness === "none",
    "a FAILED (3) fiber that WROTE A LOG SINK is not a pass: ok=" + String(deadFibreVerdict.ok) + " witness=" + deadFibreVerdict.witness)
  arm("rows.deadFibreRegistrationReddens", evaluateRows(declared, [{ ...activeRow, state: 4, hasRuntime: false }], [], new Map([["row-a", ["tool_a"]]]), ctx)[0]?.ok === false,
    "a DISPOSED (4) fiber with a live module-declared registration is not a pass either")
  arm("rows.deadFibreQuotesEveryWitnessItRefused", deadFibreVerdict.raw.includes("state=3") && deadFibreVerdict.raw.includes("sink=true") && deadFibreVerdict.raw.includes("tool_a"),
    "the evidence keeps the refused sink and registration beside the dead state: " + deadFibreVerdict.raw)
  // 3b-2. THE TWO BYPASSES N1 NAMES (CodeRabbit N1, PR #75). Both arms are REVERSE CONTROLS: each one
  //       is a false pass the pre-N1 ladder granted (it only refused states 3/4), and each must now be
  //       FALSE with the refused witness quoted. (a) an ENABLED row still PENDING (1) that had already
  //       written its log sink; (b) a row the boot holds DISABLED whose bundle module declares a name
  //       the live registry answers to. A third arm covers the remaining half of the same rule: an
  //       ACTIVE fiber with NO runtime is not a mounted row either.
  /** The pending-fiber subject: enabled, still loading, no runtime yet, but its sink already exists. */
  const pendingSunkRow: RowObservation = { id: "row-a", state: 1, hasRuntime: false, disabled: false }
  /** That row's verdict, read once so both of its arms grade the same object. */
  const pendingSunkVerdict = evaluateRows(declared, [pendingSunkRow], ["row-a"], new Map(), ctx)[0] as RowVerdict
  arm("rows.pendingSinkReddens", pendingSunkVerdict.ok === false && pendingSunkVerdict.witness === "none",
    "a PENDING (1) fiber that already wrote its log sink is not a pass: ok=" + String(pendingSunkVerdict.ok) + " witness=" + pendingSunkVerdict.witness)
  arm("rows.pendingSinkQuotesTheRefusedWitness", pendingSunkVerdict.raw.includes("state=1") && pendingSunkVerdict.raw.includes("unapplied=state=1") && pendingSunkVerdict.raw.includes("sink=true"),
    "the refused sink stays in the evidence: " + pendingSunkVerdict.raw)
  /** The disabled-with-a-live-name subject: the loader never applied it, yet its module's name is live. */
  const disabledRegisteredVerdict = evaluateRows(declared, [{ ...activeRow, state: null, hasRuntime: false, disabled: true }], [], new Map([["row-a", ["tool_a"]]]), ctx)[0] as RowVerdict
  arm("rows.disabledRegistrationReddens", disabledRegisteredVerdict.ok === false && disabledRegisteredVerdict.witness === "none",
    "a DISABLED row whose name is live in the registry is not a pass: ok=" + String(disabledRegisteredVerdict.ok) + " witness=" + disabledRegisteredVerdict.witness)
  arm("rows.disabledRegistrationQuotesIt", disabledRegisteredVerdict.raw.includes("disabled=true") && disabledRegisteredVerdict.raw.includes("unapplied=disabled") && disabledRegisteredVerdict.raw.includes("tool_a"),
    "the live registration is quoted beside disabled=true: " + disabledRegisteredVerdict.raw)
  arm("rows.activeWithoutRuntimeReddens", evaluateRows(declared, [{ ...activeRow, hasRuntime: false }], ["row-a"], new Map(), ctx)[0]?.ok === false,
    "an ACTIVE (2) fiber with NO runtime cannot witness its own sink")
  arm("rows.unappliedLabelOrder", unappliedLabel(activeRow) === "" && unappliedLabel({ ...activeRow, disabled: true }) === "disabled" && unappliedLabel(deadFibreRow) === "state=3" && unappliedLabel({ ...activeRow, hasRuntime: false }) === "no-runtime",
    "the three facts are read in one order: disabled -> state -> runtime, and only an applied row labels empty")
  arm("rows.disabledByDesign", evaluateRows([{ ...(declared[0] as PatchRow), disabled: true }], [{ ...activeRow, disabled: true }], [], new Map(), ctx)[0]?.witness === "disabled-by-design", "a declared-disabled row is green only when the loader agrees")
  arm("rows.disabledCameUpEnabled", evaluateRows([{ ...(declared[0] as PatchRow), disabled: true }], [activeRow], [], new Map(), ctx)[0]?.ok === false, "a disabled row that came up ENABLED FAILS")
  // The declared bound: a preset-scoped row that the root tree holds disabled is NULL, never true —
  // and the same shape on a HOST layer is null too, while a row that should be active is false.
  arm("rows.presetBoundIsNull", evaluateRows(
    [{ ...(declared[0] as PatchRow), disabled: false, patch: "presets/mpd.patch.yml" }],
    [{ ...activeRow, state: null, hasRuntime: false, disabled: true }], [], new Map(), ctx,
  )[0]?.ok === null, "a preset-materialised row is NOT PROVEN (null), never a pass")
  arm("rows.selfDisabledIsNull", evaluateRows(declared, [{ ...activeRow, state: null, hasRuntime: false, disabled: true }], [], new Map(), ctx)[0]?.ok === null,
    "a row its mount guard disabled is a bound too (the web sidebar row on a TUI-only profile)")
  // 3c. THE DECLARED-BOUND MARKER — the docker lane's exit-3 wiring, tested where it is EMITTED. An
  //     unmarked NULL is a step that never ran (exit 3); a bound is declared per id in a TRUE companion
  //     row, and a row that was witnessed, or FAILED, carries no marker at all.
  /** The preset-owned verdict above, read once so the marker arms grade the same object. */
  const presetBoundVerdict = evaluateRows(
    [{ ...(declared[0] as PatchRow), disabled: false, patch: "presets/mpd.patch.yml" }],
    [{ ...activeRow, state: null, hasRuntime: false, disabled: true }], [], new Map(), ctx,
  )[0] as RowVerdict
  arm("bound.markerEmitted", declaredBoundMarker(presetBoundVerdict)?.name === "userSurface.bound.row-a",
    "a declared bound also writes " + String(declaredBoundMarker(presetBoundVerdict)?.name))
  arm("bound.markerIsTrue", declaredBoundMarker(presetBoundVerdict)?.ok === true,
    "the marker is a TRUE assertion; the row it marks stays NULL")
  arm("bound.markerKeepsTheRowNull", presetBoundVerdict.ok === null,
    "the row itself is NEVER rewritten to true by the marker")
  arm("bound.noMarkerOnWitnessed", declaredBoundMarker(evaluateRows(declared, [activeRow], [], new Map(), ctx)[0] as RowVerdict) === null,
    "a witnessed row carries no marker, so the lane reads its own TRUE verdict")
  arm("bound.noMarkerOnFailed", declaredBoundMarker(evaluateRows(declared, [], [], new Map(), ctx)[0] as RowVerdict) === null,
    "a FAILED row carries no marker: it must redden on its own row")

  // 4. The corpus guard, i.e. requirement 2's NEGATIVE CONTROL: drop one and the arm reddens.
  arm("corpus.complete", corpusProblems(CONTRIBUTED_COMMANDS).length === 0, "the published seven are asserted: " + CONTRIBUTED_COMMANDS.join(","))
  /** The corpus with `/cellwork` deliberately removed — the negative control. */
  const dropped = CONTRIBUTED_COMMANDS.filter((name) => name !== "cellwork")
  arm("corpus.droppedNameReddens", corpusProblems(dropped).some((problem) => problem.includes("cellwork")), "dropping cellwork -> " + (corpusProblems(dropped)[0] ?? "NO PROBLEM (defect)"))
  arm("corpus.duplicateReddens", corpusProblems([...CONTRIBUTED_COMMANDS, "ulw"]).length > 0, "a duplicate hides a dropped name")
  arm("corpus.unknownReddens", corpusProblems([...CONTRIBUTED_COMMANDS, "roster"]).length > 0, "a command the bundle does not contribute reddens")

  // 5. The command verdicts, both planes, both witnesses, and the fabricated-name control.
  /** A palette capture that draws one command, in the host's own box format. */
  const paneWith = (name: string): string => ["  ╭─ 命令 · 共 1 项 ─────╮", "  │ ❯ " + name + "    what it does                            │", "  ╰──────────────────────╯"].join("\n")
  /** A palette capture that draws nothing, which is what a fabricated name must produce. */
  const emptyPane = ["  ╭─ 命令 · 共 0 项 ─────╮", "  ╰──────────────────────╯"].join("\n")
  arm("palette.parses", paletteCount(paneWith("agent-teams")) === 1 && paletteCommandRows(paneWith("agent-teams")).includes("agent-teams"),
    "count=" + String(paletteCount(paneWith("agent-teams"))) + " rows=" + paletteCommandRows(paneWith("agent-teams")).join(","))
  arm("command.sharedGreen", evaluateCommand("cellwork", ["cellwork"], paneWith("cellwork")).ok, "registry + palette")
  arm("command.registryOnlyReddens", evaluateCommand("cellwork", ["cellwork"], emptyPane).ok === false, "a command missing from the palette is NOT a pass")
  arm("command.paletteOnlyReddens", evaluateCommand("cellwork", [], paneWith("cellwork")).ok === false, "a command missing from the registry on the shared plane is NOT a pass")
  arm("command.tuiOnlyPaletteGreen", evaluateCommand("mpd-model", [], paneWith("mpd-model")).ok, "a documented TUI-only command needs the palette, not the registry")
  arm("command.tuiOnlyNoPaneReddens", evaluateCommand("mpd-model", [], emptyPane).ok === false, "the TUI-only exemption is not a hole")
  // The requirement's other negative-control spelling: assert a command that does not exist.
  arm("command.fabricatedReddens", evaluateCommand(NEGATIVE_CONTROL, ["cellwork"], emptyPane).ok === false, "asserting a nonexistent command FAILS")
  // 5b. THE COMMAND GATE (CodeRabbit F11, PR #75): a FAILURE on a fully mounted boot GATES for every
  //     command except the ONE documented id, and even that one gates while the composition is broken.
  arm("command.passGates", commandGates("ulw", true, true), "a pass rides as a gating assertion")
  arm("command.failureGates", commandGates("cellwork", false, true), "an UNDOCUMENTED failure on a complete composition GATES (the old rule recorded it as a finding)")
  arm("command.nonGatingIsExactlyCodegraph", NON_GATING_COMMANDS.length === 1 && NON_GATING_COMMANDS[0] === "mpd-codegraph" && commandGates("mpd-codegraph", false, true) === false,
    "the whitelist is exactly one id: " + NON_GATING_COMMANDS.join(","))
  arm("command.everyOtherCommandGates", CONTRIBUTED_COMMANDS.filter((name) => name !== "mpd-codegraph").every((name) => commandGates(name, false, true)),
    "all six other contributed commands gate a failure: " + CONTRIBUTED_COMMANDS.filter((name) => name !== "mpd-codegraph").join(","))
  arm("command.whitelistDoesNotExcuseABrokenComposition", commandGates("mpd-codegraph", false, false), "the one exception still gates on the stale-anchor arm")
  arm("command.unknownNameGates", commandGates("roster", false, true), "a name this bundle does not contribute is never excused")
  arm("negativeControl.absentGreen", evaluateNegativeControl(NEGATIVE_CONTROL, ["cellwork"], "", paneWith("cellwork"), paneWith("cellwork")).ok, "an absent control is green while the palette is alive either side")
  arm("negativeControl.presentReddens", evaluateNegativeControl(NEGATIVE_CONTROL, [NEGATIVE_CONTROL], "", paneWith("cellwork"), paneWith("cellwork")).ok === false, "a control that IS present is not a control")
  arm("negativeControl.deadPaletteReddens", evaluateNegativeControl(NEGATIVE_CONTROL, [], "", "", "").ok === false, "an aimless capture (no box on either side) proves nothing")

  // 6. The upgrade-path verdict: the profile's row list must be the composed one.
  arm("upgrade.profileWins", evaluateProfileRowList(declared, [activeRow]).ok, "every profile row is in the boot")
  arm("upgrade.staleAnchorReddens", evaluateProfileRowList(
    [...declared, { id: "mpd-cellwork", name: "@mpd-dsh/mpd/packages/mpd-cellwork-plugin/dist/index.js", disabled: false, patch: "p.yml", line: 9 }],
    [activeRow],
  ).missing.join(",") === "mpd-cellwork", "a profile row the boot never composed is named (the 0.16.1 shape)")

  // 7. The install-anchor replay is modelled on a fixture tree: the anchor WINS when it carries the
  //    bundle, which is the mechanism every real run reports on.
  /** A throwaway tree modelling a global install beside a profile install. */
  const fixture = mkdtempSync(join(REPO, ".qa-user-surface-fixture-"))
  try {
    mkdirSync(join(fixture, "anchor", "node_modules", "@mpd-dsh", "mpd"), { recursive: true })
    writeFileSync(join(fixture, "anchor", "node_modules", "@mpd-dsh", "mpd", "package.json"), JSON.stringify({ name: "@mpd-dsh/mpd", version: "0.0.1-stale" }))
    mkdirSync(join(fixture, "anchor", "index"), { recursive: true })
    writeFileSync(join(fixture, "anchor", "index", "package.json"), JSON.stringify({ name: "anchor-app", version: "1.0.0" }))
    mkdirSync(join(fixture, "profile", "node_modules", "@mpd-dsh", "mpd"), { recursive: true })
    writeFileSync(join(fixture, "profile", "node_modules", "@mpd-dsh", "mpd", "package.json"), JSON.stringify({ name: "@mpd-dsh/mpd", version: "9.9.9-profile" }))
    writeFileSync(join(fixture, "profile", "package.json"), JSON.stringify({ name: "profile", version: "1.0.0" }))
    /** The replay's answer for the fixture: the anchor copy first, exactly like `resolveBundleDir`. */
    const stale = replayBundleResolution(join(fixture, "anchor", "index", "package.json"), join(fixture, "profile"), "@mpd-dsh/mpd")
    arm("resolution.anchorWins", stale.source === "install-anchor" && stale.version === "0.0.1-stale", "source=" + stale.source + " version=" + stale.version)
    rmSync(join(fixture, "anchor"), { recursive: true, force: true })
    /** The replay's answer once the global copy is gone: the profile's copy. */
    const clean = replayBundleResolution(join(fixture, "anchor", "index", "package.json"), join(fixture, "profile"), "@mpd-dsh/mpd")
    arm("resolution.profileWhenAnchorClean", clean.source === "profile" && clean.version === "9.9.9-profile", "source=" + clean.source + " version=" + clean.version)
    // THE GLOBAL-PREFIX LAYOUT IS THE ONE THAT SHIPPED THE DEFECT, so it gets its own arm: an npm
    // global install puts the harness at `<prefix>/lib/node_modules/@deepseek-ai/dsh` and the bundle
    // BESIDE it at `<prefix>/lib/node_modules/@mpd-dsh/mpd`, two levels deeper than the flat fixture
    // above. Measured 2026-10-27: an off-by-one in the ancestor walk answered "profile" here.
    mkdirSync(join(fixture, "prefix", "lib", "node_modules", "@deepseek-ai", "dsh"), { recursive: true })
    writeFileSync(join(fixture, "prefix", "lib", "node_modules", "@deepseek-ai", "dsh", "package.json"), JSON.stringify({ name: "@deepseek-ai/dsh", version: "0.2.1-rc.3" }))
    mkdirSync(join(fixture, "prefix", "lib", "node_modules", "@mpd-dsh", "mpd"), { recursive: true })
    writeFileSync(join(fixture, "prefix", "lib", "node_modules", "@mpd-dsh", "mpd", "package.json"), JSON.stringify({ name: "@mpd-dsh/mpd", version: "0.0.1-stale" }))
    /** The replay's answer for the real global layout. */
    const globalLayout = replayBundleResolution(join(fixture, "prefix", "lib", "node_modules", "@deepseek-ai", "dsh", "package.json"), join(fixture, "profile"), "@mpd-dsh/mpd")
    arm("resolution.globalPrefixLayout", globalLayout.source === "install-anchor" && globalLayout.version === "0.0.1-stale", "source=" + globalLayout.source + " version=" + globalLayout.version + " dir=" + globalLayout.dir)
  } finally {
    rmSync(fixture, { recursive: true, force: true })
  }

  // 8. Sink reading: a non-empty sink is a witness, an EMPTY one is not.
  /** A throwaway log directory with one written and one blank sink. */
  const logs = mkdtempSync(join(REPO, ".qa-user-surface-logs-"))
  try {
    mkdirSync(join(logs, "sub"), { recursive: true })
    writeFileSync(join(logs, "mpd-roles.log"), "boot line\n")
    writeFileSync(join(logs, "mpd-cellwork.log"), "")
    /** The sinks this reader reports. */
    const found = sinkRows(logs)
    arm("sinks.nonEmptyOnly", found.length === 1 && found[0]?.id === "mpd-roles", "found=" + found.map((entry) => entry.id + ":" + String(entry.bytes)).join(","))
  } finally {
    rmSync(logs, { recursive: true, force: true })
  }

  // 9. The module-name extractor: registration candidates only, de-duplicated.
  arm("modules.candidates", moduleNameCandidates('{ name: "cellwork_status" } { name: "cellwork_status" } { toolName: "mpd_ext_list" }').join(",") === "cellwork_status,mpd_ext_list", "extracts both shapes once")

  // 10. THE STALE-ANCHOR GUARD (CodeRabbit F10, PR #75): with no `dsh` on PATH the anchor is "",
  //     `dirname("")` is ".", and the unguarded path handed `cpSync` the whole process CWD. The first
  //     arm proves the hazard is real, the next two that the guard refuses it, and the last that a
  //     REAL resolved anchor is still accepted (the guard is not a blanket refusal).
  arm("staleAnchor.hazardIsReal", dirname("") === ".", 'dirname("") === "." — the source an unresolved anchor would have copied recursively into the sandbox')
  arm("staleAnchor.refusesUnresolvedDsh", staleAnchorRefusal("", "", "") !== "", "`command -v dsh` empty -> refused: " + staleAnchorRefusal("", "", ""))
  arm("staleAnchor.refusesEmptyAnchor", staleAnchorRefusal("/usr/local/bin/dsh", "", "") !== "" && staleAnchorRefusal("/usr/local/bin/dsh", "", "").includes("anchor"),
    "an alternative binary with an unresolved anchor is refused too: " + staleAnchorRefusal("/usr/local/bin/dsh", "", ""))
  arm("staleAnchor.acceptsResolvedAnchor", staleAnchorRefusal("/usr/local/bin/dsh", join(REPO, "package.json"), REPO) === "",
    "a resolved anchor whose package dir holds package.json is accepted")

  // 11. THE `--expect-red` NAMED-CAUSE GATE (CodeRabbit N3, PR #75). THE DEMO IS ARM ONE: a boot that
  //     SUCCEEDED (probe true, both root assertions true) but whose palette capture failed used to be
  //     accepted as "the stale anchor was detected", because the old branch only read `green`. These
  //     arms drive the very function the CLI calls, with hand-built assertion rows, and each refusal
  //     arm is a red that must NOT be read as proof.
  /** One assertion row as the expect-red classifier reads it. */
  const redRow = (name: string, ok: boolean, raw: string): RedAssertion => ({ name, ok, reason: ok ? "held" : "failed", raw })
  /** The stale version the demo stages; the anchor must report exactly this for the cause to hold. */
  const stagedVersion = "0.15.5"
  /** What the real `--expect-red` run declares it is staging. */
  const expectTarget: ExpectRedTarget = { staleVersion: stagedVersion, expectedRow: "mpd-cellwork" }
  /** The bundle-resolution row of a correctly reproduced stale anchor. */
  const anchorRed = redRow("userSurface.bundleResolution", false, "source=install-anchor dir=/tmp/anchor/lib/node_modules/@mpd-dsh/mpd version=" + stagedVersion + " profileVersion=0.16.1 sameCopyDigests=false")
  /** The row-list row of the same reproduction: the anchored list omits the profile's newer row. */
  const rowListRed = redRow("userSurface.profileRowListWins", false, "profileRows=36 bootEntries=154 missing=mpd-cellwork")
  /** A healthy boot's rows, so a demo assertion set can carry the REAL surrounding assertions. */
  const healthyRows: RedAssertion[] = [
    redRow("userSurface.probe", true, "loaderEntries=155 commands=33 tools=117"),
    redRow("userSurface.bundleResolution", true, "source=profile dir=/p version=0.16.1 profileVersion=0.16.1 sameCopyDigests=true"),
    redRow("userSurface.profileRowListWins", true, "profileRows=36 bootEntries=155 missing=-"),
    redRow("userSurface.rowsWitness", true, "failed=-"),
    redRow("userSurface.negativeControl", true, "aliveBefore=95 aliveAfter=95"),
  ]
  /** THE DEMO: a boot that SUCCEEDED but whose palette capture failed — no named cause, so inconclusive. */
  const paletteBroken: RedAssertion[] = [
    ...healthyRows.filter((row) => row.name !== "userSurface.negativeControl"),
    redRow("userSurface.negativeControl", false, "aliveBefore=null aliveAfter=null"),
    redRow("userSurface.command.mpd", false, "registry=no palette=none (no palette box in the capture)"),
    redRow("userSurface.command.ulw", false, "registry=no palette=none (no palette box in the capture)"),
  ]
  /** That demo's verdict, read once so its three arms grade the same object. */
  const paletteBrokenVerdict = classifyExpectRed(paletteBroken, [], expectTarget)
  arm("expectRed.paletteFailureIsInconclusive", paletteBrokenVerdict.ok === false,
    "a SUCCESSFUL boot whose palette capture failed is INCONCLUSIVE, not a detected anchor: " + paletteBrokenVerdict.sentence)
  arm("expectRed.paletteFailureNamesTheUnrelatedReds", paletteBrokenVerdict.unexplained.includes("userSurface.negativeControl"),
    "the refusal names the structural red the cause does not explain: " + paletteBrokenVerdict.unexplained.join(","))
  /** The same demo with a crashed boot: the probe never wrote its record. */
  const bootCrash: RedAssertion[] = [
    redRow("userSurface.probe", false, "the instrumentation row wrote no record"),
    ...healthyRows.filter((row) => row.name !== "userSurface.probe" && row.name !== "userSurface.rowsWitness"),
    redRow("userSurface.rowsWitness", false, "failed=every-declared-row"),
  ]
  arm("expectRed.bootCrashIsInconclusive", classifyExpectRed(bootCrash, [], expectTarget).ok === false,
    "a red boot with no probe record is INCONCLUSIVE: " + classifyExpectRed(bootCrash, [], expectTarget).sentence)
  /** The real reproduction: the named anchor cause AND an incomplete composition, all downstream. */
  const namedRed: RedAssertion[] = [
    redRow("userSurface.probe", true, "loaderEntries=154 commands=33 tools=117"),
    redRow("userSurface.command.mpd", true, "registry+palette"),
    redRow("userSurface.rowsWitness", false, "failed=mpd-cellwork"),
    redRow("userSurface.row.mpd-cellwork", false, "the boot's loader holds NO entry for it"),
    redRow("userSurface.command.cellwork", false, "neither the registry nor the palette carries it"),
    rowListRed,
    anchorRed,
  ]
  arm("expectRed.namedAnchorCauseHolds", classifyExpectRed(namedRed, [], expectTarget).ok === true,
    "the reproduced stale anchor IS conclusive: " + classifyExpectRed(namedRed, [], expectTarget).sentence)
  arm("expectRed.rowListCauseAloneHolds", classifyExpectRed(namedRed.filter((row) => row.name !== "userSurface.bundleResolution"), [], expectTarget).ok === true,
    "the SECOND named cause (profileRowListWins naming mpd-cellwork) is enough on its own")
  arm("expectRed.greenIsVacuous", classifyExpectRed(healthyRows, [], expectTarget).ok === false,
    "a run that never reddened proves nothing: " + classifyExpectRed(healthyRows, [], expectTarget).sentence)
  arm("expectRed.anchorOutOfVersionIsInconclusive", classifyExpectRed([...namedRed.filter((row) => row.name !== "userSurface.bundleResolution" && row.name !== "userSurface.profileRowListWins"), redRow("userSurface.bundleResolution", false, "source=install-anchor version=0.16.0 profileVersion=0.16.1 sameCopyDigests=false")], [], expectTarget).ok === false,
    "an anchor red at a version this run did not stage is NOT the named cause")
  arm("expectRed.identicalCopiesAreInconclusive", classifyExpectRed([...namedRed.filter((row) => row.name !== "userSurface.bundleResolution" && row.name !== "userSurface.profileRowListWins"), redRow("userSurface.bundleResolution", false, "source=install-anchor version=0.15.5 profileVersion=0.16.1 sameCopyDigests=true")], [], expectTarget).ok === false,
    "source+version without sameCopyDigests=false is not the stale-anchor shape")
  arm("expectRed.unexpectedMissingRowIsInconclusive", classifyExpectRed([...namedRed.filter((row) => row.name !== "userSurface.profileRowListWins" && row.name !== "userSurface.bundleResolution" && row.name !== "userSurface.row.mpd-cellwork"), redRow("userSurface.profileRowListWins", false, "profileRows=36 bootEntries=154 missing=mpd-roles")], [], expectTarget).ok === false,
    "a row-list red that does not name mpd-cellwork is not the named cause")
  arm("expectRed.structuralProblemIsInconclusive", classifyExpectRed(namedRed, ["the installed artifact has no rows"], expectTarget).ok === false,
    "a structural problem outranks a matching cause: the run never enumerated its subject")
  return arms
}

/**
 * Run the offline arms and print one line each.
 * @returns The process exit code: 0 when every arm held.
 */
function runSelfTest(): number {
  /** Every arm's outcome. */
  const arms = selfTestArms()
  /** The arms that did not hold. */
  const failed = arms.filter((entry) => !entry.ok)
  for (const entry of arms) console.log("[user-surface self-test] " + (entry.ok ? "ok" : "FAIL") + "  " + entry.name + " — " + entry.detail)
  console.log("[user-surface self-test] arms=" + String(arms.length) + " failed=" + String(failed.length))
  return failed.length === 0 ? 0 : 1
}

// ── the real run ────────────────────────────────────────────────────────────

/**
 * Append the probe row to a sandbox profile's own user layer.
 *
 * The USER LAYER is the documented place a profile's owner adds rows, so instrumentation mounted
 * there is not a product row and cannot satisfy a product assertion: the probe's id is unique, and
 * this case asserts the artifact's FORTY-NINE-ish rows, none of which is the probe.
 * @param profileDir The sandbox profile directory.
 * @param probeOut Where the probe writes its record.
 * @returns The text appended, for the run log.
 */
function appendProbeRow(profileDir: string, probeOut: string): string {
  /** The profile's user patch layer, created when the profile has none. */
  const patchFile = join(profileDir, "cordis.patch.yml")
  /** The row: instrumentation only, keyed by an id no product layer declares. */
  const block = [
    "",
    "# QA instrumentation (user-surface-mount): mounted so the case can read the LIVE loader and the",
    "# harness command registry from inside the real boot. This row is not a product row and is never",
    "# one of the rows under assertion.",
    "- insert:",
    "    - id: qa-user-surface-probe",
    "      name: " + JSON.stringify(PROBE_MODULE),
    "      config:",
    "        outFile: " + JSON.stringify(probeOut),
    "        settleMs: 6000",
    "        ticks: 22",
    "",
  ].join("\n")
  if (existsSync(patchFile)) appendFileSync(patchFile, block)
  else writeFileSync(patchFile, block)
  return block
}

/**
 * Why a `--stale-bundle` run cannot build its install anchor, or "" when it can.
 *
 * The anchor layout copies the RUNNING harness package beside the stale bundle, so it needs a resolved
 * harness install to copy FROM. When `command -v dsh` answers nothing the anchor is "", `dirname("")`
 * is ".", and the copy would recursively clone the process CWD into the sandbox before dying as an
 * opaque boot-crash (CodeRabbit F10, PR #75). Pure on purpose: the offline arms can then prove the
 * refusal exists, and `runReal` turns a non-empty answer into exit 2 plus this sentence.
 * @param pathDsh What `command -v dsh` answered ("" when the binary is absent).
 * @param pathAnchor The anchor `package.json` that `dsh` belongs to ("" when unresolved).
 * @param harnessDir The harness package directory to copy ("" when unresolved; never ".").
 * @returns One readable sentence naming what is missing, or "" when the copy is possible.
 */
export function staleAnchorRefusal(pathDsh: string, pathAnchor: string, harnessDir: string): string {
  if (pathDsh === "") return "--stale-bundle needs a `dsh` on PATH: `command -v dsh` answered nothing, so there is no installed harness package to copy beside the stale bundle — refusing instead of copying the current directory"
  if (pathAnchor === "" || harnessDir === "" || harnessDir === ".") return "--stale-bundle could not resolve the install anchor of " + pathDsh + ": no anchor package.json was found, and dirname of an empty anchor is the current directory, so there is no safe source to copy beside the stale bundle"
  if (!existsSync(join(harnessDir, "package.json"))) return "--stale-bundle resolved the anchor to " + pathAnchor + ", but no package.json sits in " + harnessDir + ", so the harness copy would be empty"
  return ""
}

/**
 * Place a stale bundle on an install anchor and return the anchor prefix's `dsh` shim.
 *
 * EQUIVALENCE, stated where the reproduction lives: the 0.16.1 defect needs a SECOND bundle copy on
 * the loader's install anchor. This builds exactly that layout under a sandbox prefix — the harness
 * package copied beside it, the stale bundle as a sibling `@mpd-dsh/mpd` — because the loader derives
 * its anchor from the RUNNING package's own path (`INSTALL_ANCHOR` in dsh's `profile-boot`), so a
 * sibling layout in any prefix resolves identically to a global `npm i -g`. What it does NOT
 * reproduce: a real `npm i -g` (no registry), and the stale copy's `dist` modules (irrelevant: in the
 * measured defect the row MODULES already came from the profile, and the row LIST came from the
 * anchor — which is what this layout reproduces).
 * @param root The sandbox root.
 * @param staleBundle Absolute path of the bundle package to place on the anchor.
 * @param harnessSource Absolute path of the currently installed `@deepseek-ai/dsh` package.
 * @returns The absolute path of the `dsh` shim the boot must find on PATH, plus the anchor package.json.
 */
function buildStaleAnchor(root: string, staleBundle: string, harnessSource: string): { dshShim: string; anchorPackageJson: string } {
  /** The prefix root, laid out like an npm global prefix (`lib/node_modules/@scope/name`). */
  const prefix = join(root, "anchor")
  /** Where a global install puts its packages. */
  const modules = join(prefix, "lib", "node_modules")
  mkdirSync(join(modules, "@mpd-dsh"), { recursive: true })
  mkdirSync(join(prefix, "bin"), { recursive: true })
  cpSync(staleBundle, join(modules, "@mpd-dsh", "mpd"), { recursive: true, dereference: false })
  cpSync(harnessSource, join(modules, "@deepseek-ai", "dsh"), { recursive: true, dereference: false })
  /** The anchor `package.json` the loader will derive from the running package. */
  const anchorPackageJson = join(modules, "@deepseek-ai", "dsh", "package.json")
  /** The shim: `dsh` on PATH that runs the SANDBOX copy, so its anchor is the sandbox prefix. */
  const dshShim = join(prefix, "bin", "dsh")
  writeFileSync(dshShim, "#!/bin/sh\nexec node \"" + join(modules, "@deepseek-ai", "dsh") + "/lib/bin.js\" \"$@\"\n", { mode: 0o755 })
  return { dshShim, anchorPackageJson }
}

/**
 * Build the palette drive: open the palette once, then one filter-and-capture step per command.
 * @param names The command names to capture, negative control last.
 * @returns The tmux steps, in drive order.
 */
function paletteSteps(names: readonly string[]): Array<{ name: string; keys: string[]; waitMs: number }> {
  /** The drive, in order. */
  const steps: Array<{ name: string; keys: string[]; waitMs: number }> = [{ name: "palette-open", keys: ["/"], waitMs: 2500 }]
  for (const name of names) {
    // The two sanity captures straddle the CONTROL's own capture: the palette must be ALIVE either
    // side of the fabricated name, because on a real 0.17.0 host a zero-match filter CLOSES the box
    // (see evaluateNegativeControl). The "before" capture must precede typing the name.
    if (name === NEGATIVE_CONTROL) steps.push({ name: "palette-alive-before", keys: [], waitMs: 1500 })
    // The query filters the palette; the capture that follows is the user-visible witness.
    steps.push({ name: "cmd-" + name, keys: [name], waitMs: 2500 })
    // Clearing with exactly the typed length keeps the next filter from inheriting this one.
    steps.push({ name: "clear-" + name, keys: Array.from({ length: name.length }, () => "BSpace"), waitMs: 700 })
    if (name === NEGATIVE_CONTROL) steps.push({ name: "palette-alive-after", keys: [], waitMs: 1500 })
  }
  steps.push({ name: "palette-close", keys: ["Escape"], waitMs: 1000 })
  // THE TURN IS PART OF THE WITNESS, not a demo: the `mpd` preset's rows are AGENT-scoped, so with no
  // session they are composed but never activated (measured: 26 of them held `state:null` and 9 were
  // absent entirely), and the per-agent command view does not exist. One stub-answered turn creates
  // the session, applies the preset's rows and gives the probe an agent to list commands for.
  steps.push({ name: "prompt-clear", keys: ["C-u"], waitMs: 500 })
  steps.push({ name: "prompt", keys: ["ping"], waitMs: 800 })
  steps.push({ name: "turn", keys: ["Enter"], waitMs: 45_000 })
  return steps
}

/**
 * Copy the caller's installed profile into the sandbox, byte for byte.
 * @param source The installed profile directory.
 * @param destination The sandbox profile directory.
 */
function copyProfile(source: string, destination: string): void {
  mkdirSync(dirname(destination), { recursive: true })
  cpSync(source, destination, { recursive: true, dereference: true, preserveTimestamps: true })
}

/**
 * Run the real boot and produce the verdict.
 * @param options The parsed command line.
 * @returns The process exit code.
 */
async function runReal(options: CaseOptions): Promise<number> {
  /** When the run started. */
  const startedAt = new Date()
  /** Where the evidence lands. */
  const evidenceDir = options.evidence === "" ? join(DEFAULT_EVIDENCE_ROOT, stamp(startedAt)) : options.evidence
  mkdirSync(evidenceDir, { recursive: true })
  /** The palette captures, kept apart so a reader can re-parse them. */
  const paletteDir = join(evidenceDir, "palette")
  mkdirSync(paletteDir, { recursive: true })
  /** One line per step, written to the evidence as `run.log`. */
  const log: string[] = []
  /** Append one line to the run log and to stdout. */
  const say = (line: string): void => { log.push(line); console.log(line) }
  /** Structural problems that make the run unverifiable; a non-empty list fails it. */
  const problems: string[] = []

  say("== " + SLUG + " ==")
  say("startedAt=" + startedAt.toISOString())
  say("profile=" + options.profile)
  say("staleBundle=" + (options.staleBundle === "" ? "(none)" : options.staleBundle))
  say("evidence=" + evidenceDir)

  // 1. The subject: the INSTALLED artifact's own layers. Never the checkout, never a hardcoded list.
  /** The bundle directory inside the profile. */
  const bundleDir = join(options.profile, "node_modules", "@mpd-dsh", "mpd")
  /** The profile manifest, whose dependency spec is the version the user asked for. */
  const profileManifest = existsSync(join(options.profile, "package.json"))
    ? JSON.parse(readFileSync(join(options.profile, "package.json"), "utf8")) as { dsh?: { profile?: { bundles?: string[] } }; dependencies?: Record<string, string> }
    : undefined
  /** The row enumeration: the whole assertion set below is derived from this. */
  const artifact = enumerateArtifactRows(bundleDir)
  say("bundleDir=" + bundleDir)
  say("artifact version=" + artifact.version + " layers=" + String(artifact.patchFiles.length) + " rows=" + String(artifact.rows.length))
  say("profile bundles=" + JSON.stringify(profileManifest?.dsh?.profile?.bundles ?? []) + " declared spec=" + JSON.stringify(profileManifest?.dependencies?.["@mpd-dsh/mpd"] ?? ""))
  if (artifact.problems.length > 0) for (const problem of artifact.problems) problems.push(problem)

  // 2. The sandbox: a fresh DSH_HOME/HOME/workspace, the profile COPIED in (never mounted).
  mkdirSync(SCRATCH_ROOT, { recursive: true })
  /** The sandbox root every path below lives under. */
  const sandbox = mkdtempSync(join(SCRATCH_ROOT, SLUG + "-"))
  /** The sandbox DSH_HOME. */
  const dshHome = join(sandbox, "dshhome")
  /** The sandbox profile directory the boot will use. */
  const profileDir = join(dshHome, "profiles", "dsh-tui")
  /** The session workspace every spawn is anchored to. */
  const ws = join(sandbox, "ws")
  mkdirSync(ws, { recursive: true })
  say("sandbox=" + sandbox + " (DSH_HOME=" + dshHome + ", ws=" + ws + ")")
  copyProfile(options.profile, profileDir)
  say("profile copied into the sandbox (source untouched, read-only)")
  /** The probe's record file, ABSOLUTE because the boot's cwd is the sandbox workspace, not this one. */
  const probeOut = join(resolve(evidenceDir), "probe.json")
  say("probe row appended to the SANDBOX profile's user layer:\n" + appendProbeRow(profileDir, probeOut))
  /** The sandbox HOME fixture: the onboarding skip plus the `mpd` preset preference. */
  const home = provisionTuiHome(sandbox, "mpd")
  say("HOME fixture written: " + home.evidence.join(", ") + " preset=" + home.preset)

  // 3. Which `dsh` will boot, and which anchor its bundle resolution reads.
  /** The `dsh` this machine's PATH resolves (the normal arm). */
  const pathDsh = String(spawnSync("sh", ["-c", "command -v dsh"], { encoding: "utf8" }).stdout).trim()
  /** The anchor `package.json` of the dsh this machine's PATH resolves, i.e. the one that will boot. */
  const pathAnchor = pathDsh === "" ? "" : installAnchorOf(pathDsh)
  // The harness package the stale anchor's copy is made from. "" when no anchor resolved — NEVER
  // `dirname("")`, which is "." and would hand `cpSync` the whole process CWD (CodeRabbit F10).
  const harnessSource = pathAnchor === "" ? "" : dirname(pathAnchor)
  // Why a stale-anchor run must refuse BEFORE anything is copied, or "" when it can build one.
  const staleRefusal = options.staleBundle === "" ? "" : staleAnchorRefusal(pathDsh, pathAnchor, harnessSource)
  /** The environment the TUI boot inherits (PATH possibly redirected at the stale anchor). */
  let bootEnv: Record<string, string | undefined> = {}
  /** The anchor `package.json` the boot will derive its bundle resolution from. */
  let anchorPackageJson = pathAnchor
  if (options.staleBundle !== "") {
    if (staleRefusal !== "") {
      // EXIT 2, ONE READABLE SENTENCE, NO PARTIAL SANDBOX: a refused prerequisite is not a case
      // failure (exit 1), never a silent ".". Before F10 this path threw out of `cpSync(".")` and the
      // entry point reported an opaque `reason=boot-crash`.
      say("REFUSED: " + staleRefusal)
      writeFileSync(join(evidenceDir, "run.log"), log.join("\n") + "\n")
      writeFileSync(join(evidenceDir, "refused.json"), JSON.stringify({ case: SLUG, refused: true, exitCode: 2, reason: staleRefusal, pathDsh, pathAnchor, harnessSource, staleBundle: options.staleBundle }, null, 2) + "\n")
      console.error("[mpd-qa] FAIL case=" + SLUG + " lane=real reason=absent-dsh-binary prereq=\"command -v dsh\" remedy=\"install @deepseek-ai/dsh so the stale anchor has a harness package to copy, or drop --stale-bundle\"")
      console.error(staleRefusal)
      if (!options.keepSandbox) rmSync(sandbox, { recursive: true, force: true })
      return 2
    }
    /** The stale-anchor prefix this run boots through. */
    const stale = buildStaleAnchor(sandbox, options.staleBundle, harnessSource)
    anchorPackageJson = stale.anchorPackageJson
    bootEnv = { PATH: dirname(stale.dshShim) + ":" + String(process.env.PATH ?? "") }
    say("STALE ANCHOR: a " + readVersion(options.staleBundle) + " bundle was placed at " + join(sandbox, "anchor", "lib", "node_modules", "@mpd-dsh", "mpd"))
    say("STALE ANCHOR: PATH now starts with " + dirname(stale.dshShim) + ", so the boot's own install anchor is the sandbox copy")
  }
  say("dsh on PATH=" + pathDsh + " anchor=" + anchorPackageJson)

  // 4. The real boot: the `dsh-tui` launcher on a real PTY, NO overlay and NO module path of ours
  //    except the instrumentation row appended above. A loopback Messages stub answers the one turn,
  //    so no provider credential is read and no network is used.
  /** The names to capture, the negative control last. */
  const captureNames = [...CONTRIBUTED_COMMANDS, NEGATIVE_CONTROL]
  // NO MODEL STUB IS INSTALLED, and that is a measured choice: pointing DEEPSEEK_BASE_URL at a
  // Messages-shaped stub stalled this host's startup past the readiness budget (measured
  // 2026-10-27: the pane still read `正在启动 DSH…` at 180 s with zero stub requests), while the turn
  // below starts a real session either way. The turn's model call is expected to FAIL — the sandbox
  // carries no credential — and every witness this case reads is in place before that call: the agent
  // exists, the `mpd` preset's agent-scoped rows apply, and `commands.list(agent)` answers.
  say("== boot + palette (" + String(captureNames.length) + " captures) + one turn (no credential: the call is expected to fail) ==")
  /** The tmux drive's result. */
  const session = runTuiSession({
    lane: "user-surface",
    root: sandbox,
    outDir: paletteDir,
    bootWaitMs: 180_000,
    extraEnv: bootEnv,
    steps: paletteSteps(captureNames),
  })
  say("boot failures=" + JSON.stringify(session.failures))
  if (session.failures.length > 0) for (const failure of session.failures) problems.push("boot: " + failure)
  // The turn's own evidence: whether a session was created at all is read from the probe (agentCount),
  // not from the model's answer, which this run expects to fail for lack of a credential.

  // 5. The observations: the probe's in-process record, the sinks, the palette captures.
  say("== observations ==")
  /** The probe's record, or undefined when its row never wrote one. */
  const probe = existsSync(probeOut)
    ? JSON.parse(readFileSync(probeOut, "utf8")) as { phase?: string; loaderRows?: RowObservation[]; commands?: string[]; tools?: string[]; agentPreset?: string | null; problems?: string[] }
    : undefined
  if (probe === undefined) problems.push("the probe row wrote no record: the sandbox profile's user layer did not mount it")
  /** The loader's per-row observations. */
  const observations: RowObservation[] = probe?.loaderRows ?? []
  /** The command names the live registry listed for the session's agent. */
  const registryCommands = probe?.commands ?? []
  /** The tool names the live registry answered to. */
  const liveTools = new Set(probe?.tools ?? [])
  /** The tool names the HARNESS showed the model, read from its own session store (never from prose). */
  const recordedTools: string[] = (() => {
    try {
      /** The decoded session store of the sandbox workspace (multi-frame; the lib decodes each frame). */
      const store = readSessionEvents(dshHome, { workspace: ws })
      return recordedToolNames(store.records)
    } catch { return [] }
  })()
  for (const name of recordedTools) liveTools.add(name)
  say("session-log tools=" + String(recordedTools.length) + " (request/header, the agent's own offer)")
  say("probe phase=" + String(probe?.phase ?? "-") + " loaderEntries=" + String(observations.length) + " commands=" + String(registryCommands.length) + " tools=" + String(liveTools.size) + " agentPreset=" + String(probe?.agentPreset ?? "-"))
  if ((probe?.problems ?? []).length > 0) say("probe problems=" + JSON.stringify(probe?.problems))
  /** The row sinks the boot wrote into the sandbox workspace. */
  const sinks = sinkRows(join(ws, ".mpd", "logs"))
  say("sinks=" + String(sinks.length) + " (" + sinks.map((entry) => entry.id).join(",") + ")")
  mkdirSync(join(evidenceDir, "sinks"), { recursive: true })
  for (const sink of sinks) copyFileSync(join(ws, ".mpd", "logs", sink.id + ".log"), join(evidenceDir, "sinks", sink.id + ".log"))

  // 6. Per-row registration candidates: a name the row's OWN module declares AND the boot holds.
  /** Which module-declared names each row can be witnessed by. */
  const registrationHits = new Map<string, readonly string[]>()
  /** How many rows had a readable module at all, for the honest bound in the report. */
  let scannedModules = 0
  for (const row of artifact.rows) {
    /** The module file the row names, resolved through the artifact or the profile's node_modules. */
    const moduleFile = resolveRowModule(row.name, bundleDir, [
      profileDir,
      dirname(profileDir),
      // The preset rows name HARNESS packages (`@deepseek-ai/dsh-tool-bash`, …), which live in the dsh
      // installation's own node_modules — never in the profile. Without this root those rows resolve
      // nowhere and their registrations cannot be witnessed (measured: 29 of 69 modules resolved).
      ...(anchorPackageJson === "" ? [] : [dirname(anchorPackageJson)]),
    ])
    if (moduleFile === "") continue
    scannedModules += 1
    /** The live names this row's module declares. */
    const hits = scanModule(moduleFile).filter((candidate) => liveTools.has(candidate) || registryCommands.includes(candidate))
    if (hits.length > 0) registrationHits.set(row.id, hits)
  }
  say("modules scanned=" + String(scannedModules) + "/" + String(artifact.rows.length) + " rows with a live registration witness=" + String(registrationHits.size))

  // 7. Enumerate-and-grade. Every row the artifact declares gets its own assertion.
  /** The per-row verdicts, one per declared row. */
  const rowVerdicts: RowVerdict[] = evaluateRows(artifact.rows, observations, sinks.map((entry) => entry.id), registrationHits, {
    agentPreset: probe?.agentPreset ?? null,
    presetLayer: "presets/mpd.patch.yml",
  })
  /** The assertions this run will report, in report order. */
  const assertions: UserSurfaceAssertion[] = []
  /** Record one assertion. */
  const push = (assertion: UserSurfaceAssertion): void => { assertions.push(assertion) }
  // THE GATING RULE (CodeRabbit F11, PR #75): a command failure GATES unless the command is named in
  // `NON_GATING_COMMANDS` — today exactly one id, `/mpd-codegraph` — AND every declared row of the
  // artifact was witnessed in the same boot. The previous rule ("non-gating whenever every row
  // mounted") excused ANY undocumented command failure, so a fully mounted boot could ship with
  // `/cellwork` unreachable and still read green. The whitelist keeps the exception explicit, one id,
  // and reviewable: everything else gates, including a command whose failure nobody has seen yet.
  // A command failure on an INCOMPLETE composition always gates, which is what makes the stale-anchor
  // regression red. A whitelisted finding is recorded as `ok:null` plus the surfaces that answered
  // "no": visible on the record, listed in `userSurface.findings`, and never read as a pass.
  /** True when NO declared row failed — a declared bound is allowed here (it is not a defect). */
  const compositionComplete = rowVerdicts.every((verdict) => verdict.ok !== false)
  /** The findings this run tracks instead of gating on. */
  const findings: string[] = []
  /** The witness counts, for the summary line. */
  const witnessCounts: Record<string, number> = {}
  for (const verdict of rowVerdicts) {
    witnessCounts[verdict.witness] = (witnessCounts[verdict.witness] ?? 0) + 1
    push({ name: "userSurface.row." + verdict.id, ok: verdict.ok, reason: verdict.reason, raw: verdict.raw })
    /** This row's declared-bound marker, or null when the row is not a bound. */
    const boundMarker = declaredBoundMarker(verdict)
    if (boundMarker !== null) push(boundMarker)
  }
  push({
    name: "userSurface.rowsEnumerated",
    ok: artifact.problems.length === 0 && artifact.rows.length > 0,
    reason: artifact.problems.length === 0 ? "the installed artifact's own layers were enumerated at run time" : artifact.problems.join("; "),
    raw: "version=" + artifact.version + " layers=" + artifact.patchFiles.map((file) => basename(file)).join(",") + " rows=" + String(artifact.rows.length) + " disabled=" + artifact.rows.filter((row) => row.disabled).map((row) => row.id).join(","),
  })
  /** The rows that FAILED (defective); a null row is a declared bound, reported separately. */
  const failedRows = rowVerdicts.filter((verdict) => verdict.ok === false)
  /** The rows this run could not prove, listed by id so the bound is auditable. */
  const boundRows = rowVerdicts.filter((verdict) => verdict.ok === null)
  push({
    name: "userSurface.rowsWitness",
    ok: failedRows.length === 0,
    reason: failedRows.length === 0
      ? "no declared row is defective in the real boot (" + String(rowVerdicts.length - boundRows.length) + " witnessed, " + String(boundRows.length) + " declared bounds)"
      : String(failedRows.length) + " declared row(s) are not effective: " + failedRows.map((verdict) => verdict.id).join(","),
    raw: "witnessCounts=" + JSON.stringify(witnessCounts) + " failed=" + (failedRows.map((verdict) => verdict.id + "(" + verdict.witness + ")").join(",") || "-"),
  })
  push({
    name: "userSurface.rowsDeclaredBound",
    ok: true,
    reason: boundRows.length === 0 ? "every declared row was individually witnessed" : String(boundRows.length) + " row(s) are COMPOSED BUT NOT PROVEN on this plane; their ids are listed so no reader mistakes them for a pass",
    raw: "bound=" + (boundRows.map((verdict) => verdict.id + "(" + verdict.witness + ")").join(",") || "-"),
  })

  // 8. The seven contributed commands, each against the registry and the palette.
  /** The corpus guard first: an expected set that is not the published seven is a defect in this case. */
  const corpus = corpusProblems(CONTRIBUTED_COMMANDS)
  push({ name: "userSurface.commandCorpus", ok: corpus.length === 0, reason: corpus.length === 0 ? "the expected set is exactly the published seven" : corpus.join("; "), raw: "expected=" + CONTRIBUTED_COMMANDS.join(",") })
  /** One palette capture per command, keyed by name. */
  const panes = new Map<string, string>()
  for (const name of captureNames) {
    /** The capture file `runTuiSession` wrote for this step. */
    const file = join(paletteDir, "cmd-" + name + ".pane.txt")
    panes.set(name, existsSync(file) ? readFileSync(file, "utf8") : "")
  }
  /** The palette counts, quoted in the facts. */
  const paletteCounts: Record<string, number | null> = {}
  for (const name of CONTRIBUTED_COMMANDS) {
    paletteCounts[name] = paletteCount(panes.get(name) ?? "")
    /** This command's verdict. */
    const verdict = evaluateCommand(name, registryCommands, panes.get(name) ?? "")
    if (commandGates(name, verdict.ok, compositionComplete)) {
      push({ name: "userSurface.command." + name, ok: verdict.ok, reason: verdict.reason, raw: verdict.raw, gating: true })
    } else {
      /** The finding's id, stable and greppable in the evidence and the report. */
      const findingId = "documented-command-unreachable:" + name
      findings.push(findingId)
      push({
        name: "userSurface.command." + name,
        ok: null,
        reason: "FINDING " + findingId + ": the composition mounted completely, yet " + verdict.reason,
        raw: verdict.raw,
        gating: false,
        finding: findingId,
      })
    }
  }
  /** The capture taken just BEFORE the fabricated name is typed (an empty query must draw a full box). */
  const aliveBefore = existsSync(join(paletteDir, "palette-alive-before.pane.txt")) ? readFileSync(join(paletteDir, "palette-alive-before.pane.txt"), "utf8") : ""
  /** The capture taken just AFTER that query is cleared, so the palette is shown alive on both sides. */
  const aliveAfter = existsSync(join(paletteDir, "palette-alive-after.pane.txt")) ? readFileSync(join(paletteDir, "palette-alive-after.pane.txt"), "utf8") : ""
  /** The live negative control's verdict: a command nothing contributes must be absent everywhere. */
  const control = evaluateNegativeControl(NEGATIVE_CONTROL, registryCommands, panes.get(NEGATIVE_CONTROL) ?? "", aliveBefore, aliveAfter)
  push({ name: "userSurface.negativeControl", ok: control.ok, reason: control.reason, raw: control.raw })
  // The findings are ASSERTED AS RECORDED, so a run that silently dropped one reddens here.
  push({
    name: "userSurface.findings",
    ok: true,
    reason: findings.length === 0 ? "no non-gating finding on this run" : String(findings.length) + " non-gating finding(s) recorded: " + findings.join(","),
    raw: findings.join(",") || "-",
  })

  // 9. The upgrade path: the PROFILE's list won, and the loader resolved the profile's copy.
  /** The rows that must appear as loader entries: everything the preset does not materialise itself. */
  const structuralRows = artifact.rows.filter((row) => !row.patch.endsWith("presets/mpd.patch.yml"))
  /** The row-list verdict: every structural row the profile declares must be composed by the boot. */
  const profileRows = evaluateProfileRowList(structuralRows, observations)
  push({ name: "userSurface.profileRowListWins", ok: profileRows.ok, reason: profileRows.ok ? "every non-preset row the profile's artifact declares is composed by the boot" : "the boot did not compose " + String(profileRows.missing.length) + " profile row(s): " + profileRows.missing.join(","), raw: profileRows.raw })
  /** The resolution replay: the same precedence `resolveBundleDir` uses, labelled as a replay. */
  const resolution = replayBundleResolution(anchorPackageJson, profileDir, "@mpd-dsh/mpd")
  /** True when every patch layer the loader resolved is BYTE-IDENTICAL to the profile's artifact layer. */
  const sameCopies = resolution.dir !== "" && artifact.patchFiles.every((file) => {
    /** The layer's path relative to the artifact (and therefore relative to the resolved copy too). */
    const relative = file.slice(bundleDir.length + 1)
    return sha256File(file) !== "" && sha256File(file) === sha256File(join(resolution.dir, relative))
  })
  push({
    name: "userSurface.bundleResolution",
    ok: resolution.dir !== "" && resolution.version === artifact.version && sameCopies,
    reason: resolution.dir === "" ? "the loader's bundle resolution could not be replayed" : "the loader resolves " + resolution.source + " copy " + resolution.version + " while the profile's artifact is " + artifact.version,
    raw: "source=" + resolution.source + " dir=" + resolution.dir + " version=" + resolution.version + " profileVersion=" + artifact.version + " sameCopyDigests=" + String(sameCopies),
  })

  // 10. Isolation: no session store may be keyed to this checkout.
  try {
    /** The isolation verdict: the store keys the harness wrote, all inside the sandbox. */
    const isolation = assertSessionsSandboxed(dshHome, sandbox, { label: SLUG })
    push({ name: "userSurface.isolation", ok: true, reason: "every session-store key is inside the sandbox", raw: "checked=" + String(isolation.checked) + " keys=" + isolation.keys.join(",") })
  } catch (error) {
    push({ name: "userSurface.isolation", ok: false, reason: String((error as { message?: unknown } | null)?.message ?? error), raw: "dshHome=" + dshHome + " sandbox=" + sandbox })
  }

  // 11. The record.
  /** True when the boot never mounted the probe at all: nothing below can be trusted then. */
  const probeMissing = probe === undefined
  if (probeMissing) {
    push({ name: "userSurface.probe", ok: false, reason: "the instrumentation row wrote no record, so the loader/registry observations are absent", raw: "probeOut=" + probeOut })
  } else {
    push({ name: "userSurface.probe", ok: true, reason: "the instrumentation row mounted and recorded the live loader and registries", raw: "phase=" + String(probe?.phase) + " loaderEntries=" + String(observations.length) + " commands=" + String(registryCommands.length) + " tools=" + String(liveTools.size) })
  }
  /** Every assertion that FAILED: a non-gating finding is recorded as null and never reddens the run. */
  const failed = assertions.filter((assertion) => assertion.ok === false)
  /** The subject facts, quoted with the verdict. */
  const facts: UserSurfaceFacts = {
    profileDir,
    bundleDir,
    bundleVersion: artifact.version,
    patchFiles: artifact.patchFiles,
    rowCount: artifact.rows.length,
    resolution: { dir: resolution.dir, version: resolution.version, source: resolution.source },
    sinks,
    witnessCounts,
    registryCommands,
    paletteCounts,
    agentPreset: probe?.agentPreset ?? null,
  }
  /** The whole record. */
  const result: UserSurfaceResult = {
    case: SLUG,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    ok: failed.length === 0 && problems.length === 0,
    complete: true,
    mode: options.staleBundle === "" ? "profile-artifact" : "stale-install-anchor",
    assertions,
    facts,
    doesNotProve: [
      "a live model turn: no credential is staged and no turn is driven (the row and command surfaces do not need one)",
      "the Web plane: the palette witness is the TUI, and /mpd + /mpd-model are documented TUI-only",
      "a packed/tarball install: the subject is whatever profile --profile names",
      "that a row's apply() produced the user-visible behaviour of its feature: this case proves the row is mounted and its capability is registered, not that the feature works",
    ],
  }
  writeFileSync(join(evidenceDir, "result.json"), JSON.stringify(result, null, 2) + "\n")
  writeFileSync(join(evidenceDir, "rows.json"), JSON.stringify(rowVerdicts, null, 2) + "\n")
  writeFileSync(join(evidenceDir, "run.log"), log.join("\n") + "\n")
  for (const assertion of assertions) appendNdjson(options.ndjsonOut, assertion)
  if (options.jsonOut !== "") writeFileSync(options.jsonOut, JSON.stringify(result, null, 2) + "\n")
  /** The assertions recorded as a declared bound or a non-gating finding. */
  const notProven = assertions.filter((assertion) => assertion.ok === null)
  /** The one-line verdict, printed last so a reader sees it without opening the record. */
  const summary = "assertions=" + String(assertions.length) + " passed=" + String(assertions.length - failed.length - notProven.length) + " failed=" + String(failed.length) + " findings_or_bounds=" + String(notProven.length) + (failed.length > 0 ? " FAILED=[" + failed.map((assertion) => assertion.name).join(",") + "]" : "") + (notProven.length > 0 ? " NOT_PROVEN=[" + notProven.map((assertion) => assertion.name).join(",") + "]" : "")
  say(summary + " problems=" + String(problems.length) + (problems.length > 0 ? " [" + problems.join(" | ") + "]" : ""))
  say("evidence=" + evidenceDir)

  // 12. Housekeeping: the sandbox is 1.3 GB of copied profile and harness, so it goes unless asked for.
  if (!options.keepSandbox) {
    rmSync(sandbox, { recursive: true, force: true })
    say("sandbox removed (pass --keep-sandbox to keep it)")
  }

  /** True when the run should be reported GREEN: every expectation held. */
  const green = failed.length === 0 && problems.length === 0
  if (options.expectRed) {
    // The falsification arm REDUCED TO A NAMED CAUSE (CodeRabbit N3, PR #75). A bare `green === false`
    // also accepted a crashed boot, a palette that never captured and a structural enumeration failure
    // as "the stale install anchor was detected". The classifier reads the SAME assertion rows this
    // run just recorded and only accepts the two named causes, refusing any red outside their
    // downstream family; `expect-red.json` keeps the verdict beside the record it graded.
    /** The version the staged stale bundle carries, i.e. what the install anchor had to resolve; "" when none was staged. */
    const staleVersion = options.staleBundle === "" ? "" : readVersion(options.staleBundle)
    /** The named-cause verdict over this run's own assertions. */
    const expectation = classifyExpectRed(assertions, problems, { staleVersion, expectedRow: "mpd-cellwork" })
    say("expect-red: " + expectation.sentence)
    if (!expectation.ok) console.error("[mpd-qa] INCONCLUSIVE case=" + SLUG + " lane=real reason=expect-red-not-the-named-cause cause=" + (expectation.cause === "" ? "-" : expectation.cause) + " unexplained=" + (expectation.unexplained.join(",") || "-"))
    writeFileSync(join(evidenceDir, "expect-red.json"), JSON.stringify({ case: SLUG, stagedStaleVersion: staleVersion, expectedRow: "mpd-cellwork", green, ...expectation }, null, 2) + "\n")
    return expectation.ok ? 0 : 1
  }
  return green ? 0 : 1
}

/**
 * Entry point: `--self-test` runs the offline arms, otherwise the real boot runs.
 * @returns The process exit code.
 */
async function main(): Promise<number> {
  /** The parsed command line. */
  const options = parseArgs(process.argv.slice(2))
  if (options.selfTest) return runSelfTest()
  if (!existsSync(join(options.profile, "package.json"))) {
    console.error("[mpd-qa] FAIL case=" + SLUG + ' lane=real reason=absent-fixture prereq="' + options.profile + '" remedy="dsh plugin --profile dsh-tui add ."')
    return 1
  }
  if (!tuiBinaryPresent() || !tmuxPresent()) {
    /** Which prerequisite is missing, in the suite's marker grammar. */
    const missing = !tuiBinaryPresent() ? { code: "absent-dsh-binary", probe: "dsh-tui", remedy: "npm i -g @deepseek-harness-tui/dsh-tui@0.17.0" } : { code: "absent-runtime", probe: "tmux", remedy: "apt-get install tmux" }
    /** `--no-skip` turns the skip into the failure it is when a lane asked for it. */
    const strict = process.argv.includes("--no-skip")
    console.log("[mpd-qa] " + (strict ? "FAIL" : "SKIP") + " case=" + SLUG + " lane=real reason=" + missing.code + " prereq=" + missing.probe + ' remedy="' + missing.remedy + '"')
    return strict ? 1 : 0
  }
  return runReal(options)
}

// Guarded on being the ENTRY module: importing this file for its exported helpers must never boot.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => process.exit(code)).catch((error: unknown) => {
    console.error("[mpd-qa] FAIL case=" + SLUG + " lane=real reason=boot-crash prereq=- remedy=\"-\"")
    console.error(String((error as { stack?: unknown } | null)?.stack ?? error))
    process.exit(1)
  })
}

