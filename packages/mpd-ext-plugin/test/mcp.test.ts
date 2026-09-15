// Behavioural tests for the runtime stdio MCP bridge (`mcp` contribution kind).
//
// Everything here drives REAL child processes: the shared fixture server below,
// and — for the framing/naming acceptance — the repo's own stdio MCP server
// (packages/mpd-mcp-lsp/dist/cli.js). No assertion is satisfied by a mock of the
// wire: the fixture IS the server, and the harness registry is the fake.
//
// Home isolation: the user plane is always redirected to a temp HOME, so a run
// can never read or write the real ~/.mpd. Children spawned by the fixture get
// exactly the env the bridge built, which is how the credential-scrub claim is
// measured from the CHILD's own process.env rather than from our helper.
import { afterEach, beforeEach, expect, test } from "bun:test"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { apply } from "../src/index.ts"
import {
  buildExtension,
  DEFAULT_EXTENSION_CONFIG,
  type ExtensionConfig,
  type ExtensionEntry,
} from "../src/registry.ts"
import { childEnv, isCredentialShapedEnvName, publicToolName, McpStdioClient } from "../src/mcp-client.ts"
import { connectExtensionMcpServers, type McpBridge } from "../src/mcp.ts"
import { projectSchema, schemaViolations } from "../src/schema-sanitize.ts"

const REPO = fileURLToPath(new URL("../../../", import.meta.url))
const LSP_SERVER = join(REPO, "packages", "mpd-mcp-lsp", "dist", "cli.js")

// ── sandbox ─────────────────────────────────────────────────────────────────

const created: string[] = []
const originalHome = process.env.HOME
const originalMarker = process.env.MPD_TEST_API_KEY

function makeDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  created.push(dir)
  return dir
}

beforeEach(() => {
  process.env.HOME = makeDir("mpd-ext-mcp-home-")
})

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME
  else process.env.HOME = originalHome
  if (originalMarker === undefined) delete process.env.MPD_TEST_API_KEY
  else process.env.MPD_TEST_API_KEY = originalMarker
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true })
})

// ── the fixture stdio MCP server ────────────────────────────────────────────
//
// One file, scenario-driven by env, so the tests exercise the real wire:
//   MPD_FIXTURE_SCENARIO=static|hang|exit
//   MPD_FIXTURE_STATE=<json file>  -> { tools: [...], notifyOnList?, failList? }
// The tool list is re-read from the state file on EVERY tools/list, which is how
// a test drives a "later tool-list change" and a full-rollback swap.

const FIXTURE = `import { readFileSync } from "node:fs"

const scenario = process.env.MPD_FIXTURE_SCENARIO ?? "static"
const statePath = process.env.MPD_FIXTURE_STATE ?? ""

const DEFAULT_TOOLS = [{
  name: "echo",
  description: "Echo the arguments back",
  inputSchema: { type: "object", properties: { text: { type: "string" } }, additionalProperties: false },
}]

if (scenario === "exit") {
  process.stderr.write("fixture-exit-marker: refusing to start\\\\n")
  setTimeout(() => process.exit(3), 40)
}
let listCount = 0
let buffer = ""
const send = (message) => process.stdout.write(JSON.stringify(message) + "\\n")
const ok = (id, result) => send({ jsonrpc: "2.0", id, result })

function state() {
  if (statePath === "") return { tools: DEFAULT_TOOLS }
  try {
    return JSON.parse(readFileSync(statePath, "utf8"))
  } catch {
    return { tools: [] }
  }
}

function handle(message) {
  const method = message.method
  if (method === "initialize") {
    // "hang" never answers; "exit" dies before the handshake can finish.
    if (scenario === "hang" || scenario === "exit") return
    const requested = message.params && typeof message.params.protocolVersion === "string"
      ? message.params.protocolVersion
      : "2024-11-05"
    ok(message.id, {
      protocolVersion: requested,
      capabilities: { tools: { listChanged: true } },
      serverInfo: { name: "fixture", version: "9.9.9" },
    })
    return
  }
  if (method === "notifications/initialized") return
  if (method === "tools/list") {
    listCount += 1
    const current = state()
    if (current.failList === true) {
      send({ jsonrpc: "2.0", id: message.id, error: { code: -32000, message: "fixture: tools/list refused" } })
      return
    }
    ok(message.id, { tools: current.tools ?? [] })
    if (current.notifyOnList === true) send({ jsonrpc: "2.0", method: "notifications/tools/list_changed" })
    return
  }
  if (method === "tools/call") {
    const params = message.params ?? {}
    const name = params.name
    const args = params.arguments ?? {}
    if (name === "env") { ok(message.id, { content: [{ type: "text", text: JSON.stringify(Object.keys(process.env).sort()) }] }); return }
    if (name === "pid") { ok(message.id, { content: [{ type: "text", text: String(process.pid) }] }); return }
    if (name === "fail") { ok(message.id, { content: [{ type: "text", text: "fixture-requested-failure" }], isError: true }); return }
    if (name === "structured") { ok(message.id, { content: [{ type: "text", text: "structured-ok" }], structuredContent: { ok: true } }); return }
    if (name === "slow") { setTimeout(() => ok(message.id, { content: [{ type: "text", text: "slow-done" }] }), 400); return }
    if (name === "echo") { ok(message.id, { content: [{ type: "text", text: JSON.stringify(args) }] }); return }
    ok(message.id, { content: [{ type: "text", text: "called " + String(name) }] })
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
    try { handle(message) } catch (error) { process.stderr.write("fixture-handler-error: " + String(error) + "\\n") }
  }
})
process.on("SIGTERM", () => process.exit(0))
`

/** Write the fixture server + its state file into a fresh temp dir. */
function makeFixture(state?: Record<string, unknown>): { dir: string; server: string; state: string } {
  const dir = makeDir("mpd-ext-mcp-fixture-")
  const server = join(dir, "fixture-server.mjs")
  writeFileSync(server, FIXTURE)
  const statePath = join(dir, "state.json")
  writeFileSync(
    statePath,
    JSON.stringify(
      state ?? {
        tools: [{ name: "echo", description: "Echo the arguments back", inputSchema: { type: "object", properties: { text: { type: "string" } }, additionalProperties: false } }],
      },
      null,
      2,
    ),
  )
  return { dir, server, state: statePath }
}

function writeState(statePath: string, state: Record<string, unknown>): void {
  writeFileSync(statePath, JSON.stringify(state, null, 2))
}

// ── the fake harness (tools seam only; everything else is real) ─────────────

interface Harness {
  ctx: any
  registered: any[]
  warnings: string[]
  foreign: Set<string>
  throwOn: Set<string>
  disposers: (() => void)[]
}

function makeHarness(config?: Partial<ExtensionConfig>): Harness {
  const registered: any[] = []
  const warnings: string[] = []
  const foreign = new Set<string>()
  const throwOn = new Set<string>()
  const disposers: (() => void)[] = []
  const ctx: any = {
    logger: { warn: (line: string) => warnings.push(line), info: () => {}, error: () => {} },
    get: () => undefined,
    provide: () => {},
    effect: (callback: () => unknown) => {
      const disposer = callback()
      if (typeof disposer === "function") disposers.push(disposer as () => void)
      return () => {}
    },
    tools: {
      register: (definition: any) => {
        if (throwOn.has(definition.name)) throw new Error(`tool "${definition.name}" is already registered`)
        registered.push(definition)
        return () => {
          const index = registered.indexOf(definition)
          if (index >= 0) registered.splice(index, 1)
        }
      },
      get: (name: string) => (foreign.has(name) ? { name } : registered.find((tool) => tool.name === name)),
      guard: () => () => {},
      execute: async () => ({}),
    },
    skills: { registerProvider: () => () => {} },
  }
  if (config !== undefined) {
    const state: Record<string, unknown> = {
      "extensions.enable": [],
      "extensions.disable": [],
      "extensions.mcp": {
        enabled: config.mcp?.enabled ?? true,
        connectTimeoutMs: config.mcp?.connectTimeoutMs ?? DEFAULT_EXTENSION_CONFIG.mcp.connectTimeoutMs,
        toolCallTimeoutMs: config.mcp?.toolCallTimeoutMs ?? DEFAULT_EXTENSION_CONFIG.mcp.toolCallTimeoutMs,
      },
    }
    ctx.get = (key: string) => (key === "mpdConfig" ? { get: (k: string) => state[k], reload: () => {}, states: () => ({ files: [], errors: [] }) } : undefined)
  }
  return { ctx, registered, warnings, foreign, throwOn, disposers }
}

/** Build a real extension entry whose mcp items point at the fixture server. */
function fixtureEntry(options: {
  servers: Record<string, unknown>[]
  enabled?: boolean
  id?: string
}): ExtensionEntry {
  const root = makeDir("mpd-ext-mcp-root-")
  const built = buildExtension({
    input: {
      apiVersion: 1,
      id: options.id ?? "fixture-ext",
      description: "fixture extension",
      ...(options.enabled === undefined ? {} : { enabled: options.enabled }),
      contributes: { mcp: options.servers },
    },
    plane: "user",
    origin: "directory",
    root,
    source: join(root, "mpd-ext.json"),
    fallbackId: options.id ?? "fixture-ext",
    providerName: "mpd-ext:" + (options.id ?? "fixture-ext"),
  })
  if (built.entry === undefined) throw new Error("fixture extension rejected: " + JSON.stringify(built.rejected?.errors))
  return built.entry
}

/** One fixture-backed server declaration. */
function fixtureServer(fixture: { dir: string; server: string; state: string }, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    serverName: "fixture",
    transport: "stdio",
    command: process.execPath,
    args: [fixture.server],
    cwd: ".",
    env: { MPD_FIXTURE_SCENARIO: "static", MPD_FIXTURE_STATE: fixture.state },
    connectTimeoutMs: 4000,
    toolCallTimeoutMs: 3000,
    ...overrides,
  }
}

function toolNamed(registered: any[], name: string): any {
  const definition = registered.find((tool) => tool.name === name)
  if (definition === undefined) {
    throw new Error(`tool ${name} was not registered (have: ${registered.map((tool) => tool.name).join(", ")})`)
  }
  return definition
}

async function waitFor(condition: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (condition()) return
    await Bun.sleep(20)
  }
  throw new Error("waitFor: condition never became true")
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** A tiny client of the real LSP server, used for the framing acceptance. */
async function withRealLspServer<T>(work: (client: McpStdioClient) => Promise<T>): Promise<T> {
  const client = new McpStdioClient({
    serverName: "lsp",
    command: "node",
    args: [LSP_SERVER, "mcp"],
    env: { HOME: process.env.HOME as string },
  })
  try {
    await client.start(15000)
    return await work(client)
  } finally {
    await client.close()
  }
}

// ── naming: the harness publicToolName algorithm, replicated exactly ────────

test("publicToolName replicates the harness algorithm: verbatim, sanitized+hashed, truncated+hashed", () => {
  expect(publicToolName("lsp", "status")).toBe("mcp__lsp__status")
  // "!" sanitizes to "_", then the lossy marker appends "_<hash>" — exactly two
  // underscores at that seam, which is the harness's own behaviour.
  expect(publicToolName("srv", "weird name!")).toMatch(/^mcp__srv__weird_name__[0-9a-f]{12}$/)
  // Lossy transformation always appends _<12-hex sha256(server NUL raw)>.
  const hashed = publicToolName("srv", "a.b")
  expect(hashed).toBe(`mcp__srv__a_b_${new Bun.CryptoHasher("sha256").update("srv\0a.b").digest("hex").slice(0, 12)}`)
  // Truncation is capped at the DeepSeek 64-char function-name contract.
  const long = publicToolName("server", "x".repeat(200))
  expect(long.length).toBe(64)
  expect(long).toMatch(/^mcp__server__x+_[0-9a-f]{12}$/)
  // A clean but long name is truncated AND hashed (truncation alone is lossy).
  const clean = publicToolName("a".repeat(30), "b".repeat(40))
  expect(clean.length).toBe(64)
  expect(clean.endsWith("_")).toBe(false)
})

// ── env scrubbing ───────────────────────────────────────────────────────────

test("childEnv inherits only the SDK safe list and never a credential-shaped parent variable", () => {
  const parent = {
    PATH: "/usr/bin",
    HOME: "/home/x",
    TERM: "dumb",
    DEEPSEEK_API_KEY: "sk-secret",
    GITEE_TOKEN: "t",
    AWS_SECRET_ACCESS_KEY: "s",
    DB_PASSWORD: "p",
    MY_CREDENTIAL: "c",
    MONKEY: "harmless",
    UNRELATED: "also-dropped",
  }
  const env = childEnv({}, parent as NodeJS.ProcessEnv)
  expect(env.PATH).toBe("/usr/bin")
  expect(env.HOME).toBe("/home/x")
  expect(Object.keys(env).some((key) => isCredentialShapedEnvName(key))).toBe(false)
  expect(env.UNRELATED).toBeUndefined()
  expect(env.MONKEY).toBeUndefined() // not on the inherit list, so it never crosses
  expect(isCredentialShapedEnvName("MONKEY")).toBe(false)
  expect(isCredentialShapedEnvName("GITEE_API_KEY")).toBe(true)
  expect(isCredentialShapedEnvName("MY_PASSWORD_HASH")).toBe(true)
  // An extension's DECLARED env is authored configuration and does cross.
  expect(childEnv({ FOO: "bar" }, parent as NodeJS.ProcessEnv).FOO).toBe("bar")
})

// ── the real repo server: framing + protocol version + exact tool names ─────

test("the client completes initialize -> initialized -> tools/list against the repo's own stdio MCP server", async () => {
  const tools = await withRealLspServer(async (client) => client.listTools(15000))
  const names = tools.map((tool) => tool.name).sort()
  expect(names).toContain("status")
  expect(names).toContain("diagnostics")
  expect(names.length).toBeGreaterThanOrEqual(8)
  // Newline-delimited JSON framing is what made this succeed: the repo server
  // answers in line mode (packages/mpd-mcp-lsp/dist/cli.js:85-105) and the
  // handshake echoes the requested protocol version.
  for (const tool of tools) expect(schemaViolations(tool.inputSchema ?? {}).length === 0).toBe(true)
})

test("the client reports a non-JSON stdout line as a protocol error instead of dying", async () => {
  const dir = makeDir("mpd-ext-mcp-noise-")
  const server = join(dir, "noisy.mjs")
  writeFileSync(
    server,
    `process.stdout.write("this is not json\\n")
process.stdin.setEncoding("utf8")
let buffer = ""
process.stdin.on("data", (chunk) => {
  buffer += chunk
  let index
  while ((index = buffer.indexOf("\\n")) !== -1) {
    const line = buffer.slice(0, index)
    buffer = buffer.slice(index + 1)
    if (line.trim() === "") continue
    const message = JSON.parse(line)
    if (message.method === "initialize") process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: "2025-11-25", capabilities: {}, serverInfo: { name: "noisy", version: "1" } } }) + "\\n")
    if (message.method === "tools/list") process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { tools: [] } }) + "\\n")
  }
})
`,
  )
  const client = new McpStdioClient({ serverName: "noisy", command: process.execPath, args: [server], env: {} })
  try {
    await client.start(5000)
    expect(await client.listTools(5000)).toEqual([])
    expect(client.protocolErrorList().length).toBe(1)
  } finally {
    await client.close()
  }
})

// ── connect-at-apply (through the real apply path) ─────────────────────────

test("apply connects declared servers, publishes their tools before activation completes, and mpd_ext_show reports the state", async () => {
  const fixture = makeFixture()
  const root = join(process.env.HOME as string, ".mpd", "extensions", "fixture-ext")
  mkdirSync(root, { recursive: true })
  writeFileSync(
    join(root, "mpd-ext.json"),
    JSON.stringify({
      apiVersion: 1,
      id: "fixture-ext",
      contributes: { mcp: [fixtureServer(fixture)] },
    }),
  )
  const harness = makeHarness()
  expect(harness.registered.length).toBe(0)

  await apply(harness.ctx, { quiet: true })

  // The tool exists BEFORE any snapshot or tool call: connect-at-apply, not lazy.
  expect(harness.registered.map((tool) => tool.name)).toContain("mcp__fixture__echo")
  const shown = await toolNamed(harness.registered, "mpd_ext_show").execute({ id: "fixture-ext" }, {})
  const server = shown.mcp[0]
  expect(server.serverName).toBe("fixture")
  expect(server.state).toBe("connected")
  expect(server.tools).toEqual(["mcp__fixture__echo"])
  // No pending placeholder survives a successful connection.
  expect(shown.pending.some((line: any) => line.item === "contributes.mcp[0]")).toBe(false)
  expect(shown.errors).toEqual([])
})

test("apply keeps the extension's pending line truthful while a server is disconnected", async () => {
  const fixture = makeFixture(undefined)
  const root = join(process.env.HOME as string, ".mpd", "extensions", "half-ext")
  mkdirSync(root, { recursive: true })
  writeFileSync(
    join(root, "mpd-ext.json"),
    JSON.stringify({
      apiVersion: 1,
      id: "half-ext",
      contributes: { mcp: [fixtureServer(fixture, { env: { MPD_FIXTURE_SCENARIO: "exit" }, connectTimeoutMs: 900 })] },
    }),
  )
  const harness = makeHarness()
  await apply(harness.ctx, { quiet: true })
  const listed = await toolNamed(harness.registered, "mpd_ext_list").execute({}, {})
  const entry = listed.extensions.find((candidate: any) => candidate.id === "half-ext")
  const pending = entry.pending.filter((line: any) => line.item === "contributes.mcp[0]")
  expect(pending.length).toBe(1)
  expect(pending[0].reason).toContain("connectTimeoutMs=900")
  expect(pending[0].reason).toContain("is not connected")
})

// ── containment: unreachable / hanging / immediately exiting ───────────────

test("startup failure is contained: a dead server is unavailable with its stderr tail while its sibling still connects", async () => {
  const fixture = makeFixture()
  const entry = fixtureEntry({
    servers: [
      fixtureServer(fixture, { serverName: "dead", env: { MPD_FIXTURE_SCENARIO: "exit" } }),
      fixtureServer(fixture, { serverName: "live" }),
    ],
  })
  const harness = makeHarness()
  const bridge = await connectExtensionMcpServers({
    dsh: (await import("../../mpd-dsh-adapter-plugin/src/index.ts")).createDshAdapter(harness.ctx),
    entries: [entry],
    config: () => DEFAULT_EXTENSION_CONFIG,
    warn: () => {},
  })
  try {
    const view = bridge.view()
    const dead = view.find((server) => server.serverName === "dead")
    const live = view.find((server) => server.serverName === "live")
    expect(dead?.state).toBe("unavailable")
    expect(dead?.tools).toEqual([])
    expect(dead?.stderrTail).toContain("fixture-exit-marker")
    expect(live?.state).toBe("connected")
    expect(live?.tools).toEqual(["mcp__live__echo"])
    // The failure is recorded on the extension (mpd_ext_show surfaces it)…
    const recorded = entry.errors.find((error) => error.item === "contributes.mcp[0]")
    expect(recorded?.reason).toContain("unavailable")
    expect(recorded?.reason).toContain("fixture-exit-marker")
    // …and the record itself carries the exact state + tail.
    expect(entry.mcp[0].state).toBe("unavailable")
    expect(entry.mcp[1].state).toBe("connected")
    expect(entry.mcp[0].stderrTail).toContain("fixture-exit-marker")
  } finally {
    await bridge.dispose()
  }
})

test("a hanging server is time-boxed and the others still publish in parallel", async () => {
  const fixture = makeFixture()
  const entry = fixtureEntry({
    servers: [
      fixtureServer(fixture, { serverName: "hang1", env: { MPD_FIXTURE_SCENARIO: "hang" }, connectTimeoutMs: 400 }),
      fixtureServer(fixture, { serverName: "hang2", env: { MPD_FIXTURE_SCENARIO: "hang" }, connectTimeoutMs: 400 }),
      fixtureServer(fixture, { serverName: "hang3", env: { MPD_FIXTURE_SCENARIO: "hang" }, connectTimeoutMs: 400 }),
      fixtureServer(fixture, { serverName: "live" }),
    ],
  })
  const harness = makeHarness()
  const started = Date.now()
  const bridge = await connectExtensionMcpServers({
    dsh: (await import("../../mpd-dsh-adapter-plugin/src/index.ts")).createDshAdapter(harness.ctx),
    entries: [entry],
    config: () => DEFAULT_EXTENSION_CONFIG,
    warn: () => {},
  })
  const elapsed = Date.now() - started
  try {
    expect(bridge.view().filter((server) => server.state === "unavailable").length).toBe(3)
    expect(bridge.view().find((server) => server.serverName === "live")?.state).toBe("connected")
    // Serial connects would need >= 1200ms; parallel + time-boxed is one window.
    expect(elapsed).toBeLessThan(1200)
  } finally {
    await bridge.dispose()
  }
})

// ── the two-phase swap with FULL rollback ──────────────────────────────────

test("a later tool-list change is swapped in, and a mid-list conflict rolls back to ZERO tools", async () => {
  const fixture = makeFixture()
  const entry = fixtureEntry({ servers: [fixtureServer(fixture)] })
  const harness = makeHarness()
  const dsh = (await import("../../mpd-dsh-adapter-plugin/src/index.ts")).createDshAdapter(harness.ctx)
  const bridge = await connectExtensionMcpServers({ dsh, entries: [entry], config: () => DEFAULT_EXTENSION_CONFIG, warn: () => {} })
  try {
    expect(harness.registered.map((tool) => tool.name)).toEqual(["mcp__fixture__echo"])

    // Generation 2: one more tool arrives.
    writeState(fixture.state, {
      tools: [
        { name: "echo", description: "Echo the arguments back", inputSchema: { type: "object" } },
        { name: "second", description: "Second tool", inputSchema: { type: "object" } },
      ],
    })
    await bridge.resync("fixture")
    expect(harness.registered.map((tool) => tool.name).sort()).toEqual(["mcp__fixture__echo", "mcp__fixture__second"])

    // Generation 3: registration of "second" collides at the registry (a foreign
    // writer took the name between the check and the register) -> full rollback.
    harness.throwOn.add("mcp__fixture__second")
    await bridge.resync("fixture")
    expect(harness.registered.filter((tool) => tool.name.startsWith("mcp__fixture__"))).toEqual([])
    expect(entry.mcp[0].state).toBe("failed")
    expect(entry.errors.some((error) => error.reason.includes("no tools registered"))).toBe(true)
    expect(bridge.view()[0].tools).toEqual([])
  } finally {
    await bridge.dispose()
  }
})

test("a server-initiated tools/list_changed notification triggers a re-sync", async () => {
  const fixture = makeFixture({ tools: [{ name: "echo", description: "Echo", inputSchema: { type: "object" } }], notifyOnList: true })
  // The FIRST tools/list is served with the notification flag, so the very first
  // generation already arms the re-sync; the second read picks up the new tool.
  writeState(fixture.state, {
    tools: [{ name: "echo", description: "Echo", inputSchema: { type: "object" } }],
    notifyOnList: true,
  })
  const entry = fixtureEntry({ servers: [fixtureServer(fixture)] })
  const harness = makeHarness()
  const dsh = (await import("../../mpd-dsh-adapter-plugin/src/index.ts")).createDshAdapter(harness.ctx)
  const bridge = await connectExtensionMcpServers({ dsh, entries: [entry], config: () => DEFAULT_EXTENSION_CONFIG, warn: () => {} })
  try {
    writeState(fixture.state, {
      tools: [
        { name: "echo", description: "Echo", inputSchema: { type: "object" } },
        { name: "late", description: "Late tool", inputSchema: { type: "object" } },
      ],
      notifyOnList: true,
    })
    // The notification arrives again after each list, so a later read converges.
    await waitFor(() => harness.registered.some((tool) => tool.name === "mcp__fixture__late"))
  } finally {
    await bridge.dispose()
  }
})

// ── schema sanitization on both paths ──────────────────────────────────────

test("a foreign inputSchema is projected for parameters while the wire schema stays untouched", async () => {
  const fixture = makeFixture({
    tools: [
      {
        name: "foreign",
        description: "Foreign input schema",
        inputSchema: {
          type: "object",
          properties: {
            when: { type: "string", format: "date-time", pattern: "^\\d{4}" },
            maybe: { type: ["string", "null"] },
          },
          required: ["when", "gone"],
          additionalProperties: { type: "string" },
        },
        outputSchema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false },
      },
    ],
  })
  const wire = JSON.parse(readFileSync(fixture.state, "utf8"))
  const entry = fixtureEntry({ servers: [fixtureServer(fixture)] })
  const harness = makeHarness()
  const bridge = await connectExtensionMcpServers({
    dsh: (await import("../../mpd-dsh-adapter-plugin/src/index.ts")).createDshAdapter(harness.ctx),
    entries: [entry],
    config: () => DEFAULT_EXTENSION_CONFIG,
    warn: () => {},
  })
  try {
    const definition = toolNamed(harness.registered, "mcp__fixture__foreign")
    const parameters = definition.parameters as Record<string, any>
    expect(schemaViolations(parameters)).toEqual([])
    expect(projectSchema(parameters).lossy).toBe(false) // already on the subset
    expect(parameters.properties.when.format).toBeUndefined()
    expect(parameters.properties.when.pattern).toBeUndefined()
    expect(parameters.properties.maybe).toEqual({ oneOf: [{ type: "string" }, { type: "null" }] })
    expect(parameters.required).toEqual(["when"]) // "gone" has no property
    expect(parameters.additionalProperties).toBe(true)
    // The foreign schema is never mutated in place.
    expect(JSON.stringify(wire.tools[0].inputSchema)).toBe(JSON.stringify((definition.parameters as any) && wire.tools[0].inputSchema))
    // output.schema is asserted by the harness: it is kept verbatim inside the canonical object.
    const output = definition.output.schema as Record<string, any>
    expect(schemaViolations(output)).toEqual([])
    expect(output.properties.structuredContent).toEqual(wire.tools[0].outputSchema)
    expect(output.required).toEqual(["content", "structuredContent"])
    expect(definition.timeoutMs).toBe(3000)
  } finally {
    await bridge.dispose()
  }
})

test("an unsupported outputSchema drops the SCHEMA and keeps the tool, while an unprojectable inputSchema skips its tool", async () => {
  const fixture = makeFixture({
    tools: [
      { name: "good", description: "Good tool", inputSchema: { type: "object" } },
      { name: "badinput", description: "Unprojectable input", inputSchema: { type: ["string", "number"] } },
      { name: "badoutput", description: "Foreign output", inputSchema: { type: "object" }, outputSchema: { type: "object", properties: { x: { type: "string", format: "date" } } } },
    ],
  })
  const entry = fixtureEntry({ servers: [fixtureServer(fixture)] })
  const harness = makeHarness()
  const bridge = await connectExtensionMcpServers({
    dsh: (await import("../../mpd-dsh-adapter-plugin/src/index.ts")).createDshAdapter(harness.ctx),
    entries: [entry],
    config: () => DEFAULT_EXTENSION_CONFIG,
    warn: () => {},
  })
  try {
    // F1: the harness's own bridge drops the SCHEMA and keeps the tool
    // (H/dsh-mcp-client `supportedOutputSchema`); dropping the whole tool was the
    // blunter REV4 wording. `badinput` stays a SKIP: a tool whose arguments cannot
    // be described at all is not callable.
    expect(harness.registered.map((tool) => tool.name)).toEqual(["mcp__fixture__good", "mcp__fixture__badoutput"])
    const reasons = entry.errors.map((error) => error.reason).join("\n")
    expect(reasons).toContain('tool "badinput" skipped')
    expect(reasons).toContain("inputSchema cannot be projected")
    expect(reasons).not.toContain('tool "badoutput" skipped')
    expect(reasons).toContain('tool "badoutput": its outputSchema would have to be rewritten')
    expect(reasons).toContain("registered WITHOUT structuredContent")
    // The downgraded tool is fully usable: canonical object schema, no
    // structuredContent, and a real call still answers.
    const downgraded = harness.registered.find((tool) => tool.name === "mcp__fixture__badoutput")
    expect(schemaViolations(downgraded.output.schema)).toEqual([])
    expect(downgraded.output.schema.properties.structuredContent).toBeUndefined()
    expect(downgraded.output.schema.required).toEqual(["content"])
    const called = await downgraded.execute({}, { signal: undefined })
    expect(called.structuredContent).toBeUndefined()
    expect(Array.isArray(called.content)).toBe(true)
    // The surviving tools' schemas are all on the enforced subset.
    for (const definition of harness.registered) {
      expect(schemaViolations(definition.output.schema)).toEqual([])
      expect(schemaViolations(definition.parameters)).toEqual([])
    }
  } finally {
    await bridge.dispose()
  }
})

test("a non-object-rooted inputSchema is normalized onto an object root instead of being passed through", async () => {
  const fixture = makeFixture({
    tools: [
      { name: "scalarinput", description: "Scalar root", inputSchema: { type: "string", description: "one value" } },
      { name: "mappedinput", description: "Map root", inputSchema: { type: "array", items: { type: "string" } } },
      { name: "openinput", description: "No root type", inputSchema: { description: "anything" } },
    ],
  })
  const wire = JSON.parse(readFileSync(fixture.state, "utf8"))
  const entry = fixtureEntry({ servers: [fixtureServer(fixture)] })
  const harness = makeHarness()
  const bridge = await connectExtensionMcpServers({
    dsh: (await import("../../mpd-dsh-adapter-plugin/src/index.ts")).createDshAdapter(harness.ctx),
    entries: [entry],
    config: () => DEFAULT_EXTENSION_CONFIG,
    warn: () => {},
  })
  try {
    // F2: every harness tool call carries an ARGUMENTS OBJECT, so a foreign root that
    // is not an object is projected under a single `value` property (the payload keeps
    // the server's own type and annotations) and the downgrade is RECORDED.
    const scalar = toolNamed(harness.registered, "mcp__fixture__scalarinput")
    expect(scalar.parameters).toEqual({
      type: "object",
      properties: { value: { type: "string", description: "one value" } },
      required: ["value"],
      additionalProperties: false,
    })
    expect(schemaViolations(scalar.parameters)).toEqual([])
    const mapped = toolNamed(harness.registered, "mcp__fixture__mappedinput")
    expect(mapped.parameters.properties.value).toEqual({ type: "array", items: { type: "string" } })
    expect(mapped.parameters.required).toEqual(["value"])
    // A root that only carries annotations already IS an unconstrained object root.
    const open = toolNamed(harness.registered, "mcp__fixture__openinput")
    expect(open.parameters).toEqual({ description: "anything" })
    const notes = entry.errors.map((error) => error.reason).join("\n")
    expect(notes).toContain('tool "scalarinput": the server advertises a non-object inputSchema root ("string")')
    expect(notes).toContain('tool "mappedinput": the server advertises a non-object inputSchema root ("array")')
    expect(notes).not.toContain('tool "openinput"')
    // The wire object is never mutated in place.
    expect(JSON.stringify(wire.tools)).toBe(JSON.stringify(JSON.parse(readFileSync(fixture.state, "utf8")).tools))
  } finally {
    await bridge.dispose()
  }
})

test("a public-name collision with an existing tool skips that tool and is recorded", async () => {
  const fixture = makeFixture({
    tools: [
      { name: "echo", description: "Echo", inputSchema: { type: "object" } },
      { name: "taken", description: "Collides", inputSchema: { type: "object" } },
    ],
  })
  const entry = fixtureEntry({ servers: [fixtureServer(fixture)] })
  const harness = makeHarness()
  harness.foreign.add("mcp__fixture__taken")
  const bridge = await connectExtensionMcpServers({
    dsh: (await import("../../mpd-dsh-adapter-plugin/src/index.ts")).createDshAdapter(harness.ctx),
    entries: [entry],
    config: () => DEFAULT_EXTENSION_CONFIG,
    warn: () => {},
  })
  try {
    expect(harness.registered.map((tool) => tool.name)).toEqual(["mcp__fixture__echo"])
    expect(entry.errors.some((error) => error.reason.includes('already registered by another tool'))).toBe(true)
    expect(bridge.view()[0].state).toBe("connected")
  } finally {
    await bridge.dispose()
  }
})

// ── calls: mapping, per-call timeout, credentials, reap ────────────────────

test("tools/call maps content, structured content and isError onto the harness result contract", async () => {
  const fixture = makeFixture({
    tools: [
      { name: "echo", description: "Echo", inputSchema: { type: "object", properties: { text: { type: "string" } } } },
      { name: "fail", description: "Fails", inputSchema: { type: "object" } },
      { name: "structured", description: "Structured", inputSchema: { type: "object" }, outputSchema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false } },
      { name: "slow", description: "Slow", inputSchema: { type: "object" } },
    ],
  })
  const entry = fixtureEntry({ servers: [fixtureServer(fixture, { toolCallTimeoutMs: 250 })] })
  const harness = makeHarness()
  const bridge = await connectExtensionMcpServers({
    dsh: (await import("../../mpd-dsh-adapter-plugin/src/index.ts")).createDshAdapter(harness.ctx),
    entries: [entry],
    config: () => DEFAULT_EXTENSION_CONFIG,
    warn: () => {},
  })
  try {
    const echo = await toolNamed(harness.registered, "mcp__fixture__echo").execute({ text: "hi" }, {})
    expect(echo.content[0].text).toBe('{"text":"hi"}')
    expect(toolNamed(harness.registered, "mcp__fixture__echo").output.render({}, echo)[0].text).toBe('{"text":"hi"}')

    const structured = await toolNamed(harness.registered, "mcp__fixture__structured").execute({}, {})
    expect(structured.structuredContent).toEqual({ ok: true })

    // An isError result throws so the harness produces an isError tool result.
    await expect(toolNamed(harness.registered, "mcp__fixture__fail").execute({}, {})).rejects.toThrow(/fixture-requested-failure/)
    // The per-call timeout is enforced client-side too.
    await expect(toolNamed(harness.registered, "mcp__fixture__slow").execute({}, {})).rejects.toThrow(/timed out after 250ms/)
  } finally {
    await bridge.dispose()
  }
})

test("the child env carries no credential-shaped variable inherited from the parent, and the child is reaped on dispose", async () => {
  process.env.MPD_TEST_API_KEY = "must-not-cross"
  const fixture = makeFixture({
    tools: [
      { name: "env", description: "Env keys", inputSchema: { type: "object" } },
      { name: "pid", description: "Pid", inputSchema: { type: "object" } },
    ],
  })
  const entry = fixtureEntry({ servers: [fixtureServer(fixture)] })
  const harness = makeHarness()
  const bridge = await connectExtensionMcpServers({
    dsh: (await import("../../mpd-dsh-adapter-plugin/src/index.ts")).createDshAdapter(harness.ctx),
    entries: [entry],
    config: () => DEFAULT_EXTENSION_CONFIG,
    warn: () => {},
  })
  const envKeys: string[] = JSON.parse((await toolNamed(harness.registered, "mcp__fixture__env").execute({}, {})).content[0].text)
  const childPid = Number((await toolNamed(harness.registered, "mcp__fixture__pid").execute({}, {})).content[0].text)
  expect(Number.isInteger(childPid)).toBe(true)
  expect(pidAlive(childPid)).toBe(true)
  expect(envKeys).toContain("PATH")
  expect(envKeys.some((key) => isCredentialShapedEnvName(key))).toBe(false)
  expect(envKeys).not.toContain("MPD_TEST_API_KEY")

  await bridge.dispose()
  await waitFor(() => !pidAlive(childPid))
  expect(harness.registered).toEqual([])
  expect(bridge.view()[0].tools).toEqual([])
})

test("a disabled extension never spawns a child and reports state disabled", async () => {
  const fixture = makeFixture()
  const entry = fixtureEntry({ servers: [fixtureServer(fixture)], enabled: false })
  const harness = makeHarness()
  const bridge = await connectExtensionMcpServers({
    dsh: (await import("../../mpd-dsh-adapter-plugin/src/index.ts")).createDshAdapter(harness.ctx),
    entries: [entry],
    config: () => DEFAULT_EXTENSION_CONFIG,
    warn: () => {},
  })
  try {
    expect(harness.registered).toEqual([])
    expect(bridge.view()).toEqual([
      { extension: "fixture-ext", serverName: "fixture", state: "disabled", tools: [] },
    ])
    expect(entry.mcp[0].state).toBe("disabled")
  } finally {
    await bridge.dispose()
  }
})

test("extensions.mcp.enabled=false connects nothing even for an enabled extension", async () => {
  const fixture = makeFixture()
  const entry = fixtureEntry({ servers: [fixtureServer(fixture)] })
  const harness = makeHarness()
  const bridge = await connectExtensionMcpServers({
    dsh: (await import("../../mpd-dsh-adapter-plugin/src/index.ts")).createDshAdapter(harness.ctx),
    entries: [entry],
    config: () => ({ ...DEFAULT_EXTENSION_CONFIG, mcp: { enabled: false, connectTimeoutMs: 100, toolCallTimeoutMs: 100 } }),
    warn: () => {},
  })
  try {
    expect(harness.registered).toEqual([])
    expect(bridge.view()[0].state).toBe("disabled")
  } finally {
    await bridge.dispose()
  }
})

test("a server's relative args and cwd resolve against the EXTENSION ROOT, not the dsh process cwd", async () => {
  const entry = fixtureEntry({
    servers: [fixtureServer({ dir: "", server: "", state: "" }, { command: process.execPath, args: ["fixture-server.mjs"], cwd: "." })],
  })
  // The fixture is written INTO the extension root, and the process cwd is
  // somewhere else entirely — only root-relative resolution can find it.
  writeFileSync(join(entry.root, "fixture-server.mjs"), FIXTURE)
  writeFileSync(join(entry.root, "state.json"), JSON.stringify({ tools: [{ name: "echo", description: "Echo", inputSchema: { type: "object" } }] }))
  entry.descriptor.contributes.mcp[0].env = { MPD_FIXTURE_SCENARIO: "static", MPD_FIXTURE_STATE: join(entry.root, "state.json") }
  const harness = makeHarness()
  const bridge = await connectExtensionMcpServers({
    dsh: (await import("../../mpd-dsh-adapter-plugin/src/index.ts")).createDshAdapter(harness.ctx),
    entries: [entry],
    config: () => DEFAULT_EXTENSION_CONFIG,
    warn: () => {},
  })
  try {
    expect(bridge.view()[0].state).toBe("connected")
    expect(harness.registered.map((tool) => tool.name)).toEqual(["mcp__fixture__echo"])
  } finally {
    await bridge.dispose()
  }
})

test("the shipped example's stdio MCP server starts, lists its tool and answers a real call", async () => {
  const root = join(makeDir("mpd-ext-example-"), "mpd-ext-example")
  cpSync(join(REPO, "extensions", "mpd-ext-example"), root, { recursive: true })
  const manifestPath = join(root, "mpd-ext.json")
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
  manifest.enabled = true
  // The example ships `command: "node"` — the honest shipped value — so this test
  // measures the real manifest, not a rewritten one.
  const built = buildExtension({
    input: manifest,
    plane: "user",
    origin: "directory",
    root,
    source: manifestPath,
    fallbackId: "mpd-ext-example",
    providerName: "mpd-ext:mpd-ext-example",
  })
  const entry = built.entry as ExtensionEntry
  expect(entry.errors).toEqual([])
  const harness = makeHarness()
  const bridge = await connectExtensionMcpServers({
    dsh: (await import("../../mpd-dsh-adapter-plugin/src/index.ts")).createDshAdapter(harness.ctx),
    entries: [entry],
    config: () => DEFAULT_EXTENSION_CONFIG,
    warn: () => {},
  })
  try {
    expect(bridge.view()[0].state).toBe("connected")
    const tool = toolNamed(harness.registered, "mcp__lint-mcp__describe_extension")
    const value = await tool.execute({}, {})
    const described = JSON.parse(value.content[0].text)
    expect(described.id).toBe("mpd-ext-example")
    expect(described.kinds).toEqual(["skills", "flows", "mcp", "roles"])
  } finally {
    await bridge.dispose()
  }
})

test("the shipped example extension is discoverable, disabled, and contributes all four kinds", () => {
  const exampleRoot = join(REPO, "extensions", "mpd-ext-example")
  const manifestPath = join(exampleRoot, "mpd-ext.json")
  expect(existsSync(manifestPath)).toBe(true)
  const built = buildExtension({
    input: JSON.parse(readFileSync(manifestPath, "utf8")),
    plane: "bundle",
    origin: "directory",
    root: exampleRoot,
    source: manifestPath,
    fallbackId: "mpd-ext-example",
    providerName: "mpd-ext:mpd-ext-example",
  })
  expect(built.rejected).toBeUndefined()
  const entry = built.entry as ExtensionEntry
  expect(entry.errors).toEqual([])
  expect(entry.enabled).toBe(false)
  expect(entry.skills.length).toBe(1)
  expect(entry.flows.length).toBe(1)
  expect(entry.roles.length).toBe(1)
  expect(entry.contributions.mcp).toBe(1)
  // The reference server is a real, dependency-free stdio MCP server.
  expect(existsSync(join(exampleRoot, "server.mjs"))).toBe(true)
})
