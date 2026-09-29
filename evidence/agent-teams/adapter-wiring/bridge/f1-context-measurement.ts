// F1 MEASURED FINDING (the captain asked for exactly this measurement) + the two greps the
// "UNMET" reading was based on, reproduced against the current tree.
//
// Run: node evidence/agent-teams/adapter-wiring/bridge/f1-context-measurement.mjs
import { readFileSync, statSync } from "node:fs"
import { createHash } from "node:crypto"
import { agentScopeOf } from "../../../../packages/mpd-agent-teams-plugin/lib/mpd-adapter-ctx.ts"

const bridge = "packages/mpd-agent-teams-plugin/lib/mpd-adapter-ctx.js"
const root = new URL("../../../../", import.meta.url).pathname
const raw = readFileSync(root + bridge, "utf8")

console.log("bridge sha256:", createHash("sha256").update(raw).digest("hex"))
console.log("bridge mtime (UTC):", statSync(root + bridge).mtime.toISOString())
console.log("pre-fix one-liner occurrences in the bridge:", (raw.match(/ctx\.agentScope\(agent\) \?\? agent\?\.ctx/g) ?? []).length)
console.log()

// (a) a PLAIN-OBJECT raw ctx: `.context` is simply absent -> undefined, NO throw.
const plain = { tools: { restrict: () => () => undefined }, on: () => () => undefined, effect: () => () => undefined }
console.log("[a] plain-object raw ctx: read '.context' ->", (() => { try { return JSON.stringify(plain.context) } catch (error) { return "THREW " + error.message } })())

// (b) the documented harness shape: a scoped ctx whose UNDECLARED reads throw
//     ("cannot get property \"agent\" without inject" — harness-compat.js's own JSDoc).
const hostile = new Proxy({}, {
    get(_target, prop) {
        if (prop === "tools")
            return { restrict: () => () => undefined }
        throw new Error(`cannot get property "${String(prop)}" without inject`)
    },
})
console.log("[b] throwing-proxy raw ctx: read '.context' ->", (() => { try { return JSON.stringify(hostile.context) } catch (error) { return "THREW " + error.message } })())
console.log("[b] so `scope.context ?? scope` CANNOT rescue this shape: the read throws before `??` runs.")
console.log()

// (c) the landed helper never reads `.context` at all: it BUILDS the shape and keeps identity.
for (const [label, ctx] of [["plain", plain], ["hostile", hostile]]) {
    const scope = agentScopeOf({}, { id: "agent-" + label, ctx })
    const keys = Object.keys(scope).sort()
    const read = (name) => { try { return typeof scope[name] } catch (error) { return "THREW " + error.message } }
    console.log(`[c/${label}] shape=${JSON.stringify(keys)} context-is-identity=${Object.is(scope.context, ctx)} `
        + `read context/tools/on/effect -> ${read("context")}/${read("tools")}/${read("on")}/${read("effect")}`)
    console.log(`[c/${label}] members callable: restrict=${typeof scope.tools.restrict} on=${typeof scope.on} effect=${typeof scope.effect}`)
}

// (d) the two greps the "UNMET" reading cited, reproduced:
const six = ["index.js", "capabilities.js", "harness-compat.js", "members.js", "command.js", "tools.js"]
const dir = root + "packages/mpd-agent-teams-plugin/lib/"
console.log()
console.log("[d1] grep steerAgentTurn|injectAgentMessage over lib/*.js:")
for (const file of [bridge.split("/").pop(), ...six, "mpd-deltas.js"]) {
    const hits = (readFileSync(dir + file, "utf8").match(/steerAgentTurn|injectAgentMessage/g) ?? []).length
    if (hits > 0) console.log(`     ${file}: ${hits} occurrence(s)`)
}
console.log("[d2] three-arm test markers in test/adapter-facade.test.mjs:")
const test = readFileSync(root + "packages/mpd-agent-teams-plugin/test/adapter-facade.test.mjs", "utf8")
for (const needle of ["F1: agentScopeOf returns ONE shape in ALL THREE arms", "absent-with-a-throwing-proxy", "new Proxy(", "ARM 1", "ARM 3"])
    console.log(`     ${JSON.stringify(needle)} -> ${test.includes(needle) ? "PRESENT" : "absent"}`)
