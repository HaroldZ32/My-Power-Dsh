#!/usr/bin/env node
// t5 INDEPENDENT verification driver 3/5 — the DEFECT-6 boundary claim.
//
// t1/t2 claim the oversized-payload drop of the trailing parameter is MODEL-SIDE (the raw
// provider fragment stream is byte-identical to the assembled arguments; the harness parse is
// key-lossless), so no plugin-side guard can see it and `status` was made REQUIRED instead.
// The task says to CONFIRM that boundary rather than accept it. This driver re-derives it from
// the INSTALLED harness code: it imports the real `BlockAssembler` from this checkout and runs
// a >12 KB tool-call argument payload through it, then applies the harness's own parse rule.
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const EVIDENCE = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const HOST_NM = process.env.DSH_HOST_NM ?? "/root/.nvm/versions/node/v24.16.0/lib/node_modules/@deepseek-ai/dsh/node_modules"
const ASSEMBLER = join(HOST_NM, "@deepseek-ai", "dsh-llm", "lib", "types", "assembler.js")
const LOOP = join(HOST_NM, "@deepseek-ai", "dsh-agent-loop", "lib", "index.js")
if (!existsSync(ASSEMBLER)) throw new Error(`installed assembler not found: ${ASSEMBLER}`)

const { BlockAssembler } = await import(pathToFileURL(ASSEMBLER).href)
const sha256 = (text) => createHash("sha256").update(text).digest("hex")

// Verbatim copy of the harness's module-private `parseArguments` (dsh-agent-loop/lib/index.js:541-547):
//   function parseArguments(raw) { try { return raw ? JSON.parse(raw) : {} } catch { return raw } }
const parseArguments = (raw) => {
    try {
        return raw ? JSON.parse(raw) : {}
    }
    catch {
        return raw
    }
}
const loopSource = readFileSync(LOOP, "utf8")
const parseFunctionSource = loopSource.slice(loopSource.indexOf("function parseArguments(raw)"), loopSource.indexOf("function parseArguments(raw)") + 180)

/** One >12 KB arguments payload whose LAST key is `status`, streamed in 60 deltas. */
function bigArguments() {
    const filler = Array.from({ length: 200 }, (_, index) => `finding-${index}: ${"x".repeat(50)}`)
    return JSON.stringify({
        task_id: "t6",
        output: filler.join("\n"),
        changedPaths: filler.slice(0, 50),
        verdict: "pass",
        attempt_id: "attempt-live-1",
        status: "completed",
    })
}

const results = []
const record = (entry) => { results.push(entry); console.log(JSON.stringify(entry)); return entry }

// ---------- A. stop-reason stream: the arguments string is lossless and key-lossless ----------
{
    const raw = bigArguments()
    const deltas = raw.match(/[\s\S]{1,220}/g)
    const assembler = new BlockAssembler()
    assembler.push({ type: "block-start", index: 0, blockType: "tool-call" })
    for (const argumentsDelta of deltas) assembler.push({ type: "tool-call-delta", index: 0, id: "call-1", name: "agent_teams_update_task", argumentsDelta })
    assembler.push({ type: "block-end", index: 0, block: { type: "tool-call", id: "call-1", name: "agent_teams_update_task", arguments: raw } })
    assembler.push({ type: "finish", reason: { kind: "stop" } })
    const blocks = assembler.blocks()
    const args = parseArguments(blocks[0]?.arguments)
    record({
        scenario: "harness-assembler-oversized-stop",
        payloadBytes: Buffer.byteLength(raw),
        deltaCount: deltas.length,
        assembledBlocks: blocks.length,
        assembledEqualsRaw: blocks[0]?.arguments === raw,
        assembledSha: sha256(blocks[0]?.arguments ?? ""),
        rawSha: sha256(raw),
        parsedKeys: Object.keys(args),
        trailingStatusSurvived: args.status === "completed",
        attemptIdSurvived: args.attempt_id === "attempt-live-1",
        passed: blocks.length === 1 && blocks[0].arguments === raw && args.status === "completed" && args.attempt_id === "attempt-live-1",
    })
}

// ---------- B. max-tokens control: a truncated emission is DROPPED, never dispatched ----------
{
    const raw = bigArguments()
    const truncated = raw.slice(0, raw.length - 60)
    const assembler = new BlockAssembler()
    assembler.push({ type: "block-start", index: 0, blockType: "tool-call" })
    assembler.push({ type: "tool-call-delta", index: 0, id: "call-2", name: "agent_teams_update_task", argumentsDelta: truncated })
    assembler.push({ type: "finish", reason: { kind: "max-tokens" } })
    const blocks = assembler.blocks()
    record({
        scenario: "harness-assembler-maxtokens-control",
        truncatedBytes: Buffer.byteLength(truncated),
        blocksAfterMaxTokens: blocks.map((block) => block.type),
        toolCallDropped: blocks.every((block) => block.type !== "tool-call"),
        passed: blocks.every((block) => block.type !== "tool-call"),
    })
}

// ---------- C. static citation of the installed parse rule (no size cap, no key filter) ----------
{
    record({
        scenario: "static-parse-rule",
        sourceFile: LOOP,
        parseFunctionSource,
        hasSizeCap: /length\s*[<>]=?\s*\d/.test(parseFunctionSource),
        isPlainJsonParse: parseFunctionSource.includes("JSON.parse(raw)"),
        passed: parseFunctionSource.includes("JSON.parse(raw)") && !/length\s*[<>]=?\s*\d/.test(parseFunctionSource),
    })
}

const summary = {
    driver: "harness-arg-boundary",
    hostNm: HOST_NM,
    measuredAt: new Date().toISOString(),
    results,
    passed: results.every((entry) => entry.passed),
    boundary:
        "the installed harness concatenates tool-call argument deltas verbatim, drops the WHOLE call on a max-tokens finish, "
        + "and parses with a plain JSON.parse (no size cap, no key filter) — so a trailing key lost inside a dispatched call "
        + "cannot have been dropped by this layer; it was never emitted by the model, and the plugin-side REQUIRED-parameter "
        + "contract is the only honest guard",
}
writeFileSync(join(EVIDENCE, "drivers", "harness-arg-boundary.result.json"), JSON.stringify(summary, null, 2) + "\n")
console.log(JSON.stringify({ passed: summary.passed, boundary: summary.boundary }))
process.exit(summary.passed ? 0 : 1)
