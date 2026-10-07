#!/usr/bin/env node
// mpd ast-grep MCP launcher (wave-2 B8).
//
// The bundle patch no longer names a binary path: this launcher resolves the
// binary bundle-relatively (shared resolver, t1 §3.2 precedence) and hands it to
// the adopted server through the env key the vendored code already reads
// (MPD_AST_GREP_SG_PATH — never renamed, AGENTS.md §1), then starts the server.
//
// Rules:
// - a pin already present in process.env wins untouched (user / mcp.env / legacy
//   installer / QA/dev-flavor escape hatch);
// - resolution failure is NOT fatal: the dist is imported anyway with the env
//   untouched, so the adopted resolver runs its own chain and reports its own
//   actionable BINARY_NOT_FOUND error;
// - never throw, and never write to stdout (it carries the MCP protocol);
//   diagnostics, if any, belong on stderr.
//
// R5 (lane F): "diagnostics belong on stderr" is NOT enough any more. The harness builds this row as
// `new StdioClientTransport({ command, args, env, cwd })` with no `stderr` option, and the MCP SDK
// then spawns this process with `stdio: ["pipe", "pipe", "inherit"]` — so fd 2 here IS the dsh
// process's fd 2, which in a TUI session is the Ink alternate screen. The sink below takes the
// terminal writers away before the adopted server is loaded (that import is DYNAMIC on the last line
// of this file, so the install really does run first — a static import would be hoisted above it).
import { installTerminalSilence } from "../../mpd-mcp-shared/log-sink.ts"
import { resolveAstGrepBinary } from "../../mpd-mcp-shared/bin-resolve.ts"

// The install is the FIRST statement of the module body, so it runs after this file's own
// chatter-free imports and BEFORE the adopted server's dynamic import on the last line.
installTerminalSilence("mpd-mcp-astgrep")

if ((process.env.MPD_AST_GREP_SG_PATH ?? "").trim().length === 0) {
  try {
    /** The bundle-relative binary, or null when no candidate passed the resolver's tiers. */
    const resolved = resolveAstGrepBinary(import.meta.url)
    if (resolved) process.env.MPD_AST_GREP_SG_PATH = resolved.binary
  } catch {
    // never throw: the adopted chain below owns the actionable error
  }
}

// The adopted CLI is a built artifact with no declaration file, so the specifier is typed as a plain
// string (TS7016). IT IS ALSO A NAMED CONSTANT ON PURPOSE: `bun build` follows a LITERAL dynamic
// import and would INLINE the 96 KB adopted server into this launcher (measured 2026-10-03: the
// bundle ended in `init_cli()` and every adopted byte was duplicated). A non-literal specifier is
// left alone, and the path is resolved at RUNTIME relative to THIS MODULE'S BUILT LOCATION
// (packages/mpd-mcp-<x>/dist/launch.js) — which is why it reads `./cli.js` rather than a path
// relative to this source file.
/** The adopted server entry, resolved at runtime beside the built launcher. */
const ADOPTED_ENTRY: string = "./cli.js"
await import(ADOPTED_ENTRY)
