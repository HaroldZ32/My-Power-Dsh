// Wave-3 (t2) self-fix tests: the registry CONTEXT-PAIR redesign, the marker
// prefix-ambiguity fix, and the permanent byte-fidelity assertions for BOTH
// adopted files.
//
// Run: bun test packages/mpd-agent-teams-plugin/self-fix-tests
//
// Why this file exists: wave 2 measured that every LINE-keyed addressing rule is
// order-dependent. After a full re-materialize the guard re-inserted
// `mpd-delta task-contract` at line 1970 where canonical is 1733 — 60 diff lines
// in tools.js — while the region-level signals (region present, block matches,
// module imports) all stayed green. The mirror of the quality-gates.js assertion
// at `scope-glob-and-contract.test.mjs:399` for tools.js lives here, together with
// the insertion-history cases and one fixture per colliding marker pair.
import { test, expect } from "bun:test"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { MPD_DELTAS } from "../lib/mpd-deltas.js"
import { applyAgentTeamsFixes, assertRegistryFormat, canonicalIndent, findRegion } from "../../../scripts/patch-agent-teams-fixes.mjs"

const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), "..")
const repoRoot = join(pluginRoot, "..", "..")
const LIB_FILES = ["index.js", "quality-gates.js", "tools.js", "mpd-deltas.js"]
const ADOPTED_FILES = ["index.js", "quality-gates.js", "tools.js"]

/**
 * Copy the adopted lib + registry + the applier CLI into a scratch root, so the
 * guard can be driven both in-process and as the real command-line entry point.
 */
function scratchRoot() {
    const root = mkdtempSync(join(tmpdir(), "mpd-w3-registry-"))
    mkdirSync(join(root, "packages/mpd-agent-teams-plugin/lib"), { recursive: true })
    mkdirSync(join(root, "scripts"), { recursive: true })
    for (const file of LIB_FILES)
        cpSync(join(pluginRoot, "lib", file), join(root, "packages/mpd-agent-teams-plugin/lib", file))
    cpSync(join(repoRoot, "scripts", "patch-agent-teams-fixes.mjs"), join(root, "scripts", "patch-agent-teams-fixes.mjs"))
    return root
}

const libPath = (root, name) => join(root, "packages/mpd-agent-teams-plugin/lib", name)

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

const canonicalOf = (name) => readFileSync(join(pluginRoot, "lib", name), "utf8")
const regionIdAt = (line) => /\/\/#region (mpd-delta [A-Za-z0-9-]+) \(/.exec(line)?.[1]

/**
 * The re-materialize this guard fears: regions come back WITHOUT our deltas
 * (markers and marked code both gone). `ids` drops only the named regions, which
 * is an equally real history — a heal that ran halfway leaves exactly that state.
 */
function stripDeltas(file, ids) {
    const source = readFileSync(file, "utf8").split("\n")
    const stripped = []
    for (let index = 0; index < source.length; index += 1) {
        const regionId = regionIdAt(source[index])
        if (regionId === undefined) {
            stripped.push(source[index])
            continue
        }
        const end = source.findIndex((line, at) => at > index && line.trim() === `//#endregion ${regionId}`)
        if (end === -1)
            throw new Error(`fixture is malformed: unterminated region ${regionId}`)
        if (ids === undefined || ids.has(regionId)) {
            index = end
            continue
        }
        for (let at = index; at <= end; at += 1) stripped.push(source[at])
        index = end
    }
    writeFileSync(file, stripped.join("\n"))
}

/** Remove exactly ONE line (a partial strip that leaves a dangling marker). */
function dropLine(file, predicate) {
    const lines = readFileSync(file, "utf8").split("\n")
    const at = lines.findIndex(predicate)
    if (at === -1)
        throw new Error("fixture is malformed: the line to drop was not found")
    lines.splice(at, 1)
    writeFileSync(file, lines.join("\n"))
}

const healError = (root, write) => {
    try {
        applyAgentTeamsFixes({ root, write })
        return ""
    }
    catch (error) {
        return String(error.message)
    }
}

// ---------- the headline case: strip BOTH files, heal each byte-for-byte ----------
test("t2: strip-healing ALL adopted files from the same state is byte-identical", () => {
    const root = scratchRoot()
    try {
        const canonical = Object.fromEntries(ADOPTED_FILES.map((name) => [name, canonicalOf(name)]))
        for (const name of ADOPTED_FILES) stripDeltas(libPath(root, name))
        const healed = applyAgentTeamsFixes({ root, write: true })
        expect(healed.status).toBe("applied")
        expect(healed.inserted.length).toBe(MPD_DELTAS.length)
        for (const name of ADOPTED_FILES)
            expect(readFileSync(libPath(root, name), "utf8"), name).toBe(canonical[name])
        expect(applyAgentTeamsFixes({ root, write: false }).status).toBe("already-applied")
    }
    finally {
        rmSync(root, { recursive: true, force: true })
    }
})

// ---------- permanent byte fidelity for tools.js (mirrors the quality-gates.js assertion) ----------
test("t2: a stripped tools.js heals byte-for-byte and the task-contract region lands at its canonical line", () => {
    const root = scratchRoot()
    try {
        const canonical = canonicalOf("tools.js")
        stripDeltas(libPath(root, "tools.js"))
        expect(applyAgentTeamsFixes({ root, write: true }).status).toBe("applied")
        const healed = readFileSync(libPath(root, "tools.js"), "utf8")
        // BYTE identity is the property wave 2 lost: the measured defect was 60 diff
        // lines with `mpd-delta task-contract` re-inserted at 1970 instead of 1733.
        expect(healed).toBe(canonical)
        const lineOf = (text, needle) => text.split("\n").findIndex((line) => line.trim() === needle)
        const beginMarker = `//#region mpd-delta task-contract (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)`
        expect(lineOf(healed, beginMarker)).toBe(lineOf(canonical, beginMarker))
        expect(lineOf(healed, beginMarker)).toBeGreaterThan(-1)
    }
    finally {
        rmSync(root, { recursive: true, force: true })
    }
})

test("t2: quality-gates.js strip-heal stays byte-identical (no trade between the two files)", () => {
    const root = scratchRoot()
    try {
        const canonical = canonicalOf("quality-gates.js")
        stripDeltas(libPath(root, "quality-gates.js"))
        expect(applyAgentTeamsFixes({ root, write: true }).status).toBe("applied")
        expect(readFileSync(libPath(root, "quality-gates.js"), "utf8")).toBe(canonical)
    }
    finally {
        rmSync(root, { recursive: true, force: true })
    }
})

// ---------- insertion-count exactness: any insertion history, not just a full strip ----------
test("t2: a region heals to its canonical position under partial insertion histories", () => {
    for (const name of ADOPTED_FILES) {
        const deltas = MPD_DELTAS.filter((delta) => delta.file.endsWith(`lib/${name}`))
        const siblingIds = deltas
            .filter((delta) => delta.id.endsWith("scope-overlap") || delta.id.endsWith("scope-overlap-normalize"))
            .slice(0, 1)
            .map((delta) => delta.id)
        const plans = [
            ["one region missing (the first)", new Set([deltas[0].id])],
            ["one region missing (the last)", new Set([deltas[deltas.length - 1].id])],
            ["every other region missing", new Set(deltas.filter((_, index) => index % 2 === 0).map((delta) => delta.id))],
            // the pair that shares ONE seam: removing exactly one sibling must not heal
            // it into the reverse order
            ...siblingIds.length > 0 ? [["one of two same-seam siblings missing", new Set(siblingIds)]] : [],
        ]
        for (const [label, ids] of plans) {
            const root = scratchRoot()
            try {
                const canonical = canonicalOf(name)
                stripDeltas(libPath(root, name), ids)
                const healed = applyAgentTeamsFixes({ root, write: true })
                expect(healed.status, `${name}: ${label}`).toBe("applied")
                expect(healed.inserted.length, `${name}: ${label}`).toBe(ids.size)
                expect(readFileSync(libPath(root, name), "utf8"), `${name}: ${label}`).toBe(canonical)
            }
            finally {
                rmSync(root, { recursive: true, force: true })
            }
        }
    }
})

// ---------- the marker prefix fix: one fixture per colliding pair ----------
/** The three ids that are prefixes of a sibling, with the file that carries them. */
const COLLIDING_PAIRS = [
    { outer: "mpd-delta scope-overlap", inner: "mpd-delta scope-overlap-normalize", file: "quality-gates.js" },
    { outer: "mpd-delta repair-scope", inner: "mpd-delta repair-scope-fields", file: "quality-gates.js" },
    { outer: "mpd-delta task-contract", inner: "mpd-delta task-contract-render", file: "tools.js" },
]

/** Independent oracle for a region's span: the prefix-shaped regexes the emitter scans with. */
function grepSpan(lines, id) {
    const begin = lines.findIndex((line) => new RegExp(`^\\s*//#region ${id} \\(`).test(line))
    const end = lines.findIndex((line) => line.trim() === `//#endregion ${id}`)
    return { begin, end }
}

test("t2: every colliding pair is a real prefix collision (the fixture is meaningful)", () => {
    for (const { outer, inner, file } of COLLIDING_PAIRS) {
        const lines = canonicalOf(file).split("\n")
        const outerEnd = `//#endregion ${outer}`
        const innerEndAt = lines.findIndex((line) => line.trim() === `//#endregion ${inner}`)
        expect(innerEndAt, `${inner} end line`).toBeGreaterThan(-1)
        // the INNER end marker CONTAINS the OUTER end marker as a substring, which is
        // exactly what the pre-fix `.includes` search resolved to
        expect(lines[innerEndAt].includes(outerEnd), `${inner} end contains ${outer} end`).toBe(true)
        // and the outer region's own end is a different line, so the loose search used
        // to resolve `findRegion(outer)` to the wrong pair whenever that line was gone
        expect(findRegion(lines, outer).end).toBeGreaterThan(-1)
        expect(findRegion(lines, outer).end).not.toBe(innerEndAt)
    }
})

test("t2: a nested colliding pair resolves the OUTER region to its OWN end marker", () => {
    // Synthetic nesting: the child's end marker appears BEFORE the parent's own end
    // marker, so a substring search returns the child's line for the parent id.
    for (const { outer, inner } of COLLIDING_PAIRS) {
        const lines = [
            `//#region ${outer} (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)`,
            `//#region ${inner} (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)`,
            "const innerBody = true;",
            `//#endregion ${inner}`,
            "const outerBody = true;",
            `//#endregion ${outer}`,
        ]
        expect(findRegion(lines, outer)).toEqual({ begin: 0, end: 5 })
        expect(findRegion(lines, inner)).toEqual({ begin: 1, end: 3 })
    }
})

test("t2: intact control — the resolved span equals the independently grepped lines", () => {
    for (const { outer, file } of COLLIDING_PAIRS) {
        const lines = canonicalOf(file).split("\n")
        expect(findRegion(lines, outer)).toEqual(grepSpan(lines, outer))
        const found = findRegion(lines, outer)
        expect(found.end).toBeGreaterThan(found.begin)
    }
})

test("t2: a dangling outer END marker is a partially stripped region, never a half-open pair", () => {
    for (const { outer, inner, file } of COLLIDING_PAIRS) {
        const root = scratchRoot()
        try {
            const path = libPath(root, file)
            // Drop the OUTER's own end line: with the pre-fix substring search the end
            // resolved to the CHILD's end line and produced a bogus span, which the
            // guard reported as `no longer matches this script's registered block`.
            dropLine(path, (line) => line.trim() === `//#endregion ${outer}`)
            const lines = readFileSync(path, "utf8").split("\n")
            const resolved = findRegion(lines, outer)
            expect(resolved.orphan, `${outer} orphan`).toBe("end")
            const message = healError(root, false)
            expect(message, `${outer}: ${message}`).toContain(`MISSING from`)
            expect(message).not.toContain("half-open")
            void inner
        }
        finally {
            rmSync(root, { recursive: true, force: true })
        }
    }
})

test("t2: a dangling outer BEGIN marker is a partially stripped region, never a half-open pair", () => {
    for (const { outer, file } of COLLIDING_PAIRS) {
        const root = scratchRoot()
        try {
            const path = libPath(root, file)
            dropLine(path, (line) => line.trim().startsWith(`//#region ${outer} (`))
            const lines = readFileSync(path, "utf8").split("\n")
            expect(findRegion(lines, outer).orphan, `${outer} orphan`).toBe("begin")
            const message = healError(root, false)
            expect(message, `${outer}: ${message}`).toContain(`MISSING from`)
            expect(message).not.toContain("half-open")
        }
        finally {
            rmSync(root, { recursive: true, force: true })
        }
    }
})

test("t2: --write re-brackets a partially stripped region byte-faithfully (both dangling shapes)", () => {
    for (const { outer, file } of COLLIDING_PAIRS) {
        for (const shape of ["begin", "end"]) {
            const root = scratchRoot()
            try {
                const path = libPath(root, file)
                const canonical = canonicalOf(file)
                if (shape === "begin")
                    dropLine(path, (line) => line.trim().startsWith(`//#region ${outer} (`))
                else
                    dropLine(path, (line) => line.trim() === `//#endregion ${outer}`)
                const healed = applyAgentTeamsFixes({ root, write: true })
                expect(healed.inserted, `${outer} (${shape})`).toContain(outer)
                expect(readFileSync(path, "utf8"), `${outer} (${shape})`).toBe(canonical)
                expect(applyAgentTeamsFixes({ root, write: false }).status).toBe("already-applied")
            }
            finally {
                rmSync(root, { recursive: true, force: true })
            }
        }
    }
})

// ---------- the registry addresses sites by context pairs, not by line keys ----------
test("t2: the registry carries context pairs and no line-keyed anchor fields", () => {
    expect(MPD_DELTAS.length).toBeGreaterThanOrEqual(12)
    for (const delta of MPD_DELTAS) {
        expect(delta.anchor, `${delta.id} must not carry a line-keyed anchor`).toBeUndefined()
        expect(delta.anchorOccurrence, `${delta.id} must not carry an occurrence index`).toBeUndefined()
        expect(delta.anchorMarker, `${delta.id} must not carry an anchor marker`).toBeUndefined()
        expect(Array.isArray(delta.beforeContext) && delta.beforeContext.length > 0, `${delta.id} beforeContext`).toBe(true)
        expect(Array.isArray(delta.afterContext) && delta.afterContext.length > 0, `${delta.id} afterContext`).toBe(true)
        expect(delta.beforeContext.length).toBeLessThanOrEqual(6)
        expect(delta.afterContext.length).toBeLessThanOrEqual(6)
        expect(typeof delta.block).toBe("string")
    }
    const gate = MPD_DELTAS.find((delta) => delta.id === "mpd-delta create-contract-gate")
    expect(gate).toBeDefined()
    // F4 by construction: the block is stored at its own canonical indentation and the
    // context-anchored heal inserts it verbatim, so the create-time gate lands inside
    // the `if (WRITE_KINDS…)` block it belongs to (asserted byte-for-byte by the
    // strip-heal tests above) instead of at a nearby anchor line's indentation.
    expect(canonicalIndent(gate)).toBe("    ")
})

// ---------- wave-3 repair (t9): the complete canon row table, one fixture per row ----------
const beginMarker = (id) => `//#region ${id} (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)`
const endMarker = (id) => `//#endregion ${id}`
const CANON_ID = "mpd-delta repair-scope"
const CANON_FILE = "quality-gates.js"

/** The [begin, end] line indices of one region, by exact marker line. */
function regionSpanOf(lines, id) {
    return {
        begin: lines.findIndex((line) => line.trim() === beginMarker(id)),
        end: lines.findIndex((line) => line.trim() === endMarker(id)),
    }
}

const readLines = (path) => readFileSync(path, "utf8").split("\n")
const writeLines = (path, lines) => writeFileSync(path, lines.join("\n"))

test("t9 R1: both markers present but inverted is the ONLY row that may say 'half-open marker pair'", () => {
    const root = scratchRoot()
    try {
        const path = libPath(root, CANON_FILE)
        const lines = readLines(path)
        const { begin, end } = regionSpanOf(lines, "mpd-delta scope-glob")
        expect(begin).toBeGreaterThan(-1)
        expect(end).toBeGreaterThan(begin)
        const [movedEnd] = lines.splice(end, 1)
        lines.splice(begin, 0, movedEnd)
        writeLines(path, lines)
        expect(() => findRegion(readLines(path), "mpd-delta scope-glob")).toThrow(/half-open marker pair/)
        const before = readFileSync(path, "utf8")
        for (const write of [false, true]) {
            const message = healError(root, write)
            expect(message, `write=${write}`).toMatch(/half-open marker pair/)
            expect(message).toMatch(/both markers exist but the end precedes the begin/)
        }
        expect(readFileSync(path, "utf8")).toBe(before)
    }
    finally {
        rmSync(root, { recursive: true, force: true })
    }
})

test("t9 R2: begin present + end absent + body byte-equal re-brackets in place (all three pairs)", () => {
    for (const { outer, file } of COLLIDING_PAIRS) {
        const root = scratchRoot()
        try {
            const path = libPath(root, file)
            const canonical = canonicalOf(file)
            const { begin, end } = regionSpanOf(readLines(path), outer)
            const lines = readLines(path)
            lines.splice(end, 1)
            writeLines(path, lines)
            expect(findRegion(readLines(path), outer).orphan, `${outer} orphan`).toBe("end")
            expect(healError(root, false), `${outer} check`).toMatch(/MISSING from/)
            expect(healError(root, false)).not.toMatch(/half-open/)
            const healed = applyAgentTeamsFixes({ root, write: true })
            expect(healed.inserted, `${outer}`).toContain(outer)
            expect(readFileSync(path, "utf8"), `${outer}`).toBe(canonical)
            expect(begin).toBeGreaterThan(-1)
        }
        finally {
            rmSync(root, { recursive: true, force: true })
        }
    }
})

test("t9 R3: begin present + end absent + body DRIFTED refuses, naming the region and the line", () => {
    const root = scratchRoot()
    try {
        const path = libPath(root, CANON_FILE)
        const lines = readLines(path)
        const { begin, end } = regionSpanOf(lines, CANON_ID)
        expect(begin).toBeGreaterThan(-1)
        expect(end).toBeGreaterThan(begin)
        lines.splice(end, 1)
        lines[begin + 1] = `${lines[begin + 1]} // drifted body`
        writeLines(path, lines)
        const drifted = readFileSync(path, "utf8")
        for (const write of [false, true]) {
            const message = healError(root, write)
            expect(message, `write=${write}`).toContain(CANON_ID)
            expect(message, `write=${write}`).toContain(`begin marker at line ${begin + 1}`)
            expect(message).toMatch(/NOT the registered block/)
            expect(message).toContain("restore the marked region, or fix it and run")
            expect(message).toContain("--write-registry")
        }
        expect(readFileSync(path, "utf8")).toBe(drifted)
    }
    finally {
        rmSync(root, { recursive: true, force: true })
    }
})

test("t9 R4: end present + begin absent + body byte-equal re-brackets in place (all three pairs)", () => {
    for (const { outer, file } of COLLIDING_PAIRS) {
        const root = scratchRoot()
        try {
            const path = libPath(root, file)
            const canonical = canonicalOf(file)
            dropLine(path, (line) => line.trim().startsWith(`//#region ${outer} (`))
            expect(findRegion(readLines(path), outer).orphan, `${outer} orphan`).toBe("begin")
            const healed = applyAgentTeamsFixes({ root, write: true })
            expect(healed.inserted, `${outer}`).toContain(outer)
            expect(readFileSync(path, "utf8"), `${outer}`).toBe(canonical)
        }
        finally {
            rmSync(root, { recursive: true, force: true })
        }
    }
})

test("t9 R5: end present + begin absent + NOTHING survived drops the orphan line and heals", () => {
    const root = scratchRoot()
    try {
        const path = libPath(root, CANON_FILE)
        const canonical = canonicalOf(CANON_FILE)
        const lines = readLines(path)
        const { begin, end } = regionSpanOf(lines, CANON_ID)
        lines.splice(begin, end - begin)
        writeLines(path, lines)
        const message = healError(root, false)
        expect(message).toContain(CANON_ID)
        expect(message).toMatch(/MISSING from/)
        expect(message).toMatch(/end marker at line \d+ survived and its partner is gone/)
        expect(message).not.toMatch(/half-open/)
        const healed = applyAgentTeamsFixes({ root, write: true })
        expect(healed.inserted).toContain(CANON_ID)
        expect(readFileSync(path, "utf8")).toBe(canonical)
        expect(applyAgentTeamsFixes({ root, write: false }).status).toBe("already-applied")
    }
    finally {
        rmSync(root, { recursive: true, force: true })
    }
})

test("t9 (A): assertRegistryFormat refuses the OLD anchor format with the migration message", () => {
    expect(() => assertRegistryFormat()).not.toThrow()
    const old = MPD_DELTAS.map((delta) => ({
        file: delta.file,
        id: delta.id,
        anchor: "    return runtime;",
        anchorOccurrence: 1,
        anchorMarker: null,
        block: delta.block,
    }))
    const migration = /FAIL: lib\/mpd-deltas\.js is in the OLD anchor format — run: node scripts\/patch-agent-teams-fixes\.mjs --write-registry \(one-time migration\)/
    expect(() => assertRegistryFormat(old)).toThrow(migration)
    // an entry with neither the pair nor the old keys is refused the same way
    expect(() => assertRegistryFormat([{ file: "f.js", id: "mpd-delta x", block: "b" }])).toThrow(migration)
})

test("t9 (A): the CLI refuses a pre-migration registry by name, and --write-registry still migrates", () => {
    const root = scratchRoot()
    try {
        const registryPath = libPath(root, "mpd-deltas.js")
        const source = readFileSync(registryPath, "utf8")
        const oldFormat = source
            .replace(/ {8}beforeContext: \[\n(?: {12}.*\n)* {8}\],\n/g, "")
            .replace(/ {8}afterContext: \[\n(?: {12}.*\n)* {8}\],\n/g, "")
            .replace(/( {8}id: .*\n)/g, "$1        anchor: \"    return runtime;\",\n        anchorOccurrence: 1,\n        anchorMarker: null,\n")
        expect(oldFormat).not.toMatch(/^ {8}beforeContext: \[/m)
        expect(oldFormat).not.toMatch(/^ {8}afterContext: \[/m)
        expect(oldFormat).toMatch(/^ {8}anchorOccurrence: 1,/m)
        writeFileSync(registryPath, oldFormat)
        const script = join(root, "scripts", "patch-agent-teams-fixes.mjs")
        const run = (arg) => {
            try {
                return { code: 0, out: execFileSync("node", [script, arg], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) }
            }
            catch (error) {
                return { code: error.status ?? 1, out: String(error.stdout ?? "") + String(error.stderr ?? "") }
            }
        }
        const refused = run("--check")
        expect(refused.code).toBe(1)
        expect(refused.out).toContain("FAIL: lib/mpd-deltas.js is in the OLD anchor format — run: node scripts/patch-agent-teams-fixes.mjs --write-registry (one-time migration)")
        expect(refused.out).not.toContain("TypeError")
        // the migration path stays open (the guard is NOT at module load)
        const migrated = run("--write-registry")
        expect(migrated.code).toBe(0)
        expect(readFileSync(registryPath, "utf8")).toContain("beforeContext")
        expect(run("--check").code).toBe(0)
    }
    finally {
        rmSync(root, { recursive: true, force: true })
    }
})

// ---------- the single shared seam: the complete 4-state matrix ----------
test("t9: all four states of the ONLY shared seam heal byte-identically", () => {
    const shared = ["mpd-delta scope-overlap", "mpd-delta scope-overlap-normalize"]
    const states = [
        ["both present", [true, true]],
        ["earlier missing", [false, true]],
        ["later missing", [true, false]],
        ["both missing", [false, false]],
    ]
    for (const [label, present] of states) {
        const root = scratchRoot()
        try {
            const canonical = canonicalOf("quality-gates.js")
            const missing = new Set(shared.filter((_, index) => !present[index]))
            if (missing.size > 0)
                stripDeltas(libPath(root, "quality-gates.js"), missing)
            const healed = applyAgentTeamsFixes({ root, write: true })
            expect(healed.status, label).toBe(missing.size > 0 ? "applied" : "already-applied")
            expect(healed.inserted.length, label).toBe(missing.size)
            expect(readFileSync(libPath(root, "quality-gates.js"), "utf8"), label).toBe(canonical)
        }
        finally {
            rmSync(root, { recursive: true, force: true })
        }
    }
})

// ---------- replacement-shaped regions cannot self-heal after a re-materialize ----------
test("t9: a re-materialized tools.js is REFUSED, byte-untouched, with key counts unchanged", () => {
    const root = scratchRoot()
    try {
        const path = libPath(root, "tools.js")
        const upstreamText = pristineUpstream("tools.js")
        expect(upstreamText.match(/mpd-delta/g) ?? []).toHaveLength(0)
        writeFileSync(path, upstreamText)
        const message = healError(root, true)
        expect(message).toMatch(/mpd-delta update-task-contract/)
        expect(message).toContain("restore the marked file, or re-establish the region's site and re-run --write-registry")
        expect(message).toContain("never guesses an insertion site")
        // byte-untouched: the duplicate-key shape shift (upstream twin + mpd twin, last
        // one wins) cannot occur, because the pair assertion refuses before any insert
        expect(readFileSync(path, "utf8")).toBe(upstreamText)
        expect((upstreamText.match(/description: 'Update a task status\/output/g) ?? [])).toHaveLength(1)
        expect(upstreamText).not.toContain("REQUIRED: a payload-only update repeats the current status")
    }
    finally {
        rmSync(root, { recursive: true, force: true })
    }
})

test("t9: the targeted re-materialize shape (upstream twins restored at the literal) is REFUSED too", () => {
    const root = scratchRoot()
    try {
        const path = libPath(root, "tools.js")
        const upstreamLines = pristineUpstream("tools.js").split("\n")
        const upstreamName = upstreamLines.findIndex((line) => line.trim() === "name: 'agent_teams_update_task',")
        const upstreamDescription = upstreamLines.find((line) => line.trim().startsWith("description: 'Update a task status/output"))
        const upstreamStatusAt = upstreamLines.findIndex((line, at) => at > upstreamName && line.trim() === "status: {")
        const upstreamStatusEnd = upstreamLines.findIndex((line, at) => at > upstreamStatusAt && line.trim() === "},")
        const upstreamStatus = upstreamLines.slice(upstreamStatusAt, upstreamStatusEnd + 1)
        // strip exactly the three update_task regions from OUR canonical file
        stripDeltas(path, new Set(MPD_DELTAS.filter((delta) => delta.file.endsWith("lib/tools.js") && delta.id.startsWith("mpd-delta update-task")).map((delta) => delta.id)))
        const lines = readLines(path)
        const nameAt = lines.findIndex((line) => line.trim() === "name: 'agent_teams_update_task',")
        const paramsAt = lines.findIndex((line, at) => at > nameAt && line.trim() === "parameters: {")
        lines.splice(paramsAt, 0, upstreamDescription)
        const outputAt = lines.findIndex((line, at) => at > 0 && line.trim() === "output: { type: 'string', description: 'Result summary; set when completing or failing.' },")
        lines.splice(outputAt, 0, ...upstreamStatus)
        writeLines(path, lines)
        const mutated = readFileSync(path, "utf8")
        const counts = (text) => ({
            descriptions: (text.match(/description: 'Update a task status\/output/g) ?? []).length,
            mpdStatus: (text.match(/REQUIRED: a payload-only update repeats the current status/g) ?? []).length,
        })
        expect(counts(mutated).descriptions).toBe(1)
        expect(counts(mutated).mpdStatus).toBe(0)
        const message = healError(root, true)
        expect(message).toMatch(/mpd-delta update-task/)
        expect(readFileSync(path, "utf8")).toBe(mutated)
        expect(counts(readFileSync(path, "utf8"))).toEqual({ descriptions: 1, mpdStatus: 0 })
    }
    finally {
        rmSync(root, { recursive: true, force: true })
    }
})
