// Scratch reproduction for the bridge lane's strip->heal experiment (owner: Senior Engineer, t5).
// Not a gate: it exercises the SAME scratch-root method registry-context-heal.test.mjs uses, so a
// candidate region layout can be iterated without running the whole suite.
// Run: node evidence/agent-teams/adapter-wiring/bridge/heal-probe.mjs [file.js ...]
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { MPD_DELTAS } from "../../../../packages/mpd-agent-teams-plugin/lib/mpd-deltas.ts"
import { applyAgentTeamsFixes } from "../../../../scripts/patch-agent-teams-fixes.ts"

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, "..", "..", "..", "..")
const pluginRoot = join(repoRoot, "packages", "mpd-agent-teams-plugin")
const LIB_FILES = [...new Set([...MPD_DELTAS.map((delta) => delta.file.split("/").pop()), "mpd-deltas.js"])]

function scratchRoot() {
    const root = mkdtempSync(join(tmpdir(), "mpd-bridge-heal-"))
    mkdirSync(join(root, "packages/mpd-agent-teams-plugin/lib"), { recursive: true })
    mkdirSync(join(root, "scripts"), { recursive: true })
    for (const file of LIB_FILES) cpSync(join(pluginRoot, "lib", file), join(root, "packages/mpd-agent-teams-plugin/lib", file))
    cpSync(join(repoRoot, "scripts", "patch-agent-teams-fixes.mjs"), join(root, "scripts", "patch-agent-teams-fixes.mjs"))
    return root
}

const libPath = (root, name) => join(root, "packages/mpd-agent-teams-plugin/lib", name)

function stripAllRegions(file) {
    const source = readFileSync(file, "utf8").split("\n")
    const kept = []
    for (let index = 0; index < source.length; index += 1) {
        const id = /\/\/#region (mpd-delta [A-Za-z0-9-]+) \(/.exec(source[index])?.[1]
        if (id === undefined) {
            kept.push(source[index])
            continue
        }
        const end = source.findIndex((line, at) => at > index && line.trim() === `//#endregion ${id}`)
        if (end === -1) throw new Error(`malformed fixture: unterminated region ${id}`)
        index = end
    }
    writeFileSync(file, kept.join("\n"))
}

const targets = process.argv.slice(2).length > 0 ? process.argv.slice(2) : LIB_FILES.filter((name) => name !== "mpd-deltas.js")
let failures = 0
for (const name of targets) {
    const root = scratchRoot()
    try {
        const canonical = readFileSync(join(pluginRoot, "lib", name), "utf8")
        stripAllRegions(libPath(root, name))
        try {
            const result = applyAgentTeamsFixes({ root, write: true })
            const healed = readFileSync(libPath(root, name), "utf8")
            const ok = healed === canonical
            if (!ok) {
                failures += 1
                const a = canonical.split("\n")
                const b = healed.split("\n")
                const at = a.findIndex((line, index) => line !== b[index])
                console.log(`FAIL ${name}: byte difference at line ${at + 1} (${result.status})`)
                console.log(`  canonical: ${JSON.stringify(a[at])}`)
                console.log(`  healed   : ${JSON.stringify(b[at])}`)
            }
            else console.log(`ok   ${name}: strip-heal byte-identical (${result.regions} regions)`)
        }
        catch (error) {
            failures += 1
            console.log(`FAIL ${name}: ${String(error.message)}`)
        }
    }
    finally {
        rmSync(root, { recursive: true, force: true })
    }
}
process.exit(failures === 0 ? 0 : 1)
