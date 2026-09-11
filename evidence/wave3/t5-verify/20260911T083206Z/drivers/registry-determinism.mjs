#!/usr/bin/env node
// t5 INDEPENDENT verification driver 4b — the registry in the tree must be EXACTLY what the
// current adopted files generate, and generation must be deterministic. Run in a throw-away
// repo layout: `--write-registry` twice, byte-compare both outputs with the committed registry.
// A hand-edited or drifted registry fails here even when `--check` passes.
import { createHash } from "node:crypto"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { execFileSync } from "node:child_process"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, "..", "..", "..", "..", "..")
const EVIDENCE = resolve(HERE, "..")
const LIB_REL = "packages/mpd-agent-teams-plugin/lib"
const sha256 = (text) => createHash("sha256").update(text).digest("hex")

const root = mkdtempSync(join(tmpdir(), "mpd-t5-registry-"))
try {
    mkdirSync(join(root, "scripts"), { recursive: true })
    mkdirSync(join(root, LIB_REL), { recursive: true })
    cpSync(join(REPO, "scripts", "patch-agent-teams-fixes.mjs"), join(root, "scripts", "patch-agent-teams-fixes.mjs"))
    for (const file of ["tools.js", "quality-gates.js", "mpd-deltas.js"])
        cpSync(join(REPO, LIB_REL, file), join(root, LIB_REL, file))
    const registryPath = join(root, LIB_REL, "mpd-deltas.js")
    const committed = readFileSync(join(REPO, LIB_REL, "mpd-deltas.js"), "utf8")
    const outputs = []
    for (let round = 1; round <= 2; round += 1) {
        const stdout = execFileSync(process.execPath, [join(root, "scripts", "patch-agent-teams-fixes.mjs"), "--write-registry"], { cwd: root, encoding: "utf8" }).trim()
        const text = readFileSync(registryPath, "utf8")
        outputs.push({ round, stdout, sha256: sha256(text), byteIdenticalToCommitted: text === committed })
    }
    const check = execFileSync(process.execPath, [join(root, "scripts", "patch-agent-teams-fixes.mjs"), "--check"], { cwd: root, encoding: "utf8" }).trim()
    const summary = {
        driver: "registry-determinism",
        repo: REPO,
        measuredAt: new Date().toISOString(),
        committedRegistrySha: sha256(committed),
        committedHasAnchorFields: /anchor(Occurrence|Marker)?:/.test(committed),
        rounds: outputs,
        checkAfterRegeneration: check,
        passed: outputs.every((round) => round.byteIdenticalToCommitted)
            && outputs[0].sha256 === outputs[1].sha256
            && !/anchor(Occurrence|Marker)?:/.test(committed)
            && check.includes("already applied"),
    }
    writeFileSync(join(EVIDENCE, "drivers", "registry-determinism.result.json"), JSON.stringify(summary, null, 2) + "\n")
    console.log(JSON.stringify(summary))
    process.exit(summary.passed ? 0 : 1)
}
finally {
    rmSync(root, { recursive: true, force: true })
}
