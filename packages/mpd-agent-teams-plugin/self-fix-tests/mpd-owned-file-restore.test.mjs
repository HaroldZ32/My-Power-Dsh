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
import { MPD_DELTAS } from "../lib/mpd-deltas.js"
import { applyAgentTeamsFixes, createClassBase, mpdDeltaFiles, reconstructCreateClassFile } from "../../../scripts/patch-agent-teams-fixes.mjs"

const here = dirname(fileURLToPath(import.meta.url))
const pluginRoot = join(here, "..")
const repoRoot = join(pluginRoot, "..", "..")
const bridgeRelative = "packages/mpd-agent-teams-plugin/lib/mpd-adapter-ctx.js"
const registryRelative = "packages/mpd-agent-teams-plugin/lib/mpd-deltas.js"
const otherRelative = "packages/mpd-agent-teams-plugin/lib/quality-gates.js"
const relativeOf = (name) => `packages/mpd-agent-teams-plugin/lib/${name}`

const sha256 = (text) => createHash("sha256").update(text).digest("hex")
const realText = (relative) => readFileSync(join(repoRoot, relative), "utf8")

// Pins captured BEFORE any arm runs: every scratch arm must leave the real tree untouched.
const REAL_PINS = { bridge: sha256(realText(bridgeRelative)), registry: sha256(realText(registryRelative)) }

/**
 * Every real lib file is staged, so `--write-registry` in the scratch tree is faithful (the
 * registry names 13 files; a missing one would now refuse by name instead of regenerating).
 */
const LIB_FILES = readdirSync(join(pluginRoot, "lib")).filter((name) => name.endsWith(".js"))

/** Copy the adopted lib + the applier CLI into a scratch root, so the real tree is never driven. */
function scratchRoot() {
    const root = mkdtempSync(join(tmpdir(), "mpd-t6-restore-"))
    mkdirSync(join(root, "packages/mpd-agent-teams-plugin/lib"), { recursive: true })
    mkdirSync(join(root, "scripts"), { recursive: true })
    for (const name of LIB_FILES)
        cpSync(join(pluginRoot, "lib", name), join(root, "packages/mpd-agent-teams-plugin/lib", name))
    cpSync(join(repoRoot, "scripts", "patch-agent-teams-fixes.mjs"), join(root, "scripts", "patch-agent-teams-fixes.mjs"))
    return root
}

const libPath = (root, relative) => join(root, relative)

/** Drive the REAL command-line entry point inside the scratch tree. */
function runCli(root, flag) {
    try {
        const out = execFileSync("node", [join(root, "scripts", "patch-agent-teams-fixes.mjs"), flag], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
        return { code: 0, output: String(out) }
    }
    catch (error) {
        return { code: error.status ?? 1, output: String(error.stdout ?? "") + String(error.stderr ?? "") }
    }
}

/** The bridge's single registry entry — the create predicate's entry count must be exactly 1. */
function bridgeEntry() {
    const entries = MPD_DELTAS.filter((delta) => delta.file === bridgeRelative)
    expect(entries.length).toBe(1)
    return entries[0]
}

test("AC8: --check on a MISSING lib/mpd-adapter-ctx.js FAILS LOUDLY by name — never a raw ENOENT", () => {
    const root = scratchRoot()
    try {
        rmSync(libPath(root, bridgeRelative))
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
    const root = scratchRoot()
    try {
        rmSync(libPath(root, bridgeRelative))
        const write = runCli(root, "--write")
        expect(write.code).toBe(0)
        expect(write.output).toContain("applied")
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
    const root = scratchRoot()
    try {
        rmSync(libPath(root, otherRelative))
        const check = runCli(root, "--check")
        expect(check.code).toBe(1)
        expect(check.output).toContain("quality-gates.js")
        expect(check.output).toContain("NOT a create-class file")
        expect(check.output).not.toContain("ENOENT")
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
    const root = scratchRoot()
    try {
        const staged = sha256(readFileSync(libPath(root, registryRelative), "utf8"))
        expect(staged).toBe(REAL_PINS.registry)
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
    const root = scratchRoot()
    try {
        // An EXTRA skeleton line above the leading comment: the shortest unique window no longer
        // reaches the file edge, so beforeContext + block + afterContext reconstructs it SHORT.
        const path = libPath(root, bridgeRelative)
        const lines = readFileSync(path, "utf8").split("\n")
        lines.splice(0, 0, "// an extra skeleton line the windows do not reach")
        writeFileSync(path, lines.join("\n"))
        const before = sha256(readFileSync(libPath(root, registryRelative), "utf8"))
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
    const root = scratchRoot()
    try {
        rmSync(libPath(root, bridgeRelative))
        const before = sha256(readFileSync(libPath(root, registryRelative), "utf8"))
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
    const root = scratchRoot()
    const entry = bridgeEntry()
    const savedBlock = entry.block
    try {
        rmSync(libPath(root, bridgeRelative))
        // Corrupt ONLY the in-memory entry — the real lib/mpd-deltas.js is never written: the
        // block loses its begin marker, so the created bytes cannot re-verify as a complete region.
        entry.block = ["// not-a-region-marker", ...savedBlock.split("\n").slice(1)].join("\n")
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
