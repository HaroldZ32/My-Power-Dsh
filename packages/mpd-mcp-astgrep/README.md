# mpd-mcp-astgrep

**English** | [中文](./README.zh-CN.md)

Offline-built MCP server exposing **ast-grep** structural code search/rewrite as
`mcp__ast_grep__*` tools. Wrapped by the bundle's `mcp-astgrep` row
(`@deepseek-ai/dsh-mcp-client`, serverName `ast_grep`, stdio).

## What it does

- `dist/cli.js` (built offline by `scripts/build-mcp.mjs`) bridges MCP to the
  `@ast-grep/cli` binary, resolved via `MPD_AST_GREP_SG_PATH` or the bundle's
  optional dependency `node_modules/.bin/sg`.
- Best for structural/pattern queries ("find every `fn` without error handling"),
  refactor candidates, and whole-repo rule checks — far cheaper than blind greps.

## Bundle row

```yaml
- id: mcp-astgrep
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: ast_grep
    transport: stdio
    command: node
    args: [<bundle>/packages/mpd-mcp-astgrep/dist/cli.js]
    env: { MPD_AST_GREP_SG_PATH: <bundle>/node_modules/.bin/sg }
    toolCallTimeoutMs: 60000
```

## Notes

- Env key `MPD_AST_GREP_SG_PATH` is read by upstream vendored code — never rename it
  (AGENTS.md §1).
- Missing binary symptom: `ast-grep BINARY_NOT_FOUND` — install the toolchain
  (`node scripts/install-profile.mjs --yes`) or set the env path.
