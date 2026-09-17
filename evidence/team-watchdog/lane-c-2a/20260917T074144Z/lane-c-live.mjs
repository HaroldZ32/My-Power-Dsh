// T-18's `--live` assertion (wave 2, lane C) — a RE-RUNNABLE, command-shaped regression pin.
//
// User ruling, verbatim: "the knobs must be TRULY live in-process (knobs are DATA, so T-21's
// module-cache limit does not apply), plus a `--live` assertion as a regression pin."
//
// WHAT `--live` ASSERTS (and nothing else): with the watchdog row's engine mounted in ONE process,
// a knob value written to the workspace's `.mpd/mpd.jsonc` ON DISK is reported by the SAME running
// engine on its next tick — no restart, no re-import, no new process. The output states the three
// legs it observed: (1) the in-process mount, (2) the on-disk knob write, (3) the same-instance
// readback, plus `liveWithoutRestart: true` only when the reading is real.
//
// Usage:
//   bun lane-c-live.mjs --live [--out <dir>]
//   bun lane-c-live.mjs --mutant restart-needed [--out <dir>]   # seeded revert; exits 0 only when the mutant is DETECTED
//   bun lane-c-live.mjs --self-test
// An EXISTING output file is refused with exit 3 (the immutable-evidence convention).
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { WatchdogEngine } from "../../../../packages/mpd-team-watchdog-plugin/src/engine"
import { stubAdapter, testConfig } from "../../../../packages/mpd-team-watchdog-plugin/test/support"

const HERE = fileURLToPath(new URL(".", import.meta.url))
const REPO = resolve(HERE, "../../../..")
const WATCHDOG_SRC = join(REPO, "packages", "mpd-team-watchdog-plugin", "src")
const FILE_KNOB = 900_000
const ROW_KNOB = 90_000

const args = process.argv.slice(2)
const argOf = (name, fallback) => {
  const index = args.indexOf(name)
  return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback
}
const MODE = args.includes("--live") ? "live" : args.includes("--mutant") ? "mutant" : args.includes("--self-test") ? "self-test" : "help"
const MUTANT = argOf("--mutant", "restart-needed")
if (MODE === "help") {
  console.log("usage: bun lane-c-live.mjs --live | --mutant restart-needed | --self-test [--out <dir>]")
  process.exit(0)
}

/** Nothing in this directory is ever rewritten: a re-run must pick a fresh --out. */
function writeResults(dir, payload) {
  mkdirSync(dir, { recursive: true })
  const target = join(dir, "live-result.json")
  if (existsSync(target)) {
    console.error("[lane-c-live] REFUSED: " + target + " already exists (immutable evidence; use a fresh --out)")
    process.exit(3)
  }
  writeFileSync(target, JSON.stringify(payload, null, 2) + "\n")
  return target
}

const shaOf = (path) => createHash("sha256").update(readFileSync(path)).digest("hex")

/** One live scenario: mount once, write the file once, tick twice, read the same instance twice. */
async function runLive(engineModule, label) {
  const box = mkdtempSync(join(tmpdir(), "lane-c-live-"))
  const stateDir = join(".mpd", "team")
  try {
    const stub = stubAdapter({ workspace: box })
    const engine = new engineModule.WatchdogEngine(
      stub.adapter,
      { on: () => () => {}, logger: { warn: () => {}, info: () => {} } },
      testConfig({ stateDir }),
    )
    const disposers = engine.install()
    try {
      // Leg 1 — the in-process mount: the engine exists, has not ticked, and reports ROW values.
      const identity = { engine: label, ticks: engine.getStats().ticks, mountedAt: Date.now() }
      await engine.tickOnce(1_000)
      const before = engine.getKnobs().warnSilenceMs
      // Leg 2 — the on-disk knob write.
      mkdirSync(join(box, ".mpd"), { recursive: true })
      writeFileSync(join(box, ".mpd", "mpd.jsonc"), '{"watchdog":{"warnSilenceMs":' + FILE_KNOB + '}}\n')
      // Leg 3 — the SAME instance, next tick, no restart / no re-import / no new process.
      await engine.tickOnce(2_000)
      const after = engine.getKnobs().warnSilenceMs
      const view = engine.knobDivergence()
      const sameInstance = engine.getStats().ticks === identity.ticks + 2 && engine.getKnobs().warnSilenceMs === after
      const reading = {
        label,
        mountedValue: before,
        fileValue: FILE_KNOB,
        sameInstanceValue: after,
        sameInstance,
        fileApplied: view.fileApplied,
        liveLayer: view.liveLayer,
        restartRequired: view.restartRequired,
        liveWithoutRestart: before === ROW_KNOB && after === FILE_KNOB && view.fileApplied === true && view.restartRequired === false && sameInstance,
      }
      return reading
    } finally {
      for (const off of disposers) off()
      engine.stop()
    }
  } finally {
    rmSync(box, { recursive: true, force: true })
  }
}

/** The verdict the assertion itself uses — pure, so the self-test can exercise it. */
function verdictOf(reading) {
  return reading.liveWithoutRestart === true
    ? { verdict: "pass", exitCode: 0, detail: "the same instance reported the on-disk value with no restart" }
    : { verdict: "fail", exitCode: 1, detail: "liveness LOST: mounted=" + reading.mountedValue + " file=" + reading.fileValue + " observed=" + reading.sameInstanceValue + " fileApplied=" + reading.fileApplied + " restartRequired=" + reading.restartRequired }
}

/** A scratch copy of the plugin's src with the live overlay seeded back out (the pre-wave-2 rule). */
function seededRevert() {
  const root = mkdtempSync(join(tmpdir(), "lane-c-live-mutant-"))
  const dir = join(root, "packages", "mpd-team-watchdog-plugin", "src")
  mkdirSync(dir, { recursive: true })
  cpSync(WATCHDOG_SRC, dir, { recursive: true })
  const enginePath = join(dir, "engine.ts")
  const source = readFileSync(enginePath, "utf8")
  const from = 'const base = this.liveLayer === "file" && fileDigest !== null ? overlayWatchdogSection(namespaceValue, file.section) : namespaceValue'
  const count = source.split(from).length - 1
  if (count !== 1) throw new Error("seeded revert: expected exactly 1 overlay anchor, found " + count)
  writeFileSync(enginePath, source.replace(from, "const base = namespaceValue"))
  return { root, enginePath }
}

if (MODE === "self-test") {
  const base = { mountedValue: ROW_KNOB, fileValue: FILE_KNOB, sameInstanceValue: FILE_KNOB, sameInstance: true, fileApplied: true, restartRequired: false }
  const arms = [
    ["live", { ...base, liveWithoutRestart: true }, "pass", 0],
    ["restart-needed", { ...base, sameInstanceValue: ROW_KNOB, fileApplied: false, restartRequired: true, liveWithoutRestart: false }, "fail", 1],
    ["not-same-instance", { ...base, sameInstance: false, liveWithoutRestart: false }, "fail", 1],
  ]
  let failures = 0
  for (const [name, reading, verdict, exitCode] of arms) {
    const got = verdictOf(reading)
    const ok = got.verdict === verdict && got.exitCode === exitCode
    if (!ok) failures += 1
    console.log("[lane-c-live self-test] " + name + ": " + (ok ? "PASS" : "FAIL") + " (" + got.verdict + "/" + got.exitCode + ")")
  }
  console.log("[lane-c-live self-test] " + (arms.length - failures) + "/" + arms.length + " arms passed — " + (failures === 0 ? "PASS" : "FAIL"))
  process.exit(failures === 0 ? 0 : 1)
}

if (MODE === "live") {
  const out = resolve(argOf("--out", HERE))
  const reading = await runLive(await import(pathToFileURL(join(WATCHDOG_SRC, "engine.ts")).href), "shipped")
  const verdict = verdictOf(reading)
  const payload = {
    assertion: "--live (T-18)",
    ruling: "the knobs must be TRULY live in-process (knobs are DATA, so T-21's module-cache limit does not apply), plus a `--live` assertion as a regression pin.",
    legs: ["in-process mount", "on-disk .mpd/mpd.jsonc write", "same-instance readback on the next tick"],
    reading,
    verdict,
    sourceHash: shaOf(join(WATCHDOG_SRC, "engine.ts")),
    finishedAt: new Date().toISOString(),
  }
  console.log("[lane-c-live] legs: " + payload.legs.join(" → "))
  console.log("[lane-c-live] mounted=" + reading.mountedValue + " file=" + reading.fileValue + " sameInstance=" + reading.sameInstanceValue + " fileApplied=" + reading.fileApplied + " liveLayer=" + reading.liveLayer + " restartRequired=" + reading.restartRequired)
  console.log("[lane-c-live] liveWithoutRestart: " + reading.liveWithoutRestart + " — " + verdict.detail)
  console.log("[lane-c-live] result: " + verdict.verdict.toUpperCase())
  if (!args.includes("--no-write")) console.log("[lane-c-live] wrote " + writeResults(out, payload))
  process.exit(verdict.exitCode)
}

if (MODE === "mutant") {
  if (MUTANT !== "restart-needed") {
    console.error("[lane-c-live] unknown mutant: " + MUTANT)
    process.exit(2)
  }
  const out = resolve(argOf("--out", HERE))
  const scratch = seededRevert()
  try {
    const reading = await runLive(await import(pathToFileURL(scratch.enginePath).href + "?mutant=" + Date.now()), "seeded-revert")
    const verdict = verdictOf(reading)
    const detected = verdict.exitCode !== 0
    console.log("[lane-c-live] mutant restart-needed (seeded revert of the live overlay): mounted=" + reading.mountedValue + " file=" + reading.fileValue + " sameInstance=" + reading.sameInstanceValue + " restartRequired=" + reading.restartRequired)
    console.log("[lane-c-live] the `--live` assertion on this tree: " + verdict.verdict.toUpperCase() + " (exit " + verdict.exitCode + ") — " + verdict.detail)
    console.log("[lane-c-live] mutant " + (detected ? "DETECTED (the assertion reddened)" : "NOT DETECTED"))
    const payload = {
      mutant: MUTANT,
      method: "the same live scenario against a scratch copy of src/engine.ts with the one-line overlay seeded back out",
      reading,
      liveAssertionWouldExit: verdict.exitCode,
      detected,
      finishedAt: new Date().toISOString(),
    }
    if (!args.includes("--no-write")) writeResults(out, payload)
    process.exit(detected ? 0 : 1)
  } finally {
    rmSync(scratch.root, { recursive: true, force: true })
  }
}

process.exit(2)
