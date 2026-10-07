// r6 OBSERVE-ONLY PROOF — the same REAL tool call with and without the hook installed.
//
// The claim under test is narrow and strong: installing `onPreToolExecute` changes NOTHING about
// the call it observes. The only way to show that is to run the same call twice — once on a plain
// cordis context, once on a context with the hook — and compare the gate decision, the real
// command's outcome and the post-execute decision BYTE FOR BYTE.
//
// REAL: the vendored `@deepseek-ai/cordis` EventsService dispatches both waterfalls (so a
// non-delegating listener really would veto), the adapter under test is the REAL `createDshAdapter`,
// and the tool body is a genuine child process that really runs for 250 ms.
// MODELLED: only the harness's tool registry — the 6 lines below are the dispatch order
// `dsh-tools/lib/index.ts:3116` uses (gate -> body -> post-execute).
import { spawnSync } from "node:child_process"
import { writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { Context } from "../../../../../packages/mpd-agent-teams-plugin/_deps/cordis/lib/index.ts"
import { createDshAdapter } from "../../../../../packages/mpd-dsh-adapter-plugin/src/index.ts"

const HERE = dirname(fileURLToPath(import.meta.url))
const COMMAND_MS = 250

async function callOnce({ installHook }) {
  const ctx = new Context()
  const adapter = createDshAdapter(ctx)
  let observed = null
  let stampedBeforeTheCommandStarted = null
  if (installHook) {
    adapter.onPreToolExecute((exec, decision) => {
      observed = { name: exec.name, callId: exec.callId, decisionKind: decision?.kind, at: Date.now() }
    })
  }
  const exec = { name: "bash", callId: "call-observe-1", arguments: { command: "sleep " + COMMAND_MS + "ms" } }
  // 1) the harness's gate
  const gate = await ctx.waterfall(ctx, "tools/pre-execute", exec, () => Promise.resolve({ kind: "allow" }))
  if (gate.kind !== "allow") return { gate, result: null, observed, denied: true }
  // 2) the tool body: a REAL child process, really 250 ms
  const started = Date.now()
  const child = spawnSync(process.execPath, ["-e", "setTimeout(() => {}, " + COMMAND_MS + ")"], { encoding: "utf8" })
  const elapsedMs = Date.now() - started
  // The hook ran while the GATE was open, i.e. before this line ever executed.
  if (installHook && observed !== null) stampedBeforeTheCommandStarted = observed.at <= started
  const result = { status: child.status, stdout: child.stdout, stderr: child.stderr, ranAsAChildProcess: child.pid !== undefined }
  // 3) the harness's post-execute waterfall
  const decision = await ctx.waterfall(ctx, "tools/post-execute", exec, result, () => Promise.resolve({ kind: "accept" }))
  return { gate, result, elapsedMs, accepted: decision.kind, observed, stampedBeforeTheCommandStarted, denied: false }
}

const without = await callOnce({ installHook: false })
const withHook = await callOnce({ installHook: true })
const same = {
  gateIdentical: JSON.stringify(without.gate) === JSON.stringify(withHook.gate),
  resultIdentical: JSON.stringify(without.result) === JSON.stringify(withHook.result),
  postDecisionIdentical: without.accepted === withHook.accepted,
  commandRanForReal: without.elapsedMs >= 200 && withHook.elapsedMs >= 200,
  hookActuallyRan: withHook.observed !== null && withHook.observed.decisionKind === "allow",
  observedBeforeTheCommandRan: withHook.stampedBeforeTheCommandStarted === true,
  noHookNoObservation: without.observed === null,
}
const out = { commandMs: COMMAND_MS, without, withHook, same, ok: Object.values(same).every(Boolean) }
writeFileSync(join(HERE, "observe-only-real-call.json"), JSON.stringify(out, null, 2) + "\n")
console.log("WITHOUT hook: gate " + JSON.stringify(without.gate) + " real result " + JSON.stringify(without.result) + " in " + without.elapsedMs + " ms")
console.log("WITH    hook: gate " + JSON.stringify(withHook.gate) + " real result " + JSON.stringify(withHook.result) + " in " + withHook.elapsedMs + " ms")
console.log("the hook observed " + JSON.stringify(withHook.observed) + " BEFORE the command started: " + withHook.stampedBeforeTheCommandStarted)
console.log("same gate / same result / same post decision: " + JSON.stringify(same))
process.exit(out.ok ? 0 : 1)
