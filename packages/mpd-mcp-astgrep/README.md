# mpd-mcp-astgrep

**English** | [中文](./README.zh-CN.md)

Offline-built MCP server exposing **ast-grep** structural code search/rewrite as
`mcp__ast_grep__*` tools. Wrapped by the bundle's `mcp-astgrep` row
(`@deepseek-ai/dsh-mcp-client`, serverName `ast_grep`, stdio).

## What it does

- `launch.ts` is the row's entry point (B8). It resolves the binary
  **bundle-relatively**: a caller env pin → `$MPD_AST_GREP_BIN_DIR/{ast-grep,sg}` →
  `createRequire` of the `@ast-grep/cli` optional dependency (packed layout, any node
  linker) → `<bundle>/.toolchain/node_modules/.bin/{ast-grep,sg}` (checkout `link:`
  install). It sets `MPD_AST_GREP_SG_PATH` only when the caller left it unset, then
  starts `dist/cli.js` (built offline by `scripts/build-mcp.ts`), which bridges MCP to
  the adopted ast-grep server.
- `ast-grep` is preferred over `sg` in every tier: a candidate is accepted only when
  `--version` prints `ast-grep`, which rejects the deprecated `.bin/sg` wrapper (it
  exits 1).
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
    args: [<bundle>/packages/mpd-mcp-astgrep/dist/launch.js]
    toolCallTimeoutMs: 60000
```

The row names **no binary path** (B8): resolution lives in `launch.ts` +
`packages/mpd-mcp-shared/bin-resolve.ts`, so it works in both install layouts, and a
wrong caller pin is never silently overridden.

## Notes

- Env key `MPD_AST_GREP_SG_PATH` is read by upstream vendored code — never rename it
  (AGENTS.md §1). When the caller sets it, the launcher leaves it untouched.
- Missing binary symptom: `ast-grep BINARY_NOT_FOUND` — install the toolchain
  (`node scripts/install-mcp.ts` or `install-profile.ts --yes`) or set the env path.
