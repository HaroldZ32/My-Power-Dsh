import { afterEach, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { spawn, type ChildProcess } from "node:child_process"
import { createInterface } from "node:readline"
import { resolveDependencyEntry } from "../../mpd-mcp-shared/dependency-entry.ts"

/** Workspaces and child transports owned by this file. */
const fixtures: string[] = []
/** Each child is closed before its files are removed. */
const children: ChildProcess[] = []

afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode !== null || child.signalCode !== null) continue
    await new Promise<void>((done) => {
      child.once("close", done)
      child.kill()
    })
  }
  for (const fixture of fixtures.splice(0)) rmSync(fixture, { recursive: true, force: true })
})

/** Make a workspace with a TypeScript project so diagnostics come from the pinned dependency's server. */
function project(): string {
  /** Isolated project root, also valid as a separate log root when needed. */
  const root = mkdtempSync(join(tmpdir(), "mpd-cclsp-wire-"))
  fixtures.push(root)
  writeFileSync(join(root, "tsconfig.json"), '{"compilerOptions":{"strict":true}}\n')
  return root
}

/** The subset of a JSON-RPC success result used by the test. */
interface Result {
  /** The protocol version echoed by initialize. */
  readonly protocolVersion?: string
  /** Every definition published by tools/list. */
  readonly tools?: readonly unknown[]
  /** The explicit MCP tool failure bit, when present. */
  readonly isError?: boolean
  /** Human-readable diagnostic content from the tool result. */
  readonly content?: readonly { readonly text?: string }[]
}

/** A sequential JSON-RPC caller over newline-delimited MCP stdio. */
type Request = (method: string, params?: object) => Promise<Result>

/** Launch the source entry on Node with an isolated HOME and explicit workspace. */
async function connect(root: string, logs: string): Promise<Request> {
  /** The launcher entry under test, resolved before spawning with a separate cwd. */
  const launcher = fileURLToPath(new URL("../src/launch.ts", import.meta.url))
  /** The real MCP child owns stdout; stderr is drained independently. */
  const child = spawn("node", [launcher], {
    cwd: root,
    env: { ...process.env, HOME: root, DSH_WORKSPACE_ROOT: root, MPD_MCP_LOG_DIR: logs, CCLSP_CONFIG_PATH: "" },
  })
  children.push(child)
  child.stderr.resume()
  /** Read exactly one JSON line per test request with no allowance for stray stdout. */
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]()
  /** The monotonic id identifies the reply to each request. */
  let id = 0
  /** Send a single request and require the matching success frame. */
  const request: Request = async (method: string, params?: object): Promise<Result> => {
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }) + "\n")
    /** Read one frame or fail if the process closed prematurely. */
    const frame = await lines.next()
    if (frame.done) throw new Error(`LSP launcher ended before replying to ${method}`)
    /** The returned JSON-RPC envelope, asserted before use. */
    const reply = JSON.parse(frame.value) as { id: number; jsonrpc: string; result?: Result; error?: unknown }
    expect(reply.jsonrpc).toBe("2.0")
    expect(reply.id).toBe(id)
    if (!reply.result) throw new Error(`${method}: ${JSON.stringify(reply.error)}`)
    return reply.result
  }
  expect((await request("initialize", {
    protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "mpd-cclsp-test", version: "1.0.0" },
  })).protocolVersion).toBe("2025-03-26")
  child.stdin.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n')
  return request
}

/** Return the text result of a normal get_diagnostics call. */
async function diagnostics(request: Request, file: string): Promise<string> {
  /** The full tool reply must be successful and carry text. */
  const result = await request("tools/call", { name: "get_diagnostics", arguments: { file_path: file } })
  expect(result.isError).not.toBe(true)
  return (result.content ?? []).map((item) => item.text ?? "").join("\n")
}

test("an independent log directory cannot select the workspace cclsp configuration", async () => {
  /** The workspace and a different root with a decoy configuration. */
  const root = project()
  /** The log destination also has its own cclsp.json, which must stay unused. */
  const logs = project()
  writeFileSync(join(root, "cclsp.json"), '{"servers":[]}\n')
  writeFileSync(join(logs, "cclsp.json"), '{"servers":[]}\n')
  /** The remote client reaches tools/list even though the fixture config declares no servers. */
  const client = await connect(root, logs)
  expect((await client("tools/list")).tools).toHaveLength(12)
  /** Startup must report the workspace configuration in the log selected independently. */
  const log = readFileSync(join(logs, ".mpd", "logs", "mpd-mcp-lsp.log"), "utf8")
  expect(log).toContain(`Loading config from CCLSP_CONFIG_PATH: ${join(root, "cclsp.json")}`)
  expect(log).not.toContain(`Loading config from CCLSP_CONFIG_PATH: ${join(logs, "cclsp.json")}`)
}, 15_000)

test("the pinned cclsp diagnostics refresh after ordinary edits without restarting the MCP session", async () => {
  expect(resolveDependencyEntry(import.meta.url, "cclsp", "cclsp")?.version).toBe("0.7.0")
  /** A protocol peer that publishes diagnostics from the received document text. */
  const server = fileURLToPath(new URL("./push-server.ts", import.meta.url))
  /** Workspace configuration routes a fixture-only file extension to that peer. */
  const root = project()
  writeFileSync(join(root, "cclsp.json"), JSON.stringify({
    servers: [{ extensions: ["sample"], command: ["node", server], rootDir: root }],
  }))
  /** File edited normally on disk between requests. */
  const file = join(root, "diagnostic.sample")
  writeFileSync(file, 'answer = "wrong"\n')
  /** The same MCP connection observes both edits and can still list all tools. */
  const client = await connect(root, root)
  expect(await diagnostics(client, file)).toContain("string type mismatch")
  expect(await diagnostics(client, file)).toContain("string type mismatch")
  writeFileSync(file, "answer = 42\n")
  expect(await diagnostics(client, file)).toContain("No diagnostics found")
  writeFileSync(file, "answer = false\n")
  expect(await diagnostics(client, file)).toContain("boolean type mismatch")
  expect((await client("tools/list")).tools).toHaveLength(12)
}, 25_000)

test("the bundled TypeScript peer publishes fresh errors after normal file edits", async () => {
  /** The generated config uses the dependency's own TypeScript language server. */
  const root = project()
  /** The file's open state and version stay in cclsp across all three edits. */
  const file = join(root, "diagnostic.ts")
  writeFileSync(file, 'export const answer: number = "wrong"\n')
  /** The same MCP session exercises preload, open and after-edit diagnostics. */
  const client = await connect(root, root)
  /** Let preload finish before the first diagnostics call to avoid racing startup. */
  const logPath = join(root, ".mpd", "logs", "mpd-mcp-lsp.log")
  /** The startup scan can wait for one 3-second upstream initialization timeout. */
  const deadline = Date.now() + 8_000
  while (Date.now() < deadline && !readFileSync(logPath, "utf8").includes("LSP server preloading completed")) await Bun.sleep(50)
  expect(readFileSync(logPath, "utf8")).toContain("LSP server preloading completed")
  /** The first request can race the TypeScript engine's initial project analysis. */
  let initial = ""
  for (let attempt = 0; attempt < 8; attempt++) {
    initial = await diagnostics(client, file)
    if (initial.includes("Type 'string' is not assignable to type 'number'")) break
    await Bun.sleep(200)
  }
  expect(initial).toContain("Type 'string' is not assignable to type 'number'")
  writeFileSync(file, "export const answer: number = 42\n")
  expect(await diagnostics(client, file)).toContain("No diagnostics found")
  writeFileSync(file, "export const answer: number = false\n")
  expect(await diagnostics(client, file)).toContain("Type 'boolean' is not assignable to type 'number'")
}, 25_000)
