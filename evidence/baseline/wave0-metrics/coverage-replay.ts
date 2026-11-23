import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

/** Locate the checked-out CLI entry points from the packet. */
const repo = fileURLToPath(new URL("../../../", import.meta.url))
/** Synthetic timestamps are independent of a local host clock. */
const at = "2026-01-01T00:00:00.000Z"
/** Narrow process output before inspecting documented fields. */
type Row = Readonly<Record<string, unknown>>

/** Require an object report or row. */
function row(value: unknown): Row {
  assert.ok(value !== null && typeof value === "object" && !Array.isArray(value))
  return value as Row
}

/** Assert that each array entry carries object fields. */
function rows(value: unknown): readonly Row[] {
  assert.ok(Array.isArray(value))
  return value.map(row)
}

/** Materialize an invented record beneath a unique workspace directory. */
function put(workspace: string, path: string, content: string): void {
  const target = join(workspace, path)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, content, { flag: "wx" })
}

/** Run the shipping instrument through the same CLI used by operators. */
function run(metric: "collect" | "ceremony" | "serial" | "growth", workspace: string, ...args: string[]): Row {
  return row(JSON.parse(execFileSync(process.execPath, [join(repo, `scripts/baseline/${metric}.ts`), workspace, ...args], { encoding: "utf8" })))
}

/** An activation can name a stale pointer and a separate unresolved fallback. */
function activation(root: string): object {
  for (const teamId of ["team-old", "team-resolved", "team-planning"]) {
    put(root, `.mpd/team/teams/${teamId}.json`, JSON.stringify({ version: 1, teamId, members: [], tasks: [] }))
  }
  for (const [cellId, boardResolution] of [["cell-unverified", "unverified"], ["cell-verified", "verified"]]) {
    put(root, `.mpd/cellwork/${cellId}/state.json`, JSON.stringify({ version: 1, cellId, teamId: "team-old", planningTeamId: "team-planning" }))
    put(root, `.mpd/cellwork/${cellId}/journal.jsonl`, JSON.stringify({
      event: "activate", at, teamId: "team-old", recordedTeamId: "team-old", resolvedTeamId: "team-resolved", boardResolution,
    }) + "\n")
  }
  /** Keep counts and provenance without including generated workspace paths. */
  const collector = rows(run("collect", root).teamsPerCell).map(({ cellId, count, presentTeamIds, missingTeamIds, unverifiedTeamIds, complete }) =>
    ({ cellId, count, presentTeamIds, missingTeamIds, unverifiedTeamIds, complete }))
  const ceremony = rows(run("ceremony", root).cellRecords).map(({ cellId, links, unverifiedLinks }) => ({ cellId,
    linkedIds: [...new Set(rows(links).map((link) => link.teamId))].sort(),
    candidateIds: [...new Set(rows(unverifiedLinks).map((link) => link.teamId))].sort(),
  }))
  return { collector, ceremony }
}

/** Explicitly selecting the same source twice cannot create a second pass. */
function duplicate(root: string): object {
  const journal = ".mpd/cellwork/cell-fixture/journal.jsonl"
  const pass = JSON.stringify({ event: "dispatch-pass", at, teamId: "team-fixture", pairs: 1, skipped: 0 }) + "\n"
  put(root, journal, pass)
  put(root, "separate.jsonl", pass)
  function counts(report: Row): readonly [number, number] {
    return [rows(row(rows(report.teams)[0]).passes).length, rows(report.sources).filter((source) => source.path === journal && source.state === "read").length]
  }
  return { discovered: counts(run("serial", root)), repeated: counts(run("serial", root, "--pass-capture", journal)),
    separate: counts(run("serial", root, "--pass-capture", "separate.jsonl")) }
}

/** Retain valid measurements from a partially readable checkpoint inventory. */
function growth(root: string): object {
  const checkpoint = JSON.stringify({ event: "checkpoint", at, usedTokens: 600, windowTokens: 1000, turn: 3 }) + "\n"
  const zeroTurn = JSON.stringify({ event: "checkpoint", at, usedTokens: 300, windowTokens: 1000, turn: 0 }) + "\n"
  const clean = join(root, "clean")
  put(clean, ".mpd/cellwork/cell-valid/journal.jsonl", checkpoint + zeroTurn)
  const partial = join(root, "partial")
  put(partial, ".mpd/cellwork/cell-mixed/journal.jsonl", checkpoint + "{broken\n" + zeroTurn)
  mkdirSync(join(partial, ".mpd/cellwork/cell-missing"), { recursive: true })
  const unreadable = join(partial, ".mpd/cellwork/cell-unreadable/journal.jsonl")
  mkdirSync(dirname(unreadable), { recursive: true })
  symlinkSync(join(clean, ".mpd/cellwork/cell-valid/journal.jsonl"), unreadable)
  const empty = join(root, "empty")
  mkdirSync(empty)
  function counts(report: Row): object {
    return { checkpointRows: report.checkpointRows, measuredRows: report.measuredRows,
      skipped: rows(report.skipped).map(({ reason }) => reason), distribution: report.distribution, coverage: report.coverage }
  }
  return { clean: counts(run("growth", clean)), partial: counts(run("growth", partial)), empty: counts(run("growth", empty)) }
}

/** Check all three findings without consulting implementation modules or private records. */
function check(observed: Row): void {
  const provenance = row(observed.activation)
  const [unverified, verified] = rows(provenance.collector)
  assert.ok(unverified && verified)
  assert.deepEqual([unverified.count, unverified.presentTeamIds, unverified.unverifiedTeamIds, unverified.complete],
    [1, ["team-planning"], ["team-old", "team-resolved"], false])
  assert.deepEqual([verified.count, verified.presentTeamIds, verified.unverifiedTeamIds, verified.complete],
    [2, ["team-planning", "team-resolved"], ["team-old"], false])
  assert.deepEqual(provenance.ceremony, [
    { cellId: "cell-unverified", linkedIds: ["team-planning"], candidateIds: ["team-old", "team-resolved"] },
    { cellId: "cell-verified", linkedIds: ["team-planning", "team-resolved"], candidateIds: ["team-old"] },
  ])
  assert.deepEqual(observed.duplicates, { discovered: [1, 1], repeated: [1, 1], separate: [2, 1] })
  const results = row(observed.growth)
  const clean = row(results.clean)
  const partial = row(results.partial)
  const empty = row(results.empty)
  assert.deepEqual([clean.checkpointRows, clean.measuredRows, clean.skipped], [2, 1, ["zero turn"]])
  assert.equal(row(row(clean.coverage).checkpoints).complete, true)
  assert.equal(row(row(row(clean.coverage).distributions).tokensPerTurn).complete, true)
  assert.deepEqual([partial.checkpointRows, partial.measuredRows, partial.skipped], ["UNMEASURED", 1, ["zero turn"]])
  assert.deepEqual(partial.distribution, clean.distribution)
  const coverage = row(partial.coverage)
  const totals = row(coverage.checkpoints)
  assert.deepEqual([totals.observed, totals.complete], [2, false])
  assert.deepEqual(rows(totals.gaps).map(({ state }) => state).sort(), ["absent", "malformed", "unreadable"])
  assert.ok(Object.values(row(coverage.distributions)).map(row).every((field) => field.complete === false))
  assert.equal(empty.checkpointRows, 0)
  assert.equal(row(row(empty.coverage).checkpoints).complete, true)
}

/** Scope cleanup to the uniquely created sandbox. */
const base = realpathSync(tmpdir())
const root = mkdtempSync(join(base, "mpd-public-wave0-coverage-"))
try {
  mkdirSync(join(root, "growth"))
  const observed = { activation: activation(join(root, "activation")), duplicates: duplicate(join(root, "duplicates")), growth: growth(join(root, "growth")) }
  if (process.argv[2] === "--observed") process.stdout.write(JSON.stringify(observed, null, 2) + "\n")
  else {
    check(observed)
    process.stdout.write("PASS activation provenance, duplicate pass source, partial growth and zero-turn coverage\n")
  }
} finally {
  assert.equal(realpathSync(root), root)
  assert.equal(dirname(root), base)
  assert.match(basename(root), /^mpd-public-wave0-coverage-[A-Za-z0-9]+$/)
  rmSync(root, { recursive: true })
}
