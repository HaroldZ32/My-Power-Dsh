#!/usr/bin/env node
// t5 INDEPENDENT verification driver 2/5 — the marker prefix-ambiguity fix.
//
// Three delta ids are PREFIXES of a sibling id (`scope-overlap` ⊂ `scope-overlap-normalize`,
// `repair-scope` ⊂ `repair-scope-fields`, `task-contract` ⊂ `task-contract-render`), and the
// END marker of the inner id CONTAINS the outer id's end marker as a substring. A substring
// search therefore resolves the OUTER id's end marker to the INNER id's end line — the wave-2
// misdiagnosis (`half-open marker pair`) or a bogus span. This driver checks, from this file's
// own runs: (1) the collision is real in the canonical files, (2) the whole-line rule the
// registry now uses resolves every intact region to its OWN marker pair, (3) a partial strip of
// every colliding pair in BOTH dangling shapes is reported as a healable MISSING region (never
// `half-open`) and heals byte-identically, and (4) a genuinely inverted pair still raises the
// half-open refusal.
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, "..", "..", "..", "..", "..")
const EVIDENCE = resolve(HERE, "..")
if (!existsSync(join(REPO, "package.json")))
    throw new Error(`repo root did not resolve from ${HERE}: ${REPO}`)

const { applyAgentTeamsFixes, findRegion } = await import(pathToFileURL(join(REPO, "scripts", "patch-agent-teams-fixes.mjs")).href)
const sha256 = (text) => createHash("sha256").update(text).digest("hex")
const LIB_REL = "packages/mpd-agent-teams-plugin/lib"
const canonicalOf = (name) => readFileSync(join(REPO, LIB_REL, name), "utf8")

const PAIRS = [
    { outer: "mpd-delta scope-overlap", inner: "mpd-delta scope-overlap-normalize", file: "quality-gates.js" },
    { outer: "mpd-delta repair-scope", inner: "mpd-delta repair-scope-fields", file: "quality-gates.js" },
    { outer: "mpd-delta task-contract", inner: "mpd-delta task-contract-render", file: "tools.js" },
]

const beginText = (id) => `//#region ${id} (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)`
const endText = (id) => `//#endregion ${id}`

/** Independent whole-line oracle (this driver's own scan, not the guard's helper). */
function ownSpan(lines, id) {
    return {
        begin: lines.findIndex((line) => line.trim() === beginText(id)),
        end: lines.findIndex((line) => line.trim() === endText(id)),
    }
}

/** The pre-fix substring rule, re-created here only to show the collision is real. */
function substringSpan(lines, id) {
    return {
        begin: lines.findIndex((line) => line.includes(beginText(id))),
        end: lines.findIndex((line) => line.includes(endText(id))),
    }
}

/** The applier processes every registered file, so the untouched sibling ships canonical. */
function scratchRoot(name, text) {
    const root = mkdtempSync(join(tmpdir(), "mpd-t5-marker-"))
    mkdirSync(join(root, LIB_REL), { recursive: true })
    for (const sibling of ["quality-gates.js", "tools.js"])
        writeFileSync(join(root, LIB_REL, sibling), sibling === name ? text : canonicalOf(sibling))
    return root
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

const results = []
const record = (entry) => { results.push(entry); console.log(JSON.stringify(entry)); return entry }

// ---------- 1. the collision is real, and the whole-line rule resolves each intact region ----------
{
    const perFile = {}
    for (const { outer, inner, file } of PAIRS) {
        const lines = canonicalOf(file).split("\n")
        if (perFile[file] === undefined) perFile[file] = lines
        const outerOwn = ownSpan(lines, outer)
        const innerOwn = ownSpan(lines, inner)
        const outerSub = substringSpan(lines, outer)
        const outerResolved = findRegion(lines, outer)
        record({
            scenario: "intact-collision",
            file,
            outer,
            inner,
            outerOwn,
            innerOwn,
            substring: { ...outerSub, resolvesToInnerEnd: outerSub.end === innerOwn.end && innerOwn.end !== outerOwn.end },
            wholeLineRule: outerResolved,
            innerContainsOuterEnd: lines[innerOwn.end].includes(endText(outer)),
            passed: outerOwn.begin > -1 && outerOwn.end > -1 && innerOwn.begin > -1 && innerOwn.end > -1
                && lines[innerOwn.end].includes(endText(outer))
                && outerResolved.begin === outerOwn.begin && outerResolved.end === outerOwn.end
                && outerResolved.end !== innerOwn.end
                && findRegion(lines, inner).begin === innerOwn.begin && findRegion(lines, inner).end === innerOwn.end,
        })
    }
}

// ---------- 2. partial strips of every colliding pair, both dangling shapes ----------
for (const { outer, inner, file } of PAIRS) {
    for (const shape of ["begin", "end"]) {
        const lines = canonicalOf(file).split("\n")
        const own = ownSpan(lines, outer)
        const innerOwn = ownSpan(lines, inner)
        const removeAt = shape === "begin" ? own.begin : own.end
        const edited = [...lines.slice(0, removeAt), ...lines.slice(removeAt + 1)]
        const root = scratchRoot(file, edited.join("\n"))
        try {
            const resolved = findRegion(edited, outer)
            const substringOnEdited = substringSpan(edited, outer)
            const innerAfter = ownSpan(edited, inner)
            const liveness = shape === "end"
                ? { substringEndResolvesToInnerEnd: substringOnEdited.end === innerAfter.end && substringOnEdited.end !== own.end }
                : { substringBeginUnresolved: substringOnEdited.begin === -1, substringEndIsOuterOwn: substringOnEdited.end === own.end - 1 }
            const message = healError(root, false)
            const before = readFileSync(join(root, LIB_REL, file), "utf8")
            const healed = applyAgentTeamsFixes({ root, write: true })
            const after = readFileSync(join(root, LIB_REL, file), "utf8")
            record({
                scenario: `partial-strip-${shape}`,
                file,
                outer,
                removedLine: shape === "begin" ? beginText(outer) : endText(outer),
                removedAtLine: removeAt + 1,
                resolved,
                substringOnEdited: { ...substringOnEdited, ...liveness },
                verifyOnlyMessage: message,
                heal: { status: healed.status, inserted: healed.inserted },
                byteIdentical: after === canonicalOf(file),
                canonicalSha: sha256(canonicalOf(file)),
                healedSha: sha256(after),
                passed: resolved.orphan === shape
                    && Object.values(liveness).every((value) => value === true)
                    && message.includes("MISSING from")
                    && !message.includes("half-open")
                    && healed.status === "applied"
                    && healed.inserted.includes(outer)
                    && after === canonicalOf(file)
                    && before !== after,
            })
        }
        finally {
            rmSync(root, { recursive: true, force: true })
        }
    }
}

// ---------- 3. negative control: a genuinely inverted pair must still refuse as half-open ----------
for (const { outer, file } of PAIRS) {
    const lines = canonicalOf(file).split("\n")
    const inverted = [endText(outer), ...lines]
    let message = ""
    try {
        findRegion(inverted, outer)
    }
    catch (error) {
        message = String(error.message)
    }
    record({
        scenario: "inverted-pair-negative-control",
        file,
        outer,
        refusalMessage: message,
        passed: message.includes("half-open") && message.includes(outer),
    })
}

const summary = {
    driver: "marker-fixtures",
    repo: REPO,
    measuredAt: new Date().toISOString(),
    canonicalSha: Object.fromEntries(["quality-gates.js", "tools.js"].map((name) => [name, sha256(canonicalOf(name))])),
    results,
    passed: results.every((entry) => entry.passed),
}
writeFileSync(join(EVIDENCE, "drivers", "marker-fixtures.result.json"), JSON.stringify(summary, null, 2) + "\n")
console.log(`[marker-fixtures] ${summary.passed ? "PASS" : "FAIL"} (${results.filter((entry) => entry.passed).length}/${results.length} checks)`)
process.exit(summary.passed ? 0 : 1)
