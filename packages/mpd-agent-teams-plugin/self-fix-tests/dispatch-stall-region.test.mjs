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
import { MPD_DELTAS } from "../lib/mpd-deltas.js"
import { applyAgentTeamsFixes } from "../../../scripts/patch-agent-teams-fixes.mjs"

const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), "..")
const repoRoot = join(pluginRoot, "..", "..")
const REGISTRY_FILES = [...new Set(MPD_DELTAS.map((delta) => delta.file.split("/").pop()))]
const SCHEDULER = join(pluginRoot, "lib", "scheduler.js")
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

function scratchRoot() {
    const root = mkdtempSync(join(tmpdir(), "mpd-t13-dispatch-"))
    mkdirSync(join(root, "packages/mpd-agent-teams-plugin/lib"), { recursive: true })
    mkdirSync(join(root, "scripts"), { recursive: true })
    for (const name of [...REGISTRY_FILES, "mpd-deltas.js"])
        cpSync(join(pluginRoot, "lib", name), join(root, "packages/mpd-agent-teams-plugin/lib", name))
    cpSync(join(repoRoot, "scripts", "patch-agent-teams-fixes.mjs"), join(root, "scripts", "patch-agent-teams-fixes.mjs"))
    return root
}

const regionIdAt = (line) => /\/\/#region (mpd-delta [A-Za-z0-9-]+) \(/.exec(line)?.[1]

/** The file text with every region (markers AND bodies) removed. */
function stripAllRegions(text) {
    const lines = text.split("\n")
    const kept = []
    for (let index = 0; index < lines.length; index += 1) {
        const id = regionIdAt(lines[index])
        if (id === undefined) {
            kept.push(lines[index])
            continue
        }
        const end = lines.findIndex((line, at) => at > index && line.trim() === `//#endregion ${id}`)
        if (end === -1) throw new Error(`fixture is malformed: unterminated region ${id}`)
        index = end
    }
    return kept.join("\n")
}

/** Strip ONE region by id. */
function stripRegion(text, id) {
    const lines = text.split("\n")
    const begin = lines.findIndex((line) => line.trim() === `//#region ${id} (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)`)
    const end = lines.findIndex((line) => line.trim() === `//#endregion ${id}`)
    if (begin === -1 || end === -1) throw new Error(`fixture is malformed: region ${id} not found`)
    return [...lines.slice(0, begin), ...lines.slice(end + 1)].join("\n")
}

test("t13: every dispatch-stall edit is region-registered (nothing unmarked survives a strip)", () => {
    const source = readFileSync(SCHEDULER, "utf8")
    const registered = new Set(MPD_DELTAS.filter((delta) => delta.file.endsWith("lib/scheduler.js")).map((delta) => delta.id))
    for (const id of DISPATCH_REGIONS)
        expect(registered.has(id), `${id} is missing from lib/mpd-deltas.js`).toBe(true)
    const skeleton = stripAllRegions(source)
    for (const token of FIX_TOKENS)
        expect(skeleton.includes(token), `${token} exists OUTSIDE every region: a re-vendor would drop it silently`).toBe(false)
    // The upstream guard the fix replaces is gone from the skeleton only because it was
    // REPLACED inside a region — i.e. the canonical file must not still declare it.
    expect(skeleton.includes("isMemberAvailable")).toBe(false)
})

test("t13: a re-materialized scheduler.js (upstream guard restored) is REFUSED byte-untouched", () => {
    const root = scratchRoot()
    try {
        const path = join(root, "packages/mpd-agent-teams-plugin/lib", "scheduler.js")
        const canonical = readFileSync(path, "utf8")
        // Reconstruct the pre-fix shape: our guard region removed, the upstream
        // `isMemberAvailable` restored in its place (exactly what `vendor-agent-teams.mjs`
        // produces when it re-materializes upstream over our tree).
        const withoutGuard = stripRegion(canonical, "mpd-delta dispatch-decline-guard")
        const upstreamGuard = [
            "function isMemberAvailable(ctx, member) {",
            "    const live = liveMember(ctx, member);",
            "    return live === undefined || live.status === 'idle';",
            "}",
        ].join("\n")
        const reMaterialized = withoutGuard.replace("function ownedOpenTask(tasks, memberName) {", `${upstreamGuard}\nfunction ownedOpenTask(tasks, memberName) {`)
        expect(reMaterialized).not.toBe(canonical)
        expect(reMaterialized).toContain(upstreamGuard)
        writeFileSync(path, reMaterialized)

        let message = ""
        try {
            applyAgentTeamsFixes({ root, write: true })
        }
        catch (error) {
            message = String(error.message)
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
    const root = scratchRoot()
    try {
        const path = join(root, "packages/mpd-agent-teams-plugin/lib", "scheduler.js")
        const canonical = readFileSync(path, "utf8")
        const stripped = stripAllRegions(canonical)
        expect(stripped).not.toBe(canonical)
        writeFileSync(path, stripped)
        const healed = applyAgentTeamsFixes({ root, write: true })
        expect(healed.status).toBe("applied")
        expect(readFileSync(path, "utf8")).toBe(canonical)
        expect(applyAgentTeamsFixes({ root, write: false }).status).toBe("already-applied")
    }
    finally {
        rmSync(root, { recursive: true, force: true })
    }
})
