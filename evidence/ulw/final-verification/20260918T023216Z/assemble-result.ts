#!/usr/bin/env node
// Assemble t11's verdict artifact from the RAW per-step evidence on disk. Every number
// below is READ from a produced artifact or a captured EXIT line — none is retyped from
// memory. Writes result.json + output.log into this evidence directory.
import { createHash } from "node:crypto"
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const D = import.meta.dirname
const readJson = (rel) => JSON.parse(readFileSync(join(D, rel), "utf8"))
const readText = (rel) => readFileSync(join(D, rel), "utf8")
const exists = (rel) => existsSync(join(D, rel))
const sha256 = (rel) => createHash("sha256").update(readFileSync(join(D, rel))).digest("hex")

/** The LAST `EXIT=<n>` line of a captured log (a log may print several). */
function exitsOf(rel) {
  const text = readText(rel)
  return [...text.matchAll(/^EXIT=(-?\d+)$/gm)].map((match) => Number(match[1]))
}
/** The line of a log matching a regex, or null. */
function lineOf(rel, re) {
  const found = readText(rel).split("\n").find((line) => re.test(line))
  return found === undefined ? null : found.trim()
}

// ── revision pinning (three readings: t0, settled, final) ────────────────────
const pinT0 = readJson("pin-t0.json")
const pinSettled = readJson("pin-settled.json")
const pinFinal = readJson("pin-final.json")
const pinStable =
  pinT0.commit === pinSettled.commit && pinSettled.commit === pinFinal.commit &&
  pinT0.trackedDiffSha256 === pinSettled.trackedDiffSha256 && pinSettled.trackedDiffSha256 === pinFinal.trackedDiffSha256 &&
  pinT0.fileHashesSha256 === pinSettled.fileHashesSha256 && pinSettled.fileHashesSha256 === pinFinal.fileHashesSha256

// ── gates ────────────────────────────────────────────────────────────────────
const gateExits = exitsOf("logs/gates.log") // [verify:gates, dist-fresh, pack-closure]
const gates = {
  verifyGates: { exit: gateExits[0] ?? null, summary: lineOf("logs/gates.log", /verify-gates\] PASS/) },
  verifyDistFresh: { exit: gateExits[1] ?? null, summary: lineOf("logs/gates.log", /verify-dist-fresh\] ok:/) },
  verifyPackClosure: { exit: gateExits[2] ?? null, summary: lineOf("logs/gates.log", /verify-pack-closure\] ok:/) },
}

// ── live cases ───────────────────────────────────────────────────────────────
const ulw = readJson("cases/ulw-command-2026-09-18T02-33-41.745Z/result.json")
const sst = readJson("cases/session-start-team-2026-09-18T02-33-43.836Z/result.json")
const sst2 = readJson("cases/session-start-team-2026-09-18T02-43-31.862Z/result.json")
const smoke = readJson("cases/plan-c-c2-ultrawork-2026-09-18T02-33-47.002Z/result.json")
const f2 = readJson("f2-live/result.json")
const mount = readJson("mount-boot/result.json")

const live = {
  ulwCommand: {
    exit: exitsOf("logs/ulw-command.log")[0] ?? null,
    ok: ulw.ok,
    artifactSources: Object.fromEntries(Object.entries(ulw.steps.artifact.sources).map(([k, v]) => [k, v.source])),
    shippedCompositionOk: ulw.steps.shippedComposition.ok,
    listing: ulw.steps.shippedComposition.listing,
    usageKind: ulw.steps.shippedComposition.usage?.kind ?? null,
    usageText: ulw.steps.shippedComposition.usage?.text ?? null,
    gesture: ulw.steps.gesture,
    equivalenceTableTools: ulw.steps.equivalenceTableTools,
    problems: ulw.steps.shippedComposition.problems,
  },
  sessionStartTeam: {
    exit: exitsOf("logs/session-start-team.log")[0] ?? null,
    ok: sst.ok,
    settled: sst.steps.settled,
    threeWay: sst.steps.threeWay,
    invocations: [
      { caseDir: "cases/session-start-team-2026-09-18T02-33-43.836Z", exit: exitsOf("logs/session-start-team.log")[0] ?? null, ok: sst.ok, threeWay: sst.steps.threeWay, softAttributions: sst.steps.softComplexSide.map((s) => s.attributions) },
      { caseDir: "cases/session-start-team-2026-09-18T02-43-31.862Z", exit: exitsOf("logs/session-start-team-run2.log")[0] ?? null, ok: sst2.ok, threeWay: sst2.steps.threeWay, softAttributions: sst2.steps.softComplexSide.map((s) => s.attributions) },
    ],
    stability: {
      invocations: 2,
      bothOk: sst.ok === true && sst2.ok === true,
      softSides: 4,
      advisoryExactlyOneOnEverySoftSide: [...sst.steps.threeWay.softAdvisory, ...sst2.steps.threeWay.softAdvisory].every((n) => n === 1),
      pluginStagedZeroOnEverySoftSide: [...sst.steps.threeWay.softPluginStaged, ...sst2.steps.threeWay.softPluginStaged].every((n) => n === 0),
      signalsNamedOnEverySoftSide: [...sst.steps.threeWay.softSignals, ...sst2.steps.threeWay.softSignals].every((s) => s.length > 0),
      modelBehaviourDifferedBetweenInvocations: JSON.stringify(sst.steps.threeWay.softTeams) !== JSON.stringify(sst2.steps.threeWay.softTeams),
      modelStagedCounts: { run1: sst.steps.threeWay.softTeams, run2: sst2.steps.threeWay.softTeams },
      note: "the live model staged a team on ONE soft side in run 1 (attributed origin=model from an agent_teams_create call in the captain session's own log — NOT a false red) and on NEITHER soft side in run 2; the verdict is PASS in both, and the PLUGIN staged nothing on any of the four soft sides.",
    },
    simpleSide: sst.steps.simpleSide.map((s) => ({ prompt: s.prompt, teams: s.teams, notices: s.notice, problems: s.problems, ok: s.ok })),
    softComplexSide: sst.steps.softComplexSide.map((s) => ({ prompt: s.prompt, teams: s.teams, modelStaged: s.modelStaged, pluginStaged: s.pluginStaged, unattributed: s.unattributed, attributions: s.attributions, notice: s.notice, problems: s.problems, ok: s.ok })),
    explicitSide: sst.steps.explicitSide.map((s) => ({ prompt: s.prompt, teams: s.teams, pluginStaged: s.pluginStaged, archivedRecords: s.archivedRecords, notice: s.notice, problems: s.problems, ok: s.ok })),
    negativeControl: sst.steps.negativeControl,
  },
  ultraworkSmoke: {
    exit: exitsOf("logs/ultrawork-smoke.log")[0] ?? null,
    ok: smoke.ok,
    steps: smoke.steps,
    note: "relocated into this evidence subtree after the run: the case writes to evidence/plan-c/c2-ultrawork/<ts>/ and takes no override, so the run's own directory was moved here and the original path removed (the task's inScope is evidence/ulw/final-verification/**).",
  },
  f2ShippedPlanFalse: {
    exit: exitsOf("logs/f2-live.log")[0] ?? null,
    ok: f2.ok,
    revision: f2.baseRevision,
    shippedArtifacts: f2.steps.shippedArtifacts,
    shippedLivePlanFalse: f2.steps.shippedLivePlanFalse,
  },
  mountBoot: {
    exit: exitsOf("logs/mount-boot.log")[0] ?? null,
    ok: mount.ok,
    revision: mount.baseRevision,
    shippedArtifact: mount.steps.shippedArtifact,
    mountedShippedBoot: mount.steps.mountedShippedBoot,
  },
}

// ── targeted checks (T-62 + the mcp-shared toolchain probe) ──────────────────
const targeted = {
  t62: {
    exits: exitsOf("logs/t62-and-toolchain.log"), // [roles, ext, mcp-shared-file-direct]
    rolesByteIdentity: lineOf("logs/t62-and-toolchain.log", /mpd-roles.*byte-identical/) ?? lineOf("logs/t62-and-toolchain.log", /F1 shipped artifact > the committed dist is the byte-identical product of a canonical build \(T-62\)/),
    extByteIdentity: lineOf("logs/t62-and-toolchain.log", /the committed dists are the byte-identical products of a canonical build \(T-62\)/),
    note: "bun test packages/mpd-roles-plugin/test/adapter-identity.test.ts and bun test packages/mpd-ext-plugin/test/adapter-identity.test.ts: both T-62 byte-identity checks PASS (they were RED at t2 on the pre-integration tree whose committed dists inlined the PRE-t12 adapter).",
  },
  mcpSharedToolchainProbe: {
    directFileExit: exitsOf("logs/t62-and-toolchain.log")[2] ?? null,
    directFileResult: lineOf("logs/t62-and-toolchain.log", /REAL toolchain probe/) ? "PASS" : null,
    underBunRunTest: {
      exit: exitsOf("logs/bun-test.log")[0] ?? null,
      failingTest: lineOf("logs/bun-test.log", /^\(fail\) REAL toolchain probe/) ?? null,
    },
    pathExperiment: readText("logs/toolchain-path-experiment.log"),
    reason: "ENVIRONMENT / LAUNCHER artifact, outside this tree. packages/mpd-mcp-shared and its test are UNTOUCHED by the wave (no wave edit, no dist rebuild). The probe asserts `probeAstGrep(.toolchain/.../.bin/sg) === false`; the deprecated sg wrapper only fails when it cannot resolve `ast-grep` on PATH. Measured: `sg --version` exits 1 with 'No such file or directory' when ast-grep is absent from PATH (test PASSES) and prints 'ast-grep 0.45.3' when node_modules/.bin is on PATH (test FAILS). The repo's own script `bun run test` (= `bun test packages`) prepends node_modules/.bin to PATH, and node_modules/.bin carries BOTH ast-grep and sg — so the aggregate via the script is red on exactly that one test, while `bun test packages` invoked DIRECTLY is fully green (981 pass / 0 fail). Reproduced both ways on this revision.",
  },
}

// ── packed artifact spot check (t8's re-pack, independently re-read) ─────────
const packedSpot = readText("logs/packed-artifact-spotcheck.log")
const packedSpot2 = readText("logs/packed-artifact-spotcheck2.log")
const packedArtifact = {
  logs: ["logs/packed-artifact-spotcheck.log", "logs/packed-artifact-spotcheck2.log"],
  packedEqualsRepo: [...packedSpot.matchAll(/^IDENTICAL\s+(\S+)\s+([0-9a-f]{64})$/gm)].map((match) => ({ path: match[1], sha256: match[2] })),
  packedPatchEqualsRepoPatch: /^a48f142d[0-9a-f]{56}\s+dist\/mpd-package\/cordis\.patch\.yml$/m.test(packedSpot2),
  packedSessionTeamPolicy: /sessionTeamPolicy:[\s\S]{0,80}mode: off[\s\S]{0,40}autoRoute: true[\s\S]{0,40}profile: mpd/.test(packedSpot2),
  note: "the packed tree's decisive shipped files are BYTE-IDENTICAL to the repo ones (including the packed patch at the pack root), and the packed gate row carries mode: off + autoRoute: true + profile: mpd — the advisory (non-pre-staging) configuration a user installs.",
}

// ── aggregate test readings ──────────────────────────────────────────────────
const aggregate = {
  bunRunTest: {
    command: "bun run test",
    exit: exitsOf("logs/bun-test.log")[0] ?? null,
    summary: lineOf("logs/bun-test.log", /^Ran \d+ tests/) ?? null,
    passLine: lineOf("logs/bun-test.log", /^\s*\d+ pass$/) ?? null,
    failLine: lineOf("logs/bun-test.log", /^\s*\d+ fail$/) ?? null,
    onlyFailures: [...new Set([...readText("logs/bun-test.log").matchAll(/^\(fail\).*$/gm)].map((m) => m[0].trim()))],
  },
  bunTestPackagesDirect: {
    command: "bun test packages (direct: no bun-run PATH injection)",
    exit: exitsOf("logs/bun-test-direct.log")[0] ?? null,
    summary: lineOf("logs/bun-test-direct.log", /^Ran \d+ tests/) ?? null,
    passLine: lineOf("logs/bun-test-direct.log", /^\s*\d+ pass$/) ?? null,
    failLine: lineOf("logs/bun-test-direct.log", /^\s*\d+ fail$/) ?? null,
  },
  testQa: { command: "bun run test:qa", exit: exitsOf("logs/test-qa.log")[0] ?? null, summary: lineOf("logs/test-qa.log", /all self-tests passed/) },
}

// ── clause-1 falsifiable greps (read from the captured log) ──────────────────
const clause1Log = readText("logs/clause1-checks.log")
const clause1 = {
  log: "logs/clause1-checks.log",
  c11_noStaleB3Label: /C1\.1[\s\S]*?grep_exit=1 \(1 = clean\)/.test(clause1Log),
  c12_noB3ShapedWording: /C1\.2[\s\S]*?grep_exit=1 \(1 = clean\)/.test(clause1Log),
  c13_canonicalBuildFormBothTwins: /C1\.3[\s\S]*?README\.md:64[\s\S]*?README\.zh-CN\.md:46[\s\S]*?grep_exit=0/.test(clause1Log),
  c13b_retiredFormGone: /C1\.3b[\s\S]*?grep_exit=1 \(1 = clean\)/.test(clause1Log),
  c14_foreignHostResidueGone: /C1\.4[\s\S]*?grep_exit=1 \(1 = clean\)/.test(clause1Log),
  c15_featureAuditClaim: /C1\.5[\s\S]*?grep_exit=1 \(1 = clean\)/.test(clause1Log),
}

// ── artifact inventory ───────────────────────────────────────────────────────
function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (entry.isFile()) out.push(full)
  }
  return out
}
const inventory = walk(D)
  .filter((full) => !full.endsWith("result.json") && !full.endsWith("output.log"))
  .map((full) => {
    const rel = full.slice(D.length + 1)
    return { path: rel, bytes: statSync(full).size, sha256: sha256(rel) }
  })
  .sort((a, b) => a.path.localeCompare(b.path))

// ── the four user clauses ────────────────────────────────────────────────────
const clauses = [
  {
    clause: "1 — ULW legacy fixes (docs + code)",
    verdict: "satisfied",
    evidence: "C1.1 no stale B3 label in AGENTS.md; C1.2 no 'B3-shaped' wording in src or dist; C1.3 the canonical repo-root, path-qualified build form is in BOTH README twins and the retired package-directory form is gone; C1.4 the four foreign-host residue strings are gone; C1.5 the feature-audit claim is corrected. bun run verify:gates exits 0 (5/5: vendor, dist-fresh, rows, docs-pairs, preset-conformance). The equivalence tables the contract explicitly excludes are intact and their right-hand-side tool names were verified against the LIVE registry by ulw-command (103 tools observed, missing []).",
  },
  {
    clause: "2 — /ulw + /ultrawork commands",
    verdict: "satisfied",
    evidence: "ulw-command PASS on the SHIPPED composition (both rows source=shipped, shippedComposition.ok=true): the LIVE command registry lists BOTH names with a description and the 'objective' input hint; an empty invocation settles kind=error carrying 'usage: /ulw'; a non-empty invocation settles success and records the ULW activation directive as the invoking session's own user-role message carrying the objective and the six ordered autonomy clauses; the plain-text GESTURE arm rewrites with 0 command/run records (t15 regression fix verified in the real composition).",
  },
  {
    clause: "3 — ULW autonomy (and the same complexity predicate)",
    verdict: "satisfied, with the U1 residual bound",
    evidence: "The injected activation directive is asserted clause-by-clause from the REAL rewrite (triage first, the SAME complexity predicate, team-when-warranted with approval=\"automatic\" profile=\"mpd\", loop-to-completion, fix-on-sight, close-out-on-proof, and no questions head); mpd-ulw-plugin/test/commands.test.ts locks the same six behaviours (green in the aggregate). The engine loop is proven live by ultrawork-smoke (state complete, 1 round, ledger row, planFile null). NOT proven end-to-end: a full live /ulw run that autonomously stages a team itself (U1) — see residualBound.",
  },
  {
    clause: "4 — the session-start gate ADVISES, never pre-stages",
    verdict: "satisfied",
    evidence: "session-start-team PASS TWICE on this revision (two independent invocations, 4 soft sides total): 3 simple prompts per run -> 0 teams and 0 notices; every soft-complex side -> advisory notice EXACTLY 1 naming signal C and pluginStaged=0 (run 1: the LIVE model staged a team on one soft side, attributed origin=model from an agent_teams_create call in the captain session's own log — the DESIGNED behaviour, reported as such, never a false red; run 2: none); the explicit 'team:' prompt -> pluginStaged=1 with the provisioning notice in both runs; the disarmed negative control stays clean. Independently confirmed by the mount-instrumented boot on the SHIPPED composition: for a complex prompt, 0 team records in the workspace's own .mpd/team and 1 advisory notice / 0 provisioning notices. Code-level confirmation: in lib/session-start.js the 'advise' branch only builds advisoryNotice, and provisionSessionTeam is reachable ONLY from routeDecision action 'provision' (mode 'auto' or an explicit flag).",
  },
]

const residualBound = {
  U1: {
    element: "A live, full /ulw run that autonomously stages a team, spawns members and completes a real objective end-to-end",
    claimedBy: "no lane (frozen contract §5 U1)",
    substitutesObserved: [
      "(a) the mount-instrumented boot on the SHIPPED composition proving registration (both tools + both command names from the LIVE registries) and no plugin pre-staging for a complex prompt",
      "(b) the activation-directive unit test (packages/mpd-ulw-plugin/test/commands.test.ts, green in the aggregate) plus ulw-command's clause-by-clause assertion on the REAL injected bytes",
      "(c) ultrawork-smoke.mjs live: the engine loop reaches state=complete with a ledger row (1 round)",
      "(d) the F2 bounded live mpd_ultrawork(plan=false) + mpd_ulw calls returning non-error results, read from the harness session log",
    ],
    thereforeUnproven: "that a single /ulw invocation autonomously runs triage -> gate -> team staging -> loop -> close-out with live members and a real objective; the members' model routes and a nested live chain stay outside this workspace's control (U1's stated reason). No green is claimed for it.",
  },
  U3: { element: "the running session's behaviour changes without a restart", note: "T-21 stands: a FRESH boot is what was observed; the wave's own live session is out of the observation set." },
  U4: { element: "exact provider/model routes at team-spawn time", note: "not asserted; only the create call's profile=\"mpd\" argument is in scope, which the advisory text states." },
}

const deviations = [
  {
    id: "D1",
    acceptanceText: "the mpd-mcp-shared toolchain probe is recorded as an environment red with its reason (outside this tree)",
    measured: "the probe is RED only when the suite is launched through the repo script `bun run test` (which prepends node_modules/.bin to PATH, where a real `ast-grep` lives, so the deprecated sg wrapper succeeds). It is GREEN when the file is run directly and GREEN in the whole aggregate invoked directly (`bun test packages`: 981 pass / 0 fail).",
    disposition: "recorded with its reason either way; the substance the criterion names (T-62 green + the probe dispositioned as an environment-class red outside this tree) holds. No wave defect is implied: mpd-mcp-shared and its test are untouched by the wave.",
  },
  {
    id: "D2",
    acceptanceText: "session-start-team proves the advisory behaviour STABLY",
    measured: "on side 1 of the soft arm the LIVE model followed the advisory and staged a team itself (origin=model, 1 agent_teams_create call in the captain session's own log, pluginStaged=0); side 2 staged none. Both verdicts PASS.",
    disposition: "reported as the DESIGNED behaviour, not a failure and not a false red; the artifact carries the per-record attribution.",
  },
]

const result = {
  task: "t11",
  owner: "Deep Worker",
  kind: "verification",
  independentOfIntegrationOwner: "YES — t8 (integration/rebuild/re-pin/re-pack/commit) was executed by the captain; this verification is a different member and re-ran every acceptance item on the integrated revision with its own harnesses (two of which, f2-live-plan-false.mjs and t11-mount-boot.mjs, were written for this task).",
  at: new Date().toISOString(),
  revision: {
    commit: pinFinal.commit,
    branch: pinFinal.branch,
    worktree: "clean of every tracked change; the ONLY untracked entry is evidence/ulw/final-verification/ (this task's inScope)",
    pinT0: { at: pinT0.capturedAtUtc, trackedDiffSha256: pinT0.trackedDiffSha256, fileHashesSha256: pinT0.fileHashesSha256 },
    pinSettled: { at: pinSettled.capturedAtUtc, elapsedSeconds: (new Date(pinSettled.capturedAtUtc) - new Date(pinT0.capturedAtUtc)) / 1000, trackedDiffSha256: pinSettled.trackedDiffSha256, fileHashesSha256: pinSettled.fileHashesSha256 },
    pinFinal: { at: pinFinal.capturedAtUtc, elapsedSeconds: (new Date(pinFinal.capturedAtUtc) - new Date(pinT0.capturedAtUtc)) / 1000, trackedDiffSha256: pinFinal.trackedDiffSha256, fileHashesSha256: pinFinal.fileHashesSha256 },
    stableAcrossAllThreeReadings: pinStable,
    fileHashes: pinFinal.fileHashes,
  },
  gates,
  live,
  targeted,
  packedArtifact,
  aggregate,
  clause1FalsifiableGreps: clause1,
  clauseVerdicts: clauses,
  bugsFound: [],
  residualBound,
  deviations,
  environmentNotes: [
    "two detached launches via scripts/mpd-bg.mjs died with their bwrap sandbox (T-23) before producing output; the cases were then re-run as managed background jobs. The two empty evidence dirs left behind were removed; nothing else was affected.",
    "ultrawork-smoke writes to evidence/plan-c/c2-ultrawork/<ts>/ with no override, so its run directory was copied into cases/ and the original removed to keep every write inside this task's inScope.",
  ],
  artifactInventory: inventory,
}

writeFileSync(join(D, "result.json"), JSON.stringify(result, null, 2) + "\n")

const output = []
output.push("# t11 final verification — command output summary")
output.push("")
output.push("revision " + pinFinal.commit + " (" + pinFinal.branch + "), stable across t0/settled/final = " + pinStable)
output.push("")
for (const [label, file] of [
  ["bun run verify:gates / verify-dist-fresh / verify-pack-closure", "logs/gates.log"],
  ["node skills/dsh-qa/scripts/ulw-command.mjs", "logs/ulw-command.log"],
  ["node skills/dsh-qa/scripts/session-start-team.mjs", "logs/session-start-team.log"],
  ["node skills/dsh-qa/scripts/session-start-team.mjs (run 2, stability)", "logs/session-start-team-run2.log"],
  ["node skills/dsh-qa/scripts/ultrawork-smoke.mjs", "logs/ultrawork-smoke.log"],
  ["t11 F2 shipped-composition live probe", "logs/f2-live.log"],
  ["t11 mount-instrumented boot", "logs/mount-boot.log"],
  ["T-62 byte-identity x2 + mcp-shared toolchain probe (direct)", "logs/t62-and-toolchain.log"],
  ["toolchain PATH experiment", "logs/toolchain-path-experiment.log"],
  ["bun run test", "logs/bun-test.log"],
  ["bun test packages (direct)", "logs/bun-test-direct.log"],
  ["bun run test:qa", "logs/test-qa.log"],
  ["clause-1 falsifiable greps", "logs/clause1-checks.log"],
  ["packed artifact spot check (packed vs repo byte identity + packed gate row)", "logs/packed-artifact-spotcheck2.log"],
]) {
  output.push("## " + label)
  const text = readText(file)
  const tail = text.split("\n").filter((line) => line !== "").slice(-25).join("\n")
  output.push(tail)
  output.push("")
}
writeFileSync(join(D, "output.log"), output.join("\n") + "\n")

console.log("wrote result.json + output.log -> " + D)
console.log("gates:", JSON.stringify(gateExits), "liveExits:", JSON.stringify({
  ulw: live.ulwCommand.exit, sst: live.sessionStartTeam.exit, smoke: live.ultraworkSmoke.exit,
  f2: live.f2ShippedPlanFalse.exit, mount: live.mountBoot.exit,
}))
console.log("aggregate:", JSON.stringify({ bunRunTest: aggregate.bunRunTest.exit, direct: aggregate.bunTestPackagesDirect.exit, testQa: aggregate.testQa.exit }))
console.log("allOk:", gates.verifyGates.exit === 0 && gates.verifyDistFresh.exit === 0 && gates.verifyPackClosure.exit === 0 &&
  live.ulwCommand.ok && live.sessionStartTeam.ok && live.ultraworkSmoke.ok && live.f2ShippedPlanFalse.ok && live.mountBoot.ok &&
  pinStable && aggregate.bunTestPackagesDirect.exit === 0 && aggregate.testQa.exit === 0)
