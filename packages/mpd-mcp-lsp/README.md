# mpd-mcp-lsp

**English** | [中文](./README.zh-CN.md)

Thin launcher for the declared npm dependency **`cclsp`** (MIT, © 2025 ktnyt) — the
language-server plane of the bundle, exposed as `mcp__lsp__*` tools. Wrapped by the bundle's
`mcp-lsp` row (`@deepseek-ai/dsh-mcp-client`, serverName `lsp`, stdio).

## What it does

- `dist/launch.js` (our own file, built by this package's `build` script) resolves `cclsp` from the
  installed profile's `node_modules`, takes this process's terminal writers away from the terminal
  (`<root>/.mpd/logs/mpd-mcp-lsp.log`), then imports cclsp's `bin` entry in-process.
- Nothing is vendored and nothing is built from `vendor/mcp-src/**`: that snapshot, the retired
  `scripts/build-mcp.ts` and the SUL-1.0 `lsp-daemon` build it produced are gone (de-omo wave B2).
- The TS/JS language server needs no user installation: cclsp depends on
  `typescript-language-server` (Apache-2.0) and the launcher's generated config points at that copy.

## Tools

cclsp's own twelve names, and this bundle uses them **unchanged** — there is no name-translating
shim: `find_definition`, `find_references`, `find_implementation`, `rename_symbol`,
`rename_symbol_strict`, `get_diagnostics`, `get_hover`, `find_workspace_symbols`,
`prepare_call_hierarchy`, `get_incoming_calls`, `get_outgoing_calls`, `restart_server`.

Two of them write to disk (`rename_symbol`, `rename_symbol_strict`), so both are on the read-only
specialists' deny list.

## Configuration

The launcher sets `CCLSP_CONFIG_PATH` only when the caller left it unset, and in this order:

1. a caller-set `CCLSP_CONFIG_PATH` — always wins;
2. `<workspace>/cclsp.json` — the file a user maintains by hand;
3. `<workspace>/.mpd/lsp/cclsp.json` — generated, TypeScript/JavaScript only, rewritten only when its
   bytes would change.

Any other language is a `servers` entry in the config file: cclsp spawns the language server named
there, and that server is the user's own installation (`gopls`, `pylsp`, `rust-analyzer`, …).

## Bundle row

```yaml
- id: mcp-lsp
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: lsp
    transport: stdio
    command: node
    args: [<bundle>/packages/mpd-mcp-lsp/dist/launch.js]
    toolCallTimeoutMs: 60000
```

## Capability deltas (de-omo wave B2)

The retired server exposed eight names; cclsp exposes twelve, and three of the old ones have no
counterpart. None was dropped quietly:

| Old name | Status | Why |
|---|---|---|
| `status` | **DROPPED** | It reported the vendored daemon's own state; that daemon no longer exists. `restart_server` is the surviving operational verb, and the launcher's log file is where the LSP plane narrates itself. |
| `prepare_rename` | **DROPPED** | cclsp's `rename_symbol` performs symbol resolution and the edit atomically, so there is no separate prepare step to call. The capability is subsumed, not lost. |
| `install_decision` | **DROPPED** | It recorded a decision the retired `lsp-core` read. cclsp has no such mechanism: a missing language server is reported per request. |
| `diagnostics` | replaced | `get_diagnostics` |
| `goto_definition` | replaced | `find_definition` |
| `find_references` | replaced | `find_references` |
| `symbols` | replaced | `find_workspace_symbols` |
| `rename` | replaced | `rename_symbol` (+ `rename_symbol_strict`) |
| — | **NEW** | `find_implementation`, `get_hover`, `prepare_call_hierarchy`, `get_incoming_calls`, `get_outgoing_calls`, `restart_server` |

**Language coverage is a delta too**: the retired overlay carried install hints for ~40 languages and
its own code decided which server to launch. cclsp drives whatever the config names, so the TS/JS
family works out of the box (its own dependency) and every other language is a `cclsp.json` entry plus
the user's own language server.

## Notes

- Prefer LSP for exact symbol facts (definition/references/diagnostics); ast-grep for structural
  pattern queries; both are cheap when scoped.
- If the dependency is absent from the profile, the row stays ALIVE with zero tools and records the
  reason in `<root>/.mpd/logs/mpd-mcp-lsp.log` instead of killing the boot.
