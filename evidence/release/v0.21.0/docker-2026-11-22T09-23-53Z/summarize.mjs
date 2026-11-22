// LANE T5 summarizer: reads only the collected run directories, their copied result.json bodies,
// the per-run tree anchors and env.json, then writes summary.json + report.md beside them.
// It never reads the credential and never re-runs anything.
import fs from "node:fs"
import path from "node:path"

const DIR = process.argv[2]
const RUNS = [
  { run: 1, slug: "source-live", args: "--mode source --require-docker --live" },
  { run: 2, slug: "oneclick-live", args: "--mode oneclick --require-docker --live" },
  { run: 3, slug: "source-nobrowser", args: "--mode source --require-docker --no-browser" },
]
const EXPECTED_HARNESS = "0.2.2-rc.5"
const EXPECTED_TUI = "0.20.2"
const env = JSON.parse(fs.readFileSync(path.join(DIR, "env.json"), "utf8"))
const readJson = (p) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : null)
const readText = (p) => (fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "")

/** Parse one anchor file into its scalar fields and its tracked-path list. */
const parseAnchor = (p) => {
  const text = readText(p)
  const scalar = (key) => (text.match(new RegExp("^" + key + "=(.*)$", "m")) || [null, null])[1]
  const paths = text.split("\n").filter((l) => /^ [MADRCU?!]{1,2} /.test(l)).map((l) => l.slice(3).trim())
  return { utc: scalar("utc"), head: scalar("head"), headFull: scalar("headFull"), branch: scalar("branch"), diffSha: scalar("diffSha"), trackedChangedCount: Number(scalar("trackedChangedCount") ?? 0), paths }
}

/** Symmetric difference of two path lists, preserving the order each side supplied. */
const pathDelta = (a, b) => ({
  added: b.filter((p) => !a.includes(p)),
  removed: a.filter((p) => !b.includes(p)),
})

/** Verdict rows the lane must prove, named explicitly so the report cannot omit one. */
const REQUIRED_INSTALL = ["install.exit", "install.profileDep", "install.installedTree", "install.buildScripts"]
const REQUIRED_MOUNT = [
  "compose.mpdRows",
  "compose.presetRow",
  "boot.mpdTools",
  "boot.presetMount",
  "boot.sessionGateListener",
  "boot.servesHttp",
  "boot.agentTeamTools",
  "tui.hostInstall",
  "tui.boot",
  "tui.presetPreference",
  "tui.presetRow",
  "tui.sessionPreset",
]

const runs = []
const hashMaps = {}
const tree = []
for (const spec of RUNS) {
  const dir = path.join(DIR, `run-${spec.run}-${spec.slug}`)
  const meta = readJson(path.join(dir, "meta.json"))
  const result = readJson(path.join(dir, "result.json"))
  const before = parseAnchor(path.join(dir, "anchor-before.txt"))
  const after = parseAnchor(path.join(dir, "anchor-after.txt"))
  const delta = pathDelta(before.paths, after.paths)
  tree.push({
    run: spec.run,
    slug: spec.slug,
    before: { utc: before.utc, head: before.head, diffSha: before.diffSha, trackedChangedCount: before.trackedChangedCount },
    after: { utc: after.utc, head: after.head, diffSha: after.diffSha, trackedChangedCount: after.trackedChangedCount },
    movedDuringRun: before.diffSha !== after.diffSha || delta.added.length > 0 || delta.removed.length > 0,
    addedPaths: delta.added,
    removedPaths: delta.removed,
  })
  if (meta === null) {
    runs.push({ run: spec.run, slug: spec.slug, args: spec.args, status: "NOT RUN (no meta.json)" })
    continue
  }
  const assertions = result?.assertions ?? []
  const byName = new Map(assertions.map((a) => [a.name, a]))
  const rows = (names) => names.map((name) => {
    const a = byName.get(name)
    return { name, ok: a === undefined ? null : a.ok, reason: a?.reason ?? "row absent", raw: a?.raw ?? "" }
  })
  const us = meta.userSurface ?? null
  const installProof = rows(REQUIRED_INSTALL)
  const mountProof = rows(REQUIRED_MOUNT)
  const stamps = {
    harnessInstalled: meta.harnessVersion,
    harnessExpected: meta.harnessExpected,
    tuiInstalled: meta.tuiVersion,
    pins: meta.pins,
  }
  const stampOk = meta.harnessVersion === EXPECTED_HARNESS && meta.tuiVersion === EXPECTED_TUI
  const installOk = installProof.every((r) => r.ok === true)
  const mountOk = mountProof.every((r) => r.ok === true)
  const userSurfaceOk = us !== null
    && us.probe?.ok === true
    && us.rowsEnumerated?.ok === true
    && us.rowsWitness?.ok === true
    && (us.rowNullUnexcused ?? []).length === 0
    && us.trueCount > 0
  const requiredProofOk = installOk && mountOk && userSurfaceOk && stampOk
  if (Array.isArray(result?.hashes)) hashMaps[`run-${spec.run}-${spec.slug}`] = new Map(result.hashes.map((h) => [h.path, h.sha256]))
  runs.push({
    run: spec.run,
    slug: spec.slug,
    args: spec.args,
    exitCode: meta.exitCode,
    dockerMode: meta.dockerMode,
    skipped: meta.skipped,
    evidenceDir: meta.evidenceDir,
    printedEvidencePath: meta.printedEvidencePath,
    ok: meta.ok ?? null,
    complete: meta.complete ?? null,
    assertions: meta.summary ?? null,
    stamps,
    requiredProof: { installOk, mountOk, userSurfaceOk, stampOk, all: requiredProofOk },
    install: installProof,
    mount: mountProof,
    userSurface: us,
    oneclick: meta.proof?.oneclick ?? [],
    pack: meta.proof?.pack ?? [],
    live: meta.proof?.live ?? [],
    failures: meta.failures ?? [],
    unmeasured: meta.unmeasured ?? [],
    missing: meta.missing ?? [],
    durationMinutes: meta.durationMinutes ?? null,
    imageMiB: meta.imageMiB ?? null,
  })
}

/** Cross-run artifact hash identity: one commit under test despite a shared, moving checkout. */
const hashRuns = Object.keys(hashMaps)
const identity = { runsCompared: hashRuns, entryCount: hashMaps[hashRuns[0]]?.size ?? 0, identical: hashRuns.length > 0, differingPaths: [] }
for (const run of hashRuns.slice(1)) {
  for (const [p, sha] of hashMaps[hashRuns[0]]) {
    if (hashMaps[run].get(p) !== sha && !identity.differingPaths.includes(p)) identity.differingPaths.push(p)
  }
  for (const p of hashMaps[run].keys()) if (!hashMaps[hashRuns[0]].has(p) && !identity.differingPaths.includes(p)) identity.differingPaths.push(p)
}
identity.identical = hashRuns.length > 0 && identity.differingPaths.length === 0

const startAnchor = tree[0]?.before ?? null
const endAnchor = parseAnchor(path.join(DIR, "anchor-final.txt"))
const overallDelta = pathDelta(parseAnchor(path.join(DIR, "run-1-source-live", "anchor-before.txt")).paths, endAnchor.paths)
const treeMovement = {
  start: startAnchor,
  end: { utc: endAnchor.utc, head: endAnchor.head, diffSha: endAnchor.diffSha, trackedChangedCount: endAnchor.trackedChangedCount },
  moved: startAnchor !== null && (startAnchor.diffSha !== endAnchor.diffSha || overallDelta.added.length > 0 || overallDelta.removed.length > 0),
  addedPaths: overallDelta.added,
  removedPaths: overallDelta.removed,
  perRun: tree,
  note: "Each run's `COPY . /src/` freezes the build context at BUILD time, so a mid-run edit after that freeze does not change what the container installed; the per-run anchors record when the shared checkout moved.",
}

const requiredRuns = runs.filter((r) => r.status !== "NOT RUN (no meta.json)")
const laneRed = requiredRuns.filter((r) => r.exitCode !== 0)
const proofRed = requiredRuns.filter((r) => !(r.requiredProof?.all === true))
const skipped = requiredRuns.filter((r) => r.skipped === true)
const missingRuns = runs.filter((r) => r.status === "NOT RUN (no meta.json)")
const verdict = laneRed.length === 0 && proofRed.length === 0 && skipped.length === 0 && missingRuns.length === 0 ? "PASS" : "FAIL"
const reasons = []
if (missingRuns.length > 0) reasons.push(`${missingRuns.length} run(s) produced no meta.json`)
if (skipped.length > 0) reasons.push(`${skipped.length} run(s) printed [driver] SKIP (a skip is never a pass)`)
for (const r of laneRed) reasons.push(`run ${r.run} (${r.slug}) exited ${r.exitCode}${r.failures.length > 0 ? ` — failing facts: ${r.failures.map((f) => f.name).join(",")}` : ""}`)
for (const r of proofRed) {
  const gaps = []
  if (!r.requiredProof?.installOk) gaps.push("install rows")
  if (!r.requiredProof?.mountOk) gaps.push("mount rows")
  if (!r.requiredProof?.userSurfaceOk) gaps.push("userSurface arm")
  if (!r.requiredProof?.stampOk) gaps.push(`stamps harness=${r.stamps?.harnessInstalled ?? "<none>"} tui=${r.stamps?.tuiInstalled ?? "<none>"}`)
  reasons.push(`run ${r.run} (${r.slug}) required proof gap: ${gaps.join(", ")}`)
}
const summary = {
  lane: "LANE T5 — Docker real-machine lane",
  release: "v0.21.0",
  generatedAt: new Date().toISOString(),
  verdict,
  verdictReasons: reasons,
  expected: { harness: EXPECTED_HARNESS, tui: EXPECTED_TUI },
  branch: env.branch,
  startAnchor: startAnchor === null ? null : { ...startAnchor, probe: env.probeAnchor },
  endAnchor: treeMovement.end,
  commitsDuringLane: env.commitsDuringLane ?? [],
  treeDifference: env.treeDifference ?? null,
  treeMovement,
  docker: {
    client: env.dockerClient,
    server: env.dockerServer,
    compose: env.compose,
    rootless: env.rootless,
    securityOptions: env.rootlessSecurityOptions,
    xdgRuntimeDir: env.xdgRuntimeDir,
  },
  keySource: env.keySource,
  runs,
  artifactHashIdentity: identity,
  userSurfaceArm: {
    requiredInEveryMode: true,
    ranInEveryRun: requiredRuns.length > 0 && requiredRuns.every((r) => r.userSurface?.trueCount > 0),
    perRun: requiredRuns.map((r) => ({ run: r.run, total: r.userSurface?.total ?? null, trueCount: r.userSurface?.trueCount ?? null, rowCount: r.userSurface?.rowCount ?? null, rowNullExcused: r.userSurface?.rowNullExcused ?? null, rowNullUnexcused: r.userSurface?.rowNullUnexcused ?? null, boundTrueCount: r.userSurface?.boundTrueCount ?? null, rowsWitness: r.userSurface?.rowsWitness ?? null })),
  },
  bounds: [
    "A run that cannot find a rootless daemon SKIPS, and a SKIP is never a pass; --require-docker turns it into exit 3.",
    "The live/browser arms are model-driven and depend on the operator's credential; a credential-free run cannot see a path that depends on an EMPTY model catalog.",
    "Declared bounds (`userSurface.bound.<id>`) are composed-but-not-individually-proven rows, not passes.",
    "The driver's own evidence lands under evidence/docker/<slug>/<stamp>/ per its contract; this lane copies the verdicts and metadata into this release directory.",
  ],
}
fs.writeFileSync(path.join(DIR, "summary.json"), JSON.stringify(summary, null, 2) + "\n")

const fmt = (v) => (v === null || v === undefined ? "<none>" : String(v))
const md = []
md.push(`# Docker real-machine lane — my-power-dsh v0.21.0`)
md.push("")
md.push(`- Verdict: **${verdict}**${reasons.length > 0 ? ` — ${reasons.join("; ")}` : " — every run exited 0 and every required proof row is TRUE"}`)
md.push(`- Branch: \`${env.branch}\` @ \`${env.headShort}\` (package \`${env.pkgVersion}\`)`)
md.push(`- Start anchor: HEAD \`${fmt(startAnchor?.head)}\`, \`git diff | sha256sum\` = \`${fmt(startAnchor?.diffSha)}\`, tracked changed files \`${fmt(startAnchor?.trackedChangedCount)}\``)
md.push(`- End anchor: HEAD \`${fmt(endAnchor.head)}\`, \`git diff | sha256sum\` = \`${fmt(endAnchor.diffSha)}\`, tracked changed files \`${fmt(endAnchor.trackedChangedCount)}\``)
md.push(`- Docker: client ${env.dockerClient}, server ${env.dockerServer}, compose ${env.compose}; ROOTLESS (${env.rootlessSecurityOptions})`)
md.push(`- \`XDG_RUNTIME_DIR\`: \`${env.xdgRuntimeDir}\``)
md.push(`- DeepSeek key: ${env.keySource}`)
md.push("")
md.push("| # | mode / flags | exit | evidence path | passed | failed | null | harness stamp | TUI stamp | userSurface true/null | failing facts |")
md.push("|---|---|---|---|---|---|---|---|---|---|---|")
for (const r of runs) {
  if (r.status) { md.push(`| ${r.run} | \`${r.args}\` | NOT RUN | — | — | — | — | — | — | — | — |`); continue }
  md.push(`| ${r.run} | \`${r.args}\` | ${r.exitCode} | \`${r.evidenceDir}\` | ${r.assertions?.passed ?? "?"} | ${r.assertions?.failed ?? "?"} | ${r.assertions?.null ?? "?"} | ${fmt(r.stamps.harnessInstalled)} | ${fmt(r.stamps.tuiInstalled)} | ${r.userSurface?.trueCount ?? "?"}/${r.userSurface?.nullCount ?? "?"} | ${r.failures.length === 0 ? "none" : r.failures.map((f) => `\`${f.name}\``).join(", ")} |`)
}
md.push("")
md.push("## Stamps, verbatim")
for (const r of runs) {
  if (r.status) continue
  md.push(`- run ${r.run} (${r.slug}): harness \`${fmt(r.stamps.harnessInstalled)}\` (expected \`${fmt(r.stamps.harnessExpected)}\`), TUI \`version=${fmt(r.stamps.tuiInstalled)}\`; \`facts.pins\` = \`${fmt(r.stamps.pins)}\``)
}
md.push("")
md.push("## Required proof per run")
for (const r of runs) {
  if (r.status) continue
  md.push(`### run ${r.run} — ${r.slug}`)
  md.push("")
  md.push("| group | name | verdict | raw |")
  md.push("|---|---|---|---|")
  for (const row of [...r.install, ...r.mount]) md.push(`| ${row.name.startsWith("install.") ? "INSTALL" : "MOUNT"} | \`${row.name}\` | ${row.ok === true ? "TRUE" : row.ok === false ? "**FALSE**" : "NULL"} | \`${String(row.raw).replaceAll("|", "\\|")}\` |`)
  md.push(`| userSurface | \`userSurface.rowsEnumerated\` | ${r.userSurface?.rowsEnumerated?.ok === true ? "TRUE" : "**NOT TRUE**"} | \`${String(r.userSurface?.rowsEnumerated?.raw ?? "").replaceAll("|", "\\|")}\` |`)
  md.push(`| userSurface | \`userSurface.rowsWitness\` | ${r.userSurface?.rowsWitness?.ok === true ? "TRUE" : "**NOT TRUE**"} | \`${String(r.userSurface?.rowsWitness?.raw ?? "").replaceAll("|", "\\|")}\` |`)
  md.push(`| userSurface | \`userSurface.probe\` | ${r.userSurface?.probe?.ok === true ? "TRUE" : "**NOT TRUE**"} | \`${String(r.userSurface?.probe?.raw ?? "").replaceAll("|", "\\|")}\` |`)
  md.push(`| userSurface | declared-bound markers | ${r.userSurface?.boundTrueCount ?? 0} TRUE | rows ${r.userSurface?.rowCount ?? "?"}, row-nulls excused ${r.userSurface?.rowNullExcused ?? "?"}, unexcused ${JSON.stringify(r.userSurface?.rowNullUnexcused ?? [])} |`)
  md.push("")
  if (r.oneclick.some((x) => x.ok !== null)) {
    md.push("oneclick rows: " + r.oneclick.map((x) => `\`${x.name}\`=${x.ok}`).join(", "))
    md.push("")
  }
  if (r.pack.some((x) => x.ok !== null)) {
    md.push("pack rows: " + r.pack.map((x) => `\`${x.name}\`=${x.ok}`).join(", "))
    md.push("")
  }
}
md.push("## SKIP accounting")
md.push("")
md.push(`\`--require-docker\` was passed on every run; a skip would have exited 3. Runs that printed \`[driver] SKIP\`: ${skipped.length === 0 ? "none" : skipped.map((r) => r.run).join(", ")}.`)
md.push("")
md.push("## Commits during the lane")
md.push("")
if ((env.commitsDuringLane ?? []).length === 0) md.push("- none")
for (const c of env.commitsDuringLane ?? []) md.push(`- \`${c.sha}\` at ${c.at}: ${c.subject}`)
md.push("")
if (env.treeDifference !== null && env.treeDifference !== undefined) {
  md.push("### What the tree move means for the artifact")
  md.push("")
  md.push(`- run 1 build tree: ${env.treeDifference.run1BuildTree}`)
  md.push(`- run 2/3 build tree: ${env.treeDifference.run2BuildTree}`)
  md.push(`- substantive delta: ${env.treeDifference.substantiveDelta.join("; ")}`)
  md.push(`- no other delta: ${env.treeDifference.noOtherDelta}`)
  md.push(`- artifact identity: ${env.treeDifference.artifactIdentity}`)
  md.push("")
}
md.push("## Tree movement")
md.push("")
md.push(`- moved (start vs end): ${treeMovement.moved ? "**YES**" : "no"}; added paths: ${treeMovement.addedPaths.length === 0 ? "none" : treeMovement.addedPaths.map((p) => `\`${p}\``).join(", ")}; removed paths: ${treeMovement.removedPaths.length === 0 ? "none" : treeMovement.removedPaths.map((p) => `\`${p}\``).join(", ")}`)
for (const t of tree) md.push(`- run ${t.run}: before diffSha \`${fmt(t.before.diffSha)}\` (${fmt(t.before.trackedChangedCount)} files), after diffSha \`${fmt(t.after.diffSha)}\` (${fmt(t.after.trackedChangedCount)} files), moved during run: ${t.movedDuringRun ? "YES" : "no"}${t.addedPaths.length || t.removedPaths.length ? `; added ${JSON.stringify(t.addedPaths)} removed ${JSON.stringify(t.removedPaths)}` : ""}`)
md.push(`- ${treeMovement.note}`)
md.push("")
md.push(`- Artifact hash identity: ${identity.identical ? "identical" : "**NOT identical**"}; ${identity.entryCount} recorded files compared across ${identity.runsCompared.length} runs${identity.differingPaths.length > 0 ? `; differing: ${identity.differingPaths.map((p) => `\`${p}\``).join(", ")}` : ""}.`)
md.push("")
md.push("## Failing facts, verbatim")
const anyFailure = runs.some((r) => (r.failures ?? []).length > 0)
if (!anyFailure) md.push("- none")
for (const r of runs) {
  for (const f of r.failures ?? []) md.push(`- run ${r.run} (${r.slug}): \`${f.name}\` — ${f.reason} | raw: \`${f.raw}\``)
}
md.push("")
md.push("## Bounds")
md.push("")
for (const b of summary.bounds) md.push(`- ${b}`)
for (const r of runs) {
  if (r.status) continue
  if ((r.unmeasured ?? []).length > 0) md.push(`- run ${r.run} unmeasured required arms: ${r.unmeasured.map((n) => `\`${n}\``).join(", ")}`)
  if ((r.missing ?? []).length > 0) md.push(`- run ${r.run} missing required rows: ${r.missing.map((n) => `\`${n}\``).join(", ")}`)
  const nulls = (r.assertions?.nullNames ?? [])
  const nonUser = nulls.filter((n) => !n.startsWith("userSurface."))
  md.push(`- run ${r.run} declared NULL rows (${nulls.length} total, ${nonUser.length} outside userSurface): ${nonUser.length === 0 ? "none" : nonUser.map((n) => `\`${n}\``).join(", ")}`)
}
md.push("")
fs.writeFileSync(path.join(DIR, "report.md"), md.join("\n") + "\n")
console.log(`verdict=${verdict} runs=${runs.length} red=${laneRed.length} proofGaps=${proofRed.length}`)
for (const reason of reasons) console.log(`reason: ${reason}`)
