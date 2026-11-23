import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

/** Public replay treats CLI results and receipts as untrusted JSON. */
type Row = Readonly<Record<string, unknown>>
/** Resolve source from this checked-in replay, independent of the caller's working directory. */
const repo = fileURLToPath(new URL("../../../", import.meta.url))

/** Narrow one decoded object for field checks. */
function row(value: unknown): Row {
  assert.ok(value !== null && typeof value === "object" && !Array.isArray(value))
  return value as Row
}

/** Decode an array of rows through the same shape check. */
function rows(value: unknown): readonly Row[] {
  assert.ok(Array.isArray(value))
  return value.map(row)
}

/** Refuse missing or nonnumeric summary values before doing arithmetic. */
function number(value: unknown): number {
  assert.ok(typeof value === "number" && Number.isFinite(value))
  return value
}

/** Generate a fixture file using only invented identifiers and values. */
function put(root: string, path: string, value: object, jsonl = false): void {
  const target = join(root, path)
  mkdirSync(dirname(target), { recursive: true })
  assert.ok(!jsonl || Array.isArray(value))
  const content = jsonl && Array.isArray(value) ? value.map((entry) => JSON.stringify(entry)).join("\n") : JSON.stringify(value)
  writeFileSync(target, content + "\n", { flag: "wx" })
}

/** Exercise the deployed CLI through the current Node executable and require a zero exit. */
function run(metric: "serial" | "ceremony" | "growth", root: string): Row {
  const result = spawnSync(process.execPath, [join(repo, `scripts/baseline/${metric}.ts`), root], { encoding: "utf8" })
  assert.ifError(result.error)
  assert.equal(result.status, 0, result.stderr)
  return row(JSON.parse(result.stdout))
}

/** Replay both retained counts and pass-time set evidence through the public entry point. */
function serial(root: string): void {
  const readyIds = ["T1", "T2", "T3"]
  const pairs = [{ taskId: "T2" }]
  const skipped = [
    { taskId: "T1", reason: 'declared owner "fixture" is BUSY on another task — reported, never substituted' },
    { taskId: "T3", reason: 'declared owner "fixture" is not on this team\'s roster — the row stays pending' },
    { taskId: "T4", reason: "not ready (blocked by T2)" },
  ]
  const teamId = "team-fixture"
  const pass = { event: "dispatch-pass", teamId }
  put(root, ".mpd/cellwork/cell-fixture/journal.jsonl", [
    { ...pass, readyIds, pairs, skipped },
    { ...pass, readyIds: [], pairs: [], skipped: [] },
    { ...pass, pairs: 1, skipped: 1, grown: 0 },
    { ...pass, readyIds: ["T1"], pairs: [{ taskId: "T2" }], skipped: [{ taskId: "T1" }] },
    { event: pass.event, pairs: 1, skipped: 0 },
  ], true)
  put(root, ".mpd/team/teams/team-empty.json", { version: 1, teamId: "team-empty", tasks: [] })
  put(root, ".mpd/team/dispatch.json", {
    "team-fixture::T5": { teamId, taskId: "T5", memberId: "fixture-executor", assignedAt: "2026-01-01T00:00:00Z" },
  })
  const result = run("serial", root)
  const teams = rows(result.teams)
  const measuredTeam = row(teams.find((item) => item.teamId === teamId))
  const [measured, emptyPass, countsOnly, contradiction] = rows(measuredTeam.passes)
  assert.ok(measured && emptyPass && countsOnly && contradiction)
  const absent = readyIds.filter((id) => pairs.every((pair) => pair.taskId !== id))
  assert.deepEqual(measured.readyButUnpairedIds, absent)
  assert.deepEqual([measured.readyButUnpaired, measured.pairedReadyRatio], [absent.length, pairs.length / readyIds.length])
  assert.deepEqual(measured.reasons, { "busy-owner": 1, "owner-not-on-roster": 1, "not-ready": 1, other: 0, UNMEASURED: 0 })
  assert.equal(emptyPass.readyButUnpaired, 0)
  assert.deepEqual([countsOnly.pairedPerPass, countsOnly.readyButUnpaired, countsOnly.reasons], [1, "UNMEASURED", "UNMEASURED"])
  assert.equal(contradiction.readyButUnpaired, "UNMEASURED")
  assert.equal(row(contradiction.reasons).UNMEASURED, 1)
  assert.equal(measuredTeam.currentDeliveryReceipts, 1)
  assert.equal(rows(result.unattributedPasses).length, 1)
  const empty = row(teams.find((item) => item.teamId === "team-empty"))
  assert.deepEqual([empty.readyRowsPerPass, empty.pairedPerPass, empty.readyButUnpaired], [0, 0, 0])
}

/** Separate archive approval from board counts and verify ambiguous materialisation claims. */
function ceremony(root: string): void {
  const createdAt = "2026-01-01T00:00:00Z"
  const approvedAt = "2026-01-01T00:02:30Z"
  put(root, ".mpd/team/archive/plan-shell/plan.json", { version: 2, planId: "plan-shell", members: [], tasks: [] })
  mkdirSync(join(root, ".mpd/team/teams"), { recursive: true })
  const shellOnly = run("ceremony", root)
  assert.deepEqual([shellOnly.teamRecords, shellOnly.emptyShells, shellOnly.structurallyEmptyShells], [0, 1, 1])
  const boardCount = row(row(shellOnly.coverage).teamRecords)
  assert.deepEqual([boardCount.observed, boardCount.complete, boardCount.gaps], [0, true, []])
  put(root, ".mpd/team/archive/plan-approved/plan.json", { version: 1, planId: "plan-approved", approvedAt, members: [], tasks: [] })
  const members = [{ name: "fixture" }]
  const tasks = [{ id: "T1" }, { id: "T2" }]
  put(root, ".mpd/team/archive/plan-staged/plan.json", { version: 2, planId: "plan-staged", members, tasks })
  for (const teamId of ["team-shared", "team-minted", "team-unverified"]) {
    put(root, `.mpd/team/teams/${teamId}.json`, { version: 1, teamId, createdAt, approvedAt, members, tasks })
  }
  for (const cellId of ["cell-one", "cell-two"]) {
    put(root, `.mpd/cellwork/${cellId}/state.json`, { version: 1, cellId, teamId: "team-shared", planningTeamId: "team-missing", mintedTeamId: "" })
  }
  put(root, ".mpd/cellwork/cell-one/journal.jsonl", [
    { event: "cell-activation-partial", mintedTeamId: "team-minted", minted: true },
    { event: "activate", resolvedTeamId: "team-unverified", boardResolution: "unverified" },
  ], true)
  const result = run("ceremony", root)
  assert.deepEqual([result.teamRecords, result.emptyShells, result.structurallyEmptyShells, result.archivedApprovedPlans, result.cells], [3, 2, 1, 1, 2])
  const firstCell = row(rows(result.cellRecords).find((item) => item.cellId === "cell-one"))
  assert.deepEqual(firstCell.attributedTeamIds, ["team-minted"])
  assert.deepEqual(firstCell.ambiguousTeamIds, ["team-missing", "team-shared"])
  assert.deepEqual(result.unmatchedTeamIds, ["team-missing"])
  assert.deepEqual(result.unattributedTeamIds, ["team-unverified"])
  const elapsedMinutes = (Date.parse(approvedAt) - Date.parse(createdAt)) / 60_000
  for (const team of rows(result.teams)) {
    assert.deepEqual([team.minutesToApproval, team.members, team.tasks], [elapsedMinutes, members.length, tasks.length])
  }
}

/** Compute sort-based distribution expectations from invented raw operands. */
function distribution(values: readonly number[]): Row {
  const ordered = values.toSorted((a, b) => a - b)
  const half = Math.floor(ordered.length / 2)
  const median = ordered.length % 2 === 0 ? ((ordered[half - 1] ?? 0) + (ordered[half] ?? 0)) / 2 : ordered[half]
  return { count: ordered.length, min: ordered[0], median, max: ordered.at(-1) }
}

/** Replay arithmetic with measurable zeros, a missing window and a rejected zero turn. */
function growth(root: string): void {
  const checkpoints = [
    { turn: 0, usedTokens: 100, windowTokens: 200 },
    { turn: 2, usedTokens: 0, windowTokens: 200 },
    { turn: 3, usedTokens: 450, windowTokens: null },
    { turn: 4, usedTokens: 100, windowTokens: 200 },
  ]
  put(root, ".mpd/cellwork/cell-fixture/journal.jsonl", checkpoints.map((record) => ({ event: "checkpoint", ...record })), true)
  const result = run("growth", root)
  const valid = checkpoints.filter((record) => record.turn > 0)
  const turns = valid.map((record) => record.turn)
  const averages = valid.map((record) => record.usedTokens / record.turn)
  const ratios = valid.flatMap((record) => record.windowTokens === null ? [] : [record.usedTokens / record.windowTokens])
  assert.deepEqual(rows(result.rows).map((record) => record.tokensPerTurn), averages)
  assert.deepEqual(rows(result.rows).map((record) => record.observedRatio), [0, "UNMEASURED", 0.5])
  assert.deepEqual(result.distribution, { tokensPerTurn: distribution(averages), observedRatio: distribution(ratios), turn: distribution(turns) })
  assert.equal(rows(result.skipped)[0]?.reason, "zero turn")
  assert.equal(row(result.hostComposition).compactionThresholdRatio, "unknown")
}

/** Measure the two original reviewer findings and their mixed-coverage controls. */
function findings(root: string): Row {
  const serialRoot = join(root, "serial")
  const pass = { event: "dispatch-pass", teamId: "team-fixture", readyIds: ["A", "B"], pairs: [{ taskId: "A" }] }
  put(serialRoot, ".mpd/cellwork/cell-fixture/journal.jsonl", [
    { ...pass, skipped: [] },
    { ...pass, skipped: [{ taskId: "B" }, { taskId: "C", reason: "not ready (blocked by A)" }] },
    pass,
  ], true)
  const passes = rows(row(rows(run("serial", serialRoot).teams)[0]).passes)
  const serialResults = passes.map(({ readyButUnpaired, reasons }) => ({ readyButUnpaired, reasons }))

  const ceremonyRoot = join(root, "ceremony")
  const invalidBoard = join(ceremonyRoot, ".mpd/team/teams/team-invalid.json")
  const invalidPlan = join(ceremonyRoot, ".mpd/team/archive/plan-invalid/plan.json")
  for (const target of [invalidBoard, invalidPlan]) {
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, "{invalid\n", { flag: "wx" })
  }
  // An archive folder without its expected plan is a separate coverage gap.
  mkdirSync(join(ceremonyRoot, ".mpd/team/archive/plan-missing"))
  const malformedOnly = run("ceremony", ceremonyRoot)
  put(ceremonyRoot, ".mpd/team/teams/team-valid.json", { version: 1, teamId: "team-valid", members: [], tasks: [] })
  put(ceremonyRoot, ".mpd/team/archive/plan-valid/plan.json", { version: 2, planId: "plan-valid", members: [], tasks: [] })
  const mixed = run("ceremony", ceremonyRoot)
  const structureRoot = join(root, "structure")
  put(structureRoot, ".mpd/team/archive/plan-incomplete-shape/plan.json", { version: 2, planId: "plan-incomplete-shape" })
  const partialShell = run("ceremony", structureRoot)

  /** Retain only fields that demonstrate these findings. */
  const ceremonyProjection = (record: Row): Row => ({
    teamRecords: record.teamRecords, emptyShells: record.emptyShells, structurallyEmptyShells: record.structurallyEmptyShells,
    unknownApprovalCandidates: rows(record.unknownApprovalPlans).map(({ planId }) => planId), coverage: record.coverage,
  })
  return { serial: serialResults, malformedOnly: ceremonyProjection(malformedOnly), mixed: ceremonyProjection(mixed), partialShell: ceremonyProjection(partialShell) }
}

/** Confirm incomplete totals report proven lower bounds rather than claiming exact zero. */
function checkFindings(observed: Row): void {
  const [unexplained, explicit, missingList] = rows(observed.serial)
  assert.ok(unexplained && explicit && missingList)
  assert.deepEqual([unexplained.readyButUnpaired, row(unexplained.reasons).UNMEASURED], [1, 1])
  assert.deepEqual([row(explicit.reasons).UNMEASURED, row(explicit.reasons)["not-ready"]], [1, 1])
  assert.deepEqual([row(missingList.reasons).UNMEASURED, row(missingList.reasons)["not-ready"]], [1, "UNMEASURED"])
  for (const [fixture, confirmed] of [["malformedOnly", 0], ["mixed", 1]] as const) {
    const result = row(observed[fixture])
    const coverage = row(result.coverage)
    for (const field of ["teamRecords", "emptyShells", "structurallyEmptyShells"]) {
      assert.equal(result[field], "unknown")
      const metric = row(coverage[field])
      assert.deepEqual([metric.observed, metric.complete], [confirmed, false])
      assert.ok(rows(metric.gaps).length > 0)
    }
    assert.deepEqual(result.unknownApprovalCandidates, ["plan-invalid", "plan-missing"])
    assert.deepEqual(rows(row(coverage.emptyShells).gaps).map(({ state }) => state), ["malformed", "absent"])
  }
  const partialShell = row(observed.partialShell)
  assert.deepEqual([partialShell.emptyShells, partialShell.structurallyEmptyShells], [1, "unknown"])
}

/** Cross-check the published reductions and the preserved capture fingerprints. */
function aggregates(): void {
  const measurements = row(JSON.parse(readFileSync(new URL("measurements.json", import.meta.url), "utf8")))
  const snapshots = rows(measurements.snapshots)
  assert.deepEqual(snapshots.map((item) => item.workspace), ["A", "B", "integration"])
  for (const { serial, ceremony, growth, inputFingerprints } of snapshots) {
    const s = row(serial)
    const attributed = row(s.attributed)
    const unattributed = row(s.unattributed)
    for (const count of ["passes", "pairs"]) assert.equal(number(s[count]), number(attributed[count]) + number(unattributed[count]))
    assert.ok(number(s.readySetPasses) <= number(s.passes))
    assert.ok(number(s.reasonPasses) <= number(s.passes))
    if (s.readySetPasses === 0) assert.equal(s.readyButUnpaired, "UNMEASURED")
    const c = row(ceremony)
    assert.ok(number(c.structurallyEmptyShells) <= number(c.unapprovedShells))
    assert.ok(number(c.boardsWithApprovalTime) <= number(c.teamRecords))
    const g = row(growth)
    assert.equal(number(g.checkpointRows), number(g.measuredRows) + number(g.skippedRows))
    if (g.measuredRows === 0) assert.equal(g.tokensPerTurn, "UNMEASURED")
    else assert.equal(row(g.tokensPerTurn).count, g.measuredRows)
    for (const fingerprint of Object.values(row(inputFingerprints)).map(row)) {
      assert.match(String(fingerprint.first), /^[a-f0-9]{64}$/)
      assert.equal(fingerprint.first, fingerprint.second)
      assert.equal(fingerprint.firstFiles, fingerprint.secondFiles)
    }
  }
}

/** The runner owns only the fresh temporary directory it resolves below. */
const temp = realpathSync(tmpdir())
const root = mkdtempSync(join(temp, "mpd-public-wave0-"))
try {
  const measuredFindings = findings(join(root, "findings"))
  if (process.argv[2] === "--findings") {
    process.stdout.write(JSON.stringify(measuredFindings, null, 2) + "\n")
  } else {
    checkFindings(measuredFindings)
    serial(join(root, "serial"))
    ceremony(join(root, "ceremony"))
    growth(join(root, "growth"))
    aggregates()
    process.stdout.write("PASS serial controls, ceremony controls, growth arithmetic, both missing-data findings, published aggregate reconciliation\n")
  }
} finally {
  assert.equal(realpathSync(root), root)
  assert.equal(dirname(root), temp)
  assert.match(basename(root), /^mpd-public-wave0-[A-Za-z0-9]+$/)
  rmSync(root, { recursive: true })
}
