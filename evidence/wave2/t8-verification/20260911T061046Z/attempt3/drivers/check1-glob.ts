#!/usr/bin/env node
// t8 verification driver 1/4 — inScope `**` expansion, PRE-FIX vs POST-FIX.
//
// Drives the REAL exported matcher/completion gate out of a given lib dir:
//   * pre-fix  = the module extracted from `git show HEAD:` into a sandbox tree
//   * post-fix = the working-tree module
// Read-only: imports the module and calls pure functions; writes nothing but stdout.
//
// Usage: node check1-glob.mjs <lib-dir>
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = process.cwd()
const libDir = process.argv[2]
if (!libDir) {
    console.error("usage: check1-glob.mjs <lib-dir>")
    process.exit(2)
}

const source = readFileSync(join(libDir, "quality-gates.js"), "utf8")
const mod = await import(pathToFileURL(join(libDir, "quality-gates.js")).href)
const { pathMatchesScope, classifyChangedPath, evaluateQualityCompletion } = mod

const out = {
    driver: "check1-glob",
    libDir,
    version: /mpd-delta scope-glob/.test(source) ? "post-fix (mpd-delta scope-glob present)" : "pre-fix (no mpd-delta scope-glob)",
    cases: [],
}
const rec = (id, kind, detail, value) => out.cases.push({ id, kind, detail, value })

// ---- A. the exact shape named by the acceptance: `packages/foo/test/**` ----
rec("A1", "pathMatchesScope", "packages/foo/test/a.test.mjs ~ packages/foo/test/**", pathMatchesScope("packages/foo/test/a.test.mjs", "packages/foo/test/**"))
rec("A2", "classifyChangedPath", "packages/foo/test/a.test.mjs with inScope=['packages/foo/test/**']", classifyChangedPath("packages/foo/test/a.test.mjs", ["packages/foo/test/**"], []))
rec("A3", "classifyChangedPath", "packages/foo/test/deep/case.ts with inScope=['packages/foo/test/**']", classifyChangedPath("packages/foo/test/deep/case.ts", ["packages/foo/test/**"], []))

// ---- B. the wave-1 declaration shape ----
rec("B1", "classifyChangedPath", "packages/mpd-verif-plugin/test/case_a.py with inScope=['packages/mpd-verif-plugin/test/**']", classifyChangedPath("packages/mpd-verif-plugin/test/case_a.py", ["packages/mpd-verif-plugin/test/**"], []))

// ---- N. negative controls: must hold in BOTH versions (no over-matching) ----
rec("N1", "pathMatchesScope", "srcx/a.ts ~ src/** (must stay false)", pathMatchesScope("srcx/a.ts", "src/**"))
rec("N2", "pathMatchesScope", "src/a.md ~ **/*.ts (must stay false)", pathMatchesScope("src/a.md", "**/*.ts"))
rec("N3", "pathMatchesScope", "lib/a.js.map ~ lib/a.js (must stay false)", pathMatchesScope("lib/a.js.map", "lib/a.js"))
rec("N4", "classifyChangedPath", "packages/foo/lib/x.ts stays out_of_scope while a glob is declared", classifyChangedPath("packages/foo/lib/x.ts", ["packages/foo/test/**"], ["packages/foo/lib"]))

// ---- C. the completion gate (what actually produced the wave-1 incomplete changedPaths) ----
const task = {
    id: "probe",
    kind: "implementation",
    status: "in_progress",
    inScope: ["packages/foo/test/**"],
    outOfScope: ["packages/foo/lib"],
    acceptance: ["done"],
    verify: ["true"],
}
const payload = (changedPaths) => ({
    status: "completed",
    acceptanceResults: [{ criterion: "done", status: "passed", evidence: "e" }],
    commandsRun: [{ command: "true", status: "passed", exitCode: 0, evidence: "e" }],
    changedPaths,
})
const underGlob = evaluateQualityCompletion(task, payload(["packages/foo/test/deep/a.test.ts"]))
const undeclared = evaluateQualityCompletion(task, payload(["packages/other/a.ts"]))
rec("C1", "evaluateQualityCompletion", "changedPaths=['packages/foo/test/deep/a.test.ts']", { ok: underGlob.ok, error: underGlob.error })
rec("C2", "evaluateQualityCompletion", "changedPaths=['packages/other/a.ts'] (must stay rejected)", { ok: undeclared.ok, error: undeclared.error })

// ---- D. real wave-1 replay: team mpd-default-7332aba4, task t7 (declared packages/*/src/**) ----
const wt = JSON.parse(readFileSync(join(repoRoot, ".mpd/team/archive/mpd-default-7332aba4/team.json"), "utf8"))
const t7 = wt.tasks.find((item) => item.id === "t7")
if (t7 === undefined)
    throw new Error("wave-1 t7 not found in the archived team record")
const declaredGlobs = (t7.inScope ?? []).filter((pattern) => pattern.includes("**"))
const srcFiles = ["packages/mpd-boulder-plugin/src/index.ts", "packages/mpd-memory-plugin/src/index.ts"]
const realChanged = [...(t7.changedPaths ?? [])]
const t7task = { id: "t7", kind: "implementation", status: "in_progress", inScope: t7.inScope, outOfScope: t7.outOfScope, acceptance: t7.acceptance, verify: t7.verify }
const t7payload = (changedPaths) => ({
    status: "completed",
    acceptanceResults: (t7.acceptance ?? []).map((criterion) => ({ criterion, status: "passed", evidence: "replay" })),
    commandsRun: (t7.verify ?? []).map((command) => ({ command, status: "passed", exitCode: 0, evidence: "replay" })),
    changedPaths,
})
const keepOnly = evaluateQualityCompletion(t7task, t7payload(realChanged))
const full = evaluateQualityCompletion(t7task, t7payload([...realChanged, ...srcFiles]))
rec("D0", "wave-1 t7 declaration", "inScope glob patterns", declaredGlobs)
rec("D1", "real wave-1 t7 replay", `declared changedPaths as recorded (${realChanged.length} paths)`, { ok: keepOnly.ok, error: keepOnly.error })
rec("D2", "real wave-1 t7 replay", `+ the src files its own glob declares (${srcFiles.join(", ")})`, { ok: full.ok, error: full.error })

console.log(JSON.stringify(out, null, 2))
