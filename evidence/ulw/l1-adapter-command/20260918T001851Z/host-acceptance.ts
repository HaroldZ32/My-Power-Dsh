// Evidence probe for lane L1 / task t3: the adapter's TWO new seams measured against the
// INSTALLED harness, imported by ABSOLUTE PATH.
//
// Why absolute: the acceptance criterion forbids the ADAPTER from importing any host package
// by bare specifier (`@deepseek-ai/dsh-llm` is not resolvable from this repo — measured
// MODULE_NOT_FOUND). This probe is evidence, not adapter code, so it reaches the installed
// host directly and asks the host's OWN registry whether the seam is acceptable.
//
// Run: bun run evidence/ulw/l1-adapter-command/<stamp>/host-acceptance.ts
const HOST = "/root/.nvm/versions/node/v24.16.0/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai"
const { Context } = await import(HOST + "/cordis/lib/index.js")
const commandsMod = await import(HOST + "/dsh-commands/lib/index.js")
const llm = await import(HOST + "/dsh-llm/lib/index.js")
const { createDshAdapter, userMessage } = await import("../../../../packages/mpd-dsh-adapter-plugin/src/index")

const checks: Array<{ id: string; ok: boolean; detail: string }> = []
const check = (id: string, ok: boolean, detail: string): void => {
  checks.push({ id, ok, detail })
  // Print incrementally: a later crash must not hide the checks that already ran.
  console.log((ok ? "PASS " : "FAIL ") + id + " — " + detail)
}

// ── A. name contract: the host's own parser and the registered name agree ────
const parsed = commandsMod.parseCommand("/ulw ship the wave")
check("A1.parseCommand-no-slash", parsed?.name === "ulw" && parsed?.rawInput === " ship the wave", JSON.stringify(parsed))

// ── B. a REAL host registry accepts what registerCommand passes through ──────
const ctx = new Context()
const runtime = new commandsMod.CommandRuntime(ctx)
// The durable-log handle the host writes its `command/run` / `command/done` lifecycle to.
// A double is used ONLY here; the registry, admission, dispatch and result normalization
// around it are the host's own code.
const lifecycle: Array<{ type: string; data: Record<string, unknown> }> = []
const agent = { id: "probe-agent", session: { append: (type: string, data: Record<string, unknown>) => { lifecycle.push({ type, data }); return Promise.resolve() } } }
const adapter = createDshAdapter({ get: (name: string) => (name === "commands" ? runtime : undefined) })

check("B0.capabilities-commands", adapter.capabilities().commands === true && adapter.capabilities().commandsRegister === true, JSON.stringify({ commands: adapter.capabilities().commands, commandsRegister: adapter.capabilities().commandsRegister }))

const dispose = adapter.registerCommand({
  name: "ulw",
  description: "run one ULW loop on an objective",
  input: { hint: "<objective>" },
  handler: (invocation: { rawInput?: string }) => ({ kind: "success", text: "ok" + String(invocation.rawInput ?? "") }),
})
check("B1.disposer-is-function", typeof dispose === "function", typeof dispose)

const resolved = runtime.find(agent, "ulw")
check("B2.host-resolves-definition", resolved?.name === "ulw" && resolved?.description === "run one ULW loop on an objective", JSON.stringify(resolved?.name))
const listed = runtime.list(agent).map((descriptor: { name: string }) => descriptor.name)
check("B3.host-lists-descriptor", listed.includes("ulw"), JSON.stringify(listed))

let duplicateThrew = false
try {
  adapter.registerCommand({ name: "ulw", description: "second registration of the same name", handler: () => ({ kind: "success" }) })
} catch (error) {
  duplicateThrew = String((error as Error)?.message ?? error).includes("already registered")
}
check("B4.duplicate-throws-host-side", duplicateThrew, "host duplicate rule observed through the seam")

dispose()
check("B5.disposer-unregisters", runtime.find(agent, "ulw") === undefined, JSON.stringify(runtime.list(agent).map((descriptor: { name: string }) => descriptor.name)))

// ── C. a real command EXECUTION through the host registry ───────────────────
const dispose2 = adapter.registerCommand({
  name: "ultrawork",
  description: "alias probe",
  handler: async (invocation: { rawInput?: string }) => ({ kind: "success" as const, text: "ran" + String(invocation.rawInput ?? "") }),
})
const execution = await runtime.execute(agent, "/ultrawork go", [], new AbortController().signal)
check("C1.host-executes-handler", execution?.result?.kind === "success" && execution?.result?.text === "ran go", JSON.stringify(execution?.result ?? null))
check(
  "C2.host-wrote-the-lifecycle",
  lifecycle.length === 2 && lifecycle[0]?.type === "command/run" && lifecycle[1]?.type === "command/done"
    && lifecycle[0]?.data?.name === "ultrawork" && lifecycle[0]?.data?.args === " go" && lifecycle[1]?.data?.kind === "success",
  JSON.stringify(lifecycle.map((entry) => ({ type: entry.type, keys: Object.keys(entry.data).sort() }))),
)
dispose2()

// ── D. userMessage vs the INSTALLED host constructor, field by field ─────────
const mine = userMessage({ text: "run /ulw ship it", source: { kind: "plugin", plugin: "mpd-ulw" } })
const reference = llm.createUserMessage({ content: [{ type: "text", text: "run /ulw ship it" }], source: { kind: "plugin", plugin: "mpd-ulw" } })
const { id: mineId, ...mineRest } = mine as unknown as Record<string, unknown>
const { id: referenceId, ...referenceRest } = reference as unknown as Record<string, unknown>
check("D1.keys-match-installed", Object.keys(mine).sort().join(",") === Object.keys(reference).sort().join(","), Object.keys(mine).sort().join(",") + " vs " + Object.keys(reference).sort().join(","))
// Field-wise, so the comparison cannot be fooled by (or depend on) key ORDER.
check(
  "D2.values-match-minus-id",
  mine.role === reference.role
    && JSON.stringify(mine.content) === JSON.stringify(reference.content)
    && JSON.stringify(mine.source) === JSON.stringify(reference.source)
    && Object.keys(mineRest).length === Object.keys(referenceRest).length,
  JSON.stringify(mineRest) + " vs " + JSON.stringify(referenceRest),
)
check("D3.identity-is-a-fresh-string", typeof mineId === "string" && mineId.length > 0 && mineId !== referenceId, String(mineId))
check("D4.frozen-like-the-host", Object.isFrozen(mine) && Object.isFrozen(mine.content) && Object.isFrozen(mine.source) && Object.isFrozen(reference), "both frozen")
check("D5.durable-log-serializable", JSON.stringify(structuredClone(mine)) === JSON.stringify(mine), "structuredClone round-trip")
check("D6.source-shape-accepted-by-host-types", mine.source.kind === "plugin" && (mine.source as { plugin?: string }).plugin === "mpd-ulw", JSON.stringify(mine.source))

// ── E. the adapter source imports no host package by bare specifier ─────────
const adapterSource = await Bun.file(new URL("../../../../packages/mpd-dsh-adapter-plugin/src/index.ts", import.meta.url)).text()
check("E1.no-bare-host-import", !/(?:from|import)\s*\(?\s*["']@deepseek-ai\//u.test(adapterSource), "0 bare specifier imports in the adapter source")

const failed = checks.filter((entry) => !entry.ok)
console.log(JSON.stringify({ checks, failed: failed.length, ok: failed.length === 0 }, null, 2))
process.exit(failed.length === 0 ? 0 : 1)
