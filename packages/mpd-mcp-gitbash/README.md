# mpd-mcp-gitbash

Offline-built MCP server exposing **Git Bash** (native Windows git operations) as
`mcp__git_bash__*` tools. Wrapped by the bundle's `mcp-gitbash` row
(`@deepseek-ai/dsh-mcp-client`, serverName `git_bash`, stdio).

## What it does

- `dist/cli.js` (built offline by `scripts/build-mcp.mjs`) bridges MCP to native Git
  Bash on Windows.
- **Windows-only by design** (the upstream original: `run` is available only on native
  Windows); the bundle row ships `disabled: true` by default so non-Windows
  deployments are unaffected.

## Bundle row

```yaml
- id: mcp-gitbash
  name: '@deepseek-ai/dsh-mcp-client'
  disabled: true   # Windows deployments may flip this
  config:
    serverName: git_bash
    transport: stdio
    command: node
    args: [<bundle>/packages/mpd-mcp-gitbash/dist/cli.js]
    toolCallTimeoutMs: 60000
```

## Notes

- On Linux/macOS use the `bash` tool; this server exists for native Windows git UX.
