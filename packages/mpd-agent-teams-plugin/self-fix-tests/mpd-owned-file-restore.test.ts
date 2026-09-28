// t6 self-fix tests: the REGISTRY RESTORE lane.
//
// Run: bun test packages/mpd-agent-teams-plugin/self-fix-tests
//
// Why this file exists: regions heal by CONTEXT PAIR, but a MISSING FILE was outside that
// machinery. A human re-materialize (`rm -rf lib && cp -r upstream/lib lib`) restores the
// upstream tree, which does NOT contain our mpd-owned bridge, so
// packages/mpd-agent-teams-plugin/lib/mpd-adapter-ctx.js would vanish and the plugin would
// fail at import with nothing louder than a raw ENOENT from the guard that was supposed to
// protect it. This file pins the three answers that close that class:
//   1. --check FAILS LOUDLY BY NAME on a missing registered mpd-*.js file (never ENOENT);
//   2. --write RECREATES it byte-faithfully from its single registry entry;
//   3. every OTHER missing registered file still fails loudly by name and is never created.
// RULE A (writeRegistry refuses to register a create-class file whose windows do not
// reproduce the whole file) is what keeps the create guarantee SOUND: `uniqueWindow` returns
// the SHORTEST unique window, so a short reconstruction would otherwise be registered and
// then "successfully" recreated as a truncated module. Its blast radius is proven here to be
// --write-registry only, by regenerating the registry in a scratch tree and asserting
// byte-identity with the checked-in file.
import { test, expect } from "bun:test"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
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
import { applyAgentTeamsFixes, createClassBase, mpdDeltaFiles, reconstructCreateClassFile } from "../../../scripts/patch-agent-teams-fixes.ts"
import { stageScript } from "./scratch-scripts.ts"

/** One registered mpd delta region as the derived registry reports it. */
interface DeltaEntry {
    /** Repository-relative path of the adopted file the region lives in. */
    readonly file: string
    /** The region's id. */
    readonly id: string
    /** Shortest unique window of region-stripped lines ending at the seam. */
    readonly beforeContext: readonly string[]
    /** Shortest unique window of region-stripped lines starting after the seam. */
    readonly afterContext: readonly string[]
    /** The region's exact bytes, which one arm corrupts in memory to arm the round-trip rule. */
    block: string
}

/** This file's own directory, so every other root is derived from one URL read. */
const here = dirname(fileURLToPath(import.meta.url))
/** The vendored plugin's root directory, derived from this file's own URL. */
const pluginRoot = join(here, "..")
/** The repository root, derived from the plugin root above. */
const repoRoot = join(pluginRoot, "..", "..")
/** The mpd-owned bridge file the create class exists for. */
const bridgeRelative = "packages/mpd-agent-teams-plugin/lib/mpd-adapter-ctx.js"
/** The derived registry file, which must never be treated as create-class. */
const registryRelative = "packages/mpd-agent-teams-plugin/lib/mpd-deltas.js"
/** An ordinary adopted file, which must never be created. */
const otherRelative = "packages/mpd-agent-teams-plugin/lib/quality-gates.js"
/** Spell one `lib/` file's repository-relative path. */
const relativeOf = (name: string): string => `packages/mpd-agent-teams-plugin/lib/${name}`

/** The sha256 of a text, as the byte-identity arms compare it. */
const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex")
/** The real tree's bytes for one repository-relative path. */
const realText = (relative: string): string => readFileSync(join(repoRoot, relative), "utf8")

// Pins captured BEFORE any arm runs: every scratch arm must leave the real tree untouched.
const REAL_PINS = { bridge: sha256(realText(bridgeRelative)), registry: sha256(realText(registryRelative)) }

/**
 * Every real lib file is staged, so `--write-registry` in the scratch tree is faithful (the
 * registry names 13 files; a missing one would now refuse by name instead of regenerating).
 */
const LIB_FILES = readdirSync(join(pluginRoot, "lib")).filter((name) => name.endsWith(".js"))

/** Copy the adopted lib + the applier CLI into a scratch root, so the real tree is never driven. */
/** Copy the adopted lib and the applier CLI into a scratch root, so the real tree is never driven. */
function scratchRoot(): string {
/** The scratch root the copied tree lives under. */
    const root = mkdtempSync(join(tmpdir(), "mpd-t6-restore-"))
    mkdirSync(join(root, "packages/mpd-agent-teams-plugin/lib"), { recursive: true })
    mkdirSync(join(root, "scripts"), { recursive: true })
    for (const name of LIB_FILES)
        cpSync(join(pluginRoot, "lib", name), join(root, "packages/mpd-agent-teams-plugin/lib", name))
    stageScript(root, "patch-agent-teams-fixes.ts")
    return root
}

/** Resolve a repository-relative path inside one scratch root. */
const libPath = (root: string, relative: string): string => join(root, relative)

/** Drive the REAL command-line entry point inside the scratch tree. */
/** Drive the REAL command-line entry point inside the scratch tree. */
function runCli(root: string, flag: string): { code: number; output: string } {
    try {
/** The CLI's stdout when it exited zero. */
        const out = execFileSync("node", [join(root, "scripts", "patch-agent-teams-fixes.ts"), flag], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
        return { code: 0, output: String(out) }
    }
    catch (error) {
        // A child-process error from `execFileSync` carries status/stdout/stderr; the thrown value is unknowable, so it is read through a structural cast.
        const failure = error as { status?: number; stdout?: string; stderr?: string }
        return { code: failure.status ?? 1, output: String(failure.stdout ?? "") + String(failure.stderr ?? "") }
    }
}

/** The bridge's single registry entry — the create predicate's entry count must be exactly 1. */
/** The bridge's single registry entry, which the create predicate counts. */
function bridgeEntry(): DeltaEntry {
/** The entries the registry holds for the bridge file. */
    const entries = MPD_DELTAS.filter((delta: DeltaEntry) => delta.file === bridgeRelative)
    expect(entries.length).toBe(1)
    return entries[0]
}

test("AC8: --check on a MISSING lib/mpd-adapter-ctx.js FAILS LOUDLY by name — never a raw ENOENT", () => {
/** The scratch root this arm drives. */
    const root = scratchRoot()
    try {
        rmSync(libPath(root, bridgeRelative))
/** The check run with the bridge deleted. */
        const check = runCli(root, "--check")
        expect(check.code).toBe(1)
        expect(check.output).toContain("[patch-agent-teams-fixes] FAIL")
        expect(check.output).toContain("mpd-adapter-ctx.js")
        expect(check.output).toContain("re-run with --write")
        expect(check.output).not.toContain("ENOENT")
    }
    finally {
        rmSync(root, { recursive: true, force: true })
    }
})

test("AC8: --write recreates the missing bridge BYTE-IDENTICALLY (sha256 vs the checked-in bytes), one trailing newline", () => {
/** The scratch root this arm drives. */
    const root = scratchRoot()
    try {
        rmSync(libPath(root, bridgeRelative))
/** The write run with the bridge deleted. */
        const write = runCli(root, "--write")
        expect(write.code).toBe(0)
        expect(write.output).toContain("applied")
/** The bytes the create path wrote back. */
        const created = readFileSync(libPath(root, bridgeRelative), "utf8")
        expect(sha256(created)).toBe(REAL_PINS.bridge)
        expect(created).toBe(reconstructCreateClassFile(bridgeEntry()))
        expect(created.endsWith("\n")).toBe(true)
        expect(created.endsWith("\n\n")).toBe(false)
        // the create path touched ONLY the missing file
        for (const name of ["tools.js", "quality-gates.js", "mpd-deltas.js", "index.js"])
            expect(sha256(readFileSync(libPath(root, relativeOf(name)), "utf8"))).toBe(sha256(realText(relativeOf(name))))
        // and the healed tree is accepted by the verify-only mode again
        expect(runCli(root, "--check").code).toBe(0)
    }
    finally {
        rmSync(root, { recursive: true, force: true })
    }
})

test("the create predicate refuses every OTHER missing registered file BY NAME (never ENOENT, never created)", () => {
/** The scratch root this arm drives. */
    const root = scratchRoot()
    try {
        rmSync(libPath(root, otherRelative))
/** The check run with an ordinary adopted file deleted. */
        const check = runCli(root, "--check")
        expect(check.code).toBe(1)
        expect(check.output).toContain("quality-gates.js")
        expect(check.output).toContain("NOT a create-class file")
        expect(check.output).not.toContain("ENOENT")
/** The write run over the same tree, which must refuse too. */
        const write = runCli(root, "--write")
        expect(write.code).toBe(1)
        expect(write.output).toContain("quality-gates.js")
        expect(write.output).not.toContain("ENOENT")
        expect(existsSync(libPath(root, otherRelative))).toBe(false)
    }
    finally {
        rmSync(root, { recursive: true, force: true })
    }
})

test("predicate-1 exclusion: lib/mpd-deltas.js is NEVER create-class (the derived registry is not restorable from its own entries)", () => {
    expect(createClassBase(registryRelative)).toBeUndefined()
    expect(mpdDeltaFiles()).not.toContain(registryRelative)
    expect(createClassBase(bridgeRelative)).toBe("mpd-adapter-ctx.js")
    expect(createClassBase(otherRelative)).toBeUndefined()
    expect(mpdDeltaFiles()).toContain(bridgeRelative)
})

test("RULE A blast radius: --write-registry in a scratch tree accepts the bridge (no refusal) and regenerates BYTE-IDENTICALLY", () => {
/** The scratch root this arm drives. */
    const root = scratchRoot()
    try {
/** The staged registry's digest, which the regeneration must reproduce. */
        const staged = sha256(readFileSync(libPath(root, registryRelative), "utf8"))
        expect(staged).toBe(REAL_PINS.registry)
/** The registry regeneration run. */
        const run = runCli(root, "--write-registry")
        expect(run.code).toBe(0)
        expect(run.output).toContain("registry regenerated")
        expect(run.output).not.toContain("FAIL")
        expect(sha256(readFileSync(libPath(root, registryRelative), "utf8"))).toBe(REAL_PINS.registry)
    }
    finally {
        rmSync(root, { recursive: true, force: true })
    }
})

test("RULE A refuses a create-class file whose windows do NOT reproduce its bytes (remedy named, registry untouched)", () => {
/** The scratch root this arm drives. */
    const root = scratchRoot()
    try {
        // An EXTRA skeleton line above the leading comment: the shortest unique window no longer
        // reaches the file edge, so beforeContext + block + afterContext reconstructs it SHORT.
        const path = libPath(root, bridgeRelative)
/** The bridge's lines, which the extra skeleton line is prepended to. */
        const lines = readFileSync(path, "utf8").split("\n")
        lines.splice(0, 0, "// an extra skeleton line the windows do not reach")
        writeFileSync(path, lines.join("\n"))
/** The registry's digest before the refused run. */
        const before = sha256(readFileSync(libPath(root, registryRelative), "utf8"))
/** The refused registry regeneration run. */
        const run = runCli(root, "--write-registry")
        expect(run.code).toBe(1)
        expect(run.output).toContain("mpd-adapter-ctx.js")
        expect(run.output).toContain("create-class file")
        expect(run.output).toContain("more than one region")
        expect(sha256(readFileSync(libPath(root, registryRelative), "utf8"))).toBe(before)
    }
    finally {
        rmSync(root, { recursive: true, force: true })
    }
})

test("--write-registry meeting a MISSING registered file is a loud named FAIL telling the caller to run --write first", () => {
/** The scratch root this arm drives. */
    const root = scratchRoot()
    try {
        rmSync(libPath(root, bridgeRelative))
/** The registry's digest before the refused run. */
        const before = sha256(readFileSync(libPath(root, registryRelative), "utf8"))
/** The refused run over the tree with a missing registered file. */
        const run = runCli(root, "--write-registry")
        expect(run.code).toBe(1)
        expect(run.output).toContain("mpd-adapter-ctx.js")
        expect(run.output).toContain("--write")
        expect(run.output).not.toContain("ENOENT")
        expect(sha256(readFileSync(libPath(root, registryRelative), "utf8"))).toBe(before)
    }
    finally {
        rmSync(root, { recursive: true, force: true })
    }
})

test("round-trip rule: a create that fails re-verification is DELETED again (no half-restored tree)", () => {
/** The scratch root this arm drives. */
    const root = scratchRoot()
/** The bridge's registry entry, corrupted in memory to arm the round-trip rule. */
    const entry = bridgeEntry()
/** The entry's pristine block, restored in `finally` so no later arm sees the corruption. */
    const savedBlock = entry.block
    try {
        rmSync(libPath(root, bridgeRelative))
        // Corrupt ONLY the in-memory entry — the real lib/mpd-deltas.js is never written: the
        // block loses its begin marker, so the created bytes cannot re-verify as a complete region.
        entry.block = ["// not-a-region-marker", ...savedBlock.split("\n").slice(1)].join("\n")
/** The applier's failure text, or the empty string when it wrongly succeeded. */
        let message = ""
        try {
            applyAgentTeamsFixes({ root, write: true })
            throw new Error("the applier reported success on a create that cannot re-verify")
        }
        catch (error) {
            message = String(error instanceof Error ? error.message : error)
        }
        expect(message).toContain("mpd-adapter-ctx.js")
        expect(message).toContain("DELETED again")
        expect(existsSync(libPath(root, bridgeRelative))).toBe(false)
    }
    finally {
        entry.block = savedBlock
        rmSync(root, { recursive: true, force: true })
    }
})

test("the real tree is NEVER mutated: bridge and registry sha256 unchanged across every scratch arm", () => {
    expect(existsSync(join(repoRoot, bridgeRelative))).toBe(true)
    expect(sha256(realText(bridgeRelative))).toBe(REAL_PINS.bridge)
    expect(sha256(realText(registryRelative))).toBe(REAL_PINS.registry)
})
