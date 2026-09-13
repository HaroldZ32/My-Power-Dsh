// t4 self-fix tests: the three captain-facing adopted-tooling defects (DEFECT 1 glob
// inScope expansion, DEFECT 2 self-contradicting generated contracts, DEFECT 3
// unreadable running-task contracts) plus the vendor-refresh durability guard.
//
// Run: bun test packages/mpd-agent-teams-plugin/self-fix-tests
//
// DEFECT 1 wave-1 evidence: tasks t3, t4, t7 and t13 each completed with an
// INCOMPLETE changedPaths list because a declared pattern such as
// `packages/mpd-verif-plugin/test/**` was not honoured and every file beneath it
// classified as `undeclared` (the captain had to authorize four
// "complete with covered paths only" workarounds).
// DEFECT 2 wave-1 evidence: on t13 the auto-generated repair contract listed
// `AGENTS.md` in BOTH inScope and outOfScope, so the update gate rejected the
// edit its own acceptance text REQUIRED as `out_of_scope`.
import { test, expect } from "bun:test"
import { createHash } from "node:crypto"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import {
    classifyChangedPath,
    contractContradiction,
    evaluateQualityCompletion,
    inScopeOverlap,
    pathMatchesScope,
    repairScopeFromFindings,
    validateCreateTask,
} from "../lib/quality-gates.js"
import { MPD_DELTAS } from "../lib/mpd-deltas.js"
import { applyAgentTeamsFixes, canonicalIndent } from "../../../scripts/patch-agent-teams-fixes.mjs"

const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), "..")

/** Sha256 pins of the checked-in pristine upstream fixtures (fixtures/upstream/README.md). */
const UPSTREAM_PINS = {
    "tools.js": "ba1f6ab20d18285956c1cf206762f5a751eacd584513fa0d0f0c798e8bfc9ce7",
    "quality-gates.js": "4907ff10a45351af8080b0a6203239012e25028c8175bd7588d31a7aa7481b57",
}

/**
 * Read a PRISTINE upstream fixture. Never `git show HEAD:` — HEAD carries the mpd delta bodies,
 * so it is no longer pristine by construction (t8 / F2). The pinned sha256 makes any fixture
 * edit fail here instead of silently weakening an assertion.
 */
function pristineUpstream(name) {
    const text = readFileSync(join(pluginRoot, "self-fix-tests", "fixtures", "upstream", name), "utf8")
    const digest = createHash("sha256").update(text).digest("hex")
    expect(digest, `fixture fixtures/upstream/${name} drifted from its pinned pristine bytes`).toBe(UPSTREAM_PINS[name])
    return text
}


/** A minimal team state the create-task gate accepts. */
function team() {
    return { halted: false, phase: "running", tasks: [], members: [] }
}

/** Drive validateCreateTask for an implementation contract. */
function contract(inScope, outOfScope) {
    return validateCreateTask(team(), {
        subject: "contract probe",
        kind: "implementation",
        objective: "prove the contract is satisfiable",
        inScope,
        outOfScope,
        acceptance: ["done"],
        verify: ["true"],
    })
}

// ---------- DEFECT 1: `**` expansion ----------
test("DEFECT 1: a declared glob covers the files beneath it", () => {
    // the exact wave-1 shape: a directory-prefix declaration under a package
    expect(pathMatchesScope("packages/mpd-verif-plugin/test/a.ts", "packages/mpd-verif-plugin/test/**")).toBe(true)
    expect(classifyChangedPath("packages/mpd-verif-plugin/test/deep/case.ts", ["packages/mpd-verif-plugin/test/**"], ["packages/mpd-verif-plugin/src"])).toBe("in_scope")
    expect(pathMatchesScope("src/a.ts", "src/**")).toBe(true)
    expect(pathMatchesScope("src/deep/b.ts", "src/**")).toBe(true)
    expect(pathMatchesScope("src", "src/**")).toBe(true)
    expect(pathMatchesScope("src/a.ts", "**/*.ts")).toBe(true)
    expect(pathMatchesScope("a.ts", "**/*.ts")).toBe(true)
    expect(pathMatchesScope("packages/foo/a/b/c.js", "packages/**/c.js")).toBe(true)
    expect(pathMatchesScope("README.md", "*.md")).toBe(true)
})

test("DEFECT 1 negative control: globs do not over-match", () => {
    expect(pathMatchesScope("srcx/a.ts", "src/**")).toBe(false)
    expect(pathMatchesScope("src/a.md", "**/*.ts")).toBe(false)
    expect(pathMatchesScope("src2/a.ts", "src/*")).toBe(false)
    expect(pathMatchesScope("docs/README.md", "*.md")).toBe(false)
})

test("DEFECT 1: every no-wildcard declaration keeps the pre-delta B5 semantics", () => {
    const rows = [
        ["packages/mpd-agent-teams-plugin/self-fix-tests/quality-loop.test.mjs", "packages/mpd-agent-teams-plugin/self-fix-tests", true],
        ["lib/a.js", "lib/a.js", true],
        ["lib/b.js", "lib/a.js", false],
        ["lib/a.js.map", "lib/a.js", false],
        ["a/b/c.js", "a", true],
        ["packages/x", "packages/x/", true],
        ["any/deep/path.ts", ".", true],
        ["x", "/abs/path", false],
        ["x", "~/.dsh", false],
    ]
    for (const [path, pattern, expected] of rows)
        expect(pathMatchesScope(path, pattern), `${path} ~ ${pattern}`).toBe(expected)
})

test("DEFECT 1: the completion gate accepts a glob-declared changedPath and still rejects an undeclared one", () => {
    const task = {
        id: "t4",
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
    expect(evaluateQualityCompletion(task, payload(["packages/foo/test/deep/a.test.ts"])).ok).toBe(true)
    const rejected = evaluateQualityCompletion(task, payload(["packages/other/a.ts"]))
    expect(rejected.ok).toBe(false)
    expect(String(rejected.error)).toMatch(/undeclared/)
})

// ---------- DEFECT 2: self-contradicting contracts ----------
test("DEFECT 2 reproduction: the pre-fix generator listed one path in BOTH lists", () => {
    // The pre-fix repair contract was `inScope: files` + `outOfScope: source.outOfScope`.
    const preFix = { inScope: ["AGENTS.md"], outOfScope: ["AGENTS.md"] }
    expect(classifyChangedPath("AGENTS.md", preFix.inScope, preFix.outOfScope)).toBe("out_of_scope")
    expect(contractContradiction(preFix.inScope, preFix.outOfScope)).toEqual({ inScope: "AGENTS.md", outOfScope: "AGENTS.md" })
    // ...which is exactly what the gate rejects at create time after the fix:
    const rejected = contract(["AGENTS.md"], ["AGENTS.md"])
    expect(rejected.ok).toBe(false)
    expect(String(rejected.error)).toMatch(/unsatisfiable/)
    expect(String(rejected.error)).toMatch(/AGENTS.md/)
})

test("DEFECT 2 fix: the finding's required path is CARVED OUT of the inherited prohibition", () => {
    const scope = repairScopeFromFindings(
        [{ file: "AGENTS.md" }, { file: "packages/x/a.ts" }],
        { id: "t13", inScope: ["packages/x"], outOfScope: ["AGENTS.md"] },
    )
    // The repair's acceptance requires AGENTS.md, so the covering prohibition is
    // carved out and the file is admitted — NOT skipped while its prohibition stands.
    expect(scope.inScope).toEqual(["packages/x", "AGENTS.md"])
    expect(scope.outOfScope).toBeUndefined()
    expect(contractContradiction(scope.inScope, scope.outOfScope ?? [])).toBeUndefined()
    // the edit its own acceptance REQUIRES is now permitted (this is what the
    // wave-1 t13 gate rejected as out_of_scope)
    expect(classifyChangedPath("AGENTS.md", scope.inScope, scope.outOfScope ?? [])).toBe("in_scope")
    expect(classifyChangedPath("packages/x/a.ts", scope.inScope, scope.outOfScope ?? [])).toBe("in_scope")
    // a finding file that is neither declared nor forbidden IS admitted...
    const fresh = repairScopeFromFindings([{ file: "docs/new.md" }], { inScope: ["packages/x"], outOfScope: ["docs/old.md"] })
    expect(fresh.inScope).toEqual(["packages/x", "docs/new.md"])
    // ...while a prohibition no finding requires is preserved untouched
    expect(fresh.outOfScope).toEqual(["docs/old.md"])
    expect(contractContradiction(fresh.inScope, fresh.outOfScope)).toBeUndefined()
})

test("DEFECT 2 fix, REAL wave-1 inputs (team mpd-default-7332aba4 t7 + t10): the required edit is in scope", () => {
    // The archived record verbatim: t7 (the reviewed implementation) declared
    // AGENTS.md in its outOfScope; t10 (the failed review) demanded an AGENTS.md
    // edit in finding F3-agents-md-state-root-stale. Rebuilding the repair scope
    // from those inputs must let the required edit through.
    const t7 = {
        id: "t7",
        inScope: ["packages/mpd-dsh-adapter-plugin/src/index.ts", "packages/mpd-boulder-plugin/src/**", "packages/mpd-memory-plugin/src/**"],
        outOfScope: ["presets/**", "packages/mpd-bundle/cordis.patch.yml", "VENDOR_LOCK.json", "AGENTS.md", "README.md", "README.zh-CN.md"],
        verify: ["bun test packages"],
    }
    const t10Findings = [
        { id: "F1-cocotb-lane-venv-root", severity: "high", file: "packages/mpd-verif-plugin/src/venv.ts", requiredFix: "thread the calling session through requireCocotbVenv" },
        { id: "F3-agents-md-state-root-stale", severity: "low", file: "AGENTS.md", requiredFix: "update the state-root precedence paragraph" },
    ]
    const scope = repairScopeFromFindings(t10Findings, t7)
    // every finding file the repair's acceptance demands is admitted
    for (const finding of t10Findings)
        expect(scope.inScope, finding.file).toContain(finding.file)
    // the source declaration survives
    for (const pattern of t7.inScope)
        expect(scope.inScope, pattern).toContain(pattern)
    // AGENTS.md is no longer forbidden by the repair that REQUIRES editing it
    expect((scope.outOfScope ?? []).some((pattern) => pathMatchesScope("AGENTS.md", pattern))).toBe(false)
    expect(classifyChangedPath("AGENTS.md", scope.inScope, scope.outOfScope ?? [])).toBe("in_scope")
    expect(classifyChangedPath("packages/mpd-verif-plugin/src/venv.ts", scope.inScope, scope.outOfScope ?? [])).toBe("in_scope")
    // falsifiability: prohibitions nobody requires are still enforced
    expect(scope.outOfScope).toContain("VENDOR_LOCK.json")
    expect(scope.outOfScope).toContain("presets/**")
    expect(classifyChangedPath("VENDOR_LOCK.json", scope.inScope, scope.outOfScope)).toBe("out_of_scope")
    // and the generated scope passes its own create-time gate
    expect(contractContradiction(scope.inScope, scope.outOfScope ?? [])).toBeUndefined()
})

test("DEFECT 2 falsifiability: the contradiction guard must not reject legitimate carve-outs", () => {
    expect(contract(["packages/foo"], ["packages/foo/vendor"]).ok).toBe(true)
    expect(contract(["packages/foo/**"], ["packages/foo/vendor"]).ok).toBe(true)
    expect(contract(["packages/foo"], ["packages/bar"]).ok).toBe(true)
    // wildcard-covered and universal prohibitions ARE contradictions
    expect(contract(["packages/foo/**"], ["packages/foo"]).ok).toBe(false)
    expect(contract(["packages/foo/**"], ["**"]).ok).toBe(false)
})

test("DEFECT 2 falsifiability: the write-task overlap guard still separates colliding declarations", () => {
    expect(inScopeOverlap(["packages/foo"], ["packages/foo/vendor"])).toEqual([])
    expect(inScopeOverlap(["packages/foo/lib"], ["packages/foo/test"])).toEqual(["packages/foo/lib"])
    expect(inScopeOverlap(["a"], ["a"])).toEqual(["a"])
})

// ---------- durability: the vendor-refresh guard ----------
/** Copy the adopted lib + deps into a scratch root so the applier can be driven there. */
function scratchRoot() {
    const root = mkdtempSync(join(tmpdir(), "mpd-t4-fix-"))
    mkdirSync(join(root, "packages/mpd-agent-teams-plugin/lib"), { recursive: true })
    for (const file of ["command.js", "index.js", "quality-gates.js", "scheduler.js", "session-start.js", "state.js", "tools.js", "mpd-deltas.js"])
        cpSync(join(pluginRoot, "lib", file), join(root, "packages/mpd-agent-teams-plugin/lib", file))
    return root
}

/**
 * Simulate the re-vendor we fear: the adopted file comes back WITHOUT our deltas
 * (markers and marked code both gone), while the upstream anchor lines remain.
 */
function stripDeltas(file) {
    const source = readFileSync(file, "utf8").split("\n")
    const stripped = []
    for (let index = 0; index < source.length; index += 1) {
        const begin = /^\s*\/\/#region (mpd-delta [A-Za-z0-9-]+) \(/.exec(source[index])
        if (begin === null) {
            stripped.push(source[index])
            continue
        }
        const regionId = begin[1]
        const end = source.findIndex((line, at) => at > index && line.trim() === `//#endregion ${regionId}`)
        if (end === -1)
            throw new Error(`fixture is malformed: unterminated region ${regionId}`)
        index = end
    }
    writeFileSync(file, stripped.join("\n"))
}

test("durability: the guard refuses when a delta region is missing (observed failure)", () => {
    const root = scratchRoot()
    try {
        stripDeltas(join(root, "packages/mpd-agent-teams-plugin/lib/quality-gates.js"))
        expect(() => applyAgentTeamsFixes({ root, write: false })).toThrow(/MISSING from|no longer matches this script's registered block/)
    }
    finally {
        rmSync(root, { recursive: true, force: true })
    }
})

test("durability: the guard is idempotent on the real tree and restores a stripped tree", () => {
    expect(applyAgentTeamsFixes({ write: false }).status).toBe("already-applied")
    const expectedRegions = MPD_DELTAS.length
    expect(applyAgentTeamsFixes({ write: false }).regions).toBe(expectedRegions)
    const root = scratchRoot()
    try {
        for (const name of ["command.js", "index.js", "quality-gates.js", "scheduler.js", "session-start.js", "state.js", "tools.js"])
            stripDeltas(join(root, "packages/mpd-agent-teams-plugin/lib", name))
        // verify-only on a stripped tree must fail loudly...
        expect(() => applyAgentTeamsFixes({ root, write: false })).toThrow()
        // ...while the re-apply pass restores the code, and the next pass verifies it byte-for-byte
        const restored = applyAgentTeamsFixes({ root, write: true })
        expect(restored.status).toBe("applied")
        expect(restored.inserted.length).toBe(expectedRegions)
        expect(applyAgentTeamsFixes({ root, write: false }).status).toBe("already-applied")
    }
    finally {
        rmSync(root, { recursive: true, force: true })
    }
})

// ---------- F2 (t8 finding): every behaviour-changing adopted line is inside a region ----------
/**
 * Lines present in `after` but NOT part of the longest common subsequence with
 * `before` — a real line diff, because region insertion shifts every later line
 * (an index-by-index comparison would flag the whole tail as "changed").
 * @returns {number[]} 0-based indices into `after`
 */
function addedLineIndices(before, after) {
    const a = before.split("\n")
    const b = after.split("\n")
    // LCS table over lines; both files are ~1k lines so the O(n*m) table is cheap.
    const width = b.length + 1
    const table = new Uint32Array((a.length + 1) * width)
    for (let i = a.length - 1; i >= 0; i -= 1) {
        for (let j = b.length - 1; j >= 0; j -= 1) {
            table[i * width + j] = a[i] === b[j]
                ? table[(i + 1) * width + (j + 1)] + 1
                : Math.max(table[(i + 1) * width + j], table[i * width + (j + 1)])
        }
    }
    const added = []
    let i = 0
    let j = 0
    while (i < a.length && j < b.length) {
        if (a[i] === b[j]) {
            i += 1
            j += 1
            continue
        }
        if (table[(i + 1) * width + j] >= table[i * width + (j + 1)]) {
            i += 1
            continue
        }
        added.push(j)
        j += 1
    }
    while (j < b.length) {
        added.push(j)
        j += 1
    }
    return added
}

test("F2: every t4-changed line in lib/quality-gates.js sits inside a registered mpd-delta region", () => {
    // The upstream revision is the last commit that predates the mpd deltas; the
    // comparison is against it so the sweep covers EVERY behaviour-changing line
    // t4 introduced, not just the ones a verifier happened to name.
    const upstreamText = pristineUpstream("quality-gates.js")
    const after = readFileSync(join(pluginRoot, "lib", "quality-gates.js"), "utf8")
    const lines = after.split("\n")
    const regions = MPD_DELTAS.filter((delta) => delta.file.endsWith("lib/quality-gates.js"))
    expect(regions.length).toBeGreaterThanOrEqual(7)
    const insideRegion = (index) => regions.some((delta) => {
        const begin = lines.findIndex((line) => line.trim() === `//#region ${delta.id} (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)`)
        const end = lines.findIndex((line) => line.trim() === `//#endregion ${delta.id}`)
        return begin !== -1 && end !== -1 && index > begin && index < end
    })
    // Sanity: the additions the verifier named as unmarked MUST now be inside regions.
    const named = [
        "const hit = a === b",
        "function normalizeScopePattern(pattern) {",
        "const contradiction = contractContradiction(input.inScope, input.outOfScope ?? []);",
    ]
    for (const needle of named) {
        const index = lines.findIndex((line) => line.trim() === needle)
        expect(index, needle).toBeGreaterThan(-1)
        expect(insideRegion(index), `${needle} at line ${index + 1}`).toBe(true)
    }
    // Every ADDED line must be inside a region, a marker line, or pure prose.
    // A comment/Doc comment change cannot alter runtime behaviour; executable code
    // outside a region is precisely the F2 defect.
    const uncovered = addedLineIndices(upstreamText, after).filter((index) => {
        const line = lines[index] ?? ""
        const trimmed = line.trim()
        if (trimmed === "") return false
        if (line.includes("//#region mpd-delta ") || line.includes("//#endregion mpd-delta ")) return false
        if (insideRegion(index)) return false
        return !(trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*") || trimmed.startsWith("*/"))
    })
    expect(uncovered.map((index) => `${index + 1}: ${lines[index]}`)).toEqual([])
})

// ---------- F3 (t8 finding): the heal path must not create a double declaration ----------
test("F3: healing a RE-MATERIALIZED upstream file refuses instead of emitting a broken module", () => {
    const root = scratchRoot()
    /** Run the healer and return the refusal message (or "" when it unexpectedly succeeded). */
    const healError = (target) => {
        try {
            applyAgentTeamsFixes({ root: target, write: true })
            return ""
        }
        catch (error) {
            return String(error.message)
        }
    }
    try {
        // the verifier's exact scenario: quality-gates.js replaced by the upstream
        // revision (regions AND old declarations gone), tools.js + registry stay ours
        const upstreamText = pristineUpstream("quality-gates.js")
        writeFileSync(join(root, "packages/mpd-agent-teams-plugin/lib/quality-gates.js"), upstreamText)
        // the upstream file still carries `export function pathMatchesScope`; a region
        // insertion would produce a second declaration, so the guard must refuse
        const message = healError(root)
        expect(message).toMatch(/still exists OUTSIDE any region at line|already declared/)
        expect(message).toMatch(/pathMatchesScope|pathMatchesScopeNormalized/)
        expect(message).toMatch(/re-materialized|fails to import/)
        // the file must NOT have been half-healed into a duplicate declaration
        const healed = readFileSync(join(root, "packages/mpd-agent-teams-plugin/lib/quality-gates.js"), "utf8")
        expect(healed).toBe(upstreamText)
        expect((healed.match(/export function pathMatchesScope/g) ?? []).length).toBe(1)
    }
    finally {
        rmSync(root, { recursive: true, force: true })
    }
})

test("F3: a clean (region-carrying) tree still heals successfully", () => {
    const root = scratchRoot()
    try {
        const file = join(root, "packages/mpd-agent-teams-plugin/lib/quality-gates.js")
        // stripDeltas removes WHOLE regions (markers + bodies), i.e. a clean
        // upstream rematerialize with no leftover declarations
        stripDeltas(file)
        const healed = applyAgentTeamsFixes({ root, write: true })
        expect(healed.status).toBe("applied")
        const qualityGateRegions = MPD_DELTAS.filter((delta) => delta.file.endsWith("lib/quality-gates.js")).length
        expect(healed.inserted.length).toBe(qualityGateRegions)
        expect(applyAgentTeamsFixes({ root, write: false }).status).toBe("already-applied")
        const text = readFileSync(file, "utf8")
        expect((text.match(/export function pathMatchesScope\b/g) ?? []).length).toBe(1)
    }
    finally {
        rmSync(root, { recursive: true, force: true })
    }
})

// ---------- F4 (t8 finding): the CLEAN heal must be BYTE-faithful ----------
test("F4: stripping every region and healing reproduces the canonical file byte-for-byte", () => {
    const root = scratchRoot()
    try {
        const file = join(root, "packages/mpd-agent-teams-plugin/lib/quality-gates.js")
        const canonical = readFileSync(join(pluginRoot, "lib", "quality-gates.js"), "utf8")
        stripDeltas(file)
        const healed = applyAgentTeamsFixes({ root, write: true })
        expect(healed.status).toBe("applied")
        // BYTE identity is the property F4 is about: a healed tree must not differ
        // from the canonical adoption (the measured defect was 22 diff lines).
        expect(readFileSync(file, "utf8")).toBe(canonical)
        expect(applyAgentTeamsFixes({ root, write: false }).status).toBe("already-applied")
        // the create-time gate must land INSIDE the WRITE_KINDS block it belongs to,
        // not merely be present somewhere in the file
        const text = readFileSync(file, "utf8")
        const gateAt = text.indexOf("const contradiction = contractContradiction(")
        const blockAt = text.indexOf("if (WRITE_KINDS.includes(kind)) {")
        const closeAt = text.indexOf("\n    }", blockAt)
        expect(blockAt, "WRITE_KINDS block").toBeGreaterThan(-1)
        expect(gateAt, "gate present").toBeGreaterThan(-1)
        expect(gateAt > blockAt && gateAt < closeAt, "gate inside the WRITE_KINDS block").toBe(true)
    }
    finally {
        rmSync(root, { recursive: true, force: true })
    }
})

test("F4: the anchor-indent class is gone with the line keys", () => {
    const gate = MPD_DELTAS.find((delta) => delta.id === "mpd-delta create-contract-gate")
    expect(gate).toBeDefined()
    // `effectiveInsertionIndent` existed to CORRECT a block authored deeper than the
    // anchor line it was inserted at (the measured F4 instance: `create-contract-gate`
    // authored at its own indent and inserted at a shallower anchor's). The wave-3
    // context-pair registry carries no anchor line at all — the region is written
    // verbatim at its own canonical indent — so there is nothing left to correct.
    // The end-to-end proof (gate INSIDE the WRITE_KINDS block, byte-identical heal)
    // is the F4 test above plus registry-context-heal.test.mjs.
    expect(gate.anchor).toBeUndefined()
    expect(gate.anchorOccurrence).toBeUndefined()
    expect(canonicalIndent(gate)).toBe("    ")
})
