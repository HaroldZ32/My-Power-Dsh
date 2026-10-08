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
//      wins; otherwise a `cclsp.json` in the workspace root is used, and only when neither exists is a
//      default config written to `<root>/.mpd/lsp/cclsp.json`.
//
// CAPABILITY DELTAS against the retired server are stated in `packages/mpd-mcp-lsp/README.md`; the
// three that have no cclsp counterpart are `status`, `prepare_rename` and `install_decision`.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { resolveDependencyEntry } from "../../mpd-mcp-shared/dependency-entry.ts"
import { installTerminalSilence, resolveLogRoots } from "../../mpd-mcp-shared/log-sink.ts"
import type { LogSink } from "../../mpd-mcp-shared/log-sink.ts"
import { serveUnavailable } from "../../mpd-mcp-shared/unavailable-server.ts"

/** The npm package this launcher starts; the version is pinned in the bundle's `optionalDependencies`. */
const DEPENDENCY: string = "cclsp"
/** The dependency's `bin` key, which is the MCP server entry (not `main`). */
const DEPENDENCY_BIN: string = "cclsp"
/** The language server package cclsp depends on, which the generated default config points at. */
const TS_LANGUAGE_SERVER: string = "typescript-language-server"
/** File extensions the generated default config claims: the TS/JS family the retired overlay covered. */
const DEFAULT_EXTENSIONS: readonly string[] = ["ts", "tsx", "js", "jsx", "mjs", "cjs", "mts", "cts"]

// FIRST statement of the module body: this file's own imports are node builtins and chatter-free, and
// the dependency below is imported DYNAMICALLY on the last line — a static import would be hoisted
// above this call and defeat the whole point.
/** The terminal-silence sink: the launcher's log file, and the diagnostics channel of the fallback below. */
const sink: LogSink = installTerminalSilence("mpd-mcp-lsp")

/** The located dependency, or null when the profile did not materialize it. */
const dependency = resolveDependencyEntry(import.meta.url, DEPENDENCY, DEPENDENCY_BIN)

/**
 * Build the default cclsp config: TS/JS through the language server cclsp depends on.
 *
 * @param configRoot the absolute workspace root the config is written under and `rootDir` anchors at.
 * @param packageJson the dependency's manifest, from which its own dependency tree is resolved.
 * @returns the config document, ready to serialize; its `servers` list is empty when the language
 *   server cannot be located, which cclsp accepts (it then reports the missing server per request).
 */
function defaultConfig(configRoot: string, packageJson: string): Record<string, unknown> {
  /** The language server command, or null when the bundled server cannot be located. */
  const languageServer = resolveDependencyEntry(pathToFileURL(packageJson).href, TS_LANGUAGE_SERVER, TS_LANGUAGE_SERVER)
  /** The command cclsp spawns per extension group; `process.execPath` keeps it on the running node. */
  const command = languageServer === null ? null : [process.execPath, languageServer.entry, "--stdio"]
  return {
    servers: command === null ? [] : [{ extensions: [...DEFAULT_EXTENSIONS], command, rootDir: configRoot }]
  }
}

/**
 * Point cclsp at a config file, generating the default one only when nothing else supplies it.
 *
 * Resolution order, and the FIRST hit wins: the caller's `CCLSP_CONFIG_PATH`, then a `cclsp.json` in
 * the workspace root, then the generated `<root>/.mpd/lsp/cclsp.json` (rewritten only when its bytes
 * would change, so a session does not churn the file on every boot).
 *
 * @param root the workspace root to look in and to write under.
 * @param packageJson the dependency's manifest, the anchor of the language-server lookup.
 * @returns the config path now in `CCLSP_CONFIG_PATH`, or null when no config could be supplied (a
 *   read-only workspace); cclsp then reports its own actionable error instead of the row dying.
 */
function ensureConfigPath(root: string, packageJson: string): string | null {
  /** The caller's own config, which is never second-guessed. */
  const configured = (process.env.CCLSP_CONFIG_PATH ?? "").trim()
  if (configured.length > 0) return configured
  /** The workspace-root config a user maintains by hand. */
  const projectConfig = join(root, "cclsp.json")
  if (existsSync(projectConfig)) {
    process.env.CCLSP_CONFIG_PATH = projectConfig
    sink.write("[mpd-mcp-lsp] cclsp config: " + projectConfig + " (workspace root)")
    return projectConfig
  }
  /** The generated config's path, under workspace-scoped state and never in the user's home. */
  const generated = join(root, ".mpd", "lsp", "cclsp.json")
  try {
    /** The config document, serialized once so the change check and the write agree. */
    const body = JSON.stringify(defaultConfig(root, packageJson), null, 2) + "\n"
    /** The existing bytes, or null when the file is absent or unreadable. */
    let existing: string | null
    try {
      existing = readFileSync(generated, "utf8")
    } catch {
      existing = null
    }
    if (existing !== body) {
      mkdirSync(join(root, ".mpd", "lsp"), { recursive: true })
      writeFileSync(generated, body)
    }
    process.env.CCLSP_CONFIG_PATH = generated
    sink.write("[mpd-mcp-lsp] cclsp config: " + generated + " (generated default: TypeScript/JavaScript)")
    return generated
  } catch (error) {
    // A read-only workspace is not fatal here: cclsp's own error names the missing config, and a row
    // that dies would take the boot down instead.
    sink.write("[mpd-mcp-lsp] could not write " + generated + ": " + String(error))
    return null
  }
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
  ensureConfigPath(root, dependency.packageJson)
  // The specifier is a RUNTIME VALUE on purpose: a literal one would make `bun build` inline the whole
  // third-party server into this launcher (measured on the ast-grep twin).
  /** The dependency's MCP server entry, resolved from the installed profile. */
  const entry: string = dependency.entry
  await import(entry)
}
