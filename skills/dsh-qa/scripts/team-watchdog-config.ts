#!/usr/bin/env bun
// Case team-watchdog-config — AC-11: the five declared knobs, their visibility in the ONE
// declaration and in BOTH front doors, the row-config-vs-namespace precedence, and the LIVE
// re-read (a `settings/document-updated` change takes effect without a restart).
//
// Witnesses:
//   * DECLARATION: the five knob paths appear in `packages/mpd-config-plugin/src/settings-schema.ts`
//     (the ONE declaration the settings namespace is built from);
//   * FRONT DOORS, from BUILT BYTES only: the TUI section's built `dist/index.js` and the web
//     card's built `client.js` each carry the same five paths — and the SAME set (set equality,
//     so a knob cannot exist in one door only);
//   * PRECEDENCE + LIVE RE-READ: the REAL watchdog row is mounted over the REAL adapter
//     (`createDshAdapter`) on a stub harness whose `settings` service is a mutable double. With
//     no `watchdog` section the row config is the effective value; once the namespace carries a
//     `watchdog` section, firing `settings/document-updated` (the host's raw-section event the
//     adapter forwards) re-reads the knobs IN PLACE — the running engine reports the new values
//     with no restart;
//   * THE CLAMP (measured semantics): a `tickIntervalMs` at or above `warnSilenceMs` is clamped
//     below it, because a cadence beyond the threshold could never escalate.
//
// Usage:
//   bun skills/dsh-qa/scripts/team-watchdog-config.ts --self-test
//   bun skills/dsh-qa/scripts/team-watchdog-config.ts [--out <dir>]
// Evidence -> evidence/team-watchdog/lanes/<timestamp>-config/{result.json,output.log,raw/}
import { createHash } from "node:crypto"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { PATHS, REPO, captureStdout, evidenceDir, finish, read, sandboxWorkspace, say, selfTest, writeEvidence } from "./lib/watchdog-lane.ts"
import { exitOnRefusal, refuseOverwrite } from "./lib/immutable-output.ts"
import type { LaneCheck, LaneVerdict } from "./lib/watchdog-lane.ts"

/** The lane slug, used to name the evidence directory and to prefix every printed line. */
const SLUG = "team-watchdog-config"
/** The five declared knob paths, which both front doors must carry verbatim. */
const KNOBS = ["watchdog.enabled", "watchdog.warnSilenceMs", "watchdog.tickIntervalMs", "watchdog.warnStreakToEscalate", "watchdog.actionOnEscalate"]
/** The shape the built bytes carry: the section key plus each knob name (camelCase literals). */
const KNOB_KEYS = KNOBS.map((path) => path.split(".")[1])

/** The five watchdog knobs, as a row config or a namespace section carries them. */
interface ConfigKnobs {
  /** Whether the watchdog row is enabled. */
  enabled?: boolean
  /** Silence threshold, in milliseconds. */
  warnSilenceMs?: number
  /** The engine's tick cadence, in milliseconds. */
  tickIntervalMs?: number
  /** How many consecutive silent observations escalate. */
  warnStreakToEscalate?: number
  /** The action at escalation (`pause` preserves the team). */
  actionOnEscalate?: string
}

/** The `watchdog` namespace section this lane seeds: every knob with the value it declares. */
interface NamespaceValues {
  /** Whether the watchdog row is enabled; a synthetic observation may omit it. */
  enabled?: boolean
  /** Silence threshold the namespace declares, in milliseconds. */
  warnSilenceMs: number
  /** The tick cadence the namespace asks for, in milliseconds. */
  tickIntervalMs: number
  /** Consecutive silent observations needed to escalate. */
  warnStreakToEscalate: number
  /** The escalation action (a control mutates this one). */
  actionOnEscalate: string
}

/** The clamp reading: what the namespace asked for, against what the engine actually ran. */
interface ClampReading {
  /** The tick cadence the namespace requested, in milliseconds. */
  readonly requested: number
  /** The silence threshold the cadence had to stay below, in milliseconds. */
  readonly warnSilenceMs: number
  /** The cadence the running engine reports, in milliseconds; absent when it reports none. */
  applied?: number
}

/** Everything the config lane decides from: the declaration, the doors, the mount and the re-read. */
interface ConfigObservation {
  /** The settings-schema source text, scanned for the five knob names. */
  declaration: string
  /** Whether the knobs live in exactly ONE declaration (`SETTINGS_KNOBS` there and nowhere). */
  declarationIsOne: boolean
  /** The built TUI bytes, scanned for the knob names. */
  tuiBytes: string
  /** The built web-client bytes, scanned for the knob names. */
  webBytes: string
  /** Whether both front doors carry the SAME key set. */
  sameSetAcrossDoors: boolean
  /** The row config the mount was applied with. */
  rowConfig: ConfigKnobs
  /** The knobs the mounted engine resolved. */
  knobsAtMount: ConfigKnobs
  /** Whether the row config was the effective value (no namespace section existed). */
  rowConfigEffective: boolean
  /** The `watchdog` namespace section the re-read was driven with. */
  namespaceValues: NamespaceValues
  /** The knobs the SAME engine reported after the document-updated event. */
  knobsAfterEvent: ConfigKnobs | null
  /** Whether the namespace outranked the row config. */
  namespaceWins: boolean
  /** Whether the re-read happened without a restart. */
  liveWithoutRestart: boolean
  /** The clamp reading. */
  clamp: ClampReading
  /** Whether the applied cadence ended up below the silence threshold. */
  clampedBelowSilence: boolean
  /** Whether the resolved escalation action is the preserving pause. */
  actionOnEscalateIsPause: boolean
}

/** The result `run` persists: the lane's identity, its observation and the verdict. */
type ConfigResult = {
  /** What this lane asserts. */
  task: string
  /** The lane slug. */
  lane: string
  /** The sandbox workspace the mount ran in. */
  workspace: string
  /** Everything the verdict read (the long byte reads are truncated for the record). */
  observed: ConfigObservation
  /** Whether every check held. */
  ok: boolean
  /** Every assertion the lane evaluated. */
  checks: LaneCheck[]
  /** Items the lane explicitly does NOT claim. */
  notClaimed: string[]
  /** The evidence file this run wrote, assigned once `writeEvidence` returns. */
  evidenceFile?: string
}

/** The sliver of the mounted watchdog row's apply report this lane reads. */
interface ConfigReport {
  /** The knobs the engine resolved at mount. */
  readonly knobs: ConfigKnobs
  /** The mounted engine, absent or `null` when the row applied none. */
  readonly engine?: ConfigEngine | null
  /** Whether the row applied (an engine exists). */
  readonly applied?: boolean
}

/** The sliver of the mounted engine this lane drives. */
interface ConfigEngine {
  /** The hook the row calls when it re-reads its knobs live. */
  onKnobsChanged?: (next: ConfigKnobs) => void
}

/** One live reading: the mount's value, the on-disk value and the SAME instance's read-back. */
interface LiveReading {
  /** The scenario label (`shipped` or `seeded-revert`); a synthetic arm may omit it. */
  label?: string
  /** The silence threshold the engine reported at mount, in milliseconds. */
  readonly mountedValue: number
  /** The value written to `.mpd/mpd.jsonc`, in milliseconds. */
  readonly fileValue: number
  /** The silence threshold the SAME instance reported after the write, in milliseconds. */
  readonly sameInstanceValue: number
  /** Whether both ticks and both knob reads came from one instance. */
  readonly sameInstance: boolean
  /** Whether the on-disk layer applied. */
  readonly fileApplied?: boolean
  /** The layer the live value came from. */
  readonly liveLayer?: unknown
  /** Whether only a restart could deliver the value. */
  readonly restartRequired?: boolean
  /** The pin's own verdict: the knobs are truly live in-process, with no restart. */
  readonly liveWithoutRestart: boolean
}

/** The `--live` pin's verdict and the process exit code it maps to. */
interface LiveVerdict {
  /** `pass` or `fail`. */
  readonly verdict: string
  /** The exit code the verdict maps to (0 pass, 1 fail). */
  readonly exitCode: number
  /** The one-line detail printed beside it. */
  readonly detail: string
}

/** The knobs the `--live` pin reads back from the engine. */
interface LiveKnobs {
  /** The live silence threshold, in milliseconds. */
  readonly warnSilenceMs: number
}

/** The engine's knob-divergence reading, between the live layers. */
interface KnobDivergence {
  /** Whether the on-disk `.mpd/mpd.jsonc` layer applied. */
  readonly fileApplied?: boolean
  /** The layer the live value came from (`file`, `namespace`, ...). */
  readonly liveLayer?: unknown
  /** Whether only a restart could deliver the new value. */
  readonly restartRequired?: boolean
}

/** The host seam the `--live` pin constructs the engine with. */
interface EngineHost {
  /**
   * @param event The event name to subscribe to.
   * @param handler The listener to capture.
   * @returns The disposer that removes the captured listener.
   */
  on(event: string, handler: (...args: unknown[]) => unknown): () => void
  /** The host logger, which the pin silences. */
  logger: {
    /** Swallow one warn line. */
    warn(...args: unknown[]): void
    /** Swallow one info line. */
    info(...args: unknown[]): void
  }
}

/** The sliver of the watchdog engine the `--live` pin drives. */
interface LiveEngine {
  /** @returns The disposers the install registered. */
  install(): Array<() => void>
  /**
   * @param now The clock reading, in milliseconds.
   * @returns A settled tick.
   */
  tickOnce(now: number): Promise<unknown>
  /** @returns The knobs the engine currently resolves. */
  getKnobs(): LiveKnobs
  /** @returns The engine's divergence reading between the live layers. */
  knobDivergence(): KnobDivergence
  /** @returns The engine's own counters. */
  getStats(): { readonly ticks: number }
  /** Stop the engine's timer. */
  stop(): void
}

/** The engine module the `--live` pin constructs (`WatchdogEngine` over the stub adapter). */
interface EngineModule {
  /** The watchdog engine class. */
  WatchdogEngine: new (adapter: unknown, host: EngineHost, config: unknown) => LiveEngine
}

/** The plugin's own test support module, loaded by ABSOLUTE PATH from the checkout. */
interface WatchdogSupport {
  /**
   * @param options The workspace the stub adapter resolves state from.
   * @returns The stub adapter the engine is built over.
   */
  stubAdapter(options: { readonly workspace: string }): { readonly adapter: unknown }
  /**
   * @param overrides The row-config overrides the test config carries.
   * @returns The row config the engine is constructed with.
   */
  testConfig(overrides: Record<string, unknown>): unknown
}

/** A scratch mutant tree: its root (removed by the caller) and the copied engine source. */
interface ScratchTree {
  /** The scratch root to remove when the run finishes. */
  readonly root: string
  /** The copied engine source the overlay anchor was removed from. */
  readonly enginePath: string
}

/**
 * The crash text for a thrown value, exactly as `String(error?.stack ?? error)` produced it.
 * @param error The thrown value.
 * @returns The `stack` when the value carries one, else the value itself stringified.
 */
function crashText(error: unknown): string {
  // A thrown object's `stack` member; a primitive has none, so the value itself is used.
  const stack = typeof error === "object" && error !== null ? (error as { stack?: unknown }).stack : undefined
  return String(stack ?? error)
}

/**
 * The pure evaluator.
 * @param observed Every reading this run produced: the declaration, the doors, the mount, the re-read.
 * @returns The verdict: whether every check held, plus the checks themselves.
 */
export function evaluate(observed: ConfigObservation): LaneVerdict {
  // One assertion per invariant, printed in the order below.
  const checks: LaneCheck[] = []
  /**
   * Record one assertion.
   * @param id The stable check id (C1..C10).
   * @param ok Whether the assertion held.
   * @param detail The reading printed beside it.
   */
  const add = (id: string, ok: unknown, detail: unknown): void => { checks.push({ id, ok: Boolean(ok), detail: String(detail) }) }

  // The knob keys the ONE declaration is missing.
  const declarationMissing = KNOB_KEYS.filter((key) => !String(observed.declaration ?? "").includes(key))
  add("C1", declarationMissing.length === 0, "the ONE declaration carries all five knobs (missing: " + JSON.stringify(declarationMissing) + ")")
  add("C2", observed.declarationIsOne === true, "the knobs live in exactly ONE declaration (settings-schema.ts) — the front doors derive from it")
  // The knob keys the built TUI bytes are missing.
  const tuiMissing = KNOB_KEYS.filter((key) => !String(observed.tuiBytes ?? "").includes(key))
  // The knob keys the built web-client bytes are missing.
  const webMissing = KNOB_KEYS.filter((key) => !String(observed.webBytes ?? "").includes(key))
  add("C3", tuiMissing.length === 0, "the BUILT TUI bytes carry every knob (missing: " + JSON.stringify(tuiMissing) + ")")
  add("C4", webMissing.length === 0, "the BUILT web client bytes carry every knob (missing: " + JSON.stringify(webMissing) + ")")
  add("C5", observed.sameSetAcrossDoors === true, "both front doors expose the SAME five knobs (no knob reachable from one door only)")

  // Whether the row config was the effective default, knob by knob.
  const rowEffective = observed.rowConfigEffective === true && observed.knobsAtMount?.warnSilenceMs === observed.rowConfig?.warnSilenceMs && observed.knobsAtMount?.tickIntervalMs === observed.rowConfig?.tickIntervalMs && observed.knobsAtMount?.warnStreakToEscalate === observed.rowConfig?.warnStreakToEscalate
  add("C6", rowEffective,
    "with no `watchdog` section the ROW config is the effective value (" + JSON.stringify(observed.rowConfig) + " → " + JSON.stringify(observed.knobsAtMount) + ")")
  // Whether the namespace section won on the two knobs the event carried.
  const namespaceWins = observed.namespaceWins === true && observed.knobsAfterEvent?.warnSilenceMs === observed.namespaceValues?.warnSilenceMs && observed.knobsAfterEvent?.warnStreakToEscalate === observed.namespaceValues?.warnStreakToEscalate
  add("C7", namespaceWins,
    "the NAMESPACE outranks the row config when a `watchdog` section exists (" + JSON.stringify(observed.namespaceValues) + " → " + JSON.stringify(observed.knobsAfterEvent) + ")")
  add("C8", observed.liveWithoutRestart === true,
    "the re-read happened LIVE: the same mounted engine reports the new knobs after the document-updated event, with no restart")
  add("C9", observed.clampedBelowSilence === true && typeof observed.clamp?.applied === "number" && observed.clamp.applied < observed.clamp.warnSilenceMs && observed.knobsAfterEvent?.tickIntervalMs === observed.clamp.applied,
    "the measured clamp holds: tickIntervalMs " + JSON.stringify(observed.clamp?.requested) + " is clamped to " + JSON.stringify(observed.clamp?.applied) + ", below warnSilenceMs " + JSON.stringify(observed.clamp?.warnSilenceMs) + " and equal to the engine's live value " + JSON.stringify(observed.knobsAfterEvent?.tickIntervalMs))
  add("C10", observed.actionOnEscalateIsPause === true && observed.namespaceValues?.actionOnEscalate === "pause" && observed.knobsAfterEvent?.actionOnEscalate === "pause",
    "the escalation action is the PRESERVING pause everywhere it is declared or resolved (" + JSON.stringify({ declared: observed.namespaceValues?.actionOnEscalate, resolved: observed.knobsAfterEvent?.actionOnEscalate }) + ")")
  return { ok: checks.length > 0 && checks.every((check) => check.ok), checks }
}

/**
 * The real lane: read the declaration and both front doors, mount the REAL row, then drive the
 * live re-read.
 * @param argv The process argv, scanned for `--out`.
 * @returns The result object `writeEvidence` persists.
 */
async function run(argv: readonly string[]): Promise<ConfigResult> {
  // The lane's evidence directory: `--out <dir>`, else a fresh timestamped default.
  const dir = evidenceDir(argv, "config")
  // T-83: the evidence target is IMMUTABLE BY DEFAULT — a caller-supplied --out that already exists
  // is refused instead of being rewritten (the T-63/T-76 class: a re-run must never overwrite a record).
  try {
    refuseOverwrite(dir, { label: "evidence directory", remedy: "pass a new --out <dir>, or omit --out for a fresh timestamped directory (T-53)" })
  } catch (error) {
    exitOnRefusal(error, "[" + SLUG + "]")
  }
  // The sandbox workspace the mount resolves state from (never the repository's own `.mpd`).
  const ws = sandboxWorkspace(dir, "config")
  // The settings-schema source: the ONE declaration the knobs are declared in.
  const declaration = read(PATHS.settingsSchema)
  // The built TUI bytes.
  const tuiBytes = read(PATHS.tuiDist)
  // The built web-client bytes.
  const webBytes = read(PATHS.webClient)
  say(SLUG, "declaration: " + PATHS.settingsSchema)
  say(SLUG, "built bytes: tui=" + tuiBytes.length + " B, web=" + webBytes.length + " B")

  // The lane helper's own mount, loaded here exactly as the original did.
  const { mountRealWatchdog } = await import("./lib/watchdog-lane.ts")
  // The row config the mount is applied with (all five knobs, the namespace absent).
  const rowConfig: ConfigKnobs = { enabled: true, warnSilenceMs: 60_000, tickIntervalMs: 5_000, warnStreakToEscalate: 2, actionOnEscalate: "pause" }
  // The real-dist mount over the stub harness.
  const mounted = await mountRealWatchdog({ workspace: ws, config: rowConfig })
  // The mounted row's apply report. The cast is unavoidable: the built row's return value is a
  // runtime artifact `unknown` to the type system, so this lane declares what it consumes.
  const report = mounted.report as ConfigReport
  // The knobs the engine resolved at mount.
  const knobsAtMount = report.knobs
  say(SLUG, "mounted with the row config — knobs: " + JSON.stringify(knobsAtMount))

  // The live re-read: the namespace now carries a `watchdog` section, and the host fires the
  // raw-section event the adapter forwards to the row.
  // The namespace section the re-read is driven with.
  const namespaceValues: NamespaceValues = { warnSilenceMs: 30_000, tickIntervalMs: 40_000, warnStreakToEscalate: 3, actionOnEscalate: "pause", enabled: true }
  // The knobs the SAME engine reports after the re-read, or `null` until the hook fires.
  let liveKnobs: ConfigKnobs | null = null
  // The mounted engine, when the row applied one.
  const engine = report.engine
  if (engine !== undefined && engine !== null) engine.onKnobsChanged = (next) => { liveKnobs = next }
  mounted.setNamespace({ watchdog: namespaceValues }, 7)
  // How many `settings/document-updated` listeners the stub harness fired.
  const fired = await mounted.fire("settings/document-updated", "mpd", 7)
  await new Promise((resolve) => setTimeout(resolve, 50))
  // The knobs the hook recorded. The cast is unavoidable: TypeScript's control-flow analysis folds
  // `liveKnobs` to its initializer (`null`) because the write happens inside the hook closure.
  const liveKnobsAfter: ConfigKnobs | null = liveKnobs as ConfigKnobs | null
  say(SLUG, "settings/document-updated listeners fired: " + fired + " — live knobs: " + JSON.stringify(liveKnobsAfter))

  // Everything the evaluator reads, exactly as this run measured it.
  const observed: ConfigObservation = {
    declaration,
    declarationIsOne: declaration.includes("SETTINGS_KNOBS") && !read(PATHS.webClient).includes("SETTINGS_KNOBS"),
    tuiBytes, webBytes,
    sameSetAcrossDoors: KNOB_KEYS.every((key) => tuiBytes.includes(key) && webBytes.includes(key)),
    rowConfig, knobsAtMount,
    rowConfigEffective: knobsAtMount?.warnSilenceMs === rowConfig.warnSilenceMs && knobsAtMount?.tickIntervalMs === rowConfig.tickIntervalMs && knobsAtMount?.warnStreakToEscalate === rowConfig.warnStreakToEscalate,
    namespaceValues,
    knobsAfterEvent: liveKnobsAfter,
    namespaceWins: liveKnobsAfter?.warnSilenceMs === namespaceValues.warnSilenceMs && liveKnobsAfter?.warnStreakToEscalate === namespaceValues.warnStreakToEscalate,
    liveWithoutRestart: liveKnobsAfter !== null && report.applied === true,
    clamp: { requested: namespaceValues.tickIntervalMs, warnSilenceMs: namespaceValues.warnSilenceMs, applied: liveKnobsAfter?.tickIntervalMs },
    clampedBelowSilence: typeof liveKnobsAfter?.tickIntervalMs === "number" && liveKnobsAfter.tickIntervalMs < namespaceValues.warnSilenceMs,
    actionOnEscalateIsPause: liveKnobsAfter?.actionOnEscalate === "pause",
  }
  // The verdict over that observation.
  const verdict = evaluate(observed)
  // The persisted result: the observation (long reads truncated) plus the verdict.
  const result: ConfigResult = {
    task: "AC-11 (five declared knobs, one declaration, both front doors, row-vs-namespace precedence, live re-read)",
    lane: SLUG,
    workspace: ws,
    observed: { ...observed, declaration: "(" + declaration.length + " B read)", tuiBytes: "(" + tuiBytes.length + " B read)", webBytes: "(" + webBytes.length + " B read)" },
    checks: verdict.checks,
    ok: verdict.ok,
    notClaimed: [
      "The live re-read is driven through the adapter's own `settings/document-updated` bridge on a stub harness (the host's event, the real row) — not through a live GUI session.",
      "The clamp is asserted from the running engine's reported knobs, not from a source string.",
    ],
  }
  result.evidenceFile = writeEvidence(dir, result, CAPTURE.lines)
  return result
}

// ── T-18 `--live`: the command-shaped regression pin (lane C's t10 handoff, landed by lane D) ──
// User ruling, verbatim: "the knobs must be TRULY live in-process (knobs are DATA, so T-21's
// module-cache limit does not apply), plus a `--live` assertion as a regression pin."
// WHAT IT ASSERTS, and nothing else: with the watchdog row's engine mounted in ONE process, a knob
// value written to the workspace's `.mpd/mpd.jsonc` ON DISK is reported by the SAME running engine
// on its next tick — no restart, no re-import, no new process. `liveWithoutRestart: true` only when
// that reading is real; the `restart-needed` mutant (seeded revert) reddens it by construction.
/** The on-disk knob value the `--live` pin writes into `.mpd/mpd.jsonc`, in milliseconds. */
const LIVE_FILE_KNOB = 900_000
/** The row-config knob value the engine starts from, in milliseconds. */
const LIVE_ROW_KNOB = 90_000
/** The plugin's own `src` directory, from which the mutant copy is seeded. */
const WATCHDOG_ENGINE_SRC = join(REPO, "packages", "mpd-team-watchdog-plugin", "src")
/** The plugin's own test support module (the stub adapter + test config helpers). */
const WATCHDOG_SUPPORT = join(REPO, "packages", "mpd-team-watchdog-plugin", "test", "support.ts")

/**
 * The value of one CLI flag, or the fallback when it is absent.
 * @param list The argv to scan.
 * @param name The flag name.
 * @param fallback The value used when the flag is absent or carries nothing.
 * @returns The flag's value, or the fallback.
 */
const shellArgOf = (list: readonly string[], name: string, fallback: string): string => {
  // The flag's position in argv, or -1 when it is absent.
  const at = list.indexOf(name)
  return at >= 0 && list[at + 1] !== undefined ? list[at + 1] : fallback
}
/**
 * @param path Absolute path of the file to hash.
 * @returns The lowercase hex sha256 digest of the file's bytes.
 */
const shaOfFile = (path: string): string => createHash("sha256").update(readFileSync(path)).digest("hex")

/**
 * The verdict the assertion itself uses — pure, so --self-test exercises it both ways.
 * @param reading The live reading to judge.
 * @returns The verdict, its exit code and the detail printed beside it.
 */
export function liveVerdict(reading: LiveReading): LiveVerdict {
  return reading.liveWithoutRestart === true
    ? { verdict: "pass", exitCode: 0, detail: "the same instance reported the on-disk value with no restart" }
    : { verdict: "fail", exitCode: 1, detail: "liveness LOST: mounted=" + reading.mountedValue + " file=" + reading.fileValue + " observed=" + reading.sameInstanceValue + " fileApplied=" + reading.fileApplied + " restartRequired=" + reading.restartRequired }
}

/**
 * One live scenario: mount once, write the file once, tick twice, read the SAME instance twice.
 * @param engineModule The engine module under test (the real source, or a mutant copy).
 * @param support The plugin's own test support module.
 * @param label The scenario label recorded in the reading.
 * @returns The reading the pin judges.
 */
async function liveReading(engineModule: EngineModule, support: WatchdogSupport, label: string): Promise<LiveReading> {
  // The scenario's own temp workspace, removed when the leg finishes.
  const box = mkdtempSync(join(tmpdir(), "t18-live-"))
  try {
    // The stub adapter the engine is built over, in its own temp workspace.
    const stub = support.stubAdapter({ workspace: box })
    // The REAL engine, constructed the way the plugin's own tests construct it.
    const engine = new engineModule.WatchdogEngine(
      stub.adapter,
      { on: () => () => {}, logger: { warn: () => {}, info: () => {} } },
      support.testConfig({ stateDir: join(".mpd", "team") }),
    )
    // The disposers `install()` registered, run in `finally`.
    const disposers = engine.install()
    try {
      // The identity every later `sameInstance` assertion is measured against.
      const identity = { label, ticks: engine.getStats().ticks }
      await engine.tickOnce(1_000)
      // The silence threshold the engine resolved BEFORE the on-disk write.
      const before = engine.getKnobs().warnSilenceMs
      mkdirSync(join(box, ".mpd"), { recursive: true })
      writeFileSync(join(box, ".mpd", "mpd.jsonc"), '{"watchdog":{"warnSilenceMs":' + LIVE_FILE_KNOB + '}}\n')
      await engine.tickOnce(2_000)
      // The silence threshold the engine resolves AFTER the on-disk write.
      const after = engine.getKnobs().warnSilenceMs
      // The engine's divergence reading between the live layers.
      const view = engine.knobDivergence()
      // Whether the SAME instance served both ticks and both knob reads.
      const sameInstance = engine.getStats().ticks === identity.ticks + 2 && engine.getKnobs().warnSilenceMs === after
      return {
        label, mountedValue: before, fileValue: LIVE_FILE_KNOB, sameInstanceValue: after, sameInstance,
        fileApplied: view.fileApplied, liveLayer: view.liveLayer, restartRequired: view.restartRequired,
        liveWithoutRestart: before === LIVE_ROW_KNOB && after === LIVE_FILE_KNOB && view.fileApplied === true && view.restartRequired === false && sameInstance,
      }
    } finally {
      for (const off of disposers) off()
      engine.stop()
    }
  } finally {
    rmSync(box, { recursive: true, force: true })
  }
}

/**
 * A scratch copy of the plugin's src with the live overlay seeded back out (the pre-wave-2 rule).
 * @returns The scratch root and the copied engine source path.
 */
function seededLiveRevert(): ScratchTree {
  // The mutant's own scratch root, removed by the caller.
  const root = mkdtempSync(join(tmpdir(), "t18-live-mutant-"))
  // The copied `src` directory inside it.
  const dir = join(root, "packages", "mpd-team-watchdog-plugin", "src")
  mkdirSync(dir, { recursive: true })
  cpSync(WATCHDOG_ENGINE_SRC, dir, { recursive: true })
  // The copied engine source the overlay anchor is removed from.
  const enginePath = join(dir, "engine.ts")
  // The copied source text.
  const source = readFileSync(enginePath, "utf8")
  // The overlay anchor the shipped engine carries exactly once.
  const from = 'const base = this.liveLayer === "file" && fileDigest !== null ? overlayWatchdogSection(namespaceValue, file.section) : namespaceValue'
  // How many times that anchor appears (the mutation refuses anything but exactly one).
  const count = source.split(from).length - 1
  if (count !== 1) throw new Error("seeded revert: expected exactly 1 overlay anchor, found " + count)
  writeFileSync(enginePath, source.replace(from, "const base = namespaceValue"))
  return { root, enginePath }
}

/**
 * Write the `--live` result, refusing an existing target (T-83).
 * @param dir The directory the live result goes into.
 * @param payload The payload to persist.
 * @returns Absolute path of the file that was written.
 */
function writeLiveEvidence(dir: string, payload: unknown): string {
  mkdirSync(dir, { recursive: true })
  // The live-result file this run writes.
  const target = join(dir, "live-result.json")
  try {
    refuseOverwrite(target, { label: "live-result.json", remedy: "pass a fresh --out <dir> (the stamped default is fresh every run)" })
  } catch (error) {
    exitOnRefusal(error, "[" + SLUG + "]")
  }
  writeFileSync(target, JSON.stringify(payload, null, 2) + "\n")
  return target
}

/**
 * `--live` | `--mutant restart-needed` [--out <dir>] — the command-shaped T-18 pin.
 * @param list The process argv to scan.
 * @returns The process exit code (0 pass, 1 fail, 2 unknown mutant).
 */
async function runLiveCli(list: readonly string[]): Promise<number> {
  // Whether the caller asked for the seeded-revert mutant.
  const mutant = list.includes("--mutant")
  // The evidence directory this run writes its live result into.
  const out = resolve(shellArgOf(list, "--out", evidenceDir(list, "config-live")))
  // The plugin's own test support module, loaded by ABSOLUTE URL (a runtime specifier static
  // analysis cannot resolve, so its surface is asserted here instead).
  const support = await import(pathToFileURL(WATCHDOG_SUPPORT).href) as WatchdogSupport
  // The engine module path: the checkout's own source, or the mutant's scratch copy.
  let enginePath = join(WATCHDOG_ENGINE_SRC, "engine.ts")
  // The mutant's scratch tree, or `null` when the shipped tree is under test.
  let scratch: ScratchTree | null = null
  if (mutant) {
    // The mutant the caller named (`restart-needed` is the only one).
    const wanted = shellArgOf(list, "--mutant", "restart-needed")
    if (wanted !== "restart-needed") {
      console.error("[" + SLUG + "] unknown mutant: " + wanted)
      return 2
    }
    scratch = seededLiveRevert()
    enginePath = scratch.enginePath
  }
  // The reading the pin produces.
  let reading: LiveReading
  try {
    // The engine module: the real source, or the mutant copy busted out of the module cache.
    const engineModule = await import(pathToFileURL(enginePath).href + (mutant ? "?mutant=" + Date.now() : "")) as EngineModule
    reading = await liveReading(engineModule, support, mutant ? "seeded-revert" : "shipped")
  } finally {
    if (scratch !== null) rmSync(scratch.root, { recursive: true, force: true })
  }
  // The pin's verdict over that reading.
  const verdict = liveVerdict(reading)
  // The payload `writeLiveEvidence` persists.
  const payload = {
    assertion: "--live (T-18)",
    ruling: "the knobs must be TRULY live in-process (knobs are DATA, so T-21's module-cache limit does not apply), plus a `--live` assertion as a regression pin.",
    legs: ["in-process mount", "on-disk .mpd/mpd.jsonc write", "same-instance readback on the next tick"],
    tree: mutant ? "seeded revert (the live overlay neutered)" : "shipped",
    reading, verdict,
    sourceHash: shaOfFile(join(WATCHDOG_ENGINE_SRC, "engine.ts")),
    finishedAt: new Date().toISOString(),
  }
  say(SLUG, "--live" + (mutant ? " (mutant restart-needed)" : "") + " mounted=" + reading.mountedValue + " file=" + reading.fileValue + " sameInstance=" + reading.sameInstanceValue + " fileApplied=" + reading.fileApplied + " restartRequired=" + reading.restartRequired)
  say(SLUG, "liveWithoutRestart: " + reading.liveWithoutRestart + " — " + verdict.detail)
  // The evidence file that was written.
  const wrote = writeLiveEvidence(out, payload)
  if (mutant) {
    // Whether the assertion REDDENED on the mutant, which is the mutant arm's own PASS.
    const detected = verdict.exitCode !== 0
    say(SLUG, "mutant restart-needed: " + (detected ? "DETECTED (the assertion reddened)" : "NOT DETECTED") + " — " + wrote)
    return detected ? 0 : 1
  }
  say(SLUG, "result: " + verdict.verdict.toUpperCase() + " — " + wrote)
  return verdict.exitCode
}

/** The stdout capture installed at module load, so the same lines land in output.log. */
const CAPTURE = captureStdout()
// The argv this process was invoked with, minus the node binary and the script path.
const argv = process.argv.slice(2)
if (argv.includes("--live") || argv.includes("--mutant")) {
  CAPTURE.restore()
  process.exit(await runLiveCli(argv))
}
if (argv.includes("--self-test")) {
  CAPTURE.restore()
  // T-18 `--live` verdict arms (offline): the pin's own logic, exercised in both directions.
  const liveArms: ReadonlyArray<readonly [string, LiveReading, string, number]> = [
    ["live", { mountedValue: LIVE_ROW_KNOB, fileValue: LIVE_FILE_KNOB, sameInstanceValue: LIVE_FILE_KNOB, sameInstance: true, fileApplied: true, restartRequired: false, liveWithoutRestart: true }, "pass", 0],
    ["restart-needed", { mountedValue: LIVE_ROW_KNOB, fileValue: LIVE_FILE_KNOB, sameInstanceValue: LIVE_ROW_KNOB, sameInstance: true, fileApplied: false, restartRequired: true, liveWithoutRestart: false }, "fail", 1],
    ["not-same-instance", { mountedValue: LIVE_ROW_KNOB, fileValue: LIVE_FILE_KNOB, sameInstanceValue: LIVE_FILE_KNOB, sameInstance: false, fileApplied: true, restartRequired: false, liveWithoutRestart: false }, "fail", 1],
  ]
  // How many live-verdict arms did not hold.
  let liveFailures = 0
  for (const [name, reading, wantVerdict, wantExit] of liveArms) {
    // The verdict the pin's own logic produced for this arm.
    const got = liveVerdict(reading)
    // Whether that verdict and its exit code are the ones the arm demands.
    const ok = got.verdict === wantVerdict && got.exitCode === wantExit
    if (!ok) liveFailures += 1
    console.log("[self-test] " + (ok ? "ok  " : "FAIL") + " live-" + name + ": " + got.verdict + "/" + got.exitCode)
  }
  if (liveFailures > 0) {
    console.error("[self-test] FAIL — the --live verdict arms did not hold")
    process.exit(1)
  }
  // The synthetic healthy observation every control starts from.
  const healthy: ConfigObservation = {
    declaration: KNOB_KEYS.join(" "), declarationIsOne: true,
    tuiBytes: KNOB_KEYS.join(" "), webBytes: KNOB_KEYS.join(" "), sameSetAcrossDoors: true,
    rowConfig: { warnSilenceMs: 60000, tickIntervalMs: 5000, warnStreakToEscalate: 2 },
    knobsAtMount: { warnSilenceMs: 60000, tickIntervalMs: 5000, warnStreakToEscalate: 2 },
    rowConfigEffective: true,
    namespaceValues: { warnSilenceMs: 30000, tickIntervalMs: 40000, warnStreakToEscalate: 3, actionOnEscalate: "pause" },
    knobsAfterEvent: { warnSilenceMs: 30000, tickIntervalMs: 10000, warnStreakToEscalate: 3, actionOnEscalate: "pause" },
    namespaceWins: true, liveWithoutRestart: true,
    clamp: { requested: 40000, warnSilenceMs: 30000, applied: 10000 }, clampedBelowSilence: true, actionOnEscalateIsPause: true,
  }
  // Every control's mutation starts from a deep copy of `healthy`. The `!` on `knobsAfterEvent` is
  // justified: this healthy fixture always carries a non-null knob reading.
  selfTest(SLUG, evaluate, healthy, [
    ["missing-knob", (copy) => { copy.webBytes = copy.webBytes.replace("warnStreakToEscalate", "") }, "a knob missing from one front door"],
    ["two-declarations", (copy) => { copy.declarationIsOne = false }, "a second declaration (the doors would drift)"],
    ["row-ignored", (copy) => { copy.knobsAtMount.warnSilenceMs = 20000 }, "a row config that is not the effective default"],
    ["namespace-loses", (copy) => { copy.knobsAfterEvent!.warnSilenceMs = 60000 }, "a namespace that does not outrank the row config"],
    ["restart-needed", (copy) => { copy.liveWithoutRestart = false }, "a re-read that only a restart could deliver"],
    ["no-clamp", (copy) => { copy.clamp.applied = 40000; copy.knobsAfterEvent!.tickIntervalMs = 40000 }, "an unclamped cadence beyond the silence threshold"],
    ["halt-action", (copy) => { copy.namespaceValues.actionOnEscalate = "halt" }, "an escalation wired to the halt path"],
  ])
}
try {
  // The lane's result, persisted by `run` itself.
  const result = await run(argv)
  CAPTURE.restore()
  finish(SLUG, result, CAPTURE.lines)
} catch (error) {
  CAPTURE.restore()
  say(SLUG, "CRASH: " + crashText(error))
  process.exit(1)
}
