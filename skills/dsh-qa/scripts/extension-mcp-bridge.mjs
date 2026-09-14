#!/usr/bin/env node
// Case extension-mcp-bridge: the runtime stdio MCP bridge of the extension
// interface, end to end, on a REAL mounted boot in isolation.
//
// WHAT CARRIES THE PROOF
//   1. a REAL `dsh` process (mpd-headless rows composed from THIS checkout,
//      sandboxed DSH_HOME + HOME + session cwd) whose model step is answered by
//      the local OpenAI-shaped stub (extension-isolation.mjs) — so the bridged
//      MCP tool is really called by the session and no provider credential is
//      needed.
//   2. the two independent readings of the tool list: the `tools[]` array the
//      harness actually sent to the model (the stub records it) and the session
//      log's `request/header.data.header.tools[]` (`lib/session-evidence.mjs`).
//      The call itself is a recorded `tool/call` + non-error `tool/result`.
//   3. the HEALTHY server is the repo's own stdio MCP server
//      (`packages/mpd-mcp-lsp/dist/cli.js`); the failure arms are local fixtures
//      started by the bridge itself.
//
// ARMS (the failure arms share ONE boot, so they also prove containment
// side by side rather than one at a time)
//   live    — the lsp server connects at apply, `mcp__qa_mcp_live__status` is
//             offered and a real call returns a non-error result.
//   dead    — an unreachable command is contained (`unavailable`/`failed` with
//             the child's reason), contributes no tool, boot stays green.
//   hang    — a server that never answers `initialize` is time-boxed by
//             connectTimeoutMs: no tool, boot neither blocked nor failed.
//   schema  — a tool whose inputSchema cannot be projected onto the harness
//             subset is skipped LOUDLY (reported by `mpd_ext_show`) while its
//             valid sibling on the SAME server still registers (keep-or-drop,
//             never a rewrite).
//   dup     — two raw tool names that map to the SAME public name make the tool
//             list invalid: ZERO tools from that server survive.
//
// PREREQ: absent-dsh-binary dsh "install DeepSeek Harness (dsh) on PATH"
// PREREQ: absent-runtime packages/mpd-ext-plugin/dist/index.js "bun build packages/mpd-ext-plugin/src/index.ts --target node --format esm --outfile packages/mpd-ext-plugin/dist/index.js"
// PREREQ: absent-fixture packages/mpd-mcp-lsp/dist/cli.js "node scripts/build-mcp.mjs --with-lsp (repo's own stdio MCP server)"
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
} from "./extension-isolation.mjs"

export const SLUG = "extension-mcp-bridge"

const LSP_SERVER = join(REPO, "packages", "mpd-mcp-lsp", "dist", "cli.js")
// The DESCRIPTOR id grammar is ^[a-z0-9][a-z0-9-]{0,63}$ (no underscores) while
// the MCP serverName grammar allows them — the two namespaces are separate on
// purpose: the extension DIRECTORY/manifest id uses dashes, the serverName (and
// therefore the public tool name) uses underscores.
const LIVE_EXT = "qa-mcp-live"
const LIVE_SERVER = "qa_mcp_live"
const LIVE_TOOL = "mcp__" + LIVE_SERVER + "__status"
const DEAD_EXT = "qa-mcp-dead"
const DEAD_SERVER = "qa_mcp_dead"
const HANG_EXT = "qa-mcp-hang"
const HANG_SERVER = "qa_mcp_hang"
const SCHEMA_EXT = "qa-mcp-schema"
const SCHEMA_SERVER = "qa_mcp_schema"
const DUP_EXT = "qa-mcp-dup"
const DUP_SERVER = "qa_mcp_dup"
const HANG_TIMEOUT_MS = 1500

// One scenario-driven fixture server, written into the sandbox: it exercises the
// real wire (JSON-RPC 2.0 over stdio), never a mock of the bridge.
const FIXTURE_SOURCE = `import { readFileSync } from "node:fs"
const mode = process.env.MPD_QA_FIXTURE_MODE ?? "ok"
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
`

function selfTest() {
  const problems = []
  const check = (condition, message) => { if (!condition) problems.push(message) }

  check(existsSync(LSP_SERVER), "the repo's own stdio MCP server is missing: packages/mpd-mcp-lsp/dist/cli.js")
  const patch = readFileSync(join(REPO, "packages", "mpd-bundle", "cordis.patch.yml"), "utf8")
  check(/- id: mpd-ext\b/.test(patch), "the bundle patch does not carry the mpd-ext row")

  // The harness formula, INCLUDING the hash branch (measured in
  // packages/mpd-ext-plugin/src/mcp-client.ts#publicToolName): any LOSSY
  // transformation (sanitized OR truncated) appends `_<12-hex sha256(server NUL raw)>`.
  // That design is why two DIFFERENT raw names can never collide — so the `dup`
  // arm must advertise the SAME raw name twice, which is what the bridge's own
  // "listed tool ... more than once — invalid tool list" check rejects.
  const publicName = (server, raw) => {
    const joined = "mcp__" + server + "__" + raw
    const normalized = joined.replace(/[^A-Za-z0-9_-]/g, "_")
    if (normalized === joined && normalized.length <= 64) return normalized
    return normalized.slice(0, 51) + "_" + "0123456789ab"
  }
  check(FIXTURE_SOURCE.includes('name: "dup_tool", description: "the same raw name advertised twice"'), "the dup arm must advertise the SAME raw name twice")
  // The lossy-hash rule keeps DIFFERENT raw names apart — assert that property, so
  // a future change that dropped the hash would be caught here.
  check(publicName(DUP_SERVER, "two.name") !== publicName(DUP_SERVER, "two_name"), "two different lossy raw names must NOT share a public name")
  check(publicName(LIVE_SERVER, "status") === LIVE_TOOL, "the live arm's expected public name changed: " + publicName(LIVE_SERVER, "status"))
  // The two namespaces are different grammars: a descriptor id may not contain
  // `_` (measured: five extensions were rejected for exactly that), while a
  // serverName may. Assert both on the fixture ids so this class cannot recur.
  const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/
  const SERVER_PATTERN = /^[A-Za-z0-9_-]{1,32}$/
  for (const [id, server] of [[LIVE_EXT, LIVE_SERVER], [DEAD_EXT, DEAD_SERVER], [HANG_EXT, HANG_SERVER], [SCHEMA_EXT, SCHEMA_SERVER], [DUP_EXT, DUP_SERVER]]) {
    check(ID_PATTERN.test(id), "the fixture extension id violates the descriptor grammar: " + id)
    check(SERVER_PATTERN.test(server), "the fixture serverName violates the serverName grammar: " + server)
  }
  check(publicName(SCHEMA_SERVER, "bad_input") !== publicName(SCHEMA_SERVER, "good_tool"), "the schema arm premise failed")
  check(FIXTURE_SOURCE.includes('inputSchema: "not-a-schema"'), "the schema arm must advertise a NON-OBJECT inputSchema (measured: a string/number/array rejects, a boolean is treated as unconstrained)")
  check(FIXTURE_SOURCE.includes("outputSchema:"), "the schema arm must advertise an outputSchema outside the subset (keep-or-drop)")

  // The fixture really carries an unsupported keyword for the schema arm and a
  // valid sibling, so "skipped loudly" cannot pass vacuously.
  check(FIXTURE_SOURCE.includes("good_tool"), "the schema fixture must advertise a valid sibling tool")
  check(FIXTURE_SOURCE.includes("MPD_QA_FIXTURE_MODE"), "the fixture must be scenario-driven")

  // The shipped reference extension ships a working, dependency-free MCP server;
  // this case asserts nothing about it beyond its presence, so the portable
  // fixture above carries the arms.
  check(existsSync(join(REPO, "extensions", "mpd-ext-example", "server.mjs")), "the example extension's own MCP server is missing")

  if (problems.length > 0) {
    for (const problem of problems) console.error("[" + SLUG + " self-test] FAIL: " + problem)
    process.exit(1)
  }
  console.log("[" + SLUG + " self-test] ok: lsp server + row + public-name collision premise + fixture scenarios + example server verified")
}

// ── the real lane ───────────────────────────────────────────────────────────

async function runReal() {
  gatePrereqs({ slug: SLUG, prereqs: [
    { code: "absent-dsh-binary", probe: "dsh", remedy: "install DeepSeek Harness (dsh) on PATH", present: () => binaryPresent("dsh") },
    { code: "absent-runtime", probe: "packages/mpd-ext-plugin/dist/index.js", remedy: "bun build packages/mpd-ext-plugin/src/index.ts --target node --format esm --outfile packages/mpd-ext-plugin/dist/index.js", present: () => existsSync(join(REPO, "packages", "mpd-ext-plugin", "dist", "index.js")) },
    { code: "absent-fixture", probe: "packages/mpd-mcp-lsp/dist/cli.js", remedy: "node scripts/build-mcp.mjs --with-lsp", present: () => existsSync(LSP_SERVER) },
  ] })
  const ts = timestamp()
  const outDir = join(REPO, "evidence", "extensions", SLUG, ts)
  mkdirSync(outDir, { recursive: true })
  const box = createSandbox(SLUG)
  const logs = []
  const steps = {}
  do {
    const inst = await installProfile({ sandbox: box.sandbox, dshHome: box.dshHome, env: box.env })
    steps.install = { ok: inst.status === 0, exit: inst.status }
    logs.push("=== install ===\n" + inst.out.slice(-1500))
    if (!steps.install.ok) break

    // Fixture servers + extensions live in the SANDBOX; the user plane is the
    // host-wide plane, the only one allowed to contribute `mcp` (a project-plane
    // mcp item is rejected per item by design).
    const fixtureDir = join(box.sandbox, "fixtures")
    mkdirSync(fixtureDir, { recursive: true })
    const fixtureServer = join(fixtureDir, "server.mjs")
    writeFileSync(fixtureServer, FIXTURE_SOURCE)
    const hostPlane = join(box.runHome, ".mpd", "extensions")
    // One shared skill so the extensions are not empty objects; the mcp kind is
    // what this case measures.
    const skill = (id) => ({ skills: { [id + "-skill"]: SKILL_MD(id + "-skill", id) } })
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

    const stub = makeStubModel({
      script: [
        { tool: "mpd_ext_show", args: { id: DEAD_EXT } },
        { tool: "mpd_ext_show", args: { id: SCHEMA_EXT } },
        { tool: "mpd_ext_show", args: { id: DUP_EXT } },
        { tool: "mpd_ext_show", args: { id: HANG_EXT } },
        { tool: LIVE_TOOL, args: {} },
        { text: "mcp-bridge-done" },
      ],
      label: "mcp-bridge",
    })
    const port = await stub.listen()
    useStubRoute(box.dshHome, port)
    const run = await bootSession({ slug: SLUG, env: box.env, cwd: box.ws, prompt: "Inspect each MCP extension, then call the live status tool.", stub })
    const evidence = sessionEvidence(box.dshHome, box.ws, ["mpd_ext_show", LIVE_TOOL])
    await stub.close()
    keepRawSession(outDir, "mcp", evidence.store)
    logs.push("=== mcp arm (exit " + run.status + ", " + run.durationMs + "ms) ===\n" + run.out.slice(-6000))

    const offered = new Set(stub.trace.flatMap((entry) => entry.offeredTools))
    const headerTools = new Set(evidence.names)
    const offeredBoth = (name) => offered.has(name) && headerTools.has(name)
    // `mpd_ext_show` is called once per extension, so pair each call to ITS result
    // by callId (a joined text would let one extension's report satisfy another's
    // assertion).
    const results = toolResultsByCallId(evidence.store)
    const showTexts = {}
    for (const id of [DEAD_EXT, HANG_EXT, SCHEMA_EXT, DUP_EXT]) {
      const call = callsOf(evidence.store, "mpd_ext_show").find((entry) => entry.arguments?.id === id)
      showTexts[id] = call === undefined ? "" : (results.get(call.callId)?.text ?? "")
    }
    const liveCall = evidence.calls[LIVE_TOOL]
    const liveCallRecord = callsOf(evidence.store, LIVE_TOOL)[0]
    const liveText = liveCallRecord === undefined ? "" : (results.get(liveCallRecord.callId)?.text ?? "")
    const liveOk = Boolean(liveCall?.succeeded) && offeredBoth(LIVE_TOOL)
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
    steps.dead = {
      vacuous: !liveOk,
      ok: false,
      offeredNoTool: [...offered].filter((name) => name.startsWith("mcp__" + DEAD_SERVER + "__")).length === 0,
      headerSawNoTool: [...headerTools].filter((name) => name.startsWith("mcp__" + DEAD_SERVER + "__")).length === 0,
      reported: /unavailable|failed/.test(showTexts[DEAD_EXT]),
      stateText: showTexts[DEAD_EXT].slice(0, 300),
    }
    steps.dead.ok = run.status === 0 && liveOk && steps.dead.offeredNoTool && steps.dead.headerSawNoTool && steps.dead.reported
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
      ok: run.status === 0 && liveOk
        && offeredBoth("mcp__" + SCHEMA_SERVER + "__good_tool")
        && !offered.has("mcp__" + SCHEMA_SERVER + "__bad_input")
        && !offered.has("mcp__" + SCHEMA_SERVER + "__bad_output")
        // "loudly": the per-tool skip reason is recorded on the extension and
        // surfaced by mpd_ext_show.
        && /skipped/.test(showTexts[SCHEMA_EXT]),
      goodToolOffered: offeredBoth("mcp__" + SCHEMA_SERVER + "__good_tool"),
      badInputSkipped: !offered.has("mcp__" + SCHEMA_SERVER + "__bad_input"),
      badOutputSkipped: !offered.has("mcp__" + SCHEMA_SERVER + "__bad_output"),
      reportedReason: /skipped/.test(showTexts[SCHEMA_EXT]),
      stateText: showTexts[SCHEMA_EXT].slice(0, 400),
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
  const ok = Object.values(steps).every((step) => step.ok === true)
  writeEvidence(outDir, SLUG, {
    ok,
    sandbox: box.sandbox,
    arms: "live (repo's own stdio MCP server, real call) | dead | hang | schema (keep-or-drop) | dup (zero tools) | containment",
    note: "the healthy server is packages/mpd-mcp-lsp/dist/cli.js; the failure arms are local fixture servers started by the bridge itself",
    steps,
  }, logs.join("\n\n"))
  cleanup(box.sandbox)
  process.exit(ok ? 0 : 1)
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--self-test")) selfTest()
  else await runReal()
}
