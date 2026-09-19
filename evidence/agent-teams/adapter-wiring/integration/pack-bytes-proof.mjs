// Integration lane (t10 / contract lane t8) — the PACK-BYTES PROOF.
//
// AC14's second and third clauses are not "the packer exited 0": they are byte identities between
// the SHIPPED tree and the repo tree. This script computes them, and goes one step wider than the
// acceptance asks (every adopted `lib/**` file and every `packages/*/dist/**` entry) so a dropped
// or stale sibling is visible rather than merely "not checked".
//
// Run from the repo root: node evidence/agent-teams/adapter-wiring/integration/pack-bytes-proof.mjs
import { createHash } from "node:crypto"
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs"
import { join, relative } from "node:path"

const ROOT = process.cwd()
const PACK = join(ROOT, "dist/mpd-package")
const sha = (path) => createHash("sha256").update(readFileSync(path)).digest("hex")
const walk = (dir, base = dir, out = []) => {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry)
        if (statSync(full).isDirectory()) walk(full, base, out)
        else out.push(relative(base, full))
    }
    return out
}
const run = (label, pairs) => {
    let same = 0
    const diffs = []
    const missing = []
    for (const rel of pairs) {
        const repo = join(ROOT, rel)
        const packed = join(PACK, rel)
        if (!existsSync(packed)) { missing.push(rel); continue }
        if (sha(repo) === sha(packed)) same += 1
        else diffs.push(rel)
    }
    console.log(`[${label}] compared ${pairs.length} · identical ${same} · differing ${diffs.length} · missing-from-pack ${missing.length}`)
    for (const rel of missing) console.log(`  MISSING: ${rel}`)
    for (const rel of diffs) console.log(`  DIFFERS: ${rel}`)
    return { label, compared: pairs.length, identical: same, differing: diffs, missing }
}

console.log(`pack root: ${PACK}`)
console.log(`read at (UTC): ${new Date().toISOString()}`)

// 1. THE BRIDGE (the file a pack must never drop).
const bridge = "packages/mpd-agent-teams-plugin/lib/mpd-adapter-ctx.js"
const bridgeSha = existsSync(join(PACK, bridge)) ? sha(join(PACK, bridge)) : null
console.log(`bridge repo sha256   = ${sha(join(ROOT, bridge))}`)
console.log(`bridge packed sha256 = ${bridgeSha}`)
console.log(`bridge identical     = ${bridgeSha === sha(join(ROOT, bridge))}`)

// 2. THE SIX BRIDGED ADOPTED FILES.
const SIX = ["index.js", "capabilities.js", "harness-compat.js", "members.js", "command.js", "tools.js"]
    .map((name) => `packages/mpd-agent-teams-plugin/lib/${name}`)
run("six bridged adopted files", SIX)

// 3. THE WHOLE ADOPTED lib/ (broader than required: a dropped sibling is visible too).
const libDir = join(ROOT, "packages/mpd-agent-teams-plugin/lib")
run("adopted lib/** (all files)", walk(libDir).map((rel) => `packages/mpd-agent-teams-plugin/lib/${rel}`))

// 4. THE REBUILT ADAPTER dist (acceptance clause 3) + every other package dist.
const adapterDist = "packages/mpd-dsh-adapter-plugin/dist/index.js"
console.log(`adapter dist repo sha256   = ${sha(join(ROOT, adapterDist))}`)
console.log(`adapter dist packed sha256 = ${sha(join(PACK, adapterDist))}`)
run("all packages/*/dist/**", walk(join(ROOT, "packages"))
    .filter((rel) => /(^|\/)dist(\/|$)/.test(rel) && rel.endsWith(".js"))
    .map((rel) => `packages/${rel}`))

// 5. THE DOCS THE WAVE CHANGED (a pack that shipped stale docs would misstate the closure).
run("wave-touched docs + registry", [
    "AGENTS.md",
    "docs/design.md",
    "docs/design.zh-CN.md",
    "agent-references/agent-teams-deltas.md",
    "packages/mpd-dsh-adapter-plugin/README.md",
    "packages/mpd-dsh-adapter-plugin/README.zh-CN.md",
])
