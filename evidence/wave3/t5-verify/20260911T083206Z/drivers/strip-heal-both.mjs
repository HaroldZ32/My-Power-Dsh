#!/usr/bin/env node
// t5 INDEPENDENT verification driver 1/5 — the DECISIVE scenario the task names:
// strip BOTH adopted files from the SAME state, heal once, and byte-compare each
// against canonical. Wave 2 healed tools.js correctly when it was stripped ALONE and
// wrongly when BOTH were stripped (60 diff lines, task-contract re-inserted at 1970 vs
// canonical 1733), so the single-file green run is not evidence and is only kept here as
// a control.
//
// Everything below is re-derived here: the strip is implemented in this file, the
// comparison is a byte compare + sha256 + `git diff --no-index --numstat`, and the CLI
// path is exercised in a throw-away repo layout so the real files are never touched.
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, "..", "..", "..", "..", "..")
const EVIDENCE = resolve(HERE, "..")
if (!existsSync(join(REPO, "package.json")))
    throw new Error(`repo root did not resolve from ${HERE}: ${REPO}`)

const { applyAgentTeamsFixes } = await import(pathToFileURL(join(REPO, "scripts", "patch-agent-teams-fixes.mjs")).href)
const { MPD_DELTAS } = await import(pathToFileURL(join(REPO, "packages", "mpd-agent-teams-plugin", "lib", "mpd-deltas.js")).href)

const LIB_REL = "packages/mpd-agent-teams-plugin/lib"
const ADOPTED = ["tools.js", "quality-gates.js"]
const sha256 = (text) => createHash("sha256").update(text).digest("hex")
const canonical = Object.fromEntries(ADOPTED.map((name) => [name, readFileSync(join(REPO, LIB_REL, name), "utf8")]))
const registrySha = sha256(readFileSync(join(REPO, LIB_REL, "mpd-deltas.js"), "utf8"))

const BEGIN = /^[ \t]*\/\/#region (mpd-delta [A-Za-z0-9-]+) \(/

/** Remove every region of `ids` (all when ids is undefined); independent implementation. */
function stripRegions(text, ids) {
    const lines = text.split("\n")
    const out = []
    let removed = 0
    const stripped = []
    for (let at = 0; at < lines.length; at += 1) {
        const match = BEGIN.exec(lines[at])
        if (match === null) {
            out.push(lines[at])
            continue
        }
        const id = match[1]
        let end = -1
        for (let scan = at + 1; scan < lines.length; scan += 1)
            if (lines[scan].trim() === `//#endregion ${id}`) { end = scan; break }
        if (end === -1) throw new Error(`unterminated region ${id}`)
        if (ids === undefined || ids.has(id)) {
            removed += end - at + 1
            stripped.push(id)
            at = end
            continue
        }
        for (let copy = at; copy <= end; copy += 1) out.push(lines[copy])
        at = end
    }
    return { text: out.join("\n"), removed, stripped }
}

/** Line-level diff size between two strings, measured by the diff binary. */
function diffStat(left, right) {
    const dir = mkdtempSync(join(tmpdir(), "mpd-t5-diff-"))
    try {
        const a = join(dir, "a")
        const b = join(dir, "b")
        writeFileSync(a, left)
        writeFileSync(b, right)
        let out = ""
        let exit = 0
        try {
            out = execFileSync("git", ["diff", "--no-index", "--numstat", "--", a, b], { encoding: "utf8" })
        } catch (error) {
            out = String(error.stdout ?? "")
            exit = error.status ?? 1
        }
        const last = out.trim().split("\n").filter(Boolean).pop()
        const [added, deleted] = last === undefined ? [0, 0] : last.split("\t").slice(0, 2).map(Number)
        return { exit, added, deleted, diffLines: added + deleted, raw: out.trim() }
    }
    finally {
        rmSync(dir, { recursive: true, force: true })
    }
}

/** A scratch root holding the two adopted files only (the applier reads nothing else). */
function scratchRoot(files) {
    const root = mkdtempSync(join(tmpdir(), "mpd-t5-heal-"))
    mkdirSync(join(root, LIB_REL), { recursive: true })
    for (const [name, text] of Object.entries(files)) writeFileSync(join(root, LIB_REL, name), text)
    return root
}

const read = (root, name) => readFileSync(join(root, LIB_REL, name), "utf8")

/** The same layout with a CLI entry point, so `main()` (argv + exit code) is exercised. */
function cliRepo(files) {
    const root = mkdtempSync(join(tmpdir(), "mpd-t5-cli-"))
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

// ---------- scenario 1: BOTH files stripped from the same state, one heal, byte compare ----------
for (let round = 1; round <= 3; round += 1) {
    const root = scratchRoot({})
    try {
        const stripped = {}
        for (const name of ADOPTED) {
            const out = stripRegions(canonical[name], undefined)
            stripped[name] = out
            writeFileSync(join(root, LIB_REL, name), out.text)
        }
        const expectations = ADOPTED.map((name) => ({
            file: name,
            regionsStripped: stripped[name].stripped.length,
            linesRemoved: stripped[name].removed,
            strippedDiffers: stripped[name].text !== canonical[name],
            strippedSha: sha256(stripped[name].text),
        }))
        const heal = applyAgentTeamsFixes({ root, write: true })
        const check = applyAgentTeamsFixes({ root, write: false })
        const compared = ADOPTED.map((name) => {
            const healed = read(root, name)
            return {
                file: name,
                byteIdentical: healed === canonical[name],
                healedSha: sha256(healed),
                canonicalSha: sha256(canonical[name]),
                ...diffStat(canonical[name], healed),
            }
        })
        record({
            scenario: "both-full-strip",
            round,
            canonicalSha: Object.fromEntries(ADOPTED.map((name) => [name, sha256(canonical[name])])),
            registrySha,
            registryRegions: MPD_DELTAS.length,
            registryOrder: MPD_DELTAS.map((delta) => delta.id),
            stripped: expectations,
            heal: { status: heal.status, inserted: heal.inserted, insertedCount: heal.inserted.length, regions: heal.regions, files: heal.files },
            recheck: { status: check.status, inserted: check.inserted },
            compared,
            passed: expectations.every((item) => item.strippedDiffers)
                && heal.status === "applied"
                && heal.inserted.length === MPD_DELTAS.length
                && check.status === "already-applied"
                && compared.every((item) => item.byteIdentical && item.diffLines === 0),
        })
    }
    finally {
        rmSync(root, { recursive: true, force: true })
    }
}

// ---------- scenario 2: the same fixture driven through the real CLI (argv + exit codes) ----------
{
    const strippedFiles = Object.fromEntries(ADOPTED.map((name) => [name, stripRegions(canonical[name], undefined).text]))
    const root = cliRepo(strippedFiles)
    try {
        const before = Object.fromEntries(ADOPTED.map((name) => [name, sha256(read(root, name))]))
        const write = runCli(root, ["--write"])
        const check = runCli(root, ["--check"])
        const compared = ADOPTED.map((name) => {
            const healed = read(root, name)
            return { file: name, byteIdentical: healed === canonical[name], ...diffStat(canonical[name], healed) }
        })
        record({
            scenario: "cli-both-full-strip",
            strippedSha: before,
            cliWrite: write,
            cliCheck: check,
            compared,
            passed: write.exit === 0 && check.exit === 0
                && write.stdout.includes(`inserted: ${MPD_DELTAS.map((delta) => delta.id).join(", ")}`)
                && compared.every((item) => item.byteIdentical && item.diffLines === 0),
        })
    }
    finally {
        rmSync(root, { recursive: true, force: true })
    }
}

// ---------- scenario 3: partial insertion histories in BOTH files, one heal ----------
{
    const root = scratchRoot({})
    try {
        const stripped = {}
        for (const name of ADOPTED) {
            const ids = new Set(MPD_DELTAS.filter((delta) => delta.file.endsWith(`lib/${name}`)).filter((_, index) => index % 2 === 0).map((delta) => delta.id))
            const out = stripRegions(canonical[name], ids)
            stripped[name] = { ids: [...ids], removed: out.removed }
            writeFileSync(join(root, LIB_REL, name), out.text)
        }
        const heal = applyAgentTeamsFixes({ root, write: true })
        const compared = ADOPTED.map((name) => {
            const healed = read(root, name)
            return { file: name, byteIdentical: healed === canonical[name], ...diffStat(canonical[name], healed) }
        })
        record({
            scenario: "both-partial-strip",
            stripped,
            heal: { status: heal.status, insertedCount: heal.inserted.length, inserted: heal.inserted },
            compared,
            passed: heal.status === "applied" && compared.every((item) => item.byteIdentical && item.diffLines === 0),
        })
    }
    finally {
        rmSync(root, { recursive: true, force: true })
    }
}

// ---------- scenario 4: negative control — a perturbed seam must REFUSE, not misplace ----------
{
    const delta = MPD_DELTAS.find((item) => item.afterContext.length === 1 && canonical[item.file.split("/").pop()] !== undefined)
    const stripped = {}
    for (const name of ADOPTED) stripped[name] = stripRegions(canonical[name], undefined).text
    const victimFile = delta.file.split("/").pop()
    const target = delta.afterContext[0]
    const lines = stripped[victimFile].split("\n")
    const at = lines.indexOf(target)
    if (at === -1) throw new Error("negative-control fixture: the afterContext line was not found")
    lines.splice(at, 1)
    stripped[victimFile] = lines.join("\n")
    const root = scratchRoot(stripped)
    try {
        const before = read(root, victimFile)
        let message = ""
        try {
            applyAgentTeamsFixes({ root, write: true })
        }
        catch (error) {
            message = String(error.message)
        }
        record({
            scenario: "negative-control-perturbed-seam",
            delta: delta.id,
            victimFile,
            perturbedLine: target,
            refusalMessage: message,
            victimUnchanged: read(root, victimFile) === before,
            passed: message.includes("FAIL") && read(root, victimFile) === before,
        })
    }
    finally {
        rmSync(root, { recursive: true, force: true })
    }
}

const summary = {
    driver: "strip-heal-both",
    repo: REPO,
    measuredAt: new Date().toISOString(),
    registrySha,
    registryRegions: MPD_DELTAS.length,
    results,
    passed: results.every((entry) => entry.passed),
}
writeFileSync(join(EVIDENCE, "drivers", "strip-heal-both.result.json"), JSON.stringify(summary, null, 2) + "\n")
console.log(`[strip-heal-both] ${summary.passed ? "PASS" : "FAIL"} (${results.filter((entry) => entry.passed).length}/${results.length} scenarios)`)
process.exit(summary.passed ? 0 : 1)
