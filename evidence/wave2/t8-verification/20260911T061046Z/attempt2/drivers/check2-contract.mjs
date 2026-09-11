#!/usr/bin/env node
// t8 verification driver 2/4 — self-contradicting contract generation, PRE-FIX vs POST-FIX.
//
// Three measurements per version:
//   R. REPLAY: the REAL wave-1 inputs (archived team mpd-default-7332aba4: source t7 + review t10)
//      pushed through the version's own planQualityFollowUp, compared with the repair contract the
//      pre-fix code actually produced at the time (task t13).
//   V. CREATE GATE: validateCreateTask on a genuinely contradictory declaration.
//   P. PROPERTY SWEEP: over a matrix of (source inScope, source outOfScope, finding files), count how
//      many generated scopes admit a path that their own outOfScope forbids.
// Read-only: imports the module and reads the archived team record.
//
// Usage: node check2-contract.mjs <lib-dir>
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = process.cwd()
const libDir = process.argv[2]
if (!libDir) {
    console.error("usage: check2-contract.mjs <lib-dir>")
    process.exit(2)
}
const source = readFileSync(join(libDir, "quality-gates.js"), "utf8")
const mod = await import(pathToFileURL(join(libDir, "quality-gates.js")).href)
const { pathMatchesScope, classifyChangedPath, validateCreateTask, planQualityFollowUp } = mod
const postFix = typeof mod.contractContradiction === "function"
const contradictionOf = (inScope, outOfScope) => {
    if (postFix)
        return mod.contractContradiction(inScope, outOfScope)
    for (const allowed of inScope ?? [])
        for (const forbidden of outOfScope ?? [])
            if (pathMatchesScope(allowed, forbidden))
                return { inScope: allowed, outOfScope: forbidden }
    for (const forbidden of outOfScope ?? [])
        if (["**", "**/", ".", "./", "/"].includes(String(forbidden).trim()))
            return { inScope: (inScope ?? [])[0] ?? "", outOfScope: forbidden }
    return undefined
}

const out = {
    driver: "check2-contract",
    libDir,
    version: postFix ? "post-fix (mpd-delta contract-contradiction present)" : "pre-fix (no mpd-delta contract-contradiction)",
    replay: {},
    createGate: {},
    propertySweep: {},
    notes: [],
}

// ---------- R. REAL wave-1 replay ----------
const archive = JSON.parse(readFileSync(join(repoRoot, ".mpd/team/archive/mpd-default-7332aba4/team.json"), "utf8"))
const review = archive.tasks.find((item) => item.id === "t10")
const recordedRepair = archive.tasks.find((item) => item.id === "t13")
const keepIds = new Set(["t1", "t2", "t3", "t4", "t5", "t6", "t7", "t8", "t9", "t10"])
const replayTeam = { ...archive, tasks: archive.tasks.filter((item) => keepIds.has(item.id)) }
const planned = planQualityFollowUp(replayTeam, review)
const generated = (planned.created ?? []).find((item) => item.kind === "repair")
out.replay = {
    inputs: {
        sourceTaskId: "t7",
        reviewTaskId: "t10",
        sourceInScope: review.reviewedTaskId === "t7" ? replayTeam.tasks.find((item) => item.id === "t7").inScope : null,
        sourceOutOfScope: replayTeam.tasks.find((item) => item.id === "t7").outOfScope,
        findingFiles: (review.findings ?? []).map((finding) => ({ id: finding.id, file: finding.file })),
    },
    generated: generated === undefined ? null : { id: generated.id, inScope: generated.inScope, outOfScope: generated.outOfScope },
    recordedPreFixRepair: recordedRepair === undefined ? null : { id: recordedRepair.id, inScope: recordedRepair.inScope, outOfScope: recordedRepair.outOfScope, changedPaths: recordedRepair.changedPaths },
    generatedMatchesRecordedPreFix: recordedRepair !== undefined && generated !== undefined
        ? JSON.stringify(generated.inScope) === JSON.stringify(recordedRepair.inScope) && JSON.stringify(generated.outOfScope) === JSON.stringify(recordedRepair.outOfScope)
        : false,
    contradictionInGeneratedScope: generated === undefined ? null : contradictionOf(generated.inScope, generated.outOfScope) ?? null,
    agentsMdClassificationUnderGeneratedScope: generated === undefined
        ? null
        : classifyChangedPath("AGENTS.md", generated.inScope, generated.outOfScope),
    // The outcome that punished wave 1: a finding whose own requiredFix the repair's acceptance
    // carries, sitting on a file the generated scope still refuses to classify in_scope.
    demandedButNotInScope: generated === undefined
        ? null
        : (review.findings ?? [])
            .filter((finding) => typeof finding.file === "string" && finding.file.trim() !== "")
            .map((finding) => ({
                id: finding.id,
                file: finding.file,
                requiredFixInAcceptance: (generated.acceptance ?? []).includes(finding.requiredFix),
                classification: classifyChangedPath(finding.file, generated.inScope, generated.outOfScope),
            }))
            .filter((row) => row.classification !== "in_scope"),
    // F1 falsifiability, second half: the carve-out must take ONLY what a finding requires.
    // A prohibition no finding's file matches must survive the generated scope untouched.
    requiredFilesInScope: generated === undefined
        ? null
        : (review.findings ?? [])
            .map((finding) => finding.file)
            .filter((file) => typeof file === "string" && file.trim() !== "")
            .filter((file, index, all) => all.indexOf(file) === index)
            .map((file) => ({ file, classification: classifyChangedPath(file, generated.inScope, generated.outOfScope) })),
    preservedProhibitions: generated === undefined
        ? null
        : (replayTeam.tasks.find((item) => item.id === "t7").outOfScope ?? []).map((pattern) => ({
            pattern,
            coversRequiredFile: (review.findings ?? [])
                .map((finding) => finding.file)
                .filter((file) => typeof file === "string" && file.trim() !== "")
                .some((file) => pathMatchesScope(file, pattern)),
            stillForbidden: (generated.outOfScope ?? []).includes(pattern),
        })),
    generatedAcceptance: generated === undefined ? null : (generated.acceptance ?? []),
}
out.notes.push("demandedButNotInScope non-empty means the generated repair REQUIRES an edit its own scope still classifies out_of_scope")
out.notes.push("preservedProhibitions: every pattern with coversRequiredFile=false MUST stay stillForbidden=true (no over-carve); a pattern covering a required file MUST be dropped")

// ---------- V. create-time gate on a contradictory declaration ----------
const team = { halted: false, phase: "running", tasks: [], members: [], reviewPolicy: archive.reviewPolicy }
const input = (inScope, outOfScope) => ({
    subject: "contract probe",
    kind: "implementation",
    objective: "prove the contract is satisfiable",
    inScope,
    outOfScope,
    acceptance: ["done"],
    verify: ["true"],
})
const contradictory = validateCreateTask(team, input(["AGENTS.md"], ["AGENTS.md"]))
const carveOut = validateCreateTask(team, input(["packages/foo"], ["packages/foo/vendor"]))
const universal = validateCreateTask(team, input(["packages/foo/**"], ["**"]))
out.createGate = {
    "validateCreateTask(inScope=['AGENTS.md'], outOfScope=['AGENTS.md'])": { ok: contradictory.ok, error: contradictory.error ?? null },
    "classifyChangedPath('AGENTS.md', ['AGENTS.md'], ['AGENTS.md'])": classifyChangedPath("AGENTS.md", ["AGENTS.md"], ["AGENTS.md"]),
    "validateCreateTask(inScope=['packages/foo'], outOfScope=['packages/foo/vendor']) (carve-out must stay legal)": { ok: carveOut.ok, error: carveOut.error ?? null },
    "validateCreateTask(inScope=['packages/foo/**'], outOfScope=['**']) (universal must be refused)": { ok: universal.ok, error: universal.error ?? null },
}

// ---------- P. property sweep ----------
const inScopeChoices = [["packages/foo"], ["packages/foo/src"], ["packages/foo/**"]]
const outOfScopeChoices = [[], ["AGENTS.md"], ["packages/foo/vendor"], ["packages/foo"], ["**"]]
const findingFiles = ["AGENTS.md", "packages/foo/vendor/x.ts", "packages/foo/test/a.ts", "docs/new.md"]
let combinations = 0
let contradictions = 0
const samples = []
for (const inScope of inScopeChoices) {
    for (const outOfScope of outOfScopeChoices) {
        for (const file of findingFiles) {
            combinations += 1
            const findings = [{ id: "F-probe", file }]
            const scope = postFix
                ? mod.repairScopeFromFindings(findings, { inScope, outOfScope })
                : { inScope: [file], outOfScope }
            if (scope === undefined)
                continue
            const hit = contradictionOf(scope.inScope, scope.outOfScope)
            if (hit !== undefined) {
                contradictions += 1
                if (samples.length < 6)
                    samples.push({ source: { inScope, outOfScope }, file, scope, hit, classification: classifyChangedPath(file, scope.inScope, scope.outOfScope) })
            }
        }
    }
}
out.propertySweep = { combinations, contradictoryScopes: contradictions, samples }

console.log(JSON.stringify(out, null, 2))
