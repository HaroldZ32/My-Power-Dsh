// T-41's PROBE ASSERTION — wave-2b lane C (t17). The instrument is lane B's (scripts/mpd-doctor.mjs,
// READ-ONLY); this driver turns its two captured runs into a DECISIVE per-entry reading with an EXECUTED
// negative control: the same assertion is run against a SILENCED copy of the output (the absent binary's
// own line removed) and must REDDEN there, so a green here is not a green from a command that cannot fail.
//
// Usage: node t41-absent-binary-assert.mjs --dir <evidence dir>
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

const HERE = dirname(new URL(import.meta.url).pathname)
const args = process.argv.slice(2)
const index = args.indexOf("--dir")
const DIR = resolve(index >= 0 && args[index + 1] !== undefined ? args[index + 1] : HERE)
const baseline = readFileSync(join(DIR, "raw", "t41-baseline.txt"), "utf8")
const pinned = readFileSync(join(DIR, "raw", "t41-pinned.txt"), "utf8")
const ABSENT = "ast-grep"
const PIN = "MPD_AST_GREP_SG_PATH=/nonexistent/ast-grep-absent"

const entryStatus = (text, name) => {
  const line = text.split("\n").find((row) => row.startsWith("[mpd-doctor] " + name + " ["))
  return line === undefined ? null : (line.match(/\[(?:REQUIRED|OPTIONAL)\]: ([A-Za-z-]+)/)?.[1] ?? null)
}
const entryLine = (text, name) => text.split("\n").find((row) => row.startsWith("[mpd-doctor] " + name + " [")) ?? ""
const entryNames = (text) => [...new Set(text.split("\n").map((row) => /^\[mpd-doctor\] ([a-z-]+) \[(?:REQUIRED|OPTIONAL)\]:/.exec(row)?.[1]).filter(Boolean))]
const verdictLine = (text) => text.split("\n").find((row) => row.startsWith("[mpd-doctor] verdict=")) ?? ""

/** The assertion under test: an ABSENT optional binary is NAMED with what degrades, the others stay ok. */
function assertReading(text, { expectAbsent = true } = {}) {
  const others = entryNames(text).filter((name) => name !== ABSENT)
  const checks = {
    "the absent binary is NAMED with the MISSING status": entryStatus(text, ABSENT) === (expectAbsent ? "MISSING" : "ok"),
    "its entry carries a degrade sentence (⇒ degrades:)": entryLine(text, ABSENT).includes("⇒ degrades:"),
    "its entry names the pin that made it absent": entryLine(text, ABSENT).includes(PIN),
    "its entry names what becomes unavailable": /mcp__ast_grep__(search|scan|rewrite)/.test(entryLine(text, ABSENT)),
    "every OTHER entry stayed ok": others.length > 0 && others.every((name) => entryStatus(text, name) === "ok"),
    "the verdict NAMES the missing entry": verdictLine(text).includes("missingOPTIONAL=" + ABSENT) && verdictLine(text).includes("verdict=DEGRADED"),
  }
  return { checks, passed: Object.values(checks).every(Boolean), others }
}

const passArm = assertReading(pinned)
const baselineArm = {
  checks: {
    "the baseline run reports every entry ok": entryNames(baseline).every((name) => entryStatus(baseline, name) === "ok"),
    "the baseline verdict is OK/exit=0": verdictLine(baseline).includes("verdict=OK") && verdictLine(baseline).includes("exit=0"),
    "the absent binary was OK in the baseline (so the pin is what changed it)": entryStatus(baseline, ABSENT) === "ok",
  },
  passed: false,
}
baselineArm.passed = Object.values(baselineArm.checks).every(Boolean)
// THE EXECUTED NEGATIVE CONTROL: silence the absent binary's own line and require the assertion to REDDEN.
const silenced = pinned.split("\n").filter((row) => !row.startsWith("[mpd-doctor] " + ABSENT + " [")).join("\n")
const silenceArm = assertReading(silenced)

const result = {
  schema: "t41/absent-optional-binary/1",
  leg: "wave-2b lane C (t17)",
  instrument: { path: "scripts/mpd-doctor.mjs", sha256: null, provenance: "lane B's file, READ-ONLY — the two captured runs are raw/t41-baseline.txt and raw/t41-pinned.txt" },
  baseline: { arm: "no pin (the environment as it is)", exit: 0, verdict: verdictLine(baseline), checks: baselineArm.checks, passed: baselineArm.passed },
  pinned: { arm: "MPD_AST_GREP_SG_PATH=" + "/nonexistent/ast-grep-absent (deliberately absent)", exit: 2, verdict: verdictLine(pinned), entryLine: entryLine(pinned, ABSENT), checks: passArm.checks, passed: passArm.passed },
  negativeControl: { arm: "the same assertion against the SAME output with the absent binary's own line REMOVED", reddened: silenceArm.passed === false, failingChecks: Object.entries(silenceArm.checks).filter(([, ok]) => ok !== true).map(([name]) => name) },
  perEntryCensus: { baseline: entryNames(baseline).map((name) => name + "=" + entryStatus(baseline, name)), pinned: entryNames(pinned).map((name) => name + "=" + entryStatus(pinned, name)) },
  shapeNote: "the entry status word is UPPERCASE for a missing optional entry (`MISSING`) while ok entries read lowercase (`ok`) — a lowercase-only grep would MISS the very reading this leg is about",
  bound: "this asserts the doctor's OUTPUT, not the resolver underneath it: a doctor that reported ok while the binary was absent would pass the baseline arm and fail the pinned arm — that asymmetry is the point",
  finishedAt: new Date().toISOString(),
}
const failed = [
  ...(baselineArm.passed ? [] : ["baseline"]),
  ...(passArm.passed ? [] : ["pinned"]),
  ...(silenceArm.passed === false ? [] : ["negativeControl"]),
]
writeFileSync(join(DIR, "t41-absent-binary-assert-result.json"), JSON.stringify(result, null, 2) + "\n")
console.log(JSON.stringify({ baseline_passed: baselineArm.passed, pinned_passed: passArm.passed, negative_control_reddened: silenceArm.passed === false, pinned_entry_status: entryStatus(pinned, ABSENT), others_still_ok: passArm.others.map((name) => name + "=" + entryStatus(pinned, name)), failed_arms: failed }, null, 2))
process.exit(failed.length === 0 ? 0 : 1)
