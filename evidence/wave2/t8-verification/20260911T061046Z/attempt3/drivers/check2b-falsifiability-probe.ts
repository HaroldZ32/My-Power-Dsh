#!/usr/bin/env node
// t8 verification driver 2b (attempt 3) — F1 falsifiability / over-carve probe.
//
// The carve-out must drop ONLY the prohibitions a finding's file requires. This drives the real
// archived wave-1 inputs (team mpd-default-7332aba4, source t7 + review t10) through the current
// repair scope generator and classifies:
//   * every finding file          -> must be in_scope
//   * the captain-named prohibitions (`VENDOR_LOCK.json`, `presets/mpd/agent.cordis.yml`) and the
//     rest of the source outOfScope -> must stay out_of_scope
//   * no contradiction in the generated scope
// Read-only: imports the module and reads the archived team record.
//
// Usage: node check2b-falsifiability-probe.mjs <lib-dir>
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = process.cwd()
const libDir = process.argv[2]
if (!libDir) {
    console.error("usage: check2b-falsifiability-probe.mjs <lib-dir>")
    process.exit(2)
}
const mod = await import(pathToFileURL(join(libDir, "quality-gates.js")).href)
const { classifyChangedPath, contractContradiction, repairScopeFromFindings } = mod

const archive = JSON.parse(readFileSync(join(repoRoot, ".mpd/team/archive/mpd-default-7332aba4/team.json"), "utf8"))
const source = archive.tasks.find((item) => item.id === "t7")
const review = archive.tasks.find((item) => item.id === "t10")
const scope = repairScopeFromFindings(review.findings, source)

const requiredFiles = [...new Set((review.findings ?? []).map((finding) => finding.file).filter((file) => typeof file === "string" && file.trim() !== ""))]
const probePaths = [
    "VENDOR_LOCK.json",
    "presets/mpd/agent.cordis.yml",
    "presets/mpd/agent.cordis.yml.bak",
    "README.md",
    "README.zh-CN.md",
    "packages/mpd-bundle/cordis.patch.yml",
    "AGENTS.md",
]
const out = {
    driver: "check2b-falsifiability-probe",
    libDir,
    generated: { inScope: scope.inScope, outOfScope: scope.outOfScope ?? [] },
    requiredFiles: requiredFiles.map((file) => ({ file, classification: classifyChangedPath(file, scope.inScope, scope.outOfScope) })),
    probes: probePaths.map((path) => ({ path, classification: classifyChangedPath(path, scope.inScope, scope.outOfScope) })),
    contradiction: contractContradiction(scope.inScope, scope.outOfScope) ?? null,
}
const requiredOk = out.requiredFiles.every((row) => row.classification === "in_scope")
const prohibitedOk = out.probes.filter((row) => row.path !== "AGENTS.md").every((row) => row.classification === "out_of_scope")
const requiredAdmitted = out.probes.find((row) => row.path === "AGENTS.md")?.classification === "in_scope"
out.passed = requiredOk && prohibitedOk && requiredAdmitted && out.contradiction === null
console.log(JSON.stringify(out, null, 2))
