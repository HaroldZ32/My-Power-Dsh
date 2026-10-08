#!/usr/bin/env node
// cli.ts — the ast_grep MCP server entry point.
//
// This file is the artifact the bundle patch mounts: `dist/launch.js` sets up the engine pin and the
// terminal silencer, then dynamically imports `dist/cli.js`, which is this module. It is also the
// path a legacy profile row and `scripts/install-profile.ts` name directly, so serving must start
// from the MODULE BODY rather than from an argv subcommand — there is no command line to parse, and
// argv is deliberately ignored.
//
// stdout carries the MCP protocol and nothing else. A fatal error goes to this server's OWN log
// file through the shared sink — never to a terminal, because a stdio MCP child inherits its
// parent's descriptors and would otherwise paint over the Ink alternate screen of a live TUI.
import { openLogSink } from "../../mpd-mcp-shared/log-sink.ts"
import { runStdioServer } from "./protocol.ts"

/**
 * Record one fatal failure in this server's log file.
 *
 * `openLogSink` is the NON-capturing half of the log-sink pair: it never touches `process.stderr` or
 * `console` (the launcher already decided whether to capture those), and it never throws — when no
 * root is writable the record lands in the sink's in-memory ring instead of on a terminal.
 * @param error - the thrown value to record
 */
function reportFatal(error: unknown): void {
  /** The row's log sink, appending to the same `<name>.log` the launcher opened. */
  const sink = openLogSink("mpd-mcp-astgrep")
  sink.write(error instanceof Error ? (error.stack ?? error.message) : String(error))
}

/**
 * Serve the MCP protocol on stdio until the client closes it.
 * @returns a promise that settles when the server stops
 */
async function main(): Promise<void> {
  await runStdioServer()
}

main().catch((error: unknown) => {
  reportFatal(error)
  process.exitCode = 1
})
