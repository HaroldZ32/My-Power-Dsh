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
// The vendored `lib/*.js` modules this file drives are adopted upstream JavaScript: they ship no
// declaration file that describes the DELTA-PATCHED tree (the mpd deltas add exported functions and
// record fields the upstream `lib/types/*.d.ts` do not know about), and that tree is outside this
// lane's write scope. Each import below therefore carries `@ts-expect-error` with its reason, which
// is self-retiring: the day a declaration covers the module, the directive becomes a loud unused
// directive instead of a silent suppression. Every shape this file relies on is declared at its own
// use site.
// @ts-expect-error TS7016: the vendored JS module has no declaration file (see the note above).
import { MPD_DELTAS } from "../lib/mpd-deltas.js"
import { applyAgentTeamsFixes, assertRegistryFormat, canonicalIndent, findRegion } from "../../../scripts/patch-agent-teams-fixes.ts"
import { stageScript } from "./scratch-scripts.ts"

/** The plugin package directory, derived from this test file's own URL (`self-fix-tests/..`). */
const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), "..")
/** The repository root, two levels above the plugin package. */
const repoRoot = join(pluginRoot, "..", "..")
/** The upstream-named adopted files every scratch tree must carry. */
const BASE_LIB_FILES = ["command.js", "index.js", "quality-gates.js", "scheduler.js", "session-start.js", "state.js", "tools.js"]
// A file that carries a REGISTERED mpd-delta region must be staged in the scratch tree,
// or the applier walks the registry against a tree that lacks it and dies with ENOENT
// (measured 2026-09-14: registering regions in members.js + profiles.js broke 13 tests).
// Derived from the registry so this list can never go stale again.
// `!` on the final segment: a registry `file` names a module, so its last path segment always exists.
const REGISTRY_LIB_FILES: string[] = [...new Set<string>(MPD_DELTAS.map((delta: DeltaEntry): string => delta.file.split("/").pop()!))]
/** Every adopted file to stage: the base set plus whatever the registry addresses. */
const ADOPTED_FILES = [...new Set([...BASE_LIB_FILES, ...REGISTRY_LIB_FILES])]
/** The staged lib files, which additionally include the delta registry itself. */
const LIB_FILES = [...new Set([...ADOPTED_FILES, "mpd-deltas.js"])]

/**
 * One entry of the mpd delta registry as this file reads it. The vendored module ships no declaration
 * for this tree, so the fields the cases below touch are declared here instead of imported.
 */
interface DeltaEntry {
    /** Repository-relative path of the adopted file the region lives in. */
    readonly file: string
    /** Region id, unique per file; the marker text interpolates it. */
    readonly id: string
    /** Exact bytes the region must contain, including its marker lines. */
    readonly block: string
    /** Region-stripped lines immediately before the seam, in file order. */
    readonly beforeContext: readonly string[]
    /** Region-stripped lines immediately after the seam, in file order. */
    readonly afterContext: readonly string[]
    /** Retired wave-2 line key; a migrated registry entry does not carry one. */
    readonly anchor?: string
    /** Retired marker line the old line key addressed. */
    readonly anchorMarker?: string
    /** Retired occurrence index of the old anchor marker. */
    readonly anchorOccurrence?: number
}

/**
 * Copy the adopted lib + registry + the applier CLI into a scratch root, so the
 * guard can be driven both in-process and as the real command-line entry point.
 */
function scratchRoot(): string {
    /** A fresh scratch root holding a copy of the adopted lib and the applier CLI. */
    const root = mkdtempSync(join(tmpdir(), "mpd-w3-registry-"))
    mkdirSync(join(root, "packages/mpd-agent-teams-plugin/lib"), { recursive: true })
    mkdirSync(join(root, "scripts"), { recursive: true })
    for (const file of LIB_FILES)
        cpSync(join(pluginRoot, "lib", file), join(root, "packages/mpd-agent-teams-plugin/lib", file))
    stageScript(root, "patch-agent-teams-fixes.ts")
    return root
}

/** The scratch-tree path of one staged lib file. */
const libPath = (root: string, name: string): string => join(root, "packages/mpd-agent-teams-plugin/lib", name)

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
function pristineUpstream(name: keyof typeof UPSTREAM_PINS): string {
    /** The fixture's bytes, read as UTF-8 so its digest can be pinned. */
    const text = readFileSync(join(pluginRoot, "self-fix-tests", "fixtures", "upstream", name), "utf8")
    /** The fixture's sha256, compared against the pin below. */
    const digest = createHash("sha256").update(text).digest("hex")
    expect(digest, `fixture fixtures/upstream/${name} drifted from its pinned pristine bytes`).toBe(UPSTREAM_PINS[name])
    return text
}

/** The checked-in canonical bytes of one adopted lib file. */
const canonicalOf = (name: string): string => readFileSync(join(pluginRoot, "lib", name), "utf8")
/** The id of the region a line OPENS, or undefined for any other line. */
const regionIdAt = (line: string): string | undefined => /\/\/#region (mpd-delta [A-Za-z0-9-]+) \(/.exec(line)?.[1]

/**
 * The re-materialize this guard fears: regions come back WITHOUT our deltas
 * (markers and marked code both gone). `ids` drops only the named regions, which
 * is an equally real history — a heal that ran halfway leaves exactly that state.
 */
function stripDeltas(file: string, ids?: ReadonlySet<string>): void {
    /** The worked-on file split into lines, the unit every addressing rule uses. */
    const source = readFileSync(file, "utf8").split("\n")
    /** The lines kept after the named regions are dropped. */
    const stripped: string[] = []
    for (let index = 0; index < source.length; index += 1) {
        /** The region this line opens, when it opens one. */
        const regionId = regionIdAt(source[index])
        if (regionId === undefined) {
            stripped.push(source[index])
            continue
        }
        /** Index of the closing marker of the region opened at `index`, or -1 when none follows. */
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
function dropLine(file: string, predicate: (line: string) => boolean): void {
    /** The fixture's lines, mutated in place and written back. */
    const lines = readFileSync(file, "utf8").split("\n")
    /** Index of the first line the predicate accepts, or -1. */
    const at = lines.findIndex(predicate)
    if (at === -1)
        throw new Error("fixture is malformed: the line to drop was not found")
    lines.splice(at, 1)
    writeFileSync(file, lines.join("\n"))
}

/** Run one non-throwing heal pass and return its refusal message, or the empty string when it applied. */
const healError = (root: string, write: boolean): string => {
    try {
        applyAgentTeamsFixes({ root, write })
        return ""
    }
    catch (error) {
        // A thrown value is `unknown`; the applier only ever throws Error instances, so the message is read through Error.
        return String((error as Error).message)
    }
}

// ---------- the headline case: strip BOTH files, heal each byte-for-byte ----------
test("t2: strip-healing ALL adopted files from the same state is byte-identical", () => {
    /** Scratch tree whose adopted files are stripped before the heal. */
    const root = scratchRoot()
    try {
        /** Canonical bytes per adopted file, keyed by file name, captured before stripping. */
        const canonical = Object.fromEntries(ADOPTED_FILES.map((name) => [name, canonicalOf(name)]))
        for (const name of ADOPTED_FILES) stripDeltas(libPath(root, name))
        /** Verdict of the full re-apply pass. */
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
    /** Scratch tree driving the tools.js byte-fidelity case. */
    const root = scratchRoot()
    try {
        /** The checked-in tools.js bytes the healed tree must reproduce. */
        const canonical = canonicalOf("tools.js")
        stripDeltas(libPath(root, "tools.js"))
        expect(applyAgentTeamsFixes({ root, write: true }).status).toBe("applied")
        /** The healed file's bytes, compared against canonical. */
        const healed = readFileSync(libPath(root, "tools.js"), "utf8")
        // BYTE identity is the property wave 2 lost: the measured defect was 60 diff
        // lines with `mpd-delta task-contract` re-inserted at 1970 instead of 1733.
        expect(healed).toBe(canonical)
        /** Index of the first line whose trimmed text equals `needle`, or -1. */
        const lineOf = (text: string, needle: string): number => text.split("\n").findIndex((line) => line.trim() === needle)
        /** The exact begin marker line of the task-contract region in tools.js. */
        const beginMarker = `//#region mpd-delta task-contract (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)`
        expect(lineOf(healed, beginMarker)).toBe(lineOf(canonical, beginMarker))
        expect(lineOf(healed, beginMarker)).toBeGreaterThan(-1)
    }
    finally {
        rmSync(root, { recursive: true, force: true })
    }
})

test("t2: quality-gates.js strip-heal stays byte-identical (no trade between the two files)", () => {
    /** Scratch tree driving the quality-gates.js byte-fidelity case. */
    const root = scratchRoot()
    try {
        /** The checked-in quality-gates.js bytes the healed tree must reproduce. */
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
// NOTE (wave 2, lane A / t8): this case walks EVERY registered region of EVERY adopted file through
// four strip-and-heal plans, so its runtime scales with the registry (73 → 78 regions when lane A
// added five) and it is the heaviest case in this file: measured 3.3 s alone and 5.66 s under a
// full-suite parallel run, where bun's 5 s default turns a slow-but-correct heal into "(fail) …
// timed out". The explicit timeout below is the remedy for exactly that conflation — NOT one
// assertion in this case was relaxed: a heal that loses its canonical position still fails on the
// byte comparison, and the non-vacuity check at the end still guards the fixture.
test("t2: a region heals to its canonical position under partial insertion histories", () => {
    /** Count of adopted files that carry a registered region; guards the case against a vacuous fixture. */
    let filesWithRegions = 0
    for (const name of ADOPTED_FILES) {
        /** The registered deltas whose file is this adopted file. */
        const deltas = MPD_DELTAS.filter((delta: DeltaEntry): boolean => delta.file.endsWith(`lib/${name}`))
        // An adopted file MAY carry zero registered regions: its local adaptations can be
        // plain body edits with no marked seam (e.g. `index.js` after the cross-bundle
        // carrier hook was removed). There is no insertion history to exercise there, and
        // the cross-file heal test above still covers the file byte-for-byte.
        if (deltas.length === 0)
            continue
        filesWithRegions += 1
        /** The same-seam sibling to drop on its own, when the file carries one. */
        const siblingIds = deltas
            .filter((delta: DeltaEntry): boolean => delta.id.endsWith("scope-overlap") || delta.id.endsWith("scope-overlap-normalize"))
            .slice(0, 1)
            .map((delta: DeltaEntry): string => delta.id)
        /** The strip-and-heal plans this case exercises, each a label and the region ids to drop. */
        const plans: ReadonlyArray<readonly [string, ReadonlySet<string>]> = [
            ["one region missing (the first)", new Set<string>([deltas[0].id])],
            ["one region missing (the last)", new Set<string>([deltas[deltas.length - 1].id])],
            ["every other region missing", new Set<string>(deltas.filter((_: DeltaEntry, index: number): boolean => index % 2 === 0).map((delta: DeltaEntry): string => delta.id))],
            // the pair that shares ONE seam: removing exactly one sibling must not heal
            // it into the reverse order
            // A spread from a conditional takes no contextual type from the list's declared element, so
            // this pair is asserted into the tuple shape; the asserted value is the same array.
            ...siblingIds.length > 0 ? [["one of two same-seam siblings missing", new Set<string>(siblingIds)] as [string, ReadonlySet<string>]] : [],
        ]
        for (const [label, ids] of plans) {
            /** Scratch tree for one strip-and-heal plan. */
            const root = scratchRoot()
            try {
                /** Canonical bytes of the file under test, captured before stripping. */
                const canonical = canonicalOf(name)
                stripDeltas(libPath(root, name), ids)
                /** Verdict of the re-apply pass for this plan. */
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
    // Non-vacuity: the fixture must still exercise real insertion histories, so a registry
    // that lost every region would fail here instead of passing silently.
    expect(filesWithRegions).toBeGreaterThan(0)
}, 30_000)

// ---------- the marker prefix fix: one fixture per colliding pair ----------
/** The three ids that are prefixes of a sibling, with the file that carries them. */
const COLLIDING_PAIRS = [
    { outer: "mpd-delta scope-overlap", inner: "mpd-delta scope-overlap-normalize", file: "quality-gates.js" },
    { outer: "mpd-delta repair-scope", inner: "mpd-delta repair-scope-fields", file: "quality-gates.js" },
    { outer: "mpd-delta task-contract", inner: "mpd-delta task-contract-render", file: "tools.js" },
]

/** Independent oracle for a region's span: the prefix-shaped regexes the emitter scans with. */
function grepSpan(lines: readonly string[], id: string): { begin: number; end: number } {
    /** Index of the region's begin marker line, or -1. */
    const begin = lines.findIndex((line) => new RegExp(`^\\s*//#region ${id} \\(`).test(line))
    /** Index of the region's end marker line, or -1. */
    const end = lines.findIndex((line) => line.trim() === `//#endregion ${id}`)
    return { begin, end }
}

test("t2: every colliding pair is a real prefix collision (the fixture is meaningful)", () => {
    for (const { outer, inner, file } of COLLIDING_PAIRS) {
        /** Canonical lines of the file that carries this colliding pair. */
        const lines = canonicalOf(file).split("\n")
        /** The outer region's own end marker, which the inner one contains as a substring. */
        const outerEnd = `//#endregion ${outer}`
        /** Index of the inner region's end marker line. */
        const innerEndAt = lines.findIndex((line) => line.trim() === `//#endregion ${inner}`)
        expect(innerEndAt, `${inner} end line`).toBeGreaterThan(-1)
        // the INNER end marker CONTAINS the OUTER end marker as a substring, which is
        // exactly what the pre-fix `.includes` search resolved to
        expect(lines[innerEndAt].includes(outerEnd), `${inner} end contains ${outer} end`).toBe(true)
        // and the outer region's own end is a different line, so the loose search used
        // to resolve `findRegion(outer)` to the wrong pair whenever that line was gone
        // Both lookups below run on the canonical fixture, which carries the outer region, so neither can miss.
        expect(findRegion(lines, outer)!.end).toBeGreaterThan(-1)
        expect(findRegion(lines, outer)!.end).not.toBe(innerEndAt)
    }
})

test("t2: a nested colliding pair resolves the OUTER region to its OWN end marker", () => {
    // Synthetic nesting: the child's end marker appears BEFORE the parent's own end
    // marker, so a substring search returns the child's line for the parent id.
    for (const { outer, inner } of COLLIDING_PAIRS) {
        /** Synthetic fixture lines: an inner region nested inside the outer one's body. */
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
        /** Canonical lines of the file that carries this colliding pair. */
        const lines = canonicalOf(file).split("\n")
        expect(findRegion(lines, outer)).toEqual(grepSpan(lines, outer))
        /** The resolved outer span; the canonical fixture carries the region, so the lookup cannot miss. */
        const found = findRegion(lines, outer)!
        expect(found.end).toBeGreaterThan(found.begin)
    }
})

test("t2: a dangling outer END marker is a partially stripped region, never a half-open pair", () => {
    for (const { outer, inner, file } of COLLIDING_PAIRS) {
        /** Scratch tree whose outer END marker is dropped. */
        const root = scratchRoot()
        try {
            /** The staged copy of the file that carries the colliding pair. */
            const path = libPath(root, file)
            // Drop the OUTER's own end line: with the pre-fix substring search the end
            // resolved to the CHILD's end line and produced a bogus span, which the
            // guard reported as `no longer matches this script's registered block`.
            dropLine(path, (line: string): boolean => line.trim() === `//#endregion ${outer}`)
            /** The mutated file re-read, so the lookup sees the dropped marker. */
            const lines = readFileSync(path, "utf8").split("\n")
            /** The partially stripped span; only the END marker was dropped, so the lookup returns a record. */
            const resolved = findRegion(lines, outer)!
            expect(resolved.orphan, `${outer} orphan`).toBe("end")
            /** The refusal text the guard produced for the dangling end marker. */
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
        /** Scratch tree whose outer BEGIN marker is dropped. */
        const root = scratchRoot()
        try {
            /** The staged copy of the file that carries the colliding pair. */
            const path = libPath(root, file)
            dropLine(path, (line: string): boolean => line.trim().startsWith(`//#region ${outer} (`))
            /** The mutated file re-read, so the lookup sees the dropped marker. */
            const lines = readFileSync(path, "utf8").split("\n")
            // Only the BEGIN marker was dropped, so the end marker survives and the lookup returns a record.
            expect(findRegion(lines, outer)!.orphan, `${outer} orphan`).toBe("begin")
            /** The refusal text the guard produced for the dangling begin marker. */
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
            /** Scratch tree for one dangling shape of one colliding pair. */
            const root = scratchRoot()
            try {
                /** The staged copy of the file that carries the colliding pair. */
                const path = libPath(root, file)
                /** Canonical bytes the re-bracketed file must reproduce. */
                const canonical = canonicalOf(file)
                if (shape === "begin")
                    dropLine(path, (line: string): boolean => line.trim().startsWith(`//#region ${outer} (`))
                else
                    dropLine(path, (line: string): boolean => line.trim() === `//#endregion ${outer}`)
                /** Verdict of the write pass that re-brackets the dangling region. */
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
    /** The create-contract gate entry, whose block indent the F4 assertion pins. */
    const gate = MPD_DELTAS.find((delta: DeltaEntry): boolean => delta.id === "mpd-delta create-contract-gate")
    expect(gate).toBeDefined()
    // F4 by construction: the block is stored at its own canonical indentation and the
    // context-anchored heal inserts it verbatim, so the create-time gate lands inside
    // the `if (WRITE_KINDS…)` block it belongs to (asserted byte-for-byte by the
    // strip-heal tests above) instead of at a nearby anchor line's indentation.
    expect(canonicalIndent(gate)).toBe("    ")
})

// ---------- wave-3 repair (t9): the complete canon row table, one fixture per row ----------
const beginMarker = (id: string): string => `//#region ${id} (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)`
/** The exact end marker line for one region id. */
const endMarker = (id: string): string => `//#endregion ${id}`
/** The region id the canon row table drives its begin/end cases with. */
const CANON_ID = "mpd-delta repair-scope"
/** The adopted file that carries CANON_ID. */
const CANON_FILE = "quality-gates.js"

/** The [begin, end] line indices of one region, by exact marker line. */
function regionSpanOf(lines: readonly string[], id: string): { begin: number; end: number } {
    return {
        begin: lines.findIndex((line) => line.trim() === beginMarker(id)),
        end: lines.findIndex((line) => line.trim() === endMarker(id)),
    }
}

/** Every line of a file, with no line-ending normalization. */
const readLines = (path: string): string[] => readFileSync(path, "utf8").split("\n")
/** Write lines back as one newline-joined text block. */
const writeLines = (path: string, lines: readonly string[]): void => writeFileSync(path, lines.join("\n"))

test("t9 R1: both markers present but inverted is the ONLY row that may say 'half-open marker pair'", () => {
    /** Scratch tree for the inverted-marker row. */
    const root = scratchRoot()
    try {
        /** The staged file whose region markers are inverted. */
        const path = libPath(root, CANON_FILE)
        /** The staged file's lines, spliced to move the end marker above the begin. */
        const lines = readLines(path)
        /** The region's marker span, read before the lines are rewritten. */
        const { begin, end } = regionSpanOf(lines, "mpd-delta scope-glob")
        expect(begin).toBeGreaterThan(-1)
        expect(end).toBeGreaterThan(begin)
        /** The end marker line, removed so it can be re-inserted before the begin. */
        const [movedEnd] = lines.splice(end, 1)
        lines.splice(begin, 0, movedEnd)
        writeLines(path, lines)
        expect(() => findRegion(readLines(path), "mpd-delta scope-glob")).toThrow(/half-open marker pair/)
        /** The inverted file's bytes, which every refusal must leave untouched. */
        const before = readFileSync(path, "utf8")
        for (const write of [false, true]) {
            /** The refusal text for one write mode. */
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
        /** Scratch tree for one colliding pair's R2 row. */
        const root = scratchRoot()
        try {
            /** The staged file whose end marker is dropped. */
            const path = libPath(root, file)
            /** Canonical bytes the re-bracketed file must reproduce. */
            const canonical = canonicalOf(file)
            /** The region's marker span, read before the end marker is dropped. */
            const { begin, end } = regionSpanOf(readLines(path), outer)
            /** The staged file's lines, with the end marker removed. */
            const lines = readLines(path)
            lines.splice(end, 1)
            writeLines(path, lines)
            // Only the END marker was spliced out above, so the begin marker survives and the lookup returns a record.
            expect(findRegion(readLines(path), outer)!.orphan, `${outer} orphan`).toBe("end")
            expect(healError(root, false), `${outer} check`).toMatch(/MISSING from/)
            expect(healError(root, false)).not.toMatch(/half-open/)
            /** Verdict of the write pass that re-brackets the region in place. */
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
    /** Scratch tree for the drifted-body refusal row. */
    const root = scratchRoot()
    try {
        /** The staged file whose region body is drifted. */
        const path = libPath(root, CANON_FILE)
        /** The staged file's lines, with the end marker and a body edit applied. */
        const lines = readLines(path)
        /** The region's marker span, read before the mutation. */
        const { begin, end } = regionSpanOf(lines, CANON_ID)
        expect(begin).toBeGreaterThan(-1)
        expect(end).toBeGreaterThan(begin)
        lines.splice(end, 1)
        lines[begin + 1] = `${lines[begin + 1]} // drifted body`
        writeLines(path, lines)
        /** The mutated bytes, which the refusal must leave untouched. */
        const drifted = readFileSync(path, "utf8")
        for (const write of [false, true]) {
            /** The refusal text for one write mode. */
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
        /** Scratch tree for one colliding pair's R4 row. */
        const root = scratchRoot()
        try {
            /** The staged file whose begin marker is dropped. */
            const path = libPath(root, file)
            /** Canonical bytes the re-bracketed file must reproduce. */
            const canonical = canonicalOf(file)
            dropLine(path, (line: string): boolean => line.trim().startsWith(`//#region ${outer} (`))
            // Only the begin marker was dropped above, so the end marker survives and the lookup returns a record.
            expect(findRegion(readLines(path), outer)!.orphan, `${outer} orphan`).toBe("begin")
            /** Verdict of the write pass that re-brackets the orphan end marker. */
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
    /** Scratch tree for the nothing-survived row. */
    const root = scratchRoot()
    try {
        /** The staged file whose whole region body is deleted. */
        const path = libPath(root, CANON_FILE)
        /** Canonical bytes the healed file must reproduce. */
        const canonical = canonicalOf(CANON_FILE)
        /** The staged file's lines, with the region body and both markers removed. */
        const lines = readLines(path)
        /** The region's marker span, read before the body is deleted. */
        const { begin, end } = regionSpanOf(lines, CANON_ID)
        lines.splice(begin, end - begin)
        writeLines(path, lines)
        /** The refusal text naming the surviving end marker. */
        const message = healError(root, false)
        expect(message).toContain(CANON_ID)
        expect(message).toMatch(/MISSING from/)
        expect(message).toMatch(/end marker at line \d+ survived and its partner is gone/)
        expect(message).not.toMatch(/half-open/)
        /** Verdict of the heal that re-inserts the whole region. */
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
    /** A pre-migration registry: every entry carries the retired line keys instead of a context pair. */
    const old = MPD_DELTAS.map((delta: DeltaEntry) => ({
        file: delta.file,
        id: delta.id,
        anchor: "    return runtime;",
        anchorOccurrence: 1,
        anchorMarker: null,
        block: delta.block,
    }))
    /** The exact one-time migration message the format guard must print. */
    const migration = /FAIL: lib\/mpd-deltas\.js is in the OLD anchor format — run: node scripts\/patch-agent-teams-fixes\.mjs --write-registry \(one-time migration\)/
    expect(() => assertRegistryFormat(old)).toThrow(migration)
    // an entry with neither the pair nor the old keys is refused the same way
    // The fixture carries NEITHER the context pair NOR the retired keys, so it cannot satisfy the
    // guard's parameter type without the assertion.
    expect(() => assertRegistryFormat([{ file: "f.js", id: "mpd-delta x", block: "b" }] as unknown as Parameters<typeof assertRegistryFormat>[0])).toThrow(migration)
})

test("t9 (A): the CLI refuses a pre-migration registry by name, and --write-registry still migrates", () => {
    /** Scratch tree whose registry file is rewritten into the old anchor format. */
    const root = scratchRoot()
    try {
        /** The staged delta registry, rewritten to the retired format. */
        const registryPath = libPath(root, "mpd-deltas.js")
        /** The registry's new-format bytes, the input to the downgrade rewrites. */
        const source = readFileSync(registryPath, "utf8")
        /** The registry with its context pairs replaced by the retired line keys. */
        const oldFormat = source
            .replace(/ {8}beforeContext: \[\n(?: {12}.*\n)* {8}\],\n/g, "")
            .replace(/ {8}afterContext: \[\n(?: {12}.*\n)* {8}\],\n/g, "")
            .replace(/( {8}id: .*\n)/g, "$1        anchor: \"    return runtime;\",\n        anchorOccurrence: 1,\n        anchorMarker: null,\n")
        expect(oldFormat).not.toMatch(/^ {8}beforeContext: \[/m)
        expect(oldFormat).not.toMatch(/^ {8}afterContext: \[/m)
        expect(oldFormat).toMatch(/^ {8}anchorOccurrence: 1,/m)
        writeFileSync(registryPath, oldFormat)
        /** The staged applier CLI, executed as a real child process. */
        const script = join(root, "scripts", "patch-agent-teams-fixes.ts")
        /** Run the applier CLI with one flag, normalized to an exit code plus its combined output. */
        const run = (arg: string): { code: number; out: string } => {
            try {
                return { code: 0, out: execFileSync("node", [script, arg], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) }
            }
            catch (error) {
                // A child-process error from `execFileSync` carries status/stdout/stderr; the thrown value
                // is `unknown` and its structural shape cannot be narrowed, so each field is asserted.
                return { code: (error as { status?: number }).status ?? 1, out: String((error as { stdout?: string }).stdout ?? "") + String((error as { stderr?: string }).stderr ?? "") }
            }
        }
        /** The --check refusal, which must name the migration command. */
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
    /** The only two regions that share one seam, in registry order. */
    const shared = ["mpd-delta scope-overlap", "mpd-delta scope-overlap-normalize"]
    /** All four presence states of that seam, each a label and its per-region present flags. */
    const states: ReadonlyArray<readonly [string, readonly boolean[]]> = [
        ["both present", [true, true]],
        ["earlier missing", [false, true]],
        ["later missing", [true, false]],
        ["both missing", [false, false]],
    ]
    for (const [label, present] of states) {
        /** Scratch tree for one state of the shared seam. */
        const root = scratchRoot()
        try {
            /** Canonical bytes the healed file must reproduce for this state. */
            const canonical = canonicalOf("quality-gates.js")
            /** The regions absent in this state, which the heal must re-insert. */
            const missing = new Set(shared.filter((_, index) => !present[index]))
            if (missing.size > 0)
                stripDeltas(libPath(root, "quality-gates.js"), missing)
            /** Verdict of the heal for this state. */
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
    /** Scratch tree seeded with the pristine upstream tools.js. */
    const root = scratchRoot()
    try {
        /** The staged tools.js, overwritten with the pristine upstream bytes. */
        const path = libPath(root, "tools.js")
        /** The pristine upstream fixture, which carries no mpd marker. */
        const upstreamText = pristineUpstream("tools.js")
        expect(upstreamText.match(/mpd-delta/g) ?? []).toHaveLength(0)
        writeFileSync(path, upstreamText)
        /** The refusal text for the re-materialized file. */
        const message = healError(root, true)
        // WHICH delta the refusal names is registry ORDER, not behaviour: it is the first region
        // whose context pair no longer brackets a seam, so adding a region above `task-contract`
        // (wave-1 t14 did) legitimately changes it. Pin the invariant instead — the message must
        // name a REGISTERED delta id, which is order-independent and strictly stronger than one
        // literal id, and can never name a phantom.
        const named = /delta "([^"]+)"/.exec(message)?.[1]
        expect(named, `the refusal must NAME a registered delta; got: ${message}`).toBeDefined()
        expect(MPD_DELTAS.some((delta: DeltaEntry): boolean => delta.id === named), `named delta "${named}" is not registered`).toBe(true)
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
    /** Scratch tree for the targeted re-materialize shape. */
    const root = scratchRoot()
    try {
        /** The staged tools.js, mutated into the drifted-twin shape. */
        const path = libPath(root, "tools.js")
        /** The pristine upstream fixture split into lines. */
        const upstreamLines = pristineUpstream("tools.js").split("\n")
        /** Line of the update_task tool's name field in the upstream fixture. */
        const upstreamName = upstreamLines.findIndex((line) => line.trim() === "name: 'agent_teams_update_task',")
        /** The upstream description line; the pinned fixture carries it exactly once, so the lookup cannot miss. */
        const upstreamDescription = upstreamLines.find((line) => line.trim().startsWith("description: 'Update a task status/output"))!
        /** Line opening the upstream status schema object, after the name field. */
        const upstreamStatusAt = upstreamLines.findIndex((line, at) => at > upstreamName && line.trim() === "status: {")
        /** Line closing the upstream status schema object. */
        const upstreamStatusEnd = upstreamLines.findIndex((line, at) => at > upstreamStatusAt && line.trim() === "},")
        /** The upstream status schema lines restored into our tool. */
        const upstreamStatus = upstreamLines.slice(upstreamStatusAt, upstreamStatusEnd + 1)
        // strip exactly the three update_task regions from OUR canonical file
        stripDeltas(path, new Set<string>(MPD_DELTAS.filter((delta: DeltaEntry): boolean => delta.file.endsWith("lib/tools.js") && delta.id.startsWith("mpd-delta update-task")).map((delta: DeltaEntry): string => delta.id)))
        /** Our file's lines, after the three update-task regions were stripped. */
        const lines = readLines(path)
        /** Line of the update_task tool's name field in our file. */
        const nameAt = lines.findIndex((line) => line.trim() === "name: 'agent_teams_update_task',")
        /** Line opening our tool's parameters object, after the name field. */
        const paramsAt = lines.findIndex((line, at) => at > nameAt && line.trim() === "parameters: {")
        lines.splice(paramsAt, 0, upstreamDescription)
        /** Line of our tool's output field, before which the upstream twin is spliced. */
        const outputAt = lines.findIndex((line, at) => at > 0 && line.trim() === "output: { type: 'string', description: 'Result summary; set when completing or failing.' },")
        lines.splice(outputAt, 0, ...upstreamStatus)
        writeLines(path, lines)
        /** The mutated bytes, which the refusal must leave untouched. */
        const mutated = readFileSync(path, "utf8")
        /** Count the two key strings whose duplicate-key shift the pair assertion prevents. */
        const counts = (text: string): { descriptions: number; mpdStatus: number } => ({
            descriptions: (text.match(/description: 'Update a task status\/output/g) ?? []).length,
            mpdStatus: (text.match(/REQUIRED: a payload-only update repeats the current status/g) ?? []).length,
        })
        expect(counts(mutated).descriptions).toBe(1)
        expect(counts(mutated).mpdStatus).toBe(0)
        /** The refusal text, which must name an update-task region. */
        const message = healError(root, true)
        expect(message).toMatch(/mpd-delta update-task/)
        expect(readFileSync(path, "utf8")).toBe(mutated)
        expect(counts(readFileSync(path, "utf8"))).toEqual({ descriptions: 1, mpdStatus: 0 })
    }
    finally {
        rmSync(root, { recursive: true, force: true })
    }
})
