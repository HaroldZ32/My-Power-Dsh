// The harness asserts `output.schema` with assertSupportedJsonSchema AT
// REGISTER TIME (H/dsh-tools/lib/index.js:2777) — a failure there throws out of
// the registration call. This check runs the SAME assertion, from the INSTALLED
// harness, over every tool schema the plugin actually registers, both for the
// four mpd_ext_*/mpd_flow_* tools and for the tools a real stdio MCP server
// contributes through the bridge.
//
// It is deliberately NOT a boot: the real mounted-boot proof (isolated DSH_HOME +
// sandbox HOME + sandbox workspace, registration instrumentation) belongs to the
// QA task t5. This is the cheap, harness-anchored schema check that runs first.
//
// Run: bun evidence/extensions/registered-tool-schemas/20260914T171058Z/check.mjs
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { apply } from "../../../../packages/mpd-ext-plugin/src/index.ts"
import { buildExtension, DEFAULT_EXTENSION_CONFIG } from "../../../../packages/mpd-ext-plugin/src/registry.ts"
import { connectExtensionMcpServers } from "../../../../packages/mpd-ext-plugin/src/mcp.ts"
import { createDshAdapter } from "../../../../packages/mpd-dsh-adapter-plugin/src/index.ts"

const HERE = fileURLToPath(new URL(".", import.meta.url))
const REPO = fileURLToPath(new URL("../../../../", import.meta.url))
const HARNESS = process.env.MPD_HARNESS_DSH_TOOLS
  ?? "/root/.nvm/versions/node/v24.16.0/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-tools/lib/index.js"

const harness = await import(HARNESS)
const home = mkdtempSync(join(tmpdir(), "mpd-ext-schema-home-"))
process.env.HOME = home

function makeCtx() {
  const registered = []
  const warnings = []
  const ctx = {
    logger: { warn: (line) => warnings.push(line), info: () => {}, error: () => {} },
    get: () => undefined,
    provide: () => {},
    effect: () => () => {},
    tools: {
      register: (definition) => { registered.push(definition); return () => {} },
      get: (name) => registered.find((tool) => tool.name === name),
      guard: () => () => {},
      execute: async () => ({}),
    },
    skills: { registerProvider: () => () => {} },
  }
  return { ctx, registered, warnings }
}

const rows = []
function check(definition, source) {
  const violations = []
  try {
    harness.assertSupportedJsonSchema(definition.output.schema)
  } catch (error) {
    violations.push(`output.schema: ${error instanceof Error ? error.message : String(error)}`)
  }
  // parameters is NOT asserted by this release (defense-in-depth only) — record
  // that fact instead of claiming a check the harness does not perform.
  rows.push({
    source,
    name: definition.name,
    hasRender: typeof definition.output.render === "function",
    timeoutMs: definition.timeoutMs ?? null,
    outputSchemaAccepted: violations.length === 0,
    violations,
    parametersAssertedByThisRelease: false,
  })
}

// ── 1) the plugin's own four tools, through the real apply path ─────────────
const own = makeCtx()
await apply(own.ctx, { quiet: true })
for (const definition of own.registered) check(definition, "mpd-ext-plugin apply")

// ── 2) the tools a REAL stdio MCP server contributes through the bridge ─────
const root = mkdtempSync(join(tmpdir(), "mpd-ext-schema-root-"))
const built = buildExtension({
  input: {
    apiVersion: 1,
    id: "lsp-live",
    contributes: {
      mcp: [{
        serverName: "lsp",
        transport: "stdio",
        command: "node",
        args: [join(REPO, "packages", "mpd-mcp-lsp", "dist", "cli.js"), "mcp"],
        cwd: ".",
        connectTimeoutMs: 15000,
        toolCallTimeoutMs: 15000,
      }],
    },
  },
  plane: "user",
  origin: "directory",
  root,
  source: join(root, "mpd-ext.json"),
  fallbackId: "lsp-live",
  providerName: "mpd-ext:lsp-live",
})
if (built.entry === undefined) throw new Error("fixture extension rejected: " + JSON.stringify(built.rejected?.errors))
const bridgeHarness = makeCtx()
const bridge = await connectExtensionMcpServers({
  dsh: createDshAdapter(bridgeHarness.ctx),
  entries: [built.entry],
  config: () => DEFAULT_EXTENSION_CONFIG,
  warn: () => {},
})
for (const definition of bridgeHarness.registered) check(definition, "stdio MCP bridge (real packages/mpd-mcp-lsp server)")
const states = bridge.view()
await bridge.dispose()

const failed = rows.filter((row) => !row.outputSchemaAccepted || !row.hasRender)
const result = {
  check: "every registered tool schema passes the INSTALLED harness assertSupportedJsonSchema",
  harnessPath: HARNESS,
  home: process.env.HOME,
  toolsChecked: rows.length,
  applyWarnings: own.warnings,
  mcpServers: states,
  failed: failed.length,
  verdict: failed.length === 0 && rows.length > 0 ? "pass" : "fail",
  honestLimits: [
    "assertSupportedJsonSchema is asserted by the harness on output.schema ONLY; `parameters` is recorded as not-asserted rather than claimed.",
    "this is a schema/registration check, not a mounted boot: t5 owns the isolated-DSH_HOME mount proof with registration instrumentation.",
  ],
  rows,
}

mkdirSync(join(HERE, "raw"), { recursive: true })
writeFileSync(join(HERE, "result.json"), JSON.stringify(result, null, 2) + "\n")
writeFileSync(
  join(HERE, "raw", "output.log"),
  rows.map((row) => `${row.outputSchemaAccepted ? "ok  " : "FAIL"} ${row.name} (${row.source}) render=${row.hasRender} timeoutMs=${String(row.timeoutMs)}${row.violations.length > 0 ? " " + row.violations.join("; ") : ""}`).join("\n")
    + `\n\ntools checked: ${rows.length}\nfailed: ${failed.length}\nverdict: ${result.verdict}\n`,
)
rmSync(home, { recursive: true, force: true })
rmSync(root, { recursive: true, force: true })
console.log(JSON.stringify({ verdict: result.verdict, toolsChecked: rows.length, failed: failed.length, mcpServers: states.map((server) => `${server.serverName}=${server.state}(${server.tools.length})`), applyWarnings: own.warnings }, null, 2))
