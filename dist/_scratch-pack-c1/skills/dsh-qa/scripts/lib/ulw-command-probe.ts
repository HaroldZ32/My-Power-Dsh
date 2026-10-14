#!/usr/bin/env node
// QA probe plugin (user clause 2 + clause 3): mounted INSIDE a real headless boot by
// `ulw-command.ts` through a `dsh --patch` overlay, it reads the LIVE command registry
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

/** The probe row's plugin id, asserted by the case and by the offline self-test. */
export const name: string = "ulw-command-probe"

// The command registry is a harness seam; a PROBE may read it directly (the
// adapter rule binds plugin rows, not QA instrumentation), and `inject` makes the
// mount wait for the service instead of racing its registration.
/** The harness services the mount must wait for before `apply` runs. */
export const inject: readonly string[] = ["commands"]

/** The cancellation signal the probe forwards, of which it only ever reads `aborted`. */
export interface AbortLike {
  /** Whether the owning turn was cancelled before the deferred dispatch ran. */
  readonly aborted: boolean
}

/** One command descriptor as the LIVE registry listed it. */
export interface CommandDescriptor {
  /** The command name the registry answers to. */
  readonly name?: string
  /** The descriptor's help text. */
  readonly description?: string
  /** The descriptor's argument hint, when it declares one. */
  readonly input?: { readonly hint?: string }
}

/** The settled result of one `commands.execute` call. */
export interface CommandExecution {
  /** The handler's command id, echoed back by the dispatcher. */
  readonly commandId?: string
  /** The handler's own result envelope. */
  readonly result?: { readonly kind?: string; readonly text?: string }
}

/** The two-method slice of the live `commands` service this probe calls. */
export interface CommandsService {
  /**
   * @param agent The agent whose command view is listed.
   * @returns Every descriptor the live registry holds for that agent.
   */
  list(agent: unknown): readonly CommandDescriptor[]
  /**
   * @param agent The agent the command is dispatched for.
   * @param line The full command line, name and argument included.
   * @param args The already-split argument vector.
   * @param signal The cancellation signal of the invoking turn.
   * @returns The settled execution, or `undefined`/`null` when the name does not resolve.
   */
  execute(agent: unknown, line: string, args: readonly string[], signal: AbortLike): Promise<CommandExecution | undefined | null>
}

/** The `agent/pre-step` payload fields the probe reads. */
export interface PreStepPayload {
  /** The agent the step belongs to. */
  readonly agent?: unknown
  /** The turn's cancellation signal. */
  readonly signal?: AbortLike
}

/** The `agent/pre-step` waterfall listener shape the probe registers. */
export type PreStepListener = (payload: PreStepPayload, next?: () => Promise<unknown>) => Promise<unknown>

/** The harness plugin context slice the probe uses. */
export interface ProbeContext {
  /**
   * @param event The harness event name.
   * @param listener The waterfall listener to register.
   */
  on(event: string, listener: PreStepListener): void
  /**
   * @param serviceName The harness service name to resolve.
   * @returns The mounted service, or `undefined` when it is not mounted.
   */
  get?(serviceName: string): unknown
}

/** The probe row's config, as the overlay's `dsh --patch` row declares it. */
export interface ProbeConfig {
  /** Absolute path of the JSON document the probe records into; required. */
  readonly outFile?: string
  /** The objective token the non-empty invocation is dispatched with. */
  readonly objective?: string
}

/** One listed descriptor as the probe records it (every field optional in the source). */
export interface ListedDescriptor {
  /** The command name the registry listed. */
  readonly name: string | undefined
  /** The descriptor's help text. */
  readonly description: string | undefined
  /** The descriptor's argument hint, or `null` when it declares none. */
  readonly hint: string | null
}

/** One invocation's recorded result, or `null` when the name did not resolve at all. */
export interface InvocationRecord {
  /** The handler's command id, echoed back by the dispatcher. */
  readonly commandId: string | undefined
  /** The handler's result kind (`error` for the usage answer, `success` for a started run). */
  readonly kind: string | null
  /** The handler's result text; `""` when the handler produced none. */
  readonly text: string
}

/** The whole JSON document the probe writes to `config.outFile`. */
export interface ProbeRecord {
  /** ISO instant the probe ran, so a case can prove it observed the live registry. */
  at: string
  /** The objective token the non-empty invocation carried. */
  objective: string
  /** The listed command names, or `null` when the listing itself failed. */
  listed: string[] | null
  /** The listed descriptors, or `null` when the listing itself failed. */
  descriptors: ListedDescriptor[] | null
  /** The empty invocation's result, or `null` when the name did not resolve. */
  empty: InvocationRecord | null
  /** The non-empty invocation's result, or `null` when the name did not resolve. */
  filled: InvocationRecord | null
  /** Every error the probe swallowed, so a case can fail with the real cause. */
  errors: string[]
}

/**
 * Mount the probe: read the live command registry and dispatch both ULW spellings
 * once per session, recording everything into `config.outFile`.
 * @param ctx The harness plugin context the row is mounted with.
 * @param config The row config; `outFile` is required.
 * @throws When `config.outFile` is missing or empty.
 */
export function apply(ctx: ProbeContext, config: ProbeConfig = {}): void {
  // The absolute path every recording is flushed to; required, so a missing one fails loudly.
  const outFile = config?.outFile
  if (typeof outFile !== "string" || outFile.length === 0) throw new Error("ulw-command-probe: config.outFile is required")
  // The objective token the non-empty invocation is dispatched with.
  const objective = typeof config?.objective === "string" && config.objective.length > 0 ? config.objective : "qa-ulw-objective-token"
  // The record document, rewritten after every step so a crash still leaves partial evidence.
  const record: ProbeRecord = { at: new Date().toISOString(), objective, listed: null, descriptors: null, empty: null, filled: null, errors: [] }
  /** Persist the record; a write failure is recorded rather than thrown into the step. */
  const flush = (): void => {
    try { writeFileSync(outFile, JSON.stringify(record, null, 2) + "\n") } catch (error) { record.errors.push("flush: " + String((error as Error)?.message ?? error)) }
  }
  // Whether the one-shot dispatch has already been scheduled for this session.
  let fired = false

  // `agent/pre-step` is a WATERFALL: await next() first and return its decision verbatim
  // (a bare value would REPLACE the step decision). The real work is deferred so the
  // probe can never delay or alter the step it was woken by.
  ctx.on("agent/pre-step", async (payload, next) => {
    // The downstream decision, awaited so the waterfall stays untouched.
    const decision = typeof next === "function" ? await next() : undefined
    if (!fired) {
      fired = true
      // The agent the registry listing and both dispatches are scoped to.
      const agent = payload?.agent
      // The probe dispatches its own execution, so a turn signal that has already been
      // aborted by the time the deferred callback runs must not fake a cancellation:
      // fall back to a fresh, live signal in that case only.
      const turnSignal = payload?.signal
      // The signal the deferred dispatch really runs under.
      const signal = turnSignal !== undefined && turnSignal.aborted !== true ? turnSignal : new AbortController().signal
      setTimeout(() => { void run(agent, signal) }, 0)
    }
    return decision
  })

  /**
   * List the live registry and dispatch both ULW spellings, recording each step.
   * @param agent The agent the listing and dispatches are scoped to.
   * @param signal The cancellation signal the dispatches run under.
   */
  async function run(agent: unknown, signal: AbortLike): Promise<void> {
    // The mounted `commands` service, or `undefined` when the row mounted without it.
    const commands = typeof ctx.get === "function" ? ctx.get("commands") : undefined
    if (commands === undefined || commands === null) {
      record.errors.push("the commands service is not mounted")
      flush()
      return
    }
    // The live registry. The service is a harness seam the probe may read directly (the adapter
    // rule binds plugin rows, not QA instrumentation), so the two methods it calls are asserted.
    const registry = commands as CommandsService
    try {
      // Every descriptor the live registry holds for this agent.
      const descriptors = registry.list(agent)
      record.descriptors = descriptors.map((descriptor) => ({
        name: descriptor?.name,
        description: descriptor?.description,
        hint: descriptor?.input?.hint ?? null,
      }))
      record.listed = record.descriptors.map((descriptor) => descriptor.name as string)
      console.log("[ulw-command-probe] LISTED=" + record.listed.join(","))
    } catch (error) {
      record.errors.push("list: " + String((error as Error)?.message ?? error))
    }
    flush()

    // The EMPTY invocation must answer usage and start nothing. `execute` returns
    // undefined when the name does not resolve at all — recorded as null so the case
    // can tell "not registered" from "registered and answered".
    try {
      // The dispatcher's answer to the bare `/ulw` spelling.
      const empty = await registry.execute(agent, "/ulw", [], signal)
      record.empty = empty === undefined || empty === null
        ? null
        : { commandId: empty.commandId, kind: empty.result?.kind ?? null, text: empty.result?.text ?? "" }
      console.log("[ulw-command-probe] EMPTY=" + JSON.stringify(record.empty))
    } catch (error) {
      record.errors.push("empty: " + String((error as Error)?.message ?? error))
    }
    flush()

    // The NON-EMPTY invocation must START a run: the handler submits the activation
    // directive as the invoking agent's own next user turn (the adapter turn seam).
    try {
      // The dispatcher's answer to the `/ultrawork <objective>` spelling.
      const filled = await registry.execute(agent, "/ultrawork " + objective, [], signal)
      record.filled = filled === undefined || filled === null
        ? null
        : { commandId: filled.commandId, kind: filled.result?.kind ?? null, text: filled.result?.text ?? "" }
      console.log("[ulw-command-probe] FILLED=" + JSON.stringify(record.filled))
    } catch (error) {
      record.errors.push("filled: " + String((error as Error)?.message ?? error))
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
  /** Report one failed self-test assertion and end the run with exit 1; the explicit `never`
   * return type is what lets a caller guard with `if (...) fail(...)` and keep narrowing. */
  const fail: (message: string) => never = (message: string): never => { console.error("[ulw-command-probe self-test] FAIL: " + message); process.exit(1) }
  if (!process.argv.includes("--self-test")) fail("only --self-test is supported standalone")
  if (name !== "ulw-command-probe" || !inject.includes("commands")) fail("probe module contract changed")
  // The fixture root the probe's two recording arms write into.
  const dir = mkdtempSync(join(tmpdir(), "mpd-ulw-probe-selftest-"))
  try {
    // 1) a missing outFile must fail loudly at apply time (never a silent no-op).
    // Whether `apply` really refused a config without an outFile.
    let threw = false
    try { apply({ on: () => {} }, {}) } catch { threw = true }
    if (!threw) fail("apply() must throw when config.outFile is missing")

    // 2) the mounted path records the registry listing, both invocation results, and
    //    returns the waterfall decision VERBATIM.
    // The record document the mounted arm writes.
    const outFile = join(dir, "probe.json")
    // The listener the fake context captures, keyed by event name.
    const seen: { listeners: Record<string, PreStepListener | undefined> } = { listeners: {} }
    // The fake plugin context: a registry with both ULW names, and a captured listener.
    const fakeCtx: ProbeContext = {
      on: (event, listener) => { seen.listeners[event] = listener },
      get: () => ({
        list: () => [{ name: "ulw", description: "u", input: { hint: "objective" } }, { name: "ultrawork", description: "u", input: { hint: "objective" } }],
        execute: async (agent: unknown, line: string) => line === "/ulw"
          ? { commandId: "c1", result: { kind: "error", text: "usage: /ulw <objective>" } }
          : { commandId: "c2", result: { kind: "success", text: "ULW activated: " + line.slice(10) } },
      }),
    }
    apply(fakeCtx, { outFile, objective: "self-test-objective" })
    // The captured `agent/pre-step` listener, which must exist before it can be driven.
    const preStep = seen.listeners["agent/pre-step"]
    if (typeof preStep !== "function") fail("no agent/pre-step listener registered")
    // The synthetic downstream decision the listener must hand back untouched.
    const decision = { kind: "accept", messages: [] }
    // The listener's return value, which must be the SAME object the downstream produced.
    const returned = await preStep({ agent: {}, signal: { aborted: false } }, async () => decision)
    if (returned !== decision) fail("the listener must return the downstream decision verbatim")
    await new Promise((resolve) => setTimeout(resolve, 20))
    // The record document the deferred dispatch wrote.
    const recorded: ProbeRecord = JSON.parse(readFileSync(outFile, "utf8"))
    if (recorded.listed?.join(",") !== "ulw,ultrawork") fail("the listing was not recorded: " + JSON.stringify(recorded.listed))
    if (recorded.empty?.kind !== "error") fail("the empty invocation result was not recorded")
    if (recorded.filled?.kind !== "success") fail("the non-empty invocation result was not recorded")
    if (recorded.errors.length !== 0) fail("unexpected probe errors: " + recorded.errors.join("; "))

    // 3) a missing commands service is recorded, never thrown.
    // The record document the service-absence arm writes.
    const outFile2 = join(dir, "probe2.json")
    // The listener the second fake context captures, keyed by event name.
    const seen2: Record<string, PreStepListener | undefined> = {}
    apply({ on: (event, listener) => { seen2[event] = listener }, get: () => undefined }, { outFile: outFile2 })
    await seen2["agent/pre-step"]?.({ agent: {} }, async () => decision)
    await new Promise((resolve) => setTimeout(resolve, 20))
    // The record document of the service-absence arm.
    const recorded2: ProbeRecord = JSON.parse(readFileSync(outFile2, "utf8"))
    if (!recorded2.errors.some((entry) => entry.includes("not mounted"))) fail("a missing commands service must be recorded")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  console.log("[ulw-command-probe self-test] ok: module contract + missing-outFile throw + verbatim decision + list/empty/filled recording + missing-service recording")
}
