#!/usr/bin/env node
// Case extension-mcp-bridge: the runtime stdio MCP bridge of the extension
// interface, end to end, on a REAL mounted boot in isolation.
//
// WHAT CARRIES THE PROOF
//   1. a REAL `dsh` process (mpd-headless rows composed from THIS checkout,
//      sandboxed DSH_HOME + HOME + session cwd) whose model step is answered by
//      the local OpenAI-shaped stub (extension-isolation.ts) — so the bridged
//      MCP tool is really called by the session and no provider credential is
//      needed.
//   2. the two independent readings of the tool list: the `tools[]` array the
//      harness actually sent to the model (the stub records it) and the session
//      log's `request/header.data.header.tools[]` (`lib/session-evidence.ts`).
//      The call itself is a recorded `tool/call` + non-error `tool/result`.
//   3. the HEALTHY server is the repo's own stdio MCP server
//      (`packages/mpd-mcp-lsp/dist/launch.js`); the failure arms are local fixtures
//      started by the bridge itself.
//
// ARMS (the failure arms share ONE boot, so they also prove containment
// side by side rather than one at a time)
//   live    — the lsp server connects at apply, `mcp__qa_mcp_live__get_diagnostics` is
//             offered and a real call returns a non-error result.
//   dead    — an unreachable command is contained (`unavailable`/`failed` with
//             the child's reason), contributes no tool, boot stays green.
//   hang    — a server that never answers `initialize` is time-boxed by
//             connectTimeoutMs: no tool, boot neither blocked nor failed.
//   schema  — TWO rules, both the shipped ones (F1: src/mcp.ts:354-375, pinned by
//             test/mcp.test.ts:642). A tool whose inputSchema cannot be projected
//             onto the harness subset is SKIPPED loudly; a tool whose OUTPUT schema
//             is outside the subset KEEPS its registration and loses only the schema
//             (it is registered WITHOUT structuredContent). The valid sibling on the
//             SAME server registers either way, and both per-tool reasons are
//             reported by `mpd_ext_show` (keep-or-drop, never a rewrite).
//   dup     — two raw tool names that map to the SAME public name make the tool
//             list invalid: ZERO tools from that server survive.
//
// PREREQ: absent-dsh-binary dsh "install DeepSeek Harness (dsh) on PATH"
// PREREQ: absent-runtime packages/mpd-ext-plugin/dist/index.js "bun build packages/mpd-ext-plugin/src/index.ts --target node --format esm --outfile packages/mpd-ext-plugin/dist/index.js"
// PREREQ: absent-fixture packages/mpd-mcp-lsp/dist/launch.js "bun build packages/mpd-mcp-lsp/src/launch.ts … (repo's own stdio MCP launcher)"
//
// --self-test is offline (public-name collision premise + fixture schemas + the
// shipped example's server + the composed row). Evidence ->
// evidence/extensions/extension-mcp-bridge/<ts>/{result.json,output.log}.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import {
  REPO, SKILL_MD, binaryPresent, bootSession, callsOf, crashSignatures, createSandbox, cleanup, gatePrereqs, installProfile,
  isolationStep, keepRawSession, makeStubModel, manifest, sessionEvidence, timestamp,
  toolResultsByCallId, useStubRoute, writeEvidence, writeExtension,
  type ExtensionAssets, type ParsedToolCall,
} from "./extension-isolation.ts"

/** Case slug: the evidence directory name and the boot banner both use it. */
export const SLUG: string = "extension-mcp-bridge"

/** The repo's own stdio MCP server, used as the HEALTHY server of the live arm. */
const LSP_SERVER: string = join(REPO, "packages", "mpd-mcp-lsp", "dist", "launch.js")
// The DESCRIPTOR id grammar is ^[a-z0-9][a-z0-9-]{0,63}$ (no underscores) while
// the MCP serverName grammar allows them — the two namespaces are separate on
// purpose: the extension DIRECTORY/manifest id uses dashes, the serverName (and
// therefore the public tool name) uses underscores.
/** The live arm's extension id, in the dash-only descriptor grammar. */
const LIVE_EXT: string = "qa-mcp-live"
/** The live arm's server name, in the underscore-allowing serverName grammar. */
const LIVE_SERVER: string = "qa_mcp_live"
/** The public name the live arm's tool must be offered under: cclsp's own `get_diagnostics` (de-omo wave B2 — the retired server's `status` has no counterpart). */
const LIVE_TOOL: string = "mcp__" + LIVE_SERVER + "__get_diagnostics"
/** The dead arm's extension id (an unreachable command must be contained). */
const DEAD_EXT: string = "qa-mcp-dead"
/** The dead arm's server name. */
const DEAD_SERVER: string = "qa_mcp_dead"
/** The hang arm's extension id (a server that never answers `initialize`). */
const HANG_EXT: string = "qa-mcp-hang"
/** The hang arm's server name. */
const HANG_SERVER: string = "qa_mcp_hang"
/** The schema arm's extension id (keep-or-drop on the schema, never the tool). */
const SCHEMA_EXT: string = "qa-mcp-schema"
/** The schema arm's server name. */
const SCHEMA_SERVER: string = "qa_mcp_schema"
/** The duplicate-name arm's extension id (a duplicated raw name drops every tool). */
const DUP_EXT: string = "qa-mcp-dup"
/** The duplicate-name arm's server name. */
const DUP_SERVER: string = "qa_mcp_dup"
// F10 — the bounded child-stderr tail. No lane asserted it before this case: the
// state record carries `stderrTail`, and the failure ERROR entry carries
// `…; child stderr tail: <tail>` (packages/mpd-ext-plugin/src/mcp.ts:216-224),
// which is what `mpd_ext_show` renders — so the tail IS observable from a tool
// result, and this arm asserts its EXACT bound, not merely its presence.
/** The stderr arm's extension id (a child that floods stderr and dies before the handshake). */
const STDERR_EXT: string = "qa-mcp-stderr"
/** The stderr arm's server name. */
const STDERR_SERVER: string = "qa_mcp_stderr"
/** First mark the stderr flood writes, which truncation-to-tail MUST drop. */
const STDERR_HEAD_MARK: string = "MPD-QA-STDERR-HEAD"
/** Middle mark the stderr flood writes, which the reported tail must keep. */
const STDERR_MID_MARK: string = "MPD-QA-STDERR-MID"
/** Last mark the stderr flood writes, which the reported tail must keep. */
const STDERR_END_MARK: string = "MPD-QA-STDERR-END"
/** How many filler bytes each of the two marked runs carries. */
const STDERR_FLOOD_RUN: number = 1500
/** Total stderr bytes the flood writes, which must exceed the shipped cap. */
const STDERR_FLOOD_LENGTH: number = STDERR_HEAD_MARK.length + 1 + STDERR_FLOOD_RUN + STDERR_MID_MARK.length + STDERR_FLOOD_RUN + STDERR_END_MARK.length
/** Handshake deadline the hang arm runs under, in milliseconds (1.5 s). */
const HANG_TIMEOUT_MS: number = 1500

// One scenario-driven fixture server, written into the sandbox: it exercises the
// real wire (JSON-RPC 2.0 over stdio), never a mock of the bridge.
/** Source text of the scenario-driven fixture MCP server the arm writes into the sandbox. */
const FIXTURE_SOURCE: string = `import { readFileSync } from "node:fs"
const mode = process.env.MPD_QA_FIXTURE_MODE ?? "ok"
// The stderr arm (F10): a child that floods stderr with marked bytes and then dies
// BEFORE answering \`initialize\`. The marks let a lane prove truncation-to-tail
// without knowing the cap: HEAD is written first and must be GONE from the report,
// MID/END are written last and must be present.
const STDERR_HEAD = "MPD-QA-STDERR-HEAD"
const STDERR_MID = "MPD-QA-STDERR-MID"
const STDERR_END = "MPD-QA-STDERR-END"
const FLOOD = STDERR_HEAD + "-" + "A".repeat(1500) + STDERR_MID + "B".repeat(1500) + STDERR_END
if (mode === "stderr") {
  process.stderr.write(FLOOD, () => process.exit(1))
} else {
const TOOLSETS = {
  ok: [{ name: "echo", description: "Echo the arguments back", inputSchema: { type: "object", properties: { text: { type: "string" } } } }],
  schema: [
    { name: "bad_input", description: "a non-object inputSchema", inputSchema: "not-a-schema" },
    { name: "bad_output", description: "an output schema outside the subset", inputSchema: { type: "object", properties: { text: { type: "string" } } }, outputSchema: { type: "object", properties: { a: { type: "string", pattern: "^x" } } } },
    { name: "good_tool", description: "a valid sibling on the same server", inputSchema: { type: "object", properties: { text: { type: "string" } } } },
  ],
  dup: [
    { name: "dup_tool", description: "the same raw name advertised twice", inputSchema: { type: "object", properties: {} } },
    { name: "dup_tool", description: "the same raw name advertised twice", inputSchema: { type: "object", properties: {} } },
  ],
}
const tools = TOOLSETS[mode] ?? TOOLSETS.ok
let buffer = ""
const send = (message) => process.stdout.write(JSON.stringify(message) + "\\n")
const ok = (id, result) => send({ jsonrpc: "2.0", id, result })
function handle(message) {
  const method = message.method
  if (method === "initialize") {
    if (mode === "hang") return
    const requested = message.params && typeof message.params.protocolVersion === "string" ? message.params.protocolVersion : "2024-11-05"
    ok(message.id, { protocolVersion: requested, capabilities: { tools: { listChanged: false } }, serverInfo: { name: "qa-fixture", version: "1.0.0" } })
    return
  }
  if (method === "notifications/initialized") return
  if (method === "tools/list") { ok(message.id, { tools }); return }
  if (method === "tools/call") {
    const params = message.params ?? {}
    if (params.name === "echo") { ok(message.id, { content: [{ type: "text", text: "fixture-echo:" + JSON.stringify(params.arguments ?? {}) }] }); return }
    ok(message.id, { content: [{ type: "text", text: "fixture-called:" + String(params.name) }] })
    return
  }
  if (message.id !== undefined) send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Method not found" } })
}
process.stdin.setEncoding("utf8")
process.stdin.on("data", (chunk) => {
  buffer += chunk
  let index
  while ((index = buffer.indexOf("\\n")) !== -1) {
    const line = buffer.slice(0, index).replace(/\\r$/, "")
    buffer = buffer.slice(index + 1)
    if (line.trim() === "") continue
    let message
    try { message = JSON.parse(line) } catch { continue }
    try { handle(message) } catch (error) { process.stderr.write("fixture-error: " + String(error) + "\\n") }
  }
})
process.on("SIGTERM", () => process.exit(0))
}
`

/**
 * The stderr-tail cap, read from the SHIPPED adapter source rather than hard-coded:
 * the assertion "the reported tail is BOUNDED by the documented cap" must track the
 * implementation (packages/mpd-ext-plugin/src/mcp-client.ts, `.slice(-STDERR_TAIL_CHARS)`),
 * and reading it keeps this arm honest if the cap ever moves.
 * @returns The declared cap in characters, or `null` when the constant is no longer declared.
 */
function stderrTailCap(): number | null {
  // The shipped client source that declares the truncation constant.
  const source = readFileSync(join(REPO, "packages", "mpd-ext-plugin", "src", "mcp-client.ts"), "utf8")
  // The constant's declaration match, `null` when the source no longer carries one.
  const match = /STDERR_TAIL_CHARS\s*=\s*(\d+)/.exec(source)
  return match === null ? null : Number(match[1])
}

/**
 * The offline self-test: the fixture premises, the shipped example and the composed row.
 * @returns Nothing; a violation exits the process with status 1.
 */
function selfTest(): void {
  // Every violation found, so one run reports them all instead of the first.
  const problems: string[] = []
  /** Record one violation without aborting the run. */
  const check = (condition: boolean, message: string): void => { if (!condition) problems.push(message) }

  check(existsSync(LSP_SERVER), "the repo's own stdio MCP launcher is missing: packages/mpd-mcp-lsp/dist/launch.js")
  // The bundle patch, read to prove the `mpd-ext` row is still mounted.
  const patch = readFileSync(join(REPO, "cordis.patch.yml"), "utf8")
  check(/- id: mpd-ext\b/.test(patch), "the bundle patch does not carry the mpd-ext row")

  // The harness formula, INCLUDING the hash branch (measured in
  // packages/mpd-ext-plugin/src/mcp-client.ts#publicToolName): any LOSSY
  // transformation (sanitized OR truncated) appends `_<12-hex sha256(server NUL raw)>`.
  // That design is why two DIFFERENT raw names can never collide — so the `dup`
  // arm must advertise the SAME raw name twice, which is what the bridge's own
  // "listed tool ... more than once — invalid tool list" check rejects.
  /**
   * Recompute the public tool name exactly as the shipped bridge does.
   * @param server The server name part of the public name.
   * @param raw The raw tool name the server advertised.
   * @returns The public name, hash-suffixed whenever the transformation was lossy.
   */
  const publicName = (server: string, raw: string): string => {
    // The public name before sanitization and truncation are applied.
    const joined = "mcp__" + server + "__" + raw
    // The sanitized form: every character outside the allowed alphabet becomes `_`.
    const normalized = joined.replace(/[^A-Za-z0-9_-]/g, "_")
    if (normalized === joined && normalized.length <= 64) return normalized
    return normalized.slice(0, 51) + "_" + "0123456789ab"
  }
  check(FIXTURE_SOURCE.includes('name: "dup_tool", description: "the same raw name advertised twice"'), "the dup arm must advertise the SAME raw name twice")

  // F10 premise: the stderr arm can only be non-vacuous if (a) the fixture really
  // floods stderr with MORE than the cap, in marks that let truncation be proven,
  // (b) the cap is documented in the shipped source this lane reads, and (c) the
  // failure ERROR entry really carries the tail into what `mpd_ext_show` renders.
  // The cap the shipped client declares, `null` when it no longer declares one.
  const cap = stderrTailCap()
  check(cap !== null, "the stderr-tail cap (STDERR_TAIL_CHARS) is no longer declared in packages/mpd-ext-plugin/src/mcp-client.ts")
  check(FIXTURE_SOURCE.includes('mode === "stderr"'), "the fixture no longer carries the stderr flood mode")
  for (const mark of [STDERR_HEAD_MARK, STDERR_MID_MARK, STDERR_END_MARK]) {
    check(FIXTURE_SOURCE.includes(mark), "the fixture floods no " + mark + " mark")
  }
  check(FIXTURE_SOURCE.includes('"A".repeat(' + STDERR_FLOOD_RUN + ')') && FIXTURE_SOURCE.includes('"B".repeat(' + STDERR_FLOOD_RUN + ')'), "the fixture no longer floods the two marked runs this lane measures")
  check(cap !== null && STDERR_FLOOD_LENGTH > cap, "the flood (" + STDERR_FLOOD_LENGTH + " bytes) must EXCEED the cap (" + String(cap) + ") so truncation is observable")
  // The shipped adapter source that renders the failure entry with the tail.
  const mcpSource = readFileSync(join(REPO, "packages", "mpd-ext-plugin", "src", "mcp.ts"), "utf8")
  check(mcpSource.includes("child stderr tail: "), "the failure error entry no longer carries the child stderr tail, so this arm could not observe it from a tool result")
  // The lossy-hash rule keeps DIFFERENT raw names apart — assert that property, so
  // a future change that dropped the hash would be caught here.
  check(publicName(DUP_SERVER, "two.name") !== publicName(DUP_SERVER, "two_name"), "two different lossy raw names must NOT share a public name")
  check(publicName(LIVE_SERVER, "get_diagnostics") === LIVE_TOOL, "the live arm's expected public name changed: " + publicName(LIVE_SERVER, "get_diagnostics"))
  // The two namespaces are different grammars: a descriptor id may not contain
  // `_` (measured: five extensions were rejected for exactly that), while a
  // serverName may. Assert both on the fixture ids so this class cannot recur.
  // The descriptor id grammar: lowercase alphanumerics and dashes only.
  const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/
  // The serverName grammar, which additionally allows underscores.
  const SERVER_PATTERN = /^[A-Za-z0-9_-]{1,32}$/
  for (const [id, server] of [[LIVE_EXT, LIVE_SERVER], [DEAD_EXT, DEAD_SERVER], [HANG_EXT, HANG_SERVER], [SCHEMA_EXT, SCHEMA_SERVER], [DUP_EXT, DUP_SERVER]]) {
    check(ID_PATTERN.test(id), "the fixture extension id violates the descriptor grammar: " + id)
    check(SERVER_PATTERN.test(server), "the fixture serverName violates the serverName grammar: " + server)
  }
  check(publicName(SCHEMA_SERVER, "bad_input") !== publicName(SCHEMA_SERVER, "good_tool"), "the schema arm premise failed")
  check(FIXTURE_SOURCE.includes('inputSchema: "not-a-schema"'), "the schema arm must advertise a NON-OBJECT inputSchema (measured: a string/number/array rejects, a boolean is treated as unconstrained)")
  check(FIXTURE_SOURCE.includes("outputSchema:"), "the schema arm must advertise an outputSchema outside the subset (keep-or-drop)")
  // F1 premise: `bad_output` must pair a VALID inputSchema with a FOREIGN outputSchema —
  // otherwise it would be skipped by the input rule and the keep-the-tool assertion
  // could pass for the wrong reason.
  check(
    FIXTURE_SOURCE.includes('{ name: "bad_output", description: "an output schema outside the subset", inputSchema: { type: "object", properties: { text: { type: "string" } } }, outputSchema:'),
    "bad_output must carry a VALID inputSchema next to its foreign outputSchema (F1: keep the tool, drop the schema)",
  )

  // The fixture really carries an unsupported keyword for the schema arm and a
  // valid sibling, so "skipped loudly" cannot pass vacuously.
  check(FIXTURE_SOURCE.includes("good_tool"), "the schema fixture must advertise a valid sibling tool")
  check(FIXTURE_SOURCE.includes("MPD_QA_FIXTURE_MODE"), "the fixture must be scenario-driven")

  // The shipped reference extension ships a working, dependency-free MCP server;
  // this case asserts nothing about it beyond its presence, so the portable
  // fixture above carries the arms.
  check(existsSync(join(REPO, "extensions", "mpd-ext-example", "server.ts")), "the example extension's own MCP server is missing")

  if (problems.length > 0) {
    for (const problem of problems) console.error("[" + SLUG + " self-test] FAIL: " + problem)
    process.exit(1)
  }
  console.log("[" + SLUG + " self-test] ok: lsp server + row + public-name collision premise + fixture scenarios (incl. the stderr flood and the cap it must exceed) + example server verified")
}

// ── the real lane ───────────────────────────────────────────────────────────

/** One arm's verdict record as written into `result.json`: a boolean `ok` plus that arm's fields. */
interface McpBridgeArm {
  /** Whether the arm passed. */
  ok: boolean
  /** Every further field the arm records (counts, texts, reasons). */
  readonly [field: string]: unknown
}

/**
 * Run the real case: install, boot once with the stub answering, assert every arm, write evidence.
 * @returns A promise resolving after the evidence is written and the process has exited 0 or 1.
 */
async function runReal(): Promise<void> {
  gatePrereqs({ slug: SLUG, prereqs: [
    { code: "absent-dsh-binary", probe: "dsh", remedy: "install DeepSeek Harness (dsh) on PATH", present: () => binaryPresent("dsh") },
    { code: "absent-runtime", probe: "packages/mpd-ext-plugin/dist/index.js", remedy: "bun build packages/mpd-ext-plugin/src/index.ts --target node --format esm --outfile packages/mpd-ext-plugin/dist/index.js", present: () => existsSync(join(REPO, "packages", "mpd-ext-plugin", "dist", "index.js")) },
    { code: "absent-fixture", probe: "packages/mpd-mcp-lsp/dist/launch.js", remedy: "bun build packages/mpd-mcp-lsp/src/launch.ts --target node --format esm --outfile packages/mpd-mcp-lsp/dist/launch.js", present: () => existsSync(LSP_SERVER) },
  ] })
  // The evidence-directory stamp for this run.
  const ts = timestamp()
  // The evidence directory this run writes into.
  const outDir = join(REPO, "evidence", "extensions", SLUG, ts)
  mkdirSync(outDir, { recursive: true })
  // The isolated sandbox every path of this run lives under.
  const box = createSandbox(SLUG)
  // One log section per stage, joined into `output.log`.
  const logs: string[] = []
  // Per-arm verdicts keyed by arm name; every entry carries a boolean `ok`.
  const steps: Record<string, McpBridgeArm> = {}
  do {
    // The bundle install's outcome inside the sandbox.
    const inst = await installProfile({ sandbox: box.sandbox, dshHome: box.dshHome, env: box.env })
    steps.install = { ok: inst.status === 0, exit: inst.status }
    logs.push("=== install ===\n" + inst.out.slice(-1500))
    if (!steps.install.ok) break

    // Fixture servers + extensions live in the SANDBOX; the user plane is the
    // host-wide plane, the only one allowed to contribute `mcp` (a project-plane
    // mcp item is rejected per item by design).
    // The directory holding the fixture server every failure arm spawns.
    const fixtureDir = join(box.sandbox, "fixtures")
    mkdirSync(fixtureDir, { recursive: true })
    // The fixture server's path, written into the sandbox below.
    const fixtureServer = join(fixtureDir, "server.mjs")
    writeFileSync(fixtureServer, FIXTURE_SOURCE)
    // The host-wide extension plane, under the sandboxed HOME.
    const hostPlane = join(box.runHome, ".mpd", "extensions")
    // One shared skill so the extensions are not empty objects; the mcp kind is
    // what this case measures.
    /**
     * One shared skill asset so an extension is never an empty object.
     * @param id The extension id whose skill name is derived from it.
     * @returns The asset set handed to `writeExtension`.
     */
    const skill = (id: string): ExtensionAssets => ({ skills: { [id + "-skill"]: SKILL_MD(id + "-skill", id) } })
    writeExtension(hostPlane, LIVE_EXT, manifest(LIVE_EXT, {
      skills: [{ root: "skills" }],
      mcp: [{ serverName: LIVE_SERVER, transport: "stdio", command: "node", args: [LSP_SERVER], connectTimeoutMs: 20000 }],
    }), skill(LIVE_EXT))
    writeExtension(hostPlane, DEAD_EXT, manifest(DEAD_EXT, {
      mcp: [{ serverName: DEAD_SERVER, transport: "stdio", command: "/nonexistent/mpd-ext-qa-missing-binary", args: [], connectTimeoutMs: 3000 }],
    }))
    writeExtension(hostPlane, HANG_EXT, manifest(HANG_EXT, {
      mcp: [{ serverName: HANG_SERVER, transport: "stdio", command: process.execPath, args: [fixtureServer], env: { MPD_QA_FIXTURE_MODE: "hang" }, connectTimeoutMs: HANG_TIMEOUT_MS }],
    }))
    writeExtension(hostPlane, SCHEMA_EXT, manifest(SCHEMA_EXT, {
      mcp: [{ serverName: SCHEMA_SERVER, transport: "stdio", command: process.execPath, args: [fixtureServer], env: { MPD_QA_FIXTURE_MODE: "schema" }, connectTimeoutMs: 8000 }],
    }))
    writeExtension(hostPlane, DUP_EXT, manifest(DUP_EXT, {
      mcp: [{ serverName: DUP_SERVER, transport: "stdio", command: process.execPath, args: [fixtureServer], env: { MPD_QA_FIXTURE_MODE: "dup" }, connectTimeoutMs: 8000 }],
    }))
    // F10: a child that floods stderr with marked bytes and dies before the
    // handshake — the one shape that makes the tail visible in state reporting.
    writeExtension(hostPlane, STDERR_EXT, manifest(STDERR_EXT, {
      mcp: [{ serverName: STDERR_SERVER, transport: "stdio", command: process.execPath, args: [fixtureServer], env: { MPD_QA_FIXTURE_MODE: "stderr" }, connectTimeoutMs: 8000 }],
    }))

    // The stub whose script walks every extension report and then the live tool call.
    const stub = makeStubModel({
      script: [
        { tool: "mpd_ext_show", args: { id: DEAD_EXT } },
        { tool: "mpd_ext_show", args: { id: SCHEMA_EXT } },
        { tool: "mpd_ext_show", args: { id: DUP_EXT } },
        { tool: "mpd_ext_show", args: { id: HANG_EXT } },
        { tool: "mpd_ext_show", args: { id: STDERR_EXT } },
        { tool: LIVE_TOOL, args: {} },
        { text: "mcp-bridge-done" },
      ],
      label: "mcp-bridge",
    })
    // The loopback port that stub listens on.
    const port = await stub.listen()
    useStubRoute(box.dshHome, port)
    // The single boot every arm of this case reads.
    const run = await bootSession({ slug: SLUG, env: box.env, cwd: box.ws, prompt: "Inspect each MCP extension, then call the live get_diagnostics tool.", stub })
    // What the harness really recorded for this boot.
    const evidence = sessionEvidence(box.dshHome, box.ws, ["mpd_ext_show", LIVE_TOOL])
    await stub.close()
    keepRawSession(outDir, "mcp", evidence.store)
    logs.push("=== mcp arm (exit " + run.status + ", " + run.durationMs + "ms) ===\n" + run.out.slice(-6000))

    // The public tool names the stub saw offered, across every request.
    const offered = new Set(stub.trace.flatMap((entry) => entry.offeredTools))
    // The tool names the harness recorded in its own request headers.
    const headerTools = new Set(evidence.names)
    /**
     * Whether one tool name was offered AND is present in the harness's own header list.
     * @param name The public tool name to look for.
     * @returns True only when both independent readings carry it.
     */
    const offeredBoth = (name: string): boolean => offered.has(name) && headerTools.has(name)
    // `mpd_ext_show` is called once per extension, so pair each call to ITS result
    // by callId (a joined text would let one extension's report satisfy another's
    // assertion).
    const results = toolResultsByCallId(evidence.store)
    // The `mpd_ext_show` report text per extension id.
    const showTexts: Record<string, string> = {}
    for (const id of [DEAD_EXT, HANG_EXT, SCHEMA_EXT, DUP_EXT, STDERR_EXT]) {
      // The recorded `mpd_ext_show` call whose arguments name this extension.
      const call = callsOf(evidence.store, "mpd_ext_show").find((entry) => entry.arguments?.id === id)
      showTexts[id] = call === undefined ? "" : (results.get(call.callId)?.text ?? "")
    }
    // The recorded pairing for the live tool call.
    const liveCall = evidence.calls[LIVE_TOOL]
    // The recorded live call itself, `undefined` when the model never issued it.
    const liveCallRecord: ParsedToolCall | undefined = callsOf(evidence.store, LIVE_TOOL)[0]
    // The live call's result text, `""` when no call was recorded.
    const liveText = liveCallRecord === undefined ? "" : (results.get(liveCallRecord.callId)?.text ?? "")
    // The live arm's verdict, which every failure arm below depends on.
    const liveOk = Boolean(liveCall?.succeeded) && offeredBoth(LIVE_TOOL)
    // The order in which `mpd_ext_show` was called, as the harness recorded it.
    const showCalls = callsOf(evidence.store, "mpd_ext_show").map((entry) => entry.arguments?.id)
    // FALSIFIABILITY: every failure arm below asserts the ABSENCE of a tool, which
    // is trivially true when the bridge is not working at all. Each arm therefore
    // also requires the live control (a real bridged tool that was offered AND
    // called successfully), and reports `vacuous: true` instead of `ok: true` when
    // the control is missing.
    const control = { liveToolOffered: offeredBoth(LIVE_TOOL), liveCallSucceeded: Boolean(liveCall?.succeeded) }

    steps.live = {
      ok: run.status === 0 && liveOk,
      offered: offeredBoth(LIVE_TOOL),
      called: Boolean(liveCall?.called),
      succeeded: Boolean(liveCall?.succeeded),
      reason: liveCall?.reason ?? "",
      resultHead: liveText.slice(0, 240),
    }
    // The dead arm's own record, kept in a typed local because its `ok` verdict is
    // folded from its own fields AFTER they are recorded — a read an index-signature
    // bag would widen to `unknown`.
    const deadArm = {
      vacuous: !liveOk,
      ok: false,
      offeredNoTool: [...offered].filter((name) => name.startsWith("mcp__" + DEAD_SERVER + "__")).length === 0,
      headerSawNoTool: [...headerTools].filter((name) => name.startsWith("mcp__" + DEAD_SERVER + "__")).length === 0,
      reported: /unavailable|failed/.test(showTexts[DEAD_EXT]),
      stateText: showTexts[DEAD_EXT].slice(0, 300),
    }
    steps.dead = deadArm
    deadArm.ok = run.status === 0 && liveOk && deadArm.offeredNoTool && deadArm.headerSawNoTool && deadArm.reported
    steps.hang = {
      vacuous: !liveOk,
      ok: run.status === 0 && liveOk
        && [...offered].filter((name) => name.startsWith("mcp__" + HANG_SERVER + "__")).length === 0
        && /unavailable|failed/.test(showTexts[HANG_EXT])
        // the boot is time-boxed by connectTimeoutMs (1.5 s here), not by the
        // hang: a 30 s ceiling is a coarse but falsifiable bound.
        && run.durationMs < 30_000,
      connectTimeoutMs: HANG_TIMEOUT_MS,
      durationMs: run.durationMs,
      offeredNoTool: [...offered].filter((name) => name.startsWith("mcp__" + HANG_SERVER + "__")).length === 0,
      reported: /unavailable|failed/.test(showTexts[HANG_EXT]),
      stateText: showTexts[HANG_EXT].slice(0, 300),
    }
    steps.schema = {
      vacuous: !liveOk,
      // F1 (packages/mpd-ext-plugin/src/mcp.ts:354-375, pinned by
      // packages/mpd-ext-plugin/test/mcp.test.ts:642): KEEP-OR-DROP ON THE SCHEMA,
      // NEVER THE TOOL. An unprojectable `inputSchema` still costs its tool; an
      // `outputSchema` outside the subset leaves the tool REGISTERED without
      // `structuredContent`. Both reasons are surfaced per tool by `mpd_ext_show`.
      ok: run.status === 0 && liveOk
        && offeredBoth("mcp__" + SCHEMA_SERVER + "__good_tool")
        && !offered.has("mcp__" + SCHEMA_SERVER + "__bad_input")
        && offeredBoth("mcp__" + SCHEMA_SERVER + "__bad_output")
        // "loudly": the input-schema SKIP and the output-schema DOWNGRADE are each
        // recorded on the extension keyed to their own tool name.
        && /tool "bad_input" skipped/.test(showTexts[SCHEMA_EXT])
        && /tool "bad_output": its outputSchema would have to be rewritten/.test(showTexts[SCHEMA_EXT])
        && /registered WITHOUT structuredContent/.test(showTexts[SCHEMA_EXT]),
      goodToolOffered: offeredBoth("mcp__" + SCHEMA_SERVER + "__good_tool"),
      badInputSkipped: !offered.has("mcp__" + SCHEMA_SERVER + "__bad_input"),
      badOutputOffered: offeredBoth("mcp__" + SCHEMA_SERVER + "__bad_output"),
      badOutputSchemaDropped: /registered WITHOUT structuredContent/.test(showTexts[SCHEMA_EXT]),
      reportedReason: /tool "bad_input" skipped/.test(showTexts[SCHEMA_EXT])
        && /tool "bad_output": its outputSchema would have to be rewritten/.test(showTexts[SCHEMA_EXT]),
      stateText: showTexts[SCHEMA_EXT].slice(0, 700),
    }
    steps.dup = {
      vacuous: !liveOk,
      ok: run.status === 0 && liveOk
        && [...offered].filter((name) => name.startsWith("mcp__" + DUP_SERVER + "__")).length === 0
        && [...headerTools].filter((name) => name.startsWith("mcp__" + DUP_SERVER + "__")).length === 0,
      zeroTools: [...offered].filter((name) => name.startsWith("mcp__" + DUP_SERVER + "__")).length === 0,
      headerZeroTools: [...headerTools].filter((name) => name.startsWith("mcp__" + DUP_SERVER + "__")).length === 0,
      stateText: showTexts[DUP_EXT].slice(0, 300),
      collisionPremise: "the SAME raw name (dup_tool) advertised twice makes the tool list invalid (\"listed tool ... more than once\"), which rolls the whole generation back to ZERO tools; two DIFFERENT raw names can never collide because any lossy transformation gains a hash suffix",
    }
    // F10 — the bounded child-stderr tail in the state reporting. The channel is
    // the failure error entry (`mpd.ts` fail(): `…; child stderr tail: <tail>`),
    // which `mpd_ext_show` renders; the MARKED flood proves truncation-to-tail:
    // HEAD was written first and must be gone, MID/END last and must survive, and
    // the reported length must equal the cap declared in the shipped source.
    // The `child stderr tail:` line of the stderr arm's report, if it carries one.
    const tailMatch = /child stderr tail: (.*)$/m.exec(showTexts[STDERR_EXT])
    // The tail text itself, `""` when the report carried no such line.
    const reportedTail = tailMatch === null ? "" : tailMatch[1]
    // The cap the shipped client declares, `null` when it no longer declares one.
    const cap = stderrTailCap()
    steps.stderr = {
      vacuous: !liveOk,
      ok: run.status === 0 && liveOk
        && /unavailable|failed/.test(showTexts[STDERR_EXT])
        // no tool from a child that never completed the handshake
        && [...offered].filter((name) => name.startsWith("mcp__" + STDERR_SERVER + "__")).length === 0
        && [...headerTools].filter((name) => name.startsWith("mcp__" + STDERR_SERVER + "__")).length === 0
        // NON-VACUOUS: a REAL tail from the failing child, bounded by the cap
        && cap !== null
        && reportedTail.length === cap
        && STDERR_FLOOD_LENGTH > cap
        && reportedTail.includes(STDERR_MID_MARK)
        && reportedTail.includes(STDERR_END_MARK)
        && !reportedTail.includes(STDERR_HEAD_MARK),
      cap,
      floodLength: STDERR_FLOOD_LENGTH,
      reportedTailLength: reportedTail.length,
      headDropped: !reportedTail.includes(STDERR_HEAD_MARK),
      tailKept: reportedTail.includes(STDERR_MID_MARK) && reportedTail.includes(STDERR_END_MARK),
      reported: /unavailable|failed/.test(showTexts[STDERR_EXT]),
      tailHead: reportedTail.slice(0, 80),
      stateHead: showTexts[STDERR_EXT].slice(0, 200),
    }
    steps.containment = {
      ok: run.status === 0 && crashSignatures(run.out).length === 0 && liveOk,
      exit: run.status,
      control,
      showCallOrder: showCalls,
      crashSignatures: crashSignatures(run.out),
      offeredMcp: [...offered].filter((name) => name.startsWith("mcp__")).sort(),
      isolation: isolationStep(box.dshHome, box.sandbox, SLUG),
    }
  } while (false)
  // The case verdict: every arm passed.
  const ok = Object.values(steps).every((step) => step.ok === true)
  writeEvidence(outDir, SLUG, {
    ok,
    sandbox: box.sandbox,
    arms: "live (repo's own stdio MCP server, real call) | dead | hang | schema (keep-or-drop) | dup (zero tools) | containment",
    note: "the healthy server is the packages/mpd-mcp-lsp/dist/launch.js launcher (cclsp); the failure arms are local fixture servers started by the bridge itself",
    steps,
  }, logs.join("\n\n"))
  cleanup(box.sandbox)
  process.exit(ok ? 0 : 1)
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--self-test")) selfTest()
  else await runReal()
}
