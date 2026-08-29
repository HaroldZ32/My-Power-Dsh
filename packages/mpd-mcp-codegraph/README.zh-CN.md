# mpd-mcp-codegraph

**中文** | [English](./README.md)

离线构建的 MCP server，提供 CodeGraph 工具面（`mcp__codegraph__*`）。由 bundle 的 `mcp-codegraph` 行包装（`@deepseek-ai/dsh-mcp-client`，serverName `codegraph`，stdio）。

## 它做什么

- `dist/serve.js`（在打包时从 vendored 的预构建 codegraph dist 构建；见 `packages/mpd-mcp-codegraph/LICENSE` + `NOTICE`）将 MCP 请求转发到经由 `MPD_CODEGRAPH_BIN` / bundle 可选依赖解析的 codegraph 二进制。
- 与 `mpd-codegraph-plugin`（项目索引初始化）和 `mcp-codegraph` 行搭配使用。

## 用法

```bash
node scripts/pack-mpd.mjs   # bakes dist/serve.js into the bundle
```

bundle patch 行的配置：

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
