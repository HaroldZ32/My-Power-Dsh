// READ-ONLY adapter-surface conformance check for the bridge lane (t5).
//
// WHY: the adapter lane warned that its shipped capability flag names differ from the task
// descriptions' paraphrase. A wrong flag name would degrade SILENTLY — `seam(name, flag)` looks up
// `capabilities[flag]` and only a literal `false` degrades, so a misspelled flag would leave the
// gate permanently open (the adapter would be called although its report says the seam is down).
// This script reads the SHIPPED adapter source, collects every flag the bridge passes, and then
// drives two behaviours with an all-false capability report.
//
// Run: node evidence/agent-teams/adapter-wiring/bridge/adapter-flag-conformance.mjs
import { readFileSync } from "node:fs"
import { createAgentTeamsCtx } from "../../../../packages/mpd-agent-teams-plugin/lib/mpd-adapter-ctx.js"

const repoRoot = new URL("../../../../", import.meta.url).pathname
// BOTH authorities: the adapter's TypeScript interface AND the SHIPPED dist artifact (a dist built
// from a different revision than src would otherwise pass this check silently).
const adapterSource = readFileSync(repoRoot + "packages/mpd-dsh-adapter-plugin/src/index.ts", "utf8")
const adapterDist = readFileSync(repoRoot + "packages/mpd-dsh-adapter-plugin/dist/index.js", "utf8")
const declaredInSrc = new Set([...adapterSource.matchAll(/^  ([a-zA-Z]+): boolean/mg)].map((match) => match[1]))
// The dist's `capabilities()` returns ONE object literal, whose keys are the shipped flag names.
// Extract that literal's key set (presence-only: the values are expressions, not literals).
const distCapabilityBlock = (() => {
    const at = adapterDist.indexOf("capabilities() {")
    if (at === -1) return ""
    const from = adapterDist.indexOf("{", adapterDist.indexOf("return", at))
    let depth = 0
    for (let index = from; index < adapterDist.length; index += 1) {
        if (adapterDist[index] === "{") depth += 1
        else if (adapterDist[index] === "}") {
            depth -= 1
            if (depth === 0) return adapterDist.slice(from, index + 1)
        }
    }
    return ""
})()
const declaredInDist = new Set([...distCapabilityBlock.matchAll(/(?:^|[{,\s])([A-Za-z_$][\w$]*)\s*:/g)].map((match) => match[1]))
const declared = declaredInSrc
const bridgeSource = readFileSync(repoRoot + "packages/mpd-agent-teams-plugin/lib/mpd-adapter-ctx.js", "utf8")
const used = [...new Set([...bridgeSource.matchAll(/seam\('[A-Za-z]+', '([A-Za-z]+)'\)/g)].map((match) => match[1]))]
const missing = used.filter((flag) => !declared.has(flag))
const missingInDist = used.filter((flag) => !declaredInDist.has(flag))
console.log("flags used by the bridge:", used.length, "| all declared in the adapter SOURCE:", missing.length === 0, missing.length > 0 ? missing : "")
console.log("flags used by the bridge:", used.length, "| all present in the SHIPPED dist artifact:", missingInDist.length === 0, missingInDist.length > 0 ? missingInDist : "")

// A capability report that says EVERY flag is down: each gated seam must take the raw lane.
const agent = {
    id: "a",
    followup: () => "raw-followup",
    cancel: () => "raw-cancel",
    steer: () => "raw-steer",
    inject: () => "raw-inject",
    ctx: { on: () => () => undefined, effect: () => () => undefined, tools: { restrict: () => () => undefined } },
}
const adapter = {
    capabilities: () => Object.fromEntries([...declared].map((key) => [key, false])),
    startAgentTurn: () => { throw new Error("the adapter must NOT be called while its flag is false") },
    steerAgentTurn: () => { throw new Error("the adapter must NOT be called while its flag is false") },
    agentScope: () => ({ unusable: true }),
}
const raw = { get: (_name, strict) => (strict === true ? adapter : adapter), logger: {} }
const facade = createAgentTeamsCtx(raw, { witness: () => undefined })
console.log("flag-false startAgentTurn -> raw lane:", facade.startAgentTurn(agent, {}) === "raw-followup")
console.log("flag-false steerAgentTurn -> raw lane:", facade.steerAgentTurn(agent, {}) === "raw-steer")
const scope = facade.agentScope(agent)
console.log("unusable adapter scope -> built shape:", JSON.stringify(Object.keys(scope).sort()), "| context is agent.ctx (Object.is):", Object.is(scope.context, agent.ctx))
process.exit(missing.length === 0 && missingInDist.length === 0 ? 0 : 1)
