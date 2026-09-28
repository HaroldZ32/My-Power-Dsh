// t13: the post-approval dispatch-stall fix lives in scheduler.js, which is adopted
// upstream main code (MIT). It must therefore be REGION-REGISTERED, so a re-vendor /
// re-materialize cannot silently drop it — and the drop must be LOUD, not a heal that
// re-inserts the region next to the restored upstream guard (where the old guard would
// run first and the defect would come back green).
//
// Two invariants are pinned here:
//   1. every dispatch edit sits INSIDE an `mpd-delta` region (nothing unmarked), and
//   2. the pre-fix shape is REFUSED byte-untouched by the applier, naming the region.
import { expect, test } from "bun:test"
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
import { applyAgentTeamsFixes } from "../../../scripts/patch-agent-teams-fixes.ts"
import { stageScript } from "./scratch-scripts.ts"

/** One registered mpd delta region as the derived registry reports it. */
interface DeltaEntry {
    /** Repository-relative path of the adopted file the region lives in. */
    readonly file: string
    /** The region's id, which the dispatch arms pin against. */
    readonly id: string
}

/** The vendored plugin's root directory, derived from this file's own URL. */
const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), "..")
/** The repository root, derived from the plugin root above. */
const repoRoot = join(pluginRoot, "..", "..")
/** The distinct `lib/` file names the delta registry covers, which the scratch tree must copy. */
const REGISTRY_FILES = [...new Set<string>(MPD_DELTAS.map((delta: DeltaEntry): string => delta.file.split("/").pop()!))]
/** The vendored scheduler module the region pins are read from. */
const SCHEDULER = join(pluginRoot, "lib", "scheduler.js")
/** The dispatch-stall regions this fix owns; every one must be registered. */
const DISPATCH_REGIONS = [
    "mpd-delta dispatch-decline-guard",
    "mpd-delta kick-team-decline-logs",
    "mpd-delta kick-member-decline-logs",
    "mpd-delta kick-member-locked-decline-logs",
    "mpd-delta idle-edge-no-team-log",
    "mpd-delta idle-edge-nonmember-log",
]
/** Every symbol this fix introduces: none of them may exist OUTSIDE a region. */
const FIX_TOKENS = ["noteDispatchDecline", "memberActivity", "dispatchDeclineNotes", "dispatch declined"]

/** Materialize a scratch tree holding the registered `lib/` files and the applier. */
function scratchRoot(): string {
/** The scratch root the copied tree lives under. */
    const root = mkdtempSync(join(tmpdir(), "mpd-t13-dispatch-"))
    mkdirSync(join(root, "packages/mpd-agent-teams-plugin/lib"), { recursive: true })
    mkdirSync(join(root, "scripts"), { recursive: true })
    for (const name of [...REGISTRY_FILES, "mpd-deltas.js"])
        cpSync(join(pluginRoot, "lib", name), join(root, "packages/mpd-agent-teams-plugin/lib", name))
    stageScript(root, "patch-agent-teams-fixes.ts")
    return root
}

/** The region id a marker line opens, or undefined for any other line. */
const regionIdAt = (line: string): string | undefined => /\/\/#region (mpd-delta [A-Za-z0-9-]+) \(/.exec(line)?.[1]

/** The file text with every region (markers AND bodies) removed. */
/** The file text with every region (markers AND bodies) removed. */
function stripAllRegions(text: string): string {
/** The subject's lines, walked once so a region body can be skipped wholesale. */
    const lines = text.split("\n")
/** The lines that survive outside every region, in source order. */
    const kept: string[] = []
    for (let index = 0; index < lines.length; index += 1) {
/** The region this line opens, or undefined when it opens none. */
        const id = regionIdAt(lines[index])
        if (id === undefined) {
            kept.push(lines[index])
            continue
        }
/** Offset of the matching end marker, searched only after the region's begin line. */
        const end = lines.findIndex((line: string, at: number) => at > index && line.trim() === `//#endregion ${id}`)
        if (end === -1) throw new Error(`fixture is malformed: unterminated region ${id}`)
        index = end
    }
    return kept.join("\n")
}

/** Strip ONE region by id. */
/** Strip ONE region by id, so a single delta can be removed while the rest stay canonical. */
function stripRegion(text: string, id: string): string {
/** The subject's lines, so the two markers can be located by index. */
    const lines = text.split("\n")
/** Offset of the region's begin marker. */
    const begin = lines.findIndex((line: string) => line.trim() === `//#region ${id} (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)`)
/** Offset of the region's end marker. */
    const end = lines.findIndex((line: string) => line.trim() === `//#endregion ${id}`)
    if (begin === -1 || end === -1) throw new Error(`fixture is malformed: region ${id} not found`)
    return [...lines.slice(0, begin), ...lines.slice(end + 1)].join("\n")
}

test("t13: every dispatch-stall edit is region-registered (nothing unmarked survives a strip)", () => {
/** The canonical scheduler source the strip arms read. */
    const source = readFileSync(SCHEDULER, "utf8")
/** The region ids the registry registers for the scheduler. */
    const registered = new Set(MPD_DELTAS.filter((delta: DeltaEntry) => delta.file.endsWith("lib/scheduler.js")).map((delta: DeltaEntry) => delta.id))
    for (const id of DISPATCH_REGIONS)
        expect(registered.has(id), `${id} is missing from lib/mpd-deltas.js`).toBe(true)
/** The scheduler with every region removed, which no fix token may survive. */
    const skeleton = stripAllRegions(source)
    for (const token of FIX_TOKENS)
        expect(skeleton.includes(token), `${token} exists OUTSIDE every region: a re-vendor would drop it silently`).toBe(false)
    // The upstream guard the fix replaces is gone from the skeleton only because it was
    // REPLACED inside a region — i.e. the canonical file must not still declare it.
    expect(skeleton.includes("isMemberAvailable")).toBe(false)
})

test("t13: a re-materialized scheduler.js (upstream guard restored) is REFUSED byte-untouched", () => {
/** The scratch root this arm re-materializes into. */
    const root = scratchRoot()
    try {
/** The scratch copy of the scheduler the upstream guard is restored into. */
        const path = join(root, "packages/mpd-agent-teams-plugin/lib", "scheduler.js")
/** The canonical scheduler bytes, which the reconstruction must differ from. */
        const canonical = readFileSync(path, "utf8")
        // Reconstruct the pre-fix shape: our guard region removed, the upstream
        // `isMemberAvailable` restored in its place (exactly what `vendor-agent-teams.mjs`
        // produces when it re-materializes upstream over our tree).
/** The canonical source with our guard region stripped out. */
        const withoutGuard = stripRegion(canonical, "mpd-delta dispatch-decline-guard")
/** The upstream guard body, restored exactly where the region used to be. */
        const upstreamGuard = [
            "function isMemberAvailable(ctx, member) {",
            "    const live = liveMember(ctx, member);",
            "    return live === undefined || live.status === 'idle';",
            "}",
        ].join("\n")
/** The re-materialized shape: the upstream guard back, our region gone. */
        const reMaterialized = withoutGuard.replace("function ownedOpenTask(tasks, memberName) {", `${upstreamGuard}\nfunction ownedOpenTask(tasks, memberName) {`)
        expect(reMaterialized).not.toBe(canonical)
        expect(reMaterialized).toContain(upstreamGuard)
        writeFileSync(path, reMaterialized)

/** The refusal text the applier produced, or the empty string when it did not refuse. */
        let message = ""
        try {
            applyAgentTeamsFixes({ root, write: true })
        }
        catch (error) {
            // The thrown value is unknowable from a JS throw site, so the message is read through Error.
            message = String((error as Error).message)
        }
        expect(message).toMatch(/mpd-delta dispatch-decline-guard/)
        expect(message).toContain("never guesses an insertion site")
        expect(readFileSync(path, "utf8")).toBe(reMaterialized)
    }
    finally {
        rmSync(root, { recursive: true, force: true })
    }
})

test("t13: stripping every scheduler.js region heals byte-for-byte back to the canonical file", () => {
/** The scratch root this healing arm materializes into. */
    const root = scratchRoot()
    try {
/** The scratch copy of the scheduler shell. */
        const path = join(root, "packages/mpd-agent-teams-plugin/lib", "scheduler.js")
/** The scratch scheduler's bytes before the strip, which the heal must reproduce. */
        const canonical = readFileSync(path, "utf8")
/** The scheduler with every region stripped, which the applier must heal. */
        const stripped = stripAllRegions(canonical)
        expect(stripped).not.toBe(canonical)
        writeFileSync(path, stripped)
/** The applier's report for the stripped file. */
        const healed = applyAgentTeamsFixes({ root, write: true })
        expect(healed.status).toBe("applied")
        expect(readFileSync(path, "utf8")).toBe(canonical)
        expect(applyAgentTeamsFixes({ root, write: false }).status).toBe("already-applied")
    }
    finally {
        rmSync(root, { recursive: true, force: true })
    }
})
