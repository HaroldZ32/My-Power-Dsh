#!/usr/bin/env node
// mpd LSP MCP launcher (R5, lane F).
//
// WHY THIS FILE EXISTS: the `mcp-lsp` row launches the adopted `dist/cli.js` directly, and that file
// is a sha-pinned prebuilt behind the blocking vendor gate (`dist/BUILD.lock`, source `8c57e46`) —
// editing it would either fail the gate or turn the gate into a self-attestation. The terminal silence
// therefore cannot live inside the adopted entry; it lives here, in our own file.
//
// HOOKUP STATE (honest): the row must name THIS file in `args[0]` instead of `dist/cli.js`.
// `cordis.patch.yml` is lane B's write scope, so that one-line repoint is handed to the captain; until
// it lands the row still starts `dist/cli.js` and this launcher is not yet in the path. The launcher
// itself is proven working — it answers a real `initialize` handshake on stdout with zero bytes on
// stderr, and `node packages/mpd-mcp-lsp/dist/launch.js bogus` writes the adopted server's usage line into
// `<root>/.mpd/logs/mpd-mcp-lsp.log`.
//
// The measured reason the silence is needed here in particular: this adopted entry carries five
// `stderr.write(...)` diagnostics (`[lsp-daemon] …`), and the harness builds the row as
// `new StdioClientTransport({ command, args, env, cwd })` with NO `stderr` option, so the MCP SDK
// spawns the child with `stdio: ["pipe", "pipe", this._serverParams.stderr ?? "inherit"]`. This
// process's fd 2 IS the dsh process's fd 2 — in a TUI session, the Ink alternate screen.
//
// Behaviour is otherwise unchanged: the adopted entry runs `main()` unconditionally at module scope,
// reads its command word from `argv.slice(2)` (the row passes `mcp` explicitly; the entry defaults to
// `mcp` anyway, so this wrapper is argv-transparent), and resolves `stderr` from `node:process` to the
// `process.stderr` OBJECT — so its `stderr.write(...)` calls do a property lookup at call time and hit
// the replacement installed below.
import { installTerminalSilence } from "../../mpd-mcp-shared/log-sink.ts"

// The install is the FIRST statement of the module body: this file's own import above is
// `log-sink.ts` (node builtins only, chatter-free), and the adopted entry is imported DYNAMICALLY
// below on purpose — a static import would be hoisted above this line and defeat the whole point.
installTerminalSilence("mpd-mcp-lsp")

// The adopted CLI is a built artifact with no declaration file; widening the specifier to `string`
// keeps the runtime specifier untouched while TypeScript stops resolving it (TS7016).
// The adopted server is a built artifact with no declaration file, so the specifier is typed as a
// plain string (TS7016). IT IS ALSO A NAMED CONSTANT ON PURPOSE: `bun build` follows a LITERAL
// dynamic import and would INLINE the whole adopted server into this launcher (measured 2026-10-03 on
// the ast-grep twin: the bundle ended in `init_cli()` and every adopted byte was duplicated). A
// non-literal specifier is left alone, and the path resolves at RUNTIME beside THIS MODULE'S BUILT
// LOCATION (packages/mpd-mcp-<x>/dist/launch.js) — which is why it reads `./cli.js` rather than a
// path relative to this source file.
/** The adopted server entry, resolved at runtime beside the built launcher. */
const ADOPTED_ENTRY: string = "./cli.js"
await import(ADOPTED_ENTRY)
