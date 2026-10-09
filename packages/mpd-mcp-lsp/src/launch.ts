#!/usr/bin/env node
// mpd LSP MCP launcher — cclsp (de-omo wave B2).
//
// WHAT REPLACED WHAT: this launcher used to start the vendored `lsp-daemon` build that shipped beside
// it as `./cli.js` (SUL-1.0, built offline by the now-retired `scripts/build-mcp.ts` from
// `vendor/mcp-src/**`). That artifact and its whole snapshot are gone. The capability now comes from
// the DECLARED npm dependency `cclsp` (MIT, © 2025 ktnyt), whose own `typescript-language-server`
// dependency supplies the TS/JS language server — so the row needs no user-installed server for the
// languages this repository is written in.
//
// The row's launch shape is unchanged: `command: node`, `args: [<bundle>/packages/mpd-mcp-lsp/dist/launch.js]`.
// (The old row passed a literal `mcp` subcommand; cclsp takes no subcommand, so that argv entry is gone.)
//
// THREE THINGS THIS FILE OWNS, and nothing else:
//   1. R5 terminal silence. The harness builds this row as `new StdioClientTransport({command, args,
//      env, cwd})` with NO `stderr` option, so the MCP SDK spawns this process with fd 2 INHERITED —
//      fd 2 here IS the dsh process's fd 2, which in a TUI session is the Ink alternate screen. cclsp
//      writes a startup narration to stderr ("Loading config from ...", "Starting 1 LSP servers..."),
//      which is exactly the class of output that wrecks that screen. `installTerminalSilence` runs
//      FIRST, before the dependency is imported, and moves fd 2 and the console writers into
//      `<root>/.mpd/logs/mpd-mcp-lsp.log`.
//   2. Dependency resolution. The entry is resolved from THIS module's location through the installed
//      profile's `node_modules` (shared resolver), never from a path baked into the patch.
//   3. Configuration. cclsp refuses to start without a config file (`configPath is required when
//      CCLSP_CONFIG_PATH environment variable is not set`). A caller-set `CCLSP_CONFIG_PATH` always
//      wins; otherwise a `cclsp.json` in the workspace root is used — the user's file is AUTHORITATIVE
//      and is never rewritten — and only when neither exists is a config generated at
//      `<root>/.mpd/lsp/cclsp.json`, naming the TS/JS family plus every language of the
//      `./server-catalog.ts` table whose language server is actually installed.
//
// CAPABILITY DELTAS against the retired server are stated in `packages/mpd-mcp-lsp/README.md`; the
// three that have no cclsp counterpart are `status`, `prepare_rename` and `install_decision`.
import { pathToFileURL } from "node:url"
import { resolveDependencyEntry } from "../../mpd-mcp-shared/dependency-entry.ts"
import { installTerminalSilence, resolveLogRoots } from "../../mpd-mcp-shared/log-sink.ts"
import type { LogSink } from "../../mpd-mcp-shared/log-sink.ts"
import { serveUnavailable } from "../../mpd-mcp-shared/unavailable-server.ts"
import { buildConfigDocument, ensureConfigPath } from "./cclsp-config.ts"
import type { CclspConfigDocument, ConfigOutcome } from "./cclsp-config.ts"

/** The npm package this launcher starts; the version is pinned in the bundle's `optionalDependencies`. */
const DEPENDENCY: string = "cclsp"
/** The dependency's `bin` key, which is the MCP server entry (not `main`). */
const DEPENDENCY_BIN: string = "cclsp"
/** The language server package cclsp depends on, which the generated config points at. */
const TS_LANGUAGE_SERVER: string = "typescript-language-server"

// FIRST statement of the module body: this file's own imports are node builtins and chatter-free, and
// the dependency below is imported DYNAMICALLY on the last line — a static import would be hoisted
// above this call and defeat the whole point.
/** The terminal-silence sink: the launcher's log file, and the diagnostics channel of the fallback below. */
const sink: LogSink = installTerminalSilence("mpd-mcp-lsp")

/** The located dependency, or null when the profile did not materialize it. */
const dependency = resolveDependencyEntry(import.meta.url, DEPENDENCY, DEPENDENCY_BIN)

/**
 * Build the config the launcher writes when the user has none.
 *
 * The TS/JS row is the one this bundle can always supply: it points at the language server inside the
 * DECLARED `cclsp` dependency, through `process.execPath` so the server runs on the same node as this
 * launcher — never through `npx`, which would download a package at request time. Every other row
 * comes from the language→server catalog and is included only when its executable actually resolves
 * (see `buildConfigDocument`), so the generated config never names a binary that is not installed.
 *
 * @param configRoot the absolute workspace root the config is written under and `rootDir` anchors at.
 * @param packageJson the dependency's manifest, from which its own dependency tree is resolved.
 * @returns the config document, ready to serialize; its `servers` list is empty when nothing at all
 *   resolves, which cclsp accepts (it then reports the missing server per request).
 */
function generatedConfig(configRoot: string, packageJson: string): CclspConfigDocument {
  /** The language server the declared dependency carries, or null when it cannot be located. */
  const languageServer = resolveDependencyEntry(pathToFileURL(packageJson).href, TS_LANGUAGE_SERVER, TS_LANGUAGE_SERVER)
  /** The argv cclsp spawns for the TS/JS family; `process.execPath` keeps it on the running node. */
  const command: readonly string[] | null = languageServer === null ? null : [process.execPath, languageServer.entry, "--stdio"]
  return buildConfigDocument({ root: configRoot, typescriptCommand: command })
}

/**
 * Decide which config cclsp is pointed at, writing the generated one only when nothing else supplies it.
 *
 * The decision itself lives in `./cclsp-config.ts`, because that is the part a test must be able to
 * drive without spawning anything; this wrapper hands it the real environment and the real document,
 * and narrates the outcome into the log sink. Resolution order, FIRST hit wins: the caller's
 * `CCLSP_CONFIG_PATH`, then `<root>/cclsp.json` — which is AUTHORITATIVE and never rewritten — then
 * the generated `<root>/.mpd/lsp/cclsp.json` (rewritten only when its bytes would change, so a session
 * does not churn the file on every boot).
 *
 * @param root the workspace root to look in and to write under.
 * @param packageJson the dependency's manifest, the anchor of the language-server lookup.
 * @returns the config path now in `CCLSP_CONFIG_PATH`, or null when no config could be supplied (a
 *   read-only workspace); cclsp then reports its own actionable error instead of the row dying.
 */
function publishConfigPath(root: string, packageJson: string): string | null {
  /** What the resolution decided and did; the side effect on `process.env` happens inside it. */
  const outcome: ConfigOutcome = ensureConfigPath({
    root,
    env: process.env,
    build: (): CclspConfigDocument => generatedConfig(root, packageJson)
  })
  if (outcome.path === null) {
    sink.write("[mpd-mcp-lsp] could not supply a cclsp config under " + root + " (read-only workspace?)")
    return null
  }
  sink.write("[mpd-mcp-lsp] cclsp config: " + outcome.path + " (" + describeSource(outcome) + ")")
  return outcome.path
}

/**
 * One phrase describing how a config path was decided, for the log line.
 *
 * @param outcome what the resolution decided.
 * @returns the phrase appended to the log line.
 */
function describeSource(outcome: ConfigOutcome): string {
  if (outcome.source === "env") return "from CCLSP_CONFIG_PATH"
  if (outcome.source === "workspace") return "workspace root, left untouched"
  if (outcome.source === "generated") {
    return "generated, " + outcome.serverCount + " language server(s)" + (outcome.wrote ? "" : ", unchanged")
  }
  return "unavailable"
}

if (dependency === null) {
  // The declared dependency is absent. Stay alive with zero tools rather than killing the row's child;
  // the reason lands in the log sink above.
  await serveUnavailable(sink, {
    name: "mpd-mcp-lsp",
    reason: "the declared dependency " + DEPENDENCY + " is not installed in this profile",
    hint: "install the bundle's dependency closure (npm/pnpm install) and restart the session"
  })
  process.exitCode = 0
} else {
  sink.write("[mpd-mcp-lsp] starting " + DEPENDENCY + "@" + dependency.version + " from " + dependency.entry)
  /** The workspace root the config is anchored at: the highest-precedence log root is the session's own. */
  const root = resolveLogRoots()[0] ?? process.cwd()
  publishConfigPath(root, dependency.packageJson)
  // The specifier is a RUNTIME VALUE on purpose: a literal one would make `bun build` inline the whole
  // third-party server into this launcher (measured on the ast-grep twin).
  /** The dependency's MCP server entry, resolved from the installed profile. */
  const entry: string = dependency.entry
  await import(entry)
}
