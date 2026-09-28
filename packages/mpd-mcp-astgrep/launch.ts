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
import { resolveAstGrepBinary } from "../mpd-mcp-shared/bin-resolve.ts"

if ((process.env.MPD_AST_GREP_SG_PATH ?? "").trim().length === 0) {
  try {
    /** The bundle-relative binary, or null when no candidate passed the resolver's tiers. */
    const resolved = resolveAstGrepBinary(import.meta.url)
    if (resolved) process.env.MPD_AST_GREP_SG_PATH = resolved.binary
  } catch {
    // never throw: the adopted chain below owns the actionable error
  }
}

// The adopted CLI is a built artifact with no declaration file; widening the specifier to
// `string` keeps the runtime specifier untouched while TypeScript stops resolving it (TS7016).
await import("./dist/cli.js" as string)
