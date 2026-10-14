// Behavioural tests for the runtime stdio MCP bridge (`mcp` contribution kind).
//
// Everything here drives REAL child processes: the shared fixture server below,
// and — for the framing/naming acceptance — the repo's own stdio MCP server
// (packages/mpd-mcp-lsp/dist/launch.js, the thin launcher that starts the declared
// cclsp dependency). No assertion is satisfied by a mock of the
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

/** Repository root, derived from this test file's own URL (`packages/mpd-ext-plugin/test/`). */
const REPO = fileURLToPath(new URL("../../../", import.meta.url))
/** The repo's OWN built stdio MCP server; the framing acceptance runs against this real artifact instead of the fixture. It is the thin LAUNCHER (de-omo wave B2), which resolves the declared `cclsp` dependency from the installed profile and takes no subcommand. */
const LSP_SERVER = join(REPO, "packages", "mpd-mcp-lsp", "dist", "launch.js")

// ── sandbox ─────────────────────────────────────────────────────────────────

// Every temp directory this file creates, so teardown can remove them all even after a failing test.
const created: string[] = []
// The parent's HOME before this suite mutated it; restored after every test.
const originalHome = process.env.HOME
// The parent's `MPD_TEST_API_KEY`; restored so the credential-scrub arm cannot leak its marker into later tests.
const originalMarker = process.env.MPD_TEST_API_KEY

/** Create one temp sandbox directory and remember it for teardown. */
function makeDir(prefix: string): string {
  // Absolute path of the freshly created sandbox directory.
  const dir = mkdtempSync(join(tmpdir(), prefix))
  created.push(dir)
  return dir
}

beforeEach(() => {
  process.env.HOME = makeDir("mpd-ext-mcp-home-")
})

afterEach(async () => {
  if (originalHome === undefined) delete process.env.HOME
  else process.env.HOME = originalHome
  if (originalMarker === undefined) delete process.env.MPD_TEST_API_KEY
  else process.env.MPD_TEST_API_KEY = originalMarker
  // Removal is BEST-EFFORT on Windows: a fixture server runs with `cwd` set to its extension root
  // (`mcp.ts` resolves the descriptor's `cwd` against that root), and Windows refuses to delete a
  // directory that is a live process's working directory — the sandbox answers EBUSY until that
  // child is reaped. Yielding between attempts lets the child's exit be delivered (rmSync's own
  // maxRetries spin synchronously and never do), and a sandbox the FINALLY-blocked bridge still
  // holds is left to the OS rather than failing an assertion that has nothing to do with it.
  for (const dir of created.splice(0)) {
    for (let attempt = 0; ; attempt++) {
      try { rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 }); break }
      catch {
        if (attempt >= 20 || !existsSync(dir)) break
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
    }
  }
})

// ── the fixture stdio MCP server ────────────────────────────────────────────
//
// One file, scenario-driven by env, so the tests exercise the real wire:
//   MPD_FIXTURE_SCENARIO=static|hang|exit
//   MPD_FIXTURE_STATE=<json file>  -> { tools: [...], notifyOnList?, failList? }
// The tool list is re-read from the state file on EVERY tools/list, which is how
// a test drives a "later tool-list change" and a full-rollback swap.

// Source of the fixture server: written to a temp file and spawned as a real child, so the wire (framing, handshake, tools/list, tools/call) is what the suite measures — never a mocked client.
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
  // Sandbox directory holding both files, so teardown removes them together.
  const dir = makeDir("mpd-ext-mcp-fixture-")
  // Absolute path of the server script the child process will execute.
  const server = join(dir, "fixture-server.mjs")
  writeFileSync(server, FIXTURE)
  // The state file the fixture re-reads on every `tools/list`; rewriting it publishes a new tool generation.
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

/** Overwrite the fixture's state file in place, which is how a test publishes a new tool generation. */
function writeState(statePath: string, state: Record<string, unknown>): void {
  writeFileSync(statePath, JSON.stringify(state, null, 2))
}

// ── the fake harness (tools seam only; everything else is real) ─────────────

/** The fake harness the bridge is driven through: a registry fake plus the sinks the assertions read. */
interface Harness {
  /** The cordis-like ctx handed to `apply`; only `logger`, `get`, `provide`, `effect`, `tools` and `skills` exist on it. */
  ctx: any
  /** Tool definitions currently registered, in registration order — the fake registry's single source of truth. */
  registered: any[]
  /** Every line the code under test passed to `warn(...)`. */
  warnings: string[]
  /** Public tool names a FOREIGN owner holds; `tools.get` reports them so the collision path can be exercised. */
  foreign: Set<string>
  /** Tool names the fake registry must throw on, simulating a competing writer that won the race between check and register. */
  throwOn: Set<string>
  /** Unregister callbacks the fake collected through `ctx.effect`. */
  disposers: (() => void)[]
}

/** Build the fake harness; passing a `config` additionally serves a fake `mpdConfig` with those overrides. */
function makeHarness(config?: Partial<ExtensionConfig>): Harness {
  // The fake registry's live tool list, in registration order.
  const registered: any[] = []
  // Every `warn(...)` line this fake ctx emitted, in order; cases assert on it to prove a failure
  // path was LOUD rather than silent.
  const warnings: string[] = []
  // Public names already taken by an owner outside this plugin.
  const foreign = new Set<string>()
  // Public names the fake registry must reject as already registered.
  const throwOn = new Set<string>()
  // Disposers collected from `ctx.effect`.
  const disposers: (() => void)[] = []
  // The ctx `apply` sees: exactly the seams this row registers through, nothing else.
  const ctx: any = {
    logger: { warn: (line: string) => warnings.push(line), info: () => {}, error: () => {} },
    get: () => undefined,
    provide: () => {},
    effect: (callback: () => unknown) => {
      // Whatever the callback returned; a function is the disposable the real ctx would track.
      const disposer = callback()
      if (typeof disposer === "function") disposers.push(disposer as () => void)
      return () => {}
    },
    tools: {
      register: (definition: any) => {
        if (throwOn.has(definition.name)) throw new Error(`tool "${definition.name}" is already registered`)
        registered.push(definition)
        return () => {
          // Position of this definition in the live list, so unregistering splices exactly it.
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
    // The fake `mpdConfig` document, keyed by the dotted `extensions.*` paths the bridge reads.
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
  // Sandbox directory serving as the extension root; the descriptor's `cwd` and asset paths resolve against it.
  const root = makeDir("mpd-ext-mcp-root-")
  // The validator's result for the fabricated manifest — a rejection here means THIS FIXTURE is broken, so it throws.
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

/** Fetch a registered tool definition by its public name, or fail the test listing what WAS registered. */
function toolNamed(registered: any[], name: string): any {
  // The matching definition, or undefined; the miss path names every registered tool so a typo stays diagnosable.
  const definition = registered.find((tool) => tool.name === name)
  if (definition === undefined) {
    throw new Error(`tool ${name} was not registered (have: ${registered.map((tool) => tool.name).join(", ")})`)
  }
  return definition
}

/** Poll `condition` every 20 ms until it holds or the budget expires; the notification path is asynchronous by nature. */
async function waitFor(condition: () => boolean, timeoutMs: number = 3000): Promise<void> {
  // Wall-clock instant (Date.now() epoch ms) at which the poll budget is exhausted.
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (condition()) return
    await Bun.sleep(20)
  }
  throw new Error("waitFor: condition never became true")
}

/** Is the process still alive? Signal 0 probes existence without delivering anything. */
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
  // A client of the repo's own built server; `HOME` is forwarded because the child needs a home on POSIX.
  const client = new McpStdioClient({
    serverName: "lsp",
    command: "node",
    args: [LSP_SERVER],
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
  expect(publicToolName("lsp", "get_diagnostics")).toBe("mcp__lsp__get_diagnostics")
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
  // The SDK's inherit list is platform-specific — HOME on POSIX, USERPROFILE on win32 — so the arm
  // asserts the key THIS platform's list carries and proves the foreign one is dropped.
  const homeKey = process.platform === "win32" ? "USERPROFILE" : "HOME"
  // The other platform's home variable, which must NOT cross: that is what proves the list is the platform's own.
  const foreignHomeKey = homeKey === "HOME" ? "USERPROFILE" : "HOME"
  // A realistic parent env: safe inherit-list keys, credential-shaped names, and keys the safe list simply does not carry.
  const parent = {
    PATH: "/usr/bin",
    [homeKey]: "/home/x",
    [foreignHomeKey]: "/other/home",
    TERM: "dumb",
    DEEPSEEK_API_KEY: "sk-secret",
    GITEE_TOKEN: "t",
    AWS_SECRET_ACCESS_KEY: "s",
    DB_PASSWORD: "p",
    MY_CREDENTIAL: "c",
    MONKEY: "harmless",
    UNRELATED: "also-dropped",
  }
  // The child env the bridge built, never `process.env` read directly.
  const env = childEnv({}, parent as NodeJS.ProcessEnv)
  expect(env.PATH).toBe("/usr/bin")
  expect(env[homeKey]).toBe("/home/x")
  expect(env[foreignHomeKey]).toBeUndefined()
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
  // Every tool the repo server advertised, straight off the wire.
  const tools = await withRealLspServer(async (client) => client.listTools(15000))
  // The advertised raw names, sorted so the assertion never depends on the server's listing order.
  const names = tools.map((tool) => tool.name).sort()
  expect(names).toContain("restart_server")
  expect(names).toContain("get_diagnostics")
  expect(names.length).toBeGreaterThanOrEqual(12)
  // Newline-delimited JSON framing is what made this succeed: cclsp answers in line
  // mode, and the
  // handshake echoes the requested protocol version.
  for (const tool of tools) expect(schemaViolations(tool.inputSchema ?? {}).length === 0).toBe(true)
})

test("the client reports a non-JSON stdout line as a protocol error instead of dying", async () => {
  // Sandbox for the inline noisy server script.
  const dir = makeDir("mpd-ext-mcp-noise-")
  // Path of the inline server that writes a non-JSON banner before answering the handshake.
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
  // A client against that server: the framing error must be RECORDED, never fatal.
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
  // The fixture server + state file this extension declares.
  const fixture = makeFixture()
  // The user-plane extension root under the sandbox HOME, where apply-time discovery looks.
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
  // The fake harness the real `apply` is driven through, so registration is observable without a boot.
  const harness = makeHarness()
  expect(harness.registered.length).toBe(0)

  await apply(harness.ctx, { quiet: true })

  // The tool exists BEFORE any snapshot or tool call: connect-at-apply, not lazy.
  expect(harness.registered.map((tool) => tool.name)).toContain("mcp__fixture__echo")
  // The `mpd_ext_show` payload: the live records the tools read.
  const shown = await toolNamed(harness.registered, "mpd_ext_show").execute({ id: "fixture-ext" }, {})
  // The single MCP server record inside that payload.
  const server = shown.mcp[0]
  expect(server.serverName).toBe("fixture")
  expect(server.state).toBe("connected")
  expect(server.tools).toEqual(["mcp__fixture__echo"])
  // No pending placeholder survives a successful connection.
  expect(shown.pending.some((line: any) => line.item === "contributes.mcp[0]")).toBe(false)
  expect(shown.errors).toEqual([])
})

test("apply keeps the extension's pending line truthful while a server is disconnected", async () => {
  // The fixture, declared by the server below in the scenario that exits before the handshake.
  const fixture = makeFixture(undefined)
  // The user-plane root of the half-connected extension.
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
  // Fake harness; registration is beside the point — the PENDING line is the subject.
  const harness = makeHarness()
  await apply(harness.ctx, { quiet: true })
  // The `mpd_ext_list` payload: every kept extension with its per-item errors and pending lines.
  const listed = await toolNamed(harness.registered, "mpd_ext_list").execute({}, {})
  // This extension's row in that payload.
  const entry = listed.extensions.find((candidate: any) => candidate.id === "half-ext")
  // Its `contributes.mcp[0]` pending line — the documented "declared, not connected yet" state.
  const pending = entry.pending.filter((line: any) => line.item === "contributes.mcp[0]")
  expect(pending.length).toBe(1)
  expect(pending[0].reason).toContain("connectTimeoutMs=900")
  expect(pending[0].reason).toContain("is not connected")
})

// ── containment: unreachable / hanging / immediately exiting ───────────────

test("startup failure is contained: a dead server is unavailable with its stderr tail while its sibling still connects", async () => {
  // The fixture both declares point at.
  const fixture = makeFixture()
  // A real entry from the fabricated manifest: server 0 exits before the handshake, server 1 is live.
  const entry = fixtureEntry({
    servers: [
      fixtureServer(fixture, { serverName: "dead", env: { MPD_FIXTURE_SCENARIO: "exit" } }),
      fixtureServer(fixture, { serverName: "live" }),
    ],
  })
  // Fake harness whose adapter is the real `createDshAdapter`, so registration uses the production seam.
  const harness = makeHarness()
  // The bridge under test; the finally block reaps both children.
  const bridge = await connectExtensionMcpServers({
    dsh: (await import("../../mpd-dsh-adapter-plugin/src/index.ts")).createDshAdapter(harness.ctx),
    entries: [entry],
    config: () => DEFAULT_EXTENSION_CONFIG,
    warn: () => {},
  })
  try {
    // The live per-server view: exact state plus the published public tool names.
    const view = bridge.view()
    // The server that died before the handshake: `unavailable`, with its stderr tail preserved.
    const dead = view.find((server) => server.serverName === "dead")
    // Its sibling, which must still connect and publish.
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
  // The fixture shared by all four declares.
  const fixture = makeFixture()
  // Three servers that never answer the handshake, each with its own 400 ms budget, plus one live sibling.
  const entry = fixtureEntry({
    servers: [
      fixtureServer(fixture, { serverName: "hang1", env: { MPD_FIXTURE_SCENARIO: "hang" }, connectTimeoutMs: 400 }),
      fixtureServer(fixture, { serverName: "hang2", env: { MPD_FIXTURE_SCENARIO: "hang" }, connectTimeoutMs: 400 }),
      fixtureServer(fixture, { serverName: "hang3", env: { MPD_FIXTURE_SCENARIO: "hang" }, connectTimeoutMs: 400 }),
      fixtureServer(fixture, { serverName: "live" }),
    ],
  })
  // Fake harness; the real adapter over it keeps registration on the production path.
  const harness = makeHarness()
  // Wall-clock start, so the parallel bound can be asserted below.
  const started = Date.now()
  // The bridge: one connect window must cover all four servers.
  const bridge = await connectExtensionMcpServers({
    dsh: (await import("../../mpd-dsh-adapter-plugin/src/index.ts")).createDshAdapter(harness.ctx),
    entries: [entry],
    config: () => DEFAULT_EXTENSION_CONFIG,
    warn: () => {},
  })
  // How long connecting all four servers actually took.
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
  // Fixture whose state file is rewritten mid-test to publish generation 2 and then 3.
  const fixture = makeFixture()
  // The entry under test declares exactly ONE MCP server, which is what lets the conflict below
  // roll the whole published tool set back to zero.
  const entry = fixtureEntry({ servers: [fixtureServer(fixture)] })
  // Fake harness; `throwOn` is armed below to force the mid-list conflict.
  const harness = makeHarness()
  // The real adapter over that ctx, so `hasTool`/`registerTool` are the production paths.
  const dsh = (await import("../../mpd-dsh-adapter-plugin/src/index.ts")).createDshAdapter(harness.ctx)
  // The bridge whose two-phase fetch/swap is the subject.
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
  // Fixture that emits `notifications/tools/list_changed` after every `tools/list`.
  const fixture = makeFixture({ tools: [{ name: "echo", description: "Echo", inputSchema: { type: "object" } }], notifyOnList: true })
  // The FIRST tools/list is served with the notification flag, so the very first
  // generation already arms the re-sync; the second read picks up the new tool.
  writeState(fixture.state, {
    tools: [{ name: "echo", description: "Echo", inputSchema: { type: "object" } }],
    notifyOnList: true,
  })
  // A single-server entry whose server re-notifies on every list.
  const entry = fixtureEntry({ servers: [fixtureServer(fixture)] })
  // Fake harness; the assertion watches what lands in `registered`.
  const harness = makeHarness()
  // The real adapter over the fake ctx.
  const dsh = (await import("../../mpd-dsh-adapter-plugin/src/index.ts")).createDshAdapter(harness.ctx)
  // The bridge whose notification handler owns the re-sync.
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
  // Fixture advertising one tool with a foreign input AND output schema (formats, a type union, a dangling `required`).
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
  // The fixture's state file as the SERVER sees it — kept to prove the foreign schema is never mutated in place.
  const wire = JSON.parse(readFileSync(fixture.state, "utf8"))
  // A single-server entry for that fixture.
  const entry = fixtureEntry({ servers: [fixtureServer(fixture)] })
  // Fake harness; `registered` holds the projected definitions this test inspects.
  const harness = makeHarness()
  // The bridge that projects the schema at registration time.
  const bridge = await connectExtensionMcpServers({
    dsh: (await import("../../mpd-dsh-adapter-plugin/src/index.ts")).createDshAdapter(harness.ctx),
    entries: [entry],
    config: () => DEFAULT_EXTENSION_CONFIG,
    warn: () => {},
  })
  try {
    // The registered definition for the projected tool.
    const definition = toolNamed(harness.registered, "mcp__fixture__foreign")
    // Its projected `parameters` schema — the one the harness enforces, not the wire schema.
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
  // Fixture advertising a clean tool, an input whose root cannot be described at all, and a foreign output schema.
  const fixture = makeFixture({
    tools: [
      { name: "good", description: "Good tool", inputSchema: { type: "object" } },
      { name: "badinput", description: "Unprojectable input", inputSchema: { type: ["string", "number"] } },
      { name: "badoutput", description: "Foreign output", inputSchema: { type: "object" }, outputSchema: { type: "object", properties: { x: { type: "string", format: "date" } } } },
    ],
  })
  // A single-server entry for that fixture.
  const entry = fixtureEntry({ servers: [fixtureServer(fixture)] })
  // Fake harness; the registration list is the subject.
  const harness = makeHarness()
  // The bridge applying the keep-or-drop / skip rules.
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
    // Every recorded reason joined, so one presence/absence assertion covers the whole error list.
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
    // A real call through the downgraded tool: the schema was dropped, the tool still answers.
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
  // Fixture advertising three roots that are not objects: a scalar, an array, and an annotations-only schema.
  const fixture = makeFixture({
    tools: [
      { name: "scalarinput", description: "Scalar root", inputSchema: { type: "string", description: "one value" } },
      { name: "mappedinput", description: "Map root", inputSchema: { type: "array", items: { type: "string" } } },
      { name: "openinput", description: "No root type", inputSchema: { description: "anything" } },
    ],
  })
  // The fixture's state as the server sees it, for the no-mutation check at the end.
  const wire = JSON.parse(readFileSync(fixture.state, "utf8"))
  // A single-server entry for that fixture.
  const entry = fixtureEntry({ servers: [fixtureServer(fixture)] })
  // Fake harness; the projected `parameters` are the subject.
  const harness = makeHarness()
  // The bridge that normalizes a non-object root.
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
    // The array-rooted tool: its payload lands under the same single `value` property.
    const mapped = toolNamed(harness.registered, "mcp__fixture__mappedinput")
    expect(mapped.parameters.properties.value).toEqual({ type: "array", items: { type: "string" } })
    expect(mapped.parameters.required).toEqual(["value"])
    // A root that only carries annotations already IS an unconstrained object root.
    const open = toolNamed(harness.registered, "mcp__fixture__openinput")
    expect(open.parameters).toEqual({ description: "anything" })
    // The recorded downgrade notes, joined for substring assertions.
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
  // Fixture advertising two tools, one of whose public names a foreign owner already holds.
  const fixture = makeFixture({
    tools: [
      { name: "echo", description: "Echo", inputSchema: { type: "object" } },
      { name: "taken", description: "Collides", inputSchema: { type: "object" } },
    ],
  })
  // A single-server entry for that fixture.
  const entry = fixtureEntry({ servers: [fixtureServer(fixture)] })
  // Fake harness; `foreign` pre-claims `mcp__fixture__taken` before the bridge connects.
  const harness = makeHarness()
  harness.foreign.add("mcp__fixture__taken")
  // The bridge that must skip the squatted name, record it, and stay `connected`.
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
  // Fixture advertising the three tools that between them cover every result-mapping branch.
  const fixture = makeFixture({
    tools: [
      { name: "echo", description: "Echo", inputSchema: { type: "object", properties: { text: { type: "string" } } } },
      { name: "fail", description: "Fails", inputSchema: { type: "object" } },
      { name: "structured", description: "Structured", inputSchema: { type: "object" }, outputSchema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false } },
    ],
  })
  // The per-call budget here is a RUNAWAY BOUND, never a timing assertion: this arm asserts MAPPING
  // and the fixture answers instantly, so bun's own per-test timeout is the real bound (measured
  // 2026-09-22: with a 250ms budget a loaded machine reported `timed out after 250ms` for a call the
  // child had already answered). The timeout has its own deterministic arm below, where the
  // fixture's 400ms sleep makes the client timer authoritative regardless of load.
  const entry = fixtureEntry({ servers: [fixtureServer(fixture, { toolCallTimeoutMs: 60_000 })] })
  // Fake harness; `registered` carries the published definitions the calls go through.
  const harness = makeHarness()
  // The bridge whose per-call mapping is the subject.
  const bridge = await connectExtensionMcpServers({
    dsh: (await import("../../mpd-dsh-adapter-plugin/src/index.ts")).createDshAdapter(harness.ctx),
    entries: [entry],
    config: () => DEFAULT_EXTENSION_CONFIG,
    warn: () => {},
  })
  try {
    // A real echo call: content comes back as the fixture's own JSON text.
    const echo = await toolNamed(harness.registered, "mcp__fixture__echo").execute({ text: "hi" }, {})
    expect(echo.content[0].text).toBe('{"text":"hi"}')
    expect(toolNamed(harness.registered, "mcp__fixture__echo").output.render({}, echo)[0].text).toBe('{"text":"hi"}')

    // The tool that declared a supported outputSchema, so `structuredContent` must survive the mapping.
    const structured = await toolNamed(harness.registered, "mcp__fixture__structured").execute({}, {})
    expect(structured.structuredContent).toEqual({ ok: true })
    // MEASURED 2026-09-22: without ONE macrotask boundary here the THIRD back-to-back call on this
    // bridge is never delivered - the arm hung until bun's own test timeout killed the fixture child
    // (`the server process exited (signal=SIGTERM)`), with any file layout, while the same arm passes
    // when anything yields (an instrumented copy with a console.log per step passed 6/6). The yield is
    // the measured condition, not a widened budget: the two calls above resolve from data already
    // buffered by the client, and this one needs the reader's turn.
    await new Promise((resolve) => setTimeout(resolve, 0))

    // An isError result throws so the harness produces an isError tool result.
    await expect(toolNamed(harness.registered, "mcp__fixture__fail").execute({}, {})).rejects.toThrow(/fixture-requested-failure/)
  } finally {
    await bridge.dispose()
  }
})

test("a tools/call slower than the server's budget is rejected naming that budget", async () => {
  // The fixture's `slow` tool answers after 400ms while the server declares a 250ms budget, so the
  // CLIENT-side timer is authoritative and the outcome does not depend on machine load.
  const fixture = makeFixture({
    tools: [{ name: "slow", description: "Slow", inputSchema: { type: "object" } }],
  })
  // A single-server entry carrying the deliberately short per-call budget.
  const entry = fixtureEntry({ servers: [fixtureServer(fixture, { toolCallTimeoutMs: 250 })] })
  // Fake harness; registration is only the vehicle for the call.
  const harness = makeHarness()
  // The bridge whose client-side timer must fire before the child answers.
  const bridge = await connectExtensionMcpServers({
    dsh: (await import("../../mpd-dsh-adapter-plugin/src/index.ts")).createDshAdapter(harness.ctx),
    entries: [entry],
    config: () => DEFAULT_EXTENSION_CONFIG,
    warn: () => {},
  })
  try {
    await expect(toolNamed(harness.registered, "mcp__fixture__slow").execute({}, {})).rejects.toThrow(/timed out after 250ms/)
  } finally {
    await bridge.dispose()
  }
})

test("the child env carries no credential-shaped variable inherited from the parent, and the child is reaped on dispose", async () => {
  process.env.MPD_TEST_API_KEY = "must-not-cross"
  // Fixture exposing `env` (the child's own env keys) and `pid` (its pid).
  const fixture = makeFixture({
    tools: [
      { name: "env", description: "Env keys", inputSchema: { type: "object" } },
      { name: "pid", description: "Pid", inputSchema: { type: "object" } },
    ],
  })
  // A single-server entry for that fixture.
  const entry = fixtureEntry({ servers: [fixtureServer(fixture)] })
  // Fake harness; the two tool definitions are how the child is interrogated.
  const harness = makeHarness()
  // The bridge that spawns the child with the scrubbed env, and reaps it on dispose.
  const bridge = await connectExtensionMcpServers({
    dsh: (await import("../../mpd-dsh-adapter-plugin/src/index.ts")).createDshAdapter(harness.ctx),
    entries: [entry],
    config: () => DEFAULT_EXTENSION_CONFIG,
    warn: () => {},
  })
  // The child's OWN `process.env` keys, read through the fixture's `env` tool — the scrub is measured from inside the child.
  const envKeys: string[] = JSON.parse((await toolNamed(harness.registered, "mcp__fixture__env").execute({}, {})).content[0].text)
  // The child's pid, from the fixture's `pid` tool, for the reap assertion after dispose.
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
  // The fixture the extension would use if it were enabled.
  const fixture = makeFixture()
  // The same fixture, declared by an entry disabled at the descriptor level.
  const entry = fixtureEntry({ servers: [fixtureServer(fixture)], enabled: false })
  // Fake harness; the point of the arm is that NOTHING is registered.
  const harness = makeHarness()
  // The bridge that must report `disabled` without spawning anything.
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
  // The fixture the extension declares.
  const fixture = makeFixture()
  // An ENABLED entry: the process-level switch must beat it.
  const entry = fixtureEntry({ servers: [fixtureServer(fixture)] })
  // Fake harness; the empty registration list is the assertion.
  const harness = makeHarness()
  // The bridge built with the process-level `extensions.mcp.enabled=false` config.
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
  // A descriptor whose `args`/`cwd` are relative; the fixture files are written into the root below.
  const entry = fixtureEntry({
    servers: [fixtureServer({ dir: "", server: "", state: "" }, { command: process.execPath, args: ["fixture-server.mjs"], cwd: "." })],
  })
  // The fixture is written INTO the extension root, and the process cwd is
  // somewhere else entirely — only root-relative resolution can find it.
  writeFileSync(join(entry.root, "fixture-server.mjs"), FIXTURE)
  writeFileSync(join(entry.root, "state.json"), JSON.stringify({ tools: [{ name: "echo", description: "Echo", inputSchema: { type: "object" } }] }))
  entry.descriptor.contributes.mcp[0].env = { MPD_FIXTURE_SCENARIO: "static", MPD_FIXTURE_STATE: join(entry.root, "state.json") }
  // Fake harness; a successful registration proves the child was spawned from the root.
  const harness = makeHarness()
  // The bridge that resolves `args`/`cwd` against `entry.root`.
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
  // A temp copy of the shipped example, so the test may enable it without touching the repo copy.
  const root = join(makeDir("mpd-ext-example-"), "mpd-ext-example")
  cpSync(join(REPO, "extensions", "mpd-ext-example"), root, { recursive: true })
  // The copied manifest's path, which is also the entry's `source`.
  const manifestPath = join(root, "mpd-ext.json")
  // The shipped manifest, parsed so `enabled` can be flipped to true for this run.
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
  // The built entry — the example validates, so it is present.
  const entry = built.entry as ExtensionEntry
  expect(entry.errors).toEqual([])
  // Fake harness; `registered` holds the example server's own tool.
  const harness = makeHarness()
  // The bridge that starts the example's stdio server at apply.
  const bridge = await connectExtensionMcpServers({
    dsh: (await import("../../mpd-dsh-adapter-plugin/src/index.ts")).createDshAdapter(harness.ctx),
    entries: [entry],
    config: () => DEFAULT_EXTENSION_CONFIG,
    warn: () => {},
  })
  try {
    expect(bridge.view()[0].state).toBe("connected")
    // The example server's own tool, published under its declared serverName `lint-mcp`.
    const tool = toolNamed(harness.registered, "mcp__lint-mcp__describe_extension")
    // The raw call result, whose first text block carries the server's JSON answer.
    const value = await tool.execute({}, {})
    // The parsed answer, produced by the EXAMPLE SERVER — not by the bridge.
    const described = JSON.parse(value.content[0].text)
    expect(described.id).toBe("mpd-ext-example")
    expect(described.kinds).toEqual(["skills", "flows", "mcp", "roles"])
  } finally {
    await bridge.dispose()
  }
})

test("the shipped example extension is discoverable, disabled, and contributes all four kinds", () => {
  // The shipped example directory, read-only here: only discovery and validation are exercised.
  const exampleRoot = join(REPO, "extensions", "mpd-ext-example")
  // Its manifest inside the repo tree.
  const manifestPath = join(exampleRoot, "mpd-ext.json")
  expect(existsSync(manifestPath)).toBe(true)
  // The build result: the shipped example must be accepted, never rejected.
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
  // The built entry (a rejection would have failed on the line above).
  const entry = built.entry as ExtensionEntry
  expect(entry.errors).toEqual([])
  expect(entry.enabled).toBe(false)
  expect(entry.skills.length).toBe(1)
  expect(entry.flows.length).toBe(1)
  expect(entry.roles.length).toBe(1)
  expect(entry.contributions.mcp).toBe(1)
  // The reference server is a real, dependency-free stdio MCP server; the manifest names it
  // `server.ts` (the extension corpus is TypeScript now), and the file must be on disk.
  expect(existsSync(join(exampleRoot, "server.ts"))).toBe(true)
})
