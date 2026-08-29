# mpd-mcp-lsp

Offline-built MCP server that drives language servers through the `lsp` transport
(`mcp__lsp__*` tools) — definitions, references, diagnostics, hover. Wrapped by the
bundle's `mcp-lsp` row (`@deepseek-ai/dsh-mcp-client`, serverName `lsp`, stdio).

## What it does

- `dist/cli.js` (built offline by `scripts/build-mcp.mjs`) speaks MCP to the bundled
  LSP daemon; the `mcp` subcommand selects the server mode.
- The daemon self-starts on a real home; symptom of a broken setup:
  `LSP daemon unreachable` (`~/.mpd` unwritable/missing).

## Bundle row

```yaml
- id: mcp-lsp
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: lsp
    transport: stdio
    command: node
    args: [<bundle>/packages/mpd-mcp-lsp/dist/cli.js, mcp]
    toolCallTimeoutMs: 60000
```

## Notes

- Prefer LSP for exact symbol facts (definition/refs/diagnostics); ast-grep for
  structural pattern queries; both are cheap when scoped.
