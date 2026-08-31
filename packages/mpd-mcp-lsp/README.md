# mpd-mcp-lsp

**English** | [中文](./README.zh-CN.md)

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

## RTL (Verilog / SystemVerilog) LSP support

Two HDL language servers ship as **builtin** registrations in the offline-built
`dist/cli.js` (in-repo overlay applied by `scripts/build-mcp.mjs`, anchor
`mpd-rtl-overlay-v1`):

- `verible` → `verible-verilog-ls`, extensions `.v .vh`
- `slang-server` → `slang-server`, extensions `.sv .svh`

They resolve automatically by file extension once the executables are on `PATH`;
the `lsp-setup` skill routes `.v/.vh` → `references/verilog/README.md` and
`.sv/.svh` → `references/systemverilog/README.md` for install/verify steps.

### Custom binary escape hatch

If you built `verible-verilog-ls` / `slang-server` by hand and they are **not**
on `PATH`, define them with an explicit `command` in the **user** LSP config
(`~/.codex/lsp-client.json`, or the single path set by `LSP_TOOLS_MCP_USER_CONFIG`).
A ready template lives at `templates/rtl-lsp-client.json` — merge its `"lsp"`
entries into that user config. Do **not** put custom commands in a project
`.codex/lsp-client.json`: project configs ignore non-builtin ids.
