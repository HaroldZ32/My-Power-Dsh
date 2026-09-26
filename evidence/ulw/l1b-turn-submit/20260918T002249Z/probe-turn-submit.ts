// Evidence probe for task t12 (lane L1b): the turn-submission surface measured against the
// INSTALLED harness (absolute path, never a bare specifier).
//
// HONEST BOUND, stated first: the installed live agent class (`ReactLoopAgent`, which owns
// `followup`) is NOT exported by `dsh-agent-loop`, and constructing one needs a scoped cordis
// context plus a full Session — so this probe measures (A) the INSTALLED SOURCE of that method,
// exactly, and (B) the ADAPTER-side contract (binding, verbatim message, safe no-op). The live
// end-to-end path — a real Agent from a real boot's registry — belongs to the wave's live cases
// (t2/t7), not here.
//
// Run: bun run evidence/ulw/l1b-turn-submit/<stamp>/probe-turn-submit.ts
const HOST = "/root/.nvm/versions/node/v24.16.0/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai"
const llm = await import(HOST + "/dsh-llm/lib/index.js")
const { createDshAdapter, userMessage } = await import("../../../../packages/mpd-dsh-adapter-plugin/src/index")

const checks: Array<{ id: string; ok: boolean; detail: string }> = []
const check = (id: string, ok: boolean, detail: string): void => {
  checks.push({ id, ok, detail })
  console.log((ok ? "PASS " : "FAIL ") + id + " — " + detail)
}

// ── A. the INSTALLED host's turn semantics (source-mechanical, exact) ────────
const loopSource = await Bun.file(HOST + "/dsh-agent-loop/lib/index.js").text()
const followup = /followup\(input\)\s*\{\s*this\.send\(input, "next-turn", true\);\s*\}/u.exec(loopSource)
check("A1.installed-followup-delegates-next-turn", followup !== null, followup?.[0]?.replace(/\s+/gu, " ") ?? "pattern not found in the installed dsh-agent-loop")
const methodAt = loopSource.indexOf("followup(input)")
const classAt = loopSource.lastIndexOf("var ReactLoopAgent = class", methodAt)
check("A2.method-lives-on-the-live-agent-class", classAt > -1 && methodAt > classAt, "ReactLoopAgent (internal, not exported): reachable only as a live Agent from the registry")

// ── B. the adapter-side contract: bound call, verbatim message, safe no-op ───
const adapter = createDshAdapter({ get: () => undefined })
const message = userMessage({ text: "run the ULW loop", source: { kind: "plugin", plugin: "mpd-ulw" } })
const calls: Array<{ self: unknown; input: unknown }> = []
const receiver = {
  id: "probe-agent",
  followup(this: unknown, input: unknown) { calls.push({ self: this, input }) },
}
check("B1.seam-reports-success", adapter.submitUserTurn(receiver, message) === true, "true")
check("B2.followup-called-on-the-receiver", calls[0]?.self === receiver, "this === the agent handed to the seam")
check("B3.message-passed-verbatim", calls[0]?.input === message, "identity preserved (same object)")

let threw = false
let results: unknown[] = []
try {
  results = [
    adapter.submitUserTurn({ id: "no-followup" }, message),
    adapter.submitUserTurn(undefined, message),
    adapter.submitUserTurn(null, message),
    adapter.submitUserTurn("not-an-agent", message),
    adapter.submitUserTurn({ followup: () => { throw new Error("driver refused") } }, message),
  ]
} catch (error) {
  threw = true
  results = [String(error)]
}
check("B4.absent-surfaces-no-throw", threw === false, JSON.stringify(results))
check("B5.absent-surfaces-false", results.every((value) => value === false), JSON.stringify(results))

// ── C. the flag is a LIVE-registry probe, truthfully reported ────────────────
const liveAgent = { id: "live-agent", followup: () => {} }
const withAgent = createDshAdapter({ get: (name: string) => (name === "agents" ? { list: () => [liveAgent] } : undefined) })
const withoutAgent = createDshAdapter({ get: (name: string) => (name === "agents" ? { list: () => [{ id: "bare-agent" }] } : undefined) })
const none = createDshAdapter({ get: () => undefined })
check("C1.flag-true-with-a-live-agent", withAgent.capabilities().turnSubmit === true, JSON.stringify({ turnSubmit: withAgent.capabilities().turnSubmit }))
check("C2.flag-false-without-the-surface", withoutAgent.capabilities().turnSubmit === false && none.capabilities().turnSubmit === false, JSON.stringify({ bareAgent: withoutAgent.capabilities().turnSubmit, noAgents: none.capabilities().turnSubmit }))

// ── D. the seam rule: a handler submits without touching the host invocation ─
const registered: Array<{ handler: (invocation: unknown) => unknown }> = []
const mounted = createDshAdapter({ get: (name: string) => (name === "commands" ? { register: (definition: { handler: (invocation: unknown) => unknown }) => { registered.push(definition); return () => {} } } : undefined) })
mounted.registerCommand({
  name: "ulw",
  description: "probe",
  handler: (invocation: { submit?: (m: unknown) => boolean }) => ({ kind: (invocation.submit?.(message) ?? false) ? "success" : "error" }),
})
const hostInvocation = { rawInput: " go", agent: receiver }
const result = await registered[0]?.handler(hostInvocation)
check("D1.handler-submit-works", JSON.stringify(result) === JSON.stringify({ kind: "success" }), JSON.stringify(result))
check("D2.host-invocation-unmutated", !("submit" in hostInvocation) && Object.keys(hostInvocation).sort().join(",") === "agent,rawInput", JSON.stringify(Object.keys(hostInvocation).sort()))
check("D3.submission-reached-the-agent", calls.length === 2 && calls[1]?.input === message, "calls recorded: " + String(calls.length))
check("D4.message-matches-the-installed-constructor", JSON.stringify(message.source) === JSON.stringify(llm.createUserMessage({ content: [{ type: "text", text: "run the ULW loop" }], source: { kind: "plugin", plugin: "mpd-ulw" } }).source) && Object.isFrozen(message), "producer tag preserved; frozen")
check("D5.no-steer-or-inject-on-the-surface", !("steer" in adapter) && !("inject" in adapter) && !("send" in adapter) && typeof (adapter as { submitUserTurn?: unknown }).submitUserTurn === "function", "submitUserTurn is the surface; steer/inject deliberately absent: " + JSON.stringify(Object.keys(adapter).filter((key) => /steer|inject|send/u.test(key))))

const failed = checks.filter((entry) => !entry.ok)
console.log(JSON.stringify({ checks, failed: failed.length, ok: failed.length === 0 }, null, 2))
process.exit(failed.length === 0 ? 0 : 1)
