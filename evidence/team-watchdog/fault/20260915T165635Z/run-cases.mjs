// t66 (w8) evidence runner — runs every injectable fault case and records it.
//
// This is the EVIDENCE driver, not the lane (`skills/**` is w9's): it imports the fixture
// module from the package and records each case's own observation, its raw injected
// scenario, and its verdict.
//
// Usage: bun run-cases.mjs            (all cases, exit 0 iff every case passed)
//        bun run-cases.mjs warn-90s   (one case by name)
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, "..", "..", "..", "..")
const FIXTURE = join(REPO, "packages", "mpd-team-watchdog-plugin", "test", "fixtures", "inject.mjs")
if (!existsSync(FIXTURE)) {
  console.error("FATAL: fixture module not found at " + FIXTURE)
  process.exit(2)
}

const { runAll, runCase, CASES, scenarios, NOT_CLAIMED, CLOCK, FROZEN, REPO: fixtureRepo, ADOPTED_LIB, WATCHDOG_DIST } = await import(FIXTURE)

const requested = process.argv.slice(2).filter((arg) => !arg.startsWith("-"))
const scratch = join(HERE, "raw", "ws")
mkdirSync(scratch, { recursive: true })

const results = requested.length > 0 ? [await runCase(requested[0], { root: scratch, print: true })] : await runAll({ root: scratch, print: true })

// ── per-case raw evidence ───────────────────────────────────────────────────
for (const result of results) {
  writeFileSync(join(HERE, "raw", result.case + ".json"), JSON.stringify(result, null, 2) + "\n")
  writeFileSync(join(HERE, "raw", result.case + ".log"), result.lines.map((line) => "[" + result.case + "] " + line).join("\n") + "\n")
}

const probe = await import(FIXTURE)
const summary = {
  task: "t66",
  fixture: "packages/mpd-team-watchdog-plugin/test/fixtures/inject.mjs",
  fixtureSha256: createHash("sha256").update(readFileSync(FIXTURE)).digest("hex"),
  entryPoint: "runCase(name, {root, print}) / runAll({root, print}) / CASES / scenarios() / CLOCK / FROZEN / NOT_CLAIMED",
  casesRequested: requested.length > 0 ? requested : CASES,
  clock: { base: CLOCK.base, note: "every stamp carries an explicit `at` and every tick an explicit `now`, so the FROZEN thresholds run in milliseconds" },
  frozenThresholds: FROZEN,
  drives: {
    realAdoptedScheduler: join(ADOPTED_LIB, "scheduler.js"),
    realHaltPath: join(ADOPTED_LIB, "tools.js") + " (haltTeamWork, imported and CALLED)",
    realWatchdogDist: WATCHDOG_DIST,
    fixtureRepoRoot: fixtureRepo,
  },
  haltControlMechanism: "the REAL adopted haltTeamWork, imported from the adopted lib and called with the fixture's captain/ctx — never stubbed, never weakened",
  results: results.map((result) => ({ case: result.case, ok: result.ok, observation: result.observation })),
  ok: results.every((result) => result.ok),
  notClaimed: NOT_CLAIMED,
}
writeFileSync(join(HERE, "result.json"), JSON.stringify(summary, null, 2) + "\n")
writeFileSync(join(HERE, "scenario.json"), JSON.stringify({ injectedScenarios: scenarios(), clock: CLOCK, frozen: FROZEN }, null, 2) + "\n")

const lines = []
lines.push("================================================================")
lines.push("t66 (w8) fault-injection fixture — case run")
lines.push("repo: " + REPO)
lines.push("fixture: " + FIXTURE)
lines.push("fixture sha256: " + summary.fixtureSha256)
lines.push("clock: base " + CLOCK.base + " (injected); frozen warnSilenceMs " + FROZEN.warnSilenceMs + " / warnStreakToEscalate " + FROZEN.warnStreakToEscalate)
lines.push("================================================================")
for (const result of results) {
  lines.push("")
  lines.push("── case " + result.case + " ── ok=" + result.ok + " ──")
  for (const line of result.lines) lines.push("  " + line)
  lines.push("  observation: " + JSON.stringify(result.observation, null, 2).split("\n").join("\n  "))
}
lines.push("")
lines.push("── verdicts ──")
for (const result of results) lines.push("  " + (result.ok ? "PASS" : "FAIL") + "  " + result.case)
lines.push("")
lines.push("── NOT CLAIMED (W-3 and friends) ──")
for (const limit of NOT_CLAIMED) lines.push("  - " + limit)
writeFileSync(join(HERE, "output.log"), lines.join("\n") + "\n")
console.log(lines.join("\n"))

for (const result of results) if (!result.ok) process.exit(1)
process.exit(0)
