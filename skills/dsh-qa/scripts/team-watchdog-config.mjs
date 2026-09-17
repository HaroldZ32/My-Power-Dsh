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
//   bun skills/dsh-qa/scripts/team-watchdog-config.mjs --self-test
//   bun skills/dsh-qa/scripts/team-watchdog-config.mjs [--out <dir>]
// Evidence -> evidence/team-watchdog/lanes/<timestamp>-config/{result.json,output.log,raw/}
import { createHash } from "node:crypto"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { PATHS, REPO, captureStdout, evidenceDir, finish, read, sandboxWorkspace, say, selfTest, writeEvidence } from "./lib/watchdog-lane.mjs"
import { exitOnRefusal, refuseOverwrite } from "./lib/immutable-output.mjs"

const SLUG = "team-watchdog-config"
const KNOBS = ["watchdog.enabled", "watchdog.warnSilenceMs", "watchdog.tickIntervalMs", "watchdog.warnStreakToEscalate", "watchdog.actionOnEscalate"]
/** The shape the built bytes carry: the section key plus each knob name (camelCase literals). */
const KNOB_KEYS = KNOBS.map((path) => path.split(".")[1])

/** The pure evaluator. */
export function evaluate(observed) {
  const checks = []
  const add = (id, ok, detail) => checks.push({ id, ok: Boolean(ok), detail: String(detail) })

  const declarationMissing = KNOB_KEYS.filter((key) => !String(observed.declaration ?? "").includes(key))
  add("C1", declarationMissing.length === 0, "the ONE declaration carries all five knobs (missing: " + JSON.stringify(declarationMissing) + ")")
  add("C2", observed.declarationIsOne === true, "the knobs live in exactly ONE declaration (settings-schema.ts) — the front doors derive from it")
  const tuiMissing = KNOB_KEYS.filter((key) => !String(observed.tuiBytes ?? "").includes(key))
  const webMissing = KNOB_KEYS.filter((key) => !String(observed.webBytes ?? "").includes(key))
  add("C3", tuiMissing.length === 0, "the BUILT TUI bytes carry every knob (missing: " + JSON.stringify(tuiMissing) + ")")
  add("C4", webMissing.length === 0, "the BUILT web client bytes carry every knob (missing: " + JSON.stringify(webMissing) + ")")
  add("C5", observed.sameSetAcrossDoors === true, "both front doors expose the SAME five knobs (no knob reachable from one door only)")

  const rowEffective = observed.rowConfigEffective === true && observed.knobsAtMount?.warnSilenceMs === observed.rowConfig?.warnSilenceMs && observed.knobsAtMount?.tickIntervalMs === observed.rowConfig?.tickIntervalMs && observed.knobsAtMount?.warnStreakToEscalate === observed.rowConfig?.warnStreakToEscalate
  add("C6", rowEffective,
    "with no `watchdog` section the ROW config is the effective value (" + JSON.stringify(observed.rowConfig) + " → " + JSON.stringify(observed.knobsAtMount) + ")")
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

async function run(argv) {
  const dir = evidenceDir(argv, "config")
  // T-83: the evidence target is IMMUTABLE BY DEFAULT — a caller-supplied --out that already exists
  // is refused instead of being rewritten (the T-63/T-76 class: a re-run must never overwrite a record).
  try {
    refuseOverwrite(dir, { label: "evidence directory", remedy: "pass a new --out <dir>, or omit --out for a fresh timestamped directory (T-53)" })
  } catch (error) {
    exitOnRefusal(error, "[" + SLUG + "]")
  }
  const ws = sandboxWorkspace(dir, "config")
  const declaration = read(PATHS.settingsSchema)
  const tuiBytes = read(PATHS.tuiDist)
  const webBytes = read(PATHS.webClient)
  say(SLUG, "declaration: " + PATHS.settingsSchema)
  say(SLUG, "built bytes: tui=" + tuiBytes.length + " B, web=" + webBytes.length + " B")

  const { mountRealWatchdog } = await import("./lib/watchdog-lane.mjs")
  const rowConfig = { enabled: true, warnSilenceMs: 60_000, tickIntervalMs: 5_000, warnStreakToEscalate: 2, actionOnEscalate: "pause" }
  const mounted = await mountRealWatchdog({ workspace: ws, config: rowConfig })
  const knobsAtMount = mounted.report.knobs
  say(SLUG, "mounted with the row config — knobs: " + JSON.stringify(knobsAtMount))

  // The live re-read: the namespace now carries a `watchdog` section, and the host fires the
  // raw-section event the adapter forwards to the row.
  const namespaceValues = { warnSilenceMs: 30_000, tickIntervalMs: 40_000, warnStreakToEscalate: 3, actionOnEscalate: "pause", enabled: true }
  let liveKnobs = null
  const engine = mounted.report.engine
  if (engine !== undefined && engine !== null) engine.onKnobsChanged = (next) => { liveKnobs = next }
  mounted.setNamespace({ watchdog: namespaceValues }, 7)
  const fired = await mounted.fire("settings/document-updated", "mpd", 7)
  await new Promise((resolve) => setTimeout(resolve, 50))
  say(SLUG, "settings/document-updated listeners fired: " + fired + " — live knobs: " + JSON.stringify(liveKnobs))

  const observed = {
    declaration,
    declarationIsOne: declaration.includes("SETTINGS_KNOBS") && !read(PATHS.webClient).includes("SETTINGS_KNOBS"),
    tuiBytes, webBytes,
    sameSetAcrossDoors: KNOB_KEYS.every((key) => tuiBytes.includes(key) && webBytes.includes(key)),
    rowConfig, knobsAtMount,
    rowConfigEffective: knobsAtMount?.warnSilenceMs === rowConfig.warnSilenceMs && knobsAtMount?.tickIntervalMs === rowConfig.tickIntervalMs && knobsAtMount?.warnStreakToEscalate === rowConfig.warnStreakToEscalate,
    namespaceValues,
    knobsAfterEvent: liveKnobs,
    namespaceWins: liveKnobs?.warnSilenceMs === namespaceValues.warnSilenceMs && liveKnobs?.warnStreakToEscalate === namespaceValues.warnStreakToEscalate,
    liveWithoutRestart: liveKnobs !== null && mounted.report.applied === true,
    clamp: { requested: namespaceValues.tickIntervalMs, warnSilenceMs: namespaceValues.warnSilenceMs, applied: liveKnobs?.tickIntervalMs },
    clampedBelowSilence: typeof liveKnobs?.tickIntervalMs === "number" && liveKnobs.tickIntervalMs < namespaceValues.warnSilenceMs,
    actionOnEscalateIsPause: liveKnobs?.actionOnEscalate === "pause",
  }
  const verdict = evaluate(observed)
  const result = {
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
const LIVE_FILE_KNOB = 900_000
const LIVE_ROW_KNOB = 90_000
const WATCHDOG_ENGINE_SRC = join(REPO, "packages", "mpd-team-watchdog-plugin", "src")
const WATCHDOG_SUPPORT = join(REPO, "packages", "mpd-team-watchdog-plugin", "test", "support.ts")

const shellArgOf = (list, name, fallback) => {
  const at = list.indexOf(name)
  return at >= 0 && list[at + 1] !== undefined ? list[at + 1] : fallback
}
const shaOfFile = (path) => createHash("sha256").update(readFileSync(path)).digest("hex")

/** The verdict the assertion itself uses — pure, so --self-test exercises it both ways. */
export function liveVerdict(reading) {
  return reading.liveWithoutRestart === true
    ? { verdict: "pass", exitCode: 0, detail: "the same instance reported the on-disk value with no restart" }
    : { verdict: "fail", exitCode: 1, detail: "liveness LOST: mounted=" + reading.mountedValue + " file=" + reading.fileValue + " observed=" + reading.sameInstanceValue + " fileApplied=" + reading.fileApplied + " restartRequired=" + reading.restartRequired }
}

/** One live scenario: mount once, write the file once, tick twice, read the SAME instance twice. */
async function liveReading(engineModule, support, label) {
  const box = mkdtempSync(join(tmpdir(), "t18-live-"))
  try {
    const stub = support.stubAdapter({ workspace: box })
    const engine = new engineModule.WatchdogEngine(
      stub.adapter,
      { on: () => () => {}, logger: { warn: () => {}, info: () => {} } },
      support.testConfig({ stateDir: join(".mpd", "team") }),
    )
    const disposers = engine.install()
    try {
      const identity = { label, ticks: engine.getStats().ticks }
      await engine.tickOnce(1_000)
      const before = engine.getKnobs().warnSilenceMs
      mkdirSync(join(box, ".mpd"), { recursive: true })
      writeFileSync(join(box, ".mpd", "mpd.jsonc"), '{"watchdog":{"warnSilenceMs":' + LIVE_FILE_KNOB + '}}\n')
      await engine.tickOnce(2_000)
      const after = engine.getKnobs().warnSilenceMs
      const view = engine.knobDivergence()
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

/** A scratch copy of the plugin's src with the live overlay seeded back out (the pre-wave-2 rule). */
function seededLiveRevert() {
  const root = mkdtempSync(join(tmpdir(), "t18-live-mutant-"))
  const dir = join(root, "packages", "mpd-team-watchdog-plugin", "src")
  mkdirSync(dir, { recursive: true })
  cpSync(WATCHDOG_ENGINE_SRC, dir, { recursive: true })
  const enginePath = join(dir, "engine.ts")
  const source = readFileSync(enginePath, "utf8")
  const from = 'const base = this.liveLayer === "file" && fileDigest !== null ? overlayWatchdogSection(namespaceValue, file.section) : namespaceValue'
  const count = source.split(from).length - 1
  if (count !== 1) throw new Error("seeded revert: expected exactly 1 overlay anchor, found " + count)
  writeFileSync(enginePath, source.replace(from, "const base = namespaceValue"))
  return { root, enginePath }
}

function writeLiveEvidence(dir, payload) {
  mkdirSync(dir, { recursive: true })
  const target = join(dir, "live-result.json")
  try {
    refuseOverwrite(target, { label: "live-result.json", remedy: "pass a fresh --out <dir> (the stamped default is fresh every run)" })
  } catch (error) {
    exitOnRefusal(error, "[" + SLUG + "]")
  }
  writeFileSync(target, JSON.stringify(payload, null, 2) + "\n")
  return target
}

/** `--live` | `--mutant restart-needed` [--out <dir>] — the command-shaped T-18 pin. */
async function runLiveCli(list) {
  const mutant = list.includes("--mutant")
  const out = resolve(shellArgOf(list, "--out", evidenceDir(list, "config-live")))
  const support = await import(pathToFileURL(WATCHDOG_SUPPORT).href)
  let enginePath = join(WATCHDOG_ENGINE_SRC, "engine.ts")
  let scratch = null
  if (mutant) {
    const wanted = shellArgOf(list, "--mutant", "restart-needed")
    if (wanted !== "restart-needed") {
      console.error("[" + SLUG + "] unknown mutant: " + wanted)
      return 2
    }
    scratch = seededLiveRevert()
    enginePath = scratch.enginePath
  }
  let reading
  try {
    const engineModule = await import(pathToFileURL(enginePath).href + (mutant ? "?mutant=" + Date.now() : ""))
    reading = await liveReading(engineModule, support, mutant ? "seeded-revert" : "shipped")
  } finally {
    if (scratch !== null) rmSync(scratch.root, { recursive: true, force: true })
  }
  const verdict = liveVerdict(reading)
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
  const wrote = writeLiveEvidence(out, payload)
  if (mutant) {
    const detected = verdict.exitCode !== 0
    say(SLUG, "mutant restart-needed: " + (detected ? "DETECTED (the assertion reddened)" : "NOT DETECTED") + " — " + wrote)
    return detected ? 0 : 1
  }
  say(SLUG, "result: " + verdict.verdict.toUpperCase() + " — " + wrote)
  return verdict.exitCode
}

const CAPTURE = captureStdout()
const argv = process.argv.slice(2)
if (argv.includes("--live") || argv.includes("--mutant")) {
  CAPTURE.restore()
  process.exit(await runLiveCli(argv))
}
if (argv.includes("--self-test")) {
  CAPTURE.restore()
  // T-18 `--live` verdict arms (offline): the pin's own logic, exercised in both directions.
  const liveArms = [
    ["live", { mountedValue: LIVE_ROW_KNOB, fileValue: LIVE_FILE_KNOB, sameInstanceValue: LIVE_FILE_KNOB, sameInstance: true, fileApplied: true, restartRequired: false, liveWithoutRestart: true }, "pass", 0],
    ["restart-needed", { mountedValue: LIVE_ROW_KNOB, fileValue: LIVE_FILE_KNOB, sameInstanceValue: LIVE_ROW_KNOB, sameInstance: true, fileApplied: false, restartRequired: true, liveWithoutRestart: false }, "fail", 1],
    ["not-same-instance", { mountedValue: LIVE_ROW_KNOB, fileValue: LIVE_FILE_KNOB, sameInstanceValue: LIVE_FILE_KNOB, sameInstance: false, fileApplied: true, restartRequired: false, liveWithoutRestart: false }, "fail", 1],
  ]
  let liveFailures = 0
  for (const [name, reading, wantVerdict, wantExit] of liveArms) {
    const got = liveVerdict(reading)
    const ok = got.verdict === wantVerdict && got.exitCode === wantExit
    if (!ok) liveFailures += 1
    console.log("[self-test] " + (ok ? "ok  " : "FAIL") + " live-" + name + ": " + got.verdict + "/" + got.exitCode)
  }
  if (liveFailures > 0) {
    console.error("[self-test] FAIL — the --live verdict arms did not hold")
    process.exit(1)
  }
  const healthy = {
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
  selfTest(SLUG, evaluate, healthy, [
    ["missing-knob", (copy) => { copy.webBytes = copy.webBytes.replace("warnStreakToEscalate", "") }, "a knob missing from one front door"],
    ["two-declarations", (copy) => { copy.declarationIsOne = false }, "a second declaration (the doors would drift)"],
    ["row-ignored", (copy) => { copy.knobsAtMount.warnSilenceMs = 20000 }, "a row config that is not the effective default"],
    ["namespace-loses", (copy) => { copy.knobsAfterEvent.warnSilenceMs = 60000 }, "a namespace that does not outrank the row config"],
    ["restart-needed", (copy) => { copy.liveWithoutRestart = false }, "a re-read that only a restart could deliver"],
    ["no-clamp", (copy) => { copy.clamp.applied = 40000; copy.knobsAfterEvent.tickIntervalMs = 40000 }, "an unclamped cadence beyond the silence threshold"],
    ["halt-action", (copy) => { copy.namespaceValues.actionOnEscalate = "halt" }, "an escalation wired to the halt path"],
  ])
}
try {
  const result = await run(argv)
  CAPTURE.restore()
  finish(SLUG, result, CAPTURE.lines)
} catch (error) {
  CAPTURE.restore()
  say(SLUG, "CRASH: " + String(error?.stack ?? error))
  process.exit(1)
}
