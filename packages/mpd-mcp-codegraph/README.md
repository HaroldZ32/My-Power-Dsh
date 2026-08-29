# mpd-mcp-codegraph

**English** | [中文](./README.zh-CN.md)

Offline-built MCP server that serves the CodeGraph tool surface
(`mcp__codegraph__*`). Wrapped by the bundle's `mcp-codegraph` row
(`@deepseek-ai/dsh-mcp-client`, serverName `codegraph`, stdio).

## What it does

- `dist/serve.js` (built at pack time from the vendored prebuilt codegraph dist; see
  `packages/mpd-mcp-codegraph/LICENSE` + `NOTICE`) forwards MCP requests to the
  codegraph binary resolved via `MPD_CODEGRAPH_BIN` / bundle optional dependency.
- Pair with `mpd-codegraph-plugin` (project index init) and `mcp-codegraph` row.

## Usage

```bash
node scripts/pack-mpd.mjs   # bakes dist/serve.js into the bundle
```

The bundle patch row config:

```yaml
- id: mcp-codegraph
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: codegraph
    transport: stdio
    command: node
    args: [<bundle>/packages/mpd-mcp-codegraph/dist/serve.js]
    env: { MPD_CODEGRAPH_BIN: <bundle>/node_modules/.bin/codegraph }
```
