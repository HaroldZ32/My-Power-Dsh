# mpd-mcp-lsp

**中文** | [English](./README.md)

离线构建的 MCP server，通过 `lsp` transport 驱动语言服务器（`mcp__lsp__*` 工具）
——定义、引用、诊断、悬停。由 bundle 的 `mcp-lsp` row（`@deepseek-ai/dsh-mcp-client`，
serverName `lsp`，stdio）包装。

## 功能

- `dist/cli.js`（由 `scripts/build-mcp.mjs` 离线构建）与随附的 LSP daemon 说 MCP；
  `mcp` 子命令用于选择 server 模式。
- 在真实 home 上 daemon 会自动启动；设置破损的症状：`LSP daemon unreachable`
  （`~/.mpd` 不可写/缺失）。

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

## 注意事项

- 精确的符号事实（定义/引用/诊断）优先用 LSP；结构性模式查询用 ast-grep；两者在限定
  范围时都很便宜。
