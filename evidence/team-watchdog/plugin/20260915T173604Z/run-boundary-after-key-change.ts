// t73 amendment — RE-RUN the two boundary fixtures after the streak-key change.
//
// The captain's binding point: t71's fix (`lastKind`, withhold AND reset on a `turn-end` newest
// stamp) and t73's fix (team-scoped `streakKey`) touch the SAME functions, so the two boundary
// fixtures must be re-measured on the tree that carries BOTH:
//   * `completed-turn-idle` must still produce 0 decisions / 0 scenes / 0 incidents / 0 holds;
//   * `mid-turn-stall` must still escalate + hold.
// If the key change had invalidated either expectation that would be a FINDING, not a licence to
// relax the fixture. This runner only reads the fixture and asserts; it writes nothing but its own
// evidence files.
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, "..", "..", "..", "..")
const FIXTURE = join(REPO, "packages", "mpd-team-watchdog-plugin", "test", "fixtures", "inject.mjs")
if (!existsSync(FIXTURE)) {
  console.error("FATAL: fixture not found at " + FIXTURE)
  process.exit(2)
}
const { runCase, BOUNDARY_CASES, FROZEN, CLOCK, NOT_CLAIMED } = await import(FIXTURE)

const scratch = join(HERE, "raw", "ws")
mkdirSync(scratch, { recursive: true })

const results = []
for (const name of BOUNDARY_CASES) results.push(await runCase(name, { root: scratch, print: true }))
for (const result of results) {
  writeFileSync(join(HERE, "raw", result.case + ".json"), JSON.stringify(result, null, 2) + "\n")
  writeFileSync(join(HERE, "raw", result.case + ".log"), result.lines.map((line) => "[" + result.case + "] " + line).join("\n") + "\n")
}

const byCase = Object.fromEntries(results.map((r) => [r.case, r.observation]))
const contrast = {
  completedTurnIdle: {
    decisions: byCase["completed-turn-idle"]?.decisions ?? null,
    scenesWritten: byCase["completed-turn-idle"]?.scenesWritten ?? null,
    incidents: byCase["completed-turn-idle"]?.incidents ?? null,
    holdsApplied: byCase["completed-turn-idle"]?.holdsApplied ?? null,
    beyondTwiceTheThreshold: byCase["completed-turn-idle"]?.beyondTwiceTheThreshold ?? null,
    recordByteIdentical: byCase["completed-turn-idle"]?.recordByteIdentical ?? null,
  },
  midTurnStall: {
    decisions: byCase["mid-turn-stall"]?.decisions ?? null,
    scenesWritten: byCase["mid-turn-stall"]?.scenesWritten ?? null,
    holdsApplied: byCase["mid-turn-stall"]?.holdsApplied ?? null,
    hold: byCase["mid-turn-stall"]?.hold ?? null,
  },
}
contrast.ok =
  Array.isArray(contrast.completedTurnIdle.decisions) &&
  contrast.completedTurnIdle.decisions.length === 0 &&
  contrast.completedTurnIdle.scenesWritten === 0 &&
  contrast.completedTurnIdle.incidents === 0 &&
  contrast.completedTurnIdle.holdsApplied === 0 &&
  contrast.completedTurnIdle.beyondTwiceTheThreshold === true &&
  contrast.completedTurnIdle.recordByteIdentical === true &&
  (contrast.midTurnStall.decisions ?? []).join(",") === "warn,warn,escalate" &&
  contrast.midTurnStall.holdsApplied === 1 &&
  contrast.midTurnStall.scenesWritten === 3

const summary = {
  task: "t73",
  amendment: "post-terminal re-run of the two boundary fixtures after the team-scoped streakKey change",
  why: "t71's boundary fix (lastKind / withhold+reset on turn-end) and t73's key fix touch the same functions, so the boundary expectations had to be re-measured on the tree carrying BOTH.",
  fixture: "packages/mpd-team-watchdog-plugin/test/fixtures/inject.mjs",
  fixtureSha256: createHash("sha256").update(readFileSync(FIXTURE)).digest("hex"),
  boundaryCases: BOUNDARY_CASES,
  clock: { base: CLOCK.base, frozen: FROZEN },
  contrast,
  results: results.map((r) => ({ case: r.case, ok: r.ok, observation: r.observation })),
  ok: contrast.ok && results.every((r) => r.ok),
  notClaimed: NOT_CLAIMED,
}
writeFileSync(join(HERE, "result.json"), JSON.stringify(summary, null, 2) + "\n")

const lines = []
lines.push("================================================================")
lines.push("t73 amendment — the two boundary fixtures re-run after the streak-key change")
lines.push("fixture sha256: " + summary.fixtureSha256)
lines.push("frozen thresholds: warnSilenceMs " + FROZEN.warnSilenceMs + " / warnStreakToEscalate " + FROZEN.warnStreakToEscalate)
lines.push("================================================================")
for (const result of results) {
  lines.push("")
  lines.push("── case " + result.case + " ── ok=" + result.ok + " ──")
  for (const line of result.lines) lines.push("  " + line)
}
lines.push("")
lines.push("── CONTRAST ──")
lines.push("  " + JSON.stringify(contrast))
lines.push("")
lines.push("── NOT CLAIMED ──")
for (const limit of NOT_CLAIMED) lines.push("  - " + limit)
writeFileSync(join(HERE, "output.log"), lines.join("\n") + "\n")
console.log(lines.join("\n"))
process.exit(summary.ok ? 0 : 1)
