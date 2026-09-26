#!/usr/bin/env node
// QA probe plugin (user clause 2 + clause 3): mounted INSIDE a real headless boot by
// `ulw-command.mjs` through a `dsh --patch` overlay, it reads the LIVE command registry
// and executes both ULW commands through the harness's own dispatcher. The probe never
// asserts anything: it only RECORDS what the real registry accepted (the listed
// descriptors, the empty invocation's result, the non-empty invocation's result) into
// `config.outFile`, plus `[ulw-command-probe]` lines for the boot log. The assertions
// live in the case.
//
// Why a probe is required: `--dump-config` composes rows and NEVER executes plugin
// code, and no CLI surface dispatches slash commands, so a real registry listing +
// a real `commands.execute()` call is the only evidence that the two names are
// registered and that a handler really starts a run (AGENTS.md §4/§7).
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

export const name = "ulw-command-probe"

// The command registry is a harness seam; a PROBE may read it directly (the
// adapter rule binds plugin rows, not QA instrumentation), and `inject` makes the
// mount wait for the service instead of racing its registration.
export const inject = ["commands"]

export function apply(ctx, config = {}) {
  const outFile = config?.outFile
  if (typeof outFile !== "string" || outFile.length === 0) throw new Error("ulw-command-probe: config.outFile is required")
  const objective = typeof config?.objective === "string" && config.objective.length > 0 ? config.objective : "qa-ulw-objective-token"
  const record = { at: new Date().toISOString(), objective, listed: null, descriptors: null, empty: null, filled: null, errors: [] }
  const flush = () => {
    try { writeFileSync(outFile, JSON.stringify(record, null, 2) + "\n") } catch (error) { record.errors.push("flush: " + String(error?.message ?? error)) }
  }
  let fired = false

  // `agent/pre-step` is a WATERFALL: await next() first and return its decision verbatim
  // (a bare value would REPLACE the step decision). The real work is deferred so the
  // probe can never delay or alter the step it was woken by.
  ctx.on("agent/pre-step", async (payload, next) => {
    const decision = typeof next === "function" ? await next() : undefined
    if (!fired) {
      fired = true
      const agent = payload?.agent
      // The probe dispatches its own execution, so a turn signal that has already been
      // aborted by the time the deferred callback runs must not fake a cancellation:
      // fall back to a fresh, live signal in that case only.
      const turnSignal = payload?.signal
      const signal = turnSignal !== undefined && turnSignal.aborted !== true ? turnSignal : new AbortController().signal
      setTimeout(() => { void run(agent, signal) }, 0)
    }
    return decision
  })

  async function run(agent, signal) {
    const commands = typeof ctx.get === "function" ? ctx.get("commands") : undefined
    if (commands === undefined || commands === null) {
      record.errors.push("the commands service is not mounted")
      flush()
      return
    }
    try {
      const descriptors = commands.list(agent)
      record.descriptors = descriptors.map((descriptor) => ({
        name: descriptor?.name,
        description: descriptor?.description,
        hint: descriptor?.input?.hint ?? null,
      }))
      record.listed = record.descriptors.map((descriptor) => descriptor.name)
      console.log("[ulw-command-probe] LISTED=" + record.listed.join(","))
    } catch (error) {
      record.errors.push("list: " + String(error?.message ?? error))
    }
    flush()

    // The EMPTY invocation must answer usage and start nothing. `execute` returns
    // undefined when the name does not resolve at all — recorded as null so the case
    // can tell "not registered" from "registered and answered".
    try {
      const empty = await commands.execute(agent, "/ulw", [], signal)
      record.empty = empty === undefined || empty === null
        ? null
        : { commandId: empty.commandId, kind: empty.result?.kind ?? null, text: empty.result?.text ?? "" }
      console.log("[ulw-command-probe] EMPTY=" + JSON.stringify(record.empty))
    } catch (error) {
      record.errors.push("empty: " + String(error?.message ?? error))
    }
    flush()

    // The NON-EMPTY invocation must START a run: the handler submits the activation
    // directive as the invoking agent's own next user turn (the adapter turn seam).
    try {
      const filled = await commands.execute(agent, "/ultrawork " + objective, [], signal)
      record.filled = filled === undefined || filled === null
        ? null
        : { commandId: filled.commandId, kind: filled.result?.kind ?? null, text: filled.result?.text ?? "" }
      console.log("[ulw-command-probe] FILLED=" + JSON.stringify(record.filled))
    } catch (error) {
      record.errors.push("filled: " + String(error?.message ?? error))
    }
    flush()
  }
}

// Standalone `--self-test` (offline, no boot): the probe's own recording logic is
// exercised against a fake context + fake command registry — the missing-outFile
// throw, the mounted-service absence path, the listed/empty/filled recording and the
// flush. The case owns the real-boot assertions; this arm only proves the probe
// records what it claims and never throws into the step.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const fail = (message) => { console.error("[ulw-command-probe self-test] FAIL: " + message); process.exit(1) }
  if (!process.argv.includes("--self-test")) fail("only --self-test is supported standalone")
  if (name !== "ulw-command-probe" || !inject.includes("commands")) fail("probe module contract changed")
  const dir = mkdtempSync(join(tmpdir(), "mpd-ulw-probe-selftest-"))
  try {
    // 1) a missing outFile must fail loudly at apply time (never a silent no-op).
    let threw = false
    try { apply({ on: () => {} }, {}) } catch { threw = true }
    if (!threw) fail("apply() must throw when config.outFile is missing")

    // 2) the mounted path records the registry listing, both invocation results, and
    //    returns the waterfall decision VERBATIM.
    const outFile = join(dir, "probe.json")
    const seen = { listeners: {} }
    const fakeCtx = {
      on: (event, listener) => { seen.listeners[event] = listener },
      get: () => ({
        list: () => [{ name: "ulw", description: "u", input: { hint: "objective" } }, { name: "ultrawork", description: "u", input: { hint: "objective" } }],
        execute: async (agent, line) => line === "/ulw"
          ? { commandId: "c1", result: { kind: "error", text: "usage: /ulw <objective>" } }
          : { commandId: "c2", result: { kind: "success", text: "ULW activated: " + line.slice(10) } },
      }),
    }
    apply(fakeCtx, { outFile, objective: "self-test-objective" })
    if (typeof seen.listeners["agent/pre-step"] !== "function") fail("no agent/pre-step listener registered")
    const decision = { kind: "accept", messages: [] }
    const returned = await seen.listeners["agent/pre-step"]({ agent: {}, signal: { aborted: false } }, async () => decision)
    if (returned !== decision) fail("the listener must return the downstream decision verbatim")
    await new Promise((resolve) => setTimeout(resolve, 20))
    const recorded = JSON.parse(readFileSync(outFile, "utf8"))
    if (recorded.listed?.join(",") !== "ulw,ultrawork") fail("the listing was not recorded: " + JSON.stringify(recorded.listed))
    if (recorded.empty?.kind !== "error") fail("the empty invocation result was not recorded")
    if (recorded.filled?.kind !== "success") fail("the non-empty invocation result was not recorded")
    if (recorded.errors.length !== 0) fail("unexpected probe errors: " + recorded.errors.join("; "))

    // 3) a missing commands service is recorded, never thrown.
    const outFile2 = join(dir, "probe2.json")
    const seen2 = {}
    apply({ on: (event, listener) => { seen2[event] = listener }, get: () => undefined }, { outFile: outFile2 })
    await seen2["agent/pre-step"]({ agent: {} }, async () => decision)
    await new Promise((resolve) => setTimeout(resolve, 20))
    const recorded2 = JSON.parse(readFileSync(outFile2, "utf8"))
    if (!recorded2.errors.some((entry) => entry.includes("not mounted"))) fail("a missing commands service must be recorded")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  console.log("[ulw-command-probe self-test] ok: module contract + missing-outFile throw + verbatim decision + list/empty/filled recording + missing-service recording")
}
