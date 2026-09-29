#!/usr/bin/env node
// mpd codegraph MCP launcher (wave-2 B8).
//
// The bundle patch no longer names a binary path: this launcher resolves the
// binary bundle-relatively (shared resolver, t1 §3.2 precedence) and hands it to
// the adopted server through the env key it already reads (MPD_CODEGRAPH_BIN),
// then starts the server.
//
// - a pin already present in process.env wins untouched;
// - resolution failure is NOT fatal: with the env untouched the adopted resolver
//   runs its own bundled -> provisioned -> PATH -> download chain;
// - `runCodegraphServe()` MUST be called here: serve.js self-starts only when it
//   is argv[1] (isDirectInvocation), which the launcher is, not serve.js;
// - never throw, and never write to stdout (it carries the MCP protocol).
import { resolveCodegraphBinary } from "../mpd-mcp-shared/bin-resolve.mjs"

if ((process.env.MPD_CODEGRAPH_BIN ?? "").trim().length === 0) {
  try {
    const resolved = resolveCodegraphBinary(import.meta.url)
    if (resolved) process.env.MPD_CODEGRAPH_BIN = resolved.binary
  } catch {
    // never throw: the adopted chain below owns the actionable error
  }
}

const serve = await import("./dist/serve.js")
process.exitCode = await serve.runCodegraphServe()
