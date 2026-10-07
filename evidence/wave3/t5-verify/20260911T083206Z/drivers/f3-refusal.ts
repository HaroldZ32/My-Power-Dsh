#!/usr/bin/env node
// t5 INDEPENDENT verification driver 5a/5 — the F3 guarantee (no redefinition) must still
// refuse, name the symbol and line, exit non-zero, and leave the refused file byte-identical.
//
// Four legs, all driven through the real CLI in throw-away repo layouts:
//   A. re-materialize shape: a region's MARKERS are gone while its OLD body stays -> the heal
//      refuses to insert a second copy and names the symbol + line (`--write`).
//   B. the same fixture in verify-only mode -> refuses as MISSING (the F3 duplicate analysis
//      belongs to the heal path; the vendor pipeline uses --write).
//   C. the region is INTACT but the file still declares one of its names outside it -> the
//      post-heal validation refuses and names the symbol + the outside line(s).
//   D. control: a plain stripped fixture heals green, so the refusal legs are not "always red".
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

const BEGIN = /^[ \t]*\/\/#region (mpd-delta [A-Za-z0-9-]+) \(/
const END = (id) => `//#endregion ${id}`

/** Drop ONLY the marker lines of `id`, keeping the body: the duplicate-declaration fixture. */
function unmark(text, id) {
    const lines = text.split("\n")
    const begin = lines.findIndex((line) => BEGIN.exec(line)?.[1] === id)
    if (begin === -1) throw new Error(`fixture: region ${id} not found`)
    const end = lines.findIndex((line, at) => at > begin && line.trim() === END(id))
    if (end === -1) throw new Error(`fixture: region ${id} unterminated`)
    return [...lines.slice(0, begin), ...lines.slice(begin + 1, end), ...lines.slice(end + 1)].join("\n")
}

/** Remove every region (markers + body) — the control fixture that must heal green. */
function stripAll(text) {
    const lines = text.split("\n")
    const out = []
    for (let at = 0; at < lines.length; at += 1) {
        const id = BEGIN.exec(lines[at])?.[1]
        if (id === undefined) { out.push(lines[at]); continue }
        const end = lines.findIndex((line, scan) => scan > at && line.trim() === END(id))
        if (end === -1) throw new Error(`fixture: region ${id} unterminated`)
        at = end
    }
    return out.join("\n")
}

function cliRepo(files) {
    const root = mkdtempSync(join(tmpdir(), "mpd-t5-f3-"))
    mkdirSync(join(root, "scripts"), { recursive: true })
    mkdirSync(join(root, LIB_REL), { recursive: true })
    cpSync(join(REPO, "scripts", "patch-agent-teams-fixes.mjs"), join(root, "scripts", "patch-agent-teams-fixes.mjs"))
    cpSync(join(REPO, LIB_REL, "mpd-deltas.js"), join(root, LIB_REL, "mpd-deltas.js"))
    for (const [name, text] of Object.entries(files)) writeFileSync(join(root, LIB_REL, name), text)
    return root
}

function runCli(root, args) {
    try {
        const stdout = execFileSync(process.execPath, [join(root, "scripts", "patch-agent-teams-fixes.mjs"), ...args], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
        return { exit: 0, stdout: stdout.trim(), stderr: "" }
    }
    catch (error) {
        return { exit: error.status ?? -1, stdout: String(error.stdout ?? "").trim(), stderr: String(error.stderr ?? "").trim() }
    }
}

const results = []
const record = (entry) => { results.push(entry); console.log(JSON.stringify(entry)); return entry }
const canonical = Object.fromEntries(["quality-gates.js", "tools.js"].map((name) => [name, readFileSync(join(REPO, LIB_REL, name), "utf8")]))

/** Run one leg: fixture files, CLI args, and the expected refusal/acceptance shape. */
function leg(name, files, args, judge) {
    const root = cliRepo(files)
    try {
        const before = Object.fromEntries(Object.keys(files).map((file) => [file, sha256(readFileSync(join(root, LIB_REL, file), "utf8"))]))
        const run = runCli(root, args)
        const after = Object.fromEntries(Object.keys(files).map((file) => [file, sha256(readFileSync(join(root, LIB_REL, file), "utf8"))]))
        const message = `${run.stdout}\n${run.stderr}`
        const unchanged = Object.keys(files).every((file) => before[file] === after[file])
        record({ leg: name, args, exit: run.exit, message, byteIdenticalToInput: unchanged, ...judge(run, message, unchanged, root) })
    }
    finally {
        rmSync(root, { recursive: true, force: true })
    }
}

// A. re-materialized OLD body, heal path -> F3 refusal with symbol + line
leg("A-write-unmarked-body", { "quality-gates.js": unmark(canonical["quality-gates.js"], "mpd-delta scope-glob"), "tools.js": canonical["tools.js"] }, ["--write"],
    (run, message, unchanged) => ({
        expects: "exit 1, refusing to heal, names pathMatchesScope + a line, input untouched",
        passed: run.exit === 1 && message.includes("refusing to heal delta") && message.includes("pathMatchesScope") && /line \d+/.test(message) && unchanged,
    }))

// B. same fixture, verify-only -> MISSING refusal (the F3 duplicate analysis is a heal-path guard)
leg("B-check-unmarked-body", { "quality-gates.js": unmark(canonical["quality-gates.js"], "mpd-delta scope-glob"), "tools.js": canonical["tools.js"] }, ["--check"],
    (run, message, unchanged) => ({
        expects: "exit 1, MISSING refusal, input untouched",
        passed: run.exit === 1 && message.includes("is MISSING from") && unchanged,
    }))

// C. region INTACT + the file still declares one of its names outside it -> post-heal validation
const duplicate = `export function pathMatchesScope(path, pattern) { return false }\n` + canonical["quality-gates.js"]
leg("C-write-duplicate-declaration", { "quality-gates.js": duplicate, "tools.js": canonical["tools.js"] }, ["--write"],
    (run, message, unchanged) => ({
        expects: "exit 1, post-heal validation names pathMatchesScope + the outside line, input untouched",
        passed: run.exit === 1 && message.includes("post-heal validation") && message.includes("pathMatchesScope") && /line\(s\) 1\b/.test(message) && unchanged,
    }))

// D. control: a fully stripped file heals green (the refusal legs above are not trivially red)
leg("D-write-control-stripped", { "quality-gates.js": stripAll(canonical["quality-gates.js"]), "tools.js": stripAll(canonical["tools.js"]) }, ["--write"],
    (run, message, unchanged, root) => {
        const healed = Object.fromEntries(Object.keys(canonical).map((name) => [name, readFileSync(join(root, LIB_REL, name), "utf8")]))
        return {
            expects: "exit 0, byte-identical heal from the same fixture family",
            passed: run.exit === 0 && Object.keys(canonical).every((name) => healed[name] === canonical[name]),
        }
    })

const summary = {
    driver: "f3-refusal",
    repo: REPO,
    measuredAt: new Date().toISOString(),
    fixture: { canonicalSha: Object.fromEntries(Object.entries(canonical).map(([name, text]) => [name, sha256(text)])) },
    results,
    passed: results.every((entry) => entry.passed),
}
writeFileSync(join(EVIDENCE, "drivers", "f3-refusal.result.json"), JSON.stringify(summary, null, 2) + "\n")
console.log(`[f3-refusal] ${summary.passed ? "PASS" : "FAIL"} (${results.filter((entry) => entry.passed).length}/${results.length} legs)`)
process.exit(summary.passed ? 0 : 1)
