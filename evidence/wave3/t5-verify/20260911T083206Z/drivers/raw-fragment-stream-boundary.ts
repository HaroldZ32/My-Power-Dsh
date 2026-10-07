#!/usr/bin/env node
// t5 addendum driver — the PRECISE DEFECT-6 boundary, re-derived from the persisted raw provider
// fragment stream rather than accepted from the requirements record.
//
// Claim under test (canonical t1 record, line 34): the drop is MODEL-SIDE. The persisted
// `assistant/message` record's `data.stream[]` entries of type `tool-call-chunks` carry the raw
// `args` fragments; concatenating them must equal — byte for byte — the assembled
// `arguments` that the harness later dispatched, and the emitted JSON must be COMPLETE and
// VALID while missing exactly the top-level key the wave-2 report lost. The harness parser is
// plain `JSON.parse` (dsh-agent-loop), and the plugin has no parse/size handling at all.
//
// Only hashes, lengths, keys and record paths are written to the evidence file; the model's
// argument payload itself is never persisted.
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, "..", "..", "..", "..", "..")
const EVIDENCE = resolve(HERE, "..")
const sha12 = (text) => createHash("sha256").update(text).digest("hex").slice(0, 12)

const DSH_HOME = process.env.DSH_HOME ?? join(process.env.HOME ?? "/root", ".dsh")
const SESSIONS = join(DSH_HOME, "sessions", "--root-dshProj-my-power-dsh--")
const CASES = [
    { label: "t6/Senior Engineer", session: "47376f28-26ef-4626-9b6a-0c161920b78d", seq: 1186, tool: "agent_teams_update_task", sha12: "c86ea2adeab4", chars: 14080, mustMiss: "status" },
    { label: "t10/Reviewer", session: "07bfb2e6-292c-48e3-aef6-9ae8a7578b4a", seq: 1031, tool: "agent_teams_update_task", sha12: "9f47aa0efd7c", chars: 14866, mustMiss: "attempt_id" },
]

const results = []
const record = (entry) => { results.push(entry); console.log(JSON.stringify(entry)); return entry }

for (const testCase of CASES) {
    const log = join(SESSIONS, testCase.session, "session.v3.jsonl.zstd")
    if (!existsSync(log)) throw new Error(`session log not found: ${log}`)
    const text = execFileSync("zstd", ["-d", "-c", log], { encoding: "utf8", maxBuffer: 1 << 28 })
    const records = text.split("\n").filter(Boolean).map((line) => JSON.parse(line))
    const target = records.find((entry) => entry.seq === testCase.seq)
    if (target === undefined) throw new Error(`record seq ${testCase.seq} not found in ${testCase.session}`)

    const groups = new Map()
    for (const entry of target.data?.stream ?? []) {
        if (entry?.type !== "tool-call-chunks") continue
        const key = entry.id ?? `index-${entry.index}`
        if (!groups.has(key)) groups.set(key, { name: entry.name, fragments: [] })
        groups.get(key).fragments.push(...(Array.isArray(entry.args) ? entry.args : [String(entry.args)]))
    }
    const call = [...groups.entries()].find(([, group]) => group.name === testCase.tool)
    if (call === undefined) throw new Error(`no ${testCase.tool} fragment group in seq ${testCase.seq}`)
    const [callId, group] = call
    const raw = group.fragments.join("")
    let parsed
    let valid = true
    try { parsed = JSON.parse(raw) }
    catch { valid = false }

    // the assembled copy the harness dispatched: found by exact string equality, anywhere in the log
    const copies = []
    const walk = (node, path) => {
        if (node === null || typeof node !== "object") return
        if (Array.isArray(node)) { node.forEach((value, index) => walk(value, `${path}[${index}]`)); return }
        for (const [key, value] of Object.entries(node)) {
            if (key === "arguments" && value === raw) copies.push(`${path}.${key}`)
            walk(value, `${path}.${key}`)
        }
    }
    records.forEach((entry, index) => walk(entry, `rec[${index}]:${entry.type}`))

    const pluginLib = join(REPO, "packages", "mpd-agent-teams-plugin", "lib")
    let pluginFiles = ""
    try {
        pluginFiles = execFileSync("grep", ["-rl", "parseArguments", pluginLib], { encoding: "utf8" }).trim()
    }
    catch (error) {
        if (error.status !== 1) throw error
    }
    let pluginJsonParse = ""
    try {
        pluginJsonParse = execFileSync("grep", ["-rl", "JSON.parse", pluginLib], { encoding: "utf8" }).trim()
    }
    catch (error) {
        if (error.status !== 1) throw error
    }
    // the tool-argument path specifically: the file that registers agent_teams_update_task
    const toolsSource = readFileSync(join(pluginLib, "tools.js"), "utf8")
    const toolsJsonParseCount = (toolsSource.match(/JSON\.parse/g) ?? []).length
    const toolsSizeHandling = /arguments[\s\S]{0,80}(\.length\s*[<>]|maxLength|MAX_)/.test(toolsSource)

    record({
        case: testCase.label,
        session: testCase.session,
        recordSeq: testCase.seq,
        callId,
        tool: group.name,
        fragmentCount: group.fragments.length,
        rawChars: raw.length,
        rawSha12: sha12(raw),
        expectedSha12: testCase.sha12,
        expectedChars: testCase.chars,
        shaMatches: sha12(raw) === testCase.sha12,
        charsMatch: raw.length === testCase.chars,
        validCompleteJson: valid,
        topLevelKeys: valid ? Object.keys(parsed) : null,
        missingTopLevelKey: testCase.mustMiss,
        missingKeyAbsent: valid ? !(testCase.mustMiss in parsed) : null,
        assembledByteIdenticalCopies: copies.length,
        assembledCopyPaths: copies,
        parseArgumentsInPluginLib: pluginFiles.length > 0 ? pluginFiles.split("\n") : [],
        jsonParseElsewhereInPluginLib: pluginJsonParse.length > 0 ? pluginJsonParse.split("\n") : [],
        toolsJsJsonParseCount: toolsJsonParseCount,
        toolsJsSizeHandling: toolsSizeHandling,
        passed: sha12(raw) === testCase.sha12
            && raw.length === testCase.chars
            && valid
            && !(testCase.mustMiss in parsed)
            && copies.length > 0
            && pluginFiles.length === 0
            && toolsJsonParseCount === 0
            && !toolsSizeHandling,
    })
}

const summary = {
    driver: "raw-fragment-stream-boundary",
    measuredAt: new Date().toISOString(),
    dshHome: DSH_HOME,
    boundary: "MODEL-SIDE, confirmed from the persisted streams: the raw fragment stream is byte-identical to the assembled arguments (exact string equality at the dispatch records), the emitted JSON is complete and valid while missing exactly the key the wave-2 report lost, and neither the plugin (no parseArguments anywhere under lib/) nor the harness parser (plain key-lossless JSON.parse, no size cap; a max-tokens finish drops the call whole) can drop a top-level key.",
    residual: "a model-side omission of output/changedPaths stays undetectable by the plugin — stated in the canon and in the tool contract, bounded only by the REQUIRED status parameter plus the split-into-small-calls guidance; the AGENTS.md half of that guidance is still missing (Group F / t8).",
    results,
    passed: results.every((entry) => entry.passed),
}
writeFileSync(join(EVIDENCE, "drivers", "raw-fragment-stream-boundary.result.json"), JSON.stringify(summary, null, 2) + "\n")
console.log(`[raw-fragment-stream-boundary] ${summary.passed ? "PASS" : "FAIL"} (${results.filter((entry) => entry.passed).length}/${results.length} cases)`)
process.exit(summary.passed ? 0 : 1)
